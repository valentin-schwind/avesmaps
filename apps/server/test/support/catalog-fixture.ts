import type { Queryable } from "../../src/database.ts";
import type { TargetIndex } from "../../src/migration/catalog-places.ts";

/**
 * Fixtures für die Tests von D3 (Spielliteratur, Migration 0068) und D2 (Kartensammlung, Migration 0069), WI-0063 P3.
 *
 * Alle öffentlichen IDs der Träger tragen die Vorsilbe `68000000-`, die der Werke `68100000-` und die der Karten `69100000-`;
 * Wiki-Schlüssel der Schnappschüsse beginnen mit `p68t-`, Quellen tragen den Titel `P69T …` und Adressen auf `p69test.example`.
 * Damit räumt `cleanCatalogFixtures` genau das weg, was diese Tests angelegt haben, und fasst keinen fremden Bestand an.
 *
 * Die Träger decken jeden Fall der Auflösung ab: ein Ort mit Zuordnung (Schlüssel eindeutig), zwei Orte mit demselben Schlüssel
 * (mehrdeutig), ein stillgelegter Ort, ein Gebiet mit Elter, zwei Gebiete mit demselben Schlüssel, eine Landschaft mit gebundener
 * Beschriftung, ein Gipfel mit Zuordnung und eine Wegegruppe aus zwei Segmenten (der Anker ist das mit der kleineren public_id).
 */

export const MAP_DOMAIN = "aventuria";

export const idFor =
    (prefix: string) =>
    (n: number): string =>
        `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Träger. */
export const carrierId = idFor("68000000");
/** Werke der Literatur. */
export const workId = idFor("68100000");
/** Karten der Kartensammlung. */
export const mapId = idFor("69100000");

export const C = {
    ortA: carrierId(1),
    ortB: carrierId(2),
    ortC: carrierId(3),
    ortInaktiv: carrierId(4),
    ortOhneZuordnung: carrierId(5),
    gebietA: carrierId(10),
    gebietB: carrierId(11),
    gebietDoppelt1: carrierId(12),
    gebietDoppelt2: carrierId(13),
    gebietInaktiv: carrierId(14),
    regionA: carrierId(20),
    regionInaktiv: carrierId(21),
    beschriftungA: carrierId(22),
    beschriftungInaktiv: carrierId(23),
    gipfelA: carrierId(30),
    gipfelB: carrierId(31),
    wegA1: carrierId(40),
    wegA2: carrierId(41),
    wegOhneZuordnung: carrierId(42),
} as const;

export interface CatalogIds {
    [publicId: string]: string;
}

/** Legt Träger und ihre Wiki-Zuordnung (D6) an und gibt die Datenbank-Ids zurück (öffentliche ID zu Id). */
export async function insertCatalogCarriers(database: Queryable): Promise<CatalogIds> {
    const ids: CatalogIds = {};
    const remember = (publicId: string, rows: { id: string }[]): string => {
        const row = rows[0];
        if (!row) throw new Error(`Fixture ${publicId} nicht angelegt`);
        ids[publicId] = row.id;
        return row.id;
    };
    const place = async (publicId: string, name: string, x: number, active = true): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, 400), 0), 'test', ${active})
                RETURNING id::text
            `,
        );
    const placeA = await place(C.ortA, "C68T Ort A", 400);
    const placeB = await place(C.ortB, "C68T Ort B", 401);
    const placeC = await place(C.ortC, "C68T Ort C", 402);
    await place(C.ortInaktiv, "C68T Ort Inaktiv", 403, false);
    await place(C.ortOhneZuordnung, "C68T Ort Ohne Zuordnung", 404);

    const settlementSnapshot = async (key: string): Promise<string> =>
        remember(
            `snapshot:${key}`,
            await database<{ id: string }[]>`
                INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url)
                VALUES (${key}, ${`https://de.wiki-aventurica.de/wiki/${key}`}) RETURNING id::text
            `,
        );
    const assignPlace = async (placeId: string, snapshotId: string, key: string): Promise<void> => {
        await database`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state)
            VALUES (${placeId}, ${`https://de.wiki-aventurica.de/wiki/${key}`}, ${snapshotId}, 'assigned')
        `;
    };
    await assignPlace(placeA, await settlementSnapshot("p68t-ort-a"), "p68t-ort-a");
    const shared = await settlementSnapshot("p68t-ort-geteilt");
    await assignPlace(placeB, shared, "p68t-ort-geteilt");
    await assignPlace(placeC, shared, "p68t-ort-geteilt");

    const territory = async (
        publicId: string,
        name: string,
        wikiKey: string | null,
        parentId: string | null,
        active = true,
    ): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO territory (public_id, map_domain_id, parent_id, name, color, opacity, wiki_key, is_active, source_system)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${parentId}, ${name}, '#B2B065', 0.7, ${wikiKey}, ${active}, 'test')
                RETURNING id::text
            `,
        );
    const gebietA = await territory(C.gebietA, "C68T Gebiet A", "wiki:p68t-gebiet-a", null);
    await territory(C.gebietB, "C68T Gebiet B", "wiki:p68t-gebiet-b", gebietA);
    await territory(C.gebietDoppelt1, "C68T Gebiet Doppelt 1", "wiki:p68t-gebiet-doppelt", null);
    await territory(C.gebietDoppelt2, "C68T Gebiet Doppelt 2", "wiki:p68t-gebiet-doppelt", null);
    await territory(C.gebietInaktiv, "C68T Gebiet Inaktiv", "wiki:p68t-gebiet-inaktiv", null, false);

    const region = async (publicId: string, name: string, key: string | null, active: boolean): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, wiki_url, wiki_region_key)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, 'topographie', 'wald', ${active},
                        ${key === null ? null : `https://de.wiki-aventurica.de/wiki/${key}`}, ${key})
                RETURNING id::text
            `,
        );
    const regionA = await region(C.regionA, "C68T Region A", "p68t-region-a", true);
    const regionInactive = await region(C.regionInaktiv, "C68T Region Inaktiv", "p68t-region-inaktiv", false);
    const label = async (publicId: string, name: string, regionId: string, active: boolean): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active, region_id)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, ST_SetSRID(ST_MakePoint(410, 410), 0), ${active}, ${regionId})
                RETURNING id::text
            `,
        );
    };
    await label(C.beschriftungA, "C68T Wald A", regionA, true);
    await label(C.beschriftungInaktiv, "C68T Wald Inaktiv", regionInactive, true);

    const peak = async (publicId: string, name: string): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, is_active, source_system)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, 'berggipfel', ST_SetSRID(ST_MakePoint(420, 420), 0), TRUE, 'test')
                RETURNING id::text
            `,
        );
    const peakA = await peak(C.gipfelA, "C68T Gipfel A");
    await peak(C.gipfelB, "C68T Gipfel B");
    const regionSnapshot = remember(
        "snapshot:p68t-gipfel-a",
        await database<{ id: string }[]>`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url)
            VALUES ('p68t-gipfel-a', 'https://de.wiki-aventurica.de/wiki/p68t-gipfel-a') RETURNING id::text
        `,
    );
    await database`
        INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state)
        VALUES (${peakA}, 'https://de.wiki-aventurica.de/wiki/p68t-gipfel-a', ${regionSnapshot}, 'assigned')
    `;

    const path = async (publicId: string, name: string, y: number): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, 'Strasse', FALSE,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(400, ${y}), ST_MakePoint(410, ${y})), 0), 'test', TRUE)
                RETURNING id::text
            `,
        );
    const pathA1 = await path(C.wegA1, "C68T Weg A 1", 430);
    const pathA2 = await path(C.wegA2, "C68T Weg A 2", 431);
    await path(C.wegOhneZuordnung, "C68T Weg Ohne Zuordnung", 432);
    const pathSnapshot = remember(
        "snapshot:p68t-weg-a",
        await database<{ id: string }[]>`
            INSERT INTO wiki_path_snapshot (wiki_key, wiki_url)
            VALUES ('p68t-weg-a', 'https://de.wiki-aventurica.de/wiki/p68t-weg-a') RETURNING id::text
        `,
    );
    for (const pathId of [pathA1, pathA2]) {
        await database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
            VALUES (${pathId}, 'main', 'https://de.wiki-aventurica.de/wiki/p68t-weg-a', ${pathSnapshot}, 'assigned')
        `;
    }
    return ids;
}

/** Ein Index ohne Datenbank für die reinen Tests: genau die Träger der Fixture, mit festen Ids. */
export function fixtureIndex(over: Partial<TargetIndex> = {}): TargetIndex {
    const row = (id: string, active = true): { id: string; active: boolean } => ({ id, active });
    return {
        places: new Map([
            [C.ortA, row("1")],
            [C.ortB, row("2")],
            [C.ortC, row("3")],
            [C.ortInaktiv, row("4", false)],
        ]),
        placesByKey: new Map([
            ["p68t-ort-a", ["1"]],
            ["p68t-ort-geteilt", ["2", "3"]],
        ]),
        territories: new Map([
            [C.gebietA, row("10")],
            [C.gebietB, row("11")],
            [C.gebietInaktiv, row("14", false)],
        ]),
        territoriesByKey: new Map([
            ["wiki:p68t-gebiet-a", ["10"]],
            ["wiki:p68t-gebiet-b", ["11"]],
            ["wiki:p68t-gebiet-doppelt", ["12", "13"]],
        ]),
        labels: new Map([
            [C.beschriftungA, { regionId: "20", active: true }],
            [C.beschriftungInaktiv, { regionId: "21", active: true }],
        ]),
        regions: new Map([
            ["20", true],
            ["21", false],
        ]),
        regionsByKey: new Map([["p68t-region-a", ["20"]]]),
        peaks: new Map([
            [C.gipfelA, row("30")],
            [C.gipfelB, row("31")],
        ]),
        peaksByKey: new Map([["p68t-gipfel-a", ["30"]]]),
        paths: new Map([
            [C.wegA1, row("40")],
            [C.wegA2, row("41")],
            [C.wegOhneZuordnung, row("42")],
        ]),
        pathAnchors: new Map([["p68t-weg-a", { id: "40", publicId: C.wegA1, members: new Set(["40", "41"]) }]]),
        ...over,
    };
}

/** Räumt D3, D2 und die Träger der Fixture weg, in der Reihenfolge der Fremdschlüssel. */
export async function cleanCatalogFixtures(database: Queryable): Promise<void> {
    const workIds = `(SELECT id FROM adventure WHERE public_id::text LIKE '68100000-%')`;
    const mapIds = `(SELECT id FROM citymap WHERE public_id::text LIKE '69100000-%')`;
    for (const table of ["adventure_media", "adventure_place", "adventure_link", "adventure_field_origin"]) {
        await database.unsafe(`DELETE FROM ${table} WHERE adventure_id IN ${workIds}`);
    }
    await database.unsafe(`DELETE FROM adventure WHERE public_id::text LIKE '68100000-%'`);
    for (const table of [
        "citymap_media",
        "citymap_place",
        "citymap_link",
        "citymap_source",
        "citymap_type",
        "citymap_wiki_assignment",
    ]) {
        await database.unsafe(`DELETE FROM ${table} WHERE citymap_id IN ${mapIds}`);
    }
    await database.unsafe(
        `DELETE FROM citymap_related WHERE citymap_id IN ${mapIds} OR related_citymap_id IN ${mapIds}`,
    );
    await database.unsafe(`UPDATE citymap SET parent_id = NULL WHERE public_id::text LIKE '69100000-%'`);
    await database.unsafe(`DELETE FROM citymap WHERE public_id::text LIKE '69100000-%'`);
    await database.unsafe(`DELETE FROM feature_source WHERE title LIKE 'P69T%' OR url LIKE 'https://p69test.%'`);
    // D6 der Träger
    const mine = `public_id::text LIKE '68000000-%'`;
    const carrierIds = (table: string): string => `(SELECT id FROM ${table} WHERE ${mine})`;
    await database.unsafe(`DELETE FROM place_wiki_assignment WHERE place_id IN ${carrierIds("place")}`);
    await database.unsafe(`DELETE FROM path_wiki_assignment WHERE path_id IN ${carrierIds("path")}`);
    await database.unsafe(
        `DELETE FROM terrain_peak_wiki_assignment WHERE terrain_peak_id IN ${carrierIds("terrain_peak")}`,
    );
    for (const table of ["wiki_settlement_snapshot", "wiki_path_snapshot", "wiki_region_snapshot"]) {
        await database.unsafe(`DELETE FROM ${table} WHERE wiki_key LIKE 'p68t-%'`);
    }
    await database.unsafe(`DELETE FROM map_label WHERE ${mine}`);
    await database.unsafe(`DELETE FROM region WHERE ${mine}`);
    await database.unsafe(`DELETE FROM terrain_peak WHERE ${mine}`);
    await database.unsafe(`DELETE FROM path WHERE ${mine}`);
    await database.unsafe(`UPDATE territory SET parent_id = NULL WHERE ${mine}`);
    await database.unsafe(`DELETE FROM territory WHERE ${mine}`);
    await database.unsafe(`DELETE FROM place WHERE ${mine}`);
    try {
        // Die Läufe der Tests (die Testdatenbank trägt keine anderen dieser Domänen); hängt noch eine Zeile daran, bleibt er.
        await database.unsafe(`DELETE FROM migration_run WHERE data_domain IN ('literature', 'citymaps')`);
    } catch {
        // ein Fremdschlüssel hält ihn: stehen lassen
    }
}
