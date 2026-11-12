import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Platz der Leiste einer Bearbeitung (EDIT-0003 T45 (3); Festlegung der Editor-Orchestrierung 2026-10-19 nach der Bedienprobe auf der
 * Stage, wörtlich: „Das Fenster sprang beim Wechsel der Breite um, und ‚Fertig‘ wanderte zwischen unten und oben. Zweimal traf mein Klick
 * daneben.“). Gewählt wird einmal, wenn die Leiste erscheint; Liste ein und aus verschiebt sie nicht, das Browserfenster nur mit Abstand
 * zur Grenze. 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Liste, Detail und Sperre kommen aus einem Stub.
 */
const BECKEN = "a6a6a6a6-0000-4000-8000-000000000001";
const DETAIL: EditorLandscapeDetail = {
    id: BECKEN,
    name: "Probebecken",
    layer: "topographie",
    type: "tal",
    circle: "halb-rechts",
    order: 10,
    clickLocked: false,
    areas: [
        {
            id: "a6a6a6a6-0000-4000-8000-0000000000a1",
            polygons: [
                [
                    [
                        [440, 502],
                        [466, 502],
                        [466, 538],
                        [440, 538],
                    ],
                ],
            ],
            affectsPaths: true,
            revision: 1,
        },
    ],
    labels: [],
    neighbors: [],
    revision: 1,
};

async function oeffne(page: Page): Promise<void> {
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
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
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, {
            rows: [
                {
                    id: BECKEN,
                    name: DETAIL.name,
                    layer: "topographie",
                    type: "tal",
                    circle: "halb-rechts",
                    areas: 1,
                    order: 10,
                    bounds: [440, 502, 466, 538],
                },
            ],
        }),
    );
    await page.route(`**/api/editor/landscapes/${BECKEN}`, (route) => json(route, 200, DETAIL));
    await page.route(`**/api/editor/landscapes/${BECKEN}/history**`, (route) => json(route, 200, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a6a6a6a6-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-19T12:00:00.000Z",
                heartbeatAt: "2026-10-19T12:00:00.000Z",
                own: true,
            },
        });
    });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Probebecken/ })
        .click();
}

/** Wo „Fertig“ steht, und ob die Leiste im angedockten Fenster sitzt. */
async function fertig(page: Page): Promise<{ x: number; y: number; imFenster: boolean }> {
    const knopf = page.getByTestId("landschaft-leiste-fertig");
    const box = (await knopf.boundingBox())!;
    const imFenster = await knopf.evaluate((el) => el.closest('[data-lage="angedockt"]') !== null);
    return { x: Math.round(box.x), y: Math.round(box.y), imFenster };
}

test.use({ viewport: { width: 1280, height: 720 } });

test("🔴 Fall 1: bei 1280 px steht „Fertig“ am selben Ort, während die Liste ein- und ausfährt", async ({ page }) => {
    await oeffne(page);
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/)
        .locator("input")
        .fill("Probekessel");
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    const vorher = await fertig(page);
    const schalter = page.getByTestId(/^landschaftseditor-fenster-\d+-listenschalter$/);
    for (let mal = 0; mal < 2; mal++) {
        await schalter.click();
        // Die Kante des Fensters wandert 220 ms; danach misst die Seite den Rand neu.
        await page.waitForTimeout(400);
        expect(await fertig(page)).toEqual(vorher);
    }
});

test("🔴 Fall 2: das Browserfenster pendelt, während es breiter wird → die Leiste wechselt genau einmal aufs Kartenblatt", async ({
    page,
}) => {
    /*
     * 🪤 Jeder Größenwechsel zeichnet die Karte neu; ohne Grafikkarte (SwiftShader) und neben einem zweiten Worker kostet ein Schritt
     * gut eine Sekunde (Trace 2026-10-19: 50 Wechsel in 57 s, dann Zeitüberschreitung bei richtigem Ergebnis). Deshalb 26 Wechsel und Luft.
     */
    test.setTimeout(90_000);
    await oeffne(page);
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/)
        .locator("input")
        .fill("Probekessel");
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    // Die Liste einziehen: Das Fenster wird schmal. Platz auf der Karte heißt Platz für die ganze Leiste in einer Zeile samt Laschen;
    // bei 720 px Höhe liegt die Grenze damit irgendwo zwischen 1500 und 1900 px Breite.
    await page.getByTestId(/^landschaftseditor-fenster-\d+-listenschalter$/).click();
    await page.waitForTimeout(400);
    const plaetze = [(await fertig(page)).imFenster];
    // Je Schritt 80 px breiter und 40 zurück: Ohne Abstand zur Grenze kippte die Leiste beim Zurückpendeln wieder ins Fenster. Die 40
    // zurück liegen innerhalb des Abstands (`LEISTE_ABSTAND`, 80).
    for (let breite = 1480; breite <= 1960; breite += 40) {
        for (const b of [breite + 40, breite]) {
            await page.setViewportSize({ width: b, height: 720 });
            await page.waitForTimeout(150);
            plaetze.push((await fertig(page)).imFenster);
        }
    }
    const wechsel = plaetze.slice(1).filter((platz, i) => platz !== plaetze[i]).length;
    expect(plaetze[0], "bei 1280 px steht sie im Fenster").toBe(true);
    expect(wechsel, JSON.stringify(plaetze)).toBe(1);
    expect(plaetze.at(-1), "breit genug: über der Karte").toBe(false);
});

test("🔴 1600 px mit offener Liste: Die Lücke reicht nicht für die Leiste → „Fertig“ steht im Fenster und ist frei", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await oeffne(page);
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/)
        .locator("input")
        .fill("Probekessel");
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    expect((await fertig(page)).imFenster).toBe(true);
    // Kein anderes Element liegt über „Fertig“ (früher die Lasche „Info“).
    await page.getByTestId("landschaft-leiste-fertig").click({ trial: true });
});
