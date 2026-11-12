import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Der Interaktionsvertrag der Karte am echten Stack (M8, Hardening Review 2026-09-28): Der Koordinator fragt
 * die Karte je Ereignis einmal. Vorher kostete ein Klick mindestens fünf `queryRenderedFeatures` (Ort, Route und
 * Fläche fragten je selbst), und jede neue Ausnahme in `app.vue` hätte den Vorrang still verschoben.
 *
 * 🪤 Der Zähler hängt an der öffentlichen Methode der Karte. Ein neuer Zuhörer, der wieder selbst fragt
 * (etwa `map.on("click", layers, …)`, das MapLibre über dieselbe Methode beantwortet), macht diesen Test rot -
 * genau das ist gewollt.
 */

interface CountingMap {
    queryRenderedFeatures: (...args: unknown[]) => unknown;
}

async function countQueries(page: Page): Promise<void> {
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as CountingMap;
        const counted = globalThis as unknown as { __queries?: number };
        counted.__queries = 0;
        const original = map.queryRenderedFeatures.bind(map);
        map.queryRenderedFeatures = (...args: unknown[]) => {
            counted.__queries = (counted.__queries ?? 0) + 1;
            return original(...args);
        };
    });
}

const queries = (page: Page): Promise<number> =>
    page.evaluate(() => (globalThis as unknown as { __queries?: number }).__queries ?? 0);

/** Eine freie Stelle der sichtbaren Karte in Seitenpixeln: Am Rechner steht links der Planer. */
async function freeSpot(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const centre = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        return globalThis.avesmapsVisibleArea!.centre();
    });
    return { x: (box?.x ?? 0) + centre.x + 200, y: (box?.y ?? 0) + centre.y + 150 };
}

test("🔴 jedes Ereignis eines Klicks kostet höchstens zwei Abfragen: der Druck eine, der Klick eine je Punkt und eine für die dünnen Flüsse", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await freeSpot(page);
    // Erst hinfahren und das Zeigen ausrechnen lassen: Es soll nicht in die Zählung des Klicks fallen.
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(300);
    await countQueries(page);
    await page.mouse.down();
    const press = await queries(page);
    await page.mouse.up();
    const click = (await queries(page)) - press;
    expect(press, "der Druck fragt einmal, für die Marken der Route").toBeLessThanOrEqual(1);
    expect(click, "der Klick fragt den Punkt und die Flüsse").toBeGreaterThan(0);
    expect(click).toBeLessThanOrEqual(2);
});

test("🔴 eine Mausbewegung kostet höchstens zwei Abfragen, ein Bild des Zeigens", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await countQueries(page);
    const at = await freeSpot(page);
    await page.mouse.move(at.x, at.y);
    // Das Zeigen rechnet im nächsten Bild; danach ist Ruhe.
    await page.waitForTimeout(300);
    const cost = await queries(page);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(2);
});
