import { createHash } from "node:crypto";
import type { Database } from "../../src/database.ts";
import { storageKey } from "../../src/media/storage.ts";

/**
 * Fixtures für die Tests von WI-0063 P8 gegen die gemeinsame Testdatenbank: die Katalogabschnitte des Infopanels - Spielliteratur
 * (D3, Migration 0068), Kartensammlung (D2, 0069) und Bewertungen (D4, 0075).
 *
 * Alle öffentlichen IDs tragen die Vorsilbe `80000000-`; damit räumt `cleanP8Fixtures` genau das weg, was diese Tests angelegt haben.
 * Die Welt liegt in einer eigenen Ecke der Karte (x 600 bis 660, y 400 bis 420).
 *
 *     P8 Stadt   ein reicher Ort: 4 Werke (zwei offen, zwei verdeckt), 3 Karten, 3 Bewertungen
 *     P8 Weiler  ein Ort ohne jeden Katalog - er bekommt keinen Abschnitt
 *     P8 Spoiler ein Ort, an dem NUR ein verdecktes Werk steht (Überschrift ohne Zahl)
 *     P8 Fluss   eine Weggruppe aus zwei Abschnitten; ein Werk hängt an jedem - die Gruppe zählt es EINMAL
 *
 * Seit MEDIA-M14 trägt die Welt auch Medien, und zwar GEMISCHT - das ist der Normalfall am echten Bestand (1.534 von 2.003 Werken
 * haben einen Umschlag, 363 von 543 Karten eine Vorschau):
 *
 *     P8 Neues Werk        Umschlag, freigegeben (Regel `fan_policy`/`literature_cover`, wie G1 = A)
 *     P8 Verdecktes Werk   Umschlag, freigegeben - er steht unter dem Deckel, nicht neben ihm
 *     P8 Altes Werk        Bindung OHNE veröffentlichte Datei: kein Bild, kein Fehler
 *     P8 Werk ohne Edition Bindung mit Datei, aber die Policy sagt NEIN (`permission` ohne Regel)
 *     P8 Karte Zwei        Vorschau, freigegeben
 *     P8 Karte Eins        gar keine Bindung
 *     P8 Karte Spoiler     Vorschau, freigegeben - unter dem Deckel
 *
 * Seit WI-0118 (die Fenster „Kartensammlung“ und „Literatur“) trägt die Welt auch, was nur die Fenster zeigen:
 *
 *     P8 Karte Zwei        ALLE Eigenschaften (Art, Farbmodus, offiziell, beschriftet, Maßstab, Zeitraum, Format, Zeichner, Verlag,
 *                          Auflösung, Notiz), zwei Typen, eine Quelle (der Band) und drei Fundstellen in falscher Reihenfolge
 *     P8 Karte Voll        Vorschau UND Vollbild (Regel `fan_policy`/`map_full`); P8 Karte Zwei hat nur die Vorschau
 *     P8 Neues Werk        Schlagworte, Schwierigkeit der Spielleitung, offiziell
 *     P8 Altes Werk        Schlagworte mit Doppelung, nur die Schwierigkeit der Spielenden, Jahr 1021
 */

export const P8_DOMAIN = "aventuria";
export const P8_STAMP = "pt-p8-catalogs";
/** Die Marke der Medien dieser Welt: Assets, Dateien und Regeln, die `cleanP8Fixtures` wieder entfernt. */
export const P8_MEDIA_SOURCE = "p8-media-test";

export const p8Id = (n: number): string => `80000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const P8 = {
    stadt: p8Id(0x01),
    weiler: p8Id(0x02),
    spoilerOrt: p8Id(0x03),
    flussEins: p8Id(0x81),
    flussZwei: p8Id(0x82),
    /** Werke: das neueste (DSA5), ein älteres (DSA4), ein verdecktes, eines ohne Edition, eines an der Weggruppe. */
    werkNeu: p8Id(0x11),
    werkAlt: p8Id(0x12),
    werkVerdeckt: p8Id(0x13),
    werkOhneEdition: p8Id(0x14),
    werkFluss: p8Id(0x15),
    werkNurSpoiler: p8Id(0x16),
    karteA: p8Id(0x21),
    karteB: p8Id(0x22),
    karteSpoiler: p8Id(0x23),
    karteVoll: p8Id(0x24),
} as const;

interface Werk {
    publicId: string;
    title: string;
    productType?: string;
    edition?: string | null;
    bfYear?: number | null;
    bfLabel?: string | null;
    containedIn?: string | null;
    wikiUrl?: string | null;
    linkUlisses?: string | null;
    linkFshop?: string | null;
    genre?: string | null;
    complexityGm?: string | null;
    complexityPl?: string | null;
    official?: boolean | null;
}

export async function insertP8Fixtures(database: Database): Promise<void> {
    await cleanP8Fixtures(database);

    const place = async (publicId: string, name: string, x: number, y: number): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${publicId}, ${P8_DOMAIN}, ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'test', TRUE)
            RETURNING id::text
        `;
        if (!row) throw new Error(`Ort ${publicId} nicht angelegt`);
        return row.id;
    };
    const stadt = await place(P8.stadt, "P8 Stadt", 600, 400);
    await place(P8.weiler, "P8 Weiler", 610, 400);
    const spoilerOrt = await place(P8.spoilerOrt, "P8 Spoiler", 620, 400);

    const path = async (publicId: string, x0: number, x1: number): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${publicId}, ${P8_DOMAIN}, 'P8 Fluss', 'Flussweg', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, 410), ST_MakePoint(${x1}, 410)), 0), 'test', TRUE)
            RETURNING id::text
        `;
        if (!row) throw new Error(`Weg ${publicId} nicht angelegt`);
        return row.id;
    };
    const flussEins = await path(P8.flussEins, 600, 610);
    const flussZwei = await path(P8.flussZwei, 610, 620);

    // ---- Spielliteratur (D3) ------------------------------------------------------------------------------------------------
    const werk = async (entry: Werk): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO adventure (public_id, title, product_type, edition, bf_year, bf_label, contained_in, wiki_url,
                                   link_ulisses, link_fshop, genre, complexity_gm, complexity_pl, is_official,
                                   source_system, is_active)
            VALUES (${entry.publicId}, ${entry.title}, ${entry.productType ?? "gruppenabenteuer"},
                    ${entry.edition ?? null}, ${entry.bfYear ?? null}, ${entry.bfLabel ?? null},
                    ${entry.containedIn ?? null}, ${entry.wikiUrl ?? null}, ${entry.linkUlisses ?? null},
                    ${entry.linkFshop ?? null}, ${entry.genre ?? null}, ${entry.complexityGm ?? null},
                    ${entry.complexityPl ?? null}, ${entry.official === undefined ? true : entry.official}, 'test', TRUE)
            RETURNING id::text
        `;
        if (!row) throw new Error(`Werk ${entry.publicId} nicht angelegt`);
        return row.id;
    };
    const neu = await werk({
        publicId: P8.werkNeu,
        title: "P8 Neues Werk",
        edition: "DSA5",
        wikiUrl: "https://de.wiki-aventurica.de/wiki/P8_Neues_Werk",
        linkUlisses: "https://ulisses-ebooks.de/p8-neu",
        linkFshop: "https://www.f-shop.de/p8-neu",
        genre: "Stadtabenteuer, Kriegsszenario",
        complexityGm: "hoch",
        complexityPl: "mittel",
    });
    const alt = await werk({
        publicId: P8.werkAlt,
        title: "P8 Altes Werk",
        productType: "regionalspielhilfe",
        edition: "DSA4",
        bfYear: 1021,
        bfLabel: "1021 BF",
        containedIn: "P8 Sammelband",
        wikiUrl: "https://de.wiki-aventurica.de/wiki/P8_Altes_Werk",
        linkFshop: "https://www.f-shop.de/p8-alt",
        genre: " Dungeon ,Dungeon, , Reise ",
        complexityPl: "niedrig",
        official: false,
    });
    const verdeckt = await werk({ publicId: P8.werkVerdeckt, title: "P8 Verdecktes Werk", edition: "DSA4.1" });
    const ohneEdition = await werk({ publicId: P8.werkOhneEdition, title: "P8 Werk ohne Edition" });
    const flussWerk = await werk({ publicId: P8.werkFluss, title: "P8 Flusswerk", edition: "DSA5" });
    const nurSpoiler = await werk({ publicId: P8.werkNurSpoiler, title: "P8 Nur Spoiler", edition: "DSA5" });

    let ordinal = 0;
    const ortszeile = async (
        adventureId: string,
        role: "start" | "play" | "covers",
        target: { place?: string; path?: string },
        name = "P8 Ziel",
    ): Promise<void> => {
        ordinal += 1;
        await database`
            INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role,
                                         target_state, resolved_by, place_id, path_id, source_system, is_active)
            VALUES (${adventureId}, ${ordinal}, ${ordinal}, ${name.toLowerCase()}, ${name}, ${role},
                    'resolved', 'public_id', ${target.place ?? null}, ${target.path ?? null}, 'test', TRUE)
        `;
    };
    await ortszeile(neu, "start", { place: stadt });
    await ortszeile(alt, "covers", { place: stadt });
    await ortszeile(verdeckt, "play", { place: stadt });
    await ortszeile(ohneEdition, "play", { place: stadt });
    // Dasselbe Werk zweimal am selben Ort, mit zwei Rollen: EIN Eintrag, und die offene Rolle gewinnt.
    await ortszeile(neu, "play", { place: stadt }, "P8 Zweitnennung");
    // Nur ein verdecktes Werk: Der Abschnitt entsteht, aber ohne Zahl.
    await ortszeile(nurSpoiler, "play", { place: spoilerOrt });
    // Die Weggruppe: dasselbe Werk an beiden Abschnitten, die Gruppe zählt es einmal.
    await ortszeile(flussWerk, "start", { path: flussEins });
    await ortszeile(flussWerk, "play", { path: flussZwei });

    // ---- Kartensammlung (D2) -----------------------------------------------------------------------------------------------
    interface Eigenschaften {
        art?: string;
        colorMode?: string;
        official?: boolean;
        labeled?: boolean;
        multilevel?: boolean;
        hasScale?: boolean;
        validFrom?: number;
        validTo?: number;
        format?: string;
        author?: string;
        publisher?: string;
        widthPx?: number;
        heightPx?: number;
        note?: string;
    }
    const karte = async (
        publicId: string,
        title: string,
        options: {
            spoiler?: boolean | null;
            find?: { label: string; url: string; paid?: boolean | null };
            props?: Eigenschaften;
        } = {},
    ): Promise<string> => {
        const eigen = options.props ?? {};
        const [row] = await database<{ id: string }[]>`
            INSERT INTO citymap (public_id, title, is_spoiler, art, color_mode, is_official, is_labeled, is_multilevel,
                                 has_scale, valid_from_bf, valid_to_bf, format, author, publisher, width_px, height_px,
                                 note, source_system, is_active)
            VALUES (${publicId}, ${title}, ${options.spoiler ?? null}, ${eigen.art ?? null}, ${eigen.colorMode ?? null},
                    ${eigen.official ?? null}, ${eigen.labeled ?? null}, ${eigen.multilevel ?? null},
                    ${eigen.hasScale ?? null}, ${eigen.validFrom ?? null}, ${eigen.validTo ?? null},
                    ${eigen.format ?? null}, ${eigen.author ?? null}, ${eigen.publisher ?? null},
                    ${eigen.widthPx ?? null}, ${eigen.heightPx ?? null}, ${eigen.note ?? null}, 'test', TRUE)
            RETURNING id::text
        `;
        if (!row) throw new Error(`Karte ${publicId} nicht angelegt`);
        if (options.find) {
            await database`
                INSERT INTO citymap_link (citymap_id, link_role, url, label, is_paid, position, source_system, is_active)
                VALUES (${row.id}, 'primary', ${options.find.url}, ${options.find.label},
                        ${options.find.paid ?? null}, 0, 'test', TRUE)
            `;
        }
        return row.id;
    };
    const karteA = await karte(P8.karteA, "P8 Karte Zwei", {
        find: { label: "Wiki Aventurica", url: "https://example.org/p8-zwei", paid: false },
        props: {
            art: "derographisch",
            colorMode: "farbig",
            official: true,
            labeled: false,
            hasScale: true,
            validFrom: 1027,
            validTo: 9999,
            format: "A2",
            author: "P8 Zeichner",
            publisher: "P8 Verlag",
            widthPx: 1240,
            heightPx: 896,
            note: "Format: A2 . Maßstab: Ja",
        },
    });
    // Die Quelle (der Band), zwei Typen und zwei weitere Fundstellen - bewusst in der FALSCHEN Reihenfolge angelegt: Die Antwort
    // sortiert nach Legacys Klickreihenfolge, nicht nach der Anlage.
    {
        const [quelle] = await database<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official,
                                        source_system)
            VALUES ('legacy-id:80000001', 'provisional', 80000001, 'P8 Band Eins', 'roman', TRUE, ${P8_MEDIA_SOURCE})
            RETURNING id::text
        `;
        const [zweite] = await database<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official,
                                        source_system)
            VALUES ('legacy-id:80000002', 'provisional', 80000002, 'P8 Band Zwei', 'roman', TRUE, ${P8_MEDIA_SOURCE})
            RETURNING id::text
        `;
        if (!quelle || !zweite) throw new Error("Quelle nicht angelegt");
        await database`
            INSERT INTO citymap_source (citymap_id, source_id, position, source_system)
            VALUES (${karteA}, ${zweite.id}, 1, 'test'), (${karteA}, ${quelle.id}, 0, 'test')
        `;
        await database`
            INSERT INTO citymap_type (citymap_id, type_key, source_system)
            VALUES (${karteA}, 'stadtplan', 'test'), (${karteA}, 'ortsplan', 'test')
        `;
        await database`
            INSERT INTO citymap_link (citymap_id, link_role, url, label, is_paid, position, source_system, is_active)
            VALUES (${karteA}, 'further', 'https://www.deviantart.com/p8/art/zwei', 'Karte', NULL, 0, 'test', TRUE),
                   (${karteA}, 'further', 'https://www.f-shop.de/p8-zwei', 'Karte', NULL, 1, 'test', TRUE)
        `;
    }
    // Ohne Fundstelle: Die Kachel bleibt Text.
    const karteB = await karte(P8.karteB, "P8 Karte Eins");
    const karteSpoiler = await karte(P8.karteSpoiler, "P8 Karte Spoiler", {
        spoiler: true,
        find: { label: "F-Shop", url: "https://example.org/p8-spoiler", paid: true },
    });
    // Die einzige Karte mit Vorschau UND Vollbild (am echten Bestand: Rhôndur).
    const karteVoll = await karte(P8.karteVoll, "P8 Karte Voll", {
        props: { art: "skizze", widthPx: 1240, heightPx: 896 },
    });

    let mapOrdinal = 0;
    const kartenzeile = async (citymapId: string, target: { place?: string; path?: string }): Promise<void> => {
        mapOrdinal += 1;
        await database`
            INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, raw_name, target_state,
                                       resolved_by, place_id, path_id, source_system, is_active)
            VALUES (${citymapId}, ${mapOrdinal}, ${mapOrdinal}, 'p8 ziel', 'P8 Ziel', 'resolved', 'public_id',
                    ${target.place ?? null}, ${target.path ?? null}, 'test', TRUE)
        `;
    };
    await kartenzeile(karteA, { place: stadt });
    await kartenzeile(karteB, { place: stadt });
    await kartenzeile(karteSpoiler, { place: stadt });
    await kartenzeile(karteVoll, { place: stadt });

    // ---- Bewertungen (D4) --------------------------------------------------------------------------------------------------
    const bewertung = async (
        legacyId: number,
        stars: number,
        at: string,
        over: { author?: string | null; body?: string | null; date?: string | null } = {},
    ): Promise<void> => {
        await database`
            INSERT INTO place_review (legacy_review_id, place_id, stars, author_name, body, dsa_date,
                                      legacy_created_at, source_system)
            VALUES (${legacyId}, ${stadt}, ${stars}, ${over.author ?? null}, ${over.body ?? null},
                    ${over.date ?? null}, ${at}::timestamp, 'test')
        `;
    };
    await bewertung(80_000_001, 5, "2026-01-01 10:00:00", {
        author: "P8 Erste",
        body: "Ein Gewimmel.",
        date: "3. Praios 1047 BF",
    });
    await bewertung(80_000_002, 4, "2026-02-01 10:00:00", { author: "P8 Zweite" });
    // Ohne Autor und ohne Text: der Leser schreibt „Anonym“ und lässt die Textzeile weg.
    await bewertung(80_000_003, 3, "2026-03-01 10:00:00");

    await insertP8Media(database, {
        werke: { neu, alt, verdeckt, ohneEdition },
        karten: { karteA, karteSpoiler, karteVoll },
    });
}

// ---- Medien (MEDIA-M14) ----------------------------------------------------------------------------------------------------

interface P8Carriers {
    werke: { neu: string; alt: string; verdeckt: string; ohneEdition: string };
    karten: { karteA: string; karteSpoiler: string; karteVoll: string };
}

/**
 * Die Medien der P8-Welt: zwei Freigaberegeln wie G1 = A (`fan_policy` für `literature_cover` und `map_preview`) und vier Assets,
 * die zusammen die vier Fälle abdecken, die der Lesepfad unterscheiden muss - freigegeben mit Datei, Bindung ohne Datei, Datei
 * ohne Freigabe, gar keine Bindung.
 */
async function insertP8Media(database: Database, carriers: P8Carriers): Promise<void> {
    // 🪤 Je (Basis, Lizenz, Rolle) darf nur EINE Regel offen stehen. Trägt die Datenbank sie schon - etwa nach einem echten
    // Medienimport -, bleibt es bei ihrer; sie sagt dasselbe, und die Aufräumung fasst sie nicht an.
    const rule = async (role: string, basis: string): Promise<void> => {
        await database`
            INSERT INTO publication_rule (rights_basis, license_key, role, scope_text, operator_quote, decided_on)
            SELECT ${basis}, NULL, ${role}, ${`${P8_MEDIA_SOURCE} ${basis}/${role}`}, 'Testzitat des Betreibers', '2026-10-05'
            WHERE NOT EXISTS (
                SELECT 1 FROM publication_rule p
                WHERE p.rights_basis = ${basis} AND p.license_key IS NULL AND p.role = ${role} AND p.revoked_on IS NULL
            )
        `;
    };
    await rule("literature_cover", "fan_policy");
    await rule("map_preview", "fan_policy");
    await rule("map_full", "fan_policy");

    /** Ein Asset mit Rechten und - sofern `variant` gesetzt - genau einer veröffentlichten Datei. */
    const asset = async (
        ref: string,
        rights: { basis: string; clearance: string },
        file: { variant: string; width: number; height: number } | null,
    ): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, technical_state, moderation_state, source_system, source_ref)
            VALUES ('image', 'legacy_import', 'ok', 'not_applicable', ${P8_MEDIA_SOURCE}, ${ref})
            RETURNING id
        `;
        if (!row) throw new Error(`Asset ${ref} nicht angelegt`);
        await database`
            INSERT INTO media_rights (media_asset_id, rights_basis, clearance_state)
            VALUES (${row.id}, ${rights.basis}, ${rights.clearance})
        `;
        if (file) {
            const sha256 = createHash("sha256").update(`${P8_MEDIA_SOURCE}/${ref}`).digest("hex");
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height,
                                        byte_size, sha256, derivative_recipe, recipe_version)
                VALUES (${row.id}, ${file.variant}, 'published', ${storageKey("published", sha256, "webp")}, 'image/webp',
                        ${file.width}, ${file.height}, 4321, ${sha256}, ${`${file.variant}-recipe`}, '1')
            `;
        }
        return row.id;
    };

    const fan = { basis: "fan_policy", clearance: "legacy_asserted" };
    const coverNeu = await asset("cover-neu", fan, { variant: "literature_cover", width: 424, height: 600 });
    const coverVerdeckt = await asset("cover-verdeckt", fan, { variant: "literature_cover", width: 408, height: 600 });
    // Eine Bindung, deren Asset noch keine Bytes hat (`technical_state` wäre `pending`, hier schlicht ohne Datei).
    const coverOhneDatei = await asset("cover-ohne-datei", fan, null);
    // Eine Datei, die die Policy NICHT freigibt: `permission` hat keine Regel - ein Bild, das nie erscheint.
    const coverGesperrt = await asset(
        "cover-gesperrt",
        { basis: "permission", clearance: "legacy_asserted" },
        { variant: "literature_cover", width: 400, height: 600 },
    );
    const vorschauA = await asset("vorschau-a", fan, { variant: "citymap_preview", width: 296, height: 400 });
    const vorschauSpoiler = await asset("vorschau-spoiler", fan, {
        variant: "citymap_preview",
        width: 272,
        height: 400,
    });
    const vorschauVoll = await asset("vorschau-voll", fan, { variant: "citymap_preview", width: 400, height: 289 });
    const vollbild = await asset("vollbild", fan, { variant: "citymap_full", width: 1240, height: 896 });

    const bindWerk = async (adventureId: string, assetId: string): Promise<void> => {
        await database`
            INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin)
            VALUES (${adventureId}, ${assetId}, 'literature_cover', 'legacy')
        `;
    };
    await bindWerk(carriers.werke.neu, coverNeu);
    await bindWerk(carriers.werke.verdeckt, coverVerdeckt);
    await bindWerk(carriers.werke.alt, coverOhneDatei);
    await bindWerk(carriers.werke.ohneEdition, coverGesperrt);

    const bindKarte = async (citymapId: string, assetId: string): Promise<void> => {
        await database`
            INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
            VALUES (${citymapId}, ${assetId}, 'map_preview', 'legacy')
        `;
    };
    await bindKarte(carriers.karten.karteA, vorschauA);
    await bindKarte(carriers.karten.karteSpoiler, vorschauSpoiler);
    await bindKarte(carriers.karten.karteVoll, vorschauVoll);
    await database`
        INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
        VALUES (${carriers.karten.karteVoll}, ${vollbild}, 'map_full', 'legacy')
    `;
}

/** Entfernt alles, was diese Tests angelegt haben, in Fremdschlüsselreihenfolge. */
export async function cleanP8Fixtures(database: Database): Promise<void> {
    const mine = (table: string): string => `(SELECT id FROM ${table} WHERE public_id::text LIKE '80000000-%')`;
    const myAssets = `(SELECT id FROM media_asset WHERE source_system = '${P8_MEDIA_SOURCE}')`;
    const myRules = `(SELECT id FROM publication_rule WHERE scope_text LIKE '${P8_MEDIA_SOURCE}%')`;
    const statements = [
        `DELETE FROM adventure_media WHERE adventure_id IN ${mine("adventure")} OR media_asset_id IN ${myAssets}`,
        `DELETE FROM citymap_media WHERE citymap_id IN ${mine("citymap")} OR media_asset_id IN ${myAssets}`,
        `DELETE FROM media_file WHERE media_asset_id IN ${myAssets}`,
        `DELETE FROM media_rights WHERE media_asset_id IN ${myAssets}`,
        // 💣 Die Belege gehen VOR Asset und Regel, auch wenn die Fixture selbst keinen anlegt: `seedPublicationRules` hängt den
        // Beleg der Fan-Richtlinie an die ÄLTESTE Regel je (Basis, Rolle) - nach einem abgebrochenen Lauf ist das unsere. Ohne
        // diese Zeile scheitert das Aufräumen an `media_rights_evidence_publication_rule_id_fkey`, und die Suite kommt nicht mehr
        // frei: sie räumt vor dem Anlegen auf (gemessen am 2026-10-07, `test/fixture-cleanup.test.ts`).
        `DELETE FROM media_rights_evidence WHERE media_asset_id IN ${myAssets} OR publication_rule_id IN ${myRules}`,
        `DELETE FROM media_asset WHERE source_system = '${P8_MEDIA_SOURCE}'`,
        `DELETE FROM publication_rule WHERE scope_text LIKE '${P8_MEDIA_SOURCE}%'`,
        `DELETE FROM place_review WHERE place_id IN ${mine("place")} OR legacy_review_id BETWEEN 80000000 AND 80999999`,
        `DELETE FROM adventure_place WHERE adventure_id IN ${mine("adventure")} OR place_id IN ${mine("place")} OR path_id IN ${mine("path")}`,
        `DELETE FROM adventure_link WHERE adventure_id IN ${mine("adventure")}`,
        `DELETE FROM adventure_field_origin WHERE adventure_id IN ${mine("adventure")}`,
        `DELETE FROM adventure WHERE public_id::text LIKE '80000000-%'`,
        `DELETE FROM citymap_place WHERE citymap_id IN ${mine("citymap")} OR place_id IN ${mine("place")} OR path_id IN ${mine("path")}`,
        `DELETE FROM citymap_link WHERE citymap_id IN ${mine("citymap")}`,
        `DELETE FROM citymap_source WHERE citymap_id IN ${mine("citymap")}`,
        `DELETE FROM citymap_type WHERE citymap_id IN ${mine("citymap")}`,
        `DELETE FROM citymap_related WHERE citymap_id IN ${mine("citymap")} OR related_citymap_id IN ${mine("citymap")}`,
        `DELETE FROM citymap WHERE public_id::text LIKE '80000000-%'`,
        `DELETE FROM feature_source WHERE source_system = '${P8_MEDIA_SOURCE}'`,
        `DELETE FROM path WHERE public_id::text LIKE '80000000-%'`,
        `DELETE FROM place WHERE public_id::text LIKE '80000000-%'`,
    ];
    for (const statement of statements) {
        await database.unsafe(statement);
    }
}
