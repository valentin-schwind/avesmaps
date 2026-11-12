import { expect, test, type Page } from "@playwright/test";
import type { EditorPowerlineDetail, EditorPowerlineList } from "@avesmaps3d/shared";
import { EDITOR_MODE, chooseView, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Kraftlinien-Editor, lesend (WI-0205 Paket K2; Blatt Kraftlinien; EDIT-0003 T28, F17, T32). 🔴 Kein Test schreibt in die
 * Datenbank der Entwicklung: Liste und Detail kommen aus einem Stub (den echten Leseweg prüft `editor-kraftlinien-routes.test.ts`
 * gegen die Testdatenbank).
 *
 * Problemfälle: „Kraftlinien“ bleibt „später“; das Verb öffnet einen anderen Editor; die Legende fehlt oder steht oben; der
 * Einfachklick fliegt oder lässt die Ansicht stehen; der Kasten der Nodices verliert die Folge, die Enden oder die Treffpunkte; das
 * Fenster bietet Speichern an, obwohl es nur liest.
 */
const PUNIN = "b2b2b2b2-0000-4000-8000-000000000001";
const RING = "b2b2b2b2-0000-4000-8000-000000000002";
const LISTE: EditorPowerlineList = {
    rows: [
        {
            id: PUNIN,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 3,
            nodes: 4,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Kraftlinie", title: "Kraftlinie" },
            ends: ["Gareth", "Punin"],
            bounds: [551, 533, 640, 610],
        },
        {
            id: RING,
            name: "Ring um Gareth",
            circle: "halb-rechts",
            shape: "ring",
            segments: 3,
            nodes: 3,
        },
    ],
};
const DETAIL: EditorPowerlineDetail = {
    id: PUNIN,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Kraftlinie", title: "Kraftlinie" },
    segments: [
        {
            id: "b2b2b2b2-0000-4000-8000-0000000000a1",
            from: "p:gareth",
            to: "n:1",
            curve: 12,
            labelVisible: true,
            revision: 1,
        },
        {
            id: "b2b2b2b2-0000-4000-8000-0000000000a2",
            from: "n:1",
            to: "l:tor",
            curve: null,
            labelVisible: true,
            revision: 1,
        },
        {
            id: "b2b2b2b2-0000-4000-8000-0000000000a3",
            from: "l:tor",
            to: "p:punin",
            curve: -8,
            labelVisible: false,
            revision: 1,
        },
    ],
    nodes: [
        { id: "p:gareth", kind: "place", name: "Gareth", x: 551.6, y: 533, nodix: true, meets: ["Ring um Gareth"] },
        { id: "n:1", kind: "nodix", x: 580, y: 560, nodix: true, meets: [] },
        { id: "l:tor", kind: "label", name: "Arkanes Tor", x: 610, y: 585, nodix: false, meets: [] },
        { id: "p:punin", kind: "place", name: "Punin", x: 640, y: 610, nodix: true, meets: [] },
    ],
    bounds: [551, 533, 640, 610],
};

async function oeffneKraftlinieneditor(page: Page, vorher?: (page: Page) => Promise<void>): Promise<void> {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await page.route("**/api/editor/powerlines", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LISTE) }),
    );
    await page.route(`**/api/editor/powerlines/${PUNIN}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL) }),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    // Die Kachel stellt die Karte schon auf „Kraftlinien“ (WI-0212, EDIT-0003 T37).
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    // Den Fächer erreicht ein Klick nur, solange kein angedocktes Werkzeugfenster die Karte schmaler macht.
    if (vorher) await vorher(page);
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Kraftlinien bearbeiten");
    await verb.click();
}
const liste = (page: Page) => page.locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]');
const fenster = (page: Page) => liste(page).locator("xpath=ancestor::*[contains(@class,'avm-fenster')][1]");

test("🔴 Kraftlinien → „Kraftlinien bearbeiten“ öffnet den Kraftlinien-Editor: eine Zeile je Linie, Legende unten, lesend", async ({
    page,
}) => {
    await oeffneKraftlinieneditor(page);
    await expect(liste(page)).toBeVisible();
    await expect(liste(page).getByRole("option")).toHaveCount(2);
    await expect(liste(page)).toContainText("3 Abschnitte · Gareth ↔ Punin");
    await expect(liste(page)).toContainText("platziert und dem Wiki zugewiesen");
    await expect(liste(page)).toContainText("platziert, ohne Wiki-Artikel");
    // Lesend: kein Speichern, „nur lesen“ im Kopf; weder Orts- noch Landschaftseditor sind aufgegangen.
    await expect(page.getByText("nur lesen").first()).toBeVisible();
    await expect(page.locator('[data-testid^="ortseditor-"][data-testid$="-liste"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')).toHaveCount(0);
    // „Alle speichern und schließen“ in den offenen Bearbeitungen des Editorpanels gehört nicht dazu: nur das Fenster zählt.
    await expect(fenster(page).getByRole("button", { name: /speichern|Fertig/i })).toHaveCount(0);
});

test("🔴 T54: eine gelöschte Linie steht nur unter der Facette „Gelöscht“, mit „Gelöscht“ in der Unterzeile", async ({
    page,
}) => {
    const WEG = "b2b2b2b2-0000-4000-8000-000000000003";
    // Nach dem Stub der Hilfe registriert, damit dieser gilt (die zuletzt registrierte Route gewinnt).
    await oeffneKraftlinieneditor(page, async (seite) => {
        await seite.route("**/api/editor/powerlines", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    rows: [
                        ...LISTE.rows,
                        {
                            id: WEG,
                            name: "Alte Ader",
                            circle: "voll",
                            shape: "strang",
                            segments: 1,
                            nodes: 2,
                            deleted: true,
                        },
                    ],
                } satisfies EditorPowerlineList),
            }),
        );
    });
    await expect(liste(page).getByRole("option")).toHaveCount(2);
    await expect(liste(page)).not.toContainText("Alte Ader");
    await page.locator('[data-testid$="-linien-filter"]').filter({ visible: true }).click();
    await page.locator('[data-testid$="-linien-filter-stand-geloescht"]').filter({ visible: true }).click();
    await page.keyboard.press("Escape");
    await expect(liste(page).getByRole("option")).toHaveCount(3);
    await expect(liste(page).getByRole("option", { name: /Alte Ader/ })).toContainText("Gelöscht");
});

test("🔴 F17: der Einfachklick stellt die Ansicht „Kraftlinien“ ohne Flug; der Kasten zeigt die Nodices in Folge mit Enden und Treffpunkten", async ({
    page,
}) => {
    // Die Kachel hat die Karte schon auf „Kraftlinien“ gestellt (WI-0212); erst eine andere Ansicht zeigt, dass die LISTE wechselt. Die
    // Kachel folgt der Ansicht (WI-0212, 69ebebeef): Vor dem Öffnen stünde nach „Politisch“ die Kachel Herrschaftsgebiete und das Verb hieße
    // „⚙ Herrschaftsgebiete bearbeiten“. Darum erst das Fenster öffnen, dann den Fächer umstellen; auf 1920 × 1080 erreicht ihn der Klick
    // neben dem angedockten Fenster (wie gebietseditor.spec.ts, 9589ee444).
    await page.setViewportSize({ width: 1920, height: 1080 });
    await oeffneKraftlinieneditor(page);
    await chooseView(page, "political");
    await expect(page).not.toHaveURL(/view=powerlines/);
    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await liste(page)
        .getByRole("option", { name: /Punin–Gareth/ })
        .click();
    await expect(page).toHaveURL(/view=powerlines/);
    const kasten = page.getByTestId(/^kraftlinieneditor-fenster-\d+-nodices$/);
    await expect(kasten).toContainText("Nodices (4)");
    await expect(kasten.locator("[data-knoten]")).toHaveCount(4);
    await expect(kasten.locator("[data-knoten]").first()).toContainText("Gareth");
    await expect(kasten.locator("[data-knoten]").first()).toContainText("Ort · Nodix · Ende");
    await expect(kasten.locator("[data-knoten]").first()).toContainText("trifft Ring um Gareth");
    await expect(kasten.locator('[data-knoten="n:1"]')).toContainText("Kraftlinienpunkt");
    await expect(kasten.locator('[data-knoten="n:1"]')).toContainText("Nodix ohne Ort");
    await expect(kasten.locator('[data-knoten="l:tor"]')).toContainText("Beschriftung · kein Nodix");
    await expect(kasten.locator("[data-knoten]").last()).toContainText("Punin");
    await expect(kasten).toContainText("⌒ +12 %");
    const nachher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat, bewegt: globalThis.avesmapsMap!.isMoving() };
    });
    expect(nachher).toEqual({ ...vorher, bewegt: false });
    await page.screenshot({ path: "test-results/kraftlinieneditor-k2.png" });
});

test("🔴 T32 (1): der Doppelklick fliegt zum Rahmen der Linie", async ({ page }) => {
    await oeffneKraftlinieneditor(page);
    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await liste(page)
        .getByRole("option", { name: /Punin–Gareth/ })
        .dblclick();
    await expect(page).toHaveURL(/view=powerlines/);
    await page.waitForFunction(
        (alt) => {
            const jetzt = globalThis.avesmapsMap!.getCenter();
            return !globalThis.avesmapsMap!.isMoving() && (jetzt.lng !== alt.lng || jetzt.lat !== alt.lat);
        },
        vorher,
        { timeout: 15_000 },
    );
});
