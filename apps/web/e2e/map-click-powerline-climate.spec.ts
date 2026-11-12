import { expect, test, type Page } from "@playwright/test";
import { chooseView, EDITOR_MODE, openMap, settleFrame, showLandscapes, showPlace } from "./map-handle.ts";
import { expectTooltipLook } from "./map-tooltip-look.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Kraftlinien und Klimabänder sind auf der Karte anklickbar (WI-0063 P8, Betreiber 2026-10-04: „Jedes Objekt, das bei auf unserer
 * Karte vorkommt, anklickbar sein sollte“). Am echten Stack (PostGIS, Martin, Fastify): Klick → Panel „Kraftlinie“ beziehungsweise
 * das Kopf-Panel der Klimazone, die Linie beziehungsweise Zone leuchtet, das Zeigen zeigt das Schild, und wo mehrere Kraftlinien
 * liegen, öffnet die Liste.
 *
 * Die Stellen sind Mitten echter Linien aus dem Bestand. Gezeichnet wird mit den Bögen (Custom Layer): Der Treffer der Bögen
 * (`avesmapsPowerlineArcs.hit`) rechnet am letzten gezeichneten Bild; hier wird er an dem geprüft, was wirklich auf dem Schirm steht.
 */

/** Einsegmentig („Mittellandlinie“), 149 Einheiten lang; ihre Mitte. */
const MITTELLANDLINIE = { x: 624.442, y: 614.598 };
/** Ein Kraftlinienpunkt, an dem „Kette der Zyklopen“, „Strick des Schwarzen Mannes“ und „Atem der Äonen“ zusammenlaufen. */
const ZYKLOPEN_PUNKT = { x: 329.1, y: 348.1 };

type Pt = { x: number; y: number };
interface ArcHit {
    id: string;
    name: string;
    distance: number;
}
interface ArcsLike {
    state(): { ready: boolean; active: boolean; lift: number; highlighted: number };
    hit(point: Pt, reach: number): ArcHit[] | undefined;
}

async function waitForArcs(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const state = (
                globalThis as unknown as { avesmapsPowerlineArcs?: ArcsLike }
            ).avesmapsPowerlineArcs?.state();
            return state?.ready === true && state.active;
        },
        undefined,
        { timeout: 30_000 },
    );
    // Das erste Bild mit den Bögen: Erst danach kennt `hit` die Matrix.
    await settleFrame(page);
}

/** Öffnet die Kraftlinien-Ansicht und fährt an eine Stelle; die Bögen stehen. */
async function showPowerlines(page: Page, at: Pt, zoom = 5, path = "/"): Promise<void> {
    await openMap(page, path);
    await chooseView(page, "powerlines");
    await showPlace(page, at, zoom);
    await waitForArcs(page);
}

/** Die Karte neigen und warten, bis die Bögen ganz stehen. */
async function tilt(page: Page, pitch: number): Promise<void> {
    await page.evaluate(async (neigung) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        map.jumpTo({ pitch: neigung });
        await new Promise<void>((resolve) => map.once("idle", resolve));
    }, pitch);
    await settleFrame(page);
    await page.waitForFunction(
        () => (globalThis as unknown as { avesmapsPowerlineArcs?: ArcsLike }).avesmapsPowerlineArcs?.state().lift === 1,
        undefined,
        { timeout: 15_000 },
    );
}

/** Die Mitte der sichtbaren Karte in Seitenpixeln (am Rechner steht links der Planer). */
async function centre(page: Page): Promise<Pt> {
    const box = await page.getByTestId("map").boundingBox();
    const middle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        return globalThis.avesmapsVisibleArea!.centre();
    });
    return { x: (box?.x ?? 0) + middle.x, y: (box?.y ?? 0) + middle.y };
}

/** Seitenpixel → Bildpunkte der Karte. */
async function inMap(page: Page, at: Pt): Promise<Pt> {
    const box = await page.getByTestId("map").boundingBox();
    return { x: at.x - (box?.x ?? 0), y: at.y - (box?.y ?? 0) };
}

/**
 * Der Punkt der Karte unter einer Stelle des Bildes. Bleibt er nach einem Klick derselbe, ist die Karte nicht geflogen (das Panel,
 * das aufgeht, ändert nur den Innenabstand und damit `getCenter`, nicht, was unter dem Zeiger liegt).
 */
async function groundUnder(page: Page, at: Pt): Promise<{ lng: number; lat: number } | undefined> {
    const spot = await inMap(page, at);
    return page.evaluate((point) => globalThis.avesmapsMap?.unproject([point.x, point.y]), spot);
}

/** Derselbe Punkt der Karte, bis auf das Rauschen der Rechnung. */
function expectSameGround(
    after: { lng: number; lat: number } | undefined,
    before: { lng: number; lat: number } | undefined,
    message: string,
): void {
    expect(after?.lng, message).toBeCloseTo(before?.lng ?? Number.NaN, 6);
    expect(after?.lat, message).toBeCloseTo(before?.lat ?? Number.NaN, 6);
}

const arcHitsAt = async (page: Page, at: Pt, reach = 11): Promise<ArcHit[] | undefined> => {
    const mapPoint = await inMap(page, at);
    return page.evaluate(
        ({ point, range }) =>
            (globalThis as unknown as { avesmapsPowerlineArcs?: ArcsLike }).avesmapsPowerlineArcs?.hit(point, range),
        { point: mapPoint, range: reach },
    );
};

const selectedSubject = (page: Page): Promise<{ kind: string; anchor?: string; band?: string } | undefined> =>
    page.evaluate(
        () => globalThis.avesmapsSelectedSubject?.() as { kind: string; anchor?: string; band?: string } | undefined,
    );

const highlighted = (page: Page): Promise<number> =>
    page.evaluate(
        () =>
            (globalThis as unknown as { avesmapsPowerlineArcs?: ArcsLike }).avesmapsPowerlineArcs?.state()
                .highlighted ?? -1,
    );

/**
 * Wie hell die Bögen um die Punkte stehen: der Mittelwert der Helligkeit im Quadrat von ±`radius` Bildpunkten, gelesen aus dem
 * gezeichneten Bild (im `render`-Ereignis, danach verwirft WebGL den Puffer).
 */
async function brightnessAround(page: Page, points: Pt[], radius: number): Promise<number[]> {
    const inMapPoints = await Promise.all(points.map((point) => inMap(page, point)));
    return page.evaluate(
        async ({ spots, reach }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            return new Promise<number[]>((resolve) => {
                map.once("render", () => {
                    const copy = document.createElement("canvas");
                    copy.width = canvas.width;
                    copy.height = canvas.height;
                    const context = copy.getContext("2d");
                    if (!context) throw new Error("kein 2D-Kontext");
                    context.drawImage(canvas, 0, 0);
                    const scale = canvas.width / canvas.clientWidth;
                    resolve(
                        spots.map((spot) => {
                            const size = Math.round(reach * 2 * scale);
                            const data = context.getImageData(
                                Math.round((spot.x - reach) * scale),
                                Math.round((spot.y - reach) * scale),
                                size,
                                size,
                            ).data;
                            let total = 0;
                            for (let i = 0; i < data.length; i += 4) {
                                total += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
                            }
                            return total / (data.length / 4) / 3;
                        }),
                    );
                });
                map.triggerRepaint();
            });
        },
        { spots: inMapPoints, reach: radius },
    );
}

/** Wie viele Bildpunkte im Quadrat rötlich sind: Die Kraftlinien sind rosa auf entsättigtem Grund. */
async function reddishAround(page: Page, point: Pt, radius: number): Promise<number> {
    const spot = await inMap(page, point);
    return page.evaluate(
        async ({ at, reach }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            return new Promise<number>((resolve) => {
                map.once("render", () => {
                    const copy = document.createElement("canvas");
                    copy.width = canvas.width;
                    copy.height = canvas.height;
                    const context = copy.getContext("2d");
                    if (!context) throw new Error("kein 2D-Kontext");
                    context.drawImage(canvas, 0, 0);
                    const scale = canvas.width / canvas.clientWidth;
                    const size = Math.round(reach * 2 * scale);
                    const data = context.getImageData(
                        Math.round((at.x - reach) * scale),
                        Math.round((at.y - reach) * scale),
                        size,
                        size,
                    ).data;
                    let count = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i] ?? 0;
                        const g = data[i + 1] ?? 0;
                        const b = data[i + 2] ?? 0;
                        if (r > g + 30 && r > b + 15) count += 1;
                    }
                    resolve(count);
                });
                map.triggerRepaint();
            });
        },
        { at: spot, reach: radius },
    );
}

/**
 * Sucht auf der sichtbaren Karte Stellen nach ihrer Art, die dem Mittelpunkt am nächsten liegen:
 * - `arc`: ein Bogen liegt genau darunter (Abstand höchstens 2 Bildpunkte);
 * - `groundOnly`: die Bahn der Kachel liegt darunter, aber kein Bogen (geneigt: der Bogen steht darüber im Raum);
 * - `free`: weder Bogen noch Kachel in 40 Bildpunkten.
 */
async function findSpots(page: Page): Promise<{ arc?: Pt; groundOnly?: Pt; free?: Pt }> {
    const box = await page.getByTestId("map").boundingBox();
    const found = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        const arcs = (globalThis as unknown as { avesmapsPowerlineArcs?: ArcsLike }).avesmapsPowerlineArcs;
        if (!map || !arcs) throw new Error("handle missing");
        const canvas = map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const middle = globalThis.avesmapsVisibleArea!.centre();
        const best: { arc?: Pt; groundOnly?: Pt; free?: Pt } = {};
        const nearest: Record<string, number> = {};
        const consider = (kind: "arc" | "groundOnly" | "free", at: Pt): void => {
            const d = Math.hypot(at.x - middle.x, at.y - middle.y);
            if (nearest[kind] === undefined || d < (nearest[kind] as number)) {
                nearest[kind] = d;
                best[kind] = at;
            }
        };
        // Nur die Mitte: Links steht der Planer, rechts die Bedienelemente.
        for (let x = width * 0.36; x < width * 0.76; x += 8) {
            for (let y = height * 0.16; y < height * 0.84; y += 8) {
                const at = { x, y };
                const near = arcs.hit(at, 2) ?? [];
                const wide = arcs.hit(at, 40) ?? [];
                const ground = map.queryRenderedFeatures(
                    [
                        [x - 5, y - 5],
                        [x + 5, y + 5],
                    ],
                    { layers: ["powerline-hit"] },
                );
                const groundWide = map.queryRenderedFeatures(
                    [
                        [x - 40, y - 40],
                        [x + 40, y + 40],
                    ],
                    { layers: ["powerline-hit"] },
                );
                if (near.length > 0) consider("arc", at);
                else if (ground.length > 0 && wide.length === 0) consider("groundOnly", at);
                if (wide.length === 0 && groundWide.length === 0) consider("free", at);
            }
        }
        return best;
    });
    const toPage = (at: Pt | undefined): Pt | undefined =>
        at === undefined ? undefined : { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
    const arc = toPage(found.arc);
    const groundOnly = toPage(found.groundOnly);
    const free = toPage(found.free);
    return { ...(arc ? { arc } : {}), ...(groundOnly ? { groundOnly } : {}), ...(free ? { free } : {}) };
}

test.describe("Kraftlinie anklicken (WI-0063 P8)", () => {
    // Der einmalige Kamera-Hinweis erscheint beim ersten Neigen über der Karte: als gesehen gemerkt, damit ihn keine Pixelprobe trifft
    // (wie in `kraftlinie-bearbeiten.spec.ts`).
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => globalThis.localStorage.setItem("avesmaps3d.hinweis-3d", "gesehen"));
    });

    test("🔴 ein Klick auf eine Kraftlinie wählt sie: Panel „Kraftlinie“, die Linie leuchtet heller, die Kamera bleibt", async ({
        page,
    }) => {
        await showPowerlines(page, MITTELLANDLINIE);
        const on = await centre(page);
        const under = await arcHitsAt(page, on);
        expect(
            under?.map((hit) => hit.name),
            "die Mitte der Mittellandlinie liegt auf ihr",
        ).toContain("Mittellandlinie");
        const before = await groundUnder(page, on);
        const dark = (await brightnessAround(page, [on], 18))[0] ?? 0;

        await page.mouse.click(on.x, on.y);

        await expect(page.getByTestId("info-panel")).toBeVisible();
        await expect(page.getByTestId("info-title")).toHaveText("Mittellandlinie", { timeout: 20_000 });
        await expect(page.getByTestId("info-subtitle")).toHaveText("Kraftlinie");
        expect((await selectedSubject(page))?.kind).toBe("powerline");
        // Die Linie leuchtet: Die Bögen zeichnen ihre Stränge noch einmal, und das Bild um die Stelle wird heller.
        expect(await highlighted(page)).toBeGreaterThan(0);
        expect((await brightnessAround(page, [on], 18))[0], "um die Linie steht ein Schein").toBeGreaterThan(dark + 4);
        // Ein Klick fliegt nicht hin (Kamera wie bei Wegen): Die Karte bleibt stehen.
        expectSameGround(await groundUnder(page, on), before, "die Karte bleibt stehen");
    });

    test("🔴 ein Klick in die freie Karte beendet die Auswahl und das Leuchten", async ({ page }) => {
        await showPowerlines(page, MITTELLANDLINIE);
        const on = await centre(page);
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("info-title")).toHaveText("Mittellandlinie", { timeout: 20_000 });
        expect(await highlighted(page)).toBeGreaterThan(0);

        const { free } = await findSpots(page);
        expect(free, "eine freie Stelle in der Ansicht").toBeDefined();
        await page.mouse.click((free as Pt).x, (free as Pt).y);
        await expect.poll(() => selectedSubject(page)).toBeUndefined();
        expect(await highlighted(page)).toBe(0);
    });

    test("🔴 Escape hebt die Auswahl auf, und die Linie leuchtet nicht mehr", async ({ page }) => {
        await showPowerlines(page, MITTELLANDLINIE);
        const on = await centre(page);
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("info-title")).toHaveText("Mittellandlinie", { timeout: 20_000 });
        await page.keyboard.press("Escape");
        await expect.poll(() => selectedSubject(page)).toBeUndefined();
        expect(await highlighted(page)).toBe(0);
    });

    test("🔴 beim Zeigen: die Hand und das Schild „Mittellandlinie · Kraftlinie“ im Aussehen jedes Kartenschilds", async ({
        page,
    }) => {
        await showPowerlines(page, MITTELLANDLINIE);
        const on = await centre(page);
        await page.mouse.move(on.x - 40, on.y - 40);
        await page.mouse.move(on.x, on.y, { steps: 4 });
        const hint = page.getByTestId("pointer-hint");
        await expect(hint).toBeVisible();
        await expect(hint).toContainText("Mittellandlinie · Kraftlinie");
        await expectTooltipLook(hint);
        expect(await page.evaluate(() => globalThis.avesmapsMap?.getCanvas().style.cursor)).toBe("pointer");
        // Weg vom Zeiger: Das Schild geht.
        const { free } = await findSpots(page);
        await page.mouse.move((free as Pt).x, (free as Pt).y, { steps: 4 });
        await expect(hint).toHaveCount(0);
    });

    test("🔴 wo mehrere Kraftlinien laufen, öffnet der Klick die Liste: nie still gewählt, ein Eintrag wählt", async ({
        page,
    }) => {
        await showPowerlines(page, ZYKLOPEN_PUNKT, 5.5);
        const on = await centre(page);
        const names = [...new Set((await arcHitsAt(page, on))?.map((hit) => hit.name))].sort();
        expect(names.length, "am Kraftlinienpunkt laufen mehrere Kraftlinien zusammen").toBeGreaterThanOrEqual(2);

        await page.mouse.click(on.x, on.y);
        const list = page.getByTestId("powerline-choices");
        await expect(list).toBeVisible();
        const entries = page.getByTestId("powerline-choice");
        expect((await entries.locator(".area-choices__name").allTextContents()).sort()).toEqual(names);
        // Gewählt ist, was der Klick nahm (die erste); ein Eintrag der Liste wählt seine Kraftlinie.
        const second = entries.nth(1);
        const secondName = (await second.locator(".area-choices__name").textContent()) ?? "";
        await second.click();
        await expect(page.getByTestId("info-title")).toHaveText(secondName, { timeout: 20_000 });
        await expect(list).toHaveCount(0);
        expect((await selectedSubject(page))?.kind).toBe("powerline");
    });

    test("🔴 geneigt steht die Linie als Bogen am Himmel: Dort trifft der Klick, am Boden darunter nicht", async ({
        page,
    }) => {
        // Die Stränge wabern mit der Zeit (`u_time`): Die Pixelprobe an der Stelle des Treffers hinge an der Phase der Animation und traf
        // je nach Takt daneben (seit f101a068 im Sammellauf rot, mit einem Bildschirmfoto davor grün). Mit reduzierter Bewegung stehen sie still.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await showPowerlines(page, MITTELLANDLINIE, 4.6);
        await tilt(page, 45);
        const { arc, groundOnly } = await findSpots(page);
        expect(arc, "ein Punkt auf einem Bogen im Bild").toBeDefined();
        expect(groundOnly, "und eine Stelle, an der nur noch die Bahn am Boden liegt").toBeDefined();
        // Was die Bögen zu treffen meinen, steht wirklich auf dem Schirm: rosa Punkte genau dort, an der Bahn am Boden nicht.
        expect(await reddishAround(page, arc as Pt, 5), "dort ist die Linie gezeichnet").toBeGreaterThan(0);

        await page.mouse.click((groundOnly as Pt).x, (groundOnly as Pt).y);
        await page.waitForTimeout(400);
        expect(
            await selectedSubject(page),
            "die Bahn am Boden ist nicht zu sehen und nicht anklickbar",
        ).toBeUndefined();

        await page.mouse.click((arc as Pt).x, (arc as Pt).y);
        await expect(page.getByTestId("info-panel")).toBeVisible();
        await expect(page.getByTestId("info-subtitle")).toHaveText("Kraftlinie", { timeout: 20_000 });
        expect((await selectedSubject(page))?.kind).toBe("powerline");
    });

    test("🔴 über die Öffnungsnaht geöffnet (Objektlink, Panel): die Kraftlinien-Ansicht, die Linie leuchtet, das Panel", async ({
        page,
    }) => {
        await openMap(page);
        const network = (await (await page.request.get("/api/powerlines")).json()) as {
            lines: { id: string; name: string }[];
        };
        const anchor = network.lines.find((entry) => entry.name === "Mittellandlinie")?.id;
        expect(anchor, "die Mittellandlinie steht im Netz").toBeDefined();
        await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "powerline", anchor: id }), anchor);
        await expect(page.getByTestId("info-title")).toHaveText("Mittellandlinie", { timeout: 20_000 });
        // Die Ansicht folgt dem Ziel (wie beim Klimaband und der Suche): Wo keine Kraftlinie zu sehen wäre, gäbe es nichts zu markieren.
        await expect(page.getByTestId("fan-toggle")).toContainText("Kraftlinien");
        await waitForArcs(page);
        await expect.poll(() => highlighted(page)).toBeGreaterThan(0);
    });

    test("🪤 ohne das Netz (Rückfall auf die flachen Lagen) gilt die unsichtbare Trefferfläche der Kacheln", async ({
        page,
    }) => {
        await page.route("**/api/powerlines", (route) => route.fulfill({ status: 503, body: "{}" }));
        await openMap(page);
        await chooseView(page, "powerlines");
        await showPlace(page, MITTELLANDLINIE, 5);
        await expect
            .poll(() =>
                page.evaluate(
                    () => globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["powerline-hit"] }).length ?? 0,
                ),
            )
            .toBeGreaterThan(0);
        const on = await centre(page);
        expect(
            await arcHitsAt(page, on),
            "keine Bögen gezeichnet: Der Bogen-Treffer meldet sich nicht",
        ).toBeUndefined();
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("info-title")).toHaveText("Mittellandlinie", { timeout: 20_000 });
        expect((await selectedSubject(page))?.kind).toBe("powerline");
    });

    test("🔴 in der Standardansicht gibt es keine Kraftlinie zum Anklicken: Der Klick gehört dem, was darunter liegt", async ({
        page,
    }) => {
        await openMap(page);
        await showPlace(page, MITTELLANDLINIE, 5);
        expect(await page.evaluate(() => globalThis.avesmapsMap?.getLayer("powerline-hit"))).toBeUndefined();
        const on = await centre(page);
        await page.mouse.click(on.x, on.y);
        await page.waitForTimeout(500);
        expect((await selectedSubject(page))?.kind).not.toBe("powerline");
    });
});

test.describe("Klimaband anklicken (WI-0063 P8)", () => {
    /** Das Band unter dem Punkt, wie die Karte es zeichnet. */
    async function bandAt(page: Page, at: Pt): Promise<{ band: string; label: string } | undefined> {
        const mapPoint = await inMap(page, at);
        return page.evaluate((point) => {
            const feature = globalThis.avesmapsMap?.queryRenderedFeatures([point.x, point.y], {
                layers: ["climate-fill"],
            })[0];
            return feature
                ? { band: String(feature.properties["type_key"]), label: String(feature.properties["label"]) }
                : undefined;
        }, mapPoint);
    }

    /** Mit welcher Deckkraft der lebende Stil das Band zeichnet: Die Zone der Auswahl steht in einem `case`-Ausdruck. */
    const opacityNames = (page: Page): Promise<string> =>
        page.evaluate(() => JSON.stringify(globalThis.avesmapsMap?.getPaintProperty("climate-fill", "fill-opacity")));

    test("🔴 in der Klimaansicht wählt ein Klick das Band: Kopf-Panel mit Name und „Klimazonen“, die Zone steht deckend", async ({
        page,
    }) => {
        await openMap(page);
        await showLandscapes(page, "klima");
        const on = await centre(page);
        const band = await bandAt(page, on);
        expect(band, "unter der Mitte liegt ein Klimaband").toBeDefined();
        // Betreiber 2026-10-05: „also 50% normal, 100% bei einem klick“.
        expect(await opacityNames(page), "noch keine Zone hervorgehoben: alle zu 50 %").toBe("0.5");
        const before = await groundUnder(page, on);

        await page.mouse.click(on.x, on.y);

        await expect(page.getByTestId("info-title")).toHaveText(band?.label ?? "", { timeout: 20_000 });
        await expect(page.getByTestId("info-subtitle")).toHaveText("Klimazonen");
        expect(await selectedSubject(page)).toEqual({ kind: "climate", band: band?.band });
        // Dieselbe Hervorhebung wie beim Link aus dem Panel: Die Zone steht deckend, die übrigen zu 50 %, bis eine andere
        // Auswahl kommt.
        await expect
            .poll(() => opacityNames(page))
            .toBe(JSON.stringify(["case", ["==", ["get", "type_key"], band?.band], 1, 0.5]));
        // Nur der Kopf (Legacy `showEcosystemAreaInfopanel`): keine Felder, keine Aktion.
        await expect(page.getByTestId("info-facts")).toHaveCount(0);
        await expect(page.getByTestId("info-actions")).toHaveCount(0);
        expectSameGround(await groundUnder(page, on), before, "ein Klick fliegt nicht hin");
    });

    test("🔴 Escape beendet die Auswahl und die Hervorhebung", async ({ page }) => {
        await openMap(page);
        await showLandscapes(page, "klima");
        const on = await centre(page);
        const band = await bandAt(page, on);
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("info-title")).toHaveText(band?.label ?? "", { timeout: 20_000 });
        await page.keyboard.press("Escape");
        await expect.poll(() => selectedSubject(page)).toBeUndefined();
        await expect.poll(() => opacityNames(page)).not.toContain(`"${band?.band}"`);
    });

    test("🔴 beim Zeigen: die Hand und das Schild „Name · Klimazone“", async ({ page }) => {
        await openMap(page);
        await showLandscapes(page, "klima");
        const on = await centre(page);
        const band = await bandAt(page, on);
        await page.mouse.move(on.x - 30, on.y - 30);
        await page.mouse.move(on.x, on.y, { steps: 4 });
        const hint = page.getByTestId("pointer-hint");
        await expect(hint).toBeVisible();
        await expect(hint).toContainText(`${band?.label ?? ""} · Klimazone`);
        await expectTooltipLook(hint);
    });

    test("🔴 in „Alle“ und in der Standardansicht gibt es keine Bänder (Betreiber 2026-10-05, wie Legacy): Der Klick wählt kein Klima", async ({
        page,
    }) => {
        await openMap(page);
        await showLandscapes(page, "alle");
        const on = await centre(page);
        await page.mouse.click(on.x, on.y);
        await page.waitForTimeout(500);
        expect((await selectedSubject(page))?.kind).not.toBe("climate");
        await page.keyboard.press("Escape");

        await chooseView(page, "standard");
        await page.waitForTimeout(300);
        await page.mouse.click(on.x, on.y);
        await page.waitForTimeout(500);
        expect((await selectedSubject(page))?.kind).not.toBe("climate");
    });

    /**
     * Stellen im Bild, an denen über dem Band etwas anderes gezeichnet ist: Meer, See, eine Metropole, ein Weg. Gesucht wird am
     * gezeichneten Bild (Raster über die freie Fläche, Ort und Weg an einem ihrer Punkte), nicht an festen Zahlen. Mit
     * `overBand: false` auch ohne Band darunter (in „Alle“ gibt es keine Bänder).
     */
    async function spotsOverBands(
        page: Page,
        overBand = true,
    ): Promise<Record<"meer" | "see" | "metropole" | "weg", Pt | undefined>> {
        return page.evaluate((needBand) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            const left = globalThis.avesmapsVisibleArea!.insets().left;
            const ids = map.getStyle().layers.map((layer) => layer.id);
            const foreground = ids.filter(
                (id) => id.startsWith("path-hit-") || id === "place-marker" || id === "place-marker-structure",
            );
            const rect = canvas.getBoundingClientRect();
            // Auf dem Band und frei: Kein Bedienelement (2D|3D, Hinweise, Knöpfe) liegt über der Stelle.
            const onBand = (x: number, y: number): boolean =>
                document.elementFromPoint(rect.left + x, rect.top + y) === canvas &&
                (!needBand || map.queryRenderedFeatures([x, y], { layers: ["climate-fill"] }).length > 0);
            const water = (type: string): { x: number; y: number } | undefined => {
                for (let y = 20; y < canvas.clientHeight - 20; y += 6) {
                    for (let x = left + 20; x < canvas.clientWidth - 20; x += 6) {
                        // See und Meer: zwei Füllungen, seit das Meer als Grund unter den Landschaftsfüllungen liegt (Nachtrag zu WI-0083).
                        const hit = map.queryRenderedFeatures([x, y], {
                            layers: ["gewaesser-flaeche", "gewaesser-grund"],
                        })[0];
                        // In „Alle“ gewinnt ein Weg oder Ort vor der Fläche; diese Gegenprobe braucht freien Seegrund.
                        if (
                            hit?.properties["region_type"] === type &&
                            onBand(x, y) &&
                            (needBand || map.queryRenderedFeatures([x, y], { layers: foreground }).length === 0)
                        )
                            return { x, y };
                    }
                }
                return undefined;
            };
            const pointOf = (layers: string[], keep: (properties: Record<string, unknown>) => boolean) => {
                const present = layers.filter((id) => ids.includes(id));
                if (present.length === 0) return undefined;
                for (const found of map.queryRenderedFeatures(
                    [
                        [left + 40, 40],
                        [canvas.clientWidth - 40, canvas.clientHeight - 40],
                    ],
                    { layers: present },
                )) {
                    if (!keep(found.properties)) continue;
                    const geometry = found.geometry as unknown as { type: string; coordinates: unknown };
                    const first =
                        geometry.type === "Point"
                            ? (geometry.coordinates as [number, number])
                            : geometry.type === "LineString"
                              ? (geometry.coordinates as [number, number][])[
                                    Math.floor((geometry.coordinates as unknown[]).length / 2)
                                ]
                              : undefined;
                    if (!first) continue;
                    const at = map.project({ lng: first[0], lat: first[1] });
                    if (
                        at.x < left + 20 ||
                        at.x > canvas.clientWidth - 20 ||
                        at.y < 20 ||
                        at.y > canvas.clientHeight - 20
                    )
                        continue;
                    if (map.queryRenderedFeatures([at.x, at.y], { layers: present }).length > 0 && onBand(at.x, at.y)) {
                        return { x: at.x, y: at.y };
                    }
                }
                return undefined;
            };
            const roads = ids.filter((id) => id.startsWith("path-") && !/fluss|label|arrow|outline|casing/.test(id));
            return {
                meer: water("meer"),
                see: water("see"),
                metropole: pointOf(["place-marker"], (properties) => properties["subtype"] === "metropole"),
                weg: pointOf(roads, (properties) => !String(properties["subtype"] ?? "").startsWith("Fluss")),
            };
        }, overBand);
    }

    test("🔴 in der Klimaansicht ist nur das Band klickbar: Meer, See, Metropole und Weg darüber wählen das Band (Betreiber 2026-10-05)", async ({
        page,
    }) => {
        // „kannst du bei der klimazonenansicht auch nur klimazonen klickbar machen?“
        await openMap(page);
        await showLandscapes(page, "klima");
        // Westküste bis Gareth: Meer, Seen, Metropolen und Wege im selben Bild.
        await showPlace(page, { x: 440, y: 530 }, 2.6);
        const spots = await spotsOverBands(page);
        const box = await page.getByTestId("map").boundingBox();
        for (const [what, spot] of Object.entries(spots)) {
            expect(spot, `${what}: im Bild gefunden (Gegenprobe)`).toBeDefined();
            const at = { x: (box?.x ?? 0) + (spot?.x ?? 0), y: (box?.y ?? 0) + (spot?.y ?? 0) };
            const band = await bandAt(page, at);
            await page.mouse.click(at.x, at.y);
            await expect
                .poll(() => selectedSubject(page), { message: what, timeout: 10_000 })
                .toEqual({
                    kind: "climate",
                    band: band?.band,
                });
            await page.keyboard.press("Escape");
            await expect.poll(() => selectedSubject(page)).toBeUndefined();
        }

        // Gegenprobe in „Alle“: Ein freier Seepixel wählt den See; Wege und Orte behalten ihren höheren Rang.
        await showLandscapes(page, "alle");
        const lake = (await spotsOverBands(page, false)).see;
        expect(lake, "See in „Alle“ gefunden").toBeDefined();
        const expectedLake = await page.evaluate((point) => {
            if (!point) throw new Error("See-Prüfpunkt fehlt");
            const feature = globalThis.avesmapsMap?.queryRenderedFeatures([point.x, point.y], {
                layers: ["gewaesser-flaeche"],
            })[0];
            return {
                kind: "area",
                id: String(feature?.properties["region_public_id"]),
                type: feature?.properties["region_type"],
            };
        }, lake);
        expect(expectedLake.type).toBe("see");
        await test.info().attach("see-klickpunkt", {
            body: JSON.stringify({ point: lake, expectedLake }),
            contentType: "application/json",
        });
        await page.mouse.click((box?.x ?? 0) + (lake?.x ?? 0), (box?.y ?? 0) + (lake?.y ?? 0));
        await expect
            .poll(() => selectedSubject(page), { timeout: 10_000 })
            .toMatchObject({ kind: "area", id: expectedLake.id });
    });
});

test.describe("das Editor-Menü hängt am Klickpunkt (WI-0063 P9: anchor an openSubject)", () => {
    // Das Menü gibt es nur mit dem Recht dazu: Ist die Anmeldung eingerichtet, kommt es aus der Sitzung, nicht aus `/edit` allein
    // (`viewer/bootstrap-viewer.ts`, WI-0120 A9). Ohne gestellte Sitzung wäre es die Besucheransicht (WI-0192). Das Editorpanel steht
    // für einen Editor beim Laden vorn (`dd9f7476`) und muss aus dem Weg, damit das Infopanel neben dem Menü erscheint.
    test.beforeEach(async ({ page }) => {
        await stubAdmin(page, {
            capabilities: ["view_flow_directions", "use_editor_menu", "view_editor_series"],
            role: "editor",
        });
        await editorPanelGemerktZu(page);
    });

    /** Die Testaktionen des Editor-Menüs (`editor-menu/dev-actions.ts`, nur Entwicklung) für diese beiden Arten. */
    async function withTestActions(page: Page): Promise<void> {
        await page.addInitScript(() => {
            (globalThis as { __avesmapsEditorActions?: unknown }).__avesmapsEditorActions = {
                calls: [],
                kinds: ["powerline", "climate"],
            };
        });
    }

    /** Das Menü liegt neben dem Klickpunkt: Es deckt ihn nicht, bleibt im Fenster und steht nahe bei ihm. */
    async function expectMenuAt(page: Page, click: Pt): Promise<void> {
        const menu = page.getByTestId("editor-menu");
        await expect(menu).toBeVisible();
        const box = (await menu.boundingBox()) as { x: number; y: number; width: number; height: number };
        const size = page.viewportSize() as { width: number; height: number };
        const covers =
            click.x >= box.x && click.x <= box.x + box.width && click.y >= box.y && click.y <= box.y + box.height;
        expect(covers, "das Menü deckt den Klickpunkt nicht").toBe(false);
        expect(Math.hypot(box.x + box.width / 2 - click.x, box.y + box.height / 2 - click.y)).toBeLessThan(260);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }

    test("🔴 ein Klick auf eine Kraftlinie öffnet das Menü am Klickpunkt, mit ihrem Namen - und das Infopanel auch", async ({
        page,
    }) => {
        await withTestActions(page);
        await showPowerlines(page, MITTELLANDLINIE, 5, EDITOR_MODE);
        const on = await centre(page);
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("editor-menu-title")).toHaveText("Mittellandlinie");
        await expectMenuAt(page, on);
        await expect(page.getByTestId("info-panel")).toBeVisible();
    });

    test("🔴 ein Klick auf ein Klimaband öffnet das Menü am Klickpunkt, mit dem Namen der Zone", async ({ page }) => {
        await withTestActions(page);
        await openMap(page, EDITOR_MODE);
        await showLandscapes(page, "klima");
        const on = await centre(page);
        const feature = await page.evaluate((point) => {
            const map = globalThis.avesmapsMap;
            const box = map?.getCanvas().getBoundingClientRect();
            return map?.queryRenderedFeatures([point.x - (box?.left ?? 0), point.y - (box?.top ?? 0)], {
                layers: ["climate-fill"],
            })[0]?.properties["label"];
        }, on);
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("editor-menu-title")).toHaveText(String(feature));
        await expectMenuAt(page, on);
    });

    test("🔴 wo mehrere Kraftlinien liegen, öffnet der Klick die Liste und KEIN Menü; der Eintrag der Liste bringt es", async ({
        page,
    }) => {
        await withTestActions(page);
        await showPowerlines(page, ZYKLOPEN_PUNKT, 5.5, EDITOR_MODE);
        const on = await centre(page);
        await page.mouse.click(on.x, on.y);
        await expect(page.getByTestId("powerline-choices")).toBeVisible();
        await expect(page.getByTestId("editor-menu")).toHaveCount(0);
        await page.getByTestId("powerline-choice").nth(1).click();
        await expect(page.getByTestId("editor-menu")).toBeVisible();
    });
});
