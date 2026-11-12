import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0088: „Das Infopanel bleibt ruhig, während sein Inhalt kommt“ — EIN Blatt, drei Fragen.
 *
 * 1. **Die Abstände** (P2): mehrere Abschnitte, zugeklappt und aufgeklappt, vorher gegen nachher.
 * 2. **Das Laden** (P1): das Panel kurz nach dem Klick und fertig geladen.
 * 3. **Die Silbentrennung** (P3): ein langes Wort und ein langer Link bei 360 px, vorher gegen nachher.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt ein Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `e2e/info-panel-arrival.spec.ts`, `e2e/silbentrennung.spec.ts` und `test/panel-arrival.test.ts`.
 *
 * 🔴 „Vorher“ entsteht aus DEMSELBEN Stand: Ein Stilzettel stellt genau die Deklarationen wieder her, die dieses Paket geändert
 * hat (Außenabstand zwischen zwei Abschnitten, fehlende obere Polsterung des Rumpfs, `hyphens: manual`). So vergleicht das Blatt
 * zwei Zustände derselben Seite und nicht zwei Bauzustände.
 *
 *   npm run review:infopanel-ruhe
 *
 * Ablage: `review/wi-0088/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0088");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; colourDark: Record<string, string> };

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };

/** Der Stand VOR diesem Paket, als Stilzettel über den fertigen Stand gelegt. */
const VORHER_ABSTAENDE = `
.info-section + .info-section { margin-top: var(--space-10) !important; }
.info-section__body { padding-top: 0 !important; }
`;
const VORHER_TRENNUNG = `html { hyphens: manual !important; }`;

type Scheme = "light" | "dark";

async function openGareth(page: Page): Promise<void> {
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-bewertungszeile").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-literature-strip").waitFor({ timeout: 30_000 });
}

async function setSections(page: Page, open: boolean[]): Promise<void> {
    const heads = page.locator(".info-section__head");
    for (let at = 0; at < open.length; at += 1) {
        const expanded = (await heads.nth(at).getAttribute("aria-expanded")) === "true";
        if (expanded !== open[at]) await heads.nth(at).click();
    }
    await page.waitForTimeout(150);
}

/** Der Ausschnitt mit den Abschnitten, auf eine feste Höhe beschnitten - echte Größe, kein Maßstab. */
async function shotSections(page: Page, height: number): Promise<Buffer> {
    await page.locator('[data-testid="info-section"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const box = await page.evaluate(() => {
        const first = document.querySelector('[data-testid="info-section"]');
        const panel = document.querySelector('[data-testid="info-panel"]');
        if (first === null || panel === null) return null;
        const a = first.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        return { x: Math.round(p.left), y: Math.round(a.top), width: Math.round(p.width) };
    });
    if (box === null) throw new Error("Abschnitte nicht gefunden");
    return page.screenshot({ clip: { ...box, height } });
}

/** Die Abstände, vorher und nachher, im gewünschten Thema. */
async function abstaende(
    browser: Browser,
    baseURL: string,
    options: { scheme: Scheme; open: boolean[]; height: number },
): Promise<{ vorher: Buffer; nachher: Buffer }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 960 },
        colorScheme: options.scheme,
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.88" },
    });
    const page = await context.newPage();
    await openGareth(page);
    await setSections(page, options.open);
    const zettel = await page.addStyleTag({ content: VORHER_ABSTAENDE });
    const vorher = await shotSections(page, options.height);
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(150);
    const nachher = await shotSections(page, options.height);
    await context.close();
    return { vorher, nachher };
}

/** Das Laden: das Panel kurz nach dem Klick und fertig geladen. */
async function laden(browser: Browser, baseURL: string, scheme: Scheme): Promise<{ kurz: Buffer; fertig: Buffer }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 960 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.89" },
    });
    const page = await context.newPage();
    await openMap(page);
    let release = (): void => {};
    const gate = new Promise<void>((done) => {
        release = () => done();
    });
    await page.route("**/api/subjects/place/**", async (route) => {
        await gate;
        await route.continue();
    });
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
    await page.getByTestId("info-loading").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(200);
    const kurz = await page.getByTestId("info-panel").screenshot();
    release();
    await page.getByTestId("info-facts").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-literature-strip").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const fertig = await page.getByTestId("info-panel").screenshot();
    await context.close();
    return { kurz, fertig };
}

/**
 * Die Silbentrennung am Telefon: ein langes Wort als Feldwert und ein langes Wort in einem Link, beide in der echten Spalte des
 * Panels. Der Text wird für das Bild eingesetzt - die Flächen, ihre Breite und ihre Schrift sind die echten.
 */
async function trennung(
    browser: Browser,
    baseURL: string,
): Promise<{ wortVorher: Buffer; wortNachher: Buffer; linkVorher: Buffer; linkNachher: Buffer }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 360, height: 780 },
        colorScheme: "light",
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.90" },
    });
    const page = await context.newPage();
    await openGareth(page);
    // Zwei echte Zeilen der Feldliste bekommen für das Bild ein zusammengesetztes Wort und einen langen Link. Die Flächen, ihre
    // Breite und ihre Schrift sind die echten; nur der Text ist gesetzt, damit der Fall auf dem Blatt sicher vorkommt.
    const positions = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="info-fact"]')];
        const plain = rows.findIndex(
            (row) => row.querySelector('[data-testid="info-link"]') === null && row.querySelector(".wert") === null,
        );
        const linked = rows.findIndex((row) => row.querySelector('[data-testid="info-link"]') !== null);
        const set = (node: Element | null | undefined, text: string): void => {
            if (node !== null && node !== undefined) node.textContent = text;
        };
        set(rows[plain]?.querySelector('[data-testid="info-fact-label"]'), "Lage");
        // Ein EINZELNES zusammengesetztes Wort: Nur daran ist der Unterschied zu sehen - ein Wort mit Leerzeichen bräche ohnehin.
        set(rows[plain]?.querySelector('[data-testid="info-fact-value"]'), "Raschtulswallvorgebirge");
        set(rows[linked]?.querySelector('[data-testid="info-fact-label"]'), "Verkehrsweg");
        set(rows[linked]?.querySelector('[data-testid="info-link"]'), "Reichsstraßenverwaltungsgebiet");
        return { plain, linked };
    });
    const rows = page.locator('[data-testid="info-fact"]');
    const wort = rows.nth(positions.plain);
    const link = rows.nth(positions.linked);
    await wort.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    const zettel = await page.addStyleTag({ content: VORHER_TRENNUNG });
    await page.waitForTimeout(150);
    const wortVorher = await wort.screenshot();
    const linkVorher = await link.screenshot();
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(150);
    const wortNachher = await wort.screenshot();
    const linkNachher = await link.screenshot();
    await context.close();
    return { wortVorher, wortNachher, linkVorher, linkNachher };
}

/** Die Abschnitte am Telefon, im fertigen Stand. */
async function telefon(browser: Browser, baseURL: string): Promise<Buffer> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 360, height: 780 },
        colorScheme: "light",
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.91" },
    });
    const page = await context.newPage();
    await openGareth(page);
    await setSections(page, [false, true]);
    const png = await shotSections(page, 230);
    await context.close();
    return png;
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt WI-0088: Abstände, Laden und Silbentrennung", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const zuHell = await abstaende(browser, baseURL, { scheme: "light", open: [false, false, false], height: 152 });
    const zuDunkel = await abstaende(browser, baseURL, { scheme: "dark", open: [false, false, false], height: 152 });
    const aufHell = await abstaende(browser, baseURL, { scheme: "light", open: [false, true, false], height: 250 });
    const aufDunkel = await abstaende(browser, baseURL, { scheme: "dark", open: [false, true, false], height: 250 });
    const ladenHell = await laden(browser, baseURL, "light");
    const ladenDunkel = await laden(browser, baseURL, "dark");
    const trennen = await trennung(browser, baseURL);
    const phone = await telefon(browser, baseURL);

    const colour = CANON.colour;
    const image = (png: Buffer): string => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 20px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 980px; }
h2 { margin: 26px 0 10px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.pair { display: grid; grid-template-columns: repeat(4, max-content); gap: 10px 20px; align-items: start; }
.pair p, .laden p, .schmal p { margin: 0 0 6px; font-size: 12px; color: ${colour["textMuted"]}; }
.laden { display: grid; grid-template-columns: repeat(4, max-content); gap: 10px 18px; align-items: start; }
.laden img { height: 460px; object-fit: cover; object-position: top; }
.schmal { display: grid; grid-template-columns: repeat(3, max-content); gap: 10px 20px; align-items: start; }
img { display: block; border: 1px solid ${colour["border"]}; }
table { border-collapse: collapse; margin: 10px 0 0; font-size: 13px; }
th, td { padding: 3px 14px 3px 0; text-align: left; font-weight: 400; }
th { color: ${colour["textMuted"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
.note { margin: 16px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 980px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Das Infopanel bleibt ruhig, während sein Inhalt kommt</h1>
<p class="lead">WI-0088 · Gareth · alle Bilder in echter Größe. „Vorher“ ist derselbe Stand mit einem Stilzettel, der genau die
geänderten Deklarationen zurückstellt.</p>

<h2>1 · Die Abstände <span>· zugeklappt dicht, aufgeklappt mit Luft</span></h2>
<table>
<tr><th>gemessen</th><th>vorher</th><th>nachher</th></tr>
<tr><td>zwischen zwei zugeklappten Köpfen (Versalkante zu Versalkante)</td><td>41,0 px</td><td><b>29,0 px</b></td></tr>
<tr><td>vom Kopf zu seinem Inhalt (Versalkante zum ersten Element)</td><td>14,0 px</td><td><b>26,0 px</b></td></tr>
<tr><td>Hover-Grund über / unter der Versalhöhe</td><td>14 / 14 px</td><td>14 / 14 px</td></tr>
</table>
<div class="pair">
<div><p>drei zugeklappt · vorher · hell</p>${image(zuHell.vorher)}</div>
<div><p>drei zugeklappt · nachher · hell</p>${image(zuHell.nachher)}</div>
<div><p>vorher · dunkel</p>${image(zuDunkel.vorher)}</div>
<div><p>nachher · dunkel</p>${image(zuDunkel.nachher)}</div>
<div><p>einer offen zwischen zwei zu · vorher · hell</p>${image(aufHell.vorher)}</div>
<div><p>einer offen · nachher · hell</p>${image(aufHell.nachher)}</div>
<div><p>vorher · dunkel</p>${image(aufDunkel.vorher)}</div>
<div><p>nachher · dunkel</p>${image(aufDunkel.nachher)}</div>
</div>

<h2>2 · Das Laden <span>· das Panel steht sofort offen, der Inhalt blendet ein</span></h2>
<div class="laden">
<div><p>kurz nach dem Klick · hell</p>${image(ladenHell.kurz)}</div>
<div><p>fertig geladen · hell</p>${image(ladenHell.fertig)}</div>
<div><p>kurz nach dem Klick · dunkel</p>${image(ladenDunkel.kurz)}</div>
<div><p>fertig geladen · dunkel</p>${image(ladenDunkel.fertig)}</div>
</div>

<h2>3 · Silbentrennung und Telefon <span>· 360 px, dieselben Zeilen, nur die Regel unterscheidet sich</span></h2>
<div class="schmal">
<div><p>langes Wort · vorher (Bruch ohne Strich)</p>${image(trennen.wortVorher)}
<p style="margin-top:10px">derselbe Link · vorher</p>${image(trennen.linkVorher)}</div>
<div><p>langes Wort · nachher (Trennung mit Strich)</p>${image(trennen.wortNachher)}
<p style="margin-top:10px">derselbe Link · nachher</p>${image(trennen.linkNachher)}</div>
<div><p>Abschnitte am Telefon · nachher</p>${image(phone)}</div>
</div>

<p class="note"><b>Was zu sehen ist:</b> Oben links stehen drei zugeklappte Köpfe mit einem Abstand, der nirgends hingehört -
rechts daneben stehen sie als Liste, getrennt nur von der Linie. Darunter umgekehrt: Der Inhalt klebte am Kopf, jetzt hat er
Luft. Beim Laden steht der Name der Karte sofort da und bleibt stehen; alles, was mit der Antwort dazukommt, blendet in 140 ms
ein. Unten bricht ein zusammengesetztes Wort mit Trennstrich statt über den Rand zu laufen - auch im Link.
${escape("")}</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0088.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0088.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
