import { expect, test, type Page } from "@playwright/test";
import { GARETH, showCamera } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Das Kameramodell nach Absicht am Telefon (WI-0039). Maßgeblich ist auch hier die sichtbare
 * Kartenfläche - aber nicht die Logik des Rechners: Der offene Planer deckt die Karte fast ganz
 * (350 von 412 px) und ist deshalb kein Rand. Die schwebende Leiste oben ist einer.
 */

async function insets(page: Page): Promise<{ top: number; left: number }> {
    return page.evaluate(() => {
        const padding = globalThis.avesmapsVisibleArea!.insets();
        return { top: padding.top ?? 0, left: padding.left ?? 0 };
    });
}

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
}

async function onScreen(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        point,
    );
}

async function openRoute(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-player-floating")).toBeVisible({ timeout: 20_000 });
    await settled(page);
}

test("🔴 die schwebende Leiste ist ein Rand: der gesuchte Ort steht mitten in der Fläche darunter", async ({
    page,
}) => {
    await openRoute(page);
    const player = (await page.getByTestId("route-player-floating").boundingBox())!;
    // Der Rand der Karte zählt von IHREM oberen Rand: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
    const mapTop = (await page.getByTestId("map").boundingBox())!.y;
    await expect.poll(() => insets(page)).toEqual({ top: Math.round(player.y + player.height - mapTop), left: 0 });
    await showCamera(page, { point: { x: 250, y: 450 }, zoom: 3 });
    await page.getByTestId("search-open").tap();
    await page.getByTestId("search-input").fill("Gareth");
    await expect(page.getByTestId("search-hit").first()).toContainText("Gareth");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();
    await settled(page);
    const viewport = page.viewportSize()!;
    const top = (await insets(page)).top;
    const height = await page.evaluate(() => globalThis.avesmapsMap!.getCanvas().clientHeight);
    const at = await onScreen(page, GARETH);
    expect(Math.abs(at.x - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(at.y - (top + (height - top) / 2))).toBeLessThanOrEqual(2);
});

test("🔴 der offene Planer deckt die Karte: ein Etappenort landet in ihrer Mitte, sichtbar nach dem Zuklappen", async ({
    page,
}) => {
    await openRoute(page);
    const handle = page.getByTestId("route-planner-tab");
    await handle.tap();
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await showStages(page, 15_000);
    // Offen ist er kein Rand: Die 62 freien Bildpunkte wären kein Ziel.
    await expect.poll(() => insets(page)).toEqual({ top: 0, left: 0 });
    await showCamera(page, { point: { x: 250, y: 450 }, zoom: 3 });
    // Genau „Gareth“: Seit Satz map154313 steht auf derselben Etappe auch „Gareth-St. Lechmin, Reichsstraße 3“.
    // 🪤 Der Flug beginnt erst mit der Antwort des Servers (WI-0087 P2): erst auf die Bewegung warten, dann auf ihr Ende.
    // 💣 Gewartet wurde dafür auf eine Änderung der LÄNGE, und das war die falsche Bedingung: Mit dem Infopanel fährt der
    // Planer zu, und die schwebende Leiste wird wieder ein Rand - `padding.top` springt von 0 auf 88, und ALLEIN davon
    // wandert `getCenter()` um die halbe Randhöhe (gemessen: die sichtbare Mitte von 419,5 auf 463,5). Dieser Zug kommt
    // vor der Antwort des Servers, trägt kein `zoomstart` und ist sofort vorbei; danach stand die Karte still auf Stufe 3,
    // und der Fall maß Gareth 1.206,5 px rechts der sichtbaren Mitte (1412,5 − 206). Seriell gewann der Flug das Rennen,
    // unter Last verlor er es: Am 2026-10-07 fielen 5 von 6 Wiederholungen (`--repeat-each=6 --workers=4`) mit genau
    // dieser Zahl, seriell war der Fall grün. Gewartet wird deshalb auf die ZOOMSTUFE - der Randzug lässt sie unberührt
    // (gemessen `moveend … z=3.000` ohne `zoomstart`), der Flug zum Etappenort hebt sie von 3 auf die Stufe des Ortes.
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page
        .getByTestId("route-stage")
        .first()
        .locator(".stage-link", { hasText: /^Gareth$/ })
        .tap();
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getZoom()), { timeout: 20_000 })
        .not.toBe(vorher);
    await settled(page);
    // 🪤 Gemessen an der SICHTBAREN Mitte (`avesmapsVisibleArea.centre()`, bis WI-0218 die projizierte Kartenmitte), nicht an der Canvasmitte: Seit WI-0087 P2
    // öffnet der Klick auch am Telefon das Infopanel, und das meldet sich als Deckung. Die Zusicherung bleibt
    // dieselbe - der Ort landet dort, wohin die Kamera zielt -, nur misst sie jetzt das, was die Kamera auch nimmt.
    const at = await onScreen(page, GARETH);
    const centre = await page.evaluate(() => globalThis.avesmapsVisibleArea!.centre());
    expect(Math.abs(at.x - centre.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(at.y - centre.y)).toBeLessThanOrEqual(2);

    // 🔴 Am Telefon schließen Planer und Infopanel einander aus (WI-0063 4.3): Mit dem Panel ist der Planer von
    // selbst zugefahren - getippt werden muss dafür nichts. Die Leiste ist damit wieder ein Rand.
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("info-panel")).toBeVisible();
    const player = (await page.getByTestId("route-player-floating").boundingBox())!;
    const mapTop = (await page.getByTestId("map").boundingBox())!.y;
    await expect.poll(async () => (await insets(page)).top).toBe(Math.round(player.y + player.height - mapTop));
    const after = await onScreen(page, GARETH);
    expect(Math.abs(after.y - at.y)).toBeLessThanOrEqual(1);
    expect(after.y).toBeGreaterThan(player.y + player.height - mapTop);
});
