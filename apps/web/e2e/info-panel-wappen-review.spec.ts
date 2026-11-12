import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0094: die Wappen in der Treppe „Liegt in“. Betreiber 2026-10-06: „in legacy sind die wappen als kleine thumbs
 * immer vor den territorien oder siedlungen, die ein wappen haben, kannst du das auch so machen?“
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt ein Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `e2e/info-panel-wappen-treppe.spec.ts`, `test/panel-text.test.ts` und serverseitig in `apps/server/test/media-resolver.test.ts`.
 *
 * 🔴 „Vorher“ entsteht aus DEMSELBEN Stand: ein Stilzettel blendet genau den Wappendaumen aus, sonst nichts. So vergleicht das
 * Blatt zwei Zustände derselben Seite und nicht zwei Bauzustände.
 *
 *   npm run review:wappen-treppe
 *
 * Ablage: `project-control/discovery/wi-0094-wappen-treppe.png` (versioniert, damit der Betreiber es im Repository findet).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../project-control/discovery");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; infoPanel: Record<string, number> };

/** Waldfang: die Treppe aus dem Bildschirmfoto des Betreibers - vier Gebiete, alle mit Wappen. */
const WALDFANG = { kind: "place", id: "be3fd56f-61f6-516c-b7f0-f84098f788a8" };
/** Gareth: drei Stufen mit Wappen, „Alt-Gareth“ ohne - der gemischte Fall. */
const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };

/** Der Stand VOR diesem Paket: derselbe Stand, nur ohne den Daumen. */
const VORHER = `.info-stairs__coat { display: none !important; }`;

type Scheme = "light" | "dark";

interface Masse {
    kante: number;
    luft: number;
    grundlinie: number;
    radius: number;
    schritt: number;
    zeilen: number;
    mitWappen: number;
}

async function open(page: Page, ref: Record<string, unknown>, title: string): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await page.getByTestId("info-title").filter({ hasText: title }).waitFor({ timeout: 30_000 });
    await page.getByTestId("info-stairs").waitFor({ timeout: 30_000 });
    // Die Bilder müssen geladen sein, sonst zeigt das Blatt leere Kästchen.
    await page.waitForFunction(
        () =>
            [...document.querySelectorAll<HTMLImageElement>(".info-stairs__coat")].every(
                (image) => image.complete && image.naturalWidth > 0,
            ),
        undefined,
        { timeout: 30_000 },
    );
    await page.waitForTimeout(200);
}

/** Der Abschnitt „Liegt in“ in echter Größe. */
function shot(page: Page): Promise<Buffer> {
    return page.getByTestId("info-lies-in").screenshot();
}

/** Was der Browser wirklich misst - nicht, was im Stilzettel steht. */
async function gemessen(page: Page): Promise<Masse> {
    return page.evaluate(() => {
        const coat = document.querySelector<HTMLElement>(".info-stairs__coat");
        const chain = document.querySelector<HTMLElement>('[data-testid="info-stairs"]');
        const rows = document.querySelectorAll('[data-testid="info-stairs-row"]');
        if (coat === null || chain === null) throw new Error("kein Wappen im Bild");
        const style = getComputedStyle(coat);
        return {
            kante: Math.round(coat.getBoundingClientRect().width * 10) / 10,
            luft: Number.parseFloat(style.marginRight),
            grundlinie: Number.parseFloat(style.verticalAlign),
            radius: Number.parseFloat(style.borderTopLeftRadius),
            schritt: Number.parseFloat(getComputedStyle(chain).getPropertyValue("--step")),
            zeilen: rows.length,
            mitWappen: document.querySelectorAll(".info-stairs__coat").length,
        };
    });
}

/** Ein Fall: vorher, nachher und die Maße, im gewünschten Thema. */
async function fall(
    browser: Browser,
    baseURL: string,
    ref: Record<string, unknown>,
    title: string,
    scheme: Scheme,
    client: string,
): Promise<{ vorher: Buffer; nachher: Buffer; masse: Masse }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 960 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": client },
    });
    const page = await context.newPage();
    await open(page, ref, title);
    const masse = await gemessen(page);
    const zettel = await page.addStyleTag({ content: VORHER });
    await page.waitForTimeout(150);
    const vorher = await shot(page);
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(150);
    const nachher = await shot(page);
    await context.close();
    return { vorher, nachher, masse };
}

/** Die Nahaufnahme: dieselbe Treppe, dreifach vergrößert (Gerätemaßstab 3, kein CSS-Zoom - die Kanten bleiben echt). */
async function nah(browser: Browser, baseURL: string, ref: Record<string, unknown>, title: string): Promise<Buffer> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 960 },
        deviceScaleFactor: 3,
        colorScheme: "light",
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.95" },
    });
    const page = await context.newPage();
    await open(page, ref, title);
    const png = await page.getByTestId("info-stairs").screenshot();
    await context.close();
    return png;
}

test("Abnahmeblatt WI-0094: Wappen in der Treppe „Liegt in“", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const waldfangHell = await fall(browser, baseURL, WALDFANG, "Waldfang", "light", "10.77.0.92");
    const waldfangDunkel = await fall(browser, baseURL, WALDFANG, "Waldfang", "dark", "10.77.0.93");
    const garethHell = await fall(browser, baseURL, GARETH, "Gareth", "light", "10.77.0.94");
    const nahWaldfang = await nah(browser, baseURL, WALDFANG, "Waldfang");
    const nahGareth = await nah(browser, baseURL, GARETH, "Gareth");

    const m = waldfangHell.masse;
    const colour = CANON.colour;
    const image = (png: Buffer): string => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 20px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1000px; }
h2 { margin: 26px 0 10px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.pair { display: grid; grid-template-columns: repeat(4, max-content); gap: 10px 20px; align-items: start; }
.nah { display: grid; grid-template-columns: repeat(2, max-content); gap: 10px 24px; align-items: start; }
p.cap { margin: 0 0 6px; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; }
table { border-collapse: collapse; margin: 10px 0 0; font-size: 13px; }
th, td { padding: 3px 18px 3px 0; text-align: left; font-weight: 400; }
th { color: ${colour["textMuted"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
.note { margin: 18px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1000px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Die Wappen stehen in der Treppe „Liegt in“</h1>
<p class="lead">WI-0094 · alle Bilder bis auf die Nahaufnahmen in echter Größe. „Vorher“ ist derselbe Stand mit einem Stilzettel,
der allein den Wappendaumen ausblendet. Maße aus Legacy (Discovery-Mirror <code>6fafd5c2f</code>,
<code>css/features/infopanel.css</code> L695–703, <code>.location-popup__breadcrumb-coat</code>), rechts daneben im Browser
nachgemessen.</p>

<table>
<tr><th>Maß</th><th>Legacy</th><th>Avesmaps3D (gemessen)</th></tr>
<tr><td>Kantenlänge des Daumens</td><td>15 px</td><td><b>${String(m.kante)} px</b></td></tr>
<tr><td>Luft zum Namen</td><td>4 px (<code>margin-right</code>)</td><td><b>${String(m.luft)} px</b></td></tr>
<tr><td>unter der Grundlinie</td><td>3 px (<code>vertical-align: -3px</code>)</td><td><b>${String(Math.abs(m.grundlinie))} px</b></td></tr>
<tr><td>Eckenradius</td><td><code>--radius-sm</code> = 5 px</td><td><b>${String(m.radius)} px</b></td></tr>
<tr><td>Schritt der Treppe</td><td>14 px</td><td><b>${String(m.schritt)} px</b></td></tr>
<tr><td>ohne Wappen</td><td>kein Bild, der Name rückt auf</td><td><b>ebenso</b></td></tr>
</table>

<h2>1 · Waldfang <span>· vier Gebiete, alle mit Wappen — die Treppe aus dem Bildschirmfoto</span></h2>
<div class="pair">
<div><p class="cap">vorher · hell</p>${image(waldfangHell.vorher)}</div>
<div><p class="cap">nachher · hell</p>${image(waldfangHell.nachher)}</div>
<div><p class="cap">vorher · dunkel</p>${image(waldfangDunkel.vorher)}</div>
<div><p class="cap">nachher · dunkel</p>${image(waldfangDunkel.nachher)}</div>
</div>

<h2>2 · Gareth <span>· drei Stufen mit Wappen, „Alt-Gareth“ ohne — und ohne Loch</span></h2>
<div class="pair">
<div><p class="cap">vorher · hell</p>${image(garethHell.vorher)}</div>
<div><p class="cap">nachher · hell</p>${image(garethHell.nachher)}</div>
</div>

<h2>3 · Nahaufnahme <span>· dreifach, Gerätemaßstab statt CSS-Zoom</span></h2>
<div class="nah">
<div><p class="cap">Waldfang · ${String(waldfangHell.masse.mitWappen)} von ${String(waldfangHell.masse.zeilen)} Zeilen mit Wappen</p>${image(nahWaldfang)}</div>
<div><p class="cap">Gareth · ${String(garethHell.masse.mitWappen)} von ${String(garethHell.masse.zeilen)} Zeilen mit Wappen</p>${image(nahGareth)}</div>
</div>

<p class="note"><b>Was zu sehen ist:</b> Der Daumen steht IM goldenen Link, vor dem Namen, und der Einrückungswinkel bleibt davor
stehen — er hängt am Einzug der Zeile, nicht am Textanfang. Bei Gareth trägt die letzte Stufe kein Wappen: Dort steht kein
leeres Kästchen, der Name rückt an die Kante seines Links. So macht es auch Legacy, wo der Daumen bei fehlender Adresse
schlicht nichts erzeugt.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0094.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0094.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "wi-0094-wappen-treppe.png"), fullPage: true });
    await sheetContext.close();
});
