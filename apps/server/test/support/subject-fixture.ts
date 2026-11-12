import type { Database, Queryable } from "../../src/database.ts";
import type { LegacyTerritoryPayload } from "../../src/migration/territories.ts";
import { importTerritories } from "../../src/migration/territory-import.ts";
import { importWikiLinkTargets } from "../../src/migration/wiki-link-targets-import.ts";
import { PUBLISHED_VARIANT } from "../../src/media/roles.ts";
import { deriveTerritories } from "../../src/territories/derive.ts";
import { cleanMediaFixtures, insertAsset, insertGallery } from "./media-fixture.ts";
import { p4Key, x1Payload, x2Payload, type X1Spec, type X2Spec } from "./wiki-link-fixture.ts";

/**
 * Fixtures für die Tests des Subject-Lesevertrags (WI-0063 P4) gegen die gemeinsame Testdatenbank.
 *
 * Alle öffentlichen IDs tragen die Vorsilbe `64000000-`, Schnappschuss-Schlüssel beginnen mit `p4t-`, Quellen tragen den Titel
 * `P4T …` und Adressen auf `p4test.example`. Damit räumt `cleanSubjectFixtures` genau das weg, was diese Tests angelegt haben.
 *
 * Die Welt liegt in einer eigenen Ecke der Karte (x 100 bis 190, y 100 bis 200):
 *
 *     Reich (Band 0-1)  ─ Provinz West (2-3) ─ Grafschaft (4-6)          x 100-130 / 100-120, y 100-160 / 100-120
 *                       └ Provinz Ost  (2-3)                             x 130-160, y 100-160
 *     Nachbarreich (0-6)                                                 x 160-190, y 100-160
 *     Meer (Landschaft)                                                  x 100-190, y 160-200
 */

export const MAP_DOMAIN = "aventuria";
export const WIKI = "https://de.wiki-aventurica.de/wiki/";
export const STAMP = "pt-p4-subjects";

export const p4Id = (n: number): string => `64000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const P4 = {
    // Orte
    gareth: p4Id(0x01),
    dorf: p4Id(0x02),
    dorfHandtext: p4Id(0x03),
    dorfAdresse: p4Id(0x04),
    dorfVerborgen: p4Id(0x05),
    zwillingA: p4Id(0x06),
    zwillingB: p4Id(0x07),
    fasarOrt: p4Id(0x08),
    dorfOsten: p4Id(0x09),
    // Gebiete
    reich: p4Id(0x20),
    provinzWest: p4Id(0x21),
    provinzOst: p4Id(0x22),
    grafschaft: p4Id(0x23),
    nachbar: p4Id(0x24),
    fasarGebiet: p4Id(0x25),
    // Landschaften
    wald: p4Id(0x40),
    huegel: p4Id(0x41),
    see: p4Id(0x42),
    archipelA: p4Id(0x43),
    archipelB: p4Id(0x44),
    griff: p4Id(0x45),
    schleife: p4Id(0x46),
    meer: p4Id(0x47),
    nordwald: p4Id(0x48),
    landstrich: p4Id(0x49),
    // Beschriftungen und Gipfel
    labelWald: p4Id(0x50),
    gipfel: p4Id(0x60),
    gipfelFrei: p4Id(0x61),
    // Wegabschnitte
    flussEins: p4Id(0x81),
    flussZwei: p4Id(0x82),
    flussDrei: p4Id(0x83),
    strasseEins: p4Id(0x84),
    strasseZwei: p4Id(0x85),
    waldwegEins: p4Id(0x86),
    waldwegZwei: p4Id(0x87),
    einzel: p4Id(0x88),
    waldwegPfad: p4Id(0x89),
    jennbach: p4Id(0x8a),
    mischEins: p4Id(0x8b),
    mischZwei: p4Id(0x8c),
    mischDrei: p4Id(0x8d),
    // Kraftlinien
    linieEins: p4Id(0xa1),
    linieZwei: p4Id(0xa2),
    linieDrei: p4Id(0xa3),
    linieVier: p4Id(0xa4),
    linieEinzel: p4Id(0xa5),
} as const;

export const SYNCED = "2026-06-06T21:01:40.000Z";

function quadrat(x: number, y: number, breite = 40, hoehe = 40): number[][] {
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
        type: "Kaiserreich",
        // Wie im Bestand folgt die Art des Wikis der eigenen, solange eine Fixture sie nicht ausdrücklich anders setzt: Legacy nennt im
        // Kopf erst die Art des Wikis (WI-0063 P7), und ein Gebiet „Grafschaft“ soll nicht als „Kaiserreich“ erscheinen.
        wiki_type: typeof extra["type"] === "string" ? extra["type"] : "Kaiserreich",
        parent_public_id: parent,
        status: "eigenständiger Staat",
        color: "#35b145",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:p4t-${name.toLowerCase().replaceAll(" ", "-")}`,
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
        public_id: p4Id(0x300 + n),
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: 0,
        max_zoom: 6,
        updated_at: "2026-09-14 02:21:11.083",
    };
}

export function territoryPayload(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 164000,
        territories_revision: STAMP,
        territories: [
            gebiet(P4.reich, "P4 Reich", null, [0, 1], {
                status: "Kaiserreich",
                valid_label: "seit 100 BF",
                capital_place_public_id: P4.gareth,
            }),
            gebiet(P4.provinzWest, "P4 Provinz West", P4.reich, [2, 3], {
                type: "Provinz",
                seat_place_public_id: P4.gareth,
            }),
            gebiet(P4.provinzOst, "P4 Provinz Ost", P4.reich, [2, 3], { type: "Provinz" }),
            gebiet(P4.grafschaft, "P4 Grafschaft", P4.provinzWest, [4, 6], { type: "Grafschaft" }),
            gebiet(P4.nachbar, "P4 Nachbarreich", null, [0, 6]),
            gebiet(P4.fasarGebiet, "P4 Fasar", null, [0, 6], { wiki_url: `${WIKI}P4_Fasar` }),
        ],
        geometries: [
            flaeche(1, P4.provinzWest, [quadrat(100, 100, 30, 60)]),
            flaeche(2, P4.provinzOst, [quadrat(130, 100, 30, 60)]),
            flaeche(3, P4.grafschaft, [quadrat(100, 100, 20, 20)]),
            flaeche(4, P4.nachbar, [quadrat(160, 100, 30, 60)]),
            // Das Gebiet Fasar liegt irgendwo im Nichts der Testecke: es braucht nur eine Fläche, damit es abgeleitet wird.
            flaeche(5, P4.fasarGebiet, [quadrat(300, 300, 10, 10)]),
        ],
        claims: [],
    };
}

/** Die Zuordnung der P4-Welt (X2): jedes Objekt, dem diese Fixture eine Wiki-Zuweisung gibt, samt den Ausnahmen für die Proben. */
export function p4Assignments(): X2Spec[] {
    return [
        // Orte: Gareth mit Schnappschuss, die übrigen nur mit Adresse; Fasar teilt den Key mit dem Gebiet (mehrdeutig), die Zwillinge teilen ihn miteinander.
        { art: "siedlung", id: P4.gareth, key: p4Key("p4t-gareth") },
        { art: "siedlung", id: P4.dorfAdresse, key: p4Key("p4-dorf-adresse") },
        { art: "siedlung", id: P4.zwillingA, key: p4Key("p4-rathila") },
        { art: "siedlung", id: P4.zwillingB, key: p4Key("p4-rathila") },
        { art: "siedlung", id: P4.fasarOrt, key: p4Key("p4t-fasar") },
        // Ein verborgener Ort steht nicht auf der Karte: die Zuweisung bleibt in der Tafel, ein Ziel ist er nicht.
        { art: "siedlung", id: P4.dorfVerborgen, key: p4Key("p4-dorf-verborgen") },
        // Gebiet (nur mit Form ein Ziel).
        { art: "gebiet", id: P4.fasarGebiet, key: p4Key("p4t-fasar") },
        // Landschaften: Waldwildnis und der Nordwald teilen den Artikel (zwei Gruppen, mehrdeutig), die zwei Archipel-Flächen sind EINE Gruppe.
        { art: "landschaft", id: P4.wald, key: p4Key("p4t-waldwildnis") },
        { art: "landschaft", id: P4.nordwald, key: p4Key("p4t-waldwildnis") },
        { art: "landschaft", id: P4.archipelA, key: p4Key("p4-archipel") },
        { art: "landschaft", id: P4.archipelB, key: p4Key("p4-archipel") },
        // Die Beschriftung der Waldwildnis wiederholt den Artikel der Region, an die sie gebunden ist; der Gipfel ist ein eigenes Objekt.
        { art: "region", id: P4.labelWald, key: p4Key("p4t-waldwildnis") },
        { art: "region", id: P4.gipfel, key: p4Key("p4t-gipfel") },
        // Wege: der Fluss und die Straße je mit Hauptzuweisung, der Jennbach nur mit Adresse, der Mischfluss ohne seinen kleinsten Abschnitt.
        { art: "weg", id: P4.flussEins, key: p4Key("p4t-grossfluss") },
        { art: "weg", id: P4.flussZwei, key: p4Key("p4t-grossfluss") },
        { art: "weg", id: P4.flussDrei, key: p4Key("p4t-grossfluss") },
        { art: "weg", id: P4.strasseEins, key: p4Key("p4t-strasse-eins") },
        { art: "weg", id: P4.strasseZwei, key: p4Key("p4t-strasse-eins") },
        { art: "weg", id: P4.jennbach, key: p4Key("p4-jennbach") },
        { art: "weg", id: P4.mischZwei, key: p4Key("p4t-mischfluss") },
        { art: "weg", id: P4.mischDrei, key: p4Key("p4t-mischfluss") },
        // Kraftlinie: alle Segmente EINES Keys sind dieselbe Kraftlinie.
        { art: "kraftlinie", id: P4.linieEins, key: p4Key("p4t-kraftlinie") },
        { art: "kraftlinie", id: P4.linieZwei, key: p4Key("p4t-kraftlinie") },
    ];
}

/**
 * Die Linkziele der P4-Welt (X1): nur Gareths Verkehrswege (der Fall des Betreibers: ein Name mit Objekt, ein Name ohne Seite, der NAME eines echten Wegs ohne
 * Zuweisung, eine Seite ohne Objekt). Alles Weitere bauen die Proben selbst.
 */
export function p4Pages(): X1Spec[] {
    return [
        {
            key: p4Key("p4t-gareth"),
            kind: "settlement",
            title: "P4 Gareth",
            felder: {
                verkehrswege: [
                    { anzeige: "P4 Reichsstraße 1", ziel: "P4 Strasse Eins", key: p4Key("p4t-strasse-eins") },
                    { anzeige: "Unbekannter Weg", key: p4Key("p4-gibt-es-nicht") },
                    // Der NAME eines echten Wegs ohne Wiki-Zuweisung: kein Objekt trägt diesen Key.
                    { anzeige: "P4 Waldweg", key: p4Key("p4-waldweg") },
                    // Eine Seite, die nur als weitere Zuweisung eines Wegs vorkommt: X2 kennt nur Hauptzuweisungen, also trägt kein Objekt diesen Key.
                    { anzeige: "P4 Pilgerweg", key: p4Key("p4t-nur-weiter") },
                ],
            },
        },
    ];
}

/** Die zwei Antworten der P4-Welt; `extra` ergänzt Objekte und Artikel (der Import legt still, was ein Satz nicht nennt: der zweite muss den ersten enthalten). */
export function p4WikiLinkPayloads(extra: { assignments?: X2Spec[]; pages?: X1Spec[] } = {}): {
    zuordnung: Record<string, unknown>;
    linkziele: Record<string, unknown>;
} {
    return {
        zuordnung: x2Payload([...p4Assignments(), ...(extra.assignments ?? [])]),
        linkziele: x1Payload([...p4Pages(), ...(extra.pages ?? [])]),
    };
}

/** Spielt die P4-Welt (und, was eine Probe braucht) mit dem echten Importer ein. */
export function importP4WikiLinks(
    database: Database,
    extra: { assignments?: X2Spec[]; pages?: X1Spec[] } = {},
): ReturnType<typeof importWikiLinkTargets> {
    return importWikiLinkTargets(database, p4WikiLinkPayloads(extra));
}

const rect = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

export interface SubjectFixture {
    /** Öffentliche ID zu interner Id. */
    ids: Record<string, string>;
}

/** Legt die ganze Welt an. Die Gebiete kommen über den echten Import und die echte Ableitung. */
export async function insertSubjectFixtures(database: Database): Promise<SubjectFixture> {
    await cleanSubjectFixtures(database);
    await importTerritories(database, territoryPayload(), { sourceEtag: 'W/"pol-p4-test"' });
    await deriveTerritories(database, { force: true });

    const ids: Record<string, string> = {};
    const remember = (publicId: string, rows: { id: string }[]): string => {
        const row = rows[0];
        if (!row) throw new Error(`Fixture ${publicId} nicht angelegt`);
        ids[publicId] = row.id;
        return row.id;
    };

    // ---- Orte -----------------------------------------------------------------------------------------------------------
    const place = async (
        publicId: string,
        name: string,
        subtype: string,
        x: number,
        y: number,
        extra: { hidden?: boolean; kind?: string } = {},
    ): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden, place_kind)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, ${subtype}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'test', TRUE,
                        ${extra.hidden === true}, ${extra.kind ?? null})
                RETURNING id::text
            `,
        );
    const gareth = await place(P4.gareth, "P4 Gareth", "metropole", 110, 110, { kind: "Festung" });
    await place(P4.dorf, "P4 Dorf Eins", "dorf", 140, 120);
    const dorfHandtext = await place(P4.dorfHandtext, "P4 Dorf Handtext", "dorf", 141, 121);
    const dorfAdresse = await place(P4.dorfAdresse, "P4 Dorf Adresse", "kleinstadt", 142, 122);
    await place(P4.dorfVerborgen, "P4 Dorf Verborgen", "dorf", 143, 123, { hidden: true });
    const zwillingA = await place(P4.zwillingA, "P4 Zwilling A", "dorf", 144, 124);
    const zwillingB = await place(P4.zwillingB, "P4 Zwilling B", "dorf", 145, 125);
    const fasarOrt = await place(P4.fasarOrt, "P4 Fasar", "stadt", 146, 126);
    await place(P4.dorfOsten, "P4 Dorf Osten", "dorf", 180, 150);

    // Der Wiki-Stand von Gareth und von Fasar (ein Ort mit gleichem Schlüssel wie das Gebiet).
    const garethSnapshot = (
        await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, description, einwohner, oberhaupt, region_text,
                                                  staat_text, handelszone, verkehrswege, bevoelkerung, tempel, building_type, is_ruined, synced_at)
            VALUES ('p4t-gareth', ${`${WIKI}P4_Gareth`}, 'P4 Gareth', 'P4 Gareth', 'Wiki-Beschreibung Gareth. Zweiter Satz des Wikis.', '50000', 'Wiki-Oberhaupt',
                    'Garetien', 'Mittelreich', 'Handelszone Test', 'P4 Reichsstraße 1, P4 Waldweg, P4 Pilgerweg und der Große Fluss', '50.000 Einwohner', 'Praios',
                    'Stadt', FALSE, ${SYNCED})
            RETURNING id::text
        `
    )[0]?.id as string;
    await database`
        INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        VALUES (${gareth}, ${`${WIKI}P4_Gareth`}, ${garethSnapshot}, 'assigned', 'unknown')
    `;
    await database`
        INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin, lage_origin, oberhaupt_origin)
        VALUES (${gareth}, 'Direkte Beschreibung (schlägt das Wiki)', '60000', 'Direkte Lage', NULL, 'manual', 'wiki', NULL)
    `;
    await database`
        INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin, lage_origin, oberhaupt_origin)
        VALUES (${dorfHandtext}, 'Ein Dorf mit Handtext.', '120', NULL, NULL, NULL, NULL, NULL)
    `;
    await database`
        INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        VALUES (${dorfAdresse}, ${`${WIKI}P4_Dorf_Adresse`}, NULL, 'address_only', 'unknown'),
               (${zwillingA}, ${`${WIKI}P4_Rathila`}, NULL, 'address_only', 'unknown'),
               (${zwillingB}, ${`${WIKI}P4_Rathila`}, NULL, 'address_only', 'unknown')
    `;
    const fasarSnapshot = (
        await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, description, synced_at)
            VALUES ('p4t-fasar', ${`${WIKI}P4_Fasar`}, 'P4 Fasar', 'Fasar der Ort', ${SYNCED})
            RETURNING id::text
        `
    )[0]?.id as string;
    await database`
        INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        VALUES (${fasarOrt}, ${`${WIKI}P4_Fasar`}, ${fasarSnapshot}, 'assigned', 'unknown')
    `;

    // ---- Medien: Wappen und zwei Kopfbilder (der Media Core hat den Lesepfad, hier nur Zeilen) -------------------------------
    const OWN = { basis: "own_work", clearance: "cleared" } as const;
    const coat = await insertAsset(database, {
        ref: "p4-coat",
        rights: OWN,
        published: [{ variant: PUBLISHED_VARIANT.coat }],
    });
    const headerEins = await insertAsset(database, {
        ref: "p4-header-1",
        rights: OWN,
        published: [{ variant: PUBLISHED_VARIANT.header, width: 1600, height: 900 }],
    });
    const headerZwei = await insertAsset(database, {
        ref: "p4-header-2",
        rights: OWN,
        published: [{ variant: PUBLISHED_VARIANT.header, width: 1600, height: 900 }],
    });
    await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${gareth}, ${coat.id}, 'coat', 'legacy')`;
    const gallery = await insertGallery(database, "p4-gallery");
    await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${gareth}, ${gallery.id}, 'header', 'legacy')`;
    await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${gallery.id}, ${headerEins.id}, 1), (${gallery.id}, ${headerZwei.id}, 2)`;

    // ---- Landschaften -------------------------------------------------------------------------------------------------------
    const region = async (
        publicId: string,
        name: string,
        layer: string,
        type: string | null,
        wkt: string,
        extra: { wikiUrl?: string; wikiKey?: string } = {},
    ): Promise<string> => {
        const regionId = remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url, wiki_region_key, is_active, source_system)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, ${layer}, ${type}, ${extra.wikiUrl ?? null}, ${extra.wikiKey ?? null}, TRUE, 'test')
                RETURNING id::text
            `,
        );
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (gen_random_uuid(), ${MAP_DOMAIN}, ${regionId}, ST_GeomFromText(${wkt}, 0), TRUE)
        `;
        return regionId;
    };
    await region(P4.wald, "P4 Waldwildnis", "vegetation", "wald", rect(106, 106, 145, 135), {
        wikiUrl: `${WIKI}P4_Waldwildnis`,
        wikiKey: "p4t-waldwildnis",
    });
    await region(P4.huegel, "P4 Hügel der Brinaskquelle", "topographie", "huegel", rect(104, 104, 112, 112));
    await region(P4.see, "P4 Testsee", "topographie", "see", rect(135, 125, 145, 135));
    await region(P4.archipelA, "P4 Archipel", "topographie", "insel", rect(100, 170, 104, 174), {
        wikiUrl: `${WIKI}P4_Archipel`,
    });
    await region(P4.archipelB, "P4 Archipel", "topographie", "insel", rect(110, 170, 114, 174), {
        wikiUrl: `${WIKI}P4_Archipel`,
    });
    await region(P4.griff, "Wald-925", "vegetation", "wald", rect(170, 110, 175, 115));
    // Eine ungültige Fläche aus Legacy: eine Schleife, die sich selbst schneidet.
    await region(
        P4.schleife,
        "P4 Schleife",
        "vegetation",
        "wald",
        "POLYGON((150 105,160 115,160 105,150 115,150 105))",
    );
    await region(P4.meer, "P4 Meer", "topographie", "meer", rect(100, 160, 190, 200));
    // Eine derographische Landschaft ohne Art (wie „Herz des Kontinents“ in Legacy): ihr Eintrag im Kontext trägt keine Art.
    await region(P4.landstrich, "P4 Landstrich", "derographisch", null, rect(170, 140, 190, 160));
    await region(P4.nordwald, "P4 Nordwald", "vegetation", "wald", rect(170, 120, 185, 140), {
        wikiUrl: `${WIKI}P4_Waldwildnis`,
        wikiKey: "p4t-waldwildnis",
    });
    await database`
        INSERT INTO map_label (public_id, map_domain_id, region_id, name, subtype, geom)
        VALUES (${P4.labelWald}, ${MAP_DOMAIN}, ${ids[P4.wald] as string}, 'P4 Waldwildnis', 'wald', ST_SetSRID(ST_MakePoint(125, 120), 0))
    `;
    const waldSnapshot = (
        await database<{ id: string }[]>`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, continent, region_parent, affiliation_staat, einwohner, sprache,
                                              vegetation, verkehrswege, description, synced_at)
            VALUES ('p4t-waldwildnis', ${`${WIKI}P4_Waldwildnis`}, 'P4 Waldwildnis', 'Wald', 'Aventurien', 'Garetien', 'Mittelreich', 'Köhler',
                    'Garethi', 'Mischwald', 'Ein Waldweg', 'Ein dichter Wald.', ${SYNCED})
            RETURNING id::text
        `
    )[0]?.id as string;
    await database`
        INSERT INTO wiki_region_snapshot_neighbor (snapshot_id, direction, position, name)
        VALUES (${waldSnapshot}, 'O', 1, 'Ostmark'), (${waldSnapshot}, 'N', 0, 'Nordland'), (${waldSnapshot}, 'O', 0, 'Ostland')
    `;
    await database`INSERT INTO wiki_region_snapshot_synonym (snapshot_id, position, text) VALUES (${waldSnapshot}, 0, 'Alter Wald')`;

    // ---- Gipfel -------------------------------------------------------------------------------------------------------------
    const peak = remember(
        P4.gipfel,
        await database<{ id: string }[]>`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, is_active, source_system)
            VALUES (${P4.gipfel}, ${MAP_DOMAIN}, 'P4 Gipfel', 'berggipfel', ST_SetSRID(ST_MakePoint(110, 112), 0), 10, TRUE, 'test')
            RETURNING id::text
        `,
    );
    remember(
        P4.gipfelFrei,
        await database<{ id: string }[]>`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, is_active, source_system)
            VALUES (${P4.gipfelFrei}, ${MAP_DOMAIN}, 'P4 Vulkan', 'vulkan', ST_SetSRID(ST_MakePoint(150, 150), 0), 20, TRUE, 'test')
            RETURNING id::text
        `,
    );
    const peakSnapshot = (
        await database<{ id: string }[]>`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, description, synced_at)
            VALUES ('p4t-gipfel', ${`${WIKI}P4_Gipfel`}, 'P4 Gipfel', 'Ein hoher Gipfel.', ${SYNCED})
            RETURNING id::text
        `
    )[0]?.id as string;
    await database`
        INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        VALUES (${peak}, ${`${WIKI}P4_Gipfel`}, ${peakSnapshot}, 'assigned', 'unknown')
    `;

    // ---- Wege ---------------------------------------------------------------------------------------------------------------
    const path = async (
        publicId: string,
        name: string,
        subtype: string,
        [x0, y0, x1, y1]: [number, number, number, number],
    ): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, ${subtype}, FALSE,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0), 'test', TRUE)
                RETURNING id::text
            `,
        );
    const w1 = await path(P4.flussEins, "P4 Großfluss", "Flussweg", [105, 108, 125, 108]);
    const w2 = await path(P4.flussZwei, "P4 Großfluss", "Flussweg", [125, 108, 145, 108]);
    const w3 = await path(P4.flussDrei, "P4 Großfluss", "Flussweg", [145, 108, 175, 108]);
    const w4 = await path(P4.strasseEins, "P4 Strasse Eins", "Strasse", [100, 150, 115, 150]);
    const w5 = await path(P4.strasseZwei, "P4 Strasse Eins", "Strasse", [115, 150, 135, 150]);
    await path(P4.waldwegEins, "P4 Waldweg", "Weg", [120, 120, 125, 120]);
    await path(P4.waldwegZwei, "P4 Waldweg", "Weg", [125, 120, 130, 121]);
    await path(P4.einzel, "Weg-5", "Weg", [150, 130, 152, 130]);
    await path(P4.waldwegPfad, "P4 Waldweg", "Pfad", [140, 140, 145, 140]);
    const w10 = await path(P4.jennbach, "P4 Jennbach", "Flussweg", [160, 130, 170, 130]);
    // Ein Fluss, der nur zum Teil einem Artikel zugeordnet ist: der kleinste Abschnitt trägt keine Zuordnung.
    await path(P4.mischEins, "P4 Mischfluss", "Flussweg", [160, 150, 165, 150]);
    const m2 = await path(P4.mischZwei, "P4 Mischfluss", "Flussweg", [165, 150, 170, 150]);
    const m3 = await path(P4.mischDrei, "P4 Mischfluss", "Flussweg", [170, 150, 175, 150]);

    const pathSnapshot = async (
        key: string,
        fields: { name: string; kind: string; art: string; description?: string; lean?: boolean },
    ): Promise<string> =>
        (
            await database<{ id: string }[]>`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art, lage, laenge, verlauf, description, is_lean, synced_at)
                VALUES (${key}, ${`${WIKI}${key}`}, ${fields.name}, ${fields.kind}, ${fields.art},
                        ${fields.lean ? null : "Lage des Wegs"}, ${fields.lean ? null : "100 Meilen"}, ${fields.lean ? null : "Von West nach Ost"},
                        ${fields.description ?? null}, ${fields.lean === true}, ${fields.lean ? null : SYNCED})
                RETURNING id::text
            `
        )[0]?.id as string;
    const fluss = await pathSnapshot("p4t-grossfluss", {
        name: "P4 Großfluss",
        kind: "fluss",
        art: "Fluss",
        description: "Der Große Fluss.",
    });
    const strasse = await pathSnapshot("p4t-strasse-eins", {
        name: "P4 Straße Eins",
        kind: "strasse",
        art: "Reichsstraße",
        description: "Eine Straße.",
    });
    const misch = await pathSnapshot("p4t-mischfluss", {
        name: "P4 Mischfluss",
        kind: "fluss",
        art: "Fluss",
        description: "Ein Fluss mit Lücke.",
    });
    const nurWeiter = await pathSnapshot("p4t-nur-weiter", {
        name: "P4 Pilgerweg",
        kind: "strasse",
        art: "Pilgerweg",
        lean: true,
    });
    const assign = (pathId: string, role: "main" | "further", url: string, snapshot: string | null): Promise<unknown> =>
        database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            VALUES (${pathId}, ${role}, ${url}, ${snapshot}, ${snapshot === null ? "address_only" : "assigned"}, 'legacy_editor')
        `;
    await assign(w1, "main", `${WIKI}p4t-grossfluss`, fluss);
    await assign(w2, "main", `${WIKI}p4t-grossfluss`, fluss);
    await assign(w3, "main", `${WIKI}p4t-grossfluss`, fluss);
    await assign(w4, "main", `${WIKI}p4t-strasse-eins`, strasse);
    await assign(w5, "main", `${WIKI}p4t-strasse-eins`, strasse);
    await assign(w4, "further", `${WIKI}p4t-nur-weiter`, nurWeiter);
    await assign(w10, "main", `${WIKI}P4_Jennbach`, null);
    await assign(m2, "main", `${WIKI}p4t-mischfluss`, misch);
    await assign(m3, "main", `${WIKI}p4t-mischfluss`, misch);

    // ---- Kraftlinien ---------------------------------------------------------------------------------------------------------
    const line = async (
        publicId: string,
        name: string,
        [x0, y0, x1, y1]: [number, number, number, number],
    ): Promise<string> =>
        remember(
            publicId,
            await database<{ id: string }[]>`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system, legacy_public_id)
                VALUES (${publicId}, ${MAP_DOMAIN}, ${name}, FALSE, ${P4.gareth}, ${P4.dorf},
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0),
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0), 'test', ${publicId})
                RETURNING id::text
            `,
        );
    const l1 = await line(P4.linieEins, "P4 Kraftlinie", [101, 101, 111, 111]);
    const l2 = await line(P4.linieZwei, "P4 Kraftlinie", [111, 111, 121, 121]);
    await line(P4.linieDrei, "P4 Linie", [131, 131, 141, 141]);
    await line(P4.linieVier, "P4 Linie", [141, 141, 151, 151]);
    await line(P4.linieEinzel, "P4 Einzellinie", [120, 140, 125, 145]);
    const lineSnapshot = (
        await database<{ id: string }[]>`
            INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, staerke, affinitaet, laenge, regionen, verlauf, description)
            VALUES ('p4t-kraftlinie', ${`${WIKI}P4_Kraftlinie`}, 'P4 Kraftlinie', 'stark', 'Humus', '50 Meilen', 'Garetien', 'Von Süd nach Nord', 'Eine Kraftlinie.')
            RETURNING id::text
        `
    )[0]?.id as string;
    await database`
        INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        VALUES (${l1}, ${`${WIKI}P4_Kraftlinie`}, ${lineSnapshot}, 'assigned', 'unknown'),
               (${l2}, ${`${WIKI}P4_Kraftlinie`}, ${lineSnapshot}, 'assigned', 'unknown')
    `;

    // Die Zuordnung (X2) und Gareths Linkziele (X1) mit dem echten Importer: Verlinkt wird nur über den Wiki-Key (WI-0063 27.12).
    await importP4WikiLinks(database);

    await insertSources(database, ids);
    return { ids };
}

/** Quellen und Kanon: Gareth trägt drei, das Gebiet, die Landschaft, der Fluss und der Gipfel je eigene - keine wird vererbt. */
async function insertSources(database: Queryable, ids: Record<string, string>): Promise<void> {
    await database`
        INSERT INTO source_corpus (corpus_key, label, form, license_statement, license_key, attribution, source_system)
        VALUES ('p4test.example', 'P4 Testkorpus', 'belegstelle', 'license', 'cc-by-nc-sa-3.0', 'P4 Korpus', 'test')
    `;
    // Der Schlüssel einer Quelle mit Adresse ist der Hash der Adresse (CHECK `feature_source_url_is_the_key`): in SQL gerechnet.
    const withUrl = async (
        title: string,
        url: string,
        extra: { official: boolean; type: string; license?: string; attribution?: string; corpus?: boolean },
    ): Promise<string> =>
        (
            await database<{ id: string }[]>`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, license_statement, license_key,
                                            attribution, corpus_key, source_system)
                VALUES ('url:' || encode(sha256(convert_to(${url}::text, 'UTF8')), 'hex'), 'final', ${url}, ${title}, ${extra.type}, ${extra.official},
                        ${extra.license === undefined ? "unrecorded" : "license"}, ${extra.license ?? null}, ${extra.attribution ?? null},
                        ${extra.corpus === true ? "p4test.example" : null}, 'test')
                RETURNING id::text
            `
        )[0]?.id as string;
    const eins = await withUrl("P4T Quelle Eins", "https://p4test.example/eins", {
        official: true,
        type: "regionalspielhilfe",
        license: "cc-by-nc-sa-3.0",
        attribution: "Autor Eins",
        corpus: true,
    });
    const zwei = (
        await database<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, legacy_source_id, url, title, source_type, is_official, source_system)
            VALUES ('legacy-id:6400002', 'provisional', 6400002, NULL, 'P4T Quelle Zwei', 'briefspiel', FALSE, 'test')
            RETURNING id::text
        `
    )[0]?.id as string;
    const drei = await withUrl("P4T Quelle Drei", "https://p4test.example/drei", {
        official: false,
        type: "abenteuer",
    });

    const link = (
        table: string,
        column: string,
        carrier: string,
        sourceId: string,
        position: number,
        extra: { kind?: string; pages?: string; note?: string } = {},
    ): Promise<unknown> =>
        database.unsafe(
            `INSERT INTO ${table} (${column}, source_id, reference_kind, pages, note, position, state)
             VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
            [carrier, sourceId, extra.kind ?? null, extra.pages ?? null, extra.note ?? null, position],
        );
    // Gareth: drei Quellen in der Reihenfolge von Legacy.
    const gareth = ids[P4.gareth] as string;
    await link("place_source", "place_id", gareth, eins, 0, { pages: "S. 12", note: "Hauptstadt" });
    await link("place_source", "place_id", gareth, zwei, 1, { kind: "ausfuehrlich" });
    await link("place_source", "place_id", gareth, drei, 2, { kind: "erwaehnung", pages: "S. 3" });
    // Das Gebiet, die Landschaft, der Gipfel: je eine eigene, die Gareth NICHT erbt.
    await link("territory_source", "territory_id", await territoryId(database, P4.provinzWest), eins, 0);
    await link("region_source", "region_id", ids[P4.wald] as string, zwei, 0);
    await link("terrain_peak_source", "terrain_peak_id", ids[P4.gipfel] as string, zwei, 0);
    // Der Fluss: je Abschnitt ein Satz, die Gruppe liest die Vereinigung ohne Doppel.
    await link("path_source", "path_id", ids[P4.flussEins] as string, eins, 0);
    await link("path_source", "path_id", ids[P4.flussEins] as string, zwei, 1);
    await link("path_source", "path_id", ids[P4.flussZwei] as string, eins, 0);
    await link("path_source", "path_id", ids[P4.flussZwei] as string, zwei, 1);
    await link("path_source", "path_id", ids[P4.flussDrei] as string, eins, 0);
    await link("path_source", "path_id", ids[P4.flussDrei] as string, drei, 1);
    // Eine stillgelegte Verknüpfung und eine unterdrückte zählen nie.
    await database`
        INSERT INTO place_source (place_id, source_id, position, state, is_active, retired_at, retired_origin)
        VALUES (${ids[P4.dorf] as string}, ${eins}, 0, 'retired', FALSE, now(), 'import')
    `;

    // Kanon (D1, abgeleitet).
    await database`INSERT INTO place_canon (place_id, canon) VALUES (${gareth}, 'official')`;
    await database`
        INSERT INTO region_canon (region_id, canon, designator_type, designator_count, designator_label)
        VALUES (${ids[P4.wald] as string}, 'unofficial', 'briefspiel', 2, 'Wiki Aventurica')
    `;
    await database`INSERT INTO territory_canon (territory_id, canon) VALUES (${await territoryId(database, P4.reich)}, 'official')`;
    await database`INSERT INTO path_canon (path_id, canon) VALUES (${ids[P4.flussZwei] as string}, 'unlabelled')`;
    await database`INSERT INTO powerline_canon (powerline_id, canon) VALUES (${ids[P4.linieEins] as string}, 'official')`;
}

async function territoryId(database: Queryable, publicId: string): Promise<string> {
    const [row] = await database<{ id: string }[]>`SELECT id::text FROM territory WHERE public_id = ${publicId}::uuid`;
    if (!row) throw new Error(`Gebiet ${publicId} fehlt`);
    return row.id;
}

/** Entfernt alles, was diese Tests angelegt haben, in Fremdschlüsselreihenfolge. */
export async function cleanSubjectFixtures(database: Database): Promise<void> {
    // Medien zuerst: Ihre Löschungen räumen auch die Bindungen unserer Orte ab (Quellsystem `media-test`).
    await cleanMediaFixtures(database);
    const mine = (table: string): string => `(SELECT id FROM ${table} WHERE public_id::text LIKE '64000000-%')`;
    const sources = `(SELECT id FROM feature_source WHERE title LIKE 'P4T %')`;
    const territories = `SELECT id FROM territory WHERE public_id::text LIKE '64000000-%'`;
    const statements = [
        // Quellen und Kanon
        `DELETE FROM place_source WHERE place_id IN ${mine("place")} OR source_id IN ${sources}`,
        `DELETE FROM path_source WHERE path_id IN ${mine("path")} OR source_id IN ${sources}`,
        `DELETE FROM territory_source WHERE territory_id IN (${territories}) OR source_id IN ${sources}`,
        `DELETE FROM region_source WHERE region_id IN ${mine("region")} OR source_id IN ${sources}`,
        `DELETE FROM terrain_peak_source WHERE terrain_peak_id IN ${mine("terrain_peak")} OR source_id IN ${sources}`,
        `DELETE FROM feature_source WHERE title LIKE 'P4T %'`,
        `DELETE FROM source_corpus WHERE corpus_key = 'p4test.example'`,
        `DELETE FROM place_canon WHERE place_id IN ${mine("place")}`,
        `DELETE FROM path_canon WHERE path_id IN ${mine("path")}`,
        `DELETE FROM territory_canon WHERE territory_id IN (${territories})`,
        `DELETE FROM region_canon WHERE region_id IN ${mine("region")}`,
        `DELETE FROM terrain_peak_canon WHERE terrain_peak_id IN ${mine("terrain_peak")}`,
        `DELETE FROM powerline_canon WHERE powerline_id IN ${mine("powerline")}`,
        // Wiki-Zuordnungen und Schnappschüsse
        `DELETE FROM place_wiki_assignment WHERE place_id IN ${mine("place")}`,
        `DELETE FROM place_detail WHERE place_id IN ${mine("place")}`,
        `DELETE FROM path_wiki_assignment WHERE path_id IN ${mine("path")}`,
        `DELETE FROM terrain_peak_wiki_assignment WHERE terrain_peak_id IN ${mine("terrain_peak")}`,
        `DELETE FROM powerline_wiki_assignment WHERE powerline_id IN ${mine("powerline")}`,
        `DELETE FROM wiki_link_target WHERE page_id IN (SELECT id FROM wiki_link_page WHERE page_key LIKE 'wiki:p4%')`,
        `DELETE FROM wiki_link_page WHERE page_key LIKE 'wiki:p4%'`,
        `DELETE FROM wiki_key_assignment WHERE object_public_id::text LIKE '64000000-%'`,
        `DELETE FROM migration_run WHERE data_domain = 'wiki-link-targets' AND NOT EXISTS (SELECT 1 FROM wiki_key_assignment WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM wiki_link_page WHERE migration_run_id = migration_run.id)`,
        `DELETE FROM wiki_settlement_traffic_link WHERE snapshot_id IN (SELECT id FROM wiki_settlement_snapshot WHERE wiki_key LIKE 'p4t-%')`,
        `DELETE FROM wiki_settlement_snapshot WHERE wiki_key LIKE 'p4t-%'`,
        `DELETE FROM wiki_path_snapshot WHERE wiki_key LIKE 'p4t-%'`,
        `DELETE FROM wiki_region_snapshot_neighbor WHERE snapshot_id IN (SELECT id FROM wiki_region_snapshot WHERE wiki_key LIKE 'p4t-%')`,
        `DELETE FROM wiki_region_snapshot_synonym WHERE snapshot_id IN (SELECT id FROM wiki_region_snapshot WHERE wiki_key LIKE 'p4t-%')`,
        `DELETE FROM wiki_region_snapshot WHERE wiki_key LIKE 'p4t-%'`,
        `DELETE FROM wiki_powerline_snapshot WHERE wiki_key LIKE 'p4t-%'`,
        // Träger
        `DELETE FROM map_label WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM region_area WHERE region_id IN ${mine("region")}`,
        `DELETE FROM region WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM terrain_peak WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM powerline WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM path WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM place WHERE public_id::text LIKE '64000000-%'`,
        // Gebiete wie in den Tests der Ableitung
        `DELETE FROM territory_border WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_shape WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_display_area WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_claim WHERE territory_id IN (${territories})`,
        `DELETE FROM territory_area WHERE public_id::text LIKE '64000000-%'`,
        `UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM territory WHERE public_id::text LIKE '64000000-%'`,
        `DELETE FROM territory_state WHERE map_domain_id = '${MAP_DOMAIN}' AND source_stamp = '${STAMP}'`,
        `DELETE FROM migration_run WHERE data_domain = 'territories' AND source_ref LIKE 'territories_revision=${STAMP};%' AND NOT EXISTS (SELECT 1 FROM territory WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_area WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_claim WHERE migration_run_id = migration_run.id)`,
    ];
    for (const statement of statements) {
        await database.unsafe(statement);
    }
}
