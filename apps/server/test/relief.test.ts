import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { offroadCost, offroadPathBetween } from "../src/routing/map-points.ts";
import { buildOffroadBox, buildPlanes } from "../src/routing/offroad-grid.ts";
import { findPath } from "../src/routing/offroad-search.ts";
import {
    calibrateRelief,
    chordTouchesRelief,
    KIND_MOUNTAIN,
    KIND_NONE,
    reliefAt,
    reliefPlane,
    stepFootFactor,
    type TerrainHeights,
} from "../src/routing/relief.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { NO_WATER } from "../src/routing/water.ts";

/**
 * Das Gelände querfeldein (WI-0049 S5b, Gutachten MCS-026). 🔴 Ohne Gelände rechnet querfeldein wie
 * vorher: Das belegen die unveränderten Tests in `offroad-search.test.ts`.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const TEMPO = 3.45;
const rule = { kind: "steigung" as const, steigung: 0.3 };

/**
 * Ein Gebirge von 20 × 20 E (Zelle 0,25) mit einem schroffen Kamm in Nord-Süd-Richtung bei x = 10:
 * 4.000 Schritt auf dem Kamm, 2 E weiter 1; im Süden (y < 4) ein tiefer Sattel mit 200 Schritt.
 */
function kamm(): TerrainHeights {
    const cell = 0.25;
    const width = 81;
    const height = 81;
    const samples = new Uint16Array(width * height);
    for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
            const x = i * cell;
            const y = j * cell;
            const top = y < 4 ? 200 : 4000;
            samples[j * width + i] = Math.max(1, Math.round(top * Math.max(0, 1 - Math.abs(x - 10) / 2)));
        }
    }
    const raster = { cell, originX: 0, originY: 0, width, height, samples, maxX: 20, maxY: 20 };
    const cones = [{ x: 40, y: 10, h: 1000, radius: 1000 / (0.3 * 3000) }];
    return { rasters: [raster], cones, rule, mu: calibrateRelief([raster], cones, rule, model) };
}

describe("Gelände an einem Punkt", () => {
    const t = kamm();
    it("Gebirge, wo ein Raster Höhe trägt; Gipfel im Kegel; sonst nichts", () => {
        expect(reliefAt(t, 10, 10)).toMatchObject({ kind: KIND_MOUNTAIN });
        expect(reliefAt(t, 10, 10).height).toBeCloseTo(4000, 0);
        expect(reliefAt(t, 40, 10)).toMatchObject({ kind: KIND_NONE, height: 1000 });
        expect(reliefAt(t, 30, 10)).toMatchObject({ kind: KIND_NONE, height: 0 });
    });

    it("die Sehne weiß, ob sie Gelände berührt", () => {
        expect(chordTouchesRelief(t, { x: 5, y: 10 }, { x: 15, y: 10 })).toBe(true);
        expect(chordTouchesRelief(t, { x: 25, y: 30 }, { x: 35, y: 30 })).toBe(false);
    });
});

describe("Leistungskilometer je Schritt", () => {
    it("bergauf kostet, sanft bergab nicht, steil bergab wieder", () => {
        // 1/3 E ist eine Meile.
        expect(stepFootFactor(100, 1 / 3, model)).toBeCloseTo(2, 12);
        expect(stepFootFactor(-100, 1 / 3, model)).toBe(1);
        expect(stepFootFactor(-300, 1 / 3, model)).toBeCloseTo(3, 12);
    });
});

describe("Eichung an der GA", () => {
    it("🔴 im Mittel über alle Schritte der Art genau der GA-Faktor", () => {
        const t = kamm();
        const plane = reliefPlane(buildOffroadBox(0, 0, 20, 20, 0.25), t, model, "groupFoot");
        if (!plane) throw new Error("Ebene erwartet");
        // Im Mittel aller Schritte P / μ = 1, also der Faktor der Art selbst (3,5 im Gebirge, WdE 21 / 6).
        expect(t.mu.FOOT.mountain).toBeGreaterThan(1);
        expect(plane.step(KIND_MOUNTAIN, 1000, 1000, 0.25)).toBeCloseTo(3.5 / t.mu.FOOT.mountain, 12);
        expect(plane.step(KIND_MOUNTAIN, 1000, 1100, 0.25)).toBeGreaterThan(3.5);
        expect(plane.step(KIND_NONE, 0, 500, 0.25)).toBe(0);
    });
});

describe("Die Suche querfeldein", () => {
    const t = kamm();
    const heights = { terrain: t, model, transport: "groupFoot" };
    const zeit = offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "fastest");
    const strecke = offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "shortest");
    const von = { x: 4, y: 12 };
    const nach = { x: 16, y: 12 };

    it("🔴 über den Kamm ist langsamer als im Flachen, und die Suche nimmt den tiefen Sattel", () => {
        const box = buildOffroadBox(von.x, 0, nach.x, 14);
        const flach = findPath(buildPlanes(box, NO_WATER, NO_RIVERS, { search: true }), zeit, von, nach);
        const berg = findPath(
            buildPlanes(box, NO_WATER, NO_RIVERS, { search: true }, undefined, [], heights),
            zeit,
            von,
            nach,
        );
        if (!flach || !berg) throw new Error("Wege erwartet");
        expect(berg.time).toBeGreaterThan(flach.time);
        // Um den Kamm herum durch den Sattel im Süden (y < 4).
        expect(Math.min(...berg.points.map(([, y]) => y))).toBeLessThan(4);
    });

    it("unter „Kürzeste“ sucht die Suche ohne Gelände, die Zeit rechnet es trotzdem", () => {
        const world = { water: NO_WATER, rivers: NO_RIVERS, heights };
        const kurz = offroadPathBetween(world, strecke, von, nach);
        const ohne = offroadPathBetween({ water: NO_WATER, rivers: NO_RIVERS }, strecke, von, nach);
        if (!kurz || !ohne) throw new Error("Wege erwartet");
        expect(kurz.distance).toBeCloseTo(ohne.distance, 9);
        expect(kurz.time).toBeGreaterThan(ohne.time);
    });

    it("🔴 ohne Gelände bleibt alles wie vorher", () => {
        const world = { water: NO_WATER, rivers: NO_RIVERS };
        const a = offroadPathBetween(world, zeit, von, nach);
        const b = offroadPathBetween({ ...world, heights: null }, zeit, von, nach);
        expect(b).toEqual(a);
    });
});
