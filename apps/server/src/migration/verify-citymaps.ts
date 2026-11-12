import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { readTargetIndex } from "./catalog-places.ts";
import { transformCitymaps, type CitymapOverlay } from "./citymaps.ts";
import {
    ASSIGNMENT_COLUMNS,
    CITYMAP_TABLES,
    LINK_COLUMNS,
    MAP_COLUMNS,
    PLACE_COLUMNS,
    SOURCE_LINK_COLUMNS,
    TYPE_COLUMNS,
    orderedPair,
    placeCells,
} from "./citymaps-import.ts";
import { readTableCells, type Cell } from "./sync-table.ts";
import {
    blankTextCount,
    check,
    compareRows,
    count,
    forbiddenColumns,
    territoryChains,
    verifyPlaceTable,
    type ParityCheck,
} from "./verify-catalog.ts";

/**
 * Parität der Kartensammlung gegen dieselbe Antwortdatei, aus der importiert wurde (WI-0063 P3, Vertrag `citymaps.yaml`, `verifier`).
 *
 * Geprüft wird das AGGREGAT: Anzahl je Tabelle, jede Karte Spalte für Spalte (Dreiwert-Merkmale und `color_mode` bleiben NULL, wo die
 * Antwort null liefert), Elter ohne Zyklus, Typen, Paare, jede Ortszeile samt Reihenfolge und Zielzustand, die Auflösung UNABHÄNGIG mit
 * SQL nachgerechnet, der Karten-Link (höchstens einer, gleich `links[0]`), die Fundstellen, die Quellenverknüpfung (mit dem Satz), die
 * Struktur (kein `entity_type`, kein JSON, kein `is_color`, kein `is_paid` an der Karte, keine Rolle am Ort, kein gespeicherter
 * Gebietspfad) und die Waisen. Dazu die Befunde der Umwandlung und `territory_path_divergent` (Information).
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Der Vertrag nennt für den Katalog keine Sollzahlen (nicht abgerufen,
 * UNKNOWN); fest sind die Quellenträger des Satzes 161832. Nur lesend.
 */

export const CONTRACT_SET_REVISION = 161832;
/** Die Sollzahlen des Vertrags für den Satz 161832 (Quellenverknüpfung der Karten, aus `map-features.json`). */
export const CONTRACT_NUMBERS = {
    source_carriers: 633,
    source_links: 633,
    source_distinct: 131,
    source_urlless: 25,
    reference_kind_empty: 633,
    pages: 0,
    notes: 0,
} as const;

export interface CitymapsParityReport {
    passed: boolean;
    /** Die Antwort war unbrauchbar, leer oder abgeschaltet: der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

export async function verifyCitymaps(
    database: Database,
    payload: unknown,
    options: { features?: unknown; overlay?: CitymapOverlay | null } = {},
): Promise<CitymapsParityReport> {
    const overlay = options.overlay ?? null;
    const index = await readTargetIndex(database);
    const expected = transformCitymaps(payload, index, { features: options.features, overlay });
    if (expected.skipped) return { passed: true, skipped: true, checks: [], findings: expected.findings };
    const checks: ParityCheck[] = [];
    const findings: Finding[] = [...expected.findings];

    const mapRows = await database<{ id: string; public_id: string; state: string; retired_origin: string | null }[]>`
        SELECT id::text, public_id::text, state, retired_origin FROM citymap
    `;
    const idOf = new Map(mapRows.map((row) => [row.public_id, row.id]));
    const heldOut = new Set(
        mapRows
            .filter((row) => row.state === "suppressed" || (row.state === "retired" && row.retired_origin === "editor"))
            .map((row) => row.public_id),
    );
    const titleOfId = new Map(expected.maps.map((row) => [idOf.get(row.publicId) ?? "", row.title]));
    const maps = expected.maps.filter((row) => !heldOut.has(row.publicId));
    const types = expected.types.filter((row) => !heldOut.has(row.mapPublicId));
    const related = expected.related.filter((row) => !heldOut.has(row.a) && !heldOut.has(row.b));
    const places = expected.places.filter((row) => !heldOut.has(row.mapPublicId));
    const links = expected.links.filter((row) => !heldOut.has(row.mapPublicId));

    // ---- Anzahl --------------------------------------------------------------------------------------------------------------------
    const have: Record<string, number> = {};
    for (const table of ["citymap", "citymap_type", "citymap_related", "citymap_place", "citymap_link"]) {
        have[table] = await count(database, `SELECT count(*) FROM ${table} WHERE state = 'active'`);
    }
    const want: Record<string, number> = {
        citymap: maps.length,
        citymap_type: types.length,
        citymap_related: related.length,
        citymap_place: places.length,
        citymap_link: links.length,
    };
    const countDiffers = Object.keys(want).filter((table) => have[table] !== want[table]);
    checks.push(
        check(
            "counts",
            countDiffers.length === 0,
            `citymap ${String(have["citymap"])} von ${String(want["citymap"])} Karten der Antwort, citymap_type ${String(have["citymap_type"])} von ${String(want["citymap_type"])} bekannten Typen, citymap_related ${String(have["citymap_related"])} von ${String(want["citymap_related"])} Paaren, citymap_place ${String(have["citymap_place"])} von ${String(want["citymap_place"])} Orten, citymap_link ${String(have["citymap_link"])} von ${String(want["citymap_link"])} Links (nach Abzug der als nicht speicherbar gemeldeten)`,
            countDiffers.map((table) => `${table}: ${String(have[table])} statt ${String(want[table])}`),
        ),
    );

    // ---- Karte Spalte für Spalte -------------------------------------------------------------------------------------------------------
    const mapActual = new Map(
        (await readTableCells(database, "citymap", MAP_COLUMNS, "t.state = 'active'")).map((cells) => [
            String(cells[0]),
            cells,
        ]),
    );
    const mapWanted = new Map(
        maps.map((row) => [
            row.publicId,
            [
                row.publicId,
                row.publicId,
                row.title,
                row.art,
                row.colorMode,
                row.isMultilevel,
                row.isLabeled,
                row.isOfficial,
                row.isSpoiler,
                row.hasScale,
                row.widthPx,
                row.heightPx,
                row.format,
                row.validFromBf,
                row.validToBf,
                row.author,
                row.publisher,
                row.note,
            ] as Cell[],
        ]),
    );
    const mapOffenders = compareRows(
        mapWanted,
        mapActual,
        MAP_COLUMNS.map((column) => column.name),
    );
    const blank = await blankTextCount(database, "citymap", [
        "format",
        "author",
        "publisher",
        "note",
        "legacy_wiki_key",
    ]);
    // Ein unbekannter Wert wird nie auf einen Wert gezwungen: NULL der Antwort bleibt NULL, nie false oder ein Schlüssel.
    checks.push(
        check(
            "map_parity",
            mapOffenders.length === 0 && blank === 0,
            mapOffenders.length === 0 && blank === 0
                ? `${String(mapActual.size)} Karten: Titel, Art, Farbmodus, Dreiwert-Merkmale (NULL bleibt NULL), Maße, Format, Gültigkeit, Urheber, Verlag und Notiz wie geliefert; ${String(blank)} leere Zeichenketten; public_id eindeutig`
                : `${String(mapOffenders.length)} Abweichungen, ${String(blank)} leere Zeichenketten`,
            mapOffenders,
        ),
    );

    // ---- Übergeordnete Karte: gleich der Antwort, ohne Zyklus --------------------------------------------------------------------------
    const parentRows = await database<{ id: string; public_id: string; parent_id: string | null }[]>`
        SELECT id::text, public_id::text, parent_id::text FROM citymap WHERE state = 'active'
    `;
    const parentOffenders: string[] = [];
    const parentOf = new Map(parentRows.map((row) => [row.id, row.parent_id]));
    for (const row of maps) {
        const id = idOf.get(row.publicId);
        const want = row.parentPublicId === null ? null : (idOf.get(row.parentPublicId) ?? null);
        if (id !== undefined && mapActual.has(row.publicId) && (parentOf.get(id) ?? null) !== want) {
            parentOffenders.push(`${row.title}: übergeordnete Karte weicht ab`);
        }
    }
    for (const row of parentRows) {
        const seen = new Set<string>([row.id]);
        let current = row.parent_id;
        while (current !== null) {
            if (seen.has(current)) {
                parentOffenders.push(`${row.public_id}: Übergeordnet-Kette ist ein Zyklus`);
                break;
            }
            seen.add(current);
            current = parentOf.get(current) ?? null;
        }
    }
    checks.push(
        check(
            "parents",
            parentOffenders.length === 0,
            parentOffenders.length === 0
                ? `${String(parentRows.filter((row) => row.parent_id !== null).length)} Karten mit übergeordneter Karte: gleich der Antwort, nur Karten des Katalogs, kein Selbstverweis, kein Zyklus`
                : `${String(parentOffenders.length)} Abweichungen`,
            parentOffenders,
        ),
    );

    // ---- Typen und Paare ----------------------------------------------------------------------------------------------------------------
    const typeActual = new Set(
        (await readTableCells(database, "citymap_type", TYPE_COLUMNS, "t.state = 'active'")).map(
            (cells) => `${String(cells[0])}|${String(cells[1])}`,
        ),
    );
    const typeWanted = new Set(types.map((row) => `${idOf.get(row.mapPublicId) ?? "?"}|${row.typeKey}`));
    const typeOffenders = [
        ...[...typeWanted].filter((key) => !typeActual.has(key)).map((key) => `${key} fehlt`),
        ...[...typeActual].filter((key) => !typeWanted.has(key)).map((key) => `${key} ist zu viel`),
    ];
    const pairWanted = new Set(
        related.map((row) => {
            const [low, high] = orderedPair(idOf.get(row.a) ?? "0", idOf.get(row.b) ?? "0");
            return `${low}|${high}`;
        }),
    );
    const pairRows = await readTableCells(
        database,
        "citymap_related",
        [
            { name: "citymap_id", type: "bigint" },
            { name: "related_citymap_id", type: "bigint" },
        ],
        "t.state = 'active'",
    );
    const pairActual = new Set(pairRows.map((cells) => `${String(cells[0])}|${String(cells[1])}`));
    const pairOffenders = [
        ...[...pairWanted].filter((key) => !pairActual.has(key)).map((key) => `Paar ${key} fehlt`),
        ...[...pairActual].filter((key) => !pairWanted.has(key)).map((key) => `Paar ${key} ist zu viel`),
        ...pairRows
            .filter((cells) => BigInt(String(cells[0])) >= BigInt(String(cells[1])))
            .map((cells) => `Paar ${String(cells[0])}|${String(cells[1])} ist nicht geordnet`),
    ];
    checks.push(
        check(
            "types_and_pairs",
            typeOffenders.length === 0 && pairOffenders.length === 0,
            typeOffenders.length === 0 && pairOffenders.length === 0
                ? `${String(typeActual.size)} Typen (Menge der bekannten Schlüssel) und ${String(pairActual.size)} Paare verwandter Karten (kleinere Kennung zuerst, kein Selbstverweis) gleich der Antwort`
                : `${String(typeOffenders.length)} Typen und ${String(pairOffenders.length)} Paare weichen ab`,
            [...typeOffenders, ...pairOffenders],
        ),
    );

    // ---- Orte -----------------------------------------------------------------------------------------------------------------------------
    const placeActual = new Map(
        (await readTableCells(database, "citymap_place", PLACE_COLUMNS, "t.state = 'active'")).map((cells) => [
            `${String(cells[0])}|${String(cells[1])}|${String(cells[3])}|${String(cells[4])}`,
            cells,
        ]),
    );
    const placeWanted = new Map<string, Cell[]>();
    const missingMap: string[] = [];
    for (const place of places) {
        const id = idOf.get(place.mapPublicId);
        if (id === undefined) {
            missingMap.push(`${place.mapTitle} / ${place.rawName}: die Karte fehlt`);
            continue;
        }
        placeWanted.set(
            `${id}|${String(place.sortOrder)}|${place.nameKey}|${String(place.dupOrdinal)}`,
            placeCells(id, place),
        );
    }
    const placeOffenders = [
        ...missingMap,
        ...compareRows(
            placeWanted,
            placeActual,
            PLACE_COLUMNS.map((column) => column.name),
            (key) => {
                const [mapId, sortOrder, nameKey] = key.split("|");
                return `${titleOfId.get(mapId ?? "") ?? `Karte ${mapId ?? "?"}`} / ${nameKey ?? "?"} (${sortOrder ?? "?"})`;
            },
        ),
    ];
    checks.push(
        check(
            "place_parity",
            placeOffenders.length === 0,
            placeOffenders.length === 0
                ? `${String(placeActual.size)} Orte: Position, Rohname, Auflösung und Legacy-Angaben gleich der Antwort (neu gerechnet gegen die Trägertabellen)`
                : `${String(placeOffenders.length)} Orte weichen ab`,
            placeOffenders,
        ),
    );
    checks.push(
        ...(await verifyPlaceTable(database, {
            table: "citymap_place",
            ownerTable: "citymap",
            ownerColumn: "citymap_id",
            ownerName: "title",
        })),
    );

    // ---- Fundstellen ----------------------------------------------------------------------------------------------------------------------
    const linkActual = new Map(
        (await readTableCells(database, "citymap_link", LINK_COLUMNS, "t.state = 'active'")).map((cells) => [
            `${String(cells[0])}|${String(cells[2])}`,
            cells,
        ]),
    );
    const linkWanted = new Map<string, Cell[]>();
    for (const link of links) {
        const id = idOf.get(link.mapPublicId);
        if (id !== undefined)
            linkWanted.set(`${id}|${link.url}`, [id, link.role, link.url, link.label, link.isPaid, link.position]);
    }
    const linkOffenders = compareRows(
        linkWanted,
        linkActual,
        LINK_COLUMNS.map((column) => column.name),
        (key) =>
            `${titleOfId.get(key.split("|")[0] ?? "") ?? key.split("|")[0] ?? "?"} / ${key.slice(key.indexOf("|") + 1)}`,
    );
    const twoPrimaries = await count(
        database,
        `SELECT count(*) FROM (SELECT citymap_id FROM citymap_link WHERE state = 'active' AND link_role = 'primary' GROUP BY citymap_id HAVING count(*) > 1) d`,
    );
    const nonHttp = await count(database, `SELECT count(*) FROM citymap_link WHERE url !~* '^https?://'`);
    const primaryCount = await count(
        database,
        `SELECT count(*) FROM citymap_link WHERE state = 'active' AND link_role = 'primary'`,
    );
    checks.push(
        check(
            "link_parity",
            linkOffenders.length === 0 && twoPrimaries === 0 && nonHttp === 0,
            linkOffenders.length === 0 && twoPrimaries === 0 && nonHttp === 0
                ? `${String(linkActual.size)} Fundstellen (davon ${String(primaryCount)} Karten-Links): Rolle, Titel, Adresse, is_paid (dreiwertig, nur am Link) und Reihenfolge wie geliefert; höchstens ein Karten-Link je Karte (der erste Link der Antwort, key map), (Karte, Adresse) eindeutig, nur http und https`
                : `${String(linkOffenders.length)} Fundstellen weichen ab, ${String(twoPrimaries)} Karten mit mehreren Karten-Links, ${String(nonHttp)} Adressen ohne http oder https`,
            linkOffenders,
        ),
    );

    // ---- Quellenverknüpfung (nur mit dem Satz und importiertem D1) -------------------------------------------------------------------------
    if (expected.sourcesPart === "applied" && expected.sourceTotals !== null) {
        const keys = await database<
            { source_key: string; id: string }[]
        >`SELECT source_key, id::text FROM feature_source WHERE is_active`;
        const sourceId = new Map(keys.map((row) => [row.source_key, row.id]));
        const missingKeys = expected.sources.filter((row) => !sourceId.has(row.sourceKey));
        const sources = expected.sources.filter((row) => !heldOut.has(row.mapPublicId));
        const actual = new Map(
            (await readTableCells(database, "citymap_source", SOURCE_LINK_COLUMNS, "t.state = 'active'")).map(
                (cells) => [`${String(cells[0])}|${String(cells[1])}`, cells],
            ),
        );
        const wanted = new Map<string, Cell[]>();
        for (const row of sources) {
            const id = idOf.get(row.mapPublicId);
            const source = sourceId.get(row.sourceKey);
            if (id !== undefined && source !== undefined) {
                wanted.set(`${id}|${source}`, [
                    id,
                    source,
                    row.referenceKind,
                    row.pages,
                    row.note,
                    row.legacyOrigin,
                    row.position,
                ]);
            }
        }
        const sourceOffenders =
            missingKeys.length > 0
                ? [`${String(missingKeys.length)} Quellen fehlen im Katalog (D1, Schritt I18 noch nicht gelaufen)`]
                : compareRows(
                      wanted,
                      actual,
                      SOURCE_LINK_COLUMNS.map((column) => column.name),
                  );
        const totals = expected.sourceTotals;
        const accounted = sources.length + totals.withoutMapLinks + totals.withoutCatalog + totals.duplicates;
        checks.push(
            check(
                "source_parity",
                sourceOffenders.length === 0,
                sourceOffenders.length === 0
                    ? `${String(actual.size)} Verknüpfungen Karte - Quelle (Art, Seiten, Notiz, Herkunft, Reihenfolge) gleich dem Satz; je Karte genau die Quellen, die Legacy ihr zuordnet (nicht vererbt)`
                    : `${String(sourceOffenders.length)} Abweichungen`,
                sourceOffenders,
            ),
        );
        checks.push(
            check(
                "source_accounting",
                accounted === totals.total,
                `${String(totals.total)} Verweise von ${String(totals.carriers)} Trägern im Satz = ${String(sources.length)} angelegt + ${String(totals.withoutMapLinks)} Waisen (Karte nicht im Katalog) + ${String(totals.withoutCatalog)} ohne Katalogzeile + ${String(totals.duplicates)} doppelt; ${String(totals.distinctSources)} verschiedene Quellen, ${String(totals.urlLessSources)} URL-lose; Art leer ${String(totals.emptyKind)}, mit Seiten ${String(totals.withPages)}, mit Notiz ${String(totals.withNote)}`,
            ),
        );
        const revision = Number((options.features as { revision?: unknown } | null | undefined)?.revision);
        if (revision === CONTRACT_SET_REVISION) {
            const measured: Record<keyof typeof CONTRACT_NUMBERS, number> = {
                source_carriers: totals.carriers,
                source_links: totals.total,
                source_distinct: totals.distinctSources,
                source_urlless: totals.urlLessSources,
                reference_kind_empty: totals.emptyKind,
                pages: totals.withPages,
                notes: totals.withNote,
            };
            const keysOfNumbers = Object.keys(CONTRACT_NUMBERS) as (keyof typeof CONTRACT_NUMBERS)[];
            const deviating = keysOfNumbers
                .filter((key) => measured[key] !== CONTRACT_NUMBERS[key])
                .map((key) => `${key}: Vertrag ${String(CONTRACT_NUMBERS[key])}, gemessen ${String(measured[key])}`);
            checks.push(
                check(
                    "contract_numbers",
                    deviating.length === 0,
                    deviating.length === 0
                        ? `alle ${String(keysOfNumbers.length)} Sollzahlen der Quellenverknüpfung des Satzes ${String(CONTRACT_SET_REVISION)} stimmen`
                        : `${String(deviating.length)} von ${String(keysOfNumbers.length)} Sollzahlen weichen ab (Satz ${String(CONTRACT_SET_REVISION)})`,
                    deviating,
                ),
            );
        } else {
            checks.push(
                check(
                    "contract_numbers",
                    true,
                    `Satz ${Number.isFinite(revision) ? String(revision) : "unbekannt"}: der Vertrag nennt Sollzahlen der Quellenverknüpfung nur für den Satz ${String(CONTRACT_SET_REVISION)}, für den Katalog keine (nicht abgerufen, UNKNOWN); gemessen ${String(maps.length)} Karten, ${String(places.length)} Orte (aufgelöst ${String(expected.totals.resolved)}, ohne Ziel ${String(expected.totals.unresolved)}, nicht gefunden ${String(expected.totals.unmatched)}), ${String(links.length)} Fundstellen`,
                ),
            );
        }
    } else {
        checks.push(
            check(
                "contract_numbers",
                true,
                `der Vertrag nennt keine Sollzahlen für den Katalog (nicht abgerufen, UNKNOWN); gemessen ${String(maps.length)} Karten, ${String(places.length)} Orte (aufgelöst ${String(expected.totals.resolved)}, ohne Ziel ${String(expected.totals.unresolved)}, nicht gefunden ${String(expected.totals.unmatched)}), ${String(links.length)} Fundstellen; die Quellenverknüpfung wurde ohne den Satz nicht geprüft`,
            ),
        );
    }

    // ---- Zuordnung des eigenen Wiki-Artikels (nur mit der Datei) ------------------------------------------------------------------------
    if (overlay !== null) {
        const actual = new Map(
            (await readTableCells(database, "citymap_wiki_assignment", ASSIGNMENT_COLUMNS, "t.is_active")).map(
                (cells) => [String(cells[0]), cells],
            ),
        );
        const wanted = new Map<string, Cell[]>();
        for (const row of expected.assignments.filter((entry) => !heldOut.has(entry.mapPublicId))) {
            const id = idOf.get(row.mapPublicId);
            if (id !== undefined) {
                wanted.set(id, [
                    id,
                    row.assignment.wikiUrl,
                    row.assignment.articleKey,
                    row.assignment.articleTitle,
                    row.assignment.state,
                    row.assignment.origin,
                ]);
            }
        }
        const offenders = compareRows(
            wanted,
            actual,
            ASSIGNMENT_COLUMNS.map((column) => column.name),
            (key) => titleOfId.get(key) ?? key,
        );
        checks.push(
            check(
                "wiki_assignment",
                offenders.length === 0,
                offenders.length === 0
                    ? `${String(actual.size)} Zuordnungen des eigenen Wiki-Artikels (assigned oder separated) gleich der Datei; keine Zeile heißt kein Entscheid, nie dasselbe wie separated`
                    : `${String(offenders.length)} Zuordnungen weichen ab`,
                offenders,
            ),
        );
    }

    // ---- Struktur und Waisen ----------------------------------------------------------------------------------------------------------------
    const structure = await forbiddenColumns(
        database,
        [...CITYMAP_TABLES, "citymap_media"],
        ["territory_path", "is_color"],
    );
    const mapPaid = await database<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'citymap' AND column_name IN ('is_paid', 'role')
    `;
    const placeRole = await database<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'citymap_place' AND column_name IN ('role', 'rolle')
    `;
    const structureOffenders = [
        ...structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ...mapPaid.map((row) => `citymap.${row.column_name}`),
        ...placeRole.map((row) => `citymap_place.${row.column_name}`),
    ];
    checks.push(
        check(
            "structure",
            structureOffenders.length === 0,
            structureOffenders.length === 0
                ? "keine entity_type-Spalte, kein JSON-Typ, kein is_color und kein is_paid an der Karte, keine Rolle am Ort, kein gespeicherter Gebietspfad in den Tabellen von D2"
                : `${String(structureOffenders.length)} verbotene Spalten`,
            structureOffenders,
        ),
    );
    // Ein im Editor entfernter Eintrag (WI-0287) behält seine Kinder aktiv, damit das Zurückholen ihn unverändert zurückgibt; sie zählen hier nicht.
    const orphans = await count(
        database,
        `SELECT (SELECT count(*) FROM citymap_place p JOIN citymap c ON c.id = p.citymap_id WHERE p.state = 'active' AND NOT c.is_active AND c.retired_origin IS DISTINCT FROM 'editor')
              + (SELECT count(*) FROM citymap_link l JOIN citymap c ON c.id = l.citymap_id WHERE l.state = 'active' AND NOT c.is_active AND c.retired_origin IS DISTINCT FROM 'editor')
              + (SELECT count(*) FROM citymap_type t JOIN citymap c ON c.id = t.citymap_id WHERE t.state = 'active' AND NOT c.is_active AND c.retired_origin IS DISTINCT FROM 'editor')
              + (SELECT count(*) FROM citymap_source s JOIN citymap c ON c.id = s.citymap_id WHERE s.state = 'active' AND NOT c.is_active AND c.retired_origin IS DISTINCT FROM 'editor')
              + (SELECT count(*) FROM citymap_source s JOIN feature_source f ON f.id = s.source_id WHERE s.state = 'active' AND NOT f.is_active)
              + (SELECT count(*) FROM citymap_related r JOIN citymap a ON a.id = r.citymap_id JOIN citymap b ON b.id = r.related_citymap_id
                  WHERE r.state = 'active' AND ((NOT a.is_active AND a.retired_origin IS DISTINCT FROM 'editor') OR (NOT b.is_active AND b.retired_origin IS DISTINCT FROM 'editor')))
              + (SELECT count(*) FROM citymap_media m JOIN citymap c ON c.id = m.citymap_id WHERE m.retired_at IS NULL AND NOT c.is_active AND c.retired_origin IS DISTINCT FROM 'editor')`,
    );
    // Höchstens EINE aktive Vorschau je Karte; Vollbilder (`map_full`) darf eine Karte seit WI-0287 Stufe 2 mehrere haben (Versionen, Migration 0321).
    const doubleBinding = await count(
        database,
        `SELECT count(*) FROM (SELECT citymap_id FROM citymap_media WHERE retired_at IS NULL AND role = 'map_preview' GROUP BY citymap_id HAVING count(*) > 1) d`,
    );
    checks.push(
        check(
            "no_orphans",
            orphans === 0 && doubleBinding === 0,
            orphans === 0 && doubleBinding === 0
                ? "jeder Fremdschlüssel löst auf; keine aktive Zeile hängt an einer stillgelegten Karte, einem stillgelegten Paarpartner oder einer stillgelegten Quelle; höchstens eine aktive Vorschau je Karte"
                : `${String(orphans)} aktive Zeilen an stillgelegten Eltern, ${String(doubleBinding)} Karten mit mehreren aktiven Vorschauen`,
        ),
    );

    // ---- Befund: Legacys Gebietspfad gegen die Kette im Baum von Avesmaps3D (Information) ----------------------------------------------------
    const chainOf = await territoryChains(database);
    const divergent: FindingObject[] = [];
    let comparable = 0;
    for (const place of places) {
        if (place.resolution.target?.column !== "territory_id") continue;
        const legacyPath = place.territoryPath.filter((key) => key.startsWith("wiki:"));
        if (legacyPath.length === 0) continue;
        comparable += 1;
        if (JSON.stringify(chainOf(place.resolution.target.id)) !== JSON.stringify(legacyPath)) {
            divergent.push({
                table: "citymap_place",
                publicId: place.mapPublicId,
                name: `${place.mapTitle} / ${place.rawName}`,
            });
        }
    }
    if (divergent.length > 0) {
        findings.push(
            createFinding(
                "territory_path_divergent",
                `${String(divergent.length)} von ${String(comparable)} vergleichbaren Gebietspfaden (Ziel Gebiet) weichen von der Kette im Baum von Avesmaps3D ab; wegen anderer Baumstände erwartbar (Information, der Pfad wird nicht gespeichert)`,
                { abweichend: divergent.length, verglichen: comparable },
                divergent,
            ),
        );
    }

    const settled = settleChecks("verify:citymaps", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings };
}
