import { createHash } from "node:crypto";
import type { Queryable } from "../../database.ts";
import { loadMountainJobs, type MountainJob } from "../inputs.ts";

/**
 * Was in einen Master eingegangen ist, je Objekt: ein kurzer Fingerabdruck und der Rahmen (JOBS-0001 4.1, WI-0125). Daraus bestimmt
 * `terrain_local` den Fußabdruck einer Änderung: Er vergleicht den Index des geltenden Masters mit dem der heutigen Eingaben
 * (`diffInputIndex`), statt dem Dirty Set eines Clients zu glauben (7.11).
 *
 * Die Objekte sind die Eingaben des Domain-Generators (`domain/inputs.ts`), je mit ihrer öffentlichen Kennung:
 *
 *   - `mountain:<fläche>` die Gebirgsfläche samt V12-Saat: Fingerabdruck ist der des V12-Auftrags (Geometrie, Regler, Gipfel, Flüsse
 *     und Seen darin), Rahmen die Fläche. Ein Gipfel im Gebirge ändert damit auch das Gebirge (R0: „Ein Gipfel in einem Gebirge ist
 *     eine Gebirgsänderung“);
 *   - `peak:<gipfel>` jeder Gipfel: Lage, Höhe, Vulkan; Rahmen der Punkt;
 *   - `area:<fläche>` jede Fläche der Topographie und Vegetation und der Kontinent: Geometrie, Ebene, Art;
 *   - `river:<weg>` jeder Fluss: Geometrie, Bach, Fließrichtung.
 *
 * 🪤 Der Index ist eine Erkennungshilfe, kein zweiter Fingerabdruck des Masters: Ob ein Master zu seinen Eingaben passt, sagt weiter
 * allein `input_fingerprint`. Fehlt ein Objekt im Index, das der Generator liest, bleibt dessen Änderung unerkannt; der gesammelte
 * volle Lauf holt sie nach (D6 = B).
 */

export const INPUT_INDEX_VERSION = 1;

/** Je Objekt: Fingerabdruck (12 Hex) und Rahmen `[minX, minY, maxX, maxY]` in Karteneinheiten. */
export type IndexEntry = [hash: string, minX: number, minY: number, maxX: number, maxY: number];

export interface InputIndex {
    v: number;
    objects: Record<string, IndexEntry>;
}

export type ObjectKind = "mountain" | "peak" | "area" | "river";

export function objectKind(key: string): ObjectKind {
    const kind = key.slice(0, key.indexOf(":"));
    if (kind === "mountain" || kind === "peak" || kind === "area" || kind === "river") return kind;
    throw new Error(`Unbekannte Art im Eingabeindex: ${key}`);
}

const short = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 12);
const round = (value: number): number => Math.round(value * 1000) / 1000;
const entry = (hash: string, minX: number, minY: number, maxX: number, maxY: number): IndexEntry => [
    hash,
    round(minX),
    round(minY),
    round(maxX),
    round(maxY),
];

/** Liest den Index der heutigen Eingaben; in derselben Lesetransaktion wie `loadDomainInputs` gerufen, gehört er zu ihnen. */
export async function loadDomainInputIndex(
    database: Queryable,
    mapDomainId: string,
    /** Die Aufträge der Gebirge aus derselben Lesetransaktion (`loadDomainInputsUndAuftraege`); ohne sie lädt er sie selbst. */
    auftraege?: readonly MountainJob[],
): Promise<InputIndex> {
    const objects: Record<string, IndexEntry> = {};
    for (const job of auftraege ?? (await loadMountainJobs(database, mapDomainId))) {
        const b = job.input.bounds;
        objects[`mountain:${job.areaPublicId}`] = entry(short(job.fingerprint), b.min_x, b.min_y, b.max_x, b.max_y);
    }
    Object.assign(objects, await peakIndex(database, mapDomainId), await areaIndex(database, mapDomainId));
    Object.assign(objects, await riverIndex(database, mapDomainId));
    return { v: INPUT_INDEX_VERSION, objects };
}

/**
 * Die Einträge der Gipfel, wie sie in den Index eingehen; mit `ids` nur diese (öffentliche Kennungen). Auch die Schreibnaht liest
 * sie so (`editor/gelaende-folgen.ts`, WI-0223), damit sie dieselbe Rechnung vergleicht wie der lokale Job.
 */
export async function peakIndex(
    database: Queryable,
    mapDomainId: string,
    ids?: readonly string[],
): Promise<Record<string, IndexEntry>> {
    const objects: Record<string, IndexEntry> = {};
    const peaks = await database<{ id: string; x: number; y: number; h: number | null; subtype: string | null }[]>`
        SELECT public_id::text AS id, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt AS h, subtype
        FROM terrain_peak_gelaende WHERE map_domain_id = ${mapDomainId} AND is_active
          AND (${ids === undefined} OR public_id::text = ANY(${ids ?? []}::text[]))
        ORDER BY public_id
    `;
    for (const peak of peaks)
        objects[`peak:${peak.id}`] = entry(
            short(JSON.stringify([peak.x, peak.y, peak.h, peak.subtype])),
            peak.x,
            peak.y,
            peak.x,
            peak.y,
        );
    return objects;
}

/** Die Einträge der Flächen (Topographie, Vegetation, Kontinent); mit `ids` nur diese (öffentliche Kennungen der Teilflächen). */
export async function areaIndex(
    database: Queryable,
    mapDomainId: string,
    ids?: readonly string[],
): Promise<Record<string, IndexEntry>> {
    const objects: Record<string, IndexEntry> = {};
    const areas = await database<
        {
            id: string;
            layer: string;
            type: string | null;
            md5: string;
            min_x: number;
            min_y: number;
            max_x: number;
            max_y: number;
        }[]
    >`
        SELECT a.public_id::text AS id, r.region_layer AS layer, r.region_type AS type, md5(ST_AsBinary(a.geom)) AS md5,
            ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y
        FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
          AND (r.region_layer IN ('topographie', 'vegetation')
               OR (r.region_layer = 'derographisch' AND r.region_type = 'kontinent'))
          AND (${ids === undefined} OR a.public_id::text = ANY(${ids ?? []}::text[]))
        ORDER BY a.public_id
    `;
    for (const area of areas)
        objects[`area:${area.id}`] = entry(
            short(`${area.layer}|${area.type ?? ""}|${area.md5}`),
            area.min_x,
            area.min_y,
            area.max_x,
            area.max_y,
        );
    return objects;
}

/** Die Einträge der Flüsse; mit `ids` nur diese (öffentliche Kennungen der Wege; der Schlüssel bleibt die interne `path.id`). */
export async function riverIndex(
    database: Queryable,
    mapDomainId: string,
    ids?: readonly string[],
): Promise<Record<string, IndexEntry>> {
    const objects: Record<string, IndexEntry> = {};
    const rivers = await database<
        {
            id: string;
            md5: string;
            is_bach: boolean;
            flow_direction: string | null;
            min_x: number;
            min_y: number;
            max_x: number;
            max_y: number;
        }[]
    >`
        SELECT id::text, md5(ST_AsBinary(geom)) AS md5, is_bach, flow_direction,
            ST_XMin(geom) AS min_x, ST_YMin(geom) AS min_y, ST_XMax(geom) AS max_x, ST_YMax(geom) AS max_y
        FROM path WHERE map_domain_id = ${mapDomainId} AND is_active AND subtype = 'Flussweg'
          AND (${ids === undefined} OR public_id::text = ANY(${ids ?? []}::text[]))
        ORDER BY id
    `;
    for (const river of rivers)
        objects[`river:${river.id}`] = entry(
            short(`${river.md5}|${String(river.is_bach)}|${river.flow_direction ?? ""}`),
            river.min_x,
            river.min_y,
            river.max_x,
            river.max_y,
        );
    return objects;
}

/** Ein geändertes Objekt: neu, entfernt oder anders; mit dem Rahmen vorher und nachher (fehlt einer, gab es es dort nicht). */
export interface InputChange {
    key: string;
    kind: ObjectKind;
    before: IndexEntry | null;
    after: IndexEntry | null;
}

/** Was sich zwischen zwei Indizes geändert hat, in der Reihenfolge der Schlüssel. */
export function diffInputIndex(before: InputIndex, after: InputIndex): InputChange[] {
    if (before.v !== after.v) throw new Error(`Eingabeindex in Fassung ${String(before.v)} statt ${String(after.v)}`);
    const keys = [...new Set([...Object.keys(before.objects), ...Object.keys(after.objects)])].sort();
    const changes: InputChange[] = [];
    for (const key of keys) {
        const old = before.objects[key] ?? null;
        const now = after.objects[key] ?? null;
        if (old && now && old[0] === now[0]) continue;
        changes.push({ key, kind: objectKind(key), before: old, after: now });
    }
    return changes;
}

/** Liest einen gespeicherten Index; ein unbekanntes Format ist kein Index (`null`). */
export function readInputIndex(value: unknown): InputIndex | null {
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<InputIndex>;
    if (candidate.v !== INPUT_INDEX_VERSION || typeof candidate.objects !== "object" || candidate.objects === null)
        return null;
    return candidate as InputIndex;
}
