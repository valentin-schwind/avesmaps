import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AdminSicherung } from "@avesmaps3d/shared";
import { nichtEingerichtet, sicherungServer, sicherungStand, type SicherungServer } from "./sicherung-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Backups mit „Sicherung jetzt““ (WI-0127 SYS-9, SYS-0001 §6.5, §9e).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/sicherung.test.ts`, `e2e/sicherung.spec.ts` und auf dem Server in `sicherung-status.test.ts` und `sicherung-routes.test.ts`.
 *
 * Gezeigt wird der Eintrag auf der ECHTEN Karte: am Rechner hell in echter Größe (aktuell, mit den Teilen), der Druck auf „Sicherung
 * jetzt“ und die Zeile danach, die Karte in allen Zuständen, der Knopf in doppelter Dichte, dunkel und das Telefon. Sitzung und Stand aus
 * dem Nachbau (`verwaltung-stub.ts`, `sicherung-stub.ts`; „Rondrikan“ als Betreiber), die Karte dahinter aus dem laufenden Stapel.
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-9-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "run_backup"];
const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

test.use({ actionTimeout: 30_000 });

interface Opened {
    page: Page;
    server: SicherungServer;
    close: () => Promise<void>;
}

async function open(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    stand: AdminSicherung = sicherungStand(),
    capabilities: string[] = OPERATOR,
): Promise<Opened> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    const server = sicherungServer(stand);
    await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("run_backup") ? "operator" : "admin",
        sicherung: server,
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
            .selectOption("backup");
    } else {
        await page.getByTestId("verwaltung-eintrag-backup").click();
    }
    await page.getByTestId("sicherung-zustand").waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, server, close: () => context.close() };
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;
const KARTE = ".fenster-karte";

test("Abnahmeblatt: Backups mit „Sicherung jetzt“ (SYS-9)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};

    // (a) Ruhe, echte Größe; (b) nach dem Druck auf „Sicherung jetzt“: angefordert, Knopf gesperrt mit Satz.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" });
        shots["a"] = await page.screenshot();
        await page.getByTestId("sicherung-jetzt").click();
        await page.getByTestId("sicherung-satz").waitFor();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        shots["b"] = await page.getByTestId("sicherung").locator(KARTE).screenshot();
        await close();
    }

    // (c) Die Karte in jedem Zustand und mit der Zeile unter dem Knopf, echte Größe.
    const lauf = sicherungStand().letzterLauf!;
    const lagen: [string, AdminSicherung, string[]?][] = [
        [
            "c-abgeholt",
            sicherungStand({
                anstossen: {
                    moeglich: true,
                    wartend: { operationId: "x", requestedAt: ago(3 * MINUTE) },
                    letzteAntwort: null,
                },
            }),
        ],
        [
            "c-laeuft",
            sicherungStand({
                zustand: "laeuft",
                letzterLauf: {
                    ...lauf,
                    startedAt: ago(2 * MINUTE),
                    finishedAt: null,
                    result: "running",
                    trigger: "manual",
                    operationId: "x",
                },
            }),
        ],
        [
            "c-zu-frueh",
            sicherungStand({
                letzterLauf: { ...lauf, finishedAt: ago(12 * MINUTE), trigger: "manual", operationId: "y" },
                letzteErfolgreiche: ago(12 * MINUTE),
                anstossen: {
                    moeglich: true,
                    wartend: null,
                    letzteAntwort: { operationId: "z", at: ago(MINUTE), result: "zu_frueh" },
                },
            }),
        ],
        [
            "c-gescheitert",
            sicherungStand({
                zustand: "fehlgeschlagen",
                letzterLauf: { ...lauf, result: "failed", errorCode: "offsite_failed" },
            }),
        ],
        ["c-ueberfaellig", sicherungStand({ zustand: "ueberfaellig", naechsterLauf: ago(5 * 60 * MINUTE) })],
        [
            "c-unbekannt",
            {
                ...nichtEingerichtet(),
                zustand: "unbekannt",
                anstossen: { moeglich: true, wartend: null, letzteAntwort: null },
            },
        ],
        ["c-nicht", nichtEingerichtet()],
        ["c-ohne-recht", sicherungStand(), ADMIN_CAPABILITIES],
    ];
    for (const [key, stand, capabilities] of lagen) {
        const { page, server, close } = await open(browser, baseURL, { colorScheme: "light" }, stand, capabilities);
        // „Zu früh“ ist die Antwort auf den EIGENEN Auftrag: den Druck nachspielen, dann die Antwort mit seiner Kennung zeigen.
        if (key === "c-zu-frueh") {
            server.state = { ...stand, anstossen: { moeglich: true, wartend: null, letzteAntwort: null } };
            await page.getByTestId("sicherung-jetzt").click();
            await page.getByTestId("sicherung-satz").waitFor();
            const eigene = String(server.starts.at(-1)?.["operationId"]);
            server.state = {
                ...stand,
                anstossen: {
                    ...stand.anstossen,
                    letzteAntwort: { operationId: eigene, at: ago(0), result: "zu_frueh" },
                },
            };
            await page.getByTestId("verwaltung-eintrag-betrieb").click();
            await page.getByTestId("verwaltung-eintrag-backup").click();
            await page.getByText("jünger als 30 Minuten").waitFor({ timeout: 15_000 });
            await page.mouse.move(0, 0);
            await page.waitForTimeout(300);
        }
        shots[key] = await page.getByTestId("sicherung").locator(KARTE).screenshot();
        await close();
    }

    // (d) Der Knopf in doppelter Dichte: Ruhe, Zeigen, Fokus (Guide §30.5).
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        const knopf = page.getByTestId("sicherung-jetzt");
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
        await knopf.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.waitForTimeout(300);
        shots["d-fokus"] = await bild();
        await close();
    }

    // (e) Dunkel, (f) Telefon.
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
.row > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; max-width: 600px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Backups mit „Sicherung jetzt“ (Systemsteuerung, SYS-9)</h1>
<p class="lead">WI-0127 SYS-9 · Bauplan SYS-0001 §6.5 und §9e (Vertrag mit Claudio) · Betreiber 2026-10-10: „warum kann ich in der verwaltung keine backups
manuella anstoßen“ · Stage, Stand aus dem Nachbau (gegen den Vertrag gebaut), Sitzung als Betreiber, Karte aus dem lokalen Stapel.</p>

<h2>(a) Rechner, hell, echte Größe <span>· Sicherung von heute Nacht, aktuell, drei Teile (zwei außer Haus geprüft, eine nur hier)</span></h2>
${img("a")}

<h2>(b) Nach dem Druck auf „⊕ Sicherung jetzt“ <span>· der Auftrag liegt, der Knopf ist gesperrt mit Satz; Claudios Seite holt ihn ab</span></h2>
${img("b", 860)}

<h2>(c) Die Karte in jedem Zustand <span>· echte Größe</span></h2>
<div class="row">
${fig("c-abgeholt", "Auftrag liegt seit 3 Minuten: „noch nicht abgeholt“ (nach 60 s)", 600)}
${fig("c-laeuft", "läuft (nach dem Anstoß oder nachts)", 600)}
${fig("c-zu-frueh", "die Antwort auf den eigenen Auftrag: zu früh (Drossel: ein Lauf von Hand je 30 min)", 600)}
${fig("c-gescheitert", "fehlgeschlagen, mit dem Grund aus der Statusdatei", 600)}
${fig("c-ueberfaellig", "überfällig: der nächste Lauf ist mehr als 2 h vorbei", 600)}
${fig("c-unbekannt", "unbekannt: die Statusdatei ist nicht lesbar", 600)}
${fig("c-nicht", "nicht eingerichtet (lokal der Normalfall, kein Fehler): gestrichelt, Knopf aus", 600)}
${fig("c-ohne-recht", "ein Admin ohne „Sicherung anstoßen“: sieht alles, stößt nichts an", 600)}
</div>

<h2>(d) Der Knopf, doppelte Dichte <span>· Ruhe, Zeigen, Fokus über die Tastatur</span></h2>
<div class="row">${fig("d-ruhe", "Ruhe")}${fig("d-zeigen", "Zeigen")}${fig("d-fokus", "Fokus")}</div>

<h2>(e) Dunkel</h2>
${img("e", 960)}

<h2>(f) Telefon <span>· Pixel 7 (412 × 915): Auswahl „System &amp; Betrieb › Backups“, der Knopf über die ganze Breite</span></h2>
${img("f", 412)}

<p class="note"><b>Worauf zu achten ist:</b> Der Knopf stößt denselben Lauf an wie der nächtliche Zeitgeber; Claudios Seite holt den Auftrag ab und
drosselt (höchstens ein Lauf von Hand je 30 min). Was die App weiß, steht in der Zeile unter dem Knopf: angefordert, noch nicht abgeholt, läuft, fertig,
oder warum der Auftrag verworfen wurde. Wiederherstellen gibt es hier nicht (Kommandozeile beim Betreiber). Die Teile tragen den Kreis der Listen:
● außer Haus geprüft, ◐ nur hier. Der Export (Kartendaten-Abzug, §6.5) ist nicht Teil dieses Pakets.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__sicherung.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__sicherung.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-9-blatt.png"), fullPage: true });
    await sheetContext.close();
});
