import type { Queryable } from "../../src/database.ts";

/**
 * Fixtures für die Tests von D6 (Detailfelder, Wiki-Zuordnung) und D1 (Quellen, Kanon), WI-0063 P3.
 *
 * Alle öffentlichen IDs tragen die Vorsilbe `63000000-`; Schnappschuss-Schlüssel beginnen mit `p3t-`, Quellen mit dem Titel `P3T`
 * und Adressen auf `p3test.example`. Damit räumt `cleanP3Fixtures` genau das weg, was diese Tests angelegt haben, und
 * fasst keinen fremden Bestand an.
 */

export const P3_MAP_DOMAIN = "aventuria";

export const p3Id = (n: number): string => `63000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Die Träger einer Fixture, mit ihren öffentlichen IDs. */
export const P3 = {
    ort: p3Id(1),
    ortZwei: p3Id(2),
    ortLeer: p3Id(3),
    ortAdresse: p3Id(4),
    weg: p3Id(10),
    wegZwei: p3Id(11),
    wegDrei: p3Id(12),
    kraftlinie: p3Id(20),
    kraftlinieZwei: p3Id(21),
    gebiet: p3Id(30),
    region: p3Id(40),
    regionZwei: p3Id(41),
    beschriftung: p3Id(50),
    beschriftungZwei: p3Id(51),
    freieBeschriftung: p3Id(52),
    gipfel: p3Id(60),
    gipfelInaktiv: p3Id(61),
} as const;

export interface P3Ids {
    [publicId: string]: string;
}

/** Legt die Träger an und gibt ihre Datenbank-Ids zurück (öffentliche ID zu Id). */
export async function insertP3Carriers(database: Queryable): Promise<P3Ids> {
    const ids: P3Ids = {};
    const remember = (publicId: string, rows: { id: string }[]): void => {
        const row = rows[0];
        if (!row) throw new Error(`Fixture ${publicId} nicht angelegt`);
        ids[publicId] = row.id;
    };
    const place = async (publicId: string, name: string, x: number): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${publicId}, ${P3_MAP_DOMAIN}, ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, 300), 0), 'test', TRUE)
                RETURNING id::text
            `,
        );
    };
    await place(P3.ort, "P3T Ort Eins", 300);
    await place(P3.ortZwei, "P3T Ort Zwei", 301);
    await place(P3.ortLeer, "P3T Ort Leer", 302);
    await place(P3.ortAdresse, "P3T Ort Adresse", 303);
    const path = async (publicId: string, name: string, y: number): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
                VALUES (${publicId}, ${P3_MAP_DOMAIN}, ${name}, 'Strasse', FALSE,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(300, ${y}), ST_MakePoint(310, ${y})), 0), 'test', TRUE)
                RETURNING id::text
            `,
        );
    };
    await path(P3.weg, "P3T Weg Eins", 310);
    await path(P3.wegZwei, "P3T Weg Zwei", 311);
    await path(P3.wegDrei, "Strasse-77", 312);
    const line = async (publicId: string, name: string, y: number): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id,
                                       geom, drawn_geom, source_system, legacy_public_id)
                VALUES (${publicId}, ${P3_MAP_DOMAIN}, ${name}, FALSE, ${P3.ort}, ${P3.ortZwei},
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(300, ${y}), ST_MakePoint(310, ${y})), 0),
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(300, ${y}), ST_MakePoint(310, ${y})), 0), 'test', ${publicId})
                RETURNING id::text
            `,
        );
    };
    await line(P3.kraftlinie, "P3T Kraftlinie Eins", 320);
    await line(P3.kraftlinieZwei, "P3T Kraftlinie Zwei", 321);
    remember(
        P3.gebiet,
        await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
            VALUES (${P3.gebiet}, ${P3_MAP_DOMAIN}, 'P3T Gebiet', '#B2B065', 0.7, 'test')
            RETURNING id::text
        `,
    );
    const region = async (
        publicId: string,
        name: string,
        wikiUrl: string | null,
        wikiKey: string | null,
    ): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, wiki_url, wiki_region_key)
                VALUES (${publicId}, ${P3_MAP_DOMAIN}, ${name}, 'topographie', 'wald', TRUE, ${wikiUrl}, ${wikiKey})
                RETURNING id::text
            `,
        );
    };
    await region(P3.region, "P3T Region Eins", "https://de.wiki-aventurica.de/wiki/P3T_Region", "p3t-region");
    await region(P3.regionZwei, "P3T Region Zwei", null, null);
    const label = async (publicId: string, name: string, regionId: string): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active, region_id)
                VALUES (${publicId}, ${P3_MAP_DOMAIN}, ${name}, ST_SetSRID(ST_MakePoint(330, 330), 0), TRUE, ${regionId})
                RETURNING id::text
            `,
        );
    };
    await label(P3.beschriftung, "P3T Wald Eins", ids[P3.region] as string);
    await label(P3.beschriftungZwei, "P3T Wald Zwei", ids[P3.regionZwei] as string);
    const peak = async (publicId: string, name: string, active: boolean): Promise<void> => {
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, is_active, source_system)
                VALUES (${publicId}, ${P3_MAP_DOMAIN}, ${name}, 'berggipfel', ST_SetSRID(ST_MakePoint(340, 340), 0), ${active}, 'test')
                RETURNING id::text
            `,
        );
    };
    await peak(P3.gipfel, "P3T Gipfel", true);
    await peak(P3.gipfelInaktiv, "P3T Gipfel Inaktiv", false);
    return ids;
}

/** Räumt D6, D1 und die Träger der Fixture weg, in der Reihenfolge der Fremdschlüssel. */
export async function cleanP3Fixtures(database: Queryable): Promise<void> {
    const mine = `public_id::text LIKE '63000000-%'`;
    const carrierIds = (table: string): string => `(SELECT id FROM ${table} WHERE ${mine})`;
    // D1
    for (const [table, column, carrier] of [
        ["place_source", "place_id", "place"],
        ["path_source", "path_id", "path"],
        ["territory_source", "territory_id", "territory"],
        ["region_source", "region_id", "region"],
        ["terrain_peak_source", "terrain_peak_id", "terrain_peak"],
        ["place_canon", "place_id", "place"],
        ["path_canon", "path_id", "path"],
        ["territory_canon", "territory_id", "territory"],
        ["region_canon", "region_id", "region"],
        ["terrain_peak_canon", "terrain_peak_id", "terrain_peak"],
        ["powerline_canon", "powerline_id", "powerline"],
    ] as const) {
        await database.unsafe(`DELETE FROM ${table} WHERE ${column} IN ${carrierIds(carrier)}`);
    }
    await database.unsafe(`DELETE FROM feature_source WHERE title LIKE 'P3T%' OR url LIKE 'https://p3test.%'`);
    await database.unsafe(`DELETE FROM source_corpus WHERE corpus_key LIKE 'p3test.%'`);
    // D6
    for (const [table, column, carrier] of [
        ["place_wiki_assignment", "place_id", "place"],
        ["path_wiki_assignment", "path_id", "path"],
        ["terrain_peak_wiki_assignment", "terrain_peak_id", "terrain_peak"],
        ["powerline_wiki_assignment", "powerline_id", "powerline"],
        ["place_detail", "place_id", "place"],
    ] as const) {
        await database.unsafe(`DELETE FROM ${table} WHERE ${column} IN ${carrierIds(carrier)}`);
    }
    await database.unsafe(
        `DELETE FROM wiki_settlement_traffic_link WHERE snapshot_id IN (SELECT id FROM wiki_settlement_snapshot WHERE wiki_key LIKE 'p3t-%')`,
    );
    await database.unsafe(
        `DELETE FROM wiki_region_snapshot_neighbor WHERE snapshot_id IN (SELECT id FROM wiki_region_snapshot WHERE wiki_key LIKE 'p3t-%')`,
    );
    await database.unsafe(
        `DELETE FROM wiki_region_snapshot_synonym WHERE snapshot_id IN (SELECT id FROM wiki_region_snapshot WHERE wiki_key LIKE 'p3t-%')`,
    );
    for (const table of [
        "wiki_settlement_snapshot",
        "wiki_path_snapshot",
        "wiki_region_snapshot",
        "wiki_powerline_snapshot",
    ]) {
        await database.unsafe(`DELETE FROM ${table} WHERE wiki_key LIKE 'p3t-%'`);
    }
    // Träger
    await database.unsafe(`DELETE FROM map_label WHERE ${mine}`);
    await database.unsafe(`DELETE FROM region WHERE ${mine}`);
    await database.unsafe(`DELETE FROM terrain_peak WHERE ${mine}`);
    await database.unsafe(`DELETE FROM powerline WHERE ${mine}`);
    await database.unsafe(`DELETE FROM path WHERE ${mine}`);
    await database.unsafe(`DELETE FROM territory WHERE ${mine}`);
    await database.unsafe(`DELETE FROM place WHERE ${mine}`);
    // Die Läufe der Fixture (Revision 9xxx): Der Eintrag im Journal ist harmlos; hängt noch irgendwo eine Zeile daran, bleibt er.
    try {
        await database.unsafe(
            `DELETE FROM migration_run WHERE data_domain IN ('subject-details', 'sources') AND source_ref LIKE 'map_revision=9%'`,
        );
    } catch {
        // ein Fremdschlüssel hält ihn: stehen lassen
    }
}
