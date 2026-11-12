import { expect, test, type Page } from "@playwright/test";
import { openMap, readCamera } from "./map-handle.ts";

/**
 * Wo der Steuerring steht und was der 2D/3D-Knopf mit der Seite macht (WI-0027, am Rechner). Das
 * Telefon prüft `camera-place.touch.spec.ts`.
 */

async function scrollbars(page: Page): Promise<{ quer: boolean; hoch: boolean }> {
    return page.evaluate(() => {
        const seite = document.documentElement;
        return { quer: seite.scrollWidth > seite.clientWidth, hoch: seite.scrollHeight > seite.clientHeight };
    });
}

test("🔴 der Steuerring steht oben rechts, die Pille im Abstand des Bundes zum Bildrand", async ({ page }) => {
    await openMap(page);
    const lage = await page.evaluate(() => {
        const rechteck = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        const bund = document.querySelector(".corner:not(.corner--top)")!;
        return {
            lasche: rechteck("camera-view"),
            suche: rechteck("search-open"),
            breite: document.documentElement.clientWidth,
            abstand: parseFloat(getComputedStyle(bund).right),
            // Der obere Bildrand ist der Rand der Anwendung, nicht der Seite: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
            appOben: document.querySelector(".app")!.getBoundingClientRect().top,
        };
    });
    expect(lage.lasche.top - lage.appOben, "oben").toBeCloseTo(lage.abstand, 0);
    expect(lage.breite - lage.lasche.right, "rechts").toBeCloseTo(lage.abstand, 0);
    expect(lage.lasche.bottom, "nicht mehr im unteren Bund").toBeLessThan(lage.suche.top);
});

test("💣 der 2D/3D-Knopf macht keine Scrollbalken, geneigt nicht und wieder flach nicht (Befund 2026-09-23)", async ({
    page,
}) => {
    // Auf Zoom 5 wie vor WI-0166: Die Startansicht steht seitdem auf Zoom 2,5, und dort erlaubt die Kamera höchstens 30° (`maxPitchForZoom`),
    // der Knopf kippt also nur bis an diese Grenze. Geprüft wird die Seite bei spürbarer Neigung, nicht die Grenze.
    await openMap(page, "/#x=551.625&y=532.969&z=5.00&series=modern");
    await page.getByTestId("camera-view-3d").click();
    await expect.poll(async () => (await readCamera(page)).pitch).toBeGreaterThan(30);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    expect(await scrollbars(page), "geneigt").toEqual({ quer: false, hoch: false });

    await page.getByTestId("camera-view-2d").click();
    await expect.poll(async () => (await readCamera(page)).pitch).toBeLessThan(1);
    expect(await scrollbars(page), "wieder flach").toEqual({ quer: false, hoch: false });
});
