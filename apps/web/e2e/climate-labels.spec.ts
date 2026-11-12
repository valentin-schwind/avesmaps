import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, settleFrame, showLandscapes, showPlace } from "./map-handle.ts";

/**
 * Die Klimazonen tragen ihren Namen mittig in dem Teil der Zone, der gerade im Bild zu sehen ist (WI-0012, Nachtrag
 * 2026-10-05; Betreiber: „ob du die zonennamen statt links mittig anzeigen könntest - immer da wo die zone ist“).
 * Vorher standen sie wie in Legacy an beiden Kartenrändern; dieser Test prüfte damals je Rand.
 *
 * Geprüft wird an dem, was die Karte zeichnet, nicht an der Rechnung: Der Name steht dort, wo die Seite ihn haben will
 * (`queryRenderedFeatures` an der Stelle), auf seinem Band, nicht im Meer, zwischen den Grenzen seiner Zone, und
 * waagrecht nahe der Mitte ihres sichtbaren Landes, gemessen an einem Raster von Stichpunkten auf der Karte.
 */

interface Placed {
    key: string;
    name: string;
    at: [number, number];
    room: number;
}

interface Measured extends Placed {
    /** Die Namen der Zonennamen, die an der Stelle gezeichnet sind. */
    drawn: string[];
    /** Das Band unter der Stelle. */
    band: string | undefined;
    /** Liegt die Stelle im Meer? */
    sea: boolean;
    /** Oben und unten der Zone auf der Senkrechten durch die Stelle, ohne Meer (Stichpunkte alle 2 px). */
    extent: [number, number];
    /** Waagrecht die Mitte des sichtbaren Landes der Zone (Stichpunkte im Raster). */
    centreX: number;
}

type Handle = {
    queryRenderedFeatures(
        point: [number, number],
        options: { layers: string[] },
    ): { properties: Record<string, unknown> }[];
    getCanvas(): HTMLCanvasElement;
    isMoving(): boolean;
    loaded(): boolean;
};

/** Wo die Seite die Namen haben will, sobald sie ruhen (die Namen gleiten zu neuen Stellen). */
async function settledLabels(page: Page): Promise<Placed[]> {
    let previous = "";
    await expect
        .poll(
            async () => {
                const now = await page.evaluate(() =>
                    JSON.stringify(
                        (globalThis.avesmapsClimateLabels?.placed() ?? []).map((target) => [
                            target.key,
                            Math.round(target.at[0]),
                            Math.round(target.at[1]),
                        ]),
                    ),
                );
                const loaded = await page.evaluate(() => (globalThis.avesmapsMap as unknown as Handle).loaded());
                const same = now === previous && loaded && now !== "[]";
                previous = now;
                return same;
            },
            { message: "Die Zonennamen kommen nicht zur Ruhe", timeout: 30_000, intervals: [250] },
        )
        .toBe(true);
    await settleFrame(page);
    return page.evaluate(() =>
        (globalThis.avesmapsClimateLabels?.placed() ?? []).map((target) => ({
            key: target.key,
            name: target.name,
            at: [target.at[0], target.at[1]] as [number, number],
            room: target.room,
        })),
    );
}

/** Misst jeden Namen an der gezeichneten Karte. */
async function measure(page: Page, placed: Placed[]): Promise<Measured[]> {
    return page.evaluate((labels) => {
        const map = globalThis.avesmapsMap as unknown as Handle;
        const canvas = map.getCanvas();
        const padding = globalThis.avesmapsVisibleArea!.insets();
        const rect = {
            left: padding.left ?? 0,
            top: padding.top ?? 0,
            right: canvas.clientWidth - (padding.right ?? 0),
            bottom: canvas.clientHeight - (padding.bottom ?? 0),
        };
        const bandAt = (x: number, y: number): string | undefined => {
            const sea = map
                // Das Meer liegt seit dem Nachtrag zu WI-0083 als Grund in `gewaesser-grund`, der See in `gewaesser-flaeche`.
                .queryRenderedFeatures([x, y], { layers: ["gewaesser-flaeche", "gewaesser-grund"] })
                .some((feature) => feature.properties["region_type"] === "meer");
            if (sea) return undefined;
            const band = map.queryRenderedFeatures([x, y], { layers: ["climate-fill"] })[0];
            return band ? String(band.properties["type_key"]) : undefined;
        };
        // Ein Raster von Stichpunkten über die freie Fläche: je Zone die Mitte ihres sichtbaren Landes.
        const step = 16;
        const columns = new Map<string, { sum: number; count: number }>();
        for (let x = rect.left + step / 2; x < rect.right; x += step) {
            for (let y = rect.top + step / 2; y < rect.bottom; y += step) {
                const key = bandAt(x, y);
                if (key === undefined) continue;
                const entry = columns.get(key) ?? { sum: 0, count: 0 };
                entry.sum += x;
                entry.count += 1;
                columns.set(key, entry);
            }
        }
        return labels.map((label) => {
            const [x, y] = label.at;
            let top = y;
            while (top - 2 >= rect.top && bandAt(x, top - 2) === label.key) top -= 2;
            let bottom = y;
            while (bottom + 2 <= rect.bottom && bandAt(x, bottom + 2) === label.key) bottom += 2;
            const centre = columns.get(label.key);
            return {
                ...label,
                drawn: map
                    .queryRenderedFeatures([x, y], { layers: ["climate-label"] })
                    .map((feature) => String(feature.properties["name"])),
                band: map.queryRenderedFeatures([x, y], { layers: ["climate-fill"] })[0]?.properties["type_key"] as
                    string | undefined,
                sea: map
                    .queryRenderedFeatures([x, y], { layers: ["gewaesser-flaeche", "gewaesser-grund"] })
                    .some((feature) => feature.properties["region_type"] === "meer"),
                extent: [top, bottom] as [number, number],
                centreX: centre ? centre.sum / centre.count : Number.NaN,
            };
        });
    }, placed);
}

/** Was für jeden Namen gilt, wo er auch steht. */
function expectWellPlaced(labels: Measured[]): void {
    for (const label of labels) {
        const where = `${label.name} bei ${label.at.map(Math.round).join(", ")}`;
        expect(label.drawn, `${where}: gezeichnet, wo er stehen soll`).toContain(label.name);
        expect(label.band, `${where}: auf seinem Band`).toBe(label.key);
        expect(label.sea, `${where}: nicht im Meer`).toBe(false);
        const [top, bottom] = label.extent;
        // Die Grenzen sind auf 2 px gemessen; flach ist die Mitte im Bild die Mitte am Boden.
        expect(
            Math.abs(label.at[1] - (top + bottom) / 2),
            `${where}: senkrecht mittig (${top} bis ${bottom})`,
        ).toBeLessThan(4);
        expect(bottom - top, `${where}: genug Platz für einen Namen`).toBeGreaterThanOrEqual(16);
    }
}

test.beforeEach(async ({ page }) => {
    await openMap(page);
    await showLandscapes(page, "klima");
});

test("🔴 in der Übersicht trägt jede Zone im Bild genau einen Namen, mittig auf ihrem Land", async ({ page }) => {
    await showPlace(page, { x: 512, y: 512 }, 0);
    const labels = await measure(page, await settledLabels(page));
    // Gegenprobe: In der Übersicht sind die meisten der acht Zonen zu sehen.
    expect(labels.length, labels.map((label) => label.key).join(", ")).toBeGreaterThanOrEqual(5);
    expect(new Set(labels.map((label) => label.key)).size, "je Zone ein Name").toBe(labels.length);
    expectWellPlaced(labels);
    // Waagrecht: nahe der Mitte des sichtbaren Landes. Ein Raster von 16 px misst sie, und eine Zone aus Inseln darf
    // auf das nächste Land mit Platz ausweichen; die breiten Zonen des Festlands stehen mittig.
    for (const key of ["gemaessigt", "boreal", "subtropen_winterfeucht"]) {
        const label = labels.find((entry) => entry.key === key);
        expect(label, `${key} ist beschriftet`).toBeDefined();
        expect(Math.abs(label!.at[0] - label!.centreX), `${key}: waagrecht mittig`).toBeLessThan(48);
    }
});

test("🔴 nach dem Verschieben steht der Name wieder mittig im sichtbaren Teil", async ({ page }) => {
    await showPlace(page, GARETH, 4);
    const before = await measure(page, await settledLabels(page));
    expectWellPlaced(before);
    const zone = before.find((label) => label.key === "gemaessigt");
    expect(zone, "über Gareth steht die Gemäßigte Zone").toBeDefined();
    expect(Math.abs(zone!.at[0] - zone!.centreX)).toBeLessThan(48);

    // Ein Stück nach Osten und Norden geschoben: Der Name bleibt nicht an der alten Stelle der Karte stehen.
    await page.evaluate(() => {
        (globalThis.avesmapsMap as unknown as { panBy(offset: [number, number], options: object): void }).panBy(
            [260, -140],
            { duration: 600 },
        );
    });
    const after = await measure(page, await settledLabels(page));
    expectWellPlaced(after);
    const moved = after.find((label) => label.key === "gemaessigt");
    expect(moved, "die Zone ist noch im Bild und trägt ihren Namen").toBeDefined();
    expect(Math.abs(moved!.at[0] - moved!.centreX), "waagrecht wieder mittig").toBeLessThan(48);
    // Auf der Karte ist der Name gewandert: Mit der Karte allein stünde er 260 px weiter links.
    expect(Math.abs(moved!.at[0] - (zone!.at[0] - 260))).toBeGreaterThan(48);
});

test("🔴 ein schmaler Streifen am Bildrand trägt keinen Namen", async ({ page }) => {
    // Nördlich von Gareth (y wächst nach Norden), mit der Grenze zur Borealen Zone im Bild.
    await showPlace(page, { x: 560, y: 620 }, 3);
    const labels = await settledLabels(page);
    const zone = labels.find((label) => label.key === "gemaessigt");
    expect(zone).toBeDefined();
    // Die Nordgrenze der Zone über ihrem Namen suchen und bis auf 8 px an den oberen Rand schieben: Die Zone darüber ist
    // dann nur noch ein Streifen, schmaler als ein Name.
    const border = await page.evaluate((at) => {
        const map = globalThis.avesmapsMap as unknown as Handle;
        const key = (y: number): unknown =>
            map.queryRenderedFeatures([at[0], y], { layers: ["climate-fill"] })[0]?.properties["type_key"];
        let y = at[1];
        while (y > 0 && key(y - 1) === "gemaessigt") y -= 1;
        return { y, above: key(y - 1) };
    }, zone!.at);
    test.skip(border.y <= 0 || border.above === undefined, "keine Nordgrenze im Bild");
    await page.evaluate((dy) => {
        (globalThis.avesmapsMap as unknown as { panBy(offset: [number, number], options: object): void }).panBy(
            [0, dy],
            {
                duration: 0,
            },
        );
    }, border.y - 8);
    const after = await settledLabels(page);
    // Der Streifen kann an einer schrägen Grenze anderswo breiter sein; dann muss sein Name dort Platz haben.
    const strip = after.find((label) => label.key === border.above);
    if (strip) {
        expect(strip.room, `${String(border.above)} steht in einem Streifen`).toBeGreaterThanOrEqual(16);
        expect(strip.at[1], `${String(border.above)} steht nicht im 8-px-Streifen am Rand`).toBeGreaterThan(8);
    }
    expectWellPlaced(await measure(page, after));
});
