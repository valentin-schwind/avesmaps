import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Karten auf Avesmaps“ und „Zur Stage / Zu Production“ (Betreiber 2026-10-12: „leg Kartenmaterial und
 * Kartenserien zusammen und mach den text schön lesbar wie die anderen … keine roten texte mehr“ und „füge im hauptmenü in
 * production einen link zu ‚Zur Stage‘ und in der stage einen link zu ‚Zu Production‘“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Zusicherungen stehen in
 * `test/hinweise-karten.test.ts` und `e2e/anmeldung.spec.ts`.
 *
 * Gezeigt werden der zusammengelegte Abschnitt aufgeklappt (hell und dunkel), die Abschnittsliste zugeklappt — dort sieht man,
 * dass aus zwei Einträgen einer wurde und „Schriften“ verschwunden ist. Das Hauptmenü mit dem Weg in die andere Umgebung ist
 * entfallen: Seit WI-0180 wechselt die Pille der Kopfleiste die Umgebung.
 *
 *   npm run review:hinweise-karten
 *
 * Ablage: `review/hinweise-karten/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/hinweise-karten");

test.use({ actionTimeout: 30_000 });

const aufnahmen = new Map<string, Buffer>();

async function ruhe(page: Page): Promise<void> {
    await page.waitForTimeout(250);
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
}

async function oeffne(browser: Browser, baseURL: string, thema: "light" | "dark", umgebung = "production") {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 1400 },
        colorScheme: thema,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.6.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { environment: umgebung, role: "operator" });
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    const hinweis = page.getByTestId("camera-hint-close");
    if (await hinweis.isVisible().catch(() => false)) await hinweis.evaluate((knopf) => (knopf as HTMLElement).click());
    await page.evaluate(() => document.fonts.ready);
    return { page, close: () => context.close() };
}

/** Der Rahmen um ein Element, mit etwas Luft, aber nie über den Schirm hinaus. */
async function rahmen(page: Page, selektor: string, rand = 10) {
    const kasten = await page.locator(selektor).boundingBox();
    if (!kasten) throw new Error(`kein Rahmen für ${selektor}`);
    const groesse = page.viewportSize() ?? { width: 1280, height: 1400 };
    const x = Math.max(0, kasten.x - rand);
    const y = Math.max(0, kasten.y - rand);
    return {
        x,
        y,
        width: Math.min(kasten.width + 2 * rand, groesse.width - x),
        height: Math.min(kasten.height + 2 * rand, groesse.height - y),
    };
}

async function hinweiseOeffnen(page: Page): Promise<void> {
    await page.getByTestId("notes-open").click();
    await page.getByTestId("notes").waitFor();
}

test("Blatt: Karten auf Avesmaps", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);

    for (const thema of ["light", "dark"] as const) {
        const { page, close } = await oeffne(browser, baseURL!, thema);
        await hinweiseOeffnen(page);
        if (thema === "light") {
            await ruhe(page);
            aufnahmen.set("liste", await page.screenshot({ clip: await rahmen(page, '[data-testid="notes"]', 8) }));
        }
        await page.getByTestId("notes-maps").locator("summary").click();
        await ruhe(page);
        aufnahmen.set(
            `karten-${thema}`,
            await page.screenshot({ clip: await rahmen(page, '[data-testid="notes-maps"]', 8) }),
        );
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 1420, height: 900 } });
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
    p.unter { margin: 0 0 18px; color: #6b655a; max-width: 900px; }
    .reihe { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
    figure { margin: 0 0 16px; }
    figcaption { margin: 0 0 6px; font-size: 13px; }
    figcaption span { color: #6b655a; }
    img { display: block; max-width: 100%; border: 1px solid #d8d2c4; }
</style></head><body>
    <h1>Karten auf Avesmaps</h1>
    <p class="unter">Aus „Kartenmaterial“ und „Kartenserien“ wurde ein Abschnitt in der Reihenfolge der Entstehung: woher die Karte kommt, was aus ihr wurde, unter welcher Lizenz. Der Herkunftssatz stand vorher dreimal, einmal je Serie. „Schriften“ sitzt jetzt bei Technik und Lizenzen. Keine roten Texte mehr: Die Aussage zum fehlenden Nachweis steht wörtlich weiter da, nur ruhig.</p>
    ${figur("Der neue Abschnitt", "hell, aufgeklappt", "karten-light", 860)}
    <div class="reihe">
        ${figur("Dunkel", "derselbe Abschnitt", "karten-dark", 620)}
        ${figur("Die Abschnittsliste", "zugeklappt — aus zwei Einträgen wurde einer", "liste", 620)}
    </div>
</body></html>`;
}
