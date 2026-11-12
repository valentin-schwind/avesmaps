import { expect, test, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Die Flugbahn im Raum (WI-0051 F3), am echten Renderer: geneigt schwebt ein Flug als Bahn über der Karte und
 * seine Linie tritt zurück, flach bleibt er die Linie der Route.
 *
 * 🔴 Mit Grafikkarte, wie die Geländetests: Ohne sie bleibt die Karte flach, und headless zeichnet Chromium sonst
 * mit SwiftShader. Findet der Testbrowser keine, überspringt der Test sichtbar. Ohne abgeleitetes Gelände steht die
 * Bahn im echten Maßstab am Boden (Überhöhung 0); der Test sagt dann, dass er Höhe und Boden nicht prüfen konnte.
 */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

interface FlightArcsHandle {
    state(): {
        flights: number;
        mode: "flat" | "space";
        drawn: number;
        groundSamplings: number;
        groundMax: number;
        arcMax: number;
    };
    peak(index?: number): { arc: { x: number; y: number }; ground: { x: number; y: number } } | undefined;
}

interface FlightMap {
    getGlobalState(): Record<string, unknown>;
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
    isMoving(): boolean;
    getPitch(): number;
}

/** Was die Karte gerade zeichnet: die Flugbahn, der globale Zustand und die Linie der Route. */
async function readFlight(page: Page) {
    return page.evaluate(() => {
        const arcs = (globalThis as unknown as { avesmapsFlightArcs?: FlightArcsHandle }).avesmapsFlightArcs;
        const map = globalThis.avesmapsMap as unknown as FlightMap | undefined;
        if (!arcs || !map) throw new Error("Flugbahn oder Karte fehlen");
        return {
            state: arcs.state(),
            peak: arcs.peak(0),
            inSpace: map.getGlobalState()["routeFlightInSpace"],
            line: map.queryRenderedFeatures({ layers: ["route-line"] }).filter((f) => f.properties["flight"] === true)
                .length,
            hit: map.queryRenderedFeatures({ layers: ["route-hit"] }).length,
        };
    });
}

async function untilStill(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
    await settleFrame(page);
}

test("🔴 geneigt schwebt der Flug als Bahn und seine Linie tritt zurück, flach bleibt er die Linie", async ({
    page,
    request,
}) => {
    test.setTimeout(90_000);
    const gelaende = (await request.get("/tiles/terrain/dem/current.json")).status() === 200;
    let ohneKarte = false;
    page.on("console", (meldung) => {
        ohneKarte ||= meldung.text().startsWith("Gelände aus: keine Grafikkarte");
    });
    await page.goto("/?route=Punin~Perricum&air=witchFlight");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    test.skip(
        ohneKarte,
        "der Testbrowser hat keine Grafikkarte; ohne bleibt die Karte flach (terrain-software.spec.ts)",
    );
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    await untilStill(page);

    // Flach: keine Bahn, die Linie des Flugs steht wie jede Route.
    const flach = await readFlight(page);
    expect(flach.state).toMatchObject({ flights: 1, mode: "flat", drawn: 0 });
    expect(flach.inSpace).toBe(false);
    expect(flach.line, "die Linie des Flugs flach").toBeGreaterThan(0);

    // Geneigt: die Bahn steht, die Linie des Flugs tritt zurück, getroffen wird sie weiter.
    // Long terrain detours can fit below zoom 3, where the camera correctly limits tilt to 30°.
    const zoom = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    const expectedPitch = Math.min(45, Math.max(30, 30 + (zoom - 3) * 15));
    await page.getByTestId("camera-view-3d").click();
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap?.getPitch()), { timeout: 10_000 })
        .toBeCloseTo(expectedPitch, 2);
    await untilStill(page);
    await expect.poll(async () => (await readFlight(page)).line, { timeout: 10_000 }).toBe(0);
    const geneigt = await readFlight(page);
    expect(geneigt.state).toMatchObject({ flights: 1, mode: "space", drawn: 1 });
    expect(geneigt.inSpace).toBe(true);
    expect(geneigt.hit, "die Trefferfläche bleibt").toBeGreaterThan(0);
    // Die Mitte der Bahn steht nie unter ihrem Boden. Im echten Maßstab ist das von weitem kaum ein Pixel.
    expect(geneigt.peak).toBeDefined();
    expect((geneigt.peak?.ground.y ?? 0) - (geneigt.peak?.arc.y ?? 0)).toBeGreaterThanOrEqual(-0.5);
    if (gelaende) {
        // Die Bodenhöhen sind abgetastet, und unter der Bahn steht Gelände.
        expect(geneigt.state.groundSamplings).toBeGreaterThan(0);
        expect(geneigt.state.groundMax).toBeGreaterThan(0);
        // Betreiber 2026-10-04: Der Hexenbesen (Reisehöhe 100) steigt über die Grate, statt sie zu umfliegen: höchstens
        // 1.000 (Reisehöhe × 1.000 %) über dem Boden und nie höher als 5.000 über dem Meer, über dem höchsten Boden
        // aber stets (Abstand 200).
        expect(geneigt.state.arcMax).toBeGreaterThanOrEqual(99);
        expect(geneigt.state.arcMax).toBeLessThanOrEqual(5001);
        expect(geneigt.state.arcMax).toBeLessThanOrEqual(geneigt.state.groundMax + 1001);
        expect(geneigt.state.arcMax).toBeGreaterThan(geneigt.state.groundMax);
    } else {
        test.info().annotations.push({ type: "Gelände", description: "kein Gelände abgeleitet: Höhe nicht geprüft" });
    }

    // Wieder flach: die Bahn geht, die Linie kommt zurück.
    await page.getByTestId("camera-view-2d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 1) === 0, undefined, { timeout: 10_000 });
    await untilStill(page);
    await expect.poll(async () => (await readFlight(page)).line, { timeout: 10_000 }).toBeGreaterThan(0);
    const zurueck = await readFlight(page);
    expect(zurueck.state).toMatchObject({ mode: "flat", drawn: 0 });
    expect(zurueck.inSpace).toBe(false);
});

test("ohne Flug zeichnet die Ebene nichts, auch geneigt, und die Route bleibt ihre Linie", async ({ page }) => {
    test.setTimeout(60_000);
    let ohneKarte = false;
    page.on("console", (meldung) => {
        ohneKarte ||= meldung.text().startsWith("Gelände aus: keine Grafikkarte");
    });
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    test.skip(
        ohneKarte,
        "der Testbrowser hat keine Grafikkarte; ohne bleibt die Karte flach (terrain-software.spec.ts)",
    );
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    await untilStill(page);
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 0) > 30, undefined, { timeout: 10_000 });
    await untilStill(page);
    const land = await page.evaluate(() => {
        const arcs = (globalThis as unknown as { avesmapsFlightArcs?: FlightArcsHandle }).avesmapsFlightArcs;
        const map = globalThis.avesmapsMap as unknown as FlightMap;
        return { state: arcs?.state(), line: map.queryRenderedFeatures({ layers: ["route-line"] }).length };
    });
    expect(land.state).toMatchObject({ flights: 0, drawn: 0 });
    expect(land.line, "die Landroute bleibt geneigt ihre Linie").toBeGreaterThan(0);
});

/** Der Pfeil des Playmodes im letzten Bild; `ground` steht nur da, wenn er in der Luft fliegt. */
interface DrawnArrow {
    x: number;
    y: number;
    ground?: { x: number; y: number };
}

interface FlightProjectionProbe {
    getCanvas(): HTMLCanvasElement;
    queryTerrainElevation(point: { lng: number; lat: number }): number | null;
}

/** Compare the arrow with the physical flight profile, independently of how high the ground has become. */
function projectedFlightError(arrow: DrawnArrow): { error: number; clearance: number } | undefined {
    const handles = globalThis as unknown as {
        avesmapsMap: FlightProjectionProbe;
        avesmapsFlightArcs: {
            heightAt(segment: number, along: number): { x: number; y: number; z: number } | undefined;
        };
        flightProjectionMatrix?: number[];
    };
    if (!arrow.ground) return undefined;
    const { avesmapsMap: map, avesmapsFlightArcs: arcs } = handles;
    if (!arcs.heightAt(0, 0) || !arcs.heightAt(0, 1)) return undefined;
    const matrix = handles.flightProjectionMatrix;
    if (!matrix) return undefined;
    const canvas = map.getCanvas();
    const screen = (p: { x: number; y: number }, z: number) => {
        const w = matrix[3]! * p.x + matrix[7]! * p.y + matrix[11]! * z + matrix[15]!;
        return {
            x:
                ((1 + (matrix[0]! * p.x + matrix[4]! * p.y + matrix[8]! * z + matrix[12]!) / w) / 2) *
                canvas.clientWidth,
            y:
                ((1 - (matrix[1]! * p.x + matrix[5]! * p.y + matrix[9]! * z + matrix[13]!) / w) / 2) *
                canvas.clientHeight,
        };
    };
    // This fixture is one straight griffin flight. Recover its progress exactly from the arrow, which sits on
    // the projected flight path; unprojecting the ground anchor misses x/y on steep terrain.
    const miss = (along: number) => {
        const p = arcs.heightAt(0, along)!;
        const s = screen(p, p.z);
        return Math.hypot(s.x - arrow.x, s.y - arrow.y);
    };
    let along = 0;
    for (let k = 1; k <= 2000; k += 1) if (miss(k / 2000) < miss(along)) along = k / 2000;
    for (let step = 1 / 4000; step > 1e-9; step /= 2)
        for (const next of [along - step, along + step])
            if (next >= 0 && next <= 1 && miss(next) < miss(along)) along = next;
    const flight = arcs.heightAt(0, along)!;
    const lng = flight.x * 360 - 180;
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * flight.y)));
    const ground =
        (map.queryTerrainElevation({ lng, lat: (latitude * 180) / Math.PI }) ?? 0) /
        (2 * Math.PI * 6371008.8 * Math.cos(latitude));
    const expected = screen(flight, ground).y - screen(flight, flight.z).y;
    // Off the path or at the wrong height above its ground: both count as error.
    const error = Math.max(miss(along), Math.abs(expected - (arrow.ground.y - arrow.y)));
    return { error, clearance: (flight.z - ground) * 1024 * 3000 };
}

/** Spielt `ms` lang und merkt sich den höchsten Stand des Pfeils über seinem Boden, in Pixeln. */
async function highestAloft(
    page: Page,
    ms: number,
): Promise<{ frames: number; aloft: number; ground: number; projectionError: number; clearance: number }> {
    await page.evaluate(`globalThis.flightProjectionProbe = ${projectedFlightError.toString()}`);
    await page.evaluate(() => {
        const handles = globalThis as unknown as {
            avesmapsMap: {
                getLayer(id: string): unknown;
                addLayer(layer: import("maplibre-gl").CustomLayerInterface): void;
            };
            flightProjectionMatrix?: number[];
        };
        if (!handles.avesmapsMap.getLayer("flight-projection-test")) {
            handles.avesmapsMap.addLayer({
                id: "flight-projection-test",
                type: "custom",
                render: (_gl, args) => {
                    handles.flightProjectionMatrix = Array.from(args.defaultProjectionData.mainMatrix);
                },
            });
        }
    });
    return page.evaluate(
        (dauer) =>
            new Promise<{ frames: number; aloft: number; ground: number; projectionError: number; clearance: number }>(
                (resolve) => {
                    const traveler = (globalThis as unknown as { avesmapsTraveler?: { drawn(): DrawnArrow | null } })
                        .avesmapsTraveler;
                    let start: number | undefined;
                    let frames = 0;
                    let aloft = 0;
                    let ground = 0;
                    let projectionError = 0;
                    let clearance = 0;
                    const frame = (time: number): void => {
                        start ??= time;
                        const arrow = traveler?.drawn() ?? null;
                        if (arrow) {
                            frames += 1;
                            if (arrow.ground) {
                                ground += 1;
                                aloft = Math.max(aloft, arrow.ground.y - arrow.y);
                                const probe = (
                                    globalThis as unknown as {
                                        flightProjectionProbe: (
                                            arrow: DrawnArrow,
                                        ) => { error: number; clearance: number } | undefined;
                                    }
                                ).flightProjectionProbe(arrow);
                                if (probe) {
                                    projectionError = Math.max(projectionError, probe.error);
                                    clearance = Math.max(clearance, probe.clearance);
                                }
                            }
                        }
                        if (time - start < dauer) requestAnimationFrame(frame);
                        else resolve({ frames, aloft, ground, projectionError, clearance });
                    };
                    requestAnimationFrame(frame);
                },
            ),
        ms,
    );
}

test("🔴 im Playmode fliegt der Pfeil geneigt auf der Bahn mit, flach liegt er wie bisher am Boden", async ({
    page,
    request,
}) => {
    // Betreiber 2026-09-28: „im playmode läuft der pfeil noch am boden entlang, er soll in der luft mitfliegen“.
    test.setTimeout(90_000);
    const zeiger = await request.get("/tiles/terrain/dem/current.json");
    test.skip(zeiger.status() !== 200, "kein Gelände abgeleitet: ohne Überhöhung steht die Bahn am Boden");
    let ohneKarte = false;
    page.on("console", (meldung) => {
        ohneKarte ||= meldung.text().startsWith("Gelände aus: keine Grafikkarte");
    });
    await page.goto("/?route=Punin~Perricum&air=griffin");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    test.skip(
        ohneKarte,
        "der Testbrowser hat keine Grafikkarte; ohne bleibt die Karte flach (terrain-software.spec.ts)",
    );
    await expect(page.getByTestId("route-player")).toBeVisible({ timeout: 15_000 });
    await untilStill(page);

    // Flach: Der Pfeil liegt am Boden, auch mitten im Flug.
    await page.getByTestId("player-play").click();
    const flach = await highestAloft(page, 2500);
    await page.getByTestId("player-play").click();
    expect(flach.frames, "der Pfeil ist flach zu sehen").toBeGreaterThan(10);
    expect(flach.ground, "flach steht der Pfeil nie in der Luft").toBe(0);

    // Geneigt: Nach dem Aufstieg steht er deutlich über seinem Boden, auf der Bahn.
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(() => (globalThis.avesmapsMap?.getPitch() ?? 0) > 30, undefined, { timeout: 10_000 });
    await untilStill(page);
    await page.getByTestId("player-play").click();
    const geneigt = await highestAloft(page, 3000);
    await page.getByTestId("player-play").click();
    expect(geneigt.ground, "geneigt fliegt der Pfeil").toBeGreaterThan(10);
    // 800 Schritt is absolute cruise altitude; the domain ground is no longer assumed to be zero.
    expect(geneigt.aloft, "der Pfeil steht sichtbar über dem tatsächlichen Boden").toBeGreaterThan(1);
    expect(geneigt.clearance, "nach dem Aufstieg mindestens 200 Schritt Bodenabstand").toBeGreaterThan(195);
    expect(geneigt.projectionError, "der Pfeil folgt der physisch projizierten Flugbahn").toBeLessThan(1);
});
