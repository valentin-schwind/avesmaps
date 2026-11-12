import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { DiscordClient, DiscordUser } from "../src/auth/discord-client.ts";
import { createInvitation } from "../src/auth/invitations.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { ApiError } from "../src/http/api-error.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Einladungen (WI-0120 A6, AUTH-0001 §6.5; Abnahme §16: eingeladenes Konto, abgelaufene, eingelöste und zurückgezogene
 * Einladung, gebundene Einladung mit fremdem Konto, gleichzeitige Annahme; Betreiber 2026-10-09 D3 C mit Pflichtbindung).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSWORD = "Ein Satz zur Begrüßung in Gareth";
const snowflake = (): string => `2${String(Math.floor(Math.random() * 1e17)).padStart(17, "0")}`;

describeWithDatabase("Einladungen", { timeout: 90_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    const users = new Map<string, DiscordUser>();
    const discord: DiscordClient = {
        exchangeCode: async (code) => (users.has(code) ? { accessToken: `tok-${code}` } : undefined),
        fetchUser: async (token) => users.get(token.slice(4)),
        revoke: async () => undefined,
    };
    const created: string[] = [];

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    async function build(): Promise<FastifyInstance> {
        const instance = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            discordClient: discord,
            logStream: { write: () => undefined },
        });
        await instance.ready();
        return instance;
    }

    const post = (url: string, payload: unknown, cookie?: string) =>
        app!.inject({
            method: "POST",
            url,
            payload: payload as object,
            headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
        });

    async function invite(role: "editor" | "admin", options: { bound?: string; validDays?: 1 | 7 } = {}) {
        const inviter = await fixture.person("operator", { name: "Rondrikan" });
        const invitation = await createInvitation(database, {
            environment: "test",
            role,
            validDays: options.validDays ?? 7,
            note: "Hesindian vom Kartenforum",
            boundDiscordUserId: options.bound ?? null,
            createdBy: inviter.id,
        });
        created.push(invitation.id);
        return invitation;
    }

    async function viaDiscord(token: string, user: DiscordUser) {
        users.set("c", user);
        const start = await post("/api/auth/discord/start", { purpose: "invitation", invitationToken: token });
        if (start.statusCode !== 200) return start;
        const state = new URL(start.json().authorizeUrl as string).searchParams.get("state")!;
        const nonce = String([start.headers["set-cookie"]].flat()[0]).split(";")[0]!;
        return app!.inject({
            method: "GET",
            url: `/api/auth/discord/callback?code=c&state=${state}`,
            headers: { cookie: nonce },
        });
    }

    async function acceptedPerson(invitationId: string): Promise<string | null> {
        const [row] = await database<{ person: string | null }[]>`
            SELECT accepted_person_id AS person FROM avesmaps_auth.invitation WHERE id = ${invitationId}
        `;
        return row?.person ?? null;
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
        const persons = await database<{ id: string }[]>`
            SELECT accepted_person_id AS id FROM avesmaps_auth.invitation WHERE id = ANY(${created}) AND accepted_person_id IS NOT NULL
        `;
        const ids = persons.map((row) => row.id);
        await database`DELETE FROM avesmaps_auth.security_event WHERE target_person_id = ANY(${ids}) OR actor_person_id = ANY(${ids})`;
        await database`DELETE FROM avesmaps_auth.oauth_flow WHERE invitation_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.invitation WHERE id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.session WHERE person_id = ANY(${ids})`;
        await database`DELETE FROM avesmaps_auth.password_login WHERE person_id = ANY(${ids})`;
        await database`DELETE FROM avesmaps_auth.discord_login WHERE person_id = ANY(${ids})`;
        await database`DELETE FROM avesmaps_auth.person_access WHERE person_id = ANY(${ids})`;
        await database`DELETE FROM avesmaps_auth.person WHERE id = ANY(${ids})`;
        created.length = 0;
        users.clear();
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 ansehen verbraucht nichts und verrät die Notiz nicht", async () => {
        app = await build();
        const { token } = await invite("editor");
        for (let index = 0; index < 2; index += 1) {
            const inspect = await post("/api/auth/invitations/inspect", { token });
            expect(inspect.json()).toMatchObject({
                role: "editor",
                environment: "test",
                invitedBy: "Rondrikan",
                requiresDiscord: false,
            });
            expect(inspect.body).not.toContain("Kartenforum");
        }
    });

    it("🔴 mit Passwort annehmen: neue Person mit der Rolle, angemeldet, Einladung verbraucht und protokolliert", async () => {
        app = await build();
        const invitation = await invite("editor");
        const loginName = `i-${randomUUID().slice(0, 8)}`;
        const accepted = await post("/api/auth/invitations/accept", {
            token: invitation.token,
            loginName,
            displayName: "Hesindian",
            password: PASSWORD,
        });
        expect(accepted.statusCode).toBe(200);
        const cookie = String([accepted.headers["set-cookie"]].flat()[0]).split(";")[0]!;
        const session = (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).json();
        expect(session.person).toMatchObject({ displayName: "Hesindian", role: "editor", methods: ["password"] });
        expect(await acceptedPerson(invitation.id)).toBe(session.person.id);
        const again = await post("/api/auth/invitations/accept", {
            token: invitation.token,
            loginName: `${loginName}x`,
            displayName: "Zweiter",
            password: PASSWORD,
        });
        expect(again.json().error.code).toBe("invitation_invalid");
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'invitation.accepted' AND target_person_id = ${session.person.id}
        `;
        expect(event?.details).toEqual({ role: "editor", method: "password", tokenHint: invitation.tokenHint });
    });

    it("🔴 mit Discord annehmen: neue Person, Discord-Konto gebunden, danach normaler Login ohne neue Einladung", async () => {
        app = await build();
        const invitation = await invite("editor");
        const user: DiscordUser = { id: snowflake(), username: "praiodan", globalName: "Praiodan" };
        const response = await viaDiscord(invitation.token, user);
        expect(response.headers.location).toBe("/anmelden?anmeldung=willkommen");
        const personId = await acceptedPerson(invitation.id);
        expect(personId).not.toBeNull();
        users.set("c2", user);
        const start = await post("/api/auth/discord/start", { purpose: "login" });
        const state = new URL(start.json().authorizeUrl as string).searchParams.get("state")!;
        const nonce = String([start.headers["set-cookie"]].flat()[0]).split(";")[0]!;
        const login = await app.inject({
            method: "GET",
            url: `/api/auth/discord/callback?code=c2&state=${state}`,
            headers: { cookie: nonce },
        });
        expect(login.headers.location).toBe("/anmelden?anmeldung=ok");
    });

    it("🔴 abgelaufen, zurückgezogen und mit schon bekanntem Discord-Konto: nichts wird angelegt", async () => {
        app = await build();
        const expired = await invite("editor");
        await database`UPDATE avesmaps_auth.invitation SET expires_at = now() - interval '1 minute' WHERE id = ${expired.id}`;
        expect((await post("/api/auth/invitations/inspect", { token: expired.token })).json().error.code).toBe(
            "invitation_invalid",
        );

        const revoked = await invite("editor");
        await database`UPDATE avesmaps_auth.invitation SET revoked_at = now() WHERE id = ${revoked.id}`;
        expect(
            (await post("/api/auth/discord/start", { purpose: "invitation", invitationToken: revoked.token })).json()
                .error.code,
        ).toBe("invitation_invalid");

        const known = await fixture.person("editor");
        const user: DiscordUser = { id: snowflake(), username: "bekannt", globalName: "Bekannt" };
        await database`INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES (${known.id}, ${user.id})`;
        const open = await invite("editor");
        expect((await viaDiscord(open.token, user)).headers.location).toBe("/anmelden?anmeldung=schon_konto");
        expect(await acceptedPerson(open.id)).toBeNull();
    });

    it("🔴 Admin-Einladungen nur gebunden; ein fremdes Discord-Konto löst sie nicht ein, Passwort auch nicht (D3, T22)", async () => {
        app = await build();
        await expect(invite("admin")).rejects.toThrow(ApiError);
        const owner = snowflake();
        const invitation = await invite("admin", { bound: owner });
        expect((await post("/api/auth/invitations/inspect", { token: invitation.token })).json().requiresDiscord).toBe(
            true,
        );
        const byPassword = await post("/api/auth/invitations/accept", {
            token: invitation.token,
            loginName: `i-${randomUUID().slice(0, 8)}`,
            displayName: "Fremd",
            password: PASSWORD,
        });
        expect(byPassword.json().error.code).toBe("invitation_requires_discord");
        const stranger = await viaDiscord(invitation.token, { id: snowflake(), username: "fremd", globalName: null });
        expect(stranger.headers.location).toBe("/anmelden?anmeldung=andere_person");
        expect(await acceptedPerson(invitation.id)).toBeNull();
        const right = await viaDiscord(invitation.token, {
            id: owner,
            username: "hesindiane",
            globalName: "Hesindiane",
        });
        expect(right.headers.location).toBe("/anmelden?anmeldung=willkommen");
        // Der neue Admin kommt über Discord, ohne Passkey: Stufe R, die Verwaltung wartet auf den Passkey (Betreiber 2026-10-10:
        // „4. B“). Discords Zwei-Faktor-Angabe wird dabei nicht gespeichert („B: nicht mehr speichern“).
        const [stored] = await database<{ mfa: string | null }[]>`
            SELECT to_jsonb(dl) ->> 'mfa_enabled' AS mfa FROM avesmaps_auth.discord_login dl WHERE dl.discord_user_id = ${owner}
        `;
        expect(stored).toEqual({ mfa: null });
        const cookie = [right.headers["set-cookie"]]
            .flat()
            .map(String)
            .find((c) => c.startsWith("__Host-avesmaps-session="))!
            .split(";")[0]!;
        const session = (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).json();
        expect(session.person).toMatchObject({ role: "admin", assurance: "basic", sessionMethod: "discord" });
    });

    it("🔴 gleichzeitige Annahme: genau eine gewinnt", async () => {
        app = await build();
        const invitation = await invite("editor");
        const attempts = await Promise.all(
            [1, 2, 3].map((index) =>
                post("/api/auth/invitations/accept", {
                    token: invitation.token,
                    loginName: `i-${randomUUID().slice(0, 8)}`,
                    displayName: `Gleichzeitig ${String(index)}`,
                    password: PASSWORD,
                }),
            ),
        );
        expect(attempts.filter((response) => response.statusCode === 200)).toHaveLength(1);
        const [count] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.person WHERE display_name LIKE 'Gleichzeitig %'
        `;
        expect(count?.n).toBe(1);
    });
});
