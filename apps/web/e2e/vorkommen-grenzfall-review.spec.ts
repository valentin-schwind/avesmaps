import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Blatt „Die Zahl im Satz zählt die Listen — und was dann bei 0 dasteht“ (WI-0104).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit der Betreiber den Grenzfall am Bild entscheidet. Geprüft wird in
 * `apps/server/test/lore-panel.test.ts`, `apps/web/test/lore-model.test.ts` und `apps/web/e2e/vorkommen-gruppen.spec.ts`.
 *
 * 🔴 **Der Auftrag ist umgesetzt** (Betreiber 2026-10-07: „kannst du ‚überall in aventurien‘ von der zahl im header von
 * vorkommen abziehen?“): `LORE_READING.countScope` steht auf `own`, der Satz zählt genau die Namen, die als Liste dastehen.
 * 🔴 **Offen ist nur der Grenzfall:** An einem Gegenstand, dessen Zeile NUR aus dem Link besteht, lautet der Satz damit
 * „0 Spezies verzeichnet“ über „Überall in Aventurien (44)“. **Wie er dort lauten soll, entscheidet der Betreiber.** Die
 * Zeile selbst bleibt stehen — sie steht seit dem 2026-10-07 überall, und das wird nicht still zurückgenommen.
 *
 *   npm run review:vorkommen-grenzfall
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Arbeitsbaums auf dem Port, den `PORT` nennt (Vite liest daraus das
 * Proxyziel), und eine Entwicklungsdatenbank, in der I24 und I25 gelaufen sind.
 *
 * 🪤 **Die Spalte „heute“ braucht einen ZWEITEN Stapel mit dem alten Stand** (`countScope: "all"`), seine Adresse steht in
 * `VORHER_URL`. Fehlt sie oder antwortet sie nicht, zeigt das Blatt nur die neue Spalte und sagt das dazu — ein erfundenes
 * „vorher“ gibt es nicht. Eigene Ports dieser Sitzung:
 *   $env:PORT="3280"; $env:E2E_PORT="5280"; $env:VORHER_URL="http://localhost:5281"; npm run review:vorkommen-grenzfall
 *
 * Ablage: `review/wi-0104/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0104");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Die Adresse des alten Stands; ohne sie bleibt die linke Spalte leer. */
const VORHER = process.env["VORHER_URL"] ?? "";

const SUBJECTS = {
    /** 🔴 Der Grenzfall: trägt nichts Eigenes und liegt in keiner tragenden Fläche - die Zeile ist nur der Link. */
    aumond: { kind: "place", id: "6f45f4eb-31b1-5cbc-a07e-f6ecfb8ef9b3" },
    /** Die Gegenprobe: ein Ort mit Eigenem UND Regionalem, dort ist die neue Zahl die Länge der Listen. */
    selem: { kind: "place", id: "ec477f34-a34a-578e-9887-05b751f091e4" },
    /** Die Landschaft mit genau EINER Gruppe aus vier Waren - sein zweites Beispiel in Kleinform. */
    dunkelwald: { kind: "area", id: "37794487-4f70-4423-ad61-7685ac3ad340" },
} as const;

type Name = keyof typeof SUBJECTS;
type Scheme = "light" | "dark";

interface Shot {
    png: Buffer;
    measured: string;
}

async function openPanel(browser: Browser, baseURL: string, who: Name, scheme: Scheme, width: number): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 1100 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), SUBJECTS[who]);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-facts").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    return page;
}

/** Klappt die Zeile einer Art auf und wartet auf ihren Inhalt - eine Gruppe ODER die Linkzeile. */
async function expand(page: Page, kind: string): Promise<void> {
    const row = page.locator(`[data-field="lore:${kind}"]`);
    await row.locator("button").first().click();
    await row
        .locator('[data-testid="info-lore-group"], [data-testid="info-lore-everywhere"]')
        .first()
        .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
}

/** Was eine aufgeklappte Zeile sagt: der Satz, die Gruppen mit ihrer Länge, der Link und die Höhe der Zeile. */
async function readRow(page: Page, kind: string): Promise<string> {
    return page.evaluate((loreKind) => {
        const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
        if (row === null) return "KEINE ZEILE";
        const parts: string[] = [];
        parts.push(`Satz: „${row.querySelector('[data-testid="info-lid-summary"]')?.textContent?.trim() ?? "?"}“`);
        for (const group of row.querySelectorAll<HTMLElement>('[data-testid="info-lore-group"]')) {
            const heading = group.querySelector('[data-testid="info-lore-heading"]')?.textContent?.trim() ?? "(ohne)";
            const count = group.querySelector('[data-testid="info-lore-count"]')?.textContent?.trim() ?? "?";
            parts.push(`${heading} ${count}`);
        }
        const link = row.querySelector('[data-testid="info-lore-everywhere"]')?.textContent?.trim();
        parts.push(link === undefined ? "kein Link" : link);
        return parts.join(" · ");
    }, kind);
}

/** Die vier Zählsätze eines Gegenstands, Zeile für Zeile. */
async function readRows(page: Page): Promise<string> {
    const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-field^="lore:"]')].map(
            (row) => row.querySelector('[data-testid="info-lid-summary"]')?.textContent?.trim() ?? "?",
        ),
    );
    return rows.length === 0 ? "keine Vorkommenszeile" : rows.join(" · ");
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Blatt: der Grenzfall der 0 im Zählsatz", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const neu = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot | undefined> = {};
    const remember = (key: string, shot: Shot): void => {
        shots[key] = shot;
        testInfo.annotations.push({ type: "Blatt", description: `${key}: ${shot.measured}` });
    };

    /** Nahaufnahme EINER aufgeklappten Zeile. */
    const row = async (stand: "vorher" | "nachher", who: Name, kind: string, scheme: Scheme): Promise<void> => {
        const baseURL = stand === "vorher" ? VORHER : neu;
        if (baseURL === "") return;
        const page = await openPanel(browser, baseURL, who, scheme, 1280);
        await expand(page, kind);
        const measured = await readRow(page, kind);
        const png = await page.locator(`[data-field="lore:${kind}"]`).screenshot();
        remember(`row-${stand}-${who}-${kind}-${scheme}`, { png, measured });
        await page.context().close();
    };

    /** Das ganze Panel in echter Größe - die Höhe, um die es beim leeren Dorf geht. */
    const panel = async (stand: "vorher" | "nachher", who: Name, scheme: Scheme): Promise<void> => {
        const baseURL = stand === "vorher" ? VORHER : neu;
        if (baseURL === "") return;
        const page = await openPanel(browser, baseURL, who, scheme, 1280);
        const tabelle = await page
            .getByTestId("info-facts")
            .evaluate((node) => node.getBoundingClientRect().height.toFixed(2));
        const measured = `Datentabelle ${tabelle} px · ${await readRows(page)}`;
        const png = await page.getByTestId("info-panel").first().screenshot();
        remember(`panel-${stand}-${who}-${scheme}`, { png, measured });
        await page.context().close();
    };

    for (const scheme of ["light", "dark"] as const) {
        for (const stand of ["vorher", "nachher"] as const) {
            await row(stand, "aumond", "fauna", scheme);
            await row(stand, "selem", "ware", scheme);
            await row(stand, "dunkelwald", "ware", scheme);
            await panel(stand, "aumond", scheme);
        }
    }

    const colour = CANON.colour;
    const cell = (key: string): string => {
        const shot = shots[key];
        if (shot === undefined) return `<div><p>nicht aufgenommen (kein Stapel mit dem alten Stand)</p></div>`;
        return `<div><p>${escape(shot.measured)}</p><img src="data:image/png;base64,${shot.png.toString("base64")}" alt=""></div>`;
    };
    const pair = (title: string, extra: string, keyVorher: string, keyNachher: string): string => `
<h2>${escape(title)} <span>· ${escape(extra)}</span></h2>
<div class="pair">
  <div class="col"><h3>heute (der Link zählt mit)</h3>${cell(keyVorher)}</div>
  <div class="col"><h3>neu (nur die Listen zählen)</h3>${cell(keyNachher)}</div>
</div>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${neu}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 8px; font-size: 16px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
h3 { margin: 0 0 6px; font-size: 13px; font-weight: 400; color: ${colour["textMuted"]}; }
p { margin: 0 0 6px; color: ${colour["textMuted"]}; font-size: 12px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
.pair img { display: block; max-width: 100%; border: 1px solid ${colour["divider"]}; border-radius: 8px; }
.note { margin: 14px 0 0; padding: 10px 12px; border: 1px solid ${colour["divider"]}; border-radius: 8px; color: ${colour["text"]}; font-size: 13px; }
.note b { color: ${colour["textStrong"]}; }
.frage { border-color: ${colour["link"]}; }
ul { margin: 6px 0 0; padding-left: 18px; }
table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
td, th { border: 1px solid ${colour["divider"]}; padding: 3px 8px; text-align: left; color: ${colour["text"]}; }
th { color: ${colour["textStrong"]}; font-weight: 400; }
</style></head><body>
<h1>„Überall in Aventurien“ von der Zahl im Satz abgezogen — und die 0, die dabei entsteht</h1>
<p>Satz der Entwicklungsdatenbank. Links der Stand von heute, rechts der neue — dieselbe Stelle, nur der Schalter
<code>countScope</code> ist umgelegt.</p>

<div class="note"><b>Was gebaut ist, Zeichen für Zeichen nach deinem Beispiel.</b> Der Satz zählt jetzt nur noch, was als
Liste dasteht: „4 Handelswaren gelistet“ über „Direkt von hier 2“ und „Aus der Region 2“, und die Zahl am Link bleibt
draußen. Das ist <b>eine Zeile</b> im Lesevertrag, keine Ausnahme daneben.</div>

<div class="note frage"><b>🔴 Und das ist die Stelle, die du entscheiden musst.</b> An einem Gegenstand, dessen Zeile NUR
aus dem Link besteht, ist die Liste leer — also sagt der Satz <b>0</b>. Unten links steht, was heute dasteht; unten rechts,
was daraus wird. <b>Die Zeile selbst bleibt</b>: Du hast am 7.10. entschieden, dass „Überall in Aventurien“ überall steht,
und eine Zeile, die wegen der 0 verschwindet, nähme das still zurück.
<ul>
<li><b>A</b> — die 0 stehen lassen, so wie rechts.</li>
<li><b>B</b> — den Zählsatz weglassen und nur die Art nennen.</li>
<li><b>C</b> — die Zahl des Links in den Satz nehmen, im Gruppenkopf aber nicht.</li>
</ul>
Einen Wortlaut habe ich nicht erfunden; sag, welcher Weg es sein soll, und wie der Satz dann heißt.</div>

${pair("🔴 Der Grenzfall · Aumond, Zeile Fauna", "Nahaufnahme, 1280 px, hell", "row-vorher-aumond-fauna-light", "row-nachher-aumond-fauna-light")}
${pair("🔴 Derselbe Grenzfall, dunkel", "Nahaufnahme, 1280 px", "row-vorher-aumond-fauna-dark", "row-nachher-aumond-fauna-dark")}
${pair("Aumond · das ganze Panel in echter Größe", "1280 px, hell — die Höhe der Datentabelle steht darüber", "panel-vorher-aumond-light", "panel-nachher-aumond-light")}

<div class="note"><b>Zum Vergleich der Normalfall, der jetzt stimmt.</b> Wo Listen dastehen, ist die Zahl im Satz ihre
Länge — vorher war sie um die 302 des Links zu hoch.</div>

${pair("Selem · Zeile Waren", "Nahaufnahme, 1280 px, hell", "row-vorher-selem-ware-light", "row-nachher-selem-ware-light")}
${pair("Dunkelwald · Zeile Waren", "dein zweites Beispiel in Kleinform: vier Waren, eine Gruppe", "row-vorher-dunkelwald-ware-light", "row-nachher-dunkelwald-ware-light")}

<p class="note"><b>Wen die 0 trifft</b> (gemessen über den ganzen Bestand, Entwicklungsdatenbank).
<table>
<tr><th>Gegenstandsart</th><th>Gegenstände</th><th>0 bei Waren</th><th>0 bei Fauna</th><th>0 bei Flora</th><th>0 bei Spezies</th><th>alle vier 0</th><th>mindestens eine 0</th></tr>
<tr><td>Orte</td><td>4.949</td><td>104</td><td>628</td><td>906</td><td>719</td><td>75</td><td>1.171</td></tr>
<tr><td>Landschaften</td><td>5.137</td><td>504</td><td>539</td><td>803</td><td>860</td><td>349</td><td>1.113</td></tr>
<tr><td>Politische Gebiete</td><td>1.676</td><td>692</td><td>750</td><td>786</td><td>789</td><td>686</td><td>842</td></tr>
<tr><td>Gipfel</td><td>207</td><td>16</td><td>20</td><td>44</td><td>28</td><td>14</td><td>44</td></tr>
<tr><td>Wege</td><td>1.265</td><td>7</td><td>156</td><td>184</td><td>134</td><td>2</td><td>245</td></tr>
<tr><th>zusammen</th><th>13.234</th><th>1.323</th><th>2.093</th><th>2.723</th><th>2.530</th><th>1.126</th><th>3.415</th></tr>
</table>
<ul>
<li><b>Die größere Menge ist nicht das leere Dorf, sondern die einzelne Art:</b> 1.126 Gegenstände bekommen in ALLEN vier
Zeilen eine 0 — aber <b>3.415</b> bekommen sie in mindestens einer. Rund jeder vierte Gegenstand der Karte zeigt also
irgendwo eine 0.</li>
<li>Am Linkziel selbst (Landschaft „Aventurien“) ändert sich nichts: dort gibt es keinen Link, und die Zahlen bleiben
304 / 383 / 445 / 44.</li>
</ul></p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL: neu, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__grenzfallblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__grenzfallblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
