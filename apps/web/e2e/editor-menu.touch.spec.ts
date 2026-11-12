import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { GARETH, onPage, openMap, showPlace } from "./map-handle.ts";

/**
 * Das Editor-Menü am Telefon (WI-0063 P9, 4.3): Es gibt am Telefon kein Floating Menu - weder beim kurzen Tipp noch beim langen Druck auf
 * ein Objekt, auch nicht mit eingeschalteten Testaktionen (`__avesmapsEditorActions`, nur Entwicklung). Der Gegenstand gewinnt wie
 * immer, Auswahl und Infopanel stehen wie ohne Menü.
 *
 * 🔴 Nicht zu verwechseln mit dem KARTENmenü: Das öffnet der lange Druck seit WI-0108 sehr wohl (er ist der
 * Rechtsklick), und auf einem Ort steht darin „Ziel hinzufügen“. Das Editor-Menü bleibt am Finger weg.
 */

const subject = (page: Page): Promise<{ kind: string } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.());

async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        point,
    );
    // Kartenkoordinaten in Seitenkoordinaten: Im Editor-Modus steht über der Karte die Kopfleiste (WI-0120).
    return onPage(page, { x: Math.round(at.x), y: Math.round(at.y) });
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        (globalThis as { __avesmapsEditorActions?: unknown }).__avesmapsEditorActions = { calls: [] };
    });
});

test("🔴 ein kurzer Tipp auf einen Ort: Auswahl und Infopanel, aber kein Menü", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
});

test("🔴 ein langer Druck auf einen Ort: derselbe Subject, kein EDITOR-Menü (das Kartenmenü geht auf)", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    const client: CDPSession = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...at, id: 0 }] });
    await page.waitForTimeout(800);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    // 🔴 Seit WI-0108 ist der lange Druck der Rechtsklick: Das KARTENmenü geht auf, das Editor-Menü nicht.
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
});
