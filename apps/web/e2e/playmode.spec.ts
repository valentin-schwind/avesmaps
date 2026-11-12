import { expect, test, type Page } from "@playwright/test";
import { moveMap } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Der Playmode am echten Stack (WI-0031, Betreiber 2026-09-24): die Leiste unter dem Planer, der Pfeil
 * auf der Karte, die Kamera, die ihm folgt, und wer sie anhält.
 */

const SHOTS = process.env["PLAYMODE_SHOTS"];

/**
 * Flughöhe und Neigung der Reise: `FLIGHT_ZOOM` (`map/traveler-view.ts`) und `FLIGHT_PITCH` (`map/camera/camera-math.ts`). Betreiber
 * 2026-10-14 (`4d53f4167`, WI-0142): „kannst du noch den kameraflug bei play animation auf zoom 7 runtergehen lassen und die
 * neigung auf 65°“, dann „7,5 als ziel zoom mein ich“; 2026-10-18 (WI-0218): „kannst du die reisehöhe der zoomkamera beim playbutton
 * flug auf 8 setzen“. Davor 7 und 75° (Neigung seit 2026-09-27 „aufs maximum“, damals 60°).
 * Eine Spec importiert nichts aus `src` (die Module hängen an Browser-Zustand), darum stehen die Werte hier; ändert sich einer
 * dort, nennt der Fehler ihn als Erwartung - nicht „geneigt bis zum Anschlag“.
 */
const FLIGHT_ZOOM = 8;
const FLIGHT_PITCH = 65;

/**
 * Der Spielraum der Kamera (`spielraumPx`, `SPIELRAUM_SHARE` in `map/traveler-view.ts`): Seitlich darf der Pfeil so weit neben der Mitte laufen,
 * bevor die Kamera nachrückt. 80 Bildpunkte bei Zoom 7, darüber dieselbe Bodenstrecke (WI-0248 S2: auf der Flughöhe 8 also 160), höchstens
 * ein Fünftel der sichtbaren Breite. Vorn im Bild steht der Pfeil durch die Perspektive weiter außen (gemessen 93,7 px bei 80 px Spielraum);
 * die Grenze lässt dem wie bisher (110 zu 80) knapp 40 % Luft, sie ist also aus dem Spielraum abgeleitet, nicht fest.
 */
const SPIELRAUM_PX = 80 * 2 ** Math.max(0, FLIGHT_ZOOM - 7);
const SPIELRAUM_SHARE = 0.2;
const PERSPEKTIVE_GRENZE = 110 / 80;
/** Wie weit der Pfeil höchstens von der Mitte der sichtbaren Fläche entfernt stehen darf, in Bildpunkten. */
function pfeilAbstandMax(sichtbareBreite: number): number {
    return Math.min(SPIELRAUM_PX, sichtbareBreite * SPIELRAUM_SHARE) * PERSPEKTIVE_GRENZE;
}

async function openRoute(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showStages(page, 15_000);
    await expect(page.getByTestId("route-player")).toBeVisible();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
}

/**
 * Der Pfeil, wie ihn das letzte Bild gezeichnet hat, in Bildpunkten der Karte - oder null. Seine Ebene
 * (`traveler-layer.ts`) meldet, was sie zeichnet, nicht was ihr gemeldet wurde.
 */
async function arrowOnScreen(page: Page): Promise<{ x: number; y: number; heading: number } | null> {
    return page.evaluate(() => {
        const handle = globalThis as unknown as {
            avesmapsTraveler?: { drawn(): { x: number; y: number; heading: number } | null };
        };
        return handle.avesmapsTraveler?.drawn() ?? null;
    });
}

/**
 * Die Kamera und die sichtbare Kartenfläche (WI-0039): Am Rechner ist der Planer offen, die Mitte liegt
 * rechts von ihm - nicht in der Mitte des Canvas.
 */
async function camera(page: Page): Promise<{
    bearing: number;
    pitch: number;
    width: number;
    height: number;
    visible: { left: number; top: number; width: number; height: number };
}> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getBearing(): number;
            getPitch(): number;
            getCanvas(): HTMLCanvasElement;
        };
        const canvas = map.getCanvas();
        const { top, right, bottom, left } = globalThis.avesmapsVisibleArea!.insets();
        return {
            bearing: map.getBearing(),
            pitch: map.getPitch(),
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            visible: {
                left,
                top,
                width: canvas.clientWidth - left - right,
                height: canvas.clientHeight - top - bottom,
            },
        };
    });
}

test("🔴 Planer und Leiste halten oben und unten denselben Abstand zum Rand", async ({ page }) => {
    await openRoute(page);
    const stack = await page.locator(".planner-stack").boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    // Oben zählt der Rand der Anwendung: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
    const appTop = await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top);
    expect(stack).not.toBeNull();
    expect(Math.abs(stack!.y - appTop - (height - (stack!.y + stack!.height)))).toBeLessThanOrEqual(1);
    if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/playmode-leiste.png` });
        await page.getByTestId("player-next").click();
        await page.getByTestId("player-next").click();
        await page
            .getByTestId("route-player")
            .screenshot({ path: `${SHOTS}/playmode-leiste-nah.png`, scale: "device" });
    }
});

/** Die Mitten der Etappenpunkte und des Knopfs auf der Leiste, in Bildpunkten. */
async function trackMarks(page: Page): Promise<{ dots: number[]; knob: number }> {
    return page.getByTestId("route-player").evaluate((player) => {
        const centre = (element: Element): number => {
            const box = element.getBoundingClientRect();
            return box.left + box.width / 2;
        };
        const knob = player.querySelector(".player__knob");
        return {
            dots: [...player.querySelectorAll("[data-testid='player-dot']")].map(centre),
            knob: knob ? centre(knob) : Number.NaN,
        };
    });
}

test("🔴 Ein Punkt je Etappenanfang, zu enge werden einer, und ▶▶ landet auf dem ersten", async ({ page }) => {
    await openRoute(page);
    // Der erste Anfang liegt am Anfang der Leiste und braucht keinen Punkt (Betreiber 2026-09-24).
    const stages = await page.getByTestId("route-stage").count();
    const { dots } = await trackMarks(page);
    expect(dots.length).toBeGreaterThan(1);
    expect(dots.length).toBeLessThanOrEqual(stages - 1);
    // Ein Punkt misst 6 Bildpunkte, zwei stehen nie enger als 8 - sonst wird es eine Kette.
    dots.slice(1).forEach((dot, index) => {
        expect(dot - (dots[index] as number)).toBeGreaterThanOrEqual(7.5);
    });
    // Der erste Punkt ist der Anfang der zweiten Etappe: Genau dorthin springt ▶▶.
    await page.getByTestId("player-next").click();
    await expect.poll(async () => Math.abs((await trackMarks(page)).knob - (dots[0] as number))).toBeLessThanOrEqual(1);
});

test("🔴 ▶ spielt: der Pfeil fährt, die Kamera folgt von oben und dreht nicht", async ({ page }) => {
    await openRoute(page);
    const before = await camera(page);
    await expect(page.getByTestId("player-miles")).toHaveText("0,0 Meilen");
    await page.getByTestId("player-play").click();
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("player-miles")).not.toHaveText("0,0 Meilen");
    // 🔴 Gemessen wird BEIM FAHREN, in mehreren Bildern: Der Pfeil steht in der Mitte der sichtbaren Fläche
    // (rechts vom offenen Planer, WI-0039). Bis 2026-09-26 kam er über den Worker einer GeoJSON-Quelle und
    // hing auf Flughöhe rund 30 px, unter Last Hunderte hinter der Kamera; jetzt zeichnet ihn eine eigene
    // Ebene im selben Bild (`traveler-layer.ts`). Folgte die Kamera nicht, läge er weit draußen.
    expect((await camera(page)).visible.left, "der Planer ist offen").toBeGreaterThan(0);
    for (let sample = 0; sample < 6; sample += 1) {
        const arrow = await arrowOnScreen(page);
        const { visible } = await camera(page);
        expect(arrow, "der Pfeil ist gezeichnet").not.toBeNull();
        const offCentre = Math.hypot(
            arrow!.x - (visible.left + visible.width / 2),
            arrow!.y - (visible.top + visible.height / 2),
        );
        expect(offCentre, `Bild ${String(sample)}: ${offCentre.toFixed(1)} px neben der Mitte`).toBeLessThan(2);
        await page.waitForTimeout(150);
    }
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/playmode-2d.png` });
    await page.getByTestId("player-play").click();
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "false");
    // Und die Drehung bleibt, wie sie war.
    expect((await camera(page)).bearing).toBeCloseTo(before.bearing, 6);
});

test("▶▶ und ◀◀ springen von Etappe zu Etappe, |◀ und ▶| an Anfang und Ende", async ({ page }) => {
    // Die Länge kommt aus der gerechneten Route, nicht als feste Zahl: Sie ändert sich mit dem Datenstand und
    // seit WI-0049 S5a mit dem Gelände (Gareth → Perricum 356 → 359 Meilen, Koordination 2026-09-27).
    const answer = page.waitForResponse((response) => /\/api\/route\?/.test(response.url()) && response.ok());
    await openRoute(page);
    const route = (await (await answer).json()) as { distance_units: number; miles_per_unit: number };
    const total = route.distance_units * route.miles_per_unit;
    // Ab hundert Meilen ohne Nachkommastelle - darunter müsste der Test die Nachkommastelle lesen.
    expect(total, "Gareth → Perricum ist länger als hundert Meilen").toBeGreaterThan(100);
    const miles = String(Math.round(total));
    const track = page.getByTestId("player-track");
    await page.getByTestId("player-next").click();
    const first = Number(await track.getAttribute("aria-valuenow"));
    expect(first).toBeGreaterThan(0);
    // Zwei Etappengrenzen dürfen im selben Prozent liegen: Die Leiste steht dann still, die Etappe rückt weiter.
    await page.getByTestId("player-next").click();
    expect(Number(await track.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(first);
    await expect(page.getByTestId("route-stage").nth(2)).toHaveClass(/is-active/);
    await page.getByTestId("player-previous").click();
    await expect(track).toHaveAttribute("aria-valuenow", String(first));
    await expect(page.getByTestId("route-stage").nth(1)).toHaveClass(/is-active/);
    await page.getByTestId("player-end").click();
    await expect(track).toHaveAttribute("aria-valuenow", "100");
    // Am Ende steht die ganze Länge der Route.
    await expect(page.getByTestId("player-miles")).toHaveText(`${miles} Meilen`);
    // Darunter, was noch kommt (Variante F): am Ende nichts mehr.
    await expect(page.getByTestId("player-miles-left")).toHaveText("noch 0,0");
    await expect(page.getByTestId("player-days-left")).toHaveText("noch 0,0");
    await page.getByTestId("player-start").click();
    await expect(track).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByTestId("player-miles-left")).toHaveText(`noch ${miles}`);
});

test("🔴 In 3D folgt die Kamera hinter dem Pfeil: Sie blickt in Fahrtrichtung", async ({ page }) => {
    await openRoute(page);
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 0) > 30, undefined, { timeout: 5000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 5000 });
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(2500);
    const arrow = await arrowOnScreen(page);
    const view = await camera(page);
    expect(arrow).not.toBeNull();
    // Sie hat sich vom Norden weg in die Reise gedreht (die Straße nach Perricum führt nach Osten).
    // Wie genau sie der Richtung folgt, prüft playmode.test.ts; die Straße schlängelt sich zu sehr,
    // um es an einem einzelnen Bild festzumachen.
    expect(Math.abs(view.bearing), "die Kamera hat sich gedreht").toBeGreaterThan(20);
    // Der Pfeil steht 12 % der sichtbaren Höhe unter ihrer Mitte - Blickraum vor ihm - und rechts vom Planer
    // (Betreiber 2026-09-27: „etwas mehr ins zentrum (vertikal)“, vorher rund 24 %).
    expect(Math.abs(arrow!.y - (view.visible.top + view.visible.height * 0.62)), "Höhe des Pfeils").toBeLessThan(3);
    expect(arrow!.x).toBeGreaterThan(view.visible.left);
    // 3D fliegt in der Neigung der Reise (Betreiber 2026-10-14: „die neigung auf 65°“; 2026-09-27 noch „aufs maximum“).
    expect(view.pitch).toBeCloseTo(FLIGHT_PITCH, 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/playmode-3d.png` });
});

/** Wie oft eine Bewegung ihre Richtung umkehrt, ab `hysteresis` Rückweg - jede Umkehr ein Schwenk. */
function reversals(steps: readonly number[], hysteresis: number): number {
    let position = 0;
    let direction = 0;
    let pivot = 0;
    let extreme = 0;
    let count = 0;
    for (const step of steps) {
        position += step;
        if (direction === 0) {
            if (Math.abs(position - pivot) > hysteresis) {
                direction = Math.sign(position - pivot);
                extreme = position;
            }
        } else if ((position - extreme) * direction > 0) {
            extreme = position;
        } else if ((extreme - position) * direction > hysteresis) {
            count += 1;
            pivot = extreme;
            direction = -direction;
            extreme = position;
        }
    }
    return count;
}

/** Ein Bild der Folgekamera: Blick, Mitte, Zoom und der gezeichnete Pfeil. */
interface FollowFrame {
    bearing: number;
    lng: number;
    lat: number;
    zoom: number;
    arrow: { x: number; y: number } | null;
}

/** Zeichnet die Kamera Bild für Bild auf, von `from` bis `to` Millisekunden - nach Zeit, nicht nach Bildern. */
function recordFollow(page: Page, from: number, to: number): Promise<FollowFrame[]> {
    return page.evaluate(
        ([begin, end]) =>
            new Promise<FollowFrame[]>((resolve) => {
                const map = globalThis.avesmapsMap!;
                const traveler = (
                    globalThis as unknown as { avesmapsTraveler?: { drawn(): { x: number; y: number } | null } }
                ).avesmapsTraveler;
                const seen: FollowFrame[] = [];
                let start: number | undefined;
                const frame = (time: number): void => {
                    start ??= time;
                    if (time - start >= begin) {
                        const { lng, lat } = map.getCenter();
                        seen.push({
                            bearing: map.getBearing(),
                            lng,
                            lat,
                            zoom: map.getZoom(),
                            arrow: traveler?.drawn() ?? null,
                        });
                    }
                    if (time - start < end) requestAnimationFrame(frame);
                    else resolve(seen);
                };
                requestAnimationFrame(frame);
            }),
        [from, to] as const,
    );
}

/** Wie weit die Mitte von Bild zu Bild quer zum Blick rückt, in Bildpunkten der Karte. */
function sideSteps(frames: readonly FollowFrame[]): number[] {
    const world = (frame: FollowFrame): { x: number; y: number } => {
        const size = 512 * 2 ** frame.zoom;
        const lat = (frame.lat * Math.PI) / 180;
        return {
            x: ((frame.lng + 180) / 360) * size,
            y: ((1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2) * size,
        };
    };
    return frames.slice(1).map((frame, index) => {
        const a = world(frames[index] as FollowFrame);
        const b = world(frame);
        const turn = (frame.bearing * Math.PI) / 180;
        return (b.x - a.x) * Math.cos(turn) + (b.y - a.y) * Math.sin(turn);
    });
}

test("🔴 Kamera folgt im Gebirge ruhig: kein Schwenk und kein Rutschen in jede Kehre (WI-0053, Betreiber 2026-09-27)", async ({
    page,
}) => {
    // Über den Pass zwischen Greifenfurt und Lowangen, fast nur Gebirgspass und Pfad. Gemessen von Sekunde 5 bis
    // 15: Die Drehung lag vorher bei 20 °/s mit 6 Umkehrungen, danach bei 3 °/s mit 2. Seitlich rutschte die
    // Karte mit 68 px/s und 13 Umkehrungen, mit Spielraum 31 px/s und 2.
    test.setTimeout(90_000);
    // Gemessen wird die Kameralogik, nicht das Gelände: Headless kostet es rund 7× Bildrate, unter Last kamen
    // nur 6-7 Bilder (WI-0049 S4). Ohne Zeiger bleibt die Karte flach - für die App „kein Gelände abgeleitet“.
    await page.route("**/tiles/terrain/dem/current.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/?route=Greifenfurt~Lowangen");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-player")).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 0) > 30, undefined, { timeout: 5000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 5000 });
    await page.getByTestId("player-play").click();
    const frames = await recordFollow(page, 5000, 15_000);
    await expect(page.getByTestId("player-play"), "die Wiedergabe lief durch").toHaveAttribute("aria-pressed", "true");
    expect(frames.length).toBeGreaterThan(50);
    const turns = frames
        .slice(1)
        .map(
            (frame, index) =>
                ((((frame.bearing - (frames[index] as FollowFrame).bearing + 180) % 360) + 360) % 360) - 180,
        );
    const turned = turns.reduce((sum, turn) => sum + Math.abs(turn), 0);
    expect(turned / 10, `Drehung ${(turned / 10).toFixed(1)} °/s`).toBeLessThan(10);
    expect(reversals(turns, 3), "Schwenks hin und zurück in 10 s").toBeLessThanOrEqual(3);
    const sides = sideSteps(frames);
    const slid = sides.reduce((sum, side) => sum + Math.abs(side), 0);
    expect(slid / 10, `seitlich ${(slid / 10).toFixed(1)} px/s`).toBeLessThan(45);
    expect(reversals(sides, 5), "seitlich hin und zurück in 10 s").toBeLessThanOrEqual(5);
    // Der Pfeil wandert im Spielraum (auf dem Boden 80 px bei Zoom 7, mit dem Zoom mitwachsend; vorn im Bild durch die Perspektive etwas mehr) und
    // bleibt auf seiner Höhe unter der Mitte der sichtbaren Fläche.
    const view = await camera(page);
    const centre = view.visible.left + view.visible.width / 2;
    const heights = frames.map((frame) => frame.arrow?.y ?? Number.NaN);
    for (const frame of frames) {
        expect(frame.arrow, "der Pfeil ist gezeichnet").not.toBeNull();
        expect(Math.abs(frame.arrow!.x - centre)).toBeLessThan(pfeilAbstandMax(view.visible.width));
    }
    expect(Math.max(...heights) - Math.min(...heights), "der Pfeil bleibt auf seiner Höhe").toBeLessThan(3);
});

test("🔴 Selbst gewählter Zoom bleibt: auch nach der Rückkehr und beim nächsten ▶ (Betreiber 2026-09-27)", async ({
    page,
}) => {
    // „der zoom wird im playmode immer zurückgestellt, wär schön wenn er bleibt nachdem er mit dem mausrad
    // geändert wurde“ - und seit der freien Kamera läuft die Wiedergabe beim Zoomen weiter.
    test.setTimeout(60_000);
    await openRoute(page);
    const zoom = (): Promise<number> => page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page.getByTestId("player-play").click();
    await expect.poll(zoom, { timeout: 5_000 }).toBeCloseTo(FLIGHT_ZOOM, 1);
    const view = await camera(page);
    await moveMap(page, {
        x: view.visible.left + view.visible.width / 2,
        y: view.visible.top + view.visible.height / 2,
    });
    await page.mouse.wheel(0, -400);
    // Der Radzoom läuft nach, auch wenn die Karte schon nicht mehr als bewegt gilt: warten, bis er steht.
    let chosen = await zoom();
    await expect
        .poll(async () => {
            const before = chosen;
            await page.waitForTimeout(300);
            chosen = await zoom();
            return Math.abs(chosen - before);
        })
        .toBeLessThan(1e-6);
    expect(chosen, "herangezoomt").toBeGreaterThan(FLIGHT_ZOOM + 0.3);
    await expect(page.getByTestId("player-play"), "das Rad hält nicht an").toHaveAttribute("aria-pressed", "true");
    // Nach der Ruhe folgt die Kamera wieder - auf der gewählten Stufe.
    await expect
        .poll(
            async () => {
                const arrow = await arrowOnScreen(page);
                return arrow ? Math.abs(arrow.x - (view.visible.left + view.visible.width / 2)) : Infinity;
            },
            { timeout: 6_000 },
        )
        .toBeLessThan(3);
    expect(await zoom()).toBeCloseTo(chosen, 1);
    // Und beim nächsten ▶ auch.
    await page.getByTestId("player-play").click();
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    expect(await zoom()).toBeCloseTo(chosen, 1);
});

test("🔴 Zoom über den Ring bleibt auch: während der Wiedergabe und beim nächsten ▶ (Betreiber 2026-09-27)", async ({
    page,
}) => {
    // „zoom soll auch erhalten bleiben ja“ - wie Rad und Finger zählt „+“ am Ring als selbst gewählt.
    await openRoute(page);
    const zoom = (): Promise<number> => page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page.getByTestId("player-play").click();
    await expect.poll(zoom, { timeout: 5_000 }).toBeCloseTo(FLIGHT_ZOOM, 1);
    // Im Keil geklickt, wie ein Mensch - die Mitte des Knopfs deckt die Kompassscheibe (camera-target.spec.ts).
    const ring = (await page.getByTestId("camera-ring").boundingBox())!;
    await page.getByTestId("camera-zoom-in").click({ position: { x: ring.width / 2, y: 12 } });
    // In der Folge: kein Loslösen, die Wiedergabe läuft, die Kamera zoomt mit.
    await expect.poll(zoom, { timeout: 2_000 }).toBeCloseTo(FLIGHT_ZOOM + 1, 1);
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("player-play").click();
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(2000);
    expect(await zoom()).toBeCloseTo(FLIGHT_ZOOM + 1, 1);
});

test("🔴 Der Kompass holt die freie Kamera zum Pfeil zurück - nur während der Wiedergabe (Betreiber 2026-09-27)", async ({
    page,
}) => {
    // „oder man den compass drückt, kann die ansicht wieder auf den pfeil zurückkehren … aber nur im playmode“
    await openRoute(page);
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 0) > 30, undefined, { timeout: 5000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 5000 });
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(2000);
    const view = await camera(page);
    const centre = view.visible.left + view.visible.width / 2;
    const home = view.visible.top + view.visible.height * 0.62;
    // Die Karte wegziehen: Die Wiedergabe läuft weiter, der Pfeil läuft aus seinem Platz.
    await moveMap(page, { x: centre, y: home - 150 });
    await page.mouse.down();
    await moveMap(page, { x: centre - 250, y: home - 100 }, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
    const away = await arrowOnScreen(page);
    expect(Math.hypot(away!.x - centre, away!.y - home), "der Pfeil ist weg von seinem Platz").toBeGreaterThan(100);
    await page.getByTestId("camera-north").click();
    await expect
        .poll(
            async () => {
                const arrow = await arrowOnScreen(page);
                return arrow
                    ? Math.abs(arrow.y - home) +
                          Math.max(0, Math.abs(arrow.x - centre) - pfeilAbstandMax(view.visible.width))
                    : Infinity;
            },
            { timeout: 2_000 },
        )
        .toBeLessThan(4);
    // Zurück zum Pfeil heißt zurück in Fahrtrichtung, nicht nach Norden.
    expect(Math.abs((await camera(page)).bearing), "nicht nach Norden gedreht").toBeGreaterThan(20);
    // Angehalten richtet der Kompass wie immer nach Norden aus.
    await page.getByTestId("player-play").click();
    await page.getByTestId("camera-north").click();
    await expect.poll(async () => Math.abs((await camera(page)).bearing), { timeout: 3_000 }).toBeLessThan(0.5);
});

test("🔴 Etappe und Leiste gehören zusammen: gewählt rückt die Leiste, gespielt wird die Etappe gold", async ({
    page,
}) => {
    await openRoute(page);
    const track = page.getByTestId("player-track");
    // Eine Etappe in der Liste wählen: Der Fortschritt steht an ihrem Anfang, ihr Stück ist gold. Auf das
    // Symbol - Wege, Orte und seit WI-0035 die Landschaften sind eigene Knöpfe mitten in der Zeile.
    await page.getByTestId("route-stage").nth(2).locator("img").click();
    await expect(page.getByTestId("player-stage")).toBeVisible();
    const chosen = Number(await track.getAttribute("aria-valuenow"));
    expect(chosen).toBeGreaterThan(0);
    // Ein Klick auf eine Etappe ist kein Abspielen: kein Pfeil (Betreiber 2026-09-25).
    expect(await arrowOnScreen(page)).toBeNull();
    await page.getByTestId("player-start").click();
    await expect(track).toHaveAttribute("aria-valuenow", "0");
    await expect(page.locator("[data-testid=route-stage].is-active")).toHaveCount(1);
    await expect(page.getByTestId("route-stage").nth(0)).toHaveClass(/is-active/);
    // Und andersherum: Springt der Pfeil in die nächste Etappe, steht sie gold in der Liste.
    await page.getByTestId("player-next").click();
    await expect(page.getByTestId("route-stage").nth(1)).toHaveClass(/is-active/);
    await expect(page.locator("[data-testid=route-stage].is-active")).toHaveCount(1);
    // Die Leiste ist in Gebrauch: Jetzt springt der Pfeil mit der gewählten Etappe.
    await expect.poll(() => arrowOnScreen(page)).not.toBeNull();
    const before = await arrowOnScreen(page);
    await page.getByTestId("route-stage").nth(2).locator("img").click();
    await expect.poll(async () => (await arrowOnScreen(page))?.x).not.toBe(before?.x);
});

/** Ein Bild am Übergang in den Vogelflug: wie sich der Boden auf dem Schirm bewegt, wie die Karte dreht, wo der Pfeil steht. */
interface Uebergangsbild {
    t: number;
    playing: boolean;
    /** Mittlere Verschiebung eines Rasters von Bodenpunkten in der freien Fläche gegen das Bild davor, in px. */
    dx: number;
    dy: number;
    bearing: number;
    arrow: { x: number; y: number } | null;
    middle: { x: number; y: number };
}

/** Je Bild, bis 3 s nach dem Ende der Wiedergabe: Raster von Bodenpunkten, im Bild davor festgehalten, hier wieder projiziert. */
async function uebergang(page: Page): Promise<Uebergangsbild[]> {
    return page.evaluate(
        () =>
            new Promise<Uebergangsbild[]>((resolve) => {
                const map = globalThis.avesmapsMap as unknown as {
                    getBearing(): number;
                    getCanvas(): HTMLCanvasElement;
                    project(l: [number, number]): { x: number; y: number };
                    unproject(p: [number, number]): { lng: number; lat: number };
                };
                const traveler = (
                    globalThis as unknown as { avesmapsTraveler?: { drawn(): { x: number; y: number } | null } }
                ).avesmapsTraveler;
                const area = globalThis.avesmapsVisibleArea!;
                const seen: Uebergangsbild[] = [];
                let vorher: [number, number][] | undefined;
                let start: number | undefined;
                let ended: number | undefined;
                const frame = (time: number): void => {
                    start ??= time;
                    const canvas = map.getCanvas();
                    const { left, right, top, bottom } = area.insets();
                    const w = canvas.clientWidth - left - right;
                    const h = canvas.clientHeight - top - bottom;
                    const punkte: [number, number][] = [];
                    for (const fx of [0.3, 0.5, 0.7])
                        for (const fy of [0.55, 0.7, 0.85]) punkte.push([left + w * fx, top + h * fy]);
                    let dx = 0;
                    let dy = 0;
                    if (vorher) {
                        vorher.forEach((ort, i) => {
                            const jetzt = map.project(ort);
                            dx += (jetzt.x - punkte[i]![0]) / vorher!.length;
                            dy += (jetzt.y - punkte[i]![1]) / vorher!.length;
                        });
                    }
                    vorher = punkte.map((p) => {
                        const { lng, lat } = map.unproject(p);
                        return [lng, lat] as [number, number];
                    });
                    const playing =
                        document.querySelector('[data-testid="player-play"]')?.getAttribute("aria-pressed") === "true";
                    const arrow = traveler?.drawn() ?? null;
                    seen.push({
                        t: time - start,
                        playing,
                        dx,
                        dy,
                        bearing: map.getBearing(),
                        arrow: arrow ? { x: arrow.x, y: arrow.y } : null,
                        middle: area.centre(),
                    });
                    if (!playing && seen.some((f) => f.playing)) ended ??= time;
                    if ((ended !== undefined && time - ended > 3000) || time - start > 40_000) resolve(seen);
                    else requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            }),
    );
}

/**
 * Wie weit der Boden am Ziel höchstens zurückrutschen darf, in Bildpunkten (Hauptorchestrierung 2026-10-20: den zurückgelegten Rückweg prüfen,
 * nicht die Geschwindigkeit; die Grenze aus der Messung, nicht frei gewählt). Gemessen 2026-10-20 mit zwei Arbeitern unter normaler Last der
 * Prüfbank, 12 Läufe: 9,7 bis 15,4 px Rückweg bei 337 bis 363 px/s Fahrt. Vor dem Fix (83dbcf753^, Zurückrutschen mit bis zu 300 px/s)
 * waren es 112 bis 115 px. Grenze: der größte gemessene Rückweg mal zwei, gerundet. Die alte Prüfung (Rücklauf schneller als 10 % der
 * Fahrt, über drei Bilder) lag ruhig bis −9,7 % und war unter Last in 11 von 12 Läufen rot (bis −13,6 %; Sammellauf 11d0045e −10,2 %).
 */
const RUECKWEG_GRENZE_PX = 30;

test("🔴 am Ziel bremst die Kamera aus und dreht weich in den Vogelflug, ohne Halt und ohne Zurückrutschen (Betreiber 2026-10-17)", async ({
    page,
}) => {
    // „ich will aber auch dass am ende des routeflugs im den übergang in den helikopter-flug kein sprung ist“ (über die Orchestrierung) und
    // 2026-10-14: „nicht aprupt stoppt“. Gemessen vorher (WI-0218): Der Boden lief mit rund 450 px/s, stand in einem Bild still, rutschte
    // dann mit bis zu 300 px/s zurück, bis das Ziel in der Mitte stand; die Drehung schwenkte im letzten Bild der Reise mit bis zu 75 °/s
    // und sprang danach in einem Bild von 0 auf 8 °/s.
    test.setTimeout(90_000);
    await openRoute(page);
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 0) > 30, undefined, { timeout: 5000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 5000 });
    // Gegen das Ende springen und spielen: genug Reise davor, um ihre Geschwindigkeit zu messen.
    const track = (await page.getByTestId("player-track").boundingBox())!;
    await page.mouse.click(track.x + track.width * 0.85, track.y + track.height / 2);
    await page.getByTestId("player-play").click();
    const bilder = await uebergang(page);
    const ende = bilder.findIndex((bild, index) => index > 0 && bilder[index - 1]!.playing && !bild.playing);
    expect(ende, "die Wiedergabe kam ans Ziel").toBeGreaterThan(25);
    // Weg des Bodens und Drehung aufsummiert: Die Bilder des Kopflosen kommen langsam und ungleich, und die Messung sieht mal zwei, mal
    // keinen Schritt der Wiedergabe; Geschwindigkeiten gelten darum über drei Bilder (`ueber`).
    let wx = 0;
    let wy = 0;
    let wd = 0;
    const summe = bilder.map((bild, index) => {
        if (index > 0) {
            wx += bild.dx;
            wy += bild.dy;
            wd += ((bild.bearing - bilder[index - 1]!.bearing + 540) % 360) - 180;
        }
        return { t: bild.t / 1000, x: wx, y: wy, dreh: wd };
    });
    const ueber = (i: number, wert: (s: (typeof summe)[number]) => number): number =>
        (wert(summe[i + 1]!) - wert(summe[i - 2]!)) / (summe[i + 1]!.t - summe[i - 2]!.t);
    // Die Fahrt vor dem Auslauf: Richtung und Betrag des Bodens.
    const von = summe[ende - 25]!;
    const bis = summe[ende - 15]!;
    const rx = (bis.x - von.x) / (bis.t - von.t);
    const ry = (bis.y - von.y) / (bis.t - von.t);
    const fahrt = Math.hypot(rx, ry);
    expect(fahrt, "der Boden zieht während der Reise").toBeGreaterThan(100);
    const vor = (s: (typeof summe)[number]): number => (s.x * rx + s.y * ry) / fahrt;
    const fenster = Array.from({ length: 42 }, (_, k) => ende - 12 + k);
    const tempo = fenster.map((i) => ueber(i, vor));
    // Kein sichtbares Zurückrutschen: der größte Rückgang der Lage längs der Fahrt im Fenster, in Bildpunkten (`RUECKWEG_GRENZE_PX`).
    let hoechste = Number.NEGATIVE_INFINITY;
    let rueckweg = 0;
    for (const i of fenster) {
        const lage = vor(summe[i]!);
        hoechste = Math.max(hoechste, lage);
        rueckweg = Math.max(rueckweg, hoechste - lage);
    }
    expect(rueckweg, `Rückweg des Bodens am Ziel in px bei ${fahrt.toFixed(0)} px/s Fahrt`).toBeLessThan(
        RUECKWEG_GRENZE_PX,
    );
    // Kein Halt in einem Bild: Die Verzögerung bleibt unter der Fahrt je 0,15 s (gebremst wird über den doppelten Abstand Pfeil–Mitte,
    // bei der schnellen Wiedergabe hier rund eine halbe Sekunde).
    const bremse = tempo
        .slice(1)
        .map((v, k) => Math.abs(v - tempo[k]!) / (summe[fenster[k + 1]!]!.t - summe[fenster[k]!]!.t));
    expect(Math.max(...bremse), `größte Verzögerung bei ${fahrt.toFixed(0)} px/s Fahrt`).toBeLessThan(fahrt / 0.15);
    // Die Drehung: kein Schwenk ins letzte Stück, und in den Vogelflug angedreht statt in einem Bild auf 8 °/s.
    const dreh = fenster.map((i) => ueber(i, (s) => s.dreh));
    expect(Math.max(...dreh.map(Math.abs)), "größte Drehrate").toBeLessThan(15);
    const ruck = dreh
        .slice(1)
        .map((d, k) => Math.abs(d - dreh[k]!) / (summe[fenster[k + 1]!]!.t - summe[fenster[k]!]!.t));
    expect(Math.max(...ruck), "größte Änderung der Drehrate in °/s²").toBeLessThan(30);
    // Am Ende steht das Ziel in der Mitte der freien Fläche, und der Vogelflug kreist.
    const spaeter = bilder[ende + 5]!;
    expect(spaeter.arrow, "der Pfeil ist zu sehen").not.toBeNull();
    expect(Math.hypot(spaeter.arrow!.x - spaeter.middle.x, spaeter.arrow!.y - spaeter.middle.y)).toBeLessThan(8);
    expect(
        ueber(bilder.length - 2, (s) => s.dreh),
        "der Vogelflug kreist",
    ).toBeGreaterThan(6);
});

test("🔴 2D ↔ 3D während der Wiedergabe: die Kamera bleibt beim Pfeil (Betreiber 2026-09-27)", async ({ page }) => {
    // „wenn ich play drücke und dann auf 3d schalte flitzt der pfeil davon und die kamera bleibt stehen - bis sie
    // hinterher fliegt. von 3d nach 2d passiert das auch. die kamera soll nur vom pfeil „losgelöst“ sein, wenn
    // [ich] mit maus oder touch bewusst die kartenansicht verändere“
    await openRoute(page);
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(1000);
    const view = await camera(page);
    const centre = { x: view.visible.left + view.visible.width / 2, y: view.visible.top + view.visible.height / 2 };
    /** Wie weit der Pfeil höchstens von der Mitte wegläuft, während `seconds` lang Bilder kommen. */
    const farthest = async (seconds: number): Promise<number> => {
        let most = 0;
        for (let sample = 0; sample < seconds * 10; sample += 1) {
            const arrow = await arrowOnScreen(page);
            most = Math.max(most, arrow ? Math.hypot(arrow.x - centre.x, arrow.y - centre.y) : Infinity);
            await page.waitForTimeout(100);
        }
        return most;
    };
    await page.getByTestId("camera-view-3d").click();
    // In 3D steht der Pfeil 12 % unter der Mitte und darf bis zum Spielraum zur Seite (bei Zoom 8: 160 px, vorn im Bild mehr): Mehr läuft er
    // nie davon. Die 50 px darüber sind der Platz unter der Mitte, wie bei der alten Grenze von 160 zu 110.
    const nah = pfeilAbstandMax(view.visible.width) + 50;
    expect(await farthest(1.5), "2D → 3D: der Pfeil bleibt nah").toBeLessThan(nah);
    expect((await camera(page)).pitch, "geneigt wie die Reise fliegt").toBeCloseTo(FLIGHT_PITCH, 1);
    await page.getByTestId("camera-view-2d").click();
    expect(await farthest(1.5), "3D → 2D: der Pfeil bleibt nah").toBeLessThan(nah);
    const arrow = await arrowOnScreen(page);
    expect(Math.hypot(arrow!.x - centre.x, arrow!.y - centre.y), "2D: wieder genau in der Mitte").toBeLessThan(3);
    expect((await camera(page)).pitch).toBeLessThan(0.5);
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
});

test("🔴 Wer die Karte zieht, hält nicht an: die Kamera ist frei und kehrt nach 3 s Ruhe zurück (WI-0053)", async ({
    page,
}) => {
    // Betreiber 2026-09-27: „wenn ich die kamera bewege stoppt außerdem die animation, das braucht sie nicht, wär
    // schön wenn sie weiterläuft. wenn die maus eine weile untätig ist (3 sekunden) … wieder auf den pfeil“.
    await openRoute(page);
    await page.getByTestId("player-play").click();
    // Erst fliegt die Kamera zum Pfeil, dann läuft die Uhr (Betreiber 2026-09-29): Gezogen wird während der
    // Wiedergabe, nicht im Anflug - wer den abbricht, startet sie gar nicht (camera-flies.spec.ts).
    await expect(page.getByTestId("player-miles")).not.toHaveText("0,0 Meilen", { timeout: 10_000 });
    const view = await camera(page);
    const centre = { x: view.visible.left + view.visible.width / 2, y: view.visible.top + view.visible.height / 2 };
    await moveMap(page, centre);
    await page.mouse.down();
    await moveMap(page, { x: centre.x + 160, y: centre.y + 80 }, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("player-play"), "die Wiedergabe läuft weiter").toHaveAttribute(
        "aria-pressed",
        "true",
    );
    const off = (arrow: { x: number; y: number } | null): number =>
        arrow ? Math.hypot(arrow.x - centre.x, arrow.y - centre.y) : Infinity;
    expect(off(await arrowOnScreen(page)), "die Kamera folgt gerade nicht").toBeGreaterThan(100);
    // Weiter frei, solange nicht 3 s Ruhe waren …
    await page.waitForTimeout(1500);
    expect(off(await arrowOnScreen(page))).toBeGreaterThan(50);
    // … dann zurück zum Pfeil, und die Wiedergabe lief die ganze Zeit.
    await expect.poll(async () => off(await arrowOnScreen(page)), { timeout: 4_000 }).toBeLessThan(3);
    await expect(page.getByTestId("player-play")).toHaveAttribute("aria-pressed", "true");
});

test("🔴 ▶ geht auf Flughöhe wie ein Navi, und der Pfeil bleibt im Bild (Betreiber 2026-09-25)", async ({ page }) => {
    await openRoute(page);
    const zoom = (): Promise<number> => page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    // Eingepasst steht die Reise weit draußen; ▶ steigt in gut einer Sekunde auf die Flughöhe.
    await page.evaluate(() => globalThis.avesmapsMap!.jumpTo({ zoom: 5 }));
    await page.getByTestId("player-play").click();
    await expect.poll(zoom, { timeout: 5_000 }).toBeCloseTo(FLIGHT_ZOOM, 1);
    const arrow = await arrowOnScreen(page);
    const view = await camera(page);
    expect(arrow, "der Pfeil ist auf der Karte").not.toBeNull();
    expect(arrow!.x).toBeGreaterThan(0);
    expect(arrow!.x).toBeLessThan(view.width);
    expect(arrow!.y).toBeGreaterThan(0);
    expect(arrow!.y).toBeLessThan(view.height);
});
