import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";

/**
 * Abnahmeblatt „Bedienung zweispaltig, Projekt ausführlich, Claudia und Claudio“ (Betreiber 2026-10-14: „kannst du unter
 * hinweise -> bedienung die shortcuts in 2 spalten erklären. (nur bedienung!)“, „kannst du mehr zum projekt sagen in
 * Projekt“, „außerdem wollen wir dieses bild von dir und claudio in der sektion Technik & Lizenzen haben“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Zusicherungen stehen in
 * `test/legal-texts.test.ts`.
 *
 * Gezeigt werden die Bedienung in zwei Spalten (hell), dieselbe am Telefon untereinander, der ausgebaute Abschnitt
 * „Projekt“ und die Agentenzeile in „Technik und Lizenzen“ (dunkel, damit das Bild in beiden Themen zu sehen ist).
 *
 *   npm run review:hinweise-bedienung
 *
 * Ablage: `review/hinweise-bedienung/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/hinweise-bedienung");

test.use({ actionTimeout: 30_000 });

const aufnahmen = new Map<string, Buffer>();

async function ruhe(page: Page): Promise<void> {
    await page.waitForTimeout(250);
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
}

async function oeffne(
    browser: Browser,
    baseURL: string,
    thema: "light" | "dark",
    viewport = { width: 1280, height: 1600 },
) {
    const context = await browser.newContext({
        baseURL,
        viewport,
        colorScheme: thema,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.7.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    const hinweis = page.getByTestId("camera-hint-close");
    if (await hinweis.isVisible().catch(() => false)) await hinweis.evaluate((knopf) => (knopf as HTMLElement).click());
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId("notes-open").click();
    await page.getByTestId("notes").waitFor();
    return { page, close: () => context.close() };
}

/** Der Rahmen um ein Element, mit etwas Luft, aber nie über den Schirm hinaus. */
async function rahmen(page: Page, selektor: string, rand = 8) {
    const kasten = await page.locator(selektor).boundingBox();
    if (!kasten) throw new Error(`kein Rahmen für ${selektor}`);
    const groesse = page.viewportSize() ?? { width: 1280, height: 1600 };
    const x = Math.max(0, kasten.x - rand);
    const y = Math.max(0, kasten.y - rand);
    return {
        x,
        y,
        width: Math.min(kasten.width + 2 * rand, groesse.width - x),
        height: Math.min(kasten.height + 2 * rand, groesse.height - y),
    };
}

async function abschnitt(page: Page, testid: string, schluessel: string): Promise<void> {
    await page.getByTestId(testid).locator("summary").click();
    await ruhe(page);
    aufnahmen.set(schluessel, await page.screenshot({ clip: await rahmen(page, `[data-testid="${testid}"]`) }));
    await page.getByTestId(testid).locator("summary").click();
}

test("Blatt: Bedienung in zwei Spalten, Projekt ausführlich, Claudia und Claudio", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);

    {
        const { page, close } = await oeffne(browser, baseURL!, "light");
        await abschnitt(page, "notes-controls", "bedienung-hell");
        await abschnitt(page, "notes-project", "projekt");
        await close();
    }
    {
        const { page, close } = await oeffne(browser, baseURL!, "dark");
        await abschnitt(page, "notes-tech", "technik-dunkel");
        await close();
    }
    {
        // Am Telefon fällt das Nebeneinander zurück auf untereinander - genau das soll das Blatt zeigen.
        const { page, close } = await oeffne(browser, baseURL!, "light", { width: 390, height: 1600 });
        await abschnitt(page, "notes-controls", "bedienung-telefon");
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 1480, height: 900 } });
    const seite = await context.newPage();
    await seite.route("**/__blatt.html", (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html() }),
    );
    await seite.goto(`${baseURL!}/__blatt.html`);
    await seite.waitForLoadState("networkidle");
    await seite.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await context.close();
});

function bild(schluessel: string): string {
    return `data:image/png;base64,${aufnahmen.get(schluessel)!.toString("base64")}`;
}

function html(): string {
    const figur = (titel: string, hinweis: string, schluessel: string, breite = 640): string => `
        <figure style="max-width:${String(breite)}px">
            <figcaption><b>${titel}</b> <span>${hinweis}</span></figcaption>
            <img src="${bild(schluessel)}" alt="${titel}" />
        </figure>`;
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><style>
    body { margin: 0; padding: 24px 32px 32px; background: #f4f1ea; font: 14px/1.5 system-ui, sans-serif; color: #2b2a26; }
    h1 { margin: 0 0 4px; font-size: 19px; }
    p.unter { margin: 0 0 18px; color: #6b655a; max-width: 980px; }
    .reihe { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
    figure { margin: 0 0 16px; }
    figcaption { margin: 0 0 6px; font-size: 13px; }
    figcaption span { color: #6b655a; }
    img { display: block; max-width: 100%; border: 1px solid #d8d2c4; }
</style></head><body>
    <h1>Hinweise: Bedienung zweispaltig, Projekt ausführlich, Claudia und Claudio</h1>
    <p class="unter">Die Bedienung steht jetzt in zwei Spalten: links die Tastatur, rechts Maus, Trackpad und Finger. Reicht die Breite nicht, stehen sie wieder untereinander. Nur dieser Abschnitt ist zweispaltig. „Projekt“ trug einen Satz und trägt jetzt fünf Absätze. In „Technik und Lizenzen“ steht über der Agentenzeile das Bild von Avesmaps.</p>
    ${figur("Bedienung", "zwei Spalten, hell", "bedienung-hell", 900)}
    <div class="reihe">
        ${figur("Projekt", "fünf Absätze statt eines Satzes", "projekt", 620)}
        ${figur("Bedienung am Telefon", "390 px - wieder untereinander", "bedienung-telefon", 380)}
    </div>
    ${figur("Technik und Lizenzen", "dunkel, mit dem Bild und der Agentenzeile", "technik-dunkel", 900)}
</body></html>`;
}
