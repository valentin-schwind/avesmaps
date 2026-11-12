import {
    AVENTURIA,
    gebirgsRegler,
    punktHoehen,
    rueckennetzRegler,
    toRenderLngLat,
    type PunktHoehen,
} from "@avesmaps3d/shared";
import { formatNumber } from "../i18n/i18n";
import type { VorschauErgebnis } from "../gebirge-vorschau/auftrag";
import type { AnlegenPunkt } from "../map/geometrie/anlegen";
import { vorschauTalboden } from "./gebirge-anzeige";
import { GEBIRGE_LEER, geltendeKammhoehe, type GebirgsEntwurf } from "./gebirge-stand";
import { eingabeMitGipfeln } from "./gebirge-vorschau-bild";
import type { KammNetzLauf } from "./kamm-netz-anbindung";
import { eigeneHoehe, hoehenOrte, LEERES_NETZ, type GebirgsNetz, type NetzPunkt } from "./kamm-netz";
import { KEIN_GEWAESSER, type Gewaesser } from "./kamm-netz-wasser";
import { gebirgeGelesen, type LandschaftFelder } from "./landschaft-art";

/**
 * Die Höhen des Kammeditors (WI-0249 P9): Kammhöhe, Talboden und die Höhe jedes Punkts, die gilt (eigen oder Vorgabe), aus dem Entwurf und
 * dem, was der Reiter liest (`KammNetzLauf.daten`). Dazu die Höhe eines neuen, eingerasteten Punkts und die Beschriftung auf der Karte. Reine Rechnung über
 * dem Lauf; was die Karte zeichnet, steht in `kamm-netz-anbindung.ts`.
 */

const KEINE_HOEHEN: PunktHoehen = { linien: [], nebengipfel: [], mulden: [] };

/** Das Gebirge dieser Teilfläche im Entwurf, sonst wie gelesen. */
export function standVon(felder: LandschaftFelder | undefined, l: KammNetzLauf): GebirgsEntwurf {
    const detail = l.bearbeitung.detail.value;
    return felder?.gebirge?.[l.flaeche] ?? (detail === undefined ? GEBIRGE_LEER : gebirgeGelesen(detail, l.flaeche));
}

/** Das Netz im Entwurf. */
export const netzVon = (l: KammNetzLauf | undefined): GebirgsNetz =>
    l === undefined ? LEERES_NETZ : (standVon(l.bearbeitung.stand.value?.felder, l).netz ?? LEERES_NETZ);

/** Die Kammhöhe, die im Entwurf gilt (wie der Reiter „Gebirge“). */
export function kammhoeheVon(l: KammNetzLauf | undefined): number {
    if (l === undefined) return geltendeKammhoehe(GEBIRGE_LEER, null);
    return geltendeKammhoehe(standVon(l.bearbeitung.stand.value?.felder, l), l.daten?.grundhoehe ?? null);
}

/** Der Talboden, der gilt: der eigene, der zuletzt in der Vorschau abgeleitete, sonst der des Typs. */
function talbodenVon(l: KammNetzLauf, stand: GebirgsEntwurf): number {
    if (stand.modell?.talboden !== undefined) return stand.modell.talboden;
    const vorschau = vorschauTalboden.value;
    if (vorschau?.flaeche === l.flaeche) return vorschau.talboden;
    return rueckennetzRegler(l.daten?.presets.gruppe ?? null, stand.typ, stand.modell ?? {}).form.talboden;
}

/** Die Höhe jedes Punkts von `netz`, die gilt: eigen oder die Vorgabe der Rechnung (`punktHoehen`). */
export function hoehenVon(l: KammNetzLauf | undefined, netz: GebirgsNetz): PunktHoehen {
    if (l === undefined) return KEINE_HOEHEN;
    const felder = l.bearbeitung.stand.value?.felder;
    const stand = standVon(felder, l);
    const daten = l.daten;
    const peaks =
        daten === undefined
            ? []
            : eingabeMitGipfeln(daten.eingabe, l.bearbeitung.detail.value?.peaks ?? [], felder?.gipfelHoehen ?? {})
                  .peaks;
    const preset = stand.typ === null || daten === undefined ? null : daten.presets.gruppe.typen[stand.typ];
    return punktHoehen(netz, {
        kammhoehe: kammhoeheVon(l),
        peaks,
        talboden: talbodenVon(l, stand),
        sattel: gebirgsRegler(preset, stand, daten?.grundhoehe ?? null).sattel,
    });
}

/**
 * Die Höhe eines neuen Kammpunkts (WI-0249; Vali wählte: kein Startwert, 2026-10-26): Ein neuer Punkt hat keine eigene Höhe. Nur eingerastet an
 * einem Stützpunkt, Nebengipfel oder einer Mulde mit eigener Höhe trägt er dieselbe (ein Ort, eine Höhe); sonst `null`.
 */
export function eingerasteteHoehe(netz: GebirgsNetz, p: AnlegenPunkt): number | null {
    const stelle = p.ziel?.stelle;
    return stelle === undefined ? null : (eigeneHoehe(netz, stelle) ?? null);
}

const space = AVENTURIA.coordinateSpace;

/** Das Raster einer Vorschau (`VorschauErgebnis`): Zeile `j` bei `bounds.min_y + j · cell`, `eigen` 1 in der Fläche. */
export type FlaechenRaster = Pick<VorschauErgebnis, "w" | "hh" | "cell" | "bounds" | "eigen" | "h">;

/**
 * Die Höhe der Fläche an einem Punkt (Schritt), bilinear über die Zellen der Fläche (wie die Vorschau auf der Karte, `terrain-preview.ts`);
 * `undefined` außerhalb des Rasters oder ohne Zelle der Fläche ringsum.
 */
export function hoeheIn(r: FlaechenRaster, x: number, y: number): number | undefined {
    const u = (x - r.bounds.min_x) / r.cell;
    const v = (y - r.bounds.min_y) / r.cell;
    if (!(u >= 0 && v >= 0 && u <= r.w - 1 && v <= r.hh - 1)) return undefined;
    const i = Math.max(0, Math.min(r.w - 2, Math.floor(u)));
    const j = Math.max(0, Math.min(r.hh - 2, Math.floor(v)));
    const fx = u - i;
    const fy = v - j;
    let h = 0;
    let anteil = 0;
    for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
            const k = (j + dy) * r.w + i + dx;
            const wert = r.h[k];
            if (r.eigen[k] !== 1 || wert === undefined || !Number.isFinite(wert)) continue;
            const g = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
            h += wert * g;
            anteil += g;
        }
    return anteil > 0 ? h / anteil : undefined;
}

/** Eine Beschriftung der Höhe als Punkt der Karte: `text` die Zahl; `eigen`: eine eigene Höhe (kräftig), sonst die des Geländes (blass). */
export interface HoehenMarke {
    type: "Feature";
    properties: { text: string; eigen: boolean };
    geometry: { type: "Point"; coordinates: [number, number] };
}

/**
 * Die Höhen über den Punkten als GeoJSON: alle Orte mit „Höhen beschriften“, sonst nur die gerade gezogenen (`gezogen`).
 *
 * Was dasteht (WI-0249; Vali wählte 2026-10-26: Die Zahl am Punkt zeigt die Höhe des Geländes, erst ein gesetzter oder gezogener Wert wird
 * eigen): je Ort eine Zahl. Mit eigener Höhe die eigene, kräftig (die Fläche trifft sie, `treffen.ts`); ohne die Höhe des Geländes am Punkt
 * aus derselben Rechnung, die die Karte gerade zeigt (`flaeche`, die Vorschau), blass wie die Vorgabe im Feld der Leiste. Ohne Vorschau steht
 * an einem Punkt ohne eigene Höhe keine Zahl, statt einer erfundenen.
 */
export function hoehenBeschriftung(
    netz: GebirgsNetz,
    hoehen: PunktHoehen,
    alle: boolean,
    gezogen: readonly NetzPunkt[],
    flaeche?: FlaechenRaster,
    gew: Gewaesser = KEIN_GEWAESSER,
): { type: "FeatureCollection"; features: HoehenMarke[] } {
    const schluessel = new Set(gezogen.map((p) => `${String(p.nr)}:${String(p.index)}`));
    const orte = !alle && schluessel.size === 0 ? [] : hoehenOrte(netz, hoehen, gew);
    // Gleiche Zahlen nur einmal formatiert (`toLocaleString` baut je Aufruf ein Format; beim Ziehen je Bewegung und Ort).
    const formatiert = new Map<number, string>();
    const zahl = (h: number): string => {
        const ganz = Math.round(h);
        let text = formatiert.get(ganz);
        if (text === undefined) {
            text = formatNumber(ganz, 0);
            formatiert.set(ganz, text);
        }
        return text;
    };
    return {
        type: "FeatureCollection",
        features: orte
            .filter((ort) => alle || ort.punkte.some((p) => schluessel.has(`${String(p.nr)}:${String(p.index)}`)))
            .flatMap((ort): HoehenMarke[] => {
                const wert = ort.eigen
                    ? ort.h
                    : flaeche === undefined
                      ? undefined
                      : hoeheIn(flaeche, ort.at.x, ort.at.y);
                if (wert === undefined || !Number.isFinite(wert)) return [];
                const render = toRenderLngLat(space, ort.at);
                return [
                    {
                        type: "Feature",
                        properties: { text: zahl(wert), eigen: ort.eigen },
                        geometry: { type: "Point", coordinates: [render.lng, render.lat] },
                    },
                ];
            }),
    };
}
