import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt „Die Urheberzeile unter den Buchumschlägen“ (WI-0063 §27.16, Betreiber 2026-10-06: „ja, bau die zeile ein! im zweifel
 * wie legacy“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/catalog-model.test.ts` (die Regel, ohne Browser) und `e2e/info-panel-credit.spec.ts` (die drei Fälle am echten Panel).
 *
 * 🔴 Beide Seiten der Regel stehen auf dem Blatt: Gareth trägt Umschläge und zeigt die Zeile; Sancta Boronia trägt VIER Werke und
 * keinen einzigen freigegebenen Umschlag - dort steht keine Zeile. Beide Orte kommen aus dem Bestand, nichts ist gestellt.
 *
 *   npm run review:urheberzeile
 *
 * Ablage: `review/wi-0063/urheberzeile/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0063/urheberzeile");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Gareth: 110 Werke, 69 mit Umschlag (MEDIA-M14). */
const MIT = { ref: { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" }, name: "Gareth" };
/** Sancta Boronia: vier Werke, kein einziger freigegebener Umschlag (gemessen am Bestand, 2026-10-06). */
const OHNE = { ref: { kind: "place", id: "edd7e6b6-9dc8-599a-9529-1ad8a665eb5a" }, name: "Sancta Boronia" };

type Scheme = "light" | "dark";

interface Shot {
    png: Buffer;
    /** Die echte Größe des aufgenommenen Kastens in CSS-Pixeln - damit das Blatt sie unverkleinert zeigen kann. */
    width: number;
    cards: number;
    withImage: number;
    /** Steht die Urheberzeile da? */
    credit: boolean;
}

async function capture(
    browser: Browser,
    baseURL: string,
    options: {
        place: typeof MIT;
        scheme: Scheme;
        width: number;
        /** Nur die Urheberzeile, scharf vergrößert - sonst der ganze Abschnitt. */
        closeUp?: boolean;
    },
): Promise<Shot> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: options.width, height: 960 },
        colorScheme: options.scheme,
        deviceScaleFactor: options.closeUp === true ? 3 : 1,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(150 + Math.floor(Math.random() * 40))}` },
    });
    const page: Page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), options.place.ref);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    const section = page.locator('[data-section="literature"]');
    await section.waitFor({ timeout: 30_000 });
    await page.getByTestId("info-literature-strip").waitFor({ timeout: 30_000 });
    await section.scrollIntoViewIfNeeded();
    // Der Streifen wird dorthin gerollt, wo das erste Bild steht - bei einem Ort ohne Umschläge bleibt er, wo er ist.
    await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-testid="info-literature-strip"]');
        if (root === null) return;
        const cards = [...root.querySelectorAll<HTMLElement>('[data-testid="info-literature-card"]')];
        const first = cards.find((item) => item.querySelector("img") !== null && !item.classList.contains("is-veiled"));
        if (first) root.scrollLeft = Math.max(0, first.offsetLeft - root.offsetLeft);
    });
    // 🪤 `loading="lazy"` lädt nur, was im Blick liegt; ein Ort ohne Bilder wartet auf nichts.
    await page.waitForFunction(
        () => {
            const root = document.querySelector('[data-testid="info-literature-strip"]');
            if (root === null) return false;
            const box = root.getBoundingClientRect();
            const visible = [...root.querySelectorAll("img")].filter((image) => {
                const at = image.getBoundingClientRect();
                return at.right > box.left && at.left < box.right;
            });
            return visible.every((image) => image.complete && image.naturalWidth > 0);
        },
        undefined,
        { timeout: 30_000 },
    );
    await page.waitForTimeout(400);
    const target = options.closeUp === true ? section.getByTestId("info-catalog-credit") : section;
    const png = await target.screenshot();
    const measured = await page.evaluate((closeUp) => {
        const root = document.querySelector('[data-testid="info-literature-strip"]');
        const cards = [...(root?.querySelectorAll('[data-testid="info-literature-card"]') ?? [])];
        const credit = document.querySelector('[data-section="literature"] [data-testid="info-catalog-credit"]');
        const box = (closeUp ? credit : document.querySelector('[data-section="literature"]'))?.getBoundingClientRect();
        return {
            width: Math.round(box?.width ?? 0),
            cards: cards.length,
            withImage: cards.filter((item) => item.querySelector("img")).length,
            credit: credit !== null,
        };
    }, options.closeUp === true);
    await context.close();
    return { png, ...measured };
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt: die Urheberzeile unter den Buchumschlägen", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot> = {};
    for (const scheme of ["light", "dark"] as const) {
        shots[`mit-${scheme}`] = await capture(browser, baseURL, { place: MIT, scheme, width: 1280 });
        shots[`ohne-${scheme}`] = await capture(browser, baseURL, { place: OHNE, scheme, width: 1280 });
        shots[`nah-${scheme}`] = await capture(browser, baseURL, {
            place: MIT,
            scheme,
            width: 1280,
            closeUp: true,
        });
        testInfo.annotations.push({ type: "Blatt", description: `${scheme} aufgenommen` });
    }
    shots["mit-phone"] = await capture(browser, baseURL, { place: MIT, scheme: "light", width: 360 });
    shots["ohne-phone"] = await capture(browser, baseURL, { place: OHNE, scheme: "light", width: 360 });

    const colour = CANON.colour;
    /** Echte Größe: der Kasten so breit, wie er im Browser war. `scale` vergrößert die Nahaufnahme. */
    const image = (key: string, scale = 1): string => {
        const shot = shots[key] as Shot;
        return `<img src="data:image/png;base64,${shot.png.toString("base64")}" alt="" style="width:${String(
            Math.round(shot.width * scale),
        )}px">`;
    };
    const says = (key: string): string => {
        const shot = shots[key] as Shot;
        return `${String(shot.withImage)} von ${String(shot.cards)} mit Umschlag · ${
            shot.credit ? "Zeile steht" : "keine Zeile"
        }`;
    };
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 940px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 26px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.pair { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
.pair > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Die Urheberzeile unter den Buchumschlägen</h1>
<p class="lead">WI-0063 §27.16 · Legacys Wortlaut, zweisprachig als Sprachschlüssel · echte Größe, links helles, rechts dunkles Thema.
Die Regel ist Legacys eigene: <i>keine Umschläge, keine Zeile.</i></p>

<h2>Gareth — mit Umschlägen <span>· ${escape(says("mit-light"))}</span></h2>
<div class="pair"><div><p>hell</p>${image("mit-light")}</div><div><p>dunkel</p>${image("mit-dark")}</div></div>

<h2>Die Zeile von nahe <span>· doppelte Größe, damit der Wortlaut lesbar ist</span></h2>
<div class="pair"><div><p>hell</p>${image("nah-light", 2)}</div><div><p>dunkel</p>${image("nah-dark", 2)}</div></div>

<h2>Sancta Boronia — ohne einen einzigen Umschlag <span>· ${escape(says("ohne-light"))}</span></h2>
<div class="pair"><div><p>hell</p>${image("ohne-light")}</div><div><p>dunkel</p>${image("ohne-dark")}</div></div>

<h2>Am Telefon <span>· 360 px breit, helles Thema</span></h2>
<div class="pair"><div><p>Gareth · ${escape(says("mit-phone"))}</p>${image("mit-phone")}</div><div><p>Sancta Boronia · ${escape(
        says("ohne-phone"),
    )}</p>${image("ohne-phone")}</div></div>

<p class="note"><b>Worauf zu achten ist:</b> Die Zeile steht leise unter dem Streifen, in der Farbe und der Größe der übrigen
Hinweiszeilen des Panels - keine neue Farbe, keine neue Sprosse. „im F-Shop ansehen ↗“ führt in einem neuen Fenster in den Laden.
Bei Sancta Boronia steht an derselben Stelle <b>nichts</b>: Eine Urheberzeile ohne Bilder wäre eine Aussage über nichts. Dieselbe
Bedingung gilt für die Kartensammlung - sie zeigt seit dem Widerruf keine Vorschauen und darum keine Zeile; stehen dort je wieder
Bilder, erscheint sie von selbst.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1004, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__urheberzeile.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__urheberzeile.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
