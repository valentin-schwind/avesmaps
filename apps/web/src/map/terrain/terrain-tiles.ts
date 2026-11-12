import type { AddProtocolAction, Map as MapLibreMap } from "maplibre-gl";
import {
    changedTerrainTiles,
    terrainTileTemplate,
    terrainTileUrl,
    type TerrainDemPointer,
    type TerrainTileId,
} from "@avesmaps3d/shared";
import { previewTerrainTile } from "./terrain-preview";

/**
 * Jede Geländekachel unter ihrer eigenen Adresse (JOBS-0001 V2, WI-0125).
 *
 * Der Zeiger trägt ein Manifest: je Kachel ihre Revision, der Inhalts-Hash ihrer Bytes. Der Stil nennt dafür EINE Vorlage mit
 * eigenem Protokoll (`avesmaps-dem://{z}/{x}/{y}`), und dieses Modul löst sie je Kachel über das geltende Manifest auf
 * (`terrainTileUrl`). So bleibt der Stil gleich, wenn sich der Zeiger ändert (ein `setStyle` mit `diff` baut das Gelände nicht neu
 * auf), und nach einer lokalen Veröffentlichung lädt die Karte nur die Kacheln nach, deren Revision sich änderte
 * (`applyTerrainPointer`). Alle anderen behalten ihre Adresse; kämen sie doch neu, bediente sie der Browser aus seinem Cache
 * (`immutable`).
 *
 * ADR-0008 hatte den Inhalts-Hash je Kachel verworfen, „weil der Stil jede Kachel-URL kennen müsste“: Das Protokoll ist die Antwort.
 * Ohne Manifest (älterer Server) lädt dasselbe Protokoll die Pyramidenrevision; die lokale Höhenvorschau bleibt damit wirksam.
 */

export const TERRAIN_TILE_PROTOCOL = "avesmaps-dem";

/** Der Zeiger, über den das Protokoll gerade auflöst. */
let current: TerrainDemPointer | undefined;
let installed = false;

function parseTileUrl(url: string): TerrainTileId | undefined {
    const match = new RegExp(`^${TERRAIN_TILE_PROTOCOL}://(\\d+)/(\\d+)/(\\d+)$`).exec(url);
    if (!match) return undefined;
    return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

/**
 * Meldet das Protokoll einmal bei MapLibre an (es gilt für die ganze Seite). `app.vue` ruft es mit `maplibregl.addProtocol` vor dem
 * ersten Stil; ohne Anmeldung (etwa im Test) nennen die Quellen die Vorlage der Pyramidenrevision.
 */
export function installTerrainTileProtocol(add: (name: string, loader: AddProtocolAction) => void): void {
    if (installed) return;
    installed = true;
    add(TERRAIN_TILE_PROTOCOL, async (params, abortController) => {
        const tile = parseTileUrl(params.url);
        if (!tile || !current) throw new Error(`Geländekachel ohne Zeiger: ${params.url}`);
        const response = await fetch(terrainTileUrl(current, tile), { signal: abortController.signal });
        // 204: die Kachel fehlt, wie bei der Vorlage eine leere Antwort.
        if (response.status === 204) return { data: new ArrayBuffer(0) };
        if (!response.ok) throw new Error(`Geländekachel ${String(response.status)}: ${params.url}`);
        const bytes = await response.arrayBuffer();
        return { data: await previewTerrainTile(tile, bytes) };
    });
}

/** Angemeldet immer das eigene Protokoll (auch für die lokale Höhenvorschau), sonst direkt die Pyramidenrevision. */
export function terrainSourceTiles(pointer: TerrainDemPointer): string {
    if (!installed) return terrainTileTemplate(pointer);
    current = pointer;
    return `${TERRAIN_TILE_PROTOCOL}://{z}/{x}/{y}`;
}

/** Die Teile von MapLibre, die das Nachladen braucht: öffentlich `refreshTiles`, dazu (defensiv) der Speicher außer Sicht. */
interface TileCacheLike {
    filter(keep: (tile: { tileID: { canonical: TerrainTileId } }) => boolean): void;
}
interface TileManagerLike {
    _outOfViewCache?: TileCacheLike;
}

/**
 * Wechselt auf einen neuen Zeiger und lädt nur die Kacheln nach, deren Adresse sich änderte. `sources` sind die Quellen, die die
 * Geländekacheln lesen (Gelände und Schattierung). Gibt die Zahl der neu zu ladenden Kacheln zurück, oder `"all"`, wenn ohne
 * Manifest alles neu ist (dann baut der Aufrufer den Stil neu).
 *
 * 🪤 `refreshTiles` lädt nur Kacheln, die gerade gezeigt werden. Eine geänderte Kachel im Speicher außer Sicht käme beim
 * Zurückschwenken mit den alten Bytes wieder: Sie wird deshalb aus diesem Speicher genommen (MapLibre 6, `_outOfViewCache`; fehlt
 * er in einer anderen Fassung, lädt die Karte sie dort beim nächsten Zeigen ohnehin unter der neuen Adresse).
 */
export function applyTerrainPointer(
    map: MapLibreMap,
    sources: readonly string[],
    before: TerrainDemPointer,
    after: TerrainDemPointer,
): number | "all" {
    const changed = changedTerrainTiles(before, after);
    if (changed.all || !after.tiles || !installed) return "all";
    current = after;
    if (changed.tiles.length === 0) return 0;
    const keys = new Set(changed.tiles.map((tile) => `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`));
    for (const source of sources) {
        if (!map.getSource(source)) continue;
        map.refreshTiles(source, changed.tiles);
        const manager = (map as unknown as { style?: { tileManagers?: Record<string, TileManagerLike> } }).style
            ?.tileManagers?.[source];
        manager?._outOfViewCache?.filter((tile) => {
            const { z, x, y } = tile.tileID.canonical;
            return !keys.has(`${String(z)}/${String(x)}/${String(y)}`);
        });
    }
    return changed.tiles.length;
}
