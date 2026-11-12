import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { benachrichtigungen, stubBenachrichtigungen } from "./benachrichtigungen-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „eine Glocke, gebaut“ (WI-0146, Variante C; Betreiber 2026-10-15 „A, A, ja“). Anders als das Mockup-Blatt
 * (`review/wi-0146/blatt.png`, erzeugt aus einem Umbau im Browser) zeigt es die GEBAUTE Fassung: Glocke und der frühere Kasten
 * „Neue Version“ sind ein Bauteil. Echte Kopfleiste auf der echten Karte, Sitzung aus `verwaltung-stub.ts` (Stage, „Rondrikan“ als
 * Betreiber), Einträge aus `benachrichtigungen-stub.ts` (erfunden), Kurzinfo aus den echten Release-Notizen in `config/releases/`.
 *
 * 💣 Dieser Lauf prüft NICHTS über die Anwendung; die Wächter darin bewachen das Bild. Die Zusicherungen stehen in
 * `neue-version.spec.ts` und `glocke.spec.ts`.
 *
 *   npm run review:eine-glocke
 *
 * Ablage: `review/wi-0146/blatt-2.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0146");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];
const KLAPPE = '[data-testid="glocke-klappe"]';
const KNOPF = '[data-testid="glocke-knopf"]';

// Die Karte mit Gelände wie beim Betreiber: headless ohne Schalter ist SwiftShader, und die App lässt sie dann flach.
test.use({ actionTimeout: 30_000, launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

interface Bild {
    buf: Buffer;
    dichte: number;
}
const shots: Record<string, Bild> = {};
const merke = (key: string, buf: Buffer, dichte: number): void => {
    shots[key] = { buf, dichte };
};

interface Lage {
    /** Ohne geschriebene Kurzinfo zeigt die Klappe nur „↺ Neu laden“. */
    ohneKurzinfo?: boolean;
    /** Eine Quelle ungespeicherter Arbeit anmelden; „Neu laden“ fragt dann nach. */
    ungespeichert?: boolean;
}

async function oeffne(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    lage: Lage = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.6.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: BETREIBER, role: "operator" });
    await stubBenachrichtigungen(page, benachrichtigungen());
    if (lage.ohneKurzinfo === true)
        await page.route("**/api/version/kurzinfo", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ stand: "2026-10-12T21:40:00+02:00", abschnitte: [] }),
            }),
        );
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    if (lage.ungespeichert === true)
        await page.evaluate(() => {
            (globalThis as { __avesmapsUngespeichert?: (q: () => boolean) => void }).__avesmapsUngespeichert?.(
                () => true,
            );
        });
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
    await page.getByTestId("glocke-knopf").waitFor();
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

test("Abnahmeblatt: eine Glocke statt Kasten und Glocke, gebaut (WI-0146)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    // (a) Die Zustände des einen Knopfes, doppelte Dichte.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        await ruhe(page);
        merke("a0", await page.screenshot({ clip: await rahmen(page, [KNOPF], 8) }), 2);
        await neueVersion(page);
        await ruhe(page);
        merke("a1", await page.screenshot({ clip: await rahmen(page, [KNOPF], 8) }), 2);
        await page.getByTestId("glocke-knopf").hover();
        await page.waitForTimeout(300);
        merke("a2", await page.screenshot({ clip: await rahmen(page, [KNOPF], 8) }), 2);
        const sichtbar = await page
            .getByTestId("glocke-knopf")
            .evaluate((el: HTMLElement) => (el.focus(), el.matches(":focus-visible")));
        if (!sichtbar) throw new Error("kein sichtbarer Fokus am Knopf");
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        merke("a3", await page.screenshot({ clip: await rahmen(page, [KNOPF], 8) }), 2);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").getByTestId("kurzinfo").waitFor();
        await ruhe(page);
        merke("a4", await page.screenshot({ clip: await rahmen(page, [KNOPF], 8) }), 2);
        merke("b1", await page.screenshot({ clip: await rahmen(page, [KLAPPE]) }), 2);
        await close();
    }

    // (b) Die eine Klappe in echter Größe, auf der echten Karte.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").getByTestId("kurzinfo").waitFor();
        await ruhe(page);
        merke("b2", await page.screenshot(), 1);
        await close();
    }

    // (c) Ohne geschriebene Kurzinfo nur „↺ Neu laden“; mit ungespeicherter Arbeit die eine Rückfrage.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" }, { ohneKurzinfo: true });
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").waitFor();
        await ruhe(page);
        merke("c1", await page.screenshot({ clip: await rahmen(page, [KLAPPE]) }), 1);
        await close();
    }
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" }, { ungespeichert: true });
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("glocke-neu-laden").click();
        await page.getByTestId("glocke-trotzdem").waitFor();
        await ruhe(page);
        merke("c2", await page.screenshot({ clip: await rahmen(page, [KLAPPE]) }), 1);
        await close();
    }

    // (d) Dunkel, echte Größe.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "dark" });
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").getByTestId("kurzinfo").waitFor();
        await ruhe(page);
        merke("d1", await page.screenshot(), 1);
        await close();
    }

    // (e) Telefon: dort ist alles wie vorher, die Glocke trug schon immer alles.
    for (const thema of ["hell", "dunkel"] as const) {
        const { page, close } = await oeffne(browser, baseURL, {
            ...devices["Pixel 7"],
            colorScheme: thema === "hell" ? "light" : "dark",
        });
        await neueVersion(page);
        await ruhe(page);
        if (thema === "hell") merke("e0", await page.screenshot({ scale: "css" }), 1);
        await page.getByTestId("glocke-knopf").click();
        await page.getByTestId("benachrichtigung-version").getByTestId("kurzinfo").waitFor();
        await ruhe(page);
        merke(`e1-${thema}`, await page.screenshot({ scale: "css" }), 1);
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1484, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__eine-glocke.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: blatt(baseURL) }),
    );
    await sheet.goto("/__eine-glocke.html");
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
figcaption { display: table-caption; caption-side: bottom; margin: 5px 0 0; font-size: 12px; color: ${colour["textMuted"]}; max-width: 420px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; }
.box { padding: 10px 16px; border: 1px solid ${colour["successSoftBorder"]}; border-radius: 8px; background: ${colour["successSoft"]}; font-size: 13px; }
.box ul { margin: 4px 0 0; padding-left: 18px; }
.quellen { margin-top: 26px; font-size: 11px; color: ${colour["textMuted"]}; max-width: 1340px; }
</style></head><body>

<h1>Eine Glocke statt Kasten und Glocke · gebaut (WI-0146)</h1>
<p class="lead">Die gebaute Fassung, nicht mehr das Mockup. Der Kasten „✦ · ↺ Neu laden“ ist entfallen; bei einer neuen Version wächst der Glockenknopf am Rechner zur Pille „✦ Neue Version“ mit Glocke
und Zahl darin, und seine eine Klappe trägt oben die Kurzinfo „Was ist neu?“. Echte Kopfleiste auf der echten Karte, Stage, angemeldet „Rondrikan“ als Betreiber; Einträge erfunden, Kurzinfo aus den
echten Release-Notizen. Rechner 1280 × 900, die Leiste in doppelter Dichte, Telefon Pixel 7.</p>
<div class="box"><b>Was anders ist als vorher</b><ul>
<li><b>Ein Knopf, eine Klappe, eine Rückfrage.</b> Vorher standen Kasten und Glocke nebeneinander, beide mit „↺ Neu laden“ und eigener Rückfrage.</li>
<li><b>Die Kurzinfo steht im Eintrag</b> — am Rechner jetzt genauso wie am Telefon; „Alle Änderungen“ ebenso.</li>
<li><b>Ohne neue Version ist nichts anders:</b> Glocke mit Zahl wie bisher. Am Telefon ändert sich gar nichts.</li>
<li><code>neue-version-kasten.vue</code> ist entfernt; die Versionsprüfung startet jetzt die Glocke.</li>
</ul></div>

<h2>(a) Die Zustände des einen Knopfes <span>· Mindestliste §30.5, doppelte Dichte</span></h2>
<div class="row">
${fig("a0", "Ruhe ohne neue Version: unverändert.", 0.9)}
${fig("a1", "Ruhe mit neuer Version: die Pille.", 0.9)}
${fig("a2", "Hover.", 0.9)}
${fig("a3", "Tastaturfokus.", 0.9)}
${fig("a4", "Offen (wie gedrückt).", 0.9)}
</div>

<h2>(b) Die eine Klappe <span>· Nahaufnahme und echte Größe</span></h2>
<div class="row">${fig("b1", "Oben „Neue Version verfügbar“ mit der Kurzinfo „Anschauen · Prüfen · Beachten“, darunter „↺ Neu laden“ und „Alle Änderungen“; dann die Benachrichtigungen aus dem Kanal.", 1)}</div>
<div class="row">${fig("b2", "Echte Größe auf der Karte.")}</div>

<h2>(c) Grenzfälle <span>· echte Größe</span></h2>
<div class="row">
${fig("c1", "Ohne geschriebene Kurzinfo steht nur „↺ Neu laden“.")}
${fig("c2", "Mit ungespeicherter Bearbeitung fragt „Neu laden“ nach — nur noch an dieser einen Stelle.")}
</div>

<h2>(d) Dunkel <span>· echte Größe</span></h2>
<div class="row">${fig("d1", "Offen, dunkel.")}</div>

<h2>(e) Telefon <span>· Pixel 7, unverändert</span></h2>
<div class="row">
${fig("e0", "Die Glocke wird zu ↺, wie bisher.")}
${fig("e1-hell", "Offen: der Eintrag trägt die Kurzinfo.")}
${fig("e1-dunkel", "Dunkel, offen.")}
</div>

<p class="quellen">Quellen: project-control/work-items/WI-0146-eine-glocke.md · Mockup-Blatt review/wi-0146/blatt.png, abgenommen 2026-10-15 („A, A, ja“) · NACHRICHT-0001 §1 und §3.3 · VERSION-0001 §4 ·
Bauteile apps/web/src/auth/app-glocke.vue, kurzinfo-ansicht.vue, app-kopfleiste.vue; Kurzinfo aus config/releases/. Erzeugt mit npm run review:eine-glocke (apps/web/e2e/eine-glocke-review.spec.ts).</p>
</body></html>`;
}
