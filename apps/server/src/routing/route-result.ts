import { werte } from "./einstellungen.ts";
import {
    CLOCK_START,
    hurryBlockedByGround,
    hurryBlockingLandscapes,
    hurryFactor,
    hurryPacedHours,
    isSnowCondition,
    parseMapPointId,
    routeDomain,
    stageDayHours,
    travelDayHours,
    travelHoursFromTime,
    type RouteClosure,
    type RouteSeasonalWay,
    type RouteSegment,
    type RouteSegmentSlope,
    type TravelModel,
} from "@avesmaps3d/shared";
import { lineTouchesGroundTypes, NO_GROUND } from "./ground.ts";
import { compactProfile, pathElevationProfile, profilePointLimit, type ProfilePoint } from "./elevation-profile.ts";
import { waterSurfaceProfile } from "./water-profile.ts";
import { seasonalWays, type RouteTiming } from "./closures.ts";
import { RouteDisplay } from "./display.ts";
import type { RouteLink, RouteNetwork } from "./network.ts";
import { lineShape, type TerrainHeights } from "./relief.ts";
import { SLICE_PREFIX, type RequestGraph } from "./request-graph.ts";
import { SYNTHETIC_TYPE, type Edge, type GraphBase, type OffroadTerrain, type RouteRefusal } from "./route-edge.ts";
import type { Ground } from "./ground.ts";
import type { FoundLegs } from "./route-search.ts";
import { slopeShape, type SlopeShape } from "./slope.ts";

/**
 * Stufe 4 des Routers (Hardening Review M7): die Ergebnisbildung. Aus den gefundenen Etappen (`FoundLegs`) macht
 * `assembleRoute` die Abschnitte in Legacys Form (`segments`), ihre Zeiten, Etappen und Steigung. Die Antwort
 * trägt ihre Abschnitte so, dass die Etappenrechnung aus genau dieser Folge ihre Etappen baut - Landabschnitte
 * einzeln, gleichartige Wasserabschnitte zusammen. Wer dieselben Abschnitte liefert, bekommt dieselben Etappen.
 *
 * Diese Stufe sucht nichts: Sie liest die gefundene Route und, was sie zum Zeichnen braucht, aus der Spur des
 * Anfragegraphen (`RouteTrace`).
 */

/** Eine Etappe zwischen zwei Wegpunkten: ihr Ausschnitt aus `segments`. */
export interface RouteLegResult {
    from: string;
    to: string;
    segmentStart: number;
    segmentCount: number;
    distanceUnits: number;
    travelHours: number;
}

export interface RouteResult {
    found: boolean;
    /** Die Knoten der Route, als Ids; Fußpunkte heißen `__wp_anchor_<n>`. */
    nodeIds: string[];
    segments: RouteSegment[];
    distanceUnits: number;
    cost: number;
    /** Reisestunden ohne Querfeldein-Aufschlag. */
    travelHours: number;
    travelDays: number;
    /** Die Etappe, an der eine Kette von Zwischenzielen scheiterte. */
    failedLegIndex: number | null;
    legs: RouteLegResult[];
    /** Ein Kartenpunkt, der nicht zu erreichen ist, und warum (`MAP_POINT_REFUSALS`). */
    refused: RouteRefusal | null;
    /** Mehr Seereisen als `ROUTE_FREE_SEA_LIMIT`: `sea_legs:<n>`; die Suche hat abgebrochen. */
    tooLarge: string | null;
    /** Mit Reisebeginn: Die Route gibt es nur über gesperrte Wege (WI-0038). */
    seasonClosed: boolean;
    /** Mit Reisebeginn: die Stunden seit dem Aufbruch bei der Ankunft, samt Rast. */
    arrivalHours: number | null;
    /** Mit Reisebeginn: die umgangenen oder sperrenden Wege je Etappe. */
    closures: RouteClosure[];
    /** Ohne Reisebeginn: die Wege der Route mit Sperrzeiten. */
    seasonalWays: RouteSeasonalWay[];
}

/** Wie ein Kartenpunkt in den Abschnitten heißt; die Oberfläche nennt ihn nach seiner Gegend. */
export const MAP_POINT_NAME = "Kartenpunkt";

/**
 * Ein leeres Ergebnis: nichts gefunden, nichts abgelehnt, nichts gerechnet. Jeder Aufruf gibt frische Listen -
 * ein gemeinsames Objekt teilte sie zwischen allen Ergebnissen, und wer eines verändert, veränderte alle.
 */
export function emptyResult(): RouteResult {
    return {
        found: false,
        nodeIds: [],
        segments: [],
        distanceUnits: 0,
        cost: 0,
        travelHours: 0,
        travelDays: 0,
        failedLegIndex: null,
        legs: [],
        refused: null,
        tooLarge: null,
        seasonClosed: false,
        arrivalHours: null,
        closures: [],
        seasonalWays: [],
    };
}

/**
 * Wie ein Bericht einen Knoten nennt: der Ort, der Kartenpunkt, sonst nichts (technischer Knoten, Fußpunkt). Der Sperrbericht
 * und die Wege mit Sperrzeit nennen ihre Stationen so.
 */
export function reportName(network: RouteNetwork, genannt?: ReadonlySet<string>): (id: string) => string {
    return (id) => {
        const node = network.nodes.get(id);
        // Entrückt (WI-0128 E21): kein Name, wie ein technischer Knoten - auch nicht im Vermerk einer Sperre. 🔴 Außer die
        // Anfrage NENNT ihn (Start, Ziel, Zwischenziel): Wer ihn eingegeben hat, hat ihn gefunden, wie bei den Brücken und den
        // Etappen (`route-stages.ts`, `visible`). Sonst stünde im Reiseplan „nach X“ und im Vermerk derselben Etappe „ab ''“.
        if (node?.kind === "place") return node.isWithdrawn === true && genannt?.has(id) !== true ? "" : node.name;
        return parseMapPointId(id) ? MAP_POINT_NAME : "";
    };
}

/**
 * Was die Ergebnisbildung vom Anfragegraphen liest: die Seekanten zeichnen (`drawSeaEdge`), die Stücke geteilter
 * Wege wieder zusammenfügen (`roots`, `exitAnchors`) und die Kurve unter einem Anker finden (`anchorPaths`).
 */
export type RouteTrace = Pick<RequestGraph, "drawSeaEdge" | "roots" | "exitAnchors" | "anchorPaths">;

/**
 * Fährt die Route durch den Anker eines Ausstiegs nur hindurch, werden die Stücke des Weges davor und
 * danach wieder ein Abschnitt (WI-0030 q). Jeder Ausstieg eines Kartenpunkts teilt einen Weg, auch
 * einer, den das Netz nicht nimmt; sonst stünde mitten auf dem Weg eine „Kreuzung“ und im Reiseplan
 * eine Etappe mehr. Der Abschnitt behält die Kennung seines ersten Stücks in Wegrichtung.
 * 🔴 Nur Ausstiege: Die Anker eines Wegpunkts ohne Landweg bleiben Etappengrenzen wie in Legacy - dort
 * misst `compare:routing` die Etappen (WI-0017), und Legacy teilt genauso.
 */
function joinPassedAnchors(
    view: Pick<RouteTrace, "roots" | "exitAnchors">,
    route: { nodeIds: string[]; edges: Edge[]; legSizes: number[] },
    model: TravelModel,
): { nodeIds: string[]; edges: Edge[]; legSizes: number[] } {
    const nodeIds = route.nodeIds.slice(0, 1);
    const edges: Edge[] = [];
    const legSizes: number[] = [];
    let index = 0;
    for (const size of route.legSizes) {
        const start = edges.length;
        for (const end = index + size; index < end; index += 1) {
            const edge = route.edges[index] as Edge;
            const next = route.nodeIds[index + 1] as string;
            const previous = edges.length > start ? edges[edges.length - 1] : undefined;
            const root = view.roots.get(edge.link);
            const through = nodeIds[nodeIds.length - 1] as string;
            if (
                !previous ||
                !root ||
                view.roots.get(previous.link) !== root ||
                previous.forward !== edge.forward ||
                !view.exitAnchors.has(through)
            ) {
                edges.push(edge);
                nodeIds.push(next);
                continue;
            }
            const [first, second] = edge.forward ? [previous.link, edge.link] : [edge.link, previous.link];
            const link: RouteLink = {
                ...first,
                to: second.to,
                coordinates: [...first.coordinates, ...second.coordinates.slice(1)],
                distance: first.distance + second.distance,
            };
            if (first.span && second.span) link.span = { from: first.span.from, to: second.span.to };
            view.roots.set(link, root);
            const time = previous.time + edge.time;
            const joined: Edge = {
                ...previous,
                to: edge.to,
                link,
                distance: previous.distance + edge.distance,
                time,
            };
            const ground = joinedGround(previous, edge);
            if (ground) joined.ground = ground;
            else delete joined.ground;
            const snow = joinedSnow(model, previous, edge);
            if (snow) joined.snow = snow;
            else delete joined.snow;
            // Die Mehrzeit durch Steigung beider Stücke (S5d).
            const level = previous.time * (previous.levelRatio ?? 1) + edge.time * (edge.levelRatio ?? 1);
            if (time > 0 && (previous.levelRatio !== undefined || edge.levelRatio !== undefined)) {
                joined.levelRatio = level / time;
            }
            edges[edges.length - 1] = joined;
            nodeIds[nodeIds.length - 1] = next;
        }
        legSizes.push(edges.length - start);
    }
    return { nodeIds, edges, legSizes };
}

/**
 * Die Steigung eines Abschnitts (WI-0049 S5d), nur wo er Höhen trägt: ein Landweg mit Wegprofil (bei einem
 * geteilten Weg nur sein Teil) oder querfeldein durch Gebirge oder Gipfelkegel, abgetastet wie die
 * Wegprofile. Der steilste Abschnitt gilt über `steigung.anzeigeFensterSchritt`. Die Mehrzeit sind die
 * Reisestunden minus dieselben Stunden, wenn jeder Abtastschritt eben wäre - nie negativ.
 */
function segmentSlope(
    edge: Edge,
    hours: number,
    coordinates: readonly [number, number][],
    heights: TerrainHeights | null,
    model: TravelModel,
    profile: ProfilePoint[],
): RouteSegmentSlope | undefined {
    const window = model.steigung.wert.anzeigeFensterSchritt;
    // 🪤 EINMAL je Abschnitt gelesen, nicht je Abtastschritt (WI-0153).
    const schritt = werte().schrittPerUnit;
    let shape: SlopeShape | null = null;
    if (edge.synthetic) {
        shape = heights
            ? lineShape(heights, coordinates, window, (position, height) => profile.push([position / schritt, height]))
            : null;
    } else if (edge.link.slope && routeDomain(edge.link.subtype) === "land") {
        const span = edge.link.span;
        profile.push(...pathElevationProfile(edge.link.slope, edge.forward, edge.link.distance, span));
        shape = slopeShape(
            edge.link.slope,
            edge.forward,
            span ? { from: span.from * schritt, to: span.to * schritt } : null,
            window,
        );
    }
    if (!shape) return undefined;
    return {
        ascent_schritt: shape.ascent,
        descent_schritt: shape.descent,
        highest_schritt: shape.highest,
        steepest_grade: shape.steepest,
        extra_hours: Math.max(0, hours * (1 - (edge.levelRatio ?? 1))),
    };
}

/** Der Boden zweier zusammengefügter Stücke: der Faktor über beide, der Zustand des längeren (WI-0038). */
function joinedGround(a: Edge, b: Edge): Edge["ground"] {
    if (!a.ground && !b.ground) return undefined;
    const plain = a.time / (a.ground?.factor ?? 1) + b.time / (b.ground?.factor ?? 1);
    const main = a.ground && (!b.ground || a.time >= b.time) ? a.ground : (b.ground as NonNullable<Edge["ground"]>);
    return { condition: main.condition, factor: (a.time + b.time) / plain };
}

/**
 * Was Schnee und Eis an einer Kante kosten (WI-0065 Nachtrag 2026-10-04): `time` minus dieselbe Zeit ohne den Boden der
 * Jahreszeit, nur wo dieser Boden Schnee oder Eis ist (`isSnowCondition`), in Einheiten von `time`. Dieselbe Rechnung,
 * mit der die Suche die Kante verlängert hat (`route-search.ts`: Zeit × Faktor des Bodens); null ohne Schnee und Eis.
 */
function snowOf(model: TravelModel, edge: Edge): NonNullable<Edge["snow"]> | null {
    if (edge.snow) return edge.snow;
    const { ground } = edge;
    if (!ground || !isSnowCondition(model, ground.condition)) return null;
    const time = edge.time - edge.time / ground.factor;
    return time > 0 ? { condition: ground.condition, time } : null;
}

/** Schnee und Eis zweier zusammengefügter Stücke: die Zeit beider, der Zustand des längeren mit Schnee (wie `joinedGround`). */
function joinedSnow(model: TravelModel, a: Edge, b: Edge): Edge["snow"] {
    const first = snowOf(model, a);
    const second = snowOf(model, b);
    if (!first || !second) return first ?? second ?? undefined;
    const main = a.time >= b.time ? first : second;
    return { condition: main.condition, time: first.time + second.time };
}

/** Was `assembleRoute` braucht: die gefundene Route und den Rahmen der Anfrage. */
/**
 * Zieht die Linie eines Abschnitts bis an die Knoten, an denen er im Graphen haengt.
 *
 * 💣 **Befund des Betreibers 2026-10-14** (Bild Kaldenberg → Tsafelde): Die gezeichnete Route begann 0,39 Einheiten NEBEN
 * Kaldenberg. Der Grund ist die Ortsanbindung: Ein Wegende haengt an einem Ort, sobald es in dessen Kasten ±0,5 liegt
 * (`ENDPOINT_BOX`), aber die gespeicherte Linie beginnt dort, wo der Weg gezeichnet ist — nicht am Ort. Die Antwort trug
 * deshalb eine Linie, die neben dem Startpunkt schwebte, und bis zu einer halben Einheit je Ende fehlte in der Strecke.
 *
 * 🪤 Nur Knoten mit Lage und nur ueber eine Mindestluecke: Ein technischer Knoten liegt ohnehin auf der Linie, und ein
 * Punkt, der nur in der sechsten Stelle abweicht, wuerde die Geometrie mit Nullschritten fuellen.
 *
 * Die zusaetzliche Strecke gehoert zur Etappe, nicht in ein eigenes Segment (Betreiber: „sind keine eigenen segmente“).
 *
 * 💣 **Unter `NODE_SNAP` wird der Endpunkt ERSETZT, nicht davorgesetzt** (Befund 2026-10-14,
 * `discovery/seegraph-kehren-2026-10-14.md`, Betreiberfreigabe 2026-10-15): Eine freie Seereise beginnt und endet
 * genau auf dem Hafenort (`SeaFleet.line`), ein Landweg dort, wo er gezeichnet ist. An Tschorkeffskoje liegen
 * dazwischen 0,002 Einheiten, an Paavi 0,005 - und dieser winzige Schritt zeigt entgegen der Fahrtrichtung. Die Karte
 * zeichnet den Abschnitt als Catmull-Rom ueber seine Linie (`segmentShape`), und dort schlug die Kurve am Mikroschritt
 * 0,080 beziehungsweise 0,042 Einheiten aus: das Vierzigfache des Schritts, der sie ausloest. Wird der Punkt ersetzt,
 * bleibt die Kurve glatt und der Scheitel verschwindet.
 *
 * 🪤 Nur unter dieser Schwelle. Ein Wegende, das 0,33 oder 0,5 Einheiten neben dem Ort haengt (`ENDPOINT_BOX`), ist ein
 * echtes Stueck Weg: Dort bleibt es ein eigener Punkt, und die Strecke zaehlt es (WI-0147).
 *
 * 🔴 Die Strecke folgt in jedem Fall der GELIEFERTEN Linie: Beim Davorsetzen ist `extra` die Luecke, beim Ersetzen die
 * Aenderung des ersten beziehungsweise letzten Stuecks - sie kann dann auch knapp negativ sein.
 *
 * 🔴 **Ein davorgesetzter Punkt ist ein Anschlussstueck und wird gemeldet** (`stubStart`/`stubEnd`, WI-0147): Die Karte
 * nimmt ihn aus der Glaettung, weil die Catmull-Rom-Tangente sonst ueber das kurze Endstueck hinausschiesst
 * (`segmentShape`, Messung 2026-10-15). Ein ERSETZTER Punkt ist keines: Dort geht die Rohlinie selbst bis zum Knoten.
 */
export function toNodes(
    line: readonly (readonly [number, number])[],
    from: { x: number; y: number } | undefined,
    to: { x: number; y: number } | undefined,
): { line: [number, number][]; extra: number; stubStart: boolean; stubEnd: boolean } {
    const punkte = line.map((point) => [point[0], point[1]] as [number, number]);
    if (punkte.length === 0) return { line: punkte, extra: 0, stubStart: false, stubEnd: false };
    const weit = (a: readonly [number, number], b: { x: number; y: number }): number =>
        Math.hypot(a[0] - b.x, a[1] - b.y);
    const stueck = (a: readonly [number, number], b: readonly [number, number]): number =>
        Math.hypot(a[0] - b[0], a[1] - b[1]);
    let extra = 0;
    let stubStart = false;
    let stubEnd = false;
    const kopf = punkte[0] as [number, number];
    const kopfLuecke = from === undefined ? 0 : weit(kopf, from);
    if (from && kopfLuecke > werte().nodeGap) {
        // 🪤 Ersetzen braucht einen Nachbarpunkt: Eine Linie aus EINEM Punkt verlore sonst den Knoten der Gegenseite.
        const nachbar = punkte[1];
        if (kopfLuecke < NODE_SNAP && nachbar) {
            extra += stueck([from.x, from.y], nachbar) - stueck(kopf, nachbar);
            punkte[0] = [from.x, from.y];
        } else {
            extra += kopfLuecke;
            punkte.unshift([from.x, from.y]);
            stubStart = true;
        }
    }
    const fuss = punkte[punkte.length - 1] as [number, number];
    const fussLuecke = to === undefined ? 0 : weit(fuss, to);
    if (to && fussLuecke > werte().nodeGap) {
        const nachbar = punkte[punkte.length - 2];
        if (fussLuecke < NODE_SNAP && nachbar) {
            extra += stueck([to.x, to.y], nachbar) - stueck(fuss, nachbar);
            punkte[punkte.length - 1] = [to.x, to.y];
        } else {
            extra += fussLuecke;
            punkte.push([to.x, to.y]);
            stubEnd = true;
        }
    }
    return { line: punkte, extra, stubStart, stubEnd };
}

/** Ab dieser Luecke wird die Linie an den Knoten gezogen; darunter ist sie schon dort (Rundung der fuenften Stelle). */
export const NODE_GAP = 0.0005;

/**
 * Bis zu dieser Luecke ERSETZT der Knoten den Endpunkt der Linie, darueber kommt er davor.
 *
 * 0,01 Einheiten sind 30 Schritt: unter jeder Sichtbarkeit auf der Karte, und weit unter dem, was ein Wegende neben
 * einem Ort an echtem Weg bedeuten kann (`ENDPOINT_BOX` laesst 0,5 zu, gemessen kommen 0,2 bis 0,5 vor).
 */
const NODE_SNAP = 0.01;

export interface RouteAssembly {
    network: RouteNetwork;
    graph: Pick<GraphBase, "model" | "sea">;
    /** Die Spur des Anfragegraphen (`RouteTrace`). */
    trace: RouteTrace;
    stations: readonly string[];
    /** Die gefundenen Etappen (`findLegs`). */
    route: FoundLegs;
    terrain: OffroadTerrain;
    timing: RouteTiming | null;
    /** Mit Reisebeginn: die Sperrberichte der Etappen, deren Suche eine Sperre berührt hat; sonst leer. */
    closures: RouteClosure[];
    /** Eiltempo (WI-0078): Es wirkt erst hier, auf die schon gefundene Route - nie auf die Wegwahl. */
    hurry?: HurryPace | null;
}

/**
 * Eiltempo an einer Anfrage (WI-0078): Da das Eiltempo an REISETAGEN rechnet, braucht es den Reisetag des Planers -
 * dieselbe Zahl, mit der Rast, Etappenplan und Ankunft rechnen (`stageDayHours`). Fehlt das Objekt, ist der Haken aus.
 */
export interface HurryPace {
    hoursPerDay: number;
}

/**
 * Der Eilfaktor eines Abschnitts (WI-0078), oder 1. Er greift nur auf der gefundenen Route und ändert allein ihre
 * Zeit; die Kantenfolge hat die Suche längst bestimmt. Es ist der VOLLE Faktor der Geographia - was davon an diesem
 * Punkt der Reise gilt, entscheidet die Taktung am Reisetag (`hurryPacedHours`).
 *
 * Alles, was ihn verhindert, steht im Reisemodell (`eiltempo`), nichts davon im Code:
 * - **Wegart und Mittel** (`eiltempo.mittel`): Reichsstraße, Straße, Weg - Pfad und Wüstenpfad nur zu Fuß;
 *   Gebirgspass, Querfeldein, Fluss, Meer und Flug stehen in keiner Liste und eilen nie.
 * - **Boden** (`bodenSperre`): aufgeweicht, Tiefschnee, Eis - der Schlitten ist von Schnee und Eis ausgenommen.
 *   Über der Schneegrenze trägt die Kante denselben Boden als `snow`, also fängt dieselbe Prüfung sie ab.
 * - **Landschaft** (`landschaftSperre`): berührt der Abschnitt Sumpf, Dschungel, Urwald oder Regenwald, eilt er nicht.
 */
function segmentHurryFactor(
    model: TravelModel,
    edge: Edge,
    coordinates: readonly [number, number][],
    ground: Ground,
): number {
    const type = edge.synthetic ? SYNTHETIC_TYPE : edge.link.subtype;
    const base = hurryFactor(model, edge.transport, type);
    if (!(base > 1)) return 1;
    if (edge.ground && hurryBlockedByGround(model, edge.transport, edge.ground.condition)) return 1;
    if (edge.snow && hurryBlockedByGround(model, edge.transport, edge.snow.condition)) return 1;
    if (lineTouchesGroundTypes(coordinates, ground, hurryBlockingLandscapes(model))) return 1;
    return base;
}

/**
 * Baut das Ergebnis einer gefundenen Route: die freie Seefahrt bekommt ihre Linie, die Stücke durchfahrener Anker
 * werden wieder ein Abschnitt, und jeder Abschnitt trägt Zeit, Linie und, wo es sie gibt, Steigung. Danach die
 * Etappen und die Summen.
 */
export function assembleRoute({
    network,
    graph,
    trace,
    stations,
    route,
    terrain,
    timing,
    closures,
    hurry = null,
}: RouteAssembly): RouteResult {
    const { model } = graph;
    const placeName = reportName(network, new Set(stations));
    /**
     * Wo ein Knoten liegt - fuer das Heranziehen der Linie (`toNodes`). Technische Knoten des Anfragegraphen stehen nicht
     * im Netz; sie liegen ohnehin auf der Linie, also genuegt `undefined`.
     */
    const nodeAt = (id: string): { x: number; y: number } | undefined => network.nodes.get(id);
    // Die freie Seefahrt bekommt ihre Linie erst jetzt, nur für die Seereisen der Route.
    const drawnRoute = graph.sea
        ? { ...route, edges: route.edges.map((edge) => (edge.freeSea ? trace.drawSeaEdge(edge) : edge)) }
        : route;
    const { nodeIds, edges, legSizes } = joinPassedAnchors(trace, drawnRoute, model);
    const { cost } = route;

    const name = (id: string): string => network.nodes.get(id)?.name ?? (parseMapPointId(id) ? MAP_POINT_NAME : id);
    const drawn = new RouteDisplay(network.paths);
    /** Die gezeichnete Linie, wo sie von der Rohlinie abweicht (`display.ts`); sonst null. */
    const displayOf = (edge: Edge, coordinates: [number, number][]): [number, number][] | null => {
        // Die freie Seefahrt kommt gezeichnet vom Rechner.
        if (edge.display && !edge.synthetic) return edge.display;
        if (!edge.synthetic) {
            if (!edge.link.id.startsWith(SLICE_PREFIX)) return null;
            const piece = drawn.piece(edge.link.pathPublicId, edge.link.coordinates);
            return piece && (edge.forward ? piece : piece.reverse());
        }
        const onCurve = (node: string, [x, y]: [number, number]): [number, number] | null => {
            const path = trace.anchorPaths.get(node);
            const point = path === undefined ? null : drawn.pointOn(path, x, y);
            // Auf einem geraden Stück liegt der Kurvenpunkt auf dem rohen - dann gibt es nichts zu zeichnen.
            return point && Math.hypot(point[0] - x, point[1] - y) > 1e-9 ? point : null;
        };
        const from = edge.forward ? edge.link.from : edge.link.to;
        const to = edge.forward ? edge.link.to : edge.link.from;
        const start = onCurve(from, coordinates[0] as [number, number]);
        const end = onCurve(to, coordinates[coordinates.length - 1] as [number, number]);
        // Ein gesuchter Gang querfeldein kommt mit seiner begradigten Linie (`OffroadPath.display`); sie steht in
        // Fahrtrichtung und beginnt und endet auf denselben Punkten wie `coordinates`.
        const shape = edge.display ?? coordinates;
        if (!start && !end) return edge.display ?? null;
        const line = [...shape];
        if (start) line[0] = start;
        if (end) line[line.length - 1] = end;
        return line;
    };
    let travelHours = 0;
    let travelDays = 0;
    let distanceUnits = 0;
    const profileLimit = profilePointLimit(edges.length);
    const hurryGround = terrain.ground ?? NO_GROUND;
    /**
     * Der Reisetagzähler der Taktung (WI-0078, Betreiber 2026-10-05 „das was in der GA steht“): gebrochene
     * Reisetage, über Abschnitte, Etappen und Mediengrenzen hinweg, und auch über Abschnitte, die nicht eilen
     * dürfen - ein Pass kostet Reisetage wie jeder andere Abschnitt. Es ist derselbe Zähler, mit dem der
     * Reiseplan rechnet, nur in Fahrtrichtung mitgeführt; eine eigene Wertetafel gibt es nicht.
     */
    let hurryDays = 0;
    /** Die gespeicherte Linie je Abschnitt in Fahrtrichtung - gebraucht wird sie zweimal, deshalb einmal gerechnet. */
    const rohLinien = edges.map((edge) =>
        edge.forward ? edge.link.coordinates : [...edge.link.coordinates].reverse(),
    );
    /**
     * An welchen Naehten die Linie an den KNOTEN gezogen wird (`toNodes`), und an welchen nicht.
     *
     * 💣 **Der Befund des Betreibers** (2026-10-14, Trallop -> Baliho): „wo frueher kreuzungen waren geht er jetzt weiter
     * zu jeder einzelnen stadt entlang der route statt die stadt zu ignorieren und weiterzugehen.“ Stossen zwei
     * Wegstuecke Ende auf Ende NEBEN einem Ort, nimmt der Ortskasten +-0,5 den Treffpunkt auf. Zog die Antwort beide
     * Stuecke an den Ort (so seit `cfc3ffe9`), zeichnete sie einen Stichweg mit Kehrtwende und schrieb 2 x 0,33 Einheiten
     * in die Strecke.
     *
     * 🔴 **Die Regel ist deshalb nahtweise, nicht pauschal** (WI-0147, gemessen ueber 206 Routen):
     *
     * - **Am Anfang und am Ende der Reise und an jedem Zwischenziel wird gezogen.** Dort steht der Reisende wirklich, und
     *   der Betreiber hat die durchgehende Verbindung ausdruecklich verlangt (Kaldenberg -> Tsafelde, `cfc3ffe9`).
     * - **Treffen die beiden Linien an einer Naht aufeinander, wird NICHT gezogen.** Die Durchfahrt bleibt auf der
     *   gezeichneten Strasse, der Ort wird passiert statt befahren. Das nimmt 2.885 Kehrtwenden auf Legacys Hoehe zurueck.
     * - **Klafft an der Naht eine Luecke, wird gezogen.** Dann verbindet der Ort die beiden Wege wirklich, und die Reise
     *   fuehrt durch ihn hindurch; ohne Ziehen klaffte ein Riss in der blauen Linie (gemessen: 180 von 206 Routen, bis zu
     *   0,88 Einheiten an Orten wie Ginsterfeld und Gut Stockau).
     *
     * 🪤 Die Reisezeit haengt an keiner dieser Entscheidungen - sie kommt aus den Kanten. Gezogen wird die LINIE, und die
     * zusaetzliche Strecke geht auf `distance_units` des Abschnitts.
     */
    const wegpunkte = new Set(stations);
    const zieht = edges.map(() => ({ anfang: false, ende: false }));
    if (zieht.length > 0) {
        (zieht[0] as { anfang: boolean }).anfang = true;
        (zieht[zieht.length - 1] as { ende: boolean }).ende = true;
    }
    for (let naht = 1; naht < edges.length; naht += 1) {
        const davor = rohLinien[naht - 1] as readonly (readonly [number, number])[];
        const danach = rohLinien[naht] as readonly (readonly [number, number])[];
        const letzter = davor[davor.length - 1];
        const erster = danach[0];
        const knoten = (edges[naht] as Edge).forward ? (edges[naht] as Edge).link.from : (edges[naht] as Edge).link.to;
        const klafft =
            letzter === undefined ||
            erster === undefined ||
            Math.hypot(letzter[0] - erster[0], letzter[1] - erster[1]) > werte().nodeGap;
        if (!klafft && !wegpunkte.has(knoten)) continue;
        (zieht[naht - 1] as { ende: boolean }).ende = true;
        (zieht[naht] as { anfang: boolean }).anfang = true;
    }
    const segments = edges.map((edge, index): RouteSegment => {
        const from = edge.forward ? edge.link.from : edge.link.to;
        const to = edge.forward ? edge.link.to : edge.link.from;
        const roh = rohLinien[index] as [number, number][];
        const zug = zieht[index] as { anfang: boolean; ende: boolean };
        const {
            line: coordinates,
            extra: lueckeUnits,
            stubStart,
            stubEnd,
        } = toNodes(roh, zug.anfang ? nodeAt(from) : undefined, zug.ende ? nodeAt(to) : undefined);
        // Eiltempo (WI-0078): erst hier, auf die fertige Abschnittszeit - also auch auf das, was Steigung und
        // Boden darin kosten (Betreiber 2026-10-05, F2 = ja: eine Regel, eine Rechnung). Die Taktung verteilt den
        // Abschnitt auf Eil- und gewöhnliche Reisetage und teilt ihn an der Tagesgrenze.
        const normalHours = travelHoursFromTime(model, edge.time / edge.costFactor);
        const paced = hurry
            ? hurryPacedHours(model, {
                  hours: normalHours,
                  dayHours: stageDayHours(model, edge.transport, hurry.hoursPerDay),
                  factor: segmentHurryFactor(model, edge, coordinates, hurryGround),
                  days: hurryDays,
              })
            : null;
        const hurryBy = paced?.factor ?? 1;
        const hours = paced?.hours ?? normalHours;
        if (paced) hurryDays = paced.days;
        travelHours += hours;
        travelDays += hours / travelDayHours(model, edge.transport);
        const segmentUnits = edge.link.distance + lueckeUnits;
        distanceUnits += segmentUnits;
        const display = displayOf(edge, coordinates);
        const profile: ProfilePoint[] = [];
        const slope = segmentSlope(edge, hours, coordinates, terrain.heights ?? null, model, profile);
        // Was Schnee und Eis davon kosten (WI-0065 Nachtrag 2026-10-04); `hours` enthält sie schon.
        const snow = snowOf(model, edge);
        // Fluss, Binnensee und Meer: die Linie im Höhenmodell, zur Antwortzeit abgetastet (WI-0065 Nachtrag 2026-10-03).
        // Keine Steigung und keine Zeit: `slope` bleibt für Wasser leer, die Zusammenfassung der Reise ist Land.
        const water = waterSurfaceProfile(
            edge.link.subtype,
            coordinates,
            edge.link.distance,
            terrain.heights,
            profileLimit,
        );
        const measured = profile.some((point) => point[1] !== null);
        return {
            index,
            edge_id: edge.link.id,
            public_id: edge.link.pathPublicId,
            from_node: name(from),
            to_node: name(to),
            from_node_id: from,
            to_node_id: to,
            subtype: edge.link.subtype,
            path_name: edge.link.pathName,
            transport_type: edge.transport,
            distance_units: segmentUnits,
            cost_units: edge.time,
            cost_factor: edge.costFactor,
            travel_hours: hours,
            flow_time_factor: edge.flowFactor,
            flow_state: edge.flowState,
            ...(edge.ground ? { ground: { condition: edge.ground.condition, factor: edge.ground.factor } } : {}),
            ...(snow
                ? {
                      snow: {
                          condition: snow.condition,
                          extra_hours: travelHoursFromTime(model, snow.time / edge.costFactor) / hurryBy,
                      },
                  }
                : {}),
            ...(slope ? { slope } : {}),
            ...(hurryBy > 1 ? { hurry_factor: hurryBy } : {}),
            ...(water
                ? { elevation_profile: water.profile, elevation_surface: water.surface }
                : measured
                  ? { elevation_profile: compactProfile(profile, profileLimit), elevation_surface: "land" as const }
                  : {}),
            ...(timing ? { climate_zone: timing.climate.zoneOf(coordinates) } : {}),
            synthetic: edge.synthetic,
            offroad: edge.offroad,
            geometry: { type: "LineString", coordinates },
            ...(display ? { display: { type: "LineString" as const, coordinates: display } } : {}),
            // 🪤 Nur wenn es eines gibt: Die Antwort traegt das Feld sonst 11.500 Mal ohne Inhalt.
            ...(stubStart || stubEnd ? { joints: { start: stubStart, end: stubEnd } } : {}),
        };
    });
    let segmentStart = 0;
    const legs = legSizes.map((segmentCount, index): RouteLegResult => {
        const own = segments.slice(segmentStart, segmentStart + segmentCount);
        const leg = {
            from: stations[index] as string,
            to: stations[index + 1] as string,
            segmentStart,
            segmentCount,
            distanceUnits: own.reduce((sum, segment) => sum + segment.distance_units, 0),
            // 🔴 Die schon gerechnete Zeit der Abschnitte, nicht noch einmal aus `cost_units` (WI-0078 §5.6): Ohne
            // Eiltempo ist das dieselbe Rechnung, mit Eiltempo wäre die zweite Fassung die ungeeilte.
            travelHours: own.reduce((sum, segment) => sum + segment.travel_hours, 0),
        };
        segmentStart += segmentCount;
        return leg;
    });
    return {
        found: stations.length >= 2,
        nodeIds,
        segments,
        distanceUnits,
        cost,
        travelHours,
        travelDays,
        failedLegIndex: null,
        legs,
        refused: null,
        tooLarge: null,
        seasonClosed: false,
        arrivalHours: timing ? (route.end ?? CLOCK_START).hours : null,
        closures,
        // Ohne Reisebeginn sperrt nichts; genannt werden die Wege der Route mit Sperrzeiten (Owner 14.09.2026).
        seasonalWays: timing ? [] : seasonalWays(model, edges, nodeIds, placeName),
    };
}
