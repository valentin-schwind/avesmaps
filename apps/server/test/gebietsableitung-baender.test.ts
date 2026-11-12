import { describe, expect, it } from "vitest";
import { bandKeys } from "../src/territories/derive.ts";

/**
 * Wann ein Band kopiert statt gerechnet wird (WI-0229 S2): Nur wenn alles, was seine Abfragen lesen, dem vorigen Band gleicht. Dass die
 * Kopie dieselben Bytes schreibt wie die Rechnung, belegt der Lauf auf der Kopie der Entwicklungsdaten (WI-0229 §S2).
 */
describe("Schlüssel je Band der Gebietsableitung", () => {
    const teile = (band7: { area: number; territory: number }) => ({
        assignments: [
            { band: 6, areaId: 1, territoryId: 10 },
            { band: 6, areaId: 2, territoryId: 11 },
            { band: 7, areaId: 2, territoryId: 11 },
            { band: 7, areaId: band7.area, territoryId: band7.territory },
        ],
        displayed: [6, 7].flatMap((band) => [
            { band, territoryId: 10, parentId: null, depth: 0 },
            { band, territoryId: 11, parentId: 10, depth: 1 },
        ]),
        members: [6, 7].map((band) => ({ band, owner: 10, parent: null, depth: 0, member: 11 })),
        nameOwners: [6, 7].map((band) => ({ band, owner: 10 })),
        ancestors: [],
    });

    it("🔴 gleiche Eingaben in anderer Reihenfolge: gleicher Schlüssel, das Band wird kopiert", () => {
        const keys = bandKeys(8, teile({ area: 1, territory: 10 }));
        expect(keys[7]).toBe(keys[6]);
        expect(keys[5]).not.toBe(keys[6]);
        expect(keys[8]).toBe(keys[5]);
    });

    it("🔴 eine Fläche zeigt ein anderes Gebiet: anderer Schlüssel, das Band wird gerechnet", () => {
        const keys = bandKeys(8, teile({ area: 1, territory: 11 }));
        expect(keys[7]).not.toBe(keys[6]);
    });
});
