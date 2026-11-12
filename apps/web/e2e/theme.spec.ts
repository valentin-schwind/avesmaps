import { expect, test, type Page } from "@playwright/test";
import "./map-handle";

/**
 * Hell oder dunkel (WI-0032, Guide §23; Legacy `theme-toggle.js`): Der Knopf oben rechts im Planer
 * schaltet die ganze Oberfläche, die Wahl übersteht das Neuladen, und die Karte bleibt hell.
 */

async function open(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

const cssVar = (page: Page, name: string): Promise<string> =>
    page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name);

test("🔴 Ohne eigene Wahl wie das Betriebssystem, auch wenn es umschaltet (Betreiber 2026-09-24)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await cssVar(page, "--color-panel")).toBe("#312e26");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-pressed", "true");
    // Stellt jemand sein System um, zieht die Seite mit - solange er nicht selbst gewählt hat.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await cssVar(page, "--color-panel")).toBe("#fffdf9");
    expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe("#565044");
});

test("🔴 Die eigene Wahl geht dem Betriebssystem vor, auch nach dem Neuladen", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    // Auch ein Umschalten des Systems ändert die eigene Wahl nicht mehr.
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});

test("🔴 Der Knopf schaltet die Oberfläche, die Wahl übersteht das Neuladen, die Karte bleibt hell", async ({
    page,
}) => {
    await open(page);
    const route = await page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as { getPaintProperty(l: string, p: string): unknown }).getPaintProperty(
            "route-line",
            "line-color",
        ),
    );
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(await cssVar(page, "--color-panel")).toBe("#312e26");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe("#211f19");
    // Die Karte hat keinen Dunkelwert: Die Route trägt dieselbe Farbe wie vorher.
    const routeDark = await page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as { getPaintProperty(l: string, p: string): unknown }).getPaintProperty(
            "route-line",
            "line-color",
        ),
    );
    expect(routeDark).toEqual(route);

    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => localStorage.getItem("avesmaps-theme"))).toBe("light");
});
