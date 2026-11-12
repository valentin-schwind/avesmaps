import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, expect, test, type Page } from "@playwright/test";
import { bedieneMedienrouten, MIT_MEDIEN, medienQuelle, schliesseMedienQuelle, stubSitzung } from "./medien-quelle.ts";

/**
 * Nahaufnahmen der Leiste jeder Liste am Telefon (Koordination 2026-10-12): die Treffer der Medienverwaltung auf einem Pixel 7, wo
 * neben Trichter, Sortierung und zwei Segmentgruppen nicht einmal „Suchen …“ Platz hat. Drei Bilder: zu (Lupen-Knopf), offen (Feld über
 * der ganzen Zeile), zu mit Suchtext (Lupe markiert). Gegen die echten Medien der Entwicklungsdatenbank (`medien-quelle.ts`).
 *
 * Ablage: `review/listenleiste-telefon/` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/listenleiste-telefon");

/** Ein Ausschnitt vom Fensterkopf bis unter die Leiste, über die volle Breite. */
async function nah(page: Page): Promise<Buffer> {
    const fenster = await page.getByTestId("medien-fenster").boundingBox();
    const leiste = await page.getByTestId("medien").boundingBox();
    if (!fenster || !leiste) throw new Error("Fenster oder Leiste ohne Lage");
    const breite = page.viewportSize()?.width ?? 412;
    return page.screenshot({
        clip: { x: 0, y: fenster.y, width: breite, height: leiste.y + leiste.height + 16 - fenster.y },
    });
}

test("Nahaufnahmen: die Leiste der Medien am Telefon", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const quelle = await medienQuelle();
    test.skip(quelle === undefined, "ohne DATABASE_URL keine echten Medien");
    mkdirSync(OUTPUT, { recursive: true });
    for (const schema of ["light", "dark"] as const) {
        const context = await browser.newContext({
            ...devices["Pixel 7"],
            ...(baseURL === undefined ? {} : { baseURL }),
            colorScheme: schema,
        });
        const page = await context.newPage();
        await stubSitzung(page, MIT_MEDIEN);
        await bedieneMedienrouten(page, quelle!);
        await page.goto("/edit");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 60_000,
        });
        await page.evaluate(() => document.fonts.ready);
        await page.getByTestId("kopfleiste-menue").tap();
        await page.getByTestId("menue-medien").tap();
        await page.getByTestId("medien-arten-eintrag-korb-rights_open").tap();
        const lupe = page.getByTestId("medien-lupe");
        await expect(lupe).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(600);
        writeFileSync(resolve(OUTPUT, `1-zu-${schema}.png`), await nah(page));

        // Ein Wort aus dem ersten Treffer, damit die Suche etwas findet.
        const wort =
            /[A-Za-zÄÖÜäöüß]{4,}/u.exec((await page.getByTestId("medien-eintrag").first().textContent()) ?? "")?.[0] ??
            "Wappen";
        await lupe.tap();
        await expect(page.getByTestId("medien-suche").locator("input")).toBeFocused();
        await page.waitForTimeout(300);
        writeFileSync(resolve(OUTPUT, `2-offen-${schema}.png`), await nah(page));

        await page.getByTestId("medien-suche").locator("input").fill(wort);
        await page.waitForTimeout(300);
        writeFileSync(resolve(OUTPUT, `3-offen-mit-text-${schema}.png`), await nah(page));
        // Ein Tipp daneben (auf die Trefferzeile) schließt und behält den Text; die Lupe ruht markiert, ohne Fokusring.
        await page
            .getByText(/Treffer/u)
            .first()
            .tap();
        await expect(lupe).toHaveClass(/is-aktiv/u);
        await page.waitForTimeout(800);
        writeFileSync(resolve(OUTPUT, `4-zu-mit-text-${schema}.png`), await nah(page));
        await context.close();
    }
    await schliesseMedienQuelle();
});
