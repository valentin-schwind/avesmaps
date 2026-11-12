import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    abgebildet,
    aufGrenze,
    herkunftDomain,
    importiereRohabzug,
    kartenName,
    leseKartenNamen,
    zeileLesen,
    type KartenNamen,
    type ZielZeile,
} from "../src/besucher/legacy-roh-import.ts";
import { zaehle, KEINE_STUNDE } from "../src/besucher/zaehler.ts";

/**
 * Legacys Ausprägungen übernehmen (WI-0151). Die Fälle sind die beiden Regeln des Betreibers vom 2026-10-14 und die zwei Fallen
 * aus Claudios Vorarbeit: der Tageswert und die Überschneidung mit der eigenen Messreihe.
 *
 * 🔴 Die echte Abzugsdatei liegt nicht im Repository (Suchbegriffe von Besuchern). Die Zeilen hier sind erfunden, tragen aber
 * genau das Format aus `2026-10-14-legacy-rohexport-da-an-claudia.md` §2.
 */

const KARTE: KartenNamen = new Map([
    ["gareth", "Gareth"],
    ["festum", "Festum"],
    ["reichsstrasse 2", "Reichsstraße 2"],
    ["das liebliche feld", "Das Liebliche Feld"],
]);

const roh = (tag: string, stunde: string, sorte: string, metrik: string, auspraegung: string, anzahl: number): string =>
    [tag, stunde, sorte, metrik, auspraegung, String(anzahl)].join("\t");

const KOPF = "day\thour\tactor_type\tmetric\tdimension\tcount";

describe("Eine Zeile des Abzugs lesen", () => {
    it("liest die sechs Felder und nimmt NULL als „keine Stunde“", () => {
        expect(zeileLesen(roh("2026-07-01", "NULL", "visitor", "country", "DE", 12))).toEqual({
            day: "2026-07-01",
            hour: undefined,
            actorType: "visitor",
            metric: "country",
            dimension: "DE",
            count: 12,
        });
        expect(zeileLesen(roh("2026-07-01", "14", "editor", "pageview", "NULL", 3))).toMatchObject({
            hour: 14,
            actorType: "editor",
            dimension: "",
        });
    });

    it("🪤 entmaskiert erst nach dem Trennen: ein Tabulator im Wert steht als `\\t` da", () => {
        const zeile = zeileLesen(roh("2026-07-01", "NULL", "visitor", "search", "Gareth\\tStadt", 1));
        expect(zeile?.dimension).toBe("Gareth\tStadt");
        expect(zeileLesen(roh("2026-07-01", "NULL", "visitor", "search", "Pfad\\\\Name", 1))?.dimension).toBe(
            "Pfad\\Name",
        );
    });

    it("verwirft Kopfzeile, leere Zeile und Kaputtes, statt zu raten", () => {
        expect(zeileLesen(KOPF)).toBeUndefined();
        expect(zeileLesen("")).toBeUndefined();
        expect(zeileLesen("2026-07-01\tNULL\tvisitor\tcountry")).toBeUndefined();
        expect(zeileLesen(roh("01.07.2026", "NULL", "visitor", "country", "DE", 1))).toBeUndefined();
        expect(zeileLesen(roh("2026-07-01", "NULL", "spider", "country", "DE", 1))).toBeUndefined();
        expect(zeileLesen(roh("2026-07-01", "25", "visitor", "country", "DE", 1))).toBeUndefined();
        expect(zeileLesen(roh("2026-07-01", "NULL", "visitor", "country", "DE", -1))).toBeUndefined();
        expect(zeileLesen("2026-07-01\tNULL\tvisitor\tcountry\tDE\tviele")).toBeUndefined();
    });
});

describe("Eine Herkunft wird auf die Domäne gekürzt", () => {
    it("🔴 keine vollständige Adresse: Pfad und Parameter fallen weg", () => {
        expect(herkunftDomain("https://www.google.de/search?q=gareth+aventurien&oq=gareth")).toBe("Google");
        expect(herkunftDomain("https://de.wikipedia.org/wiki/Aventurien?action=edit")).toBe("de.wikipedia.org");
        expect(herkunftDomain("https://forum.example.org/thread/7?p=2#antwort")).toBe("forum.example.org");
    });

    it("kommt ohne Schema, mit Port und mit Unterdomäne zurecht", () => {
        expect(herkunftDomain("google.de/search?q=x")).toBe("Google");
        expect(herkunftDomain("example.org:8080/weg")).toBe("example.org");
        expect(herkunftDomain("http://forum.example.org:8443/thread/7")).toBe("forum.example.org");
        expect(herkunftDomain("WWW.Ecosia.ORG/suche")).toBe("Ecosia");
        expect(herkunftDomain("https://example.org./")).toBe("example.org");
    });

    it("🔴 Müll, der keine Adresse ist, fällt weg - und eine leere Herkunft erfindet keinen Besuch", () => {
        for (const wert of [
            "",
            "   ",
            "(unknown)",
            "localhost",
            "localhost:5173/x",
            "192.168.0.7/x",
            "android-app://com.x",
        ]) {
            expect(herkunftDomain(wert)).toBeUndefined();
        }
    });

    it("nennt dieselben Körbe wie der Zählpfad: `direkt` und `intern`", () => {
        expect(herkunftDomain("direct")).toBe("direkt");
        expect(herkunftDomain("(none)")).toBe("direkt");
        expect(herkunftDomain("https://www.avesmaps.de/karte")).toBe("intern");
        expect(herkunftDomain("avesmaps.de")).toBe("intern");
    });
});

describe("Ein Suchbegriff nur mit Kartenbezug", () => {
    it("🔴 ein Begriff ohne Kartenbezug kommt nicht an", () => {
        expect(kartenName("Garteh", KARTE)).toBeUndefined();
        expect(kartenName("wie komme ich nach gareth", KARTE)).toBeUndefined();
        expect(kartenName("", KARTE)).toBeUndefined();
        expect(kartenName("???", KARTE)).toBeUndefined();
        // 🔴 Kein Teiltreffer: sonst wäre jeder Anfang eines Namens ein Treffer.
        expect(kartenName("gar", KARTE)).toBeUndefined();
        expect(kartenName("Gareth und Festum", KARTE)).toBeUndefined();
    });

    it("Groß- und Kleinschreibung, Akzente und Satzzeichen sind egal; gespeichert wird der Name der Karte", () => {
        expect(kartenName("GARETH", KARTE)).toBe("Gareth");
        expect(kartenName("  gareth ", KARTE)).toBe("Gareth");
        expect(kartenName("Gareth!", KARTE)).toBe("Gareth");
        expect(kartenName("reichsstrasse 2", KARTE)).toBe("Reichsstraße 2");
        expect(kartenName("Reichsstraße 2", KARTE)).toBe("Reichsstraße 2");
        expect(kartenName("das liebliche feld", KARTE)).toBe("Das Liebliche Feld");
    });
});

describe("Die Abbildung auf unser Schema", () => {
    const bilde = (metrik: string, auspraegung: string) =>
        abgebildet(zeileLesen(roh("2026-07-01", "NULL", "visitor", metrik, auspraegung, 5))!, KARTE);

    it("bildet die Metriken aus Claudios Tabelle ab", () => {
        expect(bilde("country", "de")).toMatchObject({ metric: "land", dimension: "DE" });
        expect(bilde("language", "de-DE")).toMatchObject({ metric: "sprache", dimension: "de" });
        expect(bilde("language", "*")).toMatchObject({ metric: "sprache", dimension: "ohne" });
        expect(bilde("device", "desktop")).toMatchObject({ metric: "geraet", dimension: "rechner" });
        expect(bilde("device", "mobil")).toMatchObject({ metric: "geraet", dimension: "telefon" });
        expect(bilde("device", "tablet")).toMatchObject({ metric: "geraet", dimension: "tablet" });
        expect(bilde("transport", "groupFoot")).toMatchObject({ metric: "transport", dimension: "groupFoot" });
        expect(bilde("route_option", "kürzeste")).toMatchObject({ metric: "route_option", dimension: "kuerzeste" });
        expect(bilde("route_option", "schnellste")).toMatchObject({ metric: "route_option", dimension: "schnellste" });
        expect(bilde("map_mode", "political")).toMatchObject({ metric: "map_mode", dimension: "political" });
        expect(bilde("map_style", "stylized")).toMatchObject({ metric: "map_style", dimension: "stylized" });
        expect(bilde("display_toggle", "gebaeude:on")).toMatchObject({ metric: "display_toggle" });
        expect(bilde("eco_kind", "wald")).toMatchObject({ metric: "eco_kind", dimension: "wald" });
        expect(bilde("route_waypoint", "festum")).toMatchObject({ metric: "route_waypoint", dimension: "Festum" });
    });

    it("die Region nur als Bundeslandkennung, alles Fremde fällt weg", () => {
        expect(bilde("region", "North Rhine-Westphalia")).toMatchObject({ metric: "region", dimension: "NW" });
        expect(bilde("region", "Bayern")).toMatchObject({ metric: "region", dimension: "BY" });
        expect(bilde("region", "DE-HH")).toMatchObject({ metric: "region", dimension: "HH" });
        expect(bilde("region", "Tirol")).toBeUndefined();
    });

    it("🪤 die Verweildauer kommt in unser Korbraster, nicht roh (die Positivliste verlangt einen Buchstaben)", () => {
        expect(bilde("dwell", "00040")).toMatchObject({ metric: "dauer", dimension: "00040" });
        expect(bilde("dwell", "00045")).toMatchObject({ metric: "dauer", dimension: "00040" });
        expect(bilde("dwell", "99999")).toMatchObject({ metric: "dauer", dimension: "43200" });
        expect(bilde("dwell", "viel")).toBeUndefined();
    });

    it("🔴 pageview, unique und route ohne Ausprägung - sonst zählte derselbe Tag zweimal", () => {
        expect(bilde("pageview", "/karte")).toMatchObject({ metric: "pageview", dimension: "" });
        expect(bilde("unique", "")).toMatchObject({ metric: "unique", dimension: "" });
        expect(bilde("route", "Gareth → Festum")).toMatchObject({ metric: "route", dimension: "" });
    });

    it("eine Metrik ohne Ziel kommt nicht an", () => {
        for (const metrik of ["dwell_seconds", "dwell_sessions", "map_load", "was_auch_immer"]) {
            expect(bilde(metrik, "17")).toBeUndefined();
        }
    });

    it("🔴 verwirft eine Ausprägung, statt sie zu kürzen", () => {
        expect(bilde("country", "Deutschland")).toBeUndefined();
        expect(bilde("transport", "<script>alert(1)</script>")).toBeUndefined();
        expect(bilde("map_mode", "")).toBeUndefined();
        expect(bilde("search", "Garteh")).toBeUndefined();
    });
});

describe("Die Obergrenze je Tag, Sorte und Metrik", () => {
    const zeile = (dimension: string, count: number): ZielZeile => ({
        day: "2026-07-01",
        actorType: "visitor",
        metric: "route_waypoint",
        dimension,
        count,
    });

    it("💣 bucht alles jenseits der Grenze auf `übrige` und behält die Summe", () => {
        const behalten = aufGrenze([zeile("Gareth", 9), zeile("Festum", 5), zeile("Khunchom", 2), zeile("Riva", 1)], 2);
        expect(behalten.map((z) => [z.dimension, z.count])).toEqual([
            ["Gareth", 9],
            ["Festum", 5],
            ["übrige", 3],
        ]);
        expect(behalten.reduce((summe, z) => summe + z.count, 0)).toBe(17);
    });

    it("🪤 addiert zu einem vorhandenen `übrige`, statt es ein zweites Mal anzulegen", () => {
        const behalten = aufGrenze([zeile("übrige", 9), zeile("Gareth", 5), zeile("Festum", 2)], 2);
        expect(behalten.filter((z) => z.dimension === "übrige")).toHaveLength(1);
        expect(behalten.find((z) => z.dimension === "übrige")?.count).toBe(11);
        expect(behalten.reduce((summe, z) => summe + z.count, 0)).toBe(16);
    });

    it("zählt Metriken ohne Ausprägung nicht gegen die Grenze und lässt kleine Gruppen in Ruhe", () => {
        const ohne = { ...zeile("", 7), metric: "pageview" };
        const behalten = aufGrenze([ohne, zeile("Gareth", 1), zeile("Festum", 1)], 2);
        expect(behalten).toHaveLength(3);
        expect(behalten.some((z) => z.dimension === "übrige")).toBe(false);
    });

    it("trennt nach Tag und Sorte: derselbe Name an zwei Tagen ist zweimal da", () => {
        const behalten = aufGrenze(
            [
                zeile("Gareth", 3),
                { ...zeile("Festum", 1), day: "2026-07-02" },
                { ...zeile("Riva", 1), actorType: "editor" },
            ],
            1,
        );
        expect(behalten).toHaveLength(3);
        expect(behalten.some((z) => z.dimension === "übrige")).toBe(false);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Der Import gegen echtes PostgreSQL", { timeout: 60_000 }, () => {
    let sql: Database;
    let ordner: string;
    let abzug: string;

    beforeAll(async () => {
        sql = createDatabase(testDatabaseUrl!);
        await migrate(sql);
        await sql`DELETE FROM visitor_metric`;
        ordner = await mkdtemp(join(tmpdir(), "wi-0151-"));
        abzug = join(ordner, "roh.tsv.gz");
        const zeilen = [
            KOPF,
            // Derselbe Tag in zwei Stunden: Legacys Ereigniszeilen müssen zum Tageswert verdichtet werden.
            roh("2026-07-01", "9", "visitor", "country", "DE", 4),
            roh("2026-07-01", "NULL", "visitor", "country", "DE", 6),
            roh("2026-07-01", "NULL", "visitor", "referrer", "https://www.google.de/search?q=gareth", 3),
            roh("2026-07-01", "NULL", "visitor", "search", "gareth", 2),
            roh("2026-07-01", "NULL", "visitor", "search", "Garteh", 9),
            roh("2026-07-01", "NULL", "editor", "device", "desktop", 1),
            roh("2026-07-01", "NULL", "visitor", "dwell_seconds", "4200", 1),
            roh("2026-07-02", "NULL", "visitor", "pageview", "NULL", 50),
            "kaputt",
        ];
        await writeFile(abzug, gzipSync(Buffer.from(`${zeilen.join("\n")}\n`, "utf8")));
    });

    afterAll(async () => {
        await sql`DELETE FROM visitor_metric`;
        await sql.end();
        await rm(ordner, { recursive: true, force: true });
    });

    it("die Namen der Karte kommen aus denselben Quellen wie die Suche", async () => {
        const namen = await leseKartenNamen(sql);
        expect(namen).toBeInstanceOf(Map);
        for (const [schluessel, name] of namen) {
            expect(schluessel).toBe(schluessel.toLowerCase());
            expect(name).not.toBe("");
        }
    });

    it("🔴 der Tageswert landet richtig: jede Zeile trägt hour = 24", async () => {
        const ergebnis = await importiereRohabzug(sql, abzug, { namen: KARTE });
        expect(ergebnis.gelesen).toBe(8);
        expect(ergebnis.kaputt).toBe(1);
        expect(ergebnis.von).toBe("2026-07-01");
        expect(ergebnis.bis).toBe("2026-07-02");
        const [stunden] = await sql<{ tag: string; stunde: string }[]>`
            SELECT count(*) FILTER (WHERE hour = ${KEINE_STUNDE})::text AS tag,
                   count(*) FILTER (WHERE hour <> ${KEINE_STUNDE})::text AS stunde
            FROM visitor_metric`;
        expect(stunden?.stunde).toBe("0");
        expect(Number(stunden?.tag)).toBe(ergebnis.geschrieben);
        // Die beiden Zeilen desselben Tages sind EINE Zeile mit der Summe, nicht zwei.
        const [land] = await sql<{ count: string }[]>`
            SELECT count::text FROM visitor_metric WHERE metric = 'land' AND day = '2026-07-01'`;
        expect(land?.count).toBe("10");
    });

    it("🔴 ein Suchbegriff ohne Kartenbezug kommt nicht an", async () => {
        const suche = await sql<{ dimension: string }[]>`SELECT dimension FROM visitor_metric WHERE metric = 'search'`;
        expect(suche.map((zeile) => zeile.dimension)).toEqual(["Gareth"]);
        // Auch nicht als Sammelzeile, und kein Wort davon irgendwo in der Tabelle.
        const [spur] = await sql<{ anzahl: string }[]>`
            SELECT count(*)::text AS anzahl FROM visitor_metric WHERE dimension ILIKE '%garteh%'`;
        expect(spur?.anzahl).toBe("0");
    });

    it("🔴 eine Herkunft steht als Domäne da, nie als Adresse", async () => {
        const einstieg = await sql<
            { dimension: string }[]
        >`SELECT dimension FROM visitor_metric WHERE metric = 'einstieg'`;
        expect(einstieg.map((zeile) => zeile.dimension)).toEqual(["Google"]);
        const [spur] = await sql<{ anzahl: string }[]>`
            SELECT count(*)::text AS anzahl FROM visitor_metric WHERE dimension LIKE '%/%' OR dimension LIKE '%?%'`;
        expect(spur?.anzahl).toBe("0");
    });

    it("eine Metrik ohne Ziel hinterlässt keine Zeile", async () => {
        const [fremd] = await sql<{ anzahl: string }[]>`
            SELECT count(*)::text AS anzahl FROM visitor_metric WHERE metric IN ('dwell_seconds', 'dwell_sessions', 'map_load')`;
        expect(fremd?.anzahl).toBe("0");
    });

    it("🔴 ein zweiter Lauf ändert nichts", async () => {
        const vorher = await sql<{ day: string; metric: string; dimension: string; count: string }[]>`
            SELECT day::text, metric, dimension, count::text FROM visitor_metric ORDER BY day, metric, dimension`;
        const zweiter = await importiereRohabzug(sql, abzug, { namen: KARTE });
        expect(zweiter.geschrieben).toBe(0);
        expect(zweiter.zeilen).toBeGreaterThan(0);
        const nachher = await sql<{ day: string; metric: string; dimension: string; count: string }[]>`
            SELECT day::text, metric, dimension, count::text FROM visitor_metric ORDER BY day, metric, dimension`;
        expect(nachher).toEqual(vorher);
    });

    it("🔴 überschreibt keine vorhandene Zeile: die eigene Zählung gewinnt", async () => {
        await sql`DELETE FROM visitor_metric`;
        // Erst die eigene Messreihe für denselben Tag, dann der Import.
        await zaehle(sql, "visitor", [{ metrik: "pageview", dimension: "", stunde: KEINE_STUNDE }], "2026-07-02");
        const ergebnis = await importiereRohabzug(sql, abzug, { namen: KARTE });
        const [pageview] = await sql<{ count: string; anzahl: string }[]>`
            SELECT max(count)::text AS count, count(*)::text AS anzahl
            FROM visitor_metric WHERE metric = 'pageview' AND day = '2026-07-02'`;
        // Eine Zeile, und sie trägt weiter die 1 der eigenen Zählung - nicht die 50 aus dem Abzug.
        expect(pageview?.anzahl).toBe("1");
        expect(pageview?.count).toBe("1");
        expect(ergebnis.geschrieben).toBeGreaterThan(0);
    });

    it("der Trockenlauf nennt dieselben Zahlen und schreibt nichts", async () => {
        await sql`DELETE FROM visitor_metric`;
        const trocken = await importiereRohabzug(sql, abzug, { namen: KARTE, trocken: true });
        const [leer] = await sql<{ anzahl: string }[]>`SELECT count(*)::text AS anzahl FROM visitor_metric`;
        expect(leer?.anzahl).toBe("0");
        expect(trocken.geschrieben).toBe(0);
        const scharf = await importiereRohabzug(sql, abzug, { namen: KARTE });
        expect(scharf.zeilen).toBe(trocken.zeilen);
        expect(scharf.angeboten).toBe(trocken.angeboten);
        expect(scharf.geschrieben).toBe(trocken.zeilen);
    });
});
