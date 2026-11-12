import { Type, type Static } from "@sinclair/typebox";
import { checkPointer, readPointer } from "./pointer-reading.ts";
import { MAX_BAND } from "./zoom-bands.ts";

/**
 * Der Zeiger auf die abgeleiteten Herrschaftsgebiete (WI-0062, ADR-0014): Gibt es Flächen und Grenzen, und welche
 * Revision gilt? Die Kacheln selbst liefert Martin (`territory_tile`, `territory_border_tile`); der Zeiger sagt der
 * Karte, ob sie da sind, und gibt ihr die Revision für die Kachel-Adresse.
 *
 * 🔴 Revision in der Adresse (ADR-0008, MCS-022): Eine neue Ableitung ändert die URL, alle Clients sehen den neuen
 * Stand ohne mehrfaches Laden. Martin liest den Anhang `?rev=` nicht; er bricht nur den Cache des Browsers.
 */
export const TERRITORY_REVISION_PATTERN = "^[0-9a-f]{12}$";

export const TerritoryPointer = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        revision: Type.String({ pattern: TERRITORY_REVISION_PATTERN }),
        /** Das Jahr in BF, für das abgeleitet ist (die zentrale Einstellung der Kartografie). */
        displayYearBf: Type.Integer(),
        /**
         * Das höchste abgeleitete Band (WI-0188). Die Karte zeigt nie ein höheres, sondern dieses für jeden höheren Zoom: So
         * sieht eine Umgebung nach dem Ausrollen von Band 8 aus wie zuvor, bis ihre Ableitung die Bänder 7 und 8 trägt.
         * Fehlt das Feld (ein Server vor WI-0188), gilt Legacys 6 (`LEGACY_POLITICAL_MAX_BAND`).
         */
        maxBand: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_BAND })),
    },
    { $id: "TerritoryPointer", additionalProperties: false },
);

export type TerritoryPointer = Static<typeof TerritoryPointer>;

export const TERRITORY_POINTER_URL = "/api/territories/current";

/** Die Kachelquellen und die Schichtnamen darin (die Schicht heißt wie die Sicht, `render-grants.test.ts`). */
export const TERRITORY_TILE_SOURCE = "territory_tile";
export const TERRITORY_BORDER_TILE_SOURCE = "territory_border_tile";
export const TERRITORY_FILL_SOURCE_LAYER = "territory_fill_render";
export const TERRITORY_LABEL_SOURCE_LAYER = "territory_label_render";
export const TERRITORY_BORDER_SOURCE_LAYER = "territory_border_render";
/** Die Schraffurflächen umstrittener Gebiete (Migration 0058), in der Kachel der Flächen und Namen. */
export const TERRITORY_CLAIM_SOURCE_LAYER = "territory_claim_render";

/**
 * Streng: der Server prüft den Zeiger, den er sendet (jedes Feld, das das Schema nicht kennt, ist ein Fehler).
 * Der Client liest mit `readTerritoryPointer` (WI-0075 R5b, `pointer-reading.ts`).
 */
export function parseTerritoryPointer(candidate: unknown): TerritoryPointer {
    return checkPointer(TerritoryPointer, candidate, "Gebietszeiger");
}

/** Tolerant: der Client liest den Zeiger und ignoriert Felder, die eine neuere Version des Servers dazugibt. */
export function readTerritoryPointer(candidate: unknown): TerritoryPointer {
    return readPointer(TerritoryPointer, candidate, "Gebietszeiger");
}

/** Die Kachel-Adresse einer Quelle mit der Revision im Anhang. */
export function territoryTileTemplate(source: string, pointer: TerritoryPointer): string {
    return `/tiles/vector/${source}/{z}/{x}/{y}?rev=${pointer.revision}`;
}
