import { Type, type Static } from "@sinclair/typebox";
import { checkPointer, readPointer } from "./pointer-reading.ts";

/**
 * Der Zeiger auf die ausgelieferten Geländekacheln (`raster-dem`, WI-0049).
 *
 * Dasselbe Schema wie die Grundkarte (ADR-0008): Die Kacheln liegen unter ihrer **Revision** und
 * ändern sich dort nie mehr, deshalb gehen sie `immutable` hinaus. Welche Revision gilt, sagt allein
 * `/tiles/terrain/dem/current.json` mit `no-cache`. Eine neue Ableitung (`derive:terrain`) erreicht die
 * Karte so beim nächsten Laden, ohne Frontend-Deploy.
 *
 * Anders als die Grundkarte gibt es das Gelände nur einmal je Kartendomäne, nicht je Serie: Es ist
 * dieselbe Erde unter jeder Bemalung.
 *
 * Seit WI-0073 sind die Kacheln verlustfreies WebP (`format: "webp"`, Endung `.webp`). Die Höhe steckt in den
 * RGB-Werten, die dekodierten Werte sind byte-gleich zu denen der früheren PNG-Kacheln. Ein Zeiger ohne `format`
 * stammt aus der Zeit davor und meint PNG.
 *
 * Seit WI-0125 (JOBS-0001 Etappe 2) trägt der Zeiger das Manifest `tiles`: je Kachel ihre eigene Revision. Ein lokal
 * veröffentlichtes Gebirge ändert nur die Kacheln seines Fußabdrucks; alle anderen behalten Bytes und Adresse, und eine Karte
 * lädt nur die geänderten nach. ADR-0008 hatte den Inhalts-Hash je Kachel verworfen, weil der Stil jede Adresse kennen müsste;
 * die Karte löst die Adresse deshalb über ein eigenes Protokoll je Kachel auf (`apps/web/src/map/terrain/terrain-tiles.ts`).
 */

/** Die ersten 12 Hexzeichen des SHA-256 über alle Kacheln der Ableitung. */
export const TERRAIN_REVISION_PATTERN = "^[0-9a-f]{12}$";

/**
 * Die Revision EINER Kachel (JOBS-0001 V2, WI-0125): die ersten 16 Hexzeichen des SHA-256 ihrer Bytes. Unter ihr ist die Kachel
 * unveränderlich; bleiben ihre Bytes gleich, behält sie ihre Adresse über jede neue Revision der Pyramide hinweg.
 */
export const TERRAIN_TILE_REVISION_PATTERN = "^[0-9a-f]{16}$";

/** Der Schlüssel einer Kachel im Manifest: `z/x/y`. */
export const TERRAIN_TILE_KEY_PATTERN = "^[0-9]{1,2}/[0-9]{1,5}/[0-9]{1,5}$";

/** Die Dateiformate der Kacheln; die Endung der Kachel-URL ist der Name des Formats. */
export const TerrainTileFormat = Type.Union([Type.Literal("png"), Type.Literal("webp")]);

export type TerrainTileFormat = Static<typeof TerrainTileFormat>;

export const TerrainDemPointer = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        revision: Type.String({ pattern: TERRAIN_REVISION_PATTERN }),
        tileSize: Type.Integer({ exclusiveMinimum: 0 }),
        /** Darüber skaliert MapLibre die Höhen hoch; feiner als das Raster der Ableitung wird nichts. */
        maxNativeZoom: Type.Integer({ minimum: 0 }),
        /**
         * Nur `mapbox`: Die Kachel trägt die Höhe schon mit dem Ausgleich der Breite (WI-0049 S1).
         * Eine andere Kodierung hieße andere Höhen, und geraten wird nicht.
         */
        encoding: Type.Literal("mapbox"),
        /** Das Format der Kacheln dieser Revision. Fehlt es, sind es PNG (Zeiger vor WI-0073). */
        format: Type.Optional(TerrainTileFormat),
        /**
         * Das Manifest (JOBS-0001 V2, WI-0125): je Kachel (`z/x/y`) ihre Revision. Eine Karte, die es kennt, lädt jede Kachel
         * unter ihrer eigenen Adresse (`terrainTileUrl`) und nach einer Änderung nur die Kacheln, deren Revision sich änderte
         * (`changedTerrainTiles`). Fehlt es (älterer Server), gilt die Vorlage der Pyramidenrevision.
         */
        tiles: Type.Optional(
            Type.Record(
                Type.String({ pattern: TERRAIN_TILE_KEY_PATTERN }),
                Type.String({ pattern: TERRAIN_TILE_REVISION_PATTERN }),
                { additionalProperties: false },
            ),
        ),
    },
    { $id: "TerrainDemPointer", additionalProperties: false },
);

export type TerrainDemPointer = Static<typeof TerrainDemPointer>;

/** Wo der Zeiger liegt. */
export const TERRAIN_POINTER_URL = "/tiles/terrain/dem/current.json";

/** Die Kachelvorlage der Revision, auf die der Zeiger zeigt. */
export function terrainTileTemplate(pointer: TerrainDemPointer): string {
    return `/tiles/terrain/dem/${pointer.revision}/{z}/{x}/{y}.${pointer.format ?? "png"}`;
}

/** Eine Kachel der Pyramide. */
export interface TerrainTileId {
    z: number;
    x: number;
    y: number;
}

/** Der Schlüssel einer Kachel im Manifest. */
export function terrainTileKey(tile: TerrainTileId): string {
    return `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
}

/**
 * Die Adresse einer Kachel: unter ihrer eigenen Revision, wenn das Manifest sie nennt (`/tiles/terrain/dem/k/<kachelrevision>/…`),
 * sonst unter der Revision der Pyramide wie vor WI-0125. Beide sind unveränderlich.
 */
export function terrainTileUrl(pointer: TerrainDemPointer, tile: TerrainTileId): string {
    const format = pointer.format ?? "png";
    const own = pointer.tiles?.[terrainTileKey(tile)];
    const where = own === undefined ? pointer.revision : `k/${own}`;
    return `/tiles/terrain/dem/${where}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.${format}`;
}

/**
 * Welche Kacheln sich zwischen zwei Zeigern geändert haben: je Kachel ihre Adresse (`terrainTileUrl`) vorher gegen nachher.
 * Eine Kachel, deren Adresse gleich bleibt, hat dieselben Bytes; alle anderen sind neu zu laden. Ohne Manifest auf einer Seite ist
 * das bei anderer Pyramidenrevision jede Kachel (`all: true`).
 */
export function changedTerrainTiles(
    before: TerrainDemPointer,
    after: TerrainDemPointer,
): { all: boolean; tiles: TerrainTileId[] } {
    if (before.tileSize !== after.tileSize || before.maxNativeZoom !== after.maxNativeZoom)
        return { all: true, tiles: [] };
    if (!before.tiles || !after.tiles) {
        return before.revision === after.revision && before.format === after.format
            ? { all: false, tiles: [] }
            : { all: true, tiles: [] };
    }
    const tiles: TerrainTileId[] = [];
    for (let z = 0; z <= after.maxNativeZoom; z += 1) {
        const n = 1 << z;
        for (let y = 0; y < n; y += 1)
            for (let x = 0; x < n; x += 1) {
                const tile = { z, x, y };
                if (terrainTileUrl(before, tile) !== terrainTileUrl(after, tile)) tiles.push(tile);
            }
    }
    return { all: false, tiles };
}

/**
 * Streng: der Server prüft den Zeiger, den er sendet (jedes Feld, das das Schema nicht kennt, ist ein Fehler).
 * Der Client liest mit `readTerrainPointer` (WI-0075 R5b, `pointer-reading.ts`).
 */
export function parseTerrainPointer(candidate: unknown): TerrainDemPointer {
    return checkPointer(TerrainDemPointer, candidate, "Geländezeiger");
}

/** Tolerant: der Client liest den Zeiger und ignoriert Felder, die eine neuere Version des Servers dazugibt. */
export function readTerrainPointer(candidate: unknown): TerrainDemPointer {
    return readPointer(TerrainDemPointer, candidate, "Geländezeiger");
}
