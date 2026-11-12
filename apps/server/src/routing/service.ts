import { performance } from "node:perf_hooks";
import {
    buildRouteStages,
    buildRouteTravelCosts,
    calendarDate,
    countBorderCrossings,
    departureDayOfYear,
    parseMapPointId,
    ROUTE_DEFAULTS,
    ROUTE_RESPONSE_LIMITS,
    routeAirExtra,
    routeHurry,
    routeSlope,
    routeSnow,
    type DepartureMonth,
    type MapPointRefusal,
    type RouteAir,
    type RouteResponse,
    type RouteTravelCosts,
    type StagePlace,
    type TravelModel,
    type Wegfindungswerte,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseWegfindung, wirksameWegfindung } from "../system/wegfindungsstand.ts";
import { modellMitWerten, netzOptionen, setzeWerte, WEGFINDUNG_VORGABEN } from "./einstellungen.ts";
import { airTerrain } from "./air-obstacles.ts";
import { findAirRoute, type AirPoint } from "./air-route.ts";
import { weighedAirFlight } from "./air-weigh.ts";
import { flightProfiles, linienHoehen } from "./water-profile.ts";
import { loadClimate, type ClimateZones } from "./climate.ts";
import { assertUsableNetwork } from "./data-validation.ts";
import { loadGround, type Ground } from "./ground.ts";
import { loadTerrainHeights, type TerrainHeights } from "./relief.ts";
import { loadLand } from "./land.ts";
import { asLandmarkRoute, landmarkStations, type RouteLandmark } from "./landmark-waypoints.ts";
import { loadRouteNetwork, type RouteNetwork, type RouteNode } from "./network.ts";
import {
    changedParts,
    partKey,
    readRoutingRevision,
    revisionKey,
    seaGraphIdentity,
    staleDataParts,
    travelModelVersion,
    type RoutingDataPart,
    type RoutingDataRevision,
    type RoutingRevisionPart,
} from "./revision.ts";
import { loadRivers, type Rivers } from "./rivers.ts";
import { prepareYearRoundBridges } from "./route-graph.ts";
import { vehicleBarrier } from "./vehicle-barrier.ts";
import {
    buildRouteGraph,
    findRoute,
    MAP_POINT_NAME,
    type RouteGraph,
    type RouteRequest,
    type RouteResult,
} from "./router.ts";
import { loadSeaRoutes, type StoredSeaRoutes } from "./sea-derive.ts";
import { FreeSea } from "./sea-free.ts";
import type { CompactSeaGraph } from "./sea-graph-store.ts";
import { routingSliceBytes } from "./sliced-read.ts";
import { buildPlaceIndex, type PlaceIndex } from "./stage-context.ts";
import { loadTollTerritories, NO_TOLL_TERRITORIES, type TollTerritories } from "./toll-territories.ts";
import { loadWater, type Water } from "./water.ts";

/**
 * Der Rechendienst der Route (WI-0017 R6): hält Wegenetz und Graphen im Speicher und beantwortet
 * Anfragen. Er läuft im Routing-Worker, nie in der Event-Loop des Servers (ADR-0009, Kap. 6.63).
 *
 * - **Netz einmal laden.** Orte, Wege und Wasser kommen aus der Datenbank; das kostet
 *   Zehntel Sekunden und passiert beim ersten Aufruf und nach einer Datenänderung, nie je Route.
 * - **Graph je Profil.** Ein Profil ist die Wahl von Transportmitteln und Wegarten. Die letzten
 *   `maxProfiles` bleiben im Speicher: je Profil rund 5 MB, 8 Profile auf Stage 66 MB Heap (Budget 96 MB je
 *   Worker, Meldung ab 80 MB; WI-0037). Weniger Profile kosteten 0,35–0,39 s Neubau je Wechsel auf dem VPS.
 * - **Veralten erkennen.** Höchstens alle `recheckMs` fragt der Dienst die Revision der Daten ab
 *   (`RoutingDataRevision`, `revision.ts`: je Tabellengruppe ein Teil, wo möglich der Fingerabdruck des
 *   Inhalts, sonst Anzahl und letzte Änderung). Ändert sich ihr Schlüssel, wird neu geladen - ein
 *   Zwischenspeicher ohne sichere Invalidierung ist unzulässig (Kap. 6.64).
 * - **Ein Stand ist ein Schnappschuss** (Hardening Review M6, Kap. 6.15). Revision und Daten eines neuen Stands
 *   liest `load()` in EINER Transaktion (`repeatable read`, nur lesend): Die Revision benennt genau die Daten,
 *   die mit ihr geladen wurden, auch wenn ein Import dazwischen schreibt. Vor der Aktivierung prüft
 *   `data-validation.ts`, dass das Netz überhaupt Routen tragen kann; sonst bleibt der alte Stand.
 * - **Nur laden, was sich geändert hat.** Ein neuer Stand übernimmt vom alten jeden Bestandteil, dessen Revisionsteile
 *   gleich geblieben sind (`staleDataParts`): nach einer Ortsänderung bleiben Gelände (das Raster von 32 MiB), Klima, Wasser,
 *   Land, Flüsse und Boden (WI-0298: die Abschnitte von `map`, `MAP_SEGMENT_INPUTS`), nach einer Wegänderung alles außer Netz und
 *   Flüssen, nach einer Geländeableitung Wasser, Land, Flüsse und Boden dieselben Objekte, samt ihren Zwischenspeichern. Der
 *   Seegraph und der Ortsindex des alten Stands gehen mit, solange ihre Grundlage dieselbe ist (`inherit`).
 * - **Das Gelände wandert auch mit, wenn nur seine Umgebung wechselt** (WI-0071): Der Teil `terrain` zählt auch die
 *   Regionen und Flächen mit; eine Änderung an einer fremden Fläche lädt das Gelände also neu. Der Loader bekommt dazu
 *   den geltenden Stand (`RoutingReads.data`, `reusable`) und liest das Raster nicht noch einmal, solange sein
 *   Fingerabdruck derselbe ist (`terrain-load.ts`). Ein wirklich neues Raster liest er in Scheiben (`sliced-read.ts`):
 *   nie ein zweites Mal die Zeile von 32 MiB als Hexadezimaltext im Speicher. Ein Stand, den keine Anfrage mehr hält,
 *   ist frei; neben dem neuen liegt nur, was sich wirklich geändert hat.
 * - **Neu laden im Hintergrund** (WI-0037, Stufe 2a). Nur der allererste Stand wird im Anfragepfad
 *   geladen. Jeder spätere lädt neben dem alten, samt Graph des Vorwärmprofils, und wechselt dann als
 *   Ganzes; bis dahin rechnet jede Anfrage mit dem alten Stand und nennt ihn in `routing_graph_revision`.
 *   Vorher lud die erste Anfrage nach einem Import im Anfragepfad und lief in die 2 s des Runners.
 * - **Vorbereiten ist EINE Stelle** (WI-0117, `prepare`): Start (`warm`) und Nachladen bereiten denselben Satz vor -
 *   Graph des Profils, seine ganzjährigen Brücken (jede Route mit Reisebeginn), Ortsindex, Flugraster des Geländes -,
 *   und das Nachladen baut außerdem die Profile nach, die der alte Stand in Gebrauch hatte. Gemessen lief die erste
 *   Route mit Reisebeginn nach dem Nachladen sonst 0,5 bis 1,3 s (statt 10 bis 50 ms) und der erste Flug nach einem
 *   neuen Gelände 0,5 s: auf Stage über die 2 s, danach `routing_busy`. 🔴 Wer eine neue Struktur verzögert baut, die
 *   die erste Route eines Stands braucht, trägt sie in `prepare` ein; wer sie nur im Anfragepfad baut, bringt den
 *   Fehler zurück.
 * - **Seegraph erst auf Verlangen.** Die freie Seefahrt (WI-0046, Vergleichsschalter) lädt ihren Seegraphen
 *   beim ersten Aufruf, der sie will: rund 12 MB, die der Worker sonst nicht trägt. Er gilt nur, wenn er zum
 *   Teil `seaGraph` der geladenen Revision passt; ein neuerer Seegraph wartet auf den nächsten Stand.
 * - **Flug ohne Graph** (WI-0051): Mit `air` fliegt die Reise über die Wegpunkte (`air-route.ts`), ohne
 *   Profil; der Zwischenspeicher der Graphen bleibt unberührt. Um die Gebirge über der absoluten Höchstflughöhe
 *   minus Mindestabstand (5.000 − 200 Schritt, für alle Flugmittel gleich, Betreiber 2026-10-04) führt
 *   `air-way.ts` (F2): Je Datenstand merkt er sich beim ersten Flug nur den höchsten Wert jedes Gebirgsrasters;
 *   das Hindernisraster entsteht je Etappe über ihrem Fenster und vergeht mit ihr. Unter dieser Grenze steigt die
 *   Bahn über das Gelände (`flightAltitude`, höchstens Reisehöhe × 1.000 % über dem Boden). F4 (Betreiber
 *   2026-10-04): Fliegen über der Reisehöhe über Grund kostet Zeit (Steigen und Halten, `flightSurcharge`); die Etappe
 *   wägt die Luftlinie gegen die Wege um Gelände über abgestuften Schwellen und nimmt den mit der kürzesten Zeit
 *   (`air-weigh.ts`). Auch dort bleibt nichts je Datenstand außer den 104 Höchstwerten; die Felder jeder Suche
 *   vergehen mit ihr.
 */

export interface RouteQuery extends RouteRequest {
    /** Wer fragt (die Client-IP); die Steuerung begrenzt seine offenen Rechnungen (WI-0037, S-04). */
    client?: string;
    /** Orte (`public_id`), Kartenpunkte (`p:<x>:<y>`) oder Landmarken (`l:<uuid>`) in Reihenfolge: Start, Zwischenziele, Ziel. */
    waypoints: string[];
    /**
     * Die Landmarken unter den Wegpunkten (WI-0271 L6), aufgelöst vom Hauptthread (`WaypointIndex.byIds`): nur aktive, deren Art
     * Reiseziel sein darf. Eine `l:`-Kennung, die hier fehlt, ist `unknown_waypoint`. Ohne Landmarke fehlt das Feld.
     */
    landmarks?: RouteLandmark[];
    /** „Reisestunden pro Tag" an Land; fehlt er, gilt der Landtag des Reisemodells. */
    hoursPerDay?: number;
    /**
     * Eiltempo (WI-0078): Wo Mittel und Abschnitt es zulassen, sinkt die Reisezeit. 🔴 Es steht hier und nicht in
     * `RouteRequest`, weil es weder eine Kante noch den Graphenschlüssel berührt - die Route bleibt dieselbe.
     */
    hurry?: boolean;
    /** Der Reisebeginn (WI-0038), auch an einem Namenlosen Tag; ohne ihn sperrt nichts, und die Etappen tragen kein Datum. */
    departure?: { month: DepartureMonth; day: number };
    /**
     * Der Flug (WI-0051), aufgelöst (`resolveAirQuery`): Die Reise fliegt von Wegpunkt zu Wegpunkt
     * (`air-route.ts`); Optimierung, Mittel, Wegarten und Umstiege der Anfrage gelten dann nicht.
     */
    air?: RouteAir;
}

export type RouteOutcome =
    | { ok: true; response: RouteResponse }
    | { ok: false; error: "unknown_waypoint" | MapPointRefusal | "route_too_large"; detail: string };

export interface RoutingData {
    network: RouteNetwork;
    water: Water;
    /** Kontinent und Inseln - ob ein Kartenpunkt an Land liegt (`land.ts`). */
    land: Water;
    /** Flüsse als Wand, Bäche als Furt - für den Gang zu einem Kartenpunkt (`rivers.ts`). */
    rivers: Rivers;
    /** Wald, Sumpf und die anderen bremsenden Landschaften querfeldein (`ground.ts`, WI-0030 R8). */
    ground: Ground;
    /** Die Klimabänder für den Boden der Jahreszeit (`climate.ts`, WI-0038). */
    climate: ClimateZones;
    /**
     * Das Gelände querfeldein (WI-0049 S5b): das Domain-DEM (`terrain_domain_raster`, 4k oder 8k) mit den
     * Gebirgsflächen und der Eichung je Familie (`TerrainHeights`, `relief.ts`), einmal je Stand, für alle
     * Anfragen geteilt. Null ohne abgeleitetes Gelände; dann rechnet querfeldein wie vorher.
     */
    heights?: TerrainHeights | null;
    /**
     * Die Zollgebiete für die Landesgrenzen der Reise (WI-0065, `toll-territories.ts`): die souveränen Herrschaftsgebiete
     * des Bandes 0. Fehlt das Feld oder ist die Liste leer, ist der Zoll nicht ermittelbar (`null`), nie 0.
     */
    territories?: TollTerritories;
    /**
     * Die wirksamen Kenngrößen der Wegfindung dieses Stands (WI-0153): die Vorgaben des Registers, überschrieben von
     * den gespeicherten Abweichungen. 🔴 Sie gehören zum Schnappschuss, nicht zum Prozess: Der Dienst stellt die
     * Zahlen in `einstellungen.ts` erst um, wenn dieser Stand gilt (`reload`).
     *
     * Fehlt das Feld, gelten die Vorgaben des Registers: Ein nachgebauter Stand (Tests, Werkzeuge) rechnet wie vorher.
     */
    werte?: Wegfindungswerte;
    /**
     * Das Reisemodell dieses Stands: die Datei, überschrieben von den zwei Zahlen, die in der Systemsteuerung stehen
     * (`modellMitWerten`). Jede Rechnung nimmt DIESES Modell, nicht das der Optionen; fehlt es, das der Optionen.
     */
    model?: TravelModel;
    /** Die Revision, zu der genau diese Daten gehören; ihr Schlüssel ist die `routing_graph_revision`. */
    revision: RoutingDataRevision;
}

/**
 * Meldet die Ladezeit eines Schritts in Millisekunden: ein Bestandteil des Datenstands (`network` … `territories`)
 * oder ein Schritt drumherum (`probe`, `revision`, `transaction`, `sea`, `graph`, `index`). Nur für das Journal
 * (`ReloadEvent.parts_ms`); wer sie nicht übergibt, merkt nichts.
 */
export type LoadReport = (part: string, ms: number) => void;

export interface RoutingSource {
    /**
     * Günstig, ohne Transaktion: die Revision der Daten jetzt. Ändert sich ihr Schlüssel, sobald sich Orte,
     * Wege, Wasser, Gelände, Klima oder der Seegraph ändern.
     */
    revision(): Promise<RoutingDataRevision>;
    /**
     * Ein neuer Stand. Seine `revision` ist die, die dieselbe Transaktion gelesen hat wie die Daten - nicht die
     * aus dem letzten `revision()`, die schon wieder überholt sein kann.
     *
     * `previous` ist der geltende Stand: Bestandteile, deren Revisionsteile sich nicht geändert haben
     * (`staleDataParts`), übernimmt die Quelle von dort als dasselbe Objekt, statt sie zu laden. Ohne `previous`
     * lädt sie alles. `report` bekommt die Ladezeit je Bestandteil.
     */
    load(previous?: RoutingData, report?: LoadReport): Promise<RoutingData>;
    /**
     * Der abgeleitete Seegraph der freien Seefahrt (WI-0046); null, solange keiner abgeleitet ist. `seaGraph` ist
     * der Teil der geladenen Revision: Passt der gespeicherte Seegraph nicht dazu (er wurde seither neu abgeleitet),
     * liefert die Quelle null, und die Route fährt über die Seewege, bis der nächste Stand geladen ist.
     */
    loadSea?(seaGraph: string | null): Promise<CompactSeaGraph | null>;
}

export interface RouteServiceOptions {
    mapDomain: string;
    model: TravelModel;
    source: RoutingSource;
    recheckMs?: number;
    /**
     * Ruhe abwarten (WI-0177, Thomas 2.3; Hauptorchestrierung 2026-10-19): Hat sich nur der Teil `map` geändert, lädt der Dienst erst,
     * wenn die Revision so lange still stand, und spätestens `hoechstensMs` nach der ersten gesehenen Änderung. 0 (Vorgabe): sofort.
     */
    ruheMs?: number;
    hoechstensMs?: number;
    maxProfiles?: number;
    /** Die Antwortgrenze (WI-0037, S-10); im Test kleiner. */
    limits?: { segments: number; stages: number };
    now?: () => number;
    /** Ein neuer Stand ist geladen und aktiv; der Worker schreibt es ins Journal. */
    onReload?: (event: ReloadEvent) => void;
    /** Ein Neuladen im Hintergrund ist gescheitert; es gilt weiter der alte Stand. */
    onReloadError?: (error: unknown) => void;
}

export interface ReloadEvent {
    /** Der Schlüssel des neuen Stands (`revisionKey`). */
    revision: string;
    /** Der Stand davor; null beim ersten Laden. */
    previous: string | null;
    /** Welche Teile der Revision sich gegenüber dem Stand davor geändert haben; beim ersten Laden alle. */
    changed: RoutingRevisionPart[];
    /** Prüfen, Laden und Vorbereiten zusammen. */
    ms: number;
    /**
     * Wie sich `ms` aufteilt, in Millisekunden je Schritt (Journal `routing graph loaded`): `probe` (Revision prüfen),
     * `revision` und `transaction` (der Schnappschuss, in dem die Bestandteile gelesen werden), je geladenem Bestandteil
     * `network`, `water`, `land`, `rivers`, `ground`, `climate`, `heights`, `territories`, dann das Vorbereiten
     * (`prepare`): `sea` (Seegraph), `graph` (Graphen der Profile), `year_round` (ihre ganzjährigen Brücken), `index`
     * (Ortsindex) und `air` (Flugraster des Geländes). Übernommene Bestandteile fehlen. Die Schritte liegen
     * zum Teil ineinander (`transaction` enthält die Bestandteile) und ergeben darum nicht `ms`; bei mehreren Profilen
     * steht die Summe.
     */
    parts_ms: Record<string, number>;
    /** Wie viele Profile der neue Stand schon vorbereitet hält: das Vorwärmprofil und die, die der alte in Gebrauch hatte. */
    profiles: number;
}

/** Ein Datenstand mit seinen Graphen: Er wechselt nur als Ganzes, nie Daten ohne ihre Graphen. */
interface Loaded {
    data: RoutingData;
    /** Der Schlüssel seiner Revision - die `routing_graph_revision` jeder Antwort, die auf ihm rechnet. */
    key: string;
    graphs: Map<string, RouteGraph>;
    /** Wie viele Profile er hält; ein Stand, der gerade abgelöst wird, nur noch eines. */
    maxProfiles: number;
}

export class RouteService {
    readonly travelModelVersion: string;
    private readonly options: Required<Omit<RouteServiceOptions, "now" | "onReload" | "onReloadError">> &
        Pick<RouteServiceOptions, "onReload" | "onReloadError"> & { now: () => number };
    private loaded: Loaded | undefined;
    /** Das laufende Prüfen und Laden; es gibt höchstens eines. */
    private refreshing: Promise<Loaded> | undefined;
    private lastCheck = Number.NEGATIVE_INFINITY;
    /** Eine gesehene, noch nicht geladene Änderung allein am Teil `map` (`ruheMs`): seit wann sie ansteht, wann sie zuletzt wechselte. */
    private wartet: { key: string; seit: number; zuletzt: number } | undefined;
    /** Das Profil aus `warm()`: Sein Graph entsteht mit jedem neuen Stand, bevor der Stand gilt. */
    private warmProfile: RouteRequest | undefined;
    private readonly placeIndexes = new WeakMap<RoutingData, PlaceIndex>();
    /** Der Seegraph je Datenstand, geladen beim ersten Aufruf mit freier Seefahrt. */
    private readonly seas = new WeakMap<RoutingData, Promise<FreeSea | null>>();
    /** Der Seegraph, sobald er da ist (und einer gefunden wurde): Nur ihn erbt ein neuer Stand (`inherit`). */
    private readonly loadedSeas = new WeakMap<RoutingData, FreeSea>();

    constructor(options: RouteServiceOptions) {
        this.options = {
            recheckMs: 5000,
            ruheMs: 0,
            hoechstensMs: 0,
            maxProfiles: 8,
            limits: ROUTE_RESPONSE_LIMITS,
            now: () => Date.now(),
            ...options,
        };
        this.travelModelVersion = travelModelVersion(options.model);
    }

    /** Wie viele Profile gerade im Speicher liegen. */
    get profileCount(): number {
        return this.loaded?.graphs.size ?? 0;
    }

    /** Lädt das Netz und den Graphen des häufigsten Profils vorab, damit die erste Route nicht wartet. */
    async warm(request: RouteRequest): Promise<void> {
        this.warmProfile = request;
        await this.prepare(await this.current(), request);
    }

    /**
     * Fragt den Fingerabdruck ab und lädt bei einer Änderung den neuen Stand; bis er fertig ist, gilt
     * der alte. Laufen schon Prüfen oder Laden, bekommt der Aufrufer dasselbe Versprechen.
     */
    async refresh(): Promise<void> {
        await this.latest();
    }

    /**
     * Höhen entlang von Linien im Höhenmodell des geladenen Stands (WI-0245, Profile der Flüsse und Pässe im Reiter „Gebirge“): dieselbe
     * Abtastung wie das Flussbett einer Route, nur Anzeige. `null` ohne Höhenmodell.
     */
    async hoehenEntlang(
        linien: readonly (readonly [number, number])[][],
    ): Promise<({ at: number[]; height: number[] } | null)[] | null> {
        const { heights } = (await this.current()).data;
        if (!heights) return null;
        return linien.map((linie) => linienHoehen(heights, linie));
    }

    async route(query: RouteQuery): Promise<RouteOutcome> {
        // Ein Stand für die ganze Anfrage, auch wenn währenddessen ein neuer gilt.
        const loaded = await this.current();
        const { data } = loaded;
        // Ein Kartenpunkt ist seine Lage; er heißt hier nur „Kartenpunkt“, den Namen setzt die Oberfläche.
        const points = new Map<string, StagePlace>();
        for (const id of query.waypoints) {
            const at = parseMapPointId(id);
            if (at) points.set(id, { id, name: MAP_POINT_NAME, hidden: false, mapPoint: true, ...at });
        }
        // Eine Landmarke fährt als Kartenpunkt an ihrer Lage und heißt wie sie selbst (WI-0271 L6, `landmark-waypoints.ts`). Ohne
        // Landmarke sind die Stationen die Wegpunkte, und das Ergebnis bleibt dasselbe Objekt.
        const landmarks = landmarkStations(query.waypoints, query.landmarks);
        for (const [id, place] of landmarks.places) points.set(id, place);
        const { stations } = landmarks;
        const places = query.waypoints.map((id) => data.network.nodes.get(id));
        const unknown = query.waypoints.find((id, index) => !points.has(id) && places[index]?.kind !== "place");
        if (unknown !== undefined) return { ok: false, error: "unknown_waypoint", detail: unknown };

        const hoursPerDay = query.hoursPerDay ?? ROUTE_DEFAULTS.hours_per_day;
        const departure = query.departure ? departureDayOfYear(query.departure.month, query.departure.day) : undefined;
        const { air } = query;
        let result: RouteResult;
        let freeSeaUnavailable = false;
        if (air) {
            // Der Flug braucht keinen Graphen: Er baut kein Profil und berührt dessen Zwischenspeicher nicht.
            // Nach der Prüfung oben ist jeder Wegpunkt ein Kartenpunkt, eine Landmarke oder ein Ort. Die Landmarke fliegt unter der
            // Kennung ihres Kartenpunkts (die Kante heißt wie dessen) und mit ihrem Namen.
            const airStations = query.waypoints.map((id, position): AirPoint => {
                const at = points.get(id) ?? (places[position] as RouteNode);
                return { id: stations[position] ?? id, name: at.name, x: at.x, y: at.y };
            });
            // F2: um das Gelände, das über die absolute Höchstflughöhe minus den Mindestabstand ragt (für alle
            // Flugmittel dieselbe Grenze, Betreiber 2026-10-04); darunter steigt die Bahn über das Gelände.
            // F4: Fliegen über der Reisehöhe kostet Zeit, der Weg ist der mit der kürzesten Zeit samt Zuschlag
            // (die Luftlinie oder ein Weg um Gelände über einer der Schwellen, `air-weigh.ts`).
            const model = data.model ?? this.options.model;
            const { way, searches, display } = weighedAirFlight(data.heights, air, model);
            const { heights } = data;
            result = findAirRoute(airStations, air, model, {
                hoursPerDay,
                timed: departure !== undefined,
                way,
                searches,
                // Die Klimazone je Abschnitt, wie an Land nur mit Reisebeginn: Das Höhenprofil zeichnet daraus die Schneegrenze.
                ...(departure !== undefined
                    ? { zoneOf: (coordinates: [number, number][]) => data.climate.zoneOf(coordinates) }
                    : {}),
                ...(display ? { display } : {}),
                // Höhenprofil des Planers (WI-0065 Nachtrag 2026-10-03): Gelände unter dem Flug und Flughöhe darüber.
                ...(heights
                    ? {
                          profiles: (coordinates, distance, limit) =>
                              flightProfiles(coordinates, distance, heights, air, model, limit),
                      }
                    : {}),
            });
        } else {
            const timing =
                departure === undefined
                    ? null
                    : { departure, hoursPerDay, climate: data.climate, heights: data.heights ?? null };
            const wantsFreeSea = query.enabled.sea;
            const graph = this.graphFor(loaded, query, wantsFreeSea ? await this.freeSea(data) : null);
            // Eiltempo: Der Haken allein genügt dem Router nicht - die Taktung rechnet am Reisetag des Planers.
            result = findRoute(
                data.network,
                graph,
                stations,
                data,
                timing,
                query.hurry === true ? { hoursPerDay } : null,
            );
            freeSeaUnavailable = wantsFreeSea && !graph.sea;
        }
        result = asLandmarkRoute(result, query.waypoints, landmarks);
        if (result.refused) return { ok: false, error: result.refused.reason, detail: result.refused.waypoint };
        if (result.tooLarge) return { ok: false, error: "route_too_large", detail: result.tooLarge };
        // Die Antwortgrenze (WI-0037, S-10) - vor dem Reiseplan und vor dem Kopieren zum Server-Thread.
        const { limits } = this.options;
        if (result.segments.length > limits.segments) {
            return { ok: false, error: "route_too_large", detail: `segments:${String(result.segments.length)}` };
        }
        const legs = result.legs.map((leg) => ({
            from: leg.from,
            to: leg.to,
            segment_start: leg.segmentStart,
            segment_count: leg.segmentCount,
            distance_units: leg.distanceUnits,
            travel_hours: leg.travelHours,
        }));
        const index = this.placeIndex(data);
        const placeAt = (nodeId: string): StagePlace | undefined => points.get(nodeId) ?? index.placeAt(nodeId);
        const stages = result.found
            ? buildRouteStages(
                  result.segments,
                  legs,
                  {
                      model: data.model ?? this.options.model,
                      cityNodeRadius: (data.werte ?? WEGFINDUNG_VORGABEN).cityNodeRadius,
                      waypointIds: query.waypoints,
                      placeAt,
                      placeNear: (x, y, radius, accept) => index.placeNear(x, y, radius, accept),
                  },
                  { hoursPerDay, ...(departure === undefined ? {} : { departure }) },
              )
            : [];
        if (stages.length > limits.stages) {
            return { ok: false, error: "route_too_large", detail: `stages:${String(stages.length)}` };
        }
        const restHours = stages.reduce((sum, stage) => sum + stage.rest_hours, 0);
        // Die Steigung der Reise (WI-0049 S5d); ohne Gelände trägt keine Etappe eine, und das Feld fehlt.
        const slope = routeSlope(stages);
        // Der Zuschlag des Flugs über der Reisehöhe (F4); nur im Flug mit Höhenmodell.
        const airExtra = routeAirExtra(stages);
        // Die Mehrzeit durch Schnee und Eis (WI-0065 Nachtrag 2026-10-04); nur mit Reisebeginn, nie im Flug.
        const snow = routeSnow(result.segments);
        // Was das Eiltempo gebracht hat (WI-0078); fehlt, wenn der Haken aus war oder kein Abschnitt geeignet war.
        const hurry = routeHurry(stages);
        // Die Reisekosten (WI-0065): nach der Suche, aus Etappen und Abschnitten - sie fließen in keine Kante, keinen
        // Graphen, kein Profil. Im Flug gibt es keine Kosten (Plan 6.37), ohne Route nichts zu rechnen.
        const travelCosts =
            result.found && !air
                ? this.travelCosts(data, result.segments, stages, result.travelHours + restHours, {
                      landTransport: query.transports.land,
                      hoursPerDay,
                  })
                : undefined;
        return {
            ok: true,
            response: {
                found: result.found,
                ...(result.found
                    ? {}
                    : { reason: result.seasonClosed ? ("season_closed" as const) : ("network_disconnected" as const) }),
                failed_leg_index: result.failedLegIndex,
                ...(air
                    ? {
                          air: {
                              profile: air.profile,
                              speed_mph: air.speedMph,
                              altitude_schritt: air.altitudeSchritt,
                              max_above_ground_schritt: air.maxAboveGroundSchritt,
                              ceiling_schritt: air.ceilingSchritt,
                          },
                      }
                    : {}),
                map_domain: this.options.mapDomain,
                travel_model_version: this.travelModelVersion,
                routing_graph_revision: loaded.key,
                map_revision: partKey(loaded.data.revision.map) ?? "",
                terrain_revision: partKey(loaded.data.revision.terrain),
                waypoints: query.waypoints.map((id, position) => ({
                    id,
                    name: points.get(id)?.name ?? places[position]?.name ?? id,
                })),
                legs,
                segments: result.segments,
                distance_units: result.distanceUnits,
                travel_hours: result.travelHours,
                travel_days: result.travelDays,
                hours_per_day: hoursPerDay,
                rest_hours: restHours,
                total_hours: result.travelHours + restHours,
                miles_per_unit: (data.model ?? this.options.model).meilenJeKarteneinheit.wert,
                air_legs_units: airLegs(placeAt, query.waypoints),
                stages,
                ...(slope ? { slope } : {}),
                ...(airExtra ? { air_extra: airExtra } : {}),
                ...(snow ? { snow } : {}),
                ...(hurry ? { hurry } : {}),
                ...(travelCosts ? { travel_costs: travelCosts } : {}),
                ...(departure === undefined
                    ? {}
                    : {
                          departure: calendarDate(departure, 0),
                          // 🔴 Die Uhr der SUCHE fährt im normalen Tempo (WI-0078 §6): Sonst entschiede das
                          // Eiltempo über saisonale Sperren und damit über die Route. Hat es gegriffen, kommt die
                          // Ankunft deshalb aus den endgültigen Zeiten - dieselbe Zahl, die der Etappenplan läuft
                          // (Summe der Reisestunden und der Rast ist der Stand seiner Uhr am Ende).
                          ...(result.found && result.arrivalHours !== null
                              ? {
                                    arrival: calendarDate(
                                        departure,
                                        hurry ? result.travelHours + restHours : result.arrivalHours,
                                    ),
                                }
                              : {}),
                      }),
                ...(result.closures.length > 0 ? { closures: result.closures } : {}),
                ...(result.seasonalWays.length > 0 ? { seasonal_ways: result.seasonalWays } : {}),
                // Der Gang zu einem Kartenpunkt ist gewollt; gewarnt wird nur vor Notverbindungen.
                warnings: [
                    ...(result.segments.some((segment) => segment.synthetic && !segment.offroad)
                        ? (["cross_country"] as const)
                        : []),
                    ...(freeSeaUnavailable ? (["free_sea_unavailable"] as const) : []),
                ],
            },
        };
    }

    /**
     * Die Reisekosten je Person für alle vier Unterbringungsstufen (WI-0065, `travel_costs`): dieselbe `shared`-Funktion
     * wie im Browser bisher, dazu die Landesgrenzen aus den Zollgebieten des Datenstands. Die Linie ist die der
     * Fahrtrichtung (`segments[].geometry`), nicht die Zeichenlinie. Ohne abgeleitete Gebiete sind die Grenzen `null` und
     * der Zoll nicht ermittelbar - nie 0.
     */
    private travelCosts(
        data: RoutingData,
        segments: RouteResult["segments"],
        stages: RouteResponse["stages"],
        totalHours: number,
        options: { landTransport: string; hoursPerDay: number },
    ): RouteTravelCosts {
        const model = data.model ?? this.options.model;
        const { territories, yearBf } = data.territories ?? NO_TOLL_TERRITORIES;
        const borders = countBorderCrossings(
            segments,
            territories,
            model.meilenJeKarteneinheit.wert,
            model.reisekosten.grenzuebertritt.wert,
        );
        return buildRouteTravelCosts(model, { stages, total_hours: totalHours }, options, borders, yearBf);
    }

    /** Die Orte eines Datenstands, einmal abgelegt - der Stand wechselt nur mit neuen Daten. */
    private placeIndex(data: RoutingData): PlaceIndex {
        let index = this.placeIndexes.get(data);
        if (!index) {
            index = buildPlaceIndex(data.network);
            this.placeIndexes.set(data, index);
        }
        return index;
    }

    /**
     * Der Seegraph des Datenstands; einmal geladen, auch wenn es keinen gibt oder keinen, der zu diesem Stand
     * gehört (`seaGraph` der Revision): Der nächste Stand fragt neu.
     */
    private freeSea(data: RoutingData): Promise<FreeSea | null> {
        let sea = this.seas.get(data);
        if (!sea) {
            const load = this.options.source.loadSea;
            sea = load
                ? load(data.revision.seaGraph).then((graph) => {
                      const found = graph ? new FreeSea(graph) : null;
                      if (found) this.loadedSeas.set(data, found);
                      return found;
                  })
                : Promise.resolve(null);
            this.seas.set(data, sea);
        }
        return sea;
    }

    /**
     * Der geltende Stand. Nur ohne jeden Stand wartet der Aufrufer auf das Laden; ist die Prüffrist um,
     * wird im Hintergrund geprüft und geladen, und die Anfrage rechnet sofort mit dem alten Stand.
     */
    private async current(): Promise<Loaded> {
        if (!this.loaded) return this.latest();
        if (this.options.now() - this.lastCheck >= this.options.recheckMs) {
            this.latest().catch((error: unknown) => this.options.onReloadError?.(error));
        }
        return this.loaded;
    }

    private latest(): Promise<Loaded> {
        this.refreshing ??= this.reload().finally(() => {
            this.refreshing = undefined;
        });
        return this.refreshing;
    }

    private async reload(): Promise<Loaded> {
        const started = this.options.now();
        // Vor dem Abfragen: Scheitert es, versucht es erst die nächste Frist wieder, nicht jede Anfrage.
        this.lastCheck = started;
        const parts: Record<string, number> = {};
        // Mehrere Profile melden dieselben Schritte (`graph`, `year_round`): Das Journal nennt die Summe.
        const report: LoadReport = (part, ms) => {
            parts[part] = (parts[part] ?? 0) + ms;
        };
        const probeBegan = performance.now();
        const probedRevision = await this.options.source.revision();
        const probed = revisionKey(probedRevision);
        report("probe", Math.round(performance.now() - probeBegan));
        const previous = this.loaded;
        if (previous?.key === probed) {
            this.wartet = undefined;
            return previous;
        }
        if (previous !== undefined && this.aufschieben(previous.data.revision, probedRevision, probed, started))
            return previous;
        // Die Profile, die der alte Stand hielt (das am längsten unbenutzte zuerst): Sie gelten als in Gebrauch, und der
        // neue Stand baut sie vor dem Wechsel nach (WI-0117). Sonst fände jede Route auf einem anderen Profil als dem
        // Vorwärmprofil nach dem Wechsel kalten Boden und baute Graph und Brücken im Anfragepfad.
        const inUse = previous ? [...previous.graphs.values()].map((graph) => graph.request) : [];
        // 🔴 Speicher: Solange der neue Stand lädt, hält der alte nur seinen zuletzt benutzten Graphen. Zwei
        // Stände mit allen Profilen kamen lokal auf 74 MB (4 Profile) bis 93 MB (8), gekürzt auf 58,6 MB.
        if (previous) limitProfiles(previous, 1);
        let next: Loaded;
        try {
            // Die Revision gilt, die `load()` mit den Daten gelesen hat, nicht die geprüfte: Zwischen beiden kann
            // ein Import geschrieben haben, und nur die aus derselben Transaktion benennt diese Daten. Was sich
            // gegen den geltenden Stand nicht geändert hat, übernimmt die Quelle von dort (`RoutingSource.load`).
            const data = await this.options.source.load(previous?.data, report);
            // 🔴 Erst prüfen, dann vorbereiten, dann wechseln (Kap. 6.15): Ein Netz, das keine Route tragen kann,
            // wird nie aktiv; der alte Stand bleibt, und der Fehler geht an `onReloadError`.
            assertUsableNetwork(data.network);
            next = { data, key: revisionKey(data.revision), graphs: new Map(), maxProfiles: this.options.maxProfiles };
            // Wechselte die Quelle zwischen Prüfen und Laden auf den Stand zurück, den wir schon haben, gibt es
            // nichts zu wechseln.
            if (previous?.key === next.key) {
                limitProfiles(previous, this.options.maxProfiles);
                return previous;
            }
            this.inherit(previous, next);
            // 🔴 Erst vorbereiten, dann wechseln: Sonst baute die erste Anfrage auf dem neuen Stand den Graphen
            // des häufigsten Profils im Anfragepfad (gemessen 130 bis 250 ms, auf dem VPS bis zum Doppelten).
            if (this.warmProfile) {
                await this.prepare(next, this.warmProfile, report);
                for (const request of inUse) await this.prepare(next, request, report);
            }
        } catch (error) {
            if (previous) limitProfiles(previous, this.options.maxProfiles);
            throw error;
        }
        this.loaded = next;
        // 🔴 Erst wechseln, dann umstellen (WI-0153): Bis hierher hat der alte Stand geantwortet, und er hat mit
        // SEINEN Zahlen gerechnet. Was je Anfrage gelesen wird, gilt ab jetzt.
        setzeWerte(next.data.werte ?? null);
        this.options.onReload?.({
            revision: next.key,
            previous: previous?.key ?? null,
            changed: changedParts(previous?.data.revision ?? null, next.data.revision),
            ms: this.options.now() - started,
            parts_ms: parts,
            profiles: next.graphs.size,
        });
        return next;
    }

    /**
     * Ruhe abwarten (`ruheMs`, WI-0177; Hauptorchestrierung 2026-10-19 zu Thomas 2.3): Schreiben Editoren in kurzer Folge (mehrere
     * „Fertig“ nacheinander, mehrere Bearbeiter), ändert sich der Teil `map` alle paar Sekunden, und jedes Prüfen lüde den ganzen Graphen
     * neu (gemessen 5 Ladungen in 20 s, je 0,8 bis 1,1 s; die Messung stammt aus der Zeit, als die Wegkurve jeden Handgriff schrieb,
     * bis zum Rückbau 2026-10-31, EDIT-0003 G4). Ändert sich NUR `map`, wartet der Dienst, bis die Revision `ruheMs` still stand, höchstens
     * `hoechstensMs` nach der ersten gesehenen Änderung, und rechnet bis dahin mit dem alten Stand. Gelände, Wegprofile, Einstellungen
     * und alles andere laden sofort. `true`: noch nicht laden.
     */
    private aufschieben(vorher: RoutingDataRevision, jetzt: RoutingDataRevision, key: string, um: number): boolean {
        const { ruheMs, hoechstensMs } = this.options;
        if (ruheMs <= 0 || !changedParts(vorher, jetzt).every((teil) => teil === "map")) {
            this.wartet = undefined;
            return false;
        }
        if (this.wartet === undefined) {
            this.wartet = { key, seit: um, zuletzt: um };
            return true;
        }
        if (this.wartet.key !== key) this.wartet = { key, seit: this.wartet.seit, zuletzt: um };
        if (um - this.wartet.zuletzt < ruheMs && um - this.wartet.seit < hoechstensMs) return true;
        this.wartet = undefined;
        return false;
    }

    /**
     * Was am Datenstand hängt und nur von einem Bestandteil abhängt, erbt der neue Stand, solange der Bestandteil
     * derselbe ist: der Ortsindex vom Netz, der Seegraph von seiner Kennung. Sonst lüde der neue Stand den Seegraphen
     * (13 MB) neben dem alten und baute den Ortsindex neu, obwohl sich beides nicht geändert hat.
     * Nur ein gefundener Seegraph wird geerbt: Eine Absage („keiner“) oder ein Fehler gilt für den Stand, an dem sie
     * kam, und der nächste fragt neu.
     */
    private inherit(previous: Loaded | undefined, next: Loaded): void {
        if (!previous) return;
        const before = previous.data;
        const after = next.data;
        const index = this.placeIndexes.get(before);
        if (index && before.network === after.network) this.placeIndexes.set(after, index);
        const sea = this.loadedSeas.get(before);
        if (sea && before.revision.seaGraph === after.revision.seaGraph) {
            this.loadedSeas.set(after, sea);
            this.seas.set(after, Promise.resolve(sea));
        }
    }

    /**
     * Alles, was die erste Route auf einem Stand sonst im Anfragepfad rechnen müsste, damit sie es vorfindet. Start und
     * Nachladen gehen beide hierher (`warm`, `reload`): Graph des Profils (samt Seegraph), seine ganzjährigen Brücken (jede
     * Route mit Reisebeginn), der Ortsindex und das Flugraster des Geländes (jeder Flug). 🔴 Wer eine neue Struktur
     * verzögert baut, die die erste Route eines Stands braucht, trägt sie hier ein (WI-0117): Gemessen kostete die erste
     * Route mit Reisebeginn nach dem Nachladen 0,5 bis 1,3 s statt 10 bis 50 ms, der erste Flug nach einem neuen
     * Gelände 0,5 s - auf Stage über den 2 s des Runners.
     *
     * Zwischen den Schritten gibt der Worker die Schleife frei: Was der alte Stand an Anfragen hat, läuft dazwischen,
     * statt hinter dem Vorbereiten zu warten.
     */
    private async prepare(loaded: Loaded, request: RouteRequest, report?: LoadReport): Promise<void> {
        const wantsFreeSea = request.enabled.sea;
        let began = performance.now();
        const sea = wantsFreeSea ? await this.freeSea(loaded.data) : null;
        if (wantsFreeSea) report?.("sea", Math.round(performance.now() - began));
        began = performance.now();
        const graph = this.graphFor(loaded, request, sea);
        report?.("graph", Math.round(performance.now() - began));
        await yieldToLoop();
        began = performance.now();
        prepareYearRoundBridges(loaded.data.network, graph);
        report?.("year_round", Math.round(performance.now() - began));
        await yieldToLoop();
        began = performance.now();
        this.placeIndex(loaded.data);
        report?.("index", Math.round(performance.now() - began));
        const { heights } = loaded.data;
        if (heights) {
            began = performance.now();
            airTerrain(heights);
            report?.("air", Math.round(performance.now() - began));
        }
    }

    private graphFor(loaded: Loaded, request: RouteRequest, freeSea: FreeSea | null = null): RouteGraph {
        const { data, graphs } = loaded;
        // Optimierung und Umstiegsaufschlag ändern die Kanten nicht, nur ihre Gewichte - ein Graph für alle.
        // 🔴 Das Mittel eines abgeschalteten Mediums baut keine Kante (WI-0037, S-04): Im Schlüssel machte
        // es aus 83 Graphen 252 Schlüssel, und neun im Wechsel erzwangen jedes Mal einen Neubau.
        const { enabled, transports } = request;
        const key = JSON.stringify([
            enabled,
            enabled.land ? transports.land : null,
            enabled.river ? transports.river : null,
            enabled.sea ? transports.sea : null,
            enabled.sea && freeSea ? "frei" : null,
        ]);
        let graph = graphs.get(key);
        if (graph) {
            graphs.delete(key);
        } else {
            const model = data.model ?? this.options.model;
            // Wagen suchen ihre Brücken nur über offenes Land (WI-0258): Boden und Gelände des Stands gehören dazu.
            const barrier = vehicleBarrier(model, request.transports.land, data.ground, data.heights);
            graph = buildRouteGraph(data.network, model, request, data.water, freeSea, barrier);
        }
        graphs.set(key, graph);
        limitProfiles(loaded, loaded.maxProfiles);
        // Die Suche liest Optimierung und Aufschlag aus dem Graphen: diese Anfrage, nicht die erste.
        return { ...graph, request };
    }
}

/** Gibt der Schleife einen Zug: Nachrichten, die schon im Worker warten, laufen vor dem nächsten Schritt. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Setzt die Zahl der Profile eines Stands und wirft die am längsten unbenutzten hinaus. */
function limitProfiles(loaded: Loaded, maxProfiles: number): void {
    loaded.maxProfiles = maxProfiles;
    while (loaded.graphs.size > maxProfiles) {
        loaded.graphs.delete(loaded.graphs.keys().next().value as string);
    }
}

/**
 * Der Drachenflug (Legacy `buildRouteSummary`): je Paar aufeinanderfolgender Wegpunkte die Luftlinie,
 * nicht die eine Linie vom Start zum Ziel - sonst wäre die Summe kleiner als eines ihrer Teile.
 */
function airLegs(placeAt: (nodeId: string) => StagePlace | undefined, waypoints: readonly string[]): number[] {
    const legs: number[] = [];
    for (let position = 0; position + 1 < waypoints.length; position += 1) {
        const from = placeAt(waypoints[position] as string);
        const to = placeAt(waypoints[position + 1] as string);
        if (from && to) legs.push(Math.hypot(to.x - from.x, to.y - from.y));
    }
    return legs;
}

/**
 * Die Transaktion, in der `load()` Revision und Daten liest: ein Schnappschuss (`repeatable read`), nur lesend.
 * Ein Import, der zwischen zwei der acht Loader schreibt, ändert ihn nicht mehr.
 */
export const SNAPSHOT_TRANSACTION = "isolation level repeatable read read only";

/** Die Bestandteile eines Datenstands ohne seine Revision. */
export type RoutingParts = Omit<RoutingData, "revision">;

/** Was die Quelle aus der Datenbank liest; austauschbar, damit ein Test die Transaktion beobachten kann. */
export interface RoutingReads {
    revision(database: Queryable, mapDomainId: string, modelVersion: string): Promise<RoutingDataRevision>;
    /**
     * Lädt genau die Bestandteile in `wanted` (`RoutingDataPart`); die anderen fehlen im Ergebnis.
     *
     * `reusable` ist der geltende Stand, gerechnet mit demselben Reisemodell (WI-0071): Ein Bestandteil, der
     * geladen werden soll, aber innen unverändert ist (das Gelände nach einer Änderung an einer fremden Fläche),
     * darf von dort kommen, statt neben ihm noch einmal im Speicher zu stehen. Fehlt er, lädt der Loader alles neu.
     */
    data(
        database: Queryable,
        mapDomainId: string,
        model: TravelModel,
        wanted: ReadonlySet<RoutingDataPart>,
        reusable?: RoutingData,
        report?: LoadReport,
    ): Promise<Partial<RoutingParts>>;
}

/**
 * Die Loader des Routings gegen eine Verbindung, je Bestandteil einer, in fester Reihenfolge. Jede Tabelle, die sie
 * lesen, steht in `readRoutingRevision`, und `DATA_PART_INPUTS` nennt, von welchen Revisionsteilen der Bestandteil
 * abhängt.
 */
async function loadRoutingData(
    database: Queryable,
    mapDomainId: string,
    model: TravelModel,
    wanted: ReadonlySet<RoutingDataPart>,
    reusable?: RoutingData,
    report?: LoadReport,
): Promise<Partial<RoutingParts>> {
    const parts: Partial<RoutingParts> = {};
    /**
     * Die verstellten Kenngrößen DIESES Schnappschusses (WI-0153): in derselben Transaktion gelesen wie die Revision,
     * die sie im Teil `settings` benennt. 🪤 Ohne Personen (`personen: false`): Der Routing-Worker hat am
     * Anmeldeschema nichts zu suchen, und wer verstellt hat, steht im Protokoll.
     */
    const werteBegann = performance.now();
    const werte = wirksameWegfindung(await leseWegfindung(database, { personen: false }));
    report?.("settings", Math.round(performance.now() - werteBegann));
    parts.werte = werte;
    parts.model = modellMitWerten(model, werte);
    /** Die Uhr um einen Loader: nur zum Melden, am Ergebnis ändert sich nichts. */
    const timed = async <T>(part: RoutingDataPart, load: () => Promise<T>): Promise<T> => {
        const began = performance.now();
        try {
            return await load();
        } finally {
            report?.(part, Math.round(performance.now() - began));
        }
    };
    /**
     * Die Kenngrößen des Netzaufbaus (WI-0153): aus den Einstellungen dieses Stands, nicht aus `einstellungen.ts` —
     * während dieser Stand lädt, antwortet der alte noch mit seinen Zahlen. Der Fangradius hat keinen zweiten Einstellweg
     * mehr: `ROUTE_END_SNAP` ist mit WI-0214 entfallen, er steht in der Systemsteuerung.
     */
    if (wanted.has("network")) {
        parts.network = await timed("network", () => loadRouteNetwork(database, mapDomainId, netzOptionen(werte)));
    }
    if (wanted.has("water")) parts.water = await timed("water", () => loadWater(database, mapDomainId));
    if (wanted.has("land")) parts.land = await timed("land", () => loadLand(database, mapDomainId));
    if (wanted.has("rivers")) {
        parts.rivers = await timed("rivers", () => loadRivers(database, mapDomainId, parts.model!));
    }
    if (wanted.has("ground")) {
        parts.ground = await timed("ground", () => loadGround(database, mapDomainId, parts.model!.bodenfaktor.wert));
    }
    if (wanted.has("climate")) parts.climate = await timed("climate", () => loadClimate(database));
    if (wanted.has("heights")) {
        parts.heights = await timed("heights", () =>
            loadTerrainHeights(database, mapDomainId, parts.model!, undefined, reusable?.heights),
        );
    }
    if (wanted.has("territories")) {
        parts.territories = await timed("territories", () => loadTollTerritories(database, mapDomainId));
    }
    return parts;
}

const DATABASE_READS: RoutingReads = { revision: readRoutingRevision, data: loadRoutingData };

/**
 * Der neue Stand aus den frisch geladenen Bestandteilen und, für alle übrigen, den unveränderten des alten: Was
 * `stale` nicht nennt, ist dasselbe Objekt wie im alten Stand. So bleiben auch die Zwischenspeicher gültig, die an
 * der Identität eines Bestandteils hängen (Eichung am Netz, Hindernisraster am Gelände).
 */
function assembleData(
    previous: RoutingData | undefined,
    stale: ReadonlySet<RoutingDataPart>,
    fresh: Partial<RoutingParts>,
    revision: RoutingDataRevision,
    werte: Wegfindungswerte,
    model: TravelModel,
): RoutingData {
    const take = <K extends RoutingDataPart>(part: K): RoutingParts[K] | undefined =>
        (previous && !stale.has(part) ? previous : fresh)[part];
    const network = take("network");
    const water = take("water");
    const land = take("land");
    const rivers = take("rivers");
    const ground = take("ground");
    const climate = take("climate");
    const heights = take("heights");
    const territories = take("territories") ?? NO_TOLL_TERRITORIES;
    if (!network || !water || !land || !rivers || !ground || !climate) {
        throw new Error("Routingdaten unvollständig: ein Bestandteil wurde weder geladen noch übernommen");
    }
    return {
        network,
        water,
        land,
        rivers,
        ground,
        climate,
        ...(heights === undefined ? {} : { heights }),
        territories,
        werte,
        model,
        revision,
    };
}

/** Der Seegraph nur, wenn er der ist, zu dem die geladene Revision gehört. */
export function matchingSeaGraph(stored: StoredSeaRoutes | null, expected: string | null): CompactSeaGraph | null {
    return stored && seaGraphIdentity(stored.algorithm, stored.fingerprint) === expected ? stored.graph : null;
}

/** Der Seegraph des Workers: nur der des heutigen Algorithmus, in Scheiben (WI-0071, `sliced-read.ts`). */
const seaLoad = () => ({ current: true, sliceBytes: routingSliceBytes() }) as const;

/**
 * Die Datenbank als Quelle: Orte, Wege, Wasser, Land und Flüsse der Kartendomäne.
 *
 * - `revision()` fragt die Revision an der Verbindung ab - eine Anweisung, sie ist für sich ein Schnappschuss.
 * - `load()` liest Revision und Daten in einer Transaktion (`SNAPSHOT_TRANSACTION`). Bekommt die Quelle schon eine
 *   Transaktion, liest sie in dieser. Mit dem geltenden Stand als `previous` lädt sie nur die Bestandteile, deren
 *   Revisionsteile sich gegen ihn geändert haben (`staleDataParts`); die anderen übernimmt sie von dort. Das ist
 *   im Schnappschuss ebenso genau: Ein Teil, der zwischen beiden Revisionen gleich blieb, ist gleich geblieben.
 */
export function databaseRoutingSource(
    database: Queryable,
    mapDomainId: string,
    model: TravelModel,
    reads: RoutingReads = DATABASE_READS,
): RoutingSource {
    const modelVersion = travelModelVersion(model);
    return {
        revision: () => reads.revision(database, mapDomainId, modelVersion),
        load(previous, report) {
            const read = async (connection: Queryable): Promise<RoutingData> => {
                // Schon die erste Anweisung legt den Schnappschuss fest: Revision und Daten sehen denselben Stand.
                const revisionBegan = performance.now();
                const revision = await reads.revision(connection, mapDomainId, modelVersion);
                report?.("revision", Math.round(performance.now() - revisionBegan));
                const stale = staleDataParts(previous?.revision ?? null, revision);
                // Mit einem anderen Reisemodell (Eichung, Flüsse, Böden) gilt nichts vom alten Stand als Vorlage.
                const reusable = previous?.revision.travelModel === revision.travelModel ? previous : undefined;
                const fresh = await reads.data(connection, mapDomainId, model, stale, reusable, report);
                /**
                 * Die wirksamen Kenngrößen dieses Schnappschusses (WI-0153) kommen aus dem Loader: Er hat die
                 * Verbindung, und ein Nachbau von `reads` (Tests, Werkzeuge) liefert sie gar nicht erst — dann
                 * gelten die Vorgaben des Registers, und es rechnet wie vorher.
                 */
                const werte = fresh.werte ?? WEGFINDUNG_VORGABEN;
                return assembleData(previous, stale, fresh, revision, werte, fresh.model ?? model);
            };
            if (!("begin" in database)) return read(database);
            const began = performance.now();
            return database.begin(SNAPSHOT_TRANSACTION, read).finally(() => {
                report?.("transaction", Math.round(performance.now() - began));
            });
        },
        async loadSea(seaGraph) {
            // 🪤 Der Treiber hält den Lesepuffer der großen Zeile, bis dieselbe Verbindung die nächste Anfrage
            // stellt: gemessen 18 bis 45 MB zusätzlich im Worker (2026-09-27). Eine reservierte Verbindung mit
            // einer kleinen Anfrage danach gibt ihn sofort frei; übrig bleiben die 13 MB des Seegraphen. Seit WI-0071
            // kommt der Graph in Scheiben (`seaLoad`): Dann ist auch der Lesepuffer nur eine Scheibe groß.
            if (!("reserve" in database)) {
                return matchingSeaGraph(await loadSeaRoutes(database, mapDomainId, seaLoad()), seaGraph);
            }
            const connection = await database.reserve();
            try {
                const stored = await loadSeaRoutes(connection, mapDomainId, seaLoad());
                await connection`SELECT 1`;
                return matchingSeaGraph(stored, seaGraph);
            } finally {
                connection.release();
            }
        },
    };
}
