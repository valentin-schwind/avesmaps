import { expect, test, type Page } from "@playwright/test";
import { openMap, selectedPlace, settleFrame, showPlace, showLandscapes } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";
import type { Map as MapLibreMap } from "maplibre-gl";

const FELDEN = { name: "Felden (Gareth)", x: 553.928, y: 528.102 };
const AUMOND = "6f45f4eb-31b1-5cbc-a07e-f6ecfb8ef9b3";
const ALBERNIA = "f54e0e56-a7f5-45e3-ba6f-9d8febfbd316";

async function onlyMetropoles(page: Page, none = false): Promise<void> {
    await page.getByTestId("display-open").click();
    await page.getByTestId("display-place-metropole").click();
    if (none) await page.getByTestId("display-place-metropole").click();
    await page.getByTestId("display-open").click();
}

async function search(page: Page, name: string): Promise<void> {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(name);
    await page.getByTestId("search-hit").filter({ hasText: name }).first().click();
    await expect(page.getByTestId("info-title")).toHaveText(name);
}

async function drawn(page: Page, id: string): Promise<{ marker: boolean; names: string[] }> {
    return page.evaluate((publicId) => {
        const map = globalThis.avesmapsMap!;
        const count = (layer: string): boolean =>
            !!map.getLayer(layer) &&
            map
                .queryRenderedFeatures({ layers: [layer] })
                .some((feature) => feature.properties["public_id"] === publicId);
        // Seit WI-0135 stehen die Namen je Klasse in eigenen Ebenen; gezählt wird die Familie.
        const ids = map.getStyle().layers.map((layer) => layer.id);
        const familie = (name: string): string[] => ids.filter((id) => id === name || id.startsWith(`${name}-`));
        return {
            marker: ["place-marker", "place-marker-structure"].some(count),
            names: ["place-label", "place-active-label", "nodix-label"].filter((name) => familie(name).some(count)),
        };
    }, id);
}

async function visibleSelection(page: Page, expectedName?: string): Promise<string> {
    await expect.poll(() => selectedPlace(page)).toBeTruthy();
    if (expectedName) {
        await expect.poll(async () => (await selectedPlace(page))?.name).toBe(expectedName);
    }
    const place = (await selectedPlace(page))!;
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    await expect.poll(() => drawn(page, place.id)).toEqual({ marker: true, names: ["place-active-label"] });
    return place.id;
}

async function deselect(page: Page, id: string): Promise<void> {
    await page.keyboard.press("Escape");
    await expect.poll(() => selectedPlace(page)).toBeUndefined();
    await expect.poll(() => drawn(page, id)).toEqual({ marker: false, names: [] });
}

test("Spotlight: Marker und genau ein Name überleben Filter, Zoom und Ansichtswechsel; Auswahlende räumt sie ab", async ({
    page,
}) => {
    await openMap(page);
    await onlyMetropoles(page);
    await search(page, FELDEN.name);
    const id = await visibleSelection(page, FELDEN.name);
    await showPlace(page, FELDEN, 0);
    await visibleSelection(page, FELDEN.name);
    await showLandscapes(page, "klima");
    await visibleSelection(page, FELDEN.name);
    await deselect(page, id);
});

test("Nächsten Ort finden zeigt das ausgefilterte Dorf samt Namen", async ({ page }) => {
    await openMap(page);
    await onlyMetropoles(page);
    await showPlace(page, FELDEN, 8);
    const screen = await page.evaluate(
        (point) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(point)),
        FELDEN,
    );
    const box = (await page.getByTestId("map").boundingBox())!;
    await page.mouse.click(box.x + screen.x, box.y + screen.y, { button: "right" });
    await page.getByTestId("context-nearest").click();
    const id = await visibleSelection(page, FELDEN.name);
    await deselect(page, id);
});

test("Teiladresse und Wechsel des gewählten Ortes benutzen dieselbe Ausnahme", async ({ page }) => {
    await page.goto(`/?place=${AUMOND}`);
    await expect(page.getByTestId("info-title")).toHaveText("Aumond");
    await onlyMetropoles(page);
    await visibleSelection(page, "Aumond");
    await search(page, FELDEN.name);
    const id = await visibleSelection(page, FELDEN.name);
    expect(await drawn(page, AUMOND)).toEqual({ marker: false, names: [] });
    await deselect(page, id);
});

test("Kartenklick: nachträglich ausgeblendete Ortsklasse lässt die bestehende Markierung stehen", async ({ page }) => {
    await openMap(page);
    await showPlace(page, FELDEN, 8);
    const screen = await page.evaluate(
        (point) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(point)),
        FELDEN,
    );
    const box = (await page.getByTestId("map").boundingBox())!;
    await page.mouse.click(box.x + screen.x, box.y + screen.y);
    await visibleSelection(page, FELDEN.name);
    await onlyMetropoles(page);
    const id = await visibleSelection(page, FELDEN.name);
    await deselect(page, id);
});

test("Objektlink aus dem Panel öffnet und zeichnet seinen Ort auch bei ausgeschalteten Orten", async ({ page }) => {
    await openMap(page);
    await onlyMetropoles(page, true);
    await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "territory", id }), ALBERNIA);
    await expect(page.getByTestId("info-title")).toHaveText("Fürstentum Albernia");
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-standard").click();
    await onlyMetropoles(page, true);
    // Die Hauptstadt-Ausnahme der politischen Ansicht darf den Auswahlbeleg nicht vortäuschen.
    await expect.poll(() => drawn(page, "02606121-8dab-5fbd-a051-11f9ec262365")).toEqual({ marker: false, names: [] });
    await page
        .getByTestId("info-fact")
        .filter({ has: page.getByTestId("info-fact-label").getByText("Hauptstadt", { exact: true }) })
        .getByTestId("info-link")
        // Seit WI-0063 27.18 steht der Text des Gebietsexports im Link („Havena; bis 618 v. BF, 702-721 BF Honingen“, wie Legacy: der
        // ganze Text ist der Link auf den Ort der Kennung); er beginnt mit dem Ortsnamen.
        .filter({ hasText: /^Havena\b/ })
        .click();
    const id = await visibleSelection(page, "Havena");
    await deselect(page, id);
});

test("Ortswegpunkt des Planers öffnet dieselbe temporär sichtbare Markierung", async ({ page }) => {
    await page.goto(`/?route=${encodeURIComponent(FELDEN.name)}~Gareth`);
    await showStages(page, 25_000);
    await onlyMetropoles(page);
    await page
        .locator(".stage-link")
        .filter({ hasText: /^Felden/ })
        .first()
        .click();
    const id = await visibleSelection(page, FELDEN.name);
    await deselect(page, id);
});

test("die Auswahlbeschriftung bleibt auch bei nachgewiesener Kollision gezeichnet", async ({ page }) => {
    await openMap(page);
    await onlyMetropoles(page);
    await search(page, FELDEN.name);
    const id = await visibleSelection(page, FELDEN.name);
    await page.evaluate((publicId) => {
        const map = globalThis.avesmapsMap as unknown as MapLibreMap;
        map.addLayer({
            id: "test-collision-blocker",
            type: "symbol",
            source: "places",
            "source-layer": "place_render",
            filter: ["==", ["get", "public_id"], publicId],
            layout: {
                "text-field": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
                "text-font": ["Faculty Glyphic Regular"],
                "text-size": 60,
                "text-max-width": 1000,
                "text-allow-overlap": true,
            },
        });
        for (const layer of map.getStyle().layers) {
            if (layer.id.startsWith("place-active-label-"))
                map.setLayoutProperty(layer.id, "text-allow-overlap", false);
        }
    }, id);
    await settleFrame(page);
    await expect
        .poll(() =>
            page.evaluate(
                () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["test-collision-blocker"] }).length,
            ),
        )
        .toBeGreaterThan(0);
    await expect.poll(async () => (await drawn(page, id)).names).toEqual([]);
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as MapLibreMap;
        for (const layer of map.getStyle().layers) {
            if (layer.id.startsWith("place-active-label-")) map.setLayoutProperty(layer.id, "text-allow-overlap", true);
        }
    });
    await visibleSelection(page, FELDEN.name);
});
