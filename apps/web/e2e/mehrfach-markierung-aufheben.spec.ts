import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { EditorPowerlineDetail, EditorTerritoryDetail, EditorTerritoryList } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Mehrfachauswahl aufheben, für alle Editoren an EINER Stelle (WI-0252; Betreiber 2026-10-24, wörtlich: „ESC soll in allen fällen
 * mehrfachauswahlen wieder aufheben, auch ein klick ins leere oder woanders muss eine mehrfachauswahl aufheben.“). Hier Kraftlinien und
 * Gebiete, die Wege in `wegeditor-mehrfach.spec.ts`. Listen und Objekte kommen aus Stubs. 🔴 Kein Test schreibt in die Datenbank.
 *
 * Problemfälle: Esc lässt die Haken stehen (Fokus auf der Karte) oder schließt das ganze Fenster (Fokus im Fenster); ein Klick in die
 * Karte lässt sie stehen; ein Klick ins Fenster hebt sie auf.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Eine Stelle der Karte zwischen Planer und angedocktem Fenster (bei 1920 px rund 460 bis 860). */
async function karte(page: Page): Promise<{ x: number; y: number }> {
    return page.evaluate(() => {
        const rahmen = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        return { x: 660, y: rahmen.top + rahmen.height - 160 };
    });
}

/** Zwei Zeilen anhaken: Umschalter an, das beim Einschalten Gewählte lösen, dann je ein Klick. */
async function hakeZwei(schalter: Locator, erste: Locator, zweite: Locator, haken: Locator): Promise<void> {
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await schalter.click();
    const loesen = haken.getByRole("button", { name: /Haken lösen/ });
    if (await loesen.isVisible()) await loesen.click();
    await erste.click();
    await zweite.click();
    await expect(haken).toContainText("2 angehakt");
}

/** Die drei Fälle der Regel an einer Liste. */
async function regel(
    page: Page,
    teile: { schalter: Locator; erste: Locator; zweite: Locator; haken: Locator; fenster: Locator; kopf: Locator },
): Promise<void> {
    const { schalter, erste, zweite, haken, fenster, kopf } = teile;
    // Esc mit dem Fokus im Fenster (nach dem Haken): Die Auswahl geht, das Fenster bleibt; der nächste Druck schlösse es.
    await hakeZwei(schalter, erste, zweite, haken);
    await page.keyboard.press("Escape");
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await expect(fenster).toBeVisible();
    // Esc mit dem Fokus auf der Seite (die Kaskade der Karte).
    await hakeZwei(schalter, erste, zweite, haken);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    // Ein Klick ins Fenster (sein Kopf) lässt sie stehen, ein Klick in die Karte hebt sie auf.
    await hakeZwei(schalter, erste, zweite, haken);
    await kopf.click();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    const stelle = await karte(page);
    await page.mouse.click(stelle.x, stelle.y);
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
}

test("🔴 Kraftlinien: Esc und ein Klick in die Karte heben die Mehrfachauswahl auf, ein Klick ins Fenster nicht", async ({
    page,
}) => {
    const A = "b9b9b9b9-0000-4000-8000-0000000000a1";
    const B = "b9b9b9b9-0000-4000-8000-0000000000b2";
    const linie = (id: string, name: string): EditorPowerlineDetail => ({
        id,
        name,
        circle: "voll",
        shape: "strang",
        segments: [{ id, from: A, to: B, curve: null, labelVisible: true, revision: 1 }],
        nodes: [],
        bounds: [551, 533, 640, 610],
    });
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await page.route("**/api/editor/powerlines", (route) =>
        json(route, {
            rows: [
                { id: A, name: "Erste Linie", circle: "voll", shape: "strang", segments: 1, nodes: 2 },
                { id: B, name: "Zweite Linie", circle: "voll", shape: "strang", segments: 1, nodes: 2 },
            ],
        }),
    );
    await page.route(`**/api/editor/powerlines/${A}`, (route) => json(route, linie(A, "Erste Linie")));
    await page.route(`**/api/editor/powerlines/${B}`, (route) => json(route, linie(B, "Zweite Linie")));
    await page.route("**/api/editor/powerlines/*/history**", (route) => json(route, { entries: [] }));
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await settleFrame(page);
    const fenster = page.locator('dialog[open][data-testid^="kraftlinieneditor-"]');
    const liste = fenster.locator('[data-testid$="-liste"]').first();
    await regel(page, {
        schalter: fenster.locator('[data-testid$="-linien-mehrfach"]').first(),
        erste: liste.getByRole("option", { name: /Erste Linie/ }),
        zweite: liste.getByRole("option", { name: /Zweite Linie/ }),
        haken: fenster.locator('[data-testid$="-linien-haken"]').first(),
        fenster,
        kopf: fenster.locator("header").first(),
    });
});

test("🔴 Gebiete: Esc und ein Klick in die Karte heben die Mehrfachauswahl auf, ein Klick ins Fenster nicht", async ({
    page,
}) => {
    const ID = (n: number): string => `a3a3a3a3-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
    const LISTE: EditorTerritoryList = {
        yearBf: 1049,
        rows: [
            { id: ID(1), name: "Erstes Reich", circle: "voll", minZoom: 0, maxZoom: 8, color: "#c0392b", order: 0 },
            { id: ID(2), name: "Zweites Reich", circle: "voll", minZoom: 0, maxZoom: 8, color: "#7a8c3c", order: 1 },
        ],
    };
    // Die Mehrfachauswahl der Gebiete gibt es nur zum Bearbeiten (`app.vue`, `verbModus` „bearbeiten“).
    await stubAdmin(page, {
        capabilities: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await page.route("**/api/editor/territories", (route) => json(route, LISTE));
    await page.route("**/api/editor/territories/sammel/stand", (route) => json(route, { territories: [] }));
    // Bleibt eins angehakt, öffnet das Fenster es: ein schlankes Gebiet ohne Fläche (ein 404 ließe das Fenster zugehen).
    await page.route(/\/api\/editor\/territories\/[0-9a-f-]{36}$/, (route) => {
        const id = route.request().url().split("/").at(-1)!;
        // Ein Klick in die Karte trifft dort ein echtes Gebiet; auch das bekommt ein schlankes Detail.
        const zeile = LISTE.rows.find((row) => row.id === id) ?? { ...LISTE.rows[0]!, id, name: "Gebiet der Karte" };
        const detail: EditorTerritoryDetail = {
            id,
            name: zeile.name,
            color: zeile.color,
            opacity: 0.7,
            minZoom: 0,
            maxZoom: 8,
            order: zeile.order,
            parents: [],
            children: [],
            details: {},
            areas: [],
            claimedBy: [],
            claims: [],
        };
        return json(route, detail);
    });
    await page.route(/\/api\/editor\/territories\/[0-9a-f-]{36}\/hierarchy$/, (route) =>
        json(route, { yearBf: 1049, derivedMaxBand: 8, territories: [] }),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-territorien").click();
    await page.getByTestId("editorpanel-verb").click();
    await settleFrame(page);
    const fenster = page.locator('dialog[open][data-testid^="gebietseditor-"]');
    const liste = fenster.locator('[data-testid$="-liste"]').first();
    await regel(page, {
        schalter: fenster.locator('[data-testid$="-gebiete-mehrfach"]').first(),
        erste: liste.getByRole("option", { name: /Erstes Reich/ }),
        zweite: liste.getByRole("option", { name: /Zweites Reich/ }),
        haken: fenster.locator('[data-testid$="-gebiete-haken"]').first(),
        fenster,
        kopf: fenster.locator("header").first(),
    });
});
