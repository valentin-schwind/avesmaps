import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";

/**
 * Blatt zu WI-0098: **alle einzeiligen Klappboxen des Hauses, vorher gegen nachher.**
 *
 * Betreiber 2026-10-07: „was mich stört ist, dass klappboxen alle wieder unterschiedlich hoch sind. die sollen eine
 * einheitliche höhe haben (beispiele oneliner), im routenplaner wie im infopanel etc.“ — und am Bildschirmfoto der
 * Zeile „88 Handelswaren gelistet“, deren Pfeil in eine zweite Zeile gerutscht war: „das darf nicht passieren“.
 *
 * 💣 Dieser Lauf prüft NICHTS; die Prüfung steht in `e2e/klappbox-hoehe.spec.ts` (drei benannte Fälle: die eine
 * Höhe über alle Stellen, einzeilig bleibt einzeilig, und die Versalmitte).
 *
 * 🔴 „Vorher“ entsteht aus DEMSELBEN Stand: Ein Stilzettel stellt genau die geänderten Deklarationen zurück.
 *
 *   npm run review:klappbox-hoehe
 *
 * Ablage: `review/wi-0098/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0098");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const REISE = "?route=Gareth~Greifenfurt";
const RECHNER = { width: 1280, height: 1000 };
const TELEFON = { width: 360, height: 900 };
/** Die Landschaft „Aventurien“: die höchsten Vorkommenszahlen des Bestands (304 · 383 · 445 · 44). */
const AVENTURIEN = { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f846" } as const;
/** Die längste Aufschrift, die der Bestand hergeben kann: `lore_entry` führt 2.553 Waren (2026-10-07). */
const LAENGSTE = "2.553 Handelswaren gelistet";

/**
 * Der Stand vor WI-0098, Deklaration für Deklaration:
 * 1. keine gemeinsame Kopfhöhe (jede Klappbox so hoch, wie ihr Polster und ihr Zeilenkasten sie machten),
 * 2. der Deckel ohne senkrechte Zentrierung (Block statt Spalte),
 * 3. die Reihe im Deckel umbrechend, die Aufschrift ohne Nachgeben und ohne Kürzung.
 */
const VORHER = `.avm-klappbox-kopf { min-height: auto !important; }
.info-lid__summary { display: block !important; }
.info-lid__foot { flex-wrap: wrap !important; }
.info-lid__summary-text, .info-lid__unit {
    flex: 0 1 auto !important;
    min-width: auto !important;
}
.info-lid__summary-text.einzeilig, .info-lid__unit.einzeilig {
    overflow: visible !important;
    padding-bottom: 0 !important;
    margin-bottom: 0 !important;
    text-overflow: clip !important;
    white-space: normal !important;
}`;

type Scheme = "light" | "dark";
type Groesse = { width: number; height: number };

let client = 90;
async function neu(browser: Browser, baseURL: string, scheme: Scheme, size: Groesse, dpr = 4) {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: size,
        colorScheme: scheme,
        deviceScaleFactor: dpr,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.9.${String(client)}` },
    });
    return { context, page: await context.newPage() };
}

async function openRoute(page: Page): Promise<void> {
    await page.goto(`/${REISE}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("route-title").waitFor({ timeout: 60_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
}

async function openPanel(page: Page): Promise<void> {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), AVENTURIEN);
    await page.getByTestId("info-title").waitFor({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
}

/** Alle Klappboxen zuklappen - nur zugeklappt steht die Kurzangabe des Planers da. */
async function alleZu(page: Page): Promise<void> {
    for (const toggle of await page.locator(".disclosure__summary").all()) {
        if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    }
    await page.waitForTimeout(400);
}

/**
 * Zeichnet OBER- und UNTERKANTE der zugeklappten Kopfzeile als Haarlinien ein - 0,5 CSS-Pixel, bei vierfacher
 * Pixeldichte also zwei Gerätepixel. 🪤 Die Linien gehören IN die Kopfzeile, nicht in die Klappbox: Ein zugeklapptes
 * `<details>` zeichnet von seinen Kindern nur das `<summary>`.
 */
async function kantenEin(page: Page, farbe: string): Promise<void> {
    await page.evaluate(
        ({ farbe }) => {
            for (const kopf of document.querySelectorAll<HTMLElement>(".disclosure__summary, .info-lid__summary")) {
                if (kopf.getBoundingClientRect().height === 0) continue;
                kopf.style.position = "relative";
                for (const kante of ["top", "bottom"]) {
                    const linie = document.createElement("div");
                    linie.dataset["kante"] = "1";
                    linie.style.cssText = `position:absolute;left:0;right:0;${kante}:-0.25px;height:0.5px;background:${farbe};pointer-events:none;z-index:9`;
                    kopf.append(linie);
                }
            }
        },
        { farbe },
    );
    await page.waitForTimeout(150);
}

async function kantenWeg(page: Page): Promise<void> {
    await page.evaluate(() => {
        for (const linie of document.querySelectorAll("[data-kante]")) linie.remove();
    });
}

/** Setzt in jede Deckelaufschrift die längste Zeichenfolge des Bestands - eine Sonde, nichts am Erzeugnis. */
async function sondeEin(page: Page, text: string): Promise<void> {
    await page.evaluate((text) => {
        for (const feld of document.querySelectorAll<HTMLElement>(".info-lid__summary-text")) {
            if (feld.dataset["sonde"] === undefined) feld.dataset["sonde"] = feld.textContent ?? "";
            feld.textContent = text;
        }
    }, text);
    await page.waitForTimeout(200);
}

/** Ein Ausschnitt um einen Kasten, mit ein paar Pixeln Luft; `breite` schneidet die lange Zeile ab. */
function ausschnitt(
    page: Page,
    wahl: string,
    breite?: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.evaluate(
        ({ wahl, breite }) => {
            const box = document.querySelector(wahl)!.getBoundingClientRect();
            return {
                x: Math.round(box.left) - 2,
                y: Math.round(box.top) - 2,
                width: breite ?? Math.round(box.width) + 4,
                height: Math.round(box.height) + 4,
            };
        },
        { wahl, breite },
    );
}

/** Ein Ausschnitt von der Oberkante des ersten bis zur Unterkante des letzten Kastens. */
function spalte(
    page: Page,
    erster: string,
    letzter: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.evaluate(
        ({ erster, letzter }) => {
            const a = document.querySelector(erster)!.getBoundingClientRect();
            const b = document.querySelector(letzter)!.getBoundingClientRect();
            return {
                x: Math.round(a.left) - 2,
                y: Math.round(a.top) - 2,
                width: Math.round(a.width) + 4,
                height: Math.round(b.bottom - a.top) + 4,
            };
        },
        { erster, letzter },
    );
}

interface Paar {
    vorher: Buffer;
    nachher: Buffer;
}

/** Fährt eine Szene zweimal: mit Stilzettel (vorher) und ohne (nachher), und schießt dieselben Ausschnitte. */
async function paare(
    page: Page,
    schuesse: () => Promise<Record<string, Buffer>>,
    vorbereiten?: () => Promise<void>,
): Promise<Record<string, Paar>> {
    const zettel = await page.addStyleTag({ content: VORHER });
    await page.waitForTimeout(250);
    if (vorbereiten) await vorbereiten();
    const vorher = await schuesse();
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(300);
    if (vorbereiten) await vorbereiten();
    const nachher = await schuesse();
    const out: Record<string, Paar> = {};
    for (const [name, bild] of Object.entries(nachher)) {
        const v = vorher[name];
        if (v !== undefined) out[name] = { vorher: v, nachher: bild };
    }
    return out;
}

const PLANER_IDS = ["planner-transport", "planner-options", "planning-profile", "planning-costs"] as const;

/** Die vier Klappboxen des Planers, einzeln und vierfach vergrößert. */
async function planerNah(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: Groesse,
): Promise<Record<string, Paar>> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page);
    await alleZu(page);
    const farbe = CANON.colour["danger"] ?? "#9d3a2e";
    const out = await paare(
        page,
        async () => {
            const bilder: Record<string, Buffer> = {};
            for (const id of PLANER_IDS) {
                if ((await page.locator(`[data-testid="${id}"]`).count()) === 0) continue;
                await page.locator(`[data-testid="${id}"]`).scrollIntoViewIfNeeded();
                await page.waitForTimeout(120);
                bilder[id] = await page.screenshot({ clip: await ausschnitt(page, `[data-testid="${id}"]`, 186) });
            }
            return bilder;
        },
        async () => {
            await kantenWeg(page);
            await alleZu(page);
            await kantenEin(page, farbe);
        },
    );
    await context.close();
    return out;
}

/** Die Deckel des Infopanels: die vier Vorkommenszeilen und „Erstreckt sich über 14 politische Gebiete“. */
async function panelNah(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: Groesse,
): Promise<Record<string, Paar>> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openPanel(page);
    const farbe = CANON.colour["danger"] ?? "#9d3a2e";
    const out = await paare(
        page,
        async () => {
            const bilder: Record<string, Buffer> = {};
            const anzahl = await page.locator(".info-lid").count();
            for (let i = 0; i < Math.min(anzahl, 5); i += 1) {
                const lid = page.locator(".info-lid").nth(i);
                await lid.scrollIntoViewIfNeeded();
                await page.waitForTimeout(120);
                const box = await lid.boundingBox();
                if (box === null) continue;
                bilder[`lid${String(i)}`] = await page.screenshot({
                    clip: {
                        x: Math.round(box.x) - 2,
                        y: Math.round(box.y) - 2,
                        width: Math.min(Math.round(box.width) + 4, 260),
                        height: Math.round(box.height) + 4,
                    },
                });
            }
            return bilder;
        },
        async () => {
            await kantenWeg(page);
            await kantenEin(page, farbe);
        },
    );
    await context.close();
    return out;
}

/** Der harte Fall: die längste Aufschrift des Bestands, vorher gegen nachher. */
async function harterFall(browser: Browser, baseURL: string, scheme: Scheme, size: Groesse): Promise<Paar | undefined> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openPanel(page);
    const out = await paare(
        page,
        async () => {
            const lid = page.locator(".info-lid").nth(1);
            await lid.scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            const box = await lid.boundingBox();
            if (box === null) return {};
            return {
                fall: await page.screenshot({
                    clip: {
                        x: Math.round(box.x) - 2,
                        y: Math.round(box.y) - 2,
                        width: Math.min(Math.round(box.width) + 4, 300),
                        height: Math.round(box.height) + 4,
                    },
                }),
            };
        },
        async () => {
            await sondeEin(page, LAENGSTE);
        },
    );
    await context.close();
    return out["fall"];
}

/** In ECHTER Größe: der Planerstapel und die Feldliste des Panels, so wie der Betreiber sie sieht. */
async function echteGroesse(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: Groesse,
    was: "planer" | "panel",
): Promise<Paar | undefined> {
    const { context, page } = await neu(browser, baseURL, scheme, size, 1);
    if (was === "planer") {
        await openRoute(page);
        await alleZu(page);
    } else {
        await openPanel(page);
    }
    const out = await paare(
        page,
        async () => {
            /*
             * In echter Groesse zeigt das Panel die ganze Feldliste: Dort stehen die vier Vorkommenszeilen
             * untereinander, und genau ihr Hoehenunterschied zu den gewoehnlichen Feldzeilen war zu sehen.
             */
            const clip =
                was === "planer"
                    ? await spalte(page, '[data-testid="planner-transport"]', '[data-testid="planner-options"]')
                    : await ausschnitt(page, '[data-testid="info-facts"]');
            return { echt: await page.screenshot({ clip }) };
        },
        was === "planer"
            ? async () => {
                  await alleZu(page);
              }
            : undefined,
    );
    await context.close();
    return out["echt"];
}

const image = (png: Buffer): string => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`;

function zelle(titel: string, paar: Paar | undefined): string {
    if (paar === undefined) return `<div><p>${titel}</p><p class="fehlt">steht hier nicht</p></div>`;
    return `<div><p>${titel} · <b>vorher</b></p>${image(paar.vorher)}<p class="nach">${titel} · nachher</p>${image(paar.nachher)}</div>`;
}

function reihe(paare: Record<string, Paar>, namen: readonly { id: string; titel: string }[]): string {
    return namen.map((n) => zelle(n.titel, paare[n.id])).join("\n");
}

test("Blatt WI-0098: alle einzeiligen Klappboxen auf eine Höhe", async ({ browser }, testInfo) => {
    test.setTimeout(2_400_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const planerHell = await planerNah(browser, baseURL, "light", RECHNER);
    const planerDunkel = await planerNah(browser, baseURL, "dark", RECHNER);
    const planerSchmal = await planerNah(browser, baseURL, "light", TELEFON);
    const panelHell = await panelNah(browser, baseURL, "light", RECHNER);
    const panelDunkel = await panelNah(browser, baseURL, "dark", RECHNER);
    const panelSchmal = await panelNah(browser, baseURL, "light", TELEFON);
    const fallBreit = await harterFall(browser, baseURL, "light", RECHNER);
    const fallSchmal = await harterFall(browser, baseURL, "light", TELEFON);
    const fallSchmalDunkel = await harterFall(browser, baseURL, "dark", TELEFON);
    const echtPlanerHell = await echteGroesse(browser, baseURL, "light", RECHNER, "planer");
    const echtPlanerDunkel = await echteGroesse(browser, baseURL, "dark", RECHNER, "planer");
    const echtPanelHell = await echteGroesse(browser, baseURL, "light", RECHNER, "panel");
    const echtPanelDunkel = await echteGroesse(browser, baseURL, "dark", RECHNER, "panel");
    const echtPanelSchmal = await echteGroesse(browser, baseURL, "light", TELEFON, "panel");

    const PLANER = [
        { id: "planner-transport", titel: "Transportmittel" },
        { id: "planner-options", titel: "Reiseoptionen" },
        { id: "planning-profile", titel: "Höhenprofil" },
        { id: "planning-costs", titel: "Reisekosten" },
    ] as const;
    const PANEL = [
        { id: "lid0", titel: "Erstreckt sich über …" },
        { id: "lid1", titel: "304 Handelswaren" },
        { id: "lid2", titel: "383 Tierarten" },
        { id: "lid3", titel: "445 Pflanzenarten" },
        { id: "lid4", titel: "44 Spezies" },
    ] as const;

    const colour = CANON.colour;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1620px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 14px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1200px; }
h2 { margin: 22px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.reihe { display: grid; grid-template-columns: repeat(5, max-content); gap: 12px 16px; align-items: start; }
.reihe.vier { grid-template-columns: repeat(4, max-content); }
.reihe.drei { grid-template-columns: repeat(3, max-content); }
.reihe p { margin: 0 0 4px; font-size: 12px; color: ${colour["textMuted"]}; }
.reihe p.nach { margin-top: 7px; }
.reihe p b { font-weight: 400; color: ${colour["danger"]}; }
img { display: block; border: 1px solid ${colour["border"]}; image-rendering: pixelated; }
.echt img { image-rendering: auto; }
table { border-collapse: collapse; margin: 6px 0 12px; font-size: 13px; }
th, td { padding: 3px 20px 3px 0; text-align: left; font-weight: 400; vertical-align: top; }
th { color: ${colour["textMuted"]}; border-bottom: 1px solid ${colour["border"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
td i { font-style: normal; color: ${colour["danger"]}; }
.fehlt { width: 240px; padding: 10px; border: 1px dashed ${colour["border"]}; border-radius: 8px; font-size: 12px; color: ${colour["textMuted"]}; }
.note { margin: 14px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1200px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Alle einzeiligen Klappboxen auf eine Höhe</h1>
<p class="lead">Alle Nahaufnahmen vierfach vergrößert; die zwei dünnen Linien sind <b>Oberkante und Unterkante der
zugeklappten Kopfzeile</b> (je zwei Gerätepixel). „Vorher“ ist derselbe Stand mit einem Stilzettel, der genau die
geänderten Deklarationen zurückstellt. Die Höhen sind am gezeichneten Bild gemessen und bei 1280 px wie bei 360 px,
hell wie dunkel, auf die Hundertstel gleich.</p>

<table>
<tr><th>Ort</th><th>Bauteil</th><th>vorher</th><th>nachher</th><th>woraus die Höhe entstand</th></tr>
<tr><td>Planer „Transportmittel“, „Reiseoptionen“</td><td>avm-disclosure, einzeilig</td><td>22,00 px</td><td><b>22,00 px</b></td><td>Symbolzeile 16 px + 2 × 3 px Polster — die einzige gesetzte der drei</td></tr>
<tr><td>Routendetails (Höhenprofil, Reisekosten, Eiltempo, Schiffe, Landschaften)</td><td>avm-disclosure</td><td><i>21,94 px</i></td><td><b>22,00 px</b></td><td>Zeilenkasten von 11-px-Schrift (15,94) + 2 × 3 px</td></tr>
<tr><td>Infopanel: „Erstreckt sich über …“, „Verläuft durch …“, die vier Vorkommenszeilen</td><td>info-lid</td><td><i>16,08 px</i></td><td><b>22,00 px</b></td><td>auf die Versalhöhe geschnittener Kasten des 13-px-Winkels (10,08) + 2 × 3 px</td></tr>
<tr><td>Infopanel bei 360 px, lange Aufschrift</td><td>info-lid</td><td><i>29,38 px</i> (Pfeil umgebrochen)</td><td><b>22,00 px</b></td><td>zwei Reihen, weil die Aufschrift nicht nachgab</td></tr>
<tr><td>Deckel mit Vorschau („33 Orte auf dem Weg“)</td><td>info-lid, zweizeilig</td><td>33,47 px</td><td>33,47 px</td><td><b>unberührt</b> — mehrzeilig bleibt mehrzeilig</td></tr>
<tr><td>Abschnittskopf „Literatur zu Gareth (85)“</td><td>info-section</td><td>40,41 px</td><td>40,41 px</td><td><b>andere Gattung</b> — Polster 2 × 14 px nach Betreiberentscheid (WI-0088 P2)</td></tr>
</table>

<h2>Der Routenplaner <span>· Rechner, hell — die zwei Leisten und die Deckel der Routendetails</span></h2>
<div class="reihe vier">${reihe(planerHell, PLANER)}</div>

<h2>Dieselben vier · Rechner, dunkel</h2>
<div class="reihe vier">${reihe(planerDunkel, PLANER)}</div>

<h2>Dieselben vier · 360 px</h2>
<div class="reihe vier">${reihe(planerSchmal, PLANER)}</div>

<h2>Das Infopanel <span>· Rechner, hell — der Deckel „Liegt in“ und die vier Vorkommenszeilen</span></h2>
<div class="reihe">${reihe(panelHell, PANEL)}</div>

<h2>Dieselben fünf · Rechner, dunkel</h2>
<div class="reihe">${reihe(panelDunkel, PANEL)}</div>

<h2>Dieselben fünf · 360 px <span>· hier brach der Pfeil um</span></h2>
<div class="reihe">${reihe(panelSchmal, PANEL)}</div>

<h2>Der harte Fall <span>· die längste Aufschrift, die der Bestand hergibt: „${LAENGSTE}“ (2.553 Waren in <code>lore_entry</code>)</span></h2>
<div class="reihe drei">
${zelle("1280 px · hell", fallBreit)}
${zelle("360 px · hell", fallSchmal)}
${zelle("360 px · dunkel", fallSchmalDunkel)}
</div>

<h2>In echter Größe <span>· so stehen sie da</span></h2>
<div class="reihe echt">
${zelle("Planer · hell", echtPlanerHell)}
${zelle("Planer · dunkel", echtPlanerDunkel)}
${zelle("Panel · hell", echtPanelHell)}
${zelle("Panel · dunkel", echtPanelDunkel)}
${zelle("Panel · 360 px", echtPanelSchmal)}
</div>

<p class="note"><b>Was zu sehen ist:</b> Drei Höhen standen nebeneinander, und keine davon war gesetzt — nur die
22,00 px des Planers sind eine Entscheidung (eine Kopfzeile mit Symbol darf nicht höher stehen als eine ohne,
Befund vom 2026-09-24). Die beiden anderen waren Zufall: der Zeilenkasten der 11-px-Schrift in den Routendetails,
der auf die Versalhöhe geschnittene Winkel im Infopanel. Jetzt sagt <b>eine Regel</b> die Höhe
(<code>.avm-klappbox-kopf</code> in <code>canon.css</code>, gerechnet aus den Kanonwerten <code>icon.sm</code> und
<code>space.4</code>), und beide Bauteile holen sie dort. <b>Der Text sitzt weiter mittig</b> — die Reihe im Deckel
ist senkrecht zentriert, gemessen 0,00 px von der Versalmitte. <b>Und die Aufschrift bricht nicht mehr um:</b> Sie
gibt nach und kürzt am Ende mit „…“, genau wie die Kurzangabe des Planers, während Zahl und Pfeil ihren Platz
behalten. <b>Mehrzeiliges ist unberührt</b> — der Deckel mit Vorschau steht auf denselben 33,47 px wie vorher.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1684, height: 1100 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0098.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0098.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(700);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
