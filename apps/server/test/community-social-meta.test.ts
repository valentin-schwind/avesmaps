import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AVENTURIA,
    KANAL_MIT_ZUGANG,
    SocialDetail,
    SocialKanaele,
    SocialKanalStand,
    SocialQuittung,
    ZAEHLREGELN,
    engsterKanal,
    fassungFuer,
    kanalKontext,
    mediaInstagramUrl,
    pruefeBeitrag,
    zaehleAlle,
    zaehleKanal,
    type Role,
    type SocialKanaele as Kanaele,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import * as facebook from "../src/community/social/kanaele/facebook.ts";
import * as instagram from "../src/community/social/kanaele/instagram.ts";
import {
    META_GRAPH_VERSION_VORGABE,
    kanalEingerichtet,
    leseGraphVersion,
    leseMetaZugang,
    leseOeffentlicheHerkunft,
    metaEingerichtet,
} from "../src/community/social/kanaele/konfiguration.ts";
import { metaGrenzen } from "../src/community/social/kanaele/meta.ts";
import { MetaFehler } from "../src/community/social/kanaele/meta-graph.ts";
import { grenzenAusTafel, pflegeKanaele, pruefeUndSpeichereMetaZugang } from "../src/community/social/kanaele/stand.ts";
import { PRUEFFAELLE_INSTAGRAM, faelleFuer } from "../src/community/social/pruefen-meta.ts";
import { baueProben, runSocialPruefen, type PruefenDeps } from "../src/community/social/pruefen.ts";
import { webpHashDieserUmgebung } from "../src/community/social/pruefen-meta.ts";
import { MediaStore, instagramKey, storageKey } from "../src/media/storage.ts";
import type { InstagramAblage } from "../src/community/social/instagram-ableitung.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JOB_HANDLERS, type JobContext } from "../src/jobs/handlers.ts";
import { SOCIAL_SENDEN_KIND } from "../src/community/social/kanaele/konfiguration.ts";
import { leseSendenAuftrag, runSocialSendenJob } from "../src/jobs/social-senden-job.ts";
import { stelleInstanz } from "./support/mastodon-instanz.ts";
import { stelleGraph, type GestellteGraph, type MetaStellOptionen } from "./support/meta-graph.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Kanäle Facebook und Instagram des Social Hubs (WI-0268 C12b, Migration 0286) gegen echtes PostgreSQL, mit gestellter Graph-Schnittstelle: es geht NIE ein echter Aufruf an Meta hinaus.
 *
 * - Konfiguration: Konto, Schlüssel und Version aus der Umgebung; fehlt etwas, gibt es den Kanal nicht (jeder für sich). Der Schlüssel taucht nirgends auf.
 * - Facebook: Text und Bild, Zurücknehmen. Instagram: Bild ist Pflicht und braucht eine öffentliche Adresse, zwei Schritte mit Abwarten (mit Zeitgrenze), kein Zurücknehmen.
 * - Meta kennt keinen Idempotenz-Kopf: Wiederholungen ohne Doppeltes über die Kennung der Sendung; Instagram merkt den Container.
 * - Ohne Freischaltung (Prüflauf JE KANAL) und bei Notschalter wird nicht gesendet; ein Ausfall ändert die Neuigkeit nicht; drei Kanäle zugleich, einer scheitert, die anderen gehen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SEITE = "100000000000001";
const KONTO = "170000000000002";
const FB_TOKEN = "EAAGfacebook-geheim-1234567890-abcdef";
const IG_TOKEN = "EAAGinstagram-geheim-1234567890-abcdef";
const ORIGIN = "https://avesmaps.beispiel.org";
const FB_ENV: NodeJS.ProcessEnv = {
    COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID: SEITE,
    COMMUNITY_SOCIAL_FACEBOOK_TOKEN: FB_TOKEN,
};
const IG_ENV: NodeJS.ProcessEnv = {
    COMMUNITY_SOCIAL_INSTAGRAM_USER_ID: KONTO,
    COMMUNITY_SOCIAL_INSTAGRAM_TOKEN: IG_TOKEN,
};
const MASTODON_ENV: NodeJS.ProcessEnv = {
    COMMUNITY_SOCIAL_MASTODON_URL: "https://mastodon.beispiel.test",
    COMMUNITY_SOCIAL_MASTODON_TOKEN: "tok-mastodon-1234567890-abcdef",
};
const META_ENV: NodeJS.ProcessEnv = { ...FB_ENV, ...IG_ENV, PUBLIC_ORIGIN: ORIGIN };
const ALLE_ENV: NodeJS.ProcessEnv = { ...MASTODON_ENV, ...META_ENV };

const keineWartezeit = (): Promise<void> => Promise.resolve();

// --- Konfiguration (ohne Datenbank) ----------------------------------------------------------------------------------------------

describe("Meta: Konfiguration", () => {
    it("🔴 ohne Konto oder Schlüssel gibt es den Kanal nicht; jeder Kanal für sich", () => {
        expect(leseMetaZugang("facebook", {})).toBeUndefined();
        expect(leseMetaZugang("facebook", { COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID: SEITE })).toBeUndefined();
        expect(leseMetaZugang("facebook", { COMMUNITY_SOCIAL_FACEBOOK_TOKEN: FB_TOKEN })).toBeUndefined();
        expect(metaEingerichtet("facebook", FB_ENV)).toBe(true);
        // Facebook eingerichtet heißt nicht Instagram eingerichtet, und der Schlüssel der einen gilt nicht für die andere.
        expect(metaEingerichtet("instagram", FB_ENV)).toBe(false);
        expect(kanalEingerichtet("instagram", FB_ENV)).toBe(false);
        expect(kanalEingerichtet("facebook", FB_ENV)).toBe(true);
        expect(kanalEingerichtet("mastodon", FB_ENV)).toBe(false);
        expect(kanalEingerichtet("neuigkeiten", FB_ENV)).toBe(false);
    });

    it.each([
        ["Konto mit Buchstaben", { COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID: "abc123456" }],
        ["Konto zu kurz", { COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID: "123" }],
        ["Konto mit Pfad", { COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID: "100000000000001/../x" }],
        ["Schlüssel mit Leerzeichen", { COMMUNITY_SOCIAL_FACEBOOK_TOKEN: "EAAG geheim 1234567890" }],
        ["Schlüssel mit Zeilenumbruch", { COMMUNITY_SOCIAL_FACEBOOK_TOKEN: "EAAG-geheim-1234567890\nX-Evil: 1" }],
        ["Schlüssel zu kurz", { COMMUNITY_SOCIAL_FACEBOOK_TOKEN: "kurz" }],
        ["Version ohne v", { COMMUNITY_SOCIAL_META_GRAPH_VERSION: "21.0" }],
        ["Version mit Pfad", { COMMUNITY_SOCIAL_META_GRAPH_VERSION: "v21.0/../x" }],
    ])("🔴 %s macht den Kanal unbrauchbar", (_name, patch) => {
        expect(leseMetaZugang("facebook", { ...FB_ENV, ...patch })).toBeUndefined();
    });

    it("die Version der Schnittstelle ist eine Einstellung: Vorgabe, wenn leer; sonst die genannte", () => {
        expect(leseGraphVersion({})).toBe(META_GRAPH_VERSION_VORGABE);
        expect(leseGraphVersion({ COMMUNITY_SOCIAL_META_GRAPH_VERSION: "  " })).toBe(META_GRAPH_VERSION_VORGABE);
        expect(leseGraphVersion({ COMMUNITY_SOCIAL_META_GRAPH_VERSION: "v23.0" })).toBe("v23.0");
        const zugang = leseMetaZugang("facebook", { ...FB_ENV, COMMUNITY_SOCIAL_META_GRAPH_VERSION: "v23.0" })!;
        expect(zugang.adresse(`/${SEITE}/feed`)).toBe(`https://graph.facebook.com/v23.0/${SEITE}/feed`);
        expect(leseMetaZugang("facebook", FB_ENV)!.adresse(`/${SEITE}`, { fields: "id" })).toBe(
            `https://graph.facebook.com/${META_GRAPH_VERSION_VORGABE}/${SEITE}?fields=id`,
        );
    });

    it("🔴 der Schlüssel steht in keiner Ausgabe: weder JSON noch Spread noch inspect noch ein Fehlertext", () => {
        const zugang = leseMetaZugang("instagram", IG_ENV)!;
        expect(JSON.stringify(zugang)).not.toContain(IG_TOKEN);
        expect(JSON.stringify({ ...zugang })).not.toContain(IG_TOKEN);
        expect(JSON.stringify(zugang)).not.toContain(KONTO);
        expect(inspect(zugang, { depth: 5, showHidden: true })).not.toContain(IG_TOKEN);
        expect(zugang.anmeldeKopf()).toEqual({ Authorization: `Bearer ${IG_TOKEN}` });
        expect(zugang.entschaerfe(`Fehler mit ${IG_TOKEN} im Text`)).toBe("Fehler mit … im Text");
    });

    it("🔴 aus dem Pfad kommt nie eine Adresse außerhalb der Schnittstelle von Meta", () => {
        const zugang = leseMetaZugang("facebook", FB_ENV)!;
        for (const pfad of [
            "/etc/passwd",
            "//boese.test/x",
            `/${SEITE}//feed`,
            `/${SEITE}/../x`,
            `/${SEITE}/https://boese.test`,
            `/${SEITE}/feed?x=1`,
            `/${SEITE}/\n`,
            `${SEITE}/feed`,
            "/12",
        ])
            expect(() => zugang.adresse(pfad), pfad).toThrow();
        expect(() => zugang.adresse(`/${SEITE}`, { fields: "id\nX" })).toThrow();
        expect(() => zugang.adresse(`/${SEITE}`, { "Fields&x": "id" })).toThrow();
    });

    it("🔴 Meta holt das Bild selbst ab: Nur eine öffentlich erreichbare Herkunft taugt", () => {
        expect(leseOeffentlicheHerkunft({ PUBLIC_ORIGIN: "https://avesmaps.de" })?.host).toBe("avesmaps.de");
        for (const privat of [
            "http://avesmaps.de",
            "https://localhost:3000",
            "https://127.0.0.1",
            "https://[::1]",
            "https://stage.tailnet.ts.net",
            "https://avesmaps.test",
            "https://avesmaps.local",
            "https://avesmaps.internal",
            "https://rechner",
            "https://avesmaps.de/pfad",
        ])
            expect(leseOeffentlicheHerkunft({ PUBLIC_ORIGIN: privat }), privat).toBeUndefined();
        expect(leseOeffentlicheHerkunft({})).toBeUndefined();
    });
});

// --- Facebook: Anbindung (ohne Datenbank) ----------------------------------------------------------------------------------------

describe("Facebook: Anbindung gegen die gestellte Schnittstelle", () => {
    const zugang = leseMetaZugang("facebook", FB_ENV)!;

    it("prüft den Zugang (die Seite gehört zum Schlüssel) mit Version, Anmeldung und ohne Weiterleitung", async () => {
        const graph = stelleGraph();
        await facebook.leseKonto(zugang, { fetch: graph.fetch });
        expect(graph.aufrufe).toHaveLength(1);
        const aufruf = graph.aufrufe[0]!;
        expect(aufruf).toMatchObject({
            methode: "GET",
            host: "graph.facebook.com",
            version: META_GRAPH_VERSION_VORGABE,
            pfad: `/${SEITE}`,
        });
        expect(aufruf.abfrage).toEqual({ fields: "id" });
        expect(aufruf.kopf.get("Authorization")).toBe(`Bearer ${FB_TOKEN}`);
        expect(aufruf.redirect).toBe("manual");
        // Der Schlüssel gehört zu einer anderen Seite.
        const fremd = stelleGraph({ seite: "100000000000009" });
        const antwort = await facebook.leseKonto(zugang, { fetch: fremd.fetch }).catch((e: unknown) => e);
        expect(antwort).toBeInstanceOf(MetaFehler);
        expect((antwort as MetaFehler).dauerhaft).toBe(true);
    });

    it("sendet einen Text als Eintrag der Seite (öffentlich) und gibt Kennung und Adresse zurück", async () => {
        const graph = stelleGraph();
        const gesendet = await facebook.sende(zugang, { text: "Hallo Aventurien" }, { fetch: graph.fetch });
        expect(gesendet.id).toMatch(/^100000000000001_\d+$/u);
        expect(gesendet.url).toBe(`https://www.facebook.com/${gesendet.id}`);
        const aufruf = graph.aufrufe[0]!;
        expect(aufruf).toMatchObject({
            methode: "POST",
            pfad: `/${SEITE}/feed`,
            felder: { message: "Hallo Aventurien", published: "true" },
        });
        expect(aufruf.kopf.get("Authorization")).toBe(`Bearer ${FB_TOKEN}`);
        expect(aufruf.redirect).toBe("manual");
        expect([...graph.facebook.values()][0]).toMatchObject({
            text: "Hallo Aventurien",
            veroeffentlicht: true,
            foto: null,
        });
        // Mit einer Adresse als Vorschaukarte (die Schnittstelle kennt `link`).
        await facebook.sende(zugang, { text: "Mit Karte", link: "https://avesmaps.de/" }, { fetch: graph.fetch });
        expect(graph.aufrufe[1]!.felder).toMatchObject({ link: "https://avesmaps.de/" });
        // Unveröffentlicht (Prüflauf): nur Administratoren der Seite sehen es.
        await facebook.sende(zugang, { text: "Probe", veroeffentlicht: false }, { fetch: graph.fetch });
        expect(graph.aufrufe[2]!.felder).toMatchObject({ published: "false" });
    });

    it("sendet ein Bild als Foto mit Beschreibung; gelöscht wird über die Kennung des Fotos, die Adresse kommt vom Beitrag", async () => {
        const graph = stelleGraph();
        const gesendet = await facebook.sende(
            zugang,
            {
                text: "Eine Karte",
                bild: { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp", beschreibung: "Die Reichsstraße" },
            },
            { fetch: graph.fetch },
        );
        const aufruf = graph.aufrufe[0]!;
        expect(aufruf.pfad).toBe(`/${SEITE}/photos`);
        expect(aufruf.felder).toMatchObject({
            caption: "Eine Karte",
            published: "true",
            alt_text_custom: "Die Reichsstraße",
            source: { typ: "image/webp", groesse: 3 },
        });
        expect(gesendet.id).toMatch(/^9\d+$/u);
        expect(gesendet.url).toMatch(/^https:\/\/www\.facebook\.com\/100000000000001_\d+$/u);
        await facebook.nimmZurueck(zugang, gesendet.id, { fetch: graph.fetch });
        expect(graph.facebook.size).toBe(0);
    });

    it("löscht einen Beitrag; ist er dort nicht (mehr) da, ist das Ziel erreicht; eine unbrauchbare Kennung geht nie in einen Pfad; gibtEs fragt nach", async () => {
        const graph = stelleGraph();
        const gesendet = await facebook.sende(zugang, { text: "weg" }, { fetch: graph.fetch });
        expect(await facebook.gibtEs(zugang, gesendet.id, { fetch: graph.fetch })).toBe(true);
        await facebook.nimmZurueck(zugang, gesendet.id, { fetch: graph.fetch });
        expect(graph.facebook.size).toBe(0);
        await facebook.nimmZurueck(zugang, gesendet.id, { fetch: graph.fetch });
        expect(await facebook.gibtEs(zugang, gesendet.id, { fetch: graph.fetch })).toBe(false);
        const vorher = graph.aufrufe.length;
        await expect(facebook.nimmZurueck(zugang, "1/../../x", { fetch: graph.fetch })).rejects.toBeInstanceOf(
            MetaFehler,
        );
        await expect(facebook.gibtEs(zugang, "x", { fetch: graph.fetch })).rejects.toBeInstanceOf(MetaFehler);
        expect(graph.aufrufe.length).toBe(vorher);
    });

    it("🔴 Fehler sind feste Sätze ohne Schlüssel; dauerhaft oder vorübergehend nach den Codes von Meta", async () => {
        const mit = async (fehler: MetaStellOptionen["fehler"]): Promise<MetaFehler> => {
            const graph = stelleGraph({ fehler });
            try {
                await facebook.sende(zugang, { text: "x" }, { fetch: graph.fetch });
            } catch (e) {
                return e as MetaFehler;
            }
            throw new Error("kein Fehler");
        };
        const meta =
            (status: number, code: number, message = "Fehler", sub?: number) =>
            () =>
                new Response(
                    JSON.stringify({ error: { message, code, ...(sub === undefined ? {} : { error_subcode: sub }) } }),
                    { status },
                );
        const faelle: [string, MetaStellOptionen["fehler"], boolean][] = [
            ["190 abgelaufen", meta(400, 190, `Token ${FB_TOKEN} expired`), true],
            ["401", () => new Response("{}", { status: 401 }), true],
            ["10 Berechtigung", meta(400, 10, "no permission"), true],
            ["200 Berechtigung", meta(403, 200, "perm"), true],
            ["100 Parameter", meta(400, 100, `Invalid parameter ${FB_TOKEN}`), true],
            ["368 gesperrt", meta(400, 368), true],
            ["4 Drosselung", meta(400, 4, "rate"), false],
            ["17 Drosselung", meta(400, 17), false],
            ["429", () => new Response("{}", { status: 429 }), false],
            ["1 Dienst", meta(500, 1), false],
            ["503", () => new Response("<html>", { status: 503 }), false],
            ["302", () => new Response(null, { status: 302 }), true],
            ["netz", () => "netz", false],
        ];
        for (const [name, fehler, dauerhaft] of faelle) {
            const f = await mit(fehler);
            expect(f.dauerhaft, name).toBe(dauerhaft);
            expect(f.message, name).not.toContain(FB_TOKEN);
            expect(f.message, name).not.toContain("graph.facebook.com");
            expect(f.message.length, name).toBeLessThan(260);
        }
        // Eine Ablehnung nennt, was Meta sagt (gekürzt und ohne Schlüssel).
        expect((await mit(meta(400, 100, "The message is too long"))).message).toContain("The message is too long");
    });

    it("🔴 Meta nennt nach einem gelungenen Aufruf keine Kennung: dauerhaft (kein zweites Senden), der Satz sagt, dass dort nachzusehen ist", async () => {
        const graph = stelleGraph({ fehler: () => new Response("{}", { status: 200 }) });
        const fehler = await facebook
            .sende(zugang, { text: "x" }, { fetch: graph.fetch })
            .catch((e: unknown) => e as MetaFehler);
        expect(fehler).toBeInstanceOf(MetaFehler);
        expect((fehler as MetaFehler).dauerhaft).toBe(true);
        expect((fehler as MetaFehler).message).toContain("bitte dort nachsehen");
    });

    it("die Zeitgrenze bricht einen hängenden Aufruf ab", async () => {
        const haengt: typeof globalThis.fetch = (_url, init) =>
            new Promise((_ok, fehler) => {
                init?.signal?.addEventListener("abort", () => fehler(new DOMException("zu spät", "TimeoutError")));
            });
        const ergebnis = await facebook.leseKonto(zugang, { fetch: haengt, timeoutMs: 20 }).catch((e: unknown) => e);
        expect(ergebnis).toBeInstanceOf(MetaFehler);
        expect((ergebnis as MetaFehler).message).toBe("Facebook: Meta hat nicht rechtzeitig geantwortet");
        expect((ergebnis as MetaFehler).dauerhaft).toBe(false);
    });
});

// --- Instagram: Anbindung (ohne Datenbank) ---------------------------------------------------------------------------------------

describe("Instagram: Anbindung gegen die gestellte Schnittstelle", () => {
    const zugang = leseMetaZugang("instagram", IG_ENV)!;
    const bildUrl = `${ORIGIN}/media/sha256/ab/ab/${"ab".repeat(32)}.ig.jpg`;

    it("sendet in zwei Schritten: Container anlegen, Status abwarten (bis FINISHED), veröffentlichen, Permalink lesen", async () => {
        const graph = stelleGraph({ containerSchritte: 2 });
        const warten: number[] = [];
        const container: string[] = [];
        const gesendet = await instagram.sende(
            zugang,
            { text: "Eine Karte #Aventurien", bildUrl, beschreibung: "Die Reichsstraße" },
            { fetch: graph.fetch, warte: (ms) => (warten.push(ms), Promise.resolve()) },
            (id) => (container.push(id), Promise.resolve()),
        );
        expect(graph.aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual([
            `POST /${KONTO}/media`,
            "GET /700000001",
            "GET /700000001",
            "GET /700000001",
            `POST /${KONTO}/media_publish`,
            "GET /800000001",
        ]);
        expect(graph.aufrufe[0]!.felder).toEqual({
            image_url: bildUrl,
            caption: "Eine Karte #Aventurien",
            alt_text: "Die Reichsstraße",
        });
        expect(graph.aufrufe[1]!.abfrage).toEqual({ fields: "status_code" });
        expect(graph.aufrufe[4]!.felder).toEqual({ creation_id: "700000001" });
        expect(
            graph.aufrufe.every((a) => a.kopf.get("Authorization") === `Bearer ${IG_TOKEN}` && a.redirect === "manual"),
        ).toBe(true);
        expect(warten).toEqual([2000, 2000]);
        expect(container).toEqual(["700000001"]);
        expect(gesendet).toEqual({ id: "800000001", url: "https://www.instagram.com/p/800000001/" });
    });

    it("nennt Meta keinen Permalink, steht die Adresse des Kontos da (der Beitrag ist trotzdem gesendet)", async () => {
        const graph = stelleGraph({ permalink: null });
        const gesendet = await instagram.sende(
            zugang,
            { text: "x", bildUrl, beschreibung: "B" },
            { fetch: graph.fetch, warte: keineWartezeit },
        );
        expect(gesendet.url).toBe(instagram.INSTAGRAM_ALLGEMEIN);
        expect(graph.instagram.size).toBe(1);
    });

    it("🔴 die Zeitgrenze beim Abwarten: bleibt der Container in Arbeit, endet der Versuch vorübergehend (15 Abfragen), und er hat keinen zweiten Container angelegt", async () => {
        const graph = stelleGraph({ containerSchritte: "nie" });
        const warten: number[] = [];
        const fehler = await instagram
            .sende(
                zugang,
                { text: "x", bildUrl, beschreibung: "B" },
                { fetch: graph.fetch, warte: (ms) => (warten.push(ms), Promise.resolve()) },
            )
            .catch((e: unknown) => e as MetaFehler);
        expect(fehler).toBeInstanceOf(MetaFehler);
        expect((fehler as MetaFehler).dauerhaft).toBe(false);
        expect((fehler as MetaFehler).message).toBe("Instagram: Meta hat das Bild nicht rechtzeitig verarbeitet");
        expect(warten).toHaveLength(instagram.CONTAINER_VERSUCHE);
        expect(graph.container.size).toBe(1);
        expect(graph.instagram.size).toBe(0);
    });

    it("ein Container, der mit ERROR endet, ist ein dauerhafter Fehler; ein abgelaufener wird durch EINEN neuen ersetzt", async () => {
        const kaputt = stelleGraph({ containerSchritte: "fehler" });
        const fehler = await instagram
            .sende(zugang, { text: "x", bildUrl, beschreibung: "B" }, { fetch: kaputt.fetch, warte: keineWartezeit })
            .catch((e: unknown) => e as MetaFehler);
        expect((fehler as MetaFehler).dauerhaft).toBe(true);
        const abgelaufen = stelleGraph({ containerSchritte: "abgelaufen" });
        const zweiter = await instagram
            .sende(
                zugang,
                { text: "x", bildUrl, beschreibung: "B", container: "699999999" },
                { fetch: abgelaufen.fetch, warte: keineWartezeit },
            )
            .catch((e: unknown) => e as MetaFehler);
        // Der vorgemerkte Container ist Meta unbekannt (Fehler 100); mit EXPIRED ersetzt der Hub ihn einmal, dann endet es vorübergehend.
        expect(zweiter).toBeInstanceOf(MetaFehler);
    });

    it("🔴 ein weiterverwendeter Container wird nicht neu angelegt; ein schon veröffentlichter wird nicht noch einmal veröffentlicht", async () => {
        const graph = stelleGraph();
        const eins = await instagram.legeContainerAn(
            zugang,
            { text: "x", bildUrl, beschreibung: "B" },
            { fetch: graph.fetch },
        );
        const gesendet = await instagram.sende(
            zugang,
            { text: "x", bildUrl, beschreibung: "B", container: eins },
            { fetch: graph.fetch, warte: keineWartezeit },
        );
        expect(graph.container.size).toBe(1);
        expect(graph.instagram.size).toBe(1);
        // Noch einmal mit demselben Container (die Antwort der Veröffentlichung ging verloren): kein zweiter Beitrag.
        const nochmal = await instagram.sende(
            zugang,
            { text: "x", bildUrl, beschreibung: "B", container: eins },
            { fetch: graph.fetch, warte: keineWartezeit },
        );
        expect(graph.container.size).toBe(1);
        expect(graph.instagram.size).toBe(1);
        expect(nochmal).toEqual({ id: eins, url: instagram.INSTAGRAM_ALLGEMEIN });
        expect(gesendet.id).toBe("800000001");
    });

    it("🔴 Fehler: eine zu lange Unterschrift ist dauerhaft; ohne https-Bild lehnt Meta ab; der Schlüssel steht in keinem Satz", async () => {
        const graph = stelleGraph({ instagramMax: 10 });
        const lang = await instagram
            .sende(
                zugang,
                { text: "x".repeat(11), bildUrl, beschreibung: "B" },
                { fetch: graph.fetch, warte: keineWartezeit },
            )
            .catch((e: unknown) => e as MetaFehler);
        expect((lang as MetaFehler).dauerhaft).toBe(true);
        expect((lang as MetaFehler).message).toContain("100/2207010");
        const abgelaufen = stelleGraph({
            fehler: () =>
                new Response(JSON.stringify({ error: { message: `Token ${IG_TOKEN}`, code: 190 } }), { status: 400 }),
        });
        const e = await instagram.leseKonto(zugang, { fetch: abgelaufen.fetch }).catch((x: unknown) => x as MetaFehler);
        expect((e as MetaFehler).dauerhaft).toBe(true);
        expect((e as MetaFehler).message).not.toContain(IG_TOKEN);
    });

    it("Instagram hat keine Funktion zum Löschen (Meta erlaubt es über die Schnittstelle nicht)", () => {
        expect(Object.keys(instagram).filter((name) => /zuruck|loesch|delete/iu.test(name))).toEqual([]);
    });

    it("🔴 die öffentliche Adresse des Bilds ist die der JPEG-Fassung (Instagram nimmt kein WebP): Herkunft der Umgebung plus /media/sha256/…/<hash>.ig.jpg, nur für eine veröffentlichte WebP und eine öffentliche Herkunft", () => {
        const schluessel = `published/sha256/ab/ab/${"ab".repeat(32)}.webp`;
        expect(instagram.bildAdresse(META_ENV, schluessel)).toBe(bildUrl);
        expect(instagram.bildAdresse(META_ENV, schluessel)).toBe(
            new URL(mediaInstagramUrl("ab".repeat(32)), ORIGIN).toString(),
        );
        expect(instagram.bildAdresse(META_ENV, schluessel)).not.toContain(".webp");
        // Der Schlüssel der Fassung selbst ist keine veröffentlichte WebP: Aus ihm entsteht keine Adresse.
        expect(instagram.bildAdresse(META_ENV, instagramKey("ab".repeat(32)))).toBeUndefined();
        expect(instagram.bildAdresse({ PUBLIC_ORIGIN: "https://localhost:3000" }, schluessel)).toBeUndefined();
        expect(instagram.bildAdresse({}, schluessel)).toBeUndefined();
        expect(instagram.bildAdresse(META_ENV, `private/source/sha256/ab/ab/${"ab".repeat(32)}.webp`)).toBeUndefined();
        expect(instagram.bildAdresse(META_ENV, `published/sha256/ab/ab/${"AB".repeat(32)}.webp`)).toBeUndefined();
        expect(instagram.containerAus("container:12345")).toBe("12345");
        expect(instagram.containerAus("12345")).toBeUndefined();
        expect(instagram.containerAus(null)).toBeUndefined();
    });
});

// --- Zählung und Prüfung vor dem Senden (ohne Datenbank) ---------------------------------------------------------------------------

describe("Zählung für Instagram und Facebook", () => {
    const text = (t: string, hashtags: string[] = []) => ({ text: t, hashtags });

    it("Instagram: 2200 in UTF-16-Einheiten, Hashtags zählen mit, Links zählen als Text; mehr als fünf Hashtags fallen weg", () => {
        expect(zaehleKanal("instagram", text("a".repeat(2200))).ueber).toBe(false);
        expect(zaehleKanal("instagram", text("a".repeat(2201))).zuviel).toBe(1);
        // Ein Emoji aus mehreren Code-Points zählt in UTF-16 mehr als in Graphemen (vorsichtig).
        expect(zaehleKanal("instagram", text("\u{1F468}‍\u{1F469}‍\u{1F467}")).n).toBe(8);
        // Hashtags hängen am Text (zwei Zeilenumbrüche, Leerzeichen dazwischen) und zählen mit.
        const mit = zaehleKanal("instagram", text("Karte", ["#Aventurien", "#DSA"]));
        expect(mit.n).toBe("Karte\n\n#Aventurien #DSA".length);
        // Eine lange Adresse zählt voll (kein Sonderfall wie bei Mastodon).
        const adresse = `https://example.org/${"a".repeat(60)}`;
        expect(zaehleKanal("instagram", text(adresse)).n).toBe(80);
        expect(zaehleKanal("instagram", text("x", ["#a", "#b", "#c", "#d", "#e", "#f", "#g"])).hashtagsWeg).toBe(2);
    });

    it("Facebook: großzügig (63 206 Zeichen in Code-Points), höchstens zwei Hashtags, Adressen zählen voll", () => {
        expect(zaehleKanal("facebook", text("a".repeat(63_206))).ueber).toBe(false);
        expect(zaehleKanal("facebook", text("a".repeat(63_207))).zuviel).toBe(1);
        expect(zaehleKanal("facebook", text("\u{1F468}‍\u{1F469}‍\u{1F467}")).n).toBe(5);
        expect(zaehleKanal("facebook", text("x", ["#a", "#b", "#c"])).hashtagsWeg).toBe(1);
        expect(fassungFuer(ZAEHLREGELN.facebook, text("x", ["#a", "#b", "#c"])).text).toBe("x\n\n#a #b");
    });

    it("🔴 der Zähler nennt die engste Grenze der angehakten Kanäle (Instagram 2200 vor Facebook 63 206); wer Instagram abhakt, bekommt die Länge von Facebook zurück", () => {
        const eingabe = text("a".repeat(2300));
        const beide = zaehleAlle(["facebook", "instagram"], eingabe);
        expect(engsterKanal(beide)?.kanal).toBe("instagram");
        expect(engsterKanal(beide)).toMatchObject({ grenze: 2200, zuviel: 100, ueber: true });
        expect(engsterKanal(zaehleAlle(["facebook"], eingabe))).toMatchObject({
            kanal: "facebook",
            grenze: 63_206,
            ueber: false,
        });
        // Die Prüfung vor dem Senden nennt den überlaufenden Kanal und wie viel zu viel ist.
        const bereit = kanalKontext(
            (["facebook", "instagram"] as const).map((kanal) => ({
                kanal,
                eingerichtet: true,
                freigeschaltet: true,
                freigeschaltetAt: "2026-11-01T00:00:00.000Z",
                notschalter: false,
                grenzen: null,
                grenzenAt: null,
                bereit: true,
                sperre: null,
            })),
        );
        const mit = { ...eingabe, bild: "b", bildBeschreibung: "B", bildGeklaert: true, kontext: bereit };
        expect(pruefeBeitrag({ ...mit, kanaele: ["facebook"] })).toBeNull();
        expect(pruefeBeitrag({ ...mit, kanaele: ["facebook", "instagram"] })).toEqual({
            art: "zu_lang",
            kanal: "instagram",
            zuviel: 100,
            teil: "text",
        });
    });

    it("🔴 Bildpflicht: Instagram weist einen Beitrag ohne Bild ab, Facebook nicht; die Reihenfolge nennt zuerst, was fehlt", () => {
        const eingabe = { text: "Hallo", hashtags: [], bild: null, bildBeschreibung: null };
        const bereit = kanalKontext(
            ["facebook", "instagram"].map((kanal) => ({
                kanal: kanal as "facebook" | "instagram",
                eingerichtet: true,
                freigeschaltet: true,
                freigeschaltetAt: "2026-11-01T00:00:00.000Z",
                notschalter: false,
                grenzen: null,
                grenzenAt: null,
                bereit: true,
                sperre: null,
            })),
        );
        expect(pruefeBeitrag({ ...eingabe, kanaele: ["facebook"], kontext: bereit })).toBeNull();
        expect(pruefeBeitrag({ ...eingabe, kanaele: ["facebook", "instagram"], kontext: bereit })).toEqual({
            art: "bild_fehlt",
            kanal: "instagram",
        });
        expect(
            pruefeBeitrag({
                ...eingabe,
                bild: "b",
                bildBeschreibung: "Eine Karte",
                bildGeklaert: true,
                kanaele: ["instagram"],
                kontext: bereit,
            }),
        ).toBeNull();
        // Mit Bild gilt die Beschreibungs- und Rechteprüfung wie überall.
        expect(pruefeBeitrag({ ...eingabe, bild: "b", kanaele: ["instagram"], kontext: bereit })).toEqual({
            art: "beschreibung_fehlt",
        });
        expect(
            pruefeBeitrag({
                ...eingabe,
                bild: "b",
                bildBeschreibung: "B",
                bildGeklaert: false,
                kanaele: ["instagram"],
                kontext: bereit,
            }),
        ).toEqual({ art: "bild_nicht_geklaert" });
    });

    it("alle drei Kanäle mit Zugang kennt der Hub; ihre Grenzen führt er selbst (Meta nennt keine)", () => {
        expect([...KANAL_MIT_ZUGANG]).toEqual(["mastodon", "facebook", "instagram", "discord"]);
        expect(metaGrenzen("instagram")).toMatchObject({
            zeichen: 2200,
            adresse: 0,
            bilder: 1,
            beschreibung: 1000,
            bildBytes: 8 * 1024 * 1024,
        });
        expect(metaGrenzen("facebook")).toMatchObject({ zeichen: 63_206, adresse: 0, bildBytes: 4 * 1024 * 1024 });
        // Bei Mastodon nennt die Instanz die Länge einer Adresse (mindestens 1); bei Meta ist 0 richtig.
        expect(grenzenAusTafel(metaGrenzen("facebook"), "facebook")).not.toBeNull();
        expect(grenzenAusTafel(metaGrenzen("facebook"), "mastodon")).toBeNull();
    });
});

describe("Jobart: der Kanal ist ein Teil des Auftrags", () => {
    it("🔴 dieselbe Jobart für alle drei Kanäle; die Eingabe bleibt streng", () => {
        expect(Object.keys(JOB_HANDLERS)).toContain(SOCIAL_SENDEN_KIND);
        for (const kanal of ["mastodon", "facebook", "instagram"] as const)
            expect(leseSendenAuftrag({ beitrag: 7, kanal })).toEqual({ beitrag: 7, kanal });
        for (const roh of [
            {},
            { beitrag: 0, kanal: "facebook" },
            { beitrag: 1, kanal: "bluesky" },
            { beitrag: 1, kanal: "neuigkeiten" },
            { beitrag: 1, kanal: "instagram", text: "x" },
        ])
            expect(() => leseSendenAuftrag(roh)).toThrow();
    });
});

// --- Das Werkzeug social:pruefen für Meta (ohne Datenbank) ------------------------------------------------------------------------

function pruefLauf(args: string[], environment: NodeJS.ProcessEnv, deps: PruefenDeps = {}) {
    const ausgabe: string[] = [];
    const fehler: string[] = [];
    return runSocialPruefen(
        args,
        environment,
        { out: (z) => ausgabe.push(z), err: (z) => fehler.push(z) },
        { systemUser: "probe", heute: () => "2026-11-01", warte: keineWartezeit, ...deps },
    ).then((code) => ({
        code,
        text: [...ausgabe, ...fehler].join("\n"),
        ausgabe: ausgabe.join("\n"),
        fehler: fehler.join("\n"),
    }));
}

/** Eine Schnittstelle, die jeden Aufruf meldet und scheitern lässt: Wer sie bekommt, hat ungewollt das Netz berührt. */
const verbotenGraph = (): GestellteGraph =>
    stelleGraph({
        fehler: () => {
            throw new Error("Netz berührt");
        },
    });

describe("social:pruefen für Facebook und Instagram: Aufruf", () => {
    it("🔴 der Probelauf rechnet nur: kein Netz, kein Schreibzugriff, keine Datenbank nötig", async () => {
        const graph = verbotenGraph();
        for (const kanal of ["facebook", "instagram"]) {
            const ergebnis = await pruefLauf(["--kanal", kanal], META_ENV, { fetch: graph.fetch });
            expect(ergebnis.code, ergebnis.text).toBe(0);
            expect(ergebnis.ausgabe).toContain("PROBELAUF");
            expect(ergebnis.ausgabe).toContain(kanal === "facebook" ? "63206 Zeichen" : "2200 UTF-16-Einheiten");
        }
        // Instagram sagt vorab, was das Anwenden braucht und dass die Beiträge von Hand zu löschen sind.
        const instagramLauf = await pruefLauf(["--kanal", "instagram"], META_ENV, { fetch: graph.fetch });
        expect(instagramLauf.ausgabe).toContain("--testkonto-bestaetigt");
        expect(instagramLauf.ausgabe).toContain("NICHT löschen");
        expect(graph.aufrufe).toEqual([]);
    });

    it("🔴 --anwenden ohne Zitat bricht ab, bevor es irgendetwas anfasst (jeder Kanal)", async () => {
        const graph = verbotenGraph();
        for (const kanal of ["facebook", "instagram"]) {
            for (const zusatz of [[], ["--operator-said", "  "]]) {
                const ergebnis = await pruefLauf(["--kanal", kanal, "--anwenden", ...zusatz], META_ENV, {
                    fetch: graph.fetch,
                });
                expect(ergebnis.code).toBe(2);
                expect(ergebnis.fehler).toContain("--operator-said");
            }
        }
        expect(graph.aufrufe).toEqual([]);
    });

    it("🔴 Instagram kann Testbeiträge nicht löschen: ohne --testkonto-bestaetigt und ohne --bild bricht es ab, bevor es irgendetwas anfasst", async () => {
        const graph = verbotenGraph();
        const zitat = ["--anwenden", "--operator-said", "Vali: Prüflauf mit dem Instagram-Testkonto"];
        const ohneBestaetigung = await pruefLauf(
            ["--kanal", "instagram", ...zitat, "--bild", `${ORIGIN}/media/x.webp`],
            META_ENV,
            { fetch: graph.fetch },
        );
        expect(ohneBestaetigung.code).toBe(2);
        expect(ohneBestaetigung.fehler).toContain("--testkonto-bestaetigt");
        expect(ohneBestaetigung.fehler).toContain("kein Löschen");
        const ohneBild = await pruefLauf(["--kanal", "instagram", ...zitat, "--testkonto-bestaetigt"], META_ENV, {
            fetch: graph.fetch,
        });
        expect(ohneBild.code).toBe(2);
        expect(ohneBild.fehler).toContain("--bild");
        expect(graph.aufrufe).toEqual([]);
    });

    it("ein falscher Aufruf: --bild bei Facebook, --bild ohne https, --testkonto-bestaetigt bei Mastodon, ein anderer Kanal", async () => {
        const graph = verbotenGraph();
        expect(
            (await pruefLauf(["--kanal", "facebook", "--bild", `${ORIGIN}/x.webp`], META_ENV, { fetch: graph.fetch }))
                .code,
        ).toBe(2);
        expect(
            (
                await pruefLauf(["--kanal", "instagram", "--bild", "http://avesmaps.beispiel.org/x.webp"], META_ENV, {
                    fetch: graph.fetch,
                })
            ).code,
        ).toBe(2);
        expect(
            (await pruefLauf(["--kanal", "mastodon", "--testkonto-bestaetigt"], MASTODON_ENV, { fetch: graph.fetch }))
                .code,
        ).toBe(2);
        expect((await pruefLauf(["--kanal", "bluesky"], META_ENV)).code).toBe(2);
        expect(graph.aufrufe).toEqual([]);
    });

    it("🔴 ohne Konfiguration des Kanals geht nichts hinaus", async () => {
        const graph = verbotenGraph();
        const ergebnis = await pruefLauf(
            ["--kanal", "facebook", "--anwenden", "--operator-said", "ja"],
            { AVESMAPS_ENV: "test", DATABASE_URL: "postgres://x" },
            { fetch: graph.fetch, database: {} as Database },
        );
        expect(ergebnis.code).toBe(1);
        expect(ergebnis.fehler).toContain("gibt es den Kanal nicht");
        expect(graph.aufrufe).toEqual([]);
    });

    it("🔴 die Proben liegen nach der Zählregel GENAU an der Grenze bzw. eins darüber; Instagram schickt wenige Fälle, ohne Erwähnung und Hashtag", () => {
        for (const kanal of ["facebook", "instagram"] as const) {
            const regel = ZAEHLREGELN[kanal];
            const n = (t: string) => zaehleKanal(kanal, { text: t, hashtags: [] }).n;
            for (const probe of baueProben(regel, faelleFuer(kanal))) {
                expect(n(probe.grenze), `${kanal} ${probe.fall.name}`).toBe(regel.grenze);
                expect(n(probe.darueber), `${kanal} ${probe.fall.name}`).toBe(regel.grenze + 1);
            }
        }
        expect(faelleFuer("facebook")).toHaveLength(9);
        expect(faelleFuer("instagram").map((f) => f.id)).toEqual(PRUEFFAELLE_INSTAGRAM);
        const ig = faelleFuer("instagram")
            .map((f) => f.text)
            .join(" ");
        expect(ig).not.toContain("@");
        expect(ig).not.toContain("#");
    });
});

describe("Prüflauf Instagram: wann ist --bild ein Medium dieser Umgebung?", () => {
    const hash = "ab".repeat(32);
    const eigen = `${ORIGIN}/media/sha256/ab/ab/${hash}.webp`;

    it("nur die WebP-Adresse genau dieser öffentlichen Herkunft in der Form von mediaPublicUrl", () => {
        expect(webpHashDieserUmgebung(eigen, META_ENV)).toBe(hash);
        for (const anders of [
            `https://fremd.beispiel.org/media/sha256/ab/ab/${hash}.webp`,
            `${ORIGIN}/media/sha256/ab/ab/${hash}.ig.jpg`,
            `${ORIGIN}/media/sha256/ab/ab/${hash}.jpg`,
            `${ORIGIN}/media/sha256/cd/ab/${hash}.webp`,
            `${ORIGIN}/media/sha256/AB/AB/${"AB".repeat(32)}.webp`,
            `${ORIGIN}/media/sha256/ab/ab/${hash}.webp?x=1`,
            `${ORIGIN}/media/sha256/ab/ab/${hash}.webp#x`,
            `https://nutzer:geheim@avesmaps.beispiel.org/media/sha256/ab/ab/${hash}.webp`,
            `${ORIGIN}/x/media/sha256/ab/ab/${hash}.webp`,
            "kein-url",
        ])
            expect(webpHashDieserUmgebung(anders, META_ENV), anders).toBeUndefined();
    });

    it("ohne öffentliche Herkunft der Umgebung (leer, privat) ist keine Adresse ein eigenes Medium", () => {
        expect(webpHashDieserUmgebung(eigen, {})).toBeUndefined();
        expect(webpHashDieserUmgebung(eigen, { PUBLIC_ORIGIN: "http://localhost:3000" })).toBeUndefined();
        expect(webpHashDieserUmgebung(eigen, { PUBLIC_ORIGIN: "https://stage.tailnet.ts.net" })).toBeUndefined();
    });
});

// --- Mit Datenbank ---------------------------------------------------------------------------------------------------------------

function serverConfig(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "social-meta-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

interface Quittung {
    id: number;
    nr: string;
    revision: number;
    zustand: "entwurf" | "vorgelegt" | "veroeffentlicht";
}

describeWithDatabase(
    "Facebook und Instagram als Kanäle des Social Hubs (PostgreSQL, gestellte Schnittstelle)",
    { timeout: 120_000 },
    () => {
        let database: Database;
        let fixture: AuthFixture;
        let app: FastifyInstance;
        let edda: { id: string; cookie: string };
        let betreiber: { id: string; cookie: string };
        let frisch: { id: string; cookie: string };
        const gesichert: Record<string, string | undefined> = {};
        /** Die Medienablage des Tests: ein Wegwerfordner mit einer echten WebP unter `published/` (ihr Hash ist ein gesetzter, der Speicher prüft ihn nicht). */
        let medienWurzel: string;
        let medien: MediaStore;
        const WEBP_HASH = "ab".repeat(32);
        const webpSchluessel = storageKey("published", WEBP_HASH, "webp");

        async function legeWebpAb(breite = 1200, hoehe = 800): Promise<void> {
            const webp = await sharp({ create: { width: breite, height: hoehe, channels: 3, background: "#3a6" } })
                .webp()
                .toBuffer();
            const pfad = medien.pathFor(webpSchluessel);
            await mkdir(dirname(pfad), { recursive: true });
            await writeFile(pfad, webp);
        }

        async function leeren(): Promise<void> {
            await database`DELETE FROM job WHERE kind = ${SOCIAL_SENDEN_KIND}`;
            await database`DELETE FROM avesmaps_community.beitrag`;
            await database`DELETE FROM avesmaps_community.kanal_stand`;
            await database`DELETE FROM public.news_entry`;
            await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.social_%'`;
            await database`DELETE FROM public.benachrichtigung WHERE art = 'social_freigabe'`;
        }

        beforeAll(async () => {
            for (const name of Object.keys(ALLE_ENV)) gesichert[name] = process.env[name];
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
            const person = async (role: Role, name: string, passkeyMinutesAgo = 60) => {
                const created = await fixture.person(role, { name });
                const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo });
                return { id: created.id, cookie };
            };
            edda = await person("editor", "Edda");
            betreiber = await person("operator", "Rondrikan");
        });

        beforeEach(async () => {
            frisch = {
                id: betreiber.id,
                cookie: (await fixture.session(betreiber.id, { assurance: "strong", passkeyMinutesAgo: 1 })).cookie,
            };
            for (const [name, wert] of Object.entries(ALLE_ENV)) process.env[name] = wert;
            medienWurzel = await mkdtemp(join(tmpdir(), "avesmaps3d-social-ig-"));
            medien = new MediaStore(medienWurzel);
            await legeWebpAb();
            await leeren();
        });

        afterEach(async () => {
            vi.restoreAllMocks();
            await rm(medienWurzel, { recursive: true, force: true });
        });

        afterAll(async () => {
            for (const name of Object.keys(ALLE_ENV)) {
                const alt = gesichert[name];
                if (alt === undefined) delete process.env[name];
                else process.env[name] = alt;
            }
            await app?.close();
            await leeren().catch(() => undefined);
            await fixture?.cleanup();
            await database?.end({ timeout: 5 });
        });

        // --- Hilfen -----------------------------------------------------------------------------------------------------------

        const get = (url: string, cookie?: string) =>
            app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
        const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
            app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
        const code = (response: { statusCode: number; json(): unknown }): string =>
            response.statusCode < 300
                ? String(response.statusCode)
                : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
        const meldung = (response: { json(): unknown }): string =>
            (response.json() as { error: { message: string } }).error.message;

        const inhalt = (patch: Record<string, unknown> = {}) => ({
            titel: "Die Reichsstraße ist da",
            text: "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.",
            hashtags: ["Aventurien", "Karte"],
            rubrik: "karte",
            ki: false,
            kanaele: ["neuigkeiten", "facebook"],
            ...patch,
        });
        const anlegen = async (cookie: string, patch: Record<string, unknown> = {}): Promise<Quittung> => {
            const antwort = await post(
                "/api/community/social",
                { operationId: randomUUID(), ...inhalt(patch) },
                cookie,
            );
            expect(code(antwort)).toBe("201");
            expect(Value.Check(SocialQuittung, antwort.json())).toBe(true);
            return antwort.json() as Quittung;
        };
        const schritt = (
            id: number,
            was: string,
            revision: number,
            cookie: string,
            extra: Record<string, unknown> = {},
        ) =>
            post(
                `/api/community/social/${String(id)}/${was}`,
                { operationId: randomUUID(), baseRevision: revision, ...extra },
                cookie,
            );
        const tu = async (
            id: number,
            was: string,
            revision: number,
            cookie: string,
            extra: Record<string, unknown> = {},
        ): Promise<Quittung> => {
            const antwort = await schritt(id, was, revision, cookie, extra);
            expect(code(antwort), was).toBe("200");
            return antwort.json() as Quittung;
        };
        const detail = async (id: number) => {
            const antwort = await get(`/api/community/social/${String(id)}`, betreiber.cookie);
            expect(code(antwort)).toBe("200");
            const body = antwort.json() as SocialDetail;
            expect(Value.Check(SocialDetail, body)).toBe(true);
            return body;
        };
        const ziel = async (id: number, kanal: string) => (await detail(id)).zeile.ziele.find((z) => z.kanal === kanal);
        const kanaele = async (): Promise<Kanaele> => {
            const antwort = await get("/api/community/social/kanaele", betreiber.cookie);
            expect(code(antwort)).toBe("200");
            expect(Value.Check(SocialKanaele, antwort.json())).toBe(true);
            return antwort.json() as Kanaele;
        };
        const stand = async (kanal: string) => (await kanaele()).kanaele.find((s) => s.kanal === kanal)!;
        const protokoll = (action: string) =>
            database<{ target_ref: string | null; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;
        const auftraege = () =>
            database<{ input_ref: { beitrag: number; kanal: string }; state: string }[]>`
            SELECT input_ref, state FROM job WHERE kind = ${SOCIAL_SENDEN_KIND} ORDER BY id
        `;
        const sendung = async (id: number, kanal: string) => {
            const [zeile] = await database<
                { idempotenz: string; extern_id: string | null; aufgabe: string | null; versuche: number }[]
            >`
            SELECT idempotenz::text, extern_id, aufgabe, versuche FROM avesmaps_community.sendung WHERE beitrag_id = ${id}::bigint AND kanal = ${kanal}
        `;
            return zeile;
        };
        const neuigkeiten = (beitrag: number) =>
            database<
                { zustand: string }[]
            >`SELECT zustand FROM public.news_entry WHERE beitrag_id = ${beitrag}::bigint`;

        /** Grenzen gelesen und die Zählregel geprüft: der Zustand nach `social:pruefen` für diesen Kanal. */
        async function bereitMachen(...kanaeleListe: ("facebook" | "instagram")[]): Promise<void> {
            for (const kanal of kanaeleListe.length === 0 ? (["facebook", "instagram"] as const) : kanaeleListe) {
                await database`SELECT avesmaps_community.social_kanal_grenzen_setzen(${kanal}, ${database.json(metaGrenzen(kanal) as never)}::jsonb)`;
                await database`SELECT avesmaps_community.social_kanal_pruefung_eintragen(${kanal}, 'cli:test', true, '{}'::jsonb)`;
            }
        }
        async function veroeffentlichen(patch: Record<string, unknown> = {}): Promise<Quittung> {
            const b = await anlegen(edda.cookie, patch);
            const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            return tu(b.id, "freigeben", vorgelegt.revision, betreiber.cookie);
        }
        async function medium(klaerung: string, mit = true): Promise<string> {
            const [asset] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO public.media_asset (media_kind, origin, source_system, title)
            VALUES ('image', 'editor_upload', 'test', 'Karte der Reichsstraße') RETURNING id::text, public_id::text
        `;
            await database`
            INSERT INTO public.media_rights (media_asset_id, rights_basis, clearance_state)
            VALUES (${asset!.id}::bigint, 'own_work', ${klaerung})
        `;
            if (mit) {
                const hash = "ab".repeat(32);
                await database`
                INSERT INTO public.media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                VALUES (${asset!.id}::bigint, 'ansicht', 'published', ${`published/sha256/ab/ab/${hash}.webp`}, 'image/webp', 1200, 800, 3, ${hash}, 'ansicht', '1')
            `;
            }
            return asset!.public_id;
        }
        const kontext = (beitrag: number, kanal: string): JobContext => ({
            input: { beitrag, kanal },
            attempt: 1,
            job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
            beginPhase: () => Promise.resolve(),
            checkpoint: () => undefined,
        });
        const bytes = { read: () => Promise.resolve(new Uint8Array([1, 2, 3])) };
        const lauf = (
            beitrag: number,
            kanal: "facebook" | "instagram" | "mastodon",
            graph: GestellteGraph,
            zusatz: { environment?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch; ablage?: InstagramAblage } = {},
        ) =>
            runSocialSendenJob(kontext(beitrag, kanal), {
                database,
                environment: { ...ALLE_ENV, ...zusatz.environment },
                fetch: zusatz.fetch ?? graph.fetch,
                warte: keineWartezeit,
                bilder: bytes,
                ablage: zusatz.ablage ?? medien,
            });
        const nichtsGeheimes = (...texte: unknown[]): void => {
            const alles = JSON.stringify(texte);
            expect(alles).not.toContain(FB_TOKEN);
            expect(alles).not.toContain(IG_TOKEN);
            expect(alles).not.toContain("graph.facebook.com");
        };

        // --- Konfiguration und Stand ------------------------------------------------------------------------------------------

        it("🔴 ohne Konfiguration gibt es die Kanäle nicht: „nicht eingerichtet“, nicht wählbar zum Vorlegen, jeder für sich", async () => {
            delete process.env["COMMUNITY_SOCIAL_FACEBOOK_TOKEN"];
            await bereitMachen();
            const liste = (await kanaele()).kanaele;
            expect(liste.map((s) => s.kanal)).toEqual(["mastodon", "facebook", "instagram", "discord"]);
            expect(await stand("facebook")).toMatchObject({
                eingerichtet: false,
                freigeschaltet: true,
                bereit: false,
                sperre: "nicht_eingerichtet",
            });
            expect(await stand("instagram")).toMatchObject({
                eingerichtet: true,
                freigeschaltet: true,
                bereit: true,
                sperre: null,
            });
            const b = await anlegen(edda.cookie);
            const antwort = await schritt(b.id, "vorlegen", b.revision, edda.cookie);
            expect(code(antwort)).toBe("422 community_invalid");
            expect(meldung(antwort)).toBe("Facebook ist in dieser Umgebung nicht eingerichtet.");
            expect(await auftraege()).toEqual([]);
        });

        it("🔴 der Stand nennt nie Konto, Version oder Schlüssel; eingerichtet, aber nicht geprüft heißt „Zählregel noch nicht geprüft“", async () => {
            const antwort = await get("/api/community/social/kanaele", betreiber.cookie);
            expect(code(antwort)).toBe("200");
            expect(await stand("facebook")).toMatchObject({
                eingerichtet: true,
                freigeschaltet: false,
                grenzen: null,
                bereit: false,
                sperre: "nicht_freigeschaltet",
            });
            expect(await stand("instagram")).toMatchObject({
                eingerichtet: true,
                freigeschaltet: false,
                bereit: false,
                sperre: "nicht_freigeschaltet",
            });
            expect(antwort.body).not.toContain(FB_TOKEN);
            expect(antwort.body).not.toContain(IG_TOKEN);
            expect(antwort.body).not.toContain(SEITE);
            expect(antwort.body).not.toContain(KONTO);
        });

        it("🔴 ohne Freischaltung kein Senden, JE KANAL: Vorlegen weist ab, auch die Datenbank gibt nicht frei; die Freischaltung des einen gilt nicht für den anderen", async () => {
            const medium1 = await medium("cleared");
            await bereitMachen("facebook");
            const b = await anlegen(edda.cookie, {
                kanaele: ["facebook", "instagram"],
                bild: medium1,
                bildBeschreibung: "Eine Karte",
            });
            const abgewiesen = await schritt(b.id, "vorlegen", b.revision, edda.cookie);
            expect(code(abgewiesen)).toBe("422 community_invalid");
            expect(meldung(abgewiesen)).toBe("Instagram: Zählregel noch nicht geprüft.");
            // Direkt an der Datenbank: Selbst wer die Route umgeht, bekommt keine Freigabe.
            await bereitMachen("instagram");
            const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            await database`UPDATE avesmaps_community.kanal_stand SET freigeschaltet_at = NULL, geprueft_durch = NULL WHERE kanal = 'instagram'`;
            await expect(
                database`SELECT avesmaps_community.beitrag_freigeben(${randomUUID()}::uuid, ${b.id}::bigint, ${betreiber.id}::uuid, ${vorgelegt.revision}::int)`,
            ).rejects.toMatchObject({
                message: expect.stringContaining("Zählregel dieses Kanals ist noch nicht geprüft") as unknown,
            });
            expect(await auftraege()).toEqual([]);
            expect(await neuigkeiten(b.id)).toEqual([]);
        });

        // --- Facebook ----------------------------------------------------------------------------------------------------------

        it("🔴 Facebook: Freigeben reiht EINEN Auftrag ein; gesendet wird im Auftrag, mit Hashtags (zwei) am Text; das Ziel trägt die Adresse, nie der Schlüssel", async () => {
            await bereitMachen("facebook");
            const frei = await veroeffentlichen({ hashtags: ["Aventurien", "Karte", "DSA"] });
            expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
            expect(await ziel(frei.id, "facebook")).toMatchObject({
                zustand: "wartet",
                adresse: null,
                ausstehend: "senden",
            });
            expect(await auftraege()).toEqual([
                { input_ref: { beitrag: frei.id, kanal: "facebook" }, state: "QUEUED" },
            ]);

            const graph = stelleGraph();
            const ergebnis = await lauf(frei.id, "facebook", graph);
            expect(ergebnis).toMatchObject({ beitrag: frei.id, kanal: "facebook", zustand: "ok", versuche: 1 });
            const beitrag = [...graph.facebook.values()][0]!;
            // Zwei Hashtags: Das dritte fällt weg.
            expect(beitrag.text).toBe(
                "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.\n\n#Aventurien #Karte",
            );
            expect(beitrag.veroeffentlicht).toBe(true);
            expect(graph.aufrufe).toHaveLength(1);
            expect(graph.aufrufe[0]).toMatchObject({ pfad: `/${SEITE}/feed`, version: META_GRAPH_VERSION_VORGABE });
            const z = await ziel(frei.id, "facebook");
            expect(z).toMatchObject({
                zustand: "ok",
                fehler: null,
                versuche: 1,
                ausstehend: null,
                adresse: `https://www.facebook.com/${beitrag.id}`,
            });
            expect((await sendung(frei.id, "facebook"))!.extern_id).toBe(beitrag.id);
            const verlauf = (await detail(frei.id)).verlauf.map((e) => `${e.art}:${e.text ?? ""}`);
            expect(verlauf).toContain("gesendet:Facebook");
            nichtsGeheimes(ergebnis, verlauf, z);

            // Derselbe Auftrag noch einmal tut nichts: kein zweiter Beitrag, keine zweite Anfrage.
            expect(await lauf(frei.id, "facebook", graph)).toMatchObject({ ergebnis: "uebersprungen" });
            expect(graph.aufrufe).toHaveLength(1);
            expect(graph.facebook.size).toBe(1);
        });

        it("🔴 Facebook mit Bild: die Datei geht als Foto mit Beschreibung, nur wenn die Rechte geklärt sind; Zurücknehmen löscht das Foto", async () => {
            await bereitMachen("facebook");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({ bild, bildBeschreibung: "Die Reichsstraße auf der Karte" });
            const graph = stelleGraph();
            await lauf(frei.id, "facebook", graph);
            expect(graph.aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual([`POST /${SEITE}/photos`]);
            expect(graph.aufrufe[0]!.felder).toMatchObject({
                alt_text_custom: "Die Reichsstraße auf der Karte",
                source: { typ: "image/webp", groesse: 3 },
            });
            const z = await ziel(frei.id, "facebook");
            expect(z).toMatchObject({ zustand: "ok" });
            expect(z?.adresse).toMatch(/^https:\/\/www\.facebook\.com\/100000000000001_\d+$/u);

            // Zurücknehmen: ein Editor darf es nicht; der Betreiber löscht den Beitrag, die Neuigkeit bleibt.
            const revision = (await detail(frei.id)).zeile.revision;
            expect(
                code(await schritt(frei.id, "kanal-zuruecknehmen", revision, edda.cookie, { kanal: "facebook" })),
            ).toBe("403 forbidden");
            const q = await tu(frei.id, "kanal-zuruecknehmen", revision, betreiber.cookie, { kanal: "facebook" });
            expect(await ziel(frei.id, "facebook")).toMatchObject({ zustand: "ok", ausstehend: "zuruecknehmen" });
            expect(await auftraege()).toHaveLength(2);
            // Ein zweiter Klick, solange es läuft, ändert den Stand nicht (der doppelte Auftrag findet die Sendung reserviert oder erledigt).
            await tu(frei.id, "kanal-zuruecknehmen", q.revision, betreiber.cookie, { kanal: "facebook" });
            expect((await sendung(frei.id, "facebook"))!.aufgabe).toBe("zuruecknehmen");
            await lauf(frei.id, "facebook", graph);
            expect(graph.facebook.size).toBe(0);
            expect(graph.aufrufe.at(-1)!.methode).toBe("DELETE");
            expect(await ziel(frei.id, "facebook")).toMatchObject({ zustand: "zurueck", ausstehend: null });
            expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
            expect((await protokoll("system.social_zurueckgenommen")).at(-1)!.details).toMatchObject({
                kanal: "facebook",
            });
            const verlauf = (await detail(frei.id)).verlauf.map((e) => `${e.art}:${e.text ?? ""}`);
            expect(verlauf).toContain("zurueckgenommen:Facebook");

            // Erneut senden nach dem Zurücknehmen: neue Kennung, ein neuer Beitrag.
            const alt = (await sendung(frei.id, "facebook"))!.idempotenz;
            await tu(frei.id, "erneut", (await detail(frei.id)).zeile.revision, betreiber.cookie, {
                kanal: "facebook",
            });
            const neu = (await sendung(frei.id, "facebook"))!;
            expect(neu.idempotenz).not.toBe(alt);
            expect(neu.extern_id).toBeNull();
            await lauf(frei.id, "facebook", graph);
            expect(graph.facebook.size).toBe(1);
            expect(await ziel(frei.id, "facebook")).toMatchObject({ zustand: "ok" });
            expect((await detail(frei.id)).verlauf.map((e) => `${e.art}:${e.text ?? ""}`)).toContain(
                "erneut_gesendet:Facebook",
            );
        });

        it("🔴 sind die Rechte des Bildes beim Senden nicht (mehr) geklärt, geht nichts hinaus", async () => {
            await bereitMachen("facebook");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({ bild, bildBeschreibung: "Eine Karte" });
            await database`UPDATE public.media_rights SET clearance_state = 'rejected' WHERE media_asset_id = (SELECT id FROM public.media_asset WHERE public_id = ${bild}::uuid)`;
            const graph = stelleGraph();
            await lauf(frei.id, "facebook", graph);
            expect(graph.aufrufe).toEqual([]);
            expect((await ziel(frei.id, "facebook"))?.fehler).toBe(
                "Die Rechte des Bildes lassen keinen Beitrag (mehr) zu oder es ist ausgeblendet",
            );
        });

        // --- Instagram ---------------------------------------------------------------------------------------------------------

        it("🔴 Instagram: Bild ist Pflicht - die Route weist ab, und auch die Datenbank gibt ohne Bild oder ohne veröffentlichte Fassung nicht frei", async () => {
            await bereitMachen("instagram");
            const ohne = await anlegen(edda.cookie, { kanaele: ["instagram"] });
            const abgewiesen = await schritt(ohne.id, "vorlegen", ohne.revision, edda.cookie);
            expect(code(abgewiesen)).toBe("422 community_invalid");
            expect(meldung(abgewiesen)).toBe("Instagram sendet nur mit Bild.");

            // Rechte nicht geklärt: die allgemeine Sperre des Bildes.
            const unklar = await medium("needs_review");
            const mitUnklarem = await anlegen(edda.cookie, {
                kanaele: ["instagram"],
                bild: unklar,
                bildBeschreibung: "Eine Karte",
            });
            const unklarAntwort = await schritt(mitUnklarem.id, "vorlegen", mitUnklarem.revision, edda.cookie);
            expect(code(unklarAntwort)).toBe("422 community_invalid");
            expect(meldung(unklarAntwort)).toBe("Die Rechte des Bildes lassen keinen Beitrag zu.");

            // Direkt an der Datenbank: ohne Bild, dann mit geklärtem, aber nicht veröffentlichtem Bild.
            await database`UPDATE avesmaps_community.beitrag SET kanaele = ARRAY['instagram'], zustand = 'vorgelegt', vorgelegt_at = now() WHERE id = ${ohne.id}::bigint`;
            await expect(
                database`SELECT avesmaps_community.beitrag_freigeben(${randomUUID()}::uuid, ${ohne.id}::bigint, ${betreiber.id}::uuid, ${ohne.revision}::int)`,
            ).rejects.toMatchObject({ message: expect.stringContaining("Instagram sendet nur mit Bild") as unknown });
            const unveroeffentlicht = await medium("cleared", false);
            const b = await anlegen(edda.cookie, {
                kanaele: ["neuigkeiten"],
                bild: unveroeffentlicht,
                bildBeschreibung: "Eine Karte",
            });
            await database`UPDATE avesmaps_community.beitrag SET kanaele = ARRAY['instagram'], zustand = 'vorgelegt', vorgelegt_at = now() WHERE id = ${b.id}::bigint`;
            await expect(
                database`SELECT avesmaps_community.beitrag_freigeben(${randomUUID()}::uuid, ${b.id}::bigint, ${betreiber.id}::uuid, ${b.revision}::int)`,
            ).rejects.toMatchObject({
                message: expect.stringContaining("öffentlich veröffentlichtes Bild") as unknown,
            });
            expect(await auftraege()).toEqual([]);
        });

        it("🔴 Instagram zweistufig: das Bild kommt von der öffentlichen Adresse, der Auftrag wartet auf den Container, veröffentlicht und trägt den Permalink ein", async () => {
            await bereitMachen("instagram");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "instagram"],
                bild,
                bildBeschreibung: "Die Reichsstraße auf der Karte",
                hashtags: ["Aventurien", "Karte", "DSA", "Rollenspiel", "Karte2", "Sechstes"],
            });
            expect(await auftraege()).toEqual([
                { input_ref: { beitrag: frei.id, kanal: "instagram" }, state: "QUEUED" },
            ]);
            const graph = stelleGraph({ containerSchritte: 1 });
            const ergebnis = await lauf(frei.id, "instagram", graph);
            expect(ergebnis).toMatchObject({ kanal: "instagram", zustand: "ok", versuche: 1 });
            expect(graph.aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual([
                `POST /${KONTO}/media`,
                "GET /700000001",
                "GET /700000001",
                `POST /${KONTO}/media_publish`,
                "GET /800000001",
            ]);
            const erster = graph.aufrufe[0]!;
            expect(erster.felder).toMatchObject({
                image_url: `${ORIGIN}/media/sha256/ab/ab/${"ab".repeat(32)}.ig.jpg`,
                alt_text: "Die Reichsstraße auf der Karte",
            });
            // 🔴 Die Fassung liegt neben der WebP (vor dem Container angelegt), ist ein echtes JPEG im erlaubten Fenster, und die WebP ist unberührt.
            const fassung = await readFile(medien.pathFor(instagramKey(WEBP_HASH)));
            expect([...fassung.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
            const maße = await sharp(fassung).metadata();
            expect([maße.format, maße.width, maße.height]).toEqual(["jpeg", 1200, 800]);
            expect(await medien.exists(webpSchluessel)).toBe(true);
            // Fünf Hashtags (der Wert des Hubs für Instagram), das sechste fällt weg; Hashtags zählen mit.
            const caption = String((erster.felder as Record<string, string>)["caption"]);
            expect(caption).toBe(
                "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.\n\n#Aventurien #Karte #DSA #Rollenspiel #Karte2",
            );
            const z = await ziel(frei.id, "instagram");
            expect(z).toMatchObject({
                zustand: "ok",
                adresse: "https://www.instagram.com/p/800000001/",
                ausstehend: null,
            });
            expect((await sendung(frei.id, "instagram"))!.extern_id).toBe("800000001");
            expect((await detail(frei.id)).verlauf.map((e) => `${e.art}:${e.text ?? ""}`)).toContain(
                "gesendet:Instagram",
            );
            nichtsGeheimes(ergebnis, z);
        });

        /** Ein Instagram-Beitrag, der gesendet werden kann: geklärtes, veröffentlichtes Bild, Kanal bereit. */
        async function instagramBeitrag(): Promise<Quittung> {
            await bereitMachen("instagram");
            const bild = await medium("cleared");
            return veroeffentlichen({
                kanaele: ["neuigkeiten", "instagram"],
                bild,
                bildBeschreibung: "Die Reichsstraße auf der Karte",
            });
        }
        const fassungPfad = (): string => medien.pathFor(instagramKey(WEBP_HASH));

        it("🔴 Instagram nimmt nur JPEG: die Fassung entsteht VOR dem ersten Aufruf an Meta, und ein zweiter Versuch nimmt die vorhandene (idempotent)", async () => {
            const frei = await instagramBeitrag();
            let fassungBeimErstenAufruf: boolean | undefined;
            const graph = stelleGraph({
                fehler: (_aufruf, nr) => {
                    if (nr === 1) fassungBeimErstenAufruf = existsSync(fassungPfad());
                    return undefined;
                },
            });
            expect(existsSync(fassungPfad())).toBe(false);
            await lauf(frei.id, "instagram", graph);
            expect(fassungBeimErstenAufruf).toBe(true);
            expect(await ziel(frei.id, "instagram")).toMatchObject({ zustand: "ok" });
            // Meta bekam die JPEG-Adresse, nie die der WebP.
            const adressen = graph.aufrufe.map((a) => (a.felder as Record<string, string> | null)?.["image_url"]);
            expect(adressen.filter((a) => a !== undefined)).toEqual([
                `${ORIGIN}/media/sha256/ab/ab/${WEBP_HASH}.ig.jpg`,
            ]);
            expect(JSON.stringify(graph.aufrufe.map((a) => a.felder))).not.toContain(".webp");

            // Erneut senden: Die Fassung liegt da und wird nicht neu geschrieben.
            const alt = new Date("2020-01-01T00:00:00Z");
            await utimes(fassungPfad(), alt, alt);
            await database`UPDATE avesmaps_community.sendung SET aufgabe = 'senden', reserviert_bis = NULL, versuche = 0, extern_id = NULL WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
            await database`UPDATE avesmaps_community.beitrag_ziel SET zustand = 'wartet', fehler = NULL WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
            await lauf(frei.id, "instagram", stelleGraph());
            expect((await stat(fassungPfad())).mtime.getTime()).toBe(alt.getTime());
            expect(await ziel(frei.id, "instagram")).toMatchObject({ zustand: "ok" });
        });

        it("🔴 Liegt die Fassung schon da, wird sie genommen und nicht überschrieben", async () => {
            const frei = await instagramBeitrag();
            const vorhanden = Buffer.from("\u00ff\u00d8\u00ff die schon vorhandene Fassung");
            await mkdir(dirname(fassungPfad()), { recursive: true });
            await writeFile(fassungPfad(), vorhanden);
            const graph = stelleGraph();
            await lauf(frei.id, "instagram", graph);
            expect(Buffer.compare(await readFile(fassungPfad()), vorhanden)).toBe(0);
            expect(graph.instagram.size).toBe(1);
        });

        it("🔴 ist die WebP nicht mehr öffentlich (Quarantäne, Löschen), geht nichts hinaus und eine übrig gebliebene Fassung verschwindet", async () => {
            const frei = await instagramBeitrag();
            await mkdir(dirname(fassungPfad()), { recursive: true });
            await writeFile(fassungPfad(), "\u00ff\u00d8\u00ff Waise");
            await rm(medien.pathFor(webpSchluessel));
            const graph = stelleGraph();
            await lauf(frei.id, "instagram", graph);
            expect(graph.aufrufe).toEqual([]);
            expect((await ziel(frei.id, "instagram"))?.fehler).toBe(
                "Die veröffentlichte Fassung des Bildes liegt nicht (mehr) öffentlich vor",
            );
            expect(existsSync(fassungPfad())).toBe(false);
        });

        it("🔴 ohne Medienablage in der Umgebung oder mit einem Bild, das keines ist, geht nichts hinaus - mit kurzem Satz ohne Pfad", async () => {
            const frei = await instagramBeitrag();
            const graph = stelleGraph();
            // Keine Ablage: weder eine gegebene noch MEDIA_ROOT in der Umgebung.
            await runSocialSendenJob(kontext(frei.id, "instagram"), {
                database,
                environment: ALLE_ENV,
                fetch: graph.fetch,
                warte: keineWartezeit,
                bilder: bytes,
            });
            expect(graph.aufrufe).toEqual([]);
            expect((await ziel(frei.id, "instagram"))?.fehler).toBe(
                "Die Medienablage ist in dieser Umgebung nicht eingerichtet",
            );

            // Die "WebP" ist keine.
            await database`UPDATE avesmaps_community.sendung SET aufgabe = 'senden', reserviert_bis = NULL, versuche = 0 WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
            await database`UPDATE avesmaps_community.beitrag_ziel SET zustand = 'wartet', fehler = NULL WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
            await writeFile(medien.pathFor(webpSchluessel), "RIFF----WEBPVP8 kein Bild");
            await lauf(frei.id, "instagram", graph);
            expect(graph.aufrufe).toEqual([]);
            const fehler = (await ziel(frei.id, "instagram"))?.fehler;
            expect(fehler).toBe("Das Bild lässt sich nicht für Instagram aufbereiten");
            expect(fehler).not.toContain(medienWurzel);
            expect(existsSync(fassungPfad())).toBe(false);
        });

        it("Facebook ist davon unberührt: es lädt die Bytes der WebP selbst hoch und legt keine Fassung an", async () => {
            await bereitMachen("facebook");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "facebook"],
                bild,
                bildBeschreibung: "Die Reichsstraße auf der Karte",
            });
            const verboten: InstagramAblage = {
                exists: () => Promise.reject(new Error("Ablage berührt")),
                read: () => Promise.reject(new Error("Ablage berührt")),
                storeInstagram: () => Promise.reject(new Error("Ablage berührt")),
                removeInstagram: () => Promise.reject(new Error("Ablage berührt")),
            };
            const graph = stelleGraph();
            await lauf(frei.id, "facebook", graph, { ablage: verboten });
            expect(await ziel(frei.id, "facebook")).toMatchObject({ zustand: "ok" });
            expect(existsSync(fassungPfad())).toBe(false);
        });

        it("🔴 ist die Umgebung für Meta nicht erreichbar (PUBLIC_ORIGIN privat oder leer), geht nichts hinaus: Instagram ist mit Grund gesperrt", async () => {
            await bereitMachen("instagram");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "instagram"],
                bild,
                bildBeschreibung: "Eine Karte",
            });
            for (const privat of ["https://stage.tailnet.ts.net", "http://localhost:3000", ""]) {
                await database`UPDATE avesmaps_community.sendung SET aufgabe = 'senden', reserviert_bis = NULL, versuche = 0 WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
                await database`UPDATE avesmaps_community.beitrag_ziel SET zustand = 'wartet', fehler = NULL WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
                const graph = stelleGraph();
                await lauf(frei.id, "instagram", graph, { environment: { PUBLIC_ORIGIN: privat } });
                expect(graph.aufrufe, privat).toEqual([]);
                expect((await ziel(frei.id, "instagram"))?.fehler, privat).toBe(
                    "Das Bild hat keine öffentlich erreichbare Adresse: Diese Umgebung ist für Meta nicht erreichbar",
                );
            }
        });

        it("🔴 Instagram nimmt nichts zurück: die Route sagt „bitte in der App löschen“, die Datenbank merkt nichts vor, und käme ein Auftrag trotzdem, löscht er nichts", async () => {
            await bereitMachen("instagram");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "instagram"],
                bild,
                bildBeschreibung: "Eine Karte",
            });
            const graph = stelleGraph();
            await lauf(frei.id, "instagram", graph);
            const revision = (await detail(frei.id)).zeile.revision;
            const antwort = await schritt(frei.id, "kanal-zuruecknehmen", revision, betreiber.cookie, {
                kanal: "instagram",
            });
            expect(code(antwort)).toBe("422 community_invalid");
            expect(meldung(antwort)).toBe(
                "Instagram erlaubt kein Löschen über die Schnittstelle; bitte in der App löschen",
            );
            expect(await ziel(frei.id, "instagram")).toMatchObject({ zustand: "ok", ausstehend: null });
            expect((await sendung(frei.id, "instagram"))!.aufgabe).toBeNull();
            expect(await protokoll("system.social_zurueckgenommen")).toEqual([]);
            // Erzwungen: ein Auftrag „zurücknehmen“ löscht nichts, er scheitert mit dem Satz.
            await database`UPDATE avesmaps_community.sendung SET aufgabe = 'zuruecknehmen', reserviert_bis = NULL WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
            const vorher = graph.aufrufe.length;
            await lauf(frei.id, "instagram", graph);
            expect(graph.aufrufe.length).toBe(vorher);
            expect((await ziel(frei.id, "instagram"))?.fehler).toBe(
                "Instagram erlaubt kein Löschen über die Schnittstelle; bitte in der App löschen",
            );
        });

        it("🔴 Zeitgrenze beim Abwarten: Der Container bleibt in Arbeit, der Versuch endet vorübergehend, der nächste nimmt DENSELBEN Container - ein Beitrag, ein Container", async () => {
            await bereitMachen("instagram");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "instagram"],
                bild,
                bildBeschreibung: "Eine Karte",
            });
            // Der Container meldet 20-mal „in Arbeit“: Der erste Versuch fragt 15-mal, der zweite die restlichen 5 und dann FINISHED.
            const graph = stelleGraph({ containerSchritte: 20 });
            const erster = await lauf(frei.id, "instagram", graph);
            expect(erster).toMatchObject({ kanal: "instagram", zustand: "wartet", versuche: 1 });
            expect(await sendung(frei.id, "instagram")).toMatchObject({
                extern_id: "container:700000001",
                aufgabe: "senden",
                versuche: 1,
            });
            expect(graph.instagram.size).toBe(0);
            const zweiter = await lauf(frei.id, "instagram", graph);
            expect(zweiter).toMatchObject({ zustand: "ok" });
            expect(graph.container.size).toBe(1);
            expect(graph.instagram.size).toBe(1);
            expect(graph.aufrufe.filter((a) => a.methode === "POST" && a.pfad.endsWith("/media"))).toHaveLength(1);
            expect((await sendung(frei.id, "instagram"))!.extern_id).toBe("800000001");
        });

        it("🔴 Scheitert die Veröffentlichung und war sie in Wahrheit durch, kommt kein zweiter Beitrag: Der nächste Versuch sieht den veröffentlichten Container", async () => {
            await bereitMachen("instagram");
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "instagram"],
                bild,
                bildBeschreibung: "Eine Karte",
            });
            let verbinden = true;
            const graph = stelleGraph({
                fehler: (aufruf) => (verbinden && aufruf.pfad.endsWith("/media_publish") ? "netz" : undefined),
            });
            expect(await lauf(frei.id, "instagram", graph)).toMatchObject({ zustand: "wartet" });
            expect((await sendung(frei.id, "instagram"))!.extern_id).toBe("container:700000001");
            // Meta hatte veröffentlicht, nur die Antwort ging verloren.
            verbinden = false;
            await graph.fetch(`https://graph.facebook.com/v21.0/${KONTO}/media_publish`, {
                method: "POST",
                headers: { Authorization: `Bearer ${IG_TOKEN}` },
                body: new URLSearchParams({ creation_id: "700000001" }),
            });
            expect(graph.instagram.size).toBe(1);
            const nochmal = await lauf(frei.id, "instagram", graph);
            expect(nochmal).toMatchObject({ zustand: "ok" });
            expect(graph.instagram.size).toBe(1);
            expect(graph.container.size).toBe(1);
            expect(await ziel(frei.id, "instagram")).toMatchObject({
                zustand: "ok",
                adresse: "https://www.instagram.com/",
            });
        });

        // --- Wiederholung ohne Doppeltes -----------------------------------------------------------------------------------------

        it("🔴 Meta kennt keinen Idempotenz-Kopf: Hat die Sendung schon eine Kennung bei Meta, wird nicht noch einmal gesendet (Facebook und Instagram)", async () => {
            await bereitMachen();
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "facebook", "instagram"],
                bild,
                bildBeschreibung: "Eine Karte",
            });
            const graph = stelleGraph();
            // Die Beiträge gibt es dort schon (ein früherer Versuch hat gesendet, der Eintrag ging verloren).
            const fb = await facebook.sende(
                leseMetaZugang("facebook", FB_ENV)!,
                { text: "schon da" },
                { fetch: graph.fetch },
            );
            const ig = await instagram.sende(
                leseMetaZugang("instagram", IG_ENV)!,
                { text: "schon da", bildUrl: `${ORIGIN}/media/x.webp`, beschreibung: "B" },
                { fetch: graph.fetch, warte: keineWartezeit },
            );
            await database`UPDATE avesmaps_community.sendung SET extern_id = ${fb.id} WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'facebook'`;
            await database`UPDATE avesmaps_community.sendung SET extern_id = ${ig.id} WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'instagram'`;
            graph.aufrufe.length = 0;
            await lauf(frei.id, "facebook", graph);
            await lauf(frei.id, "instagram", graph);
            // Nur lesende Aufrufe: kein Beitrag mehr.
            expect(graph.aufrufe.every((a) => a.methode === "GET")).toBe(true);
            expect(graph.facebook.size).toBe(1);
            expect(graph.instagram.size).toBe(1);
            expect(await ziel(frei.id, "facebook")).toMatchObject({
                zustand: "ok",
                adresse: `https://www.facebook.com/${fb.id}`,
            });
            expect(await ziel(frei.id, "instagram")).toMatchObject({
                zustand: "ok",
                adresse: `https://www.instagram.com/p/${ig.id}/`,
            });
        });

        it("🔴 stirbt der Auftrag nach dem Senden und vor dem Eintrag, ist es bei Facebook EIN Beitrag, sobald die Kennung gemerkt ist; ein vorübergehender Fehler wird wiederholt", async () => {
            await bereitMachen("facebook");
            const frei = await veroeffentlichen();
            // Der erste Aufruf scheitert vorübergehend (503): Der Auftrag reiht sich neu ein, nach dem Fehlversuch steht die Sendung wieder an.
            let nr = 0;
            const graph = stelleGraph({ fehler: () => (nr++ === 0 ? new Response("{}", { status: 503 }) : undefined) });
            const erster = await lauf(frei.id, "facebook", graph);
            expect(erster).toMatchObject({ zustand: "wartet", versuche: 1, naechsterVersuchInMs: 60_000 });
            expect(graph.facebook.size).toBe(0);
            expect((await auftraege()).filter((a) => a.state === "QUEUED")).toHaveLength(2);
            const zweiter = await lauf(frei.id, "facebook", graph);
            expect(zweiter).toMatchObject({ zustand: "ok", versuche: 2 });
            expect(graph.facebook.size).toBe(1);
        });

        // --- Fehler, Notschalter, Ausfall ----------------------------------------------------------------------------------------

        it("🔴 ein abgelehnter Schlüssel macht das Ziel zum Fehler - mit festem Satz, ohne Schlüssel; Erneut senden bleibt möglich", async () => {
            await bereitMachen("facebook");
            const frei = await veroeffentlichen();
            const graph = stelleGraph({
                fehler: () =>
                    new Response(
                        JSON.stringify({
                            error: { message: `Invalid token ${FB_TOKEN} on graph.facebook.com`, code: 190 },
                        }),
                        { status: 400 },
                    ),
            });
            const ergebnis = await lauf(frei.id, "facebook", graph);
            expect(ergebnis).toMatchObject({ zustand: "fehler", versuche: 1 });
            const z = await ziel(frei.id, "facebook");
            expect(z?.fehler).toBe(
                "Facebook: Der Zugangsschlüssel ist abgelaufen oder wurde abgelehnt (400, Code 190)",
            );
            nichtsGeheimes(z, ergebnis, await protokoll("system.social_freigegeben"));
            // Mit einem neuen Schlüssel: Erneut senden, dieselbe Kennung.
            const alt = (await sendung(frei.id, "facebook"))!.idempotenz;
            await tu(frei.id, "erneut", (await detail(frei.id)).zeile.revision, betreiber.cookie, {
                kanal: "facebook",
            });
            expect((await sendung(frei.id, "facebook"))!.idempotenz).toBe(alt);
            const gut = stelleGraph();
            await lauf(frei.id, "facebook", gut);
            expect(await ziel(frei.id, "facebook")).toMatchObject({ zustand: "ok" });
        });

        it("🔴 Notschalter je Kanal: braucht manage_social_channels und einen frischen Passkey; ein gesetzter hält auch den schon vorgemerkten Beitrag am Senden, nicht das Zurücknehmen", async () => {
            await bereitMachen("facebook", "instagram");
            const url = "/api/community/social/kanaele/facebook/notschalter";
            expect(code(await post(url, { an: true }, edda.cookie))).toBe("403 forbidden");
            expect(code(await post(url, { an: true }, betreiber.cookie))).toBe("403 reauth_required");
            const frei = await veroeffentlichen();
            const gesetzt = await post(url, { an: true }, frisch.cookie);
            expect(code(gesetzt)).toBe("200");
            expect(Value.Check(SocialKanalStand, gesetzt.json())).toBe(true);
            expect(gesetzt.json()).toMatchObject({
                kanal: "facebook",
                notschalter: true,
                bereit: false,
                sperre: "notschalter",
            });
            // Der Schalter des einen Kanals hält den anderen nicht an.
            expect(await stand("instagram")).toMatchObject({ notschalter: false, bereit: true });
            expect(await protokoll("system.social_kanal_notschalter")).toHaveLength(1);
            const graph = stelleGraph();
            await lauf(frei.id, "facebook", graph);
            expect(graph.aufrufe).toEqual([]);
            expect((await ziel(frei.id, "facebook"))?.fehler).toBe("Der Notschalter steht an: nichts gesendet");
            // Neu freigeben geht nicht, solange er steht.
            const antwort = await schritt(frei.id, "erneut", (await detail(frei.id)).zeile.revision, betreiber.cookie, {
                kanal: "facebook",
            });
            expect(code(antwort)).toBe("422 community_invalid");
        });

        it("🔴 ein Ausfall des Kanals ändert den Beitrag in den Neuigkeiten nicht", async () => {
            await bereitMachen("facebook");
            const frei = await veroeffentlichen();
            const graph = stelleGraph({ fehler: () => "netz" });
            for (let i = 0; i < 3; i += 1) await lauf(frei.id, "facebook", graph);
            const z = await ziel(frei.id, "facebook");
            expect(z).toMatchObject({ zustand: "fehler" });
            expect((await sendung(frei.id, "facebook"))!.versuche).toBe(3);
            expect(z?.fehler).toBe("Facebook: Meta war nicht erreichbar");
            expect(await ziel(frei.id, "neuigkeiten")).toMatchObject({ zustand: "ok" });
            expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
            expect((await detail(frei.id)).zeile.zustand).toBe("veroeffentlicht");
        });

        it("🔴 drei Kanäle gleichzeitig angehakt: einer scheitert, die anderen gehen", async () => {
            await bereitMachen();
            await database`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${database.json({ zeichen: 500, adresse: 23, bilder: 4, beschreibung: 1500, bildBytes: 16777216, bildTypen: ["image/webp"] } as never)}::jsonb)`;
            await database`SELECT avesmaps_community.social_kanal_pruefung_eintragen('mastodon', 'cli:test', true, '{}'::jsonb)`;
            const bild = await medium("cleared");
            const frei = await veroeffentlichen({
                kanaele: ["neuigkeiten", "mastodon", "facebook", "instagram"],
                bild,
                bildBeschreibung: "Eine Karte",
            });
            expect((await auftraege()).map((a) => a.input_ref.kanal).sort()).toEqual([
                "facebook",
                "instagram",
                "mastodon",
            ]);
            const mastodon = stelleInstanz();
            const kaputt = stelleGraph({
                fehler: () =>
                    new Response(JSON.stringify({ error: { message: "kein Recht", code: 200 } }), { status: 403 }),
            });
            const gut = stelleGraph();
            await lauf(frei.id, "mastodon", gut, { fetch: mastodon.fetch });
            await lauf(frei.id, "facebook", kaputt);
            await lauf(frei.id, "instagram", gut);
            expect(await ziel(frei.id, "mastodon")).toMatchObject({ zustand: "ok" });
            expect(await ziel(frei.id, "instagram")).toMatchObject({ zustand: "ok" });
            expect(await ziel(frei.id, "facebook")).toMatchObject({ zustand: "fehler" });
            expect(await ziel(frei.id, "neuigkeiten")).toMatchObject({ zustand: "ok" });
            expect(mastodon.beitraege.size).toBe(1);
            expect(gut.instagram.size).toBe(1);
            expect(gut.facebook.size).toBe(0);
        });

        // --- Zugang prüfen -----------------------------------------------------------------------------------------------------

        it("🔴 „Zugang prüfen“ je Meta-Kanal: braucht manage_social_channels und frischen Passkey, liest nur, trägt die Grenzen des Hubs ein; ein abgelaufener Schlüssel ist ein fester Satz", async () => {
            const url = "/api/community/social/kanaele/facebook/grenzen";
            expect(code(await post(url, {}, edda.cookie))).toBe("403 forbidden");
            expect(code(await post(url, {}, betreiber.cookie))).toBe("403 reauth_required");
            const graph = stelleGraph();
            vi.spyOn(globalThis, "fetch").mockImplementation(graph.fetch);
            const antwort = await post(url, {}, frisch.cookie);
            expect(code(antwort)).toBe("200");
            expect(Value.Check(SocialKanalStand, antwort.json())).toBe(true);
            expect(antwort.json()).toMatchObject({
                kanal: "facebook",
                grenzen: { zeichen: 63_206, adresse: 0 },
                freigeschaltet: false,
            });
            nichtsGeheimes(antwort.json());
            expect(graph.aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual([`GET /${SEITE}`]);
            const eintraege = await protokoll("system.social_kanal_grenzen");
            expect(eintraege[0]).toMatchObject({ target_ref: "kanal:facebook", details: { kanal: "facebook" } });

            const abgelaufen = stelleGraph({
                fehler: () =>
                    new Response(JSON.stringify({ error: { message: `x ${FB_TOKEN}`, code: 190 } }), { status: 400 }),
            });
            vi.spyOn(globalThis, "fetch").mockImplementation(abgelaufen.fetch);
            const aus = await post(url, {}, frisch.cookie);
            expect(code(aus)).toBe("502 community_kanal");
            nichtsGeheimes(aus.json());
            expect(meldung(aus)).toContain("abgelaufen");
            // Der Stand bleibt, wie er war.
            expect((await stand("facebook")).grenzen).toMatchObject({ zeichen: 63_206 });
            delete process.env["COMMUNITY_SOCIAL_INSTAGRAM_TOKEN"];
            expect(code(await post("/api/community/social/kanaele/instagram/grenzen", {}, frisch.cookie))).toBe(
                "409 community_transition",
            );
        });

        it("die tägliche Pflege prüft jeden Kanal für sich: gelesen, aus ohne Konfiguration, Fehler als Wort; ein Ausfall hält die anderen nicht an", async () => {
            const gut = stelleGraph();
            const nur = { ...FB_ENV, ...IG_ENV };
            expect(await pflegeKanaele(database, nur, { fetch: gut.fetch })).toEqual({
                socialMastodon: "aus",
                socialFacebook: "gelesen",
                socialInstagram: "gelesen",
                socialDiscord: "aus",
            });
            expect((await stand("instagram")).grenzen).toMatchObject({ zeichen: 2200 });
            expect(await pruefeUndSpeichereMetaZugang(database, "facebook", {}, { fetch: gut.fetch })).toEqual({
                art: "aus",
            });
            const kaputt = stelleGraph({
                fehler: (aufruf) => (aufruf.pfad === `/${SEITE}` ? new Response("{}", { status: 503 }) : undefined),
            });
            const ergebnis = await pflegeKanaele(database, nur, { fetch: kaputt.fetch });
            expect(ergebnis).toEqual({
                socialMastodon: "aus",
                socialFacebook: "fehler",
                socialInstagram: "gelesen",
                socialDiscord: "aus",
            });
            expect(JSON.stringify(ergebnis)).not.toContain(FB_TOKEN);
            // Ein Schlüssel, der zu einer anderen Seite gehört, gilt nicht.
            const fremd = await pruefeUndSpeichereMetaZugang(database, "facebook", nur, {
                fetch: stelleGraph({ seite: "100000000000009" }).fetch,
            });
            expect(fremd).toMatchObject({ art: "fehler" });
        });

        // --- Das Werkzeug mit Datenbank -----------------------------------------------------------------------------------------

        const ANWENDEN = (kanal: string, ...mehr: string[]) => [
            "--kanal",
            kanal,
            "--anwenden",
            "--operator-said",
            "Vali 2026-11-01: Prüflauf mit dem Testkonto.",
            ...mehr,
        ];
        const pruefStand = async (kanal: string) => {
            const [zeile] = await database<
                {
                    freigeschaltet_at: Date | null;
                    geprueft_durch: string | null;
                    grenzen: { zeichen: number } | null;
                    pruefung: unknown;
                }[]
            >`
            SELECT freigeschaltet_at, geprueft_durch, grenzen, pruefung FROM avesmaps_community.kanal_stand WHERE kanal = ${kanal}
        `;
            return zeile;
        };

        it("🔴 Prüflauf Facebook: 18 unveröffentlichte Beiträge, die 9 angenommenen werden gelöscht, der Kanal ist freigeschaltet, das Protokoll hat Zahlen und keinen Text", async () => {
            const graph = stelleGraph();
            const ergebnis = await pruefLauf(
                ANWENDEN("facebook"),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: graph.fetch, database },
            );
            expect(ergebnis.code, ergebnis.text).toBe(0);
            const posts = graph.aufrufe.filter((a) => a.methode === "POST" && a.pfad === `/${SEITE}/feed`);
            expect(posts).toHaveLength(18);
            for (const post of posts) expect(post.felder).toMatchObject({ published: "false" });
            expect(graph.aufrufe.filter((a) => a.methode === "DELETE")).toHaveLength(9);
            expect(graph.facebook.size).toBe(0);
            expect(ergebnis.ausgabe).toContain("**Prüfung Facebook 2026-11-01**");
            expect(ergebnis.ausgabe).toContain("| Emoji mit Hautton | 2 | ja | ja | ja |");
            expect(ergebnis.ausgabe).toContain("ist freigeschaltet");
            const s = (await pruefStand("facebook"))!;
            expect(s.freigeschaltet_at).not.toBeNull();
            expect(s.geprueft_durch).toBe("cli:probe");
            expect(s.grenzen).toMatchObject({ zeichen: 63_206 });
            expect(s.pruefung).toEqual({ datum: "2026-11-01", faelle: 9, uebereinstimmend: 9 });
            const [ereignis] = await protokoll("system.social_kanal_geprueft");
            expect(ereignis!.details).toEqual({
                kanal: "facebook",
                faelle: 9,
                uebereinstimmend: 9,
                freigeschaltet: true,
                zitat: true,
            });
            expect(ergebnis.text).not.toContain(FB_TOKEN);
            expect(JSON.stringify(ereignis)).not.toContain("Prüflauf");
            // Die Freischaltung gilt nur für diesen Kanal.
            expect(await pruefStand("instagram")).toBeUndefined();
            expect(await stand("facebook")).toMatchObject({ bereit: true });
            expect(await stand("instagram")).toMatchObject({ bereit: false });
        });

        it("🔴 Prüflauf Facebook, Abweichung: Nimmt Meta den Beitrag an der Grenze nicht an, bleibt der Kanal GESPERRT (zu großzügig); nimmt es mehr an, schaltet er frei und sagt „zu streng“", async () => {
            const knapp = stelleGraph({ facebookMax: 5000 });
            await database`SELECT avesmaps_community.social_kanal_grenzen_setzen('facebook', ${database.json(metaGrenzen("facebook") as never)}::jsonb)`;
            await database`SELECT avesmaps_community.social_kanal_pruefung_eintragen('facebook', 'cli:alt', true, '{}'::jsonb)`;
            const zuGrosszuegig = await pruefLauf(
                ANWENDEN("facebook"),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: knapp.fetch, database },
            );
            expect(zuGrosszuegig.code).toBe(1);
            expect(zuGrosszuegig.ausgabe).toContain("ZU GROSSZÜGIG");
            expect(zuGrosszuegig.ausgabe).toContain("bleibt GESPERRT");
            const s = (await pruefStand("facebook"))!;
            expect(s.freigeschaltet_at).toBeNull();
            expect(s.geprueft_durch).toBeNull();
            expect(knapp.facebook.size).toBe(0);
            const locker = stelleGraph({ facebookMax: 100_000 });
            const zuStreng = await pruefLauf(
                ANWENDEN("facebook"),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: locker.fetch, database },
            );
            expect(zuStreng.code, zuStreng.text).toBe(0);
            expect(zuStreng.ausgabe).toContain("zu streng");
            expect((await pruefStand("facebook"))!.freigeschaltet_at).not.toBeNull();
        });

        it("🔴 Prüflauf Instagram: nur mit --testkonto-bestaetigt und Testbild; die angenommenen Beiträge sind nicht zu löschen und stehen in der Ausgabe", async () => {
            const graph = stelleGraph();
            // Das Testbild ist die WebP-Adresse eines Mediums dieser Umgebung: Instagram bekommt dessen JPEG-Fassung (JPEG-Adresse neben der WebP).
            const webpAdresse = `${ORIGIN}/media/sha256/ab/ab/${WEBP_HASH}.webp`;
            const bild = `${ORIGIN}/media/sha256/ab/ab/${WEBP_HASH}.ig.jpg`;
            const ergebnis = await pruefLauf(
                ANWENDEN("instagram", "--testkonto-bestaetigt", "--bild", webpAdresse),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: graph.fetch, database, ablage: medien },
            );
            expect(ergebnis.code, ergebnis.text).toBe(0);
            expect(existsSync(fassungPfad())).toBe(true);
            expect(ergebnis.ausgabe).toContain("JPEG-Fassung (eben angelegt)");
            expect(ergebnis.ausgabe).toContain(bild);
            // Vier Fälle: je ein Beitrag an der Grenze (angenommen, bleibt stehen) und einer eins darüber (abgelehnt).
            expect(graph.instagram.size).toBe(4);
            expect(graph.aufrufe.filter((a) => a.methode === "POST" && a.pfad.endsWith("/media"))).toHaveLength(8);
            expect(graph.aufrufe.every((a) => a.methode !== "DELETE")).toBe(true);
            for (const a of graph.aufrufe.filter((x) => x.pfad.endsWith("/media") && x.methode === "POST"))
                expect(a.felder).toMatchObject({ image_url: bild });
            expect(ergebnis.fehler).toContain("Bitte in der Instagram-App von Hand löschen");
            expect(ergebnis.fehler).toContain("800000001");
            expect(ergebnis.ausgabe).toContain("**Prüfung Instagram 2026-11-01**");
            expect(ergebnis.ausgabe).toContain("ist freigeschaltet");
            expect((await pruefStand("instagram"))!.freigeschaltet_at).not.toBeNull();
            expect(await stand("instagram")).toMatchObject({ bereit: true });
            const [ereignis] = await protokoll("system.social_kanal_geprueft");
            expect(ereignis!.details).toMatchObject({
                kanal: "instagram",
                faelle: 4,
                uebereinstimmend: 4,
                freigeschaltet: true,
            });
            expect(ergebnis.text).not.toContain(IG_TOKEN);
        });

        it("Prüflauf Instagram: eine fremde https-Adresse bleibt, wie sie ist; die vorhandene Fassung wird genommen (\u201elag schon da\u201c)", async () => {
            const fremd = "https://bilder.beispiel.org/test.jpg";
            const a = stelleGraph();
            const fremdLauf = await pruefLauf(
                ANWENDEN("instagram", "--testkonto-bestaetigt", "--bild", fremd),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: a.fetch, database, ablage: medien },
            );
            expect(fremdLauf.code, fremdLauf.text).toBe(0);
            for (const aufruf of a.aufrufe.filter((x) => x.pfad.endsWith("/media") && x.methode === "POST"))
                expect(aufruf.felder).toMatchObject({ image_url: fremd });
            // Eine fremde Adresse legt nichts in die Ablage.
            expect(existsSync(fassungPfad())).toBe(false);

            const webpAdresse = `${ORIGIN}/media/sha256/ab/ab/${WEBP_HASH}.webp`;
            await mkdir(dirname(fassungPfad()), { recursive: true });
            await writeFile(fassungPfad(), "\u00ff\u00d8\u00ff schon da");
            const b = stelleGraph();
            const eigenLauf = await pruefLauf(
                ANWENDEN("instagram", "--testkonto-bestaetigt", "--bild", webpAdresse),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: b.fetch, database, ablage: medien },
            );
            expect(eigenLauf.code, eigenLauf.text).toBe(0);
            expect(eigenLauf.ausgabe).toContain("lag schon da");
            expect(await readFile(fassungPfad(), "utf8")).toBe("\u00ff\u00d8\u00ff schon da");
        });

        it("🔴 Prüflauf Instagram: ist das Testbild ein Medium dieser Umgebung, aber ohne Ablage oder ohne WebP, geht NICHTS hinaus und nichts wird eingetragen", async () => {
            const webpAdresse = `${ORIGIN}/media/sha256/ab/ab/${WEBP_HASH}.webp`;
            // Ohne MEDIA_ROOT und ohne Ablage.
            const graph = stelleGraph();
            const ohneAblage = await pruefLauf(
                ANWENDEN("instagram", "--testkonto-bestaetigt", "--bild", webpAdresse),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: graph.fetch, database },
            );
            expect(ohneAblage.code).toBe(1);
            expect(ohneAblage.fehler).toContain("MEDIA_ROOT");
            expect(ohneAblage.fehler).toContain("Nichts geschickt");
            // Mit MEDIA_ROOT in der Umgebung statt der gegebenen Ablage, aber die WebP fehlt.
            await rm(medien.pathFor(webpSchluessel));
            const ohneWebp = await pruefLauf(
                ANWENDEN("instagram", "--testkonto-bestaetigt", "--bild", webpAdresse),
                { ...META_ENV, AVESMAPS_ENV: "test", MEDIA_ROOT: medienWurzel },
                { fetch: graph.fetch, database },
            );
            expect(ohneWebp.code).toBe(1);
            expect(ohneWebp.fehler).toContain("liegt nicht (mehr) öffentlich vor");
            expect(ohneWebp.fehler).not.toContain(medienWurzel);
            expect(graph.aufrufe).toEqual([]);
            expect(await pruefStand("instagram")).toBeUndefined();
            expect(await protokoll("system.social_kanal_geprueft")).toEqual([]);
        });

        it("Prüflauf Instagram im Probelauf: nennt die JPEG-Regel, berührt aber weder Netz noch Ablage", async () => {
            const graph = verbotenGraph();
            const webpAdresse = `${ORIGIN}/media/sha256/ab/ab/${WEBP_HASH}.webp`;
            const ergebnis = await pruefLauf(["--kanal", "instagram", "--bild", webpAdresse], META_ENV, {
                fetch: graph.fetch,
            });
            expect(ergebnis.code).toBe(0);
            expect(ergebnis.ausgabe).toContain("Instagram nimmt nur JPEG");
            expect(ergebnis.ausgabe).toContain("<hash>.ig.jpg");
            expect(existsSync(fassungPfad())).toBe(false);
            expect(graph.aufrufe).toEqual([]);
        });

        it("🔴 Prüflauf: ein Fehler mitten in den Proben räumt auf, schaltet nichts frei und nennt nie den Schlüssel", async () => {
            const graph = stelleGraph({
                fehler: (_a, nr) =>
                    nr > 6
                        ? new Response(JSON.stringify({ error: { message: `abgelehnt ${FB_TOKEN}`, code: 190 } }), {
                              status: 400,
                          })
                        : undefined,
            });
            const ergebnis = await pruefLauf(
                ANWENDEN("facebook"),
                { ...META_ENV, AVESMAPS_ENV: "test" },
                { fetch: graph.fetch, database },
            );
            expect(ergebnis.code).toBe(1);
            expect(ergebnis.fehler).toContain("Abbruch");
            expect(ergebnis.text).not.toContain(FB_TOKEN);
            expect((await pruefStand("facebook"))?.freigeschaltet_at ?? null).toBeNull();
            expect(await protokoll("system.social_kanal_geprueft")).toEqual([]);
        });
    },
);
