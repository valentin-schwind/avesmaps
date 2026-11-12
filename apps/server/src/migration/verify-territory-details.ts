import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import {
    DETAIL_COLUMNS,
    SNAPSHOT_COLUMNS,
    TERRITORY_DETAIL_TABLES,
    detailCells,
    originCells,
    readTerritoryDetailIndex,
    snapshotCells,
} from "./territory-details-import.ts";
import { DETAIL_FIELDS, transformTerritoryDetails } from "./territory-details.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import { check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";

/**
 * Parität der Gebietsdetails gegen dieselbe Gebietsdatei, aus der importiert wurde (WI-0063 P3, Vertrag `territory-details.yaml`,
 * `verifier`).
 *
 * Geprüft wird: Anzahl (Detailzeilen gleich den Gebieten mit mindestens einem Feld, je Feld Werte, Leerwerte und fehlende gleich der
 * Quelle), jede Zeile Feld für Feld (NULL bleibt NULL, `''` bleibt `''`, nie in NULL umgewandelt), die Herkunft (`''` nur mit `override`,
 * jeder Vermerk gleich der Liste der Quelle, kein Vermerk ohne Wert), die Fremdschlüssel (jede Detailzeile zeigt auf eine aktive
 * Gebietszeile), die Struktur (kein JSON, kein `entity_type`, keine Lizenz-, Datei- oder Wappenspalte in den Tabellen) und der Wappenzustand
 * als Trockenlauf der Abbildung auf den Media Core (je Zustand und Herkunft Unterdrückung, Bindung oder keine Zeile; Summe gleich der
 * Zahl der Gebiete mit `coat`). Dazu der Befund `coat_columns_superseded` (Information). Der Wiki-Schnappschuss (Migration 0162): je Artikel
 * die Werte und die Felder „unbekannt“ gleich der Regel `snapshotFrom` über dieselbe Quelle.
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Der Vertrag nennt keine Sollzahlen (kein Satz mit E4 gezogen, UNKNOWN). Nur
 * lesend; auch der Wappenzustand wird nur gerechnet, nie geschrieben.
 */

export interface TerritoryDetailsParityReport {
    passed: boolean;
    /** Kein Gebiet trug `detail` (älterer Export): der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    /** Die Befunde der Umwandlung (der Import hat sie gemeldet) und der Befund `coat_columns_superseded`. */
    findings: Finding[];
}

/** Spaltennamen, die an den Tabellen von E4 nie stehen dürfen (Vertrag `verifier`: keine Lizenz-, Datei- oder Wappenspalte). */
const FORBIDDEN_COLUMNS = [
    "coat_ref",
    "coat_state",
    "coat_origin",
    "coat_license_status",
    "license_status",
    "license_text",
    "author",
    "attribution",
    "file_url",
    "file_path",
    "storage_key",
] as const;

export async function verifyTerritoryDetails(
    database: Database,
    payload: unknown,
): Promise<TerritoryDetailsParityReport> {
    const index = await readTerritoryDetailIndex(database);
    const expected = transformTerritoryDetails(payload, index);
    if (expected.detailPart === "block_missing") {
        return { passed: true, skipped: true, checks: [], findings: expected.findings };
    }
    const checks: ParityCheck[] = [];
    const findings: Finding[] = [...expected.findings];

    // Gebiete, deren Zeile der Editor hält (unterdrückt oder stillgelegt): der Import fasst sie nie an, die Quelle sagt dazu nichts mehr.
    const heldRows = await database<{ territory_id: string }[]>`
        SELECT territory_id::text FROM territory_detail
        WHERE state = 'suppressed' OR (state = 'retired' AND retired_origin = 'editor')
    `;
    const heldOut = new Set(heldRows.map((row) => row.territory_id));
    const details = expected.details.filter((row) => !heldOut.has(row.territoryId));
    const nameOfId = new Map(expected.details.map((row) => [row.territoryId, row.territoryName]));
    const label = (key: string): string => `${nameOfId.get(key) ?? "Gebiet mit Id"} (${key})`;

    // ---- Anzahl --------------------------------------------------------------------------------------------------------------------
    const stored = await count(database, `SELECT count(*) FROM territory_detail WHERE state = 'active'`);
    const fieldOffenders: string[] = [];
    for (const field of DETAIL_FIELDS) {
        const [row] = await database.unsafe<{ v: number; e: number; m: number }[]>(
            `SELECT count(*) FILTER (WHERE ${field} IS NOT NULL AND ${field} <> '')::int AS v,
                    count(*) FILTER (WHERE ${field} = '')::int AS e,
                    count(*) FILTER (WHERE ${field} IS NULL)::int AS m
               FROM territory_detail WHERE state = 'active'`,
        );
        const want = { v: 0, e: 0, m: 0 };
        for (const detail of details) {
            const value = detail.values[field];
            if (value === null) want.m += 1;
            else if (value === "") want.e += 1;
            else want.v += 1;
        }
        // Die Gebiete, die der Editor hält, stehen in der Datenbank und nicht in `details`; ihre Zeilen zählen hier nicht (state active).
        if (row?.v !== want.v || row?.e !== want.e || row?.m !== want.m) {
            fieldOffenders.push(
                `${field}: Werte ${String(row?.v)} / Leerwerte ${String(row?.e)} / fehlend ${String(row?.m)} statt ${String(want.v)} / ${String(want.e)} / ${String(want.m)}`,
            );
        }
    }
    checks.push(
        check(
            "counts",
            stored === details.length && fieldOffenders.length === 0,
            `territory_detail ${String(stored)} von ${String(details.length)} Gebieten mit mindestens einem Feld (nach Abzug der als nicht speicherbar gemeldeten); je Feld Werte, Leerwerte und fehlende gleich der Quelle`,
            [`${String(stored)} statt ${String(details.length)} Zeilen`]
                .filter(() => stored !== details.length)
                .concat(fieldOffenders),
        ),
    );

    // ---- Feld für Feld ---------------------------------------------------------------------------------------------------------------
    const actual = new Map(
        (await readTableCells(database, "territory_detail", DETAIL_COLUMNS, "t.state = 'active'")).map((cells) => [
            String(cells[0]),
            cells,
        ]),
    );
    const wanted = new Map<string, Cell[]>(details.map((row) => [row.territoryId, detailCells(row)]));
    const rowOffenders = compareRows(
        wanted,
        actual,
        DETAIL_COLUMNS.map((column) => column.name),
        label,
    );
    checks.push(
        check(
            "fields",
            rowOffenders.length === 0,
            rowOffenders.length === 0
                ? `${String(actual.size)} Detailzeilen gleich der Quelle: NULL bleibt NULL, der bewusste Leerwert bleibt leer (nie zu NULL gemacht), Texte wörtlich`
                : `${String(rowOffenders.length)} Detailzeilen weichen ab`,
            rowOffenders,
        ),
    );

    // ---- Herkunft --------------------------------------------------------------------------------------------------------------------
    const originRows = await database<{ territory_id: string; field: string; origin: string }[]>`
        SELECT d.territory_id::text, o.field, o.origin
        FROM territory_detail_field_origin o JOIN territory_detail d ON d.id = o.territory_detail_id
        WHERE d.state = 'active'
    `;
    const haveOrigins = new Map<string, string[]>();
    for (const row of originRows) {
        const list = haveOrigins.get(row.territory_id) ?? [];
        list.push(`${row.field}=${row.origin}`);
        haveOrigins.set(row.territory_id, list);
    }
    const originOffenders: string[] = [];
    for (const row of details) {
        const want = originCells(row)
            .map((cells) => `${String(cells[0])}=${String(cells[1])}`)
            .sort();
        const have = [...(haveOrigins.get(row.territoryId) ?? [])].sort();
        if (JSON.stringify(want) !== JSON.stringify(have)) {
            originOffenders.push(
                `${label(row.territoryId)}: ${have.join(", ") || "kein Vermerk"} statt ${want.join(", ") || "kein Vermerk"}`,
            );
        }
    }
    const emptyWithoutOverride = await count(
        database,
        `SELECT count(*) FROM (
             SELECT d.id, f.field, f.value FROM territory_detail d
             CROSS JOIN LATERAL (VALUES ${DETAIL_FIELDS.map((field) => `('${field}', d."${field}")`).join(", ")}) AS f(field, value)
             WHERE d.state = 'active' AND f.value = ''
               AND NOT EXISTS (SELECT 1 FROM territory_detail_field_origin o
                                WHERE o.territory_detail_id = d.id AND o.field = f.field AND o.origin = 'override')
         ) leer`,
    );
    const originWithoutValue = await count(
        database,
        `SELECT count(*) FROM (
             SELECT o.territory_detail_id FROM territory_detail_field_origin o
             JOIN territory_detail d ON d.id = o.territory_detail_id
             CROSS JOIN LATERAL (VALUES ${DETAIL_FIELDS.map((field) => `('${field}', d."${field}")`).join(", ")}) AS f(field, value)
             WHERE o.field = f.field AND f.value IS NULL
         ) ohne`,
    );
    checks.push(
        check(
            "origin",
            originOffenders.length === 0 && emptyWithoutOverride === 0 && originWithoutValue === 0,
            originOffenders.length === 0 && emptyWithoutOverride === 0 && originWithoutValue === 0
                ? "der leere Wert hat nur die Herkunft override; jeder Vermerk entspricht der Liste detail_overrides der Quelle (Text ohne Eintrag ist wiki); kein Vermerk an einem Feld ohne Wert"
                : `${String(originOffenders.length)} Zeilen mit abweichender Herkunft, ${String(emptyWithoutOverride)} leere Werte ohne Herkunft override, ${String(originWithoutValue)} Vermerke ohne Wert`,
            originOffenders,
        ),
    );

    // ---- Fremdschlüssel ----------------------------------------------------------------------------------------------------------------
    const inactive = await count(
        database,
        `SELECT count(*) FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE d.state = 'active' AND NOT t.is_active`,
    );
    const doubled = await count(
        database,
        `SELECT count(*) FROM (SELECT territory_id FROM territory_detail GROUP BY territory_id HAVING count(*) > 1) d`,
    );
    const orphanOrigins = await count(
        database,
        `SELECT count(*) FROM territory_detail_field_origin o JOIN territory_detail d ON d.id = o.territory_detail_id WHERE d.state <> 'active'`,
    );
    checks.push(
        check(
            "foreign_keys",
            inactive === 0 && doubled === 0 && orphanOrigins === 0,
            inactive === 0 && doubled === 0 && orphanOrigins === 0
                ? "jede aktive Detailzeile zeigt auf eine aktive Gebietszeile, je Gebiet höchstens eine Zeile, keine Herkunftsvermerke an einer stillgelegten Zeile"
                : `${String(inactive)} aktive Detailzeilen an stillgelegten Gebieten, ${String(doubled)} Gebiete mit mehreren Zeilen, ${String(orphanOrigins)} Vermerke an nicht aktiven Zeilen`,
        ),
    );

    // ---- Wiki-Schnappschuss (Migration 0162) ------------------------------------------------------------------------------------------
    const [present] = await database<
        { present: string | null }[]
    >`SELECT to_regclass('wiki_territory_snapshot')::text AS present`;
    if (present?.present != null) {
        const snapshotActual = new Map(
            (await readTableCells(database, "wiki_territory_snapshot", SNAPSHOT_COLUMNS, "t.is_active")).map(
                (cells) => [String(cells[0]), cells],
            ),
        );
        const snapshotWanted = new Map<string, Cell[]>(
            expected.snapshots.map((row) => [row.wikiKey, snapshotCells(row)]),
        );
        const snapshotOffenders = compareRows(
            snapshotWanted,
            snapshotActual,
            SNAPSHOT_COLUMNS.map((column) => column.name),
            (key) => key,
        );
        const unknownRows = await database<{ wiki_key: string; fields: string[] }[]>`
            SELECT s.wiki_key, array_agg(u.field ORDER BY u.field) AS fields
            FROM wiki_territory_snapshot_unknown u JOIN wiki_territory_snapshot s ON s.id = u.snapshot_id
            WHERE s.is_active GROUP BY s.wiki_key
        `;
        const unknownActual = new Map(unknownRows.map((row) => [row.wiki_key, row.fields.join(",")]));
        const unknownOffenders = expected.snapshots
            .filter((row) => [...row.unknown].sort().join(",") !== (unknownActual.get(row.wikiKey) ?? ""))
            .map((row) => row.wikiKey);
        const unknownTotal = expected.snapshots.reduce((sum, row) => sum + row.unknown.length, 0);
        checks.push(
            check(
                "wiki_snapshot",
                snapshotOffenders.length === 0 && unknownOffenders.length === 0,
                snapshotOffenders.length === 0 && unknownOffenders.length === 0
                    ? `${String(snapshotActual.size)} Wiki-Schnappschüsse gleich der Quelle (Herkunft wiki gibt den Wert), ${String(unknownTotal)} Felder mit unbekanntem Wiki-Wert`
                    : `${String(snapshotOffenders.length)} Schnappschüsse und ${String(unknownOffenders.length)} Sätze „unbekannt“ weichen ab`,
                [...snapshotOffenders, ...unknownOffenders],
            ),
        );
    }

    // ---- Struktur ----------------------------------------------------------------------------------------------------------------------
    const structure = await forbiddenColumns(database, TERRITORY_DETAIL_TABLES, FORBIDDEN_COLUMNS);
    const coatLike = await database<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY(${[...TERRITORY_DETAIL_TABLES]}::text[])
          AND (column_name ~ '(^|_)(coat|wappen|licen[cs]e|file|url|path)(_|$)')
    `;
    const structureOffenders = [
        ...structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ...coatLike.map((row) => `${row.table_name}.${row.column_name} (Wappen-, Lizenz- oder Dateispalte)`),
    ];
    checks.push(
        check(
            "structure",
            structureOffenders.length === 0,
            structureOffenders.length === 0
                ? "kein JSON-Typ, kein entity_type, keine Lizenz-, Datei- oder Wappenspalte in territory_detail und territory_detail_field_origin"
                : `${String(structureOffenders.length)} verbotene Spalten`,
            [...new Set(structureOffenders)],
        ),
    );

    // ---- Wappenzustand: Trockenlauf der Abbildung auf den Media Core ----------------------------------------------------------------------
    const summary = expected.coatSummary;
    const states = summary.undecided + summary.none + summary.set;
    const outcomes = summary.suppressions + summary.bindings + summary.omitted;
    const both = await count(
        database,
        `SELECT count(*) FROM territory_media_suppression s
           JOIN territory_media m ON m.territory_id = s.territory_id AND m.role = s.role AND m.retired_at IS NULL`,
    );
    if (expected.coatPart === "planned") {
        checks.push(
            check(
                "coat_mapping",
                states === expected.coats.length &&
                    outcomes === expected.coats.length &&
                    expected.coats.length === expected.withCoat &&
                    both === 0,
                states === expected.coats.length && outcomes === expected.coats.length && both === 0
                    ? `${String(expected.coats.length)} Gebiete mit coat (von ${String(expected.territories)}): undecided ${String(summary.undecided)} + none ${String(summary.none)} + set ${String(summary.set)}; Unterdrückung ${String(summary.suppressions)} + Bindung ${String(summary.bindings)} + keine Zeile ${String(summary.omitted)} (nur durchgerechnet); keine Unterdrückung und aktive Bindung derselben Rolle am selben Gebiet`
                    : `Zustände ${String(states)}, Abbildungen ${String(outcomes)}, Gebiete mit coat ${String(expected.coats.length)} (Antwort: ${String(expected.withCoat)}), Gebiete mit Unterdrückung und Bindung zugleich ${String(both)}`,
            ),
        );
    }

    // ---- Befund: die alten Spalten gegen den Zustand von E4 (Information) --------------------------------------------------------------------
    if (expected.coatPart === "planned") {
        const columns = await database<{ public_id: string; name: string; coat_ref: string | null }[]>`
            SELECT public_id::text, name, coat_ref FROM territory WHERE is_active
        `;
        const byId = new Map(columns.map((row) => [row.public_id, row]));
        const divergent: FindingObject[] = [];
        let compared = 0;
        for (const plan of expected.coats) {
            const row = byId.get(plan.territoryPublicId);
            if (row === undefined) continue;
            compared += 1;
            const have = (row.coat_ref ?? "").replace(/\?v=\d+$/, "");
            if (have !== (plan.facts.url ?? "")) {
                divergent.push({ table: "territory", publicId: row.public_id, name: row.name });
            }
        }
        if (divergent.length > 0) {
            findings.push(
                createFinding(
                    "coat_columns_superseded",
                    `${String(divergent.length)} von ${String(compared)} Gebieten tragen in territory.coat_ref eine andere Adresse als coat.url in E4 (bis zur Ablösung der drei Spalten erwartbar: die alten Felder nennen bei Wiki-Wappen den Pfad der Kopie, E4 die gespeicherte Adresse; Information)`,
                    { abweichend: divergent.length, verglichen: compared },
                    divergent,
                ),
            );
        }
    }

    const settled = settleChecks("verify:territory-details", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings };
}
