import { expect, test } from "@playwright/test";

/**
 * Der Schalter „Höhenlinien“ im Anzeigemenü am Telefon (Betreiber 2026-10-20: „kannst du die anzeige der höhenlinien in das anzeigemenü
 * tun … - und nur wenn topographie an ist.“): Bis dahin sah das Telefon die Linien immer. Jetzt steht die Zeile auch dort, nur bei der
 * Topographie, und nimmt Linien und Zahlen weg (`landschaftseditor/hoehenlinien-schalter.ts`).
 *
 * 🪤 Linien brauchen abgeleitete Anzeigehöhen (`derive:display-heights`); ohne sie überspringt der Test sichtbar.
 */
const STELLE = { x: 450, y: 560 };
const lage = `x=${String(STELLE.x)}&y=${String(STELLE.y)}&z=6.5&series=original`;
const linien = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as { getStyle(): { layers: { id: string }[] } })
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("hoehenlinie")),
    );

test("🔴 Telefon: „Höhenlinien“ steht im Anzeigemenü nur bei der Topographie und nimmt die Linien weg", async ({
    page,
}) => {
    await page.goto(`/#${lage}&view=landscapes&layer=topographie`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    test.skip(
        (await page.evaluate(async () => (await fetch("/tiles/terrain/display-height/current.json")).status)) !== 200,
        "keine Anzeigehöhen abgeleitet (derive:display-heights)",
    );
    await page.getByTestId("display-open").tap();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    const zeile = page.getByTestId("display-hoehenlinien");
    await expect(zeile).toBeVisible();
    await expect(zeile.locator("input")).toBeChecked();
    await expect.poll(() => linien(page)).not.toEqual([]);
    await zeile.tap();
    await expect(zeile.locator("input")).not.toBeChecked();
    await expect.poll(() => linien(page)).toEqual([]);
    await page.screenshot({ path: "test-results/hoehenlinien-auge-telefon.png" });

    await page.goto(`/?r=2#${lage}&view=landscapes&layer=vegetation`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("display-open").tap();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    await expect(page.getByTestId("display-hoehenlinien")).toHaveCount(0);
});
