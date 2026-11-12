import { describe, expect, it } from "vitest";
import { AVENTURIA_ZOOM_BANDS } from "../src/zoom-bands-registry.ts";
import {
    BAND_COUNT,
    appearanceBand,
    appearanceFilter,
    bandForRenderZoom,
    renderZoomForBand,
    bandStepExpression,
    overrideFilter,
    visibilityHoles,
} from "../src/zoom-bands.ts";

const bands = AVENTURIA_ZOOM_BANDS;

describe("zoom band model", () => {
    // Numbers from finding MCS-004. Changing one changes the map, so the test names them.
    it("keeps the seven legacy location classes with nine bands each", () => {
        const classes = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"];
        expect(Object.keys(bands.marker).sort()).toEqual([...classes].sort());
        expect(Object.keys(bands.label).sort()).toEqual([...classes].sort());
        for (const series of Object.values(bands.marker)) {
            expect(series).toHaveLength(BAND_COUNT);
        }
    });

    it("keeps the verified appearance levels", () => {
        expect(appearanceBand(bands.marker["metropole"] ?? [])).toBe(0);
        expect(appearanceBand(bands.marker["kleinstadt"] ?? [])).toBe(1);
        expect(appearanceBand(bands.marker["dorf"] ?? [])).toBe(2);
        expect(appearanceBand(bands.marker["gebaeude"] ?? [])).toBe(3);
        expect(appearanceBand(bands.label["stadt"] ?? [])).toBe(2);
        expect(appearanceBand(bands.label["dorf"] ?? [])).toBe(4);
    });

    it("has no visibility holes after a class appeared", () => {
        for (const [className, series] of Object.entries({ ...bands.marker, ...bands.label })) {
            expect({ className, holes: visibilityHoles(series) }).toEqual({ className, holes: [] });
        }
    });
});

describe("render zoom to band", () => {
    /**
     * 🔴 Der Renderzoom ist NICHT das Band. Legacy traegt bei Zoom z genau 2^z Bildpunkte je
     * Karteneinheit, MapLibre 2^(z-1) - derselbe Massstab steht bei uns eine Stufe hoeher
     * (WI-0015, an beiden laufenden Karten gemessen). Bis dahin stand hier die Gleichsetzung, und
     * der Test hat sie festgeschrieben.
     */
    it("🔴 rechnet den Versatz heraus, floort und klemmt", () => {
        expect(bandForRenderZoom(renderZoomForBand(0))).toBe(0);
        expect(bandForRenderZoom(renderZoomForBand(4))).toBe(4);
        expect(bandForRenderZoom(renderZoomForBand(3) + 0.99)).toBe(3);
        expect(bandForRenderZoom(-2)).toBe(0);
        expect(bandForRenderZoom(99)).toBe(8);
    });

    it("🪤 unterhalb der ersten Renderstufe bleibt es Band 0, nicht negativ", () => {
        expect(bandForRenderZoom(0)).toBe(0);
    });
});

describe("step expression", () => {
    it("steps, never interpolates, and renders nothing before the appearance band", () => {
        const expression = bandStepExpression([null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74, 17.74]);

        expect(expression[0]).toBe("step");
        expect(expression[2]).toBe(0); // below the appearance band: size 0, not an interpolated value
        expect(expression).toContain(1.33);
        expect(expression).not.toContain("interpolate");
    });

    it("can shift bands onto a render zoom offset", () => {
        const expression = bandStepExpression([1, 2, 3, 4, 5, 6, 7, 8, 9], 1);
        expect(expression.slice(0, 5)).toEqual(["step", ["zoom"], 1, 2, 2]);
    });
});

describe("per object overrides", () => {
    it("treats the upper bound as inclusive, unlike MapLibre's own maxzoom", () => {
        const filter = overrideFilter(null, 5) as unknown[];
        // Band 5 muss noch zeichnen, Band 6 nicht - und zwar auf der RENDER-Stufe des Bandes.
        expect(filter[0]).toBe("<");
        expect(filter[2]).toBe(renderZoomForBand(5) + 1);
    });

    it("🔴 a minimum of band 0 sets no lower edge: the lowest band holds down to the smallest map zoom (WI-0129 §17d)", () => {
        expect(overrideFilter(0, null)).toBeNull();
        expect((overrideFilter(0, 3) as unknown[])[0]).toBe("<");
    });

    it("combines both bounds and returns null without an override", () => {
        expect(overrideFilter(2, 6)?.[0]).toBe("all");
        expect(overrideFilter(null, null)).toBeNull();
    });
});

describe("Quelltext ohne rohe Steuerzeichen", () => {
    /**
     * 💣 In `zoom-bands.ts` lag ein echtes NUL-Byte — im Sentinel `"\u0000none"`, einem
     * Klassennamen, den kein Datensatz tragen kann. Der Wert ist richtig; seine SCHREIBWEISE war
     * es nicht: git hielt die ganze Datei daraufhin für binär. Keine Diffs, keine Zusammenführung,
     * und als zwei Sitzungen gleichzeitig darin schrieben, war das kein Schönheitsfehler mehr.
     *
     * 🪤 Der Test prüft die QUELLE, nicht den Laufzeitwert — der soll das Zeichen ja enthalten.
     */
    it("🪤 trägt kein rohes NUL-Byte in einer Quelldatei", async () => {
        const { readdir, readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");

        const sammeln = async (verzeichnis: string): Promise<string[]> => {
            const eintraege = await readdir(verzeichnis, { withFileTypes: true });
            const dateien: string[] = [];
            for (const eintrag of eintraege) {
                const pfad = join(verzeichnis, eintrag.name);
                if (eintrag.isDirectory()) {
                    dateien.push(...(await sammeln(pfad)));
                } else if (pfad.endsWith(".ts")) {
                    dateien.push(pfad);
                }
            }
            return dateien;
        };

        const nul = String.fromCharCode(0);
        const betroffen: string[] = [];
        for (const datei of await sammeln(
            new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
        )) {
            if ((await readFile(datei, "utf8")).includes(nul)) {
                betroffen.push(datei);
            }
        }
        // 🪛 Die Meldung nennt das Escape in Worten. Schriebe man es hin, stuende in der
        // Fehlermeldung selbst ein NUL - und sie waere an genau der Stelle leer, an der sie
        // erklaert, was fehlt.
        expect(betroffen, "rohe NUL-Bytes gehören als Backslash-u-0000 geschrieben").toEqual([]);
    });

    it("🔴 lässt den Sentinelwert unverändert", () => {
        // Die Schreibweise hat sich geändert, der Wert nicht: U+0000 gefolgt von "none".
        const filter = appearanceFilter({}, "subtype") as unknown[];
        const sentinel = filter[2] as string;
        expect(sentinel.charCodeAt(0)).toBe(0);
        expect(sentinel.slice(1)).toBe("none");
    });
});

describe("Mindestnähe eines Orts (WI-0039, E2): eine Regel für Suche und Planer", () => {
    it("zwei Bänder über der Erscheinungsstufe, nie weiter weg als Band 4", async () => {
        const { PLACE_ZOOM_FLOOR, placeNearZoom } = await import("../src/place-zoom.ts");
        // Metropole und Stadt erscheinen früh: der Boden, Band 4 (Zoom 5) - Gareth nicht über dem halben Kontinent.
        expect(placeNearZoom("metropole")).toBe(renderZoomForBand(PLACE_ZOOM_FLOOR));
        expect(placeNearZoom("stadt")).toBe(renderZoomForBand(4));
        // Das Dorf erscheint erst auf Band 4: zwei Bänder mehr.
        expect(placeNearZoom("dorf")).toBe(renderZoomForBand(6));
        expect(placeNearZoom("kleinstadt")).toBe(renderZoomForBand(5));
    });

    it("eine unbekannte Klasse gilt als spät erscheinend", async () => {
        const { placeNearZoom } = await import("../src/place-zoom.ts");
        expect(placeNearZoom(null)).toBe(placeNearZoom("gibt-es-nicht"));
        expect(placeNearZoom(undefined)).toBe(renderZoomForBand(6));
    });
});

describe("Legacys Obergrenze an der Migrationsgrenze (WI-0129, Betreiber 2026-10-10 E2 A)", () => {
    it("🔴 Legacys terminale 7 wird im Ziel 8; kleinere Maxima, NULL und 'aus' bleiben", async () => {
        const { LEGACY_MAX_BAND, MAX_BAND, upperBandFromLegacy } = await import("../src/zoom-bands.ts");
        expect(LEGACY_MAX_BAND).toBe(7);
        expect(MAX_BAND).toBe(8);
        expect(upperBandFromLegacy(7)).toBe(8);
        for (const unveraendert of [0, 1, 2, 3, 6]) {
            expect(upperBandFromLegacy(unveraendert), String(unveraendert)).toBe(unveraendert);
        }
        expect(upperBandFromLegacy(null)).toBeNull();
        // `bis = -1` heißt in Legacys Darstellungstafel „aus“ - das bleibt eine Aussage, kein Band.
        expect(upperBandFromLegacy(-1)).toBe(-1);
    });

    it("idempotent: ein Zielwert 8 bleibt 8 (der Import rechnet aus der Quelle, aber auch ein zweites Anwenden schadet nicht)", async () => {
        const { upperBandFromLegacy } = await import("../src/zoom-bands.ts");
        expect(upperBandFromLegacy(8)).toBe(8);
        expect(upperBandFromLegacy(upperBandFromLegacy(7))).toBe(8);
    });

    it("🔴 WI-0188 A1: Legacys oberstes GEBIETSband 6 wird im Ziel 8; Untergrenzen, kleinere Maxima, Werte über 6 und NULL bleiben", async () => {
        const { LEGACY_POLITICAL_MAX_BAND, MAX_BAND, upperPoliticalBandFromLegacy } =
            await import("../src/zoom-bands.ts");
        // Legacy klemmt jede Gebietsanfrage auf 6 (`avesmapsPoliticalClampLayerRequestZoom`): seine 6 heißt „bis ganz nah“.
        expect(LEGACY_POLITICAL_MAX_BAND).toBe(6);
        expect(upperPoliticalBandFromLegacy(6)).toBe(MAX_BAND);
        for (const unveraendert of [0, 1, 2, 3, 4, 5, 7]) {
            expect(upperPoliticalBandFromLegacy(unveraendert), String(unveraendert)).toBe(unveraendert);
        }
        expect(upperPoliticalBandFromLegacy(null)).toBeNull();
    });

    it("WI-0188 A2: idempotent, ein Zielwert 8 bleibt 8", async () => {
        const { upperPoliticalBandFromLegacy } = await import("../src/zoom-bands.ts");
        expect(upperPoliticalBandFromLegacy(8)).toBe(8);
        expect(upperPoliticalBandFromLegacy(upperPoliticalBandFromLegacy(6))).toBe(8);
    });

    it("die höchste ausgelieferte Vektorstufe ist MapLibre 8, also Legacys Stufe 7 in unserer Zählung", async () => {
        const { LEGACY_MAX_BAND, VECTOR_TILE_MAX_ZOOM } = await import("../src/zoom-bands.ts");
        expect(VECTOR_TILE_MAX_ZOOM).toBe(8);
        expect(bandForRenderZoom(VECTOR_TILE_MAX_ZOOM)).toBe(LEGACY_MAX_BAND);
    });

    it("🔴 eine Fahrt fliegt höchstens bis Stufe 7; Stufe 8 erreicht nur, wer selbst heranzoomt (WI-0129 R2)", async () => {
        const { FLY_MAX_BAND, LEGACY_MAX_BAND, MAX_BAND } = await import("../src/zoom-bands.ts");
        expect(FLY_MAX_BAND).toBe(LEGACY_MAX_BAND);
        expect(FLY_MAX_BAND).toBeLessThan(MAX_BAND);
        expect(renderZoomForBand(FLY_MAX_BAND)).toBe(8);
    });

    it("🔴 die Karte zoomt bis Stufe 8,5: Stufe 8 hält, wenn das Gelände den Zoom am Ende einer Bewegung nachrechnet", async () => {
        const { MAX_BAND, MAX_VIEW_BAND } = await import("../src/zoom-bands.ts");
        expect(MAX_VIEW_BAND).toBe(MAX_BAND + 0.5);
        expect(renderZoomForBand(MAX_VIEW_BAND)).toBe(9.5);
        // Ganz herangezoomt, danach rechnet MapLibre den Zoom ein Stück zurück: Das bleibt Stufe 8 (vorher: 8,97 war Stufe 7).
        expect(bandForRenderZoom(renderZoomForBand(MAX_VIEW_BAND) - 0.3)).toBe(MAX_BAND);
        // Über Stufe 8 wird nur vergrößert, es gibt keine Stufe 9.
        expect(bandForRenderZoom(renderZoomForBand(MAX_VIEW_BAND))).toBe(MAX_BAND);
    });
});
