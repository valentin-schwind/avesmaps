/**
 * Ein- und Ausgabe der Gebirgsrechnung V12 (WI-0049 S3), bitgenau übertragen aus Legacy
 * (`avesmaps@aff0449a5:js/map-features/map-features-ecosystem-hydrologie.js`).
 *
 * Alles in Kartenkoordinaten (0..1024), Höhen in Schritt. Die Felder tragen Legacys Namen, damit
 * jede Zeile gegen das Original lesbar bleibt.
 */
import type { Mulde, NetzLinie, Nebengipfel, WasserHoehe } from "./rueckennetz/netz-vertrag.ts";
import type { Pass } from "./rueckennetz/paesse.ts";
import type { RueckennetzRegler } from "./rueckennetz/werte.ts";

export interface V12Bounds {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
}

export interface V12Geometry {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
}

/** Ein Gipfel oder Vulkan; `h` fehlt, wenn Legacy keine Höhe führt (dann gilt 5.000). */
export interface V12Peak {
    x: number;
    y: number;
    h: number | null;
}

/** Ein Flussweg in der Fläche; `dir` null heißt: Legacy rät die Richtung aus dem Gelände. */
export interface V12River {
    n: string;
    bach: boolean;
    dir: "forward" | "reverse" | null;
    p: [number, number][];
}

export interface V12Lake {
    n: string;
    g: V12Geometry;
}

/**
 * Die elf Regler der Fläche. Ein fehlender Regler heißt „nicht gesetzt“ und nimmt Legacys Vorgabe;
 * `maximalhoehe` ist Legacys `terrain_avg_height`.
 */
export interface V12Controls {
    koernung?: number;
    stufen?: number;
    erosion?: number;
    plateau?: number;
    hypsometrie?: number;
    maximalhoehe?: number;
    bergform?: number;
    rauschen?: number;
    sattel?: number;
    talbreite?: number;
    einschnitt?: number;
    /**
     * Das Grundmuster (WI-0226, nicht aus Legacy): fehlt es, rechnet die Fläche wie Legacy mit dem weichen Rauschen. „zellen“ setzt
     * Berge als Zellspitzen mit Tälern an den Zellgrenzen (Betreiber 2026-10-18 für Bergland und Massengebirge).
     */
    muster?: V12Muster;
}

/** Die Grundmuster der Gebirgsrechnung; „rauschen“ ist Legacys Weg und die Vorgabe. */
export type V12Muster = "rauschen" | "zellen";

export interface V12Input {
    bounds: V12Bounds;
    geometry: V12Geometry;
    peaks: V12Peak[];
    kurve: [number, number][] | null;
    fluesse: V12River[];
    seen: V12Lake[];
    regler: V12Controls;
    saat: number;
    /**
     * Zellweite in Karteneinheiten, nur für die grobe Vorschau im Editor (WI-0226). Fehlt sie, gilt Legacys Speicherauflösung
     * (`ECOSYSTEM_HYDRO_ZELLWEITE`); das Gelände setzt sie nie.
     */
    zelle?: number;
    /** Ausschließlich Editorvorschau: feinere Raster erlauben; das veröffentlichte Gelände setzt dies nie. */
    vorschauZelleMin?: number;
    /**
     * Das Rückennetz (WI-0246, nicht aus Legacy): Liegt mindestens ein gezeichneter Kamm vor, rechnet `buildMountainRaster` das Gebirge
     * aus Kämmen, Nebengipfeln und Pässen mit diesen Reglern statt mit der V12. Fehlen die Felder (jedes Gebirge ohne Kamm), bleibt die
     * Eingabe Zeichen für Zeichen dieselbe und damit ihr Fingerabdruck.
     */
    /** Kämme und Täler (Rang `tal`, `senken.ts`). */
    kaemme?: NetzLinie[];
    nebengipfel?: Nebengipfel[];
    /** Mulden (Gegengipfel, `senken.ts`); fehlt das Feld, bleibt der Fingerabdruck. */
    mulden?: Mulde[];
    /**
     * Eigene Höhen an Flüssen und Seen (WI-0249, `rueckennetz/wasser.ts`); nur mit den Presets der Fassung 19 gesetzt. Fehlen sie, bleibt die
     * Eingabe Zeichen für Zeichen dieselbe und damit ihr Fingerabdruck.
     */
    flussHoehen?: WasserHoehe[];
    seeHoehen?: WasserHoehe[];
    paesse?: Pass[];
    rueckennetz?: RueckennetzRegler;
    /**
     * Gemeinsame Grenzen mit Nachbarn (OPS-000089, nur Fassungen mit `mountainMorphology.andock`): An diesen Strecken läuft das Gebirge nicht aus (`gebirge/raster.ts`). Fehlt das Feld,
     * bleibt die Eingabe Zeichen für Zeichen dieselbe und damit ihr Fingerabdruck.
     */
    andock?: { kanten: [number, number][][]; streifen: number };
}

/** Legacys Raster einer Fläche: `w` × `hh` Zellen ab `bounds.min_x/min_y`, Zeile für Zeile. */
export interface V12Raster {
    w: number;
    hh: number;
    cell: number;
    bounds: V12Bounds;
    /** 1 in der Fläche; nur diese Zellen werden gespeichert. */
    eigen: Uint8Array;
    h: Float64Array;
    leer: boolean;
    /** Nur im Rückennetz (WI-0246): der wirksame Talboden (Anteil der Kammhöhe), abgeleitet oder eigener. */
    talboden?: number;
}
