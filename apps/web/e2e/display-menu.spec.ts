import { expect, test, type Page } from "@playwright/test";
import { chooseView, EDITOR_MODE, openMap, showLandscapes } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Auge-Menü (WI-0028), 1:1 wie Legacys `#map-display-menu`, und die beiden Verweise unten im
 * Bund. Das Telefon prüft `display-menu.touch.spec.ts`.
 */

/**
 * Ein angemeldeter Editor: Ist die Anmeldung eingerichtet, kommen die Zeilen der Editoren aus der Sitzung, nicht aus `/edit` allein
 * (`viewer/bootstrap-viewer.ts`, WI-0120 A9). Ohne gestellte Sitzung wäre es die Besucheransicht (WI-0192).
 */
const EDITOR = ["view_flow_directions", "use_editor_menu", "view_editor_series"];
const alsEditor = (page: Page) => stubAdmin(page, { capabilities: EDITOR, role: "editor" });

/** Die Ebenen, die gerade im Stil stehen. */
async function styleLayers(page: Page): Promise<string[]> {
    return page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id) ?? []);
}

/** Der Filter einer Ebene als Text - daran steht, welche Ortsklassen durchgehen. */
async function filterOf(page: Page, id: string): Promise<string> {
    return page.evaluate(
        (layerId) =>
            JSON.stringify(
                (globalThis.avesmapsMap?.getStyle().layers as { id: string; filter?: unknown }[] | undefined)?.find(
                    (layer) => layer.id === layerId,
                )?.filter ?? null,
            ),
        id,
    );
}

async function openMenu(page: Page): Promise<void> {
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
}

test("🔴 das Auge öffnet ein schwebendes Menü unmittelbar über sich; ein zweiter Klick schließt", async ({ page }) => {
    await openMap(page);
    const auge = page.getByTestId("display-open");
    await expect(auge).toHaveAttribute("aria-expanded", "false");
    await openMenu(page);
    await expect(auge).toHaveAttribute("aria-expanded", "true");

    const lage = await page.evaluate(() => {
        const rechteck = (selektor: string) => document.querySelector(selektor)!.getBoundingClientRect();
        const bund = document.querySelector('[data-testid="display-open"]')!.closest(".corner")!;
        return {
            menue: rechteck('[data-testid="display-menu"]'),
            auge: rechteck('[data-testid="display-open"]'),
            bund: bund.getBoundingClientRect(),
        };
    });
    expect(lage.menue.bottom, "über dem Auge, nicht davor").toBeLessThanOrEqual(lage.auge.top);
    expect(lage.auge.top - lage.menue.bottom, "unmittelbar darüber").toBeLessThan(10);
    expect(lage.menue.right).toBeCloseTo(lage.bund.right, 0);

    await auge.click();
    await expect(page.getByTestId("display-menu")).toBeHidden();
    await expect(auge).toHaveAttribute("aria-expanded", "false");
});

test("ein Klick in die Karte schließt, Escape schließt und gibt den Fokus ans Auge zurück", async ({ page }) => {
    await openMap(page);
    await openMenu(page);
    await page.getByTestId("map").click({ position: { x: 400, y: 400 } });
    await expect(page.getByTestId("display-menu")).toBeHidden();

    await openMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("display-menu")).toBeHidden();
    await expect(page.getByTestId("display-open")).toBeFocused();
});

test("🔴 die Ortsklassen sind Legacys Kaskade: bis Dorf, dann noch einmal Dorf = keine Orte", async ({ page }) => {
    await openMap(page);
    await openMenu(page);
    await page.getByTestId("display-place-dorf").click();
    await expect(page.getByTestId("display-place-dorf")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("display-place-gebaeude")).toHaveAttribute("aria-pressed", "false");
    await expect
        .poll(() => filterOf(page, "place-marker"))
        .toContain('["literal",["metropole","grossstadt","stadt","kleinstadt","dorf"]]');

    await page.getByTestId("display-place-dorf").click();
    await expect.poll(() => styleLayers(page)).not.toContain("place-marker");
});

test("🔴 Standard startet ohne Flusslinien, „Flüsse“ schaltet sie zu; „Labels“ nimmt die freien Beschriftungen", async ({
    page,
}) => {
    await openMap(page);
    // Legacys Besucherprofil (Betreiber 2026-09-23: „standardansicht kein fluss passt"): die Kachel malt die Flüsse.
    expect(await styleLayers(page)).not.toContain("path-center-flussweg");
    expect(await styleLayers(page)).toContain("path-center-reichsstrasse");
    await openMenu(page);
    // In der Standardansicht malt die Kachel auch die Seen - der Hinweis steht an der Zeile.
    await expect(page.getByTestId("display-rivers")).toHaveAttribute("title", /Seen sind in dieser Ansicht/);
    await page.getByTestId("display-rivers").click();
    await expect.poll(() => styleLayers(page)).toContain("path-center-flussweg");

    await page.getByTestId("display-labels").click();
    await expect.poll(async () => (await styleLayers(page)).filter((id) => id.startsWith("map-label"))).toEqual([]);
    // Die Ortsnamen stehen seit WI-0135 je Klasse und Seite in eigenen Ebenen.
    expect(await styleLayers(page)).toContain("place-label-dorf-right");
});

test("🔴 die Landschaften zeigen Orte, Wege, Flüsse und Seen (Legacy, Betreiber 2026-09-23)", async ({ page }) => {
    await openMap(page);
    await showLandscapes(page);
    await expect.poll(() => styleLayers(page)).toContain("place-marker");
    const ebenen = await styleLayers(page);
    expect(ebenen).toContain("path-center-reichsstrasse");
    expect(ebenen).toContain("path-center-flussweg");
    await openMenu(page);
    await expect(page.getByTestId("display-rivers")).toContainText("Flüsse und Seen");
});

test("🔴 die Ansicht gewinnt: die Kraftlinien sperren mit Grund, ein Wechsel setzt die Schalter zurück", async ({
    page,
}) => {
    await openMap(page);
    await openMenu(page);
    await page.getByTestId("display-place-metropole").click();
    await page.getByTestId("display-open").click();

    await chooseView(page, "powerlines");
    await openMenu(page);
    for (const zeile of ["display-paths", "display-rivers"]) {
        await expect(page.getByTestId(zeile)).toHaveAttribute("title", /Kraftlinien-Ansicht/);
        await expect(page.getByTestId(zeile).locator("input")).toBeDisabled();
    }
    await expect(page.getByTestId("display-place-dorf")).toBeDisabled();
    await expect(page.getByTestId("display-borders").locator("input")).toBeDisabled();
    await page.getByTestId("display-open").click();

    await chooseView(page, "standard");
    await openMenu(page);
    // Zurück auf der Standardansicht: alle Orte wieder da, nicht nur die Metropolen von vorhin.
    await expect(page.getByTestId("display-place-gebaeude")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("display-paths").locator("input")).toBeEnabled();
});

test("die Zifferntasten wirken wie ein Klick auf die Ortsklasse: 3 zeigt bis Stadt, noch einmal 3 keine", async ({
    page,
}) => {
    await openMap(page);
    await page.keyboard.press("3");
    await expect.poll(() => filterOf(page, "place-marker")).toContain('["literal",["metropole","grossstadt","stadt"]]');
    await page.keyboard.press("3");
    await expect.poll(() => styleLayers(page)).not.toContain("place-marker");
});

test("🔴 unten rechts: „Neuigkeiten“ und „Hinweise“, „Hinweise“ öffnet das Fenster; oben links kein Hinweise-Knopf mehr", async ({
    page,
}) => {
    await openMap(page);
    // „Neuigkeiten“ ist seit WI-0139 (N5-N7, `2e51105f`) kein gesperrter Platzhalter mehr, sondern öffnet sein Fenster.
    await expect(page.getByTestId("news-open")).toBeEnabled();
    // Genau EIN Hinweise-Knopf: unten rechts (der Entwicklerkasten oben links ist weg).
    await expect(page.getByTestId("notes-open")).toHaveCount(1);
    const verweise = await page.evaluate(() => {
        const rechteck = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { hinweise: rechteck("notes-open"), neuigkeiten: rechteck("news-open"), fächer: rechteck("fan-toggle") };
    });
    expect(verweise.hinweise.top, "unter dem Fächer").toBeGreaterThanOrEqual(verweise.fächer.bottom);
    expect(verweise.neuigkeiten.right, "links neben „Hinweise“").toBeLessThanOrEqual(verweise.hinweise.left);

    await page.getByTestId("notes-open").click();
    await expect(page.getByTestId("notes")).toBeVisible();
});

test("🔴 „Strömungsrichtungen“: nur für Editoren, schaltet Pfeile und weiße Flusskontur gemeinsam", async ({
    page,
}) => {
    // Betreiber 2026-09-28: „wenn die option strömungsrichtungen aus ist soll keine kontur und keine pfeile mehr
    // zu sehen sein. strömungsrichtungen sollen für editoren sichtbar sein, nicht für front end nutzer“.
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    await showLandscapes(page);
    await openMenu(page);
    const zeile = page.getByTestId("display-flow");
    await expect(zeile).toContainText("Strömungsrichtungen");
    // Vorgabe aus: Der Fluss ist nur sein blauer Kern.
    expect(await styleLayers(page)).not.toContain("path-flow-arrow");
    expect((await styleLayers(page)).filter((id) => id.startsWith("path-outline-flussweg"))).toEqual([]);

    await zeile.click();
    await expect.poll(() => styleLayers(page)).toContain("path-flow-arrow");
    expect(await styleLayers(page)).toContain("path-outline-flussweg");

    // Ohne Flüsse keine Strömung: die Zeile ist gesperrt und nennt den Grund.
    await page.getByTestId("display-rivers").click();
    await expect(zeile).toHaveAttribute("title", /Nur mit eingeschalteten Flüssen/);
    await expect.poll(() => styleLayers(page)).not.toContain("path-flow-arrow");
});

test("🔴 ein Besucher sieht „Strömungsrichtungen“ nicht und bekommt weder Pfeile noch Flusskontur", async ({
    page,
}) => {
    await page.goto("/?besucher");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showLandscapes(page);
    await openMenu(page);
    await expect(page.getByTestId("display-rivers")).toBeVisible();
    await expect(page.getByTestId("display-flow")).toHaveCount(0);
    const ebenen = await styleLayers(page);
    expect(ebenen).not.toContain("path-flow-arrow");
    expect(ebenen.filter((id) => id.startsWith("path-outline-flussweg"))).toEqual([]);
});

test.use({
    launchOptions: { args: process.platform === "win32" ? ["--use-angle=d3d11", "--ignore-gpu-blocklist"] : [] },
});

test.describe("Landschaftsflächen unabhängig vom Terrain", () => {
    for (const layer of ["vegetation", "topographie", "topographie&topo=hoehenstufen"]) {
        test(`Ebenen aus: Flächen verschwinden, Gelände bleibt (${layer})`, async ({ page }) => {
            await page.goto(`/#x=474.731&y=520.221&z=5.36&series=original&view=landscapes&layer=${layer}&p=56.6`);
            await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true);
            const terrain = () =>
                page.evaluate(() => {
                    const style = globalThis.avesmapsMap?.getStyle() as unknown as {
                        terrain?: unknown;
                        layers: { id: string }[];
                    };
                    return {
                        terrain: (globalThis.avesmapsMap as unknown as { getTerrain(): unknown }).getTerrain(),
                        layers: style.layers.filter(({ id }) => /schatten|hoehen|contour|height-tint/.test(id)),
                    };
                });
            await expect.poll(async () => (await terrain()).terrain).toBeTruthy();
            const before = await terrain();
            expect(before.terrain).toBeTruthy();
            await openMenu(page);
            const toggle = page.getByTestId("display-layers").getByRole("checkbox");
            await expect(toggle).toBeChecked();
            await page.getByTestId("display-layers").click();
            await expect(toggle).not.toBeChecked();
            await expect
                .poll(async () =>
                    (await styleLayers(page)).filter((id) => id.startsWith("landscape-fill-") || id === "climate-fill"),
                )
                .toEqual([]);
            expect(await terrain()).toEqual(before);
            let lookups = 0;
            page.on("request", (request) => {
                if (request.url().includes("/areas/at")) lookups++;
            });
            await page.getByTestId("display-open").click();
            await page.getByTestId("map").click({ position: { x: 450, y: 350 } });
            expect(await page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.kind)).not.toBe("landscape");
            expect(lookups).toBe(0);
            await openMenu(page);
            await page.getByTestId("display-layers").click();
            await expect(toggle).toBeChecked();
            if (layer === "vegetation")
                await expect.poll(() => styleLayers(page)).toContain("landscape-fill-vegetation");
            await page.screenshot({
                path: `../../review/wi-0028/layers-${layer.includes("hoehenstufen") ? "heights" : layer}.png`,
            });
        });
    }
});

test("🔴 „Kachelraster 8 × 8“: nur für Editoren, zeichnet die Rechenkacheln des Höhenmodells (WI-0070)", async ({
    page,
}) => {
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    await openMenu(page);
    const zeile = page.getByTestId("display-tile-grid");
    await expect(zeile).toContainText("Kachelraster 8 × 8");
    expect(await styleLayers(page)).not.toContain("tile-grid-lines");
    await zeile.click();
    await expect.poll(() => styleLayers(page)).toContain("tile-grid-lines");
    await zeile.click();
    await expect.poll(() => styleLayers(page)).not.toContain("tile-grid-lines");

    await page.goto("/?besucher");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await openMenu(page);
    await expect(page.getByTestId("display-tile-grid")).toHaveCount(0);
});
