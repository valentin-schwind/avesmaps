import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";

/**
 * Ein Editor liest das Detail eines Subjects frisch (WI-0193, EDIT-0003 T35 (1)). Nginx der Stage hält `public, max-age=60` für ALLE
 * Angemeldeten (`ops/deploy/staging-deploy.sh`); nach „Verbergen“ las das Menü am Ort darum 60 s lang den alten Stand und bot wieder
 * „Verbergen“ an. Mit `use_editor_menu` und `?editor=true` antwortet der Server `private, no-store` (das speichert Nginx nicht), mit
 * derselben Antwort; die Adresse allein hebt nichts auf.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi-0193-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Das Detail eines Subjects für Editoren am Zwischenspeicher vorbei", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let editor: string;
    let besucherMitKonto: string;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await cleanMediaFixtures(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = await fixture.person("editor", { name: "Edda" });
        editor = (await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 })).cookie;
        const tester = await fixture.person("tester", { name: "Tessa" });
        besucherMitKonto = (await fixture.session(tester.id)).cookie;
    });

    afterAll(async () => {
        await cleanMediaFixtures(database);
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const frage = async (url: string, cookie?: string) => {
        const response = await app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
        return {
            status: response.statusCode,
            cache: response.headers["cache-control"],
            body: response.json<unknown>(),
        };
    };

    it("🔴 mit use_editor_menu und ?editor=true: private, no-store, dieselbe Antwort", async () => {
        const place = await insertPlace(database, 94);
        const url = `/api/subjects/place/${place.publicId}`;
        const oeffentlich = await frage(url, editor);
        expect(oeffentlich.status).toBe(200);
        expect(oeffentlich.cache).toBe("public, max-age=60");

        const frisch = await frage(`${url}?editor=true`, editor);
        expect(frisch.status).toBe(200);
        expect(frisch.cache).toBe("private, no-store");
        expect(frisch.body).toEqual(oeffentlich.body);
    });

    it("🔴 die Adresse allein hebt nichts auf: ohne Recht oder ohne Sitzung bleibt es der öffentliche Zwischenspeicher", async () => {
        const place = await insertPlace(database, 95);
        const url = `/api/subjects/place/${place.publicId}?editor=true`;
        expect((await frage(url)).cache).toBe("public, max-age=60");
        expect((await frage(url, besucherMitKonto)).cache).toBe("public, max-age=60");
    });

    it("ein unbekannter Ort bleibt 404 ohne Speicher, auch für einen Editor", async () => {
        const fehlt = await frage("/api/subjects/place/00000000-0000-4000-8000-0000000000ff?editor=true", editor);
        expect(fehlt.status).toBe(404);
        expect(fehlt.cache).toBe("no-store");
    });
});
