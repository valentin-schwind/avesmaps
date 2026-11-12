import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Blatt „Kommen die Daten des ersten Detailzugs im Panel an?“ (Gegenprobe zu Claudios Stage-Lauf vom 2026-10-06,
 * `project-control/handovers/2026-10-05-korridor-i17-i26-gebaut.md`, Nachtrag „erster Detailzug auf Stage grün“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet, und schreibt die
 * gemessenen Zahlen unter jedes Bild. Die Prüfungen stehen in `subjects-p8.test.ts`, `wiki-link-targets.test.ts`,
 * `link-pieces.test.ts` und `catalog-model.test.ts`; den Bestand zählt `npm run verify:wiki-links`.
 *
 * Gezeigt wird GARETH, weil es das einzige Objekt ist, das alle vier Dinge gleichzeitig trägt: Objektlinks in der
 * Feldliste (5), Literatur (110 Werke, 25 davon unter dem Spoiler-Deckel), Kartensammlung (12, 2 gedeckelt) und
 * Bewertungen (9, Schnitt 3,8).
 *
 * 🪤 Als dieses Blatt entstand, erschien die LORE nicht - es gab keinen Lesepfad. Seit WI-0091 gibt es ihn: `lore` ist die
 * fünfte Sektion, und die vier Zeilen stehen in der Datentabelle. Das eigene Blatt dazu ist `npm run review:vorkommen`;
 * dieses hier zeigt sie seither mit, ohne sie zu messen.
 *
 *   npm run review:detailzug
 *
 * 🪤 Braucht einen Fastify auf dem Port, den `PORT` nennt (Vite liest daraus das Proxyziel), und eine
 * Entwicklungsdatenbank, in der I24, I25 und I26 gelaufen sind. Eigene Ports einer Sitzung:
 *   $env:PORT="3249"; $env:E2E_PORT="4249"; npm run review:detailzug
 *
 * Ablage: `review/wi-0063/detailzug/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0063/detailzug");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Gareth: der einzige Ort mit Links, allen drei Katalogabschnitten und genug Zeilen, dass ein Deckel zu sehen ist. */
const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;

type Scheme = "light" | "dark";
/** Was ein Bild des Blattes zeigt: die Feldliste oder einen der drei Katalogabschnitte. */
type Part = "facts" | "literature" | "citymaps" | "reviews" | "panel";

interface Shot {
    png: Buffer;
    /** Die Zeile unter dem Bild: was gezählt wurde. */
    measured: string;
}

/** Das Panel von Gareth, geöffnet und fertig gezeichnet. */
async function openPanel(browser: Browser, baseURL: string, scheme: Scheme, width: number): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 1000 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    return page;
}

/** Zählt die klickbaren Objektlinks der Feldliste, je Feld. */
async function countLinks(page: Page): Promise<{ total: number; perField: string }> {
    return page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="info-fact"]')];
        const per = new Map<string, number>();
        let total = 0;
        for (const row of rows) {
            const links = row.querySelectorAll('[data-testid="info-link"]').length;
            if (links === 0) continue;
            total += links;
            const label = row.querySelector('[data-testid="info-fact-label"]')?.textContent?.trim() ?? "?";
            per.set(label, (per.get(label) ?? 0) + links);
        }
        return {
            total,
            perField: [...per].map(([field, n]) => `${field} ${String(n)}`).join(", "),
        };
    });
}

/** Ein Teil des Panels als Bild, dazu die Zahl, die darunter steht. */
async function capture(
    browser: Browser,
    baseURL: string,
    options: { scheme: Scheme; part: Part; width: number },
): Promise<Shot> {
    const page = await openPanel(browser, baseURL, options.scheme, options.width);
    let target = page.locator('[data-testid="info-facts"]');
    let measured: string;
    if (options.part === "facts") {
        const links = await countLinks(page);
        measured = `${String(links.total)} klickbare Objektlinks — ${links.perField}`;
    } else if (options.part === "panel") {
        target = page.getByTestId("info-panel").first();
        const links = await countLinks(page);
        measured = `ganzes Panel, ${String(links.total)} Objektlinks`;
    } else {
        target = page.locator(`[data-section="${options.part}"]`);
        await target.waitFor({ timeout: 30_000 });
        await target.scrollIntoViewIfNeeded();
        // 🪤 `loading="lazy"`: nur was im Blick liegt, lädt sein Bild. Gewartet wird auf genau diese Bilder.
        await page
            .waitForFunction(
                (section) => {
                    const root = document.querySelector(`[data-section="${section}"]`);
                    if (root === null) return false;
                    const images = [...root.querySelectorAll("img")];
                    return images.every((image) => image.complete);
                },
                options.part,
                { timeout: 30_000 },
            )
            .catch(() => undefined);
        measured = await page.evaluate((section) => {
            const root = document.querySelector(`[data-section="${section}"]`);
            if (root === null) return "Abschnitt fehlt";
            const head = root.querySelector("h3, h2, [class*=head]")?.textContent?.trim() ?? "";
            if (section === "reviews") {
                // Seit WI-0269 C10 der Reiter „Bewertungen“ (`info-bewertungen.vue`); die Zeile im Kopf nennt den Schnitt.
                const items = root.querySelectorAll('[data-testid="info-bewertungen-eintrag"]').length;
                const summary =
                    document.querySelector('[data-testid="info-bewertungszeile"]')?.textContent?.trim() ?? "";
                return `${String(items)} Bewertungen · ${summary} · Kopf: ${head}`;
            }
            const card = section === "literature" ? "info-literature-card" : "info-citymaps-card";
            const cards = [...root.querySelectorAll<HTMLElement>(`[data-testid="${card}"]`)];
            const veiled = cards.filter((item) => item.className.includes("veiled")).length;
            return `${String(cards.length)} Kacheln, ${String(veiled)} unter dem Spoiler-Deckel · Kopf: ${head}`;
        }, options.part);
    }
    await target.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(350);
    const png = await target.screenshot();
    await page.context().close();
    return { png, measured };
}

/** Öffnet jeden Objektlink der Feldliste und notiert, was danach im Kopf steht. */
async function followLinks(browser: Browser, baseURL: string): Promise<string[]> {
    const page = await openPanel(browser, baseURL, "light", 1280);
    const labels = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="info-link"]')].map(
            (item) => item.textContent?.trim() ?? "",
        ),
    );
    const results: string[] = [];
    for (const [index, label] of labels.entries()) {
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
        await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
        const link = page.locator('[data-testid="info-link"]').nth(index);
        await link.click();
        await page.waitForTimeout(900);
        const opened = await page.evaluate(
            () => document.querySelector('[data-testid="info-title"]')?.textContent?.trim() ?? "",
        );
        results.push(`»${label}« öffnet „${opened}“`);
    }
    await page.context().close();
    return results;
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Blatt: kommen die Daten des ersten Detailzugs im Panel an?", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot> = {};
    for (const scheme of ["light", "dark"] as const) {
        for (const part of ["facts", "literature", "citymaps", "reviews"] as const) {
            shots[`${part}-${scheme}`] = await capture(browser, baseURL, { scheme, part, width: 1280 });
            testInfo.annotations.push({
                type: "Blatt",
                description: `${part} ${scheme}: ${shots[`${part}-${scheme}`]?.measured ?? ""}`,
            });
        }
    }
    // Das Telefon: dasselbe Panel in einem 360 px breiten Fenster, hell und dunkel.
    shots["panel-phone-light"] = await capture(browser, baseURL, { scheme: "light", part: "panel", width: 360 });
    shots["panel-phone-dark"] = await capture(browser, baseURL, { scheme: "dark", part: "panel", width: 360 });

    const followed = await followLinks(browser, baseURL);
    for (const line of followed) testInfo.annotations.push({ type: "Klick", description: line });

    const colour = CANON.colour;
    const image = (key: string): string =>
        `<img src="data:image/png;base64,${(shots[key] as Shot).png.toString("base64")}" alt="">`;
    const note = (key: string): string => escape((shots[key] as Shot).measured);
    const block = (title: string, extra: string, part: Part): string => `
<h2>${escape(title)} <span>· ${escape(extra)}</span></h2>
<div class="pair">
  <div><p>hell — ${note(`${part}-light`)}</p>${image(`${part}-light`)}</div>
  <div><p>dunkel — ${note(`${part}-dark`)}</p>${image(`${part}-dark`)}</div>
</div>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 980px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 26px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.pair { display: grid; grid-template-columns: 460px 460px; gap: 24px; align-items: start; }
.pair > div > p { margin: 0 0 6px; font-size: 12px; color: ${colour["textMuted"]}; min-height: 2.6em; }
.phone { display: grid; grid-template-columns: 360px 360px; gap: 24px; align-items: start; }
.phone img { width: 360px; }
img { display: block; width: 100%; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 18px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
ul { margin: 6px 0 0; padding-left: 20px; }
li { margin: 2px 0; }
</style></head><body>
<h1>Kommen die Daten des ersten Detailzugs im Panel an?</h1>
<p class="lead">Gegenprobe zu Claudios Stage-Lauf (PASS=187, FAIL=0) · gemessen am LOKALEN Stapel, in dem I24, I25 und I26 ebenso gelaufen sind · Gareth · links helles, rechts dunkles Thema, echte Größe.</p>

${block("Feldliste mit Objektlinks", "aus den Wiki-Linkzielen (X1) über den Wiki-Key (X2)", "facts")}
${block("Literatur", "Importschritt I20 · 2.003 Werke in der Datenbank", "literature")}
${block("Kartensammlung", "Importschritt I21 · 543 Karten in der Datenbank", "citymaps")}
${block("Bewertungen", "Importschritt I22 · 180 Bewertungen in der Datenbank", "reviews")}

<h2>Am Telefon <span>· 360 px breit, ganzes Panel</span></h2>
<div class="phone">
  <div><p>hell — ${note("panel-phone-light")}</p>${image("panel-phone-light")}</div>
  <div><p>dunkel — ${note("panel-phone-dark")}</p>${image("panel-phone-dark")}</div>
</div>

<p class="note"><b>Nicht jeder Link kommt aus dem Detailzug.</b> Von Gareths klickbaren Werten stammen nur
<i>Verkehrswege</i> und <i>Lage</i> aus den Wiki-Linkzielen (X1, Schritt I24) — das sind die 5 Links, die der
Projektzustand mit „Gareth 5“ meint. <i>Derographie</i> und <i>Klimazone</i> sind abgeleiteter Kontext und waren
schon vor dem Zug da; „Liegt in“ ebenso. 🪤 Gareths Artikel bietet 8 eindeutige Linkziele an: die 7 Nachbarn der
Windrose fallen weg, weil der Ortsleser gar keine Nachbarzeile baut.</p>

<p class="note"><b>Jeder Link wurde angeklickt</b> — was danach im Kopf des Panels steht:
<ul>${followed.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>
Dass »Baronie Raulsmark« die „Baronie Kaiserlich Raulsmark“ öffnet, ist der Beleg, dass über den Wiki-Key
zugeordnet wird und nicht über den Namen.</p>

<p class="note"><b>Die Lore erschien nicht, als dieses Blatt entstand.</b> Seit WI-0091 gibt es den Lesepfad: vier Zeilen in der
Datentabelle (Waren, Fauna, Flora, Spezies) und die Sektion <i>/lore</i>, verzögert geholt. Gemessen und vorgelegt wird sie auf
ihrem eigenen Blatt (<i>npm run review:vorkommen</i>).</p>

<p class="note"><b>Leere Abschnitte bleiben unsichtbar.</b> Ein Ort ohne Katalogdaten (Alfenmohn) liefert
<i>counts = { sources: 1 }</i> — ohne Schlüssel für Literatur, Karten und Bewertungen. Es steht nie „(0)“ im Panel.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1044, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__detailzugblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__detailzugblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
