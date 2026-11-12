import { expect, test, type Page } from "@playwright/test";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Das Infopanel am Telefon, Paket P7 (WI-0063): Die Pfeile der Etappe (E13) stehen fest an den Rändern der Untertitelzeile („‹ Von → Bis ›“,
 * 27.13), bleiben im Panel und sind fingergroß; ein Tipp wählt die nächste Etappe, und beim Blättern bleiben sie auch bei langen Namen an
 * derselben Stelle. Die Wege am Rechner prüft `info-panel-p7.spec.ts`, den Kopf mit Messung `info-panel-stage-head.spec.ts`.
 */

/** Öffnet die erste Etappe einer Reise am Telefon: den Planer aufklappen, die Zeile über ihr Bild wählen. */
async function openFirstStage(page: Page, route: string): Promise<void> {
    await page.goto(route);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await openStageGroups(page);
    const rows = page.getByTestId("route-stage");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    // Auf dem Bild der Zeile, nicht in ihrer Mitte: Am schmalen Telefon liegt dort ein Gebietsname, ein Link.
    await rows.first().locator("img").first().tap();
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 1 von \d+$/, { timeout: 15_000 });
}

/** Wo die beiden Pfeile und der Untertitel stehen. */
async function arrows(page: Page): Promise<{
    prev: { x: number; y: number; width: number; height: number };
    next: { x: number; y: number; width: number; height: number };
    subtitle: { x: number; width: number };
}> {
    const [prev, next, subtitle] = await Promise.all([
        page.getByTestId("info-stage-prev").boundingBox(),
        page.getByTestId("info-stage-next").boundingBox(),
        page.getByTestId("info-subtitle").boundingBox(),
    ]);
    return { prev: prev!, next: next!, subtitle: subtitle! };
}

test("🔴 Telefon: „Etappe n von m“ mit ‹ Von → Bis › - die Pfeile bleiben im Panel, haben Bedienhöhe, ein Tipp wählt die nächste Etappe", async ({
    page,
}) => {
    await openFirstStage(page, "/?route=Gareth~Perricum");

    const panel = await page.getByTestId("info-panel").boundingBox();
    const prev = page.getByTestId("info-stage-prev");
    const next = page.getByTestId("info-stage-next");
    await expect(prev).toBeDisabled();
    for (const button of [prev, next]) {
        const box = await button.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
        expect((box?.x ?? 0) + (box?.width ?? 0), "der Pfeil liegt im Panel").toBeLessThanOrEqual(
            (panel?.x ?? 0) + (panel?.width ?? 0),
        );
    }
    // Der Untertitel liegt zwischen den Pfeilen und bricht um, statt sie aus dem Panel zu schieben.
    const before = await arrows(page);
    expect(before.prev.x + before.prev.width).toBeLessThanOrEqual(before.subtitle.x);
    expect(before.subtitle.x + before.subtitle.width).toBeLessThanOrEqual(before.next.x);

    await next.tap();
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von \d+$/);
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toMatchObject({
        kind: "routeStage",
        index: 1,
    });
    await expect(prev).toBeEnabled();
    // Fest: Nach dem Blättern stehen beide Pfeile genau dort, wo sie standen.
    const after = await arrows(page);
    expect(Math.abs(after.prev.x - before.prev.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.next.x - before.next.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.prev.y - before.prev.y)).toBeLessThanOrEqual(0.5);
});

test("🔴 Telefon: auch bei einem langen Namen („Tempel des Schwarzen Raben zu Derrelsbach“) bleiben die Pfeile beim Blättern an ihrer Stelle", async ({
    page,
}) => {
    await openFirstStage(page, "/?route=Tempel%20des%20Schwarzen%20Raben%20zu%20Derrelsbach~Gareth");
    await expect(page.getByTestId("info-subtitle")).toContainText("Tempel des Schwarzen Raben zu Derrelsbach");
    const first = await arrows(page);
    const panel = await page.getByTestId("info-panel").boundingBox();
    expect(first.next.x + first.next.width, "› im Panel").toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0));
    // Mehrere Etappen weiter, kurze Namen: dieselben x und y.
    for (const step of [2, 3, 4]) {
        await page.getByTestId("info-stage-next").tap();
        await expect(page.getByTestId("info-title")).toHaveText(new RegExp(`^Etappe ${String(step)} von \\d+$`));
        const now = await arrows(page);
        expect(Math.abs(now.prev.x - first.prev.x), `‹ x, Etappe ${String(step)}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(now.next.x - first.next.x), `› x, Etappe ${String(step)}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(now.prev.y - first.prev.y), `‹ y, Etappe ${String(step)}`).toBeLessThanOrEqual(0.5);
    }
});
