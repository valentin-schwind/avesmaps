import { expect, test, type Page } from "@playwright/test";
import { createPropertyExpression, latest, type StylePropertySpecification } from "@maplibre/maplibre-gl-style-spec";
import { GARETH, openMap } from "./map-handle.ts";

/** MapLibres Spezifikation von `fill-opacity`; `latest` kennt sie nur ungetypt (vgl. `test/style-spec.ts`). */
const FILL_OPACITY_SPEC = (latest as unknown as Record<string, Record<string, StylePropertySpecification>>)[
    "paint_fill"
]?.["fill-opacity"];

/**
 * Die Suchkachel (WI-0013) am echten Stack: tippen, bestätigen, die Karte fährt hin.
 *
 * 🪤 Gemessen wird die KAMERA, nicht die Liste. Eine Liste mit dem richtigen Namen, nach dem die
 * Karte nicht fährt, wäre genau die halbe Funktion, die der Search Core vermeiden soll.
 */

/**
 * Wo die Suche gelandet ist. Seit WI-0218 landet jedes Hinfliegen in der Mitte der FREIEN Fläche (Planer und Infopanel
 * decken die Ränder), der Fluchtpunkt bleibt in der Bildmitte: gelesen wird, was in der freien Mitte liegt, nicht die
 * Bildmitte (dort lag Gareth 1,6 Einheiten daneben, die Bandmitte 88 Einheiten).
 */
async function cameraAt(page: Page): Promise<{ x: number; y: number; zoom: number }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) {
            throw new Error("map handle missing");
        }
        const { x, y } = globalThis.avesmapsVisibleArea!.centre();
        return { ...projection.fromRenderLngLat(map.unproject([x, y])), zoom: map.getZoom() };
    });
}

test("🔴 F öffnet die Suche, Return fährt zum ersten Treffer", async ({ page }) => {
    await page.goto("/#x=300.000&y=300.000&z=3.00&series=original");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    await page.keyboard.press("f");
    const input = page.getByTestId("search-input");
    await expect(input).toBeFocused();
    await input.fill("Gareth");
    // Der erste Treffer ist vorausgewählt; die Metropole steht über allem, was „Gareth" enthält.
    await expect(page.getByTestId("search-hit").first()).toContainText("Gareth");
    await expect(page.getByTestId("search-hit").first()).toContainText("Metropole");

    // 💣 Nichts liegt ÜBER der Suche. Im Eckknopf-Bund (eigener Stapelkontext) verdeckte das
    // Infopanel die ersten Buchstaben — der Treffer war da, nur nicht zu sehen.
    const obenauf = await page
        .getByTestId("search-hit")
        .first()
        .evaluate((hit) => {
            const box = hit.getBoundingClientRect();
            const oben = document.elementFromPoint(box.left + 4, box.top + box.height / 2);
            return oben !== null && hit.contains(oben);
        });
    expect(obenauf, "die linke Kante des ersten Treffers ist sichtbar").toBe(true);

    await input.press("Enter");

    await expect(page.getByTestId("search")).toBeHidden();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const camera = await cameraAt(page);
    expect(camera.x).toBeCloseTo(GARETH.x, 1);
    expect(camera.y).toBeCloseTo(GARETH.y, 1);
    expect(camera.zoom).toBeGreaterThanOrEqual(5);
});

/** Die Klimazonen, die unter der Mitte der freien Fläche gezeichnet sind (dort landet die Suche); wartet, bis dort eine Fläche liegt. */
async function climateZonesAtCenter(page: Page): Promise<unknown[]> {
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap;
            if (!map?.getLayer("climate-fill")) {
                return false;
            }
            const { x, y } = globalThis.avesmapsVisibleArea!.centre();
            return map.queryRenderedFeatures([x, y], { layers: ["climate-fill"] }).length > 0;
        },
        undefined,
        { timeout: 30_000 },
    );
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        const { x, y } = globalThis.avesmapsVisibleArea!.centre();
        return map
            .queryRenderedFeatures([x, y], { layers: ["climate-fill"] })
            .map((feature) => feature.properties["type_key"]);
    });
}

/**
 * Mit welcher Deckkraft der LEBENDE Stil die Zone `zone` gerade zeichnet, ausgerechnet von MapLibres
 * eigenem Auswerter.
 */
async function climateOpacity(page: Page, zone: string): Promise<number> {
    const wert = await page.evaluate(() => globalThis.avesmapsMap?.getPaintProperty("climate-fill", "fill-opacity"));
    if (!FILL_OPACITY_SPEC) {
        throw new Error("fill-opacity steht nicht in MapLibres Stilspezifikation");
    }
    const compiled = createPropertyExpression(wert as never, "fill-opacity", FILL_OPACITY_SPEC);
    if (compiled.result !== "success") {
        throw new Error("fill-opacity im Stil ungültig");
    }
    return compiled.value.evaluate({ zoom: 2 }, { type: "Polygon", properties: { type_key: zone } } as never) as number;
}

/**
 * 💣 Befund 2026-09-23: die Steppenzone stand zweimal in der Liste, und Return fuhr in die Südostecke
 * der Karte. Der Server lieferte Renderkoordinaten (x = ±20 037 508); die Karte las sie als
 * Karteneinheiten, und die Kamera stieß an ihre Grenze.
 *
 * Betreiberentscheidungen 2026-09-23: Das Sprungziel ist die Bandmitte auf der Mittelsenkrechten.
 * Die Karte schaltet von selbst auf Landschaften → Klimazonen, die gewählte Zone steht kräftiger,
 * und ein Klick irgendwo in die Karte beendet das.
 */
test("🔴 eine Klimazone: ein Treffer, Return schaltet auf die Klimazonen und hebt sie hervor", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Steppenzone");
    await expect(page.getByTestId("search-hit")).toHaveCount(1);
    await expect(page.getByTestId("search-hit")).toContainText("Klimazone");

    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const camera = await cameraAt(page);
    expect(camera.x, "auf der Mittelsenkrechten, nicht an einer Kante").toBeCloseTo(512, 0);
    expect(camera.zoom).toBeCloseTo(2, 1);

    // Kein Griff in den Fächer: die Suche hat die Ansicht selbst umgeschaltet.
    await expect(page.getByTestId("fan-toggle")).toHaveAttribute("title", "Ansicht: Derographie");
    // Gefragt wird die gezeichnete Fläche unter der Kamera, nicht eine Zahl aus der Antwort.
    expect(new Set(await climateZonesAtCenter(page))).toEqual(new Set(["trockene_subtropen"]));
    expect(await climateOpacity(page, "trockene_subtropen"), "die gewählte Zone steht kräftiger").toBeGreaterThan(
        await climateOpacity(page, "subtropisch"),
    );

    // Ein Klick irgendwo in die Karte, abseits der Bedienelemente, beendet die Hervorhebung.
    await page.getByTestId("map").click({ position: { x: 640, y: 560 } });
    const nachbar = await climateOpacity(page, "subtropisch");
    await expect.poll(() => climateOpacity(page, "trockene_subtropen")).toBe(nachbar);
});

/**
 * 💣 Die Gegenrichtung (Betreiberentscheidung 2026-09-23: „jede Suchklasse braucht ihre bevorzugte
 * Ansicht“). Nach einer Klimazone steht die Karte in der Klimaansicht, und die zeigt keine Orte. Ohne
 * den Wechsel führe die Suche nach Gareth hin und zeigte dort nichts.
 */
test("💣 aus der Klimaansicht schaltet ein Ort zurück auf Standard", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Steppenzone");
    await expect(page.getByTestId("search-hit")).toHaveCount(1);
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("fan-toggle")).toHaveAttribute("title", "Ansicht: Derographie");

    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Gareth");
    await expect(page.getByTestId("search-hit").first()).toContainText("Metropole");
    await page.getByTestId("search-input").press("Enter");

    await expect(page.getByTestId("fan-toggle")).toHaveAttribute("title", "Ansicht: Standard");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const camera = await cameraAt(page);
    expect(camera.x).toBeCloseTo(GARETH.x, 1);
    expect(camera.y).toBeCloseTo(GARETH.y, 1);
    // Der Ort steht wirklich auf der Karte: Ortsmarken sind gezeichnet.
    await page.waitForFunction(
        () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["place-marker"] }).length ?? 0) > 0,
        undefined,
        { timeout: 30_000 },
    );
});

test("💣 findet einen Weg aus getrennten Stücken — den Großen Fluss", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Große Fluss");
    await expect(page.getByTestId("search-hit").filter({ hasText: "Flussweg" })).toHaveCount(1);
});

test("Escape schließt, ohne die Karte zu bewegen", async ({ page }) => {
    await openMap(page);
    const vorher = await cameraAt(page);
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Havena");
    await page.getByTestId("search-input").press("Escape");
    await expect(page.getByTestId("search")).toBeHidden();
    const nachher = await cameraAt(page);
    expect(nachher.x).toBeCloseTo(vorher.x, 3);
    expect(nachher.y).toBeCloseTo(vorher.y, 3);
});

test("sagt, wenn nichts gefunden wurde, statt still leer zu bleiben", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Xyzzyqq");
    await expect(page.getByTestId("search-status")).toHaveText("Nichts gefunden.");
});
