import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Locator, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt „Kartensammlung und Literatur als Fenster: der vergrößerte Eintrag“ (WI-0118, Betreiber 2026-10-09: „ein Klick auf eine Karte
 * oder eine Literatur soll immer den jeweiligen Eintrag im Verzeichnis vergrößert darstellen. Größer als das aktuell bei legacy stattfindet“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in `test/catalog-window-model.test.ts`
 * (Filter, Sortierung, Angaben, ohne Browser), `e2e/catalog-windows.spec.ts` und `e2e/catalog-windows.touch.spec.ts` (am echten Stack).
 *
 * Das Blatt zeigt auf der ECHTEN Karte, am Rechner hell in echter Größe (1280 × 900): (a) Kartensammlung von Gareth, „Gareth-Karte aus der Gareth-Box“
 * vergrößert, (b) Kartensammlung von Rhôndur mit dem Vollbild, (c) Literatur zu Gareth mit einem Werk samt Umschlag, (d) die Knöpfe unter den
 * Streifen im Panel - dazu das Fenster klein im dunklen Thema und am Telefon. Alles kommt aus dem Bestand, nichts ist gestellt.
 *
 *   npm run review:katalogfenster
 *
 * Ablage: `review/wi-0118/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0118");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const RHONDUR = { kind: "place", id: "59e6983c-536d-5ecd-b070-8f30ead6468d" };
const BOX = "Gareth-Karte aus der Gareth-Box";
const WERK = "Tal der Finsternis";

type Section = "citymaps" | "literature";

interface Opened {
    page: Page;
    panel: Locator;
    close: () => Promise<void>;
}

async function start(
    browser: Browser,
    baseURL: string,
    options: { scheme?: "light" | "dark"; width?: number; height?: number; scale?: number },
    ref: Record<string, unknown>,
    section: Section,
): Promise<Opened> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: options.width ?? 1280, height: options.height ?? 900 },
        colorScheme: options.scheme ?? "light",
        deviceScaleFactor: options.scale ?? 1,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    const panel = page.locator(`[data-section="${section}"]`);
    await panel.getByTestId(section === "citymaps" ? "info-action-citymapsAll" : "info-action-literatureAll").waitFor({
        timeout: 30_000,
    });
    await panel.scrollIntoViewIfNeeded();
    // 🪤 `loading="lazy"` lädt nur, was im Blick liegt.
    await page.waitForTimeout(900);
    return { page, panel, close: () => context.close() };
}

/** Klickt die Kachel im Streifen: Das Fenster geht bei diesem Eintrag auf, vergrößert. */
async function openAtTile(opened: Opened, section: Section, title: string): Promise<Locator> {
    const { page, panel } = opened;
    const card = panel
        .getByTestId(section === "citymaps" ? "info-citymaps-card" : "info-literature-card")
        .filter({ hasText: title })
        .first();
    await card.scrollIntoViewIfNeeded();
    await card.locator("button").first().click();
    const window = page.getByTestId(section === "citymaps" ? "citymaps-window" : "literature-window");
    await window.waitFor({ timeout: 15_000 });
    const open = window.locator('[data-testid="catalog-row"][data-open]');
    await open.waitFor({ timeout: 30_000 });
    // Das große Bild ist da, wenn es eines gibt.
    await page
        .waitForFunction(
            () => {
                const image = document.querySelector<HTMLImageElement>('[data-testid="catalog-entry-image"]');
                return image === null || (image.complete && image.naturalWidth > 0);
            },
            undefined,
            { timeout: 30_000 },
        )
        .catch(() => undefined);
    await page.waitForTimeout(900);
    return window;
}

/** Rollt den Streifen eines Abschnitts zur ersten Karte mit Bild, die nicht verdeckt ist - sonst zeigt das Blatt nur leere Flächen. */
async function showFirstImage(page: Page, section: Section): Promise<void> {
    await page.evaluate((name) => {
        const strip = document.querySelector<HTMLElement>(
            `[data-section="${name}"] [data-testid="${name === "citymaps" ? "info-citymaps-strip" : "info-literature-strip"}"]`,
        );
        if (strip === null) return;
        const cards = [...strip.children].filter(
            (card) => card.querySelector("img") !== null && !card.classList.contains("is-veiled"),
        ) as HTMLElement[];
        const first = cards[0];
        if (first !== undefined) strip.scrollLeft = Math.max(0, first.offsetLeft - strip.offsetLeft);
    }, section);
    await page.waitForTimeout(900);
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;
const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt: Kartensammlung und Literatur als Fenster, der vergrößerte Eintrag", async ({
    browser,
}, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, { png: Buffer; note: string }> = {};

    // (a) Kartensammlung von Gareth, die Gareth-Box vergrößert: der ganze Schirm, und die Nahaufnahme (doppelte Dichte) daneben.
    {
        const opened = await start(browser, baseURL, {}, GARETH, "citymaps");
        const window = await openAtTile(opened, "citymaps", BOX);
        const image = window.getByTestId("catalog-entry-image");
        const size = await image.evaluate((element) => {
            const picture = element as HTMLImageElement;
            const box = picture.getBoundingClientRect();
            return `${String(Math.round(box.width))} × ${String(Math.round(box.height))} px gezeigt, Datei ${String(picture.naturalWidth)} × ${String(picture.naturalHeight)} px`;
        });
        shots["a"] = { png: await opened.page.screenshot(), note: size };
        await opened.close();
        const close = await start(browser, baseURL, { scale: 2 }, GARETH, "citymaps");
        const w2 = await openAtTile(close, "citymaps", BOX);
        const row = w2.locator('[data-testid="catalog-row"][data-open]');
        const box = (await row.boundingBox())!;
        shots["a-nah"] = {
            png: await close.page.screenshot({
                clip: { x: box.x, y: box.y, width: Math.min(box.width, 560), height: Math.min(box.height, 440) },
            }),
            note: "doppelte Dichte, linke Hälfte des Eintrags",
        };
        await close.close();
    }

    // (b) Rhôndur: das Vollbild.
    {
        const opened = await start(browser, baseURL, {}, RHONDUR, "citymaps");
        const window = await openAtTile(opened, "citymaps", "Rhôndur");
        const size = await window.getByTestId("catalog-entry-image").evaluate((element) => {
            const picture = element as HTMLImageElement;
            const box = picture.getBoundingClientRect();
            return `Vollbild ${String(Math.round(box.width))} × ${String(Math.round(box.height))} px gezeigt, Datei ${String(picture.naturalWidth)} × ${String(picture.naturalHeight)} px`;
        });
        shots["b"] = { png: await opened.page.screenshot(), note: size };
        await opened.close();
    }

    // (c) Literatur zu Gareth, ein Werk mit Umschlag.
    {
        const opened = await start(browser, baseURL, {}, GARETH, "literature");
        const window = await openAtTile(opened, "literature", WERK);
        const size = await window.getByTestId("catalog-entry-image").evaluate((element) => {
            const picture = element as HTMLImageElement;
            const box = picture.getBoundingClientRect();
            return `Umschlag ${String(Math.round(box.width))} × ${String(Math.round(box.height))} px gezeigt, Datei ${String(picture.naturalWidth)} × ${String(picture.naturalHeight)} px`;
        });
        shots["c"] = { png: await opened.page.screenshot(), note: size };
        await opened.close();
    }

    // (d) Die Knöpfe unter den Streifen im Panel: echte Größe und - die Knöpfe allein - in doppelter Dichte.
    {
        const maps = await start(browser, baseURL, {}, GARETH, "citymaps");
        await showFirstImage(maps.page, "citymaps");
        shots["d-karten"] = { png: await maps.panel.screenshot(), note: "Kartensammlung von Gareth" };
        const lit = maps.page.locator('[data-section="literature"]');
        await lit.scrollIntoViewIfNeeded();
        await showFirstImage(maps.page, "literature");
        shots["d-literatur"] = { png: await lit.screenshot(), note: "Literatur zu Gareth" };
        await maps.close();
        const near = await start(browser, baseURL, { scale: 2 }, GARETH, "citymaps");
        await near.page.waitForTimeout(500);
        shots["d-nah"] = {
            png: await near.panel.getByTestId("info-catalog-actions").screenshot(),
            note: "doppelte Dichte: „Karte vorschlagen“ gesperrt, die Erklärung als Zeile darunter",
        };
        await near.close();
    }

    // Dunkel (klein) und am Telefon.
    {
        const dark = await start(browser, baseURL, { scheme: "dark" }, GARETH, "literature");
        await openAtTile(dark, "literature", WERK);
        shots["dunkel"] = { png: await dark.page.screenshot(), note: "Literatur zu Gareth, dunkles Thema" };
        await dark.close();
        const phone = await start(browser, baseURL, { width: 360, height: 760 }, GARETH, "citymaps");
        await openAtTile(phone, "citymaps", BOX);
        shots["telefon"] = { png: await phone.page.screenshot(), note: "360 px breit" };
        await phone.close();
    }

    const colour = CANON.colour;
    const img = (key: string, width?: number): string =>
        `<img src="${png((shots[key] as { png: Buffer }).png)}" alt=""${width === undefined ? "" : ` style="width:${String(width)}px"`}>`;
    const note = (key: string): string => escape((shots[key] as { note: string }).note);
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1280px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 30px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; gap: 24px; align-items: flex-start; }
.row > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Kartensammlung und Literatur als Fenster: der vergrößerte Eintrag</h1>
<p class="lead">WI-0118 · alles aus dem Bestand, auf der echten Karte · Rechner hell in echter Größe (1280 × 900), danach die Knöpfe im Panel, dunkel klein und das Telefon.
Ein Klick auf eine Kachel im Streifen öffnet das Fenster bei <i>diesem</i> Eintrag - Legacy zeigte 248 × 174 px.</p>

<h2>(a) Kartensammlung von Gareth <span>· Klick auf „${escape(BOX)}“ · ${note("a")}</span></h2>
${img("a")}
<div class="row" style="margin-top:14px"><div><p>Nahaufnahme · ${note("a-nah")}</p>${img("a-nah", 560)}</div></div>

<h2>(b) Kartensammlung von Rhôndur <span>· ein Klick auf die Kachel · ${note("b")}</span></h2>
${img("b")}

<h2>(c) Literatur zu Gareth <span>· Klick auf „${escape(WERK)}“ · ${note("c")}</span></h2>
${img("c")}

<h2>(d) Die Knöpfe unter den Streifen im Panel <span>· „Kartensammlung anzeigen“, „Karte vorschlagen“ (gesperrt), „Literatur anzeigen“</span></h2>
<div class="row">
<div><p>${note("d-karten")}</p>${img("d-karten")}</div>
<div><p>${note("d-literatur")}</p>${img("d-literatur")}</div>
<div><p>${note("d-nah")}</p>${img("d-nah", 400)}</div>
</div>

<h2>Dunkel (klein) und am Telefon</h2>
<div class="row">
<div><p>${note("dunkel")}</p>${img("dunkel", 760)}</div>
<div><p>${note("telefon")}</p>${img("telefon")}</div>
</div>

<p class="note"><b>Worauf zu achten ist:</b> Der Eintrag ist eine Karte in der Liste - Bild links in seiner eigenen Größe (nie hochskaliert, die Vorschau ist höchstens
400 px breit, der Umschlag 600 px hoch), daneben ALLE Angaben, die wir haben, darunter die Fundstellen, jede mit ↗ und „(kostenpflichtig)“ nur bei einem bekannten Ja.
Rhôndur zeigt das Vollbild über die ganze Breite; ein Klick darauf öffnet die Datei in voller Größe im neuen Tab. Filter stehen nur, wo sie die Liste teilen -
Rhôndur hat eine Karte und darum keine Leiste. „Karte vorschlagen“ und „+ Neuer Fundort“ sind gesperrt, bis es den Editor gibt.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__katalogfenster.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__katalogfenster.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
