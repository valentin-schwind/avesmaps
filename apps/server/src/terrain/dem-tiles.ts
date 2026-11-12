import { createHash } from "node:crypto";
import { WEB_MERCATOR_HALF_WORLD } from "@avesmaps3d/shared";
import { coneHeightAt, coneRadius, freePeakHeight, type ConeRule, type FreePeak } from "./peak-cone.ts";
import { continentalHeight, type ContinentalBase } from "./continental.ts";
import { decodeTileImage } from "./tile-image.ts";
import { encodeWebpRgb } from "./webp/encode.ts";

/**
 * Die Kacheln des Geländes für MapLibre (`raster-dem`), ein reines Renderartefakt (Kap. 4.22).
 *
 * 🔴 Ausgleich der Überhöhung (WI-0049 S1, gemessen auf 1,4 %): MapLibre skaliert das Gelände mit
 * der Breite der Kameramitte und die Hillshade mit der Breite je Pixel. Jede Zelle wird deshalb als
 * `RENDER_METERS_PER_SCHRITT · h · cos(Breite der Zelle)` kodiert; dann stimmt beides maßstabsgetreu
 * mit Überhöhung 1. Routing und Flug lesen nie diese Kacheln, sondern das Domain-Raster `terrain_domain_raster` in
 * Schritt (`routing/terrain-load.ts`).
 */

export const DEM_TILE_SIZE = 512;
/**
 * z4: 16 × 512 = 8.192 Pixel über 1.024 Einheiten, die Zelle des 8k-Domain-Geländes (0,125 E, WI-0070). Bis
 * dahin z3 mit 4.096 Pixeln, der Zelle von Legacys Rastern (0,25 E).
 */
export const DEM_MAX_ZOOM = 4;
export const DEM_ENCODING = "mapbox";
/**
 * Das Format der Kacheln, die dieser Code erzeugt: verlustfreies WebP (WI-0073). Die Höhe steckt in den RGB-Werten
 * (`encoding: mapbox`), jede Abweichung wäre ein Höhensprung in Relief und Schattierung; deshalb nie verlustbehaftet.
 * Kacheln aus der Zeit davor sind PNG (`terrain_dem.format`).
 */
export const DEM_TILE_FORMAT = "webp";
/** Steigt mit jeder Änderung an Zusammensetzung oder Kodierung. 5: WebP statt PNG (WI-0073). 6: Höhen auf einen Schritt gerundet (WI-0142). */
export const DEM_TILE_VERSION = "6";

const SIZE = DEM_TILE_SIZE << DEM_MAX_ZOOM;

/** Eine Karteneinheit ist 39.136 Render-Meter, aber 3.000 Schritt (ADR-0005, WI-0016 R1). */
export const RENDER_METERS_PER_SCHRITT = (2 * WEB_MERCATOR_HALF_WORLD) / (1024 * 3000);

/**
 * Auf dieses Raster werden die Höhen gerundet: **einen Schritt** (WI-0142, Betreiber 2026-10-14).
 *
 * 🪤 **Warum überhaupt runden.** Die Mapbox-Kodierung legt Zehntelmeter ab; das niederwertigste Byte jeder Höhe ist
 * damit fast reines Rauschen, und verlustfreies WebP kann daran nichts sparen. Gemessen an vier Gebirgskacheln des
 * 8k-Stands: ohne Rundung 993 KB, auf 1 m 92 %, auf 2 m 82 %, auf 5 m 75 %, auf **einen Schritt 61 %**. Die
 * Geländekacheln sind 85 bis 95 % aller Bytes einer geneigten Ansicht, also spart das rund ein Drittel des Nachladens.
 *
 * ⭐ Ein Schritt ist das feinste Maß, in dem Aventurien überhaupt beschrieben ist; Gebirge sind tausende Schritt hoch.
 * Die Rundung ist monoton, Gefälle bleibt also Gefälle. 🪤 Gerundet wird in Render-Metern, nicht in Schritt: Am Äquator
 * ist das genau ein Schritt, bei 20° Breite 1,06 - die Kodierung trägt den Ausgleich der Breite ohnehin im Faktor.
 */
export const DEM_QUANT_METERS = RENDER_METERS_PER_SCHRITT;

/** Ein gespeichertes Gebirgsraster wie in `terrain_raster` (Zeile 0 im Süden, außerhalb 0). */
export interface StoredRaster {
    cell: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    samples: Uint16Array;
}

/**
 * Bilinear wie Legacys Leser (`avesmapsGebirgsRasterProbe`), aber ohne Polygonmaske: Außerhalb der
 * Fläche steht im Raster ohnehin 0, und am Rand läuft das Gelände damit eine Viertelzelle weich aus.
 * Für die Anzeige ist das gewollt; Routing und Flug lesen mit Maske aus `terrain_raster`.
 */
function sample(r: StoredRaster, x: number, y: number): number {
    const fx = (x - r.originX) / r.cell;
    const fy = (y - r.originY) / r.cell;
    if (fx < 0 || fy < 0 || fx > r.width - 1 || fy > r.height - 1) {
        return 0;
    }
    const i = Math.min(Math.floor(fx), Math.max(0, r.width - 2));
    const j = Math.min(Math.floor(fy), Math.max(0, r.height - 2));
    const tx = fx - i;
    const ty = fy - j;
    const right = Math.min(i + 1, r.width - 1);
    const up = Math.min(j + 1, r.height - 1);
    const s = r.samples;
    const a = s[j * r.width + i] ?? 0;
    const b = s[j * r.width + right] ?? 0;
    const c = s[up * r.width + i] ?? 0;
    const d = s[up * r.width + right] ?? 0;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/**
 * Setzt das Höhenfeld der Karte zusammen: Gebirge und freie Gipfel, bei Überlappung das Maximum
 * (Owner Legacy 04.09.2026: „max der beiden bei ueberlappung“). In Schritt, Zeile 0 im NORDEN.
 */
export function composeDem(
    rasters: readonly StoredRaster[],
    peaks: readonly FreePeak[],
    rule: ConeRule,
    continental?: ContinentalBase,
    size: number = SIZE,
): Float32Array {
    const cell = 1024 / size;
    const dem = new Float32Array(size * size);
    if (continental) {
        for (let gy = 0; gy < size; gy += 1) {
            for (let gx = 0; gx < size; gx += 1)
                dem[gy * size + gx] = continentalHeight(continental, (gx + 0.5) * cell, 1024 - (gy + 0.5) * cell);
        }
    }
    const put = (gx: number, gy: number, value: number): void => {
        const k = gy * size + gx;
        if (value > (dem[k] ?? 0)) {
            dem[k] = value;
        }
    };
    for (const r of rasters) {
        const x0 = Math.max(0, Math.floor(r.originX / cell));
        const x1 = Math.min(size - 1, Math.ceil((r.originX + (r.width - 1) * r.cell) / cell));
        const g0 = Math.max(0, Math.floor((1024 - (r.originY + (r.height - 1) * r.cell)) / cell));
        const g1 = Math.min(size - 1, Math.ceil((1024 - r.originY) / cell));
        for (let gy = g0; gy <= g1; gy += 1) {
            const y = 1024 - (gy + 0.5) * cell;
            for (let gx = x0; gx <= x1; gx += 1) {
                put(gx, gy, sample(r, (gx + 0.5) * cell, y));
            }
        }
    }
    for (const peak of peaks) {
        const radius = coneRadius(freePeakHeight(peak), rule);
        const x0 = Math.max(0, Math.floor((peak.x - radius) / cell));
        const x1 = Math.min(size - 1, Math.ceil((peak.x + radius) / cell));
        const g0 = Math.max(0, Math.floor((1024 - (peak.y + radius)) / cell));
        const g1 = Math.min(size - 1, Math.ceil((1024 - (peak.y - radius)) / cell));
        for (let gy = g0; gy <= g1; gy += 1) {
            const y = 1024 - (gy + 0.5) * cell;
            for (let gx = x0; gx <= x1; gx += 1) {
                put(gx, gy, coneHeightAt(peak, (gx + 0.5) * cell, y, rule));
            }
        }
    }
    return dem;
}

export interface DemTile {
    z: number;
    x: number;
    y: number;
    /** Die Bytes der Kachel im Format `DEM_TILE_FORMAT` (verlustfreies WebP). */
    image: Buffer;
}

/** Wie die Kacheln kodiert werden. Ohne Angabe genau wie das Gelände (per Test auf eine Revision gesichert). */
export interface DemTileOptions {
    /** Render-Meter auf dieses Raster runden (0 = volle 0,1 m der Kodierung); ohne Angabe `DEM_QUANT_METERS`. */
    quantMeters?: number;
    /**
     * Nur diese Kacheln kodieren (WI-0125, `dem_publish`): Die Stufen werden trotzdem ganz gemittelt, also sind die Bytes jeder
     * kodierten Kachel genau die des vollen Laufs. Ohne Angabe alle.
     */
    only?: (z: number, x: number, y: number) => boolean;
}

/**
 * Die RGB-Werte einer Kachel aus dem Höhenfeld einer Stufe (`size` Pixel Kante, Zeile 0 im Norden): die Höhe in
 * Schritt wird mit dem Ausgleich der Breite in Render-Meter gerechnet und im Mapbox-Format auf drei Byte gelegt.
 * Das ist alles, was in einer Kachel steht; das Kodieren zu WebP ändert daran nichts (verlustfrei).
 */
export function demTileRgb(
    level: Float32Array | Uint16Array,
    size: number,
    tx: number,
    ty: number,
    quant: number = DEM_QUANT_METERS,
): Buffer {
    const rgb = Buffer.alloc(DEM_TILE_SIZE * DEM_TILE_SIZE * 3);
    for (let py = 0; py < DEM_TILE_SIZE; py += 1) {
        const gy = ty * DEM_TILE_SIZE + py;
        const mercatorY = WEB_MERCATOR_HALF_WORLD - ((gy + 0.5) / size) * 2 * WEB_MERCATOR_HALF_WORLD;
        const latitude = 2 * Math.atan(Math.exp((mercatorY / WEB_MERCATOR_HALF_WORLD) * Math.PI)) - Math.PI / 2;
        const factor = RENDER_METERS_PER_SCHRITT * Math.cos(latitude);
        for (let px = 0; px < DEM_TILE_SIZE; px += 1) {
            const h = level[gy * size + tx * DEM_TILE_SIZE + px] ?? 0;
            const meters = quant > 0 ? Math.round((h * factor) / quant) * quant : h * factor;
            // Mapbox-Kodierung: Höhe = −10000 + (R·65536 + G·256 + B) · 0,1.
            const value = Math.max(0, Math.round((meters + 10000) * 10));
            const o = (py * DEM_TILE_SIZE + px) * 3;
            rgb[o] = (value >> 16) & 255;
            rgb[o + 1] = (value >> 8) & 255;
            rgb[o + 2] = value & 255;
        }
    }
    return rgb;
}

/** Die Pyramide z0 bis `DEM_MAX_ZOOM`; die groben Stufen mitteln je vier Pixel der feineren. */
export function demTiles(dem: Float32Array | Uint16Array, options: DemTileOptions = {}): DemTile[] {
    const quant = options.quantMeters ?? DEM_QUANT_METERS;
    const tiles: DemTile[] = [];
    let level: Float32Array | Uint16Array = dem;
    let size = SIZE;
    for (let z = DEM_MAX_ZOOM; z >= 0; z -= 1) {
        const n = 1 << z;
        for (let ty = 0; ty < n; ty += 1) {
            for (let tx = 0; tx < n; tx += 1) {
                if (options.only && !options.only(z, tx, ty)) continue;
                const rgb = demTileRgb(level, size, tx, ty, quant);
                tiles.push({ z, x: tx, y: ty, image: encodeWebpRgb(rgb, DEM_TILE_SIZE, DEM_TILE_SIZE) });
            }
        }
        if (z > 0) {
            const half = size / 2;
            const next = new Float32Array(half * half);
            for (let y = 0; y < half; y += 1) {
                for (let x = 0; x < half; x += 1) {
                    const k = 2 * y * size + 2 * x;
                    next[y * half + x] =
                        ((level[k] ?? 0) + (level[k + 1] ?? 0) + (level[k + size] ?? 0) + (level[k + size + 1] ?? 0)) /
                        4;
                }
            }
            level = next;
            size = half;
        }
    }
    return tiles;
}

/**
 * Die Revision: die ersten zwölf Hexzeichen über alle Kacheln, wie bei den Grundkarten (ADR-0008). Die Reihenfolge ist die des
 * Baus (`demTiles`: z absteigend, dann Zeile, dann Spalte). Seit WI-0125 ist sie ein Hash über das Manifest im Sinn von ADR-0008:
 * Sie hängt nur am Inhalt jeder Kachel, und eine lokale Veröffentlichung rechnet sie über dieselbe Folge (die unveränderten Kacheln
 * mit ihren gespeicherten Bytes). Gleiche Pyramide, gleiche Revision, gleich auf welchem Weg sie entstand.
 */
export function demRevision(tiles: readonly DemTile[]): string {
    const hash = createHash("sha256");
    for (const tile of tiles) {
        hash.update(`${String(tile.z)}/${String(tile.x)}/${String(tile.y)}:`).update(tile.image);
    }
    return hash.digest("hex").slice(0, 12);
}

/**
 * Die Revision EINER Kachel (WI-0125, JOBS-0001 V2): die ersten 16 Hexzeichen des SHA-256 ihrer Bytes. Dieselbe Rechnung macht der
 * Trigger an `terrain_dem_tile` (Migration 0085); `terrain-tiles.test.ts` hält beide zusammen.
 */
export function tileRevision(image: Uint8Array): string {
    return createHash("sha256").update(image).digest("hex").slice(0, 16);
}

/** Die Kacheln der Pyramide in der Reihenfolge des Baus (`demTiles`): z absteigend, dann Zeile, dann Spalte. */
export function demTileOrder(maxZoom: number = DEM_MAX_ZOOM): { z: number; x: number; y: number }[] {
    const order: { z: number; x: number; y: number }[] = [];
    for (let z = maxZoom; z >= 0; z -= 1) {
        const n = 1 << z;
        for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) order.push({ z, x, y });
    }
    return order;
}

/**
 * Render-Meter je Schritt in einer Pixelzeile der Stufe `z` (Zeile über die ganze Karte gezählt):
 * der Ausgleich der Breite, mit dem kodiert wird. Eine Stufe von q Render-Metern sind dort q / Faktor
 * Schritt.
 */
export function encodingFactor(z: number, row: number): number {
    return RENDER_METERS_PER_SCHRITT * Math.cos(rowLatitude(z, Math.floor(row / DEM_TILE_SIZE), row % DEM_TILE_SIZE));
}

/** Die Breite der Mitte einer Pixelzeile einer Kachel (Render-Projektion), wie beim Kodieren. */
function rowLatitude(z: number, tileY: number, py: number): number {
    const size = DEM_TILE_SIZE << z;
    const gy = tileY * DEM_TILE_SIZE + py;
    const mercatorY = WEB_MERCATOR_HALF_WORLD - ((gy + 0.5) / size) * 2 * WEB_MERCATOR_HALF_WORLD;
    return 2 * Math.atan(Math.exp((mercatorY / WEB_MERCATOR_HALF_WORLD) * Math.PI)) - Math.PI / 2;
}

/**
 * Liest eine eigene Höhenkachel zurück (WebP, oder PNG aus der Zeit davor): die Höhe in Schritt je Pixel, Zeile 0
 * im Norden, mit dem Ausgleich der Breite zurückgerechnet. Genau bis auf die 0,1 m der Kodierung. Für
 * Ableitungen, die an die veröffentlichte Revision gebunden sein müssen (WI-0054).
 */
export function decodeDemTile(
    image: Buffer,
    z: number,
    tileY: number,
    into: Float32Array = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE),
): Float32Array {
    const { width, height, rgb } = decodeTileImage(image);
    if (width !== DEM_TILE_SIZE || height !== DEM_TILE_SIZE) {
        throw new Error(`Höhenkachel mit ${String(width)} × ${String(height)} statt ${String(DEM_TILE_SIZE)} Pixeln`);
    }
    for (let py = 0; py < height; py += 1) {
        const factor = RENDER_METERS_PER_SCHRITT * Math.cos(rowLatitude(z, tileY, py));
        for (let px = 0; px < width; px += 1) {
            const o = (py * width + px) * 3;
            const value = (rgb[o]! << 16) + (rgb[o + 1]! << 8) + rgb[o + 2]!;
            into[py * width + px] = (value * 0.1 - 10000) / factor;
        }
    }
    return into;
}
