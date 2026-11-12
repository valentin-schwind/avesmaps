import { expect, test, type Page } from "@playwright/test";
import {
    chooseSeries,
    GARETH,
    offeredSeries,
    onPage,
    openMap,
    readCamera,
    selectedPlace,
    showCamera,
    showLandscapes,
} from "./map-handle.ts";

/**
 * Drehung und Neigung gehören der Kamera allein (WI-0016, AC10): Suche, Ortsauswahl und der Wechsel
 * von Ansicht oder Untergrund lassen sie stehen. Wer die Karte schräg gestellt hat, will sie nach
 * einer Suche nicht wieder gerade vorfinden.
 */

const TILTED = { bearing: 30, pitch: 40 };

async function expectTilted(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const camera = await readCamera(page);
    expect(camera.bearing).toBeCloseTo(TILTED.bearing, 1);
    expect(camera.pitch).toBeCloseTo(TILTED.pitch, 1);
}

test.beforeEach(async ({ page }) => {
    await openMap(page);
    await showCamera(page, { point: GARETH, zoom: 5.5, ...TILTED });
});

test("🔴 die Suche fährt hin, ohne die Karte gerade zu stellen", async ({ page }) => {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Havena");
    await expect(page.getByTestId("search-hit").first()).toContainText("Havena");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();
    await expectTilted(page);
    // Gefahren ist sie trotzdem - sonst prüfte der Test nur eine Suche, die nichts tut.
    const centre = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) {
            throw new Error("map handle missing");
        }
        return projection.fromRenderLngLat(map.getCenter());
    });
    expect(Math.hypot(centre.x - GARETH.x, centre.y - GARETH.y)).toBeGreaterThan(50);
});

test("ein Ort lässt sich auswählen, ohne dass die Kamera sich rührt", async ({ page }) => {
    const gareth = await page.evaluate((point) => {
        const map = globalThis.avesmapsMap as unknown as {
            project(lngLat: { lng: number; lat: number }): { x: number; y: number };
        };
        const projection = globalThis.avesmapsRenderProjection;
        if (!projection) {
            throw new Error("projection handle missing");
        }
        return map.project(projection.toRenderLngLat(point));
    }, GARETH);
    const auf = await onPage(page, gareth);
    await page.mouse.click(auf.x, auf.y);
    await expect.poll(async () => (await selectedPlace(page))?.name).toBe("Gareth");
    await expectTilted(page);
});

test("Ansicht und Untergrund wechseln, die Kamera bleibt schräg", async ({ page }) => {
    await showLandscapes(page, "alle");
    await expectTilted(page);

    const [, other] = await offeredSeries(page);
    if (other === undefined) {
        throw new Error("nur eine Kartenserie - der Wechsel lässt sich hier nicht prüfen");
    }
    await chooseSeries(page, other);
    await expectTilted(page);
});
