import { describe, expect, it } from "vitest";
import { SUBJECT_PATH_SUBTYPES, WIKI_WEGTYP, kennzeichenAusWiki, wegtypAusWiki } from "../src/index.ts";

/**
 * Die Zuordnung der Wiki-Wegarten zu unseren Wegtypen (WI-0225). Problemfälle: eine Zuordnung auf einen Schlüssel, den es nicht gibt;
 * die Karawanenroute oder eine Mischform bekommt still einen Wegtyp; Leerzeichen aus dem Wiki verhindern die Zuordnung.
 */
describe("wegtypAusWiki", () => {
    it("🔴 die Entscheidung des Betreibers: Kronstraße ist Reichsstraße, Karawanenroute und Mischformen ohne Zuordnung", () => {
        expect(wegtypAusWiki("Kronstraße")).toBe("Reichsstrasse");
        expect(wegtypAusWiki("Karawanenroute")).toBeUndefined();
        expect(wegtypAusWiki("Straße, Pass")).toBeUndefined();
        expect(wegtypAusWiki("Karawanenroute, Pass")).toBeUndefined();
        expect(wegtypAusWiki("")).toBeUndefined();
    });

    it("jede gemessene Wegart des lokalen Stands hat eine Zuordnung oder ist ausdrücklich ohne", () => {
        const gemessen = [
            "Straße",
            "Pass",
            "Karawanenroute",
            "Kronstraße",
            "Reichsstraße",
            "ehemalige Reichsstraße",
            "Reichslandstraße",
            "Straße, Pass",
            "Karawanenroute, Pass",
            "Knüppeldamm",
            "Landstraße",
            "Stieg",
            "Pilgerweg",
            "Damm",
            "Waldweg",
            "Pfad",
        ];
        const ohne = new Set(["Karawanenroute", "Straße, Pass", "Karawanenroute, Pass"]);
        for (const art of gemessen) expect(wegtypAusWiki(art) === undefined, art).toBe(ohne.has(art));
    });

    it("zugeordnet wird nur auf vorhandene Wegtypen, und Leerzeichen stören nicht", () => {
        for (const ziel of Object.values(WIKI_WEGTYP)) expect(SUBJECT_PATH_SUBTYPES).toContain(ziel);
        expect(wegtypAusWiki("  Pass ")).toBe("Gebirgspass");
    });
});

describe("kennzeichenAusWiki (WI-0177 §30)", () => {
    it("🔴 nur die Karawanenroute trägt das Kennzeichen; jede andere Art keins; die Mischform mit ihr bleibt ohne Zuordnung", () => {
        expect(kennzeichenAusWiki("Karawanenroute")).toBe("karawanenroute");
        expect(kennzeichenAusWiki(" Karawanenroute ")).toBe("karawanenroute");
        expect(kennzeichenAusWiki("Pfad")).toBe("");
        expect(kennzeichenAusWiki("Straße, Pass")).toBe("");
        expect(kennzeichenAusWiki("Karawanenroute, Pass")).toBeUndefined();
    });
});
