import { createHash } from "node:crypto";
import type { RouteOutcome } from "../service.ts";
import { exactKey, TECH_NODE_PREFIX } from "../topology.ts";

/**
 * WI-0132 P1, Teil C: eine Route fachlich normalisiert, damit zwei Netze verglichen werden können, deren technische
 * Knoten und Kanten verschieden heißen (Review F9). Verglichen werden: Ausgang, Folge der fachlichen Wege (`public_id`,
 * Stücke desselben Weges zusammengefasst) mit Mittel, Wegart und `synthetic`, sichtbare Etappen (Namen, Reihenfolge,
 * Rast), Strecke, Reisestunden, Gesamtdauer und die gezeichnete Linie. NICHT verglichen: `edge_id`, Knotenkennungen,
 * Zahl der Teilstücke.
 */

export interface NormalizedRoute {
    outcome: string;
    /** Abschnitte: `<public_id oder ~>|<Mittel>|<Wegart>|<synthetic>|<offroad>`, gleiche Nachbarn zusammengefasst. */
    sections: string[];
    /** Etappen: `<von> > <nach>|<Art>|<Mittel>|Rast <Stunden>`. */
    stages: string[];
    distance: number;
    travelHours: number;
    totalHours: number;
    /** Fingerabdruck der gezeichneten Linie (1e-4), doppelte und eingefügte T-Punkte entfernt. */
    geometry: string;
    /** Die Knoten der Route, die keine Orte sind (Kreuzungen, technische Knoten, Anker). */
    nonPlaceNodes: string[];
    /** Die fachlichen Wege der Route, in Reihenfolge, ohne Wiederholung. */
    paths: string[];
    /** Etappenpunkte, die als Ort auftreten, und ihre Kennung (für die Prüfung D). */
    stagePlaces: string[];
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 12);

/** Normalisiert eine Antwort des Routendienstes; `inserted` sind die Schlüssel eingefügter T-Punkte. */
export function normalizeRoute(
    outcome: RouteOutcome,
    isPlace: (id: string) => boolean,
    inserted: ReadonlySet<string> = new Set(),
): NormalizedRoute {
    const empty = (text: string): NormalizedRoute => ({
        outcome: text,
        sections: [],
        stages: [],
        distance: 0,
        travelHours: 0,
        totalHours: 0,
        geometry: "",
        nonPlaceNodes: [],
        paths: [],
        stagePlaces: [],
    });
    if (!outcome.ok) return empty(`error:${outcome.error}`);
    const route = outcome.response;
    if (!route.found) return empty(`no_route:${route.reason ?? "unknown"}`);
    const sections: string[] = [];
    const nonPlace = new Set<string>();
    const paths: string[] = [];
    const points: string[] = [];
    for (const segment of route.segments) {
        const tag = `${segment.public_id || "~"}|${segment.transport_type}|${segment.subtype}|${segment.synthetic ? 1 : 0}|${segment.offroad ? 1 : 0}`;
        if (sections[sections.length - 1] !== tag) sections.push(tag);
        if (segment.public_id && paths[paths.length - 1] !== segment.public_id) paths.push(segment.public_id);
        for (const id of [segment.from_node_id, segment.to_node_id]) if (!isPlace(id)) nonPlace.add(id);
        for (const [x, y] of segment.geometry.coordinates as [number, number][]) {
            if (inserted.has(exactKey(x, y))) continue;
            const point = `${x.toFixed(4)},${y.toFixed(4)}`;
            if (points[points.length - 1] !== point) points.push(point);
        }
    }
    const stages = route.stages.map(
        (stage) =>
            `${stage.from.name || "·"} > ${stage.to.name || "·"}|${stage.type}|${stage.transport}|Rast ${stage.rest_hours.toFixed(3)}`,
    );
    const stagePlaces = route.stages.flatMap((stage) =>
        [stage.from, stage.to].filter((point) => point.point === "place").map((point) => point.place_id ?? ""),
    );
    return {
        outcome: "route",
        sections,
        stages,
        distance: route.distance_units,
        travelHours: route.travel_hours,
        totalHours: route.total_hours,
        geometry: hash(points.join(";")),
        nonPlaceNodes: [...nonPlace],
        paths,
        stagePlaces,
    };
}

const RELATIVE = 1e-9;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= RELATIVE * Math.max(1, Math.abs(a), Math.abs(b));

/** Worin sich zwei normalisierte Routen unterscheiden; leer heißt fachlich gleich. */
export function routeDifferences(before: NormalizedRoute, after: NormalizedRoute): string[] {
    const found: string[] = [];
    if (before.outcome !== after.outcome) found.push(`Ausgang ${before.outcome} -> ${after.outcome}`);
    if (before.sections.join("\n") !== after.sections.join("\n")) {
        found.push(`Wegfolge ${String(before.sections.length)} -> ${String(after.sections.length)} Abschnitte`);
    }
    if (before.stages.join("\n") !== after.stages.join("\n")) {
        found.push(`Etappen ${String(before.stages.length)} -> ${String(after.stages.length)}`);
    }
    if (before.geometry !== after.geometry) found.push("Linie");
    if (!near(before.distance, after.distance))
        found.push(`Strecke ${fmt(before.distance)} -> ${fmt(after.distance)} E`);
    if (!near(before.travelHours, after.travelHours)) {
        found.push(`Reisestunden ${fmt(before.travelHours)} -> ${fmt(after.travelHours)}`);
    }
    if (!near(before.totalHours, after.totalHours)) {
        found.push(`Gesamtdauer ${fmt(before.totalHours)} -> ${fmt(after.totalHours)} h`);
    }
    return found;
}

const fmt = (value: number): string => value.toFixed(3);

export interface AttributionContext {
    /** Klasse und Grund jeder Kreuzung (`a:ende` …), nach Kennung. */
    anchorOf: ReadonlyMap<string, string>;
    /** Je Weg die Kreuzungen, an denen er teilnimmt und die nicht `a` sind. */
    openAnchorsOfPath: ReadonlyMap<string, readonly string[]>;
    /** Zielknoten, die eine Kreuzung der Klasse `a` ersetzen. */
    reproduced: ReadonlySet<string>;
    /** Wege, die im Ziel verworfen sind. */
    dropped: ReadonlySet<string>;
}

export type AttributionKind = "gleich" | "nur_zahlen" | "stelle" | "verworfen" | "ziel_neu" | "unerklaert";

export interface Attribution {
    kind: AttributionKind;
    differences: string[];
    /** Kennungen, die die Abweichung erklären (Kreuzungen, Wege, technische Knoten). */
    because: string[];
}

/**
 * Warum sich eine Route im Ziel ändert, in dieser Reihenfolge: über eine Kreuzung der heutigen Route, die im Ziel nicht
 * reproduziert ist (`stelle`); über einen geänderten Weg, der an einer solchen Kreuzung teilnimmt (`stelle`); über einen
 * im Ziel verworfenen Weg (`verworfen`); über einen technischen Knoten, der keine Kreuzung ersetzt, also eine Verbindung,
 * die es heute nicht gab (`ziel_neu`). Sonst `unerklaert`: ein möglicher echter Routingfehler, einzeln zu prüfen.
 */
export function attribute(before: NormalizedRoute, after: NormalizedRoute, context: AttributionContext): Attribution {
    const differences = routeDifferences(before, after);
    if (differences.length === 0) return { kind: "gleich", differences, because: [] };
    // Gleiche Gestalt: Ausgang, Wegfolge, Linie und Etappen ohne ihre Rast (die Rast folgt den Stunden).
    const withoutRest = (stages: readonly string[]): string =>
        stages.map((stage) => stage.replace(/\|Rast .*$/, "")).join("\n");
    const sameShape =
        before.outcome === after.outcome &&
        before.sections.join("\n") === after.sections.join("\n") &&
        withoutRest(before.stages) === withoutRest(after.stages) &&
        before.geometry === after.geometry;
    if (sameShape) return { kind: "nur_zahlen", differences, because: [] };
    const onRoute = before.nonPlaceNodes.filter((id) => {
        const anchor = context.anchorOf.get(id);
        return anchor !== undefined && !anchor.startsWith("a:");
    });
    if (onRoute.length > 0) return { kind: "stelle", differences, because: onRoute };
    const changed = changedPaths(before, after);
    const viaPath = [...new Set(changed.flatMap((id) => context.openAnchorsOfPath.get(id) ?? []))];
    if (viaPath.length > 0) return { kind: "stelle", differences, because: viaPath };
    const dropped = changed.filter((id) => context.dropped.has(id));
    if (dropped.length > 0) return { kind: "verworfen", differences, because: dropped };
    const fresh = after.nonPlaceNodes.filter((id) => id.startsWith(TECH_NODE_PREFIX) && !context.reproduced.has(id));
    if (fresh.length > 0) return { kind: "ziel_neu", differences, because: fresh };
    return { kind: "unerklaert", differences, because: changed };
}

/** Die Wege, die nur in einer der beiden Routen vorkommen. */
export function changedPaths(before: NormalizedRoute, after: NormalizedRoute): string[] {
    const a = new Set(before.paths);
    const b = new Set(after.paths);
    return [...new Set([...before.paths.filter((id) => !b.has(id)), ...after.paths.filter((id) => !a.has(id))])];
}
