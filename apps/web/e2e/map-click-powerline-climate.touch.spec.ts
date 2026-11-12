import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { onPage, openMap, settleFrame, showPlace } from "./map-handle.ts";

/**
 * Kraftlinien und Klimabänder am Telefon anklicken (WI-0063 P8, 4.3): Ein kurzer Tipp wählt das Objekt, das Panel deckt die
 * Karte, Planer und Panel schließen einander aus. Das Zeigen gibt es am Finger nicht. Am Rechner steht dasselbe in
 * `map-click-powerline-climate.spec.ts`.
 *
 * 🔴 **Der lange Druck wählt seit WI-0108 nichts mehr** (Betreiber 2026-10-08: „langer tap ist rechtsklick“): Er öffnet
 * das Kartenmenü - über einer Kraftlinie wie über einem Band, denn am Rechner bekam keines von beiden den Rechtsklick.
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis.
 */

/** Einsegmentig („Mittellandlinie“), 149 Einheiten lang; ihre Mitte. */
const MITTELLANDLINIE = { x: 624.442, y: 614.598 };

interface ArcsLike {
    state(): { ready: boolean; active: boolean; highlighted: number };
}

const subject = (page: Page): Promise<{ kind: string; band?: string } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.() as { kind: string; band?: string } | undefined);

/** Die Mitte der Karte in Bildpunkten, dort liegt nach `showPlace` die Stelle. */
const middle = (page: Page): Promise<{ x: number; y: number }> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const at = globalThis.avesmapsVisibleArea!.centre();
        return { x: Math.round(at.x), y: Math.round(at.y) };
    });

async function press(client: CDPSession, page: Page, at: { x: number; y: number }, ms: number): Promise<void> {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...at, id: 0 }] });
    await page.waitForTimeout(ms);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function showPowerlines(page: Page): Promise<void> {
    await openMap(page);
    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-view-powerlines").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await showPlace(page, MITTELLANDLINIE, 5);
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
    await settleFrame(page);
}

test("🔴 ein kurzer Tipp auf eine Kraftlinie wählt sie: Panel „Kraftlinie“, die Linie leuchtet", async ({ page }) => {
    await showPowerlines(page);
    const at = await onPage(page, await middle(page));
    await page.touchscreen.tap(at.x, at.y);
    const panel = page.getByTestId("info-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText("Mittellandlinie", { timeout: 20_000 });
    await expect(page.getByTestId("info-subtitle")).toHaveText("Kraftlinie");
    expect((await subject(page))?.kind).toBe("powerline");
    expect(
        await page.evaluate(
            () =>
                (globalThis as unknown as { avesmapsPowerlineArcs?: ArcsLike }).avesmapsPowerlineArcs?.state()
                    .highlighted,
        ),
    ).toBeGreaterThan(0);
});

test("🔴 ein langer Druck auf eine Kraftlinie öffnet das Kartenmenü und wählt sie NICHT (WI-0108)", async ({
    page,
}) => {
    await showPowerlines(page);
    const at = await onPage(page, await middle(page));
    const client = await page.context().newCDPSession(page);
    await press(client, page, at, 800);
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    expect(await subject(page)).toBeUndefined();
});

test("🔴 ein Tipp auf ein Klimaband in der Klimaansicht öffnet sein Kopf-Panel, die Zone steht kräftiger", async ({
    page,
}) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-ohr-landscapes").tap();
    await page.getByTestId("fan-layer-klima").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap;
            return (
                map?.getLayer("climate-fill") !== undefined &&
                map.queryRenderedFeatures({ layers: ["climate-fill"] }).length > 0
            );
        },
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
    const at = await middle(page);
    const band = await page.evaluate((point) => {
        const feature = globalThis.avesmapsMap?.queryRenderedFeatures([point.x, point.y], {
            layers: ["climate-fill"],
        })[0];
        return feature
            ? { key: String(feature.properties["type_key"]), label: String(feature.properties["label"]) }
            : undefined;
    }, at);
    expect(band, "unter der Mitte liegt ein Band").toBeDefined();

    const tap = await onPage(page, at);
    await page.touchscreen.tap(tap.x, tap.y);
    await expect(page.getByTestId("info-title")).toHaveText(band?.label ?? "", { timeout: 20_000 });
    await expect(page.getByTestId("info-subtitle")).toHaveText("Klimazonen");
    expect(await subject(page)).toEqual({ kind: "climate", band: band?.key });
    await expect
        .poll(() =>
            page.evaluate(() =>
                JSON.stringify(globalThis.avesmapsMap?.getPaintProperty("climate-fill", "fill-opacity")),
            ),
        )
        .toContain(`"${band?.key ?? ""}"`);
});
