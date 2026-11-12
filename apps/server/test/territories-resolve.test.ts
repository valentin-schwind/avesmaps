import { describe, expect, it } from "vitest";
import {
    assignAreasToBands,
    bandContains,
    currentAreas,
    displayedTerritories,
    effectiveChain,
    isGenericGroupName,
    isValidAt,
    pickDisplayTerritory,
    type AreaNode,
    type TerritoryNode,
} from "../src/territories/resolve.ts";

/**
 * Welches Gebiet zeigt eine Fläche in welchem Band? (WI-0062, ADR-0014, F2 „wie Legacy“.) Die Rechnung ist rein: hier
 * ohne Datenbank, gegen Legacys Regel (`avesmapsPoliticalResolveLayerDisplayTerritoryId`).
 */

function territory(
    id: number,
    name: string,
    parentId: number | null,
    band: [number | null, number | null],
    validity: [number | null, number | null] = [null, null],
): TerritoryNode {
    return {
        id,
        publicId: `t-${String(id)}`,
        name,
        parentId,
        minZoom: band[0],
        maxZoom: band[1],
        validFromBf: validity[0],
        validToBf: validity[1],
    };
}

function area(id: number, territoryId: number, extra: Partial<AreaNode> = {}): AreaNode {
    return {
        id,
        publicId: `a-${String(id)}`,
        territoryId,
        validFromBf: null,
        validToBf: null,
        minZoom: null,
        maxZoom: null,
        ...extra,
    };
}

/** Ein Reich (Band 0–1), darunter eine Provinz (2–3), darunter zwei Baronien (4–6). */
const reich = territory(1, "Reich", null, [0, 1]);
const provinz = territory(2, "Provinz", 1, [2, 3]);
const baronieA = territory(3, "Baronie A", 2, [4, 6]);
const baronieB = territory(4, "Baronie B", 2, [4, 6]);
const alle = [reich, provinz, baronieA, baronieB];
const byId = new Map(alle.map((node) => [node.id, node]));

describe("Gültigkeit und Bänder", () => {
    it("null heißt unbegrenzt, die Grenzen gelten einschließlich", () => {
        expect(isValidAt(null, null, 1049)).toBe(true);
        expect(isValidAt(1049, 1049, 1049)).toBe(true);
        expect(isValidAt(1050, null, 1049)).toBe(false);
        expect(isValidAt(null, 1048, 1049)).toBe(false);
        expect(bandContains(null, null, 3)).toBe(true);
        expect(bandContains(2, 3, 3)).toBe(true);
        expect(bandContains(2, 3, 4)).toBe(false);
        expect(bandContains(4, null, 6)).toBe(true);
    });

    it("erkennt Sammelknoten an Legacys Namen", () => {
        expect(isGenericGroupName("Unabhängig")).toBe(true);
        expect(isGenericGroupName("Umstritten")).toBe(true);
        expect(isGenericGroupName("Ungeklärt")).toBe(true);
        // Legacys Muster verlangt das ganze Wort: „Unabhängige …“ ist ein gewöhnlicher Name.
        expect(isGenericGroupName("Unabhängige Baronie Nordmark")).toBe(false);
        expect(isGenericGroupName("Mittelreich")).toBe(false);
    });
});

describe("Das Anzeigegebiet eines Bandes", () => {
    const kette = (id: number): TerritoryNode[] => effectiveChain(id, byId, 1049);

    it("wählt je Band das Glied, dessen Spanne es enthält", () => {
        const chain = kette(3);
        expect(chain.map((node) => node.name)).toEqual(["Reich", "Provinz", "Baronie A"]);
        expect(pickDisplayTerritory(chain, 0)?.name).toBe("Reich");
        expect(pickDisplayTerritory(chain, 1)?.name).toBe("Reich");
        expect(pickDisplayTerritory(chain, 2)?.name).toBe("Provinz");
        expect(pickDisplayTerritory(chain, 3)?.name).toBe("Provinz");
        expect(pickDisplayTerritory(chain, 4)?.name).toBe("Baronie A");
        expect(pickDisplayTerritory(chain, 6)?.name).toBe("Baronie A");
    });

    it("🔴 nimmt die engste Spanne, bei Gleichstand das tiefere Glied (Legacy)", () => {
        const weit = territory(10, "Weit", null, [null, null]);
        const enge = territory(11, "Eng", 10, [2, 2]);
        const gleichA = territory(12, "Gleich A", 10, [2, 4]);
        const gleichB = territory(13, "Gleich B", 12, [3, 5]);
        const nodes = new Map([weit, enge, gleichA, gleichB].map((node) => [node.id, node]));
        // Band 2: Weit (99) und Eng (0) → Eng.
        expect(pickDisplayTerritory(effectiveChain(11, nodes, 1049), 2)?.name).toBe("Eng");
        // Band 3: Gleich A (Spanne 2) und Gleich B (Spanne 2) → das tiefere, B.
        expect(pickDisplayTerritory(effectiveChain(13, nodes, 1049), 3)?.name).toBe("Gleich B");
        // Band 6: nur Weit passt (unbegrenzt).
        expect(pickDisplayTerritory(effectiveChain(13, nodes, 1049), 6)?.name).toBe("Weit");
    });

    it("zeigt nichts, wo kein Glied der Kette passt (Lücke im Zoombereich, ein Befund)", () => {
        const luecke = new Map(
            [territory(20, "Reich", null, [0, 1]), territory(21, "Baronie", 20, [4, 6])].map((n) => [n.id, n]),
        );
        expect(pickDisplayTerritory(effectiveChain(21, luecke, 1049), 2)).toBeUndefined();
        expect(pickDisplayTerritory(effectiveChain(21, luecke, 1049), 3)).toBeUndefined();
    });
});

describe("Die wirksame Kette", () => {
    it("bricht an einem im Anzeigejahr abgelaufenen Elter ab: das Kind gilt als Reich", () => {
        const alt = territory(30, "Altes Reich", null, [0, 1], [null, 1028]);
        const kind = territory(31, "Kind", 30, [0, 6]);
        const nodes = new Map([alt, kind].map((node) => [node.id, node]));
        expect(effectiveChain(31, nodes, 1049).map((node) => node.name)).toEqual(["Kind"]);
        expect(effectiveChain(31, nodes, 1020).map((node) => node.name)).toEqual(["Altes Reich", "Kind"]);
    });

    it("ist im Zyklus sicher und liefert jedes Gebiet nur einmal", () => {
        const a = territory(40, "A", 41, [null, null]);
        const b = territory(41, "B", 40, [null, null]);
        const nodes = new Map([a, b].map((node) => [node.id, node]));
        expect(
            effectiveChain(40, nodes, 1049)
                .map((node) => node.name)
                .sort(),
        ).toEqual(["A", "B"]);
    });

    it("endet an einem Sammelknoten: das Kind darunter gilt als Reich", () => {
        const sammel = territory(50, "Unabhängig", null, [null, null]);
        const kind = territory(51, "Freistadt", 50, [0, 6]);
        const nodes = new Map([sammel, kind].map((node) => [node.id, node]));
        expect(effectiveChain(51, nodes, 1049).map((node) => node.name)).toEqual(["Freistadt"]);
    });

    it("liefert nichts für ein Gebiet, das selbst nicht gilt", () => {
        const nodes = new Map([territory(60, "Noch nicht", null, [0, 6], [1100, null])].map((node) => [node.id, node]));
        expect(effectiveChain(60, nodes, 1049)).toEqual([]);
    });
});

describe("Welche Flächen im Jahr gelten (Legacys „aktuelle Form“)", () => {
    const gebiet = territory(70, "Gebiet", null, [0, 6], [900, null]);

    it("eine Fläche ohne eigenen Beginn erbt den des Gebiets", () => {
        expect(currentAreas([area(1, 70)], gebiet, 1049)).toHaveLength(1);
        expect(currentAreas([area(1, 70)], territory(70, "Gebiet", null, [0, 6], [1100, null]), 1049)).toHaveLength(0);
    });

    it("eine abgelaufene Fläche bleibt, solange keine jüngere sie ablöst", () => {
        const alteForm = area(1, 70, { validFromBf: 900, validToBf: 1000 });
        expect(currentAreas([alteForm], gebiet, 1049).map((a) => a.id)).toEqual([1]);
    });

    it("eine jüngere Fläche desselben Gebiets löst die abgelaufene ab", () => {
        const alteForm = area(1, 70, { validFromBf: 900, validToBf: 1000 });
        const neueForm = area(2, 70, { validFromBf: 1001 });
        expect(currentAreas([alteForm, neueForm], gebiet, 1049).map((a) => a.id)).toEqual([2]);
    });

    it("eine Fläche, die erst nach dem Jahr beginnt, gilt nicht", () => {
        expect(currentAreas([area(1, 70, { validFromBf: 1100 })], gebiet, 1049)).toEqual([]);
    });
});

describe("Zuordnung aller Flächen zu allen Bändern", () => {
    const flaechen = [area(1, 3), area(2, 4)];

    it("zeigt Reich, Provinz und Baronien je nach Band", () => {
        const { assignments, notShown } = assignAreasToBands(alle, flaechen, 1049, 6);
        expect(notShown).toEqual([]);
        const inBand = (band: number): string[] =>
            assignments
                .filter((a) => a.band === band)
                .map((a) => `${String(a.areaId)}→${byId.get(a.territoryId)?.name ?? "?"}`);
        expect(inBand(0)).toEqual(["1→Reich", "2→Reich"]);
        expect(inBand(2)).toEqual(["1→Provinz", "2→Provinz"]);
        expect(inBand(5)).toEqual(["1→Baronie A", "2→Baronie B"]);
    });

    it("🔴 eine Fläche, die sich selbst zeigt und ein eigenes Band trägt, erscheint nur darin", () => {
        const nurBand5 = [area(1, 3, { minZoom: 5, maxZoom: 5 })];
        const { assignments, notShown } = assignAreasToBands(alle, nurBand5, 1049, 6);
        expect(assignments.filter((a) => a.territoryId === 3).map((a) => a.band)).toEqual([5]);
        expect(notShown).toEqual([
            { band: 4, areaId: 1, reason: "own_band" },
            { band: 6, areaId: 1, reason: "own_band" },
        ]);
    });

    it("meldet eine Lücke im Zoombereich als Befund, ohne sie zu füllen", () => {
        const luecke = [territory(1, "Reich", null, [0, 1]), territory(2, "Baronie", 1, [4, 6])];
        const { assignments, notShown } = assignAreasToBands(luecke, [area(1, 2)], 1049, 6);
        expect(notShown.map((n) => `${String(n.band)}:${n.reason}`)).toEqual(["2:no_band", "3:no_band"]);
        expect(assignments.map((a) => a.band)).toEqual([0, 1, 4, 5, 6]);
    });

    it("zählt Flächen, die im Jahr nicht gelten, ohne sie zu zeigen", () => {
        const vergangen = [territory(1, "Vergangen", null, [0, 6], [null, 1000])];
        const result = assignAreasToBands(vergangen, [area(1, 1), area(2, 1)], 1049, 6);
        expect(result.assignments).toEqual([]);
        expect(result.notCurrent).toBe(2);
    });
});

describe("Gezeigte Gebiete mit Kette, Elter und Tiefe", () => {
    it("trägt für jedes gezeigte Gebiet seinen wirksamen Elter und seine Tiefe", () => {
        const { assignments } = assignAreasToBands(alle, [area(1, 3), area(2, 4)], 1049, 6);
        const shown = displayedTerritories(assignments, alle, 1049);
        const at = (band: number, id: number) => shown.find((d) => d.band === band && d.territoryId === id);
        expect(at(0, 1)).toMatchObject({ parentId: null, depth: 0, chainIds: [1] });
        expect(at(2, 2)).toMatchObject({ parentId: 1, depth: 1, chainIds: [1, 2] });
        expect(at(4, 3)).toMatchObject({ parentId: 2, depth: 2, chainIds: [1, 2, 3] });
        // Je Band und Gebiet einmal, auch wenn zwei Flächen darunter liegen.
        expect(shown.filter((d) => d.band === 2)).toHaveLength(1);
        expect(shown.filter((d) => d.band === 5)).toHaveLength(2);
    });
});
