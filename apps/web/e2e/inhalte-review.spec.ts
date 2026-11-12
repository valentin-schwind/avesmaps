import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AdminContentSwitches } from "@avesmaps3d/shared";
import { inhalteServer, inhalteStand } from "./inhalte-stub.ts";
import { openMap } from "./map-handle.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Inhalte“ (WI-0127 SYS-10 Teil a und b, SYS-0001 §3.4, §6.4, §6.6; gebaut nach Blatt WI-0119 A2, A5, Z8). Teil b: Zahlen je
 * Bilder-Schalter (gezählt am Entwicklungsbestand 2026-10-11), „Wirkung noch nicht überall angekommen“ und was Besucher sehen (Gareth auf
 * der echten Karte, der Stand der Schalter als Nachbau von `GET /api/content-state`; braucht den lokalen Stapel hinter Vite).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor. Die Prüfungen stehen in `test/inhalte.test.ts`, `e2e/inhalte.spec.ts` und auf dem
 * Server in `inhaltsschalter.test.ts`.
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-10-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode"];

test.use({ actionTimeout: 30_000 });

/** Die Zahlen des Entwicklungsbestands (2026-10-11, `zahlenJeSchalter`): Bilder, die Besucher je Schalter sehen. */
const ZAHLEN: Readonly<Record<string, number>> = {
    "media.role.coat": 481,
    "media.role.header": 101,
    "media.role.map_preview": 368,
    "media.role.literature_cover": 1534,
    "media.role.photobox": 0,
    "media.role.social_post": 0,
    "media.rights.permission": 5,
    "media.rights.fan_policy": 1897,
    "media.rights.own_work": 115,
    "media.rights.public_domain": 467,
    "media.rights.unclear": 15,
};

/** Vier Schalter aus: Kartenvorschauen, „Ungeklärt“, Literatur und Fauna; die Dateien sind noch unterwegs. */
const AUS = ["media.role.map_preview", "media.rights.unclear", "panel.literature", "panel.lore.fauna"];

function blattStand(): AdminContentSwitches {
    const stand = inhalteStand();
    const aus = new Date(Date.now() - 16 * 3_600_000).toISOString();
    for (const row of stand.rows) {
        if (row.key.startsWith("media.")) row.visible = ZAHLEN[row.key] ?? 0;
        if (AUS.includes(row.key)) {
            row.enabled = false;
            row.changedAt = aus;
            row.changedBy = "Rondrikan";
            if (row.key.startsWith("media.")) {
                row.hidden = row.visible ?? 0;
                row.visible = 0;
            }
        }
    }
    return { ...stand, pending: true };
}

/** Der Stand der Schalter für Besucher, als Nachbau des öffentlichen Lesepfads. */
async function stand(page: Page, off: readonly string[]): Promise<void> {
    await page.route("**/api/content-state", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { etag: '"c9-database"', "cache-control": "no-cache" },
            body: JSON.stringify({ revision: 9, off }),
        }),
    );
}

/** Was Besucher sehen: dieselben vier Schalter aus, Gareth im Infopanel. */
async function besucher(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, ...options });
    const page = await context.newPage();
    await stand(page, AUS);
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), {
        kind: "place",
        id: "80558060-4299-54aa-b520-814b10819885",
    });
    await page.getByTestId("info-catalog-paused").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(900);
    return { page, close: () => context.close() };
}

async function open(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    capabilities: string[] = OPERATOR,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    const server = inhalteServer(blattStand());
    await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("manage_system_settings") ? "operator" : "admin",
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    const touch = options.hasTouch === true;
    const tap = async (testid: string): Promise<void> => {
        const target = page.getByTestId(testid);
        if (touch) await target.tap();
        else await target.click();
    };
    await tap("kopfleiste-menue");
    await tap("menue-systemsteuerung");
    await page.getByRole("dialog", { name: "Systemsteuerung" }).waitFor();
    if (touch) {
        await page
            .getByTestId("verwaltung-auswahl")
            .getByRole("combobox", { name: "Bereiche der Verwaltung" })
            .selectOption("inhalte");
    } else {
        await page.getByTestId("verwaltung-eintrag-inhalte").click();
    }
    await page.getByTestId("inhalte-art").waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;

test("Abnahmeblatt: Inhalte (SYS-10 Teil a und b)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};

    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" });
        shots["a"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, {
            colorScheme: "light",
            viewport: { width: 1280, height: 2400 },
        });
        const inhalt = page.getByTestId("inhalte");
        await inhalt.evaluate((element) => {
            for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (/(auto|scroll|hidden)/u.test(style.overflowY) || style.maxHeight !== "none") {
                    node.style.overflow = "visible";
                    node.style.maxHeight = "none";
                    node.style.height = "auto";
                }
            }
        });
        await page.waitForTimeout(300);
        shots["b"] = await inhalt.screenshot();
        // Das Kästchen in doppelter Dichte: an, aus, gesperrt kommt aus (d).
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, ADMIN_CAPABILITIES);
        shots["c"] = await page.getByTestId("inhalte-art").screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "dark" });
        shots["d"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        shots["e"] = await page.screenshot();
        await close();
    }
    {
        // Besucher: Gareth mit ausgeblendeter Literatur und Fauna, dazu die Hinweise mit „Gerade pausiert“.
        const { page, close } = await besucher(browser, baseURL, { colorScheme: "light" });
        shots["f"] = await page.screenshot();
        await page.locator('[data-section="literature"]').scrollIntoViewIfNeeded();
        shots["g"] = await page.locator('[data-section="literature"]').screenshot();
        shots["h"] = await page.locator('[data-field="lore:fauna"]').screenshot();
        await page.getByTestId("notes-open").click();
        await page.getByTestId("notes-paused").waitFor();
        await page.waitForTimeout(400);
        shots["i"] = await page.getByTestId("notes").screenshot();
        await close();
    }
    {
        // Eine ausgeschaltete Serie: Der Fächer wechselt und sagt es.
        const context = await browser.newContext({
            baseURL,
            viewport: { width: 1280, height: 900 },
            colorScheme: "light",
        });
        const page = await context.newPage();
        await stand(page, ["map.series.modern"]);
        await openMap(page);
        await page.getByTestId("fan-series-paused").waitFor();
        await page.waitForTimeout(500);
        shots["j"] = await page.screenshot({ clip: { x: 880, y: 560, width: 400, height: 340 } });
        await context.close();
    }
    {
        // SYS-11: Reiseberechnung und 3D-Gelände pausiert.
        const context = await browser.newContext({
            baseURL,
            viewport: { width: 1280, height: 900 },
            colorScheme: "light",
        });
        const page = await context.newPage();
        await stand(page, ["route.compute", "map.terrain3d"]);
        await openMap(page);
        await page.getByTestId("planner-paused").waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        shots["l"] = await page.screenshot({ clip: { x: 0, y: 0, width: 360, height: 300 } });
        await page.getByTestId("display-open").click();
        await page.getByTestId("display-terrain-paused").waitFor();
        await page.getByTestId("display-terrain-paused").hover();
        await page.waitForTimeout(900);
        shots["m"] = await page.getByTestId("display-menu").screenshot();
        await context.close();
    }
    {
        const { page, close } = await besucher(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        await page.locator('[data-section="literature"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        shots["k"] = await page.screenshot();
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
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Inhalte in der Systemsteuerung (SYS-10 und SYS-11), gebaut: Schalter und ihre Wirkung</h1>
<p class="lead">WI-0127 SYS-10 · Bauplan SYS-0001 §3.4, §6.4, §6.6 · gebaut nach Blatt WI-0119 A2, A5, Z8 · Aus: Kartenvorschauen, „Ungeklärt“,
Literatur, Fauna. Zahlen gezählt am Entwicklungsbestand (11.10.); die Besucherbilder zeigen Gareth auf der echten Karte.</p>

<h2>(a) Eintrag „Inhalte“, Rechner, hell, echte Größe <span>· Zahlen je Schalter, „368 ausgeblendet seit …“, Dateien unterwegs</span></h2>
${img("a")}

<h2>(b) Der ganze Inhalt <span>· Bilder nach Art, Notaus nach Rechten (zwei Listen), Infopanel mit Vorkommen je Art, Karte</span></h2>
${img("b", 900)}

<h2>(c) Ein Admin ohne „Systemschalter“ <span>· Kästchen gesperrt, der Satz steht einmal oben</span></h2>
${img("c", 900)}

<h2>(d) Dunkel</h2>
${img("d", 960)}

<h2>(e) Telefon <span>· Pixel 7: die Spalte „Was Besucher dann sehen“ entfällt, die Listen untereinander</span></h2>
${img("e", 412)}

<h2>(f) Was Besucher sehen, echte Größe <span>· Gareth: Literatur und Fauna ausgeblendet, Kartensammlung bleibt</span></h2>
${img("f")}

<h2>(g) Abschnitt „Literatur“ <span>· der Satz an der Stelle der Liste, ohne Zahl im Kopf, ohne Kacheln</span></h2>
${img("g", 420)}

<h2>(h) Vorkommenszeile „Fauna“ <span>· die Zeile bleibt, mit Satz statt Deckel</span></h2>
${img("h", 420)}

<h2>(i) Hinweise <span>· „Gerade pausiert: …“ unter den Kacheln (das Info-Menü der Karte)</span></h2>
${img("i", 640)}

<h2>(j) Kartenserie „Modern“ aus <span>· der Fächer wechselt auf „Original“ und sagt es acht Sekunden lang</span></h2>
${img("j", 400)}

<h2>(k) Telefon, Besucher <span>· Pixel 7</span></h2>
${img("k", 412)}

<h2>(l) SYS-11: Reiseberechnung pausiert <span>· der Satz oben im Planer; Wegpunkte suchen geht weiter, die Route antwortet 503 feature_paused</span></h2>
${img("l", 360)}

<h2>(m) SYS-11: 3D-Gelände pausiert <span>· gesperrte Zeile im Auge-Menü, der Satz als Sperrgrund (wie „Grenzen“); die Karte bleibt flach</span></h2>
${img("m", 360)}

<p class="note"><b>Worauf zu achten ist:</b> Die Sätze sind die des Eintrags (Blatt A2). „Gerade pausiert“ steht in den Hinweisen, weil
es ein eigenes Info-Menü der Karte nicht gibt. Die Dateien ausgeblendeter Bilder wandern nach private/quarantine/ und zurück; solange das
läuft, steht oben „Wirkung noch nicht überall angekommen“. SYS-11: Reiseberechnung und 3D-Gelände stehen unter „Karte“ im Eintrag; ein Editor
sieht ausgeblendete Abschnitte echt, mit dem Vermerk „öffentlich ausgeblendet“.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const teile = process.env["SHOTS_DIR"];
    if (teile !== undefined) {
        mkdirSync(teile, { recursive: true });
        for (const [key, shot] of Object.entries(shots)) writeFileSync(resolve(teile, `${key}.png`), shot);
    }
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__inhalte.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__inhalte.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-10-blatt.png"), fullPage: true });
    await sheetContext.close();
});
