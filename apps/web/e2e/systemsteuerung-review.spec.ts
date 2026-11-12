import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Kontenverwaltung und Systemsteuerung“ (WI-0127 SYS-15, Bauplan SYS-0001 §9d; vorher an dieser Stelle das Blatt
 * „Verwaltung mit Schiene“, SYS-1, abgenommen).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/auth-verwaltung.test.ts`, `packages/shared/test/navigation.test.ts`, `e2e/verwaltung.spec.ts`, `e2e/verwaltung.touch.spec.ts`
 * und `apps/server/test/system-protokollpflicht.test.ts`.
 *
 * Gezeigt werden beide Fenster auf der ECHTEN Karte: das Hauptmenü mit den zwei Einträgen in doppelter Dichte, die Kontenverwaltung
 * und die Systemsteuerung am Rechner hell in echter Größe (1280 × 900), das Protokoll der Systemsteuerung als Betreiber (mit „Alles,
 * auch Konten“) und die Systemsteuerung am Telefon. Sitzung und Verwaltungs-API kommen aus `verwaltung-stub.ts` (erfundene Personen,
 * Stage); die Karte dahinter aus dem laufenden Stapel.
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-15-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner, etwa den des
 * Hauptcheckouts aus einem Worktree heraus.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "run_legacy_sync"];

interface Opened {
    page: Page;
    close: () => Promise<void>;
}

async function open(browser: Browser, baseURL: string, options: BrowserContextOptions): Promise<Opened> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: OPERATOR, role: "operator" });
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, close: () => context.close() };
}

/** Öffnet ein Fenster über das Hauptmenü und wartet, bis es steht. */
async function fenster(page: Page, welches: "kontenverwaltung" | "systemsteuerung", touch = false): Promise<void> {
    const menu = page.getByTestId("kopfleiste-menue");
    if (touch) await menu.tap();
    else await menu.click();
    const entry = page.getByTestId(`menue-${welches}`);
    if (touch) await entry.tap();
    else await entry.click();
    await page.getByTestId(`${welches}-fenster`).waitFor();
    if (welches === "kontenverwaltung") await page.getByTestId("personen-summe").waitFor({ timeout: 15_000 });
    else await page.getByTestId("betrieb-kurzstatus").waitFor({ timeout: 15_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;

test("Abnahmeblatt: Kontenverwaltung und Systemsteuerung (SYS-15)", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};

    // (a) Das Hauptmenü in doppelter Dichte: die Gruppe „Nur Verwaltung“ mit den zwei Einträgen, der zweite unter dem Zeiger.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        await page.getByTestId("kopfleiste-menue").click();
        await page.getByTestId("menue-systemsteuerung").hover();
        await page.waitForTimeout(400);
        shots["a"] = await page.getByTestId("hauptmenue").screenshot();
        await close();
    }

    // (b) Kontenverwaltung und (c) Systemsteuerung: Rechner hell, echte Größe.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" });
        await fenster(page, "kontenverwaltung");
        shots["b"] = await page.screenshot();
        await page.getByTestId("verwaltung-schliessen").click();
        await fenster(page, "systemsteuerung");
        shots["c"] = await page.screenshot();
        // (d) Das Protokoll der Systemsteuerung als Betreiber: drei Gruppen des Systems und „Alles, auch Konten“.
        await page.getByTestId("verwaltung-eintrag-protokoll-system").click();
        await page.getByTestId("protokoll-tafel").waitFor();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);
        shots["d"] = await page.getByTestId("systemsteuerung-fenster").screenshot();
        await close();
    }

    // (e) Telefon: die Systemsteuerung mit der Auswahl in der Leiste.
    {
        const { page, close } = await open(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        await fenster(page, "systemsteuerung", true);
        shots["e"] = await page.screenshot();
        await close();
    }

    const colour = CANON.colour;
    const img = (key: string, width?: number): string =>
        `<img src="${png(shots[key] as Buffer)}" alt=""${width === undefined ? "" : ` style="width:${String(width)}px"`}>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1280px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 30px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; gap: 24px; align-items: flex-start; }
.row > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Kontenverwaltung und Systemsteuerung</h1>
<p class="lead">WI-0127 SYS-15 · Bauplan SYS-0001 §9d (Betreiber 2026-10-10: „Das Fenster „Verwaltung …“ wird geteilt“) · Stage, Personen und Protokoll erfunden
(Stub), Sitzung als Betreiber, Karte aus dem lokalen Stapel · Rechner hell in echter Größe (1280 × 900), das Menü doppelt, das Telefon.</p>

<div class="row">
<div><h2>(a) Hauptmenü <span>· doppelte Dichte, „Systemsteuerung …“ unter dem Zeiger</span></h2>${img("a", 360)}</div>
<div><h2>(d) Protokoll der Systemsteuerung <span>· als Betreiber</span></h2>${img("d", 860)}</div>
</div>

<h2>(b) Kontenverwaltung, hell, echte Größe <span>· „Personen &amp; Sicherheit“: Personen, Einladungen, Rollen &amp; Rechte, Protokoll der Konten</span></h2>
${img("b")}

<h2>(c) Systemsteuerung, hell, echte Größe <span>· die Schiene ist eine Liste ohne Gruppen, ohne Köpfe und ohne Trennlinien</span></h2>
${img("c")}

<h2>(e) Telefon <span>· Pixel 7 (412 × 915): die Systemsteuerung mit der Auswahl der Einträge in der Leiste</span></h2>
${img("e", 412)}

<p class="note"><b>Worauf zu achten ist:</b> Eine Änderung der Zuordnung, kein Umbau: Einträge, Kennungen und Rechte sind die von vorher, nur auf zwei Fenster
verteilt. Das Protokoll bleibt eine Tabelle; die Kontenverwaltung zeigt die Ereignisse der Konten, die Systemsteuerung die des Systems (Betrieb, Abgleiche,
Notzugang, Backups), für den Betreiber dort zusätzlich „Alles, auch Konten“. Wer nur Konten pflegt, sieht „Systemsteuerung …“ nicht. Alte Links
<code>?verwaltung=&lt;eintrag&gt;</code> öffnen das Fenster, das den Eintrag trägt. Seit dem 14.10. trägt die Schiene <b>keine Bereichsköpfe und keine
Trennlinien</b> mehr (Betreiber: „keine trennlinie, keine gruppierungen“): eine durchgehende Liste in der bisherigen Reihenfolge, am Telefon eine Auswahl ohne
vorangestellten Bereich. Damit erledigt sich die frühere offene Frage, dass der Bereich „Protokoll“ einen einzigen Eintrag gleichen Namens trug.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__systemsteuerung.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__systemsteuerung.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-15-blatt.png"), fullPage: true });
    await sheetContext.close();
});
