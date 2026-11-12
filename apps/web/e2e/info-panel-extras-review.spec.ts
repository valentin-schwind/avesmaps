import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt „wie Legacy“ gegen „mit allen Zusatzfeldern“ (WI-0063 P6, 27.8; Betreiber 2026-10-04: „B aber ich muss später sehen
 * wieviel das ist“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Wie viel die Zusatzfelder je Subject-Art sind und welche davon das Panel zeigen soll, entscheidet ein
 * Mensch am Bild. Der Lauf legt je Subject EIN Paar vor, links Legacys Anzeige (die Vorgabe), rechts dieselbe Antwort des Servers mit
 * allen Zusatzfeldern, und darunter eine Zeile, was rechts dazukommt. Die Freigabe ist danach EINE Liste
 * (`PANEL_APPROVED_EXTRAS` in `packages/shared/src/subject-display.ts`), kein Umbau.
 *
 * 🔴 Die rechte Fassung kommt vom Entwicklerschalter `globalThis.__avesmapsPanelExtras = "all"` (`panel-extras.ts`), den es nur im
 * Entwicklungsmodus gibt; ein Wächter hält ihn aus der Produktion heraus.
 *
 * 🪤 Die Bilder sind Bildschirmfotos des gebauten Panels am Rechner (1280 px Breite, helles Thema). Das Panel ist 900 px hoch und scrollt;
 * für das Blatt wird das Fenster so hoch gezogen, dass das ganze Panel ohne Scrollen steht - sonst fehlte unten, was die Zusatzfelder
 * ausmachen.
 *
 *   npm run review:panel-extras
 *
 * Ablage: `review/wi-0063/zusatzfelder/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0063/zusatzfelder");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as {
    colour: Record<string, string>;
};

interface Subject {
    id: string;
    title: string;
    kind: string;
    ref: Record<string, unknown>;
}

const SUBJECTS: readonly Subject[] = [
    {
        id: "gareth",
        title: "Gareth",
        kind: "Ort mit Wiki - der reiche Referenzfall",
        ref: { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" },
    },
    {
        id: "alanfa",
        title: "Al'Anfa",
        kind: "Ort mit Wiki und eigenen Feldern (sie wiederholen hier den Wert des Wikis und fallen deshalb weg)",
        ref: { kind: "place", id: "ee76f9c9-cc19-5668-9c2d-f69cb8545d1b" },
    },
    {
        id: "efferding",
        title: "Efferding",
        kind: "Dorf ohne Wiki, mit eigenen Feldern (Einwohner, Oberhaupt) - was Legacy nirgends zeigt",
        ref: { kind: "place", id: "88b35c0b-3ffb-4bc9-b787-0d558789e4c2" },
    },
    {
        id: "firunswall",
        title: "Firunswall",
        kind: "Landschaft mit Nachbarn und Synonymen",
        ref: { kind: "area", id: "cff99ebb-b249-4d70-9ae2-467f59540b4a" },
    },
    {
        id: "arteria",
        title: "Arteria Magica",
        kind: "Kraftlinie mit Verlauf",
        ref: { kind: "powerline", anchor: "669f9371-dfcd-4a05-bdd9-38de68a79ad8" },
    },
    {
        id: "grosser-fluss",
        title: "Der Große Fluss",
        kind: "Weg mit langer Beschreibung",
        ref: { kind: "path", chain: "Der Große Fluss:Flussweg" },
    },
];

type Mode = "legacy" | "all";

interface Facts {
    subtitle: string;
    rows: [string, string][];
    stairs: string;
    stairRows: number;
    lids: string[];
}

interface Shot {
    png: Buffer;
    facts: Facts;
}

/** Ein Subject im Panel, als Bild und als Liste dessen, was es zeigt. */
async function capture(browser: Browser, baseURL: string, mode: Mode, subject: Subject): Promise<Shot> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        colorScheme: "light",
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    // Besucher sehen seit 2026-10-04 die Freigabe; beide Spalten des Blatts schaltet der Entwicklerschalter ausdrücklich.
    await context.addInitScript((wish) => {
        (globalThis as { __avesmapsPanelExtras?: string }).__avesmapsPanelExtras = wish;
    }, mode);
    const page: Page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), subject.ref);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-header-image").waitFor({ timeout: 30_000 });
    // Die Fahrt des Panels (0,22 s) und das Laden des Bildes abwarten.
    await page.waitForFunction(
        () => {
            const panel = document.querySelector('[data-testid="info-panel"]');
            const image = document.querySelector<HTMLImageElement>('[data-testid="info-header-image"]');
            return (
                panel !== null && Math.round(panel.getBoundingClientRect().x) === 880 && (image?.naturalWidth ?? 0) > 0
            );
        },
        undefined,
        { timeout: 30_000 },
    );
    // Das Fenster so hoch, dass das ganze Panel ohne Scrollen steht.
    const content = await page
        .locator(".info-content")
        .evaluate((element) => Math.ceil(element.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1280, height: Math.max(900, content + 24) });
    await page.waitForFunction(
        () => {
            const body = document.querySelector(".info-panel__body");
            return body !== null && body.scrollHeight <= body.clientHeight + 1;
        },
        undefined,
        { timeout: 10_000 },
    );
    // Fürs Blatt eckig: Die abgerundete Ecke unten links ließe ein paar Bildpunkte der Karte dahinter durchscheinen.
    await page.addStyleTag({
        content: ".info-panel__stack { border-radius: 0 !important; box-shadow: none !important; }",
    });
    await page.waitForTimeout(400);
    const png = await page.locator(".info-panel__stack").screenshot();
    const facts = await page.evaluate((): Facts => {
        const text = (element: Element | null): string => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
        const rows = [...document.querySelectorAll('[data-testid="info-fact"]')].map((row): [string, string] => [
            text(row.querySelector("dt")),
            text(row.querySelector("dd")),
        ]);
        const lies = document.querySelector('[data-testid="info-lies-in"]');
        return {
            subtitle: text(document.querySelector('[data-testid="info-subtitle"]')),
            rows,
            stairs: text(lies?.querySelector("h3") ?? null),
            stairRows: lies?.querySelectorAll('[data-testid="info-stairs-row"]').length ?? 0,
            lids: [...document.querySelectorAll('[data-testid="info-lid"]')].map((lid) =>
                text(lid.querySelector("button")),
            ),
        };
    });
    await context.close();
    return { png, facts };
}

/** Was rechts dazukommt, als eine Zeile: neue Zeilen, längere Werte, ein Mehr an „Liegt in“ und im Untertitel. */
function extras(legacy: Facts, all: Facts): string[] {
    const known = new Map(legacy.rows);
    const out: string[] = [];
    const added = all.rows.filter(([label]) => !known.has(label)).map(([label]) => label);
    if (added.length > 0) out.push(`Zeilen: ${added.join(", ")}`);
    for (const [label, value] of all.rows) {
        const before = known.get(label);
        if (before !== undefined && before !== value) {
            out.push(`${label}: ${String(value.length)} statt ${String(before.length)} Zeichen`);
        }
    }
    if (all.stairRows !== legacy.stairRows || all.stairs !== legacy.stairs) {
        out.push(
            legacy.stairRows === 0
                ? `„${all.stairs}“: ${String(all.stairRows)} Gebiete`
                : `„${all.stairs}“: ${String(all.stairRows)} statt ${String(legacy.stairRows)} Zeilen`,
        );
    }
    if (all.subtitle !== legacy.subtitle) out.push(`Untertitel: „${all.subtitle}“`);
    return out;
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt: Infopanel wie Legacy gegen mit allen Zusatzfeldern", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const pairs: { subject: Subject; legacy: Shot; all: Shot }[] = [];
    for (const subject of SUBJECTS) {
        const legacy = await capture(browser, baseURL, "legacy", subject);
        const all = await capture(browser, baseURL, "all", subject);
        pairs.push({ subject, legacy, all });
        testInfo.annotations.push({ type: "Blatt", description: `${subject.title} aufgenommen` });
    }

    const colour = CANON.colour;
    const image = (shot: Shot): string => `<img src="data:image/png;base64,${shot.png.toString("base64")}" alt="">`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 868px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 18px; color: ${colour["textMuted"]}; font-size: 13px; }
.heads, .pair { display: grid; grid-template-columns: 400px 400px; gap: 36px; }
.heads { position: sticky; top: 0; padding: 8px 0; background: ${colour["pageBg"]}; border-bottom: 1px solid ${colour["border"]}; font-size: 16px; color: ${colour["textStrong"]}; }
section { margin-top: 26px; }
h2 { margin: 0 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
img { display: block; width: 400px; }
.extra { margin: 10px 0 0; padding: 8px 12px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.extra b { font-weight: 400; color: ${colour["accentStrong"]}; }
.none { color: ${colour["textMuted"]}; }
</style></head><body>
<h1>Infopanel: wie Legacy gegen mit allen Zusatzfeldern</h1>
<p class="lead">WI-0063 P6 · Desktop, helles Thema · links Legacys Anzeige (die Vorgabe), rechts dieselbe Antwort des Servers mit allen Zusatzfeldern und der vollen Beschreibung (nur im Entwicklungsmodus). Das Panel ist hier ohne Scrollen gezeigt.</p>
<div class="heads"><div>wie Legacy (Vorgabe)</div><div>mit allen Zusatzfeldern</div></div>
${pairs
    .map(({ subject, legacy, all }) => {
        const more = extras(legacy.facts, all.facts);
        return `<section><h2>${escape(subject.title)} <span>· ${escape(subject.kind)}</span></h2>
<div class="pair">${image(legacy)}${image(all)}</div>
<p class="extra">${
            more.length === 0
                ? '<span class="none">Rechts kommt nichts dazu: alle Felder, die der Server liefert, stehen schon links.</span>'
                : `<b>Rechts zusätzlich:</b> ${escape(more.join(" · "))}`
        }</p></section>`;
    })
    .join("\n")}
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({
        baseURL,
        viewport: { width: 936, height: 1000 },
        deviceScaleFactor: 1,
    });
    const sheet = await sheetContext.newPage();
    // Das Blatt wird vom Ursprung der Entwicklungsseite ausgeliefert, damit die Hausschrift laden darf.
    await sheet.route("**/__abnahmeblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__abnahmeblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
