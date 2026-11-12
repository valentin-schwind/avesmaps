import { Type, type Static } from "@sinclair/typebox";

/**
 * Ein Ausschnitt in `aventuria-v1`: `[minX, minY, maxX, maxY]` (WI-0044). Damit zeigt die Karte ein
 * Ziel ganz, das keine Stelle ist, sondern eine Linie oder Fläche.
 */
export const MapBounds = Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], {
    $id: "MapBounds",
});
export type MapBounds = Static<typeof MapBounds>;
