import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { freeSpot, GARETH, needleGap, onCanvas, openMap, readCamera, showCamera } from "./map-handle.ts";

/**
 * Die Karte am Finger (WI-0016, AC3 und D5 in der Fassung vom 2026-09-23: kein Ring am Handy), im
 * Telefonprofil.
 *
 * 🪤 Playwright kennt nur EINEN Finger (`tap`). Zwei Finger gibt es über CDP als echte
 * Touch-Ereignisse; genau die liest MapLibre. Wie sich Nachlauf und Drehschwelle am echten Finger
 * anfühlen, prüft das nicht - das bleibt ein Messpunkt der Abnahme am Handy.
 */

type Point = { x: number; y: number };
/** Wo die Finger zum Zeitpunkt t ∈ [0, 1] liegen. */
type Path = (t: number) => Point[];

async function touch(client: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: Point[]) {
    await client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })),
    });
}

/** Legt die Finger auf, führt sie den Weg entlang und hebt sie ab. */
async function gesture(page: Page, client: CDPSession, path: Path, steps = 14): Promise<void> {
    await touch(client, "touchStart", path(0));
    for (let step = 1; step <= steps; step += 1) {
        await touch(client, "touchMove", path(step / steps));
        await page.waitForTimeout(16);
    }
    await touch(client, "touchEnd", []);
}

async function tap(client: CDPSession, points: Point[]): Promise<void> {
    await touch(client, "touchStart", points);
    await touch(client, "touchEnd", []);
}

async function settled(page: Page): Promise<{ bearing: number; pitch: number; zoom: number }> {
    await page.waitForTimeout(100);
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

/** Die Mitte der Karte, unterhalb des Infopanels und links der Knöpfe. */
function middle(page: Page): Point {
    const size = page.viewportSize();
    if (!size) {
        throw new Error("kein Fenster");
    }
    return { x: size.width / 2, y: size.height * 0.55 };
}

let client: CDPSession;

test.beforeEach(async ({ page }) => {
    await openMap(page);
    await showCamera(page, { point: GARETH, zoom: 5.5 });
    client = await page.context().newCDPSession(page);
});

test("🔴 ein Finger verschiebt, ohne zu drehen oder zu neigen", async ({ page }) => {
    const m = middle(page);
    const before = await centre(page);
    await gesture(page, client, (t) => [{ x: m.x - 60 * t, y: m.y - 120 * t }]);
    const camera = await settled(page);
    expect(camera.bearing).toBe(0);
    expect(camera.pitch).toBe(0);
    const after = await centre(page);
    expect(Math.hypot(after.lng - before.lng, after.lat - before.lat)).toBeGreaterThan(0);
});

test("zwei Finger auseinander zoomen hinein", async ({ page }) => {
    const m = middle(page);
    const spread = (t: number): number => 40 + 80 * t;
    await gesture(page, client, (t) => [
        { x: m.x - spread(t), y: m.y },
        { x: m.x + spread(t), y: m.y },
    ]);
    expect((await settled(page)).zoom).toBeGreaterThan(6.2);
});

test("🔴 zwei Finger im Kreis drehen die Karte, ohne sie zu neigen", async ({ page }) => {
    const m = middle(page);
    const radius = 90;
    const angle = (t: number): number => (50 * t * Math.PI) / 180;
    await gesture(page, client, (t) => [
        { x: m.x - radius * Math.cos(angle(t)), y: m.y - radius * Math.sin(angle(t)) },
        { x: m.x + radius * Math.cos(angle(t)), y: m.y + radius * Math.sin(angle(t)) },
    ]);
    const camera = await settled(page);
    // MapLibre verbraucht die ersten Grad als Schwelle; gedreht ist trotzdem deutlich.
    expect(Math.abs(camera.bearing)).toBeGreaterThan(20);
    expect(camera.pitch).toBe(0);
});

test("🔴 zwei Finger gemeinsam nach oben neigen die Karte", async ({ page }) => {
    const m = middle(page);
    await gesture(page, client, (t) => [
        { x: m.x - 70, y: m.y - 100 * t },
        { x: m.x + 70, y: m.y - 100 * t },
    ]);
    const camera = await settled(page);
    expect(camera.pitch).toBeGreaterThan(20);
    expect(camera.bearing).toBe(0);
});

test("Doppeltipp zoomt hinein, ein Tipp mit zwei Fingern heraus", async ({ page }) => {
    // 💣 Hier stand die Mitte der Karte. Seit WI-0090 ist ein Weg am Finger anklickbar, und dort läuft einer: Der ERSTE
    // Tipp wählte ihn, das Infopanel fuhr über die ganze Höhe des Telefons auf - und der zweite Tipp landete auf dem
    // Panel statt auf der Karte. Der Doppeltipp kam nie zustande, die Kamera blieb auf 5,5, und der Fall war dauerhaft
    // rot. Gemessen wird deshalb an einer Stelle, die weder ein Kartenobjekt noch ein Bedienelement trägt.
    // `freeSpot` sucht ab einem Punkt der KARTE; `middle` ist ein Punkt der Seite (im Editor-Modus steht darüber die Kopfleiste).
    const m = await freeSpot(page, await onCanvas(page, middle(page)));
    await tap(client, [m]);
    await page.waitForTimeout(60);
    await tap(client, [m]);
    expect((await settled(page)).zoom).toBeCloseTo(6.5, 1);

    await page.waitForTimeout(600);
    await tap(client, [
        { x: m.x - 50, y: m.y },
        { x: m.x + 50, y: m.y },
    ]);
    expect((await settled(page)).zoom).toBeCloseTo(5.5, 1);
});

test("Doppeltipp und Ziehen zoomt mit einem Finger", async ({ page }) => {
    // 💣 Dieselbe Falle wie oben, nur eine Zeile später übersehen: Hier stand die Mitte der Karte, und dort liegt seit
    // WI-0090 eine anklickbare Trefferfläche. Gemessen am 2026-10-07 im Telefonprofil (412 × 839): Unter der Mitte
    // (206 / 461,45) melden sechs Treffer in `path-hit-reichsstrasse` und `path-hit-strasse`; der ERSTE Tipp wählte
    // „Reichsstraße 2", das Infopanel fuhr über 388 × 839 px auf, und unter der Mitte lag danach `info-action-suggest`.
    // Das Ziehen erreichte die Karte nie, die Kamera blieb genau auf 5,5 - der Fall war mit dem Fehlbetrag 0 dauerhaft
    // rot. An einer freien Stelle (356 / 461,45) zoomt dieselbe Geste auf 6,4375, also 0,9375 Stufen.
    // `freeSpot` sucht ab einem Punkt der KARTE; `middle` ist ein Punkt der Seite (im Editor-Modus steht darüber die Kopfleiste).
    const m = await freeSpot(page, await onCanvas(page, middle(page)));
    await tap(client, [m]);
    await page.waitForTimeout(60);
    await gesture(page, client, (t) => [{ x: m.x, y: m.y + 120 * t }]);
    expect(Math.abs((await settled(page)).zoom - 5.5)).toBeGreaterThan(0.3);
});

test("🔴 am Telefon kein Steuerring: zwei Finger machen alles, der 3D-Knopf bleibt (Betreiber 2026-09-23)", async ({
    page,
}) => {
    await expect(page.getByTestId("camera-zoom-in")).toHaveCount(0);
    await expect(page.getByTestId("camera-rotate-left")).toHaveCount(0);
    // Genordet steht auch kein Kompass da: nichts, was man nicht braucht.
    await expect(page.getByTestId("camera-ring")).toHaveCount(0);

    const tilt = page.getByTestId("camera-tilt");
    await expect(tilt).toBeVisible();
    const box = await tilt.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
});

test("die Kachel des runden 3D-Knopfs kippt mit der Karte, bis 45°", async ({ page }) => {
    const angle = (): Promise<string> =>
        page
            .getByTestId("camera-tilt-glyph")
            .evaluate((glyph) => (glyph as SVGElement).style.getPropertyValue("--tilt-angle"));
    expect(await angle()).toBe("0.0deg");
    await showCamera(page, { point: GARETH, zoom: 5.5, pitch: 20 });
    await expect.poll(angle).toBe("20.0deg");
    await showCamera(page, { point: GARETH, zoom: 5.5, pitch: 60 });
    await expect.poll(angle).toBe("45.0deg");
});

test("gedreht erscheint der Kompass, ein Tipp stellt Norden nach oben", async ({ page }) => {
    await showCamera(page, { point: GARETH, zoom: 5.5, bearing: 40 });
    const compass = page.getByTestId("camera-north");
    await expect(compass).toBeVisible();
    const box = await compass.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await compass.tap();
    expect((await settled(page)).bearing).toBeCloseTo(0, 1);
    await expect(page.getByTestId("camera-ring")).toHaveCount(0);
});

test("🔴 der Schalter „Steuerring auch am Handy“ holt den Ring zurück, am Finger groß genug (D10)", async ({
    page,
}) => {
    await page.getByTestId("notes-open").tap();
    await page.getByTestId("notes-controls").locator("summary").tap();
    await page.getByTestId("ring-on-touch").tap();
    await page.getByTestId("notes").getByTestId("fenster-schliessen").tap();

    const ring = page.getByTestId("camera-ring");
    await expect(ring).toBeVisible();
    // Die Pille steht wieder über dem Ring, und auch sie ist ein Fingerziel (WI-0040).
    const pill = await page.getByTestId("camera-view").boundingBox();
    expect(pill?.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("camera-tilt")).toHaveCount(0);

    // Jede Zone trifft von der Mittelscheibe bis zum Rand: 44 px Tiefe am Finger.
    const box = await ring.boundingBox();
    if (!box) {
        throw new Error("Steuerring fehlt");
    }
    const hits = await page.evaluate(
        ({ cx, cy }) => {
            const zoneAt = (dx: number, dy: number): string | null =>
                document
                    .elementFromPoint(cx + dx, cy + dy)
                    ?.closest("[data-testid]")
                    ?.getAttribute("data-testid") ?? null;
            const inner = 26;
            const outer = 66;
            return {
                in: [zoneAt(0, -inner), zoneAt(0, -outer)],
                out: [zoneAt(0, inner), zoneAt(0, outer)],
                left: [zoneAt(-inner, 0), zoneAt(-outer, 0)],
                right: [zoneAt(inner, 0), zoneAt(outer, 0)],
            };
        },
        { cx: box.x + box.width / 2, cy: box.y + box.height / 2 },
    );
    expect(hits).toEqual({
        in: ["camera-zoom-in", "camera-zoom-in"],
        out: ["camera-zoom-out", "camera-zoom-out"],
        left: ["camera-rotate-left", "camera-rotate-left"],
        right: ["camera-rotate-right", "camera-rotate-right"],
    });

    // Die Wahl bleibt nach dem Neuladen.
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("camera-zoom-in")).toBeVisible();
});

test("🔴 auch am Finger stehen die Spitzen der Kompassnadel 1 px vom Rand, mit und ohne Ring", async ({ page }) => {
    await showCamera(page, { point: GARETH, zoom: 5.5, bearing: 40 });
    expect(await needleGap(page), "ohne Ring").toBeCloseTo(1, 0);

    await page.getByTestId("notes-open").tap();
    await page.getByTestId("notes-controls").locator("summary").tap();
    await page.getByTestId("ring-on-touch").tap();
    await page.getByTestId("notes").getByTestId("fenster-schliessen").tap();
    await expect(page.getByTestId("camera-ring")).toBeVisible();
    expect(await needleGap(page), "mit Ring").toBeCloseTo(1, 0);
});
