import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { stubBenachrichtigungen } from "./benachrichtigungen-stub.ts";
import { stubKanal } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Versionen, gebaut“ (WI-0137, VERSION-0001 V1 bis V4). Anders als die abgenommenen Mockup-Blätter (`review/wi-0137/blatt.png`
 * und `blatt-2.png`) zeigt es die GEBAUTE Oberfläche: echte Systemsteuerung und Kopfleiste auf der echten Karte, Sitzung aus
 * `verwaltung-stub.ts` (Stage, „Rondrikan“ als Betreiber), die Release-Notizen aus `config/releases/` (der Nachtrag, echt). „Neue Version“
 * löst der Lauf wie `neue-version.spec.ts` aus. Die Kurzinfo ist ein BEISPIEL (der Nachtrag hat keine, Vorgabe der Koordination); die echte
 * schreibt die Koordination beim Release-Schnitt.
 *
 * 💣 Dieser Lauf prüft NICHTS; die Zusicherungen stehen in `versionen.spec.ts`, `neue-version.spec.ts`, `kanal.spec.ts` und den Servertests.
 *
 *   npm run review:versionen
 *
 * Ablage: `review/wi-0137/blatt-3.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0137");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];

/** Beispiel aus der Übergabe des Release `df6f840c` (summary und „Bekannte Auswirkungen für Stage-Tester“), in einfacher Sprache. */
const BEISPIEL = {
    stand: "2026-10-11T04:45:00+02:00",
    abschnitte: [
        {
            titel: "Anschauen",
            punkte: [
                "Zoomstufe 8: Die Karte zoomt eine Stufe näher heran; im Editor steht die Zoomstufe unter dem Steuerring.",
                "Prüfhaken im Auge (nur Editoren), zum Beispiel „Wege treffen sich nicht“.",
            ],
        },
        {
            titel: "Prüfen",
            punkte: [
                "Routen: Der Routenplaner rechnet jetzt ohne Kreuzungen. Drei Kutschenreisen finden keine Route, bis die Wegenden repariert sind; neun Reisen werden deutlich länger.",
            ],
        },
        { titel: "Beachten", punkte: ["Ortseditor: Bearbeiten bleibt auf Stage aus."] },
    ],
};

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
    sitzung: { capabilities?: string[]; role?: string; kurzinfo?: unknown } = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.5.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: sitzung.capabilities ?? BETREIBER, role: sitzung.role ?? "operator" });
    await stubKanal(page);
    await stubBenachrichtigungen(page, []);
    const kurzinfo = sitzung.kurzinfo ?? BEISPIEL;
    await page.route("**/api/version/kurzinfo", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(kurzinfo) }),
    );
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("kopfleiste").waitFor();
    // Der Hinweis zur Kamera gehört nicht aufs Blatt.
    const hinweis = page.getByTestId("camera-hint-close");
    if (await hinweis.isVisible().catch(() => false)) await hinweis.evaluate((knopf) => (knopf as HTMLElement).click());
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

async function versionenOeffnen(page: Page, tippen = false): Promise<void> {
    const menue = page.getByTestId("kopfleiste-menue");
    await (tippen ? menue.tap() : menue.click());
    const eintrag = page.getByTestId("menue-systemsteuerung");
    await (tippen ? eintrag.tap() : eintrag.click());
    await page.getByRole("dialog", { name: "Systemsteuerung" }).waitFor();
    if (tippen)
        await page
            .getByTestId("verwaltung-auswahl")
            .getByRole("combobox", { name: "Bereiche der Verwaltung" })
            .selectOption("versionen");
    else await page.getByTestId("verwaltung-eintrag-versionen").click();
    await page.getByTestId("versionen-kopf").waitFor();
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

test("Abnahmeblatt: Versionen, gebaut (WI-0137 V1 bis V4)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const KNOPF = '[data-testid="glocke-knopf"]';
    const KLAPPE = '[data-testid="glocke-klappe"]';

    // (a) Systemsteuerung › Versionen, Rechner hell, echte Größe: oben, mit Doku, ein früheres Release aufgeklappt.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await versionenOeffnen(page);
        await ruhe(page);
        merke("a1", await page.screenshot(), 1);
        await page.getByTestId("versionen-doku").click();
        await page.getByTestId("versionen-zeile-df6f840c").waitFor();
        await page.getByTestId("versionen-zeile-df6f840c").scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("a2", await page.screenshot(), 1);
        await page.getByTestId("versionen-doku").click();
        await page.getByTestId("versionen-frueher-2026-10-10-557c6d11").click();
        await page.getByTestId("versionen-liste-2026-10-10-557c6d11").waitFor();
        await page.getByTestId("versionen-frueher").scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("a3", await page.screenshot(), 1);
        await close();
    }

    // (b) Dunkel.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "dark" });
        await versionenOeffnen(page);
        await ruhe(page);
        merke("b1", await page.screenshot(), 1);
        await close();
    }

    // (c) Pille und Kurzinfo an der Glocke (seit WI-0146 ein Bauteil), doppelte Dichte: zu, offen mit Beispiel, ohne Kurzinfo und ohne `view_operations`.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        await neueVersion(page);
        await ruhe(page);
        merke("c1", await page.screenshot({ clip: await rahmen(page, [KNOPF], 8) }), 2);
        await page.getByTestId("glocke-knopf").click();
        await page.locator(KLAPPE).waitFor();
        await ruhe(page);
        merke("c2", await page.screenshot({ clip: await rahmen(page, [KNOPF, KLAPPE], 10) }), 2);
        await close();
    }
    {
        const { page, close } = await oeffne(
            browser,
            baseURL,
            { colorScheme: "light", deviceScaleFactor: 2 },
            {
                role: "editor",
                capabilities: ["use_editor_menu", "view_editor_series"],
                kurzinfo: { stand: BEISPIEL.stand, abschnitte: [] },
            },
        );
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").click();
        await page.locator(KLAPPE).waitFor();
        await ruhe(page);
        merke("c3", await page.screenshot({ clip: await rahmen(page, [KNOPF, KLAPPE], 10) }), 2);
        await close();
    }
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "dark" });
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").click();
        await page.locator(KLAPPE).waitFor();
        await ruhe(page);
        merke("c4", await page.screenshot({ clip: await rahmen(page, [KNOPF, KLAPPE], 10) }), 1);
        await close();
    }

    // (d) Kanal: Commits als Link in Nachweis-Leiste und Fix-Bericht.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await page.getByTestId("kopfleiste-menue").click();
        await page.getByTestId("menue-systemsteuerung").click();
        await page.getByTestId("verwaltung-eintrag-claudio").click();
        await page.getByTestId("kanal-reiter-abnahme").click();
        await page.getByTestId("kanal-zeile-OPS-000127").click();
        await page.getByTestId("kanal-nachweise").waitFor();
        await ruhe(page);
        merke("d1", await page.screenshot({ clip: await rahmen(page, ['[data-testid="kanal-nachweise"]'], 8) }), 1);
        await page.getByTestId("kanal-fixbericht").scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("d2", await page.screenshot({ clip: await rahmen(page, ['[data-testid="kanal-fixbericht"]'], 8) }), 1);
        await close();
    }

    // (e) Telefon (Pixel 7): Versionen als Karten; die Glocke mit der Kurzinfo im Eintrag; hell und dunkel.
    for (const thema of ["hell", "dunkel"] as const) {
        const { page, close } = await oeffne(browser, baseURL, {
            ...devices["Pixel 7"],
            colorScheme: thema === "hell" ? "light" : "dark",
        });
        if (thema === "hell") {
            await versionenOeffnen(page, true);
            await ruhe(page);
            merke("e1", await page.screenshot({ scale: "css" }), 1);
            await page.getByTestId("verwaltung-schliessen").tap();
        }
        await neueVersion(page);
        await page.getByTestId("glocke-knopf").getByText("↺").waitFor();
        await page.getByTestId("glocke-knopf").tap();
        await page.getByTestId("benachrichtigung-version").getByTestId("kurzinfo").waitFor();
        await ruhe(page);
        merke(`e2-${thema}`, await page.screenshot({ scale: "css" }), 1);
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1484, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__versionen.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: blatt(baseURL) }),
    );
    await sheet.goto("/__versionen.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt-3.png"), fullPage: true });
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

<h1>Versionen · gebaut (WI-0137, VERSION-0001 V1 bis V4)</h1>
<p class="lead">Die gebaute Oberfläche, nicht mehr das Mockup: echte Systemsteuerung und Kopfleiste auf der echten Karte, Stage, angemeldet „Rondrikan“ als Betreiber. Die
Release-Notizen sind der echte Nachtrag aus <code>config/releases/</code> (sechs Releases, laufend <code>df6f840c</code>). Die Kurzinfo ist ein Beispiel; der Nachtrag hat keine.
Rechner 1280 × 900, Kasten und Kurzinfo in doppelter Dichte, Telefon Pixel 7.</p>
<div class="box"><b>Kurz gesagt</b><ul>
<li><b>Systemsteuerung › Versionen</b> (nur mit <code>view_operations</code>): das laufende Release mit Commit, Release-ID, Titel und Zahlen, die Änderungen je Arbeitspaket, „Sonstiges“ zuletzt; Doku erst hinter „Auch Doku zeigen“ (1 B). Frühere Releases zugeklappt.</li>
<li><b>✦ statt „Neue Version“</b> (A): öffnet die Kurzinfo „Was ist neu?“ mit Anschauen · Prüfen · Beachten, „Alle Änderungen“ und „↺ Neu laden“. Ohne geschriebene Kurzinfo nur „↺ Neu laden“.</li>
<li><b>Telefon</b> (A): Die Glocke wird bei neuer Version zu ↺; ihr Eintrag „Neue Version verfügbar“ trägt die Kurzinfo, „↺ Neu laden“ und „Alle Änderungen“.</li>
<li><b>Commits sind Links auf GitHub</b>, überall aus der SHA gebaut: in Versionen, in der Nachweis-Leiste, im Fix-Bericht und in „Fix-Berichte“.</li>
<li>Abweichung vom Blatt 2: „Alle Änderungen“ ohne ↗, weil es ein Fenster öffnet und die Seite nicht verlässt (Hausregel).</li>
</ul></div>

<h2>(a) Systemsteuerung › Versionen <span>· Rechner hell, echte Größe</span></h2>
<div class="row">${fig("a1", "Das laufende Release oben, die Änderungen je Arbeitspaket, Siegel für Claudia und Claudio.")}</div>
<div class="row">
${fig("a2", "Mit „Auch Doku zeigen“: die Doku-Commits stehen dazwischen, „Sonstiges“ wird lang.", 0.5)}
${fig("a3", "Ein früheres Release aufgeklappt (lädt seine Commits einmal).", 0.5)}
</div>

<h2>(b) Dunkel <span>· echte Größe</span></h2>
<div class="row">${fig("b1", "Dunkel.", 0.75)}</div>

<h2>(c) ✦ und die Kurzinfo <span>· doppelte Dichte, auf echte Größe gesetzt</span></h2>
<div class="row">
${fig("c1", "Neue Version: die Pille „✦ Neue Version“ am Glockenknopf (seit WI-0146 ein Bauteil).")}
</div>
<div class="row">
${fig("c2", "Offen: die Kurzinfo im Eintrag „Neue Version verfügbar“ (Beispieltext), darunter „↺ Neu laden“ und „Alle Änderungen“.")}
${fig("c3", "Ohne geschriebene Kurzinfo, als Editor ohne <code>view_operations</code>: nur „↺ Neu laden“.")}
${fig("c4", "Dunkel.")}
</div>

<h2>(d) Kanal <span>· Commits als Link</span></h2>
<div class="row">
${fig("d1", "Die Nachweis-Leiste: „Fix committed“ und „Claudia nachgeprüft“ mit dem Commit als Link.")}
${fig("d2", "Der Fix-Bericht mit dem Commit als Link.")}
</div>

<h2>(e) Telefon <span>· Pixel 7</span></h2>
<div class="row">
${fig("e1", "Versionen als Karten (zwei Zeilen je Änderung)")}
${fig("e2-hell", "Neue Version: die Glocke (↺) mit der Kurzinfo im Eintrag")}
${fig("e2-dunkel", "Dunkel")}
</div>

<p class="quellen">Quellen: project-control/planning/VERSION-0001-versionen-bauplan.md §1 bis §4 · Abnahmen WI-0137 §3a und §3b (Betreiber 2026-10-11: 1 B, ✦ = A, Telefon = A) ·
Mockups review/wi-0137/blatt.png und blatt-2.png · Bauteile apps/web/src/auth/verwaltung-versionen.vue, versionen-liste.vue, kurzinfo-ansicht.vue, app-glocke.vue,
commit-verweis.vue; Server apps/server/src/versionen/, routes/versionen.ts; Werkzeug npm run release:notizen. Erzeugt mit npm run review:versionen (apps/web/e2e/versionen-review.spec.ts).</p>
</body></html>`;
}
