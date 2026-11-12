import { expect, test, type Page } from "@playwright/test";
import { GARETH, clickMap, openMap, chooseView, settleFrame } from "./map-handle.ts";

/**
 * Die Herrschaftsgebiete in der geneigten Ansicht (WI-0062 Nachtrag, Betreiber 2026-09-30): EIN Band im ganzen Bild.
 *
 * 💣 Die Fehler, die der Betreiber sah (geneigt, mit Gelände): eine Grafschaft, die oben an einer geraden Linie endet, dahinter
 * das Königreich; Grenzen, die mitten im Bild aufhören. Ursache: MapLibre lädt mit Gelände die fernen Kacheln in niedrigerem
 * Zoom (Level of Detail), und das Band hing am Zoom der KACHEL - jede Kachel zeigte ihr eigenes. Jetzt hängt es nur am
 * Kamerazoom (dem Abstand der Kamera zur Oberfläche), und jede Kachel trägt alle Bänder.
 *
 * 🪤 Das Level of Detail gibt es nur mit Gelände (MapLibre: `allowVariableZoom` verlangt `terrain`), und Gelände zeichnet ohne
 * Grafikkarte flach (WI-0049). Ohne beides wäre dieser Test grün, ohne etwas zu prüfen: Er bricht ab, wenn die Kacheln nicht
 * in mehreren Zoomstufen liegen.
 */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

/** Der Kamerazoom der Proben: am Rechner (Vorzug 0, Betreiber 2026-09-30: „für desktop 5“) ist das Band 5, es beginnt bei Zoom 6. */
const KAMERAZOOM = 6.5;

interface BoxQuery {
    queryRenderedFeatures(box: [[number, number], [number, number]], options: { layers: string[] }): unknown[];
}

interface TerrainMap {
    getTerrain(): unknown;
    style: {
        getGlobalState(): Record<string, number>;
        tileManagers: Record<string, { getVisibleCoordinates(): { overscaledZ: number }[] } | undefined>;
    };
}

async function requireTerritories(page: Page): Promise<void> {
    const antwort = await page.request.get("/api/territories/current");
    if (antwort.status() !== 200) {
        throw new Error(
            "Keine abgeleiteten Herrschaftsgebiete: erst npm run derive:territories, danach Martin neu starten.",
        );
    }
}

/** Kippt auf 60° mit Gelände und stellt die Kamera auf Gareth in diesem Zoom. */
async function geneigt(page: Page, zoom: number): Promise<{ kachelzoom: number[]; band: number }> {
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(
        () => (globalThis.avesmapsMap as unknown as TerrainMap | undefined)?.getTerrain() != null,
        undefined,
        { timeout: 20_000 },
    );
    await page.evaluate(
        async ({ point, level }) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({
                center: globalThis.avesmapsRenderProjection!.toRenderLngLat(point),
                zoom: level,
                pitch: 60,
                bearing: 0,
            });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { point: GARETH, level: zoom },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 30_000 });
    await settleFrame(page);
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as TerrainMap & { getPitch(): number };
        const zoomStufen = new Set<number>();
        for (const name of ["territories", "territory-borders"]) {
            for (const id of map.style.tileManagers[name]?.getVisibleCoordinates() ?? [])
                zoomStufen.add(id.overscaledZ);
        }
        return {
            kachelzoom: [...zoomStufen].sort((a, b) => a - b),
            band: map.style.getGlobalState()["territoryBand"] as number,
        };
    });
}

/** Alle Merkmale einer Ebene im Bild, mit dem Bereich ihrer Bänder. */
async function gezeichnet(page: Page, ebene: string): Promise<{ band: number; bandTo: number }[]> {
    return page.evaluate((id) => {
        if (!globalThis.avesmapsMap!.getLayer(id)) return [];
        return globalThis.avesmapsMap!.queryRenderedFeatures({ layers: [id] }).map((feature) => ({
            band: Number(feature.properties["band"]),
            bandTo: Number(feature.properties["band_to"] ?? feature.properties["band"]),
        }));
    }, ebene);
}

for (const [ansicht, ebenen] of [
    ["political", ["territory-fill", "territory-border-outer", "territory-border-inner-4"]],
    ["standard", ["territory-border-outer", "territory-border-inner-4"]],
] as const) {
    test(`🔴 geneigt mit Gelände liegt in ${ansicht} EIN Band über dem ganzen Bild, obwohl die Kacheln in mehreren Zoomstufen liegen`, async ({
        page,
    }) => {
        test.setTimeout(120_000);
        await requireTerritories(page);
        await openMap(page);
        if (ansicht !== "standard") await chooseView(page, ansicht);
        const { kachelzoom, band } = await geneigt(page, KAMERAZOOM);

        // Ohne Gelände und Level of Detail prüfte der Test nichts: Es müssen mindestens zwei Kachelstufen im Bild liegen.
        expect(kachelzoom.length, `Kachelstufen im Bild: ${kachelzoom.join(", ")}`).toBeGreaterThanOrEqual(2);
        // Das Band ist das der Kamera (am Rechner Zoom 6,5 → Band 5, Legacys z + 1).
        expect(band).toBe(5);
        for (const ebene of ebenen) {
            const merkmale = await gezeichnet(page, ebene);
            expect(merkmale.length, ebene).toBeGreaterThan(0);
            for (const merkmal of merkmale) {
                // Jedes gezeichnete Merkmal, ob aus naher oder ferner Kachel, trägt genau dieses Band.
                expect(merkmal.band, ebene).toBeLessThanOrEqual(band);
                expect(merkmal.bandTo, ebene).toBeGreaterThanOrEqual(band);
            }
        }
    });
}

test("🔴 geneigt reicht die Fläche bis in die Ferne, im Band der Ansicht, ohne Lücke im oberen Bild, und die Grenzen hören nicht auf", async ({
    page,
}) => {
    test.setTimeout(120_000);
    await requireTerritories(page);
    await openMap(page);
    await chooseView(page, "political");
    const { kachelzoom } = await geneigt(page, KAMERAZOOM);
    expect(kachelzoom.length).toBeGreaterThanOrEqual(2);

    // Reihen über das ganze Bild, von der Ferne (oben) bis nah (unten): Zu jeder liegt eine Fläche, und jede Fläche gehört
    // zum Band der Ansicht - auch die aus der fernen Kachel in niedrigerem Zoom.
    const reihen = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const ergebnis: { y: number; punkte: number; treffer: number; falsch: number }[] = [];
        const band = (map as unknown as TerrainMap).style.getGlobalState()["territoryBand"] as number;
        for (const anteil of [0.12, 0.25, 0.4, 0.55, 0.7, 0.85]) {
            const y = Math.round(canvas.clientHeight * anteil);
            let punkte = 0;
            let treffer = 0;
            let falsch = 0;
            for (let x = 400; x < canvas.clientWidth - 100; x += 30) {
                punkte += 1;
                const fund = map.queryRenderedFeatures([x, y], { layers: ["territory-fill"] });
                if (fund.length > 0) treffer += 1;
                for (const eintrag of fund) {
                    if (!(
                        Number(eintrag.properties["band"]) <= band && Number(eintrag.properties["band_to"]) >= band
                    )) {
                        falsch += 1;
                    }
                }
            }
            ergebnis.push({ y, punkte, treffer, falsch });
        }
        return ergebnis;
    });
    for (const reihe of reihen) {
        // Über Land (Gareth liegt mitten in Aventurien) liegt an fast jedem Punkt eine Fläche.
        expect(reihe.treffer / reihe.punkte, `Reihe bei y = ${String(reihe.y)}`).toBeGreaterThan(0.8);
        expect(reihe.falsch, `Flächen im falschen Band bei y = ${String(reihe.y)}`).toBe(0);
    }

    // Und die Grenzen hören nicht auf: In jeder der sechs Reihen steht eine Außengrenze (in der Ferne wie in der Nähe).
    const grenzen = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const boxen = map as unknown as BoxQuery;
        const canvas = map.getCanvas();
        const zeilen: number[] = [];
        for (const anteil of [0.12, 0.3, 0.5, 0.7, 0.88]) {
            const y0 = Math.round(canvas.clientHeight * (anteil - 0.06));
            const y1 = Math.round(canvas.clientHeight * (anteil + 0.06));
            zeilen.push(
                boxen.queryRenderedFeatures(
                    [
                        [400, y0],
                        [canvas.clientWidth - 100, y1],
                    ],
                    { layers: ["territory-border-outer", "territory-border-outer-root", "territory-border-inner-4"] },
                ).length,
            );
        }
        return zeilen;
    });
    for (const [index, anzahl] of grenzen.entries()) expect(anzahl, `Streifen ${String(index)}`).toBeGreaterThan(0);
});

test("🔴 geneigt leuchtet die Auswahl im Band der Ansicht, auch über Kachelgrenzen und Kachelstufen hinweg", async ({
    page,
}) => {
    test.setTimeout(120_000);
    await requireTerritories(page);
    await openMap(page);
    await chooseView(page, "political");
    const { kachelzoom, band } = await geneigt(page, KAMERAZOOM);
    expect(kachelzoom.length).toBeGreaterThanOrEqual(2);

    // Ein Gebiet im mittleren Bild anklicken (rechts vom Planer, damit kein Panel den Klick fängt).
    const punkt = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        for (let y = Math.round(canvas.clientHeight * 0.45); y < canvas.clientHeight * 0.75; y += 23) {
            for (let x = 480; x < canvas.clientWidth - 200; x += 29) {
                if (map.queryRenderedFeatures([x, y], { layers: ["territory-fill"] }).length > 0) return { x, y };
            }
        }
        return null;
    });
    if (!punkt) throw new Error("kein Gebiet im mittleren Bild");
    await clickMap(page, punkt);
    await expect
        .poll(async () => page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.kind), { timeout: 15_000 })
        .toBe("territory");
    await settleFrame(page);

    const leuchten = await page.evaluate(() =>
        globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["area-selection-fill"] }).map((feature) => ({
            id: String(feature.properties["territory_public_id"]),
            band: Number(feature.properties["band"]),
            bandTo: Number(feature.properties["band_to"]),
        })),
    );
    const gewaehlt = await page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.id);
    expect(leuchten.length, "die Auswahl leuchtet").toBeGreaterThan(0);
    for (const stueck of leuchten) {
        expect(stueck.id).toBe(gewaehlt);
        // Genau das Band der Ansicht: nicht das Königreich oder die Baronie eines anderen Bandes desselben Gebiets.
        expect(stueck.band).toBeLessThanOrEqual(band);
        expect(stueck.bandTo).toBeGreaterThanOrEqual(band);
    }
});
