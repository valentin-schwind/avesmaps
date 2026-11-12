import type { StoredRaster } from "../dem-tiles.ts";
import { CellHeap } from "../hydrology/flow.ts";
import { grid, LAKE, SEA, type Grid, type Plane } from "../hydrology/grid.ts";
import { distanceTransform, fillArea } from "../hydrology/water.ts";
import { riverChains } from "../hydrology/rivers.ts";
import { domainIslands, domainWaterClasses, summitCores } from "./constraints.ts";
import { distanceInfluence } from "./influence.ts";
import { erodeMountainDetails, type DetailWindow } from "./mountain-detail.ts";
import {
    fragmentReach,
    placeMountainFragments,
    renderMountainFragments,
    type MountainFragments,
} from "./mountain-fragments.ts";
import type { DomainInputs, DomainPeak } from "./inputs.ts";
import type { TerrainRecipe } from "./recipes.ts";
import { components, groupComponents } from "./mountain-groups.ts";
import { releaseIntermediates } from "./memory.ts";
import { alpineWeight, summitFor, type Summit } from "./summit-shape.ts";

/**
 * Gebirgsinnen-Verfeinerung in lokalen Rechengruppen (WI-0067).
 *
 * Verfeinert werden Zellen in aktiven Gebirgen ohne Hügelland, mit Höhe, mehr als drei Zellen von Meer/See
 * und außerhalb der Flusskorridore. Ihre 8-zusammenhängenden Komponenten (diagonal benachbarte Zellen
 * entwässern im D8-Netz ineinander) sind die Bausteine. Eine Gruppe rechnet nur auf ihrem Halo-Bereich: den
 * Zellen höchstens `halo` vom eigenen Gebirge. Überlappen sich die Halos zweier Komponenten, rechnen sie
 * gemeinsam; das wird über Blöcke der Kantenlänge `halo` konservativ entschieden (lieber eine Gruppe zu groß).
 * Damit liest keine Gruppe Zellen, die eine andere schreibt: Ergebnis und Reihenfolge sind unabhängig, an
 * Gruppengrenzen entsteht keine Naht, und fernes Gelände wirkt nicht auf die lokale Hydrologie.
 *
 * Randbedingungen: Zellen außerhalb der verfeinerten Fläche sind fest (Dirichlet). Meer und See kommen aus der
 * Domain-Wassermaske samt Landmaske (Höhe 0 heißt nicht Meer). Der äußere Rand des Halo-Bereichs ist ein
 * offener Abfluss (als Meer markiert, ohne Höhe zu setzen): kein Zufluss von außen, Einzugsfläche und
 * Masserückführung bleiben in der Gruppe. Der Halo deckt die Fragmentreichweite ab und hält diesen Rand von
 * den veränderten Zellen fern.
 */

export interface MountainInteriorReport {
    changedCells: number;
    /** 8-connected components of the refined interior. */
    components: number;
    /** Computation groups after merging components whose halos overlap. */
    groups: number;
    haloCells: number;
    /** Cells of all halo regions together: the hydraulic work area. */
    processedCells: number;
    /** Cells that may change (interior weight > 0). */
    refinedCells: number;
    /** The biggest group: its array extent and its halo region. */
    largest: { width: number; height: number; cells: number } | null;
}

const EMPTY: MountainInteriorReport = {
    changedCells: 0,
    components: 0,
    groups: 0,
    haloCells: 0,
    processedCells: 0,
    refinedCells: 0,
    largest: null,
};

/** The cells within Euclidean distance 3 (cells) of a water cell: lake level sampling reads these banks. */
const BANK: readonly [number, number][] = (() => {
    const offsets: [number, number][] = [];
    for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) offsets.push([dx, dy]);
    return offsets;
})();

/** Real water classes of the whole domain: water polygons, mapped islands as land, non-land as sea. */
export function domainClasses(g: Grid, input: DomainInputs): Uint8Array {
    const classes = domainWaterClasses(g, input.water, domainIslands(input), summitCores(input));
    const land = new Uint8Array(classes.length);
    for (const geometry of input.land)
        fillArea(g, geometry, (k) => {
            land[k] = 1;
        });
    for (let k = 0; k < classes.length; k++) if (!land[k]) classes[k] = SEA;
    return classes;
}

/** Allowed interior cells as a whole-domain mask (grid orientation, row 0 north). */
function interiorMask(g: Grid, raster: StoredRaster, input: DomainInputs, classes: Uint8Array): Uint8Array {
    const mask = new Uint8Array(g.n * g.n);
    for (const area of input.landscapes)
        if (area.layer === "topographie" && area.type === "gebirge")
            fillArea(g, area.geometry, (k) => {
                mask[k] = 1;
            });
    for (const area of input.landscapes)
        if (area.layer === "topographie" && area.type === "huegelland")
            fillArea(g, area.geometry, (k) => {
                mask[k] = 0;
            });
    // Rückennetz-Gebirge bringen ihre Rinnen und Grate mit (`rueckennetz-flaechen.ts`): fester Rand wie das Hügelland.
    for (const gebirge of input.rueckennetz ?? [])
        fillArea(g, gebirge.geometry, (k) => {
            mask[k] = 0;
        });
    return guardWater(g, raster, input, classes, mask);
}

/** Land away from the sea, lake banks and river corridors (grid orientation, row 0 north). */
export function dryLandMask(g: Grid, raster: StoredRaster, input: DomainInputs): Uint8Array {
    return guardWater(g, raster, input, domainClasses(g, input), new Uint8Array(g.n * g.n).fill(1));
}

/** Wie `dryLandMask`, aber mit den Ufern der Seen; die Seen selbst nicht. Das Land, das das Becken eines Sees heben darf (`see-becken.ts`). */
export function seeUferMask(g: Grid, raster: StoredRaster, input: DomainInputs): Uint8Array {
    const classes = domainClasses(g, input);
    const mask = new Uint8Array(g.n * g.n);
    for (let k = 0; k < mask.length; k++) mask[k] = classes[k]! & LAKE ? 0 : 1;
    return guardWater(g, raster, input, classes, mask, SEA);
}

function guardWater(
    g: Grid,
    raster: StoredRaster,
    input: DomainInputs,
    classes: Uint8Array,
    mask: Uint8Array,
    /** Welches Wasser seine Ufer sperrt; ohne Angabe Meer und Seen. */
    ufer: number = SEA | LAKE,
): Uint8Array {
    const n = g.n;
    for (let k = 0; k < mask.length; k++) {
        if (!mask[k]) continue;
        const x = k % n,
            y = Math.floor(k / n);
        if (raster.samples[(n - 1 - y) * n + x] === 0) {
            mask[k] = 0;
            continue;
        }
        // Lake level sampling includes bilinear bank cells, not only centres inside its polygon.
        for (const [dx, dy] of BANK) {
            const nx = x + dx,
                ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < n && ny < n && classes[ny * n + nx]! & ufer) {
                mask[k] = 0;
                break;
            }
        }
    }
    const chains = riverChains(
        g,
        input.rivers.rivers.map((r) => ({ coordinates: r.coordinates, isBach: r.bach, flowDirection: r.direction })),
    );
    for (const chain of chains)
        for (const k of chain.cells) {
            const x = k % n,
                y = Math.floor(k / n);
            // Every bilinear river sample and a full adjacent cell remain unchanged.
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                    if (x + dx >= 0 && y + dy >= 0 && x + dx < n && y + dy < n) mask[(y + dy) * n + x + dx] = 0;
        }
    return mask;
}

/** Local inputs of one group; the base height, the fragment ramp and the region distance end here. */
function prepareWindow(
    g: Grid,
    plane: Plane,
    own: Uint8Array,
    raster: StoredRaster,
    water: Uint8Array,
    fragments: MountainFragments,
    peaks: readonly DomainPeak[],
    params: TerrainRecipe["mountainMorphology"]["interior"],
    haloCells: number,
    seed: number,
): DetailWindow & { region: number } {
    const n = g.n;
    const size = plane.width * plane.height;
    const base = new Float32Array(size);
    const classes = new Uint8Array(size);
    // The halo region: cells at most `haloCells` from this group's own interior. Beyond it the window is an
    // open outlet, so nothing outside the halo can reach the local drainage.
    const distance = new Float32Array(size);
    distanceTransform(plane, (k) => own[k] !== 0, distance);
    let region = 0;
    for (let y = 0; y < plane.height; y++)
        for (let x = 0; x < plane.width; x++) {
            const k = y * plane.width + x,
                gx = plane.x0 + x,
                gy = plane.y0 + y;
            base[k] = raster.samples[(n - 1 - gy) * n + gx]!;
            if (distance[k]! > haloCells) classes[k] = SEA;
            else {
                classes[k] = water[gy * n + gx]! & (SEA | LAKE);
                region++;
            }
        }
    const locked = new Uint8Array(size);
    for (const peak of peaks) {
        const x = Math.floor(peak.x / g.cell - 0.5) - plane.x0;
        const y = n - 2 - Math.floor(peak.y / g.cell - 0.5) - plane.y0;
        for (const dy of [0, 1])
            for (const dx of [0, 1])
                if (x + dx >= 0 && y + dy >= 0 && x + dx < plane.width && y + dy < plane.height)
                    locked[(y + dy) * plane.width + x + dx] = 1;
    }
    const weight = distanceInfluence(plane, own, { inward: params.inward, outward: 0 });
    const inside = distanceInfluence(plane, own, { inward: params.fragments.inward, outward: 0 });
    const alpine = new Float32Array(size);
    for (let k = 0; k < size; k++) if (weight[k]) alpine[k] = alpineWeight(params, base[k]!);
    // Known summits whose core stands in this group's refinable interior get pyramid faces.
    const summits: Summit[] = [];
    for (const peak of peaks) {
        const x = Math.floor(peak.x / g.cell - 0.5) - plane.x0;
        const y = n - 2 - Math.floor(peak.y / g.cell - 0.5) - plane.y0;
        let core = false;
        for (const dy of [0, 1])
            for (const dx of [0, 1])
                if (x + dx >= 0 && y + dy >= 0 && x + dx < plane.width && y + dy < plane.height)
                    core ||= own[(y + dy) * plane.width + x + dx] !== 0;
        if (core) summits.push(summitFor(params, seed, peak.x, peak.y, Math.round(peak.h!), peak.volcano === true));
    }
    const height = new Float32Array(size);
    // Fragments centred on this group's own cells; every other group is farther away than their reach.
    renderMountainFragments(plane, fragments, height, (centre) => {
        const x = (centre % n) - plane.x0,
            y = Math.floor(centre / n) - plane.y0;
        return x >= 0 && y >= 0 && x < plane.width && y < plane.height && own[y * plane.width + x] !== 0;
    });
    for (let k = 0; k < size; k++) {
        // Same float32 steps as the former whole-grid form: fragments, then weighted blend.
        const fragmented = Math.fround(base[k]! + height[k]! * inside[k]!);
        height[k] = locked[k] ? base[k]! : base[k]! + weight[k]! * (fragmented - base[k]!);
    }
    return {
        plane,
        height,
        weight,
        locked,
        classes,
        region,
        alpine: { weight: alpine, grade: params.alpine.maximumGrade, summits },
    };
}

/** The refinable interior (grid orientation) and the real water classes it was cut from. */
export interface MountainInterior {
    mask: Uint8Array;
    /** Low bits SEA/LAKE; other bits are ignored. */
    classes: Uint8Array;
}

/**
 * The refinable interior, or none when the refinement is off or the grid cannot resolve even its widest
 * detail (a coarse diagnostic grid must not erode a bare macroseed instead). `classes` may pass the domain's
 * real water classes to avoid rasterizing them again.
 */
export function mountainInterior(
    raster: StoredRaster,
    input: DomainInputs,
    recipe: TerrainRecipe,
    classes?: Uint8Array,
): MountainInterior | undefined {
    const params = recipe.mountainMorphology.interior;
    const g = grid(raster.width);
    if (params.iterations === 0 || params.fragments.radiusMaximum < 2 * g.cell) return undefined;
    const water = classes ?? domainClasses(g, input);
    return { mask: interiorMask(g, raster, input, water), classes: water };
}

/**
 * Nur ausgewählte Gruppen (WI-0223, die grobe Stufe im Umkreis): `select` entscheidet am Fenster einer Gruppe, `written` (gespeicherte
 * Ausrichtung, eine Zelle je Rasterzelle) bekommt eine 1 an jeder Zelle, die eine gerechnete Gruppe schrieb, `skipped` an jeder Zelle
 * im Inneren einer übergangenen.
 */
export interface InteriorSelection {
    select: (plane: Plane) => boolean;
    written: Uint8Array;
    /** Bekommt eine 1 an jeder Zelle des eigenen Inneren einer nicht gerechneten Gruppe (gespeicherte Ausrichtung). */
    skipped?: Uint8Array;
}

/** Refine only mountain interiors; the accepted hill/foothill and water surfaces are fixed boundaries. */
export function refineMountainInterior(
    raster: StoredRaster,
    input: DomainInputs,
    recipe: TerrainRecipe,
    interior: MountainInterior | undefined = mountainInterior(raster, input, recipe),
    only?: InteriorSelection,
): MountainInteriorReport {
    const params = recipe.mountainMorphology.interior;
    if (!interior) return { ...EMPTY };
    const { mask, classes: water } = interior;
    const g = grid(raster.width);
    const n = g.n;
    if (!(params.halo >= fragmentReach(params.fragments)))
        throw new RangeError("Mountain interior halo must cover the fragment reach");
    const sourceIndex = (k: number) => (n - 1 - Math.floor(k / n)) * n + (k % n);
    const fragments = placeMountainFragments(
        g,
        mask,
        (k) => raster.samples[sourceIndex(k)]!,
        params.fragments,
        recipe.generator.seed + 101,
        (seedHeight) => params.alpine.crest * alpineWeight(params, seedHeight),
    );
    const found = components(n, mask);
    const haloCells = Math.ceil(params.halo / g.cell);
    const groups = groupComponents(n, found, haloCells);
    const report: MountainInteriorReport = {
        ...EMPTY,
        components: found.starts.length - 1,
        groups: groups.length,
        haloCells,
    };
    const peaks = input.peaks.filter((peak) => peak.h !== null && peak.h > 0);
    const heap = new CellHeap(1024);
    // Serial on purpose: the peak memory is one group at a time (WI-0067 P6). Groups are independent.
    for (const members of groups) {
        // The previous group's window arrays are out of scope here.
        releaseIntermediates();
        let x0 = n,
            y0 = n,
            x1 = -1,
            y1 = -1;
        for (const c of members)
            for (let i = found.starts[c]!; i < found.starts[c + 1]!; i++) {
                const k = found.cells[i]!;
                x0 = Math.min(x0, k % n);
                x1 = Math.max(x1, k % n);
                y0 = Math.min(y0, Math.floor(k / n));
                y1 = Math.max(y1, Math.floor(k / n));
            }
        x0 = Math.max(0, x0 - haloCells);
        y0 = Math.max(0, y0 - haloCells);
        const plane: Plane = {
            x0,
            y0,
            width: Math.min(n - 1, x1 + haloCells) - x0 + 1,
            height: Math.min(n - 1, y1 + haloCells) - y0 + 1,
            cell: g.cell,
        };
        if (only && !only.select(plane)) {
            if (only.skipped)
                for (const c of members)
                    for (let i = found.starts[c]!; i < found.starts[c + 1]!; i++) {
                        const k = found.cells[i]!;
                        only.skipped[(n - 1 - Math.floor(k / n)) * n + (k % n)] = 1;
                    }
            continue;
        }
        const own = new Uint8Array(plane.width * plane.height);
        const pools = new Int32Array(own.length);
        members.forEach((c, pool) => {
            for (let i = found.starts[c]!; i < found.starts[c + 1]!; i++) {
                const k = found.cells[i]!;
                const local = (Math.floor(k / n) - y0) * plane.width + (k % n) - x0;
                own[local] = 1;
                pools[local] = pool + 1;
            }
        });
        const { region, ...window } = prepareWindow(
            g,
            plane,
            own,
            raster,
            water,
            fragments,
            peaks,
            params,
            haloCells,
            recipe.generator.seed,
        );
        const { height, weight, locked } = window;
        erodeMountainDetails({ ...window, pools }, params, recipe.generator.seed, recipe.generator, heap);
        for (let y = 0; y < plane.height; y++)
            for (let x = 0; x < plane.width; x++) {
                const k = y * plane.width + x;
                if (!weight[k] || locked[k]) continue;
                report.refinedCells++;
                const value = Math.round(height[k]!);
                if (!Number.isFinite(value) || value < 0 || value > 65535)
                    throw new Error("Invalid mountain interior height");
                const index = (n - 1 - (y0 + y)) * n + x0 + x;
                if (value !== raster.samples[index]) report.changedCells++;
                raster.samples[index] = value;
                if (only) only.written[index] = 1;
            }
        report.processedCells += region;
        if (!report.largest || plane.width * plane.height > report.largest.width * report.largest.height)
            report.largest = { width: plane.width, height: plane.height, cells: region };
    }
    return report;
}
