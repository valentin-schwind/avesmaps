import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { freeSpot, GARETH, onPage, openMap, selectedPlace, showPlace } from "./map-handle.ts";

/**
 * 🔴 **Der lange Druck ist der Rechtsklick** (WI-0108, Betreiber 2026-10-08, wörtlich: „Kartenmenü ‚Was ist hier?‘ ->
 * ist im rechtsklicks als menüpunkt drin, langer tap ist rechtsklick“).
 *
 * Vorher war am Telefon **kein einziger** der Menüeinträge erreichbar (Befund WI-0095 F7): Der lange Druck öffnete
 * direkt „Was ist hier?“, und ein Rechtsklick gibt es am Finger nicht. Diese Datei hält fest, was am Finger jetzt
 * geht - und dass es Zeichen für Zeichen dasselbe ist wie am Rechner:
 *
 * - langer Druck auf die freie Fläche → das Menü mit „Hierher reisen“,
 * - langer Druck auf einen **Ort** → das Menü mit „Ziel hinzufügen“ **und** der goldene Kern (WI-0100, `5c68ae61`),
 * - „Was ist hier?“ ist der erste Eintrag und öffnet den Kartenpunkt an der Stelle des Drucks,
 * - ein **Ziehen** öffnet kein Menü.
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis.
 *
 * 🪤 Gedrückt wird nie in der Kartenmitte: Dort liegen im Telefonprofil sechs Wegtreffer, und ein Druck wählte eine
 * Straße statt der freien Fläche (WI-0102). `freeSpot` sucht die Stelle aus dem LEBENDEN Stil und wird hier zusätzlich
 * abgesichert.
 */

/** Wo die Mitte des Fadenkreuzes auf dem Bildschirm sitzt: der Punkt (0, 0) seiner Form. */
async function tipOf(page: Page): Promise<{ x: number; y: number }> {
    return page.getByTestId("map-context-pointer").evaluate((svg) => {
        const path = svg.querySelector(".context-zeiger__punkt") as SVGGraphicsElement;
        const tip = new DOMPoint(0, 0).matrixTransform(path.getScreenCTM()!);
        return { x: Math.round(tip.x), y: Math.round(tip.y) };
    });
}

const subject = (page: Page): Promise<{ kind: string; x?: number; y?: number } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.());

/** Der lange Druck: Finger auf, liegen lassen, los. Ohne `hold` reicht die Zeit sicher über die 550 ms. */
async function longPress(client: CDPSession, page: Page, at: { x: number; y: number }, hold = 800): Promise<void> {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y, id: 0 }] });
    await page.waitForTimeout(hold);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Wo eine Ortsmarke im Bild steht, aus der Projektion der Anwendung - nicht aus Zahlen im Test. */
async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        point,
    );
    // Kartenkoordinaten in Seitenkoordinaten: Im Editor-Modus steht über der Karte die Kopfleiste (WI-0120).
    return onPage(page, { x: Math.round(at.x), y: Math.round(at.y) });
}

/**
 * Eine freie Stelle, und die Absicherung dazu: An ihr darf WIRKLICH kein Besitzer liegen, sonst prüft der Fall die
 * freie Fläche gar nicht (genau diese Falle machte drei Telefonfälle dauerhaft rot, WI-0090/WI-0102).
 */
async function guardedFreeSpot(page: Page): Promise<{ x: number; y: number }> {
    const spot = await freeSpot(page);
    const hits = await page.evaluate((at) => {
        const map = globalThis.avesmapsMap!;
        const ids = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => /(^|-)hit(-|$)/.test(id) || id.startsWith("place-marker") || id === "route-markers");
        // `freeSpot` liefert Seitenkoordinaten; gefragt wird die Karte in ihren eigenen.
        const rect = map.getCanvas().getBoundingClientRect();
        return map
            .queryRenderedFeatures([at.x - rect.left, at.y - rect.top], { layers: ids })
            .map((found) => found.layer.id);
    }, spot);
    expect(hits, `die Stelle ${String(spot.x)}/${String(spot.y)} ist nicht frei`).toEqual([]);
    return { x: spot.x, y: spot.y };
}

test("🔴 langer Druck auf die freie Fläche: das Kartenmenü geht auf, mit „Hierher reisen“", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await guardedFreeSpot(page);
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, spot);

    const menu = page.getByTestId("map-context-menu");
    await expect(menu).toBeVisible();
    // Die freie Fläche zeigt „Hierher reisen“, nicht „Ziel hinzufügen“ (WI-0100).
    await expect(page.getByTestId("context-travel-here")).toBeVisible();
    await expect(page.getByTestId("context-add-destination")).toHaveCount(0);
    // „Was ist hier?“ ist der erste Eintrag - die Kollision aus WI-0063 löst sich damit auf.
    await expect(page.getByTestId("context-what-is-here")).toBeVisible();
    const labels = await menu
        .locator("button")
        .evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("data-testid") ?? "").replace("context-", "")));
    expect(labels[0]).toBe("what-is-here");
    // Alle sechs Einträge sind da - vorher war am Finger keiner erreichbar.
    expect(labels).toEqual(["what-is-here", "travel-here", "report", "nearest", "search", "measure"]);
    // Das Menü steht knapp neben dem Druck, 12 / 10 px (WI-0108 Nachtrag), nicht am Rand; am Rand klappt es um.
    const box = await menu.boundingBox();
    const size = page.viewportSize();
    expect(Math.abs((box?.y ?? 0) - (spot.y + 10)) < 1 || (box?.y ?? 0) + (box?.height ?? 0) <= spot.y - 10 + 1).toBe(
        true,
    );
    expect(Math.abs((box?.x ?? 0) - (spot.x + 12)) < 1 || (box?.x ?? 0) + (box?.width ?? 0) <= spot.x - 12 + 1).toBe(
        true,
    );
    // Und es passt ganz auf den Schirm.
    expect((box?.x ?? 0) >= 0 && (box?.y ?? 0) >= 0).toBe(true);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size?.width ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size?.height ?? 0);
});

test("🔴 die Mitte des Fadenkreuzes liegt am Druckpunkt, das Menü nicht unter dem Finger (WI-0108 Nachtrag)", async ({
    page,
}) => {
    // Betreiber 2026-10-11: „du kannst auch einen kleinen zeiger |\ bauen und das menü mit einem kleinen offset daneben
    // aufgehen lassen“. Vorher lag die Ecke des Menüs genau am Druckpunkt, und die Kuppe deckte „Was ist hier?“ (WI-0108 §B1).
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await guardedFreeSpot(page);
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, spot);

    const pointer = page.getByTestId("map-context-pointer");
    await expect(pointer).toBeVisible();
    expect(await tipOf(page)).toEqual(spot);
    const box = (await page.getByTestId("map-context-menu").boundingBox())!;
    // Der Punkt liegt nicht im Menü, und zwischen beiden liegt mindestens der Versatz in einer Richtung.
    const apart =
        box.x >= spot.x + 12 - 0.5 ||
        box.x + box.width <= spot.x - 12 + 0.5 ||
        box.y >= spot.y + 10 - 0.5 ||
        box.y + box.height <= spot.y - 10 + 0.5;
    expect(apart, `Menü ${JSON.stringify(box)} gegen Druck ${JSON.stringify(spot)}`).toBe(true);

    // Der Zeiger geht mit dem Menü.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(pointer).toHaveCount(0);
});

test("🔴 „Was ist hier?“ aus dem Menü öffnet den Kartenpunkt an der Stelle des Drucks - wie am Rechner", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await guardedFreeSpot(page);
    const expected = await page.evaluate((at) => {
        const map = globalThis.avesmapsMap!;
        const rect = map.getCanvas().getBoundingClientRect();
        return globalThis.avesmapsRenderProjection!.fromRenderLngLat(
            map.unproject([at.x - rect.left, at.y - rect.top]),
        );
    }, spot);
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, spot);
    await page.getByTestId("context-what-is-here").tap();

    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?");
    const chosen = await subject(page);
    expect(chosen?.kind).toBe("mapPoint");
    expect(Math.abs((chosen?.x ?? 0) - expected.x)).toBeLessThan(0.05);
    expect(Math.abs((chosen?.y ?? 0) - expected.y)).toBeLessThan(0.05);
});

test("🔴 langer Druck auf einen Ort: „Ziel hinzufügen“ UND der goldene Kern - beides wie der Rechtsklick", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, at);

    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    // 🔴 Der Ort ist gewählt - das ist der goldene Kern auf der Karte (WI-0100, `5c68ae61`).
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    // Und die zweite Zeile ist die des Orts, nicht die der freien Fläche.
    await expect(page.getByTestId("context-add-destination")).toBeVisible();
    await expect(page.getByTestId("context-travel-here")).toHaveCount(0);
});

test("💣 ein Ziehen öffnet KEIN Menü: wer die Karte schiebt, bekommt keins", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await guardedFreeSpot(page);
    const client = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());

    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: spot.x, y: spot.y, id: 0 }],
    });
    for (let step = 1; step <= 8; step += 1) {
        await page.waitForTimeout(30);
        await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: spot.x + step * 14, y: spot.y + step * 7, id: 0 }],
        });
    }
    // Der Finger bleibt über die 550 ms hinaus liegen: Hätte das Ziehen den Druck nicht verworfen, ginge das Menü
    // jetzt mitten im Zug auf.
    await page.waitForTimeout(800);
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(300);
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    expect(await subject(page)).toBeUndefined();
    // Gegenprobe, dass der Fall das Ziehen wirklich geprüft hat: Die Karte ist gewandert.
    const after = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    expect(before.lng !== after.lng || before.lat !== after.lat).toBe(true);
});
