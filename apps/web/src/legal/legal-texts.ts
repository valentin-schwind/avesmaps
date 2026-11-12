import type { MapSeries, MapSeriesLicense } from "@avesmaps3d/shared";
import type { Locale } from "../i18n/i18n";

/**
 * Lizenz und Herkunft einer Kartenserie in der Sprache des Lesers (WI-0032 Stufe 3, Betreiber 2026-09-24: „Übersetzen“). Beide Fassungen stehen im Katalog der Serien nebeneinander; eine Sprache ohne eigene liest die
 * englische. 🔴 Sie sind Rechtstexte: Jede Fassung und jede Änderung nimmt der Betreiber ab (AGENTS.md). Die Hinweise haben seit 2026-11-04 eine Fassung je Sprache (`hinweise-sprachen.ts`).
 */

export interface LicenseTexts {
    name: string;
    terms: string;
}

export interface SeriesTexts {
    origin: string;
    derivation: string;
    permission: string;
    attribution: string;
}

export function licenseTexts(license: MapSeriesLicense, language: Locale): LicenseTexts {
    return language === "de" ? { name: license.name, terms: license.terms } : license.en;
}

export function seriesTexts(series: MapSeries, language: Locale): SeriesTexts {
    if (language !== "de") return series.en;
    return {
        origin: series.origin,
        derivation: series.derivation,
        permission: series.permission.statement,
        attribution: series.attribution,
    };
}
