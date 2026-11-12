import { isPhoneViewport } from "../controls/phone-viewport";
import type { FilterSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    LEGACY_POLITICAL_MAX_BAND,
    politicalBandForCameraZoom,
    type TerritoryPointer,
} from "@avesmaps3d/shared";

/**
 * Das Band der Herrschaftsgebiete: EIN Wert für die ganze Ansicht, aus dem Kamerazoom (WI-0062 Nachtrag, Betreiber
 * 2026-09-30).
 *
 * 🔴 Warum nicht der Zoom der Kachel, nicht `["zoom"]` in einem Filter und nicht `minzoom`/`maxzoom` an der Ebene: All das
 * rechnet MapLibre mit dem ZOOM DER KACHEL. Mit Gelände lädt es in der geneigten Ansicht die fernen Kacheln in niedrigerem
 * Zoom (Level of Detail, gemessen bei 60° zwei Stufen tiefer), und jede Kachel hätte ihr eigenes Band: Die Grafschaft endet
 * an einer geraden Linie, Grenzen hören mitten im Bild auf. `minzoom` und `maxzoom` einer Ebene bauen in der Kachel sogar
 * gar keine Geometrie, wo der Kachelzoom außerhalb liegt (WorkerTile: `layer.isHidden(this.zoom, true)`).
 *
 * Die Kacheln tragen darum ALLE Bänder mit ihrer Bandnummer (`band` bis `band_to`); der Stil filtert auf den globalen
 * Zustand `territoryBand`, den diese Datei aus dem Kamerazoom (dem Abstand der Kamera zur Oberfläche) nachführt. Ein
 * Wechsel liest die geladenen Kacheln neu aus, ohne sie neu zu holen; die alten Ebenen bleiben stehen, bis die neuen da sind.
 */

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;

/** Der Name des globalen Zustands im Stil (`["global-state", …]`). */
export const TERRITORY_BAND_STATE = "territoryBand";

/**
 * Der Vorzug der Bänder für DIESES Gerät: am Telefon `bandLeadZoomPhone`, sonst `bandLeadZoom` (Betreiber 2026-09-30:
 * Baronien am Telefon ab Zoom 4, am Rechner ab Zoom 5). Die EINE Stelle, die das Gerät fragt.
 */
export function territoryBandLead(phone: boolean = isPhoneViewport()): number {
    return phone ? POLITICAL.bandLeadZoomPhone : POLITICAL.bandLeadZoom;
}

/**
 * Das höchste Band, das die Ableitung trägt (Gebietszeiger `maxBand`, WI-0188). Ohne Zeiger oder ohne Angabe (ein Server vor
 * WI-0188) gilt Legacys 6: so weit reichte jede frühere Ableitung.
 */
let derivedMaxBand: number = LEGACY_POLITICAL_MAX_BAND;

/**
 * Übernimmt aus dem Gebietszeiger, bis zu welchem Band abgeleitet ist (beim Laden, `territory-pointer.ts`). Die Karte zeigt
 * nie ein höheres Band: Nach dem Ausrollen von Band 8 bleibt eine Umgebung bei Band 6 für jeden höheren Zoom, bis ihr
 * Gebietsimport und ihre Ableitung die Bänder 7 und 8 bringen.
 */
export function rememberDerivedMaxBand(pointer: TerritoryPointer | undefined): void {
    derivedMaxBand = pointer?.maxBand ?? LEGACY_POLITICAL_MAX_BAND;
}

/** Das höchste Band, das die Karte zeigt: das der Tafel, höchstens das abgeleitete. */
export function territoryMaxBand(): number {
    return Math.min(POLITICAL.maxBand, derivedMaxBand);
}

/** Das Band, das die Karte bei diesem Kamerazoom zeigt (Kamerazoom − 1 + Vorzug des Geräts, 0 bis `territoryMaxBand`). */
export function territoryBandForZoom(zoom: number, lead: number = territoryBandLead()): number {
    return politicalBandForCameraZoom(zoom, territoryMaxBand(), lead);
}

/** Das Band der Ansicht als Ausdruck; ein Wechsel liest jede Ebene neu, die ihn nennt. */
export const VIEW_BAND = ["number", ["global-state", TERRITORY_BAND_STATE]] as const;

/** Gilt eine Zeile mit Durchlauf `band` bis `band_to` im Band der Ansicht? */
export const IN_VIEW_BAND = ["all", ["<=", ["get", "band"], VIEW_BAND], [">=", ["get", "band_to"], VIEW_BAND]] as const;

/** Gilt eine Zeile mit genau einem Band (die Schraffur, deren Muster am Band hängt) im Band der Ansicht? */
export const IS_VIEW_BAND = ["==", ["get", "band"], VIEW_BAND] as const;

/** Ist das Band der Ansicht mindestens `band`? (Namen entlang der Grenze, Stärken je Band.) */
export function viewBandAtLeast(band: number): FilterSpecification {
    return [">=", VIEW_BAND, band] as unknown as FilterSpecification;
}

/** Filter: im Band der Ansicht, dazu die übrigen Bedingungen. */
export function inViewBand(...conditions: unknown[]): FilterSpecification {
    return ["all", IN_VIEW_BAND, ...conditions] as unknown as FilterSpecification;
}

/**
 * Dasselbe für ein festes Band, für Abfragen an geladenen Kacheln (`querySourceFeatures` kennt den Zustand des Stils
 * nicht): `band ≤ Band ≤ band_to`, dazu die übrigen Bedingungen.
 */
export function inBand(band: number, ...conditions: unknown[]): FilterSpecification {
    return [
        "all",
        ["<=", ["get", "band"], band],
        [">=", ["get", "band_to"], band],
        ...conditions,
    ] as unknown as FilterSpecification;
}

/** Der Anfangswert des Zustands im Stil: das Band des Zooms, mit dem der Stil gebaut wird. */
export function withTerritoryBand(style: StyleSpecification, zoom: number): StyleSpecification {
    return { ...style, state: { ...style.state, [TERRITORY_BAND_STATE]: { default: territoryBandForZoom(zoom) } } };
}

/**
 * Führt den Zustand mit der Kamera nach: bei jedem Zoom, nach dem Laden und wenn der Stil wechselt. Der Aufruf ändert
 * nichts und kostet nichts, solange das Band gleich bleibt.
 */
export function watchTerritoryBand(map: MapLibreMap): () => void {
    const sync = (): void => {
        try {
            map.setGlobalStateProperty(TERRITORY_BAND_STATE, territoryBandForZoom(map.getZoom()));
        } catch {
            // Der Stil lädt noch: sein eigener Anfangswert (`withTerritoryBand`) gilt, und `load` holt es nach.
        }
    };
    map.on("zoom", sync);
    map.on("load", sync);
    map.on("styledata", sync);
    return () => {
        map.off("zoom", sync);
        map.off("load", sync);
        map.off("styledata", sync);
    };
}
