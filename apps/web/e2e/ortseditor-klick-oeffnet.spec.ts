import { expect, test } from "@playwright/test";
import { settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS_LAGE, fenster, oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * Ein Klick auf einen Ort im Editor-Modus öffnet den Ortseditor an ihm, auch wenn keiner offen ist (WI-0198, EDIT-0003 T34 (1)).
 * Betreiber 2026-10-16: „Bei Orten kommt er schon automatisch“ - wie bei der Landschaft. Dass es während eines Modus nicht geschieht
 * und aus der Suche nicht, prüft `apps/web/test/ortseditor-hinflug.test.ts`.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 T34 (1): kein Ortseditor offen, ein Klick auf Gratenfels öffnet ihn an Gratenfels", async ({ page }) => {
    await oeffneOrtseditor(page, { verb: false });
    await expect(fenster(page)).toHaveCount(0);
    await showPlace(page, GRATENFELS_LAGE, 7);
    await settleFrame(page);
    const box = (await page.getByTestId("map").boundingBox())!;
    const at = await page.evaluate(
        (lage) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(lage)),
        GRATENFELS_LAGE,
    );
    await page.mouse.click(box.x + at.x, box.y + at.y);
    await expect(fenster(page)).toHaveCount(1);
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    await expect(page.getByTestId("editor-panel-tab")).toHaveAttribute("aria-expanded", "true");
});
