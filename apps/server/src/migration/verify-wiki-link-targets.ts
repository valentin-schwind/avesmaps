import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { lookupWikiKey } from "../subjects/wiki-key-lookup.ts";
import { buildSubjectIndex } from "../subjects/subject-index.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import {
    ASSIGNMENT_COLUMNS,
    PAGE_COLUMNS,
    TARGET_COLUMNS,
    WIKI_LINK_TABLES,
    assignmentCells,
    pageCells,
    targetCells,
} from "./wiki-link-targets-import.ts";
import {
    crossFindings,
    transformAssignments,
    transformLinkTargets,
    type AssignmentRow,
    type X2Art,
} from "./wiki-link-targets.ts";
import { blankTextCount, check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";

/**
 * Parität der Zuordnungstafel (X2) und der Linkziele (X1) gegen dieselben Antwortdateien, aus denen importiert wurde (WI-0063 27.12, Vertrag
 * `wiki-link-targets.yaml`, `verifier`).
 *
 * Geprüft wird: Anzahl je Tabelle, jede Zeile Spalte für Spalte (Zuordnung, Artikel, Links samt Reihenfolge), Reihenfolge der Links lückenlos je Feld,
 * Struktur (kein `entity_type`, kein JSON), keine leeren Texte. Dazu, als BEFUNDE (nie Tor, Betreiber 2026-10-03):
 *   - `wiki_key_vs_assignment`: der Key aus X2 gegen die Zuweisung, die unsere Daten schon tragen (`place_wiki_assignment`, `region.wiki_region_key`, …);
 *     X2 ist die Quelle des Lookups, die eigenen Zuweisungen sind der Abgleich;
 *   - `x2_object_not_on_map`: Zuweisungen, deren Objekt es bei uns nicht als Ziel gibt (stillgelegt, verborgen, Gebiet ohne Form, freie Beschriftung);
 *   - `traffic_link_not_in_x1`: Zeilen der alten Tafel `wiki_settlement_traffic_link`, die X1 nicht enthält (Bedingung für ihre Ablösung);
 *   - `x1_ziele_ohne_kartenobjekt`: die häufigsten Linkziele, die über den Lookup kein Objekt treffen (redaktionelle Kandidaten, nicht zu lösen);
 *   - alle Befunde der Umwandlung.
 * Die Auflösung der Linkziele wird mit dem echten Lookup (`buildSubjectIndex`) gezählt: eins, mehrdeutig, keins - je Feld.
 *
 * 🔴 Nichts hier hält einen Lauf an. Nur lesend.
 */

export interface WikiLinkParityReport {
    passed: boolean;
    /** Beide Antworten fehlten, waren unbrauchbar oder leer: nichts geschrieben, nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

export interface WikiLinkParityInput {
    linkziele?: unknown;
    zuordnung?: unknown;
}

/** Je Legacy-Art: wie unsere eigene Zuweisung den Key eines Objekts nennt (Kennung → `wiki:` + Slug), und welche Objekte es gibt. */
const OWN_KEYS: Readonly<Record<X2Art, { keys: string; exists: string; label: string }>> = {
    siedlung: {
        keys: `SELECT p.public_id::text AS id, 'wiki:' || s.wiki_key AS key FROM place_wiki_assignment a
               JOIN place p ON p.id = a.place_id JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id
               WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND p.is_active`,
        exists: `SELECT p.public_id::text AS id FROM place p WHERE p.is_active AND NOT p.is_hidden`,
        label: "place",
    },
    weg: {
        keys: `SELECT p.public_id::text AS id, 'wiki:' || s.wiki_key AS key FROM path_wiki_assignment a
               JOIN path p ON p.id = a.path_id JOIN wiki_path_snapshot s ON s.id = a.snapshot_id
               WHERE a.is_active AND a.role = 'main' AND a.assignment_state = 'assigned' AND s.is_active AND p.is_active`,
        exists: `SELECT p.public_id::text AS id FROM path p WHERE p.is_active`,
        label: "path",
    },
    kraftlinie: {
        keys: `SELECT p.public_id::text AS id, 'wiki:' || s.wiki_key AS key FROM powerline_wiki_assignment a
               JOIN powerline p ON p.id = a.powerline_id JOIN wiki_powerline_snapshot s ON s.id = a.snapshot_id
               WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND p.is_active`,
        exists: `SELECT p.public_id::text AS id FROM powerline p WHERE p.is_active`,
        label: "powerline",
    },
    // Eine Beschriftung: ein Gipfel (terrain_peak, Schnappschuss der Landschaftstabelle) oder eine an eine Region gebundene.
    region: {
        keys: `SELECT t.public_id::text AS id, 'wiki:' || s.wiki_key AS key FROM terrain_peak_wiki_assignment a
               JOIN terrain_peak t ON t.id = a.terrain_peak_id JOIN wiki_region_snapshot s ON s.id = a.snapshot_id
               WHERE a.is_active AND a.assignment_state = 'assigned' AND s.is_active AND t.is_active
               UNION ALL
               SELECT l.public_id::text AS id, 'wiki:' || r.wiki_region_key AS key FROM map_label l
               JOIN region r ON r.id = l.region_id
               WHERE l.is_active AND r.is_active AND r.wiki_region_key IS NOT NULL`,
        exists: `SELECT t.public_id::text AS id FROM terrain_peak t WHERE t.is_active
                 UNION ALL
                 SELECT l.public_id::text AS id FROM map_label l JOIN region r ON r.id = l.region_id WHERE l.is_active AND r.is_active`,
        label: "map_label",
    },
    landschaft: {
        keys: `SELECT r.public_id::text AS id, 'wiki:' || r.wiki_region_key AS key FROM region r
               WHERE r.is_active AND r.wiki_region_key IS NOT NULL`,
        exists: `SELECT r.public_id::text AS id FROM region r WHERE r.is_active`,
        label: "region",
    },
    gebiet: {
        keys: `SELECT t.public_id::text AS id, t.wiki_key AS key FROM territory t
               WHERE t.is_active AND t.wiki_key LIKE 'wiki:%'`,
        exists: `SELECT t.public_id::text AS id FROM territory t WHERE t.is_active
                 AND EXISTS (SELECT 1 FROM territory_shape s WHERE s.territory_id = t.id)`,
        label: "territory",
    },
};

async function ownKeys(database: Database, art: X2Art): Promise<Map<string, string>> {
    const rows = await database.unsafe<{ id: string; key: string }[]>(OWN_KEYS[art].keys);
    return new Map(rows.map((row) => [row.id, row.key]));
}

async function existing(database: Database, art: X2Art): Promise<Set<string>> {
    const rows = await database.unsafe<{ id: string }[]>(OWN_KEYS[art].exists);
    return new Set(rows.map((row) => row.id));
}

/** X2 gegen unsere eigenen Zuweisungen: gleich, abweichend, nur X2, nur bei uns. */
async function compareWithOwn(database: Database, rows: readonly AssignmentRow[]): Promise<Finding[]> {
    const findings: Finding[] = [];
    const differing: FindingObject[] = [];
    const numbers: Record<string, number> = {};
    const notOnMap: FindingObject[] = [];
    const notOnMapNumbers: Record<string, number> = {};
    for (const art of Object.keys(OWN_KEYS) as X2Art[]) {
        const mine = await ownKeys(database, art);
        const present = await existing(database, art);
        const wanted = rows.filter((row) => row.art === art);
        let same = 0;
        let different = 0;
        let onlyX2 = 0;
        const seen = new Set<string>();
        for (const row of wanted) {
            seen.add(row.publicId);
            const own = mine.get(row.publicId);
            if (!present.has(row.publicId)) {
                notOnMapNumbers[art] = (notOnMapNumbers[art] ?? 0) + 1;
                notOnMap.push({ table: OWN_KEYS[art].label, publicId: row.publicId, name: `${art} ${row.wikiKey}` });
            }
            if (own === row.wikiKey) same += 1;
            else if (own === undefined) {
                // Nur X2 kennt eine Zuweisung. Bei einem Objekt, das es bei uns nicht gibt, sagt das `x2_object_not_on_map`.
                if (present.has(row.publicId)) {
                    onlyX2 += 1;
                    differing.push({
                        table: OWN_KEYS[art].label,
                        publicId: row.publicId,
                        name: `${art}: nur X2 ${row.wikiKey}`,
                    });
                }
            } else {
                different += 1;
                differing.push({
                    table: OWN_KEYS[art].label,
                    publicId: row.publicId,
                    name: `${art}: X2 ${row.wikiKey} gegen unser ${own}`,
                });
            }
        }
        let onlyOwn = 0;
        for (const [id, key] of mine) {
            if (seen.has(id)) continue;
            onlyOwn += 1;
            differing.push({ table: OWN_KEYS[art].label, publicId: id, name: `${art}: nur bei uns ${key}` });
        }
        numbers[`${art}_gleich`] = same;
        numbers[`${art}_abweichend`] = different;
        numbers[`${art}_nur_x2`] = onlyX2;
        numbers[`${art}_nur_unser`] = onlyOwn;
    }
    const total = (suffix: string): number =>
        Object.entries(numbers)
            .filter(([name]) => name.endsWith(suffix))
            .reduce((sum, [, value]) => sum + value, 0);
    if (total("_abweichend") + total("_nur_x2") + total("_nur_unser") > 0) {
        findings.push(
            createFinding(
                "wiki_key_vs_assignment",
                `Die Zuordnung (X2) weicht von den Zuweisungen ab, die unsere Daten tragen: ${String(total("_abweichend"))} anderer Key, ${String(total("_nur_x2"))} nur in X2, ${String(total("_nur_unser"))} nur bei uns (gleich: ${String(total("_gleich"))}); X2 ist die Quelle des Lookups (Information, nichts wird korrigiert)`,
                numbers,
                differing,
                differing.length,
            ),
        );
    }
    if (notOnMap.length > 0) {
        findings.push(
            createFinding(
                "x2_object_not_on_map",
                `${String(notOnMap.length)} zugewiesene Objekte der Zuordnung gibt es bei uns nicht als Ziel (stillgelegt, verborgen, Gebiet ohne Form, freie Beschriftung); ihr Key ist kein Link (Information)`,
                notOnMapNumbers,
                notOnMap,
                notOnMap.length,
            ),
        );
    }
    return findings;
}

/**
 * Die alte Tafel der Verkehrswege der Orte gegen X1: Jede ihrer Zeilen (Anzeigetext, rohes Ziel) sollte in den Verkehrswege-Links der Seite stehen.
 * Das ist die Bedingung, sie abzulösen (Migration 0073): enthält X1 sie nicht vollständig, bleibt sie ein Befund.
 */
async function compareTrafficLinks(
    database: Database,
    pageTargets: ReadonlyMap<string, readonly { displayText: string; targetRaw: string }[]>,
): Promise<Finding[]> {
    const rows = await database<{ wiki_key: string; link_text: string; path_name: string; title: string | null }[]>`
        SELECT s.wiki_key, l.link_text, l.path_name, s.wiki_title AS title
        FROM wiki_settlement_traffic_link l JOIN wiki_settlement_snapshot s ON s.id = l.snapshot_id
        WHERE s.is_active
    `;
    if (rows.length === 0) return [];
    let contained = 0;
    let pageMissing = 0;
    const missing: FindingObject[] = [];
    for (const row of rows) {
        const targets = pageTargets.get(`wiki:${row.wiki_key}`);
        if (targets === undefined) {
            pageMissing += 1;
            missing.push({
                table: "wiki_settlement_traffic_link",
                publicId: row.wiki_key,
                name: `${row.link_text} → ${row.path_name} (Seite fehlt in X1)`,
            });
            continue;
        }
        if (targets.some((target) => target.displayText === row.link_text && target.targetRaw === row.path_name))
            contained += 1;
        else
            missing.push({
                table: "wiki_settlement_traffic_link",
                publicId: row.wiki_key,
                name: `${row.link_text} → ${row.path_name}`,
            });
    }
    if (missing.length === 0) return [];
    return [
        createFinding(
            "traffic_link_not_in_x1",
            `${String(missing.length)} von ${String(rows.length)} Zeilen der alten Tafel wiki_settlement_traffic_link stehen nicht in den Verkehrswege-Links von X1 (${String(pageMissing)} davon ohne Seite); enthalten: ${String(contained)}. Bis X1 sie vollständig trägt, wird die alte Tafel nicht abgelöst (Information)`,
            { alt: rows.length, enthalten: contained, fehlend: missing.length, ohne_seite: pageMissing },
            missing,
            missing.length,
        ),
    ];
}

export async function verifyWikiLinkTargets(
    database: Database,
    input: WikiLinkParityInput,
): Promise<WikiLinkParityReport> {
    const assignments =
        input.zuordnung === undefined || input.zuordnung === null ? null : transformAssignments(input.zuordnung);
    const links =
        input.linkziele === undefined || input.linkziele === null ? null : transformLinkTargets(input.linkziele);
    const findings: Finding[] = [...(assignments?.findings ?? []), ...(links?.findings ?? [])];
    if (assignments !== null && links !== null) findings.push(...crossFindings(links, assignments));
    const hasAssignments = assignments !== null && !assignments.skipped;
    const hasLinks = links !== null && !links.skipped;
    if (!hasAssignments && !hasLinks) return { passed: true, skipped: true, checks: [], findings };

    const checks: ParityCheck[] = [];

    // ---- Anzahl --------------------------------------------------------------------------------------------------------------------
    const have = {
        wiki_key_assignment: await count(database, "SELECT count(*) FROM wiki_key_assignment WHERE is_active"),
        wiki_link_page: await count(database, "SELECT count(*) FROM wiki_link_page WHERE is_active"),
        wiki_link_target: await count(
            database,
            "SELECT count(*) FROM wiki_link_target t JOIN wiki_link_page p ON p.id = t.page_id WHERE p.is_active",
        ),
    };
    const countParts: string[] = [];
    let countsPassed = true;
    if (hasAssignments) {
        const want = assignments.rows.length;
        countsPassed &&= have.wiki_key_assignment === want;
        countParts.push(
            `wiki_key_assignment ${String(have.wiki_key_assignment)} von ${String(want)} Objekten der Zuordnung`,
        );
    }
    if (hasLinks) {
        countsPassed &&= have.wiki_link_page === links.pages.length && have.wiki_link_target === links.targets.length;
        countParts.push(
            `wiki_link_page ${String(have.wiki_link_page)} von ${String(links.pages.length)} Artikeln, wiki_link_target ${String(have.wiki_link_target)} von ${String(links.targets.length)} Links`,
        );
    }
    checks.push(check("counts", countsPassed, countParts.join("; ")));

    // ---- Zuordnung Spalte für Spalte --------------------------------------------------------------------------------------------------
    if (hasAssignments) {
        const actual = new Map(
            (await readTableCells(database, "wiki_key_assignment", ASSIGNMENT_COLUMNS, "t.is_active")).map((cells) => [
                `${String(cells[0])}|${String(cells[1])}`,
                cells,
            ]),
        );
        const expected = new Map(assignments.rows.map((row) => [`${row.art}|${row.publicId}`, assignmentCells(row)]));
        const offenders = compareRows(
            expected,
            actual,
            ASSIGNMENT_COLUMNS.map((column) => column.name),
        );
        checks.push(
            check(
                "assignment_rows",
                offenders.length === 0,
                offenders.length === 0
                    ? `alle ${String(expected.size)} Zuordnungen stimmen Spalte für Spalte mit der Antwort überein (Key und Namensraum wörtlich)`
                    : `${String(offenders.length)} Zuordnungen weichen ab`,
                offenders,
            ),
        );
    }

    // ---- Artikel und Links Spalte für Spalte ---------------------------------------------------------------------------------------------
    if (hasLinks) {
        const actualPages = new Map(
            (await readTableCells(database, "wiki_link_page", PAGE_COLUMNS, "t.is_active")).map((cells) => [
                String(cells[0]),
                cells,
            ]),
        );
        const expectedPages = new Map(links.pages.map((page) => [page.pageKey, pageCells(page)]));
        const pageOffenders = compareRows(
            expectedPages,
            actualPages,
            PAGE_COLUMNS.map((column) => column.name),
        );
        checks.push(
            check(
                "page_rows",
                pageOffenders.length === 0,
                pageOffenders.length === 0
                    ? `alle ${String(expectedPages.size)} Artikel stimmen mit der Antwort überein`
                    : `${String(pageOffenders.length)} Artikel weichen ab`,
                pageOffenders,
            ),
        );

        const rows = await database.unsafe<Record<string, string | null>[]>(
            `SELECT p.page_key, t.field, t.position::text AS position, t.display_text, t.link_art, t.link_template, t.target_raw, t.target_key,
                    t.target_ns::text AS target_ns, t.target_ns_name, t.is_redirect::text AS is_redirect, t.redirect_title,
                    t.redirect_ns::text AS redirect_ns, t.redirect_ns_name
             FROM wiki_link_target t JOIN wiki_link_page p ON p.id = t.page_id WHERE p.is_active`,
        );
        const actualTargets = new Map(
            rows.map((row) => [
                `${String(row["page_key"])}|${String(row["field"])}|${String(row["position"])}`,
                TARGET_COLUMNS.map((column) => row[column.name] ?? null),
            ]),
        );
        const expectedTargets = new Map<string, Cell[]>(
            links.targets.map((target) => [
                `${target.pageKey}|${target.field}|${String(target.position)}`,
                targetCells(target),
            ]),
        );
        const targetOffenders = compareRows(
            expectedTargets,
            actualTargets,
            TARGET_COLUMNS.map((column) => column.name),
        );
        checks.push(
            check(
                "target_rows",
                targetOffenders.length === 0,
                targetOffenders.length === 0
                    ? `alle ${String(expectedTargets.size)} Links stimmen Spalte für Spalte überein: Anzeigetext, rohes Ziel, Key, Namensraum, Weiterleitung`
                    : `${String(targetOffenders.length)} Links weichen ab`,
                targetOffenders,
            ),
        );

        const gaps = await count(
            database,
            `SELECT count(*) FROM (SELECT page_id, field, max(position) + 1 AS n, count(*) AS c FROM wiki_link_target GROUP BY page_id, field) g WHERE g.n <> g.c`,
        );
        checks.push(
            check(
                "order",
                gaps === 0,
                gaps === 0
                    ? "die Links jedes Feldes tragen die Positionen 0 bis n-1 ohne Lücke: die Reihenfolge des Quelltextes ist erhalten"
                    : `${String(gaps)} Felder mit Lücke in den Positionen`,
            ),
        );
    }

    // ---- Struktur ------------------------------------------------------------------------------------------------------------------------
    const forbidden = await forbiddenColumns(database, WIKI_LINK_TABLES);
    const blanks =
        (await blankTextCount(database, "wiki_key_assignment", ["wiki_key"])) +
        (await blankTextCount(database, "wiki_link_page", ["page_key", "page_title"])) +
        (await blankTextCount(database, "wiki_link_target", ["field", "display_text", "target_key"]));
    checks.push(
        check(
            "structure",
            forbidden.length === 0 && blanks === 0,
            forbidden.length === 0 && blanks === 0
                ? "kein entity_type, kein JSON, kein leerer Text in den drei Tabellen"
                : `${String(forbidden.length)} verbotene Spalten, ${String(blanks)} leere Texte`,
            forbidden.map((column) => `${column.table_name}.${column.column_name} (${column.data_type})`),
        ),
    );

    // ---- Auflösung der Linkziele mit dem echten Lookup (Information) ----------------------------------------------------------------------------
    if (hasLinks) {
        const index = await buildSubjectIndex(database, "verify");
        const perField = new Map<string, { one: number; many: number; none: number }>();
        const unmatched = new Map<string, { count: number; raw: string }>();
        const totals = { one: 0, many: 0, none: 0 };
        const distinct = { one: new Set<string>(), many: new Set<string>(), none: new Set<string>() };
        for (const target of links.targets) {
            const match = lookupWikiKey(index.wikiKeys, target.targetKey);
            const bucket = match.kind;
            totals[bucket] += 1;
            distinct[bucket].add(target.targetKey);
            const entry = perField.get(target.field) ?? { one: 0, many: 0, none: 0 };
            entry[bucket] += 1;
            perField.set(target.field, entry);
            if (bucket === "none") {
                const known = unmatched.get(target.targetKey);
                unmatched.set(target.targetKey, {
                    count: (known?.count ?? 0) + 1,
                    raw: known?.raw ?? target.targetRaw,
                });
            }
        }
        const fieldLines = [...perField]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(
                ([field, entry]) =>
                    `${field}: ${String(entry.one)} Objekt, ${String(entry.many)} mehrdeutig, ${String(entry.none)} keins`,
            );
        checks.push(
            check(
                "resolution",
                true,
                `${String(links.targets.length)} Links aller Seiten: ${String(totals.one)} treffen genau ein Objekt der Karte (Link), ${String(totals.many)} mehrere (Text), ${String(totals.none)} keins (Text); verschiedene Ziele: ${String(distinct.one.size)} mit Objekt, ${String(distinct.many.size)} mehrdeutig, ${String(distinct.none.size)} ohne`,
                fieldLines,
            ),
        );
        const top = [...unmatched].sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b)).slice(0, 20);
        if (top.length > 0) {
            findings.push(
                createFinding(
                    "x1_ziele_ohne_kartenobjekt",
                    `${String(distinct.none.size)} verschiedene Linkziele treffen kein Objekt der Karte (${String(totals.none)} Links); die häufigsten stehen in den Zeilen darunter. Das sind Kandidaten für eine redaktionelle Zuweisung, kein Fehler (Information)`,
                    { ziele: distinct.none.size, links: totals.none },
                    [],
                    0,
                    top.map(([key, entry]) => `${key} (${entry.raw}): ${String(entry.count)} Links`),
                ),
            );
        }
        if (hasLinks) {
            const pageTargets = new Map<string, { displayText: string; targetRaw: string }[]>();
            for (const page of links.pages) pageTargets.set(page.pageKey, []);
            for (const target of links.targets) {
                if (target.field === "verkehrswege") pageTargets.get(target.pageKey)?.push(target);
            }
            findings.push(...(await compareTrafficLinks(database, pageTargets)));
        }
    }

    // ---- Abgleich mit den eigenen Zuweisungen (Befunde) -------------------------------------------------------------------------------------------
    if (hasAssignments) findings.push(...(await compareWithOwn(database, assignments.rows)));

    const settled = settleChecks("verify:wiki-links", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings };
}
