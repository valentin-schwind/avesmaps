import { expect, test, type Page } from "@playwright/test";
import type { EditorPlaceSites, EditorSiteCandidates, SiteAddBody } from "@avesmaps3d/shared";
import { FERDOK, GRATENFELS, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Der Reiter „Innerorts“ (WI-0128 E18, WI-0134): drei Gruppen, die man nicht verwechseln darf - belegt, offen genannt, Legacys
 * heutige Anzeige. Was der Server liefert, prüft `apps/server/test/editor-place-sites.test.ts` gegen echtes PostgreSQL; hier
 * steht, dass der Reiter es auch so zeigt und nichts stillschweigend zusammenwirft.
 */

const SITES: EditorPlaceSites = {
    bound: [
        {
            id: "1",
            name: "Nordlandbank",
            sourceKind: "sitz",
            sourceKey: "Nordlandbank\u001f[[Gratenfels]]",
            type: "Bank",
            seat: { role: "hauptsitz", order: 0 },
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Nordlandbank", key: "wiki:nordlandbank" },
            relation: { origin: "gespeichert", placePublicId: GRATENFELS },
        },
    ],
    open: [
        {
            id: "2",
            name: "Saumpfad nach Angbar",
            sourceKind: "weg",
            sourceKey: "wiki:saumpfad",
            type: "Weg",
            rawLocation: "[[Gratenfels]]",
            named: [{ raw: "Gratenfels", key: "wiki:gratenfels", placePublicId: GRATENFELS, placeName: "Gratenfels" }],
        },
    ],
    sichtbar: { count: 9 },
};

async function oeffneReiter(page: Page): Promise<void> {
    await page.route(`**/api/editor/places/${GRATENFELS}/sites`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SITES) }),
    );
    await page.route("**/api/subjects/place/*/staetten*", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ count: 7, groups: [{ type: "Gebaeude", entries: [{ name: "Alte Mühle" }] }] }),
        }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-innerorts"]').click();
}

test("🔴 der Reiter trennt belegt, über die Kette hier und die Zahl des Panels", async ({ page }) => {
    await oeffneReiter(page);
    const belegt = fenster(page).locator('[data-testid$="-innerorts-belegt"]');
    const offen = fenster(page).locator('[data-testid$="-innerorts-offen"]');
    const sichtbar = fenster(page).locator('[data-testid$="-innerorts-sichtbar"]');

    await expect(belegt).toContainText("Belegt (1)");
    // Titel, Art, Quelle, Sitzrolle und Herkunft stehen an der Zeile (E18).
    await expect(belegt).toContainText("Nordlandbank");
    await expect(belegt).toContainText("Bank · Sitz einer Organisation · Hauptsitz · Herkunft: Legacys Kennung");
    await expect(belegt.getByRole("link", { name: "Nordlandbank" })).toHaveAttribute(
        "href",
        "https://de.wiki-aventurica.de/wiki/Nordlandbank",
    );

    // 🔴 Der Weg-Rohkandidat steht über die Kette da, nicht als gespeicherte Beziehung - und sagt, was daran fehlt.
    await expect(offen).toContainText("Über die Kette hier (1)");
    await expect(offen).toContainText("Saumpfad nach Angbar");
    await expect(offen).toContainText("Gespeichert ist die Zuordnung nicht");
    await expect(belegt).not.toContainText("Saumpfad");

    // 🔴 Die Zahl des Panels steht daneben und ist GRÖSSER als beide Listen: Die Wiki-Registry zählt mit, ist aber nicht bindbar.
    await expect(sichtbar).toContainText("Im Infopanel sichtbar: 9");
    await expect(sichtbar).toContainText("nicht binden");
});

test("🔴 ohne Stätten sagen beide Gruppen es einzeln", async ({ page }) => {
    await page.route(`**/api/editor/places/${GRATENFELS}/sites`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ bound: [], open: [], sichtbar: { count: 0 } } satisfies EditorPlaceSites),
        }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-innerorts"]').click();
    await expect(fenster(page).locator('[data-testid$="-innerorts-belegt"]')).toContainText(
        "Keine belegte Innerorts-Beziehung",
    );
    await expect(fenster(page).locator('[data-testid$="-innerorts-offen"]')).toContainText(
        "Keine Stätte nennt diesen Ort zuerst",
    );
});

test("🔴 E10b: „Hierher binden“ und „Lösen“ schicken EINE Operation mit der Kennung der Stätte", async ({ page }) => {
    const gesendet: { siteId: string; weg: string; operationId: string }[] = [];
    let stand: EditorPlaceSites = SITES;
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.route(`**/api/editor/places/${GRATENFELS}/sites/relation`, (route) => {
        const body = route.request().postDataJSON() as { siteId: string; weg: string; operationId: string };
        gesendet.push(body);
        // Der Server antwortet mit der Quittung; danach liest der Reiter neu, und der zweite Stand gilt.
        stand =
            body.weg === "hierher"
                ? { ...SITES, bound: [...SITES.bound, { ...SITES.open[0]!, relation: { origin: "editor" } }], open: [] }
                : { ...SITES, bound: [] };
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "site", id: body.siteId }],
                derivedWork: [],
                warnings: [],
            }),
        });
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/sites`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stand) }),
    );
    await page.route("**/api/subjects/place/*/staetten*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, groups: [] }) }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-innerorts"]').click();

    await fenster(page).locator('[data-testid$="-innerorts-binden"]').click();
    await expect.poll(() => gesendet.length).toBe(1);
    // 🔴 Die Kennung der Stätte, nie ihr Name.
    expect(gesendet[0]).toMatchObject({ siteId: "2", weg: "hierher" });
    expect(gesendet[0]!.operationId).toMatch(/^[0-9a-f-]{36}$/);
    // Der Reiter liest neu: Der Weg steht jetzt unter „Belegt“.
    await expect(fenster(page).locator('[data-testid$="-innerorts-belegt"]')).toContainText("Saumpfad nach Angbar");

    await fenster(page).locator('[data-testid$="-innerorts-loesen"]').first().click();
    await expect.poll(() => gesendet.length).toBe(2);
    expect(gesendet[1]).toMatchObject({ weg: "loesen" });
    expect(gesendet[1]!.operationId).not.toBe(gesendet[0]!.operationId);
});

test("ohne eingeschaltetes Bearbeiten gibt es die Knöpfe nicht", async ({ page }) => {
    await oeffneReiter(page);
    await expect(fenster(page).locator('[data-testid$="-innerorts-binden"]')).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-innerorts-loesen"]')).toHaveCount(0);
});

test("🔴 E10b „Verlagern …“: eine Ortsauswahl ohne den eigenen Ort, dann EINE Operation AM ZIELORT mit der Kennung der Stätte", async ({
    page,
}) => {
    const gesendet: { url: string; body: { siteId: string; weg: string; operationId: string } }[] = [];
    let stand: EditorPlaceSites = SITES;
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.route("**/api/editor/places/*/sites/relation", (route) => {
        const body = route.request().postDataJSON() as { siteId: string; weg: string; operationId: string };
        gesendet.push({ url: new URL(route.request().url()).pathname, body });
        // Nach dem Verlagern fehlt die Stätte hier; der Reiter liest neu.
        stand = { ...SITES, bound: [] };
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "site", id: body.siteId }],
                derivedWork: [],
                warnings: [],
            }),
        });
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/sites`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stand) }),
    );
    await page.route("**/api/subjects/place/*/staetten*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, groups: [] }) }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-innerorts"]').click();

    await fenster(page).locator('[data-testid$="-innerorts-verlagern"]').click();
    const blatt = page.locator('dialog[open][data-testid$="-verlagern"]');
    await expect(blatt).toContainText("Nordlandbank");
    const los = blatt.locator('[data-testid$="-verlagern-los"]');
    await expect(los).toBeDisabled();
    // 🔴 Der eigene Ort steht nicht zur Wahl, ein Wiki-Eintrag ohne Kartenpunkt auch nicht (die Liste der Attrappe hat beide).
    const zeilen = blatt.locator('[data-testid$="-verlagern-zeile"]');
    await expect(zeilen).toHaveText([/^Ferdok/]);
    await zeilen.first().click();
    await los.click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.url).toBe(`/api/editor/places/${FERDOK}/sites/relation`);
    expect(gesendet[0]!.body).toMatchObject({ siteId: "1", weg: "hierher" });
    await expect(blatt).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-innerorts-belegt"]')).not.toContainText("Nordlandbank");
});

test("🔴 WI-0196: „Innerorts hinzufügen“ wählt im Umkreis vor, Handgriffe gelten, „Fertig“ schreibt EINE Operation", async ({
    page,
}) => {
    // Betreiber 2026-10-16: „Hier will man eine Button mit dem man Gebäude/Stätten und Stadtviertel, die noch nicht woanders innerorts
    // sind, hinzufügen können. Zur Vereinfachung der Suche kann man einen "Automatische Auswahl … im Umkreis von N Meilen" mit N = 1
    // default hinzufügen“. Was der Server anbietet und schreibt, prüft `apps/server/test/editor-site-kandidaten.test.ts`.
    const KANDIDATEN: EditorSiteCandidates = {
        candidates: [
            {
                kind: "kartenpunkt",
                id: FERDOK,
                name: "Tempel des Ingerimm",
                type: "Tempel",
                siteClass: "gebaeude",
                meilen: 0.3,
            },
            {
                kind: "staette",
                id: "41",
                name: "Kontor am Markt",
                sourceKind: "punkt",
                siteClass: "stadtviertel",
                meilen: 0.8,
            },
            { kind: "kartenpunkt", id: GRATENFELS, name: "Wachturm", siteClass: "gebaeude", meilen: 6 },
            { kind: "staette", id: "42", name: "Sitz der Händlergilde", sourceKind: "sitz", type: "Gilde" },
        ],
    };
    const gesendet: SiteAddBody[] = [];
    let stand: EditorPlaceSites = { ...SITES, bound: [] };
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.route(`**/api/editor/places/${GRATENFELS}/sites/candidates`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KANDIDATEN) }),
    );
    await page.route(`**/api/editor/places/${GRATENFELS}/sites/add`, (route) => {
        const body = route.request().postDataJSON() as SiteAddBody;
        gesendet.push(body);
        stand = { ...SITES, bound: [{ ...SITES.bound[0]!, id: "41", name: "Kontor am Markt" }] };
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "place", id: GRATENFELS, revision: 7 }],
                derivedWork: [],
                warnings: [],
            }),
        });
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/sites`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stand) }),
    );
    await page.route("**/api/subjects/place/*/staetten*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, groups: [] }) }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-innerorts"]').click();

    await fenster(page).locator('[data-testid$="-innerorts-hinzu-oeffnen"]').click();
    const blatt = page.locator('[data-testid$="-innerorts-hinzu"]');
    await expect(blatt).toContainText("Innerorts hinzufügen");
    const zahl = page.locator('[data-testid$="-innerorts-hinzu-zahl"]');
    const haken = (schluessel: string) =>
        page.locator(`[data-testid$="-innerorts-hinzu-zeile"][data-kandidat="${schluessel}"] input`);
    // Vorgabe 1 Meile: Tempel und Kontor sind vorgewählt, der Turm (6 Meilen) und der Sitz (ohne Lage) nicht.
    await expect(zahl).toHaveText("Gewählt: 2");
    await expect(haken(`kartenpunkt:${FERDOK}`)).toBeChecked();
    await expect(haken("staette:41")).toBeChecked();
    await expect(haken(`kartenpunkt:${GRATENFELS}`)).not.toBeChecked();
    await expect(page.locator('[data-testid$="-innerorts-hinzu-zeile"]').first()).toContainText("0,3 Meilen");

    // Ein größerer Umkreis wählt den Turm dazu; ein Haken von Hand nimmt den Tempel heraus und bleibt draußen.
    await page.locator('[data-testid$="-innerorts-hinzu-umkreis"]').fill("10");
    await expect(zahl).toHaveText("Gewählt: 3");
    await haken(`kartenpunkt:${FERDOK}`).uncheck();
    await page.locator('[data-testid$="-innerorts-hinzu-umkreis"]').fill("1");
    await expect(zahl).toHaveText("Gewählt: 1");
    // Was keine Lage hat, findet die Suche.
    await page.locator('[data-testid$="-innerorts-hinzu-suche"] input').fill("gilde");
    await haken("staette:42").check();
    await expect(zahl).toHaveText("Gewählt: 2");

    await page.locator('[data-testid$="-innerorts-hinzu-fertig"]').click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({ sites: ["41", "42"], places: [] });
    expect(gesendet[0]!.operationId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(blatt).toBeHidden();
    // Der Reiter liest neu.
    await expect(fenster(page).locator('[data-testid$="-innerorts-belegt"]')).toContainText("Kontor am Markt");
});
