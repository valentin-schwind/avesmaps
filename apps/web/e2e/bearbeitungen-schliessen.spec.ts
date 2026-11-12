import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorPowerlineDetail, EditorPowerlineList } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Trotzdem schließen?“ unter „Offene Bearbeitungen“ (WI-0231; Betreiber 2026-10-19 über die Editor-Orchestrierung, wörtlich: „ich habe in
 * einem fenster noch offene bearbeitungen. alle schließen und X haben keinen effekt“; Entscheidung: „pop up mit ".... trotzdem schließen?
 * ok, abbrechen"“). Die Entwürfe sind Kraftlinien; Liste, Linien und Sperre kommen aus Stubs, nichts wird geschrieben.
 *
 * Fälle: (1) ✕ an einem Entwurf → Frage → Abbrechen → die Zeile bleibt. (2) ✕ → OK → die Zeile ist weg, auch nach dem Neuladen.
 * (3) ✕ ohne Entwurf → sofort zu. (4) „Alle schließen“ mit einem Entwurf und einer sauberen Bearbeitung → die saubere geht sofort zu, die
 * Frage nennt einen Entwurf.
 */
const PUNIN = "b3b3b3b3-0000-4000-8000-000000000001";
const ARRAN = "b3b3b3b3-0000-4000-8000-000000000002";

const linie = (id: string, name: string, von: [number, number], bis: [number, number]): EditorPowerlineDetail => ({
    id,
    name,
    circle: "voll",
    shape: "strang",
    segments: [{ id, from: `${id}-a`, to: `${id}-b`, curve: null, labelVisible: true, revision: 2 }],
    nodes: [
        { id: `${id}-a`, kind: "nodix", x: von[0], y: von[1], nodix: true, meets: [] },
        { id: `${id}-b`, kind: "nodix", x: bis[0], y: bis[1], nodix: true, meets: [] },
    ],
    bounds: [von[0], von[1], bis[0], bis[1]],
});
const LINIEN: Record<string, EditorPowerlineDetail> = {
    [PUNIN]: linie(PUNIN, "Punin–Gareth", [551, 533], [640, 610]),
    [ARRAN]: linie(ARRAN, "Arraned–Ferdok", [600, 450], [660, 500]),
};
const LISTE: EditorPowerlineList = {
    rows: [
        {
            id: PUNIN,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 1,
            nodes: 2,
            bounds: [551, 533, 640, 610],
        },
        {
            id: ARRAN,
            name: "Arraned–Ferdok",
            circle: "voll",
            shape: "strang",
            segments: 1,
            nodes: 2,
            bounds: [600, 450, 660, 500],
        },
    ],
};

async function stubs(page: Page): Promise<{ sperren: string[] }> {
    const server = { sperren: [] as string[] };
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
    await page.route("**/api/editor/powerlines", (route) => json(route, 200, LISTE));
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]+(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
        const d = LINIEN[id];
        return d === undefined ? json(route, 404, { error: { code: "not_found" } }) : json(route, 200, d);
    });
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]+\/history/, (route) => json(route, 200, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        server.sperren.push(url.slice(url.indexOf("/api/editor/locks")));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-19T06:00:00.000Z",
                heartbeatAt: "2026-10-19T06:00:00.000Z",
                own: true,
            },
        });
    });
    return server;
}

test.use({ viewport: { width: 1920, height: 1080 } });

const ablage = (page: Page) => page.getByTestId("editor-panel-bearbeitungen");
const zeileZu = (page: Page) => ablage(page).getByTestId(/^bearbeitung-zu-/);
/** Der Satz der Frage; das zugeklappte Fenster bleibt eingehängt (die Hülle), darum sichtbar oder verborgen, nie gezählt. */
const frage = (page: Page) => page.getByTestId("bearbeitungen-schliessen-satz");
/** Die gezeichneten Kraftlinien-Fenster; ein abgelegtes bleibt eingehängt, ist aber kein offenes `<dialog>`. */
const sichtbar = (page: Page) => page.locator('dialog[data-lage][open][data-testid^="kraftlinieneditor-fenster-"]');
const nameFeld = (page: Page) => page.getByTestId(/^kraftlinieneditor-fenster-\d+-feld-name$/).locator("input");
const gesichert = (page: Page) =>
    page.evaluate(() =>
        Object.keys(globalThis.localStorage).some((k) => k.includes("powerline") && k.includes("b3b3b3b3")),
    );

/** Öffnet die Kraftlinien und wählt eine Linie in der Liste. */
async function waehle(page: Page, name: RegExp): Promise<void> {
    await page
        .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
        .getByRole("option", { name })
        .click();
}

async function oeffne(page: Page): Promise<{ sperren: string[] }> {
    const server = await stubs(page);
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await waehle(page, /Punin–Gareth/);
    return server;
}

/** Ein Entwurf an „Punin–Gareth“, abgelegt unter „Offene Bearbeitungen“ (mit − im Fensterkopf). */
async function entwurfAbgelegt(page: Page): Promise<{ sperren: string[] }> {
    const server = await oeffne(page);
    await nameFeld(page).fill("Punin–Gareth–Linie");
    await nameFeld(page).press("Tab");
    await expect.poll(() => gesichert(page)).toBe(true);
    await page
        .getByTestId(/^kraftlinieneditor-fenster-\d+$/)
        .getByTestId("fenster-ablegen")
        .click();
    await expect(ablage(page)).toContainText("Punin–Gareth");
    await expect(ablage(page)).toContainText("ungespeichert");
    return server;
}

test("🔴 (1) (2) ✕ an einem Entwurf fragt: Abbrechen lässt die Zeile, OK verwirft sie samt Sicherung und Sperre", async ({
    page,
}) => {
    const server = await entwurfAbgelegt(page);
    // (1) Abbrechen: die Zeile bleibt, mit ihrem Entwurf.
    await zeileZu(page).click();
    await expect(frage(page)).toContainText("„Kraftlinien bearbeiten · Punin–Gareth“ hat ungespeicherte Änderungen");
    await expect(frage(page)).toContainText("Trotzdem schließen?");
    await page.getByTestId("bearbeitungen-schliessen-abbrechen").click();
    await expect(frage(page)).toBeHidden();
    await expect(ablage(page)).toContainText("ungespeichert");
    expect(await gesichert(page)).toBe(true);
    // (2) OK: die Zeile ist weg, die Sperre frei, und nach dem Neuladen kommt der Entwurf nicht zurück.
    await zeileZu(page).click();
    await page.getByTestId("bearbeitungen-schliessen-ok").click();
    await expect(frage(page)).toBeHidden();
    await expect(zeileZu(page)).toHaveCount(0);
    await expect.poll(() => server.sperren.at(-1)).toBe("/api/editor/locks/release");
    await expect.poll(() => gesichert(page)).toBe(false);
    await page.reload();
    await editorPanelVorn(page);
    await expect(ablage(page)).not.toContainText("Punin–Gareth");
});

test("🔴 (3) ✕ ohne Entwurf schließt sofort, ohne Frage", async ({ page }) => {
    await oeffne(page);
    await page
        .getByTestId(/^kraftlinieneditor-fenster-\d+$/)
        .getByTestId("fenster-ablegen")
        .click();
    await expect(ablage(page)).toContainText("Punin–Gareth");
    await zeileZu(page).click();
    await expect(zeileZu(page)).toHaveCount(0);
    await expect(frage(page)).toBeHidden();
});

test("🔴 (4) „Alle schließen“: die saubere Bearbeitung geht sofort zu, EINE Frage nennt den Entwurf", async ({
    page,
}) => {
    await oeffne(page);
    await nameFeld(page).fill("Punin–Gareth–Linie");
    await nameFeld(page).press("Tab");
    // Die zweite Linie öffnet an der Stelle des Fensters, der Entwurf wandert nach „Offene Bearbeitungen“ (D19).
    await waehle(page, /Arraned–Ferdok/);
    await expect(ablage(page)).toContainText("Punin–Gareth");
    await expect(sichtbar(page)).toHaveCount(1);
    // 🪤 Das angedockte Fenster steht über dem Editorpanel: Wer „Alle schließen“ erreichen will, legt es ab. Es ist sauber.
    await sichtbar(page).getByTestId("fenster-ablegen").click();
    await expect(sichtbar(page)).toHaveCount(0);
    await expect(zeileZu(page)).toHaveCount(2);
    await page.getByTestId("bearbeitungen-alle-zu").click();
    await expect(frage(page)).toContainText("1 Bearbeitung hat ungespeicherte Änderungen. Trotzdem alle schließen?");
    // Die saubere ist schon zu, bevor jemand antwortet.
    await expect(ablage(page)).not.toContainText("Arraned–Ferdok");
    await page.getByTestId("bearbeitungen-schliessen-abbrechen").click();
    await expect(zeileZu(page)).toHaveCount(1);
    await expect(ablage(page)).toContainText("Punin–Gareth");
    await expect(ablage(page)).toContainText("ungespeichert");
    await page.getByTestId("bearbeitungen-alle-zu").click();
    await page.getByTestId("bearbeitungen-schliessen-ok").click();
    await expect(zeileZu(page)).toHaveCount(0);
});
