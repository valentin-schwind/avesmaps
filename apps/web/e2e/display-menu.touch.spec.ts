import { expect, test } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Das Auge-Menü am Finger (WI-0028), im Telefonprofil: so breit wie der Schirm, der Kartenrand
 * bleibt beidseitig stehen (Owner Legacy 12.08.2026: „das klappmenü kann auf mobil geräten die
 * breite vom bildschirm annehmen").
 */

test("🔴 am Telefon nimmt das Menü die Breite des Schirms, mit Kartenrand auf beiden Seiten", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("display-open").tap();
    const menue = page.getByTestId("display-menu");
    await expect(menue).toBeVisible();
    const lage = await menue.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { links: box.left, rechts: box.right, breite: document.documentElement.clientWidth };
    });
    expect(lage.links).toBeCloseTo(lage.breite - lage.rechts, 0);
    expect(lage.links).toBeGreaterThan(0);
});

test("🔴 am Finger geht das Menü unmittelbar über dem Auge auf, nicht über dem 3D-Knopf (Betreiber 2026-09-23)", async ({
    page,
}) => {
    await openMap(page);
    await page.getByTestId("display-open").tap();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    const lage = await page.evaluate(() => {
        const rechteck = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        const lasche = rechteck("camera-tilt");
        const oben = document.elementFromPoint(lasche.left + lasche.width / 2, lasche.top + lasche.height / 2);
        return {
            menue: rechteck("display-menu"),
            auge: rechteck("display-open"),
            laschenMitteImMenue: oben?.closest('[data-testid="display-menu"]') !== null,
        };
    });
    expect(lage.auge.top - lage.menue.bottom, "unmittelbar über dem Auge").toBeLessThan(10);
    expect(lage.menue.bottom).toBeLessThanOrEqual(lage.auge.top);
    expect(lage.laschenMitteImMenue, "der 3D-Knopf liegt solange unter dem Menü").toBe(true);
});

test("ein Tipp auf eine Ortsklasse schaltet wie am Rechner", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("display-open").tap();
    await page.getByTestId("display-place-stadt").tap();
    await expect(page.getByTestId("display-place-stadt")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("display-place-kleinstadt")).toHaveAttribute("aria-pressed", "false");
});
