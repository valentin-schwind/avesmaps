import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { PowerlineNetwork } from "@avesmaps3d/shared";
import { readPowerlineNetwork } from "../powerlines/network.ts";

/**
 * Das Netz der Kraftlinien als Ganzes (WI-0025 Stufe 2).
 *
 * Die Bögen am Himmel brauchen jede Linie GANZ und dazu, woran ihre Enden hängen. Die Vektorkacheln
 * liefern nur Stücke je Kachel und keine Knotenart. 174 Linien sind rund 50 KB, vor allem die
 * Kennungen der Enden.
 *
 * 🔴 ER LIEST NUR. Keine Methode außer GET, kein Schreibpfad, kein Nebeneffekt.
 */
export const powerlineRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/powerlines",
        {
            schema: {
                querystring: Type.Object({ r: Type.Optional(Type.Integer({ minimum: 1 })) }),
                response: { 200: PowerlineNetwork, 503: Type.Object({ error: Type.String() }) },
            },
        },
        async (request, reply) => {
            if (!app.database) {
                return reply.code(503).send({ error: "Datenbank nicht verbunden" });
            }
            // Ohne Revision kurz (die Linien ändern sich mit einem Import oder einer Operation); mit der Kartenrevision `?r=` ist jede
            // Revision eine eigene Adresse und darf dauerhaft liegen (WI-0205 K5, Claudio 2026-10-16: kein Nginx-Cache davor, ein späterer
            // nähme die volle Adresse als Schlüssel).
            void reply.header(
                "Cache-Control",
                request.query.r === undefined ? "public, max-age=300" : "public, max-age=31536000, immutable",
            );
            return readPowerlineNetwork(app.database);
        },
    );
};
