import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TERRITORY_COATS_URL, mediaPublicUrl, parseTerritoryCoats, type TerritoryCoats } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import { resolveAllTerritoryCoats, resolveTerritoryCoats } from "../src/media/resolver.ts";
import {
    cleanMediaFixtures,
    insertAsset,
    insertTerritory,
    sha,
    type AssetSpec,
    type FixtureAsset,
} from "./support/media-fixture.ts";

/**
 * Die Wappenliste der Gebiete (WI-0121) gegen echtes PostgreSQL: welche Gebiete ein öffentliches Wappen tragen, wo das Bild
 * liegt, und dass dieselbe Entscheidung gilt wie für das Wappen im Infopanel.
 *
 * 🔴 Gefragt wird nach den Fixture-Gebieten (`6d656469-…`), nicht nach der ganzen Antwort: Die Testdatenbank kann fremde
 * Gebiete tragen, und ein Test, der „genau diese Liste“ verlangt, wäre von ihnen abhängig.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Verbindung selbst für die zählenden Ersatzverbindungen: Der Resolver liest darüber die Inhaltsschalter (WI-0127 SYS-10), einmal
 * je Aufruf und nie je Zeile; gezählt wird weiter nur `unsafe`, die Abfrage der Medien.
 */
const tagged =
    (database: Database) =>
    (strings: TemplateStringsArray, ...values: never[]): unknown =>
        database(strings, ...values);

const COAT = PUBLISHED_VARIANT.coat;
const OWN_CLEARED = { basis: "own_work", clearance: "cleared" } as const;
const FIXTURE_PREFIX = "6d656469-";

describeWithDatabase("Wappenliste der Gebiete (WI-0121)", () => {
    let database: Database;
    let app: ReturnType<typeof buildApp>;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanMediaFixtures(database);
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(testDatabaseUrl as string),
        });
    }, 120_000);

    afterAll(async () => {
        await app.close();
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanMediaFixtures(database);
    });

    afterEach(async () => {
        await cleanMediaFixtures(database);
    });

    const coatAsset = (ref: string, extra: Partial<AssetSpec> = {}): Promise<FixtureAsset> =>
        insertAsset(database, { ref, rights: OWN_CLEARED, published: [{ variant: COAT }], ...extra });

    const bindCoat = (territoryId: string, assetId: string): Promise<unknown> =>
        database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territoryId}, ${assetId}, 'coat', 'wiki_localized')`;

    async function fetchList(): Promise<{
        statusCode: number;
        list: TerritoryCoats;
        headers: Record<string, unknown>;
    }> {
        const response = await app.inject({ method: "GET", url: TERRITORY_COATS_URL });
        return {
            statusCode: response.statusCode,
            list: parseTerritoryCoats(response.json()),
            headers: response.headers,
        };
    }

    const ownCoats = (list: TerritoryCoats): Record<string, string> =>
        Object.fromEntries(Object.entries(list.coats).filter(([id]) => id.startsWith(FIXTURE_PREFIX)));

    it("🔴 nennt je Gebiet mit öffentlichem Wappen die Adresse des veröffentlichten Bildes - und kein anderes Gebiet", async () => {
        const mitWappen = await insertTerritory(database, 40);
        const ohneWappen = await insertTerritory(database, 41);
        const coat = await coatAsset("karte-a");
        await bindCoat(mitWappen.id, coat.id);

        const { statusCode, list } = await fetchList();
        expect(statusCode).toBe(200);
        const eigene = ownCoats(list);
        expect(Object.keys(eigene)).toEqual([mitWappen.publicId]);
        expect(eigene[mitWappen.publicId]).toBe(mediaPublicUrl(sha(`karte-a/${COAT}`)));
        // Ohne Wappen gibt es keinen Eintrag - kein leerer Wert, aus dem die Karte ein Loch bauen könnte.
        expect(list.coats[ohneWappen.publicId]).toBeUndefined();
    });

    it("🔴 dieselbe Entscheidung wie das Wappen im Infopanel: Sperre, Rückzug, fehlende Rechte und fehlende Datei nehmen es weg", async () => {
        const gebiete = {
            ok: await insertTerritory(database, 42),
            gesperrt: await insertTerritory(database, 44),
            zurueckgezogen: await insertTerritory(database, 45),
            ohneRechte: await insertTerritory(database, 46),
            ohneDatei: await insertTerritory(database, 47),
            pending: await insertTerritory(database, 48),
        };
        const bindings: [keyof typeof gebiete, Partial<AssetSpec>][] = [
            ["ok", {}],
            ["gesperrt", {}],
            ["zurueckgezogen", {}],
            ["ohneRechte", { rights: null }],
            ["ohneDatei", { published: [] }],
            ["pending", { technicalState: "pending" }],
        ];
        for (const [name, extra] of bindings) {
            await bindCoat(gebiete[name].id, (await coatAsset(`entscheid-${name}`, extra)).id);
        }
        await database`UPDATE territory_media SET publication_override = 'blocked' WHERE territory_id = ${gebiete.gesperrt.id}`;
        await database`UPDATE territory_media SET retired_at = now() WHERE territory_id = ${gebiete.zurueckgezogen.id}`;

        const { list } = await fetchList();
        expect(Object.keys(ownCoats(list))).toEqual([gebiete.ok.publicId]);

        // Und es ist wirklich dieselbe Antwort, die das Panel bekommt: je Gebiet einzeln gefragt.
        const einzeln = await resolveTerritoryCoats(
            database,
            Object.values(gebiete).map((gebiet) => gebiet.publicId),
        );
        expect([...einzeln.keys()].sort()).toEqual(Object.keys(ownCoats(list)).sort());
        for (const [id, url] of Object.entries(ownCoats(list))) {
            expect(einzeln.get(id)?.url).toBe(url);
        }
    });

    it("🔴 eine Unterdrückung (Legacy: bewusst leeres Wappen) nimmt es weg - dieselbe Tafel wie im Panel", async () => {
        // Das Schema verbietet, dass eine aktive Bindung und ihre Unterdrückung am Ende zugleich stehen; die Abfrage muss
        // trotzdem beide lesen, denn der Rückzug geschieht in zwei Schritten. Darum in einer Transaktion, die zurückrollt.
        const gebiet = await insertTerritory(database, 43);
        await bindCoat(gebiet.id, (await coatAsset("unterdrueckt")).id);
        expect((await resolveAllTerritoryCoats(database)).has(gebiet.publicId)).toBe(true);

        let drin: boolean | undefined;
        class Rollback extends Error {}
        try {
            await database.begin(async (transaction) => {
                await transaction`INSERT INTO territory_media_suppression (territory_id, role, origin, legacy_reason) VALUES (${gebiet.id}, 'coat', 'legacy', 'empty_override')`;
                drin = (await resolveAllTerritoryCoats(transaction)).has(gebiet.publicId);
                throw new Rollback();
            });
        } catch (error) {
            if (!(error instanceof Rollback)) throw error;
        }
        expect(drin).toBe(false);
    });
    it("ein stillgelegtes Gebiet steht nicht darin: die Karte zeichnet keinen Namen für es", async () => {
        const gebiet = await insertTerritory(database, 49);
        await bindCoat(gebiet.id, (await coatAsset("still")).id);
        expect(ownCoats((await fetchList()).list)).toHaveProperty(gebiet.publicId);
        await database`UPDATE territory SET is_active = FALSE WHERE id = ${gebiet.id}`;
        expect(ownCoats((await fetchList()).list)).toEqual({});
    });

    it("🔴 EINE Abfrage für alle Gebiete, auch bei hunderten Wappen (kein N+1)", async () => {
        for (let n = 0; n < 5; n += 1) {
            const gebiet = await insertTerritory(database, 100 + n);
            await bindCoat(gebiet.id, (await coatAsset(`viele-${String(n)}`)).id);
        }
        let calls = 0;
        const counting = Object.assign(tagged(database), {
            unsafe: (...args: Parameters<Database["unsafe"]>) => {
                calls += 1;
                return database.unsafe(...args);
            },
        }) as unknown as Queryable;
        const found = await resolveAllTerritoryCoats(counting);
        expect(calls).toBe(1);
        expect([...found.keys()].filter((id) => id.startsWith(FIXTURE_PREFIX))).toHaveLength(5);
    });

    it("die Antwort trägt nur die Adresse: keine Rechte, keine Nennung, kein Speicherschlüssel", async () => {
        const gebiet = await insertTerritory(database, 50);
        const coat = await coatAsset("nur-adresse", {
            rights: {
                ...OWN_CLEARED,
                rightsNote: "RECHTENOTIZ-GEHEIM",
                creator: "Urheberin Eins",
                legacyRightsCode: "CODE-GEHEIM",
            },
            ingestActorLegacy: "LOGIN-GEHEIM",
        });
        await bindCoat(gebiet.id, coat.id);
        const response = await app.inject({ method: "GET", url: TERRITORY_COATS_URL });
        const body = response.body;
        for (const verboten of [
            "RECHTENOTIZ-GEHEIM",
            "Urheberin Eins",
            "CODE-GEHEIM",
            "LOGIN-GEHEIM",
            "published/",
            coat.publicId,
        ]) {
            expect(body, verboten).not.toContain(verboten);
        }
        expect(Object.keys(response.json() as object).sort()).toEqual(["coats", "schemaVersion"]);
    });

    it("🔴 wie die anderen Lesezeiger: ETag, no-cache, und eine bedingte Anfrage bleibt ein 304, solange sich nichts ändert", async () => {
        const gebiet = await insertTerritory(database, 51);
        await bindCoat(gebiet.id, (await coatAsset("etag")).id);
        const erste = await app.inject({ method: "GET", url: TERRITORY_COATS_URL });
        expect(erste.statusCode).toBe(200);
        expect(erste.headers["cache-control"]).toBe("no-cache");
        expect(erste.headers["content-type"]).toMatch(/^application\/json/);
        const etag = erste.headers["etag"] as string;
        expect(etag).toMatch(/^"[0-9a-f]{16}"$/);

        const nochmal = await app.inject({
            method: "GET",
            url: TERRITORY_COATS_URL,
            headers: { "if-none-match": etag },
        });
        expect(nochmal.statusCode).toBe(304);

        // Ein zweites Wappen ändert die Liste und mit ihr den ETag; die Reihenfolge ist die der Kennung, nicht des Zufalls.
        const zweites = await insertTerritory(database, 52);
        await bindCoat(zweites.id, (await coatAsset("etag-zwei")).id);
        const geaendert = await app.inject({
            method: "GET",
            url: TERRITORY_COATS_URL,
            headers: { "if-none-match": etag },
        });
        expect(geaendert.statusCode).toBe(200);
        expect(geaendert.headers["etag"]).not.toBe(etag);
        const ids = Object.keys(ownCoats(parseTerritoryCoats(geaendert.json())));
        expect(ids).toEqual([...ids].sort());
        expect(ids).toHaveLength(2);
    });

    it("ohne Wappen ist die Liste leer und die Antwort ein 200, kein Fehler", async () => {
        const { statusCode, list } = await fetchList();
        expect(statusCode).toBe(200);
        expect(ownCoats(list)).toEqual({});
    });

    it("ohne Datenbank antwortet die Route 503 und merkt es sich nicht im Cache", async () => {
        const ohne = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
        });
        try {
            const response = await ohne.inject({ method: "GET", url: TERRITORY_COATS_URL });
            expect(response.statusCode).toBe(503);
            expect(response.headers["cache-control"]).toBe("no-store");
        } finally {
            await ohne.close();
        }
    });
});
