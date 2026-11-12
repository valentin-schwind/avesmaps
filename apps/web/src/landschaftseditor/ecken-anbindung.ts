import type { Map as MapLibreMap } from "maplibre-gl";
import { watch, type WatchStopHandle } from "vue";
import { SEARCH_FIT_MAX_ZOOM, type EditorLandscapeLayer, type EditorLockTarget } from "@avesmaps3d/shared";
import type { EditorSperre } from "../editor-sperre/sperre";
import type { Entwurf } from "../fenster/entwurf-kern";
import type { Camera } from "../map/camera/camera";
import { beobachteAblehnung, createMarkenkarte, fliegeZurStelle } from "../map/geometrie/ablehnung-stelle";
import type { FormStand } from "../map/geometrie/formentwurf";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import { createEcken, type Ecken } from "./ecken";
import { createEckenDaten } from "./ecken-daten";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „✎ Ecken bearbeiten“ für die Seite (WI-0178 C1, B2): die Steuerung mit Server, Karte, Kamera und Fangradius verbunden, damit `app.vue`
 * nur die Griffe reicht (`app.vue` schmal einhängen). Wie `wegeditor/wegkurve-anbindung.ts`.
 *
 * 🔴 **EIN Entwurf** (O3, EDIT-0003 T44): Der Start holt die Bearbeitung der Landschaft (`bearbeitung`, sie öffnet dabei ihr Fenster) und
 * gibt dem Formentwurf statt eines eigenen Kerns deren Sicht (`formEntwurf`). Felder und Form stehen so in EINER Folge, und „Fertig“ der
 * Bearbeitung schreibt beides als `landscape.update`. Die Sperre der eigenen Landschaft hält die Bearbeitung: Der Formentwurf gibt sie
 * nicht frei und meldet ihren Verlust nicht (den Konflikt „Sperre abgelaufen“ zeigt die Bearbeitung).
 *
 * **Ungültige Form** (Vali 2026-11-09): Lehnt der Server „Fertig“ ab, weil sich eine Form schneidet (`map/geometrie/form-ungueltig.ts`),
 * markiert der Modus die Stelle mit einem roten Ring und die Kamera fliegt hin, wenn die Stelle nicht frei zu sehen ist. Die Marke gilt nur
 * für den abgelehnten Stand: Der nächste Schritt, ↶, Verwerfen und das Ende des Modus nehmen sie weg.
 */
export interface EckenSeite {
    /** Karte und Koordinator, sobald die Karte bereit ist; vorher startet kein Modus. */
    karte():
        | { map: MapLibreMap; interaction: MapInteractionCoordinator; camera: Pick<Camera, "showBounds" | "showPoint"> }
        | undefined;
    /** Die sichtbaren Ebenen der Karte (in „Landschaften“ die gewählte, sonst alle drei). */
    ebenen(): readonly EditorLandscapeLayer[];
    /** Die EINE Sperre der Seite (EDIT-0003 §4), geteilt von allen Editoren. */
    sperre: EditorSperre;
    /** Die Bearbeitung dieser Landschaft; öffnet ihr Fenster (D19). Ohne Schreibrecht keine: Dann beginnt nichts. */
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    /** „Fertig“ hat mit der Form geschrieben (der Hinweis „✓ Gebietsform … gespeichert“, wie vor O3; EDIT-0003 T48). */
    gespeichert?(name: string): void;
    /** Steht das Fenster dieser Landschaft sichtbar (angedockt oder gelöst)? Sonst endet der Modus. */
    getragen(regionId: string): boolean;
}

const KEINE_LAGE = { ungespeichert: 0, zurueck: false, wieder: false, frage: false } as const;

export function createEckenFuerSeite(seite: EckenSeite): Ecken {
    /** Die Landschaft des laufenden Modus und die Sicht ihrer Bearbeitung. */
    let regionId: string | undefined;
    let sicht: Entwurf<FormStand> | undefined;
    let bearbeitung: LandschaftBearbeitung | undefined;
    let stopHinweis: WatchStopHandle | undefined;
    let stopStelle: WatchStopHandle | undefined;
    /** Die Marken im Geometriemodus: die der abgelehnten Stelle und die eines nicht übernommenen Schritts. */
    const marken = createMarkenkarte();
    const eigene = (ziel: EditorLockTarget): boolean => ziel.kind === "landscape" && ziel.id === regionId;

    /** Der Kern des Formentwurfs reicht alles an die Sicht der Bearbeitung des laufenden Modus. */
    const vermittler: Entwurf<FormStand> = {
        beginne: (stand) => sicht?.beginne(stand),
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

    const ecken = createEcken({
        daten: createEckenDaten(),
        fangradius: () => startansicht().fangradius,
        ebenen: seite.ebenen,
        sperre: {
            nimm: (ziel, teil) => seite.sperre.nimm(ziel, teil),
            gib: (ziel) => {
                if (!eigene(ziel)) seite.sperre.gib(ziel);
            },
            beiVerlust: (zuhoerer) => seite.sperre.beiVerlust((ziel) => (eigene(ziel) ? undefined : zuhoerer(ziel))),
            liste: (art) => seite.sperre.liste(art),
        },
        entwurf: vermittler,
        merkeAufbau: (aufbau) => bearbeitung?.art.merkeAufbau(aufbau),
        karte: {
            ein(eingabe) {
                const da = seite.karte();
                if (da === undefined) return undefined;
                const neu = installGeometrieModus(da.map, da.interaction, {
                    ...eingabe,
                    werkzeug: "landschaftseditor",
                });
                // Ohne Modus (ein anderer Formmodus belegt die Karte, `belegeGeometrie`) gibt es nichts zu markieren.
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

    // Das Fenster trägt die Form: Legt man es ab (Esc im angedockten Fenster, „Offene Bearbeitungen“), endet der Modus, der Entwurf
    // bleibt im Fenster (wie die Wegkurve, `stopTraeger` in `wegkurve-anbindung.ts`; Fund der Kraftlinien 2026-10-19).
    watch(
        () => {
            const lauf = ecken.laufend.value;
            return lauf?.phase !== "bereit" || regionId === undefined || seite.getragen(regionId);
        },
        (getragen) => {
            if (!getragen) ecken.beende();
        },
    );

    return {
        ...ecken,
        destroy() {
            stopHinweis?.();
            stopStelle?.();
            ecken.destroy();
        },
        async starte(id) {
            const neu = seite.bearbeitung(id);
            if (neu === undefined) return;
            // Ein laufender Modus endet zuerst; seine Form hängt ab, sein Entwurf bleibt in seinem Fenster.
            ecken.beende();
            regionId = id;
            bearbeitung = neu;
            sicht = neu.formEntwurf({
                zurueck: () => ecken.zurueck(),
                wieder: () => ecken.wieder(),
                verwerfen: () => ecken.verwerfen(),
                abbrechen: () => ecken.abbrechen(),
                beende: () => ecken.beende(),
            });
            // Schreibt „Fertig“ der Bearbeitung, während der Modus läuft, sagt der Hinweis es wie bisher.
            stopHinweis?.();
            let mitForm = false;
            stopHinweis = watch(
                () => neu.zustand.value.art,
                (art) => {
                    if (art === "speichert") mitForm = ecken.laufend.value !== undefined;
                    else if (art === "gespeichert" && mitForm) seite.gespeichert?.(neu.detail.value?.name ?? "");
                    if (art !== "speichert") mitForm = false;
                },
                { flush: "sync" },
            );
            // Eine Ablehnung wegen ungültiger Form: die Stelle markieren und hinfliegen, solange der abgelehnte Stand steht.
            stopStelle?.();
            stopStelle = beobachteAblehnung(
                neu,
                () => ecken.laufend.value?.id === id,
                (m) => marken.setze(m),
                (stelle) => fliegeZurStelle(seite.karte(), stelle),
            );
            await ecken.starte(id);
        },
    };
}
