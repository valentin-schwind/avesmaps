/**
 * Die Typen der Sprachen als Kartenebene (WI-0261 S2). Serverseitig, bis die Oberfläche (S5) sie braucht; dann wandern sie nach
 * `packages/shared`. Die Antwortschemas der Routen stehen in `schema.ts` und werden gegen diese Typen geprüft (Typecheck).
 */

/** Woher ein Eintrag oder eine Fläche stammt (T-1): aus der Sprachenkarte eingespielt oder von der Redaktion. */
export type SpracheHerkunft = "sprachenkarte" | "redaktion";

/** Eine Sprache der Karte mit ihren Kennzahlen. */
export interface SpracheEintrag {
    /** Kennung für Schnittstelle und Kacheln (`sprache_flaeche_render.sprache_public_id`). */
    id: string;
    /** Gruppenschlüssel (T-2), z. B. `thorwalsch`. */
    schluessel: string;
    /** Name auf der Karte und in den Zeilen. */
    name: string;
    /** Name in der Legende; `null` heißt: die Legende zeigt den Namen. */
    legende: string | null;
    /** `#rrggbb`, Kleinbuchstaben. */
    farbe: string;
    /** Reihenfolge der Legende, aufsteigend. */
    reihenfolge: number;
    herkunft: SpracheHerkunft;
    revision: number;
    /** Zahl der aktiven Teilflächen. */
    anzahlTeilflaechen: number;
    /** Summe der aktiven Teilflächen in Karteneinheiten², auf zwei Stellen. */
    flaeche: number;
}

/** Eine Teilfläche; die Geometrie selbst kommt als Kachel. */
export interface SprachTeilflaeche {
    /** `sprache_flaeche.public_id`. */
    id: string;
    herkunft: SpracheHerkunft;
    /** Fläche in Karteneinheiten², auf zwei Stellen. */
    flaeche: number;
    /** `[minX, minY, maxX, maxY]` in Kartenkoordinaten (SRID 0). */
    bbox: [number, number, number, number];
}

/** Eine Sprache mit ihren aktiven Teilflächen, die größte zuerst. */
export interface SpracheMitTeilflaechen extends SpracheEintrag {
    teilflaechen: SprachTeilflaeche[];
}

/**
 * Wie viele Objekte eine Sprache trifft (WI-0261 S4): Orte per Punkt in Fläche, Herrschaftsgebiete und Regionen ab dem Mindestanteil ihrer
 * Fläche, Wege ab dem Mindestanteil ihrer Länge (Karteneinstellung `sprachenMindestanteil`).
 */
export interface SprachTreffer {
    orte: number;
    gebiete: number;
    regionen: number;
    wege: number;
}

/** Eine Sprache mit Teilflächen und den Zahlen ihrer Treffer (`GET /api/sprachen/:schluessel`). */
export interface SpracheMitTreffer extends SpracheMitTeilflaechen {
    treffer: SprachTreffer;
}

/** Eine Sprache, die ein Objekt trifft, mit ihrem Anteil (Zeile „Sprachen“ der Infoboxen, S5). */
export interface SpracheEinesObjekts {
    /** `sprache.public_id`. */
    id: string;
    schluessel: string;
    name: string;
    farbe: string;
    /** Anteil an der Fläche oder Länge des Objekts (0 bis 1); ein Ort hat 1. */
    anteil: number;
}
