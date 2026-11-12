import { expect, test } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Vorgabe der Klimazonen am Telefon (Betreiber 2026-10-05): der Fächer mit dem Finger, dann das Auge-Menü. Am
 * Rechner und über Links prüft es `climate-display-defaults.spec.ts`.
 */

test("🔴 am Telefon: Klimazonen im Fächer antippen, das Menü zeigt ihre Vorgabe", async ({ page }) => {
    // Ein angemeldeter Editor: Die Zeilen der Editoren kommen aus der Sitzung, nicht aus `/edit` allein (WI-0120 A9, WI-0192).
    await stubAdmin(page, {
        capabilities: ["view_flow_directions", "use_editor_menu", "view_editor_series"],
        role: "editor",
    });
    await openMap(page, EDITOR_MODE);
    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-ohr-landscapes").tap();
    await page.getByTestId("fan-layer-klima").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect
        .poll(async () => new URLSearchParams(await page.evaluate(() => location.hash)).get("layer"))
        .toBe("klima");

    await page.getByTestId("display-open").tap();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    const pressed = page.locator('[data-testid^="display-place-"][aria-pressed="true"]');
    await expect(pressed).toHaveCount(1);
    await expect(pressed).toHaveAttribute("data-testid", "display-place-metropole");
    for (const row of ["display-paths", "display-layers", "display-labels", "display-rivers", "display-flow"]) {
        await expect(page.getByTestId(row).locator("input"), row).toBeChecked();
    }
    for (const row of ["display-borders", "display-tile-grid"]) {
        await expect(page.getByTestId(row).locator("input"), row).not.toBeChecked();
    }
});
