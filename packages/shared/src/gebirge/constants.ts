/**
 * Legacys Konstanten der Gebirgsrechnung V12, Wert für Wert (hydrologie.js, aff0449a5). Die
 * Begründungen stehen dort an jeder Zahl; hier nur, was sie steuert.
 */

/** 1 Karteneinheit = 3.000 Schritt (hydrologie.js#L44). */
export const SCHRITT_JE_EINHEIT = 3000;
/** Gipfel ohne Höhe (hydrologie.js#L48). */
export const ECOSYSTEM_HYDRO_STANDARDHOEHE = 5000;
/** Zellweite in Karteneinheiten, die Schranke von Legacys Speicher (hydrologie.js#L54). */
export const ECOSYSTEM_HYDRO_ZELLWEITE = 0.25;
/** Vorgaben der Regler Bergform, Rauschen, Sattel; Abtrag und Kriechen der Erosion (hydrologie.js#L64-68). */
export const ECOSYSTEM_HYDRO_BERGFORM = 2.5;
export const ECOSYSTEM_HYDRO_RAUSCHEN = 0.35;
export const ECOSYSTEM_HYDRO_SATTEL = 0.75;
export const ECOSYSTEM_HYDRO_ABTRAG = 0.05;
export const ECOSYSTEM_HYDRO_KRIECHEN = 0.03;
/** Erosionsschritte je Stufe des Reglers 0..5, Vorgabe Stufe 3 (hydrologie.js#L75-79). */
export const ECOSYSTEM_HYDRO_EROSIONSSTUFEN: readonly number[] = [0, 40, 90, 150, 240, 360];
export const ECOSYSTEM_HYDRO_EROSION_VORGABE = 3;
/** Plateau 1 = nur die Mittelachse (hydrologie.js#L89). */
export const ECOSYSTEM_HYDRO_PLATEAU_VORGABE = 1;
/** Hypsometrie 0 = nicht gesetzt; Klemme der Potenz (hydrologie.js#L98-105). */
export const ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE = 0;
export const ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN = 0.2;
export const ECOSYSTEM_HYDRO_HYPSO_POTENZ_MAX = 8;
/** Täler: halbe Breite, Anteil eines Bachs, Seebecken, Einschnitt, Rest unter der Sohle (hydrologie.js#L945-969). */
export const ECOSYSTEM_HYDRO_TALBREITE = 1.5;
export const ECOSYSTEM_HYDRO_BACH_ANTEIL = 0.5;
export const ECOSYSTEM_HYDRO_SEEBECKEN = 1.6;
export const ECOSYSTEM_HYDRO_EINSCHNITT = 400;
export const ECOSYSTEM_HYDRO_TALSOHLE_REST = 0.25;

/** Ohne Gipfel und ohne Maximalhöhe bleibt die Fläche flach (hydrologie.js#L338-340). */
export function avesmapsGebirgeBleibtFlach(gipfelAnzahl: unknown, maximalhoehe: unknown): boolean {
    return !(Number(gipfelAnzahl) > 0) && !(Number(maximalhoehe) > 0);
}

/** Stufe des Reglers „Erosion“ in Schritte; nicht gesetzt heißt Stufe 3 (hydrologie.js#L1747-1755). */
export function avesmapsHydroErosionsSchritte(stufe: unknown): number {
    const s = Number(stufe);
    if (!Number.isFinite(s)) {
        return ECOSYSTEM_HYDRO_EROSIONSSTUFEN[ECOSYSTEM_HYDRO_EROSION_VORGABE] as number;
    }
    const i = Math.max(0, Math.min(ECOSYSTEM_HYDRO_EROSIONSSTUFEN.length - 1, Math.round(s)));
    return ECOSYSTEM_HYDRO_EROSIONSSTUFEN[i] as number;
}
