import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createDiscordClient, type DiscordClient, type DiscordUser } from "../src/auth/discord-client.ts";
import { displayNameFrom, safeReturnPath } from "../src/auth/discord-flow.ts";
import { hashPassword } from "../src/auth/password-hash.ts";
import { protect } from "../src/auth/plugin.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { SoftAuthenticator } from "./support/soft-authenticator.ts";

/**
 * Anmelden mit Discord (WI-0120 A5, AUTH-0001 §6.3, §6.6, §6.8, T1, T2, T14). Die Attrappe ersetzt nur den Draht zu Discord
 * (isolierte Tests); die echte Anmeldung prüft der Betreiber am Browser (Abnahmestufe E, AUTH-0001 §16).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Discord im Kleinen: Code → Konto; merkt sich Verifier und Widerrufe. */
function fakeDiscord(): DiscordClient & {
    users: Map<string, DiscordUser>;
    verifiers: string[];
    revoked: string[];
    failExchange: boolean;
} {
    const users = new Map<string, DiscordUser>();
    const fake = {
        users,
        verifiers: [] as string[],
        revoked: [] as string[],
        failExchange: false,
        async exchangeCode(code: string, verifier: string) {
            fake.verifiers.push(verifier);
            return fake.failExchange || !users.has(code) ? undefined : { accessToken: `tok-${code}` };
        },
        async fetchUser(token: string) {
            return users.get(token.slice(4));
        },
        async revoke(token: string) {
            fake.revoked.push(token);
        },
    };
    return fake;
}

const snowflake = (): string => `1${String(Math.floor(Math.random() * 1e17)).padStart(17, "0")}`;

describe("Bausteine des Discord-Umwegs", () => {
    it("🔴 kein Quelltext liest oder schreibt Discords Zwei-Faktor-Angabe (Release N vor dem DROP COLUMN, WI-0120)", () => {
        // Betreiber 2026-10-10: „B: nicht mehr speichern“. Erst wenn das hier grün ist, darf die Spalte im nächsten Release fallen.
        const root = fileURLToPath(new URL("../../../", import.meta.url));
        const found: string[] = [];
        for (const directory of ["apps/server/src", "apps/web/src", "packages/shared/src"]) {
            for (const entry of readdirSync(join(root, directory), { recursive: true, withFileTypes: true })) {
                if (!entry.isFile() || !/\.(ts|vue|psql|sql)$/u.test(entry.name)) continue;
                const path = join(entry.parentPath, entry.name);
                if (/mfa_?enabled/iu.test(readFileSync(path, "utf8"))) found.push(relative(root, path));
            }
        }
        expect(found).toEqual([]);
    });

    it("🔴 nur Pfade der eigenen Seite als Rücksprung (T2)", () => {
        expect(safeReturnPath("/?x=1#z=3")).toBe("/?x=1#z=3");
        for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/api/auth/logout", "evil", "/a\nb"]) {
            expect(safeReturnPath(bad), bad).toBeNull();
        }
    });

    it("🔴 Anzeigename ohne Steuer- und Richtungszeichen, höchstens 40 Zeichen (T20)", () => {
        const user = (globalName: string | null, username = "rondrikan"): DiscordUser => ({
            id: "1",
            username,
            globalName,
        });
        expect(displayNameFrom(user("Rondrikan‮ der Kühne"))).toBe("Rondrikan der Kühne");
        expect(displayNameFrom(user(null))).toBe("rondrikan");
        // Kein Zeilenumbruch, kein C1-Steuerzeichen, kein Zeilentrenner: Der Name steht in zeilenweise gelesenen Proben (Claudio 2026-10-13).
        expect(displayNameFrom(user("X|t|t\nY\u0085Z\u2028W"))).toBe("X|t|tYZW");
        expect([...displayNameFrom(user("ä".repeat(60)))].length).toBe(40);
        expect(displayNameFrom(user("​", ""))).toBe("Discord-Konto");
    });

    it("🔴 der echte Draht: Formular, PKCE-Verifier, Bearer, Widerruf; Snowflake bleibt Text; `mfa_enabled` bleibt draußen", async () => {
        const seen: { path: string; type: string | undefined; body: string; auth: string | undefined }[] = [];
        const server: Server = createServer((request, response) => {
            let body = "";
            request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
            request.on("end", () => {
                seen.push({
                    path: request.url ?? "",
                    type: request.headers["content-type"],
                    body,
                    auth: request.headers.authorization,
                });
                response.setHeader("content-type", "application/json");
                if (request.url === "/api/v10/oauth2/token")
                    response.end(JSON.stringify({ access_token: "A", token_type: "Bearer" }));
                else if (request.url === "/api/v10/users/@me")
                    response.end(
                        '{"id":"1234567890123456789","username":"praiodan","global_name":"Praiodan","mfa_enabled":true}',
                    );
                else response.end("{}");
            });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as AddressInfo).port;
        const client = createDiscordClient({
            ...TEST_AUTH.discord!,
            apiBase: `http://127.0.0.1:${String(port)}/api/v10`,
        });
        expect(await client.exchangeCode("CODE", "VERIFIER")).toEqual({ accessToken: "A" });
        // Discord schickt `mfa_enabled` mit; übernommen wird es nicht (Betreiber 2026-10-10: „B: nicht mehr speichern“).
        expect(await client.fetchUser("A")).toEqual({
            id: "1234567890123456789",
            username: "praiodan",
            globalName: "Praiodan",
        });
        await client.revoke("A");
        server.close();
        const exchange = new URLSearchParams(seen[0]!.body);
        expect(seen[0]!.type).toBe("application/x-www-form-urlencoded");
        expect(Object.fromEntries(exchange)).toMatchObject({
            grant_type: "authorization_code",
            code: "CODE",
            code_verifier: "VERIFIER",
            redirect_uri: TEST_AUTH.discord!.redirectUri,
            client_id: "test-client",
        });
        expect(seen[1]).toMatchObject({ path: "/api/v10/users/@me", auth: "Bearer A" });
        expect(seen[2]!.path).toBe("/api/v10/oauth2/token/revoke");
        expect(new URLSearchParams(seen[2]!.body).get("token")).toBe("A");
    });
});

describeWithDatabase("Anmelden mit Discord", { timeout: 90_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    let discord: ReturnType<typeof fakeDiscord>;
    const logs: string[] = [];

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    async function build(): Promise<FastifyInstance> {
        discord = fakeDiscord();
        const instance = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            discordClient: discord,
            logStream: { write: (line: string) => void logs.push(line) },
        });
        instance.get("/api/admin/probe", { ...protect("manage_people") }, async () => ({ ok: true }));
        await instance.ready();
        return instance;
    }

    async function withDiscord(role: "editor" | "admin", options: { status?: "active" | "locked" } = {}) {
        const person = await fixture.person(role, options);
        const user: DiscordUser = {
            id: snowflake(),
            username: `u${person.id.slice(0, 6)}`,
            globalName: person.name,
        };
        await database`INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES (${person.id}, ${user.id})`;
        return { person, user };
    }

    /** Startet den Umweg und gibt `state`, Nonce-Cookie und die Parameter der Authorize-Adresse zurück. */
    async function start(
        purpose: "login" | "link" | "confirm",
        options: { returnPath?: string; cookie?: string } = {},
    ) {
        const response = await app!.inject({
            method: "POST",
            url: "/api/auth/discord/start",
            headers: { origin: TEST_ORIGIN, ...(options.cookie ? { cookie: options.cookie } : {}) },
            payload: { purpose, ...(options.returnPath === undefined ? {} : { returnPath: options.returnPath }) },
        });
        if (response.statusCode !== 200) return { response };
        const url = new URL(response.json().authorizeUrl as string);
        const nonceCookie = [response.headers["set-cookie"]]
            .flat()
            .map(String)
            .find((c) => c.startsWith("__Host-avesmaps-oauth="))!;
        return { response, url, state: url.searchParams.get("state")!, nonce: nonceCookie.split(";")[0]! };
    }

    async function callback(query: string, cookies: string[]) {
        return app!.inject({
            method: "GET",
            url: `/api/auth/discord/callback?${query}`,
            headers: { cookie: cookies.join("; ") },
        });
    }

    const sessionCookie = (response: { headers: Record<string, unknown> }): string | undefined =>
        [response.headers["set-cookie"]]
            .flat()
            .map(String)
            .find((c) => c.startsWith("__Host-avesmaps-session=") && !c.includes("Max-Age=0"))
            ?.split(";")[0];

    /**
     * Was an Discords Zwei-Faktor-Angabe zur Person gespeichert ist. Über `to_jsonb`, damit der Test die Spalte nicht beim Namen
     * nennt: Er bleibt grün, wenn sie im nächsten Release fällt (WI-0120, Nachtrag 2026-10-10), und sagt dann `null` wie jetzt.
     */
    async function storedMfa(personId: string): Promise<string | null> {
        const [row] = await database<{ mfa: string | null }[]>`
            SELECT to_jsonb(dl) ->> 'mfa_enabled' AS mfa FROM avesmaps_auth.discord_login dl WHERE dl.person_id = ${personId}
        `;
        expect(row).toBeDefined();
        return row!.mfa;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        await database`DELETE FROM avesmaps_auth.discord_login WHERE person_id IN (SELECT id FROM avesmaps_auth.person WHERE created_via = 'system')`;
        await database`DELETE FROM avesmaps_auth.password_login WHERE login_name LIKE 'd-%'`;
        await database`DELETE FROM avesmaps_auth.oauth_flow WHERE created_at < now() + interval '1 hour'`;
        await fixture.cleanup();
        logs.length = 0;
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 Start: Scope identify, state, PKCE S256, prompt=none, Nonce-Cookie 10 Minuten", async () => {
        app = await build();
        const { url, nonce, response } = await start("login");
        expect(url!.origin + url!.pathname).toBe("https://discord.test/oauth2/authorize");
        expect(Object.fromEntries(url!.searchParams)).toMatchObject({
            response_type: "code",
            client_id: "test-client",
            scope: "identify",
            redirect_uri: TEST_AUTH.discord!.redirectUri,
            code_challenge_method: "S256",
            prompt: "none",
        });
        expect(url!.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(String([response.headers["set-cookie"]].flat()[0])).toContain(
            "HttpOnly; SameSite=Lax; Secure; Max-Age=600",
        );
        expect(nonce).toMatch(/^__Host-avesmaps-oauth=/u);
    });

    it("🔴 Admin über Discord: nur Stufe R („4. B“), Discords Zwei-Faktor-Angabe nicht gespeichert („B“); Verifier passt, Token widerrufen", async () => {
        app = await build();
        const { person, user } = await withDiscord("admin");
        discord.users.set("c1", user);
        const { url, state, nonce } = await start("login", { returnPath: "/?route=gareth" });
        const response = await callback(`code=c1&state=${state}`, [nonce!]);
        expect(response.statusCode).toBe(303);
        expect(response.headers.location).toBe("/?route=gareth&anmeldung=ok");
        const verifier = discord.verifiers[0]!;
        expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url!.searchParams.get("code_challenge"));
        expect(discord.revoked).toEqual(["tok-c1"]);
        const cookie = sessionCookie(response)!;
        const session = (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).json();
        expect(session.person).toMatchObject({ id: person.id, assurance: "basic", sessionMethod: "discord" });
        const probe = await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie } });
        expect(probe.statusCode).toBe(403);
        expect(probe.json().error).toMatchObject({ code: "assurance_required", details: { need: "second_factor" } });
        expect(await storedMfa(person.id)).toBeNull();
        const [event] = await database<{ details: unknown }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE target_person_id = ${person.id} AND action = 'login.success' ORDER BY id DESC LIMIT 1
        `;
        expect(event?.details).toEqual({ method: "discord", assurance: "basic" });
    });

    it("🔴 Release N (Migration 0093): `mfa_enabled` ist nullbar ohne Vorgabe (oder schon gefallen); Verknüpfen speichert nichts", async () => {
        app = await build();
        const [column] = await database<{ is_nullable: string; column_default: string | null }[]>`
            SELECT is_nullable, column_default FROM information_schema.columns
             WHERE table_schema = 'avesmaps_auth' AND table_name = 'discord_login' AND column_name = 'mfa_enabled'
        `;
        if (column !== undefined) expect(column).toEqual({ is_nullable: "YES", column_default: null });

        const person = await fixture.person("editor");
        const { cookie } = await fixture.session(person.id, { method: "password", assurance: "basic" });
        discord.users.set("c1", { id: snowflake(), username: "eigen", globalName: "Eigen" });
        const link = await start("link", { cookie });
        expect((await callback(`code=c1&state=${link.state}`, [link.nonce!, cookie])).headers.location).toBe(
            "/anmelden?anmeldung=verknuepft",
        );
        expect(await storedMfa(person.id)).toBeNull();
        // Das Personendetail nennt keine Zwei-Faktor-Angabe mehr.
        const operator = await fixture.person("operator");
        const detail = await app.inject({
            method: "GET",
            url: `/api/admin/people/${person.id}`,
            headers: { cookie: (await fixture.session(operator.id)).cookie },
        });
        const discordPart = detail.json().discord as Record<string, unknown>;
        expect(Object.keys(discordPart).sort()).toEqual([
            "globalName",
            "lastLoginAt",
            "linkedAt",
            "userId",
            "username",
        ]);
        expect(discordPart).toMatchObject({ username: "eigen", globalName: "Eigen" });
    });

    it("🔴 über Discord ohne Passkey Stufe R; ohne Einladung entsteht kein Konto; gesperrt bleibt gesperrt", async () => {
        app = await build();
        const { user } = await withDiscord("admin");
        discord.users.set("c1", user);
        const first = await start("login");
        const basic = await callback(`code=c1&state=${first.state}`, [first.nonce!]);
        const probe = await app.inject({
            method: "GET",
            url: "/api/admin/probe",
            headers: { cookie: sessionCookie(basic)! },
        });
        expect(probe.json().error.code).toBe("assurance_required");

        const [before] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM avesmaps_auth.person`;
        discord.users.set("c2", { id: snowflake(), username: "fremd", globalName: "Fremd" });
        const second = await start("login");
        const stranger = await callback(`code=c2&state=${second.state}`, [second.nonce!]);
        expect(stranger.headers.location).toBe("/anmelden?anmeldung=kein_zugang");
        expect(sessionCookie(stranger)).toBeUndefined();
        const [after] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM avesmaps_auth.person`;
        expect(after!.n).toBe(before!.n);

        const locked = await withDiscord("editor", { status: "locked" });
        discord.users.set("c3", locked.user);
        const third = await start("login");
        expect((await callback(`code=c3&state=${third.state}`, [third.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=gesperrt",
        );
    });

    it("🔴 state und Nonce: falscher Browser, Wiederholung und fremder Rücksprung (T1, T2)", async () => {
        app = await build();
        const { user } = await withDiscord("editor");
        discord.users.set("c1", user);
        const flow = await start("login", { returnPath: "//evil.example" });
        expect((await callback(`code=c1&state=${flow.state}`, [])).headers.location).toBe(
            "/anmelden?anmeldung=abgelaufen",
        );
        // Der fremde Versuch hat den Umweg verbrannt: auch mit dem richtigen Cookie geht er nicht mehr.
        expect((await callback(`code=c1&state=${flow.state}`, [flow.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=abgelaufen",
        );
        const again = await start("login", { returnPath: "//evil.example" });
        expect((await callback(`code=c1&state=${again.state}`, [again.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=ok",
        );
        expect((await callback(`code=c1&state=${again.state}`, [again.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=abgelaufen",
        );
        expect((await callback(`code=c1&state=${randomUUID()}`, [again.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=abgelaufen",
        );
    });

    it("Abbruch, verweigerte Freigabe ohne Vorgeschichte und Discord-Ausfall", async () => {
        app = await build();
        const denied = await start("login");
        expect((await callback(`error=access_denied&state=${denied.state}`, [denied.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=abgebrochen",
        );

        const silent = await start("login");
        const retry = await callback(`error=consent_required&state=${silent.state}`, [silent.nonce!]);
        expect(retry.statusCode).toBe(303);
        expect(new URL(String(retry.headers.location)).searchParams.get("prompt")).toBe("consent");

        const { person, user } = await withDiscord("editor");
        discord.users.set("c1", user);
        discord.failExchange = true;
        const down = await start("login");
        expect((await callback(`code=c1&state=${down.state}`, [down.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=discord_fehler",
        );

        // T15: Fällt Discord aus, geht die Anmeldung mit Benutzername und Passwort weiter (WI-0120 A12).
        const loginName = `d-ausfall-${String(Date.now())}`;
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${person.id}, ${loginName}, ${await hashPassword("Ein Satz für den Ausfall von Discord")})
        `;
        const password = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { loginName, password: "Ein Satz für den Ausfall von Discord" },
            headers: { origin: TEST_ORIGIN },
        });
        expect(password.statusCode).toBe(200);
        expect(String(password.headers["set-cookie"])).toMatch(/__Host-avesmaps-session=/u);
    });

    it("🔴 T1: ohne `state`, mit dem Nonce eines anderen Umwegs und nach Ablauf des Umwegs geht nichts durch (WI-0120 A12)", async () => {
        app = await build();
        const { user } = await withDiscord("editor");
        discord.users.set("c1", user);
        const flow = await start("login");
        expect((await callback("code=c1", [flow.nonce!])).headers.location).toBe("/anmelden?anmeldung=abgelaufen");
        const other = await start("login");
        expect((await callback(`code=c1&state=${flow.state}`, [other.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=abgelaufen",
        );
        const late = await start("login");
        await database`
            UPDATE avesmaps_auth.oauth_flow SET expires_at = now() - interval '1 second'
             WHERE state_hash = ${createHash("sha256").update(late.state!, "utf8").digest()}
        `;
        expect((await callback(`code=c1&state=${late.state}`, [late.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=abgelaufen",
        );
        // Der fremde Umweg selbst bleibt unberührt und geht mit seinem eigenen Nonce noch.
        expect((await callback(`code=c1&state=${other.state}`, [other.nonce!])).headers.location).toBe(
            "/anmelden?anmeldung=ok",
        );
    });

    it("🔴 Bestätigen mit Discord: dieselbe Person, neues Token, frisch, aber nie Stufe V (Betreiber 2026-10-10: „4. B“); eine andere Person nie", async () => {
        app = await build();
        const { person, user } = await withDiscord("admin");
        const loginName = `d-${randomUUID().slice(0, 8)}`;
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${person.id}, ${loginName}, ${await hashPassword("Ein Satz für die Bestätigung")})
        `;
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers: { origin: TEST_ORIGIN },
            payload: { loginName, password: "Ein Satz für die Bestätigung" },
        });
        const basic = sessionCookie(login)!;
        await database`UPDATE avesmaps_auth.session SET confirmed_at = now() - interval '1 hour' WHERE person_id = ${person.id}`;
        discord.users.set("c1", user);
        const flow = await start("confirm", { cookie: basic });
        expect(flow.url!.searchParams.get("prompt")).toBe("consent");
        const confirmed = await callback(`code=c1&state=${flow.state}`, [flow.nonce!, basic]);
        expect(confirmed.headers.location).toBe("/anmelden?anmeldung=bestaetigt");
        const fresh = sessionCookie(confirmed)!;
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: basic } })).json().person,
        ).toBeNull();
        const after = (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: fresh } })).json()
            .person;
        // Frisch für Schritte mit `recent` (≤ 15 min), aber ohne Passkey kein zweiter Faktor, auch mit Discord-2FA.
        expect(after.assurance).toBe("basic");
        expect(Date.now() - Date.parse(after.confirmedAt as string)).toBeLessThan(60_000);
        expect(
            (await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie: fresh } })).statusCode,
        ).toBe(403);

        // Eine Sitzung, die den Passkey schon trägt, bleibt nach einer Bestätigung über Discord auf Stufe V.
        const strong = await fixture.session(person.id, { method: "password", assurance: "strong" });
        const again = await start("confirm", { cookie: strong.cookie });
        const kept = sessionCookie(await callback(`code=c1&state=${again.state}`, [again.nonce!, strong.cookie]))!;
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: kept } })).json().person
                .assurance,
        ).toBe("strong");

        discord.users.set("c2", { id: snowflake(), username: "anders", globalName: "Anders" });
        const other = await start("confirm", { cookie: fresh });
        expect((await callback(`code=c2&state=${other.state}`, [other.nonce!, fresh])).headers.location).toBe(
            "/anmelden?anmeldung=andere_person",
        );
    });

    it("🔴 Gegenprobe „4. B“: Admin mit Discord-2FA und Passkey kommt erst nach dem Passkey in die Verwaltung, einmal je Sitzung", async () => {
        app = await build();
        const { person, user } = await withDiscord("admin");
        discord.users.set("c1", user);
        // Der Passkey ist schon eingerichtet (hier über den Notzugang, der den ersten einrichten darf, AUTH-0001 §11.4).
        const authenticator = new SoftAuthenticator({ rpId: "avesmaps.test", origin: TEST_ORIGIN });
        const recovery = await fixture.session(person.id, { method: "recovery", assurance: "recovery" });
        const post = (url: string, cookie: string, payload: object = {}) =>
            app!.inject({ method: "POST", url, headers: { cookie, origin: TEST_ORIGIN }, payload });
        const enrol = await post("/api/account/passkeys/register/options", recovery.cookie);
        expect(
            (
                await post("/api/account/passkeys/register/verify", recovery.cookie, {
                    credential: authenticator.register(enrol.json().publicKey.challenge as string),
                })
            ).statusCode,
        ).toBe(200);

        const people = (cookie: string) =>
            app!.inject({ method: "GET", url: "/api/admin/people", headers: { cookie } });
        const signIn = async (): Promise<string> => {
            const flow = await start("login");
            return sessionCookie(await callback(`code=c1&state=${flow.state}`, [flow.nonce!]))!;
        };

        const cookie = await signIn();
        const refused = await people(cookie);
        expect(refused.statusCode).toBe(403);
        expect(refused.json().error).toMatchObject({ code: "assurance_required", details: { need: "second_factor" } });

        const options = await post("/api/auth/passkey/confirm/options", cookie);
        const confirmed = await post("/api/auth/passkey/confirm/verify", cookie, {
            credential: authenticator.assert(options.json().publicKey.challenge as string),
        });
        expect(confirmed.statusCode).toBe(200);
        const upgraded = sessionCookie(confirmed)!;
        expect((await people(upgraded)).statusCode).toBe(200);
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: upgraded } })).json()
                .person,
        ).toMatchObject({ assurance: "strong", sessionMethod: "discord" });

        // Eine neue Anmeldung über Discord ist eine neue Sitzung: wieder ohne zweiten Faktor, bis der Passkey bestätigt.
        expect((await people(await signIn())).json().error.code).toBe("assurance_required");
    });

    it("🔴 Discord verknüpfen: nur frisch bestätigt, nie eine fremde ID (T10)", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const { cookie } = await fixture.session(person.id, { method: "password", assurance: "basic" });
        const stale = await fixture.session(person.id, {
            method: "password",
            assurance: "basic",
            confirmedMinutesAgo: 30,
        });
        expect((await start("link", { cookie: stale.cookie })).response.json().error.code).toBe("reauth_required");

        const taken = await withDiscord("editor");
        discord.users.set("c1", taken.user);
        const steal = await start("link", { cookie });
        expect((await callback(`code=c1&state=${steal.state}`, [steal.nonce!, cookie])).headers.location).toBe(
            "/anmelden?anmeldung=discord_vergeben",
        );

        const mine: DiscordUser = { id: snowflake(), username: "eigen", globalName: "Eigen" };
        discord.users.set("c2", mine);
        const link = await start("link", { cookie });
        expect((await callback(`code=c2&state=${link.state}`, [link.nonce!, cookie])).headers.location).toBe(
            "/anmelden?anmeldung=verknuepft",
        );
        const [row] = await database<
            { person_id: string }[]
        >`SELECT person_id FROM avesmaps_auth.discord_login WHERE discord_user_id = ${mine.id}`;
        expect(row?.person_id).toBe(person.id);
    });

    it("🔴 im Protokoll und in den Logs steht weder Code noch state noch Token (T14)", async () => {
        app = await build();
        const { user } = await withDiscord("editor");
        discord.users.set("geheimcode", user);
        const flow = await start("login");
        await callback(`code=geheimcode&state=${flow.state}`, [flow.nonce!]);
        const all = logs.join("\n");
        expect(all).not.toContain("geheimcode");
        expect(all).not.toContain(flow.state);
        expect(all).not.toContain("tok-geheimcode");
        const rows = await database<
            { text: string }[]
        >`SELECT row_to_json(e)::text AS text FROM avesmaps_auth.security_event e WHERE action = 'login.success' ORDER BY id DESC LIMIT 5`;
        for (const { text } of rows) {
            expect(text).not.toContain("geheimcode");
            expect(text).not.toContain(flow.state);
        }
    });
});
