import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorMoveTargets, EditorPlaceDetail } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, showPlace } from "./map-handle.ts";
import {
    GRATENFELS,
    GRATENFELS_LAGE,
    LISTE,
    editorPanelGemerktZu,
    fenster,
    oeffneOrtseditor,
    stubOrtSperre,
    zeile,
} from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Ort an der gemeinsamen Sperre (EDIT-0003 §4, WI-0208): „Ort verschieben“ und das Bearbeiten im Ortseditor sperren den Ort; hält
 * ein anderer ihn, kommt der Hinweis, und der Modus beginnt nicht. Ort, Ziele und Sperre kommen aus Stubs; nichts geht an die Datenbank
 * der Entwicklung. Die Rechnung dahinter prüft `apps/web/test/ort-sperre.test.ts`.
 */

const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

function ort(): EditorPlaceDetail {
    return {
        publicId: GRATENFELS,
        revision: 7,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: GRATENFELS_LAGE,
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: "Hauptstadt der Grafschaft Gratenfels." },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        pathEnds: [],
    };
}

async function stubOrt(page: Page): Promise<void> {
    const json = (route: Route, body: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) => json(route, ort()));
    await page.route(`**/api/editor/places/${GRATENFELS}/move-targets`, (route) =>
        json(route, { radius: 50, freeEnds: [] } satisfies EditorMoveTargets),
    );
}

const status = (page: Page) => fenster(page).locator('[data-testid$="-status"]');
const einwohner = (page: Page) =>
    fenster(page)
        .locator('[data-testid$="-feld-einwohner"]')
        .locator("xpath=descendant-or-self::*[self::input or self::textarea]")
        .first();

test("🔴 hält Rondrikan Gratenfels, nimmt der Ortseditor die Änderung zurück und sagt, wer ihn seit wann bearbeitet", async ({
    page,
}) => {
    await stubOrt(page);
    await oeffneOrtseditor(page, { rechte: RECHTE, sperreVon: "Rondrikan" });
    await zeile(page, "Gratenfels").click();
    await expect(status(page)).toHaveText("Keine Änderung · Revision 7");
    await einwohner(page).fill("2.500");
    await expect(status(page)).toContainText("🔒 Rondrikan bearbeitet die Eigenschaften seit");
    await expect(einwohner(page)).toHaveValue("2.200");
});

test("🔴 hält Rondrikan Gratenfels, beginnt „Ort verschieben“ nicht, und die Meldung sagt es", async ({ page }) => {
    await stubOrt(page);
    await oeffneOrtseditor(page, { rechte: RECHTE, sperreVon: "Rondrikan" });
    await zeile(page, "Gratenfels").click();
    await showPlace(page, { x: GRATENFELS_LAGE.x - 40, y: GRATENFELS_LAGE.y }, 7);
    await fenster(page).locator('[data-testid$="-verschieben"]').click();
    await expect(fenster(page).locator('[data-testid$="-verschieben-meldung"]')).toContainText(
        "🔒 Rondrikan bearbeitet die Form seit",
    );
    // Der Griff wäre ein Anfasser des Geometrie-Moduls (WI-0177 Stufe 4).
    expect(await page.evaluate(() => globalThis.avesmapsMap?.getLayer("geometrie-anfasser") !== undefined)).toBe(false);
});

test("ist Gratenfels frei, sperrt die erste Änderung ihn, und Verwerfen gibt ihn wieder frei", async ({ page }) => {
    await stubOrt(page);
    await oeffneOrtseditor(page, { rechte: RECHTE });
    const aufrufe = await stubOrtSperre(page);
    await zeile(page, "Gratenfels").click();
    await einwohner(page).fill("2.500");
    await expect(status(page)).toHaveText("Ungespeichert: Einwohner");
    await expect.poll(() => aufrufe).toEqual(["/api/editor/locks"]);
    await fenster(page).locator('[data-testid$="-zeile-einwohner-zurueck"]').click();
    await expect.poll(() => aufrufe).toEqual(["/api/editor/locks", "/api/editor/locks/release"]);
});

test("🔴 WI-0215: am fremd gesperrten Ort zeigt das Kartenmenü den Kasten, „Ort verschieben“ ist gesperrt, ein Admin hebt auf", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: [...RECHTE, "manage_people"], role: "admin" });
    await editorPanelGemerktZu(page);
    await stubOrt(page);
    await page.route("**/api/editor/places", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LISTE) }),
    );
    const aufrufe = await stubOrtSperre(page, "Rondrikan");
    await openMap(page, EDITOR_MODE);
    await showPlace(page, GRATENFELS_LAGE, 7);
    const at = await page.evaluate((lage) => {
        const map = globalThis.avesmapsMap!;
        const punkt = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(lage));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + punkt.x, y: rahmen.top + punkt.y };
    }, GRATENFELS_LAGE);

    // Das Schild steht über dem Ort, nicht auf ihm (9894b0da), solange die Sperre gilt, nicht erst beim Klick.
    await expect(page.getByTestId("sperre-schild")).toContainText("🔒 Rondrikan · Eigenschaften · seit");
    const schild = (await page.getByTestId("sperre-schild").boundingBox())!;
    expect(schild.y + schild.height).toBeLessThan(at.y);

    await page.mouse.click(at.x, at.y, { button: "right" });
    const kasten = page.getByTestId("context-editor-sperre-objekt");
    await expect(kasten).toContainText("🔒 Rondrikan bearbeitet die Eigenschaften seit");
    await expect(kasten).toContainText("ohne Aktivität frei ab");
    await expect(page.getByTestId("context-editor-ort-verschieben")).toBeDisabled();

    await page.getByTestId("context-editor-sperre-objekt-aufheben").click();
    await expect(page.getByTestId("context-editor-sperre-objekt-frage")).toContainText("Rondrikan verliert die Sperre");
    await page.getByTestId("context-editor-sperre-objekt-ja").click();
    await expect(page.getByText("Die Sperre an „Gratenfels“ ist aufgehoben.")).toBeVisible();
    expect(aufrufe).toContain("/api/editor/locks/lift");
    await expect(page.getByTestId("sperre-schild")).toHaveCount(0);
});
