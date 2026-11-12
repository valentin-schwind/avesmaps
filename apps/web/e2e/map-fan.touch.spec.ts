import { expect, test } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Der Kartenfächer am Finger (WI-0036), im Telefonprofil.
 *
 * Wie am Rechner, nur ohne Überfahren: ein Tipp auf die Kachel öffnet die Reihe, ein Tipp auf eine
 * Ansicht wählt sie sofort. Das Eselsohr steht am Finger immer da; ein Tipp darauf öffnet die
 * Unterreihe.
 */

test("🔴 am Finger: Tipp auf die Ansicht wählt sofort, Tipp aufs Eselsohr öffnet die Unterreihe", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").tap();
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    // Die Kachel bleibt dabei stehen.
    await expect(page.getByTestId("fan-toggle")).toBeVisible();

    await page.getByTestId("fan-ohr-landscapes").tap();
    await expect(page.getByTestId("fan-layer-alle")).toBeVisible();
    await expect(page.getByTestId("fan-toggle")).toContainText("Standard");
    await page.getByTestId("fan-layer-vegetation").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toContainText("Derographie");
    await expect(page.getByTestId("fan-toggle")).toContainText("Vegetation");

    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-view-standard").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toContainText("Standard");
});

test("💣 ein Tipp auf die Kachelmitte öffnet die Reihe, nicht die Unterreihe des Ohrs daneben", async ({ page }) => {
    // REGRESSION (2026-09-25): Chrome lässt einen Tipp auf ein Element einrasten, dessen Aussehen auf
    // `:hover` reagiert - das Ohr fing so Tipps auf die Kachelmitte ab, 9 px daneben.
    await openMap(page);
    await page.getByTestId("fan-toggle").tap();
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    await expect(page.getByTestId("fan-stufe")).toBeHidden();
});

test("🔴 am Telefon stehen Kachel und Reihe nebeneinander in der Breite (Betreiber 2026-09-25: „wie am Rechner, schmaler“)", async ({
    page,
}) => {
    for (const breite of [412, 390, 360]) {
        await page.setViewportSize({ width: breite, height: 800 });
        await openMap(page);
        await page.getByTestId("fan-toggle").tap();
        const menu = page.getByTestId("fan-menu");
        await expect(menu).toBeVisible();
        const reihe = await menu.boundingBox();
        const kachel = await page.getByTestId("fan-toggle").boundingBox();
        if (!reihe || !kachel) {
            throw new Error(`${breite} px: Reihe oder Kachel fehlt`);
        }
        expect(
            await menu.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
            `${breite} px`,
        ).toBe(5);
        expect(reihe.x, `${breite} px: links im Bild`).toBeGreaterThanOrEqual(0);
        expect(reihe.x + reihe.width, `${breite} px: links der Kachel`).toBeLessThanOrEqual(kachel.x);
        expect(kachel.x + kachel.width, `${breite} px: rechts im Bild`).toBeLessThanOrEqual(breite);

        // Auch die längste Unterreihe (fünf Ebenen) bleibt im Bild.
        await page.getByTestId("fan-ohr-landscapes").tap();
        const stufe = await page.getByTestId("fan-stufe").boundingBox();
        if (!stufe) {
            throw new Error(`${breite} px: Unterreihe fehlt`);
        }
        expect(stufe.x, `${breite} px: Unterreihe links im Bild`).toBeGreaterThanOrEqual(0);
        expect(stufe.x + stufe.width, `${breite} px: Unterreihe rechts im Bild`).toBeLessThanOrEqual(breite);
    }
});
