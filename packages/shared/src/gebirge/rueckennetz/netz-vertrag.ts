/**
 * Das gezeichnete Netz eines Gebirges (WI-0246, Bauplan Gebirge Schritt 2): Kämme und Nebengipfel je Gebirgsfläche, die Eingabe des
 * Rückennetz-Modells. Datenmodell C (Betreiber 2026-10-20: „C eigene tafeln.“): gespeichert in `terrain_ridge_edge` (ein Kamm je Zeile,
 * Reihenfolge = `ordinal`) und `terrain_ridge_point` (ein Nebengipfel je Zeile, `height_schritt` nullbar), geschrieben als ganzes Netz
 * je Fläche im `landscape.update` (WI-0245, Derographie). Nebengipfel sind Formpunkte ohne Name und Wiki (Betreiber 2026-10-20: N1).
 *
 * Ohne TypeBox, damit es im Worker der Vorschau läuft; das Schema des Schreibwegs (`GebirgsAenderung.netz`) baut `vertrag.ts` aus
 * diesen Typen. Koordinaten in Karteneinheiten wie `V12Input.kurve`, Höhen in Schritt.
 */

export const KAMM_RAENGE = ["haupt", "neben"] as const;
export type KammRang = (typeof KAMM_RAENGE)[number];

/** Ein gezeichneter Kamm: ein Linienzug von Gipfel zu Gipfel, Nebengipfel oder freiem Punkt. */
export interface Kamm {
    punkte: [number, number][];
    rang: KammRang;
}

/**
 * Ein Nebengipfel: nicht kanonisch, ein lokales Maximum der Form. `h` null heißt: das Modell setzt die Vorgabe (80 % der Kammhöhe,
 * mindestens 10 % über dem Talboden des Typs).
 */
export interface Nebengipfel {
    x: number;
    y: number;
    h: number | null;
}

/**
 * Täler und Mulden (Betreiber 2026-10-21 über die Hauptorchestrierung: „zu haupt- und nebenkamm das gegenteil "tal" … diesselbe
 * gewichtung wie nebenkämme - nur nach unten. und den "gegengipfel" ein punkt, der eine mulde (krater) macht“). Ein Tal ist eine Linie
 * wie ein Kamm mit dem Rang `tal`; das Modell nimmt es schon an (`LinienRang`), der Schreibweg erst mit seiner Migration (Derographie).
 */
export const TAL_RANG = "tal";
export type LinienRang = KammRang | typeof TAL_RANG;

/**
 * Eine gezeichnete Linie des Modells: Kamm oder Tal. Seit WI-0249 P9 (Betreiber 2026-10-24: „ich will, dass kämme, nebengipfel, täler und
 * mulden definierte höhen haben“) trägt jeder Stützpunkt eine eigene Höhe: `hoehen` steht parallel zu `punkte` (gleiche Länge), `null` ist
 * die Vorgabe des Modells an dieser Stelle. Fehlt die Liste, gilt überall die Vorgabe; eine Liste nur aus `null` gibt es nicht (sie fehlt dann).
 * Die Höhe je Linie (Migration 0216, `height_schritt`) liest der Server nur noch für den Übergang und füllt damit alle Stützpunkte.
 */
export interface NetzLinie {
    punkte: [number, number][];
    rang: LinienRang;
    /** Höhe je Stützpunkt in Schritt (Grenzen wie `terrain_peak.height_schritt`), `null` = Vorgabe; parallel zu `punkte`. */
    hoehen?: (number | null)[];
}

/** Grenzen einer Punkthöhe in Schritt, wie `terrain_peak.height_schritt` (Migrationen 0212, 0215, 0219). */
export const PUNKT_HOEHE_GRENZEN = { min: 0, max: 65535 } as const;

/** Eine Höhe in ihre Grenzen gelegt und ganzzahlig; `null` für etwas, das keine Zahl ist. */
export function punktHoeheBegrenzt(h: number | null | undefined): number | null {
    if (h === null || h === undefined || !Number.isFinite(h)) return null;
    return Math.min(PUNKT_HOEHE_GRENZEN.max, Math.max(PUNKT_HOEHE_GRENZEN.min, Math.round(h)));
}

/** Trägt die Linie mindestens eine eigene Punkthöhe? */
export const hatPunktHoehen = (linie: { hoehen?: readonly (number | null)[] | undefined }): boolean =>
    linie.hoehen?.some((h) => h !== null && h !== undefined) === true;

/**
 * Die Linie mit ihren Punkthöhen in der Form des Vertrags: `hoehen` nur mit mindestens einem eigenen Wert und genau so lang wie `punkte`
 * (eine abweichende Länge zählt als „keine“), sonst ohne das Feld. Die Folge der Schlüssel bleibt `punkte`, `rang`, `hoehen`: Ohne Punkthöhen
 * ist die Linie Zeichen für Zeichen die von vorher (Fingerabdruck der Saat in `terrain/inputs.ts`).
 */
export function linieMitHoehen<R extends string>(
    punkte: [number, number][],
    rang: R,
    hoehen: readonly (number | null | undefined)[] | null | undefined,
): { punkte: [number, number][]; rang: R; hoehen?: (number | null)[] } {
    const liste = hoehen?.length === punkte.length ? hoehen.map((h) => punktHoeheBegrenzt(h)) : undefined;
    return liste?.some((h) => h !== null) ? { punkte, rang, hoehen: liste } : { punkte, rang };
}

/** Eine Mulde: der Gegengipfel, eine Senke um einen Punkt. `h` ist die Höhe ihres Bodens in Schritt, `null` die Vorgabe des Modells. */
export interface Mulde {
    x: number;
    y: number;
    h: number | null;
}

/**
 * Eine eigene Höhe an einem Gewässer des Gebirges (WI-0249; Vali wählte A, 2026-10-26): an einem Stützpunkt eines Flusses oder am Platz eines
 * Sees (`seePlatz`), gespeichert nach Lage, in Schritt. Flüsse und Seen selbst kommen aus der Karte; das Netz trägt nur die Höhen. Wirkt nur
 * im Gelände der Fassung 19 (`wasser.ts`).
 */
export interface WasserHoehe {
    x: number;
    y: number;
    h: number;
}

export interface GebirgsNetz {
    kaemme: NetzLinie[];
    nebengipfel: Nebengipfel[];
    mulden?: Mulde[];
    /** Höhen an Stützpunkten der Flüsse, die das Gebirge durchqueren; fehlt das Feld, gilt überall die Regel des Geländes. */
    flussHoehen?: WasserHoehe[];
    /** Höhen der Seen im Gebirge, je See am Platz des Sees. */
    seeHoehen?: WasserHoehe[];
}

/**
 * Fangradius in Karteneinheiten: Ein Kammende so nah an einem Gipfel, einem Nebengipfel oder einem anderen Kammende gilt als derselbe
 * Punkt. Der Editor rastet damit ein und zieht deckungsgleiche Punkte mit; das Modell verbindet damit Kanten zu Knoten und gibt dem Ende
 * die Höhe des Gipfels.
 */
export const KAMM_FANG_E = 0.5;

/** Ein Kamm hat mindestens zwei Punkte. */
export const KAMM_MIN_PUNKTE = 2;
