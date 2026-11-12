import { beforeEach, describe, expect, it } from "vitest";
import type { SearchEintrag } from "@avesmaps3d/shared";
import { locale } from "../src/i18n/i18n.ts";
import {
    entlangDerRoute,
    gegendenKurz,
    kurzzeile,
    lizenzTeile,
    tafelZeilen,
} from "../src/info-panel/vorkommen-sammel.ts";

/**
 * Was die Infobox eines Vorkommens und der Sammelscreen „Ausgewählte Vorkommen“ gemeinsam zeigen (WI-0257 S5): die Feldtafel mit dem ersten Satz, die Gegenden in Kurzform und die
 * Lizenzzeile - einmal je Artikel, einmal für alle.
 */

const WIKI = {
    url: "https://de.wiki-aventurica.de/wiki/Sikrami",
    title: "Sikrami",
    corpus: { key: "wiki-aventurica.de", label: "Wiki Aventurica" },
    license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
} as SearchEintrag["wiki"];

const eintrag = (extra: Partial<SearchEintrag> = {}): SearchEintrag =>
    ({
        id: "11111111-0000-4000-8000-000000000001",
        name: "Sikrami",
        kind: "ware",
        weitereNamen: ["Sikramwurst"],
        wiki: WIKI,
        kurzbeschreibung: "Eine Hartwurst, z. B. für lange Reisen. Sie stammt aus dem Lieblichen Feld.",
        kontinent: "Aventurien",
        nurKontinent: false,
        wo: { gegenden: [], orte: [], auchGenannt: [] },
        ...extra,
    }) as SearchEintrag;

const gegend = (name: string): SearchEintrag["wo"]["gegenden"][number] =>
    ({
        key: name,
        name,
        kind: "landschaft",
        typ: "Wald",
        relation: "verbreitung",
        ziel: {},
    }) as SearchEintrag["wo"]["gegenden"][number];

beforeEach(() => {
    locale.value = "de";
});

describe("Die Feldtafel unter dem Kopf", () => {
    it("🔴 „Beschreibung“ zuerst, nur der erste Satz; dann weitere Namen; Aventurien ist kein Kontinentfeld", () => {
        const zeilen = tafelZeilen(eintrag({ lebensraum: "Wald" }));
        expect(zeilen.map((zeile) => zeile.key)).toEqual(["beschreibung", "lebensraum", "weitere"]);
        expect(zeilen[0]?.value).toEqual({ kind: "text", text: "Eine Hartwurst, z. B. für lange Reisen." });
        expect(
            tafelZeilen(eintrag({ kurzbeschreibung: null, kontinent: "Myranor/Güldenland" })).map((z) => z.key),
        ).toEqual(["weitere", "kontinent"]);
    });
});

describe("Die Gegenden einer Karte des Sammelscreens", () => {
    it("die ersten drei Namen und „und N weitere“, samt der Gegenden, die nur leuchten; ohne Gegend die Orte, ohne beides der Satz", () => {
        const vier = { gegenden: ["A", "B", "C", "D"].map(gegend), orte: [], auchGenannt: [] };
        expect(gegendenKurz(eintrag({ wo: vier }))).toBe("A, B, C und 1 weitere");
        expect(gegendenKurz(eintrag({ wo: { ...vier, weitere: 10 } }))).toBe("A, B, C und 11 weitere");
        expect(gegendenKurz(eintrag({ wo: { gegenden: [gegend("A")], orte: [], auchGenannt: [] } }))).toBe("A");
        expect(gegendenKurz(eintrag({ nurKontinent: true }))).toBe("Überall in Aventurien");
        expect(gegendenKurz(eintrag())).toBe("Noch kein Ort auf der Karte.");
    });
});

describe("Die Lizenzzeile", () => {
    it("🔴 je Artikel: Wiki (Artikel), Autoren (Liste im Wiki), Lizenz; für alle: „Texte:“, das Wiki selbst, „Autoren“ ohne Link", () => {
        const eine = lizenzTeile(eintrag());
        expect(eine.map((teil) => teil.text).join("")).toBe("Text: Wiki Aventurica (Autoren) · CC BY-SA 3.0");
        expect(eine.filter((teil) => teil.href !== undefined).map((teil) => teil.href)).toEqual([
            "https://de.wiki-aventurica.de/wiki/Sikrami",
            "https://de.wiki-aventurica.de/wiki/Sikrami?action=credits",
            "https://creativecommons.org/licenses/by-sa/3.0/deed.de",
        ]);
        const alle = lizenzTeile(eintrag(), true);
        expect(alle.map((teil) => teil.text).join("")).toBe("Texte: Wiki Aventurica (Autoren) · CC BY-SA 3.0");
        expect(alle.filter((teil) => teil.href !== undefined).map((teil) => teil.href)).toEqual([
            "https://de.wiki-aventurica.de/",
            "https://creativecommons.org/licenses/by-sa/3.0/deed.de",
        ]);
    });
});

describe("Zeilen des Sammelscreens (Fassung 2)", () => {
    const zeile = (name: string, etappen: number[]) => ({ name, etappen, ab: Math.min(...etappen) + 1 });

    it("ordnet entlang der Route: erste Etappe, bei Gleichstand der Name", () => {
        const geordnet = entlangDerRoute([
            zeile("Eisen", [40, 41]),
            zeile("Dryade", [1, 2]),
            zeile("Asmodenie", [1, 5]),
        ]);
        expect(geordnet.map((z) => z.name)).toEqual(["Asmodenie", "Dryade", "Eisen"]);
    });

    it("beginnt die Kurzzeile mit der ersten Etappe, danach der Anteil an der Reise", () => {
        expect(kurzzeile(zeile("Albenhuser Rossschinder", [16, 17, 18, 38]), 80)).toBe(
            "ab Etappe 17 · 4 von 80 Etappen",
        );
        expect(kurzzeile(zeile("Barke", [74]), 80)).toBe("nur Etappe 75");
        expect(kurzzeile(zeile("Eisen", [40, 41]), undefined)).toBe("ab Etappe 41");
    });
});
