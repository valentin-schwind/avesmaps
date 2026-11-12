import type { Queryable } from "../database.ts";
import type { RouteLink } from "./network.ts";
import {
    cellAt,
    LANDING_REACH,
    nearestWaterCell,
    type Landing,
    type NavigableWater,
    type SeaGrid,
} from "./sea-grid.ts";
import type { SeaSearch } from "./sea-search.ts";
import { areaIndexAt, areasNear } from "./water.ts";

/**
 * Häfen und ihre Anlegestellen für das freie Seerouting (WI-0046, M2 A, H1):
 *
 * - **Ein Hafen ist ein Ort mit `place.is_seaport`** - Legacys Häkchen, automatisch an Seewegen, sonst
 *   von Editoren gesetzt (WI-0041).
 * - **Seine Anlegestelle ist nach der Regel das nächste befahrbare Wasser** (`nearestWaterCell`), höchstens
 *   drei Einheiten entfernt. Das Stück vom Hafen zur Anlegestelle gehört zur Seeetappe.
 * - **Wo die Regel das falsche Wasser trifft, braucht der Hafen eine gespeicherte Anlegestelle.** Solange
 *   es die Seewege gibt, zeigen sie, wo das ist: Ihr Weg vom Hafen ins Wasser (`seawayEntries`) führt in
 *   anderes Wasser als die Regel, oder in dasselbe, aber nur auf einem Umweg erreichbar - die falsche
 *   Seite einer Landzunge. `judgeLanding` wählt die Anlegestelle, die zu allen Seewegen des Hafens passt.
 *
 * Gespeichert wird hier nichts: Das ist eine Kartenänderung und braucht die Freigabe des Betreibers.
 */

/** Ab so viel Umweg über Wasser, von der Anlegestelle zum Seeweg, gilt sie als falsch (Karteneinheiten). */
export const DETOUR_LIMIT = 3;
/** So weit sucht die Umwegmessung; darüber heißt es nur „weiter“. */
export const DETOUR_SEARCH = 60;

export interface SeaPort {
    id: string;
    name: string;
    x: number;
    y: number;
}

export async function loadSeaports(database: Queryable, mapDomainId: string): Promise<SeaPort[]> {
    return database<SeaPort[]>`
        SELECT public_id::text AS id, name, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM place
        WHERE map_domain_id = ${mapDomainId} AND is_active AND is_seaport
        ORDER BY public_id
    `;
}

/** Wo ein Seeweg vom Hafen aus zuerst befahrbares Wasser erreicht. */
export interface SeawayEntry {
    linkId: string;
    pathName: string;
    x: number;
    y: number;
    cell: number;
    part: number;
    /** Wie weit der Seeweg bis dorthin über Land oder durch zu schmales Wasser läuft. */
    along: number;
}

/** Eine Probe auf einem Seeweg: wo, wie weit vom Anfang, und die Zelle, wenn sie befahrbar ist. */
interface Sample {
    x: number;
    y: number;
    along: number;
    /** Die befahrbare Zelle, oder -1 über Land. */
    cell: number;
}

/** Die Linie in Vierteln einer Zelle abgetastet, mit der befahrbaren Zelle je Probe. */
function samplesOf(grid: SeaGrid, line: readonly [number, number][]): Sample[] {
    const samples: Sample[] = [];
    const step = grid.cell * 0.25;
    let along = 0;
    for (let index = 0; index + 1 < line.length; index += 1) {
        const [ax, ay] = line[index] as [number, number];
        const [bx, by] = line[index + 1] as [number, number];
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(length / step));
        for (let sample = index === 0 ? 0 : 1; sample <= steps; sample += 1) {
            const t = sample / steps;
            const x = ax + (bx - ax) * t;
            const y = ay + (by - ay) * t;
            const cell = cellAt(grid, x, y);
            samples.push({ x, y, along: along + length * t, cell: cell >= 0 && grid.water[cell] === 1 ? cell : -1 });
        }
        along += length;
    }
    return samples;
}

/**
 * Je Seeweg am Hafen die Stelle, an der er das Wasser erreicht, in das er FÜHRT: den Wasserteil seines
 * anderen Endes, vom Hafen aus gelesen. Streift er vorher einen abgetrennten Teil (ein Fjord hinter
 * einer zu schmalen Durchfahrt), zählt der nicht; die Durchfahrt nennt `seawayPassages`. `dry` nennt die
 * Seewege, die nirgends befahrbares Wasser berühren (Flussmündung, Delta).
 */
export function seawayEntries(
    grid: SeaGrid,
    portId: string,
    links: readonly RouteLink[],
): { entries: SeawayEntry[]; dry: string[] } {
    const entries: SeawayEntry[] = [];
    const dry: string[] = [];
    for (const link of links) {
        if (link.from !== portId && link.to !== portId) continue;
        const samples = samplesOf(grid, link.from === portId ? link.coordinates : [...link.coordinates].reverse());
        const last = samples.findLast((sample) => sample.cell >= 0);
        if (!last) {
            dry.push(link.id);
            continue;
        }
        const leadsTo = grid.part[last.cell] as number;
        const entry = samples.find((sample) => sample.cell >= 0 && grid.part[sample.cell] === leadsTo) as Sample;
        entries.push({
            linkId: link.id,
            pathName: link.pathName,
            x: entry.x,
            y: entry.y,
            cell: entry.cell,
            part: leadsTo,
            along: entry.along,
        });
    }
    return { entries, dry };
}

/** Wo ein Seeweg zwischen zwei befahrbaren Stellen über Land läuft, und das Raster dort nicht durchlässt. */
export interface SeawayPassage {
    linkId: string;
    pathName: string;
    /** Die Mitte des trockenen Stücks. */
    x: number;
    y: number;
    /** Wie lang der Seeweg dort über Land läuft. */
    dry: number;
    fromPart: number;
    toPart: number;
    /** Umweg über Wasser um das trockene Stück; unendlich zwischen getrennten Teilen oder über `DETOUR_SEARCH`. */
    detour: number;
}

/**
 * Wo quert ein Seeweg Land, das das Raster nicht durchlässt? Zwischen zwei befahrbaren Proben eines
 * Seewegs liegt ein trockenes Stück; zählt es, wenn beide Seiten in getrennten Wasserteilen liegen oder
 * der Weg über Wasser herum mehr als `DETOUR_LIMIT` länger ist. Das sind die Lücken des freien Rechners:
 * eine Durchfahrt, schmaler als eine Zelle, eine Zeichenlücke - oder ein Seeweg, der wirklich über Land
 * gezeichnet ist.
 */
export function seawayPassages(grid: SeaGrid, search: SeaSearch, links: readonly RouteLink[]): SeawayPassage[] {
    const passages: SeawayPassage[] = [];
    for (const link of links) {
        const samples = samplesOf(grid, link.coordinates);
        let lastWater: Sample | null = null;
        for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index] as Sample;
            if (sample.cell < 0) continue;
            const previous = samples[index - 1];
            if (lastWater && previous && previous.cell < 0) {
                const fromPart = grid.part[lastWater.cell] as number;
                const toPart = grid.part[sample.cell] as number;
                let detour = Infinity;
                if (fromPart === toPart) {
                    const straight = Math.hypot(sample.x - lastWater.x, sample.y - lastWater.y);
                    const route = search.find(lastWater.cell, sample.cell, straight + DETOUR_SEARCH);
                    if (route) detour = route.distance - straight;
                }
                if (detour > DETOUR_LIMIT) {
                    passages.push({
                        linkId: link.id,
                        pathName: link.pathName,
                        x: (lastWater.x + sample.x) / 2,
                        y: (lastWater.y + sample.y) / 2,
                        dry: sample.along - lastWater.along,
                        fromPart,
                        toPart,
                        detour,
                    });
                }
            }
            lastWater = sample;
        }
    }
    return passages;
}

export type LandingVerdict =
    /** Die Regel passt zu allen Seewegen des Hafens. */
    | "regel"
    /** Die Seewege führen in anderes Wasser als die Regel: gespeicherte Anlegestelle nötig. */
    | "anderes_wasser"
    /** Dasselbe Wasser, aber zum Seeweg nur auf einem Umweg: gespeicherte Anlegestelle nötig. */
    | "umweg"
    /** Keine Anlegestelle passt zu allen Seewegen (zwei Gewässer, zwei Seiten): Betreiberfrage. */
    | "mehrdeutig"
    /** Kein befahrbares Wasser in drei Einheiten: nichts automatisch, in den Bericht. */
    | "fern"
    /** Kein Seeweg am Hafen (von Editoren gesetzt): Es gilt die Regel, prüfen lässt sie sich nicht. */
    | "ohne_seeweg"
    /** Kein Seeweg des Hafens erreicht befahrbares Wasser. */
    | "seeweg_trocken";

export interface LandingJudgement {
    verdict: LandingVerdict;
    rule: Landing | null;
    /** Die vorgeschlagene gespeicherte Anlegestelle, nur bei `anderes_wasser` und `umweg`. */
    proposed: SeawayEntry | null;
    /** Der größte Umweg von der Regel-Anlegestelle zu einem Seeweg; unendlich in anderem Wasser. */
    ruleDetour: number;
    /** Derselbe Wert für die beste Anlegestelle. */
    bestDetour: number;
    entries: SeawayEntry[];
    dry: string[];
}

/**
 * Welche Anlegestelle passt zu den Seewegen? Für die Regel-Anlegestelle und jeden Eintritt eines
 * Seewegs wird der größte Umweg zu allen Eintritten gemessen: Weg über Wasser minus Luftlinie. Die Regel
 * bleibt, solange ihr Umweg `DETOUR_LIMIT` nicht übersteigt; sonst gewinnt der Eintritt mit dem
 * kleinsten Umweg, wenn er darunter liegt.
 */
export function judgeLanding(
    grid: SeaGrid,
    search: SeaSearch,
    port: SeaPort,
    links: readonly RouteLink[],
    minArea = 0,
): LandingJudgement {
    const rule = nearestWaterCell(grid, port.x, port.y, LANDING_REACH, minArea);
    const { entries, dry } = seawayEntries(grid, port.id, links);
    const base = { rule, entries, dry, proposed: null, ruleDetour: 0, bestDetour: 0 };
    if (!rule) return { ...base, verdict: "fern" };
    if (links.length === 0) return { ...base, verdict: "ohne_seeweg" };
    if (entries.length === 0) return { ...base, verdict: "seeweg_trocken" };

    const distinct = entries.filter(
        (entry, index) => entries.findIndex((other) => other.cell === entry.cell) === index,
    );
    const detour = (from: { cell: number; x: number; y: number }): number => {
        let worst = 0;
        for (const entry of distinct) {
            if (entry.cell === from.cell) continue;
            if (grid.part[entry.cell] !== grid.part[from.cell]) return Infinity;
            const straight = Math.hypot(entry.x - from.x, entry.y - from.y);
            const route = search.find(from.cell, entry.cell, straight + DETOUR_SEARCH);
            worst = Math.max(worst, route ? route.distance - straight : Infinity);
        }
        return worst;
    };
    const ruleDetour = detour(rule);
    if (ruleDetour <= DETOUR_LIMIT) return { ...base, verdict: "regel", ruleDetour, bestDetour: ruleDetour };
    let best: SeawayEntry | null = null;
    let bestDetour = Infinity;
    for (const entry of distinct) {
        const value = detour(entry);
        if (value < bestDetour) {
            best = entry;
            bestDetour = value;
        }
    }
    if (!best || bestDetour > DETOUR_LIMIT) return { ...base, verdict: "mehrdeutig", ruleDetour, bestDetour };
    return {
        ...base,
        verdict: grid.part[best.cell] === rule.part ? "umweg" : "anderes_wasser",
        proposed: best,
        ruleDetour,
        bestDetour,
    };
}

/**
 * Wie weit liegt der Punkt vom gezeichneten Wasser (Flächen, nicht Raster)? 0 im Wasser, Infinity
 * weiter als `limit`. Für die Messung der Toleranz (Plan 6.30.2: aus echten Daten, nicht geraten).
 */
export function distanceToWater(water: NavigableWater, x: number, y: number, limit = 50): number {
    if (areaIndexAt(x, y, water) !== null) return 0;
    let best = Infinity;
    for (const index of areasNear(water.grid, x - limit, y - limit, x + limit, y + limit)) {
        const area = water.areas[index];
        if (!area) continue;
        if (area.minX > x + limit || area.maxX < x - limit || area.minY > y + limit || area.maxY < y - limit) continue;
        const edges = area.edges;
        for (let offset = 0; offset < edges.length; offset += 4) {
            const x1 = edges[offset] as number;
            const y1 = edges[offset + 1] as number;
            const x2 = edges[offset + 2] as number;
            const y2 = edges[offset + 3] as number;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const lengthSquared = dx * dx + dy * dy;
            const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared)) : 0;
            best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
        }
    }
    return best <= limit ? best : Infinity;
}
