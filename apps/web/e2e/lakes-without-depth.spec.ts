import { expect, test, type Page } from "@playwright/test";
import { AVENTURIA_PATH_CARTOGRAPHY } from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";

/**
 * Seen auf dem Telefon (Betreiber 2026-10-04: „seen auf dem handy (iphone) nicht angezeigt“).
 *
 * MapLibre malt eine Füllung mit konstanter, deckender Farbe im Opaque-Pass mit Tiefenpuffer, vor allen übrigen
 * Flächen. Greift der Tiefentest nicht, liegen die Landschaftsflächen über dem See, und von ihm bleibt nur die Kante;
 * Flüsse, Orte und Namen stehen weiter. Genau so sah es aus. Ob ein echtes iPhone den Tiefentest verfehlt, ist nicht
 * belegt; belegt ist, dass der See davon abhing und dass kein Teil der Karte davon abhängen darf. Die Probe macht den
 * Tiefentest in jedem Browser unwirksam und liest, ob der See trotzdem in der Wasserfarbe auf dem Canvas steht.
 *
 * Läuft in Chromium und, wo installiert (`npx playwright install webkit`), im iPhone-Profil mit WebKit.
 */

/** Im Ochsenwasser, dem größten See Aventuriens (Kartenkoordinaten, Legacy-Bestand). */
const OCHSENWASSER = { x: 597.841, y: 549.016 };
const ZOOM = 5.5;

const WATER = AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"]?.center ?? "";
const WATER_RGB = [1, 3, 5].map((start) => Number.parseInt(WATER.slice(start, start + 2), 16));
/** Die Layer, die einen See zeichnen: die Fläche der Landschaften und das geglättete Wasser der Topographie. */
const LAKE_LAYERS = ["landscape-fill-see", "gewaesser-flaeche"];

interface LakeProbe {
    /** Innenpunkte eines Sees im Bild (der Punkt und seine vier Nachbarn im Abstand von 10 px sind See). */
    inside: number;
    /** Davon in der Wasserfarbe auf dem Canvas. */
    water: number;
}

/** Macht den Tiefentest in jedem WebGL-Kontext der Seite unwirksam: ein Gerät, dessen Tiefenpuffer nicht greift. */
async function withoutDepthTest(page: Page): Promise<void> {
    await page.addInitScript(() => {
        for (const context of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
            const enable = context.prototype.enable;
            context.prototype.enable = function (this: WebGLRenderingContext, capability: number): void {
                if (capability !== this.DEPTH_TEST) {
                    enable.call(this, capability);
                }
            };
        }
    });
}

/** Öffnet die Ansicht über dem See und wartet, bis seine Kacheln gezeichnet sind. */
async function openAtLake(page: Page, view: string): Promise<void> {
    const at = `x=${String(OCHSENWASSER.x)}&y=${String(OCHSENWASSER.y)}&z=${String(ZOOM)}`;
    await page.goto(`/#${at}&series=original&${view}`);
    await page.waitForFunction(
        (layers) => {
            const map = globalThis.avesmapsMap;
            if (!map?.isStyleLoaded() || !map.loaded()) {
                return false;
            }
            const present = layers.filter((id) => map.getLayer(id) !== undefined);
            return map.queryRenderedFeatures({ layers: present }).some((f) => f.properties["region_type"] === "see");
        },
        LAKE_LAYERS,
        { timeout: 30_000 },
    );
    await settleFrame(page);
}

/** Zählt Innenpunkte des Sees im Bild und davon die in der Wasserfarbe, gelesen aus dem Canvas desselben Frames. */
async function probeLake(page: Page): Promise<LakeProbe> {
    return page.evaluate(
        ({ layers, rgb }) =>
            new Promise<LakeProbe>((resolve, reject) => {
                const map = globalThis.avesmapsMap;
                if (!map) {
                    reject(new Error("map handle missing"));
                    return;
                }
                const present = layers.filter((id) => map.getLayer(id) !== undefined);
                const isLake = (x: number, y: number): boolean =>
                    map
                        .queryRenderedFeatures([x, y], { layers: present })
                        .some((feature) => feature.properties["region_type"] === "see");
                const canvas = map.getCanvas();
                const width = canvas.clientWidth;
                const height = canvas.clientHeight;
                const points: [number, number][] = [];
                for (let y = 10; y < height - 10 && points.length < 60; y += 10) {
                    for (let x = 10; x < width - 10 && points.length < 60; x += 10) {
                        if (
                            isLake(x, y) &&
                            isLake(x - 10, y) &&
                            isLake(x + 10, y) &&
                            isLake(x, y - 10) &&
                            isLake(x, y + 10)
                        ) {
                            points.push([x, y]);
                        }
                    }
                }
                map.once("render", () => {
                    // Der Canvas im selben Frame gelesen: danach verwirft WebGL den Puffer.
                    const copy = document.createElement("canvas");
                    copy.width = canvas.width;
                    copy.height = canvas.height;
                    const context = copy.getContext("2d", { willReadFrequently: true });
                    if (!context) {
                        reject(new Error("no 2d context"));
                        return;
                    }
                    context.drawImage(canvas, 0, 0);
                    const scale = canvas.width / width;
                    let water = 0;
                    for (const [x, y] of points) {
                        const pixel = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
                        if ([0, 1, 2].every((channel) => Math.abs((pixel[channel] ?? 0) - (rgb[channel] ?? 0)) <= 12)) {
                            water += 1;
                        }
                    }
                    resolve({ inside: points.length, water });
                });
                map.triggerRepaint();
            }),
        { layers: LAKE_LAYERS, rgb: WATER_RGB },
    );
}

function expectWater(probe: LakeProbe, reason: string): void {
    expect(probe.inside, "Innenpunkte des Sees im Bild").toBeGreaterThanOrEqual(10);
    expect(
        probe.water / probe.inside,
        `${String(probe.water)} von ${String(probe.inside)} Innenpunkten in ${WATER}: ${reason}`,
    ).toBeGreaterThan(0.8);
}

const VIEWS: { name: string; hash: string }[] = [
    { name: "Landschaften, Alle", hash: "view=landscapes&layer=alle" },
    { name: "Landschaften, Vegetation", hash: "view=landscapes&layer=vegetation" },
    { name: "Landschaften, Derographisch", hash: "view=landscapes&layer=derographisch" },
    { name: "Landschaften, Klima", hash: "view=landscapes&layer=klima" },
    { name: "Topographie, Höhenlinien", hash: "view=landscapes&layer=topographie" },
    { name: "Topographie, Höhenstufen", hash: "view=landscapes&layer=topographie&topo=hoehenstufen" },
];

test("Kontrolle: mit Tiefentest steht der See in der Wasserfarbe auf dem Canvas", async ({ page }) => {
    await openAtLake(page, "view=landscapes&layer=alle");
    expectWater(await probeLake(page), "die Messung stimmt nicht");
});

for (const view of VIEWS) {
    test(`🔴 ohne wirksamen Tiefentest steht der See trotzdem da: ${view.name}`, async ({ page }) => {
        await withoutDepthTest(page);
        await openAtLake(page, view.hash);
        expectWater(await probeLake(page), "Flächen decken den See zu");
    });
}
