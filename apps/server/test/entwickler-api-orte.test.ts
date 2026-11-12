import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseEntwicklerOrte } from "../src/entwickler-api/orte.ts";

/**
 * `GET /api/v1/orte` gegen echtes PostgreSQL (WI-0303 P7): nur aktive, sichtbare Orte der Domäne, nach Namen sortiert, Lage als Zahl.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const ID = {
    b: "a0000303-0000-4000-8000-000000000001",
    a: "a0000303-0000-4000-8000-000000000002",
    verborgen: "a0000303-0000-4000-8000-000000000003",
    still: "a0000303-0000-4000-8000-000000000004",
};

describeWithDatabase("Entwickler-API v1: Orte aus der Datenbank", () => {
    let db: Database;
    let app: FastifyInstance | undefined;

    const raeume = async (): Promise<void> => {
        await db`DELETE FROM place WHERE public_id IN (${ID.a}, ${ID.b}, ${ID.verborgen}, ${ID.still}) OR name LIKE 'P7-Probe %'`;
    };

    beforeAll(async () => {
        db = createDatabase(testDatabaseUrl!, { max: 4 });
        await migrate(db);
        await raeume();
        await db`INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
                 VALUES (${ID.b}, 'aventuria', 'P7-Probe Beta', 'stadt', ST_SetSRID(ST_MakePoint(100.5, 200.25), 0), 'test', TRUE, FALSE),
                        (${ID.a}, 'aventuria', 'P7-Probe Alpha', 'dorf', ST_SetSRID(ST_MakePoint(10, 20), 0), 'test', TRUE, FALSE),
                        (${ID.verborgen}, 'aventuria', 'P7-Probe Verborgen', 'dorf', ST_SetSRID(ST_MakePoint(1, 1), 0), 'test', TRUE, TRUE),
                        (${ID.still}, 'aventuria', 'P7-Probe Stillgelegt', 'dorf', ST_SetSRID(ST_MakePoint(2, 2), 0), 'test', FALSE, FALSE)`;
    });

    afterAll(async () => {
        // Erst aufräumen: Die App schließt beim Beenden die Datenbank, die sie bekommen hat.
        await raeume();
        await app?.close();
        await db.end();
    });

    it("liest nur aktive, sichtbare Orte, nach Namen sortiert", async () => {
        const proben = (await leseEntwicklerOrte(db)).filter((ort) => ort.name.startsWith("P7-Probe "));
        expect(proben).toEqual([
            { id: ID.a, name: "P7-Probe Alpha", art: "dorf", x: 10, y: 20 },
            { id: ID.b, name: "P7-Probe Beta", art: "stadt", x: 100.5, y: 200.25 },
        ]);
    });

    it("liefert sie über die Route im Vertrag, offen und zwischenspeicherbar", async () => {
        app = buildApp({ config: { ...loadConfig(), databaseUrl: undefined }, database: db });
        const antwort = await app.inject({ method: "GET", url: "/api/v1/orte" });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["access-control-allow-origin"]).toBe("*");
        expect(antwort.headers["cache-control"]).toBe("public, max-age=300");
        const liste = antwort.json<{ vertrag: number; anzahl: number; orte: { name: string }[] }>();
        expect(liste.vertrag).toBe(1);
        expect(liste.anzahl).toBe(liste.orte.length);
        expect(liste.orte.filter((ort) => ort.name.startsWith("P7-Probe ")).map((ort) => ort.name)).toEqual([
            "P7-Probe Alpha",
            "P7-Probe Beta",
        ]);
    });
});
