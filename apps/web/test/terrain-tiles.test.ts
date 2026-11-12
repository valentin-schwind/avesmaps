import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddProtocolAction, Map as MapLibreMap } from "maplibre-gl";
import type { TerrainDemPointer } from "@avesmaps3d/shared";
import {
    applyTerrainPointer,
    installTerrainTileProtocol,
    TERRAIN_TILE_PROTOCOL,
    terrainSourceTiles,
} from "../src/map/terrain/terrain-tiles.ts";

/**
 * Jede Geländekachel unter ihrer eigenen Revision (WI-0125, JOBS-0001 V2): das Protokoll löst über das geltende Manifest auf, und
 * ein neuer Zeiger lädt nur die Kacheln nach, deren Revision sich änderte, auch aus dem Speicher außer Sicht.
 */

const BEFORE: TerrainDemPointer = {
    schemaVersion: 1,
    revision: "aaaaaaaaaaaa",
    tileSize: 512,
    maxNativeZoom: 1,
    encoding: "mapbox",
    format: "webp",
    tiles: {
        "0/0/0": "0000000000000000",
        "1/0/0": "1000000000000000",
        "1/1/0": "1100000000000000",
        "1/0/1": "1010000000000000",
        "1/1/1": "1110000000000000",
    },
};

const AFTER: TerrainDemPointer = {
    ...BEFORE,
    revision: "bbbbbbbbbbbb",
    tiles: { ...BEFORE.tiles, "0/0/0": "000000000000000f", "1/1/0": "110000000000000f" },
};

/** Derselbe Zeiger ohne Manifest (ein Server vor WI-0125). */
function withoutTiles(pointer: TerrainDemPointer): TerrainDemPointer {
    const copy = { ...pointer };
    delete copy.tiles;
    return copy;
}

let loader: AddProtocolAction | undefined;

beforeAll(() => {
    // Vor der Anmeldung nennen die Quellen die Vorlage der Pyramidenrevision.
    expect(terrainSourceTiles(BEFORE)).toBe("/tiles/terrain/dem/aaaaaaaaaaaa/{z}/{x}/{y}.webp");
    installTerrainTileProtocol((name, load) => {
        expect(name).toBe(TERRAIN_TILE_PROTOCOL);
        loader = load;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function fakeMap(sources: string[]) {
    const refreshed: { source: string; tiles: { z: number; x: number; y: number }[] }[] = [];
    const kept = new Map<string, string[]>();
    const cached = ["0/0/0", "1/0/0", "1/1/0"].map((key) => {
        const [z, x, y] = key.split("/").map(Number) as [number, number, number];
        return { key, tileID: { canonical: { z, x, y } } };
    });
    const map = {
        getSource: (id: string) => (sources.includes(id) ? {} : undefined),
        refreshTiles: (source: string, tiles: { z: number; x: number; y: number }[]) => {
            refreshed.push({ source, tiles });
        },
        style: {
            tileManagers: Object.fromEntries(
                sources.map((id) => [
                    id,
                    {
                        _outOfViewCache: {
                            filter: (keep: (tile: (typeof cached)[number]) => boolean) => {
                                kept.set(
                                    id,
                                    cached.filter(keep).map((tile) => tile.key),
                                );
                            },
                        },
                    },
                ]),
            ),
        },
    } as unknown as MapLibreMap;
    return { map, refreshed, kept };
}

describe("Geländekacheln je Revision (WI-0125)", () => {
    it("🔴 mit Manifest nennt die Quelle das eigene Protokoll, und das Protokoll lädt die Kachel unter ihrer Revision", async () => {
        expect(terrainSourceTiles(BEFORE)).toBe(`${TERRAIN_TILE_PROTOCOL}://{z}/{x}/{y}`);
        const urls: string[] = [];
        vi.stubGlobal("fetch", async (url: string) => {
            urls.push(url);
            return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        });
        const result = await loader!({ url: `${TERRAIN_TILE_PROTOCOL}://1/1/0` }, new AbortController());
        expect(urls).toEqual(["/tiles/terrain/dem/k/1100000000000000/1/1/0.webp"]);
        expect(new Uint8Array(result.data as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("ohne Manifest lädt das Protokoll die Pyramidenrevision und erhält die Vorschau-Komposition", async () => {
        const plain = withoutTiles(BEFORE);
        expect(terrainSourceTiles(plain)).toBe(`${TERRAIN_TILE_PROTOCOL}://{z}/{x}/{y}`);
        const urls: string[] = [];
        vi.stubGlobal("fetch", async (url: string) => {
            urls.push(url);
            return new Response(new Uint8Array([7, 8, 9]), { status: 200 });
        });
        const result = await loader!({ url: `${TERRAIN_TILE_PROTOCOL}://1/0/1` }, new AbortController());
        expect(urls).toEqual(["/tiles/terrain/dem/aaaaaaaaaaaa/1/0/1.webp"]);
        expect(new Uint8Array(result.data as ArrayBuffer)).toEqual(new Uint8Array([7, 8, 9]));
    });

    it("🔴 ein neuer Zeiger lädt nur die geänderten Kacheln nach, in beiden Quellen, und nimmt sie aus dem Speicher außer Sicht", async () => {
        terrainSourceTiles(BEFORE);
        const { map, refreshed, kept } = fakeMap(["gelaende", "schatten"]);
        expect(applyTerrainPointer(map, ["gelaende", "schatten", "fehlt"], BEFORE, AFTER)).toBe(2);
        expect(refreshed).toEqual([
            {
                source: "gelaende",
                tiles: [
                    { z: 0, x: 0, y: 0 },
                    { z: 1, x: 1, y: 0 },
                ],
            },
            {
                source: "schatten",
                tiles: [
                    { z: 0, x: 0, y: 0 },
                    { z: 1, x: 1, y: 0 },
                ],
            },
        ]);
        expect(kept.get("gelaende")).toEqual(["1/0/0"]);
        // Danach löst das Protokoll über den neuen Zeiger auf.
        const urls: string[] = [];
        vi.stubGlobal("fetch", async (url: string) => {
            urls.push(url);
            return new Response(new Uint8Array([4]), { status: 200 });
        });
        await loader!({ url: `${TERRAIN_TILE_PROTOCOL}://0/0/0` }, new AbortController());
        await loader!({ url: `${TERRAIN_TILE_PROTOCOL}://1/0/0` }, new AbortController());
        expect(urls).toEqual([
            "/tiles/terrain/dem/k/000000000000000f/0/0/0.webp",
            "/tiles/terrain/dem/k/1000000000000000/1/0/0.webp",
        ]);
    });

    it("ein Zeiger ohne Manifest heißt: alles neu (der Aufrufer baut den Stil neu)", () => {
        const { map, refreshed } = fakeMap(["gelaende"]);
        const plain = withoutTiles(AFTER);
        expect(applyTerrainPointer(map, ["gelaende"], BEFORE, plain)).toBe("all");
        expect(refreshed).toEqual([]);
        expect(applyTerrainPointer(map, ["gelaende"], AFTER, AFTER)).toBe(0);
    });
});
