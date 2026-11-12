import { expect, test } from "@playwright/test";
import { showStages } from "./stage-groups.ts";

/**
 * Der Routenplaner am Telefon (WI-0017; Legacy A2, Owner 11.08./12.08.2026): Er startet zu, der
 * Griff ist ein Pfeil mittig an der Kante, offen reicht das Panel von oben bis unten, und der
 * Knopfbund tritt solange zurück - immer nur ein Panel offen.
 */
test("🔴 Am Telefon startet der Planer zu, öffnet über den Griff und verdrängt den Knopfbund", async ({ page }) => {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const handle = page.getByTestId("route-planner-tab");
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    const corner = page.locator(".corner").last();
    await expect(corner).toBeVisible();

    await handle.tap();
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await expect(corner).toBeHidden();

    const viewport = page.viewportSize()!;
    // Panel und Leiste des Playmodes zusammen reichen von oben bis unten (WI-0031).
    const panel = await page.locator(".planner-stack").boundingBox();
    // Oben zählt der Rand der Anwendung: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
    const appTop = await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top);
    expect((panel?.y ?? 0) - appTop).toBe(0);
    expect(Math.round((panel?.height ?? 0) + (panel?.y ?? 0))).toBe(viewport.height);
    // Der Griff bleibt im Bild, damit das Panel wieder zugeht.
    const grip = await handle.boundingBox();
    expect((grip?.x ?? 0) + (grip?.width ?? 0)).toBeLessThanOrEqual(viewport.width);

    await showStages(page, 15_000);
    await handle.tap();
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await expect(corner).toBeVisible();
});

test("🔴 Am Telefon zoomt die Seite nicht: kein Doppeltipp-Zoom, jedes Feld mindestens 16 px", async ({ page }) => {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("options-toggle").tap();
    const felder = await page.evaluate(() => ({
        touchAction: getComputedStyle(document.documentElement).touchAction,
        klein: [...document.querySelectorAll<HTMLInputElement>("#route-planner-panel input")]
            .filter((input) => input.type !== "checkbox" && input.type !== "radio")
            .map((input) => [
                input.dataset["testid"] ?? input.type,
                Number.parseFloat(getComputedStyle(input).fontSize),
            ])
            .filter(([, size]) => (size as number) < 16),
        seiteRollt: document.scrollingElement!.scrollHeight > window.innerHeight,
    }));
    expect(felder.touchAction).toBe("manipulation");
    expect(felder.klein, "Felder unter 16 px zoomen iOS beim Fokus hinein").toEqual([]);
    expect(felder.seiteRollt, "die Seite hat nichts zu rollen").toBe(false);
});
