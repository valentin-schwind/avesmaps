import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { MAP_CHECKS, MAP_CHECKS_URL } from "@avesmaps3d/shared";
import { protect } from "../auth/plugin.ts";
import { loadMapCheck } from "../map-checks/checks.ts";
import { etagMatches } from "../media/delivery.ts";

/**
 * Die Prüfhaken im Auge (WI-0131 Stufe 1; Vertrag `packages/shared/src/map-checks.ts`):
 *
 *     GET /api/editor/checks/:check      die Funde einer Prüfung, mit ETag      use_editor_menu (R)
 *
 * 🔴 Ohne Anmeldung 401, ohne Recht 403, beides vor jeder Abfrage (`protect`); eine unbekannte Prüfung 400 (Schema). Nur lesend, in
 * einer Lesetransaktion.
 *
 * Wie die Ortsliste des Ortseditors (`editor-places.ts`): privat und bei jedem Aufruf neu geprüft (`private, no-cache`), der ETag ist
 * ein Hash über den Körper, ein unveränderter Stand kommt als 304 ohne Körper zurück. Packen tut Nginx (Block E): Die offenen
 * Wegenden tragen die Geometrie ihrer Wege mit. Der Körper entsteht aus den typisierten Ergebnissen; der Test prüft ihn gegen
 * den Vertrag.
 */
const ByCheck = Type.Object(
    { check: Type.Union(MAP_CHECKS.map((check) => Type.Literal(check))) },
    { additionalProperties: false },
);

export const mapCheckRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        `${MAP_CHECKS_URL}/:check`,
        { ...protect("use_editor_menu"), schema: { params: ByCheck } },
        async (request, reply) => {
            const body = JSON.stringify(await loadMapCheck(app.database!, request.params.check));
            const etag = `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 32)}"`;
            void reply.header("cache-control", "private, no-cache").header("etag", etag);
            if (etagMatches(request.headers["if-none-match"], etag)) return reply.code(304).send();
            void reply.type("application/json; charset=utf-8");
            return reply.send(body);
        },
    );
};
