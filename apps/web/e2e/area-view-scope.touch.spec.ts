import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Dieselbe Regel am Telefon (WI-0083): In Vegetation wählt ein Tipp den See oder das Meer nicht; in Topographie wählt er
 * ihn wie bisher. Seit dem Nachtrag (Betreiber 2026-10-05 „ja“) gilt dasselbe für den FLUSS, und „Was ist hier?“ nennt
 * nur noch die Landschaften der aktiven Ansicht. Am Rechner steht es in `area-view-scope.spec.ts`.
 *
 * 🔴 **Seit WI-0108 wählt der lange Druck gar nichts mehr** (Betreiber 2026-10-08: „langer tap ist rechtsklick“): Er
 * öffnet das Kartenmenü, in jeder Ansicht und über jeder Fläche. Die Zusicherung „kein langer Druck wählt ihn“ bleibt
 * damit erhalten und wird strenger - sie gilt jetzt für jede Ebene, nicht nur für die ausgeschlossene.
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis - und zwar GELESEN, WÄHREND
 * DER FINGER LIEGT. Beim Loslassen feuert MapLibre einen Klick, und auf dem Telefon deckt das inzwischen geöffnete Panel die
 * Stelle: Der Klick landete dann in einem Objektlink des Panels (gemessen 2026-10-05, ein Messartefakt, keine Kartenbedienung).
 *
 * 🪤 Die Stelle wird gesucht, nicht geraten: Ein Klick nimmt die kleinste Fläche darunter, und am Ochsenwasser liegt eine Insel.
 */

/** So lange liegt der Finger, bis der lange Druck sicher gefeuert hat (der Koordinator misst 550 ms). */
const PRESS_MS = 900;

const SEE = { x: 597.841, y: 549.016 };
const MEER = { x: 650, y: 480 };
/** Gareth am Großen Fluss: dort gibt es eine benannte Flusslinie. */
const FLUSS = { x: 551.625, y: 532.969 };

let round = 0;

async function open(page: Page, layer: string, probe: { x: number; y: number }): Promise<void> {
    round += 1;
    await page.goto(
        `/?r=${String(round)}#x=${String(probe.x)}&y=${String(probe.y)}&z=6.5&series=original&view=landscapes&layer=${layer}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

const AREA_LAYERS = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        (globalThis.avesmapsMap?.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter(
                // 🪤 Das Wasser steht in ZWEI Füllungen, seit das Meer als Grund unter den Landschaftsfüllungen liegt
                // (Nachtrag zu WI-0083): der See oben, das Meer unten. Wer nur die eine fragt, findet das Meer nicht.
                (id) => id === "gewaesser-flaeche" || id === "gewaesser-grund" || id.startsWith("landscape-fill-"),
            ),
    );

/** Eine Stelle im Bild, an der eine Fläche dieser Art die KLEINSTE unter dem Finger ist - also die, die ein Tipp nähme. */
async function smallestAt(page: Page, type: string): Promise<{ x: number; y: number }> {
    const layers = await AREA_LAYERS(page);
    const found = await page.evaluate(
        ({ ids, wanted }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            // Gesucht in Kartenkoordinaten, getippt in Seitenkoordinaten (im Editor-Modus steht über der Karte die Kopfleiste).
            const box = canvas.getBoundingClientRect();
            const size = (feature: { properties: Record<string, unknown> }): number => {
                const raw = Number(feature.properties["area"]);
                return Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
            };
            for (let y = 150; y < canvas.clientHeight - 150; y += 6) {
                for (let x = 40; x < canvas.clientWidth - 40; x += 6) {
                    const hits = map.queryRenderedFeatures([x, y], { layers: ids });
                    if (hits.length === 0) continue;
                    const smallest = hits.reduce((a, b) => (size(a) <= size(b) ? a : b));
                    if (String(smallest.properties["region_type"]) === wanted)
                        return { x: box.left + x, y: box.top + y };
                }
            }
            return undefined;
        },
        { ids: layers, wanted: type },
    );
    expect(found, `eine Stelle, an der „${type}“ die kleinste Fläche ist`).toBeDefined();
    return found as { x: number; y: number };
}

const subjectKind = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind);

const chosenType = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.type);

/** Der lange Druck, gelesen während der Finger liegt; danach wird losgelassen. */
async function longPress(
    client: CDPSession,
    page: Page,
    at: { x: number; y: number },
): Promise<{ subject: string | undefined; area: string | undefined; menu: boolean }> {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...at, id: 0 }] });
    await page.waitForTimeout(PRESS_MS);
    const result = {
        subject: await subjectKind(page),
        area: await chosenType(page),
        menu: (await page.getByTestId("map-context-menu").count()) > 0,
    };
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return result;
}

for (const [what, probe, art] of [
    ["See", SEE, "see"],
    ["Meer", MEER, "meer"],
] as const) {
    test(`🔴 Vegetation: ${what} ist gezeichnet, aber kein Tipp und kein langer Druck wählt ihn`, async ({ page }) => {
        await open(page, "vegetation", probe);
        const at = await smallestAt(page, art);
        await page.touchscreen.tap(at.x, at.y);
        await page.waitForTimeout(700);
        expect(await chosenType(page), `${what}: kein Tipp wählt ihn`).not.toBe(art);
        const client = await page.context().newCDPSession(page);
        const pressed = await longPress(client, page, at);
        expect(pressed.area, `${what}: kein langer Druck wählt ihn`).not.toBe(art);
        // 🔴 Seit WI-0108 ist der lange Druck der Rechtsklick: Er öffnet das Kartenmenü, statt zu wählen.
        expect(pressed.menu, "das Kartenmenü steht").toBe(true);
    });

    test(`🔴 Topographie: ein Tipp auf ${what} wählt ihn wie bisher`, async ({ page }) => {
        await open(page, "topographie", probe);
        const at = await smallestAt(page, art);
        await page.touchscreen.tap(at.x, at.y);
        await expect.poll(() => chosenType(page)).toBe(art);
    });
}

/**
 * Eine benannte Flusslinie im Bild, mit der Reichweite der Auswahl (`RIVER_REACH`) - und am Finger erreichbar: Am
 * Telefon liegen Fächer, Suche und die Randlasche über der Karte, und ein Tipp dort landet im Bauteil.
 */
const riverSpot = (page: Page): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        for (let y = 170; y < canvas.clientHeight - 170; y += 6) {
            for (let x = 40; x < canvas.clientWidth - 40; x += 6) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                const hits = map.queryRenderedFeatures(
                    [
                        [x - 5, y - 5],
                        [x + 5, y + 5],
                    ],
                    { layers: ["path-center-flussweg", "path-center-flussweg-bach"] },
                );
                if (hits.some((hit) => String(hit.properties["name"] ?? "").trim() !== "")) {
                    return { x: box.left + x, y: box.top + y };
                }
            }
        }
        return undefined;
    });

const chosenKind = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.kind);

test("🔴 Vegetation: der Fluss ist gezeichnet, aber kein Tipp und kein langer Druck wählt ihn", async ({ page }) => {
    await open(page, "vegetation", FLUSS);
    const river = await riverSpot(page);
    expect(river, "ein benannter Fluss im Bild").toBeDefined();
    const at = river as { x: number; y: number };
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(700);
    expect(await chosenKind(page), "kein Tipp wählt ihn").not.toBe("path");
    // 🪰 Der Tipp wählt in Vegetation die Fläche UNTER dem Fluss, und am Telefon deckt ihr Panel 388 der 412 px:
    // Ein langer Druck träfe das Panel, nicht die Karte, und der Fall wäre grün, ohne etwas zu prüfen. Erst räumen.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    const client = await page.context().newCDPSession(page);
    const pressed = await longPress(client, page, at);
    // Nicht der Fluss: Der lange Druck öffnet seit WI-0108 das Kartenmenü und wählt gar nichts.
    expect(pressed.area, "kein langer Druck wählt etwas").toBeUndefined();
    expect(pressed.menu, "das Kartenmenü steht").toBe(true);
});

test("🔴 Topographie: ein Tipp auf den Fluss wählt ihn (das Wasser ist hier zu Hause)", async ({ page }) => {
    await open(page, "topographie", FLUSS);
    const river = await riverSpot(page);
    expect(river, "ein benannter Fluss im Bild").toBeDefined();
    const at = river as { x: number; y: number };
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => chosenKind(page)).toBe("path");
});
