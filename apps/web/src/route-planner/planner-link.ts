import { isDepartureMonth, isLodgingLevel, parseLandmarkWaypointId } from "@avesmaps3d/shared";
import { wegfindungImBrowserWerte } from "../map/start-view";
import {
    clampHoursPerDay,
    clampStartDay,
    copyOptions,
    DEFAULT_OPTIONS,
    DOMAINS,
    TRANSPORTS,
    type PlannerOptions,
} from "./planner-model";
import { AIR_LINK_PARAMS, readAirLink, writeAirLink, type AirChoice } from "./air-profiles";

/**
 * Die Reise in der Adresse (WI-0017, F1; AGENTS.md „Links von Legacy bleiben gültig").
 *
 * 🔴 **Legacys Namen, eine kürzere Schreibweise.** Die Wegpunkte stehen in `route`, wie in Legacy,
 * aber als EIN Wert mit `~` dazwischen: `?route=Gareth~Perricum` (Betreiber 2026-09-23: „mach
 * ?route="). Legacys wiederholtes `?route=Gareth&route=Perricum` und seine Aliasse `routes`,
 * `router` werden weiter gelesen, ebenso jede Option unter Legacys Namen (`pathType`,
 * `minimizeTransfers`, `allowLand`, `landTransport`, `restHours` …; map-features-layer-state.js).
 *
 * Geschrieben werden nur Abweichungen von der Vorgabe, wie in Legacy - ein Link ohne Optionen ist
 * ein Link mit den Vorgaben.
 *
 * Der Flug (WI-0051) steht in `air`: Mit ihm öffnet der Link die Reiseart „Flug“. Legacy kennt keinen
 * Flug; die Namen folgen seiner Schreibweise.
 */

/**
 * Alle Parameter, die dem Planer gehören. Andere (`besucher`, `labeltune`, Wiki-Verweise) bleiben.
 * Dazu gehört der Kurzlink `s` (WI-0034): Sobald der Planer die Reise schreibt, steht sie lesbar da,
 * und ein Neuladen öffnet die Reise von JETZT, nicht noch einmal die geteilte.
 */
export const PLANNER_PARAMS = [
    "s",
    "route",
    "routes",
    "router",
    "pathType",
    "minimizeTransfers",
    // Eiltempo (WI-0078): Legacy kennt es nicht, der Name ist neu und kurz - wie `hurry` in der Route-API.
    "hurry",
    "allowLand",
    "allowRiver",
    "allowSea",
    "landTransport",
    "riverTransport",
    "seaTransport",
    "restHours",
    "includeRests",
    "startMonth",
    "startDay",
    "lodging",
    ...AIR_LINK_PARAMS,
] as const;

const ALLOW_PARAM = { land: "allowLand", river: "allowRiver", sea: "allowSea" } as const;
const TRANSPORT_PARAM = { land: "landTransport", river: "riverTransport", sea: "seaTransport" } as const;
const NAME_SEPARATOR = "~";

/**
 * Ein Kartenpunkt in der Adresse: `@551.63,532.97` (x, y), kurz und ohne Kodierung - `@` und `,`
 * sind in einer Query erlaubt. Gelesen wird auch Legacys Form „Kartenpunkt (532.969, 551.625)“,
 * dort in Leaflets Reihenfolge (y, x) (Legacy `mapPointWaypointLabel`).
 */
const POINT_TOKEN = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const LEGACY_POINT = /\(\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*\)\s*$/;

export function parsePointToken(token: string): { x: number; y: number } | null {
    const own = POINT_TOKEN.exec(token.trim());
    if (own) return { x: Number(own[1]), y: Number(own[2]) };
    const legacy = LEGACY_POINT.exec(token.trim());
    if (!legacy) return null;
    const y = Number(String(legacy[1]).replace(",", "."));
    const x = Number(String(legacy[2]).replace(",", "."));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function pointToken(point: { x: number; y: number }): string {
    return `@${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

export interface PlannerLink {
    /** Die Ortsnamen in Reihenfolge; höchstens so viele, wie eine Route Wegpunkte hat. */
    names: string[];
    options: PlannerOptions;
    /** Der Flug, wenn der Link ihn trägt; sonst reist die Route über Land und Wasser. */
    air: AirChoice | null;
}

const truthy = (value: string): boolean => value === "1" || value.toLowerCase() === "true";
const falsy = (value: string): boolean => value === "0" || value.toLowerCase() === "false";

/**
 * Trägt die Adresse irgendeine Angabe des Planers (Reise, Option, Flug)? Nur dann wird sie gegen die feste Vorgabe gelesen;
 * ohne Angabe beginnt der Planer mit der Voreinstellung der Systemsteuerung (`planner-presets.ts`, WI-0166). Der Kurzlink `s`
 * zählt hier nicht: Er hat seinen eigenen Weg (`restoreShared`).
 */
export function tragtPlanerangaben(search: string): boolean {
    const params = new URLSearchParams(search);
    return PLANNER_PARAMS.some((name) => name !== "s" && params.has(name));
}

/** Liest die Reise aus einer Adresse (`location.search`). Unbekannte Werte bleiben auf der Vorgabe. */
export function readPlannerLink(search: string): PlannerLink {
    const params = new URLSearchParams(search);
    const names = ["route", "routes", "router"]
        .flatMap((key) => params.getAll(key))
        .flatMap((value) => value.split(NAME_SEPARATOR))
        .map((name) => name.trim())
        .filter((name) => name !== "")
        // Die eingestellte Grenze der Wegpunkte (WI-0214): Mehr nähme der Server nicht an.
        .slice(0, wegfindungImBrowserWerte().routeWaypointLimit);

    const options = copyOptions(DEFAULT_OPTIONS);
    if (params.get("pathType") === "shortest") options.optimize = "shortest";
    const minimize = params.get("minimizeTransfers");
    if (minimize !== null && truthy(minimize)) options.minimizeTransfers = true;
    // Eiltempo (WI-0078): fehlt der Parameter, ist es aus - ein Link von vor WI-0078 reist unverändert.
    const hurry = params.get("hurry");
    if (hurry !== null && truthy(hurry)) options.hurry = true;
    for (const domain of DOMAINS) {
        const allow = params.get(ALLOW_PARAM[domain]);
        if (allow !== null && falsy(allow)) options.enabled[domain] = false;
        const transport = params.get(TRANSPORT_PARAM[domain]);
        if (transport !== null && TRANSPORTS[domain].includes(transport)) options.transports[domain] = transport;
    }
    // Legacy speichert die RAST je Tag, nicht die Reisestunden: restHours = 24 - Reisestunden.
    const restHours = Number(params.get("restHours") ?? Number.NaN);
    if (Number.isFinite(restHours) && restHours >= 0 && restHours <= 23.5) {
        options.hoursPerDay = clampHoursPerDay(24 - restHours);
    }
    const includeRests = params.get("includeRests");
    if (includeRests !== null && falsy(includeRests)) options.hoursPerDay = 24;
    // Legacys Reisebeginn: ein unbekannter Monat fällt still auf „Unbekannt“ zurück, lieber als eine
    // erfundene Jahreszeit; der Tag gilt nur mit Monat (map-features-layer-state.js).
    const startMonth = (params.get("startMonth") ?? "").trim().toLowerCase();
    if (isDepartureMonth(startMonth)) {
        options.departure = {
            month: startMonth,
            day: clampStartDay(Number(params.get("startDay") ?? 1), startMonth),
        };
    }
    // Die Unterbringung reist mit (Legacy Meldung #103); Unbekanntes fällt still auf die Vorgabe.
    const lodging = (params.get("lodging") ?? "").trim();
    if (isLodgingLevel(lodging)) options.lodging = lodging;
    return { names, options, air: readAirLink(params) };
}

/**
 * Die Parameter der Reise, ohne `?`. Leer, wenn es nichts zu sagen gibt.
 *
 * 🪤 `~` bleibt unkodiert - es ist in Adressen erlaubt, und die Namen bleiben so lesbar.
 */
export function writePlannerLink(
    names: readonly string[],
    options: PlannerOptions,
    air: AirChoice | null = null,
): string {
    const parts: string[] = [];
    const written = names.filter((name) => name !== "" && !name.includes(NAME_SEPARATOR));
    // Ein Kartenpunkt bleibt unkodiert lesbar: Er besteht nur aus Ziffern, Punkt, Komma, Minus und `@`. Eine Landmarke ebenso
    // (`l:<uuid>`, WI-0271 L6): Der Server löst die Kennung auf wie einen Namen (`/api/route/waypoints/resolve`).
    const token = (name: string): string =>
        POINT_TOKEN.test(name) || parseLandmarkWaypointId(name) !== null ? name : encodeURIComponent(name);
    if (written.length > 0) parts.push(`route=${written.map(token).join(NAME_SEPARATOR)}`);
    if (options.optimize === "shortest") parts.push("pathType=shortest");
    if (options.minimizeTransfers) parts.push("minimizeTransfers=1");
    if (options.hurry) parts.push("hurry=1");
    for (const domain of DOMAINS) {
        if (!options.enabled[domain]) parts.push(`${ALLOW_PARAM[domain]}=0`);
        if (options.transports[domain] !== DEFAULT_OPTIONS.transports[domain]) {
            parts.push(`${TRANSPORT_PARAM[domain]}=${encodeURIComponent(options.transports[domain])}`);
        }
    }
    if (options.hoursPerDay !== DEFAULT_OPTIONS.hoursPerDay)
        parts.push(`restHours=${String(24 - options.hoursPerDay)}`);
    // Der Tag reist nur mit dem Monat mit - ein einsames `startDay` täuschte eine Wirkung vor (Legacy).
    if (options.departure) {
        parts.push(`startMonth=${options.departure.month}`);
        if (options.departure.day !== 1) parts.push(`startDay=${String(options.departure.day)}`);
    }
    if (options.lodging !== DEFAULT_OPTIONS.lodging) parts.push(`lodging=${options.lodging}`);
    if (air) parts.push(...writeAirLink(air));
    return parts.join("&");
}

/**
 * Setzt die Reise in eine bestehende Adresse ein: die Parameter des Planers werden ersetzt, alle
 * anderen bleiben, wie sie waren - und der Kartenausschnitt im Hash ohnehin.
 */
export function withPlannerLink(search: string, plannerQuery: string): string {
    const params = new URLSearchParams(search);
    for (const key of PLANNER_PARAMS) params.delete(key);
    const rest = params.toString();
    const query = [plannerQuery, rest].filter((part) => part !== "").join("&");
    return query === "" ? "" : `?${query}`;
}
