import {
    CLOSURE_REASONS,
    calendarDate,
    clockEnter,
    clockTravel,
    dayAfter,
    DAYS_PER_YEAR,
    groundRequirement,
    isRestExempt,
    isShownPathName,
    OFFROAD_TYPE,
    pathSeasonWindow,
    routeDomain,
    seasonGround,
    seasonOfDay,
    isSnowCondition,
    seasonSnow,
    snowlineGround,
    stageDayHours,
    travelHoursFromTime,
    windowContains,
    type ClosureReason,
    type RouteClosure,
    type RouteSeasonalWay,
    type SeasonWindow,
    type TravelClock,
    type TravelModel,
} from "@avesmaps3d/shared";
import type { ClimateZones } from "./climate.ts";
import type { RouteLink } from "./network.ts";
import type { TerrainHeights } from "./relief.ts";
import { aboveSnowline, snowShare } from "./snow-ground.ts";

/**
 * Reisebeginn und Sperrzeiten (WI-0038; Legacy `client-graph.php`, `closures.php`, avesmaps@770c80e;
 * MCS-024).
 *
 * - **Je Kante gegen die mitlaufende Uhr** (Owner 03.08.2026: „Exakt je Kante, gegen das akkumulierte
 *   Datum“): Eine Kante mit Fenster für ihr Reisemittel ist zu, wenn der Tag, an dem man sie betritt,
 *   außerhalb liegt. Kein Warten vor einem Pass.
 * - **Eine Uhr** (Betreiber 2026-09-26, E1): Reisestunden je Tag aus dem Planer, Rast in Portionen
 *   (`travel-clock.ts`) - dieselbe Uhr gibt die Daten im Reiseplan.
 * - **Der Boden der Jahreszeit** verlangsamt Landwege und den Gang querfeldein in ihrer Klimazone (E2,
 *   E3) und zählt in der Wegwahl mit. Wasser nie.
 * - **Schnee über der Schneegrenze** (Betreiber 2026-10-04, „ja, A“, dann „schnee B“ und eingeschaltet „B“): Im Gebirge über der
 *   Schneegrenze des Tages und der Zone gilt als Boden `schneegrenze.bodenDarueber` (Tiefschnee), zu jeder Jahreszeit;
 *   ist der Boden der Jahreszeit strenger oder gleich streng (Eis), bleibt er. Fassung A: nur auf einer Kante, die ganz
 *   darüber liegt (`aboveSnowline`, dieselbe Stelle wie der Bergschnee des Schlittens); Fassung B (`bodenAnteilig`): auf
 *   dem Teil jeder Kante, der darüber liegt (`snowShare`), die Kante dauert anteilig länger. Wie der Boden der
 *   Jahreszeit in Suche und Zeit, nur mit Reisebeginn.
 * - **Ein Mittel mit Bodenpflicht** (`bodenPflicht`, WI-0069: der Schlitten) fährt nur auf Schnee: in seinen
 *   Jahreszeiten, wo der Boden des Tages einer seiner Zustände ist, und im Gebirge über der Schneegrenze immer
 *   (`snow-ground.ts`). Das ist keine Sperrzeit, sondern eine Regel wie `nieAngeboten`: Auch der Vergleichslauf
 *   ohne Fenster fährt dort nicht. Sein Tempo auf Schnee steht in der Bodentafel (`jahreszeitBoden.meilen`).
 * - **Vergleichslauf:** Nur wo die Suche eine Sperre berührt hat, rechnet sie die Etappe noch einmal
 *   ohne Fenster. Ist das billiger, meldet ein Bericht, wo die Route abzweigt und was sie umgeht.
 */

export interface RouteTiming {
    /** Der Reisebeginn als Tag im Jahr, 1 bis 365 (seit 2026-11-07 auch an einem Namenlosen Tag). */
    departure: number;
    /** Reisestunden je Tag an Land, aus dem Planer; 24 heißt ohne Rast. */
    hoursPerDay: number;
    climate: ClimateZones;
    /**
     * Das Gelände, für die Schneegrenze im Gebirge bei Gängen querfeldein (WI-0069, Schlitten und Boden über der
     * Schneegrenze); ohne es kein Bergschnee dort.
     */
    heights?: TerrainHeights | null;
}

/** Was die Uhr von einer Kante braucht; die Kanten des Routers passen darauf. */
export interface TimedEdge {
    link: RouteLink;
    transport: string;
    time: number;
    costFactor: number;
    distance: number;
    forward: boolean;
    synthetic: boolean;
    /** Schon angewandter Boden der Jahreszeit: Die Zeit ist dann um `factor` länger. */
    ground?: { condition: string; factor: number };
}

export interface ClockStep {
    /** Die Uhr, wenn man die Kante betritt, nach einer fälligen Rast. */
    entered: TravelClock;
    /** Der Tag dazu, im Jahr. */
    day: number;
    window: SeasonWindow | undefined;
    open: boolean;
    ground: { condition: string; factor: number } | null;
    /**
     * Wo der Boden über der Schneegrenze mitwirkt: wie viel Schnee und Eis kosten, als Anteil der Zeit ohne Boden, und
     * ihr Zustand (für die Schnee-Mehrstunden, `route-result.ts`). Sonst null: Dann folgt der Schnee aus `ground`.
     */
    snow: { condition: string; extra: number } | null;
    /** Reisestunden auf der Kante, mit dem Boden der Jahreszeit. */
    hours: number;
    after: TravelClock;
    /** Fährt das Mittel an diesem Tag hier überhaupt? Nein nur bei Bodenpflicht ohne passenden Boden (WI-0069). */
    usable: boolean;
}

const edgeType = (edge: TimedEdge): string => (edge.synthetic ? OFFROAD_TYPE : edge.link.subtype);

/**
 * Was ein Lauf der Uhr von der Jahreszeit gelten lässt (WI-0082): Der gewöhnliche Lauf und der Vergleichslauf ohne
 * Fenster rechnen MIT dem Boden der Jahreszeit; nur die Route des guten Wetters rechnet ohne ihn (`seasonGround:
 * false`). Die Bodenpflicht eines Mittels (Schlitten) bleibt in jedem Fall: Sie ist keine Wirkung der Jahreszeit,
 * sondern eine Regel wie `nieAngeboten`.
 */
export interface ClockOptions {
    seasonGround?: boolean;
}

/** Ein Schritt der Uhr über eine Kante - dieselbe Rechnung in der Suche und im Bericht. */
export function clockStep(
    model: TravelModel,
    timing: RouteTiming,
    clock: TravelClock,
    edge: TimedEdge,
    options: ClockOptions = {},
): ClockStep {
    const type = edgeType(edge);
    const baseTime = edge.ground ? edge.time / edge.ground.factor : edge.time;
    const baseHours = travelHoursFromTime(model, baseTime / edge.costFactor);
    const exempt = isRestExempt(model, { type, transport: edge.transport });
    // Die Rast eines vollen Tages wird vor dem nächsten Stück gebucht, das wirklich reist (wie im Zähler).
    const entered = exempt || !(baseHours > 1e-9) ? clock : clockEnter(clock);
    const day = dayAfter(timing.departure, entered.hours);
    const window = pathSeasonWindow(model, edge.link.seasons, edge.transport, edge.link.transportsWritten === true);
    // Ohne Wegklasse (See, Fluss) hat die Wegart keinen Boden: Die Klimazone muss nicht abgetastet werden -
    // bei einer Seekante der freien Seefahrt wären das Hunderte Proben je Kante (WI-0046).
    const zone =
        model.jahreszeitBoden.wert.wegklasse[type] === undefined
            ? undefined
            : timing.climate.zoneOf(edge.link.coordinates);
    const rule = groundRequirement(model, edge.transport);
    let ground: ClockStep["ground"] = null;
    let snow: ClockStep["snow"] = null;
    let usable = true;
    // Auch der Schlitten rechnet mit dem Boden: Seine Werte in der Bodentafel sind die der Kaleschka (WI-0258, E3).
    if (zone !== undefined && options.seasonGround !== false) {
        const season = seasonGround(model, zone, seasonOfDay(day), type, edge.transport);
        ground = season;
        // Über der Schneegrenze liegt zu jeder Jahreszeit der Boden `bodenDarueber` (Betreiber 2026-10-04), wo er strenger
        // ist als der Boden der Jahreszeit; das Gelände wird nur gefragt, wenn er es wäre.
        const mountain = snowlineGround(model, type, edge.transport);
        if (mountain && mountain.factor > (season?.factor ?? 1)) {
            const heights = timing.heights ?? null;
            // B: der Anteil der Kante im Gebirge über der Grenze; A: die ganze Kante oder nichts.
            const share = model.schneegrenze.wert.bodenAnteilig
                ? snowShare(model, edge.link, zone, day, heights)
                : aboveSnowline(model, edge.link, zone, day, heights)
                  ? 1
                  : 0;
            if (share > 0) ({ ground, snow } = mountainGround(model, season, mountain, share));
        }
    }
    if (rule) {
        // Schnee des Winters, oder im Gebirge über der Schneegrenze zu jeder Jahreszeit (Betreiber 2026-10-03).
        usable =
            zone !== undefined &&
            (seasonSnow(model, rule, zone, seasonOfDay(day)) ||
                (rule.gebirgeUeberSchneegrenze && aboveSnowline(model, edge.link, zone, day, timing.heights ?? null)));
    }
    const hours = baseHours * (ground?.factor ?? 1);
    const dayHours = stageDayHours(model, edge.transport, timing.hoursPerDay);
    const after = clockTravel(entered, hours, dayHours, exempt, timing.hoursPerDay < 24).clock;
    const open = window === undefined || windowContains(window, day);
    return { entered, day, window, open, ground, snow, hours, after, usable };
}

/**
 * Der Boden einer Kante, auf deren Anteil `share` der Boden über der Schneegrenze liegt und auf dem Rest der Boden der
 * Jahreszeit (oder keiner): Die Zeiten der Teile addieren sich, der Faktor ist ihr nach Länge gewichtetes Mittel. Der
 * Zustand ist der des Teils, der mehr Zeit kostet. Der Schnee zählt den Bergschnee und, wenn er Schnee ist, den Boden
 * der Jahreszeit auf dem Rest.
 */
function mountainGround(
    model: TravelModel,
    season: { condition: string; factor: number } | null,
    mountain: { condition: string; factor: number },
    share: number,
): { ground: NonNullable<ClockStep["ground"]>; snow: NonNullable<ClockStep["snow"]> } {
    const rest = season?.factor ?? 1;
    const factor = rest + share * (mountain.factor - rest);
    const restExtra = (1 - share) * (rest - 1);
    const mountainExtra = share * (mountain.factor - 1);
    const seasonSnow = season !== null && isSnowCondition(model, season.condition);
    return {
        ground: {
            condition: season !== null && restExtra > mountainExtra ? season.condition : mountain.condition,
            factor,
        },
        snow: {
            condition: seasonSnow && restExtra > mountainExtra ? season.condition : mountain.condition,
            extra: mountainExtra + (seasonSnow ? restExtra : 0),
        },
    };
}

const windowEnd = (month: string, day: number) => ({ month, day }) as RouteSeasonalWay["open_from"];

/**
 * Wie der Bericht einen Weg nennt: sein Name, wenn der Reiseplan ihn zeigt, sonst der Name seiner
 * Sperrgebiete (freie Seefahrt), sonst leer.
 */
const pathLabel = (link: RouteLink): string =>
    isShownPathName(link.pathName, link.subtype) ? link.pathName.trim() : (link.seasonLabel ?? "");

/**
 * Warum ein Weg außerhalb seines Fensters nicht gangbar ist. Die freie Seefahrt bringt den Grund ihrer
 * Sperrgebiete mit; ein Landweg, der an einem Wintertag zu ist, ist es wegen Schneemassen (Betreiber
 * 2026-09-27: „Auf jeden Fall A“ - auf map154313 alle 45 Landwege mit Fenster: Eisenstraße, Rabenpass,
 * Roterzpass, Saljethweg, Hjaldorpass, Raschtulsweg, Weg-5994). Sonst unbekannt: Der Planer schreibt
 * dann „Gesperrt“. Vor allem anderen gilt der Grund, den ein Editor am Fenster gespeichert hat (`reason`, WI-0177
 * Vorschlag 3 Schritt 3, Migration 0208).
 */
function closureReason(edge: TimedEdge, window: SeasonWindow): ClosureReason | undefined {
    const gespeichert = (window as SeasonWindow & { reason?: unknown }).reason;
    if ((CLOSURE_REASONS as readonly unknown[]).includes(gespeichert)) return gespeichert as ClosureReason;
    if (edge.link.seasonReason) return edge.link.seasonReason;
    if (routeDomain(edge.link.subtype) !== "land") return undefined;
    for (let day = 1; day <= DAYS_PER_YEAR; day += 1) {
        if (seasonOfDay(day) === "winter" && !windowContains(window, day)) return "schneemassen";
    }
    return undefined;
}

/** Ein Weg mit Fenster auf einer Folge von Kanten, zusammengefasst über seine Stücke. */
function wayOf(edge: TimedEdge, window: SeasonWindow, fromNode: string): RouteSeasonalWay & { key: string } {
    const label = pathLabel(edge.link);
    return {
        // Ein benannter Weg zählt einmal, über Straße, Pfad und Pass hinweg; ein unbenannter je Weg.
        key: `${label === "" ? `${edge.link.subtype}|${edge.link.pathPublicId}` : label}|${edge.transport}`,
        path_name: label,
        public_ids: edge.link.pathPublicId === "" ? [] : [edge.link.pathPublicId],
        subtype: edge.link.subtype,
        transport: edge.transport,
        from_node: fromNode,
        open_from: windowEnd(window.from_month, window.from_day),
        open_to: windowEnd(window.to_month, window.to_day),
        ...withReason(closureReason(edge, window)),
    };
}

const withReason = (reason: ClosureReason | undefined): { reason?: ClosureReason } => (reason ? { reason } : {});

function mergeWay<T extends RouteSeasonalWay & { key: string }>(ways: Map<string, T>, way: T): void {
    const known = ways.get(way.key);
    if (!known) {
        ways.set(way.key, way);
        return;
    }
    for (const id of way.public_ids) if (!known.public_ids.includes(id)) known.public_ids.push(id);
}

function withoutKey<T extends { key: string }>(value: T): Omit<T, "key"> {
    const copy: Partial<T> = { ...value };
    delete copy.key;
    return copy as Omit<T, "key">;
}

/**
 * Ohne Reisebeginn: die Wege der gefundenen Route mit Sperrzeit für ihr Reisemittel (Legacy
 * `avesmapsRouteSeasonalWays`). Nach Alternativen, die erst eine andere Jahreszeit brächte, wird nicht
 * gesucht (Legacy-Spec).
 */
export function seasonalWays(
    model: TravelModel,
    edges: readonly TimedEdge[],
    nodeIds: readonly string[],
    nodeName: (id: string) => string,
): RouteSeasonalWay[] {
    const ways = new Map<string, RouteSeasonalWay & { key: string }>();
    edges.forEach((edge, index) => {
        const window = pathSeasonWindow(model, edge.link.seasons, edge.transport, edge.link.transportsWritten === true);
        if (window) mergeWay(ways, wayOf(edge, window, nodeName(nodeIds[index] ?? "")));
    });
    return [...ways.values()].map(withoutKey);
}

/** Strecke, Reisestunden und die Zeit samt Rast einer Kantenfolge ab `start`. */
function figures(
    model: TravelModel,
    timing: RouteTiming,
    edges: readonly TimedEdge[],
    start: TravelClock,
    options: ClockOptions = {},
): { distance_units: number; travel_hours: number; total_hours: number } {
    let clock = start;
    let distance = 0;
    let hours = 0;
    for (const edge of edges) {
        const step = clockStep(model, timing, clock, edge, options);
        distance += edge.link.distance;
        hours += step.hours;
        clock = step.after;
    }
    return { distance_units: distance, travel_hours: hours, total_hours: clock.hours - start.hours };
}

/** Die gesperrten Wege auf einer Kantenfolge, gegen die Uhr dieser Folge; jeder Weg einmal. */
function closedWaysOn(
    model: TravelModel,
    timing: RouteTiming,
    run: { edges: readonly TimedEdge[]; nodeIds: readonly string[] },
    start: TravelClock,
    nodeName: (id: string) => string,
    options: ClockOptions = {},
): Map<string, RouteClosure["avoided"][number] & { key: string }> {
    const avoided = new Map<string, RouteClosure["avoided"][number] & { key: string }>();
    let clock = start;
    run.edges.forEach((edge, index) => {
        const step = clockStep(model, timing, clock, edge, options);
        if (!step.open && step.window) {
            const way = wayOf(edge, step.window, nodeName(run.nodeIds[index] ?? ""));
            mergeWay(avoided, {
                ...way,
                kind: "season" as const,
                reached_on: calendarDate(timing.departure, step.entered.hours),
            });
        }
        clock = step.after;
    });
    return avoided;
}

/** Die erste Kante, an der zwei Kantenfolgen auseinandergehen, und der Knoten davor. */
function divergence(
    actual: { edges: readonly TimedEdge[]; nodeIds: readonly string[] },
    other: { edges: readonly TimedEdge[] },
    startNode: string,
): { node: string; edge: string } {
    const same = (a: TimedEdge | undefined, b: TimedEdge | undefined): boolean =>
        a !== undefined && b !== undefined && a.link.id === b.link.id && a.forward === b.forward;
    let index = 0;
    while (index < actual.edges.length && same(actual.edges[index], other.edges[index])) index += 1;
    return { node: actual.nodeIds[index] ?? startNode, edge: actual.edges[index]?.link.id ?? "" };
}

/**
 * 🔴 **Fassung C, die Route des guten Wetters** (WI-0082, Betreiber 2026-10-05 „JA!“): Gemeldet wird eine Sperre,
 * die auf der Route läge, die diese Reise **ohne jede Wirkung der Jahreszeit** nähme - ohne Sperrfenster UND ohne
 * den Boden der Jahreszeit. Genau diese Route rechnet der Planer auch, wenn kein Reisebeginn gesetzt ist.
 *
 * **Warum es diesen zweiten Bericht braucht** (§1a, gemessen): Seit der Schneeregel meidet die Reise den Saljethweg
 * im Firun schon über die Kosten. Der Vergleichslauf ohne Fenster fährt mit derselben Kalenderuhr und meidet ihn
 * ebenso, also bleibt er leer, und der Reisende verliert die Auskunft „dieser Pass ist jetzt zu“. Die Route des
 * guten Wetters nimmt ihn - und sie ist die Route, die er gefahren WÄRE.
 *
 * **Die Abgrenzung ist belegt, nicht geraten** (AC3): Gemeldet wird nur ein Weg, den DIESE Reise ohne die
 * Jahreszeit wirklich benutzt hätte. „In der Nähe der Route“ wäre eine erfundene Zahl.
 *
 * 🔴 **Und nur ein Weg, den der Reisende auf seiner Karte findet**: Er muss einen gezeigten Namen tragen
 * (`pathLabel`, bei der freien Seefahrt der Name seines Sperrgebiets). Ein namenloses Stück - ein geteilter Weg,
 * ein Gang querfeldein, eine erzeugte Kennung - wäre auf einer Route, die der Reisende gar nicht fährt, eine
 * Auskunft über nichts (Betreiber 2026-10-05, dritte Frage: „keinen Weg nennen, den der Reisende auf seiner Karte
 * gar nicht sieht“). 🪤 Gemessen am Abnahmefall ließ sich die Frage NICHT als Ähnlichkeit der beiden Routen
 * umsetzen: Greifenfurt → Lowangen teilt zwischen gutem Wetter und 1. Firun **keinen** inneren Knoten und
 * **keine** Kante - eine solche Schranke hätte genau den Fall von AC1 unterdrückt (Befund in WI-0082 §3b).
 *
 * Der Bericht trägt `avoided_anyway`, denn die Route ist **nicht wegen der Sperre** länger: Der Hinweis nennt keine
 * Zeit. Null, wenn auf der Route des guten Wetters kein gesperrter, benennbarer Weg liegt.
 */
export function fairWeatherReport(input: {
    model: TravelModel;
    timing: RouteTiming;
    legIndex: number;
    start: TravelClock;
    startNode: string;
    actual: { edges: readonly TimedEdge[]; nodeIds: readonly string[] };
    /** Die Route des guten Wetters: ohne Fenster und ohne den Boden der Jahreszeit gesucht. */
    fair: { edges: readonly TimedEdge[]; nodeIds: readonly string[] };
    nodeName: (id: string) => string;
}): RouteClosure | null {
    const { model, timing, actual, fair, nodeName } = input;
    const fairClock: ClockOptions = { seasonGround: false };
    const found = closedWaysOn(model, timing, fair, input.start, nodeName, fairClock);
    // Nur benennbare Wege: ein namenloses Stück einer Route, die der Reisende nicht fährt, sagt ihm nichts.
    const avoided = [...found.values()].filter((way) => way.path_name.trim() !== "");
    if (avoided.length === 0) return null;
    const diverges = divergence(actual, fair, input.startNode);
    return {
        leg_index: input.legIndex,
        blocked: false,
        avoided_anyway: true,
        diverges_at_node: nodeName(diverges.node),
        diverges_at_node_id: diverges.node,
        diverges_at_edge_id: diverges.edge,
        avoided: avoided.map(withoutKey),
        actual: figures(model, timing, actual.edges, input.start),
        unrestricted: figures(model, timing, fair.edges, input.start, fairClock),
    };
}

/**
 * Der Bericht einer Etappe, deren Suche eine Sperre berührt hat (Legacy `closures.php`): Nur wenn die
 * Route ohne Fenster billiger wäre oder es mit Fenstern gar keine gibt, und nur wenn die Route ohne
 * Fenster wirklich über einen gesperrten Weg führt. Sonst null.
 */
export function closureReport(input: {
    model: TravelModel;
    timing: RouteTiming;
    legIndex: number;
    start: TravelClock;
    startNode: string;
    actual: { edges: readonly TimedEdge[]; nodeIds: readonly string[]; cost: number } | null;
    unrestricted: { edges: readonly TimedEdge[]; nodeIds: readonly string[]; cost: number };
    nodeName: (id: string) => string;
}): RouteClosure | null {
    const { model, timing, actual, unrestricted, nodeName } = input;
    if (actual && !(unrestricted.cost < actual.cost - 1e-9)) return null;
    const avoided = closedWaysOn(model, timing, unrestricted, input.start, nodeName);
    if (avoided.size === 0) return null;
    // Die erste Kante der offenen Route, die von der gesperrten abweicht.
    const diverges = actual ? divergence(actual, unrestricted, input.startNode) : null;
    const divergesNode = diverges?.node ?? input.startNode;
    const divergesEdge = diverges?.edge ?? "";
    return {
        leg_index: input.legIndex,
        blocked: actual === null,
        diverges_at_node: nodeName(divergesNode),
        diverges_at_node_id: divergesNode,
        diverges_at_edge_id: divergesEdge,
        avoided: [...avoided.values()].map(withoutKey),
        actual: actual ? figures(model, timing, actual.edges, input.start) : null,
        unrestricted: figures(model, timing, unrestricted.edges, input.start),
    };
}
