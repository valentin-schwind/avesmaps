import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { onPage, settleFrame } from "./map-handle.ts";

/**
 * Abnahmeblatt zum Nachtrag „Die Umrisse der Inselgruppen über offenem Wasser kommen zurück" (WI-0083,
 * Betreiber 2026-10-05: „ja wenns geht, ansonsten schneiden wir die aus").
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor: fünf Stellen × fünf Ansichten, je vorher gegen nachher.
 * Die Prüfungen stehen in `lake-smooth.test.ts`, `topography.test.ts` und `area-view-scope.spec.ts`.
 *
 * Zwei Durchgänge, weil „vorher" und „nachher" zwei Stände des Codes sind:
 *
 *   # auf dem alten Stand
 *   $env:AVM_BLATT_PHASE = "vorher";  npx playwright test e2e/island-edges-review.spec.ts --workers=1
 *   # auf dem neuen Stand
 *   $env:AVM_BLATT_PHASE = "nachher"; npx playwright test e2e/island-edges-review.spec.ts --workers=1
 *
 * Der erste Durchgang legt die Ausschnitte unter `review/wi-0083/inselkanten/vorher/` ab, der zweite nimmt sie
 * wieder auf und setzt das Blatt daraus: `review/wi-0083/inselkanten/blatt.png` (`review/` ist nicht versioniert).
 * Fehlt ein Vorher-Bild, bleibt die Zelle leer und sagt es - ein Blatt, das stillschweigend das Nachher zweimal
 * zeigt, wäre keine Aussage.
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0083/inselkanten");
const BEFORE = resolve(OUTPUT, "vorher");
const AFTER = resolve(OUTPUT, "nachher");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const PHASE = process.env["AVM_BLATT_PHASE"] === "vorher" ? "vorher" : "nachher";

/**
 * Ein Ausschnitt: so wird er aufgenommen (`CROP`) und so steht er auf dem Blatt (`SHOW`).
 *
 * 💣 Aufgenommen wird GRÖSSER als gezeigt. Eine Inselgruppe wie die Waldinseln ist 343 E breit; sollte sie in
 * 280 Bildpunkte passen, zeigte das Fenster von 1280 Bildpunkten mehr als die ganze Welt - und die Karte
 * klemmt die Kamera an ihre Grenzen, statt dorthin zu fahren. Das Blatt zeigte dann Gareth statt der Inseln.
 */
const CROP = { width: 700, height: 500 };
const SHOW = { width: 280, height: 200 };

/**
 * Die Stellen. `spanne` ist die Kantenlänge in Kartenfeldern (E), die der Ausschnitt der Breite nach zeigt;
 * die Zoomstufe dazu rechnet der Lauf an der laufenden Karte aus, mit ihrer eigenen Projektion.
 */
const PLACES = [
    {
        key: "waldinseln",
        title: "Waldinseln (Ostende)",
        note: "Inselgruppe, 6.605 von 10.291 E² liegen im Meerpolygon — das offene Wasser innerhalb der Gruppe liegt hier",
        x: 780,
        y: 80,
        span: 115,
    },
    {
        key: "talanische-zaehne",
        title: "Talanische Zähne",
        note: "Inselgruppe, 1.027 von 1.027 E² im Meerpolygon — sie liegt vollständig im Meer",
        x: 170.875,
        y: 482.969,
        span: 72,
    },
    {
        key: "pirateninseln",
        title: "Pirateninseln",
        note: "Inselgruppe, 1.068 von 3.686 E² im Meerpolygon",
        x: 541.875,
        y: 96.875,
        span: 124,
    },
    {
        key: "taanakauki",
        title: "Taanakauki",
        note: "Insel, Hochebene und Tundra, alle drei vollständig im Meerpolygon — die Gegenprobe für die Vegetation (allein deckend)",
        x: 783.501,
        y: 974.149,
        span: 22,
    },
    {
        key: "perricum",
        title: "Golf von Perricum",
        note: "gewöhnliche Küste zur Gegenprobe: hier teilen Land und Meer dieselbe Kante",
        x: 650,
        y: 480,
        span: 62,
    },
] as const;

const VIEWS = [
    ["alle", "Alle"],
    ["topographie", "Topographie"],
    ["vegetation", "Vegetation"],
    ["derographisch", "Derographisch"],
    ["klima", "Klimazonen"],
] as const;

type PlaceKey = (typeof PLACES)[number]["key"];
type ViewKey = (typeof VIEWS)[number][0];

const shotName = (place: PlaceKey, view: ViewKey): string => `${place}-${view}.png`;

/** Die Mitte der Karte in Bildpunkten. */
const middle = (page: Page): Promise<{ x: number; y: number }> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const at = map.project(map.getCenter());
        return { x: Math.round(at.x), y: Math.round(at.y) };
    });

/**
 * Die Stelle ins Bild holen, so dass `span` Kartenfelder der Breite des Ausschnitts entsprechen.
 *
 * 🪤 Die Zoomstufe wird nicht gerechnet, sondern GEMESSEN: einmal auf eine Startstufe springen, an der laufenden
 * Karte nachsehen, wie viele Bildpunkte die Spanne dort breit ist, und die Stufe um den Zweierlogarithmus des
 * Verhältnisses nachziehen. Eine Formel aus der Kartendomäne wäre eine zweite Projektion - und am Südrand, wo
 * Mercator streckt, die falsche.
 */
async function frame(page: Page, place: { x: number; y: number; span: number }): Promise<void> {
    let zoom = 5;
    for (let round = 0; round < 3; round += 1) {
        const measured = await page.evaluate(
            async ({ target, level, span }) => {
                const map = globalThis.avesmapsMap;
                const projection = globalThis.avesmapsRenderProjection;
                if (!map || !projection) throw new Error("map or projection handle missing");
                map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level, bearing: 0, pitch: 0 });
                await new Promise<void>((done) => map.once("idle", done));
                const left = map.project(projection.toRenderLngLat({ x: target.x - span / 2, y: target.y }));
                const right = map.project(projection.toRenderLngLat({ x: target.x + span / 2, y: target.y }));
                return Math.abs(right.x - left.x);
            },
            { target: { x: place.x, y: place.y }, level: zoom, span: place.span },
        );
        if (measured <= 0) break;
        const next = Math.min(11, Math.max(0, zoom + Math.log2(CROP.width / measured)));
        if (Math.abs(next - zoom) < 0.02) break;
        zoom = next;
    }
    await page.evaluate(
        async ({ target, level }) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) throw new Error("map or projection handle missing");
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level, bearing: 0, pitch: 0 });
            await new Promise<void>((done) => map.once("idle", done));
        },
        { target: { x: place.x, y: place.y }, level: zoom },
    );
    await settleFrame(page);
}

/** Ein Ausschnitt der Karte um die Mitte. */
async function crop(page: Page): Promise<Buffer> {
    const at = await onPage(page, await middle(page));
    return page.screenshot({
        clip: { x: at.x - CROP.width / 2, y: at.y - CROP.height / 2, width: CROP.width, height: CROP.height },
    });
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test(`Abnahmeblatt Inselkanten über offenem Wasser (${PHASE})`, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const shotDir = PHASE === "vorher" ? BEFORE : AFTER;
    mkdirSync(shotDir, { recursive: true });
    const shots = new Map<string, Buffer>();
    let round = 0;
    for (const [view, title] of VIEWS) {
        round += 1;
        await page.goto(`/?r=${String(round)}#x=650&y=480&z=5&series=original&view=landscapes&layer=${view}`);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
        await settleFrame(page);
        for (const place of PLACES) {
            await frame(page, place);
            const png = await crop(page);
            shots.set(shotName(place.key, view), png);
            writeFileSync(resolve(shotDir, shotName(place.key, view)), png);
        }
        testInfo.annotations.push({ type: "Blatt", description: `${title} aufgenommen (${PHASE})` });
    }
    if (PHASE === "vorher") {
        testInfo.annotations.push({ type: "Blatt", description: `Vorher-Ausschnitte in ${BEFORE}` });
        return;
    }

    const colour = CANON.colour;
    const before = (place: PlaceKey, view: ViewKey): string => {
        const file = resolve(BEFORE, shotName(place, view));
        if (!existsSync(file)) return `<p class="fehlt">kein Vorher-Bild</p>`;
        return picture(readFileSync(file));
    };
    const picture = (png: Buffer): string =>
        `<img width="${String(SHOW.width)}" height="${String(SHOW.height)}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(testInfo.project.use.baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 30px 34px; width: 1500px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 18px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1180px; }
section { padding: 12px 0 16px; border-top: 1px solid ${colour["border"]}; }
h2 { margin: 0 0 2px; font-size: 17px; font-weight: 400; color: ${colour["textStrong"]}; }
.note { margin: 0 0 10px; font-size: 12px; color: ${colour["textMuted"]}; }
table { border-collapse: collapse; }
th { text-align: left; font-weight: 400; font-size: 12px; color: ${colour["textMuted"]}; padding: 0 12px 4px 0; }
td { padding: 0 12px 4px 0; vertical-align: top; }
td.lab { font-size: 12px; color: ${colour["textMuted"]}; padding-right: 10px; white-space: nowrap; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 5px; }
.fehlt { margin: 0; width: ${String(SHOW.width)}px; height: ${String(SHOW.height)}px; display: flex;
    align-items: center; justify-content: center; border: 1px dashed ${colour["border"]}; border-radius: 5px;
    font-size: 12px; color: ${colour["textMuted"]}; }
</style></head><body>
<h1>Die Umrisse der Inselgruppen über offenem Wasser</h1>
<p class="lead">Nachtrag zu WI-0083 · Betreiber 2026-10-05: „ja wenns geht, ansonsten schneiden wir die aus“.
Gebaut ist der saubere Weg: <b>das Meer liegt jetzt als Grund UNTER den Landschaftsfüllungen</b>, der See und die
Küstenlinie bleiben darüber. Vorher deckte das Meer alles zu, was innerhalb seines Polygons liegt — rund
12.000 E², 1,1 % der Welt: die gestrichelten Kanten der drei Inselgruppen, und dazu <b>75 Flächen der
Topographie, die ganz im Meerpolygon liegen</b> (1.584 E², darunter benannte Inseln wie Taanakauki) — die waren
in jeder der fünf Ansichten unsichtbar. Geblieben ist ein Saum: 99 Vegetationsflächen reichen mit zusammen
107 E² über die Küstenlinie hinaus ins Wasser (größter Einzelsaum 22 E², ein Prozent seiner Fläche); in der
Vegetationsansicht, wo die Füllung allein deckend ist, liegt dieser Saum als Farbe auf dem Wasser, die
Küstenlinie selbst bleibt oben und bleibt scharf. Jede Zelle zeigt oben den alten, unten den neuen Stand.</p>
${PLACES.map(
    (place) => `<section><h2>${escape(place.title)}</h2><p class="note">${escape(place.note)}</p>
<table><tr><th></th>${VIEWS.map(([, title]) => `<th>${escape(title)}</th>`).join("")}</tr>
<tr><td class="lab">vorher</td>${VIEWS.map(([view]) => `<td>${before(place.key, view)}</td>`).join("")}</tr>
<tr><td class="lab">nachher</td>${VIEWS.map(([view]) => `<td>${picture(shots.get(shotName(place.key, view)) ?? Buffer.alloc(0))}</td>`).join("")}</tr>
</table></section>`,
).join("\n")}
</body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
