import { expect, test, type Page } from "@playwright/test";
import { chooseView, openMap } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Schalter des Auge-Menüs in der Adresse (WI-0072): Wer sie umlegt und die Adresse kopiert, schickt dieselbe
 * Ansicht. Das Telefon prüft `display-link.touch.spec.ts`.
 *
 * 🪤 Gemessen wird am Stil der Karte und am Menü, nicht an der Adresse allein: Ein Parameter, der in der Adresse steht
 * und nichts bewirkt, wäre die halbe Funktion.
 */

/**
 * Ein angemeldeter Editor: Ist die Anmeldung eingerichtet, kommen seine Schalter aus der Sitzung, nicht aus `/edit` allein
 * (`viewer/bootstrap-viewer.ts`, WI-0120 A9). Ohne gestellte Sitzung wäre es die Besucheransicht (WI-0192).
 */
const EDITOR = ["view_flow_directions", "use_editor_menu", "view_editor_series"];

async function openAt(page: Page, address: string): Promise<void> {
    await page.goto(address);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

const styleLayers = (page: Page): Promise<string[]> =>
    page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id) ?? []);

const placeTiers = (page: Page): Promise<string> =>
    page.evaluate(() =>
        JSON.stringify(
            (globalThis.avesmapsMap?.getStyle().layers as { id: string; filter?: unknown }[] | undefined)?.find(
                (layer) => layer.id === "place-marker",
            )?.filter ?? null,
        ),
    );

const hashParams = async (page: Page): Promise<URLSearchParams> =>
    new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1));

const checked = (page: Page, row: string) => page.getByTestId(row).locator("input");

async function openMenu(page: Page): Promise<void> {
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
}

test("🔴 Schalter umlegen: die Adresse trägt nur die Abweichungen, ohne neuen Verlaufseintrag; ein Neuladen und ein neuer Tab zeigen dasselbe", async ({
    page,
    context,
}) => {
    await openMap(page);
    // Wer nichts umlegt, hat dieselbe Adresse wie vor WI-0072.
    const start = await hashParams(page);
    expect([...start.keys()].filter((key) => /^(toggle|areas|flow|grid)/.test(key))).toEqual([]);

    const history = await page.evaluate(() => globalThis.history.length);
    await openMenu(page);
    await page.getByTestId("display-paths").click();
    await page.getByTestId("display-labels").click();
    await page.getByTestId("display-place-stadt").click();
    await expect.poll(async () => (await hashParams(page)).get("togglePaths")).toBe("0");
    const params = await hashParams(page);
    expect(params.get("toggleMapLabels")).toBe("0");
    expect(params.get("toggleStaedte")).toBe("1");
    // Genau drei Schalter weichen ab, sonst steht nichts da.
    expect([...params.keys()].filter((key) => /^(toggle|areas|flow|grid)/.test(key)).sort()).toEqual([
        "toggleMapLabels",
        "togglePaths",
        "toggleStaedte",
    ]);
    expect(await page.evaluate(() => globalThis.history.length), "kein Eintrag je Klick").toBe(history);

    // Ein neuer Tab mit der kopierten Adresse zeigt dieselbe Ansicht.
    const address = await page.evaluate(() => globalThis.location.href);
    const fresh = await context.newPage();
    await openAt(fresh, address);
    const layers = await styleLayers(fresh);
    expect(layers).not.toContain("path-center-reichsstrasse");
    expect(layers.filter((id) => id.startsWith("map-label"))).toEqual([]);
    await expect.poll(() => placeTiers(fresh)).toContain('["literal",["metropole","grossstadt","stadt"]]');
    await openMenu(fresh);
    await expect(checked(fresh, "display-paths")).not.toBeChecked();
    await expect(checked(fresh, "display-labels")).not.toBeChecked();
    await expect(checked(fresh, "display-borders")).toBeChecked();
    await expect(fresh.getByTestId("display-place-stadt")).toHaveAttribute("aria-pressed", "true");
    await expect(fresh.getByTestId("display-place-kleinstadt")).toHaveAttribute("aria-pressed", "false");

    // Wer die Schalter zurücklegt, hat wieder die kurze Adresse.
    await fresh.getByTestId("display-paths").click();
    await fresh.getByTestId("display-labels").click();
    await fresh.getByTestId("display-place-stadt").click(); // noch einmal die höchste: keine Orte
    await fresh.getByTestId("display-place-gebaeude").click(); // wieder alle
    await expect.poll(async () => (await hashParams(fresh)).get("togglePaths")).toBeNull();
    const back = await hashParams(fresh);
    expect([...back.keys()].filter((key) => /^(toggle|areas|flow|grid)/.test(key))).toEqual([]);
});

test("🔴 ein Legacy-Link mit togglePaths, Ortsklassen und Flüssen öffnet dieselbe Ansicht, und die Query räumt sich auf", async ({
    page,
}) => {
    await openAt(page, "/?togglePaths=0&toggleStaedte=1&toggleRivers=1&besucher&mapLayerMode=deregraphic");
    // Wege aus, Orte bis Stadt, Flusslinien an: Legacys Parameter in unseren Schaltern.
    await expect.poll(() => placeTiers(page)).toContain('["literal",["metropole","grossstadt","stadt"]]');
    const layers = await styleLayers(page);
    expect(layers).not.toContain("path-center-reichsstrasse");
    expect(layers).toContain("path-center-flussweg");

    // Gelesen und in den Hash gewandert: Die Query behält, was nicht dazugehört (`besucher`), und die Ansicht
    // steht unter unseren Namen. Ein Neuladen öffnet dasselbe.
    // (Der Planer schreibt die übrigen Parameter über URLSearchParams neu: `besucher` wird dabei zu `besucher=`.)
    expect(new URL(page.url()).search).toMatch(/^\?besucher=?$/);
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("standard");
    const params = await hashParams(page);
    expect(params.get("toggleStaedte")).toBe("1");
    expect(params.get("toggleRivers")).toBe("1");
    expect(params.get("togglePaths")).toBe("0");
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect.poll(() => placeTiers(page)).toContain('["literal",["metropole","grossstadt","stadt"]]');
    expect(await styleLayers(page)).not.toContain("path-center-reichsstrasse");
});

test("🔴 ein zurückgelegter Schalter gilt auch nach dem Neuladen: kein Rest in der Query", async ({ page }) => {
    await openAt(page, "/?toggleStaedte=1");
    await expect.poll(() => placeTiers(page)).toContain('["literal",["metropole","grossstadt","stadt"]]');
    expect(new URL(page.url()).search).toBe("");
    await openMenu(page);
    await page.getByTestId("display-place-gebaeude").click();
    await expect.poll(async () => (await hashParams(page)).has("toggleStaedte")).toBe(false);
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await openMenu(page);
    await expect(page.getByTestId("display-place-gebaeude")).toHaveAttribute("aria-pressed", "true");
});

test("🔴 Legacys Links ohne Hash: mapLayerMode=ecosystem öffnet die Landschaften, mapstyle=original den Untergrund", async ({
    page,
}) => {
    await openAt(page, "/?mapLayerMode=ecosystem&mapstyle=original");
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("landscapes");
    expect((await hashParams(page)).get("series")).toBe("original");
    expect(new URL(page.url()).search).toBe("");
    // Die Landschaften zeigen Flüsse und Seen (Vorgabe der Ansicht).
    await openMenu(page);
    await expect(page.getByTestId("display-rivers")).toContainText("Flüsse und Seen");
    await expect(checked(page, "display-rivers")).toBeChecked();

    // Der alte Parameter toggleBorders=1 war die politische Ansicht.
    await openAt(page, "/?toggleBorders=1");
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("political");
    expect(new URL(page.url()).search).toBe("");
});

test("🔴 Ungültiges wird überlesen: dieselbe Karte wie ohne, keine Meldung, kein Fehler", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openAt(
        page,
        "/?togglePaths=vielleicht&toggleStaedte=zehn#x=551.625&y=532.969&z=5.00&series=modern&toggleRivers=2&grid=7",
    );
    expect(await styleLayers(page)).toContain("path-center-reichsstrasse");
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await openMenu(page);
    await expect(page.getByTestId("display-place-gebaeude")).toHaveAttribute("aria-pressed", "true");
    await expect(checked(page, "display-rivers")).not.toBeChecked();
    expect(errors).toEqual([]);
});

test("🔴 Editor-Schalter (Strömung, Kachelraster) wirken nur für Editoren: ein Besucher bekommt sie still nicht", async ({
    page,
}) => {
    const hash = "#x=551.625&y=532.969&z=5.00&series=modern&view=landscapes&layer=alle&flow=1&grid=1";
    // Die Schalter der Editoren gibt es nur im Editor-Modus (Betreiber 2026-10-09), und nur mit dem Recht dazu.
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    await openAt(page, `/edit${hash}`);
    await expect.poll(() => styleLayers(page)).toContain("path-flow-arrow");
    expect(await styleLayers(page)).toContain("tile-grid-lines");
    // Und der Editor findet sie in seiner Adresse wieder, wenn er sie umlegt.
    expect((await hashParams(page)).get("flow")).toBe("1");
    expect((await hashParams(page)).get("grid")).toBe("1");

    await openAt(page, `/?besucher${hash}`);
    const layers = await styleLayers(page);
    expect(layers).not.toContain("path-flow-arrow");
    expect(layers).not.toContain("tile-grid-lines");
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await expect.poll(async () => (await hashParams(page)).has("view")).toBe(true);
    const visitor = await hashParams(page);
    expect(visitor.has("flow"), "was der Besucher nicht hat, schreibt er auch nicht").toBe(false);
    expect(visitor.has("grid")).toBe(false);
});

test("🔴 Ebenen und Topographie reisen mit: in den Landschaften „Ebenen“ aus, Höhenstufen", async ({
    page,
    context,
}) => {
    await openAt(
        page,
        "/#x=474.731&y=520.221&z=5.36&series=original&view=landscapes&layer=topographie&topo=hoehenstufen&areas=0&togglePaths=0",
    );
    await openMenu(page);
    await expect(checked(page, "display-layers")).not.toBeChecked();
    await expect(checked(page, "display-paths")).not.toBeChecked();
    expect((await styleLayers(page)).filter((id) => id.startsWith("landscape-fill-") || id === "climate-fill")).toEqual(
        [],
    );

    const address = await page.evaluate(() => globalThis.location.href);
    const fresh = await context.newPage();
    await openAt(fresh, address);
    const params = await hashParams(fresh);
    expect(params.get("areas")).toBe("0");
    expect(params.get("topo")).toBe("hoehenstufen");
    expect(params.get("togglePaths")).toBe("0");

    // „Ebenen“ gibt es nur in den Landschaften: in der Standardansicht steht der Parameter nie in der Adresse.
    await chooseView(fresh, "standard");
    await expect.poll(async () => (await hashParams(fresh)).get("view")).toBe("standard");
    const standard = await hashParams(fresh);
    expect(standard.has("areas")).toBe(false);
    expect(standard.has("togglePaths"), "die Ansicht gewinnt: der Wechsel setzt die Schalter zurück").toBe(false);
});

test("🔴 der Kurzlink trägt die Ansicht mit: Schalter, Ebene und Topographie kommen im neuen Tab an", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAt(
        page,
        "/?route=Gareth~Perricum#x=551.625&y=532.969&z=5.00&series=modern&view=landscapes&layer=topographie&topo=hoehenstufen&togglePaths=0&toggleMapLabels=0&toggleLocations=0",
    );
    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    await page.getByTestId("route-share").click();
    await expect(page.getByTestId("toast")).toContainText("Kurzlink kopiert: ");
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/\/\?s=[2-9a-km-zA-HJ-NP-Z]{8}$/);

    const fresh = await context.newPage();
    await fresh.goto(url);
    await fresh.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(fresh.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    // Danach steht die Ansicht in der Adresse, und der Kurzlink ist daraus verschwunden.
    await expect.poll(async () => (await hashParams(fresh)).get("togglePaths")).toBe("0");
    const params = await hashParams(fresh);
    expect(params.get("view")).toBe("landscapes");
    expect(params.get("layer")).toBe("topographie");
    expect(params.get("topo")).toBe("hoehenstufen");
    expect(params.get("toggleMapLabels")).toBe("0");
    expect(params.get("toggleLocations")).toBe("0");
    expect(new URL(fresh.url()).search).toBe("?route=Gareth~Perricum");
    await openMenu(fresh);
    await expect(checked(fresh, "display-paths")).not.toBeChecked();
    await expect(checked(fresh, "display-labels")).not.toBeChecked();
    await expect(fresh.getByTestId("display-place-metropole")).toHaveAttribute("aria-pressed", "false");
});
