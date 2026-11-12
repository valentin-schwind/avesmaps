import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    alsText,
    holeOeffentlicheSeite,
    istAbrufbar,
    istGesperrteIp,
    pruefendesLookup,
} from "../src/http/oeffentlicher-abruf.ts";

/**
 * Der Abruf einer fremden Seite (WI-0277). Problemfälle: Der Server fragt sich selbst oder das Metadatenziel der Cloud (SSRF); eine Weiterleitung führt um die Prüfung herum; ein Name zeigt nach innen; eine Seite hält den Abruf
 * ewig offen oder liefert ohne Ende; ein alter Zeichensatz kommt als Zeichensalat an.
 */

describe("Die Prüfung: kein Weg nach innen", () => {
    it.each([
        "127.0.0.1",
        "127.1.2.3",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.100.100.100",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "::",
        "fe80::1",
        "fd00::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "kein.ip",
        "",
    ])("%s ist gesperrt", (ip) => {
        expect(istGesperrteIp(ip)).toBe(true);
    });

    it.each(["85.215.1.1", "1.1.1.1", "2a01:238:4000::1", "::ffff:85.215.1.1"])("%s ist öffentlich", (ip) => {
        expect(istGesperrteIp(ip)).toBe(false);
    });

    it.each([
        "http://localhost/",
        "http://localhost.localdomain/",
        "http://127.0.0.1/",
        "http://2130706433/",
        "http://0x7f.0.0.1/",
        "http://017700000001/",
        "http://[::1]/",
        "http://[::ffff:7f00:1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://192.168.1.1/",
        "http://service.internal/",
        "http://drucker.local/",
        "http://einname/",
        "https://example.org:5432/",
        "https://example.org:22/",
        "https://nutzer:geheim@example.org/",
        "ftp://example.org/",
        "file:///etc/passwd",
    ])("%s wird nicht gefragt", (adresse) => {
        expect(istAbrufbar(new URL(adresse))).toBe(false);
    });

    it.each([
        "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen",
        "http://westlande.de/apfeldorn",
        "https://example.org:443/seite",
        "http://example.org:80/",
    ])("%s darf gefragt werden", (adresse) => {
        expect(istAbrufbar(new URL(adresse))).toBe(true);
    });

    it("🔴 ein Name, der nach innen zeigt, verbindet nicht", async () => {
        const fehler = await new Promise<NodeJS.ErrnoException | null>((fertig) => {
            pruefendesLookup("localhost", { all: true }, (grund) => {
                fertig(grund);
            });
        });
        expect(fehler?.code).toBe("ENOTPUBLIC");
    });

    it("die eigene Adresse wird gar nicht erst gefragt", async () => {
        expect(await holeOeffentlicheSeite("http://127.0.0.1/")).toEqual({ art: "gesperrt" });
        expect(await holeOeffentlicheSeite("keine adresse")).toEqual({ art: "gesperrt" });
    });
});

describe("Der Abruf gegen einen Server auf dem eigenen Rechner", () => {
    let server: Server;
    let basis: string;
    /** Nur dieser Testserver ist erlaubt, alles andere geht durch die echte Prüfung. */
    let erlaubt: (url: URL) => boolean;
    const offen = new Set<NodeJS.Timeout>();

    beforeAll(async () => {
        server = createServer((anfrage, antwort) => {
            switch (anfrage.url) {
                case "/seite":
                    antwort.setHeader("content-type", "text/html; charset=utf-8");
                    antwort.end("<html><title>Flüsse</title></html>");
                    return;
                case "/umweg":
                    antwort.writeHead(302, { location: "/seite" });
                    antwort.end();
                    return;
                case "/nach-innen":
                    antwort.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
                    antwort.end();
                    return;
                case "/kreis":
                    antwort.writeHead(301, { location: "/kreis" });
                    antwort.end();
                    return;
                case "/pdf":
                    antwort.setHeader("content-type", "application/pdf");
                    antwort.end("%PDF-1.7");
                    return;
                case "/weg":
                    antwort.statusCode = 404;
                    antwort.setHeader("content-type", "text/html");
                    antwort.end("<h1>Nicht gefunden</h1>");
                    return;
                case "/haengt":
                    return;
                case "/ohne-ende": {
                    antwort.setHeader("content-type", "text/html");
                    const takt = setInterval(() => antwort.write("x".repeat(4096)), 1);
                    offen.add(takt);
                    antwort.on("close", () => {
                        clearInterval(takt);
                        offen.delete(takt);
                    });
                    return;
                }
                default:
                    antwort.statusCode = 500;
                    antwort.end();
            }
        });
        await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
        const port = (server.address() as AddressInfo).port;
        basis = `http://127.0.0.1:${String(port)}`;
        erlaubt = (url) => url.port === String(port) || istAbrufbar(url);
    });

    afterAll(async () => {
        for (const takt of offen) clearInterval(takt);
        server.closeAllConnections();
        await new Promise((fertig) => server.close(fertig));
    });

    it("eine Seite: Status und Text", async () => {
        expect(await holeOeffentlicheSeite(`${basis}/seite`, { istErlaubt: erlaubt })).toEqual({
            art: "antwort",
            status: 200,
            html: "<html><title>Flüsse</title></html>",
        });
    });

    it("eine Weiterleitung wird verfolgt", async () => {
        const abruf = await holeOeffentlicheSeite(`${basis}/umweg`, { istErlaubt: erlaubt });
        expect(abruf).toMatchObject({ art: "antwort", status: 200 });
    });

    it("🔴 eine Weiterleitung nach innen wird nicht verfolgt", async () => {
        expect(await holeOeffentlicheSeite(`${basis}/nach-innen`, { istErlaubt: erlaubt })).toEqual({
            art: "gesperrt",
        });
    });

    it("eine Weiterleitung im Kreis endet", async () => {
        expect(await holeOeffentlicheSeite(`${basis}/kreis`, { istErlaubt: erlaubt })).toEqual({
            art: "keine_antwort",
        });
    });

    it("kein HTML: erreichbar, aber der Rumpf wird nicht gelesen", async () => {
        expect(await holeOeffentlicheSeite(`${basis}/pdf`, { istErlaubt: erlaubt })).toEqual({
            art: "antwort",
            status: 200,
        });
    });

    it("ein Fehlerstatus kommt ohne Rumpf zurück", async () => {
        expect(await holeOeffentlicheSeite(`${basis}/weg`, { istErlaubt: erlaubt })).toEqual({
            art: "antwort",
            status: 404,
        });
    });

    it("🔴 eine Seite, die nicht antwortet, hält den Abruf nicht auf", async () => {
        const start = Date.now();
        expect(await holeOeffentlicheSeite(`${basis}/haengt`, { istErlaubt: erlaubt, zeitMs: 150 })).toEqual({
            art: "keine_antwort",
        });
        expect(Date.now() - start).toBeLessThan(2000);
    });

    it("🔴 eine Seite ohne Ende wird an der Größengrenze abgeschnitten", async () => {
        const abruf = await holeOeffentlicheSeite(`${basis}/ohne-ende`, {
            istErlaubt: erlaubt,
            maxBytes: 16 * 1024,
            zeitMs: 3000,
        });
        expect(abruf.art).toBe("antwort");
        if (abruf.art === "antwort") {
            expect(abruf.html?.length).toBeGreaterThanOrEqual(16 * 1024);
            expect(abruf.html?.length).toBeLessThan(64 * 1024);
        }
    });
});

describe("Der Zeichensatz", () => {
    const latin1 = Buffer.from("<h1>Flüsse und Seen</h1>", "latin1");

    it("aus dem Kopf", () => {
        expect(alsText(latin1, "text/html; charset=ISO-8859-1")).toBe("<h1>Flüsse und Seen</h1>");
    });

    it("aus dem Meta-Tag", () => {
        const seite = Buffer.from('<meta charset="iso-8859-1"><h1>Flüsse</h1>', "latin1");
        expect(alsText(seite, "text/html")).toContain("Flüsse");
    });

    it("🔴 eine alte Seite ohne Angabe, die als UTF-8 nicht aufgeht, ist kein Zeichensalat", () => {
        expect(alsText(latin1, "text/html")).toBe("<h1>Flüsse und Seen</h1>");
    });

    it("ein unbekannter Name bricht nichts", () => {
        expect(alsText(Buffer.from("<h1>Flüsse</h1>"), "text/html; charset=erfunden")).toContain("Fl");
    });
});
