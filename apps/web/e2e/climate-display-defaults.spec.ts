import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, openMap, showLandscapes } from "./map-handle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Vorgabe der Klimazonen am echten Stack (Betreiber 2026-10-05, wörtlich: „standardeinstellung, wenn man auf
 * klimazonen klickt (sofern nicht anders vom nutzer eingestellt): nur metropolen, wege an, ebenen an, labels an, grenzen
 * aus, flüsse und seen an, strömungsrichtung aus (editoren an), kachelraster aus“). Drei Wege in die Klimazonen: der
 * Fächer, ein Link mit `layer=klima` und der Link einer Klimazone im Infopanel. Die Regeln selbst prüft
 * `test/display-choices.test.ts`, das Telefon `climate-display-defaults.touch.spec.ts`.
 */

const GARETH_ID = "80558060-4299-54aa-b520-814b10819885";
const KLIMA_HASH = "#x=551.625&y=532.969&z=3.00&series=modern&view=landscapes&layer=klima";
/** Im Editor-Modus: Die Vorgabe der Editoren gibt es nur dort (Betreiber 2026-10-09). */
const KLIMA_LINK = `${EDITOR_MODE}${KLIMA_HASH}`;
/**
 * Ein angemeldeter Editor: Ist die Anmeldung eingerichtet, kommen die Zeilen der Editoren aus der Sitzung, nicht aus `/edit` allein
 * (`viewer/bootstrap-viewer.ts`, WI-0120 A9). Ohne gestellte Sitzung wäre es die Besucheransicht (WI-0192).
 */
const EDITOR = ["view_flow_directions", "use_editor_menu", "view_editor_series"];
const alsEditor = (page: Page) => stubAdmin(page, { capabilities: EDITOR, role: "editor" });

interface MenuState {
    places: string[];
    paths: boolean | null;
    layers: boolean | null;
    labels: boolean | null;
    borders: boolean | null;
    rivers: boolean | null;
    flow: boolean | null;
    tileGrid: boolean | null;
}

/** Die Vorgabe der Klimazonen, wie ein Editor sie im Menü sieht. */
const KLIMA_EDITOR: MenuState = {
    places: ["metropole"],
    paths: true,
    layers: true,
    labels: true,
    borders: false,
    rivers: true,
    flow: true,
    tileGrid: false,
};

async function openAt(page: Page, address: string): Promise<void> {
    await page.goto(address);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

/** Das Menü, wie ein Mensch es sieht: öffnen, lesen, wieder schließen. Eine Zeile, die es nicht gibt, ist `null`. */
async function menuState(page: Page): Promise<MenuState> {
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    const state = await page.evaluate(() => {
        const on = (id: string): boolean | null =>
            document.querySelector<HTMLInputElement>(`[data-testid="${id}"] input`)?.checked ?? null;
        const places = [...document.querySelectorAll('[data-testid^="display-place-"]')]
            .filter((button) => button.getAttribute("aria-pressed") === "true")
            .map((button) => (button.getAttribute("data-testid") ?? "").replace("display-place-", ""));
        return {
            places,
            paths: on("display-paths"),
            layers: on("display-layers"),
            labels: on("display-labels"),
            borders: on("display-borders"),
            rivers: on("display-rivers"),
            flow: on("display-flow"),
            tileGrid: on("display-tile-grid"),
        };
    });
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeHidden();
    return state;
}

/** Ein Schalter im Menü, wie ein Mensch ihn umlegt. */
async function flip(page: Page, row: string): Promise<void> {
    await page.getByTestId("display-open").click();
    await page.getByTestId(row).click();
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeHidden();
}

const styleLayers = (page: Page): Promise<string[]> =>
    page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id) ?? []);

/** Welche Ortsklassen der Stil zeichnet (der Filter der Ortsmarken). */
const placeFilter = (page: Page): Promise<string> =>
    page.evaluate(() =>
        JSON.stringify(
            (globalThis.avesmapsMap?.getStyle().layers as { id: string; filter?: unknown }[] | undefined)?.find(
                (layer) => layer.id === "place-marker",
            )?.filter ?? null,
        ),
    );

const displayParamsInHash = async (page: Page): Promise<string[]> =>
    [...new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1)).keys()].filter((key) =>
        /^(toggle|areas|flow|grid)/.test(key),
    );

test("🔴 über den Fächer: die Vorgabe der Klimazonen, zurück auf „Alle“ der Stand vor dem Betreten", async ({
    page,
}) => {
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    await showLandscapes(page, "alle");
    const vorher = await menuState(page);
    expect(vorher).toMatchObject({ places: ["metropole", "grossstadt"], flow: false });

    await showLandscapes(page, "klima");
    expect(await menuState(page)).toEqual(KLIMA_EDITOR);
    // Was das Menü sagt, zeichnet die Karte: nur Metropolen, Strömungspfeile für den Editor, keine Grenzen, kein Raster.
    await expect.poll(() => placeFilter(page)).toContain('["literal",["metropole"]]');
    const layers = await styleLayers(page);
    expect(layers).toContain("path-flow-arrow");
    expect(layers).toContain("path-center-reichsstrasse");
    expect(layers).toContain("climate-fill");
    expect(layers).not.toContain("tile-grid-lines");
    expect(
        layers.some((id) => id.startsWith("territory-border")),
        "keine Grenzen",
    ).toBe(false);
    // Die Vorgabe steht nicht in der Adresse.
    await expect
        .poll(async () => new URLSearchParams(await page.evaluate(() => location.hash)).get("layer"))
        .toBe("klima");
    expect(await displayParamsInHash(page)).toEqual([]);

    await showLandscapes(page, "alle");
    expect(await menuState(page)).toEqual(vorher);
    await expect.poll(() => styleLayers(page)).not.toContain("path-flow-arrow");
});

test("🔴 was der Nutzer umlegt, bleibt: vorher in „Alle“ und in den Klimazonen selbst", async ({ page }) => {
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    await showLandscapes(page, "alle");
    await flip(page, "display-paths");

    await showLandscapes(page, "klima");
    expect(await menuState(page)).toEqual({ ...KLIMA_EDITOR, paths: false });
    await flip(page, "display-place-stadt");
    await flip(page, "display-flow");
    expect(await menuState(page)).toMatchObject({
        places: ["metropole", "grossstadt", "stadt"],
        paths: false,
        flow: false,
    });
    expect((await displayParamsInHash(page)).sort()).toEqual(["flow", "togglePaths", "toggleStaedte"]);

    await showLandscapes(page, "vegetation");
    expect(await menuState(page)).toMatchObject({
        places: ["metropole", "grossstadt", "stadt"],
        paths: false,
        flow: false,
    });
});

test("🔴 ein Link mit layer=klima öffnet die Vorgabe; Schalter im Link gewinnen", async ({ page, context }) => {
    await alsEditor(page);
    await openAt(page, KLIMA_LINK);
    expect(await menuState(page)).toEqual(KLIMA_EDITOR);
    await expect.poll(() => placeFilter(page)).toContain('["literal",["metropole"]]');

    // Ein neuer Tab: Ein anderer Hash auf derselben Seite lädt sie nicht neu.
    const linked = await context.newPage();
    await alsEditor(linked);
    await openAt(linked, `${KLIMA_LINK}&toggleGrossstaedte=1&togglePaths=0&toggleTerritoryBorders=1`);
    expect(await menuState(linked)).toEqual({
        ...KLIMA_EDITOR,
        places: ["metropole", "grossstadt"],
        paths: false,
        borders: true,
    });
});

test("🔴 ein Besucher: dieselbe Vorgabe ohne Strömung und ohne die Zeilen der Editoren", async ({ page }) => {
    await openAt(page, `/${KLIMA_HASH}`);
    expect(await menuState(page)).toEqual({ ...KLIMA_EDITOR, flow: null, tileGrid: null });
    expect(await styleLayers(page)).not.toContain("path-flow-arrow");
});

test("🔴 der Link einer Klimazone im Infopanel schaltet in die Klimazonen, mit ihrer Vorgabe", async ({ page }) => {
    await alsEditor(page);
    // Das Infopanel muss vorn stehen: Für einen Editor steht beim Laden das Editorpanel im Slot (`dd9f7476`).
    await editorPanelGemerktZu(page);
    await openMap(page, EDITOR_MODE);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), { kind: "place", id: GARETH_ID });
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    await page
        .getByTestId("info-fact")
        .filter({ has: page.getByTestId("info-fact-label").getByText("Klimazone", { exact: true }) })
        .getByTestId("info-link")
        .click();
    await expect(page.getByTestId("info-title")).toHaveText("Gemäßigte Zone", { timeout: 20_000 });
    await expect
        .poll(async () => new URLSearchParams(await page.evaluate(() => location.hash)).get("layer"))
        .toBe("klima");
    expect(await menuState(page)).toEqual(KLIMA_EDITOR);
});
