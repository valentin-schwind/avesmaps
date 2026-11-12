import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { loadConfig } from "../../config.ts";
import { createDatabase, WORKER_TIMEOUTS } from "../../database.ts";
import { loadGateFiles } from "../corpus-gate-run.ts";
import { summarize, type GateResult } from "../corpus-gate.ts";
import { loadRouteGraphRows, storedLine } from "../network.ts";
import { databaseRoutingSource, SNAPSHOT_TRANSACTION, type RoutingData } from "../service.ts";
import { deriveTopology, TECH_NODE_PREFIX } from "../topology.ts";
import { attribute, normalizeRoute, type AttributionContext, type NormalizedRoute } from "./compare.ts";
import { runGateCases, serviceOver, type CaseRun } from "./run.ts";
import { readStellen } from "./stellen.ts";

/**
 * WI-0132 Release N: der fachlich normalisierte Korpusvergleich VORHER/NACHHER auf demselben Datenstand.
 *
 *     cd apps/server
 *     node --env-file-if-exists=../../.env src/routing/topology-probe/release-n-cli.ts --vorher <vorher.json>
 *     node --env-file-if-exists=../../.env src/routing/topology-probe/release-n-cli.ts \
 *         --vergleich <vorher.json> --stellen <p1-stellen.csv> --out <abweichungen.json>
 *
 * `--vorher` rechnet die Fälle des Routing-Gates durch den Routendienst, so wie das Produkt ihn heute baut, und hält jede Route
 * fachlich normalisiert fest (`compare.ts`: Wegfolge nach `path.public_id`, Mittel, Wegart, Etappen, Strecke, Zeit, Linie; keine
 * `edge_id`, keine Knotenkennung). Aufgenommen wurde die Datei mit dem Code VOR Release N (Router mit Kreuzungen).
 *
 * `--vergleich` rechnet dieselben Fälle mit dem Code NACH Release N und ordnet jede Abweichung einer Stelle aus P1 zu (Liste
 * `…-stellen.csv`: jede Kreuzung mit Klasse und beteiligten Wegen). Regel wie in P1 (`attribute`): über eine Kreuzung der
 * Vorher-Route, die im Ziel nicht reproduziert ist; über einen geänderten Weg, der an einer solchen Kreuzung teilnimmt; über
 * einen technischen Knoten, der keine Kreuzung ersetzt. Sonst `unerklaert`: ein möglicher echter Routingfehler.
 *
 * Nur lesend, eine Transaktion je Lauf; Messwerkzeug, kein Gate (Exit 0, solange gerechnet werden konnte). Die Kreuzungstabelle
 * liest es nicht: Die Klassen kommen aus der versionierten Stellenliste von P1.
 */

const { values } = parseArgs({
    options: {
        vorher: { type: "string" },
        vergleich: { type: "string" },
        stellen: { type: "string" },
        out: { type: "string" },
    },
});

interface Stand {
    counts: { paths: number; places: number; nodix: number };
    pathRun: string | null;
}

interface RecordedCase {
    id: string;
    label: string;
    waypoints: string[];
    normalized: NormalizedRoute;
    gate: GateResult;
    ms: number;
}

interface Recording {
    recorded: string;
    stand: Stand;
    network: { nodes: number; links: number; places: number; other: number; buildMs: number };
    latency: Latency;
    cases: RecordedCase[];
}

interface Latency {
    median: number;
    p95: number;
    max: number;
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(2);
}
if (!values.vorher && !values.vergleich) {
    console.error("--vorher <datei> oder --vergleich <vorher.json> --stellen <csv> --out <datei>");
    process.exit(2);
}

const map = AVENTURIA.mapDomain;
const model = AVENTURIA_TRAVEL_MODEL;
const database = createDatabase(config.databaseUrl, { max: 2, timeouts: WORKER_TIMEOUTS });

/** Der Datenstand in EINER nur lesenden Transaktion, wie der Worker ihn lädt, dazu die Prüfzahlen. */
async function load(): Promise<{ data: RoutingData; stand: Stand; buildMs: number }> {
    return database.begin(SNAPSHOT_TRANSACTION, async (transaction) => {
        const began = performance.now();
        const data = await databaseRoutingSource(transaction, map, model).load();
        const buildMs = Math.round(performance.now() - began);
        const [counts] = await transaction<Stand["counts"][]>`
            SELECT (SELECT count(*) FROM path WHERE map_domain_id = ${map} AND is_active)::int AS paths,
                   (SELECT count(*) FROM place WHERE map_domain_id = ${map} AND is_active)::int AS places,
                   (SELECT count(*) FROM nodix WHERE map_domain_id = ${map} AND is_active)::int AS nodix
        `;
        const [run] = await transaction<{ source_ref: string; completed_at: Date }[]>`
            SELECT source_ref, completed_at FROM migration_run
            WHERE data_domain = 'paths' AND status = 'completed'
            ORDER BY completed_at DESC LIMIT 1
        `;
        return {
            data,
            stand: {
                counts: counts as Stand["counts"],
                pathRun: run ? `${run.source_ref} @ ${run.completed_at.toISOString()}` : null,
            },
            buildMs,
        };
    });
}

const latencyOf = (runs: readonly CaseRun[]): Latency => {
    const ms = runs.map((run) => run.ms).sort((a, b) => a - b);
    const at = (q: number): number =>
        Math.round((ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0) * 10) / 10;
    return { median: at(0.5), p95: at(0.95), max: at(1) };
};

/** Rechnet alle Fälle zweimal (kalt, dann warm) und hält den warmen Lauf fest. */
async function record(inserted: ReadonlySet<string>): Promise<Recording & { data: RoutingData }> {
    const { data, stand, buildMs } = await load();
    const network = data.network;
    const seaSource = databaseRoutingSource(database, map, model);
    const service = serviceOver(data, network, seaSource.loadSea);
    const files = loadGateFiles();
    await runGateCases(service, network, files.cases);
    const warm = await runGateCases(service, network, files.cases);
    const isPlace = (id: string): boolean => network.nodes.get(id)?.kind === "place";
    let places = 0;
    for (const node of network.nodes.values()) if (node.kind === "place") places += 1;
    return {
        data,
        recorded: new Date().toISOString(),
        stand,
        network: {
            nodes: network.nodes.size,
            links: network.links.length,
            places,
            other: network.nodes.size - places,
            buildMs,
        },
        latency: latencyOf(warm),
        cases: warm.map((run) => ({
            id: run.id,
            label: run.label,
            waypoints: run.waypoints,
            normalized:
                "unresolved" in run.outcome
                    ? normalizeRoute({ ok: false, error: "unknown_waypoint", detail: run.outcome.unresolved }, isPlace)
                    : normalizeRoute(run.outcome, isPlace, inserted),
            gate:
                "unresolved" in run.outcome
                    ? summarize({ ok: false, error: "unknown_waypoint", detail: run.outcome.unresolved })
                    : summarize(run.outcome),
            ms: Math.round(run.ms * 10) / 10,
        })),
    };
}

if (values.vorher) {
    const { data: _data, ...recording } = await record(new Set());
    void _data;
    writeFileSync(values.vorher, `${JSON.stringify(recording, null, 1)}\n`);
    console.log(
        JSON.stringify({ stand: recording.stand, network: recording.network, latency: recording.latency }, null, 1),
    );
    await database.end({ timeout: 5 });
    process.exit(0);
}

const before = JSON.parse(readFileSync(values.vergleich as string, "utf8")) as Recording;
if (!values.stellen || !values.out) {
    console.error("--vergleich braucht --stellen <p1-stellen.csv> und --out <datei>");
    process.exit(2);
}
const stellen = readStellen(values.stellen);

// Die Topologie des Produkts: eingefügte T-Punkte (für die Linie) und die Knoten der Wegenden (für „reproduziert“).
const topology = await database.begin(SNAPSHOT_TRANSACTION, async (transaction) => {
    const { places, paths } = await loadRouteGraphRows(transaction, map);
    return deriveTopology(
        places,
        paths.map((row) => ({ publicId: row.public_id, coordinates: storedLine(row) })),
    );
});
const inserted = new Set(topology.insertedKeys);
const after = await record(inserted);
await database.end({ timeout: 5 });

const nodeOfEnd = new Map(topology.ends.map((end) => [`${end.pathPublicId}|${end.which}`, end.nodeId]));
const openAnchorsOfPath = new Map<string, string[]>();
for (const stelle of stellen) {
    if (stelle.cls === "a") continue;
    for (const one of stelle.participants) {
        const list = openAnchorsOfPath.get(one.path) ?? [];
        list.push(stelle.id);
        openAnchorsOfPath.set(one.path, list);
    }
}
const context: AttributionContext = {
    anchorOf: new Map(stellen.map((stelle) => [stelle.id, `${stelle.cls}:${stelle.reason}`])),
    openAnchorsOfPath,
    reproduced: new Set(
        stellen
            .filter((stelle) => stelle.cls === "a")
            .flatMap((stelle) => stelle.participants.map((one) => nodeOfEnd.get(`${one.path}|${one.role}`) ?? "")),
    ),
    dropped: new Set(),
};

const byId = new Map(before.cases.map((one) => [one.id, one]));
const round = (value: number): number => Math.round(value * 1000) / 1000;
const cases = after.cases.map((now) => {
    const was = byId.get(now.id);
    if (!was) throw new Error(`Fall fehlt in der Vorher-Datei: ${now.id}`);
    const verdict = attribute(was.normalized, now.normalized, context);
    const change = (a: number, b: number): number | null => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);
    return {
        id: now.id,
        label: now.label,
        kind: verdict.kind,
        outcome: [was.normalized.outcome, now.normalized.outcome],
        hours: [round(was.normalized.totalHours), round(now.normalized.totalHours)],
        distance: [round(was.normalized.distance), round(now.normalized.distance)],
        hoursChangePercent: change(was.normalized.totalHours, now.normalized.totalHours),
        differences: verdict.differences,
        because: verdict.because,
        causes: [...new Set(verdict.because.map((id) => context.anchorOf.get(id) ?? "weg_oder_knoten"))],
        techNodesOnRoute: now.normalized.nonPlaceNodes.filter((id) => id.startsWith(TECH_NODE_PREFIX)).length,
        stageLeak: now.normalized.stagePlaces.filter((id) => !/^[0-9a-f-]{36}$/.test(id)),
    };
});
const counts: Record<string, number> = {};
for (const one of cases) counts[one.kind] = (counts[one.kind] ?? 0) + 1;
const contacts: Record<string, number> = {};
for (const end of topology.ends) contacts[end.contact] = (contacts[end.contact] ?? 0) + 1;
const result = {
    recorded: after.recorded,
    vorher: { recorded: before.recorded, stand: before.stand, network: before.network, latency: before.latency },
    nachher: {
        stand: after.stand,
        network: after.network,
        latency: after.latency,
        topology: {
            techNodes: topology.techNodes.length,
            inserted: topology.insertedKeys.length,
            contacts,
        },
    },
    sameStand: JSON.stringify(before.stand) === JSON.stringify(after.stand),
    counts,
    cases,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 1)}\n`);
console.log(
    JSON.stringify(
        {
            sameStand: result.sameStand,
            counts,
            vorher: result.vorher.network,
            nachher: result.nachher,
            unerklaert: cases.filter((one) => one.kind === "unerklaert").map((one) => one.id),
        },
        null,
        1,
    ),
);
