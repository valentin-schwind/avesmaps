import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { LISTE, ORTSEDITOR_RECHTE, fenster } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * ✕ an der Liste am Telefon (WI-0241; Betreiber 2026-10-20: „bei mobilgeräten wär das wichtig, dass dann hier "Eigenschaften" zu sehen
 * ist“). Liste und Eigenschaften stehen dort nie nebeneinander (Drill-down): Das ✕ führt auf die Seite „Eigenschaften“, „‹ Liste“ zurück.
 * Ein Doppelpfeil kommt dabei nicht hinzu (`ortseditor-liste-einklappen.touch.spec.ts`).
 */

/** Der Ortseditor am Telefon, wie in `ortseditor-liste-einklappen.touch.spec.ts`: Lasche, dann Verb. */
async function oeffneAmTelefon(page: Page): Promise<void> {
    await stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });
    await page.route("**/api/editor/places", (route) => route.fulfill({ json: LISTE }));
    await openMap(page, `${EDITOR_MODE}?tab=karteninhalte`);
    await page.getByTestId("editor-panel-tab").tap();
    await page.getByTestId("editorpanel-verb").tap();
    await expect(fenster(page)).toHaveCount(1);
}

test("🔴 am Telefon führt ✕ an der Liste auf „Eigenschaften“, „‹ Liste“ zurück", async ({ page }) => {
    await oeffneAmTelefon(page);
    const liste = fenster(page).locator('[id$="-listenspalte"]');
    const eigenschaften = fenster(page).locator('[data-testid$="-eigenschaften-spalte"]');
    await expect(liste).toBeVisible();
    await expect(eigenschaften).toHaveCount(0);
    await page.screenshot({ path: "test-results/wi0241-liste-schliessen-telefon-liste.png" });

    await fenster(page).locator('[data-testid$="-liste-schliessen"]').tap();
    await expect(eigenschaften).toBeVisible();
    await expect(liste).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-listenschalter"]')).toHaveCount(0);
    await page.screenshot({ path: "test-results/wi0241-liste-schliessen-telefon-eigenschaften.png" });

    await fenster(page).getByText("‹ Liste").tap();
    await expect(liste).toBeVisible();
});
