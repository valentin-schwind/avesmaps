import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { AVENTURIA_POLITICAL_CARTOGRAPHY } from "@avesmaps3d/shared";
import { chooseView, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { measureLabelInk, type LabelInk } from "./territory-coat-ink.ts";

/**
 * Abnahmeblatt WI-0121: die Wappen der Herrschaftsgebiete an ihren Namen, Legacy gegen Avesmaps3D an denselben Kartenstellen.
 * Betreiber 2026-10-09, mit zwei Legacy-Bildern („Markgrafschaft Greifenfurt“, „Markgrafschaft Rommilyser Mark“): „prima und
 * zentriert wie in legacy“.
 *
 * 💣 DIESER LAUF PRÜFT NICHTS. Er legt ein Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `e2e/territory-coats.spec.ts`, `test/territory-coat-label.test.ts` und `packages/shared/test/political-coat.test.ts`.
 *
 * 🪤 DIE ZOOMZAHLEN DER BEIDEN SIND NICHT DIESELBEN: Avesmaps3D z = Legacy z + 1 (AGENTS.md, Designkanon). Jeder Fall nennt
 * beide. Legacy wird lesend und mit wenigen Seitenaufrufen befragt (zwei Seiten: echte Größe und dreifach); nichts wird
 * angeklickt oder gespeichert.
 *
 * 🔴 Legacys Maße werden am DOM gemessen (Wappen, Namensbilder, Block), nicht aus dem Code abgeschrieben. Die Zeilenzahl eines
 * Namens bestimmt dort die Fläche des Gebiets (`computeRegionLabelMaxWidthPx`), bei uns ist die Umbruchbreite fest (7 em): Sie
 * kann also verschieden sein, und das Blatt nennt beide.
 *
 *   npm run review:wappen-karte
 *
 * Ablage: `review/wi-0121/blatt.png` (nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0121");
const LEGACY = "https://avesmaps.de/";
const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

interface Fall {
    id: string;
    titel: string;
    frage: string;
    /** Der Name, wie ihn die Kachel führt; Legacy zeigt ihn als Bild je Zeile. */
    name: string;
    /** Der Anker des Namens in Längen- und Breitengraden der Karte (aus der Ableitung). */
    lngLat: { lng: number; lat: number };
    /** Legacys Zoomstufe; Avesmaps3D steht eine höher. */
    legacyZoom: number;
    /** Wie viele Bildpunkte rechts und links vom Anker das Blatt zeigt. */
    halb: { x: number; y: number };
}

const FAELLE: Fall[] = [
    {
        id: "greifenfurt",
        titel: "Markgrafschaft Greifenfurt",
        frage: "Das Bild des Betreibers: Wappen über dem Namen, zwei Zeilen, der Block auf dem Anker.",
        name: "Markgrafschaft Greifenfurt",
        lngLat: { lng: 0.111527, lat: 27.722253 },
        legacyZoom: 3,
        halb: { x: 110, y: 100 },
    },
    {
        id: "rommilyser-mark",
        titel: "Markgrafschaft Rommilyser Mark",
        frage: "Das zweite Bild des Betreibers: der längere Name bricht in mehr Zeilen.",
        name: "Markgrafschaft Rommilyser Mark",
        lngLat: { lng: 25.459876, lat: 22.821303 },
        legacyZoom: 3,
        halb: { x: 110, y: 110 },
    },
    {
        id: "baronie",
        titel: "Baronie Adlerflug",
        frage: "Eine Baronie in Band 4: Jede Ebene trägt das Wappen, kein Typfilter.",
        name: "Baronie Adlerflug",
        lngLat: { lng: 38.733479, lat: 50.517699 },
        legacyZoom: 4,
        halb: { x: 90, y: 90 },
    },
    {
        id: "thorwal",
        titel: "Thorwal",
        frage: "Band 1: Wappen und Schrift sind kleiner (Legacy 0,83), und beide im selben Verhältnis.",
        name: "Thorwal",
        lngLat: { lng: -73.0516, lat: 58.6288 },
        legacyZoom: 1,
        halb: { x: 90, y: 80 },
    },
    {
        id: "ohne-wappen",
        titel: "Luring (ohne Wappen)",
        frage: "Ohne öffentliches Wappen steht nur der Name, wie bisher: kein Platzhalter, kein leerer Platz darüber.",
        name: "Luring",
        lngLat: { lng: -1.452487, lat: 2.696435 },
        legacyZoom: 4,
        halb: { x: 70, y: 50 },
    },
];

/** Was Legacy für ein Label im DOM misst, in Bildpunkten vom Mittelpunkt des Blocks (= Anker). */
interface LegacyMasse {
    wappen: boolean;
    wappenKante?: number;
    wappenUnterkante?: number;
    zeilen: number;
    ersteZeileMitte: number;
    blockHoehe: number;
    wappenMitteX?: number;
    namenMitteX: number;
}

interface Aufnahme {
    png: Buffer;
    masse?: LegacyMasse;
}

type Seite = "echt" | "nah";

/** Zoom ↔ Band: Das Band ist das, was die Karte als Faktor liest. */
const bandAt = (zoom: number): number => Math.max(0, Math.floor(zoom - 1 + POLITICAL.bandLeadZoom + 1e-9));

// ---------------------------------------------------------------------------------------------------------------------
// Legacy
// ---------------------------------------------------------------------------------------------------------------------

/** Leaflets Karteninstanz ist modul-lokal; das Muster stammt aus `design-parity-review.spec.ts`. */
const CAPTURE_LEAFLET = `
const proto = L.Map.prototype, orig = proto.mouseEventToContainerPoint;
proto.mouseEventToContainerPoint = function (...a) { globalThis.__k = this; return orig.apply(this, a); };
const el = document.querySelector(".leaflet-container");
const r = el.getBoundingClientRect();
el.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
proto.mouseEventToContainerPoint = orig;
`;

async function legacyPage(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto(LEGACY, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(6000);
    await page.evaluate(CAPTURE_LEAFLET);
    await page.evaluate(() => {
        (globalThis as unknown as { setMapStyle(id: string): void }).setMapStyle("original");
        // Alles, was nicht Karte ist, ausblenden - nur sichtbar, nicht entfernt.
        for (const selector of [
            "#search",
            "#toggle-button",
            ".avesmaps-infopanel",
            "#panel-tabs",
            ".leaflet-control-container",
        ]) {
            document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
                node.style.visibility = "hidden";
            });
        }
        // Die politische Ansicht, wie ein Klick auf den Eintrag der Auswahlbox (`selectMapLayerMode`, keyboard-shortcuts.js).
        const select = document.getElementById("mapLayerModeSelect");
        const jq = (
            globalThis as unknown as {
                jQuery?: (el: Element | null) => { val(v: string): { trigger(e: string): void } };
            }
        ).jQuery;
        if (select && jq) jq(select).val("political").trigger("change");
    });
    // Gebiete und Wappen sind große Antworten; Legacy lädt sie beim Wechsel.
    await page.waitForTimeout(12_000);
    return page;
}

/** Springt zur Stelle und gibt Mittelpunkt des Blocks im Fenster zurück, samt den Maßen aus dem DOM. */
async function legacyFall(
    page: Page,
    fall: Fall,
    anchor: { x: number; y: number },
): Promise<{ centre: { x: number; y: number }; masse?: LegacyMasse } | undefined> {
    return page.evaluate(
        async ({ x, y, zoom, name }) => {
            const map = (
                globalThis as unknown as { __k: { setView(c: [number, number], z: number, o: unknown): void } }
            ).__k;
            map.setView([y, x], zoom, { animate: false });
            await new Promise((done) => setTimeout(done, 4500));
            const contents = [...document.querySelectorAll<HTMLElement>(".region-label__content")];
            const first = name.split(" ")[0] ?? name;
            const candidates = contents.filter((content) =>
                [...content.querySelectorAll<HTMLImageElement>(".region-label__name-img")].some((img) =>
                    img.alt.includes(first),
                ),
            );
            const view = document.querySelector<HTMLElement>(".leaflet-container")!.getBoundingClientRect();
            const middle = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
            const distance = (element: HTMLElement): number => {
                const r = element.getBoundingClientRect();
                return Math.hypot(r.left + r.width / 2 - middle.x, r.top + r.height / 2 - middle.y);
            };
            const content = candidates.sort((a, b) => distance(a) - distance(b))[0];
            if (!content) return undefined;
            // Zeigen, bis die Bilder geladen sind.
            for (let tries = 0; tries < 40; tries += 1) {
                const images = [...content.querySelectorAll<HTMLImageElement>("img")];
                if (images.every((image) => image.complete)) break;
                await new Promise((done) => setTimeout(done, 250));
            }
            const rect = content.getBoundingClientRect();
            const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            const coat = content.querySelector<HTMLImageElement>(".region-label__coat");
            const lines = [...content.querySelectorAll<HTMLImageElement>(".region-label__name-img")];
            const lineRect = lines[0]?.getBoundingClientRect();
            const coatRect = coat?.getBoundingClientRect();
            const names = lines.map((line) => line.getBoundingClientRect());
            const widest = names.reduce((best, r) => (r.width > best.width ? r : best), names[0]!);
            const masse: LegacyMasse = {
                wappen: Boolean(coat),
                zeilen: lines.length,
                ersteZeileMitte: lineRect ? lineRect.top + lineRect.height / 2 - centre.y : 0,
                blockHoehe: rect.height,
                namenMitteX: widest.left + widest.width / 2 - centre.x,
            };
            if (coatRect) {
                masse.wappenKante = coatRect.height;
                masse.wappenUnterkante = coatRect.bottom - centre.y;
                masse.wappenMitteX = coatRect.left + coatRect.width / 2 - centre.x;
            }
            return { centre, masse };
        },
        { x: anchor.x, y: anchor.y, zoom: fall.legacyZoom, name: fall.name },
    );
}

async function legacyAufnahmen(browser: Browser, anchors: Map<string, { x: number; y: number }>, seite: Seite) {
    const scale = seite === "echt" ? 1 : 3;
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: scale,
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.97" },
    });
    const out = new Map<string, Aufnahme>();
    try {
        const page = await legacyPage(context);
        for (const fall of FAELLE) {
            const anchor = anchors.get(fall.id);
            if (!anchor) continue;
            try {
                const gefunden = await legacyFall(page, fall, anchor);
                const centre = gefunden?.centre ?? { x: 640, y: 400 };
                const halb = seite === "echt" ? fall.halb : { x: fall.halb.x / 2, y: fall.halb.y / 2 };
                const clip = {
                    x: Math.max(0, Math.round(centre.x - halb.x)),
                    y: Math.max(0, Math.round(centre.y - halb.y)),
                    width: halb.x * 2,
                    height: halb.y * 2,
                };
                const png = await page.screenshot({ clip });
                out.set(fall.id, gefunden?.masse ? { png, masse: gefunden.masse } : { png });
            } catch (error) {
                out.set(fall.id, { png: Buffer.alloc(0) });
                test.info().annotations.push({ type: "Legacy", description: `${fall.id}: ${String(error)}` });
            }
        }
    } finally {
        await context.close();
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Avesmaps3D
// ---------------------------------------------------------------------------------------------------------------------

async function ourAnchors(page: Page): Promise<Map<string, { x: number; y: number }>> {
    const entries = await page.evaluate((faelle) => {
        const projection = globalThis.avesmapsRenderProjection!;
        return faelle.map((fall) => [fall.id, projection.fromRenderLngLat(fall.lngLat)] as const);
    }, FAELLE);
    return new Map(entries);
}

async function ourFall(
    browser: Browser,
    baseURL: string,
    seite: Seite,
): Promise<{
    aufnahmen: Map<string, Aufnahme>;
    ink: Map<string, LabelInk | undefined>;
    anchors: Map<string, { x: number; y: number }>;
}> {
    const scale = seite === "echt" ? 1 : 3;
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: scale,
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.98" },
    });
    const page = await context.newPage();
    const aufnahmen = new Map<string, Aufnahme>();
    const ink = new Map<string, LabelInk | undefined>();
    try {
        await openMap(page);
        await chooseView(page, "political");
        const anchors = await ourAnchors(page);
        for (const fall of FAELLE) {
            const at = anchors.get(fall.id)!;
            await showPlace(page, at, fall.legacyZoom + 1);
            await settleFrame(page);
            await page.waitForTimeout(1500);
            // Der Anker, wie ihn die Kachel führt: aus dem gezeichneten Namen, nicht aus der Annahme.
            const gezeichnet = await page.evaluate((name) => {
                const feature = globalThis
                    .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                    .find((candidate) => candidate.properties["name"] === name);
                return feature
                    ? {
                          lng: feature.geometry.coordinates[0],
                          lat: feature.geometry.coordinates[1],
                          id: String(feature.properties["territory_public_id"]),
                      }
                    : undefined;
            }, fall.name);
            const lngLat = gezeichnet ?? fall.lngLat;
            const punkt = await page.evaluate(({ lng, lat }) => {
                const map = globalThis.avesmapsMap!;
                const p = map.project({ lng, lat });
                const rect = map.getCanvas().getBoundingClientRect();
                return { x: rect.left + p.x, y: rect.top + p.y };
            }, lngLat);
            const halb = seite === "echt" ? fall.halb : { x: fall.halb.x / 2, y: fall.halb.y / 2 };
            const clip = {
                x: Math.round(punkt.x - halb.x),
                y: Math.round(punkt.y - halb.y),
                width: halb.x * 2,
                height: halb.y * 2,
            };
            aufnahmen.set(fall.id, { png: await page.screenshot({ clip }) });
            if (seite === "echt" && gezeichnet) {
                ink.set(fall.id, await measureLabelInk(page, "territory-label", lngLat, { only: gezeichnet.id }));
            }
        }
        return { aufnahmen, ink, anchors };
    } finally {
        await context.close();
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Blatt
// ---------------------------------------------------------------------------------------------------------------------

const zahl = (wert: number | undefined, stellen = 1): string =>
    wert === undefined || !Number.isFinite(wert) ? "—" : wert.toFixed(stellen).replace(".", ",");

test("Abnahmeblatt WI-0121: Wappen an den Gebietsnamen, Legacy gegen Avesmaps3D", async ({ browser }, testInfo) => {
    test.setTimeout(1_200_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const unsereEcht = await ourFall(browser, baseURL, "echt");
    const unsereNah = await ourFall(browser, baseURL, "nah");
    let legacyEcht = new Map<string, Aufnahme>();
    let legacyNah = new Map<string, Aufnahme>();
    let legacyFehler: string | undefined;
    try {
        legacyEcht = await legacyAufnahmen(browser, unsereEcht.anchors, "echt");
        legacyNah = await legacyAufnahmen(browser, unsereEcht.anchors, "nah");
    } catch (error) {
        legacyFehler = String(error);
    }

    const colour = CANON.colour;
    const image = (png: Buffer | undefined): string =>
        png && png.length > 0
            ? `<img src="data:image/png;base64,${png.toString("base64")}" alt="">`
            : `<div class="leer">nicht erreichbar</div>`;

    const bloecke = FAELLE.map((fall, index) => {
        const l = legacyEcht.get(fall.id);
        const ln = legacyNah.get(fall.id);
        const u = unsereEcht.aufnahmen.get(fall.id);
        const un = unsereNah.aufnahmen.get(fall.id);
        const ink = unsereEcht.ink.get(fall.id);
        const band = bandAt(fall.legacyZoom + 1);
        const m = l?.masse;
        const mitte = (i: LabelInk | undefined, teil: "icon" | "text"): number | undefined =>
            i && i[teil].pixels > 0 ? (i[teil].x0 + i[teil].x1) / 2 : undefined;
        return `
<h2>${String(index + 1)} · ${fall.titel} <span>· Legacy z${String(fall.legacyZoom)} = Avesmaps3D z${String(fall.legacyZoom + 1)} (Band ${String(band)})</span></h2>
<p class="frage">${fall.frage}</p>
<div class="grid">
<div><p class="cap">Legacy · echte Größe</p>${image(l?.png)}</div>
<div><p class="cap">Avesmaps3D · echte Größe</p>${image(u?.png)}</div>
<div><p class="cap">Legacy · dreifach</p>${image(ln?.png)}</div>
<div><p class="cap">Avesmaps3D · dreifach</p>${image(un?.png)}</div>
</div>
<table>
<tr><th>Maß (Pixel vom Anker, unten positiv)</th><th>Legacy (am DOM gemessen)</th><th>Avesmaps3D (an der Tinte gemessen)</th></tr>
<tr><td>Zeilen des Namens</td><td>${m ? String(m.zeilen) : "—"}</td><td>fester Umbruch bei 7 em</td></tr>
<tr><td>Kantenhöhe des Wappens</td><td>${zahl(m?.wappenKante, 0)} px</td><td>${ink && ink.icon.pixels > 0 ? zahl(ink.icon.y1 - ink.icon.y0, 0) + " px (Tinte, ohne durchsichtigen Rand)" : "kein Wappen"}</td></tr>
<tr><td>Unterkante des Wappens</td><td>${zahl(m?.wappenUnterkante)} px</td><td>${ink && ink.icon.pixels > 0 ? zahl(ink.icon.y1) + " px" : "—"}</td></tr>
<tr><td>Mitte der ersten Namenszeile</td><td>${zahl(m?.ersteZeileMitte)} px</td><td>${ink && ink.text.pixels > 0 ? "Oberkante der Schrift bei " + zahl(ink.text.y0) + " px" : "—"}</td></tr>
<tr><td>Mitte Wappen gegen Mitte Name, waagerecht</td><td>${m && m.wappenMitteX !== undefined ? zahl(m.wappenMitteX - m.namenMitteX) + " px" : "—"}</td><td>${mitte(ink, "icon") !== undefined && mitte(ink, "text") !== undefined ? zahl((mitte(ink, "icon") as number) - (mitte(ink, "text") as number)) + " px" : "—"}</td></tr>
</table>`;
    }).join("\n");

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1200px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 12px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1040px; }
h2 { margin: 30px 0 4px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.frage { margin: 0 0 10px; color: ${colour["textMuted"]}; font-size: 13px; }
.grid { display: grid; grid-template-columns: repeat(4, max-content); gap: 8px 18px; align-items: start; }
p.cap { margin: 0 0 6px; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; }
.leer { border: 1px dashed ${colour["border"]}; padding: 40px 20px; color: ${colour["textMuted"]}; }
table { border-collapse: collapse; margin: 12px 0 0; font-size: 12.5px; }
th, td { padding: 2px 22px 2px 0; text-align: left; font-weight: 400; }
th { color: ${colour["textMuted"]}; }
.note { margin: 24px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1040px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Die Wappen stehen an den Namen der Herrschaftsgebiete</h1>
<p class="lead">WI-0121 · Ansicht „Politisch“ · links Legacy (avesmaps.de, Zoom z), rechts Avesmaps3D (Zoom z + 1, derselbe Kartenmaßstab).
Echte Größe und dreifach (Gerätemaßstab 3, kein CSS-Zoom). Legacys Maße sind am DOM gemessen, die unseren an der gezeichneten Tinte;
beide vom Anker des Namens aus. ${legacyFehler ? `<b>Legacy war nicht erreichbar (${legacyFehler.slice(0, 120)}): nur unsere Seite.</b>` : ""}</p>
${bloecke}
<p class="note"><b>Was zu sehen ist:</b> Das Wappen steht mittig über dem Namen, der Name darunter, mehrzeilig gestapelt und zentriert; der GANZE
Block sitzt auf dem Ankerpunkt, darum rutscht der Name gegenüber früher nach unten. In den Bändern 0 bis 2 sind Wappen und Schrift
kleiner (0,75 / 0,83 / 0,91). Ohne öffentliches Wappen steht nur der Name wie bisher, und im Standardbild gibt es kein Wappen.
<b>Zwei Abweichungen von Legacy:</b> (1) Legacy bricht den Namen nach der Fläche des Gebiets um (große Gebiete stehen einzeilig, wie hier links); bei uns bricht er fest bei 7 em um (F5 A, WI-0062), darum stehen dieselben Namen in zwei oder drei Zeilen. Das ist nicht Teil dieser Arbeit und unverändert. (2) Legacy zentriert den Block auf seine tatsächliche Zeilenzahl; MapLibre setzt Wappen und Name mit festem Abstand und kennt die Zeilenzahl erst beim Kachelbau. Der Abstand ist auf zwei Zeilen eingestellt (73 % der Namen mit Wappen bei unserem Umbruch); ein Name mit einer Zeile steht dann 8 px (je Band 6 bis 8 px) höher, einer mit drei Zeilen ebenso viel tiefer, als Legacys Block es wäre.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1264, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0121.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0121.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
