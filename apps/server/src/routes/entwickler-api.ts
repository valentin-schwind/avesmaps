import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply, FastifyRequest, onSendHookHandler } from "fastify";
import {
    ALTE_API_WEGE,
    ApiErrorBody,
    ENTWICKLER_DOKU_URL,
    ENTWICKLER_OPENAPI_URL,
    ENTWICKLER_ORT_URL,
    ENTWICKLER_ORTE_URL,
    ENTWICKLER_ROUTE_UEBER_MAX,
    ENTWICKLER_ROUTE_UEBER_TRENNER,
    ENTWICKLER_ROUTE_URL,
    ENTWICKLER_SUCHE_URL,
    ENTWICKLER_SUCHE_VORGABE,
    ENTWICKLER_VERTRAG_FASSUNG,
    EntwicklerOrtDetail,
    EntwicklerOrteListe,
    EntwicklerOrtParams,
    EntwicklerRoute,
    EntwicklerRouteQuery,
    EntwicklerSuche,
    EntwicklerSucheQuery,
    ROUTE_DEFAULTS,
    UUID_PATTERN,
    type EntwicklerApiFehler,
    type WaypointHit,
} from "@avesmaps3d/shared";
import { leseEntwicklerOrte } from "../entwickler-api/orte.ts";
import { entwicklerOpenApi } from "../entwickler-api/openapi.ts";
import { entwicklerRoute } from "../entwickler-api/route-sicht.ts";
import { apiErrorBody } from "../http/api-error.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";

/**
 * Die Entwickler-API, Fassung 1 (WI-0303 P7; Vertrag `packages/shared/src/entwickler-api.ts`, Doku `docs/schnittstellen/entwickler-api.md`).
 *
 * 🔴 **Für jede Herkunft offen, nie mit Anmeldung.** Jede Antwort trägt `Access-Control-Allow-Origin: *`; ein Browser schickt dann keine
 * Cookies mit, ein Aufruf von einer fremden Seite ist immer anonym und sieht genau, was `curl` sieht. Die übrigen Wege unter `/api/v1`
 * (`/api/v1/karten` mit Schlüssel) bekommen mit Absicht keine CORS-Kopfzeilen: Ein Schlüssel gehört nicht in eine Webseite.
 *
 * Die Antworten sind eigene schmale Sichten über den Diensten der Karte (Wegpunkt-Index, Infopanel, Wegfindung), nie deren interne
 * Antworten: Die ändern sich mit der Oberfläche, der Vertrag nicht. Last fängt die Drossel des Webservers ab (Claudio, Zonen
 * `v1_reise` und `v1_suche`); in der Anwendung begrenzen die Wegfindung (je Client zwei offene Rechnungen) und das Infopanel (vier
 * gleichzeitig).
 */

const OFFEN = "*";
/** Die Kopfzeilen, die ein fremdes Skript lesen darf. */
const SICHTBAR = "Retry-After";

const offen: onSendHookHandler = (_request, reply, payload, done) => {
    void reply.header("access-control-allow-origin", OFFEN);
    void reply.header("access-control-expose-headers", SICHTBAR);
    done(null, payload);
};

/** Die Optionen jeder Route hier: öffentlich, Fehler im Umschlag (ADR-0018), CORS offen. */
const tuer = { config: { auth: "public" as const, errorEnvelope: true }, onSend: offen };

const FEHLER = { 400: ApiErrorBody, 404: ApiErrorBody, 503: ApiErrorBody };

/** So viele Detailabfragen dürfen gleichzeitig laufen, wie das Infopanel selbst zulässt (`SUBJECT_LIMITS.concurrent`). */
const DETAIL_GLEICHZEITIG = 4;

function fehler(
    reply: FastifyReply,
    code: EntwicklerApiFehler,
    status: number,
    message: string,
    details?: Record<string, unknown>,
    retryAfter?: number,
): FastifyReply {
    if (retryAfter !== undefined) void reply.header("retry-after", String(retryAfter));
    return reply.code(status).send(apiErrorBody(code, message, details));
}

const UUID = new RegExp(UUID_PATTERN, "u");

type Aufloesung = { ok: true; orte: WaypointHit[] } | { ok: false; feld: "von" | "nach" | "ueber"; index?: number };

export const entwicklerApiRoutes: FastifyPluginAsyncTypebox = async (app) => {
    let detailsInArbeit = 0;

    /** Die Vorabfrage eines Browsers: welche Methoden und Kopfzeilen gehen. */
    const vorabfrage = (url: string, methoden: string): void => {
        app.options(url, { config: { auth: "public" } }, async (_request, reply) => {
            void reply.header("access-control-allow-origin", OFFEN);
            void reply.header("access-control-allow-methods", methoden);
            void reply.header("access-control-allow-headers", "Content-Type, Accept, If-None-Match");
            void reply.header("access-control-max-age", "86400");
            return reply.code(204).send();
        });
    };

    app.get(
        ENTWICKLER_ORTE_URL,
        { ...tuer, schema: { response: { 200: EntwicklerOrteListe, 503: ApiErrorBody } } },
        async (_request, reply) => {
            if (!app.database)
                return fehler(reply, "database_unavailable", 503, "Die Datenbank ist nicht erreichbar.", undefined, 5);
            const orte = await leseEntwicklerOrte(app.database);
            void reply.header("cache-control", "public, max-age=300");
            return { vertrag: ENTWICKLER_VERTRAG_FASSUNG, anzahl: orte.length, orte };
        },
    );
    vorabfrage(ENTWICKLER_ORTE_URL, "GET, OPTIONS");

    app.get(
        ENTWICKLER_ORT_URL,
        { ...tuer, schema: { params: EntwicklerOrtParams, response: { 200: EntwicklerOrtDetail, ...FEHLER } } },
        async (request, reply) => {
            if (!app.waypointIndex)
                return fehler(reply, "database_unavailable", 503, "Die Datenbank ist nicht erreichbar.", undefined, 5);
            const id = request.params.id.toLowerCase();
            const [ort] = await app.waypointIndex.byIds([id]);
            // Eine Landmarke hat die Kennung `l:<uuid>` und kommt hier nie an; ein verborgener Ort ist über seine Kennung zu lesen wie im
            // Infopanel (WI-0080), nur in keiner Liste.
            if (!ort || ort.landmark !== undefined) return fehler(reply, "not_found", 404, "Diesen Ort gibt es nicht.");
            const antwort: EntwicklerOrtDetail = {
                vertrag: ENTWICKLER_VERTRAG_FASSUNG,
                id: ort.id,
                name: ort.name,
                art: ort.subtype,
                x: ort.x,
                y: ort.y,
            };
            if (app.subjects) {
                if (detailsInArbeit >= DETAIL_GLEICHZEITIG) {
                    return fehler(reply, "server_busy", 503, "Gerade sind zu viele Anfragen in Arbeit.", undefined, 1);
                }
                detailsInArbeit += 1;
                try {
                    const detail = await app.subjects.detail({ kind: "place", id });
                    if (detail?.wiki) {
                        antwort.wiki = {
                            url: detail.wiki.url,
                            ...(detail.wiki.title ? { titel: detail.wiki.title } : {}),
                        };
                    }
                    const ketten = detail?.context?.territories?.chains;
                    if (ketten && ketten.length > 0) {
                        antwort.gebiete = ketten.map((kette) =>
                            kette.map((gebiet) => ({
                                id: gebiet.ref.id,
                                name: gebiet.name,
                                ...(gebiet.type ? { art: gebiet.type } : {}),
                            })),
                        );
                    } else if (detail?.context === undefined) {
                        // Ohne Kontext (an der Zeitgrenze) fehlen die Gebiete nur jetzt: nicht zwischenspeichern.
                        void reply.header("cache-control", "no-store");
                    }
                } finally {
                    detailsInArbeit -= 1;
                }
            }
            if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "public, max-age=60");
            return antwort;
        },
    );
    vorabfrage(ENTWICKLER_ORT_URL, "GET, OPTIONS");

    app.get(
        ENTWICKLER_SUCHE_URL,
        { ...tuer, schema: { querystring: EntwicklerSucheQuery, response: { 200: EntwicklerSuche, ...FEHLER } } },
        async (request, reply) => {
            if (!app.waypointIndex)
                return fehler(reply, "database_unavailable", 503, "Die Datenbank ist nicht erreichbar.", undefined, 5);
            const hoechstens = (await wegfindungswerte(app.database)).waypointLookupLimit;
            const limit = Math.min(request.query.limit ?? ENTWICKLER_SUCHE_VORGABE, hoechstens);
            // Einer mehr, als verlangt: Verborgene Orte und Landmarken fallen heraus, und `gekuerzt` soll stimmen.
            const antwort = await app.waypointIndex.lookup(request.query.q, Math.min(limit + 1, hoechstens));
            const orte = antwort.hits.filter((hit) => hit.landmark === undefined && !hit.hidden);
            // Wie ein einzelner Ort: Verborgene fallen oben heraus, die Antwort ist für alle gleich (Claudios Vorprobe 2026-11-12).
            void reply.header("cache-control", "public, max-age=60");
            return {
                vertrag: ENTWICKLER_VERTRAG_FASSUNG,
                anfrage: request.query.q,
                treffer: orte
                    .slice(0, limit)
                    .map((ort) => ({ id: ort.id, name: ort.name, art: ort.subtype, x: ort.x, y: ort.y })),
                gekuerzt: orte.length > limit || antwort.truncated,
            };
        },
    );
    vorabfrage(ENTWICKLER_SUCHE_URL, "GET, OPTIONS");

    /** Kennung oder genauer Name zu einem Ort. Ein Name findet nie einen verborgenen Ort (der ist nur über seine Kennung zu erreichen). */
    const loese = async (
        angaben: { feld: "von" | "nach" | "ueber"; index?: number; wert: string }[],
    ): Promise<Aufloesung> => {
        const index = app.waypointIndex;
        if (!index) throw new Error("Wegpunkt-Index fehlt");
        const kennungen = angaben.map((angabe) =>
            UUID.test(angabe.wert.toLowerCase()) ? angabe.wert.toLowerCase() : null,
        );
        const nachKennung = await index.byIds(kennungen.filter((k): k is string => k !== null));
        const namen = angaben.filter((_angabe, i) => kennungen[i] === null).map((angabe) => angabe.wert);
        const nachName = namen.length > 0 ? await index.resolve(namen) : [];
        const orte: WaypointHit[] = [];
        let k = 0;
        let n = 0;
        for (const [i, angabe] of angaben.entries()) {
            const ort = kennungen[i] === null ? nachName[n++] : nachKennung[k++];
            const gefunden = ort && ort.landmark === undefined && (kennungen[i] !== null || !ort.hidden);
            if (!gefunden)
                return { ok: false, feld: angabe.feld, ...(angabe.index === undefined ? {} : { index: angabe.index }) };
            orte.push(ort);
        }
        return { ok: true, orte };
    };

    app.get(
        ENTWICKLER_ROUTE_URL,
        {
            ...tuer,
            schema: {
                querystring: EntwicklerRouteQuery,
                response: { 200: EntwicklerRoute, ...FEHLER, 422: ApiErrorBody },
            },
        },
        async (request, reply) => {
            if (!app.routeRunner || !app.waypointIndex) {
                return fehler(reply, "database_unavailable", 503, "Die Wegfindung ist nicht erreichbar.", undefined, 5);
            }
            const query = request.query;
            const ueber = (query.ueber ?? "")
                .split(ENTWICKLER_ROUTE_UEBER_TRENNER)
                .map((wert) => wert.trim())
                .filter((wert) => wert.length > 0);
            if (ueber.length > ENTWICKLER_ROUTE_UEBER_MAX) {
                return fehler(
                    reply,
                    "validation_failed",
                    400,
                    `Höchstens ${String(ENTWICKLER_ROUTE_UEBER_MAX)} Zwischenhalte.`,
                    {
                        issues: [{ path: "/ueber", rule: "maxItems" }],
                    },
                );
            }
            const aufloesung = await loese([
                { feld: "von", wert: query.von.trim() },
                ...ueber.map((wert, index) => ({ feld: "ueber" as const, index, wert })),
                { feld: "nach", wert: query.nach.trim() },
            ]);
            if (!aufloesung.ok) {
                const details = {
                    feld: aufloesung.feld,
                    ...(aufloesung.index === undefined ? {} : { index: aufloesung.index }),
                };
                return fehler(
                    reply,
                    "place_not_found",
                    404,
                    "Einen Ort der Route gibt es nicht, oder sein Name ist nicht eindeutig.",
                    details,
                );
            }
            const wege = new Set((query.wege ?? "land,fluss,see").split(","));
            // Die Drossel je Client (S-04) zählt offene Rechnungen nach `request.ip`, wie bei `/api/route`.
            const outcome = await app.routeRunner.run({
                client: request.ip,
                waypoints: aufloesung.orte.map((ort) => ort.id),
                optimize: query.optimierung === "kuerzeste" ? "shortest" : ROUTE_DEFAULTS.optimize,
                transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
                enabled: { land: wege.has("land"), river: wege.has("fluss"), sea: wege.has("see") },
                minimizeTransfers: ROUTE_DEFAULTS.minimize_transfers,
                hurry: ROUTE_DEFAULTS.hurry,
                hoursPerDay: ROUTE_DEFAULTS.hours_per_day,
            });
            if (outcome.ok) return entwicklerRoute(outcome.response);
            if (outcome.error === "unknown_waypoint") {
                return fehler(reply, "place_not_found", 404, "Einen Ort der Route gibt es nicht.", {});
            }
            if (outcome.error === "route_too_large") {
                return fehler(reply, "route_too_large", 422, "Die Reise ist größer, als eine Antwort sein darf.");
            }
            return fehler(reply, "routing_unavailable", 503, "Die Wegfindung ist gerade ausgelastet.", undefined, 2);
        },
    );
    vorabfrage(ENTWICKLER_ROUTE_URL, "GET, OPTIONS");

    app.get(ENTWICKLER_OPENAPI_URL, { ...tuer }, async (_request, reply) => {
        void reply.header("cache-control", "public, max-age=3600");
        void reply.type("application/json; charset=utf-8");
        return entwicklerOpenApi();
    });
    vorabfrage(ENTWICKLER_OPENAPI_URL, "GET, OPTIONS");

    /**
     * Die alte Entwickler-API von Legacy: `410 Gone` mit dem Weg zur neuen (Betreiber 2026-11-10: „Gleich 410“). Kein Zählen hier: Die
     * Zählung unter Status › API (WI-0307) erkennt die Pfade selbst und behält ihre Namen.
     */
    const weg = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const alt = ALTE_API_WEGE.find((eintrag) => eintrag.pfad === request.routeOptions.url);
        return fehler(reply, "api_gone", 410, "Diese Schnittstelle gibt es nicht mehr. Die neue steht unter /api/v1.", {
            doku: ENTWICKLER_DOKU_URL,
            nachfolger: alt?.nachfolger ?? ENTWICKLER_ROUTE_URL,
        });
    };
    for (const alt of ALTE_API_WEGE) {
        const optionen = {
            ...tuer,
            config: { ...tuer.config, ...(alt.methode === "POST" ? { writeClass: "public" as const } : {}) },
            schema: { response: { 410: ApiErrorBody } },
        };
        // 🪤 Die Antwort fällt schon in `onRequest`, vor dem Lesen des Rumpfs: Ein alter Client, der Formulardaten schickt, bekäme sonst
        // 415 statt 410.
        const bereit = { ...optionen, onRequest: weg };
        if (alt.methode === "POST") app.post(alt.pfad, bereit, async () => undefined);
        else app.get(alt.pfad, bereit, async () => undefined);
        vorabfrage(alt.pfad, `${alt.methode}, OPTIONS`);
    }
};
