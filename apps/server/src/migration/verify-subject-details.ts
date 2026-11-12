import { wikiLinkKey } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import type { MapFeaturesPayload } from "./map-features.ts";
import { computePathGroups, type PathGroupInput } from "./path-groups.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { regionLinkFindings } from "./subject-details-findings.ts";
import {
    PATH_SNAPSHOT_COLUMNS,
    POWERLINE_SNAPSHOT_COLUMNS,
    REGION_SNAPSHOT_COLUMNS,
    SETTLEMENT_SNAPSHOT_COLUMNS,
    SUBJECT_DETAIL_TABLES,
    type SubjectDetailTable,
    neighborCells,
    pathSnapshotCells,
    placeDetailCells,
    powerlineSnapshotCells,
    readCarriers,
    regionSnapshotCells,
    settlementSnapshotCells,
    synonymCells,
    trafficLinkCells,
} from "./subject-details-import.ts";
import { transformSubjectDetails, type SubjectDetailsTransform } from "./subject-details.ts";
import { canon, readTableCells, type Cell, type Col } from "./sync-table.ts";

/**
 * Parität der Detailfelder und der Wiki-Zuordnung gegen denselben Satz, aus dem importiert wurde (WI-0063 P3, Vertrag
 * `subject-details.yaml`, `verifier`).
 *
 * Geprüft wird das AGGREGAT: dass jede Zeile Spalte für Spalte stimmt, dass die Kindzeilen der Quelle gleichen, dass nur
 * `assigned` und `address_only` von der Importquelle geschrieben sind, dass die Wegegruppen und die Objektlink-Schlüssel die
 * Zahlen des Vertrags tragen und dass keine Tabelle eine `entity_type`-Spalte oder einen JSON-Typ hat.
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03): Jede Prüfung rechnet wie vorgesehen, scheitert aber nur als Befund.
 * Die Sollzahlen des Vertrags gelten für den Satz 161832; bei einem anderen Satz stehen sie nur als Zahlen daneben.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface SubjectDetailsParityReport {
    passed: boolean;
    revision: number;
    checks: ParityCheck[];
    /** Befunde, die der Prüfer selbst findet (Kollisionen der Objektlinks, Wegegruppen, Regionen). */
    findings: Finding[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): ParityCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

/** Die Sollzahlen des Vertrags für den Satz 161832 (Revision der `map-features.json`). */
export const CONTRACT_SET_REVISION = 161832;
export const CONTRACT_NUMBERS = {
    place_wiki_assignment: 2191,
    place_assigned: 2136,
    place_address_only: 55,
    path_main: 2151,
    path_main_address_only: 1,
    path_further: 24,
    terrain_peak_wiki_assignment: 57,
    powerline_wiki_assignment: 84,
    powerline_assigned: 80,
    powerline_address_only: 4,
    wiki_settlement_snapshot: 2132,
    wiki_path_snapshot: 413,
    wiki_path_full: 412,
    wiki_path_lean: 1,
    wiki_region_snapshot: 574,
    wiki_powerline_snapshot: 18,
    place_detail: 102,
    wiki_settlement_traffic_link: 53,
    wiki_region_snapshot_neighbor: 2128,
    wiki_region_snapshot_synonym: 157,
    path_groups: 1254,
    path_wiki_groups: 413,
    path_name_groups: 841,
    path_segments_without_group: 5007,
    path_titles_in_several_groups: 43,
    place_distinct_addresses: 2181,
    place_shared_addresses: 6,
    place_shared_address_carriers: 16,
    label_shared_keys: 22,
    label_shared_labels: 65,
    region_shared_addresses: 22,
    region_shared_carriers: 59,
    keys_place_and_territory: 26,
    keys_label_and_place: 5,
    keys_label_and_territory: 0,
    region_key_nests: 544,
} as const;

/** Feste Vergleichsfälle des Linkschlüssels (siehe `packages/shared/test/wiki-link-key.test.ts`, dort gegen Legacys Code). */
const LINK_KEY_SAMPLES: readonly (readonly [string, string])[] = [
    ["https://de.wiki-aventurica.de/wiki/Barbr%C3%BCck", "barbruck"],
    ["https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2", "reichsstrasse2"],
    ["https://de.wiki-aventurica.de/wiki/Sultanat_Fasar_(Kalifat)", "sultanatfasarkalifat"],
    ["https://de.wiki-aventurica.de/wiki/Sultanat+Fasar", "sultanatfasar"],
    ["https://de.wiki-aventurica.de/wiki/Alt%ZZGareth", "altzzgareth"],
    ["https://de.wiki-aventurica.de/wiki/Inoffiziell:Torfendorf", "inoffizielltorfendorf"],
];

/** Vergleicht erwartete und gespeicherte Zeilen nach Schlüssel; `columns` benennt die Spalten für die Meldung. */
function compareRows(
    expected: Map<string, readonly Cell[]>,
    actual: Map<string, readonly (string | null)[]>,
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
    for (const key of actual.keys()) {
        if (!expected.has(key)) offenders.push(`${key} ist zu viel`);
    }
    return offenders;
}

async function count(database: Queryable, sql: string): Promise<number> {
    const [row] = await database.unsafe<{ n: number }[]>(`SELECT (${sql})::int AS n`);
    return row?.n ?? 0;
}

async function readSnapshotRows(
    database: Queryable,
    table: string,
    columns: readonly Col[],
): Promise<Map<string, (string | null)[]>> {
    const rows = await readTableCells(database, table, columns, "t.is_active");
    return new Map(rows.map((cells) => [String(cells[0]), cells]));
}

/** Die Kindzeilen aktiver Schnappschüsse, je Schlüssel des Schnappschusses gruppiert. */
async function readChildren(
    database: Queryable,
    table: string,
    parentTable: string,
    columns: readonly string[],
): Promise<Map<string, string[]>> {
    const rows = await database.unsafe<Record<string, string | null>[]>(
        `SELECT s.wiki_key AS key, ${columns.map((column) => `l.${column}::text AS ${column}`).join(", ")} ` +
            `FROM ${table} l JOIN ${parentTable} s ON s.id = l.snapshot_id WHERE s.is_active`,
    );
    const result = new Map<string, string[]>();
    for (const row of rows) {
        const list = result.get(String(row["key"])) ?? [];
        list.push(JSON.stringify(columns.map((column) => row[column] ?? null)));
        result.set(String(row["key"]), list);
    }
    for (const list of result.values()) list.sort();
    return result;
}

function childOffenders(
    expected: ReadonlyMap<string, readonly (readonly Cell[])[]>,
    actual: Map<string, string[]>,
): string[] {
    const offenders: string[] = [];
    for (const [key, rows] of expected) {
        const want = rows.map((cells) => JSON.stringify(cells.map((cell) => canon(cell)))).sort();
        const have = actual.get(key) ?? [];
        if (JSON.stringify(want) !== JSON.stringify(have))
            offenders.push(`${key}: ${String(have.length)} statt ${String(want.length)} Zeilen`);
    }
    for (const key of actual.keys()) if (!expected.has(key)) offenders.push(`${key} ist zu viel`);
    return offenders;
}

export async function verifySubjectDetails(
    database: Database,
    payload: MapFeaturesPayload,
): Promise<SubjectDetailsParityReport> {
    const { targets } = await readCarriers(database);
    const expected: SubjectDetailsTransform = transformSubjectDetails(payload, targets);
    const checks: ParityCheck[] = [];
    const findings: Finding[] = [];
    const revision = Number(payload.revision);
    // Gehören die Kraftlinien dem WikiSync, lässt der Zug ihren Wiki-Stand und ihre Zuordnung aus (wie `importSubjectDetails`); der Prüfer erwartet sie dann auch nicht.
    const kraftlinienTabellen: ReadonlySet<string> = (await wikisyncBereiche(database)).has("kraftlinie")
        ? new Set(["wiki_powerline_snapshot", "powerline_wiki_assignment"])
        : new Set();

    // ---- Bestand je Tabelle --------------------------------------------------------------------------------------------
    const have: Record<SubjectDetailTable, number> = {
        wiki_settlement_snapshot: await count(
            database,
            "SELECT count(*) FROM wiki_settlement_snapshot WHERE is_active",
        ),
        wiki_settlement_traffic_link: await count(
            database,
            "SELECT count(*) FROM wiki_settlement_traffic_link l JOIN wiki_settlement_snapshot s ON s.id = l.snapshot_id WHERE s.is_active",
        ),
        wiki_path_snapshot: await count(database, "SELECT count(*) FROM wiki_path_snapshot WHERE is_active"),
        wiki_region_snapshot: await count(database, "SELECT count(*) FROM wiki_region_snapshot WHERE is_active"),
        wiki_region_snapshot_neighbor: await count(
            database,
            "SELECT count(*) FROM wiki_region_snapshot_neighbor l JOIN wiki_region_snapshot s ON s.id = l.snapshot_id WHERE s.is_active",
        ),
        wiki_region_snapshot_synonym: await count(
            database,
            "SELECT count(*) FROM wiki_region_snapshot_synonym l JOIN wiki_region_snapshot s ON s.id = l.snapshot_id WHERE s.is_active",
        ),
        wiki_powerline_snapshot: await count(database, "SELECT count(*) FROM wiki_powerline_snapshot WHERE is_active"),
        place_wiki_assignment: await count(database, "SELECT count(*) FROM place_wiki_assignment WHERE is_active"),
        path_wiki_assignment: await count(database, "SELECT count(*) FROM path_wiki_assignment WHERE is_active"),
        terrain_peak_wiki_assignment: await count(
            database,
            "SELECT count(*) FROM terrain_peak_wiki_assignment WHERE is_active",
        ),
        powerline_wiki_assignment: await count(
            database,
            "SELECT count(*) FROM powerline_wiki_assignment WHERE is_active",
        ),
        place_detail: await count(database, "SELECT count(*) FROM place_detail WHERE is_active"),
    };
    const want: Record<SubjectDetailTable, number> = {
        wiki_settlement_snapshot: expected.settlementSnapshots.length,
        wiki_settlement_traffic_link: expected.settlementSnapshots.reduce(
            (sum, row) => sum + row.trafficLinks.length,
            0,
        ),
        wiki_path_snapshot: expected.pathSnapshots.length,
        wiki_region_snapshot: expected.regionSnapshots.length,
        wiki_region_snapshot_neighbor: expected.regionSnapshots.reduce((sum, row) => sum + row.neighbors.length, 0),
        wiki_region_snapshot_synonym: expected.regionSnapshots.reduce((sum, row) => sum + row.synonyms.length, 0),
        wiki_powerline_snapshot: expected.powerlineSnapshots.length,
        place_wiki_assignment: expected.placeAssignments.length,
        path_wiki_assignment: expected.pathAssignments.length,
        terrain_peak_wiki_assignment: expected.peakAssignments.length,
        powerline_wiki_assignment: expected.powerlineAssignments.length,
        place_detail: expected.placeDetails.length,
    };
    const countOffenders = SUBJECT_DETAIL_TABLES.filter(
        (name) => !kraftlinienTabellen.has(name) && have[name] !== want[name],
    ).map((name) => `${name}: Quelle ${String(want[name])}, Ziel ${String(have[name])}`);
    checks.push(
        check(
            "count_parity",
            countOffenders.length === 0,
            countOffenders.length === 0
                ? SUBJECT_DETAIL_TABLES.map((name) => `${name} ${String(want[name])}`).join(", ")
                : `${String(countOffenders.length)} Tabellen weichen ab`,
            countOffenders,
        ),
    );

    // ---- Schnappschüsse, Spalte für Spalte --------------------------------------------------------------------------------
    const snapshotKinds = [
        {
            name: "wiki_settlement_snapshot",
            columns: SETTLEMENT_SNAPSHOT_COLUMNS,
            rows: expected.settlementSnapshots.map(settlementSnapshotCells),
        },
        {
            name: "wiki_path_snapshot",
            columns: PATH_SNAPSHOT_COLUMNS,
            rows: expected.pathSnapshots.map(pathSnapshotCells),
        },
        {
            name: "wiki_region_snapshot",
            columns: REGION_SNAPSHOT_COLUMNS,
            rows: expected.regionSnapshots.map(regionSnapshotCells),
        },
        {
            name: "wiki_powerline_snapshot",
            columns: POWERLINE_SNAPSHOT_COLUMNS,
            rows: expected.powerlineSnapshots.map(powerlineSnapshotCells),
        },
    ] as const;
    const snapshotOffenders: string[] = [];
    for (const kind of snapshotKinds.filter((entry) => !kraftlinienTabellen.has(entry.name))) {
        const actual = await readSnapshotRows(database, kind.name, kind.columns);
        const wanted = new Map(kind.rows.map((cells) => [String(cells[0]), cells]));
        for (const text of compareRows(
            wanted,
            actual,
            kind.columns.map((column) => column.name),
        )) {
            snapshotOffenders.push(`${kind.name} ${text}`);
        }
    }
    checks.push(
        check(
            "snapshot_parity",
            snapshotOffenders.length === 0,
            snapshotOffenders.length === 0
                ? "alle Schnappschüsse stimmen Spalte für Spalte (Text, is_ruined, synced_at als jüngster Stempel je Schlüssel)"
                : `${String(snapshotOffenders.length)} Abweichungen`,
            snapshotOffenders,
        ),
    );

    // ---- Kindzeilen ------------------------------------------------------------------------------------------------------
    const childOffend = [
        ...childOffenders(
            new Map(expected.settlementSnapshots.map((row) => [row.wikiKey, row.trafficLinks.map(trafficLinkCells)])),
            await readChildren(database, "wiki_settlement_traffic_link", "wiki_settlement_snapshot", [
                "position",
                "link_text",
                "path_name",
            ]),
        ).map((text) => `Verkehrswege ${text}`),
        ...childOffenders(
            new Map(expected.regionSnapshots.map((row) => [row.wikiKey, row.neighbors.map(neighborCells)])),
            await readChildren(database, "wiki_region_snapshot_neighbor", "wiki_region_snapshot", [
                "direction",
                "position",
                "name",
            ]),
        ).map((text) => `Nachbarn ${text}`),
        ...childOffenders(
            new Map(expected.regionSnapshots.map((row) => [row.wikiKey, row.synonyms.map(synonymCells)])),
            await readChildren(database, "wiki_region_snapshot_synonym", "wiki_region_snapshot", ["position", "text"]),
        ).map((text) => `Synonyme ${text}`),
    ];
    checks.push(
        check(
            "children_parity",
            childOffend.length === 0,
            childOffend.length === 0
                ? `Verkehrswege ${String(want["wiki_settlement_traffic_link"])}, Nachbarn ${String(want["wiki_region_snapshot_neighbor"])}, Synonyme ${String(want["wiki_region_snapshot_synonym"])} gleich der Quelle`
                : `${String(childOffend.length)} Schnappschüsse mit abweichenden Kindzeilen`,
            childOffend,
        ),
    );

    // ---- Zuordnungen ------------------------------------------------------------------------------------------------------
    const assignmentOffenders: string[] = [];
    const readAssignments = async (
        table: string,
        carrierTable: string,
        carrierColumn: string,
        snapshotTable: string,
        withRole: boolean,
    ): Promise<Map<string, (string | null)[]>> => {
        const rows = await database.unsafe<Record<string, string | null>[]>(
            `SELECT c.public_id::text AS carrier, ${withRole ? "a.role" : "'main'"} AS role, a.wiki_url, s.wiki_key AS snapshot_key, ` +
                `a.assignment_state, a.assignment_origin FROM ${table} a JOIN ${carrierTable} c ON c.id = a.${carrierColumn} ` +
                `LEFT JOIN ${snapshotTable} s ON s.id = a.snapshot_id WHERE a.is_active`,
        );
        return new Map(
            rows.map((row) => [
                withRole && row["role"] === "further"
                    ? `${String(row["carrier"])}|further|${String(row["snapshot_key"])}`
                    : String(row["carrier"]),
                [
                    row["wiki_url"] ?? null,
                    row["snapshot_key"] ?? null,
                    row["assignment_state"] ?? null,
                    row["assignment_origin"] ?? null,
                ],
            ]),
        );
    };
    const assignmentKinds = [
        {
            name: "place_wiki_assignment",
            actual: await readAssignments(
                "place_wiki_assignment",
                "place",
                "place_id",
                "wiki_settlement_snapshot",
                false,
            ),
            rows: expected.placeAssignments.map((row) => ({
                key: row.publicId,
                cells: [row.wikiUrl, row.snapshotKey, row.state, row.origin] as Cell[],
            })),
        },
        {
            name: "path_wiki_assignment",
            actual: await readAssignments("path_wiki_assignment", "path", "path_id", "wiki_path_snapshot", true),
            rows: expected.pathAssignments.map((row) => ({
                key: row.role === "main" ? row.publicId : `${row.publicId}|further|${String(row.snapshotKey)}`,
                cells: [row.wikiUrl, row.snapshotKey, row.state, row.origin] as Cell[],
            })),
        },
        {
            name: "terrain_peak_wiki_assignment",
            actual: await readAssignments(
                "terrain_peak_wiki_assignment",
                "terrain_peak",
                "terrain_peak_id",
                "wiki_region_snapshot",
                false,
            ),
            rows: expected.peakAssignments.map((row) => ({
                key: row.publicId,
                cells: [row.wikiUrl, row.snapshotKey, row.state, row.origin] as Cell[],
            })),
        },
        {
            name: "powerline_wiki_assignment",
            actual: await readAssignments(
                "powerline_wiki_assignment",
                "powerline",
                "powerline_id",
                "wiki_powerline_snapshot",
                false,
            ),
            rows: expected.powerlineAssignments.map((row) => ({
                key: row.publicId,
                cells: [row.wikiUrl, row.snapshotKey, row.state, row.origin] as Cell[],
            })),
        },
    ];
    for (const kind of assignmentKinds.filter((entry) => !kraftlinienTabellen.has(entry.name))) {
        const wanted = new Map(kind.rows.map((row) => [row.key, row.cells]));
        for (const text of compareRows(wanted, kind.actual, [
            "wiki_url",
            "snapshot",
            "assignment_state",
            "assignment_origin",
        ])) {
            assignmentOffenders.push(`${kind.name} ${text}`);
        }
    }
    checks.push(
        check(
            "assignment_parity",
            assignmentOffenders.length === 0,
            assignmentOffenders.length === 0
                ? `Adresse, Schnappschuss, Zustand und Herkunft aller ${String(want["place_wiki_assignment"] + want["path_wiki_assignment"] + want["terrain_peak_wiki_assignment"] + want["powerline_wiki_assignment"])} Zuordnungen stimmen`
                : `${String(assignmentOffenders.length)} Zuordnungen weichen ab`,
            assignmentOffenders,
        ),
    );

    // ---- Regionen: Schlüssel gegen Schnappschuss -----------------------------------------------------------------------------
    const regionRows = await database<{ label: string; name: string; region_key: string | null }[]>`
        SELECT l.public_id::text AS label, l.name, r.wiki_region_key AS region_key
        FROM map_label l JOIN region r ON r.id = l.region_id
        WHERE l.public_id::text = ANY(${expected.boundLabelNests.map((nest) => nest.publicId)}::text[])
    `;
    const keyOfLabel = new Map(expected.boundLabelNests.map((nest) => [nest.publicId, nest.wikiKey]));
    const withRegionKey = regionRows.filter((row) => row.region_key !== null && row.region_key !== "");
    const regionKeyOffenders = withRegionKey
        .filter((row) => row.region_key !== keyOfLabel.get(row.label))
        .map(
            (row) =>
                `${row.name} (${row.label}): Region ${String(row.region_key)}, Nest ${String(keyOfLabel.get(row.label))}`,
        );
    checks.push(
        check(
            "region_key_parity",
            regionKeyOffenders.length === 0,
            `region.wiki_region_key gleich Nest-Schlüssel bei ${String(withRegionKey.length - regionKeyOffenders.length)} von ${String(withRegionKey.length)} gebundenen Nestern`,
            regionKeyOffenders,
        ),
    );
    findings.push(
        ...(await regionLinkFindings(
            database,
            expected.boundLabelNests.map((nest) => nest.publicId),
        )),
    );

    // ---- Redaktionelle Felder -----------------------------------------------------------------------------------------------
    const detailRows = await database<Record<string, string | null>[]>`
        SELECT c.public_id::text AS carrier, d.description, d.einwohner, d.lage, d.oberhaupt,
               d.einwohner_origin, d.lage_origin, d.oberhaupt_origin
        FROM place_detail d JOIN place c ON c.id = d.place_id WHERE d.is_active
    `;
    const detailActual = new Map(
        detailRows.map((row) => [
            String(row["carrier"]),
            [
                row["description"],
                row["einwohner"],
                row["lage"],
                row["oberhaupt"],
                row["einwohner_origin"],
                row["lage_origin"],
                row["oberhaupt_origin"],
            ] as (string | null)[],
        ]),
    );
    const detailWanted = new Map(
        expected.placeDetails.map((row) => [row.placePublicId, placeDetailCells("", row).slice(1)]),
    );
    const detailOffenders = compareRows(detailWanted, detailActual, [
        "description",
        "einwohner",
        "lage",
        "oberhaupt",
        "einwohner_origin",
        "lage_origin",
        "oberhaupt_origin",
    ]);
    const blanks = await count(
        database,
        `SELECT (SELECT count(*) FROM place_detail WHERE description = '' OR einwohner = '' OR lage = '' OR oberhaupt = '')` +
            ` + (SELECT count(*) FROM wiki_settlement_snapshot WHERE description = '' OR einwohner = '' OR oberhaupt = '')` +
            ` + (SELECT count(*) FROM wiki_region_snapshot WHERE description = '' OR name = '')`,
    );
    checks.push(
        check(
            "place_detail_parity",
            detailOffenders.length === 0 && blanks === 0,
            detailOffenders.length === 0 && blanks === 0
                ? `${String(want["place_detail"])} Orte: Beschreibung, Einwohner, Lage, Oberhaupt und Herkunft je Feld gleich der Quelle, keine leere Zeichenkette gespeichert`
                : `${String(detailOffenders.length)} Orte weichen ab, ${String(blanks)} leere Zeichenketten`,
            detailOffenders,
        ),
    );

    // ---- Zustände ------------------------------------------------------------------------------------------------------------
    const reserved = await count(
        database,
        ["place_wiki_assignment", "path_wiki_assignment", "terrain_peak_wiki_assignment", "powerline_wiki_assignment"]
            .map(
                (table) =>
                    `SELECT count(*) FROM ${table} WHERE assignment_state NOT IN ('assigned', 'address_only') AND assignment_origin IN ('legacy_editor', 'legacy_verlauf_sync', 'unknown')`,
            )
            .join(" + ")
            .replace(/SELECT count\(\*\) FROM/g, "(SELECT count(*) FROM")
            .replace(/'unknown'\)/g, "'unknown'))"),
    );
    const decisions = await count(
        database,
        ["place_wiki_assignment", "path_wiki_assignment", "terrain_peak_wiki_assignment", "powerline_wiki_assignment"]
            .map((table) => `(SELECT count(*) FROM ${table} WHERE assignment_state IN ('separated', 'suppressed'))`)
            .join(" + "),
    );
    checks.push(
        check(
            "states_written",
            reserved === 0,
            reserved === 0
                ? `von der Importquelle nur assigned und address_only geschrieben; separated und suppressed unberührt (${String(decisions)} Entscheide stehen)`
                : `${String(reserved)} Zeilen der Importquelle tragen einen reservierten Zustand`,
        ),
    );

    // ---- Objektlinks: Schlüssel und Kollisionen --------------------------------------------------------------------------------
    const sampleOffenders = LINK_KEY_SAMPLES.filter(([address, key]) => wikiLinkKey(address) !== key).map(
        ([address, key]) => `${address}: ${wikiLinkKey(address)} statt ${key}`,
    );
    const placeAddresses = await database<{ public_id: string; name: string; wiki_url: string }[]>`
        SELECT c.public_id::text, c.name, a.wiki_url
        FROM place_wiki_assignment a JOIN place c ON c.id = a.place_id WHERE a.is_active AND a.wiki_url IS NOT NULL
    `;
    const placeKeys = new Set(placeAddresses.map((row) => wikiLinkKey(row.wiki_url)));
    const distinctAddresses = new Set(placeAddresses.map((row) => row.wiki_url)).size;
    const placeGroups = groupBy(placeAddresses, (row) => row.wiki_url);
    const sharedPlace = [...placeGroups.values()].filter((rows) => rows.length > 1);
    const sharedPlaceCarriers = sharedPlace.flat();
    const regionAddresses = await database<{ public_id: string; name: string; wiki_url: string }[]>`
        SELECT public_id::text, name, wiki_url FROM region WHERE is_active AND wiki_url IS NOT NULL AND btrim(wiki_url) <> ''
    `;
    const sharedRegion = [...groupBy(regionAddresses, (row) => row.wiki_url).values()].filter(
        (rows) => rows.length > 1,
    );
    const territoryAddresses = await database<{ wiki_url: string }[]>`
        SELECT wiki_url FROM territory WHERE is_active AND wiki_url IS NOT NULL AND btrim(wiki_url) <> ''
    `;
    const territoryKeys = new Set(territoryAddresses.map((row) => wikiLinkKey(row.wiki_url)));
    // Die Schlüssel der Beschriftungen: alle Landschafts-Nester der Quelle (so misst der Vertrag), auch die ohne Ziel.
    const labelKeys = new Set(expected.stats.labelNestUrls.map((url) => wikiLinkKey(url)));
    const intersect = (a: ReadonlySet<string>, b: ReadonlySet<string>): number =>
        [...a].filter((key) => b.has(key)).length;
    const crossPlaceTerritory = intersect(placeKeys, territoryKeys);
    const crossLabelPlace = intersect(labelKeys, placeKeys);
    const crossLabelTerritory = intersect(labelKeys, territoryKeys);
    const lossless = placeKeys.size === distinctAddresses;
    checks.push(
        check(
            "link_key_parity",
            sampleOffenders.length === 0 && lossless,
            `${String(distinctAddresses)} Adressen der Orte ergeben ${String(placeKeys.size)} Schlüssel${lossless ? " (verlustfrei)" : " (VERLUST)"}; Kollisionen: Orte ${String(sharedPlace.length)}/${String(sharedPlaceCarriers.length)}, Beschriftungen ${String(expected.stats.labelSharedKeys)}/${String(expected.stats.labelSharedLabels)}, Regionen ${String(sharedRegion.length)}/${String(sharedRegion.flat().length)}, Ort und Gebiet ${String(crossPlaceTerritory)}, Beschriftung und Ort ${String(crossLabelPlace)}, Beschriftung und Gebiet ${String(crossLabelTerritory)}; ${String(LINK_KEY_SAMPLES.length - sampleOffenders.length)} von ${String(LINK_KEY_SAMPLES.length)} Stichproben (Umlaut, ss, Klammerzusatz, +, kaputte Prozentkodierung, Namensraum) gleich`,
            sampleOffenders,
        ),
    );
    const sharedObjects: FindingObject[] = [
        ...sharedPlaceCarriers.map((row) => ({ table: "place", publicId: row.public_id, name: row.name })),
        ...sharedRegion.flat().map((row) => ({ table: "region", publicId: row.public_id, name: row.name })),
    ];
    findings.push(
        createFinding(
            "wiki_key_shared",
            `Mehrere Träger teilen eine Adresse oder einen Schlüssel: Orte ${String(sharedPlace.length)} Adressen an ${String(sharedPlaceCarriers.length)} Orten, Beschriftungen ${String(expected.stats.labelSharedKeys)} Schlüssel an ${String(expected.stats.labelSharedLabels)}, Regionen ${String(sharedRegion.length)} Adressen an ${String(sharedRegion.flat().length)}; zwischen den Arten Ort und Gebiet ${String(crossPlaceTerritory)}, Beschriftung und Ort ${String(crossLabelPlace)}, Beschriftung und Gebiet ${String(crossLabelTerritory)}. Die Reihenfolge der Parameter löst die Arten auf; innerhalb einer Art wählt niemand still`,
            {
                orteAdressen: sharedPlace.length,
                orteOrte: sharedPlaceCarriers.length,
                beschriftungenSchluessel: expected.stats.labelSharedKeys,
                beschriftungen: expected.stats.labelSharedLabels,
                regionenAdressen: sharedRegion.length,
                regionenRegionen: sharedRegion.flat().length,
                ortUndGebiet: crossPlaceTerritory,
                beschriftungUndOrt: crossLabelPlace,
                beschriftungUndGebiet: crossLabelTerritory,
            },
            sharedObjects,
        ),
    );

    // ---- Wegegruppen ---------------------------------------------------------------------------------------------------------
    const groups = await pathGroupsFromDatabase(database);
    const furtherWithoutMain = await count(
        database,
        `SELECT count(*) FROM path_wiki_assignment f WHERE f.is_active AND f.role = 'further' AND NOT EXISTS (
             SELECT 1 FROM path_wiki_assignment m WHERE m.path_id = f.path_id AND m.role = 'main' AND m.is_active)`,
    );
    const totalGroups = groups.wikiGroups + groups.nameGroups;
    checks.push(
        check(
            "path_groups",
            true,
            `${String(totalGroups)} Gruppen (${String(groups.wikiGroups)} Wiki, ${String(groups.nameGroups)} Name), ${String(groups.segmentsWithoutGroup)} Segmente ohne Gruppe, ${String(groups.titlesInSeveralGroups)} Titel unter mehreren Gruppenschlüsseln; ${String(furtherWithoutMain)} weitere Zuweisungen ohne Hauptzuweisung`,
        ),
    );
    // Weitere ohne Haupt ist kein Fehler mehr, nur ein Befund: Seit WI-0300 lässt „Artikel lösen“ die weiteren Artikel stehen (Entscheid Vali), seit WI-0302 sind sie
    // weitere Straßennamen je Abschnitt im Wegeditor. Ein Abschnitt trägt sie dann ohne Hauptartikel und gehört über sie zu ihren Wiki-Gruppen (`path-groups.ts`).
    if (furtherWithoutMain > 0) {
        findings.push(
            createFinding(
                "path_further_without_main",
                `${String(furtherWithoutMain)} weitere Zuweisungen an Abschnitten ohne Hauptzuweisung (erlaubt seit WI-0300: „Artikel lösen“ lässt die weiteren stehen)`,
                { zuweisungen: furtherWithoutMain },
            ),
        );
    }
    if (groups.segmentsWithoutGroup > 0) {
        findings.push(
            createFinding(
                "path_group_no_identity",
                `${String(groups.segmentsWithoutGroup)} Segmente ohne echten Namen und ohne Zuordnung haben keine Gruppenidentität; das Subject ist das Einzelsegment`,
                { segmente: groups.segmentsWithoutGroup },
            ),
        );
    }
    if (groups.titlesInSeveralGroups > 0) {
        findings.push(
            createFinding(
                "path_title_multi_group",
                `${String(groups.titlesInSeveralGroups)} normalisierte Titel kommen unter mehr als einem Gruppenschlüssel vor (zwei Wege, nie ein Anzeigename als Identität)`,
                { titel: groups.titlesInSeveralGroups },
            ),
        );
    }

    // ---- Struktur: kein entity_type, kein JSON ---------------------------------------------------------------------------------
    const structure = await database<{ table_name: string; column_name: string; data_type: string }[]>`
        SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY(${[...SUBJECT_DETAIL_TABLES]}::text[])
          AND (column_name = 'entity_type' OR data_type IN ('json', 'jsonb'))
    `;
    checks.push(
        check(
            "structure",
            structure.length === 0,
            structure.length === 0
                ? "keine entity_type-Spalte und kein JSON-Typ in den Tabellen von D6"
                : `${String(structure.length)} verbotene Spalten`,
            structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ),
    );

    // ---- Keine Waisen -----------------------------------------------------------------------------------------------------------
    const orphans = await count(
        database,
        `(SELECT count(*) FROM place_wiki_assignment a JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id WHERE a.is_active AND NOT s.is_active)
         + (SELECT count(*) FROM path_wiki_assignment a JOIN wiki_path_snapshot s ON s.id = a.snapshot_id WHERE a.is_active AND NOT s.is_active)
         + (SELECT count(*) FROM terrain_peak_wiki_assignment a JOIN wiki_region_snapshot s ON s.id = a.snapshot_id WHERE a.is_active AND NOT s.is_active)
         + (SELECT count(*) FROM powerline_wiki_assignment a JOIN wiki_powerline_snapshot s ON s.id = a.snapshot_id WHERE a.is_active AND NOT s.is_active)
         + (SELECT count(*) FROM place_wiki_assignment a JOIN place c ON c.id = a.place_id WHERE a.is_active AND NOT c.is_active)
         + (SELECT count(*) FROM path_wiki_assignment a JOIN path c ON c.id = a.path_id WHERE a.is_active AND NOT c.is_active)
         + (SELECT count(*) FROM powerline_wiki_assignment a JOIN powerline c ON c.id = a.powerline_id WHERE a.is_active AND NOT c.is_active)
         + (SELECT count(*) FROM terrain_peak_wiki_assignment a JOIN terrain_peak c ON c.id = a.terrain_peak_id WHERE a.is_active AND NOT c.is_active)
         + (SELECT count(*) FROM place_detail d JOIN place c ON c.id = d.place_id WHERE d.is_active AND NOT c.is_active)`,
    );
    checks.push(
        check(
            "no_orphans",
            orphans === 0,
            orphans === 0
                ? "jeder Fremdschlüssel löst auf einen aktiven Träger und einen aktiven Schnappschuss auf, kein Schlüssel doppelt je Schnappschusstabelle"
                : `${String(orphans)} aktive Zeilen hängen an einem stillgelegten Träger oder Schnappschuss`,
        ),
    );

    // ---- Die Sollzahlen des Vertrags ---------------------------------------------------------------------------------------------
    const lean = expected.pathSnapshots.filter((row) => row.isLean).length;
    const actualNumbers: Record<keyof typeof CONTRACT_NUMBERS, number> = {
        place_wiki_assignment: have["place_wiki_assignment"] ?? 0,
        place_assigned: expected.placeAssignments.filter((row) => row.state === "assigned").length,
        place_address_only: expected.placeAssignments.filter((row) => row.state === "address_only").length,
        path_main: expected.pathAssignments.filter((row) => row.role === "main").length,
        path_main_address_only: expected.pathAssignments.filter(
            (row) => row.role === "main" && row.state === "address_only",
        ).length,
        path_further: expected.pathAssignments.filter((row) => row.role === "further").length,
        terrain_peak_wiki_assignment: have["terrain_peak_wiki_assignment"] ?? 0,
        powerline_wiki_assignment: have["powerline_wiki_assignment"] ?? 0,
        powerline_assigned: expected.powerlineAssignments.filter((row) => row.state === "assigned").length,
        powerline_address_only: expected.powerlineAssignments.filter((row) => row.state === "address_only").length,
        wiki_settlement_snapshot: have["wiki_settlement_snapshot"] ?? 0,
        wiki_path_snapshot: have["wiki_path_snapshot"] ?? 0,
        wiki_path_full: (have["wiki_path_snapshot"] ?? 0) - lean,
        wiki_path_lean: lean,
        wiki_region_snapshot: have["wiki_region_snapshot"] ?? 0,
        wiki_powerline_snapshot: have["wiki_powerline_snapshot"] ?? 0,
        place_detail: have["place_detail"] ?? 0,
        wiki_settlement_traffic_link: have["wiki_settlement_traffic_link"] ?? 0,
        wiki_region_snapshot_neighbor: have["wiki_region_snapshot_neighbor"] ?? 0,
        wiki_region_snapshot_synonym: have["wiki_region_snapshot_synonym"] ?? 0,
        path_groups: totalGroups,
        path_wiki_groups: groups.wikiGroups,
        path_name_groups: groups.nameGroups,
        path_segments_without_group: groups.segmentsWithoutGroup,
        path_titles_in_several_groups: groups.titlesInSeveralGroups,
        place_distinct_addresses: distinctAddresses,
        place_shared_addresses: sharedPlace.length,
        place_shared_address_carriers: sharedPlaceCarriers.length,
        label_shared_keys: expected.stats.labelSharedKeys,
        label_shared_labels: expected.stats.labelSharedLabels,
        region_shared_addresses: sharedRegion.length,
        region_shared_carriers: sharedRegion.flat().length,
        keys_place_and_territory: crossPlaceTerritory,
        keys_label_and_place: crossLabelPlace,
        keys_label_and_territory: crossLabelTerritory,
        region_key_nests: withRegionKey.length,
    };
    if (revision === CONTRACT_SET_REVISION) {
        const deviating = (Object.keys(CONTRACT_NUMBERS) as (keyof typeof CONTRACT_NUMBERS)[])
            .filter((key) => actualNumbers[key] !== CONTRACT_NUMBERS[key])
            .map((key) => `${key}: Vertrag ${String(CONTRACT_NUMBERS[key])}, gemessen ${String(actualNumbers[key])}`);
        checks.push(
            check(
                "contract_numbers",
                deviating.length === 0,
                deviating.length === 0
                    ? `alle ${String(Object.keys(CONTRACT_NUMBERS).length)} Sollzahlen des Vertrags für den Satz ${String(CONTRACT_SET_REVISION)} stimmen`
                    : `${String(deviating.length)} von ${String(Object.keys(CONTRACT_NUMBERS).length)} Sollzahlen weichen ab (Satz ${String(CONTRACT_SET_REVISION)})`,
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

    const settled = settleChecks("verify:subject-details", checks);
    return { passed: settled.passed, revision, checks: settled.checks, findings };
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
        const key = keyOf(row);
        const list = map.get(key);
        if (list) list.push(row);
        else map.set(key, [row]);
    }
    return map;
}

/** Die Wegegruppen, wie der Leser sie aus der Datenbank bildet (Vertrag `wege`). */
export async function pathGroupsFromDatabase(database: Queryable): Promise<ReturnType<typeof computePathGroups>> {
    const paths = await database<{ public_id: string; name: string; subtype: string }[]>`
        SELECT public_id::text, name, subtype FROM path WHERE is_active
    `;
    const assignments = await database<
        { public_id: string; role: string; snapshot_key: string | null; snapshot_name: string | null }[]
    >`
        SELECT c.public_id::text, a.role, s.wiki_key AS snapshot_key, s.name AS snapshot_name
        FROM path_wiki_assignment a
        JOIN path c ON c.id = a.path_id
        LEFT JOIN wiki_path_snapshot s ON s.id = a.snapshot_id
        WHERE a.is_active AND c.is_active AND a.snapshot_id IS NOT NULL
    `;
    const main = new Map<string, { key: string; name: string | null }>();
    const further = new Map<string, { key: string; name: string | null }[]>();
    for (const row of assignments) {
        if (row.snapshot_key === null) continue;
        const entry = { key: row.snapshot_key, name: row.snapshot_name };
        if (row.role === "main") main.set(row.public_id, entry);
        else further.set(row.public_id, [...(further.get(row.public_id) ?? []), entry]);
    }
    const inputs: PathGroupInput[] = paths.map((row) => ({
        publicId: row.public_id,
        name: row.name,
        subtype: row.subtype,
        mainKey: main.get(row.public_id)?.key ?? null,
        further: further.get(row.public_id) ?? [],
        wikiName: main.get(row.public_id)?.name ?? null,
    }));
    return computePathGroups(inputs);
}
