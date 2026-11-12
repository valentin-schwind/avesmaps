import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { TILE_REVISIONS_URL, type TileRevisions } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Kachelrevisionen beim Start der Karte (WI-0283 H3, `packages/shared/src/tile-revisions.ts`): je berührter Art das jüngste
 * Ereignis `map.changed`, gelesen aus `job_event`. Es ist derselbe Stand, den eine laufende Karte aus den Ereignissen kennt; ein
 * Besucher ohne `/ws` kennt ihn sonst gar nicht, und seine Kacheln gingen ohne Revision (Nginx: `no-cache`).
 *
 * Ein Element ohne Art zählt wie ein Ereignis ohne `affected`: Die Karte lädt darauf alle Quellen (`quellenFuer`). Die Aufbewahrung von
 * `job_event` (14 Tage) schadet nicht: Fehlt die letzte Änderung einer Art, gilt die jüngste, die noch da ist, und die Adresse wechselt
 * höchstens einmal.
 */
export async function readTileRevisionsFrom(database: Queryable): Promise<TileRevisions> {
    const zeilen = await database<{ art: string | null; seq: string }[]>`
        SELECT a.art, max(e.seq)::text AS seq
        FROM job_event e
        LEFT JOIN LATERAL (
            SELECT DISTINCT x->>'kind' AS art
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(e.payload->'affected') = 'array' THEN e.payload->'affected' ELSE '[]'::jsonb END
            ) x
        ) a ON true
        WHERE e.kind = 'map.changed'
        GROUP BY a.art
    `;
    const arten: Record<string, number> = {};
    let ohneArt = 0;
    for (const { art, seq } of zeilen) {
        if (art === null) ohneArt = Number(seq);
        else arten[art] = Number(seq);
    }
    return { schemaVersion: 1, ohneArt, arten };
}

export const tileRevisionRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(TILE_REVISIONS_URL, async (request, reply) => {
        const database = app.database;
        if (!database) {
            return reply
                .code(503)
                .header("cache-control", "no-store")
                .send({ error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } });
        }
        const body = JSON.stringify(await readTileRevisionsFrom(database));
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        reply.header("cache-control", "no-cache").header("etag", etag);
        if (request.headers["if-none-match"] === etag) return reply.code(304).send();
        return reply.header("content-type", "application/json; charset=utf-8").send(body);
    });
};
