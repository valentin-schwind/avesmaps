import { expect, test } from "@playwright/test";
import { KOSCH, landmarkenStub as stub, oeffneLandmarkenListe as oeffneListe } from "./landmarken-stub.ts";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";

/**
 * Landmarken in der Topographie (WI-0271 L4, Entwurf `review/wi-0271/landmarken-entwurf.html`; Kartenmenü A, §9): Liste mit „Objekte“,
 * „Flächenart“ und „Landmarkenart“; Eigenschaften mit Art, Merkmalen und dem Kasten „Gelände“ nur bei Berg und Vulkan; „▲ Landmarke setzen ›“
 * legt erst mit „Fertig“ an. Liste, Detail und Schreibwege aus einem Stub. 🔴 Kein Test schreibt in eine Datenbank; die Schreibwege prüfen
 * `apps/server/test/landmarken-schreiben.test.ts` und `ruecknahme-landmarken.test.ts`.
 *
 * Die Bilder (`test-results/l4-*.png`) sind die Sichtprüfung in 1920 × 1080, 1280 × 800 und 900 px; das Telefonbild macht
 * `landschaftseditor-landmarken.touch.spec.ts` (nur das Telefonprofil fährt Touch-Specs).
 *
 * Problemfälle: Eine Höhle zeigt eine Höhe oder den Kasten „Gelände“; der Wechsel zum Berggipfel bringt ihn nicht; die Merkmale gehen
 * nicht in „Fertig“; der Trichter kennt nur „Art“; das Setzen schreibt schon beim Klick im Menü.
 */

/**
 * Die Arten des Katalogs (`LANDMARKEN_ARTEN`, `packages/shared/src/landmarken.ts`). 🪤 Abgeschrieben, nicht eingeführt: Der Testprozess liest
 * `@avesmaps3d/shared` aus dem gebauten `dist` des Hauptcheckouts, nicht aus den Quellen dieser Arbeitskopie. Kommt eine Art in den Katalog, gehört sie auch hierher.
 */
const ARTEN = [
    "berggipfel",
    "vulkan",
    "huegel",
    "hoehle",
    "grotte",
    "krater",
    "schlucht",
    "wasserfall",
    "quelle",
    "geysir",
    "furt",
    "strudel",
    "fels",
    "klippe",
    "riff",
] as const;

const GROESSEN = [
    { name: "1920", width: 1920, height: 1080 },
    { name: "1280", width: 1280, height: 800 },
    { name: "900", width: 900, height: 800 },
] as const;

for (const groesse of GROESSEN) {
    test(`🔴 L4 (${groesse.name}): die Höhle ohne Gelände, mit Merkmalen; zum Berggipfel gewechselt kommt der Kasten „Gelände“, „Fertig“ schreibt Art und Merkmale`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: groesse.width, height: groesse.height });
        const server = await stub(page);
        const liste = await oeffneListe(page);
        const zeile = liste.getByRole("option", { name: /Probehöhle/ });
        await expect(zeile).toContainText("Höhle");
        await expect(zeile).toContainText("heilig");
        await expect(zeile).not.toContainText("Schritt");
        await zeile.click();
        const fenster = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]');
        await expect(fenster).toContainText("Probehöhle");
        await expect(fenster).toContainText("ohne Geländewirkung");
        await expect(page.locator('[data-testid$="-gipfel-gelaende"]')).toHaveCount(0);
        await expect(page.locator('[data-testid$="-gipfel-merkmal-heilig"]')).toBeChecked();
        await settleFrame(page);
        await page.screenshot({ path: `test-results/l4-hoehle-${groesse.name}.png` });

        await page.locator('[data-testid$="-gipfel-merkmal-gefaehrlich"]').check();
        await page.locator('[data-testid$="-gipfel-art"] select').selectOption("berggipfel");
        await expect(page.locator('[data-testid$="-gipfel-gelaende"]')).toBeVisible();
        await page.locator('[data-testid$="-gipfel-hoehe"]').fill("1800");
        await page.locator('[data-testid$="-gipfel-hoehe"]').blur();
        await settleFrame(page);
        await page.screenshot({ path: `test-results/l4-gelaende-${groesse.name}.png` });
        await page.getByTestId("landschaft-leiste-fertig").click();
        await expect.poll(() => server.gesendet.length).toBe(1);
        expect(server.gesendet[0]!.changes).toEqual({
            subtype: "berggipfel",
            merkmale: ["heilig", "gefaehrlich"],
            height: 1800,
        });
    });
}

test("🔴 L4: der Trichter kennt „Objekte“, „Flächenart“ und „Landmarkenart“; „Landmarken“ zeigt nur die Landmarken", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stub(page);
    const liste = await oeffneListe(page);
    await expect(liste.getByRole("option")).toHaveCount(4);
    await page.locator('[data-testid$="-landschaften-filter"]').click();
    const objekte = page.locator('[data-testid$="-landschaften-filter-maske"]');
    await expect(objekte).toContainText("Objekte");
    await expect(page.locator('[data-testid$="-landschaften-filter-flaechenart"]')).toContainText("Flächenart");
    await expect(page.locator('[data-testid$="-landschaften-filter-landmarkenart"]')).toContainText("Höhle");
    await settleFrame(page);
    await page.screenshot({ path: "test-results/l4-trichter-1920.png" });
    await objekte.getByText("Landmarken", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(liste.getByRole("option")).toHaveCount(2);
});

test("🔴 L4: „▲ Landmarke setzen › Quelle“ schreibt erst mit „Fertig“; danach öffnet das Fenster der neuen Landmarke", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const server = await stub(page);
    await openMap(
        page,
        `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=6&view=landscapes&layer=topographie`,
    );
    const rahmen = await page.evaluate(
        () => globalThis.avesmapsMap!.getCanvas().getBoundingClientRect().toJSON() as DOMRect,
    );
    const stelle = { x: rahmen.left + rahmen.width / 2 - 120, y: rahmen.top + rahmen.height / 2 + 80 };
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").click();
    const eintrag = page.getByTestId("context-editor-landmarke-setzen");
    await expect(eintrag).toContainText("Landmarke setzen");
    await eintrag.hover();
    await expect(page.getByTestId("context-editor-landmarke-setzen-berggipfel")).toBeVisible();
    await settleFrame(page);
    await page.screenshot({ path: "test-results/l4-menue-1920.png" });
    await page.getByTestId("context-editor-landmarke-setzen-quelle").click();
    const leiste = page.getByTestId("landmarke-setzen-leiste");
    await expect(leiste).toContainText("Quelle");
    expect(server.angelegt).toHaveLength(0);
    await settleFrame(page);
    await page.screenshot({ path: "test-results/l4-setzen-1920.png" });
    await page.getByTestId("landmarke-setzen-leiste-fertig").click();
    await expect.poll(() => server.angelegt.length).toBe(1);
    expect(server.angelegt[0]!.subtype).toBe("quelle");
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]')).toContainText(
        "Landmarke-001",
    );
});

test("🔴 OPS-000111: in der Ansicht Standard setzt „▲ Landmarke setzen › Wasserfall“ eine Landmarke, danach öffnet ihr Fenster", async ({
    page,
}) => {
    // Betreiber 2026-11-11 („Ja, überall“): Standard zeichnet Landmarken, also steht der Eintrag dort auch.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const server = await stub(page);
    await openMap(page, `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=6&view=standard`);
    const rahmen = await page.evaluate(
        () => globalThis.avesmapsMap!.getCanvas().getBoundingClientRect().toJSON() as DOMRect,
    );
    await page.mouse.click(rahmen.left + rahmen.width / 2 - 120, rahmen.top + rahmen.height / 2 + 80, {
        button: "right",
    });
    await page.getByTestId("context-editor-hier-hinzufuegen").click();
    await page.getByTestId("context-editor-landmarke-setzen").hover();
    await page.getByTestId("context-editor-landmarke-setzen-wasserfall").click();
    await expect(page.getByTestId("landmarke-setzen-leiste")).toContainText("Wasserfall");
    await page.getByTestId("landmarke-setzen-leiste-fertig").click();
    await expect.poll(() => server.angelegt.length).toBe(1);
    expect(server.angelegt[0]!.subtype).toBe("wasserfall");
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]')).toContainText(
        "Landmarke-001",
    );
});

test("🔴 L5: jede Landmarkenart hat ihr Zeichen auf der Karte, der Berggipfel das Dreieck, die Höhenzahl nur bei Berg und Vulkan", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stub(page);
    // Zoom 6: dort steht die Schrift auf 15 px, der echten Größe des Entwurfs.
    await openMap(
        page,
        `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=6&view=landscapes&layer=topographie`,
    );
    // Eine Probe ohne Datenbank: jede Art als Punkt einer eigenen Quelle, gezeichnet mit DERSELBEN Ebene wie die Gipfel (`buildPeakLayer`).
    const gezeichnet = await page.evaluate(
        async ({ KOSCH_X, KOSCH_Y, arten }) => {
            const pfad = "/src/map/topography-layers.ts";
            const modul = (await import(/* @vite-ignore */ pfad)) as {
                buildPeakLayer(font: string, mode: string, locale: string): Record<string, unknown>;
            };
            const map = globalThis.avesmapsMap as unknown as {
                addSource(id: string, quelle: unknown): void;
                addLayer(ebene: unknown): void;
                getLayoutProperty(ebene: string, wert: string): unknown;
                hasImage(id: string): boolean;
                once(ereignis: string, f: () => void): void;
                triggerRepaint(): void;
                queryRenderedFeatures(o: { layers: string[] }): { properties: Record<string, unknown> }[];
            };
            const font = ((map.getLayoutProperty("gipfel", "text-font") as string[] | undefined) ?? [
                "Noto Sans Regular",
            ])[0]!;
            const punkte = arten.map((art, i) => {
                const lage = globalThis.avesmapsRenderProjection!.toRenderLngLat({
                    x: KOSCH_X - 7 + (i % 5) * 3.5,
                    y: KOSCH_Y - 2.5 + Math.floor(i / 5) * 2.5,
                });
                return {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [lage.lng, lage.lat] },
                    properties: {
                        name: art,
                        subtype: art,
                        ...(art === "berggipfel" || art === "vulkan" ? { height: 3200 } : {}),
                    },
                };
            });
            map.addSource("l5-probe", { type: "geojson", data: { type: "FeatureCollection", features: punkte } });
            const ebene = modul.buildPeakLayer(font, "heights", "de");
            map.addLayer({ ...ebene, id: "l5-probe", source: "l5-probe", "source-layer": undefined });
            await new Promise<void>((fertig) => {
                map.once("idle", () => fertig());
                map.triggerRepaint();
            });
            return {
                bilder: arten.filter((art) => art !== "berggipfel").every((art) => map.hasImage(`landmarke-${art}`)),
                arten: map.queryRenderedFeatures({ layers: ["l5-probe"] }).map((f) => String(f.properties["subtype"])),
            };
        },
        { KOSCH_X: KOSCH.x, KOSCH_Y: KOSCH.y, arten: [...ARTEN] },
    );
    expect(gezeichnet.bilder).toBe(true);
    expect(new Set(gezeichnet.arten).size).toBeGreaterThanOrEqual(12);
    await settleFrame(page);
    await page.screenshot({ path: "test-results/l5-zeichen-1920.png" });
    // Der Ausschnitt um die Probe, damit die Formen zu erkennen sind.
    const mitte = await page.evaluate(
        (p) => {
            const map = globalThis.avesmapsMap!;
            const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
            const rahmen = map.getCanvas().getBoundingClientRect();
            return { x: rahmen.left + at.x, y: rahmen.top + at.y };
        },
        { x: KOSCH.x, y: KOSCH.y },
    );
    await page.screenshot({
        path: "test-results/l5-zeichen-ausschnitt.png",
        clip: { x: mitte.x - 330, y: mitte.y - 150, width: 660, height: 300 },
    });
});
