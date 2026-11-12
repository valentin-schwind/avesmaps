import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AdminHoehenmodell } from "@avesmaps3d/shared";
import { ENTWURF, fassungVon, hoehenmodellServer, hoehenmodellStand } from "./hoehenmodell-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Höhenmodell in der Systemsteuerung“, gebaut (WI-0127 SYS-13, SYS-0001 §9c, Entscheide §9c.12).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/hoehenmodell.test.ts`, `e2e/hoehenmodell.spec.ts` und auf dem Server in `hoehenmodell-auswahl.test.ts`,
 * `hoehenmodell-routes.test.ts` und `hoehenmodell-grants.test.ts`.
 *
 * Gezeigt wird der Eintrag auf der ECHTEN Karte: am Rechner hell in echter Größe, der ganze Inhalt, die Frage beim Aktivieren, die
 * rechnende Kette, das Formular „Neuer Entwurf“, ein Admin ohne Recht, eine nicht abgenommene Fassung, dunkel und das Telefon. Sitzung
 * und Stand aus dem Nachbau (`verwaltung-stub.ts`, `hoehenmodell-stub.ts`; „Rondrikan“ als Betreiber), die Karte aus dem Stapel.
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-13-blatt-2.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "manage_terrain_recipe"];

test.use({ actionTimeout: 30_000 });

/** Der übliche Stand fürs Blatt: 18 gilt, ein gemessener Entwurf aus 18. */
const GEMESSEN: AdminHoehenmodell = hoehenmodellStand({
    entwuerfe: [
        {
            ...ENTWURF,
            kreis: "halb",
            messung: {
                jobId: "messung-1",
                state: "SUCCEEDED",
                phase: null,
                progress: 1,
                ergebnis: {
                    land: { typisch: 3, mittel: 4.2, anstieg: 118, fall: -36 },
                    tiefland: { typisch: 0 },
                    gebirge: { typisch: 22 },
                    hoechster: { vorher: 5632, nachher: 5689 },
                    stufenWechsel: 0.0184,
                },
                fehler: null,
            },
        },
    ],
});

async function open(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    stand: AdminHoehenmodell = GEMESSEN,
    capabilities: string[] = OPERATOR,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    const server = hoehenmodellServer(stand);
    await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("manage_terrain_recipe") ? "operator" : "admin",
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
            .selectOption("hoehenmodell");
    } else {
        await page.getByTestId("verwaltung-eintrag-hoehenmodell").click();
    }
    await page.getByTestId("hoehenmodell-zustand").waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;
const ruhe = async (page: Page): Promise<void> => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
};

test("Abnahmeblatt: Höhenmodell in der Systemsteuerung, gebaut (SYS-13)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};
    const inhalt = (page: Page) => page.getByTestId("hoehenmodell");

    // (a) Ruhe, echte Größe.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" });
        shots["a"] = await page.screenshot();
        await close();
    }
    // (b) Der ganze Inhalt: Das Fenster rollt seinen Rumpf; fürs Bild wird die Höhe der Rollfläche aufgehoben (nur in diesem Lauf).
    {
        const { page, close } = await open(browser, baseURL, {
            colorScheme: "light",
            viewport: { width: 1280, height: 2600 },
        });
        await inhalt(page).evaluate((element) => {
            for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (/(auto|scroll|hidden)/u.test(style.overflowY) || style.maxHeight !== "none") {
                    node.style.overflow = "visible";
                    node.style.maxHeight = "none";
                    node.style.height = "auto";
                }
            }
        });
        await ruhe(page);
        shots["b"] = await inhalt(page).screenshot();
        await close();
    }
    // (c) Die Frage beim Aktivieren von Fassung 17, mit Grund; (d) danach: die Kette rechnet.
    {
        const { page, close } = await open(browser, baseURL, {
            colorScheme: "light",
            viewport: { width: 1280, height: 1400 },
        });
        await page.getByTestId("hoehenmodell-aktivieren-17").click();
        await page
            .getByTestId("hoehenmodell-frage-17-grund")
            .getByRole("textbox")
            .fill("Vergleich mit dem alten Modell");
        await ruhe(page);
        shots["c"] = await page.getByTestId("hoehenmodell-liste").screenshot();
        await close();
    }
    {
        const rechnet = hoehenmodellStand({
            eingestellt: {
                ...GEMESSEN.eingestellt,
                version: 17,
                grund: "Vergleich mit dem alten Modell",
                wer: "Rondrikan",
                revision: 3,
            },
            kette: {
                jobId: "k",
                art: "terrain_full",
                state: "RUNNING",
                phase: "erosion",
                progress: 0.38,
                waitReason: null,
            },
            rueckweg: 18,
            fassungen: [fassungVon(17, { gilt: true }), fassungVon(18, { gilt: false })],
        });
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, rechnet);
        shots["d"] = await page.getByTestId("hoehenmodell-gueltig").screenshot();
        await close();
    }
    // (e) Das Formular „Neuer Entwurf aus Fassung 18“ mit einem Wert außerhalb der Grenzen.
    {
        const { page, close } = await open(browser, baseURL, {
            colorScheme: "light",
            viewport: { width: 1280, height: 1600 },
        });
        await page.getByTestId("hoehenmodell-neu").click();
        await page.getByTestId("hoehenmodell-regler-saturation").getByRole("textbox").fill("12");
        await page.getByTestId("hoehenmodell-regler-flankGrade").getByRole("textbox").fill("1,4");
        await page.getByTestId("hoehenmodell-formular-grund").getByRole("textbox").fill("weichere Gebirgsränder");
        await ruhe(page);
        shots["e"] = await page.getByTestId("hoehenmodell-formular").screenshot();
        await close();
    }
    // (f) Ein Admin ohne „Höhenmodell umschalten“; (g) eine Fassung, die noch nicht abgenommen ist (◐, „● Abnehmen“).
    {
        const { page, close } = await open(
            browser,
            baseURL,
            { colorScheme: "light", viewport: { width: 1280, height: 1400 } },
            GEMESSEN,
            ADMIN_CAPABILITIES,
        );
        shots["f"] = await page.getByTestId("hoehenmodell-liste").screenshot();
        await close();
    }
    {
        const offen = hoehenmodellStand({
            fassungen: [fassungVon(17, { abnahme: null, inDatei: false, kreis: "halb" }), fassungVon(18)],
        });
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, offen);
        shots["g"] = await page.getByTestId("hoehenmodell-liste").screenshot();
        await close();
    }
    // (h) Dunkel, (i) Telefon.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "dark" });
        shots["h"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        shots["i"] = await page.screenshot();
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
<h1>Höhenmodell in der Systemsteuerung (SYS-13), gebaut</h1>
<p class="lead">WI-0127 SYS-13 · Bauplan SYS-0001 §9c · Entscheide 2026-10-10: 1 C (Fassungen als Dateien, Entwurf, Messen, Wählen und Zurück ohne Release),
2 „A plus“ (zehn Regler, Tafeln nur lesbar), 3 B (eigenes Recht, Umschalten mit Passkey), 4 A (Zurück auch unter Sperre), 5 B (Production nur abgenommene
Fassungen, nie messen) · Stage, Stand aus dem Nachbau, Sitzung als Betreiber, Karte aus dem lokalen Stapel. Die Werte sind die echten von Fassung 17 und 18.</p>

<h2>(a) Rechner, hell, echte Größe <span>· Fassung 18 gilt, 17 ist der Rückweg, ein gemessener Entwurf aus 18</span></h2>
${img("a")}

<h2>(b) Der ganze Inhalt <span>· Gültig, Fassungen und Entwürfe mit Kreis, die Werte der gewählten Zeile samt Tafel</span></h2>
${img("b", 900)}

<h2>(c) bis (g) Handlungen und Zustände <span>· echte Größe</span></h2>
<div class="row">
${fig("c", "(c) Aktivieren fragt an der Zeile: Folge, Grund (Pflicht), danach der Passkey", 620)}
${fig("d", "(d) danach: eingestellt 17, wirksam noch 18, der volle Lauf rechnet; der Rückweg zeigt auf 18", 620)}
${fig("e", "(e) „⊕ Neuer Entwurf aus Fassung 18“: leere Felder bleiben wie in der Fassung; ein Wert außerhalb der Grenzen steht markiert", 620)}
${fig("f", "(f) ein Admin ohne „Höhenmodell umschalten“: sieht alles, schaltet nichts; der Satz dazu steht einmal oben im Eintrag", 620)}
${fig("g", "(g) eine Fassung ohne Abnahme: ◐ und „● Abnehmen“ (nur auf einer Umgebung, die misst)", 620)}
</div>

<h2>(h) Dunkel</h2>
${img("h", 960)}

<h2>(i) Telefon <span>· Pixel 7 (412 × 915): Auswahl „System &amp; Betrieb › Höhenmodell“, Knöpfe über die ganze Breite</span></h2>
${img("i", 412)}

<p class="note"><b>Worauf zu achten ist:</b> Ein Wechsel rechnet die ganze Karte neu (§9c.11); bis dahin bleibt das bisherige Gelände sichtbar, „Wirksam“
zeigt, welche Fassung den Master rechnete. Eine Messung rechnet den Entwurf im Speicher und vergleicht mit dem gültigen Gelände; veröffentlicht wird
nichts, und sie rechnet nie auf der gültigen Fassung. Zur Fassung wird ein Entwurf erst, wenn ich ihn als Datei eintrage (Option C). Der Kreis:
○ Entwurf, ◐ gemessen beziehungsweise nicht abgenommen, ● abgenommen.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    // Die Einzelbilder auf Wunsch daneben (zum Nachsehen in voller Auflösung).
    const teile = process.env["SHOTS_DIR"];
    if (teile !== undefined) {
        mkdirSync(teile, { recursive: true });
        for (const [key, shot] of Object.entries(shots)) writeFileSync(resolve(teile, `${key}.png`), shot);
    }
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__hoehenmodell.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__hoehenmodell.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-13-blatt-2.png"), fullPage: true });
    await sheetContext.close();
});
