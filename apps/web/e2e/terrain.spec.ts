import { expect, test, type Page } from "@playwright/test";
import { terrainTileUrl, type TerrainDemPointer } from "@avesmaps3d/shared";
import { chooseSeries, chooseView, openMap, settleFrame, showCamera, showPlace } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Das Gelände der geneigten Karte (WI-0049 S4), am echten Renderer.
 *
 * 🔴 Braucht abgeleitetes Gelände in der Datenbank (`npm run derive:terrain`) und einen Fastify mit
 * `/tiles/terrain/dem`. Fehlt es, überspringen die Tests sichtbar, statt grün zu sein.
 *
 * 🔴 Mit Grafikkarte: Ohne sie bleibt die Karte flach (Betreiber 2026-09-27, „3: A“), und headless
 * zeichnet Chromium sonst mit SwiftShader. Dieselben Schalter nutzt WI-0053; unter Windows nimmt
 * ANGLE damit die echte Karte. Findet der Testbrowser keine, überspringen die Tests sichtbar. Das
 * Verhalten OHNE Grafikkarte prüft `terrain-software.spec.ts`.
 */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

/**
 * Eine Höhenkachel in beiden Adressformen: unter der Pyramidenrevision (12 Hexzeichen, vor WI-0125) oder unter ihrer
 * eigenen Kachelrevision (`k/` + 16 Hexzeichen, seit WI-0125). 🪤 Kannte der Ausdruck nur die alte Form, sah `D1` seit
 * `32f05748` gar keine Kachel mehr und war grün, ohne etwas zu prüfen.
 */
const DEM_TILE = /\/tiles\/terrain\/dem\/(?:[0-9a-f]{12}|k\/[0-9a-f]{16})\/(\d+)\/(\d+)\/(\d+)\.[a-z]+$/;

/** Mitten in den Koschbergen, bei Koschim. */
const KOSCHBERGE = { x: 462, y: 548 };
/** Ein Nodix auf einem freien Gipfel, rund 4.200 Schritt hoch; hier laufen vier Linien zusammen. */
const TARF_EL_HAZAQUR_MOR = { x: 577.875, y: 505.313 };

interface TerrainMap {
    getTerrain(): { source: string; exaggeration?: number } | null;
    terrain: { exaggeration: number } | null;
    getLayoutProperty(layer: string, name: string): unknown;
    getPaintProperty(layer: string, name: string): unknown;
    queryTerrainElevation(lngLat: { lng: number; lat: number }): number | null;
    on(event: string, handler: () => void): void;
}

interface TerrainState {
    terrain: { source: string; exaggeration?: number } | null;
    exaggeration: number | null;
    hillshade: unknown;
    hillshadeStrength: unknown;
    elevation: number | null;
}

async function readTerrain(page: Page): Promise<TerrainState> {
    return page.evaluate((punkt) => {
        const map = globalThis.avesmapsMap as unknown as TerrainMap | undefined;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) {
            throw new Error("map or projection handle missing");
        }
        return {
            terrain: map.getTerrain(),
            exaggeration: map.terrain?.exaggeration ?? null,
            hillshade: map.getLayoutProperty("gelaende-schatten", "visibility"),
            hillshadeStrength: map.getPaintProperty("gelaende-schatten", "hillshade-exaggeration"),
            elevation: map.queryTerrainElevation(projection.toRenderLngLat(punkt)),
        };
    }, KOSCHBERGE);
}

test.beforeEach(async ({ page, request }) => {
    const zeiger = await request.get("/tiles/terrain/dem/current.json");
    test.skip(zeiger.status() === 404, "kein Gelände abgeleitet: npm run derive:terrain");
    expect(zeiger.status(), "der Geländezeiger antwortet").toBe(200);
    // Die App sagt selbst, wenn sie ohne Grafikkarte zeichnet (software-rendering.ts).
    let ohneKarte = false;
    page.on("console", (meldung) => {
        ohneKarte ||= meldung.text().startsWith("Gelände aus: keine Grafikkarte");
    });
    await openMap(page);
    test.skip(
        ohneKarte,
        "der Testbrowser hat keine Grafikkarte; ohne bleibt die Karte flach (terrain-software.spec.ts)",
    );
});

test("🔴 Stage ohne /tiles/terrain/dem/: Nginx liefert die App-Seite - kein roter Fehler, nur ein Hinweis", async ({
    page,
}) => {
    // Koordination 2026-09-27: Auf Stage sah jeder Besucher „Gelände: Zeiger nicht lesbar … kein JSON“.
    const meldungen: { type: string; text: string }[] = [];
    page.on("console", (meldung) => meldungen.push({ type: meldung.type(), text: meldung.text() }));
    await page.route("**/tiles/terrain/dem/current.json", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Avesmaps3D</title>" }),
    );
    await openMap(page);
    expect(meldungen.filter((m) => m.type === "error" && m.text.includes("Gelände"))).toEqual([]);
    expect(meldungen).toContainEqual({ type: "info", text: "Gelände aus: kein Zeiger" });
});

test("🔴 D1: flach gibt es weder Gelände noch Schattierung - und keine einzige Höhenkachel", async ({ page }) => {
    const kacheln: string[] = [];
    page.on("request", (anfrage) => {
        if (DEM_TILE.test(new URL(anfrage.url()).pathname)) {
            kacheln.push(anfrage.url());
        }
    });
    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6 });
    const flach = await readTerrain(page);
    expect(flach.terrain).toBeNull();
    expect(flach.hillshade).toBe("none");
    expect(kacheln).toEqual([]);
});

test("🔴 geneigt stehen die Gebirge maßstabsgetreu, mit Schatten und Glanz; flach sind sie wieder weg", async ({
    page,
}) => {
    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6, pitch: 45 });
    await expect.poll(async () => (await readTerrain(page)).elevation ?? 0).toBeGreaterThan(0);
    const geneigt = await readTerrain(page);
    expect(geneigt.terrain).toEqual({ source: "gelaende-dem", exaggeration: 1 });
    expect(geneigt.exaggeration, "A1: maßstabsgetreu").toBe(1);
    expect(geneigt.hillshade).toBe("visible");
    expect(geneigt.hillshadeStrength).toBe(0.6);

    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6 });
    const wieder = await readTerrain(page);
    expect(wieder.terrain).toBeNull();
    expect(wieder.hillshade).toBe("none");
});

test("🔴 die Höhenkacheln kommen im Format des Zeigers: Endung, Content-Type und Status (WI-0073)", async ({
    page,
    request,
}) => {
    const zeiger = (await (await request.get("/tiles/terrain/dem/current.json")).json()) as TerrainDemPointer;
    // Ein Zeiger ohne Format meint PNG (vor WI-0073); seit der Umstellung steht dort webp.
    const format = zeiger.format ?? "png";
    expect(["png", "webp"]).toContain(format);
    const antworten: { url: string; status: number; type: string | undefined }[] = [];
    page.on("response", (antwort) => {
        if (DEM_TILE.test(new URL(antwort.url()).pathname)) {
            antworten.push({ url: antwort.url(), status: antwort.status(), type: antwort.headers()["content-type"] });
        }
    });
    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6, pitch: 45 });
    await expect.poll(async () => (await readTerrain(page)).elevation ?? 0).toBeGreaterThan(0);
    expect(antworten.length, "es wurden Höhenkacheln geladen").toBeGreaterThan(0);
    for (const antwort of antworten) {
        // Die Adresse ist die, die der Zeiger für genau diese Kachel nennt (Manifest oder Pyramidenrevision).
        const [, z, x, y] = DEM_TILE.exec(new URL(antwort.url).pathname) ?? [];
        expect(new URL(antwort.url).pathname, antwort.url).toBe(
            terrainTileUrl(zeiger, { z: Number(z), x: Number(x), y: Number(y) }),
        );
        expect(antwort.url).toMatch(new RegExp(`\\.${format}$`));
        expect(antwort.status, antwort.url).toBe(200);
        expect(antwort.type, antwort.url).toBe(`image/${format}`);
    }
});

test("beim Kippen wachsen die Gebirge: bei 15° halbe Höhe, die Schattierung blendet mit", async ({ page }) => {
    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6, pitch: 15 });
    const halb = await readTerrain(page);
    expect(halb.exaggeration).toBeCloseTo(0.5, 6);
    expect(halb.hillshadeStrength).toBeCloseTo(0.3, 6);
});

/** Die Kacheln der Grundkarte, die geladen sind und die MapLibre trotzdem nicht zeichnet. */
async function uebergangeneGrundkarte(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            style: {
                tileManagers: Record<
                    string,
                    {
                        _inViewTiles: {
                            getAllTiles(): {
                                tileID: { key: string };
                                hasData(): boolean;
                                isRenderable(symbolLayer: boolean): boolean;
                            }[];
                        };
                    }
                >;
            };
        };
        return (map.style.tileManagers["basemap"]?._inViewTiles.getAllTiles() ?? [])
            .filter((kachel) => kachel.hasData() && !kachel.isRenderable(false))
            .map((kachel) => kachel.tileID.key);
    });
}

test("🔴 eine in 2D ausgeblendete Kachel der Grundkarte zeichnet wieder, wenn das Gelände im selben Bild angeht", async ({
    page,
}) => {
    // Flach heraus: Die Kacheln der Startansicht blenden aus und bleiben mit Deckkraft 0 stehen. Ohne das prüft der Fall nichts.
    await showCamera(page, { point: { x: 512, y: 512 }, zoom: 1.4 });
    await expect.poll(() => uebergangeneGrundkarte(page)).not.toEqual([]);

    // In EINEM Bild hinein und neigen: Dieselben Kacheln sind wieder gefragt, ihre Fläche blieb hell (2026-11-06).
    await showCamera(page, { point: { x: 430, y: 400 }, zoom: 3.4, pitch: 50, bearing: 15 });
    expect(await uebergangeneGrundkarte(page)).toEqual([]);
});

test("🪤 ein Stilwechsel setzt das Gelände nicht zurück und baut es nicht neu auf", async ({ page }) => {
    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6, pitch: 15 });
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as TerrainMap;
        const zaehler = globalThis as unknown as { geländeNeu: number };
        zaehler.geländeNeu = 0;
        map.on("terrain", () => {
            zaehler.geländeNeu += 1;
        });
    });
    // Der Untergrund tauscht die Grundkarte per `setStyle` mit `diff`.
    const andere = (await page.evaluate(() => location.hash)).includes("series=original") ? "modern" : "original";
    await chooseSeries(page, andere);
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain(`series=${andere}`);
    const danach = await readTerrain(page);
    expect(danach.exaggeration, "das Wachsen bleibt stehen").toBeCloseTo(0.5, 6);
    expect(danach.hillshadeStrength).toBeCloseTo(0.3, 6);
    expect(await page.evaluate(() => (globalThis as unknown as { geländeNeu: number }).geländeNeu)).toBe(0);
});

test("🔴 geneigt liegen die Querfeldein-Pillen im Raum: vorn weiter auseinander als hinten; flach wie bisher", async ({
    page,
}) => {
    // Betreiber 2026-09-27 am Blatt wi-0049-querfeldein-raum.png: „im 3D modus will ich C gern mal live
    // sehen, im 2D modus A“. Ein langer Gang aus dem Gebirge (S5b); der gerade Gang aus
    // route-planner.spec.ts misst bei Zoom 8, der Grenze, nur 212 Pixel.
    await page.goto("/?route=@426.95,654.79~Khezzara");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showStages(page, 15_000);
    await settleFrame(page);
    const pillen = async (): Promise<{ mode: string; gaps: number[] }> =>
        page.evaluate(() => {
            const pills = (
                globalThis as unknown as {
                    avesmapsRoutePills: { drawn(): { x: number; y: number; alpha: number }[]; mode(): string };
                }
            ).avesmapsRoutePills;
            const voll = pills.drawn().filter((pill) => pill.alpha === 1);
            return {
                mode: pills.mode(),
                gaps: voll.slice(1).map((pill, index) => Math.hypot(pill.x - voll[index]!.x, pill.y - voll[index]!.y)),
            };
        });
    // Den Gang senkrecht ins Bild drehen und so nah heran, dass er gut 500 Pixel lang ist (höchstens Zoom 8).
    const blick = await page.evaluate(async () => {
        const map = globalThis.avesmapsMap as unknown as {
            getSource(id: string): {
                getData(): Promise<{
                    features: { properties: { offroad?: boolean }; geometry: { coordinates: [number, number][] } }[];
                }>;
            };
            project(lngLat: [number, number]): { x: number; y: number };
            getZoom(): number;
            getMaxZoom(): number;
        };
        const daten = await map.getSource("route").getData();
        const gang = daten.features.find((feature) => feature.properties.offroad)!.geometry.coordinates;
        const [anfang, ende] = [gang[0]!, gang[gang.length - 1]!];
        const [a, b] = [map.project(anfang), map.project(ende)];
        return {
            center: { lng: (anfang[0] + ende[0]) / 2, lat: (anfang[1] + ende[1]) / 2 },
            bearing: (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI,
            zoom: Math.min(map.getMaxZoom(), map.getZoom() + Math.log2(500 / Math.hypot(b.x - a.x, b.y - a.y))),
        };
    });
    const zeige = async (pitch: number): Promise<void> => {
        await page.evaluate(
            async ({ center, bearing, zoom, pitch }) => {
                const map = globalThis.avesmapsMap!;
                map.jumpTo({ center, bearing, zoom, pitch });
                await new Promise<void>((resolve) => {
                    map.once("idle", resolve);
                    setTimeout(resolve, 10_000);
                });
            },
            { ...blick, pitch },
        );
        await settleFrame(page);
    };

    await zeige(0);
    const flach = await pillen();
    expect(flach.mode).toBe("screen");
    expect(flach.gaps.length).toBeGreaterThan(12);
    // Gemessen als Sehne: Auf dem gebogenen Gang ist sie kaum kürzer als Strich plus Lücke.
    const median = [...flach.gaps].sort((x, y) => x - y)[Math.floor(flach.gaps.length / 2)]!;
    expect(median).toBeGreaterThan(23);
    expect(median).toBeLessThanOrEqual(24.01);

    await zeige(55);
    const geneigt = await pillen();
    expect(geneigt.mode).toBe("space");
    const enden = [geneigt.gaps[0]!, geneigt.gaps[geneigt.gaps.length - 1]!];
    expect(Math.max(...enden) / Math.min(...enden), "vorn größer, hinten kleiner").toBeGreaterThan(1.3);
});

test("🔴 auf dem Gelände stehen die Kraftlinienbögen auf dem Gipfel, nicht an seinem Fuß", async ({ page }) => {
    const bogen = async (): Promise<number> =>
        page.evaluate(
            () =>
                (
                    globalThis as unknown as {
                        avesmapsPowerlineArcs?: { state(): { ready: boolean; active: boolean; groundedEnds: number } };
                    }
                ).avesmapsPowerlineArcs?.state().groundedEnds ?? -1,
        );
    await chooseView(page, "powerlines");
    await showPlace(page, TARF_EL_HAZAQUR_MOR, 7);
    await page.waitForFunction(
        () => {
            const zustand = (
                globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { ready: boolean; active: boolean } } }
            ).avesmapsPowerlineArcs?.state();
            return zustand?.ready === true && zustand.active;
        },
        undefined,
        { timeout: 30_000 },
    );
    expect(await bogen(), "flach gibt es kein Gelände").toBe(0);

    await showCamera(page, { point: TARF_EL_HAZAQUR_MOR, zoom: 7, pitch: 55 });
    // Die Höhenkacheln kommen erst mit dem Kippen; dann stehen die Enden am Gipfel auf dem Boden.
    await expect.poll(bogen, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
});
