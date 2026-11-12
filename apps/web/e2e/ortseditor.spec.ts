import { expect, test, type Page } from "@playwright/test";
import { GRATENFELS, fenster, langeListe, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Der Ortseditor als Werkzeugfenster am echten Stack (WI-0128 E6, EDIT-0001 §7.1 E6, T6.1 bis T6.7): angedockt, gelöst, abgelegt;
 * öffnen und ablegen (D19); „Offene Bearbeitungen“; die Medienverwaltung aus dem Ortseditor nicht modal. Hinflug und Auswahl (E7)
 * prüft `ortseditor-hinflug.spec.ts`; die Liste legt `ortseditor-stub.ts` hin.
 */
test("🔴 das Verb öffnet den Ortseditor angedockt am rechten Rand; er meldet sich als Rand und ist nicht modal", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await expect(fenster(page)).toHaveCount(1);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await expect(fenster(page)).toHaveAttribute("data-map-overlay", "right");
    expect(await fenster(page).evaluate((element) => element.matches(":modal"))).toBe(false);
    // Keine Reiter Alle · Platziert · Fehlt mehr (Betreiber 2026-10-11): „Karte“ steht als erste Facette im Trichter.
    await expect(fenster(page).locator('[data-testid$="-orte-ansicht"]')).toHaveCount(0);
    await expect(zeile(page, "Gratenfels")).toHaveCount(1);
    // Die Karte bleibt bedienbar: kein Schleier über ihr.
    await expect(page.locator("dialog:modal")).toHaveCount(0);
});

test("🔴 „Auf der Karte“ und „Nicht auf der Karte“ stehen als erste Facette im Trichter und filtern mit den anderen", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await fenster(page).locator('[data-testid$="-orte-filter"]').click();
    const blatt = page.locator('[data-testid$="-orte-filter-blatt"]');
    await expect(blatt.locator("fieldset").first()).toHaveAttribute("data-testid", /-orte-filter-karte$/);
    await expect(blatt.locator('[data-testid$="-orte-filter-karte"] .filterknopf__wert')).toHaveText([
        "Auf der Karte",
        "Nicht auf der Karte",
    ]);
    // Die frühere Maske ist ein Abschnitt im Trichter („Arten“, eine Wahl, „alle“ zuerst), gleich nach der Karte (Guide §13.45).
    await expect(blatt.locator("fieldset").nth(1)).toHaveAttribute("data-testid", /-orte-filter-maske$/);

    await blatt.locator('[data-testid$="-orte-filter-karte-nicht"]').click();
    await expect(zeile(page, "Gratenfels")).toHaveCount(0);
    // Die Vorbelegung der Lage zählt mit („außerorts“; „unklar“ kommt im Stub nicht vor und fällt weg), dazu dieser Wert.
    await expect(fenster(page).locator('[data-testid$="-orte-filter-zahl"]')).toHaveText("2");
    await blatt.locator('[data-testid$="-orte-filter-loesen"]').click();
    await expect(zeile(page, "Gratenfels")).toHaveCount(1);
});

test("🔴 Leiste der Ortsliste (AvmListenleiste, Guide §13.45): Suche links, Trichter und Sortierzeichen rechtsbündig; die Arten wählt der Trichter", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    const suche = fenster(page).locator('[data-testid$="-orte-leiste-suche"]');
    const trichter = fenster(page).locator('[data-testid$="-orte-filter"]');
    const sortierung = fenster(page).locator('[data-testid$="-orte-sortierung"]');
    const [s, f, o] = await Promise.all([suche.boundingBox(), trichter.boundingBox(), sortierung.boundingBox()]);
    expect(Math.abs(s!.y - f!.y)).toBeLessThan(4);
    expect(Math.abs(f!.y - o!.y)).toBeLessThan(4);
    expect(s!.x + s!.width).toBeLessThanOrEqual(f!.x);
    expect(f!.x + f!.width).toBeLessThanOrEqual(o!.x);
    // Rechtsbündig: Nach der Sortierung folgen nur noch ✚ und Papierkorb (WI-0183, `ortseditor-ohne-band.spec.ts`); der
    // Papierkorb schließt mit der Leiste ab, die Suche nimmt den Rest.
    const leiste = await fenster(page).locator('[data-testid$="-orte-leiste"]').boundingBox();
    const papierkorb = await fenster(page).locator('[data-testid$="-leiste-entfernen"]').boundingBox();
    expect(o!.x + o!.width).toBeLessThan(papierkorb!.x);
    expect(Math.abs(leiste!.x + leiste!.width - (papierkorb!.x + papierkorb!.width))).toBeLessThan(2);
    expect(Math.abs(leiste!.x - s!.x)).toBeLessThan(2);
    await expect(fenster(page).locator("select")).toHaveCount(0);
    await expect(sortierung).toHaveAttribute("aria-label", "Sortierung: Name");

    // Sortierung: der Menüknopf mit drei Ordnungen.
    await sortierung.click();
    const menue = page.locator('[data-testid$="-orte-sortierung-menue"]');
    await expect(menue.getByRole("menuitemradio")).toHaveText([/Name$/, /Ortsgröße$/, /Zustand$/]);
    await menue.getByRole("menuitemradio", { name: /Ortsgröße/ }).click();
    await expect(sortierung).toHaveAttribute("aria-label", "Sortierung: Ortsgröße");

    // Arten: „Siedlungen“ blendet den Wachturm aus, „alle“ holt ihn zurück.
    await trichter.click();
    await page.locator('[data-testid$="-orte-filter-maske-siedlungen"]').click();
    await expect(zeile(page, "Wachturm am Großen Fluss")).toHaveCount(0);
    await page.locator('[data-testid$="-orte-filter-maske-alle"]').click();
    await expect(zeile(page, "Wachturm am Großen Fluss")).toHaveCount(1);
});

test("🔴 Lage wie Legacy vorbelegt „außerorts + unklar“; Suche und Filter bleiben, wenn ein Klick einen Ort öffnet", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    // Die Stätte liegt innerorts und ist vorbelegt ausgeblendet; der Knopf sagt, dass ein Filter wirkt.
    await expect(zeile(page, "Albenhuser Tor")).toHaveCount(0);
    await expect(zeile(page, "Wachturm am Großen Fluss")).toHaveCount(1);
    const knopf = fenster(page).locator('[data-testid$="-orte-filter-zahl"]');
    // „unklar“ kommt im Stub nicht vor und fällt aus der Vorbelegung (Legacy: kein Wert filtert unsichtbar weiter).
    await expect(knopf).toHaveText("1");
    const suche = () => fenster(page).locator('[data-testid$="-orte-leiste-suche"] input');
    await suche().fill("grat");
    await zeile(page, "Gratenfels").click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    // Jeder Ort hat sein eigenes Fenster (D19); Suche und Filter sind dieselben geblieben, nicht neu.
    await expect(suche()).toHaveValue("grat");
    await expect(knopf).toHaveText("1");
    await expect(zeile(page, "Ferdok")).toHaveCount(0);
});

test("🔴 öffnen und ablegen (D19): ein Klick öffnet den Ort im Fenster, ein zweiter Ort legt den ersten mit Entwurf ab", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    // Das leere Fenster hat den Ort übernommen: keine leere Zeile unter „Offene Bearbeitungen“.
    await expect(page.locator('[data-testid^="bearbeitung-fenster-"]')).toHaveCount(0);
    await expect(fenster(page).locator('[data-feld="einwohner"]')).not.toHaveText("…");

    await zeile(page, "Ferdok").click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Ferdok");
    await expect(fenster(page)).toHaveCount(1);
    // Gratenfels liegt jetzt abgelegt im Editorpanel (sichtbar, sobald das angedockte Fenster weg ist).
    await fenster(page).getByTestId("fenster-ablegen").click();
    const ablage = page.getByTestId("editor-panel-bearbeitungen");
    await expect(ablage).toContainText("Orte bearbeiten · Gratenfels");
    await expect(ablage).toContainText("Orte bearbeiten · Ferdok");
    // Ein Klick auf die Zeile holt Gratenfels zurück in seine letzte Lage.
    await ablage.getByRole("button", { name: /Gratenfels/ }).click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
});

/**
 * Der Hinweis zum Drehen und Neigen steht beim ersten Besuch, und seit 42612d638 (WI-0218, `--z-map-hint`) vor dem Planer und damit bei
 * 1280 px auch über dem Kopf des angedockten Fensters: Der Griff dort fing ihn statt des Kopfs (`elementFromPoint`: `camera-hint`). Er
 * gilt hier als schon gesehen, wie bei jedem, der die Karte vorher besucht hat (`camera-controls.vue`, `avesmaps3d.hinweis-3d`).
 * 🪤 Ein Klick auf „Verstanden“ taugt nicht: Bei 1280 × 720 mit angedocktem Fenster fing ihn der Routenplaner (Prüfbank 2026-10-19).
 * Vor dem Laden aufrufen.
 */
async function kameraHinweisGesehen(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            globalThis.localStorage.setItem("avesmaps3d.hinweis-3d", "gesehen");
        } catch {
            // Ohne Speicher steht der Hinweis; der Fall zeigt es dann.
        }
    });
}

test("🔴 T6.1 der Griff löst erst ab 6 px; das gelöste Fenster verschiebt sich deckend und behält seine Lage nach dem Neuladen (T6.4, T6.7)", async ({
    page,
}) => {
    await kameraHinweisGesehen(page);
    await oeffneOrtseditor(page);
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);
    const kopf = fenster(page).locator(".avm-fenster__kopf");
    const box = (await kopf.boundingBox())!;
    const x = box.x + 40;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 3, y + 2);
    await page.mouse.up();
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 120, y + 60, { steps: 6 });
    // Beim Ziehen bleibt das Fenster deckend (T6.7).
    expect(await fenster(page).evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    await page.mouse.up();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    expect(await fenster(page).evaluate((element) => element.matches(":modal"))).toBe(false);
    await expect(fenster(page)).not.toHaveAttribute("data-map-overlay", "right");

    // Nach dem Neuladen öffnet das Verb wieder gelöst, an derselben Stelle.
    const vorher = (await fenster(page).boundingBox())!;
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    if (!(await page.getByTestId("editorpanel-verb").isVisible())) await page.getByTestId("editor-panel-tab").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    const nachher = (await fenster(page).boundingBox())!;
    expect(Math.abs(nachher.x - vorher.x)).toBeLessThan(2);
    expect(Math.abs(nachher.y - vorher.y)).toBeLessThan(2);
});

test("🔴 T6.2 ein gelöstes Fenster, auf „Offene Bearbeitungen“ gezogen, wird abgelegt (der Kasten leuchtet); ▥ dockt wieder an", async ({
    page,
}) => {
    await kameraHinweisGesehen(page);
    await oeffneOrtseditor(page);
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);
    await fenster(page).getByTestId("fenster-loesen").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    await fenster(page).getByTestId("fenster-andocken").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await fenster(page).getByTestId("fenster-loesen").click();
    // Das Fenster weit nach links, damit das Editorpanel rechts frei liegt, dann zurück auf das Panel ziehen.
    const kopf = fenster(page).locator(".avm-fenster__kopf");
    const box = (await kopf.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 400, box.y + 200, { steps: 8 });
    await page.mouse.up();
    const ablage = page.getByTestId("editor-panel-bearbeitungen");
    const ziel = (await ablage.boundingBox())!;
    const kopf2 = (await kopf.boundingBox())!;
    await page.mouse.move(kopf2.x + 30, kopf2.y + kopf2.height / 2);
    await page.mouse.down();
    await page.mouse.move(ziel.x + ziel.width / 2, ziel.y + ziel.height / 2, { steps: 10 });
    await expect(ablage).toHaveAttribute("data-fenster-ziel", "");
    await expect(page.getByTestId("fenster-andockziel")).toHaveCount(0);
    await page.mouse.up();
    await expect(fenster(page)).toHaveCount(0);
    await expect(ablage).toContainText("Ortseditor");
    await expect(ablage).not.toHaveAttribute("data-fenster-ziel", "");
});

test("🔴 ein gelöstes Fenster, mit dem Zeiger an den rechten Rand gezogen, dockt an (Vorschau beim Ziehen); über dem übrigen Editorpanel bleibt es gelöst", async ({
    page,
}) => {
    // Betreiber 2026-10-11: „ich kann ihn abdocken, aber rechts mit drag n drop wieder andocken“.
    await oeffneOrtseditor(page);
    await fenster(page).getByTestId("fenster-loesen").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    const kopf = fenster(page).locator(".avm-fenster__kopf");
    const breite = page.viewportSize()!.width;

    // Über die Mitte des Editorpanels (nicht auf „Offene Bearbeitungen“, nicht an den Rand): bleibt gelöst, steht dort.
    const panel = (await page.getByTestId("editor-panel").boundingBox())!;
    let start = (await kopf.boundingBox())!;
    await page.mouse.move(start.x + 30, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(panel.x + 60, panel.y + 120, { steps: 10 });
    await expect(page.getByTestId("fenster-andockziel")).toHaveCount(0);
    await page.mouse.up();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");

    // An den rechten Rand: Die Vorschau zeigt die angedockte Fläche, Loslassen dockt an.
    start = (await kopf.boundingBox())!;
    await page.mouse.move(start.x + 30, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(breite - 6, start.y + 140, { steps: 12 });
    const vorschau = page.getByTestId("fenster-andockziel");
    await expect(vorschau).toBeVisible();
    const flaeche = (await vorschau.boundingBox())!;
    expect(flaeche.x + flaeche.width).toBeGreaterThan(breite - 2);
    await page.mouse.up();
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await expect(vorschau).toHaveCount(0);
    await expect(fenster(page)).toHaveAttribute("data-map-overlay", "right");
});

test("🔴 T6.3 die Lasche „Info“ legt das angedockte Fenster ab; T6.6 der Wechsel fliegt als Platzhalter", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await expect(page.getByTestId("info-panel-tab")).toBeVisible();
    const platzhalter = page.waitForSelector('[data-testid="fenster-platzhalter"]', {
        state: "attached",
        timeout: 3000,
    });
    await page.getByTestId("info-panel-tab").click();
    await platzhalter;
    await expect(fenster(page)).toHaveCount(0);
    await expect(page.getByTestId("info-panel")).toBeVisible();
});

test("🔴 ✕ schließt ein Fenster ohne Änderungen; „Alle schließen“ räumt die Ablage", async ({ page }) => {
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await zeile(page, "Ferdok").click();
    await fenster(page).getByTestId("fenster-schliessen").click();
    await expect(fenster(page)).toHaveCount(0);
    const ablage = page.getByTestId("editor-panel-bearbeitungen");
    await expect(ablage).toContainText("Gratenfels");
    await page.getByTestId("bearbeitungen-alle-zu").click();
    await expect(ablage).not.toContainText("Gratenfels");
});

test("🔴 „Medienverwaltung › Wappen“ öffnet die Medienverwaltung nicht modal, gefiltert auf den Ort und das Wappen", async ({
    page,
}) => {
    await oeffneOrtseditor(page, {
        rechte: [
            "use_editor_menu",
            "view_media_private",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
    });
    await zeile(page, "Gratenfels").click();
    await fenster(page).getByRole("tab", { name: "Bilder" }).click();
    const suche = page.waitForRequest((request) => /\/api\/editor\/media\?/.test(request.url()));
    await fenster(page).locator('[data-testid$="-medien-wappen"]').click();
    const url = new URL((await suche).url());
    // Seit dem Asset-Typ (WI-0068 P4b, Migration 0095) filtert der Einstieg über den Typ, nicht über die Rolle.
    expect(url.searchParams.get("type")).toBe("coat");
    expect(url.searchParams.get("usedBy") ?? url.searchParams.get("von") ?? url.search).toContain(GRATENFELS);
    const medien = page.getByTestId("medien-fenster");
    await expect(medien).toHaveAttribute("data-lage", "geloest");
    expect(await medien.evaluate((element) => element.matches(":modal"))).toBe(false);
    // Der Ortseditor bleibt daneben offen.
    await expect(fenster(page)).toHaveCount(1);
});

test("🔴 E9: der Ortseditor nennt den Stand des Bearbeitens - Testwelt mit Hinweis, ausgeschaltet mit Grund am Speichern", async ({
    page,
}) => {
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await oeffneOrtseditor(page);
    // 🔴 Kein fester Zeitpunkt: Auf der Stage setzt seit WI-0144 der Production-Zug zurück, auf Knopfdruck (Betreiber
    // 2026-10-15: „JA ICH WEISS DASS EDITIEREN DURCH LEGACY ZÜGE ÜBERSCHRIEBEN WIRD … DASS MIR DAS EGAL IST“).
    await expect(fenster(page).locator('[data-testid$="-modus"]')).toHaveText(
        "Testwelt: Der nächste Zug setzt Änderungen zurück.",
    );
    await page.unroute("**/api/editor/status");
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "off", environment: "production" }),
        }),
    );
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    if (!(await page.getByTestId("editorpanel-verb").isVisible())) await page.getByTestId("editor-panel-tab").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page).locator('[data-testid$="-modus"]')).toHaveText(
        "Bearbeiten ist bis zum Umstieg gesperrt.",
    );
    await expect(fenster(page).locator('[data-testid$="-speichern"]')).toHaveAttribute(
        "title",
        "Bearbeiten ist bis zum Umstieg gesperrt.",
    );
});

test("🔴 die Ortsliste springt nicht nach der Wahl: Die Zeile bleibt unter dem Zeiger, auch wenn D19 ein neues oder ein abgelegtes Fenster zeigt; Hover und Wahl in EINER Form", async ({
    page,
}) => {
    // Betreiber 2026-10-11: „manchmal selektiert sie nicht, manchmal springt sie nach der auswahl, das hover hat einen andere
    // border-style wie die selektion“. Ursache: Jeder Klick zeigt ein anderes Fenster (D19), dessen Liste woanders stand.
    await oeffneOrtseditor(page, { liste: langeListe(200) });
    const rumpf = fenster(page).locator(".liste__rumpf");
    await rumpf.hover();
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    const r = (await rumpf.boundingBox())!;
    const x = r.x + r.width / 2;
    // Zwei Zeilen im Wechsel: Die erste kommt beim dritten Klick als abgelegtes Fenster zurück.
    for (const y of [r.y + 80, r.y + 220, r.y + 80, r.y + 220]) {
        const name = await page.evaluate(
            ([px, py]) =>
                document
                    .elementFromPoint(px, py)
                    ?.closest(".liste__eintrag")
                    ?.querySelector(".liste__text")
                    ?.textContent?.trim(),
            [x, y] as const,
        );
        await page.mouse.click(x, y);
        const gewaehlt = fenster(page).locator(".liste__eintrag.is-gewaehlt");
        await expect(gewaehlt.locator(".liste__text")).toHaveText(name!);
        await page.waitForTimeout(300);
        const box = (await gewaehlt.boundingBox())!;
        expect(Math.abs(box.y + box.height / 2 - y)).toBeLessThanOrEqual(box.height / 2);
    }
    // Gewählt: linker Balken in Gold und Fläche, ohne Rundung (Guide §13.12); gezeigt dieselbe Form mit farblosem Balken.
    const gewaehlt = fenster(page).locator(".liste__eintrag.is-gewaehlt");
    const stil = await gewaehlt.evaluate((element) => {
        const css = getComputedStyle(element);
        return { radius: css.borderTopLeftRadius, links: css.borderLeftWidth, oben: css.borderTopWidth };
    });
    expect(stil).toEqual({ radius: "0px", links: expect.not.stringMatching(/^0px$/), oben: "0px" });
});
