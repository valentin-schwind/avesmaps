import {
    RING_MINDESTENS,
    abweichendeEcke,
    bereinigeRinge,
    type RingPolygone,
    type RingPunkt,
} from "@avesmaps3d/shared";

/**
 * Ringe als GeoJSON für den Server (WI-0209 C2; gehoben aus `landscape-reshape.ts`, WI-0178 C2). Die Regeln an Ringen (bereinigen,
 * Nachbarn, gleich) stehen seit 2026-11-10 in `@avesmaps3d/shared` (`flaechen-ringe.ts`), damit der Editor jeden Schritt mit derselben
 * Rechnung prüft, mit der der Server „Fertig“ prüft. Diese Datei reicht sie unter den bisherigen Namen weiter.
 *
 * - Ringe stehen ohne Schlusspunkt, je Polygon zuerst außen, dann die Löcher (wie `EditorLandscapeArea.polygons`).
 * - 🔴 **Keine Rundung der Koordinaten:** Unveränderte Ecken bleiben bitgenau.
 */

export {
    bereinigeRinge as bereinige,
    gleicheRinge as gleich,
    mitGemeinsamenEcken,
    mitgezogeneEcken as mitgezogen,
    ringSchluessel as schluessel,
} from "@avesmaps3d/shared";

export type Punkt = RingPunkt;
export type Polygone = RingPolygone;

/** Die Polygone einer Fläche aus ihrem GeoJSON, Ringe ohne Schlusspunkt. */
export function polygoneVon(geojson: string): Punkt[][][] {
    const g = JSON.parse(geojson) as { type: string; coordinates: unknown };
    const vieleck = (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]) as [number, number][][][];
    return vieleck.map((polygon) => polygon.map((ring) => ring.slice(0, -1).map(([x, y]) => [x, y] as const)));
}

/** Als GeoJSON zum Schreiben: geschlossene Ringe, ein Polygon oder mehrere. */
export function geojsonAus(polygone: Polygone): string {
    const zu = polygone.map((polygon) => polygon.map((ring) => [...ring, ring[0]!].map(([x, y]) => [x, y])));
    return JSON.stringify(
        zu.length === 1 ? { type: "Polygon", coordinates: zu[0] } : { type: "MultiPolygon", coordinates: zu },
    );
}

/** Ecken als Zeilen fürs Protokoll. */
export const ringe = (polygone: Polygone): number[][][][] =>
    polygone.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y])));

/**
 * Wo eine Nachbarin mehr als die gemeinsamen Ecken verlöre (die Marke zu `nachbar_umgezeichnet`): die erste abweichende Ecke ihrer Ringe
 * (`abweichendeEcke`), bei anderem Aufbau ihre erste neue Ecke. `neu` ist bereinigt.
 */
export function abweichung(
    alt: Polygone,
    neu: Polygone,
    eigeneAlt: ReadonlySet<string>,
    eigeneNeu: ReadonlySet<string>,
): Punkt | undefined {
    const sauber = bereinigeRinge(alt);
    for (let p = 0; p < Math.min(sauber.length, neu.length); p += 1)
        for (let r = 0; r < Math.min(sauber[p]!.length, neu[p]!.length); r += 1) {
            const ecke = abweichendeEcke(sauber[p]![r]!, neu[p]![r]!, eigeneAlt, eigeneNeu);
            if (ecke !== undefined) return ecke;
        }
    return neu[0]?.[0]?.[0];
}

/** Der erste Ring unter drei Ecken (nach `bereinige`) und eine Ecke dazu, für die Marke; `undefined`, wenn jeder Ring genug hat. */
export function zuKurzerRing(bereinigt: Polygone, roh: Polygone): { stelle: Punkt | undefined } | undefined {
    for (let p = 0; p < bereinigt.length; p += 1)
        for (let r = 0; r < bereinigt[p]!.length; r += 1)
            if (bereinigt[p]![r]!.length < RING_MINDESTENS) return { stelle: bereinigt[p]![r]![0] ?? roh[p]?.[r]?.[0] };
    return undefined;
}

/** Was an einer ungültigen Form falsch ist (`ST_IsValidDetail(…).reason`); die Übersetzung steht in `@avesmaps3d/shared`. */
export { formFehlerArt, type FormFehlerArt } from "@avesmaps3d/shared";
