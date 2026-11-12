import type { MapPointRefusal, RouteDomain, TravelModel } from "@avesmaps3d/shared";
import type { Ground } from "./ground.ts";
import type { RouteLink, RouteNode } from "./network.ts";
import { NO_RIVERS, type Rivers } from "./rivers.ts";
import type { TerrainHeights } from "./relief.ts";
import type { SeaFleet } from "./sea-free.ts";
import type { VehicleBarrier } from "./vehicle-barrier.ts";
import { NO_WATER, type Water } from "./water.ts";

/**
 * Die Grundbegriffe der Wegfindung (Hardening Review M7): Kante, Anfrage, Graph. Was die Stufen des Routers
 * gemeinsam brauchen, steht hier und sonst nirgends; dieses Modul kennt keine der Stufen.
 *
 * Die Stufen (`router.ts` ist ihre Fassade):
 *
 * 1. `route-graph.ts` - der Graph je Profil: Kanten der gezeichneten Wege und die Brücken (`RouteGraph`).
 * 2. `request-graph.ts`, `request-links.ts` - die Kanten je Anfrage: Anker, Kartenpunkte, gebogene
 *    Notverbindungen (`RequestGraph`).
 * 3. `route-search.ts` - Dijkstra je Etappe (`findLegs`).
 * 4. `route-result.ts` - Abschnitte, Etappen und Zeiten der gefundenen Route (`assembleRoute`).
 */

export interface RouteRequest {
    optimize: "fastest" | "shortest";
    /** Ein Transportmittel je Domäne, wie in Legacys Anfrage. Querfeldein reist mit dem Landmittel. */
    transports: Record<RouteDomain, string>;
    enabled: Record<RouteDomain, boolean>;
    minimizeTransfers: boolean;
}

/** Die Wegart der Notverbindungen. Sie gehört zur Landdomäne. */
export const SYNTHETIC_TYPE = "Querfeldein";
/** Die Wegart der Seefahrt - auch der freien, die keinen gezeichneten Weg hat. */
export const SEA_TYPE = "Seeweg";
/** Landwege, an die ein Wegpunkt angebunden werden darf: Man wandert zu einer Straße, nicht zu einem Fluss. */
export const LAND_PATH_TYPES = new Set(["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"]);

/** Die Kante des Graphen: eine Fahrt über ein Wegstück in einer Richtung. */
export interface Edge {
    to: string;
    link: RouteLink;
    /** In gespeicherter Punktreihenfolge des Weges befahren? */
    forward: boolean;
    transport: string;
    /** Das Gewicht für „kürzeste": die Länge, bei Querfeldein mal Aufschlag. */
    distance: number;
    /** Kantenzeit: Länge / Tempo, stromauf mal Strömungsfaktor, bei Querfeldein mal Aufschlag. */
    time: number;
    flowFactor: number;
    flowState: "" | "upstream" | "downstream";
    /** 1 für gezeichnete Wege, bei Querfeldein der Aufschlag. */
    costFactor: number;
    synthetic: boolean;
    /** Der Gang zu einem Kartenpunkt. */
    offroad: boolean;
    /** Mit Reisebeginn: der Boden der Jahreszeit, um dessen Faktor `time` schon länger ist (WI-0038). */
    ground?: { condition: string; factor: number };
    /**
     * Wie viel von `time` Schnee und Eis kosten, und ihr Zustand: an einer aus Stücken zusammengefügten Kante
     * (`route-result.ts`; die Stücke können verschiedenen Boden haben, `ground` nennt dann nur den des längeren) und an
     * einer Kante, auf der der Boden über der Schneegrenze mitwirkt (`route-search.ts`, `clockStep`). Sonst folgt es aus
     * `ground` (`snowOf`).
     */
    snow?: { condition: string; time: number };
    /**
     * Die Zeit, wenn jeder Abtastschritt eben wäre (P = 1), durch die Zeit mit Steigung (WI-0049 S5d): dasselbe
     * Mittel, dieselbe Eichung, Sternregel und Bodenklasse, nur ohne Steigung. Für die Mehrzeit durch Steigung;
     * fehlt, wo es nichts ändert. Ein Verhältnis, damit es den Boden der Jahreszeit und das Teilen übersteht.
     */
    levelRatio?: number;
    /** Freie Seefahrt von Hafen zu Hafen (WI-0046); ihre Linie kommt erst für die gefundene Route. */
    freeSea?: true;
    /**
     * Die gezeichnete Linie, wenn der Rechner sie selbst liefert, in Fahrtrichtung: die freie Seefahrt, und ein
     * gesuchter Gang querfeldein mit seiner begradigten Treppe (`OffroadPath.display`).
     */
    display?: [number, number][];
}

/** Was der Gang zu einem Kartenpunkt außer dem Wasser kennt. Ohne Landflächen ist kein Punkt an Land. */
export interface OffroadTerrain {
    land: Water;
    rivers: Rivers;
    /** Der bremsende Boden querfeldein (WI-0030 R8); ohne Angabe offener Boden. */
    ground?: Ground;
    /** Das Gelände querfeldein (WI-0049 S5b); ohne Angabe flach wie vor S5b. */
    heights?: TerrainHeights | null;
}

export const NO_OFFROAD_TERRAIN: OffroadTerrain = { land: NO_WATER, rivers: NO_RIVERS };

/** Die Kanten EINES Profils: die gezeichneten Wege und die Brücken zwischen den Netzteilen. */
export interface RouteGraph {
    model: TravelModel;
    request: RouteRequest;
    water: Water;
    /** Das Mittel querfeldein und sein Tempo; null heißt: weder Brücken noch Anker. */
    synthetic: { transport: string; speed: number } | null;
    /**
     * Das Land, das das Landmittel nicht betritt (WI-0258: Wagen, Wald und Gebirge, `vehicle-barrier.ts`); Brücken zwischen
     * Netzteilen suchen nur Sehnen, die es nicht quert. Fehlt oder null: keine Sperre. Anker und Kartenpunkte lesen es aus dem
     * Boden und Gelände der Anfrage (`OffroadTerrain`).
     */
    barrier?: VehicleBarrier | null;
    /** Nur die gezeichneten Wege. */
    drawn: Map<string, Edge[]>;
    /** Gezeichnete Wege und Brücken - darauf sucht die Route. */
    adjacency: Map<string, Edge[]>;
    bridgeCount: number;
    /** Die freie Seefahrt des Profils (WI-0046); null heißt: keine Seereise (See aus, oder kein passender Seegraph). */
    sea: SeaFleet | null;
    /**
     * Orte, die das Wasser erreicht: die Häfen des Seegraphen; ohne ihn die Orte an Seewegen (`network.seaBound`), nur als
     * Lage, damit keine Landbrücke eine Insel erreicht. Fahren lässt sich darüber nichts: Seewege sind seit WI-0153 Schnitt 7e
     * keine Kanten mehr (Betreiber 2026-10-17).
     */
    seaBound: ReadonlySet<string>;
}

/** Der Graph, wie ihn eine Anfrage sieht, ohne die Nachbarlisten: das Profil samt Wasser, Mittel und See. */
export type GraphBase = Omit<RouteGraph, "adjacency" | "bridgeCount">;
export type Point = { id: string; x: number; y: number };

/** Ein Kartenpunkt, der nicht zu erreichen ist, und warum (`MAP_POINT_REFUSALS`). */
export interface RouteRefusal {
    reason: MapPointRefusal;
    waypoint: string;
}

export const hasLandPathEdge = (edges: readonly Edge[]): boolean =>
    edges.some((edge) => LAND_PATH_TYPES.has(edge.link.subtype));

/**
 * Der Tunnel (WI-0177, Migration 0172; Betreiber 2026-10-18, wörtlich: „der tunnel hat doch eine einschränkung: er ist davon
 * ausgenommen, dass man von/auf ihn querfeldein kann“): Entlang eines Tunnels steigt kein Gang querfeldein ein oder aus, betreten
 * und verlassen wird er nur an seinen Enden, über anschließende Wege oder Orte. Gilt an jeder Stelle, an der ein Gang an das Netz
 * andockt: Fußpunkt eines Orts (`nearestAnchorsOfTypes`), Ausstieg und Einstieg eines Kartenpunkts (`request-links.ts`), Ende
 * einer Brücke zwischen Netzteilen (`componentBridges`). Kein eigener Wegtyp: Tempo und Mittel bleiben die der Wegart.
 */
export const isTunnel = (link: RouteLink): boolean => link.tunnel === true;

/**
 * Liegt der Knoten im Berg? Ein technischer Knoten, an dem nur Tunnel hängen (zwischen zwei Tunnelstücken oder am blinden Ende
 * eines Tunnels): Dort beginnt und endet kein Gang querfeldein. Ein Ort liegt nie im Berg - über ihn betritt man den Tunnel.
 */
export function inTunnel(node: RouteNode, edges: readonly Edge[]): boolean {
    if (node.kind === "place") return false;
    const drawn = edges.filter((edge) => !edge.synthetic);
    return drawn.length > 0 && drawn.every((edge) => isTunnel(edge.link));
}

/** Eine Querfeldein-Kante in beide Richtungen, als gerade Sehne. */
export function syntheticEdges(graph: GraphBase, from: Point, to: Point): [string, Edge][] {
    const synthetic = graph.synthetic as NonNullable<GraphBase["synthetic"]>;
    const factor = graph.model.querfeldeinAufschlag.wert;
    const chord = Math.hypot(to.x - from.x, to.y - from.y);
    const link: RouteLink = {
        id: `synthetic-${from.id}->${to.id}`,
        pathPublicId: "",
        pathName: "",
        subtype: SYNTHETIC_TYPE,
        from: from.id,
        to: to.id,
        coordinates: [
            [from.x, from.y],
            [to.x, to.y],
        ],
        distance: chord,
        allowedTransports: null,
        transportDomain: null,
        flow: null,
    };
    const edge = (forward: boolean): Edge => ({
        to: forward ? to.id : from.id,
        link,
        forward,
        transport: synthetic.transport,
        distance: chord * factor,
        time: (chord * factor) / synthetic.speed,
        flowFactor: 1,
        flowState: "",
        costFactor: factor,
        synthetic: true,
        offroad: false,
    });
    return [
        [from.id, edge(true)],
        [to.id, edge(false)],
    ];
}

/** Eine Kopie der Nachbarlisten mit zusätzlichen Kanten; unberührte Listen werden geteilt. */
export function withEdges(adjacency: Map<string, Edge[]>, additions: [string, Edge][]): Map<string, Edge[]> {
    const result = new Map(adjacency);
    const copied = new Set<string>();
    for (const [from, edge] of additions) {
        if (!copied.has(from)) {
            result.set(from, [...(result.get(from) ?? [])]);
            copied.add(from);
        }
        (result.get(from) as Edge[]).push(edge);
    }
    return result;
}
