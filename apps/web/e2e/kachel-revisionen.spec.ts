import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, settleFrame } from "./map-handle.ts";

/**
 * Jede Vektorkachel trägt von Anfang an eine Revision (WI-0283 H3), und die Karte fragt keine Stufe an, auf der eine Quelle leer ist (H4).
 * Ohne Revision sagt Nginx `no-cache`, und der Browser fragt jedes Mal nach: Claudio maß 70 % der Kachelanfragen ohne. Problemfälle: Eine
 * Quelle bleibt ohne Revision, weil sie an `app.vue` vorbeigeht; die Antwort des Servers fehlt, und die Karte bleibt deshalb stehen.
 */
const STAND = { schemaVersion: 1, ohneArt: 70, arten: { path: 90, place: 80, landscape: 95 } };

/** Öffnet die Karte an einer Stelle und sammelt die Adressen der Vektorkacheln, bis sie zur Ruhe kommt. */
async function kachelnBei(page: Page, zoom: number, ansicht = "standard", ebene = "alle"): Promise<string[]> {
    const adressen: string[] = [];
    page.on("request", (anfrage) => {
        const pfad = new URL(anfrage.url());
        if (pfad.pathname.startsWith("/tiles/vector/")) adressen.push(`${pfad.pathname}${pfad.search}`);
    });
    await openMap(
        page,
        `/#x=${String(GARETH.x)}&y=${String(GARETH.y)}&z=${String(zoom)}&series=original&view=${ansicht}&layer=${ebene}`,
    );
    await settleFrame(page);
    return adressen;
}

const quelle = (adresse: string): string => adresse.split("/")[3] ?? "";

test("🔴 alle Vektorkacheln tragen eine Revision; Wege und Orte die jüngste ihrer Art", async ({ page }) => {
    await page.route("**/api/map/tile-revisions", (route) => route.fulfill({ json: STAND }));
    const adressen = await kachelnBei(page, 6.5);
    expect(adressen.length).toBeGreaterThan(0);
    const ohne = adressen.filter((adresse) => !/[?&](r|rev)=[0-9A-Za-z]/.test(adresse));
    expect(ohne, "ohne Revision").toEqual([]);
    // `place` hat keinen Eintrag in `QUELLEN_NACH_ART`, betrifft also alle; `path` nur Wege und Wegnamen.
    const wege = adressen.filter((adresse) => quelle(adresse) === "path_tile");
    const orte = adressen.filter((adresse) => quelle(adresse) === "place_tile");
    expect(wege.length).toBeGreaterThan(0);
    expect(orte.length).toBeGreaterThan(0);
    for (const adresse of wege) expect(adresse).toContain("r=90");
    for (const adresse of orte) expect(adresse).toContain("r=80");
    // Eine Landschaft betrifft nur die Quellen der Derographie: Sonst hätte nach jedem „Fertig“ jede Kachel eine neue Adresse.
    const derographie = adressen.filter((adresse) =>
        [
            "region_area_tile",
            "landscape_label_run_tile",
            "map_label_render",
            "terrain_water_tile",
            "terrain_peak_render",
        ].includes(quelle(adresse)),
    );
    expect(derographie.length).toBeGreaterThan(0);
    for (const adresse of derographie) expect(adresse).toContain("r=95");
});

test("🔴 auch Höhenlinien und Höhenstufen tragen eine Revision (die Revision ihres Zeigers)", async ({ page }) => {
    await page.route("**/api/map/tile-revisions", (route) => route.fulfill({ json: STAND }));
    const adressen = await kachelnBei(page, 6.5, "landscapes", "topographie");
    expect(adressen.filter((adresse) => quelle(adresse) === "terrain_contour_tile").length).toBeGreaterThan(0);
    expect(adressen.filter((adresse) => !/[?&](r|rev)=[0-9A-Za-z]/.test(adresse))).toEqual([]);
});

test("🔴 ohne Antwort des Servers zeichnet die Karte trotzdem, wie vorher ohne Revision", async ({ page }) => {
    await page.route("**/api/map/tile-revisions", (route) => route.fulfill({ status: 500, body: "" }));
    const adressen = await kachelnBei(page, 6.5);
    const orte = adressen.filter((adresse) => quelle(adresse) === "place_tile");
    expect(orte.length).toBeGreaterThan(0);
    for (const adresse of orte) expect(adresse).not.toContain("r=");
});

test("🔴 Wegnamen erst ab Stufe 3, Landschaftsnamen ab Stufe 2; darunter fragt die Karte gar nicht", async ({
    page,
}) => {
    await page.route("**/api/map/tile-revisions", (route) => route.fulfill({ json: STAND }));
    const adressen = await kachelnBei(page, 2.5, "landscapes");
    const stufen = (name: string): number[] =>
        adressen.filter((adresse) => quelle(adresse) === name).map((adresse) => Number(adresse.split("/")[4]));
    expect(stufen("path_label_run_tile")).toEqual([]);
    expect(stufen("landscape_label_run_tile").length).toBeGreaterThan(0);
    expect(stufen("landscape_label_run_tile").every((stufe) => stufe >= 2)).toBe(true);
});
