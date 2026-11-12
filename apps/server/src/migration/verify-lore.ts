import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { CONTINENT_KEYS, LORE_KINDS, ruleKeyOf, type LoreKind } from "./lore-keys.ts";
import {
    ENTRY_COLUMNS,
    FIELD_ORIGIN_COLUMNS,
    LORE_TABLES,
    PLACE_COLUMNS,
    RULE_COLUMNS,
    SOURCE_COLUMNS,
    placeCells,
    readLoreLookups,
    ruleCells,
    sourceCells,
} from "./lore-import.ts";
import { transformLore } from "./lore.ts";
import { blankTextCount, check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";
import { readTableCells, type Cell, type SourceState } from "./sync-table.ts";

/**
 * Parität der Lore gegen dieselbe Antwortdatei, aus der importiert wurde (WI-0063 P3, Vertrag `lore.yaml`, `verifier`).
 *
 * Geprüft wird das AGGREGAT: Anzahl je Tabelle, jeder Eintrag Spalte für Spalte samt Zustand, die Herkunftsvermerke, jede Ortszeile
 * (Schlüssel, Titel, Beziehung, Reihenfolge, Zustand) und ihre Ziele, die Auflösung UNABHÄNGIG mit SQL nachgerechnet (nicht mit
 * `resolveLorePlace`), `key_class`, die Regeln samt Bedingungen und dem nachgerechneten `rule_key`, die Quellenverknüpfungen und die
 * Struktur (kein `entity_type`, kein JSON, kein `place_kind`, kein `created_by`, keine Merkmals- oder Bildspalte). Dazu die Befunde der
 * Umwandlung und, was erst der Prüfer rechnet: `place_target_carrier_unusable`,
 * `catalog_row_without_link_after_lore` und die Gegenprobe gegen die Zahlen des Vertrags.
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Die Sollzahlen im Vertrag sind [D] mit Datum und werden mit dem ersten Zug
 * nachgemessen; eine Abweichung ist ein Befund. Nur lesend.
 */

export interface LoreParityReport {
    passed: boolean;
    /** Die Antwort war unbrauchbar, leer, abgeschaltet oder widersprach ihren Zählern: der Schritt hat nichts geschrieben. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

export interface VerifyLoreOptions {
    /** Die Revision der `map-features.json` desselben Zuges. */
    mapRevision?: number | undefined;
}

/** Die Zahlen des Vertrags (alle [D] mit Datum 2026-07-21, mit dem ersten Zug nachzumessen). */
const CONTRACT_NUMBERS = { entries: 5104, places: 7748, links: 34930 } as const;
/** Abnahmefall des Vertrags: am Schlüssel `weiden` stehen 19 Tiere, 10 Pflanzen und 4 Spezies. */
const WEIDEN = { fauna: 19, flora: 10, spezies: 4 } as const;

/** Eine gespeicherte Bedingung mit ihrer Regel, wie der Prüfer sie liest. */
interface StoredTerm {
    rule_id: string;
    rule_key: string;
    relation: string;
    entry: string;
    seq: number;
    join_op: string;
    legacy_area: string | null;
    area_active: boolean | null;
    climate_from: string | null;
    climate_to: string | null;
    legacy_climate_from: string | null;
    legacy_climate_to: string | null;
    types: { layer: string; type: string }[];
}

const IN_LIST = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ");

export async function verifyLore(
    database: Database,
    payload: unknown,
    options: VerifyLoreOptions = {},
): Promise<LoreParityReport> {
    const lookups = await readLoreLookups(database);
    const expected = transformLore(payload, lookups, options.mapRevision ?? null);
    if (expected.skipped) return { passed: true, skipped: true, checks: [], findings: expected.findings };
    const checks: ParityCheck[] = [];
    const findings: Finding[] = [...expected.findings];
    const withheld: readonly LoreKind[] = expected.withheldKinds;
    const withheldList = withheld.filter((kind) => (LORE_KINDS as readonly string[]).includes(kind));

    // Einträge, die ein Editor-Entscheid hält, nimmt die Prüfung aus (der Import fasst sie nie an): ein von der Redaktion stillgelegter und jeder, den die
    // Redaktion im Fenster „Inhalte bearbeiten“ angelegt oder geändert hat (`source_system = 'editor'`, WI-0254). Ein Eintrag ohne Wiki-Artikel hat keinen
    // Schlüssel (Migration 0235) und steht nie in der Antwort.
    const entryRows = await database<
        {
            id: string;
            wiki_key: string | null;
            retired_origin: string | null;
            is_active: boolean;
            source_system: string;
        }[]
    >`
        SELECT id::text, wiki_key, retired_origin, is_active, source_system FROM lore_entry
    `;
    const idOf = new Map(
        entryRows.filter((row) => row.wiki_key !== null).map((row) => [row.wiki_key as string, row.id]),
    );
    const heldOut = new Set(
        entryRows
            .filter(
                (row) =>
                    row.wiki_key !== null &&
                    ((!row.is_active && row.retired_origin === "editor") || row.source_system === "editor"),
            )
            .map((row) => row.wiki_key as string),
    );
    const entries = expected.entries.filter((entry) => !heldOut.has(entry.wikiKey));
    // Eine Ortszeile, deren Ziel ein Editor von Hand gesetzt hat (target_origin editor), überschreibt kein Import: die Prüfung nimmt sie aus.
    const editorPlaces = new Set(
        (
            await database<{ key: string }[]>`
                SELECT lore_entry_id::text || '|' || coalesce(place_wiki_key, '') || '|' || relation AS key FROM lore_place WHERE target_origin = 'editor'
            `
        ).map((row) => row.key),
    );
    const places = expected.places.filter(
        (place) =>
            !heldOut.has(place.entryWikiKey) &&
            !editorPlaces.has(`${idOf.get(place.entryWikiKey) ?? ""}|${place.placeWikiKey}|${place.relation}`),
    );
    const rules = expected.rules.filter((rule) => !heldOut.has(rule.entryWikiKey));
    const links = expected.links.filter((link) => !heldOut.has(link.entryWikiKey));

    /** Der Eintrag einer Kindzeile (Alias `alias`) wird von einem Editor-Entscheid oder einer abgeschalteten Art gehalten. */
    const heldParentOf = (alias: string): string =>
        `EXISTS (SELECT 1 FROM lore_entry e WHERE e.id = ${alias}.lore_entry_id AND ((NOT e.is_active AND e.retired_origin = 'editor') OR e.source_system = 'editor'` +
        (withheldList.length > 0 ? ` OR e.kind IN (${IN_LIST(withheldList)})` : "") +
        `))`;
    const heldParent = heldParentOf("t");
    /** Die Zeilen, die der Lauf führt: aktiv oder von Legacy so geführt (retired, suppressed), ohne gehaltene Eltern oder Arten. */
    const followedEntry =
        `(t.is_active OR t.retired_origin = 'legacy') AND t.source_system <> 'editor'` +
        (withheldList.length > 0 ? ` AND t.kind NOT IN (${IN_LIST(withheldList)})` : "");
    const followedChildOf = (alias: string): string =>
        `(${alias}.is_active OR ${alias}.retired_origin = 'legacy') AND NOT ${heldParentOf(alias)}`;
    const followedChild = followedChildOf("t");
    /** Wie `followedChild`, ohne Ortszeilen mit einem Ziel von Hand. */
    const followedPlace = `${followedChild} AND t.target_origin <> 'editor'`;

    // ---- Anzahl --------------------------------------------------------------------------------------------------------------------
    const have = {
        entries: await count(database, `SELECT count(*) FROM lore_entry t WHERE ${followedEntry}`),
        places: await count(database, `SELECT count(*) FROM lore_place t WHERE ${followedPlace}`),
        rules: await count(database, `SELECT count(*) FROM lore_rule t WHERE t.is_active AND NOT ${heldParent}`),
        sources: await count(database, `SELECT count(*) FROM lore_entry_source t WHERE ${followedChild}`),
    };
    checks.push(
        check(
            "counts",
            have.entries === entries.length &&
                have.places === places.length &&
                have.rules === rules.length &&
                have.sources === links.length,
            `lore_entry ${String(have.entries)} von ${String(entries.length)} Einträgen der Antwort, lore_place ${String(have.places)} von ${String(places.length)} Ortszeilen, lore_rule ${String(have.rules)} von ${String(rules.length)} Regeln, lore_entry_source ${String(have.sources)} von ${String(links.length)} Verknüpfungen (nach Abzug der als nicht speicherbar gemeldeten und der von einem Editor-Entscheid oder einer abgeschalteten Art gehaltenen)`,
        ),
    );

    // ---- Zustand je Zeile ----------------------------------------------------------------------------------------------------------
    const stateOffenders = async (
        table: string,
        keyExpression: string,
        wanted: ReadonlyMap<string, SourceState>,
        label: (key: string) => string,
    ): Promise<string[]> => {
        const rows = await database.unsafe<
            { key: string; state: string; is_active: boolean; retired_origin: string | null }[]
        >(`SELECT ${keyExpression} AS key, t.state, t.is_active, t.retired_origin FROM ${table} t`);
        const actual = new Map(rows.map((row) => [row.key, row]));
        const offenders: string[] = [];
        for (const [key, state] of wanted) {
            const row = actual.get(key);
            if (row === undefined) continue; // die Zeile selbst meldet der Spaltenvergleich
            const matches =
                state === "active"
                    ? row.state === "active" && row.is_active && row.retired_origin === null
                    : row.state === state && !row.is_active && row.retired_origin === "legacy";
            if (!matches)
                offenders.push(`${label(key)}: Zustand ${row.state}/${row.retired_origin ?? "aktiv"} statt ${state}`);
        }
        return offenders;
    };

    // ---- Eintrag Spalte für Spalte ---------------------------------------------------------------------------------------------------
    const entryActual = new Map(
        (await readTableCells(database, "lore_entry", ENTRY_COLUMNS, followedEntry)).map((cells) => [
            String(cells[0]),
            cells,
        ]),
    );
    const entryWanted = new Map(
        entries.map((entry): [string, Cell[]] => [
            entry.wikiKey,
            [
                entry.wikiKey,
                entry.kind,
                entry.name,
                entry.wikiTitle,
                entry.wikiUrl,
                entry.gruppe,
                entry.typ,
                entry.lebensraum,
                entry.synonyme,
                entry.continent,
                entry.matchKey,
                entry.legacyOrigin,
            ],
        ]),
    );
    const entryOffenders = [
        ...compareRows(
            entryWanted,
            entryActual,
            ENTRY_COLUMNS.map((column) => column.name),
        ),
        ...(await stateOffenders(
            "lore_entry",
            "t.wiki_key",
            new Map(entries.map((entry) => [entry.wikiKey, entry.state])),
            (key) => key,
        )),
    ];
    const blank =
        (await blankTextCount(database, "lore_entry", [
            "wiki_title",
            "wiki_url",
            "gruppe",
            "typ",
            "lebensraum",
            "synonyme",
            "continent",
            "match_key",
        ])) +
        (await blankTextCount(database, "lore_place", ["place_title"])) +
        (await blankTextCount(database, "lore_entry_source", ["pages", "note"]));
    checks.push(
        check(
            "entry_parity",
            entryOffenders.length === 0 && blank === 0,
            entryOffenders.length === 0 && blank === 0
                ? `${String(entryActual.size)} Einträge: Art, Name, Wiki-Titel und -Adresse, Gruppe, Typ, Lebensraum, Synonyme, Kontinent, match_key, Herkunft und Zustand wie geliefert; wiki_key eindeutig; ${String(blank)} leere Zeichenketten (ein leerer Wert ist NULL)`
                : `${String(entryOffenders.length)} Abweichungen, ${String(blank)} leere Zeichenketten`,
            entryOffenders,
        ),
    );

    // ---- Herkunft je Feld ----------------------------------------------------------------------------------------------------------
    const originOffenders: string[] = [];
    let originRows = 0;
    const storedOrigins = new Map<string, Set<string>>();
    for (const cells of await readTableCells(database, "lore_entry_field_origin", [
        { name: "lore_entry_id", type: "bigint" },
        ...FIELD_ORIGIN_COLUMNS,
    ])) {
        const set = storedOrigins.get(String(cells[0])) ?? new Set<string>();
        set.add(`${String(cells[1])}=${String(cells[2])}`);
        storedOrigins.set(String(cells[0]), set);
    }
    for (const entry of entries) {
        const id = idOf.get(entry.wikiKey);
        const got = id === undefined ? new Set<string>() : (storedOrigins.get(id) ?? new Set<string>());
        const want = new Set(entry.fieldOrigins.map((origin) => `${origin.field}=${origin.origin}`));
        originRows += want.size;
        if (got.size !== want.size || [...want].some((item) => !got.has(item))) {
            originOffenders.push(`${entry.name} (${entry.wikiKey}): Herkunftsvermerke weichen ab`);
        }
    }
    checks.push(
        check(
            "field_origins",
            originOffenders.length === 0,
            `${String(originRows)} Herkunftsvermerke je Feld gleich der Antwort (ein fehlender Eintrag heißt nicht bekannt, nie wiki)`,
            originOffenders,
        ),
    );

    // ---- Ortszeilen ----------------------------------------------------------------------------------------------------------------
    const placeLabel = (key: string): string => {
        const [entryId = "", placeKeyPart = "", relation = ""] = key.split("|");
        const wikiKey = [...idOf].find(([, id]) => id === entryId)?.[0] ?? `Eintrag ${entryId}`;
        return `${wikiKey} / ${placeKeyPart} (${relation})`;
    };
    const placeKeyOf = (cells: readonly (Cell | undefined)[]): string =>
        `${String(cells[0])}|${String(cells[1])}|${String(cells[2])}`;
    const placeActual = new Map(
        (await readTableCells(database, "lore_place", PLACE_COLUMNS, followedPlace)).map((cells) => [
            placeKeyOf(cells),
            cells,
        ]),
    );
    const placeWanted = new Map<string, Cell[]>();
    const placeStates = new Map<string, SourceState>();
    const missingEntry: string[] = [];
    for (const place of places) {
        const id = idOf.get(place.entryWikiKey);
        if (id === undefined) {
            missingEntry.push(`${place.entryName} / ${place.placeWikiKey}: der Eintrag fehlt`);
            continue;
        }
        const cells = placeCells(id, place);
        placeWanted.set(placeKeyOf(cells), cells);
        placeStates.set(placeKeyOf(cells), place.state);
    }
    const placeOffenders = [
        ...missingEntry,
        ...compareRows(
            placeWanted,
            placeActual,
            PLACE_COLUMNS.map((column) => column.name),
            placeLabel,
        ),
        ...(await stateOffenders(
            "lore_place",
            "t.lore_entry_id::text || '|' || t.place_wiki_key || '|' || t.relation",
            placeStates,
            placeLabel,
        )),
    ];
    checks.push(
        check(
            "place_parity",
            placeOffenders.length === 0,
            placeOffenders.length === 0
                ? `${String(placeActual.size)} Ortszeilen: Schlüssel, Titel, Beziehung, Reihenfolge (sort_order wörtlich), Herkunft, Zustand, key_class und Zielzustand gleich der Antwort (neu gerechnet gegen die Trägertabellen); die Grabsteine stehen als suppressed`
                : `${String(placeOffenders.length)} Ortszeilen weichen ab`,
            placeOffenders,
        ),
    );

    // ---- Ziele: Zähler, Zustand, unabhängige Nachrechnung -----------------------------------------------------------------------------
    const [stateTotals] = await database.unsafe<
        { total: number; resolved: number; ambiguous: number; unresolved: number; unmatched: number }[]
    >(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE target_state = 'resolved')::int AS resolved,
                count(*) FILTER (WHERE target_state = 'ambiguous')::int AS ambiguous,
                count(*) FILTER (WHERE target_state = 'unresolved')::int AS unresolved,
                count(*) FILTER (WHERE target_state = 'unmatched')::int AS unmatched
           FROM lore_place t WHERE ${followedPlace}`,
    );
    const stateSum =
        (stateTotals?.resolved ?? 0) +
        (stateTotals?.ambiguous ?? 0) +
        (stateTotals?.unresolved ?? 0) +
        (stateTotals?.unmatched ?? 0);
    const countMismatch = await count(
        database,
        `SELECT count(*) FROM lore_place p WHERE p.target_count <> (SELECT count(*) FROM lore_place_target g WHERE g.lore_place_id = p.id)`,
    );
    const inactiveTargets = await count(
        database,
        `SELECT count(*) FROM lore_place_target g JOIN lore_place p ON p.id = g.lore_place_id
          WHERE p.target_origin <> 'editor' AND p.is_active AND (
                EXISTS (SELECT 1 FROM place x WHERE x.id = g.place_id AND NOT x.is_active)
             OR EXISTS (SELECT 1 FROM territory x WHERE x.id = g.territory_id AND NOT x.is_active)
             OR EXISTS (SELECT 1 FROM region x WHERE x.id = g.region_id AND NOT x.is_active)
             OR EXISTS (SELECT 1 FROM terrain_peak x WHERE x.id = g.terrain_peak_id AND NOT x.is_active))`,
    );
    const continentList = IN_LIST(CONTINENT_KEYS);
    const keyBody = "regexp_replace(lower(btrim(p.place_wiki_key)), '^wiki:', '')";
    const classOffenders = await database.unsafe<{ entry: string; key: string }[]>(
        `SELECT e.wiki_key AS entry, p.place_wiki_key AS key FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id
          WHERE p.target_origin <> 'editor' AND (
                (${keyBody} IN (${continentList})) <> (p.key_class = 'continent')
             OR (p.target_state = 'unresolved' AND p.key_class <> 'continent')
             OR (p.target_state = 'unmatched' AND p.key_class = 'continent'))
          ORDER BY e.wiki_key, p.place_wiki_key LIMIT 200`,
    );
    checks.push(
        check(
            "place_targets",
            stateSum === (stateTotals?.total ?? 0) &&
                countMismatch === 0 &&
                inactiveTargets === 0 &&
                classOffenders.length === 0,
            `${String(stateTotals?.total ?? 0)} Ortszeilen = ${String(stateTotals?.resolved ?? 0)} aufgelöst + ${String(stateTotals?.ambiguous ?? 0)} mehrdeutig + ${String(stateTotals?.unresolved ?? 0)} ohne Träger (Kontinentbegriff) + ${String(stateTotals?.unmatched ?? 0)} nicht gefunden; target_count gleich der Zahl der Zielzeilen (${String(countMismatch)} Abweichungen), ${String(inactiveTargets)} Ziele auf stillgelegte Träger; key_class genau bei den Schlüsseln der Kontinentliste (unresolved nur bei Kontinentbegriffen ohne Träger, unmatched nie bei einem)`,
            classOffenders.map(
                (row) => `${row.entry} / ${row.key}: key_class oder Zielzustand passt nicht zum Schlüssel`,
            ),
        ),
    );
    // Die Treffermenge je Ortszeile mit dem ECHTEN Lookup der Oberfläche neu gerechnet (`expected.places`, gebaut aus der Zuordnung X2 des heutigen
    // Standes) und mit den gespeicherten Zielen verglichen. Ein Name, Titel oder match_key kommt darin nicht vor.
    const storedTargets = new Map<string, Set<string>>();
    for (const row of await database.unsafe<
        {
            lore_entry_id: string;
            place_wiki_key: string;
            relation: string;
            place_id: string | null;
            territory_id: string | null;
            region_id: string | null;
            terrain_peak_id: string | null;
        }[]
    >(
        `SELECT p.lore_entry_id::text, p.place_wiki_key, p.relation, g.place_id::text, g.territory_id::text, g.region_id::text, g.terrain_peak_id::text
           FROM lore_place_target g JOIN lore_place p ON p.id = g.lore_place_id`,
    )) {
        const key = `${row.lore_entry_id}|${row.place_wiki_key}|${row.relation}`;
        const set = storedTargets.get(key) ?? new Set<string>();
        set.add(
            row.place_id !== null
                ? `place_id:${row.place_id}`
                : row.territory_id !== null
                  ? `territory_id:${row.territory_id}`
                  : row.region_id !== null
                    ? `region_id:${row.region_id}`
                    : `terrain_peak_id:${String(row.terrain_peak_id)}`,
        );
        storedTargets.set(key, set);
    }
    const resolutionOffenders: string[] = [];
    for (const place of places) {
        const id = idOf.get(place.entryWikiKey);
        if (id === undefined) continue;
        const have = storedTargets.get(`${id}|${place.placeWikiKey}|${place.relation}`) ?? new Set<string>();
        const want = new Set(place.hits.map((hit) => `${hit.column}:${hit.id}`));
        if (have.size !== want.size || [...want].some((hit) => !have.has(hit))) {
            resolutionOffenders.push(
                `${place.entryName} / ${place.placeWikiKey}: gespeichert ${[...have].sort().join(", ") || "nichts"}, neu gerechnet ${[...want].sort().join(", ") || "nichts"}`,
            );
        }
    }
    // Und unabhängig davon mit SQL belegt: Jedes gespeicherte Ziel hat in der Zuordnung X2 genau diesen Schlüssel (`wiki:` plus Slug, wörtlich) für
    // GENAU diesen Träger (Ort über die Kennung, Gebiet, Gipfel; bei einer Landschaft eine Landschaft oder Beschriftung dieses Schlüssels).
    const prefixedKey =
        "CASE WHEN btrim(p.place_wiki_key) LIKE 'wiki:%' THEN btrim(p.place_wiki_key) ELSE 'wiki:' || btrim(p.place_wiki_key) END";
    const withoutAssignment = await database.unsafe<{ entry: string; key: string }[]>(
        `SELECT e.wiki_key AS entry, p.place_wiki_key AS key
           FROM lore_place_target g JOIN lore_place p ON p.id = g.lore_place_id JOIN lore_entry e ON e.id = p.lore_entry_id
          WHERE p.target_origin <> 'editor' AND NOT EXISTS (
                SELECT 1 FROM wiki_key_assignment a
                 WHERE a.is_active AND a.wiki_key = ${prefixedKey} AND (
                       (g.place_id IS NOT NULL AND a.legacy_art = 'siedlung'
                          AND a.object_public_id = (SELECT x.public_id FROM place x WHERE x.id = g.place_id))
                    OR (g.territory_id IS NOT NULL AND a.legacy_art = 'gebiet'
                          AND a.object_public_id = (SELECT x.public_id FROM territory x WHERE x.id = g.territory_id))
                    OR (g.terrain_peak_id IS NOT NULL AND a.legacy_art = 'region'
                          AND a.object_public_id = (SELECT x.public_id FROM terrain_peak x WHERE x.id = g.terrain_peak_id))
                    OR (g.region_id IS NOT NULL AND a.legacy_art IN ('landschaft', 'region'))))
          ORDER BY e.wiki_key, p.place_wiki_key LIMIT 200`,
    );
    const assignmentOffenders = withoutAssignment.map(
        (row) => `${row.entry} / ${row.key}: ein Ziel ohne Eintrag mit diesem Schlüssel in der Zuordnung X2`,
    );
    const resolvedRows = await count(
        database,
        `SELECT count(*) FROM lore_place t WHERE t.target_state IN ('resolved', 'ambiguous') AND ${followedPlace}`,
    );
    const resolutionProblems = [...resolutionOffenders, ...assignmentOffenders];
    checks.push(
        check(
            "place_resolution",
            resolutionProblems.length === 0,
            resolutionProblems.length === 0
                ? `${String(resolvedRows)} Ortszeilen mit Treffern: die Treffermenge je Zeile mit dem Lookup der Oberfläche (Zuordnung X2, derselbe Weg wie die Objektlinks) neu gerechnet und gleich den gespeicherten Zielen; jedes Ziel hat in X2 genau diesen Wiki-Key (mit SQL belegt); kein Treffer über einen Namen, Titel oder match_key`
                : `${String(resolutionProblems.length)} Ortszeilen lassen sich nicht nachrechnen oder belegen`,
            resolutionProblems,
        ),
    );

    // ---- Regeln --------------------------------------------------------------------------------------------------------------------
    const ruleKeyed = (cells: readonly (Cell | undefined)[]): string => `${String(cells[0])}|${String(cells[1])}`;
    const ruleActual = new Map(
        (await readTableCells(database, "lore_rule", RULE_COLUMNS, `t.is_active AND NOT ${heldParent}`)).map(
            (cells) => [ruleKeyed(cells), cells],
        ),
    );
    const ruleWanted = new Map<string, Cell[]>();
    for (const rule of rules) {
        const id = idOf.get(rule.entryWikiKey);
        if (id !== undefined) ruleWanted.set(ruleKeyed(ruleCells(id, rule)), ruleCells(id, rule));
    }
    const ruleOffenders = compareRows(
        ruleWanted,
        ruleActual,
        RULE_COLUMNS.map((column) => column.name),
        (key) => {
            const [entryId = "", ruleKey = ""] = key.split("|");
            return `${[...idOf].find(([, id]) => id === entryId)?.[0] ?? `Eintrag ${entryId}`} / ${ruleKey.slice(0, 12)}`;
        },
    );
    // Bedingungen: ohne Lücke in der Reihenfolge, join_op nur und oder, Fläche aktiv oder NULL mit Kennung, Klima als Paar, Arten
    // eindeutig, rule_key aus den gespeicherten Legacy-Werten nachgerechnet.
    const termRows = await database.unsafe<StoredTerm[]>(
        `SELECT r.id::text AS rule_id, r.rule_key, r.relation, e.wiki_key AS entry, t.seq::int AS seq, t.join_op, t.legacy_area_public_id AS legacy_area,
                (SELECT g.is_active FROM region g WHERE g.id = t.area_region_id) AS area_active,
                t.climate_from, t.climate_to, t.legacy_climate_from, t.legacy_climate_to,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('layer', y.region_layer, 'type', y.region_type))
                            FROM lore_rule_term_type y WHERE y.lore_rule_term_id = t.id), '[]'::jsonb) AS types
           FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id JOIN lore_entry e ON e.id = r.lore_entry_id
          WHERE r.is_active ORDER BY r.id, t.seq`,
    );
    const termOffenders: string[] = [];
    const byRule = new Map<string, StoredTerm[]>();
    for (const row of termRows) {
        const list = byRule.get(row.rule_id) ?? [];
        list.push(row);
        byRule.set(row.rule_id, list);
    }
    for (const list of byRule.values()) {
        const head = list[0];
        if (head === undefined) continue;
        const label = `${head.entry} / ${head.rule_key.slice(0, 12)}`;
        if (list.some((row, index) => row.seq !== index))
            termOffenders.push(`${label}: die Reihenfolge der Bedingungen hat Lücken oder weicht von 0, 1, 2 … ab`);
        if (list.some((row) => row.join_op !== "und" && row.join_op !== "oder"))
            termOffenders.push(`${label}: join_op ausserhalb von und, oder`);
        if (list.some((row) => row.legacy_area !== null && row.area_active === false))
            termOffenders.push(`${label}: eine Fläche zeigt auf eine stillgelegte Region`);
        if (list.some((row) => (row.climate_from === null) !== (row.climate_to === null)))
            termOffenders.push(`${label}: Klimaspanne nur mit einem Endpunkt`);
        if (
            list.some((row) => new Set(row.types.map((type) => `${type.layer}|${type.type}`)).size !== row.types.length)
        )
            termOffenders.push(`${label}: Landschaftsarten nicht eindeutig`);
        const recomputed = ruleKeyOf(
            head.entry,
            head.relation,
            list.map((row) => ({
                joinOp: row.join_op === "oder" ? "oder" : "und",
                areaPublicId: row.legacy_area,
                climateFrom: row.legacy_climate_from,
                climateTo: row.legacy_climate_to,
                types: row.types,
            })),
        );
        if (recomputed !== head.rule_key)
            termOffenders.push(`${label}: rule_key stimmt nicht mit dem aus den Bedingungen nachgerechneten überein`);
    }
    const expectedTerms = rules.reduce((sum, rule) => sum + rule.terms.length, 0);
    const expectedTypes = rules.reduce(
        (sum, rule) => sum + rule.terms.reduce((inner, term) => inner + term.types.length, 0),
        0,
    );
    const haveTerms = await count(
        database,
        `SELECT count(*) FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id WHERE r.is_active AND NOT EXISTS (
            SELECT 1 FROM lore_entry e WHERE e.id = r.lore_entry_id AND ((NOT e.is_active AND e.retired_origin = 'editor') OR e.source_system = 'editor'${withheldList.length > 0 ? ` OR e.kind IN (${IN_LIST(withheldList)})` : ""}))`,
    );
    const haveTypes = termRows.reduce((sum, row) => sum + row.types.length, 0);
    const ruleProblems = [...ruleOffenders, ...termOffenders];
    checks.push(
        check(
            "rules",
            ruleProblems.length === 0 && haveTerms === expectedTerms,
            ruleProblems.length === 0 && haveTerms === expectedTerms
                ? `${String(ruleActual.size)} Regeln mit ${String(haveTerms)} Bedingungen und ${String(haveTypes)} von ${String(expectedTypes)} Landschaftsarten: Bedingungen in seq-Reihenfolge ohne Lücke, join_op nur und oder, Flächen aktiv oder NULL mit der Kennung, Klimaspannen als Paar, Arten eindeutig, rule_key aus den gespeicherten Legacy-Werten nachgerechnet gleich gespeichert`
                : `${String(ruleProblems.length)} Abweichungen (Bedingungen ${String(haveTerms)} von ${String(expectedTerms)})`,
            ruleProblems,
        ),
    );

    // ---- Quellenverknüpfungen -------------------------------------------------------------------------------------------------------
    const linkKeyed = (cells: readonly (Cell | undefined)[]): string => `${String(cells[0])}|${String(cells[1])}`;
    const linkActual = new Map(
        (await readTableCells(database, "lore_entry_source", SOURCE_COLUMNS, followedChild)).map((cells) => [
            linkKeyed(cells),
            cells,
        ]),
    );
    const linkWanted = new Map<string, Cell[]>();
    const linkStates = new Map<string, SourceState>();
    for (const link of links) {
        const id = idOf.get(link.entryWikiKey);
        if (id === undefined) continue;
        const cells = sourceCells(id, link);
        linkWanted.set(linkKeyed(cells), cells);
        linkStates.set(linkKeyed(cells), link.state);
    }
    const linkLabel = (key: string): string => {
        const [entryId = "", sourceId = ""] = key.split("|");
        return `${[...idOf].find(([, id]) => id === entryId)?.[0] ?? `Eintrag ${entryId}`} / Quelle ${sourceId}`;
    };
    const linkOffenders = [
        ...compareRows(
            linkWanted,
            linkActual,
            SOURCE_COLUMNS.map((column) => column.name),
            linkLabel,
        ),
        ...(await stateOffenders(
            "lore_entry_source",
            "t.lore_entry_id::text || '|' || t.source_id::text",
            linkStates,
            linkLabel,
        )),
    ];
    const inactiveSources = await count(
        database,
        `SELECT count(*) FROM lore_entry_source t JOIN feature_source s ON s.id = t.source_id WHERE t.is_active AND NOT s.is_active`,
    );
    checks.push(
        check(
            "source_links",
            linkOffenders.length === 0 && inactiveSources === 0,
            linkOffenders.length === 0 && inactiveSources === 0
                ? `${String(linkActual.size)} Quellenverknüpfungen: Art, Seiten, Notiz, Herkunft, Reihenfolge und Zustand wie geliefert (unterdrückte als suppressed), (Eintrag, Quelle) eindeutig, jede aktive zeigt auf eine aktive Katalogzeile von D1; Quellen werden nicht vererbt`
                : `${String(linkOffenders.length)} Verknüpfungen weichen ab, ${String(inactiveSources)} aktive an stillgelegten Katalogzeilen`,
            linkOffenders,
        ),
    );

    // ---- Struktur --------------------------------------------------------------------------------------------------------------------
    const structure = await forbiddenColumns(
        database,
        [...LORE_TABLES],
        [
            "place_kind",
            "created_by",
            "merkmale",
            "merkmale_json",
            "raw_json",
            "image_url",
            "image_license_status",
            "image_author",
            "image_attribution",
            "synced_at",
            "territory_path",
        ],
    );
    checks.push(
        check(
            "structure",
            structure.length === 0,
            structure.length === 0
                ? "keine entity_type-Spalte, kein JSON-Typ, kein place_kind, kein created_by, keine Merkmals- oder Bildspalte und kein gespeicherter Gebietspfad in den Tabellen von D5"
                : `${String(structure.length)} verbotene Spalten`,
            structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ),
    );

    // ---- Befunde, die erst der Prüfer rechnet --------------------------------------------------------------------------------------
    // Der Schlüssel steht in der Zuordnung X2, trifft aber keinen auflösbaren Träger: stillgelegt, verborgen, anderer Kartenraum, ein Gebiet ohne
    // abgeleitete Form oder eine Landschaft/Beschriftung ohne Region. Ein Weg und eine Kraftlinie zählen nicht (kein Zielraum der Lore).
    const unusable = await database.unsafe<{ entry: string; key: string; arts: string }[]>(
        `SELECT e.wiki_key AS entry, p.place_wiki_key AS key, string_agg(DISTINCT a.legacy_art, ', ' ORDER BY a.legacy_art) AS arts
           FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id
           JOIN wiki_key_assignment a ON a.is_active AND a.legacy_art IN ('siedlung', 'landschaft', 'region', 'gebiet')
                AND a.wiki_key = ${prefixedKey}
          WHERE p.target_count = 0 AND p.is_active
          GROUP BY e.wiki_key, p.place_wiki_key
          ORDER BY e.wiki_key, p.place_wiki_key`,
    );
    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "place_target_carrier_unusable",
                `${String(unusable.length)} Ortszeilen, deren Schlüssel in der Zuordnung X2 steht, aber keinen auflösbaren Träger trifft (Träger stillgelegt, verborgen, anderer Kartenraum, Gebiet ohne abgeleitete Form oder Landschaft ohne Region); sie bleiben ohne Ziel`,
                { zeilen: unusable.length },
                unusable.slice(0, 200).map((row): FindingObject => ({
                    table: "lore_place",
                    publicId: row.entry,
                    name: `${row.key} (${row.arts})`,
                })),
                unusable.length,
            ),
        );
    }
    // Quellen: Katalogzeilen ohne jede Verknüpfung auch nach D5 (Gegenprobe zu den Zeilen, die D1 als „vermutlich Lore“ vermerkt).
    const unlinked = await database.unsafe<{ title: string; source_key: string }[]>(
        `SELECT s.title, s.source_key FROM feature_source s
          WHERE s.is_active
            AND NOT EXISTS (SELECT 1 FROM place_source x WHERE x.source_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM path_source x WHERE x.source_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM territory_source x WHERE x.source_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM region_source x WHERE x.source_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM terrain_peak_source x WHERE x.source_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM lore_entry_source x WHERE x.source_id = s.id)
            AND (to_regclass('citymap_source') IS NULL OR NOT EXISTS (SELECT 1 FROM citymap_source x WHERE x.source_id = s.id))
          ORDER BY s.title LIMIT 200`,
    );
    if (unlinked.length > 0) {
        findings.push(
            createFinding(
                "catalog_row_without_link_after_lore",
                `${String(unlinked.length)} Katalogzeilen von D1 ohne jede Verknüpfung auch nach D5 (Gegenprobe zu den 410, die sources.yaml als vermutlich Lore vermerkt; Information)`,
                { zeilen: unlinked.length },
                unlinked.map((row): FindingObject => ({
                    table: "feature_source",
                    publicId: row.source_key,
                    name: row.title,
                })),
            ),
        );
    }
    // Gegenprobe gegen die Zahlen des Vertrags [D] und den Abnahmefall Weiden.
    const weiden = await database<{ kind: string; n: number }[]>`
        SELECT e.kind, count(DISTINCT e.id)::int AS n
          FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id
         WHERE p.is_active AND e.is_active AND regexp_replace(lower(btrim(p.place_wiki_key)), '^wiki:', '') = 'weiden'
         GROUP BY e.kind
    `;
    const weidenCount = (kind: string): number => weiden.find((row) => row.kind === kind)?.n ?? 0;
    findings.push(
        createFinding(
            "contract_numbers",
            `Gemessen gegen die Zahlen des Vertrags ([D], Datum 2026-07-21; Abweichungen sind erwartbar): Einträge ${String(entries.length)} (Vertrag ${String(CONTRACT_NUMBERS.entries)}), Ortszeilen ${String(places.length)} (${String(CONTRACT_NUMBERS.places)}), Quellenverknüpfungen ${String(links.length)} (${String(CONTRACT_NUMBERS.links)}); am Schlüssel weiden ${String(weidenCount("fauna"))} Tiere, ${String(weidenCount("flora"))} Pflanzen, ${String(weidenCount("spezies"))} Spezies (Vertrag ${String(WEIDEN.fauna)}, ${String(WEIDEN.flora)}, ${String(WEIDEN.spezies)}); mit dem ersten Zug im Vertrag eintragen`,
            {
                eintraege: entries.length,
                ortszeilen: places.length,
                verknuepfungen: links.length,
                weiden_fauna: weidenCount("fauna"),
                weiden_flora: weidenCount("flora"),
                weiden_spezies: weidenCount("spezies"),
            },
        ),
    );

    const settled = settleChecks("verify:lore", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings };
}
