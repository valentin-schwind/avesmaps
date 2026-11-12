import { expect, test, type Page } from "@playwright/test";
import type { EditorPathList, EditorPathStreet } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS_LAGE, editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Wege-Fenster (WI-0177 Stufe 2, W5a, W5b; Blatt „Wegeditor“; EDIT-0003 F17, T32, T34 (1), T44). 🔴 Kein Test schreibt in die
 * Datenbank der Entwicklung: Liste und Straße kommen aus einem Stub (den echten Leseweg prüft `editor-path-list.test.ts`).
 *
 * Problemfälle: „Wege“ bleibt „später“; das Verb öffnet einen anderen Editor; die Zeile heißt nach dem Griff; der Einfachklick fliegt
 * oder lässt die Ansicht stehen; „Eigenschaften bearbeiten“ am Weg geht nicht oder öffnet eine andere Straße; das Fenster bietet
 * Speichern an, obwohl es nur liest. Stufe 3b: ein genommener Weg fehlt in der Liste oder mischt sich in die Straße auf der Karte;
 * „Zurück auf die Karte“ fehlt, schreibt ohne Recht oder gegen eine falsche Revision. W5b: Die Felder lassen sich nicht ändern, „Fertig“
 * schreibt nur einen Abschnitt oder mehrere Operationen, gemischtes „Name auf der Karte“ wird ungefragt ja oder nein, ein Flussweg wird
 * zum Landweg, ein Klick in der Liste öffnet ein zweites Fenster statt an der Stelle dieses. T54: eine gelöschte Straße steht ohne die
 * Facette „Gelöscht“ in der Liste, ihr Fenster bietet Felder an, ↺ im Verlauf holt nur einen Abschnitt oder schreibt ohne Rückfrage.
 * Reisemittel (Migration 0208): Eine Änderung schreibt einen anderen Abschnitt mit, das Ausschreiben fehlt, ein gesperrtes Feld lässt sich
 * bedienen. Tunnel (Migration 0172): Das Kästchen eines Abschnitts schreibt auch an den anderen, oben fehlt „an n von m“ oder der Satz; oben
 * lässt sich nichts anhaken (Stage-Fund 2026-10-19), der Haken setzt nur einen Abschnitt, gemischt steht nicht als gemischt da.
 * Karawanenroute (Migration 0174): Die Route steht je Wegtyp einmal da statt EINMAL; der Wegtyp schreibt „gemischt“; der Haken fehlt
 * oder schreibt mehr als das Kennzeichen.
 */
const RS = "c5c5c5c5-0000-4000-8000-0000000000a1";
const RS2 = "c5c5c5c5-0000-4000-8000-0000000000a2";
const PFAD = "c5c5c5c5-0000-4000-8000-0000000000c1";
const GENOMMEN = "c5c5c5c5-0000-4000-8000-0000000000d1";
const GELOESCHT = "c5c5c5c5-0000-4000-8000-0000000000e1";
const G = GRATENFELS_LAGE;
const LISTE: EditorPathList = {
    rows: [
        {
            id: RS,
            name: "Reichsstraße 3",
            subtype: "Reichsstrasse",
            isBach: false,
            circle: "halb-rechts",
            segments: 2,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3", title: "Reichsstraße 3" },
            wikiSegments: 1,
            bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
        },
        { id: PFAD, name: "Pfad-3443", subtype: "Pfad", isBach: false, circle: "halb-rechts", segments: 1 },
    ],
};
/** Ein Abschnitt der Reichsstraße, von der Karte genommen (Stufe 3b): eine eigene Zeile neben der Straße auf der Karte. */
const ABGENOMMEN: EditorPathList["rows"][number] = {
    id: GENOMMEN,
    name: "Reichsstraße 3",
    subtype: "Reichsstrasse",
    isBach: false,
    circle: "leer",
    segments: 1,
    bounds: [G.x + 20, G.y + 10, G.x + 30, G.y + 20],
    offMap: true,
};
/** Ganz gelöscht (T54): steht nur unter der Facette „Gelöscht“. */
const GELOESCHTE: EditorPathList["rows"][number] = {
    id: GELOESCHT,
    name: "Alte Zollstraße",
    subtype: "Strasse",
    isBach: false,
    circle: "leer",
    segments: 1,
    deleted: true,
};
const strasse = (id: string): EditorPathStreet =>
    id === GELOESCHT
        ? {
              id: GELOESCHT,
              name: "Alte Zollstraße",
              subtype: "Strasse",
              isBach: false,
              circle: "leer",
              labelVisible: true,
              segments: [{ id: GELOESCHT, revision: 3, labelVisible: true, wiki: false, points: 5 }],
              deleted: true,
          }
        : id === GENOMMEN
          ? {
                id: GENOMMEN,
                name: "Reichsstraße 3",
                subtype: "Reichsstrasse",
                isBach: false,
                circle: "leer",
                labelVisible: true,
                segments: [
                    {
                        id: GENOMMEN,
                        revision: 9,
                        labelVisible: true,
                        wiki: false,
                        points: 4,
                        bounds: ABGENOMMEN.bounds!,
                    },
                ],
                bounds: ABGENOMMEN.bounds!,
                offMap: true,
            }
          : strasseAufKarte(id);
const strasseAufKarte = (id: string): EditorPathStreet => ({
    id: id === RS2 ? RS : id,
    name: id === PFAD ? "Pfad-3443" : "Reichsstraße 3",
    subtype: id === PFAD ? "Pfad" : "Reichsstrasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: null,
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3", title: "Reichsstraße 3" },
    segments: [
        {
            id: id === RS2 ? RS : id,
            revision: 4,
            labelVisible: true,
            wiki: true,
            points: 7,
            bounds: [G.x - 20, G.y - 10, G.x, G.y],
            von: "Calmir",
            bis: "Rossol",
        },
        {
            id: RS2,
            revision: 2,
            labelVisible: false,
            wiki: false,
            points: 3,
            bounds: [G.x, G.y, G.x + 20, G.y + 10],
            von: "Rossol",
            bis: "Gareth",
            reisen: { liste: null, domaene: null, fenster: { caravan: KARAWANE_SOMMER } },
        },
    ],
    bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
});

/** Das Zeitfenster der Karawane am zweiten Abschnitt der Reichsstraße: Peraine 1 bis Boron 15. */
const KARAWANE_SOMMER = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 15 };

/** Ein Abschnitt aus den echten Kacheln, den die Liste als eigene Straße führen soll (Rechtsklick auf einen Weg). */
let echter: string | undefined;

async function stub(page: Page, rechte = ["use_editor_menu"], mitGenommenem = false): Promise<void> {
    echter = undefined;
    await stubAdmin(page, { capabilities: rechte, role: rechte.includes("edit_map_geometry") ? "editor" : "reviewer" });
    await page.route("**/api/editor/paths", (route) => {
        const grund = mitGenommenem ? [...LISTE.rows, ABGENOMMEN, GELOESCHTE] : LISTE.rows;
        const rows =
            echter === undefined
                ? grund
                : [...grund, { ...LISTE.rows[0]!, id: echter, name: "Echter Weg", wikiSegments: undefined }];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows }) });
    });
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(strasse(id)) });
    });
}

async function oeffneWegeFenster(
    page: Page,
    vorher?: (page: Page) => Promise<void>,
    rechte?: string[],
    mitGenommenem = false,
): Promise<void> {
    await stub(page, rechte, mitGenommenem);
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    if (vorher) await vorher(page);
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Wege bearbeiten");
    await verb.click();
}
const liste = (page: Page) => page.locator('[data-testid^="wegeditor-"][data-testid$="-liste"]');
const fenster = (page: Page) => liste(page).locator("xpath=ancestor::*[contains(@class,'avm-fenster')][1]");

test("🔴 Wege → „Wege bearbeiten“ öffnet das Wege-Fenster: eine Zeile je Straße, nie der Griff, lesend", async ({
    page,
}) => {
    await oeffneWegeFenster(page);
    await expect(liste(page)).toBeVisible();
    await expect(liste(page).getByRole("option")).toHaveCount(2);
    await expect(liste(page)).toContainText("Reichsstraße 3");
    await expect(liste(page)).toContainText("Wiki an 1 von 2 Abschnitten");
    await expect(liste(page)).toContainText("Unbezeichneter Pfad");
    await expect(liste(page)).not.toContainText("Pfad-3443");
    await expect(page.getByText("nur lesen").first()).toBeVisible();
    await expect(page.locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')).toHaveCount(0);
    await expect(fenster(page).getByRole("button", { name: /speichern|Fertig/i })).toHaveCount(0);
});

test("🔴 F17: der Einfachklick stellt die Ansicht „Standard“ ohne Flug; die Eigenschaften nennen Wegtyp, Name auf der Karte und die Abschnitte", async ({
    page,
}) => {
    // Erst das Fenster, dann die Ansicht: Seit „Karteninhalte“ der Ansicht folgt (Kamera/Wiki-Feld 69ebebeef), wählt „Politisch“
    // die Kachel der Gebiete; das offene Wege-Fenster bleibt. Das angedockte Fenster liegt über dem Fächer: Die Klicks gehen direkt an ihn.
    await oeffneWegeFenster(page);
    await page.getByTestId("fan-toggle").dispatchEvent("click");
    await page.getByTestId("fan-view-political").dispatchEvent("click");
    await expect(page).toHaveURL(/view=political/);
    await expect(liste(page)).toBeVisible();
    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await liste(page)
        .getByRole("option", { name: /Reichsstraße 3/ })
        .click();
    await expect(page).not.toHaveURL(/view=political/);
    const eigenschaften = page.getByTestId(/^wegeditor-fenster-\d+-eigenschaften$/);
    await expect(eigenschaften).toContainText("Reichsstraße");
    await expect(eigenschaften).toContainText("an 1 von 2 Abschnitten");
    const abschnitte = page.getByTestId(/^wegeditor-fenster-\d+-abschnitte$/);
    await expect(abschnitte).toContainText("Abschnitte (2)");
    await expect(abschnitte.locator("[data-abschnitt]")).toHaveCount(2);
    await expect(page.getByTestId(/^wegeditor-fenster-\d+-tafel-titel$/)).toHaveText("Der ganze Weg");
    const nachher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat, bewegt: globalThis.avesmapsMap!.isMoving() };
    });
    expect(nachher).toEqual({ ...vorher, bewegt: false });
    await page.screenshot({ path: "test-results/wegeditor-w5a.png" });
});

test("🔴 Leiste (W) (1) (2) im Kasten „Abschnitte“ (Betreiber 2026-10-19): eine Nummer wählt, alle oder keine heißt (W), die Karte zeigt die Wahl", async ({
    page,
}) => {
    await oeffneWegeFenster(page);
    await liste(page)
        .getByRole("option", { name: /Reichsstraße 3/ })
        .click();
    const wahl = page.getByTestId(/^wegeditor-fenster-\d+-wahl$/);
    const ganz = page.getByTestId(/^wegeditor-fenster-\d+-wahl-ganz$/);
    const eins = page.getByTestId(/^wegeditor-fenster-\d+-wahl-1$/);
    const zwei = page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/);
    const titel = page.getByTestId(/^wegeditor-fenster-\d+-tafel-titel$/);
    // (W): der ganze Weg, alle Nummern gedrückt.
    await expect(wahl.getByRole("button")).toHaveCount(3);
    await expect(ganz).toHaveAttribute("aria-pressed", "true");
    await expect(eins).toHaveAttribute("aria-pressed", "true");
    await expect(titel).toHaveText("Der ganze Weg");
    // Eine Nummer: nur ihr Abschnitt, darunter seine Orte („(3) ist angklickt und drunter Calmir – Rossol“), die Karte lässt ihn leuchten.
    await eins.click();
    await expect(ganz).toHaveAttribute("aria-pressed", "false");
    await expect(eins).toHaveAttribute("aria-pressed", "true");
    await expect(zwei).toHaveAttribute("aria-pressed", "false");
    await expect(titel).toHaveText("Calmir – Rossol");
    await expect
        .poll(() =>
            page.evaluate(() => JSON.stringify(globalThis.avesmapsMap!.getFilter("weg-abschnitte-hervor") ?? null)),
        )
        .toContain(RS);
    // Die zweite dazu: Das sind alle, also wieder (W).
    await zwei.click();
    await expect(ganz).toHaveAttribute("aria-pressed", "true");
    await expect(titel).toHaveText("Der ganze Weg");
    // Eine Nummer und (W) zurück.
    await zwei.click();
    await expect(titel).toHaveText("Rossol – Gareth");
    await ganz.click();
    await expect(ganz).toHaveAttribute("aria-pressed", "true");
    await expect(titel).toHaveText("Der ganze Weg");
    await page.screenshot({ path: "test-results/wegeditor-abschnittsleiste.png" });
});

test("🔴 Reisemittel der Wahl (Vorschlag 3, Schritt 1): uneinig „–“, ein Abschnitt nennt sein Fenster, die Spur liegt auf den Monaten", async ({
    page,
}) => {
    await oeffneWegeFenster(page);
    await liste(page)
        .getByRole("option", { name: /Reichsstraße 3/ })
        .click();
    const reisemittel = page.getByTestId(/^wegeditor-fenster-\d+-reisemittel$/);
    const karawane = reisemittel.locator('[data-mittel="caravan"]');
    // (W): Der erste Abschnitt fährt ganzjährig, der zweite nur im Fenster - uneinig.
    await expect(reisemittel.locator("[data-mittel]")).toHaveCount(9);
    await expect(karawane).toContainText("–");
    await page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/).click();
    await expect(karawane).toContainText("Peraine");
    await expect(karawane).toContainText("Boron");
    await expect(karawane.locator(".weg-rm__bt")).toHaveText("15");
    // Auf die Zeile zeigen: Die Monate im Fenster stehen satt, die anderen blass; Boron halb gelb, halb rot.
    await karawane.hover();
    const jahr = page.getByTestId(/^wegeditor-fenster-\d+-monatsleiste$/);
    await expect(jahr.locator('[data-monat="peraine"]')).toHaveClass(/weg-rm__mo--an/);
    // Peraine bis Boron läuft über den Jahreswechsel: Praios fährt, Firun nicht.
    await expect(jahr.locator('[data-monat="praios"]')).toHaveClass(/weg-rm__mo--an/);
    await expect(jahr.locator('[data-monat="firun"]')).not.toHaveClass(/weg-rm__mo--an/);
    const spur = await jahr
        .locator('[data-monat="boron"] .weg-rm__spur')
        .evaluate((el) => (el as HTMLElement).style.background);
    expect(spur).toContain("50.00%");
    // Der Schlitten fährt nur auf Schnee.
    await reisemittel.locator('[data-mittel="sleigh"]').hover();
    await expect(reisemittel).toContainText("Nur auf Schnee");
    await page.screenshot({ path: "test-results/wegeditor-reisemittel.png" });
});

test("🔴 16 Abschnitte bei (W) (Bild des Betreibers 2026-10-19): „ganzjährig“ steht allein, die Spur liegt beim Zeigen auf den Monaten, ein Klick hält sie fest", async ({
    page,
}) => {
    const sechzehn = Array.from(
        { length: 16 },
        (_, i) => `c5c5c5c5-0000-4000-8000-0000000016${String(i).padStart(2, "0")}`,
    );
    await oeffneWegeFenster(page, async (p) => {
        await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (r) => {
            const s = strasseAufKarte(RS);
            const segments = sechzehn.map((id, i) => ({
                id,
                revision: 1,
                labelVisible: true,
                wiki: false,
                points: 3,
                bounds: s.bounds,
                von: `Ort ${i + 1}`,
                bis: `Ort ${i + 2}`,
            }));
            return r.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ...s, segments }),
            });
        });
    });
    await liste(page)
        .getByRole("option", { name: /Reichsstraße 3/ })
        .click();
    await expect(page.getByTestId(/^wegeditor-fenster-\d+-wahl$/).getByRole("button")).toHaveCount(17);
    const zeile = page
        .getByTestId(/^wegeditor-fenster-\d+-reisemittel$/)
        .locator("[data-mittel]")
        .first();
    // „ganzjährig“ allein: kein Tag, kein „bis“-Datum daneben.
    await expect(zeile.locator(".weg-rm__vm")).toHaveText("ganzjährig");
    for (const feld of [".weg-rm__vt", ".weg-rm__bm", ".weg-rm__bt"]) await expect(zeile.locator(feld)).toHaveText("");
    const jahr = page.getByTestId(/^wegeditor-fenster-\d+-monatsleiste$/);
    const spurIm = (monat: string) =>
        jahr.locator(`[data-monat="${monat}"] .weg-rm__spur`).evaluate((el) => (el as HTMLElement).style.background);
    expect(await spurIm("firun")).toBe("");
    await zeile.hover();
    await expect.poll(() => spurIm("firun")).toContain("linear-gradient");
    // Ein Klick hält sie fest: Die Maus geht weg, die Spur bleibt; ein zweiter Klick löst sie.
    await zeile.click();
    await page.mouse.move(5, 5);
    expect(await spurIm("firun")).toContain("linear-gradient");
    await zeile.click();
    await page.mouse.move(5, 5);
    await expect.poll(() => spurIm("firun")).toBe("");
});

test("🔴 T32: der Doppelklick fliegt zum Rahmen der Straße", async ({ page }) => {
    await oeffneWegeFenster(page);
    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await liste(page)
        .getByRole("option", { name: /Reichsstraße 3/ })
        .dblclick();
    await page.waitForFunction((alt) => {
        const jetzt = globalThis.avesmapsMap!.getCenter();
        return !globalThis.avesmapsMap!.isMoving() && (jetzt.lng !== alt.lng || jetzt.lat !== alt.lat);
    }, vorher);
});

/**
 * Bei Gratenfels: eine Stelle auf einem gezeichneten Weg der echten Kacheln, von der Mitte aus gesucht, mit der Kennung des Abschnitts.
 * `fernVonOrten`: nur eine Stelle ohne Ort in `fernVonOrten` Pixeln. Ein Linksklick nimmt sonst den Ort (er geht vor), ein Rechtsklick
 * auf den Weg nicht.
 */
async function wegStelle(page: Page, fernVonOrten = 0): Promise<{ x: number; y: number; id: string }> {
    await showPlace(page, G, 7);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    const stelle = await page.evaluate((abstand) => {
        const map = globalThis.avesmapsMap!;
        const ids = map.getStyle().layers.map((l) => l.id);
        const layers = ids.filter((id) => id.startsWith("path-hit-"));
        const orte = ids.filter((id) => id.startsWith("place"));
        const rahmen = map.getCanvas().getBoundingClientRect();
        const w = map.getCanvas().clientWidth;
        const h = map.getCanvas().clientHeight;
        for (let r = 0; r < 300; r += 6)
            for (let a = 0; a < 360; a += 15) {
                const x = w / 2 + r * Math.cos((a * Math.PI) / 180);
                const y = h / 2 + r * Math.sin((a * Math.PI) / 180);
                const f = map.queryRenderedFeatures([x, y], { layers })[0];
                if (!f) continue;
                const nah: [[number, number], [number, number]] = [
                    [x - abstand, y - abstand],
                    [x + abstand, y + abstand],
                ];
                if (abstand > 0 && map.queryRenderedFeatures(nah, { layers: orte }).length > 0) continue;
                return { x: rahmen.left + x, y: rahmen.top + y, id: String(f.properties["public_id"] ?? f.id) };
            }
        return undefined;
    }, fernVonOrten);
    expect(stelle, "eine Stelle auf einem Weg").toBeDefined();
    return stelle!;
}

test("🔴 „Eigenschaften bearbeiten“ im Kartenmenü am Weg öffnet das Fenster an SEINER Straße (Anker der Straße gewählt)", async ({
    page,
}) => {
    await stub(page, [
        "use_editor_menu",
        "edit_map_objects",
        "edit_map_geometry",
        "edit_territories",
        "edit_landscapes",
        "edit_territory_form",
        "edit_landscape_form",
        "edit_mountains",
    ]);
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await openMap(page, EDITOR_MODE);
    const stelle = await wegStelle(page);
    echter = stelle.id;
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-weg-eigenschaften");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    // Von der Karte geöffnet steht das Fenster nur mit den Eigenschaften, die Liste eingezogen (Variante A, wie die Landschaft).
    const eigenschaften = page.getByTestId(/^wegeditor-fenster-\d+-abschnitte$/);
    await expect(eigenschaften).toBeVisible();
    // Der Stub antwortet für jeden Abschnitt mit einer Straße unter dessen Kennung: Sie ist gewählt.
    await expect(eigenschaften.locator(`[data-abschnitt="${stelle.id}"]`)).toHaveCount(1);
});

test("🔴 Stufe 3b: ein genommener Abschnitt steht unter „Nicht auf der Karte“; „Zurück auf die Karte“ ist EINE Operation gegen seine Revision", async ({
    page,
}) => {
    const zurueck: { url: string; body: { baseRevision: number } }[] = [];
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/put-on-map$/, (route) => {
        const body = route.request().postDataJSON() as { operationId: string; baseRevision: number };
        zurueck.push({ url: route.request().url(), body });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 82,
            }),
        });
    });
    await oeffneWegeFenster(
        page,
        undefined,
        [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        true,
    );
    // Zwei Zeilen „Reichsstraße 3“: die Straße auf der Karte und der genommene Abschnitt, der sagt, wo er steht.
    await expect(liste(page).getByRole("option", { name: /Reichsstraße 3/ })).toHaveCount(2);
    const genommen = liste(page).getByRole("option", { name: /Nicht auf der Karte/ });
    await expect(genommen).toHaveCount(1);
    await genommen.click();
    const abschnitte = page.getByTestId(/^wegeditor-fenster-\d+-abschnitte$/);
    await expect(abschnitte).toContainText("Nicht auf der Karte: Die Linie ist gespeichert");
    await expect(abschnitte.getByRole("button", { name: /Zeigen/ })).toHaveCount(0);
    await abschnitte.getByRole("button", { name: "Abschnitt 1 zurück auf die Karte" }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]!.url).toContain(`/api/editor/paths/${GENOMMEN}/put-on-map`);
    expect(zurueck[0]!.body.baseRevision).toBe(9);
    await expect(page.getByTestId("toast")).toContainText("„Reichsstraße 3“ ist zurück auf der Karte.");
});

test("Stufe 3b: ohne das Recht der Lage zeigt der genommene Abschnitt kein „Zurück auf die Karte“", async ({
    page,
}) => {
    await oeffneWegeFenster(page, undefined, ["use_editor_menu"], true);
    await liste(page)
        .getByRole("option", { name: /Nicht auf der Karte/ })
        .click();
    const abschnitte = page.getByTestId(/^wegeditor-fenster-\d+-abschnitte$/);
    await expect(abschnitte).toContainText("Nicht auf der Karte: Die Linie ist gespeichert");
    await expect(abschnitte.getByRole("button", { name: /zurück auf die Karte/ })).toHaveCount(0);
});

/** Die Stubs fürs Schreiben (W5b): `path.update`, die Sperre, „Bearbeiten an“. Gibt zurück, was gesendet wurde. */
async function schreibStubs(page: Page): Promise<{ url: string; body: Record<string, unknown> }[]> {
    const gesendet: { url: string; body: Record<string, unknown> }[] = [];
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET")
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locks: [] }) });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat"))
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lost: [] }) });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                lock: {
                    ...body,
                    person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                    since: "2026-10-17T12:00:00.000Z",
                    heartbeatAt: "2026-10-17T12:00:00.000Z",
                    own: true,
                },
            }),
        });
    });
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/update$/, (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        gesendet.push({ url: route.request().url(), body });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body["operationId"],
                status: "applied",
                environment: "development",
                affected: [{ kind: "path", id: RS, revision: 5 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 90,
            }),
        });
    });
    return gesendet;
}
const SCHREIBEN = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

// Wie die Landschaft (`landschaftseditor-bearbeiten.spec.ts`): die Felder bei 1920 × 1080; bei 1280 × 720 steht die Leiste im Fenster (T45).
test.describe("W5b: die Felder der Straße schreiben", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("🔴 W5b: Name, Wegart und „Name auf der Karte“ im Fenster ändern; „Fertig“ schreibt EINE Operation für ALLE Abschnitte", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        const name = page
            .getByTestId(/^wegeditor-fenster-\d+-feld-name$/)
            .locator("input")
            .filter({ visible: true });
        await expect(name).toHaveValue("Reichsstraße 3");
        // Gemischt: an einem von zwei Abschnitten, kein Haken. Neben dem Haken steht immer „ja“, gemischt daneben (Stage-Fund 2026-11-09).
        const aufKarte = page.getByTestId(/^wegeditor-fenster-\d+-feld-name-auf-karte$/);
        await expect(aufKarte).not.toBeChecked();
        await expect(aufKarte.locator("xpath=..")).toHaveText("ja");
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-name-auf-karte-zeile$/)).toContainText(
            "gemischt: an 1 von 2 Abschnitten",
        );
        await name.fill("Reichsstraße 4");
        await name.blur();
        // Die erste Änderung beginnt die Bearbeitung: Die Leiste steht mit „Fertig“.
        const leiste = page.getByTestId("wege-leiste");
        await expect(leiste).toBeVisible();
        await page
            .getByTestId(/^wegeditor-fenster-\d+-feld-wegart$/)
            .locator("select")
            .selectOption("Strasse");
        await aufKarte.click();
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toContainText("3");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.url).toContain(`/api/editor/paths/${RS}/update`);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4 },
                { publicId: RS2, baseRevision: 2 },
            ],
            name: "Reichsstraße 4",
            subtype: "Strasse",
            labelVisible: true,
        });
        await expect(leiste).toBeHidden();
    });

    test('🔴 nach dem Umbenennen liest das Infopanel den Weg neu und nennt den neuen Namen (Betreiber 2026-10-18: „es steht immer noch "unbezeichneter weg" dran“)', async ({
        page,
    }) => {
        await schreibStubs(page);
        await stub(page, SCHREIBEN);
        // Der Lesepfad des Infopanels antwortet hier selbst, unabhängig vom gemeinsamen Server: erst ohne Namen (ein neuer Weg trägt
        // nur seinen Griff), nach dem Schreiben mit dem neuen Namen.
        let antwortTitel: string | undefined = undefined;
        const gelesen: string[] = [];
        await page.route(/\/api\/subjects\/path\//, (route) => {
            gelesen.push(route.request().url());
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    subject: { kind: "path", anchor: echter },
                    revision: "e2e000000001",
                    ...(antwortTitel === undefined ? {} : { title: antwortTitel }),
                    subtitle: [{ part: "type", key: "Weg" }],
                    target: { x: G.x, y: G.y, zoom: 7 },
                }),
            });
        });
        await openMap(page, EDITOR_MODE);
        const stelle = await wegStelle(page, 48);
        echter = stelle.id;
        await page.mouse.click(stelle.x, stelle.y);
        await expect.poll(() => gelesen.length).toBeGreaterThan(0);
        await page.mouse.click(stelle.x, stelle.y, { button: "right" });
        await page.getByTestId("context-editor-weg-eigenschaften").click();
        const name = page
            .getByTestId(/^wegeditor-fenster-\d+-feld-name$/)
            .locator("input")
            .filter({ visible: true });
        await expect(name).toHaveValue("Reichsstraße 3");
        await name.fill("Neuer Name");
        await name.blur();
        const vorher = gelesen.length;
        antwortTitel = "Neuer Name";
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gelesen.length).toBeGreaterThan(vorher);
        const titel = page.getByTestId("info-title");
        // Das angedockte Fenster liegt über der Lasche „Info“: Der Klick geht direkt an sie.
        if (!(await titel.isVisible())) await page.getByTestId("info-panel-tab").dispatchEvent("click");
        await expect(titel).toHaveText("Neuer Name");
    });

    test("🔴 Tunnel je Abschnitt (Betreiber 2026-11-09): bei (W) unten kein Haken, oben „keiner“ und wo man ihn setzt; (2) wählen, das Kästchen der Tafel, oben „Abschnitt 2“ mit „kein Zugang querfeldein“; „Fertig“ schreibt nur ihn", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        const oben = page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel$/);
        const tafel = page.getByTestId(/^wegeditor-fenster-\d+-tafel-tunnel$/);
        // Oben kein Haken mehr, nur die Abschnitte im Tunnel; bei (W) steht unten keiner, oben steht, wo er gesetzt wird.
        await expect(oben).toContainText("keiner");
        await expect(oben.locator("input")).toHaveCount(0);
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel-wo$/)).toHaveText(
            "Setzen: unten einen Abschnitt wählen.",
        );
        await expect(tafel).toHaveCount(0);
        await page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/).click();
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel-wo$/)).toHaveCount(0);
        await tafel.click();
        await expect(oben).toContainText("Abschnitt 2");
        await expect(oben).toContainText("kein Zugang querfeldein");
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toContainText("1");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4 },
                { publicId: RS2, baseRevision: 2, tunnel: true },
            ],
        });
        expect((gesendet[0]!.body["sections"] as Record<string, unknown>[])[0]).not.toHaveProperty("tunnel");
        expect(gesendet[0]!.body).not.toHaveProperty("name");
    });

    test("🔴 Tunnel oben listet die Abschnitte (Betreiber 2026-11-09 „nicht anklickbar … sondern gelistet“): die Nummer wählt genau ihn, unten steht sein Haken; abgehakt schreibt „Fertig“ nur ihn", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        // Anfangs läuft nur der zweite Abschnitt durch einen Tunnel.
        const mitTunnel = async (p: Page): Promise<void> => {
            await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (r) => {
                const s = strasseAufKarte(r.request().url().split("/").at(-2)!);
                const segments = s.segments.map((a) => (a.id === RS2 ? { ...a, tunnel: true as const } : a));
                return r.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ ...s, segments }),
                });
            });
        };
        await oeffneWegeFenster(page, mitTunnel, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        const oben = page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel$/);
        const tafel = page.getByTestId(/^wegeditor-fenster-\d+-tafel-tunnel$/);
        await expect(oben).toContainText("Abschnitt 2");
        await expect(oben).toContainText("kein Zugang querfeldein");
        await expect(oben.locator("input")).toHaveCount(0);
        await expect(tafel).toHaveCount(0);
        // Die Nummer ist ein Verweis: Sie wählt genau Abschnitt 2, wie (W) und dann (2) in der Leiste.
        await page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel-2$/).click();
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/)).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-wahl-1$/)).toHaveAttribute("aria-pressed", "false");
        await expect(tafel).toBeChecked();
        await tafel.click();
        await expect(tafel).not.toBeChecked();
        await expect(oben).toContainText("keiner");
        await expect(oben).not.toContainText("kein Zugang querfeldein");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4 },
                { publicId: RS2, baseRevision: 2, tunnel: false },
            ],
        });
        expect((gesendet[0]!.body["sections"] as Record<string, unknown>[])[0]).not.toHaveProperty("tunnel");
    });

    test("🔴 Tunnel an einem Weg aus EINEM Abschnitt: keine Leiste, der Haken steht gleich in der Tafel, oben „nein“ und dann „ja“", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        const einAbschnitt = async (p: Page): Promise<void> => {
            await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (r) => {
                const s = strasseAufKarte(r.request().url().split("/").at(-2)!);
                return r.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ ...s, segments: s.segments.slice(0, 1) }),
                });
            });
        };
        await oeffneWegeFenster(page, einAbschnitt, SCHREIBEN);
        await liste(page).getByText("Unbezeichneter Pfad").first().click();
        const oben = page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel$/);
        const tafel = page.getByTestId(/^wegeditor-fenster-\d+-tafel-tunnel$/);
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-wahl$/)).toHaveCount(0);
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-tunnel-wo$/)).toHaveCount(0);
        await expect(oben).toHaveText("nein");
        await expect(tafel).not.toBeChecked();
        await tafel.click();
        await expect(oben).toContainText("ja");
        await expect(oben).toContainText("kein Zugang querfeldein");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({ sections: [{ publicId: PFAD, tunnel: true }] });
    });

    test("🔴 Reisemittel schreiben (Schritt 3, F16 „A“): (2) wählen, Karren abwählen, ein Fenster mit Grund; „Fertig“ schreibt nur ihn, ganz und ausgeschrieben", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        await page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/).click();
        const karren = page.getByTestId(/^wegeditor-fenster-\d+-rm-haken-cart$/);
        await expect(karren).toHaveAttribute("aria-checked", "true");
        await karren.click();
        await expect(karren).toHaveAttribute("aria-checked", "false");
        // Ohne Haken ist die Zeile gesperrt.
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-rm-von-cart$/).locator("select")).toBeDisabled();
        // Zu Fuß: aus „ganzjährig“ ein Monat, „bis“ steht ein halbes Jahr später am 30.; dann der Grund.
        const zuFuss = (feld: string) =>
            page.getByTestId(new RegExp(`^wegeditor-fenster-\\d+-rm-${feld}-groupFoot$`)).locator("select");
        await expect(zuFuss("vontag")).toBeDisabled();
        await zuFuss("von").selectOption("peraine");
        await expect(zuFuss("bis")).toHaveValue("travia");
        await expect(zuFuss("bistag")).toHaveValue("30");
        await zuFuss("grund").selectOption("schneemassen");
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toBeVisible();
        await page.screenshot({ path: "test-results/wegeditor-reisemittel-schreiben.png" });
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4 },
                {
                    publicId: RS2,
                    baseRevision: 2,
                    reisen: {
                        // Ausgeschrieben, wie die Wegfindung rechnet, ohne den Karren; das gespeicherte Fenster der Karawane bleibt.
                        liste: [
                            "groupFoot",
                            "lightWalker",
                            "groupHorse",
                            "lightRider",
                            "caravan",
                            "wagon",
                            "horseCarriage",
                            "sleigh",
                        ],
                        fenster: {
                            caravan: KARAWANE_SOMMER,
                            groupFoot: {
                                from_month: "peraine",
                                from_day: 1,
                                to_month: "travia",
                                to_day: 30,
                                reason: "schneemassen",
                            },
                        },
                    },
                },
            ],
        });
        expect((gesendet[0]!.body["sections"] as Record<string, unknown>[])[0]).not.toHaveProperty("reisen");
    });

    test("🔴 Auf alle Abschnitte übernehmen (OPS-000112): bei (W) kein Knopf; (2) wählen, ⇉ an der Kamelkarawane gibt ihr Fenster Abschnitt 1, seine Nummer leuchtet, der Fuß sagt es, danach gesperrt; „Fertig“ schreibt nur Abschnitt 1", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        const id = (s: string) => new RegExp(`^wegeditor-fenster-\\d+-${s}$`);
        await expect(page.getByTestId(id("rm-haken-caravan"))).toBeVisible();
        // Bei (W) gilt jede Änderung ohnehin allen: kein Knopf.
        await expect(page.getByTestId(id("rm-alle"))).toHaveCount(0);
        await expect(page.getByTestId(id("rm-alle-caravan"))).toHaveCount(0);
        await page.getByTestId(id("wahl-2")).click();
        const gross = page.getByTestId(id("rm-alle"));
        await expect(gross).toBeEnabled();
        // Zu Fuß fährt an beiden ganzjährig: gesperrt mit Grund. Die Kamelkarawane hat nur an (2) ein Fenster: frei.
        const zuFuss = page.getByTestId(id("rm-alle-groupFoot"));
        await expect(zuFuss).toBeDisabled();
        await expect(zuFuss).toHaveAttribute("title", "Alle Abschnitte fahren hier schon so.");
        const karawane = page.getByTestId(id("rm-alle-caravan"));
        await expect(karawane).toBeEnabled();
        await page.screenshot({ path: "test-results/wegeditor-alle-abschnitte-vorher.png" });
        await karawane.click();
        await expect(page.getByTestId(id("wahl-1"))).toHaveClass(/wegeditor__nummer--leuchtet/);
        await expect(page.getByTestId(id("wahl-2"))).not.toHaveClass(/wegeditor__nummer--leuchtet/);
        const meldung = page.getByTestId(id("meldung"));
        await expect(meldung).toHaveText("Kamelkarawane von Abschnitt 2 an alle 2 Abschnitte gegeben.");
        await expect(karawane).toBeDisabled();
        await expect(gross).toBeDisabled();
        await expect(gross).toHaveAttribute("title", "Alle Abschnitte fahren schon so.");
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toContainText("1");
        await page.screenshot({ path: "test-results/wegeditor-alle-abschnitte-nachher.png" });
        // Die Nummer leuchtet nur kurz.
        await expect(page.getByTestId(id("wahl-1"))).not.toHaveClass(/wegeditor__nummer--leuchtet/, { timeout: 5000 });
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        const abschnitte = gesendet[0]!.body["sections"] as Record<string, unknown>[];
        expect(abschnitte[0]).toMatchObject({ publicId: RS, reisen: { fenster: { caravan: KARAWANE_SOMMER } } });
        expect(abschnitte[1]).not.toHaveProperty("reisen");
        await expect(meldung).toBeHidden();
    });

    test("🔴 Fließrichtung auf alle Abschnitte übernehmen (OPS-000112): bei (W) kein Wert für alle, nur der Zustand; (1) wählen, ⇉ dreht (2) dem Lauf nach, nennt die Lücke vor (4); „Fertig“ schreibt nur (2)", async ({
        page,
    }) => {
        // Der Fluss: (1) k0 → k1, (2) von k2 nach k1 gezeichnet, aber wie (1) auf „in Zeichenrichtung“ (so kopierte es bisher (W)), (3) k2 → k3;
        // (4) hinter einer Lücke.
        const F = [
            "c5c5c5c5-0000-4000-8000-0000000001f1",
            "c5c5c5c5-0000-4000-8000-0000000001f2",
            "c5c5c5c5-0000-4000-8000-0000000001f3",
            "c5c5c5c5-0000-4000-8000-0000000001f4",
        ] as const;
        const zeile: EditorPathList["rows"][number] = {
            id: F[0],
            name: "Testfluss",
            subtype: "Flussweg",
            isBach: false,
            circle: "voll",
            segments: 4,
            bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
        };
        const fluss: EditorPathStreet = {
            id: F[0],
            name: "Testfluss",
            subtype: "Flussweg",
            isBach: false,
            circle: "voll",
            labelVisible: true,
            segments: F.map((id, i) => ({
                id,
                revision: 3,
                labelVisible: true,
                wiki: false,
                points: 2,
                flowDirection: "forward" as const,
                bounds: [G.x - 20 + i * 10, G.y - 5, G.x - 10 + i * 10, G.y + 5] as [number, number, number, number],
            })),
            bounds: zeile.bounds!,
        };
        let netzAbrufe = 0;
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(
            page,
            async (p) => {
                await p.route("**/api/editor/paths", (r) =>
                    r.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({ rows: [...LISTE.rows, zeile] }),
                    }),
                );
                await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (r) => {
                    const id = r.request().url().split("/").at(-2)!;
                    const body = (F as readonly string[]).includes(id) ? fluss : strasse(id);
                    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
                });
                await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street\/flussnetz$/, (r) => {
                    netzAbrufe += 1;
                    return r.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({
                            abschnitte: [
                                { id: F[0], knoten: ["k0", "k1"], laengen: [4] },
                                { id: F[1], knoten: ["k2", "k1"], laengen: [4] },
                                { id: F[2], knoten: ["k2", "k3"], laengen: [4] },
                                { id: F[3], knoten: ["k8", "k9"], laengen: [4] },
                            ],
                        }),
                    });
                });
            },
            SCHREIBEN,
        );
        await liste(page).getByText("Testfluss").first().click();
        const id = (s: string) => new RegExp(`^wegeditor-fenster-\\d+-${s}$`);
        // (W): keine Auswahl „in Zeichenrichtung“ für alle, sondern wo die Pfeile gegeneinander zeigen; kein Knopf „auf alle“.
        const text = page.getByTestId(id("tafel-richtung-text"));
        await expect(text).toHaveText("Pfeile zeigen gegeneinander bei Abschnitt 1 und 2, Abschnitt 2 und 3");
        await expect(page.getByTestId(id("tafel-richtung"))).toHaveCount(0);
        await expect(page.getByTestId(id("tafel-richtung-alle"))).toHaveCount(0);
        await expect(page.getByTestId(id("tafel-richtung-umkehren"))).toBeEnabled();
        // Ein Abschnitt gewählt: der Knopf geht.
        await page.getByTestId(id("wahl-1")).click();
        const knopf = page.getByTestId(id("tafel-richtung-alle"));
        await expect(knopf).toBeEnabled();
        await expect(knopf).toHaveAttribute("title", /flussabwärts in alle Arme/);
        await page.screenshot({ path: "test-results/wegeditor-fliessrichtung-vorher.png" });
        await knopf.click();
        await expect(page.getByTestId(id("wahl-2"))).toHaveClass(/wegeditor__nummer--leuchtet/);
        await expect(page.getByTestId(id("wahl-3"))).not.toHaveClass(/wegeditor__nummer--leuchtet/);
        await expect(page.getByTestId(id("meldung"))).toHaveText(
            "Fließrichtung von Abschnitt 1 dem Lauf nach an 2 der 3 übrigen Abschnitte gegeben. Umgedreht: Abschnitt 2. Nicht erreicht: Abschnitt 4, dort ist der Fluss unterbrochen.",
        );
        await expect(knopf).toBeDisabled();
        await expect(knopf).toHaveAttribute("title", "Der Fluss fließt von hier aus schon so.");
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toContainText("1");
        await page.screenshot({ path: "test-results/wegeditor-fliessrichtung-nachher.png" });
        // (W): jetzt durchgehend.
        await page.getByTestId(id("wahl-ganz")).click();
        await expect(text).toHaveText("durchgehend");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        const abschnitte = gesendet[0]!.body["sections"] as Record<string, unknown>[];
        expect(abschnitte.map((a) => a["flowDirection"])).toEqual([undefined, "reverse", undefined, undefined]);
        expect(netzAbrufe).toBeGreaterThan(0);
    });

    test("🔴 Wiki-Box „An alle Abschnitte“ (OPS-000112): hängt der Artikel an 1 von 2, weist ihn noch einmal zu; Abschnitt 2 leuchtet, der Fuß nennt ihn, danach fehlt der Knopf", async ({
        page,
    }) => {
        await schreibStubs(page);
        const zugewiesen: string[] = [];
        const ARTIKEL = {
            key: "reichsstrasse-3",
            url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3",
            name: "Reichsstraße 3",
        };
        await oeffneWegeFenster(
            page,
            async (p) => {
                await p.route(/\/api\/editor\/wiki-box\/weg\/[0-9a-f-]{36}(\?.*)?$/, (route) =>
                    route.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({
                            art: "weg",
                            id: RS,
                            name: "Reichsstraße 3",
                            artikel: ARTIKEL,
                            ...(zugewiesen.length === 0 ? { anteil: { mit: 1, von: 2 } } : {}),
                            sync: { moeglich: false, grund: "kein_stand", laeuft: false, letzter: null, fehler: null },
                            weitere: [],
                        }),
                    }),
                );
                await p.route(/\/api\/editor\/wiki-box\/weg\/[0-9a-f-]{36}\/zuweisen$/, (route) => {
                    const body = route.request().postDataJSON() as { operationId: string; key: string };
                    zugewiesen.push(body.key);
                    return route.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({
                            operationId: body.operationId,
                            status: "applied",
                            environment: "development",
                            affected: [
                                { kind: "path", id: RS, revision: 5 },
                                { kind: "path", id: RS2, revision: 3 },
                            ],
                            derivedWork: [],
                            warnings: [],
                            mapRevision: 91,
                        }),
                    });
                });
            },
            SCHREIBEN,
        );
        await liste(page).getByText("Reichsstraße 3").first().click();
        const id = (s: string) => new RegExp(`^wegeditor-fenster-\\d+-${s}$`);
        const knopf = page.getByTestId(id("wiki-an-alle"));
        await expect(page.getByTestId(id("wiki-artikel"))).toContainText("Artikel an 1 von 2 Abschnitten");
        await expect(knopf).toBeEnabled();
        // Ein ungespeicherter Entwurf sperrt ihn wie „Ändern“ (die Box wirkt sofort auf dem Server).
        await page.getByTestId(id("wahl-2")).click();
        await page.getByTestId(id("rm-haken-cart")).click();
        await expect(knopf).toBeDisabled();
        await page.getByTestId("wege-leiste-verwerfen").click();
        await expect(knopf).toBeEnabled();
        await knopf.click();
        await expect.poll(() => zugewiesen).toEqual(["reichsstrasse-3"]);
        await expect(page.getByTestId(id("wahl-2"))).toHaveClass(/wegeditor__nummer--leuchtet/);
        await expect(page.getByTestId(id("meldung"))).toHaveText("Artikel „Reichsstraße 3“ an Abschnitt 2 gehängt.");
        await expect(knopf).toHaveCount(0);
        await page.screenshot({ path: "test-results/wegeditor-wiki-an-alle.png" });
    });

    test("🔴 Fluss und Bach (Plan Fluss/Bach): (2) wird Bach, die Tafel zeigt die Fließrichtung, „in Zeichenrichtung“; „Fertig“ schreibt Flussweg, Bach und Richtung nur an ihm, ohne seine Landmittel", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        await page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/).click();
        // Am Landweg gibt es keine Fließrichtung.
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-tafel-richtung$/)).toHaveCount(0);
        await page
            .getByTestId(/^wegeditor-fenster-\d+-tafel-wegtyp$/)
            .locator("select")
            .selectOption("Bach");
        const richtung = page.getByTestId(/^wegeditor-fenster-\d+-tafel-richtung$/).locator("select");
        await expect(richtung).toHaveValue("offen");
        // Offen lässt sich nicht umkehren.
        const umkehren = page.getByTestId(/^wegeditor-fenster-\d+-tafel-richtung-umkehren$/);
        await expect(umkehren).toBeDisabled();
        await richtung.selectOption("forward");
        await expect(richtung).toHaveValue("forward");
        await umkehren.click();
        await expect(richtung).toHaveValue("reverse");
        await page.screenshot({ path: "test-results/wegeditor-fluss-bach.png" });
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4 },
                { publicId: RS2, baseRevision: 2, subtype: "Flussweg", bach: true, flowDirection: "reverse" },
            ],
        });
        // Die Reisemittel der Karawane gehen nicht mit: Über Land und Wasser setzt der Server die Vorgabe der neuen Art.
        expect((gesendet[0]!.body["sections"] as Record<string, unknown>[])[1]).not.toHaveProperty("reisen");
        expect((gesendet[0]!.body["sections"] as Record<string, unknown>[])[0]).not.toHaveProperty("subtype");
    });

    test("🔴 Wegtyp je Abschnitt (Schritt 3): (2) auf Pfad, oben steht „gemischt“; „Fertig“ schreibt den Wegtyp nur an ihm, die Wegart oben setzt wieder alle", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        const oben = page.getByTestId(/^wegeditor-fenster-\d+-feld-wegart$/).locator("select");
        await expect(oben).toHaveValue("Reichsstrasse");
        await page.getByTestId(/^wegeditor-fenster-\d+-wahl-2$/).click();
        const tafel = page.getByTestId(/^wegeditor-fenster-\d+-tafel-wegtyp$/).locator("select");
        await expect(tafel).toHaveValue("Reichsstrasse");
        await tafel.selectOption("Pfad");
        await expect(tafel).toHaveValue("Pfad");
        // Oben steht „gemischt“ mit beiden Wegtypen, bis jemand einen für alle wählt.
        await expect(oben).toHaveValue("");
        await expect(oben.locator("option").first()).toContainText("Reichsstraße, Pfad");
        // (W): die Tafel nennt beide, „gemischt“ zur Wahl.
        await page.getByTestId(/^wegeditor-fenster-\d+-wahl-ganz$/).click();
        await expect(tafel).toHaveValue("");
        await page.screenshot({ path: "test-results/wegeditor-wegtyp-je-abschnitt.png" });
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4 },
                { publicId: RS2, baseRevision: 2, subtype: "Pfad" },
            ],
        });
        expect((gesendet[0]!.body["sections"] as Record<string, unknown>[])[0]).not.toHaveProperty("subtype");
        expect(gesendet[0]!.body).not.toHaveProperty("subtype");
    });

    test("🔴 Karawanenroute: EINE Zeile über ihre Wegtypen, der Wegtyp „gemischt“, jeder Abschnitt nennt seinen; der Haken schreibt nur das Kennzeichen", async ({
        page,
    }) => {
        const KARAWANE = "c5c5c5c5-0000-4000-8000-0000000000f1";
        const KARAWANE2 = "c5c5c5c5-0000-4000-8000-0000000000f2";
        const route: EditorPathList["rows"][number] = {
            id: KARAWANE,
            name: "Karawanenroute von Keft nach Rashdul",
            subtype: "Strasse",
            mark: "karawanenroute",
            subtypes: ["Strasse", "Wuestenpfad"],
            isBach: false,
            circle: "voll",
            segments: 2,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Keft", title: "Karawanenroute von Keft nach Rashdul" },
            bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
        };
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(
            page,
            async (p) => {
                await p.route("**/api/editor/paths", (r) =>
                    r.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({ rows: [...LISTE.rows, route] }),
                    }),
                );
                await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (r) => {
                    const id = r.request().url().split("/").at(-2)!;
                    const body: EditorPathStreet =
                        id === KARAWANE || id === KARAWANE2
                            ? {
                                  id: KARAWANE,
                                  name: route.name,
                                  subtype: "Strasse",
                                  mark: "karawanenroute",
                                  subtypes: ["Strasse", "Wuestenpfad"],
                                  isBach: false,
                                  circle: "voll",
                                  labelVisible: true,
                                  wiki: route.wiki!,
                                  segments: [
                                      {
                                          id: KARAWANE,
                                          revision: 4,
                                          labelVisible: true,
                                          wiki: true,
                                          points: 5,
                                          subtype: "Strasse",
                                      },
                                      {
                                          id: KARAWANE2,
                                          revision: 2,
                                          labelVisible: true,
                                          wiki: true,
                                          points: 3,
                                          subtype: "Wuestenpfad",
                                      },
                                  ],
                                  bounds: route.bounds!,
                              }
                            : strasse(id);
                    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
                });
            },
            SCHREIBEN,
        );
        const zeilen = liste(page).getByText("Karawanenroute von Keft nach Rashdul");
        await expect(zeilen).toHaveCount(1);
        await zeilen.click();
        const eigenschaften = page.getByTestId(/^wegeditor-fenster-\d+-eigenschaften$/);
        await expect(eigenschaften).toBeVisible();
        const fensterKopf = fenster(page);
        await expect(fensterKopf).toContainText("Karawanenroute · auf Straße, Wüstenpfad");
        const wegart = page.getByTestId(/^wegeditor-fenster-\d+-feld-wegart$/).locator("select");
        await expect(wegart).toHaveValue("");
        await expect(wegart.locator("option:checked")).toHaveText("gemischt: Straße, Wüstenpfad");
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-abschnitte$/)).toContainText("Wüstenpfad");
        const haken = page.getByTestId(/^wegeditor-fenster-\d+-feld-karawanenroute$/);
        await expect(haken).toBeChecked();
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-kennzeichen$/)).toContainText(
            "ohne eigene Reisewerte",
        );
        await haken.click();
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toContainText("1");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: KARAWANE, baseRevision: 4 },
                { publicId: KARAWANE2, baseRevision: 2 },
            ],
            mark: "",
        });
        expect(gesendet[0]!.body).not.toHaveProperty("subtype");
    });

    test("🔴 Wiki-Feld (WI-0225): Name, Wegtyp und Kennzeichen gegen den Artikel; ↺ am Kennzeichen setzt den Haken, „Alles auf Wiki-Werte“ zählt", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        const mitArtikel = (id: string): EditorPathStreet => ({
            ...strasseAufKarte(id),
            name: "Reichsstraße 3",
            subtype: "Pfad",
            artikel: {
                key: "keft-rashdul",
                url: "https://de.wiki-aventurica.de/wiki/Keft",
                name: "Karawanenroute von Keft nach Rashdul",
                werte: {
                    name: "Karawanenroute von Keft nach Rashdul",
                    subtype: "Karawanenroute",
                    mark: "Karawanenroute",
                },
            },
        });
        await oeffneWegeFenster(
            page,
            async (p) => {
                await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (r) => {
                    const id = r.request().url().split("/").at(-2)!;
                    return r.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify(mitArtikel(id)),
                    });
                });
            },
            SCHREIBEN,
        );
        await liste(page).getByText("Reichsstraße 3").first().click();
        const zeile = (name: string) => page.getByTestId(new RegExp(`^wegeditor-fenster-\\d+-zeile-${name}$`));
        // Der Name weicht ab: Wiki-Wert durchgestrichen hinter der Beschriftung, ↺ wach.
        await expect(zeile("name")).toHaveAttribute("data-zustand", "weicht");
        await expect(zeile("name").locator("s")).toHaveText("Karawanenroute von Keft nach Rashdul");
        // Die Karawanenroute gehört dem Kennzeichen; der Wegtyp hat kein Gegenstück.
        await expect(zeile("wegtyp")).toHaveAttribute("data-zustand", "ohne");
        await expect(zeile("kennzeichen")).toHaveAttribute("data-zustand", "weicht");
        const alle = page.getByTestId(/^wegeditor-fenster-\d+-alle-wiki$/);
        await expect(alle).toContainText("(2)");
        await page.getByTestId(/^wegeditor-fenster-\d+-zeile-kennzeichen-zurueck$/).click();
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-karawanenroute$/)).toBeChecked();
        // ↺ setzt Wert UND Herkunft wiki (WI-0225 §7): Das Feld folgt dem Wiki.
        await expect(zeile("kennzeichen")).toHaveAttribute("data-zustand", "folgt");
        await expect(alle).toContainText("(1)");
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        // ↺ geht als `{ revert: "wiki" }`: Den Wert holt der Server aus dem Artikel und vermerkt Herkunft wiki.
        expect(gesendet[0]!.body).toMatchObject({ mark: { revert: "wiki" } });
        expect(gesendet[0]!.body).not.toHaveProperty("name");
        expect(gesendet[0]!.body).not.toHaveProperty("subtype");
    });

    test("🔴 Weitere Straßennamen (WI-0302): Teil-Chip mit „allen geben“, Vorschläge nur aus Wiki-Artikeln samt Sperren, Tastatur, ✕; „Fertig“ schreibt die Listen; geteilte Abschnitte zählen mit und öffnen ihre Straße", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        const gefragt: string[] = [];
        const PILGER = { key: "pilgerweg", name: "Pilgerweg", url: "https://de.wiki-aventurica.de/wiki/Pilgerweg" };
        await oeffneWegeFenster(
            page,
            async (p) => {
                // Der erste Abschnitt der Reichsstraße trägt den Pilgerweg; ein Abschnitt des Pfads trägt den Artikel der Reichsstraße (geteilt).
                await p.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
                    const id = route.request().url().split("/").at(-2)!;
                    const d = strasse(id);
                    const body: EditorPathStreet =
                        d.id !== RS
                            ? d
                            : {
                                  ...d,
                                  artikel: {
                                      key: "reichsstrasse-3",
                                      url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3",
                                      name: "Reichsstraße 3",
                                      werte: {},
                                  },
                                  segments: d.segments.map((a, i) => (i === 0 ? { ...a, weitere: [PILGER] } : a)),
                                  geteilt: [
                                      {
                                          id: PFAD,
                                          strasse: "Pfad-3443",
                                          strasseId: PFAD,
                                          nummer: 1,
                                          von: "Sibur",
                                          bis: "Radoleth",
                                      },
                                  ],
                              };
                    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
                });
                await p.route(/\/api\/editor\/wiki-box\/weg\/[0-9a-f-]{36}\/suche/, (route) => {
                    gefragt.push(new URL(route.request().url()).searchParams.get("q") ?? "");
                    return route.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({
                            articles: [
                                {
                                    key: "reichsstrasse-3",
                                    url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3",
                                    name: "Reichsstraße 3",
                                    werte: { art: "Reichsstraße" },
                                },
                                {
                                    key: "goldfelser-stieg",
                                    url: "https://de.wiki-aventurica.de/wiki/Goldfelser_Stieg",
                                    name: "Goldfelser Stieg",
                                    werte: { art: "Kronstraße", lage: "Aurelat, Coverna" },
                                    belegt: "Sikramstieg",
                                },
                                { ...PILGER, werte: {} },
                            ],
                        }),
                    });
                });
            },
            SCHREIBEN,
        );
        await liste(page).getByText("Reichsstraße 3").first().click();
        // Zwei eigene Abschnitte und ein geteilter: „Abschnitte (3)“; der geteilte steht gestrichelt mit seiner Herkunft.
        const kasten = page.getByTestId(/^wegeditor-fenster-\d+-abschnitte$/).filter({ visible: true });
        await expect(kasten).toContainText("Abschnitte (3)");
        const geteilt = page.getByTestId(/^wegeditor-fenster-\d+-geteilt$/).filter({ visible: true });
        await expect(geteilt).toContainText("Geteilt, mitgezählt:");
        await expect(geteilt).toContainText("Sibur → Radoleth");
        await expect(geteilt).toContainText("gehört zu Pfad-3443, Abschnitt 1");
        await expect(page.getByTestId(/^wegeditor-fenster-\d+-tafel-geteilt$/)).toContainText("zählt mit");
        // (W): Der Pilgerweg steht an einem von zwei Abschnitten, „allen geben“ gibt ihn beiden.
        const chips = page.getByTestId(/^wegeditor-fenster-\d+-weitere-chip$/);
        await expect(chips).toHaveCount(1);
        await expect(chips.first()).toContainText("Pilgerweg");
        await expect(chips.first()).toContainText("1 von 2");
        await chips
            .first()
            .getByTestId(/-weitere-allen$/)
            .click();
        await expect(chips.first()).not.toContainText("1 von 2");
        await expect(page.getByTestId("wege-leiste-ungespeichert")).toContainText("1");
        // Die Suche fragt die Wiki-Box; der Hauptartikel und ein Name, den alle tragen, sind gesperrt; der Treffer nennt Art, Lage, „hängt an“.
        const eingabe = page.getByTestId(/^wegeditor-fenster-\d+-weitere-eingabe$/);
        await eingabe.fill("Gold");
        const vorschlaege = page.getByTestId(/^wegeditor-fenster-\d+-weitere-vorschlag$/);
        await expect(vorschlaege.first()).toContainText("Goldfelser Stieg");
        await expect(vorschlaege.first()).toContainText("Kronstraße · Aurelat, Coverna · hängt an „Sikramstieg“");
        await expect(vorschlaege.filter({ hasText: "Reichsstraße 3" })).toHaveAttribute("aria-disabled", "true");
        await expect(vorschlaege.filter({ hasText: "Pilgerweg" })).toHaveAttribute("aria-disabled", "true");
        expect(gefragt).toContain("Gold");
        // Esc schließt nur die Liste; die Bearbeitung bleibt.
        await eingabe.press("Escape");
        await expect(vorschlaege).toHaveCount(0);
        await expect(page.getByTestId("wege-leiste-fertig")).toBeVisible();
        // Keine Vorauswahl: Das erste Enter zeigt auf den ersten freien Vorschlag, das zweite nimmt ihn.
        await eingabe.press("ArrowDown");
        await expect(eingabe).toHaveAttribute("aria-activedescendant", /-weitere-opt-0$/);
        await eingabe.press("Escape");
        await eingabe.press("Enter");
        await expect(eingabe).toHaveAttribute("aria-activedescendant", /-weitere-opt-0$/);
        await eingabe.press("Enter");
        await expect(chips).toHaveCount(2);
        await expect(chips.nth(1)).toContainText("Goldfelser Stieg");
        await expect(eingabe).toHaveValue("");
        // Rücktaste im leeren Feld markiert den letzten Chip, die zweite löst ihn; ✕ löst ebenso.
        await eingabe.press("Backspace");
        await expect(chips.nth(1)).toHaveClass(/weitere__chip--markiert/);
        await eingabe.press("Backspace");
        await expect(chips).toHaveCount(1);
        await eingabe.fill("Gold");
        await expect(vorschlaege.first()).toContainText("Goldfelser Stieg");
        await eingabe.press("ArrowDown");
        await eingabe.press("Enter");
        await expect(chips).toHaveCount(2);
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        expect(gesendet[0]!.body).toMatchObject({
            sections: [
                { publicId: RS, baseRevision: 4, weitere: ["pilgerweg", "goldfelser-stieg"] },
                { publicId: RS2, baseRevision: 2, weitere: ["pilgerweg", "goldfelser-stieg"] },
            ],
        });
        // Ein Klick auf den geteilten Abschnitt öffnet seine Straße an der Stelle dieses Fensters (das bisherige liegt abgelegt, D19).
        await page.getByTestId(/^wegeditor-fenster-\d+-geteilt-oeffnen$/).click();
        // Der Pfad des Stubs hat zwei Abschnitte; gewählt ist genau der geteilte (1).
        await expect(kasten).toContainText("Abschnitte (2)");
        await expect(kasten.getByTestId(/-wahl-1$/)).toHaveAttribute("aria-pressed", "true");
        await expect(kasten.getByTestId(/-wahl-2$/)).toHaveAttribute("aria-pressed", "false");
        await expect(kasten).toContainText("Gilt für Abschnitt 1");
        await expect(geteilt).toHaveCount(0);
        await expect(liste(page).filter({ visible: true })).toHaveCount(1);
    });

    test("W5b: ein Klick in der Liste öffnet die andere Straße an der Stelle DIESES Fensters, nicht in einem zweiten", async ({
        page,
    }) => {
        await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        await expect(
            page
                .getByTestId(/^wegeditor-fenster-\d+-feld-name$/)
                .locator("input")
                .filter({ visible: true }),
        ).toHaveValue("Reichsstraße 3");
        await liste(page).getByText("Unbezeichneter Pfad").first().click();
        // Ein Griff ist kein Name (WI-0105): Das Feld steht leer.
        await expect(
            page
                .getByTestId(/^wegeditor-fenster-\d+-feld-name$/)
                .locator("input")
                .filter({ visible: true }),
        ).toHaveValue("");
        await expect(
            page
                .getByTestId(/^wegeditor-fenster-\d+-feld-wegart$/)
                .locator("select")
                .filter({ visible: true }),
        ).toHaveValue("Pfad");
        // Das bisherige liegt abgelegt (D19); zu sehen ist EIN Fenster.
        await expect(liste(page).filter({ visible: true })).toHaveCount(1);
    });
});

test.describe("W5b bei 1280 px mit offener Liste (EDIT-0003 T45 (3))", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("🔴 keine Lücke neben Planer und Fenster: die Leiste der Felder steht unten im Fenster, „Fertig“ ist klickbar", async ({
        page,
    }) => {
        const gesendet = await schreibStubs(page);
        await oeffneWegeFenster(page, undefined, SCHREIBEN);
        await liste(page).getByText("Reichsstraße 3").first().click();
        const name = page
            .getByTestId(/^wegeditor-fenster-\d+-feld-name$/)
            .locator("input")
            .filter({ visible: true });
        await name.fill("Reichsstraße 4");
        await name.press("Tab");
        await expect(page.locator('dialog[data-lage="angedockt"]').getByTestId("wege-leiste")).toBeVisible();
        await page.getByTestId("wege-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        await expect(page.getByTestId("wege-leiste")).toHaveCount(0);
    });
});

test("🔴 T54 Gelöscht: nur unter der Facette „Gelöscht“, das Fenster lesend mit Band; ↺ im Verlauf fragt den Server und holt die Straße als EINE Rücknahme zurück (WI-0265 B6a)", async ({
    page,
}) => {
    const geloeschtVon = "c5c5c5c5-0000-4000-9000-0000000000d3";
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/history(\?.*)?$/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                entries: [
                    {
                        operationId: geloeschtVon,
                        seq: 41,
                        at: "2026-10-18T10:00:00.000Z",
                        operation: "path.delete",
                        source: "editor",
                        summary: "Alte Zollstraße: gelöscht",
                        actor: { kind: "person", name: "Thomas" },
                        objects: [
                            {
                                kind: "path",
                                id: GELOESCHT,
                                name: "Alte Zollstraße",
                                action: "path.deleted",
                                revisionBefore: 2,
                                revisionAfter: 3,
                                changes: { active: { before: true, after: false } },
                            },
                        ],
                    },
                ],
            }),
        }),
    );
    // Der Server prüft (Vorprüfung, liest nur) und schreibt EINE Rücknahme (`restore-series`); beide Antworten sind hier gestellt, der echte Ablauf steht in `ruecknahme-weg.test.ts`.
    const vorschau: unknown[] = [];
    const geholt: unknown[] = [];
    await page.route(`**/api/editor/paths/${GELOESCHT}/restore-series/preview`, (route) => {
        vorschau.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ergebnis: "ok",
                membersHash: "f".repeat(64),
                mitglieder: [
                    {
                        operationId: geloeschtVon,
                        seq: 41,
                        at: "2026-10-18T10:00:00.000Z",
                        operation: "path.delete",
                        source: "editor",
                        actor: { kind: "person", name: "Thomas" },
                        status: "ruecknehmbar",
                        offen: true,
                        gegenstaende: [
                            {
                                kind: "path",
                                id: GELOESCHT,
                                name: "Alte Zollstraße",
                                action: "path.deleted",
                                revisionBefore: 2,
                                revisionAfter: 3,
                                felder: ["active"],
                            },
                        ],
                    },
                ],
                offen: [geloeschtVon],
                gegenstaende: [],
                konflikte: [],
                sperren: [],
                fehlendeRechte: [],
                fremdePersonen: [],
                reasonRequired: false,
                folgen: { gegenstaende: 1, gelaende: "keines" },
            }),
        });
    });
    await page.route(`**/api/editor/paths/${GELOESCHT}/restore-series`, (route) => {
        geholt.push({ url: route.request().url(), body: route.request().postDataJSON() });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "c5c5c5c5-0000-4000-9000-0000000000d4",
                status: "applied",
                environment: "test",
                affected: [{ kind: "path", id: GELOESCHT, revision: 4 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 4801,
                reverts: [geloeschtVon],
            }),
        });
    });
    await oeffneWegeFenster(
        page,
        undefined,
        [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        true,
    );
    // Standardmäßig aus: Die Suche findet die gelöschte Straße nicht.
    await liste(page).getByRole("searchbox").fill("Zollstraße");
    await expect(liste(page).getByRole("option")).toHaveCount(0);
    await page.locator('[data-testid$="-wege-filter"]').filter({ visible: true }).click();
    await page.locator('[data-testid$="-wege-filter-stand-geloescht"]').filter({ visible: true }).click();
    await page.keyboard.press("Escape");
    await liste(page)
        .getByRole("option", { name: /Alte Zollstraße/ })
        .click();
    await expect(liste(page)).toContainText("Gelöscht");
    // Lesend, mit dem Band: keine Felder.
    const band = page.getByTestId(/^wegeditor-fenster-\d+-stand$/).filter({ visible: true });
    await expect(band).toContainText("Gelöscht. Der Verlauf holt ihn zurück.");
    await expect(page.getByTestId(/^wegeditor-fenster-\d+-feld-name$/)).toHaveCount(0);
    await band.getByRole("button", { name: "Verlauf" }).click();
    // ↺ steht im aufgeklappten Eintrag, fragt den Server und danach mit den Folgen (R13); geschrieben ist bis zur Bestätigung nichts.
    await page
        .locator('[data-testid$="-verlauf-eintrag"]')
        .filter({ visible: true })
        .first()
        .locator("summary")
        .click();
    await page.locator('[data-testid$="-ruecknahme"]').filter({ visible: true }).click();
    const frage = page.locator('[data-testid$="-ruecknahme-frage"]').filter({ visible: true });
    await expect(frage).toContainText("1 Abschnitt kommt zurück auf die Karte.");
    expect(vorschau).toEqual([{ members: [geloeschtVon] }]);
    expect(geholt).toEqual([]);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => geholt.length).toBe(1);
    expect(geholt[0]).toMatchObject({
        url: expect.stringContaining(`/api/editor/paths/${GELOESCHT}/restore-series`),
        body: { operationId: expect.any(String), members: [geloeschtVon], membersHash: "f".repeat(64) },
    });
});
