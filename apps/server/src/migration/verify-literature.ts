import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { readTargetIndex } from "./catalog-places.ts";
import {
    FIELD_ORIGIN_COLUMNS,
    LINK_COLUMNS,
    LITERATURE_TABLES,
    PLACE_COLUMNS,
    WORK_COLUMNS,
    placeCells,
} from "./literature-import.ts";
import { transformLiterature, type LiteratureOverlay } from "./literature.ts";
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
import { readTableCells, type Cell } from "./sync-table.ts";

/**
 * Parität der Spielliteratur gegen dieselbe Antwortdatei, aus der importiert wurde (WI-0063 P3, Vertrag `literature.yaml`, `verifier`).
 *
 * Geprüft wird das AGGREGAT: Anzahl je Tabelle, jedes Werk Spalte für Spalte, jede Ortszeile (Position, Rohname, Rolle, Auflösung), die
 * Reihenfolge der Ortsliste, der Zielzustand, die Auflösung UNABHÄNGIG mit SQL nachgerechnet, die Rollen (play ist die einzige
 * verschleierte), die kuratierten Links, die Herkunftsvermerke (mit der Datei), die Struktur (kein `entity_type`, kein JSON, kein
 * gespeicherter Gebietspfad) und die Waisen. Dazu die Befunde der Umwandlung und `territory_path_divergent` (Information).
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03). Sollzahlen nennt der Vertrag nicht (kein Abruf bisher, UNKNOWN); sie
 * kommen mit dem ersten Zug und werden bei einem neuen Satz nachgemessen. Nur lesend.
 */

export interface LiteratureParityReport {
    passed: boolean;
    /** Die Antwort war unbrauchbar, leer oder abgeschaltet: der Schritt hat nichts geschrieben, also gibt es nichts zu prüfen. */
    skipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
}

export async function verifyLiterature(
    database: Database,
    payload: unknown,
    overlay: LiteratureOverlay | null = null,
): Promise<LiteratureParityReport> {
    const index = await readTargetIndex(database);
    const expected = transformLiterature(payload, index, overlay);
    if (expected.skipped) return { passed: true, skipped: true, checks: [], findings: expected.findings };
    const checks: ParityCheck[] = [];
    const findings: Finding[] = [...expected.findings];

    // Werke, die ein Tombstone oder ein Editor-Entscheid hält, nimmt die Prüfung aus (der Import fasst sie nie an).
    const workRows = await database<{ id: string; public_id: string; state: string; retired_origin: string | null }[]>`
        SELECT id::text, public_id::text, state, retired_origin FROM adventure
    `;
    const idOf = new Map(workRows.map((row) => [row.public_id, row.id]));
    const heldOut = new Set(
        workRows
            .filter((row) => row.state === "suppressed" || (row.state === "retired" && row.retired_origin === "editor"))
            .map((row) => row.public_id),
    );
    const titleOfId = new Map(expected.works.map((work) => [idOf.get(work.publicId) ?? "", work.title]));
    const works = expected.works.filter((work) => !heldOut.has(work.publicId));
    const places = expected.places.filter((place) => !heldOut.has(place.workPublicId));
    const links = expected.links.filter((link) => !heldOut.has(link.workPublicId));

    // ---- Anzahl --------------------------------------------------------------------------------------------------------------------
    const have = {
        adventure: await count(database, "SELECT count(*) FROM adventure WHERE state = 'active'"),
        adventure_place: await count(database, "SELECT count(*) FROM adventure_place WHERE state = 'active'"),
        adventure_link: await count(database, "SELECT count(*) FROM adventure_link WHERE state = 'active'"),
    };
    // Aktive Zeilen können nur aus dieser Antwort stammen: Fremde Werke (andere Läufe) würden hier mitzählen.
    const want = { adventure: works.length, adventure_place: places.length, adventure_link: links.length };
    checks.push(
        check(
            "counts",
            have.adventure === want.adventure &&
                have.adventure_place === want.adventure_place &&
                have.adventure_link === want.adventure_link,
            `adventure ${String(have.adventure)} von ${String(want.adventure)} Werken der Antwort, adventure_place ${String(have.adventure_place)} von ${String(want.adventure_place)} Orten, adventure_link ${String(have.adventure_link)} von ${String(want.adventure_link)} kuratierten Links (nach Abzug der als nicht speicherbar gemeldeten)`,
        ),
    );

    // ---- Werk Spalte für Spalte ---------------------------------------------------------------------------------------------------
    const workActual = new Map(
        (await readTableCells(database, "adventure", WORK_COLUMNS, "t.state = 'active'")).map((cells) => [
            String(cells[0]),
            cells,
        ]),
    );
    const workWanted = new Map(
        works.map((work) => [
            work.publicId,
            [
                work.publicId,
                work.publicId,
                work.wikiUrl,
                work.title,
                work.productType,
                work.edition,
                work.bfYear,
                work.bfLabel,
                work.genre,
                work.complexityGm,
                work.complexityPl,
                work.isOfficial,
                work.series,
                work.fshopCode,
                work.linkUlisses,
                work.linkFshop,
                work.isbn,
                work.containedIn,
            ] as Cell[],
        ]),
    );
    const workOffenders = compareRows(
        workWanted,
        workActual,
        WORK_COLUMNS.map((column) => column.name),
    );
    const blank =
        (await blankTextCount(database, "adventure", [
            "wiki_url",
            "edition",
            "bf_label",
            "genre",
            "complexity_gm",
            "complexity_pl",
            "series",
            "fshop_code",
            "link_ulisses",
            "link_fshop",
            "isbn",
            "contained_in",
            "authors",
        ])) + (await blankTextCount(database, "adventure_link", ["url", "label"]));
    checks.push(
        check(
            "work_parity",
            workOffenders.length === 0 && blank === 0,
            workOffenders.length === 0 && blank === 0
                ? `${String(workActual.size)} Werke: Titel, Werkart, Edition, BF-Angaben, Genre, Komplexität, offiziell, Serie, Shop- und Linkfelder, ISBN und enthalten-in wie geliefert; ${String(blank)} leere Zeichenketten (ein leerer Wert ist NULL); public_id eindeutig`
                : `${String(workOffenders.length)} Abweichungen, ${String(blank)} leere Zeichenketten`,
            workOffenders,
        ),
    );

    // ---- Orte Spalte für Spalte ---------------------------------------------------------------------------------------------------
    const placeActual = new Map(
        (await readTableCells(database, "adventure_place", PLACE_COLUMNS, "t.state = 'active'")).map((cells) => [
            `${String(cells[0])}|${String(cells[1])}|${String(cells[3])}|${String(cells[4])}`,
            cells,
        ]),
    );
    const placeWanted = new Map<string, Cell[]>();
    const missingWork: string[] = [];
    for (const place of places) {
        const id = idOf.get(place.workPublicId);
        if (id === undefined) {
            missingWork.push(`${place.workTitle} / ${place.rawName}: das Werk fehlt`);
            continue;
        }
        const cells = placeCells(id, place);
        placeWanted.set(`${id}|${String(place.sortOrder)}|${place.nameKey}|${String(place.dupOrdinal)}`, cells);
    }
    const placeOffenders = [
        ...missingWork,
        ...compareRows(
            placeWanted,
            placeActual,
            PLACE_COLUMNS.map((column) => column.name),
            (key) => {
                const [adventureId, sortOrder, nameKey] = key.split("|");
                return `${titleOfId.get(adventureId ?? "") ?? `Werk ${adventureId ?? "?"}`} / ${nameKey ?? "?"} (${sortOrder ?? "?"})`;
            },
        ),
    ];
    checks.push(
        check(
            "place_parity",
            placeOffenders.length === 0,
            placeOffenders.length === 0
                ? `${String(placeActual.size)} Orte: Position, Rohname, Rolle, Auflösung und Legacy-Angaben gleich der Antwort (neu gerechnet gegen die Trägertabellen)`
                : `${String(placeOffenders.length)} Orte weichen ab`,
            placeOffenders,
        ),
    );
    checks.push(
        ...(await verifyPlaceTable(database, {
            table: "adventure_place",
            ownerTable: "adventure",
            ownerColumn: "adventure_id",
            ownerName: "title",
        })),
    );

    // ---- Spoiler-Regel: genau die drei Rollen, play ist die einzige verschleierte -------------------------------------------------
    const roles = await database<
        { role: string }[]
    >`SELECT DISTINCT role FROM adventure_place WHERE state = 'active' ORDER BY role`;
    const unknownRoles = roles.map((row) => row.role).filter((role) => !["start", "play", "covers"].includes(role));
    checks.push(
        check(
            "roles",
            unknownRoles.length === 0,
            `Rollen im Bestand: ${roles.map((row) => row.role).join(", ") || "keine"}; nur start, play, covers kommen vor (play ist die einzige verschleierte, die Regel hängt an der Rolle des Ortes, nie am Werk)`,
            unknownRoles,
        ),
    );

    // ---- Links ----------------------------------------------------------------------------------------------------------------------
    const linkActual = new Map(
        (await readTableCells(database, "adventure_link", LINK_COLUMNS, "t.state = 'active'")).map((cells) => [
            `${String(cells[0])}|${String(cells[1])}`,
            cells,
        ]),
    );
    const linkWanted = new Map<string, Cell[]>();
    for (const link of links) {
        const id = idOf.get(link.workPublicId);
        if (id !== undefined) linkWanted.set(`${id}|${link.url}`, [id, link.url, link.label, link.position]);
    }
    const linkOffenders = compareRows(
        linkWanted,
        linkActual,
        LINK_COLUMNS.map((column) => column.name),
        (key) =>
            `${titleOfId.get(key.split("|")[0] ?? "") ?? key.split("|")[0] ?? "?"} / ${key.slice(key.indexOf("|") + 1)}`,
    );
    const nonHttp = await count(
        database,
        `SELECT (SELECT count(*) FROM adventure_link WHERE url !~* '^https?://')
              + (SELECT count(*) FROM adventure WHERE (wiki_url IS NOT NULL AND wiki_url !~* '^https?://') OR (link_ulisses IS NOT NULL AND link_ulisses !~* '^https?://') OR (link_fshop IS NOT NULL AND link_fshop !~* '^https?://'))`,
    );
    checks.push(
        check(
            "link_parity",
            linkOffenders.length === 0 && nonHttp === 0,
            linkOffenders.length === 0 && nonHttp === 0
                ? `${String(linkActual.size)} kuratierte Links: Titel, Adresse und Reihenfolge wie geliefert, (Werk, Adresse) eindeutig, nur http und https; die berechneten Links (Ulisses, F-Shop, Wiki, DNB) sind keine Zeilen`
                : `${String(linkOffenders.length)} Links weichen ab, ${String(nonHttp)} Adressen ohne http oder https`,
            linkOffenders,
        ),
    );

    // ---- Herkunftsvermerke (nur mit der Datei) --------------------------------------------------------------------------------------
    const originOffenders: string[] = [];
    let originRows = 0;
    for (const entry of expected.privateWorks) {
        if (entry.fieldOrigins === null) continue;
        const id = idOf.get(entry.publicId);
        const rows =
            id === undefined
                ? []
                : await readTableCells(
                      database,
                      "adventure_field_origin",
                      [{ name: "adventure_id", type: "bigint" }, ...FIELD_ORIGIN_COLUMNS],
                      `t.adventure_id = ${id}`,
                  );
        originRows += rows.length;
        const got = new Set(rows.map((cells) => `${String(cells[1])}=${String(cells[2])}`));
        const want = new Set(entry.fieldOrigins.map((origin) => `${origin.field}=${origin.origin}`));
        if (got.size !== want.size || [...want].some((item) => !got.has(item))) {
            originOffenders.push(`${titleOfId.get(id ?? "") ?? entry.publicId}: Herkunftsvermerke weichen ab`);
        }
    }
    checks.push(
        check(
            "field_origins",
            originOffenders.length === 0,
            overlay === null
                ? "keine Datei mit den privaten Feldern: keine Herkunftsvermerke (ein fehlender Eintrag heißt nicht bekannt, nie wiki)"
                : `${String(originRows)} Herkunftsvermerke je Feld gleich der Datei`,
            originOffenders,
        ),
    );

    // ---- Struktur und Waisen ---------------------------------------------------------------------------------------------------------
    const structure = await forbiddenColumns(database, [...LITERATURE_TABLES, "adventure_media"], ["territory_path"]);
    checks.push(
        check(
            "structure",
            structure.length === 0,
            structure.length === 0
                ? "keine entity_type-Spalte, kein JSON-Typ und kein gespeicherter Gebietspfad in den Tabellen von D3"
                : `${String(structure.length)} verbotene Spalten`,
            structure.map((row) => `${row.table_name}.${row.column_name} (${row.data_type})`),
        ),
    );
    const orphans = await count(
        database,
        `SELECT (SELECT count(*) FROM adventure_place p JOIN adventure a ON a.id = p.adventure_id WHERE p.state = 'active' AND NOT a.is_active)
              + (SELECT count(*) FROM adventure_link l JOIN adventure a ON a.id = l.adventure_id WHERE l.state = 'active' AND NOT a.is_active)
              + (SELECT count(*) FROM adventure_media m JOIN adventure a ON a.id = m.adventure_id WHERE m.retired_at IS NULL AND NOT a.is_active)`,
    );
    const doubleCover = await count(
        database,
        `SELECT count(*) FROM (SELECT adventure_id, role FROM adventure_media WHERE retired_at IS NULL GROUP BY adventure_id, role HAVING count(*) > 1) d`,
    );
    checks.push(
        check(
            "no_orphans",
            orphans === 0 && doubleCover === 0,
            orphans === 0 && doubleCover === 0
                ? "jeder Fremdschlüssel löst auf; kein aktiver Ort, Link oder keine aktive Cover-Bindung hängt an einem stillgelegten Werk; höchstens eine aktive Cover-Bindung je Werk"
                : `${String(orphans)} aktive Zeilen an stillgelegten Werken, ${String(doubleCover)} Werke mit mehreren aktiven Bindungen`,
        ),
    );

    // ---- Sollzahlen: der Vertrag nennt keine (kein Abruf bisher) -----------------------------------------------------------------------
    checks.push(
        check(
            "contract_numbers",
            true,
            `der Vertrag nennt keine Sollzahlen (Katalog bisher nicht abgerufen, UNKNOWN); gemessen: ${String(works.length)} Werke, ${String(places.length)} Orte (aufgelöst ${String(expected.totals.resolved)}, ohne Ziel ${String(expected.totals.unresolved)}, nicht gefunden ${String(expected.totals.unmatched)}), ${String(links.length)} kuratierte Links; mit dem ersten Zug im Vertrag eintragen`,
        ),
    );

    // ---- Befund: Legacys Gebietspfad gegen die Kette im Baum von Avesmaps3D (Information) ---------------------------------------------
    const chainOf = await territoryChains(database);
    const divergent: FindingObject[] = [];
    let comparable = 0;
    for (const place of places) {
        if (place.resolution.target?.column !== "territory_id") continue;
        const legacyPath = place.territoryPath.filter((key) => key.startsWith("wiki:"));
        if (legacyPath.length === 0) continue;
        comparable += 1;
        const ours = chainOf(place.resolution.target.id);
        if (JSON.stringify(ours) !== JSON.stringify(legacyPath)) {
            divergent.push({
                table: "adventure_place",
                publicId: place.workPublicId,
                name: `${place.workTitle} / ${place.rawName}`,
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

    const settled = settleChecks("verify:literature", checks);
    return { passed: settled.passed, skipped: false, checks: settled.checks, findings };
}
