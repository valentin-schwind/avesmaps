import { expect, test, type Page } from "@playwright/test";
import { GARETH, settleFrame } from "./map-handle.ts";

/**
 * Ein Gegenstand ohne Namen heißt im Panel nach dem Satz seiner Art (WI-0105).
 *
 * 🔴 Der Betreiber hat es an Wegen gemeldet („wege mit generischen namen wie Pfad-3443 … als ‚Unbezeichneter
 * Pfad‘ … betiteln“) und auf Flächen erweitert („‚Wald-925‘ sollte zu ‚Unbezeichneter Wald‘“).
 *
 * 🪤 Die Stellen werden GESUCHT, nicht geraten: Welcher Weg und welche Fläche wo liegt, hängt an Zoom,
 * Fenstergröße und Kachelstand. Gesucht wird in derselben Trefferebene, die der Besitzer fragt - und zwar
 * gezielt nach einem Weg, dessen Kachelname ein Griff IST. 5.092 von 9.506 aktiven Wegen tragen einen, die
 * Trefferebenen kennen `label_visible` nicht, also liegen sie wirklich im Bild.
 */

/** Legacys Griff-Muster, Zeichen für Zeichen wie `isPathHandle`. */
const GRIFF = /^\S+-\d+$/u;

async function openMap(page: Page, tag: string, layer = "alle", zoom = 6.5): Promise<void> {
    await page.goto(
        `/?wi0105=${tag}#x=${String(GARETH.x)}&y=${String(GARETH.y)}&z=${String(zoom)}&series=original&view=landscapes&layer=${layer}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await settleFrame(page);
}

const hitLayers = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        (globalThis.avesmapsMap?.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("path-hit-")),
    );

interface Spot {
    x: number;
    y: number;
    name: string;
    subtype: string;
}

/** Eine Stelle, an der ein Weg mit GRIFF unter dem Zeiger liegt und die Leinwand vorn ist. */
async function handleSpot(page: Page): Promise<Spot | undefined> {
    const layers = await hitLayers(page);
    if (layers.length === 0) return undefined;
    return page.evaluate(
        ({ ids, griff }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const pattern = new RegExp(griff, "u");
            const canvas = map.getCanvas();
            const box = canvas.getBoundingClientRect();
            for (let y = 150; y < canvas.clientHeight - 150; y += 4) {
                for (let x = 420; x < canvas.clientWidth - 440; x += 4) {
                    if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                    const first = map.queryRenderedFeatures([x, y], { layers: ids })[0];
                    if (!first) continue;
                    const name = String(first.properties["name"] ?? "").trim();
                    if (!pattern.test(name)) continue;
                    return { x, y, name, subtype: String(first.properties["subtype"]) };
                }
            }
            return undefined;
        },
        { ids: layers, griff: GRIFF.source },
    );
}

/** Eine Stelle, an der eine Landschaftsfläche mit GRIFF unter dem Zeiger liegt. */
async function handleArea(page: Page): Promise<{ x: number; y: number; name: string; type: string } | undefined> {
    return page.evaluate((griff) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const pattern = new RegExp(griff, "iu");
        const layers = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        if (layers.length === 0) return undefined;
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        for (let y = 150; y < canvas.clientHeight - 150; y += 6) {
            for (let x = 420; x < canvas.clientWidth - 440; x += 6) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                for (const hit of map.queryRenderedFeatures([x, y], { layers })) {
                    const name = String(hit.properties["name"] ?? "").trim();
                    if (!pattern.test(name)) continue;
                    return { x, y, name, type: String(hit.properties["region_type"] ?? "") };
                }
            }
        }
        return undefined;
    }, GRIFF.source);
}

async function windowPoint(page: Page, spot: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    return { x: (box?.x ?? 0) + spot.x, y: (box?.y ?? 0) + spot.y };
}

async function click(page: Page, spot: { x: number; y: number }): Promise<void> {
    const at = await windowPoint(page, spot);
    await page.mouse.click(at.x, at.y);
    await page
        .waitForFunction(() => globalThis.avesmapsSelectedSubject?.() !== undefined, undefined, { timeout: 10_000 })
        .catch(() => undefined);
}

async function hover(page: Page, spot: { x: number; y: number }): Promise<void> {
    const at = await windowPoint(page, spot);
    await page.mouse.move(at.x - 30, at.y - 30);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.waitForTimeout(400);
}

// -----------------------------------------------------------------------------------------------------------------

test("🔴 A1: ein Weg mit Griff heißt im Panel „Unbezeichneter …“ - und nie mehr „Pfad-3443“", async ({ page }) => {
    await openMap(page, "weg");
    const spot = await handleSpot(page);
    expect(spot, "ein Weg mit Griff im Bild").toBeDefined();
    expect(spot!.name, "die Kachel trägt weiter den ROHEN Griff - die Daten sind unberührt").toMatch(GRIFF);

    await click(page, spot!);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    const titel = page.getByTestId("info-title");
    await expect(titel).not.toHaveText(spot!.name);
    // 🔴 Der eigentliche Satz, abgelesen statt behauptet.
    await expect(titel).toHaveText(/^Unbe(?:zeichnet|nannt)(?:er|e|es) /u);
    // Fünf Arten tragen den neuen Wortlaut; vier warten auf einen Wortlaut des Betreibers.
    if (["Pfad", "Strasse", "Weg", "Flussweg"].includes(spot!.subtype)) {
        await expect(titel).toHaveText(/^Unbezeichnete(?:r)? /u);
    }
    // 💣 Die Identität bleibt der rohe Name: ohne ihn fände die goldene Markierung die Kacheln nicht.
    expect(await page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.name)).toBe(spot!.name);
});

test("🔴 A2: das Zeiger-Schild eines Wegs mit Griff zeigt den Satz, nicht den Griff", async ({ page }) => {
    await openMap(page, "schild");
    const spot = await handleSpot(page);
    expect(spot, "ein Weg mit Griff im Bild").toBeDefined();
    await hover(page, spot!);
    const schild = page.getByTestId("pointer-hint");
    await expect(schild).toBeVisible();
    await expect(schild).not.toContainText(spot!.name);
    await expect(schild).toContainText(/Unbe(?:zeichnet|nannt)(?:er|e|es) /u);
});

test("🔴 A3: eine Fläche mit Griff heißt im Panel nach ihrer Art („Wald“) - kein Griff, kein „Unbezeichneter“, keine Dopplung", async ({
    page,
}) => {
    // OPS-073 (Thomas: „unbekannter Wald“ wirke total unprofessionell): vorher „Unbezeichneter Wald“, WI-0105 davor die blanke Art.
    // 🪤 Die Stelle wird GESUCHT, und sie wird weit weg gesucht: Um Gareth tragen alle sichtbaren Flächen
    // einen echten Namen. In der Vegetationsansicht bei Zoom 5 liegen die 2.597 namenlosen Wälder im Bild.
    await openMap(page, "flaeche", "vegetation", 5);
    const stelle = await handleArea(page);
    expect(stelle, "eine Fläche mit Griff im Bild").toBeDefined();
    expect(stelle!.name).toMatch(/^\S+-\d+$/u);

    await click(page, stelle!);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    const titel = page.getByTestId("info-title");
    // Erst warten, bis ein Titel da ist: Ein leerer Titel erfüllt jedes `not.toHaveText`.
    await expect(titel).toHaveText(/\S/u);
    await expect(titel).not.toHaveText(stelle!.name);
    await expect(titel).not.toHaveText(/^Unbezeichnet/u);
    const titelText = ((await titel.textContent()) ?? "").trim();
    expect(titelText, "der Titel ist die Art in der Sprache der Seite").not.toBe("");
    // 🪤 Titel und Untertitel sagen nicht dasselbe Wort doppelt: Die Art steht nur noch im Titel.
    const untertitel = page.getByTestId("info-subtitle");
    if ((await untertitel.count()) > 0) {
        const eintraege = (((await untertitel.first().textContent()) ?? "").split("·") ?? []).map((e) => e.trim());
        expect(eintraege, "die Art nicht noch einmal unter ihrem Titel").not.toContain(titelText);
    }
});

test("🔴 A4: ein Griff belegt keine Zeile der Trefferliste", async ({ page }) => {
    await openMap(page, "suche");
    const spot = await handleSpot(page);
    expect(spot, "ein Weg mit Griff im Bild").toBeDefined();

    // Gelesen wird die ANTWORT DES SERVERS, nicht nur die Liste: Der Riegel sitzt in der Abfrage.
    const antwort = page.waitForResponse(
        (response) => response.url().includes(`/api/search?q=${encodeURIComponent(spot!.name)}`) && response.ok(),
    );
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(spot!.name);
    const treffer = (await (await antwort).json()) as { hits: { kind: string; name: string }[] };
    expect(treffer.hits.filter((hit) => hit.kind === "weg").map((hit) => hit.name)).toEqual([]);
    await expect(page.getByTestId("search-hit").filter({ hasText: spot!.name })).toHaveCount(0);
});
