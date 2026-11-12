import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import {
    bedieneMedienrouten,
    GARETH,
    MIT_MEDIEN,
    medienQuelle,
    OHNE_MEDIEN,
    schliesseMedienQuelle,
    stubSitzung,
    type MedienQuelle,
} from "./medien-quelle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";

/**
 * Die Medienverwaltung am Rechner (WI-0068 P3) gegen die echten Medien der Entwicklungsdatenbank (`medien-quelle.ts`): drei Spalten,
 * Suche und Filter, der Inspector mit privaten Feldern, der tiefe Link, der Kontext-Einstieg aus dem Infopanel, „Auf Karte zeigen“
 * und das Recht. Die Sitzung ist ein Stub (Reviewer); geprüft wird am laufenden Stapel.
 */

let quelle: MedienQuelle | undefined;

test.beforeAll(async () => {
    quelle = await medienQuelle();
});
test.afterAll(async () => {
    await schliesseMedienQuelle();
});

async function oeffneKarte(page: Page, pfad = "/edit", recht = true): Promise<MedienQuelle> {
    test.skip(quelle === undefined, "ohne DATABASE_URL keine echten Medien");
    const q = quelle!;
    await stubSitzung(page, recht ? MIT_MEDIEN : OHNE_MEDIEN);
    // Seit `dd9f7476` (Betreiber 2026-10-14) steht in /edit beim Laden das Editorpanel vorn und verdeckt das Infopanel, an dem Wappen,
    // Kopfbild und „Auf Karte zeigen“ hängen. Die Fälle prüfen das Infopanel, also steht das Editorpanel gemerkt zu (WI-0192).
    await editorPanelGemerktZu(page);
    await bedieneMedienrouten(page, q);
    await page.goto(pfad);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    return q;
}

async function ueberMenue(page: Page): Promise<void> {
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-medien").click();
    await expect(page.getByRole("dialog", { name: "Medien" })).toBeVisible();
}

const fenster = (page: Page) => page.getByTestId("medien-fenster");

test("🔴 ohne Recht: kein Menüeintrag, kein Knopf am Wappen, und die echte Route sagt 401 ohne Sitzung", async ({
    page,
}) => {
    await oeffneKarte(page, "/edit", false);
    await page.getByTestId("kopfleiste-menue").click();
    await expect(page.getByTestId("hauptmenue")).toBeVisible();
    await expect(page.getByTestId("menue-medien")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
    await expect(page.getByTestId("info-coat")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("info-medien-wappen")).toHaveCount(0);
    // Ein tiefer Link öffnet ohne Recht nichts.
    await page.goto(`/edit?medien=${GARETH}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(fenster(page)).toBeHidden();
    // Der Server selbst: ohne Sitzung 401 im Umschlag, vor jeder Prüfung der Anfrage (der Stub greift hier nicht).
    await page.unroute("**/api/editor/**");
    const antwort = await page.evaluate(async () => {
        const response = await fetch("/api/editor/media/navigation", { cache: "no-store" });
        return { status: response.status, body: (await response.json()) as { error?: { code?: string } } };
    });
    expect(antwort.status).toBe(401);
    expect(antwort.body.error?.code).toBe("unauthenticated");
});

test("🔴 403 im Umschlag steht ruhig in der Spalte, ohne „Erneut versuchen“", async ({ page }) => {
    await oeffneKarte(page);
    await page.route("**/api/editor/media/navigation", (route) =>
        route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "forbidden", message: "Dafür fehlt das Recht." } }),
        }),
    );
    await ueberMenue(page);
    await expect(page.getByTestId("medien-arten-fehler")).toHaveText(
        "Für die Medienverwaltung fehlt das Recht „Medienverwaltung öffnen“.",
    );
    await expect(page.getByTestId("medien-arten-erneut")).toHaveCount(0);
});

test("🔴 drei Spalten mit den Zahlen der Navigation, Suche, Filter, Raster und Liste", async ({ page }) => {
    const q = await oeffneKarte(page);
    const nav = await q.mediaNavigation(q.db);
    await ueberMenue(page);
    const dialog = fenster(page);
    // Werkzeugfenster der Breite `medien`, drei Spalten nebeneinander.
    const breite = await dialog.evaluate((node) => node.getBoundingClientRect().width);
    expect(breite).toBeCloseTo(1240, 0);
    for (const spalte of ["medien-spalte-arten", "medien-spalte-treffer", "medien-spalte-inspektor"]) {
        await expect(page.getByTestId(spalte)).toBeVisible();
    }
    const lage = await page.evaluate(() =>
        ["medien-spalte-arten", "medien-spalte-treffer", "medien-spalte-inspektor"].map((id) => {
            const box = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
            return { x: box.x, breite: box.width };
        }),
    );
    // Spalte 1 trägt die Schiene der Fenster (Betreiber 2026-10-11) und ist so breit wie sie.
    expect(lage[0]!.breite).toBeCloseTo(228, 0);
    expect(lage[2]!.breite).toBeCloseTo(400, 0);
    expect(lage[0]!.x).toBeLessThan(lage[1]!.x);
    expect(lage[1]!.x).toBeLessThan(lage[2]!.x);

    // Spalte 1, die Medienarten als Schiene (Betreiber 2026-10-11): alle Bereiche aufgeklappt, je Eintrag eine Zeile mit der Zahl
    // aus der Navigation des Servers rechts. „Alle Medien“ und die Asset-Typen (Betreiber 2026-10-10: Wappen sind ein eigener Typ).
    for (const bereich of ["assets", "objekte", "eingaenge", "pruefen"]) {
        await expect(page.getByTestId(`medien-arten-bereich-kopf-${bereich}`)).toHaveAttribute("aria-expanded", "true");
    }
    // Feste Zwischenüberschriften hat nur die Systemsteuerung (Betreiber 2026-10-17, WI-0127 §23): Hier bleibt der Kopf ein
    // klappbarer Knopf mit Winkel.
    const kopf = page.getByTestId("medien-arten-bereich-kopf-assets");
    expect(await kopf.evaluate((element) => element.tagName)).toBe("BUTTON");
    await expect(kopf.locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("medien-arten-schiene")).not.toHaveClass(/fenster-schiene--fest/u);
    const wert = (eintrag: string) =>
        page.getByTestId(`medien-arten-eintrag-${eintrag}`).locator(".fenster-schiene__wert");
    await expect(wert("typ-alle")).toHaveText(nav.total.toLocaleString("de-DE"));
    await expect(wert("typ-coat")).toHaveText(nav.types.coat.toLocaleString("de-DE"));
    expect(nav.total).toBeGreaterThan(2000);
    expect(nav.types.coat).toBeGreaterThan(400);
    await expect(wert("korb-rights_open")).toHaveText(nav.baskets.rights_open.toLocaleString("de-DE"));
    // „Fehlende Derivate“ ist ein echter Korb (6c), mit der Zahl, die der Server über die Policy rechnet.
    await expect(wert("korb-missing_derivative")).toHaveText(nav.baskets.missing_derivative.toLocaleString("de-DE"));
    await expect(page.getByTestId("medien-arten-eintrag-korb-missing_derivative")).not.toHaveAttribute(
        "aria-disabled",
        "true",
    );
    await expect(page.getByTestId("medien-arten-eintrag-typ-alle")).toHaveAttribute("aria-current", "page");
    // Einzeilig: der Eintrag ist so hoch wie der von „Alle Medien“, auch mit Erklärung im Korb.
    const hoehe = async (eintrag: string) =>
        page.getByTestId(`medien-arten-eintrag-${eintrag}`).evaluate((node) => node.getBoundingClientRect().height);
    expect(await hoehe("korb-rights_open")).toBeCloseTo(await hoehe("typ-alle"), 0);
    expect(await hoehe("typ-model_3d")).toBeCloseTo(await hoehe("typ-alle"), 0);
    // Ohne upload_media gibt es keine Kachel zum Hochladen (Schritt 7).
    await expect(page.getByTestId("medien-hochladen-coat")).toHaveCount(0);
    await expect(page.getByTestId("medien-hochladen-header")).toHaveCount(0);
    // Was es noch nicht gibt, steht gestrichelt und lässt sich nicht wählen. Die Kartensammlung gibt es seit MAM-R5 (2026-10-18):
    // wählbar, mit der Zahl des Servers.
    await expect(wert("objekt-photobox")).toHaveText(nav.photoboxGalerien.toLocaleString("de-DE"));
    await expect(page.getByTestId("medien-arten-eintrag-objekt-photobox")).not.toHaveAttribute("aria-disabled", "true");
    await expect(wert("objekt-kartensammlung")).toHaveText(nav.citymaps.toLocaleString("de-DE"));
    await expect(page.getByTestId("medien-arten-eintrag-objekt-kartensammlung")).not.toHaveAttribute(
        "aria-disabled",
        "true",
    );

    // Spalte 2: die erste Seite, so viele Treffer wie Bilder.
    await expect(page.getByTestId("medien-spalte-treffer").getByTestId("fenster-spalte-unter")).toHaveText(
        `${nav.kinds.image.toLocaleString("de-DE")} Treffer`,
    );
    await expect(page.getByTestId("medien-eintrag")).toHaveCount(100);
    await expect(page.getByTestId("medien-mehr")).toBeVisible();

    // Die Suche steht in der Leiste der Treffer, links, der Trichter gleich daneben (Betreiber 2026-10-11); dieselbe Abfrage wie der Server.
    const leiste = page.getByTestId("medien-spalte-treffer");
    await expect(leiste.getByTestId("medien-suche")).toBeVisible();
    const suchBox = await leiste.getByTestId("medien-suche").boundingBox();
    const trichterBox = await leiste.getByTestId("medien-filter").boundingBox();
    expect(trichterBox!.x).toBeGreaterThan(suchBox!.x + suchBox!.width - 1);
    expect(trichterBox!.x - (suchBox!.x + suchBox!.width)).toBeLessThan(12);
    const gesucht = await q.searchMedia(q.db, { kind: "image", q: "Gareth", sort: "name", limit: 100, offset: 0 });
    await page.getByTestId("medien-suche").getByRole("searchbox").fill("Gareth");
    await expect(page.getByTestId("medien-spalte-treffer").getByTestId("fenster-spalte-unter")).toHaveText(
        `${gesucht.total.toLocaleString("de-DE")} Treffer`,
    );
    expect(new URL(page.url()).searchParams.get("medien-q")).toBe("Gareth");

    // Die Sortierung ist ein Zeichen mit Ausklappmenü gleich nach dem Trichter, die Suche nimmt den Rest der Zeile (Betreiber 2026-10-11).
    const sortKnopf = leiste.getByTestId("medien-sortierung");
    await expect(sortKnopf).toHaveAttribute("aria-label", "Sortierung: Name");
    const sortBox = await sortKnopf.boundingBox();
    const bildBox = await leiste.getByTestId("medien-bild").boundingBox();
    const leistenBox = await leiste.locator(".fenster-spalte__leiste").boundingBox();
    expect(sortBox!.x - (trichterBox!.x + trichterBox!.width)).toBeLessThan(12);
    expect(sortBox!.width).toBeLessThan(48);
    expect(leistenBox!.x + leistenBox!.width - (bildBox!.x + bildBox!.width)).toBeLessThan(24);
    expect(suchBox!.width).toBeGreaterThan(leistenBox!.width / 2);
    // Das Menü öffnet im Fenster (nicht am body unter dem modalen <dialog>) und nimmt den Klick an.
    await sortKnopf.click();
    const sortMenue = dialog.getByTestId("medien-sortierung-menue");
    await expect(sortMenue).toBeVisible();
    await expect(sortMenue.getByRole("menuitemradio", { name: "Name" })).toHaveAttribute("aria-checked", "true");
    const nachVerwendung = await q.searchMedia(q.db, {
        kind: "image",
        q: "Gareth",
        sort: "usage",
        limit: 100,
        offset: 0,
    });
    await sortMenue.getByRole("menuitemradio", { name: "Verwendungen" }).click();
    await expect(sortMenue).toHaveCount(0);
    await expect(sortKnopf).toHaveAttribute("aria-label", "Sortierung: Verwendungen");
    expect(new URL(page.url()).searchParams.get("medien-sort")).toBe("usage");
    await expect(page.getByTestId("medien-eintrag").first()).toHaveAttribute("data-asset", nachVerwendung.items[0]!.id);

    // Ein Filter: nur Wappen.
    const wappen = await q.searchMedia(q.db, {
        kind: "image",
        q: "Gareth",
        role: "coat",
        sort: "name",
        limit: 100,
        offset: 0,
    });
    // Alle Filter stehen hinter dem Trichter (Betreiber 2026-10-10: „trichter-symbol … dropdown mit allen optionen“).
    await page.getByTestId("medien-filter").click();
    await page.getByTestId("medien-filter-role-coat").check();
    await expect(page.getByTestId("medien-filter-zahl")).toHaveText("1");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("medien-filter-blatt")).toHaveCount(0);
    await expect(page.getByTestId("medien-eintrag")).toHaveCount(Math.min(wappen.total, 100));
    // Liste im Legacy-Stil: Daumen, Name mit Kreis, Rolle rechts.
    await page.getByTestId("medien-ansicht").getByRole("button", { name: "Liste" }).click();
    const zeile = page.getByTestId("medien-eintrag").first();
    await expect(zeile).toHaveClass(/medien-eintrag--liste/);
    await expect(zeile.getByTestId("medien-eintrag-kreis")).toHaveAttribute("data-kreis", /^(leer|halb|voll)$/);
    await expect(zeile).toContainText("Wappen");
    expect(new URL(page.url()).searchParams.get("medien-ansicht")).toBe("liste");
});

test("🔴 der Inspector: Reihenfolge nach §3.3, private Felder als „intern“, ohne Schreibrecht kein Bearbeiten, Handlungen gesperrt", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    await ueberMenue(page);
    await page.getByTestId("medien-eintrag").first().click();
    const inspektor = page.getByTestId("medien-inspektor");
    await expect(page.getByTestId("medien-pillen")).toBeVisible({ timeout: 15_000 });
    const titel = await inspektor.locator(".fenster-karte__titel").allInnerTexts();
    const reihenfolge = [
        "Verwendungen",
        "Eigenschaften",
        "Entstehung",
        "Rechte",
        "Provenienz",
        "Dateien",
        "Historie",
        "Handlungen",
    ];
    const gefunden = reihenfolge.map((name) => titel.findIndex((text) => text.startsWith(name)));
    expect(gefunden.every((index) => index >= 0)).toBe(true);
    expect([...gefunden].sort((a, b) => a - b)).toEqual(gefunden);
    await expect(page.getByTestId("medien-intern").first()).toBeVisible();
    await expect(page.getByTestId("medien-gespeichert-nicht-geprueft")).toBeVisible();
    for (const knopf of ["medien-handlung-ersetzen", "medien-handlung-notaus"]) {
        await expect(page.getByTestId(knopf)).toBeDisabled();
    }
    // Ohne upload_media trägt kein Kasten „Bearbeiten“; ohne review_media_rights sind die drei Entscheide gesperrt, mit einem Satz.
    await expect(page.getByTestId("medien-kasten-rechte-bearbeiten")).toHaveCount(0);
    await expect(page.getByTestId("medien-pruefung-cleared")).toBeDisabled();
    await expect(page.getByTestId("medien-pruefung-satz")).toHaveText("Dafür fehlt das Recht „Rechte prüfen“.");
    await expect(page.getByTestId("medien-handlungen")).toContainText("kommt mit P4");
    // Die gewählte Kachel und das Asset in der Adresse.
    const id = await page.getByTestId("medien-eintrag").first().getAttribute("data-asset");
    expect(new URL(page.url()).searchParams.get("medien")).toBe(id);
    const detail = await q.assetDetail(q.db, id!);
    await expect(page.getByTestId("medien-inspektor-kennung")).toHaveText(`Asset ${id!.slice(0, 8)}`);
    expect(detail?.representations.length ?? 0).toBeGreaterThan(0);
    // Pfeiltaste: der nächste Treffer.
    await page.getByTestId("medien-eintrag").first().focus();
    await page.keyboard.press("ArrowRight");
    const zweite = await page.getByTestId("medien-eintrag").nth(1).getAttribute("data-asset");
    await expect.poll(() => new URL(page.url()).searchParams.get("medien")).toBe(zweite);
});

test("🔴 Kontext-Einstieg: das Wappen im Infopanel öffnet genau dieses Asset, beschränkt auf Gareth", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    const garethMedien = await q.searchMedia(q.db, {
        kind: "image",
        subject: `place:${GARETH}`,
        sort: "name",
        limit: 200,
        offset: 0,
    });
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const wappenId = wappen.items[0]!.id;
    await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    const knopf = page.getByTestId("info-medien-wappen");
    await expect(knopf).toBeVisible();
    await expect(knopf).toHaveAccessibleName("Wappen in der Medienverwaltung öffnen");
    await knopf.click();
    await expect(fenster(page)).toBeVisible();
    // „verwendet von Gareth ✕“ steht lösbar in der Trefferzeile, nicht in der Leiste (Guide §13.45).
    await expect(page.getByTestId("medien-filter-von")).toHaveAccessibleName("Verwendung lösen");
    await expect(page.getByTestId("medien-spalte-treffer").getByTestId("fenster-spalte-unter")).toHaveText(
        `${garethMedien.total.toLocaleString("de-DE")} Treffer · verwendet von Gareth ✕`,
    );
    await expect(page.getByTestId("medien-inspektor-kennung")).toHaveText(`Asset ${wappenId.slice(0, 8)}`);
    // Seit den Namen aus dem Fachobjekt (WI-0068, Betreiber 2026-10-10) trägt das Wappen seinen Titel; ohne Titel hieße es „Gareth · Wappen“.
    await expect(page.getByTestId("medien-inspektor-name")).toHaveText(wappen.items[0]!.title ?? "Gareth · Wappen");
    await expect(page.locator(`[data-asset="${wappenId}"]`)).toHaveAttribute("aria-current", "true");
    const adresse = new URL(page.url()).searchParams;
    expect(adresse.get("medien")).toBe(wappenId);
    expect(adresse.get("medien-von")).toBe(`place:${GARETH}`);
});

test("🔴 tiefer Link: `?medien=<asset>` öffnet genau dieses Asset; Escape schließt und nimmt die Adresse zurück", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const wappenId = wappen.items[0]!.id;
    await page.goto(`/edit?medien=${wappenId}&medien-von=place:${GARETH}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(fenster(page)).toBeVisible();
    await expect(page.getByTestId("medien-inspektor-kennung")).toHaveText(`Asset ${wappenId.slice(0, 8)}`);
    // Den Namen kennt der Link nicht; er kommt aus den Antworten.
    await expect(page.getByTestId("medien-spalte-treffer").getByTestId("fenster-spalte-unter")).toContainText(
        "verwendet von Gareth",
    );
    await page.keyboard.press("Escape");
    await expect(fenster(page)).toBeHidden();
    expect(new URL(page.url()).searchParams.has("medien")).toBe(false);
    expect(new URL(page.url()).searchParams.has("medien-von")).toBe(false);
});

test("🔴 „Auf Karte zeigen“ schließt das Fenster, öffnet den Ort und die Kamera fliegt hin", async ({ page }) => {
    const q = await oeffneKarte(page, "/edit#x=200&y=200&z=5");
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    await page.goto(`/edit?medien=${wappen.items[0]!.id}#x=200&y=200&z=5`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const vorher = await page.evaluate(() => {
        const c = globalThis.avesmapsMap!.getCenter();
        return [c.lng, c.lat];
    });
    await page.getByTestId("medien-auf-karte").first().click();
    await expect(fenster(page)).toBeHidden();
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    // 🪤 Den Namen zeigt das Infopanel sofort (aus der Verwendung), der Flug beginnt erst danach: „steht still“ allein misst noch vor
    // dem Abflug (Sammellauf 14fb1eab). Gewartet wird auf eine ruhende Kamera an anderer Stelle.
    await page.waitForFunction(
        (alt) => {
            const karte = globalThis.avesmapsMap!;
            const jetzt = karte.getCenter();
            return !karte.isMoving() && Math.hypot(jetzt.lng - alt[0]!, jetzt.lat - alt[1]!) > 0.5;
        },
        vorher,
        { timeout: 15_000 },
    );
});

/**
 * Die Bildansicht (Betreiber 2026-10-11, wörtlich: „kannst du bei einem klick auf ein bild einer lightbox vollansicht machen (mit < und >
 * wenns mehrere (1,2,3) oder in eine galerie gibt, ESC lässt es wieder verschwinden“; Guide §13.46).
 */
test("🔴 Bildansicht im Inspector: groß, ‹ › durch die Galerie, Esc schließt nur die Ansicht", async ({ page }) => {
    const q = await oeffneKarte(page);
    const bilder = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "header",
        sort: "name",
        limit: 20,
        offset: 0,
    });
    test.skip(bilder.total < 2, "Gareth braucht mehrere Bilder");
    await page.goto(`/edit?medien=${bilder.items[0]!.id}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(fenster(page)).toBeVisible();
    await expect(page.getByTestId("medien-galerie").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("medien-vorschau-gross").click();
    const ansicht = page.getByTestId("medien-bildansicht");
    await expect(ansicht).toBeVisible();
    const stand = ansicht.getByTestId("bildansicht-stand");
    await expect(stand).toHaveText(/^\d+ von \d+$/);
    const vorher = (await stand.textContent()) ?? "";
    // Groß: breiter als die Vorschau im Inspector (400 px Spalte).
    const breite = await ansicht.getByTestId("bildansicht-bild").evaluate((node) => node.getBoundingClientRect().width);
    expect(breite).toBeGreaterThan(600);
    await page.keyboard.press("ArrowRight");
    await expect(stand).not.toHaveText(vorher);
    await ansicht.getByTestId("bildansicht-vorher").click();
    await expect(stand).toHaveText(vorher);
    await page.keyboard.press("Escape");
    await expect(ansicht).toBeHidden();
    // Esc nahm nur die Ansicht: das Fenster bleibt offen.
    await expect(fenster(page)).toBeVisible();
});

test("🔴 Bildansicht am Kopfbild im Infopanel: Klick öffnet, blättern führt den Kopf mit, Esc schließt nur die Ansicht", async ({
    page,
}) => {
    await oeffneKarte(page);
    await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    const marken = page.getByTestId("info-header-mark");
    test.skip((await marken.count()) < 2, "Gareth braucht mehrere öffentliche Bilder");
    await page.getByTestId("info-header-gross").click();
    const ansicht = page.getByTestId("info-bildansicht");
    await expect(ansicht).toBeVisible();
    await expect(ansicht.getByTestId("bildansicht-stand")).toHaveText(`1 von ${String(await marken.count())}`);
    await expect(ansicht.getByTestId("bildansicht-zeile")).toContainText("Gareth");
    await page.keyboard.press("ArrowRight");
    await expect(ansicht.getByTestId("bildansicht-stand")).toHaveText(`2 von ${String(await marken.count())}`);
    await page.keyboard.press("Escape");
    await expect(ansicht).toBeHidden();
    // Das Infopanel bleibt offen und steht beim zweiten Bild.
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    await expect(marken.nth(1)).toHaveClass(/is-on/);
});

/**
 * Bearbeiten je Kasten (WI-0068 P4b, Blatt 1, Betreiber 2026-10-10: „jeden Kasten einzeln (A)“). Die Schreibrouten antworten hier aus dem
 * Test (der Inhalt der Anfrage ist die Zusicherung); was der Server mit ihr tut, prüfen die Servertests der P4a-Routen.
 */
test("🔴 Bearbeiten je Kasten: Name, Rechte mit Vorprüfung und Warnung, Konflikt mit Person, Prüfung", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media", "review_media_rights"]);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const id = wappen.items[0]!.id;
    const detail = (await q.assetDetail(q.db, id))!;
    const gesendet: { pfad: string; body: Record<string, unknown> }[] = [];
    let rechteKonflikt = true;
    const quittung = (operationId: unknown) => ({
        operationId,
        status: "applied",
        environment: "development",
        affected: [{ kind: "media_asset", id, revision: detail.asset.revision + 1 }],
        derivedWork: [],
        warnings: [],
    });
    await page.route("**/api/editor/media/licenses", (route) =>
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                licenses: [
                    {
                        key: "cc-by-4.0",
                        displayName: "CC BY 4.0",
                        canonicalUri: "https://creativecommons.org/licenses/by/4.0/",
                        requiresAttribution: true,
                        family: "cc-by",
                    },
                ],
            }),
        }),
    );
    await page.route(`**/api/editor/media/${id}/**`, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const pfad = new URL(route.request().url()).pathname;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        gesendet.push({ pfad, body });
        if (pfad.endsWith("/rights") && rechteKonflikt) {
            return route.fulfill({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({
                    error: {
                        code: "edit_conflict",
                        message: "Jemand war schneller.",
                        details: {
                            currentRevision: (detail.rights?.revision ?? 0) + 1,
                            changedBy: { id: "6d696d70-0000-4000-9000-0000000000cd", displayName: "Rondrian" },
                            changedAt: "2026-10-11T08:42:00.000Z",
                        },
                    },
                }),
            });
        }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(quittung(body["operationId"])) });
    });
    await page.goto(`/edit?medien=${id}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("medien-pillen")).toBeVisible({ timeout: 15_000 });

    // Eigenschaften: nur der Name, mit der Revision des Assets.
    await page.getByTestId("medien-kasten-eigenschaften-bearbeiten").click();
    const name = page.getByTestId("medien-bearbeiten-name").getByRole("textbox");
    await expect(name).toHaveValue(detail.asset.title ?? "");
    await name.fill("Fuchs auf Gold");
    await page.getByTestId("medien-kasten-eigenschaften-speichern").click();
    await expect(page.getByTestId("medien-kasten-eigenschaften-bearbeiten")).toBeVisible();
    expect(gesendet.at(-1)?.pfad).toMatch(/\/metadata$/);
    expect(gesendet.at(-1)?.body).toMatchObject({ baseRevision: detail.asset.revision, title: "Fuchs auf Gold" });

    // Rechte: CC BY ohne Namensnennung wird vorher abgewiesen, ohne Anfrage; die Warnung vor dem Zurückfallen steht da.
    const vorher = gesendet.length;
    await page.getByTestId("medien-kasten-rechte-bearbeiten").click();
    await page.getByTestId("medien-bearbeiten-grundlage").locator("select").selectOption("license");
    await page.getByTestId("medien-bearbeiten-lizenz").locator("select").selectOption("cc-by-4.0");
    await expect(page.getByTestId("medien-bearbeiten-zuruecksetzen")).toBeVisible();
    await page.getByTestId("medien-kasten-rechte-speichern").click();
    await expect(page.getByTestId("medien-kasten-rechte").locator(".medien-kasten__befund")).toBeVisible();
    expect(gesendet.length).toBe(vorher);
    await page.getByTestId("medien-kasten-rechte-abbrechen").click();

    // Konflikt: Der Satz nennt die Person, die Eingaben bleiben, Speichern geht erst nach „Neu laden“.
    await page.getByTestId("medien-kasten-rechte-bearbeiten").click();
    const urheber = page.getByTestId("medien-bearbeiten-urheber").getByRole("textbox");
    await urheber.fill("Rondra-Studio");
    await page.getByTestId("medien-kasten-rechte-speichern").click();
    await expect(page.getByTestId("medien-kasten-rechte-fehler")).toContainText("Rondrian hat das gerade geändert");
    await expect(page.getByTestId("medien-kasten-rechte-speichern")).toBeDisabled();
    rechteKonflikt = false;
    await page.getByTestId("medien-kasten-rechte-neu-laden").click();
    await expect(urheber).toHaveValue("Rondra-Studio");
    await page.getByTestId("medien-kasten-rechte-speichern").click();
    await expect(page.getByTestId("medien-kasten-rechte-bearbeiten")).toBeVisible();
    expect(gesendet.at(-1)?.body).toMatchObject({ rights: { creator: "Rondra-Studio" } });
    // Zwei Versuche, zwei Kennungen: Der Konflikt war eine klare Antwort, die Kennung ist verbraucht.
    const rechte = gesendet.filter((eintrag) => eintrag.pfad.endsWith("/rights"));
    expect(rechte[0]?.body["operationId"]).not.toBe(rechte[1]?.body["operationId"]);

    // Prüfung: ein Klick, ein Entscheid, mit der Revision der Rechte.
    await expect(page.getByTestId("medien-pruefung-satz")).toHaveText(
        "„Rechte geprüft“ gibt das Bild frei. Gilt für alle Verwendungen dieses Bildes.",
    );
    await page.getByTestId("medien-pruefung-cleared").click();
    await expect.poll(() => gesendet.at(-1)?.pfad).toMatch(/\/rights\/review$/);
    expect(gesendet.at(-1)?.body).toMatchObject({ decision: "cleared", baseRevision: detail.rights?.revision });
});

/**
 * Die Auswahl (WI-0068 P4b, WI-0126 §11j, Gesamtmockup Version 7): aus den Verwendungen des Wappens von Gareth „⇄ anderes Wappen …“,
 * Wappen als Liste mit „gebunden“ und „hochgeladen von …“, Suche, Binden als EINE Operation mit dem gesehenen Stand des Platzes, „↥ Neues
 * Wappen hochladen“ mit dem Weg zurück. Die Bindung antwortet aus dem Test; was der Server tut, prüfen die Servertests.
 */
test("🔴 Auswahl: anderes Wappen für Gareth wählen und binden, Suche, Hochladen und zurück", async ({ page }) => {
    const q = await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const gebunden = wappen.items[0]!.id;
    const gesendet: Record<string, unknown>[] = [];
    await page.route("**/api/editor/media/bindings/coat", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        gesendet.push(body);
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body["operationId"],
                status: "applied",
                environment: "development",
                affected: [{ kind: "place_media", id: GARETH, revision: 5 }],
                derivedWork: [],
                warnings: [],
            }),
        });
    });
    await page.goto(`/edit?medien=${gebunden}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("medien-waehlen-coat").first().click({ timeout: 15_000 });

    const fenster = page.getByTestId("medien-auswahl-fenster");
    await expect(fenster).toBeVisible();
    await expect(fenster).toContainText("Wappen für Gareth");
    const eintraege = fenster.getByTestId("medien-auswahl-eintrag");
    await expect(eintraege.first()).toBeVisible({ timeout: 15_000 });
    // Jede Zeile sagt, wer es hochgeladen hat oder woher es kam, mit Datum, nie leer.
    await expect(eintraege.first().getByTestId("medien-auswahl-hochgeladen")).toHaveText(/\S.* · \S/);
    // Das gebundene Wappen trägt „gebunden“ und lässt sich nicht noch einmal binden.
    await fenster.getByTestId("medien-auswahl-suche").getByRole("searchbox").fill("Gareth");
    const gebundeneZeile = fenster.locator(`[data-asset="${gebunden}"]`);
    await expect(gebundeneZeile.getByTestId("medien-auswahl-gebunden")).toBeVisible({ timeout: 15_000 });
    await gebundeneZeile.click();
    await expect(page.getByTestId("medien-auswahl-binden")).toBeDisabled();

    // Ein anderes wählen: „Ersetzen“ bindet mit der Revision der aktiven Bindung.
    // 🪤 Die Liste lädt erst 250 ms nach dem Tippen neu; unter Last griff der Fall sonst eine Zeile der alten, auf „Gareth“ gefilterten
    // Liste, die in der ungefilterten nicht mehr steht (Sammellauf 14fb1eab). Also erst die Antwort ohne Suchwort abwarten.
    const ungefiltert = page.waitForResponse((antwort) => {
        const adresse = new URL(antwort.url());
        return (
            adresse.pathname === "/api/editor/media" &&
            adresse.searchParams.get("type") === "coat" &&
            !adresse.searchParams.has("q")
        );
    });
    await fenster.getByTestId("medien-auswahl-suche").getByRole("searchbox").fill("");
    await ungefiltert;
    const andere = fenster.locator(`[data-testid="medien-auswahl-eintrag"]:not([data-asset="${gebunden}"])`).first();
    await expect(andere).toBeVisible({ timeout: 15_000 });
    const andereId = await andere.getAttribute("data-asset");
    await andere.click();
    await expect(page.getByTestId("medien-auswahl-binden")).toHaveText("Ersetzen");
    await expect(page.getByTestId("medien-auswahl-satz")).toContainText("Ersetzt das gebundene Wappen von Gareth.");

    // „↥ Neues Wappen hochladen“ führt ins Formular und „‹ Zurück zur Auswahl“ zurück.
    await fenster.getByTestId("medien-auswahl-hochladen").click();
    await expect(page.getByTestId("medien-hochladen-fenster")).toBeVisible();
    await page.getByTestId("medien-hochladen-zurueck").click();
    await expect(fenster).toBeVisible();

    // Zurück vom Formular bleiben Liste und Wahl stehen.
    await expect(fenster.locator(`[data-asset="${andereId}"]`)).toHaveClass(/is-gewaehlt/);
    await page.getByTestId("medien-auswahl-binden").click();
    await expect(fenster).toBeHidden();
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]).toMatchObject({ subject: { kind: "place", id: GARETH }, assetId: andereId });
    expect(typeof gesendet[0]!["baseRevision"]).toBe("number");
});

/**
 * „wird gerechnet …“ (WI-0068 P4b, Schritt 6): Frisch hochgeladen steht ein Asset auf `pending`, bis der Job die Fassungen gerechnet hat.
 * Der Inspector sagt es und lädt nach, bis das Bild da ist. Hier meldet das Detail zweimal `pending` ohne Datei, danach den echten Stand.
 */
test("🔴 wird gerechnet: der Inspector sagt es und lädt nach, bis das Bild da ist", async ({ page }) => {
    const q = await oeffneKarte(page);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const id = wappen.items[0]!.id;
    const echt = (await q.assetDetail(q.db, id))!;
    let abrufe = 0;
    await page.route(`**/api/editor/media/${id}`, async (route) => {
        abrufe += 1;
        const detail =
            abrufe <= 2
                ? {
                      ...echt,
                      asset: { ...echt.asset, technicalState: "pending" },
                      representations: echt.representations.filter((datei) => datei.storageClass !== "published"),
                  }
                : echt;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(detail) });
    });
    await page.goto(`/edit?medien=${id}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    // Die Liste kennt das Bild schon; der Inspector zeigt, solange das Detail `pending` sagt, „wird gerechnet …“.
    await expect(page.getByTestId("medien-wird-gerechnet")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("medien-wird-gerechnet")).toContainText("wird gerechnet …");
    // Er lädt von selbst nach; danach steht das Bild da.
    await expect(page.getByTestId("medien-vorschau")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("medien-wird-gerechnet")).toHaveCount(0);
    expect(abrufe).toBeGreaterThanOrEqual(3);
});

/**
 * Die private Vorschau (WI-0068 P4b, geschützter Bildweg): Ohne öffentliche Datei zeigt der Inspector die gerechnete Fassung über
 * `GET …/preview/intern_…` und sagt, dass sie intern ist. Hier trägt das Detail statt der öffentlichen Datei eine private Vorschau.
 */
test("🔴 private Vorschau: ohne öffentliche Datei zeigt der Inspector das Bild über den geschützten Weg, als intern", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const id = wappen.items[0]!.id;
    const echt = (await q.assetDetail(q.db, id))!;
    const oeffentlich = echt.representations.find((datei) => datei.storageClass === "published")!;
    const privateUrl = `/api/editor/media/${id}/preview/intern_${oeffentlich.variant}`;
    await page.route(`**/api/editor/media/${id}`, async (route) => {
        const detail = {
            ...echt,
            representations: [
                ...echt.representations.filter((datei) => datei.storageClass !== "published"),
                {
                    ...oeffentlich,
                    variant: `intern_${oeffentlich.variant}`,
                    storageClass: "derivative",
                    url: null,
                    privateUrl,
                    storageKey: "derivatives/sha256/aa/aa/a.webp",
                },
            ],
        };
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(detail) });
    });
    let geholt = 0;
    await page.route(`**${privateUrl}`, async (route) => {
        geholt += 1;
        await route.fulfill({ contentType: "image/png", body: Buffer.from(PUNKT_PNG, "base64") });
    });
    await page.goto(`/edit?medien=${id}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const bild = page.getByTestId("medien-vorschau");
    await expect(bild).toHaveAttribute("src", privateUrl, { timeout: 15_000 });
    await expect(page.getByTestId("medien-vorschau-intern")).toContainText("intern");
    await expect.poll(() => bild.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(geholt).toBeGreaterThan(0);
});

/** Ein Pixel als PNG: genug für ein geladenes Bild ohne Datei im Medienspeicher. */
const PUNKT_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Hochladen im Medienfenster (WI-0068 P4b, Schritt 7): Mit upload_media steht vorn „↥ Neues Wappen hochladen“; das Formular öffnet
 * darüber, nach dem Hochladen ist das neue Asset gewählt. Das Hochladen antwortet aus dem Test (was der Server tut, prüfen die
 * Servertests); als „neues“ Asset dient ein vorhandenes Wappen, damit der Inspector echte Daten lädt.
 */
test("🔴 Neu hochladen: vorn die Kachel, das Formular darüber, danach ist das neue Asset gewählt", async ({ page }) => {
    const q = await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const neu = wappen.items[0]!.id;
    const gesendet: Record<string, unknown>[] = [];
    await page.route(
        (url) => url.pathname === "/api/editor/media",
        async (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            const body = route.request().postDataJSON() as Record<string, unknown>;
            gesendet.push(body);
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    operationId: body["operationId"],
                    status: "applied",
                    environment: "development",
                    affected: [{ kind: "media_asset", id: neu, revision: 1 }],
                    derivedWork: [
                        { kind: "media_settle", jobId: "0b6a1f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", state: "queued" },
                    ],
                    warnings: [],
                }),
            });
        },
    );
    // Die Sitzung mit upload_media gilt nach dem Neuladen.
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await ueberMenue(page);
    await page.getByTestId("medien-arten-eintrag-typ-coat").click();
    // Vorn, vor dem ersten Treffer, und nur die Wappen-Kachel (kein Titelbild bei den Wappen).
    const kachel = page.getByTestId("medien-hochladen-coat");
    await expect(kachel).toBeVisible();
    await expect(page.getByTestId("medien-hochladen-header")).toHaveCount(0);
    const ersteZeile = await page
        .getByTestId("medien-treffer")
        .locator("li")
        .first()
        .getByTestId("medien-hochladen-coat");
    await expect(ersteZeile).toHaveCount(1);
    await kachel.click();
    const formular = page.getByTestId("medien-hochladen-fenster");
    await expect(formular).toBeVisible();
    await expect(page.getByTestId("medien-hochladen-freigeben")).toHaveCount(0);
    await expect(page.getByTestId("medien-hochladen-pruefung")).toBeVisible();
    await page.getByTestId("medien-hochladen-titel").locator("input").fill("Wappen einer Probe");
    await page
        .getByTestId("medien-hochladen-datei")
        .setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: graueFlaeche(128) });
    // Die Grundlage ist Pflicht; ein Wappen braucht an der langen Seite 128 Pixel (T2a), sonst sagt es das Formular vorher.
    await page.getByTestId("medien-hochladen-grundlage").locator("select").selectOption("own_work");
    await page.getByTestId("medien-hochladen-senden").click();
    await expect(formular).toHaveCount(0);
    expect(gesendet).toHaveLength(1);
    expect((gesendet[0]!["form"] as Record<string, unknown>)["title"]).toBe("Wappen einer Probe");
    expect((gesendet[0]!["form"] as Record<string, unknown>)["rightsReviewed"]).toBeUndefined();
    // Danach ist das neue Asset gewählt; die Adresse trägt es.
    await expect.poll(() => new URL(page.url()).searchParams.get("medien")).toBe(neu);
    await expect(page.getByTestId("medien-inspektor")).not.toContainText("Noch kein Medium gewählt");
});

/**
 * „Dieses Bild gibt es bereits!“ (Betreiber 2026-10-17, WI-0068): Nach der Dateiwahl rechnet das Formular die SHA-256 des Originals
 * und fragt nach denselben Bytes. Bei einem Treffer steht statt des Hochladens das vorhandene Werk da, mit seinen Verwendungen als
 * Verweisen, und „Vorhandenes Bild verwenden“ öffnet es im Inspector — ohne Upload. Die Antwort auf die Frage kommt aus dem Test (ein
 * echtes Wappen aus der Datenbank), die Prüfung auf dem Server prüft `media-duplikate.test.ts`.
 */
test("🔴 Datei gibt es schon: Hinweis mit dem vorhandenen Bild, „Vorhandenes Bild verwenden“ öffnet es, kein Upload", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const vorhanden = wappen.items[0]!;
    const datei = graueFlaeche(128);
    const gefragt: string[] = [];
    let hochgeladen = 0;
    await page.route(
        (url) => url.pathname.startsWith("/api/editor/media/same-bytes/"),
        async (route) => {
            gefragt.push(new URL(route.request().url()).pathname.split("/").pop() ?? "");
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({ hits: [vorhanden], suggested: vorhanden.id }),
            });
        },
    );
    await page.route(
        (url) => url.pathname === "/api/editor/media",
        async (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            hochgeladen += 1;
            return route.abort();
        },
    );
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await ueberMenue(page);
    await page.getByTestId("medien-arten-eintrag-typ-coat").click();
    await page.getByTestId("medien-hochladen-coat").click();
    await expect(page.getByTestId("medien-hochladen-fenster")).toBeVisible();
    await page
        .getByTestId("medien-hochladen-datei")
        .setInputFiles({ name: "schon-da.png", mimeType: "image/png", buffer: datei });

    const hinweis = page.getByTestId("medien-duplikat");
    await expect(page.getByTestId("medien-duplikat-hinweis")).toContainText("Dieses Bild gibt es bereits!");
    // Gefragt wird mit der SHA-256 der ganzen Datei, wie der Server sie rechnet.
    expect(gefragt).toEqual([createHash("sha256").update(datei).digest("hex")]);
    await expect(hinweis.getByTestId("medien-eintrag")).toHaveCount(1);
    // Gareths Wappen: die Verwendung steht als Verweis auf den Ort da, nicht als Zahl.
    await expect(hinweis.getByTestId("medien-verwendung-subjekt").first()).toBeVisible();
    await expect(page.getByTestId("medien-hochladen-senden")).toHaveCount(0);

    await page.getByTestId("medien-duplikat-verwenden").click();
    await expect(page.getByTestId("medien-hochladen-fenster")).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("medien")).toBe(vorhanden.id);
    expect(hochgeladen).toBe(0);
});

/**
 * „Alle bytegleichen Duplikate zusammenführen“ (Betreiber 2026-10-17, WI-0068): Im Korb „Gleiche Datei“ öffnet der Betreiber das
 * Blatt; es zeigt die Zahlen der Vorschau, die Gruppen mit abweichenden Rechten einzeln zur Prüfung, und EIN Klick schickt genau die
 * sauberen Gruppen samt der gesehenen Zahlen. Danach liest das Blatt den Stand des Auftrags, bis er endet. Vorschau, Auftrag und
 * Warteschlange antworten aus dem Test; was der Lauf tut, prüft `media-merge-all.test.ts`.
 */
test("🔴 Sammellauf: Vorschau mit Zahlen und Konflikten, ein Klick schickt die sauberen Gruppen, der Stand läuft bis „Fertig“", async ({
    page,
}) => {
    await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media", "merge_media_all"]);
    const g = (n: number) => `5a5a5a5a-0000-4000-8000-00000000000${String(n)}`;
    const vorschau = {
        groups: [
            { fileGroup: g(1), keepAssetId: g(2), members: 3, moves: 2, retires: 1, rightsDiffer: false },
            { fileGroup: g(3), keepAssetId: g(4), members: 2, moves: 1, retires: 0, rightsDiffer: true },
        ],
        totals: { groups: 1, members: 3, moves: 2, retires: 1, withDifferingRights: 1 },
    };
    const gesendet: Record<string, unknown>[] = [];
    let abfragen = 0;
    await page.route(
        (url) => url.pathname === "/api/editor/media/merge/preview",
        (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(vorschau) }),
    );
    await page.route(
        (url) => url.pathname === "/api/editor/media/merge/all",
        async (route) => {
            const body = route.request().postDataJSON() as Record<string, unknown>;
            gesendet.push(body);
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    operationId: body["operationId"],
                    status: "applied",
                    environment: "development",
                    affected: [],
                    derivedWork: [{ kind: "media_merge_all", jobId: g(9), state: "queued" }],
                    warnings: [],
                }),
            });
        },
    );
    await page.route(
        (url) => url.pathname === "/api/jobs",
        async (route) => {
            abfragen += 1;
            const aktiv = new URL(route.request().url()).searchParams.get("state") === null;
            const job = {
                id: g(9),
                kind: "media_merge_all",
                state: abfragen < 2 ? "RUNNING" : "SUCCEEDED",
                phase: "zusammenfuehren",
                progress: 0.5,
                errorSummary: null,
            };
            const jobs = aktiv ? (abfragen < 2 ? [job] : []) : job.state === "SUCCEEDED" ? [job] : [];
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobs }) });
        },
    );
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await ueberMenue(page);
    await page.getByTestId("medien-arten-eintrag-korb-shared_file").click();
    await page.getByTestId("medien-merge-alle-oeffnen").click();
    const blatt = page.getByTestId("medien-merge-alle-fenster");
    await expect(blatt).toBeVisible();
    await expect(blatt.getByTestId("medien-merge-alle-gruppen")).toHaveText("1");
    await expect(blatt.getByTestId("medien-merge-alle-werke")).toHaveText("3");
    await expect(blatt.getByTestId("medien-merge-alle-gehen-auf")).toHaveText("2");
    await expect(blatt.getByTestId("medien-merge-alle-ziehen-um")).toHaveText("2");
    await expect(blatt.getByTestId("medien-merge-alle-konflikte")).toHaveText("1");
    // Die Gruppe mit abweichenden Rechten steht einzeln zur Prüfung da.
    await expect(blatt.getByTestId("medien-merge-alle-pruefen")).toHaveCount(1);

    await blatt.getByTestId("medien-merge-alle-starten").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({
        groups: [{ fileGroup: g(1), keepAssetId: g(2) }],
        expected: { groups: 1, members: 3, moves: 2, retires: 1 },
    });
    await expect(blatt.getByTestId("medien-merge-alle-stand")).toContainText("Fertig", { timeout: 15_000 });
});

/**
 * Mehrere Bilder auf einmal in eine Galerie (WI-0068 MAM-R3, Blatt P6 Abschnitt 2), mit der Frage nach denselben Bytes je Datei
 * (Betreiber 2026-10-17). Drei Dateien: Die mittlere gibt es schon und wird übernommen statt hochgeladen; jede Einordnung trägt die
 * Revision der vorigen; am Ende steht je Datei „fertig · Nr. …“. Hochladen, Einordnen und die Frage antworten aus dem Test, die Galerie
 * kommt aus der Datenbank; was der Server tut, prüfen `media-galerie-schreibpfad.test.ts` und `media-duplikate.test.ts`.
 */
test("🔴 Stapel: drei Dateien in eine Galerie, eine gibt es schon; Ergebnis je Datei, die vorhandene ohne Hochladen", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    const galerie = (await q.galleryList(q.db, { limit: 5, offset: 0 })).items[0]!;
    const detail = (await q.galleryDetail(q.db, galerie.id))!;
    const anzahl = detail.items.filter((eintrag) => !eintrag.retired).length;
    const vorhanden = (await q.searchMedia(q.db, { kind: "image", q: "Gareth", sort: "name", limit: 5, offset: 0 }))
        .items[0]!;
    const dateien = [graueFlaeche(128), graueFlaeche(130), graueFlaeche(132)];
    const schonDa = createHash("sha256").update(dateien[1]!).digest("hex");
    const hochgeladen: string[] = [];
    const eingeordnet: { assetId: string; baseRevision: number }[] = [];
    await page.route(
        (url) => url.pathname.startsWith("/api/editor/media/same-bytes/"),
        (route) => {
            const treffer = new URL(route.request().url()).pathname.endsWith(schonDa);
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify(
                    treffer ? { hits: [vorhanden], suggested: vorhanden.id } : { hits: [], suggested: null },
                ),
            });
        },
    );
    await page.route(
        (url) => url.pathname === "/api/editor/media",
        async (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            const body = route.request().postDataJSON() as { operationId: string; file: { name: string } };
            hochgeladen.push(body.file.name);
            const id = `5a5a5a5a-0000-4000-8000-00000000010${String(hochgeladen.length)}`;
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    operationId: body.operationId,
                    status: "applied",
                    environment: "development",
                    affected: [{ kind: "media_asset", id, revision: 1 }],
                    derivedWork: [],
                    warnings: [],
                }),
            });
        },
    );
    await page.route(
        (url) => url.pathname === "/api/editor/media/galleries/add",
        async (route) => {
            const body = route.request().postDataJSON() as {
                operationId: string;
                assetId: string;
                baseRevision: number;
            };
            eingeordnet.push({ assetId: body.assetId, baseRevision: body.baseRevision });
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    operationId: body.operationId,
                    status: "applied",
                    environment: "development",
                    affected: [{ kind: "gallery", id: galerie.id, revision: body.baseRevision + 1 }],
                    derivedWork: [],
                    warnings: [],
                }),
            });
        },
    );
    await page.goto(`/edit?medien&medien-objekt=galerien&medien-galerie=${galerie.id}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("medien-galerie-stapel").click();
    const fenster = page.getByTestId("medien-hochladen-fenster");
    await expect(fenster).toBeVisible();
    await expect(fenster.getByTestId("medien-hochladen-titelregel")).toBeVisible();
    await fenster
        .getByTestId("medien-stapel-dateien")
        .setInputFiles(
            dateien.map((buffer, index) => ({ name: `bild-${String(index + 1)}.png`, mimeType: "image/png", buffer })),
        );
    const zeilen = fenster.getByTestId("medien-stapel-zeile");
    await expect(zeilen).toHaveCount(3);
    await expect(zeilen.nth(1)).toHaveAttribute("data-stand", "vorhanden");
    await expect(zeilen.nth(0)).toHaveAttribute("data-stand", "neu");
    await expect(zeilen.nth(2)).toHaveAttribute("data-stand", "neu");
    await page.getByTestId("medien-hochladen-grundlage").locator("select").selectOption("own_work");
    await page.getByTestId("medien-stapel-senden").click();

    await expect(zeilen.nth(2)).toHaveAttribute("data-stand", "fertig");
    await expect(zeilen.nth(0)).toContainText(`Nr. ${String(anzahl + 1)}`);
    await expect(zeilen.nth(2)).toContainText(`Nr. ${String(anzahl + 3)}`);
    expect(hochgeladen).toEqual(["bild-1.png", "bild-3.png"]);
    expect(eingeordnet.map((eintrag) => eintrag.baseRevision)).toEqual([
        detail.revision,
        detail.revision + 1,
        detail.revision + 2,
    ]);
    expect(eingeordnet[1]!.assetId).toBe(vorhanden.id);
});

/**
 * Ein graues Wappen als PNG (ohne Bildbibliothek): ein Quadrat mit durchsichtigem Rand, denn ein Wappen braucht durchsichtige Ecken (T2a).
 * Genug für die Vorprüfung im Formular; das Hochladen antwortet aus dem Test.
 */
function graueFlaeche(kante: number): Buffer {
    const stueck = (art: string, daten: Buffer): Buffer => {
        const laenge = Buffer.alloc(4);
        laenge.writeUInt32BE(daten.length);
        const rumpf = Buffer.concat([Buffer.from(art, "latin1"), daten]);
        const pruef = Buffer.alloc(4);
        pruef.writeUInt32BE(crc32(rumpf));
        return Buffer.concat([laenge, rumpf, pruef]);
    };
    const kopf = Buffer.alloc(13);
    kopf.writeUInt32BE(kante, 0);
    kopf.writeUInt32BE(kante, 4);
    kopf.writeUInt8(8, 8); // Bittiefe
    kopf.writeUInt8(6, 9); // RGBA
    const rand = Math.floor(kante / 8);
    const zeileVon = (y: number): Buffer => {
        const pixel = Buffer.alloc(kante * 4);
        for (let x = 0; x < kante; x += 1) {
            const innen = x >= rand && x < kante - rand && y >= rand && y < kante - rand;
            pixel.fill(innen ? 0x80 : 0, x * 4, x * 4 + 3);
            pixel[x * 4 + 3] = innen ? 0xff : 0;
        }
        return Buffer.concat([Buffer.from([0]), pixel]);
    };
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        stueck("IHDR", kopf),
        stueck("IDAT", deflateSync(Buffer.concat(Array.from({ length: kante }, (_, y) => zeileVon(y))))),
        stueck("IEND", Buffer.alloc(0)),
    ]);
}

/**
 * Editoren geben frei (WI-0282, Betreiber 2026-11-06): „Rechte geprüft“ gleich beim Hochladen, auch am eigenen Bild. Die Lizenz eines Community-Uploads
 * ändert nur der Betreiber; freigeben dürfen Editoren. Was der Server daraus macht, prüfen die Servertests.
 */
test("🔴 Hochladen mit dem Prüfrecht: Der Haken „Rechte geprüft“ ist gesetzt, und die Freigabe geht mit", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media", "review_media_rights"]);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const neu = wappen.items[0]!.id;
    const gesendet: Record<string, unknown>[] = [];
    await page.route(
        (url) => url.pathname === "/api/editor/media",
        async (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            const body = route.request().postDataJSON() as Record<string, unknown>;
            gesendet.push(body);
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    operationId: body["operationId"],
                    status: "applied",
                    environment: "development",
                    affected: [{ kind: "media_asset", id: neu, revision: 1 }],
                    derivedWork: [],
                    warnings: [],
                }),
            });
        },
    );
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await ueberMenue(page);
    await page.getByTestId("medien-arten-eintrag-typ-coat").click();
    await page.getByTestId("medien-hochladen-coat").click();
    const haken = page.getByTestId("medien-hochladen-freigeben");
    await expect(haken).toBeChecked();
    await expect(page.getByTestId("medien-hochladen-pruefung")).toHaveCount(0);
    await page.getByTestId("medien-hochladen-titel").locator("input").fill("Wappen einer Probe");
    await page
        .getByTestId("medien-hochladen-datei")
        .setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: graueFlaeche(128) });
    // Bei unbekannter Grundlage ruht der Haken: Sie lässt sich nicht freigeben.
    const grundlage = page.getByTestId("medien-hochladen-grundlage").locator("select");
    await grundlage.selectOption("unknown");
    await expect(haken).toBeDisabled();
    await grundlage.selectOption("own_work");
    await expect(haken).toBeEnabled();
    await page.getByTestId("medien-hochladen-senden").click();
    await expect(page.getByTestId("medien-hochladen-fenster")).toHaveCount(0);
    expect(gesendet).toHaveLength(1);
    expect((gesendet[0]!["form"] as Record<string, unknown>)["rightsReviewed"]).toBe(true);
});

test("🔴 Community-Upload: Grundlage und Lizenz sind gesperrt und nennen den Grund, freigeben geht; der Betreiber ändert sie", async ({
    page,
}) => {
    const q = await oeffneKarte(page);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    const id = wappen.items[0]!.id;
    const detail = (await q.assetDetail(q.db, id))!;
    await page.route(`**/api/editor/media/${id}`, (route) =>
        route.request().method() === "GET"
            ? route.fulfill({
                  contentType: "application/json",
                  body: JSON.stringify({ ...detail, asset: { ...detail.asset, origin: "community_upload" } }),
              })
            : route.fallback(),
    );
    const oeffne = async (rechte: readonly string[]) => {
        await stubSitzung(page, [...MIT_MEDIEN, "upload_media", "review_media_rights", ...rechte]);
        await page.goto(`/edit?medien=${id}`);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await expect(page.getByTestId("medien-pillen")).toBeVisible({ timeout: 15_000 });
        await page.getByTestId("medien-kasten-rechte-bearbeiten").click();
    };
    const auswahl = page.getByTestId("medien-bearbeiten-grundlage").locator("select");

    await oeffne([]);
    await expect(auswahl).toBeDisabled();
    await expect(page.getByTestId("medien-inspektor")).toContainText("Die Lizenz ändert nur der Betreiber.");
    await expect(page.getByTestId("medien-pruefung-cleared")).toBeEnabled();

    await oeffne(["edit_community_license"]);
    await expect(auswahl).toBeEnabled();
    await expect(page.getByTestId("medien-inspektor")).not.toContainText("Die Lizenz ändert nur der Betreiber.");
});
