import { settleChecks } from "../blocking-checks.ts";
import type { Database, Queryable } from "../database.ts";
import type { Finding } from "../findings.ts";
import type { MapFeaturesPayload } from "./map-features.ts";
import { leseNamespaceTafelImSchnitt } from "../kanon/tafel.ts";
import {
    CORPUS_COLUMNS,
    SOURCE_COLUMNS,
    SOURCE_TABLES,
    kanonNachRegel,
    readSourceCarriers,
    type SourceTable,
} from "./sources-import.ts";
import {
    transformSources,
    urlHash,
    type CanonCarrierKind,
    type CarrierKind,
    type SourcesTransform,
} from "./sources.ts";
import { canon, readTableCells, type Cell } from "./sync-table.ts";

/**
 * Parität der Feature-Quellen gegen denselben Satz, aus dem importiert wurde (WI-0063 P3, Vertrag `sources.yaml`, `verifier`).
 *
 * Geprüft wird das AGGREGAT: Katalog und Korpus Spalte für Spalte, jede Verknüpfung je Trägerart (Art, Seiten, Notiz, Herkunft,
 * Reihenfolge) und der Kanon je Träger gegen die neu gerechnete Umwandlung; die Verteilung der Art der Quelle; Lizenzaussage
 * und -schlüssel; die Waisen und das Zurückgestellte, die zusammen die Verweise des Satzes ergeben; keine Vererbung (je
 * Verknüpfung genau der Träger der Quelle, nichts aggregiert); keine `entity_type`-Spalte, kein JSON-Typ.
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Die Sollzahlen des Vertrags gelten für den Satz 161832.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    blocking?: boolean;
}

export interface SourcesParityReport {
    passed: boolean;
    revision: number;
    /** Die Quellenblöcke fehlten oder der Katalog war leer: der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): ParityCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

export const CONTRACT_SET_REVISION = 161832;
/** Die Sollzahlen des Vertrags für den Satz 161832. */
export const CONTRACT_NUMBERS = {
    catalog: 3906,
    catalog_provisional: 359,
    catalog_with_url: 3547,
    corpora: 12,
    place_source: 17620,
    path_source: 35515,
    territory_source: 6346,
    region_source: 6423,
    terrain_peak_source: 384,
    links_resolved: 66288,
    links_orphan: 1776,
    links_deferred_citymap: 633,
    links_total: 68697,
    reference_kind_empty: 5442,
    reference_kind_ausfuehrlich: 10356,
    reference_kind_ergaenzend: 21922,
    reference_kind_erwaehnung: 30977,
    license_cc_by_nc_sa_3_0: 2508,
    license_cc_by_sa_4_0: 4,
    license_cc_by_sa_3_0: 1,
    license_unrecorded: 1393,
    kanon_entries_not_taken: 672,
} as const;

const CARRIER_TABLES: Record<CanonCarrierKind, string> = {
    place: "place",
    path: "path",
    territory: "territory",
    region: "region",
    terrain_peak: "terrain_peak",
    powerline: "powerline",
};
const LINKS: Record<CarrierKind, { table: SourceTable; column: string }> = {
    place: { table: "place_source", column: "place_id" },
    path: { table: "path_source", column: "path_id" },
    territory: { table: "territory_source", column: "territory_id" },
    region: { table: "region_source", column: "region_id" },
    terrain_peak: { table: "terrain_peak_source", column: "terrain_peak_id" },
};
const CANONS: Record<CanonCarrierKind, { table: SourceTable; column: string }> = {
    place: { table: "place_canon", column: "place_id" },
    path: { table: "path_canon", column: "path_id" },
    territory: { table: "territory_canon", column: "territory_id" },
    region: { table: "region_canon", column: "region_id" },
    terrain_peak: { table: "terrain_peak_canon", column: "terrain_peak_id" },
    powerline: { table: "powerline_canon", column: "powerline_id" },
};

async function count(database: Queryable, sql: string): Promise<number> {
    const [row] = await database.unsafe<{ n: number }[]>(`SELECT (${sql})::int AS n`);
    return row?.n ?? 0;
}

/** Vergleicht erwartete und gespeicherte Zeilen nach Schlüssel. */
function compareRows(
    expected: ReadonlyMap<string, readonly Cell[]>,
    actual: ReadonlyMap<string, readonly (string | null)[]>,
    columns: readonly string[],
): string[] {
    const offenders: string[] = [];
    for (const [key, want] of expected) {
        const have = actual.get(key);
        if (!have) {
            offenders.push(`${key} fehlt`);
            continue;
        }
        const wrong = columns.filter((_, index) => canon(want[index]) !== have[index]);
        if (wrong.length > 0) offenders.push(`${key}: ${wrong.join(", ")}`);
    }
    for (const key of actual.keys()) if (!expected.has(key)) offenders.push(`${key} ist zu viel`);
    return offenders;
}

export async function verifySources(database: Database, payload: MapFeaturesPayload): Promise<SourcesParityReport> {
    const { targets } = await readSourceCarriers(database);
    const expected: SourcesTransform = transformSources(payload, targets);
    const revision = Number(payload.revision);
    if (expected.skipped) {
        return { passed: true, revision, skipped: true, checks: [], findings: expected.findings };
    }
    const checks: ParityCheck[] = [];

    // ---- Katalog -------------------------------------------------------------------------------------------------------------
    // Was die Redaktion hält, nimmt die Prüfung aus (der Zug fasst es nie an, WI-0254): eine Quelle oder ein Korpus mit `source_system = editor` und die Quellen
    // eines Belegstellen-Korpus MIT Vorgabe, auf die der Zug diese Vorgabe legt (`korpus-vorgabe.ts`).
    const editorKorpus =
        "EXISTS (SELECT 1 FROM source_corpus c WHERE c.corpus_key = t.corpus_key AND c.is_active AND c.form = 'belegstelle' AND (c.source_type IS NOT NULL OR c.is_official IS NOT NULL OR c.license_statement <> 'unrecorded' OR (c.attribution IS NOT NULL AND btrim(c.attribution) <> '')))";
    const gehalten = new Set(
        (
            await database.unsafe<{ source_key: string }[]>(
                `SELECT t.source_key FROM feature_source t WHERE t.source_system = 'editor' OR ${editorKorpus}`,
            )
        ).map((row) => row.source_key),
    );
    const sourceRows = await readTableCells(
        database,
        "feature_source",
        SOURCE_COLUMNS,
        `t.is_active AND t.source_system <> 'editor' AND NOT ${editorKorpus}`,
    );
    const sourceActual = new Map(sourceRows.map((cells) => [String(cells[0]), cells]));
    const sourceWanted = new Map(
        expected.sources
            .filter((row) => !gehalten.has(row.sourceKey))
            .map((row) => [
                row.sourceKey,
                [
                    row.sourceKey,
                    row.identityState,
                    row.legacyId,
                    row.url,
                    row.title,
                    row.sourceType,
                    row.isOfficial,
                    row.licenseStatement,
                    row.licenseKey,
                    row.attribution,
                    row.corpusKey,
                ] as Cell[],
            ]),
    );
    const catalogOffenders = compareRows(
        sourceWanted,
        sourceActual,
        SOURCE_COLUMNS.map((column) => column.name),
    );
    // Die Adresse trägt ihren Hash als Schlüssel: aus der GESPEICHERTEN Adresse neu gerechnet.
    const hashOffenders = sourceRows
        .filter((cells) => cells[3] !== null && cells[0] !== `url:${urlHash(String(cells[3]))}`)
        .map((cells) => `${String(cells[0])}: Hash der Adresse weicht ab`);
    const provisional = sourceRows.filter((cells) => cells[1] === "provisional").length;
    const withUrl = sourceRows.filter((cells) => cells[3] !== null).length;
    checks.push(
        check(
            "catalog_parity",
            catalogOffenders.length === 0 && hashOffenders.length === 0,
            catalogOffenders.length === 0 && hashOffenders.length === 0
                ? `${String(sourceRows.length)} Quellen (${String(withUrl)} mit Adresse, Schlüssel = url: plus SHA-256 der gespeicherten Adresse; ${String(provisional)} vorläufig): Titel, Art, offiziell, Lizenz, Schlüssel, Namensnennung und Korpus wie geliefert`
                : `${String(catalogOffenders.length + hashOffenders.length)} Abweichungen`,
            [...catalogOffenders, ...hashOffenders],
        ),
    );

    // ---- Korpus --------------------------------------------------------------------------------------------------------------
    // Ein Korpus, den die Redaktion angelegt oder geändert hat (`source_system = editor`), fasst der Zug nie an: Die Prüfung nimmt ihn aus.
    const korporaGehalten = new Set(
        (
            await database<
                { corpus_key: string }[]
            >`SELECT corpus_key FROM source_corpus WHERE source_system = 'editor'`
        ).map((row) => row.corpus_key),
    );
    const corpusRows = await readTableCells(
        database,
        "source_corpus",
        CORPUS_COLUMNS,
        "t.is_active AND t.source_system <> 'editor'",
    );
    const corpusOffenders = compareRows(
        new Map(
            expected.corpora
                .filter((row) => !korporaGehalten.has(row.corpusKey))
                .map((row) => [row.corpusKey, [row.corpusKey, row.label, row.form] as Cell[]]),
        ),
        new Map(corpusRows.map((cells) => [String(cells[0]), cells])),
        CORPUS_COLUMNS.map((column) => column.name),
    );
    checks.push(
        check(
            "corpus_parity",
            corpusOffenders.length === 0,
            corpusOffenders.length === 0
                ? `${String(corpusRows.length)} Korpora: Name und Form gleich der Quelle`
                : `${String(corpusOffenders.length)} Abweichungen`,
            corpusOffenders,
        ),
    );
    const [wiki] = await database<
        { license_statement: string; license_key: string | null; attribution: string | null }[]
    >`
        SELECT license_statement, license_key, attribution FROM source_corpus WHERE corpus_key = 'wiki-aventurica.de' AND is_active
    `;
    checks.push(
        check(
            "corpus_license_decision",
            wiki?.license_statement === "license" &&
                wiki.license_key === "cc-by-sa-3.0" &&
                wiki.attribution === "Wiki Aventurica",
            wiki
                ? `wiki-aventurica.de: ${wiki.license_statement} ${String(wiki.license_key)}, Namensnennung „${String(wiki.attribution)}“ (Betreiber 2026-10-04, nur Texte)`
                : "die Korpuszeile wiki-aventurica.de fehlt",
        ),
    );

    // ---- Verknüpfungen --------------------------------------------------------------------------------------------------------
    const linkOffenders: string[] = [];
    const linkCounts: Record<string, number> = {};
    const kindCounts: Record<string, number> = { leer: 0, ausfuehrlich: 0, ergaenzend: 0, erwaehnung: 0 };
    for (const kind of Object.keys(LINKS) as CarrierKind[]) {
        const { table, column } = LINKS[kind];
        const rows = await database.unsafe<Record<string, string | null>[]>(
            `SELECT c.public_id::text AS carrier, s.source_key, l.reference_kind, l.pages, l.note, l.legacy_origin, l.position::text AS position ` +
                `FROM ${table} l JOIN ${CARRIER_TABLES[kind]} c ON c.id = l.${column} JOIN feature_source s ON s.id = l.source_id WHERE l.state = 'active'`,
        );
        linkCounts[table] = rows.length;
        for (const row of rows) {
            const key = row["reference_kind"] ?? "leer";
            kindCounts[key] = (kindCounts[key] ?? 0) + 1;
        }
        const actual = new Map(
            rows.map((row) => [
                `${String(row["carrier"])}|${String(row["source_key"])}`,
                [row["reference_kind"], row["pages"], row["note"], row["legacy_origin"], row["position"]] as (
                    string | null
                )[],
            ]),
        );
        const wanted = new Map(
            expected.links
                .filter((link) => link.kind === kind)
                .map((link) => [
                    `${link.carrierPublicId}|${link.sourceKey}`,
                    [link.referenceKind, link.pages, link.note, link.legacyOrigin, link.position] as Cell[],
                ]),
        );
        for (const text of compareRows(wanted, actual, [
            "reference_kind",
            "pages",
            "note",
            "legacy_origin",
            "position",
        ])) {
            linkOffenders.push(`${table} ${text}`);
        }
    }
    const linkTotal = Object.values(linkCounts).reduce((sum, n) => sum + n, 0);
    checks.push(
        check(
            "link_parity",
            linkOffenders.length === 0,
            linkOffenders.length === 0
                ? `${Object.entries(linkCounts)
                      .map(([table, n]) => `${table} ${String(n)}`)
                      .join(
                          ", ",
                      )} (zusammen ${String(linkTotal)}): Art, Seiten, Notiz, Herkunft und Reihenfolge gleich der Quelle; je Verknüpfung genau der Träger der Quelle, nichts über Weggruppe, Region-Beschriftung oder Gebietsbaum aggregiert (keine Vererbung)`
                : `${String(linkOffenders.length)} Verknüpfungen weichen ab`,
            linkOffenders,
        ),
    );
    const totals = expected.linkTotals;
    checks.push(
        check(
            "link_accounting",
            totals.resolved + totals.orphan + totals.deferred + totals.skipped === totals.total,
            `${String(totals.total)} Verweise im Satz = ${String(totals.resolved)} aufgelöst + ${String(totals.orphan)} Waisen + ${String(totals.deferred)} zurückgestellt (citymap) + ${String(totals.skipped)} ohne Katalogzeile oder doppelt; Art der Quelle über alle: leer ${String(totals.byReferenceKind["leer"] ?? 0)}, ausführlich ${String(totals.byReferenceKind["ausfuehrlich"] ?? 0)}, ergänzend ${String(totals.byReferenceKind["ergaenzend"] ?? 0)}, Erwähnung ${String(totals.byReferenceKind["erwaehnung"] ?? 0)}; nach Abzug der Waisen und Kartensammlung gespeichert: leer ${String(kindCounts["leer"])}, ausführlich ${String(kindCounts["ausfuehrlich"])}, ergänzend ${String(kindCounts["ergaenzend"])}, Erwähnung ${String(kindCounts["erwaehnung"])}`,
        ),
    );

    // ---- Tombstones (E1+) -------------------------------------------------------------------------------------------------------
    const tombstoneOffenders: string[] = [];
    let tombstonesFound = 0;
    for (const kind of Object.keys(LINKS) as CarrierKind[]) {
        const { table, column } = LINKS[kind];
        const rows = await database.unsafe<
            { carrier: string; source_key: string; state: string; legacy_origin: string | null }[]
        >(
            `SELECT c.public_id::text AS carrier, s.source_key, l.state, l.legacy_origin FROM ${table} l JOIN ${CARRIER_TABLES[kind]} c ON c.id = l.${column} JOIN feature_source s ON s.id = l.source_id`,
        );
        const byPair = new Map(rows.map((row) => [`${row.carrier}|${row.source_key}`, row]));
        for (const tombstone of expected.tombstones.filter((entry) => entry.kind === kind)) {
            const row = byPair.get(`${tombstone.carrierPublicId}|${tombstone.sourceKey}`);
            if (row?.state === "suppressed" && row.legacy_origin === tombstone.legacyOrigin) tombstonesFound += 1;
            else
                tombstoneOffenders.push(
                    `${table} ${tombstone.carrierPublicId}|${tombstone.sourceKey}: ${row ? `state ${row.state}` : "fehlt"}`,
                );
        }
    }
    checks.push(
        check(
            "tombstones",
            tombstoneOffenders.length === 0,
            expected.tombstoneBlock === "absent"
                ? "kein Tombstone im Satz: E1+ ist freigegeben, aber noch nicht exportiert (suppressed_not_exported)"
                : `${String(tombstonesFound)} von ${String(expected.tombstones.length)} unterdrückten Verknüpfungen stehen als Tombstone (state suppressed, Herkunft gleich); keine wird belebt`,
            tombstoneOffenders,
        ),
    );

    // ---- Kanon ---------------------------------------------------------------------------------------------------------------------
    // 🔴 Gegen die Regel von Avesmaps3D, nicht gegen Legacys `feature_kanon` (OPS-000066): Der Import schreibt, was die Regel aus dem Stand der
    // Datenbank sagt (`kanonNachRegel`), und genau das muss danach in jeder Kanon-Tafel stehen, nicht mehr und nicht weniger.
    const canonOffenders: string[] = [];
    let canonRows = 0;
    const tafel = await leseNamespaceTafelImSchnitt(database);
    for (const kind of Object.keys(CANONS) as CanonCarrierKind[]) {
        const { table, column } = CANONS[kind];
        const rows = await database.unsafe<Record<string, string | null>[]>(
            `SELECT c.public_id::text AS carrier, k.canon, k.designator_type, k.designator_count::text AS designator_count, k.designator_label, k.derived_from, k.source_revision::text AS source_revision ` +
                `FROM ${table} k JOIN ${CARRIER_TABLES[kind]} c ON c.id = k.${column}`,
        );
        canonRows += rows.length;
        const actual = new Map(
            rows.map((row) => [
                String(row["carrier"]),
                [
                    row["canon"],
                    row["designator_type"],
                    row["designator_count"],
                    row["designator_label"],
                    row["derived_from"],
                    row["source_revision"],
                ] as (string | null)[],
            ]),
        );
        // Die Zellen der Regel ohne die Kennung des Trägers vorn (`canonColumns`), in der Folge der Spalten oben.
        const wanted = new Map(
            (await kanonNachRegel(database, kind, tafel)).map((zeile) => [zeile.publicId, zeile.cells.slice(1)]),
        );
        for (const text of compareRows(wanted, actual, [
            "canon",
            "designator_type",
            "designator_count",
            "designator_label",
            "derived_from",
            "source_revision",
        ])) {
            canonOffenders.push(`${table} ${text}`);
        }
    }
    checks.push(
        check(
            "canon_parity",
            canonOffenders.length === 0,
            canonOffenders.length === 0
                ? `${String(canonRows)} Kanon-Zeilen, jede gleich der Regel von Avesmaps3D (Rang 1 bis 3, Publikationen zählen ohne Wiki-Zuweisung mit); kein Träger ohne Aussage trägt eine`
                : `${String(canonOffenders.length)} Kanon-Zeilen weichen ab`,
            canonOffenders,
        ),
    );

    // ---- Struktur und Waisen ----------------------------------------------------------------------------------------------------
    const structure = await database<{ table_name: string; column_name: string; data_type: string }[]>`
        SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY(${[...SOURCE_TABLES]}::text[])
          AND (column_name = 'entity_type' OR data_type IN ('json', 'jsonb'))
    `;
    checks.push(
        check(
            "structure",
            structure.length === 0,
            structure.length === 0
                ? "keine entity_type-Spalte und kein JSON-Typ in den Tabellen von D1"
                : `${String(structure.length)} verbotene Spalten`,
            structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ),
    );
    const orphanSql = (Object.keys(LINKS) as CarrierKind[])
        .map((kind) => {
            const { table, column } = LINKS[kind];
            return (
                `(SELECT count(*) FROM ${table} l JOIN ${CARRIER_TABLES[kind]} c ON c.id = l.${column} WHERE l.state = 'active' AND NOT c.is_active)` +
                ` + (SELECT count(*) FROM ${table} l JOIN feature_source s ON s.id = l.source_id WHERE l.state = 'active' AND NOT s.is_active)`
            );
        })
        .join(" + ");
    const orphans = await count(database, orphanSql);
    checks.push(
        check(
            "no_orphans",
            orphans === 0,
            orphans === 0
                ? "jeder Fremdschlüssel löst auf einen aktiven Träger und eine aktive Quelle auf; kein (Träger, Quelle) doppelt"
                : `${String(orphans)} aktive Verknüpfungen hängen an einem stillgelegten Träger oder einer stillgelegten Quelle`,
        ),
    );

    // ---- Lizenz ------------------------------------------------------------------------------------------------------------------
    const licenseRows = await database<{ license_statement: string; license_key: string | null; n: number }[]>`
        SELECT license_statement, license_key, count(*)::int AS n FROM feature_source WHERE is_active GROUP BY 1, 2
    `;
    const licenseCount = (key: string | null, statement: string): number =>
        licenseRows.find((row) => row.license_statement === statement && row.license_key === key)?.n ?? 0;
    const inconsistent = await count(
        database,
        `SELECT count(*) FROM feature_source WHERE (license_statement = 'license') <> (license_key IS NOT NULL)`,
    );
    checks.push(
        check(
            "license_consistent",
            inconsistent === 0,
            `Aussage und Schlüssel stimmig (license braucht einen Schlüssel, public_domain und unfree keinen): cc-by-nc-sa-3.0 ${String(licenseCount("cc-by-nc-sa-3.0", "license"))}, cc-by-sa-4.0 ${String(licenseCount("cc-by-sa-4.0", "license"))}, cc-by-sa-3.0 ${String(licenseCount("cc-by-sa-3.0", "license"))}, nicht erfasst ${String(licenseCount(null, "unrecorded"))}`,
        ),
    );

    // ---- Die Sollzahlen des Vertrags ------------------------------------------------------------------------------------------------
    const finding = (code: string): number => expected.findings.find((entry) => entry.code === code)?.objectCount ?? 0;
    const actualNumbers: Record<keyof typeof CONTRACT_NUMBERS, number> = {
        catalog: sourceRows.length,
        catalog_provisional: provisional,
        catalog_with_url: withUrl,
        corpora: corpusRows.length,
        place_source: linkCounts["place_source"] ?? 0,
        path_source: linkCounts["path_source"] ?? 0,
        territory_source: linkCounts["territory_source"] ?? 0,
        region_source: linkCounts["region_source"] ?? 0,
        terrain_peak_source: linkCounts["terrain_peak_source"] ?? 0,
        links_resolved: linkTotal,
        links_orphan: totals.orphan,
        links_deferred_citymap: totals.deferred,
        links_total: totals.total,
        reference_kind_empty: totals.byReferenceKind["leer"] ?? 0,
        reference_kind_ausfuehrlich: totals.byReferenceKind["ausfuehrlich"] ?? 0,
        reference_kind_ergaenzend: totals.byReferenceKind["ergaenzend"] ?? 0,
        reference_kind_erwaehnung: totals.byReferenceKind["erwaehnung"] ?? 0,
        license_cc_by_nc_sa_3_0: licenseCount("cc-by-nc-sa-3.0", "license"),
        license_cc_by_sa_4_0: licenseCount("cc-by-sa-4.0", "license"),
        license_cc_by_sa_3_0: licenseCount("cc-by-sa-3.0", "license"),
        license_unrecorded: licenseCount(null, "unrecorded"),
        kanon_entries_not_taken: finding("kanon_entry_unresolvable") + finding("kanon_entry_bound_label"),
    };
    const numberKeys = Object.keys(CONTRACT_NUMBERS) as (keyof typeof CONTRACT_NUMBERS)[];
    if (revision === CONTRACT_SET_REVISION) {
        const deviating = numberKeys
            .filter((key) => actualNumbers[key] !== CONTRACT_NUMBERS[key])
            .map((key) => `${key}: Vertrag ${String(CONTRACT_NUMBERS[key])}, gemessen ${String(actualNumbers[key])}`);
        checks.push(
            check(
                "contract_numbers",
                deviating.length === 0,
                deviating.length === 0
                    ? `alle ${String(numberKeys.length)} Sollzahlen des Vertrags für den Satz ${String(CONTRACT_SET_REVISION)} stimmen`
                    : `${String(deviating.length)} von ${String(numberKeys.length)} Sollzahlen weichen ab (Satz ${String(CONTRACT_SET_REVISION)})`,
                deviating,
            ),
        );
    } else {
        checks.push(
            check(
                "contract_numbers",
                true,
                `Satz ${String(revision)}: der Vertrag nennt Sollzahlen nur für den Satz ${String(CONTRACT_SET_REVISION)}; bei einem neuen Satz nachmessen`,
            ),
        );
    }

    const settled = settleChecks("verify:sources", checks);
    return { passed: settled.passed, revision, skipped: false, checks: settled.checks, findings: expected.findings };
}
