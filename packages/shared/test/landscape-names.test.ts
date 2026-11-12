import { describe, expect, it } from "vitest";
import { isLandscapeHandle, landscapeReaderName } from "../src/landscape-names.ts";

/**
 * Wie eine Landschaft für einen Leser heißt (Legacy `ecosystemRegionLeserName`): Die Routen-Landschaften
 * (WI-0035) und die angeklickte Fläche (WI-0043) teilen diese eine Regel.
 */

describe("Griffe statt Namen (Legacy `ecosystemRegionNameIsGriff`)", () => {
    it("erkennt den Griff der Art und den Rückfall „Fläche“, ohne Rücksicht auf die Schreibweise", () => {
        expect(isLandscapeHandle("Wald-925", "wald")).toBe(true);
        expect(isLandscapeHandle("hügelland-003", "huegelland")).toBe(true);
        expect(isLandscapeHandle("Sümpfe und Moore-12", "suempfe_moore")).toBe(true);
        // Vergeben, als die Fläche noch keine Art hatte - heute ein Urwald (Legacy, 14.09.2026).
        expect(isLandscapeHandle("Fläche-048", "urwald")).toBe(true);
        expect(isLandscapeHandle("  ", "wald")).toBe(true);
    });

    it("lässt echte Namen stehen, auch wenn sie auf eine Zahl enden", () => {
        expect(isLandscapeHandle("Farindelwald", "wald")).toBe(false);
        expect(isLandscapeHandle("Wald der Wälder-2", "wald")).toBe(false);
        // Ein Griff einer ANDEREN Art ist ein Name: Die Region hat die Art gewechselt und behielt ihn.
        expect(isLandscapeHandle("Gebirge-004", "wald")).toBe(false);
    });
});

describe("Die drei Arten, die Legacy am 04.10.2026 nachtrug (WI-0105, Befund B1)", () => {
    it("🔴 Gletscher: die 20 Griffe des Bestands sind Griffe, seine zwei echten Namen bleiben Namen", () => {
        // Gemessen: 22 aktive Gletscher, davon 20 mit Griff. Ohne den Eintrag im Katalog fiel die Art auf
        // „Fläche“ zurück, `Gletscher-001` traf das Muster nicht - und der Griff stand roh im Panel.
        for (let n = 1; n <= 20; n += 1) {
            const griff = `Gletscher-${String(n).padStart(3, "0")}`;
            expect(isLandscapeHandle(griff, "gletscher")).toBe(true);
            expect(landscapeReaderName(griff, "gletscher")).toBeNull();
        }
        // 🪤 DIE GEFÄHRLICHE STELLE, und sie steht wirklich im Bestand: ein Name, der auf „-Gletscher“
        // endet, nicht auf eine Zahl.
        expect(landscapeReaderName("Knollennasen-Gletscher", "gletscher")).toBe("Knollennasen-Gletscher");
        expect(landscapeReaderName("Gletscherfeld in der westlichen Grimfrostöde", "gletscher")).toBe(
            "Gletscherfeld in der westlichen Grimfrostöde",
        );
    });

    it("Eislandschaft: der Griff wäre einer; im Bestand tragen alle sieben einen echten Namen", () => {
        expect(isLandscapeHandle("Eislandschaft-7", "eislandschaft")).toBe(true);
        expect(landscapeReaderName("Eiswüste der Firnklippten", "eislandschaft")).toBe("Eiswüste der Firnklippten");
    });

    it("Schneelandschaft: vorsorglich eingetragen - im Bestand gibt es sie noch nicht", () => {
        // 0 Zeilen, aktiv wie inaktiv; der Betreiber 2026-10-08: „das WA wird sie bald nachreichen“.
        expect(isLandscapeHandle("Schneelandschaft-1", "schneelandschaft")).toBe(true);
        expect(landscapeReaderName("Firunsfeld", "schneelandschaft")).toBe("Firunsfeld");
    });
});

describe("Die zwei Küstenformen aus demselben Nachtrag (WI-0105, Befund B9)", () => {
    it("🔴 Flachküste und Steilküste: der Griff ist einer, ihre echten Namen bleiben Namen", () => {
        // 🪤 Die Lücke war LATENT, nicht sichtbar: Im Bestand steht je EINE aktive Fläche, und beide tragen
        // einen echten Namen. Ohne Katalogeintrag fällt die Art aber auf „Fläche“ zurück, und ein künftiges
        // `Flachküste-003` rutschte als Name durch - genau wie `Gletscher-001` es tat.
        expect(isLandscapeHandle("Flachküste-3", "flachkueste")).toBe(true);
        expect(isLandscapeHandle("Steilküste-12", "steilkueste")).toBe(true);
        // Die zwei Namen, die wirklich im Bestand stehen.
        expect(landscapeReaderName("Ufer des Nebelmoors", "flachkueste")).toBe("Ufer des Nebelmoors");
        expect(landscapeReaderName("Nordküste des Neunaugensees", "steilkueste")).toBe("Nordküste des Neunaugensees");
    });

    it("🪤 die allgemeine `kueste` bleibt eine eigene Art, mit eigenem Griff", () => {
        // Legacy ausdrücklich: „Die allgemeine `kueste` BLEIBT … eine Kueste ohne Aussage zur Form ist weiter
        // eine gueltige Angabe.“ Zwei aktive Flächen tragen sie („Garbelner Dünenküste“, „Siebenwind-Küste“).
        expect(isLandscapeHandle("Küste-7", "kueste")).toBe(true);
        expect(isLandscapeHandle("Flachküste-7", "kueste")).toBe(false);
        expect(landscapeReaderName("Siebenwind-Küste", "kueste")).toBe("Siebenwind-Küste");
    });
});

describe("Der Name für den Leser", () => {
    it("ist der Name, ohne Rand, oder nichts, wo nur ein Griff steht", () => {
        expect(landscapeReaderName(" Reichsforst ", "urwald")).toBe("Reichsforst");
        expect(landscapeReaderName("Wald-925", "wald")).toBeNull();
    });
});
