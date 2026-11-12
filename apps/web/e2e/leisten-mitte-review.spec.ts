import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";

/**
 * Blatt zum dritten Nachgang WI-0089: **sitzt die Beschriftung der Leisten „Transportmittel“ und „Reiseoptionen“ zu
 * hoch?** (Betreiber 2026-10-06: „kann es sein, dass die vertikale zentrierung von ‚Transportmittel…‘ und
 * ‚Reiseoptionen…‘ um ein paar pixel zu weit hoch ist?“). Sein Vergleich sind die Deckel der Routendetails.
 *
 * 💣 Dieser Lauf prüft NICHTS; die Prüfung steht in `e2e/leisten-mitte.spec.ts` (zwei benannte Fälle, einer je
 * Leistenart) und misst die Tinte der ersten Versalie gegen die Mitte der Leiste.
 *
 * 🔴 „Vorher“ entsteht aus DEMSELBEN Stand: Ein Stilzettel stellt genau die geänderte Deklaration zurück - die
 * Zeilenhöhe eines Symbols saß vorher nur an der Kurzangabe, nicht an der ganzen Kopfzeile.
 *
 *   npm run review:leisten-mitte
 *
 * Ablage: `review/wi-0089/mitte.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0089");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const REISE = "?route=Gareth~Greifenfurt";
const RECHNER = { width: 1280, height: 1000 };
const TELEFON = { width: 360, height: 900 };

/** Der Stand vor diesem Nachgang: die 16-px-Zeile stand nur an der Kurzangabe, der Titel behielt seine 13,75 px. */
const VORHER = `.disclosure--einzeilig .disclosure__summary { line-height: inherit !important; }
.disclosure--einzeilig .disclosure__secondary { line-height: var(--icon-sm) !important; }`;

type Scheme = "light" | "dark";

let client = 60;
async function neu(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
    dpr = 4,
) {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: size,
        colorScheme: scheme,
        deviceScaleFactor: dpr,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.3.${String(client)}` },
    });
    return { context, page: await context.newPage() };
}

async function openRoute(page: Page): Promise<void> {
    await page.goto(`/${REISE}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-title").waitFor({ timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
}

/** Alle vier Deckel zuklappen - nur zugeklappt steht die Kurzangabe des Planers da. */
async function alleZu(page: Page): Promise<void> {
    for (const id of ["planner-transport", "planner-options", "planning-profile", "planning-costs"]) {
        const toggle = page.locator(`[data-testid="${id}"] summary`).first();
        if ((await toggle.count()) === 0) continue;
        if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
        await page.waitForTimeout(300);
    }
    await page.waitForTimeout(250);
}

/**
 * Zeichnet die Mitte der Leiste als Haarlinie ein - 0,5 CSS-Pixel, bei vierfacher Pixeldichte also zwei Gerätepixel.
 * 🪤 Dünner (ein Gerätepixel) war sie im Blatt nicht mehr zu erkennen; dicker würde sie selbst zur Aussage, weil die
 * Versalhöhe nur rund 8,75 px misst.
 */
async function mitteEin(page: Page, farbe: string): Promise<void> {
    await page.evaluate(
        ({ farbe }) => {
            for (const id of ["planner-transport", "planner-options", "planning-profile", "planning-costs"]) {
                /*
                 * 🪤 Die Linie gehört in die KOPFZEILE, nicht in die Klappbox: Ein zugeklapptes `<details>` zeichnet
                 * von seinen Kindern nur das `<summary>`, alles andere ist unsichtbar - die erste Fassung hängte sie
                 * daneben und das Blatt kam ohne Markierung heraus. Die Mitte ist dieselbe: Polster und Rahmen der
                 * Box sind oben wie unten gleich.
                 */
                const kopf = document.querySelector<HTMLElement>(`[data-testid="${id}"] .disclosure__summary`);
                if (kopf === null) continue;
                kopf.style.position = "relative";
                const linie = document.createElement("div");
                linie.dataset["mitte"] = "1";
                linie.style.cssText = `position:absolute;left:0;right:0;top:calc(50% - 0.25px);height:0.5px;background:${farbe};pointer-events:none;z-index:9`;
                kopf.append(linie);
            }
        },
        { farbe },
    );
    await page.waitForTimeout(150);
}

async function mitteWeg(page: Page): Promise<void> {
    await page.evaluate(() => {
        for (const linie of document.querySelectorAll("[data-mitte]")) linie.remove();
    });
}

/** Ein knapper Ausschnitt: der linke Teil der Leiste mit Titel und Anfang der Kurzangabe, samt Kasten. */
function ausschnitt(
    page: Page,
    id: string,
    breite = 168,
): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.evaluate(
        ({ id, breite }) => {
            const box = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
            return {
                x: Math.round(box.left) - 1,
                y: Math.round(box.top) - 1,
                width: breite,
                height: Math.round(box.height) + 3,
            };
        },
        { id, breite },
    );
}

interface Paar {
    vorher: Buffer;
    nachher: Buffer;
}

async function paare(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
): Promise<Record<string, Paar>> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page);
    await alleZu(page);
    // Die Linie muss in beiden Themen sofort zu sehen sein: `danger` ist die einzige klar rote Farbe des Kanons.
    const farbe = CANON.colour["danger"] ?? "#9d3a2e";

    const ids = ["planner-transport", "planner-options", "planning-profile", "planning-costs"] as const;
    const out: Record<string, Paar> = {};

    const zettel = await page.addStyleTag({ content: VORHER });
    await page.waitForTimeout(250);
    await mitteEin(page, farbe);
    const vorher: Record<string, Buffer> = {};
    for (const id of ids) {
        if ((await page.locator(`[data-testid="${id}"]`).count()) === 0) continue;
        await page.locator(`[data-testid="${id}"]`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        vorher[id] = await page.screenshot({ clip: await ausschnitt(page, id) });
    }
    await mitteWeg(page);
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(300);
    await mitteEin(page, farbe);
    for (const id of ids) {
        if ((await page.locator(`[data-testid="${id}"]`).count()) === 0) continue;
        await page.locator(`[data-testid="${id}"]`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const nachher = await page.screenshot({ clip: await ausschnitt(page, id) });
        const v = vorher[id];
        if (v !== undefined) out[id] = { vorher: v, nachher };
    }
    await context.close();
    return out;
}

/** Beide Planer-Leisten in ECHTER Größe, ohne eingezeichnete Mitte - so sieht der Betreiber sie wirklich. */
async function echteGroesse(browser: Browser, baseURL: string, scheme: Scheme): Promise<Paar> {
    const { context, page } = await neu(browser, baseURL, scheme, RECHNER, 1);
    await openRoute(page);
    await alleZu(page);
    const clip = await page.evaluate(() => {
        const a = document.querySelector('[data-testid="planner-transport"]')!.getBoundingClientRect();
        const b = document.querySelector('[data-testid="planner-options"]')!.getBoundingClientRect();
        return {
            x: Math.round(a.left) - 2,
            y: Math.round(a.top) - 2,
            width: Math.round(a.width) + 4,
            height: Math.round(b.bottom - a.top) + 4,
        };
    });
    const zettel = await page.addStyleTag({ content: VORHER });
    await page.waitForTimeout(250);
    const vorher = await page.screenshot({ clip });
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(300);
    const nachher = await page.screenshot({ clip });
    await context.close();
    return { vorher, nachher };
}

const image = (png: Buffer): string => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`;

function zeile(titel: string, paar: Paar | undefined): string {
    if (paar === undefined) return `<div><p>${titel}</p><p class="fehlt">steht in dieser Route nicht</p></div>`;
    return `<div><p>${titel} · vorher</p>${image(paar.vorher)}</div><div><p>${titel} · nachher</p>${image(paar.nachher)}</div>`;
}

test("Blatt WI-0089: sitzt die Beschriftung der Leisten zu hoch?", async ({ browser }, testInfo) => {
    test.setTimeout(1_800_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const hell = await paare(browser, baseURL, "light", RECHNER);
    const dunkel = await paare(browser, baseURL, "dark", RECHNER);
    const schmal = await paare(browser, baseURL, "light", TELEFON);
    const grossHell = await echteGroesse(browser, baseURL, "light");
    const grossDunkel = await echteGroesse(browser, baseURL, "dark");

    const colour = CANON.colour;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1500px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 16px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1150px; }
h2 { margin: 24px 0 9px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.reihe { display: grid; grid-template-columns: repeat(2, max-content); gap: 10px 18px; align-items: start; }
.reihe p { margin: 0 0 5px; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; image-rendering: pixelated; }
.echt img { image-rendering: auto; }
table { border-collapse: collapse; margin: 8px 0 14px; font-size: 13px; }
th, td { padding: 3px 18px 3px 0; text-align: left; font-weight: 400; vertical-align: top; }
th { color: ${colour["textMuted"]}; border-bottom: 1px solid ${colour["border"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
.fehlt { width: 280px; padding: 10px; border: 1px dashed ${colour["border"]}; border-radius: 8px; font-size: 12px; color: ${colour["textMuted"]}; }
.note { margin: 14px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1150px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Sitzt die Beschriftung zu hoch? — gemessen, dann behoben</h1>
<p class="lead">Alle Nahaufnahmen vierfach vergrößert; die dünne Linie ist die <b>Mitte der Leiste</b> (zwei Gerätepixel
breit). „Vorher“ ist derselbe Stand mit einem Stilzettel, der genau die geänderte Deklaration zurückstellt.
Gemessen wird am Bild die Mitte der <b>Versalhöhe</b> des ersten Großbuchstabens gegen die Mitte der Leiste;
negativ heißt zu hoch.</p>

<table>
<tr><th>Leiste</th><th>Rechner · vorher</th><th>Rechner · nachher</th><th>360 px · vorher</th><th>360 px · nachher</th></tr>
<tr><td>Transportmittel</td><td><b>−2,08 px</b></td><td>−0,08 px</td><td><b>−2,11 px</b></td><td>−0,11 px</td></tr>
<tr><td>Reiseoptionen</td><td><b>−2,08 px</b></td><td>−0,08 px</td><td><b>−2,11 px</b></td><td>−0,11 px</td></tr>
<tr><td>Höhenprofil (Vergleich)</td><td>−0,91 px</td><td>−0,91 px</td><td>−1,09 px</td><td>−1,09 px</td></tr>
<tr><td>Reisekosten (Vergleich)</td><td>−0,72 px</td><td>−0,72 px</td><td>−0,91 px</td><td>−0,91 px</td></tr>
</table>

<h2>Die Leisten des Planers · Rechner, hell <span>· die beiden, um die es geht</span></h2>
<div class="reihe">
${zeile("Transportmittel", hell["planner-transport"])}
${zeile("Reiseoptionen", hell["planner-options"])}
</div>

<h2>Dieselben Leisten · Rechner, dunkel</h2>
<div class="reihe">
${zeile("Transportmittel", dunkel["planner-transport"])}
${zeile("Reiseoptionen", dunkel["planner-options"])}
</div>

<h2>Dieselben Leisten · 360 px</h2>
<div class="reihe">
${zeile("Transportmittel", schmal["planner-transport"])}
${zeile("Reiseoptionen", schmal["planner-options"])}
</div>

<h2>Zum Vergleich: die Deckel der Routendetails <span>· sie ändern sich NICHT</span></h2>
<div class="reihe">
${zeile("Höhenprofil · hell", hell["planning-profile"])}
${zeile("Reisekosten · hell", hell["planning-costs"])}
${zeile("Höhenprofil · dunkel", dunkel["planning-profile"])}
${zeile("Reisekosten · dunkel", dunkel["planning-costs"])}
</div>

<h2>Beide Leisten in echter Größe <span>· so stehen sie im Panel</span></h2>
<div class="reihe echt">
<div><p>hell · vorher</p>${image(grossHell.vorher)}</div>
<div><p>hell · nachher</p>${image(grossHell.nachher)}</div>
<div><p>dunkel · vorher</p>${image(grossDunkel.vorher)}</div>
<div><p>dunkel · nachher</p>${image(grossDunkel.nachher)}</div>
</div>

<p class="note"><b>Was zu sehen ist:</b> Der Titel saß 2,08 px über der Mitte und 2,00 px über der Grundlinie seiner
eigenen Kurzangabe — zu sehen daran, dass „Transportmittel:“ vorher höher steht als die Angabe daneben. Die Ursache
war nicht die Versalmitte, sondern die Zeilenhöhe: Die Regel „die Zeile ist genau so hoch wie ein Symbol“ stand nur
an der Kurzangabe, nicht am Titel; gestreckt hängt das niedrigere Feld oben. Jetzt trägt die ganze einzeilige
Kopfzeile diese Zeilenhöhe — der Titel steht mittig, auf derselben Grundlinie wie seine Kurzangabe, und die Kopfzeile
behält ihre Höhe auch beim Aufklappen. <b>Die Deckel der Routendetails sind unberührt;</b> ihr Rest von 0,72 bis
1,09 px ist befundet, nicht verschoben.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1564, height: 1100 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0089m.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0089m.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "mitte.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "mitte.png") });
});
