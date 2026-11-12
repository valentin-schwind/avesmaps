import { expect, test, type Page } from "@playwright/test";
import { GARETH, settleFrame } from "./map-handle.ts";
import { expectTooltipLook } from "./map-tooltip-look.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Kartenpunkte am echten Stack (WI-0030, „Hierher reisen“): Kontextmenü, der Gang querfeldein,
 * die Absage als Satz und das Ziehen der Marke. Seit WI-0052 zieht jede Marke, und sie rastet auf Orten ein.
 */

async function openPlanner(page: Page, search = ""): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

async function stageTexts(page: Page): Promise<string[]> {
    await showStages(page, 15_000);
    return page.getByTestId("route-stage").allInnerTexts();
}

/** Springt zur Stelle und sagt, wo sie im Bild liegt - in Seitenpixeln. */
async function showPoint(page: Page, point: { x: number; y: number }, zoom = 8): Promise<{ x: number; y: number }> {
    await page.evaluate(
        ({ point, zoom }) => {
            const center = globalThis.avesmapsRenderProjection!.toRenderLngLat(point);
            globalThis.avesmapsMap!.jumpTo({ center, zoom });
        },
        { point, zoom },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    return screenOf(page, point);
}

async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (point) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(point)),
        point,
    );
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

/** Der Kartenpunkt aus der Adresse (`~@x,y`), als Zahlen. */
async function pointInAddress(page: Page): Promise<{ x: number; y: number } | null> {
    const search = await page.evaluate(() => decodeURIComponent(globalThis.location.search));
    const match = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(search);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

async function travelHere(page: Page, screen: { x: number; y: number }): Promise<void> {
    await page.mouse.click(screen.x, screen.y, { button: "right" });
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    await page.getByTestId("context-travel-here").click();
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
}

test("🔴 Rechtsklick „Hierher reisen“: der Punkt wird Ziel, die Reise endet querfeldein dort", async ({ page }) => {
    await openPlanner(page, "?route=Gareth");
    await travelHere(page, await showPoint(page, { x: 560, y: 540 }));
    await expect(page.getByTestId("waypoint-input").nth(1)).toHaveValue(/^Kartenpunkt/);
    const stages = await stageTexts(page);
    expect(stages.at(-1)).toMatch(/Kartenpunkt[\s\S]*Unwegsames Gelände/);
    await expect.poll(() => pointInAddress(page)).not.toBeNull();
    const point = await pointInAddress(page);
    expect(Math.abs((point?.x ?? 0) - 560)).toBeLessThan(0.05);
    expect(Math.abs((point?.y ?? 0) - 540)).toBeLessThan(0.05);
});

test("Ohne Wegpunkte wird der Kartenpunkt der Start, und ein Satz sagt, was fehlt", async ({ page }) => {
    await openPlanner(page);
    await travelHere(page, await showPoint(page, { x: 560, y: 540 }));
    await expect(page.getByTestId("toast")).toContainText("Kartenpunkt als Startpunkt gesetzt");
    await expect(page.getByTestId("waypoint-input").nth(0)).toHaveValue(/^Kartenpunkt/);
});

test("🔴 Ein Punkt ohne Landweg: Legacys Satz statt einer Route", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~@700.00,200.00");
    await expect(page.getByTestId("toast")).toContainText("Dorthin führt kein Landweg");
    await expect(page.getByTestId("waypoint-input").nth(1)).toHaveValue(/^Kartenpunkt/);
});

test("🔴 Die Marke ziehen: sie hängt am Zeiger, wo man sie packt, und erst das Loslassen rechnet", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~@560.00,540.00");
    const before = await stageTexts(page);
    const tip = await showPoint(page, { x: 560, y: 540 });
    const target = await screenOf(page, { x: 561, y: 538.5 });
    // Die Marke ist ein Tropfen über ihrer Spitze: gepackt wird sie 20 px darüber.
    const grab = { x: tip.x, y: tip.y - 20 };
    // Ein Klick ohne Bewegung verschiebt nichts.
    await page.mouse.click(grab.x, grab.y);
    expect(await pointInAddress(page)).toEqual({ x: 560, y: 540 });

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y - 20, { steps: 8 });
    // Unterwegs wird nicht gerechnet: die Adresse hält noch den alten Punkt.
    expect(await pointInAddress(page)).toEqual({ x: 560, y: 540 });
    await page.mouse.up();
    await expect.poll(async () => (await pointInAddress(page))?.y).not.toBe(540);
    const moved = await pointInAddress(page);
    // Die Spitze landet, wo sie hingezogen wurde - nicht 20 px darüber, unter dem Zeiger.
    expect(Math.abs((moved?.x ?? 0) - 561)).toBeLessThan(0.05);
    expect(Math.abs((moved?.y ?? 0) - 538.5)).toBeLessThan(0.05);
    await expect.poll(() => stageTexts(page)).not.toEqual(before);
});

/** Die gezeichneten Orte im Bild, Kreis und Raute, in Seitenpixeln. */
async function drawnPlaces(page: Page): Promise<{ name: string; x: number; y: number }[]> {
    const box = await page.getByTestId("map").boundingBox();
    const places = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const layers = ["place-marker", "place-marker-structure"].filter((id) => map.getLayer(id) !== undefined);
        return map.queryRenderedFeatures({ layers }).map((feature) => {
            const [lng, lat] = feature.geometry.coordinates;
            return { name: String(feature.properties["name"]), ...map.project({ lng, lat }) };
        });
    });
    return places.map((place) => ({ ...place, x: (box?.x ?? 0) + place.x, y: (box?.y ?? 0) + place.y }));
}

/** Der gezeichnete Ort, der der Stelle am nächsten liegt, außer den genannten. */
async function placeNear(
    page: Page,
    at: { x: number; y: number },
    except: string[],
): Promise<{ name: string; x: number; y: number }> {
    const places = (await drawnPlaces(page)).filter((place) => !except.includes(place.name));
    const distance = (place: { x: number; y: number }): number => Math.hypot(place.x - at.x, place.y - at.y);
    const [nearest] = places.sort((a, b) => distance(a) - distance(b));
    if (!nearest) throw new Error("kein Ort im Bild");
    return nearest;
}

/** Eine Stelle nahe `at`, an der kein Ort näher als 30 px liegt: Dort rastet nichts ein. */
async function freeSpotNear(page: Page, at: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const places = await drawnPlaces(page);
    for (const radius of [70, 110, 150]) {
        for (let step = 0; step < 8; step += 1) {
            const angle = (step * Math.PI) / 4;
            const spot = { x: at.x + radius * Math.cos(angle), y: at.y + radius * Math.sin(angle) };
            if (places.every((place) => Math.hypot(place.x - spot.x, place.y - spot.y) > 30)) return spot;
        }
    }
    throw new Error("keine freie Stelle");
}

const snapLabel = (page: Page) => page.getByTestId("waypoint-snap-label");

test("🔴 Auch ein Ort lässt sich wegziehen (WI-0052): losgelassen im Freien wird er ein Kartenpunkt", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await stageTexts(page);
    // Gareth ist der Start, eine Scheibe mitten auf dem Ort.
    const gareth = await showPoint(page, GARETH);
    await settleFrame(page);
    const spot = await freeSpotNear(page, gareth);
    await page.mouse.move(gareth.x, gareth.y);
    await page.mouse.down();
    await page.mouse.move(spot.x, spot.y, { steps: 8 });
    await expect(snapLabel(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByTestId("waypoint-input").nth(0)).toHaveValue(/^Kartenpunkt/);
    await expect.poll(() => pointInAddress(page)).not.toBeNull();
});

test("🔴 Ein Kartenpunkt rastet auf einem Ort ein: das Schild nennt ihn, losgelassen wird er der Wegpunkt", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~@560.00,540.00");
    await stageTexts(page);
    const tip = await showPoint(page, { x: 560, y: 540 });
    await settleFrame(page);
    const place = await placeNear(page, tip, ["Gareth"]);
    // Der Tropfen, gepackt 20 px über seiner Spitze; die Spitze kommt 5 px neben dem Ort an.
    await page.mouse.move(tip.x, tip.y - 20);
    await page.mouse.down();
    await page.mouse.move(place.x + 4, place.y + 3 - 20, { steps: 8 });
    await expect(snapLabel(page)).toHaveText(place.name);
    // 🔴 Ein Kartentooltip wie jedes Kartenschild (Guide §15.3, Betreiber 2026-10-03: alle in einer Fassung).
    await expectTooltipLook(snapLabel(page));
    await page.mouse.up();
    await expect(snapLabel(page)).toHaveCount(0);
    await expect(page.getByTestId("waypoint-input").nth(1)).toHaveValue(place.name);
    await expect.poll(() => pointInAddress(page)).toBeNull();
});

test("🔴 Strg unterdrückt das Einrasten, auch mitten im Ziehen: der Punkt bleibt ein Kartenpunkt", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~@560.00,540.00");
    await stageTexts(page);
    const tip = await showPoint(page, { x: 560, y: 540 });
    await settleFrame(page);
    const place = await placeNear(page, tip, ["Gareth"]);
    await page.mouse.move(tip.x, tip.y - 20);
    await page.mouse.down();
    await page.mouse.move(place.x + 4, place.y + 3 - 20, { steps: 8 });
    await expect(snapLabel(page)).toHaveText(place.name);
    await page.keyboard.down("Control");
    await expect(snapLabel(page)).toHaveCount(0);
    await page.keyboard.up("Control");
    await expect(snapLabel(page)).toHaveText(place.name);
    await page.keyboard.down("Control");
    await expect(snapLabel(page)).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(async () => (await pointInAddress(page))?.y).not.toBe(540);
    await expect(page.getByTestId("waypoint-input").nth(1)).toHaveValue(/^Kartenpunkt/);
});
