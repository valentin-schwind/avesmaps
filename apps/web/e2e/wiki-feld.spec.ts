import { expect, test, type Page } from "@playwright/test";
import type { EditorPlaceDetail } from "@avesmaps3d/shared";
import { GRATENFELS, GRATENFELS_LAGE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Das Wiki-Feld am Ortseditor, seinem ersten Abnehmer (WI-0225; Design Guide §13.8, verbindlich; Betreiber 2026-10-18: „ja, A aber
 * der durchgestrichene wert kommt nicht vor das feld sondern hinter das label“). Gemessen werden die Zusicherungen des Rezepts: Der
 * Wiki-Wert steht hinter der Beschriftung, das Feld hat mindestens die Hälfte der Zeile, ↺ ist 26 × 26 px, ein langer Wiki-Wert kürzt,
 * ↺ ist EIN Schritt im Entwurf, und alle Felder des Kastens fluchten.
 *
 * 🔴 Kein Test schreibt: Ort und Stand kommen aus Stubs (wie `ortseditor-speichern.spec.ts`).
 */

const LANG = "Rund 2.200 Einwohner, davon 400 Zwerge in der Unterstadt und 120 Angroschim am Erzweg (Zählung 1040 BF)";

const ORT: EditorPlaceDetail = {
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
        description: { value: null, origin: null, wiki: "Hauptstadt der Grafschaft Gratenfels." },
        einwohner: { value: "2.500", origin: "manual", wiki: LANG },
        lage: { value: null, origin: null, wiki: "Kosch" },
        oberhaupt: { value: "Graf Growin", origin: "manual", wiki: null },
    },
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
    nameWiki: "Gratenfels",
    pathEnds: [],
};

async function oeffne(page: Page): Promise<void> {
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ORT) }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
}

const zeileVon = (page: Page, feld: string) => fenster(page).locator(`[data-testid$="-zeile-${feld}"]`);

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 weicht ab: Wiki-Wert hinter der Beschriftung, kürzt mit „…“; Feld mindestens die Hälfte; ↺ 26 × 26 px", async ({
    page,
}) => {
    await oeffne(page);
    const einwohner = zeileVon(page, "einwohner");
    await expect(einwohner).toHaveAttribute("data-zustand", "weicht");
    const masse = await einwohner.evaluate((zeile) => {
        const box = (el: Element | null) => el!.getBoundingClientRect();
        const beschriftung = box(zeile.querySelector(".fenster-feldzeile__beschriftung"));
        const wert = zeile.querySelector<HTMLElement>(".wiki-feld__text")!;
        const feld = box(zeile.querySelector(".fenster-feldzeile__feld"));
        const zurueck = box(zeile.querySelector(".fenster-feldzeile__spalte button"));
        return {
            zeile: box(zeile).width,
            wertImLabel: box(wert).left >= beschriftung.left && box(wert).right <= beschriftung.right + 0.5,
            wertVorFeld: box(wert).right <= feld.left,
            gekuerzt: wert.scrollWidth > wert.clientWidth,
            feld: feld.width,
            zurueck: { w: zurueck.width, h: zurueck.height },
            farbe: getComputedStyle(zeile.querySelector(".wiki-feld__name")!).color,
            textFarbe: getComputedStyle(wert).textDecorationLine,
        };
    });
    expect(masse.wertImLabel, "der Wiki-Wert steht hinter der Beschriftung, in ihrer Spalte").toBe(true);
    expect(masse.wertVorFeld).toBe(true);
    expect(masse.gekuerzt, "der lange Wiki-Wert kürzt").toBe(true);
    expect(masse.feld, "das Feld hat mindestens die Hälfte der Zeile").toBeGreaterThanOrEqual(masse.zeile / 2);
    expect(masse.zurueck).toEqual({ w: 26, h: 26 });
    expect(masse.textFarbe).toContain("line-through");
    await expect(einwohner.locator(".wiki-feld__wiki")).toHaveAttribute("title", `Wiki-Stand: ${LANG}`);
});

test("🔴 ↺ setzt das Feld im Entwurf auf den Wiki-Wert; danach steht ↺ still", async ({ page }) => {
    await oeffne(page);
    const einwohner = zeileVon(page, "einwohner");
    const zurueck = einwohner.locator('[data-testid$="-zeile-einwohner-zurueck"]');
    await expect(zurueck).toBeEnabled();
    await zurueck.click();
    await expect(einwohner).toHaveAttribute("data-zustand", "folgt");
    await expect(einwohner.locator("input")).toHaveValue(LANG);
    await expect(zurueck).toBeDisabled();
    await expect(zurueck).toHaveAttribute("title", "Steht auf dem Wiki-Wert");
});

test("Zustände am Ort: gleich, unbekannt (null) und ohne Gegenstück; alle Felder des Kastens fluchten", async ({
    page,
}) => {
    await oeffne(page);
    await expect(zeileVon(page, "lage")).toHaveAttribute("data-zustand", "folgt");
    // Der Name hat am Ort einen Wiki-Wert wie in Legacy (WI-0225): gleich, ↺ still.
    await expect(zeileVon(page, "name")).toHaveAttribute("data-zustand", "gleich");
    await expect(zeileVon(page, "name").locator("button")).toBeDisabled();
    // Am Ort heißt ein leerer Wiki-Wert vorerst „unbekannt“: kein Durchstreichen, kein ↺ (WI-0225 §4).
    await expect(zeileVon(page, "oberhaupt")).toHaveAttribute("data-zustand", "unbekannt");
    await expect(zeileVon(page, "oberhaupt").locator(".wiki-feld__wiki")).toHaveCount(0);
    await expect(zeileVon(page, "oberhaupt").locator("button")).toHaveCount(0);
    const kanten = await fenster(page)
        .locator(".fenster-feldzeile__feld")
        .evaluateAll((felder) =>
            felder.map((feld) => {
                const spalte = feld.getBoundingClientRect();
                const inhalt = feld.firstElementChild!.getBoundingClientRect();
                return {
                    links: Math.round(spalte.left),
                    rechts: Math.round(spalte.right),
                    inhalt: Math.round(inhalt.right),
                };
            }),
        );
    expect(kanten.length).toBe(7);
    expect(new Set(kanten.map((k) => k.links)).size, "Name, Größe, Art und die vier Wiki-Felder fluchten").toBe(1);
    // EINE Feldkante (Betreiber 2026-10-19): Die Zeilen ohne Eingabe (Lage: Position, Wegenden) beginnen an derselben Kante; vorher
    // stand ihr Wert nach „mindestens 7em“ der Beschriftung.
    const liste = await fenster(page)
        .locator(".fenster-feldzeilen > dd")
        .evaluateAll((werte) => werte.map((wert) => Math.round(wert.getBoundingClientRect().left)));
    expect(liste.length, "Position und Wegenden").toBe(2);
    expect(new Set([...liste, kanten[0]!.links]).size, "die Lage fluchtet mit den Feldern darüber").toBe(1);
    // Das Feld füllt seine Spalte bis vor ↺ (Blatt „Wiki-Feld“, §13.8); vorher endeten Eingabe und Auswahl nach rund 180 px.
    expect(
        kanten.map((k) => k.inhalt),
        "jedes Feld reicht bis an die ↺-Spalte",
    ).toEqual(kanten.map((k) => k.rechts));
});
