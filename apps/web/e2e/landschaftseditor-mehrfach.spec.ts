import { expect, test, type Page, type Route } from "@playwright/test";
import { LANDSCAPE_BATCH_MAX, type EditorLandscapeDetail, type EditorLandscapeList } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57; Form wie Fassung 5 der Gebiete, Betreiber 2026-10-19: „perfekt genau das wollen
 * wir“): Liste, Detail und Schreibwege aus Stubs. 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Der Umschalter fehlt oder die Häkchen kommen ohne ihn; zwei angehakte zeigen noch die Eigenschaften einer; ein gemischtes
 * Feld zeigt einen Wert; der Name lässt sich für alle ändern; eine neue Ebene geht ohne Art; „Fertig“ schreibt je Landschaft statt EINMAL;
 * „Entfernen …“ entfernt nur eine; der Umschalter aus lässt die Sammelansicht stehen; ↺ im Verlauf schreibt alte Werte über einen PATCH (seit WI-0265 B6c nimmt der Server zurück);
 * angehakte Gipfel lassen das Fenster leer, und der Kopf sagt „nur lesen“, obwohl geschrieben wird (Stage-Funde 2026-10-19).
 */

const A = "a5a5a5a5-0000-4000-8000-000000000001";
const B = "a5a5a5a5-0000-4000-8000-000000000002";
const C = "a5a5a5a5-0000-4000-8000-000000000003";
const SAMMEL_OP = "a5a5a5a5-0000-4000-8000-0000000000e1";
const G1 = "a5a5a5a5-0000-4000-8000-0000000000f1";
const G2 = "a5a5a5a5-0000-4000-8000-0000000000f2";
const G3 = "a5a5a5a5-0000-4000-8000-0000000000f3";
/** Alle Ebenen: Die Liste zeigt dann Flächen und Gipfel. */
const ALLE = `${EDITOR_MODE}#x=500&y=500&z=4&series=original&view=landscapes&layer=alle`;
const LISTE: EditorLandscapeList = {
    rows: [
        { id: A, name: "Farindel", layer: "vegetation", type: "wald", circle: "voll", areas: 1, labels: 1, order: 3 },
        {
            id: B,
            name: "Reichsforst",
            layer: "vegetation",
            type: "wald",
            circle: "voll",
            areas: 2,
            labels: 1,
            order: 2,
        },
        { id: C, name: "Grünwald", layer: "vegetation", type: "urwald", circle: "voll", areas: 1, order: 1 },
    ],
    // Stage-Fund 2026-10-19: „1. Vulkan im östlichen Yetiland“, „2. …“, „3. …“ angehakt, und rechts stand „Keine Fläche gewählt.“
    peaks: [
        { id: G1, name: "1. Vulkan im östlichen Yetiland", subtype: "vulkan", circle: "voll", position: [480, 480] },
        { id: G2, name: "2. Vulkan im östlichen Yetiland", subtype: "vulkan", circle: "voll", position: [482, 480] },
        { id: G3, name: "3. Vulkan im östlichen Yetiland", subtype: "vulkan", circle: "voll", position: [484, 480] },
    ],
} as EditorLandscapeList;

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

interface Server {
    sammel: Record<string, unknown>[];
    entfernt: Record<string, unknown>[];
    zurueck: Record<string, unknown>[];
}

async function oeffne(page: Page, adresse = EDITOR_MODE, liste: EditorLandscapeList = LISTE): Promise<Server> {
    const server: Server = { sammel: [], entfernt: [], zurueck: [] };
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
    await page.route("**/api/editor/landscapes", (route) => json(route, 200, liste));
    await page.route(/\/api\/editor\/landscapes\/a5a5[^/]+$/, (route) => {
        const id = /landscapes\/([^/?]+)/.exec(route.request().url())?.[1] ?? A;
        const zeile = LISTE.rows.find((z) => z.id === id) ?? LISTE.rows[0]!;
        return json(route, 200, {
            id: zeile.id,
            name: zeile.name,
            layer: zeile.layer,
            type: zeile.type,
            circle: zeile.circle,
            order: zeile.order,
            clickLocked: false,
            areas: [],
            labels: [],
            neighbors: [],
            revision: 1,
        } as EditorLandscapeDetail);
    });
    // Der Verlauf von Farindel: die Sammeländerung an Farindel und Reichsforst; Farindel steht seither unverändert (Revision 1).
    await page.route(`**/api/editor/landscapes/${A}/history**`, (route) =>
        json(route, 200, {
            entries: [
                {
                    operationId: SAMMEL_OP,
                    seq: 7,
                    at: "2026-10-19T12:00:00.000Z",
                    operation: "landscape.batch",
                    source: "editor",
                    actor: { kind: "person", name: "Thomas" },
                    summary: "2 Landschaften: verborgen",
                    objects: [A, B].map((id) => ({
                        kind: "landscape",
                        id,
                        action: "region.updated",
                        revisionBefore: 0,
                        revisionAfter: 1,
                        changes: { hidden: { before: false, after: true } },
                    })),
                },
            ],
        }),
    );
    // ↺ nimmt der Server zurück (WI-0265 B6c): Vorprüfung (liest nur), Rückfrage, EINE Rücknahme; beide Antworten sind hier gestellt, der echte Ablauf steht in `ruecknahme-flaeche.test.ts`.
    await page.route(`**/api/editor/landscapes/${A}/restore-series/preview`, (route) =>
        json(route, 200, {
            ergebnis: "ok",
            membersHash: "f".repeat(64),
            mitglieder: [
                {
                    operationId: SAMMEL_OP,
                    seq: 42,
                    at: "2026-10-18T13:00:00.000Z",
                    operation: "landscape.batch",
                    source: "editor",
                    actor: { kind: "person", name: "Thomas" },
                    status: "ruecknehmbar",
                    offen: true,
                    gegenstaende: [
                        {
                            kind: "landscape",
                            id: A,
                            name: "Farindel",
                            action: "region.updated",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: [],
                        },
                    ],
                },
            ],
            offen: [SAMMEL_OP],
            gegenstaende: [],
            konflikte: [],
            sperren: [],
            fehlendeRechte: [],
            fremdePersonen: [],
            reasonRequired: false,
            folgen: { gegenstaende: 1, gelaende: "keines" },
        }),
    );
    await page.route(`**/api/editor/landscapes/${A}/restore-series`, (route) => {
        server.zurueck.push(route.request().postDataJSON() as Record<string, unknown>);
        return json(route, 200, {
            operationId: "a5a5a5a5-0000-4000-8000-0000000000e3",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
            reverts: [SAMMEL_OP],
        });
    });
    await page.route("**/api/editor/landscapes/batch", (route) => {
        server.sammel.push(route.request().postDataJSON() as Record<string, unknown>);
        return json(route, 200, {
            operationId: "a5a5a5a5-0000-4000-8000-0000000000e1",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
        });
    });
    await page.route("**/api/editor/landscapes/batch-retire", (route) => {
        server.entfernt.push(route.request().postDataJSON() as Record<string, unknown>);
        return json(route, 200, {
            operationId: "a5a5a5a5-0000-4000-8000-0000000000e2",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
        });
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, 200, { locks: [] }) : json(route, 200, { lost: [] }),
    );
    await openMap(page, adresse);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    return server;
}

const liste = (page: Page) => page.getByTestId(/^landschaftseditor-fenster-\d+-landschaften$/);
const panel = (page: Page) => page.getByTestId(/^landschaftseditor-fenster-\d+-mehrfach$/);
const feld = (page: Page, name: string) =>
    page.getByTestId(new RegExp(`^landschaftseditor-fenster-\\d+-mehrfach-${name}$`));

async function hakeAn(page: Page, ...namen: string[]): Promise<void> {
    await liste(page)
        .getByTestId(/-landschaften-mehrfach$/)
        .click();
    // Beim Einschalten ist die gewählte Landschaft schon angehakt: erst lösen, dann genau diese anhaken.
    const loesen = liste(page).getByTestId(/-landschaften-haken-loesen$/);
    if (await loesen.isVisible()) await loesen.click();
    for (const name of namen)
        await liste(page)
            .getByTestId(/-landschaften-zeile$/)
            .filter({ hasText: name })
            .first()
            .click();
}

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 zwei angehakt: die Eigenschaften aller, Name nur einzeln; eine neue Ebene will eine Art; „Fertig“ schreibt EINMAL für beide", async ({
    page,
}) => {
    const server = await oeffne(page);
    await expect(liste(page)).toBeVisible();
    await hakeAn(page, "Farindel", "Reichsforst");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("2 Landschaften gewählt");
    await expect(panel(page)).toContainText("Farindel");
    await expect(panel(page)).toContainText("Reichsforst");
    // Der Name geht nur einzeln; Ebene und Art sind für beide gleich.
    await expect(feld(page, "name").locator("input")).toBeDisabled();
    await expect(panel(page)).toContainText("Nur einzeln");
    await expect(feld(page, "ebene").locator("select")).toHaveValue("vegetation");
    await expect(feld(page, "art").locator("select")).toHaveValue("wald");
    await page.screenshot({ path: "test-results/t57-derographie-zwei.png" });

    await feld(page, "ebene").locator("select").selectOption("topographie");
    await expect(page.getByTestId(/-mehrfach-art-fehlt$/)).toBeVisible();
    await feld(page, "art").locator("select").selectOption("huegelland");
    await expect(page.getByTestId(/-mehrfach-art-fehlt$/)).toHaveCount(0);
    await expect(panel(page)).toContainText("gilt für alle 2");

    const leiste = page.getByTestId("landschaft-sammel-leiste");
    await expect(leiste).toBeVisible();
    await page.getByTestId("landschaft-sammel-leiste-fertig").click();
    await expect.poll(() => server.sammel.length).toBe(1);
    expect(server.sammel[0]).toMatchObject({ ids: [A, B], changes: { layer: "topographie", type: "huegelland" } });
});

test("🔴 gemischt: verschiedene Arten zeigen „gemischt“, die Ebene gilt; „Entfernen …“ entfernt alle in EINEM Schritt", async ({
    page,
}) => {
    const server = await oeffne(page);
    await hakeAn(page, "Farindel", "Grünwald");
    await expect(panel(page)).toContainText("2 Landschaften gewählt");
    await expect(feld(page, "ebene").locator("select")).toHaveValue("vegetation");
    await expect(feld(page, "art").locator("select")).toHaveValue("");
    await expect(feld(page, "art")).toContainText("gemischt");
    await expect(feld(page, "art").locator("select")).toBeEnabled();

    await page.getByTestId(/-mehrfach-entfernen-oeffnen$/).click();
    await panel(page).getByRole("button", { name: "Entfernen", exact: true }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]).toMatchObject({ ids: [A, C], stage: "off_map" });
    expect(server.sammel).toHaveLength(0);
});

test("🔴 Umschalter aus: die Sammelansicht geht, nichts geschrieben; ↺ im Verlauf nimmt die Sammeländerung für alle zurück", async ({
    page,
}) => {
    const server = await oeffne(page);
    await hakeAn(page, "Farindel", "Reichsforst");
    await expect(panel(page)).toContainText("2 Landschaften gewählt");
    await liste(page)
        .getByTestId(/-landschaften-mehrfach$/)
        .click();
    await expect(panel(page)).toHaveCount(0);
    await expect(liste(page).getByTestId(/-landschaften-haken-loesen$/)).toHaveCount(0);
    expect(server.sammel).toHaveLength(0);

    // Wieder einzeln: Farindel gewählt, der Name geht, der Verlauf steht offen.
    await liste(page)
        .getByTestId(/-landschaften-zeile$/)
        .filter({ hasText: "Farindel" })
        .first()
        .click();
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/).locator("input")).toBeEnabled();
    await page.getByTestId(/^landschaftseditor-fenster-\d+-reiter-verlauf$/).click();
    const eintrag = page.getByTestId(/^landschaftseditor-fenster-\d+-verlauf-eintrag$/);
    await expect(eintrag).toHaveCount(1);
    await expect(eintrag).toContainText("2 Landschaften: verborgen");
    await eintrag.locator("summary").click();
    await eintrag.locator('[data-testid$="-ruecknahme"]').click();
    await eintrag
        .locator('[data-testid$="-ruecknahme-frage"]')
        .getByRole("button", { name: "Zurücknehmen", exact: true })
        .click();
    await expect.poll(() => server.zurueck.length).toBe(1);
    expect(server.zurueck[0]).toEqual({
        operationId: expect.any(String),
        members: [SAMMEL_OP],
        membersHash: "f".repeat(64),
    });
});

/** Der Kopf des Fensters der Derographie: Titel und daneben, wenn es nur liest, „nur lesen“. */
const fensterKopf = (page: Page) =>
    page
        .locator('dialog[data-lage="angedockt"]')
        .filter({ has: page.getByTestId(/^landschaftseditor-fenster-\d+-landschaften$/) });

test("🔴 zwei angehakt, eins abgehakt: das Fenster zeigt die verbliebene wie nach einem Klick, mit Titel, nicht „anhaken“", async ({
    page,
}) => {
    // Stage-Fund 2026-10-20 (Blutsee und Blutzinnen, dann nur noch Blutzinnen): Die Karte markierte richtig, das Fenster bat ums Anhaken.
    await oeffne(page);
    await hakeAn(page, "Farindel", "Reichsforst");
    await expect(panel(page)).toContainText("2 Landschaften gewählt");
    await liste(page)
        .getByTestId(/-landschaften-zeile$/)
        .filter({ hasText: "Reichsforst" })
        .first()
        .click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId(/-mehrfach-anhaken$/)).toHaveCount(0);
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/).locator("input")).toHaveValue(
        "Farindel",
    );
    await expect(fensterKopf(page)).toContainText("Derographie bearbeiten · Farindel");
    // Die Mehrfachauswahl bleibt an: Ein weiterer Haken bringt die Sammelansicht zurück.
    await liste(page)
        .getByTestId(/-landschaften-zeile$/)
        .filter({ hasText: "Grünwald" })
        .first()
        .click();
    await expect(panel(page)).toContainText("2 Landschaften gewählt");
});

test("🔴 Gipfel: drei angehakte Vulkane stehen in der Sammelansicht; gemeinsam nur „Besucher“, „Fertig“ schreibt EINMAL; kein „nur lesen“", async ({
    page,
}) => {
    const server = await oeffne(page, ALLE);
    await hakeAn(page, "1. Vulkan", "2. Vulkan", "3. Vulkan");
    await expect(page.getByTestId(/-mehrfach-kopf$/)).toHaveText("3 Gipfel gewählt");
    await expect(panel(page)).not.toContainText("Keine Fläche gewählt.");
    // Ebene und Art tragen Gipfel nicht: gesperrt, mit Satz. „Entfernen …“ geht (Editor-Orchestrierung 2026-10-19).
    await expect(feld(page, "ebene").locator("select")).toBeDisabled();
    await expect(feld(page, "art").locator("select")).toBeDisabled();
    await expect(panel(page)).toContainText("Ebene und Art gelten nur für Landschaften.");
    await expect(page.getByTestId(/-mehrfach-entfernen-oeffnen$/)).toBeEnabled();
    // Fund 2: Die Sammelansicht schreibt, der Kopf sagt nicht „nur lesen“.
    await expect(fensterKopf(page)).toContainText("3 gewählt");
    await expect(fensterKopf(page).locator(".avm-fenster__zusatz")).toHaveCount(0);

    await feld(page, "besucher").locator("select").selectOption("ja");
    await expect(panel(page)).toContainText("gilt für alle 3");
    await page.getByTestId("landschaft-sammel-leiste-fertig").click();
    await expect.poll(() => server.sammel.length).toBe(1);
    expect(server.sammel[0]).toMatchObject({ ids: [], peaks: [G1, G2, G3], changes: { hidden: true } });
});

test("🔴 gemischt: eine Landschaft und ein Gipfel - gemeinsam nur „Besucher“, beides in EINEM Aufruf", async ({
    page,
}) => {
    const server = await oeffne(page, ALLE);
    await hakeAn(page, "Farindel", "2. Vulkan");
    await expect(page.getByTestId(/-mehrfach-kopf$/)).toHaveText("2 gewählt: Landschaften und Gipfel");
    await expect(feld(page, "ebene").locator("select")).toBeDisabled();
    await expect(fensterKopf(page).locator(".avm-fenster__zusatz")).toHaveCount(0);
    await feld(page, "besucher").locator("select").selectOption("ja");
    await page.getByTestId("landschaft-sammel-leiste-fertig").click();
    await expect.poll(() => server.sammel.length).toBe(1);
    expect(server.sammel[0]).toMatchObject({ ids: [A], peaks: [G2], changes: { hidden: true } });
    expect(server.entfernt).toHaveLength(0);
});

test("🔴 „Entfernen …“ mit Gipfeln: nur Gipfel ohne Stufe, gemischt mit dem Satz zu den Gipfeln; je EIN Aufruf mit peaks", async ({
    page,
}) => {
    const server = await oeffne(page, ALLE);
    await hakeAn(page, "1. Vulkan", "3. Vulkan");
    await page.getByTestId(/-mehrfach-entfernen-oeffnen$/).click();
    await expect(panel(page)).toContainText("2 Gipfel entfernen?");
    await expect(page.getByTestId(/-mehrfach-entfernen-off_map$/)).toHaveCount(0);
    await expect(panel(page)).toContainText("2 werden gelöscht");
    await panel(page).getByRole("button", { name: "Entfernen", exact: true }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]).toMatchObject({ ids: [], peaks: [G1, G3], stage: "retire" });
});

test("🔴 „Entfernen …“ gemischt: die Stufe gilt den Landschaften, die Gipfel gehen gelöscht mit, EIN Aufruf", async ({
    page,
}) => {
    const server = await oeffne(page, ALLE);
    await hakeAn(page, "Farindel", "2. Vulkan");
    await page.getByTestId(/-mehrfach-entfernen-oeffnen$/).click();
    await expect(panel(page)).toContainText("2 Landschaften und Gipfel entfernen?");
    await expect(page.getByTestId(/-mehrfach-entfernen-off_map$/)).toBeVisible();
    await expect(panel(page)).toContainText("„Von der Karte nehmen“ gilt nur für Landschaften");
    await panel(page).getByRole("button", { name: "Entfernen", exact: true }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]).toMatchObject({ ids: [A], peaks: [G2], stage: "off_map" });
});

/** Die Ebenen der gelben Mehrfachmarkierung im Stil der Karte, mit ihrem Filter (`map/mehrfach-markierung.ts`). */
const markierung = (page: Page) =>
    page.evaluate(() =>
        (globalThis.avesmapsMap!.getStyle().layers ?? [])
            .filter((ebene) => ebene.id.startsWith("mehrfach-"))
            .map((ebene) => ({ id: ebene.id, filter: JSON.stringify((ebene as { filter?: unknown }).filter ?? null) })),
    );

test("🔴 angehakt leuchtet gelb auf der Karte wie einzeln gewählt: Landschaften als Fläche, Gipfel mit Hof; Umschalter aus nimmt alles weg", async ({
    page,
}) => {
    await oeffne(page, ALLE);
    await hakeAn(page, "Farindel", "2. Vulkan");
    await expect
        .poll(async () => (await markierung(page)).map((e) => e.id).sort())
        .toEqual(expect.arrayContaining(["mehrfach-landscape-fill", "mehrfach-landscape-line"]));
    const ebenen = await markierung(page);
    expect(ebenen.find((e) => e.id === "mehrfach-landscape-fill")?.filter).toContain(A);
    // Der Gipfel leuchtet, wo die Gipfelkacheln im Stil liegen; sein Hof nennt ihn, nicht die Landschaft.
    const hof = ebenen.find((e) => e.id === "mehrfach-peak-hof");
    if (hof) {
        expect(hof.filter).toContain(G2);
        expect(hof.filter).not.toContain(A);
    }
    await liste(page)
        .getByTestId(/-landschaften-mehrfach$/)
        .click();
    await expect.poll(async () => (await markierung(page)).length).toBe(0);
});

test("🔴 mehr angehakt, als EINE Operation trägt: das Fenster nennt den Grund vor dem Absenden, Felder und „Entfernen …“ ruhen, nichts geht hinaus", async ({
    page,
}) => {
    // Editor-Orchestrierung 2026-10-20 nach dem Fund der Gebiete: über der Grenze schlugen Sammel-Ändern und -Entfernen still fehl.
    const viele: EditorLandscapeList = {
        rows: Array.from({ length: LANDSCAPE_BATCH_MAX + 1 }, (_, i) => ({
            id: `a6a6a6a6-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
            name: `Probewald ${String(i + 1)}`,
            layer: "vegetation",
            type: "wald",
            circle: "voll",
            areas: 1,
            order: i,
        })),
    } as EditorLandscapeList;
    const server = await oeffne(page, EDITOR_MODE, viele);
    await liste(page)
        .getByTestId(/-landschaften-mehrfach$/)
        .click();
    await liste(page)
        .getByTestId(/-landschaften-alle$/)
        .click();
    const grund = page.getByTestId(/-mehrfach-zu-viele$/);
    await expect(grund).toBeVisible();
    await expect(grund).toContainText(`höchstens ${LANDSCAPE_BATCH_MAX.toLocaleString("de-DE")} Landschaften`);
    await expect(feld(page, "besucher").locator("select")).toBeDisabled();
    await expect(page.getByTestId(/-mehrfach-entfernen-oeffnen$/)).toBeDisabled();
    expect(server.sammel).toHaveLength(0);
    expect(server.entfernt).toHaveLength(0);
});
