/**
 * Eigene Höhen an Flüssen und Seen eines Gebirges (WI-0249; Vali 2026-10-25: „die höhe von seen und flüssen, welche das gebirge durchqueren,
 * sollen ebenfalls in ihrer höhe verändert werden können … durchquert ein fluss einen see, gilt für die beiden an der stelle nur die höhe des
 * sees“; Vali wählte A, 2026-10-26): gespeichert je Gebirge nach Lage, wirksam nur im Gelände der Fassung 19.
 *
 * - **Fluss:** eine Höhe an einem Stützpunkt seiner Linie (Lage des Stützpunkts). Zwischen zwei Stützpunkten mit eigener Höhe läuft der Fluss
 *   linear über die Bogenlänge von einer zur anderen, wie ein Kamm zwischen seinen Punkten (P9); ein einzelner gesetzter Stützpunkt gilt an
 *   seiner Stelle. Dort heben die Werte „Flüsse fallen“ auf; außerhalb gilt die Regel unverändert.
 * - **See:** eine Höhe für den ganzen Spiegel, gespeichert am Platz des Sees (`seePlatz`). Sie hebt „der tiefste Zufluss bestimmt die
 *   Seehöhe“ für diesen See auf. Ein Stützpunkt eines Flusses in einem See zählt nicht: Dort gilt die Höhe des Sees.
 *
 * Reine Rechnung ohne Raster für Editor, Saat und Gelände.
 */
import { pointInGeometry } from "../geometry.ts";
import type { V12Geometry } from "../types.ts";
import type { WasserHoehe } from "./netz-vertrag.ts";

/** So nah liegt ein gespeicherter Punkt an seiner Stelle (Karteneinheiten): Koordinaten kommen aus derselben Quelle, nur gerundet. */
export const WASSER_LAGE_E = 1e-4;

export const gleicheLage = (
    a: { x: number; y: number },
    b: readonly [number, number] | { x: number; y: number },
): boolean => {
    const [bx, by] = Array.isArray(b)
        ? (b as readonly [number, number])
        : [(b as { x: number }).x, (b as { y: number }).y];
    return Math.abs(a.x - bx) <= WASSER_LAGE_E && Math.abs(a.y - by) <= WASSER_LAGE_E;
};

/** Die Ringe außen je Polygon einer Fläche. */
function aussenRinge(g: V12Geometry): (readonly (readonly [number, number])[])[] {
    const c = g.coordinates as unknown;
    if (g.type === "Polygon") return [(c as [number, number][][])[0] ?? []];
    return (c as [number, number][][][]).map((polygon) => polygon[0] ?? []);
}

/**
 * Der Platz eines Sees: ein Punkt in seiner Fläche, fest aus der Geometrie (für das Speichern nach Lage und den Anfasser im Editor). Die Mitte
 * des größten Rings, wenn sie im See liegt, sonst die Mitte des innersten Rasterpunkts eines 16 × 16-Gitters über ihm (am weitesten vom Rand
 * nach Gitterschritten); ohne Punkt in der Fläche der erste Eckpunkt.
 */
export function seePlatz(g: V12Geometry): { x: number; y: number } {
    const ringe = aussenRinge(g).filter((ring) => ring.length >= 3);
    const flaeche = (ring: readonly (readonly [number, number])[]): number => {
        let a = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
            a += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
        return Math.abs(a / 2);
    };
    const groesster = [...ringe].sort((a, b) => flaeche(b) - flaeche(a))[0];
    if (groesster === undefined) return { x: 0, y: 0 };
    // Die Mitte der Eckpunkte, ohne den wiederholten Schlusspunkt des Rings.
    const ecken =
        groesster.length > 1 && groesster[0]![0] === groesster.at(-1)![0] && groesster[0]![1] === groesster.at(-1)![1]
            ? groesster.slice(0, -1)
            : groesster;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ecken) {
        sx += x;
        sy += y;
    }
    const mitte = { x: sx / ecken.length, y: sy / ecken.length };
    if (pointInGeometry([mitte.x, mitte.y], g)) return mitte;
    const xs = groesster.map(([x]) => x);
    const ys = groesster.map(([, y]) => y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const n = 16;
    const drin: boolean[] = [];
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++)
            drin.push(pointInGeometry([x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)], g));
    let best = -1;
    let tiefe = -1;
    for (let k = 0; k < drin.length; k++) {
        if (!drin[k]) continue;
        const i = k % n;
        const j = (k - i) / n;
        let d = 0;
        while (
            d < n &&
            [
                [i - d - 1, j],
                [i + d + 1, j],
                [i, j - d - 1],
                [i, j + d + 1],
            ].every(([a, b]) => a! >= 0 && b! >= 0 && a! < n && b! < n && drin[b! * n + a!])
        )
            d++;
        if (d > tiefe) {
            tiefe = d;
            best = k;
        }
    }
    if (best < 0) return { x: groesster[0]![0], y: groesster[0]![1] };
    const i = best % n;
    const j = (best - i) / n;
    return { x: x0 + ((i + 0.5) / n) * (x1 - x0), y: y0 + ((j + 0.5) / n) * (y1 - y0) };
}

/** Der Spiegel je See (`null` ohne eigene Höhe): die erste gespeicherte Höhe, deren Lage im See liegt. */
export function seeSpiegel(
    seen: readonly { g?: V12Geometry | null | undefined }[],
    seeHoehen: readonly WasserHoehe[] | undefined,
): (number | null)[] {
    return seen.map((see) => {
        const g = see.g;
        return g ? (seeHoehen?.find((p) => pointInGeometry([p.x, p.y], g))?.h ?? null) : null;
    });
}

/** Ein gesetzter Punkt eines Flusses: Bogenlänge ab dem ersten Stützpunkt (E) und Höhe in Schritt. */
export interface FlussMarke {
    s: number;
    h: number;
}

/** Die Bogenlänge an jedem Stützpunkt einer Linie (E). */
export function bogen(p: readonly (readonly [number, number])[]): number[] {
    const aus = [0];
    for (let i = 1; i < p.length; i++)
        aus.push(aus[i - 1]! + Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]));
    return aus;
}

/** Die gesetzten Stützpunkte eines Flusses in ihrer Folge; Stützpunkte in einem See zählen nicht (dort gilt der See). */
export function flussMarken(
    p: readonly (readonly [number, number])[],
    flussHoehen: readonly WasserHoehe[] | undefined,
    seen: readonly { g?: V12Geometry | null | undefined }[],
): FlussMarke[] {
    if (!flussHoehen?.length) return [];
    const s = bogen(p);
    const aus: FlussMarke[] = [];
    p.forEach((punkt, i) => {
        const gesetzt = flussHoehen.find((w) => gleicheLage(w, punkt));
        if (gesetzt === undefined) return;
        if (seen.some((see) => !!see.g && pointInGeometry([punkt[0], punkt[1]], see.g))) return;
        aus.push({ s: s[i]!, h: gesetzt.h });
    });
    return aus;
}

/**
 * Die Höhe, die ein Fluss an der Bogenlänge `s` trägt: zwischen zwei Marken linear, an einer Marke ihre Höhe (bis `naehe` E von ihr, für die
 * Zelle, in der sie liegt), sonst keine (`undefined`: dort gilt die Regel „Flüsse fallen“).
 */
export function flussHoeheAn(marken: readonly FlussMarke[], s: number, naehe: number): number | undefined {
    if (marken.length === 0) return undefined;
    for (let m = 1; m < marken.length; m++) {
        const a = marken[m - 1]!;
        const b = marken[m]!;
        if (s >= a.s && s <= b.s) return b.s - a.s < 1e-12 ? b.h : a.h + ((b.h - a.h) * (s - a.s)) / (b.s - a.s);
    }
    const naechste = marken.reduce((best, m) => (Math.abs(m.s - s) < Math.abs(best.s - s) ? m : best));
    return Math.abs(naechste.s - s) <= naehe ? naechste.h : undefined;
}
