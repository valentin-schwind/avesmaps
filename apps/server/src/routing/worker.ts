import { hostname } from "node:os";
import { getHeapStatistics } from "node:v8";
import { parentPort, workerData } from "node:worker_threads";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, ROUTE_DEFAULTS } from "@avesmaps3d/shared";
import { createDatabase, sessionLimits, WORKER_TIMEOUTS } from "../database.ts";
import { beobachteLebendenHeap } from "./heap-lebend.ts";
import type { WorkerReply, WorkerRequest } from "./runner.ts";
import { databaseRoutingSource, RouteService } from "./service.ts";
import { routingRasterRead, routingSliceBytes } from "./sliced-read.ts";
import { onHeightExchange } from "./terrain-load.ts";

/**
 * Der Routing-Worker (WI-0017 R6): rechnet Routen außerhalb der Event-Loop des Servers (ADR-0009,
 * Kap. 6.63). Er hat eine eigene Datenbankverbindung, hält Netz und Graphen im Speicher und
 * arbeitet seine Nachrichten nacheinander ab.
 */

const port = parentPort;
const databaseUrl = (workerData as { databaseUrl?: string } | undefined)?.databaseUrl;
if (!port || !databaseUrl) {
    throw new Error("Der Routing-Worker braucht einen Elternthread und eine Datenbank-URL");
}

// Der Worker fragt nacheinander: zwei Verbindungen genügen, und der Server behält seine zehn.
const database = createDatabase(databaseUrl, { max: 2, timeouts: WORKER_TIMEOUTS });

// Einmal ins Journal, was in den Verbindungen des Workers wirklich gilt (WI-0037, S-05). Der Worker hat
// keinen Logger; die Zeile hat dieselbe Form wie die des Servers, damit sie sich gleich suchen lässt.
const journal = (level: number, fields: Record<string, unknown>, msg: string): void =>
    void process.stdout.write(
        `${JSON.stringify({ level, time: Date.now(), pid: process.pid, hostname: hostname(), pool: "worker", ...fields, msg })}\n`,
    );
sessionLimits(database).then(
    (limits) => journal(30, limits, "database session limits"),
    (error: unknown) =>
        journal(40, { err: error instanceof Error ? error.name : "unknown" }, "database session limits not readable"),
);
// Wie der Worker große Zeilen liest (Scheibengröße, Art) und welche Heap-Grenze er hat (WI-0298): einmal ins Journal, damit eine
// Einstellung über die Umgebung (`ROUTING_SLICE_MIB`, `ROUTING_RASTER_READ`, `ROUTING_WORKER_HEAP_MIB`) dort zu sehen ist, nicht nur im Prozess.
journal(
    30,
    {
        slice_mib: routingSliceBytes() / (1024 * 1024),
        raster_read: routingRasterRead(),
        heap_limit_mib: Math.round(getHeapStatistics().heap_size_limit / 1048576),
    },
    "routing read settings",
);
// Nur Art und Meldung, nie die Verbindung: Sie gehört nicht in ein Log (Kap. 10.92).
const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : "unbekannt");

// Einmal je Fehlerbild, nicht alle fünf Sekunden, solange etwa die Datenbank fehlt.
let lastFailure: string | undefined;
const reloadFailed = (error: unknown): void => {
    const err = describe(error);
    if (err !== lastFailure) journal(40, { err }, "routing graph reload failed");
    lastFailure = err;
};

// Ein Tausch der geänderten Kacheln des Höhenmodells (WI-0125) mit Zahl, Bytes, Dauer und Speicher danach.
onHeightExchange((exchange) => {
    const memory = process.memoryUsage();
    journal(
        30,
        {
            ...exchange,
            rss_mb: Math.round(memory.rss / 1048576),
            array_buffers_mb: Math.round(memory.arrayBuffers / 1048576),
        },
        "routing heights exchanged",
    );
});

// Der lebende Heap des Workers für `routing graph loaded` (WI-0298, Stufe 4).
const lebenderHeap = beobachteLebendenHeap();

// Wie oft der Worker den Fingerabdruck der Daten prüft - bei Anfragen wie im Leerlauf.
const RECHECK_MS = 5000;
const service = new RouteService({
    mapDomain: AVENTURIA.mapDomain,
    model: AVENTURIA_TRAVEL_MODEL,
    source: databaseRoutingSource(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL),
    recheckMs: RECHECK_MS,
    // Ändert sich nur die Karte, erst nach 5 s Ruhe, höchstens alle 15 s neu laden (WI-0177, Thomas 2.3; Hauptorchestrierung
    // 2026-10-19): Editoren schreiben in kurzer Folge, und jedes Laden des Graphen kostet rund eine Sekunde. Gelände, Wegprofile und
    // Einstellungen laden sofort.
    ruheMs: 5000,
    hoechstensMs: 15_000,
    // Jeder Wechsel des Stands mit seiner Ladezeit ins Journal: Claudios Meldeschwelle „Graph laden“ (WI-0037).
    onReload: (event) => {
        // Mit dem Speicher danach (WI-0298): Prozess-RSS, Heap des Workers und seine ArrayBuffers, je Wechsel des Stands.
        const memory = process.memoryUsage();
        journal(
            30,
            {
                ...event,
                rss_mb: Math.round(memory.rss / 1048576),
                heap_used_mb: Math.round(memory.heapUsed / 1048576),
                heap_total_mb: Math.round(memory.heapTotal / 1048576),
                array_buffers_mb: Math.round(memory.arrayBuffers / 1048576),
                heap_live_mb: lebenderHeap.mib(),
            },
            "routing graph loaded",
        );
        // Für `/health/routing` und den Job `routing_reload` (WI-0125): welcher Stand jetzt gilt.
        port.postMessage({ id: 0, loaded: { revision: event.revision } } satisfies WorkerReply);
    },
    onReloadError: reloadFailed,
});

// 🔴 Auch ohne Anfragen prüfen (WI-0037, Stufe 2a): Nach einem Import lädt der Worker den neuen Stand
// selbst, spätestens RECHECK_MS plus Ladezeit danach, statt dass ihn erst eine Anfrage anstößt und
// selbst noch den alten bekommt.
setInterval(() => {
    service.refresh().then(() => {
        lastFailure = undefined;
    }, reloadFailed);
}, RECHECK_MS).unref();

let queue: Promise<void> = Promise.resolve();
port.on("message", (message: WorkerRequest) => {
    queue = queue.then(async () => {
        let reply: WorkerReply;
        try {
            if (message.kind === "warm") {
                await service.warm({
                    optimize: ROUTE_DEFAULTS.optimize,
                    transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
                    enabled: { land: true, river: true, sea: true },
                    minimizeTransfers: ROUTE_DEFAULTS.minimize_transfers,
                });
                reply = { id: message.id, warmed: true };
            } else if (message.kind === "hoehen") {
                reply = { id: message.id, hoehen: await service.hoehenEntlang(message.linien) };
            } else {
                reply = { id: message.id, outcome: await service.route(message.query) };
            }
        } catch (error) {
            reply = { id: message.id, failure: describe(error) };
        }
        port.postMessage(reply);
    });
});
