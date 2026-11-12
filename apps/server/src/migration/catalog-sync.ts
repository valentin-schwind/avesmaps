import type { Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    CHUNK_ROWS,
    pgArray,
    syncTable,
    type Cell,
    type Col,
    type PgType,
    type SourceState,
    type SyncResult,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";

/**
 * Zwei kleine Bausteine neben `syncTable` für die Importer von Literatur (D3) und Kartensammlung (D2): die unterdrückten Zeilen
 * (Tombstones, E5+) und das nachträgliche Füllen privater Spalten.
 *
 * Beides gilt nur, wenn der Import eine Datei mit den PRIVATEN Feldern bekommt (Anfrage E5 und E5+, noch nicht gebaut). Ohne die Datei
 * bleiben die privaten Spalten `unknown` beziehungsweise NULL und es gibt keine Tombstones: ehrlich, kein Fehler, nachträglich additiv.
 */

const PG_CAST: Record<PgType, string> = {
    text: "text",
    int: "integer",
    bigint: "bigint",
    boolean: "boolean",
    timestamp: "timestamp",
    timestamptz: "timestamptz",
    uuid: "uuid",
};

function chunked<T>(items: readonly T[]): T[][] {
    const out: T[][] = [];
    for (let index = 0; index < items.length; index += CHUNK_ROWS) out.push(items.slice(index, index + CHUNK_ROWS));
    return out;
}

export interface TombstoneResult {
    created: number;
    /** Aktive oder vom Import stillgelegte Zeilen, die zum Tombstone wurden. */
    converted: number;
    /** Zeilen, die schon Tombstone waren oder die ein Editor stillgelegt hat: unberührt. */
    unchanged: number;
}

/**
 * Schreibt unterdrückte Zeilen (`state suppressed`, `is_active` falsch, `retired_origin import`): Eine fehlende Zeile wird angelegt,
 * eine aktive oder vom Import stillgelegte wird zum Tombstone, ein Tombstone bleibt einer. Eine Zeile, die ein Editor stillgelegt
 * hat, fasst der Import nie an. WIEDERBELEBT wird nichts (Kapitel 9.37): die Zeile bleibt `suppressed`, auch wenn Legacy sie später
 * wieder nennt; `syncTable` fasst sie wegen `protectedWhere: "t.state = 'suppressed'"` nie an.
 *
 * `columns` sind die Spalten, die die Zeile zum Anlegen braucht (ohne `id`, ohne die gemeinsamen Spalten); `keyOf` bildet den
 * natürlichen Schlüssel aus den Zellen. `insertable: false` legt nie an, sondern wandelt nur Vorhandenes um (Werk und Karte tragen
 * als Tombstone nur, was Legacy ihnen gibt).
 */
export async function writeTombstones(
    transaction: Queryable,
    table: string,
    columns: readonly Col[],
    keyOf: (cells: readonly Cell[]) => string,
    rows: readonly (readonly Cell[])[],
    runId: string,
    insertable = true,
): Promise<TombstoneResult> {
    const result: TombstoneResult = { created: 0, converted: 0, unchanged: 0 };
    if (rows.length === 0) return result;
    const select = columns.map((column, index) => `t.${column.name}::text AS c${String(index)}`).join(", ");
    const existing = await transaction.unsafe<Record<string, unknown>[]>(
        `SELECT t.id::text AS id, t.state, t.retired_origin, ${select} FROM ${table} t`,
    );
    const byKey = new Map<string, { id: string; state: string; retiredOrigin: string | null }>();
    for (const row of existing) {
        const cells = columns.map((_, index) => (row[`c${String(index)}`] as string | null) ?? null);
        byKey.set(keyOf(cells), {
            id: String(row["id"]),
            state: String(row["state"]),
            retiredOrigin: (row["retired_origin"] as string | null) ?? null,
        });
    }
    const toInsert: (readonly Cell[])[] = [];
    const toConvert: string[] = [];
    const seen = new Set<string>();
    for (const cells of rows) {
        const key = keyOf(cells);
        if (seen.has(key)) continue;
        seen.add(key);
        const row = byKey.get(key);
        if (!row) {
            if (insertable) toInsert.push(cells);
            continue;
        }
        if (row.state === "suppressed" || (row.state === "retired" && row.retiredOrigin === "editor")) {
            result.unchanged += 1;
        } else {
            toConvert.push(row.id);
        }
    }
    for (const part of chunked(toConvert)) {
        await transaction.unsafe(
            `UPDATE ${table} SET state = 'suppressed', is_active = FALSE, retired_at = COALESCE(retired_at, now()), ` +
                `retired_origin = 'import', migration_run_id = $2::uuid, imported_at = now(), updated_at = now() ` +
                `WHERE id = ANY($1::bigint[])`,
            [pgArray(part), runId],
        );
    }
    result.converted = toConvert.length;
    for (const part of chunked(toInsert)) {
        const names = columns.map((column) => column.name);
        const unnest = columns.map((column, index) => `$${String(index + 1)}::${PG_CAST[column.type]}[]`).join(", ");
        await transaction.unsafe(
            `INSERT INTO ${table} (${names.join(", ")}, state, is_active, retired_at, retired_origin, source_system, migration_run_id, imported_at) ` +
                `SELECT ${names.map((name) => `v.${name}`).join(", ")}, 'suppressed', FALSE, now(), 'import', 'legacy', $${String(columns.length + 1)}::uuid, now() ` +
                `FROM unnest(${unnest}) AS v(${names.join(", ")})`,
            [...columns.map((_, index) => pgArray(part.map((cells) => cells[index] ?? null))), runId],
        );
    }
    result.created = toInsert.length;
    return result;
}

/**
 * Füllt Spalten nachträglich, für genau die Zeilen, die die Datei nennt: Eine Zeile, deren Werte schon stimmen, bleibt unberührt
 * (`IS DISTINCT FROM`), also auch ihr `updated_at`. Gibt die Zahl der geänderten Zeilen zurück. Ein Spaltenwert der Datei ersetzt den
 * gespeicherten, ein Werk ohne Eintrag in der Datei behält seine Werte (additiv, nie löschend).
 */
export async function enrichRows(
    transaction: Queryable,
    table: string,
    columns: readonly Col[],
    updates: readonly { id: string; cells: readonly Cell[] }[],
    runId: string,
): Promise<number> {
    let changed = 0;
    if (updates.length === 0) return changed;
    for (const part of chunked(updates)) {
        const all: Col[] = [{ name: "id", type: "bigint" }, ...columns];
        const unnest = all.map((column, index) => `$${String(index + 1)}::${PG_CAST[column.type]}[]`).join(", ");
        const assignments = columns.map((column) => `${column.name} = v.${column.name}`);
        const differs = columns.map((column) => `t.${column.name} IS DISTINCT FROM v.${column.name}`);
        const rows = await transaction.unsafe<{ id: string }[]>(
            `UPDATE ${table} AS t SET ${assignments.join(", ")}, migration_run_id = $${String(all.length + 1)}::uuid, imported_at = now(), updated_at = now() ` +
                `FROM unnest(${unnest}) AS v(${all.map((column) => column.name).join(", ")}) ` +
                `WHERE t.id = v.id AND (${differs.join(" OR ")}) RETURNING t.id::text AS id`,
            [
                pgArray(part.map((entry) => entry.id)),
                ...columns.map((_, index) => pgArray(part.map((entry) => entry.cells[index] ?? null))),
                runId,
            ],
        );
        changed += rows.length;
    }
    return changed;
}

export interface ExpectedRow {
    cells: Cell[];
    ref: FindingObject;
}

/**
 * Gleicht eine Tabelle ab und trägt die Zahlen in den Bericht ein: angelegt, geändert, unverändert, stillgelegt, geschützt, wieder
 * aktiv. Befunde: `stilllegequote` (meldet nur), `row_vs_decision` (der Satz bringt einen Stand für eine Zeile, die ein Tombstone oder
 * ein Editor-Entscheid hält; die Zeile bleibt) und `row_reappeared` (eine mit `import` stillgelegte Zeile ist wieder da).
 */
export async function syncReported(
    transaction: Queryable,
    runId: string,
    name: string,
    spec: SyncSpec,
    rows: readonly ExpectedRow[],
    report: TableReport,
    findings: Finding[],
    /** Bei `SyncSpec.sourceStates`: der Zustand der Quelle je Schlüssel (nicht genannte Schlüssel sind aktiv). */
    extra: { states?: ReadonlyMap<string, SourceState> } = {},
): Promise<SyncResult> {
    const result = await syncTable(
        transaction,
        spec,
        rows.map((row) => row.cells),
        { runId, ...(extra.states === undefined ? {} : { states: extra.states }) },
    );
    report.created = result.created;
    report.updated = result.updated;
    report.unchanged = result.unchanged;
    report.retired = result.retired;
    report.protectedRows = result.protectedHits.length;
    report.reappeared = result.reappeared.length;
    const refByKey = new Map(rows.map((row) => [spec.keyOf(row.cells), row.ref]));
    const objectsOf = (keys: readonly string[]): FindingObject[] =>
        keys.map((key) => refByKey.get(key)).filter((ref): ref is FindingObject => ref !== undefined);
    const quota = await retireFinding(name, result.pressure, async () => result.retiring);
    if (quota) findings.push(quota);
    if (result.protectedHits.length > 0) {
        findings.push(
            createFinding(
                "row_vs_decision",
                `${name}: der Satz bringt einen Stand für ${String(result.protectedHits.length)} Zeilen, die ein Tombstone oder ein Editor-Entscheid hält; die Zeile bleibt (Kapitel 9.37)`,
                { table: name, zeilen: result.protectedHits.length },
                objectsOf(result.protectedHits),
            ),
        );
    }
    if (result.reappeared.length > 0) {
        findings.push(
            createFinding(
                "row_reappeared",
                `${name}: ${String(result.reappeared.length)} Zeilen, die der Import stillgelegt hatte, sind wieder da (Legacy führt sie wieder)`,
                { table: name, zeilen: result.reappeared.length },
                objectsOf(result.reappeared),
            ),
        );
    }
    return result;
}
