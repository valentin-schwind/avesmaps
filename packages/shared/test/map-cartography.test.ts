import { describe, expect, it } from "vitest";
import {
    AVENTURIA_CARTOGRAPHY,
    AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS,
    AVENTURIA_PATH_CARTOGRAPHY,
    AVENTURIA_ZOOM_BANDS,
    CARTOGRAPHY_FALLBACK_TYPE,
    WATER_AREA_TYPES,
    WATER_CARTOGRAPHY_LAYER,
    cartographyForType,
    cartographyLayersInOrder,
    cartographyTypesOfLayer,
    darkenColour,
    effectiveLandscapeDisplay,
    isWaterPathSubtype,
    parseLandscapeDisplayResponse,
} from "../src/index.ts";

/**
 * Die Kartografietafel (WI-0008).
 *
 * 💣 Der wichtigste Test ist der langweiligste: **jede Landschaftsart aus dem Datenbestand muss
 * eine Zeile haben.** Vorher teilten sich 25 Arten drei Farben, und eine neue Art wäre einfach in
 * der Ebenenfarbe verschwunden - auf der Karte sieht man das nicht, weil dort ohnehin alles gleich
 * aussah. Jetzt fällt dieser Test, bevor eine Art unsichtbar grau wird.
 */

/**
 * Die Arten, die am 2026-09-21 im Bestand liegen (Entwicklungsdatenbank, 2409 aktive Regionen).
 *
 * 🪤 Absichtlich eine feste Liste und keine Datenbankabfrage: der Test soll auch ohne Datenbank
 * laufen und beim Hinzufügen einer Art **bewusst** angefasst werden. Wer eine neue Landschaftsart
 * migriert, trägt sie hier ein und merkt dabei, dass sie eine Farbe braucht.
 */
const TYPES_IN_DATA = [
    // vegetation
    "auenlandschaft",
    "dschungel",
    "flussland_flusstal",
    "graslandschaft",
    "kulturlandschaft",
    "steppe",
    "suempfe_moore",
    "tundra",
    "urwald",
    "wald",
    "wueste",
    "wuestenoase",
    // topographie
    "flussdelta",
    "gebirge",
    "hochebene",
    "huegelland",
    "insel",
    "kueste",
    "meer",
    "see",
    "tal",
    "tiefebene",
    "wadi",
    // derographisch
    "inselgruppe",
    "kontinent",
    "region",
];

describe("Kartografietafel", () => {
    it("💣 kennt jede Landschaftsart aus dem Bestand", () => {
        const fehlend = TYPES_IN_DATA.filter((type) => !(type in AVENTURIA_CARTOGRAPHY.types));
        expect(fehlend, `ohne Farbe in der Tafel: ${fehlend.join(", ")}`).toEqual([]);
    });

    it("ordnet jede Art einer Ebene zu, die es gibt", () => {
        for (const [type, entry] of Object.entries(AVENTURIA_CARTOGRAPHY.types)) {
            expect(AVENTURIA_CARTOGRAPHY.layers[entry.layer], `${type} -> ${entry.layer}`).toBeDefined();
        }
    });

    it("🪤 hat einen sichtbaren Auffangwert, keinen durchsichtigen", () => {
        // Eine Fläche, die verschwindet, weil jemand eine Art angelegt hat, fällt niemandem auf.
        // Eine graue schon.
        const fallback = cartographyForType("gibtesnicht");
        expect(fallback).toBe(AVENTURIA_CARTOGRAPHY.types[CARTOGRAPHY_FALLBACK_TYPE]);
        expect(fallback.fill).toMatch(/^#[0-9a-f]{6}$/);
        expect(cartographyForType(null)).toBe(fallback);
        expect(cartographyForType(undefined)).toBe(fallback);
    });

    it("gibt jeder Art einen eigenen Farbton innerhalb ihrer Ebene", () => {
        // Der ganze Zweck des Work Items: zwei Arten derselben Ebene dürfen nicht gleich aussehen.
        for (const { layer } of cartographyLayersInOrder()) {
            const farben = cartographyTypesOfLayer(layer).map((entry) => entry.fill);
            expect(new Set(farben).size, `${layer} hat doppelte Farben`).toBe(farben.length);
        }
    });

    it("stapelt die Ebenen von unten nach oben, Klima zuunterst", () => {
        const reihenfolge = cartographyLayersInOrder().map((entry) => entry.layer);
        expect(reihenfolge).toEqual(["klima", "topographie", "vegetation", "derographisch"]);
    });

    it("🔴 jede Art hat eine Schriftgrößentafel: eigene Zeile oder die Grundvorgabe der Darstellungstafel (WI-0064)", () => {
        // Die Größentafel steht seit WI-0064 nicht mehr in config/zoom-bands, sondern in der Darstellungstafel der Landschaften
        // (Legacys Vorgaben plus Übersteuerungen, in der Datenbank). Eine Art ohne Zeile erbt die Grundvorgabe - keine Fläche
        // kann also Farbe und keine Schriftgröße haben. Hier wird die Tafel ohne Übersteuerung gelesen: der schlechteste Fall.
        const tafel = effectiveLandscapeDisplay(
            AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS,
            parseLandscapeDisplayResponse({ ok: true, display: null, stamp: "1" }),
        );
        for (const type of TYPES_IN_DATA) {
            const groessen = (tafel.arts[type] ?? tafel.base).size;
            expect(groessen.length, `${type} hat nicht neun Bänder`).toBe(AVENTURIA_ZOOM_BANDS.bandCount);
        }
    });

    /**
     * Die Ebene des WASSERS (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“: „Ein Fluss ist Wasser wie ein See“). Daran
     * hängt, in welcher Kartenansicht ein Fluss wählbar ist - und sie ist ABGELEITET, nicht geschrieben.
     */
    it("🔴 See und Meer liegen in EINER Ebene, und daraus folgt die Ebene der Flüsse", () => {
        expect([...WATER_AREA_TYPES]).toEqual(["see", "meer"]);
        for (const type of WATER_AREA_TYPES) {
            expect(cartographyForType(type).layer, type).toBe(WATER_CARTOGRAPHY_LAYER);
        }
        expect(WATER_CARTOGRAPHY_LAYER).toBe("topographie");
        // Die Ebene ist eine, die es gibt: kein Wert, der in keiner Zeichenreihenfolge steht.
        expect(cartographyLayersInOrder().map(({ layer }) => layer)).toContain(WATER_CARTOGRAPHY_LAYER);
    });

    it("🔴 welche Wegart Wasser ist, sagt die Tafel der WEGE - keine zweite Liste", () => {
        expect(isWaterPathSubtype("Flussweg")).toBe(true);
        // Der Seeweg ist Wasser und steht trotzdem auf keiner Karte (`hidden`): zwei verschiedene Fragen.
        expect(isWaterPathSubtype("Seeweg")).toBe(true);
        expect(AVENTURIA_PATH_CARTOGRAPHY.types["Seeweg"]?.hidden).toBe(true);
        for (const subtype of ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"]) {
            expect(isWaterPathSubtype(subtype), subtype).toBe(false);
        }
        // Jede Wasser-Wegart der Tafel ist eine Wegart, die es gibt.
        for (const subtype of AVENTURIA_PATH_CARTOGRAPHY.water.types) {
            expect(Object.keys(AVENTURIA_PATH_CARTOGRAPHY.types), subtype).toContain(subtype);
        }
    });

    it("dunkelt eine Farbe für die Kante ab, ohne sie zu verfälschen", () => {
        expect(darkenColour("#ffffff", 0)).toBe("#ffffff");
        expect(darkenColour("#ffffff", 1)).toBe("#000000");
        expect(darkenColour("#6f8f4a", 0.35)).toBe("#485d30");
        // Aus einer gültigen Farbe wird immer eine gültige Farbe - auch bei kleinen Kanälen.
        expect(darkenColour("#010203", 0.35)).toMatch(/^#[0-9a-f]{6}$/);
    });
});
