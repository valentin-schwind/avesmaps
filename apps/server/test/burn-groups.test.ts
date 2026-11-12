import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    burnRasters,
    mergeBurnReports,
    planBurnGroups,
    targetFingerprints,
    UNBURNT,
    type BurnInput,
    type BurnRaster,
    type BurnRun,
    type BurnStored,
} from "../src/terrain/burn-groups.ts";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { DEFAULT_CONE, type FreePeak } from "../src/terrain/peak-cone.ts";
import { burnRivers, FLOOR_HALF_WIDTH, trenchReach } from "../src/terrain/river-burn.ts";
import type { RiverLake, RiverRow } from "../src/terrain/river-network.ts";

/**
 * Das Einbrennen in Gruppen (WI-0059, 4.1/4.2): Jede Gruppe brennt für sich, und nur die veraltete neu; das Ergebnis
 * ist bytegleich zu einem Einbrennen über alle Raster zugleich (dem Verhalten vor WI-0059). Alles an erfundenen
 * Landkarten mit mehreren Gebirgen, Flüssen, T-Stößen, Seen und freien Gipfeln, ohne Datenbank und ohne V12.
 */

const CELL = 0.25;

/** Ein kleiner, wiederholbarer Zufall (mulberry32). */
function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Bump {
    x: number;
    y: number;
    sigma: number;
    height: number;
}

interface Mountain {
    id: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    bumps: Bump[];
}

/** Das Raster eines Gebirges: Hügelland mit Gipfeln, außerhalb einer Ellipse 0 (wie außerhalb der Fläche). */
function rasterOf(mountain: Mountain): StoredRaster {
    const { width, height, originX, originY } = mountain;
    const samples = new Uint16Array(width * height);
    for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
            const dx = (i - (width - 1) / 2) / ((width - 1) / 2);
            const dy = (j - (height - 1) / 2) / ((height - 1) / 2);
            if (dx * dx + dy * dy > 1) continue;
            const x = originX + i * CELL;
            const y = originY + j * CELL;
            let h = 300;
            for (const b of mountain.bumps) {
                h += b.height * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.sigma ** 2));
            }
            samples[j * width + i] = Math.max(1, Math.round(h));
        }
    }
    return { cell: CELL, originX, originY, width, height, samples };
}

const keyOf = (raster: StoredRaster): string =>
    createHash("sha256")
        .update(Buffer.from(raster.samples.buffer, raster.samples.byteOffset, raster.samples.byteLength))
        .digest("hex")
        .slice(0, 16);

interface Scene {
    mountains: Mountain[];
    rivers: RiverRow[];
    lakes: RiverLake[];
    peaks: FreePeak[];
}

const square = (cx: number, cy: number, half: number): RiverLake["geometry"] => ({
    type: "Polygon",
    coordinates: [
        [
            [cx - half, cy - half],
            [cx + half, cy - half],
            [cx + half, cy + half],
            [cx - half, cy + half],
            [cx - half, cy - half],
        ],
    ],
});

/**
 * Eine Landkarte: `clusters` Gruppen von je zwei bis drei benachbarten Gebirgen, weit voneinander entfernt, dazu
 * Flüsse durch jede Gruppe (mit Knoten, T-Stößen und Seen) und einige freie Gipfel. Ein Fluss fern jedes Gebirges.
 */
function scene(seed: number, clusters = 4): Scene {
    const rnd = random(seed);
    const mountains: Mountain[] = [];
    const rivers: RiverRow[] = [];
    const lakes: RiverLake[] = [];
    const peaks: FreePeak[] = [];
    let riverNo = 0;
    for (let c = 0; c < clusters; c += 1) {
        const cx = 200 + (c % 2) * 60 + rnd() * 4;
        const cy = 300 + Math.floor(c / 2) * 60 + rnd() * 4;
        const first = mountains.length;
        const count = 2 + Math.floor(rnd() * 2);
        for (let m = 0; m < count; m += 1) {
            const width = 36 + Math.floor(rnd() * 24);
            const height = 36 + Math.floor(rnd() * 24);
            const originX = cx + m * 6 + rnd() * 2;
            const originY = cy + (rnd() - 0.5) * 6;
            const bumps: Bump[] = [];
            for (let b = 0; b < 3; b += 1) {
                bumps.push({
                    x: originX + (0.2 + 0.6 * rnd()) * width * CELL,
                    y: originY + (0.2 + 0.6 * rnd()) * height * CELL,
                    sigma: 1 + rnd() * 1.5,
                    height: 700 + rnd() * 4300,
                });
            }
            mountains.push({ id: 1000 + mountains.length, originX, originY, width, height, bumps });
        }
        const span = mountains.slice(first);
        const points: [number, number][] = [];
        // Flüsse: ein Zufallsweg durch die Gebirge der Gruppe, einige mit T-Stoß auf einen früheren.
        for (let r = 0; r < 4; r += 1) {
            let x: number;
            let y: number;
            if (r > 0 && rnd() < 0.5 && points.length > 0) {
                // Quelle auf einem früheren Fluss (T-Stoß oder Knoten, dieselbe Stützstelle).
                [x, y] = points[Math.floor(rnd() * points.length)] as [number, number];
            } else {
                const m = span[Math.floor(rnd() * span.length)] as Mountain;
                x = m.originX + (0.15 + 0.7 * rnd()) * m.width * CELL;
                y = m.originY + (0.15 + 0.7 * rnd()) * m.height * CELL;
            }
            let angle = rnd() * Math.PI * 2;
            const coordinates: [number, number][] = [[x, y]];
            const steps = 6 + Math.floor(rnd() * 8);
            for (let s = 0; s < steps; s += 1) {
                angle += (rnd() - 0.5) * 1.1;
                const step = 0.6 + rnd();
                x += Math.cos(angle) * step;
                y += Math.sin(angle) * step;
                coordinates.push([x, y]);
            }
            for (const point of coordinates) points.push(point);
            riverNo += 1;
            const direction = rnd() < 0.4 ? null : rnd() < 0.5 ? "forward" : "reverse";
            rivers.push({
                id: String(riverNo),
                name: `Fluss ${String(riverNo)}`,
                bach: rnd() < 0.3,
                direction,
                coordinates,
                coast: direction === null && rnd() < 0.5 ? [rnd() * 10, rnd() * 10] : null,
            });
        }
        // Ein See um eine Stützstelle des letzten Flusses.
        const at = points[points.length - 5] as [number, number];
        lakes.push({ id: `see-${String(c)}`, name: `See ${String(c)}`, geometry: square(at[0], at[1], 0.9) });
        peaks.push({ x: cx + rnd() * 20, y: cy - 4 - rnd() * 4, h: rnd() < 0.3 ? null : 500 + rnd() * 2000 });
    }
    // Ein Fluss fern jedes Gebirges: tut dem Einbrennen nichts und gehört zu keiner Gruppe.
    rivers.push({
        id: "fern",
        name: "Ferner Fluss",
        bach: false,
        direction: "forward",
        coordinates: [
            [700, 700],
            [704, 703],
            [709, 704],
        ],
        coast: null,
    });
    return { mountains, rivers, lakes, peaks };
}

/** Die Eingabe des Einbrennens für eine Landkarte; der V12-Stand eines Gebirges ist sein Inhalt. */
function inputOf(
    s: Scene,
    stored: ReadonlyMap<number, BurnStored> = new Map(),
    force?: BurnInput["force"],
    withAnchors = true,
): BurnInput {
    const rasters: BurnRaster[] = s.mountains.map((m) => {
        const raster = rasterOf(m);
        return { areaId: m.id, v12Fingerprint: keyOf(raster), raster };
    });
    return {
        rasters,
        stored,
        rivers: s.rivers,
        lakes: s.lakes,
        peaks: s.peaks,
        rule: DEFAULT_CONE,
        anchors: withAnchors ? s.mountains.flatMap((m) => m.bumps.map((b) => ({ x: b.x, y: b.y }))) : [],
        ...(force === undefined ? {} : { force }),
    };
}

/** Das Einbrennen wie vor WI-0059: alle Flüsse in alle Raster zugleich. */
function overall(input: BurnInput): Uint16Array[] {
    const copies = input.rasters.map((entry) => ({
        ...entry.raster,
        samples: Uint16Array.from(entry.raster.samples),
    }));
    burnRivers(
        copies,
        { rivers: input.rivers, lakes: input.lakes },
        { peaks: input.peaks, rule: input.rule, anchors: input.anchors },
    );
    return copies.map((copy) => copy.samples);
}

const same = (a: Uint16Array, b: Uint16Array): boolean =>
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

function storedOf(run: BurnRun): Map<number, BurnStored> {
    return new Map(
        run.rasters.map((entry) => [entry.areaId, { fingerprint: entry.fingerprint, samples: entry.samples }]),
    );
}

/** Die eingebrannten Bytes je Raster als lesbarer Vergleich: Kennung und Prüfsumme. */
function digest(run: BurnRun): string[] {
    return run.rasters.map(
        (entry) =>
            `${String(entry.areaId)}:${entry.fingerprint.slice(0, 8)}:${createHash("sha256")
                .update(Buffer.from(entry.samples.buffer, entry.samples.byteOffset, entry.samples.byteLength))
                .digest("hex")
                .slice(0, 12)}`,
    );
}

describe("Gruppen gegen das Einbrennen über alle Raster", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
        it(`bytegleich, Landkarte ${String(seed)}`, () => {
            const input = inputOf(scene(seed));
            const groups = planBurnGroups({ ...input, rasters: input.rasters.map((entry) => entry.raster) });
            const run = burnRasters({ ...input, force: true });
            const wanted = overall(input);
            run.rasters.forEach((entry, i) => {
                expect(same(entry.samples, wanted[i] as Uint16Array), `Raster ${String(entry.areaId)}`).toBe(true);
            });
            // Die Karte hat mehrere Gruppen und mindestens eine mit mehreren Gebirgen, sonst prüft der Test nichts.
            expect(groups.length).toBeGreaterThanOrEqual(2);
            expect(groups.some((group) => group.rasters.length >= 2)).toBe(true);
            // Das Einbrennen hat etwas getan.
            expect(run.report?.changedCells ?? 0).toBeGreaterThan(0);
            // Der ferne Fluss gehört zu keiner Gruppe.
            const indexOfFar = input.rivers.findIndex((row) => row.id === "fern");
            expect(groups.some((group) => group.rivers.includes(indexOfFar))).toBe(false);
        });
    }

    it("ein Gebirge, das kein Fluss erreicht, bleibt, wie V12 es liefert", () => {
        const input = inputOf(scene(1));
        const lonely: Mountain = {
            id: 9999,
            originX: 500,
            originY: 500,
            width: 40,
            height: 40,
            bumps: [{ x: 503, y: 503, sigma: 2, height: 3000 }],
        };
        const withLonely = inputOf({ ...scene(1), mountains: [...scene(1).mountains, lonely] });
        const run = burnRasters({ ...withLonely, force: true });
        const entry = run.rasters.find((r) => r.areaId === 9999);
        const raster = withLonely.rasters.find((r) => r.areaId === 9999) as BurnRaster;
        expect(entry && same(entry.samples, raster.raster.samples)).toBe(true);
        expect(entry?.burned).toBe(false);
        expect(input.rasters).toHaveLength(withLonely.rasters.length - 1);
    });
});

describe("die Grenze der Gruppe reicht so weit wie der Graben", () => {
    /**
     * Zwei Raster mit `gap` Karteneinheiten dazwischen. Im ersten fließt ein Fluss aus der Niederung über einen Riegel
     * der Höhe `ridge` und schneidet ihn durch; das zweite ist eine Hochfläche von 3.300, die der Graben anschneidet,
     * wenn sie in Reichweite liegt. Ohne Gipfelsperre, damit der Einschnitt nicht an einem Anker endet.
     */
    function pair(gap: number, ridge: number): BurnInput {
        const width = 60;
        const height = 60;
        const first: Mountain = {
            id: 1,
            originX: 300,
            originY: 300,
            width,
            height,
            bumps: [{ x: 313, y: 311, sigma: 1.2, height: ridge }],
        };
        const second: Mountain = {
            id: 2,
            originX: 300 + width * CELL + gap,
            originY: 300,
            width,
            height,
            bumps: [{ x: 320, y: 320, sigma: 100, height: 3000 }],
        };
        const rivers: RiverRow[] = [
            {
                id: "r",
                name: "Riegel",
                bach: false,
                direction: "forward",
                coordinates: [
                    [306, 303],
                    [309, 307],
                    [313, 311],
                    [314, 314],
                ],
                coast: null,
            },
        ];
        return inputOf({ mountains: [first, second], rivers, lakes: [], peaks: [] }, new Map(), undefined, false);
    }

    it("ein tiefer Einschnitt zieht das Nachbargebirge in die Gruppe, ein flacher nicht", () => {
        const deep = pair(2, 5000);
        const groupsDeep = planBurnGroups({ ...deep, rasters: deep.rasters.map((entry) => entry.raster) });
        expect(groupsDeep).toHaveLength(1);
        expect(groupsDeep[0]?.rasters).toEqual([0, 1]);

        const shallow = pair(2, 600);
        const groupsShallow = planBurnGroups({ ...shallow, rasters: shallow.rasters.map((entry) => entry.raster) });
        expect(groupsShallow.flatMap((group) => group.rasters)).toEqual([0]);
        // Die Schranke, an der das hängt: so tief wie das Gelände, durch die Flanke.
        expect(trenchReach(FLOOR_HALF_WIDTH, 5300)).toBeGreaterThan(5);
        expect(trenchReach(FLOOR_HALF_WIDTH, 900)).toBeLessThan(2);
    });

    it("beides brennt bytegleich zum Einbrennen über alle Raster, auch wenn der Graben ins Nachbargebirge reicht", () => {
        let touched = 0;
        for (const [gap, ridge] of [
            [0.3, 5000],
            [0.8, 5000],
            [2, 5000],
            [2, 600],
            [6, 5000],
            [12, 5000],
        ] as const) {
            const input = pair(gap, ridge);
            const run = burnRasters({ ...input, force: true });
            const wanted = overall(input);
            run.rasters.forEach((entry, i) => {
                expect(
                    same(entry.samples, wanted[i] as Uint16Array),
                    `Abstand ${String(gap)}, Riegel ${String(ridge)}`,
                ).toBe(true);
            });
            // Wo der Graben das Nachbargebirge tatsächlich anschneidet, hat der Test etwas geprüft.
            const second = run.rasters[1] as BurnRun["rasters"][number];
            if (!same(second.samples, (input.rasters[1] as BurnRaster).raster.samples)) touched += 1;
        }
        expect(touched).toBeGreaterThanOrEqual(1);
    });
});

describe("nur die veralteten Gruppen brennen neu, das Ergebnis bleibt bytegleich", () => {
    /** Eine geänderte Landkarte, einmal inkrementell gegen den Stand vor der Änderung, einmal voll. */
    function compare(before: Scene, after: Scene): { incremental: BurnRun; full: BurnRun; base: BurnRun } {
        const base = burnRasters({ ...inputOf(before), force: true });
        const incremental = burnRasters(inputOf(after, storedOf(base)));
        const full = burnRasters({ ...inputOf(after), force: true });
        expect(digest(incremental)).toEqual(digest(full));
        incremental.rasters.forEach((entry, i) => {
            expect(same(entry.samples, (full.rasters[i] as BurnRun["rasters"][number]).samples)).toBe(true);
        });
        return { incremental, full, base };
    }

    it("nichts geändert: keine Gruppe brennt, nichts ist zu schreiben", () => {
        const s = scene(2);
        const { incremental, base } = compare(s, s);
        expect(incremental.burnedGroups).toBe(0);
        expect(incremental.burnedRasters).toBe(0);
        expect(incremental.report).toBeNull();
        expect(incremental.rasters.every((entry) => !entry.changed && !entry.burned)).toBe(true);
        expect(incremental.groups).toBe(base.groups);
    });

    for (const seed of [2, 3, 4]) {
        it(`ein Gipfel geändert (Landkarte ${String(seed)}): nur seine Gruppe`, () => {
            const before = scene(seed);
            const changed = before.mountains.map((m, i) =>
                i === 0 ? { ...m, bumps: m.bumps.map((b, k) => (k === 0 ? { ...b, height: b.height + 500 } : b)) } : m,
            );
            const { incremental, full } = compare(before, { ...before, mountains: changed });
            expect(incremental.burnedGroups).toBeGreaterThanOrEqual(1);
            expect(incremental.burnedGroups).toBeLessThan(full.burnedGroups);
            // Die Raster anderer Gruppen sind unverändert und werden nicht geschrieben.
            expect(incremental.rasters.filter((entry) => !entry.changed).length).toBeGreaterThan(0);
        });

        it(`ein Fluss verschoben (Landkarte ${String(seed)}): nur seine Gruppe`, () => {
            const before = scene(seed);
            const rivers = before.rivers.map((row, i) =>
                i === 1
                    ? { ...row, coordinates: row.coordinates.map(([x, y]): [number, number] => [x + 0.07, y - 0.05]) }
                    : row,
            );
            const { incremental, full } = compare(before, { ...before, rivers });
            expect(incremental.burnedGroups).toBeGreaterThanOrEqual(1);
            expect(incremental.burnedGroups).toBeLessThan(full.burnedGroups);
        });

        it(`ein See geändert (Landkarte ${String(seed)}): nur seine Gruppe`, () => {
            const before = scene(seed);
            const lakes = before.lakes.map((lake, i) => {
                if (i !== 0 || lake.geometry.type !== "Polygon") return lake;
                return {
                    ...lake,
                    geometry: {
                        ...lake.geometry,
                        coordinates: lake.geometry.coordinates.map((ring) =>
                            ring.map((point): [number, number] => [point[0] as number, (point[1] as number) + 0.3]),
                        ),
                    },
                };
            });
            const { incremental, full } = compare(before, { ...before, lakes });
            expect(incremental.burnedGroups).toBeGreaterThanOrEqual(1);
            expect(incremental.burnedGroups).toBeLessThan(full.burnedGroups);
        });
    }

    it("ein Gebirge neu: es fließt in die Gruppe ein, die es berührt, die übrigen bleiben", () => {
        const before = scene(3);
        const first = before.mountains[0] as Mountain;
        // Ein neues Gebirge am Rand des ersten, mit einem Fluss hinein.
        const added: Mountain = {
            id: 4242,
            originX: first.originX + first.width * CELL + 0.5,
            originY: first.originY,
            width: 40,
            height: 40,
            bumps: [{ x: first.originX + first.width * CELL + 3, y: first.originY + 5, sigma: 1.2, height: 3000 }],
        };
        const river: RiverRow = {
            id: "neu",
            name: "Neuer Fluss",
            bach: false,
            direction: "forward",
            coordinates: [
                [added.originX + 1, added.originY + 4],
                [added.originX + 3, added.originY + 6],
                [added.originX + 6, added.originY + 8],
            ],
            coast: null,
        };
        const { incremental, full } = compare(before, {
            ...before,
            mountains: [...before.mountains, added],
            rivers: [...before.rivers, river],
        });
        expect(incremental.burnedGroups).toBeLessThan(full.burnedGroups);
    });

    it("ein Gebirge entfällt: die Gruppe, in der es lag, brennt ohne es neu", () => {
        const before = scene(3);
        const { incremental, full } = compare(before, { ...before, mountains: before.mountains.slice(1) });
        expect(incremental.burnedGroups).toBeGreaterThanOrEqual(1);
        expect(incremental.burnedGroups).toBeLessThanOrEqual(full.burnedGroups);
    });

    it("ein freier Gipfel geändert: nur die Gruppen, deren Läufe sein Kegel berührt", () => {
        const before = scene(4);
        const s: Scene = { ...before, peaks: before.peaks.map((peak, i) => (i === 0 ? { ...peak, h: 2400 } : peak)) };
        const { incremental, full } = compare(before, s);
        expect(incremental.burnedGroups).toBeLessThanOrEqual(full.burnedGroups);
    });

    it("`force` mit einer Menge von Gebirgen brennt nur deren Gruppen", () => {
        const s = scene(2);
        const base = burnRasters({ ...inputOf(s), force: true });
        const first = s.mountains[0] as Mountain;
        const forced = burnRasters(inputOf(s, storedOf(base), new Set([first.id])));
        expect(forced.burnedGroups).toBe(1);
        expect(digest(forced)).toEqual(digest(base));
    });
});

describe("Fingerabdruck", () => {
    it("hängt an der Gruppe, nicht an der Karte: ein Gipfel in einer anderen Gruppe ändert ihn nicht", () => {
        const before = scene(3);
        const a = targetFingerprints(inputOf(before));
        const changed = before.mountains.map((m, i) =>
            i === 0 ? { ...m, bumps: m.bumps.map((b, k) => (k === 0 ? { ...b, height: b.height + 500 } : b)) } : m,
        );
        const b = targetFingerprints(inputOf({ ...before, mountains: changed }));
        const differing = a.targets.filter((fp, i) => fp !== b.targets[i]).length;
        expect(differing).toBeGreaterThanOrEqual(1);
        expect(differing).toBeLessThan(a.targets.length);
        // Ein Gebirge ohne Gruppe trägt die Kennung ohne Fluss.
        const lonely: Mountain = {
            id: 9999,
            originX: 500,
            originY: 500,
            width: 40,
            height: 40,
            bumps: [{ x: 503, y: 503, sigma: 2, height: 3000 }],
        };
        const input = inputOf({ ...before, mountains: [...before.mountains, lonely] });
        const { targets } = targetFingerprints(input);
        const loneRaster = input.rasters[input.rasters.length - 1] as BurnRaster;
        expect(targets[targets.length - 1]).toBe(
            createHash("sha256").update(`${loneRaster.v12Fingerprint}|${UNBURNT}`).digest("hex"),
        );
    });

    it("ist unabhängig von der Reihenfolge der Gebirge in der Liste", () => {
        const s = scene(2);
        const forward = targetFingerprints(inputOf(s));
        const reversed = targetFingerprints(inputOf({ ...s, mountains: [...s.mountains].reverse() }));
        const byArea = new Map(inputOf(s).rasters.map((entry, i) => [entry.areaId, forward.targets[i]]));
        const other = inputOf({ ...s, mountains: [...s.mountains].reverse() });
        other.rasters.forEach((entry, i) => expect(reversed.targets[i]).toBe(byArea.get(entry.areaId)));
    });
});

describe("Berichte", () => {
    it("die Berichte der Gruppen ergeben zusammen den des Einbrennens über alle Raster", () => {
        const input = inputOf(scene(5));
        const copies = input.rasters.map((entry) => ({
            ...entry.raster,
            samples: Uint16Array.from(entry.raster.samples),
        }));
        const whole = burnRivers(
            copies,
            { rivers: input.rivers, lakes: input.lakes },
            { peaks: input.peaks, rule: input.rule, anchors: input.anchors },
        );
        const grouped = burnRasters({ ...input, force: true }).report;
        expect(grouped?.changedCells).toBe(whole.changedCells);
        expect(grouped?.rasters.risingAfter).toBe(whole.rasters.risingAfter);
        expect(grouped?.converged).toBe(true);
        expect(mergeBurnReports([])).toBeNull();
    });
});
