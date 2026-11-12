import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openStageGroups, settleStages } from "./stage-groups.ts";

/**
 * Abnahmeblatt WI-0089: „Der Scrollbalken darf nichts verschieben, die Kacheln werden lesbar“ — EIN Blatt.
 *
 * - **Oben P1 bis P3**, vorher gegen nachher, in echter Größe, hell und dunkel, dazu 360 px.
 * - **Unten P4**, die Aktionskacheln, als Varianten A bis F nebeneinander mit den gemessenen Zahlen.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt ein Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `e2e/planer-feinschliff.spec.ts` (A1 bis A9).
 *
 * 🔴 **„Vorher“ entsteht, wo es geht, aus DEMSELBEN Stand:** Ein Stilzettel stellt genau die Deklaration zurück, die
 * dieses Paket geändert hat (P1 die Rinne, P2 die Kantenlänge des Zeichens). **P3 geht so nicht** - dort ist ein
 * ganzes Bauteil ersetzt (`frame-box.vue` durch `controls/avm-disclosure.vue`), und ein nachgebautes „Vorher“ wäre
 * eine Behauptung. Dieser Lauf legt seine P3-Bilder deshalb nach `stand/`; läuft er auf einem Stand MIT Rahmenkasten,
 * landen sie unter `stand/vorher-*.png` und das Blatt nimmt sie beim nächsten Lauf als Vorher auf. Fehlen sie, sagt
 * das Blatt das an der Stelle.
 *
 * 🪤 **Ohne `--hide-scrollbars`**: Headless Chromium zeichnet den Balken sonst mit Breite 0, und P1 wäre vorher wie
 * nachher gleich.
 *
 *   npm run review:planer-feinschliff
 *
 * Ablage: `review/wi-0089/blatt.png` (`review/` ist nicht versioniert).
 */
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0089");
const STAND = resolve(OUTPUT, "stand");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Seine eigene Reise aus dem Befund. */
const REISE = "?route=Gareth~Greifenfurt";
const LANGE_REISE = "?route=Thorwal~Al'Anfa";
const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;
const WEG = { kind: "path", chain: "Misamunder Straße:Strasse" } as const;

/** Der Stand VOR diesem Paket, als Stilzettel über den fertigen Stand gelegt. */
const VORHER_P1 = `.result--route { scrollbar-gutter: auto !important; }`;
const VORHER_P2 = `.kennzahl__bild { width: var(--icon-lg) !important; height: var(--icon-lg) !important; }`;

type Scheme = "light" | "dark";

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

let client = 20;
async function neu(browser: Browser, baseURL: string, scheme: Scheme, size: { width: number; height: number }) {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: size,
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.1.${String(client)}` },
    });
    return { context, page: await context.newPage() };
}

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("costs-toggle").waitFor({ timeout: 20_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await page.waitForTimeout(400);
}

/**
 * Der Ausschnitt um den Kopf der Reiseübersicht: volle Breite des Ergebniskastens (der Rollbalken gehört ins Bild),
 * Titel und Einstellungszeile. `nah` schneidet stattdessen die rechte Ecke mit dem 🔗 heraus - dort sitzt der Sprung.
 */
async function kopfBox(page: Page, nah = false): Promise<Box> {
    return page.evaluate((zoom) => {
        const result = document.querySelector(".result--route")!.getBoundingClientRect();
        const head = document.querySelector(".overview__head")!.getBoundingClientRect();
        const settings = document.querySelector('[data-testid="route-settings"]')!.getBoundingClientRect();
        const width = zoom ? 120 : Math.round(result.width);
        return {
            x: zoom ? Math.round(result.right) - 120 : Math.round(result.left),
            y: Math.round(head.top) - 6,
            width,
            height: zoom ? Math.round(head.height) + 12 : Math.round(settings.bottom - head.top) + 8,
        };
    }, nah);
}

/** P1: der Kopf mit und ohne Balken, vorher und nachher. */
async function p1(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
): Promise<{
    vorherZu: Buffer;
    vorherAuf: Buffer;
    nachherZu: Buffer;
    nachherAuf: Buffer;
    nahVorherZu: Buffer;
    nahVorherAuf: Buffer;
    nahNachherZu: Buffer;
    nahNachherAuf: Buffer;
}> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page, REISE);
    const zettel = await page.addStyleTag({ content: VORHER_P1 });
    await page.waitForTimeout(150);
    const vorherZu = await page.screenshot({ clip: await kopfBox(page) });
    const nahVorherZu = await page.screenshot({ clip: await kopfBox(page, true) });
    await openStageGroups(page);
    await settleStages(page);
    await page.waitForTimeout(200);
    const vorherAuf = await page.screenshot({ clip: await kopfBox(page) });
    const nahVorherAuf = await page.screenshot({ clip: await kopfBox(page, true) });
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    const nachherAuf = await page.screenshot({ clip: await kopfBox(page) });
    const nahNachherAuf = await page.screenshot({ clip: await kopfBox(page, true) });
    // Wieder zuklappen: dann rollt die Übersicht nicht, die Rinne steht aber.
    const offen = page.locator('[data-testid="route-stage-group"] [aria-expanded="true"]');
    for (let guard = 0; guard < 30; guard += 1) {
        const count = await offen.count();
        if (count === 0) break;
        await offen.first().click();
        await page.waitForTimeout(120);
    }
    await settleStages(page);
    await page.waitForTimeout(200);
    const nachherZu = await page.screenshot({ clip: await kopfBox(page) });
    const nahNachherZu = await page.screenshot({ clip: await kopfBox(page, true) });
    await context.close();
    return { vorherZu, vorherAuf, nachherZu, nachherAuf, nahVorherZu, nahVorherAuf, nahNachherZu, nahNachherAuf };
}

/** Öffnet die erste Etappe mit allen drei Kennzahlen. */
async function openDreiKacheln(page: Page): Promise<void> {
    await openStageGroups(page);
    const rows = page.getByTestId("route-stage");
    await rows.first().waitFor({ timeout: 20_000 });
    const count = await rows.count();
    for (let at = 0; at < count; at += 1) {
        await rows.nth(at).locator("img").first().click();
        await page.getByTestId("stage-figures").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(150);
        if ((await page.locator('[data-testid="stage-figures"] .kennzahl').count()) === 3) return;
    }
}

/** P2: die drei Kacheln des Etappenkopfes, vorher und nachher. */
async function p2(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
): Promise<{ vorher: Buffer; nachher: Buffer }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page, LANGE_REISE);
    await openDreiKacheln(page);
    const box = page.getByTestId("stage-figures");
    await box.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const zettel = await page.addStyleTag({ content: VORHER_P2 });
    await page.waitForTimeout(150);
    const vorher = await box.screenshot();
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    const nachher = await box.screenshot();
    await context.close();
    return { vorher, nachher };
}

/** Der Ausschnitt um die beiden Kästen, von der Oberkante des ersten bis zur Unterkante des zweiten. */
async function boxenBox(page: Page): Promise<Box> {
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

/** Klappt beide Kästen in den gewünschten Zustand - mit dem Schalter des jeweiligen Standes. */
async function setBoxen(page: Page, open: boolean): Promise<void> {
    for (const id of ["planner-transport", "planner-options"]) {
        const toggle = page.locator(`[data-testid="${id}"] .frame__toggle, [data-testid="${id}"] summary`).first();
        const expanded = (await toggle.getAttribute("aria-expanded")) === "true";
        if (expanded !== open) await toggle.click();
        await page.waitForTimeout(350);
    }
    await page.waitForTimeout(250);
}

/** P3: die beiden Kästen, zugeklappt und aufgeklappt - aus dem Stand, auf dem dieser Lauf läuft. */
async function p3(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
): Promise<{ zu: Buffer; auf: Buffer; alt: boolean }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page, REISE);
    const alt = (await page.locator(".frame__toggle").count()) > 0;
    await setBoxen(page, false);
    const zu = await page.screenshot({ clip: await boxenBox(page) });
    await setBoxen(page, true);
    const auf = await page.screenshot({ clip: await boxenBox(page) });
    await context.close();
    return { zu, auf, alt };
}

// ---- P4: die Aktionskacheln als Varianten ------------------------------------------------------

interface Variante {
    id: string;
    titel: string;
    preis: string;
    css: string;
    /** Eine Variante, die den Wortlaut ändert, setzt ihn im Bild ein. */
    text?: Record<string, string>;
}

const VARIANTEN: readonly Variante[] = [
    { id: "A", titel: "heute", preis: "der gemeldete Zustand, als Vergleich", css: "" },
    {
        id: "B",
        titel: "kürzere Beschriftung",
        preis: "ändert den Wortlaut – braucht seine Zustimmung",
        css: "",
        text: { suggest: "Vorschlagen" },
    },
    {
        id: "C",
        titel: "kleinere Schrift nur in der Kachel",
        preis: "11 px ist die Untergrenze des Kanons (§3.1), keine neue Stufe",
        css: `.info-tile { font-size: var(--font-size-caption) !important; }`,
    },
    {
        id: "D",
        titel: "Zeichen und Text nebeneinander",
        preis: "andere Gestalt: breit und flach, nicht quadratisch",
        css: `.info-actions__grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
.info-tile { flex-direction: row !important; justify-content: flex-start !important; gap: var(--space-4) !important; text-align: left !important; }
.info-tile__icon { flex: none; }`,
    },
    {
        id: "E",
        titel: "feste quadratische Kachel, lange Beschriftung gekürzt",
        preis: "ein gekürztes Wort ist eine Zusage, die der `title` einlösen muss",
        css: `.info-tile { aspect-ratio: 1 / 1 !important; min-height: 0 !important; }
.info-tile__label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
    },
    {
        id: "F",
        titel: "so viele Spalten, wie es Kacheln gibt",
        preis: "bricht Legacys vier Spalten – die Kachel wird breiter statt höher",
        css: `.info-actions__grid { grid-template-columns: none !important; grid-auto-flow: column !important; grid-auto-columns: minmax(0, 1fr) !important; }`,
    },
];

interface KachelMass {
    variante: string;
    breite: number;
    hoehe: number;
    verhaeltnis: number;
    zeilen: number;
    bandH: number;
    gekuerzt: boolean;
}

/** Ein Band, in einer Variante: Bild und Maße. */
async function band(page: Page, variante: Variante): Promise<{ png: Buffer; mass: KachelMass }> {
    const zettel = variante.css === "" ? undefined : await page.addStyleTag({ content: variante.css });
    const zurueck = await page.evaluate((texte) => {
        const alt: Record<string, string> = {};
        for (const [id, text] of Object.entries(texte ?? {})) {
            const label = document.querySelector<HTMLElement>(`[data-testid="info-action-${id}"] .info-tile__label`);
            if (label) {
                alt[id] = label.textContent ?? "";
                label.textContent = text;
            }
        }
        return alt;
    }, variante.text ?? {});
    await page.waitForTimeout(200);
    const png = await page.getByTestId("info-actions").screenshot();
    const mass = await page.evaluate((id) => {
        const r = (value: number): number => Math.round(value * 100) / 100;
        const bandEl = document.querySelector<HTMLElement>('[data-testid="info-actions"]')!;
        const tiles = [...bandEl.querySelectorAll<HTMLElement>(".info-tile")];
        const hoch = tiles.reduce((max, tile) => Math.max(max, tile.getBoundingClientRect().height), 0);
        const breit = tiles[0]!.getBoundingClientRect().width;
        const zeilen = tiles.reduce((max, tile) => {
            const label = tile.querySelector<HTMLElement>(".info-tile__label")!;
            const lh = Number.parseFloat(getComputedStyle(label).lineHeight);
            return Math.max(max, Math.round(label.getBoundingClientRect().height / lh));
        }, 0);
        const gekuerzt = tiles.some((tile) => {
            const label = tile.querySelector<HTMLElement>(".info-tile__label")!;
            return label.scrollWidth > label.clientWidth + 1;
        });
        return {
            variante: id,
            breite: r(breit),
            hoehe: r(hoch),
            verhaeltnis: r(hoch / breit),
            zeilen,
            bandH: r(bandEl.getBoundingClientRect().height),
            gekuerzt,
        };
    }, variante.id);
    await page.evaluate((alt) => {
        for (const [id, text] of Object.entries(alt)) {
            const label = document.querySelector<HTMLElement>(`[data-testid="info-action-${id}"] .info-tile__label`);
            if (label) label.textContent = text;
        }
    }, zurueck);
    if (zettel) await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(150);
    return { png, mass };
}

async function p4(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: { width: number; height: number },
    subject: { kind: string } & Record<string, unknown>,
): Promise<{ bilder: Record<string, Buffer>; masse: KachelMass[] }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref as never), subject);
    await page.getByTestId("info-actions").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    const bilder: Record<string, Buffer> = {};
    const masse: KachelMass[] = [];
    for (const variante of VARIANTEN) {
        const result = await band(page, variante);
        bilder[variante.id] = result.png;
        masse.push(result.mass);
    }
    await context.close();
    return { bilder, masse };
}

// ---- Das Blatt ---------------------------------------------------------------------------------

const image = (png: Buffer): string => `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`;

/** Ein P3-Bild aus einem früheren Lauf auf dem Rahmenkasten-Stand, falls es eins gibt. */
function altesBild(name: string): string {
    const file = resolve(STAND, `vorher-${name}.png`);
    if (!existsSync(file)) {
        return `<p class="fehlt">Vorher-Bild fehlt. Es entsteht, wenn dieser Lauf auf einem Stand MIT Rahmenkasten läuft (<code>stand/vorher-${name}.png</code>).</p>`;
    }
    return image(readFileSync(file));
}

test("Abnahmeblatt WI-0089: Rinne, Kacheln, Klappboxen und die Varianten des Aktionsbandes", async ({
    browser,
}, testInfo) => {
    test.setTimeout(1_800_000);
    const baseURL = String(testInfo.project.use.baseURL);
    mkdirSync(STAND, { recursive: true });

    const RECHNER = { width: 1280, height: 1100 };
    const TELEFON = { width: 360, height: 900 };

    const p1Hell = await p1(browser, baseURL, "light", RECHNER);
    const p1Dunkel = await p1(browser, baseURL, "dark", RECHNER);
    const p1Schmal = await p1(browser, baseURL, "light", TELEFON);

    const p2Hell = await p2(browser, baseURL, "light", RECHNER);
    const p2Dunkel = await p2(browser, baseURL, "dark", RECHNER);
    const p2Schmal = await p2(browser, baseURL, "light", TELEFON);

    const p3Hell = await p3(browser, baseURL, "light", RECHNER);
    const p3Dunkel = await p3(browser, baseURL, "dark", RECHNER);
    const p3Schmal = await p3(browser, baseURL, "light", TELEFON);
    // Läuft dieser Lauf auf dem alten Stand, legt er die Vorher-Bilder für das nächste Blatt ab.
    if (p3Hell.alt) {
        writeFileSync(resolve(STAND, "vorher-hell-zu.png"), p3Hell.zu);
        writeFileSync(resolve(STAND, "vorher-hell-auf.png"), p3Hell.auf);
        writeFileSync(resolve(STAND, "vorher-dunkel-zu.png"), p3Dunkel.zu);
        writeFileSync(resolve(STAND, "vorher-dunkel-auf.png"), p3Dunkel.auf);
        writeFileSync(resolve(STAND, "vorher-schmal-zu.png"), p3Schmal.zu);
        writeFileSync(resolve(STAND, "vorher-schmal-auf.png"), p3Schmal.auf);
    }

    const ortHell = await p4(browser, baseURL, "light", RECHNER, { ...GARETH });
    const ortDunkel = await p4(browser, baseURL, "dark", RECHNER, { ...GARETH });
    const ortSchmal = await p4(browser, baseURL, "light", TELEFON, { ...GARETH });
    const wegHell = await p4(browser, baseURL, "light", RECHNER, { ...WEG });

    const colour = CANON.colour;
    const zeileFuer = (id: string, masse: KachelMass[]): KachelMass | undefined =>
        masse.find((mass) => mass.variante === id);
    const tabelle = VARIANTEN.map((variante) => {
        const a = zeileFuer(variante.id, ortHell.masse);
        const b = zeileFuer(variante.id, ortSchmal.masse);
        const w = zeileFuer(variante.id, wegHell.masse);
        const zelle = (mass: KachelMass | undefined): string =>
            mass === undefined
                ? "–"
                : `${String(mass.breite)} × ${String(mass.hoehe)} px · <b>${mass.verhaeltnis.toFixed(2)}</b> · ${String(mass.zeilen)} Z.${mass.gekuerzt ? " · gekürzt" : ""}`;
        return `<tr><td><b>${variante.id}</b> ${variante.titel}</td><td>${zelle(a)}</td><td>${zelle(b)}</td><td>${zelle(w)}</td><td>${String(a?.bandH ?? "–")} px</td><td class="preis">${variante.preis}</td></tr>`;
    }).join("\n");

    const bilderReihe = (block: { bilder: Record<string, Buffer> }, was: string): string =>
        VARIANTEN.map(
            (variante) =>
                `<div><p>${variante.id} · ${was}</p>${block.bilder[variante.id] ? image(block.bilder[variante.id]!) : ""}</div>`,
        ).join("\n");

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 44px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 2240px; }
h1 { margin: 0 0 4px; font-size: 24px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 18px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1200px; }
h2 { margin: 28px 0 10px; font-size: 19px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.reihe { display: grid; grid-template-columns: repeat(6, max-content); gap: 10px 18px; align-items: start; }
.reihe--vier { grid-template-columns: repeat(4, max-content); }
.reihe p, .varianten p { margin: 0 0 6px; font-size: 12px; color: ${colour["textMuted"]}; }
.varianten { display: grid; grid-template-columns: repeat(6, max-content); gap: 12px 18px; align-items: start; }
img { display: block; border: 1px solid ${colour["border"]}; }
table { border-collapse: collapse; margin: 10px 0 14px; font-size: 13px; }
th, td { padding: 4px 16px 4px 0; text-align: left; font-weight: 400; vertical-align: top; }
th { color: ${colour["textMuted"]}; border-bottom: 1px solid ${colour["border"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
td.preis { color: ${colour["textMuted"]}; max-width: 420px; }
.note { margin: 14px 0 0; padding: 11px 15px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1200px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
.fehlt { width: 320px; padding: 10px; border: 1px dashed ${colour["border"]}; border-radius: 8px; font-size: 12px; color: ${colour["textMuted"]}; }
code { font-family: inherit; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Der Scrollbalken darf nichts verschieben, die Kacheln werden lesbar</h1>
<p class="lead">WI-0089 · alle Bilder in echter Größe · P1 und P2 „vorher“ sind derselbe Stand mit einem Stilzettel, der genau
die geänderte Deklaration zurückstellt · P3 ist ein ersetztes Bauteil, sein „vorher“ kommt aus einem Lauf auf dem alten Stand ·
der Browser läuft ohne <code>--hide-scrollbars</code>, der Balken nimmt also 15 px wie im Chrome des Betreibers.</p>

<h2>P1 · Der Kopf der Reiseübersicht <span>· „kann man den stabil halten / etwas nach links verschieben?“</span></h2>
<table>
<tr><th>gemessen (Fenster 1280 × 1100, Gareth → Greifenfurt)</th><th>Etappen zu</th><th>Etappen auf</th></tr>
<tr><td>vorher · Rinne des Rollbereichs</td><td>0 px</td><td>15 px</td></tr>
<tr><td>vorher · rechte Kante des 🔗</td><td>x = 327,0</td><td><b>x = 312,0</b></td></tr>
<tr><td>vorher · Breite des Titels</td><td>259,4 px</td><td><b>244,4 px</b></td></tr>
<tr><td>nachher · Rinne des Rollbereichs</td><td>15 px</td><td>15 px</td></tr>
<tr><td>nachher · rechte Kante des 🔗</td><td>x = 312,0</td><td><b>x = 312,0</b></td></tr>
<tr><td>nachher · Breite des Titels</td><td>244,4 px</td><td><b>244,4 px</b></td></tr>
</table>
<div class="reihe">
<div><p>vorher · Etappen zu · hell</p>${image(p1Hell.vorherZu)}</div>
<div><p>vorher · Etappen auf · hell</p>${image(p1Hell.vorherAuf)}</div>
<div><p>nachher · Etappen zu · hell</p>${image(p1Hell.nachherZu)}</div>
<div><p>nachher · Etappen auf · hell</p>${image(p1Hell.nachherAuf)}</div>
<div><p>vorher · auf · dunkel</p>${image(p1Dunkel.vorherAuf)}</div>
<div><p>nachher · auf · dunkel</p>${image(p1Dunkel.nachherAuf)}</div>
<div><p>360 px · vorher · zu</p>${image(p1Schmal.vorherZu)}</div>
<div><p>360 px · vorher · auf</p>${image(p1Schmal.vorherAuf)}</div>
<div><p>360 px · nachher · zu</p>${image(p1Schmal.nachherZu)}</div>
<div><p>360 px · nachher · auf</p>${image(p1Schmal.nachherAuf)}</div>
</div>
<p class="lead" style="margin:14px 0 6px">Nahaufnahme der rechten Ecke, in der der 🔗 sitzt – echte Größe, 120 px breit:</p>
<div class="reihe">
<div><p>vorher · zu</p>${image(p1Hell.nahVorherZu)}</div>
<div><p>vorher · auf <b style="color:${colour["accentStrong"]}">(15 px nach links)</b></p>${image(p1Hell.nahVorherAuf)}</div>
<div><p>nachher · zu</p>${image(p1Hell.nahNachherZu)}</div>
<div><p>nachher · auf <b style="color:${colour["accentStrong"]}">(unverändert)</b></p>${image(p1Hell.nahNachherAuf)}</div>
<div><p>360 px · vorher · auf</p>${image(p1Schmal.nahVorherAuf)}</div>
<div><p>360 px · nachher · auf</p>${image(p1Schmal.nahNachherAuf)}</div>
</div>

<h2>P2 · Die drei Zeichen des Etappenkopfes <span>· „könnten 150% größer sein. die sind hübsch!“</span></h2>
<table>
<tr><th>gemessen</th><th>vorher</th><th>nachher</th></tr>
<tr><td>Kantenlänge des Zeichens (Kanon <code>infoPanel.figureIcon</code>)</td><td>24 px (<code>icon.lg</code>)</td><td><b>36 px</b></td></tr>
<tr><td>Höhe einer Kachel</td><td>90 px</td><td><b>102 px</b></td></tr>
<tr><td>Höhe des Kastens</td><td>92 px</td><td><b>104 px</b></td></tr>
<tr><td>Breite je Spalte · Rechner / 360 px</td><td>115,7 / 92,3 px</td><td>115,7 / 92,3 px</td></tr>
<tr><td>Zeilen der Beschriftung („Meilen“, „Reisezeit“, „Rastzeit“)</td><td>1</td><td>1</td></tr>
</table>
<div class="reihe reihe--vier">
<div><p>vorher · hell</p>${image(p2Hell.vorher)}</div>
<div><p>nachher · hell</p>${image(p2Hell.nachher)}</div>
<div><p>vorher · dunkel</p>${image(p2Dunkel.vorher)}</div>
<div><p>nachher · dunkel</p>${image(p2Dunkel.nachher)}</div>
<div><p>360 px · vorher</p>${image(p2Schmal.vorher)}</div>
<div><p>360 px · nachher</p>${image(p2Schmal.nachher)}</div>
</div>

<h2>P3 · „Transportmittel“ und „Reiseoptionen“ <span>· „gib beiden den normalen stil der klappbox, die nach unten aufgeht und wo der header stabil bleibt“</span></h2>
<table>
<tr><th>gemessen</th><th>vorher (Rahmenkasten)</th><th>nachher (Klappbox)</th></tr>
<tr><td>Titel, von der Oberkante seines Kastens · zugeklappt</td><td>8,13 px</td><td><b>8,88 px</b></td></tr>
<tr><td>Titel, von der Oberkante seines Kastens · aufgeklappt</td><td><b>−6,87 px</b> (springt 15 px)</td><td><b>8,88 px</b> (bleibt stehen)</td></tr>
<tr><td>Höhe der Kopfzeile „Transportmittel“ zugeklappt</td><td>30 px (eine Zeile, am Ende gekürzt)</td><td><b>58,4 px</b> (die Zusammenfassung bricht um, nichts fehlt)</td></tr>
<tr><td>Höhe der Kopfzeile „Reiseoptionen“ zugeklappt</td><td>30 px</td><td><b>26,6 px</b></td></tr>
<tr><td>Abstand zwischen den beiden Kästen</td><td>12 px (8 + eigener Rand der Aufschrift)</td><td><b>8 px</b> (der <code>gap</code> des Panels)</td></tr>
</table>
<div class="reihe reihe--vier">
<div><p>vorher · zu · hell</p>${altesBild("hell-zu")}</div>
<div><p>vorher · auf · hell</p>${altesBild("hell-auf")}</div>
<div><p>nachher · zu · hell</p>${image(p3Hell.zu)}</div>
<div><p>nachher · auf · hell</p>${image(p3Hell.auf)}</div>
<div><p>vorher · zu · dunkel</p>${altesBild("dunkel-zu")}</div>
<div><p>vorher · auf · dunkel</p>${altesBild("dunkel-auf")}</div>
<div><p>nachher · zu · dunkel</p>${image(p3Dunkel.zu)}</div>
<div><p>nachher · auf · dunkel</p>${image(p3Dunkel.auf)}</div>
<div><p>360 px · vorher · zu</p>${altesBild("schmal-zu")}</div>
<div><p>360 px · vorher · auf</p>${altesBild("schmal-auf")}</div>
<div><p>360 px · nachher · zu</p>${image(p3Schmal.zu)}</div>
<div><p>360 px · nachher · auf</p>${image(p3Schmal.auf)}</div>
</div>

<h2>P4 · Die Aktionskacheln <span>· „sollten eigentlich eher quadratisch sein“ — zur Wahl, nicht gebaut</span></h2>
<table>
<tr><th>Weg</th><th>Ort, Rechner (Panel 400)</th><th>Ort, 360 px (Panel 330)</th><th>Weg mit vier Kacheln</th><th>Band samt Hinweis</th><th>Preis</th></tr>
${tabelle}
</table>
<table>
<tr><th>gemessen, was die Höhe treibt</th><th>Breite in der Kachelschrift (12 px)</th></tr>
<tr><td>„Änderungen vorschlagen“ (die längste, über alle Objektarten)</td><td><b>140,0 px</b> · längstes Wort „Änderungen“ 70,0 px</td></tr>
<tr><td>„Reiseziel hinzufügen“</td><td>112,1 px · längstes Wort 61,9 px</td></tr>
<tr><td>„Reiseziel entfernen“ / „Weg als Route“ / „Link teilen“ / „Anzeigen“ / „Entfernen“</td><td>105,3 / 78,8 / 57,6 / 52,9 / 55,9 px</td></tr>
<tr><td>englisch längste: „Remove destination“ / „Suggest a change“</td><td>109,5 / 95,8 px</td></tr>
<tr><td>Kacheln nebeneinander: Ort 3, Weg 4, Gebiet/Gipfel/Landschaft 2, Kraftlinie 2, Kartenpunkt 3 — das Raster hat immer <b>vier</b> Spalten</td><td>Spalte 81,25 px (Rechner) · <b>63,75 px</b> (360 px)</td></tr>
<tr><td>Platz für die Beschriftung in der Kachel (Spalte − Polster − Rahmen)</td><td>67,25 px (Rechner) · <b>49,75 px</b> (360 px)</td></tr>
</table>
<div class="varianten">
${bilderReihe(ortHell, "Ort · hell")}
${bilderReihe(ortDunkel, "Ort · dunkel")}
${bilderReihe(ortSchmal, "Ort · 360 px")}
${bilderReihe(wegHell, "Weg · vier Kacheln")}
</div>

<p class="note"><b>Meine Empfehlung: F, und wenn er den Wortlaut freigibt, F mit B.</b> Die Ursache ist nicht die
Beschriftung, sondern das Raster: Es hat <b>immer vier Spalten</b>, auch wenn nur zwei oder drei Kacheln darin stehen. Bei
drei Kacheln bleibt rechts eine Spalte leer, und die Kacheln sind mit 81 px so schmal, dass „Änderungen vorschlagen“ drei
Zeilen braucht — daraus kommen die 99 px Höhe und das Verhältnis 1,22. Gibt man dem Band so viele Spalten, wie es Kacheln
hat, wird die Kachel breiter statt höher, die Beschriftung kommt mit zwei Zeilen aus, und bei 360 px steht sie dem Quadrat am
nächsten. <b>B allein</b> (nur ein kürzeres Wort) hilft am Rechner und bei 360 px nicht genug, weil dort schon „Reiseziel
hinzufügen“ drei Zeilen braucht. <b>C</b> bleibt im Kanon (11 px ist seine Untergrenze, keine neue Stufe), kauft aber nur
eine Zeile und macht die Schrift im Panel uneinheitlich. <b>D</b> ist ruhig, aber nicht quadratisch, und das Zeichen verliert
seine Bühne. <b>E</b> ist die einzige Variante, die wirklich quadratisch ist — sie kürzt dafür „Änderungen vorschlagen“ zu
„Änderungen…“, und bei 360 px bleibt für die Beschriftung unter dem 36-px-Zeichen zu wenig Platz. Nichts davon entscheide ich.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 2304, height: 1200 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0089.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0089.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
