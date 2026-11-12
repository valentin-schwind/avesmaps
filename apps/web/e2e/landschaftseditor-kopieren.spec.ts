import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail, EditorLandscapeList } from "@avesmaps3d/shared";
import { json, oeffneFlaechenWerkzeug, stellen, type Stelle } from "./landschaft-werkzeug-stub.ts";

/**
 * „Kopieren …“ im Kartenmenü (WI-0178 Werkzeug 8; Betreiber 2026-10-19 „wie legacy B mit haken“; EDIT-0004 §2.12): Die Fläche unter dem
 * Rechtsklick kommt aus den Kacheln der lokalen Karte, Detail, Liste und Schreibweg aus Stubs. 🔴 Kein Test schreibt in die Datenbank der
 * Entwicklung.
 *
 * Problemfälle: Der Eintrag bleibt „Kommt später“; das Blatt wählt die eigene Ebene vor; eine neue Landschaft ohne Namen geht zum Server;
 * der Haken steht schon; der Haken sagt nicht, dass die Landschaft mitgeht; das Blatt schickt eine falsche Revision oder die Art der
 * Quelle in die fremde Ebene.
 */

const HUEGEL = "a8a8a8a8-0000-4000-8000-000000000002";

interface Server {
    geschrieben: { url: string; body: Record<string, unknown> }[];
}

async function aufbau(page: Page): Promise<{ stelle: Stelle; server: Server }> {
    const server: Server = { geschrieben: [] };
    const stub: { detail?: EditorLandscapeDetail; liste: EditorLandscapeList } = { liste: { rows: [] } };
    await oeffneFlaechenWerkzeug(
        page,
        (route: Route) =>
            route.fulfill(json(stub.detail === undefined ? 404 : 200, stub.detail ?? { message: "unbekannt" })),
        () => stub.liste,
    );
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/copy$/, (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        server.geschrieben.push({ url: route.request().url(), body });
        return route.fulfill(
            json(200, {
                operationId: body["operationId"],
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                publicId: HUEGEL,
                name: String(body["name"] ?? "Hügel am Forst"),
                areaId: "a8a8a8a8-0000-4000-8000-0000000000a9",
            }),
        );
    });
    const [stelle] = await stellen(page);
    stub.detail = {
        id: stelle!.region,
        name: "Probewald",
        layer: "vegetation",
        type: "wald",
        circle: "halb-rechts",
        order: 1,
        clickLocked: false,
        areas: [
            {
                id: stelle!.area,
                polygons: [
                    [
                        [
                            [400, 500],
                            [500, 500],
                            [500, 600],
                        ],
                    ],
                ],
                affectsPaths: true,
                revision: 6,
            },
        ],
        labels: [],
        neighbors: [],
        revision: 1,
    };
    stub.liste = {
        rows: [
            { id: stelle!.region, name: "Probewald", layer: "vegetation", circle: "halb-rechts", order: 1 },
            { id: HUEGEL, name: "Hügel am Forst", layer: "topographie", circle: "halb-rechts", order: 1 },
        ],
    } as EditorLandscapeList;
    return { stelle: stelle!, server };
}

async function oeffneBlatt(page: Page, stelle: Stelle) {
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-flaeche-kopieren");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    const blatt = page.locator('[data-testid$="-kopieren"]').first();
    await expect(blatt).toBeVisible();
    return blatt;
}

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 das Blatt: der Zwilling vorgewählt, eine neue Landschaft unter dem Namen der Quelle, ohne Art, ohne Haken; „Kopieren“ schreibt EINE Operation", async ({
    page,
}) => {
    const { stelle, server } = await aufbau(page);
    const blatt = await oeffneBlatt(page, stelle);
    const feld = (name: string) => blatt.locator(`[data-testid$="-kopieren-${name}"]`);
    await expect(feld("ebene").locator("select")).toHaveValue("topographie");
    // Die eigene Ebene steht zuletzt.
    await expect(feld("ebene").locator("option").last()).toHaveText(/eigene Ebene/);
    await expect(feld("ziel").locator("select")).toHaveValue("");
    await expect(feld("name").locator("input")).toHaveValue("Probewald");
    await expect(feld("art").locator("select")).toHaveValue("");
    await expect(feld("loeschen")).not.toBeChecked();
    await page.screenshot({ path: "test-results/werkzeug8-blatt.png" });

    // Ohne Namen kein Schreiben, der Satz steht im Blatt.
    await feld("name").locator("input").fill("  ");
    await feld("knopf").click();
    await expect(feld("fehler")).toContainText("Namen");
    expect(server.geschrieben).toHaveLength(0);

    await feld("name").locator("input").fill("Probehügel");
    await feld("art").locator("select").selectOption("huegelland");
    await feld("knopf").click();
    await expect.poll(() => server.geschrieben.length).toBe(1);
    expect(server.geschrieben[0]!.url).toContain(`/landscapes/${stelle.region}/copy`);
    expect(server.geschrieben[0]!.body).toMatchObject({
        areaId: stelle.area,
        baseRevision: 6,
        layer: "topographie",
        name: "Probehügel",
        type: "huegelland",
        deleteSource: false,
    });
    expect(server.geschrieben[0]!.body).not.toHaveProperty("targetId");
    await expect(page.getByText("Kopie in „Topographie“ angelegt: Landschaft „Probehügel“.")).toBeVisible();
});

test("🔴 bestehende Ziellandschaft mit Haken: die Folge steht da; geschrieben werden Ziel und Haken, kein Name", async ({
    page,
}) => {
    const { stelle, server } = await aufbau(page);
    const blatt = await oeffneBlatt(page, stelle);
    const feld = (name: string) => blatt.locator(`[data-testid$="-kopieren-${name}"]`);
    await feld("ziel").locator("select").selectOption(HUEGEL);
    await expect(feld("name")).toHaveCount(0);
    await feld("loeschen").check();
    await expect(feld("folge")).toContainText("letzte Teilfläche");
    await page.screenshot({ path: "test-results/werkzeug8-haken.png" });
    await feld("knopf").click();
    await expect.poll(() => server.geschrieben.length).toBe(1);
    expect(server.geschrieben[0]!.body).toMatchObject({ layer: "topographie", targetId: HUEGEL, deleteSource: true });
    expect(server.geschrieben[0]!.body).not.toHaveProperty("name");
    await expect(page.getByText("Fläche nach „Topographie“ umgezogen: Landschaft „Hügel am Forst“.")).toBeVisible();
});

test("Esc im Blatt schließt nur das Blatt, nichts wird geschrieben", async ({ page }) => {
    const { stelle, server } = await aufbau(page);
    const blatt = await oeffneBlatt(page, stelle);
    await page.keyboard.press("Escape");
    await expect(blatt).toHaveCount(0);
    expect(server.geschrieben).toHaveLength(0);
});
