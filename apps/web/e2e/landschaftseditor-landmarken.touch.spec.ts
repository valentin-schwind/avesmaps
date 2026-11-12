import { expect, test } from "@playwright/test";
import { landmarkenStub, oeffneLandmarkenListe } from "./landmarken-stub.ts";
import { settleFrame } from "./map-handle.ts";

/**
 * Landmarken am Telefon (WI-0271 L4): die Liste, ein Tippen auf die Höhle zeigt ihre Eigenschaften mit Art, Merkmalen und ohne Kasten „Gelände“.
 * Das Bild `test-results/l4-hoehle-telefon.png` ist die Sichtprüfung am Telefon. Stub wie `landschaftseditor-landmarken.spec.ts`.
 */

test("L4 am Telefon: die Höhle mit Art und Merkmalen, ohne Kasten „Gelände“", async ({ page }) => {
    await landmarkenStub(page);
    const liste = await oeffneLandmarkenListe(page);
    await liste.getByRole("option", { name: /Probehöhle/ }).click();
    await expect(page.locator('[data-testid$="-gipfel-merkmale"]')).toBeInViewport();
    await expect(page.locator('[data-testid$="-gipfel-art"] select')).toHaveValue("hoehle");
    await expect(page.locator('[data-testid$="-gipfel-gelaende"]')).toHaveCount(0);
    await settleFrame(page);
    await page.screenshot({ path: "test-results/l4-hoehle-telefon.png" });
});
