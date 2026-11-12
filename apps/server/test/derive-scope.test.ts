import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    boundsIntersect,
    FULL_SCOPE,
    overhang,
    scopeNames,
    scopeOfChange,
    unionBounds,
    type DeriveBounds,
} from "../src/terrain/derive-scope.ts";
import { diffTiles, tileBounds, tileDigest, tileKey } from "../src/terrain/tile-diff.ts";

/**
 * Der Auftrag einer Ableitung und der Vergleich zweier Kachelpyramiden (WI-0059, 4.5 und 4.7): kleine, reine
 * Bausteine, mit denen das Gelände seinem Relief und das Relief den Anzeigehöhen sagt, was sich geändert hat.
 */

const box = (minX: number, minY: number, maxX: number, maxY: number): DeriveBounds => ({ minX, minY, maxX, maxY });

describe("Bereiche", () => {
    it("vereinigen, schneiden und überragen", () => {
        expect(unionBounds(null, null)).toBeNull();
        expect(unionBounds(box(0, 0, 1, 1), null)).toEqual(box(0, 0, 1, 1));
        expect(unionBounds(box(0, 0, 1, 1), box(5, -2, 6, 0.5))).toEqual(box(0, -2, 6, 1));
        expect(boundsIntersect(box(0, 0, 10, 10), box(10, 10, 20, 20))).toBe(true);
        expect(boundsIntersect(box(0, 0, 10, 10), box(10.01, 0, 20, 10))).toBe(false);
        expect(overhang(box(2, 2, 8, 8), box(0, 0, 10, 10))).toBe(0);
        expect(overhang(box(-3, 2, 8, 8), box(0, 0, 10, 10))).toBe(3);
        expect(overhang(box(2, 2, 14, 12), box(0, 0, 10, 10))).toBe(4);
    });

    it("der Auftrag: voll, wenn der Bereich unbekannt ist; sonst der Bereich der Änderung (auch: keine)", () => {
        expect(FULL_SCOPE).toEqual({ kind: "full" });
        expect(scopeOfChange(false, null)).toEqual({ kind: "full" });
        expect(scopeOfChange(true, null)).toEqual({ kind: "bounds", bounds: null });
        expect(scopeOfChange(true, box(0, 0, 128, 128))).toEqual({ kind: "bounds", bounds: box(0, 0, 128, 128) });
    });

    it("eine Nennung trifft ein Gebirge über Kennung oder Namen, voll und Bereich wählen darüber nichts aus", () => {
        const scope = { kind: "entities", ids: ["Raschtulswall", "abc"] } as const;
        expect(scopeNames(scope, "abc", "Anderer Name")).toBe(true);
        expect(scopeNames(scope, "xyz", "Raschtulswall")).toBe(true);
        expect(scopeNames(scope, "xyz", "Koschgebirge")).toBe(false);
        expect(scopeNames(FULL_SCOPE, "abc", "Raschtulswall")).toBe(false);
        expect(scopeNames({ kind: "bounds", bounds: null }, "abc", "Raschtulswall")).toBe(false);
    });
});

describe("Kacheln vergleichen", () => {
    it("der Kartenbereich einer Kachel: Zeile 0 im Norden, der Süden hat das kleine y", () => {
        expect(tileBounds(0, 0, 0)).toEqual(box(0, 0, 1024, 1024));
        expect(tileBounds(3, 0, 0)).toEqual(box(0, 896, 128, 1024));
        expect(tileBounds(3, 7, 7)).toEqual(box(896, 0, 1024, 128));
        expect(tileKey({ z: 3, x: 2, y: 5 })).toBe("3/2/5");
    });

    const image = (text: string): Buffer => Buffer.from(text);
    const pyramid = (marks: Record<string, string>): { z: number; x: number; y: number; image: Buffer }[] =>
        Object.entries(marks).map(([key, text]) => {
            const [z, x, y] = key.split("/").map(Number) as [number, number, number];
            return { z, x, y, image: image(text) };
        });

    it("zählt jede geänderte Kachel, der Bereich und die Liste nur die der feinsten Stufe", () => {
        const before = new Map<string, string>();
        for (const [key, text] of Object.entries({ "0/0/0": "a", "3/1/1": "b", "3/2/1": "c", "3/5/6": "d" })) {
            before.set(key, createHash("sha256").update(text).digest("hex"));
        }
        const tiles = pyramid({ "0/0/0": "a2", "3/1/1": "b", "3/2/1": "c2", "3/5/6": "d2", "3/6/6": "neu" });
        const diff = diffTiles(before, tiles, 3);
        // Geändert: 0/0/0, 3/2/1, 3/5/6, und die neue 3/6/6; 3/1/1 ist gleich.
        expect(diff.changed).toBe(4);
        expect(diff.finest).toHaveLength(3);
        expect(diff.bounds).toEqual(box(256, 128, 896, 896));
        expect(tileDigest(image("b"))).toBe(before.get("3/1/1"));
    });

    it("nichts geändert: kein Bereich", () => {
        const tiles = pyramid({ "0/0/0": "a", "3/0/0": "b" });
        const before = new Map(tiles.map((tile) => [tileKey(tile), tileDigest(tile.image)]));
        expect(diffTiles(before, tiles, 3)).toEqual({ changed: 0, bounds: null, finest: [] });
    });
});
