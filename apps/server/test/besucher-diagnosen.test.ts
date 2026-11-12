import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_FEHLER_GRENZEN, type ClientFehlerDraht } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { leseApiZahlen } from "../src/besucher/api-lesen.ts";
import { diagnosenAus, raeumeDiagnosenAuf, signaturVon } from "../src/besucher/diagnosen.ts";
import type { ServerConfig } from "../src/config.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Fehler im Browser erfassen (WI-0202): Annahme und Ablehnung am Server, Grenze je Tag, Frist, Leser.
 *
 * 🔴 Gegen einen Wegwerf-Cluster mit den Rollen des VPS: Der Server schreibt als App-Rolle wie auf der Stage, also prüft der
 * Fall auch, dass die neue Tabelle für sie beschreibbar ist (Default-Privilegien, kein eigener Eintrag in einer Grant-Datei).
 *
 * 🪤 Die Route antwortet 204 und schreibt ERST DANACH. Jeder Fall wartet deshalb auf den Zustand, den er erwartet; ein Fall,
 * in dem nichts entstehen soll, schickt eine Markierung hinterher und wartet auf sie (`ruhe`). Wer sofort liest, ist grün,
 * ohne etwas zu prüfen, und der nächste Fall erbt die verspäteten Zeilen.
 */

const UMGEBUNG = { release: "r-test", browser: "Firefox" };

describe("Diagnosen vom Draht (rein)", () => {
    it("bereinigt, fasst Gleiches zusammen und lässt Ungültiges fallen", () => {
        const roh: ClientFehlerDraht[] = [
            {
                art: "vue",
                name: "TypeError",
                meldung: "kaputt bei 12.5 https://x.de/?a=1",
                stellen: ["assets/i.js:1:2"],
            },
            { art: "vue", name: "TypeError", meldung: "kaputt bei 99 https://y.de/", stellen: ["assets/i.js:1:2"] },
            { art: "boese", name: "Error", meldung: "", stellen: [] },
        ];
        const zeilen = diagnosenAus(roh, UMGEBUNG);
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]?.diagnose).toEqual({
            art: "vue",
            name: "TypeError",
            meldung: "kaputt bei # <adresse>",
            stellen: ["assets/i.js:1:2"],
        });
    });

    it("nimmt Release und Browser in die Signatur, sonst nichts vom Besuch", () => {
        const diagnose = { art: "karte" as const, name: "Error", meldung: "m", stellen: [] };
        expect(signaturVon(diagnose, UMGEBUNG)).toMatch(/^[0-9a-f]{32}$/);
        expect(signaturVon(diagnose, UMGEBUNG)).toBe(signaturVon({ ...diagnose }, { ...UMGEBUNG }));
        expect(signaturVon(diagnose, UMGEBUNG)).not.toBe(signaturVon(diagnose, { ...UMGEBUNG, release: "r-neu" }));
    });
});

const ENV = "clientfehler";
const describeWithCluster = postgresBin ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi0202-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithCluster("Diagnosen am Server (Wegwerf-Cluster, App-Rolle)", { timeout: 180_000 }, () => {
    let cluster: VpsCluster | undefined;
    let app: FastifyInstance;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, []);
        app = buildApp({
            config: config(),
            database: cluster.app,
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
    }, 180_000);

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    beforeEach(async () => {
        await cluster!.admin`DELETE FROM client_error_diagnosis`;
        await cluster!.admin`DELETE FROM visitor_metric`;
    });

    /** Eine Meldung von der eigenen Seite, wie der Browser sie schickt; die Antwort ist immer 204. */
    const melde = async (koerper: object, userAgent = "Mozilla/5.0 Firefox/131.0"): Promise<void> => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/besuch",
            headers: { origin: "http://localhost", host: "localhost", "user-agent": userAgent },
            remoteAddress: "203.0.113.77",
            payload: koerper,
        });
        expect(antwort.statusCode).toBe(204);
    };

    /** Die Diagnosen ohne die Markierungen von `ruhe`. */
    const zeilen = () =>
        cluster!.admin<Record<string, unknown>[]>`
            SELECT * FROM client_error_diagnosis WHERE name <> 'Marke' ORDER BY name, message`;

    /** Wartet, bis eine Bedingung über die Datenbank stimmt. */
    const bis = (pruefe: () => Promise<void>) => vi.waitFor(pruefe, { timeout: 10_000, interval: 50 });

    /** Wartet, bis der Server alles davor geschrieben hat: eine Markierung hinterher, bis sie dasteht. */
    let marke = 0;
    const ruhe = async (): Promise<void> => {
        marke += 1;
        const meldung = `Marke ${"abcdefghijklmnopqrstuvwxyz"[marke % 26]!}`;
        await melde({ ereignisse: [], fehler: [{ art: "vue", name: "Marke", meldung, stellen: [] }] });
        await bis(async () => {
            const da = await cluster!.admin`
                SELECT 1 FROM client_error_diagnosis WHERE name = 'Marke' AND message = ${meldung}`;
            expect(da).toHaveLength(1);
        });
    };

    it("speichert eine bereinigte Diagnose ohne IP, Sorte, Uhrzeit oder Adresse und zählt die Art", async () => {
        await melde({
            ereignisse: [{ metrik: "client_fehler", dimension: "vue" }],
            fehler: [
                {
                    art: "vue",
                    name: "TypeError",
                    meldung: "Ort 'Gareth Stadt' bei 51.23 nicht gefunden: https://avesmaps.de/#map=8/51/7&q=gareth",
                    stellen: ["assets/index-A.js:1:234", "https://fremd.example/x.js:1:1"],
                    grafik: "webgl2",
                },
            ],
        });
        await bis(async () => expect(await zeilen()).toHaveLength(1));
        const [zeile] = await zeilen();
        expect(zeile).toMatchObject({
            kind: "vue",
            name: "TypeError",
            message: "Ort '<text>' bei # nicht gefunden: <adresse>",
            frames: ["assets/index-A.js:1:234"],
            release: "wi0202-test",
            browser: "Firefox",
            graphics: "webgl2",
            count: "1",
        });
        // Abschließend: genau diese Spalten, keine für IP, Sorte, Kennung oder Uhrzeit.
        expect(Object.keys(zeile ?? {}).sort()).toEqual(
            ["browser", "count", "day", "frames", "graphics", "kind", "message", "name", "release", "signature"].sort(),
        );
        const alles = JSON.stringify(await zeilen());
        for (const verboten of ["203.0.113", "Gareth", "51.23", "avesmaps.de", "fremd.example"]) {
            expect(alles).not.toContain(verboten);
        }
        // Die Zählung läuft vor den Diagnosen: Steht die Diagnose, steht auch die Zahl.
        const [art] = await cluster!.admin<{ count: string; actor_type: string }[]>`
            SELECT count::text, actor_type FROM visitor_metric WHERE metric = 'client_fehler' AND dimension = 'vue'`;
        expect(art).toEqual({ count: "1", actor_type: "visitor" });
    });

    it("zählt dieselbe Diagnose am selben Tag in einer Zeile hoch", async () => {
        const diagnose = { art: "karte", name: "Error", meldung: "Style is not done loading", stellen: [] };
        await melde({ ereignisse: [], fehler: [diagnose] });
        await melde({ ereignisse: [], fehler: [diagnose] });
        await bis(async () => expect((await zeilen())[0]?.["count"]).toBe("2"));
        expect(await zeilen()).toHaveLength(1);
    });

    it("eine Meldung nur mit Diagnosen zählt weder Gerät noch Sprache noch Herkunft", async () => {
        await melde({ ereignisse: [], fehler: [{ art: "vue", name: "Error", meldung: "m", stellen: [] }] });
        await bis(async () => expect(await zeilen()).toHaveLength(1));
        const summen = await cluster!.admin`SELECT 1 FROM visitor_metric`;
        expect(summen).toHaveLength(0);
    });

    it("verwirft eine unbekannte Art, nimmt aber die übrigen der Meldung", async () => {
        await melde({
            ereignisse: [{ metrik: "pageview" }],
            fehler: [
                { art: "erfunden", name: "Error", meldung: "x", stellen: [] },
                { art: "start", name: "SyntaxError", meldung: "Unexpected token", stellen: [] },
            ],
        });
        await bis(async () => expect((await zeilen()).map((zeile) => zeile["kind"])).toEqual(["start"]));
        // Der Seitenaufruf derselben Meldung zählt trotzdem.
        const aufrufe = await cluster!.admin`SELECT 1 FROM visitor_metric WHERE metric = 'pageview'`;
        expect(aufrufe).toHaveLength(1);
    });

    it("nimmt von Automaten keine Diagnose", async () => {
        await melde(
            {
                ereignisse: [{ metrik: "client_fehler", dimension: "vue" }],
                fehler: [{ art: "vue", name: "E", meldung: "", stellen: [] }],
            },
            "HeadlessChrome Playwright",
        );
        await ruhe();
        expect(await zeilen()).toHaveLength(0);
    });

    it("lehnt einen Körper mit zu vielen Diagnosen ganz ab, still mit 204", async () => {
        const viele = Array.from({ length: CLIENT_FEHLER_GRENZEN.jeMeldung + 1 }, (_, nummer) => ({
            art: "vue",
            name: "Error",
            meldung: `Fall ${"abcdefgh"[nummer]!}`,
            stellen: [],
        }));
        await melde({ ereignisse: [{ metrik: "pageview" }], fehler: viele });
        await ruhe();
        expect(await zeilen()).toHaveLength(0);
    });

    it("hält die Grenze je Tag: danach keine neue Signatur, bekannte zählen weiter", async () => {
        const bekannt = { art: "vue" as const, name: "Bekannt", meldung: "", stellen: [] };
        const signatur = signaturVon(bekannt, { release: "wi0202-test", browser: "Firefox" });
        await cluster!.admin`
            INSERT INTO client_error_diagnosis (day, signature, kind, name)
            SELECT CURRENT_DATE, lpad(to_hex(nummer), 32, '0'), 'vue', 'Fuell'
            FROM generate_series(1, ${CLIENT_FEHLER_GRENZEN.jeTag - 1}) AS nummer`;
        await cluster!.admin`
            INSERT INTO client_error_diagnosis (day, signature, kind, name)
            VALUES (CURRENT_DATE, ${signatur}, 'vue', 'Bekannt')`;
        // In EINER Meldung, der Reihe nach: erst die neue, dann die bekannte. Zählt die bekannte hoch, ist die neue durch.
        await melde({ ereignisse: [], fehler: [{ art: "vue", name: "Neu", meldung: "", stellen: [] }, bekannt] });
        await bis(async () => {
            const [zeile] = await cluster!.admin<{ count: string }[]>`
                SELECT count::text FROM client_error_diagnosis WHERE signature = ${signatur}`;
            expect(zeile?.count).toBe("2");
        });
        const neu = await cluster!.admin`SELECT 1 FROM client_error_diagnosis WHERE name = 'Neu'`;
        expect(neu).toHaveLength(0);
    });

    it("löscht nach der Frist, die Zählung bleibt", async () => {
        await cluster!.admin`
            INSERT INTO client_error_diagnosis (day, signature, kind, name)
            VALUES (CURRENT_DATE - ${CLIENT_FEHLER_GRENZEN.fristTage + 1}::int, ${"a".repeat(32)}, 'vue', 'Alt'),
                   (CURRENT_DATE - ${CLIENT_FEHLER_GRENZEN.fristTage}::int, ${"b".repeat(32)}, 'vue', 'Grenze')`;
        await cluster!.admin`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
            VALUES (CURRENT_DATE - 40, 24, 'visitor', 'client_fehler', 'vue', 3)`;
        // Die Frist läuft als App-Rolle, wie im Takt.
        expect(await raeumeDiagnosenAuf(cluster!.app)).toBe(1);
        expect((await zeilen()).map((zeile) => zeile["name"])).toEqual(["Grenze"]);
        const summe = await cluster!.admin`SELECT 1 FROM visitor_metric WHERE metric = 'client_fehler'`;
        expect(summe).toHaveLength(1);
    });

    it("liefert Zählung und Diagnosen an den Unterreiter „API“, ohne Automaten", async () => {
        await melde({
            ereignisse: [{ metrik: "client_fehler", dimension: "kontext_verloren" }],
            fehler: [{ art: "kontext_verloren", name: "WebGLContextLost", meldung: "", stellen: [], grafik: "webgl2" }],
        });
        await melde({ ereignisse: [{ metrik: "client_fehler", dimension: "vue" }] }, "Googlebot/2.1");
        await ruhe();
        const zahlen = await leseApiZahlen(cluster!.app, 30);
        expect(zahlen.browserFehler?.arten).toEqual([{ name: "kontext_verloren", wert: 1 }]);
        expect(zahlen.browserFehler?.diagnosen).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    art: "kontext_verloren",
                    name: "WebGLContextLost",
                    anzahl: 1,
                    grafik: "webgl2",
                }),
            ]),
        );
    });
});
