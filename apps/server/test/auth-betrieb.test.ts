import Fastify, { type FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { AUTH_CHANGE_CHANNEL, watchAuthChanges } from "../src/auth/change-watch.ts";
import { discordState } from "../src/auth/config.ts";
import { registerAuth } from "../src/auth/plugin.ts";
import { randomToken } from "../src/auth/tokens.ts";
import { isNotProvisioned, type Database } from "../src/database.ts";
import { registerErrorHandler } from "../src/error-handler.ts";
import { SESSION_COOKIE, TEST_AUTH } from "./support/auth-fixture.ts";

/**
 * Was Claudio für den Betrieb verlangt (WI-0120 A12, `handovers/2026-10-09-auth-einschaetzung-antwort.md`): Ohne Schema und ohne Rechte
 * bleibt die Anmeldung ruhig (503, kein 500), ein fehlendes Geheimnis schaltet Discord ab und sagt es ohne Wert, und nach einem
 * Wiederverbinden der `LISTEN`-Verbindung wird alles neu geprüft.
 */

const missing = (code: string) => new postgres.PostgresError({ message: `fehlt (${code})`, code } as never);

describe("Instanz vor `migrate` und `db-grants` (Punkt 2)", () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    /** Eine Anwendung, deren Datenbank jede Anfrage mit `code` ablehnt: so sieht eine Instanz ohne Schema oder Rechte aus. */
    async function withoutSchema(code: string): Promise<FastifyInstance> {
        const instance = Fastify();
        instance.decorate("database", (() => Promise.reject(missing(code))) as unknown as Database);
        registerErrorHandler(instance);
        registerAuth(instance, TEST_AUTH);
        const envelope = { config: { errorEnvelope: true } };
        instance.get("/api/auth/sitzung", envelope, async (request) => ({
            person: (await request.auth.session()) ?? null,
        }));
        instance.get("/api/admin/direkt", envelope, async () => {
            throw missing(code);
        });
        instance.get("/api/karte", async () => {
            throw missing(code);
        });
        await instance.ready();
        return instance;
    }

    it("🔴 Tabelle, Schema, Funktion oder Recht fehlen: die Anmeldung antwortet 503 `auth_unavailable`, die Verwaltung 503 `not_provisioned`, nie 500", async () => {
        for (const code of ["42P01", "3F000", "42883", "42501"]) {
            app = await withoutSchema(code);
            const cookie = `${SESSION_COOKIE}=${randomToken()}`;
            const session = await app.inject({ method: "GET", url: "/api/auth/sitzung", headers: { cookie } });
            expect([code, session.statusCode, session.json().error.code]).toEqual([code, 503, "auth_unavailable"]);
            // `/api/admin/` ist Verwaltung: Dort heißt es „nicht eingerichtet“, nicht „Anmeldung“ (04c88ce5, error-handler.ts).
            const direct = await app.inject({ method: "GET", url: "/api/admin/direkt" });
            expect([code, direct.statusCode, direct.json().error.code]).toEqual([code, 503, "not_provisioned"]);
            await app.close();
            app = undefined;
        }
    });

    it("🔴 ohne Cookie fragt niemand die Datenbank, und außerhalb der Anmeldung bleibt ein fehlendes Schema ein Fehler (500)", async () => {
        app = await withoutSchema("42P01");
        const anonymous = await app.inject({ method: "GET", url: "/api/auth/sitzung" });
        expect(anonymous.statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/api/karte" })).statusCode).toBe(500);
    });

    it("erkennt nur die vier Zustände, und nur an einem Fehler von PostgreSQL", () => {
        expect(["42P01", "3F000", "42883", "42501"].every((code) => isNotProvisioned(missing(code)))).toBe(true);
        expect(isNotProvisioned(missing("08006"))).toBe(false);
        expect(isNotProvisioned(Object.assign(new Error("x"), { code: "42P01" }))).toBe(false);
    });
});

describe("Discord ohne Geheimnis (Punkt 3)", () => {
    it("🔴 schaltet Discord ab und nennt den fehlenden Namen, nie den Wert", () => {
        expect(discordState({ DISCORD_CLIENT_ID: "1234567890", DISCORD_CLIENT_SECRET: "geheim-geheim" })).toEqual({
            on: true,
        });
        const ohne = discordState({ DISCORD_CLIENT_ID: "1234567890", DISCORD_CLIENT_SECRET: "" });
        expect(ohne).toEqual({ on: false, reason: "DISCORD_CLIENT_SECRET fehlt" });
        expect(JSON.stringify(ohne)).not.toContain("1234567890");
        expect(discordState({ DISCORD_CLIENT_SECRET: "geheim-geheim" })).toEqual({
            on: false,
            reason: "DISCORD_CLIENT_ID fehlt",
        });
        expect(discordState({}).on).toBe(false);
    });
});

describe("Wiederverbinden der LISTEN-Verbindung (Punkt 9)", () => {
    it("🔴 nach jedem Wiederverbinden wird alles neu geprüft, beim ersten LISTEN nicht", async () => {
        const changed: string[] = [];
        let resyncs = 0;
        let channel = "";
        let deliver: ((payload: string) => void) | undefined;
        let listening: (() => void) | undefined;
        const database = {
            listen: async (name: string, onNotify: (payload: string) => void, onListen?: () => void) => {
                channel = name;
                deliver = onNotify;
                listening = onListen;
                onListen?.();
                return { unlisten: async () => undefined };
            },
        } as unknown as Database;
        await watchAuthChanges(
            database,
            (personId) => changed.push(personId),
            undefined,
            () => (resyncs += 1),
        );
        expect(channel).toBe(AUTH_CHANGE_CHANNEL);
        expect(resyncs).toBe(0);
        deliver?.("0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51");
        deliver?.("kein-uuid");
        expect(changed).toEqual(["0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51"]);
        // postgres.js ruft `onlisten` nach jedem Wiederverbinden erneut.
        listening?.();
        listening?.();
        expect(resyncs).toBe(2);
    });
});
