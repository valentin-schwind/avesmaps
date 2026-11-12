import { FREE_SEA_EDGE_PREFIX } from "@avesmaps3d/shared";
import { lineLength, type RouteLink } from "./network.ts";
import { isTunnel, LAND_PATH_TYPES, SEA_TYPE, type Edge } from "./route-edge.ts";
import type { SeaFleet } from "./sea-free.ts";

/**
 * Stufe 2 des Routers, der Kern (Hardening Review M7): die Kanten EINER Anfrage. `RequestGraph` legt sich über
 * die Kanten des Profils (`route-graph.ts`) und nimmt auf, was nur diese Anfrage braucht: Anker auf Landwegen,
 * geteilte und gebogene Wege, die Kanten der freien Seefahrt. Das Profil bleibt unberührt und wird von den
 * nächsten Anfragen geteilt. Wie ein Wegpunkt oder Kartenpunkt daran hängt, steht in `request-links.ts`; die
 * Suche (`route-search.ts`) sieht nur die kleine Schnittstelle, die sie braucht (`SearchGraph`).
 */

/** Wie viele Fußpunkte, auf verschiedenen Wegen, ein Wegpunkt ohne Landweg höchstens bekommt. */
export const ANCHOR_LIMIT = 6;
/** Legacys Name für einen Fußpunkt. Die Karte beschriftet genau dieses Muster als „Kreuzung". */
export const ANCHOR_PREFIX = "__wp_anchor_";
/** Die Stücke eines an einem Anker geteilten Weges. */
export const SLICE_PREFIX = "wp-slice-";
/** Ein Fußpunkt, der so nah an einem Wegende liegt, teilt nicht, sondern nimmt den Endknoten. */
const SPLIT_EPSILON = 1e-7;

/**
 * Die Kanten einer Anfrage: die des Profils, dazu die Anker; geteilte und gebogene Wege sind ersetzt.
 * Entfernt wird ein Weg als Objekt, nicht über seine Kennung - eine gebogene Notverbindung behält sie.
 */
export class RequestGraph {
    private readonly extra = new Map<string, Edge[]>();
    private readonly removed = new Set<RouteLink>();
    /** Knoten, deren Liste sich geändert hat, mit ihrer zwischengespeicherten Liste. */
    private readonly touched = new Map<string, Edge[] | null>();
    private anchors = 0;
    private readonly base: Map<string, Edge[]>;
    /** Auf welchem Weg ein Anker liegt: Ein Gang dorthin endet gezeichnet auf dessen Kurve. */
    readonly anchorPaths = new Map<string, string>();
    /** Die Stücke eines geteilten Weges (ihre Kanten in Wegrichtung): Ein zweiter Anker teilt das richtige. */
    readonly pieces = new Map<RouteLink, Edge[]>();
    /** Aus welchem Weg der Karte ein Stück geschnitten ist (`joinPassedAnchors`). */
    readonly roots = new Map<RouteLink, RouteLink>();
    /** Die Anker der Ausstiege von Kartenpunkten (`anchorOn`): Durch sie fährt eine Route ohne Halt. */
    readonly exitAnchors = new Set<string>();
    private readonly sea: SeaFleet | null;
    private readonly seaLines = new Map<string, ReturnType<SeaFleet["line"]>>();

    constructor(base: Map<string, Edge[]>, sea: SeaFleet | null = null) {
        this.base = base;
        this.sea = sea;
    }

    /**
     * Die Kanten der freien Seefahrt ab einem Hafen, eine nach der anderen in DERSELBEN Hülle: Wer eine
     * behält, nimmt `keepSeaEdge`. So legt eine Suche nur die Kanten an, die ihren Weg verbessern.
     */
    forEachSeaEdge(node: string, visit: (edge: Edge) => void): void {
        const sea = this.sea;
        if (!sea?.has(node)) return;
        const link: RouteLink = {
            id: FREE_SEA_EDGE_PREFIX,
            pathPublicId: "",
            pathName: "",
            subtype: SEA_TYPE,
            from: node,
            to: node,
            coordinates: [],
            distance: 0,
            allowedTransports: null,
            transportDomain: null,
            flow: null,
            seasons: undefined,
            seasonLabel: "",
            seasonReason: undefined,
        };
        const edge: Edge = {
            to: node,
            link,
            forward: true,
            transport: sea.transport,
            distance: 0,
            time: 0,
            flowFactor: 1,
            flowState: "",
            costFactor: 1,
            synthetic: false,
            offroad: false,
            freeSea: true,
        };
        // Wie Querfeldein: Die Suche zahlt die Kosten des Küstenabstands, gemeldet wird die Länge. Die
        // Sperrzeit der Gebiete auf dem Weg prüft die Uhr der Suche wie bei jedem Seeweg (S5).
        sea.hops(node, (to, distance, cost, passage) => {
            link.to = to;
            link.distance = distance;
            link.seasons = passage.seasons;
            link.seasonLabel = passage.label;
            link.seasonReason = passage.reason;
            edge.to = to;
            edge.distance = cost;
            edge.time = cost / sea.speed;
            edge.costFactor = distance > 0 ? cost / distance : 1;
            visit(edge);
        });
    }

    /** Eine Seekante aus `forEachSeaEdge` als eigenes Objekt, mit Kennung und gerader Linie als Platzhalter. */
    keepSeaEdge(edge: Edge): Edge {
        const { from, to } = edge.link;
        const coordinates = this.sea?.chord(from, to) ?? [];
        return { ...edge, link: { ...edge.link, id: `${FREE_SEA_EDGE_PREFIX}${from}-${to}`, coordinates } };
    }

    /** Die Linie einer Seekante der gefundenen Route (`SeaFleet.line`); ohne Weg bleibt die gerade. */
    drawSeaEdge(edge: Edge): Edge {
        // Dieselbe Seereise zweimal in einer Anfrage (hin und zurück über Zwischenziele) bekommt ihre
        // Linie einmal: Jede kostet eine Suche im Seegraphen und das Glätten (Stage-Rollout 2026-09-27).
        const key = `${edge.link.from}\u0000${edge.link.to}`;
        let line = this.seaLines.get(key);
        if (line === undefined) {
            line = this.sea?.line(edge.link.from, edge.link.to) ?? null;
            this.seaLines.set(key, line);
        }
        if (!line) return edge;
        return { ...edge, link: { ...edge.link, coordinates: line.geometry }, display: line.display };
    }

    has(node: string): boolean {
        return this.base.has(node) || this.extra.has(node);
    }

    edges(node: string): readonly Edge[] {
        if (!this.touched.has(node)) return this.base.get(node) ?? [];
        let list = this.touched.get(node);
        if (!list) {
            list = [...(this.base.get(node) ?? []), ...(this.extra.get(node) ?? [])].filter(
                (edge) => !this.removed.has(edge.link),
            );
            this.touched.set(node, list);
        }
        return list;
    }

    nodes(): Set<string> {
        return new Set([...this.base.keys(), ...this.extra.keys()]);
    }

    add(additions: [string, Edge][]): void {
        for (const [from, edge] of additions) {
            const list = this.extra.get(from) ?? [];
            list.push(edge);
            this.extra.set(from, list);
            this.touched.set(from, null);
        }
    }

    remove(link: RouteLink): void {
        this.removed.add(link);
        this.touched.set(link.from, null);
        this.touched.set(link.to, null);
    }

    nextAnchor(): string {
        const name = `${ANCHOR_PREFIX}${String(this.anchors)}`;
        this.anchors += 1;
        return name;
    }
}

/** Ein Fußpunkt auf einem Wegstück: wo (Abschnitt `segment`, Anteil `t`, Lage `x`/`y`) und wie weit vom Punkt. */
export interface Anchor {
    edge: Edge;
    segment: number;
    t: number;
    x: number;
    y: number;
    distance: number;
}

/**
 * Die `limit` nächsten Fußpunkte auf Landwegen, EINER je Wegstück - sonst lägen alle Kandidaten auf
 * derselben Straße, und die schnelle zwei Täler weiter wäre nie dabei. Nie auf einem Tunnel (`isTunnel`).
 */
export function nearestLandPathAnchors(view: RequestGraph, px: number, py: number, limit: number): Anchor[] {
    return nearestAnchorsOfTypes(view, px, py, limit, LAND_PATH_TYPES);
}

/**
 * Dasselbe für eine beliebige Menge von Wegarten.
 *
 * 🔴 **Wofür** (Betreiber 2026-10-14): „Wenn eine Domäne sonst unerreichbar ist, soll er versuchen zum nächsten Punkt
 * querfeldein zu kommen.“ Ein Ort, an dem der Fluss 0,6 Einheiten vorbeiläuft, ohne ihn zu berühren, hing bisher nur an
 * seinen Landwegen — Solfurt an der Galebra, gemessen am 2026-10-14. Der Router fand dann Umwege von 219 statt 8,7
 * Einheiten, weil er die Domäne gar nicht erst betreten konnte. Mit dieser Suche bekommt er einen Anker darauf.
 */
export function nearestAnchorsOfTypes(
    view: RequestGraph,
    px: number,
    py: number,
    limit: number,
    types: ReadonlySet<string>,
): Anchor[] {
    const best = new Map<string, Anchor>();
    for (const node of view.nodes()) {
        for (const edge of view.edges(node)) {
            // Entlang eines Tunnels steigt kein Gang ein (Migration 0172, `isTunnel`).
            if (!types.has(edge.link.subtype) || isTunnel(edge.link)) continue;
            const coordinates = edge.link.coordinates;
            for (let segment = 0; segment < coordinates.length - 1; segment += 1) {
                const [ax, ay] = coordinates[segment] as [number, number];
                const [bx, by] = coordinates[segment + 1] as [number, number];
                const dx = bx - ax;
                const dy = by - ay;
                const lengthSquared = dx * dx + dy * dy;
                const t =
                    lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
                const x = ax + t * dx;
                const y = ay + t * dy;
                const distance = Math.hypot(px - x, py - y);
                const known = best.get(edge.link.id);
                if (known && known.distance <= distance) continue;
                best.set(edge.link.id, { edge, segment, t, x, y, distance });
            }
        }
    }
    return [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/**
 * Teilt den Weg eines Ankers an seinem Fußpunkt und liefert den Knoten dort. Liegt der Fußpunkt auf
 * einem Wegende, wird nicht geteilt. Der alte Weg fällt erst weg, wenn beide Hälften stehen - lieber
 * eine überflüssige Doppelung als eine Lücke im Netz.
 */
export function splitAtAnchor(view: RequestGraph, anchor: Anchor): string {
    const { edge, segment, t } = anchor;
    const link = edge.link;
    const coordinates = link.coordinates;
    if (segment === 0 && t <= SPLIT_EPSILON) return link.from;
    if (segment === coordinates.length - 2 && t >= 1 - SPLIT_EPSILON) return link.to;
    const name = view.nextAnchor();
    view.anchorPaths.set(name, link.pathPublicId);
    const point: [number, number] = [anchor.x, anchor.y];
    const head = coordinates.slice(0, segment + 1);
    if (t > SPLIT_EPSILON) head.push(point);
    const tail = [...(t < 1 - SPLIT_EPSILON ? [point] : []), ...coordinates.slice(segment + 1)];
    // Die Hälften erben das Tempo des Weges: Zeit je Einheit bleibt, was sie war.
    const timePerUnit = edge.distance > 0 ? edge.time / edge.distance : 0;
    const pieces: [string, string, string, [number, number][]][] = [
        ["a", link.from, name, head],
        ["b", name, link.to, tail],
    ];
    let added = 0;
    const halves: Edge[] = [];
    // Wo jede Hälfte im Stück des Netzes liegt, damit sie nur ihren Teil der Steigung meldet (S5d).
    let at = link.span?.from ?? 0;
    for (const [suffix, from, to, points] of pieces) {
        if (points.length < 2) continue;
        const distance = lineLength(points);
        const slice: RouteLink = {
            ...link,
            id: `${SLICE_PREFIX}${name.slice(ANCHOR_PREFIX.length)}-${suffix}`,
            from,
            to,
            coordinates: points,
            distance,
            span: { from: at, to: at + distance },
        };
        at += distance;
        view.roots.set(slice, view.roots.get(link) ?? link);
        const half = (forward: boolean): Edge => ({
            ...edge,
            to: forward ? to : from,
            link: slice,
            forward,
            distance,
            time: distance * timePerUnit,
        });
        const forward = half(true);
        view.add([
            [from, forward],
            [to, half(false)],
        ]);
        halves.push(forward);
        added += 1;
    }
    if (added === pieces.length) {
        view.remove(link);
        view.pieces.set(link, halves);
    }
    return name;
}

/**
 * Teilt einen Weg an einem Anker - ist er für diesen Punkt schon geteilt, das Stück, auf dem der Anker
 * liegt (WI-0030 q: Ausstieg und schneller erreichter Weg können auf demselben Weg liegen).
 */
export function anchorOn(view: RequestGraph, anchor: Anchor): string {
    let current = anchor;
    for (let pieces = view.pieces.get(current.edge.link); pieces; pieces = view.pieces.get(current.edge.link)) {
        let nearest = Infinity;
        for (const edge of pieces) {
            const coordinates = edge.link.coordinates;
            for (let segment = 0; segment < coordinates.length - 1; segment += 1) {
                const [ax, ay] = coordinates[segment] as [number, number];
                const [bx, by] = coordinates[segment + 1] as [number, number];
                const dx = bx - ax;
                const dy = by - ay;
                const lengthSquared = dx * dx + dy * dy;
                const t =
                    lengthSquared > 0
                        ? Math.max(0, Math.min(1, ((anchor.x - ax) * dx + (anchor.y - ay) * dy) / lengthSquared))
                        : 0;
                const distance = Math.hypot(anchor.x - (ax + t * dx), anchor.y - (ay + t * dy));
                if (distance < nearest) {
                    nearest = distance;
                    current = { ...anchor, edge, segment, t };
                }
            }
        }
    }
    const name = splitAtAnchor(view, current);
    if (name.startsWith(ANCHOR_PREFIX)) view.exitAnchors.add(name);
    return name;
}
