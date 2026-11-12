import { createHash } from "node:crypto";
import type { RouteResponse } from "@avesmaps3d/shared";
import { ROUTING_REVISION_PARTS, type RoutingDataRevision, type RoutingRevisionPart } from "./revision.ts";
import type { RouteOutcome, RouteQuery } from "./service.ts";

/**
 * Das Routing-Gate über den Korpus (Hardening Review 2026-09-28, Plan 6.52 und 11.51): Jeder Fall des Korpus
 * (`project-control/discovery/corpus/route-corpus-2026-09-23.json`, 40 Routen) und ein paar Ergänzungsfälle
 * (Flug, Saison) laufen gegen den heutigen Router und werden mit einer **Basislinie** verglichen - den
 * Ergebnissen UNSERES Routers auf einem benannten Datenstand.
 *
 * Diese Datei ist der reine Teil, ohne Datenbank: Was von einem Ergebnis festgehalten wird (`GateResult`), wann
 * zwei Ergebnisse gleich sind und wie eine Abweichung heißt (`classify`). Laden und Rechnen steht in
 * `corpus-gate-run.ts`, die Ausgabe in `corpus-gate-cli.ts`.
 *
 * 🔴 **Vier Klassen, und nur eine ist rot:**
 *
 * - `MATCH`: gleiches Ergebnis wie in der Basislinie.
 * - `EXPECTED_CHANGE`: abweichend, aber genau so in der versionierten Liste erwarteter Änderungen eingetragen
 *   (`route-gate-expected-changes.json`, mit Arbeitspaket und Begründung). Das Ergebnis ist mit festgehalten:
 *   Ändert sich der Fall danach noch einmal anders, ist er nicht mehr erwartet.
 * - `DATA_CHANGE`: abweichend, und die Daten, von denen der Fall abhängt, haben sich gegen die Basislinie
 *   geändert (`relevantParts`). Kein Codefehler, sondern der Hinweis, die Basislinie neu aufzunehmen.
 * - `REGRESSION`: abweichend bei gleichen Daten und nicht erwartet. Das ist der einzige rote Fall.
 */

export const GATE_CLASSES = ["MATCH", "EXPECTED_CHANGE", "DATA_CHANGE", "REGRESSION"] as const;
export type GateClass = (typeof GATE_CLASSES)[number];

/** Was vom Ergebnis eines Falls festgehalten wird: Kennzahlen, dazu Fingerabdrücke für Weg und Linie. */
export interface GateResult {
    /**
     * Wie die Anfrage ausging: `route` (gefunden), `no_route:<Grund>` (kein Weg), `error:<Code>[:<Detail>]` (der Dienst
     * hat sie abgelehnt) oder `unresolved:<Name>` (ein Ort des Falls gibt es nicht eindeutig).
     */
    outcome: string;
    /** Reisestunden (ohne Rast) und Stunden samt Rast. */
    travelHours: number;
    totalHours: number;
    distanceUnits: number;
    /** Fachliche Abschnitte: Stücke desselben Weges mit gleichem Mittel zusammengefasst (siehe `path`). */
    segments: number;
    stages: number;
    /** Wie viele Etappen je `Wegart|Mittel`, nach Schlüssel sortiert. */
    modes: Record<string, number>;
    /**
     * Fingerabdruck der fachlichen Abschnittsfolge: Weg (`public_id`, querfeldein `~`), Mittel, Wegart, Brücke, querfeldein;
     * gleiche Nachbarn zusammengefasst. 🔴 Seit WI-0132 Release N OHNE `edge_id` und ohne Knotenkennungen: Wie ein Weg im
     * Graphen geteilt ist und wie seine technischen Knoten heißen, ist kein Routenergebnis (Review F9).
     */
    path: string;
    /** Fingerabdruck der gezeichneten Linie, auf 1e-4 Karteneinheiten gerundet, doppelte Nachbarpunkte einmal. */
    geometry: string;
    /** Mehrzeit durch Steigung (Stunden); 0 ohne Höhen. */
    slopeHours: number;
    /** Wie viele Sperren die Route umgeht, und die Ankunft (Monat und Tag), wo es einen Reisebeginn gab. */
    closures: number;
    arrival: string;
    warnings: string;
}

const NOTHING = { travelHours: 0, totalHours: 0, distanceUnits: 0, segments: 0, stages: 0, modes: {}, path: "" };

/** Ein Ergebnis ohne Route: `outcome` sagt, warum. */
export function emptyResult(outcome: string): GateResult {
    return { ...NOTHING, outcome, geometry: "", slopeHours: 0, closures: 0, arrival: "", warnings: "" };
}

const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 12);

/**
 * Die fachlichen Abschnitte einer Route: `<public_id oder ~>|<Mittel>|<Wegart>|<Brücke>|<querfeldein>`, gleiche Nachbarn
 * zusammengefasst. Dieselbe Form wie im Vorher-Nachher-Vergleich von WI-0132 (`topology-probe/compare.ts`).
 */
export function routeSections(route: Pick<RouteResponse, "segments">): string[] {
    const sections: string[] = [];
    for (const segment of route.segments) {
        const tag = `${segment.public_id || "~"}|${segment.transport_type}|${segment.subtype}|${segment.synthetic ? 1 : 0}|${segment.offroad ? 1 : 0}`;
        if (sections[sections.length - 1] !== tag) sections.push(tag);
    }
    return sections;
}

/** Was der Dienst geantwortet hat, als das Ergebnis des Falls. */
export function summarize(outcome: RouteOutcome): GateResult {
    if (!outcome.ok) return emptyResult(`error:${outcome.error}${outcome.detail ? `:${outcome.detail}` : ""}`);
    const route: RouteResponse = outcome.response;
    if (!route.found) return emptyResult(`no_route:${route.reason ?? "unknown"}`);
    const modes: Record<string, number> = {};
    for (const stage of route.stages) {
        const key = `${stage.type}|${stage.transport}`;
        modes[key] = (modes[key] ?? 0) + 1;
    }
    const arrival = route.arrival;
    const sections = routeSections(route);
    const points: string[] = [];
    for (const segment of route.segments) {
        for (const [x, y] of segment.geometry.coordinates as [number, number][]) {
            const point = `${x.toFixed(4)},${y.toFixed(4)}`;
            if (points[points.length - 1] !== point) points.push(point);
        }
    }
    return {
        outcome: "route",
        travelHours: route.travel_hours,
        totalHours: route.total_hours,
        distanceUnits: route.distance_units,
        segments: sections.length,
        stages: route.stages.length,
        modes: Object.fromEntries(Object.entries(modes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
        path: shortHash(sections.join("\n")),
        geometry: shortHash(points.join(";")),
        slopeHours: route.slope?.extra_hours ?? 0,
        closures: route.closures?.length ?? 0,
        arrival: arrival ? `${arrival.month || "namenlos"} ${String(arrival.day)}` : "",
        warnings: route.warnings.join(","),
    };
}

/** Relative Toleranz für Kennzahlen: bytegleich auf derselben Maschine, ein paar ULP Luft für eine andere. */
const TOLERANCE = 1e-9;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

const NUMBERS = ["travelHours", "totalHours", "distanceUnits", "slopeHours"] as const;
const COUNTS = ["segments", "stages", "closures"] as const;
const TEXTS = ["outcome", "path", "geometry", "arrival", "warnings"] as const;

/** Worin sich zwei Ergebnisse unterscheiden, lesbar; leer heißt gleich. */
export function differences(before: GateResult, after: GateResult): string[] {
    const found: string[] = [];
    for (const key of TEXTS) if (before[key] !== after[key]) found.push(`${key}: ${before[key]} -> ${after[key]}`);
    for (const key of COUNTS) if (before[key] !== after[key]) found.push(`${key}: ${before[key]} -> ${after[key]}`);
    for (const key of NUMBERS) {
        if (!near(before[key], after[key])) found.push(`${key}: ${String(before[key])} -> ${String(after[key])}`);
    }
    if (JSON.stringify(before.modes) !== JSON.stringify(after.modes)) {
        found.push(`modes: ${JSON.stringify(before.modes)} -> ${JSON.stringify(after.modes)}`);
    }
    return found;
}

export const sameResult = (before: GateResult, after: GateResult): boolean => differences(before, after).length === 0;

/**
 * Von welchen Teilen der Datenrevision ein Fall abhängt. Ändert sich einer davon, kann eine Abweichung an den
 * Daten liegen; ändert sich keiner, liegt sie am Code.
 *
 * - Immer: `map` (Orte, Wege, Flächen) und `terrain` (Gelände querfeldein und im Flug).
 * - Land, Fluss, See: dazu `pathProfiles` (die Steigung der Wege).
 * - Freie Seefahrt: dazu `seaGraph`. Mit Reisebeginn: dazu `climate` (der Boden der Jahreszeit).
 * - Flug rechnet ohne Wege, Graph und Klima.
 *
 * 🔴 Nie dabei: `travelModel`. Das Reisemodell liegt im Repository (`config/travel-model`), nicht in der Datenbank:
 * Wer eine Zeit ändert, ändert den Router, und die Abweichung ist eine `REGRESSION`, bis sie als erwartet
 * eingetragen oder die Basislinie neu aufgenommen ist.
 */
export function relevantParts(query: Pick<RouteQuery, "enabled" | "departure" | "air">): RoutingRevisionPart[] {
    const wanted = new Set<RoutingRevisionPart>(["map", "terrain"]);
    if (!query.air) {
        wanted.add("pathProfiles");
        if (query.enabled.sea) wanted.add("seaGraph");
        if (query.departure) wanted.add("climate");
    }
    return ROUTING_REVISION_PARTS.filter((part) => wanted.has(part));
}

/** Eine erwartete Änderung: der Fall, das Arbeitspaket, der Grund - und das Ergebnis, das erwartet wird. */
export interface ExpectedChange {
    case: string;
    wi: string;
    reason: string;
    result: GateResult;
}

export interface Classification {
    class: GateClass;
    /** Was von der Basislinie abweicht; leer bei `MATCH`. */
    differences: string[];
    /** Welche der für den Fall maßgeblichen Datenteile sich gegen die Basislinie geändert haben. */
    changedParts: RoutingRevisionPart[];
    note: string;
}

export interface ClassifyInput {
    current: GateResult;
    /** Fehlt sie, kennt die Basislinie den Fall nicht. */
    baseline: GateResult | undefined;
    relevant: readonly RoutingRevisionPart[];
    baselineRevision: RoutingDataRevision;
    currentRevision: RoutingDataRevision;
    expected: ExpectedChange | undefined;
}

/**
 * Die Klasse eines Falls. Reihenfolge: gleich, dann ausdrücklich erwartet, dann Datenänderung, sonst Regression.
 * Ein Fall, den die Basislinie nicht kennt, ist eine Regression: Wer einen Fall dazunimmt, nimmt auch seine
 * Basislinie auf, sonst prüft ihn niemand.
 */
export function classify(input: ClassifyInput): Classification {
    const { current, baseline, expected } = input;
    if (!baseline) {
        return {
            class: "REGRESSION",
            differences: ["kein Eintrag in der Basislinie"],
            changedParts: [],
            note: "Basislinie mit --record aufnehmen",
        };
    }
    const found = differences(baseline, current);
    if (found.length === 0) return { class: "MATCH", differences: [], changedParts: [], note: "" };
    if (expected && sameResult(expected.result, current)) {
        return {
            class: "EXPECTED_CHANGE",
            differences: found,
            changedParts: [],
            note: `${expected.wi}: ${expected.reason}`,
        };
    }
    const changedParts = input.relevant.filter((part) => input.baselineRevision[part] !== input.currentRevision[part]);
    if (changedParts.length > 0) {
        return {
            class: "DATA_CHANGE",
            differences: found,
            changedParts,
            note: `Daten geändert (${changedParts.join(", ")}): Basislinie neu aufnehmen`,
        };
    }
    return {
        class: "REGRESSION",
        differences: found,
        changedParts: [],
        note: expected ? "weicht auch vom erwarteten Ergebnis ab" : "gleiche Daten, nicht erwartet",
    };
}

/** Wie oft jede Klasse vorkommt. */
export function countClasses(classes: readonly GateClass[]): Record<GateClass, number> {
    const counts: Record<GateClass, number> = { MATCH: 0, EXPECTED_CHANGE: 0, DATA_CHANGE: 0, REGRESSION: 0 };
    for (const one of classes) counts[one] += 1;
    return counts;
}
