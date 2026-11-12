import type { Punkt } from "./geometrie";

/**
 * Vereinfachen: weniger Stützpunkte bei gleicher Gestalt (WI-0177 W3; Wunsch des Betreibers 2026-10-16, EDIT-0003 T24; Probierblatt P5,
 * `review/wegeditor/probe/vereinfachen.js`). Rein rechnend, ohne Karte. Nach Regel 7 dieselbe Rechnung für „Wegkurve vereinfachen“,
 * später „Fläche vereinfachen“ (`geschlossen`) und die Kraftlinien.
 *
 * - **Verfahren** Visvalingam-Whyatt: Nacheinander fällt der Punkt weg, dessen Dreieck mit den Nachbarn die kleinste Fläche hat, bis
 *   jedes übrige Dreieck größer ist als die Schwelle. Das rundet ruhig; Douglas-Peucker (im Probierblatt zum Vergleich) wirkt kantiger.
 * - **Toleranz** in den Einheiten der Punkte: die Höhe eines Dreiecks über der mittleren Seite des Stücks (wie im Probierblatt, damit
 *   dieselbe Stärke dasselbe wegnimmt). 0 nimmt nichts weg.
 * - 🔴 **Feste Punkte** bleiben, wo sie sind (Betreiber 2026-10-16, „Nein, fest“: Punkte, an denen andere Wege oder Orte hängen): Die
 *   Linie wird an ihnen geteilt, jedes Stück für sich vereinfacht. Die Enden einer Linie sind immer fest.
 * - **Ring:** Ohne zwei feste Punkte bekommt er Anker (einen festen oder den ersten Punkt und den fernsten davon); es bleiben immer drei.
 */

export interface VereinfachenOptionen {
    /** Indizes, die bleiben. */
    readonly fest?: readonly number[];
    /** Ein Ring: Der letzte Punkt schließt an den ersten an (ohne Wiederholung des ersten). */
    readonly geschlossen?: boolean;
}

const abstand = (a: Punkt, b: Punkt): number => Math.hypot(a.x - b.x, a.y - b.y);

const dreieck = (a: Punkt, b: Punkt, c: Punkt): number =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

/** Der Abstand eines Punkts zur Strecke von `a` nach `b`. */
function zurStrecke(p: Punkt, a: Punkt, b: Punkt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = dx * dx + dy * dy;
    if (l === 0) return abstand(p, a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Visvalingam-Whyatt über ein Stück (Indizes in `pts`, beide Enden bleiben); fügt die behaltenen zu `behalten`. */
function stueck(pts: readonly Punkt[], von: number, bis: number, toleranz: number, behalten: Set<number>): void {
    const liste = Array.from({ length: bis - von + 1 }, (_, i) => von + i);
    let seiten = 0;
    for (let i = 1; i < liste.length; i++) seiten += abstand(pts[liste[i]!]!, pts[liste[i - 1]!]!);
    const schwelle = toleranz * (seiten / Math.max(1, liste.length - 1));
    while (liste.length > 2) {
        let kleinste = Infinity;
        let wo = -1;
        for (let i = 1; i < liste.length - 1; i++) {
            const f = dreieck(pts[liste[i - 1]!]!, pts[liste[i]!]!, pts[liste[i + 1]!]!);
            if (f < kleinste) {
                kleinste = f;
                wo = i;
            }
        }
        if (kleinste > schwelle) break;
        liste.splice(wo, 1);
    }
    for (const i of liste) behalten.add(i);
}

/** Die behaltenen Indizes, aufsteigend. */
export function vereinfachteIndizes(
    punkte: readonly Punkt[],
    toleranz: number,
    optionen: VereinfachenOptionen = {},
): number[] {
    const n = punkte.length;
    const geschlossen = optionen.geschlossen === true;
    const alle = (): number[] => punkte.map((_, i) => i);
    if (n <= (geschlossen ? 3 : 2) || !(toleranz > 0)) return alle();
    const behalten = new Set((optionen.fest ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < n));
    if (!geschlossen) {
        behalten.add(0);
        behalten.add(n - 1);
    } else if (behalten.size < 2) {
        const anker = behalten.size === 1 ? [...behalten][0]! : 0;
        let fern = anker;
        let weit = -1;
        punkte.forEach((p, i) => {
            const a = abstand(p, punkte[anker]!);
            if (a > weit) {
                weit = a;
                fern = i;
            }
        });
        behalten.add(anker);
        behalten.add(fern);
    }
    const anker = [...behalten].sort((a, b) => a - b);
    // Die Stücke zwischen zwei Ankern; beim Ring auch das vom letzten über das Ende zum ersten (Indizes über n hinaus, modulo n).
    const stuecke = anker.slice(0, -1).map((a, i): [number, number] => [a, anker[i + 1]!]);
    if (geschlossen) stuecke.push([anker.at(-1)!, anker[0]! + n]);
    const pts = geschlossen ? [...punkte, ...punkte] : punkte;
    const mehr = new Set<number>();
    for (const [von, bis] of stuecke) stueck(pts, von, bis, toleranz, mehr);
    for (const i of mehr) behalten.add(i % n);
    // Ein Ring aus zwei Punkten ist keiner: der Punkt, der am weitesten von der Strecke zwischen beiden liegt, bleibt dazu.
    if (geschlossen && behalten.size < 3) {
        const [a, b] = [...behalten].map((i) => punkte[i]!);
        let dazu = -1;
        let weit = -1;
        punkte.forEach((p, i) => {
            if (behalten.has(i)) return;
            const d = zurStrecke(p, a!, b ?? a!);
            if (d > weit) {
                weit = d;
                dazu = i;
            }
        });
        if (dazu >= 0) behalten.add(dazu);
    }
    return [...behalten].sort((a, b) => a - b);
}

/** Dieselbe Rechnung, zurück die Punkte selbst. */
export function vereinfacht(punkte: readonly Punkt[], toleranz: number, optionen: VereinfachenOptionen = {}): Punkt[] {
    return vereinfachteIndizes(punkte, toleranz, optionen).map((i) => punkte[i]!);
}
