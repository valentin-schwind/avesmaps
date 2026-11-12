import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AVENTURIA,
    TERRITORY_COATS_URL,
    TERRITORY_POINTER_URL,
    parseTerritoryCoats,
    parseTerritoryPointer,
} from "@avesmaps3d/shared";
import { resolveAllTerritoryCoats } from "../media/resolver.ts";

/**
 * Der Zeiger der Herrschaftsgebiete (WI-0062, ADR-0014): Gibt es abgeleitete Flächen und Grenzen, und welche
 * Revision gilt? Die Kacheln selbst liefert Martin (`territory_tile`, `territory_border_tile`); der Zeiger gibt der Karte die
 * Revision für die Kachel-Adresse (`?rev=`), sodass alle Clients nach einem Datenwechsel ohne mehrfaches Laden den
 * neuen Stand sehen (ADR-0008, MCS-022).
 *
 * 🔴 Ohne Ableitung keine Gebiete, statt alter: Ein Import, der etwas geändert hat, entwertet die Ableitung
 * (`derived_revision` wird leer); bis `derive:territories` gelaufen ist, antwortet der Zeiger 404
 * `no_territories`, und die Karte zeigt weder Flächen noch Grenzen.
 *
 * 🔴 `maxBand` ist das höchste Band, das die Ableitung trägt (WI-0188): Die Karte zeigt nie ein höheres. So bleibt eine
 * Umgebung nach dem Ausrollen von Band 8 bei Band 6 für jeden höheren Zoom, bis ihr Gebietsimport und ihre Ableitung die
 * Bänder 7 und 8 bringen.
 *
 *     /api/territories/current      welche Revision gilt (gehört zu `/api/`, Nginx braucht keinen neuen Ort)
 *     /api/territories/coats        welche Gebiete ein öffentliches Wappen tragen, und wo das Bild liegt (WI-0121)
 */
export const territoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(TERRITORY_POINTER_URL, async (request, reply) => {
        const database = app.database;
        if (!database) {
            return reply
                .code(503)
                .header("cache-control", "no-store")
                .send({ error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } });
        }
        const [state] = await database<
            { derived_revision: string | null; derived_year_bf: number | null; max_band: number | null }[]
        >`
            SELECT s.derived_revision, s.derived_year_bf,
                   (SELECT max(sh.band)::int FROM territory_shape sh JOIN territory t ON t.id = sh.territory_id
                     WHERE t.map_domain_id = s.map_domain_id) AS max_band
            FROM territory_state s
            WHERE s.map_domain_id = ${AVENTURIA.mapDomain}
        `;
        if (!state?.derived_revision || state.derived_year_bf === null) {
            return reply
                .code(404)
                .header("cache-control", "no-store")
                .send({ error: { code: "no_territories", message: "Es sind keine Herrschaftsgebiete abgeleitet." } });
        }
        const body = JSON.stringify(
            parseTerritoryPointer({
                schemaVersion: 1,
                revision: state.derived_revision,
                displayYearBf: state.derived_year_bf,
                ...(state.max_band === null ? {} : { maxBand: state.max_band }),
            }),
        );
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        reply.header("cache-control", "no-cache").header("etag", etag);
        if (request.headers["if-none-match"] === etag) {
            return reply.code(304).send();
        }
        return reply.header("content-type", "application/json; charset=utf-8").send(body);
    });

    /**
     * Die Wappen der Gebiete für die Namen auf der Karte (WI-0121): `territory.public_id` → Adresse des Bildes.
     *
     * 🔴 Dieselbe Entscheidung wie das Wappen im Infopanel (`resolveAllTerritoryCoats`, `media/policy.ts`): Unterdrückung,
     * Rückzug, Rechte und Veröffentlichung gelten hier genauso, und die Route entscheidet nichts selbst. Nur die
     * Adresse verlässt den Server - keine Rechte, keine Nennung, keine Herkunft.
     *
     * Eine Antwort für alle Gebiete, in EINER Abfrage: Die Karte liest sie einmal beim Laden, bevor sie die Namen baut (sonst
     * sprängen die Namen, wenn das Wappen nachkäme). Geordnet nach Kennung, damit der ETag nur wechselt, wenn sich etwas
     * ändert; `no-cache`, damit ein neues Wappen oder ein Rückzug beim nächsten Laden gilt. Ohne Wappen ist die Liste leer
     * und die Antwort 200, kein Fehler.
     */
    app.get(TERRITORY_COATS_URL, async (request, reply) => {
        const database = app.database;
        if (!database) {
            return reply
                .code(503)
                .header("cache-control", "no-store")
                .send({ error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } });
        }
        const found = await resolveAllTerritoryCoats(database);
        const coats: Record<string, string> = {};
        for (const [territoryId, view] of [...found].sort(([left], [right]) => (left < right ? -1 : 1))) {
            coats[territoryId] = view.url;
        }
        const body = JSON.stringify(parseTerritoryCoats({ schemaVersion: 1, coats }));
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        reply.header("cache-control", "no-cache").header("etag", etag);
        if (request.headers["if-none-match"] === etag) {
            return reply.code(304).send();
        }
        return reply.header("content-type", "application/json; charset=utf-8").send(body);
    });
};
