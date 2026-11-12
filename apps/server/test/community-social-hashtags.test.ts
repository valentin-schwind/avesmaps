import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Hashtags des Social Hubs (WI-0270, Migration 0312) gegen echtes PostgreSQL.
 *
 * Problemfälle: Eine Redaktion ändert die Liste, die jeder sieht; ein Hashtag mit Leerzeichen oder doppelt in anderer Schreibweise landet in der Liste; die Reihenfolge geht verloren; das Protokoll fehlt.
 */

const URL = "/api/community/social/hashtags";
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Social Hub: Hashtags (WI-0270)", { timeout: 120_000 }, () => {
    let database: Database;
    let appDatabase: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    let edda = "";
    let betreiber = "";

    const lies = (cookie: string) => app.inject({ method: "GET", url: URL, headers: { cookie } });
    const schreibe = (cookie: string, hashtags: readonly { tag: string; vorausgewaehlt: boolean }[]) =>
        app.inject({ method: "POST", url: URL, payload: { hashtags }, headers: { origin: TEST_ORIGIN, cookie } });
    const liste = async (): Promise<unknown> => (await lies(edda)).json();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        // Ohne frischen Passkey: Das ist die Sitzung, mit der das Panel im Alltag speichert.
        const anmelden = async (role: Role, name: string): Promise<string> => {
            const person = await fixture.person(role, { name });
            return (await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 60 })).cookie;
        };
        edda = await anmelden("editor", "Hashtag Edda");
        betreiber = await anmelden("operator", "Hashtag Betreiber");
        appDatabase = createDatabase(testDatabaseUrl as string, { max: 4 });
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                mediaRoot: undefined,
                statusPage: true,
                auth: TEST_AUTH,
            },
            database: appDatabase,
            logStream: { write: () => undefined },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
    });

    beforeEach(async () => {
        await database`DELETE FROM public.social_hashtag`;
    });

    afterAll(async () => {
        await database`DELETE FROM public.social_hashtag`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action = 'system.social_hashtags'`;
        await app.close();
        await fixture.cleanup();
        await database.end();
        await appDatabase.end();
    });

    it("🔴 Die Redaktion liest die Liste, ändern darf nur, wer freigibt; ohne Anmeldung nichts", async () => {
        expect((await lies("")).statusCode).toBe(401);
        expect((await lies(edda)).statusCode).toBe(200);
        expect((await schreibe(edda, [{ tag: "#pnpde", vorausgewaehlt: true }])).statusCode).toBe(403);
        expect(await liste()).toEqual({ hashtags: [] });
    });

    it("Die Liste bleibt in ihrer Reihenfolge, mit Vorauswahl, und jede Änderung steht im Protokoll; ohne frischen Passkey", async () => {
        const neu = [
            { tag: "#pnpde", vorausgewaehlt: true },
            { tag: "#Aventurien", vorausgewaehlt: false },
            { tag: "#dasschwarzeauge", vorausgewaehlt: true },
        ];
        const antwort = await schreibe(betreiber, neu);
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json()).toEqual({ hashtags: neu });
        expect(await liste()).toEqual({ hashtags: neu });

        const [ereignis] = await database<{ details: unknown; target_ref: string }[]>`
            SELECT details, target_ref FROM avesmaps_auth.security_event WHERE action = 'system.social_hashtags' ORDER BY id DESC LIMIT 1
        `;
        expect(ereignis).toMatchObject({ target_ref: "social:hashtags", details: { anzahl: 3, vorausgewaehlt: 2 } });

        // Die Liste wird ersetzt, nicht ergänzt.
        expect((await schreibe(betreiber, [{ tag: "#DSA", vorausgewaehlt: false }])).statusCode).toBe(200);
        expect(await liste()).toEqual({ hashtags: [{ tag: "#DSA", vorausgewaehlt: false }] });
    });

    it("🔴 Falsche Form und Doppelte in anderer Schreibweise lehnt die Route ab und lässt die Liste stehen", async () => {
        const stand = [{ tag: "#pnpde", vorausgewaehlt: true }];
        expect((await schreibe(betreiber, stand)).statusCode).toBe(200);
        for (const falsch of [
            [{ tag: "#das schwarze auge", vorausgewaehlt: false }],
            [
                { tag: "#DSA", vorausgewaehlt: false },
                { tag: "#dsa", vorausgewaehlt: true },
            ],
        ]) {
            expect((await schreibe(betreiber, falsch)).statusCode).toBe(422);
        }
        expect(await liste()).toEqual({ hashtags: stand });
    });
});
