import type { FastifyInstance } from "fastify";
import { FEATURE_SWITCH, type PausableFeature } from "@avesmaps3d/shared";
import { apiErrorBody } from "../http/api-error.ts";
import { istAus } from "./inhaltsstand.ts";

/**
 * Reiseberechnung und 3D-Gelände pausieren (WI-0127 SYS-11, SYS-0001 §3.4): Die Inhaltsschalter `route.compute` und `map.terrain3d`
 * nehmen die rechnende Route und die Geländekacheln vom Netz, die Karte funktioniert weiter.
 *
 * - `GET /api/route` (die Reiseberechnung; Wegpunkte auflösen und suchen bleiben offen): 503 `feature_paused` mit `Retry-After`.
 * - `/tiles/terrain/dem/current.json`: 503 `feature_paused`; der Client baut dann ohne Gelände (`terrain-pointer.ts`), flach.
 * - Die Kacheln darunter: 404 statt 503. 🪤 Eine offene, geneigte Karte fragt weiter Kacheln nach; ein 5xx zählte die Störungswache
 *   (`map/karte-gestoert.ts`) und zeigte „Die Karte ist gerade gestört.“. Ein 404 meldet MapLibre gar nicht, die Karte wird flach.
 *
 * Entschieden wird an der gefundenen Route (`routeOptions.url`), nie am rohen Pfad; der Stand kommt aus dem Store der Anwendung (keine
 * Datenbankfrage je Kachel). Ohne Store (keine Datenbank) pausiert nichts. Der Haken antwortet selbst, statt zu werfen: Die Routen kennen
 * für 503 nur ihre eigene Form.
 */

interface Pausierbar {
    feature: PausableFeature;
    status: 404 | 503;
    match(method: string, route: string): boolean;
}

const PAUSIERBAR: readonly Pausierbar[] = [
    {
        feature: "route",
        status: 503,
        match: (method, route) => (method === "GET" || method === "HEAD") && route === "/api/route",
    },
    { feature: "terrain3d", status: 503, match: (_method, route) => route === "/tiles/terrain/dem/current.json" },
    { feature: "terrain3d", status: 404, match: (_method, route) => route.startsWith("/tiles/terrain/dem/") },
];

const SATZ: Readonly<Record<PausableFeature, string>> = {
    route: "Die Reiseberechnung ist gerade pausiert. Die Karte funktioniert weiter.",
    terrain3d: "Das 3D-Gelände ist gerade pausiert. Die Karte bleibt flach.",
};

export const FEATURE_PAUSED_RETRY_AFTER_S = 60;

/** Welche Pause trifft diese Route? Die erste passende Zeile gilt (der Zeiger vor den Kacheln). */
export function pauseFor(method: string, route: string | undefined): Pausierbar | undefined {
    if (route === undefined) return undefined;
    return PAUSIERBAR.find((entry) => entry.match(method, route));
}

export function registerFeaturePause(app: FastifyInstance): void {
    app.addHook("onRequest", async (request, reply) => {
        const store = app.inhaltsschalter;
        if (store === undefined) return;
        const pause = pauseFor(request.method, request.routeOptions.url);
        if (pause === undefined) return;
        if (!istAus(await store.read(), FEATURE_SWITCH[pause.feature])) return;
        void reply.code(pause.status).header("cache-control", "no-store");
        if (pause.status === 503) void reply.header("retry-after", String(FEATURE_PAUSED_RETRY_AFTER_S));
        return reply
            .type("application/json; charset=utf-8")
            .send(JSON.stringify(apiErrorBody("feature_paused", SATZ[pause.feature], { feature: pause.feature })));
    });
}
