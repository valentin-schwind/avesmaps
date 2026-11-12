import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Locator, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Blatt „Lange Namensreihen: ein Buchstabenregister in zwei Spalten“ (WI-0099, Nachfolge von WI-0091).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor und schreibt die GEMESSENEN Höhen unter jedes Bild. Geprüft wird in
 * `apps/web/test/lore-model.test.ts` (Schwellen, Einsortierung) und `apps/web/e2e/vorkommen-gruppen.spec.ts` (am echten Stack).
 *
 * 🔴 **Der Anlass:** Drunidets Fauna, 110 Namen, stand aufgeklappt als EINE kommagetrennte Reihe 608 px hoch (WI-0091
 * Nachtrag 3). Legacy löst dasselbe seit dem 12.08.2026 mit Buchstabenmarken und zwei Spalten. Das Blatt stellt beide Gestalten
 * **an denselben Namen und in derselben Breite** gegenüber: Das „vorher“ ist nicht nachgebaut, sondern aus den echten Namen
 * desselben Panels zusammengesetzt - dieselben Links, dieselbe Schrift, dieselbe Spaltenbreite, und ohne die Ausnahme von der
 * Silbentrennung, also genau der Stand von gestern.
 *
 *   npm run review:vorkommen-register
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad auf dem Port, den `PORT` nennt (Vorgabe 3000, der geteilte Stapel; diese Änderung
 * berührt den Server nicht) und eine Entwicklungsdatenbank, in der I24 und I25 gelaufen sind. Eigene Vite dieser Sitzung:
 *   $env:E2E_PORT="5286"; npm run review:vorkommen-register
 *
 * Ablage: `review/wi-0099/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0099");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

const SUBJECTS = {
    /** 🔴 Der längste Fall des Bestands: EINE Gruppe, 110 Namen, vorher 608 px hoch. */
    drunidet: { kind: "place", id: "9a04121d-6f4d-533e-9207-05738e16bdf0", title: "Drunidet" },
    /** Der Vergleichsfall: 23 Namen in zwei Gruppen, vorher 226 px - und mit 23 unter der 25er-Schwelle. */
    selem: { kind: "place", id: "ec477f34-a34a-578e-9887-05b751f091e4", title: "Selem" },
} as const;

type Scheme = "light" | "dark";
type Name = keyof typeof SUBJECTS;

interface Measured {
    /** Die Höhe der ganzen aufgeklappten Zeile - die Zahl, um die es geht (608 px im alten Stand). */
    row: number;
    /** Wie viele Spalten wirklich entstanden sind, an den Blockpositionen abgelesen. */
    columns: number;
    /** Wie viele Buchstabenblöcke und welche Marken. */
    blocks: number;
    letters: string;
    /** Die Breite, die den Namen zur Verfügung steht (die Wertspalte der Feldliste). */
    width: number;
}

interface Shot {
    png: Buffer;
    note: string;
}

async function openPanel(browser: Browser, baseURL: string, who: Name, scheme: Scheme, width: number): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 1400 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page = await context.newPage();
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), {
        kind: SUBJECTS[who].kind,
        id: SUBJECTS[who].id,
    });
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-facts").waitFor({ timeout: 30_000 });
    return page;
}

/**
 * Klappt die Vorkommenszeile einer Art auf.
 *
 * 🪤 Die Namen kommen verzögert (`GET {detail}/lore`), also wird auf das Register gewartet, nicht auf eine Zeitspanne - sonst
 * misst man ein leeres Panel.
 */
async function expand(page: Page, kind: string): Promise<Locator> {
    const row = page.locator(`[data-field="lore:${kind}"]`);
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    await row.getByTestId("info-lore-sheet").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    return row;
}

/** Was dasteht: Höhe der Zeile, wirkliche Spaltenzahl, Blöcke und Marken. */
function measure(page: Page, kind: string): Promise<Measured> {
    return page.evaluate((loreKind) => {
        const row = document.querySelector<HTMLElement>(`[data-field="lore:${loreKind}"]`);
        const value = row?.querySelector<HTMLElement>('[data-testid="info-fact-value"]');
        const blocks = [...(row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-block"]') ?? [])];
        // Die Spaltenzahl steht in keiner berechneten Eigenschaft (`column-count` nennt die ANGABE, nicht das Ergebnis):
        // abgelesen an den linken Kanten der Blöcke.
        const lefts = new Set(blocks.map((block) => Math.round(block.getBoundingClientRect().left)));
        const letters = [...(row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-letter"]') ?? [])].map(
            (mark) => mark.textContent ?? "",
        );
        return {
            row: Math.round(row?.getBoundingClientRect().height ?? 0),
            columns: lefts.size,
            blocks: blocks.length,
            letters: letters.join(" "),
            width: Math.round(value?.getBoundingClientRect().width ?? 0),
        };
    }, kind);
}

/**
 * Baut den alten Stand in dieselbe Zeile: EINE kommagetrennte Reihe aus genau denselben Namen.
 *
 * 🔴 Die Namen werden geklont, nicht abgeschrieben - so bleiben Links, Farben und Schrift dieselben. `hyphens` bleibt
 * ungesetzt, erbt also die Silbentrennung des Kanons: genau der Stand, den der Betreiber gesehen hat.
 */
function swapToOldForm(page: Page, kind: string): Promise<void> {
    return page.evaluate((loreKind) => {
        const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
        for (const sheet of row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-sheet"]') ?? []) {
            const run = document.createElement("p");
            run.dataset["testid"] = "info-lore-old";
            run.style.cssText =
                "margin:0;overflow-wrap:anywhere;color:var(--color-text-strong);font-size:var(--font-size-small);line-height:var(--leading-snug)";
            let first = true;
            for (const names of sheet.querySelectorAll('[data-testid="info-lore-names"]')) {
                if (!first) run.append(document.createTextNode(", "));
                first = false;
                for (const node of [...names.childNodes]) run.append(node.cloneNode(true));
            }
            sheet.style.display = "none";
            sheet.after(run);
        }
    }, kind);
}

/** Nimmt den alten Stand wieder heraus. */
function swapBack(page: Page, kind: string): Promise<void> {
    return page.evaluate((loreKind) => {
        const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
        for (const run of row?.querySelectorAll('[data-testid="info-lore-old"]') ?? []) run.remove();
        for (const sheet of row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-sheet"]') ?? [])
            sheet.style.removeProperty("display");
    }, kind);
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

/**
 * Gemessenes gehoert in den Bericht UND auf die Konsole: Wer das Blatt faehrt, will die Zahlen sofort sehen.
 * `process.stdout.write` statt `console.log`, weil der Hausstandard nur `warn` und `error` auf der Konsole zulaesst - und eine
 * Messung ist keine Warnung.
 */
const say = (line: string): void =>
    void process.stdout.write(`  ${line}
`);

/** Das Thema, in dem die Entscheidungstafel gemessen wird - die Höhen hängen nicht an der Farbe. */
const scheme0: Scheme = "light";

test("Blatt: lange Namensreihen als Buchstabenregister", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot> = {};
    const remember = (key: string, shot: Shot): void => {
        shots[key] = shot;
        testInfo.annotations.push({ type: "Blatt", description: `${key}: ${shot.note}` });
        say(`${key}: ${shot.note}`);
    };

    /**
     * Die Breite der 27 möglichen Marken im 500er Schnitt der Hausschrift - die Zahl, auf der die feste Breite der
     * Buchstabenspalte liegt (Legacy hat dort `min-width`, und damit rutscht die Namenskante bei „W“ nach rechts).
     */
    const letterWidths = async (): Promise<string> => {
        const page = await openPanel(browser, baseURL, "selem", "light", 1280);
        const measuredWidths = await page.evaluate(() => {
            const probe = document.createElement("span");
            // Genau der Stil der Marke: Größe der Bildunterschrift, Regular - die Hausschrift hat keinen zweiten Schnitt.
            probe.style.cssText =
                "position:absolute;visibility:hidden;white-space:pre;font-size:var(--font-size-caption)";
            document.body.append(probe);
            const marks = ["#", ...Array.from({ length: 26 }, (_, at) => String.fromCharCode(65 + at))];
            const widths = marks.map((mark) => {
                probe.textContent = mark;
                return { mark, width: probe.getBoundingClientRect().width };
            });
            probe.remove();
            widths.sort((left, right) => right.width - left.width);
            return widths.slice(0, 3).map((entry) => `${entry.mark} ${entry.width.toFixed(2)} px`);
        });
        await page.context().close();
        return measuredWidths.join(" · ");
    };

    /**
     * 🔴 **Die Entscheidungstafel:** dieselbe Zeile unter mehreren Spaltenvorgaben, dazu der alte Stand - alles im Browser
     * gemessen, damit die Wahl der Mindestbreite nicht geschätzt ist. Legacys Wert ist `2 105px`.
     */
    const variants = async (who: Name, kind: string, width: number): Promise<string[]> => {
        const page = await openPanel(browser, baseURL, who, scheme0, width);
        await expand(page, kind);
        const lines: string[] = [];
        for (const setting of ["2 105px", "2 130px", "2 160px", "2 200px"]) {
            await page.evaluate(
                ([loreKind, columns]) => {
                    const row = document.querySelector(`[data-field="lore:${String(loreKind)}"]`);
                    for (const sheet of row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-sheet"]') ?? [])
                        sheet.style.columns = String(columns);
                },
                [kind, setting],
            );
            await page.waitForTimeout(150);
            const seen = await measure(page, kind);
            lines.push(`${setting}|${String(seen.columns)}|${String(seen.row)}`);
        }
        await page.evaluate((loreKind) => {
            const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
            for (const sheet of row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-sheet"]') ?? [])
                sheet.style.removeProperty("columns");
        }, kind);
        // 💣 Zwei Posten trennen: Wie viel von der Höhe kostet die abgeschaltete Silbentrennung, wie viel die Struktur?
        // Dieselbe Zeile noch einmal mit der globalen Trennung des Kanons.
        await page.evaluate((loreKind) => {
            const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
            for (const names of row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-names"]') ?? [])
                names.style.hyphens = "auto";
        }, kind);
        await page.waitForTimeout(150);
        lines.push(
            `2 105px, aber MIT Silbentrennung|${String((await measure(page, kind)).columns)}|${String((await measure(page, kind)).row)}`,
        );
        await page.evaluate((loreKind) => {
            const row = document.querySelector(`[data-field="lore:${loreKind}"]`);
            for (const names of row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-names"]') ?? [])
                names.style.removeProperty("hyphens");
        }, kind);
        await swapToOldForm(page, kind);
        await page.waitForTimeout(150);
        lines.push(`eine Reihe (alt)|1|${String((await measure(page, kind)).row)}`);
        await page.context().close();
        return lines;
    };

    /** Vorher und nachher an derselben Zeile, in derselben Breite. */
    const pairOf = async (who: Name, kind: string, scheme: Scheme, width: number): Promise<void> => {
        const page = await openPanel(browser, baseURL, who, scheme, width);
        const row = await expand(page, kind);
        const after = await measure(page, kind);
        const afterPng = await row.screenshot();

        await swapToOldForm(page, kind);
        await page.waitForTimeout(200);
        const before = await measure(page, kind);
        const beforePng = await row.screenshot();
        await swapBack(page, kind);

        const tail = `${String(width)} px breit, Wertspalte ${String(after.width)} px`;
        remember(`${who}-${kind}-${String(width)}-${scheme}-vorher`, {
            png: beforePng,
            note: `eine Reihe · ${String(before.row)} px hoch · ${tail}`,
        });
        remember(`${who}-${kind}-${String(width)}-${scheme}-nachher`, {
            png: afterPng,
            note: `${String(after.blocks)} Marken in ${String(after.columns)} Spalte${after.columns === 1 ? "" : "n"} · ${String(after.row)} px hoch · ${tail}`,
        });
        const marks = `${who}/${kind}/${String(width)}: ${after.letters}`;
        testInfo.annotations.push({ type: "Marken", description: marks });
        say(`Marken ${marks}`);
        await page.context().close();
    };

    /** Die klappbare Gruppenzeile: wie sie startet, und nach dem Klick auf die zweite Gruppe. */
    const collapsible = async (scheme: Scheme): Promise<void> => {
        const page = await openPanel(browser, baseURL, "selem", scheme, 1280);
        const row = await expand(page, "ware");
        const zu = await measure(page, "ware");
        remember(`selem-ware-zu-${scheme}`, {
            png: await row.screenshot(),
            note: `zwei Gruppen, 88 Namen in der Zeile · die erste offen, die zweite zu · ${String(zu.row)} px hoch`,
        });
        await row.getByTestId("info-lore-group-head").last().click();
        await page.waitForTimeout(400);
        const offen = await measure(page, "ware");
        remember(`selem-ware-offen-${scheme}`, {
            png: await row.screenshot(),
            note: `nach dem Klick auf „Aus der Region“ · ${String(offen.blocks)} Marken in ${String(offen.columns)} Spalten · ${String(offen.row)} px hoch`,
        });
        await page.context().close();
    };

    /** Das ganze Panel, damit die Zeile in ihrem Zusammenhang steht. */
    const panel = async (who: Name, kind: string, scheme: Scheme, width: number): Promise<void> => {
        const page = await openPanel(browser, baseURL, who, scheme, width);
        await expand(page, kind);
        const seen = await measure(page, kind);
        remember(`panel-${who}-${kind}-${String(width)}-${scheme}`, {
            png: await page.getByTestId("info-panel").first().screenshot(),
            note: `${String(width)} px · Zeile ${String(seen.row)} px hoch · ${String(seen.columns)} Spalten`,
        });
        await page.context().close();
    };

    const widths = await letterWidths();
    testInfo.annotations.push({ type: "Markenbreite", description: widths });
    say(`Markenbreite: ${widths}`);

    const tafel: Record<string, string[]> = {};
    for (const [who, kind, width] of [
        ["drunidet", "fauna", 1280],
        ["drunidet", "fauna", 360],
        ["selem", "flora", 1280],
    ] as [Name, string, number][]) {
        const key = `${who}/${kind}/${String(width)}`;
        tafel[key] = await variants(who, kind, width);
        for (const line of tafel[key]) say(`Tafel ${key}: ${line}`);
    }

    for (const scheme of ["light", "dark"] as const) {
        await pairOf("drunidet", "fauna", scheme, 1280);
        await pairOf("drunidet", "fauna", scheme, 360);
        await pairOf("selem", "flora", scheme, 1280);
        await pairOf("selem", "flora", scheme, 360);
        await collapsible(scheme);
        await panel("drunidet", "fauna", scheme, 1280);
        await panel("drunidet", "fauna", scheme, 360);
    }

    const colour = CANON.colour;
    const image = (key: string): string =>
        `<img src="data:image/png;base64,${(shots[key] as Shot).png.toString("base64")}" alt="">`;
    const note = (key: string): string => escape((shots[key] as Shot).note);
    /** Vier Bilder: Spalten vorher gegen nachher, Zeilen hell gegen dunkel. */
    const quad = (title: string, extra: string, key: string, left: string, right: string): string => `
<h2>${escape(title)} <span>· ${escape(extra)}</span></h2>
<div class="quad">
  <div><p><b>hell · ${escape(left)}</b> — ${note(`${key}-light-vorher`)}</p>${image(`${key}-light-vorher`)}</div>
  <div><p><b>hell · ${escape(right)}</b> — ${note(`${key}-light-nachher`)}</p>${image(`${key}-light-nachher`)}</div>
  <div><p><b>dunkel · ${escape(left)}</b> — ${note(`${key}-dark-vorher`)}</p>${image(`${key}-dark-vorher`)}</div>
  <div><p><b>dunkel · ${escape(right)}</b> — ${note(`${key}-dark-nachher`)}</p>${image(`${key}-dark-nachher`)}</div>
</div>`;
    const pair = (title: string, extra: string, leftKey: string, rightKey: string): string => `
<h2>${escape(title)} <span>· ${escape(extra)}</span></h2>
<div class="pair">
  <div><p>${note(leftKey)}</p>${image(leftKey)}</div>
  <div><p>${note(rightKey)}</p>${image(rightKey)}</div>
</div>`;
    /**
     * 🔴 Eine Zahl aus der Tafel, nicht aus dem Gedächtnis: Jede Höhe im Fließtext des Blattes kommt aus derselben Messung
     * wie die Tabelle. Sonst stünde beim nächsten Lauf eine alte Zahl im Satz und eine neue in der Zeile darunter.
     */
    const hoehe = (key: string, setting: string): string => {
        const row = (tafel[key] ?? []).find((line) => line.split("|")[0] === setting);
        if (row === undefined) throw new Error(`Keine Messung für ${key} / ${setting}`);
        return (row.split("|")[2] ?? "?").replace(/^(\d)(\d{3})$/, "$1.$2");
    };

    /** Die gemessene Entscheidungstafel: dieselbe Zeile unter mehreren Spaltenvorgaben. */
    const tafelTable = (key: string): string => `
<table>
<tr><th>${escape(key)}</th><th>Spalten, die wirklich entstehen</th><th>Höhe der Zeile</th></tr>
${(tafel[key] ?? [])
    .map((line) => {
        const [setting, columns, height] = line.split("|");
        const mark = setting === "2 105px" ? " ← gebaut (Legacys Wert)" : "";
        return `<tr><td>${escape(String(setting))}${mark}</td><td>${escape(String(columns))}</td><td>${escape(String(height))} px</td></tr>`;
    })
    .join("\n")}
</table>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 8px; font-size: 16px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
p { margin: 0 0 6px; color: ${colour["textMuted"]}; font-size: 12px; }
p b { color: ${colour["textStrong"]}; font-weight: 400; }
.quad, .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
.quad img, .pair img { display: block; max-width: 100%; border: 1px solid ${colour["divider"]}; border-radius: 8px; }
.note { margin: 14px 0 0; padding: 10px 12px; border: 1px solid ${colour["divider"]}; border-radius: 8px; color: ${colour["text"]}; font-size: 13px; }
.note b { color: ${colour["textStrong"]}; }
.frage { border-color: ${colour["link"]}; }
ul { margin: 6px 0 0; padding-left: 18px; }
table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
td, th { border: 1px solid ${colour["divider"]}; padding: 3px 8px; text-align: left; color: ${colour["text"]}; }
th { color: ${colour["textStrong"]}; font-weight: 400; }
</style></head><body>
<h1>Lange Namensreihen: ein Buchstabenregister in zwei Spalten — WI-0099</h1>
<p>Dieselben Namen, dieselbe Breite, dieselbe Schrift. Links der Stand von gestern (eine kommagetrennte Reihe), rechts Legacys
Register. Die Höhen sind im Browser gemessen, nicht gerechnet.</p>

<div class="note frage"><b>🔴 Das Wichtigste zuerst, und es ist nicht das, was ich erwartet habe: Das Register macht die längste
Zeile HÖHER, nicht kürzer.</b> Drunidets Fauna wächst in echter Größe von <b>${hoehe("drunidet/fauna/1280", "eine Reihe (alt)")} px auf
${hoehe("drunidet/fauna/1280", "2 105px")} px</b> und am Telefon von
<b>${hoehe("drunidet/fauna/360", "eine Reihe (alt)")} px auf ${hoehe("drunidet/fauna/360", "2 105px")} px</b>. Der Grund ist gemessen und
nicht zu umgehen: Die Wertspalte der Feldliste ist <b>245 px</b> breit;
zwei Spalten daraus sind 118 px, und ein Name wie „Khoramsflederechse“ braucht allein schon 110 px. Jede Marke fängt außerdem
eine neue Zeile an — 21 Marken sind 21 angebrochene Zeilen. <b>Zwei Spalten gegen eine ist dabei fast ein Nullsummenspiel</b>
(${hoehe("drunidet/fauna/1280", "2 105px")} gegen ${hoehe("drunidet/fauna/1280", "2 130px")} px): Halbe Breite heißt doppelt so
viele Zeilen je Block.
<br><br>
<b>Und es ist nicht nur Höhe:</b> In 118 px schmalen Spalten brechen lange Namen mitten im Wort und ohne Strich — „Gewürznelkenb aum“,
„Khunchomerro se“, „Robochschlinge r“. Das fängt <code>overflow-wrap</code> ab, damit nichts seitlich überläuft; schön ist es nicht, und
in der breiten Reihe passiert es kaum.
<br><br>
Legacy hat dieselbe Rechnung an <i>kurzen</i> Namen gemacht — 126 Handelswaren der Reichsstraße 2, „Salz, Vieh, Holz“ — und
dort trägt sie. Bei Tier- und Pflanzennamen, die fast alle zusammengesetzt sind, trägt sie nicht.
<br><br>
<b>Was das Register dafür bringt</b>, und das ist Legacys eigentliches Argument (Owner 12.08.2026: „es macht mein
durchblättern keinen sinn dass in einem menü welche dranstehen und im andern nicht“): 21 Marken, an denen das Auge sucht, alle
Namen an einer Kante, und keine falsche Silbentrennung mehr („Totenko-pfäffchen“ statt Totenkopf-äffchen, „Ma-raskanfeder“ —
links auf den Bildern noch zu sehen, rechts nicht).
<br><br>
🔴 <b>Deine Entscheidung:</b> <b>A</b> Register bleibt, wie Legacy es hat — Durchblättern gewinnt, Höhe verliert.
<b>B</b> Register nur mit einer Spalte (${hoehe("drunidet/fauna/1280", "2 130px")} px, dafür breitere Namensspalte und weniger
gebrochene Namen).
<b>C</b> zurück zur kommagetrennten Reihe (${hoehe("drunidet/fauna/1280", "eine Reihe (alt)")} px), also ohne Marken. <b>D</b> die
lange Gruppe bekommt doch einen Deckel —
das wäre eine Ebene mehr als Legacy hat und das Gegenteil deiner Ansage vom 7.10., diesmal aber für 110 Namen statt für drei.
Ich empfehle <b>A</b>: Die Zeile steht erst da, wenn man sie aufklappt, und wer sie aufklappt, sucht einen Namen.</div>

<div class="note"><b>Die übrigen Regeln, die mitgekommen sind</b>
<ul>
<li><b>Buchstabenmarken, immer</b> — auch bei drei Namen. Der Owner hat die Schwelle am 12.08.2026 von 30 über 10 auf 0
geführt; eine eigene Schwelle ist hier nicht erfunden worden.</li>
<li><b>Zwei Spalten erst ab 105 px je Spalte</b>, ohne Breitenabfrage: Wo der Platz fehlt, fällt es von selbst auf eine Spalte
zurück — am Telefon tut es das.</li>
<li><b>Die Gruppen klappen erst ab 25 Namen in der ZEILE</b>, und dann steht die erste offen. 🪤 Damit entsteht die Klappbox,
die du am 7.10. abgelehnt hast („nein ‚Aus der Region‘ brauch keine eigene klappbox“), bei kurzen Zeilen gar nicht mehr — und
bei langen trägt sie Legacys schmale Zeile: Name, Zahl, kleines Pfeilchen, eine Trennlinie darüber.</li>
<li><b>Umlaute fallen auf ihren Grundbuchstaben</b> (Ä → A), Ziffern und alles Übrige landen unter „#“, sortiert wird nach
deutscher Ordnung — sonst stünde „Älbler“ hinter „Zwerg“.</li>
</ul></div>

${quad("🔴 Drunidet · Fauna, 110 Namen", "der längste Fall des Bestands, echte Größe 1280 px", "drunidet-fauna-1280", "vorher", "nachher")}
${quad("🔴 Drunidet · Fauna am Telefon", "360 px — hier entscheidet die Mindestbreite, ob zwei Spalten tragen", "drunidet-fauna-360", "vorher", "nachher")}
${quad("Selem · Flora, 23 Namen", "der kurze Fall zum Vergleich, echte Größe 1280 px", "selem-flora-1280", "vorher", "nachher")}
${quad("Selem · Flora am Telefon", "360 px", "selem-flora-360", "vorher", "nachher")}

<div class="note frage"><b>🔴 Die klappbare Gruppenzeile — das ist die Gestalt, um die ich bitte.</b> Selems Waren haben 88
Namen in zwei Gruppen, liegen also über der 25er-Schwelle. Dann klappen die Gruppen, und <i>nur die erste</i> steht offen: hier
„Von hier“ mit 3 Namen, der stärksten Aussage über den Ort. Die Zeile selbst ist Name, Zahl, Pfeilchen — 12 px, eine Trennlinie
darüber, kein Kasten. <b>Wenn das zu viel Ebene ist, sag es;</b> dann steht die Alternative, alles offen zu lassen, und Drunidets
Waren wären 58 Namen in einem Stück.</div>

${pair("🔴 Selem · Waren: die klappbare Gruppenzeile", "hell — links wie sie startet, rechts nach dem Klick", "selem-ware-zu-light", "selem-ware-offen-light")}
${pair("Selem · Waren, dunkel", "dieselben zwei Zustände", "selem-ware-zu-dark", "selem-ware-offen-dark")}

${pair("Drunidet · das ganze Panel", "hell: 1280 px und 360 px", "panel-drunidet-fauna-1280-light", "panel-drunidet-fauna-360-light")}
${pair("Drunidet · das ganze Panel, dunkel", "1280 px und 360 px", "panel-drunidet-fauna-1280-dark", "panel-drunidet-fauna-360-dark")}

<h2>Die Entscheidungstafel <span>· dieselbe Zeile, verschiedene Spaltenvorgaben, im Browser gemessen</span></h2>
${tafelTable("drunidet/fauna/1280")}
${tafelTable("drunidet/fauna/360")}
${tafelTable("selem/flora/1280")}
<p>🪤 Bei Selems kürzeren Namen tragen zwei Spalten noch: ${hoehe("selem/flora/1280", "2 105px")} px gegen
${hoehe("selem/flora/1280", "2 130px")} px mit einer Spalte. Bei Drunidets langen
zusammengesetzten Namen ist der Unterschied weg. Die Zeile „mit Silbentrennung“ trennt die zwei Posten: Was darüber liegt,
kostet die <i>Struktur</i> des Registers, der Rest die abgeschaltete Trennung — und die ist keine Geschmacksfrage, sondern die
Korrektur falsch getrennter Eigennamen.</p>

<div class="note"><b>Gemessen</b> — die Breite der Buchstabenspalte liegt auf dem breitesten Glyph: ${escape(widths)}. Legacy
setzt dort <code>min-width</code>, und damit rutscht die Namenskante bei „W“ nach rechts; hier steht eine feste Breite, damit
alle Namen wirklich an derselben Kante beginnen.
<ul>
<li><b>Die vier Zeilen eines Gegenstands teilen EINE Antwort</b> — am Register ändert sich daran nichts.</li>
<li><b>Nichts wird gekürzt</b>: kein „(…)“, kein „mehr anzeigen“, keine stille Kappung. Alle Namen stehen da, nur anders
gesetzt.</li>
<li>Drunidets vier Zeilen haben je genau EINE belegte Gruppe (alles aus Meridiana und vier weiteren Flächen). Eine einzige
Gruppe trägt keine Überschrift und klappt nicht — sie gliedert nichts.</li>
</ul></div>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__registerblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__registerblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
