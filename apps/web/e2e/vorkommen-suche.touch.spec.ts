import { expect, test, type Page } from "@playwright/test";
import { ergaenzeEintrag } from "./eintrag-stub.ts";

/**
 * Vorkommen in der Spotlight-Suche am Telefon (WI-0257, S3b): Die Liste steht über dem Feld unten, ein gewähltes Vorkommen lässt die Karte leuchten, und sein Panel bleibt eingeklappt hinter der Karte,
 * bis die Pille „Eintrag öffnen“ es holt - am Telefon deckte es sonst die ganze Karte, und das Leuchten wäre nie zu sehen.
 */

const START = "/#x=500.000&y=500.000&z=2.50&series=original";

async function leuchtet(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as import("maplibre-gl").Map;
        return (
            map.getLayer("such-leuchten-ganz-fuellung") !== undefined || map.getSource("such-leuchten") !== undefined
        );
    });
}

test("🔴 am Telefon: die Liste steht über dem Feld, das Leuchten vor dem Panel, die Pille holt das Panel", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    await page.goto(START);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("search-open").click();
    const input = page.getByTestId("search-input");
    await expect(input).toBeVisible();
    await input.fill("schlinger");

    // Die Sektion „Vorkommen“ steht über dem Feld (die Treffer wachsen nach oben), samt leiser Zeile.
    const zeile = page.getByTestId("search-vorkommen").first();
    await expect(zeile).toContainText("Schlinger");
    await expect(page.getByTestId("search-hinweis")).toBeVisible();
    const lage = await page.evaluate(() => {
        const treffer = document.querySelector('[data-testid="search-vorkommen"]')?.getBoundingClientRect();
        const feld = document.querySelector('[data-testid="search-input"]')?.getBoundingClientRect();
        const breite = document.documentElement.clientWidth;
        return { trefferUnten: treffer?.bottom ?? 0, feldOben: feld?.top ?? 0, rechts: treffer?.right ?? 0, breite };
    });
    expect(lage.trefferUnten).toBeLessThanOrEqual(lage.feldOben + 1);
    expect(lage.rechts).toBeLessThanOrEqual(lage.breite);

    // Ein Chip setzt die Präposition ins Feld.
    await input.fill("schlinger ");
    await page.getByTestId("search-chip").first().click();
    await expect(input).toHaveValue("Schlinger in ");
    // Die Ziele stehen da; das erste ist im Wiki genannt.
    await expect(page.getByTestId("search-ziel").first()).toContainText("im Wiki genannt");

    await input.fill("schlinger");
    await expect(zeile).toContainText("Schlinger");
    await input.press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();

    // Die Karte leuchtet; das Panel bleibt eingeklappt, die Pille steht über der Karte.
    await expect.poll(() => leuchtet(page), { timeout: 30_000 }).toBe(true);
    const pille = page.getByTestId("eintrag-pille");
    await expect(pille).toBeVisible();
    await expect(pille).toContainText("Schlinger");
    await expect(page.getByTestId("info-eintrag")).toBeHidden();

    // Die Pille holt das Panel nach vorn; ✕ klappt es wieder ein, das Leuchten bleibt.
    await pille.click();
    await expect(page.getByTestId("info-title")).toHaveText("Schlinger");
    await expect(page.getByTestId("info-eintrag-alle")).toBeVisible();
    await expect(pille).toBeHidden();
    await page.getByTestId("info-panel-close").click();
    await expect(pille).toBeVisible();
    expect(await leuchtet(page)).toBe(true);
});
