/**
 * Die gemeinsame Form der Stufen des Adapters (WI-0250 Phase B): Eine Stufe bereitet einen Auftrag vor (Eingaben laden, Regler auflösen,
 * nicht gemessen) und führt dann beliebig oft aus (gemessen). So misst `rechne.ts` kalt und warm dieselbe Rechnung.
 */
import type { Raster } from "./austausch.ts";
import type { PhasenBericht } from "./phasen.ts";

export interface BenanntesRaster {
    /** Dateiname ohne Endung unter dem Ausgabeordner (`stufen/…` für Zwischenstände). */
    name: string;
    raster: Raster;
}

export interface Zwischenstand {
    phase: string;
    /** Wie lange der Lauf bis zu diesem Punkt war (ms seit Beginn des Aufrufs). */
    ab_beginn_ms: number;
    name: string;
    fingerprint: string;
}

/** Was ein Durchlauf einer Stufe liefert. Die Umwandlung in Dateien (`rasters`) geschieht nach der Messung. */
export interface Ausfuehrung {
    /** Die Fläche, über die der Ergebnis-Fingerabdruck gebildet wird (Uint16-Schritt). */
    samples: Uint16Array;
    zellen: number;
    eigene_zellen: number;
    /** Größe und Zellweite des Hauptrasters (Meter); steht auch ohne geschriebene Raster in der `meta.json`. */
    form: { breite: number; hoehe: number; zellgroesse_m: number };
    /** Austauschraster; die Zwischenstände stehen unter `stufen/`. Wird erst nach der Messung aufgerufen. */
    rasters: () => BenanntesRaster[];
    /** Zeit je Abschnitt, wo der Generator Rückrufe meldet (Domain). */
    phasen_ms?: Record<string, number>;
    /** Dieselben Zeiten in vier festen Gruppen (`saat`, `grob`, `fein`, `schluss`), gleich benannt für beide Wege. */
    gruppen_ms?: Record<string, number>;
    zwischenstaende?: Zwischenstand[];
    /** Weitere Angaben des Laufs (Talboden, eigene Zeit des Generators, Erosion). */
    zusatz: Record<string, unknown>;
    /** Eigener Hauptname des Rasters (`vorschau-2x`, `saat`, `endgelaende`). */
    haupt: string;
}

export interface Vorbereitet {
    /** Aufgelöste Parameter der Rechnung (Regler, Typ, Saat, Auflösung …), so wie der Generator sie sah. */
    parameter: Record<string, unknown>;
    fuehreAus(): Promise<Ausfuehrung>;
    /** Phasenproben nach dem Hauptlauf; `null`, wo die Stufe keine Differenzen kennt. */
    phasen(ausfuehrung: Ausfuehrung, hauptFingerprint: string, wiederholungen: number): Promise<PhasenBericht | null>;
}
