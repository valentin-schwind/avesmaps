import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AVENTURIA_TRAVEL_MODEL,
    MAP_POINT_REFUSALS,
    ROUTE_DEFAULTS,
    departureDays,
    isDepartureMonth,
    parseLandmarkWaypointId,
    parseMapPointId,
    resolveAirQuery,
    RouteError,
    RouteQuerystring,
    RouteResponse,
    WaypointHit,
    WaypointNearestResponse,
    WaypointResponse,
    type MapPointRefusal,
    type RouteStage,
    FastifyErrorBody,
    wegfindungWert,
    type Wegfindungswerte,
} from "@avesmaps3d/shared";
import type { RouteLandmark } from "../routing/landmark-waypoints.ts";
import type { WaypointIndex } from "../routing/waypoints.ts";
import { addStageTerritories } from "../subjects/stage-territories.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";

/**
 * 🪤 Eine unlesbare Adresse beantwortet Fastify selbst, in SEINER Form. Stünde für 400 nur
 * `RouteError` im Schema, scheiterte die Serialisierung dieser Antwort, und aus dem 400 würde ein 500.
 */
const ValidationError = FastifyErrorBody;

/** Die größte Zahl Vorschläge, die die Systemsteuerung erlauben kann (Register, `waypointLookupLimit`). */
const LOOKUP_MAX = wegfindungWert("waypointLookupLimit")?.max ?? 100;

/** Eine Absage für einen Kartenpunkt (`MAP_POINT_REFUSALS`). */
const isRefusal = (error: string): error is MapPointRefusal =>
    (MAP_POINT_REFUSALS as readonly string[]).includes(error);

/**
 * Das Herrschaftsgebiet an den Wegpunkten (WI-0087 P3, `subjects/stage-territories.ts`): EIN Statement je Reise, und
 * nur hier, weil nur dieser Prozess Datenbank und Gebietsbaum zusammen hat - der Routing-Worker kennt den Baum nicht.
 *
 * 🪤 **Ein Fehlschlag ist ein Befund, kein Tor:** Die Reise ist gerechnet, sie wird beantwortet. Fehlt das Gebiet,
 * nennt die zweite Zeile der Station nur die Ortsklasse.
 */
async function stageTerritories(
    app: Parameters<FastifyPluginAsyncTypebox>[0],
    stages: readonly RouteStage[],
): Promise<RouteStage[]> {
    const database = app.database;
    const subjects = app.subjects;
    if (!database || !subjects || stages.length === 0) return [...stages];
    try {
        return await addStageTerritories(database, await subjects.index(), stages);
    } catch (error) {
        app.log.warn({ err: error }, "BEFUND Wegpunktgebiete nicht ermittelt; die Reise antwortet ohne sie");
        return [...stages];
    }
}

/**
 * Die Landmarken unter den Wegpunkten (WI-0271 L6), aufgelöst über den Wegpunktindex: dieselbe Liste, aus der die Wegpunktsuche
 * vorschlägt, also nur aktive Landmarken, deren Art Reiseziel sein darf. Was sie nicht kennt, fehlt hier; der Rechendienst antwortet
 * dann `unknown_waypoint` mit dieser Kennung.
 */
async function routeLandmarks(index: WaypointIndex, ids: readonly string[]): Promise<RouteLandmark[]> {
    const hits = await index.byIds([...new Set(ids)]);
    return hits.flatMap((hit): RouteLandmark[] =>
        hit?.landmark === undefined ? [] : [{ id: hit.id, name: hit.name, subtype: hit.landmark, x: hit.x, y: hit.y }],
    );
}

/**
 * Der Routenendpunkt (WI-0017 R6): `GET /api/route?waypoints=<id>,<id>[,…]`; ein Wegpunkt darf ein
 * Kartenpunkt sein (`p:<x>:<y>`, WI-0030) oder eine Landmarke (`l:<uuid>`, WI-0271 L6).
 *
 * 🔴 ER LIEST NUR. Die Rechnung selbst macht der Routing-Worker (`routing/runner.ts`); hier wird
 * nur die Anfrage geprüft, mit Legacys Vorgaben ergänzt und die Antwort übersetzt.
 */
export const routeRoutes: FastifyPluginAsyncTypebox = async (app) => {
    /**
     * Die Grenzen der Systemsteuerung über die Lesestelle des Hauptthreads (WI-0214). 🔴 Ohne Auffangen: Lassen sie sich nie
     * lesen, geht der Fehler an den Fehlerhandler des Hauses, und der antwortet 503 `database_unavailable` mit Retry-After —
     * geschlossen, nicht mit den lockereren Vorgaben (Sicherheitsprüfung 2026-10-17). Wurden sie einmal gelesen, trägt der
     * letzte Stand über einen Ausfall (`wegfindungswerte`).
     */
    const grenzen = (): Promise<Wegfindungswerte> => wegfindungswerte(app.database);
    app.get(
        "/api/route",
        {
            schema: {
                querystring: RouteQuerystring,
                response: {
                    200: RouteResponse,
                    400: Type.Union([RouteError, ValidationError]),
                    422: RouteError,
                    503: RouteError,
                },
            },
        },
        async (request, reply) => {
            if (!app.routeRunner) return reply.code(503).send({ error: "database_unavailable" });
            const query = request.query;
            // Kennungen stehen in der Datenbank klein geschrieben.
            const waypoints = query.waypoints.toLowerCase().split(",");
            // Die Grenzen der Systemsteuerung (WI-0214): über die Lesestelle des Hauptthreads, nicht `werte()` — das ist
            // der Zustand des Routing-Workers und stand hier immer auf den Vorgaben.
            const grenze = await grenzen();
            // Das Schema deckelt bei `ROUTE_WAYPOINT_LIMIT` (100); eine kleinere Grenze der Systemsteuerung gilt hier, in
            // DERSELBEN Form wie Fastifys Prüfung der Adresse, damit der Planer nur eine Absage kennt.
            if (waypoints.length > grenze.routeWaypointLimit) {
                return reply.code(400).send({
                    statusCode: 400,
                    code: "FST_ERR_VALIDATION",
                    error: "Bad Request",
                    message: `querystring/waypoints höchstens ${String(grenze.routeWaypointLimit)} Wegpunkte`,
                });
            }
            // Das Komplexitätsbudget (S-04): Jeder Kartenpunkt kostet eine Rastersuche querfeldein - eine Landmarke ebenso, sie
            // fährt als Kartenpunkt an ihrer Lage (WI-0271 L6).
            const landmarkIds = waypoints.filter((id) => parseLandmarkWaypointId(id) !== null);
            const mapPoints = waypoints.filter((id) => parseMapPointId(id) !== null).length + landmarkIds.length;
            if (mapPoints > grenze.routeMapPointLimit) {
                return reply.code(400).send({ error: "too_many_map_points", detail: String(mapPoints) });
            }
            // Der Flug (WI-0051): Was das Schema nicht ausdrücken kann (Pflicht bei `custom`, verboten beim
            // Profil, Nachkommastellen), sagt dieselbe Form wie Fastifys Prüfung der Adresse.
            const air = resolveAirQuery(AVENTURIA_TRAVEL_MODEL, query);
            if (!air.ok) {
                return reply.code(400).send({
                    statusCode: 400,
                    code: "FST_ERR_VALIDATION",
                    error: "Bad Request",
                    message: `querystring/${air.parameter} ${air.message}`,
                });
            }
            // Die Namenlosen Tage haben nur fünf Tage; das Schema kennt je Feld nur eine Grenze und lässt bis 30 zu.
            if (query.start_month !== undefined && isDepartureMonth(query.start_month)) {
                const last = departureDays(query.start_month);
                if ((query.start_day ?? 1) > last) {
                    return reply.code(400).send({
                        statusCode: 400,
                        code: "FST_ERR_VALIDATION",
                        error: "Bad Request",
                        message: `querystring/start_day höchstens ${String(last)} in ${query.start_month}`,
                    });
                }
            }
            // Nur mit Landmarke: Eine Ortsroute fragt den Index nicht, und ihre Anfrage an den Worker bleibt, wie sie war.
            let landmarks: RouteLandmark[] | undefined;
            if (landmarkIds.length > 0) {
                if (!app.waypointIndex) return reply.code(503).send({ error: "database_unavailable" });
                landmarks = await routeLandmarks(app.waypointIndex, landmarkIds);
            }
            const domains = new Set((query.domains ?? ROUTE_DEFAULTS.domains).split(","));
            // Die Drossel je Client (S-04) zählt offene Rechnungen nach `request.ip` (trustProxy: loopback).
            const outcome = await app.routeRunner.run({
                client: request.ip,
                waypoints,
                ...(landmarks ? { landmarks } : {}),
                optimize: query.optimize ?? ROUTE_DEFAULTS.optimize,
                transports: {
                    land: query.land ?? ROUTE_DEFAULTS.land,
                    river: query.river ?? ROUTE_DEFAULTS.river,
                    sea: query.sea ?? ROUTE_DEFAULTS.sea,
                },
                enabled: { land: domains.has("land"), river: domains.has("river"), sea: domains.has("sea") },
                minimizeTransfers: query.minimize_transfers ?? ROUTE_DEFAULTS.minimize_transfers,
                hurry: query.hurry ?? ROUTE_DEFAULTS.hurry,
                hoursPerDay: query.hours_per_day ?? ROUTE_DEFAULTS.hours_per_day,
                // Der Tag gilt nur mit Monat (Legacy `startDay` nur zusammen mit `startMonth`).
                ...(query.start_month !== undefined && isDepartureMonth(query.start_month)
                    ? { departure: { month: query.start_month, day: query.start_day ?? 1 } }
                    : {}),
                ...(air.air ? { air: air.air } : {}),
            });
            if (outcome.ok) {
                return { ...outcome.response, stages: await stageTerritories(app, outcome.response.stages) };
            }
            if (outcome.error === "unknown_waypoint") {
                return reply.code(400).send({ error: "unknown_waypoint", detail: outcome.detail });
            }
            // Die Anfrage ist lesbar, aber der Kartenpunkt ist nicht zu erreichen (Legacy: 422), oder die
            // Reise ist größer als eine Antwort sein darf (S-10).
            if (isRefusal(outcome.error) || outcome.error === "route_too_large") {
                const detail = outcome.detail;
                return reply.code(422).send({ error: outcome.error, ...(detail === undefined ? {} : { detail }) });
            }
            // 🪤 503 und nicht 500: Die Route ist nicht kaputt, sie ist gerade nicht bedienbar.
            reply.header("Retry-After", "2");
            return reply.code(503).send({ error: outcome.error });
        },
    );

    /**
     * Die Vorschläge für ein Wegpunktfeld (`routing/waypoints.ts`): Orte und Landmarken, auch versteckte.
     * 🔴 Sie liest nur. Die Eingabe ist auf 100 Zeichen begrenzt, wie bei der Suche.
     */
    app.get(
        "/api/route/waypoints",
        {
            schema: {
                querystring: Type.Object({
                    q: Type.String({ maxLength: 100 }),
                    // 🪤 Ein Schema entsteht einmal beim Anmelden der Route, nicht je Anfrage: Es nimmt alles an, was die
                    // Systemsteuerung erlauben KANN; den eingestellten Wert legt der Handler darüber (WI-0214).
                    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LOOKUP_MAX })),
                }),
                response: { 200: WaypointResponse, 503: RouteError },
            },
        },
        async (request, reply) => {
            if (!app.waypointIndex) return reply.code(503).send({ error: "database_unavailable" });
            // Die Zahl der Systemsteuerung ist die Obergrenze, auch für ein mitgeschicktes `limit`.
            const grenze = await grenzen();
            const hoechstens = grenze.waypointLookupLimit;
            const limit = Math.min(request.query.limit ?? hoechstens, hoechstens);
            return app.waypointIndex.lookup(request.query.q, limit);
        },
    );

    /**
     * Die Orte hinter den Namen eines Links (`?route=Gareth~Perricum`, Legacys `?route=Gareth&route=…`),
     * in Reihenfolge; `null`, wo kein Ort eindeutig passt. Die Namen kommen mit `~` getrennt, wie in
     * der Adresse, höchstens so viele wie eine Route Wegpunkte hat.
     */
    app.get(
        "/api/route/waypoints/resolve",
        {
            schema: {
                querystring: Type.Object({ names: Type.String({ minLength: 1, maxLength: 8000 }) }),
                response: {
                    200: Type.Object({ places: Type.Array(Type.Union([WaypointHit, Type.Null()])) }),
                    // 🪤 Auch Fastifys eigene 400 (fehlendes `names`, zu lang): Stünde hier nur `RouteError`, wäre sie ein 500.
                    400: Type.Union([RouteError, ValidationError]),
                    503: RouteError,
                },
            },
        },
        async (request, reply) => {
            if (!app.waypointIndex) return reply.code(503).send({ error: "database_unavailable" });
            const names = request.query.names.split("~");
            const grenze = await grenzen();
            if (names.length > grenze.routeWaypointLimit) {
                return reply.code(400).send({ error: "unknown_waypoint", detail: "zu viele Namen" });
            }
            return { places: await app.waypointIndex.resolve(names) };
        },
    );

    /** Der nächste sichtbare Ort zu einem Kartenpunkt (Kontextmenü, Beschriftung eines Kartenpunkts). */
    app.get(
        "/api/route/waypoints/nearest",
        {
            schema: {
                querystring: Type.Object({
                    x: Type.Number({ minimum: -10_000, maximum: 10_000 }),
                    y: Type.Number({ minimum: -10_000, maximum: 10_000 }),
                }),
                response: { 200: WaypointNearestResponse, 503: RouteError },
            },
        },
        async (request, reply) => {
            if (!app.waypointIndex) return reply.code(503).send({ error: "database_unavailable" });
            return app.waypointIndex.nearest(request.query.x, request.query.y);
        },
    );
};
