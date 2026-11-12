import { AVENTURIA, toRenderLngLat, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import type { Map as MapLibreMap } from "maplibre-gl";
import { computed, watch, type ComputedRef, type Ref } from "vue";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import type { AnlegenZeiger } from "../map/geometrie/anlegen";
import { installAnlegenModus } from "../map/geometrie/anlegen-modus";
import { ansichtDerSeite } from "../map/geometrie/neue-flaeche-anbindung";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import { createKraftlinienDaten } from "./kraftlinien-daten";
import { createNeueKraftlinie, type NeueKraftlinie, type NeueKraftlinieMeldung } from "./neue-kraftlinie";

/**
 * „Neue Kraftlinie“ für die Seite (WI-0205 K9): die Steuerung mit Server, Karte und Fangradius verbunden, damit `app.vue` nur die Griffe
 * reicht (wie `wegeditor/neuer-weg-anbindung.ts`). Meldungen erscheinen als Hinweis unten; das Schild am Ziel nennt den Nodix und was der
 * Klick dort tut. Esc hängt die Seite in ihre Kaskade (Stufe `action`); weitere Tasten braucht der Modus nicht, denn der Klick auf den
 * zweiten Nodix schließt ab. Im Entwicklungsbuild liegt die Steuerung als `globalThis.avesmapsNeueKraftlinie`.
 *
 * Die Ansicht (`view`, `layer`: `mapView` und `landscapeSelection` der Seite) stellt ein Start aus einer anderen Ansicht auf die
 * Kraftlinien und sperrt sie, solange gezeichnet wird; dafür dient dieselbe Stelle wie bei „Neue Fläche“ (`ansichtDerSeite`, C3), mit
 * demselben Hinweis, wenn jemand währenddessen die Ansicht wechseln will.
 */

export interface NeueKraftlinieSeite {
    karte(): MapLibreMap | undefined;
    interaction(): MapInteractionCoordinator | undefined;
    /** Nach dem Speichern: Karte, Bögen und Liste mit der Revision der Quittung neu. */
    geaendert(revision: number): void;
    /** Die neue Linie ist gespeichert: das Kraftlinien-Fenster an ihr öffnen. */
    geoeffnet(publicId: string): void;
    /** Die Ansicht der Seite; ohne stellt ein Start nie um. */
    readonly view?: Ref<MapView> | undefined;
    readonly layer?: Ref<LandscapeSelection> | undefined;
}

export type NeueKraftlinieFuerSeite = NeueKraftlinie & {
    readonly schild: ComputedRef<{ x: number; y: number; name: string; tut: string } | undefined>;
};

/** Der Name eines Nodix für Leiste und Schild; ein Kraftlinienpunkt ohne Namen heißt nach seiner Art. */
export const nodixName = (name: string): string => (name.trim() === "" ? t("kraftlinieneditor.punkt") : name);

export function neueKraftlinieSchild(zeiger: AnlegenZeiger): { name: string; tut: string } {
    return {
        name: nodixName(zeiger.treffer.ziel.name),
        tut: t(zeiger.lage === "anfang" ? "kraftlinieneditor.neu.schild.anfang" : "kraftlinieneditor.neu.schild.ende"),
    };
}

export function neueKraftlinieMeldungText(meldung: NeueKraftlinieMeldung): string {
    switch (meldung.art) {
        case "gespeichert":
            return t("kraftlinieneditor.neu.gespeichert", { name: meldung.name });
        case "abgelehnt":
            return meldung.satz;
        case "abgewiesen":
            return t("kraftlinieneditor.neu.grund");
        case "verworfen":
            return t("kraftlinieneditor.neu.verworfen");
        case "ladefehler":
            return t("kraftlinieneditor.neu.ladefehler");
    }
}

export function createNeueKraftlinieFuerSeite(seite: NeueKraftlinieSeite): NeueKraftlinieFuerSeite {
    const ansicht =
        seite.view !== undefined && seite.layer !== undefined
            ? ansichtDerSeite(seite.view, seite.layer, () => showToast(t("neueFlaeche.ansichtGesperrt"), "warning"))
            : undefined;
    const neu = createNeueKraftlinie({
        daten: createKraftlinienDaten(),
        fangradius: () => startansicht().fangradius,
        geoeffnet: (publicId) => seite.geoeffnet(publicId),
        karte: {
            ein(eingabe) {
                const map = seite.karte();
                const interaction = seite.interaction();
                return map && interaction ? installAnlegenModus(map, interaction, eingabe) : undefined;
            },
            geaendert: (revision) => {
                if (revision !== undefined) seite.geaendert(revision);
            },
            naechster(bei, ziele, radius) {
                const map = seite.karte();
                if (map === undefined) return undefined;
                const schirm = (at: { x: number; y: number }) =>
                    map.project(toRenderLngLat(AVENTURIA.coordinateSpace, at));
                const stelle = schirm(bei);
                return ziele
                    .map((ziel) => ({ ziel, abstand: schirm(ziel.at).dist(stelle) }))
                    .filter((k) => k.abstand <= radius)
                    .sort((a, b) => a.abstand - b.abstand)[0]?.ziel;
            },
            ...(ansicht === undefined
                ? {}
                : {
                      zuKraftlinien() {
                          const vorige = ansicht.ansicht();
                          ansicht.stelle({ view: "powerlines" });
                          ansicht.sperreAnsicht(true);
                          return {
                              zurueck() {
                                  ansicht.sperreAnsicht(false);
                                  ansicht.stelle(vorige);
                              },
                              bleib() {
                                  ansicht.sperreAnsicht(false);
                              },
                          };
                      },
                  }),
        },
    });
    const stopMeldung = watch(neu.meldung, (meldung) => {
        if (meldung === undefined) return;
        const ton = meldung.art === "gespeichert" ? "success" : meldung.art === "verworfen" ? "normal" : "warning";
        showToast(neueKraftlinieMeldungText(meldung), ton);
    });
    const schild = computed(() => {
        const zeiger = neu.zeiger.value;
        return zeiger === undefined ? undefined : { ...zeiger.schirm, ...neueKraftlinieSchild(zeiger) };
    });
    const fuerSeite: NeueKraftlinieFuerSeite = {
        ...neu,
        schild,
        destroy() {
            stopMeldung();
            neu.destroy();
            ansicht?.stop();
        },
    };
    if (import.meta.env.DEV)
        (globalThis as unknown as { avesmapsNeueKraftlinie?: NeueKraftlinie }).avesmapsNeueKraftlinie = fuerSeite;
    return fuerSeite;
}
