import { describe, expect, it } from "vitest";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import {
    AVENTURIA_TERRAIN_RECIPE,
    AVENTURIA_TERRAIN_RECIPES,
    type TerrainRecipe,
} from "../src/terrain/domain/recipes.ts";
import { redistributeRegionally, redistributeSaturated, regionalWeightSum } from "../src/terrain/domain/uplift.ts";
import { fixture } from "./support/domain-terrain-fixture.ts";

/**
 * Prototyp D (2026-10-09): Die Rückverteilung des Erosionsverlusts (WI-0067 G7) regional statt domainweit. Fassung 17
 * rechnet domainweit und bleibt bytegleich (der Rückweg); seit Fassung 18 gilt regional, Radius 16 E, Sättigung 10
 * (Betreiber 2026-10-10).
 */

/** Die Fassung vor Prototyp D: der Rückweg, domainweit. */
const RECIPE_17 = AVENTURIA_TERRAIN_RECIPES.get(17)!;

function regional(radius: number, saturation?: number): TerrainRecipe {
    const recipe = structuredClone(RECIPE_17);
    recipe.generator.uplift = { kind: "regional", radius, ...(saturation === undefined ? {} : { saturation }) };
    return recipe;
}

/**
 * Fingerabdrücke der Fixture: Fassung 17 (vor Prototyp D), regional 16 E ohne Sättigung (vor der Nachstimmung vom
 * 2026-10-10) und Fassung 18 (regional 16 E, Sättigung 10).
 */
const DEFAULT_FINGERPRINT = "f3506f6fdc079f727dafa00925e620058a23f9eb9fb78a32646f1d658bb3d8a2";
const REGIONAL_16_FINGERPRINT = "77493385d998f14956b717cd676af420ab47321c63b083ad6130882ae706eec8";
const VERSION_18_FINGERPRINT = "1a25801435d006d6ba2b8b5cec4c924866d01bd5f74f86210a92edbb91e648af";

/** Masse je Runde erhalten (G7, Schranke 10⁻⁶), Meer 0, beide Gipfelanker exakt. */
function expectConstraints(result: ReturnType<typeof generateDomainTerrain>): void {
    for (const mass of result.report.masses)
        expect(Math.abs(mass.after - mass.before)).toBeLessThan(mass.before * 1e-6);
    const { samples, cell } = result.raster;
    for (let j = 0; j < 256; j += 1) expect(samples[j * 256 + 10]).toBe(0);
    for (const peak of [
        { x: 410, y: 600, h: 3000 },
        { x: 700, y: 250, h: 1200 },
    ]) {
        const i = Math.floor((peak.x - result.raster.originX) / cell);
        const j = Math.floor((peak.y - result.raster.originY) / cell);
        for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ])
            expect(samples[(j + dy!) * 256 + i + dx!]).toBe(peak.h);
    }
}

/** Kleines Feld für die Kerne: Spalten 0–7 Wasser, Zelle (40, 20) ein Gipfelanker, Spalten ab 32 „Gebirge“ (20). */
function kernelField(n: number) {
    const weightAt = (k: number): number => {
        const x = k % n;
        if (x < 8 || k === 20 * n + 40) return 0;
        return x >= 32 ? 20 : 1 + (x % 4);
    };
    const start = new Float32Array(n * n).fill(500);
    const height = start.slice();
    // Starker Abtrag am Rand des „Gebirges“, etwas Ablagerung daneben.
    for (let y = 26; y <= 34; y += 1) for (let x = 32; x <= 36; x += 1) height[y * n + x] = 440;
    height[30 * n + 31] = 510;
    let loss = 0;
    for (let k = 0; k < n * n; k += 1) loss += start[k]! - height[k]!;
    return { weightAt, start, height, loss };
}

/** Zellen (gespeicherte Ausrichtung) mit anderer Höhe, gezählt ab einem Mindestabstand vom Punkt. */
function changedBeyond(a: Uint16Array, b: Uint16Array, n: number, x: number, y: number, distance: number): number {
    const cell = 1024 / n;
    let changed = 0;
    for (let j = 0; j < n; j += 1)
        for (let i = 0; i < n; i += 1)
            if (a[j * n + i] !== b[j * n + i] && Math.hypot((i + 0.5) * cell - x, (j + 0.5) * cell - y) >= distance)
                changed += 1;
    return changed;
}

describe("Prototyp D: Rückverteilung des Erosionsverlusts", () => {
    // Zeitgrenze wie die übrigen Läufe: unter Last (andere Sitzungen rechnen) braucht auch die Vorgabe über 5 s.
    it("Fassung 17 (Rückweg): rechnet domainweit wie vor Prototyp D, bytegleich", { timeout: 60_000 }, () => {
        expect(RECIPE_17.generator).not.toHaveProperty("uplift");
        const result = generateDomainTerrain(fixture(), RECIPE_17, 256);
        // Fingerabdruck dieses Bestands mit dem Code vor Prototyp D (Generator 19, Rezept 17).
        expect(result.fingerprint).toBe(DEFAULT_FINGERPRINT);
    });

    it("Fassung 18 (aktiv): regional 16 E, Sättigung 10; Masse, Meer 0, Gipfelanker exakt", { timeout: 60_000 }, () => {
        expect(AVENTURIA_TERRAIN_RECIPE.version).toBe(18);
        const result = generateDomainTerrain(fixture(), AVENTURIA_TERRAIN_RECIPE, 256);
        expect(result.fingerprint).toBe(VERSION_18_FINGERPRINT);
        expect(result.report.uplift).toMatchObject({ kind: "regional", radius: 16, saturation: 10, clampedCells: 0 });
        expect(result.report.uplift?.unplacedLoss).toBe(0);
        expectConstraints(result);
    });

    it("regional: Masse je Runde erhalten, Meer 0, Gipfelanker exakt, deterministisch", { timeout: 60_000 }, () => {
        const result = generateDomainTerrain(fixture(), regional(16), 256);
        const repeated = generateDomainTerrain(fixture(), regional(16), 256);
        expect(repeated.fingerprint).toBe(result.fingerprint);
        // Ohne `saturation` rechnet die regionale Rückverteilung wie vor der Nachstimmung, bytegleich.
        expect(result.fingerprint).toBe(REGIONAL_16_FINGERPRINT);
        expect(result.report.uplift).toEqual({ kind: "regional", radius: 16, clampedCells: 0, unplacedLoss: 0 });
        expectConstraints(result);
    });

    it("Sättigung: Masse je Runde erhalten, Meer 0, Gipfelanker exakt, deterministisch", { timeout: 60_000 }, () => {
        const result = generateDomainTerrain(fixture(), regional(16, 5), 256);
        const repeated = generateDomainTerrain(fixture(), regional(16, 5), 256);
        expect(repeated.fingerprint).toBe(result.fingerprint);
        expect(result.fingerprint).not.toBe(REGIONAL_16_FINGERPRINT);
        expect(result.report.uplift).toMatchObject({ kind: "regional", radius: 16, saturation: 5, clampedCells: 0 });
        expect(result.report.uplift?.unplacedLoss).toBe(0);
        expect(result.report.uplift?.saturatedCells).toBeGreaterThan(0);
        expectConstraints(result);
    });

    it("Sättigungskern: ohne Wirkung wie der regionale Kern, mit Wirkung weniger aufs Gebirge, Masse gleich", () => {
        const n = 64;
        const radius = 3;
        const { weightAt, start, height, loss } = kernelField(n);
        const weightSum = regionalWeightSum(n, weightAt, new Float32Array(n * n), radius);
        const fields = () => ({ first: new Float32Array(n * n), sum: new Float32Array(n * n) });
        const plain = height.slice();
        redistributeRegionally(plain, start.slice(), new Float32Array(n * n), weightSum, weightAt, n, radius);
        // Sättigung weit über jeder Hebung: dieselben Zahlen wie ohne Sättigung.
        const loose = height.slice();
        const looseResult = redistributeSaturated(
            loose,
            start.slice(),
            new Float32Array(n * n),
            fields(),
            weightSum,
            weightAt,
            n,
            radius,
            1e9,
        );
        expect(looseResult).toEqual({ clampedCells: 0, unplacedLoss: 0, saturatedCells: 0 });
        expect(Array.from(loose)).toEqual(Array.from(plain));
        // Sättigung bei 2 Schritt je Runde: das „Gebirge“ nimmt weniger zurück, das Umland mehr, die Masse bleibt.
        const tight = height.slice();
        const tightResult = redistributeSaturated(
            tight,
            start.slice(),
            new Float32Array(n * n),
            fields(),
            weightSum,
            weightAt,
            n,
            radius,
            2,
        );
        expect(tightResult.saturatedCells).toBeGreaterThan(0);
        expect(tightResult.clampedCells).toBe(0);
        let onMountainPlain = 0;
        let onMountainTight = 0;
        let lifted = 0;
        for (let k = 0; k < n * n; k += 1) {
            const delta = tight[k]! - height[k]!;
            lifted += delta;
            const x = k % n;
            const y = Math.floor(k / n);
            // Reichweite wie ohne Sättigung: der Kern um jede Verlustzelle, nichts auf Wasser und Anker.
            if (
                weightAt(k) === 0 ||
                x < 31 - 3 * radius - 1 ||
                x > 36 + 3 * radius + 1 ||
                Math.abs(y - 30) > 4 + 3 * radius + 1
            )
                expect(delta, `Zelle ${String(x)},${String(y)}`).toBe(0);
            if (x >= 32) {
                onMountainPlain += plain[k]! - height[k]!;
                onMountainTight += delta;
            }
        }
        expect(lifted).toBeCloseTo(loss, 1);
        expect(onMountainTight).toBeLessThan(onMountainPlain * 0.9);
    });

    it("regionaler Kern: Verlust bleibt in Reichweite, Masse bleibt gleich, nichts auf Wasser und Ankern", () => {
        const n = 64;
        const radius = 3;
        // Spalten 0–7 Wasser, Zelle (40, 20) ein Gipfelanker; sonst Gewicht 1 bis 4 je nach Spalte.
        const weightAt = (k: number): number => {
            const x = k % n;
            if (x < 8 || k === 20 * n + 40) return 0;
            return 1 + (x % 4);
        };
        const weightSum = regionalWeightSum(n, weightAt, new Float32Array(n * n), radius);
        const start = new Float32Array(n * n).fill(500);
        const height = start.slice();
        height[30 * n + 30] = 400; // 100 Schritt Abtrag an einer Stelle
        height[30 * n + 31] = 510; // 10 Schritt Ablagerung daneben
        const after = height.slice();
        const placed = redistributeRegionally(
            after,
            start.slice(),
            new Float32Array(n * n),
            weightSum,
            weightAt,
            n,
            radius,
        );
        expect(placed).toEqual({ clampedCells: 0, unplacedLoss: 0 });
        let lifted = 0;
        for (let k = 0; k < n * n; k += 1) {
            const delta = after[k]! - height[k]!;
            lifted += delta;
            const x = k % n;
            const y = Math.floor(k / n);
            if (weightAt(k) === 0 || Math.max(Math.abs(x - 30), Math.abs(y - 30)) > 3 * radius + 1)
                expect(delta, `Zelle ${String(x)},${String(y)}`).toBe(0);
        }
        expect(lifted).toBeCloseTo(90, 2);
    });

    it(
        "regional bleibt eine ferne Änderung lokal, domainweit erreicht sie die ganze Karte",
        { timeout: 120_000 },
        () => {
            // Ein zusätzlicher freier Gipfel in der Nordostecke; Abstand gemessen von ihm.
            const extra = [{ id: "z-extra", name: "extra", x: 820, y: 820, h: 1500 }];
            const domainBefore = generateDomainTerrain(fixture(), RECIPE_17, 256).raster.samples;
            const domainAfter = generateDomainTerrain(fixture(extra), RECIPE_17, 256).raster.samples;
            expect(changedBeyond(domainBefore, domainAfter, 256, 820, 820, 256)).toBeGreaterThan(100);
            const before = generateDomainTerrain(fixture(), regional(8), 256).raster.samples;
            const after = generateDomainTerrain(fixture(extra), regional(8), 256).raster.samples;
            expect(changedBeyond(before, after, 256, 820, 820, 0)).toBeGreaterThan(50);
            expect(changedBeyond(before, after, 256, 820, 820, 128)).toBe(0);
        },
    );
});
