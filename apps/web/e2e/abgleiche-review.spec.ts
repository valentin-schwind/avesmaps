import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AdminAbgleiche } from "@avesmaps3d/shared";
import { abgleicheServer, abgleicheStand, lauf, zeile, type AbgleicheServer } from "./abgleiche-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Abgleiche“ (WI-0127 SYS-14, SYS-0001 §9b; Frage F2 zum Kreis).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/abgleiche.test.ts`, `e2e/abgleiche.spec.ts` und auf dem Server in `abgleiche-routes.test.ts`.
 *
 * Gezeigt wird der Eintrag auf der ECHTEN Karte: am Rechner hell in echter Größe in Ruhe und mit der Frage, die Lagen einer Zeile
 * (läuft, wartet ohne Planer, nie, gescheitert, ohne Recht, Umgebung ohne Ausführung), der Knopf in doppelter Dichte, die zwei Lesarten
 * des Kreises nebeneinander (A Ergebnis, gebaut; B Alter, nur im Bild), dunkel und das Telefon. Sitzung und Stand aus dem Nachbau
 * (`verwaltung-stub.ts`, `abgleiche-stub.ts`; „Rondrikan“ als Betreiber), die Karte dahinter aus dem laufenden Stapel.
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-14-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "run_legacy_sync"];
const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

test.use({ actionTimeout: 30_000 });

interface Opened {
    page: Page;
    server: AbgleicheServer;
    close: () => Promise<void>;
}

async function open(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    stand: AdminAbgleiche = abgleicheStand(),
    capabilities: string[] = OPERATOR,
): Promise<Opened> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    const server = abgleicheServer(stand);
    await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("run_legacy_sync") ? "operator" : "admin",
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
            .selectOption("abgleiche");
    } else {
        await page.getByTestId("verwaltung-eintrag-abgleiche").click();
    }
    await page.getByTestId("abgleich-legacy").waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, server, close: () => context.close() };
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;
const LISTE = ".abgleiche__liste";

test("Abnahmeblatt: Abgleiche (SYS-14)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};

    // (a) Ruhe, (b) die Frage am Legacy-Zug.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" });
        shots["a"] = await page.screenshot();
        await page.getByTestId("abgleich-legacy-knopf").click();
        await page.waitForTimeout(400);
        shots["b"] = await page.screenshot();
        await close();
    }

    // (c) Lagen einer Zeile, echte Größe, nur die Liste.
    const lagen: [string, AdminAbgleiche, string[]?][] = [
        [
            "c-laeuft",
            abgleicheStand({
                zeilen: [
                    zeile("legacy", {
                        kreis: "voll",
                        letzter: lauf({ finishedAt: ago(26 * 60 * MINUTE) }),
                        laufend: {
                            jobId: "7e570000-0000-4000-8000-0000000000c1",
                            state: "RUNNING",
                            queuedAt: ago(5 * MINUTE),
                            startedAt: ago(4 * MINUTE),
                            phase: "I11",
                            progress: 0.42,
                            waitReason: null,
                            ausgeloest: { art: "person", name: "Rondrikan" },
                        },
                    }),
                    zeile("medien", {
                        laufend: {
                            jobId: "7e570000-0000-4000-8000-0000000000c2",
                            state: "QUEUED",
                            queuedAt: ago(MINUTE),
                            startedAt: null,
                            phase: null,
                            progress: null,
                            waitReason: "waits_slot",
                            ausgeloest: { art: "person", name: "Rondrikan" },
                        },
                    }),
                ],
            }),
        ],
        [
            "c-nie",
            abgleicheStand({
                planerAktiv: false,
                zeilen: [
                    zeile("legacy", {
                        letzter: lauf({
                            state: "FAILED",
                            finishedAt: ago(70 * MINUTE),
                            luecken: null,
                            befunde: null,
                            satz: null,
                            fehler: "Der Legacy-Zug hat angehalten: https://avesmaps.de/api/app/map-features.php: HTTP 503",
                        }),
                    }),
                    zeile("medien"),
                ],
            }),
        ],
        ["c-ohne-recht", abgleicheStand(), ADMIN_CAPABILITIES],
        ["c-umgebung", abgleicheStand({ ausfuehrung: "aus" })],
    ];
    for (const [key, stand, capabilities] of lagen) {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, stand, capabilities);
        shots[key] = await page.locator(LISTE).screenshot();
        await close();
    }

    // (d) Der Knopf in doppelter Dichte: Ruhe, Zeigen, Fokus, gesperrt (Guide §30.5).
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        const knopf = page.getByTestId("abgleich-legacy-knopf");
        const bild = async (): Promise<Buffer> => {
            const box = await knopf.boundingBox();
            if (box === null) throw new Error("Knopf nicht sichtbar");
            return page.screenshot({
                clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
            });
        };
        shots["d-ruhe"] = await bild();
        await knopf.hover();
        await page.waitForTimeout(300);
        shots["d-zeigen"] = await bild();
        await page.mouse.move(0, 0);
        await page.getByTestId("abgleich-legacy-knopf").focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.waitForTimeout(300);
        shots["d-fokus"] = await bild();
        await close();
    }

    // (e) F2: dieselbe Lage in beiden Lesarten. Zug vor 70 Minuten gescheitert, Medien gestern mit Lücke. A ist gebaut; B entsteht
    // nur im Bild (Kreise und Legende im DOM umgesetzt): nach dem Alter wären beide voll.
    {
        const lage = abgleicheStand({
            zeilen: [
                zeile("legacy", {
                    letzter: lauf({
                        state: "FAILED",
                        finishedAt: ago(70 * MINUTE),
                        luecken: null,
                        fehler: "Der Legacy-Zug hat angehalten: I24 Wiki-Linkziele fehlgeschlagen",
                    }),
                }),
                zeile("medien", {
                    kreis: "halb",
                    letzter: lauf({ finishedAt: ago(26 * 60 * MINUTE), luecken: ["dateien"], befunde: 3 }),
                }),
            ],
        });
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, lage);
        shots["e-a"] = await page.getByTestId("abgleiche").screenshot();
        await page.evaluate(() => {
            const setze = (quelle: string, fuellung: string): void => {
                const kreis = document.querySelector(`[data-testid="abgleich-${quelle}-kreis"]`);
                kreis?.classList.remove("avm-kreis--leer", "avm-kreis--halb", "avm-kreis--voll");
                kreis?.classList.add(`avm-kreis--${fuellung}`);
            };
            setze("legacy", "voll");
            setze("medien", "voll");
            const woerter = ["nie abgeglichen", "älter als eine Woche", "in der letzten Woche"];
            document.querySelectorAll(".abgleiche__legende-teil").forEach((teil, index) => {
                const kreis = teil.querySelector(".avm-kreis");
                teil.textContent = "";
                if (kreis !== null) teil.append(kreis);
                teil.append(woerter[index] ?? "");
            });
        });
        await page.waitForTimeout(200);
        shots["e-b"] = await page.getByTestId("abgleiche").screenshot();
        await close();
    }

    // (f) Dunkel, (g) Telefon mit Frage.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "dark" });
        shots["f"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await open(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        shots["g-ruhe"] = await page.screenshot();
        await page.getByTestId("abgleich-legacy-knopf").tap();
        await page.waitForTimeout(400);
        shots["g-frage"] = await page.screenshot();
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
<h1>Abgleiche (Systemsteuerung, SYS-14)</h1>
<p class="lead">WI-0127 SYS-14 · SYS-0001 §9b · Betreiber 2026-10-10: „du kannst "Zieh mal" auch in die verwaltung tun“ · Stage-Sitzung, „Rondrikan“ als Betreiber,
Stand aus dem Nachbau (gegen den Vertrag gebaut), Karte aus dem lokalen Stapel · Rechner hell in echter Größe, dann die Lagen, der Knopf doppelt, Frage F2, dunkel, Telefon.</p>

<h2>(a) Rechner, hell, echte Größe <span>· „Redaktion &amp; Integrationen › Abgleiche“: Legacy-Zug vollständig, Medien mit Lücke; Legende unten</span></h2>
${img("a")}

<h2>(b) Ein Druck auf „⇄ Jetzt abgleichen“ <span>· die Frage an der Stelle; erst „Jetzt abgleichen“ reiht den Auftrag ein</span></h2>
${img("b")}

<h2>(c) Lagen einer Zeile, echte Größe</h2>
<div class="row">
${fig("c-laeuft", "Legacy-Zug läuft (Schritt I11, 42 %); Medien warten auf einen freien Platz")}
${fig("c-nie", "Zug vor 70 Minuten gescheitert, mit dem Satz des Fehlers; Medien noch nie abgeglichen")}
${fig("c-ohne-recht", "Ein Admin ohne das Recht: sieht alles, der Knopf steht gesperrt mit Satz")}
${fig("c-umgebung", "Auf einer Umgebung ohne Ausführung (heute Stage, bis Claudio seinen Weg gebaut hat)")}
</div>

<h2>(d) Der Knopf, doppelte Dichte <span>· Guide §30.5: Ruhe, Zeigen, Fokus über die Tastatur; gesperrt siehe (c)</span></h2>
<div class="row">
${fig("d-ruhe", "Ruhe")}
${fig("d-zeigen", "Zeigen")}
${fig("d-fokus", "Fokus")}
</div>

<h2>(e) Frage F2: Was sagt der Kreis? <span>· dieselbe Lage: Zug vor 70 Minuten gescheitert, Medien gestern mit Lücke</span></h2>
<div class="row">
${fig("e-a", "A (Empfehlung, gebaut): das Ergebnis des letzten Laufs. ○ nie oder zuletzt gescheitert, ◐ mit Lücke, ● vollständig. Ein gescheiterter Zug fällt sofort auf.")}
${fig("e-b", "B: das Alter des letzten Laufs. ○ nie, ◐ älter als eine Woche, ● in der letzten Woche. Der gescheiterte Zug stünde voll da; nur die Unterzeile sagt es.")}
</div>

<h2>(f) Dunkel</h2>
${img("f", 960)}

<h2>(g) Telefon <span>· Pixel 7 (412 × 915): Auswahl „Redaktion &amp; Integrationen › Abgleiche“, der Knopf unter der Zeile, die Frage</span></h2>
<div class="row">${fig("g-ruhe", "In Ruhe", 412)}${fig("g-frage", "Nach dem Druck auf den Knopf", 412)}</div>

<p class="note"><b>Worauf zu achten ist:</b> Der Knopf startet nie sofort, er fragt an der Stelle. Ein Auftrag läuft als Job der Warteschlange (Fortschritt auch auf
der Statusseite); der Bericht des Zugs nennt dann „Auftrag aus der Verwaltung“ statt eines Zitats. Gezählt wird jeder Zug, auch der auf Zuruf und der tägliche
Zug auf Stage („ohne Knopf“). Stufe V: kein zusätzlicher Passkey, die Verwaltung verlangt den zweiten Faktor ohnehin. Starten darf nur die Rolle Betreiber.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__abgleiche.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__abgleiche.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-14-blatt.png"), fullPage: true });
    await sheetContext.close();
});
