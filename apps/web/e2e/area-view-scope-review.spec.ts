import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { clickMap, onPage, settleFrame } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0083 samt Nachtrag: In jeder Landschaftsansicht ist nur anklickbar, was zu dieser Ansicht gehört - Flächen,
 * Seen, Meere UND Flüsse -, gezeichnet bleibt alles überall, und das Meer ist überall dasselbe Blau (Betreiber 2026-10-05).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor: je Ansicht zwei Bildausschnitte (Küste und See - was zu SEHEN ist) und
 * daneben, was ein Klick dort wirklich trifft, gemessen im laufenden Browser. Die Prüfungen stehen in
 * `area-view-scope.spec.ts` und `area-view-scope.touch.spec.ts`.
 *
 *   npm run review:flaechen-ansicht
 *
 * Ablage: `review/wi-0083/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0083");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Die vier Stellen, an denen gemessen wird (Kartenkoordinaten, Legacy-Bestand). */
const MEER = { x: 650, y: 480 };
const SEE = { x: 597.841, y: 549.016 };
const LAND = { x: 450, y: 560 };
const FLUSS = { x: 551.625, y: 532.969 };

const VIEWS = [
    ["alle", "Alle"],
    ["topographie", "Topographie"],
    ["vegetation", "Vegetation"],
    ["derographisch", "Derographisch"],
    ["klima", "Klimazonen"],
] as const;

type ViewKey = (typeof VIEWS)[number][0];

interface Row {
    view: ViewKey;
    title: string;
    coast: Buffer;
    lake: Buffer;
    hits: Record<string, string>;
}

const AREA_LAYERS = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        (globalThis.avesmapsMap?.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter(
                // 🪤 Das Wasser steht in ZWEI Füllungen, seit das Meer als Grund unter den Landschaftsfüllungen liegt
                // (Nachtrag zu WI-0083): der See oben, das Meer unten. Wer nur die eine fragt, findet das Meer nicht.
                (id) => id === "gewaesser-flaeche" || id === "gewaesser-grund" || id.startsWith("landscape-fill-"),
            ),
    );

async function jump(page: Page, to: { x: number; y: number }, zoom: number): Promise<void> {
    await page.evaluate(
        async ({ target, level }) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) throw new Error("map or projection handle missing");
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { target: to, level: zoom },
    );
    await settleFrame(page);
}

/** Die Mitte der Karte in Bildpunkten. */
const middle = (page: Page): Promise<{ x: number; y: number }> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const at = map.project(map.getCenter());
        return { x: Math.round(at.x), y: Math.round(at.y) };
    });

/** Die Stelle, an der eine Fläche dieser Art die kleinste unter dem Zeiger ist; sonst die Mitte. */
async function spotOf(page: Page, type: string | undefined): Promise<{ x: number; y: number }> {
    const at = await middle(page);
    if (type === undefined) return at;
    const layers = await AREA_LAYERS(page);
    if (layers.length === 0) return at;
    const found = await page.evaluate(
        ({ ids, wanted, from }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            const size = (feature: { properties: Record<string, unknown> }): number => {
                const raw = Number(feature.properties["area"]);
                return Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
            };
            let best: { x: number; y: number } | undefined;
            for (let y = 90; y < canvas.clientHeight - 90; y += 6) {
                for (let x = Math.max(90, from.x - 280); x < canvas.clientWidth - 60; x += 6) {
                    const hits = map.queryRenderedFeatures([x, y], { layers: ids });
                    if (hits.length === 0) continue;
                    const smallest = hits.reduce((a, b) => (size(a) <= size(b) ? a : b));
                    if (String(smallest.properties["region_type"]) !== wanted) continue;
                    const point = { x, y };
                    if (!best || Math.hypot(x - from.x, y - from.y) < Math.hypot(best.x - from.x, best.y - from.y)) {
                        best = point;
                    }
                }
            }
            return best;
        },
        { ids: layers, wanted: type, from: at },
    );
    return found ?? at;
}

/** Alles zu: Panel und Auswahl weg, damit der nächste Klick auf die Karte trifft und nicht auf ein offenes Panel. */
async function clear(page: Page): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
    }
}

/** Was ein Klick an dieser Stelle trifft, als eine Zeile für das Blatt. */
async function clickAt(page: Page, at: { x: number; y: number }): Promise<string> {
    await clickMap(page, at);
    // Die Antwort des Servers kann dauern (ein Subject wird geladen): warten, bis etwas gewählt ist, höchstens 3 s.
    await page
        .waitForFunction(() => globalThis.avesmapsSelectedSubject?.() !== undefined, undefined, { timeout: 3_000 })
        .catch(() => undefined);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
        const area = globalThis.avesmapsAreaSelection?.();
        if (area) {
            const art = area.type === "" ? "ohne Art" : area.type;
            return `${area.name ?? "ohne Namen"} · ${art}`;
        }
        const subject = globalThis.avesmapsSelectedSubject?.();
        if (subject?.kind === "climate") return "Klimazone";
        return "—";
    });
}

/**
 * Die Flussstelle: eine benannte Flusslinie im Bild, mit derselben Reichweite wie die Auswahl (`RIVER_REACH`) - und am
 * Zeiger erreichbar (am oberen Rand liegen Fächer und Suche über der Karte).
 */
const riverSpot = (page: Page): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        for (let y = 140; y < canvas.clientHeight - 140; y += 6) {
            for (let x = 400; x < canvas.clientWidth - 140; x += 6) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                const hits = map.queryRenderedFeatures(
                    [
                        [x - 5, y - 5],
                        [x + 5, y + 5],
                    ],
                    { layers: ["path-center-flussweg", "path-center-flussweg-bach"] },
                );
                if (hits.some((hit) => String(hit.properties["name"] ?? "").trim() !== "")) return { x, y };
            }
        }
        return undefined;
    });

/** Ein Ausschnitt der Karte um die Mitte. */
async function crop(page: Page, width: number, height: number): Promise<Buffer> {
    const at = await onPage(page, await middle(page));
    return page.screenshot({
        clip: { x: at.x - width / 2, y: at.y - height / 2, width, height },
    });
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt: nur die Flächen der aktiven Ansicht sind anklickbar", async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const rows: Row[] = [];
    let round = 0;
    for (const [view, title] of VIEWS) {
        round += 1;
        await page.goto(
            `/?r=${String(round)}#x=${String(MEER.x)}&y=${String(MEER.y)}&z=5.2&series=original&view=landscapes&layer=${view}`,
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
        await settleFrame(page);
        const coast = await crop(page, 420, 300);
        await clear(page);
        const hits: Record<string, string> = {};
        hits["meer"] = await clickAt(page, await spotOf(page, "meer"));

        await jump(page, SEE, 6.8);
        const lake = await crop(page, 300, 230);
        await clear(page);
        hits["see"] = await clickAt(page, await spotOf(page, "see"));

        await jump(page, LAND, 6.5);
        await clear(page);
        hits["flaeche"] = await clickAt(page, await middle(page));

        await jump(page, FLUSS, 7);
        await clear(page);
        const river = await riverSpot(page);
        hits["fluss"] = river === undefined ? "— kein Fluss im Bild" : await clickAt(page, river);

        rows.push({ view, title, coast, lake, hits });
        testInfo.annotations.push({ type: "Blatt", description: `${title} aufgenommen` });
    }

    const colour = CANON.colour;
    const picture = (png: Buffer, width: number): string =>
        `<img width="${String(width)}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const mark = (value: string): string =>
        value.startsWith("—")
            ? `<span class="nein">— nichts</span>`
            : value === "Klimazone"
              ? `<span class="band">Klimazone</span>`
              : `<span class="ja">${escape(value)}</span>`;
    const PROBES: [string, string][] = [
        ["flaeche", "Landschaftsfläche"],
        ["see", "See (Ochsenwasser)"],
        ["meer", "Meer (Golf von Perricum)"],
        ["fluss", "Fluss (nächster im Bild)"],
    ];
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(testInfo.project.use.baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 36px; width: 1120px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 20px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 900px; }
section { display: grid; grid-template-columns: 420px 300px 1fr; gap: 20px; align-items: start;
    padding: 14px 0; border-top: 1px solid ${colour["border"]}; }
h2 { grid-column: 1 / -1; margin: 0; font-size: 17px; font-weight: 400; color: ${colour["textStrong"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; }
table { border-collapse: collapse; font-size: 13px; width: 100%; }
th { text-align: left; font-weight: 400; color: ${colour["textMuted"]}; padding: 2px 10px 2px 0; white-space: nowrap; }
td { padding: 2px 0; }
.ja { color: ${colour["accentStrong"]}; }
.nein, .band { color: ${colour["textMuted"]}; }
.cap { grid-column: 1 / 3; margin: 6px 0 0; font-size: 12px; color: ${colour["textMuted"]}; }
</style></head><body>
<h1>Nur was zur aktiven Ansicht gehört, ist anklickbar</h1>
<p class="lead">WI-0083 samt Nachtrag · Betreiber 2026-10-05: „immer nur die flächen (derographie, vegetation, topographie) …
deren ansicht gerade aktiv is. seen und meere sollen in allen ansichten sichtbar sein, aber nur in topographie (und alle)
anklickbar.“ Dazu drei Nachträge: <b>der Fluss gehört zum Wasser</b> (also wie See und Meer nur in Topographie und „Alle“
wählbar, gezeichnet samt Namen überall), <b>„Was ist hier?“ nennt nur die aktive Ansicht</b> (der lange Druck am Telefon), und
<b>das Meer ist in „Alle“ normal blau</b> - vorher war es dort blasser als in jeder anderen Ansicht. Links die Küste des Golfs
von Perricum, daneben das Ochsenwasser; beide stehen in jeder Ansicht. Rechts, was ein Klick dort wirklich trifft, im laufenden
Browser gemessen. In „Derographisch“ heißt die Fläche unter dem See ebenfalls Ochsenwasser: Das ist die derographische Region,
nicht der See - der Klick fällt auf sie durch.</p>
${rows
    .map(
        (row) => `<section><h2>${escape(row.title)}</h2>
${picture(row.coast, 420)}${picture(row.lake, 300)}
<table>${PROBES.map(([key, label]) => `<tr><th>${escape(label)}</th><td>${mark(row.hits[key] ?? "—")}</td></tr>`).join(
            "",
        )}</table>
<p class="cap">Küste (Golf von Perricum) · Ochsenwasser</p></section>`,
    )
    .join("\n")}
</body></html>`;
    mkdirSync(OUTPUT, { recursive: true });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
