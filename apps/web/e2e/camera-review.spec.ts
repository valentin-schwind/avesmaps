import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { GARETH, openMap, readCamera, showCamera, showLandscapes } from "./map-handle.ts";

/**
 * Sichtabnahme der geneigten Karte (WI-0016, P6 und AC15).
 *
 * 💣 Dieser Lauf prüft NICHTS. Ob Namen bei 60° noch lesbar sind, ob Marker sich drängen und ob ein
 * Klimaname im Dunst an der Kante verschwindet, entscheidet ein Mensch am Bild. Der Lauf legt die
 * Bilder an festen Stellen vor, damit zwei Durchgänge vergleichbar sind.
 *
 * 🪤 Alle Stellen liegen ab MapLibre-Zoom 5: erst dort erlaubt die Neigungsgrenze (D3) 60°. Weiter
 * draußen stellt die Karte flacher, und das Bild zeigte nicht, was sein Name verspricht - deshalb
 * trägt die Tafel im README die TATSÄCHLICHE Neigung.
 *
 * 🪤 Flach hält `maxBounds` die Kante aus dem Bild; erst geneigt rückt sie ins Bild. Ein Bild bei
 * 0° ohne Kante ist also kein Fehler, sondern das Verhalten.
 *
 * 🪤 Die Klimastellen liegen am Westrand. Am Ostrand fehlten die Namen bis `8ab34f6` ganz (Anker
 * genau auf dem Weltrand, Migration 0034); sichtbar werden sie dort erst nach einem Neustart von
 * Martin, der die alten Kacheln sonst weiter ausliefert.
 *
 *   npm run review:3d
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/3d-navigation/abnahme");
const PITCHES = [0, 20, 45, 60] as const;
const LABEL_LAYERS = ["place-label", "path-label", "map-label", "landscape-label-run", "climate-label"] as const;

interface Scene {
    id: string;
    point: { x: number; y: number };
    zoom: number;
    bearing: number;
    /** `undefined`: Standardansicht; sonst die Auswahl der Landschaftsansicht. */
    landscapes?: string;
    frage: string;
}

const SCENES: readonly Scene[] = [
    {
        id: "gareth",
        point: GARETH,
        zoom: 5.5,
        bearing: -30,
        frage: "Orts- und Wegnamen, Marker und Kollision in dichter Gegend; gedreht, damit Wegnamen schräg laufen",
    },
    {
        id: "nordkante",
        // Yeti-Land und Firunsstraße liegen vor der Kante.
        point: { x: 600, y: 985 },
        zoom: 5,
        bearing: 0,
        frage: "Die ferne Kante im Dunst: kein Weiß, keine harte Linie, Namen davor noch lesbar",
    },
    {
        id: "klima-westrand",
        // „Gemäßigte Zone" steht bei x = 0; der Rand liegt links, die Karte geht nach Osten weiter.
        point: { x: 40, y: 519 },
        zoom: 5,
        bearing: 0,
        landscapes: "klima",
        frage: "Klimaname am seitlichen Rand: neben Himmel und Dunst noch lesbar?",
    },
    {
        id: "klima-fern",
        point: { x: 40, y: 519 },
        zoom: 5,
        // Blick nach Westen: der Rand mit dem Namen liegt oben, also fern und im Dunst.
        bearing: -90,
        landscapes: "klima",
        frage: "Klimaname auf der fernen Kante, mitten im Dunst: verschwindet er?",
    },
];

test("legt die geneigte Karte zur Sichtabnahme vor", async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page);

    const zeilen: string[] = [];
    let landscapes: string | undefined;
    for (const scene of SCENES) {
        // Die Stellen sind so geordnet, dass nur einmal in die Landschaftsansicht gewechselt wird.
        if (scene.landscapes !== undefined && scene.landscapes !== landscapes) {
            await showLandscapes(page, scene.landscapes);
            landscapes = scene.landscapes;
        }
        for (const pitch of PITCHES) {
            await showCamera(page, { point: scene.point, zoom: scene.zoom, bearing: scene.bearing, pitch });
            // Schrift und Kollision brauchen nach „idle" noch einen Takt.
            await page.waitForTimeout(800);
            const bild = `${scene.id}-${String(pitch).padStart(2, "0")}.png`;
            await page.screenshot({ path: resolve(OUTPUT, bild) });
            const camera = await readCamera(page);
            const namen = await renderedLabels(page);
            zeilen.push(
                `| \`${bild}\` | ${String(pitch)}° | ${camera.pitch.toFixed(1)}° | ${camera.bearing.toFixed(0)}° | ` +
                    `${camera.zoom.toFixed(1)} | ${namen} |`,
            );
        }
    }

    writeFileSync(
        resolve(OUTPUT, "README.md"),
        `# Sichtabnahme der geneigten Karte (WI-0016, AC15)\n\n` +
            `Erzeugt mit \`npm run review:3d\`. **Dieser Lauf prüft nichts** — er legt vor, was nur ein Mensch am Bild entscheiden kann.\n\n` +
            `## Die Stellen\n\n` +
            SCENES.map((scene) => `- **${scene.id}** (MapLibre-Zoom ${String(scene.zoom)}): ${scene.frage}`).join(
                "\n",
            ) +
            `\n\n## Die Bilder\n\n` +
            `„Namen im Bild" zählt, was MapLibre nach der Kollision tatsächlich zeichnet. Fällt die Zahl mit der Neigung stark, verdrängen sich die Namen.\n\n` +
            `| Bild | Neigung soll | Neigung ist | Drehung | Zoom | Namen im Bild |\n|---|---|---|---|---|---|\n` +
            `${zeilen.join("\n")}\n`,
        "utf8",
    );
});

/** Gezeichnete Namen je Beschriftungsebene, z. B. „Orte 41 · Wege 12". */
async function renderedLabels(page: Page): Promise<string> {
    const counts = await page.evaluate((layers) => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        // Seit WI-0135 stehen die Ortsnamen je Klasse und Seite in eigenen Ebenen; gezählt wird die Familie.
        const ids = map.getStyle().layers.map((layer) => layer.id);
        const familie = (name: string): string[] => ids.filter((id) => id === name || id.startsWith(`${name}-`));
        const present = layers.filter((name) => familie(name).length > 0);
        return present.map(
            (name) =>
                [
                    name,
                    familie(name).reduce((n, id) => n + map.queryRenderedFeatures({ layers: [id] }).length, 0),
                ] as const,
        );
    }, LABEL_LAYERS);
    const NAMES: Record<string, string> = {
        "place-label": "Orte",
        "path-label": "Wege",
        "map-label": "Kartennamen",
        "landscape-label-run": "Landschaften",
        "climate-label": "Klima",
    };
    return counts.map(([id, count]) => `${NAMES[id] ?? id} ${String(count)}`).join(" · ");
}
