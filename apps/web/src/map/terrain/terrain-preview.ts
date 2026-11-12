import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, WEB_MERCATOR_HALF_WORLD, createRenderProjection, type TerrainTileId } from "@avesmaps3d/shared";
import type { VorschauErgebnis } from "../../gebirge-vorschau/auftrag";
import { whenStyleTakesChanges } from "../style-ready";

/** Ausschließlich im Browser: keine Veröffentlichung oder Änderung des gespeicherten Domain-Geländes. */
let vorschau: VorschauErgebnis | undefined;
let aufloesung: 1 | 2 | 4 = 1;
const space = AVENTURIA.coordinateSpace;
const projection = createRenderProjection(space);
// Dieselbe Maßstabs- und Breitenausgleichung wie server/terrain/dem-tiles.ts, aus dem Domain-Vertrag.
const meterJeSchritt =
    (2 * WEB_MERCATOR_HALF_WORLD) / ((space.bounds.maxX - space.bounds.minX) * space.distance.schrittPerUnit);

/** Was `halteKamera` von der Karte braucht (in Tests ersetzbar). */
export type KameraKarte = Pick<
    MapLibreMap,
    "getCenterClampedToGround" | "setCenterClampedToGround" | "once" | "triggerRepaint"
> & {
    readonly terrain: unknown;
};

/**
 * Die Kamera hält ihren Ort, solange die Höhen der Vorschau kommen oder gehen (Betreiber 2026-10-24: „wenn ich beim kämmeeditor der
 * gebirge auf "Kartenvorschau" gehe, … die gesamte Umgebung hebt sich an, während das gebirge absinkt“). Die Kacheln ändern außerhalb des
 * Gebirges keine Höhe (`mischeVorschau`); es war die Kamera: MapLibre legt die Höhe des Kartenmittelpunkts bei jeder neuen Geländekachel und in
 * jedem Bild auf den Boden darunter (`centerClampedToGround`, `_handleTerrainDataEvent`). Liegt die Mitte im Gebirge und die Vorschau ist
 * dort niedriger, sinkt die Kamera mit, und alles außen scheint um denselben Betrag zu steigen.
 *
 * Deshalb: Klemmen aus, bevor die Kacheln neu kommen; ist die Karte danach ruhig (`idle`), die Mitte auf den neuen Boden unter der Bildmitte
 * legen, ohne die Kamera zu bewegen (`recalculateZoomAndCenter`, wie MapLibre selbst am Ende einer Geste), und wieder klemmen. Ohne Gelände
 * (2D) und wenn jemand anderes das Klemmen schon hält (die Kamera beim Folgen, `camera.ts`), bleibt alles, wie es ist.
 */
export function halteKamera(map: KameraKarte, warte: (fertig: () => void) => () => void = idleOderFrist(map)): void {
    if (!map.terrain || !map.getCenterClampedToGround()) return;
    map.setCenterClampedToGround(false);
    warte(() => {
        if (map.getCenterClampedToGround()) return;
        // 🪤 Kein öffentlicher Weg: dieselbe Rechnung, die MapLibre nach einer Geste und nach `easeTo` ruft (`_finalizeElevation`).
        const kamera = (
            map as unknown as { _camera?: { transform?: { recalculateZoomAndCenter?(terrain: unknown): void } } }
        )._camera;
        if (map.terrain) kamera?.transform?.recalculateZoomAndCenter?.(map.terrain);
        map.setCenterClampedToGround(true);
        map.triggerRepaint();
    });
}

/** VORSCHLAG: Kommt die Karte so lange nicht zur Ruhe (eine laufende Animation), wird trotzdem wieder geklemmt. */
export const KAMERA_HALTEN_HOECHSTENS_MS = 3000;

/** Bis die Karte ruhig ist (`idle`, die neuen Kacheln sind da), höchstens `KAMERA_HALTEN_HOECHSTENS_MS`; einmal. */
function idleOderFrist(map: Pick<KameraKarte, "once">): (fertig: () => void) => () => void {
    return (fertig) => {
        let offen = true;
        const einmal = (): void => {
            if (!offen) return;
            offen = false;
            clearTimeout(frist);
            fertig();
        };
        const frist = setTimeout(einmal, KAMERA_HALTEN_HOECHSTENS_MS);
        map.once("idle", einmal);
        return einmal;
    };
}

/** Ein-/Ausblenden oder neuer Workerstand: sichtbare DEMs samt Zwischenspeicher aus der lokalen Quelle nachladen. */
export function setTerrainPreview(map: MapLibreMap, neu: VorschauErgebnis | undefined, faktor: 1 | 2 | 4 = 1): void {
    if (vorschau === neu && aufloesung === faktor) return;
    vorschau = neu;
    aufloesung = faktor;
    whenStyleTakesChanges(map, () => {
        if (vorschau !== neu || aufloesung !== faktor) return;
        halteKamera(map);
        const sources = map.getStyle().sources;
        for (const [id, source] of Object.entries(sources)) {
            if (source.type !== "raster-dem" || !source.tiles?.some((url) => url.startsWith("avesmaps-dem://")))
                continue;
            map.refreshTiles(id);
        }
        map.triggerRepaint();
    });
}

/** VORSCHLAG (WI-0249, „stanzt sich ein“): höchste Breite des Übergangs am Umriss (E). */
export const UEBERGANG_HOECHSTENS_E = 3;
/** VORSCHLAG: kleinste Breite des Übergangs (E), wie die kleinste Fase der Saat (`hebe`: `max(0,5, …)`). */
export const UEBERGANG_MINDESTENS_E = 0.5;

type VorschauRaster = Pick<VorschauErgebnis, "w" | "hh" | "cell" | "bounds" | "eigen" | "h">;

/**
 * Wie weit die Vorschau an jeder Zelle die bestehende Höhe ersetzt, 0 am Umriss bis 1 ab der Übergangsbreite (Betreiber 2026-10-24: „die
 * vorschau "stanzt" sich noch in die bestehende topographie ein“). Die Vorschau rechnet das Gebirge allein, mit 0 am Umriss (Fase der Saat,
 * `hebe`); das fertige Gelände stellt dieselbe Saat auf das Land darunter (Maximum bzw. `bette`, `initial-terrain.ts`), am Umriss gilt also
 * das Land. Am Fuß steht die Vorschau deshalb wie dort auf der bestehenden Höhe (`mischeVorschau`), nach innen ersetzt sie sie über die
 * Breite, in der die Saat ansteigt: `min(Randbreite, 0,4 · größter Randabstand)` des Modells, genähert mit `0,4 · größter Randabstand`
 * zwischen `UEBERGANG_MINDESTENS_E` und `UEBERGANG_HOECHSTENS_E`. Glatt (`smoothstep` über den Abstand zum Umriss, Chamfer-Abstand).
 */
export function randGewicht(r: Pick<VorschauRaster, "w" | "hh" | "cell" | "eigen">): Float32Array {
    const { w, hh } = r;
    const d = new Float32Array(w * hh);
    const diagonal = Math.SQRT2;
    for (let j = 0; j < hh; j++)
        for (let i = 0; i < w; i++) {
            const k = j * w + i;
            // Der Rand des Rasters zählt wie eine Zelle außerhalb der Fläche.
            d[k] = r.eigen[k] === 1 ? Math.min(i + 1, j + 1, w - i, hh - j) : 0;
        }
    const nimm = (k: number, m: number, kosten: number): void => {
        const neu = (d[m] as number) + kosten;
        if (neu < (d[k] as number)) d[k] = neu;
    };
    for (let j = 0; j < hh; j++)
        for (let i = 0; i < w; i++) {
            const k = j * w + i;
            if (d[k] === 0) continue;
            if (i > 0) nimm(k, k - 1, 1);
            if (j > 0) {
                nimm(k, k - w, 1);
                if (i > 0) nimm(k, k - w - 1, diagonal);
                if (i < w - 1) nimm(k, k - w + 1, diagonal);
            }
        }
    let groesster = 0;
    for (let j = hh - 1; j >= 0; j--)
        for (let i = w - 1; i >= 0; i--) {
            const k = j * w + i;
            if (d[k] === 0) continue;
            if (i < w - 1) nimm(k, k + 1, 1);
            if (j < hh - 1) {
                nimm(k, k + w, 1);
                if (i < w - 1) nimm(k, k + w + 1, diagonal);
                if (i > 0) nimm(k, k + w - 1, diagonal);
            }
            groesster = Math.max(groesster, d[k] as number);
        }
    const breite = Math.min(UEBERGANG_HOECHSTENS_E, Math.max(UEBERGANG_MINDESTENS_E, 0.4 * groesster * r.cell));
    const gewicht = new Float32Array(w * hh);
    for (let k = 0; k < gewicht.length; k++) {
        if (d[k] === 0) continue;
        // Die erste Zelle der Fläche trägt noch 0: Bis zu ihrer Mitte, über den Umriss hinweg, gilt die bestehende Höhe genau.
        const t = Math.max(0, Math.min(1, (((d[k] as number) - 1) * r.cell) / breite));
        gewicht[k] = t * t * (3 - 2 * t);
    }
    return gewicht;
}

const gewichte = new WeakMap<VorschauRaster, Float32Array>();
const gewichtVon = (r: VorschauRaster): Float32Array => {
    let g = gewichte.get(r);
    if (g === undefined) {
        g = randGewicht(r);
        gewichte.set(r, g);
    }
    return g;
};

/**
 * Bilineare Interpolation mit Eigenmaske: keine fremde Fläche, keine Werte aus der transparenten Umgebung. `alpha` ist der Anteil der Fläche
 * (0 an der Mitte einer Zelle außen, 1 ab der ersten Zelle innen), `anteil`, wie weit die Vorschau hier die bestehende Höhe ersetzt: Maske
 * mal Übergang am Umriss (`randGewicht`).
 */
function sample(
    r: VorschauRaster,
    gewicht: Float32Array,
    x: number,
    y: number,
): { h: number; alpha: number; anteil: number } | undefined {
    const u = (x - r.bounds.min_x) / r.cell;
    const v = (y - r.bounds.min_y) / r.cell;
    if (u < 0 || v < 0 || u > r.w - 1 || v > r.hh - 1) return undefined;
    const i = Math.min(r.w - 2, Math.floor(u));
    const j = Math.min(r.hh - 2, Math.floor(v));
    if (i < 0 || j < 0) return undefined;
    const fx = u - i;
    const fy = v - j;
    let h = 0;
    let alpha = 0;
    let g = 0;
    for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
            const k = (j + dy) * r.w + i + dx;
            if (r.eigen[k] !== 1 || !Number.isFinite(r.h[k])) continue;
            const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
            h += r.h[k]! * weight;
            g += gewicht[k]! * weight;
            alpha += weight;
        }
    return alpha > 0 ? { h: h / alpha, alpha, anteil: g } : undefined;
}

/**
 * Mischt die Vorschau in die Pixel einer Geländekachel (Mapbox-Kodierung, `rgba` wird überschrieben): außerhalb des Gebirges nichts, am
 * Umriss die bestehende Höhe, am Fuß das Maximum aus ihr und der Vorschau (wie das fertige Gelände Saat und Land verbindet), nach innen
 * stetig die Vorschau allein (`randGewicht`; dort ersetzt sie ein bestehendes Gebirge, auch wo es höher war). Gibt zurück, ob sich ein
 * Pixel änderte.
 */
export function mischeVorschau(
    rgba: Uint8ClampedArray,
    breite: number,
    hoehe: number,
    tile: TerrainTileId,
    r: VorschauRaster,
): boolean {
    const n = 2 ** tile.z;
    const at = (u: number, v: number) =>
        projection.fromRender({
            x: (2 * u - 1) * WEB_MERCATOR_HALF_WORLD,
            y: (1 - 2 * v) * WEB_MERCATOR_HALF_WORLD,
        });
    const nw = at(tile.x / n, tile.y / n);
    const se = at((tile.x + 1) / n, (tile.y + 1) / n);
    const gewicht = gewichtVon(r);
    let changed = false;
    for (let py = 0; py < hoehe; py++) {
        const v = (tile.y + (py + 0.5) / hoehe) / n;
        const y = at(0, v).y;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * v)));
        const factor = meterJeSchritt * Math.cos(lat);
        for (let px = 0; px < breite; px++) {
            const x = nw.x + (se.x - nw.x) * ((px + 0.5) / breite);
            const value = sample(r, gewicht, x, y);
            if (!value) continue;
            const k = (py * breite + px) * 4;
            const original = (rgba[k]! * 65536 + rgba[k + 1]! * 256 + rgba[k + 2]!) * 0.1 - 10000;
            const vorschau = value.h * factor;
            const fuss = original + value.alpha * Math.max(0, vorschau - original);
            const meters = fuss * (1 - value.anteil) + vorschau * value.anteil;
            const encoded = Math.max(0, Math.min(16777215, Math.round((meters + 10000) * 10)));
            rgba[k] = (encoded >> 16) & 255;
            rgba[k + 1] = (encoded >> 8) & 255;
            rgba[k + 2] = encoded & 255;
            rgba[k + 3] = 255;
            changed = true;
        }
    }
    return changed;
}

/** Originalbytes nur für überlappende Kacheln lokal überschreiben. MapLibre erhält verlustfreies Mapbox-DEM. */
export async function previewTerrainTile(tile: TerrainTileId, bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const r = vorschau;
    const faktor = aufloesung;
    if (!r || bytes.byteLength === 0) return bytes;
    const n = 2 ** tile.z;
    const at = (u: number, v: number) =>
        projection.fromRender({
            x: (2 * u - 1) * WEB_MERCATOR_HALF_WORLD,
            y: (1 - 2 * v) * WEB_MERCATOR_HALF_WORLD,
        });
    const nw = at(tile.x / n, tile.y / n);
    const se = at((tile.x + 1) / n, (tile.y + 1) / n);
    if (
        Math.max(nw.x, se.x) < r.bounds.min_x ||
        Math.min(nw.x, se.x) > r.bounds.max_x ||
        Math.max(nw.y, se.y) < r.bounds.min_y ||
        Math.min(nw.y, se.y) > r.bounds.max_y
    )
        return bytes;
    const image = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement("canvas");
    // Alle Kacheln einer DEM-Quelle müssen dieselbe Größe behalten: wechselnde Größen
    // beschädigen MapLibres Gelände-/Hillshade-Texturen auch außerhalb der Vorschau.
    // Die gewählte Workerauflösung verbessert die Abtastung innerhalb dieser festen Kachel.
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
        image.close();
        return bytes;
    }
    // RGB ist eine gepackte Zahl, kein Farbbild: Interpolation der Kanäle verfälscht Höhen.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const changed = mischeVorschau(pixels.data, canvas.width, canvas.height, tile, r);
    if (vorschau !== r || aufloesung !== faktor) return previewTerrainTile(tile, bytes);
    if (!changed) return bytes;
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("Höhenvorschau konnte nicht kodiert werden"))),
            "image/png",
        ),
    );
    if (vorschau !== r || aufloesung !== faktor) return previewTerrainTile(tile, bytes);
    return blob.arrayBuffer();
}
