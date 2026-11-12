import { expect, test } from "@playwright/test";
import { fenster, langeListe, oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * MESSUNG, kein Test (Qualitätsreview 2026-10-12, Plan C5, Szene M1): Was kostet ein Tastendruck in der Suche der Ortsliste?
 *
 * 🔴 Die Datei heißt `-review.spec.ts` und läuft darum NUR, wenn man sie nennt (`playwright.config.ts`, `SHEET_SPECS`). Sie
 * behauptet keine Zeitschwelle: Eine Zusicherung über Millisekunden wäre auf einem anderen Rechner Zufall. Sie schreibt Zahlen in
 * den Bericht, damit „vorher" und „nachher" dieselbe Szene vergleichen.
 *
 *     E2E_PORT=4191 npx playwright test e2e/perf-ortsliste-review.spec.ts --workers=1
 *
 * Gemessen: die Long Tasks (über 50 ms blockierter Hauptthread, `PerformanceObserver`) während des Tippens und die Zeit vom letzten
 * Zeichen bis zum nächsten Bild. Die Liste ist mit 9.074 Zeilen so lang wie die echte (`WI-0128-ortseditor-bau.md`: „Gemessen lokal
 * 2026-10-10: 9.074 Zeilen"). Zwei Szenen, weil jeder Klick auf eine Zeile ein EIGENES Fenster öffnet (D19) und das vorige
 * eingehängt bleibt, nur nicht gezeichnet (`avm-fenster.vue`: „versenkt"): Rechnet die Liste eines unsichtbaren Fensters mit?
 */

const ZEILEN = 9_074;
const WORT = "gratenfels";

test.describe("Messung: Suche in der Ortsliste", () => {
    for (const fensterZahl of [1, 3]) {
        test(`Tastendruck in der Suche, ${String(fensterZahl)} Fenster`, async ({ page }) => {
            await page.addInitScript(() => {
                const w = window as unknown as { __lange: { start: number; dauer: number }[] };
                w.__lange = [];
                new PerformanceObserver((liste) => {
                    for (const eintrag of liste.getEntries()) {
                        w.__lange.push({ start: eintrag.startTime, dauer: eintrag.duration });
                    }
                }).observe({ entryTypes: ["longtask"] });
            });

            await oeffneOrtseditor(page, { liste: langeListe(ZEILEN - 4) });
            for (let geoeffnet = 1; geoeffnet < fensterZahl; geoeffnet += 1) {
                await fenster(page)
                    .locator('[data-testid$="-orte-zeile"]')
                    .nth(geoeffnet - 1)
                    .click();
                await page.waitForTimeout(300);
            }
            const dialoge = await page.locator('dialog[data-testid^="ortseditor-"]').count();

            const feld = fenster(page).locator('input[type="search"], input[placeholder]').first();
            await expect(feld).toBeVisible();
            // Alles, was das Öffnen kostete, zählt nicht mit.
            await page.waitForTimeout(500);
            const vorher = await page.evaluate(() => (window as unknown as { __lange: unknown[] }).__lange.length);

            await feld.click();
            const beginn = await page.evaluate(() => performance.now());
            await feld.pressSequentially(WORT, { delay: 80 });
            const nachLetztem = await page.evaluate(() => performance.now());
            await page.evaluate(
                () => new Promise<void>((fertig) => requestAnimationFrame(() => requestAnimationFrame(() => fertig()))),
            );
            const gezeichnet = await page.evaluate(() => performance.now());

            const lange = await page.evaluate(
                (ab: number) =>
                    (window as unknown as { __lange: { start: number; dauer: number }[] }).__lange
                        .slice(ab)
                        .map((eintrag) => Math.round(eintrag.dauer)),
                vorher,
            );
            const summe = lange.reduce((gesamt, dauer) => gesamt + dauer, 0);
            const sortiert = [...lange].sort((a, b) => a - b);

            // `process.stdout.write` statt `console.log`: Der Hausstandard lässt auf der Konsole nur `warn` und `error` zu
            // (wie `vorkommen-register-review.spec.ts`), und eine Messung ist keine Warnung.
            process.stdout.write(
                `${[
                    `--- ${String(fensterZahl)} Fenster gewollt, ${String(dialoge)} eingehängt ---`,
                    `Zeilen: ${String(ZEILEN)}, Zeichen: ${String(WORT.length)}`,
                    `Tippdauer: ${String(Math.round(nachLetztem - beginn))} ms (davon ${String(WORT.length * 80)} ms Pausen)`,
                    `Long Tasks: ${String(lange.length)}, Summe ${String(summe)} ms, laengster ${String(sortiert.at(-1) ?? 0)} ms`,
                    `letztes Zeichen bis Bild: ${String(Math.round(gezeichnet - nachLetztem))} ms`,
                ].join("\n")}\n`,
            );
        });
    }
});
