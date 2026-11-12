import type { WikisyncLageRichtung } from "@avesmaps3d/shared";

/**
 * Die Lage zu einer Linie als Halbebene (WI-0257, nach WI-0253 §27 B und `apps/web/src/inhalte/inhalte-regel-lage.ts`, `lageGeometrie`): reine Rechnung, ohne Datenbank.
 *
 * - **Achsen:** Die Karte rechnet `x` nach Osten und `y` nach Norden (`map_domain.axis_x = east`, `axis_y = north`; Thorwal liegt bei `y` 632, Al'Anfa bei 152). Norden ist also `+y`.
 * - **Die Linie:** Ein Ort ergibt die waagerechte (Nord, Süd) oder senkrechte (Ost, West) Linie durch ihn, zwei Orte die Linie durch beide, auf der Karte verlängert. A–B ist B–A.
 * - **Die Seite:** Die Richtung sagt, auf welcher Seite der Linie die Bedingung gilt: die Seite, zu der die Richtung zeigt. Läuft die Linie in der Richtung selbst (ein Nord-Süd-Strich für „nördlich“),
 *   trennt sie nichts, und die Lage trifft nichts (`null`), genau wie die Skizze des Editors keine Fläche färbt.
 * - Die Linie selbst gehört zur Halbebene (geschlossen).
 */

export interface LageOrt {
    readonly x: number;
    readonly y: number;
}

export interface Halbebene {
    /** Ein Punkt auf der Linie (der erste Ort). */
    readonly ax: number;
    readonly ay: number;
    /** Die Richtung der Linie (Einheitsvektor). */
    readonly dx: number;
    readonly dy: number;
    /** Die Normale, die zur gewählten Seite zeigt (Einheitsvektor). */
    readonly nx: number;
    readonly ny: number;
}

/** Wie weit die Halbebene als Viereck über die Orte hinausreicht (die Karte ist 1.024 Einheiten breit). */
export const HALBEBENE_REICHWEITE = 4096;

/**
 * Die Halbebene einer Lage, oder `null`, wo die Richtung quer zur Linie nichts trennt (oder die beiden Orte zusammenfallen).
 */
export function halbebeneVon(richtung: WikisyncLageRichtung, orte: readonly LageOrt[]): Halbebene | null {
    const a = orte[0];
    const b = orte[1];
    if (a === undefined) return null;
    const nordSued = richtung === "nord" || richtung === "sued";
    let dx: number;
    let dy: number;
    if (b === undefined) {
        dx = nordSued ? 1 : 0;
        dy = nordSued ? 0 : 1;
    } else {
        const lang = Math.hypot(b.x - a.x, b.y - a.y);
        if (lang === 0) return null;
        dx = (b.x - a.x) / lang;
        dy = (b.y - a.y) / lang;
    }
    let nx = -dy;
    let ny = dx;
    const seite = { nord: ny, sued: -ny, ost: nx, west: -nx }[richtung];
    if (Math.abs(seite) < 1e-6) return null;
    if (seite < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { ax: a.x, ay: a.y, dx, dy, nx, ny };
}

/** Liegt der Punkt in der Halbebene (die Linie eingeschlossen)? */
export const liegtInHalbebene = (h: Halbebene, x: number, y: number): boolean =>
    h.nx * (x - h.ax) + h.ny * (y - h.ay) >= 0;

const zahl = (wert: number): string => String(Math.round(wert * 1e6) / 1e6);

/** Die Halbebene als Viereck (WKT, SRID 0) für PostGIS; weit genug, um die ganze Karte zu überdecken. */
export function halbebeneAlsWkt(h: Halbebene, reichweite: number = HALBEBENE_REICHWEITE): string {
    const p1 = { x: h.ax - h.dx * reichweite, y: h.ay - h.dy * reichweite };
    const p2 = { x: h.ax + h.dx * reichweite, y: h.ay + h.dy * reichweite };
    const q2 = { x: p2.x + h.nx * reichweite, y: p2.y + h.ny * reichweite };
    const q1 = { x: p1.x + h.nx * reichweite, y: p1.y + h.ny * reichweite };
    const ring = [p1, p2, q2, q1, p1].map((p) => `${zahl(p.x)} ${zahl(p.y)}`).join(", ");
    return `POLYGON((${ring}))`;
}

/**
 * „Zwischen A und B“ (WI-0253 §27 B): zwei Bedingungen mit UND, „südlich von A UND nördlich von B“ mit A als dem nördlicheren Ort – der Streifen zwischen den beiden waagerechten Linien durch
 * A und B. Liegen A und B eher ost-west als nord-süd auseinander (der Unterschied in `x` ist größer als der in `y`), gilt entsprechend „östlich von A UND westlich von B“ mit A als dem
 * westlicheren Ort: der Streifen zwischen den senkrechten Linien. Bei gleichem Abstand gilt nord-süd. Beide Linien gehören dazu. A–B ist B–A.
 *
 * `null`, wo eine der beiden Halbebenen nichts trennt (die Orte fallen zusammen: Der Streifen ist eine Linie ohne Fläche und trifft nichts).
 */
export function zwischenHalbebenen(a: LageOrt, b: LageOrt): readonly [Halbebene, Halbebene] | null {
    if (a.x === b.x && a.y === b.y) return null;
    const nordSued = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    const paar = nordSued
        ? ([halbebeneVon("sued", [a.y >= b.y ? a : b]), halbebeneVon("nord", [a.y >= b.y ? b : a])] as const)
        : ([halbebeneVon("ost", [a.x <= b.x ? a : b]), halbebeneVon("west", [a.x <= b.x ? b : a])] as const);
    const [erste, zweite] = paar;
    return erste === null || zweite === null ? null : [erste, zweite];
}
