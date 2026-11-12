import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AVENTURIA,
    parseTerrainPointer,
    TERRAIN_REVISION_PATTERN,
    TERRAIN_TILE_REVISION_PATTERN,
    type TerrainTileFormat,
} from "@avesmaps3d/shared";
import { loadTerrainManifest } from "../terrain/dem-manifest.ts";
import { LIVE_HEADER, offersAreaEvents } from "./live-hint.ts";

/**
 * Die Geländekacheln (`raster-dem`, WI-0049 S3), aus der Datenbank statt von der Platte.
 *
 * Dasselbe Schema wie die Grundkarte (ADR-0008): ein Zeiger ohne Cache, darunter Kacheln unter
 * ihrer Revision, die sich nie mehr ändern. Anders als die Grundkarte entstehen sie nicht aus einer
 * Quelldatei, sondern bei jedem Import mit `derive:terrain`; deshalb liegen sie in `terrain_dem_tile`
 * und kommen auf Stage ohne eigenes Veröffentlichen mit.
 *
 *     /tiles/terrain/dem/current.json                        welche Revision gilt, mit Format und Manifest
 *     /tiles/terrain/dem/<revision>/<z>/<x>/<y>.webp         eine Kachel unter der Revision der Pyramide (WI-0073)
 *     /tiles/terrain/dem/<revision>/<z>/<x>/<y>.png          dieselbe Kachel einer Revision aus der Zeit davor
 *     /tiles/terrain/dem/k/<kachelrevision>/<z>/<x>/<y>.webp eine Kachel unter IHRER Revision (WI-0125, JOBS-0001 V2)
 *
 * Die Endung ist das Format der Revision (`terrain_dem.format`); eine Revision antwortet nur unter ihrer Endung.
 * Die PNG-Endung bleibt, solange es PNG-Revisionen gibt: Ein offener Tab mit dem Zeiger von vor der Umstellung
 * fragt weiter nach `.png` (Frist der abgelösten Revision: ein Tag, ADR-0008).
 *
 * 🔴 Das Manifest (`tiles` im Zeiger, WI-0125): je Kachel ihre Revision, der Inhalts-Hash ihrer Bytes
 * (`terrain_dem_tile.tile_revision`, vom Trigger der Migration 0085 gesetzt). Eine lokale Veröffentlichung ändert nur die Kacheln
 * ihres Fußabdrucks; alle anderen behalten Bytes UND Adresse, und eine Karte lädt nur die geänderten nach. Eine Kachelrevision
 * gilt, solange irgendeine stehende Revision der Pyramide sie trägt (die aktuelle und die abgelöste, ADR-0008). Das Manifest
 * einer Revision ändert sich nie; der Zeiger wird je Revision einmal gebaut und im Prozess gehalten.
 */

const TileParams = Type.Object({
    revision: Type.String({ pattern: TERRAIN_REVISION_PATTERN }),
    z: Type.Integer({ minimum: 0, maximum: 24 }),
    x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }),
});

const OwnTileParams = Type.Object({
    tileRevision: Type.String({ pattern: TERRAIN_TILE_REVISION_PATTERN }),
    z: Type.Integer({ minimum: 0, maximum: 24 }),
    x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }),
});

const IMMUTABLE = "public, max-age=31536000, immutable";

const CONTENT_TYPES: Readonly<Record<TerrainTileFormat, string>> = { png: "image/png", webp: "image/webp" };

interface PointerRow {
    revision: string;
    tile_size: number;
    max_zoom: number;
    encoding: string;
    format: string;
}

export const terrainTileRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const live = offersAreaEvents(app);
    const unavailable = { error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } };
    /** Der zuletzt gebaute Zeiger: je Revision unveränderlich (nur mit vollständigem Manifest gemerkt). */
    let built: { key: string; body: string; etag: string } | undefined;

    app.get("/tiles/terrain/dem/current.json", async (request, reply) => {
        const database = app.database;
        if (!database) {
            return reply.code(503).header("cache-control", "no-store").send(unavailable);
        }
        const [row] = await database<PointerRow[]>`
            SELECT revision, tile_size, max_zoom, encoding, format
            FROM terrain_dem WHERE map_domain_id = ${AVENTURIA.mapDomain} AND is_current
        `;
        if (!row) {
            return reply
                .code(404)
                .header("cache-control", "no-store")
                .send({ error: { code: "no_terrain", message: "Es ist kein Gelände abgeleitet." } });
        }
        const key = JSON.stringify(row);
        let pointer = built?.key === key ? built : undefined;
        if (!pointer) {
            const tiles = await loadTerrainManifest(database, row.revision);
            // Derselbe Vertrag, den die Karte prüft: ein Zeiger, den sie verwerfen würde, geht gar nicht erst hinaus.
            const body = JSON.stringify(
                parseTerrainPointer({
                    schemaVersion: 1,
                    revision: row.revision,
                    tileSize: row.tile_size,
                    maxNativeZoom: row.max_zoom,
                    encoding: row.encoding,
                    format: row.format,
                    ...(tiles ? { tiles } : {}),
                }),
            );
            pointer = { key, body, etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"` };
            if (tiles) built = pointer;
        }
        reply.header("cache-control", "no-cache").header("etag", pointer.etag);
        if (live) reply.header(LIVE_HEADER, "area");
        if (request.headers["if-none-match"] === pointer.etag) {
            return reply.code(304).send();
        }
        return reply.header("content-type", "application/json; charset=utf-8").send(pointer.body);
    });

    for (const format of ["webp", "png"] as const satisfies readonly TerrainTileFormat[]) {
        app.get(
            `/tiles/terrain/dem/:revision/:z/:x/:y.${format}`,
            { schema: { params: TileParams } },
            async (request, reply) => {
                const database = app.database;
                if (!database) {
                    return reply.code(503).header("cache-control", "no-store").send(unavailable);
                }
                const { revision, z, x, y } = request.params;
                const [tile] = await database<{ image: Buffer }[]>`
                SELECT t.png AS image
                FROM terrain_dem_tile t JOIN terrain_dem d ON d.revision = t.revision
                WHERE t.revision = ${revision} AND d.format = ${format} AND t.z = ${z} AND t.x = ${x} AND t.y = ${y}
            `;
                if (!tile) {
                    // Wie bei der Grundkarte: eine fehlende Kachel ist leer, nicht ein Fehler - aber nie zu cachen.
                    return reply.code(204).header("cache-control", "no-store").send();
                }
                return reply
                    .header("cache-control", IMMUTABLE)
                    .header("content-type", CONTENT_TYPES[format])
                    .send(tile.image);
            },
        );
        app.get(
            `/tiles/terrain/dem/k/:tileRevision/:z/:x/:y.${format}`,
            { schema: { params: OwnTileParams } },
            async (request, reply) => {
                const database = app.database;
                if (!database) {
                    return reply.code(503).header("cache-control", "no-store").send(unavailable);
                }
                const { tileRevision, z, x, y } = request.params;
                // Irgendeine stehende Revision, die diese Kachel trägt: unter der Kachelrevision sind die Bytes dieselben.
                const [tile] = await database<{ image: Buffer }[]>`
                SELECT t.png AS image
                FROM terrain_dem_tile t JOIN terrain_dem d ON d.revision = t.revision
                WHERE t.tile_revision = ${tileRevision} AND t.z = ${z} AND t.x = ${x} AND t.y = ${y} AND d.format = ${format}
                LIMIT 1
            `;
                if (!tile) {
                    return reply.code(204).header("cache-control", "no-store").send();
                }
                return reply
                    .header("cache-control", IMMUTABLE)
                    .header("content-type", CONTENT_TYPES[format])
                    .send(tile.image);
            },
        );
    }
};
