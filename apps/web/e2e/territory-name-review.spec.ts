import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { AVENTURIA_POLITICAL_CARTOGRAPHY } from "@avesmaps3d/shared";
import { chooseView, openMap, settleFrame } from "./map-handle.ts";
import {
    centreInFreeArea,
    clearSelection,
    clickTerritory,
    measureLabelInk,
    type LabelInk,
    type TerritoryAnchor,
} from "./territory-coat-ink.ts";

/**
 * Abnahmeblatt WI-0121, Nachtrag (Betreiber 2026-10-09): Gebietsnamen größer, Saum lesbarer, und der Klick färbt den
 * VORHANDENEN Namen gelb, statt einen neuen zu setzen. Dieselben Kartenstellen vorher und nachher, ungewählt und gewählt,
 * echte Größe und dreifach, dazu drei Schriftgrößen nebeneinander.
 *
 * 💣 DIESER LAUF PRÜFT NICHTS. Er legt ein Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `e2e/territory-name-select.spec.ts` und `test/territory-name-select.test.ts`.
 *
 * Schritte, jeder ein Aufruf (`BLATT_PHASE`; `nachher-nah` nimmt nur die dreifache Seite neu auf, `zaehlung` zählt die Namen im Bild je Größe):
 *
 *   BLATT_PHASE=vorher  npx playwright test e2e/territory-name-review.spec.ts   (am Stand VOR dem Umbau: nur Aufnahmen)
 *   BLATT_PHASE=nachher npx playwright test e2e/territory-name-review.spec.ts   (am Stand danach: Vorgabe und drei Größen)
 *   BLATT_PHASE=blatt   npx playwright test e2e/territory-name-review.spec.ts   (setzt das Blatt aus den Aufnahmen zusammen)
 *
 * 🪤 Die drei Größen entstehen NICHT aus drei Tafeln, sondern aus demselben Baustein wie die Karte
 * (`buildTerritoryLabelLayer` mit anderer Schrift), live auf die Ebene gelegt; die Vorgabe wird ohne Überschreibung
 * aufgenommen, und das Blatt zeigt, dass beide Wege dasselbe Bild geben.
 *
 * Die Auswahl ist ein echter Mausklick auf die Fläche des Gebiets, an einer Stelle ohne Ort, Weg oder Route.
 *
 * Ablage: `review/wi-0121/nachtrag/<Phase>/…` (Aufnahmen) und `review/wi-0121/nachtrag-blatt.png` (nicht versioniert).
 */

const ROOT = resolve(import.meta.dirname, "../../../review/wi-0121");
const OUT = resolve(ROOT, "nachtrag");
const PHASE = process.env["BLATT_PHASE"] ?? "nachher";
const SIZES = [14.5, 16, 17.5] as const;
const FONT = "FacultyGlyphic-Regular";
const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
const CANON = JSON.parse(readFileSync(resolve(ROOT, "../../config/design-canon/avesmaps.json"), "utf8")) as {
    colour: Record<string, string>;
};

interface Fall {
    id: string;
    titel: string;
    frage: string;
    /** Der Name, wie ihn die Kachel führt. */
    name: string;
    /** Ungefähr, wo er steht (Längen- und Breitengrad der Karte); die Kamera findet ihn von dort aus. */
    nearMap?: { x: number; y: number };
    near?: { lng: number; lat: number };
    zoom: number;
    /** Wie viele Bildpunkte rechts und links vom Anker (echte Größe), und bei der Nahaufnahme (CSS-Pixel, dreifach gezeichnet). */
    halb: { x: number; y: number };
    halbNah: { x: number; y: number };
    /** Breiter Fall: die Bilder stehen zu zweit statt zu viert in einer Zeile. */
    breit?: boolean;
}

const GARETH = { x: 551.625, y: 532.969 };

const FAELLE: Fall[] = [
    {
        id: "greifenfurt",
        titel: "Markgrafschaft Greifenfurt",
        frage: "Das Bild des Betreibers: Wappen über dem Namen, zwei Zeilen. Gewählt muss derselbe Name an derselben Stelle gelb werden.",
        name: "Markgrafschaft Greifenfurt",
        near: { lng: 0.111527, lat: 27.722253 },
        zoom: 4.5,
        halb: { x: 110, y: 100 },
        halbNah: { x: 75, y: 58 },
    },
    {
        id: "rommilyser-mark",
        titel: "Markgrafschaft Rommilyser Mark",
        frage: "Der längere Name bricht in mehr Zeilen; die Zeilenzahl darf sich beim Klick nicht ändern.",
        name: "Markgrafschaft Rommilyser Mark",
        near: { lng: 25.459876, lat: 22.821303 },
        zoom: 4.5,
        halb: { x: 110, y: 110 },
        halbNah: { x: 75, y: 70 },
    },
    {
        id: "kaiserreich",
        titel: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        frage: "Das Beispiel des Betreibers auf grober Stufe (Band 1): Vorher wurde aus dem mehrzeiligen Namen beim Klick ein Einzeiler.",
        name: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        nearMap: GARETH,
        zoom: 2.5,
        halb: { x: 250, y: 100 },
        halbNah: { x: 85, y: 70 },
        breit: true,
    },
    {
        id: "thorwal",
        titel: "Thorwal",
        frage: "Das dunkle Blau: dunkle Schrift mit hellem Saum auf dunkler Fläche, und gewählt Gold auf dunklem Saum.",
        name: "Thorwal",
        near: { lng: -73.0516, lat: 58.6288 },
        zoom: 2,
        halb: { x: 90, y: 80 },
        halbNah: { x: 55, y: 45 },
    },
    {
        id: "baronie",
        titel: "Baronie Adlerflug",
        frage: "Eine Baronie in Band 4: Dichte Namen, kleine Fläche.",
        name: "Baronie Adlerflug",
        near: { lng: 38.733479, lat: 50.517699 },
        zoom: 5.5,
        halb: { x: 90, y: 90 },
        halbNah: { x: 75, y: 60 },
    },
];

interface Messung {
    ruhig: LabelInk;
    gewaehlt: LabelInk;
    /** Wie weit der Anker auf dem Schirm beim Klick wanderte (die Kamera darf nicht fliegen). */
    kameraVersatz: number;
    /** Hat die Auswahl ein zweites Symbol mit dem Namen gesetzt? */
    zweiteEbene: boolean;
}

const bandOf = (zoom: number): number =>
    Math.min(POLITICAL.maxBand, Math.max(0, Math.floor(zoom - 1 + POLITICAL.bandLeadZoom + 1e-9)));

// ---------------------------------------------------------------------------------------------------------------------
// Aufnahmen
// ---------------------------------------------------------------------------------------------------------------------

type Anker = TerritoryAnchor;

/** Die Kamera auf den Namen des Falls: erst grob dorthin, dann den gezeichneten Namen suchen und auf ihn zentrieren. */
async function zeigeFall(page: Page, fall: Fall): Promise<Anker> {
    const nahe = await page.evaluate(
        ({ near, nearMap }) => {
            if (near) return near;
            return globalThis.avesmapsRenderProjection!.toRenderLngLat(nearMap!);
        },
        { near: fall.near, nearMap: fall.nearMap },
    );
    await page.evaluate(
        async ({ lng, lat, zoom }) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({ center: { lng, lat }, zoom });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { lng: nahe.lng, lat: nahe.lat, zoom: fall.zoom },
    );
    await settleFrame(page);
    await page.waitForFunction(
        (name) =>
            globalThis
                .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                .some((feature) => feature.properties["name"] === name),
        fall.name,
        { timeout: 30_000 },
    );
    const anker = await page.evaluate((name) => {
        const feature = globalThis
            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
            .find((candidate) => candidate.properties["name"] === name)!;
        return {
            lng: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            id: String(feature.properties["territory_public_id"]),
        };
    }, fall.name);
    await page.evaluate(
        async ({ lng, lat, zoom }) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({ center: { lng, lat }, zoom });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { lng: anker.lng, lat: anker.lat, zoom: fall.zoom },
    );
    // Der Name steht in der Mitte der freien Fläche zwischen Planer (links) und Infopanel (rechts, erst nach dem Klick).
    await centreInFreeArea(page, anker);
    return anker;
}

/** Wo der Anker auf dem Schirm steht, in CSS-Pixeln der Seite. */
async function schirmpunkt(page: Page, anker: Anker): Promise<{ x: number; y: number }> {
    return page.evaluate(({ lng, lat }) => {
        const map = globalThis.avesmapsMap!;
        const p = map.project({ lng, lat });
        const rect = map.getCanvas().getBoundingClientRect();
        return { x: rect.left + p.x, y: rect.top + p.y };
    }, anker);
}

/**
 * Legt eine andere Schriftgröße auf die Ebene der Namen: derselbe Baustein wie die Karte, nur mit anderer Größe in der Tafel.
 * 🪤 Jeder Stilumbau (Auswahl, Ansicht) setzt die Ebene auf die Tafel zurück; deshalb nach JEDEM Wechsel neu.
 */
async function legeGroesse(page: Page, groesse: number | undefined, gewaehlt: string | undefined): Promise<void> {
    if (groesse === undefined) return;
    await page.evaluate(
        async ({ size, selected, font, look }) => {
            // Der Baustein der Seite selbst: Der Entwicklungsserver reicht dasselbe Modul, das die Karte geladen hat.
            const url = "/src/map/territory-layers.ts";
            const modul = (await import(/* @vite-ignore */ url)) as {
                buildTerritoryLabelLayer(
                    font: string,
                    selected: string | undefined,
                    withCoats: boolean,
                    look: unknown,
                ): { layout: Record<string, unknown>; paint: Record<string, unknown> };
            };
            const ebene = modul.buildTerritoryLabelLayer(font, selected, true, { ...look, sizePx: size });
            const map = globalThis.avesmapsMap as unknown as {
                setLayoutProperty(layer: string, name: string, value: unknown): void;
                setPaintProperty(layer: string, name: string, value: unknown): void;
            };
            for (const name of ["text-size", "text-offset", "text-anchor", "icon-offset", "icon-size"]) {
                map.setLayoutProperty("territory-label", name, ebene.layout[name]);
            }
            for (const [name, value] of Object.entries(ebene.paint))
                map.setPaintProperty("territory-label", name, value);
        },
        { size: groesse, selected: gewaehlt, font: FONT, look: POLITICAL.label },
    );
    await settleFrame(page);
}

async function aufnahme(page: Page, fall: Fall, anker: Anker, seite: "echt" | "nah"): Promise<Buffer> {
    await settleFrame(page);
    await page.waitForTimeout(1200);
    const punkt = await schirmpunkt(page, anker);
    const halb = seite === "echt" ? fall.halb : fall.halbNah;
    return page.screenshot({
        clip: {
            x: Math.round(punkt.x - halb.x),
            y: Math.round(punkt.y - halb.y),
            width: halb.x * 2,
            height: halb.y * 2,
        },
    });
}

function ablage(phase: string): string {
    const ordner = resolve(OUT, phase);
    mkdirSync(ordner, { recursive: true });
    return ordner;
}

async function nimmAuf(browser: Browser, baseURL: string, seite: "echt" | "nah", phasen: (number | undefined)[]) {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: seite === "echt" ? 1 : 3,
        extraHTTPHeaders: { "x-forwarded-for": seite === "echt" ? "10.77.0.91" : "10.77.0.92" },
    });
    const page = await context.newPage();
    const messungen = new Map<string, Record<string, Messung>>();
    try {
        await openMap(page);
        await chooseView(page, "political");
        for (const fall of FAELLE) {
            await clearSelection(page);
            const anker = await zeigeFall(page, fall);
            for (const groesse of phasen) {
                const phase =
                    groesse === undefined ? (PHASE === "vorher" ? "vorher" : "nachher") : `g${String(groesse)}`;
                const ordner = ablage(phase);
                // Ungewählt.
                await clearSelection(page);
                await legeGroesse(page, groesse, undefined);
                writeFileSync(
                    resolve(ordner, `${fall.id}-ruhig-${seite}.png`),
                    await aufnahme(page, fall, anker, seite),
                );
                let ruhig: LabelInk | undefined;
                if (seite === "echt") {
                    ruhig = await measureLabelInk(page, "territory-label", anker, {
                        only: anker.id,
                        radius: 130,
                        withHalo: PHASE !== "vorher",
                    });
                }
                // Gewählt: ein echter Klick.
                const davor = await schirmpunkt(page, anker);
                await clickTerritory(page, anker);
                await legeGroesse(page, groesse, anker.id);
                writeFileSync(
                    resolve(ordner, `${fall.id}-gewaehlt-${seite}.png`),
                    await aufnahme(page, fall, anker, seite),
                );
                if (seite === "echt") {
                    const danach = await schirmpunkt(page, anker);
                    const zweite = await page.evaluate(
                        () =>
                            (
                                globalThis.avesmapsMap as unknown as {
                                    getStyle(): { sources: Record<string, { data?: { features: unknown[] } }> };
                                }
                            ).getStyle().sources["area-selection-label"]?.data?.features.length ?? 0,
                    );
                    const gewaehlt = await measureLabelInk(
                        page,
                        PHASE === "vorher" ? "area-selection-label" : "territory-label",
                        anker,
                        PHASE === "vorher" ? { radius: 330 } : { only: anker.id, radius: 130, withHalo: true },
                    );
                    const eintrag: Messung = {
                        ruhig: ruhig!,
                        gewaehlt,
                        kameraVersatz: Math.hypot(danach.x - davor.x, danach.y - davor.y),
                        zweiteEbene: zweite > 0,
                    };
                    const bisher = messungen.get(phase) ?? {};
                    bisher[fall.id] = eintrag;
                    messungen.set(phase, bisher);
                }
            }
            await clearSelection(page);
        }
        for (const [phase, daten] of messungen) {
            writeFileSync(resolve(ablage(phase), "messung.json"), JSON.stringify(daten, null, 2));
        }
    } finally {
        await context.close();
    }
}

/** Wie viele Namen im Bild stehen, je Schriftgröße und Band: Größere Schrift kollidiert eher, und was nicht Platz hat, wird verworfen. */
type Zaehlung = Record<string, Record<string, number>>;

const ZAEHL_GROESSEN = [13.3, ...SIZES] as const;
/** Sechs Ausschnitte in und um Mittelaventurien, dicht an Gareth, in jedem Band mit Namen; gezählt wird die Summe. */
const ZAEHL_ORTE = [
    GARETH,
    { x: 512, y: 594 },
    { x: 622, y: 679 },
    { x: 584, y: 579 },
    { x: 420, y: 640 },
    { x: 700, y: 520 },
];
const ZAEHL_ZOOMS = [2.5, 3.5, 4.5, 5.5, 6.5];

async function zaehle(browser: Browser, baseURL: string): Promise<void> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: { "x-forwarded-for": "10.77.0.94" },
    });
    const page = await context.newPage();
    const ergebnis: Zaehlung = {};
    try {
        await openMap(page);
        await chooseView(page, "political");
        for (const groesse of ZAEHL_GROESSEN) {
            ergebnis[String(groesse)] = {};
            for (const zoom of ZAEHL_ZOOMS) {
                let summe = 0;
                for (const ort of ZAEHL_ORTE) {
                    await page.evaluate(
                        async ({ at, level }) => {
                            const map = globalThis.avesmapsMap!;
                            const projection = globalThis.avesmapsRenderProjection!;
                            map.jumpTo({ center: projection.toRenderLngLat(at), zoom: level });
                            await new Promise<void>((resolve) => map.once("idle", resolve));
                        },
                        { at: ort, level: zoom },
                    );
                    await settleFrame(page);
                    await legeGroesse(page, groesse, undefined);
                    await page.waitForTimeout(1200);
                    await settleFrame(page);
                    // Die Namen, die MapLibre setzt: jedes Gebiet einmal (ein Name kann in zwei Kacheln stehen).
                    summe += await page.evaluate(
                        () =>
                            new Set(
                                globalThis
                                    .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                                    .map((feature) => feature.properties["territory_public_id"]),
                            ).size,
                    );
                }
                ergebnis[String(groesse)]![String(zoom)] = summe;
            }
        }
    } finally {
        await context.close();
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, "zaehlung.json"), JSON.stringify(ergebnis, null, 2));
}

// ---------------------------------------------------------------------------------------------------------------------
// Blatt
// ---------------------------------------------------------------------------------------------------------------------

const zahl = (wert: number | undefined, stellen = 1): string =>
    wert === undefined || !Number.isFinite(wert)
        ? "—"
        : (Math.abs(wert) < 0.5 * 10 ** -stellen ? 0 : wert).toFixed(stellen).replace(".", ",");

function datei(phase: string, id: string, zustand: "ruhig" | "gewaehlt", seite: "echt" | "nah"): string | undefined {
    const pfad = resolve(OUT, phase, `${id}-${zustand}-${seite}.png`);
    return existsSync(pfad) ? `data:image/png;base64,${readFileSync(pfad).toString("base64")}` : undefined;
}

function messung(phase: string): Record<string, Messung> | undefined {
    const pfad = resolve(OUT, phase, "messung.json");
    return existsSync(pfad) ? (JSON.parse(readFileSync(pfad, "utf8")) as Record<string, Messung>) : undefined;
}

const bild = (src: string | undefined, beschriftung: string): string =>
    `<figure><figcaption>${beschriftung}</figcaption>${src ? `<img src="${src}" alt="">` : `<div class="leer">fehlt</div>`}</figure>`;

const mitteVon = (ink: LabelInk["text"]): { x: number; y: number } => ({
    x: (ink.x0 + ink.x1) / 2,
    y: (ink.y0 + ink.y1) / 2,
});

function messzeile(m: Messung | undefined): string {
    if (!m) return `<td colspan="5">—</td>`;
    const a = mitteVon(m.ruhig.text);
    const b = mitteVon(m.gewaehlt.text);
    const hoeheA = m.ruhig.text.y1 - m.ruhig.text.y0;
    const hoeheB = m.gewaehlt.text.y1 - m.gewaehlt.text.y0;
    const gleich = Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(hoeheA - hoeheB) <= 1;
    return `<td>${zahl(b.x - a.x)} px</td><td>${zahl(b.y - a.y)} px</td><td>${zahl(hoeheA, 0)} px → ${zahl(hoeheB, 0)} px</td><td>${m.zweiteEbene ? "ja" : "nein"}</td><td class="${gleich ? "ok" : "bad"}">${gleich ? "an derselben Stelle" : "verschoben"}</td>`;
}

/** Die Zählung der Namen im Bild, je Schriftgröße (Spalten) und Zoom (Zeilen); leer, wo sie nicht aufgenommen ist. */
function zaehlTabelle(): string {
    const pfad = resolve(OUT, "zaehlung.json");
    if (!existsSync(pfad)) return "";
    const daten = JSON.parse(readFileSync(pfad, "utf8")) as Zaehlung;
    // Nach der Größe geordnet: Ganzzahlige Schlüssel (16) stünden in der Aufzählung eines Objekts sonst vor den Kommazahlen.
    const groessen = Object.keys(daten).sort((a, b) => Number(a) - Number(b));
    const zeilen = ZAEHL_ZOOMS.map((zoom) => {
        const werte = groessen.map((g) => daten[g]?.[String(zoom)]);
        const basis = werte[0];
        return `<tr><td>Zoom ${zahl(zoom)} (Band ${String(bandOf(zoom))})</td>${werte
            .map(
                (wert, index) =>
                    `<td>${String(wert ?? "—")}${index > 0 && basis ? ` <span class="klein">(${wert! >= basis ? "+" : "−"}${String(Math.abs(Math.round(((wert! - basis) / basis) * 100)))} %)</span>` : ""}</td>`,
            )
            .join("")}</tr>`;
    }).join("\n");
    return `<h2>Wie viele Namen im Bild bleiben</h2>
<p class="frage">Größere Schrift könnte eher kollidieren, und was nicht Platz hat, wird verworfen (größere Fläche zuerst). Gezählt ist, ob das geschieht: Gezählt sind die Gebiete, deren Namen MapLibre setzt, summiert über sechs Ausschnitte in Mittelaventurien (je 1280 × 720, um Gareth, Greifenfurt, Adlerflug, Rommilyser Mark und zwei weitere Stellen); in Klammern der Unterschied zu Legacys 13,3 px.</p>
<table><tr><th></th>${groessen.map((g) => `<th>${zahl(Number(g))} px${Number(g) === 13.3 ? " (Legacy)" : Number(g) === 16 ? " (Vorgabe)" : ""}</th>`).join("")}</tr>
${zeilen}
</table>`;
}

function baueBlatt(baseURL: string): string {
    const colour = CANON.colour;
    const vorher = messung("vorher");
    const nachher = messung("nachher");
    const faelle = FAELLE.map((fall, index) => {
        const band = bandOf(fall.zoom);
        const reihe = (seite: "echt" | "nah", css: string): string => `
<div class="reihe ${css}">
${bild(datei("vorher", fall.id, "ruhig", seite), "vorher · ungewählt")}
${bild(datei("vorher", fall.id, "gewaehlt", seite), "vorher · gewählt")}
${bild(datei("nachher", fall.id, "ruhig", seite), "nachher · ungewählt")}
${bild(datei("nachher", fall.id, "gewaehlt", seite), "nachher · gewählt")}
</div>`;
        // Echte Größe: sechs Bilder in einer Zeile (ungewählt, gewählt je Größe). Dreifach: zwei Zeilen zu je drei Bildern.
        const groessen = (seite: "echt" | "nah"): string =>
            seite === "echt"
                ? `<div class="reihe sechs${fall.breit ? " breit" : ""}">${SIZES.map(
                      (g) =>
                          bild(datei(`g${String(g)}`, fall.id, "ruhig", seite), `${zahl(g)} px · ungewählt`) +
                          bild(datei(`g${String(g)}`, fall.id, "gewaehlt", seite), `${zahl(g)} px · gewählt`),
                  ).join("\n")}</div>`
                : (["ruhig", "gewaehlt"] as const)
                      .map(
                          (zustand) =>
                              `<div class="reihe drei">${SIZES.map((g) =>
                                  bild(
                                      datei(`g${String(g)}`, fall.id, zustand, seite),
                                      `${zahl(g)} px · ${zustand === "ruhig" ? "ungewählt" : "gewählt"}`,
                                  ),
                              ).join("\n")}</div>`,
                      )
                      .join("\n");
        return `
<h2>${String(index + 1)} · ${fall.titel} <span>· Zoom ${zahl(fall.zoom)} (Band ${String(band)})</span></h2>
<p class="frage">${fall.frage}</p>
<p class="cap2">Echte Größe</p>
${reihe("echt", fall.breit ? "zwei echt" : "vier")}
<p class="cap2">Dreifache Nahaufnahme</p>
${reihe("nah", fall.breit ? "zwei" : "vier")}
<p class="cap2">Drei Schriftgrößen, echte Größe (Band ${String(band)}; 16 px ist die Vorgabe)</p>
${groessen("echt")}
<p class="cap2">Drei Schriftgrößen, dreifach</p>
${groessen("nah")}
<table>
<tr><th>Gewählt gegen ungewählt, am Bild gemessen (Mitte der Tinte samt Saum)</th><th>Versatz x</th><th>Versatz y</th><th>Höhe des Namens</th><th>zweites Symbol</th><th></th></tr>
<tr><td>vorher</td>${messzeile(vorher?.[fall.id])}</tr>
<tr><td>nachher</td>${messzeile(nachher?.[fall.id])}</tr>
</table>`;
    }).join("\n");

    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1700px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 12px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1200px; }
h2 { margin: 40px 0 4px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.frage { margin: 0 0 10px; color: ${colour["textMuted"]}; font-size: 13px; }
.cap2 { margin: 14px 0 4px; font-size: 12px; color: ${colour["textMuted"]}; }
.reihe { display: grid; gap: 8px 18px; align-items: start; }
.vier { grid-template-columns: repeat(4, max-content); }
.zwei { grid-template-columns: repeat(2, max-content); }
.sechs { grid-template-columns: repeat(6, max-content); }
.drei { grid-template-columns: repeat(3, max-content); margin-bottom: 8px; }
/* Der breite Fall ist breiter aufgenommen: In den Größenvergleichen zeigt er die Mitte des Bildes in einem Feld wie die übrigen. */
.sechs.breit img { width: 220px; height: 200px; object-fit: none; object-position: 50% 50%; }
/* Der breite Fall zeigt die mittleren 400 Bildpunkte: Rechts neben der Mitte liegt der Knopf des Auge-Menüs, der nicht zur Sache gehört. */
.zwei.echt img { width: 400px; height: 200px; object-fit: none; object-position: 50% 50%; }
figure { margin: 0; }
figcaption { margin: 0 0 4px; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; }
.leer { border: 1px dashed ${colour["border"]}; padding: 30px 20px; color: ${colour["textMuted"]}; }
table { border-collapse: collapse; margin: 14px 0 0; font-size: 12.5px; }
th, td { padding: 2px 22px 2px 0; text-align: left; font-weight: 400; }
th { color: ${colour["textMuted"]}; }
.ok { color: #2f7d32; } .bad { color: #b3261e; } .klein { color: ${colour["textMuted"]}; font-size: 11.5px; }
.note { margin: 30px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1200px; }
</style></head><body>
<h1>Gebietsnamen: größer, besser lesbar, beim Klick nur gelb</h1>
<p class="lead">WI-0121 Nachtrag · Ansicht „Politisch“ · dieselben Kartenstellen vorher und nachher, ungewählt und gewählt (echter Mausklick auf die Fläche),
echte Größe und dreifach. Die Messung unter jedem Fall liegt am gezeichneten Bild: die Mitte der Tinte (samt Saum) des Namens, ungewählt gegen gewählt.</p>
<p class="note"><b>Was zu sehen ist.</b> (1) <b>Vorher</b> setzt der Klick einen NEUEN Namen: einzeilig in 22 px, breiter als die Fläche, mit einer zweiten Zeile für das Obergebiet, an anderer Stelle (Spalte „vorher · gewählt“, die Messung zeigt den Sprung). <b>Nachher</b> bleibt derselbe Name stehen, mit demselben Umbruch, an derselben Stelle, mit Wappen - nur gelb (Messung: Abweichung 0 px, kein zweites Symbol).
(2) Die Schrift steht größer (Vorgabe 16 px statt Legacys 13,3), der Saum ist ein fast scharfer, deckender Rand statt der weichen grauen Wolke. Das Wappen bleibt 40 px, die Lücke zur Schrift bleibt 8,85 px.
(3) <b>Drei Größen</b> (14,5 / 16 / 17,5 px, jeweils mit dem neuen Saum): <b>Empfehlung 16 px</b>, als Vorgabe eingebaut. 14,5 ist kaum von Legacys 13,3 zu unterscheiden. 17,5 liest sich noch etwas besser und kostet nach der Zählung unten keinen Platz (die Gebietsnamen kollidieren kaum), macht die Blöcke aus Wappen und Namen aber höher und das Wappen im Verhältnis kleiner: zwischen 16 und 17,5 ist es eine Frage des Geschmacks, nicht des Platzes.
<b>Bewusst nicht gebaut:</b> ein Ersatzname, wenn der Name eines Gebiets im Bild verdrängt ist (wie bei den Landschaften); dann leuchtet nur die Fläche, das Infopanel nennt das Gebiet.</p>
${zaehlTabelle()}
${faelle}
</body></html>`;
}

test(`Abnahmeblatt WI-0121 Nachtrag: ${PHASE}`, async ({ browser }, testInfo) => {
    test.setTimeout(1_800_000);
    const baseURL = String(testInfo.project.use.baseURL);
    if (PHASE === "blatt") {
        mkdirSync(ROOT, { recursive: true });
        const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1764, height: 1000 } });
        const sheet = await sheetContext.newPage();
        await sheet.route("**/__wi0121n.html", (route) =>
            route.fulfill({ contentType: "text/html; charset=utf-8", body: baueBlatt(baseURL) }),
        );
        await sheet.goto("/__wi0121n.html");
        await sheet.evaluate(() => document.fonts.ready);
        await sheet.waitForTimeout(500);
        await sheet.screenshot({ path: resolve(ROOT, "nachtrag-blatt.png"), fullPage: true });
        await sheetContext.close();
        return;
    }
    if (PHASE === "zaehlung") {
        await zaehle(browser, baseURL);
        return;
    }
    const phasen: (number | undefined)[] = PHASE === "vorher" ? [undefined] : [undefined, ...SIZES];
    // `nachher-nah` nimmt nur die dreifache Seite des Standes nach dem Umbau neu auf (anderer Ausschnitt, ohne den Vorher-Stand zu brauchen).
    if (PHASE !== "nachher-nah") await nimmAuf(browser, baseURL, "echt", phasen);
    await nimmAuf(browser, baseURL, "nah", phasen);
});
