import type { Database } from "../database.ts";
import { countNamedPlaces, describeNamedPlaces, readSettlementKeyIndex } from "./staetten-genannte-orte.ts";
import { SITE_COLUMNS, siteCells, siteKeyOfCells } from "./staetten-rohquellen-import.ts";
import { SITE_KINDS, siteKeyOf, type RohquellenTransform, type SiteKind } from "./staetten-rohquellen.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import { blankTextCount, check, compareRows, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";

/**
 * Prüfer V21, Teil Kennungen (WI-0134, Vertrag `staetten.yaml` Version 2): die Tabellen `site`, `site_settlement`, `site_named_place`
 * gegen dieselbe Antwort von X4, aus der importiert wurde. Nur lesend; nichts hier hält an (Betreiber 2026-10-03).
 *
 * Geprüft wird: Zahl je Quelle, jede Stätte Spalte für Spalte, jeder Sitz als eigene Zeile, jede Beziehung samt Herkunft und - unabhängig
 * mit SQL nachgerechnet - dass ein Ort NUR aus der Kennung kommt, dass keine Kette eine Beziehung erzeugt hat, die genannten Orte in ihrer
 * Reihenfolge und die Struktur (kein Lageurteil, keine Bindung über einen Namen, kein Key an einer Stadtteilweiterleitung). Eine Quelle,
 * die der Kopf als ausgefallen meldet, wird nicht geprüft (ihr Bestand ist absichtlich unberührt).
 */

const KEY_SEPARATOR = String.fromCharCode(0x1f);

/** Spalten, die an den Tabellen der Stätten nie stehen: kein Lageurteil (Regel 3), keine Bindung über einen Namen (Regel 4). */
const FORBIDDEN_COLUMNS = [
    "settlement_key",
    "settlement_name",
    "scope",
    "scope_verdict",
    "lage_urteil",
    "is_outside",
    "art",
] as const;

const label = (key: string): string => `Stätte ${key.split(KEY_SEPARATOR).join(" · ")}`;

export async function verifyStaettenRohquellen(
    database: Database,
    expected: RohquellenTransform,
): Promise<ParityCheck[]> {
    const checks: ParityCheck[] = [];
    const okKinds = SITE_KINDS.filter((kind) => !expected.failedKinds.includes(kind));
    const skippedNote =
        expected.failedKinds.length === 0
            ? ""
            : `; nicht geprüft (Quelle ausgefallen, Bestand unberührt): ${expected.failedKinds.join(", ")}`;

    // ---- Zahl je Quelle -------------------------------------------------------------------------------------------------------------
    const perKind = await database<{ kind: string; n: number }[]>`
        SELECT source_kind AS kind, count(*)::int AS n FROM site
         WHERE source_system = 'legacy' AND is_active AND source_kind = ANY(${okKinds}::text[])
         GROUP BY source_kind
    `;
    const stored = new Map(perKind.map((row) => [row.kind, row.n]));
    const countOffenders = okKinds
        .filter((kind) => (stored.get(kind) ?? 0) !== expected.counts[kind].stored)
        .map(
            (kind) =>
                `${kind}: ${String(stored.get(kind) ?? 0)} aktiv, ${String(expected.counts[kind].stored)} in der Antwort`,
        );
    checks.push(
        check(
            "kennungen_counts",
            countOffenders.length === 0,
            `${okKinds.map((kind) => `${kind} ${String(stored.get(kind) ?? 0)}/${String(expected.counts[kind].stored)}`).join(", ")} (aktiv/Antwort)${skippedNote}`,
            countOffenders,
        ),
    );

    // ---- Zeile für Zeile -----------------------------------------------------------------------------------------------------------
    const kindFilter = okKinds.map((kind) => `'${kind}'`).join(", ");
    const actual = new Map(
        (
            await readTableCells(
                database,
                "site",
                SITE_COLUMNS,
                `t.source_system = 'legacy' AND t.is_active AND t.source_kind IN (${kindFilter === "" ? "''" : kindFilter})`,
            )
        ).map((cells) => [siteKeyOfCells(cells), cells]),
    );
    const wanted = new Map<string, Cell[]>(
        expected.sites.map((site) => [siteKeyOf(site.sourceKind, site.sourceKey), siteCells(site)]),
    );
    const rowOffenders = compareRows(
        wanted,
        actual,
        SITE_COLUMNS.map((column) => column.name),
        label,
    );
    const blank = await blankTextCount(database, "site", [
        "site_class",
        "site_type",
        "seat_role",
        "wiki_url",
        "wiki_key",
        "raw_location",
        "source_origin",
    ]);
    checks.push(
        check(
            "kennungen_rows",
            rowOffenders.length === 0 && blank === 0,
            rowOffenders.length === 0 && blank === 0
                ? `${String(actual.size)} Stätten gleich der Antwort (Art, Kennung, Name, Klasse, Art, Rolle, Reihenfolge, Adresse, Key, Ortsangabe, Herkunft, Karte); NULL bleibt NULL`
                : `${String(rowOffenders.length)} Stätten weichen ab, ${String(blank)} mit leerer Zeichenkette`,
            rowOffenders,
        ),
    );

    // ---- Sitze nie verschmolzen ------------------------------------------------------------------------------------------------------
    if (okKinds.includes("sitz")) {
        const seatsWanted = new Map<string, number>();
        for (const site of expected.sites) {
            if (site.sourceKind === "sitz") seatsWanted.set(site.name, (seatsWanted.get(site.name) ?? 0) + 1);
        }
        const seatsStored = new Map(
            (
                await database<{ name: string; n: number }[]>`
                    SELECT name, count(*)::int AS n FROM site
                     WHERE source_system = 'legacy' AND is_active AND source_kind = 'sitz' GROUP BY name
                `
            ).map((row) => [row.name, row.n]),
        );
        const merged = [...seatsWanted]
            .filter(([name, n]) => seatsStored.get(name) !== n)
            .map(
                ([name, n]) =>
                    `${name}: ${String(seatsStored.get(name) ?? 0)} Zeilen, ${String(n)} Sitze in der Antwort`,
            );
        const several = [...seatsWanted.values()].filter((n) => n > 1).length;
        checks.push(
            check(
                "sitze_getrennt",
                merged.length === 0,
                merged.length === 0
                    ? `${String(seatsWanted.size)} Organisationen mit ${String([...seatsWanted.values()].reduce((sum, n) => sum + n, 0))} Sitzen, je Sitz eine Zeile; ${String(several)} Organisationen mit mehreren Sitzen, nichts zusammengelegt`
                    : `${String(merged.length)} Organisationen tragen eine andere Zahl von Sitzen als die Antwort`,
                merged,
            ),
        );
    }

    // ---- Beziehungen: Herkunft wie geliefert, ein Ort nur aus der Kennung ------------------------------------------------------------
    const relations = await database<
        { kind: string; key: string; id: string | null; origin: string; place: string | null }[]
    >`
        SELECT s.source_kind AS kind, s.source_key AS key, r.settlement_legacy_public_id::text AS id, r.origin,
               r.place_id::text AS place
          FROM site_settlement r JOIN site s ON s.id = r.site_id
         WHERE r.is_active AND s.is_active AND s.source_kind = ANY(${okKinds}::text[])
    `;
    const haveRelation = new Map(relations.map((row) => [siteKeyOf(row.kind as SiteKind, row.key), row]));
    const relationOffenders: string[] = [];
    let decided = 0;
    for (const relation of expected.relations) {
        const have = haveRelation.get(relation.siteKey);
        if (have === undefined) {
            relationOffenders.push(`${label(relation.siteKey)}: Beziehung fehlt`);
            continue;
        }
        if (have.origin === "editor") {
            decided += 1;
            continue;
        }
        if (have.id !== relation.settlementLegacyPublicId || have.origin !== relation.origin) {
            relationOffenders.push(
                `${label(relation.siteKey)}: ${String(have.id)} (${have.origin}) statt ${String(relation.settlementLegacyPublicId)} (${relation.origin})`,
            );
        }
    }
    const expectedKeys = new Set(expected.relations.map((relation) => relation.siteKey));
    for (const [key, have] of haveRelation) {
        if (!expectedKeys.has(key) && have.origin !== "editor")
            relationOffenders.push(`${label(key)}: Beziehung zu viel`);
    }
    // Unabhängig mit SQL: ein Ort steht genau dann, wenn die Kennung einen aktiven Ort trifft, und dann genau dieser.
    const wrongPlace = await count(
        database,
        `SELECT count(*) FROM site_settlement r
          WHERE r.is_active AND r.origin <> 'editor' AND (
                (r.place_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM place p WHERE p.id = r.place_id AND p.public_id = r.settlement_legacy_public_id AND p.is_active))
             OR (r.place_id IS NULL AND r.settlement_legacy_public_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM place p WHERE p.public_id = r.settlement_legacy_public_id AND p.is_active)))`,
    );
    // Keine Kette erzeugt eine Beziehung: Wege, Sitze und Stadtteile tragen eine nur, wenn ein Mensch sie gesetzt hat.
    const fromChain = await count(
        database,
        `SELECT count(*) FROM site_settlement r JOIN site s ON s.id = r.site_id
          WHERE r.is_active AND r.origin <> 'editor' AND s.source_kind IN ('weg', 'sitz', 'stadtteil')`,
    );
    checks.push(
        check(
            "kennungen_relations",
            relationOffenders.length === 0 && wrongPlace === 0 && fromChain === 0,
            relationOffenders.length === 0 && wrongPlace === 0 && fromChain === 0
                ? `${String(expected.relations.length)} Beziehungen wie geliefert (Kennung und Herkunft), ${String(decided)} davon hält eine Entscheidung eines Menschen; jeder Ort aus der Kennung (SQL), keine aus einer Kette`
                : `${String(relationOffenders.length)} Beziehungen weichen ab, ${String(wrongPlace)} mit einem Ort, der nicht aus der Kennung kommt, ${String(fromChain)} aus einer Kette`,
            relationOffenders,
        ),
    );

    // ---- Genannte Orte in ihrer Reihenfolge -----------------------------------------------------------------------------------------
    const namedRows = await database<
        { kind: string; key: string; position: number; target: string; target_key: string | null }[]
    >`
        SELECT s.source_kind AS kind, s.source_key AS key, n.position, n.target_raw AS target, n.target_key
          FROM site_named_place n JOIN site s ON s.id = n.site_id
         WHERE s.is_active AND s.source_kind = ANY(${okKinds}::text[])
         ORDER BY s.source_kind, s.source_key, n.position
    `;
    const haveNamed = new Map<string, string[]>();
    for (const row of namedRows) {
        const key = siteKeyOf(row.kind as SiteKind, row.key);
        const list = haveNamed.get(key) ?? [];
        list.push(`${String(row.position)}:${row.target}→${row.target_key ?? "∅"}`);
        haveNamed.set(key, list);
    }
    const namedOffenders: string[] = [];
    let namedTotal = 0;
    for (const [key, places] of expected.namedPlaces) {
        namedTotal += places.length;
        const want = places.map((place) => `${String(place.position)}:${place.targetRaw}→${place.targetKey ?? "∅"}`);
        if ((haveNamed.get(key) ?? []).join("|") !== want.join("|"))
            namedOffenders.push(`${label(key)}: genannte Orte weichen ab`);
    }
    for (const key of haveNamed.keys())
        if (!expected.namedPlaces.has(key)) namedOffenders.push(`${label(key)}: zu viel`);
    checks.push(
        check(
            "kennungen_named_places",
            namedOffenders.length === 0,
            namedOffenders.length === 0
                ? `${String(namedTotal)} genannte Orte wie geliefert, in der Reihenfolge der Kette, Key wörtlich (ohne Key bleibt ohne Key)`
                : `${String(namedOffenders.length)} Stätten mit abweichenden genannten Orten`,
            namedOffenders,
        ),
    );

    // ---- Struktur --------------------------------------------------------------------------------------------------------------------
    const structure = (
        await forbiddenColumns(database, ["site", "site_settlement", "site_named_place"], FORBIDDEN_COLUMNS)
    ).map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`);
    const redirectKeys = await count(
        database,
        `SELECT count(*) FROM site WHERE source_kind = 'stadtteil' AND wiki_key IS NOT NULL`,
    );
    checks.push(
        check(
            "kennungen_structure",
            structure.length === 0 && redirectKeys === 0,
            structure.length === 0 && redirectKeys === 0
                ? "kein Lageurteil, keine Bindung über einen Namen, keine Art-Spalte, kein JSON; keine Stadtteilweiterleitung trägt einen Key"
                : `${String(structure.length)} verbotene Spalten, ${String(redirectKeys)} Stadtteilweiterleitungen mit Key`,
            structure,
        ),
    );

    // ---- Wirkung: offene Zuordnungen und genannte Orte als Zahl (Information) --------------------------------------------------------
    const chains = expected.sites
        .filter((site) => site.sourceKind === "weg" || site.sourceKind === "sitz" || site.sourceKind === "stadtteil")
        .map((site) =>
            (expected.namedPlaces.get(siteKeyOf(site.sourceKind, site.sourceKey)) ?? []).map(
                (place) => place.targetKey,
            ),
        );
    const named = countNamedPlaces(chains, await readSettlementKeyIndex(database));
    const [effect] = await database<{ orte: number; staetten: number }[]>`
        SELECT count(DISTINCT r.place_id)::int AS orte, count(*)::int AS staetten
          FROM site_settlement r JOIN site s ON s.id = r.site_id
         WHERE r.is_active AND s.is_active AND r.place_id IS NOT NULL
    `;
    checks.push(
        check(
            "kennungen_effect",
            true,
            `${String(effect?.staetten ?? 0)} Stätten hängen über eine Kennung an ${String(effect?.orte ?? 0)} Orten; ${String(expected.sites.length - expected.relations.length)} Stätten offen (eine Zahl, kein Fehler); ${describeNamedPlaces(named)}`,
        ),
    );
    return checks;
}
