import type { RouteClosure, RouteResponse, RouteSeasonalWay } from "@avesmaps3d/shared";
import { formatDate, formatNumber, pathLabel, type PlannerOptions } from "./planner-model";
import { t, tPlural } from "../i18n/i18n";

/**
 * Die Sperrhinweise des Reiseplans (WI-0038; Legacy `route-closures.js`, Entwurf 2026-09-14, Owner:
 * „go, C und Absage im Panel“). Variante C: Oben steht, DASS die Route wegen einer Sperrung anders
 * läuft und um wie viel länger; am Abzweig, WELCHER Weg gesperrt ist und WARUM. Ohne Reisebeginn sperrt
 * nichts, aber der Plan bittet, den Reisebeginn zu prüfen (Owner 14.09.2026).
 *
 * Keine Vue, kein DOM: Die Sätze entstehen hier, die Übersicht setzt sie als Text.
 */

type Way = Pick<RouteSeasonalWay, "path_name" | "subtype" | "from_node" | "public_ids">;
type Avoided = RouteClosure["avoided"][number];

/** Unter dieser Verlängerung sagt der Kopfhinweis keine Zahl (Legacy `ROUTE_CLOSURE_MIN_EXTRA`). */
const MIN_EXTRA = 0.05;

/**
 * Womit der Vermerk beginnt: der Grund der Sperre, wo er bekannt ist („Wegen Vereisung unpassierbar:“,
 * Betreiber 2026-09-27), sonst „Gesperrt:“.
 */
export function closureLead(way: Pick<RouteSeasonalWay, "reason">): string {
    return way.reason ? t(`planner.closure.reason.${way.reason}`) : t("planner.closure.blocked");
}

/** Wie ein gesperrter Weg heißt: sein Name, sonst „Pfad ab Greifenfurt“, sonst die Wegart - nie eine Kreuzung. */
export function closureWayName(way: Way): string {
    const name = way.path_name.trim();
    if (name !== "") return name;
    const type = pathLabel(way.subtype);
    const from = way.from_node.trim();
    return from === "" ? type : t("planner.closure.wayFrom", { type, place: from });
}

const windowText = (way: Pick<RouteSeasonalWay, "open_from" | "open_to">): { from: string; to: string } => ({
    from: formatDate({ ...way.open_from, nameless: false }),
    to: formatDate({ ...way.open_to, nameless: false }),
});

/** „am 3. Firun, befahrbar vom 15. Peraine bis zum 30. Efferd“. */
export function closureReason(avoided: Avoided): string {
    return t("planner.closure.season", { date: formatDate(avoided.reached_on), ...windowText(avoided) });
}

/**
 * Unbenannte Wege derselben Art mit demselben Fenster sind für den Leser EIN Weg („Seeweg ab Riva“
 * und „Seeweg“ wären zwei Zeilen für dieselbe Aussage); der erste, meist mit Ort, bleibt stehen.
 */
type Distinct = Pick<RouteSeasonalWay, "path_name" | "subtype" | "transport" | "open_from" | "open_to">;
function distinct<T extends Distinct>(ways: readonly T[]): T[] {
    const seen = new Set<string>();
    return ways.filter((way) => {
        const window = `${way.open_from.month}.${String(way.open_from.day)}-${way.open_to.month}.${String(way.open_to.day)}`;
        const key =
            way.path_name.trim() === ""
                ? `~${way.subtype}|${way.transport}|${window}`
                : `${way.path_name}|${way.transport}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Der Kopfhinweis: „Wegen einer Sperrung anders geführt · 1,4 Tage länger“ - bei „Kürzeste“ in Meilen.
 * Null ohne Umleitung. Der Weg steht bewusst nicht hier, sondern am Abzweig.
 *
 * 🔴 Berichte mit `avoided_anyway` zählen hier NICHT mit (WI-0082): Dort ist die Route nicht wegen der Sperrung
 * länger, also wäre jede Zeitangabe falsch. Sie haben ihren eigenen Wortlaut (`closureAnywayHead`).
 */
export function closureHead(route: RouteResponse, optimize: PlannerOptions["optimize"]): string | null {
    const reports = (route.closures ?? []).filter((report) => !report.blocked && !report.avoided_anyway);
    // Derselbe Weg in zwei Etappen zwischen Wegpunkten ist EINE Sperre.
    const count = distinct(reports.flatMap((report) => report.avoided)).length;
    if (count === 0) return null;
    const sentence = tPlural("planner.closure.head", count, { n: count });
    let extra = 0;
    for (const report of reports) {
        if (!report.actual) continue;
        extra +=
            optimize === "shortest"
                ? (report.actual.distance_units - report.unrestricted.distance_units) * route.miles_per_unit
                : (report.actual.total_hours - report.unrestricted.total_hours) / 24;
    }
    if (!(extra > MIN_EXTRA)) return sentence;
    const longer = t(optimize === "shortest" ? "planner.closure.longerMiles" : "planner.closure.longerDays", {
        n: formatNumber(extra, 1),
    });
    return `${sentence} · ${longer}`;
}

/**
 * Der zweite Wortlaut (WI-0082, Betreiber 2026-10-05 „JA!“): Der Weg ist gesperrt, aber die Route meidet ihn
 * ohnehin - sie ist also NICHT wegen der Sperrung länger. 🔴 Deshalb **ohne jede Zeitangabe**: Der heutige Satz
 * „… und x Tage länger“ wäre hier eine falsche Auskunft. Unpersönlich und ohne Anrede (Guide §24).
 *
 * Welcher Weg und wann er zu ist, steht wie im ersten Fall am Abzweig (`closureNotes`), nicht hier.
 */
export function closureAnywayHead(route: RouteResponse): string | null {
    const reports = (route.closures ?? []).filter((report) => !report.blocked && report.avoided_anyway === true);
    const count = distinct(reports.flatMap((report) => report.avoided)).length;
    if (count === 0) return null;
    return tPlural("planner.closure.anyway", count, { n: count });
}

/**
 * Welche Etappe trägt welchen Vermerk? Gesucht wird die Abzweigkante im Ausschnitt ihres
 * Wegpunktpaares, dann die Etappe, die sie enthält - nie ein geratener Ort. Wird nichts gefunden,
 * bleibt der Hinweis oben allein (Legacy `routeClosureEntryNotes`).
 */
export function closureNotes(route: RouteResponse): Map<number, Avoided[]> {
    const notes = new Map<number, Avoided[]>();
    for (const report of route.closures ?? []) {
        if (report.blocked || report.diverges_at_edge_id === "") continue;
        const leg = route.legs[report.leg_index];
        if (!leg) continue;
        let segment = -1;
        for (let index = leg.segment_start; index < leg.segment_start + leg.segment_count; index += 1) {
            if (route.segments[index]?.edge_id === report.diverges_at_edge_id) {
                segment = index;
                break;
            }
        }
        const stage = route.stages.find(
            (entry) => segment >= entry.segment_start && segment < entry.segment_start + entry.segment_count,
        );
        if (!stage) continue;
        notes.set(stage.index, distinct([...(notes.get(stage.index) ?? []), ...report.avoided]));
    }
    return notes;
}

/** Ohne Reisebeginn: die Wege der Route mit Sperrzeit, jeder einmal, und ihr Fenster. */
export function seasonalWayNotes(route: RouteResponse): { name: string; window: string }[] {
    return distinct(route.seasonal_ways ?? []).map((way) => ({
        name: closureWayName(way),
        window: t("planner.closure.window", windowText(way)),
    }));
}

/**
 * Die Absage im Panel, wenn es nur gesperrte Wege gibt: „Keine offene Route von A nach B“ und die
 * Gründe. Null, wenn die Route aus einem anderen Grund fehlt.
 */
export function closureRefusal(
    route: RouteResponse,
    names: readonly string[],
): { title: string; avoided: Avoided[] } | null {
    if (route.found || route.reason !== "season_closed") return null;
    const blocked = (route.closures ?? []).filter((report) => report.blocked);
    if (blocked.length === 0) return null;
    const leg = route.failed_leg_index ?? blocked[0]?.leg_index ?? 0;
    return {
        title: t("planner.closure.refusal", { start: names[leg] ?? "", end: names[leg + 1] ?? "" }),
        avoided: distinct(blocked.flatMap((report) => report.avoided)),
    };
}
