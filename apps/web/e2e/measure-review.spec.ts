import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0095: das Messwerkzeug, nachgezogen wie bei Legacy.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor: dieselbe Kartenstelle westlich von Gareth, einmal
 * mit gesetztem Startpunkt, einmal fertig gemessen, einmal mit gezogenem Griff - als Nahaufnahme und in
 * echter Größe, hell und dunkel, bei 1280 und bei 360 px. Die Prüfungen stehen in
 * `apps/web/e2e/measure-distance.spec.ts` und `apps/web/test/measure-distance.test.ts`.
 *
 *   npm run review:messwerkzeug
 *
 * Ablage: `review/wi-0095/blatt.png` (`review/` ist nicht versioniert).
 *
 * 🪤 **Der Blattlauf braucht eine WARME Vite.** Startet Playwright sie selbst, optimiert Vite beim ersten
 * Aufruf noch seine Abhängigkeiten und lädt die Seite danach neu - mitten im Lauf, und der bricht mit
 * „Execution context was destroyed" ab. Vorher einmal `http://localhost:<port>/src/app.vue` abrufen (oder
 * eine schon laufende Vite nehmen, `reuseExistingServer` tut das von selbst). Gemessen 2026-10-07.
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0095");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; measure: { lineDash: [number, number] } };

/**
 * Zwei Stellen am Großen Fluss westlich von Gareth, 14 Karteneinheiten auseinander: 42,0 Meilen.
 *
 * 🪤 Am Rechner liegt der Kartenmittelpunkt WESTLICH der Strecke, damit beide Griffe im freien Streifen
 * zwischen dem offenen Routenplaner (350 px) und dem rechten Rand liegen: Bei z 6 sind 32 px eine
 * Karteneinheit, die Strecke ist also 448 px breit, und zentriert läge der linke Griff unter dem Planer.
 */
const FROM = { x: 548, y: 533 };
const TO = { x: 562, y: 533 };
const DESKTOP = { centre: { x: 548.6, y: 533 }, zoom: 6 };
/** Am Telefon ist der Planer zu, die Karte also frei - dafür muss die Strecke in 360 px passen. */
const PHONE = { centre: { x: (FROM.x + TO.x) / 2, y: 533 }, zoom: 4.9 };

/** Der Ausschnitt der Nahaufnahme am Rechner: der freie Streifen um die Messung. */
const STRIP = { left: 400, top: 250, width: 800, height: 400 };
const PHONE_STRIP = { left: 0, top: 230, width: 360, height: 320 };

type Scheme = "light" | "dark";

let round = 0;

/**
 * Ein frisches Fenster. 🪤 Das Telefon braucht `hasTouch`: `isPhoneViewport()` fragt nach einem GROBEN
 * Zeiger - ohne ihn gilt ein 360 px schmales Fenster als Rechnerfenster, und der Routenplaner deckt die
 * ganze Karte (gemessen: der Klick landete auf dem Feld „Seereise").
 */
async function newPage(browser: Browser, baseURL: string, scheme: Scheme, phone: boolean): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: phone ? { width: 360, height: 780 } : { width: 1280, height: 900 },
        ...(phone ? { hasTouch: true, isMobile: true } : {}),
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    return context.newPage();
}

async function openAt(page: Page, at: { centre: { x: number; y: number }; zoom: number }): Promise<void> {
    round += 1;
    await page.goto(
        `/?r=${String(round)}#x=${String(at.centre.x)}&y=${String(at.centre.y)}&z=${String(at.zoom)}` +
            `&series=original&view=standard`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await settleFrame(page);
}

/** Wo eine Kartenstelle im Fenster liegt, in Seitenpixeln. */
async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate((target) => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) throw new Error("map handle missing");
        return map.project(projection.toRenderLngLat(target));
    }, point);
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

/** Die Messung über das Kartenmenü beginnen - denselben Weg, den ein Mensch nimmt. */
async function startMeasure(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("map-context-menu").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("context-measure").click();
    await page.getByTestId("map-context-menu").waitFor({ state: "detached", timeout: 20_000 });
}

async function completeMeasure(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.mouse.click(at.x, at.y);
    await page.getByTestId("measure-value").waitFor({ state: "visible", timeout: 20_000 });
    await settleFrame(page);
}

/** Der Ausschnitt um die Messung. */
async function closeUp(
    page: Page,
    clip: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
    const box = await page.getByTestId("map").boundingBox();
    return page.screenshot({
        clip: { x: (box?.x ?? 0) + clip.left, y: (box?.y ?? 0) + clip.top, width: clip.width, height: clip.height },
    });
}

const valueText = (page: Page): Promise<string> => page.getByTestId("measure-value").innerText();

const escape = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Shot {
    close: Buffer;
    full: Buffer;
    text: string;
}

test("Abnahmeblatt WI-0095: das Messwerkzeug auf echter Karte", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    // --- Rechner, hell: wartender Startpunkt, fertige Messung, gezogener Griff -----------------------------------
    const light = await newPage(browser, baseURL, "light", false);
    await openAt(light, DESKTOP);
    const from = await screenOf(light, FROM);
    const to = await screenOf(light, TO);

    await startMeasure(light, from);
    await settleFrame(light);
    const pending: Shot = {
        close: await closeUp(light, STRIP),
        full: await light.screenshot(),
        text: "— noch kein Wert",
    };

    await completeMeasure(light, to);
    const done: Shot = {
        close: await closeUp(light, STRIP),
        full: await light.screenshot(),
        text: await valueText(light),
    };

    // Den Zielgriff auf die halbe Strecke ziehen: der Wert rechnet mit.
    const middle = await screenOf(light, { x: (FROM.x + TO.x) / 2, y: FROM.y });
    await light.mouse.move(to.x, to.y);
    await light.mouse.down();
    await light.mouse.move(middle.x, middle.y, { steps: 8 });
    await light.mouse.up();
    await settleFrame(light);
    const dragged: Shot = {
        close: await closeUp(light, STRIP),
        full: await light.screenshot(),
        text: await valueText(light),
    };

    // --- Rechner, dunkel ----------------------------------------------------------------------------------------
    const nightPage = await newPage(browser, baseURL, "dark", false);
    await openAt(nightPage, DESKTOP);
    await startMeasure(nightPage, await screenOf(nightPage, FROM));
    await completeMeasure(nightPage, await screenOf(nightPage, TO));
    const dark: Shot = {
        close: await closeUp(nightPage, STRIP),
        full: await nightPage.screenshot(),
        text: await valueText(nightPage),
    };

    // --- Telefon, 360 px, hell und dunkel -----------------------------------------------------------------------
    const phoneShots: { scheme: Scheme; close: Buffer; full: Buffer; text: string }[] = [];
    for (const scheme of ["light", "dark"] as const) {
        const page = await newPage(browser, baseURL, scheme, true);
        await openAt(page, PHONE);
        await startMeasure(page, await screenOf(page, FROM));
        await completeMeasure(page, await screenOf(page, TO));
        phoneShots.push({
            scheme,
            close: await closeUp(page, PHONE_STRIP),
            full: await page.screenshot(),
            text: await valueText(page),
        });
    }

    // -------------------------------------------------------------------------------------------------------------

    const colour = CANON.colour;
    const picture = (png: Buffer, width: number): string =>
        `<img width="${String(width)}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 36px; width: 1540px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 23px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 10px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]};
    border-top: 1px solid ${colour["border"]}; padding-top: 14px; }
.lead { margin: 0 0 6px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1180px; }
.satz { margin: 10px 0 0; padding: 10px 14px; border-left: 3px solid ${colour["accentStrong"]};
    background: ${colour["panelSoft"]}; font-size: 15px; color: ${colour["textStrong"]}; max-width: 1180px; }
table.grid { border-collapse: collapse; width: 100%; }
table.grid td, table.grid th { vertical-align: top; padding: 6px 8px; }
table.grid th { text-align: left; font-weight: 400; color: ${colour["textMuted"]}; font-size: 13px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; background: ${colour["panel"]}; }
.mess { font-size: 12px; margin: 5px 0 0; color: ${colour["textMuted"]}; }
.wert { color: ${colour["accentStrong"]}; }
.frage { margin: 18px 0 0; padding: 12px 16px; background: ${colour["panelSoft"]};
    border: 1px solid ${colour["border"]}; border-radius: 6px; max-width: 1180px; font-size: 13px; }
.frage b { color: ${colour["textStrong"]}; }
.frage ul { margin: 8px 0 0; padding-left: 20px; }
.frage li { margin: 0 0 10px; }
code { font-size: 12px; color: ${colour["textStrong"]}; }
table.mess { border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
table.mess th, table.mess td { border: 1px solid ${colour["border"]}; padding: 4px 8px; text-align: left;
    vertical-align: top; }
table.mess th { font-weight: 400; color: ${colour["textMuted"]}; }
</style></head><body>

<h1>Entfernung messen</h1>
<p class="lead">WI-0095 · dieselbe Stelle am Großen Fluss westlich von Gareth, im laufenden Browser über
<b>denselben Weg, den ein Mensch nimmt</b>: Rechtsklick → „Entfernung messen“ → zweiter Klick. Die Strecke ist 14
Karteneinheiten lang, also 42,0 Meilen.</p>
<p class="satz"><b>Gerechnet wird mit derselben Funktion wie der Drachenflug des Reiseplaners</b>
(<code>distanceInMiles</code>, eine Karteneinheit = 3 Meilen). Eine Nachkommastelle, immer Meilen, keine
Einheitengrenze — wie Legacy.</p>

<h2>1 · Der Ablauf, in Nahaufnahme (800 × 400 aus 1280 × 900)</h2>
<table class="grid"><tr><th style="width:170px"></th><th></th></tr>
<tr><th>Startpunkt gesetzt<br><span class="mess">wartet auf den zweiten Klick</span></th>
<td>${picture(pending.close, 800)}<p class="mess">Ein Griff, keine Linie, keine Pille — wie bei Legacy vor dem zweiten
Klick. Ein Satz unten sagt, was fehlt.</p></td></tr>
<tr><th>Fertig gemessen</th>
<td>${picture(done.close, 800)}<p class="mess">Pille: <span class="wert">${escape(done.text)}</span></p></td></tr>
<tr><th>Zielgriff gezogen<br><span class="mess">auf die halbe Strecke</span></th>
<td>${picture(dragged.close, 800)}<p class="mess">Pille: <span class="wert">${escape(dragged.text)}</span> — der Wert
rechnet beim Ziehen mit, wie bei Legacy.</p></td></tr>
</table>

<h2>2 · Hell und dunkel, in Nahaufnahme</h2>
<p class="lead">🔴 Die <b>Karte bleibt hell</b> (Designkanon, WI-0032: was auf der Karte liegt, bekommt keinen
Dunkelwert). Linie und Griffe bleiben also, wie sie sind. <b>Die Pille kippt mit</b>, weil sie die Pille des Hauses ist
(<code>--color-pill</code>) und die Zahl lesbar bleiben muss — siehe Frage F2.</p>
<table class="grid"><tr><th style="width:90px"></th><th></th></tr>
<tr><th>hell</th><td>${picture(done.close, 740)}<p class="mess">${escape(done.text)}</p></td></tr>
<tr><th>dunkel</th><td>${picture(dark.close, 740)}<p class="mess">${escape(dark.text)}</p></td></tr>
</table>

<h2>3 · In echter Größe (1280 × 900)</h2>
<table class="grid"><tr><th>hell</th><th>dunkel</th></tr>
<tr><td>${picture(done.full, 740)}</td><td>${picture(dark.full, 740)}</td></tr></table>

<h2>4 · Am Telefon (360 px) — Nahaufnahme und echte Größe</h2>
<p class="lead">Dieselbe Strecke, eine Zoomstufe weiter heraus, damit beide Griffe in 360 px liegen. Der Planer ist dort
zu, die Karte also frei. 🪤 <b>Aufgerufen wurde hier mit einem echten Rechtsklick</b> — am Finger führt der lange Druck
bei uns zu „Was ist hier?“ und nicht ins Kartenmenü; dazu Frage F7.</p>
<table class="grid"><tr><th style="width:90px"></th><th>Nahaufnahme (360 × 320)</th><th>echte Größe (360 × 780)</th></tr>
${phoneShots
    .map(
        (shot) =>
            `<tr><th>${shot.scheme === "light" ? "hell" : "dunkel"}</th><td>${picture(
                shot.close,
                360,
            )}<p class="mess">${escape(shot.text)}</p></td><td>${picture(shot.full, 360)}</td></tr>`,
    )
    .join("\n")}
</table>

<h2>5 · Woher jeder Wert kommt</h2>
<p class="lead">Legacys Maße stehen im Kanon schon unter anderen Namen; neu dazu kam <b>eine</b> Zahl.</p>
<table class="mess"><tr><th>Teil</th><th>Legacy</th><th>bei uns</th></tr>
<tr><td>Linie</td><td>weiß <code>#FFFFFF</code>, 4 px, gestrichelt 10 / 8 px</td>
    <td><code>colour.routeHalo</code>, <code>mapSelection.lineWidth</code> (4), <code>measure.lineDash</code>
    (${String(CANON.measure.lineDash[0])} / ${String(CANON.measure.lineDash[1])} × Breite = 10 / 8 px) —
    <b>die eine neue Zahl im Kanon</b></td></tr>
<tr><td>Griff</td><td>24 px weiß, Rand 2 px <code>#8a6644</code>, Kern 8 px</td>
    <td><code>icon.lg</code> (24), <code>route.haloWidth</code> (2) in <code>colour.accentBrown</code>,
    Kern ein Drittel des Griffs (8)</td></tr>
<tr><td>Wertpille</td><td>weiß, Radius 999, Rand 2 px <code>#8a6644</code>, 12 px fett, Polster 6 / 10</td>
    <td><code>--color-pill</code>, Kapselform, <b>kein Rahmen</b> (Betreiber 2026-10-07),
    <code>--font-ui</code> in <code>--font-size-small</code> (12) <b>regulär</b> — die Hausschrift bringt nur
    den Regular mit, ein Gewicht darüber wäre gefälscht —, <code>--space-4</code> / <code>--space-8</code>
    (6 / 10)</td></tr>
<tr><td>Stapelung</td><td>Linie über der Route (460 &gt; 450), Griffe über den Ortsmarken (520 &gt; 500)</td>
    <td>dieselbe Reihenfolge: Linie an der Stelle der Routenlinie, Griffe oben am Stapel</td></tr>
<tr><td>Rechnung</td><td><code>Math.hypot</code> × <code>DISTANCE_SCALING_FACTOR</code> = 3</td>
    <td><code>distanceInMiles</code> × <code>milesPerUnit</code> = 3 — dieselbe Funktion wie der Drachenflug</td></tr>
<tr><td>Aufruf</td><td>Kartenmenü „Entfernung messen“ / „Entfernungsmessung löschen“ (zweiter Eintrag nur, wenn es
    etwas zu löschen gibt), Symbol Lineal</td><td>wortgleich, dasselbe Symbol, dieselbe Regel</td></tr>
</table>

<h2>6 · Was bewusst anders ist — bitte widersprechen, wenn es nicht gewollt ist</h2>
<div class="frage">
<ul>
<li><b>F1 · Escape bricht die wartende Messung ab.</b> Legacy kennt zur Messung <b>keine</b> Escape-Taste: Ein halb
begonnener Messvorgang bleibt dort stehen, bis jemand das Kartenmenü wieder aufmacht. Unsere Escape-Kaskade hält die
Stufe „laufende Werkzeugaktion“ aber ausdrücklich dafür frei, und eine Messung, die auf ihren zweiten Punkt wartet, ist
genau das. Gebaut ist: <b>Escape nimmt nur die wartende Messung</b>, eine fertige bleibt stehen und wird über das Menü
gelöscht (Legacy). <b>Empfehlung: so lassen.</b> Soll Escape auch eine fertige Messung löschen, ist das eine Zeile —
dann nimmt Escape allerdings zwei Dinge weg, und die Auswahl der Karte kommt eine Taste später dran.</li>
<li><b>F2 · Die Pille kippt im dunklen Thema mit.</b> Legacys Etikett ist immer weiß mit braunem Rand. Bei uns ist es
die Pille des Hauses und wird im Dunkeln dunkel mit goldener Zahl (Abschnitt 2, untere Zeile) — wie der Kartentooltip,
die einzige andere Anzeige über der Karte, die mitkippt. Die Karte selbst bleibt in beiden Fällen hell.
<b>Empfehlung: so lassen.</b> Sonst steht im dunklen Thema eine grell weiße Kapsel auf der Karte.</li>
<li><b>F3 · Es gibt keine Kette und keine Zwischenlängen.</b> Legacy misst genau zwei Punkte; ein dritter Klick tut
nichts, und „Entfernung messen“ beginnt eine neue Messung statt die alte zu verlängern. So ist es gebaut.
<b>Empfehlung: erst einmal so lassen</b> — eine Kette mit Zwischen- und Gesamtlänge wäre ein eigenes Paket.</li>
<li><b>F4 · Gemessen wird die Luftlinie in der Kartenebene, auch auf der geneigten Karte.</b> Die Zahl ist dieselbe wie
der Drachenflug des Planers; eine „Strecke über Berg und Tal“ wäre eine zweite Rechnung für dieselbe Größe und machte
jeden Vergleich mit dem Planer kaputt. <b>Empfehlung: so lassen.</b></li>
<li><b>F5 · Der Klick, der den Zielpunkt setzt, öffnet kein Objekt.</b> Wer dabei auf eine Stadt klickt, setzt den
Zielpunkt und öffnet die Stadt nicht — Legacy schluckt denselben Klick. Danach ist alles wieder normal. Gemessen in
<code>measure-distance.spec.ts</code>.</li>
<li><b>F6 · Kein Einrasten.</b> Legacy rastet die Griffe an nichts ein, auch nicht an Orten; ein Maß „von Gareth nach
Perricum“ setzt man also mit dem Auge. So ist es gebaut. Ein Einrasten wie bei der Wegpunktmarke wäre eine Zeile mehr —
aber eine echte Verhaltensänderung.</li>
<li><b>F7 · Am Finger führt der lange Druck bei uns nicht ins Kartenmenü</b>, sondern zu „Was ist hier?“ (so entschieden
in WI-0063). In Legacy öffnet der lange Druck das Kartenmenü, dort ist das Messwerkzeug am Handy also erreichbar.
<b>Das betrifft alle sechs Einträge des Menüs, nicht nur das Messen</b>, und es ist nichts, was dieses Paket geändert
hat — die Bilder oben sind deshalb mit einem echten Rechtsklick aufgenommen. <b>Befund, nicht gebaut.</b> Soll das
Kartenmenü am Finger wieder erreichbar sein, ist das ein eigener Auftrag; ich habe nicht gemessen, auf welchen Telefonen
der Browser von sich aus ein Kontextmenü meldet.</li>
</ul>
</div>

<h2>7 · Die Zahlen hinter dem Bild</h2>
<table class="mess"><tr><th>Lage</th><th>Fenster</th><th>Thema</th><th>Pille</th></tr>
<tr><td>Startpunkt gesetzt</td><td>1280 × 900</td><td>hell</td><td>${escape(pending.text)}</td></tr>
<tr><td>Fertig gemessen</td><td>1280 × 900</td><td>hell</td><td>${escape(done.text)}</td></tr>
<tr><td>Zielgriff gezogen</td><td>1280 × 900</td><td>hell</td><td>${escape(dragged.text)}</td></tr>
<tr><td>Fertig gemessen</td><td>1280 × 900</td><td>dunkel</td><td>${escape(dark.text)}</td></tr>
${phoneShots
    .map(
        (shot) =>
            `<tr><td>Fertig gemessen</td><td>360 × 780</td><td>${
                shot.scheme === "light" ? "hell" : "dunkel"
            }</td><td>${escape(shot.text)}</td></tr>`,
    )
    .join("\n")}
</table>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheet = await (await browser.newContext({ viewport: { width: 1540, height: 1000 } })).newPage();
    await sheet.setContent(html);
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
