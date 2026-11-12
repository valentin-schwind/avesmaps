import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    foldName,
    isDepartureMonth,
    resolveAirQuery,
    ROUTE_DEFAULTS,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    classify,
    emptyResult,
    relevantParts,
    summarize,
    type Classification,
    type ExpectedChange,
    type GateResult,
} from "./corpus-gate.ts";
import { partKey, revisionKey, type RoutingDataRevision, type RoutingRevisionPart } from "./revision.ts";
import { databaseRoutingSource, RouteService, type RoutingData, type RouteQuery } from "./service.ts";

/**
 * Die Fälle des Routing-Gates und ihr Lauf gegen einen Datenstand (siehe `corpus-gate.ts`). Die Fälle sind die 40
 * des Legacy-Korpus (Anfragen, wie Legacys Orakel sie bekam) und die Ergänzungsfälle in `route-gate-cases.json`;
 * beide laufen gegen den Dienst, so wie ihn der Worker baut: `databaseRoutingSource` und `RouteService`.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const CORPUS_DIRECTORY = resolve(REPO_ROOT, "project-control", "discovery", "corpus");
export const GATE_FILES = {
    corpus: resolve(CORPUS_DIRECTORY, "route-corpus-2026-09-23.json"),
    cases: resolve(CORPUS_DIRECTORY, "route-gate-cases.json"),
    baseline: resolve(CORPUS_DIRECTORY, "route-gate-baseline.json"),
    expected: resolve(CORPUS_DIRECTORY, "route-gate-expected-changes.json"),
} as const;

/** Die Anfrage eines Falls in der Form der Adresse (`/api/route`), ohne die Wegpunkte. */
export interface GateRequest {
    optimize?: "fastest" | "shortest";
    land?: string;
    river?: string;
    sea?: string;
    domains?: string;
    minimize_transfers?: boolean;
    hours_per_day?: number;
    start_month?: string;
    start_day?: number;
    air?: string;
    air_speed?: number;
    air_altitude?: number;
}

export interface GateCase {
    /** `corpus-00` bis `corpus-39` (Reihenfolge der Datei) oder `extra-…`. */
    id: string;
    label: string;
    /** Ortsnamen: Start, Zwischenziele, Ziel. */
    names: string[];
    request: GateRequest;
    /** Warum ein Ergänzungsfall dabei ist. */
    note?: string;
}

interface CorpusFile {
    cases: {
        profile: string;
        request: {
            from: string;
            to: string;
            via: string[];
            optimize: "fastest" | "shortest";
            transports: { land: string; river: string; sea: string };
            enabled_transports: { land: boolean; river: boolean; sea: boolean };
            minimize_transfers: boolean;
        };
    }[];
}

interface CasesFile {
    /** Die schnelle Teilmenge, die in der normalen Testsuite läuft. */
    subset: string[];
    extra: (Omit<GateCase, "names"> & { waypoints: string[] })[];
    /**
     * Orte des Legacy-Korpus, die Legacy seitdem umbenannt hat: alter Name → heutiger Name desselben Ortes (gleiche Stelle). Der Korpus bleibt,
     * wie Legacy ihn lieferte; der Fall fragt nach dem heutigen Namen, statt ohne Route dazustehen.
     */
    umbenannt?: Record<string, string>;
}

export interface GateBaseline {
    recorded: string;
    /** Der Datenstand, gegen den aufgenommen wurde: die ganze Revision und ihre Kurzschlüssel. */
    revision: RoutingDataRevision;
    keys: { routing_graph_revision: string; map_revision: string; terrain_revision: string | null };
    cases: Record<string, { label: string; result: GateResult }>;
}

export interface GateFiles {
    cases: GateCase[];
    subset: string[];
    baseline: GateBaseline | undefined;
    expected: ExpectedChange[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/**
 * Im Release-Test der Vergleichsstand des Laufs (WI-0248, `scripts/dev/release-routing.ts`): Passt die Routing-Revision des Korpus nicht zur
 * Basislinie, rechnet der Runner die Fälle mit dem Code der Basislinie (`code`) auf genau diesem Korpus und nennt die Datei in dieser Variablen. Die
 * Teilmenge in `route-corpus-gate.test.ts` vergleicht dann damit statt mit der Basislinie: gleiche Daten, also ist jede Abweichung eine REGRESSION.
 */
export const GATE_VERGLEICH_ENV = "AVESMAPS_ROUTING_VERGLEICH";

/** Liest einen Vergleichsstand; wirft, wenn die Datei keiner ist (der Release-Test wird dann rot, statt still die Basislinie zu nehmen). */
export function loadComparison(path: string): GateBaseline & { code: string } {
    const raw = readJson<Partial<GateBaseline> & { code?: unknown }>(path);
    if (
        typeof raw.code !== "string" ||
        typeof raw.revision !== "object" ||
        raw.revision === null ||
        typeof raw.cases !== "object" ||
        raw.cases === null
    )
        throw new Error(`${path}: kein Vergleichsstand des Routing-Gates (code, revision, cases)`);
    return raw as GateBaseline & { code: string };
}

/** Die Fälle aus dem Korpus und den Ergänzungen, die Teilmenge, die Basislinie und die erwarteten Änderungen. */
export function loadGateFiles(files: typeof GATE_FILES = GATE_FILES): GateFiles {
    const corpus = readJson<CorpusFile>(files.corpus);
    const extras = readJson<CasesFile>(files.cases);
    const heute = (name: string): string => extras.umbenannt?.[name] ?? name;
    const cases: GateCase[] = corpus.cases.map(({ profile, request }, index) => {
        const names = [request.from, ...request.via, request.to].map(heute);
        return {
            id: `corpus-${String(index).padStart(2, "0")}`,
            label: `${profile}: ${names.join(" > ")}`,
            names,
            request: {
                optimize: request.optimize,
                land: request.transports.land,
                river: request.transports.river,
                sea: request.transports.sea,
                domains: (["land", "river", "sea"] as const)
                    .filter((medium) => request.enabled_transports[medium])
                    .join(","),
                minimize_transfers: request.minimize_transfers,
            },
        };
    });
    for (const { waypoints, ...rest } of extras.extra) cases.push({ ...rest, names: waypoints });
    const expected = existsSync(files.expected) ? readJson<{ changes: ExpectedChange[] }>(files.expected).changes : [];
    return {
        cases,
        subset: extras.subset,
        baseline: existsSync(files.baseline) ? readJson<GateBaseline>(files.baseline) : undefined,
        expected,
    };
}

/** Die Anfrage des Falls, wie der Endpunkt sie an den Dienst gäbe (`routes/route.ts`), ohne die Wegpunkte. */
export function queryOf(request: GateRequest): Omit<RouteQuery, "waypoints"> | { invalid: string } {
    const air = resolveAirQuery(AVENTURIA_TRAVEL_MODEL, request);
    if (!air.ok) return { invalid: `${air.parameter} ${air.message}` };
    const domains = new Set((request.domains ?? ROUTE_DEFAULTS.domains).split(","));
    return {
        optimize: request.optimize ?? ROUTE_DEFAULTS.optimize,
        transports: {
            land: request.land ?? ROUTE_DEFAULTS.land,
            river: request.river ?? ROUTE_DEFAULTS.river,
            sea: request.sea ?? ROUTE_DEFAULTS.sea,
        },
        enabled: { land: domains.has("land"), river: domains.has("river"), sea: domains.has("sea") },
        minimizeTransfers: request.minimize_transfers ?? ROUTE_DEFAULTS.minimize_transfers,
        hoursPerDay: request.hours_per_day ?? ROUTE_DEFAULTS.hours_per_day,
        ...(request.start_month !== undefined && isDepartureMonth(request.start_month)
            ? { departure: { month: request.start_month, day: request.start_day ?? 1 } }
            : {}),
        ...(air.air ? { air: air.air } : {}),
    };
}

/**
 * Der Ort zu einem Namen: der genau so geschriebene, sonst der ohne Akzente und Großschreibung - aber nur, wenn
 * es genau einen gibt. Ein Name, den zwei Orte tragen, gilt als nicht eindeutig, nicht als der erste Treffer.
 */
export function resolveName(
    places: readonly { id: string; name: string; hidden: boolean }[],
    name: string,
): { id: string } | { unresolved: string } {
    const exact = places.filter((place) => place.name === name.trim());
    const found = exact.length > 0 ? exact : places.filter((place) => foldName(place.name) === foldName(name));
    if (found.length === 1 && found[0]) return { id: found[0].id };
    return { unresolved: found.length === 0 ? `not_found:${name}` : `ambiguous:${name}` };
}

/** Ein Dienst über einem festen Datenstand: er lädt nichts nach und prüft keine Revision mehr. */
export interface GateService {
    service: RouteService;
    data: RoutingData;
}

/** Der Datenstand einmal in einer Transaktion gelesen, wie ihn der Worker lädt (`databaseRoutingSource`). */
export async function openGateService(database: Queryable): Promise<GateService> {
    const model = AVENTURIA_TRAVEL_MODEL;
    const source = databaseRoutingSource(database, AVENTURIA.mapDomain, model);
    const data = await source.load();
    const service = new RouteService({
        mapDomain: AVENTURIA.mapDomain,
        model,
        source: {
            revision: async () => data.revision,
            load: async () => data,
            ...(source.loadSea ? { loadSea: source.loadSea } : {}),
        },
        recheckMs: Number.POSITIVE_INFINITY,
    });
    return { service, data };
}

export interface GateRun {
    case: GateCase;
    relevant: RoutingRevisionPart[];
    result: GateResult;
}

/** Rechnet die Fälle nacheinander, jeden so, wie der Endpunkt ihn rechnete. */
export async function runCases(gate: GateService, cases: readonly GateCase[]): Promise<GateRun[]> {
    const places = [...gate.data.network.nodes.values()]
        .filter((node) => node.kind === "place")
        .map((node) => ({ id: node.id, name: node.name, hidden: node.isHidden }));
    const runs: GateRun[] = [];
    for (const one of cases) {
        const query = queryOf(one.request);
        if ("invalid" in query) {
            runs.push({ case: one, relevant: [], result: emptyResult(`unresolved:invalid_request:${query.invalid}`) });
            continue;
        }
        const ids: string[] = [];
        let unresolved: string | undefined;
        for (const name of one.names) {
            const hit = resolveName(places, name);
            if ("id" in hit) ids.push(hit.id);
            else unresolved ??= hit.unresolved;
        }
        const relevant = relevantParts(query);
        if (unresolved !== undefined) {
            runs.push({ case: one, relevant, result: emptyResult(`unresolved:${unresolved}`) });
            continue;
        }
        runs.push({ case: one, relevant, result: summarize(await gate.service.route({ ...query, waypoints: ids })) });
    }
    return runs;
}

/** Die Basislinie aus einem Lauf: alle Fälle und der Datenstand, auf dem sie gerechnet wurden. */
export function recordBaseline(runs: readonly GateRun[], revision: RoutingDataRevision, date: string): GateBaseline {
    return {
        recorded: date,
        revision,
        keys: {
            routing_graph_revision: revisionKey(revision),
            map_revision: partKey(revision.map) ?? "",
            terrain_revision: partKey(revision.terrain),
        },
        cases: Object.fromEntries(runs.map((run) => [run.case.id, { label: run.case.label, result: run.result }])),
    };
}

export interface GateRow extends Classification {
    case: GateCase;
    result: GateResult;
    baseline: GateResult | undefined;
}

/** Jeden Lauf gegen die Basislinie und die erwarteten Änderungen klassifizieren. */
export function classifyRuns(
    runs: readonly GateRun[],
    baseline: GateBaseline,
    expected: readonly ExpectedChange[],
    currentRevision: RoutingDataRevision,
): GateRow[] {
    return runs.map((run) => ({
        case: run.case,
        result: run.result,
        baseline: baseline.cases[run.case.id]?.result,
        ...classify({
            current: run.result,
            baseline: baseline.cases[run.case.id]?.result,
            relevant: run.relevant,
            baselineRevision: baseline.revision,
            currentRevision,
            expected: expected.find((change) => change.case === run.case.id),
        }),
    }));
}
