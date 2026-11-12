import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, showLandscapes, showPlace } from "./map-handle.ts";
import { AVENTURIA_CARTOGRAPHY, cartographyTypesOfLayer } from "@avesmaps3d/shared";

/**
 * Die Kartografietafel auf der Karte (WI-0008).
 *
 * 💣 Der Punkt ist nicht, dass Farben in der Tafel stehen — das prüft ein Unit-Test billiger. Der
 * Punkt ist, dass sie bei den Arten ankommen, die MapLibre an einer echten Stelle **wirklich
 * zeichnet**. Vorher teilten sich 25 Arten drei Farben; ein Wald war von einem Dschungel nicht zu
 * unterscheiden, und auf einer vollen Karte fällt genau das niemandem auf.
 *
 * 🪤 Gemessen wird über `queryRenderedFeatures` und den aufgelösten Style, NICHT über Pixel. Eine
 * Pixelmessung wäre hier unehrlich: die Flächen sind Lasuren, das Geländeraster färbt mit, und
 * dieselbe Farbe über braunem und über grünem Grund ergibt verschiedene Pixel. Wie die Karte
 * wirkt, entscheidet der Betreiber am Bild (`npm run review:cartography`), nicht ein Schwellwert.
 */

interface MapHandle {
    getStyle(): { layers: { id: string; paint?: Record<string, unknown> }[] };
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
}

/** Welche Arten sind an dieser Stelle tatsächlich gezeichnet? */
async function drawnTypes(page: Page, layer: string): Promise<string[]> {
    return page.evaluate(
        (name) => [
            ...new Set(
                (globalThis.avesmapsMap as unknown as MapHandle)
                    .queryRenderedFeatures({ layers: [`landscape-fill-${name}`] })
                    .map((feature) => String(feature.properties["region_type"] ?? "")),
            ),
        ],
        layer,
    );
}

test("die Flächenfarbe kommt je Art aus der Tafel, nicht je Ebene", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 4);
    await showLandscapes(page);

    const paint = await page.evaluate(() => {
        const style = (globalThis.avesmapsMap as unknown as MapHandle).getStyle();
        const layer = style.layers.find((entry) => entry.id === "landscape-fill-vegetation");
        return JSON.stringify(layer?.paint?.["fill-color"] ?? null);
    });

    // Eine einzelne Farbzeichenkette wäre der alte Zustand: eine Farbe für die ganze Ebene.
    expect(paint, "fill-color ist ein match über region_type").toContain("match");
    expect(paint).toContain("region_type");
    for (const { type } of cartographyTypesOfLayer("vegetation")) {
        expect(paint, `${type} fehlt im Ausdruck`).toContain(type);
    }
});

test("💣 jede gezeichnete Art bekommt ihre eigene Farbe zugewiesen", async ({ page }) => {
    // 🪤 Der Test heisst bewusst nicht "sieht auf dem Bildschirm verschieden aus". Gemessen wird,
    // welche Arten MapLibre an dieser Stelle wirklich zeichnet und ob die Tafel jeder davon einen
    // eigenen Ton gibt - eine Pixelmessung wäre hier unzuverlässig, weil das Geländeraster
    // mitfärbt und zwei Lasuren über verschiedenem Grund verschieden ausfallen.
    await openMap(page);
    await showPlace(page, GARETH, 4);
    await showLandscapes(page);

    const types = (await drawnTypes(page, "vegetation")).filter((type) => type !== "");
    expect(types.length, "an dieser Stelle wird keine Vegetationsart gezeichnet").toBeGreaterThan(1);

    const farben = types.map((type) => AVENTURIA_CARTOGRAPHY.types[type]?.fill);
    for (const [index, farbe] of farben.entries()) {
        expect(farbe, `${types[index]} hat keine Farbe in der Tafel`).toBeDefined();
    }
    expect(new Set(farben).size, `gezeichnet: ${types.join(", ")} - aber nicht alle verschieden`).toBe(farben.length);
});

test("die Klimabänder tragen acht verschiedene Farben aus derselben Tafel", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 3);
    // Bänder gibt es nur in der Ebene Klimazonen („Alle“ zeigt keine, Betreiber 2026-10-05).
    await showLandscapes(page, "klima");

    const paint = await page.evaluate(() => {
        const style = (globalThis.avesmapsMap as unknown as MapHandle).getStyle();
        return JSON.stringify(style.layers.find((entry) => entry.id === "climate-fill")?.paint ?? null);
    });

    for (const [zone, colour] of Object.entries(AVENTURIA_CARTOGRAPHY.climateZones)) {
        expect(paint, `Zone ${zone} fehlt`).toContain(zone);
        expect(paint, `Farbe von ${zone} fehlt`).toContain(colour);
    }
    expect(new Set(Object.values(AVENTURIA_CARTOGRAPHY.climateZones)).size).toBe(8);
});

test("die Karte zeichnet in „Alle“ die Deckkraft der Kartografietafel", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 4);
    await showLandscapes(page);

    // Die Deckkraft entscheidet der Betreiber am Bild und schreibt sie in die Tafel; der Test prüft nur, dass sie ankommt. Eine feste
    // Obergrenze hier (früher 0,35) hielt seine Entscheidung auf (OPS-000072, Vegetation 0,6, Betreiber 2026-10-30).
    const opacities = await page.evaluate(() => {
        const style = (globalThis.avesmapsMap as unknown as MapHandle).getStyle();
        return (
            style.layers
                // Seen sind Wasser wie die Flüsse, keine Lasur (Betreiber 2026-09-28). Die Regel gilt in „Alle“;
                // allein darf eine Ebene kräftiger stehen (`fillOpacityAlone`). Klima zeigt „Alle“ nicht (2026-10-05).
                .filter((entry) => entry.id.startsWith("landscape-fill-") && entry.id !== "landscape-fill-see")
                .map((entry) => ({ id: entry.id, opacity: Number(entry.paint?.["fill-opacity"] ?? 1) }))
        );
    });

    expect(opacities.length).toBeGreaterThan(0);
    for (const { id, opacity } of opacities) {
        const ebene = AVENTURIA_CARTOGRAPHY.layers[id.replace("landscape-fill-", "")];
        expect(ebene, `${id} steht nicht in der Kartografietafel`).toBeDefined();
        expect(opacity, `${id} zeichnet nicht die Deckkraft der Tafel`).toBe(ebene?.fillOpacity);
    }
});
