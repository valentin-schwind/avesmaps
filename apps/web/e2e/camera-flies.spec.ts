import { expect, test, type Page } from "@playwright/test";
import { GARETH, showPlace } from "./map-handle.ts";

/**
 * Die Kamera springt nie (Betreiber 2026-09-29, Design Guide §17): „was mich aber stört ist, dass die kamera
 * gleich ans ziel springt wenn ich auf play drück … die kamera muss immer ans ziel ‚fliegen‘.“ Und: Das Abspielen
 * wartet, bis die Kamera am Ziel ist.
 *
 * Gemessen wird in jedem Bild nach dem Druck: wo die Mitte steht, wo der Pfeil im Bild liegt und was die Leiste
 * zeigt. Ein Sprung wäre EIN Bild, in dem der Pfeil schon in der Mitte steht; ein Flug sind mehrere davor.
 */

interface Frame {
    /** Millisekunden seit dem Druck. */
    time: number;
    lng: number;
    lat: number;
    zoom: number;
    /** Wie weit der gezeichnete Pfeil von der Mitte der sichtbaren Fläche steht, in Bildpunkten; `null`, wo keiner gezeichnet ist. */
    offCentre: number | null;
    /** Was die Leiste zeigt: solange die Uhr steht, „0,0 Meilen“. */
    miles: string;
}

async function openRoute(page: Page): Promise<void> {
    await page.goto("/?route=Greifenfurt~Lowangen");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-player")).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
}

/** Einen Knopf der Leiste drücken (▶ vorgegeben) und die Kamera Bild für Bild aufzeichnen, `duration` Millisekunden lang. */
function pressAndRecord(page: Page, duration: number, button = "player-play"): Promise<Frame[]> {
    return page.evaluate(
        ([span, testid]) =>
            new Promise<Frame[]>((resolve) => {
                const map = globalThis.avesmapsMap!;
                const traveler = (
                    globalThis as unknown as { avesmapsTraveler?: { drawn(): { x: number; y: number } | null } }
                ).avesmapsTraveler;
                const press = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
                const miles = document.querySelector<HTMLElement>('[data-testid="player-miles"]')!;
                const canvas = map.getCanvas();
                const seen: Frame[] = [];
                let start: number | undefined;
                press.click();
                const frame = (time: number): void => {
                    start ??= time;
                    const padding = globalThis.avesmapsVisibleArea!.insets();
                    const left = padding["left"] ?? 0;
                    const right = padding["right"] ?? 0;
                    const top = padding["top"] ?? 0;
                    const bottom = padding["bottom"] ?? 0;
                    const centre = {
                        x: left + (canvas.clientWidth - left - right) / 2,
                        y: top + (canvas.clientHeight - top - bottom) / 2,
                    };
                    const arrow = traveler?.drawn() ?? null;
                    const { lng, lat } = map.getCenter();
                    seen.push({
                        time: time - start,
                        lng,
                        lat,
                        zoom: map.getZoom(),
                        offCentre: arrow ? Math.hypot(arrow.x - centre.x, arrow.y - centre.y) : null,
                        miles: miles.textContent?.trim() ?? "",
                    });
                    if (time - start < span) requestAnimationFrame(frame);
                    else resolve(seen);
                };
                requestAnimationFrame(frame);
            }),
        [duration, button] as const,
    );
}

/** Das erste Bild, in dem der Pfeil in der Mitte steht: Die Kamera ist angekommen. */
const arrival = (frames: readonly Frame[]): number =>
    frames.findIndex((frame) => frame.offCentre !== null && frame.offCentre < 3);

/** Wie weit zwei Mitten auseinanderliegen, in Zoomstufen-Einheiten des Welt-Mercators (nur zum Vergleichen). */
function apart(a: Frame, b: Frame): number {
    const world = (frame: Frame): { x: number; y: number } => {
        const lat = (frame.lat * Math.PI) / 180;
        return { x: frame.lng / 360, y: Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI) };
    };
    const p = world(a);
    const q = world(b);
    return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Wo die Kamera stand, ehe der Knopf gedrückt wurde. */
async function centreNow(page: Page): Promise<Frame> {
    const view = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return { ...map.getCenter(), zoom: map.getZoom() };
    });
    return { time: 0, lng: view.lng, lat: view.lat, zoom: view.zoom, offCentre: null, miles: "" };
}

/**
 * Ein Flug, kein Sprung: Bis der Pfeil in der Mitte steht, vergehen mehrere Bilder, das erste steht noch weit
 * vom Ziel, jedes nähert sich, und keines macht mehr als den halben Weg. Gibt das Bild der Ankunft zurück.
 */
function expectFlight(frames: readonly Frame[], before: Frame): number {
    const arrived = arrival(frames);
    expect(arrived, "die Kamera kommt an: Der Pfeil steht irgendwann in der Mitte").toBeGreaterThan(0);
    // Ein Flug sind mehrere Bilder, kein einziges, in dem die Kamera schon am Ziel steht.
    expect(arrived, `Bilder bis zur Ankunft: ${String(arrived)}`).toBeGreaterThanOrEqual(4);
    const target = frames[arrived] as Frame;
    const whole = apart(before, target);
    expect(whole, "Start und Ziel liegen weit auseinander (sonst prüft der Test nichts)").toBeGreaterThan(0.02);
    // Schon im ersten Bild nach dem Druck ist die Kamera nicht dort.
    expect(apart(frames[0] as Frame, target) / whole, "erstes Bild: noch weit vom Ziel").toBeGreaterThan(0.5);
    // Und sie nähert sich: kein Bild weiter vom Ziel als das vorige (bis auf Messrauschen).
    const distances = frames.slice(0, arrived + 1).map((frame) => apart(frame, target));
    distances.slice(1).forEach((distance, index) => {
        expect(distance, `Bild ${String(index + 1)}`).toBeLessThanOrEqual((distances[index] as number) + whole * 0.02);
    });
    // Kein Bild macht mehr als den halben Weg auf einmal.
    const biggest = Math.max(...distances.slice(1).map((distance, index) => (distances[index] as number) - distance));
    expect(biggest / whole, "größter Schritt eines Bildes").toBeLessThan(0.5);
    return arrived;
}

test("🔴 ▶ fliegt zum Start, statt dorthin zu springen; die Uhr läuft erst nach der Ankunft", async ({ page }) => {
    test.setTimeout(90_000);
    await openRoute(page);
    // Weit weg vom Start: Gareth liegt eine gute Strecke von Greifenfurt, und der Zoom ist ein anderer.
    await showPlace(page, GARETH, 4);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const before = await centreNow(page);

    const frames = await pressAndRecord(page, 4500);
    const arrived = expectFlight(frames, before);

    // Solange die Kamera fliegt, steht die Uhr: Die Leiste zeigt noch nichts gefahren.
    for (const frame of frames.slice(0, arrived)) expect(frame.miles).toBe("0,0 Meilen");
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    // Danach läuft sie.
    await expect(page.getByTestId("player-miles")).not.toHaveText("0,0 Meilen", { timeout: 15_000 });
});

test("🔴 ▶| fliegt ans Ende der Reise, statt dorthin zu springen", async ({ page }) => {
    test.setTimeout(90_000);
    await openRoute(page);
    await page.getByTestId("player-play").click();
    await expect(page.getByTestId("player-miles")).not.toHaveText("0,0 Meilen", { timeout: 20_000 });
    const before = await centreNow(page);
    const frames = await pressAndRecord(page, 5000, "player-end");
    expectFlight(frames, before);
    // Das Ende ist erreicht, und die Wiedergabe steht dort.
    await expect(page.getByTestId("player-track")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "false");
});

test("Bricht man den Flug ab, beginnt das Abspielen nicht", async ({ page }) => {
    test.setTimeout(90_000);
    await openRoute(page);
    await showPlace(page, GARETH, 4);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    await page.getByTestId("player-play").click();
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    // Mitten im Flug: ein Griff in die Karte.
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === true, undefined, { timeout: 5000 });
    const box = await page.getByTestId("map").boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + (box?.height ?? 0) * 0.5);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.7, (box?.y ?? 0) + (box?.height ?? 0) * 0.5, {
        steps: 4,
    });
    await page.mouse.up();
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("player-miles")).toHaveText("0,0 Meilen");
});

test("mit „Bewegung reduzieren“ springt die Kamera zum Start, und die Uhr läuft gleich", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openRoute(page);
    await showPlace(page, GARETH, 4);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const frames = await pressAndRecord(page, 1500);
    // Der Sprung ist hier richtig (Guide §29.1): Spätestens im dritten Bild steht der Pfeil in der Mitte.
    const arrived = arrival(frames);
    expect(arrived, "die Kamera steht am Start").toBeGreaterThanOrEqual(0);
    expect(arrived).toBeLessThanOrEqual(2);
});
