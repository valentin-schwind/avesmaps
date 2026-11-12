/**
 * Höhenraster-Austausch v1 (WI-0250), die TypeScript-Seite: schreibt dasselbe Format wie `tools/terrain-lab/terrainlab/raster.py`
 * (`<name>.f32` Float32 little-endian, Zeile 0 = Nord, daneben `<name>.json` mit Kopf und Prüfsumme), damit der Python-Teil die Raster
 * ohne GDAL liest. Der Generator rechnet mit Zeile 0 = Süden; gespiegelt wird hier, nirgends sonst.
 *
 * Der Ergebnis-Fingerabdruck eines Rasters ist ein SHA-256 über die Uint16-Höhen (Schritt, gerundet und auf 0 bis 65535 geklemmt; außerhalb der
 * Fläche 0), little-endian: Float64-Rundungen unterscheiden sich je Plattform, die gerundeten Schritte nicht. Die Regel steht hier und nicht im
 * Generator, damit ein Vergleich über Commits nicht an einer geänderten Rundung hängt.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { endianness } from "node:os";
import { join } from "node:path";

export const FORMAT = "avesmaps-hoehenraster";
export const VERSION = 1;
/** 1 Karteneinheit (E) sind 3000 m (Planung Kap. 5); 1 Schritt ist 1 m. */
export const METER_JE_E = 3000;
const MAX_SCHRITT = 65535;

export interface Raster {
    breite: number;
    hoehe: number;
    zellgroesse_m: number;
    /** Meter, Zeile 0 = Nord, NaN = NoData. */
    hoehen: Float32Array;
    herkunft: Record<string, unknown>;
}

export interface Geschrieben {
    name: string;
    datei: string;
    sha256: string;
    breite: number;
    hoehe: number;
    zellgroesse_m: number;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** Der Hex-Fingerabdruck eines Uint16-Felds (little-endian). */
export function samplesFingerprint(samples: Uint16Array): string {
    if (endianness() !== "LE") throw new Error("Nur little-endian Plattformen");
    return sha256Hex(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
}

/** Schritt als gerundetes, geklemmtes Uint16; wo `eigen` 0 ist (oder fehlt es: nirgends), 0 wie in Legacys Speicherkodierung. */
export function schritteZuSamples(h: ArrayLike<number>, eigen: ArrayLike<number> | null): Uint16Array {
    const samples = new Uint16Array(h.length);
    for (let k = 0; k < samples.length; k++) {
        if (eigen !== null && !eigen[k]) continue;
        const wert = Math.round(h[k] as number);
        samples[k] = wert > MAX_SCHRITT ? MAX_SCHRITT : wert > 0 ? wert : 0;
    }
    return samples;
}

/** Spiegelt die Zeilen (Süd-zuerst ↔ Nord-zuerst); gibt eine Kopie zurück. */
export function spiegeleZeilen<T extends Float32Array | Uint16Array | Uint8Array>(
    daten: T,
    breite: number,
    hoehe: number,
): T {
    if (daten.length !== breite * hoehe) throw new RangeError("Feldgröße passt nicht zu Breite mal Höhe");
    const aus = new (daten.constructor as new (n: number) => T)(daten.length);
    for (let j = 0; j < hoehe; j++) aus.set(daten.subarray((hoehe - 1 - j) * breite, (hoehe - j) * breite), j * breite);
    return aus;
}

/** Schreibt `<ordner>/<name>.f32` und `.json`. */
export function schreibeRaster(ordner: string, name: string, raster: Raster): Geschrieben {
    if (endianness() !== "LE") throw new Error("Nur little-endian Plattformen");
    if (raster.hoehen.length !== raster.breite * raster.hoehe)
        throw new RangeError("Feldgröße passt nicht zu Breite mal Höhe");
    mkdirSync(ordner, { recursive: true });
    const bytes = new Uint8Array(raster.hoehen.buffer, raster.hoehen.byteOffset, raster.hoehen.byteLength);
    const sha256 = sha256Hex(bytes);
    writeFileSync(join(ordner, `${name}.f32`), bytes);
    const kopf = {
        format: FORMAT,
        version: VERSION,
        breite: raster.breite,
        hoehe: raster.hoehe,
        zellgroesse_m: raster.zellgroesse_m,
        hoehe_einheit: "m",
        nodata: null,
        herkunft: raster.herkunft,
        sha256,
    };
    writeFileSync(join(ordner, `${name}.json`), JSON.stringify(kopf, null, 2), "utf8");
    return {
        name,
        datei: `${name}.json`,
        sha256,
        breite: raster.breite,
        hoehe: raster.hoehe,
        zellgroesse_m: raster.zellgroesse_m,
    };
}

/**
 * Das Raster einer Gebirgsrechnung (V12-Form: Schritt, Zeile 0 = Süd, `eigen`) im Austauschformat: gespiegelt, außerhalb der Fläche NaN.
 * `zellgroesse_e` ist die Zellweite in Karteneinheiten.
 */
export function ausGebirge(
    h: ArrayLike<number>,
    eigen: ArrayLike<number>,
    breite: number,
    hoehe: number,
    zellgroesse_e: number,
    herkunft: Record<string, unknown>,
): Raster {
    const f = new Float32Array(breite * hoehe);
    for (let k = 0; k < f.length; k++) f[k] = eigen[k] ? (h[k] as number) : Number.NaN;
    return {
        breite,
        hoehe,
        zellgroesse_m: zellgroesse_e * METER_JE_E,
        hoehen: spiegeleZeilen(f, breite, hoehe),
        herkunft,
    };
}
