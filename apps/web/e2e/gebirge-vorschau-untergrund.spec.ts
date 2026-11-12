import { expect, test, type Page } from "@playwright/test";
import { gebirgeKennung, oeffneGebirge, probegebirge } from "./gebirge-stub.ts";

/**
 * Vorschau und Untergrund beim Kämmezeichnen. OPS-000045 (Thomas auf der Stage, 2026-10-24) legte das Bild dort unter den Untergrund; damit war
 * die Vorschau mit deckendem Untergrund weg (Vali 2026-10-26 auf der Stage). Vali wählte 2026-10-26: Die Vorschau bleibt im Kämme-Modus stehen.
 * Soll: Das Bild steht auch beim Kämmezeichnen über den Flächen; wer am Untergrund nachzeichnen will, stellt den Regler „Vorschau“ der Leiste
 * herunter, und der Regler „Untergrund“ stellt weiter seine Ebene. Alles aus Stubs, nichts in der Datenbank.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

const lage = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getStyle(): { layers: { id: string; type: string }[] };
            getPaintProperty(ebene: string, wert: string): unknown;
            getLayer(id: string): unknown;
        };
        const ebenen = map.getStyle().layers;
        const ids = ebenen.map((e) => e.id);
        const flaechen = ebenen.flatMap((e, i) => (e.type === "fill" ? [i] : []));
        return {
            vorschau: ids.indexOf("editor-gebirge-vorschau"),
            untergrund: ids.indexOf("basemap"),
            ersteFlaeche: flaechen[0] ?? -1,
            letzteFlaeche: flaechen.at(-1) ?? -1,
            deckkraft:
                map.getLayer("basemap") === undefined ? undefined : map.getPaintProperty("basemap", "raster-opacity"),
            bild:
                map.getLayer("editor-gebirge-vorschau") === undefined
                    ? undefined
                    : map.getPaintProperty("editor-gebirge-vorschau", "raster-opacity"),
        };
    });

/** Den Regler „Untergrund“ der Ebenenleiste auf einen Wert stellen (wie ein Zug am Regler). */
async function untergrund(page: Page, wert: number): Promise<void> {
    if ((await page.getByTestId("ebenenleiste-untergrund-bahn").count()) === 0)
        await page.getByTestId("ebenenleiste-untergrund-knopf").click();
    await page.getByTestId("ebenenleiste-untergrund-bahn").evaluate((element, v) => {
        const bahn = element as HTMLInputElement;
        bahn.value = String(v);
        bahn.dispatchEvent(new Event("input", { bubbles: true }));
    }, wert);
}

test("🔴 beim Kämmezeichnen bleibt die Vorschau über den Flächen; der Regler „Vorschau“ blendet sie aus, der Untergrund stellt sich selbst", async ({
    page,
}) => {
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
    await expect.poll(async () => (await lage(page)).vorschau, { timeout: 30_000 }).toBeGreaterThan(-1);
    const vorher = await lage(page);
    expect(vorher.vorschau).toBeGreaterThan(vorher.letzteFlaeche);

    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    // Beim Kämmezeichnen: das Bild bleibt über allen Flächen (und damit über dem Untergrund).
    await expect
        .poll(async () => {
            const jetzt = await lage(page);
            return jetzt.vorschau > jetzt.letzteFlaeche && jetzt.vorschau > jetzt.untergrund;
        })
        .toBe(true);
    // Der Regler „Untergrund“ stellt seine Ebene; die Vorschau bleibt, wo sie ist.
    await untergrund(page, 25);
    await expect.poll(async () => (await lage(page)).deckkraft).toBe(0.25);
    const nachRegler = await lage(page);
    expect(nachRegler.vorschau).toBeGreaterThan(nachRegler.letzteFlaeche);
    // Der Regler „Vorschau“ blendet das Bild aus, damit der Untergrund zum Nachzeichnen durchscheint.
    await page.getByTestId("kamm-netz-vorschau").evaluate((element) => {
        const bahn = element as HTMLInputElement;
        bahn.value = "0";
        bahn.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await lage(page)).bild).toBe(0);
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toHaveCount(0);
});
