import { describe, expect, it } from "vitest";
import {
    AVENTURIA_SERIES,
    KARTENSERIE_THUMB_VORGABE,
    istKartenserieKennung,
    wirksamerKatalog,
    type KartenserieZeile,
} from "../src/index.ts";

/**
 * Der wirksame Katalog der Kartenserien (WI-0220): Vorgabe aus der JSON, überschrieben von den Zeilen der Tafel `map_series`, dazu
 * neue Serien, ohne Papierkorb, in der Reihenfolge des Fächers.
 */

const leer = (id: string, felder: Partial<KartenserieZeile> = {}): KartenserieZeile => ({
    id,
    label: null,
    description: null,
    visibility: null,
    labelsInImage: null,
    sortOrder: null,
    thumb: null,
    author: null,
    origin: null,
    derivation: null,
    permissionStatement: null,
    attribution: null,
    en: null,
    sourcePixels: null,
    maxNativeZoom: null,
    isDefault: false,
    status: "aktiv",
    ...felder,
});

const ids = (zeilen: KartenserieZeile[]) => wirksamerKatalog(AVENTURIA_SERIES, zeilen).series.map((s) => s.id);

describe("wirksamer Katalog der Kartenserien", () => {
    it("🔴 ohne Zeile: genau die Vorgabe, in Legacys Reihenfolge des Fächers (Modern, Original, Old)", () => {
        const katalog = wirksamerKatalog(AVENTURIA_SERIES, []);
        expect(katalog.series.map((s) => s.id)).toEqual(["modern", "original", "old"]);
        expect(katalog.defaultSeries).toBe("modern");
        expect(katalog.license).toEqual(AVENTURIA_SERIES.license);
        expect(katalog.series.find((s) => s.id === "old")?.visibility).toBe("PUBLIC");
        expect(katalog.series.every((s) => s.thumb === undefined)).toBe(true);
    });

    it("eine Abweichung überschreibt nur ihre Felder; ein leeres Feld bleibt die Vorgabe", () => {
        const katalog = wirksamerKatalog(AVENTURIA_SERIES, [
            leer("original", { label: "Ina Kramer", thumb: { x: 3, y: 9 }, en: { attribution: "Map material" } }),
        ]);
        const original = katalog.series.find((s) => s.id === "original")!;
        const vorgabe = AVENTURIA_SERIES.series.find((s) => s.id === "original")!;
        expect(original.label).toBe("Ina Kramer");
        expect(original.thumb).toEqual({ x: 3, y: 9 });
        expect(original.description).toBe(vorgabe.description);
        expect(original.en.attribution).toBe("Map material");
        expect(original.en.origin).toBe(vorgabe.en.origin);
    });

    it("Beschriftung im Bild folgt der Zeile: für alle oder nur für Editoren (Betreiber 2026-11-10, Besucher nur unter „Nur Karte“)", () => {
        const katalog = wirksamerKatalog(AVENTURIA_SERIES, [leer("old", { visibility: "EDITOR_ONLY" })]);
        expect(katalog.series.find((s) => s.id === "old")?.visibility).toBe("EDITOR_ONLY");
    });

    it("der Papierkorb nimmt eine Serie aus dem Katalog; liegt die Vorgabe darin, gilt die nächste für alle sichtbare", () => {
        expect(ids([leer("original", { status: "papierkorb" })])).toEqual(["modern", "old"]);
        const katalog = wirksamerKatalog(AVENTURIA_SERIES, [leer("modern", { status: "papierkorb" })]);
        expect(katalog.defaultSeries).toBe("original");
    });

    it("🔴 eine Vorgabe nur für Editoren oder mit Beschriftung im Bild gilt nicht; die Vorgabe sehen alle in jeder Ansicht", () => {
        expect(wirksamerKatalog(AVENTURIA_SERIES, [leer("old", { isDefault: true })]).defaultSeries).toBe("modern");
        expect(
            wirksamerKatalog(AVENTURIA_SERIES, [leer("original", { isDefault: true, visibility: "EDITOR_ONLY" })])
                .defaultSeries,
        ).toBe("modern");
        // Ohne Modern und Original bleibt keine Serie, die alle überall sehen: Old wird es trotzdem nicht.
        expect(
            wirksamerKatalog(AVENTURIA_SERIES, [
                leer("modern", { status: "papierkorb" }),
                leer("original", { status: "papierkorb" }),
            ]).defaultSeries,
        ).toBe("modern");
        expect(wirksamerKatalog(AVENTURIA_SERIES, [leer("original", { isDefault: true })]).defaultSeries).toBe(
            "original",
        );
    });

    it("die Reihenfolge folgt `sortOrder`, ohne Angabe die Vorgabe", () => {
        expect(ids([leer("old", { sortOrder: -1 })])).toEqual(["old", "modern", "original"]);
    });

    it("eine neue Serie erscheint erst mit Kantenlänge, Stufe und Namen, sonst nicht", () => {
        expect(ids([leer("nacht", { label: "Nacht" })])).toEqual(["modern", "original", "old"]);
        const katalog = wirksamerKatalog(AVENTURIA_SERIES, [
            leer("nacht", { label: "Nacht", sourcePixels: 65536, maxNativeZoom: 7, visibility: "PUBLIC" }),
        ]);
        const nacht = katalog.series.find((s) => s.id === "nacht")!;
        expect(katalog.series.at(-1)?.id).toBe("nacht");
        expect(nacht).toMatchObject({ tileSize: 512, maxNativeZoom: 7, sourcePixels: 65536, visibility: "PUBLIC" });
        expect(nacht.derivationStatus).toBe("UNDOCUMENTED");
    });

    it("eine neue Serie ohne Angabe ist nur für Editoren", () => {
        const katalog = wirksamerKatalog(AVENTURIA_SERIES, [
            leer("nacht", { label: "Nacht", sourcePixels: 32768, maxNativeZoom: 6 }),
        ]);
        expect(katalog.series.find((s) => s.id === "nacht")?.visibility).toBe("EDITOR_ONLY");
    });

    it("eine Zeile mit einer Kennung außerhalb des Musters wird übergangen", () => {
        expect(ids([leer("Nacht-2", { label: "x", sourcePixels: 1, maxNativeZoom: 1 })])).toEqual([
            "modern",
            "original",
            "old",
        ]);
        expect(istKartenserieKennung("nacht")).toBe(true);
        expect(istKartenserieKennung("nacht2")).toBe(false);
        expect(istKartenserieKennung("a".repeat(25))).toBe(false);
    });

    it("das Bild im Fächer ist ohne Wahl Gareth (Kachel 5/17/15)", () => {
        expect(KARTENSERIE_THUMB_VORGABE).toEqual({ x: 17, y: 15 });
    });
});
