import { expect, test, type Page } from "@playwright/test";
import type { EditorPlaceDetail, PlaceRemoval } from "@avesmaps3d/shared";
import { GRATENFELS, GRATENFELS_LAGE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";
import { tintenVersatz } from "./versalmitte.ts";

/**
 * Der Ortseditor ohne Menüband (WI-0183; EDIT-0003 §2a, Blatt `review/ortseditor-menueband/blatt-ortseditor-ohne-band.png`).
 * Betreiber 2026-10-16, wörtlich: „ortseditor - das klappen passt“.
 *
 * - Es gibt kein Band mehr; beim Einklappen der Liste ändert sich nur die Breite.
 * - ✚ (Neuer Ort) und der Papierkorb (Ort entfernen) stehen als Zeichen in der Leiste der Liste, nach Trichter und Sortierung.
 * - „↺ Alles auf Wiki-Werte (n)“ steht im Kopf der Eigenschaften, nicht mehr im Kasten „Identität“.
 * - „«“ sitzt auf der Versalmitte des Titels (Betreiber 2026-10-15: „„Ortseigenschaften“ und der button zum ein- und ausklappen
 *   [sind] nicht vertikal aligned“).
 * - Im Fuß bleiben die Knöpfe in ihrer Zeile; der Hinweis links kürzt (Betreiber 2026-10-15: „die statusleiste lässt beim
 *   zusammenklappen die buttons rechts nach unten rutschen“).
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Lesen des Orts, Stand des Bearbeitens und die Vorschau des Entfernens
 * kommen aus Stubs (wie `ortseditor-speichern.spec.ts`).
 */

function ort(ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId: GRATENFELS,
        revision: 7,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: GRATENFELS_LAGE,
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
            description: { value: null, origin: null, wiki: "Die Stadt der Türme und Mauern." },
            einwohner: { value: null, origin: null, wiki: "2250" },
            lage: { value: null, origin: null, wiki: "Gratenfelser Becken" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        pathEnds: [],
        ...ueber,
    };
}

const VORSCHAU: PlaceRemoval = {
    publicId: GRATENFELS,
    name: "Gratenfels",
    revision: 7,
    onMap: true,
    subtype: "stadt",
    staetten: [{ name: "Burg Greifenklau", art: "Festung" }],
    wegenden: ["Reichsstraße 3"],
    gebiete: [{ name: "Landgrafschaft Gratenfels", rolle: "hauptstadt" }],
    kraftlinien: [],
    bleibt: { wiki: true, bilder: 0, quellen: 56, stadtplaene: 2, abenteuer: 4, bewertungen: 0 },
};

/** Bearbeiten an (Testwelt) und der Ort aus dem Stub; ohne diesen Aufruf ist der Ortseditor nur lesend. */
async function bearbeitbar(page: Page, detail: EditorPlaceDetail = ort()): Promise<void> {
    await page.route("**/api/editor/status", (route) => route.fulfill({ json: { mapEditing: "testwelt" } }));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) => route.fulfill({ json: detail }));
    await page.route(`**/api/editor/places/${GRATENFELS}/removal`, (route) => route.fulfill({ json: VORSCHAU }));
}

const neu = (page: Page) => fenster(page).locator('[data-testid$="-leiste-neu"]');
const weg = (page: Page) => fenster(page).locator('[data-testid$="-leiste-entfernen"]');
const KOPF = '[data-testid$="-eigenschaften-spalte"] .fenster-spalte__kopf';
const SCHALTER = '[data-testid$="-listenschalter"]';
const GESPERRT = "Geht mit Schreibrecht und eingeschaltetem Bearbeiten.";

test("🔴 kein Menüband: ✚ und Papierkorb stehen als Zeichen in der Leiste, nach Trichter und Sortierung; ohne Bearbeiten gesperrt mit Grund", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await expect(fenster(page).locator(".avm-fenster__leiste")).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid*="-band-"]')).toHaveCount(0);

    const sortierung = fenster(page).locator('[data-testid$="-orte-sortierung"]');
    const [o, n, w, l] = await Promise.all([
        sortierung.boundingBox(),
        neu(page).boundingBox(),
        weg(page).boundingBox(),
        fenster(page).locator('[data-testid$="-orte-leiste"]').boundingBox(),
    ]);
    expect(o!.x + o!.width).toBeLessThan(n!.x);
    expect(n!.x + n!.width).toBeLessThan(w!.x);
    expect(Math.abs(n!.y - o!.y)).toBeLessThan(2);
    // Rechtsbündig: Der Papierkorb schließt mit der Leiste ab.
    expect(Math.abs(l!.x + l!.width - (w!.x + w!.width))).toBeLessThan(2);

    await expect(neu(page)).toHaveAttribute("aria-label", "Neuer Ort");
    await expect(weg(page)).toHaveAttribute("aria-label", "Ort entfernen");
    await expect(neu(page)).toBeDisabled();
    await expect(neu(page)).toHaveAttribute("title", GESPERRT);
    await expect(weg(page)).toBeDisabled();
    await expect(weg(page)).toHaveAttribute("title", GESPERRT);
});

test("🔴 ✚ öffnet „Neuer Ort“; der Papierkorb öffnet für den offenen Ort dasselbe Blatt wie „Ort entfernen“ auf der Karte", async ({
    page,
}) => {
    await bearbeitbar(page);
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await expect(weg(page)).toBeEnabled();
    await expect(weg(page)).toHaveAttribute("title", "Ort entfernen");

    // Zwei Stufen wie auf der Karte: von der Karte nehmen (bleibt im Register) oder ganz löschen.
    await weg(page).click();
    const blatt = page.getByTestId("ort-entfernen");
    await expect(blatt).toBeVisible();
    await expect(blatt).toContainText("Gratenfels");
    await expect(page.getByTestId("ort-entfernen-abnehmen")).toBeVisible();
    await expect(page.getByTestId("ort-entfernen-loeschen")).toBeVisible();
    await page.getByTestId("ort-entfernen-abbrechen").click();
    await expect(blatt).toBeHidden();

    await expect(neu(page)).toBeEnabled();
    await expect(neu(page)).toHaveAttribute(
        "title",
        "Neuer Ort ohne Lage; er steht danach unter „Nicht auf der Karte“.",
    );
    await neu(page).click();
    await expect(fenster(page).locator('form[data-testid$="-neu"]')).toBeVisible();
});

test("🔴 ohne angelegten Ort nennt der Papierkorb, warum er nicht geht", async ({ page }) => {
    await bearbeitbar(page);
    await oeffneOrtseditor(page);
    await zeile(page, "Wachturm am Großen Fluss").click();
    await expect(weg(page)).toBeDisabled();
    await expect(weg(page)).toHaveAttribute(
        "title",
        "Entfernen lässt sich nur ein angelegter Ort; eine Zeile nur aus dem Wiki nicht.",
    );
});

test("🔴 „↺ Alles auf Wiki-Werte (n)“ steht im Kopf der Eigenschaften und setzt eigene Werte im Entwurf zurück", async ({
    page,
}) => {
    await bearbeitbar(
        page,
        ort({
            fields: {
                ...ort().fields,
                einwohner: { value: "2300", origin: "manual", wiki: "2250" },
            },
        }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    const knopf = fenster(page).locator(`${KOPF} [data-testid$="-alle-wiki"]`);
    await expect(knopf).toHaveText("↺ Alles auf Wiki-Werte (1)");
    await expect(knopf).toBeEnabled();
    // Nur noch EINER: Der Kasten „Identität“ trägt den Knopf nicht mehr.
    await expect(fenster(page).locator('[data-testid$="-alle-wiki"]')).toHaveCount(1);

    await knopf.click();
    await expect(knopf).toHaveText("↺ Alles auf Wiki-Werte (0)");
    await expect(knopf).toBeDisabled();
    await expect(knopf).toHaveAttribute("title", "Kein Feld weicht vom Wiki ab.");
    // Warum er gesperrt ist, steht sichtbar am Kasten „Identität“.
    await expect(fenster(page).locator('[data-testid$="-wiki-gleich"]')).toHaveText("Kein Feld weicht vom Wiki ab.");
});

test.describe("Versalmitte", () => {
    test.use({ deviceScaleFactor: 4 });

    test("🔴 «/» sitzt auf der Versalmitte des Titels „Ortseigenschaften“, offen wie eingeklappt", async ({ page }) => {
        await bearbeitbar(page);
        await oeffneOrtseditor(page);
        await zeile(page, "Gratenfels").click();
        const titel = `${KOPF} .fenster-spalte__titel`;
        const zeichen = `${KOPF} .ortseditor__schalterzeichen`;
        // Gemessen wird die Tinte, und zwar beide gegen dieselbe Leiste: Ihr Polster ist oben und unten verschieden.
        const offen = (await tintenVersatz(page, KOPF, zeichen)) - (await tintenVersatz(page, KOPF, titel));
        expect(Math.abs(offen)).toBeLessThanOrEqual(0.75);

        await fenster(page).locator(SCHALTER).click();
        await page.waitForTimeout(400);
        const zu = (await tintenVersatz(page, KOPF, zeichen)) - (await tintenVersatz(page, KOPF, titel));
        expect(Math.abs(zu)).toBeLessThanOrEqual(0.75);
    });
});

test("🔴 Fuß: eingeklappt bleiben die Knöpfe in ihrer Zeile, der Hinweis links kürzt und zeigt den ganzen Text beim Überfahren", async ({
    page,
}) => {
    await bearbeitbar(page);
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    const fuss = fenster(page).locator(".avm-fenster__fuss");
    const haupt = fenster(page).locator(".avm-fenster__fuss-haupt");
    const hinweis = fenster(page).getByTestId("fenster-fuss-hinweis");
    await expect(fenster(page).locator('[data-testid$="-modus"]')).toBeVisible();
    const vorher = { fuss: (await fuss.boundingBox())!, haupt: (await haupt.boundingBox())! };

    await fenster(page).locator(SCHALTER).click();
    await page.waitForTimeout(400);
    const nachher = { fuss: (await fuss.boundingBox())!, haupt: (await haupt.boundingBox())! };
    expect(Math.abs(nachher.fuss.height - vorher.fuss.height)).toBeLessThan(0.5);
    // Eine Zeile: Die Knöpfe stehen auf der Höhe des Hinweises, nicht darunter.
    const zeileHinweis = (await hinweis.boundingBox())!;
    expect(
        Math.abs(nachher.haupt.y + nachher.haupt.height / 2 - (zeileHinweis.y + zeileHinweis.height / 2)),
    ).toBeLessThan(2);

    // Gekürzt ist nur das Bild: Der Text steht ganz im DOM, und beim Überfahren im title.
    const gekuerzt = await hinweis.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(gekuerzt).toBe(true);
    await hinweis.hover();
    await expect(hinweis).toHaveAttribute("title", /Testwelt: Der nächste Zug setzt Änderungen zurück\./);
});
