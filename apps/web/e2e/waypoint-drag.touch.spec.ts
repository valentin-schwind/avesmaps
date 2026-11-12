import { expect, test, type Page } from "@playwright/test";
import { GARETH, showPlace } from "./map-handle.ts";

/**
 * Wegpunktmarke ziehen gegen langen Druck (M8, Interaktionsvertrag der Karte): Die Marke und das Kontextmenü
 * hören beide auf denselben Finger. Wer eine Marke packt, zieht sie; der lange Druck (550 ms) ist dann keiner
 * mehr - sonst ginge das Menü mitten im Ziehen auf. 🔴 Seit WI-0108 wögen das schwerer: Der lange Druck ist
 * der Rechtsklick und öffnet das Menü, es gäbe also wirklich etwas zu sehen.
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; Halten und Ziehen kommen über CDP als echte Touch-Ereignisse.
 */

const MENU = "map-context-menu";

/** Gareth im Bild, in Seitenpixeln. */
async function garethOnScreen(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (point) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(point)),
        GARETH,
    );
    return { x: Math.round((box?.x ?? 0) + at.x), y: Math.round((box?.y ?? 0) + at.y) };
}

async function pointInAddress(page: Page): Promise<{ x: number; y: number } | null> {
    const search = await page.evaluate(() => decodeURIComponent(globalThis.location.search));
    const match = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(search);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

async function openRoute(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showPlace(page, GARETH, 8);
    // Die Startmarke ist da, sobald der Planer die Reise geladen hat.
    await page.waitForFunction(
        () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["route-markers"] }).length ?? 0) > 0,
        undefined,
        { timeout: 20_000 },
    );
}

test("🔴 Ein Finger auf der Wegpunktmarke, still gehalten und dann gezogen: die Marke zieht, das Kontextmenü bleibt zu", async ({
    page,
}) => {
    await openRoute(page);
    // Der Hinweis beim ersten Besuch steht unten über der Karte und kann die Marke decken: weg damit, wie es ein Mensch beim
    // ersten Besuch tut.
    const hinweis = page.getByTestId("camera-hint");
    if ((await hinweis.count()) > 0) await hinweis.getByRole("button").click();
    const client = await page.context().newCDPSession(page);
    const start = await garethOnScreen(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }): Promise<unknown> =>
        client.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: at ? [{ x: at.x, y: at.y, id: 0 }] : [],
        });

    await touch("touchStart", start);
    // Länger als der lange Druck (550 ms): Vorher ging hier das Kontextmenü auf, während die Marke am Finger hing.
    await page.waitForTimeout(800);
    await expect(page.getByTestId(MENU)).toHaveCount(0);

    // Dann wird gezogen: 40 px nach rechts unten, in Schritten.
    for (let step = 1; step <= 8; step += 1) {
        await touch("touchMove", { x: start.x + step * 5, y: start.y + step * 5 });
    }
    await expect(page.getByTestId(MENU)).toHaveCount(0);
    await touch("touchEnd");

    // Losgelassen wurde die Marke: Der Start ist jetzt ein Kartenpunkt, kein Gareth mehr.
    await expect.poll(() => pointInAddress(page), { timeout: 15_000 }).not.toBeNull();
    await expect(page.getByTestId(MENU)).toHaveCount(0);
});

test("🔴 Der lange Druck ins Freie öffnet das Kontextmenü, und „Was ist hier?“ steht darin (WI-0108)", async ({
    page,
}) => {
    await openRoute(page);
    const client = await page.context().newCDPSession(page);
    const start = await garethOnScreen(page);
    // Weit weg von der Marke, ins Freie - über ihr, denn unten steht der Hinweis „Mit zwei Fingern drehen“.
    const free = { x: start.x, y: Math.max(start.y - 200, 220) };
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...free, id: 0 }] });
    await page.waitForTimeout(800);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // 🔴 Der lange Druck IST der Rechtsklick (Betreiber 2026-10-08): dasselbe Menü, und „Was ist hier?“ als Eintrag.
    await expect(page.getByTestId(MENU)).toBeVisible();
    await page.getByTestId("context-what-is-here").tap();
    await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?");
    await expect(page.getByTestId(MENU)).toHaveCount(0);
});
