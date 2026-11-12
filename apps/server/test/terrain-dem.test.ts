import { describe, expect, it } from "vitest";
import { WEB_MERCATOR_HALF_WORLD } from "@avesmaps3d/shared";
import {
    composeDem,
    DEM_MAX_ZOOM,
    DEM_TILE_FORMAT,
    DEM_TILE_SIZE,
    demRevision,
    demTileRgb,
    demTiles,
    RENDER_METERS_PER_SCHRITT,
    type StoredRaster,
} from "../src/terrain/dem-tiles.ts";
import { decodeTileImage, tileFormatOf } from "../src/terrain/tile-image.ts";
import { GROSS_AB_E2, grundhoeheFor, seedOf } from "../src/terrain/inputs.ts";
import {
    coneHeightAt,
    coneRadius,
    DEFAULT_CONE,
    FREE_PEAK_DEFAULT_HEIGHT,
    LEGACY_CONE,
} from "../src/terrain/peak-cone.ts";

/**
 * Die Bausteine des abgeleiteten Geländes (WI-0049 S3), ohne Datenbank und ohne V12.
 */

const SIZE = DEM_TILE_SIZE << DEM_MAX_ZOOM;
const CELL = 1024 / SIZE;

/** Höhe in Schritt an einem Pixel einer eigenen Kachel, zurückgerechnet aus der Kodierung. */
function decode(image: Buffer, px: number, py: number, row: number, size: number): number {
    const { rgb } = decodeTileImage(image);
    const o = (py * DEM_TILE_SIZE + px) * 3;
    const value = ((rgb[o] ?? 0) << 16) + ((rgb[o + 1] ?? 0) << 8) + (rgb[o + 2] ?? 0);
    const mercatorY = WEB_MERCATOR_HALF_WORLD - ((row + 0.5) / size) * 2 * WEB_MERCATOR_HALF_WORLD;
    const latitude = 2 * Math.atan(Math.exp((mercatorY / WEB_MERCATOR_HALF_WORLD) * Math.PI)) - Math.PI / 2;
    return (value * 0.1 - 10000) / (RENDER_METERS_PER_SCHRITT * Math.cos(latitude));
}

describe("Regeln des Betreibers", () => {
    it("Seed wortgleich zu Legacys ecosystemHeightSeed", () => {
        // Mit Legacys Formel gerechnet (height-field.js#L149-157) für den Raschtulswall.
        expect(seedOf("51f1ed9a-2108-44af-83f3-851ccbf600c4", 136)).toBe(868673540);
    });

    it("Grundhöhe 1.000 bis unter 1.000 E², ab dort 1.500", () => {
        expect(grundhoeheFor(GROSS_AB_E2 - 0.001)).toBe(1000);
        expect(grundhoeheFor(GROSS_AB_E2)).toBe(1500);
    });
});

describe("freie Gipfel", () => {
    it("stehen oben auf ihrer Höhe und laufen am Radius auf null aus", () => {
        const peak = { x: 500, y: 500, h: 2000 };
        expect(coneHeightAt(peak, 500, 500, LEGACY_CONE)).toBe(2000);
        expect(coneHeightAt(peak, 502.5, 500, LEGACY_CONE)).toBe(0);
        expect(coneHeightAt(peak, 501.25, 500, LEGACY_CONE)).toBeCloseTo(2000 * 0.75 ** 3, 6);
    });

    it("nehmen ohne Höhe Legacys Vorgabe", () => {
        // Außerhalb der Gebirge 1.000 statt Legacys 5.000 (Betreiber 2026-09-27).
        expect(coneHeightAt({ x: 1, y: 1, h: null }, 1, 1, DEFAULT_CONE)).toBe(FREE_PEAK_DEFAULT_HEIGHT);
        expect(FREE_PEAK_DEFAULT_HEIGHT).toBe(1000);
    });

    it("haben bei einer Steigungsregel im Mittel genau diese Steigung", () => {
        // 2.000 Schritt bei 30 %: Fuß nach 6.667 Schritt, also 2,22 Karteneinheiten.
        expect(coneRadius(2000, { kind: "steigung", steigung: 0.3 })).toBeCloseTo(2000 / 900, 9);
        // Ein 50er fiele sonst durchs Raster: mindestens zwei Zellen.
        expect(coneRadius(50, { kind: "steigung", steigung: 0.3 })).toBe(0.5);
    });
});

describe("Kacheln", () => {
    const raster: StoredRaster = {
        cell: 0.25,
        originX: 510,
        originY: 510,
        width: 5,
        height: 5,
        samples: new Uint16Array(25).fill(3000),
    };

    it("setzen Gebirge und freie Gipfel mit dem Maximum zusammen", () => {
        // Ein freier Gipfel mitten im Gebirge: Dort gilt das Höhere.
        const dem = composeDem(
            [raster],
            [
                { x: 600, y: 600, h: 1200 },
                { x: 510.6, y: 510.6, h: 2000 },
            ],
            LEGACY_CONE,
        );
        const at = (x: number, y: number): number =>
            dem[Math.floor((1024 - y) / CELL) * SIZE + Math.floor(x / CELL)] ?? 0;
        expect(at(510.6, 510.6)).toBe(3000);
        expect(at(600.1, 600.1)).toBeGreaterThan(1100);
        expect(at(300, 300)).toBe(0);
    });

    it("sind vollständig (alle Stufen bis zur feinsten), maßstabsgetreu kodiert und wiederholbar", () => {
        const dem = composeDem([], [{ x: 512.06, y: 511.94, h: 4000 }], LEGACY_CONE);
        const tiles = demTiles(dem);
        let all = 0;
        for (let z = 0; z <= DEM_MAX_ZOOM; z += 1) all += 4 ** z;
        expect(tiles).toHaveLength(all);
        const gx = Math.floor(512.06 / CELL);
        const gy = Math.floor((1024 - 511.94) / CELL);
        const tile = tiles.find(
            (t) =>
                t.z === DEM_MAX_ZOOM &&
                t.x === Math.floor(gx / DEM_TILE_SIZE) &&
                t.y === Math.floor(gy / DEM_TILE_SIZE),
        );
        const stored = dem[gy * SIZE + gx] ?? 0;
        expect(decode(tile?.image as Buffer, gx % DEM_TILE_SIZE, gy % DEM_TILE_SIZE, gy, SIZE)).toBeCloseTo(stored, 0);
        expect(demRevision(demTiles(dem))).toBe(demRevision(tiles));
        expect(demRevision(tiles)).toMatch(/^[0-9a-f]{12}$/);
        // Zweimal die ganze Pyramide (341 Kacheln, WebP kodiert): mehr als die 5 s Vorgabe bei Last.
    }, 60_000);

    it("🔴 verlustfrei (WI-0073): jede Kachel der feinsten Stufe liest sich als genau ihre RGB-Werte, WebP, nicht PNG", () => {
        const dem = composeDem([], [{ x: 512.06, y: 511.94, h: 4000 }], LEGACY_CONE);
        for (const tile of demTiles(dem).filter((t) => t.z === DEM_MAX_ZOOM)) {
            expect(tileFormatOf(tile.image), `${String(tile.x)}/${String(tile.y)}`).toBe(DEM_TILE_FORMAT);
            const decoded = decodeTileImage(tile.image);
            expect(Buffer.from(decoded.rgb).equals(demTileRgb(dem, SIZE, tile.x, tile.y))).toBe(true);
        }
    }, 60_000);
});
