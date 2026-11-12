import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { Finding } from "../findings.ts";
import { listWikiSettlementRows } from "../editor/wiki-settlement-rows.ts";
import { countNamedPlaces, describeNamedPlaces, readSettlementKeyIndex } from "./staetten-genannte-orte.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import { blankTextCount, check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";
import { WIKI_SETTLEMENT_COLUMNS, wikiSettlementCells, wikiSettlementKey } from "./wiki-settlements-import.ts";
import { transformWikiSettlements } from "./wiki-settlements.ts";

/**
 * Parität der Wiki-Siedlungsregistry gegen dieselbe Antwort von X3, aus der importiert wurde (WI-0128 E4, Migration 0089).
 *
 * Geprüft wird: Anzahl der aktiven Zeilen gegen die speicherbaren der Antwort, jede Zeile Spalte für Spalte (NULL bleibt NULL), die
 * Struktur (keine Spalte, die „platziert“ speichert, kein JSON), die Zuordnung (Legacys `orte` gegen unseren Lookup über X2: beide über
 * denselben Key, also gleich, wenn X2 und X3 aus demselben Stand kommen) und die Wirkung (unsere Zahl „Fehlt“ aus dem echten Leser gegen
 * Legacys Zahl, die per Namen rechnet). Seit WI-0134 auch die Linkziele der `standort`-Kette (`standort_links`, Zeile für Zeile in ihrer
 * Reihenfolge, der Key wörtlich) und, als Zahl, wie viele Ketten über ihre Keys genau eine Siedlung nennen (Evidenz, keine Bindung).
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Nur lesend.
 */

export interface WikiSettlementsParityReport {
    passed: boolean;
    /** Die Antwort war unbrauchbar oder leer: der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

/**
 * Spalten, die an der Registry nie stehen dürfen. 🔴 `place_id`, `on_map`, `legacy_on_map`, `place_count`: „platziert“ entscheidet der
 * Leser zur Laufzeit über den Key; eine gespeicherte Antwort wäre beim nächsten gesetzten Ort falsch, und Legacys Namensurteil ist nie
 * ein Schlüssel.
 */
const FORBIDDEN_COLUMNS = [
    "place_id",
    "on_map",
    "legacy_on_map",
    "place_count",
    "match_key",
    "coat_url",
    "entity_type",
];

export async function verifyWikiSettlements(
    database: Database,
    payload: unknown,
): Promise<WikiSettlementsParityReport> {
    const expected = transformWikiSettlements(payload);
    if (expected.skipped) return { passed: true, skipped: true, checks: [], findings: expected.findings };
    const checks: ParityCheck[] = [];
    const active = "t.source_system = 'legacy' AND t.is_active";

    // ---- Anzahl --------------------------------------------------------------------------------------------------------------------
    const stored = await count(
        database,
        "SELECT count(*) FROM wiki_settlement_registry WHERE source_system = 'legacy' AND is_active",
    );
    checks.push(
        check(
            "counts",
            stored === expected.rows.length,
            `wiki_settlement_registry ${String(stored)} aktive Zeilen gegen ${String(expected.rows.length)} speicherbare der Antwort (${String(expected.counts.delivered)} geliefert, ${String(expected.counts.withoutKey)} ohne Key, ${String(expected.counts.duplicateKeys)} doppelter Key)`,
        ),
    );

    // ---- Zeile für Zeile -----------------------------------------------------------------------------------------------------------
    const actual = new Map(
        (await readTableCells(database, "wiki_settlement_registry", WIKI_SETTLEMENT_COLUMNS, active)).map((cells) => [
            wikiSettlementKey(cells),
            cells,
        ]),
    );
    const wanted = new Map<string, Cell[]>(expected.rows.map((row) => [row.wikiKey, wikiSettlementCells(row)]));
    const rowOffenders = compareRows(
        wanted,
        actual,
        WIKI_SETTLEMENT_COLUMNS.map((column) => column.name),
    );
    const blank = await blankTextCount(database, "wiki_settlement_registry", [
        "wiki_url",
        "settlement_label",
        "building_type",
        "continent",
        "lage",
        "standort",
    ]);
    checks.push(
        check(
            "rows",
            rowOffenders.length === 0 && blank === 0,
            rowOffenders.length === 0 && blank === 0
                ? `${String(actual.size)} Siedlungen gleich der Antwort (Key, Titel, Namensraum, Weiterleitung, Klasse, Bauwerk, Ruine, Kontinent, Lage, Standort, Wappen, Stand); NULL bleibt NULL`
                : `${String(rowOffenders.length)} Siedlungen weichen ab, ${String(blank)} mit leerer Zeichenkette`,
            rowOffenders,
        ),
    );

    // ---- Struktur ------------------------------------------------------------------------------------------------------------------
    const structure = (await forbiddenColumns(database, ["wiki_settlement_registry"], FORBIDDEN_COLUMNS)).map(
        (row) => `${row.table_name}.${row.column_name} (${row.data_type})`,
    );
    checks.push(
        check(
            "structure",
            structure.length === 0,
            structure.length === 0
                ? "keine Spalte, die „platziert“ oder ein Namensurteil speichert, keine Wappenadresse, kein JSON-Typ"
                : `${String(structure.length)} verbotene Spalten`,
            structure,
        ),
    );

    // ---- Zuordnung: Legacys `orte` gegen unseren Lookup über X2 ---------------------------------------------------------------------
    const ours = new Map<string, string[]>();
    for (const row of await database<{ key: string; id: string }[]>`
        SELECT a.wiki_key AS key, p.public_id::text AS id
        FROM wiki_key_assignment a JOIN place p ON p.public_id = a.object_public_id
        WHERE a.is_active AND a.legacy_art = 'siedlung' AND p.is_active
        ORDER BY a.wiki_key, p.public_id
    `) {
        const list = ours.get(row.key);
        if (list === undefined) ours.set(row.key, [row.id]);
        else list.push(row.id);
    }
    const placementOffenders: string[] = [];
    for (const entry of expected.evidence) {
        const legacy = [...entry.places].sort();
        const here = ours.get(entry.wikiKey) ?? [];
        if (legacy.join(",") !== here.join(",")) {
            placementOffenders.push(
                `${entry.title} (${entry.wikiKey}): Legacy ${legacy.length === 0 ? "kein Ort" : legacy.join(", ")}, X2 hier ${here.length === 0 ? "kein Ort" : here.join(", ")}`,
            );
        }
    }
    checks.push(
        check(
            "placement",
            placementOffenders.length === 0,
            placementOffenders.length === 0
                ? `${String(expected.counts.withPlace)} Siedlungen tragen einen Ort, und genau diese Orte nennt auch die Zuordnung X2 hier`
                : `${String(placementOffenders.length)} Siedlungen: Legacys Orte und die Zuordnung X2 hier weichen ab (X2 und X3 aus verschiedenen Ständen, oder ein Ort fehlt hier)`,
            placementOffenders,
        ),
    );

    // ---- Wirkung: der echte Leser der Ortsliste gegen Legacys Zahl (Vorgabe Aventurien, ein leerer Kontinent zählt dazu) --------------
    const missing = (await listWikiSettlementRows(database, "aventuria")).rows;
    const onMapByName = new Map(expected.evidence.map((entry) => [entry.wikiKey, entry.legacyOnMap]));
    const aventurian = expected.rows.filter(
        (row) => !row.buildingTypeExcluded && (row.continent === null || row.continent === "Aventurien"),
    );
    const legacyMissing = aventurian.filter((row) => onMapByName.get(row.wikiKey) !== true).length;
    const nameOnly = new Set(
        expected.findings
            .find((finding) => finding.code === "registry_nur_per_name_platziert")
            ?.objects.map((object) => object.publicId) ?? [],
    );
    const nameOnlyHere = aventurian.filter((row) => nameOnly.has(row.wikiKey)).length;
    checks.push(
        check(
            "effect",
            true,
            `„Fehlt“, Wiki-Siedlungen in Aventurien: ${String(missing.length)} hier, ${String(legacyMissing)} in Legacys Liste; ${String(nameOnlyHere)} hält Legacy nur per Namen für platziert, ${String(expected.counts.excluded)} blenden beide aus, ${String(expected.rows.length - expected.counts.excluded - aventurian.length)} liegen auf anderen Kontinenten`,
        ),
    );

    // ---- Linkziele der Standortkette (WI-0134): wie geliefert, in ihrer Reihenfolge ----------------------------------------------------
    if (expected.linksDelivered) {
        const stored = await database<{ key: string; position: number; target: string; target_key: string | null }[]>`
            SELECT r.wiki_key AS key, n.position, n.target_raw AS target, n.target_key
              FROM wiki_settlement_registry_named_place n JOIN wiki_settlement_registry r ON r.id = n.registry_id
             WHERE r.is_active AND r.source_system = 'legacy'
             ORDER BY r.wiki_key, n.position
        `;
        const have = new Map<string, string[]>();
        for (const row of stored) {
            const list = have.get(row.key) ?? [];
            list.push(`${String(row.position)}:${row.target}→${row.target_key ?? "∅"}`);
            have.set(row.key, list);
        }
        const offenders: string[] = [];
        let total = 0;
        for (const [key, links] of expected.links) {
            total += links.length;
            const want = links.map((link) => `${String(link.position)}:${link.targetRaw}→${link.targetKey ?? "∅"}`);
            if ((have.get(key) ?? []).join("|") !== want.join("|")) offenders.push(`${key}: Linkziele weichen ab`);
        }
        for (const key of have.keys()) if (!expected.links.has(key)) offenders.push(`${key}: Linkziele zu viel`);
        checks.push(
            check(
                "standort_links",
                offenders.length === 0,
                offenders.length === 0
                    ? `${String(total)} Linkziele der Standortkette wie geliefert, in ihrer Reihenfolge, Key wörtlich (ohne Key bleibt ohne Key)`
                    : `${String(offenders.length)} Siedlungen mit abweichenden Linkzielen`,
                offenders,
            ),
        );

        // ---- Genannte Orte als Zahl: welche Ketten über ihre Keys genau eine Siedlung nennen (Information, keine Bindung) ---------------
        const chains = expected.rows
            .filter((row) => row.standort !== null)
            .map((row) => (expected.links.get(row.wikiKey) ?? []).map((link) => link.targetKey));
        checks.push(
            check(
                "genannte_orte",
                true,
                `${String(chains.length)} Wiki-Siedlungen mit Standort: ${describeNamedPlaces(countNamedPlaces(chains, await readSettlementKeyIndex(database)))} (Evidenz über die Zuordnung X2; kein Lageurteil, keine Bindung)`,
            ),
        );
    }

    const settled = settleChecks("verify:wiki-settlements", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings: expected.findings };
}
