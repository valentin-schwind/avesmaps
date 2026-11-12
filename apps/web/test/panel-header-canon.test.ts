import { afterEach, describe, expect, it } from "vitest";
import type { SubjectCanon } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { canonPillOf } from "../src/info-panel/panel-header";

/**
 * Die Kanon-Pille folgt der Regel aus `project-control/migration/contracts/sources.yaml` (`kanon.raenge`, WI-0253 B-2): links der Kanon,
 * rechts optional ein Bezeichner; ohne ihn ist die Pille rund. Problemfälle: OFFIZIELL zeigte nie einen Bezeichner, verschiedene Arten
 * zeigten nirgends die Anzahl, und „Avesmaps“ (Rang 4) kam nur als Zeichenkette von der Tafel.
 */

afterEach(() => setLocale("de"));

describe("canonPillOf: die sechs Fälle der Regel", () => {
    it("OFFIZIELL ohne Bezeichner ist rund", () => {
        expect(canonPillOf({ canon: "official" })).toEqual({ state: "official" });
    });

    it("OFFIZIELL | Art, wenn alle zählenden Quellen dieselbe Art haben (Rang 2)", () => {
        expect(canonPillOf({ canon: "official", designatorType: "regionalspielhilfe" })).toEqual({
            state: "official",
            by: "Regionalspielhilfe",
        });
    });

    it("OFFIZIELL | n Quellen, wenn die Arten verschieden sind", () => {
        expect(canonPillOf({ canon: "official", designatorCount: 3 })).toEqual({ state: "official", by: "3 Quellen" });
    });

    it("INOFFIZIELL | Art, mit der Anzahl dahinter, wenn es mehrere Quellen derselben Art sind (Rang 3, Legacy „Briefspiel (2)“)", () => {
        expect(canonPillOf({ canon: "unofficial", designatorType: "briefspiel" })).toEqual({
            state: "unofficial",
            by: "Briefspiel",
        });
        expect(canonPillOf({ canon: "unofficial", designatorType: "briefspiel", designatorCount: 2 })).toEqual({
            state: "unofficial",
            by: "Briefspiel (2)",
        });
    });

    it("INOFFIZIELL | n Quellen bei verschiedenen Arten", () => {
        expect(canonPillOf({ canon: "unofficial", designatorCount: 4 })).toEqual({
            state: "unofficial",
            by: "4 Quellen",
        });
    });

    it("INOFFIZIELL | Wiki Aventurica (Rang 1) und INOFFIZIELL | Avesmaps (Rang 4): der feste Bezeichner der Zeile", () => {
        expect(canonPillOf({ canon: "unofficial", designatorLabel: "Wiki Aventurica" })).toEqual({
            state: "unofficial",
            by: "Wiki Aventurica",
        });
        expect(canonPillOf({ canon: "unofficial", designatorLabel: "Avesmaps" })).toEqual({
            state: "unofficial",
            by: "Avesmaps",
        });
    });
});

describe("canonPillOf: Randfälle", () => {
    it("INOFFIZIELL ohne Bezeichner (Rang 4 mit leerem Tafelwert) ist eine runde Pille", () => {
        expect(canonPillOf({ canon: "unofficial" })).toEqual({ state: "unofficial" });
    });

    it("kein Etikett: ohne Kanon und bei „unlabelled“", () => {
        expect(canonPillOf(undefined)).toBeUndefined();
        expect(canonPillOf({ canon: "unlabelled" })).toBeUndefined();
        // Auch ein Bezeichner macht aus „nichts zu sagen“ kein Etikett.
        expect(canonPillOf({ canon: "unlabelled", designatorCount: 2 })).toBeUndefined();
    });

    it("der feste Bezeichner schlägt Art und Anzahl, auch bei OFFIZIELL", () => {
        const canon: SubjectCanon = {
            canon: "official",
            designatorLabel: "Avesmaps",
            designatorType: "roman",
            designatorCount: 2,
        };
        expect(canonPillOf(canon)).toEqual({ state: "official", by: "Avesmaps" });
    });

    it("eine Art ohne Tafelwort steht, wie sie geliefert wird", () => {
        expect(canonPillOf({ canon: "unofficial", designatorType: "neue_art" })).toEqual({
            state: "unofficial",
            by: "neue_art",
        });
    });

    it("die Zählform wählt die Sprache: Englisch, Französisch und Polnisch (1, 2 bis 4, 5 und mehr)", async () => {
        await setLocale("en");
        expect(canonPillOf({ canon: "official", designatorCount: 3 })?.by).toBe("3 sources");
        await setLocale("fr");
        expect(canonPillOf({ canon: "unofficial", designatorCount: 2 })?.by).toBe("2 sources");
        await setLocale("pl");
        expect(canonPillOf({ canon: "official", designatorCount: 2 })?.by).toBe("2 źródła");
        expect(canonPillOf({ canon: "official", designatorCount: 5 })?.by).toBe("5 źródeł");
        expect(canonPillOf({ canon: "official", designatorCount: 22 })?.by).toBe("22 źródła");
    });
});
