import { expect, test, type Page } from "@playwright/test";
import { ERSTER_BESUCH } from "./erster-besuch.ts";
import { GARETH, needleGap, openMap, readCamera, showCamera } from "./map-handle.ts";

// Dieser Spec prüft den Hinweis beim ersten Besuch selbst; sonst gilt er als gesehen (`e2e/erster-besuch.ts`).
test.use(ERSTER_BESUCH);

/**
 * Steuerring und die Pille „2D | 3D“ darüber (WI-0016, D8 und D2; WI-0040).
 *
 * 🪤 Die vier Zonen sind Keile über dem ganzen Ring; ihre Mitte liegt unter der Rosettenscheibe.
 * Ein Klick „auf den Knopf" träfe also die Scheibe - geklickt wird deshalb im Keil, wie ein Mensch.
 */

type Zone = "in" | "out" | "left" | "right";
const ZONE_TEST_ID: Record<Zone, string> = {
    in: "camera-zoom-in",
    out: "camera-zoom-out",
    left: "camera-rotate-left",
    right: "camera-rotate-right",
};

async function clickZone(page: Page, zone: Zone): Promise<void> {
    const ring = await page.getByTestId("camera-ring").boundingBox();
    if (!ring) {
        throw new Error("Steuerring fehlt");
    }
    const edge = 12;
    const position = {
        in: { x: ring.width / 2, y: edge },
        out: { x: ring.width / 2, y: ring.height - edge },
        left: { x: edge, y: ring.height / 2 },
        right: { x: ring.width - edge, y: ring.height / 2 },
    }[zone];
    await page.getByTestId(ZONE_TEST_ID[zone]).click({ position });
}

/** Wartet, bis die Kamera nach einer Fahrt ruht. */
async function settled(page: Page): Promise<{ bearing: number; pitch: number; zoom: number }> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    return readCamera(page);
}

test.beforeEach(async ({ page }) => {
    await openMap(page);
    await showCamera(page, { point: GARETH, zoom: 5.5 });
});

test("🔴 der Steuerring ersetzt die Zoomknöpfe von MapLibre", async ({ page }) => {
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveCount(0);
    await expect(page.getByTestId("camera-ring")).toBeVisible();
    // MapLibres eigene Texte stehen auf Deutsch.
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveAttribute("aria-label", "Karte");
});

test("oben zoomt hinein, unten heraus - je eine Stufe", async ({ page }) => {
    await clickZone(page, "in");
    expect((await settled(page)).zoom).toBeCloseTo(6.5, 2);
    await clickZone(page, "out");
    await clickZone(page, "out");
    await expect.poll(async () => (await settled(page)).zoom).toBeCloseTo(4.5, 2);
});

test("die Pfeile links und rechts drehen zur nächsten Himmelsrichtung, die Mitte richtet nach Norden aus", async ({
    page,
}) => {
    await clickZone(page, "right");
    expect((await settled(page)).bearing).toBeCloseTo(45, 1);
    await clickZone(page, "right");
    expect((await settled(page)).bearing).toBeCloseTo(90, 1);
    await clickZone(page, "left");
    expect((await settled(page)).bearing).toBeCloseTo(45, 1);

    await expect(page.getByTestId("camera-north")).toHaveAttribute("aria-label", /Nach Norden ausrichten/);
    await page.getByTestId("camera-north").click();
    expect((await settled(page)).bearing).toBeCloseTo(0, 1);
    await expect(page.getByTestId("camera-north")).toHaveAttribute("aria-label", "Norden ist oben");
});

test("🔴 die Pille ändert nur die Neigung, nie die Drehung (D2); die gewählte Hälfte tut nichts", async ({ page }) => {
    await showCamera(page, { point: GARETH, zoom: 5.5, bearing: 90 });
    const flat = page.getByTestId("camera-view-2d");
    const tilted = page.getByTestId("camera-view-3d");
    await expect(flat).toHaveAttribute("aria-pressed", "true");
    await expect(tilted).toHaveAttribute("aria-pressed", "false");

    await flat.click();
    await page.waitForTimeout(300);
    expect((await readCamera(page)).pitch).toBeCloseTo(0, 1);

    await tilted.click();
    const inTilt = await settled(page);
    expect(inTilt.pitch).toBeCloseTo(45, 1);
    expect(inTilt.bearing).toBeCloseTo(90, 1);
    await expect(tilted).toHaveAttribute("aria-pressed", "true");
    await expect(flat).toHaveAttribute("aria-pressed", "false");

    await tilted.click();
    await page.waitForTimeout(300);
    expect((await readCamera(page)).pitch).toBeCloseTo(45, 1);

    await flat.click();
    const back = await settled(page);
    expect(back.pitch).toBeCloseTo(0, 1);
    expect(back.bearing).toBeCloseTo(90, 1);
});

test("🔴 die Pille ist so breit wie der Ring, und der Ring liegt über ihrem unteren Rand (Betreiber 2026-09-26)", async ({
    page,
}) => {
    const pill = await page.getByTestId("camera-view").boundingBox();
    const ring = await page.getByTestId("camera-ring").boundingBox();
    if (!pill || !ring) {
        throw new Error("Pille oder Ring fehlt");
    }
    expect(pill.width).toBeCloseTo(ring.width, 0);
    expect(pill.x).toBeCloseTo(ring.x, 0);
    expect(ring.y, "überlappt").toBeLessThan(pill.y + pill.height);
    // Oben auf der Pille, mitten über dem Überlapp, trifft ein Klick den Ring, nicht die Pille.
    const onTop = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="camera-ring"]') !== null,
        { x: ring.x + ring.width / 2, y: pill.y + pill.height - 2 },
    );
    expect(onTop).toBe(true);
});

test("flach stehen Drehpfeile im Ring, geneigt die Winkel ‹ › (Betreiber 2026-09-26)", async ({ page }) => {
    const left = page.getByTestId("camera-rotate-left");
    const right = page.getByTestId("camera-rotate-right");
    await expect(left.locator("svg.camera-ring__turn")).toBeVisible();
    await expect(right.locator("svg.camera-ring__turn")).toBeVisible();

    await page.getByTestId("camera-view-3d").click();
    await settled(page);
    await expect(left).toHaveText("‹");
    await expect(right).toHaveText("›");
    await expect(left.locator("svg")).toHaveCount(0);

    // Dieselbe Wirkung in beiden Ansichten.
    await clickZone(page, "right");
    expect((await settled(page)).bearing).toBeCloseTo(45, 1);
});

test("im Überblick kippt die Pille nur bis zur Grenze nach Zoom (D3)", async ({ page }) => {
    await showCamera(page, { point: { x: 512, y: 512 }, zoom: 3.5 });
    await page.getByTestId("camera-view-3d").click();
    expect((await settled(page)).pitch).toBeCloseTo(37.5, 1);
});

test("⭐ der Hinweis steht beim ersten Besuch da und kommt nach dem Schließen nicht wieder (Betreiber 2026-09-26)", async ({
    page,
}) => {
    await expect(page.getByTestId("camera-hint")).toBeVisible();
    await expect(page.getByTestId("camera-hint")).toContainText("2D | 3D");
    // Das Umschalten schließt ihn nicht: er bleibt, bis man ihn schließt.
    await page.getByTestId("camera-view-3d").click();
    await expect(page.getByTestId("camera-hint")).toBeVisible();
    await page.getByTestId("camera-hint-close").click();
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);

    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("camera-view")).toBeVisible();
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);
});

test("🔴 bei „Bewegung reduzieren“ springt die Kamera, statt zu fahren", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("camera-view-3d").click();
    // Ohne Fahrt steht die Neigung sofort, nicht erst nach 500 ms.
    await page.waitForTimeout(50);
    expect((await readCamera(page)).pitch).toBeCloseTo(45, 1);
});

test("🔴 beim Überfahren bleiben Pille, Suche und Fächer deckend - die Karte scheint nicht durch", async ({ page }) => {
    for (const testId of ["search-open", "fan-toggle"]) {
        const button = page.getByTestId(testId);
        await button.hover();
        const colour = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(colour, `${testId}: ${colour}`).toMatch(/^rgb\(/);
    }
    // Die Hoverwäsche der Pille ist durchscheinend, liegt aber auf der deckenden Hülle.
    await page.getByTestId("camera-view-3d").hover();
    const shell = await page
        .getByTestId("camera-view")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(shell, `Hülle: ${shell}`).toMatch(/^rgb\(/);
});

test("🔴 die Spitzen der Kompassnadel stehen 1 px vom Rand der Scheibe, auch gedreht und geneigt (Betreiber 2026-09-23, 2026-09-26)", async ({
    page,
}) => {
    await openMap(page);
    expect(await needleGap(page), "Norden oben").toBeCloseTo(1, 0);
    await showCamera(page, { point: GARETH, zoom: 5.5, bearing: 40 });
    expect(await needleGap(page), "gedreht").toBeCloseTo(1, 0);
    // Geneigt nicht gestaucht: dieselbe Größe wie flach (WI-0040, P7).
    await showCamera(page, { point: GARETH, zoom: 5.5, bearing: 40, pitch: 45 });
    await expect(page.locator(".camera-ring--tilted")).toHaveCount(1);
    expect(await needleGap(page), "geneigt").toBeCloseTo(1, 0);
});
