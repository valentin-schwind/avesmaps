import { expect, test, type Page } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, settleFrame } from "./map-handle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Am Telefon wählt ein Tipp auf eine Fläche im Editor wie im Frontend, ohne Menü; liegen mehrere dort, kommt die Liste „Hier liegen N
 * Flächen“, und ein Tipp auf eine Zeile wählt sie, ohne Untermenü (WI-0178, Betreiber 2026-10-21, wörtlich: „kannst du zum abschluss noch
 * verhindern, dass beim linksklick diese menüs kommen und nur eine normale auswahl wie im frontend passiert.“, „Das Hier liegen 3 Flächen
 * soll aber bleiben und bei der auswahl die fläche halt auswählen“, „aber keine untermenüs mehr haben“). Gegenstück am Rechner:
 * `landschaftseditor-kartenmenue.spec.ts`.
 */
/** Eine Stelle mit Flächen in allen drei Ebenen: Vorgebirge des Kosch / Nablaquell-Wälder (wie `area-view-scope.spec.ts`). */
const LAND = { x: 450, y: 560 };
const DETAIL: EditorLandscapeDetail = {
    id: "a4a4a4a4-0000-4000-8000-000000000001",
    name: "Probe",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [],
    labels: [],
    neighbors: [],
    revision: 1,
};
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function oeffne(page: Page, ebene = "alle"): Promise<void> {
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
    await editorPanelGemerktZu(page);
    await page.route("**/api/editor/landscapes", (route) => route.fulfill(json({ rows: [] })));
    await page.route("**/api/editor/landscapes/*", (route) => route.fulfill(json(DETAIL)));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? route.fulfill(json({ locks: [] })) : route.fulfill(json({ lost: [] })),
    );
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.goto(
        `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=${ebene}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

/** Eine freie Stelle der Karte nahe der Mitte, an der genau eine Landschaft liegt. */
const stelleMitEiner = (page: Page) => stelleMitZwei(page, 1);

/** Eine freie Stelle der Karte nahe der Mitte, an der mindestens zwei Landschaften liegen (oder genau eine). */
async function stelleMitZwei(page: Page, genau?: 1): Promise<{ x: number; y: number }> {
    const gefunden = await page.evaluate((einzeln) => {
        const map = globalThis.avesmapsMap!;
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        const frei = (x: number, y: number): boolean =>
            document.elementFromPoint(rahmen.left + x, rahmen.top + y) === leinwand;
        for (let r = 0; r < 240; r += 8) {
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                if (!frei(x, y)) continue;
                const regionen = new Set(
                    map
                        .queryRenderedFeatures([x, y], { layers: ids })
                        .map((f) => String(f.properties["region_public_id"])),
                );
                if (einzeln ? regionen.size === 1 : regionen.size >= 2) return { x, y };
            }
        }
        return undefined;
    }, genau === 1);
    expect(
        gefunden,
        genau === 1 ? "eine Stelle mit einer Landschaft" : "eine Stelle mit zwei Landschaften",
    ).toBeDefined();
    return onPage(page, gefunden!);
}

/** Ganz im Bild, bis auf Rundung. */
/** Was die Karte gewählt hat: die Art des Subjects. */
const gewaehlt = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => (globalThis.avesmapsSelectedSubject?.() as { kind?: string } | undefined)?.kind);

test("🔴 Telefon: der Tipp auf EINE Fläche wählt sie, ohne Menü", async ({ page }) => {
    await oeffne(page, "vegetation");
    const at = await stelleMitEiner(page);
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => gewaehlt(page)).toBe("area");
    await expect(page.getByTestId("context-editor")).toHaveCount(0);
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
});

test("🔴 Telefon: bei mehreren Flächen die Liste ohne Untermenü; der erste Tipp auf eine Zeile wählt sie", async ({
    page,
}) => {
    await oeffne(page);
    const at = await stelleMitZwei(page);
    await page.touchscreen.tap(at.x, at.y);
    const auswahl = page.getByTestId("area-choices");
    await expect(auswahl).toBeVisible();
    // Rechts eine Art bei jeder Fläche (Regionen „Region“), und die gewählte Fläche gelb wie auf der Karte (Betreiber 2026-10-20).
    for (const art of await auswahl.locator(".area-choices__type").allTextContents()) expect(art.trim()).not.toBe("");
    await expect(auswahl.locator(".area-choices__item.is-markiert")).toHaveCount(1);
    await expect(auswahl.getByRole("menu")).toHaveCount(0);
    await auswahl.getByTestId("area-choice").first().tap();
    await expect(auswahl).toHaveCount(0);
    expect(await gewaehlt(page)).toBe("area");
    await expect(page.getByTestId("context-editor")).toHaveCount(0);
});
