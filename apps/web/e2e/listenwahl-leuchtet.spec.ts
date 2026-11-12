import { expect, test, type Page } from "@playwright/test";
import { chooseView, EDITOR_MODE, openMap, settleFrame, showLandscapes, showPlace } from "./map-handle.ts";
import {
    editorPanelVorn,
    GRATENFELS,
    GRATENFELS_LAGE,
    oeffneOrtseditor,
    zeile as ortZeile,
} from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Ein Klick in der Liste eines Editors lässt das Objekt auf der Karte aufleuchten, wie ein Klick auf das Objekt selbst (WI-0218
 * Nachbesserung, `editor-panel/listenwahl.ts`; Betreiber 2026-10-18 auf der Stage: „klick auf kraftlinie in der liste lässt sie nicht
 * leuchten (dasselbe problem wie bei vorher bei landschaften). bei wegen geht es auch noch nicht. bei orten und herrschaftsgebieten ist es
 * da.“). Ein Fall je Editor, gemessen an der Leuchtschicht, die auch der Klick auf der Karte nimmt.
 *
 * Die Listen kommen aus Stubs, mit Zeilen der Objekte, die die Karte gerade zeichnet: Nur ein echtes Objekt kann leuchten. Kein Fall
 * schreibt in die Datenbank der Entwicklung.
 *
 * 🔴 Der Stub steht erst, NACHDEM der Test das Objekt gelesen hat, das die Karte zeichnet - nicht schon vor dem Laden, mit dem Lesen im
 * Handler. Seit die Kacheln der Karteninhalte ihre Zahlen aus denselben Listen holen (WI-0212, `karteninhalte-zahlen.ts`), fragt das
 * offene Editorpanel diese Adressen schon beim Laden, im Leerlauf des Browsers - vor der Karte. Ein Handler, der dann die Karte las
 * (`globalThis.avesmapsMap` noch leer), warf, und alle Fälle der Datei waren rot (Release-Test d80313c07). Und selbst nach der Karte hing
 * der Inhalt der Liste davon ab, welche der Fragen zuletzt beantwortet wurde. Der Stub antwortet jetzt jeder Frage gleich.
 */

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Gareth: Kraftlinien, Wege und Gebiete liegen dort dicht. */
const GARETH = { x: 551.625, y: 532.969 };

/** Die Eigenschaften der gezeichneten Objekte in den Ebenen mit diesem Anfang; wartet, bis welche da sind. */
async function gezeichnet(page: Page, anfang: string): Promise<Record<string, unknown>[]> {
    for (let versuch = 0; versuch < 20; versuch += 1) {
        const gefunden = await page.evaluate((praefix) => {
            const map = globalThis.avesmapsMap!;
            const ebenen = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => id.startsWith(praefix));
            return ebenen.length === 0
                ? []
                : map.queryRenderedFeatures({ layers: ebenen }).map((feature) => ({ ...feature.properties }));
        }, anfang);
        if (gefunden.length > 0) return gefunden;
        await page.waitForTimeout(500);
    }
    return [];
}

/** Ein Name, wie ihn ein Leser in der Liste sieht: kein Griff („Pfad-3443“), nicht leer. */
const benannt = (name: unknown): name is string =>
    typeof name === "string" && name.trim() !== "" && !/-\d+$/.test(name);

/** Wie viele Objekte eine Ebene gerade zeichnet. */
const gezeichneteZahl = (page: Page, ebene: string): Promise<number> =>
    page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        return map.getLayer(id) ? map.queryRenderedFeatures({ layers: [id] }).length : 0;
    }, ebene);

/**
 * Karte im Editor-Modus mit dieser Kachel vorn, die Kamera über `ort`; das Fenster öffnet das Verb. `vorDemVerb` läuft, wenn die Kachel
 * die Ansicht gestellt hat und die Karte ihre Objekte zeichnet: Dort liest der Test, was gezeichnet ist, und stellt den Stub der Liste.
 */
async function oeffneEditor(
    page: Page,
    kachel: string,
    werkzeug: string,
    ort: { x: number; y: number },
    vorDemVerb: () => Promise<void>,
): Promise<void> {
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await showPlace(page, ort, 7);
    await page.getByTestId(`editorpanel-kachel-${kachel}`).click();
    await vorDemVerb();
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator(`dialog[data-lage][open][data-testid^="${werkzeug}-"]`)).toHaveCount(1);
}

const liste = (page: Page, werkzeug: string) =>
    page.locator(`[data-testid^="${werkzeug}-"][data-testid$="-liste"]`).getByRole("option");

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
});

test("🔴 Ort: ein Klick in der Ortsliste lässt den Ort aufleuchten", async ({ page }) => {
    await oeffneOrtseditor(page);
    await showPlace(page, GRATENFELS_LAGE, 7);
    await ortZeile(page, "Gratenfels").click();
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()))
        .toMatchObject({
            kind: "place",
            id: GRATENFELS,
        });
    await settleFrame(page);
    await expect.poll(() => gezeichneteZahl(page, "place-selection"), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("🔴 Landschaft: ein Klick in der Liste lässt die Fläche gelb leuchten", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await showPlace(page, GARETH, 7);
    await showLandscapes(page, "vegetation");
    const flaeche = (await gezeichnet(page, "landscape-fill-")).find(
        (p) => benannt(p["name"]) && p["region_public_id"],
    );
    expect(flaeche, "eine gezeichnete Fläche").toBeDefined();
    const id = String(flaeche!["region_public_id"]);
    await page.route("**/api/editor/landscapes", (route) =>
        route.fulfill(
            json({
                rows: [
                    {
                        id,
                        name: flaeche!["name"],
                        layer: "vegetation",
                        type: flaeche!["region_type"] ?? "",
                        circle: "voll",
                        order: 1,
                    },
                ],
            }),
        ),
    );
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await liste(page, "landschaftseditor").first().click();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.id)).toBe(id);
    await settleFrame(page);
    await expect.poll(() => gezeichneteZahl(page, "area-selection-fill"), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("🔴 Herrschaftsgebiet: ein Klick in der Liste wählt und zeigt das Gebiet", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await chooseView(page, "political");
    await showPlace(page, GARETH, 6);
    const gebiet = (await gezeichnet(page, "territory-fill")).find(
        (p) => benannt(p["name"]) && p["territory_public_id"],
    );
    expect(gebiet, "ein gezeichnetes Gebiet").toBeDefined();
    const id = String(gebiet!["territory_public_id"]);
    await page.route("**/api/editor/territories", (route) =>
        route.fulfill(
            json({
                yearBf: 1049,
                rows: [
                    {
                        id,
                        name: gebiet!["name"],
                        type: gebiet!["territory_type"] ?? "",
                        circle: "halb",
                        minZoom: 0,
                        maxZoom: 8,
                        color: "#c0392b",
                        order: 0,
                    },
                ],
            }),
        ),
    );
    await page.getByTestId("editorpanel-kachel-territorien").click();
    await page.getByTestId("editorpanel-verb").click();
    await liste(page, "gebietseditor").first().click();
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsAreaSelection?.()))
        .toMatchObject({ kind: "territory", id });
});

test("🔴 Weg: ein Klick in der Liste lässt den Weg gelb leuchten", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    let name = "";
    await oeffneEditor(page, "wege", "wegeditor", GARETH, async () => {
        const weg = (await gezeichnet(page, "path-hit-")).find(
            (p) => benannt(p["name"]) && p["subtype"] && p["public_id"],
        );
        expect(weg, "ein gezeichneter Weg").toBeDefined();
        name = String(weg!["name"]);
        await page.route("**/api/editor/paths", (route) =>
            route.fulfill(
                json({
                    rows: [
                        {
                            id: String(weg!["public_id"]),
                            name,
                            subtype: String(weg!["subtype"]),
                            isBach: false,
                            circle: "halb-rechts",
                            segments: 1,
                        },
                    ],
                }),
            ),
        );
    });
    await liste(page, "wegeditor").first().click();
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsAreaSelection?.()))
        .toMatchObject({ kind: "path", name });
    await settleFrame(page);
    await expect.poll(() => gezeichneteZahl(page, "area-selection-path"), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("🔴 Kraftlinie: ein Klick in der Liste lässt die Linie leuchten", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 6);
    const linie = (await gezeichnet(page, "powerline-hit")).find((p) => benannt(p["name"]) && p["public_id"]);
    expect(linie, "eine gezeichnete Kraftlinie").toBeDefined();
    const name = String(linie!["name"]).trim();
    await page.route("**/api/editor/powerlines", (route) =>
        route.fulfill(
            json({
                rows: [
                    {
                        id: String(linie!["public_id"]),
                        name,
                        circle: "voll",
                        shape: "strang",
                        segments: 1,
                        nodes: 2,
                    },
                ],
            }),
        ),
    );
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await liste(page, "kraftlinieneditor").first().click();
    await expect
        .poll(
            () =>
                page.evaluate(
                    () =>
                        (
                            globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { highlighted: number } } }
                        ).avesmapsPowerlineArcs?.state().highlighted ?? 0,
                ),
            { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
});
