import { describe, expect, it } from "vitest";
import type { NearbyItem } from "@avesmaps3d/shared";
import { NEARBY_PATHS, NEARBY_PATH_REACH, NEARBY_PLACES, bearing, selectNearby } from "../src/subjects/nearby.ts";

/**
 * „In der Nähe“ einer Kartenstelle (WI-0063 P7, Legacy `avesmapsWhatIsHereNearby`): die Auswahl und die Peilung als reine Rechnung.
 * Die Zahlen sind Legacys (`WIH_ORTE` 3, `WIH_WEGE` 4, `WIH_WEG_SCHRANKE` 1,5).
 */

const place = (name: string, miles: number): NearbyItem => ({
    ref: { kind: "place", id: `70000000-0000-4000-8000-${name.length.toString(16).padStart(12, "0")}` },
    type: "dorf",
    name,
    miles,
    bearing: 0,
});
const road = (type: string, miles: number, name?: string): NearbyItem => ({
    ref: { kind: "path", anchor: "70000000-0000-4000-8000-0000000000aa" },
    type,
    ...(name === undefined ? {} : { name }),
    miles,
    bearing: 0,
});

describe("Auswahl", () => {
    it("die drei nächsten Orte, ohne Schranke; weitere fallen weg", () => {
        const result = selectNearby([place("Eins", 1), place("Zwei", 2), place("Drei", 30), place("Vier", 31)], []);
        expect(result.map((item) => item.name)).toEqual(["Eins", "Zwei", "Drei"]);
        expect(result).toHaveLength(NEARBY_PLACES);
    });

    it("🔴 je Wegart höchstens ein Weg, und keiner weiter als das Anderthalbfache des weitesten gezeigten Ortes", () => {
        const places = [place("A", 2), place("B", 4), place("C", 10)];
        const result = selectNearby(places, [
            road("Strasse", 5, "Nah"),
            road("Strasse", 3, "Näher"),
            road("Weg", 15),
            // 10 × 1,5 = 15: genau an der Schranke gilt noch, darüber nicht.
            road("Pfad", 15.01),
        ]);
        expect(result.map((item) => item.name ?? item.type)).toEqual(["A", "Näher", "B", "C", "Weg"]);
        expect(result.filter((item) => item.ref.kind === "path").map((item) => item.type)).toEqual(["Strasse", "Weg"]);
        expect(NEARBY_PATH_REACH).toBe(1.5);
    });

    it("höchstens vier Wege, die nächsten zuerst", () => {
        const kinds = ["Strasse", "Weg", "Pfad", "Reichsstrasse", "Gebirgspass", "Flussweg"];
        const result = selectNearby(
            [place("A", 100)],
            kinds.map((type, at) => road(type, at + 1)),
        );
        expect(result.filter((item) => item.ref.kind === "path")).toHaveLength(NEARBY_PATHS);
        expect(result.filter((item) => item.ref.kind === "path").map((item) => item.type)).toEqual([
            "Strasse",
            "Weg",
            "Pfad",
            "Reichsstrasse",
        ]);
    });

    it("ohne Orte gibt es keine Schranke; ohne alles nichts", () => {
        expect(selectNearby([], [road("Strasse", 9999)]).map((item) => item.type)).toEqual(["Strasse"]);
        expect(selectNearby([], [])).toEqual([]);
    });
});

describe("Peilung", () => {
    const origin = { x: 100, y: 100 };

    it("rechtweisend: 0 Grad Norden, 90 Osten, 180 Süden, 270 Westen - y wächst nach Norden", () => {
        expect(bearing(origin, { x: 100, y: 110 })).toBe(0);
        expect(bearing(origin, { x: 110, y: 100 })).toBe(90);
        expect(bearing(origin, { x: 100, y: 90 })).toBe(180);
        expect(bearing(origin, { x: 90, y: 100 })).toBe(270);
        expect(bearing(origin, { x: 110, y: 110 })).toBe(45);
    });

    it("die Diagonale zeigt nicht gespiegelt (`atan2(dx, dy)`, nicht `atan2(dy, dx)`), und nie 360", () => {
        expect(bearing(origin, { x: 90, y: 110 })).toBe(315);
        expect(bearing(origin, { x: 99.9999, y: 110 })).toBeLessThan(360);
    });
});
