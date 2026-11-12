import { expect, test, type Page } from "@playwright/test";
import { openMap, showCamera } from "./map-handle.ts";

/**
 * Himmel, Dunst und Fläche hinter der geneigten Karte (WI-0016, D6; neu WI-0290).
 *
 * Geprüft wird am echten Renderer: ob die Kulisse unter allen Ebenen hängt, die Randblende über dem Gelände und unter den Namen, und
 * ob MapLibres Nebel die Kurve der Kulisse trägt. Das Bild selbst hat der Betreiber am klickbaren Entwurf abgenommen.
 */

/** Die Kante Aventuriens im Norden (Yeti-Land). */
const NORTH_EDGE = { x: 512, y: 1005 };

interface Stand {
    kulisse: number;
    rand: number;
    ersterName: number;
    anzahl: number;
    nebelFarbe: unknown;
    horizontFarbe: unknown;
    deckkraftBei65: number | null;
}

async function liesStand(page: Page): Promise<Stand> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getLayersOrder(): string[];
            getLayer(id: string): { type?: string } | undefined;
            getSky(): Record<string, unknown> | undefined;
            style?: { sky?: { calculateFogBlendOpacity?: (neigung: number) => number } };
        };
        const reihe = map.getLayersOrder();
        const ersterName = reihe.findIndex((id) => map.getLayer(id)?.type === "symbol");
        const sky = map.getSky() ?? {};
        return {
            kulisse: reihe.indexOf("himmel-kulisse"),
            rand: reihe.indexOf("himmel-rand"),
            ersterName,
            anzahl: reihe.length,
            nebelFarbe: sky["fog-color"],
            horizontFarbe: sky["horizon-color"],
            deckkraftBei65: map.style?.sky?.calculateFogBlendOpacity?.(65) ?? null,
        };
    });
}

test.beforeEach(async ({ page }) => {
    await openMap(page);
});

test("🔴 flach lädt die Kulisse nicht nach: keine eigene Ebene", async ({ page }) => {
    await showCamera(page, { point: NORTH_EDGE, zoom: 4 });
    const stand = await liesStand(page);
    expect(stand.kulisse).toBe(-1);
    expect(stand.rand).toBe(-1);
});

test("🔴 geneigt: Kulisse ganz unten, Randblende unter den Namen, Nebel im Ton des Horizonts und mit der Kurve der Kulisse", async ({
    page,
}) => {
    await showCamera(page, { point: NORTH_EDGE, zoom: 4, pitch: 45 });
    await expect.poll(async () => (await liesStand(page)).kulisse).toBe(0);
    const stand = await liesStand(page);
    expect(stand.rand).toBeGreaterThan(0);
    expect(stand.rand).toBeLessThan(stand.ersterName);
    expect(stand.nebelFarbe).toBe(stand.horizontFarbe);
    // MapLibres eigene Kurve gäbe bei 65° 0,5 (60° bis 70°); die der Kulisse (ab 55°, voll bei 75°, 80 %) die halbe Stärke.
    expect(stand.deckkraftBei65).toBeCloseTo(0.4, 3);
});
