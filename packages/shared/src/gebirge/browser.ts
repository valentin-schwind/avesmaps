/**
 * Der Einstieg der Gebirgsrechnung für den Browser (WI-0226): nur die V12 und die Auflösung der Regler, ohne TypeBox und ohne den Rest von
 * `@avesmaps3d/shared`. Der Worker der Vorschau importiert `@avesmaps3d/shared/gebirge`; über den Hauptindex zöge er das ganze Paket
 * mit (gemessen 2026-10-18: 503 KB statt 18 KB, minifiziert).
 */
export { buildMountainRaster, rasterSamples } from "./index.ts";
export { gebirgsRegler, GEBIRGS_PRESETS_VORGABE } from "./regler.ts";
export type { GebirgsPreset, GebirgsStand } from "./regler.ts";
export type { V12Bounds, V12Controls, V12Geometry, V12Input, V12Raster } from "./types.ts";
export { KAMM_FANG_E, KAMM_MIN_PUNKTE, KAMM_RAENGE, TAL_RANG } from "./rueckennetz/netz-vertrag.ts";
export type {
    GebirgsNetz,
    Kamm,
    KammRang,
    LinienRang,
    Mulde,
    NetzLinie,
    Nebengipfel,
    WasserHoehe,
} from "./rueckennetz/netz-vertrag.ts";
export {
    nebengipfelVorgabe,
    rechneRueckennetz,
    type NebengipfelEingabe,
    type RueckenErgebnis,
    type RueckenOptionen,
} from "./rueckennetz/rechne.ts";
export {
    GRAT_BREITE_VORGABE,
    rechnetRueckennetz,
    rueckennetzRegler,
    rueckennetzTyp,
    rueckennetzVorgabe,
    type ModellAbweichung,
    type RueckennetzRegler,
} from "./rueckennetz/werte.ts";
export type { Pass } from "./rueckennetz/paesse.ts";
