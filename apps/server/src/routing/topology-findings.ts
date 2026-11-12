import type { RouteNetwork } from "./network.ts";
import {
    END_SNAP,
    ENDPOINT_BOX,
    exactKey,
    footOnSegment,
    segmentGrid,
    type Topology,
    type TopologyPath,
} from "./topology.ts";

/**
 * „Wege treffen sich nicht“ (WI-0132 P2, Prüfhaken im Auge): jede Stelle, an der ein Weg ins Leere endet oder Wege einander
 * nahekommen, ohne im Netz verbunden zu sein. Gerechnet aus DERSELBEN Topologie wie der Router (`topology.ts`), ohne
 * Kreuzungsobjekte.
 *
 * 🔴 Nur Anzeige. Nichts hier verbindet etwas, und keine Zahl hier ist ein Fangradius des Routers: Der Router verbindet nur
 * exakt (fünf Stellen). Die Nähe sagt, WO die Redaktion nachsehen soll; „knapp verfehlt“ (unter 0,001 E) macht die
 * Rundungsfälle aus Legacys Speichergenauigkeit leicht auffindbar (Betreiber 2026-10-10, Nachtrag der Entscheidung).
 *
 * Drei Arten, je Wegende bzw. Stützpunkt eine Stelle:
 *
 * - `offen`: Das Wegende trifft weder Ort noch Weg (Sackgasse). Mit dem nächsten fremden Weg, wenn einer näher als
 *   `MEET_REACH` liegt (P1 Klasse b; die 1.231 offenen Enden sind die Arbeitsliste).
 * - `getrennt`: Das Wegende hängt an einem technischen Knoten, ein fremdes Wegende näher als `MEET_REACH` an einem
 *   anderen, nicht benachbarten Knoten: zwei Treffpunkte knapp nebeneinander (P1 „zerfallen“).
 * - `kreuzt`: Zwei durchgehende Wege haben einen deckungsgleichen inneren Stützpunkt ohne Wegende. Gewollt getrennt
 *   (Brücke, Überführung), aber prüfenswert, ob dort ein Anschluss gemeint ist (P1 Klasse c).
 *
 * Nur als Zahl (`atPlace`, Entscheidung B der Koordination 2026-10-10, WI-0132 §10.6): Ein Wegende, das genau auf einem
 * fremden Weg liegt, aber nach „Ort zuerst“ am Ort im Kasten hängt, den der fremde Weg nicht erreicht (P1 „Ende an Ort“). Ein
 * solcher Treffpunkt hat genauen Kontakt; der Ortskasten nimmt ihn auf, die Redaktion repariert dort nichts.
 *
 * Eine reparierte Stelle verschwindet: Liegt das Ende genau auf dem anderen Weg oder Ende, ist es kein offenes und kein
 * getrenntes Ende mehr.
 */

/**
 * Unter diesem Abstand heißt eine Stelle „knapp verfehlt“: ein Hinweis in der Anzeige.
 *
 * 🔴 Seit dem Fangradius am Wegende (`END_SNAP`, Betreiber 2026-10-14, seit WI-0147 0,005) ist ein Ende unter diesem
 * Abstand bereits verbunden und taucht hier gar nicht mehr auf — gegen ein anderes Ende, einen inneren Stützpunkt UND ein
 * Segment. Ein Abstand darüber ist deshalb kein Rundungsfall mehr, und `nearMiss` bleibt für ihn falsch.
 *
 * 🪤 Wahr wird `nearMiss` damit nur noch, wo der Fangradius gar nicht sucht: an einem Ende, das nach „Ort zuerst“ im Kasten
 * ±0,5 am Ort hängt und trotzdem knapp neben einem fremden Weg endet. Für die gilt weiter, was der Betreiber am 2026-10-10
 * entschied — der Wegeeditor macht sie auffindbar und rastet sie beim Speichern exakt ein.
 */
export const NEAR_MISS = END_SNAP;
/**
 * Wie nah ein fremder Weg kommen muss, damit er zu einer Stelle genannt wird: der Kasten der Ortsanbindung
 * (`ENDPOINT_BOX`), in dem Legacy Wegenden an Kreuzungen hängte. Gemessen (Satz 169042, mit Entscheidung B): Mit 0,5 E zeigt
 * der Haken 378 der 443 Verluststellen aus P1 selbst, 23 stehen als Treffpunkt am Ort nur in der Zahl, 42 sind im Ziel über eine
 * Kante verbunden. Mit 0,05 E fehlten 31 weitere.
 */
export const MEET_REACH = ENDPOINT_BOX;

export type UnmetKind = "offen" | "getrennt" | "kreuzt";

export interface UnmetSpot {
    kind: UnmetKind;
    /** Der Weg, an dem die Stelle hängt (`public_id`). */
    path: string;
    which: "anfang" | "ende" | "innen";
    x: number;
    y: number;
    /** Der fremde Weg, der hier nicht trifft; `null` bei einem offenen Ende ohne Weg in der Nähe. */
    other: string | null;
    /** Abstand zum fremden Weg in Karteneinheiten; `null` ohne. 0 bei `kreuzt`. */
    distance: number | null;
    /** Unter `NEAR_MISS` (nur `offen` und `getrennt`): ein Rundungsfall, mit genauem Einrasten im Wegeeditor behoben. */
    nearMiss: boolean;
}

export interface UnmetFindings {
    spots: UnmetSpot[];
    /** Wegenden genau auf einem fremden Weg, die am Ort im Kasten hängen: nur gezählt (Entscheidung B). */
    atPlace: number;
}

type Point = readonly [number, number];

/**
 * Die Stellen aus Topologie und Netz; `paths` in der Reihenfolge der Topologie. Rein, ohne Datenbank.
 *
 * `reach` sind die Abstände DIESER Topologie (WI-0214): „knapp verfehlt“ folgt dem Fangradius, mit dem sie gebaut ist, und
 * die Nähe dem Ortskasten. Ohne Angabe die Vorgaben (`NEAR_MISS`, `MEET_REACH`). 🔴 Wer die Topologie mit den eingestellten
 * Werten baut, gibt dieselben Werte hier mit, sonst nennt der Haken Stellen, die der Router längst verbindet.
 */
export function unmetSpots(
    topology: Topology,
    network: Pick<RouteNetwork, "links" | "nodes">,
    paths: readonly TopologyPath[],
    reach: { nearMiss?: number; meet?: number } = {},
): UnmetFindings {
    const nearMiss = reach.nearMiss ?? NEAR_MISS;
    const meet = reach.meet ?? MEET_REACH;
    const indexOf = new Map(paths.map((path, index) => [path.publicId, index]));
    const grid = segmentGrid(paths);
    // Welche Knoten ein Weg erreicht (über seine Kanten) und welche Knoten Nachbarn sind (eine Kante).
    const reaches = new Map<string, Set<string>>();
    const neighbours = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
        const set = map.get(key);
        if (set) set.add(value);
        else map.set(key, new Set([value]));
    };
    for (const link of network.links) {
        add(reaches, link.pathPublicId, link.from);
        add(reaches, link.pathPublicId, link.to);
        add(neighbours, link.from, link.to);
        add(neighbours, link.to, link.from);
    }
    const cellOf = (x: number, y: number): string => `${String(Math.floor(x))}:${String(Math.floor(y))}`;
    const around = (x: number, y: number): string[] => {
        const cells: string[] = [];
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) cells.push(cellOf(x + dx, y + dy));
        }
        return cells;
    };
    const endGrid = new Map<string, Topology["ends"]>();
    for (const end of topology.ends) {
        const cell = cellOf(end.x, end.y);
        const bucket = endGrid.get(cell);
        if (bucket) bucket.push(end);
        else endGrid.set(cell, [end]);
    }

    /** Der nächste fremde Weg (Segmente) näher als `MEET_REACH`, der `node` nicht erreicht, mit seinem Fußpunkt. */
    const nearestForeign = (
        point: Point,
        own: number,
        node: string | null,
    ): { path: string; distance: number; foot: Point } | null => {
        let best: { path: string; distance: number; foot: Point } | null = null;
        const seen = new Set<string>();
        for (const cell of around(point[0], point[1])) {
            for (const hit of grid.get(cell) ?? []) {
                if (hit.path === own) continue;
                const tag = `${String(hit.path)}:${String(hit.segment)}`;
                if (seen.has(tag)) continue;
                seen.add(tag);
                const other = paths[hit.path] as TopologyPath;
                if (node !== null && reaches.get(other.publicId)?.has(node)) continue;
                const line = other.coordinates;
                const foot = footOnSegment(point, line[hit.segment] as Point, line[hit.segment + 1] as Point);
                const distance = Math.hypot(foot.x - point[0], foot.y - point[1]);
                if (distance < meet && (best === null || distance < best.distance)) {
                    best = { path: other.publicId, distance, foot: [foot.x, foot.y] };
                }
            }
        }
        return best;
    };

    const spots: UnmetSpot[] = [];
    let atPlace = 0;
    for (const end of topology.ends) {
        const own = indexOf.get(end.pathPublicId) ?? -1;
        const point: Point = [end.x, end.y];
        const base = { path: end.pathPublicId, which: end.which, x: end.x, y: end.y };
        if (end.contact === "offen") {
            const near = nearestForeign(point, own, null);
            spots.push({
                kind: "offen",
                ...base,
                other: near?.path ?? null,
                distance: near?.distance ?? null,
                nearMiss: near !== null && near.distance < nearMiss,
            });
        } else if (end.contact === "ort") {
            // Genau auf einem fremden Weg (gleicher Schlüssel), der den Ort nicht erreicht: nur gezählt (Entscheidung B).
            const near = nearestForeign(point, own, end.nodeId);
            if (near && exactKey(near.foot[0], near.foot[1]) === end.key) atPlace += 1;
        } else {
            // Ein fremdes Wegende in der Nähe an einem anderen Knoten, der mit diesem nicht über eine Kante verbunden ist.
            let best: { path: string; distance: number } | null = null;
            for (const cell of around(end.x, end.y)) {
                for (const other of endGrid.get(cell) ?? []) {
                    if (other.pathPublicId === end.pathPublicId || other.nodeId === end.nodeId) continue;
                    if (neighbours.get(end.nodeId)?.has(other.nodeId)) continue;
                    if (reaches.get(other.pathPublicId)?.has(end.nodeId)) continue;
                    const distance = Math.hypot(other.x - end.x, other.y - end.y);
                    if (distance < meet && (best === null || distance < best.distance)) {
                        best = { path: other.pathPublicId, distance };
                    }
                }
            }
            if (best) {
                spots.push({
                    kind: "getrennt",
                    ...base,
                    other: best.path,
                    distance: best.distance,
                    nearMiss: best.distance < nearMiss,
                });
            }
        }
    }

    // Deckungsgleiche innere Stützpunkte ohne Knoten: zwei durchgehende Wege, gewollt getrennt.
    const inner = new Map<string, { path: number; index: number }[]>();
    paths.forEach((path, index) => {
        for (let vertex = 1; vertex < path.coordinates.length - 1; vertex += 1) {
            const [x, y] = path.coordinates[vertex] as Point;
            const key = exactKey(x, y);
            const bucket = inner.get(key);
            if (bucket) bucket.push({ path: index, index: vertex });
            else inner.set(key, [{ path: index, index: vertex }]);
        }
    });
    const nodeKeys = new Set([...network.nodes.values()].map((node) => exactKey(node.x, node.y)));
    for (const end of topology.ends) nodeKeys.add(end.key);
    for (const [key, list] of inner) {
        if (list.length < 2 || nodeKeys.has(key)) continue;
        const first = list[0] as { path: number; index: number };
        // Derselbe Weg mit einem doppelten Punkt (Nachbarindex) kreuzt nichts.
        const second = list.find((one) => one.path !== first.path || Math.abs(one.index - first.index) > 1);
        if (!second) continue;
        const firstPath = paths[first.path] as TopologyPath;
        const [x, y] = firstPath.coordinates[first.index] as Point;
        spots.push({
            kind: "kreuzt",
            path: firstPath.publicId,
            which: "innen",
            x,
            y,
            other: (paths[second.path] as TopologyPath).publicId,
            distance: 0,
            nearMiss: false,
        });
    }
    return { spots, atPlace };
}
