import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TERRAIN_REVISION_PATTERN } from "./terrain-dem.ts";

/**
 * Der Zeiger auf das visuelle Relief der Landfläche (WI-0054).
 *
 * 🔴 Das Relief ist KEINE Höhe. Es ist eine eigene `raster-dem`-Quelle nur für die Schattierung in der
 * Landschaftsansicht (3D); das Gelände (`setTerrain`), Routing, Steigung und Flug lesen es nie.
 *
 * Dasselbe Schema wie das Gelände (ADR-0008): Kacheln unter ihrer Revision, unveränderlich; welche
 * gilt, sagt allein `current.json` mit `no-cache`. `demRevision` nennt die Geländerevision, an die das
 * Relief gebunden ist: Passt sie nicht zum Geländezeiger, zeigt die Karte die Schattierung wie vorher.
 */
export const VisualReliefPointer = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        revision: Type.String({ pattern: TERRAIN_REVISION_PATTERN }),
        demRevision: Type.String({ pattern: TERRAIN_REVISION_PATTERN }),
        tileSize: Type.Integer({ exclusiveMinimum: 0 }),
        maxNativeZoom: Type.Integer({ minimum: 0 }),
        /** Wie beim Gelände: die Kachel trägt den Ausgleich der Breite schon (WI-0049 S1). */
        encoding: Type.Literal("mapbox"),
    },
    { $id: "VisualReliefPointer", additionalProperties: false },
);

export type VisualReliefPointer = Static<typeof VisualReliefPointer>;

/** Wo der Zeiger liegt, unter dem gemeinsamen Präfix der Geländeprodukte (Koordination 2026-09-28). */
export const VISUAL_RELIEF_POINTER_URL = "/tiles/terrain/visual-relief/current.json";

/** Die Kachelvorlage der Revision, auf die der Zeiger zeigt. */
export function visualReliefTileTemplate(pointer: VisualReliefPointer): string {
    return `/tiles/terrain/visual-relief/${pointer.revision}/{z}/{x}/{y}.png`;
}

/** Prüft einen gelesenen Zeiger und gibt ihn typisiert zurück. */
export function parseVisualReliefPointer(candidate: unknown): VisualReliefPointer {
    if (!Value.Check(VisualReliefPointer, candidate)) {
        const [firstError] = [...Value.Errors(VisualReliefPointer, candidate)];
        const detail = firstError ? `${firstError.path || "/"}: ${firstError.message}` : "unbekannter Fehler";
        throw new Error(`ungültiger Reliefzeiger (${detail})`);
    }
    return candidate;
}
