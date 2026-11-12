import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Hausregel „deutsche Silbentrennung, auch in Links“ (WI-0088 P3, Betreiber 2026-10-06: „und kannst du auf deutsche silbentrennung
 * achten - auch bei links“). Die Regel steht an EINER Stelle, in der erzeugten `apps/web/src/styles/canon.css` (`html { hyphens: auto }`),
 * und erbt von dort in jede Fläche.
 *
 * 🔴 Gemessen wird nicht die Deklaration, sondern die Wirkung: Ein Probestück bekommt `overflow-wrap: normal` und `word-break: normal`,
 * damit NUR noch die Trennung ein zu langes Wort unterbringen kann. Bricht es dann trotzdem in die Spalte, hat der Browser getrennt.
 * Der Gegenversuch mit `hyphens: manual` am selben Stück muss überlaufen - sonst messe der Test etwas anderes.
 *
 * 🪤 `hyphens: auto` wirkt nur mit dem passenden `lang`. Darum steht der erste Fall auf der Sprachauszeichnung: Sie ist die Ursache,
 * wenn gar nicht oder nach falschen Regeln getrennt wird.
 */

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
/** Ein zusammengesetztes Wort, wie es auf dieser Karte der Normalfall ist. */
const LANG = "Raschtulswallvorgebirge";

interface Probe {
    /** Läuft der Inhalt aus seiner Spalte heraus? */
    overflow: boolean;
    /** Wie viele Zeilenkästen der Text füllt. */
    lines: number;
}

/**
 * Klont eine echte Fläche des Panels, setzt ein langes Wort hinein und misst, ob es in eine schmale Spalte passt.
 * `hyphens` wird am Probestück gesetzt, alles andere erbt es wie das Original.
 */
async function probe(page: Page, selector: string, hyphens: "inherit" | "manual", width = 110): Promise<Probe> {
    return page.evaluate(
        ({ selector: target, hyphens: mode, width: span, word }) => {
            const original = document.querySelector(target);
            if (original === null) throw new Error(`Fläche nicht gefunden: ${target}`);
            const host = document.createElement("div");
            host.style.cssText = `width:${String(span)}px;`;
            const copy = original.cloneNode(false) as HTMLElement;
            copy.textContent = word;
            // 🔴 Nur die Trennung darf das Wort noch unterbringen: der Notbruch wird abgeschaltet.
            copy.style.overflowWrap = "normal";
            copy.style.wordBreak = "normal";
            copy.style.hyphens = mode;
            host.append(copy);
            (original.parentElement ?? document.body).append(host);
            const range = document.createRange();
            range.selectNodeContents(copy);
            const lines = range.getClientRects().length;
            const overflow = host.scrollWidth > host.clientWidth + 1;
            host.remove();
            return { overflow, lines };
        },
        { selector, hyphens, width, word: LANG },
    );
}

/** Öffnet Gareth am Telefon: die schmale Spalte, in der es heute reißt. */
async function openNarrow(page: Page): Promise<void> {
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 30_000 });
    await expect(page.getByTestId("info-fact-value").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Die Sprachauszeichnung: die Voraussetzung der Trennung", () => {
    test("🔴 das Dokument trägt die Sprache von der ersten Zeichnung an, und der Schalter führt sie mit", async ({
        page,
    }) => {
        await page.goto("/");
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("de");
        await page.goto("/?lang=en");
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");
        // Der Schalter selbst: zurück auf Deutsch, ohne Neuladen (seit WI-0156 eine Pille, die aufklappt).
        await page.getByTestId("lang").click();
        await page.getByTestId("lang-de").click();
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("de");
    });
});

test.describe("Die Trennung wirkt, wo lange Wörter stehen", () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test("🔴 ein langes Wort in einer schmalen Spalte bricht in die Spalte statt über den Rand", async ({ page }) => {
        await openNarrow(page);
        const getrennt = await probe(page, '[data-testid="info-fact-value"]', "inherit");
        const ungetrennt = await probe(page, '[data-testid="info-fact-value"]', "manual");
        // Ohne Trennung bleibt das Wort eine Zeile und läuft hinaus; mit Trennung passt es in mehrere Zeilen.
        expect(ungetrennt).toEqual({ overflow: true, lines: 1 });
        expect(getrennt.overflow).toBe(false);
        expect(getrennt.lines).toBeGreaterThan(1);
    });

    test("🔴 auch bei Links (der Wunsch nennt sie ausdrücklich)", async ({ page }) => {
        await openNarrow(page);
        const link = page.getByTestId("info-link").first();
        await expect(link).toBeVisible({ timeout: 30_000 });
        expect(await link.evaluate((element) => getComputedStyle(element).hyphens)).toBe("auto");
        const getrennt = await probe(page, '[data-testid="info-link"]', "inherit");
        const ungetrennt = await probe(page, '[data-testid="info-link"]', "manual");
        expect(ungetrennt).toEqual({ overflow: true, lines: 1 });
        expect(getrennt.overflow).toBe(false);
        expect(getrennt.lines).toBeGreaterThan(1);
    });

    test("die Regel erbt in jede Textfläche des Panels - sie steht nirgends ein zweites Mal", async ({ page }) => {
        await openNarrow(page);
        for (const selector of [
            '[data-testid="info-title"]',
            '[data-testid="info-subtitle"]',
            '[data-testid="info-fact-label"]',
            '[data-testid="info-fact-value"]',
            '[data-testid="info-section-title"]',
            '[data-testid="info-source-row"]',
            ".info-stairs",
        ]) {
            expect(
                await page
                    .locator(selector)
                    .first()
                    .evaluate((element) => getComputedStyle(element).hyphens),
                selector,
            ).toBe("auto");
        }
    });

    test("🪤 ein Etikett und ein Wert werden NICHT getrennt: sie brechen gar nicht um", async ({ page }) => {
        await openNarrow(page);
        // Das Kanon-Etikett ist die sichtbare Marke im Panel („Offiziell“): eine Pille, die nie umbricht.
        const pille = page.getByTestId("info-canon").first();
        await expect(pille).toBeVisible({ timeout: 30_000 });
        const label = pille.locator("span", { hasText: /\S/ }).last();
        expect(await label.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
        expect(
            await label.evaluate((element) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return range.getClientRects().length;
            }),
        ).toBe(1);
        // 🪤 Ein Wert samt Einheit (`AvmWert`) wird nicht an seiner Sichtbarkeit gemessen - er steht an diesem Gegenstand nur in
        // noch verborgenen Teilen. Die Zusicherung ist dieselbe und hängt allein an `nowrap`, also wird sie an jedem gemessen.
        await expect.poll(() => page.locator(".wert").count(), { timeout: 30_000 }).toBeGreaterThan(0);
        const werte = await page
            .locator(".wert")
            .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).whiteSpace));
        expect(new Set(werte)).toEqual(new Set(["nowrap"]));
    });

    test("🪤 eine Fläche, die ausdrücklich ungetrennt sein will, gewinnt über die Hausregel", async ({ page }) => {
        await openNarrow(page);
        // Derselbe Weg, den der Vermerk unter den Kosten im Planer nimmt (`.costs__note { hyphens: manual }`).
        const ungetrennt = await probe(page, '[data-testid="info-fact-value"]', "manual");
        expect(ungetrennt.overflow).toBe(true);
    });

    test("Englisch trennt nach seinen eigenen Stellen, Deutsch nach seinen", async ({ page }) => {
        await openNarrow(page);
        const english = await page.evaluate(() => {
            const measure = (word: string, language: string, hyphens: string): number => {
                const host = document.createElement("div");
                host.lang = language;
                host.style.cssText = `width:70px;hyphens:${hyphens};overflow-wrap:normal;word-break:normal;`;
                host.textContent = word;
                document.body.append(host);
                const overflow = host.scrollWidth - host.clientWidth;
                host.remove();
                return overflow;
            };
            return {
                autoEn: measure("extraordinarily", "en", "auto"),
                manualEn: measure("extraordinarily", "en", "manual"),
                autoDe: measure("Herrschaftsgebiet", "de", "auto"),
                manualDe: measure("Herrschaftsgebiet", "de", "manual"),
            };
        });
        // Beide Wörterbücher liegen im Browser: mit `auto` passt das Wort, mit `manual` nicht.
        expect(english.autoEn).toBeLessThanOrEqual(1);
        expect(english.manualEn).toBeGreaterThan(1);
        expect(english.autoDe).toBeLessThanOrEqual(1);
        expect(english.manualDe).toBeGreaterThan(1);
    });
});
