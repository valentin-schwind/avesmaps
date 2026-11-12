import type { Queryable } from "../database.ts";
import type { FindingObject } from "../findings.ts";

/**
 * Der Ortsbezug von Werken (D3) und Karten (D2): aus Legacys Angaben (Art, Kennung, Wiki-Schlüssel) wird ein typisierter Fremdschlüssel
 * (WI-0063 P3, Verträge `literature.yaml` und `citymaps.yaml`, Abschnitt `ortsbezug`).
 *
 * Die Auflösung ist eine REINE FUNKTION von (Legacy-Angaben, Zustand der Trägertabellen) und keine Redaktion: Sie wird bei jedem Lauf neu
 * gerechnet, aus den Trägertabellen gelesen (`readTargetIndex`), ohne etwas zu schreiben. Ein Name wird nie gegen Objekte verglichen
 * (Legacys Namensauflöser ist nicht nachgebaut); ein mehrdeutiger Schlüssel wird nie still gewählt.
 *
 * Reihenfolge (Vertrag `aufloesung.reihenfolge`):
 *  1. Legacy-Art `unresolved` (oder keine): `unresolved`, kein Namensabgleich.
 *  2. Fremde Art (nicht `settlement`, `territory`, `region`, `path`): `unmatched`, Befund `place_kind_unknown`.
 *  3. Kennung in den Raum der Zielart schlagen; ein Treffer auf eine AKTIVE Zeile ist `resolved` (aufgelöst mit `public_id`).
 *  4. Nur wenn die Kennung leer ist oder nichts Aktives fand: der Wiki-Schlüssel in den Schlüsselraum der Zielart. Genau ein Treffer
 *     ist `resolved` (aufgelöst mit `wiki_key`); mehrere sind `unmatched` (`place_target_ambiguous`), nie gewählt.
 *  5. Kennung UND Schlüssel zeigen auf verschiedene Ziele: die Kennung gewinnt (Befund `place_target_key_disagrees`).
 *  6. Sonst `unmatched` (`place_unmatched`).
 */

export const PLACE_KINDS = ["settlement", "territory", "region", "path"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export type TargetState = "resolved" | "unresolved" | "unmatched";
export type ResolvedBy = "public_id" | "wiki_key";
export type TargetColumn = "place_id" | "territory_id" | "region_id" | "terrain_peak_id" | "path_id";

export type ResolutionNote =
    | "place_unresolved"
    | "place_unmatched"
    | "place_target_ambiguous"
    | "place_target_key_disagrees"
    | "place_kind_unknown"
    | "path_anchor_derived";

export interface TargetHit {
    column: TargetColumn;
    id: string;
}

export interface Resolution {
    state: TargetState;
    resolvedBy: ResolvedBy | null;
    target: TargetHit | null;
    notes: ResolutionNote[];
}

/** Legacys Angaben zu einem Ortsbezug, wie sie die Antwort trägt (`''` heißt leer). */
export interface LegacyTarget {
    kind: string | null;
    publicId: string | null;
    wikiKey: string | null;
}

interface Row {
    id: string;
    active: boolean;
}

/** Was Avesmaps3D an Zielen hat, in den zwei Räumen je Zielart: die Kennung und der Wiki-Schlüssel (nur aktive Zeilen tragen Schlüssel). */
export interface TargetIndex {
    /** `place.public_id`. */
    places: ReadonlyMap<string, Row>;
    /** `wiki_settlement_snapshot.wiki_key` (ohne Präfix) → aktive Orte mit aktiver, zugewiesener Wiki-Zuordnung (D6). */
    placesByKey: ReadonlyMap<string, readonly string[]>;
    /** `territory.public_id`. */
    territories: ReadonlyMap<string, Row>;
    /** `territory.wiki_key` (wörtlich, `wiki:`- oder `name:`-Slug) → aktive Gebiete. */
    territoriesByKey: ReadonlyMap<string, readonly string[]>;
    /** `map_label.public_id` → die Region der Beschriftung (`map_label.region_id`) und ob die Beschriftung aktiv ist. */
    labels: ReadonlyMap<string, { regionId: string | null; active: boolean }>;
    /** `region.id` → aktiv. */
    regions: ReadonlyMap<string, boolean>;
    /** `region.wiki_region_key` (ohne Präfix) → aktive Regionen. */
    regionsByKey: ReadonlyMap<string, readonly string[]>;
    /** `terrain_peak.public_id`. */
    peaks: ReadonlyMap<string, Row>;
    /** `wiki_region_snapshot.wiki_key` → aktive Gipfel mit aktiver, zugewiesener Wiki-Zuordnung (D6). */
    peaksByKey: ReadonlyMap<string, readonly string[]>;
    /** `path.public_id`. */
    paths: ReadonlyMap<string, Row>;
    /**
     * `wiki_path_snapshot.wiki_key` (ohne Präfix) → die Wegegruppe: der Anker (das aktive Segment mit der kleinsten `public_id`) und alle
     * ihre aktiven Segmente (zur Gegenprobe: ein Segment der Gruppe widerspricht dem Schlüssel nicht).
     */
    pathAnchors: ReadonlyMap<string, { id: string; publicId: string; members: ReadonlySet<string> }>;
}

function push(map: Map<string, string[]>, key: string, id: string): void {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
}

/** Liest die Ziele aus den Trägertabellen und der Wiki-Zuordnung (D6). Nur lesend. */
export async function readTargetIndex(database: Queryable): Promise<TargetIndex> {
    const places = new Map<string, Row>();
    for (const row of await database<{ id: string; public_id: string; is_active: boolean }[]>`
        SELECT id::text, public_id::text, is_active FROM place
    `) {
        places.set(row.public_id, { id: row.id, active: row.is_active });
    }
    const placesByKey = new Map<string, string[]>();
    for (const row of await database<{ wiki_key: string; place_id: string }[]>`
        SELECT s.wiki_key, p.id::text AS place_id
        FROM place_wiki_assignment a
        JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id
        JOIN place p ON p.id = a.place_id
        WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND p.is_active
        ORDER BY p.id
    `) {
        push(placesByKey, row.wiki_key, row.place_id);
    }

    const territories = new Map<string, Row>();
    const territoriesByKey = new Map<string, string[]>();
    for (const row of await database<{ id: string; public_id: string; wiki_key: string | null; is_active: boolean }[]>`
        SELECT id::text, public_id::text, wiki_key, is_active FROM territory ORDER BY id
    `) {
        territories.set(row.public_id, { id: row.id, active: row.is_active });
        if (row.is_active && row.wiki_key !== null && row.wiki_key.trim() !== "") {
            push(territoriesByKey, row.wiki_key, row.id);
        }
    }

    const regions = new Map<string, boolean>();
    const regionsByKey = new Map<string, string[]>();
    for (const row of await database<{ id: string; wiki_region_key: string | null; is_active: boolean }[]>`
        SELECT id::text, wiki_region_key, is_active FROM region ORDER BY id
    `) {
        regions.set(row.id, row.is_active);
        if (row.is_active && row.wiki_region_key !== null && row.wiki_region_key.trim() !== "") {
            push(regionsByKey, row.wiki_region_key, row.id);
        }
    }
    const labels = new Map<string, { regionId: string | null; active: boolean }>();
    for (const row of await database<{ public_id: string; region_id: string | null; is_active: boolean }[]>`
        SELECT public_id::text, region_id::text, is_active FROM map_label
    `) {
        labels.set(row.public_id, { regionId: row.region_id, active: row.is_active });
    }

    const peaks = new Map<string, Row>();
    for (const row of await database<{ id: string; public_id: string; is_active: boolean }[]>`
        SELECT id::text, public_id::text, is_active FROM terrain_peak
    `) {
        peaks.set(row.public_id, { id: row.id, active: row.is_active });
    }
    const peaksByKey = new Map<string, string[]>();
    for (const row of await database<{ wiki_key: string; peak_id: string }[]>`
        SELECT s.wiki_key, p.id::text AS peak_id
        FROM terrain_peak_wiki_assignment a
        JOIN wiki_region_snapshot s ON s.id = a.snapshot_id
        JOIN terrain_peak p ON p.id = a.terrain_peak_id
        WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND p.is_active
        ORDER BY p.id
    `) {
        push(peaksByKey, row.wiki_key, row.peak_id);
    }

    const paths = new Map<string, Row>();
    for (const row of await database<{ id: string; public_id: string; is_active: boolean }[]>`
        SELECT id::text, public_id::text, is_active FROM path
    `) {
        paths.set(row.public_id, { id: row.id, active: row.is_active });
    }
    // Der Anker der Wegegruppe: das aktive Segment mit der kleinsten public_id (reine Ordnung der UUID, nur Anker, keine Identität).
    const pathAnchors = new Map<string, { id: string; publicId: string; members: Set<string> }>();
    for (const row of await database<{ wiki_key: string; id: string; public_id: string }[]>`
        SELECT s.wiki_key, p.id::text AS id, p.public_id::text AS public_id
        FROM path_wiki_assignment a
        JOIN wiki_path_snapshot s ON s.id = a.snapshot_id
        JOIN path p ON p.id = a.path_id
        WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND p.is_active
    `) {
        const current = pathAnchors.get(row.wiki_key);
        if (!current) {
            pathAnchors.set(row.wiki_key, { id: row.id, publicId: row.public_id, members: new Set([row.id]) });
            continue;
        }
        current.members.add(row.id);
        if (row.public_id < current.publicId) {
            current.id = row.id;
            current.publicId = row.public_id;
        }
    }
    return {
        places,
        placesByKey,
        territories,
        territoriesByKey,
        labels,
        regions,
        regionsByKey,
        peaks,
        peaksByKey,
        paths,
        pathAnchors,
    };
}

/** Der Wiki-Schlüssel ohne das Präfix `wiki:` (Orte und Landschaften führen ihn als `wiki:`-Slug, der Schnappschuss ohne Präfix). */
function withoutWikiPrefix(key: string): string {
    return key.startsWith("wiki:") ? key.slice("wiki:".length) : key;
}

/** Die Kennung im Raum der Zielart: genau ein aktiver Treffer, oder `null`. Eine inaktive Zeile zählt wie kein Treffer. */
function hitByPublicId(kind: PlaceKind, publicId: string, index: TargetIndex): TargetHit | null {
    const id = publicId.toLowerCase();
    switch (kind) {
        case "settlement": {
            const row = index.places.get(id);
            return row?.active ? { column: "place_id", id: row.id } : null;
        }
        case "territory": {
            const row = index.territories.get(id);
            return row?.active ? { column: "territory_id", id: row.id } : null;
        }
        case "path": {
            const row = index.paths.get(id);
            return row?.active ? { column: "path_id", id: row.id } : null;
        }
        case "region": {
            // Die Kennung einer Region-Zeile ist die einer BESCHRIFTUNG: eine gebundene (über map_label.region_id die Region) oder ein
            // Gipfel (terrain_peak). Nie die der Landschaft (0 von 1.530 in region.legacy_public_id).
            const label = index.labels.get(id);
            if (label?.active && label.regionId !== null && index.regions.get(label.regionId) === true) {
                return { column: "region_id", id: label.regionId };
            }
            const peak = index.peaks.get(id);
            return peak?.active ? { column: "terrain_peak_id", id: peak.id } : null;
        }
    }
}

/** Der Wiki-Schlüssel im Schlüsselraum der Zielart: alle aktiven Treffer. Bei `path` ist der Treffer der Anker der Gruppe. */
function hitsByWikiKey(kind: PlaceKind, wikiKey: string, index: TargetIndex): TargetHit[] {
    switch (kind) {
        case "settlement":
            return (index.placesByKey.get(withoutWikiPrefix(wikiKey)) ?? []).map((id) => ({ column: "place_id", id }));
        case "territory":
            // Bei dieser Zielart steht der Schlüssel schon in Avesmaps3D-Form (wiki:- oder name:-Slug), wörtlich.
            return (index.territoriesByKey.get(wikiKey) ?? []).map((id) => ({ column: "territory_id", id }));
        case "region": {
            const key = withoutWikiPrefix(wikiKey);
            return [
                ...(index.regionsByKey.get(key) ?? []).map((id): TargetHit => ({ column: "region_id", id })),
                ...(index.peaksByKey.get(key) ?? []).map((id): TargetHit => ({ column: "terrain_peak_id", id })),
            ];
        }
        case "path": {
            // Der Schlüssel eines Wegs ist der UNPRÄFIERTE Slug; die Wegegruppe hat einen Anker, keine Mehrdeutigkeit.
            const anchor = index.pathAnchors.get(wikiKey);
            return anchor ? [{ column: "path_id", id: anchor.id }] : [];
        }
    }
}

function isPlaceKind(value: string): value is PlaceKind {
    return (PLACE_KINDS as readonly string[]).includes(value);
}

/** Löst einen Ortsbezug auf (Reihenfolge siehe Kopf der Datei). */
export function resolveTarget(legacy: LegacyTarget, index: TargetIndex): Resolution {
    const kind = (legacy.kind ?? "").trim();
    if (kind === "" || kind === "unresolved") {
        return { state: "unresolved", resolvedBy: null, target: null, notes: ["place_unresolved"] };
    }
    if (!isPlaceKind(kind)) {
        return { state: "unmatched", resolvedBy: null, target: null, notes: ["place_kind_unknown"] };
    }
    const publicId = (legacy.publicId ?? "").trim();
    const wikiKey = (legacy.wikiKey ?? "").trim();
    const byId = publicId === "" ? null : hitByPublicId(kind, publicId, index);
    const byKey = wikiKey === "" ? [] : hitsByWikiKey(kind, wikiKey, index);
    if (byId) {
        const notes: ResolutionNote[] = [];
        // Kennung UND Schlüssel zeigen auf verschiedene Ziele: die Kennung gewinnt, der Befund nennt es. Bei einem Weg widerspricht
        // der Schlüssel nur, wenn das genannte Segment nicht zur Gruppe des Schlüssels gehört (Legacy nennt ein repräsentatives
        // Segment, der Anker ist ein anderes: das ist kein Widerspruch).
        const agrees =
            kind === "path"
                ? index.pathAnchors.get(wikiKey)?.members.has(byId.id) === true
                : byKey.some((hit) => hit.column === byId.column && hit.id === byId.id);
        if (byKey.length > 0 && !agrees) notes.push("place_target_key_disagrees");
        return { state: "resolved", resolvedBy: "public_id", target: byId, notes };
    }
    if (byKey.length === 1) {
        const hit = byKey[0] as TargetHit;
        return {
            state: "resolved",
            resolvedBy: "wiki_key",
            target: hit,
            notes: kind === "path" ? ["path_anchor_derived"] : [],
        };
    }
    if (byKey.length > 1) {
        return { state: "unmatched", resolvedBy: null, target: null, notes: ["place_target_ambiguous"] };
    }
    return { state: "unmatched", resolvedBy: null, target: null, notes: ["place_unmatched"] };
}

/** Die Zellen der fünf Fremdschlüssel einer Zeile: höchstens eine gesetzt. */
export function targetCells(resolution: Resolution): (string | null)[] {
    const columns: readonly TargetColumn[] = ["place_id", "territory_id", "region_id", "terrain_peak_id", "path_id"];
    return columns.map((column) => (resolution.target?.column === column ? resolution.target.id : null));
}

/** Legacys `PlaceNameKey`: kleingeschrieben und ohne umgebenden Leerraum. */
export function nameKey(rawName: string): string {
    return rawName.trim().toLowerCase();
}

/** Ein Ort einer Antwort, bevor er aufgelöst und nummeriert ist. */
export interface RawPlace {
    sortOrder: number;
    rawName: string;
    legacy: LegacyTarget;
    /** Legacys Gebietspfad (nur die Gegenprobe, nie gespeichert). */
    territoryPath: string[];
}

export interface NumberedPlace {
    sortOrder: number;
    exportOrdinal: number;
    nameKey: string;
    dupOrdinal: number;
    rawName: string;
    legacy: LegacyTarget;
    territoryPath: string[];
}

/**
 * Nummeriert die Orte eines Werks oder einer Karte in Ausgabereihenfolge: `export_ordinal` ist der Index, `dup_ordinal` zählt gleiche
 * `(sort_order, name_key)` (0 für die erste). Nichts wird sortiert.
 */
export function numberPlaces(places: readonly RawPlace[]): {
    rows: NumberedPlace[];
    duplicates: number;
    ties: boolean;
} {
    const seen = new Map<string, number>();
    const sortOrders = new Map<number, number>();
    let duplicates = 0;
    const rows = places.map((place, exportOrdinal): NumberedPlace => {
        const key = nameKey(place.rawName);
        const slot = `${String(place.sortOrder)}|${key}`;
        const dupOrdinal = seen.get(slot) ?? 0;
        seen.set(slot, dupOrdinal + 1);
        if (dupOrdinal > 0) duplicates += 1;
        sortOrders.set(place.sortOrder, (sortOrders.get(place.sortOrder) ?? 0) + 1);
        return {
            sortOrder: place.sortOrder,
            exportOrdinal,
            nameKey: key,
            dupOrdinal,
            rawName: place.rawName,
            legacy: place.legacy,
            territoryPath: place.territoryPath,
        };
    });
    return { rows, duplicates, ties: [...sortOrders.values()].some((count) => count > 1) };
}

/** Die Kennzahl der Auflösung für den Bericht: je Zustand und je Legacy-Art. */
export interface ResolutionTotals {
    resolved: number;
    unresolved: number;
    unmatched: number;
    /** `resolved` und `unmatched` je Legacy-Art. */
    byKind: Record<string, { resolved: number; unmatched: number }>;
}

export function emptyTotals(): ResolutionTotals {
    return { resolved: 0, unresolved: 0, unmatched: 0, byKind: {} };
}

export function countResolution(totals: ResolutionTotals, kind: string | null, resolution: Resolution): void {
    totals[resolution.state] += 1;
    const label = (kind ?? "").trim() === "" ? "unresolved" : (kind as string).trim();
    const entry = (totals.byKind[label] ??= { resolved: 0, unmatched: 0 });
    if (resolution.state === "resolved") entry.resolved += 1;
    if (resolution.state === "unmatched") entry.unmatched += 1;
}

/** Ein Ort als Objekt eines Befunds: das Werk oder die Karte, dazu der Rohname. */
export function placeObject(table: string, ownerPublicId: string, ownerName: string, rawName: string): FindingObject {
    return { table, publicId: ownerPublicId, name: `${ownerName} / ${rawName}` };
}
