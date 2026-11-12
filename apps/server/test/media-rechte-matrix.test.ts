import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capabilitiesFor, ROLES, type Capability, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * 🔴 **Die Rechte-Matrix der Medienverwaltung** (WI-0068 R8, AC19; Befund der Inventur 2026-10-18: 19 von 28 Schreibrouten hatten
 * keinen ausgeführten 401/403-Fall). Statt je Route einen Fall von Hand zu schreiben, liest der Test die Routen aus der App selbst
 * (`onRoute`, wie `auth-routes.test.ts`): Jede Route unter `/api/editor/media` und `/api/editor/galleries` mit `config.auth` bekommt
 *
 * - ohne Anmeldung 401 `unauthenticated`;
 * - von jeder Rolle, der ihr Recht fehlt (`capabilitiesFor`), 403 `forbidden`;
 * - bei Bestätigung per Passkey von einer Rolle MIT Recht, aber altem Passkey, 403 (`reauth_required` oder `assurance_required`).
 *
 * Der Wächter (`protect`, `preValidation`) läuft vor der Schemaprüfung; deshalb genügt ein leerer Körper, und keine Route wird
 * tatsächlich ausgeführt. Eine neue Medienroute steht damit ohne weiteren Fall in der Matrix.
 */

const PREFIXES = ["/api/editor/media", "/api/editor/galleries"] as const;

interface Guarded {
    method: string;
    url: string;
    capability: Capability;
    confirm: string | undefined;
}

/** Eine Pfadvorlage mit Werten in der Form, die ihr Schema erwartet; geprüft wird ohnehin vor dem Schema. */
function concrete(url: string): string {
    return url
        .replace(/:kind/gu, "place")
        .replace(/:sha256/gu, "a".repeat(64))
        .replace(/:variant/gu, "coat")
        .replace(/:[a-zA-Z]+/gu, "00000000-0000-4000-8000-000000000000");
}

describeWithDatabase("Medienverwaltung: Rechte-Matrix aller Routen (WI-0068 R8)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    const routes: Guarded[] = [];
    const frisch = new Map<Role, string>();
    const alt = new Map<Role, string>();

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot: undefined,
        auth: TEST_AUTH,
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        for (const role of ROLES) {
            const person = await fixture.person(role, { name: `Matrix ${role}` });
            frisch.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
            alt.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 24 * 60 })).cookie);
        }
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        app.addHook("onRoute", (options) => {
            if (!PREFIXES.some((prefix) => options.url.startsWith(prefix))) return;
            const auth = options.config?.auth as { capability?: Capability; confirm?: string } | undefined;
            if (auth?.capability === undefined) return;
            const methods = Array.isArray(options.method) ? options.method : [options.method];
            for (const method of methods) {
                if (method === "HEAD") continue;
                routes.push({ method, url: options.url, capability: auth.capability, confirm: auth.confirm });
            }
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const call = async (route: Guarded, cookie: string | undefined): Promise<string> => {
        const response = await app.inject({
            method: route.method as "GET" | "POST",
            url: concrete(route.url),
            headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
            ...(route.method === "POST" ? { payload: {} } : {}),
        });
        const code = (response.json() as { error?: { code?: string } }).error?.code ?? "";
        return `${String(response.statusCode)} ${code}`;
    };

    it("🔴 die Matrix ist vollständig: jede Medienroute trägt ihr Recht, und es sind alle Schreib- und Lesewege", () => {
        const posts = routes.filter((route) => route.method === "POST");
        // Stand 2026-10-18: 28 Schreibrouten (Inventur R8). Mehr ist in Ordnung (eine neue Route steht von selbst in der Matrix).
        expect(posts.length).toBeGreaterThanOrEqual(28);
        expect(routes.filter((route) => route.method === "GET").length).toBeGreaterThanOrEqual(10);
    });

    it("🔴 ohne Anmeldung 401 - an jeder Route, bevor der Körper gelesen wird", async () => {
        const falsch: string[] = [];
        for (const route of routes) {
            const antwort = await call(route, undefined);
            if (antwort !== "401 unauthenticated") falsch.push(`${route.method} ${route.url}: ${antwort}`);
        }
        expect(falsch).toEqual([]);
    });

    it("🔴 jede Rolle ohne das Recht der Route: 403 forbidden", async () => {
        const falsch: string[] = [];
        let geprueft = 0;
        for (const route of routes) {
            for (const role of ROLES) {
                if (capabilitiesFor(role).has(route.capability)) continue;
                geprueft += 1;
                const antwort = await call(route, frisch.get(role));
                if (antwort !== "403 forbidden") falsch.push(`${role} ${route.method} ${route.url}: ${antwort}`);
            }
        }
        expect(falsch).toEqual([]);
        expect(geprueft, "die Matrix prüft tatsächlich Rollen ohne Recht").toBeGreaterThan(routes.length);
    });

    it("🔴 Stufe S: mit Recht, aber altem Passkey 403 - Notaus, Aufheben, Löschen, Sammellauf", async () => {
        const passkey = routes.filter((route) => route.confirm === "passkey");
        expect(passkey.map((route) => route.url).sort()).toEqual(
            expect.arrayContaining([
                "/api/editor/media/:id/delete",
                "/api/editor/media/:id/suspend",
                "/api/editor/media/merge/all",
            ]),
        );
        const falsch: string[] = [];
        for (const route of passkey) {
            for (const role of ROLES) {
                if (!capabilitiesFor(role).has(route.capability)) continue;
                const antwort = await call(route, alt.get(role));
                if (!["403 reauth_required", "403 assurance_required"].includes(antwort)) {
                    falsch.push(`${role} ${route.method} ${route.url}: ${antwort}`);
                }
            }
        }
        expect(falsch).toEqual([]);
    });
});
