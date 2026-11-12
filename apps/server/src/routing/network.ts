import type { ClosureReason, SeasonWindow } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { sliceProfile, type ProfileInput } from "./profile-slice.ts";
import { PAIR_FLOATS, sampleOffsets, SCHRITT_PER_UNIT, type SlopeSums } from "./slope.ts";
import { deriveTopology, type Topology } from "./topology.ts";

/**
 * Das Wegenetz für die Route (WI-0017, MCS-017; seit WI-0132 Release N ohne Kreuzungen): Knoten und Abschnitte, einmal
 * aus der Datenbank gebaut und für jede Anfrage wiederverwendet.
 *
 * 🔴 **Fachliche Eingaben sind nur Orte und Wege** (Betreiber 2026-10-10, WI-0132 §5). Welcher Knoten an einem Wegende
 * hängt und wo ein Weg geteilt wird, rechnet `topology.ts`: Ort im Kasten ±0,5 zuerst, sonst Ende auf Ende oder Ende auf
 * Weg (T-Stoß) auf fünf Stellen genau, sonst eine Sackgasse. Zwei durchgehende Wege verbinden nie. Die technischen Knoten
 * dafür entstehen hier, beim Netzaufbau nach einer Datenänderung, nie je Anfrage. Die Tabelle `crossing` liest das Netz
 * nicht mehr.
 *
 * Von Legacy (`client-graph.php`, avesmaps@bfec670) bleiben die Regeln der Ortsanbindung, mit zwei bewussten Abweichungen:
 *
 * - **Knoten über `public_id`, nicht über den Namen.** Legacy schlüsselt über den Ortsnamen (MCS-014: ein Name ist keine
 *   Identität).
 * - **Ein Wegende hängt am NÄCHSTEN Ort im Kasten**, nicht am niedrigsten Listenindex (MCS-017).
 */

export { createEndpointAttacher, ENDPOINT_BOX, EXACT_HIT } from "./topology.ts";
export type { EndpointAttacher } from "./topology.ts";

export interface RouteNode {
    id: string;
    /** Ortsname; ein technischer Knoten hat keinen ("") - der Name ist Anzeige, nie Schlüssel. */
    name: string;
    /**
     * `place` ein Ort (fachlich), `technical` ein technischer Knoten aus der Weggeometrie (`topology.ts`): Ende auf Ende,
     * T-Stoß oder Sackgasse. Er ist kein Kartenobjekt und nie Wegpunkt einer Anfrage.
     */
    kind: "place" | "technical";
    isHidden: boolean;
    /**
     * Entrückt (WI-0128 E21, EDIT-0001 D21; Betreiber 2026-10-10: „im Limbus und nicht auf der Route“): Die Wegfindung NENNT den
     * Ort nicht - weder als Etappenort noch im Vermerk einer Sperre. 🔴 Der Graph bleibt derselbe: Kein Brückenende, keine
     * Kante und keine Suche liest das Merkmal. Fehlt bei allen anderen Knoten.
     */
    isWithdrawn?: boolean;
    /** Die Ortsklasse eines Orts (WI-0039); ein technischer Knoten hat keine. */
    subtype?: string;
    x: number;
    y: number;
}

/** Ein Stück eines Weges zwischen zwei Knoten - die Kante des Graphen. */
export interface RouteLink {
    /** `<public_id>#<Teil>`; Teil zählt die Stücke eines an Innenpunkten geteilten Weges. */
    id: string;
    pathPublicId: string;
    pathName: string;
    subtype: string;
    from: string;
    to: string;
    /** In der gespeicherten Punktreihenfolge des Weges; ein T-Punkt des Graphen steht mit drin. */
    coordinates: [number, number][];
    /** Länge in Karteneinheiten. */
    distance: number;
    allowedTransports: string[] | null;
    transportDomain: string | null;
    /**
     * Reisemittel vom Editor vollständig geschrieben (`path.transports_written`, Migration 0208, F16 „A“): Liste und Fenster gelten wie
     * gespeichert, nichts erbt (`allowedTransportsForPath`, `pathSeasonWindow`). Fehlt sonst; geteilte Stücke erben es mit dem Rest.
     */
    transportsWritten?: true;
    /** Fließrichtung und -faktor, nur an Flusswegen mit bekannter Richtung. */
    flow: { dir: "forward" | "reverse"; factor: number | null } | null;
    /**
     * Wann der Weg je Reisemittel gangbar ist (`path.transport_seasons`, WI-0038). Fehlt ein Mittel,
     * ist er für es ganzjährig gangbar. Geteilte Stücke erben es mit dem Rest des Weges.
     */
    seasons?: Readonly<Record<string, SeasonWindow>> | undefined;
    /**
     * Wie ein Sperrbericht die Kante nennt, wenn sie keinen Wegnamen hat: bei der freien Seefahrt die
     * Sperrgebiete auf ihrem Weg (WI-0046, S5). Der Reiseplan zeigt ihn nicht.
     */
    seasonLabel?: string;
    /** Warum die Kante außerhalb ihres Fensters nicht gangbar ist, wo bekannt (freie Seefahrt). */
    seasonReason?: ClosureReason | undefined;
    /** Das Höhenprofil des Stücks aus `terrain_path_profile` (WI-0049 S5a); fehlt ohne Profil. */
    slope?: SlopeSums;
    /**
     * Das Stück läuft durch einen Tunnel (`path.is_tunnel`, WI-0177, Migration 0172): Kein Gang querfeldein steigt entlang des
     * Stücks ein oder aus (`route-edge.ts`, `inTunnel`). Tempo und Mittel bleiben die seiner Wegart. Fehlt sonst; geteilte
     * Stücke erben es mit dem Rest des Weges.
     */
    tunnel?: true;
    /**
     * Nur an einem Anker geteilte Stücke (`wp-slice-…`): welchen Teil des Stücks im Netz sie tragen, in
     * Karteneinheiten ab seinem Anfang in Punktreihenfolge. Die Steigung eines Abschnitts nimmt nur diesen
     * Teil (WI-0049 S5d); die Zeit erbt das Stück je Einheit.
     */
    span?: { from: number; to: number };
}

export interface RouteNetwork {
    /** Orte und technische Knoten. */
    nodes: Map<string, RouteNode>;
    links: RouteLink[];
    /**
     * Knoten, die ein Seeweg berührt, an einem Ende oder an einer Teilung. Aus ALLEN
     * Seewegen, auch wenn eine Anfrage die See abschaltet: So erkennt eine Landroute die Insel und baut
     * keine Querfeldein-Kante übers Meer dorthin (Legacy avesmapsCollectClientSeaBoundLocationNames).
     */
    seaBound: Set<string>;
    /**
     * Die GESPEICHERTE Linie jedes Weges, nach `public_id`: Die gezeichnete Kurve eines geteilten Stücks (`display.ts`)
     * braucht den ganzen Weg, wie die Karte ihn zeichnet - ohne die T-Punkte des Graphen.
     */
    paths: Map<string, [number, number][]>;
    /**
     * Hat der Stand Wegprofile (WI-0049 S5a)? Ohne sie rechnet der Router wie vor S5a (Koordination
     * 2026-09-27): Die Steigung wirkt erst, wenn `derive:terrain` sie für die heutige Geometrie gerechnet hat.
     */
    hasProfiles: boolean;
}

export interface PathRow {
    public_id: string;
    name: string;
    subtype: string;
    coordinates: string;
    allowed_transports: string[] | null;
    transport_domain: string | null;
    flow_direction: "forward" | "reverse" | null;
    flow_factor: number | null;
    transport_seasons?: Record<string, SeasonWindow> | string | null;
    /** Tunnel (Migration 0172); fehlt in Zeilen aus Tests und älteren Quellen: kein Tunnel. */
    is_tunnel?: boolean;
    /** Reisemittel vollständig geschrieben (Migration 0208); fehlt in Zeilen aus Tests und älteren Quellen: nein. */
    transports_written?: boolean;
}

/**
 * Die Länge eines Linienzugs in Karteneinheiten. Die einzige: Router, Anker, Flug und Seesuche messen alle mit ihr
 * (vorher stand dieselbe Schleife dreimal, in `router.ts`, `network.ts` und `sea-search.ts`).
 */
export function lineLength(coordinates: readonly [number, number][]): number {
    let length = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
        const [x0, y0] = coordinates[index - 1] as [number, number];
        const [x1, y1] = coordinates[index] as [number, number];
        length += Math.hypot(x1 - x0, y1 - y0);
    }
    return length;
}

export interface NetworkOptions {
    /**
     * NUR für den Paritätsvergleich: Legacys Listenreihenfolge (`sort_order, id`) je Ort. Ist sie gesetzt, hängt ein
     * Wegende wie in Legacy am niedrigsten Listenindex statt am nächsten Ort.
     */
    legacyOrder?: Map<string, number>;
    /** Die Höhenprofile je Weg (`public_id`), je Stützpunktpaar `PAIR_FLOATS` Zahlen (WI-0049 S5a). */
    profiles?: ReadonlyMap<string, Float32Array>;
    /** Die Abtastwerte je Weg (`public_id`), Aufbau siehe `SAMPLE_HEADER` in `slope.ts` (S5c); fehlt vor S5c. */
    samples?: ReadonlyMap<string, Float32Array>;
    /**
     * Die Kenngrößen des Netzaufbaus für DIESEN Aufbau (WI-0153): Fangradius, Ortskasten, exakter Treffer und
     * Schritt je Karteneinheit. Ohne Angabe gelten die Konstanten.
     *
     * 🔴 Sie kommen als Argument, nicht aus `einstellungen.ts`: Während ein neuer Stand lädt, antwortet der alte
     * noch, und beide müssen bei IHREN Zahlen bleiben (`service.ts`).
     */
    endSnap?: number;
    endpointBox?: number;
    exactHit?: number;
    schrittPerUnit?: number;
}

/** Die gespeicherte Linie einer Wegzeile. */
export const storedLine = (path: Pick<PathRow, "coordinates">): [number, number][] =>
    (JSON.parse(path.coordinates) as { coordinates: [number, number][] }).coordinates;

/** Das Netz aus Orten und Wegen; `places` sind fachliche Knoten (Ortsregel, Kasten ±0,5). */
export function buildRouteNetwork(places: RouteNode[], paths: PathRow[], options: NetworkOptions = {}): RouteNetwork {
    return buildTopologyNetwork(places, paths, options).network;
}

/**
 * Das Netz samt seiner Topologie (`topology.ts`), für Prüfer, die beides brauchen (lose Wegenden, Prüfhaken): EINE
 * Ableitung, dieselbe wie im Router.
 */
export function buildTopologyNetwork(
    nodeList: RouteNode[],
    paths: PathRow[],
    options: NetworkOptions = {},
): { network: RouteNetwork; topology: Topology } {
    const order = options.legacyOrder;
    const rank = (node: RouteNode): number => order?.get(node.id) ?? Number.MAX_SAFE_INTEGER;
    const places = order ? [...nodeList].sort((a, b) => rank(a) - rank(b)) : nodeList;
    const lines = paths.map(storedLine);
    const topology = deriveTopology(
        places,
        paths.map((path, index) => ({ publicId: path.public_id, coordinates: lines[index] as [number, number][] })),
        {
            ...(order ? { legacyOrder: order } : {}),
            ...(options.endSnap === undefined ? {} : { endSnap: options.endSnap }),
            ...(options.endpointBox === undefined ? {} : { endpointBox: options.endpointBox }),
            ...(options.exactHit === undefined ? {} : { exactHit: options.exactHit }),
        },
    );
    const nodes = new Map<string, RouteNode>(places.map((node) => [node.id, node]));
    for (const node of topology.techNodes) nodes.set(node.id, node);

    const links: RouteLink[] = [];
    const stored = new Map<string, [number, number][]>();
    const seaBound = new Set<string>();
    paths.forEach((path, index) => {
        const line = lines[index] as [number, number][];
        const plan = topology.plans[index] as Topology["plans"][number];
        stored.set(path.public_id, line);
        // Ein Seeweg macht jeden Knoten, den er berührt, zum Hafen: Enden und Teilungen.
        if (path.subtype === "Seeweg") {
            seaBound.add(plan.start);
            seaBound.add(plan.end);
            for (const split of plan.splits) seaBound.add(split.nodeId);
        }
        const profile = profileOf(path.public_id, line, options);

        // Ein früher Import legte jsonb als Zeichenkette ab (behoben, paths.ts); gelesen wird beides.
        const kept =
            typeof path.transport_seasons === "string"
                ? (JSON.parse(path.transport_seasons) as Record<string, SeasonWindow> | null)
                : (path.transport_seasons ?? null);
        const seasons = kept && Object.keys(kept).length > 0 ? kept : null;
        const flow =
            path.subtype === "Flussweg" && path.flow_direction !== null
                ? { dir: path.flow_direction, factor: path.flow_factor === null ? null : Number(path.flow_factor) }
                : null;

        // Geteilt wird an jedem Knoten auf dem Weg; zwei gleiche hintereinander teilen einmal.
        const cuts: { index: number; node: string }[] = [{ index: 0, node: plan.start }];
        for (const split of plan.splits) {
            if (split.nodeId !== cuts[cuts.length - 1]?.node) cuts.push({ index: split.index, node: split.nodeId });
        }
        cuts.push({ index: plan.coordinates.length - 1, node: plan.end });
        for (let part = 0; part < cuts.length - 1; part += 1) {
            const from = cuts[part] as { index: number; node: string };
            const to = cuts[part + 1] as { index: number; node: string };
            if (from.node === to.node) continue;
            const slice = plan.coordinates.slice(from.index, to.index + 1);
            if (slice.length < 2) continue;
            links.push({
                id: `${path.public_id}#${String(part)}`,
                pathPublicId: path.public_id,
                pathName: path.name,
                subtype: path.subtype,
                from: from.node,
                to: to.node,
                coordinates: slice,
                distance: lineLength(slice),
                allowedTransports: path.allowed_transports,
                transportDomain: path.transport_domain,
                ...(path.transports_written === true ? { transportsWritten: true as const } : {}),
                flow,
                ...(seasons ? { seasons } : {}),
                ...(path.is_tunnel === true ? { tunnel: true as const } : {}),
                ...(profile
                    ? {
                          slope: sliceProfile(
                              profile,
                              plan.stations[from.index] as { pair: number; t: number },
                              plan.stations[to.index] as { pair: number; t: number },
                          ),
                      }
                    : {}),
            });
        }
    });
    return {
        network: { nodes, links, seaBound, paths: stored, hasProfiles: (options.profiles?.size ?? 0) > 0 },
        topology,
    };
}

/** Das Höhenprofil eines Weges für `sliceProfile`; ohne Profil `null`. */
function profileOf(publicId: string, line: readonly [number, number][], options: NetworkOptions): ProfileInput | null {
    const pairs = options.profiles?.get(publicId);
    if (!pairs) return null;
    const values = options.samples?.get(publicId);
    const offsets = values ? sampleOffsets(values, pairs.length / PAIR_FLOATS) : null;
    // Die Länge jedes Paars in Schritt: Sie sagt, wo ein Abtastschritt im Stück liegt (S5d).
    // 🪤 EINMAL gelesen, nicht je Stützpunktpaar (WI-0153).
    const schritt = options.schrittPerUnit ?? SCHRITT_PER_UNIT;
    const lengths = offsets
        ? line.slice(1).map((point, index) => {
              const [x0, y0] = line[index] as [number, number];
              return Math.hypot(point[0] - x0, point[1] - y0) * schritt;
          })
        : [];
    return { pairs, samples: values && offsets ? { values, offsets } : null, lengths };
}

/**
 * Die Zeilen, aus denen das Netz entsteht: aktive Orte und aktive Wege. Seit WI-0132 Release N keine Kreuzungen mehr; die
 * Tabelle `crossing` bleibt bis Release N+1 nur als Rückweg stehen und wird von keinem Produktpfad gelesen.
 *
 * 🔴 Eigene Funktion, damit ein Werkzeug, das über DAS NETZ urteilt (`loose-endpoints.ts`, die Prüfhaken), genau
 * diesen Bestand liest und nicht einen eigenen, der morgen anders filtert. Die Höhenprofile holt
 * `loadRouteNetwork` darüber hinaus; wer nur Knoten und Linien braucht, zahlt sie nicht.
 */
export async function loadRouteGraphRows(
    database: Queryable,
    mapDomainId: string,
): Promise<{ places: RouteNode[]; paths: PathRow[] }> {
    const rows = await database<
        { id: string; name: string; subtype: string; hidden: boolean; withdrawn: boolean; x: number; y: number }[]
    >`
        SELECT public_id::text AS id, name, subtype, is_hidden AS hidden, is_withdrawn AS withdrawn, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM place
        WHERE map_domain_id = ${mapDomainId} AND is_active
        ORDER BY public_id
    `;
    const paths = await database<PathRow[]>`
        SELECT public_id::text, name, subtype, ST_AsGeoJSON(geom) AS coordinates,
               allowed_transports, transport_domain, flow_direction, flow_factor::float8 AS flow_factor,
               transport_seasons, is_tunnel, transports_written
        FROM path
        WHERE map_domain_id = ${mapDomainId} AND is_active
        ORDER BY public_id
    `;
    const places: RouteNode[] = rows.map((place) => ({
        id: place.id,
        name: place.name,
        kind: "place",
        isHidden: place.hidden,
        ...(place.withdrawn ? { isWithdrawn: true } : {}),
        subtype: place.subtype,
        x: place.x,
        y: place.y,
    }));
    return { places, paths };
}

/** Liest Orte und Wege samt Höhenprofilen und baut das Netz. */
export async function loadRouteNetwork(
    database: Queryable,
    mapDomainId: string,
    options: NetworkOptions = {},
): Promise<RouteNetwork> {
    const { places, paths } = await loadRouteGraphRows(database, mapDomainId);
    // Nur Profile, die zur heutigen Geometrie passen: Ein geänderter Weg zählt bis zum nächsten
    // `derive:terrain` als eben, statt mit dem Profil seiner alten Linie zu rechnen.
    const profileRows = await database<{ id: string; pairs: Buffer; samples: Buffer | null }[]>`
        SELECT p.public_id::text AS id, t.pairs, t.samples
        FROM terrain_path_profile t JOIN path p ON p.id = t.path_id
        WHERE t.map_domain_id = ${mapDomainId} AND p.is_active AND t.geometry_md5 = md5(ST_AsBinary(p.geom))
    `;
    const floats = (bytes: Buffer): Float32Array =>
        new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const profiles = new Map(profileRows.map((row) => [row.id, floats(row.pairs)]));
    // Die Abtastwerte für Reittier und Wagen (S5c); ein Profil von vor S5c hat keine.
    const samples = new Map(
        profileRows.flatMap((row): [string, Float32Array][] => (row.samples ? [[row.id, floats(row.samples)]] : [])),
    );
    return buildRouteNetwork(places, paths, { ...options, profiles, samples });
}
