import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Blatt „Der Zettel ‚Was ist hier?‘ wird um vier Zeilen länger“ (WI-0110).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit der Betreiber die FORM an der einen Stelle entscheidet, an der
 * der Zettel durch die vier Zeilen kippt. Geprüft wird in `apps/server/test/lore-panel.test.ts`,
 * `apps/web/test/panel-model.test.ts` und `apps/web/e2e/info-panel-grammar.spec.ts`.
 *
 * 🔴 **Der Auftrag ist umgesetzt** (Nachfrage der Editoren, Betreiber 2026-10-08: „‚Was ist hier‘ -> Vorkommen anzeigen?
 * geht das?“): Die vier Zeilen stehen zwischen den Landschaften und der Klimazone - Legacys eigener Platz.
 * 🔴 **Offen ist nur die Form:** Der Zettel wächst um **144,00 px** (36 px je Zeile, viermal - dieselbe Zahl wie WI-0103).
 * An einer dünn besiedelten Stelle überschreitet er damit zum ersten Mal die Höhe des Panels und bekommt einen Rollbalken;
 * mitten in Aventurien hatte er ihn schon vorher. **Die Editoren haben nach dem INHALT gefragt, nicht nach der Form.**
 *
 *   npm run review:vorkommen-am-kartenpunkt
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Arbeitsbaums auf dem Port, den `PORT` nennt (Vite liest daraus das
 * Proxyziel), und eine Entwicklungsdatenbank, in der I24 und I25 gelaufen sind.
 *
 * 🪤 **Die Spalte „heute“ braucht einen ZWEITEN Stapel ohne diesen Lesepfad** (`VORHER_URL`). Fehlt sie oder antwortet sie
 * nicht, zeigt das Blatt nur die neue Spalte und sagt das dazu - ein erfundenes „vorher“ gibt es nicht. Eigene Ports:
 *   $env:PORT="3274"; $env:E2E_PORT="5274"; $env:VORHER_URL="http://localhost:5275"; npm run review:vorkommen-am-kartenpunkt
 *
 * Ablage: `review/wi-0110/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0110");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Die Adresse des alten Stands; ohne sie bleibt die linke Spalte leer. */
const VORHER = process.env["VORHER_URL"] ?? "";

/**
 * 🔴 **DIE EINE Stelle, um die es geht** - gemessen, nicht gewählt: An den drei vermessenen Punkten (mitten in Aventurien,
 * dünn besiedelt, auf dem Meer) ist dies der einzige, bei dem die vier Zeilen den Zettel über die Höhe des Panels heben
 * (791,41 → 935,41 px bei 878 px Panel). Mitten in Aventurien rollte er schon vorher, auf dem Meer rollt er auch jetzt nicht.
 */
const STELLE = { kind: "mapPoint", x: 500, y: 900 } as const;

type Scheme = "light" | "dark";

interface Shot {
    png: Buffer;
    measured: string;
}

async function openPoint(browser: Browser, baseURL: string, scheme: Scheme): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), STELLE);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-facts").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    return page;
}

/** Was der Zettel an dieser Stelle misst: Tabelle, ganzer Inhalt, Rollbalken, und welche Zeilen dastehen. */
async function measure(page: Page): Promise<string> {
    return page.evaluate(() => {
        const round = (value: number): string => value.toFixed(2);
        const facts = document.querySelector('[data-testid="info-facts"]');
        const content = document.querySelector(".info-content");
        const body = document.querySelector(".info-panel__body");
        const labels = [...document.querySelectorAll('[data-testid="info-fact-label"]')].map((node) =>
            (node.textContent ?? "").trim(),
        );
        const rollt = body === null ? false : body.scrollHeight > body.clientHeight + 1;
        return [
            `Datentabelle ${facts === null ? "-" : round(facts.getBoundingClientRect().height)} px`,
            `ganzer Zettel ${content === null ? "-" : round(content.getBoundingClientRect().height)} px`,
            rollt ? "ROLLBALKEN" : "kein Rollbalken",
            labels.join(" · "),
        ].join(" · ");
    });
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Blatt: der Zettel „Was ist hier?“ mit vier Zeilen mehr", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const neu = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot | undefined> = {};
    const remember = (key: string, shot: Shot): void => {
        shots[key] = shot;
        testInfo.annotations.push({ type: "Blatt", description: `${key}: ${shot.measured}` });
    };

    /** Nahaufnahme der Feldliste - dort landen die vier Zeilen. */
    const table = async (stand: "vorher" | "nachher", scheme: Scheme): Promise<void> => {
        const baseURL = stand === "vorher" ? VORHER : neu;
        if (baseURL === "") return;
        const page = await openPoint(browser, baseURL, scheme);
        remember(`tabelle-${stand}-${scheme}`, {
            png: await page.getByTestId("info-facts").first().screenshot(),
            measured: await measure(page),
        });
        await page.context().close();
    };

    /** Der ganze Zettel in echter Größe - die Höhe, um die es geht. */
    const panel = async (stand: "vorher" | "nachher", scheme: Scheme): Promise<void> => {
        const baseURL = stand === "vorher" ? VORHER : neu;
        if (baseURL === "") return;
        const page = await openPoint(browser, baseURL, scheme);
        remember(`panel-${stand}-${scheme}`, {
            png: await page.getByTestId("info-panel").first().screenshot(),
            measured: await measure(page),
        });
        await page.context().close();
    };

    for (const stand of ["vorher", "nachher"] as const) {
        await table(stand, "light");
        await table(stand, "dark");
        await panel(stand, "light");
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
  <div class="col"><h3>heute (ohne Vorkommen)</h3>${cell(keyVorher)}</div>
  <div class="col"><h3>neu (mit den vier Zeilen)</h3>${cell(keyNachher)}</div>
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
<h1>„Was ist hier?“ zeigt jetzt die Vorkommen — und der Zettel wird 144 px länger</h1>
<p>Dieselbe Stelle (Kartenpunkt 500 / 900, Hochland der Firnklippen), 1280 × 900 px, Satz der Entwicklungsdatenbank.
Links der Stand von heute, rechts der neue.</p>

<div class="note"><b>Was gebaut ist.</b> Die Nachfrage der Editoren ist umgesetzt: Die vier Zeilen stehen zwischen den
Landschaften und der Klimazone — und das ist <b>Legacys eigener Platz</b>, kein geratener. Legacys
<code>map-features-what-is-here.js</code> baut die drei Landschaftszeilen, ruft dann <code>buildLoreMarkup</code> und erst
danach die Klimazone; sein eigener Prüffall schreibt dazu „🔴 ‚Klimazone‘ steht IMMER direkt unter Flora (Owner
2026-08-03)“. Ein Kartenpunkt hat wie ein Weg <b>nur „Aus der Region“ und den Link</b> — eine Koordinate kann keine eigenen
Einträge tragen.</div>

<div class="note frage"><b>🔴 Und das ist die Stelle, die du ansehen solltest.</b> „Was ist hier?“ ist ein kompakter Zettel.
Vier Zeilen mehr sind dort <b>+144,00 px</b> — und an einer dünn besiedelten Stelle hebt ihn das zum ersten Mal über die
Höhe des Panels: der Zettel bekommt einen <b>Rollbalken</b>, den er vorher nicht hatte. Mitten in Aventurien hatte er ihn
schon vorher, auf dem Meer bekommt er auch jetzt keinen.
<ul>
<li><b>A</b> — so lassen, wie rechts. Die Editoren haben den Inhalt gewollt.</li>
<li><b>B</b> — die vier Zeilen am Kartenpunkt wieder weglassen (Rücknahme ist eine Zeile).</li>
<li><b>C</b> — etwas anderes an der Form: eine eigene Klappstufe, kürzere Sätze, ein anderer Platz.</li>
</ul>
🪤 <b>Und das ist der unangenehme Teil des Befunds:</b> Ausgerechnet an dieser Stelle sagen alle vier Zeilen <b>0</b> — das
Hochland der Firnklippen trägt nichts. Der Zettel wächst dort also um 144 px, ohne etwas über die Stelle zu sagen; sein
ganzer Inhalt ist viermal der Link. <b>Mitten in Aventurien ist es umgekehrt</b> (10 Waren, 4 Tierarten, 8 Pflanzenarten,
1 Spezies), und dort rollte der Zettel schon vorher. Wie der Satz bei 0 lauten soll, liegt dir seit WI-0104 vor; diese
Antwort gilt dann für alle Träger zugleich.<br>
Ich habe nichts an Farbe, Form oder Wortlaut erfunden — alles kommt aus den vorhandenen Bauteilen.</div>

${pair("Die Feldliste · Nahaufnahme, hell", "die vier Zeilen stehen zwischen Vegetation und Klimazone", "tabelle-vorher-light", "tabelle-nachher-light")}
${pair("Dieselbe Feldliste, dunkel", "Nahaufnahme, 1280 px", "tabelle-vorher-dark", "tabelle-nachher-dark")}
${pair("Der ganze Zettel in echter Größe", "1280 × 900 px, hell — rechts beginnt er zu rollen", "panel-vorher-light", "panel-nachher-light")}

<p class="note"><b>Gemessen, drei Stellen, 25 HTTP-Läufe je Stelle</b> (eigener Fastify gegen den geteilten auf 3000).
<table>
<tr><th>Stelle</th><th>Antwortzeit Median</th><th>Antwortgröße</th><th>Feldliste</th><th>ganzer Zettel</th><th>Rollbalken</th></tr>
<tr><td>mitten in Aventurien (551,6 / 520,5)</td><td>13,9 → 20,8 ms</td><td>3.284 → 5.843 B</td><td>150,00 → 294,00 px</td><td>948,97 → 1.092,97 px</td><td>vorher schon</td></tr>
<tr><td>dünn besiedelt (500 / 900)</td><td>15,6 → 21,8 ms</td><td>1.743 → 2.280 B</td><td>177,00 → 321,00 px</td><td>791,41 → 935,41 px</td><td><b>NEU</b></td></tr>
<tr><td>auf dem Meer (120 / 450)</td><td>9,4 → 16,3 ms</td><td>766 → 3.195 B</td><td>66,00 → 210,00 px</td><td>626,41 → 770,41 px</td><td>nein</td></tr>
</table>
<ul>
<li><b>Zum Vergleich:</b> ein <b>Weg</b> kostet 16 bis 43 ms für die Sektion und bis 555 ms für sein Detail (WI-0103), eine
<b>Etappe</b> im Median 10,6 bis 11,8 ms (WI-0106). Ein Kartenpunkt kostet <b>5 bis 7 ms zusätzlich</b> — er ist der
günstigste Träger der Karte, weil seine Stelle genau der angeklickte Punkt ist.</li>
<li><b>Auf dem Meer wächst die Antwort am stärksten</b> (766 → 3.195 B): Das Meer der Sieben Winde trägt 23 Tierarten
(Aal, Blindfisch, Knurrhahn …) und den Ozeanier. Vorher stand dort nur die Topographie.</li>
<li><b>Die 0 steht auch hier:</b> „0 Handelswaren gelistet“ über „Überall in Aventurien (302)“ — derselbe Grenzfall, der
dir seit WI-0104 vorliegt. Dessen Antwort gilt dann für alle Träger zugleich; hier ist nichts eigens daran geändert.</li>
</ul></p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL: neu, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__kartenpunktblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__kartenpunktblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
