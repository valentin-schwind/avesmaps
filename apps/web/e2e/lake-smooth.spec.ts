import { expect, test, type Page } from "@playwright/test";
import { AVENTURIA_PATH_CARTOGRAPHY } from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";

/**
 * Seen sind in den Landschaftsansichten geglättet (Betreiber 2026-10-04: „der see wird angezeigt, aber ungeglättet“), und seit
 * WI-0077 mit EINEM Ufer: Der See gehört zum gemeinsamen Netz aller Flächen („seen gehören zur topographie und werden
 * geglättet, gemeinsam angrenzend: ja“). Die Landschaftskacheln (`region_area_render`) und die Wasserquelle
 * (`terrain_water_render`) tragen dieselbe Form, und die Kante der Fläche daneben ist dieselbe Linie.
 *
 * Die Probe liest beide Quellen: Jeder See, den beide tragen, hat dort dieselben Punkte (kein zweites Ufer, nichts Eckiges, das
 * unter der weichen Form hervorschaut), und er ist rund. Dazu steht die Wasserfarbe im See auf dem Canvas.
 *
 * Läuft in Chromium und, wo installiert, im iPhone-Profil mit WebKit.
 */

/** Im Ochsenwasser, dem größten See Aventuriens (Kartenkoordinaten, Legacy-Bestand). */
const OCHSENWASSER = { x: 597.841, y: 549.016 };
const ZOOM = 7.5;

const WATER = AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"]?.center ?? "";
const WATER_RGB = [1, 3, 5].map((start) => Number.parseInt(WATER.slice(start, start + 2), 16));

interface LakeProbe {
    /** Seen, die beide Quellen tragen, und davon die mit verschiedenen Punkten. */
    lakes: number;
    differing: number;
    /** Stützpunkte der Seen in der Wasserquelle und der Anteil mit einem Knick über 35 Grad. */
    vertices: number;
    sharpShare: number;
    /** Steht in der Mitte des Bilds (im See) die Wasserfarbe? */
    waterInCenter: boolean;
}

/** Öffnet die Ansicht über dem See und wartet, bis die Kacheln beider Quellen gezeichnet sind. */
async function openAtLake(page: Page, view: string): Promise<void> {
    const at = `x=${String(OCHSENWASSER.x)}&y=${String(OCHSENWASSER.y)}&z=${String(ZOOM)}`;
    await page.goto("about:blank");
    await page.goto(`/#${at}&series=original&${view}`);
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap;
            if (!map?.isStyleLoaded() || !map.loaded()) {
                return false;
            }
            return map.queryRenderedFeatures({ layers: ["gewaesser-flaeche"] }).length > 0;
        },
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
}

async function probeLakes(page: Page): Promise<LakeProbe> {
    return page.evaluate(
        (rgb) =>
            new Promise<LakeProbe>((resolve, reject) => {
                const map = globalThis.avesmapsMap;
                if (!map) {
                    reject(new Error("map handle missing"));
                    return;
                }
                type Feature = {
                    properties: { region_type: string; region_public_id: string };
                    geometry: { type: string; coordinates: unknown };
                };
                const rings = (feature: Feature): number[][][] => {
                    const coordinates = feature.geometry.coordinates as number[][][] | number[][][][];
                    return (feature.geometry.type === "Polygon" ? [coordinates] : coordinates).flat() as number[][][];
                };
                const shapes = (features: Feature[]): Map<string, Set<string>> => {
                    const out = new Map<string, Set<string>>();
                    for (const feature of features) {
                        if (feature.properties.region_type !== "see") continue;
                        const set = out.get(feature.properties.region_public_id) ?? new Set<string>();
                        for (const ring of rings(feature)) {
                            for (const [lng, lat] of ring) set.add(`${(lng ?? 0).toFixed(7)},${(lat ?? 0).toFixed(7)}`);
                        }
                        out.set(feature.properties.region_public_id, set);
                    }
                    return out;
                };
                const water = map.querySourceFeatures("gewaesser", {
                    sourceLayer: "terrain_water_render",
                } as never) as unknown as Feature[];
                const tiles = map.querySourceFeatures("landscapes", {
                    sourceLayer: "region_area_render",
                } as never) as unknown as Feature[];
                const fromWater = shapes(water);
                const fromTiles = shapes(tiles);
                let lakes = 0;
                let differing = 0;
                for (const [id, set] of fromWater) {
                    const other = fromTiles.get(id);
                    if (!other) continue;
                    lakes += 1;
                    if (set.size !== other.size || [...set].some((key) => !other.has(key))) differing += 1;
                }
                let vertices = 0;
                let sharp = 0;
                for (const feature of water) {
                    if (feature.properties.region_type !== "see") continue;
                    for (const ring of rings(feature)) {
                        const pixels = ring.map(([lng, lat]) => map.project({ lng: lng ?? 0, lat: lat ?? 0 }));
                        for (let at = 1; at < pixels.length - 1; at += 1) {
                            const [before, here, after] = [pixels[at - 1], pixels[at], pixels[at + 1]];
                            if (!before || !here || !after) continue;
                            const ax = here.x - before.x;
                            const ay = here.y - before.y;
                            const bx = after.x - here.x;
                            const by = after.y - here.y;
                            const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
                            if (length < 1e-9) continue;
                            vertices += 1;
                            const angle =
                                (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / length))) * 180) / Math.PI;
                            if (angle > 35) sharp += 1;
                        }
                    }
                }
                const canvas = map.getCanvas();
                const center = globalThis.avesmapsVisibleArea!.centre();
                // 🪤 Seit 2026-10-05 steht der Name einer Klimazone mittig im Bild (WI-0012), in „Alle“ oft genau über der
                // Mitte des Sees. Gemessen wird der See, nicht der Name: Die Ebene ruht für diese Probe.
                if (map.getLayer("climate-label")) {
                    (
                        map as unknown as { setLayoutProperty(id: string, name: string, value: string): void }
                    ).setLayoutProperty("climate-label", "visibility", "none");
                }
                map.once("render", () => {
                    const copy = document.createElement("canvas");
                    copy.width = canvas.width;
                    copy.height = canvas.height;
                    const context = copy.getContext("2d", { willReadFrequently: true });
                    if (!context) {
                        reject(new Error("no 2d context"));
                        return;
                    }
                    context.drawImage(canvas, 0, 0);
                    const scale = canvas.width / canvas.clientWidth;
                    const pixel = context.getImageData(
                        Math.round(center.x * scale),
                        Math.round(center.y * scale),
                        1,
                        1,
                    ).data;
                    const waterInCenter = [0, 1, 2].every(
                        (channel) => Math.abs((pixel[channel] ?? 0) - (rgb[channel] ?? 0)) <= 12,
                    );
                    resolve({ lakes, differing, vertices, sharpShare: sharp / Math.max(1, vertices), waterInCenter });
                });
                map.triggerRepaint();
            }),
        WATER_RGB,
    );
}

/** Die Ebenen, die einen See als Fläche zeichnen: Alle, Vegetation und Derographisch lesen die Landschaftskacheln. */
const WITH_TILE_FILLS: { name: string; hash: string }[] = [
    { name: "Landschaften, Alle", hash: "view=landscapes&layer=alle" },
    { name: "Landschaften, Vegetation", hash: "view=landscapes&layer=vegetation" },
    { name: "Landschaften, Derographisch", hash: "view=landscapes&layer=derographisch" },
];

for (const view of WITH_TILE_FILLS) {
    test(`🔴 ${view.name}: der See steht in der weichen Form, mit einem Ufer für Wasser und Landschaft`, async ({
        page,
    }) => {
        await openAtLake(page, view.hash);
        const style = await page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id));
        expect(style, "keine zweite Seefläche aus den Landschaftskacheln im Stil").not.toContain("landscape-fill-see");
        const probe = await probeLakes(page);
        // Die Probe misst etwas: Seen in beiden Quellen, mit genug Punkten.
        expect(probe.lakes, "Seen in beiden Quellen").toBeGreaterThanOrEqual(1);
        expect(probe.vertices, "Stützpunkte der Seen").toBeGreaterThan(100);
        expect(probe.differing, "Seen mit einem zweiten Ufer").toBe(0);
        expect(probe.sharpShare, "Anteil der scharfen Ecken am Ufer").toBeLessThan(0.2);
        expect(probe.waterInCenter, `die Mitte des Sees steht in ${WATER}`).toBe(true);
    });
}

test("🔴 Landschaften, Klima: der See kommt auch hier aus der weichen Quelle", async ({ page }) => {
    await openAtLake(page, "view=landscapes&layer=klima");
    const layers = await page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id));
    expect(layers).toContain("gewaesser-flaeche");
    expect(layers).not.toContain("landscape-fill-see");
});
