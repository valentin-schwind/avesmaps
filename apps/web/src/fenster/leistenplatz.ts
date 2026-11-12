import { MIN_TARGET_GAP, visibleRect } from "../map/camera/visible-area";

/**
 * Wo die Leiste eines Modus steht: über der Karte oder unten im angedockten Fenster (EDIT-0003 T45 (3); Festlegung der Editor-Orchestrierung
 * 2026-10-19 nach der Bedienprobe, wörtlich: „Das Fenster sprang beim Wechsel der Breite um, und ‚Fertig‘ wanderte zwischen unten und
 * oben. Zweimal traf mein Klick daneben.“).
 *
 * - **Platz über der Karte** heißt: Neben Planer und angedocktem Fenster bleibt so viel Breite, wie die Leiste in EINER Zeile braucht,
 *   dazu die Laschen „Routenplaner“ und „Info“ samt Abstand an beiden Seiten (`LASCHEN_RAND`, wie `.modusbuehne`). Die Breite misst
 *   die Leiste selbst (`meldeLeistenbreite`); ohne Messung gilt die Lücke eines Hinflugziels (`MIN_TARGET_GAP`).
 * - **Einmal gewählt** (`neu`), wenn die Leiste erscheint: über der Karte, wenn sie dort Platz hat, sonst im Fenster.
 * - **Behalten** (`sonst`), solange die Bearbeitung läuft: Ein- und ausfahrende Listen, Breitenwechsel des Fensters und Kamerabewegungen
 *   holen sie nie auf die Karte. Nur wenn das Fenster über sie wächst und sie auf der Karte keinen Platz mehr hat, geht sie ins Fenster:
 *   sonst läge „Fertig“ unter Fenster oder Lasche (Bedienprobe 1600 px mit offener Liste). Zurück auf die Karte führt das nicht.
 * - **Neu gewählt mit der Größe des Browserfensters** (`groesse`), mit Abstand zur Grenze (`LEISTE_ABSTAND`): Aus dem Fenster auf die
 *   Karte erst, wenn die Lücke um so viel breiter ist als nötig; von der Karte ins Fenster, sobald sie nicht mehr reicht. Dazwischen
 *   bleibt sie, wo sie ist; so flattert sie an der Grenze nicht.
 * - Ohne angedocktes Fenster steht sie immer über der Karte.
 */
export type Leistenplatz = "karte" | "fenster";
export type LeistenAnlass = "neu" | "groesse" | "sonst";

/** Um so viele Bildpunkte muss die Lücke breiter sein als nötig, bevor die Leiste aus dem Fenster auf die Karte wechselt. */
export const LEISTE_ABSTAND = 80;
/** Links und rechts der Leiste über der Karte: Lasche (30) und Abstand (12), wie das Polster von `.modusbuehne`. */
export const LASCHEN_RAND = 2 * (30 + 12);

export function leistenplatz(
    vorher: Leistenplatz | undefined,
    anlass: LeistenAnlass,
    groesse: { width: number; height: number },
    bedeckt: { top?: number; right?: number; bottom?: number; left?: number },
    fensterAngedockt: boolean,
    /** Die Breite der Leiste in einer Zeile; 0: unbekannt. */
    breite = 0,
): Leistenplatz {
    if (!fensterAngedockt) return "karte";
    const frei = visibleRect(groesse, bedeckt);
    const noetig = breite > 0 ? breite + LASCHEN_RAND : MIN_TARGET_GAP.width;
    const hoch = frei.height > MIN_TARGET_GAP.height;
    const platz = hoch && frei.width > noetig;
    if (vorher === undefined || anlass === "neu") return platz ? "karte" : "fenster";
    if (vorher === "karte") return platz ? "karte" : "fenster";
    if (anlass === "sonst") return "fenster";
    return hoch && frei.width > noetig + LEISTE_ABSTAND ? "karte" : "fenster";
}

/** Die gemessenen Breiten der Leisten, die gerade stehen (meist eine). */
const breiten = new Map<symbol, number>();

/** Eine Leiste meldet ihre Breite in einer Zeile; `undefined` meldet sie ab. */
export function meldeLeistenbreite(wer: symbol, px: number | undefined): void {
    if (px === undefined) breiten.delete(wer);
    else breiten.set(wer, px);
}

/** Die Breite der breitesten Leiste, die gerade steht; 0 ohne Messung. */
export function leistenbreite(): number {
    return Math.max(0, ...breiten.values());
}
