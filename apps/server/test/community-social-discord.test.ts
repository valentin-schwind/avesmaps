import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AVENTURIA,
    KANAL_MIT_ZUGANG,
    SocialDetail,
    SocialKanaele,
    type Role,
    type SocialKanaele as Kanaele,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import * as discord from "../src/community/social/kanaele/discord.ts";
import {
    SOCIAL_SENDEN_KIND,
    discordEingerichtet,
    kanalEingerichtet,
    leseDiscordZugang,
    type DiscordZugang,
} from "../src/community/social/kanaele/konfiguration.ts";
import { pflegeKanaele } from "../src/community/social/kanaele/stand.ts";
import { runSocialPruefen, type PruefenDeps } from "../src/community/social/pruefen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { leseSendenAuftrag, runSocialSendenJob } from "../src/jobs/social-senden-job.ts";
import { WEBHOOK_SERVER, stelleWebhook, type GestellterWebhook } from "./support/discord-webhook.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Kanal Discord des Social Hubs (WI-0268, Migration 0300; Vali 2026-11-03), mit gestelltem Webhook: Es geht NIE ein echter Aufruf hinaus. Geprüft wird, was Vali gewünscht hat, und was dabei nie passieren darf: Ping an alle,
 * der Schlüssel in einem Text, ein Post in den falschen Kanal, eine Probe in den echten Kanal.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const KANAL = "1523841043890704534";
const SCHLUESSEL = "webhook-Schluessel_0123456789-abcdefghijklmnop";
const WEBHOOK = `https://discord.com/api/webhooks/1600000000000000099/${SCHLUESSEL}`;
const ENV: NodeJS.ProcessEnv = { COMMUNITY_SOCIAL_DISCORD_WEBHOOK: WEBHOOK, COMMUNITY_SOCIAL_DISCORD_KANAL: KANAL };

const zugang = (): DiscordZugang => {
    const z = leseDiscordZugang(ENV);
    if (z === undefined) throw new Error("kein Zugang");
    return z;
};

describe("Discord: Konfiguration", () => {
    it("🔴 ohne Webhook oder Kanal gibt es den Kanal nicht; der Bot-Schlüssel allein macht ihn nicht", () => {
        expect(leseDiscordZugang({})).toBeUndefined();
        expect(leseDiscordZugang({ COMMUNITY_SOCIAL_DISCORD_WEBHOOK: WEBHOOK })).toBeUndefined();
        expect(leseDiscordZugang({ COMMUNITY_SOCIAL_DISCORD_KANAL: KANAL })).toBeUndefined();
        expect(
            leseDiscordZugang({ DISCORD_BOT_TOKEN: "ein-bot-schluessel", DISCORD_BUG_KANAL: KANAL }),
        ).toBeUndefined();
        expect(discordEingerichtet(ENV)).toBe(true);
        expect(kanalEingerichtet("discord", ENV)).toBe(true);
        expect(kanalEingerichtet("discord", {})).toBe(false);
        expect(kanalEingerichtet("mastodon", ENV)).toBe(false);
        expect(KANAL_MIT_ZUGANG).toContain("discord");
    });

    it.each([
        [
            "fremder Host",
            {
                COMMUNITY_SOCIAL_DISCORD_WEBHOOK: `https://discord.com.boese.test/api/webhooks/1600000000000000099/${SCHLUESSEL}`,
            },
        ],
        ["ohne https", { COMMUNITY_SOCIAL_DISCORD_WEBHOOK: WEBHOOK.replace("https:", "http:") }],
        ["mit Anfrage", { COMMUNITY_SOCIAL_DISCORD_WEBHOOK: `${WEBHOOK}?x=1` }],
        ["mit Pfad dahinter", { COMMUNITY_SOCIAL_DISCORD_WEBHOOK: `${WEBHOOK}/../../x` }],
        [
            "Schlüssel zu kurz",
            { COMMUNITY_SOCIAL_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/1600000000000000099/kurz" },
        ],
        ["Kanal mit Buchstaben", { COMMUNITY_SOCIAL_DISCORD_KANAL: "neue-features" }],
        ["Kanal zu kurz", { COMMUNITY_SOCIAL_DISCORD_KANAL: "123" }],
    ])("🔴 %s macht den Kanal unbrauchbar", (_name, patch) => {
        expect(leseDiscordZugang({ ...ENV, ...patch })).toBeUndefined();
    });

    it("🔴 die Adresse wird aus ihren Teilen neu gebaut; ein anderer Pfad wirft", () => {
        const z = leseDiscordZugang({
            ...ENV,
            COMMUNITY_SOCIAL_DISCORD_WEBHOOK: `https://canary.discordapp.com/api/v9/webhooks/1600000000000000099/${SCHLUESSEL}`,
        });
        expect(z?.adresse("")).toBe(`https://discord.com/api/v10/webhooks/1600000000000000099/${SCHLUESSEL}`);
        expect(() => zugang().adresse("/../../channels/1")).toThrow();
        expect(() => zugang().adresse("/messages/abc")).toThrow();
    });

    it("🔴 der Schlüssel ist nicht aufzählbar: weder JSON noch Ausgabe noch Spread finden ihn", () => {
        const z = zugang();
        expect(JSON.stringify(z)).not.toContain(SCHLUESSEL);
        expect(inspect(z, { depth: 5, showHidden: false })).not.toContain(SCHLUESSEL);
        expect(JSON.stringify({ ...z })).not.toContain(SCHLUESSEL);
        expect(z.entschaerfe(`x ${WEBHOOK} y`)).not.toContain(SCHLUESSEL);
    });
});

describe("Discord: Senden und Zurücknehmen", () => {
    it("🔴 sendet als Einbettung mit Titelzeile, wie die Vorschau; nie eine Erwähnung; die Adresse führt zur Nachricht", async () => {
        const hook = stelleWebhook({ kanal: KANAL });
        const gesendet = await discord.sende(
            zugang(),
            { titel: " Reichsstraße ", text: "Hallo @everyone" },
            { fetch: hook.fetch },
        );
        expect(gesendet.url).toBe(`https://discord.com/channels/${WEBHOOK_SERVER}/${KANAL}/${gesendet.id}`);
        const post = hook.aufrufe.find((a) => a.methode === "POST");
        expect(post?.abfrage).toEqual({ wait: "true" });
        expect(post?.redirect).toBe("manual");
        expect(post?.nutzlast).toEqual({
            username: "Avesmaps",
            allowed_mentions: { parse: [] },
            embeds: [{ title: "Reichsstraße", description: "Hallo @everyone", color: 0x5865f2 }],
        });
    });

    it("ohne Titel keine Titelzeile; ein Bild geht als Anhang in die Einbettung, mit Bildbeschreibung", async () => {
        const hook = stelleWebhook({ kanal: KANAL });
        await discord.sende(
            zugang(),
            {
                text: "Text",
                bild: { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp", beschreibung: "Eine Karte" },
            },
            { fetch: hook.fetch },
        );
        const post = hook.aufrufe.find((a) => a.methode === "POST");
        expect(post?.datei).toEqual({ name: "bild.webp", typ: "image/webp", groesse: 3 });
        expect(post?.nutzlast).toMatchObject({
            embeds: [{ description: "Text", image: { url: "attachment://bild.webp" } }],
            attachments: [{ id: 0, filename: "bild.webp", description: "Eine Karte" }],
        });
        expect((post?.nutzlast?.["embeds"] as { title?: string }[])[0]?.title).toBeUndefined();
    });

    it("🔴 ein Webhook aus einem anderen Kanal sendet nichts", async () => {
        const hook = stelleWebhook({ kanal: "1523681334248079432" });
        await expect(discord.sende(zugang(), { text: "x" }, { fetch: hook.fetch })).rejects.toMatchObject({
            dauerhaft: true,
            message: expect.stringContaining("anderen Kanal") as unknown,
        });
        expect(hook.aufrufe.filter((a) => a.methode === "POST")).toEqual([]);
    });

    it.each([
        [401, true],
        [403, true],
        [404, true],
        [400, true],
        [413, true],
        [429, false],
        [503, false],
    ])("🔴 Antwort %i beim Senden: dauerhaft %s, nie der Schlüssel im Satz", async (status, dauerhaft) => {
        const hook = stelleWebhook({
            kanal: KANAL,
            fehler: (a) =>
                a.methode === "POST"
                    ? new Response(JSON.stringify({ message: `kaputt ${SCHLUESSEL}` }), { status })
                    : undefined,
        });
        const fehler = await discord.sende(zugang(), { text: "x" }, { fetch: hook.fetch }).catch((e: unknown) => e);
        expect(fehler).toBeInstanceOf(discord.DiscordFehler);
        expect((fehler as discord.DiscordFehler).dauerhaft).toBe(dauerhaft);
        expect((fehler as discord.DiscordFehler).message).not.toContain(SCHLUESSEL);
    });

    it("🔴 bleibt beim Senden die Antwort aus, kein neuer Versuch: Die Nachricht kann angekommen sein; nie die Adresse im Satz", async () => {
        const hook = stelleWebhook({ kanal: KANAL, fehler: (a) => (a.methode === "POST" ? "netz" : undefined) });
        const fehler = (await discord
            .sende(zugang(), { text: "x" }, { fetch: hook.fetch })
            .catch((e: unknown) => e)) as discord.DiscordFehler;
        expect(fehler.dauerhaft).toBe(true);
        expect(fehler.message).toContain("im Kanal nachsehen");
        expect(fehler.message).not.toContain(SCHLUESSEL);
    });

    it("bleibt beim Lesen des Webhooks die Antwort aus, ging nichts hinaus: vorübergehend", async () => {
        const hook = stelleWebhook({ kanal: KANAL, fehler: () => "netz" });
        await expect(discord.sende(zugang(), { text: "x" }, { fetch: hook.fetch })).rejects.toMatchObject({
            dauerhaft: false,
        });
    });

    it("Zurücknehmen löscht die Nachricht; eine, die nicht mehr da ist, gilt als zurückgenommen; `gibtEs` sagt es", async () => {
        const hook = stelleWebhook({ kanal: KANAL });
        const { id } = await discord.sende(zugang(), { text: "x" }, { fetch: hook.fetch });
        expect(await discord.gibtEs(zugang(), id, { fetch: hook.fetch })).toBe(true);
        await discord.nimmZurueck(zugang(), id, { fetch: hook.fetch });
        expect(hook.nachrichten.size).toBe(0);
        expect(await discord.gibtEs(zugang(), id, { fetch: hook.fetch })).toBe(false);
        await expect(discord.nimmZurueck(zugang(), id, { fetch: hook.fetch })).resolves.toBeUndefined();
        await expect(discord.nimmZurueck(zugang(), "../1", { fetch: hook.fetch })).rejects.toBeInstanceOf(
            discord.DiscordFehler,
        );
    });

    it("die Grenzen führt der Hub; der Auftrag kennt den Kanal", () => {
        expect(discord.discordGrenzen()).toMatchObject({ zeichen: 2000, adresse: 0, bilder: 1, beschreibung: 1000 });
        expect(leseSendenAuftrag({ beitrag: 7, kanal: "discord" })).toEqual({ beitrag: 7, kanal: "discord" });
    });
});

interface Lauf {
    code: number;
    ausgabe: string;
    text: string;
}

async function pruefLauf(argv: readonly string[], env: NodeJS.ProcessEnv, deps: PruefenDeps): Promise<Lauf> {
    const aus: string[] = [];
    const err: string[] = [];
    const code = await runSocialPruefen(
        argv,
        env,
        { out: (zeile) => void aus.push(zeile), err: (zeile) => void err.push(zeile) },
        { systemUser: "probe", heute: () => "2026-11-03", ...deps },
    );
    return { code, ausgabe: aus.join("\n"), text: [...aus, ...err].join("\n") };
}

describe("Discord: Prüflauf ohne Datenbank", () => {
    const keinAufruf = (() => {
        throw new Error("kein Netz im Probelauf");
    }) as unknown as typeof globalThis.fetch;

    it("🔴 ohne --anwenden kein Netz; auch er sagt, dass nichts in den Kanal geht", async () => {
        const lauf = await pruefLauf(["--kanal", "discord"], ENV, { fetch: keinAufruf });
        expect(lauf.code).toBe(0);
        expect(lauf.ausgabe).toContain("PROBELAUF");
        expect(lauf.ausgabe).toContain("geht nichts in den Kanal");
    });

    it("🔴 --anwenden ohne Zitat und --bild brechen ab, bevor etwas passiert", async () => {
        expect((await pruefLauf(["--kanal", "discord", "--anwenden"], ENV, { fetch: keinAufruf })).code).toBe(2);
        expect(
            (await pruefLauf(["--kanal", "discord", "--bild", "https://x.test/a.jpg"], ENV, { fetch: keinAufruf }))
                .code,
        ).toBe(2);
    });
});

function serverConfig(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "social-discord-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Discord als Kanal des Social Hubs (PostgreSQL, gestellter Webhook)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let edda: { id: string; cookie: string };
    let betreiber: { id: string; cookie: string };
    let frisch: { cookie: string };
    const gesichert: Record<string, string | undefined> = {};

    async function leeren(): Promise<void> {
        await database`DELETE FROM job WHERE kind = ${SOCIAL_SENDEN_KIND}`;
        await database`DELETE FROM avesmaps_community.beitrag`;
        await database`DELETE FROM avesmaps_community.kanal_stand`;
        await database`DELETE FROM public.news_entry`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.social_%'`;
    }

    beforeAll(async () => {
        for (const name of Object.keys(ENV)) gesichert[name] = process.env[name];
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: serverConfig(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        edda = await person("editor", "Edda");
        betreiber = await person("operator", "Rondrikan");
    });

    beforeEach(async () => {
        frisch = (await fixture.session(betreiber.id, { assurance: "strong", passkeyMinutesAgo: 1 })) as {
            cookie: string;
        };
        for (const [name, wert] of Object.entries(ENV)) process.env[name] = wert;
        await leeren();
    });

    afterAll(async () => {
        for (const name of Object.keys(ENV)) {
            const alt = gesichert[name];
            if (alt === undefined) delete process.env[name];
            else process.env[name] = alt;
        }
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const stand = async () => {
        const antwort = await get("/api/community/social/kanaele", betreiber.cookie);
        expect(antwort.statusCode).toBe(200);
        expect(Value.Check(SocialKanaele, antwort.json())).toBe(true);
        expect(antwort.body).not.toContain(SCHLUESSEL);
        expect(antwort.body).not.toContain(KANAL);
        return (antwort.json() as Kanaele).kanaele.find((s) => s.kanal === "discord")!;
    };
    const auftraege = () =>
        database<{ input_ref: { beitrag: number; kanal: string } }[]>`
            SELECT input_ref FROM job WHERE kind = ${SOCIAL_SENDEN_KIND} ORDER BY id
        `;
    const kontext = (beitrag: number): JobContext => ({
        input: { beitrag, kanal: "discord" },
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    });
    const lauf = (beitrag: number, hook: GestellterWebhook, environment: NodeJS.ProcessEnv = ENV) =>
        runSocialSendenJob(kontext(beitrag), { database, environment, fetch: hook.fetch });
    const ANWENDEN = ["--kanal", "discord", "--anwenden", "--operator-said", "Vali 2026-11-03: Prüflauf Discord."];
    const inProd: NodeJS.ProcessEnv = { ...ENV, AVESMAPS_ENV: "test" };
    const freischalten = async (): Promise<void> => {
        const ergebnis = await pruefLauf(ANWENDEN, inProd, { fetch: stelleWebhook({ kanal: KANAL }).fetch, database });
        expect(ergebnis.code, ergebnis.text).toBe(0);
    };
    const inhalt = (patch: Record<string, unknown> = {}) => ({
        titel: "Die Reichsstraße ist da",
        text: "Die Reichsstraße steht jetzt auf der Karte. https://avesmaps.de/",
        hashtags: ["Aventurien"],
        rubrik: "karte",
        ki: false,
        kanaele: ["neuigkeiten", "discord"],
        ...patch,
    });
    interface Quittung {
        id: number;
        revision: number;
    }
    const tu = async (
        id: number,
        was: string,
        revision: number,
        cookie: string,
        extra: Record<string, unknown> = {},
    ) => {
        const antwort = await post(
            `/api/community/social/${String(id)}/${was}`,
            { operationId: randomUUID(), baseRevision: revision, ...extra },
            cookie,
        );
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as Quittung;
    };
    const veroeffentlichen = async (patch: Record<string, unknown> = {}): Promise<Quittung> => {
        const antwort = await post(
            "/api/community/social",
            { operationId: randomUUID(), ...inhalt(patch) },
            edda.cookie,
        );
        expect(antwort.statusCode, antwort.body).toBe(201);
        const b = antwort.json() as Quittung;
        const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
        return tu(b.id, "freigeben", vorgelegt.revision, betreiber.cookie);
    };
    const ziel = async (id: number) => {
        const antwort = await get(`/api/community/social/${String(id)}`, betreiber.cookie);
        expect(antwort.statusCode).toBe(200);
        expect(Value.Check(SocialDetail, antwort.json())).toBe(true);
        return (antwort.json() as SocialDetail).zeile.ziele.find((z) => z.kanal === "discord");
    };

    it("🔴 ohne Webhook „nicht eingerichtet“ (so bleibt die Stage): Vorlegen weist ab, kein Auftrag, auch mit Freischaltung", async () => {
        await freischalten();
        delete process.env["COMMUNITY_SOCIAL_DISCORD_WEBHOOK"];
        expect(await stand()).toMatchObject({ eingerichtet: false, bereit: false, sperre: "nicht_eingerichtet" });
        const antwort = await post("/api/community/social", { operationId: randomUUID(), ...inhalt() }, edda.cookie);
        const b = antwort.json() as Quittung;
        const vorlegen = await post(
            `/api/community/social/${String(b.id)}/vorlegen`,
            { operationId: randomUUID(), baseRevision: b.revision },
            edda.cookie,
        );
        expect(vorlegen.statusCode).toBe(422);
        expect((vorlegen.json() as { error: { message: string } }).error.message).toBe(
            "Discord ist in dieser Umgebung nicht eingerichtet.",
        );
        expect(await auftraege()).toEqual([]);
    });

    it("eingerichtet, aber nicht geprüft: „Zählregel noch nicht geprüft“, nicht bereit", async () => {
        expect(await stand()).toMatchObject({ eingerichtet: true, bereit: false, sperre: "nicht_freigeschaltet" });
    });

    it("🔴 Prüflauf: nichts geht in den Kanal, der Kanal wird bereit, das Protokoll hat Zahlen und nie den Schlüssel", async () => {
        const hook = stelleWebhook({ kanal: KANAL });
        const ergebnis = await pruefLauf(ANWENDEN, inProd, { fetch: hook.fetch, database });
        expect(ergebnis.code, ergebnis.text).toBe(0);
        expect(hook.aufrufe.map((a) => a.methode)).toEqual(["GET"]);
        expect(hook.nachrichten.size).toBe(0);
        expect(ergebnis.ausgabe).toContain("Es ging nichts in den Kanal");
        expect(ergebnis.text).not.toContain(SCHLUESSEL);
        expect(await stand()).toMatchObject({ eingerichtet: true, freigeschaltet: true, bereit: true, sperre: null });
        const ereignisse = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.social_kanal_geprueft'
        `;
        expect(ereignisse[0]?.details).toEqual({
            kanal: "discord",
            faelle: 1,
            uebereinstimmend: 1,
            freigeschaltet: true,
            zitat: true,
        });
    });

    it("🔴 Prüflauf mit dem Webhook eines anderen Kanals: gesperrt; ein Netzfehler ändert nichts am Stand", async () => {
        await freischalten();
        const falsch = await pruefLauf(ANWENDEN, inProd, {
            fetch: stelleWebhook({ kanal: "1523681334248079432" }).fetch,
            database,
        });
        expect(falsch.code).toBe(1);
        expect(falsch.text).toContain("GESPERRT");
        expect(await stand()).toMatchObject({ freigeschaltet: false, bereit: false });
        await freischalten();
        const netz = await pruefLauf(ANWENDEN, inProd, {
            fetch: stelleWebhook({ kanal: KANAL, fehler: () => "netz" }).fetch,
            database,
        });
        expect(netz.code).toBe(1);
        expect(netz.text).not.toContain(SCHLUESSEL);
        expect(await stand()).toMatchObject({ freigeschaltet: true, bereit: true });
    });

    it("🔴 Freigeben reiht EINEN Auftrag ein; gesendet wird im Auftrag: Titelzeile und Text, ohne Hashtags, ohne Erwähnung; das Ziel trägt die Adresse", async () => {
        await freischalten();
        const b = await veroeffentlichen();
        expect((await auftraege()).map((a) => a.input_ref)).toEqual([{ beitrag: b.id, kanal: "discord" }]);
        expect((await ziel(b.id))?.zustand).toBe("wartet");
        const hook = stelleWebhook({ kanal: KANAL });
        const ergebnis = await lauf(b.id, hook);
        expect(ergebnis).toMatchObject({ zustand: "ok" });
        expect(JSON.stringify(ergebnis)).not.toContain(SCHLUESSEL);
        const [nachricht] = [...hook.nachrichten.values()];
        expect(nachricht).toMatchObject({
            allowed_mentions: { parse: [] },
            embeds: [
                {
                    title: "Die Reichsstraße ist da",
                    description: "Die Reichsstraße steht jetzt auf der Karte. https://avesmaps.de/",
                },
            ],
        });
        const [id] = [...hook.nachrichten.keys()];
        const z = await ziel(b.id);
        expect(z).toMatchObject({
            zustand: "ok",
            adresse: `https://discord.com/channels/${WEBHOOK_SERVER}/${KANAL}/${String(id)}`,
        });
        expect(JSON.stringify(z)).not.toContain(SCHLUESSEL);
        // Ein zweiter Lauf sendet nichts mehr.
        expect(await lauf(b.id, hook)).toMatchObject({ ergebnis: "uebersprungen" });
        expect(hook.nachrichten.size).toBe(1);
    });

    it("🔴 Zurücknehmen löscht die Nachricht; nach „Erneut senden“ steht sie wieder da, nur einmal", async () => {
        await freischalten();
        const b = await veroeffentlichen();
        const hook = stelleWebhook({ kanal: KANAL });
        await lauf(b.id, hook);
        // Was der Auftrag meldet, zählt die Revision nicht: Es gilt noch die der Freigabe.
        const zurueck = await tu(b.id, "kanal-zuruecknehmen", b.revision, betreiber.cookie, { kanal: "discord" });
        await lauf(b.id, hook);
        expect(hook.nachrichten.size).toBe(0);
        expect((await ziel(b.id))?.zustand).toBe("zurueck");
        await tu(b.id, "erneut", zurueck.revision, betreiber.cookie, { kanal: "discord" });
        await lauf(b.id, hook);
        expect(hook.nachrichten.size).toBe(1);
        expect((await ziel(b.id))?.zustand).toBe("ok");
    });

    it("🔴 Ein Ausfall: dreimal vorübergehend, dann „Fehler“ am Ziel; die Neuigkeit bleibt, der Satz trägt nie den Schlüssel", async () => {
        await freischalten();
        const b = await veroeffentlichen();
        const hook = stelleWebhook({ kanal: KANAL, fehler: () => new Response("{}", { status: 503 }) });
        for (let versuch = 0; versuch < 3; versuch += 1) {
            await database`UPDATE avesmaps_community.sendung SET reserviert_bis = NULL WHERE beitrag_id = ${b.id}::bigint`;
            await lauf(b.id, hook);
        }
        const z = await ziel(b.id);
        expect(z?.zustand).toBe("fehler");
        expect(JSON.stringify(z)).not.toContain(SCHLUESSEL);
        const neu = await database`SELECT 1 FROM public.news_entry WHERE beitrag_id = ${b.id}::bigint`;
        expect(neu).toHaveLength(1);
    });

    it("🔴 Notschalter und fehlende Umgebung: nichts geht hinaus, der Satz steht am Ziel", async () => {
        await freischalten();
        const b = await veroeffentlichen();
        const hook = stelleWebhook({ kanal: KANAL });
        await lauf(b.id, hook, {});
        expect((await ziel(b.id))?.fehler).toContain("nicht eingerichtet");
        expect(hook.aufrufe).toEqual([]);

        const c = await veroeffentlichen({ titel: "Zweiter Beitrag" });
        await database`SELECT avesmaps_community.social_kanal_notschalter('discord', true)`;
        await lauf(c.id, hook);
        expect((await ziel(c.id))?.fehler).toContain("Notschalter");
        expect(hook.aufrufe).toEqual([]);
    });

    it("Notschalter und „Zugang prüfen“ gehen über die Routen; die tägliche Pflege prüft den Webhook, ohne zu senden", async () => {
        await freischalten();
        const schalter = await post("/api/community/social/kanaele/discord/notschalter", { an: true }, frisch.cookie);
        expect(schalter.statusCode, schalter.body).toBe(200);
        expect(await stand()).toMatchObject({ notschalter: true, bereit: false, sperre: "notschalter" });
        await post("/api/community/social/kanaele/discord/notschalter", { an: false }, frisch.cookie);
        const hook = stelleWebhook({ kanal: KANAL });
        expect(await pflegeKanaele(database, ENV, { fetch: hook.fetch })).toEqual({
            socialMastodon: "aus",
            socialFacebook: "aus",
            socialInstagram: "aus",
            socialDiscord: "gelesen",
        });
        expect(hook.aufrufe.map((a) => a.methode)).toEqual(["GET"]);
        const kaputt = stelleWebhook({ kanal: KANAL, fehler: () => new Response("{}", { status: 401 }) });
        expect((await pflegeKanaele(database, ENV, { fetch: kaputt.fetch }))["socialDiscord"]).toBe("fehler");
    });
});
