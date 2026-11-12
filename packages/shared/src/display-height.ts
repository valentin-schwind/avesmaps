import { Type, type Static } from "@sinclair/typebox";
import { checkPointer, readPointer } from "./pointer-reading.ts";
import { TERRAIN_REVISION_PATTERN } from "./terrain-dem.ts";

/**
 * Der Zeiger auf die Anzeigehöhen (WI-0055, ADR-0012): Gibt es Höhenlinien und Höhenstufen, und zu welchem
 * Gelände? Linien und Flächen liefert Martin als Vektorkacheln (`terrain_contour_tile`,
 * `terrain_height_band_tile`); der Zeiger sagt der Karte nur, ob sie da sind.
 *
 * 🔴 Nur Anzeige: Das Gelände (`setTerrain`), Routing, Steigung und Flug lesen die Anzeigehöhen nie.
 */
export const DisplayHeightPointer = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        revision: Type.String({ pattern: TERRAIN_REVISION_PATTERN }),
        demRevision: Type.String({ pattern: TERRAIN_REVISION_PATTERN }),
    },
    { $id: "DisplayHeightPointer", additionalProperties: false },
);

export type DisplayHeightPointer = Static<typeof DisplayHeightPointer>;

export const DISPLAY_HEIGHT_POINTER_URL = "/tiles/terrain/display-height/current.json";

/**
 * Streng: der Server prüft den Zeiger, den er sendet (jedes Feld, das das Schema nicht kennt, ist ein Fehler).
 * Der Client liest mit `readDisplayHeightPointer` (WI-0075 R5b, `pointer-reading.ts`).
 */
export function parseDisplayHeightPointer(candidate: unknown): DisplayHeightPointer {
    return checkPointer(DisplayHeightPointer, candidate, "Höhenzeiger");
}

/** Tolerant: der Client liest den Zeiger und ignoriert Felder, die eine neuere Version des Servers dazugibt. */
export function readDisplayHeightPointer(candidate: unknown): DisplayHeightPointer {
    return readPointer(DisplayHeightPointer, candidate, "Höhenzeiger");
}
