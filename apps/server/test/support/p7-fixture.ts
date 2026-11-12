import type { Database } from "../../src/database.ts";
import type { LegacyTerritoryPayload } from "../../src/migration/territories.ts";
import { importTerritories } from "../../src/migration/territory-import.ts";
import { deriveTerritories } from "../../src/territories/derive.ts";

/**
 * Fixtures für die Tests von WI-0063 P7 gegen die gemeinsame Testdatenbank: „Weg als Route“ und „Ganze Straße“ (Straßen mit Orten an
 * den Enden), die Gestalt der Kraftlinien und die Anspruchsteller samt Klima der Gebiete.
 *
 * Alle öffentlichen IDs tragen die Vorsilbe `70000000-`, Schnappschuss-Schlüssel beginnen mit `p7t-`. Damit räumt `cleanP7Fixtures`
 * genau das weg, was diese Tests angelegt haben. Die Welt liegt in einer eigenen Ecke der Karte (x 800 bis 920, y 200 bis 280), im
 * tropischen Band (y bis 315): Das Klima der Gebiete ist dort ganz „tropisch“.
 *
 *     Straße (Wiki)     P7 Anfang ─ P7 Mitte ─ [P7 Versteck, verborgen] ─ P7 Ost      ·  Lücke  ·  (kein Ort) ─ P7 Ferne
 *     Reich (0-1)       ├ Baronie Eins (2-6, beansprucht von Anspruch Eins und Anspruch Zwei, und vom Reich selbst)
 *                       └ Baronie Zwei (2-6)
 */

export const P7_DOMAIN = "aventuria";
export const P7_WIKI = "https://de.wiki-aventurica.de/wiki/";
export const P7_STAMP = "pt-p7-subjects";

export const p7Id = (n: number): string => `70000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const P7 = {
    // Orte
    anfang: p7Id(0x01),
    mitte: p7Id(0x02),
    versteck: p7Id(0x03),
    ost: p7Id(0x04),
    ferne: p7Id(0x05),
    einsam: p7Id(0x06),
    kraftA: p7Id(0x11),
    kraftB: p7Id(0x12),
    kraftC: p7Id(0x13),
    kraftVersteck: p7Id(0x14),
    ring1: p7Id(0x15),
    ring2: p7Id(0x16),
    ring3: p7Id(0x17),
    /** Ein Knoten der Kraftlinie, den kein Ort trägt (ein Nodix). */
    nodix: p7Id(0x1f),
    // Wegabschnitte
    strasse1: p7Id(0x81),
    strasse2: p7Id(0x82),
    strasse3: p7Id(0x83),
    strasse4: p7Id(0x84),
    ohneWiki: p7Id(0x85),
    seeweg: p7Id(0x86),
    kurz: p7Id(0x87),
    // Kraftlinien
    linie1: p7Id(0xa1),
    linie2: p7Id(0xa2),
    linie3: p7Id(0xa3),
    ring1Seg: p7Id(0xa4),
    ring2Seg: p7Id(0xa5),
    ring3Seg: p7Id(0xa6),
    // Gebiete
    reich: p7Id(0x20),
    baronieEins: p7Id(0x21),
    baronieZwei: p7Id(0x22),
    anspruchEins: p7Id(0x23),
    anspruchZwei: p7Id(0x24),
} as const;

function quadrat(x: number, y: number, breite: number, hoehe: number): number[][] {
    return [
        [x, y],
        [x + breite / 2, y],
        [x + breite, y],
        [x + breite, y + hoehe / 2],
        [x + breite, y + hoehe],
        [x + breite / 2, y + hoehe],
        [x, y + hoehe],
        [x, y + hoehe / 2],
        [x, y],
    ];
}

function gebiet(
    publicId: string,
    name: string,
    parent: string | null,
    band: [number | null, number | null],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: publicId,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "",
        parent_public_id: parent,
        status: "",
        color: "#35b145",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:p7t-${name.toLowerCase().replaceAll(" ", "-")}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 1,
        updated_at: "2026-09-18 19:38:14.964",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
        ...extra,
    };
}

function flaeche(n: number, territory: string, coordinates: number[][][]): Record<string, unknown> {
    return {
        public_id: p7Id(0x300 + n),
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: 0,
        max_zoom: 6,
        updated_at: "2026-09-14 02:21:11.083",
    };
}

export function p7TerritoryPayload(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 170000,
        territories_revision: P7_STAMP,
        territories: [
            gebiet(P7.reich, "P7 Reich", null, [0, 1], {
                type: "Reich",
                wiki_type: "Reich (Testprovinz)",
                color: "#102030",
            }),
            gebiet(P7.baronieEins, "P7 Baronie Eins", P7.reich, [2, 6], { color: "#aa0000" }),
            gebiet(P7.baronieZwei, "P7 Baronie Zwei", P7.reich, [2, 6], { color: "#00aa00" }),
            gebiet(P7.anspruchEins, "P7 Anspruch Eins", null, [0, 6], { type: "Mark", color: "#0000aa" }),
            gebiet(P7.anspruchZwei, "P7 Anspruch Zwei", null, [0, 6], { type: "Mark", color: "#aaaa00" }),
        ],
        geometries: [
            flaeche(1, P7.baronieEins, [quadrat(860, 200, 20, 20)]),
            flaeche(2, P7.baronieZwei, [quadrat(880, 200, 20, 20)]),
            flaeche(3, P7.anspruchEins, [quadrat(900, 200, 10, 10)]),
            flaeche(4, P7.anspruchZwei, [quadrat(910, 200, 10, 10)]),
        ],
        claims: [
            // Die Reihenfolge des Anspruchs (`sort_order`) gilt: erst Zwei, dann Eins - nicht die der Namen.
            { territory_public_id: P7.baronieEins, claimant_public_id: P7.anspruchZwei, sort_order: 0, source: "wiki" },
            { territory_public_id: P7.baronieEins, claimant_public_id: P7.anspruchEins, sort_order: 1, source: "wiki" },
            // Das Reich beansprucht einen Teil seiner selbst: Auf seiner eigenen Seite steht es nie als Anspruchsteller.
            { territory_public_id: P7.baronieZwei, claimant_public_id: P7.reich, sort_order: 0, source: "manual" },
        ],
    };
}

/** Legt die Welt an. Die Gebiete kommen über den echten Import und die echte Ableitung. */
export async function insertP7Fixtures(database: Database): Promise<void> {
    await cleanP7Fixtures(database);
    await importTerritories(database, p7TerritoryPayload(), { sourceEtag: 'W/"pol-p7-test"' });
    await deriveTerritories(database, { force: true });

    const place = async (publicId: string, name: string, x: number, y: number, hidden = false): Promise<void> => {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
            VALUES (${publicId}, ${P7_DOMAIN}, ${name}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'test', TRUE, ${hidden})
        `;
    };
    await place(P7.anfang, "P7 Anfang", 800, 200);
    await place(P7.mitte, "P7 Mitte", 810, 200);
    await place(P7.versteck, "P7 Versteck", 820, 200, true);
    await place(P7.ost, "P7 Ost", 830, 200);
    await place(P7.ferne, "P7 Ferne", 840, 220);
    await place(P7.einsam, "P7 Einsam", 850, 200);
    await place(P7.kraftA, "P7 Kraft A", 860, 240);
    await place(P7.kraftB, "P7 Kraft B", 870, 240);
    await place(P7.kraftC, "P7 Kraft C", 880, 240);
    await place(P7.kraftVersteck, "P7 Kraft Versteck", 875, 240, true);
    await place(P7.ring1, "P7 Ring 1", 860, 260);
    await place(P7.ring2, "P7 Ring 2", 870, 260);
    await place(P7.ring3, "P7 Ring 3", 865, 270);

    // ---- Wege ---------------------------------------------------------------------------------------------------------------
    const path = async (
        publicId: string,
        name: string,
        subtype: string,
        [x0, y0, x1, y1]: [number, number, number, number],
    ): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${publicId}, ${P7_DOMAIN}, ${name}, ${subtype}, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0), 'test', TRUE)
            RETURNING id::text
        `;
        if (!row) throw new Error(`Weg ${publicId} nicht angelegt`);
        return row.id;
    };
    // Die Straße: drei Abschnitte in einer Kette (der dritte rückwärts) und ein Stück jenseits einer Lücke, dessen Anfang kein Ort trägt.
    const s1 = await path(P7.strasse1, "P7 Straße", "Strasse", [800, 200, 810, 200]);
    const s2 = await path(P7.strasse2, "P7 Straße", "Strasse", [810, 200, 820, 200]);
    const s3 = await path(P7.strasse3, "P7 Straße", "Strasse", [830, 200, 820, 200]);
    const s4 = await path(P7.strasse4, "P7 Straße", "Strasse", [840, 220, 835, 220]);
    const ohneWiki = await path(P7.ohneWiki, "P7 Ohne Wiki", "Strasse", [800, 200, 810, 200]);
    const seeweg = await path(P7.seeweg, "P7 Seeweg", "Seeweg", [800, 200, 810, 200]);
    const kurz = await path(P7.kurz, "P7 Kurz", "Strasse", [850, 200, 855, 205]);
    void ohneWiki;

    const snapshot = async (key: string, name: string): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art, lage, laenge, verlauf, description, is_lean, synced_at)
            VALUES (${key}, ${`${P7_WIKI}${key}`}, ${name}, 'strasse', 'Straße', NULL, NULL, NULL, 'Eine Straße.', FALSE, '2026-06-06T21:01:40.000Z')
            RETURNING id::text
        `;
        if (!row) throw new Error(`Schnappschuss ${key} nicht angelegt`);
        return row.id;
    };
    const assign = (pathId: string, key: string, snapshotId: string): Promise<unknown> =>
        database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            VALUES (${pathId}, 'main', ${`${P7_WIKI}${key}`}, ${snapshotId}, 'assigned', 'legacy_editor')
        `;
    const strasse = await snapshot("p7t-strasse", "P7 Straße");
    for (const id of [s1, s2, s3, s4]) await assign(id, "p7t-strasse", strasse);
    await assign(seeweg, "p7t-seeweg", await snapshot("p7t-seeweg", "P7 Seeweg"));
    await assign(kurz, "p7t-kurz", await snapshot("p7t-kurz", "P7 Kurz"));

    // ---- Kraftlinien ---------------------------------------------------------------------------------------------------------
    const line = async (
        publicId: string,
        name: string,
        from: string,
        to: string,
        [x0, y0, x1, y1]: [number, number, number, number],
    ): Promise<void> => {
        await database`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system, legacy_public_id)
            VALUES (${publicId}, ${P7_DOMAIN}, ${name}, FALSE, ${from}, ${to},
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0), 'test', ${publicId})
        `;
    };
    // Ein Strang A - B - (verborgener Ort) - Nodix - C: zwei benannte Enden, B als Station, der Rest ohne Namen.
    await line(P7.linie1, "P7 Linie", P7.kraftA, P7.kraftB, [860, 240, 870, 240]);
    await line(P7.linie2, "P7 Linie", P7.kraftB, P7.kraftVersteck, [870, 240, 875, 240]);
    await line(P7.linie3, "P7 Linie", P7.kraftVersteck, P7.nodix, [875, 240, 878, 240]);
    // … und noch ein Segment vom Nodix nach C.
    await line(p7Id(0xa7), "P7 Linie", P7.nodix, P7.kraftC, [878, 240, 880, 240]);
    // Ein Ring aus drei Segmenten.
    await line(P7.ring1Seg, "P7 Ring", P7.ring1, P7.ring2, [860, 260, 870, 260]);
    await line(P7.ring2Seg, "P7 Ring", P7.ring2, P7.ring3, [870, 260, 865, 270]);
    await line(P7.ring3Seg, "P7 Ring", P7.ring3, P7.ring1, [865, 270, 860, 260]);
}

/** Entfernt alles, was diese Tests angelegt haben, in Fremdschlüsselreihenfolge. */
export async function cleanP7Fixtures(database: Database): Promise<void> {
    const mine = (table: string): string => `(SELECT id FROM ${table} WHERE public_id::text LIKE '70000000-%')`;
    const territories = `SELECT id FROM territory WHERE public_id::text LIKE '70000000-%'`;
    const statements = [
        `DELETE FROM path_wiki_assignment WHERE path_id IN ${mine("path")}`,
        `DELETE FROM wiki_path_snapshot WHERE wiki_key LIKE 'p7t-%'`,
        `DELETE FROM powerline WHERE public_id::text LIKE '70000000-%'`,
        `DELETE FROM path WHERE public_id::text LIKE '70000000-%'`,
        `DELETE FROM place WHERE public_id::text LIKE '70000000-%'`,
        `DELETE FROM territory_border WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_shape WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_display_area WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_claim_shape WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_claim WHERE territory_id IN (${territories}) OR claimant_id IN (${territories})`,
        `DELETE FROM territory_area WHERE public_id::text LIKE '70000000-%'`,
        `UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '70000000-%'`,
        `DELETE FROM territory WHERE public_id::text LIKE '70000000-%'`,
        `DELETE FROM territory_state WHERE map_domain_id = '${P7_DOMAIN}' AND source_stamp = '${P7_STAMP}'`,
        `DELETE FROM migration_run WHERE data_domain = 'territories' AND source_ref LIKE 'territories_revision=${P7_STAMP};%' AND NOT EXISTS (SELECT 1 FROM territory WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_area WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_claim WHERE migration_run_id = migration_run.id)`,
    ];
    for (const statement of statements) {
        await database.unsafe(statement);
    }
}
