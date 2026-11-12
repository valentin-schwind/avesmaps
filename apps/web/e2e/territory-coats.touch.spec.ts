import { expect, test } from "@playwright/test";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, TERRITORY_COATS_URL, politicalMinZoom } from "@avesmaps3d/shared";
import { openMap, settleFrame, showPlace } from "./map-handle.ts";
import { centreX, measureLabelInk } from "./territory-coat-ink.ts";

/**
 * Das Wappen am Gebietsnamen am Telefon (WI-0121): gebrochene Pixeldichte (Pixel 7: 2,625) und der Vorzug der Bänder am
 * Telefon (Band 3 beginnt bei Zoom 3, nicht bei 4). Die Messung steht in `territory-coats.spec.ts`; hier geht es um das, was
 * nur am Gerät anders ist: Das Bild wird auf 40 mal Pixeldichte gerechnet und steht doch 40 logische Pixel hoch.
 */

const GREIFENFURT = { x: 512.3, y: 594.1, name: "Markgrafschaft Greifenfurt" };

test("🔴 am Telefon steht das Wappen über dem Namen, auf 105 Bildpunkte gerechnet und 40 logische Pixel hoch", async ({
    page,
}) => {
    const liste = await page.request.get(TERRITORY_COATS_URL);
    expect(liste.status(), "die Wappenliste muss da sein").toBe(200);
    await openMap(page);
    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-view-political").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();

    const zoom = politicalMinZoom(3, AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoomPhone) + 0.5;
    await showPlace(page, GREIFENFURT, zoom);
    await expect
        .poll(
            () =>
                page.evaluate(
                    (name) =>
                        globalThis
                            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                            .some((feature) => feature.properties["name"] === name),
                    GREIFENFURT.name,
                ),
            { timeout: 30_000 },
        )
        .toBe(true);
    await settleFrame(page);
    const anchor = await page.evaluate((name) => {
        const feature = globalThis
            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
            .find((candidate) => candidate.properties["name"] === name)!;
        return {
            lng: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            id: String(feature.properties["territory_public_id"]),
        };
    }, GREIFENFURT.name);

    const bilder = await page.evaluate(() => {
        const images = (
            globalThis.avesmapsMap as unknown as {
                style: {
                    imageManager: {
                        images: Record<string, { data: { width: number; height: number }; pixelRatio: number }>;
                    };
                };
            }
        ).style.imageManager.images;
        return Object.entries(images)
            .filter(([id]) => id.startsWith("coat:"))
            .map(([, image]) => ({
                kante: Math.max(image.data.width, image.data.height),
                pixelRatio: image.pixelRatio,
                geraet: globalThis.devicePixelRatio,
            }));
    });
    expect(bilder.length).toBeGreaterThan(3);
    for (const bild of bilder) {
        // Die lange Kante ist 40 mal Pixeldichte (gerundet), nie mehr; die Pixeldichte macht daraus 40 logische Pixel.
        expect(bild.kante).toBeLessThanOrEqual(Math.round(40 * bild.geraet));
        expect(bild.kante / bild.pixelRatio).toBeCloseTo(40, 3);
    }

    const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
    expect(ink.icon.pixels, "Wappen gezeichnet").toBeGreaterThan(200);
    expect(ink.text.pixels, "Name gezeichnet").toBeGreaterThan(100);
    expect(ink.icon.y1, "das Wappen endet über dem Namen").toBeLessThan(ink.text.y0);
    expect(Math.abs(centreX(ink.icon) - centreX(ink.text))).toBeLessThanOrEqual(2);
    // Faktor 1 (Band 3): 40 logische Pixel, die Tinte ohne den durchsichtigen Rand etwas weniger.
    expect(ink.icon.y1 - ink.icon.y0).toBeGreaterThanOrEqual(34);
    expect(ink.icon.y1 - ink.icon.y0).toBeLessThanOrEqual(41);
});
