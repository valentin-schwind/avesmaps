import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { openMap, type MapHandle } from "./map-handle.ts";
import { AVENTURIA_CARTOGRAPHY, cartographyTypesOfLayer, darkenColour } from "@avesmaps3d/shared";

/**
 * Operator-Review der Kartografietafel (WI-0008).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er bereitet eine Entscheidung vor, die nur ein Mensch treffen kann:
 * ob die Farben als Karte funktionieren. Legacy hält dafür keine Evidenz — dort kommt die Farbe der
 * Landschaften aus dem Rasterbild, und die Darstellungstafel trägt genau **eine** Übersteuerung.
 * Alles andere ist gesetzt und gehört deshalb angesehen, nicht getestet.
 *
 * 🪤 Die Ausschnitte sind so gewählt, dass jeweils **mehrere Arten derselben Ebene** im Bild liegen.
 * Ein Bild, auf dem nur Wald zu sehen ist, beantwortet die Frage nicht, ob Wald und Dschungel
 * unterscheidbar sind — und genau diese Frage ist der Zweck des Work Items.
 *
 *   npm run review:cartography
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/kartografie");

/** Ausschnitte in Kartenkoordinaten, jeder mit einer Absicht. */
const VIEWS = [
    {
        id: "uebersicht",
        x: 512,
        y: 512,
        zoom: 2,
        frage: "Tragen die Klimabänder die Nord-Süd-Folge, ohne die Karte zuzudecken?",
    },
    {
        id: "mittelreich",
        x: 520,
        y: 500,
        zoom: 4,
        frage: "Wald, Kulturlandschaft und Hügelland nebeneinander — unterscheidbar?",
    },
    { id: "sueden", x: 520, y: 700, zoom: 4, frage: "Wüste, Steppe und Oase: bleibt der Trockenbereich lesbar?" },
    { id: "kueste", x: 400, y: 480, zoom: 5, frage: "See, Meer und Küste — trennt die Kante die Wasserflächen?" },
    {
        id: "gebirge",
        x: 560,
        y: 470,
        zoom: 5,
        frage: "Gebirge gegen Hügelland gegen Tal: reicht der Abstand der Erdtöne?",
    },
] as const;

test("legt die Kartografie zur Beurteilung vor", async ({ page }) => {
    mkdirSync(OUTPUT, { recursive: true });
    await openMap(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const zeilen: string[] = [];
    for (const view of VIEWS) {
        await showView(page, view.x, view.y, view.zoom);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: resolve(OUTPUT, `${view.id}.png`) });

        const arten = await drawnTypes(page);
        zeilen.push(
            `| \`${view.id}\` | z${String(view.zoom)} | ${view.frage} | ${arten.length > 0 ? arten.join(", ") : "—"} |`,
        );
    }

    // 💣 Die Klimabänder WERDEN gezeichnet (bei z2 sind es 27 Flächen), sind bei 0.18 über dem
    // farbigen Geländeraster aber nicht wahrnehmbar. Legacy führt sie mit 0.5. Wie präsent sie sein
    // sollen, ist Geschmack und Produktwirkung - also werden beide Stände vorgelegt statt einer
    // gewählt.
    for (const deckkraft of [0.18, 0.35]) {
        await page.evaluate((wert) => {
            const map = globalThis.avesmapsMap as unknown as {
                setPaintProperty(layer: string, property: string, value: unknown): void;
            };
            map.setPaintProperty("climate-fill", "fill-opacity", wert);
        }, deckkraft);
        await showView(page, 512, 512, 2);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: resolve(OUTPUT, `klima-${String(deckkraft).replace(".", "")}.png`) });
    }

    const tafel = ["klima", "topographie", "vegetation", "derographisch"]
        .map((layer) => {
            const eintraege =
                layer === "klima"
                    ? Object.entries(AVENTURIA_CARTOGRAPHY.climateZones).map(([type, fill]) => ({ type, fill }))
                    : cartographyTypesOfLayer(layer);
            const deckkraft = AVENTURIA_CARTOGRAPHY.layers[layer]?.fillOpacity ?? 0;
            const zeilen = eintraege.map(
                ({ type, fill }) =>
                    `| ${type} | \`${fill}\` | \`${darkenColour(fill, AVENTURIA_CARTOGRAPHY.global.lineDarken)}\` |`,
            );
            return `### ${layer} (Deckkraft ${String(deckkraft)})\n\n| Art | Füllung | Kante |\n|---|---|---|\n${zeilen.join("\n")}`;
        })
        .join("\n\n");

    writeFileSync(
        resolve(OUTPUT, "README.md"),
        `# Kartografie zur Beurteilung (WI-0008)\n\n` +
            `Erzeugt mit \`npm run review:cartography\`. **Dieser Lauf prüft nichts** — er legt vor, was nur ein Mensch entscheiden kann.\n\n` +
            `Die Flächen sind **Lasuren über dem Geländeraster**, keine Deckfarben. Eine Farbe, die auf Weiß stimmt, kann über braunem Grund kippen; deshalb sind die Bilder mit Raster aufgenommen.\n\n` +
            `## Die Ausschnitte\n\n| Bild | Zoom | Worauf zu achten ist | dort gezeichnete Arten |\n|---|---|---|---|\n${zeilen.join("\n")}\n\n` +
            `## Die Tafel\n\n${tafel}\n\n` +
            `## Offene Frage: wie präsent sollen die Klimabänder sein?\n\n` +
            `Sie werden gezeichnet — bei z2 sind es 27 Flächen —, aber bei einer Deckkraft von **0.18** über dem farbigen ` +
            `Geländeraster sieht man sie praktisch nicht. Legacy führt sie mit **0.5**, was die Karte deutlich einfärben ` +
            `würde. \`klima-018.png\` und \`klima-035.png\` zeigen denselben Ausschnitt in beiden Ständen. Geschmacks- und ` +
            `Produktfrage, nicht ableitbar.\n\n` +
            `## Was Legacy dazu beiträgt\n\n` +
            `Nichts außer einem Wert. \`ecosystem-display.php\` führt zwei Farbübersteuerungen für **eine** Art (\`urwald\`); ` +
            `die Füllfarbe \`#3f6605\` ist von dort übernommen. Alle übrigen Farben sind für Avesmaps3D gesetzt.\n`,
        "utf8",
    );
});

async function showView(page: Page, x: number, y: number, zoom: number): Promise<void> {
    await page.evaluate(
        ([targetX, targetY, targetZoom]) => {
            const map = globalThis.avesmapsMap as unknown as MapHandle & {
                jumpTo(options: { center: [number, number]; zoom: number }): void;
            };
            const projection = globalThis.avesmapsRenderProjection as unknown as {
                toRenderLngLat(point: { x: number; y: number }): { lng: number; lat: number };
            };
            const lngLat = projection.toRenderLngLat({ x: targetX as number, y: targetY as number });
            map.jumpTo({ center: [lngLat.lng, lngLat.lat], zoom: targetZoom as number });
        },
        [x, y, zoom],
    );
}

async function drawnTypes(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
            getStyle(): { layers: { id: string }[] };
        };
        const layers = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        return [
            ...new Set(
                map
                    .queryRenderedFeatures({ layers })
                    .map((feature) => String(feature.properties["region_type"] ?? ""))
                    .filter((type) => type !== ""),
            ),
        ].sort();
    });
}
