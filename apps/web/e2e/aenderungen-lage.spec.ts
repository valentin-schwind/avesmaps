import { expect, test, type Page } from "@playwright/test";
import { GEBIET_KASTEN, KARTE_KANTE, RECHTE, op, pruefeKeinKartenrand, stubs } from "./aenderungen-lage-stub.ts";
import { settleFrame } from "./map-handle.ts";
import { GRATENFELS_LAGE, oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * „⊕ Auf der Karte zeigen“ für jede Änderung (WI-0265 B9; Vali 2026-11-01: „kannst du bei den änderungensitems immer (wenn möglich) 'Auf Karte anzeigen' machen, sodass die Ansicht hinfliegt,
 * wo die Änderung war? sonst muss man ewig suchen“). Der Server antwortet hier gestellt; dass die Route ihn so antwortet, belegt `apps/server/test/editor-changes-lage.test.ts`.
 *
 * Geprüft wird, was nur ein Browser zeigt: Die Kamera FLIEGT zum Ort, auch wenn die Karte weit weg steht, der Ort liegt danach in der freien Fläche neben dem Panel (nicht darunter),
 * die Überlagerung „Heutiger Ort“ steht, und ein zweiter Druck nimmt sie wieder weg. Dazu (B9b/B9c): Ein Lauf über ganz Aventurien lässt keinen Kartenrand ins Bild und fährt nicht weiter heran als nötig.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

async function oeffneAenderungen(page: Page): Promise<void> {
    await oeffneOrtseditor(page, { rechte: RECHTE, verb: false });
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    await expect(page.getByTestId("editorpanel-aenderung").first()).toBeVisible();
}

/** Stellt die Karte weit weg vom Ziel (kein Flug: Der Test baut die Ausgangslage). */
async function weitWeg(page: Page): Promise<void> {
    await page.evaluate(() => {
        const karte = globalThis.avesmapsMap!;
        const weg = globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 80, y: 920 });
        karte.jumpTo({ center: weg, zoom: 3 });
    });
    await settleFrame(page);
}

const mitte = (page: Page) =>
    page.evaluate(() => {
        const c = globalThis.avesmapsMap!.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: globalThis.avesmapsMap!.getZoom() };
    });

/** Wartet, bis die Kamera von `von` aus geflogen und angekommen ist. */
async function warteAufFlug(page: Page, von: { lng: number }): Promise<void> {
    await page.waitForFunction(
        (lng) => globalThis.avesmapsMap?.isMoving() === false && globalThis.avesmapsMap.getCenter().lng !== lng,
        von.lng,
        { timeout: 15_000 },
    );
    await settleFrame(page);
}

/** Liegt der Punkt (Karte `aventuria-v1`) im Bild und LINKS vom Editorpanel, also in der freien Fläche? */
const imFreien = (page: Page, punkte: { x: number; y: number }[]) =>
    page.evaluate((ps) => {
        const karte = globalThis.avesmapsMap!;
        const rahmen = karte.getCanvas().getBoundingClientRect();
        const panel = document.querySelector('[data-testid="editor-panel"]')!.getBoundingClientRect();
        return ps.map((p) => {
            const bild = karte.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
            const x = rahmen.left + bild.x;
            const y = rahmen.top + bild.y;
            return {
                x,
                y,
                imBild: x > rahmen.left && x < rahmen.right && y > rahmen.top && y < rahmen.bottom,
                linksVomPanel: x < panel.left,
            };
        });
    }, punkte);

test("🔴 ⊕ in der Zeile eines Gebiets (ohne Lage im Protokoll) fliegt von weit weg zum Gebiet und legt dessen heutigen Ort auf die Karte", async ({
    page,
}) => {
    const lagen = await stubs(page);
    await oeffneAenderungen(page);
    await weitWeg(page);
    const vorher = await mitte(page);

    const zeile = page.getByTestId("editorpanel-aenderung").nth(1);
    await zeile.getByTestId("editorpanel-aenderung-karte-griff").click();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toBeVisible();
    await expect(page.getByTestId("aenderungen-karte-heute")).toHaveText("Heutiger Ort");
    // Der Schalter Beide | Vorher | Nachher gehört zu Vorher und Nachher; hier gibt es nichts zu schalten.
    await expect(page.getByTestId("aenderungen-karte-anzeige")).toHaveCount(0);
    expect(lagen).toEqual([expect.stringContaining(`/api/editor/changes/${op(2)}/lage`)]);

    await warteAufFlug(page, vorher);
    const nachher = await mitte(page);
    expect(nachher.lng).not.toBeCloseTo(vorher.lng, 4);
    // Der Kasten liegt ganz im Bild und in der freien Fläche neben dem Panel (nicht darunter), die Kamera hat ihn eingepasst (näher als vorher).
    const ecken = await imFreien(page, [
        { x: GEBIET_KASTEN[0], y: GEBIET_KASTEN[1] },
        { x: GEBIET_KASTEN[2], y: GEBIET_KASTEN[3] },
    ]);
    for (const ecke of ecken) {
        expect(ecke.imBild).toBe(true);
        expect(ecke.linksVomPanel).toBe(true);
    }
    expect(nachher.zoom).toBeGreaterThan(vorher.zoom);

    // Ein zweiter Druck nimmt die Überlagerung wieder weg; Esc ebenso.
    await zeile.getByTestId("editorpanel-aenderung-karte-griff").click();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toHaveCount(0);
    await zeile.getByTestId("editorpanel-aenderung-karte-griff").click();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("aenderungen-karte-leiste")).toHaveCount(0);
});

test("🔴 ⊕ im Detail einer Feldänderung an einem Ort fliegt zum Ort, auch nachdem die Karte weit weg steht, so nah wie an einen Ort", async ({
    page,
}) => {
    const lagen = await stubs(page);
    await oeffneAenderungen(page);
    await weitWeg(page);
    const vorher = await mitte(page);

    // Ein Ort mit genau einer Änderung behält sein ⊕ in der Zeile (es wählt den Ort); ⚙ ist im Detail aufgegangen (Im Objektverlauf zeigen). Das Detail trägt zusätzlich „Auf der Karte zeigen“.
    const zeile = page.getByTestId("editorpanel-aenderung").first();
    await expect(zeile.getByTestId("editorpanel-aenderung-zeige")).toHaveCount(1);
    await zeile.getByTestId("editorpanel-aenderung-zeile").click();
    // Im Detail ist ⊕ ein Zeichen (WI-0265 B10): Sein Name steht im Tooltip, und es ist gedrückt, solange die Überlagerung steht.
    const knopf = zeile.getByTestId("editorpanel-aenderung-karte");
    await expect(knopf).toHaveText("⊕");
    await expect(knopf).toHaveAttribute("aria-label", "Auf der Karte zeigen");
    await knopf.click();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toBeVisible();
    await expect(knopf).toHaveAttribute("aria-label", "Von der Karte nehmen");
    await expect(knopf).toHaveAttribute("aria-pressed", "true");
    expect(lagen).toEqual([expect.stringContaining(`/api/editor/changes/${op(1)}/lage`)]);

    await warteAufFlug(page, vorher);
    const nachher = await mitte(page);
    // Auf einen Punkt fährt die Kamera so nah heran wie an einen Ort (mindestens Band 6), nicht nur ein Stück.
    expect(nachher.zoom).toBeGreaterThanOrEqual(vorher.zoom + 2);
    const [ort] = await imFreien(page, [GRATENFELS_LAGE]);
    expect(ort!.imBild).toBe(true);
    expect(ort!.linksVomPanel).toBe(true);
    // Der Punkt liegt in der freien Fläche, nicht am Rand: Die Kamera zielt in ihre Mitte.
    const panelLinks = await page.getByTestId("editor-panel").evaluate((el) => el.getBoundingClientRect().left);
    expect(ort!.x).toBeGreaterThan(panelLinks / 4);
    // ⊕ ist keine Rücknahme: Es wurde nichts geschrieben (kein anderer Aufruf als Lesen).
});

test("(c) keine Lage bekannt: der Knopf sagt es kurz, die Karte bleibt, wie sie ist; (stillgelegt) der Satz „nicht mehr auf der Karte“ steht auf der Leiste", async ({
    page,
}) => {
    await stubs(page);
    await oeffneAenderungen(page);
    await weitWeg(page);
    const vorher = await mitte(page);

    const ohneLage = page.getByTestId("editorpanel-aenderung").nth(3);
    await ohneLage.getByTestId("editorpanel-aenderung-karte-griff").click();
    await expect(ohneLage.getByRole("status")).toHaveText("Keine Lage bekannt");
    await expect(page.getByTestId("aenderungen-karte-leiste")).toHaveCount(0);
    expect(await mitte(page)).toEqual(vorher);
    // Nach ein paar Sekunden steht wieder, was immer dasteht.
    await expect(ohneLage.getByRole("status")).toHaveCount(0, { timeout: 10_000 });

    const stillgelegt = page.getByTestId("editorpanel-aenderung").nth(2);
    await stillgelegt.getByTestId("editorpanel-aenderung-karte-griff").click();
    await expect(page.getByTestId("aenderungen-karte-hinweis")).toHaveText(
        "Nicht mehr auf der Karte: Gezeigt wird die letzte Lage.",
    );
});

for (const [n, name] of [
    [5, "ein Lauf über 608 Sprachartikel (ein Kasten fast um ganz Aventurien)"],
    [6, "ein Kasten, der über die Karte hinausreicht"],
] as const) {
    test(`🔴 (WI-0265 B9c) ⊕ auf ${name} lässt keinen Kartenrand ins Bild: größter Ausschnitt innerhalb der Kartengrenzen, zentriert auf den Kasten`, async ({
        page,
    }) => {
        const lagen = await stubs(page);
        await oeffneAenderungen(page);
        await settleFrame(page);
        await weitWeg(page);
        const vorher = await mitte(page);

        await page
            .getByTestId("editorpanel-aenderung")
            .nth(n - 1)
            .getByTestId("editorpanel-aenderung-karte-griff")
            .click();
        await expect(page.getByTestId("aenderungen-karte-heute")).toHaveText("Heutiger Ort");
        expect(lagen).toEqual([expect.stringContaining(`/api/editor/changes/${op(n)}/lage`)]);

        await warteAufFlug(page, vorher);
        // Kein Kartenrand im Bild: Die freie Fläche (neben Routenplaner und Editorpanel) liegt ganz im Kartenbild.
        const { kartenBreite, leinwandBreite } = await pruefeKeinKartenrand(page);
        // Der größte Ausschnitt innerhalb der Kartengrenzen: Das Kartenbild füllt die Leinwand und ist nicht größer als nötig (die Karte ist quadratisch, die Leinwand breiter als hoch).
        expect(kartenBreite).toBeGreaterThanOrEqual(leinwandBreite - 2);
        expect(kartenBreite).toBeLessThanOrEqual(leinwandBreite + 2);
        // Zentriert auf den Kasten, soweit das innerhalb der Grenzen geht: Die Mitte der Karte (und des Kastens) ist in der freien Fläche zu sehen.
        const [mitteDesKastens] = await imFreien(page, [{ x: KARTE_KANTE / 2, y: KARTE_KANTE / 2 }]);
        expect(mitteDesKastens!.imBild).toBe(true);
        expect(mitteDesKastens!.linksVomPanel).toBe(true);
    });
}

/**
 * (WI-0265 B9d) Die LEINWAND zeigt nie Fläche außerhalb des Kartenbilds, auch nicht unter dem halbhohen Routenplaner (350 × 610 Bildpunkte): Production 2026-11-01, ⊕ auf einen Lauf über 608 Felder, links unter dem
 * Planer und oben leerer Hintergrund. Der Zaun ließ den Kartenrand hinter jedes Seitenpanel zurückweichen, auch hinter eines, das nur einen Teil der Höhe deckt. Gemessen bei 1280 und 1440 px (dort zählen Planer und
 * Editorpanel als Ränder: vor B9d 31 bzw. 110 Bildpunkte leer) und bei 2560 px (beide sind Seitenleisten).
 */
for (const breite of [1280, 1440, 2560]) {
    test(`🔴 (WI-0265 B9d) bei ${String(breite)} px zeigt die Leinwand nach ⊕ auf einen Lauf über ganz Aventurien keinen Kartenrand, auch nicht unter dem halbhohen Routenplaner`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: 1215 });
        await stubs(page);
        await oeffneAenderungen(page);
        await settleFrame(page);
        const vorher = await mitte(page);
        await page.getByTestId("editorpanel-aenderung").nth(4).getByTestId("editorpanel-aenderung-karte-griff").click();
        await expect(page.getByTestId("aenderungen-karte-leiste")).toBeVisible();
        await warteAufFlug(page, vorher);
        await pruefeKeinKartenrand(page);
        // Auch ein Bild später, wenn die Karte sich gesetzt hat: Die Leinwand bleibt gefüllt.
        await settleFrame(page);
        await pruefeKeinKartenrand(page);
    });
}
