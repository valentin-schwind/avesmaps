import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { MEDIA_TYPE_IMAGES_PUBLIC_URL, type MediaPublicView, type MediaTypeImagesPublic } from "@avesmaps3d/shared";
import { regularTypeImages, resolveTypeImageVariants } from "../media/resolver.ts";

/**
 * Die Typbilder für Besucher (WI-0068, Migration 0113): Kategorie → Adresse des veröffentlichten Bildes, nur was die EINE Policy erlaubt
 * (Rolle `header`, `resolveTypeImages`). Fehlt eine Kategorie, zeigt das Infopanel die eingebaute Grafik (bis zum Cutoff).
 *
 * Wie die Wappenkarte der Gebiete (`territories.ts`): EINE Antwort für alle, geordnet, ETag aus dem Körper, `no-cache` (ein neuer ★ gilt beim
 * nächsten Laden). Nur Adresse, Maße und, wo die Rechte sie verlangen, die Nennung verlassen den Server: keine Rechte, keine Herkunft, kein Asset.
 *
 * Zwei Karten (WI-0281, Betreiber 2026-11-05): `images` ist der Normalmodus (KI-Variante, sonst Ohne-KI-Variante), `ohneKi` der Modus „Ohne KI“ (nur die
 * Ohne-KI-Variante mit einer als ohne KI eingetragenen Entstehung). Ein Client der Vorversion liest nur `images` und sieht, was er bisher sah.
 *
 * 🔴 `auth: "public"` ausdrücklich (Qualitätsreview 2026-10-12): Die Route liegt unter `/api/media/`, nicht unter `/media/`, und fiel damit
 * durch die Präfixliste der Positivliste. Sie trägt ihre Entscheidung darum selbst, wie `admin-inhalte.ts` für `GET /api/content-state`;
 * ohne sie war `auth-routes.test.ts` rot und der Wächter, der eine still offene Route findet, als Signal entwertet.
 */
export const typeImageRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(MEDIA_TYPE_IMAGES_PUBLIC_URL, { config: { auth: "public" } }, async (request, reply) => {
        const database = app.database;
        if (!database) {
            return reply
                .code(503)
                .header("cache-control", "no-store")
                .send({ error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } });
        }
        const varianten = await resolveTypeImageVariants(database);
        const body = JSON.stringify({
            schemaVersion: 1,
            images: karte(regularTypeImages(varianten)),
            ohneKi: karte(varianten.ohneKi),
        } satisfies MediaTypeImagesPublic);
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        reply.header("cache-control", "no-cache").header("etag", etag);
        if (request.headers["if-none-match"] === etag) {
            return reply.code(304).send();
        }
        return reply.header("content-type", "application/json; charset=utf-8").send(body);
    });
};

/** Kategorie → Adresse, Maße und Nennung, geordnet nach der Kategorie (der ETag hängt am Körper). */
function karte(found: ReadonlyMap<string, MediaPublicView>): MediaTypeImagesPublic["images"] {
    const images: MediaTypeImagesPublic["images"] = {};
    for (const [category, view] of [...found].sort(([left], [right]) => (left < right ? -1 : 1))) {
        images[category] = {
            url: view.url,
            width: view.width,
            height: view.height,
            ...(view.credit === undefined ? {} : { credit: view.credit }),
        };
    }
    return images;
}
