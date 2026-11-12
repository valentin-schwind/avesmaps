import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AVENTURIA,
    MEDIA_REISEBILDER_PUBLIC_URL,
    REISEBILD_AUSSCHNITT_MAX,
    REISEBILD_LESEN_JE_STUNDE,
    REISEBILD_RASTER,
    ReisebildKarte,
    ReisebilderAntwort,
    ReisebilderAusschnitt,
    ausschnittAufRaster,
    ausschnittGueltig,
    mediaPublicUrl,
} from "../src/index.ts";

/**
 * Die Reisebilder auf der Karte (WI-0272 S4, Aufgabe 23): das Raster der Ausschnitte, die Grenzen und die Form der Antwort. Der Ausschnitt rundet nach außen auf
 * das Raster und klemmt auf die Welt; gültig ist nur, was auf dem Raster liegt, nicht leer ist und in der Welt bleibt.
 */

const { bounds: WORLD } = AVENTURIA.coordinateSpace;
const R = REISEBILD_RASTER;

describe("Die Maße des Lesepfads", () => {
    it("die Zahlen des Plans", () => {
        expect(MEDIA_REISEBILDER_PUBLIC_URL).toBe("/api/media/reisebilder");
        expect(REISEBILD_RASTER).toBe(64);
        expect(REISEBILD_AUSSCHNITT_MAX).toBe(500);
        expect(REISEBILD_LESEN_JE_STUNDE).toBe(1200);
        // Die Welt besteht aus ganzen Rasterfeldern, sonst klemmte ein Ausschnitt auf einen Wert, der kein Vielfaches ist.
        expect(WORLD.minX % R).toBe(0);
        expect(WORLD.minY % R).toBe(0);
        expect(WORLD.maxX % R).toBe(0);
        expect(WORLD.maxY % R).toBe(0);
    });
});

describe("ausschnittAufRaster: nach außen, auf die Welt geklemmt", () => {
    it("rundet die kleinen Ecken ab und die großen auf", () => {
        expect(ausschnittAufRaster({ x0: 70, y0: 130.5, x1: 190, y1: 200 })).toEqual({
            x0: 64,
            y0: 128,
            x1: 192,
            y1: 256,
        });
    });

    it("ein Rahmen, der schon auf dem Raster liegt, bleibt, wie er ist", () => {
        expect(ausschnittAufRaster({ x0: 128, y0: 64, x1: 256, y1: 192 })).toEqual({
            x0: 128,
            y0: 64,
            x1: 256,
            y1: 192,
        });
    });

    it("🔴 jeder Punkt des Rahmens liegt im Ergebnis (auch genau auf einer Rasterlinie und kurz davor)", () => {
        for (const box of [
            { x0: 63.9, y0: 64.1, x1: 64.1, y1: 127.9 },
            { x0: 0.5, y0: 0.5, x1: 1023.5, y1: 1023.5 },
            { x0: 200, y0: 300, x1: 200.0001, y1: 300.0001 },
        ]) {
            const raster = ausschnittAufRaster(box);
            expect(raster.x0).toBeLessThanOrEqual(box.x0);
            expect(raster.y0).toBeLessThanOrEqual(box.y0);
            expect(raster.x1).toBeGreaterThanOrEqual(box.x1);
            expect(raster.y1).toBeGreaterThanOrEqual(box.y1);
            expect(ausschnittGueltig(raster)).toBe(true);
        }
    });

    it("klemmt auf die Welt: ein Rahmen, der über den Rand ragt, endet am Rand", () => {
        expect(ausschnittAufRaster({ x0: -500, y0: -1, x1: 5000, y1: 1025 })).toEqual({
            x0: WORLD.minX,
            y0: WORLD.minY,
            x1: WORLD.maxX,
            y1: WORLD.maxY,
        });
    });

    it("ein Rahmen ganz außerhalb der Welt wird eine leere, ungültige Fläche", () => {
        const draussen = ausschnittAufRaster({ x0: 2000, y0: 10, x1: 2100, y1: 90 });
        expect(draussen.x0).toBe(draussen.x1);
        expect(ausschnittGueltig(draussen)).toBe(false);
        const davor = ausschnittAufRaster({ x0: -300, y0: 10, x1: -100, y1: 90 });
        expect(davor.x0).toBe(davor.x1);
        expect(ausschnittGueltig(davor)).toBe(false);
    });
});

describe("ausschnittGueltig lehnt jede Randbedingung ab", () => {
    const gut = { x0: 0, y0: 64, x1: 128, y1: 192 };

    it("ein Ausschnitt auf dem Raster, nicht leer, in der Welt: gültig; die ganze Welt auch", () => {
        expect(ausschnittGueltig(gut)).toBe(true);
        expect(ausschnittGueltig({ x0: WORLD.minX, y0: WORLD.minY, x1: WORLD.maxX, y1: WORLD.maxY })).toBe(true);
        expect(ausschnittGueltig({ x0: 960, y0: 960, x1: 1024, y1: 1024 })).toBe(true);
    });

    it("kein Vielfaches des Rasters", () => {
        for (const feld of ["x0", "y0", "x1", "y1"] as const) {
            expect(ausschnittGueltig({ ...gut, [feld]: gut[feld] + 1 }), feld).toBe(false);
        }
        expect(ausschnittGueltig({ x0: 10, y0: 10, x1: 100, y1: 100 })).toBe(false);
    });

    it("keine ganze Zahl (Bruch, Unendlich, kein Wert)", () => {
        expect(ausschnittGueltig({ ...gut, x1: 128.5 })).toBe(false);
        expect(ausschnittGueltig({ ...gut, x1: Number.POSITIVE_INFINITY })).toBe(false);
        expect(ausschnittGueltig({ ...gut, y0: Number.NaN })).toBe(false);
        expect(ausschnittGueltig({ ...gut, y0: Number.NEGATIVE_INFINITY })).toBe(false);
    });

    it("leer oder verkehrt: x0 < x1 und y0 < y1 verlangt", () => {
        expect(ausschnittGueltig({ ...gut, x1: gut.x0 })).toBe(false);
        expect(ausschnittGueltig({ ...gut, y1: gut.y0 })).toBe(false);
        expect(ausschnittGueltig({ ...gut, x0: 192 })).toBe(false);
        expect(ausschnittGueltig({ ...gut, y0: 256 })).toBe(false);
    });

    it("außerhalb der Welt, auf jeder Seite", () => {
        expect(ausschnittGueltig({ ...gut, x0: -R })).toBe(false);
        expect(ausschnittGueltig({ ...gut, y0: -R })).toBe(false);
        expect(ausschnittGueltig({ ...gut, x1: WORLD.maxX + R })).toBe(false);
        expect(ausschnittGueltig({ ...gut, y1: WORLD.maxY + R })).toBe(false);
    });
});

describe("Die Formen der Antwort", () => {
    const sha = "ab".repeat(32);
    const datei = { url: mediaPublicUrl(sha), breite: 2048, hoehe: 1365 };
    const karte = {
        id: "6f1d6f0e-5c3b-4b0e-9a6c-0d9f3a5b7c11",
        lage: { x: 300, y: 310 },
        datei,
        kachel: { url: mediaPublicUrl("cd".repeat(32)), breite: 480, hoehe: 320 },
        beschreibung: "Der Blick vom Hafen auf die Bucht",
        entstehung: "photo",
    };

    it("der Ausschnitt: ganze Zahlen in der Welt, nichts sonst", () => {
        expect(Value.Check(ReisebilderAusschnitt, { x0: 0, y0: 0, x1: 64, y1: 64 })).toBe(true);
        expect(Value.Check(ReisebilderAusschnitt, { x0: 0, y0: 0, x1: 64.5, y1: 64 })).toBe(false);
        expect(Value.Check(ReisebilderAusschnitt, { x0: -64, y0: 0, x1: 64, y1: 64 })).toBe(false);
        expect(Value.Check(ReisebilderAusschnitt, { x0: 0, y0: 0, x1: 2048, y1: 64 })).toBe(false);
        expect(Value.Check(ReisebilderAusschnitt, { x0: 0, y0: 0, x1: 64, y1: 64, z: 1 })).toBe(false);
    });

    it("ein Bild: Pflichtfelder, die Kachel darf fehlen, Fremdes nie", () => {
        expect(Value.Check(ReisebildKarte, karte)).toBe(true);
        const ohneKachel: Record<string, unknown> = { ...karte };
        delete ohneKachel["kachel"];
        expect(Value.Check(ReisebildKarte, ohneKachel)).toBe(true);
        for (const feld of ["id", "lage", "datei", "beschreibung", "entstehung"]) {
            const ohne: Record<string, unknown> = { ...karte };
            delete ohne[feld];
            expect(Value.Check(ReisebildKarte, ohne), feld).toBe(false);
        }
        for (const fremd of ["schluessel", "sha256", "zustand", "storage_key", "wartendeBeschreibung", "nachricht"]) {
            expect(Value.Check(ReisebildKarte, { ...karte, [fremd]: "x" }), fremd).toBe(false);
        }
        // Die Datei trägt nur Adresse und Maße: keine Prüfsumme neben der Adresse.
        expect(Value.Check(ReisebildKarte, { ...karte, datei: { ...datei, sha256: sha } })).toBe(false);
        expect(Value.Check(ReisebildKarte, { ...karte, datei: { ...datei, url: "/media/private/x.webp" } })).toBe(
            false,
        );
    });

    it("Nennung, Lizenz, Blickrichtung und Ort in ihren Grenzen", () => {
        const voll = {
            ...karte,
            name: "Alrik",
            lizenz: { name: "CC BY 4.0", uri: "https://creativecommons.org/licenses/by/4.0/" },
            blickrichtung: 7,
            ort: {
                id: "7a1d6f0e-5c3b-4b0e-9a6c-0d9f3a5b7c22",
                name: "Gareth",
                lage: { x: 320, y: 310 },
                subtype: "metropole",
                capitalBands: "0145",
            },
        };
        expect(Value.Check(ReisebildKarte, voll)).toBe(true);
        expect(Value.Check(ReisebildKarte, { ...voll, blickrichtung: 8 })).toBe(false);
        expect(Value.Check(ReisebildKarte, { ...voll, entstehung: "bild" })).toBe(false);
        expect(Value.Check(ReisebildKarte, { ...voll, ort: { ...voll.ort, capitalBands: "9" } })).toBe(false);
        expect(Value.Check(ReisebildKarte, { ...voll, ort: { ...voll.ort, extra: 1 } })).toBe(false);
        expect(Value.Check(ReisebildKarte, { ...voll, lizenz: { name: "CC BY 4.0", schluessel: "x" } })).toBe(false);
    });

    it("die Antwort: an, Bilder, gekappt; sonst nichts", () => {
        expect(Value.Check(ReisebilderAntwort, { an: true, bilder: [karte], gekappt: false })).toBe(true);
        expect(Value.Check(ReisebilderAntwort, { an: false, bilder: [], gekappt: false })).toBe(true);
        expect(Value.Check(ReisebilderAntwort, { an: true, bilder: [] })).toBe(false);
        expect(Value.Check(ReisebilderAntwort, { an: true, bilder: [], gekappt: false, gesamt: 3 })).toBe(false);
    });
});
