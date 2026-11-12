import { expect, test, type Locator, type Page } from "@playwright/test";
import { SUBJECT_API_BASE, SUBJECT_WETTER_SYMBOL_PFAD, WETTER_SYMBOL_VORGABEN } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";
import { wetterSymbolDetail, zuIcon } from "./wetter-infopanel-stub.ts";
import { WETTER_WIKI_PROBE, iconAufFreieStelle, stubWetter, type WetterServer } from "./wetter-stub.ts";

/**
 * Der Wetter-Editor (WI-0288 Stufe 3; Probierseite `review/wetter-editor/`, Idee A und B), nur in PC-Größe (Betreiber 2026-11-07: „wir
 * können ja mal nur PC groß machen“). 🔴 Kein Test schreibt in eine Datenbank: Die Wege des Wetters kommen aus einem Nachbau im Browser
 * (`wetter-stub.ts`); den echten Weg prüft `apps/server/test/wetter.test.ts` auf einem Wegwerf-Cluster.
 *
 * Problemfälle: Die Kachel fehlt oder öffnet einen anderen Editor; die Liste stellt Icons vor die Presets; ein Wert braucht einen Knopf oder
 * geht ohne `baseRevision`; „Unbestimmt“ tauscht ohne Nachfrage; ein neues Icon steht nicht auf der Karte, lässt sich nicht ziehen oder nicht
 * entfernen; ein Konflikt bleibt still.
 */

test.use({ viewport: { width: 1600, height: 900 } });

const ERSTES = WETTER_SYMBOL_VORGABEN[0]!;

async function oeffneWettereditor(
    page: Page,
    verweise?: Readonly<Record<string, string>>,
): Promise<{ server: WetterServer; fenster: Locator }> {
    // 🔴 Nichts Schreibendes erreicht den geteilten Server (Besuchszählung, Fehlerberichte …): Die Nachbauten danach gewinnen für ihre Wege.
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
    const server = await stubWetter(page, verweise === undefined ? {} : { verweise });
    await stubAdmin(page, { capabilities: ["use_editor_menu", "edit_weather"], role: "editor" });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wetter").click();
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Wetter bearbeiten");
    await verb.click();
    const fenster = page.locator('[data-testid^="wettereditor-"][data-testid$="-liste"]').first();
    await expect(fenster).toBeVisible();
    return { server, fenster: page.locator(".avm-fenster").filter({ has: fenster }) };
}

const zeile = (fenster: Locator, name: string | RegExp): Locator =>
    fenster.locator('[data-testid$="-wetter-zeile"]').filter({ hasText: name }).first();

/** Die Mitte der Scheibe eines Icons auf dem Schirm. */
async function iconMitte(page: Page, id: string): Promise<{ x: number; y: number }> {
    const scheibe = page.locator(`[data-wetter-icon="${id}"] .ws-scheibe`);
    await expect(scheibe).toBeVisible();
    const box = (await scheibe.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("🔴 Inhalte → Wetter öffnet den Wetter-Editor: EINE Liste, Presets zuerst mit „Unbestimmt“ an der Spitze, dann die Icons", async ({
    page,
}) => {
    const { fenster } = await oeffneWettereditor(page);
    // Kopf wie in den übrigen Editoren: das Verb, dann der Name des Gewählten; rechts im Fuß, dass sofort gespeichert wird.
    await expect(fenster.locator(".avm-fenster__titel")).toHaveText("Wetter bearbeiten · Unbestimmt");
    await expect(fenster.locator('[data-testid$="-sofort"]')).toHaveText("Änderungen werden sofort gespeichert.");
    const zeilen = fenster.locator('[data-testid$="-wetter-zeile"]');
    await expect(zeilen.nth(0)).toContainText("Presets");
    await expect(zeilen.nth(1)).toContainText("Unbestimmt");
    await expect(zeilen.nth(2)).toContainText("15. Praios");
    await expect(fenster).toContainText("Icons");
    await expect(fenster.locator('[data-testid$="-legenden"]')).toContainText("datiert");
    await expect(fenster.locator('[data-testid$="-legenden"]')).toContainText("ausgeblendet");
    // Ohne Reisebeginn ist „Unbestimmt“ gewählt und gilt auf der Karte.
    await expect(fenster.locator('[data-testid$="-preset"]')).toContainText("Unbestimmt");
    await expect(fenster.locator('[data-testid$="-gilt"]')).toHaveText("gilt auf der Karte");
    // Die Icons stehen als Griffe auf der Karte, auch ohne Wetterschalter im Auge.
    await expect(page.locator(".wetter-symbole--editor")).toBeVisible();
    await expect(page.locator(`[data-wetter-icon="${ERSTES.id}"]`)).toBeVisible();
    await expect(fenster.getByRole("button", { name: /^Speichern$/ })).toHaveCount(0);
});

test("🔴 ein Preset-Wert speichert ohne Knopf, entprellt und mit baseRevision", async ({ page }) => {
    const { server, fenster } = await oeffneWettereditor(page);
    await zeile(fenster, "15. Praios").click();
    const feld = fenster.locator('[data-testid$="-wert-tn-feld"]');
    await feld.fill("4.5");
    await feld.press("Enter");
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({
        method: "PATCH",
        path: "/api/editor/wetter/presets/p-praios",
        body: { baseRevision: 0, werte: { tn: 4.5 } },
    });
    await expect(fenster.locator('[data-testid$="-fuss"]')).toContainText("Gespeichert · eben");
    // Die zweite Änderung trägt die Revision der Quittung.
    await feld.fill("5");
    await feld.press("Enter");
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(2);
    expect(server.aufrufe[1]?.body).toMatchObject({ baseRevision: 1, werte: { tn: 5 } });
});

test("🔴 Idee B: „Unbestimmt“ auf ein Preset fragt erst; „Tauschen“ schreibt den Zeitpunkt, „Zurücknehmen“ legt zurück", async ({
    page,
}) => {
    const { server, fenster } = await oeffneWettereditor(page);
    await zeile(fenster, "15. Rondra").click();
    const monat = fenster.locator('[data-testid$="-monat"]').locator("select");
    await monat.selectOption("");
    const frage = fenster.locator('[data-testid$="-tausch-frage"]');
    await expect(frage).toContainText("„15. Rondra“ zum Kartenstandard machen?");
    // „Abbrechen“ lässt alles stehen, auch die Wahl im Feld.
    await frage.getByRole("button", { name: "Abbrechen" }).click();
    await expect(frage).toHaveCount(0);
    await expect(fenster.locator('[data-testid$="-monat"]').locator("select")).toHaveValue("rondra");
    await fenster.locator('[data-testid$="-monat"]').locator("select").selectOption("");
    expect(server.aufrufe).toHaveLength(0);
    await frage.getByRole("button", { name: "Tauschen" }).click();
    await expect.poll(() => server.aufrufe.length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({
        path: "/api/editor/wetter/presets/p-rondra/zeitpunkt",
        body: { baseRevision: 0, tag: null },
    });
    await expect(fenster.locator('[data-testid$="-tausch-hinweis"]')).toContainText("am 15. Rondra");
    // Das bisherige unbestimmte steht jetzt am 15. Rondra, in der Liste unter den datierten.
    await expect(zeile(fenster, "15. Rondra")).toBeVisible();
    await fenster.locator('[data-testid$="-tausch-zurueck"]').click();
    await expect.poll(() => server.aufrufe.length).toBe(2);
    expect(server.aufrufe[1]?.body).toMatchObject({ baseRevision: 1, tag: 45 });
});

test("🔴 ein Icon anlegen, auf der Karte ziehen und entfernen; ein Konflikt meldet sich und lädt neu", async ({
    page,
}) => {
    const { server, fenster } = await oeffneWettereditor(page);
    await fenster.locator('[data-testid$="-neu"]').click();
    await page.getByRole("menuitemradio", { name: "Wirbel" }).click();
    await expect.poll(() => server.aufrufe.length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({ method: "POST", path: "/api/editor/wetter/symbole" });
    expect(server.aufrufe[0]?.body).toMatchObject({ art: "wirbel", drehsinn: -1, richtung: null });
    const neu = server.stand().symbole.at(-1)!;
    await expect(fenster.locator('[data-testid$="-icon"]')).toContainText("Icon · Wirbel");

    // Ziehen an der Scheibe verschiebt das Icon; beim Loslassen geht die Lage an den Server.
    const vorher = await iconMitte(page, neu.id);
    await page.mouse.move(vorher.x, vorher.y);
    await page.mouse.down();
    await page.mouse.move(vorher.x + 40, vorher.y + 25, { steps: 8 });
    // Während des Zugs wird bearbeitet: Knallrot wie im Geometrie-Modul (EDIT-0003 G9), danach wieder die Farbe der Auswahl.
    await expect(page.locator(`[data-wetter-icon="${neu.id}"]`)).toHaveClass(/ws-zieht/);
    await page.mouse.up();
    await expect(page.locator(`[data-wetter-icon="${neu.id}"]`)).not.toHaveClass(/ws-zieht/);
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(1);
    const zug = server.aufrufe.find((a) => a.method === "PATCH")!;
    expect(zug.path).toBe(`/api/editor/wetter/symbole/${neu.id}`);
    const aenderung = zug.body?.["aenderungen"] as { x: number; z: number };
    expect(aenderung.x).toBeGreaterThan(neu.x);
    expect(aenderung.z).toBeGreaterThan(neu.z);
    const nachher = await iconMitte(page, neu.id);
    expect(Math.abs(nachher.x - (vorher.x + 40))).toBeLessThan(3);

    // Esc mitten im Zug: Das Icon springt zurück, nichts geht an den Server, und über das Fenster gezogen wird kein Text markiert.
    await page.mouse.move(nachher.x, nachher.y);
    await page.mouse.down();
    await page.mouse.move(nachher.x + 60, nachher.y + 10, { steps: 6 });
    await page.mouse.move(nachher.x + 900, nachher.y + 40, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(700);
    expect(server.aufrufe.filter((a) => a.method === "PATCH")).toHaveLength(1);
    const zurueck = await iconMitte(page, neu.id);
    expect(Math.abs(zurueck.x - nachher.x)).toBeLessThan(3);
    expect(await page.evaluate(() => globalThis.getSelection()?.toString() ?? "")).toBe("");

    // Entfernen fragt, dann weich (`entfernen`).
    await fenster.locator('[data-testid$="-entfernen"]').click();
    await fenster.locator('[data-testid$="-entfernen-frage"]').getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => server.aufrufe.some((a) => a.path.endsWith("/entfernen"))).toBe(true);
    await expect(page.locator(`[data-wetter-icon="${neu.id}"]`)).toHaveCount(0);

    // Ein Konflikt: Der Name eines anderen Icons ändert sich beim Server; der Editor sagt es und zeigt den Stand des Servers.
    await zeile(fenster, ERSTES.name!).click();
    server.konfliktBei(ERSTES.id);
    await fenster.locator('[data-testid$="-name"] input').fill("Westwind");
    await expect(fenster.locator('[data-testid$="-meldung"]')).toContainText("Jemand anderes hat das Wetter");
    await expect(fenster.locator('[data-testid$="-icon"] strong')).toHaveText(ERSTES.name!);
});

test("🔴 ein Klick auf ein Icon mit Wiki-Verweis wählt es, und sein Infopanel liegt dahinter: die Lasche „Info“ erscheint (Betreiber 2026-11-08)", async ({
    page,
}) => {
    const artikel = { titel: "Probewind (Wind)", art: "Wind" };
    const gefragt: string[] = [];
    await page.route(`**${SUBJECT_API_BASE}/${SUBJECT_WETTER_SYMBOL_PFAD}/*`, (route) => {
        gefragt.push(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(wetterSymbolDetail(ERSTES, artikel)),
        });
    });
    const { fenster } = await oeffneWettereditor(page, { [ERSTES.id]: artikel.titel });
    await expect(page.getByTestId("info-panel-tab")).toBeHidden();
    await zuIcon(page, ERSTES);
    const mitte = await iconAufFreieStelle(page, ERSTES.id);
    await page.mouse.click(mitte.x, mitte.y);
    // Der Editor wählt das Icon und bleibt vorn; das Infopanel lädt dahinter, die Lasche holt es.
    await expect(fenster.locator(".avm-fenster__titel")).toHaveText(`Wetter bearbeiten · ${ERSTES.name!}`);
    await expect(page.getByTestId("info-panel-tab")).toBeVisible();
    expect(gefragt).toEqual([ERSTES.id]);
    await page.getByTestId("info-panel-tab").click();
    await expect(page.getByTestId("info-title")).toHaveText(ERSTES.name!);
});

test("🔴 wie die übrigen Editoren: Rechtsklick auf ein Icon zeigt seine Handgriffe; „Verbergen“ schreibt sofort, das Icon steht grau", async ({
    page,
}) => {
    // Die Handgriffe gehen wie an Ort und Gipfel nur mit eingeschaltetem Bearbeiten (Testwelt).
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    const { server, fenster } = await oeffneWettereditor(page);
    // Doppelklick in der Liste fliegt hin (G3); dann liegt das Icon in der freien Kartenfläche.
    await zeile(fenster, ERSTES.name!).dblclick();
    await expect(fenster.locator(".avm-fenster__titel")).toHaveText(`Wetter bearbeiten · ${ERSTES.name!}`);
    // Das Kartenmenü schließt mit jeder Kartenbewegung: erst klicken, wenn der Flug steht, und dort, wo kein Planer über der Karte liegt.
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap?.isMoving() ?? true)).toBe(false);
    await settleFrame(page);
    const mitte = await iconAufFreieStelle(page, ERSTES.id);
    const dort = await iconMitte(page, ERSTES.id);
    expect(Math.hypot(dort.x - mitte.x, dort.y - mitte.y)).toBeLessThan(3);
    await page.mouse.click(mitte.x, mitte.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await expect(karte.getByTestId("context-editor-kopf-objekt")).toContainText("Bearbeiten");
    await expect(karte.getByTestId("context-editor-wetter-bearbeiten")).toContainText("Eigenschaften bearbeiten");
    await expect(karte.getByTestId("context-editor-wetter-entfernen")).toContainText("Icon entfernen …");
    await expect(karte.getByTestId("context-editor-wetter-zeigen")).toHaveCount(0);
    await karte.getByTestId("context-editor-wetter-verbergen").click();
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({
        path: `/api/editor/wetter/symbole/${ERSTES.id}`,
        body: { baseRevision: 0, aenderungen: { sichtbar: false } },
    });
    await expect(page.locator(`[data-wetter-icon="${ERSTES.id}"]`)).toHaveClass(/ws-grau/);
    await expect(fenster.locator('[data-testid$="-ausgeblendet"]')).toBeVisible();
    // Jetzt bietet das Menü „Zurückholen“ statt „Verbergen“.
    await page.mouse.click(mitte.x, mitte.y, { button: "right" });
    await expect(page.getByTestId("context-editor-wetter-zeigen")).toContainText("Zurückholen");
    await expect(page.getByTestId("context-editor-wetter-verbergen")).toHaveCount(0);
});

test("🔴 Stufe 6: am Icon den Wiki-Artikel suchen und setzen, den Namen nur auf Wunsch übernehmen, den Verweis lösen; jedes sofort gespeichert", async ({
    page,
}) => {
    const { server, fenster } = await oeffneWettereditor(page);
    await zeile(fenster, ERSTES.name!).click();
    const feld = fenster.locator('[data-testid$="-wiki"]');
    await expect(feld).toContainText("Wiki-Artikel");
    // Leer: eine Suche; ihre Treffer erst nach dem Fokus, die Winde vor der Strömung (ein Wind-Icon).
    const suche = feld.locator('[data-testid$="-wiki-suche"] input');
    await suche.click();
    const treffer = feld.locator('[data-testid$="-wiki-treffer"]');
    await expect(treffer).toHaveCount(WETTER_WIKI_PROBE.length);
    await expect(treffer.nth(0)).toContainText("Probebrise");
    await expect(treffer.nth(2)).toContainText("Probestrom");
    await suche.fill("küste");
    await expect(treffer).toHaveCount(1);
    await treffer.first().click();
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({
        method: "PATCH",
        path: `/api/editor/wetter/symbole/${ERSTES.id}`,
        body: { baseRevision: 0, aenderungen: { wikiTitel: "Probewind (Wind)" } },
    });
    const gesetzt = feld.locator('[data-testid$="-wiki-artikel"]');
    await expect(gesetzt.getByRole("link", { name: "Probewind (Wind)" })).toHaveAttribute(
        "href",
        "https://de.wiki-aventurica.de/wiki/Probewind_(Wind)",
    );
    // Das Icon hat einen Namen: kein Vorschlag. Ohne Namen schlägt der Titel ohne Klammerzusatz vor, und erst der Knopf übernimmt ihn.
    await expect(feld.locator('[data-testid$="-wiki-namensvorschlag"]')).toHaveCount(0);
    await fenster.locator('[data-testid$="-name"] input').fill("");
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(2);
    expect(server.aufrufe[1]?.body).toMatchObject({ baseRevision: 1, aenderungen: { name: null } });
    const vorschlag = feld.locator('[data-testid$="-wiki-namensvorschlag"]');
    await expect(vorschlag).toContainText("„Probewind“");
    await expect(fenster.locator('[data-testid$="-name"] input')).toHaveValue("");
    await vorschlag.click();
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(3);
    expect(server.aufrufe[2]?.body).toMatchObject({ baseRevision: 2, aenderungen: { name: "Probewind" } });
    await expect(fenster.locator('[data-testid$="-name"] input')).toHaveValue("Probewind");
    // ✕ löst den Verweis; die Suche steht wieder da.
    await feld.locator('[data-testid$="-wiki-loesen"]').click();
    await expect.poll(() => server.aufrufe.filter((a) => a.method === "PATCH").length).toBe(4);
    expect(server.aufrufe[3]?.body).toMatchObject({ baseRevision: 3, aenderungen: { wikiTitel: null } });
    await expect(feld.locator('[data-testid$="-wiki-suche"]')).toBeVisible();
    expect(server.stand().symbole[0]).toMatchObject({ wikiTitel: null, name: "Probewind" });
    // 🔴 Nur der Nachbau sah Schreibendes, und nur PATCH an diesem Icon.
    expect(new Set(server.aufrufe.map((a) => `${a.method} ${a.path}`))).toEqual(
        new Set([`PATCH /api/editor/wetter/symbole/${ERSTES.id}`]),
    );
});

test("🔴 ✚ „Preset“ legt eines an einem freien Tag an und wählt es; nur ein angelegtes lässt sich entfernen (Betreiber 2026-11-08)", async ({
    page,
}) => {
    const { server, fenster } = await oeffneWettereditor(page);
    // Ein festes Preset bietet kein Entfernen.
    await zeile(fenster, "15. Praios").click();
    await expect(fenster.locator('[data-testid$="-preset-entfernen"]')).toHaveCount(0);
    // Ohne Reisebeginn: die Mitte der größten Lücke, also zwischen 15. Praios (Tag 15) und 15. Rondra (Tag 45) der 30. Praios.
    await fenster.locator('[data-testid$="-neu"]').click();
    await page.getByRole("menuitemradio", { name: "Preset" }).click();
    await expect.poll(() => server.aufrufe.length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({ method: "POST", path: "/api/editor/wetter/presets", body: { tag: 30 } });
    const neu = server.stand().presets.at(-1)!;
    await expect(fenster.locator(".avm-fenster__titel")).toHaveText("Wetter bearbeiten · 30. Praios");
    await expect(zeile(fenster, "30. Praios")).toBeVisible();
    // Entfernen fragt, dann hart; die Zeile ist weg.
    await fenster.locator('[data-testid$="-preset-entfernen"]').click();
    await fenster
        .locator('[data-testid$="-preset-entfernen-frage"]')
        .getByRole("button", { name: "Entfernen" })
        .click();
    await expect.poll(() => server.aufrufe.length).toBe(2);
    expect(server.aufrufe[1]).toMatchObject({
        method: "POST",
        path: `/api/editor/wetter/presets/${neu.id}/entfernen`,
        body: { baseRevision: 1 },
    });
    await expect(zeile(fenster, "30. Praios")).toHaveCount(0);
    expect(server.stand().presets).toHaveLength(14);
});

test("🔴 ✚ „Mahlstrom“ legt ein Icon mit Drehsinn und ohne Richtung an; es steht auf der Karte (Betreiber 2026-11-08)", async ({
    page,
}) => {
    const { server, fenster } = await oeffneWettereditor(page);
    await fenster.locator('[data-testid$="-neu"]').click();
    await page.getByRole("menuitemradio", { name: "Mahlstrom" }).click();
    await expect.poll(() => server.aufrufe.length).toBe(1);
    expect(server.aufrufe[0]).toMatchObject({ method: "POST", path: "/api/editor/wetter/symbole" });
    expect(server.aufrufe[0]?.body).toMatchObject({ art: "mahlstrom", drehsinn: 1 });
    expect(server.aufrufe[0]?.body?.["richtung"]).toBeNull();
    const neu = server.stand().symbole.at(-1)!;
    await expect(fenster.locator('[data-testid$="-icon"]')).toContainText("Icon · Mahlstrom");
    await expect(page.locator(`[data-wetter-icon="${neu.id}"]`)).toHaveCount(1);
});
