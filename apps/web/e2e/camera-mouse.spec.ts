import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, readCamera, showCamera } from "./map-handle.ts";

/**
 * Drehen und Neigen mit der Maus (WI-0016, D1): Strg + Linksziehen und die Mitteltaste.
 *
 * 🔴 Die rechte Maustaste bewegt die Kamera nie - sie gehört dem Kontextmenü. Genau das prüft der
 * dritte Test, und er ist der wichtigste: ein verwackelter Rechtsklick darf die Karte nicht drehen.
 */

async function mapCentre(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    if (!box) {
        throw new Error("map element has no box");
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(
    page: Page,
    by: { dx: number; dy: number },
    options: { button?: "left" | "middle" | "right"; ctrl?: boolean; steps?: number } = {},
): Promise<void> {
    const start = await mapCentre(page);
    await page.mouse.move(start.x, start.y);
    if (options.ctrl) {
        await page.keyboard.down("Control");
    }
    await page.mouse.down({ button: options.button ?? "left" });
    await page.mouse.move(start.x + by.dx, start.y + by.dy, { steps: options.steps ?? 10 });
    await page.mouse.up({ button: options.button ?? "left" });
    if (options.ctrl) {
        await page.keyboard.up("Control");
    }
}

/** Ab jetzt die Klicks der Karte zählen: Nur sie lassen Orte und Wege wählen (`interaction/coordinator.ts`). */
async function countMapClicks(page: Page): Promise<() => Promise<number>> {
    await page.evaluate(() => {
        const halter = globalThis as unknown as { kartenKlicks: number };
        halter.kartenKlicks = 0;
        globalThis.avesmapsMap?.on("click", () => {
            halter.kartenKlicks += 1;
        });
    });
    return () => page.evaluate(() => (globalThis as unknown as { kartenKlicks: number }).kartenKlicks);
}

test.beforeEach(async ({ page }) => {
    await openMap(page);
    await showCamera(page, { point: GARETH, zoom: 5.5 });
});

test("🔴 Strg + Ziehen löst beim Loslassen keinen Klick aus, langsam wie schnell", async ({ page }) => {
    const clicks = await countMapClicks(page);
    await drag(page, { dx: 0, dy: -200 }, { ctrl: true, steps: 40 });
    await drag(page, { dx: 0, dy: 200 }, { ctrl: true, steps: 1 });
    expect(await clicks(), "die Kamerageste wählt nichts aus").toBe(0);

    // Der Riegel gilt nur für den Klick dieses Loslassens, nicht für den nächsten echten.
    const centre = await mapCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(clicks).toBe(1);
});

test("🔴 die Mitteltaste löst beim Loslassen keinen Klick aus", async ({ page }) => {
    const clicks = await countMapClicks(page);
    await drag(page, { dx: 0, dy: -200 }, { button: "middle" });
    expect(await clicks()).toBe(0);
});

test("🔴 Strg + Klick bleibt ein Klick, auch verwackelt (die Geometrie-Modi setzen damit Punkte)", async ({ page }) => {
    const clicks = await countMapClicks(page);
    const centre = await mapCentre(page);
    await page.keyboard.down("Control");
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up("Control");
    await expect.poll(clicks).toBe(1);

    await drag(page, { dx: 2, dy: 0 }, { ctrl: true });
    await expect.poll(clicks, "2 px liegen unter MapLibres clickTolerance von 3 px").toBe(2);
});

test("🔴 die höhere Klicktoleranz der Zeichenmodi gilt auch für Strg + Klick", async ({ page }) => {
    const clicks = await countMapClicks(page);
    await drag(page, { dx: 6, dy: 0 }, { ctrl: true });
    expect(await clicks(), "ohne Zeichenmodus sind 6 px ein Zug").toBe(0);

    // Wie `hebeKlicktoleranz`, das die Anlegen-Modi beim Start rufen.
    await page.evaluate(() => {
        const karte = globalThis.avesmapsMap as unknown as {
            _handlers: { _handlersById: { mapEvent: { _clickTolerance: number } } };
        };
        karte._handlers._handlersById.mapEvent._clickTolerance = 12;
    });
    await drag(page, { dx: 6, dy: 0 }, { ctrl: true });
    await expect.poll(clicks, "ein verwackelter Klick setzt den Punkt").toBe(1);
});

test("Strg + Linksziehen dreht waagerecht und neigt senkrecht", async ({ page }) => {
    await drag(page, { dx: 100, dy: 0 }, { ctrl: true });
    const turned = await readCamera(page);
    expect(turned.bearing).toBeCloseTo(80, 0);
    expect(turned.pitch).toBeCloseTo(0, 1);

    await drag(page, { dx: 0, dy: -60 }, { ctrl: true });
    const tilted = await readCamera(page);
    expect(tilted.pitch, "nach oben ziehen = stärker geneigt").toBeCloseTo(30, 0);
    expect(tilted.bearing, "senkrecht ziehen dreht nicht").toBeCloseTo(80, 0);
});

test("Ziehen mit der Mitteltaste tut dasselbe, mit einer Hand", async ({ page }) => {
    await drag(page, { dx: -50, dy: -40 }, { button: "middle" });
    const camera = await readCamera(page);
    expect(camera.bearing).toBeCloseTo(-40, 0);
    expect(camera.pitch).toBeCloseTo(20, 0);
});

test("🔴 die rechte Maustaste bewegt die Kamera nie", async ({ page }) => {
    await drag(page, { dx: 120, dy: -80 }, { button: "right" });
    const camera = await readCamera(page);
    expect(camera.bearing).toBeCloseTo(0, 3);
    expect(camera.pitch).toBeCloseTo(0, 3);
});

test("Linksziehen ohne Strg verschiebt nur", async ({ page }) => {
    await drag(page, { dx: 120, dy: -80 });
    const camera = await readCamera(page);
    expect(camera.bearing).toBeCloseTo(0, 3);
    expect(camera.pitch).toBeCloseTo(0, 3);
});

test("unter 7° rastet die Drehung auf Norden ein", async ({ page }) => {
    await drag(page, { dx: 6, dy: 0 }, { ctrl: true });
    await expect.poll(async () => (await readCamera(page)).bearing).toBeCloseTo(0, 3);
});

test("🔴 im Überblick ist die Neigung auf 30° begrenzt (D3)", async ({ page }) => {
    await showCamera(page, { point: { x: 512, y: 512 }, zoom: 3 });
    await drag(page, { dx: 0, dy: -200 }, { ctrl: true });
    expect((await readCamera(page)).pitch).toBeLessThanOrEqual(30.001);
});

test("🔴 wer mit starker Neigung herauszoomt, wird sanft flacher gestellt", async ({ page }) => {
    await showCamera(page, { point: GARETH, zoom: 5.5, pitch: 60 });
    expect((await readCamera(page)).pitch).toBeCloseTo(60, 1);
    // Das Mausrad ist echte Nutzereingabe: die Grenze greift in jedem Schritt, nicht erst am Ende.
    const centre = await mapCentre(page);
    await page.mouse.move(centre.x, centre.y);
    let camera = await readCamera(page);
    for (let step = 0; step < 60 && camera.zoom > 3; step += 1) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(60);
        camera = await readCamera(page);
        expect(camera.pitch, `bei Zoom ${camera.zoom.toFixed(2)}`).toBeLessThanOrEqual(maxPitchAt(camera.zoom) + 0.5);
    }
    expect(camera.zoom).toBeLessThanOrEqual(3);
    expect(camera.pitch).toBeLessThanOrEqual(30.001);
});

test("🔴 Hineinzoomen an der Grenze kippt um den Zeiger: der Ort darunter bleibt stehen (Betreiber 2026-11-09)", async ({
    page,
}) => {
    // „das zoomtarget bleibt und verschiebt sich nicht immer weiter vor“: Vorher wanderte er bis Zoom 7 rund 140 Bildpunkte nach oben.
    // Auf der Kurve (Vorgabe der Zoomkurve: 35° bei Zoom 4), damit das Zoomen mitkippt.
    await showCamera(page, { point: GARETH, zoom: 4, pitch: 35 });
    const rahmen = await page.evaluate(() => {
        const r = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    // Auf ganze Bildpunkte: Die Maus steht dort, und ein Bruchteil Zielfehler wüchse mit jeder Zoomstufe mit.
    const imBild = { x: Math.round(rahmen.width * 0.62), y: Math.round(rahmen.height * 0.6) };
    await page.mouse.move(rahmen.x + imBild.x, rahmen.y + imBild.y);
    const ort = await page.evaluate(({ x, y }) => {
        const { lng, lat } = globalThis.avesmapsMap!.unproject([x, y]);
        return { lng, lat };
    }, imBild);
    let camera = await readCamera(page);
    for (let step = 0; step < 90 && camera.zoom < 9; step += 1) {
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(80);
        camera = await readCamera(page);
    }
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving())).toBe(false);
    camera = await readCamera(page);
    expect(camera.pitch, "die Neigung ist mit der Kurve gekippt").toBeGreaterThan(70);
    const jetzt = await page.evaluate((o) => {
        const { x, y } = globalThis.avesmapsMap!.project(o);
        return { x, y };
    }, ort);
    expect(Math.hypot(jetzt.x - imBild.x, jetzt.y - imBild.y), "Abstand zum Zeiger in Bildpunkten").toBeLessThan(8);
});

/** Dieselbe Grenze wie `maxPitchForZoom` - hier ausgeschrieben, damit der Test sie nicht nur nachplappert. */
function maxPitchAt(zoom: number): number {
    if (zoom <= 3) {
        return 30;
    }
    if (zoom >= 7) {
        return 80;
    }
    // 15° je Stufe, ab Zoom 6 nur noch 5° bis an den Anschlag von 80°.
    if (zoom <= 6) {
        return 30 + (zoom - 3) * 15;
    }
    return 75 + (zoom - 6) * 5;
}
