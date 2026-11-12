import { describe, expect, it } from "vitest";
import { catmullRomLine } from "@avesmaps3d/shared";
import { RouteDisplay } from "../src/routing/display.ts";

/**
 * Die gezeichnete Linie der Route (WI-0030, Betreiber 2026-09-25: „die leute glauben, man überquert die
 * straße“): dieselbe Kurve wie die Karte (`catmullRomLine` über den ganzen Weg), an beliebigen Stellen.
 */

/** Ein Weg mit rechtem Winkel bei (10|0) - dort schwingt die gezeichnete Kurve weit aus. */
const winkel: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [20, 10],
];
const zeichnung = new RouteDisplay(new Map([["winkel", winkel]]));
const kurve = catmullRomLine(winkel.map(([x, y]) => ({ x, y }))).map(({ x, y }) => [x, y] as [number, number]);

const abstandZurKurve = ([px, py]: [number, number]): number => {
    let nearest = Infinity;
    for (let index = 1; index < kurve.length; index += 1) {
        const [ax, ay] = kurve[index - 1] as [number, number];
        const [bx, by] = kurve[index] as [number, number];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        nearest = Math.min(nearest, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return nearest;
};

describe("Die gezeichnete Linie eines Routenabschnitts", () => {
    it("das ganze Stück ist genau die Kurve der Karte", () => {
        expect(zeichnung.piece("winkel", winkel)).toEqual(kurve);
    });

    it("🔴 ein Anker mitten im Stück liegt gezeichnet auf der Kurve, nicht auf der Rohlinie", () => {
        // Ein Viertel in den senkrechten Schenkel: Die Kurve schwingt dort 0,66 E aus (die Mitte läge
        // aus Symmetrie genau auf der Rohlinie).
        const roh: [number, number] = [10, 2.5];
        const gezeichnet = zeichnung.pointOn("winkel", ...roh) as [number, number];
        expect(Math.hypot(gezeichnet[0] - roh[0], gezeichnet[1] - roh[1])).toBeGreaterThan(0.1);
        expect(abstandZurKurve(gezeichnet)).toBeLessThan(0.05);
    });

    it("ein Stück ab dem Anker beginnt an dessen Kurvenpunkt und folgt dann der Kurve der Karte", () => {
        const stueck = zeichnung.piece("winkel", [
            [10, 2.5],
            [10, 10],
            [20, 10],
        ]) as [number, number][];
        expect(stueck[0]).toEqual(zeichnung.pointOn("winkel", 10, 2.5));
        expect(stueck[stueck.length - 1]).toEqual([20, 10]);
        for (const punkt of stueck.slice(1)) expect(abstandZurKurve(punkt)).toBeLessThan(1e-9);
    });

    it("auf einer Geraden bleibt der Punkt auf ihr, und ohne den Weg gibt es keinen", () => {
        const gerade = new RouteDisplay(
            new Map([
                [
                    "gerade",
                    [
                        [0, 0],
                        [5, 0],
                        [10, 0],
                    ] as [number, number][],
                ],
            ]),
        );
        // Am Wegende ist die Tangente gekappt: Der Punkt rückt auf der Geraden, aber nicht von ihr weg.
        const punkt = gerade.pointOn("gerade", 7, 0) as [number, number];
        expect(punkt[1]).toBeCloseTo(0, 9);
        expect(punkt[0]).toBeGreaterThan(5);
        expect(punkt[0]).toBeLessThan(10);
        expect(gerade.pointOn("fehlt", 7, 0)).toBeNull();
    });
});
