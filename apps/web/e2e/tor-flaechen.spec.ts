import { expect, test, type Page } from "@playwright/test";
import {
    LandscapeCreateReceipt,
    OperationReceipt,
    PeakCreateReceipt,
    type EditorLandscapeDetail,
    type EditorPeakDetail,
    type EditorTerritoryDetail,
    type EditorTerritoryList,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { hebeSperrenAuf } from "./tor-hilfen.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn, type Beobachtung } from "./welt.ts";

/**
 * Release-Tor, Kernabläufe 16 bis 18: Flächen, Gipfel und Gebiete, gegen den ECHTEN Server des Kandidaten (WI-0264, `release-tor.json`).
 * Kein `page.route` auf `/api`: Ziele, Anlegen, Gipfel, Gebietsliste und Speichern kommen aus der Datenbank des Laufs (Testpaket, echte
 * Legacy-Gebiete). Jeder Schreibfall belegt das Ergebnis doppelt: Die Antwort des Servers ist 200 und eine frische Lesung zeigt die Folge.
 *
 * Was die Fachspecs im Detail prüfen (Ebenen im Untermenü, Regler, markierter Name), gehört nicht hierher: Das Tor soll nur fallen, wenn
 * eine Kernfunktion fehlt.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

/** Ein Stück Land im Kosch, wo wenig liegt (wie `landschaftseditor-neue-flaeche.spec.ts`). */
const LAND = { x: 450, y: 560 };
/** Ein Lauf, ein Namenszusatz: Eine Wiederholung stößt nie an den Namen des ersten Versuchs. */
const LAUF = String(Date.now());

function keinFehler(beob: Beobachtung): void {
    expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
}

/** Ein Kartenpunkt in Seitenkoordinaten, über die Projektion der Darstellung. */
async function aufSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(pt));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

test.describe("Tor: Flächen, Gipfel und Gebiete", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    // Sperren überleben das Ende eines Falls (ein geschlossener Browser gibt nichts frei): jeder Fall beginnt und endet ohne.
    test.beforeEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));
    test.afterEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));

    test("16 eine neue Fläche zeichnen", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        // Form und Gebirge stehen ab Admin (WI-0279, Paket 6).
        await meldeAn(page, "admin");
        await openMap(
            page,
            `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=standard`,
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
        await settleFrame(page);

        // Rechtsklick › Hier hinzufügen › Neue Fläche › Vegetation, dann vier Ecken und der Klick auf die erste schließen den Ring.
        const ecken = [
            { x: LAND.x, y: LAND.y },
            { x: LAND.x + 2, y: LAND.y },
            { x: LAND.x + 2, y: LAND.y + 2 },
            { x: LAND.x, y: LAND.y + 2 },
        ];
        const erste = await aufSeite(page, ecken[0]!);
        await page.mouse.click(erste.x, erste.y, { button: "right" });
        await page.getByTestId("context-editor-hier-hinzufuegen").hover();
        await page.getByTestId("context-editor-neue-flaeche").hover();
        // Die Ziele zum Einrasten kommen vom echten Server, sobald der Modus beginnt; erst danach zeichnet der Fall.
        const ziele = page.waitForResponse((r) => r.url().includes("/api/editor/landscapes/targets?"), {
            timeout: 60_000,
        });
        await page.getByTestId("context-editor-neue-flaeche-vegetation").click();
        const leiste = page.getByTestId("neue-flaeche-leiste");
        await expect(leiste).toBeVisible({ timeout: 30_000 });
        await expect(page).toHaveURL(/layer=vegetation/);
        await ziele;
        for (const ecke of ecken.slice(1)) {
            const bild = await aufSeite(page, ecke);
            await page.mouse.click(bild.x, bild.y);
        }
        const schluss = await aufSeite(page, ecken[0]!);
        const [antwort] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith("/api/editor/landscapes") && r.request().method() === "POST"),
            page.mouse.click(schluss.x, schluss.y),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const beleg = vertragGilt(LandscapeCreateReceipt, await antwort.json(), "Die Quittung des echten Servers");
        await expect(leiste).toBeHidden();

        // Das Fenster an der neuen Fläche geht auf, und eine frische Lesung des echten Servers kennt sie.
        await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-feld-name"]')).toBeVisible({
            timeout: 30_000,
        });
        const gelesen = await page.request.get(`/api/editor/landscapes/${beleg.publicId}`);
        expect(gelesen.status(), await gelesen.text()).toBe(200);
        const flaeche = (await gelesen.json()) as EditorLandscapeDetail;
        expect(flaeche.name).toBe(beleg.name);
        expect(flaeche.layer).toBe("vegetation");
        expect(flaeche.areas.length, "die Fläche hat ihren Ring").toBeGreaterThan(0);
        keinFehler(beob);
    });

    test("17 einen Gipfel setzen", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        // Form und Gebirge stehen ab Admin (WI-0279, Paket 6).
        await meldeAn(page, "admin");
        await openMap(
            page,
            `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6&series=original&view=landscapes&layer=topographie`,
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
        await settleFrame(page);
        // Eine freie Stelle in der Mitte, weg von jedem gezeichneten Gipfel, samt ihrer Lage in Karteneinheiten.
        const stelle = await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const rahmen = map.getCanvas().getBoundingClientRect();
            const gipfel = map.getLayer("gipfel")
                ? map.queryRenderedFeatures({ layers: ["gipfel"] }).map((f) => {
                      const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
                      return map.project({ lng, lat });
                  })
                : [];
            for (let y = 240; y < rahmen.height - 300; y += 20)
                for (let x = 560; x < rahmen.width - 760; x += 20) {
                    if (gipfel.some((g) => Math.hypot(g.x - x, g.y - y) < 60)) continue;
                    const karte = globalThis.avesmapsRenderProjection!.fromRenderLngLat(map.unproject([x, y]));
                    return { x: rahmen.left + x, y: rahmen.top + y, karte: [karte.x, karte.y] as [number, number] };
                }
            return undefined;
        });
        expect(stelle, "eine freie Stelle").toBeDefined();

        await page.mouse.click(stelle!.x, stelle!.y, { button: "right" });
        await page.getByTestId("context-editor-hier-hinzufuegen").click();
        // „▲ Landmarke setzen › Berggipfel“ (WI-0271 L4, Kartenmenü A): der Punkt steht, gespeichert wird erst mit „Fertig“ (G4).
        const eintrag = page.getByTestId("context-editor-landmarke-setzen");
        await expect(eintrag).toBeEnabled();
        await eintrag.hover();
        await page.getByTestId("context-editor-landmarke-setzen-berggipfel").click();
        await expect(page.getByTestId("landmarke-setzen-leiste")).toBeVisible();
        const [antwort] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith("/api/editor/peaks") && r.request().method() === "POST"),
            page.getByTestId("landmarke-setzen-leiste-fertig").click(),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const beleg = vertragGilt(PeakCreateReceipt, await antwort.json(), "Die Quittung des echten Servers");
        await expect(page.getByTestId("toast")).toContainText(`${beleg.name} gesetzt.`);
        await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]')).toContainText(
            beleg.name,
            { timeout: 30_000 },
        );

        // Eine frische Lesung des echten Servers kennt den Gipfel an der Stelle des Klicks.
        const gelesen = await page.request.get(`/api/editor/peaks/${beleg.publicId}`);
        expect(gelesen.status(), await gelesen.text()).toBe(200);
        const gipfel = (await gelesen.json()) as EditorPeakDetail;
        expect(gipfel.name).toBe(beleg.name);
        expect(gipfel.position[0]).toBeCloseTo(stelle!.karte[0], 1);
        expect(gipfel.position[1]).toBeCloseTo(stelle!.karte[1], 1);
        keinFehler(beob);
    });

    test("18 ein Gebiet: den Namen ändern und „Fertig“", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await meldeAn(page);
        // Ein echtes Gebiet mit eindeutigem Namen (kein anderer Name enthält ihn) und Fläche, aus der Liste des echten Servers.
        const liste = (await (await page.request.get("/api/editor/territories")).json()) as EditorTerritoryList;
        const gebiet = liste.rows.find(
            (zeile) =>
                zeile.deleted !== true &&
                zeile.area === true &&
                zeile.name.length >= 8 &&
                liste.rows.filter((x) => x.name.includes(zeile.name)).length === 1,
        );
        expect(gebiet, "ein Gebiet der echten Daten mit eigener Fläche und eindeutigem Namen").toBeDefined();
        const neuerName = `${gebiet!.name} (Tor ${LAUF})`;
        const vorher = (await (
            await page.request.get(`/api/editor/territories/${gebiet!.id}`)
        ).json()) as EditorTerritoryDetail;

        await openMap(page, EDITOR_MODE);
        await editorPanelVorn(page);
        await page.getByTestId("editorpanel-kachel-territorien").click();
        await page.getByTestId("editorpanel-verb").click();
        const liste_ = page.locator('[data-testid^="gebietseditor-"][data-testid$="-liste"]');
        await liste_.getByRole("searchbox").fill(gebiet!.name);
        await liste_
            .getByRole("option", { name: new RegExp(gebiet!.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
            .first()
            .click();
        const name = page
            .getByTestId(/^gebietseditor-fenster-\d+-feld-name$/)
            .filter({ visible: true })
            .locator("input");
        await expect(name).toHaveValue(gebiet!.name, { timeout: 30_000 });
        await name.fill(neuerName);
        await name.blur();
        const leiste = page.getByTestId("gebiet-leiste");
        await expect(leiste).toBeVisible();
        await expect(page.getByTestId("gebiet-leiste-ungespeichert")).toContainText("1");

        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith(`/api/editor/territories/${gebiet!.id}`) && r.request().method() === "PATCH",
            ),
            page.getByTestId("gebiet-leiste-fertig").click(),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const beleg = vertragGilt(OperationReceipt, await antwort.json(), "Die Quittung des echten Servers");
        const neu = beleg.affected.find((e) => e.kind === "territory" && e.id === gebiet!.id);
        expect(neu?.revision, "die Revision steigt").toBeGreaterThan(vorher.revision ?? 0);
        await expect(leiste).toHaveCount(0);

        // Eine frische Lesung des echten Servers hat den neuen Namen.
        const nachher = (await (
            await page.request.get(`/api/editor/territories/${gebiet!.id}`)
        ).json()) as EditorTerritoryDetail;
        expect(nachher.name).toBe(neuerName);
        keinFehler(beob);
    });
});
