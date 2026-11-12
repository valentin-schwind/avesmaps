import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseZahlen } from "../src/besucher/lesen.ts";
import {
    dauerKorb,
    DIMENSIONEN_JE_METRIK,
    KEINE_STUNDE,
    lebenszeichen,
    raeumeAuf,
    verdichte,
    zaehle,
    zaehleEindeutig,
    zeilenAus,
} from "../src/besucher/zaehler.ts";
import { BESUCH_LISTE_GRENZE, routenPaar } from "@avesmaps3d/shared";
import { createBesucherTakt } from "../src/besucher/takt.ts";
import { importiereLegacyAbzug } from "../src/besucher/legacy-import.ts";
import { tagesKennung } from "../src/besucher/kennung.ts";

/**
 * Zählen und Lesen gegen echtes PostgreSQL (WI-0138; Kap. 11.10: DB-Semantik wird nie gegen einen Ersatz geprüft).
 *
 * Die Fälle sind die Zusagen des Bauplans: Sorten bleiben getrennt, dieselbe Zeile wird hochgezählt statt vervielfacht, eine
 * Tageskennung zählt einmal, der Import ist wiederholbar.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Besucherstatistik: zählen und lesen", { timeout: 60_000 }, () => {
    let sql: Database;

    beforeAll(async () => {
        sql = createDatabase(testDatabaseUrl!);
        await migrate(sql);
        await sql`DELETE FROM visitor_metric`;
        await sql`DELETE FROM visitor_daily_seen`;
        await sql`DELETE FROM visitor_live`;
    });

    afterAll(async () => {
        await sql`DELETE FROM visitor_metric`;
        await sql`DELETE FROM visitor_daily_seen`;
        await sql`DELETE FROM visitor_live`;
        await sql.end();
    });

    it("zählt dieselbe Zeile hoch, statt eine zweite anzulegen (Legacys Stundenfehler)", async () => {
        await zaehle(sql, "visitor", [
            { metrik: "pageview", dimension: "", stunde: 19 },
            { metrik: "geraet", dimension: "rechner", stunde: KEINE_STUNDE },
        ]);
        await zaehle(sql, "visitor", [
            { metrik: "pageview", dimension: "", stunde: 19 },
            { metrik: "geraet", dimension: "rechner", stunde: KEINE_STUNDE },
        ]);
        const zeilen = await sql<{ metric: string; count: string; hour: number }[]>`
            SELECT metric, count::text, hour FROM visitor_metric WHERE actor_type = 'visitor' ORDER BY metric
        `;
        expect(zeilen).toHaveLength(2);
        expect(zeilen.map((zeile) => Number(zeile.count))).toEqual([2, 2]);
        expect(zeilen.find((zeile) => zeile.metric === "geraet")?.hour).toBe(KEINE_STUNDE);
    });

    it("hält die Sorten getrennt: ein Editor taucht in keiner Besucherzahl auf", async () => {
        await zaehle(sql, "editor", [{ metrik: "pageview", dimension: "", stunde: 19 }]);
        await zaehle(sql, "bot", [{ metrik: "pageview", dimension: "", stunde: 19 }]);
        const besucher = await leseZahlen(sql, "visitor", 30, true);
        const editor = await leseZahlen(sql, "editor", 30, true);
        expect(besucher.kennzahlen.aufrufe).toBe(2);
        expect(editor.kennzahlen.aufrufe).toBe(1);
    });

    it("zählt eine Tageskennung einmal am Tag", async () => {
        const kennung = tagesKennung("test-salt", "198.51.100.5", "Browser");
        expect(await zaehleEindeutig(sql, kennung, "visitor")).toBe(true);
        expect(await zaehleEindeutig(sql, kennung, "visitor")).toBe(false);
        const [zeile] = await sql<{ count: string }[]>`
            SELECT count::text FROM visitor_metric WHERE metric = 'unique' AND actor_type = 'visitor'
        `;
        expect(Number(zeile?.count)).toBe(1);
    });

    it("ohne Schlüssel bleibt „eindeutig“ unbekannt statt 0", async () => {
        expect(await zaehleEindeutig(sql, undefined, "visitor")).toBe(false);
        const ohne = await leseZahlen(sql, "visitor", 30, false);
        expect(ohne.kennungAktiv).toBe(false);
        expect(ohne.kennzahlen.eindeutigeMittel).toBeNull();
        expect(ohne.kennzahlen.besterTag).toBeNull();
    });

    it("macht aus einer beendeten Anwesenheit einen Dauerkorb", async () => {
        const kennung = tagesKennung("test-salt", "203.0.113.7", "Browser")!;
        await lebenszeichen(sql, kennung, "visitor", "reading");
        await sql`UPDATE visitor_live SET first_seen = now() - interval '36 minutes', last_seen = now() - interval '6 minutes'`;
        const ergebnis = await raeumeAuf(sql);
        expect(ergebnis.beendet).toBe(1);
        const [zeile] = await sql<{ dimension: string }[]>`
            SELECT dimension FROM visitor_metric WHERE metric = 'dauer'
        `;
        expect(zeile?.dimension).toBe(dauerKorb(1800));
    });

    it("verdichtet seltene Ausprägungen, damit die Tafel nicht wächst", async () => {
        await sql`DELETE FROM visitor_metric WHERE metric = 'route'`;
        const viele = Array.from({ length: DIMENSIONEN_JE_METRIK + 25 }, (_, i) => ({
            metrik: "route",
            dimension: `Ort ${i} nach Ort ${i + 1}`,
            stunde: KEINE_STUNDE,
        }));
        await zaehle(sql, "visitor", viele);
        const verschoben = await verdichte(sql);
        expect(verschoben).toBeGreaterThan(0);
        const zeilen = await sql<{ dimension: string; count: string }[]>`
            SELECT dimension, count::text FROM visitor_metric WHERE metric = 'route' AND day = CURRENT_DATE
        `;
        expect(zeilen.length).toBeLessThanOrEqual(DIMENSIONEN_JE_METRIK + 1);
        const summe = zeilen.reduce((wert, zeile) => wert + Number(zeile.count), 0);
        expect(summe).toBe(viele.length);
        expect(zeilen.some((zeile) => zeile.dimension === "übrige")).toBe(true);
        await sql`DELETE FROM visitor_metric WHERE metric = 'route'`;
    });

    /**
     * 🔴 WI-0157: Kennzahl und Liste kommen aus **einer** Metrik, also muss jede `route`-Zeile genau einmal zählen. Legacys
     * importierte Tage stehen ohne Ausprägung da (107 Zeilen, letzter Tag 2026-10-12), eigene Routen tragen „Start → Ziel“.
     * Die Kennzahl summiert beides, die Liste zeigt nur die benannten - und nichts wird doppelt gezählt.
     */
    it("zählt eine Route mit und eine ohne Ausprägung je einmal in der Kennzahl (WI-0157)", async () => {
        await sql`DELETE FROM visitor_metric WHERE metric = 'route'`;
        await zaehle(sql, "visitor", [
            // Legacys Form: die Metrik steht für sich.
            { metrik: "route", dimension: "", stunde: KEINE_STUNDE },
            { metrik: "route", dimension: "", stunde: KEINE_STUNDE },
            { metrik: "route", dimension: routenPaar(["Gareth", "Punin"])!, stunde: KEINE_STUNDE },
        ]);
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.kennzahlen.routen).toBe(3);
        expect(zahlen.listen.routen.eintraege).toEqual([{ name: "Gareth → Punin", wert: 1 }]);
        await sql`DELETE FROM visitor_metric WHERE metric = 'route'`;
    });

    /**
     * Der Weg einer echten Meldung, von `zeilenAus` bis in die Tabelle: Ohne den Fix aus WI-0157 kommt hier **keine** Zeile an,
     * weil `dimensionErlaubt` die leere Ausprägung bei Art `name` verwarf.
     */
    it("eine Meldung „route“ ohne Ausprägung legt wirklich eine Zeile an (WI-0157)", async () => {
        await sql`DELETE FROM visitor_metric WHERE metric = 'route'`;
        const zeilen = zeilenAus({ ereignisse: [{ metrik: "route" }] });
        expect(await zaehle(sql, "visitor", zeilen)).toBe(true);
        const [zeile] = await sql<{ dimension: string; count: string }[]>`
            SELECT dimension, count::text FROM visitor_metric WHERE metric = 'route' AND actor_type = 'visitor'
        `;
        expect(zeile).toEqual({ dimension: "", count: "1" });
        await sql`DELETE FROM visitor_metric WHERE metric = 'route'`;
    });

    /**
     * 🔴 WI-0159: Sechs Metriken bekamen einen Sender. Dieser Fall geht ihren ganzen Weg - von dem, was der Browser wirklich
     * schickt, über `zeilenAus` und `zaehle` bis in die Liste des Panels. Vor WI-0159 hatte keine von ihnen eine einzige Zeile,
     * und `editor-status.vue` filtert leere Listen heraus: Vier Blöcke blieben dauerhaft leer.
     *
     * Die Werte sind Legacys eigene (Abzug 2026-10-12), damit importierte und eigene Zeilen auf demselben Schlüssel summieren.
     */
    it("die sechs neu gesendeten Metriken kommen bis in ihre Liste (WI-0159)", async () => {
        await sql`DELETE FROM visitor_metric`;
        // Genau die Ereignisse, die die sechs Sender abgeben - einschließlich der drei ohne Ausprägung.
        const zeilen = zeilenAus({
            ereignisse: [
                { metrik: "eco_kind", dimension: "klima" },
                { metrik: "display_toggle", dimension: "toggleRivers:on" },
                { metrik: "display_toggle", dimension: "toggleRivers:on" },
                { metrik: "display_toggle", dimension: "gebaeude:on" },
                // Zwei Reisen über Gareth, eine nach Punin: Die Liste steht nach Häufigkeit, wie Legacys (Gareth 3.617).
                { metrik: "route_waypoint", dimension: "Gareth" },
                { metrik: "route_waypoint", dimension: "Gareth" },
                { metrik: "route_waypoint", dimension: "Punin" },
                { metrik: "flight" },
                { metrik: "profile" },
                { metrik: "play" },
            ],
        });
        expect(await zaehle(sql, "visitor", zeilen)).toBe(true);

        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.ebene.eintraege).toEqual([{ name: "klima", wert: 1 }]);
        expect(zahlen.listen.schalter.eintraege).toEqual([
            { name: "toggleRivers:on", wert: 2 },
            { name: "gebaeude:on", wert: 1 },
        ]);
        expect(zahlen.listen.orte.eintraege).toEqual([
            { name: "Gareth", wert: 2 },
            { name: "Punin", wert: 1 },
        ]);
        // Der Block „3D": vier Zeilen standen hier leer, weil niemand sendete; `tilt` fehlt, weil keine Karte geneigt wurde.
        expect(zahlen.listen.dreid.eintraege).toEqual([
            { name: "flight", wert: 1 },
            { name: "profile", wert: 1 },
            { name: "play", wert: 1 },
        ]);
        await sql`DELETE FROM visitor_metric`;
    });

    /**
     * 🔴 Der zweite Regressionsfall zu WI-0159, und der ältere Fehler: Der Block „3D" wurde mit `liste(summen, "tilt", 1)`
     * gebaut, und `liste` überspringt die leere Ausprägung - zu Recht, denn eine Liste zeigt Ausprägungen. Metriken der Art
     * `leer` haben aber keine, also blieb der Block **immer** leer, auch für `tilt` und `share_create`, die seit WI-0138
     * senden. Sechs neue Sender hätten daran nichts geändert.
     */
    it("der Block „3D“ zeigt auch die beiden alten Sender - er war nie gefüllt (WI-0159)", async () => {
        await sql`DELETE FROM visitor_metric`;
        await zaehle(sql, "visitor", [
            { metrik: "tilt", dimension: "", stunde: KEINE_STUNDE },
            { metrik: "tilt", dimension: "", stunde: KEINE_STUNDE },
            { metrik: "share_create", dimension: "", stunde: KEINE_STUNDE },
        ]);
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.dreid.eintraege).toEqual([
            { name: "in3d", wert: 2 },
            { name: "share_create", wert: 1 },
        ]);
        await sql`DELETE FROM visitor_metric`;
    });

    /**
     * 🔴 WI-0288: Der Block „Wetter“ braucht Sender UND Leser UND Anzeige. Der Leser nimmt die ECHTEN Sendewerte (über `zeilenAus`, nicht von
     * Hand eingefügt), liefert die Verteilungen nach Gerät und Klasse geordnet und nicht nach Häufigkeit, und die Wetterschalter stehen
     * NICHT zugleich unter den übrigen Schaltern.
     */
    it("liefert den Block „Wetter“ geordnet und trennt die Wetterschalter von den übrigen", async () => {
        await sql`DELETE FROM visitor_metric`;
        const sendewerte: [string, string][] = [
            ["wetter_lauf", "rechner"],
            ["wetter_lauf", "rechner"],
            ["wetter_lauf", "telefon"],
            ["wetter_bildrate", "rechner:ab120"],
            ["wetter_bildrate", "rechner:ab120"],
            ["wetter_bildrate", "rechner:20-30"],
            ["wetter_bildrate", "telefon:u10"],
            ["wetter_spitze", "rechner:10-20"],
            ["wetter_start", "rechner:2-3s"],
            ["wetter_aufloesung", "telefon:25"],
            ["wetter_gpu", "rechner:nvidia"],
            ["wetter_gpu", "telefon:adreno"],
            ["wetter_fehler", "telefon:gleitkomma"],
            ["display_toggle", "wetter_wolken:on"],
            ["display_toggle", "wetter_wolken:on"],
            ["display_toggle", "wetter_wolken:off"],
            ["display_toggle", "togglePaths:off"],
        ];
        const zeilen = zeilenAus({
            ereignisse: sendewerte.map(([metrik, dimension]) => ({ metrik, dimension })),
        } as Parameters<typeof zeilenAus>[0]);
        expect(zeilen).toHaveLength(sendewerte.length);
        await zaehle(sql, "visitor", zeilen);
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.wetter.lauf.eintraege).toEqual([
            { name: "rechner", wert: 2 },
            { name: "telefon", wert: 1 },
        ]);
        // Nach Gerät, dann nach Klasse aufsteigend - die häufigste (ab120) steht hinten.
        expect(zahlen.wetter.bildrate.eintraege).toEqual([
            { name: "rechner:20-30", wert: 1 },
            { name: "rechner:ab120", wert: 2 },
            { name: "telefon:u10", wert: 1 },
        ]);
        expect(zahlen.wetter.spitze.eintraege).toEqual([{ name: "rechner:10-20", wert: 1 }]);
        expect(zahlen.wetter.start.eintraege).toEqual([{ name: "rechner:2-3s", wert: 1 }]);
        expect(zahlen.wetter.aufloesung.eintraege).toEqual([{ name: "telefon:25", wert: 1 }]);
        expect(zahlen.wetter.gpu.eintraege).toEqual([
            { name: "rechner:nvidia", wert: 1 },
            { name: "telefon:adreno", wert: 1 },
        ]);
        expect(zahlen.wetter.fehler.eintraege).toEqual([{ name: "telefon:gleitkomma", wert: 1 }]);
        expect(zahlen.wetter.schalter.eintraege).toEqual([
            { name: "wetter_wolken:on", wert: 2 },
            { name: "wetter_wolken:off", wert: 1 },
        ]);
        expect(zahlen.listen.schalter.eintraege).toEqual([{ name: "togglePaths:off", wert: 1 }]);
        await sql`DELETE FROM visitor_metric`;
    });

    it("liefert den Block „Wetter“ leer, solange nichts gemeldet wurde", async () => {
        await sql`DELETE FROM visitor_metric`;
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        for (const liste of Object.values(zahlen.wetter)) expect(liste).toEqual({ eintraege: [], gesamt: 0 });
    });

    /** WI-0286: `tilt` zählt je Seitenaufruf einmal, also teilt es die Aufrufe auf. Was bleibt, blieb flach. */
    it("teilt die Seitenaufrufe in 2D und 3D auf", async () => {
        await sql`DELETE FROM visitor_metric`;
        await sql`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE, 14, 'visitor', 'pageview', '', 10),
                (CURRENT_DATE, 24, 'visitor', 'tilt', '', 3)
        `;
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.dreid.eintraege).toEqual([
            { name: "nur2d", wert: 7 },
            { name: "in3d", wert: 3 },
        ]);
        await sql`DELETE FROM visitor_metric`;
    });

    /** WI-0286: Die Liste steht nach Stufe, nicht nach Häufigkeit; Median und Mittel rechnen über die Stufen selbst. */
    it("liefert die Zoomstufen aufsteigend mit Median und Mittel", async () => {
        await sql`DELETE FROM visitor_metric`;
        await sql`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE, 24, 'visitor', 'zoom_stufe', '6', 1),
                (CURRENT_DATE, 24, 'visitor', 'zoom_stufe', '2', 2),
                (CURRENT_DATE, 24, 'visitor', 'zoom_stufe', '4', 7)
        `;
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.zoom).toEqual({
            ruhen: 10,
            median: 4,
            mittel: 3.8,
            stufen: [
                { name: "2", wert: 2 },
                { name: "4", wert: 7 },
                { name: "6", wert: 1 },
            ],
        });
        await sql`DELETE FROM visitor_metric`;
        const leer = await leseZahlen(sql, "visitor", 7, true);
        expect(leer.zoom).toEqual({ ruhen: 0, median: null, mittel: null, stufen: [] });
    });

    /** WI-0286: Die Sprache des Browsers und die eingestellte sind zwei Listen; das Design steht daneben. */
    it("hält Browsersprache, eingestellte Sprache und Design auseinander", async () => {
        await sql`DELETE FROM visitor_metric`;
        await sql`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE, 24, 'visitor', 'sprache', 'nl', 4),
                (CURRENT_DATE, 24, 'visitor', 'sprache_eingestellt', 'de', 3),
                (CURRENT_DATE, 24, 'visitor', 'theme', 'dark', 2)
        `;
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.sprache.eintraege).toEqual([{ name: "nl", wert: 4 }]);
        expect(zahlen.listen.spracheEingestellt.eintraege).toEqual([{ name: "de", wert: 3 }]);
        expect(zahlen.listen.theme.eintraege).toEqual([{ name: "dark", wert: 2 }]);
        await sql`DELETE FROM visitor_metric`;
    });

    it("der Takt räumt wirklich auf - sonst wäre die Aufbewahrung nur eine Behauptung", async () => {
        await sql`INSERT INTO visitor_daily_seen (day, visitor_hash) VALUES (CURRENT_DATE - 1, decode('00112233445566778899aabbccddeeff', 'hex'))`;
        const takt = createBesucherTakt({ database: sql, log: { debug() {}, warn() {} } as never, intervalMs: 60_000 });
        await takt.lauf();
        const [zeile] = await sql<{ anzahl: string }[]>`
            SELECT COUNT(*)::text AS anzahl FROM visitor_daily_seen WHERE day < CURRENT_DATE
        `;
        expect(Number(zeile?.anzahl)).toBe(0);
        takt.stop();
    });

    it("übernimmt Legacys Reihe und bleibt bei einem zweiten Lauf stehen", async () => {
        const pfad = new URL(
            "../../../project-control/discovery/legacy-nutzung-2026-10-12/visitor-metrics-besucher.json",
            import.meta.url,
        ).pathname.replace(/^\/([A-Za-z]:)/, "$1");
        const erster = await importiereLegacyAbzug(sql, pfad);
        expect(erster.tage).toBe(107);
        expect(erster.geschrieben).toBeGreaterThan(400);
        const zweiter = await importiereLegacyAbzug(sql, pfad);
        expect(zweiter.geschrieben).toBe(0);

        // Der Verlauf trägt danach Legacys Zahlen: der beste Tag ist der 06.10.2026 mit 1.080 Eindeutigen.
        const zahlen = await leseZahlen(sql, "visitor", 3660, true);
        expect(zahlen.verlauf.find((tag) => tag.tag === "2026-10-06")?.eindeutige).toBe(1080);
        // Legacys `editors` zählte Geräte wie unsere alte Reihe; Köpfe sind das nicht, also bleibt der Zeitraum ungezählt (2026-11-11).
        expect(zahlen.kennzahlen.editorenSpitze).toBeNull();
    });

    /**
     * WI-0191 (Kanal OPS-000016, Thomas): Die Listen waren nach acht Einträgen zu Ende, und man sah es ihnen nicht an. Jetzt
     * kommt bis `BESUCH_LISTE_GRENZE` mit, und jede Liste sagt, wie viele Ausprägungen es insgesamt gab.
     */
    it("liefert bis zur Grenze und nennt die Zahl aller Ausprägungen (WI-0191 A1, A2)", async () => {
        await sql`DELETE FROM visitor_metric`;
        const wieViele = BESUCH_LISTE_GRENZE + 10;
        for (let i = 0; i < wieViele; i += 1) {
            // Der absteigende Wert macht die Reihenfolge prüfbar: „Ziel 0“ führt, „Ziel 59“ schließt.
            await sql`
                INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
                VALUES (CURRENT_DATE, 24, 'visitor', 'search', ${`Ziel ${i}`}, ${wieViele - i})
            `;
        }
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.suche.eintraege).toHaveLength(BESUCH_LISTE_GRENZE);
        expect(zahlen.listen.suche.gesamt).toBe(wieViele);
        expect(zahlen.listen.suche.eintraege[0]).toEqual({ name: "Ziel 0", wert: wieViele });
        expect(zahlen.listen.suche.eintraege.at(-1)).toEqual({
            name: `Ziel ${BESUCH_LISTE_GRENZE - 1}`,
            wert: wieViele - BESUCH_LISTE_GRENZE + 1,
        });
        await sql`DELETE FROM visitor_metric`;
    });

    /** Die Region hatte eine eigene Grenze (16) und wird jetzt behandelt wie jede andere Liste (WI-0191 A3). */
    it("kürzt die Region nicht mehr bei 16 (WI-0191 A3)", async () => {
        await sql`DELETE FROM visitor_metric`;
        for (let i = 0; i < 20; i += 1) {
            await sql`
                INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
                VALUES (CURRENT_DATE, 24, 'visitor', 'region', ${`R${i}`}, ${20 - i})
            `;
        }
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.region.eintraege).toHaveLength(20);
        expect(zahlen.listen.region.gesamt).toBe(20);
        await sql`DELETE FROM visitor_metric`;
    });

    /**
     * 🪤 Zusammengefasst wird VOR dem Kürzen, und die leere Ausprägung bleibt draußen (WI-0191 A4). Der Fall stellt beides
     * zugleich auf die Probe: „deregraphic“ und „standard“ sind dieselbe Ansicht und stünden einzeln hinter „political“.
     */
    it("fasst zusammen, bevor es kürzt, und zählt die leere Ausprägung nicht mit (WI-0191 A4)", async () => {
        await sql`DELETE FROM visitor_metric`;
        await sql`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE, 24, 'visitor', 'map_mode', 'deregraphic', 6),
                (CURRENT_DATE, 24, 'visitor', 'map_mode', 'standard', 5),
                (CURRENT_DATE, 24, 'visitor', 'map_mode', 'political', 9),
                (CURRENT_DATE, 24, 'visitor', 'map_mode', '', 100)
        `;
        const zahlen = await leseZahlen(sql, "visitor", 7, true);
        expect(zahlen.listen.ansicht.eintraege).toEqual([
            { name: "standard", wert: 11 },
            { name: "political", wert: 9 },
        ]);
        expect(zahlen.listen.ansicht.gesamt).toBe(2);
        await sql`DELETE FROM visitor_metric`;
    });

    it("fasst Legacys Ansichtsnamen mit unseren in einer Zeile zusammen", async () => {
        await zaehle(sql, "bot", [
            { metrik: "map_mode", dimension: "deregraphic", stunde: KEINE_STUNDE },
            { metrik: "map_mode", dimension: "political", stunde: KEINE_STUNDE },
        ]);
        await zaehle(sql, "bot", [
            { metrik: "map_mode", dimension: "deregraphic", stunde: KEINE_STUNDE },
            { metrik: "map_mode", dimension: "standard", stunde: KEINE_STUNDE },
            { metrik: "map_style", dimension: "stylized", stunde: KEINE_STUNDE },
        ]);

        // Zwei Zeilen stehen in der Tabelle, in der Liste ist es eine: Legacys „deregraphic“ ist unser „standard“.
        const zahlen = await leseZahlen(sql, "bot", 30, true);
        expect(zahlen.listen.ansicht.eintraege).toEqual([
            { name: "standard", wert: 3 },
            { name: "political", wert: 1 },
        ]);
        expect(zahlen.listen.untergrund.eintraege).toEqual([{ name: "modern", wert: 1 }]);

        // Die Rohdaten bleiben, wie sie gemeldet wurden - umgeschrieben wird erst beim Lesen.
        const [roh] = await sql<{ count: string }[]>`
            SELECT count::text FROM visitor_metric
            WHERE actor_type = 'bot' AND metric = 'map_mode' AND dimension = 'deregraphic'
        `;
        expect(Number(roh?.count)).toBe(2);
    });

    /**
     * WI-0213 (Betreiber 2026-10-16: „meiste nutzer gleichzeitig“): die Tagesspitze der Anwesenden, gezählt wie „Anwesend jetzt“.
     * Ein Höchstwert, keine Summe — sie darf nie hochgezählt werden und nie sinken.
     */
    describe("meiste gleichzeitig (WI-0213)", () => {
        const geraet = (nummer: number): Buffer => tagesKennung("test-salt", `198.51.100.${nummer}`, "Browser")!;

        beforeEach(async () => {
            await sql`DELETE FROM visitor_metric`;
            await sql`DELETE FROM visitor_live`;
        });

        it("G1 folgt der Zahl „anwesend“ und sinkt nicht, wenn Besucher gehen", async () => {
            for (const nummer of [1, 2, 3]) await lebenszeichen(sql, geraet(nummer), "visitor", "active");
            // Dasselbe Gerät noch einmal: Es ist schon da, die Spitze bleibt bei drei.
            await lebenszeichen(sql, geraet(1), "visitor", "reading");
            expect((await leseZahlen(sql, "visitor", 7, true)).kennzahlen.gleichzeitigSpitze).toBe(3);

            // Alle drei sind gegangen, einer kommt neu: jetzt ist einer da, die Spitze des Tages bleibt drei.
            await sql`UPDATE visitor_live SET last_seen = now() - interval '6 minutes'`;
            await lebenszeichen(sql, geraet(4), "visitor", "active");
            const zahlen = await leseZahlen(sql, "visitor", 7, true);
            expect(zahlen.jetzt.gesamt).toBe(1);
            expect(zahlen.kennzahlen.gleichzeitigSpitze).toBe(3);
            // Der Tag der Spitze steht daneben (Betreiber 2026-10-19), die Uhrzeit ist nicht gespeichert.
            const [heute] = await sql<{ tag: string }[]>`SELECT CURRENT_DATE::text AS tag`;
            expect(zahlen.kennzahlen.gleichzeitigAm).toBe(heute?.tag);

            // Eine Zeile je Tag und Sorte, nicht je Lebenszeichen.
            const [zeilen] = await sql<{ anzahl: string }[]>`
                SELECT COUNT(*)::text AS anzahl FROM visitor_metric WHERE metric = 'gleichzeitig'
            `;
            expect(Number(zeilen?.anzahl)).toBe(1);
        });

        it("G2 hält die Sorten getrennt: Editoren heben die Besucherspitze nicht", async () => {
            await lebenszeichen(sql, geraet(1), "visitor", "active");
            await lebenszeichen(sql, geraet(2), "editor", "active");
            await lebenszeichen(sql, geraet(3), "editor", "hidden");
            expect((await leseZahlen(sql, "visitor", 7, true)).kennzahlen.gleichzeitigSpitze).toBe(1);
            expect((await leseZahlen(sql, "editor", 7, true)).kennzahlen.gleichzeitigSpitze).toBe(2);
        });

        it("G3 nie gemessen heißt null, nicht 0 — auch wenn es Aufrufe gab", async () => {
            await zaehle(sql, "visitor", [{ metrik: "pageview", dimension: "", stunde: 10 }]);
            const zahlen = await leseZahlen(sql, "visitor", 7, true);
            expect(zahlen.kennzahlen.gleichzeitigSpitze).toBeNull();
            expect(zahlen.kennzahlen.gleichzeitigAm).toBeNull();
        });

        it("G4 nimmt den höchsten Tag des Zeitraums und nennt ihn (Betreiber 2026-10-19: das Datum der Spitze)", async () => {
            await sql`
                INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                    (CURRENT_DATE - 20, 24, 'visitor', 'gleichzeitig', '', 40),
                    (CURRENT_DATE - 3, 24, 'visitor', 'gleichzeitig', '', 7),
                    (CURRENT_DATE - 6, 24, 'visitor', 'pageview', '', 5)
            `;
            await lebenszeichen(sql, geraet(1), "visitor", "active");
            const woche = await leseZahlen(sql, "visitor", 7, true);
            expect(woche.kennzahlen.gleichzeitigSpitze).toBe(7);
            const [tage] = await sql<{ vorDrei: string; vorZwanzig: string }[]>`
                SELECT (CURRENT_DATE - 3)::text AS "vorDrei", (CURRENT_DATE - 20)::text AS "vorZwanzig"
            `;
            // In der Woche war die Spitze vor drei Tagen (7), heute nur einer; im Monat vor zwanzig Tagen (40).
            expect(woche.kennzahlen.gleichzeitigAm).toBe(tage?.vorDrei);
            const monat = await leseZahlen(sql, "visitor", 30, true);
            expect(monat.kennzahlen.gleichzeitigSpitze).toBe(40);
            expect(monat.kennzahlen.gleichzeitigAm).toBe(tage?.vorZwanzig);
        });

        it("G5 ein Höchstwert wird ersetzt, nicht addiert, und nie kleiner", async () => {
            await sql`
                INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
                VALUES (CURRENT_DATE, 24, 'visitor', 'gleichzeitig', '', 5)
            `;
            await lebenszeichen(sql, geraet(1), "visitor", "active");
            expect((await leseZahlen(sql, "visitor", 7, true)).kennzahlen.gleichzeitigSpitze).toBe(5);
            for (const nummer of [2, 3, 4, 5, 6]) await lebenszeichen(sql, geraet(nummer), "visitor", "active");
            expect((await leseZahlen(sql, "visitor", 7, true)).kennzahlen.gleichzeitigSpitze).toBe(6);
        });
    });
});
