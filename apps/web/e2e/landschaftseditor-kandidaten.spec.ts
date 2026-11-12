import { expect, test, type Route } from "@playwright/test";
import type {
    EditorLandmarkenKandidat,
    EditorLandscapeList,
    EditorWikiEintrag,
    LandscapeCreateBody,
    LandmarkenKandidatUnterdrueckenBody,
} from "@avesmaps3d/shared";
import { KOSCH, LISTE, landmarkenStub as stub, oeffneLandmarkenListe as oeffneListe } from "./landmarken-stub.ts";
import { settleFrame } from "./map-handle.ts";

/**
 * Die Landmarken-Kandidaten des WikiSync in der Derographie (WI-0271 L7, §4.2), ohne Datenbank: Liste und Fenster kommen aus Stubs. Ein Wiki-Artikel ohne Landmarke steht als ◐-Zeile
 * „nur Wiki (nicht platziert)“ mit seiner Art; sein Fenster zeigt den Artikel, „● Auf der Karte setzen“ startet das Setzen mit Art und Namen, und „Fertig“ schickt `wikiKandidat` mit.
 * „✕ Nicht auf die Karte“ schreibt die Unterdrückung; ein unterdrückter Kandidat steht zu Beginn nicht in der Liste.
 *
 * Problemfälle: Der Kandidat fehlt in der Liste oder steht unter den Flächen; das Fenster lädt ein Flächen-Detail für ihn (404); das Setzen vergisst den Kandidaten und legt eine
 * „Landmarke-001“ ohne Artikel an; „Nicht auf die Karte“ schickt den falschen Wert.
 */

const KANDIDATEN: EditorLandmarkenKandidat[] = [
    {
        id: "b7000000-0000-4000-8000-000000000001",
        titel: "Drachenhöhle",
        name: "Drachenhöhle",
        art: "hoehle",
        wikiArt: "Höhle",
        region: "Kosch",
        kurzbeschreibung: "Die Drachenhöhle liegt tief im Kosch und war lange der Hort eines Drachen.",
        wikiUrl: "https://de.wiki-aventurica.de/wiki/Drachenh%C3%B6hle",
        revision: 3,
    },
    {
        id: "b7000000-0000-4000-8000-000000000002",
        titel: "Feuerschlund",
        name: "Feuerschlund",
        art: "vulkan",
        wikiArt: "Vulkan",
        height: 3200,
        wikiUrl: "https://de.wiki-aventurica.de/wiki/Feuerschlund",
        revision: 1,
    },
    {
        id: "b7000000-0000-4000-8000-000000000003",
        titel: "Alte Grube",
        name: "Alte Grube",
        art: "krater",
        unterdrueckt: true,
        wikiUrl: "https://de.wiki-aventurica.de/wiki/Alte_Grube",
        revision: 2,
    },
];

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 L7: der Kandidat als ◐-Zeile, sein Fenster, „● Auf der Karte setzen“ mit Artikel und „✕ Nicht auf die Karte“", async ({
    page,
}) => {
    const server = await stub(page);
    const json = (route: Route, body: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    // Die Liste des Stubs, dazu die Kandidaten (die spätere Route gewinnt).
    const liste: EditorLandscapeList = { ...LISTE, kandidaten: KANDIDATEN };
    await page.route("**/api/editor/landscapes", (route) => json(route, liste));
    const unterdrueckt: LandmarkenKandidatUnterdrueckenBody[] = [];
    await page.route(/\/api\/editor\/landmarken-kandidaten\/[0-9a-f-]{36}\/unterdruecken$/, (route) => {
        unterdrueckt.push(route.request().postDataJSON() as LandmarkenKandidatUnterdrueckenBody);
        return json(route, {
            operationId: "op",
            status: "applied",
            environment: "development",
            affected: [{ kind: "landmarke_artikel", id: KANDIDATEN[0]!.id, revision: 4 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 4713,
        });
    });

    const listenFenster = await oeffneListe(page);
    const zeile = listenFenster.getByRole("option", { name: /Drachenhöhle/ });
    await expect(zeile).toContainText("Höhle");
    await expect(zeile).toContainText("nur Wiki (nicht platziert)");
    await expect(zeile).toContainText("Kosch");
    // Zu Beginn steht der unterdrückte nicht da.
    await expect(listenFenster.getByRole("option", { name: /Alte Grube/ })).toHaveCount(0);
    await page.screenshot({ path: "test-results/l7-kandidat-liste.png" });

    await zeile.click();
    const fenster = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-kandidat"]');
    await expect(fenster).toContainText("Drachenhöhle");
    await expect(fenster).toContainText("Dieser Eintrag steht nur im Wiki");
    await expect(fenster.locator('[data-testid$="-kandidat-art"]')).toHaveText("Höhle");
    await expect(fenster.locator('[data-testid$="-kandidat-wiki"]')).toHaveAttribute("href", KANDIDATEN[0]!.wikiUrl);
    await page.screenshot({ path: "test-results/l7-kandidat-fenster.png" });

    await fenster.locator('[data-testid$="-kandidat-unterdruecken"]').click();
    await expect.poll(() => unterdrueckt.length).toBe(1);
    expect(unterdrueckt[0]).toMatchObject({ baseRevision: 3, unterdrueckt: true });

    await fenster.locator('[data-testid$="-kandidat-setzen"]').click();
    const leiste = page.getByTestId("landmarke-setzen-leiste");
    await expect(leiste).toContainText("Drachenhöhle · Höhle");
    await page.screenshot({ path: "test-results/l7-kandidat-setzen.png" });
    await page.getByTestId("landmarke-setzen-leiste-fertig").click();
    await expect.poll(() => server.angelegt.length).toBe(1);
    expect(server.angelegt[0]).toMatchObject({ subtype: "hoehle", wikiKandidat: KANDIDATEN[0]!.id });
});

test("🔴 WI-0284: ein Wiki-Eintrag ohne Fläche als ◐-Zeile, sein Fenster; „● Fläche zeichnen“ schreibt die Fläche mit dem Eintrag", async ({
    page,
}) => {
    await stub(page);
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const eintrag: EditorWikiEintrag = {
        id: "b9000000-0000-4000-8000-000000000001",
        titel: "Frühlingsstrand",
        name: "Frühlingsstrand",
        layer: "topographie",
        type: "insel",
        art: "Insel",
        region: "Blutige See",
        kurzbeschreibung: "Frühlingsstrand ist eine Insel in der Blutigen See.",
        wikiUrl: "https://de.wiki-aventurica.de/wiki/Fr%C3%BChlingsstrand",
    };
    const gesendet: LandscapeCreateBody[] = [];
    await page.route(/\/api\/editor\/landscapes(\?.*)?$/, (route) => {
        if (route.request().method() === "GET") return json(route, 200, { ...LISTE, wikiEintraege: [eintrag] });
        gesendet.push(route.request().postDataJSON() as LandscapeCreateBody);
        return json(route, 422, { error: "stub", message: "Stub schreibt nicht." });
    });

    const listenFenster = await oeffneListe(page);
    const zeile = listenFenster.getByRole("option", { name: /Frühlingsstrand/ });
    await expect(zeile).toContainText("Insel");
    await expect(zeile).toContainText("nur Wiki (nicht platziert)");
    await expect(zeile).toContainText("Blutige See");
    await page.screenshot({ path: "test-results/wi-0284-liste.png" });

    await zeile.click();
    const fenster = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-wiki-eintrag"]');
    await expect(fenster).toContainText("hat noch keine Fläche");
    await expect(fenster.locator('[data-testid$="-wiki-eintrag-wiki"]')).toHaveAttribute("href", eintrag.wikiUrl);
    await page.screenshot({ path: "test-results/wi-0284-fenster.png" });

    await fenster.locator('[data-testid$="-wiki-eintrag-zeichnen"]').click();
    await expect(page.getByTestId("neue-flaeche-leiste")).toBeVisible();
    await settleFrame(page);
    const ecken = [
        { x: KOSCH.x, y: KOSCH.y },
        { x: KOSCH.x + 90, y: KOSCH.y },
        { x: KOSCH.x + 45, y: KOSCH.y + 80 },
    ];
    for (const ecke of ecken) {
        await page.mouse.click(ecke.x, ecke.y);
        await page.waitForTimeout(80);
    }
    await page.mouse.click(ecken[0]!.x, ecken[0]!.y);
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({ layer: "topographie", wikiEintrag: eintrag.id });
});
