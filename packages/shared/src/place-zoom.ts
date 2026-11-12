import { appearanceBand, renderZoomForBand } from "./zoom-bands.ts";
import { AVENTURIA_ZOOM_BANDS } from "./zoom-bands-registry.ts";

/**
 * Wie nah die Karte an einen Ort heranfährt, damit man ihn sinnvoll erkennt (WI-0013, WI-0039).
 *
 * 🔴 Die EINE Regel für „zeige mir diesen Ort“: Suche, einzelner Wegpunkt, Ortsname in der
 * Etappenliste, „Nächster Ort“. Die Kamera fährt nie heraus, wenn man schon näher ist
 * (Betreiber 2026-09-26: `zielZoom = max(aktuellerZoom, empfohlenerZoomDesOrtes)`); diese Zahl ist
 * nur die Mindestnähe.
 *
 * 🪤 NICHT eine feste Zahl je Art. Die Zoombänder wissen bereits, ab wann eine Klasse überhaupt
 * erscheint — eine Metropole ab Band 0, ein Gebäude ab Band 3. Wer hier eine eigene Tabelle
 * aufmacht, führt dieselbe Aussage zweimal und muss sie zweimal pflegen.
 *
 * ⭐ Zwei Bänder ÜBER der Erscheinungsstufe: auf der Erscheinungsstufe ist der Ort ein Punkt am
 * Rand der Sichtbarkeit. Man sucht ihn, weil man ihn ansehen will.
 *
 * 💣 UND EIN BODEN, sonst kehrt sich die Regel gegen sich selbst. Eine Metropole erscheint ab Band
 * 0, plus Reserve also Band 2 — gemessen landete die Suche nach „Gareth" bei z3, über dem halben
 * Kontinent. Je bedeutender der Ort, desto weiter weg: genau verkehrt. Wer etwas sucht, will es
 * ansehen, und das gilt für die Hauptstadt wie für das Dorf.
 */
export const PLACE_ZOOM_HEADROOM = 2;
/** Näher als hierhin fährt die Karte immer heran, egal wie früh die Klasse erscheint. */
export const PLACE_ZOOM_FLOOR = 4;
/** Das höchste Band, auf das ein Ort gerückt wird. */
const PLACE_ZOOM_CEILING = 8;

/** Die Mindestnähe eines Orts dieser Klasse, als MapLibre-Zoom. Eine unbekannte Klasse gilt als spät erscheinend. */
export function placeNearZoom(subtype: string | null | undefined): number {
    const series =
        subtype === null || subtype === undefined
            ? undefined
            : (AVENTURIA_ZOOM_BANDS.label[subtype] ?? AVENTURIA_ZOOM_BANDS.marker[subtype]);
    const band = series ? appearanceBand(series) : null;
    const target = Math.max((band ?? PLACE_ZOOM_FLOOR) + PLACE_ZOOM_HEADROOM, PLACE_ZOOM_FLOOR);
    return renderZoomForBand(Math.min(PLACE_ZOOM_CEILING, target));
}
