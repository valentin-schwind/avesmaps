import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
    dropCoarseState,
    promoteCoarseState,
    readCoarseState,
    readCurrentCoarseState,
    writeCoarseState,
    writeNextCoarseState,
} from "../src/terrain/domain/coarse-cache.ts";
import { localCoarse, tilesPlane, type CoarseState } from "../src/terrain/domain/coarse-local.ts";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { fixture, polygon } from "./support/domain-terrain-fixture.ts";

/**
 * WI-0223 Schritt 2: die grobe Stufe im Umkreis. Ein voller Lauf gibt seinen Stand der groben Stufe ab (Anfangsgelände, Gebirgsinneres);
 * ein lokaler rechnet das Anfangsgelände und das Gebirgsinnere nur im Fenster, die Erosion über die ganze Karte. Auf der kleinen
 * Domäne (256², 4 E je Zelle) mit Fassung 18.
 */

const N = 256;
/** Fassung 18 auf der Fixture, wie in `terrain-domain-uplift.test.ts` festgehalten (vor WI-0223). */
const VERSION_18_FINGERPRINT = "1a25801435d006d6ba2b8b5cec4c924866d01bd5f74f86210a92edbb91e648af";

function fullRun(input = fixture()): { fingerprint: string; state: CoarseState } {
    let state: CoarseState | undefined;
    const result = generateDomainTerrain(input, AVENTURIA_TERRAIN_RECIPE, N, undefined, undefined, undefined, {
        keep: (kept) => {
            state = kept;
        },
    });
    if (!state) throw new Error("kein Stand");
    return { fingerprint: result.fingerprint, state };
}

/** `localCoarse` verbraucht den vorigen Stand; jeder Fall nimmt eine Kopie. */
const kopie = (state: CoarseState): CoarseState => ({
    initial: state.initial.slice(),
    interior: state.interior.slice(),
});

const equal = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return false;
    return true;
};

describe("grobe Stufe im Umkreis (WI-0223)", () => {
    const base = fullRun();

    it("der volle Lauf gibt seinen Stand ab und rechnet dabei bytegleich", { timeout: 60_000 }, () => {
        expect(base.fingerprint).toBe(VERSION_18_FINGERPRINT);
        expect(base.state.interior).toHaveLength(N * N);
        expect(base.state.initial).toHaveLength(N * N);
    });

    it("ein Fenster über die ganze Karte rechnet wie der volle Lauf", { timeout: 60_000 }, () => {
        const plane = { x0: 0, y0: 0, width: N, height: N, cell: 1024 / N };
        const local = localCoarse(fixture(), AVENTURIA_TERRAIN_RECIPE, kopie(base.state), plane);
        expect(equal(local.state.initial, base.state.initial)).toBe(true);
        expect(equal(local.state.interior, base.state.interior)).toBe(true);
    });

    it(
        "🔴 eine Änderung im Fenster: Anfangsgelände und grobe Stufe sind die des vollen Laufs",
        { timeout: 60_000 },
        () => {
            // Der freie Gipfel wird höher, das Fenster sind die 128 E um ihn (die Kachel des Fußabdrucks mit Ring); außen trägt der Stand.
            const changed = () => {
                const input = fixture();
                input.peaks = input.peaks.map((peak) => (peak.id === "free-peak" ? { ...peak, h: 1800 } : peak));
                input.landscapes = input.landscapes.map((area) =>
                    area.type === "wald" ? { ...area, geometry: polygon(128, 128, 520, 410) } : area,
                );
                return input;
            };
            const full = fullRun(changed());
            const plane = { x0: 16, y0: 128, width: 224, height: 112, cell: 4 };
            const local = localCoarse(changed(), AVENTURIA_TERRAIN_RECIPE, kopie(base.state), plane);
            expect(equal(full.state.interior, base.state.interior)).toBe(false);
            expect(equal(local.state.initial, full.state.initial)).toBe(true);
            expect(equal(local.state.interior, full.state.interior)).toBe(true);
            expect(equal(local.raster.samples, full.state.interior)).toBe(true);
        },
    );

    it(
        "ein zu kleines Fenster lässt Anfangsgelände des vorigen Laufs stehen (darum der Ring im Fußabdruck)",
        { timeout: 60_000 },
        () => {
            // Das Hügelland (Landformen im Anfangsgelände) reicht 20 E weiter nach Osten, das Fenster liegt südlich davon.
            const changed = fixture();
            changed.landscapes = changed.landscapes.map((area) =>
                area.type === "huegelland" ? { ...area, geometry: polygon(560, 520, 780, 700) } : area,
            );
            const full = fullRun(changed);
            expect(equal(full.state.initial, base.state.initial)).toBe(false);
            const plane = { x0: 151, y0: 169, width: 48, height: 48, cell: 4 };
            const local = localCoarse(changed, AVENTURIA_TERRAIN_RECIPE, kopie(base.state), plane);
            expect(equal(local.state.initial, full.state.initial)).toBe(false);
            expect(equal(local.state.initial, base.state.initial)).toBe(true);
        },
    );

    it("das Fenster ist das Hüllrechteck der Rechenkacheln auf dem groben Gitter", () => {
        expect(tilesPlane([9], 8, 4096)).toEqual({ x0: 512, y0: 512, width: 512, height: 512, cell: 0.25 });
        expect(tilesPlane([0, 1, 9], 8, 4096)).toEqual({ x0: 0, y0: 0, width: 1024, height: 1024, cell: 0.25 });
        expect(() => tilesPlane([], 8, 4096)).toThrow();
    });
});

describe("Ablage des Stands der groben Stufe (WI-0223)", () => {
    const dirs: string[] = [];
    const tempDir = async (): Promise<string> => {
        const dir = await mkdtemp(join(tmpdir(), "avesmaps-coarse-"));
        dirs.push(dir);
        return dir;
    };
    afterAll(async () => {
        for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    });
    const state = (seed: number): CoarseState => {
        const n = 4;
        return {
            initial: Float32Array.from({ length: n * n }, (_, k) => k * 1.5 - seed),
            interior: Uint16Array.from({ length: n * n }, (_, k) => 2 * k + seed),
        };
    };

    it("liest nur den Stand des geltenden Masters", async () => {
        const dir = await tempDir();
        await writeCoarseState(dir, "aventuria-coarse", state(1), "m1");
        expect(await readCurrentCoarseState("aventuria", "m1", 4, dir)).toEqual(state(1));
        expect(await readCurrentCoarseState("aventuria", "m2", 4, dir)).toBeUndefined();
        expect(await readCurrentCoarseState("aventuria", "m1", 8, dir)).toBeUndefined();
        await dropCoarseState("aventuria", dir);
        expect(await readCurrentCoarseState("aventuria", "m1", 4, dir)).toBeUndefined();
    });

    it("ein beschädigter Stand wird nie gelesen", async () => {
        const dir = await tempDir();
        await writeCoarseState(dir, "aventuria-coarse", state(1), "m1");
        await writeFile(join(dir, "aventuria-coarse.bin"), Buffer.alloc(16 * 6, 7));
        expect(await readCoarseState(dir, "aventuria-coarse", 4)).toBeUndefined();
    });

    it("der volle Lauf und dem_publish machen einen abgelegten Stand zum Stand des Masters", async () => {
        const cache = await tempDir();
        writeNextCoarseState("aventuria", state(2), cache);
        expect(
            await promoteCoarseState(
                { dir: cache, name: "aventuria-coarse-next", move: true },
                "aventuria",
                "voll",
                cache,
            ),
        ).toBe(true);
        expect(await readCurrentCoarseState("aventuria", "voll", 4, cache)).toEqual(state(2));
        expect(await readCoarseState(cache, "aventuria-coarse-next", 4)).toBeUndefined();
        const candidate = await tempDir();
        await writeCoarseState(candidate, "coarse", state(3), null);
        expect(await promoteCoarseState({ dir: candidate, name: "coarse" }, "aventuria", "lokal", cache)).toBe(true);
        expect(await readCurrentCoarseState("aventuria", "lokal", 4, cache)).toEqual(state(3));
        // Kopiert: Der Kandidat bleibt, bis dem_publish ihn wegräumt.
        expect(await readCoarseState(candidate, "coarse", 4)).toBeDefined();
        expect(await promoteCoarseState({ dir: candidate, name: "fehlt" }, "aventuria", "x", cache)).toBe(false);
    });
});
