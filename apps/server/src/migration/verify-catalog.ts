import type { Queryable } from "../database.ts";
import { canon, type Cell } from "./sync-table.ts";

/**
 * Gemeinsame Bausteine der Prüfer von Literatur (D3) und Kartensammlung (D2). Nur lesend.
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03): Jede Prüfung meldet, die Liste `BLOCKING_CHECKS` ist leer.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    blocking?: boolean;
}

const SAMPLE = 5;

export function check(name: string, passed: boolean, detail: string, offenders: readonly string[] = []): ParityCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

/** Eine Zahl aus einer Abfrage. */
export async function count(database: Queryable, sql: string): Promise<number> {
    const [row] = await database.unsafe<{ n: number }[]>(`SELECT (${sql})::int AS n`);
    return row?.n ?? 0;
}

/** Vergleicht erwartete und gespeicherte Zeilen nach Schlüssel; die Abweichler als Text, höchstens `limit`. */
export function compareRows(
    expected: ReadonlyMap<string, readonly Cell[]>,
    actual: ReadonlyMap<string, readonly (string | null)[]>,
    columns: readonly string[],
    label: (key: string) => string = (key) => key,
): string[] {
    const offenders: string[] = [];
    for (const [key, want] of expected) {
        const have = actual.get(key);
        if (!have) {
            offenders.push(`${label(key)} fehlt`);
            continue;
        }
        const wrong = columns.filter((_, index) => canon(want[index]) !== have[index]);
        if (wrong.length > 0) offenders.push(`${label(key)}: ${wrong.join(", ")}`);
    }
    for (const key of actual.keys()) if (!expected.has(key)) offenders.push(`${label(key)} ist zu viel`);
    return offenders;
}

/** Tabellen ohne `entity_type`-Spalte und ohne JSON-Typ (Strukturtest). Gibt die verbotenen Spalten zurück. */
export async function forbiddenColumns(
    database: Queryable,
    tables: readonly string[],
    extra: readonly string[] = [],
): Promise<{ table_name: string; column_name: string; data_type: string }[]> {
    return database<{ table_name: string; column_name: string; data_type: string }[]>`
        SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY(${[...tables]}::text[])
          AND (column_name = 'entity_type' OR column_name = ANY(${[...extra]}::text[]) OR data_type IN ('json', 'jsonb'))
    `;
}

/** Eine Ortstabelle der beiden Domänen und ihr Eigner. */
export interface PlaceTableSpec {
    table: "adventure_place" | "citymap_place";
    ownerTable: "adventure" | "citymap";
    ownerColumn: "adventure_id" | "citymap_id";
    /** Spalte des Eigners, die im Befund steht (Titel). */
    ownerName: "title";
}

/**
 * Prüfungen der Ortstabelle, die für beide Domänen gleich sind (Verträge `literature.yaml` und `citymaps.yaml`, `verifier`):
 *  - Zielzustand: aufgelöst, ohne Ziel und nicht gefunden ergeben zusammen die Zahl der Orte; bei `resolved` genau ein Fremdschlüssel
 *    auf eine aktive Zeile, sonst keiner;
 *  - Auflösung UNABHÄNGIG nachgerechnet (mit SQL, nicht mit `resolveTarget`): jede mit `public_id` aufgelöste Zeile trifft über ihre
 *    Kennung dasselbe Ziel, jede mit `wiki_key` aufgelöste über ihren Schlüssel genau dieses Ziel;
 *  - Reihenfolge: nach `(sort_order, export_ordinal)` gelesen ist die Folge die der Ausgabe; kein Ort wurde neu sortiert.
 */
export async function verifyPlaceTable(database: Queryable, spec: PlaceTableSpec): Promise<ParityCheck[]> {
    const { table, ownerTable, ownerColumn } = spec;
    const checks: ParityCheck[] = [];
    const [totals] = await database.unsafe<
        { total: number; resolved: number; unresolved: number; unmatched: number }[]
    >(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE target_state = 'resolved')::int AS resolved,
                count(*) FILTER (WHERE target_state = 'unresolved')::int AS unresolved,
                count(*) FILTER (WHERE target_state = 'unmatched')::int AS unmatched
           FROM ${table} WHERE state = 'active'`,
    );
    const total = totals?.total ?? 0;
    const resolved = totals?.resolved ?? 0;
    const unresolved = totals?.unresolved ?? 0;
    const unmatched = totals?.unmatched ?? 0;
    const inactiveTargets = await count(
        database,
        `SELECT count(*) FROM ${table} p WHERE p.state = 'active' AND p.target_state = 'resolved' AND (
            EXISTS (SELECT 1 FROM place x WHERE x.id = p.place_id AND NOT x.is_active)
            OR EXISTS (SELECT 1 FROM territory x WHERE x.id = p.territory_id AND NOT x.is_active)
            OR EXISTS (SELECT 1 FROM region x WHERE x.id = p.region_id AND NOT x.is_active)
            OR EXISTS (SELECT 1 FROM terrain_peak x WHERE x.id = p.terrain_peak_id AND NOT x.is_active)
            OR EXISTS (SELECT 1 FROM path x WHERE x.id = p.path_id AND NOT x.is_active))`,
    );
    const oneTarget = await count(
        database,
        `SELECT count(*) FROM ${table} p WHERE p.state = 'active' AND
            num_nonnulls(p.place_id, p.territory_id, p.region_id, p.terrain_peak_id, p.path_id) <> CASE WHEN p.target_state = 'resolved' THEN 1 ELSE 0 END`,
    );
    checks.push(
        check(
            "place_targets",
            resolved + unresolved + unmatched === total && inactiveTargets === 0 && oneTarget === 0,
            `${String(total)} Orte = ${String(resolved)} aufgelöst + ${String(unresolved)} ohne Ziel in Legacy + ${String(unmatched)} nicht gefunden; bei aufgelöst genau ein Fremdschlüssel auf eine aktive Zeile (${String(inactiveTargets)} auf stillgelegte Ziele, ${String(oneTarget)} mit falscher Zahl von Fremdschlüsseln), sonst keiner`,
        ),
    );

    const kennung = (alias: string, kind: string, targetTable: string, column: string): string =>
        `(${alias}.${column} IS NOT NULL AND ${alias}.legacy_target_kind = '${kind}' AND EXISTS (SELECT 1 FROM ${targetTable} x WHERE x.id = ${alias}.${column} AND x.is_active AND x.public_id::text = lower(${alias}.legacy_target_public_id)))`;
    const byId = await database.unsafe<{ owner: string; name: string }[]>(
        `SELECT o.public_id::text AS owner, p.raw_name AS name FROM ${table} p JOIN ${ownerTable} o ON o.id = p.${ownerColumn}
          WHERE p.state = 'active' AND p.target_state = 'resolved' AND p.resolved_by = 'public_id' AND NOT (
              ${kennung("p", "settlement", "place", "place_id")}
              OR ${kennung("p", "territory", "territory", "territory_id")}
              OR ${kennung("p", "path", "path", "path_id")}
              OR ${kennung("p", "region", "terrain_peak", "terrain_peak_id")}
              OR (p.region_id IS NOT NULL AND p.legacy_target_kind = 'region' AND EXISTS (
                    SELECT 1 FROM map_label l WHERE l.is_active AND l.region_id = p.region_id AND l.public_id::text = lower(p.legacy_target_public_id)))
          ) ORDER BY o.public_id, p.sort_order LIMIT 200`,
    );
    const prefixless = (alias: string): string => `regexp_replace(${alias}.legacy_target_wiki_key, '^wiki:', '')`;
    const byKey = await database.unsafe<{ owner: string; name: string }[]>(
        `SELECT o.public_id::text AS owner, p.raw_name AS name FROM ${table} p JOIN ${ownerTable} o ON o.id = p.${ownerColumn}
          WHERE p.state = 'active' AND p.target_state = 'resolved' AND p.resolved_by = 'wiki_key' AND NOT (
              (p.place_id IS NOT NULL AND p.legacy_target_kind = 'settlement'
                AND (SELECT count(*) FROM place_wiki_assignment a JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id JOIN place x ON x.id = a.place_id
                      WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND x.is_active AND s.wiki_key = ${prefixless("p")}) = 1
                AND EXISTS (SELECT 1 FROM place_wiki_assignment a JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id
                             WHERE a.place_id = p.place_id AND a.is_active AND a.assignment_state = 'assigned' AND s.wiki_key = ${prefixless("p")}))
              OR (p.territory_id IS NOT NULL AND p.legacy_target_kind = 'territory'
                AND (SELECT count(*) FROM territory x WHERE x.is_active AND x.wiki_key = p.legacy_target_wiki_key) = 1
                AND EXISTS (SELECT 1 FROM territory x WHERE x.id = p.territory_id AND x.wiki_key = p.legacy_target_wiki_key))
              OR (p.region_id IS NOT NULL AND p.legacy_target_kind = 'region'
                AND (SELECT count(*) FROM region x WHERE x.is_active AND x.wiki_region_key = ${prefixless("p")})
                  + (SELECT count(*) FROM terrain_peak_wiki_assignment a JOIN wiki_region_snapshot s ON s.id = a.snapshot_id JOIN terrain_peak x ON x.id = a.terrain_peak_id
                      WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND x.is_active AND s.wiki_key = ${prefixless("p")}) = 1
                AND EXISTS (SELECT 1 FROM region x WHERE x.id = p.region_id AND x.wiki_region_key = ${prefixless("p")}))
              OR (p.terrain_peak_id IS NOT NULL AND p.legacy_target_kind = 'region'
                AND (SELECT count(*) FROM region x WHERE x.is_active AND x.wiki_region_key = ${prefixless("p")})
                  + (SELECT count(*) FROM terrain_peak_wiki_assignment a JOIN wiki_region_snapshot s ON s.id = a.snapshot_id JOIN terrain_peak x ON x.id = a.terrain_peak_id
                      WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND x.is_active AND s.wiki_key = ${prefixless("p")}) = 1
                AND EXISTS (SELECT 1 FROM terrain_peak_wiki_assignment a JOIN wiki_region_snapshot s ON s.id = a.snapshot_id
                             WHERE a.terrain_peak_id = p.terrain_peak_id AND a.is_active AND a.assignment_state = 'assigned' AND s.wiki_key = ${prefixless("p")}))
              OR (p.path_id IS NOT NULL AND p.legacy_target_kind = 'path'
                AND p.path_id = (SELECT x.id FROM path_wiki_assignment a JOIN wiki_path_snapshot s ON s.id = a.snapshot_id JOIN path x ON x.id = a.path_id
                                  WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND x.is_active AND s.wiki_key = p.legacy_target_wiki_key
                                  ORDER BY x.public_id LIMIT 1))
          ) ORDER BY o.public_id, p.sort_order LIMIT 200`,
    );
    const resolutionOffenders = [
        ...byId.map((row) => `${row.owner} / ${row.name}: die Kennung trifft ein anderes Ziel`),
        ...byKey.map((row) => `${row.owner} / ${row.name}: der Schlüssel trifft nicht genau dieses Ziel`),
    ];
    const resolvedById = await count(
        database,
        `SELECT count(*) FROM ${table} WHERE state = 'active' AND resolved_by = 'public_id'`,
    );
    const resolvedByKey = await count(
        database,
        `SELECT count(*) FROM ${table} WHERE state = 'active' AND resolved_by = 'wiki_key'`,
    );
    checks.push(
        check(
            "place_resolution",
            resolutionOffenders.length === 0,
            resolutionOffenders.length === 0
                ? `${String(resolvedById)} über die Kennung und ${String(resolvedByKey)} über den Wiki-Schlüssel aufgelöste Orte mit SQL unabhängig nachgerechnet: jede Kennung trifft genau ihr Ziel, jeder Schlüssel genau ein aktives Ziel (bei Wegen den Anker der Gruppe)`
                : `${String(resolutionOffenders.length)} aufgelöste Orte lassen sich nicht nachrechnen`,
            resolutionOffenders,
        ),
    );

    const order = await database.unsafe<{ owner: string; places: number }[]>(
        `SELECT o.public_id::text AS owner, count(*)::int AS places FROM ${table} p JOIN ${ownerTable} o ON o.id = p.${ownerColumn}
          WHERE p.state = 'active' AND p.export_ordinal <> (SELECT count(*) FROM ${table} q WHERE q.state = 'active' AND q.${ownerColumn} = p.${ownerColumn}
                AND (q.sort_order, q.export_ordinal) < (p.sort_order, p.export_ordinal))
          GROUP BY o.public_id ORDER BY o.public_id LIMIT 200`,
    );
    checks.push(
        check(
            "place_order",
            order.length === 0,
            order.length === 0
                ? "je Eigner entspricht die Folge (sort_order, export_ordinal) der Reihenfolge der Ausgabe: kein Ort wurde neu sortiert"
                : `${String(order.length)} Eigner, deren Ortsliste nach sort_order eine andere Folge hat als die Ausgabe`,
            order.map((row) => `${row.owner}: ${String(row.places)} Orte`),
        ),
    );
    return checks;
}

/**
 * Die Gebietskette eines Gebiets aus dem Baum von Avesmaps3D: die Wiki-Schlüssel (nur `wiki:`) von diesem Gebiet über sein Elter bis
 * zur Wurzel (tiefstes zuerst), wie Legacys `target_territory_path`. Nur für die Gegenprobe (Befund `territory_path_divergent`); der
 * Pfad wird nie gespeichert.
 */
export async function territoryChains(database: Queryable): Promise<(territoryId: string) => string[]> {
    const rows = await database<{ id: string; parent_id: string | null; wiki_key: string | null }[]>`
        SELECT id::text, parent_id::text, wiki_key FROM territory
    `;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return (territoryId: string): string[] => {
        const chain: string[] = [];
        const seen = new Set<string>();
        let current = byId.get(territoryId);
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            if (current.wiki_key !== null && current.wiki_key.startsWith("wiki:")) chain.push(current.wiki_key);
            current = current.parent_id === null ? undefined : byId.get(current.parent_id);
        }
        return chain;
    };
}

/** Leere Zeichenketten in den Textspalten (Legacys leerer Wert wird NULL, nie ein leerer String). */
export async function blankTextCount(database: Queryable, table: string, columns: readonly string[]): Promise<number> {
    if (columns.length === 0) return 0;
    return count(
        database,
        `SELECT count(*) FROM ${table} WHERE ${columns.map((column) => `btrim(${column}) = ''`).join(" OR ")}`,
    );
}
