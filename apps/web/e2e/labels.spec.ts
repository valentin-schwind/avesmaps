import { expect, test } from "@playwright/test";
import { renderZoomForBand } from "@avesmaps3d/shared";
import { chooseSeries, EDITOR_MODE, GARETH, onPage, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Map labels with self-hosted glyphs (chapter 2.1, integration gate 4.17.3).
 *
 * The glyphs are ours: no font service is contacted, and the typeface is the one the legacy map
 * uses, so names look the way readers know them.
 */

/** Die Ebenen der Ortsnamen: seit WI-0135 je Klasse und Seite eine. */
const ORTSNAMEN = "place-label-";
/** Gareth steht nach `isolateGareth` allein in der Ebene der Metropolen rechts vom Marker. */
const GARETH_EBENE = "place-label-metropole-right";

async function labelNames(page: import("@playwright/test").Page): Promise<string[]> {
    return page.evaluate((prefix) => {
        const map = globalThis.avesmapsMap;
        const layers = (map?.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id.startsWith(prefix));
        return (map?.queryRenderedFeatures({ layers }) ?? []).map((feature) => String(feature.properties["name"]));
    }, ORTSNAMEN);
}

test("draws place names from our own glyph files", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            consoleErrors.push(message.text());
        }
    });
    const glyphRequests: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/glyphs/")) {
            glyphRequests.push(request.url());
        }
    });

    await openMap(page);
    await showPlace(page, GARETH, 6);

    const names = await labelNames(page);
    expect(names, "the metropolis must be named").toContain("Gareth");
    expect(names.length).toBeGreaterThan(5);

    // The glyphs come from this origin, not from a font service.
    expect(glyphRequests.length, "the font must be loaded from our own path").toBeGreaterThan(0);
    for (const url of glyphRequests) {
        expect(new URL(url).host).toBe(new URL(page.url()).host);
    }
    expect(consoleErrors).toEqual([]);
});

test("keeps vector labels off the series that has them in the raster", async ({ page }) => {
    // The raster-labelled series is an editor tool: editor mode only (operator 2026-10-09), and only with the right to it - with
    // sign-in set up, the session decides, not `/edit` alone (`viewer/bootstrap-viewer.ts`, WI-0120 A9; WI-0192).
    await stubAdmin(page, {
        capabilities: ["view_editor_series", "use_editor_menu", "view_flow_directions"],
        role: "editor",
    });
    await openMap(page, EDITOR_MODE);
    await showPlace(page, GARETH, 6);
    expect(await labelNames(page), "the default series is labelled by us").toContain("Gareth");

    // "old" carries its names inside the image; a vector label would print every name twice.
    const tile = page.waitForResponse(
        // A tile, not the pointer: current.json answers 200 before any tile is drawn.
        (response) =>
            response.url().includes("/tiles/raster/old/") &&
            response.url().endsWith(".webp") &&
            response.status() === 200,
        { timeout: 30_000 },
    );
    await chooseSeries(page, "old");
    await tile;
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const hasLabelLayer = await page.evaluate(
        (prefix) => (globalThis.avesmapsMap?.getStyle().layers ?? []).some((layer) => layer.id.startsWith(prefix)),
        ORTSNAMEN,
    );
    expect(hasLabelLayer, "the label layer must be gone for this series").toBe(false);
});

test("drops names that do not fit instead of overprinting them", async ({ page }) => {
    await openMap(page);
    // The districts of Gareth sit almost on top of each other - the densest spot in the slice.
    await showPlace(page, GARETH, 6);

    const { placed, markers } = await page.evaluate((prefix) => {
        const map = globalThis.avesmapsMap;
        const layers = (map?.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id.startsWith(prefix));
        return {
            placed: (map?.queryRenderedFeatures({ layers }) ?? []).length,
            // 🪤 Kreise UND Rauten: seit WI-0011 steht ein Bauwerk ab Band 4 in einer eigenen Ebene.
            // Wer nur die Kreise zählt, verliert genau die dichten Burgen und Gebäude.
            markers: (map?.queryRenderedFeatures({ layers: ["place-marker", "place-marker-structure"] }) ?? []).length,
        };
    }, ORTSNAMEN);

    // Collision is on: far more places are drawn than names, because the names that would overlap
    // are left out rather than printed over each other.
    expect(markers).toBeGreaterThan(placed);
    expect(placed).toBeGreaterThan(0);
});

/**
 * Die Metropole Gareth allein auf leerem Canvas.
 *
 * 🪤 ALLES aus, dann der Messlayer. Hier stand eine Liste von Hand, und Wege, Kraftlinien und
 * Nodix-Punkte liefen an ihr vorbei: dunkelgraue Wege zählten als Tinte (2026-09-26).
 */
async function isolateGareth(page: import("@playwright/test").Page): Promise<void> {
    await page.evaluate((ebene) => {
        const map = globalThis.avesmapsMap as unknown as {
            getStyle(): { layers: { id: string }[] };
            setFilter(layer: string, filter: unknown): void;
            setLayoutProperty(layer: string, property: string, value: unknown): void;
        };
        for (const { id } of map.getStyle().layers) {
            map.setLayoutProperty(id, "visibility", "none");
        }
        map.setFilter(ebene, ["all", ["==", ["get", "name"], "Gareth"], ["==", ["get", "subtype"], "metropole"]]);
        map.setLayoutProperty(ebene, "text-allow-overlap", true);
        map.setLayoutProperty(ebene, "visibility", "visible");
    }, GARETH_EBENE);
}

/**
 * The one measurement that answers the layout-property question: text-size is not a paint
 * property, so whether MapLibre honours a zoom expression between integer zooms had to be looked
 * at rather than assumed. It does - and with a step expression it holds and jumps instead, which
 * is why the style interpolates.
 */
test("grows the label between two bands instead of holding and jumping", async ({ page }) => {
    await openMap(page);
    await isolateGareth(page);

    // 🪤 Gemessen wird der GANZE Canvas, kein Ausschnitt. Der Name steht rechts oder links neben
    // der Marke, vertikal mittig. Welche Seite er nimmt, entscheidet die Kollision mit dem Bestand,
    // und MapLibre behält die einmal gewählte Seite. Ein Ausschnitt unter dem Ort schnitt die obere
    // Hälfte ab. Auf dem leeren Canvas ist jedes deckende Pixel der Name, egal wo er steht.
    //
    // `showPlace` wartet einen Frame über `idle` hinaus (Begründung dort). Gelesen wird das Bild des
    // nächsten Frames direkt aus dem Canvas, noch im selben Frame, danach verwirft WebGL den Puffer.
    // Bedienleiste, Seitenfarbe und Thema liegen nicht im Canvas und zählen nicht mit.
    const inkWidth = async (band: number): Promise<number> => {
        await showPlace(page, GARETH, renderZoomForBand(band));
        return page.evaluate(
            () =>
                new Promise<number>((resolve, reject) => {
                    const map = globalThis.avesmapsMap;
                    if (!map) {
                        reject(new Error("map handle missing"));
                        return;
                    }
                    map.once("render", () => {
                        const source = map.getCanvas();
                        const copy = document.createElement("canvas");
                        copy.width = source.width;
                        copy.height = source.height;
                        const context = copy.getContext("2d");
                        if (!context) {
                            reject(new Error("no 2d context"));
                            return;
                        }
                        context.drawImage(source, 0, 0);
                        const { data } = context.getImageData(0, 0, copy.width, copy.height);
                        let left = Number.POSITIVE_INFINITY;
                        let right = -1;
                        for (let index = 3; index < data.length; index += 4) {
                            if ((data[index] ?? 0) > 127) {
                                const x = ((index - 3) / 4) % copy.width;
                                left = Math.min(left, x);
                                right = Math.max(right, x);
                            }
                        }
                        resolve(right < 0 ? 0 : right - left + 1);
                    });
                    map.triggerRepaint();
                }),
        );
    };

    // Band 3 declares 13, band 4 declares 17, so the drawn name has to widen on the way.
    // 🪤 BÄNDER über renderZoomForBand (WI-0015: Avesmaps3D z = Band + 1). Hier standen rohe Stufen,
    // die Band 2 bis 3 massen; bei Schriftfaktor 1,4 ging das zufällig durch, bei 1,0 nicht mehr.
    const atThree = await inkWidth(3);

    // Die Voraussetzung, nicht der Befund: EIN Name im Bild, und seine Größe kommt aus der
    // Bandtafel. Ein Override eines Editors hielte sie fest; dann misst dieser Test nichts.
    const gareth = await page.evaluate(
        (ebene) =>
            (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: [ebene] }) ?? []).map(
                (feature) => feature.properties,
            ),
        GARETH_EBENE,
    );
    expect(gareth, "genau ein Gareth auf dem Canvas").toHaveLength(1);
    expect(gareth[0], "Gareth ohne Größen-Override").not.toHaveProperty("label_size_override");

    const atHalf = await inkWidth(3.5);
    const atFour = await inkWidth(4);

    expect(atThree, "the label must be drawn at all").toBeGreaterThan(20);
    expect(atHalf, `Band 3,5 (${String(atHalf)} px) gegen Band 3 (${String(atThree)} px)`).toBeGreaterThan(atThree + 1);
    expect(atFour, `Band 4 (${String(atFour)} px) gegen Band 3,5 (${String(atHalf)} px)`).toBeGreaterThan(atHalf + 1);
});

/**
 * `showPlace` wartet einen Frame über `idle` hinaus (map-handle.ts). Ohne ihn bleibt ein Bild stehen,
 * das noch die Namen der alten Kachel trägt, und wer danach Pixel liest, liest die. Die Falle
 * braucht genau den Fall, mit dem die meisten Tests beginnen: den ersten Sprung nach dem Laden,
 * HERAUS über eine Kachelstufe (Startansicht z5 → z4).
 *
 * 🪤 Seit `fc4c60c7` (WI-0166) startet die Karte nach den Karteneinstellungen, über „Aventurien“ auf Zoom 2,5; der erste Sprung
 * zoomt dann HINEIN, und die Falle tritt gar nicht erst auf. Der Test öffnet deshalb ausdrücklich die alte Startansicht.
 */
test("showPlace leaves the settled frame on screen, not the one idle fired on", async ({ page }) => {
    await openMap(page, "/#x=520&y=500&z=5.00&series=modern");
    await isolateGareth(page);
    const start = await page.evaluate(() => globalThis.avesmapsMap?.getZoom() ?? 0);
    const target = renderZoomForBand(3);
    expect(Math.floor(start), "der erste Sprung zoomt über eine Kachelstufe heraus").toBeGreaterThan(
        Math.floor(target),
    );
    await showPlace(page, GARETH, target);

    const at = await page.evaluate((ebene) => {
        const map = globalThis.avesmapsMap;
        const [feature] = map?.queryRenderedFeatures({ layers: [ebene] }) ?? [];
        if (!map || !feature) {
            return undefined;
        }
        const [lng, lat] = feature.geometry.coordinates;
        return map.project({ lng, lat });
    }, GARETH_EBENE);
    if (!at) {
        throw new Error("Gareth steht nicht im Bild");
    }
    // Beide Seiten der Marke: der Name steht rechts oder links, vertikal mittig. Der Ausschnitt ist in Seitenkoordinaten.
    const p = await onPage(page, at);
    const clip = { x: Math.max(0, p.x - 200), y: Math.max(0, p.y - 40), width: 400, height: 80 };
    const shown = await page.screenshot({ clip });
    await settleFrame(page);
    const next = await page.screenshot({ clip });
    expect(shown.equals(next), "das Bild nach showPlace ist schon das fertige").toBe(true);
});
