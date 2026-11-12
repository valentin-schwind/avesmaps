import { writeFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { stubReisebilder, stubReisebilderKarte, type KartenBild } from "./reisebild-stub.ts";
import { GARETH, openMap, settleFrame, showPlace } from "./map-handle.ts";

/**
 * Die Lastmessung der Reisebilder auf der Karte (WI-0272 S4, Aufgabe 31). Läuft NUR namentlich (`*-review.spec.ts`, nicht im Release-Teil `browser-4`): Sie misst, sie prüft keine Funktion.
 *
 * Methode nach `memory/frametimes-messen`: je Ebene die `gl.drawElements`-Indizes (`map.painter.drawFunctions` merkt die Ebene), die GPU-Zeit mit `EXT_disjoint_timer_query_webgl2` über 30 dicht
 * aufeinanderfolgende `map.redraw()` (die zweite Hälfte zählt), die Gegenprobe mit `?ohne=photobox` (nur im Entwicklungsbau), das Bündeln mit `performance.now()` (der Entwicklungsbau sammelt die
 * Zeiten in `avesmapsBuendelMs`), und die Ruhe als Zahl der `setData`-Aufrufe in 3 s Stillstand.
 *
 * Grenzen (Plan Aufgabe 31): Anteil der `photobox-*`-Ebenen an den Indizes höchstens 1 %; Zuwachs der GPU-Zeit höchstens 1 ms je Bild; Bündeln im 95. Perzentil höchstens 4 ms; in Ruhe kein `setData`.
 * Reißt eine Grenze, steht sie im Bericht, nicht in einem angepassten Wert. Ergebnis: `test-results/reisebild-last.json`.
 */

test.use({
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"] },
});

/** Eine Zahl, die deterministisch streut (kein Zufall: Dieselben Bilder bei jedem Lauf). */
function streuer(saat: number): () => number {
    let wert = saat;
    return () => {
        wert = (wert * 1664525 + 1013904223) % 4294967296;
        return wert / 4294967296;
    };
}

/** 500 Bilder: die Hälfte über Aventurien verteilt, die Hälfte dicht um Gareth. */
function fuenfhundert(): KartenBild[] {
    const zufall = streuer(272);
    const bilder: KartenBild[] = [];
    for (let n = 0; n < 500; n += 1) {
        const nah = n % 2 === 1;
        const x = nah ? GARETH.x + (zufall() - 0.5) * 120 : 150 + zufall() * 750;
        const y = nah ? GARETH.y + (zufall() - 0.5) * 120 : 150 + zufall() * 700;
        bilder.push({
            id: `00000000-0000-4000-8000-${String(900000000000 + n)}`,
            lage: { x, y },
            entstehung: n % 5 === 0 ? "ai_generated" : "drawing",
        });
    }
    return bilder;
}

interface Messung {
    readonly ansicht: string;
    readonly leiste: "zu" | "offen";
    readonly gesamtIndizes: number;
    readonly photoboxIndizes: number;
    readonly photoboxEbenen: Record<string, number>;
    readonly gpuMs: number | null;
    readonly cpuMs: number;
    readonly buendelP95: number | null;
    readonly buendelAnzahl: number;
    readonly buendelZoomP95: number | null;
    readonly buendelZoomAnzahl: number;
    readonly setDataInRuhe: number;
    readonly gruppen: number;
}

/** Misst die laufende Ansicht: Indizes je Ebene, GPU- und CPU-Zeit je Bild. */
async function misseBild(
    page: Page,
): Promise<Pick<Messung, "gesamtIndizes" | "photoboxIndizes" | "photoboxEbenen" | "gpuMs" | "cpuMs">> {
    return page.evaluate(async () => {
        const map = globalThis.avesmapsMap as unknown as {
            painter: {
                context: { gl: WebGL2RenderingContext };
                drawFunctions: Record<string, (...a: unknown[]) => unknown>;
            };
            redraw(): void;
        };
        const gl = map.painter.context.gl;
        const gemerkt = globalThis as unknown as { __messung?: { aktuell: string; indizes: Map<string, number> } };
        if (gemerkt.__messung === undefined) {
            const zustand = { aktuell: "(keine)", indizes: new Map<string, number>() };
            gemerkt.__messung = zustand;
            const original = gl.drawElements.bind(gl);
            gl.drawElements = (mode: number, count: number, type: number, offset: number): void => {
                zustand.indizes.set(zustand.aktuell, (zustand.indizes.get(zustand.aktuell) ?? 0) + count);
                original(mode, count, type, offset);
            };
            for (const [typ, funktion] of Object.entries(map.painter.drawFunctions)) {
                map.painter.drawFunctions[typ] = (...args: unknown[]): unknown => {
                    const vorher = zustand.aktuell;
                    zustand.aktuell = (args[2] as { id?: string } | undefined)?.id ?? typ;
                    try {
                        return funktion(...args);
                    } finally {
                        zustand.aktuell = vorher;
                    }
                };
            }
        }
        const zustand = gemerkt.__messung;
        zustand.indizes.clear();
        map.redraw();
        const indizes = new Map(zustand.indizes);
        let gesamt = 0;
        let photobox = 0;
        const ebenen: Record<string, number> = {};
        for (const [id, zahl] of indizes) {
            gesamt += zahl;
            if (id.startsWith("photobox-")) {
                photobox += zahl;
                ebenen[id] = zahl;
            }
        }
        // CPU: 30 Bilder dicht hintereinander, die zweite Hälfte zählt.
        const cpu: number[] = [];
        for (let i = 0; i < 30; i += 1) {
            const t0 = performance.now();
            map.redraw();
            gl.finish();
            cpu.push(performance.now() - t0);
        }
        const cpuMs = cpu.slice(15).reduce((a, b) => a + b, 0) / 15;
        // GPU: eine Abfrage je Bild.
        let gpuMs: number | null = null;
        const erweiterung = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
            TIME_ELAPSED_EXT: number;
            GPU_DISJOINT_EXT: number;
        } | null;
        if (erweiterung !== null) {
            gl.getParameter(erweiterung.GPU_DISJOINT_EXT);
            const abfragen: WebGLQuery[] = [];
            for (let i = 0; i < 30; i += 1) {
                const abfrage = gl.createQuery();
                gl.beginQuery(erweiterung.TIME_ELAPSED_EXT, abfrage);
                map.redraw();
                gl.endQuery(erweiterung.TIME_ELAPSED_EXT);
                abfragen.push(abfrage);
            }
            for (let warte = 0; warte < 60; warte += 1) {
                if (abfragen.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) === true)) break;
                await new Promise((fertig) => setTimeout(fertig, 50));
            }
            const gestoert = gl.getParameter(erweiterung.GPU_DISJOINT_EXT) === true;
            if (!gestoert && abfragen.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) === true)) {
                const zeiten = abfragen.map((q) => Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
                gpuMs = zeiten.slice(15).reduce((a, b) => a + b, 0) / 15;
            }
        }
        return { gesamtIndizes: gesamt, photoboxIndizes: photobox, photoboxEbenen: ebenen, gpuMs, cpuMs };
    });
}

/** Die Zeiten des Bündelns über 40 kleine Zoomschritte (je einer im Takt). */
/** Die Zeiten nur aus dem laufenden Zoomen: Dort zählt die Grenze, denn dort läuft das Bündeln im Takt neben den Bildern der Karte. */
async function misseBuendelnImZoom(page: Page): Promise<{ p95: number | null; anzahl: number }> {
    await page.evaluate(() => {
        (globalThis as unknown as { avesmapsBuendelZoomMs?: number[] }).avesmapsBuendelZoomMs = [];
    });
    for (const richtung of [0.6, -0.6, 0.6, -0.6]) {
        await page.evaluate((d) => {
            const map = globalThis.avesmapsMap!;
            map.easeTo({ zoom: map.getZoom() + d, duration: 2500 });
        }, richtung);
        await page.waitForTimeout(2800);
    }
    return page.evaluate(() => {
        const zeiten = [
            ...((globalThis as unknown as { avesmapsBuendelZoomMs?: number[] }).avesmapsBuendelZoomMs ?? []),
        ].sort((a, b) => a - b);
        return { p95: zeiten[Math.floor(zeiten.length * 0.95)] ?? null, anzahl: zeiten.length };
    });
}

async function misseBuendeln(page: Page): Promise<{ p95: number | null; anzahl: number }> {
    await page.evaluate(() => {
        (globalThis as unknown as { avesmapsBuendelMs?: number[] }).avesmapsBuendelMs = [];
    });
    for (let i = 0; i < 40; i += 1) {
        await page.evaluate((schritt) => {
            const map = globalThis.avesmapsMap!;
            map.easeTo({ zoom: map.getZoom() + (schritt % 2 === 0 ? 0.02 : -0.02), duration: 150 });
        }, i);
        await page.waitForTimeout(170);
    }
    return page.evaluate(() => {
        const zeiten = [...((globalThis as unknown as { avesmapsBuendelMs?: number[] }).avesmapsBuendelMs ?? [])].sort(
            (a, b) => a - b,
        );
        if (zeiten.length === 0) return { p95: null, anzahl: 0 };
        return {
            p95: zeiten[Math.min(zeiten.length - 1, Math.ceil(zeiten.length * 0.95) - 1)]!,
            anzahl: zeiten.length,
        };
    });
}

/** Wie oft `setData` in `ms` Stillstand gerufen wird. */
async function setDataInRuhe(page: Page, ms: number): Promise<number> {
    return page.evaluate(async (dauer) => {
        const map = globalThis.avesmapsMap!;
        let n = 0;
        for (const id of ["photobox-bilder", "photobox-fahnen"]) {
            const quelle = map.getSource?.(id) as unknown as { setData?: (d: unknown) => unknown } | undefined;
            if (quelle?.setData === undefined) continue;
            const alt = quelle.setData.bind(quelle);
            quelle.setData = (d: unknown) => {
                n += 1;
                return alt(d);
            };
        }
        await new Promise((fertig) => setTimeout(fertig, dauer));
        return n;
    }, ms);
}

const ANSICHTEN = [
    { name: "Aventurien Zoom 2,5", punkt: { x: 518.75, y: 504 }, zoom: 2.5 },
    { name: "Gareth Zoom 5", punkt: GARETH, zoom: 5 },
    { name: "Gareth Zoom 7", punkt: GARETH, zoom: 7 },
] as const;

async function lauf(page: Page, pfad: string, bilder: KartenBild[]): Promise<Messung[]> {
    await stubReisebilder(page);
    await stubReisebilderKarte(page, bilder);
    await openMap(page, pfad);
    await expect(page.getByTestId("reisebilder-knopf")).toBeVisible({ timeout: 30_000 });
    const ergebnisse: Messung[] = [];
    for (const ansicht of ANSICHTEN) {
        for (const leiste of ["zu", "offen"] as const) {
            const offen = await page.getByTestId("reisebilder-leiste").isVisible();
            if ((leiste === "offen") !== offen) await page.getByTestId("reisebilder-knopf").click();
            await showPlace(page, ansicht.punkt, ansicht.zoom);
            await page.waitForTimeout(2500);
            await settleFrame(page);
            const gruppen = await page.evaluate(
                () =>
                    new Set(
                        globalThis
                            .avesmapsMap!.querySourceFeatures("photobox-bilder")
                            .map((m) => String(m.properties["schluessel"])),
                    ).size,
            );
            const bild = await misseBild(page);
            const buendeln = await misseBuendeln(page);
            const imZoom = await misseBuendelnImZoom(page);
            await page.waitForTimeout(500);
            const ruhe = await setDataInRuhe(page, 3000);
            ergebnisse.push({
                ansicht: ansicht.name,
                leiste,
                ...bild,
                buendelP95: buendeln.p95,
                buendelAnzahl: buendeln.anzahl,
                buendelZoomP95: imZoom.p95,
                buendelZoomAnzahl: imZoom.anzahl,
                setDataInRuhe: ruhe,
                gruppen,
            });
        }
    }
    return ergebnisse;
}

test("Last: 500 Bilder in drei Ansichten, zu und offen, gegen die Gegenprobe ohne Reisebilder", async ({ page }) => {
    test.setTimeout(600_000);
    const bilder = fuenfhundert();
    const mit = await lauf(page, "/", bilder);
    const ohne = await lauf(page, "/?ohne=photobox", bilder);
    const zeilen = mit.map((m, n) => {
        const o = ohne[n]!;
        return {
            ...m,
            anteilPhotobox: m.gesamtIndizes === 0 ? 0 : m.photoboxIndizes / m.gesamtIndizes,
            gpuZuwachsMs: m.gpuMs !== null && o.gpuMs !== null ? m.gpuMs - o.gpuMs : null,
            cpuZuwachsMs: m.cpuMs - o.cpuMs,
            gpuOhneMs: o.gpuMs,
            cpuOhneMs: o.cpuMs,
        };
    });
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/reisebild-last.json", JSON.stringify(zeilen, null, 2));
    // Nur die Ruhe ist eine harte Zusage dieses Falls; die übrigen Grenzen werden gemeldet, nicht verdeckt.
    for (const z of zeilen) expect(z.setDataInRuhe, `${z.ansicht} ${z.leiste}`).toBe(0);
});
