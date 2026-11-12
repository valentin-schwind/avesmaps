import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Die Bilder zu „Unterwegs gibt es:“ (WI-0257 S4) für die Sichtprüfung: zu, auf, mit gewähltem Eintrag, in 1920 × 1080 und 1280 × 800, hell und dunkel. Ein Blatt (`*-review.spec.ts`): Es läuft nur, wenn seine Datei im
 * Aufruf genannt ist, und prüft nichts über die Anwendung (das tut `unterwegs-box.spec.ts`). Das Telefonbild kommt aus `unterwegs-box.touch.spec.ts` (nur das Telefonprofil gibt es dort).
 *
 *   npx playwright test e2e/unterwegs-bilder-review.spec.ts --workers=1
 *
 * Die Bilder liegen unter `review/wi-0257-s4/` (nicht im Repository).
 */

const ORDNER = join(import.meta.dirname, "..", "..", "..", "review", "wi-0257-s4");
const REISE = "/?route=@452.84,590.76~@492.50,564.96";

async function bereit(page: Page): Promise<void> {
    await page.goto(REISE);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await expect(page.getByTestId("route-unterwegs")).toBeVisible({ timeout: 60_000 });
    // Ruhe: Karte und Kacheln gesetzt, damit das Bild nicht mitten in der Fahrt entsteht.
    await page.waitForTimeout(1200);
}

for (const groesse of [
    { name: "desk", width: 1920, height: 1080 },
    { name: "mid", width: 1280, height: 800 },
]) {
    for (const thema of ["light", "dark"] as const) {
        test(`Bilder ${groesse.name} ${thema}`, async ({ page }) => {
            test.setTimeout(180_000);
            mkdirSync(ORDNER, { recursive: true });
            await page.emulateMedia({ colorScheme: thema });
            await page.setViewportSize({ width: groesse.width, height: groesse.height });
            await bereit(page);
            const bild = (name: string): string => join(ORDNER, `${name}-${groesse.name}-${thema}.png`);
            const box = page.getByTestId("route-unterwegs");

            // 1. Zu: die Routendetails samt der Box ganz unten.
            await box.scrollIntoViewIfNeeded();
            await page.screenshot({ path: bild("unterwegs-zu") });

            // 2. Auf: die Liste.
            await page.getByTestId("unterwegs-toggle").click();
            await expect(page.getByTestId("unterwegs-eintrag").first()).toBeVisible();
            await page.waitForTimeout(400);
            await box.scrollIntoViewIfNeeded();
            await page.screenshot({ path: bild("unterwegs-auf") });

            // 3. Mit gewähltem Eintrag (der Kreis, WI-0257 S5): das Kästchen und die Liste; danach die Etappenliste mit den gefärbten Etappen.
            await page.getByTestId("unterwegs-kreis").nth(2).click();
            await expect(page.getByTestId("unterwegs-wahl")).toBeVisible();
            await page.waitForTimeout(1500);
            await box.scrollIntoViewIfNeeded();
            await page.screenshot({ path: bild("unterwegs-wahl") });
            await openStageGroups(page);
            await page.getByTestId("route-stages").scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await page.screenshot({ path: bild("unterwegs-etappen") });
        });
    }
}
