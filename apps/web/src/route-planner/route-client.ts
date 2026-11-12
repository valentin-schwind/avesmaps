import {
    AVENTURIA_TRAVEL_MODEL,
    besuchOrtsName,
    groundRequirement,
    routenPaar,
    SEARCH_MIN_LENGTH,
    shipWaters,
    WATER_KINDS,
    type RouteError,
    type RouteResponse,
    type WaypointHit,
    type WaypointNearestResponse,
    type WaypointResponse,
} from "@avesmaps3d/shared";
import { DOMAINS, transportShortLabel, type PlannerOptions } from "./planner-model";
import { airQuery, type AirChoice } from "./air-profiles";
import { LOAD_ATTEMPTS, pause, retryAfterMs } from "./load-retry";
import { t } from "../i18n/i18n";
import { melde, meldeEinmal } from "../besuch/besuch-melden";
import { pausiertSatz } from "../system/inhaltsstand-text";
import { wegfindungImBrowserWerte } from "../map/start-view";

/**
 * Die Anfragen des Routenplaners (WI-0017, Schritt 2): Route, Wegpunktvorschläge, Namen aus einem Link.
 *
 * ⭐ Eine Meldung ist ein deutscher Satz, kein Servertext. Legacy zeigte Englisch aus dem Server und
 * rohe Browsertexte („Failed to fetch") im Toast (MCS-020, D3) - hier übersetzt diese Datei jeden
 * Fehler in einen Satz, der sagt, was los ist.
 */

export type RouteOutcome = { ok: true; route: RouteResponse } | { ok: false; message: string };

/** Die Adresse der Anfrage - die Kennungen der Orte und jede Option, auch die Vorgaben. */
export function routeQuery(placeIds: readonly string[], options: PlannerOptions, air: AirChoice | null = null): string {
    const params = new URLSearchParams({
        waypoints: placeIds.join(","),
        optimize: options.optimize,
        domains: DOMAINS.filter((domain) => options.enabled[domain]).join(","),
        land: options.transports.land,
        river: options.transports.river,
        sea: options.transports.sea,
        minimize_transfers: String(options.minimizeTransfers),
        hurry: String(options.hurry),
        hours_per_day: String(options.hoursPerDay),
    });
    if (options.departure) {
        params.set("start_month", options.departure.month);
        params.set("start_day", String(options.departure.day));
    }
    // Im Flug (WI-0051) zählen Flugmittel, Reisestunden und Reisebeginn; der Rest reist mit und ruht.
    if (air) for (const [key, value] of Object.entries(airQuery(air))) params.set(key, value);
    return params.toString();
}

/**
 * Absagen wegen Last: Die Schlange ist voll (`routing_busy`), oder die Antwort kam nicht binnen der 2 s des
 * Servers (`routing_timeout`). 🪤 Die 2 s schließen das Warten in der Schlange ein (runner.ts). Im
 * parallelen Volllauf traf es eine Route mit zwei Wegpunkten, und der Rat „weniger Wegpunkte“ war falsch.
 */
type LoadError = "routing_busy" | "routing_timeout";

function isLoadError(code: RouteError["error"]): code is LoadError {
    return code === "routing_busy" || code === "routing_timeout";
}

/**
 * Jeder Fehlercode hat seinen Satz; die Absagen eines Kartenpunkts sind Legacys (route-travel-here.js). Die Grenze der
 * Kartenpunkte steht im Satz als Zahl der Systemsteuerung (WI-0214), nicht als feste 10.
 */
function errorMessage(code: Exclude<RouteError["error"], LoadError>): string {
    return t(`route.error.${code}`, { n: wegfindungImBrowserWerte().routeMapPointLimit });
}

/**
 * Keine Route: welche Etappe scheiterte, mit Namen (Legacy nannte nur die Enden der Anfrage). Die
 * Namen des Planers gehen vor - ein Kartenpunkt heißt dort nach seiner Gegend.
 */
export function noRouteMessage(
    route: RouteResponse,
    names: readonly string[] = route.waypoints.map((waypoint) => waypoint.name),
    options: PlannerOptions | null = null,
): string {
    const leg = route.failed_leg_index ?? 0;
    const from = names[leg];
    const to = names[leg + 1];
    const message = from && to ? t("route.noRouteBetween", { from, to }) : t("route.noRoute");
    return [message, ...(options ? restrictionHints(options) : [])].join(" ");
}

/**
 * Warum ein gewähltes Mittel womöglich keinen Weg fand (WI-0069): der Schlitten nur mit Reisebeginn auf Schnee
 * oder Eis (`bodenPflicht`), das Ruderboot nur auf Binnenseen (`gewaesser`). Aus dem Reisemodell, ohne Kennung.
 */
export function restrictionHints(options: PlannerOptions): string[] {
    const model = AVENTURIA_TRAVEL_MODEL;
    const hints: string[] = [];
    const land = options.transports.land;
    if (options.enabled.land && groundRequirement(model, land)) {
        hints.push(t("route.noRoute.ground", { transport: transportShortLabel(land) }));
    }
    const sea = options.transports.sea;
    if (options.enabled.sea && shipWaters(model, sea).length < WATER_KINDS.length) {
        hints.push(t("route.noRoute.waters", { transport: transportShortLabel(sea) }));
    }
    return hints;
}

/** Die Route; eine Absage wegen Last fragt sie selbst noch einmal (`load-retry.ts`), erst danach steht der Satz da. */
export async function fetchRoute(
    placeIds: readonly string[],
    options: PlannerOptions,
    signal?: AbortSignal,
    air: AirChoice | null = null,
): Promise<RouteOutcome> {
    const url = `/api/route?${routeQuery(placeIds, options, air)}`;
    // Was der Reiseplaner wirklich benutzt (WI-0138): die Vorgabe und je Medium das Mittel - feste Werte aus unseren
    // eigenen Listen, nie ein Name und nie eine Kennung. Der Fehlschlag zählt mit: er zeigt, wo das Wegenetz Lücken hat.
    melde("route_option", options.optimize === "shortest" ? "kuerzeste" : "schnellste");
    for (const [medium, mittel] of Object.entries(options.transports)) {
        if (options.enabled[medium as keyof typeof options.enabled]) melde("transport", mittel);
    }
    // Die Reiseart „Flug“ (WI-0159): `air` steht genau dann, wenn der Planer mit einem Flugmittel rechnet
    // (`use-planner.ts`, `mode === "air"`) - die Flugmittel stehen nicht in `transports`, Land, Fluss und Meer schon.
    // Einmal je Besuch, wie die Neigung daneben: Die Frage ist „lohnt die dritte Dimension“, nicht „wie oft gerechnet“.
    if (air !== null) meldeEinmal("flight");
    for (let attempt = 1; ; attempt += 1) {
        let response: Response;
        try {
            response = await fetch(url, signal ? { signal } : {});
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            return { ok: false, message: t("route.error.offline") };
        }
        if (response.ok) {
            const route = (await response.json()) as RouteResponse;
            // Die geplante Route als „Start → Ziel“ (BESUCH-0001 §E): die Namen aus UNSERER Antwort, nie aus dem
            // Eingabefeld. Lässt sich kein Paar bilden, geht die Meldung ohne Ausprägung weg - die Kennzahl zählt sie
            // weiter, nur die Liste bleibt dann ohne diesen Eintrag (WI-0157).
            melde("route", routenPaar(route.waypoints.map((wegpunkt) => wegpunkt.name)));
            // Die angesteuerten Orte (BESUCH-0001 §E: „Angesteuerte Orte · dieselbe Quelle“, WI-0159): JEDER Wegpunkt, nicht
            // nur Start und Ziel - Legacy zählte genauso (`route_waypoint`: Gareth 3.617, Punin 1.774). Ein Wegpunkt kann ein
            // Kartenpunkt ohne Ortsnamen sein; der fällt bei `besuchOrtsName` sichtbar weg, statt still am Riegel.
            for (const wegpunkt of route.waypoints) {
                const ort = besuchOrtsName(wegpunkt.name);
                if (ort !== undefined) melde("route_waypoint", ort);
            }
            return { ok: true, route };
        }
        // Die Drossel vor der Anwendung (WI-0292): Nginx sagt 429 `rate_limited` (`location @zu_viel`). Ein eigener Satz und eine eigene Kennung statt „konnte nicht
        // berechnet werden“ und „unbekannt“; kein zweiter Versuch, die Zone gibt erst nach Sekunden wieder eine Frage frei.
        if (response.status === 429) {
            melde("route_fail", "gedrosselt");
            return { ok: false, message: t("route.error.rate_limited") };
        }
        const body = (await response.json().catch(() => ({}))) as Partial<RouteError> | { error?: { code?: string } };
        // Die Reiseberechnung ist pausiert (WI-0127 SYS-11): der Umschlag der Systemsteuerung, kein Fehler des Routers, kein zweiter Versuch.
        if (typeof body.error === "object" && body.error.code === "feature_paused") {
            return { ok: false, message: pausiertSatz("route.compute") ?? t("route.error.routing_failed") };
        }
        if (typeof body.error !== "string") {
            melde("route_fail", "unbekannt");
            return { ok: false, message: t("route.error.routing_failed") };
        }
        if (!isLoadError(body.error)) {
            // Der Grund als Kennung, nie die Wegpunkte: Was schiefging, sagt der Code des Routers (WI-0138 V11).
            melde("route_fail", body.error);
            return { ok: false, message: errorMessage(body.error) };
        }
        if (attempt >= LOAD_ATTEMPTS) {
            melde("route_fail", "ueberlastet");
            return { ok: false, message: t("route.error.overloaded") };
        }
        await pause(retryAfterMs(response), signal);
    }
}

/** Vorschläge für ein Wegpunktfeld; unter zwei Zeichen wird gar nicht gefragt. */
export async function fetchWaypointHits(query: string, signal?: AbortSignal): Promise<WaypointResponse> {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) return { query: trimmed, hits: [], truncated: false };
    const response = await fetch(`/api/route/waypoints?q=${encodeURIComponent(trimmed)}`, signal ? { signal } : {});
    if (!response.ok) throw new Error(`Wegpunktsuche antwortete ${String(response.status)}`);
    return (await response.json()) as WaypointResponse;
}

/** Die Orte hinter den Namen eines Links; `null`, wo keiner eindeutig passt. */
export async function resolveWaypointNames(names: readonly string[]): Promise<(WaypointHit | null)[]> {
    if (names.length === 0) return [];
    const response = await fetch(`/api/route/waypoints/resolve?names=${names.map(encodeURIComponent).join("~")}`);
    if (!response.ok) throw new Error(`Namensauflösung antwortete ${String(response.status)}`);
    return ((await response.json()) as { places: (WaypointHit | null)[] }).places;
}

/** Der nächste sichtbare Ort zu einem Kartenpunkt - für „Nächsten Ort finden“ und „Kartenpunkt bei …“. */
export async function fetchNearestPlace(
    point: { x: number; y: number },
    signal?: AbortSignal,
): Promise<WaypointNearestResponse> {
    const params = new URLSearchParams({ x: String(point.x), y: String(point.y) });
    const response = await fetch(`/api/route/waypoints/nearest?${params.toString()}`, { signal: signal ?? null });
    if (!response.ok) throw new Error(`Nächster Ort: HTTP ${String(response.status)}`);
    return (await response.json()) as WaypointNearestResponse;
}
