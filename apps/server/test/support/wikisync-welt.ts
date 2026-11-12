import { join } from "node:path";
import type { Database } from "../../src/database.ts";
import {
    baueKategorienSql,
    schreibeKategorienDatei,
    type FixtureKategorienZeile,
    type FixtureSeite,
} from "./wiki-dump-fixture.ts";

/**
 * Die erfundene Welt der Tests zur Übernahme des WikiSync für Orte, Wege, Gebiete, Landschaften (WI-0253 D-2) und Gipfel (Scheibe Gipfel): Objekte mit Zuordnungen, Wiki-Ständen und Vermerken, der Dump dazu und das
 * Kategorien-Datei dazu (Ortsgröße, Kontinent; WI-0294, vorher das Testwiki des Wiki-Teils). Gebaut von `wikisync-uebernahme-bereiche.test.ts` und `wikisync-steuerung-d2.test.ts` in ihrem eigenen Wegwerf-Cluster.
 */

export const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

export const uuid = (kopf: string, nummer: number): string =>
    `${kopf}0000000-0000-4000-8000-${String(nummer).padStart(12, "0")}`;
export const ID = {
    gareth: uuid("a", 1),
    havena: uuid("a", 2),
    fasar: uuid("a", 3),
    selem: uuid("a", 4),
    altHavena: uuid("a", 5),
    tempelort: uuid("a", 6),
    ludoo: uuid("a", 7),
    // Wege
    altA1: uuid("b", 1),
    altA2: uuid("b", 2),
    altA3: uuid("b", 3),
    mitteQ1: uuid("b", 4),
    mitteQ2: uuid("b", 5),
    mittelweg: uuid("b", 6),
    neuR1: uuid("b", 7),
    zwei: uuid("b", 8),
    // Gebiete
    weiden: uuid("c", 1),
    kosch: uuid("c", 2),
    greifen: uuid("c", 3),
    // Landschaften
    koschberge: uuid("d", 1),
    rahmen: uuid("d", 2),
    label1: uuid("e", 1),
    label2: uuid("e", 2),
    label3: uuid("e", 3),
    // Gipfel und Vulkane
    ingerimm: uuid("f", 1),
    rihutu: uuid("f", 2),
    nebel: uuid("f", 3),
    koschgipfel: uuid("f", 4),
};

export const DUMP: FixtureSeite[] = [
    // Orte
    {
        titel: "Gareth",
        ns: 0,
        text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n|Region=Garetien\n|Staat=Mittelreich\n|Oberhaupt=Kaiserin Rohaja\n}}\nGareth ist die Hauptstadt.",
    },
    {
        titel: "Havena",
        ns: 0,
        text: "{{Infobox Siedlung\n|Name=Havena\n|Einwohner=9.000\n}}\nHavena am Meer.",
    },
    { titel: "Fasar", ns: 0, text: "{{Infobox Siedlung\n|Name=Fasar\n|Einwohner=12.000\n}}\nFasar." },
    { titel: "Selem", ns: 0, text: "{{Infobox Siedlung\n|Name=Selem\n|Einwohner=300\n}}\nSelem." },
    { titel: "Alt Havena", ns: 0, text: "{{Infobox Siedlung\n|Name=Havena\n}}\nAlt Havena." },
    { titel: "Tempelhain", ns: 0, text: "{{Infobox Siedlung\n|Name=Tempelhain\n}}\nTempelhain." },
    { titel: "Ludoo", ns: 0, text: "{{Infobox Siedlung\n|Name=Ludoo\n}}\nLudoo." },
    // Wege
    {
        titel: "Reichsstraße 1",
        ns: 0,
        text: "{{Infobox Straße\n|Name=Reichsstraße 1\n|Art=Reichsstraße\n|Regionen=Garetien\n|Länge=120 Meilen\n|Verlauf=\n{{Straße|[[Gareth]]}}\n{{Straße|[[Havena]]}}\n}}\nDie erste Reichsstraße.",
    },
    {
        titel: "Mittelpfad",
        ns: 0,
        text: "{{Infobox Straße\n|Name=Mittelpfad\n|Art=Pfad\n}}\nDer Mittelpfad.",
    },
    {
        titel: "Neuer Weg",
        ns: 0,
        text: "{{Infobox Straße\n|Name=Mittelweg\n|Art=Weg\n}}\nDer neue Weg.",
    },
    {
        titel: "Weiterer Weg",
        ns: 0,
        text: "{{Infobox Straße\n|Name=Weiterer Weg\n|Art=Weg\n|Länge=3 Meilen\n}}\nDer weitere Weg.",
    },
    { titel: "Zweiter Weg", ns: 0, text: "{{Infobox Straße\n|Name=Zweiter Weg\n|Art=Pfad\n}}\nZwei." },
    // Gebiete
    {
        titel: "Herzogtum Weiden",
        ns: 0,
        text: "{{Infobox Staat\n|Name=Herzogtum Weiden\n|Herrschaftsform=Herzogtum Neu\n|Oberhaupt=Herzogin Neu\n|Sprache=Garethi\n}}\nWeiden.",
    },
    { titel: "Kosch", ns: 0, text: "{{Infobox Staat\n|Name=Kosch\n}}\nKosch." },
    { titel: "Greifenfurt", ns: 0, text: "{{Infobox Staat\n|Name=Greifenfurt\n}}\nGreifenfurt." },
    // Landschaften
    {
        titel: "Koschberge",
        ns: 0,
        text: "{{Infobox Region\n|Name=Koschberge\n|Art=Hochland\n|Nord=Weiden\n|Ost=Neu1, Neu2\n|Süd=Süd1\n}}\nDie Koschberge.",
    },
    {
        titel: "Aventurien (Kontinent)",
        ns: 0,
        text: "{{Infobox Region\n|Name=Aventurien-Neu\n|Art=Kontinent\n}}\nDer Kontinent.",
    },
    // Gipfel und Vulkane: dieselbe Infobox wie die Landschaft; die Höhe nennt das Wiki anders als die Karte.
    {
        titel: "Ingerimmsberg",
        ns: 0,
        text: "{{Infobox Region\n|Name=Ingerimmsberg\n|Art=Berg\n|Region=Ysilia\n|Höhe=1.100 Schritt\n|Nord=Neu1\n}}\nDer Ingerimmsberg ist ein Berg.",
    },
    {
        titel: "Rihutu",
        ns: 0,
        text: "{{Infobox Region\n|Name=Rihutu\n|Art=Vulkan|Magma\n|Region=Maraskan\n|Höhe=2.000\n}}\nEin Vulkan.",
    },
    { titel: "Nebelspitze", ns: 0, text: "{{Infobox Region\n|Name=Nebelspitze\n|Art=Berg\n}}\nIm Nebel." },
];

/** Die Kategorien der Seiten der Welt, die ihre Werte erst über das Wiki setzt (Ortsgrößen, Kontinente): dieselben, die vor WI-0294 das Testwiki lieferte. */
export const KATEGORIEN_DER_WELT: readonly (readonly [titel: string, kategorien: readonly string[]])[] = [
    ["Selem", ["Dorf"]],
    ["Tempelhain", ["Dorf"]],
    ["Havena", ["Großstadt"]],
    ["Gareth", ["Metropole (Siedlungsgröße)"]],
    ["Herzogtum Weiden", ["Staat", "Aventurien-Artikel"]],
    ["Kosch", ["Staat", "Aventurien-Artikel"]],
    ["Greifenfurt", ["Staat"]],
    ["Koschberge", ["Region", "Aventurien-Artikel"]],
    ["Aventurien (Kontinent)", ["Region"]],
];

/** Die Seitennummer einer Seite des Dumps, wie `baueDump` sie vergibt (`id` oder 1000 plus Stelle). */
export function seitenNummer(dump: readonly FixtureSeite[], titel: string): number {
    const stelle = dump.findIndex((seite) => seite.titel === titel);
    const seite = dump[stelle];
    if (seite === undefined) throw new Error(`Seite nicht im Dump: ${titel}`);
    return seite.id ?? 1000 + stelle;
}

/**
 * Legt die Kategorien-Datei zur Welt in den Dump-Ordner (WI-0294): `dump_categorylinks-20261001.sql.gz`, gleich alt wie der Dump `dewa_dump_small_20261001.xml`, mit den Kategorien aus
 * `KATEGORIEN_DER_WELT` (oder `kategorien`) für die Seiten des Dumps. Liefert den Pfad.
 */
export async function schreibeKategorienZurWelt(
    ordnerPfad: string,
    optionen: { dump?: readonly FixtureSeite[]; kategorien?: typeof KATEGORIEN_DER_WELT } = {},
): Promise<string> {
    const dump = optionen.dump ?? DUMP;
    const zeilen: FixtureKategorienZeile[] = (optionen.kategorien ?? KATEGORIEN_DER_WELT).flatMap(
        ([titel, kategorien]) =>
            kategorien.map((kategorie) => ({ von: seitenNummer(dump, titel), nach: kategorie.replaceAll(" ", "_") })),
    );
    const pfad = join(ordnerPfad, "dump_categorylinks-20261001.sql.gz");
    await schreibeKategorienDatei(pfad, baueKategorienSql(zeilen, { stand: "2026-10-01  4:00:00" }));
    return pfad;
}

let koordinate = 100;
const punkt = (): string => `ST_SetSRID(ST_MakePoint(${String((koordinate += 3))}, 120), 0)`;

export async function raeumeAb(admin: Database): Promise<void> {
    await admin`
        TRUNCATE map_audit_event, map_operation, wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_wiki_teil, wikisync_bereich_setting,
                 field_origin, settlement_place, place_detail, place_wiki_assignment, wiki_settlement_snapshot, place_unplaced, place, path_wiki_assignment, wiki_path_snapshot, path,
                 territory_detail_field_origin, territory_detail, wiki_territory_snapshot_unknown, wiki_territory_snapshot, territory,
                 terrain_peak_wiki_assignment, terrain_peak, wiki_region_snapshot_neighbor, wiki_region_snapshot, map_label, region_area, region,
                 wiki_key_assignment, wiki_landmarke_artikel, wiki_settlement_registry_named_place, wiki_settlement_registry
        RESTART IDENTITY CASCADE
    `;
    await admin`UPDATE wikisync_bereich_state SET revision = 1`;
    await admin`DELETE FROM job`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Welten
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function legeOrteAn(db: Database): Promise<void> {
    await db`
        INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_name, einwohner, oberhaupt, region_text, staat_text, settlement_class, settlement_class_guessed)
        VALUES ('gareth', ${wiki("Gareth")}, 'Gareht', '7.000', 'Kaiser Hal', 'Garetien', 'Mittelreich', 'dorf', TRUE),
               ('havena', ${wiki("Havena")}, 'Havena', NULL, NULL, NULL, NULL, 'stadt', FALSE),
               ('fasar', ${wiki("Fasar")}, 'Fasar', NULL, NULL, NULL, NULL, NULL, NULL),
               ('alt-havena', ${wiki("Alt Havena")}, 'Alt-Hav', NULL, NULL, NULL, NULL, NULL, NULL),
               ('tempelhain', ${wiki("Tempelhain")}, 'Tempelort', NULL, NULL, NULL, NULL, 'dorf', FALSE),
               ('ludoo', ${wiki("Ludoo")}, 'Ludoo', '100', NULL, NULL, NULL, NULL, NULL)
    `;
    const ort = async (id: string, name: string, groesse: string): Promise<void> => {
        await db`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom)
            VALUES (${id}, 'aventuria', ${name}, ${groesse}, ${db.unsafe(punkt())})
        `;
    };
    await ort(ID.gareth, "Gareht", "dorf");
    await ort(ID.havena, "Havena", "stadt");
    await ort(ID.fasar, "Fasar", "kleinstadt");
    await ort(ID.selem, "Selem", "dorf");
    await ort(ID.altHavena, "Alt-Hav", "stadt");
    await ort(ID.tempelort, "Tempelort", "dorf");
    await ort(ID.ludoo, "Ludoo", "dorf");
    const zuordnung = async (
        id: string,
        titel: string,
        snapshot: string | null,
        zustand = "assigned",
    ): Promise<void> => {
        await db`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, ${wiki(titel)}, (SELECT id FROM wiki_settlement_snapshot WHERE wiki_key = ${snapshot}), ${zustand}, 'legacy_editor'
              FROM place p WHERE p.public_id = ${id}
        `;
    };
    await zuordnung(ID.gareth, "Gareth", "gareth");
    await zuordnung(ID.havena, "Havena", "havena");
    await zuordnung(ID.fasar, "Fasar", "fasar");
    await zuordnung(ID.selem, "Selem", null, "address_only");
    await zuordnung(ID.altHavena, "Alt Havena", "alt-havena");
    await zuordnung(ID.tempelort, "Tempelhain", "tempelhain");
    await zuordnung(ID.ludoo, "Ludoo", "ludoo");
    // Einzelheiten: Gareth folgt dem Wiki bei den Einwohnern, die Lage ist eine eigene Entscheidung; Ludoo trägt nur die Einwohner (wiki).
    await db`
        INSERT INTO place_detail (place_id, einwohner, lage, einwohner_origin, lage_origin)
        SELECT id, '7.000', 'Mittelreich', 'wiki', 'manual' FROM place WHERE public_id = ${ID.gareth}
    `;
    await db`
        INSERT INTO place_detail (place_id, einwohner, einwohner_origin)
        SELECT id, '100', 'wiki' FROM place WHERE public_id = ${ID.ludoo}
    `;
    // Vermerke: Namen, die dem Wiki folgen; die Ortsgröße von Gareth folgt dem Wiki, die von Havena ist eine eigene Entscheidung. Havenas Name hat keinen Vermerk (unbekannt).
    await db`
        INSERT INTO field_origin (object_kind, object_id, field, origin)
        VALUES ('place', ${ID.gareth}, 'name', 'wiki'), ('place', ${ID.altHavena}, 'name', 'wiki'), ('place', ${ID.tempelort}, 'name', 'wiki'),
               ('place', ${ID.gareth}, 'subtype', 'wiki'), ('place', ${ID.havena}, 'subtype', 'manual')
    `;
    // Eine Stätte hängt am alten Namen des Tempelorts.
    await db`
        INSERT INTO settlement_place (settlement_key, settlement_name, name) VALUES ('tempelort', 'Tempelort', 'Schrein')
    `;
}

export async function legeWegeAn(db: Database, optionen: { nurSchnappschuss?: boolean } = {}): Promise<void> {
    await db`
        INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art, lage, laenge, verlauf, description, is_lean)
        VALUES ('reichsstrasse-1', ${wiki("Reichsstraße 1")}, 'Alte Reichsstrasse', 'strasse', 'Reichsstraße', 'Alt', '100 Meilen', 'Gareth', 'Alter Text', FALSE),
               ('mittelpfad', ${wiki("Mittelpfad")}, 'Mittelpfad-alt', 'strasse', 'Pfad', NULL, NULL, NULL, NULL, FALSE),
               ('neuer-weg', ${wiki("Neuer Weg")}, 'Neuer Weg alt', 'strasse', 'Weg', NULL, NULL, NULL, NULL, FALSE),
               ('weiterer-weg', ${wiki("Weiterer Weg")}, 'Weiterer Weg', 'strasse', 'Weg', NULL, NULL, NULL, NULL, TRUE),
               ('zweiter-weg', ${wiki("Zweiter Weg")}, 'Zweiter Weg alt', 'strasse', 'Pfad', NULL, NULL, NULL, NULL, FALSE)
    `;
    const abschnitt = async (id: string, name: string, art: string): Promise<void> => {
        const x = (koordinate += 3);
        await db`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${id}, 'aventuria', ${name}, ${art}, TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 200), ST_MakePoint(${x + 1}, 201)), 0), 'legacy', TRUE)
        `;
    };
    for (const id of [ID.altA1, ID.altA2, ID.altA3]) await abschnitt(id, "Alte Reichsstrasse", "Reichsstrasse");
    await abschnitt(ID.mitteQ1, "Mittelpfad-alt", "Pfad");
    await abschnitt(ID.mitteQ2, "Mittelpfad-alt", "Pfad");
    await abschnitt(ID.mittelweg, "Mittelweg", "Weg");
    await abschnitt(ID.neuR1, "Neuer Weg alt", "Weg");
    await abschnitt(ID.zwei, "Zweiter Weg alt", "Pfad");
    const haupt = async (ids: readonly string[], titel: string, snapshot: string): Promise<void> => {
        await db`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, 'main', ${wiki(titel)}, (SELECT id FROM wiki_path_snapshot WHERE wiki_key = ${snapshot}), 'assigned', 'legacy_editor'
              FROM path p WHERE p.public_id = ANY(${[...ids]}::uuid[])
        `;
    };
    await haupt([ID.altA1, ID.altA2, ID.altA3], "Reichsstraße 1", "reichsstrasse-1");
    // Nur ein Abschnitt der Straße „Mittelpfad-alt“ hängt am Artikel: Der Name würde die Straße zerreißen.
    await haupt([ID.mitteQ1], "Mittelpfad", "mittelpfad");
    await haupt([ID.neuR1], "Neuer Weg", "neuer-weg");
    await haupt([ID.zwei], "Zweiter Weg", "zweiter-weg");
    // Der zweite Abschnitt des Zweiten Wegs trägt zusätzlich einen schlanken Artikel als weitere Zuweisung.
    await db`
        INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
        SELECT p.id, 'further', ${wiki("Weiterer Weg")}, (SELECT id FROM wiki_path_snapshot WHERE wiki_key = 'weiterer-weg'), 'assigned', 'legacy_editor'
          FROM path p WHERE p.public_id = ${ID.zwei}
    `;
    // Die Namen folgen dem Wiki (in der Variante „nur Schnappschuss“ hat keiner einen Vermerk: Nur der Wiki-Wert hinter ↺ ändert sich).
    if (optionen.nurSchnappschuss !== true) {
        await db`
            INSERT INTO field_origin (object_kind, object_id, field, origin)
            SELECT 'path', t.id, 'name', 'wiki' FROM unnest(${[ID.altA1, ID.altA2, ID.altA3, ID.mitteQ1, ID.neuR1, ID.zwei]}::uuid[]) AS t(id)
        `;
    }
}

export async function legeGebieteAn(db: Database): Promise<void> {
    await db`
        INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_key, wiki_url)
        VALUES (${ID.weiden}, 'aventuria', 'Herzogtum Weiden', '#336699', 0.7, 'wiki:herzogtum-weiden', ${wiki("Herzogtum Weiden")}),
               (${ID.kosch}, 'aventuria', 'Kosch', '#996633', 0.7, 'wiki:kosch', ${wiki("Kosch")}),
               (${ID.greifen}, 'aventuria', 'Greifenfurt', '#663399', 0.7, 'wiki:greifenfurt', ${wiki("Greifenfurt")})
    `;
    // Weiden: Der Herrscher folgt dem Wiki; die Herrschaftsform ist ein Override (Legacy lieferte den Wiki-Wert nie: unbekannt); Gründung und Auflösung stimmen.
    await db`
        INSERT INTO wiki_territory_snapshot (wiki_key, ruler, founded_text, dissolved_text, continent, founder)
        VALUES ('wiki:herzogtum-weiden', 'Herzogin Alt', '0 BF', 'besteht', NULL, NULL),
               ('wiki:kosch', NULL, '0 BF', 'besteht', 'Tharun', NULL),
               ('wiki:greifenfurt', NULL, '0 BF', 'besteht', NULL, 'Alter Gründer')
    `;
    await db`
        INSERT INTO wiki_territory_snapshot_unknown (snapshot_id, field)
        SELECT id, 'form_of_government' FROM wiki_territory_snapshot WHERE wiki_key = 'wiki:herzogtum-weiden'
    `;
    await db`
        INSERT INTO territory_detail (territory_id, ruler, form_of_government, founded_text, dissolved_text)
        SELECT id, 'Herzogin Alt', 'Herzogtum', '0 BF', 'besteht' FROM territory WHERE public_id = ${ID.weiden}
    `;
    await db`
        INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
        SELECT d.id, v.feld, v.origin
          FROM territory_detail d JOIN territory t ON t.id = d.territory_id AND t.public_id = ${ID.weiden}
          CROSS JOIN (VALUES ('ruler', 'wiki'), ('form_of_government', 'override'), ('founded_text', 'wiki'), ('dissolved_text', 'wiki')) AS v(feld, origin)
    `;
    // Kosch: Der Kontinent folgt dem Wiki (Tharun -> Aventurien laut Kategorie), sonst nichts.
    await db`
        INSERT INTO territory_detail (territory_id, continent, founded_text, dissolved_text)
        SELECT id, 'Tharun', '0 BF', 'besteht' FROM territory WHERE public_id = ${ID.kosch}
    `;
    await db`
        INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
        SELECT d.id, v.feld, 'wiki'
          FROM territory_detail d JOIN territory t ON t.id = d.territory_id AND t.public_id = ${ID.kosch}
          CROSS JOIN (VALUES ('continent'), ('founded_text'), ('dissolved_text')) AS v(feld)
    `;
    // Greifenfurt: Der Gründer ist das einzige Feld des Satzes und folgt dem Wiki; das Wiki nennt ihn nicht mehr – der Satz legt sich still.
    await db`
        INSERT INTO territory_detail (territory_id, founder)
        SELECT id, 'Alter Gründer' FROM territory WHERE public_id = ${ID.greifen}
    `;
    await db`
        INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
        SELECT d.id, 'founder', 'wiki' FROM territory_detail d JOIN territory t ON t.id = d.territory_id AND t.public_id = ${ID.greifen}
    `;
}

export async function legeLandschaftenAn(db: Database): Promise<void> {
    await db`
        INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, continent)
        VALUES ('koschberge', ${wiki("Koschberge")}, 'Koschberg', 'Hochgebirge|Hochland-alt', NULL),
               ('aventurien', ${wiki("Aventurien (Kontinent)")}, 'Aventurien', 'Kontinent', NULL)
    `;
    await db`
        INSERT INTO wiki_region_snapshot_neighbor (snapshot_id, direction, position, name)
        SELECT s.id, v.richtung, v.position, v.name
          FROM wiki_region_snapshot s, (VALUES ('N', 0, 'Weiden'), ('O', 0, 'Alt1'), ('O', 1, 'Alt2')) AS v(richtung, position, name)
         WHERE s.wiki_key = 'koschberge'
    `;
    await db`
        INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url, wiki_region_key)
        VALUES (${ID.koschberge}, 'aventuria', 'Koschberg', 'topographie', 'gebirge', ${wiki("Koschberge")}, 'koschberge'),
               (${ID.rahmen}, 'aventuria', 'Aventurien', 'derographisch', 'kontinent', ${wiki("Aventurien (Kontinent)")}, 'aventurien')
    `;
    await db`
        INSERT INTO field_origin (object_kind, object_id, field, origin)
        VALUES ('landscape', ${ID.koschberge}, 'name', 'wiki'), ('landscape', ${ID.rahmen}, 'name', 'wiki')
    `;
    // Drei Beschriftungen: Eine folgt dem Namen, eine hat einen eigenen Text, bei einer ist es noch nicht festgehalten (dann folgt, wer genau den alten Namen trägt).
    const beschriftung = async (id: string, text: string, folgt: boolean | null): Promise<void> => {
        await db`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, text_follows_name, source_system)
            SELECT ${id}::uuid, 'aventuria', r.id, ${text}, ST_SetSRID(ST_MakePoint(${koordinate}, 300), 0), ${folgt}, 'legacy'
              FROM region r WHERE r.public_id = ${ID.koschberge}
        `;
        koordinate += 3;
    };
    await beschriftung(ID.label1, "Koschberg", true);
    await beschriftung(ID.label2, "Koschberg (Abschnitt)", false);
    await beschriftung(ID.label3, "Koschberg", null);
}

/**
 * Gipfel und Vulkane mit dem Wiki-Stand ihres Artikels (`wiki_region_snapshot`). Der Ingerimmsberg trägt eine Höhe (700, das Wiki sagt 1.100), der Vulkan Rihutu keine, die Nebelspitze hängt
 * nur mit einer Adresse am Artikel (kein Wiki-Stand).
 */
export async function legeGipfelAn(db: Database): Promise<void> {
    await db`
        INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, region_parent, description)
        VALUES ('ingerimmsberg', ${wiki("Ingerimmsberg")}, 'Ingerimm alt', 'Berggipfel|Felsformation', 'Kosch', 'Alter Text'),
               ('rihutu', ${wiki("Rihutu")}, 'Rihutu', 'Vulkan', NULL, NULL)
    `;
    await db`
        INSERT INTO wiki_region_snapshot_neighbor (snapshot_id, direction, position, name)
        SELECT id, 'N', 0, 'Alt' FROM wiki_region_snapshot WHERE wiki_key = 'ingerimmsberg'
    `;
    const gipfel = async (id: string, name: string, art: string, hoehe: number | null): Promise<void> => {
        await db`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${id}, 'aventuria', ${name}, ${art}, ${db.unsafe(punkt())}, ${hoehe})
        `;
    };
    await gipfel(ID.ingerimm, "Ingerimmsberg", "berggipfel", 700);
    await gipfel(ID.rihutu, "Rihutu", "vulkan", null);
    await gipfel(ID.nebel, "Nebelspitze", "berggipfel", 3000);
    const zuordnung = async (id: string, titel: string, snapshot: string | null): Promise<void> => {
        await db`
            INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT tp.id, ${wiki(titel)}, (SELECT id FROM wiki_region_snapshot WHERE wiki_key = ${snapshot}),
                   ${snapshot === null ? "address_only" : "assigned"}, 'unknown'
              FROM terrain_peak tp WHERE tp.public_id = ${id}
        `;
    };
    await zuordnung(ID.ingerimm, "Ingerimmsberg", "ingerimmsberg");
    await zuordnung(ID.rihutu, "Rihutu", "rihutu");
    await zuordnung(ID.nebel, "Nebelspitze", null);
}

/** Ein Gipfel, der den Artikel einer Landschaft teilt (ein Massiv und sein Hauptgipfel): Er hängt am Wiki-Stand der Koschberge. Nach `legeLandschaftenAn`. */
export async function legeKoschgipfelAn(db: Database): Promise<void> {
    await db`
        INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
        VALUES (${ID.koschgipfel}, 'aventuria', 'Koschgipfel', 'berggipfel', ${db.unsafe(punkt())}, 2500)
    `;
    await db`
        INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        SELECT tp.id, ${wiki("Koschberge")}, (SELECT id FROM wiki_region_snapshot WHERE wiki_key = 'koschberge'), 'assigned', 'unknown'
          FROM terrain_peak tp WHERE tp.public_id = ${ID.koschgipfel}
    `;
}
