import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Nachtragsblatt WI-0089: die vier Stellen, die der Betreiber am 2026-10-06 nach dem ersten Blatt genannt hat.
 *
 * 💣 Dieser Lauf prüft NICHTS; die Prüfungen stehen in `e2e/planer-nachgang.spec.ts` (N1 bis N5).
 *
 * 🔴 „Vorher" entsteht, wo es geht, aus DEMSELBEN Stand: Ein Stilzettel stellt genau die geänderte Deklaration
 * zurück (P2 die Schriftstufe, P3a der Umbruch der Kurzangabe, P3c die Ausrichtung von ⓘ und Winkel, P4 die vier
 * festen Spalten). **Nur P3b geht so nicht** - dort fehlt die Kurzangabe im offenen Zustand als ELEMENT. Läuft
 * dieser Lauf auf einem Stand, der sie offen noch zeigt, legt er sein Bild nach `stand2/vorher-offen-*.png`; das
 * Blatt nimmt es beim nächsten Lauf auf.
 *
 *   npm run review:planer-nachgang
 *
 * Ablage: `review/wi-0089/nachtrag.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0089");
const STAND = resolve(OUTPUT, "stand2");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const REISE = "?route=Gareth~Greifenfurt";
const LANGE_REISE = "?route=Thorwal~Al'Anfa";
const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;
const WEG = { kind: "path", chain: "Misamunder Straße:Strasse" } as const;

/** Der Stand VOR diesem Nachgang, je als Stilzettel. */
const VORHER_P2 = `.kennzahl__wert { font-size: var(--font-size-title) !important; }`;
const VORHER_P3A = `.disclosure--einzeilig .disclosure__labels { flex-wrap: wrap !important; }
.disclosure--einzeilig .disclosure__secondary { flex: 0 1 auto !important; white-space: normal !important; overflow: visible !important; }`;
const VORHER_P3C = `.disclosure__info, .disclosure__arrow { align-self: auto !important; }`;
const VORHER_P4 = `.info-actions__grid { grid-auto-flow: row !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }`;
/** Der Takt der Spalte vor dem 2026-10-06: `gap` 8 px und ein eigener Rand am Ergebnis. */
const VORHER_TAKT = `.planner { gap: var(--space-6) !important; } .result { margin-top: var(--space-2) !important; }`;
/** Die untere Rundung des aufgeklappten Kopfes, wie sie vorher war. */
const VORHER_ECKEN = `.avm-kopf-offen.avm-kopf-offen { border-end-start-radius: calc(var(--radius-md) - 1px) !important; border-end-end-radius: calc(var(--radius-md) - 1px) !important; }`;

type Scheme = "light" | "dark";
const RECHNER = { width: 1280, height: 1000 };
const TELEFON = { width: 360, height: 900 };

let client = 40;
async function neu(browser: Browser, baseURL: string, scheme: Scheme, size: { width: number; height: number }) {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: size,
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.2.${String(client)}` },
    });
    return { context, page: await context.newPage() };
}

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-title").waitFor({ timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await page.waitForTimeout(400);
}

async function setBoxen(page: Page, open: boolean): Promise<void> {
    for (const id of ["planner-transport", "planner-options"]) {
        const toggle = page.locator(`[data-testid="${id}"] summary`).first();
        if (((await toggle.getAttribute("aria-expanded")) === "true") !== open) await toggle.click();
        await page.waitForTimeout(350);
    }
    await page.waitForTimeout(250);
}

/** Der Ausschnitt um beide Kästen. */
async function boxenBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.evaluate(() => {
        const panel = document.querySelector("#route-planner-panel")!.getBoundingClientRect();
        const a = document.querySelector('[data-testid="planner-transport"]')!.getBoundingClientRect();
        const b = document.querySelector('[data-testid="planner-options"]')!.getBoundingClientRect();
        return {
            x: Math.round(panel.left),
            y: Math.round(a.top) - 6,
            width: Math.round(panel.width),
            height: Math.round(b.bottom - a.top) + 12,
        };
    });
}

/** Die rechte Ecke der Kopfzeile mit ⓘ und Winkel, vergrößert gezeigt. */
async function eckeBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.evaluate(() => {
        const kopf = document.querySelector('[data-testid="planner-options"] summary')!.getBoundingClientRect();
        return {
            x: Math.round(kopf.right) - 60,
            y: Math.round(kopf.top),
            width: 58,
            height: Math.round(kopf.height),
        };
    });
}

async function p2(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
): Promise<{ vorher: Buffer; nachher: Buffer }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page, LANGE_REISE);
    await openStageGroups(page);
    const rows = page.getByTestId("route-stage");
    const count = await rows.count();
    for (let at = 0; at < count; at += 1) {
        await rows.nth(at).locator("img").first().click();
        await page.getByTestId("stage-figures").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(150);
        if ((await page.locator('[data-testid="stage-figures"] .kennzahl').count()) === 3) break;
    }
    const kasten = page.getByTestId("stage-figures");
    await kasten.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const zettel = await page.addStyleTag({ content: VORHER_P2 });
    await page.waitForTimeout(150);
    const vorher = await kasten.screenshot();
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    const nachher = await kasten.screenshot();
    await context.close();
    return { vorher, nachher };
}

async function p3(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
): Promise<{ zuVorher: Buffer; zuNachher: Buffer; auf: Buffer; alt: boolean }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page, REISE);
    await setBoxen(page, false);

    // Zugeklappt: die Kurzangabe als Ganzes umgebrochen gegen einzeilig gekürzt.
    const zettelA = await page.addStyleTag({ content: VORHER_P3A });
    await page.waitForTimeout(200);
    const zuVorher = await page.screenshot({ clip: await boxenBox(page) });
    await zettelA.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(250);
    const zuNachher = await page.screenshot({ clip: await boxenBox(page) });

    // Aufgeklappt: ob die Kurzangabe noch dasteht, entscheidet der Stand.
    await setBoxen(page, true);
    const alt = (await page.locator('[data-testid="planner-options"] .disclosure__secondary').count()) > 0;
    const auf = await page.screenshot({ clip: await boxenBox(page) });
    await context.close();
    return { zuVorher, zuNachher, auf, alt };
}

/** Die Ecke mit ⓘ und Winkel, vierfach aufgelöst: nur so ist ein Versatz von 3,5 px im Bild zu sehen. */
async function ecke(browser: Browser, baseURL: string, scheme: Scheme): Promise<{ vorher: Buffer; nachher: Buffer }> {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: RECHNER,
        colorScheme: scheme,
        deviceScaleFactor: 4,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.2.${String(client)}` },
    });
    const page = await context.newPage();
    await openRoute(page, REISE);
    await setBoxen(page, false);
    const zettel = await page.addStyleTag({ content: VORHER_P3C });
    await page.waitForTimeout(200);
    const vorher = await page.screenshot({ clip: await eckeBox(page) });
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    const nachher = await page.screenshot({ clip: await eckeBox(page) });
    await context.close();
    return { vorher, nachher };
}

async function p4(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
    subject: Record<string, unknown>,
): Promise<{ vorher: Buffer; nachher: Buffer }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref as never), subject);
    await page.getByTestId("info-actions").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    const band = page.getByTestId("info-actions");
    const zettel = await page.addStyleTag({ content: VORHER_P4 });
    await page.waitForTimeout(200);
    const vorher = await band.screenshot();
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    const nachher = await band.screenshot();
    await context.close();
    return { vorher, nachher };
}

/** Die ganze Spalte des Planers, von den Wegpunkten bis zur Reiseübersicht - vorher und nachher. */
async function takt(browser: Browser, baseURL: string, scheme: Scheme): Promise<{ vorher: Buffer; nachher: Buffer }> {
    const { context, page } = await neu(browser, baseURL, scheme, { width: 1280, height: 1200 });
    await openRoute(page, REISE);
    await setBoxen(page, false);
    const clip = await page.evaluate(() => {
        const panel = document.querySelector("#route-planner-panel")!.getBoundingClientRect();
        const a = document.querySelector(".planner__waypoints")!.getBoundingClientRect();
        const b = document.querySelector('[data-testid="route-result"]')!.getBoundingClientRect();
        return {
            x: Math.round(panel.left),
            y: Math.round(a.top) - 6,
            width: Math.round(panel.width),
            height: Math.min(Math.round(b.top - a.top) + 44, Math.round(innerHeight - a.top) - 4),
        };
    });
    const zettel = await page.addStyleTag({ content: VORHER_TAKT });
    await page.waitForTimeout(200);
    const vorher = await page.screenshot({ clip });
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(250);
    const nachher = await page.screenshot({ clip });
    await context.close();
    return { vorher, nachher };
}

/**
 * Die Leiste „Reiseoptionen" mit ihrer Kurzangabe. Für das „Vorher" wird der TEXT der Kurzangabe auf den Stand von
 * vorher gesetzt („8,0 h/Tag") - die Fläche, ihre Breite und ihre Schrift sind die echten.
 */
async function leiste(browser: Browser, baseURL: string, scheme: Scheme): Promise<{ vorher: Buffer; nachher: Buffer }> {
    const { context, page } = await neu(browser, baseURL, scheme, RECHNER);
    await openRoute(page, REISE);
    await setBoxen(page, false);
    const box = page.getByTestId("planner-options");
    const voll = await page.evaluate(() => {
        const sec = document.querySelector<HTMLElement>('[data-testid="planner-options"] .disclosure__secondary')!;
        const alt = sec.innerHTML;
        sec.textContent = "8,0 h/Tag";
        return alt;
    });
    await page.waitForTimeout(200);
    const vorher = await box.screenshot();
    await page.evaluate((html) => {
        document.querySelector<HTMLElement>('[data-testid="planner-options"] .disclosure__secondary')!.innerHTML = html;
    }, voll);
    await page.waitForTimeout(200);
    const nachher = await box.screenshot();
    await context.close();
    return { vorher, nachher };
}

/** Der Kopf einer aufgeklappten Mediengruppe, vierfach aufgelöst: nur so sieht man eine Rundung von 7 px. */
async function ecken(browser: Browser, baseURL: string, scheme: Scheme): Promise<{ vorher: Buffer; nachher: Buffer }> {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: RECHNER,
        colorScheme: scheme,
        deviceScaleFactor: 4,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.2.${String(client)}` },
    });
    const page = await context.newPage();
    await openRoute(page, LANGE_REISE);
    await openStageGroups(page);
    const kopf = page.locator('[data-testid="route-stage-group"] .group__head').first();
    await kopf.scrollIntoViewIfNeeded();
    /*
     * 🪤 Der Kopf trägt in Ruhe KEINE eigene Fläche - der Kasten darum tut es. Seine Rundung sieht man erst, wenn er
     * eine bekommt: beim Überfahren (`--color-panel-active`), beim Drücken und im Fokusring. Genau so stand der
     * Betreiber davor, als er es bemängelte; genau so wird es hier aufgenommen.
     */
    await kopf.hover();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => {
        const element = document.querySelector('[data-testid="route-stage-group"] .group__head')!;
        const kasten = element.getBoundingClientRect();
        // Nur die linke untere Ecke: Über die ganze Breite geht eine Rundung von 7 px im Bild unter.
        return {
            x: Math.round(kasten.left) - 3,
            y: Math.round(kasten.bottom) - 13,
            width: 34,
            height: 20,
        };
    });
    const zettel = await page.addStyleTag({ content: VORHER_ECKEN });
    await page.waitForTimeout(200);
    const vorher = await page.screenshot({ clip });
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    const nachher = await page.screenshot({ clip });
    await context.close();
    return { vorher, nachher };
}

const image = (png: Buffer): string => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`;

function altesBild(name: string): string {
    const file = resolve(STAND, `vorher-${name}.png`);
    if (!existsSync(file)) {
        return `<p class="fehlt">Vorher-Bild fehlt (<code>stand2/vorher-${name}.png</code>) – es entsteht bei einem Lauf auf dem Stand vor diesem Nachgang.</p>`;
    }
    return image(readFileSync(file));
}

test("Nachtragsblatt WI-0089: Zahlen bei 360 px, einzeilige Leiste, ⓘ und Winkel, Spalten je Kachel", async ({
    browser,
}, testInfo) => {
    test.setTimeout(1_800_000);
    const baseURL = String(testInfo.project.use.baseURL);
    mkdirSync(STAND, { recursive: true });

    const p2Schmal = await p2(browser, baseURL, "light", TELEFON);
    const p2SchmalDunkel = await p2(browser, baseURL, "dark", TELEFON);
    const p2Rechner = await p2(browser, baseURL, "light", RECHNER);

    const p3Hell = await p3(browser, baseURL, "light", RECHNER);
    const p3Dunkel = await p3(browser, baseURL, "dark", RECHNER);
    const p3Schmal = await p3(browser, baseURL, "light", TELEFON);
    if (p3Hell.alt) {
        writeFileSync(resolve(STAND, "vorher-offen-hell.png"), p3Hell.auf);
        writeFileSync(resolve(STAND, "vorher-offen-dunkel.png"), p3Dunkel.auf);
        writeFileSync(resolve(STAND, "vorher-offen-schmal.png"), p3Schmal.auf);
    }

    const eckeHell = await ecke(browser, baseURL, "light");
    const eckeDunkel = await ecke(browser, baseURL, "dark");

    const p4Ort = await p4(browser, baseURL, "light", RECHNER, { ...GARETH });
    const p4OrtDunkel = await p4(browser, baseURL, "dark", RECHNER, { ...GARETH });
    const p4OrtSchmal = await p4(browser, baseURL, "light", TELEFON, { ...GARETH });
    const p4Weg = await p4(browser, baseURL, "light", RECHNER, { ...WEG });
    const taktHell = await takt(browser, baseURL, "light");
    const taktDunkel = await takt(browser, baseURL, "dark");
    const leisteHell = await leiste(browser, baseURL, "light");
    const leisteDunkel = await leiste(browser, baseURL, "dark");
    const eckenHell = await ecken(browser, baseURL, "light");
    const eckenDunkel = await ecken(browser, baseURL, "dark");
    const p4WegSchmal = await p4(browser, baseURL, "light", TELEFON, { ...WEG });

    const colour = CANON.colour;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1500px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 16px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1100px; }
h2 { margin: 24px 0 9px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.reihe { display: grid; grid-template-columns: repeat(4, max-content); gap: 10px 18px; align-items: start; }
.reihe--sechs { grid-template-columns: repeat(6, max-content); }
.reihe p { margin: 0 0 5px; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; }
.zoom img { image-rendering: pixelated; }
.zoom img { max-width: 760px; }
.ecke img { width: 272px; image-rendering: pixelated; }
table { border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; }
th, td { padding: 3px 16px 3px 0; text-align: left; font-weight: 400; vertical-align: top; }
th { color: ${colour["textMuted"]}; border-bottom: 1px solid ${colour["border"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
.fehlt { width: 300px; padding: 10px; border: 1px dashed ${colour["border"]}; border-radius: 8px; font-size: 12px; color: ${colour["textMuted"]}; }
code { font-family: inherit; color: ${colour["accentStrong"]}; }
.note { margin: 12px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1100px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Nachtrag zu WI-0089 — vier Stellen</h1>
<p class="lead">Alle Bilder in echter Größe; „vorher" ist derselbe Stand mit einem Stilzettel, der genau die geänderte
Deklaration zurückstellt. Nur das aufgeklappte Paar bei P3 stammt aus einem Lauf auf dem Stand davor.</p>

<h2>P2 · Die Zahlen bei 360 px <span>· „die schrift der zahlen kleiner machen, damit die zahlen in die spalten passen"</span></h2>
<div class="reihe">
<div><p>360 px · vorher · hell</p>${image(p2Schmal.vorher)}</div>
<div><p>360 px · nachher · hell</p>${image(p2Schmal.nachher)}</div>
<div><p>360 px · vorher · dunkel</p>${image(p2SchmalDunkel.vorher)}</div>
<div><p>360 px · nachher · dunkel</p>${image(p2SchmalDunkel.nachher)}</div>
<div><p>Rechner · unverändert (vorher)</p>${image(p2Rechner.vorher)}</div>
<div><p>Rechner · unverändert (nachher)</p>${image(p2Rechner.nachher)}</div>
</div>

<h2>P3a · Die Leiste bleibt einzeilig <span>· „wir wollen den einzeiligen header (zugeklappt) lassen … aber halt einzeilig"</span></h2>
<div class="reihe">
<div><p>zugeklappt · vorher · hell</p>${image(p3Hell.zuVorher)}</div>
<div><p>zugeklappt · nachher · hell</p>${image(p3Hell.zuNachher)}</div>
<div><p>vorher · dunkel</p>${image(p3Dunkel.zuVorher)}</div>
<div><p>nachher · dunkel</p>${image(p3Dunkel.zuNachher)}</div>
<div><p>360 px · vorher</p>${image(p3Schmal.zuVorher)}</div>
<div><p>360 px · nachher</p>${image(p3Schmal.zuNachher)}</div>
</div>

<h2>P3b · Aufgeklappt ohne Kurzangabe <span>· „die brauchen wir nur wenn sie eingeklappt ist"</span></h2>
<div class="reihe">
<div><p>aufgeklappt · vorher · hell</p>${altesBild("offen-hell")}</div>
<div><p>aufgeklappt · nachher · hell</p>${image(p3Hell.auf)}</div>
<div><p>vorher · dunkel</p>${altesBild("offen-dunkel")}</div>
<div><p>nachher · dunkel</p>${image(p3Dunkel.auf)}</div>
<div><p>360 px · vorher</p>${altesBild("offen-schmal")}</div>
<div><p>360 px · nachher</p>${image(p3Schmal.auf)}</div>
</div>

<h2>P3c · ⓘ und ▾ auf derselben Mitte <span>· „das (i) ist glaub wegen seiner historie etwas zu weit oben"</span></h2>
<table>
<tr><th>gemessen (Mitte der Kästen)</th><th>vorher</th><th>nachher</th></tr>
<tr><td>ⓘ gegen ▾, beide Kästen</td><td><b>3,50 px zu hoch</b></td><td><b>0,00 px</b></td></tr>
</table>
<div class="reihe zoom">
<div><p>vorher · hell (4×)</p>${image(eckeHell.vorher)}</div>
<div><p>nachher · hell (4×)</p>${image(eckeHell.nachher)}</div>
<div><p>vorher · dunkel (4×)</p>${image(eckeDunkel.vorher)}</div>
<div><p>nachher · dunkel (4×)</p>${image(eckeDunkel.nachher)}</div>
</div>

<h2>P4 · So viele Spalten, wie es Kacheln gibt <span>· „alle 2 zeiligen lösungen … passt"</span></h2>
<div class="reihe reihe--sechs">
<div><p>Ort · vorher · hell</p>${image(p4Ort.vorher)}</div>
<div><p>Ort · nachher · hell</p>${image(p4Ort.nachher)}</div>
<div><p>vorher · dunkel</p>${image(p4OrtDunkel.vorher)}</div>
<div><p>nachher · dunkel</p>${image(p4OrtDunkel.nachher)}</div>
<div><p>Ort · 360 px · vorher</p>${image(p4OrtSchmal.vorher)}</div>
<div><p>Ort · 360 px · nachher</p>${image(p4OrtSchmal.nachher)}</div>
<div><p>Weg (vier Kacheln) · vorher</p>${image(p4Weg.vorher)}</div>
<div><p>Weg · nachher</p>${image(p4Weg.nachher)}</div>
<div><p>Weg · 360 px · vorher</p>${image(p4WegSchmal.vorher)}</div>
<div><p>Weg · 360 px · nachher</p>${image(p4WegSchmal.nachher)}</div>
</div>

<h2>O2 · Ein Abstand für die ganze Spalte <span>· „kannst du hier überall dieselben abstände machen"</span></h2>
<table>
<tr><th>gemessen (fünf Abstände der Spalte)</th><th>vorher</th><th>nachher</th></tr>
<tr><td>Kopf → Wegpunkte</td><td>8 px</td><td><b>12 px</b></td></tr>
<tr><td>Wegpunkte → „Ziel hinzufügen"</td><td>8 px</td><td><b>12 px</b></td></tr>
<tr><td>„Ziel hinzufügen" → Transportmittel</td><td>8 px</td><td><b>12 px</b></td></tr>
<tr><td>Transportmittel → Reiseoptionen</td><td>8 px</td><td><b>12 px</b></td></tr>
<tr><td>Reiseoptionen → Reiseübersicht</td><td><b>12 px</b> (8 + eigener Rand)</td><td><b>12 px</b></td></tr>
<tr><td>Werte in der Spalte</td><td>zwei (<code>gap</code> und ein Rand)</td><td><b>einer</b> (<code>--space-10</code>)</td></tr>
</table>
<div class="reihe">
<div><p>vorher · hell</p>${image(taktHell.vorher)}</div>
<div><p>nachher · hell</p>${image(taktHell.nachher)}</div>
<div><p>vorher · dunkel</p>${image(taktDunkel.vorher)}</div>
<div><p>nachher · dunkel</p>${image(taktDunkel.nachher)}</div>
</div>

<h2>O3/O4 · Die Leiste nennt alle drei Einstellungen <span>· „Gemeinschaftszimmer kann auch dranstehen … halt mit ‚…'"</span></h2>
<div class="reihe">
<div><p>vorher · hell</p>${image(leisteHell.vorher)}</div>
<div><p>nachher · hell</p>${image(leisteHell.nachher)}</div>
<div><p>vorher · dunkel</p>${image(leisteDunkel.vorher)}</div>
<div><p>nachher · dunkel</p>${image(leisteDunkel.nachher)}</div>
</div>

<h2>O5 · Aufgeklappt sind die unteren Ecken eckig <span>· „die unteren border corners … sind noch rund obwohl das ding ausgeklappt ist"</span></h2>
<div class="reihe ecke">
<div><p>linke untere Ecke, Zeiger auf dem Kopf · vorher · hell (4×)</p>${image(eckenHell.vorher)}</div>
<div><p>nachher · hell (4×)</p>${image(eckenHell.nachher)}</div>
<div><p>vorher · dunkel (4×)</p>${image(eckenDunkel.vorher)}</div>
<div><p>nachher · dunkel (4×)</p>${image(eckenDunkel.nachher)}</div>
</div>

<p class="note"><b>Was zu sehen ist:</b> Die Zahlen passen bei 360 px in ihre Spalten. Die Leisten sind einzeilig, gleich hoch und tragen zugeklappt alles, was im Kasten steht — aufgeklappt nichts davon doppelt. ⓘ und ▾ liegen auf derselben Mitte. Das Aktionsband hat so viele Spalten, wie es Kacheln gibt, und beim Weg zwei Reihen à zwei — „Änderungen vorschlagen“ braucht damit überall nur noch zwei Zeilen. Die Spalte des Planers trägt einen einzigen Abstand, und der aufgeklappte Gruppenkopf schließt eckig an seinen Rumpf an.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1564, height: 1100 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0089n.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0089n.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "nachtrag.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "nachtrag.png") });
});
