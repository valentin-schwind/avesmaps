import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, showLandscapes, showPlace } from "./map-handle.ts";

/**
 * Die Landschaftsflaechen auf der Karte (WI-0003).
 *
 * Geprueft wird, was die Abnahme verlangt: dass die drei Ebenen wirklich gezeichnet werden, und
 * dass sie in Legacys Reihenfolge liegen - unter den Wegen und den Orten, Topographie zuunterst.
 * Die Reihenfolge ist Migrationsgegenstand (Finding MCS-007); sie wird hier gemessen statt
 * angenommen, weil eine vertauschte Ebene auf einer vollen Karte niemandem auffaellt.
 */

interface MapHandle {
    getStyle(): { layers: { id: string }[] };
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
}

const LAYERS = ["topographie", "vegetation", "derographisch"] as const;

async function layerOrder(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        ((globalThis.avesmapsMap as unknown as MapHandle).getStyle().layers ?? []).map((layer) => layer.id),
    );
}

test("zeichnet die drei Landschaftsebenen", async ({ page }) => {
    await openMap(page);
    // Gareth liegt mitten im Bestand; hier ueberlappen mehrere Ebenen.
    await showPlace(page, GARETH, 4);
    await showLandscapes(page);

    const counted = await page.evaluate(
        (layers) =>
            Object.fromEntries(
                layers.map((layer) => [
                    layer,
                    (globalThis.avesmapsMap as unknown as MapHandle).queryRenderedFeatures({
                        layers: [`landscape-fill-${layer}`],
                    }).length,
                ]),
            ),
        LAYERS as unknown as string[],
    );

    for (const layer of LAYERS) {
        expect(counted[layer], `Ebene ${layer} traegt Flaechen`).toBeGreaterThan(0);
    }
});

test("stapelt die Landschaftsebenen in Legacys Reihenfolge", async ({ page }) => {
    // 💣 Dieser Test hiess bis zum Kartenfaecher „legt die Landschaften unter die Orte" und pruefte
    // Grundkarte, Flaechen und Orte in EINEM Stapel. Das ging, solange alles gleichzeitig auf der
    // Karte lag. Seit WI-0009 kommen Flaechen und Orte nie zusammen vor: die Standardansicht hat
    // keine Flaechen, die Landschaftsansicht keine Orte und keine Grundkarte. Die Zusicherung
    // „darunter" ist damit nicht verletzt, sondern gegenstandslos geworden.
    //
    // Was BLEIBT, ist die Reihenfolge der Landschaftsebenen untereinander - und die ist
    // Migrationsgegenstand, keine Gestaltungsfrage (MCS-007): Topographie, Vegetation, Derographisch. Klima lag bis
    // 2026-10-05 zuunterst; seitdem zeigt „Alle“ keine Klimazonen (Betreiber: „Wenn ich auf "Alle" klick, sollen keine
    // klimazonen mehr angezeigt werden“, Legacy ebenso).
    await openMap(page);
    await showLandscapes(page);
    const order = await layerOrder(page);

    const at = (id: string): number => {
        const index = order.indexOf(id);
        expect(index, `Ebene ${id} fehlt im Stil`).toBeGreaterThanOrEqual(0);
        return index;
    };

    expect(order, "„Alle“ zeigt keine Klimabänder").not.toContain("climate-fill");
    expect(at("landscape-fill-topographie")).toBeLessThan(at("landscape-fill-vegetation"));
    expect(at("landscape-fill-vegetation")).toBeLessThan(at("landscape-fill-derographisch"));
});

test("stapelt die Standardansicht: Grundkarte, Orte, Ortsnamen", async ({ page }) => {
    await openMap(page);
    const order = await layerOrder(page);
    const at = (id: string): number => order.indexOf(id);

    expect(at("basemap")).toBeGreaterThanOrEqual(0);
    expect(at("basemap")).toBeLessThan(at("place-marker"));
    // Die Ortsnamen stehen seit WI-0135 je Klasse und Seite in eigenen Ebenen; die unterste zählt.
    const ersterName = order.findIndex((id) => id.startsWith("place-label-"));
    expect(ersterName).toBeGreaterThanOrEqual(0);
    expect(at("place-marker")).toBeLessThan(ersterName);
    // Und keine Flaeche dazwischen - sie gehoeren in die Landschaftsansicht.
    expect(order.filter((id) => id.startsWith("landscape-fill-"))).toEqual([]);
});

/**
 * Die Flaechen tragen die Regionsattribute mit - die Ebene und die Art haengen an der Region, nicht
 * an der Flaeche. Ohne sie koennte der Stil nicht nach Ebene filtern, und der Test oben waere
 * gruen, weil alles in einer Ebene laege.
 */
test("liefert Ebene und Region an jeder Flaeche mit", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 4);
    await showLandscapes(page);

    const sample = await page.evaluate(() => {
        const features = (globalThis.avesmapsMap as unknown as MapHandle).queryRenderedFeatures({
            layers: ["landscape-fill-vegetation"],
        });
        const first = features[0];
        return first
            ? {
                  layer: String(first.properties["region_layer"]),
                  hasName: String(first.properties["name"] ?? "") !== "",
                  hasRegion: String(first.properties["region_public_id"] ?? "") !== "",
              }
            : null;
    });

    expect(sample, "mindestens eine Vegetationsflaeche ist sichtbar").not.toBeNull();
    expect(sample?.layer).toBe("vegetation");
    expect(sample?.hasName, "die Flaeche traegt den Namen ihrer Region").toBe(true);
    expect(sample?.hasRegion, "die Flaeche nennt ihre Region").toBe(true);
});
