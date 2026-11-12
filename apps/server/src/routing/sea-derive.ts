import { createHash } from "node:crypto";
import {
    seaGraphTransports,
    shipWaters,
    wegfindungVorgaben,
    type TravelModel,
    type Wegfindungswerte,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseWegfindung, wirksameWegfindung } from "../system/wegfindungsstand.ts";
import { closureCells, loadSeaClosures } from "./sea-closures.ts";
import { coastDistance, coastProfile } from "./sea-coast.ts";
import {
    compactSeaGraph,
    decodeSeaGraph,
    encodeSeaGraph,
    SEA_GRAPH_FORMAT,
    seaGraphBytes,
    waterMask,
    type CompactSeaGraph,
    type SeaGraphPort,
} from "./sea-graph-store.ts";
import {
    buildSeaGrid,
    loadNavigableWater,
    NARROWS_REACH,
    NARROWS_SUBDIVISION,
    nearestWaterCell,
    WATER_REGION_TYPES,
    type NarrowsReport,
} from "./sea-grid.ts";
import { landlessPort, type LandlessPort, type LandlessSettings } from "./sea-landless.ts";
import { loadSeaports } from "./sea-ports.ts";
import { SeaSearch } from "./sea-search.ts";
import { loadCoastRings, VisibilityGraph } from "./sea-visibility.ts";
import { blockedEdges, waterKindCells, watersReport } from "./sea-waters.ts";
import { readSlices } from "./sliced-read.ts";

/**
 * Leitet den Seegraphen ab (WI-0046, S1) und legt ihn in `sea_route_graph`. Derived Data, jederzeit
 * wiederholbar: beim Import (`npm run derive:sea-routes`) und später auf Anstoß eines Editors
 * (Betreiber 2026-09-27: „die vorberechnung muss von und durch editoren angestoßen werden können“) -
 * dieselbe Funktion, der Editor bekommt nur den Knopf.
 *
 * - **Ohne Seewege** (Betreiber 2026-09-27: „alles was seeweg ist im routing ignorieren, einfach keine
 *   seewege … das löschen der seewege darf keinerlei effekt haben“): Die Ableitung liest nur Wasser,
 *   Häfen, Klimabänder und das Reisemodell. Die Anlegestellen aus den Seewegen (S2 A, Selem und Haegir) und
 *   die Durchfahrten, wo ein Seeweg Land quert (S4 A), sind damit entfallen.
 * - **Idempotent:** Stimmen Algorithmus und Fingerabdruck der Quellen, tut der Lauf nichts. `force` rechnet
 *   trotzdem.
 * - **Häfen ohne Wasser** in drei Einheiten fehlen im Graphen und stehen samt Grund im Bericht (`sea-landless.ts`,
 *   WI-0060): Das sind die Häfen für den Prüfhaken „Kein Wasser-Zugang“ (S3); die Redaktion bindet sie wieder an.
 * - **Sperrgebiete** (S5, `sea-closures.ts`): je Schiff und Hafenpaar, durch welche Gebiete der Weg fährt.
 * - **Nur Schiffe mit eigenen Wegen** (WI-0069, `seaGraphTransports`): Wer mit dem Küstenabstand eines anderen
 *   fährt und dieselben Gewässer befährt, bekommt keine eigenen Seereisen; der Router liest die des anderen. Ein
 *   Schiff mit eigenen Gewässern (Ruderboot) fährt keine Kante, die ein fremdes Gewässer berührt (`sea-waters.ts`).
 */

/** Die Einstellungen, gemessen und abgenommen in WI-0046 (Benchmark, Graph-Ansicht). */
export const SEA_ROUTE_SETTINGS = {
    cell: 0.5,
    inset: 0.25,
    tolerance: 0.15,
    offsets: [0.35, 1.25],
    reach: 16,
    minArea: 10,
} as const;

/**
 * Wie die Gewässer eines Schiffs wirken (WI-0069); geht in den Fingerabdruck ein, nicht in den Algorithmus: Ein älterer
 * Graph bleibt lesbar, die nächste Ableitung rechnet neu.
 */
const WATERS_RULE = "gewaesser-je-kante";

/**
 * Die Engstellen einer Fläche (`connectNarrows`, Handover fjordhaefen 2026-11-09): Rand und Feinheit des feinen Rasters. Wie
 * `WATERS_RULE` im Fingerabdruck, nicht im Algorithmus: Der Router liest einen Graphen von vorher weiter (sonst fehlten die
 * Seereisen bis zur nächsten Ableitung, auch im Korpus des Release-Tests), und „Wegenetz neu berechnen“ rechnet ihn neu.
 */
const NARROWS_RULE = `engstellen${String(NARROWS_REACH)}x${String(NARROWS_SUBDIVISION)}`;

/**
 * Die vier Werte der Systemsteuerung, mit denen die Ableitung rechnet (Folge `seegraph` im Register, WI-0153 Schnitt 7a):
 * Zellbreite auf See, Reichweite der Anlegestelle, Sperrgebiete je Seereise, Suche nach fernem Wasser.
 *
 * 🪤 Sie kommen als Argument, nie über `werte()`: Die Ableitung läuft in einem eigenen Prozess (Zug, Kommandozeile, Auftrag),
 * der `setzeWerte` nie gesehen hat und dort immer die Vorgaben läse.
 */
export type Seegraphwerte = Pick<Wegfindungswerte, "seaCellUnits" | "landingReach" | "seaClosureLimit" | "farSearch">;

const SEEGRAPH_KENNUNGEN = ["seaCellUnits", "landingReach", "seaClosureLimit", "farSearch"] as const;

/** Die Seegraph-Werte aus allen wirksamen Werten. */
export function seegraphwerte(werte: Wegfindungswerte): Seegraphwerte {
    return {
        seaCellUnits: werte.seaCellUnits,
        landingReach: werte.landingReach,
        seaClosureLimit: werte.seaClosureLimit,
        farSearch: werte.farSearch,
    };
}

/**
 * Die Seegraph-Werte, wie die Systemsteuerung sie gerade vorgibt (nach der Regel des Dienstes, `wirksameWegfindung`). Lassen sie
 * sich nicht lesen (etwa ohne Leserecht der Rolle), rechnet die Ableitung mit den Vorgaben weiter und meldet einen Befund: Das ist
 * keine Prüfung, die einen Zug anhalten darf (`AGENTS.md`, „Blockierende Prüfungen im Betrieb“).
 */
export async function leseSeegraphwerte(database: Queryable): Promise<Seegraphwerte> {
    try {
        return seegraphwerte(wirksameWegfindung(await leseWegfindung(database, { personen: false })));
    } catch (error) {
        const grund = error instanceof Error ? error.message : String(error);
        console.warn(`BEFUND seegraph_werte: Werte der Wegfindung nicht lesbar (${grund}); es gelten die Vorgaben`);
        return seegraphwerte(wegfindungVorgaben());
    }
}

/**
 * Was davon von der Vorgabe abweicht, für den Fingerabdruck. Nur Abweichungen gehen ein: Mit den Vorgaben bleibt der Abdruck
 * eines vorhandenen Graphen gleich, und kein Zug rechnet ihn nur deshalb neu.
 */
function seegraphAbweichungen(werte: Seegraphwerte): Record<string, number> {
    const vorgaben = wegfindungVorgaben();
    const abweichend: Record<string, number> = {};
    for (const kennung of SEEGRAPH_KENNUNGEN)
        if (werte[kennung] !== vorgaben[kennung]) abweichend[kennung] = werte[kennung];
    return abweichend;
}

/**
 * Steigt mit jeder Änderung an Einstellungen oder Format; ein älterer Graph gilt dann als veraltet. 🪤 `zelle` nennt die
 * Vorgabe; eine eingestellte Zellbreite steht im Fingerabdruck, nicht hier, sonst verwürfe der Dienst jeden Graphen mit einer
 * anderen Zelle als veraltet.
 */
export const SEA_ROUTE_ALGORITHM = [
    `sichtgraph-f${String(SEA_GRAPH_FORMAT)}`,
    `zelle${String(SEA_ROUTE_SETTINGS.cell)}`,
    `einzug${String(SEA_ROUTE_SETTINGS.inset)}`,
    `vereinfacht${String(SEA_ROUTE_SETTINGS.tolerance)}`,
    `ringe${SEA_ROUTE_SETTINGS.offsets.join("+")}`,
    `bruecken${String(SEA_ROUTE_SETTINGS.reach)}`,
    `mindestflaeche${String(SEA_ROUTE_SETTINGS.minArea)}`,
    "ohneseewege",
].join("-");

export interface SeaRouteReport {
    written: boolean;
    fingerprint: string;
    ports: number;
    /** Häfen ohne befahrbares Wasser in drei Einheiten: Name, Kennung und Grund (WI-0060). */
    withoutLanding: LandlessPort[];
    /** Die Sperrgebiete und wie viele Hafenpaare des ersten Seeschiffs durch sie fahren. */
    closures: { name: string; pairs: number }[];
    /** Die Werte der Systemsteuerung, mit denen gerechnet wurde (WI-0153 Schnitt 7a); fehlt bei älteren Ständen. */
    seegraph?: Seegraphwerte;
    /** Je Schiff mit eigenen Gewässern, wie viele Häfen es anfahren kann (WI-0069); fehlt bei älteren Ständen. */
    waters?: { transport: string; ports: number }[];
    /** Was die Engstellen verbunden haben (`connectNarrows`); fehlt bei älteren Ständen. */
    narrows?: NarrowsReport;
    nodes: number;
    edges: number;
    bridges: number;
    bytes: number;
    ms: { graph: number; weights: number; pairs: number; total: number };
}

/**
 * Der Fingerabdruck der Quellen: Wasserflächen, Häfen, Klimabänder, die Seeschiffe mit eigenen Wegen samt
 * Küstenabstand und Gewässern, Sperren der Meere, Vereisung, Algorithmus. Seewege gehen nicht ein, und ein
 * Schiff, das die Wege eines anderen fährt, auch nicht: Es ändert den Graphen nicht.
 */
/** Was die Sätze über Häfen ohne Anlegestelle aus einem Bericht brauchen: die Werte, mit denen er gerechnet wurde. */
export function landlessSettings(report: Pick<SeaRouteReport, "seegraph">): LandlessSettings {
    return {
        cell: report.seegraph?.seaCellUnits ?? SEA_ROUTE_SETTINGS.cell,
        minArea: SEA_ROUTE_SETTINGS.minArea,
        ...(report.seegraph === undefined
            ? {}
            : { landingReach: report.seegraph.landingReach, farSearch: report.seegraph.farSearch }),
    };
}

export async function seaRouteFingerprint(
    database: Queryable,
    mapDomainId: string,
    model: TravelModel,
    werte?: Seegraphwerte,
): Promise<string> {
    const abweichend = seegraphAbweichungen(werte ?? (await leseSeegraphwerte(database)));
    const [row] = await database<{ water: string; ports: string; climate: string }[]>`
        SELECT
            (SELECT coalesce(md5(string_agg(md5(ST_AsBinary(a.geom)), ',' ORDER BY a.public_id)), '-')
             FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
             WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
               AND r.region_type IN ${database([...WATER_REGION_TYPES])}) AS water,
            (SELECT coalesce(md5(string_agg(p.public_id::text || ':' || ST_X(p.geom)::text || ':' || ST_Y(p.geom)::text, ',' ORDER BY p.public_id)), '-')
             FROM place p WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND p.is_seaport) AS ports,
            (SELECT coalesce(md5(string_agg(c.type_key || md5(ST_AsBinary(c.geom)), ',' ORDER BY c.type_key)), '-')
             FROM climate_band c) AS climate
    `;
    return createHash("sha256")
        .update(
            JSON.stringify([
                SEA_ROUTE_ALGORITHM,
                WATERS_RULE,
                NARROWS_RULE,
                row?.water,
                row?.ports,
                row?.climate,
                seaGraphTransports(model).map((transport) => [
                    transport,
                    coastProfile(model, transport),
                    shipWaters(model, transport),
                ]),
                model.meerSperren.wert,
                model.vereisung.wert,
                // Nur wenn ein Wert abweicht: Sonst bleibt der Abdruck, wie er vor Schnitt 7a war.
                ...(Object.keys(abweichend).length === 0 ? [] : [abweichend]),
            ]),
        )
        .digest("hex")
        .slice(0, 16);
}

export async function deriveSeaRoutes(
    database: Queryable,
    mapDomainId: string,
    model: TravelModel,
    options: { force?: boolean; werte?: Seegraphwerte } = {},
): Promise<SeaRouteReport> {
    const started = performance.now();
    const werte = options.werte ?? (await leseSeegraphwerte(database));
    const fingerprint = await seaRouteFingerprint(database, mapDomainId, model, werte);
    const [current] = await database<
        { algorithm_version: string; source_fingerprint: string; stats: SeaRouteReport }[]
    >`
        SELECT algorithm_version, source_fingerprint, stats FROM sea_route_graph WHERE map_domain_id = ${mapDomainId}
    `;
    if (
        !options.force &&
        current?.algorithm_version === SEA_ROUTE_ALGORITHM &&
        current.source_fingerprint === fingerprint
    ) {
        const unchanged: SeaRouteReport = { ...current.stats, written: false };
        if (unchanged.withoutLanding.some((port) => port.reason === undefined)) {
            // Ein Graph von vor WI-0060 trägt keinen Grund: nachrechnen (lokal rund 0,2 s), geschrieben wird nichts.
            const water = await loadNavigableWater(database, mapDomainId);
            const grid = buildSeaGrid(water, werte.seaCellUnits);
            unchanged.withoutLanding = (await loadSeaports(database, mapDomainId))
                .filter(
                    (port) => !nearestWaterCell(grid, port.x, port.y, werte.landingReach, SEA_ROUTE_SETTINGS.minArea),
                )
                .map((port) => landlessPort(grid, water, port, werte));
        }
        return unchanged;
    }

    const water = await loadNavigableWater(database, mapDomainId);
    const ports = await loadSeaports(database, mapDomainId);
    const rings = await loadCoastRings(database, mapDomainId, SEA_ROUTE_SETTINGS.inset, SEA_ROUTE_SETTINGS.tolerance);
    let clock = performance.now();
    const grid = buildSeaGrid(water, werte.seaCellUnits);
    const graph = new VisibilityGraph(grid, rings, {
        offsets: SEA_ROUTE_SETTINGS.offsets,
        bridge: { search: new SeaSearch(grid), reach: SEA_ROUTE_SETTINGS.reach },
    });
    const graphMs = performance.now() - clock;
    clock = performance.now();
    const transports = seaGraphTransports(model);
    graph.weigh(
        transports.map((transport) => coastProfile(model, transport)),
        coastDistance(grid),
    );
    const graphPorts: SeaGraphPort[] = [];
    const withoutLanding: LandlessPort[] = [];
    for (const port of ports) {
        const landing = nearestWaterCell(grid, port.x, port.y, werte.landingReach, SEA_ROUTE_SETTINGS.minArea);
        if (!landing) {
            withoutLanding.push(landlessPort(grid, water, port, werte));
            continue;
        }
        graphPorts.push({ placeId: port.id, node: graph.attach(landing.x, landing.y) });
    }
    const weightsMs = performance.now() - clock;
    clock = performance.now();
    const closures = await loadSeaClosures(database, model, water, werte.seaClosureLimit);
    const snapshot = graph.snapshot();
    const blocked = blockedEdges(snapshot, transports, model, grid, waterKindCells(grid, water));
    const compact = compactSeaGraph(
        snapshot,
        transports,
        graphPorts,
        waterMask(grid),
        { list: closures.closures, cells: closureCells(grid, closures.areas) },
        blocked,
    );
    const waters = watersReport(compact, model);
    const pairsMs = performance.now() - clock;
    const report: SeaRouteReport = {
        written: true,
        fingerprint,
        seegraph: werte,
        ports: graphPorts.length,
        withoutLanding,
        closures: compact.closures.map((closure, index) => ({
            name: closure.name,
            pairs: (compact.pairClosures[0] ?? new Uint8Array(0)).reduce(
                (count, bits) => count + ((bits >> index) & 1),
                0,
            ),
        })),
        waters,
        ...(grid.narrows ? { narrows: grid.narrows } : {}),
        nodes: compact.nodeX.length,
        edges: compact.edgeA.length,
        bridges: compact.bridgeEdges.length,
        bytes: seaGraphBytes(compact),
        ms: { graph: graphMs, weights: weightsMs, pairs: pairsMs, total: performance.now() - started },
    };
    await database`
        INSERT INTO sea_route_graph (map_domain_id, algorithm_version, source_fingerprint, graph, stats)
        VALUES (${mapDomainId}, ${SEA_ROUTE_ALGORITHM}, ${fingerprint}, ${encodeSeaGraph(compact)}, ${database.json(JSON.parse(JSON.stringify(report)))})
        ON CONFLICT (map_domain_id) DO UPDATE SET
            algorithm_version = EXCLUDED.algorithm_version,
            source_fingerprint = EXCLUDED.source_fingerprint,
            graph = EXCLUDED.graph,
            stats = EXCLUDED.stats,
            derived_at = now()
    `;
    return report;
}

export interface StoredSeaRoutes {
    graph: CompactSeaGraph;
    algorithm: string;
    fingerprint: string;
    derivedAt: string;
    stats: SeaRouteReport;
}

/**
 * Der gespeicherte Seegraph der Kartendomäne; null, wenn keiner abgeleitet ist. Mit `current` nur einer
 * des heutigen Algorithmus: Der Worker liest keinen veralteten Stand, er wartet auf die nächste Ableitung.
 *
 * Mit `sliceBytes` kommt der Graph in Scheiben (`sliced-read.ts`, WI-0071) statt als eine Zeile: Der Routing-Worker
 * liest so ohne die Spitze von 50 MiB ArrayBuffer, die der Treiber für 16 MiB Hexadezimaltext aufbaut. Wurde er
 * zwischen zwei Scheiben neu abgeleitet, ist das Ergebnis null wie bei „keiner passt“; der nächste Stand fragt neu.
 */
export async function loadSeaRoutes(
    database: Queryable,
    mapDomainId: string,
    options: { current?: boolean; sliceBytes?: number } = {},
): Promise<StoredSeaRoutes | null> {
    const { sliceBytes } = options;
    if (sliceBytes !== undefined) {
        const [head] = await database<
            {
                bytes: number;
                algorithm_version: string;
                source_fingerprint: string;
                derived_at: Date;
                stats: SeaRouteReport;
            }[]
        >`
            SELECT octet_length(graph) AS bytes, algorithm_version, source_fingerprint, derived_at, stats
            FROM sea_route_graph WHERE map_domain_id = ${mapDomainId}
            ${options.current ? database`AND algorithm_version = ${SEA_ROUTE_ALGORITHM}` : database``}
        `;
        if (!head) return null;
        const bytes = await readSlices(head.bytes, sliceBytes, async (offset, length) => {
            const [row] = await database<{ part: Buffer }[]>`
                SELECT substring(graph FROM ${offset + 1} FOR ${length}) AS part
                FROM sea_route_graph
                WHERE map_domain_id = ${mapDomainId} AND algorithm_version = ${head.algorithm_version}
                    AND source_fingerprint = ${head.source_fingerprint}
            `;
            return row?.part;
        });
        if (!bytes) return null;
        return {
            graph: decodeSeaGraph(bytes, { adopt: true }),
            algorithm: head.algorithm_version,
            fingerprint: head.source_fingerprint,
            derivedAt: head.derived_at.toISOString(),
            stats: head.stats,
        };
    }
    const [row] = await database<
        {
            graph: Buffer;
            algorithm_version: string;
            source_fingerprint: string;
            derived_at: Date;
            stats: SeaRouteReport;
        }[]
    >`
        SELECT graph, algorithm_version, source_fingerprint, derived_at, stats
        FROM sea_route_graph WHERE map_domain_id = ${mapDomainId}
        ${options.current ? database`AND algorithm_version = ${SEA_ROUTE_ALGORITHM}` : database``}
    `;
    if (!row) return null;
    return {
        graph: decodeSeaGraph(row.graph),
        algorithm: row.algorithm_version,
        fingerprint: row.source_fingerprint,
        derivedAt: row.derived_at.toISOString(),
        stats: row.stats,
    };
}
