/**
 * Freie Gipfel: jeder Gipfel und Vulkan außerhalb eines Gebirges wird ein Berg mit Steigung
 * (Betreiber 2026-09-27: „dass sie immer einen berg mit steigung produzieren, egal ob gebirge oder
 * nicht“). In einem Gebirge trägt ihn Legacys Rechnung selbst.
 *
 * Die Form ist Legacys Bergkegel, damit ein freier Gipfel aussieht wie seine Verwandten im Gebirge:
 * `H · (1 − (d/R)²)³`, oben und am Fuß ohne Knick (`addiereGipfelkegel`, hydrologie.js#L563-646).
 */

/** Legacys Vorgabe für einen Gipfel ohne Höhe IM Gebirge (`ECOSYSTEM_HYDRO_STANDARDHOEHE`); V12 setzt sie selbst. */
export const PEAK_DEFAULT_HEIGHT = 5000;

/**
 * Ein freier Gipfel ohne Höhe: 1.000 Schritt (Betreiber 2026-09-27: „1000 für Gipfel ohne Höhe“),
 * passend zur Grundhöhe kleiner Gebirge. Legacys 5.000 standen mitten im Hügelland.
 */
export const FREE_PEAK_DEFAULT_HEIGHT = 1000;

/** Wie breit ein freier Gipfel ausläuft. */
export type ConeRule = { kind: "radius"; radius: number } | { kind: "steigung"; steigung: number };

/** Legacys Bergform-Vorgabe: 2,5 Karteneinheiten Radius (`ECOSYSTEM_HYDRO_BERGFORM`). Zum Vergleich. */
export const LEGACY_CONE: ConeRule = { kind: "radius", radius: 2.5 };

/** Im Mittel 30 % Steigung vom Gipfel zum Fuß (Betreiber 2026-09-27: K2). */
export const DEFAULT_CONE: ConeRule = { kind: "steigung", steigung: 0.3 };

export interface FreePeak {
    x: number;
    y: number;
    /** In Schritt; `null` nimmt `FREE_PEAK_DEFAULT_HEIGHT`. */
    h: number | null;
}

/** Die Höhe eines freien Gipfels in Schritt, mit der Vorgabe für einen ohne Eintrag. */
export function freePeakHeight(peak: FreePeak): number {
    return peak.h !== null && peak.h > 0 ? peak.h : FREE_PEAK_DEFAULT_HEIGHT;
}

/**
 * Mindestens zwei Zellen des Höhenmodells (0,25 E): Sonst fiele ein niedriger Gipfel durchs Raster
 * („Der Daumen“, 50 Schritt, hätte bei 30 % nur 0,06 E Radius) und wäre kein Berg mehr. Er wird
 * dafür flacher als die Regel.
 */
export const MIN_CONE_RADIUS = 0.5;

/** Der Radius in Karteneinheiten. Bei `steigung` ist die mittlere Neigung vom Gipfel zum Fuß gemeint. */
export function coneRadius(height: number, rule: ConeRule): number {
    return Math.max(MIN_CONE_RADIUS, rule.kind === "radius" ? rule.radius : height / (rule.steigung * 3000));
}

/** Die Höhe eines freien Gipfels an einer Stelle, in Schritt. */
export function coneHeightAt(peak: FreePeak, x: number, y: number, rule: ConeRule): number {
    const height = freePeakHeight(peak);
    const radius = coneRadius(height, rule);
    const d = Math.hypot(x - peak.x, y - peak.y);
    if (!(radius > 0) || d >= radius) {
        return 0;
    }
    const u = 1 - (d / radius) * (d / radius);
    return height * u * u * u;
}
