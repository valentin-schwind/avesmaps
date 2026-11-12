import { expect, test, type Locator, type Page } from "@playwright/test";
import type { EditorPlaceDetail, PlaceDeleteManyBody, PlaceRemoval, PlaceSammelBody } from "@avesmaps3d/shared";
import {
    FERDOK,
    FERDOK_LAGE,
    GRATENFELS,
    GRATENFELS_LAGE,
    fenster,
    oeffneOrtseditor,
    zeile,
} from "./ortseditor-stub.ts";

/**
 * Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57; Vorlage Fassung 5 der Gebiete). 🔴 Kein Test schreibt in die Datenbank der
 * Entwicklung: Orte, Vorschau des Entfernens und die beiden Sammelwege (`place.sammel`, `place.delete` für mehrere) kommen aus einem Stub;
 * den echten Schreibweg prüft `apps/server/test/place-sammel.test.ts` im Wegwerf-Cluster.
 *
 * Problemfälle: Die Liste hat keinen Umschalter oder ein Klick öffnet trotz Häkchen den Ort; die Eigenschaften zeigen nur einen Ort statt
 * „gemischt“; ein Feld, das nur einzeln geht, ist schreibbar; ↺ gilt nur einem Ort oder schreibt sofort statt mit „Speichern“; „Speichern“
 * schickt je Ort eine Operation; „Entfernen …“ löscht ohne Rückfrage oder trotz einer Kraftlinie an einem der Orte.
 */

function ort(publicId: string, revision: number, ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId,
        revision,
        name: publicId === GRATENFELS ? "Gratenfels" : "Ferdok",
        subtype: "stadt",
        kind: null,
        position: publicId === GRATENFELS ? GRATENFELS_LAGE : FERDOK_LAGE,
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: null },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: `https://de.wiki-aventurica.de/wiki/${publicId}`, title: "Ort", state: "assigned" },
        pathEnds: [],
        ...ueber,
    };
}

const DETAILS: Record<string, EditorPlaceDetail> = {
    // Gratenfels mit eigenem Einwohnerwert, Ferdok ganz auf dem Wiki.
    [GRATENFELS]: ort(GRATENFELS, 7, {
        fields: {
            description: { value: null, origin: null, wiki: null },
            einwohner: { value: "2.500", origin: "manual", wiki: "2.200" },
            lage: { value: null, origin: null, wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
    }),
    [FERDOK]: ort(FERDOK, 4),
};

const vorschau = (publicId: string, ueber: Partial<PlaceRemoval> = {}): PlaceRemoval => ({
    publicId,
    name: DETAILS[publicId]!.name,
    revision: DETAILS[publicId]!.revision,
    onMap: true,
    subtype: "stadt",
    staetten: [],
    wegenden: [],
    gebiete: [],
    kraftlinien: [],
    bleibt: { wiki: true, bilder: 0, quellen: 0, stadtplaene: 0, abenteuer: 0, bewertungen: 0 },
    ...ueber,
});

const QUITTUNG = {
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    mapRevision: 901,
};

interface Server {
    sammel: PlaceSammelBody[];
    loeschen: PlaceDeleteManyBody[];
}

async function oeffne(page: Page, kraftlinieAnFerdok: boolean): Promise<Server> {
    const server: Server = { sammel: [], loeschen: [] };
    const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    for (const id of [GRATENFELS, FERDOK]) {
        await page.route(`**/api/editor/places/${id}`, (route) => route.fulfill(json(DETAILS[id])));
        await page.route(`**/api/editor/places/${id}/removal`, (route) =>
            route.fulfill(
                json(
                    vorschau(
                        id,
                        id === FERDOK && kraftlinieAnFerdok
                            ? { kraftlinien: [{ name: "Ader am Großen Fluss" }] }
                            : id === GRATENFELS
                              ? { staetten: [{ name: "Albenhuser Tor" }], wegenden: ["Reichsstraße"] }
                              : {},
                    ),
                ),
            ),
        );
    }
    await page.route("**/api/editor/places/sammel", (route) => {
        server.sammel.push(route.request().postDataJSON() as PlaceSammelBody);
        return route.fulfill(json(QUITTUNG));
    });
    await page.route("**/api/editor/places/sammel/delete", (route) => {
        server.loeschen.push(route.request().postDataJSON() as PlaceDeleteManyBody);
        return route.fulfill(json(QUITTUNG));
    });
    await oeffneOrtseditor(page);
    await fenster(page).locator('[data-testid$="-orte-mehrfach"]').click();
    await zeile(page, "Gratenfels").click();
    await zeile(page, "Ferdok").click();
    return server;
}

const sammel = (page: Page) => fenster(page).locator('[data-testid$="-sammel"]').first();
const status = (page: Page) => fenster(page).locator('[data-testid$="-status"]');

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 zwei Orte angehakt: „gemischt“ und „Nur einzeln“, ↺ für alle als Schritt, „Speichern“ schreibt EINE Operation", async ({
    page,
}) => {
    const server = await oeffne(page, false);
    await expect(sammel(page)).toBeVisible();
    await expect(fenster(page).locator('[data-testid$="-sammel-zahl"]')).toHaveText("2 Orte gewählt");
    // Nur „Eigenschaften“ geht; die übrigen Reiter sind grau.
    await expect(sammel(page).getByRole("tab", { name: "Verlauf" })).toHaveAttribute("aria-disabled", "true");
    // Der Name ist verschieden: gemischt, und er geht nur einzeln.
    const name = fenster(page).locator('[data-testid$="-sammel-feld-name"]').locator("input").first();
    await expect(name).toHaveAttribute("placeholder", "gemischt");
    await expect(name).toBeDisabled();
    await expect(fenster(page).locator('[data-testid$="-sammel-hinweis-name"]')).toHaveText("Nur einzeln");
    // Lage ist für beide gleich (Wiki) und hat keinen eigenen Wert: der Wert steht da, ↺ gesperrt; Einwohner hat einen.
    await expect(fenster(page).locator('[data-testid$="-sammel-feld-lage"]').locator("input").first()).toHaveValue(
        "Kosch",
    );
    await expect(fenster(page).locator('[data-testid$="-sammel-wiki-lage"]')).toBeDisabled();
    const einwohner = fenster(page).locator('[data-testid$="-sammel-wiki-einwohner"]');
    await expect(einwohner).toHaveAttribute("title", "Für alle 2 auf den Wiki-Wert (1 mit eigenem Wert)");
    await page.screenshot({ path: "test-results/wi0237-mehrfach-1920.png" });

    await einwohner.click();
    await expect(fenster(page).locator('[data-testid$="-sammel-hinweis-einwohner"]')).toHaveText(
        "auf Wiki-Werte, gilt für alle 2",
    );
    await expect(status(page)).toHaveText("Ungespeichert: Einwohner auf Wiki-Werte, für alle 2.");
    expect(server.sammel).toEqual([]);
    await fenster(page).locator('[data-testid$="-speichern"]').click();
    await expect.poll(() => server.sammel.length).toBe(1);
    expect(server.sammel[0]).toEqual({
        operationId: expect.any(String),
        orte: [
            { id: GRATENFELS, baseRevision: 7 },
            { id: FERDOK, baseRevision: 4 },
        ],
        wiki: ["einwohner"],
    });
    await expect(status(page)).toHaveText("Für alle 2 gespeichert.");
});

test("🔴 „Entfernen …“ für alle: gesperrt mit dem Namen des Orts an der Kraftlinie; „Von der Karte nehmen“ nur einzeln", async ({
    page,
}) => {
    const server = await oeffne(page, true);
    await fenster(page).locator('[data-testid$="-sammel-entfernen"]').click();
    const blatt = fenster(page).locator('[data-testid$="-sammel-entfernen-blatt"]');
    await expect(blatt).toContainText("2 Orte ganz löschen? Mit ↺ wieder herstellbar.");
    await expect(blatt.locator('[data-testid$="-sammel-entfernen-sperre"]')).toHaveText(
        "„Ferdok“: Am Ort endet eine Kraftlinie; erst die Kraftlinie lösen.",
    );
    await expect(blatt.getByRole("button", { name: "2 Orte löschen" })).toBeDisabled();
    await expect(blatt.getByRole("radio", { name: /Von der Karte nehmen/ })).toBeDisabled();
    expect(server.loeschen).toEqual([]);
});

test("🔴 „Entfernen …“ für alle: nennt die Folgen, löscht nach der Rückfrage als EINE Operation und löst die Haken", async ({
    page,
}) => {
    const server = await oeffne(page, false);
    await fenster(page).locator('[data-testid$="-sammel-entfernen"]').click();
    const blatt = fenster(page).locator('[data-testid$="-sammel-entfernen-blatt"]');
    const folgen = blatt.locator('[data-testid$="-sammel-entfernen-folgen"]');
    await expect(folgen).toContainText("1 Stätte geht mit, umkehrbar.");
    await expect(folgen).toContainText("1 Wegende bleibt liegen");
    await page.screenshot({ path: "test-results/wi0237-mehrfach-entfernen-1920.png" });
    await blatt.getByRole("button", { name: "2 Orte löschen" }).click();
    await expect.poll(() => server.loeschen.length).toBe(1);
    expect(server.loeschen[0]).toEqual({
        operationId: expect.any(String),
        orte: [
            { id: GRATENFELS, baseRevision: 7 },
            { id: FERDOK, baseRevision: 4 },
        ],
    });
    await expect(status(page)).toHaveText("2 Orte gelöscht; ↺ unter „Änderungen“.");
    await expect(sammel(page)).toHaveCount(0);
});

test("Sichtprüfung 1280: die Sammelansicht bleibt im Fenster", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await oeffne(page, false);
    await expect(sammel(page)).toBeVisible();
    await page.screenshot({ path: "test-results/wi0237-mehrfach-1280.png" });
});

/** Steht in einem Eingabefeld des Bereichs dieser Wert? (Ein Eingabefeld trägt seinen Wert nicht als Text.) */
const hatWert = (bereich: Locator, wert: string): Promise<boolean> =>
    bereich
        .locator("input")
        .evaluateAll((felder, w) => felder.some((feld) => (feld as HTMLInputElement).value === w), wert);

test("🔴 Regel 7: zwei angehakt, eins abgehakt: das Fenster zeigt das verbliebene wie einzeln gewählt, die Mehrfachauswahl bleibt an", async ({
    page,
}) => {
    await oeffne(page, false);
    await expect(sammel(page)).toBeVisible();
    await zeile(page, "Gratenfels").click();
    await expect(sammel(page)).toBeHidden();
    await expect(fenster(page)).not.toContainText("Noch kein Ort offen");
    await expect.poll(() => hatWert(fenster(page), "Ferdok")).toBe(true);
    await expect(fenster(page).locator('[data-testid$="-orte-mehrfach"]')).toHaveAttribute("aria-pressed", "true");
    // Ein zweites Häkchen bringt die Sammelansicht wieder, im selben Fenster.
    await zeile(page, "Gratenfels").click();
    await expect(sammel(page)).toBeVisible();
});
