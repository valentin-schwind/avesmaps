import type {
    ExpressionSpecification,
    GeoJSONSource,
    GeoJSONSourceSpecification,
    LineLayerSpecification,
} from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    GARETH_KARTENPUNKT,
    MEILEN_JE_EINHEIT,
    canonColour,
    fromRenderLngLat,
    toRenderLngLat,
} from "@avesmaps3d/shared";
import type { MapPoint } from "@avesmaps3d/shared";

/**
 * Das Hexraster (WI-0273, Auge › Ebenen › Hexraster): Sechseckfelder über der Karte, zum Abschätzen von Reisen wie auf
 * einer Spielkarte. Es schließt das Gradnetz aus (Betreiber 2026-10-31: „als zusätzliche option (welche gradnetz
 * deaktiviert)“), die Feldgröße stellt ein Regler darunter ein.
 *
 * - Die Felder stehen mit der flachen Seite oben, die Größe misst von Seite zu Seite (so nennt man ein „10-Meilen-Feld“).
 *   Gareth liegt in jeder Größe in der Mitte eines Feldes.
 * - Gerechnet wird nur um die Sicht herum, nach jeder Kamerabewegung neu, wenn die Sicht den gerechneten Bereich verlässt:
 *   Über ganz Aventurien wären es bei einer Meile Millionen Felder. Wie das Gradnetz eine Linienebene, damit sie auf dem
 *   Gelände liegt.
 * - Zu dicht wird es nicht: Unter `DICHT_PX` Bildpunkten je Feld blendet die Ebene aus, darunter wird nichts gerechnet.
 *
 * Reine Anzeige wie das Gradnetz: nie Grundlage für Entfernungen, Routen oder gespeicherte Geometrie.
 */
export const HEXRASTER_SOURCE_ID = "hexraster";

/**
 * Weiß über der Karte, dunkel in der Derographie (Betreiber 2026-10-31: „das hex-grid selbst in weiß“, dann „kannst du das
 * hexmuster dunkel färben wenn eine derographischen ansichten an ist“): Deren helle Flächen schlucken eine weiße Linie. Dunkel ist
 * die Tinte des Gradnetzes (`gradnetz.ts`), keine eigene Farbe.
 */
export type HexrasterTinte = "hell" | "dunkel";
export const HEXRASTER_LAYER_ID = "hexraster";

/** Die Feldgrößen des Reglers in Meilen, von Seite zu Seite. */
export const HEXRASTER_MEILEN: readonly number[] = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
export const HEXRASTER_VORGABE = 10;

/** Gareth, die Mitte des Feldes, von dem aus das Raster läuft; derselbe Punkt ist der Nullpunkt des Gradnetzes. */
const GARETH: MapPoint = GARETH_KARTENPUNKT;
const EXTENT = 1024;
/** Bildpunkte je Einheit bei Zoom 0: Die Welt misst `512 · 2^z` Bildpunkte über 1024 Einheiten. */
const PX_JE_EINHEIT_ZOOM_0 = 512 / EXTENT;
/** Ab hier blendet die Ebene ein, ab `DICHT_PX + EINBLENDEN_PX` steht sie voll; darunter wird nichts gerechnet. */
const DICHT_PX = 8;
const EINBLENDEN_PX = 16;
// Wie die Hauptlinien des Gradnetzes: Über dem dunklen Wald der modernen Serie verschwinden feinere Linien.
const DECKKRAFT = 0.75;
const BREITE = 1.2;
/** Rund so viele Felder auf einmal (je vier Stützpunkte, dazu die angeschnittenen am Rand), damit die Quelle rasch steht. */
const HOECHSTENS = 15_000;
/** Um die Sicht wird je Seite die halbe Sichtbreite mitgerechnet, damit ein Schwenk nicht sofort neu rechnet. */
const RAND = 0.5;

/** Die nächste Feldgröße des Reglers; was keine Zahl ist, wird die Vorgabe. */
export function hexrasterMeilen(wert: number): number {
    if (!Number.isFinite(wert) || wert <= 0) return HEXRASTER_VORGABE;
    let beste = HEXRASTER_VORGABE;
    for (const meilen of HEXRASTER_MEILEN) {
        if (Math.abs(Math.log(meilen / wert)) < Math.abs(Math.log(beste / wert))) beste = meilen;
    }
    return beste;
}

export interface Bereich {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Breite eines Feldes von Seite zu Seite in Karteneinheiten. */
function feldbreite(meilen: number): number {
    return meilen / MEILEN_JE_EINHEIT;
}

/** Fläche eines Feldes in Karteneinheiten². */
function feldflaeche(meilen: number): number {
    const d = feldbreite(meilen);
    return (Math.sqrt(3) / 2) * d * d;
}

/**
 * Die Kanten aller Felder, die ganz im Bereich und ganz in der Karte liegen. Jedes Feld bringt seine drei oberen Kanten
 * als einen Zug (links, oben, rechts); die unteren sind die oberen der Nachbarn darunter, so steht jede Kante einmal.
 */
export function hexrasterKanten(meilen: number, bereich: Bereich): MapPoint[][] {
    const d = feldbreite(meilen);
    const r = d / Math.sqrt(3);
    const spalte = 1.5 * r;
    const halb = d / 2;
    const innen = (p: MapPoint): boolean => p.x >= 0 && p.x <= EXTENT && p.y >= 0 && p.y <= EXTENT;
    const kanten: MapPoint[][] = [];
    const c0 = Math.floor((bereich.minX - GARETH.x) / spalte) - 1;
    const c1 = Math.ceil((bereich.maxX - GARETH.x) / spalte) + 1;
    const r0 = Math.floor((bereich.minY - GARETH.y) / d) - 1;
    const r1 = Math.ceil((bereich.maxY - GARETH.y) / d) + 1;
    for (let c = c0; c <= c1; c += 1) {
        const x = GARETH.x + c * spalte;
        const versatz = Math.abs(c) % 2 === 1 ? halb : 0;
        if (x + r < bereich.minX || x - r > bereich.maxX) continue;
        for (let z = r0; z <= r1; z += 1) {
            const y = GARETH.y + z * d + versatz;
            if (y + halb < bereich.minY || y - halb > bereich.maxY) continue;
            const zug = [
                { x: x - r, y },
                { x: x - r / 2, y: y + halb },
                { x: x + r / 2, y: y + halb },
                { x: x + r, y },
            ];
            // Nur Felder ganz in der Karte: Jenseits des Rands läge eine Länge über 180°, und MapLibre schlüge sie um.
            if (zug.every(innen)) kanten.push(zug);
        }
    }
    return kanten;
}

function schneide(a: Bereich, b: Bereich): Bereich {
    return {
        minX: Math.max(a.minX, b.minX),
        minY: Math.max(a.minY, b.minY),
        maxX: Math.min(a.maxX, b.maxX),
        maxY: Math.min(a.maxY, b.maxY),
    };
}

const KARTE: Bereich = { minX: 0, minY: 0, maxX: EXTENT, maxY: EXTENT };

/**
 * Der Bereich, der gerechnet wird: die Sicht samt Rand, in der Karte, und höchstens `hoechstens` Felder groß. Ist er
 * größer (weit hinaus oder stark geneigt), bleibt ein Quadrat um die Mitte der Kamera; in der Ferne sind die Felder dann
 * ohnehin kleiner als ein paar Bildpunkte.
 */
export function rechenbereich(
    sicht: Bereich,
    mitte: MapPoint,
    meilen: number,
    rand = RAND,
    hoechstens = HOECHSTENS,
): Bereich {
    const breite = sicht.maxX - sicht.minX;
    const hoehe = sicht.maxY - sicht.minY;
    const weit = schneide(
        {
            minX: sicht.minX - rand * breite,
            minY: sicht.minY - rand * hoehe,
            maxX: sicht.maxX + rand * breite,
            maxY: sicht.maxY + rand * hoehe,
        },
        KARTE,
    );
    const flaeche = Math.max(0, weit.maxX - weit.minX) * Math.max(0, weit.maxY - weit.minY);
    if (flaeche / feldflaeche(meilen) <= hoechstens) return weit;
    const halbeSeite = Math.sqrt(hoechstens * feldflaeche(meilen)) / 2;
    return schneide(weit, {
        minX: mitte.x - halbeSeite,
        minY: mitte.y - halbeSeite,
        maxX: mitte.x + halbeSeite,
        maxY: mitte.y + halbeSeite,
    });
}

export function enthaelt(aussen: Bereich, innen: Bereich): boolean {
    return (
        aussen.minX <= innen.minX && aussen.minY <= innen.minY && aussen.maxX >= innen.maxX && aussen.maxY >= innen.maxY
    );
}

/** Bildpunkte von Seite zu Seite bei diesem Zoom. */
export function feldPx(meilen: number, zoom: number): number {
    return feldbreite(meilen) * PX_JE_EINHEIT_ZOOM_0 * 2 ** zoom;
}

/** Die Quelle als eigener kleiner Typ: Ein Import aus `geojson` macht den Typcheck fremder Dateien rot. */
export interface HexrasterDaten {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        properties: { px0: number };
        geometry: { type: "MultiLineString"; coordinates: [number, number][][] };
    }[];
}

type Linien = HexrasterDaten;

/** Keine Linien: vor der ersten Rechnung und wo die Felder zu dicht stünden. */
export const HEXRASTER_LEER: Linien = { type: "FeatureCollection", features: [] };
const LEER = HEXRASTER_LEER;

export function hexrasterDaten(meilen: number, bereich: Bereich): Linien {
    const punkt = (p: MapPoint): [number, number] => {
        const at = toRenderLngLat(AVENTURIA.coordinateSpace, p);
        return [at.lng, at.lat];
    };
    const kanten = hexrasterKanten(meilen, bereich);
    if (kanten.length === 0) return LEER;
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: { px0: feldPx(meilen, 0) },
                geometry: { type: "MultiLineString", coordinates: kanten.map((zug) => zug.map(punkt)) },
            },
        ],
    };
}

export function buildHexrasterSource(daten: Linien): GeoJSONSourceSpecification {
    return { type: "geojson", data: daten };
}

/**
 * Die Deckkraft folgt der Feldgröße auf dem Schirm: unsichtbar unter `DICHT_PX`, voll ab `DICHT_PX + EINBLENDEN_PX`. Die
 * Größe steht an der Linie (`px0`, Bildpunkte bei Zoom 0), daher bleibt die Ebene beim Ziehen am Regler dieselbe; nur die
 * Daten wechseln. Zwischen zwei ganzen Zoomstufen verdoppelt sich die Größe, linear dazwischen genügt fürs Einblenden.
 */
export function buildHexrasterLayer(tinte: HexrasterTinte = "hell"): LineLayerSpecification {
    const stopps: (number | ExpressionSpecification)[] = [];
    for (let zoom = 0; zoom <= 14; zoom += 1) {
        const px: ExpressionSpecification = ["*", ["get", "px0"], 2 ** zoom];
        stopps.push(zoom, ["*", DECKKRAFT, ["min", 1, ["max", 0, ["/", ["-", px, DICHT_PX], EINBLENDEN_PX]]]]);
    }
    return {
        id: HEXRASTER_LAYER_ID,
        type: "line",
        source: HEXRASTER_SOURCE_ID,
        layout: { "line-cap": "butt", "line-join": "miter" },
        paint: {
            "line-color": canonColour(tinte === "dunkel" ? "text" : "mapHexGrid"),
            "line-width": BREITE,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], ...stopps] as ExpressionSpecification,
        },
    };
}

export interface Hexraster {
    /** Die Linien, wie sie gerade stehen: Der Stil bringt sie bei jedem Umbau mit, sonst leerte ein Stilwechsel die Quelle. */
    daten(): Linien;
    /** Nach Schalter oder Regler: neu rechnen, wenn die Sicht es verlangt. */
    aktualisiere(): void;
    entferne(): void;
}

/** Die Sicht in Karteneinheiten: das Rechteck um die vier Bildecken, wie MapLibre es nennt, auch gedreht und geneigt. */
function sichtbereich(map: MapLibreMap): Bereich {
    const grenzen = map.getBounds();
    const a = fromRenderLngLat(AVENTURIA.coordinateSpace, grenzen.getSouthWest());
    const b = fromRenderLngLat(AVENTURIA.coordinateSpace, grenzen.getNorthEast());
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export function installHexraster(map: MapLibreMap, optionen: { meilen: () => number | undefined }): Hexraster {
    let stand: { meilen: number; bereich: Bereich | undefined; daten: Linien } | undefined;

    const setze = (meilen: number, bereich: Bereich | undefined, daten: Linien): void => {
        stand = { meilen, bereich, daten };
        (map.getSource(HEXRASTER_SOURCE_ID) as GeoJSONSource | undefined)?.setData(daten);
    };

    const aktualisiere = (): void => {
        const meilen = optionen.meilen();
        if (meilen === undefined) return;
        if (feldPx(meilen, map.getZoom()) < DICHT_PX) {
            if (stand?.meilen !== meilen || stand.bereich !== undefined) setze(meilen, undefined, LEER);
            return;
        }
        const sicht = sichtbereich(map);
        const mitte = fromRenderLngLat(AVENTURIA.coordinateSpace, map.getCenter());
        // Gebraucht wird die Sicht ohne Rand; gerechnet wird mit Rand und dem doppelten Vorrat an Feldern.
        const noetig = rechenbereich(sicht, mitte, meilen, 0, HOECHSTENS / 2);
        if (stand?.meilen === meilen && stand.bereich !== undefined && enthaelt(stand.bereich, noetig)) return;
        const bereich = rechenbereich(sicht, mitte, meilen);
        setze(meilen, bereich, hexrasterDaten(meilen, bereich));
    };

    map.on("moveend", aktualisiere);
    map.on("resize", aktualisiere);
    // Der erste Stil entsteht vor dieser Steuerung, mit leerer Quelle: Steht er, bekommt sie die Linien, auch schon gerechnete.
    map.once("load", () => {
        aktualisiere();
        if (stand) (map.getSource(HEXRASTER_SOURCE_ID) as GeoJSONSource | undefined)?.setData(stand.daten);
    });
    return {
        daten: () => stand?.daten ?? LEER,
        aktualisiere,
        entferne: () => {
            map.off("moveend", aktualisiere);
            map.off("resize", aktualisiere);
        },
    };
}
