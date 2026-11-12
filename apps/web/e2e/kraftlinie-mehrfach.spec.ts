import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
    EditorPowerlineDetail,
    EditorPowerlineList,
    OperationReceipt,
    PowerlineSammelStandBody,
    PowerlineSammelWikiBody,
    WikiArtikel,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Mehrfachauswahl der Kraftlinien (WI-0238, EDIT-0003 T57; Vorlage Fassung 5 der Gebiete, wie am Ort). 🔴 Kein Test schreibt in die
 * Datenbank der Entwicklung: Linien und die beiden Sammelwege (`…/sammel/wiki`, `…/sammel/stand`) kommen aus Stubs; den echten Schreibweg
 * prüft `apps/server/test/editor-kraftlinien-sammel.test.ts` im Wegwerf-Cluster.
 *
 * Problemfälle: Die Liste hat keinen Umschalter; die Eigenschaften zeigen eine Linie statt „gemischt“; ein Feld, das nur einzeln geht, ist
 * schreibbar; ↺ schreibt sofort statt mit „Fertig“ oder schickt je Linie eine Operation; „Entfernen …“ entfernt ohne Rückfrage, je Linie
 * einzeln oder lässt die Haken stehen.
 */
const PUNIN = "b9b9b9b9-0000-4000-8000-000000000001";
const PUNIN_B = "b9b9b9b9-0000-4000-8000-000000000002";
const BASILIUS = "b9b9b9b9-0000-4000-8000-000000000003";
const ADER = "b9b9b9b9-0000-4000-8000-000000000004";
const GARETH = "c9c9c9c9-0000-4000-8000-000000000001";
const PUNKT = "c9c9c9c9-0000-4000-8000-000000000002";
const PUNIN_ORT = "c9c9c9c9-0000-4000-8000-000000000003";

const artikel = (key: string, name: string): WikiArtikel => ({
    key,
    url: `https://de.wiki-aventurica.de/wiki/${key}`,
    name,
    werte: { name, description: "Aus dem Wiki." },
});
const KNOTEN: EditorPowerlineDetail["nodes"] = [
    { id: GARETH, kind: "place", name: "Gareth", x: 551.6, y: 533, nodix: true, meets: [] },
    { id: PUNKT, kind: "nodix", x: 595, y: 570, nodix: true, meets: [] },
    { id: PUNIN_ORT, kind: "place", name: "Punin", x: 640, y: 610, nodix: true, meets: [] },
];
const abschnitt = (id: string, from: string, to: string, revision: number) => ({
    id,
    from,
    to,
    curve: null,
    labelVisible: true,
    revision,
});
const DETAILS: Record<string, EditorPowerlineDetail> = {
    // Eigener Name gegen den Wiki-Namen, eigene Beschreibung.
    [PUNIN]: {
        id: PUNIN,
        name: "Punin–Gareth",
        circle: "voll",
        shape: "strang",
        segments: [abschnitt(PUNIN, GARETH, PUNKT, 3), abschnitt(PUNIN_B, PUNKT, PUNIN_ORT, 4)],
        nodes: KNOTEN,
        description: "Eigene Zeile.",
        article: artikel("punin-gareth", "Punin–Gareth-Linie"),
        bounds: [551, 533, 640, 610],
    },
    // Folgt dem Wiki: Name wie im Artikel, keine eigene Beschreibung.
    [BASILIUS]: {
        id: BASILIUS,
        name: "Basiliuslinie",
        circle: "voll",
        shape: "strang",
        segments: [abschnitt(BASILIUS, GARETH, PUNIN_ORT, 7)],
        nodes: [KNOTEN[0]!, KNOTEN[2]!],
        article: artikel("basiliuslinie", "Basiliuslinie"),
        bounds: [551, 533, 640, 610],
    },
    [ADER]: {
        id: ADER,
        name: "Ader am Fluss",
        circle: "voll",
        shape: "strang",
        segments: [abschnitt(ADER, PUNKT, PUNIN_ORT, 2)],
        nodes: [KNOTEN[1]!, KNOTEN[2]!],
        bounds: [595, 570, 640, 610],
    },
};
const LISTE: EditorPowerlineList = {
    rows: Object.values(DETAILS).map((d) => ({
        id: d.id,
        name: d.name,
        circle: "voll",
        shape: "strang",
        segments: d.segments.length,
        nodes: d.nodes.length,
        ends: ["Gareth", "Punin"],
        bounds: d.bounds!,
    })),
};
const QUITTUNG = {
    operationId: "00000000-0000-4000-8000-000000000238",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    mapRevision: 902,
} as OperationReceipt;

interface Server {
    wiki: PowerlineSammelWikiBody[];
    stand: PowerlineSammelStandBody[];
}

async function oeffne(page: Page): Promise<Server> {
    const server: Server = { wiki: [], stand: [] };
    const json = (route: Route, body: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
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
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/powerlines", (route) => json(route, LISTE));
    await page.route("**/api/editor/powerline-wiki", (route) => json(route, { articles: [] }));
    for (const id of Object.keys(DETAILS)) {
        await page.route(`**/api/editor/powerlines/${id}`, (route) => json(route, DETAILS[id]));
        await page.route(`**/api/editor/powerlines/${id}/history**`, (route) => json(route, { entries: [] }));
    }
    await page.route("**/api/editor/powerlines/sammel/wiki", (route) => {
        server.wiki.push(route.request().postDataJSON() as PowerlineSammelWikiBody);
        return json(route, QUITTUNG);
    });
    await page.route("**/api/editor/powerlines/sammel/stand", (route) => {
        server.stand.push(route.request().postDataJSON() as PowerlineSammelStandBody);
        return json(route, QUITTUNG);
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await zeile(page, "Punin–Gareth").click();
    await page.locator('[data-testid$="-linien-mehrfach"]').click();
    await zeile(page, "Basiliuslinie").click();
    return server;
}

const zeile = (page: Page, name: string) =>
    page
        .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: new RegExp(name) });
const sammel = (page: Page) => page.locator('[data-testid^="kraftlinieneditor-"][data-testid$="-sammel"]');
const teil = (page: Page, ende: string) =>
    page.locator(`[data-testid^="kraftlinieneditor-"][data-testid$="-sammel-${ende}"]`);
const leiste = (page: Page) => page.getByTestId("kraftlinie-leiste");

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 zwei Linien angehakt: „gemischt“ und „Nur einzeln“, ↺ für alle als Schritt, „Fertig“ schreibt EINE Operation", async ({
    page,
}) => {
    const server = await oeffne(page);
    await expect(sammel(page)).toBeVisible();
    await expect(teil(page, "zahl")).toHaveText("2 Kraftlinien gewählt");
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+$/)).toContainText(
        "Kraftlinien bearbeiten · 2 Kraftlinien gewählt",
    );
    // Nur „Eigenschaften“ geht; „Verlauf“ ist grau.
    await expect(sammel(page).getByRole("tab", { name: "Verlauf" })).toHaveAttribute("aria-disabled", "true");
    // Der Name ist verschieden: gemischt, und er geht nur einzeln; die Kurve auch.
    const name = teil(page, "feld-name").locator("input").first();
    await expect(name).toHaveAttribute("placeholder", "gemischt");
    await expect(name).toBeDisabled();
    await expect(teil(page, "hinweis-name")).toHaveText("Nur einzeln");
    await expect(teil(page, "kurve")).toBeDisabled();
    // ↺ am Namen nennt, wie viele einen eigenen Wert haben (Basiliuslinie folgt dem Wiki).
    const zurueck = teil(page, "wiki-name");
    await expect(zurueck).toHaveAttribute("title", "Für alle 2 auf den Wiki-Wert (1 mit eigenem Wert)");
    await page.screenshot({ path: "test-results/wi0238-mehrfach-1920.png" });

    await zurueck.click();
    await expect(teil(page, "hinweis-name")).toHaveText("auf Wiki-Werte, gilt für alle 2");
    await expect(leiste(page)).toContainText("2 Kraftlinien gewählt");
    expect(server.wiki).toEqual([]);
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.wiki.length).toBe(1);
    expect(server.wiki[0]).toEqual({
        operationId: expect.any(String),
        felder: ["name"],
        lines: [
            {
                anker: PUNIN,
                segments: [
                    { id: PUNIN, baseRevision: 3 },
                    { id: PUNIN_B, baseRevision: 4 },
                ],
            },
            { anker: BASILIUS, segments: [{ id: BASILIUS, baseRevision: 7 }] },
        ],
    });
    await expect(leiste(page)).toHaveCount(0);
});

test("🔴 „Entfernen …“ für alle: in zwei Stufen, nach der Rückfrage EINE Operation, danach sind die Haken gelöst", async ({
    page,
}) => {
    const server = await oeffne(page);
    await teil(page, "entfernen").click();
    const blatt = teil(page, "entfernen-blatt");
    await expect(blatt).toContainText("2 Kraftlinien entfernen?");
    await expect(teil(page, "entfernen-folgen")).toContainText("Eine Operation für alle");
    // Vorgabe wie an einer Linie: von der Karte nehmen; gewählt wird ganz löschen.
    await expect(blatt.getByRole("button", { name: "2 Kraftlinien von der Karte nehmen" })).toBeVisible();
    await blatt.getByRole("radio", { name: /Ganz löschen/ }).check();
    await page.screenshot({ path: "test-results/wi0238-mehrfach-entfernen-1920.png" });
    expect(server.stand).toEqual([]);
    await blatt.getByRole("button", { name: "2 Kraftlinien ganz löschen" }).click();
    await expect.poll(() => server.stand.length).toBe(1);
    expect(server.stand[0]).toEqual({
        operationId: expect.any(String),
        wechsel: "powerline.retire",
        lines: [
            {
                anker: PUNIN,
                segments: [
                    { id: PUNIN, baseRevision: 3 },
                    { id: PUNIN_B, baseRevision: 4 },
                ],
            },
            { anker: BASILIUS, segments: [{ id: BASILIUS, baseRevision: 7 }] },
        ],
    });
    await expect(page.getByText("2 Kraftlinien gelöscht; ↺ im Verlauf.")).toBeVisible();
    await expect(sammel(page)).toHaveCount(0);
});

test("🔴 1280: Sammelansicht und Leiste bleiben bedienbar, „Fertig“ schreibt", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const server = await oeffne(page);
    await expect(sammel(page)).toBeVisible();
    await teil(page, "alle-wiki").click();
    await expect(teil(page, "hinweis-beschreibung")).toHaveText("auf Wiki-Werte, gilt für alle 2");
    await expect(leiste(page)).toBeVisible();
    await page.screenshot({ path: "test-results/wi0238-mehrfach-1280.png" });
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.wiki.length).toBe(1);
    expect(server.wiki[0]?.felder).toEqual(["name", "description"]);
});

/** Steht in einem Eingabefeld des Bereichs dieser Wert? (Ein Eingabefeld trägt seinen Wert nicht als Text.) */
const hatWert = (bereich: Locator, wert: string): Promise<boolean> =>
    bereich
        .locator("input")
        .evaluateAll((felder, w) => felder.some((feld) => (feld as HTMLInputElement).value === w), wert);

test("🔴 Regel 7: zwei angehakt, eine abgehakt: das Fenster zeigt die verbliebene wie einzeln gewählt, die Mehrfachauswahl bleibt an", async ({
    page,
}) => {
    await oeffne(page);
    await expect(sammel(page)).toBeVisible();
    await zeile(page, "Punin–Gareth").click();
    await expect(sammel(page)).toBeHidden();
    const fenster = page.getByTestId(/^kraftlinieneditor-fenster-\d+$/).filter({ visible: true });
    await expect(fenster).toContainText("Kraftlinien bearbeiten · Basiliuslinie");
    await expect.poll(() => hatWert(fenster, "Basiliuslinie")).toBe(true);
    // Kein zweites Fenster, keins abgelegt (Falle bis WI-0238): dasselbe Fenster mit seinen Häkchen.
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+$/)).toHaveCount(1);
    await zeile(page, "Punin–Gareth").click();
    await expect(sammel(page)).toBeVisible();
    await expect(teil(page, "zahl")).toHaveText("2 Kraftlinien gewählt");
    await expect(page.locator('[data-testid$="-linien-mehrfach"]').filter({ visible: true })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
});
