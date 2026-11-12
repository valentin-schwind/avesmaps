import type { Map as MapLibreMap } from "maplibre-gl";
import { watch, type WatchStopHandle } from "vue";
import { SEARCH_FIT_MAX_ZOOM, type EditorLockTarget, type EditorTerritoryForm } from "@avesmaps3d/shared";
import type { EditorSperre } from "../editor-sperre/sperre";
import type { Entwurf } from "../fenster/entwurf-kern";
import type { Camera } from "../map/camera/camera";
import type { FormStand } from "../map/geometrie/formentwurf";
import { operationAus, type Aufbau } from "../map/geometrie/formoperation";
import type { Punkt } from "../map/geometrie/geometrie";
import { beobachteAblehnung, createMarkenkarte, fliegeZurStelle } from "../map/geometrie/ablehnung-stelle";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import type { AusstehendeFlaeche } from "./ausstehende-gebiete";
import { wechsleGebiet } from "./gebiet-wechsel";
import type { GebietBearbeitung } from "./gebietseditor-steuerung";
import { createGebietsform, createGebietsformDaten, type Gebietsform } from "./gebietsform";

/**
 * „Gebietsform bearbeiten“ für die Seite (WI-0209 C1, B2): die Steuerung mit Server, Karte, Kamera und Fangradius verbunden, damit `app.vue`
 * nur die Griffe reicht. Wie `landschaftseditor/ecken-anbindung.ts`.
 *
 * 🔴 **EIN Entwurf** (O3, EDIT-0003 T44; B2 Teil 2): Der Start holt die Bearbeitung des Gebiets (`bearbeitung`, sie öffnet dabei sein
 * Fenster) und gibt dem Formentwurf statt eines eigenen Kerns deren Sicht (`formEntwurf`) über einen Vermittler. Felder und Grenzen stehen
 * so in EINER Folge, und „Fertig“ der Bearbeitung schreibt beides als `territory.update`. Die Sperre des eigenen Gebiets hält die
 * Bearbeitung: Der Formentwurf gibt sie nicht frei und meldet ihren Verlust nicht; die Nachbarn sperrt er weiter selbst.
 *
 * - **Abgelehnt oder nicht übernommen** (Vali 2026-11-10, wie „Ecken bearbeiten“): Die Stelle steht als roter Ring auf der Karte, die Kamera
 *   fliegt hin (`map/geometrie/ablehnung-stelle.ts`).
 * - **Die Baronie darunter** (Frage 2): Mit Klickpunkt liest der Start erst, welches Gebiet die Grenze trägt, und hängt Bearbeitung und
 *   Sperre an dieses; der gelesene Stand geht ohne zweites Lesen in den Modus (`starteMit`).
 */
export interface GebietsformSeite {
    /** Karte und Koordinator, sobald die Karte bereit ist; vorher startet kein Modus. */
    karte():
        | {
              map: MapLibreMap;
              interaction: MapInteractionCoordinator;
              camera: Pick<Camera, "showBounds" | "showPoint">;
          }
        | undefined;
    /** Die EINE Sperre der Seite (EDIT-0003 §4), geteilt von allen Editoren. */
    sperre: EditorSperre;
    /** Die Bearbeitung dieses Gebiets; öffnet sein Fenster (D19). Ohne Schreibrecht keine: Dann beginnt nichts. */
    bearbeitung(territoryId: string): GebietBearbeitung | undefined;
    /** „Fertig“ hat mit der Form geschrieben (der Hinweis „✓ … gespeichert“, wie vor O3). */
    gespeichert?(name: string): void;
    /** „Fertig“ hat diese Flächen geschrieben: die Karte zeigt sie, bis die Ableitung sie zeichnet (`ausstehende-gebiete.ts`). */
    ausstehend?(flaechen: readonly AusstehendeFlaeche[]): void;
}

/**
 * Die geschriebenen Flächen einer Form: jede, die sich gegenüber dem Start geändert hat (wie der Körper, `operationAus`), mit ihrem Gebiet
 * aus dem gelesenen Stand (eigene oder die eines Nachbarn) und, für die eigenen, der Farbe des Gebiets.
 */
export function geschriebeneFlaechen(
    start: FormStand,
    jetzt: FormStand,
    aufbau: Aufbau,
    gelesen: EditorTerritoryForm,
    farbe: string | undefined,
): AusstehendeFlaeche[] {
    const gebietDer = new Map<string, string>([
        ...gelesen.areas.map((flaeche) => [flaeche.id, gelesen.id] as const),
        ...gelesen.neighbors.map((nachbar) => [nachbar.id, nachbar.territory] as const),
    ]);
    return operationAus(start, jetzt, aufbau, "").areas.map((flaeche) => {
        const gebiet = gebietDer.get(flaeche.id) ?? gelesen.id;
        return {
            flaeche: flaeche.id,
            gebiet,
            farbe: gebiet === gelesen.id ? farbe : undefined,
            polygone: flaeche.polygons,
        };
    });
}

export interface GebietsformFuerSeite extends Gebietsform {
    /** Startet am Gebiet; mit dem Klickpunkt führt ein abgeleitetes Gebiet zur Baronie darunter. */
    starteAm(id: string, at?: Punkt): Promise<void>;
    /** Der Klick auf ein anderes Gebiet (`gebiet-wechsel.ts`): schreibt Ungespeichertes wie „Fertig“, dann beginnt es dort; `davor` läuft nur, wenn es wirklich wechselt. */
    wechsleAm(id: string, at: Punkt, davor?: () => void): Promise<void>;
}

const KEINE_LAGE = { ungespeichert: 0, zurueck: false, wieder: false, frage: false } as const;

export function createGebietsformFuerSeite(seite: GebietsformSeite): GebietsformFuerSeite {
    /** Das Gebiet des laufenden Modus, die Sicht seiner Bearbeitung und der Aufbau seiner Flächen. */
    let gebietId: string | undefined;
    let sicht: Entwurf<FormStand> | undefined;
    let bearbeitung: GebietBearbeitung | undefined;
    let aufbau: Aufbau = new Map();
    let stopHinweis: WatchStopHandle | undefined;
    let stopStelle: WatchStopHandle | undefined;
    /** Die Marken im Geometriemodus: die der abgelehnten Stelle und die eines nicht übernommenen Schritts. */
    const marken = createMarkenkarte();
    let lesen: AbortController | undefined;
    const eigene = (ziel: EditorLockTarget): boolean => ziel.kind === "territory" && ziel.id === gebietId;

    /** Der Kern des Formentwurfs reicht alles an die Sicht der Bearbeitung des laufenden Modus; der Start meldet der Art die Form. */
    const vermittler: Entwurf<FormStand> = {
        beginne: (stand) => {
            bearbeitung?.art.merkeForm(aufbau, stand);
            sicht?.beginne(stand);
        },
        leere: () => sicht?.leere(),
        schritt: (stand, verschmelze) => sicht?.schritt(stand, verschmelze),
        schluss: () => sicht?.schluss(),
        ersetzeAlle: (neu) => sicht?.ersetzeAlle(neu),
        start: () => sicht?.start(),
        jetzt: () => sicht?.jetzt(),
        zurueck: () => sicht?.zurueck() ?? false,
        wieder: () => sicht?.wieder() ?? false,
        verwerfen: () => sicht?.verwerfen() ?? false,
        esc: () => sicht?.esc() ?? "ende",
        antworte: (verwerfen) => sicht?.antworte(verwerfen) ?? "ende",
        lage: () => sicht?.lage() ?? KEINE_LAGE,
    };

    // Der zuletzt gelesene Stand der Form: aus ihm kommt, welchem Gebiet eine geschriebene Fläche gehört.
    const basis = createGebietsformDaten();
    let gelesen: EditorTerritoryForm | undefined;
    const daten = {
        async form(id: string, at: Punkt | undefined, signal: AbortSignal) {
            const form = await basis.form(id, at, signal);
            if (form !== null) gelesen = form;
            return form;
        },
    };
    const form = createGebietsform({
        daten,
        fangradius: () => startansicht().fangradius,
        sperre: {
            nimm: (ziel, teil) => seite.sperre.nimm(ziel, teil),
            gib: (ziel) => {
                if (!eigene(ziel)) seite.sperre.gib(ziel);
            },
            beiVerlust: (zuhoerer) => seite.sperre.beiVerlust((ziel) => (eigene(ziel) ? undefined : zuhoerer(ziel))),
            liste: (art) => seite.sperre.liste(art),
        },
        entwurf: vermittler,
        merkeAufbau: (neu) => {
            aufbau = neu;
        },
        karte: {
            ein(eingabe) {
                const da = seite.karte();
                const neu =
                    da === undefined
                        ? undefined
                        : installGeometrieModus(da.map, da.interaction, { ...eingabe, werkzeug: "gebietseditor" });
                if (neu === undefined) return undefined;
                return {
                    ...marken.haenge(neu),
                    aus() {
                        marken.los(neu);
                        neu.aus();
                    },
                };
            },
            zeige(teile) {
                const da = seite.karte();
                if (da !== undefined) zeigeFrei(da.map, da.camera, teile, SEARCH_FIT_MAX_ZOOM.landschaft);
            },
            // Geschrieben wird über die Bearbeitung; deren Karte lädt die Kacheln neu.
            geaendert: () => undefined,
        },
    });

    async function starteAm(id: string, at?: Punkt): Promise<void> {
        // Mit Klickpunkt erst das Gebiet, das die Grenze trägt (die Baronie unter einem abgeleiteten Gebiet).
        let vorab: EditorTerritoryForm | undefined;
        if (at !== undefined) {
            lesen?.abort();
            const steuer = new AbortController();
            lesen = steuer;
            try {
                vorab = (await daten.form(id, at, steuer.signal)) ?? undefined;
            } catch {
                vorab = undefined;
            }
            if (lesen !== steuer) return;
        }
        const ziel = vorab?.id ?? id;
        const neu = seite.bearbeitung(ziel);
        if (neu === undefined) return;
        // Ein laufender Modus endet zuerst; seine Form hängt ab, sein Entwurf bleibt in seinem Fenster.
        form.beende();
        gebietId = ziel;
        bearbeitung = neu;
        sicht = neu.formEntwurf({
            zurueck: () => form.zurueck(),
            wieder: () => form.wieder(),
            verwerfen: () => form.verwerfen(),
            abbrechen: () => form.abbrechen(),
            beende: () => form.beende(),
        });
        // Schreibt „Fertig“ der Bearbeitung, während der Modus läuft, sagt der Hinweis es wie bisher.
        stopHinweis?.();
        let mitForm = false;
        let geschrieben: AusstehendeFlaeche[] = [];
        stopHinweis = watch(
            () => neu.zustand.value.art,
            (art) => {
                if (art === "speichert") {
                    mitForm = form.laufend.value !== undefined;
                    const start = sicht?.start();
                    const jetzt = sicht?.jetzt();
                    geschrieben =
                        mitForm && start !== undefined && jetzt !== undefined && gelesen !== undefined
                            ? geschriebeneFlaechen(start, jetzt, aufbau, gelesen, neu.detail.value?.color)
                            : [];
                } else if (art === "gespeichert" && mitForm) {
                    seite.gespeichert?.(neu.detail.value?.name ?? "");
                    const job = neu.art.ableitung(ziel);
                    seite.ausstehend?.(geschrieben.map((flaeche) => ({ ...flaeche, job })));
                }
                if (art !== "speichert") {
                    mitForm = false;
                    geschrieben = [];
                }
            },
            { flush: "sync" },
        );
        stopStelle?.();
        stopStelle = beobachteAblehnung(
            neu,
            () => form.laufend.value !== undefined && gebietId === ziel,
            (m) => marken.setze(m),
            (stelle) => fliegeZurStelle(seite.karte(), stelle),
        );
        await form.starteMit(ziel, vorab);
    }

    return {
        ...form,
        starte: (id) => starteAm(id),
        starteAm,
        wechsleAm(id, at, davor) {
            const von = bearbeitung;
            return wechsleGebiet(
                von === undefined
                    ? undefined
                    : {
                          ungespeichert: form.laufend.value?.ungespeichert ?? 0,
                          fertig: () => von.fertig(),
                          laeuft: () => form.laufend.value !== undefined,
                      },
                () => {
                    davor?.();
                    return starteAm(id, at);
                },
            );
        },
        destroy() {
            lesen?.abort();
            stopHinweis?.();
            stopStelle?.();
            form.destroy();
        },
    };
}
