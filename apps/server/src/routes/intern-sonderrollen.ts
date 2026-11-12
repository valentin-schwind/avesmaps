import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    ApiErrorBody,
    SONDERROLLEN_ABGLEICH_URL,
    SonderrollenAbgleich,
    SonderrollenAbgleichStand,
} from "@avesmaps3d/shared";
import { sameSecret } from "../auth/tokens.ts";
import { ApiError } from "../http/api-error.ts";
import { isLoopback } from "./health.ts";

/**
 * Der interne Weg der Sonderrollen (WI-0279 E9; Claudio 2026-11-03):
 *
 *     GET /api/intern/sonderrollen        nur Production: Discord-ID, Rolle, Region aller geltenden Zuteilungen; `304` ohne Änderung
 *     GET /api/intern/sonderrollen/stand  nur Stage: wie der Abgleich steht, für den Betriebs-Wächter
 *
 * 🔴 **Loopback ist hier nicht privat:** Nginx reicht alle öffentlichen Anfragen an diesen Server. Darum drei Riegel: der Dienstschlüssel in
 * konstanter Zeit, keine Anfrage mit `X-Forwarded-For` oder `X-Real-IP` (die setzt Nginx), und der Vhost sperrt `/api/intern/` (Claudio). Wer einen
 * Riegel nicht besteht, bekommt ein schlichtes 404: Den Weg gibt es für ihn nicht.
 *
 * Nur diese drei Angaben, kein Name, kein Grund und keine Person ohne Discord-ID, denn die Stage erkennt niemanden sonst. Eine gesperrte Person
 * zählt nicht: Ihre Sonderrollen ruhen (E9b).
 */
const hash = (wert: string): Buffer => createHash("sha256").update(wert).digest();

export const internSonderrollenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const schluessel = app.config.sonderrollenAbgleich?.schluessel;
    const environment = app.authConfig.environment;
    if (schluessel === undefined || app.database === undefined || environment === undefined) return;
    const erwartet = hash(schluessel);

    const riegel = async (request: FastifyRequest): Promise<void> => {
        const kopf = request.headers.authorization ?? "";
        const gegeben = kopf.startsWith("Bearer ") ? kopf.slice("Bearer ".length) : "";
        const ok =
            sameSecret(hash(gegeben), erwartet) &&
            request.headers["x-forwarded-for"] === undefined &&
            request.headers["x-real-ip"] === undefined &&
            isLoopback(request.socket.remoteAddress ?? "");
        if (!ok) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    };
    const wacht = { config: { auth: "public" as const, errorEnvelope: true as const }, preValidation: riegel };

    if (environment === "production") {
        app.get(
            SONDERROLLEN_ABGLEICH_URL,
            { ...wacht, schema: { response: { 200: SonderrollenAbgleich, 304: Type.Null(), 404: ApiErrorBody } } },
            async (request, reply) => {
                void reply.header("cache-control", "no-store");
                const zeilen = await app.database!<
                    { discord_user_id: string; sonderrolle: string; region: string | null }[]
                >`
                    SELECT d.discord_user_id, z.sonderrolle, z.region_public_id::text AS region
                      FROM avesmaps_auth.sonderrolle_zuteilung z
                      JOIN avesmaps_auth.discord_login d ON d.person_id = z.person_id
                      JOIN avesmaps_auth.person p ON p.id = z.person_id AND p.status = 'active'
                     WHERE z.environment = ${environment} AND z.revoked_at IS NULL
                     ORDER BY d.discord_user_id, z.sonderrolle, z.region_public_id
                `;
                const zuteilungen = zeilen.map((zeile) => ({
                    discordId: zeile.discord_user_id,
                    sonderrolle: zeile.sonderrolle,
                    region: zeile.region,
                }));
                const revision = `"${createHash("sha256").update(JSON.stringify(zuteilungen)).digest("hex").slice(0, 32)}"`;
                void reply.header("etag", revision);
                if (request.headers["if-none-match"] === revision) return reply.code(304).send(null);
                return { zuteilungen };
            },
        );
    }

    if (environment === "staging") {
        app.get(
            `${SONDERROLLEN_ABGLEICH_URL}/stand`,
            { ...wacht, schema: { response: { 200: SonderrollenAbgleichStand, 404: ApiErrorBody } } },
            async (_request, reply) => {
                void reply.header("cache-control", "no-store");
                const abgleich = app.sonderrollenAbgleich;
                if (abgleich === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
                return abgleich.stand();
            },
        );
    }
};
