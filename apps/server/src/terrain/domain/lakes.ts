import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";
import type { StoredRaster } from "../dem-tiles.ts";
import { grid } from "../hydrology/grid.ts";
import type { AreaGeometry, WaterArea } from "../hydrology/water.ts";
import { domainWaterClasses } from "./constraints.ts";
import { lakeBodies, lakeParts, type LakeBody } from "./lake-bodies.ts";
import { fieldOf, type RiverAnchor } from "../river-field.ts";
import type { RiverInputs } from "../river-inputs.ts";
import type { RiverLake } from "../river-network.ts";

/**
 * Jeder See auf seinen einen ebenen Spiegel (WI-0067). Der Spiegel ist der Median der Zellen des Sees: Wenige Zellen,
 * die ein Fluss- oder Uferschnitt gesenkt hat, ziehen den See nicht herab (früher: die tiefste Zelle, und ein einziger
 * gesenkter Randpunkt versenkte eine ganze Fläche). Welche Zellen den Spiegel tragen, bestimmt `lakeBodies`: ein See
 * ist ein zusammenhängendes Gewässer, nicht eine ganze Mehrfachfläche.
 */

/** Die Seen eines Rasters: Gewässer samt Zellen im Gitter der Domain (Zeile 0 im Norden). Gipfelkerne sind nie See. */
export function domainLakeBodies(
    size: number,
    water: readonly WaterArea[],
    anchors: readonly RiverAnchor[],
    islands: readonly AreaGeometry[] = [],
): LakeBody[] {
    const g = grid(size);
    return lakeBodies(g, water, domainWaterClasses(g, water, islands, anchors));
}

/**
 * Die Flusseingaben mit Seen je Polygonteil: ein See ist ein Gewässer, nicht eine ganze Mehrfachfläche. Das Einbrennen
 * kennt so für jeden Teil, den ein Fluss berührt, seinen eigenen Spiegel (die Kennung trägt `#<Teil>`).
 */
export function domainRivers(rivers: RiverInputs): RiverInputs {
    return {
        ...rivers,
        lakes: rivers.lakes.flatMap((lake) => {
            const parts = lakeParts(lake.geometry);
            return parts.map((geometry, index) => ({
                ...lake,
                id: parts.length > 1 ? `${lake.id}#${String(index)}` : lake.id,
                geometry: geometry as RiverLake["geometry"],
            }));
        }),
    };
}

/** Zeile 0 im Süden, wie das gespeicherte Raster, statt Zeile 0 im Norden wie das Gitter. */
export function southIndexOf(size: number, k: number): number {
    return (size - 1 - Math.floor(k / size)) * size + (k % size);
}

/** Alle Seezellen im Index des gespeicherten Rasters: Die Zellen, die das Einbrennen nicht senken darf. */
export function lakeCellSet(size: number, bodies: readonly LakeBody[]): Set<number> {
    const cells = new Set<number>();
    for (const body of bodies) for (const k of body.cells) cells.add(southIndexOf(size, k));
    return cells;
}

/**
 * Die Seen der Domain für das Einbrennen der Flüsse: feste Seen (`lakes: "fixed"` in `burnRivers`), deren Zellen
 * gesperrt sind. Dazu die Seen selbst für `flattenDomainLakes`. Eine Stelle für Ableitung und Prüfung.
 */
export function fixedLakeBurn(
    size: number,
    water: readonly WaterArea[],
    anchors: readonly RiverAnchor[],
    islands: readonly AreaGeometry[] = [],
): { lakes: "fixed"; protectedCells: Set<number>; bodies: LakeBody[] } {
    const bodies = domainLakeBodies(size, water, anchors, islands);
    return { lakes: "fixed", protectedCells: lakeCellSet(size, bodies), bodies };
}

/**
 * Der eigene Spiegel je See (WI-0249, 0230; Vali wählte A, 2026-10-26; nur Fassung 19): der erste gesetzte See-Punkt in seinem Polygonteil, sonst
 * keiner (`undefined`). Ohne Punkte für jeden See keiner.
 */
export function eigeneSeeSpiegel(
    water: readonly WaterArea[],
    bodies: readonly LakeBody[],
    seen: readonly { x: number; y: number; h: number }[] | undefined,
): (number | undefined)[] {
    if (!seen?.length) return bodies.map(() => undefined);
    return bodies.map((body) => {
        const flaeche = water[body.area]?.geometry;
        const teil = flaeche === undefined ? undefined : lakeParts(flaeche)[body.part];
        if (teil === undefined) return undefined;
        const treffer = seen.find((p) => pointInGeometry([p.x, p.y], teil as V12Geometry));
        return treffer === undefined ? undefined : Math.max(0, Math.min(65535, Math.round(treffer.h)));
    });
}

export function flattenDomainLakes(
    raster: StoredRaster,
    water: readonly WaterArea[],
    anchors: readonly RiverAnchor[],
    islands: readonly AreaGeometry[] = [],
    /** Die Seen, wenn der Aufrufer sie schon hat (sie ändern sich zwischen den Runden nicht). */
    bodies: readonly LakeBody[] = domainLakeBodies(raster.width, water, anchors, islands),
    /** Je See ein eigener Spiegel (WI-0249, `eigeneSeeSpiegel`): Er gilt statt des Medians. Ohne ihn wie zuvor. */
    spiegel?: readonly (number | undefined)[],
): { changedCells: number } {
    const locked = fieldOf([raster], anchors).rasters[0]!.locked;
    let changedCells = 0;
    for (const [nr, body] of bodies.entries()) {
        const free: number[] = [];
        for (const k of body.cells) {
            const index = southIndexOf(raster.width, k);
            if (!locked.has(index)) free.push(index);
        }
        if (free.length === 0) continue;
        const values = Uint16Array.from(free, (index) => raster.samples[index]!).sort();
        const level = spiegel?.[nr] ?? values[values.length >> 1]!;
        for (const index of free) {
            if (raster.samples[index] === level) continue;
            raster.samples[index] = level;
            changedCells += 1;
        }
    }
    return { changedCells };
}
