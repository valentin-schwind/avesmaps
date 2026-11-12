import { expect, test, type Page } from "@playwright/test";
import { chooseView, GARETH, openMap, settleFrame, showPlace } from "./map-handle.ts";

/**
 * Die Kraftlinien-Ansicht im Browser (WI-0025), gegen echtes PostGIS, Martin und Fastify.
 *
 * 🔴 Braucht einen Martin, der `powerline_render` und `ley_node_render` kennt - also einen, der nach
 * Migration 0043 gestartet wurde - und die 45 Kraftlinienpunkte in der Datenbank (Contract Version 2).
 * Martin liest seinen Katalog nur beim Start und hält Kacheln im Speicher. Die Bögen brauchen dazu
 * Fastify mit `GET /api/powerlines`.
 *
 * Die Stellen sind Mitten echter Linien aus dem Bestand (Snapshot 140088), in Kartenkoordinaten.
 */

/** Was der Bogen-Layer über sich sagt (Entwicklergriff, `powerline-arcs.ts`). */
interface ArcsState {
    active: boolean;
    ready: boolean;
    failed: boolean;
    lines: number;
    lift: number;
    animating: boolean;
    time: number;
    uprightNames: number;
    flatNamesVisible: boolean | undefined;
    /** Linienenden auf dem Gelände (WI-0049); geprüft in terrain.spec.ts, mit Grafikkarte. */
    groundedEnds: number;
    /** Wie viele Knoten als glühende Punkte gezeichnet werden, und welcher gewählt glüht. */
    nodes: number;
    highlightedNode: string | undefined;
    highlighted: number;
}

declare global {
    var avesmapsPowerlineArcs: { state(): ArcsState } | undefined;
}

/** Einsegmentig, 149 Einheiten lang, beschriftet. */
const MITTELLANDLINIE = { x: 624.442, y: 614.598 };
/**
 * Auf dem Runenpfad der Hjaldinger, ein Fünftel vom Ende - weit weg von seiner Mitte (426, 825). Die
 * Linie ist einsegmentig und 334 Einheiten lang, länger als jede Kachel ab Stufe 3.
 */
const RUNENPFAD_FUENFTEL = { x: 509.646, y: 880.625 };
/** −9 % Bogen, vier Segmente. */
const CHALWENS_GRIFF = { x: 823.569, y: 297.657 };
/** Ein Kraftlinienpunkt bei den Zyklopeninseln, an dem sechs Linienenden zusammenlaufen. */
const ZYKLOPEN_PUNKT = { x: 329.1, y: 348.1 };
/** Ein Dorf ohne Nodix-Kennzeichen, an dem Satinavs Kette II endet (Befund KL5). */
const DRAGENFELD = { x: 651.563, y: 668.898 };

const FLACHE_LAGEN = ["powerline-aura", "powerline-mitte", "powerline-kern"];
/** Die unsichtbare Trefferfläche der Knoten (`NODIX_HIT_LAYER_ID`); sichtbar zeichnen die Bögen sie als glühende Punkte. */
const KNOTEN_TREFFER = "nodix-treffer";

async function waitForRendered(page: Page, layer: string | string[]): Promise<void> {
    await page.waitForFunction(
        (ids) => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ids }).length ?? 0) > 0,
        Array.isArray(layer) ? layer : [layer],
        { timeout: 30_000 },
    );
}

async function rendered(page: Page, layer: string | string[]): Promise<{ name: string; punkte: number }[]> {
    return page.evaluate(
        (ids) => {
            const map = globalThis.avesmapsMap;
            if (!map) {
                throw new Error("map handle missing");
            }
            return map.queryRenderedFeatures({ layers: ids }).map((feature) => {
                const geometry = feature.geometry as unknown as { type: string; coordinates: unknown[] };
                return {
                    name: String(feature.properties["name"] ?? ""),
                    punkte: geometry.type === "LineString" ? geometry.coordinates.length : 0,
                };
            });
        },
        Array.isArray(layer) ? layer : [layer],
    );
}

/** Die Namen der Metropolen unter den Nodices, rechts und links vom Knoten (WI-0135: je Klasse und Seite eine Ebene). */
const METROPOLEN_NAMEN = ["nodix-label-metropole-right", "nodix-label-metropole-left"];

/** Die Linien aus den Kacheln, gleich ob ein Layer sie zeichnet (die Bögen zeichnet ein Custom Layer). */
async function kachelLinien(page: Page): Promise<{ name: string; punkte: number }[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            querySourceFeatures(
                source: string,
                options: { sourceLayer: string },
            ): { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown[] } }[];
        };
        return map.querySourceFeatures("powerlines", { sourceLayer: "powerline_render" }).map((feature) => ({
            name: String(feature.properties["name"] ?? ""),
            punkte: feature.geometry.type === "LineString" ? feature.geometry.coordinates.length : 0,
        }));
    });
}

/** Alle Layer der Karte, auch der Custom Layer (den `getStyle()` nicht nennt). */
async function layerIds(page: Page): Promise<string[]> {
    return page.evaluate(
        () => (globalThis.avesmapsMap as unknown as { getLayersOrder(): string[] } | undefined)?.getLayersOrder() ?? [],
    );
}

async function arcs(page: Page): Promise<ArcsState | undefined> {
    return page.evaluate(() => globalThis.avesmapsPowerlineArcs?.state());
}

async function waitForArcs(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const zustand = globalThis.avesmapsPowerlineArcs?.state();
            return zustand?.ready === true && zustand.active;
        },
        undefined,
        { timeout: 30_000 },
    );
}

async function neige(page: Page, pitch: number): Promise<void> {
    await page.evaluate(async (neigung) => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        map.jumpTo({ pitch: neigung });
        await new Promise<void>((resolve) => map.once("idle", resolve));
    }, pitch);
    await settleFrame(page);
}

test("🔴 der Fächer wählt die Kraftlinien: Bögen statt flacher Lagen, Gelände entsättigt, sonst nichts", async ({
    page,
}) => {
    await openMap(page);
    await chooseView(page, "powerlines");
    await expect(page).toHaveURL(/view=powerlines/);
    await expect(page.getByTestId("fan-toggle")).toContainText("Kraftlinien");

    await showPlace(page, MITTELLANDLINIE, 5);
    await waitForArcs(page);
    expect((await arcs(page))?.lines, "das ganze Netz aus /api/powerlines").toBeGreaterThan(100);
    const ids = await layerIds(page);
    expect(ids).toEqual(
        expect.arrayContaining([
            "powerline-boegen",
            "nodix-gluehen",
            "powerline-label",
            KNOTEN_TREFFER,
            ...METROPOLEN_NAMEN,
        ]),
    );
    expect(
        ids.filter((id) => FLACHE_LAGEN.includes(id)),
        "die flachen Lagen sind der Rückfall - mit den Bögen stünde jede Linie doppelt",
    ).toEqual([]);
    // Die Bögen liegen unter den Knoten: Die glühenden Knoten (Betreiber 2026-10-11) und ihre Namen bleiben obenauf, und
    // die Scheiben sind der Rückfall, wie die flachen Lagen.
    expect(ids.indexOf("powerline-boegen")).toBeLessThan(ids.indexOf(KNOTEN_TREFFER));
    expect(ids.indexOf("nodix-gluehen")).toBeGreaterThan(ids.indexOf("powerline-boegen"));
    expect(ids.indexOf("nodix-gluehen")).toBeLessThan(Math.min(...METROPOLEN_NAMEN.map((id) => ids.indexOf(id))));
    expect(ids.filter((id) => ["nodix-schein", "nodix-hof", "nodix-ring", "nodix-kern"].includes(id))).toEqual([]);
    expect(
        ids.filter((id) => id.startsWith("place-") || id.startsWith("path-") || id.startsWith("landscape")),
        "die Ansicht zeigt nur Nodices und Kraftlinien (Betreiber 2026-09-23)",
    ).toEqual([]);

    const tint = await page.evaluate(() => ({
        saettigung: globalThis.avesmapsMap?.getPaintProperty("basemap", "raster-saturation"),
        helligkeit: globalThis.avesmapsMap?.getPaintProperty("basemap", "raster-brightness-max"),
    }));
    expect(tint.saettigung as number).toBeCloseTo(-0.9, 9);
    expect(tint.helligkeit).toBe(0.6);
});

test("ein geteilter Link öffnet die Kraftlinien-Ansicht", async ({ page }) => {
    await openMap(page);
    await chooseView(page, "powerlines");
    await expect(page).toHaveURL(/view=powerlines/);
    const link = page.url();

    await page.goto("about:blank");
    await page.goto(link);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("fan-toggle")).toContainText("Kraftlinien");
    await waitForArcs(page);
});

test("🪤 Namen erst ab Legacys Stufe 2, bei uns 3 - die Linien schon vorher", async ({ page }) => {
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, MITTELLANDLINIE, 2.6);
    // Die Linien zeichnet der Bogen-Layer aus dem ganzen Netz, auf jeder Stufe. Kacheln braucht unter
    // Stufe 3 niemand mehr: der einzige Layer auf ihnen, die Namen, beginnt erst dort.
    await waitForArcs(page);
    expect((await arcs(page))?.lines).toBeGreaterThan(100);
    expect(await rendered(page, "powerline-label")).toEqual([]);

    await showPlace(page, MITTELLANDLINIE, 3.2);
    await waitForRendered(page, "powerline-label");
});

test("die gebogene Linie kommt gebogen an, die gerade mit zwei Punkten", async ({ page }) => {
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, CHALWENS_GRIFF, 5);
    await expect
        .poll(async () => (await kachelLinien(page)).filter((f) => f.name === "Chalwens Griff").length, {
            timeout: 30_000,
        })
        .toBeGreaterThan(0);
    const griff = (await kachelLinien(page)).filter((feature) => feature.name === "Chalwens Griff");
    // −9 % ergibt 12 Stützpunkte; ein Kachelschnitt kann einen Teil davon abschneiden, eine Gerade hätte 2.
    expect(Math.max(...griff.map((feature) => feature.punkte))).toBeGreaterThan(4);
});

test("💣 die Standardansicht fragt weder Kraftlinienkacheln noch das Netz an", async ({ page }) => {
    const angefragt: string[] = [];
    page.on("request", (request) => {
        const pfad = new URL(request.url()).pathname;
        if (
            pfad.startsWith("/tiles/vector/powerline") ||
            pfad.startsWith("/tiles/vector/ley_node") ||
            pfad === "/api/powerlines"
        ) {
            angefragt.push(pfad);
        }
    });
    await openMap(page);
    await showPlace(page, MITTELLANDLINIE, 5);
    await page.waitForTimeout(1500);
    expect(angefragt).toEqual([]);
});

test("💣 nah dran bleibt der Name im Bild, auch fern der Linienmitte (Betreiber 2026-09-23)", async ({ page }) => {
    // Regression: „Das Zoomverhalten der Kraftlinienbeschriftungen ist noch ein bisschen komisch“.
    // Stand der Name einmal in der Abschnittsmitte (Legacy), wanderte er beim Hineinzoomen aus dem
    // Bild, und die Linie lief namenlos durch den Ausschnitt. Jetzt wiederholt er sich entlang der Linie.
    await openMap(page);
    await chooseView(page, "powerlines");
    for (const zoom of [3.4, 4.2, 5.2, 6.2, 7.2]) {
        await showPlace(page, RUNENPFAD_FUENFTEL, zoom);
        await waitForRendered(page, "powerline-label");
        const namen = (await rendered(page, "powerline-label")).map((feature) => feature.name);
        expect(namen, `Stufe ${String(zoom)}`).toContain("Runenpfad der Hjaldinger");
    }
});

test("🔴 die Nodices leuchten als Knoten mit Namen, auch im Überblick - sonst kein Ort", async ({ page }) => {
    // Betreiber 2026-09-23: „ortsmarkierungen von nodices fehlen noch wie in legacy“.
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 3);
    await waitForRendered(page, KNOTEN_TREFFER);
    const knoten = (await rendered(page, KNOTEN_TREFFER)).map((feature) => feature.name);
    expect(knoten).toContain("Gareth");
    // Gezeichnet als glühende Punkte der Bögen: die Knoten der Kacheln, je einmal.
    await expect.poll(async () => (await arcs(page))?.nodes ?? 0).toBeGreaterThan(5);
    await waitForRendered(page, METROPOLEN_NAMEN);
    expect((await rendered(page, METROPOLEN_NAMEN)).map((feature) => feature.name)).toContain("Gareth");
    expect(
        (await layerIds(page)).filter((id) => id.startsWith("place-")),
        "gewöhnliche Orte zeigt die Ansicht nicht",
    ).toEqual([]);
});

test("🔴 jedes Linienende ist ein Knoten: Dragenfeld hat kein Nodix-Kennzeichen und leuchtet trotzdem", async ({
    page,
}) => {
    // Betreiber 2026-09-23: „nodix knoten: nicht nur orte sondern auch flächen oder labels können nodix
    // sein“. Satinavs Kette II endet in Dragenfeld; dort landete der Bogen bisher im Nichts (KL5).
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, DRAGENFELD, 4);
    await waitForRendered(page, KNOTEN_TREFFER);
    expect((await rendered(page, KNOTEN_TREFFER)).map((feature) => feature.name)).toContain("Dragenfeld");
});

test("🔴 ein Kraftlinienpunkt ist ein Knoten - auch dort, wo sechs Linien zusammenlaufen", async ({ page }) => {
    // Betreiber 2026-09-26: „Kraftlinienpunkte a.k.a. Nodix“ als eigenes Objekt, und an den Treffpunkten
    // „richtig, dort landen, wie bei knoten“.
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, ZYKLOPEN_PUNKT, 5);
    await waitForRendered(page, KNOTEN_TREFFER);
    const arten = await page.evaluate(
        (id) =>
            (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: [id] }) ?? []).map((feature) =>
                String(feature.properties["node_kind"] ?? ""),
            ),
        KNOTEN_TREFFER,
    );
    expect(arten).toContain("nodix");
});

test("🔴 ein Klick auf einen Nodix wählt den Ort, und sein Knoten glüht in der Auswahl", async ({ page }) => {
    // Betreiber 2026-10-11: „im kraftlinien editor nicht auf die nodices klicken kann“, „beim anklicken: auch das gelb-orange“.
    // Vorher traf der Klick auf Gareth die Kraftlinie darunter (Chalwens Griff), nicht den Ort.
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 6);
    await waitForArcs(page);
    await waitForRendered(page, KNOTEN_TREFFER);
    await settleFrame(page);
    const mitte = await page.evaluate(
        ({ id, ort }) => {
            const map = globalThis.avesmapsMap;
            const gareth = map?.queryRenderedFeatures({ layers: [id] }).find((f) => f.properties["name"] === ort);
            if (!map || !gareth) throw new Error("Gareth nicht als Knoten im Bild");
            const [lng, lat] = gareth.geometry.coordinates;
            const p = map.project({ lng, lat });
            const r = map.getCanvas().getBoundingClientRect();
            return { x: r.left + p.x, y: r.top + p.y, kennung: String(gareth.properties["public_id"]) };
        },
        { id: KNOTEN_TREFFER, ort: "Gareth" },
    );
    await page.mouse.click(mitte.x, mitte.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    expect(await page.evaluate(() => globalThis.avesmapsSelectedPlace?.()?.name)).toBe("Gareth");
    await expect.poll(async () => (await arcs(page))?.highlightedNode).toBe(mitte.kennung);
    // Keine Kraftlinie gewählt: Der Klick gehört dem Ort.
    expect((await arcs(page))?.highlighted).toBe(0);
});

test("🔴 geneigt steigen die Bögen, und die Namen stehen auf - flach liegen sie auf der Legacy-Bahn", async ({
    page,
}) => {
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 4.5);
    await waitForArcs(page);
    await neige(page, 0);
    expect(await arcs(page)).toMatchObject({ lift: 0, uprightNames: 0, flatNamesVisible: true });

    // Der 3D-Knopf kippt auf 45°: dort stehen die Bögen ganz.
    await neige(page, 45);
    await page.waitForFunction(() => (globalThis.avesmapsPowerlineArcs?.state().uprightNames ?? 0) > 0, undefined, {
        timeout: 15_000,
    });
    const geneigt = await arcs(page);
    expect(geneigt?.lift).toBe(1);
    expect(geneigt?.flatNamesVisible, "aufrecht stehen die Namen am Bogen, nicht noch einmal flach").toBe(false);

    // Zurück in die Fläche: die flachen Namen kehren zurück.
    await neige(page, 0);
    expect(await arcs(page)).toMatchObject({ lift: 0, flatNamesVisible: true });
});

test("🔴 die Stränge wabern mit Legacys 30 Bildern je Sekunde", async ({ page }) => {
    // Betreiber 2026-09-23: „bögen sollen animiert sein“.
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 4.5);
    await waitForArcs(page);
    const vorher = (await arcs(page))?.time ?? 0;
    await page.waitForTimeout(600);
    const nachher = (await arcs(page))?.time ?? 0;
    expect((await arcs(page))?.animating).toBe(true);
    expect(nachher - vorher).toBeGreaterThan(0.3);
});

test("bei „Bewegung reduzieren“ stehen die Stränge still, die Bögen bleiben", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 4.5);
    await waitForArcs(page);
    await page.waitForTimeout(400);
    expect(await arcs(page)).toMatchObject({ animating: false, time: 0 });
    await neige(page, 45);
    expect((await arcs(page))?.lift).toBe(1);
});

test("🪤 ohne das Netz fällt die Ansicht auf die flachen Lagen zurück, statt leer zu sein", async ({ page }) => {
    // Zum Beispiel auf Stage, bevor Fastify die Route kennt.
    await page.route("**/api/powerlines", (route) => route.fulfill({ status: 503, body: "{}" }));
    await openMap(page);
    await chooseView(page, "powerlines");
    await showPlace(page, MITTELLANDLINIE, 5);
    await waitForRendered(page, "powerline-kern");
    await expect.poll(async () => (await arcs(page))?.failed).toBe(true);
    expect(await layerIds(page)).not.toContain("powerline-boegen");
});
