import { expect, test, type Locator } from "@playwright/test";
import "./map-handle";

/**
 * Der Playmode am Telefon (WI-0031): Offen ist die Leiste der Fuß des Planers, zugeklappt steht sie
 * allein oben über der Karte (Betreiber 2026-09-24). Ihre Beschriftung steht nie über den Rand hinaus -
 * genau das zeigte das Bildschirmfoto des Betreibers bei einer Reise über 3.339 Meilen.
 */

/** Eine lange Reise: vierstellige Meilen, viele Etappen. */
const LONG_ROUTE = "/?route=Havena~Gareth~Festum~Khunchom";
const shots = process.env["PLAYMODE_SHOTS"];

/**
 * Die Beschriftung liegt ganz in der Leiste, in EINER Reihe mit den Knöpfen: links und rechts von
 * ihnen, nie darüber (Betreiber 2026-09-24, Variante 3). Und sie ist ganz zu lesen, nicht gekürzt.
 */
async function expectTidy(player: Locator): Promise<void> {
    const bar = (await player.boundingBox())!;
    const first = (await player.getByTestId("player-start").boundingBox())!;
    const last = (await player.getByTestId("player-end").boundingBox())!;
    for (const id of ["player-miles", "player-miles-left", "player-days", "player-days-left"]) {
        const label = player.getByTestId(id);
        const box = (await label.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bar.x);
        expect(box.x + box.width, `${id} steht nicht über den Rand`).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
        if (id.startsWith("player-miles")) {
            expect(box.x + box.width, `${id} links neben den Knöpfen`).toBeLessThanOrEqual(first.x + 0.5);
        } else {
            expect(box.x, `${id} rechts neben den Knöpfen`).toBeGreaterThanOrEqual(last.x + last.width - 0.5);
        }
        const whole = await label.evaluate((element) => element.scrollWidth <= element.clientWidth);
        expect(whole, `${id} ist ganz zu lesen, nicht gekürzt`).toBe(true);
    }
}

test("🔴 Am Telefon: offen der Fuß des Planers, zugeklappt allein über der Karte - nie über den Rand", async ({
    page,
}) => {
    await page.goto(LONG_ROUTE);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    const footer = page.getByTestId("route-player");
    await expect(footer).toBeVisible({ timeout: 20_000 });
    const viewport = page.viewportSize()!;
    const box = (await footer.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    // Zum Ende: Die Beschriftung zeigt die ganze Reise, die längsten Zahlen.
    await footer.getByTestId("player-end").tap();
    await expect(footer.getByTestId("player-miles")).toHaveText(/^\d\.\d{3} Meilen$/);
    await expectTidy(footer);
    if (shots) await page.screenshot({ path: `${shots}/playmode-telefon-fuss.png` });

    await page.getByTestId("route-planner-tab").tap();
    await expect(footer).toBeHidden();
    const floating = page.getByTestId("route-player-floating");
    await expect(floating).toBeVisible();
    // Oben zählt der Rand der Anwendung: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
    const appTop = await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top);
    expect((await floating.boundingBox())!.y - appTop).toBeLessThan(20);
    await expectTidy(floating);
    await floating.getByTestId("player-start").tap();
    await floating.getByTestId("player-play").tap();
    await expect(floating.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    await expect(floating.getByTestId("player-miles")).not.toHaveText("0,0 Meilen");
    if (shots) await page.screenshot({ path: `${shots}/playmode-telefon-karte.png` });
});
