import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { freeSpot, GARETH, onPage, openMap, selectedPlace, showPlace } from "./map-handle.ts";

/**
 * Das Infopanel am Telefon (WI-0063 4.3, P5; Legacy: kein Bottom Sheet, keine Wischgesten): kurzer Tipp und langer Druck
 * auf einen Ort, „Was ist hier?“ über das Kartenmenü, eine Bewegung über die Toleranz, und Planer und Panel schließen
 * einander aus.
 *
 * 🔴 **Seit WI-0108 ist der lange Druck der Rechtsklick** (Betreiber 2026-10-08): Er öffnet das Kartenmenü, und
 * „Was ist hier?“ ist darin der erste Eintrag. Der Weg zum Kartenpunkt ist damit am Finger derselbe wie am Rechner.
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis (wie in
 * `map-points.touch.spec.ts`).
 */

/** Offenes Meer östlich von Gareth (wie in `area-view-scope.spec.ts`). */
const MEER = { x: 650, y: 480 };

const subject = (page: Page): Promise<{ kind: string; x?: number; y?: number } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.());

async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        point,
    );
    return onPage(page, { x: Math.round(at.x), y: Math.round(at.y) });
}

async function press(
    client: CDPSession,
    page: Page,
    at: { x: number; y: number },
    ms: number,
    moveTo?: { x: number; y: number },
): Promise<void> {
    // 🪤 Nur x und y weitergeben: CDP weist einen Berührungspunkt mit unbekanntem Feld ab, und `freeSpot` liefert
    // zusätzlich die geprüften Ebenen mit.
    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: at.x, y: at.y, id: 0 }],
    });
    if (moveTo) {
        await page.waitForTimeout(ms / 3);
        await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: moveTo.x, y: moveTo.y, id: 0 }],
        });
        await page.waitForTimeout((ms * 2) / 3);
    } else {
        await page.waitForTimeout(ms);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const pins = (page: Page): Promise<number> =>
    page.evaluate(
        () =>
            (
                (
                    globalThis.avesmapsMap as unknown as { getStyle(): { sources: Record<string, { data?: unknown }> } }
                ).getStyle().sources["map-pin"]?.data as { features: unknown[] }
            ).features.length,
    );

test("🔴 ein kurzer Tipp auf einen Ort: Auswahl und Infopanel, volle Höhe, ✕ oben rechts, keine Randlasche", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.touchscreen.tap(at.x, at.y);
    const panel = page.getByTestId("info-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    const size = page.viewportSize();
    await expect.poll(async () => Math.round((await panel.boundingBox())?.x ?? 0)).toBe((size?.width ?? 0) - 388);
    const box = await panel.boundingBox();
    // Oben zählt der Rand der Anwendung: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
    const appTop = await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top);
    // min(400 px, 100vw − 24 px), volle Höhe, kein Bottom Sheet.
    expect(box?.width).toBe(388);
    expect((box?.y ?? 0) - appTop).toBe(0);
    expect(box?.height).toBe((size?.height ?? 0) - appTop);
    const close = await page.getByTestId("info-panel-close").boundingBox();
    expect(close?.width).toBe(26);
    expect(close?.height).toBe(26);
    expect(Math.round((close?.x ?? 0) + (close?.width ?? 0))).toBeLessThan(size?.width ?? 0);
    expect((close?.y ?? 0) - appTop).toBeLessThan(20);
    // Die Randlasche gibt es am Telefon nicht.
    await expect(page.getByTestId("info-panel-tab")).toHaveCount(0);
    // Die Eckknöpfe blenden aus, der Bund tritt zurück.
    await expect(page.locator(".corner--covered")).toHaveCount(1);
});

test("🔴 das ✕ klappt das Panel nur ein: Die Auswahl bleibt", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await page.getByTestId("info-panel-close").tap();
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toMatchObject({ kind: "place" });
    expect((await selectedPlace(page))?.name).toBe("Gareth");
});

test("🔴 ein langer Druck auf einen Ort: Auswahl und Panel - und das Kartenmenü dazu, wie am Rechtsklick", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    const client = await page.context().newCDPSession(page);
    await press(client, page, at, 800);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    expect(await pins(page)).toBe(0);
    // 🔴 Seit WI-0108: derselbe Zweig wie der Rechtsklick - erst wählen, dann das Menü in seiner Ortsform.
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    await expect(page.getByTestId("context-add-destination")).toBeVisible();
});

test("🔴 „Was ist hier?“ aus dem Kartenmenü: an der Stelle des Drucks, mit Tropfen", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page);
    const client = await page.context().newCDPSession(page);
    await press(client, page, spot, 800);
    // 🔴 Der lange Druck öffnet das Menü (WI-0108); der Kartenpunkt kommt aus seinem ersten Eintrag.
    await page.getByTestId("context-what-is-here").tap();
    await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?");
    const chosen = await subject(page);
    expect(chosen?.kind).toBe("mapPoint");
    // Die Stelle ist die, wo der Finger aufsetzte (auf 0,01 gerundet).
    const expected = await page.evaluate((at) => {
        const map = globalThis.avesmapsMap!;
        const rect = map.getCanvas().getBoundingClientRect();
        return globalThis.avesmapsRenderProjection!.fromRenderLngLat(
            map.unproject([at.x - rect.left, at.y - rect.top]),
        );
    }, spot);
    expect(Math.abs((chosen?.x ?? 0) - expected.x)).toBeLessThan(0.05);
    expect(Math.abs((chosen?.y ?? 0) - expected.y)).toBeLessThan(0.05);
    expect(await pins(page)).toBe(1);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
});

test("🔴 ein kurzer Tipp auf die freie Karte setzt keinen Kartenpunkt", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page);
    await page.touchscreen.tap(spot.x, spot.y);
    await page.waitForTimeout(900);
    expect(await subject(page)).toBeUndefined();
    expect(await pins(page)).toBe(0);
});

test("🔴 eine Bewegung über die Toleranz erzeugt kein Menü und keinen Kartenpunkt", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page);
    const client = await page.context().newCDPSession(page);
    // Der Finger liegt, zieht dann 40 px weit (mehr als die 10 px der Toleranz) und bleibt über die 550 ms hinaus liegen.
    await press(client, page, spot, 1200, { x: spot.x + 40, y: spot.y });
    await page.waitForTimeout(300);
    expect(await subject(page)).toBeUndefined();
    expect(await pins(page)).toBe(0);
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(page.getByTestId("info-panel")).toBeHidden();
});

test("🔴 Planer und Panel schließen einander aus: Der Kartenpunkt schließt den Planer, der Planer klappt das Panel ein", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const tab = page.getByTestId("route-planner-tab");
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    // Der Planer ist offen, am rechten Rand bleibt ein schmaler Streifen Karte: ein langer Druck dort.
    await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    const size = page.viewportSize();
    const client = await page.context().newCDPSession(page);
    await press(client, page, { x: (size?.width ?? 412) - 20, y: 450 }, 800);
    // Der lange Druck öffnet das Menü (WI-0108); erst sein Eintrag macht den Kartenpunkt.
    await page.getByTestId("context-what-is-here").tap();
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    expect(await subject(page)).toMatchObject({ kind: "mapPoint" });
    // Umgekehrt: Geht der Planer auf, klappt das Panel ein, und die Auswahl bleibt.
    await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toMatchObject({ kind: "mapPoint" });
});

test("ein Tipp in den schmalen Streifen neben dem Panel hebt die Auswahl auf", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    // Bei Zoom 5 füllen die Wege um Gareth den Streifen lückenlos, und seit WI-0090 ist jeder wählbar. Die Karte rückt deshalb
    // so, dass im Streifen offenes Meer liegt; die Auswahl bleibt dabei bestehen.
    await showPlace(page, MEER, 5);
    await page.evaluate(async () => {
        // Das Meer aus der Mitte an den linken Rand: neue Mitte ist, was heute so weit rechts der Mitte liegt.
        const map = globalThis.avesmapsMap!;
        const { clientWidth: width, clientHeight: height } = map.getCanvas();
        map.jumpTo({ center: map.unproject([width - 8, height / 2]) });
        await new Promise<void>((resolve) => map.once("idle", resolve));
    });
    // Ein Punkt im Streifen, an dem wirklich die freie Karte liegt: kein Bedienelement darüber (die Planerlasche) und nichts
    // Wählbares darunter.
    const streifen = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => /(^|-)hit(-|$)/.test(id) || id.startsWith("place-marker") || id === "route-markers");
        for (let y = 200; y < innerHeight - 100; y += 7) {
            if (document.elementFromPoint(8, y) !== canvas) continue;
            const around: [[number, number], [number, number]] = [
                [Math.max(0, 8 - rect.left - 6), y - rect.top - 6],
                [8 - rect.left + 6, y - rect.top + 6],
            ];
            if (map.queryRenderedFeatures(around, { layers: ids }).length === 0) return y;
        }
        return null;
    });
    expect(streifen, "ein freier Punkt im Streifen").not.toBeNull();
    await page.touchscreen.tap(8, streifen!);
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
});
