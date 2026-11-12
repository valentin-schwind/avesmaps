import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorPlaceDetail, PlaceRemoval, PlaceUpdateBody } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS, GRATENFELS_LAGE, LISTE, editorPanelGemerktZu, fenster } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Handgriffe am Ort (WI-0128 E15; EDIT-0001 D7, D16, D20, §7.1 E15): die Gruppe „Bearbeiten · nur Editoren“ im Infopanel, das
 * Kontextmenü am Ort und das Menü am Objekt. 🔴 Kein Test schreibt in die Datenbank der Entwicklung (W15): Lesen und Schreiben des Orts
 * und der Stand des Bearbeitens kommen aus Stubs.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const ALLE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

async function vorbereiten(page: Page, rechte: string[]): Promise<PlaceUpdateBody[]> {
    const gesendet: PlaceUpdateBody[] = [];
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, { capabilities: rechte, role: "editor" });
    // Die Handgriffe stehen im Infopanel; das seit `dd9f7476` beim Laden offene Editorpanel stünde davor.
    await editorPanelGemerktZu(page);
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/places", (route) => json(route, 200, LISTE));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) => {
        if (route.request().method() === "PATCH") {
            gesendet.push(route.request().postDataJSON() as PlaceUpdateBody);
            return json(route, 200, {
                operationId: "00000000-0000-4000-8000-000000000001",
                status: "applied",
                environment: "development",
                affected: [{ kind: "place", id: GRATENFELS, revision: 8 }],
                derivedWork: [{ kind: "tiles", state: "done" }],
                warnings: [],
                mapRevision: 60,
            });
        }
        return json(route, 200, {
            publicId: GRATENFELS,
            name: "Gratenfels",
            revision: 7,
        } as Partial<EditorPlaceDetail>);
    });
    await openMap(page, EDITOR_MODE);
    await showPlace(page, GRATENFELS_LAGE, 7);
    return gesendet;
}

/** Wo Gratenfels im Fenster liegt. */
const gratenfels = (page: Page): Promise<{ x: number; y: number }> =>
    page.evaluate((lage) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(lage));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, GRATENFELS_LAGE);

const gruppe = (page: Page) => page.getByTestId("handgriff-gruppe");

test("🔴 E15 im Infopanel eines Orts: Bearbeiten · nur Editoren; Neuer Weg später, EIN „Ort entfernen“ (E22); ⚙ Bearbeiten öffnet den Ort im Ortseditor", async ({
    page,
}) => {
    await vorbereiten(page, ALLE);
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    await expect(gruppe(page)).toContainText("nur Editoren");
    // Die Folge an jedem Objekt (EDIT-0003 G10): Bearbeiten · Form · Sichtbarkeit · Neues von hier aus · Entfernen.
    await expect(gruppe(page).getByRole("button")).toHaveText([
        /Eigenschaften bearbeiten/,
        /Ort verschieben/,
        /Verbergen/,
        /Neue Kraftlinie/,
        /Neuer Weg ab hier/,
        /Ort entfernen/,
    ]);
    // „Neuer Weg ab hier“ gehört dem Weg (WI-0177) und geht mit beiden Schreibrechten.
    await expect(page.getByTestId("griff-weg-neu")).toBeEnabled();
    await expect(page.getByTestId("griff-ort-entfernen")).toBeEnabled();
    await expect(page.getByTestId("griff-ort-entfernen")).toContainText("Ort entfernen");
    await expect(page.getByTestId("griff-ort-loeschen")).toHaveCount(0);
    await expect(page.getByTestId("griff-ort-verschieben")).toBeEnabled();
    // Das Menü am Objekt hat dieselben Handgriffe, die gehen (EDIT-0001 §7.1 E15).
    await expect(page.getByTestId("editor-action-ort-verschieben")).toBeVisible();
    await expect(page.getByTestId("editor-action-ort-verbergen")).toBeVisible();

    await page.getByTestId("griff-ort-bearbeiten").click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
});

test("🔴 ◌ Verbergen schreibt sofort place.update { hidden: true } auf die gelesene Revision und meldet es", async ({
    page,
}) => {
    const gesendet = await vorbereiten(page, ALLE);
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    await page.getByTestId("griff-ort-verbergen").click();
    await expect(page.getByTestId("toast")).toContainText("Gratenfels ist verborgen (Revision 8).");
    expect(gesendet).toEqual([{ operationId: expect.any(String), baseRevision: 7, changes: { hidden: true } }]);
});

test("🔴 ohne Schreibrecht: ⚙ Ansehen, der Satz „Nur lesen“; das Kontextmenü am Ort trägt den Abschnitt, gesperrt mit Grund", async ({
    page,
}) => {
    await vorbereiten(page, ["use_editor_menu"]);
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    await expect(page.getByTestId("griff-ort-bearbeiten")).toContainText("Ansehen");
    await expect(page.getByTestId("handgriff-gruppe-nur-lesen")).toBeVisible();
    await expect(page.getByTestId("griff-ort-verbergen")).toContainText("ohne Recht");

    await page.keyboard.press("Escape");
    await page.mouse.click(at.x, at.y, { button: "right" });
    await expect(page.getByTestId("context-editor")).toContainText("nur Editoren");
    await expect(page.getByTestId("context-editor-ort-bearbeiten")).toBeEnabled();
    await expect(page.getByTestId("context-editor-ort-verschieben")).toBeDisabled();
    // „Anlegen · Hier hinzufügen ›“ steht in jedem Kartenmenü, am Ort unter dessen Abschnitt (EDIT-0002 §4.6).
    await expect(page.getByTestId("context-editor-kopf-anlegen")).toBeVisible();
    await expect(page.getByTestId("context-editor-hier-hinzufuegen")).toBeVisible();
    // Zwei Karten (EDIT-0003 R7, T27 (4); WI-0178 A4): die der Editoren 6 px über dem Punkt, die der Besucher 6 px darunter.
    const oben = (await page.getByTestId("context-editor").boundingBox())!;
    const unten = (await page.getByTestId("map-context-menu").boundingBox())!;
    expect(Math.round(oben.y + oben.height)).toBe(Math.round(at.y - 6));
    expect(Math.round(unten.y)).toBe(Math.round(at.y + 6));
    expect(Math.round(oben.x)).toBe(Math.round(unten.x));
    await expect(page.getByTestId("context-editor-ort-bearbeiten")).toBeFocused();
    // Keine zweite Karte an anderer Stelle (T25): Das Menü am Objekt, das der Klick geöffnet hätte, bleibt zu.
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    await page.screenshot({
        path: "test-results/a4-zwei-karten.png",
        clip: { x: at.x - 60, y: at.y - 260, width: 420, height: 560 },
    });
});

test("🔴 nach dem Verbergen bietet das Menü am Objekt „Zurückholen“, danach wieder „Verbergen“ (Betreiber 2026-10-11)", async ({
    page,
}) => {
    // Der Betreiber: „nach dem verbergen fehlt "zurückholen"“. Das Infopanel las den Ort nach dem Verbergen nicht neu, das Menü am Objekt
    // blieb beim alten Stand. Der Stub merkt sich, was gesendet wurde, und antwortet im Detail des Infopanels mit diesem Stand.
    let verborgen = false;
    const gesendet = await vorbereiten(page, ALLE);
    await page.route(`**/api/subjects/place/${GRATENFELS}*`, async (route) => {
        const antwort = await route.fetch();
        const detail = (await antwort.json()) as Record<string, unknown>;
        if (verborgen) detail["hidden"] = true;
        else delete detail["hidden"];
        await route.fulfill({ response: antwort, json: detail });
    });
    page.on("request", (request) => {
        if (request.method() !== "PATCH" || !request.url().endsWith(GRATENFELS)) return;
        verborgen = (request.postDataJSON() as PlaceUpdateBody).changes.hidden === true;
    });
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    await expect(page.getByTestId("editor-action-ort-verbergen")).toBeVisible();
    await expect(page.getByTestId("editor-action-ort-zeigen")).toHaveCount(0);

    await page.getByTestId("editor-action-ort-verbergen").click();
    await expect(page.getByTestId("toast")).toContainText("Gratenfels ist verborgen");
    // Das Menü am Objekt geht wieder auf (Klick auf den Ort) und kennt den neuen Stand.
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("editor-action-ort-zeigen")).toHaveText(/Zurückholen/);
    await expect(page.getByTestId("editor-action-ort-verbergen")).toHaveCount(0);

    await page.getByTestId("editor-action-ort-zeigen").click();
    await expect(page.getByTestId("toast")).toContainText("zurückgeholt");
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("editor-action-ort-verbergen")).toBeVisible();
    expect(gesendet.map((body) => body.changes)).toEqual([{ hidden: true }, { hidden: false }]);
    // Das Infopanel liest danach noch einmal nach; die Frage darf das Testende überleben.
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("🔴 hinter einem Zwischenspeicher wie Nginx: Verbergen, dann steht „Zurückholen“ da, danach ist der Ort samt Namen zurück (EDIT-0003 T35 (1))", async ({
    page,
}) => {
    // Sollverhalten, Betreiber 2026-10-16 wörtlich: „Also man will Verbergen -> Verbirgt, dann muss Zurückholen dranstehen -> und es kommt
    // zurück, ganz einfach“.
    // Betreiber 2026-10-16 auf der Stage: „Bei Ort verbergen verschwindet das Label des Ort, aber ein erneuter klick zeigt es nicht
    // wieder an“; beim nächsten Klick bot das Menü wieder „Verbergen“. Nginx hält `public, max-age=60` für ALLE Angemeldeten
    // (`ops/deploy/staging-deploy.sh`), auch das Nachlesen nach der Änderung. 🪤 Playwright schaltet mit `route` den Speicher des Browsers
    // ab; darum steht der Zwischenspeicher hier nach: Er hält jede öffentliche Antwort, eine mit `editor=true` nie - der Server antwortet
    // einem Editor dann `private, no-store` (`apps/server/test/subjects-editor-cache.test.ts`), und das speichert Nginx nicht.
    let verborgen = false;
    const gesendet = await vorbereiten(page, ALLE);
    // Wie der Server hebt jede Operation die Kartenrevision; mit ihr laden die Kacheln der Orte neu, und daran hängt der Name
    // (`place_render` liest `is_hidden` live, `NAMED_PLACE` in `place-layers.ts`). Die Kacheln selbst schreibt hier niemand um (W15).
    let kartenRevision = 60;
    await page.route(`**/api/editor/places/${GRATENFELS}`, async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        gesendet.push(route.request().postDataJSON() as PlaceUpdateBody);
        kartenRevision += 1;
        return route.fulfill({
            json: {
                operationId: "00000000-0000-4000-8000-000000000001",
                status: "applied",
                environment: "development",
                affected: [{ kind: "place", id: GRATENFELS, revision: 7 + gesendet.length }],
                derivedWork: [{ kind: "tiles", state: "done" }],
                warnings: [],
                mapRevision: kartenRevision,
            },
        });
    });
    const kachelnMit = (revision: number) =>
        page.waitForRequest((request) =>
            new RegExp(`/tiles/vector/place_tile/.*\\?r=${String(revision)}$`, "u").test(request.url()),
        );
    const zwischenspeicher = new Map<string, Record<string, unknown>>();
    await page.route(`**/api/subjects/place/${GRATENFELS}*`, async (route) => {
        const url = route.request().url();
        const gehalten = zwischenspeicher.get(url);
        if (gehalten !== undefined) return route.fulfill({ json: gehalten });
        const antwort = await route.fetch();
        const detail = (await antwort.json()) as Record<string, unknown>;
        if (verborgen) detail["hidden"] = true;
        else delete detail["hidden"];
        if (!new URL(url).searchParams.has("editor")) zwischenspeicher.set(url, detail);
        return route.fulfill({ response: antwort, json: detail });
    });
    page.on("request", (request) => {
        if (request.method() !== "PATCH" || !request.url().endsWith(GRATENFELS)) return;
        verborgen = (request.postDataJSON() as PlaceUpdateBody).changes.hidden === true;
    });
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    const verborgenGeladen = kachelnMit(61);
    await page.getByTestId("editor-action-ort-verbergen").click();
    await expect(page.getByTestId("toast")).toContainText("Gratenfels ist verborgen");
    await verborgenGeladen;
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("editor-action-ort-zeigen")).toHaveText(/Zurückholen/);
    await expect(page.getByTestId("editor-action-ort-verbergen")).toHaveCount(0);
    const zurueckGeladen = kachelnMit(62);
    await page.getByTestId("editor-action-ort-zeigen").click();
    await expect(page.getByTestId("toast")).toContainText("zurückgeholt");
    await zurueckGeladen;
    expect(gesendet.map((body) => body.changes)).toEqual([{ hidden: true }, { hidden: false }]);
    // Der Ort steht danach samt Namen auf der Karte, und das Menü bietet wieder „Verbergen“.
    await settleFrame(page);
    const benannt = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const namen = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("place-") && id.includes("label"));
        return map
            .queryRenderedFeatures({ layers: namen })
            .some((feature) => feature.properties["name"] === "Gratenfels");
    });
    expect(benannt).toBe(true);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("editor-action-ort-verbergen")).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("🔴 E22 „Ort entfernen“ aus dem Menü am Objekt: das Blatt mittig über der Karte, erst eine Wahl, dann EINE Operation auf die gelesene Revision, mit Stätten „bleiben“ (Betreiber 2026-10-12)", async ({
    page,
}) => {
    await vorbereiten(page, ALLE);
    const vorschau: PlaceRemoval = {
        publicId: GRATENFELS,
        name: "Gratenfels",
        revision: 7,
        onMap: true,
        subtype: "stadt",
        staetten: [{ name: "Praios-Tempel in Gratenfels", art: "Tempel" }],
        wegenden: ["Reichsstraße 3"],
        gebiete: [{ name: "Grafschaft Gratenfels", rolle: "hauptstadt" }],
        kraftlinien: [],
        bleibt: { wiki: true, bilder: 2, quellen: 5, stadtplaene: 0, abenteuer: 0, bewertungen: 0 },
    };
    await page.route(`**/api/editor/places/${GRATENFELS}/removal`, (route) => route.fulfill({ json: vorschau }));
    const gesendet: unknown[] = [];
    await page.route(`**/api/editor/places/${GRATENFELS}/take-off-map`, (route) => {
        gesendet.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "00000000-0000-4000-8000-000000000002",
                status: "applied",
                environment: "development",
                affected: [{ kind: "place", id: GRATENFELS, revision: 8 }],
                derivedWork: [{ kind: "routing", state: "pending" }],
                warnings: [],
                mapRevision: 61,
            }),
        });
    });
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    await page.getByTestId("editor-action-ort-entfernen").click();

    const blatt = page.getByTestId("ort-entfernen");
    await expect(blatt).toBeVisible();
    await expect(blatt).toContainText("Gratenfels");
    // Mittig über der Karte (Blatt, Empfehlung „mittig, nicht am Ortseditor“).
    const box = (await blatt.boundingBox())!;
    const breite = page.viewportSize()!.width;
    expect(Math.abs(box.x + box.width / 2 - breite / 2)).toBeLessThan(24);
    // Stätten, Gebiet, Wegenden stehen da.
    await expect(page.getByTestId("ort-entfernen-namen")).toHaveText("Praios-Tempel in Gratenfels");
    await expect(page.getByTestId("ort-entfernen-folgen")).toContainText("Grafschaft Gratenfels");
    await expect(page.getByTestId("ort-entfernen-folgen")).toContainText("Reichsstraße 3");
    // „Stätte werden“ heißt, den Ort aus seiner Stadt zu lösen; das ist eine eigene Operation und wartet auf E10b.
    await expect(page.getByTestId("ort-entfernen-staette")).toBeDisabled();
    // 🔴 „Ganz löschen“ geht seit E22 G2 auch mit Stätten: Sie gehen umkehrbar mit, ↺ holt sie zurück.
    await expect(page.getByTestId("ort-entfernen-loeschen")).toBeEnabled();
    await expect(page.getByTestId("ort-entfernen-staetten-bleiben")).toBeChecked();

    // Erst eine Wahl: bis dahin gesperrt, dann trägt der Knopf die Handlung. Nichts geschrieben bis zum Klick.
    const los = page.getByTestId("ort-entfernen-los");
    await expect(los).toBeDisabled();
    await page.getByTestId("ort-entfernen-abnehmen").check();
    await expect(los).toBeEnabled();
    await expect(los).toHaveText("Von der Karte nehmen");
    expect(gesendet).toEqual([]);
    await los.click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toEqual({ operationId: expect.any(String), baseRevision: 7, staetten: "bleiben" });
    await expect(blatt).toBeHidden();
    await expect(page.getByText("Gratenfels steht jetzt unter „Nicht auf der Karte“.")).toBeVisible();
    // Das Infopanel liest danach noch einmal nach; das darf das Testende überleben.
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("🔴 E22 eine Kraftlinie am Ort sperrt im Blatt jede Wahl; der Satz steht oben, der Knopf bleibt gesperrt", async ({
    page,
}) => {
    await vorbereiten(page, ALLE);
    await page.route(`**/api/editor/places/${GRATENFELS}/removal`, (route) =>
        route.fulfill({
            json: {
                publicId: GRATENFELS,
                name: "Gratenfels",
                revision: 7,
                onMap: true,
                subtype: "stadt",
                staetten: [],
                wegenden: [],
                gebiete: [],
                kraftlinien: [{ name: "Hexenband", gegenueber: "Arras de Mott" }],
                bleibt: { wiki: false, bilder: 0, quellen: 0, stadtplaene: 0, abenteuer: 0, bewertungen: 0 },
            } satisfies PlaceRemoval,
        }),
    );
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await page.getByTestId("griff-ort-entfernen").click();
    await expect(page.getByTestId("ort-entfernen-sperre")).toContainText("Am Ort endet die Kraftlinie Hexenband.");
    for (const weg of ["abnehmen", "staette", "loeschen"])
        await expect(page.getByTestId(`ort-entfernen-${weg}`)).toBeDisabled();
    await expect(page.getByTestId("ort-entfernen-los")).toBeDisabled();
    await page.getByTestId("ort-entfernen-abbrechen").click();
    await expect(page.getByTestId("ort-entfernen")).toBeHidden();
});

/** Gratenfels als Bauwerk: Die Antwort des Infopanels sagt die Ortsart in der Unterzeile. */
async function alsBauwerk(page: Page): Promise<void> {
    await page.route("**/api/subjects/**", async (route) => {
        const antwort = await route.fetch();
        const koerper = (await antwort.json()) as { subtitle?: { part: string; key?: string }[] };
        if (koerper.subtitle !== undefined)
            koerper.subtitle = koerper.subtitle.map((teil) =>
                teil.part === "type" ? { ...teil, key: "gebaeude" } : teil,
            );
        await route.fulfill({ response: antwort, json: koerper });
    });
}

test("🔴 WI-0271 L8 „In Landmarke umwandeln …“: Griff am Bauwerk, die Rückfrage, EINE Operation, dann das Fenster der Landmarke", async ({
    page,
}) => {
    await vorbereiten(page, ALLE);
    await alsBauwerk(page);
    const vorschau: PlaceRemoval = {
        publicId: GRATENFELS,
        name: "Gratenfels",
        revision: 7,
        onMap: true,
        subtype: "gebaeude",
        staetten: [],
        wegenden: ["Reichsstraße 3"],
        gebiete: [],
        kraftlinien: [],
        bleibt: { wiki: true, bilder: 0, quellen: 2, stadtplaene: 0, abenteuer: 0, bewertungen: 0 },
    };
    await page.route(`**/api/editor/places/${GRATENFELS}/removal`, (route) => route.fulfill({ json: vorschau }));
    const gesendet: unknown[] = [];
    await page.route(`**/api/editor/places/${GRATENFELS}/in-landmarke`, (route) => {
        gesendet.push(route.request().postDataJSON());
        return route.fulfill({
            json: {
                operationId: "00000000-0000-4000-8000-000000000002",
                status: "applied",
                environment: "development",
                affected: [{ kind: "place", id: GRATENFELS, revision: 8 }],
                derivedWork: [{ kind: "routing", state: "pending" }],
                warnings: [],
                mapRevision: 61,
                peakId: "c8c8c8c8-0271-4008-8000-000000000001",
                name: "Gratenfels",
                subtype: "hoehle",
            },
        });
    });
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    await page.getByTestId("editor-action-ort-umwandeln").click();
    const blatt = page.getByTestId("ort-umwandeln");
    await expect(blatt).toBeVisible();
    await expect(blatt).toContainText("Gratenfels in eine Landmarke umwandeln?");
    await page.screenshot({ path: "test-results/l8-rueckfrage.png" });
    expect(gesendet).toEqual([]);
    await blatt.getByRole("button", { name: "Umwandeln" }).click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toEqual({ operationId: expect.any(String), baseRevision: 7 });
    await expect(blatt).toBeHidden();
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("🔴 WI-0271 L8 vor dem Cutoff: Der Griff steht gesperrt mit Grund da, nichts geht auf", async ({ page }) => {
    await vorbereiten(page, ALLE);
    await alsBauwerk(page);
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({ json: { mapEditing: "testwelt", environment: "production", umwandelnFrei: false } }),
    );
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showPlace(page, GRATENFELS_LAGE, 7);
    const at = await gratenfels(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gratenfels");
    // Im Infopanel gesperrt mit Grund; das Menü am Objekt zeigt nur, was gerade geht (WI-0063 4.2).
    await expect(gruppe(page).getByRole("button", { name: /In Landmarke umwandeln/u })).toBeDisabled();
    await expect(page.getByTestId("editor-action-ort-umwandeln")).toHaveCount(0);
    await expect(page.getByTestId("ort-umwandeln")).toBeHidden();
    await page.unrouteAll({ behavior: "ignoreErrors" });
});
