import { expect, test } from "@playwright/test";

/**
 * Die Reiseart „Flug“ am Telefon (WI-0050): Die Flugliste passt in die Panelbreite, nichts ragt
 * seitlich hinaus, und die Felder des eigenen Flugmittels zoomen iOS nicht hinein (16 px).
 */
test("🔴 Am Telefon passt die Flugliste ins Panel, und die eigenen Felder tragen 16 px", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");

    await page.getByTestId("travel-mode-air").tap();
    await expect(page.getByTestId("travel-mode-air")).toHaveAttribute("aria-pressed", "true");
    await page.locator(".air__option", { has: page.getByTestId("air-custom") }).tap();
    await expect(page.getByTestId("air-custom-fields")).toBeVisible();

    const befund = await page.evaluate(() => {
        const panel = document.getElementById("route-planner-panel")!;
        const rechts = panel.getBoundingClientRect().right;
        return {
            panelRollt: panel.scrollWidth > panel.clientWidth,
            ueberstand: [
                ...document.querySelectorAll<HTMLElement>(".air__option, .air__custom, [data-testid='travel-mode']"),
            ]
                .filter((element) => element.getBoundingClientRect().right > rechts + 0.5)
                .map((element) => element.textContent?.trim() ?? element.className),
            klein: [...document.querySelectorAll<HTMLInputElement>("[data-testid='air-custom-fields'] input")]
                .map((input) => [input.dataset["testid"], Number.parseFloat(getComputedStyle(input).fontSize)])
                .filter(([, size]) => (size as number) < 16),
            werte: [...document.querySelectorAll<HTMLElement>(".air__values")].filter(
                (element) => element.scrollWidth > element.clientWidth + 0.5,
            ).length,
        };
    });
    expect(befund.panelRollt, "das Panel rollt nicht seitwärts").toBe(false);
    expect(befund.ueberstand).toEqual([]);
    expect(befund.klein, "Felder unter 16 px zoomen iOS beim Fokus hinein").toEqual([]);
    expect(befund.werte, "keine abgeschnittenen Werte").toBe(0);

    // Ein Tipp auf die Zeile wählt, nicht nur einer auf den Knopf.
    await page.locator(".air__option", { has: page.getByTestId("air-griffin") }).tap();
    await expect(page.getByTestId("air-griffin")).toBeChecked();
    await expect(page.getByTestId("air-custom-fields")).toHaveCount(0);
});
