import { expect, test, type Page } from "@playwright/test";
import { clickMap, openMap, settleFrame } from "./map-handle.ts";

/**
 * Die Topographie im Kartenfächer (WI-0055, Betreiber 2026-09-28, Blatt 3 „A“): Landschaften → Topographie
 * trägt ein Eselsohr, darüber geht eine dritte Reihe mit „Höhenlinien | Höhenstufen“ auf. Die Höhenstufen
 * bringen ihre Legende über dem Fächer mit; Auge und Lupe rücken hoch.
 *
 * 🪤 Die Höhenstufen brauchen abgeleitete Anzeigehöhen (`derive:display-heights`). Ohne sie gibt es weder
 * Stufen noch Legende; der Test überspringt dann sichtbar, statt still grün zu sein.
 */

interface MapHandle {
    getStyle(): { layers: { id: string }[] };
}

async function layerIds(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as MapHandle).getStyle().layers.map((layer) => layer.id),
    );
}

async function heightTilesDerived(page: Page): Promise<boolean> {
    const status = await page.evaluate(async () => (await fetch("/tiles/terrain/display-height/current.json")).status);
    return status === 200;
}

test("🔴 Topographie → Höhenstufen: dritte Reihe, Legende, Stufen; zurück zu Höhenlinien ohne Legende", async ({
    page,
}) => {
    await openMap(page);
    test.skip(!(await heightTilesDerived(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");

    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-landscapes").hover();
    await page.getByTestId("fan-ohr-landscapes").click();
    await expect(page.getByTestId("fan-layer-topographie")).toBeVisible();
    // Die dritte Reihe geht erst über das Ohr der Topographie auf, nicht beim Überfahren der Zelle.
    await page.getByTestId("fan-layer-topographie").hover();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("fan-drei")).toBeHidden();
    await page.getByTestId("fan-ohr-topographie").click();
    await expect(page.getByTestId("fan-topography-hoehenstufen")).toBeVisible();

    // Die dritte Reihe steht ÜBER der Unterreihe.
    const drei = await page.getByTestId("fan-drei").boundingBox();
    const stufe = await page.getByTestId("fan-stufe").boundingBox();
    expect((drei?.y ?? 0) + (drei?.height ?? 0)).toBeLessThanOrEqual(stufe?.y ?? 0);

    await page.getByTestId("fan-topography-hoehenstufen").click();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toContainText("Derographie");
    await expect(page.getByTestId("fan-toggle")).toContainText("Höhenstufen");
    await expect(page.getByTestId("height-legend")).toBeVisible();
    await settleFrame(page);
    const ids = await layerIds(page);
    expect(ids).toContain("hoehenstufen");
    expect(ids).toContain("hoehenlinie-1000");
    expect(ids).toContain("gipfel");
    await expect.poll(() => page.url()).toContain("topo=hoehenstufen");

    // Die Legende steht über dem Fächer, unter Lupe und Auge.
    const legende = await page.getByTestId("height-legend").boundingBox();
    const kachel = await page.getByTestId("fan-toggle").boundingBox();
    expect((legende?.y ?? 0) + (legende?.height ?? 0)).toBeLessThanOrEqual(kachel?.y ?? 0);

    // Zurück zu den Höhenlinien: keine Stufen, keine Legende, die Linien bleiben.
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-landscapes").hover();
    await page.getByTestId("fan-ohr-landscapes").click();
    // Am Zeiger erscheint das Ohr erst beim Überfahren seiner Zelle, wie in der Reihe.
    await page.getByTestId("fan-layer-topographie").hover();
    await page.getByTestId("fan-ohr-topographie").click();
    await page.getByTestId("fan-topography-hoehenlinien").click();
    await expect(page.getByTestId("height-legend")).toHaveCount(0);
    await expect(page.getByTestId("fan-toggle")).toContainText("Höhenlinien");
    const danach = await layerIds(page);
    expect(danach).not.toContain("hoehenstufen");
    expect(danach).toContain("hoehenlinie-1000");
    await expect.poll(() => page.url()).not.toContain("topo=");
});

test("die Unterwahl überlebt ein Neuladen, und ein Link öffnet die Höhenstufen direkt", async ({ page }) => {
    await page.goto("/#x=575&y=528&z=5.8&series=original&view=landscapes&layer=topographie&topo=hoehenstufen");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    test.skip(!(await heightTilesDerived(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    await expect(page.getByTestId("fan-toggle")).toContainText("Höhenstufen");
    await expect(page.getByTestId("height-legend")).toBeVisible();
    expect(await layerIds(page)).toContain("hoehenstufen");
});

test("Tastatur: Pfeil hoch von Topographie führt in die dritte Reihe, Pfeil runter zurück", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-landscapes").hover();
    await page.getByTestId("fan-ohr-landscapes").click();
    await page.getByTestId("fan-layer-topographie").focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("fan-drei")).toBeVisible();
    await expect(page.locator("[data-testid=fan-drei] .fan__cell").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("fan-layer-topographie")).toBeFocused();
});

test("Gipfel stehen in Standard und in den Landschaften, nicht in Vegetation", async ({ page }) => {
    await openMap(page);
    expect(await layerIds(page)).toContain("gipfel");
    // 🪤 Ein neuer Fragmentteil lädt die Seite nicht neu; die Ansicht liest die Karte beim Start.
    await page.goto("/#x=575&y=528&z=5.8&series=original&view=landscapes&layer=vegetation");
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    expect(await layerIds(page)).not.toContain("gipfel");
});

test("🔴 die Übersicht lädt nur die Tausender; aus der Nähe kommen Fünfhunderter und Hunderter dazu", async ({
    page,
}) => {
    // Betreiber 2026-09-28 (Performance): Die Linienkachel der Übersicht trug alle Linien, sichtbar sind dort nur
    // die Tausender. `terrain_contour_tile` liefert je Zoom nur, was die Karte zeichnet.
    await openMap(page);
    test.skip(!(await heightTilesDerived(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    const levels = async (hash: string): Promise<number[]> => {
        await page.goto(`/#${hash}`);
        await page.reload();
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
        // `settleFrame` wartet auf `idle`: Dann sind alle Kacheln der Ansicht da.
        await settleFrame(page);
        return page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as {
                querySourceFeatures(
                    source: string,
                    options: { sourceLayer: string },
                ): { properties: { level: number } }[];
            };
            const found = map.querySourceFeatures("hoehenlinien", { sourceLayer: "terrain_contour_render" });
            return [...new Set(found.map((feature) => feature.properties.level))].sort();
        });
    };
    const topo = "series=original&view=landscapes&layer=topographie";
    expect(await levels(`x=600&y=600&z=3.5&${topo}`)).toEqual([2]);
    expect(await levels(`x=640&y=670&z=5.5&${topo}`)).toEqual([0, 1, 2]);
});

test("🔴 in den Höhenstufen lassen sich See, Gebirge und Fluss anklicken", async ({ page }) => {
    // Betreiber 2026-09-28: „obwohl flüsse und seen zu den topographischen features gehören, kann ich sie noch
    // nicht anklicken und selektieren wie die andern topographischen flächen (wie gebirge z.B.)“.
    await openMap(page);
    test.skip(!(await heightTilesDerived(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    const flaechenKacheln: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/tiles/vector/region_area_tile/")) flaechenKacheln.push(request.url());
    });
    await page.goto("/#x=638.5&y=670.5&z=8.7&series=original&view=landscapes&layer=topographie&topo=hoehenstufen");
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await settleFrame(page);
    // Der Hinweis zum Drehen und Neigen steht beim ersten Besuch über der Karte, und mit dem offenen Infopanel (WI-0063)
    // rückt er mit dem Ring nach links - über einen Fluss, den der Test sonst anklickte. Wer ihn schließt, hat freie Karte.
    // Seit `e2e/erster-besuch.ts` gilt er als gesehen; steht er doch da (ein anderer Stand), wird er geschlossen.
    const hinweis = page.getByTestId("camera-hint-close");
    if (await hinweis.isVisible().catch(() => false)) await hinweis.click();
    /** Wählt, was unter dem Punkt liegt, und meldet die Quelle der Hervorhebung. */
    const pick = async (at: { x: number; y: number }): Promise<string | undefined> => {
        await clickMap(page, at);
        await page.waitForTimeout(400);
        return page.evaluate(
            () =>
                (globalThis.avesmapsMap as unknown as { getStyle(): { layers: { id: string; source?: string }[] } })
                    .getStyle()
                    .layers.find((layer) => layer.id === "area-selection-fill" || layer.id === "area-selection-path")
                    ?.source,
        );
    };
    /**
     * Eine Stelle AUF dem Waldsee, über der kein Weg liegt.
     *
     * 💣 Hier stand der feste Bildpunkt (640, 450). Seit WI-0090 trägt jede Wegart eine unsichtbare Trefferfläche
     * (`path-hit-<wegart>`, 14 px am Zeiger), und der Besitzer `path` (Rang 45) geht der Fläche (40) vor: Genau dort
     * läuft ein Fluss, der Klick wählte korrekt ihn, und der Fall war dauerhaft rot mit `paths` statt
     * `area-selection-outline`. Der Kommentar oben nennt dieselbe Stelle schon einmal als Fluss-Falle - sie ist es
     * jetzt wieder, und ein zweites Mal geraten hilft nicht. Gesucht wird deshalb eine Stelle, die der Stil selbst als
     * Wasser ohne Weg darüber ausweist; was der Fall zusichert, bleibt dasselbe.
     */
    const seePunkt = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            queryRenderedFeatures(
                point: [number, number],
                options: { layers: string[] },
            ): { properties: Record<string, unknown> }[];
            getStyle(): { layers: { id: string }[] };
            getCanvas(): HTMLCanvasElement;
        };
        const treffer = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => /(^|-)hit(-|$)/.test(id));
        const canvas = map.getCanvas();
        for (let y = 120; y < canvas.clientHeight - 120; y += 10) {
            for (let x = 120; x < canvas.clientWidth - 120; x += 10) {
                const wasser = map.queryRenderedFeatures([x, y], { layers: ["gewaesser-flaeche"] });
                if (!wasser.some((feature) => feature.properties["name"] === "Waldsee")) continue;
                if (map.queryRenderedFeatures([x, y], { layers: treffer }).length > 0) continue;
                return { x, y, treffer: treffer.length };
            }
        }
        return null;
    });
    // Der Waldsee steht in der geglätteten Quelle - sonst gäbe es gar keine Stelle.
    expect(seePunkt, "eine Stelle auf dem Waldsee, über der kein Weg liegt").not.toBeNull();
    // 🪤 Ohne eine einzige Trefferfläche im Stil wäre jede Stelle „frei“, und der Fall prüfte die Vorrangregel nicht.
    expect(seePunkt?.treffer ?? 0, "der Stil trägt Weg-Trefferflächen").toBeGreaterThan(0);
    // WI-0058: In den Höhenstufen kommt der Umriss vom Server, nicht aus den Kacheln.
    expect(await pick({ x: seePunkt?.x ?? 0, y: seePunkt?.y ?? 0 })).toBe("area-selection-outline");
    // Escape arbeitet von innen nach außen (WI-0063 4.10): erst die Liste der Flächen an dieser Stelle, dann das Panel mit der
    // Auswahl. Wo keine Liste offen ist, tut das zweite nichts.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Ein Punkt auf einer benannten Flusslinie: der ganze Fluss.
    const fluss = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            queryRenderedFeatures(o: { layers: string[] }): {
                properties: Record<string, unknown>;
                geometry: { type: string; coordinates: unknown };
            }[];
            project(ll: [number, number]): { x: number; y: number };
        };
        const line = map
            .queryRenderedFeatures({ layers: ["path-center-flussweg"] })
            .find((f) => typeof f.properties["name"] === "string" && f.geometry.type === "LineString");
        if (!line) return undefined;
        const coords = line.geometry.coordinates as [number, number][];
        return map.project(coords[Math.floor(coords.length / 2)] as [number, number]);
    });
    test.skip(fluss === undefined, "kein benannter Fluss im Bild");
    expect(await pick({ x: Math.round(fluss?.x ?? 0), y: Math.round(fluss?.y ?? 0) })).toBe("paths");
    await page.keyboard.press("Escape");

    // Die Rote Sichel (Gebirge) westlich des Sees: die unsichtbare Landfläche der Höhenstufen.
    await page.goto("/#x=633&y=671.3&z=8.2&series=original&view=landscapes&layer=topographie&topo=hoehenstufen");
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await settleFrame(page);
    const berg = await page.evaluate(() => {
        // Kartenpunkt (633,4 | 670,2) in Bildschirmkoordinaten (Renderkoordinaten wie `toRenderLngLat`).
        const half = 20037508.342789244;
        const mx = (633.4 / 1024) * 2 * half - half;
        const my = (670.2 / 1024) * 2 * half - half;
        const lat = ((2 * Math.atan(Math.exp((my / half) * Math.PI)) - Math.PI / 2) * 180) / Math.PI;
        const map = globalThis.avesmapsMap as unknown as { project(ll: [number, number]): { x: number; y: number } };
        return map.project([(mx / half) * 180, lat]);
    });
    expect(await pick({ x: Math.round(berg.x), y: Math.round(berg.y) })).toBe("area-selection-outline");
    // 🔴 WI-0058 (Betreiber 2026-09-28: „nur bei Bedarf“): Anklicken und Zeigen haben keine Landschaftskachel geladen.
    expect(flaechenKacheln, "keine region_area-Kacheln in den Höhenstufen").toEqual([]);
});

/**
 * 🔴 Regressionsfall zur „dunklen Kante am Gipfeldreieck“ (WI-0055 Nachtrag, Betreiber 2026-10-05:
 * „machs hübsch :)“).
 *
 * Der Befund war **kein** Saum, sondern ein **versetzter Schlagschatten**: Unter der waagerechten
 * Grundlinie des Dreiecks stand ein harter schwarzer Balken über die ganze Breite (gemessen bis Alpha
 * 202 von 255), während über der Spitze **gar nichts** stand. Genau das prüft der Test: Der Saum muss
 * ringsum liegen, oben wie unten, und er darf nirgends am Bildrand abgeschnitten sein.
 *
 * 🪤 Das Bild wird aus der Karte gelesen, nicht aus dem Modul: geprüft wird, was MapLibre tatsächlich
 * angemeldet hat.
 */
test("🔴 das Gipfeldreieck trägt seinen Saum ringsum, nicht als Balken unter der Grundlinie", async ({ page }) => {
    await openMap(page);
    const bild = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getImage(id: string): { data: { width: number; height: number; data: Uint8Array } } | undefined;
        };
        const gelesen = map.getImage("gipfel-dreieck");
        if (!gelesen) return undefined;
        const { width, height, data } = gelesen.data;
        // Je Zeile und je Spalte die Alphasumme; daraus lässt sich der Saum ausmessen.
        const zeilen: number[] = [];
        for (let y = 0; y < height; y += 1) {
            let summe = 0;
            for (let x = 0; x < width; x += 1) summe += data[(y * width + x) * 4 + 3] as number;
            zeilen.push(summe);
        }
        const spalten: number[] = [];
        for (let x = 0; x < width; x += 1) {
            let summe = 0;
            for (let y = 0; y < height; y += 1) summe += data[(y * width + x) * 4 + 3] as number;
            spalten.push(summe);
        }
        // Die Spitze ist die oberste Zeile mit heller Füllung, die Grundlinie die unterste.
        let ersteFuellung = -1;
        let letzteFuellung = -1;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const at = (y * width + x) * 4;
                const hell = (data[at] as number) > 200 && (data[at + 3] as number) > 200;
                if (hell) {
                    if (ersteFuellung < 0) ersteFuellung = y;
                    letzteFuellung = y;
                    break;
                }
            }
        }
        return { width, height, zeilen, spalten, ersteFuellung, letzteFuellung };
    });
    expect(bild, "das Laufzeitbild des Gipfeldreiecks ist angemeldet").toBeDefined();
    const { zeilen, spalten, ersteFuellung, letzteFuellung, width, height } = bild as NonNullable<typeof bild>;
    expect(ersteFuellung).toBeGreaterThan(0);
    expect(letzteFuellung).toBeLessThan(height - 1);

    // 🪤 Gemessen wird die REICHWEITE des Saums, nicht seine Masse: Unten steht die ganze Grundlinie, oben nur
    // eine Spitze — die Masse ist auch bei einem rundum gleichen Saum unten größer. Die Reichweite ist es nicht.
    const erste = zeilen.findIndex((summe) => summe > 0);
    const letzte = zeilen.length - 1 - [...zeilen].reverse().findIndex((summe) => summe > 0);
    const obenHinaus = ersteFuellung - erste;
    const untenHinaus = letzte - letzteFuellung;

    // 1. Über der Spitze steht überhaupt Saum. Vorher reichte er dort 1 Zeile weit und unter der Grundlinie 5.
    expect(obenHinaus, "der Saum reicht über die Spitze hinaus").toBeGreaterThan(1);

    // 2. Und er reicht oben so weit wie unten: kein Versatz nach unten, kein Balken.
    const verhaeltnis = obenHinaus / untenHinaus;
    expect(
        verhaeltnis,
        `Reichweite des Saums oben ${String(obenHinaus)} zu unten ${String(untenHinaus)} Bildpunkte`,
    ).toBeGreaterThan(0.6);
    expect(verhaeltnis).toBeLessThan(1.7);

    // 3. Nichts ist am Bildrand abgeschnitten: ein gekappter Schein wäre wieder eine harte Kante.
    for (const [name, wert] of [
        ["oberste Zeile", zeilen[0]],
        ["unterste Zeile", zeilen[height - 1]],
        ["linke Spalte", spalten[0]],
        ["rechte Spalte", spalten[width - 1]],
    ] as const) {
        expect(wert, `${name} ist leer, der Saum wird nicht abgeschnitten`).toBe(0);
    }
});
