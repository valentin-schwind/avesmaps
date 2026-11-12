import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { onPage, settleFrame } from "./map-handle.ts";

/**
 * Abnahmeblatt einer neuen Fassung des Geländerezepts (WI-0067, Betreiber 2026-10-10: „Radius D16 mit Sättigung 10 ->
 * aber als neue Version“): die Kämme, an denen Prototyp D vor der Nachstimmung bis 2.500 Schritt wuchs, und das
 * Flachland, dessen Höhenstufen sich verschieben (`project-control/discovery/d-regionale-erosion-2026-10-09.md`).
 *
 * 💣 Ein Blatt, kein Test (AGENTS.md, WI-0123). Die `expect` bewachen nur das Bild: Gelände aus dem Domain-DEM, beim
 * Flachland die Höhenstufen der aktuellen Revision, kein Seitenfehler.
 *
 * Zwei Durchgänge, weil „vorher“ und „nachher“ zwei Stände der DATEN sind, nicht des Codes. Der alte Master wird lokal
 * bei der Ableitung sofort gelöscht (`derive:terrain --only-current`), das Vorher geht also nur VOR der Ableitung:
 *
 *   $env:AVM_BLATT_PHASE = "vorher";  npm run review:gelaende-rezept     # vor derive:terrain
 *   $env:AVM_BLATT_PHASE = "nachher"; npm run review:gelaende-rezept     # nach derive:terrain UND derive:display-heights
 *
 * Ablage `review/wi-0067/rezept/` (nicht versioniert), mit `AVM_BLATT_DIR` an einen anderen Ort, etwa wenn Vorher und
 * Nachher aus verschiedenen Arbeitsbäumen kommen. Das Blatt `blatt.png` entsteht im Nachher-Durchgang. Es nennt die
 * Revisionen beider Stände; sind sie gleich, sagt es das, statt zweimal dasselbe Bild als Vergleich zu zeigen.
 */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

const OUTPUT = process.env["AVM_BLATT_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0067/rezept");
const PHASE = process.env["AVM_BLATT_PHASE"] === "vorher" ? "vorher" : "nachher";
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

/** Aufgenommen und gezeigt in echter Größe; die Nahaufnahme ist dieselbe Mitte, dreifach (Zoom + log2 3). */
const SHOT = { width: 620, height: 400 };
const CLOSER = Math.log2(3);

/**
 * Die Stellen (Koordinaten wie im Messblatt der Nachstimmung). Kämme geneigt in „Alle“, damit Relief und Schatten
 * tragen; das Flachland von oben in den Höhenstufen, weil dort die Grenzen 100 und 200 wandern.
 */
const PLACES = [
    {
        key: "hjaldorberge",
        title: "Kamm: Hjaldorberge bei Thorwal",
        note: "Messung: höchster Kamm heute 5.202 Schritt; D16 ohne Nachstimmung +2.488, Fassung 18 +340.",
        x: 296,
        y: 662,
        zoom: 6.5,
        pitch: 55,
        layer: "alle",
    },
    {
        key: "amboss",
        title: "Kamm: Amboss",
        note: "Messung: höchster Kamm heute 4.620 Schritt; D16 ohne Nachstimmung +1.381, Fassung 18 −46.",
        x: 495,
        y: 476,
        zoom: 6.5,
        pitch: 55,
        layer: "alle",
    },
    {
        key: "orkland",
        title: "Kamm: Berge zum Orkland",
        note: "Messung: Westliche Berge heute 5.338 Schritt; D16 ohne Nachstimmung rund +1.200, Fassung 18 +127 bis +156.",
        x: 478,
        y: 608,
        zoom: 6,
        pitch: 55,
        layer: "alle",
    },
    {
        key: "weiden",
        title: "Flachland: Weiden, Höhenstufen",
        note: "Messung: die Höhenstufe wechselt an rund 4 % der Landpixel; der Norden liegt rund 20 Schritt höher.",
        x: 575,
        y: 625,
        zoom: 6,
        pitch: 0,
        layer: "topographie",
    },
    {
        key: "garetien",
        title: "Flachland: Garetien bei Gareth, Höhenstufen",
        note: "Gegenprobe im Flachland der Mitte (Messung: Mitte im Mittel rund 20 Schritt höher).",
        x: 540,
        y: 560,
        zoom: 6,
        pitch: 0,
        layer: "topographie",
    },
] as const;

type Place = (typeof PLACES)[number];
type Scale = "echt" | "nah";

const shotName = (place: Place["key"], scale: Scale): string => `${place}-${scale}.png`;

interface Stand {
    dem: string;
    heights: string;
    at: string;
}

/** Die Stände, die das Bild zeigt: DEM-Revision und Anzeigehöhen (404 heißt: zum Gelände noch nicht abgeleitet). */
async function readStand(page: Page): Promise<Stand> {
    return page.evaluate(async () => {
        const dem = await fetch("/tiles/terrain/dem/current.json");
        const heights = await fetch("/tiles/terrain/display-height/current.json");
        const revision = async (response: Response): Promise<string> =>
            response.ok
                ? String(((await response.json()) as { revision?: unknown }).revision)
                : `HTTP ${response.status}`;
        return { dem: await revision(dem), heights: await revision(heights), at: new Date().toISOString() };
    });
}

async function show(page: Page, place: Place, zoom: number, round: number): Promise<void> {
    const topo = place.layer === "topographie" ? "&topo=hoehenstufen" : "";
    const pitch = place.pitch > 0 ? `&p=${String(place.pitch)}` : "";
    await page.goto(
        `/?r=${String(round)}#x=${String(place.x)}&y=${String(place.y)}&z=${zoom.toFixed(2)}` +
            `&series=original&view=landscapes&layer=${place.layer}${topo}${pitch}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    if (place.pitch > 0) {
        // Gelände erst ab einer Neigung (`installTerrain`); von oben trägt die Schattierung nichts.
        const terrain = await page.evaluate(
            () =>
                (globalThis.avesmapsMap as unknown as { getTerrain(): { source: string } | null }).getTerrain()?.source,
        );
        expect(terrain, "Gelände aus dem Domain-DEM (braucht eine Grafikkarte)").toBe("gelaende-dem");
    }
    if (place.layer === "topographie") {
        const ids = await page.evaluate(() =>
            (globalThis.avesmapsMap as unknown as { getStyle(): { layers: { id: string }[] } })
                .getStyle()
                .layers.map((layer) => layer.id),
        );
        expect(ids, "Höhenstufen gezeichnet (derive:display-heights zum aktuellen Gelände)").toContain("hoehenstufen");
    }
    await settleFrame(page);
    await page.addStyleTag({ content: ".corner, .panel, [data-map-overlay] { visibility: hidden !important; }" });
    await settleFrame(page);
}

/** Ein Ausschnitt um die sichtbare Mitte der Karte. */
async function crop(page: Page): Promise<Buffer> {
    const middle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const at = map.project(map.getCenter());
        return { x: Math.round(at.x), y: Math.round(at.y) };
    });
    const at = await onPage(page, middle);
    return page.screenshot({
        clip: { x: at.x - SHOT.width / 2, y: at.y - SHOT.height / 2, width: SHOT.width, height: SHOT.height },
    });
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test(`Abnahmeblatt Geländerezept: Kämme und Flachland (${PHASE})`, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const directory = resolve(OUTPUT, PHASE);
    mkdirSync(directory, { recursive: true });
    await page.goto("/");
    const stand = await readStand(page);
    writeFileSync(resolve(directory, "stand.json"), JSON.stringify(stand, null, 4) + "\n");
    const shots = new Map<string, Buffer>();
    let round = 0;
    for (const place of PLACES) {
        for (const [scale, zoom] of [
            ["echt", place.zoom],
            ["nah", place.zoom + CLOSER],
        ] as const) {
            round += 1;
            await show(page, place, zoom, round);
            const png = await crop(page);
            shots.set(shotName(place.key, scale), png);
            writeFileSync(resolve(directory, shotName(place.key, scale)), png);
        }
    }
    expect(errors).toEqual([]);
    if (PHASE === "vorher") {
        testInfo.annotations.push({ type: "Blatt", description: `Vorher-Ausschnitte in ${directory}` });
        return;
    }

    const beforeDir = resolve(OUTPUT, "vorher");
    const beforeStand = existsSync(resolve(beforeDir, "stand.json"))
        ? (JSON.parse(readFileSync(resolve(beforeDir, "stand.json"), "utf8")) as Stand)
        : undefined;
    const picture = (png: Buffer): string =>
        `<img width="${String(SHOT.width)}" height="${String(SHOT.height)}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const before = (place: Place["key"], scale: Scale): string => {
        const file = resolve(beforeDir, shotName(place, scale));
        return existsSync(file) ? picture(readFileSync(file)) : `<p class="fehlt">kein Vorher-Bild</p>`;
    };
    const standLine = (label: string, value: Stand | undefined): string =>
        value === undefined
            ? `${label}: nicht aufgenommen`
            : `${label}: DEM ${escape(value.dem)}, Anzeigehöhen ${escape(value.heights)}, ${escape(value.at)}`;
    const same = beforeStand !== undefined && beforeStand.dem === stand.dem;
    const colour = CANON.colour;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(testInfo.project.use.baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 30px 34px; width: 1340px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 6px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1280px; }
.warn { margin: 0 0 12px; font-size: 13px; color: ${colour["textStrong"]}; }
section { padding: 12px 0 16px; border-top: 1px solid ${colour["border"]}; }
h2 { margin: 0 0 2px; font-size: 17px; font-weight: 400; color: ${colour["textStrong"]}; }
.note { margin: 0 0 10px; font-size: 12px; color: ${colour["textMuted"]}; }
table { border-collapse: collapse; }
th { text-align: left; font-weight: 400; font-size: 12px; color: ${colour["textMuted"]}; padding: 0 12px 4px 0; }
td { padding: 0 12px 6px 0; vertical-align: top; }
td.lab { font-size: 12px; color: ${colour["textMuted"]}; padding-right: 10px; white-space: nowrap; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 5px; }
.fehlt { margin: 0; width: ${String(SHOT.width)}px; height: ${String(SHOT.height)}px; display: flex;
    align-items: center; justify-content: center; border: 1px dashed ${colour["border"]}; border-radius: 5px;
    font-size: 12px; color: ${colour["textMuted"]}; }
</style></head><body>
<h1>Geländerezept: neue Fassung, Kämme und Flachland</h1>
<p class="lead">WI-0067, Betreiber 2026-10-10: „Radius D16 mit Sättigung 10 -&gt; aber als neue Version“. Je Stelle oben
der alte, unten der neue Stand, links in echter Größe, rechts dieselbe Mitte dreifach. Kämme geneigt in „Alle“,
Flachland von oben in den Höhenstufen. Die Zahlen unter den Titeln sind die Messung der Nachstimmung, nicht dieses Bild.</p>
<p class="lead">${standLine("vorher", beforeStand)}<br>${standLine("nachher", stand)}</p>
${same ? `<p class="warn">Vorher und nachher zeigen dieselbe DEM-Revision: Das Blatt vergleicht nichts.</p>` : ""}
${PLACES.map(
    (place) => `<section><h2>${escape(place.title)}</h2><p class="note">${escape(place.note)}</p>
<table><tr><th></th><th>echte Größe</th><th>dreifach</th></tr>
<tr><td class="lab">vorher</td><td>${before(place.key, "echt")}</td><td>${before(place.key, "nah")}</td></tr>
<tr><td class="lab">nachher</td><td>${picture(shots.get(shotName(place.key, "echt")) ?? Buffer.alloc(0))}</td>
<td>${picture(shots.get(shotName(place.key, "nah")) ?? Buffer.alloc(0))}</td></tr>
</table></section>`,
).join("\n")}
</body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
