import { beforeEach, describe, expect, it } from "vitest";
import { LANDSCAPE_SELECTIONS, SUBJECT_KINDS, TOPOGRAPHY_VARIANTS } from "@avesmaps3d/shared";
import { ansichtMitEbenen, statistikWertName, wetterWertName } from "../src/editor-panel/statistik-namen.ts";
import { locale } from "../src/i18n/i18n.ts";

/**
 * Die Namen der Statistik (WI-0286; Betreiber 2026-11-07: „alle fehlende schlüssel auflösen“). Ein Rohwert im Panel fällt sonst
 * erst dem Betreiber auf, also stehen hier die Werte, die Stage und Production am 2026-11-07 wirklich geliefert haben.
 */
describe("statistikWertName", () => {
    beforeEach(() => {
        locale.value = "de";
    });

    it.each(SUBJECT_KINDS)("nennt die Objektart %s", (art) => {
        expect(statistikWertName(art)).not.toBe(art);
    });

    it("nennt die Arten aus dem Bild des Betreibers", () => {
        expect(["powerline", "path", "routeStage", "territory", "climate", "loreEntry"].map(statistikWertName)).toEqual(
            ["Kraftlinien", "Wege", "Etappen", "Politische Gebiete", "Klimazonen", "Vorkommen"],
        );
    });

    it.each([...LANDSCAPE_SELECTIONS, ...TOPOGRAPHY_VARIANTS])("nennt die Ebene %s wie der Fächer", (ebene) => {
        expect(statistikWertName(ebene)).not.toBe(ebene);
    });

    it.each([
        ["toggleRivers:on", "Flüsse: an"],
        ["toggleRivers:off", "Flüsse: aus"],
        ["togglePaths:on", "Wege: an"],
        ["toggleTerritoryBorders:off", "Grenzen: aus"],
        ["toggleMapLabels:on", "Labels: an"],
        ["toggleLocations:off", "Orte: aus"],
        ["areas:on", "Ebenen: an"],
        ["gebaeude:off", "Bauwerke/Stätten: aus"],
        ["metropole:on", "Metropolen: an"],
        ["stadtviertel:on", "Stadtviertel: an"],
        ["toggleLabelsWithRegion:on", "Labels mit Region: an"],
        ["toggleCrossings:off", "Kreuzungen: aus"],
    ])("nennt den Schalter %s", (wert, name) => {
        expect(statistikWertName(wert)).toBe(name);
    });

    it.each([
        ["too_many_map_points", "zu viele Kartenpunkte"],
        ["route_too_large", "Route zu groß"],
        ["Bad Request", "ungültige Anfrage"],
        ["ueberlastet", "Router ausgelastet"],
    ])("nennt den Routenfehler %s", (wert, name) => {
        expect(statistikWertName(wert)).toBe(name);
    });

    it.each([
        "riverSailer",
        "groupFoot",
        "cargoShip",
        "groupHorse",
        "horseCarriage",
        "lightWalker",
        "lightRider",
        "caravan",
        "riverBarge",
        "fastShip",
        "cart",
        "wagon",
        "galley",
        "rowboat",
        "riverGalley",
        "sleigh",
        "courierDromone",
    ])("nennt das Reisemittel %s", (mittel) => {
        expect(statistikWertName(mittel)).not.toBe(mittel);
    });

    it("trennt Design und Farbschema des Systems", () => {
        expect(statistikWertName("dark")).toBe("Dunkel");
        expect(statistikWertName("light")).toBe("Hell");
        expect(statistikWertName("dunkel")).toBe("System auf dunkel");
    });

    it("nennt die Zeilen der dritten Dimension", () => {
        expect(["nur2d", "in3d", "flight", "profile", "play", "share_create"].map(statistikWertName)).toEqual([
            "nur in 2D angesehen",
            "in 3D angesehen",
            "Flug genutzt",
            "Höhenprofil geöffnet",
            "Etappen abgespielt",
            "Link geteilt",
        ]);
    });

    it("gibt auch Sprachen außerhalb der Oberfläche ihren Namen, vom Browser", () => {
        expect(statistikWertName("de")).toBe("Deutsch");
        expect(statistikWertName("zh")).toBe("Chinesisch");
        expect(statistikWertName("ohne")).toBe("ohne Angabe");
    });

    it("gibt Ländern ihren Namen und lässt Namen aus dem Kartenbestand stehen", () => {
        expect(statistikWertName("AT")).toBe("Österreich");
        expect(statistikWertName("Gareth")).toBe("Gareth");
        expect(statistikWertName("Gareth → Punin")).toBe("Gareth → Punin");
        expect(statistikWertName("search.brave.com")).toBe("search.brave.com");
    });

    it("spricht die Sprache der Oberfläche", () => {
        locale.value = "en";
        expect(statistikWertName("powerline")).toBe(statistikWertName("powerlines"));
        expect(statistikWertName("dark")).toBe("Dark");
        expect(statistikWertName("zh")).toBe("Chinese");
    });
});

describe("ansichtMitEbenen", () => {
    const ansichten = [
        { name: "standard", wert: 9 },
        { name: "landscapes", wert: 5 },
        { name: "none", wert: 1 },
    ];

    it("rückt die Ebenen unter die Derographie und die Unterwahl unter die Topographie", () => {
        const zeilen = ansichtMitEbenen(ansichten, [
            { name: "topographie", wert: 4 },
            { name: "hoehenstufen", wert: 3 },
            { name: "klima", wert: 2 },
            { name: "hoehenlinien", wert: 1 },
        ]);
        expect(zeilen).toEqual([
            { name: "standard", wert: 9 },
            { name: "landscapes", wert: 5 },
            { name: "topographie", wert: 4, stufe: 1 },
            { name: "hoehenstufen", wert: 3, stufe: 2 },
            { name: "hoehenlinien", wert: 1, stufe: 2 },
            { name: "klima", wert: 2, stufe: 1 },
            { name: "none", wert: 1 },
        ]);
    });

    it("lässt die Ansichten unverändert, wo keine Ebene gezählt wurde", () => {
        expect(ansichtMitEbenen(ansichten, [])).toEqual(ansichten);
    });

    it("hängt eine Ebene nie unter die falsche Ansicht, auch wenn ihre im Zeitraum fehlt", () => {
        expect(ansichtMitEbenen([{ name: "standard", wert: 9 }], [{ name: "hoehenstufen", wert: 2 }])).toEqual([
            { name: "standard", wert: 9 },
            { name: "landscapes", wert: 0 },
            { name: "topographie", wert: 0, stufe: 1 },
            { name: "hoehenstufen", wert: 2, stufe: 2 },
        ]);
    });
});

/** Der Block „Wetter“ (WI-0288): Schalter, Klassen mit Einheit, Marken der Grafikkarte. */
describe("Wetter in der Statistik", () => {
    beforeEach(() => {
        locale.value = "de";
    });

    it.each([
        ["wetter_wolken:on", "Wolken: an"],
        ["wetter_regenUndSchnee:off", "Regen und Schnee: aus"],
        ["wetter_schneedecke:on", "Schneedecke: an"],
        ["wetter_stroemungen:on", "Meeresströmungen: an"],
        ["wetter_schneefallgrenze:on", "Schneefallgrenze: an"],
    ])("nennt den Schalter %s", (wert, name) => {
        expect(statistikWertName(wert)).toBe(name);
    });

    it.each([
        ["lauf", "rechner", "Rechner"],
        ["bildrate", "telefon:u10", "Telefon · <10 fps"],
        ["bildrate", "rechner:ab120", "Rechner · 120+ fps"],
        ["bildrate", "rechner:30-40", "Rechner · 30–40 fps"],
        ["spitze", "rechner:90-100", "Rechner · 90–100 ms"],
        ["spitze", "telefon:ab100", "Telefon · 100+ ms"],
        ["start", "rechner:u1s", "Rechner · <1 s"],
        ["start", "telefon:2-3s", "Telefon · 2–3 s"],
        ["start", "telefon:ab30s", "Telefon · 30+ s"],
        ["aufloesung", "telefon:25", "Telefon · 25 %"],
        ["gpu", "rechner:nvidia", "Rechner · NVIDIA"],
        ["gpu", "telefon:adreno", "Telefon · Adreno"],
        ["gpu", "rechner:software", "Rechner · Software (ohne Grafikkarte)"],
        ["gpu", "rechner:andere", "Rechner · übrige"],
        ["gpu", "rechner:unbekannt", "Rechner · unbekannt"],
        ["fehler", "telefon:gleitkomma", "Telefon · gleitkomma"],
    ] as const)("nennt %s %s", (verteilung, wert, name) => {
        expect(wetterWertName(verteilung, wert)).toBe(name);
    });
});
