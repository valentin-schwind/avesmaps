import type { Map as MapLibreMap } from "maplibre-gl";
import { watch } from "vue";
import { AVENTURIA, SEARCH_FIT_MAX_ZOOM, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import type { EditorSperre } from "../editor-sperre/sperre";
import type { Camera } from "../map/camera/camera";
import { zeigeFrei } from "../map/geometrie/kamera";
import { belegeGeometrie } from "../map/geometrie/besitzer";
import { installGeometrieModus } from "../map/geometrie/modus";
import { installGeometrieSchicht } from "../map/geometrie/schicht";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import { createWegeditorDaten } from "./wegeditor-daten";
import { WEGEDITOR, type WegBearbeitung, type WegeditorSteuerung } from "./wegeditor-steuerung";
import { meldungText, wegName } from "./wegeditor-texte";
import { createWegkurve, type Wegkurve, type WegkurveOptionen } from "./wegkurve";

/**
 * „Wegkurve bearbeiten“ für die Seite (WI-0177): die Steuerung mit Server, Karte, Kamera und Fangradius verbunden, damit `app.vue`
 * nur die Griffe reicht und keine Logik trägt (`app-vue` schmal einhängen).
 *
 * - **Fangradius** aus den Karteneinstellungen (`fangradius`, Panel „Editierverhalten“), gelesen beim Start der Seite.
 * - **Hinflug** nur, wenn nichts vom Weg in der freien Fläche zu sehen ist (`map/geometrie/kamera.ts`, „formmodus A“); dann holt die
 *   Kamera ihn wie die Suche einen Weg (`SEARCH_FIT_MAX_ZOOM.weg`), höchstens eine Stufe hinaus.
 * - **Vereinfachen** (W3) zeichnet mit der gemeinsamen Schicht des Geometrie-Moduls, ohne Besitzer im Koordinator: Es gibt nichts zu
 *   ziehen. Der Maßstab (Karteneinheiten je Bildpunkt) gilt in der Mitte des Wegs, waagrecht und senkrecht gemittelt.
 * - **Kacheln** nach jeder Quittung über die Kachelrevision der Seite.
 * - **Tasten** des Entwurfs (T27 (7)): Strg+Z und Strg+Y (Mac ⌘, auch Strg+Umschalt+Z) gehen zurück und vor, Enter ist „Fertig“; nie
 *   in einem Textfeld. Esc hängt die Seite in ihre Kaskade (Stufe `action`), wie bei „Ecken bearbeiten“.
 * - **Meldungen** (gespeichert samt Anschlüssen, gesperrt, verworfen …) erscheinen als Hinweis unten; Konflikt und Ablehnung beim
 *   Schreiben zeigt die Bearbeitung der Straße in ihrem Fenster und in der Leiste.
 * - **Das Fenster trägt die Form** (W5b Schritt 3, wie bei der Kraftlinie): Wird das Fenster der Straße abgelegt oder geschlossen, oder
 *   steht dort eine andere Bearbeitung, hängt die Form ab; der Entwurf bleibt (D19, G5).
 * - **Testeinstieg:** Im Entwicklungsbuild liegt die Steuerung als `globalThis.avesmapsWegkurve`; bis W2 (Register und Rechtsklick,
 *   EDIT-0003 §6) startet nur der Browsertest den Modus. Im Release gibt es das Handle nicht.
 */

export interface WegkurveSeite {
    /** Die Karte, sobald sie bereit ist; vorher startet kein Modus. */
    karte(): MapLibreMap | undefined;
    interaction(): MapInteractionCoordinator | undefined;
    camera(): Pick<Camera, "showBounds"> | undefined;
    /** Die EINE Sperre der Seite (EDIT-0003 §4), geteilt von allen Editoren. */
    sperre: EditorSperre;
    /** Nach dem Speichern: Wege mit der Revision der Quittung neu laden. */
    geaendert(revision: number): void;
    /** Rechtsklick auf einen Stützpunkt im Modus: das Kartenmenü am Griff zeigen (T24 (3)). */
    griffMenue?: WegkurveOptionen["griffMenue"];
    /** Die Bearbeitung der Straße eines Abschnitts; öffnet ihr Fenster (`WegeditorSteuerung.bearbeitungFuer`). */
    bearbeitung(abschnitt: string): Promise<WegBearbeitung | undefined>;
    /** Die sichtbaren Ebenen der Derographie: deren Flächen sind Ziele eines Flusses (`sichtbareEbenen`); ohne Angabe alle drei. */
    ebenen?: WegkurveOptionen["ebenen"];
}

const space = AVENTURIA.coordinateSpace;

/** Die Tasten des Entwurfs; `true`, wenn die Taste dem Modus galt. */
function taste(kurve: Wegkurve, event: KeyboardEvent): boolean {
    if (kurve.laufend.value?.phase !== "bereit") return false;
    const ziel = event.target as HTMLElement | null;
    // Der Regler beim Vereinfachen ist kein Textfeld: Auch mit ihm in der Hand gehen Enter, Strg+Z und Strg+Y.
    // Nur dieser Regler, kein anderer auf der Seite (ein Regler im Menüband bleibt seins).
    const regler = ziel?.id === "vereinfachen-staerke";
    if (!regler && ziel?.closest("input, textarea, select, [contenteditable='true']")) return false;
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        void kurve.fertig();
        return true;
    }
    if (!(event.ctrlKey || event.metaKey)) return false;
    const k = event.key.toLowerCase();
    if (k !== "z" && k !== "y") return false;
    if (k === "y" || event.shiftKey) kurve.wieder();
    else kurve.zurueck();
    return true;
}

export function createWegkurveFuerSeite(
    seite: WegkurveSeite,
    steuerung: Pick<WegeditorSteuerung, "fenster" | "bearbeitungVon">,
): Wegkurve {
    const kurve = createWegkurve({
        bearbeitung: (abschnitt) => seite.bearbeitung(abschnitt),
        daten: createWegeditorDaten(),
        fangradius: () => startansicht().fangradius,
        ladefehler: () => t("wegeditor.wegkurve.ladefehler"),
        nameVon: wegName,
        sperre: seite.sperre,
        ...(seite.griffMenue ? { griffMenue: seite.griffMenue } : {}),
        ...(seite.ebenen ? { ebenen: seite.ebenen } : {}),
        karte: {
            ein(eingabe) {
                const map = seite.karte();
                const interaction = seite.interaction();
                // Das Wege-Fenster zieht seine Liste ein, solange die Wegkurve läuft (Liste beim Modus, `besitzer.ts`).
                return map && interaction
                    ? installGeometrieModus(map, interaction, { ...eingabe, werkzeug: WEGEDITOR })
                    : undefined;
            },
            vorschau(bild) {
                const map = seite.karte();
                if (!map) return undefined;
                // Auch die Vorschau ist ein Modus des Moduls: Läuft schon einer, beginnt sie nicht (Hinweis aus `besitzer.ts`).
                const belegung = belegeGeometrie();
                if (belegung === undefined) return undefined;
                const schicht = installGeometrieSchicht(map);
                schicht.zeige(bild());
                // Ohne Anfasser gibt es nichts zu sperren und keinen Zug abzubrechen.
                return {
                    aktualisiere: () => schicht.zeige(bild()),
                    markiere: () => undefined,
                    sperre: () => undefined,
                    abbrechen: () => false,
                    aus: () => {
                        schicht.entferne();
                        belegung.frei();
                    },
                };
            },
            massstab(punkte) {
                const map = seite.karte();
                const mitte = punkte[Math.floor(punkte.length / 2)];
                if (!map || mitte === undefined) return 1;
                const render = toRenderLngLat(space, mitte);
                const at = map.project([render.lng, render.lat]);
                const weite = (dx: number, dy: number): number => {
                    const p = fromRenderLngLat(space, map.unproject([at.x + dx, at.y + dy]));
                    return Math.hypot(p.x - mitte.x, p.y - mitte.y);
                };
                return (weite(1, 0) + weite(0, 1)) / 2;
            },
            zeige(punkte) {
                const map = seite.karte();
                const camera = seite.camera();
                // `map/geometrie/kamera.ts`: nur, wenn der Abschnitt gar nicht zu sehen ist (seit „formmodus A“ für alle Formmodi).
                if (map && camera) zeigeFrei(map, camera, [{ art: "linie", punkte }], SEARCH_FIT_MAX_ZOOM.weg);
            },
            geaendert: (revision) => {
                if (revision !== undefined) seite.geaendert(revision);
            },
        },
    });
    const stopTraeger = watch(
        () => {
            const bearbeitung = kurve.laufend.value?.bearbeitung;
            if (bearbeitung === undefined) return true;
            const traeger = steuerung.fenster.value.find((eintrag) => eintrag.gegenstand === bearbeitung.id);
            return (
                traeger !== undefined &&
                traeger.lage !== "versenkt" &&
                steuerung.bearbeitungVon(bearbeitung.id) === bearbeitung
            );
        },
        (getragen) => {
            if (!getragen) kurve.haengeAb();
        },
    );
    const tasten = (event: KeyboardEvent): void => {
        if (taste(kurve, event)) event.preventDefault();
    };
    document.addEventListener("keydown", tasten);
    const stopMeldung = watch(kurve.meldung, (meldung) => {
        if (meldung === undefined) return;
        const ton = meldung.art === "gespeichert" ? "success" : meldung.art === "verworfen" ? "normal" : "warning";
        showToast(meldungText(meldung), ton);
    });
    const seiteKurve: Wegkurve = {
        ...kurve,
        destroy() {
            document.removeEventListener("keydown", tasten);
            stopTraeger();
            stopMeldung();
            kurve.destroy();
        },
    };
    if (import.meta.env.DEV) (globalThis as unknown as { avesmapsWegkurve?: Wegkurve }).avesmapsWegkurve = seiteKurve;
    return seiteKurve;
}
