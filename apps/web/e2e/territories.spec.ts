import { expect, test, type Page } from "@playwright/test";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, politicalMinZoom } from "@avesmaps3d/shared";
import {
    chooseView,
    clickMap,
    GARETH,
    openMap,
    settleFrame,
    showPlace,
    type AreaSelectionHandle,
    type RenderedFeature,
} from "./map-handle.ts";

/**
 * Die politische Karte am echten Stack (WI-0062, ADR-0014): Fläche, Name und Grenzen der Herrschaftsgebiete, der
 * Schalter „Grenzen“ über Standard und Landschaften, das Leuchten beim Klick mit Name und Obergebiet.
 *
 * 🪤 Gemessen wird, was GEZEICHNET ist und was die Karte ANFRAGT, nicht was im Stil steht. Namen und Kennungen kommen aus
 * den Kacheln, nicht aus dem Test: Der Kartenstand ändert sich mit jedem Legacy-Import.
 *
 * 💣 Die Tests brauchen abgeleitete Gebiete in der lokalen Datenbank (`npm run migrate:territories`, dann
 * `npm run derive:territories`) und einen neu gestarteten Martin. Fehlt der Zeiger, scheitern sie mit der Anleitung
 * statt still grün zu sein.
 */

interface StyleHandle {
    getStyle(): {
        layers: { id: string; source?: string }[];
        sources: Record<string, { tiles?: string[]; data?: unknown }>;
    };
}

async function requirePointer(page: Page): Promise<{ revision: string; displayYearBf: number }> {
    const response = await page.request.get("/api/territories/current");
    if (response.status() !== 200) {
        throw new Error(
            `Keine abgeleiteten Herrschaftsgebiete (${String(response.status())}): erst npm run migrate:territories ` +
                "und npm run derive:territories, danach Martin neu starten.",
        );
    }
    return (await response.json()) as { revision: string; displayYearBf: number };
}

async function layerIds(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as StyleHandle).getStyle().layers.map((layer) => layer.id),
    );
}

async function sourceIds(page: Page): Promise<string[]> {
    return page.evaluate(() => Object.keys((globalThis.avesmapsMap as unknown as StyleHandle).getStyle().sources));
}

/** Die Features, die eine Ebene gerade zeichnet; wartet, bis es welche gibt. */
async function drawn(page: Page, layer: string): Promise<RenderedFeature[]> {
    await page.waitForFunction(
        (id) =>
            globalThis.avesmapsMap?.getLayer(id)
                ? globalThis.avesmapsMap.queryRenderedFeatures({ layers: [id] }).length > 0
                : false,
        layer,
        { timeout: 30_000 },
    );
    return page.evaluate((id) => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: [id] }), layer);
}

/** Die Kachelpfade der Gebiete, die die Karte angefragt hat. */
function watchTerritoryRequests(page: Page): () => string[] {
    const seen: string[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/tiles/vector/territory_")) seen.push(`${url.pathname}${url.search}`);
    });
    return () => [...seen];
}

async function selection(page: Page): Promise<AreaSelectionHandle | undefined> {
    return page.evaluate(() => globalThis.avesmapsAreaSelection?.());
}

/** Ein Punkt im sichtbaren Kartenteil, an dem eine Ebene etwas zeichnet (rechts vom Planer, damit kein Panel den Klick fängt). */
async function findPoint(page: Page, layer: string): Promise<{ x: number; y: number }> {
    const point = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        for (let y = 200; y < canvas.clientHeight - 200; y += 31) {
            for (let x = 480; x < canvas.clientWidth - 200; x += 37) {
                if (map.queryRenderedFeatures([x, y], { layers: [id] }).length > 0) return { x, y };
            }
        }
        return null;
    }, layer);
    if (!point) throw new Error(`kein Punkt unter ${layer}`);
    return point;
}

test("🔴 „Politisch“ ist wählbar, sobald Gebiete abgeleitet sind, und die Karte fragt die Kacheln MIT der Revision an", async ({
    page,
}) => {
    const pointer = await requirePointer(page);
    const requests = watchTerritoryRequests(page);
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    await expect(page.getByTestId("fan-view-political")).toBeEnabled();
    await page.getByTestId("fan-view-political").click();
    await expect(page.getByTestId("fan-toggle")).toContainText("Politisch");

    await showPlace(page, GARETH, 5);
    const ids = await layerIds(page);
    expect(ids).toEqual(expect.arrayContaining(["territory-fill", "territory-label", "territory-border-outer"]));
    // Politisch: keine Wege und keine Landschaftsflächen, aber Grundkarte und Hauptstädte.
    expect(ids.some((id) => id.startsWith("path-center-"))).toBe(false);
    expect(ids.some((id) => id.startsWith("landscape-fill-"))).toBe(false);
    expect(ids).toContain("basemap");
    expect(ids).toContain("place-marker");

    const fill = await drawn(page, "territory-fill");
    expect(fill.length).toBeGreaterThan(0);
    for (const feature of fill.slice(0, 20)) {
        expect(String(feature.properties["color"]), "Farbe des Gebiets").toMatch(/^#[0-9a-f]{6}$/);
        // Jedes Merkmal trägt seinen Durchlauf von Bändern: das Band der Ansicht wählt der Stil (Nachtrag 2026-09-30).
        expect(Number(feature.properties["band"])).toBeLessThanOrEqual(Number(feature.properties["band_to"]));
    }
    await settleFrame(page);
    const angefragt = requests();
    expect(angefragt.length, "die Karte hat Gebietskacheln angefragt").toBeGreaterThan(0);
    for (const pfad of angefragt) expect(pfad, "Revision in der Adresse").toContain(`?rev=${pointer.revision}`);
});

/**
 * Der Vorzug am RECHNER steht in der Tafel (Betreiber 2026-09-30: „fürs handy 4 und für desktop 5“, Telefon: `territories.touch.spec.ts`):
 * Band b beginnt bei Kamerazoom `politicalMinZoom(b, Vorzug)`, die Baronien (Band 4) bei Zoom 5.
 */
const RECHNER_VORZUG = AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoom;
const bandBeginn = (band: number): number => politicalMinZoom(band, RECHNER_VORZUG);

test("🔴 das Band folgt dem Kamerazoom: erst die Reiche, dann die Provinzen, dann die Baronien - am Rechner ab Zoom 5 (Legacys z + 1)", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    await chooseView(page, "political");
    expect(bandBeginn(4), "die Baronien beginnen am Rechner bei Zoom 5").toBe(5);

    const zustand = (): Promise<number> =>
        page.evaluate(
            () =>
                (
                    globalThis.avesmapsMap as unknown as { style: { getGlobalState(): Record<string, number> } }
                ).style.getGlobalState()["territoryBand"] as number,
        );
    const sicht = async (zoom: number): Promise<{ depths: number[]; names: string[]; band: number }> => {
        await showPlace(page, GARETH, zoom);
        const features = await drawn(page, "territory-fill");
        return {
            depths: [...new Set(features.map((feature) => Number(feature.properties["depth"])))].sort((a, b) => a - b),
            names: [...new Set(features.map((feature) => String(feature.properties["name"])))],
            band: await zustand(),
        };
    };
    // Band 1 (Kamerazoom 2,6 am Rechner): nur Reiche (Tiefe 0). Das Band ist floor(Zoom − 1 + Vorzug der Tafel).
    const reiche = await sicht(bandBeginn(1) + 0.6);
    expect(reiche.band).toBe(1);
    expect(reiche.depths, "Band 1 zeigt nur Reiche").toEqual([0]);
    // Band 3 (Zoom 4,6): Provinzen, noch keine Baronie. Legacy hätte hier (z3) auch noch keine.
    const provinzen = await sicht(bandBeginn(3) + 0.6);
    expect(provinzen.band).toBe(3);
    expect(Math.max(...provinzen.depths)).toBeGreaterThan(0);
    expect(provinzen.names.filter((name) => name.startsWith("Baronie"))).toEqual([]);
    // 🔴 Der Umschaltpunkt liegt STUFENLOS bei Zoom 5: bei 4,9 noch Band 3 ohne Baronien, bei 5,1 Band 4 mit ihnen.
    const davor = await sicht(bandBeginn(4) - 0.1);
    expect(davor.band).toBe(3);
    expect(davor.names.filter((name) => name.startsWith("Baronie"))).toEqual([]);
    const baronien = await sicht(bandBeginn(4) + 0.1);
    expect(baronien.band).toBe(4);
    expect(baronien.names.filter((name) => name.startsWith("Baronie")).length).toBeGreaterThan(20);
    expect(Math.max(...baronien.depths)).toBeGreaterThan(Math.max(...provinzen.depths));
    // Tief herein (Band 6, Zoom 7,6): die Baronien mit ihren Obergebieten, kein Reich mehr über der ganzen Karte.
    const tief = await sicht(bandBeginn(6) + 0.6);
    expect(tief.band).toBe(6);
    expect(Math.min(...tief.depths), "Band 6 zeigt Gebiete unterhalb der Reiche").toBeGreaterThan(0);
});

test("🔴 ein Klick lässt das Gebiet gelb leuchten, färbt seinen Namen gelb und öffnet das Infopanel (F7, WI-0063 P5, WI-0121 Nachtrag)", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    await chooseView(page, "political");
    await showPlace(page, GARETH, 6);
    await drawn(page, "territory-fill");

    const point = await findPoint(page, "territory-fill");
    const gebiet = await page.evaluate(
        ([x, y]) =>
            globalThis.avesmapsMap!.queryRenderedFeatures([x!, y!], { layers: ["territory-fill"] })[0]!.properties,
        [point.x, point.y],
    );
    await clickMap(page, point);
    await expect.poll(async () => (await selection(page))?.kind).toBe("territory");
    const gewaehlt = await selection(page);
    expect(gewaehlt?.id).toBe(gebiet["territory_public_id"]);
    expect(gewaehlt?.name).toBe(gebiet["name"]);
    await settleFrame(page);

    // Die Markierung liegt auf genau diesem Gebiet, in der Kachelquelle der Gebiete, mit der Farbe der Auswahl.
    const leuchtet = await drawn(page, "area-selection-fill");
    expect(new Set(leuchtet.map((feature) => feature.properties["territory_public_id"]))).toEqual(
        new Set([gebiet["territory_public_id"]]),
    );
    const farbe = await page.evaluate(() =>
        globalThis.avesmapsMap!.getPaintProperty("area-selection-fill", "fill-color"),
    );
    expect(farbe, "die vorhandene gelbe Markierung (WI-0043)").toBe("#ffd72e");

    // 🔴 Der Name bleibt in der Ebene der Gebietsnamen stehen und wird dort gelb (WI-0121 Nachtrag, Betreiber 2026-10-09): keine zweite
    // Beschriftung für das Gebiet, keine zweite Zeile mit dem Obergebiet (das nennt das Infopanel). Wo der Name im Bild steht, belegt
    // `territory-name-select.spec.ts` am Bild.
    const zweite = await page.evaluate(
        () =>
            (
                (globalThis.avesmapsMap as unknown as StyleHandle).getStyle().sources["area-selection-label"]?.data as {
                    features: unknown[];
                }
            ).features.length,
    );
    expect(zweite, "kein zweiter Name für das gewählte Gebiet").toBe(0);
    // Das Infopanel (WI-0063 P5): Der Klick wählt das Gebiet als Subject, und das Panel nennt es beim Namen.
    await expect(page.locator("[data-testid='info-panel']")).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText(String(gebiet["name"]));
    await expect.poll(async () => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("territory");

    // Ein Klick ins Meer beendet die Auswahl (der Rückfall `empty`).
    await showPlace(page, { x: 300, y: 400 }, 4);
    await settleFrame(page);
    const meer = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const c = map.getCanvas();
        for (let y = 200; y < c.clientHeight - 200; y += 40) {
            for (let x = 480; x < c.clientWidth - 200; x += 40) {
                if (map.queryRenderedFeatures([x, y], { layers: ["territory-fill"] }).length === 0) return { x, y };
            }
        }
        return null;
    });
    if (meer) {
        await clickMap(page, meer);
        await expect.poll(async () => (await selection(page))?.kind).not.toBe("territory");
    }
});

test("🔴 die Auswahl übersteht das Zoomen im Band, endet aber, wo das Gebiet keine eigene Fläche mehr ist", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    await chooseView(page, "political");
    await showPlace(page, GARETH, bandBeginn(5) + 0.2);
    await drawn(page, "territory-fill");
    const point = await findPoint(page, "territory-fill");
    await clickMap(page, point);
    await expect.poll(async () => (await selection(page))?.kind).toBe("territory");
    const gewaehlt = (await selection(page))?.id;
    await settleFrame(page);

    // Ein Zoomen im selben Band lässt die Auswahl stehen (Zoom 6 bis 7 ist Band 5, dort sieht die Fläche gleich aus).
    await page.evaluate(() => globalThis.avesmapsMap!.jumpTo({ zoom: 6.8 }));
    await settleFrame(page);
    expect((await selection(page))?.id).toBe(gewaehlt);
    await drawn(page, "area-selection-fill");

    // Weit heraus: Das Gebiet ist in Band 1 keine eigene Fläche. Die Auswahl endet - kein Name ohne Fläche.
    await page.evaluate(() => globalThis.avesmapsMap!.jumpTo({ zoom: 2.5 }));
    await expect.poll(async () => (await selection(page))?.kind, { timeout: 15_000 }).not.toBe("territory");
});

test("🔴 die Standardkarte startet mit Grenzen (wie Legacy, Betreiber 2026-09-29: „an“) - ohne Fläche und ohne Gebietsnamen in der Fläche - und lädt nur die Linienkacheln; der Schalter nimmt sie weg", async ({
    page,
}) => {
    const pointer = await requirePointer(page);
    const requests = watchTerritoryRequests(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await settleFrame(page);

    const ids = await layerIds(page);
    // Legacys schwacher Modus: EINE Außenschicht für alle Hüllen (keine dickeren Reiche), dazu die Namen entlang der Grenze.
    expect(ids).toEqual(expect.arrayContaining(["territory-border-outer", "territory-border-name"]));
    expect(ids).not.toContain("territory-border-outer-root");
    expect(ids).not.toContain("territory-fill");
    expect(ids).not.toContain("territory-label");
    expect(await sourceIds(page)).toContain("territory-borders");
    expect(await sourceIds(page)).not.toContain("territories");
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 30_000 });
    const angefragt = requests();
    expect(angefragt.length).toBeGreaterThan(0);
    for (const pfad of angefragt) {
        expect(pfad).toContain("/tiles/vector/territory_border_tile/");
        expect(pfad).toContain(`?rev=${pointer.revision}`);
    }
    // Die Standardkarte bleibt Standard: Orte, Wege, Namen.
    expect(ids).toContain("place-marker");

    // Aus: die Linien verschwinden samt Quelle; wieder an: sie kommen zurück.
    await page.getByTestId("display-open").click();
    const zeile = page.getByTestId("display-borders");
    await expect(zeile.locator("input")).toBeEnabled();
    await expect(zeile.locator("input")).toBeChecked();
    await zeile.click();
    await expect(zeile.locator("input")).not.toBeChecked();
    await settleFrame(page);
    expect((await layerIds(page)).filter((id) => id.startsWith("territory-"))).toEqual([]);
    expect(await sourceIds(page)).not.toContain("territory-borders");
    await zeile.click();
    await expect(zeile.locator("input")).toBeChecked();
    await settleFrame(page);
    expect(await layerIds(page)).toContain("territory-border-outer");
});

test("in „Nur Karte“ und den Kraftlinien bleibt „Grenzen“ gesperrt, in Politisch ist der Schalter an", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    await chooseView(page, "none");
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-borders").locator("input")).toBeDisabled();
    await page.getByTestId("display-open").click();

    await chooseView(page, "political");
    await page.getByTestId("display-open").click();
    const schalter = page.getByTestId("display-borders").locator("input");
    await expect(schalter).toBeEnabled();
    await expect(schalter).toBeChecked();
    // Aus: Fläche und Namen bleiben, die Linien gehen.
    await page.getByTestId("display-borders").click();
    await expect(schalter).not.toBeChecked();
    await settleFrame(page);
    const ids = await layerIds(page);
    expect(ids).toContain("territory-fill");
    expect(ids).not.toContain("territory-border-outer");
});

/** Die Namen, die kein Gebiet an seiner Außengrenze trägt (Legacy `TERRITORY_LABEL_EXCLUDE`, die Tafel führt sie). */
const AUSGENOMMEN = /^(Baronie|Junkertum|Vogtei|Rittergut|Freiherrschaft|Reichsstadt|Stadt)\b/i;
/** Eine Stelle an der Grenze der Markgrafschaft Rommilyser Mark (Garetien), Legacy z5: der Name des Königreichs steht daran. */
const GRENZE_GARETIEN = { x: 552.7, y: 567.6 };
/** Ein Ort mitten unter Baronien, die selbst Junkertümer tragen (Baronie Zwerch, Bugenhog, Puleth). */
const BARONIEN = { x: 570, y: 545 };

interface NameFeature {
    kind: string;
    label_name?: string;
    territory_public_id: string;
}

/** Die Linien der Grenzquelle, die geladene Kacheln tragen (auch die, die kein Layer zeichnet). */
async function borderSourceFeatures(page: Page): Promise<NameFeature[]> {
    return page.evaluate(() =>
        globalThis
            .avesmapsMap!.querySourceFeatures("territory-borders", { sourceLayer: "territory_border_render" })
            .map((feature) => feature.properties as unknown as NameFeature),
    );
}

test("🔴 Namen entlang der Außengrenze: in Standard mit „Grenzen“ ab Legacy z4 (Band 4), weiß und nie an einer Baronie", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    // Standard startet mit Grenzen; die Namen sind ein Layer der Linienquelle.
    expect(await layerIds(page)).toContain("territory-border-name");
    const layer = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return {
            minzoom: (map.getLayer("territory-border-name") as { minzoom?: number } | undefined)?.minzoom,
            color: map.getPaintProperty("territory-border-name", "text-color"),
        };
    });
    // 🔴 Kein minzoom: MapLibre baute damit in fernen Kacheln der geneigten Ansicht keine Namen. Ab Legacy z4 (Band 4) filtert
    // der Stil auf das Band der Ansicht.
    expect(layer.minzoom, "kein minzoom an der Namensebene").toBeUndefined();
    expect(layer.color).toBe("rgba(255, 255, 255, 0.75)");

    // Unter Band 4 (Kamerazoom unter 5 am Rechner): nichts gezeichnet. Die Kachel trägt alle Bänder, also auch die
    // Namenslinien der höheren; gezeichnet werden sie erst im Band der Tafel.
    await showPlace(page, GRENZE_GARETIEN, bandBeginn(4) - 0.1);
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 30_000 });
    expect(
        await page.evaluate(
            () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["territory-border-name"] }).length,
        ),
    ).toBe(0);

    // Ab Kamerazoom 5 (Band 4) stehen Namenslinien in den Kacheln und an einer Grenze Garetiens ein Name.
    await showPlace(page, GRENZE_GARETIEN, 5.3);
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 30_000 });
    await settleFrame(page);
    const namenslinien = (await borderSourceFeatures(page)).filter((feature) => feature.kind === "name");
    expect(namenslinien.length).toBeGreaterThan(0);
    for (const feature of namenslinien) expect(feature.label_name, "Name ist da und erlaubt").not.toMatch(AUSGENOMMEN);
    await expect
        .poll(
            async () =>
                page.evaluate(
                    () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["territory-border-name"] }).length,
                ),
            { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
    const gesetzt = await page.evaluate(() =>
        globalThis
            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-border-name"] })
            .map((feature) => String(feature.properties["label_name"])),
    );
    for (const name of gesetzt) expect(name).not.toMatch(AUSGENOMMEN);
});

test("🔴 die Grenze einer Baronie trägt keinen Namen, auch wenn sie eine Außengrenze hat (Ausnahmen wie Legacy)", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    // In Politisch stehen beide Quellen im Stil: die Flächen (Elternnamen der gezeigten Gebiete) und die Linien.
    await chooseView(page, "political");
    await showPlace(page, BARONIEN, 6.4);
    await drawn(page, "territory-fill");
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 30_000 });
    await settleFrame(page);

    const eltern = await page.evaluate(() => {
        const found: Record<string, string> = {};
        for (const feature of globalThis.avesmapsMap!.querySourceFeatures("territories", {
            sourceLayer: "territory_fill_render",
        })) {
            const id = feature.properties["parent_public_id"];
            const name = feature.properties["parent_name"];
            if (typeof id === "string" && typeof name === "string") found[id] = name;
        }
        return found;
    });
    const linien = await borderSourceFeatures(page);
    const mitAussengrenze = new Set(
        linien.filter((feature) => feature.kind === "outer").map((f) => f.territory_public_id),
    );
    const mitName = new Set(linien.filter((feature) => feature.kind === "name").map((f) => f.territory_public_id));
    const ausgenommen = Object.entries(eltern).filter(
        ([id, name]) => AUSGENOMMEN.test(name) && mitAussengrenze.has(id),
    );
    // Nicht leer: sonst prüfte der Test nichts (BARONIEN muss unter Baronien mit Junkertümern liegen).
    expect(
        ausgenommen.length,
        "eine Hülle mit ausgenommenem Namen und Außengrenze in diesem Ausschnitt",
    ).toBeGreaterThan(0);
    for (const [id, name] of ausgenommen) expect(mitName.has(id), `${name} hat keinen Namen an der Grenze`).toBe(false);
    // Und wo eine Hülle einen Namen trägt, ist es ihr Name.
    for (const feature of linien.filter((entry) => entry.kind === "name")) {
        const bekannt = eltern[feature.territory_public_id];
        if (bekannt !== undefined) expect(feature.label_name).toBe(bekannt);
    }
});

test("Politisch und Landschaften tragen keine Namen entlang der Grenze (Legacy: nur Standard)", async ({ page }) => {
    await requirePointer(page);
    await openMap(page);
    await chooseView(page, "political");
    await showPlace(page, GRENZE_GARETIEN, 6.3);
    expect(await layerIds(page)).not.toContain("territory-border-name");
    expect(await layerIds(page)).toContain("territory-label");

    await chooseView(page, "landscapes");
    await page.getByTestId("display-open").click();
    const zeile = page.getByTestId("display-borders");
    await expect(zeile.locator("input")).toBeEnabled();
    // Landschaften starten ohne Grenzen; mit dem Schalter kommen die Linien, aber keine Namen an ihnen.
    if (!(await zeile.locator("input").isChecked())) await zeile.click();
    await settleFrame(page);
    const ids = await layerIds(page);
    expect(ids).toContain("territory-border-outer");
    expect(ids).not.toContain("territory-border-name");
});

/** Baronie Drachengau: Legacy lässt sie von der Reichsmark Osterfelde beanspruchen (`political_territory_claim`, Stand 2026-09-29). */
const UMSTRITTEN = { x: 631.7, y: 596.5 };

interface ImageHandle {
    hasImage(id: string): boolean;
    getImage(id: string): { data: { width: number; height: number; data: Uint8Array } } | undefined;
}

test("🔴 Schraffur umstrittener Gebiete: Streifen in den Farben der Parteien über dem Kartenbild, nur in Politisch, ein Klick wählt das Gebiet", async ({
    page,
}) => {
    await requirePointer(page);
    const warnungen: string[] = [];
    page.on("console", (message) => {
        if (message.text().includes("could not be loaded")) warnungen.push(message.text());
        // 🪤 Seit WI-0121 hängen auch die Wappen am Auflöser der Karte. Zweimal in sechs Läufen meldete MapLibre hier ein
        // Wappen als „could not be loaded“ (2026-10-09). Ursache (WI-0123): EIN gescheiterter Abruf (der gemeinsame Server
        // startete neu) ließ das Wappen ausbleiben, denn MapLibre fragt für eine gebaute Kachel nie wieder. Seitdem holt
        // `territory-coat-images.ts` einen vorübergehend gescheiterten Abruf nach (Regressionsfall in `territory-coats.spec.ts`).
        // Bleibt ein Wappen trotzdem aus (Server länger weg als die Versuche), steht der Grund in dieser Zeile des Ladecodes
        // und landet in der Meldung des Falls.
        if (message.text().startsWith("Wappen ")) warnungen.push(message.text());
    });
    await openMap(page);
    await chooseView(page, "political");
    // Band 6 (Zoom 7,6 am Rechner): das Muster heißt nach dem Band, `claim-6-…`.
    await showPlace(page, UMSTRITTEN, bandBeginn(6) + 0.6);
    const flaechen = await drawn(page, "territory-claim-hatch");
    expect(flaechen.length).toBeGreaterThan(0);
    await settleFrame(page);

    const point = await findPoint(page, "territory-claim-hatch");
    const unter = await page.evaluate(
        ([x, y]) => {
            const map = globalThis.avesmapsMap!;
            return {
                claim: map.queryRenderedFeatures([x!, y!], { layers: ["territory-claim-hatch"] })[0]!.properties,
                fill: map.queryRenderedFeatures([x!, y!], { layers: ["territory-fill"] }).map((f) => f.properties),
            };
        },
        [point.x, point.y],
    );
    // Das Muster heißt nach Band und Farben der Parteien (das Gebiet zuerst) und existiert als Bild.
    const muster = String(unter.claim["pattern"]);
    expect(muster).toMatch(/^claim-6-[0-9a-f]{6}(-[0-9a-f]{6})+$/);
    const farben = muster.split("-").slice(2);
    expect(farben.length, "das Gebiet und mindestens ein Anspruchsteller").toBeGreaterThanOrEqual(2);
    // Die Füllung fehlt dort (Legacy schneidet das Gebiet heraus): Es liegt eine Fläche darunter, ganz umstritten, ohne Füllung.
    expect(unter.fill.some((eigenschaften) => eigenschaften["hatched"] === true)).toBe(true);
    // Das Bild enthält genau die Farben der Parteien, undurchsichtig, in Streifen (mehr als eine Farbe, jede vorhanden).
    const bild = await page.evaluate((id) => {
        const handle = globalThis.avesmapsMap as unknown as ImageHandle;
        const image = handle.getImage(id);
        if (!handle.hasImage(id) || !image) return undefined;
        const seen: Record<string, number> = {};
        for (let at = 0; at < image.data.data.length; at += 4) {
            const key = [0, 1, 2]
                .map((i) => (image.data.data[at + i] as number).toString(16).padStart(2, "0"))
                .join("");
            seen[key] = (seen[key] ?? 0) + 1;
        }
        return { width: image.data.width, height: image.data.height, seen };
    }, muster);
    expect(bild, "das Muster ist als Bild angelegt").toBeDefined();
    expect([32, 64, 128]).toContain(bild?.width);
    for (const farbe of farben) {
        expect(bild?.seen[farbe] ?? 0, `Streifen in ${farbe}`).toBeGreaterThan((bild?.width ?? 0) * 3);
    }
    expect(warnungen, "kein Muster fehlte beim Zeichnen").toEqual([]);

    // Ein Klick auf die Schraffur wählt das Gebiet darunter, wie ein Klick auf seine Füllung.
    await clickMap(page, point);
    await expect.poll(async () => (await selection(page))?.kind).toBe("territory");
    expect((await selection(page))?.id).toBe(unter.claim["territory_public_id"]);

    // Nur die politische Ansicht schraffiert (Legacy: getSelectedMapLayerMode() === political).
    await chooseView(page, "standard");
    await settleFrame(page);
    expect(await layerIds(page)).not.toContain("territory-claim-hatch");
});

/**
 * Drei Stellen, an denen Legacys Nachbarflächen sich überlappen statt kantengleich zu liegen (Stand 2026-09-30, Karteneinheiten):
 * Baronie Sardosk / Keilerau, Kaiserlich Muschelstrand / Sardosk und Rallerfeste / Zossberg. Der Messpunkt liegt in der Mitte
 * zwischen den zwei Linien, die dort vor dem Feinschliff der Innengrenzen standen (10 bis 23 Bildpunkte auseinander bei
 * Zoom 8); jetzt bleibt eine. Verschiebt ein Legacy-Zug die Grenzen, fehlt die Linie am Messpunkt, und der Test sagt es.
 */
const UEBERLAPPUNGEN = [
    { name: "Sardosk / Keilerau", x: 737.974, y: 564.466 },
    { name: "Kaiserlich Muschelstrand / Sardosk", x: 751.513, y: 562.317 },
    { name: "Rallerfeste / Zossberg", x: 729.067, y: 579.324 },
];

/**
 * Wie viele getrennte Innenlinien eine Messstrecke quert: In Schritten von einem Bildpunkt wird gefragt, ob eine Innengrenze
 * unter dem Punkt liegt; ein Treffer bildet mit den Nachbarn eine Gruppe, eine Lücke von mindestens zwei Bildpunkten trennt
 * zwei Gruppen. Gedoppelte Kacheln und die Striche der Linie stören nicht (gefragt wird die Geometrie, nicht die Tinte).
 */
async function innenlinienAnStrecke(
    page: Page,
    center: { x: number; y: number },
    richtung: "waagerecht" | "senkrecht",
    halbLaenge: number,
    ebenenPraefix = "territory-border-inner-",
): Promise<number> {
    return page.evaluate(
        ({ point, way, half, prefix }) => {
            const map = globalThis.avesmapsMap!;
            const projection = globalThis.avesmapsRenderProjection!;
            const layers = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => id.startsWith(prefix));
            const middle = map.project(projection.toRenderLngLat(point));
            const query = map.queryRenderedFeatures as unknown as (
                box: [[number, number], [number, number]],
                options: { layers: string[] },
            ) => unknown[];
            let groups = 0;
            let gap = Infinity;
            for (let step = -half; step <= half; step += 1) {
                const x = middle.x + (way === "waagerecht" ? step : 0);
                const y = middle.y + (way === "senkrecht" ? step : 0);
                const hit =
                    query.call(
                        map,
                        [
                            [x - 1.5, y - 1.5],
                            [x + 1.5, y + 1.5],
                        ],
                        { layers },
                    ).length > 0;
                if (hit) {
                    if (gap >= 2) groups += 1;
                    gap = 0;
                } else {
                    gap += 1;
                }
            }
            return groups;
        },
        { point: center, way: richtung, half: halbLaenge, prefix: ebenenPraefix },
    );
}

test("die Messstrecke unterscheidet zwei parallele Linien im Abstand von acht Bildpunkten von einer einzigen", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, GARETH, 8);
    // Zwei künstliche Linien quer über die Mitte, im Abstand von 8 Bildpunkten: dieselbe Lage, in der die doppelte Innengrenze stand.
    const gemessen = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            addSource(id: string, source: unknown): void;
            addLayer(layer: unknown): void;
            unproject(point: { x: number; y: number }): { lng: number; lat: number };
            project(lngLat: { lng: number; lat: number }): { x: number; y: number };
            getCenter(): { lng: number; lat: number };
        };
        // Die Mitte der Karte: Dort misst `innenlinienAnStrecke` unten (`getCenter`).
        const middle = map.project(map.getCenter());
        const line = (dy: number): unknown => {
            const a = map.unproject({ x: middle.x - 60, y: middle.y + dy });
            const b = map.unproject({ x: middle.x + 60, y: middle.y + dy });
            return {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [a.lng, a.lat],
                        [b.lng, b.lat],
                    ],
                },
            };
        };
        map.addSource("probe-eine", { type: "geojson", data: { type: "FeatureCollection", features: [line(0)] } });
        map.addLayer({ id: "probe-eine", type: "line", source: "probe-eine", paint: { "line-width": 2 } });
        map.addSource("probe-zwei", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [line(-4), line(4)] },
        });
        map.addLayer({ id: "probe-zwei", type: "line", source: "probe-zwei", paint: { "line-width": 2 } });
        return null;
    });
    expect(gemessen).toBeNull();
    await settleFrame(page);
    const mitte = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const centre = map.getCenter();
        return globalThis.avesmapsRenderProjection!.fromRenderLngLat(centre);
    });
    expect(await innenlinienAnStrecke(page, mitte, "senkrecht", 28, "probe-eine")).toBe(1);
    expect(await innenlinienAnStrecke(page, mitte, "senkrecht", 28, "probe-zwei")).toBe(2);
});

test("🔴 an einer Baronie-Grenze steht EINE gestrichelte Innengrenze, auch wo Legacys Nachbarflächen sich überlappen", async ({
    page,
}) => {
    await requirePointer(page);
    await openMap(page);
    await chooseView(page, "political");
    for (const stelle of UEBERLAPPUNGEN) {
        await showPlace(page, stelle, 8);
        await drawn(page, "territory-border-inner-4");
        await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 30_000 });
        await settleFrame(page);
        const waagerecht = await innenlinienAnStrecke(page, stelle, "waagerecht", 28);
        const senkrecht = await innenlinienAnStrecke(page, stelle, "senkrecht", 28);
        // Höchstens eine Linie je Richtung (zwei parallele im Abstand von einigen Bildpunkten wären zwei Gruppen) und in
        // mindestens einer Richtung eine (sonst stünde am Messpunkt gar keine Grenze).
        expect(waagerecht, `${stelle.name}: waagerecht`).toBeLessThanOrEqual(1);
        expect(senkrecht, `${stelle.name}: senkrecht`).toBeLessThanOrEqual(1);
        expect(waagerecht + senkrecht, `${stelle.name}: Innengrenze am Messpunkt`).toBeGreaterThanOrEqual(1);
    }
});
