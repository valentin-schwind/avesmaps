import { devices, expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Namen im Band (WI-0129 §17d; Betreiber 2026-10-11: „es muss auch beim rauszoom sein, „aventurien“ z.b. verschwindet weil das
 * band zu klein wird. (ich schätze 0+1 > 0,5)“).
 *
 * Ein Name steht genau dann, wenn die Stufe der Zoomanzeige in seinem Band liegt, an beiden Enden. Problemfälle: Aventurien (Band
 * 0 bis 3) verschwindet beim Herauszoomen, weil die Karte am Telefon bis MapLibre 0,71 hinausgeht und der Filter erst ab 1
 * zeichnete; ein Name endet vor dem Ende seiner letzten Stufe.
 *
 * 🪤 Der obere Rand stimmte in MapLibre schon vorher: Ein `["zoom"]` im Filter ist der ganzzahlige Kachelzoom, und `<= n+1` hielt
 * so bis n+2. Der zweite Fall ist deshalb ein Wächter, kein Nachweis eines Fehlers; rot war mit altem Code nur der erste.
 */

async function landschaftsnamen(page: Page): Promise<string[]> {
    return page.evaluate(
        () =>
            globalThis.avesmapsMap
                ?.queryRenderedFeatures({
                    layers: globalThis.avesmapsMap
                        .getStyle()
                        .layers.map((l) => l.id)
                        .filter((id) => id.startsWith("map-label-")),
                })
                .map((feature) => String(feature.properties["name"])) ?? [],
    );
}

async function kamera(page: Page, view: { zoom: number; center?: [number, number] }): Promise<number> {
    return page.evaluate(async ({ zoom, center }) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        map.jumpTo(center ? { center: { lng: center[0], lat: center[1] }, zoom } : { zoom });
        await new Promise<void>((resolve) => map.once("idle", resolve));
        return map.getZoom();
    }, view);
}

test("🔴 Aventurien steht beim kleinsten Zoom, auch am Telefon (Stufe 0 hält bis ganz hinaus)", async ({
    browser,
}, info) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: String(info.project.use.baseURL) });
    const page = await context.newPage();
    await openMap(page);
    const zoom = await kamera(page, { zoom: -2 });
    expect(zoom, "das Telefon zoomt unter MapLibre 1 hinaus").toBeLessThan(1);
    expect(await landschaftsnamen(page)).toContain("Aventurien");
    await context.close();
});

test("🔴 ein Name mit Obergrenze n steht bei MapLibre n+1,5 noch und bei n+2 nicht mehr (Aventurien, bis Stufe seiner Obergrenze)", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page);
    // Der Anker und die Obergrenze n aus der geladenen Kachel auf Stufe 1 (MapLibre 2), nicht aus dem Bild: Der Test prüft allein den oberen Rand.
    // 🪤 n kommt vom Namen selbst (`label_max_zoom`), nicht aus einer Zahl im Test: Die Spanne eines Namens ist Datenbestand (eigene Spanne am
    // Objekt, `own_span`, Migration 0206; Aventurien stand 2026-10-11 bis Stufe 3, in der Entwicklungsdatenbank vom 2026-10-29 bis Stufe 2).
    await kamera(page, { zoom: 2 });
    const kachel = await page.evaluate(() => {
        const feature = globalThis.avesmapsMap
            ?.querySourceFeatures("map-labels", { sourceLayer: "map_label_render" })
            .find((kandidat) => kandidat.properties["name"] === "Aventurien");
        return {
            anker: (feature?.geometry as { coordinates: [number, number] } | undefined)?.coordinates,
            von: Number(feature?.properties["label_min_zoom"]),
            bis: Number(feature?.properties["label_max_zoom"]),
        };
    });
    const { anker, von, bis: n } = kachel;
    expect(anker, "Aventurien liegt in der Kachel").toBeTruthy();
    expect(Number.isInteger(n), "Voraussetzung: Aventurien trägt eine Obergrenze").toBe(true);
    expect(
        n,
        "Voraussetzung: die Obergrenze liegt über der Stufe der Kachel (1), sonst misst der Fall den Rand nicht",
    ).toBeGreaterThan(1);
    expect(von, "Voraussetzung: das Band beginnt bei Stufe 0, damit nur der obere Rand zählt").toBe(0);
    await kamera(page, { zoom: n + 1.5, center: anker! });
    expect(await landschaftsnamen(page), `MapLibre ${String(n + 1.5)} ist Stufe ${String(n)}`).toContain("Aventurien");
    await kamera(page, { zoom: n + 2, center: anker! });
    expect(await landschaftsnamen(page), `MapLibre ${String(n + 2)} ist Stufe ${String(n + 1)}`).not.toContain(
        "Aventurien",
    );
});
