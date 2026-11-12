import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt „Buchumschläge und Kartenvorschauen“ (WI-0063 MEDIA-M14): Was die Katalogabschnitte zeigen, seit der Lesepfad die
 * Rollen `literature_cover` und `map_preview` auflöst - hell und dunkel, am Rechner und am Telefon.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `subjects-p8.test.ts`, `media-resolver.test.ts` und `catalog-model.test.ts`.
 *
 * 🔴 Der Normalfall ist der GEMISCHTE Streifen: Am Bestand tragen 1.534 von 2.003 Werken einen freigegebenen Umschlag und 363 von 543
 * Karten eine Vorschau. Gareth zeigt beides nebeneinander - Karten mit Bild und Karten ohne. Wo keins ist, steht nichts: kein Rahmen,
 * keine Beschriftung, kein Alternativtext (MEDIA-M12). Nur die Fläche bleibt, damit die Titel auf einer Höhe beginnen.
 *
 *   npm run review:medien-anzeige
 *
 * Ablage: `review/wi-0063/medien-anzeige/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0063/medien-anzeige");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const GARETH_REF = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };

type Scheme = "light" | "dark";
type Section = "citymaps" | "literature";

interface Shot {
    png: Buffer;
    /** Was im Streifen steht: wie viele Kacheln, wie viele davon mit Bild. */
    cards: number;
    withImage: number;
}

/** Ein Abschnitt des Panels als Bild, dazu die gezählten Kacheln mit und ohne Bild. */
async function capture(
    browser: Browser,
    baseURL: string,
    options: { scheme: Scheme; section: Section; width: number },
): Promise<Shot> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: options.width, height: 960 },
        colorScheme: options.scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page: Page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH_REF);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    const section = page.locator(`[data-section="${options.section}"]`);
    await section.waitFor({ timeout: 30_000 });
    const strip = options.section === "literature" ? "info-literature-strip" : "info-citymaps-strip";
    await page.getByTestId(strip).waitFor({ timeout: 30_000 });
    await section.scrollIntoViewIfNeeded();
    // 🔴 Der Streifen wird dorthin gerollt, wo BEIDES steht: eine Kachel OHNE Bild unmittelbar vor einer offenen MIT Bild. Das ist der
    // Normalfall, den der Betreiber sehen soll - an Gareth stehen die Karten ohne Vorschau am Anfang, weil sie alphabetisch dort liegen.
    await page.evaluate(
        ({ name, card }) => {
            const root = document.querySelector<HTMLElement>(`[data-testid="${name}"]`);
            if (root === null) return;
            const cards = [...root.querySelectorAll<HTMLElement>(`[data-testid="${card}"]`)];
            const open = (item: HTMLElement): boolean => !item.classList.contains("is-veiled");
            const shown = (item: HTMLElement): boolean => item.querySelector("img") !== null && open(item);
            const boundary = cards.findIndex(
                (item, index) =>
                    index > 0 && shown(item) && (cards[index - 1] as HTMLElement).querySelector("img") === null,
            );
            const target = boundary > 0 ? boundary - 1 : Math.max(0, cards.findIndex(shown) - 1);
            const at = cards[target];
            if (at) root.scrollLeft = at.offsetLeft - root.offsetLeft;
        },
        { name: strip, card: options.section === "literature" ? "info-literature-card" : "info-citymaps-card" },
    );
    // 🪤 `loading="lazy"` lädt nur, was im Blick liegt: Gewartet wird auf die Bilder, die das Blatt auch zeigt.
    await page.waitForFunction(
        (name) => {
            const root = document.querySelector(`[data-testid="${name}"]`);
            if (root === null) return false;
            const box = root.getBoundingClientRect();
            const visible = [...root.querySelectorAll("img")].filter((image) => {
                const at = image.getBoundingClientRect();
                return at.right > box.left && at.left < box.right;
            });
            return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0);
        },
        strip,
        { timeout: 30_000 },
    );
    await page.waitForTimeout(400);
    const png = await section.screenshot();
    const counted = await page.evaluate(
        ({ name, card }) => {
            const root = document.querySelector(`[data-testid="${name}"]`);
            const cards = [...(root?.querySelectorAll(`[data-testid="${card}"]`) ?? [])];
            return { cards: cards.length, withImage: cards.filter((item) => item.querySelector("img")).length };
        },
        {
            name: strip,
            card: options.section === "literature" ? "info-literature-card" : "info-citymaps-card",
        },
    );
    await context.close();
    return { png, ...counted };
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt: Buchumschläge und Kartenvorschauen im Infopanel", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot> = {};
    for (const scheme of ["light", "dark"] as const) {
        for (const section of ["citymaps", "literature"] as const) {
            shots[`${section}-${scheme}`] = await capture(browser, baseURL, { scheme, section, width: 1280 });
            testInfo.annotations.push({ type: "Blatt", description: `${section} ${scheme} aufgenommen` });
        }
    }
    // Das Telefon: dieselben Streifen in einem 360 px breiten Fenster.
    shots["literature-phone"] = await capture(browser, baseURL, {
        scheme: "light",
        section: "literature",
        width: 360,
    });
    shots["citymaps-phone"] = await capture(browser, baseURL, { scheme: "light", section: "citymaps", width: 360 });

    const colour = CANON.colour;
    const image = (key: string): string =>
        `<img src="data:image/png;base64,${(shots[key] as Shot).png.toString("base64")}" alt="">`;
    const count = (key: string): string => {
        const shot = shots[key] as Shot;
        return `${String(shot.withImage)} von ${String(shot.cards)} mit Bild`;
    };
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 940px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 24px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.pair { display: grid; grid-template-columns: 440px 440px; gap: 24px; align-items: start; }
.pair > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
.phone { display: grid; grid-template-columns: 340px 340px; gap: 24px; align-items: start; }
img { display: block; width: 100%; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.phone img { width: 340px; }
.note { margin: 18px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Buchumschläge und Kartenvorschauen im Infopanel</h1>
<p class="lead">WI-0063 MEDIA-M14 · Gareth · oben die Kartensammlung, darunter die Literatur · links helles, rechts dunkles Thema. Der Lesepfad des Media Cores löst jetzt auch die Rollen <i>literature_cover</i> und <i>map_preview</i> auf.</p>

<h2>Kartensammlung von Gareth <span>· ${escape(count("citymaps-light"))}</span></h2>
<div class="pair"><div><p>hell</p>${image("citymaps-light")}</div><div><p>dunkel</p>${image("citymaps-dark")}</div></div>

<h2>Literatur zu Gareth <span>· ${escape(count("literature-light"))}</span></h2>
<div class="pair"><div><p>hell</p>${image("literature-light")}</div><div><p>dunkel</p>${image("literature-dark")}</div></div>

<h2>Am Telefon <span>· 360 px breit, helles Thema</span></h2>
<div class="phone"><div><p>Kartensammlung</p>${image("citymaps-phone")}</div><div><p>Literatur</p>${image("literature-phone")}</div></div>

<p class="note"><b>Zu sehen ist der Normalfall:</b> Manche Werke und Karten haben ein Bild, andere nicht. Wo keins ist, steht nichts -
kein Rahmen, keine Beschriftung, kein Alternativtext; nur die Fläche bleibt, damit die Titel auf einer Höhe beginnen. Ein verdecktes
Werk behält seinen Deckel: Das Bild liegt darunter, weichgezeichnet.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1004, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__medienblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__medienblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
