import { describe, expect, it } from "vitest";
import { WATER_CARTOGRAPHY_LAYER, isWaterPathSubtype } from "@avesmaps3d/shared";
import { areaCandidates, nextCandidate, pathCandidates, type AreaCandidate } from "../src/map/area-candidates.ts";

/**
 * Welche Fläche ein Klick nimmt (WI-0043 Stufe 2, Betreiber 2026-09-28: „A+B+C“). Vorher gewann die oberste
 * gezeichnete, und welche das war, entschied die Reihenfolge in der Kachel.
 */

const feature = (id: string, area: unknown, type = "gebirge", name = id) => ({
    properties: { region_public_id: id, region_type: type, name, area },
});

describe("Flächen unter dem Zeiger", () => {
    it("🔴 nimmt die kleinste zuerst, unabhängig von der Reihenfolge in der Kachel", () => {
        const kachel = [feature("huegel", 2343, "huegelland"), feature("koschberge", 598), feature("massiv", 96)];
        for (const reihenfolge of [kachel, [...kachel].reverse()]) {
            expect(areaCandidates(reihenfolge).map((c) => c.id)).toEqual(["massiv", "koschberge", "huegel"]);
        }
    });

    it("nennt jede Region einmal, mit ihrer kleinsten Teilfläche, und stellt Flächen ohne Größe hinten an", () => {
        const found = areaCandidates([feature("a", 50), feature("b", undefined), feature("a", 20), feature("c", 30)]);
        expect(found.map((c) => [c.id, c.area])).toEqual([
            ["a", 20],
            ["c", 30],
            ["b", Number.POSITIVE_INFINITY],
        ]);
    });

    it("🔴 lässt eine für Klicks gesperrte Fläche aus (WI-0178 D1, EDIT-0003 T53), aus der Kachel wie vom Server", () => {
        const gesperrt = { properties: { ...feature("aventurien", 9e6, "kontinent").properties, is_locked: true } };
        const frei = { properties: { ...feature("tal", 40, "tal").properties, is_locked: false } };
        expect(areaCandidates([gesperrt, frei, feature("berg", 50)]).map((c) => c.id)).toEqual(["tal", "berg"]);
        expect(areaCandidates([gesperrt])).toEqual([]);
    });

    it("zeigt einen Griff nicht als Namen", () => {
        const [candidate] = areaCandidates([feature("w", 5, "wald", "Wald-925")]);
        expect(candidate?.name).toBeNull();
    });
});

/**
 * Die Landschaftsebene am Kandidaten (WI-0083): Daran hängt, in welcher Ansicht er teilnimmt (`areaLayersInView`).
 * Drei Quellen, eine Antwort: `region_layer` der Kachel, die Kartografie-Tafel über die Art, und beim Fluss die Ebene des
 * Wassers (Nachtrag, Betreiber 2026-10-05 „ja“: ein Fluss ist Wasser wie ein See).
 */
describe("die Ebene einer Fläche", () => {
    it("kommt aus der Kachel, wo sie sie führt (`region_area_render`)", () => {
        const [candidate] = areaCandidates([
            { properties: { region_public_id: "w", region_layer: "vegetation", region_type: "wald", area: 5 } },
        ]);
        expect(candidate?.layer).toBe("vegetation");
    });

    it("🔴 und sonst aus der Kartografie-Tafel: See und Meer liegen in der Topographie", () => {
        // Die geglättete Wasserquelle (`terrain_water_render`) führt nur die Art.
        for (const type of ["see", "meer"]) {
            const [candidate] = areaCandidates([
                { properties: { region_public_id: type, region_type: type, area: 5 } },
            ]);
            expect(candidate?.layer, type).toBe("topographie");
        }
        expect(areaCandidates([feature("t", 5, "gebirge")])[0]?.layer).toBe("topographie");
        expect(areaCandidates([feature("v", 5, "wald")])[0]?.layer).toBe("vegetation");
        expect(areaCandidates([feature("d", 5, "kontinent")])[0]?.layer).toBe("derographisch");
    });

    it("🪤 eine Fläche ohne Art behauptet keine Ebene (sie nimmt dann überall teil)", () => {
        const [candidate] = areaCandidates([{ properties: { region_public_id: "x", region_type: "", area: 5 } }]);
        expect(candidate?.layer).toBeUndefined();
    });

    it("🔴 ein Fluss trägt die Ebene des WASSERS: er ist Wasser wie ein See (Nachtrag zu WI-0083)", () => {
        // Die Wegetafel sagt, welche Wegart Wasser ist; die Kartografie-Tafel, in welcher Ebene das Wasser liegt.
        expect(WATER_CARTOGRAPHY_LAYER).toBe("topographie");
        expect(isWaterPathSubtype("Flussweg")).toBe(true);
        for (const bach of [false, true]) {
            const [candidate] = pathCandidates([
                { properties: { name: "Gardel", subtype: "Flussweg", is_bach: bach } },
            ]);
            expect(candidate?.layer, `is_bach=${String(bach)}`).toBe(WATER_CARTOGRAPHY_LAYER);
        }
        // Der Seeweg ist in der Tafel ebenfalls Wasser (er steht nur auf keiner Karte).
        expect(pathCandidates([{ properties: { name: "Perlenroute", subtype: "Seeweg" } }])[0]?.layer).toBe(
            WATER_CARTOGRAPHY_LAYER,
        );
    });

    it("🪤 ein Weg, der kein Wasser ist, behauptet keine Ebene - und ein Gebiet auch nicht", () => {
        expect(isWaterPathSubtype("Strasse")).toBe(false);
        expect(
            pathCandidates([{ properties: { name: "Reichsstraße", subtype: "Strasse" } }])[0]?.layer,
        ).toBeUndefined();
        const [gebiet] = areaCandidates([
            { properties: { territory_public_id: "g1", name: "Baronie", territory_type: "Baronie", area: 3 } },
        ]);
        expect(gebiet?.layer).toBeUndefined();
    });
});

describe("Herrschaftsgebiete unter dem Zeiger (WI-0062)", () => {
    const gebiet = (id: string, area: unknown, name: string) => ({
        properties: {
            territory_public_id: id,
            name,
            territory_type: "Baronie",
            area,
        },
    });

    it("🔴 nimmt ein Gebiet über seine Kennung, mit Art - der Name kommt unverändert", () => {
        const [candidate] = areaCandidates([gebiet("g1", 12, "Baronie Hahnfels")]);
        expect(candidate).toEqual({
            kind: "territory",
            id: "g1",
            name: "Baronie Hahnfels",
            type: "Baronie",
            area: 12,
        });
    });

    it("liegen zwei Gebiete an einer Stelle (Überlappung), kommt das kleinere zuerst - wie bei den Landschaften", () => {
        const found = areaCandidates([gebiet("gross", 300, "Grafschaft"), gebiet("klein", 4, "Baronie")]);
        expect(found.map((c) => c.id)).toEqual(["klein", "gross"]);
        expect(nextCandidate(found, "klein")?.id).toBe("gross");
    });
});

describe("Durchklicken", () => {
    const stack = areaCandidates([feature("klein", 1), feature("mittel", 2), feature("gross", 3)]);

    it("wählt ohne Auswahl die kleinste, mit Auswahl hier die nächstgrößere, nach der größten wieder die kleinste", () => {
        expect(nextCandidate(stack, undefined)?.id).toBe("klein");
        expect(nextCandidate(stack, "klein")?.id).toBe("mittel");
        expect(nextCandidate(stack, "mittel")?.id).toBe("gross");
        expect(nextCandidate(stack, "gross")?.id).toBe("klein");
    });

    it("beginnt von vorn, wenn die gewählte Fläche nicht hier liegt", () => {
        expect(nextCandidate(stack, "anderswo")?.id).toBe("klein");
        expect(nextCandidate([], undefined)).toBeUndefined();
    });
});

describe("Wege unter dem Zeiger (WI-0090; davor nur Flüsse)", () => {
    // Betreiber 2026-09-28 für den Fluss: „obwohl flüsse und seen zu den topographischen features gehören, kann ich sie
    // noch nicht anklicken“; Betreiber 2026-10-06 für jeden Weg: „wege kann man noch nicht anklicken“. Ein Weg ist sein
    // Name, über Wegtypen hinweg, wie in der Suche (WI-0044, WI-0177 Schritt 2b).
    const linie = (name: unknown, subtype = "Flussweg", bach = false) => ({
        properties: { name, subtype, is_bach: bach },
    });

    it("🔴 je Weg einmal, mit dem Kettenschlüssel der Suche", () => {
        const found = pathCandidates([linie("Gardel"), linie("Gardel"), linie("Natter", "Flussweg", true)]);
        expect(found.map((c) => [c.kind, c.id, c.area, c.bach])).toEqual([
            ["path", "name:Gardel", 0, false],
            ["path", "name:Natter", 0, true],
        ]);
    });

    it("🔴 jede Wegart, nicht nur das Wasser: Straße, Pfad und Pass sind Wege (WI-0090)", () => {
        const found = pathCandidates([
            linie("Reichsstraße 2", "Reichsstrasse"),
            linie("Eslamsbrücker Weg", "Weg"),
            linie("Nebelpass", "Gebirgspass"),
        ]);
        expect(found.map((c) => c.id)).toEqual(["name:Reichsstraße 2", "name:Eslamsbrücker Weg", "name:Nebelpass"]);
        // Keine Ebene: Eine Straße nimmt in jeder Ansicht teil, in der sie gezeichnet ist.
        expect(found.every((c) => c.layer === undefined)).toBe(true);
    });

    it("🪤 die Reihenfolge der Abfrage bleibt: oberster Weg zuerst, NICHT nach Namen sortiert", () => {
        // `queryRenderedFeatures` gibt den obersten Treffer zuerst, und oben liegt nach der Kartografie-Tafel die
        // Reichsstraße. Eine Sortierung nach Namen (so war es beim Fluss) zöge an einer Kreuzung den Pfad davor.
        const found = pathCandidates([linie("Reichsstraße 2", "Reichsstrasse"), linie("Alter Pfad", "Pfad")]);
        expect(found.map((c) => c.id)).toEqual(["name:Reichsstraße 2", "name:Alter Pfad"]);
    });

    it("🔴 derselbe Name auf zwei Wegtypen ist EIN Weg; seine Art ist die des obersten Abschnitts (WI-0177 Schritt 2b)", () => {
        const found = pathCandidates([linie("Reichsstraße 2", "Pfad"), linie("Reichsstraße 2", "Reichsstrasse")]);
        expect(found.map((c) => [c.id, c.type])).toEqual([["name:Reichsstraße 2", "Pfad"]]);
    });

    it("🪤 ein Lauf ohne Namen ist kein wählbarer Weg: Es gibt keine Kette, die man ganz nehmen könnte", () => {
        expect(pathCandidates([linie(""), linie(null), linie("  ")])).toEqual([]);
    });

    it("Flächen tragen ihre Art: Landschaft", () => {
        expect(areaCandidates([feature("see", 5, "see")])[0]?.kind).toBe("landscape");
    });

    it("🔴 Durchklicken bleibt dieselbe Funktion, auch über die Besitzergrenze (WI-0043 Stufe 2 B)", () => {
        // Der Besitzer `path` zählt mit `nextCandidate` innerhalb seiner Wege; liegt nur der gewählte hier, tritt er
        // zurück und die Fläche darunter kommt dran (`path-selection-input.ts`).
        const wege: AreaCandidate[] = pathCandidates([linie("Gardel"), linie("Natter", "Flussweg", true)]);
        expect(nextCandidate(wege, undefined)?.id).toBe("name:Gardel");
        expect(nextCandidate(wege, "name:Gardel")?.id).toBe("name:Natter");
        expect(nextCandidate(wege, "name:Natter")?.id).toBe("name:Gardel");
    });
});
