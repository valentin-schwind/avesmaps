import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type Page } from "@playwright/test";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import { EDITOR_MODE, GARETH, openMap, showCamera } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt WI-0129 R2: Zoomstufe 8 und die Zoomanzeige im Editor.
 *
 * 💣 Dieser Lauf prüft NICHTS über die Anwendung. Er legt dem Betreiber vor, wie Stufe 8 aussieht (E1 A Überzoom, E2 A Stufe 8
 * zeigt die Darstellung von Stufe 7) und wie die gebaute Anzeige gegen Blatt E3 A steht. Die Zusicherungen stehen in
 * `zoomstufe-8.spec.ts`. Nur, wenn die Datei genannt wird (`playwright.config.ts`, `SHEET_SPECS`):
 *
 *   npm run review:zoomstufe-8
 *
 * Ein Blatt: `review/wi-0129/stufe-8/blatt.png`. 🪤 Gelände und Neigung brauchen die Grafikkarte (`--use-angle=d3d11`).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0129/stufe-8");

// Gelände und Neigung zeichnet Chromium nur mit der Grafikkarte; ohne sie wäre das 3D-Paar flach.
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu"] } });
const EDITOR = ["view_flow_directions", "use_editor_menu", "view_editor_series"];
/** Die Koschberge um Âthykril: Gebirge, Landschafts-Punktnamen, Fluss, See (dieselbe Stelle wie WI-0131 Blatt 1). */
const KOSCH = { x: 473, y: 516.8 };

interface Shot {
    title: string;
    png: Buffer;
}

async function page(browser: Browser, baseURL: string, phone = false): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        ...(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }),
    });
    const p = await context.newPage();
    await stubAdmin(p, { capabilities: EDITOR, role: "editor" });
    await openMap(p, EDITOR_MODE);
    const hint = p.getByTestId("camera-hint-close");
    if (await hint.isVisible().catch(() => false)) await hint.click();
    // Der Planer klappt am Rechner auf und deckt die halbe Karte: zu, damit die Stufen vergleichbar sind.
    const tab = p.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded").catch(() => null)) === "true") await tab.click();
    return p;
}

async function shot(p: Page, title: string, view: Parameters<typeof showCamera>[1]): Promise<Shot> {
    await showCamera(p, view);
    await p.waitForTimeout(400);
    return { title, png: await p.screenshot() };
}

const image = (png: Buffer, width: number): string =>
    `<img style="width:${String(width)}px" src="data:image/png;base64,${png.toString("base64")}" alt="">`;

test("Blatt WI-0129 R2: Zoomstufe 8 und die Zoomanzeige", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const baseURL = String(testInfo.project.use.baseURL);

    const desk = await page(browser, baseURL);
    const pairs: [Shot, Shot][] = [
        [
            await shot(desk, "Gareth · Stufe 7 (bisher die höchste)", { point: GARETH, zoom: 8 }),
            await shot(desk, "Gareth · Stufe 8 (neu)", { point: GARETH, zoom: 9 }),
        ],
        [
            await shot(desk, "Koschberge · Stufe 7", { point: KOSCH, zoom: 8 }),
            await shot(desk, "Koschberge · Stufe 8", { point: KOSCH, zoom: 9 }),
        ],
        [
            await shot(desk, "Koschberge · Stufe 7, 3D 60°", { point: KOSCH, zoom: 8, bearing: -20, pitch: 60 }),
            await shot(desk, "Koschberge · Stufe 8, 3D 60°", { point: KOSCH, zoom: 9, bearing: -20, pitch: 60 }),
        ],
    ];
    await showCamera(desk, { point: GARETH, zoom: 9 });
    const ring = await desk.getByTestId("camera-controls").boundingBox();
    const nah = ring
        ? await desk.screenshot({
              clip: { x: ring.x - 40, y: ring.y - 10, width: ring.width + 80, height: ring.height + 90 },
          })
        : await desk.screenshot();
    const phone = await page(browser, baseURL, true);
    await showCamera(phone, { point: GARETH, zoom: 9 });
    const handy = await phone.screenshot();

    const colour = DESIGN_CANON.colour;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1360px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 16px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1250px; }
.reihe { display: grid; grid-template-columns: repeat(2, max-content); gap: 10px 18px; margin-bottom: 16px; }
.reihe p { margin: 0 0 5px; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; }
.note { margin: 14px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1250px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>WI-0129 R2 · Zoomstufe 8 und die Zoomanzeige im Editor</h1>
<p class="lead">Links Stufe 7, bisher die höchste, rechts die neue Stufe 8, an derselben Stelle. Stufe 8 zeigt die Darstellung von
Stufe 7 vergrößert (E2 A): Marken und Schrift bleiben gleich groß, Grundkarte und Gelände sind überzoomt (E1 A, keine neuen
Kacheln). Die Zahl unter dem Steuerring ist die fachliche Zoomstufe (E3 A); Besucher sehen sie nicht.</p>
${pairs
    .map(
        ([a, b]) =>
            `<div class="reihe"><div><p>${a.title}</p>${image(a.png, 660)}</div><div><p>${b.title}</p>${image(b.png, 660)}</div></div>`,
    )
    .join("\n")}
<div class="reihe">
<div><p>Zoomanzeige am Rechner · echte Größe</p>${image(nah, 260)}</div>
<div><p>am Telefon · neben dem Kameraknopf, über dem Auge</p>${image(handy, 330)}</div>
</div>
<p class="note"><b>Zu prüfen:</b> Stehen auf Stufe 8 dieselben Namen wie auf Stufe 7 (Landschaften, Orte, Flüsse, Wege)? Ist die
überzoomte Grundkarte auf Stufe 8 noch brauchbar? Sitzt die Anzeige wie auf Blatt E3 A? Fahrten (Grenzübertritt, Route, Kraftlinie)
fliegen weiter höchstens bis Stufe 7; Stufe 8 erreicht nur, wer selbst heranzoomt.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1420, height: 1100 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__wi0129r2.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__wi0129r2.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
