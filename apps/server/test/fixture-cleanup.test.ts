import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { MEDIA_SOURCE_SYSTEM } from "../src/migration/media-legacy.ts";
import { cleanCatalogFixtures, insertCatalogCarriers } from "./support/catalog-fixture.ts";
import { cleanLoreFixtures, insertLoreFixtures } from "./support/lore-fixture.ts";
import {
    FIXTURE_SCOPE,
    FIXTURE_SOURCE,
    cleanMediaFixtures,
    insertAdventure,
    insertAsset,
    insertCitymap,
    insertGallery,
    insertPlace,
    insertRule,
    insertTerritory,
} from "./support/media-fixture.ts";
import { PREFIX as MEDIA_IMPORT_PREFIX, cleanLegacyMedia, insertSubjects } from "./support/media-import-fixture.ts";
import { cleanP3Fixtures, insertP3Carriers } from "./support/p3-fixture.ts";
import { cleanP7Fixtures, insertP7Fixtures } from "./support/p7-fixture.ts";
import { P8_MEDIA_SOURCE, cleanP8Fixtures, insertP8Fixtures } from "./support/p8-fixture.ts";
import { cleanSubjectFixtures, insertSubjectFixtures } from "./support/subject-fixture.ts";

/**
 * Die Aufräumer in `test/support` gegen einen Rest aus einem abgebrochenen Lauf (gemessen am 2026-10-07 in `avesmaps3d_test`).
 *
 * 🔴 Ein Aufräumer muss sich selbst befreien können. Bleibt nach einem Abbruch eine Freigaberegel der Fixture stehen, hängt
 * `seedPublicationRules` (`src/migration/media-rules.ts`) den Beleg der Fan-Richtlinie an die ÄLTESTE Regel je (Basis, Rolle) -
 * und das ist dann diese. Räumt der Aufräumer die Regel ohne ihre Belege ab, scheitert er am Fremdschlüssel
 * `media_rights_evidence_publication_rule_id_fkey`: `subjects-p8.test.ts` blieb dauerhaft rot, weil schon sein eigenes
 * Aufräumen scheiterte, und `media-resolver.test.ts` fand in fünf Fällen eine fremde aktive Regel vor.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Die Marke der P8-Medien als LIKE-Muster. */
const P8_SCOPE = `${P8_MEDIA_SOURCE}%`;

interface Reste {
    regeln: number;
    belege: number;
    assets: number;
}

describeWithDatabase("Die Aufräumer der Fixtures", () => {
    let database: Database;

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool wie in `subjects-p8.test.ts`: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
    }, 180_000);

    afterAll(async () => {
        await cleanP8Fixtures(database);
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    /** Was von der Marke der P8-Medien in der Datenbank steht - Regeln, ihre Belege und die Belege an ihren Assets. */
    const reste = async (): Promise<Reste> => {
        const [row] = await database<Reste[]>`
            SELECT (SELECT count(*)::int FROM publication_rule WHERE scope_text LIKE ${P8_SCOPE}) AS regeln,
                   (SELECT count(*)::int FROM media_rights_evidence e
                     WHERE e.publication_rule_id IN (SELECT id FROM publication_rule WHERE scope_text LIKE ${P8_SCOPE})
                        OR e.media_asset_id IN (SELECT id FROM media_asset WHERE source_system = ${P8_MEDIA_SOURCE})) AS belege,
                   (SELECT count(*)::int FROM media_asset WHERE source_system = ${P8_MEDIA_SOURCE}) AS assets
        `;
        if (!row) throw new Error("Zählung der Reste lieferte keine Zeile");
        return row;
    };

    it("🔴 cleanP8Fixtures nimmt die Belege an Regel und Asset mit und kommt wieder frei", async () => {
        await insertP8Fixtures(database);

        // 🪤 Trägt die Datenbank die Regeln für (fan_policy, literature_cover) und (fan_policy, map_preview) schon aus einem
        // echten Import, legt die Fixture keine eigene an. Diese widerrufene Regel der Marke gibt es deshalb immer: der Index
        // `publication_rule_one_active` greift nur bei `revoked_on IS NULL`, sie kollidiert also mit nichts.
        await database`
            INSERT INTO publication_rule (rights_basis, license_key, role, scope_text, operator_quote, decided_on,
                                          revoked_on, revoked_reason)
            VALUES ('fan_policy', NULL, 'map_full', ${`${P8_MEDIA_SOURCE} fan_policy/map_full`},
                    'Testzitat des Betreibers', '2026-10-05', '2026-10-06', 'Rest eines abgebrochenen Laufs')
        `;

        // Der Rest, wie er gemessen wurde: an jeder Regel der Fixture hängt der Beleg der Fan-Richtlinie, geschrieben von einem
        // späteren `migrate:media` - der die älteste Regel je (Basis, Rolle) sucht und diese fand.
        const anRegel = await database<{ id: string }[]>`
            INSERT INTO media_rights_evidence (publication_rule_id, evidence_kind, external_url, description, recorded_by)
            SELECT id, 'license_page', 'https://ulisses-spiele.de/fan-richtlinie/',
                   'Beleg eines späteren Medienimports an der Regel der Fixture', 'migrate:media'
            FROM publication_rule WHERE scope_text LIKE ${P8_SCOPE}
            RETURNING id::text
        `;
        // Und ein Beleg an einem Asset der Fixture: derselbe Fremdschlüssel, nur die andere Spalte.
        const amAsset = await database<{ id: string }[]>`
            INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, external_url, description, recorded_by)
            SELECT id, 'license_page', 'https://beleg.example/p8-rest', 'Beleg am Asset der Fixture', 'migrate:media'
            FROM media_asset WHERE source_system = ${P8_MEDIA_SOURCE} ORDER BY id LIMIT 1
            RETURNING id::text
        `;
        const belegIds = [...anRegel, ...amAsset].map((row) => row.id);

        const vorher = await reste();
        expect(vorher.assets).toBeGreaterThan(0);
        expect(vorher.regeln).toBeGreaterThan(0);
        // Mindestens der Beleg an der widerrufenen Regel und der am Asset; mit den Regeln der Fixture sind es mehr.
        expect(belegIds.length).toBeGreaterThanOrEqual(2);
        expect(vorher.belege).toBe(belegIds.length);

        // 💣 Ohne die Belegzeile im Aufräumer scheitert genau dieser Aufruf an
        // `media_rights_evidence_publication_rule_id_fkey`, und keine Suite kommt mehr frei.
        await expect(cleanP8Fixtures(database)).resolves.toBeUndefined();
        expect(await reste()).toEqual({ regeln: 0, belege: 0, assets: 0 });
        // Und die Belege sind wirklich weg, nicht bloß aus der Zählung gefallen, weil Regel und Asset fehlen.
        const [uebrig] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_rights_evidence WHERE id = ANY(${belegIds}::bigint[])
        `;
        expect(uebrig?.n).toBe(0);

        // Die Probe auf das, was der Suite fehlte: Nach dem Aufräumen baut sich die Welt wieder auf.
        await expect(insertP8Fixtures(database)).resolves.toBeUndefined();
        await cleanP8Fixtures(database);
    }, 120_000);

    // Der Sollfall am Vorbild: `cleanMediaFixtures` (und gleichlautend `cleanLegacyMedia`) nimmt die Belege schon mit. Die Regeln
    // sind die EINZIGEN Zeilen der Fixtures, an die ein fremder Schreiber etwas hängt, denn `publication_rule` hat genau ein
    // Kind (`media_rights_evidence`), und jeder andere Schreiber im Medienpfad wählt seine Assets über das eigene Quellsystem.
    it("🔴 cleanMediaFixtures nimmt den Beleg an seiner Regel ebenso mit", async () => {
        await cleanMediaFixtures(database);
        // Widerrufen, damit die Regel neben einer aktiven aus einem echten Import stehen kann (`publication_rule_one_active`).
        const ruleId = await insertRule(database, { basis: "fan_policy", role: "map_full", revokedOn: "2026-10-06" });
        const [beleg] = await database<{ id: string }[]>`
            INSERT INTO media_rights_evidence (publication_rule_id, evidence_kind, external_url, description, recorded_by)
            VALUES (${ruleId}, 'license_page', 'https://ulisses-spiele.de/fan-richtlinie/', 'Beleg an der Regel', 'migrate:media')
            RETURNING id::text
        `;
        if (!beleg) throw new Error("Beleg nicht angelegt");

        await expect(cleanMediaFixtures(database)).resolves.toBeUndefined();
        const [row] = await database<{ regeln: number; belege: number }[]>`
            SELECT (SELECT count(*)::int FROM publication_rule WHERE scope_text LIKE ${`${FIXTURE_SCOPE}%`}) AS regeln,
                   (SELECT count(*)::int FROM media_rights_evidence WHERE id = ${beleg.id}::bigint) AS belege
        `;
        expect(row).toEqual({ regeln: 0, belege: 0 });
    }, 120_000);
});

/**
 * Und dasselbe systematisch für ALLE acht Aufräumer in `test/support` (WI-0101).
 *
 * 🔴 Der Rundgang je Aufräumer ist immer derselbe und beantwortet die drei Fragen, an denen
 * `cleanP8Fixtures` am 2026-10-07 gescheitert war:
 * 1. läuft er auf einem Rest aus einem abgebrochenen Lauf überhaupt durch? (erster Aufruf, bevor
 *    irgendetwas angelegt ist)
 * 2. ist er VOLLSTÄNDIG? Nachgesehen wird nicht in einer Liste von Tabellen, sondern in JEDER
 *    Tabelle der Datenbank, die eine `public_id` trägt (aus `information_schema`), plus den Marken
 *    ohne `public_id` (Quellsystem, Wiki-Schlüssel, Regeltext, Korpus).
 * 3. kommt er wieder frei? (nach dem Aufräumen baut sich die Welt ein zweites Mal auf)
 *
 * 🪤 Die Tabellenliste kommt aus der Datenbank, nicht aus dem Testcode: eine neue Tabelle mit
 * `public_id` ist damit am Tag ihrer Migration mitgeprüft, ohne dass hier jemand eine Zeile nachträgt.
 */
describeWithDatabase("Jeder Aufräumer der Fixtures ist vollständig und kommt wieder frei", () => {
    let database: Database;
    /** Jede Tabelle mit einer `public_id`: die Liste, in der nach Resten gesucht wird. */
    let tablesWithPublicId: string[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        const rows = await database<{ table_name: string }[]>`
            SELECT c.table_name
            FROM information_schema.columns c
            JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = 'public' AND c.column_name = 'public_id' AND t.table_type = 'BASE TABLE'
            ORDER BY c.table_name
        `;
        tablesWithPublicId = rows.map((row) => row.table_name);
        // Ohne diese Liste prüft der Rundgang nichts: dann ist er FAIL, nicht grün (Kap. 11.155).
        expect(tablesWithPublicId.length).toBeGreaterThan(10);
    }, 180_000);

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    /** Was von einem `public_id`-Präfix noch irgendwo in der Datenbank steht, je Tabelle. */
    const leftoverRows = async (prefixes: string[]): Promise<Record<string, number>> => {
        const left: Record<string, number> = {};
        for (const table of tablesWithPublicId) {
            for (const prefix of prefixes) {
                const [row] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM ${database(table)} WHERE public_id::text LIKE ${`${prefix}%`}
                `;
                if ((row?.n ?? 0) > 0) left[`${table}:${prefix}`] = row?.n ?? 0;
            }
        }
        return left;
    };

    /** Eine Marke ohne `public_id`: Tabelle, Spalte und das LIKE-Muster, das nur die Fixture trifft. */
    type Mark = readonly [table: string, column: string, pattern: string];

    const leftoverMarks = async (marks: readonly Mark[]): Promise<Record<string, number>> => {
        const left: Record<string, number> = {};
        for (const [table, column, pattern] of marks) {
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM ${database(table)} WHERE ${database(column)}::text LIKE ${pattern}
            `;
            if ((row?.n ?? 0) > 0) left[`${table}.${column}`] = row?.n ?? 0;
        }
        return left;
    };

    interface Cleaner {
        name: string;
        /** Die `public_id`-Präfixe, die nur dieser Fixture gehören. */
        prefixes: string[];
        /** Marken ohne `public_id`. */
        marks: readonly Mark[];
        insert: (database: Database) => Promise<unknown>;
        clean: (database: Database) => Promise<void>;
    }

    const cleaners: Cleaner[] = [
        {
            name: "cleanCatalogFixtures",
            prefixes: ["68100000-", "69100000-", "68000000-"],
            marks: [
                ["wiki_settlement_snapshot", "wiki_key", "p68t-%"],
                ["wiki_path_snapshot", "wiki_key", "p68t-%"],
                ["wiki_region_snapshot", "wiki_key", "p68t-%"],
                ["feature_source", "title", "P69T%"],
            ],
            insert: insertCatalogCarriers,
            clean: cleanCatalogFixtures,
        },
        {
            name: "cleanLoreFixtures",
            prefixes: ["68100000-", "69100000-", "68000000-"],
            marks: [["feature_source", "title", "P74T%"]],
            insert: insertLoreFixtures,
            clean: cleanLoreFixtures,
        },
        {
            name: "cleanP3Fixtures",
            prefixes: ["63000000-"],
            marks: [
                ["wiki_settlement_snapshot", "wiki_key", "p3t-%"],
                ["wiki_region_snapshot", "wiki_key", "p3t-%"],
                ["wiki_path_snapshot", "wiki_key", "p3t-%"],
                ["feature_source", "title", "P3T%"],
                ["source_corpus", "corpus_key", "p3test.%"],
            ],
            insert: insertP3Carriers,
            clean: cleanP3Fixtures,
        },
        {
            name: "cleanP7Fixtures",
            prefixes: ["70000000-"],
            marks: [["wiki_path_snapshot", "wiki_key", "p7t-%"]],
            insert: insertP7Fixtures,
            clean: cleanP7Fixtures,
        },
        {
            name: "cleanP8Fixtures",
            prefixes: ["80000000-"],
            marks: [
                ["media_asset", "source_system", P8_MEDIA_SOURCE],
                ["publication_rule", "scope_text", `${P8_MEDIA_SOURCE}%`],
            ],
            insert: insertP8Fixtures,
            clean: cleanP8Fixtures,
        },
        {
            name: "cleanSubjectFixtures",
            prefixes: ["64000000-"],
            marks: [
                ["wiki_settlement_snapshot", "wiki_key", "p4t-%"],
                ["wiki_region_snapshot", "wiki_key", "p4t-%"],
                ["wiki_path_snapshot", "wiki_key", "p4t-%"],
                ["wiki_powerline_snapshot", "wiki_key", "p4t-%"],
                ["wiki_link_page", "page_key", "wiki:p4%"],
                ["feature_source", "title", "P4T %"],
                ["source_corpus", "corpus_key", "p4test.example"],
            ],
            insert: insertSubjectFixtures,
            clean: cleanSubjectFixtures,
        },
        {
            name: "cleanMediaFixtures",
            prefixes: ["6d656469-"],
            marks: [
                ["media_asset", "source_system", FIXTURE_SOURCE],
                ["media_gallery", "source_system", FIXTURE_SOURCE],
                ["publication_rule", "scope_text", `${FIXTURE_SCOPE}%`],
            ],
            // Ein Querschnitt der Fixture: Asset samt seiner veröffentlichten Datei (die legt `insertAsset`
            // selbst an, Variante `coat`), alle vier Träger, eine Galerie und eine Freigaberegel.
            insert: async (db) => {
                await insertAsset(db, { ref: "aufraeumer" });
                await insertPlace(db, 91);
                await insertTerritory(db, 91);
                await insertAdventure(db, 91);
                await insertCitymap(db, 91);
                await insertGallery(db, "aufraeumer");
                await insertRule(db, { basis: "fan_policy", role: "map_full", revokedOn: "2026-10-06" });
            },
            clean: cleanMediaFixtures,
        },
        {
            name: "cleanLegacyMedia",
            prefixes: [MEDIA_IMPORT_PREFIX],
            marks: [
                ["media_asset", "source_system", MEDIA_SOURCE_SYSTEM],
                ["media_gallery", "source_system", MEDIA_SOURCE_SYSTEM],
            ],
            insert: async (db) =>
                insertSubjects(db, { places: [91], territories: [91], adventures: [91], citymaps: [91] }),
            clean: cleanLegacyMedia,
        },
    ];

    it.each(cleaners)(
        "🔴 $name: läuft auf einem Rest durch, räumt restlos ab und lässt sich wieder aufbauen",
        async ({ prefixes, marks, insert, clean }) => {
            // 1. Ein Rest aus einem abgebrochenen Lauf darf ihn nicht aufhalten.
            await expect(clean(database)).resolves.toBeUndefined();

            // 2. Anlegen und restlos abräumen.
            await insert(database);
            await expect(clean(database)).resolves.toBeUndefined();
            expect(await leftoverRows(prefixes)).toEqual({});
            expect(await leftoverMarks(marks)).toEqual({});

            // 3. Und er kommt wieder frei: die Welt baut sich ein zweites Mal auf.
            await insert(database);
            await expect(clean(database)).resolves.toBeUndefined();
            expect(await leftoverRows(prefixes)).toEqual({});
        },
        180_000,
    );
});
