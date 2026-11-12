import {
    AVENTURIA_TRAVEL_MODEL,
    LODGING_LEVELS,
    countBorderCrossings,
    territoryAtPoint,
    type BorderCount,
    type BorderRule,
    type BorderSegment,
    type BorderTerritory,
    type RouteResponse,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../src/database.ts";
import { loadGateFiles, queryOf, resolveName, type GateService } from "../../src/routing/corpus-gate-run.ts";
import type { RouteQuery } from "../../src/routing/service.ts";
import type { LegacyBorders } from "../../../../scripts/dev/legacy-route-costs.ts";
import { pick, random } from "./invariants.ts";

/**
 * Das Orakel der Zollzählung (WI-0065 U6): dieselbe Reise, dieselben Gebiete, drei Rechenwege.
 *
 * - **A** ist unsere Zählung (`countBorderCrossings` aus `shared`, auf den Gebieten, die der Routing-Worker lädt).
 * - **B1** ist Legacys Code, unverändert im `vm`-Kontext (`scripts/dev/legacy-route-costs.ts`). A ist ein 1:1-Port;
 *   jede Abweichung ist ein Fehler im Port.
 * - **B2** ist die exakte Rechnung in PostGIS: `ST_Intersection`, `ST_LineLocatePoint`, Längen ohne Abtastung und
 *   ohne Hüllboxen. Die Zusammenfassung der Läufe (`crossingsOf`) ist hier NEU geschrieben, ANDERS gebaut als die
 *   in `packages/shared` (Läufe filtern und verschmelzen statt in den Vorlauf schlucken) und importiert nichts von
 *   dort. Damit fängt sie Fehler, die ein Port allein nicht sieht: die Geometrie (Abtastung gegen exakt) und die
 *   Zusammenfassung (zwei Bauarten, eine Regel).
 * - **B3** ist die Abtastung, die A macht, mit DER Zusammenfassung von B2: Sie gleicht bei jeder Reise B1 und A und
 *   beweist so, dass B2s Zusammenfassung Legacys Regel ist. Erst dann sagt ein Unterschied zwischen A und B2 etwas
 *   über die Geometrie und nicht über die Zusammenfassung.
 *
 * Die Toleranz von A gegen B2 gilt nur dort, wo die Abtastung einen Lauf anders sehen KANN: Ein Lauf, dessen exakte
 * Länge innerhalb eines Abtastschritts um die Schwelle liegt (`borderline`), darf auf JEDER Seite der Schwelle liegen,
 * jeder für sich, und ein Lauf unter einem Schritt darf ihr entgehen; die Übertritte von A müssen aus einer solchen Wahl
 * entstehen (`explainedBy`), hin wie zurück. Ohne solche Läufe heißt das: dieselben Übertritte in derselben Reihenfolge.
 * Jede Ausnahme steht mit Reise und Länge im Protokoll; die 3 % des Korpus gelten für die Ausnahmen, die nicht auf einem
 * Weg entlang einer Grenze liegen (`alongBorder`, `borderRoad`): Die sind ein Befund an den Gebietsgrenzen.
 *
 * Nur lesend gegen die Datenbank. Der Korpus: die Fälle des Routing-Gates und gezogene Reisen (fester Seed 65), alle
 * im selben Prozess über `openGateService` gerechnet.
 */

const model = AVENTURIA_TRAVEL_MODEL;
export const MILES_PER_UNIT = model.meilenJeKarteneinheit.wert;
export const BORDER_RULE: BorderRule = model.reisekosten.grenzuebertritt.wert;
/** Ein Abtastschritt in Meilen (0,4 Einheiten je 3 Meilen: 1,2): so weit kann die Abtastung von der exakten Länge abweichen. */
export const STEP_MILES = BORDER_RULE.abtastschritt * MILES_PER_UNIT;
/** Der Seed der gezogenen Reisen (WI-0065: „fester Seed 65“). */
export const DEFAULT_SEED = 65;

/* ------------------------------------------------------------------------------------------------------------ */
/* Der Korpus                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

export interface OracleTrip {
    /** `gate:<Kennung>`, `named:<n>`, `random:<n>`, `ports:<n>`. */
    id: string;
    kind: "gate" | "named" | "random" | "ports";
    label: string;
    query: Omit<RouteQuery, "waypoints">;
    waypoints: string[];
}

/** Die benannten Reisen des Prototyps (WI-0065 „Messung an unseren Daten“), in fester Reihenfolge. */
const NAMED_TRIPS: readonly (readonly [string, string])[] = [
    ["Gareth", "Perricum"],
    ["Gareth", "Fasar"],
    ["Gareth", "Kuslik"],
    ["Gareth", "Punin"],
    ["Gareth", "Havena"],
    ["Havena", "Kuslik"],
    ["Thorwal", "Gareth"],
    ["Al'Anfa", "Havena"],
    ["Gareth", "Khunchom"],
    ["Havena", "Thorwal"],
    ["Kuslik", "Al'Anfa"],
    ["Perricum", "Mengbilla"],
    ["Punin", "Vinsalt"],
    ["Ferdok", "Gareth"],
    ["Elenvina", "Gareth"],
    ["Beilunk", "Gareth"],
];

/**
 * Die schnelle Teilmenge für `npm test` (acht Reisen, rund zwei Sekunden, meist Legacys Code als B1): Land, Fluss, See,
 * viele und keine Grenzen, dazu zwei gezogene. Die Rechenzeit von B1 wächst mit der Länge der Reise, deshalb fehlen die
 * langen Schiffsreisen (Al'Anfa > Havena, rund 0,5 s).
 */
const SMALL_NAMED = [
    "Gareth > Perricum",
    "Gareth > Fasar",
    "Gareth > Havena",
    "Havena > Kuslik",
    "Perricum > Mengbilla",
    "Punin > Vinsalt",
];
/**
 * Welche der gezogenen Reisen (in Reihenfolge des Seeds 65) die Teilmenge nimmt. 🪤 Welche Orte das sind, hängt am
 * Ortsbestand: Jeder Legacy-Zug, der Orte anlegt, stilllegt oder umstuft, verschiebt die Ziehung (2026-09-30
 * „Wasserburg > Pildek“ mit 12 Grenzen, seit `map179380` „Auen > Thegûn“ mit 6). Nichts, was die Teilmenge sicher
 * enthalten muss, hängt deshalb an diesen Reisen; die Zeugen der Regelmutanten werden gesucht (`findMutantWitnesses`).
 */
const SMALL_DRAWN = [1, 4];

function placesOf(gate: GateService): { id: string; name: string; hidden: boolean }[] {
    return [...gate.data.network.nodes.values()]
        .filter((node) => node.kind === "place")
        .map((node) => ({ id: node.id, name: node.name, hidden: node.isHidden }));
}

/**
 * Die Fälle des Routing-Gates (40 des Legacy-Korpus, dazu die Ergänzungen) als Reisen. Ein Fall im Flug hat keine
 * Kosten und gehört nicht dazu; er steht in `skipped`, ebenso ein Fall mit unauflösbarem Namen.
 */
export function gateTrips(gate: GateService): { trips: OracleTrip[]; skipped: string[] } {
    const places = placesOf(gate);
    const trips: OracleTrip[] = [];
    const skipped: string[] = [];
    for (const one of loadGateFiles().cases) {
        const query = queryOf(one.request);
        if ("invalid" in query) {
            skipped.push(`${one.id}: ${query.invalid}`);
            continue;
        }
        if (query.air) {
            skipped.push(`${one.id}: Flug, keine Kosten`);
            continue;
        }
        const ids: string[] = [];
        for (const name of one.names) {
            const hit = resolveName(places, name);
            if ("id" in hit) ids.push(hit.id);
            else skipped.push(`${one.id}: ${hit.unresolved}`);
        }
        if (ids.length !== one.names.length) continue;
        trips.push({ id: `gate:${one.id}`, kind: "gate", label: `${one.id} ${one.label}`, query, waypoints: ids });
    }
    return { trips, skipped };
}

interface PoolPlace {
    id: string;
    name: string;
    port: boolean;
}

async function placePool(database: Queryable): Promise<PoolPlace[]> {
    return database<PoolPlace[]>`
        SELECT public_id::text AS id, name, is_seaport AS port
        FROM place
        WHERE is_active AND subtype IN ('metropole', 'grossstadt', 'stadt', 'kleinstadt')
        ORDER BY public_id
    `;
}

/**
 * Gezogene Reisen aus festem Seed (WI-0065): 16 benannte, 140 zwischen Orten ab Kleinstadt, 40 zwischen Häfen. Das Land
 * wechselt wie im Prototyp (jede dritte zu Pferd, zwischen Häfen immer), alles andere sind die Vorgaben des Endpunkts.
 */
export async function drawnTrips(database: Queryable, seed: number): Promise<OracleTrip[]> {
    const places = await placePool(database);
    const ports = places.filter((place) => place.port);
    if (places.length < 2 || ports.length < 2) {
        throw new Error("Der Zollvergleich braucht mindestens zwei Orte und zwei Häfen");
    }
    const next = random(seed);
    const jobs: { kind: OracleTrip["kind"]; a: PoolPlace; b: PoolPlace; label: string }[] = [];
    for (const [from, to] of NAMED_TRIPS) {
        const a = places.find((place) => place.name === from);
        const b = places.find((place) => place.name === to);
        if (a && b) jobs.push({ kind: "named", a, b, label: `${from} > ${to}` });
    }
    for (let index = 0; index < 140; index += 1) {
        const a = pick(places, next);
        let b = pick(places, next);
        for (let attempt = 0; b === a && attempt < 100; attempt += 1) b = pick(places, next);
        if (b === a) throw new Error("Kein unterschiedliches Ziel nach 100 Ziehungen");
        jobs.push({ kind: "random", a, b, label: `${a.name} > ${b.name}` });
    }
    for (let index = 0; index < 40; index += 1) {
        const a = pick(ports, next);
        const b = pick(ports, next);
        if (a === b) continue;
        jobs.push({ kind: "ports", a, b, label: `${a.name} > ${b.name}` });
    }
    return jobs.map((job, index) => {
        const land = job.kind === "ports" || index % 3 === 0 ? "groupHorse" : "groupFoot";
        const query = queryOf({ land });
        if ("invalid" in query) throw new Error(`Anfrage der gezogenen Reise ungültig: ${query.invalid}`);
        return {
            id: `${job.kind}:${String(index).padStart(3, "0")}`,
            kind: job.kind,
            label: `${job.label} (${land})`,
            query,
            waypoints: [job.a.id, job.b.id],
        };
    });
}

/** Die kleine Teilmenge für `npm test`. */
export function smallSubset(trips: readonly OracleTrip[]): OracleTrip[] {
    const named = SMALL_NAMED.flatMap((name) =>
        trips.filter((trip) => trip.kind === "named" && trip.label.startsWith(`${name} (`)),
    );
    const random = trips.filter((trip) => trip.kind === "random");
    return [...named, ...SMALL_DRAWN.flatMap((index) => random[index] ?? [])];
}

export interface RoutedTrip {
    trip: OracleTrip;
    /** Die Antwort mit Kosten; `null`, wenn es keine gibt (dann steht der Grund in `skipped`). */
    response: RouteResponse | null;
    skipped?: string;
}

/** Rechnet die Reisen nacheinander im Dienst des Datenstands. */
export async function routeTrips(gate: GateService, trips: readonly OracleTrip[]): Promise<RoutedTrip[]> {
    const routed: RoutedTrip[] = [];
    for (const trip of trips) {
        const outcome = await gate.service.route({ ...trip.query, waypoints: trip.waypoints });
        if (!outcome.ok) {
            routed.push({ trip, response: null, skipped: `abgelehnt: ${outcome.error}` });
        } else if (!outcome.response.found) {
            routed.push({ trip, response: null, skipped: "keine Route" });
        } else if (!outcome.response.travel_costs) {
            routed.push({ trip, response: null, skipped: "keine Kosten im Ergebnis" });
        } else {
            routed.push({ trip, response: outcome.response });
        }
    }
    return routed;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Die Gebiete, unabhängig vom Lader gelesen                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

export interface OracleRoot {
    id: string;
    name: string;
    /** GeoJSON der Wurzel in Band 0 (sechs Nachkommastellen wie beim Lader). */
    geometry: { type: string; coordinates: unknown };
}

/**
 * Die Wurzeln des Bandes 0 in Legacys Reihenfolge (`sort_order`, `name`, dazu `public_id`), mit eigener Abfrage: So
 * prüft ein Vergleich gegen die Gebiete des Laders (`loadTollTerritories`) auch den Lader.
 */
export async function loadOracleRoots(database: Queryable, mapDomainId: string): Promise<OracleRoot[]> {
    const rows = await database<{ id: string; name: string; geometry: string }[]>`
        SELECT t.public_id::text AS id, t.name, ST_AsGeoJSON(s.geom, 6) AS geometry
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        WHERE s.band = 0 AND s.parent_id IS NULL AND t.map_domain_id = ${mapDomainId} AND t.is_active
        ORDER BY t.sort_order, t.name, t.public_id
    `;
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        geometry: JSON.parse(row.geometry) as { type: string; coordinates: unknown },
    }));
}

export interface RootSetFinding {
    /** Die Wurzeln des Bandes 0. */
    band0: number;
    /** Gebiete ohne nominellen Elternteil und mit einer Fläche im Teilbaum. */
    nominal: number;
    /** Nur im Band 0, nicht nominell souverän (sollte leer sein). */
    onlyBand0: string[];
    /** Nominell souverän mit Fläche, aber nicht im Band 0 (sollte leer sein). */
    onlyNominal: string[];
    /** Im Anzeigejahr wirksame Wurzeln, die in Band 0 nicht erscheinen (heute Wehrheim): der benannte Befund. */
    effectiveOutsideBand0: string[];
}

/**
 * Kontrolle (d): Die Menge der Zollgebiete ist die Menge der Herrschaftsgebiete OHNE nominellen Elternteil und mit
 * einer Fläche im Teilbaum. Ein Wurzelgebiet, dessen Elter im Anzeigejahr abgelaufen ist und das erst in einem späteren
 * Band erscheint (Wehrheim), ist im Anzeigejahr wirksam souverän, zählt nach Legacys Regel aber nicht: Es steht als Befund
 * in `effectiveOutsideBand0`, nicht als stiller Fehler.
 */
export async function checkRootSet(
    database: Queryable,
    mapDomainId: string,
    roots: readonly OracleRoot[],
): Promise<RootSetFinding> {
    const nominal = await database<{ id: string; name: string }[]>`
        WITH RECURSIVE tree(root_id, id) AS (
            SELECT t.id, t.id FROM territory t
            WHERE t.parent_id IS NULL AND t.is_active AND t.map_domain_id = ${mapDomainId}
            UNION
            SELECT tree.root_id, c.id FROM tree JOIN territory c ON c.parent_id = tree.id WHERE c.is_active
        )
        SELECT DISTINCT r.public_id::text AS id, r.name
        FROM tree
        JOIN territory r ON r.id = tree.root_id
        JOIN territory_area a ON a.territory_id = tree.id AND a.is_active
    `;
    const outside = await database<{ id: string; name: string }[]>`
        SELECT DISTINCT t.public_id::text AS id, t.name
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        WHERE s.parent_id IS NULL AND s.band > 0 AND t.map_domain_id = ${mapDomainId} AND t.is_active
          AND NOT EXISTS (
              SELECT 1 FROM territory_shape z WHERE z.band = 0 AND z.parent_id IS NULL AND z.territory_id = s.territory_id
          )
        ORDER BY t.name
    `;
    const band0 = new Set(roots.map((root) => root.id));
    const nominalIds = new Set(nominal.map((row) => row.id));
    return {
        band0: band0.size,
        nominal: nominalIds.size,
        onlyBand0: roots.filter((root) => !nominalIds.has(root.id)).map((root) => root.name),
        onlyNominal: nominal.filter((row) => !band0.has(row.id)).map((row) => row.name),
        effectiveOutsideBand0: outside.map((row) => row.name),
    };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Läufe und ihre Zusammenfassung (B2, B3)                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

/** Ein zusammenhängender Aufenthalt: der Name des Gebiets (leer: keines) und seine Länge in Meilen. */
export interface Run {
    name: string;
    miles: number;
}

export interface Crossings {
    count: number;
    /** Jeder Übertritt als `von > nach`, in Reihenfolge der Reise. */
    pairs: string[];
}

/**
 * Legacys Regel auf einer Folge von Läufen, ANDERS gebaut als in `packages/shared`: Dort wandert ein kurzer Lauf in den
 * Vorlauf, hier wird gefiltert und verschmolzen.
 *
 * 1. Ein Lauf unter der Schwelle fällt weg, außer dem ersten (er hat keinen Vorlauf, in den er fallen könnte). Er zählt
 *    nie mit seiner Länge in die Läufe davor oder danach: Die Schwelle prüft jeden Lauf für sich.
 * 2. Gleiche Nachbarn verschmelzen (der Name ist der Schlüssel).
 * 3. Übertritt ist ein Wechsel zwischen zwei BENANNTEN Gebieten; von oder zu „kein Gebiet“ zählt nicht.
 */
export function crossingsOf(runs: readonly Run[], minMiles: number): Crossings {
    const kept = runs.filter((run, index) => index === 0 || run.miles >= minMiles);
    const names = kept.map((run) => run.name).filter((name, index, all) => index === 0 || name !== all[index - 1]);
    const pairs: string[] = [];
    for (let index = 1; index < names.length; index += 1) {
        const before = names[index - 1] as string;
        const after = names[index] as string;
        if (before !== "" && after !== "") pairs.push(`${before} > ${after}`);
    }
    return { count: pairs.length, pairs };
}

/** Die Übertritte einer Zählung von A als `von > nach`, in Reihenfolge der Reise; ohne Ergebnis keine. */
export const pairsOf = (count: BorderCount | null): string[] =>
    (count?.crossings ?? []).map((crossing) => `${crossing.from.name} > ${crossing.to.name}`);

/**
 * Ob die Übertritte `pairs` aus diesen exakten Läufen entstehen KÖNNEN, so wie eine Abtastung mit dem Schritt `slack`
 * (in Meilen) sie sieht. Sie misst jeden Lauf bis auf einen Schritt genau, deshalb:
 *
 * - ein Lauf, der höchstens `slack` Meilen von der Schwelle liegt, darf bleiben ODER wegfallen;
 * - ein Lauf, kürzer als ein Schritt, darf ihr ganz entgehen (kein Abtastpunkt darin); dann sind seine Nachbarn EIN Lauf,
 *   und für dessen Länge (samt der des übersehenen) gilt wieder dasselbe.
 *
 * Alles andere liegt für Abtastung und exakte Rechnung auf derselben Seite der Schwelle, und es gilt die Regel von
 * `crossingsOf` (der erste Lauf bleibt, gleiche Nachbarn verschmelzen, ein Wechsel von oder zu „kein Gebiet“ zählt nicht).
 * Mit `free` dürfen nur die Läufe so abweichen, für deren Index es `true` liefert; die übrigen gelten exakt.
 *
 * 🪤 Die Toleranz ist eine Menge, keine Zahl (Befund 2026-10-26, WI-0065): Folgt ein Weg einer Grenze und kreuzt sie alle
 * paar Meilen, liegen viele Läufe nahe der Schwelle oder unter einem Schritt, und die Abtastung sieht jeden davon für sich
 * anders. Zwei solche Läufe heben sich in der Zahl auf und verschieben trotzdem die Übertritte (Simiador > Nhiran: A und B2
 * je 23); ein einzelner zwischen gleichen Nachbarn verschiebt die Zahl um zwei (Salzmarken > Fairnhain zurück: 4 gegen 2);
 * ein übersehener Streifen von 1,04 Meilen macht aus zwei kurzen Läufen einen über der Schwelle (Gareth > Havena: 6 gegen 4).
 * Eine Zahl als Toleranz verwirft das und übersieht falsche Übertritte gleicher Zahl.
 *
 * Gerechnet als Suche über Zustände (wie viele Übertritte erklärt sind, Gebiet des letzten bleibenden Laufs, der offene Lauf
 * der Abtastung), nicht über alle Wahlen.
 */
export function explainedBy(
    runs: readonly Run[],
    minMiles: number,
    slack: number,
    pairs: readonly string[],
    free: (index: number) => boolean = () => true,
): boolean {
    interface State {
        done: number;
        /** Das Gebiet des letzten bleibenden Laufs; `null`, solange keiner abgeschlossen ist (der erste bleibt immer). */
        last: string | null;
        /** Der Lauf der Abtastung, der noch wächst; `loose`, wenn seine Länge um einen Schritt abweichen darf. */
        open: { name: string; miles: number; loose: boolean } | null;
    }
    // Über der Schwelle samt Spielraum ist jede Länge gleich gut: Das hält die Zahl der Zustände klein.
    const ceiling = minMiles + slack + 1;
    const grow = (miles: number, more: number): number => Math.min(ceiling, miles + more);
    const keyOf = (state: State): string =>
        [
            state.done,
            state.last ?? "\u0001",
            state.open?.name ?? "\u0001",
            state.open?.miles.toFixed(9) ?? "",
            state.open?.loose ?? "",
        ].join("\u0000");
    // Der offene Lauf endet: Er bleibt (der erste immer) oder fällt weg, je nachdem, was seine Länge zulässt.
    const close = (state: State): State[] => {
        const open = state.open;
        if (open === null) return [state];
        const reach = open.loose ? slack : 0;
        const closed: State[] = [];
        if (state.last !== null && open.miles - reach < minMiles) closed.push({ ...state, open: null });
        if (state.last === null || open.miles + reach >= minMiles) {
            const { last } = state;
            if (last === null || last === open.name || last === "" || open.name === "") {
                closed.push({ done: state.done, last: open.name, open: null });
            } else if (pairs[state.done] === `${last} > ${open.name}`) {
                closed.push({ done: state.done + 1, last: open.name, open: null });
            }
        }
        return closed;
    };

    const start: State = { done: 0, last: null, open: null };
    let states = new Map<string, State>([[keyOf(start), start]]);
    for (const [index, run] of runs.entries()) {
        const loose = free(index);
        const next = new Map<string, State>();
        const put = (state: State): void => {
            next.set(keyOf(state), state);
        };
        for (const state of states.values()) {
            const open = state.open;
            // Kein Abtastpunkt im Lauf: Seine Länge gehört zum offenen Lauf.
            if (loose && run.miles < slack) {
                put(
                    open === null
                        ? state
                        : { ...state, open: { ...open, miles: grow(open.miles, run.miles), loose: true } },
                );
            }
            // Gesehen: derselbe Name verlängert den offenen Lauf, ein anderer schließt ihn.
            if (open !== null && open.name === run.name) {
                put({ ...state, open: { ...open, miles: grow(open.miles, run.miles), loose: open.loose || loose } });
            } else {
                for (const closed of close(state)) {
                    put({ ...closed, open: { name: run.name, miles: grow(0, run.miles), loose } });
                }
            }
        }
        if (next.size === 0) return false;
        states = next;
    }
    return [...states.values()].some((state) => close(state).some((closed) => closed.done === pairs.length));
}

const pointsOf = (segment: BorderSegment): readonly (readonly [number, number])[] => segment.geometry.coordinates;

/** Die Länge der Linien in Meilen: Summe der Strecken zwischen aufeinanderfolgenden Punkten je Abschnitt. */
export function lineMiles(segments: readonly BorderSegment[]): number {
    let total = 0;
    for (const segment of segments) {
        const points = pointsOf(segment);
        for (let index = 0; index < points.length - 1; index += 1) {
            const from = points[index] as readonly [number, number];
            const to = points[index + 1] as readonly [number, number];
            total += Math.hypot(to[0] - from[0], to[1] - from[1]) * MILES_PER_UNIT;
        }
    }
    return total;
}

/** Dieselbe Reise rückwärts: die Abschnitte in umgekehrter Reihenfolge, jede Linie umgekehrt. */
export function reverseSegments(segments: readonly BorderSegment[]): BorderSegment[] {
    return [...segments]
        .reverse()
        .map((segment) => ({ geometry: { coordinates: [...segment.geometry.coordinates].reverse() } }));
}

/**
 * B3: die Abtastung von Legacy und A (Schritt `abtastschritt`, je Punkt das erste Gebiet der Liste), aber mit eigener
 * Schleife und `territoryAtPoint` als Punkttest, und die Läufe als Liste statt gezählt. Ein anderer Schritt nur für die
 * Suche nach Zeugen der Regelmutanten.
 */
export function sampledRuns(
    segments: readonly BorderSegment[],
    territories: readonly BorderTerritory[],
    step = BORDER_RULE.abtastschritt,
): Run[] {
    const runs: Run[] = [];
    for (const segment of segments) {
        const points = pointsOf(segment);
        for (let index = 0; index < points.length - 1; index += 1) {
            const [x0, y0] = points[index] as readonly [number, number];
            const [x1, y1] = points[index + 1] as readonly [number, number];
            const span = Math.hypot(x1 - x0, y1 - y0);
            const steps = Math.max(1, Math.round(span / step));
            const stepMiles = (span / steps) * MILES_PER_UNIT;
            for (let step = 0; step < steps; step += 1) {
                const at = step / steps;
                const name = territoryAtPoint(territories, x0 + (x1 - x0) * at, y0 + (y1 - y0) * at)?.name ?? "";
                const last = runs[runs.length - 1];
                if (last?.name === name) last.miles += stepMiles;
                else runs.push({ name, miles: stepMiles });
            }
        }
    }
    return runs;
}

export interface ExactRuns {
    runs: Run[];
    /** Länge aller Abschnitte laut PostGIS in Meilen (bei Abschnitten ohne Treffer aus den Punkten). */
    miles: number;
    /** Wo die Läufe liegen: je Stück der Index des Laufs, die Linie (Index in `lines`) und der Anteil von bis auf ihr. */
    pieces: { run: number; line: number; from: number; to: number }[];
    /** Die Abschnitte als PostGIS-Linien (WKT), auf die `pieces` zeigen. */
    lines: string[];
}

/** Ein Lauf auf einem Weg, der der Grenze folgt (`ExactBorders.alongBorder`): sein Gebiet, seine Länge, sein erster Punkt. */
export interface BorderRoadRun {
    name: string;
    miles: number;
    x: number | null;
    y: number | null;
}

/** Ein Abschnitt als PostGIS-Linie: aufeinanderfolgende gleiche Punkte entfallen; unter zwei Punkten gibt es keine Linie. */
function wktOf(segment: BorderSegment): string | null {
    const points: (readonly [number, number])[] = [];
    for (const point of pointsOf(segment)) {
        const last = points[points.length - 1];
        if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
    }
    if (points.length < 2) return null;
    return `LINESTRING(${points.map((point) => `${String(point[0])} ${String(point[1])}`).join(",")})`;
}

/**
 * B2: die exakte Rechnung. Je Abschnitt schneidet PostGIS die Linie mit jeder Wurzel des Bandes 0 (`ST_Intersection`);
 * die Stücke werden mit `ST_LineLocatePoint` an Anfang und Ende auf der Linie verortet. Wo Wurzeln überlappen, gewinnt
 * die in Legacys Reihenfolge vordere; aus den Längen zwischen den Schnittpunkten entstehen dieselben Läufe wie bei der
 * Abtastung, nur ohne deren Raster. Läufe gleichen Namens verschmelzen auch über Abschnittsgrenzen (wie in Legacy).
 * 🪤 Je ABSCHNITT, nicht als eine Linie über die ganze Reise: Zwischen zwei Abschnitten klafft oft eine Lücke (766 von
 * 6.731 Übergängen an den Beispielreisen, bis 1,7 Meilen), die die Abtastung nicht überspringt und eine Gesamtlinie
 * als Sprung mitrechnen würde.
 */
export class ExactBorders {
    // 🪤 Keine Parameter-Eigenschaften: Node führt die CLI (`scripts/dev/compare-tolls.ts`) unter Type-Stripping aus,
    // und dort gibt es sie nicht; Vitest würde es verdecken.
    private readonly database: Queryable;
    private readonly mapDomainId: string;
    private readonly roots: readonly OracleRoot[];
    private readonly rank = new Map<string, number>();

    constructor(database: Queryable, mapDomainId: string, roots: readonly OracleRoot[]) {
        this.database = database;
        this.mapDomainId = mapDomainId;
        this.roots = roots;
        roots.forEach((root, index) => this.rank.set(root.id, index));
    }

    async runs(segments: readonly BorderSegment[]): Promise<ExactRuns> {
        const lines: { wkt: string; miles: number }[] = [];
        for (const segment of segments) {
            const wkt = wktOf(segment);
            if (wkt !== null) lines.push({ wkt, miles: lineMiles([segment]) });
        }
        if (lines.length === 0) return { runs: [], miles: 0, pieces: [], lines: [] };
        const wkts = lines.map((line) => line.wkt);
        const rows = await this.database<{ ord: number; pid: string; f0: number; f1: number; total: number }[]>`
            WITH seg AS (
                SELECT u.ord::int AS ord, ST_GeomFromText(u.wkt, 0) AS g
                FROM unnest(${wkts}::text[]) WITH ORDINALITY AS u(wkt, ord)
            ),
            piece AS (
                SELECT seg.ord, t.public_id::text AS pid, seg.g,
                       (ST_Dump(ST_Intersection(seg.g, s.geom))).geom AS pg
                FROM seg
                JOIN territory_shape s ON s.band = 0 AND s.parent_id IS NULL AND ST_Intersects(seg.g, s.geom)
                JOIN territory t ON t.id = s.territory_id AND t.map_domain_id = ${this.mapDomainId} AND t.is_active
            )
            SELECT ord, pid,
                   ST_LineLocatePoint(g, ST_StartPoint(pg)) AS f0,
                   ST_LineLocatePoint(g, ST_EndPoint(pg)) AS f1,
                   ST_Length(g) AS total
            FROM piece
            WHERE GeometryType(pg) = 'LINESTRING'
        `;
        const runs: Run[] = [];
        const pieces: ExactRuns["pieces"] = [];
        const add = (name: string, miles: number, line: number, from: number, to: number): void => {
            const last = runs[runs.length - 1];
            if (last?.name === name) last.miles += miles;
            else runs.push({ name, miles });
            pieces.push({ run: runs.length - 1, line, from, to });
        };
        let miles = 0;
        for (const [index, line] of lines.entries()) {
            const own = rows.filter((row) => row.ord === index + 1);
            const total = own[0] ? own[0].total * MILES_PER_UNIT : line.miles;
            miles += total;
            const spans = own
                .map((row) => ({
                    rank: this.rank.get(row.pid) ?? Number.POSITIVE_INFINITY,
                    from: Math.min(row.f0, row.f1),
                    to: Math.max(row.f0, row.f1),
                }))
                .filter((span) => span.to > span.from);
            const cuts = [...new Set([0, 1, ...spans.flatMap((span) => [span.from, span.to])])].sort((a, b) => a - b);
            for (let cut = 0; cut < cuts.length - 1; cut += 1) {
                const from = cuts[cut] as number;
                const to = cuts[cut + 1] as number;
                if (to - from < 1e-12) continue;
                const middle = (from + to) / 2;
                const winner = Math.min(
                    ...spans.filter((span) => span.from <= middle && middle <= span.to).map((span) => span.rank),
                );
                const name = Number.isFinite(winner) ? (this.roots[winner]?.name ?? "") : "";
                add(name, (to - from) * total, index, from, to);
            }
        }
        return { runs, miles, pieces, lines: wkts };
    }

    /**
     * Welche Läufe auf einem Weg liegen, der der Grenze FOLGT: Jeder Punkt des Laufs (Stützpunkte alle 0,1 Einheiten) liegt
     * höchstens `within` Einheiten neben der Grenze einer Wurzel des Bandes 0. Gefragt wird nur bei Läufen unter `maxMiles`
     * Meilen; ein längerer Lauf ist nie „auf der Grenze“. Je Lauf der Befund mit seinem ersten Punkt, sonst `null`.
     *
     * Dort entscheidet die Abtastung je Punkt, auf welcher Seite einer gezeichneten Linie der Weg liegt, und die Zählung
     * hängt an Unterschieden unterhalb ihrer Auflösung (Befund 2026-10-26: Wege entlang der Grenzen Kalifat, Aranien und
     * Rashdul, Garether Reich und Isnatosch).
     */
    async alongBorder(exact: ExactRuns, within: number, maxMiles: number): Promise<(BorderRoadRun | null)[]> {
        const asked = exact.pieces.filter(
            (piece) => (exact.runs[piece.run]?.miles ?? Number.POSITIVE_INFINITY) < maxMiles,
        );
        const result: (BorderRoadRun | null)[] = exact.runs.map(() => null);
        if (asked.length === 0) return result;
        const rows = await this.database<{ i: number; along: boolean | null; x: number | null; y: number | null }[]>`
            WITH span AS (
                SELECT u.i::int AS i, ST_LineSubstring(ST_GeomFromText(u.wkt, 0), u.f0, u.f1) AS g
                FROM unnest(
                    ${asked.map((piece) => exact.lines[piece.line] ?? "")}::text[],
                    ${asked.map((piece) => piece.from)}::float8[],
                    ${asked.map((piece) => piece.to)}::float8[]
                ) WITH ORDINALITY AS u(wkt, f0, f1, i)
            ),
            border AS MATERIALIZED (
                SELECT ST_Boundary(s.geom) AS b
                FROM territory_shape s
                JOIN territory t ON t.id = s.territory_id AND t.map_domain_id = ${this.mapDomainId} AND t.is_active
                WHERE s.band = 0 AND s.parent_id IS NULL
            )
            SELECT span.i, ST_X(ST_StartPoint(span.g)) AS x, ST_Y(ST_StartPoint(span.g)) AS y,
                   (SELECT bool_and(EXISTS (SELECT 1 FROM border WHERE ST_DWithin(d.geom, border.b, ${within})))
                    FROM ST_DumpPoints(ST_Segmentize(span.g, 0.1)) AS d) AS along
            FROM span
        `;
        const along = new Map<number, boolean>();
        const start = new Map<number, { x: number | null; y: number | null }>();
        for (const row of [...rows].sort((a, b) => a.i - b.i)) {
            const piece = asked[row.i - 1];
            if (piece === undefined) continue;
            along.set(piece.run, (along.get(piece.run) ?? true) && row.along === true);
            if (!start.has(piece.run)) start.set(piece.run, { x: row.x, y: row.y });
        }
        for (const [index, run] of exact.runs.entries()) {
            if (along.get(index) === true)
                result[index] = { name: run.name, miles: run.miles, ...(start.get(index) ?? { x: null, y: null }) };
        }
        return result;
    }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Eine Reise, drei Rechenwege                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

export interface OracleContext {
    /** Die Gebiete, wie der Routing-Worker sie hält und A sie zählt. */
    territories: readonly BorderTerritory[];
    /** Das Anzeigejahr der Ableitung. */
    yearBf: number | null;
    /** Die Wurzeln, unabhängig vom Lader gelesen (B1, B2). */
    roots: readonly OracleRoot[];
    /** Legacys Zählung und seine für B1 aufbereiteten Gebiete; `null` ohne Mirror. */
    legacy: { code: LegacyBorders; territories: unknown[] } | null;
    exact: ExactBorders;
}

/** Legacys Gebiete: dieselben GeoJSON-Formen wie A, durch Legacys eigene Aufbereitung. */
export function legacyTerritories(code: LegacyBorders, roots: readonly OracleRoot[]): unknown[] {
    return roots
        .map((root) => code.prepare({ type: "Feature", properties: { name: root.name }, geometry: root.geometry }))
        .filter(Boolean);
}

export interface OracleRow {
    trip: OracleTrip;
    segments: BorderSegment[];
    /** Die Länge der Linien in Meilen. */
    miles: number;
    a: BorderCount | null;
    aMs: number;
    /** Legacys Ergebnis; `null` ohne Mirror. */
    b1: number | null;
    b1Ms: number | null;
    b2: Crossings;
    b2Ms: number;
    b3: Crossings;
    exact: ExactRuns;
    sampledMiles: number;
    /** Dieselbe Linie rückwärts: die Zahl und die Übertritte von A (`null` ohne Ergebnis), die Zahl von B2. */
    back: { a: number | null; aPairs: string[] | null; b2: number };
    /** Was der Dienst im Ergebnis meldet. */
    served: NonNullable<RouteResponse["travel_costs"]>;
    /** Die exakten Läufe innerhalb eines Abtastschritts um die Schwelle. */
    borderline: Run[];
    /**
     * Zählen A und B2 verschieden, und erklären das allein Läufe auf einem Weg, der der Grenze folgt (`alongBorder`): diese
     * Läufe. Ein solcher Grenzfall ist ein Befund an den Gebietsgrenzen, er zählt nicht in die 3 % des Korpus. Sonst `null`.
     */
    borderRoad: BorderRoadRun[] | null;
    problems: string[];
}

const milliseconds = (start: number): number => performance.now() - start;

/** Rechnet eine Reise auf allen Wegen und prüft sie gegen die Kontrollen (a) bis (c). */
export async function measureTrip(context: OracleContext, routed: RoutedTrip): Promise<OracleRow> {
    const { response, trip } = routed;
    if (!response?.travel_costs) throw new Error(`${trip.label}: ${routed.skipped ?? "kein Ergebnis"}`);
    const segments: BorderSegment[] = response.segments;
    const min = BORDER_RULE.mindestLaufMeilen;

    let start = performance.now();
    const a = countBorderCrossings(segments, context.territories, MILES_PER_UNIT, BORDER_RULE);
    const aMs = milliseconds(start);

    let b1: number | null = null;
    let b1Ms: number | null = null;
    if (context.legacy) {
        start = performance.now();
        b1 = context.legacy.code.count(segments, context.legacy.territories);
        b1Ms = milliseconds(start);
    }

    start = performance.now();
    const exact = await context.exact.runs(segments);
    const b2 = crossingsOf(exact.runs, min);
    const b2Ms = milliseconds(start);

    const sampled = sampledRuns(segments, context.territories);
    const b3 = crossingsOf(sampled, min);
    const aBack = countBorderCrossings(reverseSegments(segments), context.territories, MILES_PER_UNIT, BORDER_RULE);
    const back = {
        a: aBack?.count ?? null,
        aPairs: aBack === null ? null : pairsOf(aBack),
        b2: crossingsOf([...exact.runs].reverse(), min).count,
    };
    const borderline = exact.runs.filter((run) => Math.abs(run.miles - min) <= STEP_MILES);
    let borderRoad: BorderRoadRun[] | null = null;
    if (a !== null && a.count !== b2.count) {
        const along = await context.exact.alongBorder(exact, BORDER_RULE.abtastschritt, min + STEP_MILES);
        if (explainedBy(exact.runs, min, STEP_MILES, pairsOf(a), (index) => (along[index] ?? null) !== null)) {
            borderRoad = along.filter((run): run is BorderRoadRun => run !== null);
        }
    }

    const row: OracleRow = {
        trip,
        segments,
        miles: lineMiles(segments),
        a,
        aMs,
        b1,
        b1Ms,
        b2,
        b2Ms,
        b3,
        exact,
        sampledMiles: sampled.reduce((sum, run) => sum + run.miles, 0),
        back,
        served: response.travel_costs,
        borderline,
        borderRoad,
        problems: [],
    };
    row.problems = problemsOf(row, context.yearBf);
    return row;
}

/** Ob A und B2 verschieden zählen (Grenzfall, wenn erklärt). */
export const deviates = (row: OracleRow): boolean => (row.a?.count ?? null) !== row.b2.count;

/**
 * A gegen B2 und die Kontrolle (b) an einer Reise: aus den exakten Läufen (B2) und den Übertritten von A hin und zurück
 * (`back`: `null`, wenn A rückwärts kein Ergebnis hat).
 *
 * - **A gegen B2:** Die Übertritte von A müssen aus den exakten Läufen entstehen können, hin über die Läufe, zurück über
 *   dieselben Läufe umgekehrt (`explainedBy`, Spielraum ein Abtastschritt). Ohne Lauf nahe der Schwelle oder unter einem
 *   Schritt heißt das: dieselben Übertritte in derselben Reihenfolge; mit solchen Läufen gilt die Toleranz je Lauf, nicht
 *   als Zahl.
 * - **(b) Der Rückweg derselben Linie:** höchstens um 1 anders, und nur, wo Start- oder Ziellauf kürzer als die Schwelle ist
 *   (die Legacy-Eigenheit). Anders nur, wenn die Abtastung beide Richtungen aus den exakten Läufen erklärt: Der Rückweg
 *   tastet dieselbe Linie an anderen Punkten ab und darf jeden dieser Läufe anders sehen (Befund 2026-10-26, Salzmarken >
 *   Fairnhain: hin 2, zurück 4; Al'Ahabad > Ohort: 9 und 11).
 */
export function crossingProblems(
    exact: readonly Run[],
    forward: readonly string[],
    back: readonly string[] | null,
): string[] {
    const problems: string[] = [];
    const min = BORDER_RULE.mindestLaufMeilen;
    const reversed = [...exact].reverse();
    const b2 = crossingsOf(exact, min);
    const b2Back = crossingsOf(reversed, min);
    // Was die Abtastung anders sehen darf: Läufe nahe der Schwelle und Läufe unter einem Schritt (`explainedBy`).
    const near = exact.filter((run) => Math.abs(run.miles - min) <= STEP_MILES).length;
    const short = exact.filter((run) => run.miles < STEP_MILES).length;
    const because = `nicht erklärt durch die Abtastung (${String(near)} Läufe nahe ${String(min)} Meilen, ${String(short)} unter einem Schritt)`;
    const list = (pairs: readonly string[]): string => pairs.join(", ") || "keine";

    const forwardExplained = explainedBy(exact, min, STEP_MILES, forward);
    const backExplained = back !== null && explainedBy(reversed, min, STEP_MILES, back);
    if (!forwardExplained) {
        problems.push(
            `A ${String(forward.length)} ≠ B2 ${String(b2.count)}, ${because}: A ${list(forward)} / B2 ${list(b2.pairs)}`,
        );
    }
    if (!backExplained) {
        problems.push(
            back === null
                ? `Rückweg: A ohne Ergebnis ≠ B2 ${String(b2Back.count)}`
                : `Rückweg: A ${String(back.length)} ≠ B2 ${String(b2Back.count)}, ${because}: A ${list(back)} / B2 ${list(b2Back.pairs)}`,
        );
    }

    const first = exact[0];
    const last = exact[exact.length - 1];
    const endShort = (limit: number): boolean =>
        (first !== undefined && first.miles < limit) || (last !== undefined && last.miles < limit);
    const count = forward.length;
    const backCount = back?.length ?? null;
    // Erklärt die Abtastung beide Richtungen, ist auch ihr Unterschied erklärt: Der Rückweg tastet an anderen Punkten ab.
    const sampled = near + short > 0 && forwardExplained && backExplained;
    if (backCount === null || (Math.abs(count - backCount) > 1 && !sampled)) {
        problems.push(`(b) Hin ${String(count)}, zurück ${String(backCount)}: mehr als 1 Unterschied`);
    } else if (count !== backCount && !endShort(min + STEP_MILES) && !sampled) {
        problems.push(
            `(b) Hin ${String(count)}, zurück ${String(backCount)}, obwohl Start- und Ziellauf lang sind (${first?.miles.toFixed(2) ?? "-"} und ${last?.miles.toFixed(2) ?? "-"} Meilen)`,
        );
    }
    // B2 kehrt dieselben exakten Läufe um: Hin und zurück unterscheiden sich nur, wenn ein Ende kürzer als die Schwelle ist.
    if (b2Back.count !== b2.count && !endShort(min)) {
        problems.push(
            `(b) B2 zählt hin ${String(b2.count)}, zurück ${String(b2Back.count)}, obwohl beide Enden lang sind`,
        );
    }
    return problems;
}

/** Alles, was an einer Reise nicht stimmt: A gegen B1, B3 und B2 (`crossingProblems`), die Kontrollen (a) bis (c). */
export function problemsOf(row: OracleRow, yearBf: number | null): string[] {
    const problems: string[] = [];
    const count = row.a?.count ?? null;
    if (count === null) return [`A liefert kein Ergebnis (keine Gebiete geladen?)`];

    if (row.b1 !== null && row.b1 !== count)
        problems.push(`A ${String(count)} ≠ B1 ${String(row.b1)} (Fehler im Port)`);
    if (row.b3.count !== count) {
        problems.push(`A ${String(count)} ≠ B3 ${String(row.b3.count)} (gleiche Abtastung, andere Zusammenfassung)`);
    }
    problems.push(...crossingProblems(row.exact.runs, pairsOf(row.a), row.back.aPairs));

    // (a) Die Summe der Lauflängen gleicht der Länge der Linie; exakt und abgetastet.
    const exactSum = row.exact.runs.reduce((sum, run) => sum + run.miles, 0);
    const slack = Math.max(1e-6, row.miles * 1e-6);
    if (Math.abs(row.exact.miles - row.miles) > slack) {
        problems.push(`(a) Länge laut PostGIS ${row.exact.miles.toFixed(3)} ≠ Linie ${row.miles.toFixed(3)} Meilen`);
    }
    if (Math.abs(exactSum - row.exact.miles) > slack) {
        problems.push(
            `(a) Summe der exakten Läufe ${exactSum.toFixed(3)} ≠ Länge ${row.exact.miles.toFixed(3)} Meilen`,
        );
    }
    if (Math.abs(row.sampledMiles - row.miles) > STEP_MILES) {
        problems.push(
            `(a) Summe der abgetasteten Läufe ${row.sampledMiles.toFixed(3)} ≠ Linie ${row.miles.toFixed(3)} Meilen`,
        );
    }

    // (c) Das Ergebnis des Dienstes: dieselbe Zahl, Zoll je Stufe = Grenzen mal Tafel, wachsend mit der Stufe.
    const served = row.served;
    if (served.borders?.count !== count) {
        problems.push(
            `(c) der Dienst meldet ${String(served.borders?.count ?? null)} Grenzen, A zählt ${String(count)}`,
        );
    }
    if (served.territory_year_bf !== yearBf) {
        problems.push(`(c) Anzeigejahr im Ergebnis ${String(served.territory_year_bf)}, geladen ${String(yearBf)}`);
    }
    let previous = -1;
    for (const level of LODGING_LEVELS) {
        const toll = served.by_lodging[level].rows.find((line) => line.key === "tolls");
        const expected: number = model.reisekosten.zoll.wert[level] * count;
        if (toll?.heller !== expected || toll?.count !== count) {
            problems.push(
                `(c) Zoll ${level}: ${String(toll?.heller)} Heller bei ${String(toll?.count)} Grenzen, erwartet ${String(expected)}`,
            );
        }
        if (toll?.status !== "SOURCE_RULE") problems.push(`(c) Zoll ${level}: Status ${String(toll?.status)}`);
        if ((toll?.heller ?? -1) < previous) problems.push(`(c) Zoll ${level} sinkt gegen die Stufe davor`);
        previous = toll?.heller ?? previous;
    }
    return problems;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Zusammenfassung                                                                                              */
/* ------------------------------------------------------------------------------------------------------------ */

export interface OracleSummary {
    trips: number;
    /** Reisen mit Ergebnis von B1 (ohne Mirror 0). */
    b1Compared: number;
    aEqualsB1: number;
    aEqualsB2: number;
    /** A und B2 zählen verschieden (jede Ausnahme mit Reise und Länge des Laufs). */
    deviations: OracleRow[];
    /** Davon die Grenzfälle auf einem Weg, der der Grenze folgt (`borderRoad`): ein Befund, nicht in den 3 %. */
    borderRoads: OracleRow[];
    /** Die übrigen Grenzfälle: Sie zählen gegen die 3 % des Korpus (`maxDeviations`). */
    counted: OracleRow[];
    /** Reisen mit einem exakten Lauf innerhalb eines Abtastschritts um die Schwelle. */
    nearRoutes: number;
    crossings: number;
    most: OracleRow | undefined;
    problems: { trip: string; problem: string }[];
    timesMs: { a: Timing; b1: Timing | null; b2: Timing };
}

export interface Timing {
    total: number;
    median: number;
    p95: number;
    max: number;
}

function timing(values: readonly number[]): Timing {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
    return { total: sorted.reduce((sum, value) => sum + value, 0), median: at(0.5), p95: at(0.95), max: at(1) };
}

export function summarizeRows(rows: readonly OracleRow[]): OracleSummary {
    const withB1 = rows.filter((row) => row.b1 !== null);
    const most = [...rows].sort((a, b) => (b.a?.count ?? 0) - (a.a?.count ?? 0))[0];
    return {
        trips: rows.length,
        b1Compared: withB1.length,
        aEqualsB1: withB1.filter((row) => row.b1 === (row.a?.count ?? null)).length,
        aEqualsB2: rows.filter((row) => !deviates(row)).length,
        deviations: rows.filter(deviates),
        borderRoads: rows.filter((row) => deviates(row) && row.borderRoad !== null),
        counted: rows.filter((row) => deviates(row) && row.borderRoad === null),
        nearRoutes: rows.filter((row) => row.borderline.length > 0).length,
        crossings: rows.reduce((sum, row) => sum + (row.a?.count ?? 0), 0),
        most,
        problems: rows.flatMap((row) => row.problems.map((problem) => ({ trip: row.trip.label, problem }))),
        timesMs: {
            a: timing(rows.map((row) => row.aMs)),
            b1: withB1.length > 0 ? timing(withB1.map((row) => row.b1Ms ?? 0)) : null,
            b2: timing(rows.map((row) => row.b2Ms)),
        },
    };
}

/**
 * Wie viele Grenzfälle der Korpus verträgt: höchstens 3 % (WI-0065), abgerundet. Gezählt wird `counted`: Grenzfälle auf einem
 * Weg, der der Grenze folgt, sind ein Befund an den Gebietsgrenzen (Befund 2026-10-26: acht Reisen über dieselbe Straße
 * an der Grenze von Isnatosch), keine Aussage über die Zählung.
 */
export const maxDeviations = (trips: number): number => Math.floor(trips * 0.03);

/** Die Länge des Laufs, der eine Abweichung erklärt, als Text für das Protokoll. */
export function describeDeviation(row: OracleRow): string {
    const runs = row.borderline.map((run) => `${run.name || "kein Gebiet"} ${run.miles.toFixed(2)} Meilen`);
    const text = `${row.trip.label}: A ${String(row.a?.count)}, B2 ${String(row.b2.count)}; Lauf nahe der Schwelle: ${runs.join("; ") || "keiner"}`;
    return row.borderRoad === null ? text : `${text}; ${describeBorderRoad(row.borderRoad)}`;
}

/** Ein Weg auf der Grenze als Text: die Gebiete und die Hülle der ersten Punkte seiner Läufe. */
export function describeBorderRoad(runs: readonly BorderRoadRun[]): string {
    const names = [...new Set(runs.map((run) => run.name || "kein Gebiet"))].sort();
    const xs = runs.flatMap((run) => (run.x === null ? [] : [run.x]));
    const ys = runs.flatMap((run) => (run.y === null ? [] : [run.y]));
    const box =
        xs.length === 0
            ? "-"
            : `x ${Math.min(...xs).toFixed(1)} bis ${Math.max(...xs).toFixed(1)}, y ${Math.min(...ys).toFixed(1)} bis ${Math.max(...ys).toFixed(1)}`;
    return `Weg auf der Grenze (${String(runs.length)} Läufe; ${names.join(", ")}; ${box})`;
}

/** Die Zahl der Grenzen bei einer anderen Schwelle: A und B2 (Abnahme Z2). */
export function countsAtThreshold(
    context: OracleContext,
    row: OracleRow,
    threshold: number,
): { a: number; b2: number } {
    const rule = { ...BORDER_RULE, mindestLaufMeilen: threshold };
    return {
        a: countBorderCrossings(row.segments, context.territories, MILES_PER_UNIT, rule)?.count ?? 0,
        b2: crossingsOf(row.exact.runs, threshold).count,
    };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Zeugen der Regelmutanten                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

export interface RuleMutant {
    name: string;
    rule: BorderRule;
}

/** Die Regelmutanten der Prüfung „der Oracle ist nicht blind“: Schwelle zu hoch, zu niedrig, Raster zu grob. */
export const RULE_MUTANTS: readonly RuleMutant[] = [
    { name: "Schwelle 8 statt 5 Meilen", rule: { ...BORDER_RULE, mindestLaufMeilen: 8 } },
    { name: "Schwelle 3 statt 5 Meilen", rule: { ...BORDER_RULE, mindestLaufMeilen: 3 } },
    { name: "Abtastschritt 1,2 statt 0,4 Einheiten", rule: { ...BORDER_RULE, abtastschritt: 1.2 } },
];

/**
 * Ob ein Regelmutant an dieser Linie anders zählt als die Regel. Gerechnet mit B3 (eigene Abtastschleife,
 * Zusammenfassung von B2), nie mit A: Die Suche setzt den Port, den die Prüfung bewacht, nicht voraus.
 */
export function mutantShows(
    segments: readonly BorderSegment[],
    territories: readonly BorderTerritory[],
    rule: BorderRule,
): boolean {
    const count = (step: number, minMiles: number): number =>
        crossingsOf(sampledRuns(segments, territories, step), minMiles).count;
    return (
        count(rule.abtastschritt, rule.mindestLaufMeilen) !==
        count(BORDER_RULE.abtastschritt, BORDER_RULE.mindestLaufMeilen)
    );
}

/** Über wie viele Seeds die Suche höchstens geht (je rund 196 Reisen, ab `DEFAULT_SEED`). */
export const WITNESS_SEEDS = 5;

export interface MutantWitnesses {
    /** Je gefundenem Mutanten die Reise, an der er sich zeigt. */
    found: { mutant: string; trip: string }[];
    /** Die gesuchten Reisen, die die Gemessenen noch nicht enthielten: Sie werden mit `measureTrip` voll gemessen. */
    routed: RoutedTrip[];
    /** Mutanten ohne Zeugen nach der ganzen Suche. */
    missing: string[];
    /** Wie viele Reisen die Suche dafür gerechnet hat. */
    searched: number;
}

const tripKey = (trip: OracleTrip): string => `${trip.label}|${trip.waypoints.join(">")}`;

/**
 * Je Regelmutant eine Reise, an der er sich zeigt: gesucht, nicht gezogen (Befund 2026-10-11). Der grobe Abtastschritt
 * ändert die Zählung nur, wo ein langes gerades Stück eine Grenze so kreuzt, dass ein Lauf nahe der Schwelle auf die
 * andere Seite fällt; unter den 196 gezogenen Reisen des Seeds 65 sind das nach dem Zug `map179380` drei, in den
 * acht der kleinen Teilmenge keine mehr. Deshalb: erst unter den schon gemessenen Reisen, dann in der Reihenfolge der
 * gezogenen Reisen ab Seed 65 (höchstens `WITNESS_SEEDS` Seeds), bis jeder Mutant einen Zeugen hat. Die Zeugen sind
 * ausgesucht, nicht gezogen: Sie gehören in keine Statistik über den Korpus (3 % Grenzfälle), nur in die Prüfungen je
 * Reise.
 */
export async function findMutantWitnesses(
    database: Queryable,
    gate: GateService,
    territories: readonly BorderTerritory[],
    measured: readonly { trip: OracleTrip; segments: readonly BorderSegment[] }[],
): Promise<MutantWitnesses> {
    const found: MutantWitnesses["found"] = [];
    let open = [...RULE_MUTANTS];
    const settle = (label: string, segments: readonly BorderSegment[]): boolean => {
        const shown = open.filter((mutant) => mutantShows(segments, territories, mutant.rule));
        for (const mutant of shown) found.push({ mutant: mutant.name, trip: label });
        open = open.filter((mutant) => !shown.includes(mutant));
        return shown.length > 0;
    };
    const seen = new Set<string>();
    for (const row of measured) {
        seen.add(tripKey(row.trip));
        settle(row.trip.label, row.segments);
    }
    const routed: RoutedTrip[] = [];
    let searched = 0;
    for (let seed = DEFAULT_SEED; open.length > 0 && seed < DEFAULT_SEED + WITNESS_SEEDS; seed += 1) {
        for (const trip of await drawnTrips(database, seed)) {
            if (open.length === 0) break;
            if (seen.has(tripKey(trip))) continue;
            seen.add(tripKey(trip));
            const [one] = await routeTrips(gate, [trip]);
            searched += 1;
            if (one?.response && settle(trip.label, one.response.segments)) routed.push(one);
        }
    }
    return { found, routed, missing: open.map((mutant) => mutant.name), searched };
}
