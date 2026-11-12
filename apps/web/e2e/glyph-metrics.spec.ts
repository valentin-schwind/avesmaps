import { expect, test, type Page } from "@playwright/test";
import { FACULTY_GLYPHIC_METRICS, measureTextWidth } from "@avesmaps3d/shared";
import { openMap } from "./map-handle.ts";

/**
 * Deckt die vorausberechnete Namensbreite die tatsaechlich gezeichnete ab? (WI-0004, I2)
 *
 * Die Ableitung und der Kachelzuschnitt rechnen mit `measureTextWidth` aus der erzeugten
 * Vorschubtafel. Wenn diese Zahl kleiner waere als das, was MapLibre zeichnet, waere die Zusicherung
 * „der Lauf ist laenger als sein Name" falsch - und ein Name verschwaende spurlos, was schlimmer
 * ist als ein doppelter.
 *
 * Gemessen wird die gezeichnete Tinte, nicht eine zweite Rechnung: nur so faellt auf, wenn Tafel
 * und Zeichnung auseinanderlaufen.
 *
 * 🪤 Tinte ist SCHMALER als der Satz. Der Vorschub enthaelt die Seitenraender der Glyphen, die
 * Tinte nicht - bei einem Namen, der auf B endet, fehlt rechts sichtbar Weissraum. Deshalb lautet
 * die Zusicherung „deckt ab", nicht „trifft": die Rechnung muss groesser sein, und sie darf nicht
 * beliebig viel groesser sein.
 */

const INK = "#2b2117";
const LAYER = "metric-probe";
const SOURCE = "metric-probe";

/** Der Streifen, in dem gemessen wird - unterhalb der Bedienleiste der Anwendung. */
const INK_CLIP = { x: 0, y: 260, width: 1280, height: 220 };

interface ProbeMap {
    getSource(id: string): unknown;
    addSource(id: string, source: unknown): void;
    removeLayer(id: string): void;
    removeSource(id: string): void;
    addLayer(layer: unknown): void;
    getLayer(id: string): unknown;
    setLayoutProperty(layer: string, property: string, value: unknown): void;
    setPaintProperty(layer: string, property: string, value: unknown): void;
    unproject(point: [number, number]): { lng: number; lat: number };
    queryRenderedFeatures(options: { layers: string[] }): unknown[];
    once(event: string, handler: () => void): void;
    getCanvas(): HTMLCanvasElement;
}

async function drawStraight(page: Page, name: string, size: number, letterSpacing: number): Promise<number> {
    return page.evaluate(
        async ({ text, fontSize, spacing, ink, sourceId, layerId }) => {
            const map = globalThis.avesmapsMap as unknown as ProbeMap;
            const canvas = map.getCanvas();
            const centreY = canvas.clientHeight / 2;
            const centreX = canvas.clientWidth / 2;
            // 🪤 1150 px, nicht "quer durch das Fenster plus Rand". Eine laengere Linie kreuzt
            // Kachelgrenzen und wird dreimal beschriftet - dieselbe Falle, die ADR-0007 fuer die
            // Schriftlaeufe aufloest, hier im eigenen Messaufbau. 1150 liegt ueber dem laengsten
            // gemessenen Namen (844 px) und unter der gemessenen Verdopplungsschwelle.
            const half = 575;
            const left = map.unproject([centreX - half, centreY]);
            const right = map.unproject([centreX + half, centreY]);

            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
            map.addSource(sourceId, {
                type: "geojson",
                buffer: 512,
                tolerance: 0,
                data: {
                    type: "Feature",
                    properties: { name: text },
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [left.lng, left.lat],
                            [right.lng, right.lat],
                        ],
                    },
                },
            });
            map.addLayer({
                id: layerId,
                type: "symbol",
                source: sourceId,
                layout: {
                    "text-field": ["get", "name"],
                    "text-font": ["Faculty Glyphic Regular"],
                    "text-size": fontSize,
                    "text-letter-spacing": spacing,
                    "symbol-placement": "line-center",
                },
                paint: { "text-color": ink, "text-halo-width": 0 },
            });
            await new Promise<void>((resolve) => map.once("idle", resolve));
            return map.queryRenderedFeatures({ layers: [layerId] }).length;
        },
        { text: name, fontSize: size, spacing: letterSpacing, ink: INK, sourceId: SOURCE, layerId: LAYER },
    );
}

async function inkWidth(page: Page): Promise<number> {
    // 🪤 Gemessen wird nur die KARTE: die Bedienelemente darüber sind aus. Seit der Kartenfächer
    // Legacys Kachel trägt (WI-0024), ist der Eckbund höher und reicht mit dem Steuerring in diesen
    // Streifen - dessen Zeichen zählten sonst als „Tinte“.
    await page.addStyleTag({ content: ".corner, .route-planner { visibility: hidden !important; }" });
    const shot = await page.screenshot({ clip: INK_CLIP });
    return page.evaluate(
        async (dataUrl) => {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d");
            if (!context) {
                throw new Error("no 2d context");
            }
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let left = Number.POSITIVE_INFINITY;
            let right = -1;
            for (let index = 0; index < data.length; index += 4) {
                if ((data[index] ?? 255) < 90 && (data[index + 1] ?? 255) < 80 && (data[index + 2] ?? 255) < 70) {
                    const x = (index / 4) % canvas.width;
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                }
            }
            return right < 0 ? 0 : right - left + 1;
        },
        `data:image/png;base64,${shot.toString("base64")}`,
    );
}

/** Namen aus dem echten Bestand, kurz bis sehr lang, mit Umlaut. */
const NAMES = ["Ödenmoor", "DRACHENSTEINE", "Große Olochtai", "Westlicher Hangwald des Raschtulswalls"];
const CASES = [
    { size: 15, letterSpacing: 0 },
    { size: 20, letterSpacing: 0 },
    { size: 25, letterSpacing: 0.2 },
    { size: 28, letterSpacing: 0.3 },
];

test.describe("die vorausberechnete Namensbreite", () => {
    test.beforeEach(async ({ page }) => {
        await openMap(page);
        await page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as ProbeMap & {
                getStyle(): { layers: { id: string }[] };
                jumpTo(options: { zoom: number }): void;
            };
            // 🪤 Ausgeblendet wird ALLES — der Messlayer kommt erst danach dazu. Hier stand eine
            // Liste von Hand, und jede neue Ebene lief an ihr vorbei: erst die Wegnamen mit ihrem
            // schwarzen Saum (WI-0010), dann Haarlinie und Goldring der Marker. Gemessen
            // 2026-09-23: 1216 px „Tinte" für ein Wort von 78 px. Eine Tintenmessung, die fremde
            // Striche mitzaehlt, misst nicht, was sie behauptet — und eine Liste veraltet.
            for (const { id } of map.getStyle().layers) {
                map.setLayoutProperty(id, "visibility", "none");
            }
            // 🪤 Auf einer ganzen Stufe messen: MapLibre prüft „passt der Name auf die Linie“ in Kachelpixeln der ganzen Stufe. Seit
            // dem Startzoom 2.5 (WI-0166) war die 1150 px lange Linie dort nur 813 lang, der längste Name bei 28 px (844) passte nicht.
            map.jumpTo({ zoom: 5 });
        });
    });

    test("deckt die gezeichnete Tinte in jedem Fall ab", async ({ page }) => {
        for (const name of NAMES) {
            for (const { size, letterSpacing } of CASES) {
                const placed = await drawStraight(page, name, size, letterSpacing);
                expect(placed, `${name} bei ${size}px wird gezeichnet`).toBe(1);

                const drawn = await inkWidth(page);
                const predicted = measureTextWidth(FACULTY_GLYPHIC_METRICS, name, { size, letterSpacing });

                expect(drawn, `${name} bei ${size}px hinterlaesst Tinte`).toBeGreaterThan(10);
                // Die Zusicherung: die Rechnung deckt ab.
                expect(
                    predicted,
                    `${name} bei ${size}px/${letterSpacing}em: gerechnet ${predicted.toFixed(1)}, gezeichnet ${String(drawn)}`,
                ).toBeGreaterThanOrEqual(drawn);
                // Und sie ist nicht beliebig grosszuegig - sonst waere "deckt ab" wertlos, und die
                // Laeufe wuerden unnoetig lang.
                expect(
                    predicted,
                    `${name} bei ${size}px/${letterSpacing}em ist nicht masslos ueber der Tinte`,
                ).toBeLessThan(drawn * 1.25 + 2 * size);
            }
        }
    });
});
