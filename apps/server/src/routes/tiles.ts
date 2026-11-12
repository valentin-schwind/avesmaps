import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { istKartenserieKennung, RASTER_REVISION_PATTERN } from "@avesmaps3d/shared";

/**
 * Raster tiles of the base map series.
 *
 * The prefix separates the two kinds of tiles that share one origin: raster tiles are files on
 * disk, vector tiles come from Martin. In production Nginx serves this directory directly and
 * routes /tiles/vector/ to Martin (ADR-0004); the routes exist so local development answers on
 * exactly the same paths with the same caching headers. Tiles are derived data, rebuilt from the
 * authoritative source raster and never migrated (chapter 9.63).
 *
 * Layout under TILE_ROOT (ADR-0008, written by scripts/dev/build-map-tiles.ps1):
 *
 *     <series>/current.json                        the pointer: which revision is delivered
 *     <series>/<revision>/<z>/<x>/<y>.webp         a pyramid; not one byte changes under a revision
 */

const PointerParams = Type.Object({
    series: Type.String(),
});

const TileParams = Type.Object({
    series: Type.String(),
    revision: Type.String({ pattern: RASTER_REVISION_PATTERN }),
    z: Type.Integer({ minimum: 0, maximum: 24 }),
    x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }),
});

/** A revision never changes, so the browser may keep its tiles for a year without asking. */
const IMMUTABLE = "public, max-age=31536000, immutable";

export const tileRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const tileRoot = app.config.tileRoot;

    app.get(
        "/tiles/raster/:series/current.json",
        {
            schema: {
                params: PointerParams,
            },
        },
        async (request, reply) => {
            const { series } = request.params;
            // Nur das Muster der Kennung (WI-0220): Serien entstehen zur Laufzeit, ob es eine gibt, sagt die Platte.
            if (!istKartenserieKennung(series)) {
                return reply.code(404).send({ error: { code: "unknown_series", message: "Unbekannte Kartenserie." } });
            }
            if (!tileRoot) {
                return reply
                    .code(503)
                    .send({ error: { code: "tiles_not_configured", message: "TILE_ROOT ist nicht konfiguriert." } });
            }

            let body: Buffer;
            try {
                body = await readFile(join(tileRoot, series, "current.json"));
            } catch {
                // No pyramid built for this series: said out loud, never answered like an empty tile.
                return reply
                    .code(404)
                    .header("cache-control", "no-store")
                    .send({
                        error: {
                            code: "no_raster_pointer",
                            message: "Für diese Serie ist keine Rasterpyramide gebaut.",
                        },
                    });
            }

            // 🪤 `no-cache` means "store, but ask every time" - the pointer is the one file whose
            // content changes, so the browser revalidates it and gets a 304 while it still holds.
            const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
            reply.header("cache-control", "no-cache").header("etag", etag);
            if (request.headers["if-none-match"] === etag) {
                return reply.code(304).send();
            }
            return reply.header("content-type", "application/json; charset=utf-8").send(body);
        },
    );

    app.get(
        "/tiles/raster/:series/:revision/:z/:x/:y.webp",
        {
            schema: {
                params: TileParams,
            },
        },
        async (request, reply) => {
            const { series, revision, z, x, y } = request.params;

            // The series id matches its pattern (WI-0220: series appear at runtime), the revision is twelve hex digits and
            // the rest are integers from the schema, so no part of the path is attacker-shaped. The resolve check below is
            // the second lock.
            if (!istKartenserieKennung(series)) {
                return reply.code(404).send({ error: { code: "unknown_series", message: "Unbekannte Kartenserie." } });
            }
            if (!tileRoot) {
                return reply
                    .code(503)
                    .send({ error: { code: "tiles_not_configured", message: "TILE_ROOT ist nicht konfiguriert." } });
            }
            // A series without a directory does not exist; an empty 204 is only for gaps INSIDE a pyramid.
            const seriesDirectory = await stat(join(tileRoot, series)).catch(() => undefined);
            if (seriesDirectory?.isDirectory() !== true) {
                return reply.code(404).send({ error: { code: "unknown_series", message: "Unbekannte Kartenserie." } });
            }

            const revisionRoot = resolve(tileRoot, series, revision);
            const file = join(revisionRoot, String(z), String(x), `${y}.webp`);
            if (!resolve(file).startsWith(revisionRoot)) {
                return reply.code(400).send({ error: { code: "bad_path", message: "Ungueltiger Kachelpfad." } });
            }

            try {
                const info = await stat(file);
                if (info.isFile()) {
                    return reply
                        .header("content-type", "image/webp")
                        .header("cache-control", IMMUTABLE)
                        .send(createReadStream(file));
                }
            } catch {
                // missing, answered below
            }
            // Missing tiles outside the covered area are normal; 204 keeps the renderer quiet. And
            // `no-store`: an empty answer must never be held like a tile (found on staging, where a
            // browser kept empty tiles for a day).
            return reply.code(204).header("cache-control", "no-store").send();
        },
    );
};
