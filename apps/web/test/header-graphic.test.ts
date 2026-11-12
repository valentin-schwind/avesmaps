import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    HEADER_GRAPHICS,
    headerGraphicOf,
    headerGraphicOfLandscape,
    headerGraphicOfPath,
    headerGraphicOfPlace,
    headerGraphicOfPoint,
    headerGraphicUrl,
} from "../src/info-panel/header-graphic.ts";

/**
 * Die Kopfgrafik der Art (WI-0063 P6; Legacy `INFO_HEADER_IMAGE_BY_ART`/`_BY_PATH`/`_BY_SETTLEMENT`): jede Art findet ihr Bild, und jedes Bild
 * liegt als Datei da. Die Zuordnung ist die Legacys - übernommen, nicht neu erfunden (Betreiber: „aussehn wie legacy“).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const headerDirectory = join(repositoryRoot, "apps/web/public/icons/header");
const menuDirectory = join(repositoryRoot, "apps/web/public/icons/menu");

/** Alle Arten der Regionen in `avesmaps3d_dev` (Satz 161832, gemessen 2026-10-04). */
const REGION_TYPES = [
    "wald",
    "see",
    "huegelland",
    "insel",
    "dschungel",
    "gebirge",
    "tal",
    "urwald",
    "suempfe_moore",
    "flussland_flusstal",
    "hochebene",
    "auenlandschaft",
    "kulturlandschaft",
    "meer",
    "region",
    "tiefebene",
    "wuestenoase",
    "graslandschaft",
    "steppe",
    "schlucht",
    "inselgruppe",
    "tundra",
    "wueste",
    "wadi",
    "flussdelta",
    "kueste",
    "kontinent",
];

describe("🔴 die Dateien: jede Grafik der Zuordnung liegt da, und keine liegt ohne Zuordnung da", () => {
    it("jeder Name in `HEADER_GRAPHICS` ist eine Datei im Ordner", () => {
        const missing = HEADER_GRAPHICS.filter((name) => !existsSync(join(headerDirectory, `${name}.webp`)));
        expect(missing).toEqual([]);
    });

    it("jede Datei im Ordner ist ein Name der Liste (kein verwaistes Bild)", () => {
        const files = readdirSync(headerDirectory)
            .filter((name) => name.endsWith(".webp"))
            .map((name) => name.slice(0, -".webp".length))
            .sort();
        expect(files).toEqual([...HEADER_GRAPHICS].sort());
    });

    it("jedes Bild ist ein verkleinertes WebP, kein Original (die Quellen sind 2 bis 3 MB)", () => {
        for (const name of HEADER_GRAPHICS) {
            expect(statSync(join(headerDirectory, `${name}.webp`)).size, name).toBeLessThan(150 * 1024);
        }
    });

    it("die Menüsymbole der Aktionskacheln liegen da", () => {
        for (const name of ["linkteilen", "sextant", "vorschlag", "papierkorb"]) {
            expect(existsSync(join(menuDirectory, `${name}.webp`)), name).toBe(true);
        }
    });

    it("die Adresse zeigt in `public/`", () => {
        expect(headerGraphicUrl("dorf")).toBe("/icons/header/dorf.webp");
    });
});

describe("Ort: nach der Größe, wie Legacy", () => {
    it("jede Ortsklasse hat ihr Bild; das Stadtviertel leiht das Gebäude; Unbekanntes zeigt das große Stadtbild", () => {
        expect(
            ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"].map(
                headerGraphicOfPlace,
            ),
        ).toEqual(["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "gebaeude"]);
        expect(headerGraphicOfPlace("unbekannt")).toBe("metropole");
        expect(headerGraphicOfPlace(undefined)).toBe("metropole");
    });
});

describe("Landschaft: nach der Art der Region", () => {
    it("🔴 jede Art, die es in den Daten gibt, findet ein Bild; nur Region, Kontinent und Unbekanntes zeigen das allgemeine", () => {
        const general = REGION_TYPES.filter((type) => headerGraphicOfLandscape(type) === "region");
        expect(general.sort()).toEqual(["kontinent", "region"]);
    });

    it("die Zuordnung Legacys: Hügelland → Hügel, Sümpfe und Moore → Sumpf, Tal und Ebenen → Ebene, Flussland und Delta → Fluss", () => {
        expect(headerGraphicOfLandscape("huegelland")).toBe("huegel");
        expect(headerGraphicOfLandscape("suempfe_moore")).toBe("sumpfmoor");
        expect(["tal", "tiefebene", "hochebene"].map(headerGraphicOfLandscape)).toEqual(["ebene", "ebene", "ebene"]);
        expect(["flussland_flusstal", "flussdelta"].map(headerGraphicOfLandscape)).toEqual(["fluss", "fluss"]);
        expect(headerGraphicOfLandscape("inselgruppe")).toBe("insel");
        expect(headerGraphicOfLandscape("schlucht")).toBe("gebirge");
        expect(headerGraphicOfLandscape(undefined)).toBe("region");
        expect(headerGraphicOfLandscape("etwas-neues")).toBe("region");
    });

    it("die vier Arten aus WI-0301 zeigen ihr eigenes KI-Typbild (Betreiber 2026-11-10), nicht mehr ein geliehenes", () => {
        expect(["savanne", "heideland", "oedland", "bergtundra"].map(headerGraphicOfLandscape)).toEqual([
            "savanne",
            "heideland",
            "oedland",
            "bergtundra",
        ]);
    });

    it("See und Hügel zeigen ihr eigenes Bild - nie ein leerer Kopf", () => {
        expect(headerGraphicOf("area", "see")).toBe("see");
        expect(headerGraphicOf("area", "huegelland")).toBe("huegel");
    });
});

describe("Weg, Kraftlinie, Gipfel, Gebiet", () => {
    it("jede Wegart hat ihr Bild; Unbekanntes zeigt das allgemeine", () => {
        expect(
            ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"].map(
                headerGraphicOfPath,
            ),
        ).toEqual(["reichsstrasse", "strasse", "weg", "pfad", "gebirgspass", "wuestenpfad", "flussweg", "seeweg"]);
        expect(headerGraphicOfPath("Querfeldein")).toBe("region");
        expect(headerGraphicOfPath(undefined)).toBe("region");
    });

    it("eine Kraftlinie hat EIN Bild, jede Landmarke das ihrer Art (WI-0271 L6), ein Gebiet sein eigenes", () => {
        expect(headerGraphicOf("powerline", undefined)).toBe("kraftlinien");
        expect(headerGraphicOf("peak", "berggipfel")).toBe("berggipfel");
        expect(headerGraphicOf("peak", "vulkan")).toBe("vulkan");
        expect(headerGraphicOf("peak", "hoehle")).toBe("hoehle");
        expect(headerGraphicOf("peak", "strudel")).toBe("strudel");
        // Ohne eigenes Bild: Geysir wie Quelle, Klippe wie Küste; eine unbekannte Art wie der Berggipfel.
        expect(headerGraphicOf("peak", "geysir")).toBe("quelle");
        expect(headerGraphicOf("peak", "klippe")).toBe("kueste");
        expect(headerGraphicOf("peak", "pass")).toBe("berggipfel");
        expect(headerGraphicOf("peak", undefined)).toBe("berggipfel");
        /*
         * 🔴 Seit dem Betreiberentscheid vom 2026-10-13 („ja zu allen drei“) hat das Gebiet eine EIGENE Kategorie. Vorher zeigte es
         * das allgemeine Bild, zusammen mit Klimabändern und namenlosen Landschaften; eine Baronie bekam damit dasselbe Bild wie ein
         * Klimaband. EINE Kategorie für alle 1.676 Gebiete, ausdrücklich nicht eine je Adelsrang.
         */
        expect(headerGraphicOf("territory", undefined)).toBe("gebiet");
        // Die politische Art ändert daran nichts: sie ist keine Landschaftsart, und es gibt kein Bild je Rang.
        expect(headerGraphicOf("territory", "Baronie")).toBe("gebiet");
        // Klimabänder und freie Kartenstellen bleiben beim allgemeinen Bild (dort war die Empfehlung nein).
        expect(headerGraphicOf("climate", undefined)).toBe("region");
        expect(headerGraphicOf("mapPoint", undefined)).toBe("region");
    });

    it("eine Etappe zeigt die Grafik ihrer Wegart", () => {
        expect(headerGraphicOf("routeStage", "Flussweg")).toBe("flussweg");
    });
});

describe("freie Kartenstelle: der erste Treffer, der wirklich ein Bild ergibt", () => {
    const item = (layer: string, type?: string) => ({
        ref: { kind: "area" as const, id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11" },
        layer,
        ...(type === undefined ? {} : { type }),
    });

    it("Vegetation vor Topographie; die Derographie ergibt kein Bild", () => {
        expect(
            headerGraphicOfPoint([
                item("derographisch", "kontinent"),
                item("topographie", "gebirge"),
                item("vegetation", "wald"),
            ]),
        ).toBe("wald");
        expect(headerGraphicOfPoint([item("topographie", "meer")])).toBe("meer");
        expect(headerGraphicOfPoint([item("derographisch", "kontinent")])).toBe("region");
        expect(headerGraphicOfPoint(undefined)).toBe("region");
    });

    it("ein Vegetationstreffer ohne Bild (Region, Kontinent) lässt die Suche weitergehen, statt blind den ersten zu nehmen", () => {
        expect(headerGraphicOfPoint([item("vegetation", "region"), item("vegetation", "dschungel")])).toBe("dschungel");
        expect(headerGraphicOfPoint([item("vegetation"), item("topographie", "see")])).toBe("see");
    });
});
