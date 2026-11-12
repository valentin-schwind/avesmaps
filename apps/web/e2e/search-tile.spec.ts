import { expect, test } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Suchkachel am Zeiger (WI-0026): Legacys Lupe, und dasselbe Fenster wie bisher - oben, ohne
 * Bewegung (Owner Legacy 11.08.2026: „hier brauchen wir nicht die animation"). Das Verhalten am
 * Finger prüft `search-tile.touch.spec.ts`.
 */

test("🔴 die Suchkachel ist Legacys Lupe: 48 × 48 px, nur das Zeichen, kein Wort", async ({ page }) => {
    await openMap(page);
    const tile = page.getByTestId("search-open");
    await expect(tile).toHaveAccessibleName("Suche öffnen (F)");
    await expect(tile).toHaveText("");
    const box = await tile.boundingBox();
    expect(box?.width).toBeCloseTo(48, 0);
    expect(box?.height).toBeCloseTo(48, 0);
    await expect(tile.locator("svg circle")).toHaveAttribute("r", "6.5");
});

test("am Zeiger öffnet die Suche oben und ohne Bewegung, die Lupe bleibt unter dem Schleier", async ({ page }) => {
    await openMap(page);
    const tile = page.getByTestId("search-open");
    await tile.click();
    const card = page.getByRole("dialog", { name: "Suche" });
    await expect(card).toBeVisible();

    const stand = await card.evaluate((element) => {
        const kachel = document.querySelector<HTMLElement>('[data-testid="search-open"]');
        const box = kachel?.getBoundingClientRect();
        const oben = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
        return {
            top: element.getBoundingClientRect().top,
            bewegungen: element.getAnimations().length,
            lupeOben: oben?.closest('[data-testid="search-open"]') !== null,
        };
    });
    expect(stand.top, "das Fenster steht im oberen Drittel").toBeLessThan(page.viewportSize()!.height / 3);
    expect(stand.bewegungen, "kein Aufklappen am Zeiger").toBe(0);
    expect(stand.lupeOben, "am Zeiger liegt der Schleier über der Lupe").toBe(false);
});
