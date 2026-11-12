import { expect, test, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Alle Flächen sind geglättet, an Rand und Naht, in jedem Filter dieselben (WI-0055; seit WI-0077 alle Ebenen, Betreiber
 * 2026-10-04: „topographie, vegetation, derographie -> zeigen alle diesselben flächen und sind nur filter für die anzeige“).
 *
 * Die Quelle der Landschaften (`landscapes`, Schicht `region_area_render`) liefert für jede Fläche die abgeleitete Form
 * (Migrationen 0067 und 0072); alles, was sie liest, folgt ihr: Füllung, Kante, Überfahren, Auswahl. Die Probe liest die
 * geladenen Kacheln selbst: Eine Rundung (Chaikin, drei Durchgänge) hat an ihren Stützpunkten nur flache Winkel, die eckige
 * Ausgangsform (Legacys Polygone) hat an mehr als jedem dritten Stützpunkt eine Ecke von mehr als 35 Grad.
 *
 * Am Trollzacken-Vorland, wo mehr als zehn Flächen zusammenstoßen: Flächen, die einander berühren, tragen dieselben Punkte der
 * Grenze, auch über Ebenen (Waldgrenze gleich Hügellandgrenze). Dass dort nichts offen bleibt, belegt `land-smooth.test.ts`
 * des Servers gegen PostGIS; hier steht, dass die Karte diese Form wirklich liest, in jedem Filter dieselbe.
 */

/** Wo viele Flächen zusammenstoßen: Schlunder Massiv, Rabensteine, Wasserburger Massiv (Kartenkoordinaten). */
const VORLAND = { x: 585, y: 505 };
const ZOOM = 7.5;

interface ShapeProbe {
    features: number;
    vertices: number;
    /** Anteil der Stützpunkte, an denen der Rand um mehr als 35 Grad abknickt. */
    sharpShare: number;
    /** Punkte, die mindestens zwei Flächen gemeinsam sind (die gemeinsame Kante liegt in beiden). */
    sharedVertices: number;
    /** Davon Punkte, die Flächen verschiedener Ebenen gemeinsam sind (eine Kante über Ebenen). */
    crossLayerVertices: number;
    /** Je Fläche (Region) die Punkte ihres Rands, als Schlüssel. */
    shapes: Record<string, string[]>;
}

async function open(page: Page, layer: string): Promise<void> {
    await page.goto("about:blank");
    await page.goto(
        `/#x=${String(VORLAND.x)}&y=${String(VORLAND.y)}&z=${String(ZOOM)}&series=original&view=landscapes&layer=${layer}`,
    );
    await page.waitForFunction(
        (fill) => {
            const map = globalThis.avesmapsMap;
            return (
                map?.isStyleLoaded() === true &&
                map.loaded() &&
                map.queryRenderedFeatures({ layers: [fill] }).length > 0
            );
        },
        `landscape-fill-${layer === "alle" ? "topographie" : layer}`,
        { timeout: 45_000 },
    );
    await settleFrame(page);
}

/** Form der Flächen der Ebenen und Arten in den geladenen Kacheln (`types` leer: alle Arten). */
async function probe(page: Page, layers: string[], types: string[] = []): Promise<ShapeProbe> {
    return page.evaluate(
        ({ layerNames, typeList }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const rows = map.querySourceFeatures("landscapes", { sourceLayer: "region_area_render" }) as unknown as {
                properties: { region_layer: string; region_type: string; region_public_id: string };
                geometry: { type: string; coordinates: unknown };
            }[];
            const owners = new Map<string, Map<string, string>>();
            const shapes: Record<string, Set<string>> = {};
            let features = 0;
            let vertices = 0;
            let sharp = 0;
            for (const feature of rows) {
                const { region_layer: layer, region_type: type, region_public_id: id } = feature.properties;
                if (!layerNames.includes(layer) || (typeList.length > 0 && !typeList.includes(type))) continue;
                features += 1;
                const polygons = (
                    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates
                ) as number[][][][];
                for (const ring of polygons.flat()) {
                    const pixels = ring.map(([lng, lat]) => map.project({ lng: lng ?? 0, lat: lat ?? 0 }));
                    for (let at = 1; at < pixels.length - 1; at += 1) {
                        const before = pixels[at - 1];
                        const here = pixels[at];
                        const after = pixels[at + 1];
                        if (!before || !here || !after) continue;
                        const ax = here.x - before.x;
                        const ay = here.y - before.y;
                        const bx = after.x - here.x;
                        const by = after.y - here.y;
                        const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
                        if (length < 1e-9) continue;
                        const angle =
                            (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / length))) * 180) / Math.PI;
                        vertices += 1;
                        if (angle > 35) sharp += 1;
                    }
                    for (const [lng, lat] of ring) {
                        const key = `${(lng ?? 0).toFixed(7)},${(lat ?? 0).toFixed(7)}`;
                        const byId = owners.get(key) ?? new Map<string, string>();
                        byId.set(id, layer);
                        owners.set(key, byId);
                        (shapes[id] ??= new Set<string>()).add(key);
                    }
                }
            }
            return {
                features,
                vertices,
                sharpShare: sharp / Math.max(1, vertices),
                sharedVertices: [...owners.values()].filter((byId) => byId.size >= 2).length,
                crossLayerVertices: [...owners.values()].filter((byId) => new Set(byId.values()).size >= 2).length,
                shapes: Object.fromEntries(Object.entries(shapes).map(([id, set]) => [id, [...set].sort()])),
            };
        },
        { layerNames: layers, typeList: types },
    );
}

const LAND = ["gebirge", "huegelland", "hochebene", "tal", "tiefebene", "insel"];

test("🔴 Alle: Topographie und Vegetation sind geglättet und teilen ihre gemeinsamen Kanten über die Ebenen", async ({
    page,
}) => {
    await open(page, "alle");
    const land = await probe(page, ["topographie"], LAND);
    expect(land.features, "Landflächen der Topographie in den Kacheln").toBeGreaterThanOrEqual(8);
    expect(land.vertices, "Stützpunkte, an denen gemessen wird").toBeGreaterThan(500);
    // Gerundet: Nur die festen Punkte (wo die Eigentümer einer Kante wechseln) und die Schnitte der Kachelränder knicken noch ab.
    expect(land.sharpShare, "Anteil der scharfen Ecken, Topographie").toBeLessThan(0.2);
    expect(land.sharedVertices, "Punkte, die zwei Flächen gemeinsam sind").toBeGreaterThan(50);
    const wood = await probe(page, ["vegetation"]);
    expect(wood.vertices, "Stützpunkte der Vegetation").toBeGreaterThan(100);
    expect(wood.sharpShare, "Anteil der scharfen Ecken, Vegetation").toBeLessThan(0.2);
    const both = await probe(page, ["topographie", "vegetation", "derographisch"]);
    expect(both.crossLayerVertices, "Punkte einer Kante, die Flächen verschiedener Ebenen teilen").toBeGreaterThan(20);
});

for (const layer of ["topographie", "vegetation", "derographisch"]) {
    test(`🔴 ${layer} allein: dieselben geglätteten Flächen wie in „Alle“`, async ({ page }) => {
        await open(page, layer);
        const alone = await probe(page, [layer]);
        expect(alone.vertices, "Stützpunkte, an denen gemessen wird").toBeGreaterThan(
            layer === "derographisch" ? 20 : 100,
        );
        // 🪤 Die derographischen Regionen tragen hier nur wenige, lange Ränder: Die Schnitte an den Kachelrändern (rechte
        // Winkel) wögen dann mehr als die Rundung. Rund sind sie trotzdem; das belegt `land-smooth.test.ts` des Servers.
        if (alone.vertices >= 100) expect(alone.sharpShare, "Anteil der scharfen Ecken").toBeLessThan(0.2);
        await open(page, "alle");
        const inAll = await probe(page, [layer]);
        // Jede Fläche, die beide Ansichten zeigen, hat dieselben Punkte: Die Ebenen sind nur Filter.
        const common = Object.keys(alone.shapes).filter((id) => id in inAll.shapes);
        expect(common.length, "Flächen in beiden Ansichten").toBeGreaterThan(0);
        for (const id of common) expect(alone.shapes[id], `Fläche ${id}`).toEqual(inAll.shapes[id]);
    });
}
