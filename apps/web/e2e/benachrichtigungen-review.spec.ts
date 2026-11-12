import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { benachrichtigungen, stubBenachrichtigungen } from "./benachrichtigungen-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Benachrichtigungen in der Leiste, gebaut“ (WI-0136 N1 bis N3). Anders als das abgenommene Mockup-Blatt
 * (`review/wi-0136/blatt.png`, „1B 2A 3A“) zeigt es die GEBAUTE Glocke: echte Kopfleiste auf der echten Karte, Sitzung aus
 * `verwaltung-stub.ts` (Stage, „Rondrikan“ als Betreiber), die Einträge aus `benachrichtigungen-stub.ts` (erfunden). „Neue Version“ löst
 * der Test wie `neue-version.spec.ts` aus: Er bietet der Versionsprobe eine Seite mit anderem Einstieg an.
 *
 * 💣 Dieser Lauf prüft NICHTS; die Zusicherungen stehen in `glocke.spec.ts`, `neue-version.spec.ts` und den Servertests.
 *
 *   npm run review:benachrichtigungen
 *
 * Ablage: `review/wi-0136/blatt-2.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0136");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];

test.use({ actionTimeout: 30_000 });

interface Bild {
    buf: Buffer;
    dichte: number;
}
const shots: Record<string, Bild> = {};
const merke = (key: string, buf: Buffer, dichte: number): void => {
    shots[key] = { buf, dichte };
};

async function oeffne(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    eintraege = benachrichtigungen(),
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.4.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: BETREIBER, role: "operator" });
    await stubBenachrichtigungen(page, eintraege);
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    return { page, close: () => context.close() };
}

/** „Neue Version“ wie in `neue-version.spec.ts`: Die Versionsprobe bekommt eine Seite mit anderem Einstieg. */
async function neueVersion(page: Page): Promise<void> {
    await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.headers()["x-avm-versionsprobe"] !== "1") return route.fallback();
        const antwort = await route.fetch({ headers: { ...request.headers(), "x-avm-versionsprobe": "" } });
        const html = (await antwort.text()).replace(/src="\/src\/main\.ts"/u, 'src="/src/main.ts?v=neu"');
        await route.fulfill({ response: antwort, body: html });
    });
    await page.evaluate(async () => {
        await (globalThis as { __avesmapsNeueVersion?: { pruefe(): Promise<void> } }).__avesmapsNeueVersion?.pruefe();
    });
}

async function ruhe(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
}

async function rahmen(page: Page, selektoren: string[], rand = 10) {
    return page.evaluate(
        ({ s, r }) => {
            const boxen = s
                .map((sel) => document.querySelector(sel)?.getBoundingClientRect())
                .filter((b): b is DOMRect => b !== undefined);
            if (boxen.length === 0) throw new Error(`nichts zu sehen: ${s.join(", ")}`);
            const x = Math.max(0, Math.floor(Math.min(...boxen.map((b) => b.left)) - r));
            const y = Math.max(0, Math.floor(Math.min(...boxen.map((b) => b.top)) - r));
            const rechts = Math.min(innerWidth, Math.max(...boxen.map((b) => b.right)) + r);
            const unten = Math.min(innerHeight, Math.max(...boxen.map((b) => b.bottom)) + r);
            return { x, y, width: Math.ceil(rechts - x), height: Math.ceil(unten - y) };
        },
        { s: selektoren, r: rand },
    );
}

test("Abnahmeblatt: Benachrichtigungen in der Leiste, gebaut (WI-0136 N1 bis N3)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const LEISTE = '[data-testid="kopfleiste"]';
    const KLAPPE = '[data-testid="glocke-klappe"]';

    // Rechner hell, echte Größe: geschlossen mit Zahl, dann offen; doppelte Dichte für die Leiste.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        await ruhe(page);
        merke("a1", await page.screenshot({ clip: await rahmen(page, [LEISTE], 0) }), 2);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-12").waitFor();
        await ruhe(page);
        merke("a2", await page.screenshot({ clip: await rahmen(page, [KLAPPE, '[data-testid="glocke"]']) }), 2);
        await close();
    }
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-12").waitFor();
        await ruhe(page);
        merke("a3", await page.screenshot(), 1);
        // „Noch nicht gelöst“ mit Kommentar an der Stelle, dann „Gelöst“ am zweiten Fix.
        await page.getByTestId("benachrichtigung-12").getByTestId("benachrichtigung-nicht-geloest").click();
        await page.getByTestId("benachrichtigung-kommentar").fill("Am Telefon steht der Name noch.");
        await ruhe(page);
        merke("b2", await page.screenshot({ clip: await rahmen(page, ['[data-testid="benachrichtigung-12"]'], 6) }), 1);
        await page.getByTestId("benachrichtigung-abbrechen").click();
        await page.getByTestId("benachrichtigung-12").getByTestId("benachrichtigung-geloest").click();
        await page.getByTestId("benachrichtigung-12").getByTestId("benachrichtigung-stand").waitFor();
        await ruhe(page);
        merke("b3", await page.screenshot({ clip: await rahmen(page, ['[data-testid="benachrichtigung-12"]'], 6) }), 1);
        await close();
    }

    // Neue Version: am Rechner der Kasten vor der Glocke, in der Liste oben der Systemeintrag, und „Fix ist live“ fragt erst nach dem Neuladen.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await neueVersion(page);
        await ruhe(page);
        merke(
            "c1",
            await page.screenshot({
                clip: await rahmen(page, ['[data-testid="glocke"]'], 8),
            }),
            1,
        );
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").waitFor();
        await ruhe(page);
        merke("b1", await page.screenshot({ clip: await rahmen(page, [KLAPPE]) }), 1);
        await close();
    }

    // Leer und Fehler.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" }, []);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("glocke-leer").waitFor();
        await ruhe(page);
        merke("d1", await page.screenshot({ clip: await rahmen(page, [KLAPPE]) }), 1);
        await close();
    }

    // Dunkel, echte Größe.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "dark" });
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-12").waitFor();
        await ruhe(page);
        merke("e1", await page.screenshot(), 1);
        await close();
    }

    // Telefon (Pixel 7): geschlossen mit neuer Version (↺), offen; hell und dunkel.
    for (const thema of ["hell", "dunkel"] as const) {
        const { page, close } = await oeffne(browser, baseURL, {
            ...devices["Pixel 7"],
            colorScheme: thema === "hell" ? "light" : "dark",
        });
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").getByText("↺").waitFor();
        await ruhe(page);
        merke(`f1-${thema}`, await page.screenshot({ scale: "css" }), 1);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").waitFor();
        await ruhe(page);
        merke(`f2-${thema}`, await page.screenshot({ scale: "css" }), 1);
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1484, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__glocke.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: blatt(baseURL) }),
    );
    await sheet.goto("/__glocke.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt-2.png"), fullPage: true });
    await sheetContext.close();
});

function img(key: string, faktor = 1): string {
    const bild = shots[key];
    if (bild === undefined) throw new Error(`Bild fehlt: ${key}`);
    const breite = Math.round((bild.buf.readUInt32BE(16) / bild.dichte) * faktor);
    return `<img src="data:image/png;base64,${bild.buf.toString("base64")}" alt="" style="width:${String(breite)}px">`;
}
const fig = (key: string, text: string, faktor = 1): string =>
    `<figure>${img(key, faktor)}<figcaption>${text}</figcaption></figure>`;

function blatt(baseURL: string): string {
    const colour = CANON.colour;
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1420px; }
h1 { margin: 0 0 4px; font-size: 24px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 14px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1240px; }
h2 { margin: 34px 0 6px; padding-top: 18px; border-top: 1px solid ${colour["border"]}; font-size: 19px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 16px 24px; align-items: flex-start; margin-bottom: 14px; }
figure { display: table; margin: 0; }
figcaption { display: table-caption; caption-side: bottom; margin: 5px 0 0; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; }
.box { padding: 10px 16px; border: 1px solid ${colour["successSoftBorder"]}; border-radius: 8px; background: ${colour["successSoft"]}; font-size: 13px; }
.box ul { margin: 4px 0 0; padding-left: 18px; }
.quellen { margin-top: 26px; font-size: 11px; color: ${colour["textMuted"]}; max-width: 1340px; }
</style></head><body>

<h1>Benachrichtigungen in der Leiste · gebaut (WI-0136 N1 bis N3)</h1>
<p class="lead">Die gebaute Glocke, nicht mehr das Mockup: echte Kopfleiste auf der echten Karte, Stage, angemeldet „Rondrikan“ als Betreiber. Die Einträge sind erfunden. Rechner 1280 × 900,
Leiste und Klappe in doppelter Dichte, Telefon Pixel 7, hell und dunkel.</p>
<div class="box"><b>Kurz gesagt</b><ul>
<li><b>Glocke mit Zahl</b> vor Person und ☰ (Formfrage 1 = B). Öffnen markiert alles als gelesen; der Kreis zeigt danach, was noch auf die eigene Antwort wartet.</li>
<li><b>Neue Version</b> am Rechner als eigener Kasten vor der Glocke (2 = A), am Telefon wird die Glocke zu ↺; in der Liste steht oben „Neue Version verfügbar“.</li>
<li><b>„Fix ist live“</b> an die meldende Person mit „Gelöst“ / „Noch nicht gelöst“ (3 = A); erst „↺ Neu laden“, solange die Seite eine neue Version kennt. Die übrigen Betreiber sehen es zur Info.</li>
<li>Die OPS-Nummer und „Alle Vorgänge“ führen in den Kanal. Abgefragt wird alle 60 s mit ETag; kein Push.</li>
</ul></div>

<h2>(a) Geschlossen und offen <span>· Rechner hell</span></h2>
<div class="row">${fig("a1", "Die Leiste: Glocke mit Zahl vor der Person (doppelte Dichte).", 0.75)}</div>
<div class="row">${fig("a2", "Die Klappe (doppelte Dichte): „Fix ist live“ mit Kurztitel und den zwei Knöpfen, „übernommen“ von Claudia, darunter ein erledigter Fix mit dem Stand „Abgenommen von Thomas“.", 1)}</div>
<div class="row">${fig("a3", "Echte Größe.")}</div>

<h2>(b) „Fix ist live“ <span>· die Stände</span></h2>
<div class="row">
${fig("b1", "Mit neuer Version: oben der Systemeintrag, beim Fix erst „↺ Neu laden“.")}
${fig("b2", "„Noch nicht gelöst“: der Kommentar an der Stelle.")}
${fig("b3", "Nach „Gelöst“: der Stand statt der Knöpfe.")}
</div>

<h2>(c) Neue Version am Rechner <span>· echte Größe, Stand WI-0146</span></h2>
<div class="row">${fig("c1", "Seit WI-0146 trägt die Glocke das selbst: Der Knopf wird zur Pille „✦ Neue Version“. Der eigene Kasten daneben ist entfallen.")}</div>

<h2>(d) Leer <span>· echte Größe</span></h2>
<div class="row">${fig("d1", "Ohne Einträge. Scheitert die Abfrage, steht dort der rote Satz mit „↺ Erneut versuchen“.")}</div>

<h2>(e) Dunkel <span>· echte Größe</span></h2>
<div class="row">${fig("e1", "Offen, dunkel.")}</div>

<h2>(f) Telefon <span>· Pixel 7</span></h2>
<div class="row">
${fig("f1-hell", "Neue Version: die Glocke wird zu ↺")}
${fig("f2-hell", "Offen über die ganze Breite")}
${fig("f1-dunkel", "Dunkel")}
${fig("f2-dunkel", "Dunkel, offen")}
</div>

<p class="quellen">Quellen: project-control/planning/NACHRICHT-0001-benachrichtigungen-bauplan.md §1, §3, §4 · Abnahme „1B 2A 3A“ (Betreiber 2026-10-11) · Mockup review/wi-0136/blatt.png ·
Bauteile apps/web/src/auth/app-glocke.vue, benachrichtigung-eintrag.vue; Migration 0107. Erzeugt mit npm run review:benachrichtigungen (apps/web/e2e/benachrichtigungen-review.spec.ts).</p>
</body></html>`;
}
