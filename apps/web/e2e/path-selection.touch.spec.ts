import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Dieselbe Regel am Telefon (WI-0090, A11): Ein **Tipp** auf einen Weg öffnet ihn. Am Rechner steht es in
 * `path-selection.spec.ts`.
 *
 * 🔴 **A11 ist am langen Druck umgedreht** (WI-0108, Betreiber 2026-10-08: „langer tap ist rechtsklick“): Der lange
 * Druck wählt den Weg NICHT mehr, er öffnet das Kartenmenü - genau wie der Rechtsklick auf einen Weg am Rechner.
 * Grund: Jede Wegart trägt am Finger eine 28 px breite Trefferfläche; solange der Weg (Rang 45) den langen Druck
 * bekam, war das Menü (Rang 20) über jeder Straße und jedem Fluss unerreichbar.
 *
 * 🪤 Am Finger gibt es kein Zeigen und deshalb kein Zeiger-Schild und keine Strichelung - der Unterschied, um den es in
 * § 2 geht, ist am Telefon gar nicht sichtbar. Geprüft wird hier nur, dass der Weg aufgeht.
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis - und wird GELESEN,
 * WÄHREND DER FINGER LIEGT. Beim Loslassen feuert MapLibre einen Klick, und das inzwischen geöffnete Panel deckt am
 * Telefon die Stelle (gemessen 2026-10-05: der Klick landete in einem Objektlink des Panels).
 */

/** So lange liegt der Finger, bis der lange Druck sicher gefeuert hat (der Koordinator misst 550 ms). */
const PRESS_MS = 900;

/** Gareth: dort laufen Reichsstraßen zusammen, und der Große Fluss ist da. */
const GARETH = { x: 551.625, y: 532.969 };

let round = 0;

async function open(page: Page, layer: string): Promise<void> {
    round += 1;
    await page.goto(
        `/?r=${String(round)}#x=${String(GARETH.x)}&y=${String(GARETH.y)}&z=6.5&series=original&view=landscapes&layer=${layer}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await settleFrame(page);
}

/** Eine Stelle, an der ein benannter Weg unter dem Finger liegt und die Leinwand der Karte vorn ist. */
const pathSpot = (page: Page): Promise<{ x: number; y: number; name: string } | undefined> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const ids = (map.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id.startsWith("path-hit-"));
        if (ids.length === 0) return undefined;
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        for (let y = 170; y < canvas.clientHeight - 170; y += 5) {
            for (let x = 40; x < canvas.clientWidth - 40; x += 5) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                const hit = map
                    .queryRenderedFeatures([x, y], { layers: ids })
                    .find((entry) => String(entry.properties["name"] ?? "").trim() !== "");
                if (hit) return { x: box.left + x, y: box.top + y, name: String(hit.properties["name"]).trim() };
            }
        }
        return undefined;
    });

/** Eine Stelle ohne Weg, ohne Ort, ohne Fläche und ohne Route - dort geht das Menü in seiner Kartenpunkt-Form auf. */
const freeSpot = (page: Page): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter(
                (id) =>
                    id.startsWith("path-hit-") ||
                    id.startsWith("landscape-fill-") ||
                    id === "gewaesser-flaeche" ||
                    id === "gewaesser-grund" ||
                    id === "place-marker" ||
                    id === "place-marker-structure" ||
                    id === "route-hit",
            );
        for (let y = 170; y < canvas.clientHeight - 170; y += 7) {
            for (let x = 40; x < canvas.clientWidth - 40; x += 7) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                const around: [[number, number], [number, number]] = [
                    [x - 20, y - 20],
                    [x + 20, y + 20],
                ];
                if (map.queryRenderedFeatures(around, { layers: ids }).length === 0) {
                    return { x: box.left + x, y: box.top + y };
                }
            }
        }
        return undefined;
    });

const subjectKind = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind);

const chosen = (page: Page): Promise<{ kind?: string; name?: string | null } | undefined> =>
    page.evaluate(() => {
        const area = globalThis.avesmapsAreaSelection?.();
        return area ? { kind: area.kind, name: area.name } : undefined;
    });

/** Der lange Druck, gelesen während der Finger liegt; danach wird losgelassen. */
async function longPress(
    client: CDPSession,
    page: Page,
    at: { x: number; y: number },
): Promise<{ subject: string | undefined; area: { kind?: string; name?: string | null } | undefined; menu: boolean }> {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...at, id: 0 }] });
    await page.waitForTimeout(PRESS_MS);
    const result = {
        subject: await subjectKind(page),
        area: await chosen(page),
        menu: (await page.getByTestId("map-context-menu").count()) > 0,
    };
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return result;
}

test("🔴 A11: ein Tipp auf einen Weg öffnet sein Panel", async ({ page }) => {
    await open(page, "alle");
    const spot = await pathSpot(page);
    expect(spot, "ein benannter Weg im Bild").toBeDefined();
    await page.touchscreen.tap(spot!.x, spot!.y);
    await expect.poll(() => subjectKind(page), { timeout: 10_000 }).toBe("path");
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText(spot!.name);
    // Am Finger gibt es kein Zeigen: kein Schild, keine Strichelung.
    await expect(page.getByTestId("pointer-hint")).toHaveCount(0);
});

test("🔴 WI-0108: der lange Druck auf einen Weg wählt ihn NICHT, er öffnet das Kartenmenü", async ({ page }) => {
    await open(page, "alle");
    const spot = await pathSpot(page);
    expect(spot).toBeDefined();
    const client = await page.context().newCDPSession(page);
    const pressed = await longPress(client, page, { x: spot!.x, y: spot!.y });
    expect(pressed.subject, "kein Weg und kein Kartenpunkt").toBeUndefined();
    expect(pressed.area, "keine Auswahl").toBeUndefined();
    expect(pressed.menu, "das Kartenmenü steht").toBe(true);
});

test("🔴 WI-0108: der lange Druck auf die freie Karte öffnet dasselbe Menü", async ({ page }) => {
    await open(page, "alle");
    const spot = await freeSpot(page);
    if (spot === undefined) {
        test.info().annotations.push({ type: "Befund", description: "keine freie Stelle im Bild - nicht geprüft" });
        return;
    }
    const client = await page.context().newCDPSession(page);
    const pressed = await longPress(client, page, spot);
    expect(pressed.menu, "das Kartenmenü steht").toBe(true);
    expect(pressed.subject, "noch kein Kartenpunkt - der kommt aus dem Eintrag").toBeUndefined();
    // „Was ist hier?“ steht darin, und es führt zum Kartenpunkt an der Stelle des Drucks.
    await page.getByTestId("context-what-is-here").tap();
    await expect.poll(() => subjectKind(page), { timeout: 10_000 }).toBe("mapPoint");
    expect(await chosen(page), "kein Weg gewählt").toBeUndefined();
});
