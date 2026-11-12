import { expect, test } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die dritte Reihe der Topographie am Finger (WI-0055): Das Eselsohr steht immer da, ein Tipp darauf
 * öffnet die Reihe, ein Tipp auf „Höhenlinien“ wählt sofort.
 */

test("🔴 am Finger: Tipp aufs Ohr der Topographie öffnet die dritte Reihe, Tipp wählt", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-ohr-landscapes").tap();
    await expect(page.getByTestId("fan-layer-topographie")).toBeVisible();
    await page.getByTestId("fan-ohr-topographie").tap();
    await expect(page.getByTestId("fan-topography-hoehenlinien")).toBeVisible();
    await page.getByTestId("fan-topography-hoehenlinien").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toContainText("Derographie");
    await expect(page.getByTestId("fan-toggle")).toContainText("Höhenlinien");
});

test("🔴 am Telefon keine Legende der Höhenstufen: die Zahlen stehen an den Linien (Betreiber 2026-09-28)", async ({
    page,
}) => {
    await page.goto("/#x=575&y=528&z=5.8&series=original&view=landscapes&layer=topographie&topo=hoehenstufen");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("fan-toggle")).toContainText("Höhenstufen");
    await expect(page.getByTestId("height-legend")).toHaveCount(0);
});
