import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { Finding } from "../findings.ts";
import { STAETTEN_COLUMNS, staetteCells, staetteKey } from "./staetten-import.ts";
import { transformRohquellen } from "./staetten-rohquellen.ts";
import { transformStaetten } from "./staetten.ts";
import { verifyStaettenRohquellen } from "./verify-staetten-rohquellen.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import { blankTextCount, check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";

/**
 * Parität der Stätten gegen dieselbe `map-features.json`, aus der importiert wurde (WI-0109, Vertrag `staetten.yaml`, `verifier`).
 *
 * Geprüft wird: Anzahl der aktiven Zeilen gegen die speicherbaren des Exports, jede Zeile Spalte für Spalte (NULL bleibt NULL),
 * der Schlüssel ist der gefaltete Siedlungsname (`settlement_key = lower(btrim(settlement_name))`), der Sprung hat eine Kennung
 * (`on_map` nur mit `legacy_public_id`) und trifft eine Ortszeile, die Struktur (kein `place_id`, kein JSON, kein `entity_type`,
 * keine erfundene Art) und die Wirkung am Bestand (wie viele Orte eine Zeile bekommen, Median, Höchstwert).
 *
 * Seit WI-0134 (Vertrag Version 2) mit `rohquellen` auch die Stätten über Kennungen (`verify-staetten-rohquellen.ts`): die Prüfungen
 * `kennungen_*` und `sitze_getrennt` hängen hinten an. Ohne X4 bleiben es genau die bisherigen sechs.
 *
 * 🔴 **Nichts hier hält einen Lauf an** (Betreiber 2026-10-03). Nur lesend.
 */

/** Das Trennzeichen im Schlüssel des Abgleichs (`staetteKey`): Siedlung, Name, Kennung. */
const KEY_SEPARATOR = String.fromCharCode(0x1f);

export interface StaettenParityReport {
    passed: boolean;
    /** Der Block fehlte oder war leer: der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

/**
 * Spalten, die an einer Stätte nie stehen dürfen: kein Lageurteil als Objektmerkmal, kein `is_outside` (MCS-012).
 *
 * 🪤 `place_id` und `settlement_public_id` standen hier bis WI-0134 als verboten. Das war eine Grenze des Exports, keine Modellregel
 * (Analyse `wi-0128-korrektur-ort-staetten-2026-10-10.md` §5, A3). Seit Vertrag Version 2 gibt es den Ort einer Stätte, aber NUR aus
 * einer Kennung und nur in `site_settlement`; das prüft `kennungen_relations` mit SQL. An `settlement_place` kommt er nicht dazu.
 */
const FORBIDDEN_COLUMNS = ["scope", "is_outside", "entity_type", "art"] as const;

export interface VerifyStaettenOptions {
    /** Legacys Rohquellen-Export X4 desselben Zuges (WI-0134); ohne ihn nur die bisherigen Prüfungen. */
    rohquellen?: unknown;
}

export async function verifyStaetten(
    database: Database,
    payload: unknown,
    options: VerifyStaettenOptions = {},
): Promise<StaettenParityReport> {
    const expected = transformStaetten(payload);
    const v2 = options.rohquellen === undefined ? null : transformRohquellen(options.rohquellen);
    const v2Checks = v2 === null || v2.skipped ? [] : await verifyStaettenRohquellen(database, v2);
    if (expected.skipped) {
        const settled = settleChecks("verify:staetten", v2Checks);
        return {
            passed: settled.passed,
            skipped: v2Checks.length === 0,
            checks: settled.checks,
            findings: [...expected.findings, ...(v2?.findings ?? [])],
        };
    }
    const checks: ParityCheck[] = [];

    // ---- Anzahl ------------------------------------------------------------------------------------------------------------------
    const stored = await count(
        database,
        `SELECT count(*) FROM settlement_place WHERE source_system = 'legacy' AND is_active`,
    );
    checks.push(
        check(
            "counts",
            stored === expected.rows.length,
            `settlement_place ${String(stored)} aktive Zeilen gegen ${String(expected.rows.length)} speicherbare des Exports (${String(expected.counts.delivered)} geliefert, ${String(expected.counts.types)} Arten, ${String(expected.counts.settlements)} Siedlungen)`,
        ),
    );

    // ---- Zeile für Zeile ---------------------------------------------------------------------------------------------------------
    const actual = new Map(
        (
            await readTableCells(
                database,
                "settlement_place",
                STAETTEN_COLUMNS,
                "t.source_system = 'legacy' AND t.is_active",
            )
        ).map((cells) => [staetteKey(cells), cells]),
    );
    const wanted = new Map<string, Cell[]>(
        expected.rows.map((row) => [staetteKey(staetteCells(row)), staetteCells(row)]),
    );
    const rowOffenders = compareRows(
        wanted,
        actual,
        STAETTEN_COLUMNS.map((column) => column.name),
        (key) => `Stätte ${key.split(KEY_SEPARATOR).join(" · ")}`,
    );
    const blank = await blankTextCount(database, "settlement_place", ["place_type", "wiki_url"]);
    checks.push(
        check(
            "rows",
            rowOffenders.length === 0 && blank === 0,
            rowOffenders.length === 0 && blank === 0
                ? `${String(actual.size)} Stätten gleich dem Export (Siedlung, Name, Art, Adresse, Kennung, auf der Karte); NULL bleibt NULL, keine leere Zeichenkette`
                : `${String(rowOffenders.length)} Stätten weichen ab, ${String(blank)} mit leerer Zeichenkette`,
            rowOffenders,
        ),
    );

    // ---- Der Schlüssel IST der gefaltete Name ---------------------------------------------------------------------------------------
    const unfolded = await count(
        database,
        `SELECT count(*) FROM settlement_place WHERE settlement_key <> lower(btrim(settlement_name))`,
    );
    checks.push(
        check(
            "settlement_key_folded",
            unfolded === 0,
            unfolded === 0
                ? "jeder Schlüssel ist lower(btrim(settlement_name)) - Legacys avesmapsStaettenSchluessel, dieselbe Faltung wie der Lesepfad"
                : `${String(unfolded)} Zeilen tragen einen Schlüssel, der nicht der gefaltete Siedlungsname ist`,
        ),
    );

    // ---- Der Sprung ⊕ --------------------------------------------------------------------------------------------------------------
    const jumpWithoutId = await count(
        database,
        `SELECT count(*) FROM settlement_place WHERE on_map AND legacy_public_id IS NULL`,
    );
    const jumpUnknown = await database<{ id: string; name: string }[]>`
        SELECT s.legacy_public_id::text AS id, s.name
        FROM settlement_place s
        WHERE s.is_active AND s.on_map
          AND NOT EXISTS (SELECT 1 FROM place p WHERE p.public_id = s.legacy_public_id AND p.is_active)
    `;
    checks.push(
        check(
            "jump_targets",
            jumpWithoutId === 0,
            jumpWithoutId === 0
                ? `${String(expected.counts.onMap)} Stätten stehen auf der Karte, jede mit Kennung; ${String(jumpUnknown.length)} davon treffen keinen aktiven Ort (dann zeigt das Panel keinen Sprung - nie ein toter Link)`
                : `${String(jumpWithoutId)} Zeilen behaupten „auf der Karte" ohne Kennung`,
            jumpUnknown.map((row) => `${row.name} → ${row.id} (kein aktiver Ort)`),
        ),
    );

    // ---- Struktur ----------------------------------------------------------------------------------------------------------------
    const structure = await forbiddenColumns(database, ["settlement_place"], FORBIDDEN_COLUMNS);
    const invented = await count(database, `SELECT count(*) FROM settlement_place WHERE place_type = 'Bauwerk'`);
    const expectedInvented = expected.rows.filter((row) => row.placeType === "Bauwerk").length;
    const structureOffenders = structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`);
    checks.push(
        check(
            "structure",
            structureOffenders.length === 0 && invented === expectedInvented,
            structureOffenders.length === 0 && invented === expectedInvented
                ? `keine Spalte scope, is_outside, entity_type oder art, kein JSON-Typ; „Bauwerk" steht ${String(invented)}-mal in der Spalte und genauso oft im Export (der Rückfall ist Anzeige, kein Datum)`
                : structureOffenders.length > 0
                  ? `${String(structureOffenders.length)} verbotene Spalten`
                  : `„Bauwerk" steht ${String(invented)}-mal in der Spalte, aber ${String(expectedInvented)}-mal im Export - der Anzeigerückfall ist in die Daten gewandert`,
            structureOffenders,
        ),
    );

    // ---- Wirkung am Bestand --------------------------------------------------------------------------------------------------------
    const [effect] = await database<{ orte: string; median: string | null; hoechstens: string | null }[]>`
        WITH je_ort AS (
            SELECT p.public_id, count(*) AS n
            FROM place p
            JOIN settlement_place s ON s.settlement_key = lower(btrim(p.name)) AND s.is_active AND s.state = 'active'
            WHERE p.is_active
            GROUP BY p.public_id
        )
        SELECT count(*)::text AS orte,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY n)::text AS median,
               max(n)::text AS hoechstens
        FROM je_ort
    `;
    checks.push(
        check(
            "effect",
            true,
            `${String(effect?.orte ?? 0)} aktive Orte bekommen die Zeile „Stätten"; Median ${String(effect?.median ?? 0)} Stätten, höchstens ${String(effect?.hoechstens ?? 0)}`,
        ),
    );

    const settled = settleChecks("verify:staetten", [...checks, ...v2Checks]);
    return {
        passed: settled.passed,
        skipped: false,
        checks: settled.checks,
        findings: [...expected.findings, ...(v2?.findings ?? [])],
    };
}
