import { expect, test, type Page } from "@playwright/test";
import { freeSpot, GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Der Zeiger am Druckpunkt, am Rechner (WI-0108 Nachtrag; Betreiber 2026-10-11: „ja in legacy gibt es auch beim rechtsklick auf
 * die karte einen kleinen marker, der andeutet wo man auf die karte geklickt/getappt hat - du kannst auch einen kleinen zeiger |\
 * bauen und das menü mit einem kleinen offset daneben aufgehen lassen“). Der Finger steht in `kartenmenue.touch.spec.ts`.
 *
 * Problemfälle: die Ecke des Menüs liegt am Punkt (kein Versatz); das Fadenkreuz sitzt neben dem Punkt statt mit der Mitte darauf;
 * am Rand wandert es mit dem umgeklappten Menü weg; es bleibt stehen, wenn das Menü zugeht. Seit dem ersten Blatt ein Fadenkreuz
 * statt des Pfeils (Betreiber 2026-10-11: „ok pfeil sieht komisch aus, kannst du anstatt des pfeils ein gefülltes crosshair mit
 * rotem punkt in der mitte probieren?“).
 */

/** Wo die Mitte des Fadenkreuzes auf dem Bildschirm sitzt: der Punkt (0, 0) seiner Form. */
async function tipOf(page: Page): Promise<{ x: number; y: number }> {
    return page.getByTestId("map-context-pointer").evaluate((svg) => {
        const path = svg.querySelector(".context-zeiger__punkt") as SVGGraphicsElement;
        const tip = new DOMPoint(0, 0).matrixTransform(path.getScreenCTM()!);
        return { x: Math.round(tip.x), y: Math.round(tip.y) };
    });
}

test("🔴 Rechtsklick: die Mitte des Fadenkreuzes liegt am Klickpunkt, das Menü 12 px rechts und 10 px darunter", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 420, y: 300 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });

    await expect(page.getByTestId("map-context-pointer")).toBeVisible();
    expect(await tipOf(page)).toEqual({ x: spot.x, y: spot.y });
    const box = (await page.getByTestId("map-context-menu").boundingBox())!;
    expect(box.x).toBeCloseTo(spot.x + 12, 0);
    expect(box.y).toBeCloseTo(spot.y + 10, 0);

    // Der Zeiger nimmt keinen Klick: ein Klick auf ihn erreicht die Karte und schließt das Menü samt Zeiger.
    await page.mouse.click(spot.x + 2, spot.y + 6);
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(page.getByTestId("map-context-pointer")).toHaveCount(0);
});

test("🔴 am rechten unteren Rand klappt das Menü nach links oben um, das Fadenkreuz bleibt am Punkt", async ({
    page,
}) => {
    // Ein niedriges Fenster: unten reicht der Platz schon ab y 432 nicht mehr (14 + 246 + 8 px), und `freeSpot` sucht nur oberhalb
    // der untersten 200 px.
    await page.setViewportSize({ width: 1280, height: 700 });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 1065, y: 445 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });

    const box = (await page.getByTestId("map-context-menu").boundingBox())!;
    expect(box.x + box.width).toBeCloseTo(spot.x - 12, 0);
    expect(box.y + box.height).toBeCloseTo(spot.y - 10, 0);
    expect(await tipOf(page)).toEqual({ x: spot.x, y: spot.y });
    // Das Fadenkreuz klappt nicht mit: Es steht rund um den Punkt, und das Menü überdeckt es nicht.
    const pointer = (await page.getByTestId("map-context-pointer").boundingBox())!;
    expect(pointer.x + pointer.width / 2).toBeCloseTo(spot.x, 0);
    expect(pointer.y + pointer.height / 2).toBeCloseTo(spot.y, 0);
    // Das Menü überdeckt keinen Strich: Der waagrechte endet samt Saum 14,25 px links vom Punkt, das Menü 12 px davor.
    expect(box.y + box.height).toBeLessThanOrEqual(spot.y - 10 + 1);
});
