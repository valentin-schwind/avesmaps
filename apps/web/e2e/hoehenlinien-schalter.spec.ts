import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Höhenlinien ausblenden (seit 2026-10-20 im Anzeigemenü, für alle) und Höhenstufen unter ◐ in der Ebenenleiste der Editoren (WI-0236; Betreiber 2026-10-19: „Wir wollen sowohl
 * für die Topographie (Höhenlinien und Höhenstufen) die möglichkeit haben die feinen linien mit den höhenmetern auszublenden.
 * Höhenstufen unterstützen übrigens keine transparenz - im gegensatz zum normalen höhenlinienmodus.“). Linien, Stufen und Raster kommen
 * aus den Kacheln der lokalen Karte; die Liste der Landschaften aus einem Stub. 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Der Knopf fehlt in der Topographie oder steht in anderen Ebenen; aus nimmt nur Linien oder nur Zahlen, nimmt Gipfel oder
 * Stufen mit, gilt nur in einer der beiden Unterwahlen oder vergisst sich beim Neuladen; in den Höhenstufen ändert ◐ nichts oder deckt die
 * Stufen schon bei 75 % fast ganz zu; die Editoren treffen dort keine Fläche der Topographie (Fund 2026-11-10).
 *
 * 🪤 Linien und Stufen brauchen abgeleitete Anzeigehöhen (`derive:display-heights`); ohne sie überspringt der Test sichtbar.
 */

const STELLE = { x: 450, y: 560 };

let runde = 0;
async function oeffne(page: Page, topo: "hoehenlinien" | "hoehenstufen", ebene = "topographie"): Promise<void> {
    runde += 1;
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
    await page.route("**/api/editor/landscapes", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [] }) }),
    );
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    const unterwahl = topo === "hoehenstufen" ? "&topo=hoehenstufen" : "";
    await page.goto(
        `${EDITOR_MODE}?r=${String(runde)}#x=${String(STELLE.x)}&y=${String(STELLE.y)}&z=6.5&series=original&view=landscapes&layer=${ebene}${unterwahl}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

async function hoehenDa(page: Page): Promise<boolean> {
    return page.evaluate(async () => (await fetch("/tiles/terrain/display-height/current.json")).status === 200);
}

const stapel = (page: Page) =>
    page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as { getStyle(): { layers: { id: string }[] } })
            .getStyle()
            .layers.map((layer) => layer.id),
    );
const LINIEN = ["hoehenlinie-100", "hoehenlinie-500", "hoehenlinie-1000", "hoehenlinie-zahl"];
/** Das Anzeigemenü (Auge) offen; darin die Zeile „Höhenlinien“ (Betreiber 2026-10-20, vorher ◎ in der Ebenenleiste). */
async function auge(page: Page): Promise<void> {
    const menue = page.getByTestId("display-menu");
    if (!(await menue.isVisible())) await page.getByTestId("display-open").click();
    await expect(menue).toBeVisible();
}
const zeile = (page: Page) => page.getByTestId("display-hoehenlinien");
const schalter = (page: Page) => zeile(page).locator("input");

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 Teil 1: der Schalter „Höhenlinien“ im Anzeigemenü nimmt Linien und Zahlen weg, in beiden Unterwahlen, gemerkt im Browser", async ({
    page,
}) => {
    await oeffne(page, "hoehenlinien");
    test.skip(!(await hoehenDa(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    // ◎ ist aus der Ebenenleiste ausgezogen.
    await expect(page.getByTestId("ebenenleiste-hoehenlinien")).toHaveCount(0);
    await auge(page);
    await expect(zeile(page)).toContainText("Höhenlinien");
    await expect(schalter(page)).toBeChecked();
    await expect.poll(() => stapel(page)).toEqual(expect.arrayContaining(LINIEN));
    await page.screenshot({ path: "test-results/hoehenlinien-auge-an-1920.png" });

    await zeile(page).click();
    await expect(schalter(page)).not.toBeChecked();
    await expect.poll(async () => (await stapel(page)).filter((id) => id.startsWith("hoehenlinie"))).toEqual([]);
    expect(await stapel(page)).toContain("gipfel");
    await settleFrame(page);
    await page.screenshot({ path: "test-results/hoehenlinien-auge-aus-1920.png" });

    // Gemerkt im Browser, und es gilt auch in den Höhenstufen; die Stufen bleiben.
    await oeffne(page, "hoehenstufen");
    await auge(page);
    await expect(schalter(page)).not.toBeChecked();
    const stufen = await stapel(page);
    expect(stufen).toContain("hoehenstufen");
    expect(stufen.filter((id) => id.startsWith("hoehenlinie"))).toEqual([]);

    await zeile(page).click();
    await expect(schalter(page)).toBeChecked();
    await expect.poll(() => stapel(page)).toEqual(expect.arrayContaining(LINIEN));

    // Andere Ebenen tragen die Zeile nicht.
    await oeffne(page, "hoehenlinien", "vegetation");
    await auge(page);
    await expect(page.getByTestId("display-rivers")).toBeVisible();
    await expect(zeile(page)).toHaveCount(0);
});

test("🔴 Besucher: die Zeile „Höhenlinien“ steht nur bei der Topographie und schaltet die Linien auch für sie", async ({
    page,
}) => {
    await page.goto(
        `/?r=b${String((runde += 1))}#x=${String(STELLE.x)}&y=${String(STELLE.y)}&z=6.5&series=original&view=landscapes&layer=topographie`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    test.skip(!(await hoehenDa(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    await auge(page);
    await expect(schalter(page)).toBeChecked();
    await zeile(page).click();
    await expect.poll(async () => (await stapel(page)).filter((id) => id.startsWith("hoehenlinie"))).toEqual([]);
    await zeile(page).click();
    await expect.poll(() => stapel(page)).toEqual(expect.arrayContaining(LINIEN));
    // In der Standardansicht keine Zeile.
    await page.goto(
        `/?r=b${String((runde += 1))}#x=${String(STELLE.x)}&y=${String(STELLE.y)}&z=6.5&series=original&view=standard`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await auge(page);
    await expect(zeile(page)).toHaveCount(0);
});

test("🔴 Teil 2: in den Höhenstufen liegt der Untergrund über den Stufen und folgt ◐ unter der Lasur; 0 % nimmt ihn weg", async ({
    page,
}) => {
    await oeffne(page, "hoehenstufen");
    test.skip(!(await hoehenDa(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    const deckkraft = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap;
            if (map?.getLayer("basemap") === undefined) return null;
            return map.getPaintProperty("basemap", "raster-opacity") as number;
        });
    await page.getByTestId("ebenenleiste-untergrund-knopf").click();
    const bahn = page.getByTestId("ebenenleiste-untergrund-bahn");
    // Wie in den Höhenlinien: Die Stufen behalten die Lasur der Topographie (0,3), die Karte bekommt ◐ vom Rest (Fund 2026-11-10).
    await bahn.fill("50");
    await expect.poll(deckkraft).toBe(0.35);
    const ids = await stapel(page);
    expect(ids.indexOf("basemap")).toBe(ids.indexOf("hoehenstufen") + 1);
    await settleFrame(page);
    await page.screenshot({ path: "test-results/wi0236-hoehenstufen-untergrund-50-1920.png" });

    await bahn.fill("80");
    await expect.poll(deckkraft).toBe(0.56);
    await settleFrame(page);
    await page.screenshot({ path: "test-results/wi0236-hoehenstufen-untergrund-80-1920.png" });

    await bahn.fill("0");
    await expect.poll(deckkraft).toBeNull();
    expect(await stapel(page)).toContain("hoehenstufen");
    await settleFrame(page);
    await page.screenshot({ path: "test-results/wi0236-hoehenstufen-untergrund-0-1920.png" });

    // In den Höhenlinien bleibt der Untergrund über dem Papier.
    await bahn.fill("50").catch(() => undefined);
    await oeffne(page, "hoehenlinien");
    const linien = await stapel(page);
    expect(linien.indexOf("basemap")).toBe(1);
});

test("🔴 Höhenstufen: die Editoren treffen die Flächen der Topographie wie in den Höhenlinien (Fund 2026-11-10)", async ({
    page,
}) => {
    // Vali 2026-11-10: „Wenn die bunte Höhenkarte an ist, sind manche Flächen der Topographie beim Ausschneiden nicht anklickbar.“
    const treffer = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap;
            if (map === undefined || map.getLayer("landscape-fill-topographie") === undefined) return -1;
            const mitte = map.project(map.getCenter());
            return map.queryRenderedFeatures([mitte.x, mitte.y], { layers: ["landscape-fill-topographie"] }).length;
        });
    await oeffne(page, "hoehenlinien");
    test.skip(!(await hoehenDa(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    await expect.poll(treffer).toBeGreaterThanOrEqual(0);
    test.skip((await treffer()) === 0, "an der Stelle liegt keine Fläche der Topographie");
    await oeffne(page, "hoehenstufen");
    await expect.poll(treffer).toBeGreaterThan(0);
    const deckkraft = await page.evaluate(() =>
        globalThis.avesmapsMap?.getPaintProperty("landscape-fill-topographie", "fill-opacity"),
    );
    expect(deckkraft).toBe(0);
});

test("Sichtprüfung 1280: die Ebenenleiste ohne ◎ bleibt im Fenster", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await oeffne(page, "hoehenstufen");
    test.skip(!(await hoehenDa(page)), "keine Anzeigehöhen abgeleitet (derive:display-heights)");
    await expect(page.getByTestId("ebenenleiste-hoehenlinien")).toHaveCount(0);
    const leiste = await page.getByTestId("ebenenleiste").boundingBox();
    expect((leiste?.x ?? 0) + (leiste?.width ?? 0)).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: "test-results/wi0236-ebenenleiste-1280.png" });
});
