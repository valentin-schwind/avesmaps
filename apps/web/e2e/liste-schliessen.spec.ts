import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { EditorPowerlineDetail, EditorPowerlineList } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn, fenster as ortFenster, oeffneOrtseditor } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * ✕ an der Liste der Werkzeugfenster (WI-0241; Betreiber 2026-10-20: „kannst du hier ein X hinmachen, dass das ding zumacht“). Das ✕
 * steht rechts im Kopf der Listenspalte (gemeinsame `fenster-spalte.vue`) und geht denselben Weg wie „«“ an den Eigenschaften: Die
 * Liste zieht ein, die Eigenschaften bleiben stehen, „»“ holt sie zurück. Dass alle fünf Editoren es tragen, hält
 * `apps/web/test/liste-schliessen.test.ts`; hier zwei von ihnen im Browser, Orte und Kraftlinien. Das Telefon: `*.touch.spec.ts`.
 *
 * Problemfälle: Das ✕ fehlt oder steht nicht rechts im Kopf der Liste; es schließt das ganze Fenster statt der Liste; es baut einen
 * zweiten Zustand, sodass „»“ die Liste nicht zurückholt; die Eigenschaften wandern dabei.
 */

const PUNIN = "b1b1b1b1-0000-4000-8000-000000000241";
const LISTE: EditorPowerlineList = {
    rows: [
        {
            id: PUNIN,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 1,
            nodes: 2,
            ends: ["Gareth", "Punin"],
            bounds: [551, 533, 640, 610],
        },
    ],
};
const DETAIL: EditorPowerlineDetail = {
    id: PUNIN,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [{ id: PUNIN, from: "c1", to: "c2", curve: null, labelVisible: true, revision: 3 }],
    nodes: [],
    bounds: [551, 533, 640, 610],
};

async function oeffneKraftlinien(page: Page): Promise<Locator> {
    const json = (route: Route, body: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/powerlines", (route) => json(route, LISTE));
    await page.route("**/api/editor/powerline-wiki", (route) => json(route, { articles: [] }));
    await page.route(`**/api/editor/powerlines/${PUNIN}`, (route) => json(route, DETAIL));
    await page.route(`**/api/editor/powerlines/${PUNIN}/history**`, (route) => json(route, { entries: [] }));
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    const fenster = page.locator('dialog[data-lage][open][data-testid^="kraftlinieneditor-"]');
    await expect(fenster).toHaveCount(1);
    return fenster;
}

/** Schließt die Liste mit ✕ und holt sie mit „»“ zurück; die Eigenschaften stehen dabei still. */
async function schliesseUndHoleZurueck(fenster: Locator): Promise<void> {
    const spalte = fenster.locator('[id$="-listenspalte"]');
    const kopf = spalte.locator(".fenster-spalte__kopf");
    const kreuz = fenster.locator('[data-testid$="-liste-schliessen"]');
    const schalter = fenster.locator('[data-testid$="-listenschalter"]');
    const eigenschaften = fenster.locator('[data-testid$="-eigenschaften-spalte"]');

    // Rechts im Kopf der Liste, mit dem Text, den Zettel und Vorleser sagen.
    await expect(kreuz).toBeVisible();
    await expect(kreuz).toHaveAttribute("aria-label", "Liste schließen");
    const kopfBox = (await kopf.boundingBox())!;
    const kreuzBox = (await kreuz.boundingBox())!;
    expect(kopfBox.x + kopfBox.width - (kreuzBox.x + kreuzBox.width)).toBeLessThan(16);
    await expect(schalter).toHaveAttribute("aria-expanded", "true");
    const vorher = (await eigenschaften.boundingBox())!;

    await kreuz.click();
    // Derselbe Weg wie „«“: Der Schalter steht auf zu, die Liste ist eingezogen, das Fenster bleibt offen.
    await expect(schalter).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await spalte.boundingBox())?.width ?? 0).toBeLessThan(2);
    await expect(fenster).toBeVisible();
    const nachher = (await eigenschaften.boundingBox())!;
    expect(Math.abs(nachher.x + nachher.width - (vorher.x + vorher.width))).toBeLessThan(1);

    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-expanded", "true");
    await expect(kreuz).toBeVisible();
}

for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test.describe(`${String(groesse.width)} × ${String(groesse.height)}`, () => {
        test.use({ viewport: groesse });

        test("🔴 Orte: ✕ rechts im Kopf der Liste klappt sie ein wie „«“, „»“ holt sie zurück", async ({ page }) => {
            await oeffneOrtseditor(page);
            await expect(ortFenster(page)).toHaveCount(1);
            await schliesseUndHoleZurueck(ortFenster(page));
            await page.screenshot({ path: `test-results/wi0241-liste-schliessen-${String(groesse.width)}.png` });
        });

        test("🔴 Kraftlinien: dasselbe ✕ aus der gemeinsamen Spalte", async ({ page }) => {
            await schliesseUndHoleZurueck(await oeffneKraftlinien(page));
        });
    });
}
