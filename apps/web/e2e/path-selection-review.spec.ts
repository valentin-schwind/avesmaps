import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0090: Wege sind anklickbar - und **die Auswahl ist überall gleich, der Unterschied sitzt allein in der
 * Vorschau**. Beim Zeigen kommt in der ruhigen Ansicht nur ein Schild, in einer Landschaftsebene Schild UND gestrichelte
 * Umrandung.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor: dieselbe Kartenstelle (Gareth am Großen Fluss, mit einer Reise
 * darüber) mit Straße, Fluss, Ort und Route, je beim Zeigen und gewählt, je in der ruhigen Ansicht („Alle") und in einer
 * Landschaftsansicht (Topographie), dazu hell und dunkel und einmal in echter Größe. Die Prüfungen stehen in
 * `path-selection.spec.ts` und `path-selection.touch.spec.ts`.
 *
 *   npm run review:wege-anklickbar
 *
 * Ablage: `review/wi-0090/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0090");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; colourDark: Record<string, string> };

const PREVIEW_LAYER = "path-preview";
/**
 * Gareth am Großen Fluss: dort treffen Reichsstraßen, der Fluss, eine Metropole und die Reise nach Perricum aufeinander.
 *
 * 🪤 Der Mittelpunkt liegt eine Einheit ÖSTLICH von Gareth: Die Reise zieht nach Perricum, und mit Gareth genau in der
 * Mitte lag sie bei z 7 außerhalb des freien Streifens zwischen Planer und Panel - auf dem ersten Blatt stand in der
 * Zeile „Route" deshalb „im Bild nicht gefunden". Gemessen 2026-10-06: so liegen alle vier im Streifen.
 */
const CENTRE = { x: 551.625 + 1, y: 532.969 };
const ZOOM = 6.2;

/** Der freie Streifen der Karte: rechts vom Routenplaner, links vom Infopanel. Jede Nahaufnahme zeigt genau ihn. */
const STRIP = { left: 400, width: 480, height: 320 };

/** Die beiden Regime der Vorschau: links die ruhige Ansicht, rechts eine Landschaftsebene. */
const VIEWS = [
    ["alle", "Ruhige Ansicht („Alle“)"],
    ["topographie", "Landschaftsansicht (Topographie)"],
] as const;

type ViewKey = (typeof VIEWS)[number][0];
type Thing = "strasse" | "fluss" | "ort" | "route";

const THINGS: [Thing, string][] = [
    ["strasse", "Straße"],
    ["fluss", "Fluss"],
    ["ort", "Ort"],
    ["route", "Route"],
];

interface Cell {
    /** Was das Zeiger-Schild sagte; `—` heißt keins. */
    hintText: string;
    /** Was beim Zeigen gestrichelt wurde: die Linien der Vorschau-Quelle `path-preview` (Anzahl und Arten); `—` heißt keine. */
    outlined: string;
    /** Was ein Klick wählte, als Zeile. */
    chosen: string;
    hover: Buffer | undefined;
    picked: Buffer | undefined;
}

interface Row {
    view: ViewKey;
    title: string;
    cells: Partial<Record<Thing, Cell>>;
    full: Buffer | undefined;
}

// -----------------------------------------------------------------------------------------------------------------

async function openAt(page: Page, layer: ViewKey, round: number, withRoute: boolean): Promise<void> {
    const reise = withRoute ? "route=Gareth~Perricum&" : "";
    await page.goto(
        `/?${reise}r=${String(round)}#x=${String(CENTRE.x)}&y=${String(CENTRE.y)}&z=${String(
            ZOOM,
        )}&series=original&view=landscapes&layer=${layer}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    if (withRoute) {
        // Die Reise soll stehen, bevor gemessen wird: ihre Trefferebene ist der Beleg.
        await page
            .waitForFunction(() => globalThis.avesmapsMap?.getLayer("route-hit") !== undefined, undefined, {
                timeout: 60_000,
            })
            .catch(() => undefined);
    }
    await settleFrame(page);
}

/**
 * Eine Stelle, an der genau dieses Ding das oberste unter dem Zeiger ist - gesucht, nicht geraten. Rechts bleibt Platz:
 * Beim Klick fährt das Infopanel (400 px) herein, und eine Nahaufnahme unter ihm wäre leer.
 */
const spotOf = (page: Page, thing: Thing): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate((want) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const present = (ids: string[]): string[] => ids.filter((id) => map.getLayer(id) !== undefined);
        const pathIds = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("path-hit-"));
        const riverIds = pathIds.filter((id) => id.includes("flussweg"));
        const placeIds = present(["place-marker", "place-marker-structure"]);
        const routeIds = present(["route-hit"]);
        const named = (ids: string[], at: [number, number]): boolean =>
            ids.length > 0 &&
            map
                .queryRenderedFeatures(at, { layers: ids })
                .some((hit) => String(hit.properties["name"] ?? "").trim() !== "");
        const any = (ids: string[], at: [number, number]): boolean =>
            ids.length > 0 && map.queryRenderedFeatures(at, { layers: ids }).length > 0;
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        // 🪤 Links liegt der Routenplaner (rund 390 px), rechts fährt beim Klick das Infopanel herein (400 px): Eine
        // Nahaufnahme außerhalb dieses Streifens zeigt Bedienteile statt Karte.
        const from = 430;
        const to = Math.min(canvas.clientWidth - 430, 850);
        const scan = (pick: (at: [number, number]) => boolean): { x: number; y: number } | undefined => {
            // Oben liegen Fächer und Suche über der Karte: erst ab 240 wird gesucht, damit die Nahaufnahme Karte zeigt.
            for (let y = 240; y < canvas.clientHeight - 240; y += 3) {
                for (let x = from; x < to; x += 3) {
                    if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                    if (pick([x, y])) return { x, y };
                }
            }
            return undefined;
        };
        // 🪤 Ein BENANNTER Ort: Ein namenloses Bauwerk zeigt kein Schild (`placePointerHint`), und die Zeile stünde leer.
        // 🪤 Die Ortszeile wird OHNE geladene Reise gemessen: In den Landschaften zeichnet die Karte nur Metropolen und
        // Großstädte, hier also allein Gareth - und Gareth ist mit der Reise der START-Wegpunkt. Über einer
        // Wegpunktmarke gehört das Zeigen dem Ziehen (Rang 90), und statt des Ortsschilds käme die Greifhand.
        if (want === "ort") return scan((at) => named(placeIds, at));
        if (want === "route") {
            // Am liebsten dort, wo die Reise AUF einem Weg liegt (dann zeigt das Blatt auch, dass sie gewinnt);
            // sonst irgendwo auf der Reise.
            return (
                scan((at) => any(routeIds, at) && !any(placeIds, at) && any(pathIds, at)) ??
                scan((at) => any(routeIds, at) && !any(placeIds, at))
            );
        }
        if (want === "fluss") {
            return scan(
                (at) =>
                    named(riverIds, at) &&
                    !any(placeIds, at) &&
                    !any(routeIds, at) &&
                    !any(
                        pathIds.filter((id) => !id.includes("flussweg")),
                        at,
                    ),
            );
        }
        // Die Straße: die sprechendste Art zuerst, damit auf dem Blatt ein echter Name steht.
        for (const art of ["reichsstrasse", "strasse", "weg", "pfad", "gebirgspass", "wuestenpfad"]) {
            const ids = pathIds.filter((id) => id === `path-hit-${art}`);
            if (ids.length === 0) continue;
            const found = scan(
                (at) => named(ids, at) && !any(placeIds, at) && !any(routeIds, at) && !any(riverIds, at),
            );
            if (found) return found;
        }
        return undefined;
    }, thing);

/**
 * Ein Ausschnitt um den Zeigerpunkt, der das Zeiger-Schild mitnimmt, wenn eins steht.
 *
 * 🪤 Fest begrenzt: Ohne Deckel zieht ein Schild am Rand den Ausschnitt über die halbe Seite, und auf dem Blatt stünde
 * dann der Routenplaner statt der Karte (erste Fassung des Blattes, 2026-10-06).
 */
async function closeUp(page: Page, at: { x: number; y: number }): Promise<Buffer> {
    const map = await page.getByTestId("map").boundingBox();
    const px = (map?.x ?? 0) + at.x;
    const py = (map?.y ?? 0) + at.y;
    const size = page.viewportSize();
    const hint =
        (await page.getByTestId("pointer-hint").count()) > 0
            ? await page.getByTestId("pointer-hint").boundingBox()
            : null;
    // Links bleibt der Routenplaner draußen. Rechts: Solange nur gezeigt wird, ist die Karte frei; sobald etwas gewählt
    // ist, steht dort das Infopanel - dann bleibt der Ausschnitt auf dem festen Streifen stehen.
    const maxLeft = hint ? (size?.width ?? 1280) - STRIP.width : STRIP.left;
    let left = Math.min(px - STRIP.width / 2, hint ? hint.x - 14 : Number.POSITIVE_INFINITY);
    left = Math.max(STRIP.left - 5, Math.min(left, maxLeft));
    // 🪤 Das Schild ganz zeigen: Ein abgeschnittenes „Reichsstraße 2 · Rei…“ beweist nichts (erste Fassung, 2026-10-06).
    const width = hint
        ? Math.min(Math.max(STRIP.width, hint.x + hint.width + 14 - left), (size?.width ?? 1280) - left)
        : STRIP.width;
    const top = Math.max(150, Math.min(py - STRIP.height / 2, (size?.height ?? STRIP.height) - STRIP.height));
    return page.screenshot({ clip: { x: left, y: top, width, height: STRIP.height } });
}

/** Was die Vorschau der Wege gerade strichelt (WI-0266): die Linien ihrer kleinen Quelle, als Zeile für das Blatt; `undefined` heißt keine. */
const outlinedName = (page: Page): Promise<string | undefined> =>
    page.evaluate((layer) => {
        const map = globalThis.avesmapsMap as unknown as
            | {
                  getLayer(id: string): unknown;
                  getSource(
                      id: string,
                  ): { serialize(): { data?: { features?: { properties?: Record<string, unknown> }[] } } } | undefined;
              }
            | undefined;
        if (!map || map.getLayer(layer) === undefined) return undefined;
        const features = map.getSource(layer)?.serialize().data?.features ?? [];
        if (features.length === 0) return undefined;
        const arten = [...new Set(features.map((entry) => String(entry.properties?.["subtype"])))];
        return `${String(features.length)} Linien · ${arten.join(", ")}`;
    }, PREVIEW_LAYER);

/** Was gewählt ist, als eine Zeile für das Blatt. */
const chosenLine = (page: Page): Promise<string> =>
    page.evaluate(() => {
        const area = globalThis.avesmapsAreaSelection?.();
        const subject = globalThis.avesmapsSelectedSubject?.();
        if (area) return `${area.name ?? "ohne Namen"} · ${area.kind === "path" ? area.type : area.type || area.kind}`;
        if (subject?.kind === "place") return "Ort";
        if (subject?.kind === "routeStage") return "Etappe der Reise";
        if (subject?.kind === "climate") return "Klimazone";
        if (subject?.kind === "mapPoint") return "Kartenpunkt";
        return "—";
    });

async function clearAll(page: Page): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(140);
    }
    await page.mouse.move(2, 2);
    await page.waitForTimeout(200);
}

async function measure(page: Page, thing: Thing): Promise<Cell | undefined> {
    const at = await spotOf(page, thing);
    if (!at) return undefined;
    const map = await page.getByTestId("map").boundingBox();
    const px = (map?.x ?? 0) + at.x;
    const py = (map?.y ?? 0) + at.y;

    await clearAll(page);
    await page.mouse.move(px - 40, py - 40);
    await page.mouse.move(px, py, { steps: 5 });
    await page.waitForTimeout(500);
    const hintText =
        (await page.getByTestId("pointer-hint").count()) > 0
            ? (await page.getByTestId("pointer-hint").innerText()).replace(/\s*\n\s*/g, " · ")
            : "—";
    const outlined = (await outlinedName(page)) ?? "—";
    const hover = await closeUp(page, at);

    await page.mouse.click(px, py);
    await page
        .waitForFunction(() => globalThis.avesmapsSelectedSubject?.() !== undefined, undefined, { timeout: 8_000 })
        .catch(() => undefined);
    await page.waitForTimeout(700);
    // Der Zeiger weg, damit auf dem Bild der Zustand GEWÄHLT steht und nicht Zeigen darüber.
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const chosen = await chosenLine(page);
    const picked = await closeUp(page, at);
    return { hintText, outlined, chosen, hover, picked };
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

// -----------------------------------------------------------------------------------------------------------------

test("Abnahmeblatt WI-0090: Wege anklickbar - der Unterschied sitzt in der Vorschau", async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const rows: Row[] = [];
    let round = 0;
    for (const [view, title] of VIEWS) {
        round += 1;
        await page.emulateMedia({ colorScheme: "light" });
        const cells: Partial<Record<Thing, Cell>> = {};
        await openAt(page, view, round, true);
        for (const [thing] of THINGS) {
            if (thing === "ort") continue;
            const cell = await measure(page, thing);
            if (cell) cells[thing] = cell;
            testInfo.annotations.push({ type: "Blatt", description: `${title} / ${thing} aufgenommen` });
        }
        // Der Ort ohne geladene Reise, aus derselben Kamera (Begründung bei `spotOf`).
        round += 1;
        await openAt(page, view, round, false);
        const ort = await measure(page, "ort");
        if (ort) cells["ort"] = ort;
        testInfo.annotations.push({ type: "Blatt", description: `${title} / ort aufgenommen` });
        await openAt(page, view, round + 100, true);
        // Echte Größe: das ganze Fenster, während der Zeiger auf einer Straße steht.
        await clearAll(page);
        const strasse = await spotOf(page, "strasse");
        let full: Buffer | undefined;
        if (strasse) {
            const map = await page.getByTestId("map").boundingBox();
            await page.mouse.move((map?.x ?? 0) + strasse.x - 40, (map?.y ?? 0) + strasse.y - 40);
            await page.mouse.move((map?.x ?? 0) + strasse.x, (map?.y ?? 0) + strasse.y, { steps: 5 });
            await page.waitForTimeout(500);
            full = await page.screenshot();
        }
        rows.push({ view, title, cells, full });
    }

    // Hell und dunkel: dasselbe Zeigen und dasselbe Gewählt, nur die Oberfläche wechselt das Thema.
    // 🔴 Die KARTE bleibt hell (Designkanon, WI-0032): Dunkel bekommt nur, was über ihr liegt - Schild und Panel.
    const themes: { scheme: "light" | "dark"; hover: Buffer | undefined; picked: Buffer | undefined }[] = [];
    for (const scheme of ["light", "dark"] as const) {
        round += 1;
        await page.emulateMedia({ colorScheme: scheme });
        await openAt(page, "topographie", round, true);
        const cell = await measure(page, "strasse");
        themes.push({ scheme, hover: cell?.hover, picked: cell?.picked });
    }
    await page.emulateMedia({ colorScheme: "light" });

    // -------------------------------------------------------------------------------------------------------------

    const colour = CANON.colour;
    const picture = (png: Buffer | undefined, width: number): string =>
        png === undefined
            ? `<p class="fehlt">— im Bild nicht gefunden</p>`
            : `<img width="${String(width)}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const mark = (value: string, kind: "ja" | "nein" = "ja"): string =>
        value === "—" ? `<span class="nein">— keins</span>` : `<span class="${kind}">${escape(value)}</span>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(testInfo.project.use.baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 36px; width: 1500px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 23px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 10px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]};
    border-top: 1px solid ${colour["border"]}; padding-top: 14px; }
h3 { margin: 0 0 6px; font-size: 14px; font-weight: 400; color: ${colour["textMuted"]}; }
.lead { margin: 0 0 6px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1100px; }
.satz { margin: 10px 0 0; padding: 10px 14px; border-left: 3px solid ${colour["accentStrong"]};
    background: ${colour["surface"]}; font-size: 15px; color: ${colour["textStrong"]}; max-width: 1100px; }
table.grid { border-collapse: collapse; width: 100%; }
table.grid td, table.grid th { vertical-align: top; padding: 6px 8px; }
table.grid th { text-align: left; font-weight: 400; color: ${colour["textMuted"]}; font-size: 13px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; }
.mess { font-size: 12px; margin: 5px 0 0; color: ${colour["textMuted"]}; }
.ja { color: ${colour["accentStrong"]}; }
.nein { color: ${colour["textMuted"]}; }
.fehlt { color: ${colour["textMuted"]}; font-size: 12px; margin: 0; }
.fahne { margin: 7px 0 0; padding: 3px 10px; display: inline-block; border-radius: 11px; font-size: 13px; }
.fahne.ruhig { background: transparent; color: ${colour["textMuted"]}; border: 1px solid ${colour["border"]}; }
.fahne.strich { background: ${colour["accentStrong"]}; color: ${colour["pageBg"]}; }
.offen { margin: 18px 0 0; padding: 12px 16px; background: ${colour["surface"]};
    border: 1px solid ${colour["border"]}; border-radius: 6px; max-width: 1100px; font-size: 13px; }
.offen b { color: ${colour["textStrong"]}; }
.offen ul { margin: 8px 0 0; padding-left: 20px; }
.offen li { margin: 0 0 8px; }
table.mess { border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
table.mess th, table.mess td { border: 1px solid ${colour["border"]}; padding: 4px 8px; text-align: left; }
table.mess th { font-weight: 400; color: ${colour["textMuted"]}; }
</style></head><body>

<h1>Wege lassen sich anklicken</h1>
<p class="lead">WI-0090 · dieselbe Kartenstelle (Gareth am Großen Fluss, mit der Reise Gareth → Perricum darüber),
Straße, Fluss, Ort und Route, je beim Zeigen und gewählt. Links die ruhige Ansicht, rechts eine Landschaftsansicht.
Alles im laufenden Browser gemessen. 🪤 <b>Route und Ort</b> stehen als Vergleich daneben: Der Ort zeigt sein Schild wie
immer, die Route zeigt heute keins — das ist ihr bisheriges Verhalten und nicht Teil dieses Pakets. Die Ortszeile ist ohne
geladene Reise aufgenommen, aus derselben Kamera: In den Landschaften zeichnet die Karte nur Metropolen und Großstädte,
hier also allein Gareth, und Gareth ist mit der Reise deren Startwegpunkt.</p>
<p class="satz"><b>Die Auswahl ist überall gleich; der Unterschied sitzt allein in der Vorschau.</b> Beim Zeigen kommt in
der ruhigen Ansicht <b>nur ein Schild</b> — in einer Landschaftsansicht <b>Schild und gestrichelte Umrandung</b>.</p>

<h2>1 · Beim Zeigen — hier sitzt der ganze Unterschied</h2>
<table class="grid"><tr><th style="width:90px"></th>${VIEWS.map(([, title]) => `<th>${escape(title)}</th>`).join(
        "",
    )}</tr>
${THINGS.map(
    ([thing, label]) =>
        `<tr><th>${escape(label)}</th>${rows
            .map((row) => {
                const cell = row.cells[thing];
                const strich = cell !== undefined && cell.outlined !== "—";
                const schild = cell !== undefined && cell.hintText !== "—";
                const fahne =
                    cell === undefined
                        ? ""
                        : `<p class="fahne ${strich ? "strich" : "ruhig"}">${schild ? "Schild" : "kein Schild"}${
                              strich ? " + gestrichelt" : " · keine Strichelung"
                          }</p>`;
                return `<td>${picture(cell?.hover, 440)}${fahne}<p class="mess">Schild: ${mark(
                    cell?.hintText ?? "—",
                )}<br>Strichelung: ${mark(cell?.outlined ?? "—")}</p></td>`;
            })
            .join("")}</tr>`,
).join("\n")}
</table>

<h2>2 · Gewählt — überall dasselbe durchgezogene Gold</h2>
<table class="grid"><tr><th style="width:90px"></th>${VIEWS.map(([, title]) => `<th>${escape(title)}</th>`).join(
        "",
    )}</tr>
${THINGS.map(
    ([thing, label]) =>
        `<tr><th>${escape(label)}</th>${rows
            .map((row) => {
                const cell = row.cells[thing];
                return `<td>${picture(cell?.picked, 440)}<p class="mess">Gewählt: ${mark(cell?.chosen ?? "—")}</p></td>`;
            })
            .join("")}</tr>`,
).join("\n")}
</table>

<h2>3 · Hell und dunkel</h2>
<p class="lead">🔴 Die <b>Karte bleibt hell</b> (Designkanon, WI-0032: was auf der Karte liegt, bekommt keinen
Dunkelwert). Dunkel wird, was darüber liegt: das Zeiger-Schild und das Panel. Beide Zeilen zeigen dieselbe Straße in der
Topographie.</p>
<table class="grid"><tr><th style="width:90px"></th><th>Zeigen</th><th>Gewählt</th></tr>
${themes
    .map(
        (entry) =>
            `<tr><th>${entry.scheme === "light" ? "hell" : "dunkel"}</th><td>${picture(
                entry.hover,
                380,
            )}</td><td>${picture(entry.picked, 380)}</td></tr>`,
    )
    .join("\n")}
</table>

<h2>4 · In echter Größe (1280 × 900), Zeiger auf einer Straße</h2>
<table class="grid"><tr>${rows
        .map((row) => `<th>${escape(row.title)}</th>`)
        .join("")}</tr><tr>${rows.map((row) => `<td>${picture(row.full, 720)}</td>`).join("")}</tr></table>

<h2>5 · Was dabei bewusst anders wird — bitte widersprechen, wenn es nicht gewollt ist</h2>
<div class="offen">
<ul>
<li><b>Flüsse verlieren in der ruhigen Ansicht ihre Strichelung</b> und bekommen dafür das Schild (Zeile „Fluss“, linke
Spalte). Das folgt aus „ich dachte flüsse sind wege“ und aus der bestätigten Tabelle — <b>wörtlich beauftragt war es
nicht</b>. In der Landschaftsansicht kommt das Schild zu ihrer Strichelung hinzu (rechte Spalte).</li>
<li><b>„Standardansicht“ ist zweideutig.</b> Die Oberfläche hat die <b>Ansicht „Standard“</b> und die <b>Ebene
„Alle“</b>. Gestrichelt wird jetzt nur, wo <b>genau eine</b> Landschaftsebene das Bild trägt (Topographie, Vegetation,
Derographie); ruhig bleiben damit <b>beide</b> Kandidaten — „Alle“ und „Standard“ — dazu Politisch, Nur Karte und
Kraftlinien. Soll die Strichelung auch in „Alle“ wieder erscheinen, ist das eine Zeile.</li>
<li><b>Klimazonen: Wege sind dort gezeichnet, aber nicht anklickbar.</b> Gemessen: alle sechzehn Wegebenen im Stil, 938
Wegfeatures im Bild. Dass dort trotzdem nur die Klimazone wählbar ist, ist die Entscheidung vom 5. Oktober („nur
klimazonen klickbar“) — sie bleibt stehen, bis es anders heißt.</li>
<li><b>Ein Weg hat keine Auswahlliste.</b> Liegen mehrere an einer Kreuzung, nimmt der erste Klick den obersten, der
zweite den nächsten; eine Liste wie bei den Flächen gibt es nicht, und das Schild nennt keine Zahl weiterer.</li>
</ul>
</div>

<h2>6 · Die Zahlen hinter dem Bild</h2>
<table class="mess"><tr><th>Ansicht</th><th>Ding</th><th>Schild beim Zeigen</th><th>Strichelung</th><th>Gewählt</th></tr>
${rows
    .flatMap((row) =>
        THINGS.map(([thing, label]) => {
            const cell = row.cells[thing];
            return `<tr><td>${escape(row.title)}</td><td>${escape(label)}</td><td>${escape(
                cell?.hintText ?? "—",
            )}</td><td>${escape(cell?.outlined ?? "—")}</td><td>${escape(cell?.chosen ?? "—")}</td></tr>`;
        }),
    )
    .join("\n")}
</table>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
