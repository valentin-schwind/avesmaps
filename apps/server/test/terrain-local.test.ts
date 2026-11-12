import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { pruneCandidates, readCandidate, removeCandidate, writeCandidate } from "../src/terrain/domain/candidate.ts";
import { composeFine, type FineRecipe } from "../src/terrain/domain/fine.ts";
import {
    computeTileBounds,
    computeTilesOf,
    footprintOf,
    footprintRing,
    footprintRingOf,
    growTiles,
} from "../src/terrain/domain/footprint.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { diffInputIndex, type InputIndex } from "../src/terrain/domain/input-index.ts";
import {
    composeFineLocal,
    composeFineLocalMitWorkern,
    extractComputeTile,
    insertComputeTile,
} from "../src/terrain/domain/local-fine.ts";
import { grid, SEA } from "../src/terrain/hydrology/grid.ts";
import { parseTerrainLocalInput, terrainLocalResult } from "../src/jobs/terrain-local-job.ts";
import type { LocalTerrainReport } from "../src/terrain/domain/local.ts";

/**
 * `terrain_local` ohne Datenbank (WI-0125, JOBS-0001 V1): Fußabdruck aus dem Eingabeindex (Frage 7 B, WI-0223), die Feinstufe
 * nur im Fußabdruck (Zelle für Zelle wie die volle Komposition), Ein- und Ausschneiden der Rechenkacheln, die Kandidatenablage.
 */

const index = (objects: InputIndex["objects"]): InputIndex => ({ v: 1, objects });

describe("Fußabdruck (Frage 7 B: Kacheln um den Rahmen plus Ring aus dem Radius)", () => {
    it("🔴 der Ring ist 3 × Radius auf Kacheln aufgerundet: bei 16 E einer (3 × 3), ab 43 E zwei", () => {
        expect(footprintRing(16)).toBe(1);
        expect(footprintRing(42)).toBe(1);
        expect(footprintRing(43)).toBe(2);
        expect(() => footprintRing(0)).toThrow();
        expect(footprintRingOf(AVENTURIA_TERRAIN_RECIPE)).toBe(1);
    });

    it("🔴 freier Gipfel: seine Kachel und ein Ring, 3 × 3", () => {
        const changes = diffInputIndex(
            index({ "peak:a": ["aaaaaaaaaaaa", 575, 615, 575, 615] }),
            index({ "peak:a": ["bbbbbbbbbbbb", 575, 615, 575, 615] }),
        );
        const footprint = footprintOf(changes, 1);
        expect(footprint.rects).toEqual([{ minX: 575, minY: 615, maxX: 575, maxY: 615 }]);
        // x 575 in Spalte 4 (512..640), y 615 in Zeile 3 von Norden (512..640): Kachel 28, dazu die acht Nachbarn.
        expect(footprint.tiles).toEqual([19, 20, 21, 27, 28, 29, 35, 36, 37]);
    });

    it("🔴 Gebirgsfläche: Rahmen vorher UND nachher; ein verschobener Gipfel nimmt alte und neue Lage", () => {
        const changes = diffInputIndex(
            index({ "mountain:m": ["aaaaaaaaaaaa", 514.8, 640.5, 542.7, 666.8], "peak:p": ["1", 100, 100, 100, 100] }),
            index({ "mountain:m": ["bbbbbbbbbbbb", 512.8, 638.5, 544.7, 668.8], "peak:p": ["2", 130, 100, 130, 100] }),
        );
        expect(changes.map((change) => change.kind)).toEqual(["mountain", "peak"]);
        const footprint = footprintOf(changes, 1);
        expect(footprint.rects).toEqual([
            { minX: 512.8, minY: 638.5, maxX: 544.7, maxY: 668.8 },
            { minX: 100, minY: 100, maxX: 130, maxY: 100 },
        ]);
        // Das Gebirge reicht vorher bis y 638,5, also in Zeile 3: Kacheln 20 und 28 (Spalte 4) mit Ring, Zeilen 1 bis 4. Der Gipfel von
        // x 100 bis 130 in Spalte 0 und 1, Zeile 7: mit Ring Spalten 0 bis 2, Zeilen 6 und 7.
        expect(footprint.tiles).toEqual([11, 12, 13, 19, 20, 21, 27, 28, 29, 35, 36, 37, 48, 49, 50, 56, 57, 58]);
    });

    it("an der Karte endet der Ring; ein Rahmen über eine Kachelgrenze nimmt beide", () => {
        const changes = diffInputIndex(index({}), index({ "mountain:a": ["1", 120, 900, 136, 910] }));
        // Spalten 0 und 1, Zeile 0: mit Ring Spalten 0 bis 2, Zeilen 0 und 1.
        expect(footprintOf(changes, 1).tiles).toEqual([0, 1, 2, 8, 9, 10]);
    });

    it("eine Kachel, an deren Kante ein Rechteck nur endet, gehört nicht dazu; ausdrückliche Bereiche ohne Ring", () => {
        expect(computeTilesOf([{ minX: 128, minY: 896, maxX: 256, maxY: 1024 }])).toEqual([1]);
        expect(computeTilesOf([{ minX: 128, minY: 950, maxX: 128, maxY: 950 }])).toEqual([0, 1]);
        expect(computeTileBounds(63)).toEqual({ minX: 896, maxX: 1024, minY: 0, maxY: 128 });
        expect(growTiles([63], 1)).toEqual([54, 55, 62, 63]);
        expect(footprintOf([], 1, [{ minX: 10, minY: 10, maxX: 20, maxY: 20 }]).tiles).toEqual([56]);
        expect(footprintOf([], 1).tiles).toEqual([]);
    });

    it("unveränderte Objekte zählen nicht; entfernte und neue schon", () => {
        const changes = diffInputIndex(
            index({ "area:a": ["1", 0, 0, 1, 1], "area:b": ["2", 0, 0, 1, 1] }),
            index({ "area:a": ["1", 0, 0, 1, 1], "area:c": ["3", 0, 0, 1, 1] }),
        );
        expect(changes.map((change) => [change.key, change.before !== null, change.after !== null])).toEqual([
            ["area:b", true, false],
            ["area:c", false, true],
        ]);
    });
});

const FINE: FineRecipe = {
    size: 8192,
    tiles: 4,
    halo: 8,
    blend: 4,
    detail: { amplitude: 60, wavelength: 4, octaves: 2, persistence: 0.5, relief: 0.05 },
    erosion: { iterations: 2, streamPowerK: 0.02, exponent: 0.5, diffusion: 0.1, fill: 0.01, maximumChange: 150 },
};

function coarse(n: number, at: (x: number, y: number) => number): StoredRaster {
    const cell = 1024 / n;
    const samples = new Uint16Array(n * n);
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) samples[j * n + i] = Math.round(at((i + 0.5) * cell, (j + 0.5) * cell));
    return { width: n, height: n, cell, originX: cell / 2, originY: cell / 2, samples };
}

describe("Feinstufe im Fußabdruck", () => {
    // Eigene Zeitgrenze wie in `domain-terrain-fine.test.ts`: zwei Kompositionen über ein 256er-Gitter mit Erosion.
    it(
        "🔴 auf Workern dieselben Bytes wie allein (WI-0283): die Summe bleibt in fester Folge",
        { timeout: 60_000 },
        async () => {
            const g = grid(256);
            const n = g.n;
            const c = coarse(128, (x, y) => 800 + 1500 * Math.exp(-((x - 600) ** 2 + (y - 400) ** 2) / 40000));
            const classes = new Uint8Array(n * n);
            for (let y = 0; y < n; y++) for (let x = 0; x < 20; x++) classes[y * n + x] = SEA;
            const base = new Uint16Array(n * n).fill(7);
            const inside = new Set([5, 6]);
            const allein = composeFineLocal(c, g, classes, FINE, 67001, inside, base);
            const verteilt = await composeFineLocalMitWorkern(c, g, classes, FINE, 67001, inside, base, 3);
            expect(verteilt.computed).toBe(allein.computed);
            expect(Buffer.from(verteilt.samples.buffer).equals(Buffer.from(allein.samples.buffer))).toBe(true);
            // Ohne geänderte Kachel gibt es nichts zu verteilen.
            const nichts = await composeFineLocalMitWorkern(c, g, classes, FINE, 67001, new Set(), base, 3);
            expect(nichts.computed).toBe(0);
        },
    );

    it(
        "🔴 setzt genau die Zellen in Reichweite der Kacheln im Fußabdruck neu, Zelle für Zelle wie die volle Komposition",
        { timeout: 60_000 },
        () => {
            const g = grid(256);
            const n = g.n;
            const c = coarse(128, (x, y) => 800 + 1500 * Math.exp(-((x - 600) ** 2 + (y - 400) ** 2) / 40000));
            const classes = new Uint8Array(n * n);
            for (let y = 0; y < n; y++) for (let x = 0; x < 20; x++) classes[y * n + x] = SEA;
            const full = composeFine(c, g, classes, FINE, 67001, "test").cache.composite;
            const base = new Uint16Array(n * n).fill(7);
            const inside = new Set([5, 6]);
            const { samples, computed } = composeFineLocal(c, g, classes, FINE, 67001, inside, base);
            // Kachel 5 und 6 und ihre Nachbarn: alle bis auf Zeile 3 (Kacheln 12 bis 15).
            expect(computed).toBe(12);
            const size = n / FINE.tiles;
            let replaced = 0;
            for (let y = 0; y < n; y++)
                for (let x = 0; x < n; x++) {
                    const tx = Math.floor(x / size),
                        ty = Math.floor(y / size);
                    const near = [5, 6].some((index) => {
                        const cx = (index % 4) * size,
                            cy = Math.floor(index / 4) * size;
                        return (
                            x >= cx - FINE.blend &&
                            x < cx + size + FINE.blend &&
                            y >= cy - FINE.blend &&
                            y < cy + size + FINE.blend
                        );
                    });
                    const got = samples[(n - 1 - y) * n + x]!;
                    if (near) {
                        replaced += 1;
                        expect(got, `${String(tx)}/${String(ty)} ${String(x)},${String(y)}`).toBe(full[y * n + x]);
                    } else expect(got).toBe(7);
                }
            expect(replaced).toBeGreaterThan(2 * size * size);
            expect(base.every((value) => value === 7)).toBe(true);
        },
    );

    it("schneidet Rechenkacheln aus und setzt sie ein, in der Lage des gespeicherten Masters (Zeile 0 im Süden)", () => {
        const n = 16;
        const samples = Uint16Array.from({ length: n * n }, (_, k) => k);
        // Rechenkachel 0 (oben links) liegt gespeichert in den obersten Zeilen 8 bis 15, Spalten 0 bis 7.
        const tile = extractComputeTile(samples, n, 0, 2);
        expect(tile[0]).toBe(8 * n);
        expect(tile[63]).toBe(15 * n + 7);
        const copy = new Uint16Array(n * n);
        insertComputeTile(copy, n, 0, 2, tile);
        expect(copy[8 * n + 3]).toBe(8 * n + 3);
        expect(copy[0]).toBe(0);
    });
});

describe("Kandidatenablage", () => {
    let root: string;
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-candidates-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    const head = {
        domain: "aventuria",
        job: "00000000-0000-4000-8000-000000000124",
        createdAt: "2026-10-09T00:00:00.000Z",
        base: { fingerprint: "f".repeat(64), revision: "a83c93072a5b" },
        inputFingerprint: "e".repeat(64),
        inputIndex: index({}),
        tiles: [19, 20],
        tilesPerSide: 2,
        size: 4,
        changes: [],
        findings: [],
    };

    it("🔴 liest, was abgelegt ist, und weist beschädigte Kacheln ab", async () => {
        const tiles = [Uint16Array.from([1, 2, 3, 4]), Uint16Array.from([5, 6, 7, 8])];
        const dir = await writeCandidate(head, tiles, root);
        const read = await readCandidate("aventuria", head.job, root);
        expect(read.head.tiles).toEqual([19, 20]);
        expect(read.tiles.map((tile) => [...tile])).toEqual([
            [1, 2, 3, 4],
            [5, 6, 7, 8],
        ]);
        await writeFile(join(dir, "tiles.u16"), Buffer.from(new Uint16Array([1, 2, 3, 4, 5, 6, 7, 9]).buffer));
        await expect(readCandidate("aventuria", head.job, root)).rejects.toThrow(/SHA-256/);
        await removeCandidate("aventuria", head.job, root);
        expect(await readdir(join(root, "aventuria"))).toEqual([]);
    });

    it("räumt nur Kandidaten auf, die älter als 24 Stunden sind; ein Pfad aus einem Namen wird abgewiesen", async () => {
        const dir = await writeCandidate(head, [new Uint16Array(4), new Uint16Array(4)], root);
        await writeCandidate({ ...head, job: "neu" }, [new Uint16Array(4), new Uint16Array(4)], root);
        const old = new Date(Date.now() - 25 * 3_600_000);
        await utimes(dir, old, old);
        expect(await pruneCandidates("aventuria", Date.now(), undefined, root)).toBe(1);
        expect(await readdir(join(root, "aventuria"))).toEqual(["neu"]);
        await expect(
            writeCandidate({ ...head, job: "../x" }, [new Uint16Array(4), new Uint16Array(4)], root),
        ).rejects.toThrow(/Ungültiger Teil/);
    });
});

describe("Eingabe des Jobs", () => {
    it("nimmt Bereiche und Threads an und weist alles andere ohne Wiederholung ab", () => {
        expect(parseTerrainLocalInput({ bounds: [[500, 600, 560, 680]], workers: 4 })).toEqual({
            bounds: [{ minX: 500, minY: 600, maxX: 560, maxY: 680 }],
            workers: 4,
        });
        expect(parseTerrainLocalInput({})).toEqual({ bounds: [], workers: undefined });
        for (const bad of [
            { bounds: [[1, 2, 3]] },
            { bounds: [[5, 5, 1, 1]] },
            { bounds: [[0, 0, 2000, 1]] },
            { workers: 0 },
        ])
            expect(() => parseTerrainLocalInput(bad)).toThrow();
    });

    it("🔴 das Ergebnis sagt, ob die grobe Stufe mit dem Stand zum Master rechnete (Claudios Probe, WI-0223)", () => {
        const report: LocalTerrainReport = {
            unchanged: false,
            reason: null,
            base: { fingerprint: "f1", revision: "r1" },
            inputFingerprint: "i2",
            changes: [
                { key: "peak:1", kind: "peak" },
                { key: "peak:2", kind: "peak" },
            ],
            rects: [],
            tiles: [20],
            candidate: "c",
            fineComputed: 9,
            coarseWindow: null,
            seedsComputed: 0,
            seedRetry: null,
            findings: 0,
            phasesMs: { coarse: 175_400 },
            coarsePhasesMs: { mask: 900, erosion: 160_000, "mountain-interior": 9_000 },
        };
        expect(terrainLocalResult(report)).toMatchObject({
            coarseFromState: false,
            coarseWindow: null,
            changes: { peak: 2 },
            candidate: true,
            base: { fingerprint: "f1" },
        });
        const window = { x0: 0, y0: 512, width: 1536, height: 1536, cell: 0.25 };
        expect(terrainLocalResult({ ...report, coarseWindow: window })).toMatchObject({
            coarseFromState: true,
            coarseWindow: window,
        });
        // Was in der groben Stufe steckt, steht neben ihrer Gesamtzeit (Claudios Messlauf 2026-10-18).
        expect(terrainLocalResult(report)).toMatchObject({
            phasesMs: { coarse: 175_400 },
            coarsePhasesMs: { erosion: 160_000, "mountain-interior": 9_000 },
        });
        // Die Meldung des ersten Durchgangs bei einer veralteten Saat (Stage 1696) steht im Ergebnis.
        expect(terrainLocalResult({ ...report, seedRetry: "stale V12 seed area" })).toMatchObject({
            seedRetry: "stale V12 seed area",
        });
    });
});
