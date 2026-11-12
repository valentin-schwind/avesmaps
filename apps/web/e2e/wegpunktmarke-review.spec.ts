import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openStageGroups } from "./stage-groups.ts";
import {
    karteMarkenMass,
    ketteGegenAnker,
    markMass,
    OHNE_PUNKTLINIEN,
    VORHER_WI0097,
    type MarkMass,
} from "./wegpunktmarke.ts";

/**
 * Blatt WI-0097: die Wegpunktmarke oben in der Eingabe und unten in der Etappenliste, vorher gegen nachher.
 *
 * 💣 Dieser Lauf prüft NICHTS; die Zusicherungen stehen in `e2e/wegpunktmarke.spec.ts` (M1 bis M3).
 *
 * 🔴 „Vorher" entsteht aus DEMSELBEN Stand: Ein Stilzettel stellt genau die beiden übersteuerten Maße der
 * Etappenliste zurück (13 px Ring, 10 × 17 px Nadel, `VORHER_WI0097`). Es wird also kein alter Commit gebraucht,
 * und beide Bilder tragen dieselbe Schrift, denselben Grund und denselben Text.
 *
 *   npm run review:wegpunktmarke
 *
 * Ablage: `review/wi-0097/marken.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0097");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; route: Record<string, number> };

/** Die Reise aus dem Bildschirmfoto des Betreibers: Gareth · Start, Perricum · Zwischenziel, Berchweiler · Ziel. */
const REISE = "?route=Gareth~Perricum~Berchweiler";
/** Wie breit der Ausschnitt ist: Griff, Markenspur und der Anfang des Namens - mehr braucht die Frage nicht. */
const SCHNITT_BREITE = 96;

type Scheme = "light" | "dark";
type Groesse = { width: number; height: number };
const RECHNER: Groesse = { width: 1280, height: 1000 };
const TELEFON: Groesse = { width: 360, height: 900 };

type Stand = {
    /** Die drei Wegpunktzeilen der Eingabe als EIN Bild. */
    oben: Buffer;
    /** Die drei Stationen der Etappenliste, je als eigenes Bild (dazwischen stehen Etappenzeilen). */
    unten: Buffer[];
    masse: { ringOben: MarkMass; nadelOben: MarkMass; ringUnten: MarkMass; nadelUnten: MarkMass };
    kette: { stuecke: number; oben: number; unten: number };
    zeilen: { stationen: number[]; nadelSpur: string; spur: string; luftZumNamen: number };
};

let client = 60;
async function neu(browser: Browser, baseURL: string, scheme: Scheme, size: Groesse) {
    client += 1;
    const context = await browser.newContext({
        baseURL,
        viewport: size,
        colorScheme: scheme,
        // 🔴 Vierfache Pixeldichte: Das Blatt zeigt dieselben Bilder vergrößert UND in echter Größe (Guide §3.2).
        deviceScaleFactor: 4,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.3.${String(client)}` },
    });
    return { context, page: await context.newPage() };
}

async function openRoute(page: Page): Promise<void> {
    await page.goto(`/${REISE}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("route-stages").waitFor({ timeout: 40_000 });
    await page.getByTestId("route-station").first().waitFor({ timeout: 40_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await openStageGroups(page);
}

/** Der Ausschnitt um eine Reihe von Elementen: links an ihrer Kante, so breit wie `SCHNITT_BREITE`. */
async function schnitt(
    page: Page,
    selektor: string,
    von: number,
    bis: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await page.evaluate(
        ({ selektor, von, bis }) => {
            const alle = [...document.querySelectorAll(selektor)].slice(von, bis);
            if (alle.length === 0) throw new Error(`nichts gefunden: ${selektor}`);
            const boxen = alle.map((element) => element.getBoundingClientRect());
            const links = Math.min(...boxen.map((rect) => rect.left));
            return {
                x: links,
                y: Math.min(...boxen.map((rect) => rect.top)),
                bottom: Math.max(...boxen.map((rect) => rect.bottom)),
            };
        },
        { selektor, von, bis },
    );
    return {
        x: Math.round(box.x),
        y: Math.round(box.y) - 2,
        width: SCHNITT_BREITE,
        height: Math.round(box.bottom - box.y) + 4,
    };
}

async function bilder(page: Page): Promise<{ oben: Buffer; unten: Buffer[] }> {
    const zettel = await page.addStyleTag({ content: OHNE_PUNKTLINIEN });
    await page.waitForTimeout(120);
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.locator('[data-testid="waypoint-row"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const oben = await page.screenshot({ clip: await schnitt(page, '[data-testid="waypoint-row"]', 0, 3) });
    const unten: Buffer[] = [];
    const anzahl = await page.getByTestId("route-station").count();
    for (let at = 0; at < anzahl; at += 1) {
        await page.getByTestId("route-station").nth(at).scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        unten.push(await page.screenshot({ clip: await schnitt(page, '[data-testid="route-station"]', at, at + 1) }));
    }
    return { oben, unten };
}

async function masse(page: Page): Promise<Stand["masse"]> {
    const zettel = await page.addStyleTag({ content: OHNE_PUNKTLINIEN });
    await page.waitForTimeout(150);
    const werte = {
        ringOben: await markMass(page, ".waypoint__marker .mark--disc", 0),
        nadelOben: await markMass(page, ".waypoint__marker .mark--drop", 0),
        ringUnten: await markMass(page, '[data-testid="route-station"] .mark--disc', 0),
        nadelUnten: await markMass(page, '[data-testid="route-station"] .mark--drop', 0),
    };
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    return werte;
}

async function zeilen(page: Page): Promise<Stand["zeilen"]> {
    return page.evaluate(() => {
        const stationen = [...document.querySelectorAll('[data-testid="route-station"]')];
        const letzte = stationen[stationen.length - 1];
        const span = letzte?.querySelector(".station__mark");
        const name = letzte?.querySelector('[data-testid="station-name"]');
        const rund = (wert: number): number => Math.round(wert * 100) / 100;
        return {
            stationen: stationen.map((zeile) => rund(zeile.getBoundingClientRect().height)),
            nadelSpur: `${String(rund(span?.getBoundingClientRect().width ?? 0))}px`,
            spur: getComputedStyle(document.querySelector('[data-testid="route-stages"]') as Element)
                .getPropertyValue("--mark-size")
                .trim(),
            luftZumNamen: rund((name?.getBoundingClientRect().left ?? 0) - (span?.getBoundingClientRect().right ?? 0)),
        };
    });
}

async function stand(page: Page): Promise<Stand> {
    return {
        ...(await bilder(page)),
        masse: await masse(page),
        kette: await ketteGegenAnker(page),
        zeilen: await zeilen(page),
    };
}

async function fall(
    browser: Browser,
    baseURL: string,
    scheme: Scheme,
    size: Groesse,
): Promise<{ vorher: Stand; nachher: Stand; karte: Awaited<ReturnType<typeof karteMarkenMass>> }> {
    const { context, page } = await neu(browser, baseURL, scheme, size);
    await openRoute(page);
    const karte = await karteMarkenMass(page);
    const zettel = await page.addStyleTag({ content: VORHER_WI0097 });
    await page.waitForTimeout(250);
    const vorher = await stand(page);
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(250);
    const nachher = await stand(page);
    await context.close();
    return { vorher, nachher, karte };
}

const bild = (png: Buffer, klasse: string): string =>
    `<img class="${klasse}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;

/** Eine Zelle: die Eingabe oben, darunter die drei Stationen - dieselbe Reihenfolge wie im Bild des Betreibers. */
function zelle(wert: Stand, klasse: string): string {
    return `<div class="stapel">${bild(wert.oben, klasse)}<div class="trenner"></div>${wert.unten
        .map((png) => bild(png, klasse))
        .join("")}</div>`;
}

const zahl = (wert: number): string => String(wert).replace(".", ",");
const tinteText = (wert: MarkMass): string => `${zahl(wert.tinte.breite)} × ${zahl(wert.tinte.hoehe)}`;

test("Blatt WI-0097: die Wegpunktmarke oben und unten gleich groß", async ({ browser }, testInfo) => {
    test.setTimeout(1_800_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const faelle = [
        { name: "1280 px · hell", scheme: "light" as Scheme, size: RECHNER },
        { name: "1280 px · dunkel", scheme: "dark" as Scheme, size: RECHNER },
        { name: "360 px · hell", scheme: "light" as Scheme, size: TELEFON },
        { name: "360 px · dunkel", scheme: "dark" as Scheme, size: TELEFON },
    ];
    const gemessen: { name: string; wert: Awaited<ReturnType<typeof fall>> }[] = [];
    for (const f of faelle) gemessen.push({ name: f.name, wert: await fall(browser, baseURL, f.scheme, f.size) });

    const erste = gemessen[0]!.wert;
    const colour = CANON.colour;
    const spalten = (klasse: string): string =>
        gemessen
            .map(
                ({ name, wert }) => `<div><p>${name} · <b>vorher</b></p>${zelle(wert.vorher, klasse)}</div>
<div><p>${name} · <b>nachher</b></p>${zelle(wert.nachher, klasse)}</div>`,
            )
            .join("\n");

    const messzeilen = gemessen
        .map(
            ({ name, wert }) => `<tr><td>${name}</td>
<td>${tinteText(wert.vorher.masse.ringOben)}</td><td>${tinteText(wert.vorher.masse.ringUnten)}</td>
<td>${tinteText(wert.vorher.masse.nadelOben)}</td><td>${tinteText(wert.vorher.masse.nadelUnten)}</td>
<td><b>${tinteText(wert.nachher.masse.ringOben)}</b></td><td><b>${tinteText(wert.nachher.masse.ringUnten)}</b></td>
<td><b>${tinteText(wert.nachher.masse.nadelOben)}</b></td><td><b>${tinteText(wert.nachher.masse.nadelUnten)}</b></td></tr>`,
        )
        .join("\n");

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1700px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 16px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1200px; }
h2 { margin: 26px 0 9px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.reihe { display: grid; grid-template-columns: repeat(8, max-content); gap: 10px 14px; align-items: start; }
/* 🪤 Vierfach heißt vierfach: Der Ausschnitt ist 96 CSS-Pixel breit, das Bild also 384 - bei acht Zellen in einer
   Reihe wäre das Blatt 3.000 px breit, deshalb vier Zellen je Reihe. */
.reihe--zoom { grid-template-columns: repeat(4, max-content); }
.reihe p { margin: 0 0 5px; font-size: 12px; color: ${colour["textMuted"]}; }
.reihe p b { font-weight: 400; color: ${colour["accentStrong"]}; }
.stapel { display: flex; flex-direction: column; gap: 3px; }
img { display: block; border: 1px solid ${colour["border"]}; }
.trenner { height: 9px; }
.zoom { width: 384px; image-rendering: pixelated; }
.echt { width: 96px; }
table { border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; }
th, td { padding: 3px 14px 3px 0; text-align: left; font-weight: 400; vertical-align: top; white-space: nowrap; }
th { color: ${colour["textMuted"]}; border-bottom: 1px solid ${colour["border"]}; }
td b { font-weight: 400; color: ${colour["accentStrong"]}; }
code { font-family: inherit; color: ${colour["accentStrong"]}; }
.note { margin: 14px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1200px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>WI-0097 — die Wegpunktmarke oben und unten gleich groß</h1>
<p class="lead">„die icons der wegpunktmarkierung und der tropfen sollten im routenplaner und bei den etappen gleich
groß sein“ (Betreiber, 2026-10-07). Jede Zelle zeigt OBEN die drei Zeilen der Wegpunkteingabe und darunter die drei
Stationen der Etappenliste — Gareth · Start, Perricum · Zwischenziel, Berchweiler · Ziel. „Vorher“ ist derselbe Stand
mit einem Stilzettel, der genau die beiden übersteuerten Maße der Liste zurückstellt.</p>

<h2>Gemessen im Bild, bei vierfacher Pixeldichte <span>· Tinte in CSS-Pixeln, Breite × Höhe</span></h2>
<table>
<tr><th rowspan="2"></th><th colspan="4">vorher</th><th colspan="4">nachher</th></tr>
<tr><th>Ring oben</th><th>Ring unten</th><th>Nadel oben</th><th>Nadel unten</th>
<th>Ring oben</th><th>Ring unten</th><th>Nadel oben</th><th>Nadel unten</th></tr>
${messzeilen}
</table>

<h2>Nahaufnahme <span>· vierfach vergrößert</span></h2>
<div class="reihe reihe--zoom">
${spalten("zoom")}
</div>

<h2>In echter Größe <span>· dieselben Bilder, auf Bildschirmgröße zurückgerechnet</span></h2>
<div class="reihe">
${spalten("echt")}
</div>

<h2>Was der Wechsel mit Kette und Zeilen macht</h2>
<table>
<tr><th>gemessen bei 1280 px, hell</th><th>vorher</th><th>nachher</th></tr>
<tr><td>Anfang der Kette gegen den Anker der ersten Marke</td><td>${zahl(erste.vorher.kette.oben)} px</td><td><b>${zahl(erste.nachher.kette.oben)} px</b></td></tr>
<tr><td>Ende der Kette gegen den Anker der letzten Marke</td><td>${zahl(erste.vorher.kette.unten)} px</td><td><b>${zahl(erste.nachher.kette.unten)} px</b></td></tr>
<tr><td>Stücke der Kette</td><td>${String(erste.vorher.kette.stuecke)}</td><td><b>${String(erste.nachher.kette.stuecke)}</b></td></tr>
<tr><td>Höhe der drei Stationszeilen</td><td>${erste.vorher.zeilen.stationen.map((h) => `${zahl(h)} px`).join(" · ")}</td><td><b>${erste.nachher.zeilen.stationen.map((h) => `${zahl(h)} px`).join(" · ")}</b></td></tr>
<tr><td>Nadel samt Grund in der Markenspur (<code>--mark-size</code> ${erste.nachher.zeilen.spur})</td><td>${erste.vorher.zeilen.nadelSpur}</td><td><b>${erste.nachher.zeilen.nadelSpur}</b></td></tr>
<tr><td>Luft zwischen Nadel und „Berchweiler“</td><td>${zahl(erste.vorher.zeilen.luftZumNamen)} px</td><td><b>${zahl(erste.nachher.zeilen.luftZumNamen)} px</b></td></tr>
</table>

<h2>Befund: die dritte Fassung derselben Marke — die Karte <span>· NICHT geändert</span></h2>
<table>
<tr><th>gerastert aus derselben Formquelle</th><th>Größe</th><th>Kanon</th></tr>
<tr><td>Ring auf der Karte</td><td><b>${zahl(erste.karte.ring)} × ${zahl(erste.karte.ring)} px</b></td><td><code>route.markerDisc</code> ${String(CANON.route["markerDisc"])}</td></tr>
<tr><td>Nadel auf der Karte</td><td><b>${zahl(erste.karte.nadelBreite)} × ${zahl(erste.karte.nadelHoehe)} px</b></td><td><code>route.markerDropWidth/Height</code> ${String(CANON.route["markerDropWidth"])} × ${String(CANON.route["markerDropHeight"])}</td></tr>
<tr><td><code>icon-size</code> der Markenebene</td><td colspan="2">${erste.karte.iconSize === null ? "nicht gesetzt — das Bild gilt in seiner eigenen Größe" : String(erste.karte.iconSize)}</td></tr>
</table>

<p class="note"><b>Was zu sehen ist:</b> Oben und unten tragen jetzt dieselbe Marke in derselben Größe — Ring
18 × 18 px, Nadel 14 × 24 px. Gewonnen hat die 18, abgeleitet aus drei vorhandenen Werten: der
Wegpunkteingabe als benannter Vorlage („beide sollten eigentlich so aussehen wie die symbole aus den wegpunkten“,
2026-10-05), der EINEN Vorgabe des gemeinsamen Bauteils (13 war eine Übersteuerung an einer Stelle) und der
Markenspur der Etappenliste selbst: 20 px breit, und die Nadel füllt sie bei 18 genau aus. Die Kette hängt an einem
Anteil der Markenhöhe und trifft deshalb weiter ihren Ankerpunkt; keine Zeile wächst, weil der zweizeilige Text höher
ist als die Marke. <b>Die Karte bleibt unberührt</b> — dort ist die Marke mit ${zahl(erste.karte.ring)} px weiter
deutlich größer, wie der Kanon es sagt. Es sind also zwei Größen im Umlauf, nicht drei: eine für die Oberfläche, eine
für die Karte.</p>
</body></html>`;

    // 🔴 GENAU EIN Blatt (Hausregel des Betreibers): eine Datei, kein zweites Dokument daneben.
    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1764, height: 1100 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0097.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0097.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "marken.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "marken.png") });
});
