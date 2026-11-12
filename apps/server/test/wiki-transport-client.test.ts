import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WikiTransportFehler } from "../src/wiki/transport/fehler.ts";
import { erzeugeWikiClient, type WikiClient, type WikiClientOptionen } from "../src/wiki/transport/client.ts";
import { ANFRAGE_MAX_ZEICHEN, WIKI_API_URL, WIKI_USER_AGENT } from "../src/wiki/transport/konstanten.ts";
import { kodiere, naechsterTitelStapel, stapelGroesse } from "../src/wiki/transport/stapel.ts";
import { neuerOrdner } from "./support/wiki-dump-fixture.ts";
import { BOT_NAME, BOT_PASSWORT, starteTestwiki, type Testwiki } from "./support/wiki-testserver.ts";

/**
 * Der Wiki-Client gegen einen lokalen Testserver (WI-0253 B-1, B1-Vertrag, „Abnahme/Tests ohne Wiki-Netzlast“): Anmeldestatus, Stapelgrößen
 * 50 und 500, die Länge der Abfrage, Fehler in HTTP 200, 429 und 403 mit Pause, der Unterbrecher, der nicht wartende Weg und das Schweigen
 * über das Secret. KEIN Aufruf an de.wiki-aventurica.de: Jeder Client hier bekommt `apiUrl` des Testservers.
 *
 * Die Uhr ist gefälscht und die Wartezeiten springen, statt zu schlafen: Die echten Zahlen (20 s Takt, 40 s Backoff) gelten, der Test dauert
 * Millisekunden. Aus den gefälschten Zeitpunkten jeder Anfrage liest er den Abstand ab. Die Zugangsdaten stehen in einer Wegwerf-Datei
 * außerhalb des Repositorys.
 */

const START = 1_800_000_000_000;
const TAKT = 20_000;
let wurzel: Awaited<ReturnType<typeof neuerOrdner>>;
let wiki: Testwiki;
let zaehler = 0;
let zugang: string;

beforeAll(async () => {
    wurzel = await neuerOrdner("wiki-client-test");
    zugang = join(wurzel.pfad, "wiki-bot.json");
    await writeFile(zugang, JSON.stringify({ bot_username: BOT_NAME, bot_password: BOT_PASSWORT }));
});
afterAll(async () => {
    await wurzel.weg();
});
beforeEach(async () => {
    wiki = await starteTestwiki();
});
afterEach(async () => {
    await wiki.schliesse();
});

interface Pruefstand {
    client: WikiClient;
    uhr: { jetzt: number };
    schlaefe: number[];
    /** Der (gefälschte) Zeitpunkt jeder Anfrage, die hinausging. */
    zeiten: number[];
    ordner: string;
}

async function bauClient(extra: Partial<WikiClientOptionen> = {}, mitKonto = true): Promise<Pruefstand> {
    zaehler += 1;
    const ordner = join(wurzel.pfad, `takt${String(zaehler)}`);
    await mkdir(ordner, { recursive: true });
    const uhr = { jetzt: START };
    const schlaefe: number[] = [];
    const zeiten: number[] = [];
    const client = erzeugeWikiClient({
        taktVerzeichnis: ordner,
        zugangsdatei: mitKonto ? zugang : undefined,
        apiUrl: wiki.url,
        jetzt: () => uhr.jetzt,
        schlafe: (ms) => {
            schlaefe.push(ms);
            uhr.jetzt += ms;
            return Promise.resolve();
        },
        fetch: (eingabe, init) => {
            zeiten.push(uhr.jetzt);
            return fetch(eingabe, init);
        },
        jitterMaxMs: 0,
        zufall: () => 0,
        ...extra,
    });
    return { client, uhr, schlaefe, zeiten, ordner };
}

const titel = (anzahl: number, vorsilbe = "Seite"): string =>
    Array.from({ length: anzahl }, (_, index) => `${vorsilbe} ${String(index)}`).join("|");
const abfrage = (anzahl: number): Record<string, string> => ({ action: "query", prop: "info", titles: titel(anzahl) });

async function fehlerVon(arbeit: Promise<unknown>): Promise<WikiTransportFehler> {
    try {
        await arbeit;
    } catch (fehler) {
        if (fehler instanceof WikiTransportFehler) return fehler;
        throw fehler;
    }
    throw new Error("kein Fehler");
}

describe("Client: Status ohne Anfrage", () => {
    it("🔴 sagt Zustand, Budget und Takt, ohne EINE Anfrage an das Wiki, und nennt weder Benutzer noch Passwort", async () => {
        const { client } = await bauClient();
        const status = await client.status();
        expect(status).toMatchObject({
            taktNutzbar: true,
            pause: null,
            fehlerFolge: 0,
            anmeldung: { status: "unversucht", hinterlegt: true, titelBudget: 50, sitzungAlterMs: null },
        });
        expect(wiki.anfragen).toHaveLength(0);
        const text = JSON.stringify(status);
        expect(text).not.toContain(BOT_PASSWORT);
        expect(text).not.toContain(BOT_NAME);
        expect(text).not.toContain("Avesmaps");
    });

    it("ohne Zugangsdaten: anonym mit 50 Titeln; mit unbrauchbaren oder relativen Pfaden ebenso, mit dem Grund", async () => {
        const ohne = await bauClient({}, false);
        expect((await ohne.client.status()).anmeldung).toMatchObject({
            status: "anonym",
            hinterlegt: false,
            grundCode: "keine_zugangsdaten",
            titelBudget: 50,
        });
        const halb = join(wurzel.pfad, "halb.json");
        await writeFile(halb, JSON.stringify({ bot_username: "Avesmaps@Test" }));
        expect(
            (await (await bauClient({ zugangsdatei: join(wurzel.pfad, "gibt-es-nicht.json") })).client.status())
                .anmeldung,
        ).toMatchObject({ grundCode: "zugang_nicht_lesbar" });
        expect((await (await bauClient({ zugangsdatei: halb })).client.status()).anmeldung).toMatchObject({
            status: "anonym",
            grundCode: "zugang_unvollstaendig",
        });
        const kaputt = join(wurzel.pfad, "kaputt.json");
        await writeFile(kaputt, "{nein");
        expect((await (await bauClient({ zugangsdatei: kaputt })).client.status()).anmeldung).toMatchObject({
            grundCode: "zugang_kein_json",
        });
        expect((await (await bauClient({ zugangsdatei: "relativ.json" })).client.status()).anmeldung).toMatchObject({
            grundCode: "zugang_pfad_nicht_absolut",
        });
        expect(wiki.anfragen).toHaveLength(0);
    });

    it("🔴 eine Zugangsdatei IM Repository wird abgewiesen, ohne sie zu lesen (Standard-Wurzel: dieses Repository)", async () => {
        const imRepository = fileURLToPath(import.meta.url);
        const { client } = await bauClient({ zugangsdatei: imRepository });
        expect((await client.status()).anmeldung).toMatchObject({
            status: "anonym",
            hinterlegt: false,
            grundCode: "zugang_im_repository",
        });
        // Und mit einer eigenen Wurzel: außerhalb ist es erlaubt, innerhalb nicht.
        const innen = await bauClient({ repositoryWurzel: wurzel.pfad });
        expect((await innen.client.status()).anmeldung).toMatchObject({ grundCode: "zugang_im_repository" });
    });

    it("kein Ordner für den Takt: der Status sagt es, statt zu werfen", async () => {
        const { client } = await bauClient({ taktVerzeichnis: undefined });
        expect(await client.status()).toMatchObject({ taktNutzbar: false, taktFreiInMs: null, anmeldung: null });
        await expect(client.frage(abfrage(1))).rejects.toMatchObject({ code: "takt_nicht_nutzbar" });
        expect(wiki.anfragen).toHaveLength(0);
    });
});

describe("Client: Anmeldung und Stapelgröße", () => {
    it("🔴 anonym: 50 Titel gehen, 51 weist das Wiki ab (toomanyvalues, als HTTP 200) und der Client macht daraus einen Fehler", async () => {
        const { client } = await bauClient({}, false);
        const antwort = await client.frage(abfrage(50));
        expect((antwort["query"] as { pages: unknown[] }).pages).toHaveLength(50);
        const fehler = await fehlerVon(client.frage(abfrage(51)));
        expect(fehler).toMatchObject({ code: "api_zu_viele_werte", apiCode: "toomanyvalues" });
        // Anonym wird nichts mit `assert=user` und nichts mit Cookie geschickt.
        for (const anfrage of wiki.anfragen) {
            expect(anfrage.abfrage.has("assert")).toBe(false);
            expect(anfrage.kopf.cookie).toBeUndefined();
        }
        expect((await client.status()).anmeldung).toMatchObject({ status: "anonym", titelBudget: 50 });
    });

    it("🔴 Bot: Token, Anmeldung, dann der 500er-Stapel; User-Agent immer fest, Passwort nur im POST-Rumpf, Abstand 20 s zwischen ALLEN Anfragen", async () => {
        const { client, zeiten } = await bauClient();
        const antwort = await client.frage(abfrage(500));
        expect((antwort["query"] as { pages: unknown[] }).pages).toHaveLength(500);
        expect(wiki.anfragen.map((anfrage) => anfrage.methode)).toEqual(["POST", "POST", "GET"]);
        expect(wiki.anfragen[0]?.rumpf?.get("meta")).toBe("tokens");
        expect(wiki.anfragen[1]?.rumpf?.get("lgpassword")).toBe(BOT_PASSWORT);
        expect(wiki.anfragen[2]?.abfrage.get("assert")).toBe("user");
        expect(wiki.anfragen[2]?.kopf.cookie).toContain("botSession=bot1");
        for (const anfrage of wiki.anfragen) {
            expect(anfrage.kopf["user-agent"]).toBe(WIKI_USER_AGENT);
            expect(anfrage.pfad + anfrage.abfrage.toString()).not.toContain(BOT_PASSWORT);
        }
        // Mindestens 20 s zwischen je zwei Anfragen, die Anmelde-POSTs eingeschlossen (und schon die erste wartet: kein Vermerk).
        expect(zeiten).toHaveLength(3);
        expect((zeiten[0] ?? 0) - START).toBeGreaterThanOrEqual(TAKT);
        for (let index = 1; index < zeiten.length; index += 1) {
            expect((zeiten[index] ?? 0) - (zeiten[index - 1] ?? 0)).toBeGreaterThanOrEqual(TAKT);
        }
        expect((await client.status()).anmeldung).toMatchObject({ status: "bot", titelBudget: 500, grundCode: null });
        // Eine zweite Abfrage meldet nicht neu an.
        await client.frage(abfrage(500));
        expect(wiki.anfragen.map((anfrage) => anfrage.methode)).toEqual(["POST", "POST", "GET", "GET"]);
    });

    it("🔴 abgelehnte Anmeldung: Status gescheitert mit dem Code des Wikis, die Abfrage läuft anonym weiter, kein neuer Versuch, kein Secret im Status", async () => {
        // Der Testserver kennt nur den richtigen Zugang; für die Ablehnung eine Datei mit falschem Passwort.
        const falsch = join(wurzel.pfad, "falsch.json");
        await writeFile(falsch, JSON.stringify({ bot_username: BOT_NAME, bot_password: "nicht-das-passwort" }));
        const zweiter = await bauClient({ zugangsdatei: falsch });
        await zweiter.client.frage(abfrage(10));
        const status = await zweiter.client.status();
        expect(status.anmeldung).toMatchObject({ status: "gescheitert", grundCode: "wrongpassword", titelBudget: 50 });
        const posts = wiki.anfragen.filter((anfrage) => anfrage.methode === "POST").length;
        await zweiter.client.frage(abfrage(10));
        // Keine Login-Schleife: Innerhalb der Sperrfrist wird nicht erneut angemeldet.
        expect(wiki.anfragen.filter((anfrage) => anfrage.methode === "POST")).toHaveLength(posts);
        const text = JSON.stringify(status);
        for (const geheim of ["nicht-das-passwort", BOT_PASSWORT, BOT_NAME]) expect(text).not.toContain(geheim);
        // Nach 15 Minuten darf es wieder versucht werden.
        zweiter.uhr.jetzt += 900_001;
        expect((await zweiter.client.status()).anmeldung).toMatchObject({ status: "unversucht" });
    });

    it("🔴 Sitzung abgelaufen (assertuserfailed als HTTP 200): verwerfen, EINMAL neu anmelden, dieselbe Anfrage noch einmal", async () => {
        const { client } = await bauClient();
        await client.frage(abfrage(5));
        wiki.zustand.sitzungGueltig = false;
        const antwort = await client.frage(abfrage(5));
        expect((antwort["query"] as { pages: unknown[] }).pages).toHaveLength(5);
        expect(wiki.anfragen.map((anfrage) => anfrage.methode)).toEqual([
            "POST",
            "POST",
            "GET",
            "GET",
            "POST",
            "POST",
            "GET",
        ]);
    });

    it("🔴 geht die Sitzung dauernd verloren, endet es nach EINER Erneuerung mit anmeldung_verloren, ohne Schleife", async () => {
        const { client } = await bauClient();
        await client.frage(abfrage(5));
        wiki.antworter = (anfrage) =>
            anfrage.methode === "GET" ? { json: { error: { code: "assertuserfailed", info: "weg" } } } : undefined;
        const fehler = await fehlerVon(client.frage(abfrage(5)));
        expect(fehler.code).toBe("anmeldung_verloren");
        const anmeldungen = wiki.anfragen.filter((anfrage) => anfrage.rumpf?.get("action") === "login");
        expect(anmeldungen.length).toBeLessThanOrEqual(2);
    });

    it("🔴 weist das Wiki 500 Titel trotz Anmeldung ab, gelten ab da 50, sichtbar als Degradation", async () => {
        const { client } = await bauClient();
        wiki.zustand.apihighlimits = false;
        const fehler = await fehlerVon(client.frage(abfrage(100)));
        expect(fehler.code).toBe("api_zu_viele_werte");
        expect((await client.status()).anmeldung).toMatchObject({
            status: "bot",
            titelBudget: 50,
            budgetAbgewiesen: true,
            grundCode: "api_zu_viele_werte",
        });
    });

    it("🔴 die Zugangsdaten tauchen in keinem Fehler auf (Verbindung weg, Ablehnung, Pause)", async () => {
        const { client } = await bauClient();
        wiki.antworter = () => ({ status: 403, text: "gesperrt" });
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        const spuren = JSON.stringify({ meldung: fehler.message, code: fehler.code, angaben: { ...fehler } });
        for (const geheim of [BOT_PASSWORT, BOT_NAME, "botSession"]) expect(spuren).not.toContain(geheim);
    });
});

describe("Client: Fehler in HTTP 200, Backoff, Pause", () => {
    it("ein API-Fehler im Körper (HTTP 200) ist ein Fehler, nie „nichts gefunden“; ein Programmierfehler zählt nicht zum Unterbrecher", async () => {
        const { client } = await bauClient({}, false);
        wiki.antworter = () => ({ json: { error: { code: "badtitle", info: "Ungültiger Titel" } } });
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        expect(fehler).toMatchObject({
            code: "api_fehler",
            apiCode: "badtitle",
            apiInfo: "Ungültiger Titel",
            wiederholbar: false,
        });
        expect((await client.status()).fehlerFolge).toBe(0);
    });

    it("ein vorübergehender API-Fehler (ratelimited als 200) wird mit Backoff wiederholt, jede Wiederholung bekommt ihren Platz im Takt", async () => {
        const { client, schlaefe, zeiten } = await bauClient({}, false);
        wiki.antworter = (_anfrage, nummer) =>
            nummer === 1 ? { json: { error: { code: "ratelimited", info: "zu schnell" } } } : undefined;
        const antwort = await client.frage(abfrage(3));
        expect((antwort["query"] as { pages: unknown[] }).pages).toHaveLength(3);
        expect(wiki.anfragen).toHaveLength(2);
        // Der Backoff ist das Doppelte des Takts (40 s), die Wiederholung wartet danach noch ihren Platz ab.
        expect(schlaefe).toContain(40_000);
        expect((zeiten[1] ?? 0) - (zeiten[0] ?? 0)).toBeGreaterThanOrEqual(40_000);
    });

    it("🔴 429 mit Retry-After: Es wird abgewartet, was das Wiki sagt (mindestens der Backoff), dann geht es weiter", async () => {
        const { client, schlaefe, zeiten } = await bauClient({}, false);
        wiki.antworter = (_anfrage, nummer) =>
            nummer === 1 ? { status: 429, kopf: { "retry-after": "90" }, text: "" } : undefined;
        await client.frage(abfrage(3));
        expect(schlaefe).toContain(90_000);
        expect(wiki.anfragen).toHaveLength(2);
        expect((zeiten[1] ?? 0) - (zeiten[0] ?? 0)).toBeGreaterThanOrEqual(90_000);
        expect((await client.status()).pause).toBeNull();
    });

    it("🔴 429 bleibt es: nach den Wiederholungen hält der Aufruf an, die Pause gilt für ALLE, und es geht nichts mehr hinaus", async () => {
        const { client, uhr, ordner } = await bauClient({}, false);
        wiki.antworter = () => ({ status: 429, kopf: { "retry-after": "5" }, text: "" });
        const fehler = await fehlerVon(client.frage(abfrage(3)));
        expect(fehler).toMatchObject({ code: "http_429", status: 429, wiederholbar: true });
        // Drei Versuche (zwei Wiederholungen), danach Schluss.
        expect(wiki.anfragen).toHaveLength(3);
        const davor = wiki.anfragen.length;
        const pausiert = await fehlerVon(client.frage(abfrage(3)));
        expect(pausiert.code).toBe("pausiert");
        expect(pausiert.bis).toBeGreaterThanOrEqual(uhr.jetzt + 200_000);
        expect(wiki.anfragen).toHaveLength(davor);
        expect((await client.status()).pause).toMatchObject({ grund: "http_429" });
        // Ein anderer Client auf demselben Ordner (anderer Prozess, andere Umgebung) sieht dieselbe Pause.
        const anderer = erzeugeWikiClient({ taktVerzeichnis: ordner, apiUrl: wiki.url, jetzt: () => uhr.jetzt });
        await expect(anderer.frage(abfrage(1))).rejects.toMatchObject({ code: "pausiert" });
        expect(wiki.anfragen).toHaveLength(davor);
    });

    it("die Pause endet: nach ihrer Zeit geht die nächste Anfrage wieder hinaus", async () => {
        const { client, uhr } = await bauClient({}, false);
        wiki.antworter = () => ({ status: 429, text: "" });
        await fehlerVon(client.frage(abfrage(1)));
        wiki.antworter = null;
        await expect(client.frage(abfrage(1))).rejects.toMatchObject({ code: "pausiert" });
        uhr.jetzt += 300_001;
        await expect(client.frage(abfrage(1))).resolves.toBeDefined();
    });

    it("🔴 403: keine Wiederholung, eine Stunde Pause für alle, und danach schweigt der Client, statt zu hämmern", async () => {
        const { client, uhr } = await bauClient({}, false);
        wiki.antworter = () => ({ status: 403, text: "Forbidden" });
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        expect(fehler).toMatchObject({ code: "http_403", status: 403 });
        expect(wiki.anfragen).toHaveLength(1);
        expect(fehler.bis).toBe(uhr.jetzt + 3_600_000);
        for (let nummer = 0; nummer < 3; nummer += 1) {
            await expect(client.frage(abfrage(1))).rejects.toMatchObject({ code: "pausiert" });
        }
        expect(wiki.anfragen).toHaveLength(1);
    });

    it("🔴 ein Retry-After, den kein Lauf abwartet (Stunden), wird nicht abgeschlafen: Der Aufruf hält an, die Pause trägt die Zeit", async () => {
        const { client, schlaefe, uhr } = await bauClient({}, false);
        wiki.antworter = () => ({ status: 503, kopf: { "retry-after": "3600" }, text: "" });
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        expect(fehler.code).toBe("http_429");
        expect(wiki.anfragen).toHaveLength(1);
        expect(Math.max(0, ...schlaefe)).toBeLessThanOrEqual(TAKT);
        expect(fehler.bis).toBe(uhr.jetzt + 3_600_000);
    });

    it("🔴 Unterbrecher: drei fehlgeschlagene AUFRUFE (nicht Versuche) öffnen ihn; offen geht nichts hinaus, danach darf eine Anfrage die Probe machen", async () => {
        const { client, uhr } = await bauClient({ wiederholungen: 1 }, false);
        wiki.antworter = () => ({ status: 500, text: "kaputt" });
        const erster = await fehlerVon(client.frage(abfrage(1)));
        expect(erster).toMatchObject({ code: "http_fehler", status: 500, wiederholbar: true });
        // Ein Aufruf mit zwei Versuchen zählt EINEN Fehler.
        expect(wiki.anfragen).toHaveLength(2);
        expect((await client.status()).fehlerFolge).toBe(1);
        await fehlerVon(client.frage(abfrage(1)));
        await fehlerVon(client.frage(abfrage(1)));
        expect(wiki.anfragen).toHaveLength(6);
        expect((await client.status()).pause).toMatchObject({ grund: "unterbrecher" });
        await expect(client.frage(abfrage(1))).rejects.toMatchObject({ code: "pausiert" });
        expect(wiki.anfragen).toHaveLength(6);
        wiki.antworter = null;
        uhr.jetzt += 600_001;
        await expect(client.frage(abfrage(1))).resolves.toBeDefined();
        expect((await client.status()).fehlerFolge).toBe(0);
    });

    it("eine Antwort, die kein JSON ist (Sperrseite mit HTTP 200), ist ein Fehler und zählt zum Unterbrecher", async () => {
        const { client } = await bauClient({ wiederholungen: 0 }, false);
        wiki.antworter = () => ({ status: 200, text: "<html>Bitte warten</html>" });
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        expect(fehler).toMatchObject({ code: "antwort_ungueltig", wiederholbar: true });
        expect((await client.status()).fehlerFolge).toBe(1);
    });

    it("eine Weiterleitung wird NICHT verfolgt (Cookies und Passwort gingen mit): Fehler, genau eine Anfrage", async () => {
        const { client } = await bauClient({ wiederholungen: 0 }, false);
        wiki.antworter = () => ({ status: 302, kopf: { location: "http://127.0.0.1:9/anderswo" }, text: "" });
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        expect(fehler).toMatchObject({ code: "http_fehler", status: 302, wiederholbar: false });
        expect(wiki.anfragen).toHaveLength(1);
    });

    it("das Wiki nicht erreichbar: Fehler `verbindung`, wiederholbar, zählt als ein Fehler", async () => {
        const { client } = await bauClient({ wiederholungen: 1 }, false);
        await wiki.schliesse();
        const fehler = await fehlerVon(client.frage(abfrage(1)));
        expect(fehler).toMatchObject({ code: "verbindung", wiederholbar: true });
        expect((await client.status()).fehlerFolge).toBe(1);
    });
});

describe("Client: Länge der Abfrage und Stapel", () => {
    it("🔴 eine zu lange Abfrage scheitert VOR jeder Anfrage und nimmt keinen Platz im Takt (kein 414 vom Wiki)", async () => {
        const { client, ordner } = await bauClient({}, false);
        const fehler = await fehlerVon(
            client.frage({ action: "query", titles: titel(2000, "Ein ziemlich langer Titel") }),
        );
        expect(fehler.code).toBe("url_zu_lang");
        expect(wiki.anfragen).toHaveLength(0);
        await expect(readFile(join(ordner, "letzte-anfrage"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("🔴 gestapelt wird nach Titelzahl UND kodierter Länge, die kleinere gewinnt; kein Stapel ist leer, kein Titel geht verloren", () => {
        const kurz = Array.from({ length: 1200 }, (_, index) => `Ort ${String(index)}`);
        expect(naechsterTitelStapel(kurz, 0, 500).titel).toHaveLength(500);
        expect(naechsterTitelStapel(kurz, 0, 50).titel).toHaveLength(50);
        // 500 Umlaut-Titel: jeder Umlaut sind sechs Zeichen, die Länge schneidet vor der Zahl ab.
        const lang = Array.from({ length: 800 }, (_, index) => `Äußerst überlanger Ortsname Nr ${String(index)} ü`);
        const erster = naechsterTitelStapel(lang, 0, 500);
        expect(erster.titel.length).toBeLessThan(500);
        expect(erster.titel.map(kodiere).join("%7C").length).toBeLessThanOrEqual(7000);
        // Der ganze Bestand läuft in Stapeln durch, ohne Lücke und ohne Doppelte.
        const gesehen: string[] = [];
        let offset = 0;
        while (offset < lang.length) {
            const stapel = naechsterTitelStapel(lang, offset, 500);
            expect(stapel.titel.length).toBeGreaterThan(0);
            gesehen.push(...stapel.titel);
            offset = stapel.naechsterOffset;
        }
        expect(gesehen).toEqual(lang);
        // Ein einzelner Titel, der die Grenze allein sprengt, fährt allein.
        const riese = ["x".repeat(8000), "klein"];
        expect(naechsterTitelStapel(riese, 0, 50)).toEqual({ titel: [riese[0]], naechsterOffset: 1 });
    });

    it("die Stapelgröße folgt dem ZUSTAND: 500 nur für `bot`, und nicht, wenn das Wiki sie abgewiesen hat", () => {
        expect(stapelGroesse("bot")).toBe(500);
        expect(stapelGroesse("bot", true)).toBe(50);
        for (const status of ["unversucht", "anonym", "gescheitert"] as const) expect(stapelGroesse(status)).toBe(50);
        expect(ANFRAGE_MAX_ZEICHEN).toBeLessThan(8190);
    });

    it("die echte Adresse und der feste Agent stehen im Code, die Tests nehmen nie die echte Adresse", () => {
        expect(WIKI_API_URL).toBe("https://de.wiki-aventurica.de/de/api.php");
        expect(WIKI_USER_AGENT.startsWith("AvesmapsWikiSync/")).toBe(true);
        expect(wiki.url.startsWith("http://127.0.0.1:")).toBe(true);
    });
});

describe("Client: der nicht wartende Weg (ein Mensch wartet)", () => {
    it("🔴 interaktiv: belegt weist ab, ohne Anfrage, ohne Anmeldung, ohne zu schlafen; frei geht GENAU eine Anfrage hinaus", async () => {
        const { client, schlaefe, ordner } = await bauClient();
        // Ohne Vermerk ist der Platz nicht frei (sichere Richtung): abgewiesen, und der Vermerk heilt.
        const abgewiesen = await fehlerVon(client.frage(abfrage(1), { interaktiv: true }));
        expect(abgewiesen).toMatchObject({ code: "belegt", wiederholbar: true });
        expect(wiki.anfragen).toHaveLength(0);
        // Ein alter Vermerk: der Platz ist frei. Trotz Zugangsdaten keine Anmeldung (sie hebt nur die Stapelgröße).
        await writeFile(join(ordner, "letzte-anfrage"), String(START - 10 * TAKT));
        await client.frage(abfrage(1), { interaktiv: true });
        expect(wiki.anfragen.map((anfrage) => anfrage.methode)).toEqual(["GET"]);
        expect(wiki.anfragen[0]?.abfrage.has("assert")).toBe(false);
        // Sofort danach: belegt, und kein Platz wurde durch die Abweisung nach hinten geschoben.
        const vermerk = await readFile(join(ordner, "letzte-anfrage"), "utf8");
        await expect(client.frage(abfrage(1), { interaktiv: true })).rejects.toMatchObject({ code: "belegt" });
        expect(await readFile(join(ordner, "letzte-anfrage"), "utf8")).toBe(vermerk);
        expect(schlaefe).toEqual([]);
        expect(wiki.anfragen).toHaveLength(1);
    });

    it("interaktiv wiederholt nichts: ein 429 ist sofort der Fehler (und die Pause)", async () => {
        const { client, ordner } = await bauClient({}, false);
        await writeFile(join(ordner, "letzte-anfrage"), String(START - 10 * TAKT));
        wiki.antworter = () => ({ status: 429, text: "" });
        await expect(client.frage(abfrage(1), { interaktiv: true })).rejects.toMatchObject({ code: "http_429" });
        expect(wiki.anfragen).toHaveLength(1);
    });
});
