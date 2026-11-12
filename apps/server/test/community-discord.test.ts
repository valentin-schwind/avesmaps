import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    COMMUNITY_DISCORD_OFFEN_PFAD,
    COMMUNITY_DISCORD_SIGNATUR_KOPF,
    COMMUNITY_DISCORD_ZEIT_KOPF,
    COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
    CommunityDiscordOffenAntwort,
    CommunityDiscordZurueckziehenAntwort,
    CommunityStand,
    StatusDiscordLoesenAntwort,
    StatusSicht,
    VorgangDetail,
    signiere,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { DiscordClient, DiscordUser } from "../src/auth/discord-client.ts";
import type { ServerConfig } from "../src/config.ts";
import { communityBruecke } from "../src/discord/community-bruecke.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * „Mit Discord verbinden“ für Melder und die Production-Seite der Brücke (WI-0268 C8; Fachkonzept §8.2 bis §8.5 und §8.3a; Migration 0283) gegen echtes PostgreSQL. Discord selbst ist gestellt (nur der Draht
 * zu Discord); kein Aufruf geht nach außen.
 *
 * - Verbinden über den Weg `melder` von `auth-discord.ts`: Start mit dem Statusschlüssel im Rumpf, Rückweg mit gestelltem Discord, Kennung und Anzeigename am Melder, Statusseite und Redaktion sehen den NAMEN, nie die
 *   Kennung; Lösen entfernt die Kennung aus allen Vorgängen derselben Verbindung.
 * - Brücke: ohne Schlüssel 404, falsche oder alte Signatur und veränderter Rumpf 401 (immer derselbe Satz), gültig → nur eigene offene Vorgänge (fremde Kennung sieht nichts; abgeschlossene und Papierkorb fehlen),
 *   Antwort streng nach dem Schema ohne Text, Name, Adresse, Kennung; Zurückziehen mit allen drei Ergebnissen; Grenzen; Kennung in keinem Protokoll.
 * - Aufbewahrung: Kennung und Anzeigename fallen mit den Kontaktdaten weg.
 * - Ein Durchlauf Client ↔ Server: `discord/community-bruecke.ts` gegen die echte Route (Signatur und Schema passen zusammen).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ORT = "11111111-2222-4333-8444-555555555555";
const SCHLUESSEL = "bruecke-" + "k".repeat(40);
const ENV_NAME = "COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL";
const STATUS_FEHLT = "Zu diesem Link gibt es keine Meldung (mehr).";

/** sha256 des Statusschlüssels als Hex (so speichert ihn `melden`). */
const schluesselHashHex = (schluessel: string): string => createHash("sha256").update(schluessel, "utf8").digest("hex");

const snowflake = (): string => `1${String(Math.floor(Math.random() * 1e17)).padStart(17, "0")}`;

/** Discord im Kleinen: Code → Konto; merkt sich Widerrufe. */
function fakeDiscord(): DiscordClient & { users: Map<string, DiscordUser>; revoked: string[]; failExchange: boolean } {
    const users = new Map<string, DiscordUser>();
    const fake = {
        users,
        revoked: [] as string[],
        failExchange: false,
        async exchangeCode(code: string) {
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

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-discord-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Community: Mit Discord verbinden und die Brücke (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let discord: ReturnType<typeof fakeDiscord>;
    let app: FastifyInstance;
    let lena: { id: string; cookie: string };
    const logs: string[] = [];
    let ip = 10;
    const neueAdresse = (): string => `10.30.0.${String(ip++)}`;
    const gesichert = process.env[ENV_NAME];

    function baue(client: DiscordClient): FastifyInstance {
        return buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            discordClient: client,
            logStream: { write: (line: string) => void logs.push(line) },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
    }

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_auth.oauth_flow WHERE purpose = 'melder'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        discord = fakeDiscord();
        app = baue(discord);
        await app.ready();
        const person = await fixture.person("reviewer", { name: "Lena" });
        lena = { id: person.id, cookie: (await fixture.session(person.id)).cookie };
    });

    beforeEach(async () => {
        await leeren();
        logs.length = 0;
        process.env[ENV_NAME] = SCHLUESSEL;
    });

    afterEach(() => {
        if (gesichert === undefined) delete process.env[ENV_NAME];
        else process.env[ENV_NAME] = gesichert;
    });

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    /** Legt eine Meldung an (wie `community_melden`, ohne die Drossel der Route) und gibt Nummer, Schlüssel und Id zurück. */
    async function legeAn(
        optionen: { name?: string | null; bezug?: Record<string, unknown>; text?: string } = {},
    ): Promise<{ id: number; nummer: string; schluessel: string }> {
        const schluessel = randomBytes(32).toString("base64url");
        const bezug = optionen.bezug ?? {
            art: "objekt",
            objektArt: "place",
            objektId: ORT,
            name: "Wehrheim",
            typ: "Stadt",
            lage: { x: 500, y: 400 },
        };
        const [zeile] = await database<{ id: string }[]>`
            SELECT avesmaps_community.community_melden(
                ${randomUUID()}::uuid, 'lage', ${optionen.text ?? "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße."},
                NULL, NULL, ${optionen.name === undefined ? "Alrike" : optionen.name}, ${Buffer.from(schluesselHashHex(schluessel), "hex")},
                ${database.json(bezug as never)}::jsonb
            )::text AS id
        `;
        const id = Number(zeile!.id);
        return { id, nummer: `COM-${String(id).padStart(6, "0")}`, schluessel };
    }

    // --- Verbinden über Discord --------------------------------------------------------------------------------------------

    /** Startet den Umweg des Melders und gibt `state`, das Nonce-Cookie und die Antwort zurück. */
    async function start(schluessel: string, extra: Record<string, unknown> = {}) {
        const response = await app.inject({
            method: "POST",
            url: "/api/auth/discord/start",
            remoteAddress: neueAdresse(),
            headers: { origin: TEST_ORIGIN },
            payload: { purpose: "melder", schluessel, ...extra },
        });
        if (response.statusCode !== 200) return { response };
        const url = new URL(response.json().authorizeUrl as string);
        const nonce = [response.headers["set-cookie"]]
            .flat()
            .map(String)
            .find((c) => c.startsWith("__Host-avesmaps-oauth="))!
            .split(";")[0]!;
        return { response, url, state: url.searchParams.get("state")!, nonce };
    }
    const rueckweg = (query: string, cookies: string[]) =>
        app.inject({
            method: "GET",
            url: `/api/auth/discord/callback?${query}`,
            headers: { cookie: cookies.join("; ") },
        });

    /** Verbindet eine Meldung mit einer Kennung über den ganzen Weg und gibt die Antwort des Rückwegs zurück. */
    async function verbinde(schluessel: string, user: DiscordUser) {
        const code = `c-${randomUUID()}`;
        discord.users.set(code, user);
        const { state, nonce } = await start(schluessel);
        return rueckweg(`code=${code}&state=${state}`, [nonce!]);
    }
    const melderZeile = async (id: number) =>
        (
            await database<{ discord_id: string | null; discord_name: string | null; entfernt_at: Date | null }[]>`
                SELECT discord_id, discord_name, entfernt_at FROM avesmaps_community.melder WHERE vorgang_id = ${id}
            `
        )[0]!;
    const status = (schluessel: string) =>
        app.inject({
            method: "POST",
            url: "/api/community/status",
            remoteAddress: neueAdresse(),
            headers: { origin: TEST_ORIGIN },
            payload: { schluessel },
        });

    it("stand: `discord` ist an, wenn die Anmeldung mit Discord eingerichtet ist (Umgebung, Anwendung, Draht)", async () => {
        const antwort = await app.inject({ method: "GET", url: "/api/community/stand" });
        expect(Value.Check(CommunityStand, antwort.json())).toBe(true);
        expect(antwort.json()).toMatchObject({ meldungen: true, discord: true });
    });

    it("🔴 Start: Bereich identify, Zustimmung erzwungen, der Schlüssel steht in keiner Adresse; in der Datenbank nur sein Hash", async () => {
        const m = await legeAn();
        const { url, state, response } = await start(m.schluessel);
        expect(response.statusCode).toBe(200);
        expect(url!.searchParams.get("scope")).toBe("identify");
        expect(url!.searchParams.get("prompt")).toBe("consent");
        expect(response.body).not.toContain(m.schluessel);
        expect(url!.toString()).not.toContain(m.schluessel);
        const [fluss] = await database<
            { purpose: string; return_path: string; melder_hash: Buffer; person_id: string | null }[]
        >`
            SELECT purpose, return_path, melder_hash, person_id FROM avesmaps_auth.oauth_flow WHERE purpose = 'melder'
        `;
        expect(fluss).toMatchObject({ purpose: "melder", return_path: "/meldung", person_id: null });
        expect(fluss!.melder_hash.toString("hex")).toBe(schluesselHashHex(m.schluessel));
        expect(JSON.stringify(fluss)).not.toContain(m.schluessel);
        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        // Der Rücksprung ist fest `/meldung`, gleich was der Rumpf sagt.
        const fremd = await start(m.schluessel, { returnPath: "/edit?x=1" });
        expect(fremd.response.statusCode).toBe(200);
        const zeilen = await database<
            { return_path: string }[]
        >`SELECT return_path FROM avesmaps_auth.oauth_flow WHERE purpose = 'melder'`;
        expect(zeilen.map((z) => z.return_path)).toEqual(["/meldung", "/meldung"]);
    });

    it("🔴 Start: ein unbekannter Schlüssel ist derselbe 404-Satz wie auf der Statusseite, einer ohne Form 400, ohne Schlüssel 400; nichts wird angelegt", async () => {
        const unbekannt = await start(randomBytes(32).toString("base64url"));
        expect(unbekannt.response.statusCode).toBe(404);
        expect(unbekannt.response.json().error).toEqual({ code: "community_not_found", message: STATUS_FEHLT });
        expect((await start("zu-kurz")).response.statusCode).toBe(400);
        const ohne = await app.inject({
            method: "POST",
            url: "/api/auth/discord/start",
            remoteAddress: neueAdresse(),
            headers: { origin: TEST_ORIGIN },
            payload: { purpose: "melder" },
        });
        expect(ohne.statusCode).toBe(400);
        expect((await database`SELECT 1 FROM avesmaps_auth.oauth_flow WHERE purpose = 'melder'`).length).toBe(0);
    });

    it("🔴 Rückweg: Kennung und Anzeigename am Melder; Statusseite und Redaktion zeigen den NAMEN, nie die Kennung; der Schlüssel steht in keiner Adresse; Token widerrufen; Hash geleert", async () => {
        const m = await legeAn();
        const user: DiscordUser = { id: snowflake(), username: "praiodan", globalName: "Praiodan der Strenge" };
        const antwort = await verbinde(m.schluessel, user);
        expect(antwort.statusCode).toBe(303);
        expect(antwort.headers.location).toBe("/meldung?discord=verbunden");
        expect(String(antwort.headers.location)).not.toContain(m.schluessel);
        expect(discord.revoked).toHaveLength(1);
        // Kein Cookie der Anmeldung: Der Melder ist niemand Angemeldetes.
        const gesetzt = [antwort.headers["set-cookie"]].flat().map(String);
        expect(gesetzt.some((c) => c.startsWith("__Host-avesmaps-session=") && !c.includes("Max-Age=0"))).toBe(false);
        expect(await melderZeile(m.id)).toMatchObject({ discord_id: user.id, discord_name: "Praiodan der Strenge" });
        const [fluss] = await database<
            { melder_hash: Buffer | null }[]
        >`SELECT melder_hash FROM avesmaps_auth.oauth_flow WHERE purpose = 'melder'`;
        expect(fluss!.melder_hash).toBeNull();

        // Statusseite: der Name, nie die Kennung.
        const sicht = await status(m.schluessel);
        expect(Value.Check(StatusSicht, sicht.json())).toBe(true);
        expect(sicht.json()).toMatchObject({ nummer: m.nummer, discordName: "Praiodan der Strenge" });
        expect(sicht.body).not.toContain(user.id);
        // Redaktion: „Discord: Name“, Rückweg `discord`, nie die Kennung.
        const detail = await app.inject({
            method: "GET",
            url: `/api/community/vorgaenge/${m.nummer}`,
            headers: { cookie: lena.cookie },
        });
        expect(detail.statusCode).toBe(200);
        expect(Value.Check(VorgangDetail, detail.json())).toBe(true);
        expect(detail.json().melder).toMatchObject({ discordName: "Praiodan der Strenge" });
        expect(detail.json().melder.rueckwege).toContain("discord");
        expect(detail.body).not.toContain(user.id);
        // Eine Meldung ohne Verbindung hat kein `discordName`.
        const andere = await legeAn();
        expect((await status(andere.schluessel)).json().discordName).toBeNull();
    });

    it("🔴 Rückweg: abgebrochen, Discord-Fehler, falsches Nonce und eine Meldung, die inzwischen weg ist, verbinden nichts", async () => {
        const m = await legeAn();
        // Abbruch bei Discord.
        const a = await start(m.schluessel);
        const abgebrochen = await rueckweg(`error=access_denied&state=${a.state}`, [a.nonce!]);
        expect(abgebrochen.headers.location).toBe("/meldung?discord=abgebrochen");
        // Austausch des Codes scheitert.
        const b = await start(m.schluessel);
        discord.users.set("c-fehl", { id: snowflake(), username: "x", globalName: "X" });
        discord.failExchange = true;
        expect((await rueckweg(`code=c-fehl&state=${b.state}`, [b.nonce!])).headers.location).toBe(
            "/meldung?discord=discord_fehler",
        );
        discord.failExchange = false;
        // Ein fremder Browser (Nonce passt nicht) verbrennt den Umweg und verbindet nichts.
        const c = await start(m.schluessel);
        discord.users.set("c-fremd", { id: snowflake(), username: "y", globalName: "Y" });
        const fremd = await rueckweg(`code=c-fremd&state=${c.state}`, ["__Host-avesmaps-oauth=falsch"]);
        expect(fremd.headers.location).toBe("/anmelden?anmeldung=abgelaufen");
        expect(await melderZeile(m.id)).toMatchObject({ discord_id: null, discord_name: null });
        // Der Umweg ist verbraucht: Derselbe `state` noch einmal verbindet nichts.
        const nochmal = await rueckweg(`code=c-fremd&state=${c.state}`, [c.nonce!]);
        expect(nochmal.headers.location).toBe("/anmelden?anmeldung=abgelaufen");
        // Die Meldung verschwindet zwischen Start und Rückweg (Papierkorb endgültig): `nicht_gefunden`, ohne Fehler.
        const d = await start(m.schluessel);
        await database`DELETE FROM avesmaps_community.vorgang WHERE id = ${m.id}`;
        discord.users.set("c-weg", { id: snowflake(), username: "z", globalName: "Z" });
        expect((await rueckweg(`code=c-weg&state=${d.state}`, [d.nonce!])).headers.location).toBe(
            "/meldung?discord=nicht_gefunden",
        );
        // Nach alledem ist an keinem Umweg ein Hash übrig.
        const rest =
            await database`SELECT 1 FROM avesmaps_auth.oauth_flow WHERE purpose = 'melder' AND melder_hash IS NOT NULL`;
        expect(rest.length).toBe(0);
    });

    it("🔴 Der Anzeigename ist gesäubert und höchstens 40 Zeichen; ohne Namen steht „Discord-Konto“", async () => {
        const m = await legeAn();
        await verbinde(m.schluessel, { id: snowflake(), username: "u", globalName: "Rondrikan‮ der Kühne" });
        expect((await melderZeile(m.id)).discord_name).toBe("Rondrikan der Kühne");
        const n = await legeAn();
        await verbinde(n.schluessel, { id: snowflake(), username: "", globalName: "​" });
        expect((await melderZeile(n.id)).discord_name).toBe("Discord-Konto");
    });

    it("🔴 Lösen entfernt die Kennung aus ALLEN Vorgängen derselben Verbindung, nicht aus fremden; ein zweites Lösen ist nichts; ein unbekannter Schlüssel der 404-Satz", async () => {
        const user: DiscordUser = { id: snowflake(), username: "praiodan", globalName: "Praiodan" };
        const fremderUser: DiscordUser = { id: snowflake(), username: "tsa", globalName: "Tsa" };
        const eins = await legeAn();
        const zwei = await legeAn();
        const fremd = await legeAn();
        await verbinde(eins.schluessel, user);
        await verbinde(zwei.schluessel, user);
        await verbinde(fremd.schluessel, fremderUser);
        const loesen = (schluessel: string) =>
            app.inject({
                method: "POST",
                url: "/api/community/status/discord-loesen",
                remoteAddress: neueAdresse(),
                headers: { origin: TEST_ORIGIN },
                payload: { schluessel },
            });
        const geloest = await loesen(eins.schluessel);
        expect(geloest.statusCode).toBe(200);
        expect(Value.Check(StatusDiscordLoesenAntwort, geloest.json())).toBe(true);
        expect(geloest.json()).toEqual({ geloest: 2 });
        expect(await melderZeile(eins.id)).toMatchObject({ discord_id: null, discord_name: null });
        expect(await melderZeile(zwei.id)).toMatchObject({ discord_id: null, discord_name: null });
        expect(await melderZeile(fremd.id)).toMatchObject({ discord_id: fremderUser.id, discord_name: "Tsa" });
        expect((await loesen(eins.schluessel)).json()).toEqual({ geloest: 0 });
        expect((await status(eins.schluessel)).json().discordName).toBeNull();
        const unbekannt = await loesen(randomBytes(32).toString("base64url"));
        expect(unbekannt.statusCode).toBe(404);
        expect(unbekannt.json().error).toEqual({ code: "community_not_found", message: STATUS_FEHLT });
        // Nur von der eigenen Seite.
        const ohneOrigin = await app.inject({
            method: "POST",
            url: "/api/community/status/discord-loesen",
            remoteAddress: neueAdresse(),
            payload: { schluessel: zwei.schluessel },
        });
        expect(ohneOrigin.statusCode).toBe(403);
    });

    // --- Die Brücke --------------------------------------------------------------------------------------------------------

    /** Eine gültig signierte Anfrage an die Brücke (so wie die Stage sie schickt). */
    async function bruecke(
        pfad: string,
        rumpf: Record<string, unknown>,
        optionen: {
            zeit?: number;
            schluessel?: string;
            signierterRumpf?: string;
            kopf?: Record<string, string>;
            ohneKopf?: boolean;
        } = {},
    ) {
        const text = JSON.stringify(rumpf);
        const zeit = String(optionen.zeit ?? Date.now());
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (optionen.ohneKopf !== true) {
            headers[COMMUNITY_DISCORD_ZEIT_KOPF] = zeit;
            headers[COMMUNITY_DISCORD_SIGNATUR_KOPF] = await signiere(
                optionen.schluessel ?? SCHLUESSEL,
                zeit,
                optionen.signierterRumpf ?? text,
            );
        }
        return app.inject({ method: "POST", url: pfad, headers: { ...headers, ...optionen.kopf }, payload: text });
    }
    const offen = (discordId: string, optionen: Parameters<typeof bruecke>[2] = {}) =>
        bruecke(COMMUNITY_DISCORD_OFFEN_PFAD, { discordId }, optionen);
    const zurueck = (discordId: string, nummer: string, optionen: Parameters<typeof bruecke>[2] = {}) =>
        bruecke(COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD, { discordId, nummer }, optionen);

    /** Verbindet eine Meldung direkt in der Datenbank mit einer Kennung (der Weg über Discord ist oben geprüft). */
    async function verbundenMit(id: number, kennung: string, name = "Praiodan"): Promise<void> {
        await database`UPDATE avesmaps_community.melder SET discord_id = ${kennung}, discord_name = ${name} WHERE vorgang_id = ${id}`;
    }

    it("🔴 ohne Schlüssel (oder mit einem unter 32 Zeichen) gibt es die zwei Wege nicht: 404 wie für jeden unbekannten Pfad, auch mit gültiger Signatur", async () => {
        const kennung = snowflake();
        const unbekannt = await app.inject({ method: "POST", url: "/api/community/discord/gibtsnicht", payload: {} });
        delete process.env[ENV_NAME];
        for (const pfad of [COMMUNITY_DISCORD_OFFEN_PFAD, COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD]) {
            const antwort = await bruecke(pfad, { discordId: kennung, nummer: "COM-000001" });
            expect(antwort.statusCode, pfad).toBe(404);
            expect(antwort.json(), pfad).toEqual({
                ...unbekannt.json(),
                message: String(unbekannt.json().message).replace("/api/community/discord/gibtsnicht", pfad),
            });
        }
        process.env[ENV_NAME] = "zu-kurz";
        expect((await offen(kennung)).statusCode).toBe(404);
    });

    it("🔴 falsche, alte, zukünftige und fehlende Signatur und ein veränderter Rumpf: immer dieselbe 401, ohne Hinweis worauf", async () => {
        const kennung = snowflake();
        const falle = {
            "falscher Schlüssel": await offen(kennung, { schluessel: "ein-anderer-" + "x".repeat(40) }),
            "zu alt": await offen(kennung, { zeit: Date.now() - 61_000 }),
            "aus der Zukunft": await offen(kennung, { zeit: Date.now() + 30_000 }),
            "ohne Kopfzeilen": await offen(kennung, { ohneKopf: true }),
            "Rumpf verändert": await offen(kennung, { signierterRumpf: JSON.stringify({ discordId: snowflake() }) }),
            "Signatur unlesbar": await offen(kennung, { kopf: { [COMMUNITY_DISCORD_SIGNATUR_KOPF]: "nicht-hex" } }),
        };
        for (const [grund, antwort] of Object.entries(falle)) {
            expect(antwort.statusCode, grund).toBe(401);
            expect(antwort.json().error, grund).toEqual({
                code: "bruecke_nicht_zugelassen",
                message: "Die Anfrage ist nicht zugelassen.",
            });
        }
        const zurueckgewiesen = await zurueck(kennung, "COM-000001", { schluessel: "ein-anderer-" + "x".repeat(40) });
        expect(zurueckgewiesen.statusCode).toBe(401);
        // Eine fremde Seite (Browser) hat weder Schlüssel noch Signatur.
        const ohne = await app.inject({
            method: "POST",
            url: COMMUNITY_DISCORD_OFFEN_PFAD,
            payload: { discordId: kennung },
        });
        expect(ohne.statusCode).toBe(401);
    });

    it("🔴 gültig signiert, aber Form und Rumpf falsch: 400 (Kennung mit der falschen Form, zusätzliches Feld, kein JSON, zu groß)", async () => {
        expect((await bruecke(COMMUNITY_DISCORD_OFFEN_PFAD, { discordId: "123" })).statusCode).toBe(400);
        expect((await bruecke(COMMUNITY_DISCORD_OFFEN_PFAD, { discordId: snowflake(), mehr: 1 })).statusCode).toBe(400);
        expect(
            (await bruecke(COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD, { discordId: snowflake(), nummer: "COM-1" }))
                .statusCode,
        ).toBe(400);
        const text = "kein json";
        const zeit = String(Date.now());
        const keinJson = await app.inject({
            method: "POST",
            url: COMMUNITY_DISCORD_OFFEN_PFAD,
            headers: {
                "content-type": "application/json",
                [COMMUNITY_DISCORD_ZEIT_KOPF]: zeit,
                [COMMUNITY_DISCORD_SIGNATUR_KOPF]: await signiere(SCHLUESSEL, zeit, text),
            },
            payload: text,
        });
        expect(keinJson.statusCode).toBe(400);
        const gross = "x".repeat(3000);
        const zuGross = await app.inject({
            method: "POST",
            url: COMMUNITY_DISCORD_OFFEN_PFAD,
            headers: {
                "content-type": "application/json",
                [COMMUNITY_DISCORD_ZEIT_KOPF]: zeit,
                [COMMUNITY_DISCORD_SIGNATUR_KOPF]: await signiere(SCHLUESSEL, zeit, gross),
            },
            payload: gross,
        });
        expect(zuGross.statusCode).toBe(413);
    });

    it("🔴 offen: nur die eigenen offenen Vorgänge; fremde Kennung, abgeschlossene und Papierkorb fehlen; Antwort streng nach dem Schema, ohne Text, Name, Adresse, Kennung", async () => {
        const ich = snowflake();
        const jemand = snowflake();
        const eins = await legeAn({
            name: "Alrike Geheimname",
            text: "GEHEIMER MELDETEXT zu Wehrheim, bitte nicht nach Discord.",
        });
        const zwei = await legeAn({ bezug: { art: "stelle", lage: { x: 10, y: 20 }, naechsterOrt: "Gareth" } });
        const drei = await legeAn();
        const abgeschlossen = await legeAn();
        const korb = await legeAn();
        const fremd = await legeAn();
        for (const m of [eins, zwei, drei, abgeschlossen, korb]) await verbundenMit(m.id, ich);
        await verbundenMit(fremd.id, jemand, "Anderer");
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'in_arbeit' WHERE id = ${zwei.id}`;
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'rueckfrage', rueckfrage_at = now() WHERE id = ${drei.id}`;
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'umgesetzt', abgeschlossen_at = now() WHERE id = ${abgeschlossen.id}`;
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'spam', abgeschlossen_at = now(), papierkorb_at = now() WHERE id = ${korb.id}`;

        const antwort = await offen(ich);
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("no-store");
        const body = antwort.json();
        expect(Value.Check(CommunityDiscordOffenAntwort, body)).toBe(true);
        // Neueste zuerst; Stand in Alltagssprache; Kurztitel aus Kategorie und Bezugsname.
        expect(body).toEqual({
            zeilen: [
                { nummer: drei.nummer, stand: "rueckfrage", kurztitel: "Lage falsch · Wehrheim" },
                { nummer: zwei.nummer, stand: "in_bearbeitung", kurztitel: "Lage falsch · Gareth" },
                { nummer: eins.nummer, stand: "eingegangen", kurztitel: "Lage falsch · Wehrheim" },
            ],
        });
        for (const verboten of ["GEHEIMER", "Alrike", "Geheimname", ich, jemand, "Praiodan", "Anderer"])
            expect(antwort.body, verboten).not.toContain(verboten);
        // Die andere Kennung sieht nur ihre eigene; eine unverbundene nichts.
        expect((await offen(jemand)).json()).toEqual({
            zeilen: [{ nummer: fremd.nummer, stand: "eingegangen", kurztitel: "Lage falsch · Wehrheim" }],
        });
        expect((await offen(snowflake())).json()).toEqual({ zeilen: [] });
    });

    it("🔴 offen mit Antwort (WI-0297, Option B): die letzte Nachricht der Redaktion nur an den eigenen Melder, nie eine Notiz; beantwortet und archiviert noch 30 Tage", async () => {
        const ich = snowflake();
        const jemand = snowflake();
        const [angelegt] = await database<{ id: string }[]>`
            SELECT avesmaps_community.community_aus_discord(
                ${randomUUID()}::uuid, 'frage', ${"Zyklopäisch fehlt\n\nAuf der Sprachkarte fehlt Zyklopäisch."}, 'Praiodan', ${ich}, 'OPS-000097', '[]'::jsonb
            )::text AS id
        `;
        const id = Number(angelegt!.id);
        const nummer = `COM-${String(id).padStart(6, "0")}`;
        const fremd = await legeAn();
        await verbundenMit(fremd.id, jemand, "Anderer");
        const revision = async (): Promise<number> =>
            (await database<{ r: number }[]>`SELECT revision AS r FROM avesmaps_community.vorgang WHERE id = ${id}`)[0]!
                .r;

        // Ohne Antwort: wie bisher, ohne Feld.
        expect((await offen(ich)).json()).toEqual({
            zeilen: [{ nummer, stand: "eingegangen", kurztitel: "Frage" }],
        });
        // Eine interne Notiz geht nie hinaus; die Antwort der Redaktion schon (Zustand „wartet auf Antwort“).
        await database`SELECT avesmaps_community.community_notiz(${randomUUID()}::uuid, ${id}::bigint, ${lena.id}::uuid, 'INTERNE NOTIZ nur für die Redaktion')`;
        await database`
            SELECT avesmaps_community.community_anfrage_antworten(${randomUUID()}::uuid, ${id}::bigint, ${lena.id}::uuid, ${await revision()}::int,
                                                                  ${"Danke! Zyklopäisch kommt mit der nächsten Fassung.\nGruß, die Redaktion"}, false)
        `;
        const mitAntwort = await offen(ich);
        const body = mitAntwort.json();
        expect(Value.Check(CommunityDiscordOffenAntwort, body)).toBe(true);
        expect(body.zeilen).toEqual([
            {
                nummer,
                stand: "rueckfrage",
                kurztitel: "Frage",
                antwort: {
                    text: "Danke! Zyklopäisch kommt mit der nächsten Fassung.\nGruß, die Redaktion",
                    at: expect.any(String),
                },
            },
        ]);
        for (const verboten of ["INTERNE NOTIZ", "Zyklopäisch fehlt", "Auf der Sprachkarte", "Praiodan", ich])
            expect(mitAntwort.body, verboten).not.toContain(verboten);
        // Eine andere Kennung sieht weder Vorgang noch Antwort.
        expect((await offen(jemand)).body).not.toContain("Zyklopäisch");

        // Beantwortet und gleich ins Archiv: noch da, als abgeschlossen mit der neuesten Antwort; nach 30 Tagen nicht mehr.
        await database`
            SELECT avesmaps_community.community_anfrage_antworten(${randomUUID()}::uuid, ${id}::bigint, ${lena.id}::uuid, ${await revision()}::int,
                                                                  'Erledigt, danke.', true)
        `;
        expect((await offen(ich)).json().zeilen).toEqual([
            {
                nummer,
                stand: "abgeschlossen",
                kurztitel: "Frage",
                antwort: { text: "Erledigt, danke.", at: expect.any(String) },
            },
        ]);
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '31 days' WHERE id = ${id}`;
        expect((await offen(ich)).json()).toEqual({ zeilen: [] });
    });

    it("🔴 offen liefert höchstens 20 Zeilen", async () => {
        const ich = snowflake();
        for (let i = 0; i < 22; i += 1) await verbundenMit((await legeAn()).id, ich);
        const body = (await offen(ich)).json();
        expect(Value.Check(CommunityDiscordOffenAntwort, body)).toBe(true);
        expect(body.zeilen).toHaveLength(20);
    });

    it("🔴 zurückziehen: eigene offene Meldung → zurueckgezogen (Wirkung wie auf der Statusseite), noch einmal → schon_abgeschlossen, fremde und unbekannte und Papierkorb → nicht_gefunden", async () => {
        const ich = snowflake();
        const jemand = snowflake();
        const meine = await legeAn();
        const fremde = await legeAn();
        const korb = await legeAn();
        await verbundenMit(meine.id, ich);
        await verbundenMit(fremde.id, jemand);
        await verbundenMit(korb.id, ich);
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'spam', abgeschlossen_at = now(), papierkorb_at = now() WHERE id = ${korb.id}`;

        const erste = await zurueck(ich, meine.nummer);
        expect(erste.statusCode).toBe(200);
        expect(Value.Check(CommunityDiscordZurueckziehenAntwort, erste.json())).toBe(true);
        expect(erste.json()).toEqual({ ergebnis: "zurueckgezogen" });
        const [vorgang] = await database<{ zustand: string; ergebnis: string; abgeschlossen_at: Date | null }[]>`
            SELECT zustand, ergebnis, abgeschlossen_at FROM avesmaps_community.vorgang WHERE id = ${meine.id}
        `;
        expect(vorgang).toMatchObject({ zustand: "abgeschlossen", ergebnis: "zurueckgezogen" });
        expect(vorgang!.abgeschlossen_at).not.toBeNull();
        const [ereignis] = await database<{ art: string; vom_melder: boolean; neu: string | null }[]>`
            SELECT art, vom_melder, neu FROM avesmaps_community.ereignis WHERE vorgang_id = ${meine.id} AND art = 'zurueckgezogen'
        `;
        expect(ereignis).toEqual({ art: "zurueckgezogen", vom_melder: true, neu: "zurueckgezogen" });
        // Dieselbe Kennung noch einmal: nichts Zweites.
        expect((await zurueck(ich, meine.nummer)).json()).toEqual({ ergebnis: "schon_abgeschlossen" });
        expect(
            (
                await database`SELECT 1 FROM avesmaps_community.ereignis WHERE vorgang_id = ${meine.id} AND art = 'zurueckgezogen'`
            ).length,
        ).toBe(1);
        // Fremde, unbekannte, im Papierkorb, eine Nummer ohne Form für die Datenbank: alle `nicht_gefunden`.
        expect((await zurueck(ich, fremde.nummer)).json()).toEqual({ ergebnis: "nicht_gefunden" });
        expect((await zurueck(ich, "COM-999999")).json()).toEqual({ ergebnis: "nicht_gefunden" });
        expect((await zurueck(ich, korb.nummer)).json()).toEqual({ ergebnis: "nicht_gefunden" });
        expect((await zurueck(ich, "COM-000000")).json()).toEqual({ ergebnis: "nicht_gefunden" });
        // Die fremde Meldung blieb offen, die zurückgezogene fehlt in `offen`.
        const [fremdeZeile] = await database<
            { zustand: string }[]
        >`SELECT zustand FROM avesmaps_community.vorgang WHERE id = ${fremde.id}`;
        expect(fremdeZeile!.zustand).toBe("neu");
        expect((await offen(ich)).json()).toEqual({ zeilen: [] });
    });

    it("🔴 Grenzen: höchstens 30 Anfragen je Minute für EINE Kennung (429), andere Kennungen unberührt", async () => {
        const viel = snowflake();
        for (let i = 0; i < 30; i += 1) expect((await offen(viel)).statusCode).toBe(200);
        const zuViel = await offen(viel);
        expect(zuViel.statusCode).toBe(429);
        expect(zuViel.json().error.code).toBe("bruecke_rate");
        // Auch das Zurückziehen derselben Kennung zählt mit; eine andere Kennung geht weiter.
        expect((await zurueck(viel, "COM-000001")).statusCode).toBe(429);
        expect((await offen(snowflake())).statusCode).toBe(200);
    });

    it("🔴 Grenze insgesamt: nach 300 Anfragen in der Minute antwortet die Brücke allen mit 429", async () => {
        const eigene = baue(fakeDiscord());
        await eigene.ready();
        try {
            const signiert = async (discordId: string) => {
                const text = JSON.stringify({ discordId });
                const zeit = String(Date.now());
                return eigene.inject({
                    method: "POST",
                    url: COMMUNITY_DISCORD_OFFEN_PFAD,
                    headers: {
                        "content-type": "application/json",
                        [COMMUNITY_DISCORD_ZEIT_KOPF]: zeit,
                        [COMMUNITY_DISCORD_SIGNATUR_KOPF]: await signiere(SCHLUESSEL, zeit, text),
                    },
                    payload: text,
                });
            };
            let letzte = 200;
            for (let i = 0; i < 300; i += 1) letzte = (await signiert(snowflake())).statusCode;
            expect(letzte).toBe(200);
            expect((await signiert(snowflake())).statusCode).toBe(429);
        } finally {
            await eigene.close();
        }
    });

    it("🔴 Die Discord-Kennung steht in keinem Protokoll: weder in den Logzeilen noch im Audit; kein Schlüssel, keine Signatur", async () => {
        const ich = snowflake();
        const m = await legeAn();
        await verbundenMit(m.id, ich, "Ein Name");
        await offen(ich);
        await zurueck(ich, m.nummer);
        await offen(ich, { schluessel: "ein-anderer-" + "x".repeat(40) });
        const user: DiscordUser = { id: snowflake(), username: "tsa", globalName: "Tsa" };
        const n = await legeAn();
        await verbinde(n.schluessel, user);
        const alles = logs.join("\n");
        for (const geheim of [ich, user.id, SCHLUESSEL, n.schluessel, m.schluessel])
            expect(alles).not.toContain(geheim);
        const audit = await database<
            { s: string }[]
        >`SELECT (details::text || coalesce(target_ref, '')) AS s FROM avesmaps_auth.security_event ORDER BY id DESC LIMIT 200`;
        for (const zeile of audit) {
            expect(zeile.s).not.toContain(ich);
            expect(zeile.s).not.toContain(user.id);
        }
        // Das Protokoll der Brücke hat feste Schlüssel.
        expect(alles).toContain("Community-Brücke");
    });

    // --- Aufbewahrung ------------------------------------------------------------------------------------------------------

    it("🔴 Aufbewahrung: Kennung und Anzeigename fallen mit den Kontaktdaten weg (90 Tage nach Abschluss) und bei „Personenbezug löschen“", async () => {
        const kennung = snowflake();
        const alt = await legeAn();
        const frisch = await legeAn();
        const loeschen = await legeAn();
        for (const m of [alt, frisch, loeschen]) await verbundenMit(m.id, kennung, "Ein Name");
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'umgesetzt', abgeschlossen_at = now() - interval '91 days' WHERE id = ${alt.id}`;
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'umgesetzt', abgeschlossen_at = now() - interval '10 days' WHERE id = ${frisch.id}`;
        const [lauf] = await database<
            { ergebnis: { kontakt: number } }[]
        >`SELECT avesmaps_community.community_purge_expired() AS ergebnis`;
        expect(lauf!.ergebnis.kontakt).toBe(1);
        expect(await melderZeile(alt.id)).toMatchObject({ discord_id: null, discord_name: null });
        expect((await melderZeile(alt.id)).entfernt_at).not.toBeNull();
        expect(await melderZeile(frisch.id)).toMatchObject({
            discord_id: kennung,
            discord_name: "Ein Name",
            entfernt_at: null,
        });
        // „Personenbezug löschen“ (Datenschutzanfrage).
        await database`SELECT avesmaps_community.community_personenbezug_loeschen(${randomUUID()}::uuid, ${loeschen.id}::bigint, ${lena.id}::uuid)`;
        expect(await melderZeile(loeschen.id)).toMatchObject({ discord_id: null, discord_name: null });
        expect((await melderZeile(loeschen.id)).entfernt_at).not.toBeNull();
        // Die entfernten Vorgänge erscheinen nicht mehr in `offen`; der frische abgeschlossene auch nicht.
        expect((await offen(kennung)).json()).toEqual({ zeilen: [] });
    });

    // --- Client ↔ Server ---------------------------------------------------------------------------------------------------

    it("🔴 Der Client der Stage (`discord/community-bruecke.ts`) gegen die echte Route: Signatur und Schema passen zusammen", async () => {
        // `fetch` ersetzt durch Fastify: dieselben Bytes, dieselben Kopfzeilen, dieselbe Signatur.
        const abruf = async (url: string, init: RequestInit): Promise<Response> => {
            const antwort = await app.inject({
                method: "POST",
                url: new URL(url).pathname,
                headers: init.headers as Record<string, string>,
                payload: init.body as string,
            });
            return new Response(antwort.body, {
                status: antwort.statusCode,
                headers: { "content-type": "application/json" },
            });
        };
        const client = communityBruecke({ url: "https://avesmaps.test", schluessel: SCHLUESSEL, abruf });
        const ich = snowflake();
        const m = await legeAn();
        const n = await legeAn({ bezug: { art: "stelle", lage: { x: 1, y: 2 } } });
        await verbundenMit(m.id, ich);
        await verbundenMit(n.id, ich);

        const offenErgebnis = await client.offeneWebsiteMeldungen(ich);
        expect(offenErgebnis).toEqual({
            art: "ok",
            zeilen: [
                { nummer: n.nummer, stand: "eingegangen", kurztitel: "Lage falsch" },
                { nummer: m.nummer, stand: "eingegangen", kurztitel: "Lage falsch · Wehrheim" },
            ],
        });
        expect(await client.websiteMeldungZurueckziehen(ich, m.nummer)).toEqual({
            art: "ok",
            ergebnis: "zurueckgezogen",
        });
        expect(await client.websiteMeldungZurueckziehen(ich, m.nummer)).toEqual({
            art: "ok",
            ergebnis: "schon_abgeschlossen",
        });
        expect(await client.websiteMeldungZurueckziehen(snowflake(), n.nummer)).toEqual({
            art: "ok",
            ergebnis: "nicht_gefunden",
        });
        expect(await client.offeneWebsiteMeldungen(ich)).toEqual({
            art: "ok",
            zeilen: [{ nummer: n.nummer, stand: "eingegangen", kurztitel: "Lage falsch" }],
        });
        // Ein anderer Schlüssel auf der Stage: 401 → ein Ausfall mit der Klasse „status“, nie eine Ausnahme.
        const falsch = communityBruecke({
            url: "https://avesmaps.test",
            schluessel: "ein-anderer-" + "x".repeat(40),
            abruf,
        });
        expect(await falsch.offeneWebsiteMeldungen(ich)).toEqual({ art: "ausfall", grund: "status" });
        // Ohne Schlüssel in Production: 404 → ebenfalls „status“.
        delete process.env[ENV_NAME];
        expect(await client.offeneWebsiteMeldungen(ich)).toEqual({ art: "ausfall", grund: "status" });
    });
});
