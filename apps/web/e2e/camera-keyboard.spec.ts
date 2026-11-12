import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, readCamera, showCamera } from "./map-handle.ts";

/**
 * Die Tastatur der Karte (WI-0016, D4): W A S D wie die Pfeiltasten, mit Umschalt drehen und neigen.
 *
 * ⭐ Die Tasten wirken ab dem Laden, ohne erst in die Karte zu klicken (Legacy-Regel) - deshalb
 * klickt kein Test hier vorher auf die Karte.
 */

async function settled(page: Page): Promise<{ bearing: number; pitch: number; zoom: number }> {
    await page.waitForTimeout(50);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    return readCamera(page);
}

async function centre(page: Page): Promise<{ lng: number; lat: number }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        return map.getCenter();
    });
}

test.beforeEach(async ({ page }) => {
    await openMap(page);
    await showCamera(page, { point: GARETH, zoom: 5.5 });
});

test("🔴 Umschalt + A / D drehen, Umschalt + W / S neigen - wie Umschalt + Pfeile", async ({ page }) => {
    await page.keyboard.press("Shift+KeyA");
    expect((await settled(page)).bearing).toBeCloseTo(-15, 1);
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    expect((await settled(page)).bearing).toBeCloseTo(15, 1);

    await page.keyboard.press("Shift+KeyW");
    expect((await settled(page)).pitch).toBeCloseTo(10, 1);
    await page.keyboard.press("Shift+ArrowUp");
    expect((await settled(page)).pitch).toBeCloseTo(20, 1);
    await page.keyboard.press("Shift+KeyS");
    expect((await settled(page)).pitch).toBeCloseTo(10, 1);
});

test("🔴 Q und E drehen wie Umschalt + ← → (D13, Betreiber 2026-09-24)", async ({ page }) => {
    await page.keyboard.press("KeyQ");
    expect((await settled(page)).bearing).toBeCloseTo(-15, 1);
    await page.keyboard.press("KeyE");
    await page.keyboard.press("KeyE");
    expect((await settled(page)).bearing).toBeCloseTo(15, 1);
    // Geneigt wird dabei nichts.
    expect((await settled(page)).pitch).toBeCloseTo(0, 1);
});

test("W A S D und die Pfeiltasten verschieben, ohne zu drehen", async ({ page }) => {
    const before = await centre(page);
    await page.keyboard.press("KeyD");
    await settled(page);
    await page.keyboard.press("ArrowUp");
    const after = await settled(page);
    const moved = await centre(page);
    expect(moved.lng).toBeGreaterThan(before.lng);
    expect(moved.lat).toBeGreaterThan(before.lat);
    expect(after.bearing).toBeCloseTo(0, 3);
    expect(after.pitch).toBeCloseTo(0, 3);
});

test("0 stellt alles gerade: Norden oben und flach", async ({ page }) => {
    await showCamera(page, { point: GARETH, zoom: 5.5, bearing: 120, pitch: 40 });
    await page.keyboard.press("Digit0");
    const camera = await settled(page);
    expect(camera.bearing).toBeCloseTo(0, 1);
    expect(camera.pitch).toBeCloseTo(0, 1);
});

test("+ und − zoomen je eine Stufe", async ({ page }) => {
    await page.keyboard.press("+");
    expect((await settled(page)).zoom).toBeCloseTo(6.5, 2);
    await page.keyboard.press("-");
    expect((await settled(page)).zoom).toBeCloseTo(5.5, 2);
});

test("? öffnet die Hinweise bei der Bedienung", async ({ page }) => {
    await page.keyboard.press("Shift+?");
    await expect(page.getByTestId("notes")).toBeVisible();
    await expect(page.getByTestId("notes-controls")).toBeInViewport();
    // Solange das Fenster offen ist, bewegt keine Taste die Karte.
    await page.keyboard.press("Shift+KeyA");
    expect((await settled(page)).bearing).toBeCloseTo(0, 3);
});

test("🔴 „Tastenkürzel aus“ schaltet Buchstaben ab, die Pfeiltasten wirken weiter", async ({ page }) => {
    await page.getByTestId("notes-open").click();
    // „Bedienung“ ist zugeklappt wie in Legacy (WI-0045 Stufe B): erst aufklappen.
    await page.getByTestId("notes-controls").locator("summary").click();
    await page.getByTestId("shortcuts-off").check();
    await page.getByTestId("notes").getByTestId("fenster-schliessen").click();

    await page.keyboard.press("Shift+KeyA");
    expect((await settled(page)).bearing).toBeCloseTo(0, 3);
    await page.keyboard.press("Shift+ArrowLeft");
    expect((await settled(page)).bearing).toBeCloseTo(-15, 1);

    // Die Einstellung gehört der Person und übersteht das Neuladen.
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.keyboard.press("f");
    await expect(page.getByTestId("search")).toHaveCount(0);
});

test("die Leertaste auf einem fokussierten Knopf löst den Knopf aus, nicht die Suche", async ({ page }) => {
    await page.getByTestId("camera-view-3d").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("search")).toHaveCount(0);
    expect((await settled(page)).pitch).toBeCloseTo(45, 1);
});

test("🔴 der Tastaturfokus auf der Karte ist gold wie an jedem Bedienelement (AC14)", async ({ page }) => {
    // Die Karte steht im Dokument vorn: sie ist das erste Ziel der Tabulatortaste.
    await page.keyboard.press("Tab");
    const canvas = page.locator("canvas.maplibregl-canvas");
    await expect(canvas).toBeFocused();
    const { outline, accent } = await canvas.evaluate((element) => ({
        outline: `${getComputedStyle(element).outlineStyle} ${getComputedStyle(element).outlineColor}`,
        // Das Gold der Bedienelemente, vom Browser in dieselbe Schreibweise gerechnet.
        accent: (() => {
            const probe = document.createElement("span");
            probe.style.color = "var(--color-accent)";
            document.body.append(probe);
            const colour = getComputedStyle(probe).color;
            probe.remove();
            return colour;
        })(),
    }));
    expect(outline).toBe(`solid ${accent}`);
});
