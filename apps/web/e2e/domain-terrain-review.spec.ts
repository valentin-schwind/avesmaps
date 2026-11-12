import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { chooseView, openMap, showCamera } from "./map-handle.ts";

/**
 * Die Pflichtausschnitte des Domain-Geländes (WI-0067, „Qualitätsvergleich“): sechzehn Stellen geneigt in den Landschaften,
 * je ein Bild nach `review/wi-0067/<stelle>-p5.png`. Aufruf: `npm run review:gelaende` (braucht laufenden Stack und eine
 * Grafikkarte).
 *
 * 🔴 Ein Blatt, kein Test (WI-0123, Betreiber 2026-10-09): Bis dahin hieß die Datei `domain-terrain.spec.ts` und lief in
 * jedem Standardlauf mit. Ohne Grafikkarte wurde sie sechzehnmal rot statt zu überspringen, und mit überschrieb sie die
 * Ausschnitte unter `review/wi-0067/` mit dem jeweiligen Arbeitsstand.
 *
 * Die `expect` hier bewachen das BILD: Ohne Gelände aus dem Domain-DEM der aktuellen Revision und mit einem Seitenfehler
 * zeigt es das Falsche. Die Aussagen über die Anwendung stehen in regulären Tests: Gelände aus `gelaende-dem` in
 * `visual-relief.spec.ts` („Landschaften geneigt …“) und `terrain.spec.ts` („geneigt stehen die Gebirge …“), Höhenkacheln
 * vom Zeiger in `terrain.spec.ts` („die Höhenkacheln kommen im Format des Zeigers …“; seit WI-0124 Runde 1 rot, Befund in
 * WI-0123) und die Adresse je Kachel aus dem Manifest in `terrain-tiles.test.ts`, Schattierung und
 * Gelände aus denselben Kacheln in `domain-terrain-rendering.test.ts` und `terrain.test.ts`, keine Anfrage an das alte
 * Relief und kein Seitenfehler in `visual-relief.spec.ts` („direkt in den Landschaften geöffnet …“; die Anfrageprüfung
 * stand bis WI-0123 nur hier und ist dorthin verschoben).
 */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

const scenes = [
    { id: "olochtai", x: 326.414, y: 707.133, zoom: 5.5 },
    { id: "siebenwindkueste", x: 326.114, y: 573.079, zoom: 5.5 },
    { id: "caldaia", x: 540.216, y: 492.777, zoom: 5.5 },
    { id: "huegelland-abagund", x: 383.763, y: 502.419, zoom: 5.5 },
    { id: "huegelland-rakula", x: 535.996, y: 509.523, zoom: 6 },
    { id: "huegelland-drachensteine-uebergang", x: 667.258, y: 671.941, zoom: 6 },
    { id: "huegelland-finsterkamm-uebergang", x: 515.996, y: 632.422, zoom: 6 },
    { id: "mhanadi-delta", x: 665.565, y: 377.129, zoom: 5.5 },
    { id: "sumpf-altgob", x: 512.714, y: 548.991, zoom: 7.5 },
    { id: "wueste-wadi-ankarech", x: 499.572, y: 397.463, zoom: 7.5 },
    { id: "kosch-greifenzinne-greifenpass", x: 464, y: 538, zoom: 5.5 },
    { id: "greifenfurt", x: 520, y: 590, zoom: 5.5 },
    { id: "dornkuppen", x: 551.775, y: 620.12, zoom: 5.75 },
    { id: "freier-gipfel-adlerspitze", x: 675.438, y: 709.813, zoom: 6 },
    { id: "freier-gipfel-silberkrone", x: 481.625, y: 706.125, zoom: 6 },
    { id: "freier-gipfel-horndrachenfels", x: 544.281, y: 664.891, zoom: 7 },
] as const;

for (const scene of scenes) {
    test(`Domain terrain review: ${scene.id}`, async ({ page, request }) => {
        const pointerResponse = await request.get("/tiles/terrain/dem/current.json");
        expect(pointerResponse.status()).toBe(200);
        const pointer = (await pointerResponse.json()) as { revision: string; tiles?: Record<string, string> };
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await openMap(page);
        await chooseView(page, "landscapes");
        await showCamera(page, { point: scene, zoom: scene.zoom, pitch: 45 });
        const sources = await page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as {
                getTerrain(): { source: string } | null;
                getStyle(): { sources: Record<string, { tiles?: string[] }> };
            };
            return { terrain: map.getTerrain(), sources: map.getStyle().sources };
        });
        expect(sources.terrain?.source, "required GPU terrain review must run").toBe("gelaende-dem");
        expect(sources.sources["gelaende-schatten-dem"]?.tiles).toEqual(sources.sources["gelaende-dem"]?.tiles);
        // Seit WI-0124 Runde 1 (`32f05748`) löst die Karte jede Kachel über das Manifest des Zeigers auf (`terrain-tiles.ts`);
        // nur ohne Manifest steht die Pyramidenrevision in der Vorlage. Bis WI-0123 forderte der Wächter immer diese, und
        // das Blatt war seitdem an jeder Stelle rot.
        expect(sources.sources["gelaende-dem"]?.tiles?.[0]).toContain(
            pointer.tiles ? "avesmaps-dem://{z}/{x}/{y}" : `/dem/${pointer.revision}/`,
        );
        expect(errors).toEqual([]);
        const directory = resolve(import.meta.dirname, "../../../review/wi-0067");
        mkdirSync(directory, { recursive: true });
        await page.addStyleTag({ content: ".corner, .panel, [data-map-overlay] { visibility: hidden !important; }" });
        await page.locator("canvas.maplibregl-canvas").screenshot({ path: resolve(directory, `${scene.id}-p5.png`) });
    });
}
