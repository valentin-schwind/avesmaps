import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0096: die Maßstabsleiste, zentriert und ohne Fläche.
 *
 * 🔴 Betreiber 2026-10-07: „die dynamische skala zentriert, ohne hintergrund, schatten wie bei legacy".
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor. Die Zusicherungen stehen in
 * `e2e/massstab.spec.ts` und `test/scale-bar.test.ts`.
 *
 *   npm run review:massstab
 *
 * Ablage: `review/wi-0096/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0096");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; shadow: Record<string, string> };

/**
 * Der Pfad des Toast-Moduls, absichtlich als Variable: Ein Stringliteral würde TypeScript dazu bringen,
 * eine Vite-Adresse wie ein Modul des Prüfprojekts aufzulösen. Zur Laufzeit ist es dasselbe Modul, das die
 * Anwendung selbst benutzt - sonst stünde kein Toast im Dokument.
 */
const TOAST_MODULE = "/src/feedback/toast.ts";

const RECHNER = { width: 1280, height: 900 };
const TELEFON = { width: 360, height: 780 };

/** Die dunkelste Landschaftsart, die im Bild steht - gesucht, nicht eingetragen (wie im Prüflauf). */
const DUNKLE_ARTEN = ["suempfe_moore", "urwald", "dschungel", "wald", "graslandschaft"];

type Scheme = "light" | "dark";

async function neu(
    browser: Browser,
    scheme: Scheme,
    size: { width: number; height: number },
    view = "view=standard&layer=alle",
    dpr = 3,
): Promise<Page> {
    const context = await browser.newContext({
        viewport: size,
        colorScheme: scheme,
        deviceScaleFactor: dpr,
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.9" },
    });
    const page = await context.newPage();
    await page.goto(`/?r=1#x=512&y=512&z=5&series=original&${view}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) === "true") await tab.click();
    await page.waitForTimeout(500);
    await settleFrame(page);
    return page;
}

async function setZoom(page: Page, zoom: number): Promise<void> {
    await page.evaluate((level) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        map.jumpTo({ zoom: level });
    }, zoom);
    await settleFrame(page);
    await settleFrame(page);
}

/** Die Kartenstelle genau unter die Leiste fahren - dort entscheidet der Grund über die Lesbarkeit. */
async function placeUnderBar(page: Page, to: { x: number; y: number }, zoom: number): Promise<void> {
    await page.evaluate(
        async ({ target, level }) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) throw new Error("map or projection handle missing");
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level });
            await new Promise<void>((done) => map.once("idle", done));
        },
        { target: to, level: zoom },
    );
    await settleFrame(page);
    await page.evaluate(async (target) => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
        if (!map || !projection || !host) throw new Error("handles missing");
        const frame = map.getCanvas().getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const under = projection.fromRenderLngLat(
            map.unproject([(box.left + box.right) / 2 - frame.left, (box.top + box.bottom) / 2 - frame.top]),
        );
        const centre = projection.fromRenderLngLat(map.getCenter());
        map.jumpTo({
            center: projection.toRenderLngLat({
                x: centre.x + (target.x - under.x),
                y: centre.y + (target.y - under.y),
            }),
        });
        await new Promise<void>((done) => map.once("idle", done));
    }, to);
    await settleFrame(page);
    await settleFrame(page);
}

const darkSpot = (page: Page): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate((kinds) => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) throw new Error("map or projection handle missing");
        const layers = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        const canvas = map.getCanvas();
        const found = new Map<string, { x: number; y: number }>();
        for (let y = 80; y < canvas.clientHeight - 80; y += 8) {
            for (let x = 80; x < canvas.clientWidth - 80; x += 8) {
                for (const feature of map.queryRenderedFeatures([x, y], { layers })) {
                    const kind = String(feature.properties["region_type"] ?? "");
                    if (kinds.includes(kind) && !found.has(kind)) {
                        found.set(kind, projection.fromRenderLngLat(map.unproject([x, y])));
                    }
                }
            }
        }
        for (const kind of kinds) {
            const at = found.get(kind);
            if (at) return at;
        }
        return undefined;
    }, DUNKLE_ARTEN);

async function showToast(page: Page, text: string): Promise<void> {
    await page.evaluate(
        async ({ message, module }) => {
            const toast = (await import(/* @vite-ignore */ module)) as {
                showToast: (t: string, tone: string, ms: number) => void;
            };
            toast.showToast(message, "normal", 60_000);
        },
        { message: text, module: TOAST_MODULE },
    );
    await page.waitForTimeout(600);
}

interface Shot {
    label: string;
    width: number;
    picture: Buffer;
}

/** Ein Ausschnitt um die Leiste, in echter Größe, samt dem, was sie gerade zeigt. */
async function crop(page: Page, width: number, height: number): Promise<Shot> {
    const state = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
        const bar = document.querySelector<HTMLElement>('[data-testid="scale-bar-bar"]');
        const label = document.querySelector<HTMLElement>('[data-testid="scale-bar-label"]');
        if (!host || !bar || !label) throw new Error("scale bar missing");
        const box = host.getBoundingClientRect();
        return {
            centre: (box.left + box.right) / 2,
            bottom: box.bottom,
            label: label.textContent ?? "",
            width: Math.round(bar.getBoundingClientRect().width),
        };
    });
    const size = page.viewportSize() ?? RECHNER;
    const x = Math.max(0, Math.min(size.width - width, Math.round(state.centre - width / 2)));
    const y = Math.max(0, Math.min(size.height - height, size.height - height));
    const picture = await page.screenshot({ clip: { x, y, width, height } });
    return { label: state.label, width: state.width, picture };
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

const png = (buffer: Buffer, width: number): string =>
    `<img width="${String(width)}" src="data:image/png;base64,${buffer.toString("base64")}" alt="">`;

test("Abnahmeblatt: die Maßstabsleiste, zentriert und ohne Fläche", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(900_000);

    // ── 1. Vier Zoomstufen, heller Grund, echte Größe ─────────────────────────────────────────────
    const hell = await neu(browser, "light", RECHNER);
    const stufen: { zoom: number; shot: Shot }[] = [];
    for (const zoom of [2, 4, 6, 8]) {
        await setZoom(hell, zoom);
        stufen.push({ zoom, shot: await crop(hell, 340, 90) });
    }

    // ── 2. Heller und dunkler Kartengrund, hell und dunkel gestimmt ───────────────────────────────
    await setZoom(hell, 5);
    await placeUnderBar(hell, { x: 450, y: 560 }, 5);
    const grundHell = await crop(hell, 340, 90);
    const hellVoll = await hell.screenshot({ clip: { x: 0, y: 0, ...RECHNER } });

    // Mit Toast: sie steigt darüber, mit Legacys 6 px Luft.
    await showToast(hell, "Kurze Meldung über der Karte.");
    const mitToast = await crop(hell, 420, 150);
    await showToast(
        hell,
        "Eine deutlich längere Meldung, die über mehrere Zeilen läuft und den Kasten wachsen lässt - der Hub führt nach.",
    );
    const mitLangemToast = await crop(hell, 420, 190);
    await hell.context().close();

    const dunkelGrund = await neu(browser, "light", RECHNER, "view=landscapes&layer=vegetation");
    const stelle = await darkSpot(dunkelGrund);
    if (stelle) await placeUnderBar(dunkelGrund, stelle, 5);
    const grundDunkel = await crop(dunkelGrund, 340, 90);
    const dunkelGrundVoll = await dunkelGrund.screenshot({ clip: { x: 0, y: 0, ...RECHNER } });
    await dunkelGrund.context().close();

    const dunkelThema = await neu(browser, "dark", RECHNER);
    await setZoom(dunkelThema, 5);
    const themaDunkel = await crop(dunkelThema, 340, 90);
    const dunkelVoll = await dunkelThema.screenshot({ clip: { x: 0, y: 0, ...RECHNER } });
    await dunkelThema.context().close();

    // ── 3. Telefon: 360 px, mit und ohne Toast, hell und dunkel ───────────────────────────────────
    const telefon = await neu(browser, "light", TELEFON);
    await setZoom(telefon, 5);
    const telefonNah = await crop(telefon, TELEFON.width, 150);
    const telefonVoll = await telefon.screenshot();
    await showToast(telefon, "Kurze Meldung am Telefon.");
    const telefonToast = await crop(telefon, TELEFON.width, 200);
    await telefon.context().close();

    const telefonDunkel = await neu(browser, "dark", TELEFON);
    await setZoom(telefonDunkel, 5);
    const telefonDunkelNah = await crop(telefonDunkel, TELEFON.width, 150);
    await telefonDunkel.context().close();

    const colour = CANON.colour;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 36px; width: 1340px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 0 0 10px; font-size: 17px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1060px; }
section { padding: 16px 0 18px; border-top: 1px solid ${colour["border"]}; }
.reihe { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; }
figure { margin: 0; }
figcaption { margin-top: 5px; font-size: 12px; color: ${colour["textMuted"]}; max-width: 420px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 4px; }
table { border-collapse: collapse; font-size: 13px; }
th, td { padding: 3px 16px 3px 0; text-align: left; font-weight: 400; }
th { color: ${colour["textMuted"]}; white-space: nowrap; }
code { font-family: Consolas, monospace; font-size: 12px; }
.frage { margin: 14px 0 0; padding: 12px 14px; border: 1px solid ${colour["warningSoftBorder"]};
    border-radius: 6px; background: ${colour["warningSoft"]}; color: ${colour["warningSoftText"]}; font-size: 13px; max-width: 1060px; }
.frage b { font-weight: 400; color: ${colour["textStrong"]}; }
</style></head><body>
<h1>Die Maßstabsleiste — zentriert, ohne Fläche, mit Legacys Saum</h1>
<p class="lead">WI-0096 · Betreiber 2026-10-07: „die dynamische skala zentriert, ohne hintergrund, schatten wie bei
legacy.“ Alle drei sind umgesetzt. Die Leiste steht auf der <b>Bildschirmmitte</b> wie Legacys <code>50vw</code> — auch
mit offenem Planer, denn Legacys Leiste kennt die Panels nicht. Sie trägt <b>keine Fläche, keinen Rahmen, keinen
Panelschatten</b>. Was sie trägt, ist der Saum: Tinte und Saumfarbe kommen aus der Kartenschrift selbst
(<code>labelFamily("place")</code>: Weiß auf Schwarz, die eine Regel der Kartenschrift), die Form des Saums aus dem
neuen Kanonwert <code>shadow.mapInk</code> = <code>${escape(CANON.shadow["mapInk"] ?? "")}</code> — in Legacys
<code>css/features/map-scale-band.css</code> gemessen. <b>Kein Dunkelwert</b>, wie bei <code>mediaMark</code> und
<code>tooltip</code>: Der Saum trennt von der <i>Karte</i>, und die Karte hat kein dunkles Thema.</p>

<section>
<h2>1 · Vier Zoomstufen, in echter Größe</h2>
<div class="reihe">
${stufen
    .map(
        (row) =>
            `<figure>${png(row.shot.picture, 340)}<figcaption>z${String(row.zoom)} · ${escape(row.shot.label)} auf ${String(row.shot.width)} px</figcaption></figure>`,
    )
    .join("")}
</div>
</section>

<section>
<h2>2 · Lesbarkeit: heller und dunkler Kartengrund</h2>
<div class="reihe">
<figure>${png(grundHell.picture, 340)}<figcaption><b>Heller Grund</b> — blankes Pergament der Grundkarte, Leuchtdichte <b>0,866</b>. Der schwere Fall für weiße Tinte.</figcaption></figure>
<figure>${png(grundDunkel.picture, 340)}<figcaption><b>Dunkler Grund</b> — Sümpfe und Moore in der Vegetationsansicht, dort deckend gezeichnet; unter der Leiste <b>0,106</b>. Der schwere Fall für den Saum.</figcaption></figure>
<figure>${png(themaDunkel.picture, 340)}<figcaption><b>Dunkles Thema</b> — dieselbe Leiste, unverändert: Die Karte hat kein dunkles Thema, also hat die Leiste auch keines.</figcaption></figure>
</div>
<p class="lead" style="margin:12px 0 0">Gemessen am <b>gezeichneten Bild</b>, nicht an den Farbwerten des Stilblatts.
Was die Leiste vom Grund trennt, ist auf hellem Grund der <b>Saum</b> und auf dunklem die <b>Tinte</b> — der Prüflauf
<code>massstab.spec.ts</code> verlangt von dem jeweils tragenden mindestens <b>3 : 1 gegen den Grund</b> und zwischen
Tinte und Saum <b>4,5 : 1</b>. 🚩 <b>Befund:</b> Unsere Karte ist fast überall hell — in der Standardansicht führt der
Stil weder Landschaftsfüllungen noch Gewässerflächen, dort liegt immer der Papierton 0,866. Dunklen Grund gibt es nur in
den Landschaftsansichten.</p>
</section>

<section>
<h2>3 · Was unten am Rand sonst liegt: sie steigt darüber, wie in Legacy</h2>
<div class="reihe">
<figure>${png(mitToast.picture, 420)}<figcaption>Mit einem kurzen Toast: die Leiste steht <b>6 px</b> über ihm — Legacys Luft, gemessen statt gerechnet.</figcaption></figure>
<figure>${png(mitLangemToast.picture, 420)}<figcaption>Der Toast wird zweizeilig, <i>während</i> er steht: der Hub führt nach, die 6 px bleiben.</figcaption></figure>
</div>
</section>

<section>
<h2>4 · 1280 und 360, hell und dunkel</h2>
<div class="reihe">
<figure>${png(telefonNah.picture, 360)}<figcaption>360 px, hell · echte Größe. Bei 360 schneidet die mittige Leiste den Eckbund waagerecht — gelöst wie in Legacy: Sie <b>steigt</b> über die Verweiszeile, statt zur Seite zu weichen.</figcaption></figure>
<figure>${png(telefonDunkelNah.picture, 360)}<figcaption>360 px, dunkles Thema · echte Größe</figcaption></figure>
<figure>${png(telefonToast.picture, 360)}<figcaption>360 px mit Toast: zwei Dinge übereinander, die Leiste über beiden</figcaption></figure>
</div>
<div class="reihe" style="margin-top:16px">
<figure>${png(hellVoll, 600)}<figcaption>1280 × 900, hell</figcaption></figure>
<figure>${png(dunkelVoll, 600)}<figcaption>1280 × 900, dunkles Thema</figcaption></figure>
</div>
<div class="reihe" style="margin-top:16px">
<figure>${png(dunkelGrundVoll, 600)}<figcaption>1280 × 900, Vegetationsansicht — der dunkle Kartengrund im ganzen Bild</figcaption></figure>
<figure>${png(telefonVoll, 180)}<figcaption>360 × 780</figcaption></figure>
</div>
</section>

<section>
<h2>5 · Woher jede Zahl kommt</h2>
<table>
<tr><th>Tinte</th><td><code>labelFamily("place").color</code> = #ffffff — die eine Regel der Kartenschrift (Guide §20)</td></tr>
<tr><th>Saum</th><td><code>shadow.mapInk</code> = <code>${escape(CANON.shadow["mapInk"] ?? "")}</code>, aus Legacys <code>map-scale-band.css</code>; Geometrie wie <code>mediaMark</code>, Farbe wie <code>labelFamily("place").haloColor</code></td></tr>
<tr><th>Mitte</th><td><code>left: 50%</code> im Stilblatt — wie Legacys <code>margin-left: 50vw</code>, ohne gemessene Zahl, die veralten könnte</td></tr>
<tr><th>Luft nach oben</th><td>6 px, Legacys Wert; der Hub selbst ist <b>gemessen</b> (Rechteck ohne <code>transform</code>) und ersetzt den Kartenrand, statt sich zu ihm zu addieren</td></tr>
<tr><th>Striche</th><td>11 auf Zehnteln, groß bei 0/50/100 % — Legacy, Strich für Strich</td></tr>
<tr><th>Maße</th><td>Balken <code>space.16</code> (18 px), große Marke <code>space.6</code> (8 px), Schrift <code>typography.size.caption</code> (11 px), Rand <code>space.10</code> (12 px)</td></tr>
</table>
<p class="frage">🔴 <b>Unverändert und weiterhin offen:</b> ob die Zahl zwischen zwei ganzen Zoomstufen folgen soll
(Regel A, gebaut: Deckel auf der Breite, 6 Zahlenwechsel über z1…z8) oder an der ganzen Stufe hängen soll wie in Legacy
(Regel B). Diese Runde hat nur die <i>Gestalt</i> geändert, nicht das Verhalten.</p>
</section>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheet = await browser.newContext({ viewport: { width: 1404, height: 1200 }, deviceScaleFactor: 2 });
    const blatt = await sheet.newPage();
    await blatt.setContent(html);
    await blatt.evaluate(() => document.fonts.ready);
    await blatt.waitForTimeout(500);
    await blatt.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheet.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
