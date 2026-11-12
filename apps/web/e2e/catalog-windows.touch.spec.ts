import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Die Katalogfenster am Telefon (WI-0118, Pixel 7, 412 px): Der Tipp auf die Kachel unter dem Streifen öffnet das Fenster, es füllt die Breite mit
 * 14 px Rand, trägt keinen Griff (am Finger zieht niemand), und weder das Fenster noch seine Leiste noch der aufgeklappte Eintrag laufen
 * waagerecht über. Ein Tipp auf eine Kachel im Streifen schlägt den Eintrag vergrößert auf. Die 360 px des kleinsten Telefons prüft
 * `catalog-windows.spec.ts`.
 */

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;

async function openWindow(page: Page, section: "citymaps" | "literature"): Promise<Locator> {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    const panel = page.locator(`[data-section="${section}"]`);
    const tile = panel.getByTestId(section === "citymaps" ? "info-action-citymapsAll" : "info-action-literatureAll");
    await tile.waitFor({ timeout: 30_000 });
    await tile.scrollIntoViewIfNeeded();
    await tile.tap();
    const window = page.getByTestId(section === "citymaps" ? "citymaps-window" : "literature-window");
    await expect(window).toBeVisible();
    await expect(window.getByTestId("catalog-row").first()).toBeVisible({ timeout: 30_000 });
    return window;
}

for (const section of ["citymaps", "literature"] as const) {
    test(`🔴 Fenster ${section} am Telefon: volle Breite mit Rand, kein Griff, nichts läuft waagerecht über - auch nicht der aufgeklappte Eintrag`, async ({
        page,
    }) => {
        const window = await openWindow(page, section);
        const viewport = page.viewportSize()!;
        const box = (await window.boundingBox())!;
        expect(Math.round(box.x)).toBe(14);
        expect(Math.round(viewport.width - box.x - box.width)).toBe(14);
        await expect(window.locator(".avm-fenster__griff")).toBeHidden();

        // Einen Eintrag ohne Deckel aufklappen: Der Tipp auf den Kopf der Zeile.
        const free = window
            .getByTestId("catalog-row")
            .filter({ hasNot: page.getByTestId("info-spoiler") })
            .nth(1);
        await free.getByTestId("catalog-row-toggle").tap();
        await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(1);
        await page.waitForTimeout(400);
        const fit = await window.evaluate((dialog) => {
            const rumpf = dialog.querySelector<HTMLElement>('[data-testid="fenster-rumpf"]')!;
            const leiste = dialog.querySelector<HTMLElement>('[data-testid="fenster-leiste"]');
            const image = dialog.querySelector<HTMLImageElement>('[data-testid="catalog-entry-image"]');
            return {
                page: document.documentElement.scrollWidth > globalThis.innerWidth,
                rumpf: rumpf.scrollWidth > rumpf.clientWidth + 1,
                leiste: leiste !== null && leiste.scrollWidth > leiste.clientWidth + 1,
                huelle: dialog.scrollHeight > dialog.clientHeight,
                // Das Bild ist nie breiter als sein Platz, auch wenn die Datei breiter ist.
                bild: image === null ? 0 : image.getBoundingClientRect().width - rumpf.clientWidth,
            };
        });
        expect(fit.page).toBe(false);
        expect(fit.rumpf).toBe(false);
        expect(fit.leiste).toBe(false);
        expect(fit.huelle).toBe(false);
        expect(fit.bild).toBeLessThanOrEqual(0);
        // Ein Tipp neben das Fenster schließt es.
        await page.touchscreen.tap(viewport.width / 2, Math.max(2, box.y / 2));
        await expect(window).toBeHidden();
    });
}

test("ein Tipp auf eine Kachel im Streifen schlägt das Fenster beim Eintrag auf, vergrößert", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    const panel = page.locator('[data-section="citymaps"]');
    await panel.getByTestId("info-action-citymapsAll").waitFor({ timeout: 30_000 });
    const tile = panel
        .getByTestId("info-citymaps-card")
        .filter({ hasText: "Gareth-Karte aus der Gareth-Box" })
        .first()
        .getByTestId("info-citymaps-link");
    await tile.scrollIntoViewIfNeeded();
    await tile.tap();
    const window = page.getByTestId("citymaps-window");
    await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(1);
    await expect(window.getByTestId("catalog-entry-image")).toBeVisible();
});
