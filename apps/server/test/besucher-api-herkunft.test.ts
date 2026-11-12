import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { absenderAusKennung, drosselZone } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseApiZahlen } from "../src/besucher/api-lesen.ts";
import { apiZaehlerEigeneAdressen } from "../src/config.ts";
import { herkunftAus, legacyPfad } from "../src/besucher/api-herkunft.ts";
import {
    merkePosten,
    postenFuer,
    schreibeSchnittstellen,
    vergissOffene,
    zaehleSchnittstellen,
    type AnfrageKopf,
    type Posten,
} from "../src/besucher/api-zaehler.ts";

/**
 * Wer fragt (WI-0307, Handover Claudios 2026-11-10 `api-nutzung-status`): Herkunft, Absender, alte Legacy-Pfade und der Vertrag
 * für Teil B. 🔴 In `api_metric` stehen keine Adressen, keine Suchbegriffe, keine vollständigen User-Agents.
 */

/** Was der Puffer beim nächsten Takt schreiben würde, ohne Datenbank. */
async function geschriebeneZeilen(): Promise<Posten[]> {
    let zeilen: Posten[] = [];
    const sql = ((_teile: TemplateStringsArray, werte: string) => {
        zeilen = JSON.parse(werte) as Posten[];
        return Promise.resolve([]);
    }) as never;
    await schreibeSchnittstellen(sql);
    return zeilen;
}

const metrik = (posten: readonly Posten[], name: string): string[] =>
    posten.filter((eintrag) => eintrag.metric === name).map((eintrag) => eintrag.dimension);

describe("Absender", () => {
    it("nimmt das erste Produktwort ohne Version", () => {
        expect(absenderAusKennung("dsaworld-route-check/1.0 (+https://example.org/bot)")).toBe("dsaworld-route-check");
        expect(absenderAusKennung("Efferd-Hermes/1.0")).toBe("Efferd-Hermes");
        expect(absenderAusKennung("Python-urllib/3.13")).toBe("Python-urllib");
        expect(absenderAusKennung("curl/8.5.0")).toBe("curl");
        expect(absenderAusKennung("okhttp/4.12.0")).toBe("okhttp");
        expect(absenderAusKennung("probe-absender")).toBe("probe-absender");
        expect(absenderAusKennung("  Go-http-client/2.0  ")).toBe("Go-http-client");
    });

    it("macht jeden Browser zu „Browser“ und schreibt nie den ganzen User-Agent", () => {
        expect(absenderAusKennung("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0")).toBe(
            "Browser",
        );
        expect(absenderAusKennung("mozilla/4.0")).toBe("Browser");
    });

    it("hält sich an Länge und Zeichen, sonst `anders`; ohne Angabe `ohne_angabe`", () => {
        expect(absenderAusKennung("x".repeat(41))).toBe("anders");
        expect(absenderAusKennung("x".repeat(40))).toBe("x".repeat(40));
        expect(absenderAusKennung("böse<script>/1")).toBe("anders");
        expect(absenderAusKennung("(compatible)")).toBe("anders");
        expect(absenderAusKennung(undefined)).toBe("ohne_angabe");
        expect(absenderAusKennung("   ")).toBe("ohne_angabe");
    });

    it("Teil B: die Zone ohne Umgebungsvorsatz", () => {
        expect(drosselZone("avesmaps3d_stage_reise")).toBe("reise");
        // Production heißt `avesmaps3d_prod_*` (Claudio 2026-11-11): dieselbe Zone, derselbe Name.
        expect(drosselZone("avesmaps3d_prod_reise")).toBe("reise");
        expect(drosselZone("avesmaps3d_prod_suche_vorkommen")).toBe("suche_vorkommen");
        expect(drosselZone("avesmaps3d_suche_vorkommen")).toBe("suche_vorkommen");
        expect(drosselZone("komisch zone!")).toBe("anders");
    });
});

describe("Herkunft", () => {
    it("liest Origin vor Referer und erkennt unsere Seiten", () => {
        expect(herkunftAus("https://avesmaps.de", undefined)).toEqual({ herkunft: "eigene_seite" });
        expect(herkunftAus(undefined, "https://stage.avesmaps.de/karte?x=1")).toEqual({ herkunft: "eigene_seite" });
        expect(herkunftAus("https://example.com", "https://avesmaps.de/")).toEqual({
            herkunft: "fremde_seite",
            seite: "example.com",
        });
    });

    it("🔴 von einer fremden Seite nur der Hostname, nie Pfad, Abfrage oder eine IP-Adresse", () => {
        expect(herkunftAus(undefined, "https://Forum.Example.org/thread/42?suche=Gareth")).toEqual({
            herkunft: "fremde_seite",
            seite: "forum.example.org",
        });
        expect(herkunftAus(undefined, "http://192.168.1.20:8080/tool.html").seite).toBe("ip-adresse");
        expect(herkunftAus(undefined, "http://[2001:db8::1]/").seite).toBe("ip-adresse");
        expect(herkunftAus(undefined, "kein url").seite).toBe("anders");
    });

    it("💣 ohne Referer (unsere Seiten schicken no-referrer) entscheidet Sec-Fetch-Site", () => {
        expect(herkunftAus(undefined, undefined, "same-origin")).toEqual({ herkunft: "eigene_seite" });
        expect(herkunftAus("null", undefined, "same-site")).toEqual({ herkunft: "eigene_seite" });
        expect(herkunftAus(undefined, undefined, "cross-site")).toEqual({
            herkunft: "fremde_seite",
            seite: "unbekannt",
        });
        expect(herkunftAus(undefined, undefined, "none")).toEqual({ herkunft: "ohne_seite" });
        expect(herkunftAus(undefined, undefined)).toEqual({ herkunft: "ohne_seite" });
    });
});

describe("Alte Legacy-Pfade", () => {
    it("kennt die drei alten API-Wege und die Oberfläche, nach Methode", () => {
        expect(legacyPfad("GET", "/api/route.php")?.weg).toBe("/api/route.php");
        expect(legacyPfad("POST", "/api/route.php")?.weg).toBe("/api/route.php");
        expect(legacyPfad("GET", "/api/locations/")?.weg).toBe("/api/locations/");
        expect(legacyPfad("POST", "/api/route/")?.weg).toBe("POST /api/route/");
        // Unsere eigene Route ist GET: Ein GET darauf ist kein alter Pfad.
        expect(legacyPfad("GET", "/api/route")).toBeUndefined();
        expect(legacyPfad("GET", "/api/app/heartbeat.php")).toEqual({
            weg: "legacy-oberflaeche",
            pfad: "/api/app/heartbeat.php",
        });
    });

    it("legt für unbekannte Dateien keine neuen Zeilen an", () => {
        expect(legacyPfad("GET", "/api/app/wp-login.php")?.pfad).toBe("/api/app/andere");
        expect(legacyPfad("GET", "/api/app/heartbeat.js")).toBeUndefined();
        expect(legacyPfad("GET", "/api/app/x/heartbeat.php")).toBeUndefined();
    });
});

describe("Posten von „Wer fragt“", () => {
    beforeEach(() => vergissOffene());

    const curl: AnfrageKopf = { methode: "GET", pfad: "/api/route", userAgent: "probe-absender" };

    it("ohne Seite: Herkunft, Kreuzung mit dem Weg und Absender", () => {
        const posten = postenFuer("/api/route", 200, 9, undefined, curl);
        expect(metrik(posten, "herkunft")).toEqual(["ohne_seite"]);
        expect(metrik(posten, "weg_herkunft")).toEqual(["/api/route|ohne_seite"]);
        expect(metrik(posten, "absender")).toEqual(["probe-absender"]);
        expect(metrik(posten, "fremde_seite")).toEqual([]);
    });

    it("die eigene Seite nennt keinen Absender", () => {
        const posten = postenFuer("/api/route", 200, 9, undefined, {
            methode: "GET",
            pfad: "/api/route",
            secFetchSite: "same-origin",
            userAgent: "Mozilla/5.0 (X11)",
        });
        expect(metrik(posten, "herkunft")).toEqual(["eigene_seite"]);
        expect(metrik(posten, "absender")).toEqual([]);
    });

    it("eine fremde Seite zählt mit Hostnamen und Absender", () => {
        const posten = postenFuer("/api/search", 200, 9, undefined, {
            methode: "GET",
            pfad: "/api/search",
            referer: "https://example.com/seite?q=geheim",
            userAgent: "Mozilla/5.0",
        });
        expect(metrik(posten, "fremde_seite")).toEqual(["example.com"]);
        expect(metrik(posten, "absender")).toEqual(["Browser"]);
        expect(JSON.stringify(posten)).not.toContain("geheim");
    });

    it("zählt weder den Takt noch die Anmeldetür der Stage", () => {
        expect(metrik(postenFuer("/api/besuch/ping", 204, 9, undefined, curl), "herkunft")).toEqual([]);
        expect(metrik(postenFuer("/api/auth/gate", 204, 9, undefined, curl), "herkunft")).toEqual([]);
    });

    it("nennt die alten Pfade mit Namen statt `unbekannt`, in der Zone `uebrige`", () => {
        const posten = postenFuer(undefined, 404, 9, "not_found", {
            methode: "POST",
            pfad: "/api/route/",
            userAgent: "Efferd-Hermes/1.0",
        });
        expect(metrik(posten, "anfrage")).toEqual(["POST /api/route/"]);
        expect(metrik(posten, "zone")).toEqual(["uebrige"]);
        expect(metrik(posten, "legacy")).toEqual(["POST /api/route/"]);
        expect(metrik(posten, "fehler")).toEqual(["POST /api/route/|not_found"]);
        expect(metrik(posten, "absender")).toEqual(["Efferd-Hermes"]);
    });

    it("ohne Kopfzeilen bleibt alles beim Alten", () => {
        expect(postenFuer("/api/route", 200, 9).map((eintrag) => eintrag.metric)).toEqual([
            "anfrage",
            "klasse",
            "zone",
            "stunde",
        ]);
    });

    it("🔴 höchstens 50 verschiedene Absender je Tag, darüber `andere`", async () => {
        for (let nummer = 0; nummer < 60; nummer += 1) {
            merkePosten(postenFuer("/api/route", 200, 9, undefined, { ...curl, userAgent: `scanner-${nummer}/1` }));
        }
        merkePosten(postenFuer("/api/route", 200, 9, undefined, { ...curl, userAgent: "scanner-3/2" }));
        const absender = (await geschriebeneZeilen()).filter((zeile) => zeile.metric === "absender");
        expect(absender).toHaveLength(51);
        expect(absender.find((zeile) => zeile.dimension === "andere")?.count).toBe(10);
        // Ein Name von heute bleibt sein Name, auch nach der Grenze.
        expect(absender.find((zeile) => zeile.dimension === "scanner-3")?.count).toBe(2);
    });

    it("🔴 am Server: curl ohne Seite und ein alter Pfad kommen so im Zähler an, Proben dieser Maschine nicht", async () => {
        const app = Fastify();
        zaehleSchnittstellen(app);
        app.get("/api/route", () => ({ ok: true }));
        // Von außen: Hinter Nginx ist `request.ip` der echte Client, hier eine Beispieladresse (RFC 5737).
        const draussen = "203.0.113.5";
        await app.inject({
            method: "GET",
            url: "/api/route?from=Gareth&to=Punin",
            headers: { "user-agent": "curl/8.5" },
            remoteAddress: draussen,
        });
        await app.inject({
            method: "GET",
            url: "/api/route?from=Gareth",
            headers: { "user-agent": "Mozilla/5.0", "sec-fetch-site": "same-origin" },
            remoteAddress: draussen,
        });
        await app.inject({
            method: "GET",
            url: "/api/app/heartbeat.php?sid=abc",
            headers: { referer: "https://avesmaps.de/" },
            remoteAddress: draussen,
        });
        // Postflight von dieser Maschine (Stage-Probe 2026-11-11: 24 × `node`): zählt als Weg, nicht bei „Wer fragt“.
        await app.inject({
            method: "GET",
            url: "/api/route",
            headers: { "user-agent": "node" },
            remoteAddress: "127.0.0.1",
        });
        const zeilen = await geschriebeneZeilen();
        expect(metrik(zeilen, "weg_herkunft").sort()).toEqual([
            "/api/route|eigene_seite",
            "/api/route|ohne_seite",
            "legacy-oberflaeche|eigene_seite",
        ]);
        expect(metrik(zeilen, "absender")).toEqual(["curl"]);
        expect(zeilen.find((zeile) => zeile.metric === "anfrage" && zeile.dimension === "/api/route")?.count).toBe(3);
        expect(metrik(zeilen, "legacy")).toEqual(["/api/app/heartbeat.php"]);
        const text = JSON.stringify(zeilen);
        for (const verboten of ["Gareth", "Punin", "sid=", "curl/8.5", draussen]) expect(text).not.toContain(verboten);
        await app.close();
    });
});

describe("Die eigene Maschine über ihre öffentliche Adresse", () => {
    beforeEach(() => vergissOffene());

    it("liest API_ZAEHLER_EIGENE_ADRESSEN, ein ungültiger Eintrag fällt weg statt den Start anzuhalten", () => {
        expect(
            apiZaehlerEigeneAdressen({ API_ZAEHLER_EIGENE_ADRESSEN: " 198.51.100.7, 2001:DB8::1 ,kaputt,, " }),
        ).toEqual({
            eigeneAdressen: ["198.51.100.7", "2001:DB8::1"],
            verworfen: 1,
        });
        expect(apiZaehlerEigeneAdressen({})).toEqual({ eigeneAdressen: [], verworfen: 0 });
    });

    it("🔴 die Statusprobe über die öffentliche Adresse zählt als Weg, nicht bei „Wer fragt“ (Claudio 2026-11-11)", async () => {
        const app = Fastify();
        zaehleSchnittstellen(app, ["198.51.100.7", "2001:DB8::1"]);
        app.get("/api/admin/system", () => ({ ok: true }));
        const probe = { method: "GET" as const, url: "/api/admin/system", headers: { "user-agent": "curl/8.5.0" } };
        await app.inject({ ...probe, remoteAddress: "198.51.100.7" });
        await app.inject({ ...probe, remoteAddress: "::ffff:198.51.100.7" });
        await app.inject({ ...probe, remoteAddress: "2001:db8::1" });
        await app.inject({ ...probe, remoteAddress: "203.0.113.5" });
        const zeilen = await geschriebeneZeilen();
        expect(zeilen.find((zeile) => zeile.metric === "anfrage")?.count).toBe(4);
        expect(zeilen.filter((zeile) => zeile.metric === "absender")).toEqual([
            expect.objectContaining({ dimension: "curl", count: 1 }),
        ]);
        await app.close();
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Wer fragt gegen echtes PostgreSQL", { timeout: 60_000 }, () => {
    let sql: Database;

    beforeAll(async () => {
        sql = createDatabase(testDatabaseUrl!);
        await migrate(sql);
        await sql`DELETE FROM api_metric`;
        vergissOffene();
    });

    afterAll(async () => {
        await sql`DELETE FROM api_metric`;
        await sql.end();
    });

    it("ohne Zählung kein Abschnitt", async () => {
        merkePosten(postenFuer("/api/route", 200, 9));
        await schreibeSchnittstellen(sql);
        expect((await leseApiZahlen(sql, 30)).werFragt).toBeUndefined();
    });

    it("liest Herkunft, Absender mit Tagen, Route von Dritten, Legacy und Drossel je Tag", async () => {
        await sql`DELETE FROM api_metric`;
        await sql`
            INSERT INTO api_metric (day, hour, metric, dimension, count) VALUES
                (CURRENT_DATE - 2, 24, 'herkunft', 'ohne_seite', 5),
                (CURRENT_DATE - 2, 24, 'weg_herkunft', '/api/route|ohne_seite', 4),
                (CURRENT_DATE - 2, 24, 'weg_herkunft', '/api/routenplaner|ohne_seite', 1),
                (CURRENT_DATE - 2, 24, 'absender', 'dsaworld-route-check', 4),
                (CURRENT_DATE - 2, 24, 'legacy', '/api/app/heartbeat.php', 7),
                (CURRENT_DATE, 24, 'herkunft', 'eigene_seite', 20),
                (CURRENT_DATE, 24, 'herkunft', 'ohne_seite', 3),
                (CURRENT_DATE, 24, 'weg_herkunft', '/api/route|eigene_seite', 20),
                (CURRENT_DATE, 24, 'weg_herkunft', '/api/route/waypoints|ohne_seite', 3),
                (CURRENT_DATE, 24, 'absender', 'dsaworld-route-check', 3),
                (CURRENT_DATE, 24, 'drossel', 'reise', 2),
                (CURRENT_DATE, 24, 'drossel', 'reise|dsaworld-route-check', 2)
        `;
        const werFragt = (await leseApiZahlen(sql, 30)).werFragt!;
        expect(werFragt.herkunft).toEqual([
            { name: "eigene_seite", wert: 20 },
            { name: "ohne_seite", wert: 8 },
        ]);
        // Die Achse beginnt am ersten gezählten Tag, nicht 30 Tage vorher.
        expect(werFragt.tage).toHaveLength(3);
        expect(werFragt.routeVonDritten).toEqual([4, 0, 3]);
        expect(werFragt.legacy).toEqual([7, 0, 0]);
        expect(werFragt.drossel).toEqual([0, 0, 2]);
        expect(werFragt.absender).toEqual([
            { name: "dsaworld-route-check", wert: 7, erster: werFragt.tage[0], letzter: werFragt.tage[2] },
        ]);
        expect(werFragt.wegeVonAussen[0]).toEqual({ name: "/api/route", wert: 4 });
        expect(werFragt.legacyPfade).toEqual([{ name: "/api/app/heartbeat.php", wert: 7 }]);
        expect(werFragt.drosselZonen).toEqual([{ name: "reise", wert: 2 }]);
        expect(werFragt.drosselAbsender).toEqual([{ name: "reise|dsaworld-route-check", wert: 2 }]);
    });
});
