import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { MAP_SERIES_URL, MapSeriesCatalog } from "@avesmaps3d/shared";
import { kartenserienKatalog, leseKartenserien } from "../map-series/stand.ts";

/**
 * Der wirksame Katalog der Kartenserien (WI-0220), öffentlich:
 *
 *     GET /api/map-series   Vorgabe der JSON samt Abweichungen und neuen Serien, ohne Papierkorb   keine Anmeldung
 *
 * - `no-cache` mit ETag wie `GET /api/map-settings`: Die Karte liest es VOR ihrem Start (`apps/web/src/map/kartenserien-stand.ts`),
 *   ein unveränderter Stand kostet ein 304.
 * - Serien nur für Editoren stehen mit drin, genau wie bisher im gebündelten Katalog: Welche jemand wählen darf, entscheidet
 *   `getVisibleMapSeries` im Browser. Das Ausblenden ist keine Zugriffskontrolle (`docs/regeln/oberflaeche.md`, „Kartenserie
 *   `old`“); die Kacheln sind ohnehin für jeden abrufbar.
 */
export const mapSeriesRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        MAP_SERIES_URL,
        { config: { auth: "public" }, schema: { response: { 200: MapSeriesCatalog, 304: Type.Null() } } },
        async (request, reply) => {
            const stand = await leseKartenserien(app.database);
            const katalog = kartenserienKatalog(stand);
            const abdruck = createHash("sha256").update(JSON.stringify(katalog)).digest("base64url").slice(0, 22);
            const etag = `"k${abdruck}-${stand.source}"`;
            reply.header("cache-control", "no-cache");
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return katalog;
        },
    );
};
