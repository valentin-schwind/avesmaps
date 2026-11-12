import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { systemOverview, systemServer } from "./betriebszustand-stub.ts";
import { ADMIN_CAPABILITIES, ME, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Betriebszustand“ (WI-0127 SYS-5, Bauplan SYS-0001 §6.2, §7.3; Vorbild Blatt WI-0119 Fassung 2, A1, A4, Z1, Z2, Z6).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/betriebszustand.test.ts`, `e2e/betriebszustand.spec.ts` und `e2e/betriebszustand.touch.spec.ts`.
 *
 * Gezeigt wird der Eintrag auf der ECHTEN Karte: am Rechner hell in echter Größe (1280 × 900) in Ruhe und mit der Bestätigung, die
 * Zustände des Schalters in doppelter Dichte (Ruhe, Zeigen, gedrückt, Fokus, gesperrt), die vier Urteile „eingestellt gegen wirksam“,
 * eine gesetzte Kartensperre, nur lesen, dunkel und das Telefon. Sitzung und Betriebszustand kommen aus dem Nachbau
 * (`verwaltung-stub.ts`, `betriebszustand-stub.ts`; Stage, „Rondrikan“ als Betreiber), die Karte dahinter aus dem laufenden Stapel.
 *
 *   npm run review:systemsteuerung
 *
 * Ablage: `review/wi-0127/sys-5-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0127");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode"];

// Ein Bild, das nicht entsteht, soll nach Sekunden scheitern, nicht nach der Zeitgrenze des ganzen Blatts.
test.use({ actionTimeout: 30_000 });

type StubOptions = NonNullable<Parameters<typeof stubAdmin>[1]>;

interface Opened {
    page: Page;
    close: () => Promise<void>;
}

async function open(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    stub: StubOptions = {},
): Promise<Opened> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: OPERATOR, role: "operator", ...stub });
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
            .selectOption("betrieb");
    } else {
        await page.getByTestId("verwaltung-eintrag-betrieb").click();
    }
    await page.getByTestId("betrieb-kurzstatus").waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;
const ME_REF = { id: ME.id, displayName: ME.displayName };

/** Eingeschränkt umgeschaltet, `vorMs` her; die Instanz kennt noch Revision 7, wenn `nachgezogen` falsch ist. */
function umgeschaltet(vorMs: number, nachgezogen: boolean) {
    return systemOverview(ME, (overview) => {
        const since = new Date(Date.now() - vorMs).toISOString();
        overview.configured!.mode = {
            mode: "restricted",
            since,
            by: ME_REF,
            byLabel: null,
            reason: "Wiederherstellung prüfen",
        };
        overview.configured!.revision = 8;
        overview.configured!.updatedAt = since;
        if (nachgezogen) overview.effective = { ...overview.effective, mode: "restricted", revision: 8 };
    });
}

test("Abnahmeblatt: Betriebszustand (SYS-5)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};
    /**
     * Nur die Mulde des Hauptschalters, mit etwas Rand für Lasur und Fokusring; mit `satz` bis unter den Satz, warum gesperrt ist. So
     * bleibt das Bild in doppelter Dichte schmal genug, um in echter Pixelgröße auf dem Blatt zu stehen.
     */
    const schalter = async (page: Page, satz = false): Promise<Buffer> => {
        const box = await page.getByTestId("betrieb-schalter").boundingBox();
        const unten = satz ? await page.getByTestId("betrieb-sperrsatz").boundingBox() : null;
        if (box === null) throw new Error("Hauptschalter nicht sichtbar");
        const rand = 8;
        const bottom = Math.max(box.y + box.height, unten === null ? 0 : unten.y + unten.height);
        return page.screenshot({
            clip: { x: box.x - rand, y: box.y - rand, width: box.width + 2 * rand, height: bottom - box.y + 2 * rand },
        });
    };

    // (a) Rechner hell, echte Größe, in Ruhe; (b) dieselbe Stelle mit der Bestätigung „Betrieb einschränken?“; (d) und (e) auf
    // derselben Seite: Ein anderer Stand des Nachbaus wird gezeigt, indem der Eintrag neu geöffnet wird (er lädt beim Öffnen).
    {
        const system = systemServer(ME, systemOverview(ME));
        const { page, close } = await open(browser, baseURL, { colorScheme: "light" }, { system });
        shots["a"] = await page.screenshot();
        await page.getByTestId("betrieb-schalter-restricted").click();
        await page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox").fill("Wiederherstellung prüfen");
        await page.waitForTimeout(400);
        shots["b"] = await page.screenshot();

        const zeige = async (stand: ReturnType<typeof systemOverview>): Promise<void> => {
            await page.getByTestId("verwaltung-eintrag-backup").click();
            system.state = stand;
            await page.getByTestId("verwaltung-eintrag-betrieb").click();
            await page.getByTestId("betrieb-wirkung").waitFor();
            await page.mouse.move(0, 0);
            await page.waitForTimeout(500);
        };
        // (d) Eingestellt gegen wirksam: gleich, übernommen, zieht nach, weicht ab, unbekannt (echte Größe, nur die Feldzeilen).
        // Jeder Stand entsteht erst unmittelbar vor seinem Bild: „zieht nach“ gilt nur zwei Takte lang.
        const urteile: [string, () => ReturnType<typeof systemOverview>][] = [
            ["d-gleich", () => systemOverview(ME)],
            ["d-uebernommen", () => umgeschaltet(2_000, true)],
            ["d-zieht", () => umgeschaltet(1_000, false)],
            ["d-weicht", () => umgeschaltet(130_000, false)],
            [
                "d-unbekannt",
                () =>
                    systemOverview(ME, (overview) => {
                        overview.effective = {
                            source: "unknown",
                            mode: null,
                            mapLock: null,
                            systemLock: null,
                            revision: null,
                            contentRevision: null,
                            readAt: new Date(Date.now() - 45_000).toISOString(),
                            ready: false,
                        };
                        overview.brief.map = "failed";
                        overview.brief.login = "failed";
                        overview.brief.queue = null;
                    }),
            ],
        ];
        for (const [key, stand] of urteile) {
            await zeige(stand());
            shots[key] = await page.getByTestId("betrieb-wirkung").screenshot();
        }
        shots["d-unbekannt-karte"] = await page.getByTestId("betrieb-hauptschalter").screenshot();

        // (e) Kartensperre gesetzt, Systemsperre offen; dann die Bestätigung an der Systemsperre.
        await zeige(
            systemOverview(ME, (overview) => {
                overview.configured!.mapLock = {
                    locked: true,
                    since: new Date(Date.now() - 25 * 60_000).toISOString(),
                    by: ME_REF,
                    byLabel: null,
                    reason: "Datenübernahme prüfen",
                };
                overview.effective = { ...overview.effective, mapLock: true };
            }),
        );
        await page.getByTestId("betrieb-sperre-map").scrollIntoViewIfNeeded();
        // Die Mauer des Eintrags, nicht die eines anderen (geschlossenen) Fensters im Baum.
        shots["e"] = await page.getByTestId("betrieb").locator(".fenster-mauer").screenshot();
        await page.getByTestId("betrieb-sperre-system-schalter-gesperrt").click();
        await page.getByTestId("betrieb-frage-system-grund").getByRole("textbox").fill("Rechte prüfen");
        await page.waitForTimeout(300);
        shots["e-frage"] = await page.getByTestId("betrieb-sperre-system").screenshot();
        await close();
    }

    // (c) Die Zustände des Hauptschalters in doppelter Dichte.
    {
        const { page, close } = await open(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        const eingeschraenkt = page.getByTestId("betrieb-schalter-restricted");
        shots["c-ruhe"] = await schalter(page);
        await eingeschraenkt.hover();
        await page.waitForTimeout(300);
        shots["c-zeigen"] = await schalter(page);
        await page.mouse.down();
        await page.waitForTimeout(300);
        shots["c-gedrueckt"] = await schalter(page);
        await page.mouse.move(0, 0);
        await page.mouse.up();
        await page.getByTestId("betrieb-schalter-normal").focus();
        await page.keyboard.press("Tab");
        await page.waitForTimeout(300);
        shots["c-fokus"] = await schalter(page);
        shots["c-sperren"] = await page.getByTestId("betrieb-sperre-map").screenshot();
        await close();
    }

    // (c) gesperrt: ohne Recht zum Umschalten (Admin ohne `manage_system_settings`), nur lesen.
    {
        const { page, close } = await open(
            browser,
            baseURL,
            { colorScheme: "light", deviceScaleFactor: 2 },
            { capabilities: ADMIN_CAPABILITIES, role: "admin" },
        );
        shots["c-gesperrt"] = await schalter(page, true);
        await close();
    }

    // (f) Dunkel, eingeschränkt.
    {
        const { page, close } = await open(
            browser,
            baseURL,
            { colorScheme: "dark" },
            { system: systemServer(ME, umgeschaltet(40 * 60_000, true)) },
        );
        shots["f"] = await page.screenshot();
        await close();
    }

    // (g) Telefon: Hauptschalter gestapelt, die Bestätigung mit Grund (Blatt A4).
    {
        const { page, close } = await open(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        shots["g-ruhe"] = await page.screenshot();
        await page.getByTestId("betrieb-schalter-restricted").tap();
        await page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox").fill("Wiederherstellung prüfen");
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
<h1>Betriebszustand (Systemsteuerung, SYS-5)</h1>
<p class="lead">WI-0127 SYS-5 · Bauplan SYS-0001 §6.2 · Vorbild: Blatt WI-0119 Fassung 2 (A1, A4, Z1, Z2, Z6) · Stage, „Rondrikan“ als Betreiber, Stand aus dem
Nachbau (gegen den Vertrag geprüft), Karte aus dem lokalen Stapel · Rechner hell in echter Größe, danach die Zustände doppelt, die Urteile, die Sperren, dunkel, Telefon.</p>

<h2>(a) Rechner, hell, echte Größe <span>· in Ruhe: Kurzstatus, Hauptschalter (Wartung gesperrt mit Satz), eingestellt gleich wirksam, Sperren, Rückweg</span></h2>
${img("a")}

<h2>(b) Rechner, hell, echte Größe <span>· ein Druck auf „Eingeschränkt“: die Bestätigung im Moment, Folge mit den Inhabern, Grund Pflicht</span></h2>
${img("b")}

<h2>(c) Zustände des Hauptschalters, doppelte Dichte <span>· Guide §30.5; jedes Bild in seiner Pixelgröße</span></h2>
<div class="row">
${fig("c-ruhe", "Ruhe: Normal gewählt, „Wartung“ gesperrt (eigene Farbfassung, keine Deckkraft); der Satz dazu steht daneben, siehe (a)")}
${fig("c-zeigen", "Zeigen auf „Eingeschränkt“: die Lasur färbt die Fläche")}
${fig("c-gedrueckt", "Gedrückt: die Aktiv-Lasur")}
${fig("c-fokus", "Fokus über die Tastatur: der Goldring")}
${fig("c-gesperrt", "Gesperrt, nur lesen: ohne das Recht „Systemschalter“ stehen alle Segmente gesperrt, das Gewählte bleibt gefüllt, der Satz sagt warum")}
${fig("c-sperren", "Eine Sperre: Offen · Gesperrt, „Sperrt“ und „Offen bleibt“")}
</div>

<h2>(d) Eingestellt gegen wirksam, echte Größe <span>· Blatt Z2; „unbekannt“ steht nie als Normal da</span></h2>
<div class="row">
${fig("d-gleich", "Gleich")}
${fig("d-uebernommen", "Übernommen (Eingeschränkt, gelb)")}
${fig("d-zieht", "Gerade umgeschaltet: der Server zieht nach")}
${fig("d-weicht", "Weicht ab (nach zwei Takten, 10 s)")}
${fig("d-unbekannt", "Unbekannt")}
</div>
<div class="row" style="margin-top:14px">${fig("d-unbekannt-karte", "Unbekannt am Hauptschalter: kein Segment gewählt, alles gesperrt, der Satz dazu")}</div>

<h2>(e) Sperren, echte Größe</h2>
<div class="row">
${fig("e", "Kartensperre gesetzt: seit wann, von wem, warum")}
${fig("e-frage", "Systemsperre setzen: dieselbe Bestätigung mit Grund")}
</div>

<h2>(f) Dunkel <span>· eingeschränkt seit 40 Minuten</span></h2>
${img("f", 960)}

<h2>(g) Telefon <span>· Pixel 7 (412 × 915): Auswahl „System &amp; Betrieb › Betriebszustand“, Hauptschalter zuerst und gestapelt, die Bestätigung mit Grund</span></h2>
<div class="row">${fig("g-ruhe", "In Ruhe", 412)}${fig("g-frage", "Umschalten auf „Eingeschränkt“", 412)}</div>

<p class="note"><b>Worauf zu achten ist:</b> Ein Druck auf ein Segment schaltet nie sofort; gewählt bleibt, was eingestellt ist, bis der Server es bestätigt.
Den Passkey fragt danach das vorhandene Fenster „Kurz bestätigen“ (Stufe S, wie bei jeder Handlung dieser Stufe), einmal; solange der Nachweis frisch ist (5 Minuten),
nicht wieder. 🚩 Abweichungen vom Blatt: „Infoscreen ansehen ↗“ fehlt (die Anwendung liefert die Infoscreens nicht aus, das tut Nginx mit SYS-7); der Rückweg nennt
das Werkzeug mit seinem echten Umgebungsnamen (<i>avesmaps3d-auth staging …</i> statt <i>stage</i>); „weicht ab“ urteilt heute über die antwortende Instanz (älter als
zwei Takte), die Tür-Probe von außen kommt mit SYS-8. Für Besucher wirkt „Eingeschränkt“ erst mit der Tür (SYS-3) und dem vhost (SYS-7).</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__betriebszustand.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__betriebszustand.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "sys-5-blatt.png"), fullPage: true });
    await sheetContext.close();
});
