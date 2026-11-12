import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { hoehenmodellServer, hoehenmodellStand } from "./hoehenmodell-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";
import { mockupWegfindung } from "./wegfindung-mockup.ts";
import { PANELE, QUELLEN } from "./wegfindung-werte.ts";

/**
 * Mockup-Blatt „Wegfindung“ in der Systemsteuerung (WI-0153; Betreiber 2026-10-15, nach der Entscheidung zum
 * Fangradius 0,02: „in der systemsteuerung: ‚Wegfindung‘ … ein mockup mit den wichtigsten und derzeitigen
 * einstellungen zur Wegfindung“).
 *
 * 💣 Dieser Lauf prüft NICHTS über die Anwendung. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet; die
 * Wächter darin bewachen nur das Bild (steht darauf, was darauf stehen soll?). Der Reiter wird im Browser
 * eingehängt (`wegfindung-mockup.ts`), am App-Code und an den Sprachtafeln ist nichts geändert.
 *
 * Echte Oberfläche auf der echten Karte, Sitzung aus `verwaltung-stub.ts` („Rondrikan“ als Betreiber, dazu
 * `manage_system_settings`). Die Werte sind die echten des laufenden Standes.
 *
 * **Zweite Runde** (Betreiber 2026-10-15): nach Wirkort gruppiert, die Rasterwerte der A*-Läufe dazu, alle Werte
 * änderbar, ein Wert mit abweichender Herkunft. Das Blatt überschreibt das der ersten Runde; es soll nur eines geben.
 *
 *   npm run review:wegfindung
 *
 * Ablage: `review/wi-0153/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0153");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "manage_terrain_recipe"];

test.use({ actionTimeout: 30_000 });

interface Bild {
    buf: Buffer;
    dichte: number;
}
const shots: Record<string, Bild> = {};
const merke = (key: string, buf: Buffer, dichte: number): void => {
    shots[key] = { buf, dichte };
};

/**
 * Öffnet die Systemsteuerung beim Höhenmodell, holt mit „⊕ Neuer Entwurf“ die Eingabefelder ins Bild (daraus sammelt
 * das Mockup seine Bausteine) und wählt dann „Wegfindung“.
 */
async function oeffne(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    form: Parameters<typeof mockupWegfindung>[1] = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.9.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    const hoehenmodell = hoehenmodellServer(hoehenmodellStand());
    await stubAdmin(page, {
        capabilities: BETREIBER,
        role: "operator",
        answer: (call) => hoehenmodell.handle(call),
    });
    await mockupWegfindung(page, form);
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.getByRole("dialog", { name: "Systemsteuerung" }).waitFor();
    await page.getByTestId("verwaltung-eintrag-hoehenmodell").click();
    await page.getByTestId("hoehenmodell-zustand").waitFor({ timeout: 15_000 });
    // Die Eingabefelder stehen nur im Formular; das Mockup sammelt sie dort und baut seinen Rumpf daraus.
    await page.getByTestId("hoehenmodell-neu").click();
    await page.getByTestId("hoehenmodell-formular").waitFor();
    await page.getByTestId("verwaltung-eintrag-wegfindung").click();
    await page.getByTestId("wegfindung").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

/** Die Rollfläche des Fensters aufheben, damit der ganze Rumpf im Bild steht (nur in diesem Lauf). */
async function entrolle(page: Page): Promise<void> {
    await page.getByTestId("wegfindung").evaluate((element: HTMLElement) => {
        for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
            const stil = getComputedStyle(node);
            if (/(auto|scroll|hidden)/u.test(stil.overflowY) || stil.maxHeight !== "none") {
                node.style.overflow = "visible";
                node.style.maxHeight = "none";
                node.style.height = "auto";
            }
        }
    });
}

/**
 * Der Ausschnitt vom Kopf des Panels `n` bis zur Oberkante des `k`-ten Elements, auf das `marke` passt: So lässt
 * sich ein langes Panel an einer seiner eigenen Zeilen abschneiden, statt an einer geratenen Höhe.
 */
async function bis(
    page: Page,
    n: number,
    marke: string,
    k: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.getByTestId("wegfindung").evaluate(
        (element: HTMLElement, { n: index, marke: selektor, k: wievielte }) => {
            const panel = element.querySelectorAll<HTMLElement>(".fenster-karte")[index];
            if (panel === undefined) throw new Error(`Panel ${String(index)} fehlt`);
            const kopf = panel.getBoundingClientRect();
            const schnitt = panel.querySelectorAll<HTMLElement>(selektor)[wievielte];
            const unten = schnitt === undefined ? kopf.bottom : schnitt.getBoundingClientRect().top - 4;
            return {
                x: Math.floor(kopf.left),
                y: Math.floor(kopf.top),
                width: Math.ceil(kopf.width),
                height: Math.ceil(Math.min(unten, kopf.bottom) - kopf.top),
            };
        },
        { n, marke, k },
    );
}

/** Der Ausschnitt von der Leiste ganz oben bis zum Ende des ersten Panels. */
async function leisteMitPanel(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.getByTestId("wegfindung").evaluate((element: HTMLElement) => {
        const leiste = element.querySelector('[data-testid="wegfindung-netz"]');
        const panel = element.querySelector(".fenster-karte");
        if (leiste === null || panel === null) throw new Error("Leiste oder erstes Panel fehlt");
        const oben = leiste.getBoundingClientRect();
        const unten = panel.getBoundingClientRect();
        return {
            x: Math.floor(Math.min(oben.left, unten.left)),
            y: Math.floor(oben.top),
            width: Math.ceil(Math.max(oben.width, unten.width)),
            height: Math.ceil(unten.bottom - oben.top),
        };
    });
}

/**
 * Der Ausschnitt um das rechte Ende EINER Zeile: Feld, Klammer und das Rücksetzen, ohne den Satz darunter. Zweimal
 * genommen stehen der wache und der stille Zustand auf dem Blatt nebeneinander; der Unterschied ist leise.
 */
async function zeilenende(page: Page, n: number): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.getByTestId("wegfindung").evaluate((element: HTMLElement, index: number) => {
        const zeile = element.querySelectorAll<HTMLElement>(".mock-wert")[index];
        const feld = zeile?.querySelector(".mock-wert__feld");
        const taste = zeile?.querySelector(".mock-wert__zurueck");
        if (feld == null || taste == null) throw new Error(`Zeile ${String(index)} fehlt`);
        const links = feld.getBoundingClientRect();
        const rechts = taste.getBoundingClientRect();
        const oben = Math.min(links.top, rechts.top) - 8;
        const unten = Math.max(links.bottom, rechts.bottom) + 2;
        return {
            x: Math.floor(links.left - 12),
            y: Math.floor(oben),
            width: Math.ceil(rechts.right - links.left + 24),
            height: Math.ceil(unten - oben),
        };
    }, n);
}

/** Was auf dem Blatt stehen muss: Die Wächter bewachen das Bild, nicht die Anwendung. */
async function pruefeBild(page: Page): Promise<void> {
    const rumpf = page.getByTestId("wegfindung");
    const soll = [
        // Die drei Panele samt ihrer ruhigen Zeile.
        // Die drei Panele samt ihrer ruhigen Zeile kommen aus der Tafel, nicht aus einer zweiten Liste hier.
        ...PANELE.flatMap((panel) => [panel.titel, panel.wirkung]),
        // Die vier Zwischenüberschriften des dritten Panels.
        "Querfeldein",
        "Seefahrt",
        "Flug",
        "Wasser",
        // Die zwei Formen, um die es geht.
        "statt 0,02 (0,06 Meilen)",
        "Gilt erst nach dem Neuberechnen des Wegenetzes",
        "Herkunft: 25",
        "abweichend",
        "Wegenetz neu berechnen",
        "Zuletzt gebaut:",
        "1 Wert geändert, noch nicht gerechnet",
    ];
    const inhalt = (await rumpf.innerText()).replace(/\s+/gu, " ");
    const fehlt = soll.filter((satz) => !inhalt.includes(satz));
    // Jeder Wert des Bestands steht mit seinem Namen da; keiner darf beim Umbauen verloren gehen.
    const namen = PANELE.flatMap((panel) => panel.werte.map((wert) => wert.name));
    fehlt.push(...namen.filter((name) => !inhalt.includes(name)));
    if (fehlt.length > 0) throw new Error(`auf dem Blatt fehlt: ${fehlt.join(" · ")}`);

    // Ein Feld je Wert, ein Kreis je Wert, einer davon ◐; GENAU EIN stilles Zeichen für die eine Abweichung.
    const zaehle = async (selektor: string): Promise<number> => rumpf.locator(selektor).count();
    const felder = await zaehle("input");
    const abweichend = await zaehle(".status");
    const abschnitte = await zaehle(".mock-abschnitt");
    const pillen = await zaehle(".pille");
    if (felder !== namen.length || abweichend !== 1 || abschnitte !== 4 || pillen !== 0)
        throw new Error(
            `Zustände stimmen nicht: ${String(felder)} Felder für ${String(namen.length)} Werte, ` +
                `${String(abweichend)}× abweichend, ${String(abschnitte)} Zwischenüberschriften, ` +
                `${String(pillen)} Pillen`,
        );
    // Das Panel steht in ZWEI Säulen: der zweite Wert beginnt rechts neben dem ersten, auf gleicher Höhe.
    const zweiSaeulen = await rumpf
        .locator(".mock-werte")
        .first()
        .evaluate((liste: HTMLElement) => {
            const [erste, zweite] = liste.querySelectorAll<HTMLElement>(".mock-wert");
            if (erste === undefined || zweite === undefined) return false;
            const a = erste.getBoundingClientRect();
            const b = zweite.getBoundingClientRect();
            return b.left > a.right - 1 && Math.abs(b.top - a.top) < 4;
        });
    if (!zweiSaeulen) throw new Error("das Panel steht nicht in zwei Säulen");
    // Der Satz steht UNTER dem Namen, nicht rechts daneben.
    const darunter = await rumpf
        .locator(".mock-wert")
        .first()
        .evaluate((zeile: HTMLElement) => {
            const feld = zeile.querySelector(".mock-wert__feld");
            const satz = zeile.querySelector(".mock-wert__satz");
            if (feld === null || satz === null) return false;
            return satz.getBoundingClientRect().top >= feld.getBoundingClientRect().bottom;
        });
    if (!darunter) throw new Error("der Satz steht nicht unter dem Namen");
    // Am Ende jeder Zeile ein Rücksetzen; nur wo etwas abweicht, ist es wach.
    const zurueck = await zaehle(".mock-wert__zurueck button");
    const wach = await zaehle(".mock-wert__zurueck button:not([disabled])");
    if (zurueck !== namen.length || wach !== 2)
        throw new Error(
            `Rücksetzen stimmt nicht: ${String(zurueck)} Zeichen für ${String(namen.length)} Werte, ` +
                `${String(wach)} davon wach (erwartet 2)`,
        );
    // Es steht ganz rechts, nach dem Feld UND seiner Klammer.
    const ganzRechts = await rumpf
        .locator(".mock-wert")
        .first()
        .evaluate((zeile: HTMLElement) => {
            const einheit = zeile.querySelector(".mock-wert__einheit");
            const taste = zeile.querySelector(".mock-wert__zurueck");
            if (einheit === null || taste === null) return false;
            return taste.getBoundingClientRect().left >= einheit.getBoundingClientRect().right - 1;
        });
    if (!ganzRechts) throw new Error("das Rücksetzen steht nicht am Zeilenende");
    // Die Leiste ganz oben trägt den EINEN Auslöser, und unten steht keiner mehr.
    const leiste = page.getByTestId("wegfindung-netz");
    const ausloeser = await leiste.locator('[data-testid="wegfindung-rechnen"]').count();
    const alle = await zaehle('[data-testid="wegfindung-rechnen"]');
    if (ausloeser !== 1 || alle !== 1)
        throw new Error(`der Auslöser stimmt nicht: ${String(ausloeser)} in der Leiste, ${String(alle)} im Reiter`);
    const oben = await rumpf.evaluate((element: HTMLElement) => {
        const bar = element.querySelector('[data-testid="wegfindung-netz"]');
        const karte = element.querySelector(".fenster-karte");
        if (bar === null || karte === null) return false;
        return bar.getBoundingClientRect().bottom <= karte.getBoundingClientRect().top + 1;
    });
    if (!oben) throw new Error("die Leiste steht nicht über den Panelen");
    // Keine Kreise mehr vor den Namen (Betreiber 2026-10-15); der Kreis der Leiste ruht, weil nichts läuft.
    const kreise = await zaehle(".avm-kreis");
    if (kreise !== 0) throw new Error(`es stehen noch ${String(kreise)} Kreise im Reiter`);

    const fuss = await page.getByTestId("systemsteuerung-fenster").locator(".avm-fenster__fuss-hinweis").innerText();
    if (!fuss.includes("Passkey")) throw new Error(`der Fuß nennt den Passkey nicht: ${fuss}`);
}

test("Mockup-Blatt: der Reiter „Wegfindung“ in der Systemsteuerung (WI-0153)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    // (a) bis (c) Die Nahaufnahme in doppelter Dichte. Rund 50 Zeilen passen nicht in ein lesbares Bild, also
    // drei Ausschnitte: ein Panel ganz, die eine Abweichung, und der Anfang des A*-Panels mit zwei Überschriften.
    {
        const { page, close } = await oeffne(browser, baseURL, {
            colorScheme: "light",
            deviceScaleFactor: 2,
            viewport: { width: 1280, height: 2600 },
        });
        await pruefeBild(page);
        await entrolle(page);
        await page.waitForTimeout(300);
        // (a) Die Leiste oben UND das erste Panel in einem Bild: so steht der Auslöser neben der Änderung,
        // die auf ihn wartet.
        merke("panel1", await page.screenshot({ clip: await leisteMitPanel(page) }), 2);
        // Das Rücksetzen, wach und still: der Unterschied ist leise, also eigens und groß, und zweimal getrennt.
        merke("wach", await page.screenshot({ clip: await zeilenende(page, 0) }), 2);
        merke("still", await page.screenshot({ clip: await zeilenende(page, 1) }), 2);
        // Panel 2 bis einschließlich der dritten Zeile: dort steht der von seiner Herkunft abweichende Wert.
        merke("abweichung", await page.screenshot({ clip: await bis(page, 1, ".mock-wert", 3) }), 2);
        // Panel 3 bis vor die dritte Zwischenüberschrift („Flug“): „Querfeldein“ und „Seefahrt“ ganz.
        merke("raster", await page.screenshot({ clip: await bis(page, 2, ".mock-abschnitt", 2) }), 2);
        await close();
    }

    // (d) und (e) Echte Größe im Fenster auf der echten Karte, in zwei Zügen: oben, und beim A*-Panel.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        merke("fenster", await page.screenshot(), 1);
        await page.getByTestId("wegfindung").locator(".fenster-karte").nth(2).scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        merke("fenster2", await page.screenshot(), 1);
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1360, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wegfindung.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: blatt(baseURL) }),
    );
    await sheet.goto("/__wegfindung.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});

function img(key: string, faktor = 1): string {
    const bild = shots[key];
    if (bild === undefined) throw new Error(`Bild fehlt: ${key}`);
    const breite = Math.round((bild.buf.readUInt32BE(16) / bild.dichte) * faktor);
    return `<img src="data:image/png;base64,${bild.buf.toString("base64")}" alt="" style="width:${String(breite)}px">`;
}

function blatt(baseURL: string): string {
    const colour = CANON.colour;
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1296px; }
h1 { margin: 0 0 4px; font-size: 24px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 14px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1180px; }
h2 { margin: 30px 0 8px; padding-top: 16px; border-top: 1px solid ${colour["border"]}; font-size: 19px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.box { padding: 10px 16px; border: 1px solid ${colour["successSoftBorder"]}; border-radius: 8px; background: ${colour["successSoft"]}; font-size: 13px; max-width: 1180px; }
.row { display: flex; flex-wrap: wrap; gap: 14px 28px; align-items: flex-start; }
figure { display: table; margin: 0; }
figcaption { display: table-caption; caption-side: bottom; margin: 6px 0 0; font-size: 12px; color: ${colour["textMuted"]}; max-width: 420px; }
.quellen { margin-top: 24px; font-size: 11px; color: ${colour["textMuted"]}; max-width: 1240px; }
</style></head><body>

<h1>Systemsteuerung &rsaquo; Wegfindung &middot; Mockup (WI-0153)</h1>
<p class="lead">Einundfünfzig Zahlen entscheiden heute über Routen, und keine davon ist zu sehen. Dieser Reiter sammelt den ganzen Bestand in drei Panelen:
<b>Allgemeine Wegfindungseinstellungen</b>, <b>Dijkstra-Einstellungen</b> und <b>A* Einstellungen</b>. Unter jeder Überschrift steht eine ruhige Zeile, wann die Werte greifen,
damit die Zuordnung dasteht, ohne dass eine Überschrift etwas behauptet, was der Code nicht tut. Je Zeile zwei Spalten: links Name, Feld und Einheit, rechts ein Satz in Alltagssprache.
Echte Systemsteuerung auf der echten Karte, Stage, angemeldet „Rondrikan“ als Betreiber mit „Systemschalter“. Die Werte sind die echten des laufenden Standes,
die Meilen daraus gerechnet (1 Karteneinheit = 3 Meilen). Reiter und Rumpf sind im Browser eingehängt; am App-Code ist nichts geändert.</p>

<div class="box">
<p style="margin:0">Alle Werte sind änderbar, mit Passkey; die Pille „fest“ gibt es nicht mehr. Ein Wert aus dem Reisemodell trägt seine Herkunft unter sich, und beim „Querfeldein-Aufschlag“ ist zu sehen, wie das aussieht, wenn jemand ihn verstellt hat.
Weil über fünfzig Zeilen in kein lesbares Bild passen, zeigt die Nahaufnahme ein Panel ganz, die eine Abweichung und den Anfang des A*-Panels; die echte Größe darunter zeigt in zwei Zügen, wie viel davon auf einmal im Fenster steht.</p>
</div>

<h2>(a) Die Leiste und das erste Panel <span>&middot; Nahaufnahme, doppelte Dichte; der Auslöser oben, darunter die Änderung, die auf ihn wartet</span></h2>
${img("panel1")}

<h2>(a2) Das Rücksetzen <span>&middot; vierfache Dichte, das rechte Ende zweier Zeilen</span></h2>
<div class="row">
<figure>${img("wach", 2)}<figcaption>Wach: „Fangradius am Wegende“ steht auf 0,03, die Vorgabe ist 0,02. Der Titel des Zeichens nennt sie.</figcaption></figure>
<figure>${img("still", 2)}<figcaption>Still: „Ortskasten“ steht auf seiner Vorgabe. Das Zeichen hat weder Rand noch Fläche und lässt sich nicht drücken.</figcaption></figure>
</div>

<h2>(b) Ein Wert, der von seiner Herkunft abweicht <span>&middot; Anfang des zweiten Panels</span></h2>
${img("abweichung")}

<h2>(c) Der Anfang des A*-Panels <span>&middot; mit zwei seiner vier Zwischenüberschriften</span></h2>
${img("raster")}

<h2>(d) Echte Größe <span>&middot; im Fenster „Systemsteuerung“ auf der Karte, 1280 &times; 900</span></h2>
${img("fenster")}

<h2>(e) Echte Größe, weiter unten <span>&middot; dasselbe Fenster, gerollt bis zum A*-Panel</span></h2>
${img("fenster2")}

<p class="quellen">Quellen der Werte (alle <code>apps/server/src/</code> oder <code>packages/</code>, sofern nicht anders genannt): ${QUELLEN.join(" &middot; ")}.
Bewusst draußen, weil Datenformat und nicht Einstellung: <code>PAIR_FLOATS</code>, <code>SAMPLE_HEADER</code>, <code>SAMPLE_POINT</code>, <code>STEP_FLOATS</code>, <code>SEA_GRAPH_FORMAT</code> und die Markierungswerte <code>WATER</code>, <code>WALL</code>, <code>BLOCKED</code>, <code>KIND_*</code>.
Entscheidung zum Fangradius: project-control/work-items/WI-0147 und project-control/decisions/2026-10-10-wegenden-verbinden-ohne-kreuzungsobjekte.md.
Vorbilder der Form: apps/web/src/auth/verwaltung-hoehenmodell.vue und verwaltung-betrieb.vue.
Erzeugt mit npm run review:wegfindung (apps/web/e2e/wegfindung-review.spec.ts, Werte in wegfindung-werte.ts, Einbau in wegfindung-mockup.ts).</p>
</body></html>`;
}
