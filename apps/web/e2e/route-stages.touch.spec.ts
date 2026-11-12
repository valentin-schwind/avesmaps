import { expect, test, type Page } from "@playwright/test";
import { showStages } from "./stage-groups.ts";
import { openPlannerBox } from "./planner-boxes.ts";

/**
 * Die Etappenanzeige am Finger (WI-0079 §9): 412, 360 und 320 px. Geprüft wird, dass nichts seitlich überläuft,
 * dass die Zeile am Finger nach einem Tipp nichts stehen lässt (sie kennt kein Zeigen) und dass der Haken
 * „Eiltempo“ erreichbar bleibt.
 */

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await showStages(page, 20_000);
}

for (const width of [412, 360, 320]) {
    test(`🔴 bei ${String(width)} px läuft nichts seitlich über`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await openRoute(page, "?route=Gareth~Perricum");
        const overflow = await page.evaluate((viewport) => {
            const list = document.querySelector<HTMLElement>("[data-testid=route-stages]")!;
            const box = list.getBoundingClientRect();
            let worst = 0;
            for (const element of list.querySelectorAll<HTMLElement>("*")) {
                const own = element.getBoundingClientRect();
                if (own.width === 0) continue;
                worst = Math.max(worst, own.right - box.right, box.left - own.left, own.right - viewport);
            }
            return worst;
        }, width);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}

test("🔴 am Finger bleibt nach einem Tipp nichts stehen: die Zeile kennt keinen gehaltenen Zustand", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openRoute(page, "?route=Gareth~Perricum");
    const first = page.getByTestId("route-stage").first();
    const background = (): Promise<string> => first.evaluate((element) => getComputedStyle(element).backgroundColor);
    // Die Ruhe ist die Fläche des Panels, nicht das, was die Zeile gerade zeigt.
    const ruhe = await first.evaluate((row) => {
        const probe = document.createElement("div");
        probe.style.background = "var(--color-panel)";
        row.parentElement!.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
    });
    // 💣 Nach einem Tipp bleibt der Zeiger, wo der Finger war, und Chrome hält dort `:hover`. Wo das ist, hing hier früher
    // am Zufall des letzten Tipps (im Volllauf vom 2026-10-08 lag er auf der ersten Zeile, einzeln nicht). Darum steht er
    // jetzt ausdrücklich auf ihr: Am Finger darf das nichts färben.
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.waitForTimeout(200);
    expect(await background(), "der gehaltene Zeiger färbt nichts").toBe(ruhe);
    await page.getByTestId("route-stage").nth(1).locator("img").first().tap();
    await expect(page.getByTestId("route-stage").nth(1)).toHaveClass(/is-active/);
    // Die erste Zeile ist unberührt - kein gehaltener Hover, kein Fokusring.
    expect(await background()).toBe(ruhe);
});

test("der Haken „Eiltempo“ ist am Finger sichtbar und bedienbar", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openRoute(page, "?route=Gareth~Perricum");
    // Die Klappbox „Transportmittel“ ist am Finger zu; der Haken steht darin.
    await openPlannerBox(page, "transport", { tap: true });
    const haken = page.getByTestId("hurry");
    await expect(haken).toBeVisible();
    const box = await haken.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await haken.check();
    await expect.poll(() => new URL(page.url()).search).toContain("hurry=1");
});
