import type { FindingObject } from "../findings.ts";
import type { Queryable } from "../database.ts";
import type { RetirePressure } from "./retire-findings.ts";

/**
 * Der gemeinsame Abgleich einer Tabelle mit den Zeilen eines Satzes (WI-0063 P3, D6 und D1).
 *
 * Statt je Zeile ein `INSERT … ON CONFLICT` zu schicken, liest der Abgleich den Bestand der Tabelle einmal, vergleicht in
 * TypeScript und schreibt nur, was sich unterscheidet, in Stapeln (`unnest`). Das ist bei den rund 66.000 Quellenverknüpfungen
 * der Unterschied zwischen Sekunden und Minuten, und es macht aus „angelegt, geändert, unverändert, stillgelegt“ eine
 * Aussage, die der Abgleich selbst trifft statt sie aus einem `xmax` zu erraten. Der zweite Lauf mit demselben Satz findet
 * nichts zu schreiben.
 *
 * Regeln, die hier und nirgends sonst stehen:
 *  - Eine Zeile, die der Satz nicht mehr nennt, wird STILLGELEGT (`is_active` falsch, `retired_at`, `retired_origin import`),
 *    nie gelöscht. Nennt ein späterer Satz sie wieder, wird sie wieder aktiv, sofern SIE der Import stillgelegt hat.
 *  - Eine GESCHÜTZTE Zeile (`protectedWhere`, oder stillgelegt mit `retired_origin editor`) fasst der Import weder an noch legt
 *    er sie still (Kapitel 9.37: manuell schlägt Wiki). Nennt der Satz sie, steht sie in `protectedHits`.
 *  - ABGELEITETE Tabellen (`lifecycle: "derived"`, die Kanon-Tafeln) haben keinen Lebenslauf: Was der Satz nicht nennt, wird
 *    gelöscht, denn die Tafel entsteht mit jedem Zug neu.
 */

/** Ein Wert, wie er verglichen wird: Zeichenkette, Zahl, Wahrheitswert oder nichts. Zeitstempel sind ISO-Zeichenketten (UTC). */
export type Cell = string | number | boolean | null;

/**
 * `timestamp` ist die Zeit OHNE Zone, so wie Legacys Export sie liefert (`2026-08-01 10:00:00`): sie wird wörtlich als
 * `YYYY-MM-DDTHH:MM:SS.mmm` verglichen, nie in eine Zone umgerechnet (WI-0063 D4, Bewertungen: die Zone des Legacy-Servers
 * ist nicht belegt). `timestamptz` bleibt für Zeitpunkte mit Zone, in UTC.
 */
export type PgType = "text" | "int" | "bigint" | "boolean" | "timestamp" | "timestamptz" | "uuid";

export interface Col {
    name: string;
    type: PgType;
}

const PG_CAST: Record<PgType, string> = {
    text: "text",
    int: "integer",
    bigint: "bigint",
    boolean: "boolean",
    timestamp: "timestamp",
    timestamptz: "timestamptz",
    uuid: "uuid",
};

/** So viele Zeilen gehen in einer Anweisung hinaus. */
export const CHUNK_ROWS = 5000;

/** Ein PostgreSQL-Feldliteral. Der Treiber leitet den Feldtyp aus dem ersten Element ab und scheitert an Wahrheitswerten. */
export function pgArray(values: readonly Cell[]): string {
    const items = values.map((value) => {
        if (value === null || value === undefined) return "NULL";
        const text = typeof value === "string" ? value : String(value);
        return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    });
    return `{${items.join(",")}}`;
}

/** Der Wert, wie er mit dem Bestand verglichen wird (die Datenbank liefert alles als Text). */
export function canon(value: Cell | undefined): string | null {
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? value : String(value);
}

/** Der Ausdruck, der eine Spalte als vergleichbaren Text liest; Zeitstempel in UTC mit Millisekunden. */
function readExpression(column: Col, alias: string): string {
    const reference = alias === "" ? column.name : `${alias}.${column.name}`;
    if (column.type === "timestamptz") {
        return `to_char(${reference} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    }
    return column.type === "timestamp" ? `to_char(${reference}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')` : `${reference}::text`;
}

/** Die Zahlen einer Tabelle für den Bericht des Imports. */
export interface TableReport {
    created: number;
    updated: number;
    unchanged: number;
    retired: number;
    /** Zeilen des Satzes, die auf eine geschützte Zeile trafen (nicht überschrieben). */
    protectedRows: number;
    /** Zeilen, die der Import stillgelegt hatte und die wieder da sind. */
    reappeared: number;
}

export const emptyTableReport = (): TableReport => ({
    created: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
    protectedRows: 0,
    reappeared: 0,
});

export interface SyncSpec {
    table: string;
    /** Die Spalten, die der Import führt (ohne `id` und ohne die gemeinsamen Spalten). */
    columns: readonly Col[];
    /** Der natürliche Schlüssel einer Zeile aus ihren Zellen (in der Reihenfolge von `columns`). */
    keyOf: (cells: readonly Cell[]) => string;
    /** Der Primärschlüssel der Tabelle (Standard `id`, ein `bigint`); `source_corpus` hat `corpus_key` (Text). */
    idColumn?: string;
    idType?: "bigint" | "text";
    /** `retire` (Standard): stilllegen. `derived`: abgeleitet, Fehlendes wird gelöscht. */
    lifecycle?: "retire" | "derived";
    /** Wie ein Bestand zu einer Zeile des Befunds wird: Join und Ausdrücke über den Alias `t` und `c`. */
    describe?: { join: string; publicId: string; name: string };
    /** Weitere Zuweisungen beim Wiederaufleben und bei der Aktualisierung, etwa `state = 'active'`. */
    activeSet?: string;
    /** Weitere Zuweisungen beim Stilllegen, etwa `state = 'retired'`. */
    retiredSet?: string;
    /** Konstante Spalten beim Anlegen, etwa `{ state: "'active'" }`. */
    insertConstants?: Readonly<Record<string, string>>;
    /** Eine Bedingung über `t`: solche Zeilen fasst der Import nie an. */
    protectedWhere?: string;
    /**
     * Der Zustand je Zeile kommt aus der QUELLE (D5, Lore): Die Quelle nennt auch Zeilen, die sie selbst nicht aktiv führt (ein
     * Eintrag, den das Wiki nicht mehr kennt, einen von Hand unterdrückten Grabstein). Solche Zeilen werden mit ihrem Zustand
     * (`SyncOptions.states`) geschrieben, `is_active` falsch, `retired_origin legacy`, und folgen bei jedem Zug dem Stand der Quelle;
     * die Tabelle trägt dafür `state` (active | retired | suppressed) und `retired_origin legacy`. Nicht zusammen mit
     * `insertConstants.state`, `activeSet` und `retiredSet` für `state` zu verwenden: `state` setzt der Abgleich selbst.
     */
    sourceStates?: boolean;
}

/** Der Zustand, in dem die Quelle eine Zeile nennt. Fehlt er in `SyncOptions.states`, gilt `active`. */
export type SourceState = "active" | "retired" | "suppressed";

export interface SyncOptions {
    runId: string;
    /** Wird nichts stillgelegt (etwa bei einem Teilsatz)? Standard: es wird. */
    retireMissing?: boolean;
    /** Bei `SyncSpec.sourceStates`: Schlüssel der Zeile → Zustand der Quelle (nicht genannte Schlüssel sind `active`). */
    states?: ReadonlyMap<string, SourceState>;
}

export interface SyncResult {
    created: number;
    updated: number;
    unchanged: number;
    retired: number;
    /** Der Bestand des Laufs vor dem Schreiben: aktive Zeilen und wie viele davon stillgelegt werden (für die Stilllegequote). */
    pressure: RetirePressure;
    /** Die Zeilen, die dieser Lauf stilllegt, für den Befund. */
    retiring: FindingObject[];
    /** Schlüssel der Zeilen des Satzes, die auf eine geschützte Zeile trafen. */
    protectedHits: string[];
    /** Schlüssel der Zeilen, die der Import stillgelegt hatte und die wieder da sind. */
    reappeared: string[];
    /** Jeder Schlüssel des Satzes, dem Id der Zeile (angelegt oder vorhanden). */
    idByKey: Map<string, string>;
}

interface ExistingRow {
    id: string;
    isActive: boolean;
    retiredOrigin: string | null;
    /** Nur bei `SyncSpec.sourceStates` gelesen, sonst `null`. */
    state: string | null;
    isProtected: boolean;
    cells: (string | null)[];
    publicId: string | null;
    name: string | null;
}

function chunks<T>(items: readonly T[]): T[][] {
    const out: T[][] = [];
    for (let index = 0; index < items.length; index += CHUNK_ROWS) out.push(items.slice(index, index + CHUNK_ROWS));
    return out;
}

function arrayParameters(columns: readonly Col[], rows: readonly (readonly Cell[])[]): string[] {
    return columns.map((_, columnIndex) => pgArray(rows.map((row) => row[columnIndex] ?? null)));
}

function unnestList(columns: readonly Col[], firstParameter = 1): string {
    return columns.map((column, index) => `$${String(firstParameter + index)}::${PG_CAST[column.type]}[]`).join(", ");
}

async function readExisting(transaction: Queryable, spec: SyncSpec): Promise<ExistingRow[]> {
    const derived = spec.lifecycle === "derived";
    const select = [
        `t.${spec.idColumn ?? "id"}::text AS id`,
        derived ? "TRUE AS is_active" : "t.is_active AS is_active",
        derived ? "NULL::text AS retired_origin" : "t.retired_origin AS retired_origin",
        spec.sourceStates ? "t.state AS state" : "NULL::text AS state",
        spec.protectedWhere ? `COALESCE((${spec.protectedWhere}), FALSE) AS is_protected` : "FALSE AS is_protected",
        ...spec.columns.map((column, index) => `${readExpression(column, "t")} AS c${String(index)}`),
        spec.describe
            ? `${spec.describe.publicId} AS ref_public_id, ${spec.describe.name} AS ref_name`
            : "NULL::text AS ref_public_id, NULL::text AS ref_name",
    ].join(", ");
    const text = `SELECT ${select} FROM ${spec.table} t ${spec.describe?.join ?? ""}`;
    const rows = await transaction.unsafe<Record<string, unknown>[]>(text);
    return rows.map((row) => ({
        id: String(row["id"]),
        isActive: row["is_active"] === true,
        retiredOrigin: (row["retired_origin"] as string | null) ?? null,
        state: (row["state"] as string | null) ?? null,
        isProtected: row["is_protected"] === true,
        cells: spec.columns.map((_, index) => (row[`c${String(index)}`] as string | null) ?? null),
        publicId: (row["ref_public_id"] as string | null) ?? null,
        name: (row["ref_name"] as string | null) ?? null,
    }));
}

/**
 * Gleicht eine Tabelle mit den erwarteten Zeilen ab und schreibt die Unterschiede. Der Aufrufer hat die Transaktion.
 * `expected` sind Zellen in der Reihenfolge von `spec.columns`; ihre Schlüssel sind eindeutig, sonst ist der Aufrufer fehlerhaft.
 */
export async function syncTable(
    transaction: Queryable,
    spec: SyncSpec,
    expected: readonly (readonly Cell[])[],
    options: SyncOptions,
): Promise<SyncResult> {
    const derived = spec.lifecycle === "derived";
    const existing = await readExisting(transaction, spec);
    const existingByKey = new Map<string, ExistingRow>();
    for (const row of existing) {
        const key = spec.keyOf(row.cells);
        if (existingByKey.has(key)) {
            throw new Error(`${spec.table}: der Bestand trägt den Schlüssel ${key} zweimal`);
        }
        existingByKey.set(key, row);
    }

    const result: SyncResult = {
        created: 0,
        updated: 0,
        unchanged: 0,
        retired: 0,
        pressure: { active: existing.filter((row) => row.isActive).length, retiring: 0 },
        retiring: [],
        protectedHits: [],
        reappeared: [],
        idByKey: new Map(),
    };

    const toInsert: (readonly Cell[])[] = [];
    // Der Zustand der Quelle zu jeder Zeile von `toInsert` (nur bei `sourceStates`, sonst bleibt die Liste leer).
    const insertStates: SourceState[] = [];
    const toUpdate: { id: string; cells: readonly Cell[]; state: SourceState }[] = [];
    const seen = new Set<string>();
    for (const cells of expected) {
        const key = spec.keyOf(cells);
        if (seen.has(key)) {
            throw new Error(`${spec.table}: der Satz trägt den Schlüssel ${key} zweimal`);
        }
        seen.add(key);
        const want: SourceState = spec.sourceStates ? (options.states?.get(key) ?? "active") : "active";
        const row = existingByKey.get(key);
        if (!row) {
            toInsert.push(cells);
            if (spec.sourceStates) insertStates.push(want);
            continue;
        }
        result.idByKey.set(key, row.id);
        if (row.isProtected || (!row.isActive && row.retiredOrigin === "editor")) {
            result.protectedHits.push(key);
            continue;
        }
        const sameCells = cells.every((cell, index) => canon(cell) === row.cells[index]);
        if (want !== "active") {
            // Die Quelle führt die Zeile selbst nicht aktiv: sie steht mit ihrem Zustand da und folgt bei jedem Zug der Quelle.
            if (sameCells && !row.isActive && row.retiredOrigin === "legacy" && row.state === want) {
                result.unchanged += 1;
            } else {
                toUpdate.push({ id: row.id, cells, state: want });
            }
            continue;
        }
        if (!row.isActive) {
            toUpdate.push({ id: row.id, cells, state: "active" });
            result.reappeared.push(key);
            continue;
        }
        if (sameCells) {
            result.unchanged += 1;
        } else {
            toUpdate.push({ id: row.id, cells, state: "active" });
        }
    }

    const retireIds: string[] = [];
    const deleteIds: string[] = [];
    if (options.retireMissing !== false) {
        for (const [key, row] of existingByKey) {
            if (seen.has(key) || !row.isActive || row.isProtected) continue;
            if (derived) {
                deleteIds.push(row.id);
            } else {
                retireIds.push(row.id);
            }
            result.retiring.push({ table: spec.table, publicId: row.publicId ?? row.id, name: row.name });
        }
    }
    result.pressure.retiring = result.retiring.length;

    const idColumn = spec.idColumn ?? "id";
    const idType = spec.idType ?? "bigint";
    const columnNames = spec.columns.map((column) => column.name);
    const constants = Object.entries(spec.insertConstants ?? {});

    // Zuerst Stilllegen oder (abgeleitete Tafel) Löschen, dann Aktualisieren, dann Anlegen: Eine Zeile, die den Platz eines
    // eindeutigen Schlüssels räumt (ein Segment weist einen Artikel um), muss weg sein, bevor eine andere ihn belegt.
    for (let index = 0; index < retireIds.length; index += CHUNK_ROWS) {
        const part = retireIds.slice(index, index + CHUNK_ROWS);
        const sets = [
            "is_active = FALSE",
            "retired_at = now()",
            "retired_origin = 'import'",
            "updated_at = now()",
            ...(spec.retiredSet ? [spec.retiredSet] : []),
        ];
        await transaction.unsafe(
            `UPDATE ${spec.table} SET ${sets.join(", ")} WHERE ${idColumn} = ANY($1::${idType}[])`,
            [pgArray(part)],
        );
    }
    for (let index = 0; index < deleteIds.length; index += CHUNK_ROWS) {
        const part = deleteIds.slice(index, index + CHUNK_ROWS);
        await transaction.unsafe(`DELETE FROM ${spec.table} WHERE ${idColumn} = ANY($1::${idType}[])`, [pgArray(part)]);
    }

    // Aktualisieren und Wiederaufleben.
    if (toUpdate.length > 0) {
        // Bei `sourceStates` trägt jede Zeile ihren Zustand mit (eine Spalte `src_state` hinter den Zellen).
        const stateColumn: Col = { name: "src_state", type: "text" };
        const updateColumns: Col[] = [
            { name: "id", type: idType },
            ...spec.columns,
            ...(spec.sourceStates ? [stateColumn] : []),
        ];
        const lifecycle = spec.sourceStates
            ? [
                  "state = v.src_state",
                  "is_active = (v.src_state = 'active')",
                  "retired_at = CASE WHEN v.src_state = 'active' THEN NULL ELSE COALESCE(t.retired_at, now()) END",
                  "retired_origin = CASE WHEN v.src_state = 'active' THEN NULL ELSE 'legacy' END",
              ]
            : derived
              ? []
              : ["is_active = TRUE", "retired_at = NULL", "retired_origin = NULL"];
        const assignments = [
            ...columnNames.map((name) => `${name} = v.${name}`),
            "migration_run_id = $" + String(updateColumns.length + 1) + "::uuid",
            "imported_at = now()",
            "updated_at = now()",
            ...lifecycle,
            ...(spec.activeSet ? [spec.activeSet] : []),
        ];
        for (const part of chunks(toUpdate)) {
            const rows = part.map((entry) => [
                entry.id,
                ...entry.cells,
                ...(spec.sourceStates ? [entry.state] : []),
            ]) as Cell[][];
            const text =
                `UPDATE ${spec.table} AS t SET ${assignments.join(", ")} ` +
                `FROM unnest(${unnestList(updateColumns)}) AS v(${updateColumns.map((column) => column.name).join(", ")}) ` +
                `WHERE t.${idColumn} = v.id`;
            await transaction.unsafe(text, [...arrayParameters(updateColumns, rows), options.runId]);
        }
        result.updated += toUpdate.length;
    }

    // Anlegen.
    for (let offset = 0; offset < toInsert.length; offset += CHUNK_ROWS) {
        const part = toInsert.slice(offset, offset + CHUNK_ROWS);
        const parameters = arrayParameters(spec.columns, part);
        // Bei `sourceStates` kommt der Zustand je Zeile als weitere Spalte der Eingabe mit; Zustand, Aktivität und Stilllegung folgen aus ihm.
        let lifecycleNames = "";
        let lifecycleValues = "";
        let unnestColumns = spec.columns;
        let unnestNames = columnNames;
        if (spec.sourceStates) {
            parameters.push(pgArray(insertStates.slice(offset, offset + CHUNK_ROWS)));
            unnestColumns = [...spec.columns, { name: "src_state", type: "text" }];
            unnestNames = [...columnNames, "src_state"];
            lifecycleNames = ", state, is_active, retired_at, retired_origin";
            lifecycleValues =
                ", v.src_state, (v.src_state = 'active'), CASE WHEN v.src_state = 'active' THEN NULL ELSE now() END, " +
                "CASE WHEN v.src_state = 'active' THEN NULL ELSE 'legacy' END";
        }
        const runParameter = `$${String(parameters.length + 1)}::uuid`;
        parameters.push(options.runId);
        const text =
            `INSERT INTO ${spec.table} (${columnNames.join(", ")}, source_system, migration_run_id, imported_at${lifecycleNames}${constants.map(([name]) => `, ${name}`).join("")}) ` +
            `SELECT ${columnNames.map((name) => `v.${name}`).join(", ")}, 'legacy', ${runParameter}, now()${lifecycleValues}${constants.map(([, value]) => `, ${value}`).join("")} ` +
            `FROM unnest(${unnestList(unnestColumns)}) AS v(${unnestNames.join(", ")}) ` +
            `RETURNING ${idColumn}::text AS id, ${spec.columns.map((column, index) => `${readExpression(column, "")} AS c${String(index)}`).join(", ")}`;
        const inserted = await transaction.unsafe<Record<string, unknown>[]>(text, parameters);
        for (const row of inserted) {
            const cells = spec.columns.map((_, index) => (row[`c${String(index)}`] as string | null) ?? null);
            result.idByKey.set(spec.keyOf(cells), String(row["id"]));
        }
        result.created += part.length;
    }

    result.retired = retireIds.length + deleteIds.length;
    return result;
}

export interface ChildSyncResult {
    /** Angelegte Zeilen (Sätze von Schnappschüssen, die neu oder anders sind). */
    created: number;
    /** Entfernte Zeilen (der alte Satz eines Schnappschusses, dessen Kinder sich geändert haben). */
    retired: number;
    /** Zeilen in Schnappschüssen, deren Kinder gleich blieben. */
    unchanged: number;
    /** Schnappschüsse, deren Satz an Kindern ersetzt wurde. */
    replacedParents: number;
}

/**
 * Kindzeilen eines Schnappschusses: Ändert sich der Satz eines Schnappschusses, wird er ERSETZT, nie angehäuft. Kindzeilen sind
 * Teile ihres Schnappschusses und tragen nur den Anlagestempel; sie werden gelöscht, nicht stillgelegt.
 */
export async function replaceChildren(
    transaction: Queryable,
    table: string,
    parentColumn: string,
    columns: readonly Col[],
    expectedByParent: ReadonlyMap<string, readonly (readonly Cell[])[]>,
    /** Die Spalte, nach der der Bestand gelesen wird (Standard `id`; eine Tabelle ohne `id` nennt ihren Schlüssel). */
    orderBy = "id",
): Promise<ChildSyncResult> {
    const result: ChildSyncResult = { created: 0, retired: 0, unchanged: 0, replacedParents: 0 };
    const parentIds = [...expectedByParent.keys()];
    const existingByParent = new Map<string, (string | null)[][]>();
    if (parentIds.length > 0) {
        const select = `${parentColumn}::text AS parent, ${columns.map((column, index) => `${readExpression(column, "")} AS c${String(index)}`).join(", ")}`;
        const rows = await transaction.unsafe<Record<string, unknown>[]>(
            `SELECT ${select} FROM ${table} WHERE ${parentColumn} = ANY($1::bigint[]) ORDER BY ${orderBy}`,
            [pgArray(parentIds)],
        );
        for (const row of rows) {
            const parent = String(row["parent"]);
            const cells = columns.map((_, index) => (row[`c${String(index)}`] as string | null) ?? null);
            const list = existingByParent.get(parent) ?? [];
            list.push(cells);
            existingByParent.set(parent, list);
        }
    }
    const replace: string[] = [];
    const insertRows: Cell[][] = [];
    for (const [parent, rows] of expectedByParent) {
        const have = existingByParent.get(parent) ?? [];
        const sorted = (list: readonly (readonly Cell[])[]): string[] =>
            list.map((cells) => JSON.stringify(cells.map(canon))).sort();
        const same = JSON.stringify(sorted(have)) === JSON.stringify(sorted(rows));
        if (same) {
            result.unchanged += rows.length;
            continue;
        }
        replace.push(parent);
        result.retired += have.length;
        result.created += rows.length;
        for (const cells of rows) insertRows.push([parent, ...cells]);
    }
    result.replacedParents = replace.length;
    for (let index = 0; index < replace.length; index += CHUNK_ROWS) {
        await transaction.unsafe(`DELETE FROM ${table} WHERE ${parentColumn} = ANY($1::bigint[])`, [
            pgArray(replace.slice(index, index + CHUNK_ROWS)),
        ]);
    }
    const insertColumns: Col[] = [{ name: parentColumn, type: "bigint" }, ...columns];
    for (const part of chunks(insertRows)) {
        await transaction.unsafe(
            `INSERT INTO ${table} (${insertColumns.map((column) => column.name).join(", ")}) ` +
                `SELECT ${insertColumns.map((column) => `v.${column.name}`).join(", ")} ` +
                `FROM unnest(${unnestList(insertColumns)}) AS v(${insertColumns.map((column) => column.name).join(", ")})`,
            arrayParameters(insertColumns, part),
        );
    }
    return result;
}

/**
 * Liest die Spalten einer Tabelle als vergleichbare Zellen (Text, Zeitstempel in UTC mit Millisekunden), für die Prüfer. `where`
 * ist eine Bedingung über den Alias `t`.
 */
export async function readTableCells(
    database: Queryable,
    table: string,
    columns: readonly Col[],
    where = "TRUE",
): Promise<(string | null)[][]> {
    const select = columns.map((column, index) => `${readExpression(column, "t")} AS c${String(index)}`).join(", ");
    const rows = await database.unsafe<Record<string, unknown>[]>(`SELECT ${select} FROM ${table} t WHERE ${where}`);
    return rows.map((row) => columns.map((_, index) => (row[`c${String(index)}`] as string | null) ?? null));
}
