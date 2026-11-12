import { expect, test } from "@playwright/test";
import { openMap, readCamera } from "./map-handle.ts";

/**
 * Wo die Kamera am Finger steht (WI-0027, Telefonprofil): 3D-Knopf und Kompass bleiben unten beim
 * Daumen, oben im unteren Bund - über dem Auge (WI-0028) und der Suchlupe (Betreiber 2026-09-23:
 * „3d knopf am handy in daumennähe lassen“).
 */

test("🔴 am Finger bleibt der 3D-Knopf unten im Bund, direkt über dem Auge", async ({ page }) => {
    await openMap(page);
    const lage = await page.evaluate(() => {
        const rechteck = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { lasche: rechteck("camera-tilt"), auge: rechteck("display-open"), suche: rechteck("search-open") };
    });
    expect(lage.lasche.bottom).toBeLessThanOrEqual(lage.auge.top);
    expect(lage.auge.top - lage.lasche.bottom, "im selben Bund, nicht oben").toBeLessThan(20);
    expect(lage.auge.bottom).toBeLessThanOrEqual(lage.suche.top);
    await expect(page.locator(".corner--top")).toHaveCount(0);
});

test("💣 auch am Finger macht der 3D-Knopf keine Scrollbalken", async ({ page }) => {
    // Auf Zoom 5 wie vor WI-0166: Auf der Startansicht (Zoom 2,5) erlaubt die Kamera höchstens 30° (`maxPitchForZoom`).
    await openMap(page, "/#x=551.625&y=532.969&z=5.00&series=modern");
    await page.getByTestId("camera-tilt").tap();
    await expect.poll(async () => (await readCamera(page)).pitch).toBeGreaterThan(30);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    const seite = await page.evaluate(() => {
        const element = document.documentElement;
        return { quer: element.scrollWidth > element.clientWidth, hoch: element.scrollHeight > element.clientHeight };
    });
    expect(seite).toEqual({ quer: false, hoch: false });
});
