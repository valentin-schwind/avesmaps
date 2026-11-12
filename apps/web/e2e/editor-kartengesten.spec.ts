import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, GARETH, openMap, readCamera, showCamera } from "./map-handle.ts";
import { ORTSEDITOR_RECHTE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Kartengesten im Editormodus (Thomas, Mitbetreiber, 2026-10-19 über die Editor-Orchestrierung):
 *
 * - Ein Doppelklick zoomt die Karte im Editormodus nie; dort schließt er Flächen und löst Handgriffe aus. Auf der öffentlichen Karte
 *   zoomt er weiter (Gegenprobe).
 * - Strg + Ziehen dreht weiter, solange kein Modus läuft; im Modus gehört Strg ihm (`ortseditor-verschieben.spec.ts`, `neue-flaeche.spec.ts`,
 *   `wegeditor-wegkurve.spec.ts`).
 */

/** Ein Fleck der Karte rechts unten im freien Teil, weit weg von der Mitte. */
async function fleck(page: Page): Promise<{ x: number; y: number }> {
    const box = (await page.getByTestId("map").boundingBox())!;
    return { x: box.x + box.width * 0.62, y: box.y + box.height * 0.7 };
}

async function oeffne(page: Page, editor: boolean): Promise<void> {
    if (editor) await stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });
    await openMap(page, editor ? EDITOR_MODE : "/");
    await showCamera(page, { point: GARETH, zoom: 5.5 });
}

test("🔴 im Editormodus zoomt ein Doppelklick in die Karte nicht", async ({ page }) => {
    await oeffne(page, true);
    const stelle = await fleck(page);
    const vorher = (await readCamera(page)).zoom;
    await page.mouse.dblclick(stelle.x, stelle.y);
    // Was der Doppelklick sonst tut (Handgriff, Fertig), braucht keinen Zoom; ein Zoom dauerte rund 300 ms.
    await page.waitForTimeout(600);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    expect((await readCamera(page)).zoom).toBeCloseTo(vorher, 3);
});

test("Gegenprobe: auf der öffentlichen Karte zoomt der Doppelklick weiter", async ({ page }) => {
    await oeffne(page, false);
    const stelle = await fleck(page);
    const vorher = (await readCamera(page)).zoom;
    await page.mouse.dblclick(stelle.x, stelle.y);
    await expect.poll(async () => (await readCamera(page)).zoom).toBeGreaterThan(vorher + 0.5);
});

test("🔴 im Editormodus dreht Strg + Ziehen auf freier Karte weiter", async ({ page }) => {
    await oeffne(page, true);
    const start = await fleck(page);
    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    expect((await readCamera(page)).bearing).toBeCloseTo(80, 0);
});
