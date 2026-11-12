import type { Map as MapLibreMap } from "maplibre-gl";
import { computed, watch, type ComputedRef, type Ref } from "vue";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { installAnlegenModus } from "../map/geometrie/anlegen-modus";
import { ansichtDerSeite, sichtbareEbenen } from "../map/geometrie/neue-flaeche-anbindung";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import { createNeuerWeg, type NeuerWeg } from "./neuer-weg";
import { createWegeditorDaten } from "./wegeditor-daten";
import { neuerWegMeldungText, neuerWegSchild } from "./wegeditor-texte";

/**
 * „Neuer Weg“ für die Seite (WI-0177): die Steuerung mit Server, Karte und Fangradius verbunden, damit `app.vue` nur die Griffe reicht
 * (`app-vue` schmal einhängen), wie `wegkurve-anbindung.ts`.
 *
 * - **Ziele** um den sichtbaren Ausschnitt: beim Start und jedes Mal, wenn die Karte zur Ruhe kommt (`moveend`), nie während einer Geste.
 * - **Tasten** (R5, keine neue): Enter ist „Fertig“, ⌫ der letzte Punkt zurück, Strg+Z und Strg+Y (Mac ⌘, auch Strg+Umschalt+Z) zurück
 *   und wieder; nie in einem Textfeld. Esc hängt die Seite in ihre Kaskade (Stufe `action`).
 * - **Meldungen** (angelegt samt Anschlüssen, abgelehnt, nicht fertig, verworfen) erscheinen als Hinweis unten.
 * - **Schild am Ziel** (`schild`): Lage am Schirm und Sätze für `map/geometrie/anlegen-schild.vue`.
 * - **Ansicht** (`view`, `layer`: `mapView` und `landscapeSelection` der Seite): Fluss und Bach stellen auf Landschaft, Ebene Topographie,
 *   und sperren den Wechsel, solange gezeichnet wird; derselbe Weg wie „Neue Fläche“ und „Neue Kraftlinie“ (`ansichtDerSeite`).
 * - **Testeinstieg:** Im Entwicklungsbuild liegt die Steuerung als `globalThis.avesmapsNeuerWeg`.
 */

export interface NeuerWegSeite {
    karte(): MapLibreMap | undefined;
    interaction(): MapInteractionCoordinator | undefined;
    /** Nach dem Speichern: Wege mit der Revision der Quittung neu laden. */
    geaendert(revision: number): void;
    /** Der neue Weg ist gespeichert: das Wege-Fenster an ihm öffnen. */
    geoeffnet(publicId: string): void;
    readonly view?: Ref<MapView> | undefined;
    readonly layer?: Ref<LandscapeSelection> | undefined;
}

export type NeuerWegFuerSeite = NeuerWeg & {
    readonly schild: ComputedRef<{ x: number; y: number; name: string; tut: string } | undefined>;
};

const space = AVENTURIA.coordinateSpace;

function taste(neuerWeg: NeuerWeg, event: KeyboardEvent): boolean {
    const lauf = neuerWeg.laufend.value;
    if (lauf?.phase !== "bereit" || lauf.frage) return false;
    const ziel = event.target as HTMLElement | null;
    if (ziel?.closest("input, textarea, select, [contenteditable='true']")) return false;
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        neuerWeg.fertig();
        return true;
    }
    if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        neuerWeg.zurueck();
        return true;
    }
    if (!(event.ctrlKey || event.metaKey)) return false;
    const k = event.key.toLowerCase();
    if (k !== "z" && k !== "y") return false;
    if (k === "y" || event.shiftKey) neuerWeg.wieder();
    else neuerWeg.zurueck();
    return true;
}

export function createNeuerWegFuerSeite(seite: NeuerWegSeite): NeuerWegFuerSeite {
    const ansicht =
        seite.view !== undefined && seite.layer !== undefined
            ? ansichtDerSeite(seite.view, seite.layer, () => showToast(t("neueFlaeche.ansichtGesperrt"), "warning"))
            : undefined;
    const neuerWeg = createNeuerWeg({
        daten: createWegeditorDaten(),
        fangradius: () => startansicht().fangradius,
        // Flächen als Ziele eines Flusses nur aus den sichtbaren Ebenen, wie „Ecken bearbeiten“ (Vali 2026-11-08).
        ...(seite.view !== undefined && seite.layer !== undefined
            ? { ebenen: () => sichtbareEbenen(seite.view!.value, seite.layer!.value) }
            : {}),
        geoeffnet: (publicId) => seite.geoeffnet(publicId),
        karte: {
            ein(eingabe) {
                const map = seite.karte();
                const interaction = seite.interaction();
                return map && interaction ? installAnlegenModus(map, interaction, eingabe) : undefined;
            },
            sichtbar() {
                const map = seite.karte();
                if (!map) return undefined;
                const kasten = map.getBounds();
                const a = fromRenderLngLat(space, kasten.getSouthWest());
                const b = fromRenderLngLat(space, kasten.getNorthEast());
                return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
            },
            schirm(p) {
                const map = seite.karte();
                const render = toRenderLngLat(space, p);
                return map ? map.project([render.lng, render.lat]) : { x: 0, y: 0 };
            },
            geaendert: (revision) => {
                if (revision !== undefined) seite.geaendert(revision);
            },
            ...(ansicht === undefined
                ? {}
                : {
                      zuTopographie() {
                          const vorige = ansicht.ansicht();
                          ansicht.stelle({ view: "landscapes", layer: "topographie" });
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
    const tasten = (event: KeyboardEvent): void => {
        if (taste(neuerWeg, event)) event.preventDefault();
    };
    document.addEventListener("keydown", tasten);
    // Die Ziele folgen dem Ausschnitt, sobald die Karte zur Ruhe kommt; während einer Geste fragt niemand den Server.
    let karte: MapLibreMap | undefined;
    const ruhe = (): void => void neuerWeg.ladeZiele();
    const stopLauf = watch(
        () => neuerWeg.laufend.value !== undefined,
        (laeuft) => {
            if (laeuft && karte === undefined) {
                karte = seite.karte();
                karte?.on("moveend", ruhe);
            } else if (!laeuft && karte !== undefined) {
                karte.off("moveend", ruhe);
                karte = undefined;
            }
        },
    );
    const stopMeldung = watch(neuerWeg.meldung, (meldung) => {
        if (meldung === undefined) return;
        const ton = meldung.art === "gespeichert" ? "success" : meldung.art === "verworfen" ? "normal" : "warning";
        showToast(neuerWegMeldungText(meldung), ton);
    });
    const schild = computed(() => {
        const zeiger = neuerWeg.zeiger.value;
        return zeiger === undefined
            ? undefined
            : { ...zeiger.schirm, ...neuerWegSchild(zeiger, neuerWeg.laufend.value?.art) };
    });
    const fuerSeite: NeuerWegFuerSeite = {
        ...neuerWeg,
        schild,
        destroy() {
            document.removeEventListener("keydown", tasten);
            karte?.off("moveend", ruhe);
            stopLauf();
            stopMeldung();
            neuerWeg.destroy();
            ansicht?.stop();
        },
    };
    if (import.meta.env.DEV) (globalThis as unknown as { avesmapsNeuerWeg?: NeuerWeg }).avesmapsNeuerWeg = fuerSeite;
    return fuerSeite;
}
