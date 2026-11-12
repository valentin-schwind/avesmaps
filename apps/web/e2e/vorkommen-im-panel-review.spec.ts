import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Blatt „Die Vorkommen: zwei Listen und ein Link“ (WI-0091 Nachtrag 2).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit der Betreiber am Bild sieht, was aus seinem Satz vom
 * 2026-10-06 geworden ist, und schreibt die gemessenen Zahlen unter jedes Bild. Geprüft wird in
 * `apps/server/test/lore-panel.test.ts`, `apps/web/test/lore-model.test.ts` und `apps/web/e2e/vorkommen-deckel.spec.ts`.
 *
 * 🔴 **Es ersetzt das alte A/B-Blatt.** Die Gegenüberstellung „zählt der Satz nur das Ortseigene (A) oder alles (B)“ ist
 * gegenstandslos geworden: „Überall in Aventurien“ ist jetzt ein LINK, keine Liste, und was ein Link ist, steht nicht als
 * Liste da. Der Satz zählt damit zwingend „Direkt von hier“ plus „Aus der Region“.
 *
 * 🔴 **Nachtrag 3 (2026-10-07):** Der Deckel über „Aus der Region“ ist am Bild abgelehnt worden („nein ‚Aus der Region‘
 * brauch keine eigene klappbox“). Alle Gruppen stehen offen; was das bei vielen Namen kostet, zeigt der Extremfall.
 *
 * Gezeigt wird:
 * - **Selem**: die vier Zeilen zugeklappt; eine Zeile aufgeklappt mit beiden offenen Gruppen; das ganze Panel in echter
 *   Größe und am Telefon.
 * - **Drunidet**: der Extremfall - 110 Namen in EINER offenen Gruppe, der längste des Bestands.
 * - **Aumond**: der Fall „nur Kontinentweites“ - keine einzige Vorkommenszeile.
 * - **Aventurien**: das Ziel des Links, wo dieselben Einträge „Direkt von hier“ sind.
 *
 *   npm run review:vorkommen
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt (Vite liest daraus das
 * Proxyziel), und eine Entwicklungsdatenbank, in der I24 und I25 gelaufen sind. Eigene Ports dieser Sitzung:
 *   $env:PORT="3289"; $env:E2E_PORT="4289"; npm run review:vorkommen
 *
 * 💣 **3261 ist vergeben und darf nicht als Serverport einer Sitzung dienen:** `apps/server/test/uploads-sync.test.ts`
 * bindet ihn fest für seinen eigenen lokalen Server (`FAKE_PORT`). Lauscht dort ein Fastify, wird diese Testdatei in JEDEM
 * Volllauf JEDER Sitzung rot (`EADDRINUSE`).
 *
 * Ablage: `review/wi-0091/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0091");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const SUBJECTS = {
    /** Der Ort mit allen vier Arten, mit Eigenem UND Regionalem. */
    selem: { kind: "place", id: "ec477f34-a34a-578e-9887-05b751f091e4" },
    /** 🔴 Der Extremfall: 110 Namen in EINER offenen Gruppe (Fauna), der längste des Bestands. */
    drunidet: { kind: "place", id: "9a04121d-6f4d-533e-9207-05738e16bdf0" },
    /**
     * Nichts Eigenes, nichts aus der Region. 🚩 **Seit WI-0103 (2026-10-07) bekommt er trotzdem alle vier Zeilen** -
     * sie tragen dann nur den Link (Betreiber: „und ‘Überall in Aventurien’ muss natürlich auch überall stehen“).
     * Dieses Blatt gehört zu WI-0091 und zeigt den Stand von damals; der Text unten sagt das dazu.
     */
    aumond: { kind: "place", id: "6f45f4eb-31b1-5cbc-a07e-f6ecfb8ef9b3" },
    /** Das Ziel des Links: dort sind die 1.174 kontinentweiten Einträge „Direkt von hier“. */
    aventurien: { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f846" },
} as const;

type Scheme = "light" | "dark";
type Name = keyof typeof SUBJECTS;

interface Shot {
    png: Buffer;
    /** Die Zeile unter dem Bild: was gezählt wurde. */
    measured: string;
}

/** Das Panel eines Gegenstands, geöffnet und fertig gezeichnet. */
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

/** Was die vier Zeilen sagen, Zeile für Zeile: Beschriftung und Zählsatz. */
async function readRows(page: Page): Promise<string> {
    const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-field^="lore:"]')].map((row) => {
            const label = row.querySelector('[data-testid="info-fact-label"]')?.textContent?.trim() ?? "?";
            const summary = row.querySelector('[data-testid="info-lid-summary"]')?.textContent?.trim() ?? "?";
            return `${label}: ${summary}`;
        }),
    );
    return rows.length === 0 ? "keine Vorkommenszeile" : rows.join(" · ");
}

/** Klappt die Zeile einer Art auf. Eine zweite Stufe gibt es nicht mehr (Betreiber 2026-10-07). */
async function expand(page: Page, kind: string): Promise<void> {
    const row = page.locator(`[data-field="lore:${kind}"]`);
    await row.locator("button").first().click();
    await row.getByTestId("info-lore-group").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
}

/** Was im aufgeklappten Inhalt steht: die offenen Gruppen mit ihrer Länge und die Linkzeile. */
async function readOpened(page: Page, kind: string): Promise<string> {
    return page.evaluate((loreKind) => {
        const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
        if (row === null) return "Zeile fehlt";
        const parts: string[] = [];
        for (const group of row.querySelectorAll<HTMLElement>('[data-testid="info-lore-group"]')) {
            const heading = group.querySelector('[data-testid="info-lore-heading"]')?.textContent?.trim() ?? "(ohne)";
            const text = group.querySelector('[data-testid="info-lore-names"]')?.textContent ?? "";
            parts.push(`${heading} ${String(text.trim() === "" ? 0 : text.split(",").length)}`);
        }
        const link = row.querySelector('[data-testid="info-lore-everywhere"]')?.textContent?.trim();
        parts.push(link === undefined ? "kein Link" : `Link: ${link}`);
        // Wie hoch die aufgeklappte Zeile wirklich ist - die Zahl, um die es beim Extremfall geht.
        parts.push(`${String(Math.round(row.getBoundingClientRect().height))} px hoch`);
        return parts.join(" · ");
    }, kind);
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Blatt: die Vorkommen - zwei Listen und ein Link", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot> = {};
    const remember = (key: string, shot: Shot): void => {
        shots[key] = shot;
        testInfo.annotations.push({ type: "Blatt", description: `${key}: ${shot.measured}` });
    };

    /** Nur der Streifen der Vorkommenszeilen, in echter Größe. */
    const rows = async (who: Name, scheme: Scheme): Promise<void> => {
        const page = await openPanel(browser, baseURL, who, scheme, 1280);
        const measured = await readRows(page);
        const first = page.locator('[data-field^="lore:"]').first();
        const last = page.locator('[data-field^="lore:"]').last();
        const box = await first.boundingBox();
        const end = await last.boundingBox();
        const png =
            box === null || end === null
                ? await page.getByTestId("info-facts").screenshot()
                : await page.screenshot({
                      clip: {
                          x: box.x - 12,
                          y: box.y - 8,
                          width: box.width + 24,
                          height: end.y + end.height - box.y + 16,
                      },
                  });
        remember(`rows-${who}-${scheme}`, { png, measured });
        await page.context().close();
    };

    /** Eine aufgeklappte Zeile mit allen ihren Gruppen. */
    const opened = async (who: Name, kind: string, scheme: Scheme): Promise<void> => {
        const page = await openPanel(browser, baseURL, who, scheme, 1280);
        await expand(page, kind);
        const measured = await readOpened(page, kind);
        const png = await page.locator(`[data-field="lore:${kind}"]`).screenshot();
        remember(`open-${who}-${kind}-${scheme}`, { png, measured });
        await page.context().close();
    };

    /** Das ganze Panel in echter Größe beziehungsweise am Telefon. */
    const panel = async (who: Name, scheme: Scheme, width: number, open: string | null): Promise<void> => {
        const page = await openPanel(browser, baseURL, who, scheme, width);
        if (open !== null) await expand(page, open);
        const measured = `${String(width)} px · ${await readRows(page)}`;
        const png = await page.getByTestId("info-panel").first().screenshot();
        remember(`panel-${who}-${String(width)}-${open ?? "zu"}-${scheme}`, { png, measured });
        await page.context().close();
    };

    for (const scheme of ["light", "dark"] as const) {
        await rows("selem", scheme);
        await opened("selem", "flora", scheme);
        await opened("drunidet", "fauna", scheme);
        await rows("aventurien", scheme);
        await panel("aumond", scheme, 1280, null);
        await panel("selem", scheme, 1280, null);
        await panel("selem", scheme, 360, null);
        await panel("selem", scheme, 360, "flora");
        await panel("drunidet", scheme, 360, "fauna");
    }

    const colour = CANON.colour;
    const image = (key: string): string =>
        `<img src="data:image/png;base64,${(shots[key] as Shot).png.toString("base64")}" alt="">`;
    const note = (key: string): string => escape((shots[key] as Shot).measured);
    const pair = (
        title: string,
        extra: string,
        leftKey: string,
        rightKey: string,
        leftWord: string,
        rightWord: string,
    ): string => `
<h2>${escape(title)} <span>· ${escape(extra)}</span></h2>
<div class="pair">
  <div><p>${escape(leftWord)} — ${note(leftKey)}</p>${image(leftKey)}</div>
  <div><p>${escape(rightWord)} — ${note(rightKey)}</p>${image(rightKey)}</div>
</div>`;
    const both = (title: string, extra: string, key: string): string =>
        pair(title, extra, `${key}-light`, `${key}-dark`, "hell", "dunkel");

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 8px; font-size: 16px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
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
<h1>Die Vorkommen: zwei Listen und ein Link — WI-0091 Nachtrag</h1>
<p>Satz der Entwicklungsdatenbank, Zug vom 2026-10-05. Die Regel ist jetzt <b>Enthaltensein</b>: Ein Vorkommen gehört einer
Fläche, und jeder Gegenstand, der in dieser Fläche liegt, listet es.</p>

<div class="note frage"><b>Was sich geändert hat</b>
<ul>
<li><b>„Direkt von hier“</b> — wie bisher: was der Gegenstand selbst trägt (am Ort dazu das tiefste Gebiet an seinem Punkt).</li>
<li><b>„Aus der Region“</b> — neu: alles, was einer Fläche gehört, die diesen Gegenstand <i>enthält</i>. Sie steht
<b>offen</b>, wie du es am 7.10. entschieden hast („nein ‚Aus der Region‘ brauch keine eigene klappbox“). Es ist die lange
Gruppe: im Median 47 Einträge je Ort, höchstens 256.</li>
<li><b>„Überall in Aventurien“</b> — ein <b>Link</b>, keine Liste. Er führt auf die Landschaft „Aventurien“; dort sind
dieselben Einträge ihr eigenes „Direkt von hier“. Darum reist kein einziger der bis zu 445 Namen je Art mehr mit.</li>
</ul>
Das alte A/B-Blatt ist damit erledigt: Was ein Link ist, steht nicht als Liste da — der Satz zählt zwingend die beiden Listen.</div>

${both("Selem · die vier Zeilen zugeklappt", "echte Größe, 1280 px", "rows-selem")}
${both("Selem · die Flora aufgeklappt", "beide Gruppen offen, darunter die Linkzeile", "open-selem-flora")}

<div class="note"><b>🔴 Der Extremfall, damit er auf dem Tisch liegt.</b> Drunidet erbt aus Meridiana und vier weiteren
Flächen; seine Fauna ist mit <b>110 Namen</b> die längste offene Gruppe des Bestands. So sieht sie aus — eine Gruppe, keine
Überschrift (sie wäre die einzige), nichts gekürzt. Wenn das zu viel ist, sag es; dann ist die nächste Runde eine Vorlage
dafür, nicht eine stille Kappung.</div>

${both("🔴 Drunidet · der Extremfall: 110 Namen offen", "echte Größe, 1280 px", "open-drunidet-fauna")}
${both("🔴 Drunidet · derselbe Fall am Telefon", "360 px", "panel-drunidet-360-fauna")}

${both("🔴 Aumond · nur Kontinentweites", "Stand WI-0091: keine einzige Zeile. 🚩 Seit WI-0103 steht dort die Linkzeile — viermal", "panel-aumond-1280-zu")}
${both("Aventurien · das Ziel des Links", "dort sind dieselben Einträge „Direkt von hier“", "rows-aventurien")}

${both("Selem · das ganze Panel, echte Größe", "1280 px", "panel-selem-1280-zu")}
${both("Selem · Telefon, zugeklappt", "360 px", "panel-selem-360-zu")}
${both("Selem · Telefon, Flora aufgeklappt", "360 px", "panel-selem-360-flora")}

<p class="note"><b>Was gemessen wurde</b> (2026-10-06, über den ganzen Bestand).
<table>
<tr><th>Gegenstandsart</th><th>erbt etwas</th><th>Einträge Median</th><th>p90</th><th>Max</th><th>Herkunftsflächen Median / Max</th></tr>
<tr><td>Ort</td><td>4.874 von 4.949</td><td>47</td><td>145</td><td>256</td><td>2 / 5</td></tr>
<tr><td>Landschaft</td><td>4.759 von 5.149</td><td>46</td><td>145</td><td>256</td><td>2 / 5</td></tr>
<tr><td>Politisches Gebiet (mit Form)</td><td>971 von 988</td><td>84</td><td>210</td><td>247</td><td>2 / 5</td></tr>
<tr><td>Gipfel</td><td>193 von 207</td><td>50</td><td>97</td><td>228</td><td>2 / 4</td></tr>
<tr><td>Weg (noch nicht gebaut)</td><td>9.354 von 9.506</td><td>55</td><td>150</td><td>395</td><td>2 / 8</td></tr>
</table>
<ul>
<li><b>Vorher bekamen 412 von 4.949 Orten (8,3 %) überhaupt etwas</b>, Median 0 — der alte Lesepfad fragte Regionen gar
nicht. Jetzt sind es 4.874 (98,5 %).</li>
<li><b>Die Antwort wurde kleiner, nicht größer:</b> Selem 94.294 → 12.372 Byte, Nostria 93.653 → 8.278, Perricum
66.709 → 1.905. Die Landschaft Aventurien bleibt bei 93.444 Byte — sie <i>ist</i> das Ziel des Links.</li>
<li><b>„Nur Kontinentweites“</b> betrifft 75 der 4.916 sichtbaren Orte, 344 Landschaften, 14 Gipfel — und 700 der 1.676
Gebiete, davon 688 allein deshalb, weil sie gar keine Geometrie haben. 🚩 <b>Seit dem 7.10. bekommen genau diese die
Linkzeile</b> („Überall in Aventurien muss natürlich auch überall stehen“) — dazu alle 9.506 Wege; siehe WI-0103.</li>
</ul></p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__vorkommenblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__vorkommenblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
