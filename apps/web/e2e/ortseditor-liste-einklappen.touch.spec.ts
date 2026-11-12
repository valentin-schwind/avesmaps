import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { LISTE, ORTSEDITOR_RECHTE, fenster, zeile } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die einklappbare Ortsliste am Telefon (WI-0128 P1, Betreiber 2026-10-13): 🔴 Dort stehen Liste und Eigenschaften NIE
 * nebeneinander - der Drill-down mit „‹ Liste“ bleibt, und einen zusätzlichen Doppelpfeil gibt es nicht.
 */

/**
 * Der Ortseditor am Telefon, geöffnet wie in `editor-panel.touch.spec.ts`: Lasche, dann Verb. 🪤 `oeffneOrtseditor` taugt hier nicht:
 * Ohne `?tab=` fand er am Telefon weder die Lasche noch ein sichtbares Verb, und beide Fälle liefen in die Zeitgrenze (gefunden mit
 * WI-0183; die Ursache im Einstieg ist an die Orchestrierung gemeldet).
 */
async function oeffneAmTelefon(page: Page): Promise<void> {
    await stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });
    await page.route("**/api/editor/places", (route) => route.fulfill({ json: LISTE }));
    await openMap(page, `${EDITOR_MODE}?tab=karteninhalte`);
    await page.getByTestId("editor-panel-tab").tap();
    await page.getByTestId("editorpanel-verb").tap();
    await expect(fenster(page)).toHaveCount(1);
}

test("🔴 am Telefon kein Doppelpfeil: der Drill-down „‹ Liste“ bleibt der einzige Weg zurück", async ({ page }) => {
    await oeffneAmTelefon(page);
    await expect(fenster(page).locator('[data-testid$="-listenschalter"]')).toHaveCount(0);

    await zeile(page, "Gratenfels").tap();
    await expect(fenster(page).locator('[data-testid$="-eigenschaften-spalte"]')).toBeVisible();
    await expect(fenster(page).locator('[data-testid$="-listenschalter"]')).toHaveCount(0);
    await fenster(page).getByText("‹ Liste").tap();
    await expect(zeile(page, "Gratenfels")).toBeVisible();
});

test("🔴 am Telefon stehen ✚ und Papierkorb ebenso in der Leiste der Liste (WI-0183); ein Menüband gibt es nicht", async ({
    page,
}) => {
    await oeffneAmTelefon(page);
    await expect(fenster(page).locator(".avm-fenster__leiste")).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-leiste-neu"]')).toBeVisible();
    await expect(fenster(page).locator('[data-testid$="-leiste-entfernen"]')).toBeVisible();
});
