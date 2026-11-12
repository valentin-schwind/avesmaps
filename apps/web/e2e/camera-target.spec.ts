import { expect, test, type Page } from "@playwright/test";
import { GARETH, readCamera, showCamera } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Das Kameramodell nach Absicht am Rechner (WI-0039, Betreiber 2026-09-26): Ein Ziel landet in der
 * Mitte der SICHTBAREN Kartenfläche - bei offenem Planer rechts daneben -, ein Ort zoomt nie heraus,
 * und Suche und Planer nehmen dieselbe Regel. Das Telefon prüft `camera-target.touch.spec.ts`.
 */

/** Felden (Gareth), ein Dorf: Es erscheint spät, seine Mindestnähe ist Zoom 7. */
const FELDEN = { name: "Felden (Gareth)", x: 553.928, y: 528.102 };
/** Weit weg von Gareth, im Westen. */
const WEST = { x: 250, y: 450 };

async function openApp(page: Page, path = "/"): Promise<void> {
    await page.goto(path);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    // Die sichtbare Fläche steht, sobald der Planer gemessen ist.
    await expect.poll(() => insets(page)).toMatchObject({ left: 350 });
}

async function insets(page: Page): Promise<{ top: number; right: number; bottom: number; left: number }> {
    return page.evaluate(() => {
        const padding = globalThis.avesmapsVisibleArea!.insets();
        return {
            top: padding.top ?? 0,
            right: padding.right ?? 0,
            bottom: padding.bottom ?? 0,
            left: padding.left ?? 0,
        };
    });
}

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
}

/** Wo ein Kartenpunkt gerade auf dem Bildschirm steht. */
async function onScreen(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((target) => {
        const map = globalThis.avesmapsMap!;
        return map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target));
    }, point);
}

/** Die Mitte der sichtbaren Fläche, aus der Canvasgröße und dem Rand der Karte. */
async function visibleCentre(page: Page): Promise<{ x: number; y: number }> {
    const canvas = await page.evaluate(() => {
        const element = globalThis.avesmapsMap!.getCanvas();
        return { width: element.clientWidth, height: element.clientHeight };
    });
    const rim = await insets(page);
    return {
        x: rim.left + (canvas.width - rim.left - rim.right) / 2,
        y: rim.top + (canvas.height - rim.top - rim.bottom) / 2,
    };
}

async function expectCentred(page: Page, point: { x: number; y: number }, tolerance = 2): Promise<void> {
    const at = await onScreen(page, point);
    const centre = await visibleCentre(page);
    expect(Math.abs(at.x - centre.x), `waagerecht: ${at.x} statt ${centre.x}`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(at.y - centre.y), `senkrecht: ${at.y} statt ${centre.y}`).toBeLessThanOrEqual(tolerance);
}

async function search(page: Page, name: string): Promise<void> {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(name);
    await expect(page.getByTestId("search-hit").first()).toContainText(name);
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();
}

test("🔴 Suche: der Ort landet in der Mitte der freien Fläche rechts vom Planer, flach und geneigt", async ({
    page,
}) => {
    await openApp(page);
    await showCamera(page, { point: WEST, zoom: 3 });
    await search(page, "Gareth");
    await settled(page);
    await expectCentred(page, GARETH);
    // Der Treffer ist gewählt, also steht das Infopanel (400 px, WI-0063) rechts: Die freie Fläche liegt zwischen
    // Planer (350 px) und Panel, ihre Mitte bei (350 + 880) / 2.
    expect((await visibleCentre(page)).x, "zwischen Planer und Infopanel, nicht in der Canvasmitte").toBe(615);
    // Aus weiter Ferne auf die Mindestnähe einer Metropole: Zoom 5.
    expect((await readCamera(page)).zoom).toBeCloseTo(5, 2);

    await showCamera(page, { point: WEST, zoom: 3, bearing: 30, pitch: 30 });
    await search(page, "Gareth");
    await settled(page);
    await expectCentred(page, GARETH);
    const tilted = await readCamera(page);
    expect(tilted.bearing).toBeCloseTo(30, 1);
    expect(tilted.pitch).toBeCloseTo(30, 1);
});

test("🔴 ein Ortsflug zoomt nie heraus: Gareth auf Zoom 7 bleibt Zoom 7", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: { x: 700, y: 560 }, zoom: 7 });
    await search(page, "Gareth");
    await settled(page);
    await expectCentred(page, GARETH);
    expect((await readCamera(page)).zoom).toBeCloseTo(7, 2);
});

test("🔴 Suche und Planer: derselbe Ort, dieselbe Regel (ein Dorf auf Zoom 7)", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: WEST, zoom: 3 });
    await search(page, FELDEN.name);
    await settled(page);
    await expectCentred(page, FELDEN);
    const fromSearch = (await readCamera(page)).zoom;

    await showCamera(page, { point: WEST, zoom: 3 });
    const input = page.getByTestId("waypoint-input").first();
    await input.fill(FELDEN.name);
    await expect(page.getByTestId("waypoint-hits").first()).toContainText(FELDEN.name);
    await input.press("Enter");
    await expect(input).toHaveValue(FELDEN.name);
    await expect.poll(async () => (await readCamera(page)).zoom, { timeout: 5_000 }).toBeCloseTo(fromSearch, 2);
    await settled(page);
    await expectCentred(page, FELDEN);
    expect(fromSearch).toBeCloseTo(7, 2);
});

/**
 * Warten, bis die Kamera nach einem Objektlink angekommen ist.
 *
 * 🪤 Seit WI-0087 P2 öffnet ein Name in der Etappenliste seinen Gegenstand über `openSubject`, und die Kamera fliegt
 * zum Ziel der ANTWORT - also erst nach einer Frage an den Server. `settled` allein kehrte sofort zurück, weil der
 * Flug noch gar nicht begonnen hatte. Gewartet wird deshalb, bis sich die Mitte bewegt hat, und dann auf ihr Ende.
 */
async function flown(page: Page, before: number): Promise<void> {
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getCenter().lng), { timeout: 20_000 })
        .not.toBe(before);
    await settled(page);
}

const centreLng = (page: Page): Promise<number> => page.evaluate(() => globalThis.avesmapsMap!.getCenter().lng);

test("Ortsname in der Etappenliste: Punkt zeigen in der freien Fläche", async ({ page }) => {
    await openApp(page, "/?route=Gareth~Perricum");
    await showStages(page, 15_000);
    await settled(page);
    await showCamera(page, { point: WEST, zoom: 3 });
    // Genau „Gareth“: Seit Satz map154313 steht auf derselben Etappe auch „Gareth-St. Lechmin, Reichsstraße 3“.
    const vorGareth = await centreLng(page);
    await page
        .getByTestId("route-stage")
        .first()
        .locator(".stage-link", { hasText: /^Gareth$/ })
        .click();
    await flown(page, vorGareth);
    await expectCentred(page, GARETH);
    expect((await readCamera(page)).zoom).toBeCloseTo(5, 2);

    // Ein Ort unterwegs, kein Wegpunkt: Der Etappenpunkt trägt seine Klasse, ein Dorf kommt auf Zoom 7.
    // Welches Dorf auf der Route liegt, hängt am Legacy-Stand und an der Steigung: Rindsfurt bis Satz
    // map154313, Willendorf und Rabicum seit map155099. Das erste vorhandene zählt.
    await showCamera(page, { point: WEST, zoom: 3 });
    const dorf = page.locator(".stage-link", { hasText: /^(Rindsfurt|Willendorf|Rabicum)$/ }).first();
    await expect(dorf, "kein bekanntes Dorf auf Gareth → Perricum").toBeVisible();
    const vorDorf = await centreLng(page);
    await dorf.click();
    await flown(page, vorDorf);
    expect((await readCamera(page)).zoom).toBeCloseTo(7, 2);
});

test("„Nächster Ort“: Punkt zeigen, und wer näher ist, bleibt so nah", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: GARETH, zoom: 7.5 });
    const box = (await page.getByTestId("map").boundingBox())!;
    await page.mouse.click(box.x + 1000, box.y + 200, { button: "right" });
    await page.getByTestId("context-nearest").click();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedPlace?.()?.name ?? "")).not.toBe("");
    await settled(page);
    const place = (await page.evaluate(() => globalThis.avesmapsSelectedPlace?.()))!;
    await expectCentred(page, place);
    expect((await readCamera(page)).zoom).toBeCloseTo(7.5, 2);
});

test("🔴 ein Befehl während der Fahrt baut auf ihrem Ziel auf: „+“ im Suchflug", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: WEST, zoom: 3 });
    await search(page, "Gareth");
    expect(await page.evaluate(() => globalThis.avesmapsMap!.isMoving()), "der Flug läuft noch").toBe(true);
    await page.keyboard.press("+");
    await settled(page);
    await expectCentred(page, GARETH);
    expect((await readCamera(page)).zoom).toBeCloseTo(6, 2);
});

test("Ring zoomt um die sichtbare Mitte, das Mausrad weiter am Zeiger", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: GARETH, zoom: 5 });
    await expectCentred(page, GARETH);
    // Im Keil geklickt, wie ein Mensch - die Mitte des Knopfs deckt die Kompassscheibe.
    const ring = (await page.getByTestId("camera-ring").boundingBox())!;
    await page.getByTestId("camera-zoom-in").click({ position: { x: ring.width / 2, y: 12 } });
    await settled(page);
    await expectCentred(page, GARETH);
    expect((await readCamera(page)).zoom).toBeCloseTo(6, 2);

    // Das Rad: Was unter dem Zeiger liegt, bleibt unter dem Zeiger.
    const box = (await page.getByTestId("map").boundingBox())!;
    const pointer = { x: box.x + 1000, y: box.y + 200 };
    const under = await page.evaluate(
        ([x, y]) =>
            globalThis.avesmapsRenderProjection!.fromRenderLngLat(
                (
                    globalThis.avesmapsMap as unknown as {
                        unproject(p: [number, number]): { lng: number; lat: number };
                    }
                ).unproject([x, y]),
            ),
        [pointer.x - box.x, pointer.y - box.y] as [number, number],
    );
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.wheel(0, -240);
    // Das Rad zoomt über MapLibres Geste, einige Bilder später - erst warten, bis sie greift.
    await expect.poll(async () => (await readCamera(page)).zoom).toBeGreaterThan(6.2);
    await page.waitForTimeout(300);
    await settled(page);
    const after = await onScreen(page, under);
    expect(Math.abs(after.x - (pointer.x - box.x))).toBeLessThanOrEqual(3);
    expect(Math.abs(after.y - (pointer.y - box.y))).toBeLessThanOrEqual(3);
});

test("🔴 der Planer geht zu, die Karte bleibt stehen (E3) - danach zielt die Suche in die ganze Karte", async ({
    page,
}) => {
    await openApp(page);
    await showCamera(page, { point: GARETH, zoom: 5 });
    const before = await onScreen(page, GARETH);
    await page.getByTestId("route-planner-tab").click();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => insets(page)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const after = await onScreen(page, GARETH);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    await search(page, "Perricum");
    await settled(page);
    // Der Treffer ist gewählt: Das Infopanel (400 px) steht rechts, die freie Fläche reicht von 0 bis 880.
    expect((await visibleCentre(page)).x).toBe(440);
    const perricum = await page.evaluate(() => globalThis.avesmapsSelectedPlace?.());
    await expectCentred(page, perricum!);
});

test("🔴 ein Link öffnet seinen Ausschnitt in der freien Fläche, und Neuladen verschiebt nichts", async ({ page }) => {
    await openApp(page);
    const start = await page.evaluate(() => globalThis.location.hash);
    await showCamera(page, { point: GARETH, zoom: 6 });
    await expect.poll(() => page.evaluate(() => globalThis.location.hash)).not.toBe(start);
    const link = await page.evaluate(() => globalThis.location.hash);
    await openApp(page, `/${link}`);
    await settled(page);
    await expectCentred(page, GARETH, 3);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => globalThis.location.hash)).toBe(link);
});

test("„Bewegung reduzieren“: der Ortsflug springt", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await showCamera(page, { point: WEST, zoom: 3 });
    await search(page, "Gareth");
    expect(await page.evaluate(() => globalThis.avesmapsMap!.isMoving())).toBe(false);
    await expectCentred(page, GARETH);
});

test.describe("breiter Schirm (E4): der Planer ist eine Seitenleiste", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("🔴 die Mitte bleibt die Bildmitte, auch bei offenem Planer", async ({ page }) => {
        await page.goto("/");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
        await showCamera(page, { point: WEST, zoom: 3 });
        await search(page, "Gareth");
        await settled(page);
        expect(await insets(page)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        const at = await onScreen(page, GARETH);
        // Die Bildmitte der KARTE: Im Editor-Modus steht über ihr die Kopfleiste (WI-0120), die Seite ist höher als das Bild.
        const bild = await page.evaluate(() => {
            const canvas = globalThis.avesmapsMap!.getCanvas();
            return { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
        });
        expect(Math.abs(at.x - bild.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(at.y - bild.y)).toBeLessThanOrEqual(2);
    });

    test("🔴 eine Route wird trotzdem neben dem Planer eingepasst - nichts liegt darunter", async ({ page }) => {
        await page.goto("/?route=Gareth~Perricum");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await showStages(page, 15_000);
        await page.getByTestId("route-title").click();
        await settled(page);
        const panel = (await page.locator(".planner-stack").boundingBox())!;
        const gareth = await onScreen(page, GARETH);
        const perricum = await onScreen(page, { x: 631.28485, y: 507.28485 });
        expect(gareth.x, "Gareth rechts vom Planer").toBeGreaterThan(panel.x + panel.width);
        expect(perricum.x, "Perricum im Bild").toBeLessThan(1920);
    });
});
