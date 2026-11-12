import { describe, expect, it } from "vitest";
import { KARTE_VERSION_MAX, type MamKarteBild, type MamKarteZeile } from "@avesmaps3d/shared";
import {
    ZIEL_TREFFER,
    erstesWort,
    vorschlagVersion,
    zielTreffer,
    zusammenlegenFolgen,
} from "../src/medien/medien-karte-zusammenlegen-modell";

/**
 * Was „Bilder an anderen Eintrag geben“ und „Weitere Version eines Eintrags“ rechnen (WI-0287 Stufe 2, Entwurf Fassung 5): die Vorbelegung des Felds „Version“, die Namensvettern
 * der Zielwahl und die Folgen, die der Dialog vorher nennt. Was der Server tut, prüft `apps/server/test/media-karte-zusammenlegen.test.ts`.
 */

const zeile = (id: string, title: string, active = true): MamKarteZeile => ({
    id,
    title,
    art: null,
    types: [],
    places: 0,
    state: active ? "active" : "retired",
    active,
    validFromBf: null,
    validToBf: null,
    images: 0,
    publicImages: 0,
    preview: null,
    privatePreview: null,
});

const bild = (role: "map_full" | "map_preview", assetId: string, title: string | null): MamKarteBild => ({
    role,
    assetId,
    title,
    origin: "editor",
    override: "none",
    publication: { public: false, reason: "rights_unknown" },
    preview: null,
    privatePreview: null,
});

describe("Die Vorbelegung des Felds „Version“", () => {
    it("der Rest des Titels hinter dem Titel des Ziels, sonst der ganze Titel", () => {
        expect(vorschlagVersion("Re'Cha Spielerversion", "Re'Cha")).toBe("Spielerversion");
        expect(vorschlagVersion("Sylla SL-Version", "Sylla")).toBe("SL-Version");
        expect(vorschlagVersion("  Porto Paligan   Spielerversion ", "Porto Paligan")).toBe("Spielerversion");
        // Groß und klein zählt nicht; ohne Rest (Dublette) oder ohne gemeinsamen Anfang der ganze Titel.
        expect(vorschlagVersion("re'cha spielerversion", "Re'Cha")).toBe("spielerversion");
        expect(vorschlagVersion("Aventuria", "Aventuria")).toBe("Aventuria");
        expect(vorschlagVersion("2011 Yol-Gurmak", "Yol-Gurmak")).toBe("2011 Yol-Gurmak");
    });

    it("nie länger, als eine Bezeichnung sein darf", () => {
        expect(vorschlagVersion("x".repeat(KARTE_VERSION_MAX + 20), "Ziel")).toHaveLength(KARTE_VERSION_MAX);
    });
});

describe("Die Zielwahl", () => {
    it("das erste Wort, klein, ohne Ränder und ohne Satzzeichen am Ende", () => {
        expect(erstesWort("  Re'Cha Spielerversion")).toBe("re'cha");
        expect(erstesWort("Sylla")).toBe("sylla");
        expect(erstesWort("Gareth, Gesamtplan")).toBe("gareth");
        expect(erstesWort("   ")).toBe("");
    });

    const liste = [
        zeile("a", "Re'Cha"),
        zeile("b", "Re'Cha Spielerversion"),
        zeile("c", "Re'Chaer Hafen"),
        zeile("d", "Re'Cha alt", false),
        zeile("e", "Gareth"),
    ];

    it("ohne Suchwort die Namensvettern: gleiches erstes Wort, nie der Eintrag selbst, nie ein stillgelegter", () => {
        expect(zielTreffer(liste, "b", "", "re'cha").map((z) => z.id)).toEqual(["a"]);
        expect(zielTreffer(liste, undefined, "", "re'cha").map((z) => z.id)).toEqual(["a", "b"]);
        expect(zielTreffer(liste, "b", "", "")).toEqual([]);
    });

    it("mit Suchwort, was der Server fand, ohne den Eintrag selbst; höchstens sechs", () => {
        expect(zielTreffer(liste, "b", "hafen", "re'cha").map((z) => z.id)).toEqual(["a", "c", "e"]);
        const viele = Array.from({ length: 10 }, (_, i) => zeile(`z${String(i)}`, `Gareth ${String(i)}`));
        expect(zielTreffer(viele, undefined, "gareth", "")).toHaveLength(ZIEL_TREFFER);
    });
});

describe("Die Folgen des Zusammenlegens", () => {
    it("neue Versionen, schon vorhandene und die Vorschau, die mitzieht", () => {
        const folgen = zusammenlegenFolgen(
            {
                images: [
                    bild("map_full", "1", "Spielerkarte"),
                    bild("map_full", "2", null),
                    bild("map_preview", "9", "V"),
                ],
            },
            { images: [bild("map_full", "2", "Gemeinsam")] },
        );
        expect(folgen).toEqual({ neu: ["Spielerkarte"], doppelt: ["Vollbild"], vorschau: "zieht" });
    });

    it("hat das Ziel eine Vorschau, bleibt die übergebene in der Liste; ohne Vorschau keine Zeile", () => {
        const ziel = { images: [bild("map_preview", "8", "Eigene")] };
        expect(zusammenlegenFolgen({ images: [bild("map_preview", "9", "V")] }, ziel).vorschau).toBe("bleibt");
        expect(zusammenlegenFolgen({ images: [] }, ziel)).toEqual({ neu: [], doppelt: [], vorschau: undefined });
    });
});
