import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { berechnePlan, gesuchteTitelAus, type LokalerWert, type PlanObjekt } from "../src/wiki/abgleich/plan.ts";
import { listeDes, listenImDump } from "../src/wiki/abgleich/vorkommen-liste.ts";
import type { GelesenerDumpArtikel } from "../src/wiki/dump/seiten-sammler.ts";
import { VORKOMMEN_FELDER } from "../src/wiki/infobox/vorkommen.ts";
import { wikiSeitenAdresse } from "../src/search/eintrag.ts";

/**
 * Die Unterseite „Liste“ eines Vorkommens (WI-0299, OPS-000104), rein: Der Dump-Durchgang sucht sie mit, der Plan führt ihren Titel als Feld `liste` im Wiki-Stand, die Antwort des Eintrags macht daraus
 * die Adresse. Langschwert hat eine (Langschwert/Liste), Sikrami nicht; ohne die Auskunft des Dumps (der Vergleich EINES Artikels) wird das Feld nicht verglichen.
 */

const tafel = wikiNamespaceTafel();
const wikiUrl = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const artikel = (titel: string, weiterleitung: string | null = null): GelesenerDumpArtikel => ({
    titel,
    ns: 0,
    weiterleitung,
    text: weiterleitung === null ? `{{Infobox Gegenstandsgruppe\n|Name=${titel}\n}}\n${titel} ist eine Ware.` : "",
});

const kein: LokalerWert = { zustand: "kein", wert: null, vermerk: "kein" };
const ware = (id: string, titel: string, stand: [string, string | null][] = [], unbekannt?: string[]): PlanObjekt => ({
    bereich: "vorkommen",
    objektArt: "lore",
    id,
    name: titel,
    adresse: wikiUrl(titel),
    zustand: "zugewiesen",
    herkunft: null,
    hauptzuweisung: true,
    lokal: new Map<string, LokalerWert>([
        ["name", { zustand: "text", wert: titel, vermerk: "wiki" }],
        ["gruppe", kein],
        ["typ", kein],
        ["lebensraum", kein],
        ["synonyme", kein],
        ["continent", kein],
    ]),
    schnappschuss: new Map(stand),
    schnappschussUnbekannt: new Set(unbekannt ?? VORKOMMEN_FELDER),
    vorkommen: { art: "ware", zeilen: [], redaktion: false },
});

const lauf = (objekte: PlanObjekt[], seiten: GelesenerDumpArtikel[], mitListen = true) => {
    const gefunden = new Map(seiten.map((s) => [s.titel, [s]]));
    return berechnePlan({
        bereiche: ["vorkommen"],
        objekte,
        dump: { gefunden, kandidaten: [] },
        tafel,
        legacyBereiche: new Set(),
        bekannteTitel: new Set(objekte.map((o) => o.name.toLowerCase())),
        ...(mitListen ? { listen: listenImDump(gefunden) } : {}),
    });
};
const listenZeilen = (plan: ReturnType<typeof lauf>) => plan.zeilen.filter((zeile) => zeile.feld === "liste");

describe("WikiSync Vorkommen: die Unterseite „Liste“ (WI-0299)", () => {
    it("der Dump-Durchgang sucht zu jedem Vorkommen auch die Unterseite, zu anderen Bereichen nicht", () => {
        const gesucht = gesuchteTitelAus([
            ware("l1", "Langschwert"),
            { ...ware("o1", "Gareth"), bereich: "ort", objektArt: "place" },
        ]);
        expect(gesucht.has("Langschwert")).toBe(true);
        expect(gesucht.has("Langschwert/Liste")).toBe(true);
        expect(gesucht.has("Gareth")).toBe(true);
        expect(gesucht.has("Gareth/Liste")).toBe(false);
    });

    it("🔴 eine Unterseite zählt als Artikel oder als Weiterleitung woandershin, nie als Weiterleitung zurück auf den Artikel", () => {
        const gefunden = new Map<string, GelesenerDumpArtikel[]>([
            ["Langschwert", [artikel("Langschwert")]],
            ["Langschwert/Liste", [artikel("Langschwert/Liste")]],
            ["Wolf/Liste", [artikel("Wolf/Liste", "Liste der Wölfe")]],
            ["Rapier/Liste", [artikel("Rapier/Liste", "Rapier#Bekannte Rapiere")]],
            ["/Liste", [artikel("/Liste")]],
        ]);
        expect([...listenImDump(gefunden)].sort()).toEqual(["Langschwert/Liste", "Wolf/Liste"]);
        expect(listeDes("Langschwert", listenImDump(gefunden))).toBe("Langschwert/Liste");
        expect(listeDes("Sikrami", listenImDump(gefunden))).toBeUndefined();
    });

    it("🔴 Langschwert mit Liste: das Feld kommt neu in den Wiki-Stand; Sikrami ohne Liste: keine Zeile", () => {
        const plan = lauf(
            [ware("l1", "Langschwert"), ware("l2", "Sikrami")],
            [artikel("Langschwert"), artikel("Langschwert/Liste"), artikel("Sikrami")],
        );
        expect(listenZeilen(plan).map((zeile) => [zeile.objektName, zeile.alt, zeile.neu])).toEqual([
            ["Langschwert", null, "Langschwert/Liste"],
        ]);
        expect(listenZeilen(plan)[0]).toMatchObject({ eigentuemer: "wiki", wirkung: "uebernommen", status: "neu" });
    });

    it("ein Wiki-Stand, der die Liste schon kennt, gibt keine Zeile; verschwindet sie im Wiki, wird sie aus dem Stand genommen", () => {
        const bekannt = VORKOMMEN_FELDER.filter((feld) => feld !== "liste");
        const mit = ware("l1", "Langschwert", [["liste", "Langschwert/Liste"]], bekannt);
        expect(listenZeilen(lauf([mit], [artikel("Langschwert"), artikel("Langschwert/Liste")]))).toEqual([]);
        const weg = listenZeilen(lauf([mit], [artikel("Langschwert")]));
        expect(weg.map((zeile) => [zeile.alt, zeile.neu])).toEqual([["Langschwert/Liste", null]]);
        // Ohne Liste im Stand und im Wiki: nichts zu sagen.
        const ohne = ware("l2", "Sikrami", [["liste", null]], bekannt);
        expect(listenZeilen(lauf([ohne], [artikel("Sikrami")]))).toEqual([]);
    });

    it("🔴 ohne die Auskunft des Dumps (der Vergleich EINES Artikels) wird die Liste nicht verglichen: auch nicht als „fehlt“", () => {
        const bekannt = VORKOMMEN_FELDER.filter((feld) => feld !== "liste");
        const mit = ware("l1", "Langschwert", [["liste", "Langschwert/Liste"]], bekannt);
        expect(listenZeilen(lauf([mit], [artikel("Langschwert")], false))).toEqual([]);
        expect(listenZeilen(lauf([ware("l2", "Langschwert")], [artikel("Langschwert")], false))).toEqual([]);
    });

    it("die Adresse einer Unterseite behält ihren Schrägstrich und kodiert den Rest", () => {
        const wiki = "https://de.wiki-aventurica.de";
        expect(wikiSeitenAdresse(wiki, "Langschwert/Liste")).toBe(
            "https://de.wiki-aventurica.de/wiki/Langschwert/Liste",
        );
        expect(wikiSeitenAdresse(wiki, "Großer Wurm/Liste")).toBe(
            "https://de.wiki-aventurica.de/wiki/Gro%C3%9Fer_Wurm/Liste",
        );
    });
});
