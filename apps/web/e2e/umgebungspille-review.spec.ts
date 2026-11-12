import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Umgebung im Kopf“ (Betreiber 2026-10-12: „kannst du oben zur unterscheidung … PRODUCTION · Live in einer
 * auffälligen schönen farbe hinschreiben“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild über die Farbe entscheidet. Die Prüfung steht
 * in `e2e/anmeldung.spec.ts` („auf Production: Pille PRODUCTION · Live in Grün“).
 *
 * Gezeigt wird die echte Kopfleiste über der echten Karte, je in Ruhe und in echter Größe: Stage und Production
 * nebeneinander, hell und dunkel. Production trägt dieselbe Form wie Stage — Pille links neben dem Titel, 2 px Kante unten —
 * und nur das andere Signal: das Erfolgs-Tripel statt des Warn-Tripels.
 *
 *   npm run review:umgebungspille
 *
 * Ablage: `review/umgebungspille/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/umgebungspille");

test.use({ actionTimeout: 30_000 });

const aufnahmen = new Map<string, Buffer>();

async function ruhe(page: Page): Promise<void> {
    await page.waitForTimeout(250);
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
}

async function kopf(browser: Browser, baseURL: string, umgebung: string, thema: "light" | "dark"): Promise<Buffer> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 720 },
        colorScheme: thema,
        // Wie in den übrigen Blättern: eine eigene Herkunft je Lauf, damit die Drossel vier Kontexte hintereinander erträgt.
        extraHTTPHeaders: { "x-forwarded-for": `10.77.5.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { environment: umgebung });
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("kopfleiste-umgebung").waitFor();
    await ruhe(page);
    // Der Kopf plus ein Streifen Karte darunter: Die Kante wirkt nur gegen das, was unter ihr liegt.
    const bild = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 96 } });
    await context.close();
    return bild;
}

test("Blatt: Stage und Production im Kopf, hell und dunkel", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    for (const thema of ["light", "dark"] as const)
        for (const umgebung of ["staging", "production"] as const)
            aufnahmen.set(`${umgebung}-${thema}`, await kopf(browser, baseURL!, umgebung, thema));

    mkdirSync(OUTPUT, { recursive: true });
    const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 1360, height: 720 } });
    const seite = await context.newPage();
    await seite.route("**/__blatt.html", (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html() }),
    );
    await seite.goto(`${baseURL!}/__blatt.html`);
    await seite.waitForLoadState("networkidle");
    await seite.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await context.close();
});

function bild(schluessel: string): string {
    return `data:image/png;base64,${aufnahmen.get(schluessel)!.toString("base64")}`;
}

function html(): string {
    const reihe = (titel: string, hinweis: string, schluessel: string): string => `
        <figure>
            <figcaption><b>${titel}</b> <span>${hinweis}</span></figcaption>
            <img src="${bild(schluessel)}" alt="${titel}" />
        </figure>`;
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><style>
    body { margin: 0; padding: 24px 40px 32px; background: #f4f1ea; font: 14px/1.5 system-ui, sans-serif; color: #2b2a26; }
    h1 { margin: 0 0 4px; font-size: 19px; }
    p.unter { margin: 0 0 20px; color: #6b655a; }
    figure { margin: 0 0 18px; }
    figcaption { margin: 0 0 6px; font-size: 13px; }
    figcaption span { color: #6b655a; }
    img { display: block; width: 1280px; border: 1px solid #d8d2c4; }
</style></head><body>
    <h1>Die Umgebung im Kopf</h1>
    <p class="unter">Dieselbe Form, ein anderes Signal: Pille links neben dem Titel, 2 px Kante unten. Echte Kopfleiste über der echten Karte, 1280 px.</p>
    ${reihe("STAGE · Testwelt", "wie bisher — Warn-Tripel, gelbe Kante", "staging-light")}
    ${reihe("PRODUCTION · Live", "neu — Erfolgs-Tripel, grüne Kante", "production-light")}
    ${reihe("STAGE · Testwelt", "dunkel", "staging-dark")}
    ${reihe("PRODUCTION · Live", "dunkel", "production-dark")}
</body></html>`;
}
