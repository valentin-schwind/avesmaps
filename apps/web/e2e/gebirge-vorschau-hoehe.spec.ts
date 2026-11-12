import { expect, test } from "@playwright/test";
import { oeffneGebirge, probegebirge } from "./gebirge-stub.ts";

/**
 * Die Höhenvorschau ändert nur das Gebirge (Betreiber 2026-10-24: „wenn ich beim kämmeeditor der gebirge auf "Kartenvorschau" gehe,
 * passiert was merkwürdiges. die gesamte Umgebung hebt sich an, während das gebirge absinkt“). Gemessen an einer echten Geländekachel des
 * lokalen Stapels: `previewTerrainTile` (`map/terrain/terrain-preview.ts`) überschreibt nur Pixel im Gebirge, außerhalb bleibt jede Höhe
 * Byte für Byte. Das Anheben der Umgebung war die Kamera, die MapLibre mit dem Boden unter der Kartenmitte mitführt; das hält
 * `halteKamera` (Einheitstest `terrain-preview-kamera.test.ts`; das 3D-Gelände ist hier ohne Grafikkarte aus).
 *
 * Problemfälle: Eine Kachel wird beim Umkodieren außen verändert (Farbumrechnung, Alpha); eine Normierung je Ausschnitt verschiebt alle
 * Höhen; am Umriss fällt die Höhe auf die Saat statt auf der bestehenden zu bleiben (Stufe, Einheitstest `terrain-preview-rand.test.ts`).
 * Liest echte Kacheln (`/tiles/terrain/dem`), schreibt nichts.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 die Vorschau-DEM ändert außerhalb des Gebirges keine Höhe, innen die des Gebirges", async ({ page }) => {
    await oeffneGebirge(
        page,
        probegebirge({
            kaemme: [
                {
                    punkte: [
                        [445, 510],
                        [450, 520],
                        [460, 530],
                    ],
                    rang: "haupt",
                },
            ],
            nebengipfel: [],
        }),
    );
    await page.getByRole("tab", { name: "Gebirge" }).click();
    // Die Vorschau steht: Dann ist auch ihre Höhe im Modul gesetzt (`setTerrainPreview`).
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("editor-gebirge-vorschau") !== undefined), {
            timeout: 30_000,
        })
        .toBe(true);
    const messung = await page.evaluate(async () => {
        // Dasselbe Modul wie die Anwendung (die Test-Vite liefert die Quelle unter dieser Adresse), mit der Höhe der laufenden Vorschau.
        const pfad = "/src/map/terrain/terrain-preview.ts";
        const modul = (await import(/* @vite-ignore */ pfad)) as {
            previewTerrainTile(tile: { z: number; x: number; y: number }, bytes: ArrayBuffer): Promise<ArrayBuffer>;
        };
        const zeiger = (await (await fetch("/tiles/terrain/dem/current.json")).json()) as {
            revision: string;
            format?: string;
            tiles?: Record<string, string>;
            maxNativeZoom: number;
        };
        const proj = globalThis.avesmapsRenderProjection!;
        const z = zeiger.maxNativeZoom;
        const n = 2 ** z;
        const ll = proj.toRenderLngLat({ x: 453, y: 520 });
        const fx = ((ll.lng + 180) / 360) * n;
        const s = Math.sin((ll.lat * Math.PI) / 180);
        const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
        const tile = { z, x: Math.floor(fx), y: Math.floor(fy) };
        const own = zeiger.tiles?.[`${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`];
        const url = `/tiles/terrain/dem/${own === undefined ? zeiger.revision : `k/${own}`}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.${zeiger.format ?? "png"}`;
        // Dekodiert wie MapLibre und das Modul: über eine Leinwand, Mapbox-Kodierung (Zehntelmeter ab −10.000 m).
        const dekodiere = async (bytes: ArrayBuffer) => {
            const bild = await createImageBitmap(new Blob([bytes]));
            const leinwand = document.createElement("canvas");
            leinwand.width = bild.width;
            leinwand.height = bild.height;
            const ctx = leinwand.getContext("2d", { willReadFrequently: true })!;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bild, 0, 0);
            const d = ctx.getImageData(0, 0, leinwand.width, leinwand.height).data;
            const h = new Float64Array(leinwand.width * leinwand.height);
            for (let k = 0; k < h.length; k++)
                h[k] = (d[4 * k]! * 65536 + d[4 * k + 1]! * 256 + d[4 * k + 2]!) * 0.1 - 10000;
            return { w: leinwand.width, hh: leinwand.height, h };
        };
        const roh = await (await fetch(url)).arrayBuffer();
        const vor = await dekodiere(roh.slice(0));
        const nach = await dekodiere(await modul.previewTerrainTile(tile, roh.slice(0)));
        let aussen = 0;
        let aussenAnders = 0;
        let innenAnders = 0;
        // Am Umriss (bis 0,2 E innen): Abweichung der Vorschau von der bestehenden Höhe und diese selbst (Render-Meter).
        let amRand = 0;
        let randAbweichung = 0;
        let randBestehend = 0;
        for (let py = 0; py < vor.hh; py++)
            for (let px = 0; px < vor.w; px++) {
                const k = py * vor.w + px;
                const anders = nach.h[k] !== vor.h[k];
                const lng = ((tile.x + (px + 0.5) / vor.w) / n) * 360 - 180;
                const lat =
                    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + (py + 0.5) / vor.hh)) / n))) * 180) / Math.PI;
                const p = proj.fromRenderLngLat({ lng, lat });
                if (p.x > 440 && p.x < 466 && p.y > 502 && p.y < 538) {
                    if (anders) innenAnders++;
                    if (Math.min(p.x - 440, 466 - p.x, p.y - 502, 538 - p.y) < 0.2) {
                        amRand++;
                        randAbweichung = Math.max(randAbweichung, Math.abs(nach.h[k]! - vor.h[k]!));
                        randBestehend += vor.h[k]!;
                    }
                } else {
                    aussen++;
                    if (anders) aussenAnders++;
                }
            }
        return { aussen, aussenAnders, innenAnders, amRand, randAbweichung, randBestehend: randBestehend / amRand };
    });
    // Gemessen 2026-10-24 an z4/7/7: 232.192 Pixel außen, keins geändert; 29.952 im Gebirge geändert.
    expect(messung.aussen).toBeGreaterThan(1000);
    expect(messung.aussenAnders).toBe(0);
    expect(messung.innenAnders).toBeGreaterThan(1000);
    // Stanzt sich nicht ein (Betreiber 2026-10-24: „die vorschau "stanzt" sich noch in die bestehende topographie ein“): Am Umriss bleibt
    // die bestehende Höhe; vorher fiel sie dort auf die Saat (fast 0), die Abweichung war die ganze bestehende Höhe.
    test.info().annotations.push({ type: "Umriss", description: JSON.stringify(messung) });
    expect(messung.amRand).toBeGreaterThan(50);
    expect(messung.randAbweichung).toBeLessThan(0.25 * messung.randBestehend);
});
