import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Blatt „110 Pfeile in einer Reihe“ (WI-0107).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit der Betreiber die DICHTE am Bild beurteilt. Geprüft wird in
 * `apps/web/e2e/externe-links.spec.ts`.
 *
 * 🔴 **Der Auftrag ist umgesetzt** (Betreiber 2026-10-07: „kannst du bei allein externen links immer das symbol ↗
 * verwenden … aber du hast jetzt bei den vorkommen (alles wiki-links ↗ nicht rangemacht - war schon in legacy falsch)“):
 * Der Pfeil kommt jetzt aus EINER Hausregel und steht an jedem Anker, der die Seite verlässt — auch an jedem der 110
 * Tiernamen von Drunidet. 🪤 **Vorzulegen ist nur, was er in dieser Dichte KOSTET**: Das Register wird höher, und ein
 * Teil der Pfeile rutscht trotz geschütztem Leerzeichen in die nächste Zeile.
 *
 *   npm run review:externe-links
 *
 * 🪤 Es braucht keinen zweiten Stapel mit dem alten Stand: Der Unterschied IST die eine Regel, und die linke Spalte
 * entsteht, indem derselbe Stapel sie für die Aufnahme abschaltet (`content: none`). Mehr war an der Stelle nie.
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Arbeitsbaums auf dem Port, den `PORT` nennt. Eigene Ports:
 *   $env:PORT="3277"; $env:E2E_PORT="5277"; npm run review:externe-links
 *
 * Ablage: `review/wi-0107/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0107");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** 🔴 Drunidet: der dichteste Fall des Bestands — 110 Tierarten in EINER kommagetrennten Reihe. */
const DRUNIDET = { kind: "place", id: "9a04121d-6f4d-533e-9207-05738e16bdf0" } as const;

/** Die Regel, mit der die Aufnahme „ohne Pfeil“ entsteht — nichts anderes wird abgeschaltet. */
const OHNE_PFEIL = 'a[target="_blank"]::after { content: none; }';
/** Und die, mit der die Aufnahme „gewöhnliches Leerzeichen“ entsteht. */
const LEERZEICHEN = 'a[target="_blank"]::after { content: " \\2197" / ""; }';

interface Mass {
    hoehe: number;
    abgerissen: number;
    ueberlauf: number;
}

interface Aufnahme {
    png: Buffer;
    mass: Mass;
}

async function openRegister(browser: Browser, baseURL: string, width: number): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 1100 },
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), DRUNIDET);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    const row = page.locator('[data-field="lore:fauna"]');
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    await row.getByTestId("info-lore-sheet").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    return page;
}

/** Höhe des Registers, abgerissene Pfeile und waagerechter Überlauf — am gezeichneten Bild. */
async function messen(page: Page): Promise<Mass> {
    return page.evaluate(() => {
        const bloecke = [...document.querySelectorAll('[data-field="lore:fauna"] [data-testid="info-lore-names"]')];
        const sheet = document.querySelector('[data-field="lore:fauna"] [data-testid="info-lore-sheet"]');
        let abgerissen = 0;
        for (const link of bloecke.flatMap((block) => [...block.querySelectorAll("a.info-lore__wiki")])) {
            const stuecke = [...link.getClientRects()];
            const letztes = stuecke.at(-1);
            const davor = stuecke.at(-2);
            if (stuecke.length > 1 && (letztes?.top ?? 0) > (davor?.top ?? 0) + 1) abgerissen += 1;
        }
        return {
            hoehe: Math.round((sheet?.getBoundingClientRect().height ?? 0) * 100) / 100,
            abgerissen,
            ueberlauf: Math.max(0, ...bloecke.map((block) => block.scrollWidth - block.clientWidth)),
        };
    });
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Blatt: 110 Pfeile in einer Reihe", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Aufnahme | undefined> = {};

    const nimm = async (key: string, width: number, css: string, nah: boolean): Promise<void> => {
        const page = await openRegister(browser, baseURL, width);
        if (css !== "") {
            await page.addStyleTag({ content: css });
            await page.waitForTimeout(200);
        }
        const mass = await messen(page);
        const ziel = nah
            ? page.locator('[data-field="lore:fauna"] [data-testid="info-lore-sheet"]').first()
            : page.getByTestId("info-panel").first();
        const png = await ziel.screenshot();
        shots[key] = { png, mass };
        testInfo.annotations.push({
            type: "Blatt",
            description: `${key}: ${String(mass.hoehe)} px · ${String(mass.abgerissen)} abgerissen · Überlauf ${String(mass.ueberlauf)}`,
        });
        await page.context().close();
    };

    // Nahaufnahme: dieselbe Stelle dreimal, 1280 px.
    await nimm("nah-ohne", 1280, OHNE_PFEIL, true);
    await nimm("nah-mit", 1280, "", true);
    await nimm("nah-leer", 1280, LEERZEICHEN, true);
    // Echte Größe: das ganze Panel, einmal ohne und einmal mit.
    await nimm("gross-ohne", 1280, OHNE_PFEIL, false);
    await nimm("gross-mit", 1280, "", false);
    // Und am Telefon, wo das geschützte Leerzeichen gemessen alles hält.
    await nimm("telefon-mit", 360, "", true);

    const colour = CANON.colour;
    const cell = (key: string): string => {
        const shot = shots[key];
        if (shot === undefined) return "<div><p>nicht aufgenommen</p></div>";
        return `<div><p>${escape(
            `Register ${shot.mass.hoehe.toFixed(2)} px · ${String(shot.mass.abgerissen)} Pfeile allein in ihrer Zeile · ${String(shot.mass.ueberlauf)} px waagerechter Überlauf`,
        )}</p><img src="data:image/png;base64,${shot.png.toString("base64")}" alt=""></div>`;
    };

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 8px; font-size: 16px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
h3 { margin: 0 0 6px; font-size: 13px; font-weight: 400; color: ${colour["textMuted"]}; }
p { margin: 0 0 6px; color: ${colour["textMuted"]}; font-size: 12px; }
.drei { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; align-items: start; }
.zwei { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
img { display: block; max-width: 100%; border: 1px solid ${colour["divider"]}; border-radius: 8px; }
.note { margin: 14px 0 0; padding: 10px 12px; border: 1px solid ${colour["divider"]}; border-radius: 8px; color: ${colour["text"]}; font-size: 13px; }
.note b { color: ${colour["textStrong"]}; }
.frage { border-color: ${colour["link"]}; }
ul { margin: 6px 0 0; padding-left: 18px; }
table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
td, th { border: 1px solid ${colour["divider"]}; padding: 3px 8px; text-align: left; color: ${colour["text"]}; }
th { color: ${colour["textStrong"]}; font-weight: 400; }
</style></head><body>
<h1>Der Pfeil steht jetzt überall — und so sieht er in 110-facher Dichte aus</h1>
<p>Drunidet, Zeile Fauna: 110 Tiernamen, alle Links in die Wiki Aventurica, eine kommagetrennte Reihe im
Buchstabenregister. Alle Aufnahmen aus demselben Stapel; der einzige Unterschied ist die eine Hausregel.</p>

<div class="note"><b>Was gebaut ist.</b> Der Pfeil kommt aus EINER Stelle (<code>a[target="_blank"]::after</code> in
<code>styles/canon.css</code>) und steht damit an jedem Anker, der die Seite verlässt: Vorkommensnamen, Quellenzeile,
ⓘ-Tafel, Publikationen, Literaturtitel, Kartensammlung, Hinweise-Fenster, Statusseite. Vorher stand er an sechs Stellen
einzeln und fehlte an sieben. Er trägt einen leeren Alternativtext — ein Vorleser sagt ihn nicht mit, auch nicht
110-mal.</div>

<h2>Nahaufnahme · 1280 px <span>dieselbe Stelle, nur die Regel wechselt</span></h2>
<div class="drei">
  <div><h3>ohne Pfeil (wie bisher)</h3>${cell("nah-ohne")}</div>
  <div><h3>mit Pfeil, geschütztes Leerzeichen (gebaut)</h3>${cell("nah-mit")}</div>
  <div><h3>mit Pfeil, gewöhnliches Leerzeichen</h3>${cell("nah-leer")}</div>
</div>

<h2>Echte Größe · das ganze Panel bei 1280 px</h2>
<div class="zwei">
  <div><h3>ohne Pfeil</h3>${cell("gross-ohne")}</div>
  <div><h3>mit Pfeil (gebaut)</h3>${cell("gross-mit")}</div>
</div>

<h2>Am Telefon · 360 px <span>dort hält das geschützte Leerzeichen gemessen jeden Pfeil an seinem Namen</span></h2>
<div class="zwei"><div><h3>mit Pfeil (gebaut)</h3>${cell("telefon-mit")}</div><div></div></div>

<div class="note frage"><b>🔴 Das musst du entscheiden, und nur das.</b> Der Pfeil kostet in dieser einen Dichte Höhe,
und ein Teil der Pfeile rutscht in die nächste Zeile — die Reihe darf mit <code>overflow-wrap: anywhere</code> an jeder
Stelle umbrechen (WI-0099, gegen Namen, die breiter sind als die Spalte), und das schlägt auch ein geschütztes
Leerzeichen.
<ul>
<li><b>A</b> — so lassen: Der Pfeil steht überall, wie verlangt. (gebaut)</li>
<li><b>B</b> — der Pfeil nur EINMAL je Gruppe, als Hinweis an der Überschrift, nicht an jedem Namen.</li>
<li><b>C</b> — in der Vorkommensreihe keinen Pfeil, überall sonst schon (dann wäre es wieder eine Ausnahme).</li>
</ul>
Die Zahlen über den Bildern sind gemessen, nicht geschätzt.</div>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__pfeilblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__pfeilblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
