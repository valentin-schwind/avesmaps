import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { LIVE_HEADER } from "../src/routes/live-hint.ts";

/**
 * Der Hinweis auf den Kanal `area` (WI-0125): Er beschreibt die INSTANZ, nicht die Daten.
 *
 * 🔴 Deshalb trägt ihn jeder Zeiger, über den eine Karte den Kanal entdecken kann, und zwar auf jeder Antwort -
 * auch auf einer 404. Eine Karte ohne Grafikkarte liest den Geländezeiger gar nicht erst (WI-0049, Betreiber
 * 2026-09-27 „3: A“; ADR-0011 Punkt 4) und findet den Kanal nur über die Anzeigehöhen. Hing der Hinweis allein am
 * Geländezeiger, verlor sie stillschweigend die Höhenlinien und die Kacheln der Editoren.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const TERRAIN = "/tiles/terrain/dem/current.json";
const DISPLAY_HEIGHT = "/tiles/terrain/display-height/current.json";
const CONFIG = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };

describeWithDatabase("Hinweis auf den Kanal `area`", () => {
    let database: Database;
    let mitStatusseite: FastifyInstance;
    let ohneStatusseite: FastifyInstance;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        mitStatusseite = buildApp({ config: CONFIG, database });
        ohneStatusseite = buildApp({ config: { ...CONFIG, statusPage: false }, database });
        await Promise.all([mitStatusseite.ready(), ohneStatusseite.ready()]);
    });

    afterAll(async () => {
        await Promise.all([mitStatusseite.close(), ohneStatusseite.close()]);
        await database.end({ timeout: 5 });
    });

    it("🔴 der Zeiger der Anzeigehöhen nennt den Kanal, egal was er selbst antwortet", async () => {
        const response = await mitStatusseite.inject({ method: "GET", url: DISPLAY_HEIGHT });
        // Ob abgeleitet (200) oder nicht (404, `no_display_height` / `display_height_stale`): Der Hinweis gehört zur
        // Instanz. Nur deshalb findet eine Karte ohne Grafikkarte den Kanal überhaupt.
        expect([200, 404]).toContain(response.statusCode);
        expect(response.headers[LIVE_HEADER]).toBe("area");
    });

    it("der Geländezeiger nennt ihn, wo er einen Zeiger liefert", async () => {
        const response = await mitStatusseite.inject({ method: "GET", url: TERRAIN });
        // 🪤 Auf seiner 404 („nichts abgeleitet“) steht der Hinweis NICHT, und eine Karte MIT Grafikkarte hört dann
        // nicht mit. Das ist für Entscheidung 3 = A ohne Belang (ohne Grafikkarte wird er nie gelesen) und bleibt
        // als eigener Befund offen: Ein Gelände, das beim Laden fehlte, erscheint auch sonst erst nach einem Reload
        // (`app.vue`, `onTerrain` hält bei `!terrain` an).
        expect(response.headers[LIVE_HEADER]).toBe(response.statusCode === 200 ? "area" : undefined);
    });

    for (const url of [TERRAIN, DISPLAY_HEIGHT]) {
        it(`${url} nennt ihn nicht, wo es keine Statusseite und damit kein /ws gibt`, async () => {
            const response = await ohneStatusseite.inject({ method: "GET", url });
            expect(response.headers[LIVE_HEADER]).toBeUndefined();
        });
    }
});
