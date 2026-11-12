import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Blatt „Flaggen im Sprachschalter“ (Kanal OPS-000014; Thomas 2026-10-15, Betreiber 2026-10-16: Variante b — Flagge
 * zusätzlich zu Kürzel und Name, Englisch halb USA, halb Großbritannien).
 *
 * Prüft zwei Dinge und legt dann das Blatt ab: Jede Sprache in der Liste trägt genau eine Flagge, und die geschlossene
 * Pille zeigt Flagge **und** Kürzel.
 *
 *   npm run review:sprachflaggen
 *
 * Ablage: `review/sprachflaggen/` (nicht versioniert).
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/sprachflaggen");

test("Blatt: die Flaggen im Sprachschalter", async ({ page }) => {
    mkdirSync(OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto("/");
    const pille = page.getByTestId("lang");
    await pille.waitFor();

    // Geschlossen: Flagge und Kürzel nebeneinander.
    await expect(pille.locator("svg.flagge")).toHaveCount(1);
    await expect(pille).toContainText("DE");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await pille.screenshot({ path: resolve(OUTPUT, "pille.png") });

    // Aufgeklappt: je Sprache eine Flagge, daneben der Name in der eigenen Sprache.
    await pille.click();
    const menue = page.getByRole("menu");
    await menue.waitFor();
    const eintraege = menue.getByRole("menuitemradio");
    const anzahl = await eintraege.count();
    expect(anzahl).toBeGreaterThanOrEqual(7);
    expect(await menue.locator("svg.flagge").count()).toBe(anzahl);
    await page.waitForTimeout(300);
    await menue.screenshot({ path: resolve(OUTPUT, "liste.png") });
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png") });
});
