import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AdminSystemzustand } from "@avesmaps3d/shared";
import { ohneDatei, systemzustandAntwort, systemzustandStand } from "./systemzustand-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Systemzustand“ (WI-0127 SYS-8, SYS-0001 §6.3; gebaut nach Blatt WI-0119 A7, A9, Z7).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/systemzustand.test.ts`, `e2e/systemzustand.spec.ts` und auf dem Server in `systemzustand*.test.ts`.
 *
 * Gezeigt wird der Eintrag auf der ECHTEN Karte: am Rechner hell in echter Größe (Stage mit Claudios Statusdatei), der ganze Inhalt,
 * die vier Zustände einer Zeile, lokal ohne Statusdatei, dunkel und das Telefon. Stand aus dem Nachbau (`systemzustand-stub.ts`).
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-8-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

test.use({ actionTimeout: 30_000 });

async function open(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    stand: AdminSystemzustand = systemzustandStand(),
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: ADMIN_CAPABILITIES, answer: systemzustandAntwort(() => stand) });
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
            .selectOption("systemzustand");
    } else {
        await page.getByTestId("verwaltung-eintrag-systemzustand").click();
    }
    await page.getByTestId("systemzustand-komponenten").waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;

test("Abnahmeblatt: Systemzustand (SYS-8)", async ({ browser }, testInfo) => {
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
            viewport: { width: 1280, height: 2000 },
        });
        const inhalt = page.getByTestId("systemzustand");
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
        await close();
    }
    {
        // Die vier Zustände einer Zeile: gesund, Warnung (lädt), ausgefallen (kein Planer), unbekannt (Messwert fehlt).
        const stand = systemzustandStand();
        const vier: AdminSystemzustand = {
            ...stand,
            komponenten: stand.komponenten.map((entry) =>
                entry.id === "routing"
                    ? { ...entry, zustand: "warnung", hinweis: "warming" }
                    : entry.id === "jobs"
                      ? { ...entry, zustand: "ausgefallen", hinweis: "no_planner" }
                      : entry.id === "nginx"
                        ? { ...entry, zustand: "unbekannt", seit: null, hinweis: "stale" }
                        : entry,
            ),
            auslastung: {
                ...stand.auslastung,
                platten: [{ id: "/", quelle: "datei", gesamt: 232 * 1024 ** 3, frei: 21 * 1024 ** 3 }],
            },
        };
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, vier);
        shots["c"] = await page.getByTestId("systemzustand-komponenten").screenshot();
        shots["c2"] = await page.getByTestId("systemzustand-auslastung").screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, ohneDatei());
        shots["d"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "dark" });
        shots["e"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        shots["f"] = await page.screenshot();
        await close();
    }

    const colour = CANON.colour;
    const img = (key: string, width?: number): string =>
        `<img src="${png(shots[key] as Buffer)}" alt=""${width === undefined ? "" : ` style="width:${String(width)}px"`}>`;
    const fig = (key: string, text: string, width?: number): string => `<div><p>${text}</p>${img(key, width)}</div>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1280px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 30px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 18px 24px; align-items: flex-start; }
.row > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; max-width: 620px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Systemzustand in der Systemsteuerung (SYS-8), gebaut</h1>
<p class="lead">WI-0127 SYS-8 · Bauplan SYS-0001 §3.6, §3.7, §6.3 · gebaut nach Blatt WI-0119 A7, A9, Z7 · Werte aus Claudios system.json (Platten, Dienste,
Tür von außen, Größen) und von der Anwendung selbst (Last, Speicher, Datenbank, Verlauf) · Stand aus dem Nachbau, Sitzung als Admin, Karte aus dem lokalen Stapel.</p>

<h2>(a) Rechner, hell, echte Größe <span>· Stage mit frischer Statusdatei; die Sicherung ist noch nicht eingerichtet</span></h2>
${img("a")}

<h2>(b) Der ganze Inhalt <span>· Komponenten, Auslastung mit Verlauf über 24 h (eine Lücke beim Neustart), Datenbank, Auf der Platte</span></h2>
${img("b", 900)}

<h2>(c) Die vier Zustände <span>· gesund, Warnung (lädt), ausgefallen (kein Planer), unbekannt (Messwert älter als 15 min); Platte unter 15 % frei</span></h2>
<div class="row">${fig("c", "Komponenten", 720)}${fig("c2", "Auslastung mit Plattenwarnung (nur Anzeige)", 720)}</div>

<h2>(d) Lokal, ohne Statusdatei <span>· Nginx und Tür, Last (Windows), Verbindungen, Größen: „unbekannt“, nie eine Null</span></h2>
${img("d", 960)}

<h2>(e) Dunkel</h2>
${img("e", 960)}

<h2>(f) Telefon <span>· Pixel 7: Aufgabe, Seit und Version wandern unter den Namen</span></h2>
${img("f", 412)}

<p class="note"><b>Worauf zu achten ist:</b> Der Eintrag liest nur; nichts lässt sich hier schalten. Was die Anwendung nicht messen kann, steht als
„unbekannt“ mit grauem Punkt da, nie als 0. Die Werte aus Claudios Statusdatei gelten nur, solange sie höchstens 15 Minuten alt ist. Die Verbindungen
zählt eine eigene Funktion, sobald Claudio die Rolle <code>avesmaps3d_stats</code> anlegt; bis dahin „unbekannt“. Der Speicher von Routing- und Jobs-Worker
fehlt noch (eigener Folgeschritt).</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const teile = process.env["SHOTS_DIR"];
    if (teile !== undefined) {
        mkdirSync(teile, { recursive: true });
        for (const [key, shot] of Object.entries(shots)) writeFileSync(resolve(teile, `${key}.png`), shot);
    }
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__systemzustand.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__systemzustand.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-8-blatt.png"), fullPage: true });
    await sheetContext.close();
});
