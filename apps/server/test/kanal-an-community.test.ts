import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    COMMUNITY_DISCORD_SIGNATUR_KOPF,
    COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
    COMMUNITY_DISCORD_ZEIT_KOPF,
    KanalListe,
    KanalVorgang,
    VorgangDetail,
    communityNachrichtAusDiscord,
    signiere,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { communityBruecke, type BrueckeKonfig } from "../src/discord/community-bruecke.ts";
import { DISCORD_ANWENDUNG } from "../src/discord/konfig.ts";
import { KanalFehler, abholen, aenderung, discordMelden, eintragen, lesen, nachweis } from "../src/kanal/db.ts";
import { channelKey } from "../src/media/storage.ts";
import { weiterleitungsKennung } from "../src/routes/kanal.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { DISCORD_TEST_SCHLUESSEL } from "./support/discord-signatur.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * „An Community weiterleiten“ bei der Sichtung (WI-0297, Migration 0332; Vali 2026-11-09 zu OPS-000097) gegen echtes PostgreSQL, Kanal und Brücke in EINEM Durchlauf:
 * Die Stage ruft Production über die Brücke (`discord/community-bruecke.ts`), hier ersetzt durch Fastify mit denselben Bytes, Kopfzeilen und der Signatur.
 *
 * - 🔴 Aus „zu sichten“ entsteht in Production eine Anfrage mit Eingang `discord`: Kategorie aus der Art, Nachricht „Titel, Leerzeile, Text“, Melder mit Discord-Kennung und
 *   Anzeigename (Rückweg `discord`), Herkunft OPS-…, das Bild als Anhang in der Ablage, die Glocke `community_neu`. Seit 0336 eine MELDUNG (gewählte Option
 *   vom 2026-11-10) mit der Stelle aus dem „Wo:“; ihre Bilder sieht auch, wer nur Meldungen bearbeitet. Der Kanalvorgang endet `abgenommen`, Abschluss
 *   `an_community`, mit der COM-Nummer und einem Protokolleintrag `an: community`.
 * - 🔴 Verdeckt: Kein Agent holt ihn ab, liest Titel, Text, Melder oder COM-Nummer, schreibt einen Eintrag, Nachweis oder Fix-Bericht daran; „wieder öffnen“ geht nicht.
 * - Dieselbe Meldung zweimal (neuer Klick) ergibt denselben Community-Vorgang; Brücke aus oder Production nicht erreichbar: 503, der Vorgang bleibt zu sichten.
 * - Der Melder sieht die Meldung über `/offen` (Brücke) mit dem Stand der Redaktion.
 * - Production prüft selbst: ohne Signatur 401, ein Bild, das kein WebP ist, 400.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SCHLUESSEL = "kanal-an-community-" + "s".repeat(40);
const ENV_SCHLUESSEL = "COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL";
const ENV_ABLAGE = "COMMUNITY_MAIL_ABLAGE";
const KENNUNG = "1430000000000000297";

describeWithDatabase("Kanal: An Community weiterleiten (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let ohneBruecke: FastifyInstance;
    let mediaRoot: string;
    let ablage: string;
    let rondrikan: { id: string; cookie: string };
    /** Was Production antwortet; Vorgabe: die echte Route derselben App. */
    let production: (url: string, init: RequestInit) => Promise<Response>;
    const gesichert = { schluessel: process.env[ENV_SCHLUESSEL], ablage: process.env[ENV_ABLAGE] };

    const echt = async (url: string, init: RequestInit): Promise<Response> => {
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

    function config(bruecke?: BrueckeKonfig): ServerConfig {
        return {
            port: 0,
            host: "127.0.0.1",
            releaseId: "kanal-an-community-test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
            statusPage: true,
            auth: TEST_AUTH,
            discordInteraktionen: {
                schluessel: DISCORD_TEST_SCHLUESSEL,
                anwendung: DISCORD_ANWENDUNG,
                ...(bruecke === undefined ? {} : { bruecke }),
            },
        };
    }

    const baue = async (bruecke?: BrueckeKonfig): Promise<FastifyInstance> => {
        const instanz = buildApp({
            config: config(bruecke),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await instanz.ready();
        return instanz;
    };

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_kanal.bild`;
        await database`DELETE FROM avesmaps_kanal.nachweis`;
        await database`DELETE FROM avesmaps_kanal.aenderung WHERE vorgang_id IS NOT NULL`;
        await database`DELETE FROM avesmaps_kanal.eintrag`;
        await database`UPDATE avesmaps_kanal.vorgang SET folgt_auf = NULL`;
        await database`DELETE FROM avesmaps_kanal.vorgang`;
        await database`DELETE FROM avesmaps_community.vorgang WHERE eingang = 'discord'`;
        if (rondrikan !== undefined)
            await database`DELETE FROM public.benachrichtigung WHERE art IN ('community_nachricht', 'community_neu') AND an_person = ${rondrikan.id}`;
        production = echt;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "kanal-an-community-medien-"));
        ablage = await mkdtemp(join(tmpdir(), "kanal-an-community-ablage-"));
        production = echt;
        app = await baue({
            url: "https://production.test",
            schluessel: SCHLUESSEL,
            abruf: (url, init) => production(url, init),
        });
        ohneBruecke = await baue();
        const person = await fixture.person("operator", { name: "Rondrikan" });
        const { cookie } = await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 60 });
        rondrikan = { id: person.id, cookie };
    }, 120_000);

    beforeEach(async () => {
        await leeren();
        process.env[ENV_SCHLUESSEL] = SCHLUESSEL;
        process.env[ENV_ABLAGE] = ablage;
    });

    afterEach(() => {
        for (const [name, wert] of [
            [ENV_SCHLUESSEL, gesichert.schluessel],
            [ENV_ABLAGE, gesichert.ablage],
        ] as const) {
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
    });

    afterAll(async () => {
        await app?.close();
        await ohneBruecke?.close();
        await leeren().catch(() => undefined);
        await database`DELETE FROM avesmaps_auth.security_event WHERE action = 'system.kanal_gesichtet'`.catch(
            () => undefined,
        );
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(mediaRoot, { recursive: true, force: true });
        await rm(ablage, { recursive: true, force: true });
    });

    const get = (url: string, instanz = app) =>
        instanz.inject({ method: "GET", url, headers: { cookie: rondrikan.cookie } });
    const post = (url: string, payload: Record<string, unknown>, instanz = app) =>
        instanz.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie: rondrikan.cookie } });

    /** Eine Meldung aus Discord, zu sichten, wie `/bug` sie anlegt. */
    async function meldung(kategorie: "bug" | "idee" | "nutzerfrage" = "idee"): Promise<{ id: number; ops: string }> {
        const id = await discordMelden(
            database,
            {
                environment: "test",
                kategorie,
                titel: "Gareth fehlt ein Tempel",
                nachricht:
                    "Im Regionalband steht ein Praiostempel am Markt.\n\nWo: https://avesmaps.de/#x=519.240&y=499.050&z=3.41",
                melderName: "Praiodan",
                melderKennung: KENNUNG,
                kontext: {},
            },
            randomUUID(),
        );
        return { id, ops: `OPS-${String(id).padStart(6, "0")}` };
    }

    /** Ein fertiges Bild am Vorgang: Zeile in `bild` und die Fassung `ansicht` als WebP im Medienspeicher. */
    async function bild(vorgang: number): Promise<Buffer> {
        const id = randomUUID();
        const bytes = await sharp({
            create: { width: 40, height: 30, channels: 3, background: { r: 90, g: 120, b: 60 } },
        })
            .webp()
            .toBuffer();
        await database`
            INSERT INTO avesmaps_kanal.bild (id, vorgang_id, eintrag_seq, sha256, format, breite, hoehe, bytes, zustand, operation_id)
            VALUES (${id}, ${vorgang}, 1, ${"a".repeat(64)}, 'webp', 40, 30, ${bytes.length}, 'bereit', ${randomUUID()})
        `;
        const pfad = join(mediaRoot, channelKey(id, "ansicht", "webp"));
        await mkdir(join(pfad, ".."), { recursive: true });
        await writeFile(pfad, bytes);
        return bytes;
    }

    const revision = async (id: number): Promise<number> =>
        (await database<{ revision: number }[]>`SELECT revision FROM avesmaps_kanal.vorgang WHERE id = ${id}`)[0]!
            .revision;
    const weiterleiten = async (ops: string, id: number, instanz = app) =>
        post(
            `/api/kanal/vorgaenge/${ops}/an-community`,
            { operationId: randomUUID(), baseRevision: await revision(id) },
            instanz,
        );

    async function kanalZeile(id: number) {
        const [row] = await database<
            { status: string; abschluss: string | null; community: string | null; abgenommen_von: string | null }[]
        >`SELECT status, abschluss, community, abgenommen_von::text FROM avesmaps_kanal.vorgang WHERE id = ${id}`;
        return row!;
    }

    async function fehler(lauf: Promise<unknown>): Promise<KanalFehler> {
        try {
            await lauf;
        } catch (error) {
            if (error instanceof KanalFehler) return error;
            throw error;
        }
        throw new Error("kein Fehler");
    }

    it("🔴 weitergeleitet: in Production eine Anfrage mit Titel, Text, Herkunft, Bild und Rückweg zum Melder; im Kanal „an Community“ mit Protokoll", async () => {
        const { id, ops } = await meldung("bug");
        const bytes = await bild(id);

        const antwort = await weiterleiten(ops, id);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ status: "applied", affected: [{ kind: "kanal_vorgang", id: ops }] });

        const kanal = await kanalZeile(id);
        expect(kanal).toMatchObject({ status: "abgenommen", abschluss: "an_community", abgenommen_von: rondrikan.id });
        expect(kanal.community).toMatch(/^COM-\d{6}$/u);
        const com = kanal.community!;
        const comId = Number(com.slice(4));

        const [vorgang] = await database<{ art: string; kategorie: string; eingang: string; zustand: string }[]>`
            SELECT art, kategorie, eingang, zustand FROM avesmaps_community.vorgang WHERE id = ${comId}`;
        expect(vorgang).toEqual({ art: "meldung", kategorie: "sonstiges", eingang: "discord", zustand: "neu" });
        expect(
            await database`SELECT art, lage_x, lage_y, objekt_id FROM avesmaps_community.bezug WHERE vorgang_id = ${comId}`,
        ).toEqual([{ art: "stelle", lage_x: 519.24, lage_y: 499.05, objekt_id: null }]);
        const [melder] = await database<
            { name: string | null; discord_id: string | null; discord_name: string | null; mail: string | null }[]
        >`SELECT name, discord_id, discord_name, mail FROM avesmaps_community.melder WHERE vorgang_id = ${comId}`;
        expect(melder).toEqual({ name: null, discord_id: KENNUNG, discord_name: "Praiodan", mail: null });
        const [nachricht] = await database<{ id: string; richtung: string; weg: string; text: string }[]>`
            SELECT id::text, richtung, weg, text FROM avesmaps_community.nachricht WHERE vorgang_id = ${comId}`;
        expect(nachricht).toMatchObject({
            richtung: "ein",
            weg: "discord",
            text: communityNachrichtAusDiscord(
                "Gareth fehlt ein Tempel",
                "Im Regionalband steht ein Praiostempel am Markt.\n\nWo: https://avesmaps.de/#x=519.240&y=499.050&z=3.41",
            ),
        });
        expect(nachricht!.text.startsWith("Gareth fehlt ein Tempel\n\nIm Regionalband")).toBe(true);
        expect(
            await database`SELECT art, ziel FROM avesmaps_community.verknuepfung WHERE vorgang_id = ${comId}`,
        ).toEqual([{ art: "herkunft", ziel: ops }]);
        const anhaenge = await database<{ mime: string; groesse: string; datei: string; dateiname: string }[]>`
            SELECT mime, groesse::text, datei, dateiname FROM avesmaps_community.mail_anhang WHERE nachricht_id = ${nachricht!.id}::bigint`;
        expect(anhaenge).toHaveLength(1);
        expect(anhaenge[0]).toMatchObject({
            mime: "image/webp",
            groesse: String(bytes.length),
            dateiname: "bild-1.webp",
        });
        expect(existsSync(join(ablage, anhaenge[0]!.datei))).toBe(true);

        // Die Glocke zählt sie bei den Meldungen (`community_neu`, an alle, die Meldungen bearbeiten), nicht als Mail.
        const glocke = await database<{ art: string; text: string }[]>`
            SELECT art, text FROM public.benachrichtigung
             WHERE art IN ('community_neu', 'community_nachricht') AND an_person = ${rondrikan.id}`;
        expect(glocke).toEqual([{ art: "community_neu", text: com }]);

        // Die Redaktion sieht Text und Bild im Verlauf (dieselbe Darstellung wie eine Mail, ohne Betreff).
        const detail = await get(`/api/community/vorgaenge/${com}`);
        expect(detail.statusCode, detail.body).toBe(200);
        const sicht = detail.json() as VorgangDetail;
        expect(Value.Check(VorgangDetail, sicht)).toBe(true);
        const eintrag = sicht.verlauf.find((e) => e.art === "nachricht");
        expect(eintrag).toMatchObject({ art: "nachricht", weg: "discord" });
        expect((eintrag as { mail?: { betreff: string; anhaenge: unknown[] } }).mail).toMatchObject({
            betreff: "",
            anhaenge: [{ mime: "image/webp", vorschau: true }],
        });
        expect(sicht.melder).toMatchObject({ rueckwege: ["discord"], discordName: "Praiodan" });
        expect(sicht.bezug).toMatchObject({ art: "stelle", lage: { x: 519.24, y: 499.05 } });

        // 🔴 Wer nur Meldungen bearbeitet (ohne Mailrecht), sieht Text und Bild der Meldung und öffnet das Bild.
        const reviewer = await fixture.person("reviewer", { name: "Lena" });
        const { cookie: lena } = await fixture.session(reviewer.id);
        const alsLena = await app.inject({
            method: "GET",
            url: `/api/community/vorgaenge/${com}`,
            headers: { cookie: lena },
        });
        expect(alsLena.statusCode, alsLena.body).toBe(200);
        const lenasEintrag = (alsLena.json() as VorgangDetail).verlauf.find((e) => e.art === "nachricht") as {
            mail?: { anhaenge: { id: number }[] };
        };
        const bildId = lenasEintrag.mail?.anhaenge[0]?.id;
        expect(bildId).toBeDefined();
        const datei = await app.inject({
            method: "GET",
            url: `/api/community/vorgaenge/${com}/anhaenge/${String(bildId)}?ansehen=1`,
            headers: { cookie: lena },
        });
        expect(datei.statusCode, datei.body).toBe(200);
        expect(datei.headers["content-type"]).toBe("image/webp");

        // Der Kanal zeigt ihn im Archiv als weitergeleitet, mit der Nummer; das Protokoll trägt nur Nummern.
        const liste = await get("/api/kanal/vorgaenge?reiter=archiv");
        const archiv = liste.json() as KanalListe;
        expect(Value.Check(KanalListe, archiv)).toBe(true);
        expect(archiv.zeilen.find((z) => z.ops === ops)).toMatchObject({ abschluss: "an_community", community: com });
        const offenListe = (await get("/api/kanal/vorgaenge?reiter=offen")).json() as KanalListe;
        expect(offenListe.zeilen.some((z) => z.ops === ops)).toBe(false);
        const offenerVorgang = (await get(`/api/kanal/vorgaenge/${ops}`)).json() as KanalVorgang;
        expect(Value.Check(KanalVorgang, offenerVorgang)).toBe(true);
        expect(offenerVorgang).toMatchObject({ status: "abgenommen", abschluss: "an_community", community: com });
        const [ereignis] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.kanal_gesichtet' AND target_ref = ${ops}`;
        expect(ereignis?.details).toEqual({ ops, an: "community", com });
    });

    it("🔴 verdeckt: kein Agent holt ihn ab oder liest Titel, Text, Melder, COM-Nummer; kein Eintrag, Nachweis, Fix-Bericht; nicht wieder zu öffnen", async () => {
        const { id, ops } = await meldung();
        expect((await weiterleiten(ops, id)).statusCode).toBe(200);

        for (const als of ["claudio", "claudia"] as const) {
            const geholt = await abholen(database, { anzahl: 50, alle: true, als });
            expect(geholt.some((v) => Number(v.id) === id)).toBe(false);
            const gelesen = await lesen(database, id, als);
            expect(gelesen).toMatchObject({
                anCommunity: true,
                zuSichten: false,
                gemeldetVon: "Discord",
                eintraege: [],
            });
            const kopf = gelesen["vorgang"] as Record<string, unknown>;
            expect(kopf).toMatchObject({ titel: null, nachricht: null, kontext: {} });
            expect(JSON.stringify(gelesen)).not.toMatch(/COM-|Praiodan|Tempel|1430000000000000297/u);

            expect((await fehler(eintragen(database, id, "befund", "Nachgesehen.", { als }))).code).toBe(
                "kanal_transition",
            );
            expect(
                (await fehler(nachweis(database, id, "fix_committed", { als, commit: "a".repeat(40) }))).code,
            ).toMatch(/^kanal_(transition|invalid|forbidden)$/u);
            expect(
                (await fehler(aenderung(database, { vorgang: id, klasse: "A", art: "code", was: "Fix" }, { als })))
                    .code,
            ).toMatch(/^kanal_(transition|forbidden)$/u);
        }
        // Und direkt an den Funktionen vorbei hält die Datenbank selbst (Auslöser).
        await expect(
            database`UPDATE avesmaps_kanal.vorgang SET status = 'neu', abschluss = NULL, community = NULL WHERE id = ${id}`,
        ).rejects.toThrow(/an die Community weitergeleitet/u);
        await expect(
            database`INSERT INTO avesmaps_kanal.eintrag (vorgang_id, seq, art, von_agent, text, operation_id)
                     VALUES (${id}, 99, 'befund', 'claudio', 'x', ${randomUUID()})`,
        ).rejects.toThrow(/an die Community weitergeleitet/u);

        const wieder = await post(`/api/kanal/vorgaenge/${ops}/wieder-oeffnen`, {
            operationId: randomUUID(),
            baseRevision: await revision(id),
            kommentar: "Doch ein Fehler.",
        });
        expect(wieder.statusCode).toBe(409);
        expect((await kanalZeile(id)).abschluss).toBe("an_community");
    });

    it("dieselbe Meldung zweimal (neuer Klick) ist derselbe Community-Vorgang; eine freigegebene geht nicht mehr weiter", async () => {
        const { id, ops } = await meldung();
        const erste = await weiterleiten(ops, id);
        expect(erste.statusCode).toBe(200);
        const com = (await kanalZeile(id)).community;
        const zweite = await weiterleiten(ops, id);
        expect(zweite.statusCode, zweite.body).toBe(200);
        expect((await kanalZeile(id)).community).toBe(com);
        const [{ n } = { n: 0 }] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_community.vorgang WHERE eingang = 'discord'`;
        expect(n).toBe(1);

        // Auch Production allein: dieselbe Kennung der Weiterleitung legt nichts Zweites an.
        const client = communityBruecke({ url: "https://production.test", schluessel: SCHLUESSEL, abruf: echt });
        const nochmal = await client.anCommunityWeiterleiten({
            operationId: weiterleitungsKennung("test", id),
            ops,
            discordId: KENNUNG,
            name: "Praiodan",
            art: "idee",
            titel: "egal",
            text: "egal",
            bilder: [],
        });
        expect(nochmal).toEqual({ art: "ok", nummer: com });

        const anderer = await meldung();
        const frei = await post(`/api/kanal/vorgaenge/${anderer.ops}/sichten`, {
            operationId: randomUUID(),
            baseRevision: await revision(anderer.id),
            an: "claudio",
        });
        expect(frei.statusCode).toBe(200);
        const spaeter = await weiterleiten(anderer.ops, anderer.id);
        expect(spaeter.statusCode).toBe(409);
        expect(spaeter.json()).toMatchObject({ error: { code: "kanal_transition" } });
    });

    it("🔴 Brücke aus oder Production nicht erreichbar: 503 mit eigenem Code, der Vorgang bleibt zu sichten, in Production entsteht nichts", async () => {
        const { id, ops } = await meldung();
        const aus = await weiterleiten(ops, id, ohneBruecke);
        expect(aus.statusCode).toBe(503);
        expect(aus.json()).toMatchObject({ error: { code: "kanal_community_aus" } });

        production = async () => new Response("{}", { status: 404 });
        const weg = await weiterleiten(ops, id);
        expect(weg.statusCode).toBe(503);
        expect(weg.json()).toMatchObject({ error: { code: "kanal_community_ausfall" } });

        // Production kennt den Weg noch nicht (älteres Release) oder der Schlüssel fehlt dort: ebenso ein Ausfall.
        production = echt;
        delete process.env[ENV_SCHLUESSEL];
        expect((await weiterleiten(ops, id)).json()).toMatchObject({ error: { code: "kanal_community_ausfall" } });

        expect(await kanalZeile(id)).toMatchObject({ status: "zu_sichten", abschluss: null, community: null });
        const [{ n } = { n: 0 }] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_community.vorgang WHERE eingang = 'discord'`;
        expect(n).toBe(0);
    });

    it("🔴 der Melder sieht seine Meldung über /offen mit dem Stand der Redaktion, nie mit Text", async () => {
        const { id, ops } = await meldung("nutzerfrage");
        expect((await weiterleiten(ops, id)).statusCode).toBe(200);
        const com = (await kanalZeile(id)).community!;
        const client = communityBruecke({ url: "https://production.test", schluessel: SCHLUESSEL, abruf: echt });
        expect(await client.offeneWebsiteMeldungen(KENNUNG)).toEqual({
            art: "ok",
            zeilen: [{ nummer: com, stand: "eingegangen", kurztitel: "Sonstiges" }],
        });
        expect(await client.websiteMeldungZurueckziehen(KENNUNG, com)).toEqual({
            art: "ok",
            ergebnis: "zurueckgezogen",
        });
    });

    it("🔴 Production prüft selbst: ohne gültige Signatur 401, ein Bild, das kein WebP ist, 400; nichts entsteht", async () => {
        const rumpf = JSON.stringify({
            operationId: randomUUID(),
            ops: "OPS-000777",
            discordId: KENNUNG,
            name: "Praiodan",
            art: "bug",
            titel: "Titel",
            text: "Text",
            bilder: [{ daten: Buffer.from("kein bild, nur text").toString("base64") }],
        });
        const ohne = await app.inject({
            method: "POST",
            url: COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
            headers: { "content-type": "application/json" },
            payload: rumpf,
        });
        expect(ohne.statusCode).toBe(401);
        const zeit = String(Date.now());
        const falschesBild = await app.inject({
            method: "POST",
            url: COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
            headers: {
                "content-type": "application/json",
                [COMMUNITY_DISCORD_ZEIT_KOPF]: zeit,
                [COMMUNITY_DISCORD_SIGNATUR_KOPF]: await signiere(SCHLUESSEL, zeit, rumpf),
            },
            payload: rumpf,
        });
        expect(falschesBild.statusCode).toBe(400);
        const [{ n } = { n: 0 }] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_community.vorgang WHERE eingang = 'discord'`;
        expect(n).toBe(0);
    });
});
