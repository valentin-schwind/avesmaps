import { punktSchluessel } from "@avesmaps3d/shared";
import type { RouteNode } from "./network.ts";

/**
 * Die Topologie des Wegenetzes ohne Kreuzungsobjekte (WI-0132 Release N): welcher Knoten an jedem Wegende hängt, wo ein
 * Weg im Graphen geteilt wird und welche technischen Knoten dafür entstehen. EINE Funktion für den Router
 * (`buildRouteNetwork`), die Prüfhaken im Auge und später die Erfolgsbestätigung des Wegeeditors.
 *
 * Die Regeln sind die der Betreiberentscheidung vom 2026-10-10
 * (`project-control/decisions/2026-10-10-wegenden-verbinden-ohne-kreuzungsobjekte.md`, samt Nachtrag):
 *
 * 1. **Ort zuerst, wie bisher.** Ein Wegende, in dessen Kasten ±0,5 ein Ort liegt, hängt an diesem Ort (der nächste, ein
 *    Treffer unter 0,01 zuerst; `createEndpointAttacher`). Ein Innenpunkt, der auf fünf Stellen genau auf einem Ort liegt,
 *    teilt den Weg dort.
 * 2. **Ende trifft Ende:** gleicher Fünfstellen-Schlüssel (`exactKey`) heißt verbunden.
 * 3. **Ende trifft Weg (T-Stoß):** Das Ende liegt mit seinem Schlüssel auf einem inneren Stützpunkt eines Weges oder auf
 *    einem Segment (der Fußpunkt auf dem Segment hat denselben Schlüssel). Der durchgehende Weg bleibt EIN Wegobjekt; nur
 *    der Graph teilt ihn dort, und fehlt der Stützpunkt, fügt nur der Graph ihn ein.
 * 4. **Zwei durchgehende Wege verbinden nie**, auch nicht mit deckungsgleichem innerem Stützpunkt: Ein technischer Knoten
 *    entsteht nur, wo mindestens ein Wegende liegt. Das erhält Brücken und Überführungen.
 * 5. **Keine Toleranz.** Beinahe ist nicht getroffen; es gibt keinen Fangradius über die Rundung des Schlüssels hinaus.
 * 6. **Ein Ende, das nichts trifft, wird eine Sackgasse:** ein technischer Knoten nur für dieses Ende. Kein Weg fällt
 *    heraus (Verwerfen nähme 1.087 Wege aus dem Netz, WI-0132 P1).
 *
 * Technische Knoten sind keine Kartenobjekte: reproduzierbar aus dem Schlüssel (`knoten:<x>:<y>`), ohne Namen, nie
 * gespeichert, nie Wegpunkt einer Anfrage. Sie übernehmen im Router die Rolle der früheren Kreuzungen (Ausstieg „Hierher
 * reisen“, Brückenende). Gerechnet wird beim Netzaufbau nach einer Datenänderung, nie je Routenanfrage.
 */

/** Ein Wegende hängt an einem Ort, wenn |dx| und |dy| unter 0,5 liegen: ein Kasten, kein Kreis (Legacys Regel). */
export const ENDPOINT_BOX = 0.5;
/** Ein exakter Treffer geht jedem näheren Kandidaten im Kasten vor. */
export const EXACT_HIT = 0.01;

/**
 * Der kanonische Schlüssel eines Punktes: fünf Nachkommastellen (Betreiber 2026-10-10, „A, fünf Nachkommastellen“). Derselbe wie im Editor
 * (`punktSchluessel`, `@avesmaps3d/shared` `weg-regeln.ts`).
 */
export const exactKey: (x: number, y: number) => string = punktSchluessel;

/**
 * 🔴 **Der Fangradius an einem WEGENDE** (Betreiber 2026-10-14, nach dem Nutzerbericht Hallingen → Althof: „ich will
 * jetzt den fix“; auf 0,005 gehoben nach dem Vergleich der 200 Routen, Betreiber 2026-10-14: „stell beides um“).
 * Er kehrt den Nachtrag vom 2026-10-10 („keine Fangtoleranz im Router“) für genau diesen Fall um.
 *
 * 💣 **Warum überhaupt.** Mit Version 3 (WI-0132) hielten Legacys Kreuzungsobjekte die Wegenden nicht mehr zusammen;
 * angenommen war, die Enden lägen exakt aufeinander. Gemessen am 2026-10-14: Bei **325 der 3426** ehemaligen Kreuzungen
 * liegen sie das nicht, bei 321 davon treffen drei oder mehr Enden zusammen.
 *
 * 💣 **Warum 0,02 und nicht 0,001** (WI-0147). Das Ende des Rabenpasses (658,221 | 769,643) und der Anfang der
 * Karawanenroute (658,220 | 769,640) liegen 0,0032 auseinander; mit 0,001 lief Oblotin → Weidensee 1.308 Meilen außen
 * herum statt 139. Die Lücke hinter Gareth → Kaiserhain ist 0,0175 breit und lag damit auch über der Zwischenstufe
 * 0,005; mit 0,02 fährt die Route 96 Meilen statt 119, Legacy fährt 95, die Luftlinie sind 93.
 *
 * 🔴 **Die Gegenprobe war leer, und sie ist der Grund für die Höhe** (Betreiber 2026-10-15: „prima, ok dann machen wir
 * 0,02“). 0,02 verbindet 57 Paare, die 0,005 trennt. **53 davon hielt bei Legacy ein Kreuzungsobjekt** — nachweislich
 * Rundungsfehler. Die vier ohne Halter sind harmlos: zweimal derselbe Weg in zwei Stücken, eine Flussmündung, ein Weg,
 * den kein Reisemittel befährt; alle gleichartig, Land an Land oder Wasser an Wasser, also kann keine Route dort die
 * Domäne wechseln. Über 206 Routen: keine Route verloren, keine Reise beginnt querfeldein, kein Riss in der Linie,
 * keine Route über 1,5 mal Legacy, und dieselben 20 Routen mit Sperrweg wie vorher
 * (`discovery/topologie-vergleich-200-routen-2026-10-14.md`, `discovery/routen-reste-2026-10-14.md`).
 *
 * 🪤 **Legacy ist hier kein Maßstab.** Legacys produktiver Router hat gar keine Toleranz zwischen Enden; was sein Netz
 * zusammenhält, ist ein Kartenobjekt an der Stelle (Ort ODER Kreuzung) mit dem Kasten ±0,5. Die 0,001 stammt aus Legacys
 * Diagnosewerkzeug (`discovery/legacy-wegenden-knoten-2026-10-14.md`). Dieser Radius ist unser Ersatz für das entfallene
 * Kreuzungsobjekt und mit 0,02 noch immer weit vorsichtiger als Legacys halber Kasten (0,5). Eine andere Stufe lässt sich
 * ohne Release einstellen: in der Systemsteuerung, Reiter „Wegfindung“ (`endSnap`, WI-0153); der frühere Probierhebel
 * `ROUTE_END_SNAP` ist mit WI-0214 entfallen.
 *
 * 🔴 **Was er NICHT anfasst:** Regel 4 und 5 der Entscheidung bleiben. Zwei durchgehende Wege verbinden sich nie, auch nicht
 * bei deckungsgleichem innerem Stützpunkt — Brücken und Überführungen bleiben getrennt. Er greift nur, wo ein Wegende im
 * Spiel ist: Ende auf Ende, Ende auf Stützpunkt, Ende auf Segment.
 */
export const END_SNAP = 0.02;

/**
 * Welche Wegenden denselben Knoten bekommen: Enden, die höchstens `snap` auseinanderliegen, teilen einen Schlüssel.
 * Die Rückgabe bildet den eigenen Schlüssel eines Endes auf den des Clusters ab; wer allein steht, zeigt auf sich selbst.
 *
 * 🪤 **Die Reihenfolge darf nichts ändern** (Test „die Topologie hängt nicht an der Reihenfolge der Wege“): Deshalb wird
 * sortiert, bevor geclustert wird, und der erste Punkt in dieser Ordnung ist der Repräsentant seines Clusters — nicht der,
 * der zufällig zuerst eingelesen wurde. Gesucht wird über ein Raster der Zellbreite `snap` in den neun Nachbarzellen,
 * damit der Aufbau linear bleibt und nicht quadratisch.
 */
export function canonicalEndKeys(
    points: readonly (readonly [number, number])[],
    snap: number = END_SNAP,
): Map<string, string> {
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cells = new Map<string, { x: number; y: number; key: string }[]>();
    const cellOf = (x: number, y: number): string => `${String(Math.floor(x / snap))}:${String(Math.floor(y / snap))}`;
    const canonical = new Map<string, string>();
    for (const [x, y] of sorted) {
        const own = exactKey(x, y);
        if (canonical.has(own)) continue;
        const cx = Math.floor(x / snap);
        const cy = Math.floor(y / snap);
        let hit: { x: number; y: number; key: string } | undefined;
        for (let dx = -1; dx <= 1 && !hit; dx += 1) {
            for (let dy = -1; dy <= 1 && !hit; dy += 1) {
                for (const rep of cells.get(`${String(cx + dx)}:${String(cy + dy)}`) ?? []) {
                    if (Math.abs(rep.x - x) <= snap && Math.abs(rep.y - y) <= snap) {
                        hit = rep;
                        break;
                    }
                }
            }
        }
        if (hit) {
            canonical.set(own, hit.key);
            continue;
        }
        const rep = { x, y, key: own };
        const cell = cellOf(x, y);
        cells.set(cell, [...(cells.get(cell) ?? []), rep]);
        canonical.set(own, own);
    }
    return canonical;
}

/** Kennungen technischer Knoten: aus dem Schlüssel, nie ein `p:`-Kartenpunkt, nie eine UUID. */
export const TECH_NODE_PREFIX = "knoten:";
export const techNodeId = (key: string): string => `${TECH_NODE_PREFIX}${key}`;

/**
 * Die Endpunktsuche über die Orte: WELCHER Ort ein Wegende (oder einen Innenpunkt) bekommt.
 *
 * 💣 Die Rechnung wird nirgends nachgebaut, sie wird gerufen. Legacy hat dieselbe Lehre an derselben Regel aufgeschrieben
 * (`map-features-open-path-check.js`): „541 von 11.662 Endpunkten gingen an den falschen Ort“, als jemand die
 * Zwei-Stufen-Regel abschrieb.
 */
export interface EndpointAttacher {
    /** Der Knoten, an dem dieses Wegende hängt, oder `undefined`, wenn im Kasten keiner liegt. */
    at(point: readonly [number, number]): RouteNode | undefined;
    /** Der Knoten GENAU auf diesem Punkt (fünf Stellen): die Regel für Innenpunkte und Seewege. */
    exactAt(x: number, y: number): RouteNode | undefined;
}

/**
 * Baut die Endpunktsuche über diese Knotenliste. `legacyOrder` (nur für den Paritätsvergleich): Legacys Listenreihenfolge
 * je Knoten; ist sie gesetzt, hängt ein Wegende am niedrigsten Listenindex statt am nächsten Knoten.
 */
export function createEndpointAttacher(
    nodeList: readonly RouteNode[],
    options: { legacyOrder?: Map<string, number>; endpointBox?: number; exactHit?: number } = {},
): EndpointAttacher {
    const order = options.legacyOrder;
    // 🪤 EINMAL gelesen, nicht je Knoten: `at()` läuft über neun Zellen je Wegende (WI-0153).
    const box = options.endpointBox ?? ENDPOINT_BOX;
    const hit = options.exactHit ?? EXACT_HIT;
    const rank = (node: RouteNode): number => order?.get(node.id) ?? Number.MAX_SAFE_INTEGER;
    const cells = new Map<string, RouteNode[]>();
    for (const node of nodeList) {
        const cell = `${String(Math.floor(node.x))}:${String(Math.floor(node.y))}`;
        const bucket = cells.get(cell) ?? [];
        bucket.push(node);
        cells.set(cell, bucket);
    }
    const exact = new Map<string, RouteNode>();
    for (const node of nodeList) {
        const key = exactKey(node.x, node.y);
        if (!exact.has(key)) exact.set(key, node);
    }
    return {
        at([x, y]: readonly [number, number]): RouteNode | undefined {
            let best: RouteNode | undefined;
            let bestDistance = Infinity;
            let bestExact: RouteNode | undefined;
            let bestExactDistance = Infinity;
            for (let dx = -1; dx <= 1; dx += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (const node of cells.get(`${String(Math.floor(x) + dx)}:${String(Math.floor(y) + dy)}`) ?? []) {
                        if (Math.abs(node.x - x) >= box || Math.abs(node.y - y) >= box) continue;
                        const distance = Math.hypot(node.x - x, node.y - y);
                        // Mit Legacys Reihenfolge zählt der Listenindex, sonst die Nähe.
                        const score = order ? rank(node) : distance;
                        if (score < bestDistance) {
                            best = node;
                            bestDistance = score;
                        }
                        // Unter exakten Treffern entscheidet immer die Nähe, auch in Legacy.
                        if (distance < hit && distance < bestExactDistance) {
                            bestExact = node;
                            bestExactDistance = distance;
                        }
                    }
                }
            }
            return bestExact ?? best;
        },
        exactAt: (x: number, y: number): RouteNode | undefined => exact.get(exactKey(x, y)),
    };
}

/** Was ein Wegende trifft; bei mehreren gilt die Reihenfolge der Liste. */
export type EndContact = "ort" | "ende" | "stuetzpunkt" | "segment" | "offen";
export type PartnerKind = "ende" | "stuetzpunkt" | "segment";
const CONTACT_ORDER: readonly PartnerKind[] = ["ende", "stuetzpunkt", "segment"];

/** Ein Weg, wie die Topologie ihn liest: Kennung und gespeicherte Linie. */
export interface TopologyPath {
    publicId: string;
    coordinates: readonly [number, number][];
}

/** Ein Wegende in der Topologie. */
export interface TopologyEnd {
    pathPublicId: string;
    which: "anfang" | "ende";
    x: number;
    y: number;
    key: string;
    contact: EndContact;
    /** Der Knoten im Graphen: der Ort oder der technische Knoten (bei `offen` die Sackgasse). */
    nodeId: string;
    /** Die Wege (auch der eigene), die das Ende exakt trifft; leer bei `ort` und `offen`. */
    partners: { pathPublicId: string; kind: PartnerKind }[];
}

/** Eine Stelle auf der gespeicherten Linie: Stützpunktpaar (Segment) und Anteil darauf (0 am Stützpunkt). */
export interface Station {
    pair: number;
    t: number;
}

/** Wie der Graph einen Weg nimmt. */
export interface PathPlan {
    publicId: string;
    /** Die Linie für den Graphen: die gespeicherte, dazu die eingefügten T-Punkte. */
    coordinates: [number, number][];
    /** Je Punkt von `coordinates` seine Stelle auf der gespeicherten Linie (für die Teilung des Höhenprofils). */
    stations: Station[];
    start: string;
    end: string;
    /** Innere Teilungen in Punktreihenfolge: Index in `coordinates` und Knoten (auch zwei gleiche hintereinander). */
    splits: { index: number; nodeId: string }[];
}

export interface Topology {
    /** Die technischen Knoten, nach Schlüssel sortiert. */
    techNodes: RouteNode[];
    /** Zwei je Weg, in der Reihenfolge der Wege: Anfang, Ende. */
    ends: TopologyEnd[];
    /** Einer je Weg, in der Reihenfolge der Wege. */
    plans: PathPlan[];
    /** Die Schlüssel der eingefügten T-Punkte (je eingefügtem Punkt einer). */
    insertedKeys: string[];
}

interface EndRef {
    path: number;
    which: "anfang" | "ende";
    point: readonly [number, number];
    key: string;
    place: RouteNode | undefined;
}

/** Ein Raster der Segmente für die T-Suche: Zelle 1 E, ein Segment in jeder Zelle seiner Hülle. */
export function segmentGrid(paths: readonly TopologyPath[]): Map<string, { path: number; segment: number }[]> {
    const grid = new Map<string, { path: number; segment: number }[]>();
    paths.forEach((path, index) => {
        const line = path.coordinates;
        for (let segment = 0; segment < line.length - 1; segment += 1) {
            const [ax, ay] = line[segment] as [number, number];
            const [bx, by] = line[segment + 1] as [number, number];
            for (let cx = Math.floor(Math.min(ax, bx)); cx <= Math.floor(Math.max(ax, bx)); cx += 1) {
                for (let cy = Math.floor(Math.min(ay, by)); cy <= Math.floor(Math.max(ay, by)); cy += 1) {
                    const cell = `${String(cx)}:${String(cy)}`;
                    const bucket = grid.get(cell);
                    if (bucket) bucket.push({ path: index, segment });
                    else grid.set(cell, [{ path: index, segment }]);
                }
            }
        }
    });
    return grid;
}

/** Der Fußpunkt von `p` auf dem Segment `a` bis `b` mit seinem Parameter (auf das Segment beschränkt). */
export function footOnSegment(
    p: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
): { t: number; x: number; y: number } {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t =
        lengthSquared > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared)) : 0;
    return { t, x: a[0] + t * dx, y: a[1] + t * dy };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Die Segmente, deren Fußpunkt von `point` höchstens `END_SNAP` entfernt liegt, ohne die Fälle, in denen der Fußpunkt auf
 * einen Stützpunkt des Segments fällt (das ist ein Treffer am Punkt, kein Segment).
 *
 * 🔴 **Der T-Stoß `|-` mit Versatz** (Betreiber 2026-10-14: „kann er das: >- oder -< oder |-“). Vorher musste der Fußpunkt
 * denselben Fünfstellen-Schlüssel tragen; ein Stich, der 0,0004 neben der durchgehenden Straße endete, fand sie nicht. Das
 * ist dieselbe Lücke wie zwischen zwei Enden, nur gegen ein Segment — an einer ehemaligen Kreuzung tritt beides auf.
 *
 * 🪤 Nur das ENDE darf wandern: Geprüft wird der Abstand des Fußpunktes zum Ende, nicht die Nähe zweier Linien. Zwei
 * durchgehende Wege berühren sich hier nie, denn `point` ist immer ein Wegende (Regel 4 und 5 der Entscheidung).
 */
function segmentHits(
    point: readonly [number, number],
    key: string,
    paths: readonly TopologyPath[],
    grid: ReadonlyMap<string, readonly { path: number; segment: number }[]>,
    snap: number = END_SNAP,
): { path: number; segment: number; t: number }[] {
    const hits: { path: number; segment: number; t: number }[] = [];
    const seen = new Set<string>();
    const nah = (a: readonly [number, number], b: readonly [number, number]): boolean =>
        Math.abs(a[0] - b[0]) <= snap && Math.abs(a[1] - b[1]) <= snap;
    const cx = Math.floor(point[0]);
    const cy = Math.floor(point[1]);
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
            for (const hit of grid.get(`${String(cx + dx)}:${String(cy + dy)}`) ?? []) {
                const tag = `${String(hit.path)}:${String(hit.segment)}`;
                if (seen.has(tag)) continue;
                seen.add(tag);
                const line = (paths[hit.path] as TopologyPath).coordinates;
                const a = line[hit.segment] as [number, number];
                const b = line[hit.segment + 1] as [number, number];
                const foot = footOnSegment(point, a, b);
                if (!nah([foot.x, foot.y], point)) continue;
                if (nah(a, point) || nah(b, point)) continue;
                hits.push({ path: hit.path, segment: hit.segment, t: foot.t });
            }
        }
    }
    return hits;
}

/**
 * Hat ein Wegende genauen Wegkontakt (fünf Stellen): ein anderes Wegende, einen inneren Stützpunkt oder ein Segment eines
 * Weges an derselben Stelle? Dieselben Kontakte wie im Router (`deriveTopology`), hier auch für Enden, die nach „Ort zuerst“ am
 * Ort hängen. Für die Anzeige der Prüfhaken (WI-0132 §10.6, Entscheidung B): Ein solches Ende ist ein Treffpunkt, den der
 * Ortskasten aufnimmt, keine Stelle für die Redaktion. Der Router braucht es nicht.
 */
export function contactFinder(paths: readonly TopologyPath[]): (point: readonly [number, number]) => boolean {
    const endKeys = new Map<string, number>();
    const innerKeys = new Set<string>();
    for (const path of paths) {
        const line = path.coordinates;
        for (const [x, y] of [line[0], line[line.length - 1]] as [number, number][]) {
            const key = exactKey(x, y);
            endKeys.set(key, (endKeys.get(key) ?? 0) + 1);
        }
        for (let vertex = 1; vertex < line.length - 1; vertex += 1) {
            const [x, y] = line[vertex] as [number, number];
            innerKeys.add(exactKey(x, y));
        }
    }
    const grid = segmentGrid(paths);
    return (point) => {
        const key = exactKey(point[0], point[1]);
        // Das eigene Ende zählt einmal; ein zweites Ende mit demselben Schlüssel ist ein Kontakt (auch das andere eigene).
        if ((endKeys.get(key) ?? 0) > 1 || innerKeys.has(key)) return true;
        // Die Segmente, an denen das Ende selbst hängt, schließt `segmentHits` aus (ihr Stützpunkt trägt den Schlüssel).
        return segmentHits(point, key, paths, grid).length > 0;
    };
}

/**
 * Die Stellschrauben der Topologie. `legacyOrder` nur für den Paritätsvergleich (`createEndpointAttacher`); `endsFirst`
 * und `endSnap` sind die zwei Varianten, die der Vergleich der 200 Routen gegen den Bestand und gegen Legacy stellt
 * (`topologie-vergleich-cli.ts`, Betreiberauftrag 2026-10-14 „erst mit 200 zufälligen routen einen vergleich“).
 */
export interface TopologyOptions {
    legacyOrder?: Map<string, number>;
    /**
     * Ein anderer Fangradius als `END_SNAP`: das Vergleichswerkzeug (`topologie-vergleich-cli.ts`) probiert ihn über
     * echte Routen durch, und seit WI-0153 reicht der Dienst den eingestellten Wert des Datenstands durch. Ohne
     * Angabe gilt die Konstante.
     */
    endSnap?: number;
    /** Der Ortskasten dieses Netzaufbaus (`ENDPOINT_BOX`), ohne Angabe die Konstante (WI-0153). */
    endpointBox?: number;
    /** Der exakte Treffer dieses Netzaufbaus (`EXACT_HIT`), ohne Angabe die Konstante (WI-0153). */
    exactHit?: number;
}

/**
 * Leitet die Topologie ab. Rein, ohne Datenbank: `places` sind die aktiven Orte, `paths` die aktiven Wege in der
 * Reihenfolge, in der das Netz sie liest.
 */
export function deriveTopology(
    places: readonly RouteNode[],
    paths: readonly TopologyPath[],
    options: TopologyOptions = {},
): Topology {
    const snap = options.endSnap ?? END_SNAP;
    const attacher = createEndpointAttacher(places, {
        ...(options.legacyOrder ? { legacyOrder: options.legacyOrder } : {}),
        ...(options.endpointBox === undefined ? {} : { endpointBox: options.endpointBox }),
        ...(options.exactHit === undefined ? {} : { exactHit: options.exactHit }),
    });

    // 1. Enden. Ein Ende mit Ort im Kasten hängt am Ort; alle anderen suchen einen Wegkontakt (Ort zuerst).
    // 🔴 Zuvor finden sich Enden, die höchstens `END_SNAP` auseinanderliegen, zu EINEM Schlüssel zusammen (Betreiber
    // 2026-10-14): Nur so hält das Netz an den 325 ehemaligen Kreuzungen, deren Enden Legacy nicht deckungsgleich liefert.
    // Der Ort geht weiterhin vor, und Innenpunkte wie Segmente bleiben ohne Toleranz.
    const canonical = canonicalEndKeys(
        paths.flatMap((path) => [
            path.coordinates[0] as [number, number],
            path.coordinates[path.coordinates.length - 1] as [number, number],
        ]),
        snap,
    );
    const endKey = (x: number, y: number): string => {
        const own = exactKey(x, y);
        return canonical.get(own) ?? own;
    };
    const ends: EndRef[] = [];
    const candidates = new Map<string, EndRef[]>();
    paths.forEach((path, index) => {
        const line = path.coordinates;
        const pairs: ["anfang" | "ende", readonly [number, number]][] = [
            ["anfang", line[0] as [number, number]],
            ["ende", line[line.length - 1] as [number, number]],
        ];
        for (const [which, point] of pairs) {
            const ref: EndRef = {
                path: index,
                which,
                point,
                key: endKey(point[0], point[1]),
                place: attacher.at(point),
            };
            ends.push(ref);
            if (ref.place) continue;
            const bucket = candidates.get(ref.key);
            if (bucket) bucket.push(ref);
            else candidates.set(ref.key, [ref]);
        }
    });

    // 2. Innere Stützpunkte je Schlüssel UND in einem Raster der Breite `END_SNAP`: Das Raster findet den T-Stoß, dessen
    //    Ende bis zu `END_SNAP` neben dem Stützpunkt liegt; die Schlüsseltafel bleibt für die exakten Treffer.
    const inner = new Map<string, { path: number; index: number }[]>();
    const innerCells = new Map<string, { path: number; index: number; x: number; y: number }[]>();
    paths.forEach((path, index) => {
        const line = path.coordinates;
        for (let vertex = 1; vertex < line.length - 1; vertex += 1) {
            const [x, y] = line[vertex] as [number, number];
            const cell = `${String(Math.floor(x / snap))}:${String(Math.floor(y / snap))}`;
            innerCells.set(cell, [...(innerCells.get(cell) ?? []), { path: index, index: vertex, x, y }]);
            const at = exactKey(x, y);
            const bucket = inner.get(at);
            if (bucket) bucket.push({ path: index, index: vertex });
            else inner.set(at, [{ path: index, index: vertex }]);
        }
    });
    const grid = segmentGrid(paths);
    /** Die inneren Stützpunkte höchstens `snap` neben diesem Ende, stabil sortiert (Weg, dann Stützpunkt). */
    const innerNear = (point: readonly [number, number]): { path: number; index: number }[] => {
        const cx = Math.floor(point[0] / snap);
        const cy = Math.floor(point[1] / snap);
        const found: { path: number; index: number }[] = [];
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                for (const vertex of innerCells.get(`${String(cx + dx)}:${String(cy + dy)}`) ?? []) {
                    if (Math.abs(vertex.x - point[0]) > snap || Math.abs(vertex.y - point[1]) > snap) continue;
                    found.push({ path: vertex.path, index: vertex.index });
                }
            }
        }
        return found.sort((a, b) => a.path - b.path || a.index - b.index);
    };

    // 3. Was jedes Ende ohne Ort exakt trifft; die T-Punkte auf Segmenten merken.
    const partnersOf = new Map<EndRef, { path: number; kind: PartnerKind }[]>();
    const insertions = new Map<
        number,
        { segment: number; t: number; point: readonly [number, number]; key: string }[]
    >();
    for (const [at, group] of candidates) {
        for (const end of group) {
            const partners: { path: number; kind: PartnerKind }[] = [];
            for (const other of group) if (other !== end) partners.push({ path: other.path, kind: "ende" });
            // 🔴 Auch der Stützpunkt darf bis `END_SNAP` daneben liegen (T-Stoß `|-` mit Versatz, Betreiber 2026-10-14):
            // `innerNear` sucht im Raster um das Ende statt nur unter seinem eigenen Schlüssel.
            for (const vertex of innerNear(end.point)) partners.push({ path: vertex.path, kind: "stuetzpunkt" });
            for (const hit of segmentHits(end.point, at, paths, grid, snap)) {
                partners.push({ path: hit.path, kind: "segment" });
                const list = insertions.get(hit.path) ?? [];
                list.push({ segment: hit.segment, t: hit.t, point: end.point, key: at });
                insertions.set(hit.path, list);
            }
            partnersOf.set(end, partners);
        }
    }

    // 4. Ein technischer Knoten je Schlüssel mit einem Ende ohne Ort (Kontakt oder Sackgasse).
    const techByKey = new Map<string, RouteNode>();
    for (const at of [...candidates.keys()].sort()) {
        const group = (candidates.get(at) as EndRef[])
            .slice()
            .sort(
                (a, b) =>
                    cmp((paths[a.path] as TopologyPath).publicId, (paths[b.path] as TopologyPath).publicId) ||
                    cmp(a.which, b.which),
            );
        const first = group[0] as EndRef;
        techByKey.set(at, {
            id: techNodeId(at),
            name: "",
            kind: "technical",
            isHidden: false,
            x: first.point[0],
            y: first.point[1],
        });
    }
    const contactOf = (end: EndRef): EndContact => {
        if (end.place) return "ort";
        const kinds = new Set((partnersOf.get(end) ?? []).map((partner) => partner.kind));
        return CONTACT_ORDER.find((kind) => kinds.has(kind)) ?? "offen";
    };
    const nodeOf = (end: EndRef): string => end.place?.id ?? (techByKey.get(end.key) as RouteNode).id;

    /**
     * Der technische Knoten höchstens `END_SNAP` neben diesem Punkt — die Gegenseite von `innerNear`.
     *
     * 🪤 Ohne ihn hinge der T-Stoß `|-` mit Versatz in der Luft: Der Knoten entsteht am Schlüssel des ENDES, der durchgehende
     * Weg sucht ihn aber an seinem eigenen Stützpunkt. Vor dem Fangradius war das derselbe Schlüssel; jetzt muss gesucht
     * werden. Bei mehreren Treffern gewinnt der kleinste Schlüssel, damit die Topologie reihenfolgefrei bleibt.
     */
    const techCells = new Map<string, { key: string; node: RouteNode }[]>();
    for (const [key, node] of techByKey) {
        const cell = `${String(Math.floor(node.x / snap))}:${String(Math.floor(node.y / snap))}`;
        techCells.set(cell, [...(techCells.get(cell) ?? []), { key, node }]);
    }
    const techNear = (x: number, y: number): RouteNode | undefined => {
        const cx = Math.floor(x / snap);
        const cy = Math.floor(y / snap);
        let best: { key: string; node: RouteNode } | undefined;
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                for (const candidate of techCells.get(`${String(cx + dx)}:${String(cy + dy)}`) ?? []) {
                    if (Math.abs(candidate.node.x - x) > snap || Math.abs(candidate.node.y - y) > snap) continue;
                    if (best === undefined || cmp(candidate.key, best.key) < 0) best = candidate;
                }
            }
        }
        return best?.node;
    };

    // 5. Die Wege: eingefügte T-Punkte, innere Teilungen, Enden.
    const records: TopologyEnd[] = [];
    const insertedKeys: string[] = [];
    const plans: PathPlan[] = paths.map((path, index) => {
        const line = path.coordinates;
        const adds = (insertions.get(index) ?? []).slice().sort((a, b) => a.segment - b.segment || a.t - b.t);
        const coordinates: [number, number][] = [];
        const stations: Station[] = [];
        const splits: { index: number; nodeId: string }[] = [];
        let next = 0;
        for (let vertex = 0; vertex < line.length; vertex += 1) {
            const [x, y] = line[vertex] as [number, number];
            coordinates.push([x, y]);
            stations.push({ pair: vertex, t: 0 });
            const vertexKey = exactKey(x, y);
            if (vertex > 0 && vertex < line.length - 1) {
                const node = techByKey.get(vertexKey) ?? techNear(x, y) ?? attacher.exactAt(x, y);
                if (node) splits.push({ index: coordinates.length - 1, nodeId: node.id });
            }
            let lastKey = vertexKey;
            while (next < adds.length && (adds[next] as (typeof adds)[number]).segment === vertex) {
                const add = adds[next] as (typeof adds)[number];
                next += 1;
                // Zwei Enden mit demselben Schlüssel auf demselben Segment: ein Punkt.
                if (add.key === lastKey) continue;
                lastKey = add.key;
                coordinates.push([add.point[0], add.point[1]]);
                stations.push({ pair: vertex, t: add.t });
                splits.push({ index: coordinates.length - 1, nodeId: (techByKey.get(add.key) as RouteNode).id });
                insertedKeys.push(add.key);
            }
        }
        const startRef = ends[index * 2] as EndRef;
        const endRef = ends[index * 2 + 1] as EndRef;
        for (const ref of [startRef, endRef]) {
            records.push({
                pathPublicId: path.publicId,
                which: ref.which,
                x: ref.point[0],
                y: ref.point[1],
                key: ref.key,
                contact: contactOf(ref),
                nodeId: nodeOf(ref),
                partners: (partnersOf.get(ref) ?? []).map((partner) => ({
                    pathPublicId: (paths[partner.path] as TopologyPath).publicId,
                    kind: partner.kind,
                })),
            });
        }
        return { publicId: path.publicId, coordinates, stations, start: nodeOf(startRef), end: nodeOf(endRef), splits };
    });
    return { techNodes: [...techByKey.values()], ends: records, plans, insertedKeys };
}
