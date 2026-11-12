import { expect, test, type Page } from "@playwright/test";
import type { EditorLandscapeDetail, EditorLandscapeList } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, showLandscapes } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Landschaftseditor, lesend (WI-0178 Paket A3; EDIT-0004 §2.2; T27). 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Liste
 * und Detail kommen aus einem Stub (den echten Leseweg prüft `editor-landscapes-routes.test.ts` gegen die Testdatenbank).
 *
 * Problemfälle: „Regionen“ bleibt „später“; das Verb öffnet den Ortseditor statt des Landschaftseditors; die Legende kennt nur drei
 * Zustände oder steht oben; die Liste zeigt in der Ansicht „Landschaften“ eine andere Ebene als die Karte; Form und Beschriftungen
 * fehlen im Fenster; das Fenster bietet Speichern an, obwohl es nur liest.
 */
const BECKEN = "a3a3a3a3-0000-4000-8000-000000000001";
const VORGEBIRGE = "a3a3a3a3-0000-4000-8000-000000000002";
const NORDMARKEN = "a3a3a3a3-0000-4000-8000-000000000003";
const LISTE: EditorLandscapeList = {
    rows: [
        {
            id: BECKEN,
            name: "Gratenfelser Becken",
            layer: "topographie",
            type: "tal",
            circle: "voll",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfelser_Becken", title: "Gratenfelser Becken" },
            areas: 1,
            labels: 1,
            order: 740,
            bounds: [438, 500, 468, 540],
        },
        {
            id: VORGEBIRGE,
            name: "Vorgebirge des Kosch",
            layer: "topographie",
            type: "huegelland",
            circle: "halb-rechts",
            areas: 3,
            order: 280,
            bounds: [455, 495, 500, 545],
        },
        {
            id: NORDMARKEN,
            name: "Nordmarken",
            layer: "derographisch",
            circle: "halb",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Nordmarken", title: "Nordmarken" },
            labels: 1,
            order: 160,
        },
    ],
};
const DETAIL: EditorLandscapeDetail = {
    id: BECKEN,
    name: "Gratenfelser Becken",
    layer: "topographie",
    type: "tal",
    circle: "voll",
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfelser_Becken", title: "Gratenfelser Becken" },
    order: 740,
    clickLocked: false,
    curve: { enabled: false },
    areas: [
        {
            id: "a3a3a3a3-0000-4000-8000-0000000000a1",
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
    labels: [
        {
            id: "a3a3a3a3-0000-4000-8000-0000000000b1",
            text: "Gratenfelser Becken",
            x: 450,
            y: 520,
            size: 18,
            priority: 3,
            zoomMin: 2,
            zoomMax: 8,
            visible: true,
            primary: true,
            revision: 1,
        },
    ],
    neighbors: [{ id: VORGEBIRGE, name: "Vorgebirge des Kosch", sharedCorners: 54 }],
    revision: 1,
};

async function oeffneLandschaftseditor(page: Page, vorher?: (page: Page) => Promise<void>): Promise<void> {
    await stubAdmin(page, { capabilities: ["use_editor_menu", "edit_landscape_form"], role: "reviewer" });
    await page.route("**/api/editor/landscapes", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LISTE) }),
    );
    await page.route(`**/api/editor/landscapes/${BECKEN}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL) }),
    );
    await openMap(page, EDITOR_MODE);
    // Den Fächer erreicht ein Klick nur, solange kein angedocktes Werkzeugfenster die Karte schmaler macht.
    if (vorher) await vorher(page);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Derographie bearbeiten");
    await verb.click();
}
const fenster = (page: Page) =>
    page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .locator("xpath=ancestor::*[contains(@class,'avm-fenster')][1]");

test("🔴 Regionen → „Landschaften bearbeiten“ öffnet den Landschaftseditor: Liste mit vier Zuständen und der Legende unten, lesend", async ({
    page,
}) => {
    await oeffneLandschaftseditor(page);
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    await expect(liste).toBeVisible();
    await expect(liste.getByRole("option")).toHaveCount(3);
    // Die Legende unter der Liste: je Zustand Name, Kreis und Zahl (EDIT-0003 T26 (5)).
    await expect(liste).toContainText("platziert und dem Wiki zugewiesen");
    await expect(liste).toContainText("platziert, ohne Wiki-Artikel");
    await expect(liste).toContainText("nur im Wiki, nicht platziert");
    // Lesend: kein Speichern, „nur lesen“ im Kopf; der Ortseditor ist nicht aufgegangen.
    await expect(page.getByText("nur lesen").first()).toBeVisible();
    await expect(page.locator('[data-testid^="ortseditor-"][data-testid$="-liste"]')).toHaveCount(0);
    await expect(fenster(page).getByRole("button", { name: "Speichern" })).toHaveCount(0);
});

test("🔴 eine Landschaft wählen: Eigenschaften, Form mit gemeinsamen Ecken, Beschriftungen mit ihren Werten", async ({
    page,
}) => {
    await oeffneLandschaftseditor(page);
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    await liste.getByRole("option", { name: /Gratenfelser Becken/ }).click();
    const rumpf = page.getByTestId(/^landschaftseditor-fenster-\d+-eigenschaften$/);
    await expect(rumpf).toContainText("Gratenfelser Becken");
    await expect(rumpf).toContainText("Topographie");
    await page.getByRole("tab", { name: "Form" }).click();
    await expect(rumpf).toContainText("Vorgebirge des Kosch (54)");
    await page.getByRole("tab", { name: /Beschriftungen \(1\)/ }).click();
    await expect(rumpf).toContainText("2 bis 8");
    await expect(rumpf).toContainText("18");
    await page.screenshot({ path: "test-results/landschaftseditor-a3.png" });
});

test("🔴 in der Ansicht „Landschaften“ folgt die Liste der Ebene der Karte (T27 (1))", async ({ page }) => {
    await oeffneLandschaftseditor(page, (p) => showLandscapes(p, "topographie"));
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    await expect(liste.getByRole("option")).toHaveCount(2);
    await expect(liste.getByRole("option", { name: /Nordmarken/ })).toHaveCount(0);
});

test("🔴 F17 und T32 (1): schon der Einfachklick in der Liste stellt die Karte auf die Ebene der Landschaft, der Doppelklick fliegt dazu", async ({
    page,
}) => {
    await oeffneLandschaftseditor(page);
    const kachel = page.getByTestId("fan-toggle");
    // Die Kachel „Landschaften“ im Editorpanel hat die Karte schon auf die Landschaften gestellt, Ebene „Alle“ (WI-0212, T37).
    await expect(kachel).toHaveAttribute("title", /Derographie/);
    await expect(kachel).not.toContainText("Regionen");
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    // Ohne Flug: Die Nordmarken haben keine Fläche, die Kamera bleibt; die Ebene wechselt trotzdem.
    await liste.getByRole("option", { name: /Nordmarken/ }).click();
    await expect(kachel).toHaveAttribute("title", /Derographie/);
    await expect(kachel).toContainText("Regionen");
    // Die Liste folgt der Ebene der Karte (T27 (1)): Jetzt stehen nur noch die Derographischen darin.
    await expect(liste.getByRole("option")).toHaveCount(1);
});

test("🔴 T32 (1): Doppelklick fliegt zum Rahmen und stellt die Ansicht auf die Ebene der Landschaft", async ({
    page,
}) => {
    await oeffneLandschaftseditor(page);
    const kachel = page.getByTestId("fan-toggle");
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await liste.getByRole("option", { name: /Gratenfelser Becken/ }).dblclick();
    // Die zweite Zeile der Kachel nennt bei Topographie ihre Spielart (Höhenlinien); die Ebene steht im Link der Karte.
    await expect(kachel).toHaveAttribute("title", /Derographie/);
    await expect(page).toHaveURL(/layer=topographie/);
    await page.waitForFunction(
        (alt) => {
            const jetzt = globalThis.avesmapsMap!.getCenter();
            return !globalThis.avesmapsMap!.isMoving() && (jetzt.lng !== alt.lng || jetzt.lat !== alt.lat);
        },
        vorher,
        { timeout: 15_000 },
    );
});
