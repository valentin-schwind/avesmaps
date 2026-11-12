import { expect, test, type Page } from "@playwright/test";
import { GARETH_ORT, kleinesPng, stubReisebilder, type Attrappe, type AttrappeOptionen } from "./reisebild-stub.ts";
import { freeSpot, GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Das Formular „Eigenes Bild hinzufügen“ am Rechner (WI-0272 S2b, Aufgabe 13): Rechtsklick, Formular, Einreichen, der persönliche Link; dazu die Statusseite `/reisebild#…` (Aufgabe 14). Der Server ist eine Attrappe
 * (`reisebild-stub.ts`); den Telefonfall (das Blatt unten) hält `reisebild-einreichen.touch.spec.ts`, die Bilder für die Abnahme `reisebild-review.spec.ts`.
 *
 * Problemfälle: „Einreichen“ ist offen, obwohl Bild, Beschreibung, Art oder Häkchen fehlen; CC BY bleibt bei einer Avesmaps-Aufnahme wählbar; der Rumpf trägt nicht die Fassung der Bedingungen oder die
 * Dauer; der Dateiname des Besuchers geht mit; die Bestätigung zeigt keinen Link oder lässt die Stelle auf der Karte stehen; „Noch ein Bild von hier“ beginnt mit dem alten Text; der Honigtopf ist zu
 * erreichen; ein Fehler des Servers löscht den Text.
 */

/** Ein gültiges PNG von 64 × 48 Bildpunkten. */
const PNG = kleinesPng();

const TREFFER = [
    { kind: "ort", id: GARETH_ORT.id, name: "Gareth", subtype: "metropole", x: GARETH.x, y: GARETH.y, zoom: 5 },
    {
        kind: "weg",
        id: "name:Reichsstraße 1",
        name: "Reichsstraße 1",
        subtype: "reichsstrasse",
        x: 560,
        y: 540,
        zoom: 5,
    },
];

const GROESSEN = [
    { name: "1920 × 1080", breite: 1920, hoehe: 1080 },
    { name: "1280 × 800", breite: 1280, hoehe: 800 },
] as const;

async function oeffneFormular(page: Page, breite: number, hoehe: number): Promise<{ x: number; y: number }> {
    await page.setViewportSize({ width: breite, height: hoehe });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 460, y: 300 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await page.getByTestId("context-photobox").click();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    return spot;
}

const einreichen = (page: Page) => page.getByTestId("reisebild-einreichen");
const grund = (page: Page) => page.getByTestId("reisebild-sperrgrund");

async function fuelle(page: Page, optionen: { art?: string } = {}): Promise<void> {
    await page
        .getByTestId("reisebild-datei")
        .setInputFiles({ name: "Urlaub mit Oma IMG_0042.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("reisebild-vorschau")).toBeVisible();
    await page.getByTestId("reisebild-text").fill("  Der Markt am Morgen.  ");
    await page.getByTestId(`reisebild-entstehung-${optionen.art ?? "photo"}`).click();
    await page.getByTestId("reisebild-haken").click();
}

const gesendet = (attrappe: Attrappe) => attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/einreichungen");

/** Der persönliche Link kommt in die Zwischenablage; der Knopf zeigt „Kopiert“. Danach geht jeder Weg aus der Bestätigung ohne Halt. */
async function kopiereLink(page: Page): Promise<void> {
    await page.getByTestId("reisebild-fertig-kopieren").click();
    await expect(page.getByTestId("reisebild-fertig-kopieren")).toContainText("Kopiert");
}

/** Das Formular ausfüllen, einreichen und bis zur Bestätigung warten (die Zwischenablage ist erlaubt, damit „Link kopieren“ gelingt). */
async function reiche(page: Page, breite = 1280, hoehe = 800): Promise<void> {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await oeffneFormular(page, breite, hoehe);
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
}

for (const groesse of GROESSEN) {
    test(`🔴 ${groesse.name}: Rechtsklick, Formular, Einreichen, der persönliche Link steht da und die Stelle geht von der Karte`, async ({
        page,
    }) => {
        const attrappe = await stubReisebilder(page, { suchtreffer: TREFFER });
        const spot = await oeffneFormular(page, groesse.breite, groesse.hoehe);

        // Die Stelle in Worten, vom nächsten Ort her (die Attrappe nennt Gareth).
        await expect(page.getByTestId("reisebild-stelle-text")).toContainText("Gareth");
        // 🔴 Gesperrt, solange etwas fehlt (aria-disabled), aber drückbar; der Grund steht erst nach einem Druck da (Entwurf 8), nicht dauerhaft.
        await expect(einreichen(page)).toBeDisabled();
        await expect(einreichen(page)).toHaveAttribute("aria-disabled", "true");
        await expect(grund(page)).toHaveCount(0);
        // `aria-disabled` gilt Playwright als nicht bedienbar; ein Mensch kann drücken (`force`).
        await einreichen(page).click({ force: true });
        await expect(grund(page)).toHaveText("Es fehlt ein Bild.");
        expect(gesendet(attrappe)).toHaveLength(0);
        // Das fehlende Feld ist markiert und hat den Fokus.
        await expect(page.getByTestId("reisebild-bild")).toHaveClass(/is-fehlt/u);
        await expect(page.getByTestId("reisebild-bild-waehlen")).toBeFocused();

        await page
            .getByTestId("reisebild-datei")
            .setInputFiles({ name: "Urlaub mit Oma IMG_0042.png", mimeType: "image/png", buffer: PNG });
        await expect(page.getByTestId("reisebild-vorschau")).toBeVisible();
        await expect(grund(page)).toHaveText("Es fehlt die Bildbeschreibung.");
        await page.getByTestId("reisebild-text").fill("  Der Markt am Morgen.  ");
        await expect(page.getByTestId("reisebild-text-zaehler")).toHaveText("24 / 300");
        await expect(grund(page)).toHaveText("Es fehlt die Angabe, wie das Bild entstanden ist.");
        await page.getByTestId("reisebild-entstehung-photo").click();
        await expect(grund(page)).toHaveText("Es fehlt das Häkchen bei der Erklärung.");
        await page.getByTestId("reisebild-haken").click();
        await expect(einreichen(page)).toBeEnabled();
        await expect(einreichen(page)).not.toHaveAttribute("aria-disabled", "true");
        await expect(grund(page)).toHaveCount(0);
        await expect(page.getByTestId("reisebild-bild")).not.toHaveClass(/is-fehlt/u);

        await einreichen(page).click();
        await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
        const eingereicht = gesendet(attrappe);
        expect(eingereicht).toHaveLength(1);
        const body = eingereicht[0]!.body as Record<string, unknown> & { falle: { feld: string; dauerMs: number } };
        expect(body).toMatchObject({
            bedingungen: "reisebilder-2026-11-04",
            beschreibung: "Der Markt am Morgen.",
            entstehung: "photo",
            nutzung: "avesmaps_only",
            bild: { name: expect.stringMatching(/^reisebild\.(webp|png)$/u) },
        });
        // 🔴 Der Dateiname des Besuchers geht nicht an den Server.
        expect(JSON.stringify(body)).not.toContain("Urlaub");
        expect(body.falle.feld).toBe("");
        expect(body.falle.dauerMs).toBeGreaterThan(0);
        expect(String(body["schluessel"])).toMatch(/^[A-Za-z0-9_-]{43}$/u);

        // Der Link steht im Kasten „Persönlicher Link“ (einzeilig gekürzt, voll im Titel), der Schlüssel im Fragment.
        const link = page.getByTestId("reisebild-fertig-link");
        await expect(link).toHaveAttribute("title", new RegExp(`/reisebild#${String(body["schluessel"])}$`, "u"));
        await expect(link).toContainText(String(body["schluessel"]));
        await expect(page.getByTestId("reisebild-fertig-stand")).toBeVisible();
        await expect(page.getByTestId("reisebild-fertig-noch-eins")).toBeVisible();

        // Die Stelle ist abgegeben: weder Symbol noch Linie auf der Karte.
        await expect(page.getByTestId("reisebild-linie")).toHaveCount(0);
        await expect
            .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") === undefined))
            .toBe(true);

        // „Noch ein Bild von hier“: ein frisches Formular an derselben Stelle, Art bleibt, Text und Bild nicht (mit kopiertem Link geht es ohne Halt).
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await kopiereLink(page);
        await page.getByTestId("reisebild-fertig-noch-eins").click();
        await expect(page.getByTestId("reisebild-formular")).toBeVisible();
        await expect(page.getByTestId("reisebild-text")).toHaveValue("");
        await expect(page.getByTestId("reisebild-vorschau")).toHaveCount(0);
        await expect(page.getByTestId("reisebild-entstehung-photo").locator("input")).toBeChecked();
        await expect(einreichen(page)).toBeDisabled();
        await expect
            .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") !== undefined))
            .toBe(true);
        expect(spot.x).toBeGreaterThan(0);
    });
}

test("🔴 nach dem Einreichen öffnet ein weiterer Rechtsklick „Eigenes Bild hinzufügen“ ein frisches Formular an der neuen Stelle (Review S2b I1)", async ({
    page,
}) => {
    const attrappe = await stubReisebilder(page);
    const erste = await oeffneFormular(page, 1280, 800);
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();

    // Nicht „Noch ein Bild von hier“, sondern ein Rechtsklick an einer anderen Stelle der Karte.
    const zweite = await freeSpot(page, { x: 460, y: 440 });
    expect(zweite.y).not.toBe(erste.y);
    await page.mouse.click(zweite.x, zweite.y, { button: "right" });
    await page.getByTestId("context-photobox").click();
    // Der Link ist weder kopiert noch gemerkt: Der erste Versuch hält an (Review S3 I1), erst der zweite öffnet das frische Formular.
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await page.mouse.click(zweite.x, zweite.y, { button: "right" });
    await page.getByTestId("context-photobox").click();
    await expect(page.getByTestId("reisebild-fertig")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    await expect(page.getByTestId("reisebild-text")).toHaveValue("");
    await expect(einreichen(page)).toBeDisabled();
    // Das Symbol steht wieder auf der Karte, und die Linie zieht vom Fenster dorthin.
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") !== undefined))
        .toBe(true);
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(1);

    // Das zweite Bild trägt eigene Stelle, eigenen Schlüssel und eigene Kennung.
    await fuelle(page);
    await einreichen(page).click();
    await expect.poll(() => gesendet(attrappe).length).toBe(2);
    const [a, b] = gesendet(attrappe).map(
        (aufruf) => aufruf.body as { operationId: string; schluessel: string; lage: { x: number; y: number } },
    );
    expect(b?.schluessel).not.toBe(a?.schluessel);
    expect(b?.operationId).not.toBe(a?.operationId);
    expect(b?.lage).not.toEqual(a?.lage);
});

test("🔴 CC BY ist bei einer Avesmaps-Aufnahme gesperrt, mit dem Satz dazu; wer CC BY gewählt hatte, bekommt die Vorgabe zurück", async ({
    page,
}) => {
    await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    const ccBy = page.getByTestId("reisebild-nutzung-cc-by-4.0").locator("input");
    const nurAvesmaps = page.getByTestId("reisebild-nutzung-avesmaps_only").locator("input");
    await expect(nurAvesmaps).toBeChecked();
    await expect(ccBy).toBeEnabled();
    await expect(page.getByTestId("reisebild-nutzung-erklaerung")).toContainText("Avesmaps darf das Bild");
    await page.getByTestId("reisebild-nutzung-cc-by-4.0").click();
    await expect(ccBy).toBeChecked();
    await expect(page.getByTestId("reisebild-nutzung-erklaerung")).toContainText("Jede Person darf das Bild");

    await page.getByTestId("reisebild-entstehung-avesmaps_capture").click();
    await expect(ccBy).toBeDisabled();
    await expect(nurAvesmaps).toBeChecked();
    await expect(page.getByTestId("reisebild-nutzung-grund")).toContainText("nur für Avesmaps");
    // Ein Klick auf den gesperrten Knopf ändert nichts.
    await page.getByTestId("reisebild-nutzung-cc-by-4.0").click({ force: true });
    await expect(nurAvesmaps).toBeChecked();

    await page.getByTestId("reisebild-entstehung-drawing").click();
    await expect(ccBy).toBeEnabled();
    await expect(page.getByTestId("reisebild-nutzung-grund")).toHaveCount(0);
});

test("die mitlaufende Suche schlägt einen Bezug vor; der Treffer wird mit einem Klick zum Bezug und geht in den Rumpf", async ({
    page,
}) => {
    const attrappe = await stubReisebilder(page, { suchtreffer: TREFFER });
    await oeffneFormular(page, 1280, 800);
    await fuelle(page);
    await page.getByTestId("reisebild-text").fill("Der Markt von Gar");
    await expect(page.getByTestId("reisebild-vorschlag")).toHaveCount(2);
    await expect(page.getByTestId("reisebild-vorschlag").first()).toContainText("Gareth");
    await page.getByTestId("reisebild-vorschlag").nth(1).click();
    await expect(page.getByTestId("reisebild-bezug")).toContainText("Reichsstraße 1");
    await expect(page.getByTestId("reisebild-vorschlag")).toHaveCount(0);
    // Wer den Bezug wieder wegnimmt, bekommt die Vorschläge zurück.
    await page.getByTestId("reisebild-bezug-weg").click();
    await expect(page.getByTestId("reisebild-vorschlag")).toHaveCount(2);
    await page.getByTestId("reisebild-vorschlag").first().click();
    await expect(page.getByTestId("reisebild-bezug")).toContainText("Gareth");
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    // Ein Treffer der Art Ort ist zugleich der Ort des Bildes.
    expect(gesendet(attrappe)[0]!.body).toMatchObject({ placeId: GARETH_ORT.id });
    expect(gesendet(attrappe)[0]!.body).not.toHaveProperty("bezug");
});

test("🔴 Blickrichtung ist eine Auswahlliste („ohne“ zuerst) und freiwillig; die Wahl geht als Himmelsrichtung in den Rumpf, „ohne“ lässt sie weg (Entwurf 8)", async ({
    page,
}) => {
    const attrappe = await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    const auswahl = page.getByTestId("reisebild-blick");
    await expect(auswahl).toBeVisible();
    await expect(auswahl).toHaveValue("");
    await expect(auswahl.locator("option")).toHaveText([
        "ohne",
        "Norden",
        "Nordosten",
        "Osten",
        "Südosten",
        "Süden",
        "Südwesten",
        "Westen",
        "Nordwesten",
    ]);
    await auswahl.selectOption({ label: "Osten" });
    await expect(auswahl).toHaveValue("2");
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    expect(gesendet(attrappe)[0]!.body).toMatchObject({ blickrichtung: 2 });

    // Zurück auf „ohne“: Das Feld fehlt im Rumpf.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await kopiereLink(page);
    await page.getByTestId("reisebild-fertig-noch-eins").click();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    const zweite = page.getByTestId("reisebild-blick");
    await zweite.selectOption({ label: "Westen" });
    await zweite.selectOption({ label: "ohne" });
    await fuelle(page);
    await einreichen(page).click();
    await expect.poll(() => gesendet(attrappe).length).toBe(2);
    expect(gesendet(attrappe)[1]!.body).not.toHaveProperty("blickrichtung");
});

test("🔴 „Bedingungen“ und „Mehr zum Datenschutz“ öffnen die Hinweise bei ihrem Abschnitt; das Formular behält, was darin steht", async ({
    page,
}) => {
    await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    await page.getByTestId("reisebild-text").fill("Der Markt am Morgen.");

    // Der Verweis im Häkchen führt zu den Bedingungen: der Abschnitt „Reisebilder“ steht offen und im Bild, das Häkchen ist unberührt.
    await page.getByTestId("reisebild-bedingungen").click();
    const hinweise = page.getByTestId("notes");
    await expect(hinweise).toBeVisible();
    const bedingungen = page.getByTestId("notes-photobox");
    await expect(bedingungen).toHaveAttribute("open", "");
    await expect(bedingungen).toBeInViewport();
    for (const punkt of ["Eigenes Werk", "Personen und Alter", "Prüfung"]) {
        await expect(bedingungen).toContainText(punkt);
    }
    await expect(bedingungen).toContainText("Eine Avesmaps-Aufnahme gibt es nur „Nur für Avesmaps“");
    // Die übrigen Abschnitte bleiben zu.
    await expect(page.getByTestId("notes-privacy")).not.toHaveAttribute("open", "");
    await hinweise.getByTestId("fenster-schliessen").click();
    await expect(hinweise).toBeHidden();

    // Der Kurzsatz zum Datenschutz steht hinter „ⓘ Datenschutz“ im Fuß; der Verweis darunter führt zum Datenschutz „Reisebilder“.
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    await expect(page.getByTestId("reisebild-text")).toHaveValue("Der Markt am Morgen.");
    await expect(page.getByTestId("reisebild-datenschutz")).toHaveCount(0);
    await page.getByTestId("reisebild-datenschutz-knopf").click();
    await expect(page.getByTestId("reisebild-datenschutz-knopf")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("reisebild-datenschutz")).toContainText(
        "Sichtbar erst nach Prüfung durch die Redaktion.",
    );
    await expect(page.getByTestId("reisebild-datenschutz")).toContainText("Gespeichert werden Bild, Beschreibung");
    await page.getByTestId("reisebild-datenschutz-link").click();
    await expect(hinweise).toBeVisible();
    const datenschutz = page.getByTestId("notes-privacy");
    await expect(datenschutz).toHaveAttribute("open", "");
    const reisebilder = datenschutz.locator("h4", { hasText: "Datenschutz bei Reisebildern" }).first();
    await expect(reisebilder).toBeInViewport();
    await hinweise.getByTestId("fenster-schliessen").click();
    await expect(page.getByTestId("reisebild-text")).toHaveValue("Der Markt am Morgen.");
});

test("🔴 der Honigtopf ist für Menschen nicht erreichbar, und ein gefüllter geht mit", async ({ page }) => {
    const attrappe = await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    const honig = page.getByTestId("reisebild-honig");
    await expect(honig).toHaveAttribute("aria-hidden", "true");
    await expect(honig).toHaveAttribute("inert", "");
    await expect(honig.locator("input")).toHaveAttribute("tabindex", "-1");
    // Ein Bot füllt es trotzdem (kein `display: none`): Es geht mit.
    await honig.locator("input").evaluate((feld: HTMLInputElement) => {
        feld.value = "http://spam.example";
        feld.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    expect(gesendet(attrappe)[0]!.body).toMatchObject({ falle: { feld: "http://spam.example" } });
});

test("🔴 ist der Schalter aus, steht „Einreichungen sind gerade nicht möglich“ statt eines toten Knopfs", async ({
    page,
}) => {
    await stubReisebilder(page, { einreichen: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 460, y: 300 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await page.getByTestId("context-photobox").click();
    await expect(page.getByTestId("reisebild-nicht-moeglich")).toContainText(
        "Einreichungen sind gerade nicht möglich.",
    );
    await expect(einreichen(page)).toHaveCount(0);
});

test("🔴 eine Grenze des Servers (429) nennt die Uhrzeit, und der Text bleibt; ein neuer Versuch trägt dieselbe Kennung", async ({
    page,
}) => {
    const attrappe = await stubReisebilder(page, { einreichenFehler: { status: 429, code: "photobox_rate" } });
    await oeffneFormular(page, 1280, 800);
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-problem")).toContainText("zu viele Einreichungen");
    await expect(page.getByTestId("reisebild-text")).toHaveValue("  Der Markt am Morgen.  ");
    await expect(page.getByTestId("reisebild-vorschau")).toBeVisible();
    await expect(einreichen(page)).toBeEnabled();
    await einreichen(page).click();
    await expect.poll(() => gesendet(attrappe).length).toBe(2);
    const [erste, zweite] = gesendet(attrappe).map(
        (aufruf) => aufruf.body as { operationId: string; schluessel: string },
    );
    expect(zweite?.operationId).toBe(erste?.operationId);
    expect(zweite?.schluessel).toBe(erste?.schluessel);
});

test("eine Datei, die kein Bild ist, wird mit einem Satz abgewiesen, ohne etwas zu senden", async ({ page }) => {
    const attrappe = await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    await page
        .getByTestId("reisebild-datei")
        .setInputFiles({ name: "karte.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(page.getByTestId("reisebild-bild-fehler")).toContainText("kein JPEG, PNG, WebP oder GIF");
    await expect(page.getByTestId("reisebild-vorschau")).toHaveCount(0);
    expect(gesendet(attrappe)).toHaveLength(0);
});

/** Wo das Symbol der Stelle auf dem Bildschirm liegt (Seitenkoordinaten), oder `undefined`, solange es nicht gezeichnet ist. */
const symbolPunkt = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const merkmal = map.queryRenderedFeatures({ layers: ["photobox-stelle"] })[0];
        if (merkmal === undefined) return undefined;
        const [lng, lat] = merkmal.geometry.coordinates;
        const punkt = map.project({ lng, lat });
        return { x: map.getCanvas().getBoundingClientRect().left + punkt.x, y: punkt.y };
    });

test("🔴 1920 × 1080: das Fenster steht in der Mitte, die Kamera fliegt die Stelle in die Mitte der freien Fläche links daneben, die Linie beginnt an der linken Kante (Entwurf 8)", async ({
    page,
}) => {
    await stubReisebilder(page);
    await oeffneFormular(page, 1920, 1080);
    const fenster = page.getByTestId("reisebild-fenster");
    // Mittig: waagerecht in der Mitte der Karte, senkrecht in der Mitte (das Fenster ist niedriger als die Karte).
    const kasten = (await fenster.boundingBox())!;
    expect(kasten.x + kasten.width / 2).toBeCloseTo(960, -1);
    expect(kasten.y + kasten.height / 2).toBeCloseTo(540, -1);
    // Der Planer links ist offen; links vom Fenster bleibt dennoch Platz, also landet die Stelle dort, nicht rechts.
    const planerRechts = await page.evaluate(
        () => document.querySelector('[data-map-overlay="left"]')?.getBoundingClientRect().right ?? 0,
    );
    await expect
        .poll(
            async () => {
                const symbol = await symbolPunkt(page);
                return symbol !== undefined && symbol.x > planerRechts && symbol.x < kasten.x - 24;
            },
            { timeout: 15_000 },
        )
        .toBe(true);
    const symbol = (await symbolPunkt(page))!;
    // In der Mitte der freien Fläche zwischen Planer und Fenster (so gut, wie die Fahrt trifft).
    expect(symbol.x).toBeCloseTo((planerRechts + kasten.x - 24) / 2, -2);
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(1);
    const pfad = await page.getByTestId("reisebild-linie").locator(".reisebild-linie__strich path").getAttribute("d");
    expect(Number(/^M([\d.-]+) /u.exec(pfad ?? "")![1])).toBeCloseTo(kasten.x, 0);
});

test("🔴 1280 × 800: der offene Planer lässt links vom Fenster keinen Platz, also landet die Stelle rechts daneben; das Fenster steht trotzdem in der Mitte und über der Reihe der Eckknöpfe", async ({
    page,
}) => {
    await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    const fenster = page.getByTestId("reisebild-fenster");
    const kasten = (await fenster.boundingBox())!;
    expect(kasten.x + kasten.width / 2).toBeCloseTo(640, -1);
    // Unten bleibt es im Bild und endet über „Neuigkeiten“ und „Hinweise“ nicht zwingend, aber nie außerhalb der Karte.
    expect(kasten.y).toBeGreaterThanOrEqual(0);
    expect(kasten.y + kasten.height).toBeLessThanOrEqual(800);
    const planerRechts = await page.evaluate(
        () => document.querySelector('[data-map-overlay="left"]')!.getBoundingClientRect().right,
    );
    expect(planerRechts).toBeGreaterThan(300);
    await expect
        .poll(
            async () => {
                const symbol = await symbolPunkt(page);
                return symbol !== undefined && symbol.x > kasten.x + kasten.width && symbol.x < 1280;
            },
            { timeout: 15_000 },
        )
        .toBe(true);
    // Die Linie beginnt an der rechten Kante, in der Höhe des Titels.
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(1);
    const pfad = await page.getByTestId("reisebild-linie").locator(".reisebild-linie__strich path").getAttribute("d");
    expect(Number(/^M([\d.-]+) /u.exec(pfad ?? "")![1])).toBeCloseTo(kasten.x + kasten.width, 0);
});

test("🔴 „Stelle ändern“: das Fenster wird zum schmalen Balken oben in der Mitte, die Mitte der Karte bleibt frei; nach der Wahl steht es wieder in der Mitte", async ({
    page,
}) => {
    await stubReisebilder(page);
    await oeffneFormular(page, 1920, 1080);
    const fenster = page.getByTestId("reisebild-fenster");
    const hoch = (await fenster.boundingBox())!;
    await page.getByTestId("reisebild-stelle-aendern").click();
    await expect(page.getByTestId("reisebild-modusleiste")).toBeVisible();
    await expect.poll(async () => (await fenster.boundingBox())!.height).toBeLessThan(200);
    const balken = (await fenster.boundingBox())!;
    expect(balken.y).toBeLessThan(40);
    expect(balken.x + balken.width / 2).toBeCloseTo(960, -1);
    // Die Karte darunter ist frei: Ein Klick in ihrer Mitte setzt die Stelle und beendet den Modus.
    const ziel = await freeSpot(page, { x: 1500, y: 600 });
    await page.mouse.click(ziel.x, ziel.y);
    await expect(page.getByTestId("reisebild-modusleiste")).toBeHidden();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    await expect.poll(async () => Math.round((await fenster.boundingBox())!.height)).toBe(Math.round(hoch.height));
    const wieder = (await fenster.boundingBox())!;
    expect(wieder.y + wieder.height / 2).toBeCloseTo(540, -1);
});

test("🔴 die Höhe bleibt stabil: ein gewähltes Bild, ein Bezug, der Satz zur Aufnahme und der Datenschutzsatz ändern sie nicht; „Bild hochladen“ bleibt im Bild", async ({
    page,
}) => {
    await stubReisebilder(page, { suchtreffer: TREFFER });
    await oeffneFormular(page, 1920, 1080);
    const fenster = page.getByTestId("reisebild-fenster");
    const hoehe = async (): Promise<number> => Math.round((await fenster.boundingBox())!.height);
    // Die Höhe wird beim Erscheinen einmal gemessen: Sie steht, sobald das Formular gezeichnet ist.
    await expect.poll(hoehe).toBeGreaterThan(600);
    const leer = await hoehe();
    const gleich = async (): Promise<void> => expect(await hoehe()).toBe(leer);

    await page.getByTestId("reisebild-datei").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("reisebild-vorschau")).toBeVisible();
    await gleich();
    await page.getByTestId("reisebild-text").fill("Der Markt von Gar");
    await expect(page.getByTestId("reisebild-vorschlag")).toHaveCount(2);
    await gleich();
    await page.getByTestId("reisebild-vorschlag").first().click();
    await expect(page.getByTestId("reisebild-bezug")).toBeVisible();
    await gleich();
    await page.getByTestId("reisebild-entstehung-avesmaps_capture").click();
    await expect(page.getByTestId("reisebild-nutzung-grund")).toBeVisible();
    await gleich();
    await page.getByTestId("reisebild-datenschutz-knopf").click();
    await expect(page.getByTestId("reisebild-datenschutz")).toBeVisible();
    await gleich();
    // Es fehlen noch Beschreibung und Häkchen? Nein: Bild, Text und Art stehen, das Häkchen fehlt; der Druck zeigt den Grund im Fuß.
    await einreichen(page).click({ force: true });
    await expect(grund(page)).toBeVisible();
    await gleich();

    // Der Fuß steht im Bild, auch wenn der Rumpf nachgibt.
    const knopf = (await einreichen(page).boundingBox())!;
    expect(knopf.y + knopf.height).toBeLessThanOrEqual(1080);
    await expect(einreichen(page)).toBeInViewport({ ratio: 1 });
});

// --- Die Bestätigung nach dem Einreichen (Entwurf 8) ------------------------------------------------------------------------------

test("🔴 Bestätigung: Titel mit Unterzeile, „Eingereicht.“, der Link im Kasten, das Bild mit dem Ablauf; „Link kopieren“ zeigt 2,6 s „Kopiert“, legt den Link in die Zwischenablage und ist nie höher als das Formular davor", async ({
    page,
}) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const attrappe = await stubReisebilder(page);
    await oeffneFormular(page, 1920, 1080);
    await fuelle(page);
    const fenster = page.getByTestId("reisebild-fenster");
    const hoeheFormular = (await fenster.boundingBox())!.height;
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();

    await expect(fenster.locator(".avm-fenster__titel")).toHaveText("Reisebild eingereicht");
    await expect(page.getByTestId("fenster-unterzeile")).toHaveText("Ein Bild mehr für die Karte von Aventurien.");
    await expect(page.getByTestId("reisebild-fertig-hinweis")).toContainText("Eingereicht.");
    await expect(page.getByTestId("reisebild-fertig-hinweis")).toContainText(
        "Sichtbar wird das Bild erst, wenn die Redaktion es freigegeben hat.",
    );
    await expect(page.getByTestId("reisebild-fertig-linksatz")).toHaveText(
        "Nur über diesen Link lässt sich das Bild ändern, zurückziehen oder offline nehmen.",
    );
    // Die Bildkarte: die Vorschau (nie abgedunkelt), die Beschreibung, die Stelle und die Entstehung, der Ablauf.
    await expect(page.getByTestId("reisebild-fertig-vorschau")).toHaveAttribute("src", /^blob:/u);
    await expect(page.getByTestId("reisebild-fertig-beschreibung")).toHaveText("Der Markt am Morgen.");
    await expect(page.getByTestId("reisebild-fertig-beleg")).toContainText("Gareth");
    await expect(page.getByTestId("reisebild-fertig-beleg")).toContainText("Foto");
    await expect(page.getByTestId("reisebild-fertig-beleg").locator("ol li")).toHaveText([
        "Eingereicht",
        "In Prüfung",
        "Veröffentlicht",
    ]);
    // Der Kasten steht gleich als zweites, vor dem Bild, und die Warnung steht noch nicht.
    await expect(page.getByTestId("reisebild-fertig-warnung")).toHaveCount(0);
    expect((await page.getByTestId("reisebild-fertig-linkkasten").boundingBox())!.y).toBeLessThan(
        (await page.getByTestId("reisebild-fertig-beleg").boundingBox())!.y,
    );
    // Die Bestätigung ist nie höher als das Formular davor, der Fuß steht im Bild.
    expect((await fenster.boundingBox())!.height).toBeLessThanOrEqual(hoeheFormular + 1);
    const schliessen = (await page.getByTestId("reisebild-fertig-schliessen").boundingBox())!;
    expect(schliessen.y + schliessen.height).toBeLessThanOrEqual(1080);

    // „Link kopieren“: 2,6 s „Kopiert“, dann wieder „Link kopieren“; der volle Link liegt in der Zwischenablage.
    const knopf = page.getByTestId("reisebild-fertig-kopieren");
    await expect(knopf).toContainText("Link kopieren");
    const breite = (await knopf.boundingBox())!.width;
    await knopf.click();
    await expect(knopf).toContainText("Kopiert");
    await expect(knopf).toHaveClass(/is-kopiert/u);
    expect(Math.abs((await knopf.boundingBox())!.width - breite)).toBeLessThan(2);
    const schluessel = String((gesendet(attrappe)[0]!.body as Record<string, unknown>)["schluessel"]);
    const zwischenablage = await page.evaluate(() => navigator.clipboard.readText());
    expect(zwischenablage).toMatch(new RegExp(`^https?://[^/]+/reisebild#${schluessel}$`, "u"));
    await expect(knopf).toContainText("Link kopieren", { timeout: 6000 });
    await expect(knopf).not.toHaveClass(/is-kopiert/u);
});

/** Die drei Wege, das Fenster der Bestätigung zu schließen, und wie sie ausgelöst werden. */
const SCHLIESSWEGE: readonly (readonly [string, (page: Page) => Promise<void>])[] = [
    ["✕", (page) => page.getByTestId("reisebild-fenster").getByTestId("fenster-schliessen").click()],
    ["Esc", (page) => page.keyboard.press("Escape")],
    ["„Schließen“", (page) => page.getByTestId("reisebild-fertig-schliessen").click()],
];

for (const [name, weg] of SCHLIESSWEGE) {
    test(`🔴 ${name} ohne kopierten oder gemerkten Link hält einmal an („Link noch nicht kopiert oder gemerkt.“, Warnring, Fokus auf „Kopieren“); der zweite Versuch geht durch`, async ({
        page,
    }) => {
        await stubReisebilder(page);
        await reiche(page);
        const fenster = page.getByTestId("reisebild-fenster");
        await expect(page.getByTestId("reisebild-fertig-warnung")).toHaveCount(0);

        await weg(page);
        await expect(fenster).toBeVisible();
        const warnung = page.getByTestId("reisebild-fertig-warnung");
        await expect(warnung).toContainText("Link noch nicht kopiert oder gemerkt.");
        await expect(page.getByTestId("reisebild-fertig-linkkasten")).toHaveClass(/is-fehlt/u);
        await expect(page.getByTestId("reisebild-fertig-warn-kopieren")).toBeFocused();
        await expect(page.getByTestId("reisebild-fertig-trotzdem")).toHaveText("Trotzdem schließen");
        // Der Linkkasten ist in Sicht (der Rumpf rollt, wo das Fenster niedrig ist).
        await expect(page.getByTestId("reisebild-fertig-linkkasten")).toBeInViewport();

        await weg(page);
        await expect(fenster).toHaveCount(0);
    });
}

test("🔴 „Trotzdem schließen“ schließt, ohne zu kopieren; „Kopieren“ in der Warnung kopiert, meldet und schließt dann", async ({
    page,
}) => {
    await stubReisebilder(page);
    await reiche(page);
    const fenster = page.getByTestId("reisebild-fenster");
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    await page.getByTestId("reisebild-fertig-trotzdem").click();
    await expect(fenster).toHaveCount(0);

    // Noch einmal: Jetzt wird in der Warnung kopiert und dann geschlossen.
    await reiche(page);
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    await page.getByTestId("reisebild-fertig-warn-kopieren").click();
    await expect(fenster).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/reisebild#[A-Za-z0-9_-]{43}$/u);
});

test("🔴 „Noch ein Bild von hier“ hält ohne kopierten Link ebenfalls einmal an („Trotzdem weiter“); nach dem Kopieren gehen alle Wege sofort", async ({
    page,
}) => {
    await stubReisebilder(page);
    await reiche(page);
    await page.getByTestId("reisebild-fertig-noch-eins").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    await expect(page.getByTestId("reisebild-fertig-trotzdem")).toHaveText("Trotzdem weiter");
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await page.getByTestId("reisebild-fertig-trotzdem").click();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    await expect(page.getByTestId("reisebild-text")).toHaveValue("");

    // Mit kopiertem Link: kein Halt, die Warnung ist weg.
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await kopiereLink(page);
    await expect(page.getByTestId("reisebild-fertig-warnung")).toHaveCount(0);
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);
});

test("🔴 ging das Kopieren nicht (Zwischenablage gesperrt), sagt die Zeile es, der Link ist markiert, und die Warnung bleibt stehen", async ({
    page,
}) => {
    await stubReisebilder(page);
    await oeffneFormular(page, 1280, 800);
    // Die Zwischenablage lehnt jedes Schreiben ab.
    await page.evaluate(() => {
        const abgelehnt = (): Promise<never> => Promise.reject(new Error("gesperrt"));
        Object.defineProperty(navigator, "clipboard", {
            value: { write: abgelehnt, writeText: abgelehnt },
            configurable: true,
        });
        document.execCommand = () => false;
    });
    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    await page.getByTestId("reisebild-fertig-warn-kopieren").click();
    await expect(page.getByTestId("reisebild-fertig-meldung")).toContainText("Kopieren ging hier nicht");
    // Das Fenster bleibt, und der Link ist markiert: Strg+C nimmt ihn mit.
    await expect(page.getByTestId("reisebild-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toContain("/reisebild#");
});

// --- Die Statusseite `/reisebild#…` (Aufgabe 14) ---------------------------------------------------------------------------

const SCHLUESSEL = "kQ3vZp9Xw2Lh7Rt5Yb8Nc1Jd4Fa6Ge0Hs-_MuoTiPKq";

/** Ein Stand, wie der Server ihn liefert (`PhotoboxStatus`): eine Einreichung, die auf Prüfung wartet, mit bereitem Bild. */
const stand = (teil: Record<string, unknown> = {}): Record<string, unknown> => ({
    zustand: "pending",
    eingereichtAm: "2026-10-31T10:00:00.000Z",
    beschreibung: "Der Markt am Morgen.",
    entstehung: "photo",
    nutzung: "avesmaps_only",
    blickrichtung: 2,
    name: "Alrik",
    lage: { x: 560, y: 540 },
    ortName: "Gareth",
    vorschauBereit: true,
    angepasst: false,
    ...teil,
});

const aktionen = (attrappe: Attrappe) =>
    attrappe.aufrufe.filter((aufruf) => aufruf.pfad.startsWith("/status/") && aufruf.pfad !== "/status/vorschau");

async function oeffneStatus(
    page: Page,
    status: Record<string, unknown> | undefined,
    hash = SCHLUESSEL,
    weitere: Partial<AttrappeOptionen> = {},
) {
    const attrappe = await stubReisebilder(page, { status, ...weitere });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMap(page, `/reisebild#${hash}`);
    return attrappe;
}

/** Die Knöpfe, die die Tafel `photoboxAktionErlaubt` je Zustand erlaubt (packages/shared/src/photobox.ts), als Kennungen der Seite; „zeigen“ steht immer da. */
const ERWARTET: Record<string, readonly string[]> = {
    incoming: ["zeigen", "beschreibung", "bild", "nutzung-ccby", "zurueckziehen"],
    pending: ["zeigen", "beschreibung", "bild", "nutzung-ccby", "zurueckziehen"],
    changes_requested: ["zeigen", "beschreibung", "bild", "nutzung-ccby", "zurueckziehen"],
    approved: ["zeigen", "beschreibung", "nutzung-ccby", "offline"],
    rejected: ["zeigen", "neues-bild"],
    withdrawn: ["zeigen", "neues-bild"],
    offline: ["zeigen", "neues-bild"],
    expired: ["zeigen", "neues-bild"],
    // Technisch gescheitert: ein anderes Bild schicken oder zurückziehen (WI-0272 S3), sonst hinge die Einreichung 60 Tage.
    technical_failed: ["zeigen", "bild", "zurueckziehen"],
};
const ALLE_KNOEPFE = [
    "zeigen",
    "beschreibung",
    "bild",
    "nutzung-ccby",
    "nutzung-avesmaps",
    "zurueckziehen",
    "offline",
    "neues-bild",
];

for (const [zustand, erwartet] of Object.entries(ERWARTET)) {
    test(`🔴 Statusseite, Zustand ${zustand}: genau die Knöpfe der Tafel`, async ({ page }) => {
        await oeffneStatus(page, stand({ zustand }));
        await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
        for (const knopf of ALLE_KNOEPFE) {
            const da = page.getByTestId(`reisebild-status-${knopf}`);
            if (erwartet.includes(knopf)) await expect(da, knopf).toBeVisible();
            else await expect(da, knopf).toHaveCount(0);
        }
    });
}

test("🔴 /reisebild#<Schlüssel>: Die Adresse wird aufgeräumt, der Schlüssel steht in keiner Adresse und geht im Rumpf", async ({
    page,
}) => {
    const adressen: string[] = [];
    page.on("request", (anfrage) => adressen.push(anfrage.url()));
    const attrappe = await oeffneStatus(page, stand());
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("In Prüfung");
    expect(await page.evaluate(() => location.pathname)).toBe("/");
    expect(await page.evaluate(() => location.href)).not.toContain(SCHLUESSEL);
    expect(adressen.filter((adresse) => adresse.includes(SCHLUESSEL))).toEqual([]);
    const status = attrappe.aufrufe.find((aufruf) => aufruf.pfad === "/status")!;
    expect(status.body).toEqual({ schluessel: SCHLUESSEL });
    // Der Stand in Worten, die Angaben und die Leiste.
    await expect(page.getByTestId("reisebild-status-satz")).toContainText("Wartet auf die Prüfung durch die Redaktion");
    await expect(page.getByTestId("reisebild-status-verlauf")).toBeVisible();
    await expect(page.getByTestId("reisebild-status-beschreibungstext")).toHaveText("Der Markt am Morgen.");
    await expect(page.getByTestId("reisebild-status-angaben")).toContainText("Nennung: Alrik");
    await expect(page.getByTestId("reisebild-status-angaben")).toContainText("Blick nach Osten");
    // Die Vorschau ist ein Blob, keine Adresse mit dem Schlüssel.
    await expect(page.getByTestId("reisebild-status-vorschau")).toHaveAttribute("src", /^blob:/u);
});

test("🔴 ein 404 zeigt „Zu diesem Link gibt es kein Reisebild (mehr).“", async ({ page }) => {
    await oeffneStatus(page, undefined);
    await expect(page.getByTestId("reisebild-status-fehlt")).toHaveText(
        "Zu diesem Link gibt es kein Reisebild (mehr).",
    );
});

test("ein verstümmelter Schlüssel sagt denselben Satz, ohne den Server zu fragen", async ({ page }) => {
    const attrappe = await oeffneStatus(page, stand(), "zu-kurz");
    await expect(page.getByTestId("reisebild-status-fehlt")).toHaveText(
        "Zu diesem Link gibt es kein Reisebild (mehr).",
    );
    expect(attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/status")).toEqual([]);
});

test("solange die Vorschau fehlt, steht „Vorschau wird gerechnet“; „Neu laden“ holt sie, sobald sie bereit ist", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand({ vorschauBereit: false }));
    await expect(page.getByTestId("reisebild-status-vorschau-leer")).toContainText("Vorschau wird gerechnet");
    await expect(page.getByTestId("reisebild-status-vorschau")).toHaveCount(0);
    attrappe.optionen.status = stand({ vorschauBereit: true });
    await page.getByTestId("reisebild-status-neu-laden").first().click();
    await expect(page.getByTestId("reisebild-status-vorschau")).toHaveAttribute("src", /^blob:/u);
    expect(attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/status/vorschau").length).toBeGreaterThanOrEqual(1);
});

test("🔴 die Lesegrenze (429) beim Öffnen sagt „zu viele Abrufe“, ohne rohen Platzhalter; „Neu laden“ holt den Stand, sobald es wieder geht (Review S2b I2)", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand(), SCHLUESSEL, {
        statusFehler: { status: 429, code: "photobox_rate" },
    });
    const fehler = page.getByTestId("reisebild-status-fehler");
    await expect(fehler).toContainText("Gerade zu viele Abrufe.");
    await expect(fehler).not.toContainText("{");
    await expect(fehler).not.toContainText("Einreichungen");
    attrappe.optionen.statusFehler = undefined;
    await page.getByTestId("reisebild-status-neu-laden").click();
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("In Prüfung");
    await expect(fehler).toHaveCount(0);
});

test("🔴 „Neu laden“ mit schon gezeigtem Stand: scheitert es, steht der Fehler im Fenster und der Stand bleibt; danach geht es wieder (Review S2b I2)", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand());
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("In Prüfung");
    attrappe.optionen.statusFehler = { status: 429, code: "photobox_rate" };
    await page.getByTestId("reisebild-status-neu-laden").first().click();
    const fehler = page.getByTestId("reisebild-status-neu-fehler");
    await expect(fehler).toContainText("Gerade zu viele Abrufe.");
    await expect(fehler).not.toContainText("{");
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("In Prüfung");
    attrappe.optionen.statusFehler = { status: 500, code: "internal_error" };
    await page.getByTestId("reisebild-status-neu-laden").first().click();
    await expect(fehler).toContainText("Der Stand konnte nicht geladen werden.");
    attrappe.optionen.statusFehler = undefined;
    await page.getByTestId("reisebild-status-neu-laden").first().click();
    await expect(fehler).toHaveCount(0);
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("In Prüfung");
});

test("🔴 „von der Redaktion angepasst“ und die Nachricht der Redaktion stehen da, wo es sie gibt", async ({ page }) => {
    await oeffneStatus(
        page,
        stand({
            zustand: "changes_requested",
            angepasst: true,
            nachricht: "Ist auf dem Bild eine Person zu erkennen?",
        }),
    );
    await expect(page.getByTestId("reisebild-status-angepasst")).toHaveText("Von der Redaktion angepasst");
    await expect(page.getByTestId("reisebild-status-nachricht")).toContainText("Nachricht der Redaktion");
    await expect(page.getByTestId("reisebild-status-nachricht")).toContainText(
        "Ist auf dem Bild eine Person zu erkennen?",
    );
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("Rückfrage");
});

test("🔴 Beschreibung ändern: vor der Freigabe gilt sie sofort, nach der Freigabe wartet sie auf Prüfung und die alte bleibt stehen", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand());
    await page.getByTestId("reisebild-status-beschreibung").click();
    await page.getByTestId("reisebild-status-text").fill("  Der Markt zu Mittag.  ");
    await page.getByTestId("reisebild-status-speichern").click();
    await expect(page.getByTestId("reisebild-status-beschreibungstext")).toHaveText("Der Markt zu Mittag.");
    expect(aktionen(attrappe).at(-1)).toMatchObject({
        pfad: "/status/beschreibung",
        body: { schluessel: SCHLUESSEL, beschreibung: "Der Markt zu Mittag." },
    });
    expect((aktionen(attrappe).at(-1)!.body as { operationId: string }).operationId).toMatch(/^[0-9a-f-]{36}$/u);

    attrappe.optionen.status = stand({ zustand: "approved" });
    await page.getByTestId("reisebild-status-neu-laden").first().click();
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("Veröffentlicht");
    await page.getByTestId("reisebild-status-beschreibung").click();
    await expect(page.getByTestId("reisebild-status-aendern")).toContainText("neu geprüft");
    await page.getByTestId("reisebild-status-text").fill("Der Markt am Abend.");
    await page.getByTestId("reisebild-status-speichern").click();
    await expect(page.getByTestId("reisebild-status-wartend")).toContainText("Der Markt am Abend.");
    await expect(page.getByTestId("reisebild-status-beschreibungstext")).toHaveText("Der Markt am Morgen.");
});

test("Beschreibung: Esc in der Änderung bricht sie ab und schließt das Fenster nicht", async ({ page }) => {
    await oeffneStatus(page, stand());
    await page.getByTestId("reisebild-status-beschreibung").click();
    await page.getByTestId("reisebild-status-text").fill("Neu");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reisebild-status-aendern")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-status-fenster")).toBeVisible();
});

test("🔴 Zurückziehen fragt einmal nach, im Fenster; Abbrechen sendet nichts", async ({ page }) => {
    const attrappe = await oeffneStatus(page, stand());
    await page.getByTestId("reisebild-status-zurueckziehen").click();
    await expect(page.getByTestId("reisebild-status-zurueckziehen-frage")).toContainText(
        "Dieses Reisebild zurückziehen?",
    );
    await page.getByTestId("reisebild-status-zurueckziehen-frage").getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByTestId("reisebild-status-zurueckziehen-frage")).toHaveCount(0);
    expect(aktionen(attrappe)).toHaveLength(0);
    await page.getByTestId("reisebild-status-zurueckziehen").click();
    await page
        .getByTestId("reisebild-status-zurueckziehen-frage")
        .getByRole("button", { name: "Zurückziehen" })
        .click();
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("Zurückgezogen");
    expect(aktionen(attrappe).map((aufruf) => aufruf.pfad)).toEqual(["/status/zurueckziehen"]);
    await expect(page.getByTestId("reisebild-status-zurueckziehen")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-status-neues-bild")).toBeVisible();
});

test("🔴 „Sofort offline nehmen“ fragt einmal nach und sagt, dass es nicht rückgängig zu machen ist", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand({ zustand: "approved" }));
    await page.getByTestId("reisebild-status-offline").click();
    const frage = page.getByTestId("reisebild-status-offline-frage");
    await expect(frage).toContainText("Rückgängig machen lässt sich das nicht");
    await frage.getByRole("button", { name: "Abbrechen" }).click();
    expect(aktionen(attrappe)).toHaveLength(0);
    await page.getByTestId("reisebild-status-offline").click();
    await page.getByTestId("reisebild-status-offline-frage").getByRole("button", { name: "Offline nehmen" }).click();
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("Offline");
    expect(aktionen(attrappe).map((aufruf) => aufruf.pfad)).toEqual(["/status/offline"]);
    await expect(page.getByTestId("reisebild-status-offline")).toHaveCount(0);
});

test("🔴 CC BY: vor der Freigabe in beide Richtungen, nach der Freigabe nur hin und erst nach der Frage", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand({ nutzung: "cc-by-4.0" }));
    // Vor der Freigabe: zurück zu „Nur für Avesmaps“ gleich, ohne Frage.
    await page.getByTestId("reisebild-status-nutzung-avesmaps").click();
    await expect(page.getByTestId("reisebild-status-nutzung-ccby")).toBeVisible();
    expect(aktionen(attrappe).at(-1)).toMatchObject({ pfad: "/status/nutzung", body: { nutzung: "avesmaps_only" } });

    attrappe.optionen.status = stand({ zustand: "approved" });
    await page.getByTestId("reisebild-status-neu-laden").first().click();
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("Veröffentlicht");
    await expect(page.getByTestId("reisebild-status-nutzung-avesmaps")).toHaveCount(0);
    await page.getByTestId("reisebild-status-nutzung-ccby").click();
    await expect(page.getByTestId("reisebild-status-ccby-frage")).toContainText("Das lässt sich nicht zurücknehmen");
    await page.getByTestId("reisebild-status-ccby-frage").getByRole("button", { name: "Umstellen" }).click();
    await expect(page.getByTestId("reisebild-status-nutzung-ccby")).toHaveCount(0);
    expect(aktionen(attrappe).at(-1)).toMatchObject({ pfad: "/status/nutzung", body: { nutzung: "cc-by-4.0" } });
});

test("eine Avesmaps-Aufnahme bietet CC BY nie an", async ({ page }) => {
    await oeffneStatus(page, stand({ entstehung: "avesmaps_capture" }));
    await expect(page.getByTestId("reisebild-status-beschreibung")).toBeVisible();
    await expect(page.getByTestId("reisebild-status-nutzung-ccby")).toHaveCount(0);
});

test("🔴 Bild ersetzen: das neue Bild geht ohne den Dateinamen des Besuchers an den Server, die Prüfung beginnt neu", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand());
    await page
        .getByTestId("reisebild-status-datei")
        .setInputFiles({ name: "Neues Foto von Oma.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("reisebild-status-vorschau-leer")).toContainText("Vorschau wird gerechnet");
    const letzte = aktionen(attrappe).at(-1)!;
    expect(letzte.pfad).toBe("/status/bild");
    expect(JSON.stringify(letzte.body)).not.toContain("Oma");
    expect(letzte.body).toMatchObject({
        schluessel: SCHLUESSEL,
        bild: { name: expect.stringMatching(/^reisebild\.(webp|png)$/u) },
    });
});

test("🔴 ein Fehler der Aktion (409) steht im Fenster, der Stand bleibt; derselbe Versuch trägt dieselbe Kennung", async ({
    page,
}) => {
    const attrappe = await oeffneStatus(page, stand());
    // WI-0291: Der Server schickt den Grund als Fachcode (`uebergang`); das Fenster sagt ihn und lädt den Stand neu.
    attrappe.optionen.aktionFehler = { status: 409, code: "photobox_transition", details: { reason: "uebergang" } };
    await page.getByTestId("reisebild-status-zurueckziehen").click();
    await page
        .getByTestId("reisebild-status-zurueckziehen-frage")
        .getByRole("button", { name: "Zurückziehen" })
        .click();
    await expect(page.getByTestId("reisebild-status-problem")).toContainText(
        "Das geht bei diesem Reisebild nicht mehr. Die Seite lädt den aktuellen Stand neu.",
    );
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("In Prüfung");
    const erste = aktionen(attrappe).at(-1)!.body as { operationId: string };
    await page
        .getByTestId("reisebild-status-zurueckziehen-frage")
        .getByRole("button", { name: "Zurückziehen" })
        .click();
    await expect.poll(() => aktionen(attrappe).length).toBe(2);
    expect((aktionen(attrappe).at(-1)!.body as { operationId: string }).operationId).toBe(erste.operationId);
});

test("🔴 „Auf der Karte zeigen“: Die Kamera fliegt zur Stelle, auch aus weiter Ferne, und die Stelle liegt dann neben dem Fenster", async ({
    page,
}) => {
    // Eine Stelle weit von der Ansicht (Gareth liegt bei 551/533).
    await oeffneStatus(page, stand({ lage: { x: 200, y: 300 } }));
    await page.getByTestId("reisebild-status-zeigen").click();
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const map = globalThis.avesmapsMap!;
                    const projektion = globalThis.avesmapsRenderProjection!;
                    const punkt = map.project(projektion.toRenderLngLat({ x: 200, y: 300 }));
                    const rahmen = map.getCanvas().getBoundingClientRect();
                    const fenster = document
                        .querySelector('[data-testid="reisebild-status-fenster"]')!
                        .getBoundingClientRect();
                    const x = rahmen.left + punkt.x;
                    const y = rahmen.top + punkt.y;
                    const imBild = x > 0 && x < innerWidth && y > 0 && y < innerHeight;
                    const verdeckt = x > fenster.left && x < fenster.right && y > fenster.top && y < fenster.bottom;
                    return imBild && !verdeckt;
                }),
            { timeout: 20_000 },
        )
        .toBe(true);
});

test("🔴 „Neues Bild von dieser Stelle“ öffnet das Formular an der Stelle, mit Art und Name", async ({ page }) => {
    await oeffneStatus(page, stand({ zustand: "rejected", entstehung: "drawing" }));
    await page.getByTestId("reisebild-status-neues-bild").click();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    await expect(page.getByTestId("reisebild-entstehung-drawing").locator("input")).toBeChecked();
    await expect(page.getByTestId("reisebild-name")).toHaveValue("Alrik");
    await expect(page.getByTestId("reisebild-status-fenster")).toHaveCount(0);
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") !== undefined))
        .toBe(true);
});

// --- Die Höhe des Statusfensters (Stage-Fund) ---------------------------------------------------------------------------------

/** Die Höhe eines Fensters der Reisebilder und die, die es nach seinem Inhalt hätte (ohne jede feste Höhe): „nur so hoch wie nötig“ heißt, beide stimmen überein. */
const hoeheUndInhalt = (page: Page, testid: string) =>
    page.evaluate((id) => {
        const fenster = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const hoehe = fenster.getBoundingClientRect().height;
        const gesetzt = fenster.style.height;
        fenster.style.height = "auto";
        const inhalt = fenster.getBoundingClientRect().height;
        fenster.style.height = gesetzt;
        return { hoehe, inhalt };
    }, testid);

test("🔴 das Statusfenster ist nur so hoch wie sein Inhalt, auch nach dem Einreichen aus einem gezogenen Formular („Stand ansehen“, Stage-Fund)", async ({
    page,
}) => {
    await stubReisebilder(page, { status: stand() });
    await oeffneFormular(page, 1280, 800);

    // Das Formular am Kopf ein Stück ziehen: Die Steuerung merkt eine Box mit der Höhe des Formulars.
    const kopf = page.getByTestId("reisebild-fenster").locator(".avm-fenster__kopf");
    const kasten = (await kopf.boundingBox())!;
    const hoeheFormular = (await page.getByTestId("reisebild-fenster").boundingBox())!.height;
    await page.mouse.move(kasten.x + 80, kasten.y + kasten.height / 2);
    await page.mouse.down();
    await page.mouse.move(kasten.x + 120, kasten.y + kasten.height / 2 + 20, { steps: 6 });
    await page.mouse.up();
    expect((await page.getByTestId("reisebild-fenster").boundingBox())!.height).toBeCloseTo(hoeheFormular, 0);

    await fuelle(page);
    await einreichen(page).click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await page.getByTestId("reisebild-fertig-stand").click();
    // Der Link ist weder kopiert noch gemerkt: Auch „Stand ansehen“ hält einmal an (Review S3 I1), „Trotzdem weiter“ geht durch.
    await page.getByTestId("reisebild-fertig-trotzdem").click();
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);

    const status = await hoeheUndInhalt(page, "reisebild-status-fenster");
    expect(status.inhalt).toBeLessThan(hoeheFormular);
    expect(Math.abs(status.hoehe - status.inhalt)).toBeLessThanOrEqual(4);
});

test("das Statusfenster über den Link ist nur so hoch wie sein Inhalt; eine am Kopf gezogene Größe bleibt, solange es offen ist", async ({
    page,
}) => {
    await oeffneStatus(page, stand());
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    const vorher = await hoeheUndInhalt(page, "reisebild-status-fenster");
    expect(Math.abs(vorher.hoehe - vorher.inhalt)).toBeLessThanOrEqual(4);

    const fenster = page.getByTestId("reisebild-status-fenster");
    const kopf = fenster.locator(".avm-fenster__kopf");
    const kasten = (await kopf.boundingBox())!;
    await page.mouse.move(kasten.x + 80, kasten.y + kasten.height / 2);
    await page.mouse.down();
    await page.mouse.move(kasten.x + 40, kasten.y + kasten.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    const danach = await hoeheUndInhalt(page, "reisebild-status-fenster");
    expect(danach.hoehe).toBeCloseTo(vorher.hoehe, 0);
});

// --- „Auf der Karte zeigen“ zeigt Platzhalter und Linie (Stage-Fund) -----------------------------------------------------------

/** Wo die Stelle auf dem Bildschirm liegt, wo die Linie endet (SVG-Pfad `M… L…`) und was das Fenster misst; `undefined`, solange keine Linie steht. */
const linieZurStelle = (page: Page, stelle: { x: number; y: number }, fenster: string) =>
    page.evaluate(
        ({ lage, id }) => {
            const pfad = document
                .querySelector('[data-testid="reisebild-linie"] .reisebild-linie__strich path')
                ?.getAttribute("d");
            const zahlen = pfad?.match(/-?\d+(?:\.\d+)?/gu)?.map(Number);
            if (zahlen?.length !== 4) return undefined;
            const [vonX, vonY, bisX, bisY] = zahlen as [number, number, number, number];
            const map = globalThis.avesmapsMap!;
            const projektion = globalThis.avesmapsRenderProjection!;
            const punkt = map.project(projektion.toRenderLngLat(lage));
            const rahmen = map.getCanvas().getBoundingClientRect();
            const kasten = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
            return {
                abstandEnde: Math.hypot(bisX - (rahmen.left + punkt.x), bisY - (rahmen.top + punkt.y)),
                anKante:
                    (Math.abs(vonX - kasten.left) < 1.5 || Math.abs(vonX - kasten.right) < 1.5) &&
                    vonY >= kasten.top - 1 &&
                    vonY <= kasten.bottom + 1,
            };
        },
        { lage: stelle, id: fenster },
    );

test("🔴 „Auf der Karte zeigen“ zeigt den Platzhalter an der Stelle und zieht die Linie vom Fensterkopf dorthin; mit dem Schließen verschwinden beide", async ({
    page,
}) => {
    const stelle = { x: 200, y: 300 };
    await oeffneStatus(page, stand({ lage: stelle }));
    const platzhalter = () => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") !== undefined);
    // Bis zum Zeigen steht weder Symbol noch Linie auf der Karte.
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    expect(await platzhalter()).toBe(false);
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(0);

    await page.getByTestId("reisebild-status-zeigen").click();
    await expect.poll(platzhalter).toBe(true);
    // Die Kamera fliegt aus der Ferne her; dann liegt die Stelle neben dem Fenster, und die Linie endet am Rand des Symbols (17 px vor der Mitte) und beginnt an der Kante des Fensters.
    await expect
        .poll(
            async () => {
                const linie = await linieZurStelle(page, stelle, "reisebild-status-fenster");
                return linie !== undefined && linie.anKante && Math.abs(linie.abstandEnde - 17) < 3;
            },
            { timeout: 25_000 },
        )
        .toBe(true);
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(1);

    // Mit dem Schließen der Statusseite verschwinden Platzhalter und Linie.
    await page.getByTestId("reisebild-status-fenster").getByTestId("fenster-schliessen").click();
    await expect(page.getByTestId("reisebild-status-fenster")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(0);
    await expect.poll(platzhalter).toBe(false);
});
