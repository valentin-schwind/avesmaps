import { expect, test, type Page } from "@playwright/test";

/**
 * Die Schalter des Auge-Menüs in der Adresse am Finger (WI-0072): Tippen, Adresse, neuer Tab - und Legacys Link auf dem
 * Telefon. Den Rechner prüft `display-link.spec.ts`.
 */

async function openAt(page: Page, address: string): Promise<void> {
    await page.goto(address);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

const styleLayers = (page: Page): Promise<string[]> =>
    page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id) ?? []);

const hashParams = async (page: Page): Promise<URLSearchParams> =>
    new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1));

test("🔴 am Telefon: Schalter antippen, die Adresse kopieren, im neuen Tab dieselbe Ansicht", async ({
    page,
    context,
}) => {
    await openAt(page, "/");
    const history = await page.evaluate(() => globalThis.history.length);
    await page.getByTestId("display-open").tap();
    await page.getByTestId("display-paths").tap();
    await page.getByTestId("display-place-dorf").tap();
    await expect.poll(async () => (await hashParams(page)).get("togglePaths")).toBe("0");
    expect((await hashParams(page)).get("toggleDoerfer")).toBe("1");
    expect(await page.evaluate(() => globalThis.history.length), "kein Eintrag je Tipp").toBe(history);

    const address = await page.evaluate(() => globalThis.location.href);
    const fresh = await context.newPage();
    await openAt(fresh, address);
    expect(await styleLayers(fresh)).not.toContain("path-center-reichsstrasse");
    await fresh.getByTestId("display-open").tap();
    await expect(fresh.getByTestId("display-paths").locator("input")).not.toBeChecked();
    await expect(fresh.getByTestId("display-place-dorf")).toHaveAttribute("aria-pressed", "true");
    await expect(fresh.getByTestId("display-place-gebaeude")).toHaveAttribute("aria-pressed", "false");
});

test("🔴 am Telefon: Legacys Link mit togglePaths=0 öffnet die Karte ohne Wege, und die Query räumt sich auf", async ({
    page,
}) => {
    await openAt(page, "/?togglePaths=0&toggleMetropolen=1");
    expect(await styleLayers(page)).not.toContain("path-center-reichsstrasse");
    expect(new URL(page.url()).search).toBe("");
    await expect.poll(async () => (await hashParams(page)).get("togglePaths")).toBe("0");
    expect((await hashParams(page)).get("toggleMetropolen")).toBe("1");
    await page.getByTestId("display-open").tap();
    await expect(page.getByTestId("display-paths").locator("input")).not.toBeChecked();
    await expect(page.getByTestId("display-place-metropole")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("display-place-grossstadt")).toHaveAttribute("aria-pressed", "false");
});
