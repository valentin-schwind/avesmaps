import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { RoutingFailureReason, RoutingState } from "@avesmaps3d/shared";
import type { RouteOutcome, RouteQuery, RouteService } from "./service.ts";

/**
 * Die Steuerung der Route im Server (WI-0017 R6, ADR-0009): Ein Worker rechnet, die Event-Loop
 * wartet nur. Claudios Budget (`handovers/2026-09-23-routing-pgrouting-einschaetzung-claudio.md`):
 *
 * - **Eine Rechnung zur Zeit.** Ein Worker arbeitet seine Nachrichten nacheinander ab - höchstens
 *   zwei gleichzeitig verlangt das Budget, einer genügt bei Millisekunden je Route.
 * - **Begrenzte Warteschlange.** Mehr als `maxPending` offene Anfragen beantwortet die Steuerung
 *   sofort mit `routing_busy`; der Aufrufer schickt dann 503 mit `Retry-After`.
 * - **Antwort nach spätestens `timeoutMs`.** Dann `routing_timeout`. Der Worker rechnet weiter, seine
 *   späte Antwort wird verworfen, und sie zählt bis dahin als offen - so staut sich nichts auf.
 * - **Höchstens `maxPendingPerClient` offene Rechnungen je Client** (WI-0037, S-04): Ein Client allein
 *   füllt die Schlange nicht, und die Anfragen der anderen kommen weiter durch. Offen bleibt auch eine
 *   abgelaufene oder abgebrochene Anfrage, bis der Worker sie fertig hat - wie bei `maxPending`.
 * - **Ein hängender Worker wird ersetzt.** Antwortet er `stuckMs` lang nicht, wird er beendet und
 *   beim nächsten Aufruf neu gestartet. 🔴 Geprüft wird VOR der Warteschlangengrenze (WI-0037, S-03):
 *   Sonst antwortete bei voller Schlange jede Anfrage `routing_busy`, bevor sie die Stelle erreichte,
 *   die den Worker ersetzt - bis zum Neustart des Prozesses.
 * - **Jeder neue Worker wärmt sich zuerst vor** (WI-0037, Stufe 2a), beim Start des Servers wie nach
 *   einem Ersatz: Netz, Standardprofil und Ortsindex. 🔴 Solange er das tut, läuft die Uhr einer Anfrage
 *   nicht - sie bekommt ihre `timeoutMs` erst danach, höchstens wartet sie `stuckMs`. Vorher lief die
 *   erste Route nach einem Neustart in die 2 s, weil sie hinter dem Vorwärmen wartete (Stage: 2,1 s).
 * - **Ein Neuladen der Daten ohne Neustart sieht die Steuerung nicht** (WI-0117): Der Dienst im Worker bereitet den neuen
 *   Stand selbst vor (`RouteService.prepare`, dieselbe Stelle wie das Vorwärmen), während der alte antwortet; der Zustand
 *   bleibt `ready`, und die erste Route nach dem Wechsel findet Graph, Brücken und Flugraster fertig.
 * - **Der Zustand ist von außen lesbar** (WI-0075 R5a, `GET /health/routing`): `cold` (kein Worker), `warming`
 *   (lädt vor), `ready` (Vorwärmen geschafft), `failed` (Vorwärmen gescheitert, Worker beendet oder ersetzt). Scheitern
 *   und Erfolg des Vorwärmens sind unterscheidbar; vorher räumte beides nur `warmingId` ab. Ein gescheitertes
 *   Vorwärmen heilt die erste Route, die der Worker danach berechnet (er hat dafür das Netz geladen).
 */

/**
 * Höhen entlang von Linien im schon geladenen Höhenmodell des Workers (WI-0245, Reiter „Gebirge“: Profile der Flüsse und Pässe): je Linie
 * die Abstände (E) und Höhen (Schritt) wie das Flussprofil der Route (`water-profile.ts`), `null` je Linie ohne Länge und ganz `null`
 * ohne Höhenmodell. Nur Anzeige; nichts wird geladen, was die Route nicht ohnehin lädt.
 */
export type HoehenEntlang = ({ at: number[]; height: number[] } | null)[] | null;

export type WorkerRequest =
    | { id: number; kind: "route"; query: RouteQuery }
    | { id: number; kind: "warm" }
    | { id: number; kind: "hoehen"; linien: [number, number][][] };
export type WorkerReply =
    | { id: number; outcome: RouteOutcome }
    | { id: number; hoehen: HoehenEntlang }
    | { id: number; failure: string }
    | { id: number; warmed: true }
    /** Der Worker hat einen neuen Stand geladen und aktiviert (WI-0125): keine Antwort auf eine Anfrage. */
    | { id: 0; loaded: { revision: string } };

export type RunOutcome =
    RouteOutcome | { ok: false; error: "routing_busy" | "routing_timeout" | "routing_failed"; detail?: string };

/** Der Zustand der Steuerung für `GET /health/routing`. */
export interface RouteRunnerStatus {
    state: RoutingState;
    /** Nur bei `failed`. */
    reason?: RoutingFailureReason;
    /** Wie lange der Zustand schon gilt, in Millisekunden. */
    ageMs: number;
    /** Der Schlüssel des geladenen Datenstands (`routing_graph_revision`, WI-0125); fehlt, solange keiner geladen ist. */
    revision?: string;
}

/**
 * Der Speicher des Worker-Threads für den Systemzustand (WI-0127 §22): Er ist ein Thread im Fastify-Prozess, sein Speicher steckt in dessen
 * RSS. `heap` ist der reservierte V8-Heap, `graph` der Speicher außerhalb des Heaps (vor allem die ArrayBuffers des Graphen).
 */
export interface ThreadSpeicher {
    heap: number;
    graph: number | null;
}

/** So viele Plätze der Warteschlange bleiben den Routen, auch wenn Profile anstehen (`hoehen`). */
const HOEHEN_FREI_FUER_ROUTEN = 2;

/** So lange wartet der Systemzustand höchstens auf die Zahlen des Threads. */
const SPEICHER_TIMEOUT_MS = 1_000;

export interface RouteRunner {
    run(query: RouteQuery): Promise<RunOutcome>;
    /** Startet den Worker, der dabei Netz und Standardprofil vorab lädt. */
    warm(): void;
    /** Ob der Routenrechner sein Netz geladen hat; ohne Nebenwirkung, ohne den Worker zu fragen. */
    status(): RouteRunnerStatus;
    /** Höhen entlang von Linien (`HoehenEntlang`); `null`, wenn der Worker voll ist, nicht antwortet oder kein Höhenmodell hat. */
    hoehen?(linien: [number, number][][], client?: string): Promise<HoehenEntlang>;
    /** Heap und Graph des Worker-Threads; `null` ohne Worker oder wenn er nicht antwortet. Fehlt bei Steuerungen ohne Thread. */
    speicher?(): Promise<ThreadSpeicher | null>;
    close(): Promise<void>;
}

/** Was die Steuerung von einem Worker braucht - im Test ein Double. */
export interface WorkerLike {
    postMessage(message: WorkerRequest): void;
    on(event: "message", listener: (reply: WorkerReply) => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "exit", listener: (code: number) => void): unknown;
    terminate(): Promise<number>;
    /** Nodes `Worker.getHeapStatistics`; ein Double kann es weglassen. */
    getHeapStatistics?(): Promise<{ total_heap_size: number; external_memory?: number }>;
}

export interface WorkerRunnerOptions {
    /** Die Datenbank des Workers. */
    databaseUrl?: string;
    createWorker?: () => WorkerLike;
    maxPending?: number;
    maxPendingPerClient?: number;
    timeoutMs?: number;
    stuckMs?: number;
    onError?: (error: unknown) => void;
    /**
     * Der Worker hat einen neuen Stand aktiviert (WI-0125); der Server schreibt dazu seinen eigenen Speicher ins Journal (WI-0298:
     * die Zeile des Workers kennt nur dessen Heap, der RSS gehört dem ganzen Prozess).
     */
    onLoaded?: (revision: string) => void;
    now?: () => number;
}

/** Aus `src/` läuft der Worker als `.ts`, aus `dist/` als `.js` - dieselbe Endung wie diese Datei. */
const workerFile = new URL(`./worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

/**
 * Die Heap-Grenze des Routing-Workers in MiB (WI-0298, Stage-Server 2026-11-09: 1,3 GB RSS 15 min nach dem Start, das Speichertor des
 * Wrappers hielt die gemeinsame Warteschlange an). 🔴 Sie ist weniger Deckel als Taktgeber: Ohne Grenze wählt V8 seinen größten
 * Wachstumsfaktor und räumt erst beim Dreifachen des lebenden Heaps auf. Gemessen (lokal, 8 Profile, rund 140 MB lebend):
 * Neuladen eines Stands ohne Grenze 430 bis 465 MB belegt, mit 512 MB 270 bis 290 MB bei gleicher Ladezeit, mit 256 MB 235 bis 260 MB und
 * gut ein Viertel langsamer, mit 192 MB bricht das Neuladen ab. Den unter Last belegten Speicher gibt der Prozess nicht zurück; 432 Routen über
 * 36 Profile hoben ihn ohne Grenze von 0,5 auf 1,4 GB, mit 512 MB auf 0,9 bis 1,0 GB.
 *
 * `ROUTING_WORKER_HEAP_MIB` stellt sie auf dem VPS ohne Codeänderung um (Claudio), zwischen 256 und 4096; was keine solche Zahl ist, gilt
 * als nicht gesetzt. Reicht sie einmal nicht, endet der Worker (`worker_exited`) und die nächste Route startet einen neuen.
 * 🪤 Ein `--max-old-space-size` des Prozesses (`NODE_OPTIONS`) schlägt diese Grenze: V8 nimmt dann für JEDEN Thread den Wert des Schalters
 * (lokal gemessen 2026-11-11: mit 768 meldet `routing read settings` `heap_limit_mib` 960 statt 704). Wer den Hauptthread begrenzt, begrenzt
 * damit auch den Worker; die Zahl hier wirkt dann nicht mehr.
 */
export const ROUTING_WORKER_HEAP_MIB = 512;
export const ROUTING_WORKER_HEAP_ENV = "ROUTING_WORKER_HEAP_MIB";

export function routingWorkerHeapMib(environment: Readonly<Record<string, string | undefined>> = process.env): number {
    const raw = environment[ROUTING_WORKER_HEAP_ENV]?.trim();
    if (!raw) return ROUTING_WORKER_HEAP_MIB;
    const mib = Number(raw);
    if (!Number.isFinite(mib) || mib <= 0) return ROUTING_WORKER_HEAP_MIB;
    return Math.round(Math.min(4096, Math.max(256, mib)));
}

/** Was der echte Routing-Worker beim Start bekommt: seine Datenbank und die Heap-Grenze. */
export function routingWorkerOptions(
    databaseUrl: string | undefined,
    environment: Readonly<Record<string, string | undefined>> = process.env,
): { workerData: { databaseUrl: string | undefined }; resourceLimits: { maxOldGenerationSizeMb: number } } {
    return {
        workerData: { databaseUrl },
        resourceLimits: { maxOldGenerationSizeMb: routingWorkerHeapMib(environment) },
    };
}

interface Pending {
    settle: (outcome: RunOutcome) => void;
    /** Nur bei einer Anfrage nach Höhen (`hoehen`): ihre Antwort. Scheitern und Zeitgrenze gehen über `settle`. */
    hoehen?: (werte: HoehenEntlang) => void;
    sentAt: number;
    client: string | undefined;
    settled: boolean;
    /** Eine Route mit Zeitgrenze; das Vorwärmen hat keine. */
    timed: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
}

export function createWorkerRunner(options: WorkerRunnerOptions = {}): RouteRunner {
    const maxPending = options.maxPending ?? 8;
    const maxPendingPerClient = options.maxPendingPerClient ?? 2;
    const timeoutMs = options.timeoutMs ?? 2000;
    const stuckMs = options.stuckMs ?? 30_000;
    const now = options.now ?? (() => Date.now());
    // Nodes Worker erfüllt WorkerLike; seine Ereignis-Überladungen sind nur breiter typisiert.
    const spawn: () => WorkerLike =
        options.createWorker ??
        (() => new Worker(workerFile, routingWorkerOptions(options.databaseUrl)) as unknown as WorkerLike);
    const pending = new Map<number, Pending>();
    let worker: WorkerLike | undefined;
    /** Die Nummer des Vorwärmens, solange der Worker noch vorwärmt. */
    let warmingId: number | undefined;
    let nextId = 1;
    // Der Zustand für `GET /health/routing`: Er ändert sich nur über `enter`, am Worker-Start, an der Antwort des
    // Vorwärmens, beim Verlust des Workers und beim Schließen.
    let state: RoutingState = "cold";
    /** Der zuletzt geladene Datenstand des Workers (WI-0125). */
    let loadedRevision: string | undefined;
    let reason: RoutingFailureReason | undefined;
    let stateSince = now();
    const enter = (next: RoutingState, why?: RoutingFailureReason): void => {
        state = next;
        reason = why;
        stateSince = now();
    };

    const settle = (entry: Pending, outcome: RunOutcome): void => {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        if (entry.settled) return;
        entry.settled = true;
        entry.settle(outcome);
    };
    // Der Eintrag bleibt offen, bis der Worker antwortet: Das ist die Rückstaugrenze.
    const startTimer = (entry: Pending, ms: number): void => {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            entry.settled = true;
            entry.settle({ ok: false, error: "routing_timeout" });
        }, ms);
    };
    const failAll = (): void => {
        for (const entry of pending.values()) settle(entry, { ok: false, error: "routing_failed" });
        pending.clear();
    };
    /** Der Worker ist weg (beendet, ersetzt oder geschlossen); `why` sagt, warum der Rechner damit nicht bereit ist. */
    const drop = (why: RoutingFailureReason): WorkerLike | undefined => {
        const dropped = worker;
        worker = undefined;
        warmingId = undefined;
        failAll();
        enter("failed", why);
        return dropped;
    };
    const replace = (): void => {
        void drop("worker_stuck")?.terminate();
    };

    const ensureWorker = (): WorkerLike => {
        if (worker) return worker;
        const created = spawn();
        created.on("message", (reply) => {
            // Ein neuer Stand ist aktiv (WI-0125): `routing_reload` beobachtet ihn über `/health/routing`.
            if ("loaded" in reply) {
                loadedRevision = reply.loaded.revision;
                options.onLoaded?.(reply.loaded.revision);
                return;
            }
            const entry = pending.get(reply.id);
            if (!entry) return;
            pending.delete(reply.id);
            if ("hoehen" in reply) {
                if (entry.timer !== undefined) clearTimeout(entry.timer);
                if (!entry.settled) {
                    entry.settled = true;
                    entry.hoehen?.(reply.hoehen);
                }
                return;
            }
            if (reply.id === warmingId) {
                // Fertig vorgewärmt, auch wenn es scheiterte: Ab jetzt läuft die Uhr der wartenden Routen.
                warmingId = undefined;
                // Aber nicht gleich zu behandeln: Erfolg macht den Rechner bereit, Scheitern bleibt sichtbar.
                if ("warmed" in reply) enter("ready");
                else enter("failed", "warm_failed");
                for (const waiting of pending.values()) {
                    if (waiting.timed && !waiting.settled) startTimer(waiting, timeoutMs);
                }
            } else if ("outcome" in reply && state === "failed" && reason === "warm_failed") {
                // Der Worker lebt und hat eine Route berechnet, also ist sein Netz inzwischen geladen: Das Vorwärmen
                // scheiterte (etwa weil die Datenbank gerade fehlte), der Rechner ist es nicht mehr.
                enter("ready");
            }
            if ("outcome" in reply) settle(entry, reply.outcome);
            else if ("failure" in reply) {
                options.onError?.(new Error(reply.failure));
                settle(entry, { ok: false, error: "routing_failed" });
            } else {
                // Vorladen hat kein Ergebnis, auf das jemand wartet.
                entry.settled = true;
            }
        });
        created.on("error", (error) => options.onError?.(error));
        created.on("exit", () => {
            if (worker === created) drop("worker_exited");
        });
        worker = created;
        enter("warming");
        // Das Vorwärmen geht als erste Nachricht an jeden neuen Worker; niemand wartet auf sein Ergebnis.
        warmingId = nextId;
        nextId += 1;
        pending.set(warmingId, {
            settle: () => undefined,
            sentAt: now(),
            client: undefined,
            settled: false,
            timed: false,
            timer: undefined,
        });
        created.postMessage({ kind: "warm", id: warmingId });
        return created;
    };

    /** Hängt der Worker - die älteste offene Anfrage wartet länger als `stuckMs` -, wird er ersetzt. */
    const replaceIfStuck = (): void => {
        if (pending.size === 0) return;
        const oldest = Math.min(...[...pending.values()].map((entry) => entry.sentAt));
        if (now() - oldest > stuckMs) replace();
    };

    const pendingOf = (client: string): number => {
        let count = 0;
        for (const entry of pending.values()) if (entry.client === client) count += 1;
        return count;
    };

    const sendRoute = (query: Omit<RouteQuery, "client">, client: string | undefined): Promise<RunOutcome> =>
        new Promise((resolve) => {
            const target = ensureWorker();
            const id = nextId;
            nextId += 1;
            const entry: Pending = {
                settle: resolve,
                sentAt: now(),
                client,
                settled: false,
                timed: true,
                timer: undefined,
            };
            startTimer(entry, warmingId === undefined ? timeoutMs : stuckMs);
            pending.set(id, entry);
            target.postMessage({ kind: "route", query, id });
        });

    return {
        run(query) {
            replaceIfStuck();
            if (pending.size >= maxPending) return Promise.resolve({ ok: false, error: "routing_busy" });
            const { client, ...rest } = query;
            if (client !== undefined && pendingOf(client) >= maxPendingPerClient) {
                return Promise.resolve({ ok: false, error: "routing_busy" });
            }
            // Die Client-IP bleibt in der Steuerung; der Worker braucht sie nicht.
            return sendRoute(rest, client);
        },
        warm() {
            ensureWorker();
        },
        hoehen(linien, client) {
            replaceIfStuck();
            // Profile sind nur Anzeige: Sie lassen den Routen immer Plätze frei und stehen je Client höchstens einmal an.
            if (pending.size >= maxPending - HOEHEN_FREI_FUER_ROUTEN) return Promise.resolve(null);
            if (client !== undefined && pendingOf(client) >= 1) return Promise.resolve(null);
            return new Promise((resolve) => {
                const target = ensureWorker();
                const id = nextId;
                nextId += 1;
                const entry: Pending = {
                    // Scheitern und Zeitgrenze: keine Höhen, nie eine erfundene.
                    settle: () => resolve(null),
                    hoehen: resolve,
                    sentAt: now(),
                    client,
                    settled: false,
                    timed: true,
                    timer: undefined,
                };
                startTimer(entry, warmingId === undefined ? timeoutMs : stuckMs);
                pending.set(id, entry);
                target.postMessage({ kind: "hoehen", linien, id });
            });
        },
        status() {
            return {
                state,
                ...(reason !== undefined ? { reason } : {}),
                ageMs: Math.max(0, Math.round(now() - stateSince)),
                ...(loadedRevision !== undefined ? { revision: loadedRevision } : {}),
            };
        },
        async speicher() {
            const current = worker;
            if (current?.getHeapStatistics === undefined) return null;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const stats = await Promise.race([
                    current.getHeapStatistics(),
                    new Promise<null>((resolve) => {
                        timer = setTimeout(() => resolve(null), SPEICHER_TIMEOUT_MS);
                    }),
                ]);
                if (stats === null) return null;
                return { heap: stats.total_heap_size, graph: stats.external_memory ?? null };
            } catch {
                // Der Worker endete gerade: dann gibt es nichts zu messen.
                return null;
            } finally {
                clearTimeout(timer);
            }
        },
        async close() {
            const closed = drop("worker_exited");
            // Geschlossen ist nicht gescheitert: Ein Server, der schließt, hat keinen Worker, mehr nicht.
            enter("cold");
            await closed?.terminate();
        },
    };
}

/** Ohne Worker, im selben Thread - nur für Tests und Werkzeuge, nie im Server. */
export function createInlineRunner(service: RouteService): RouteRunner {
    return {
        run: (query) => service.route(query),
        hoehen: (linien) => service.hoehenEntlang(linien),
        warm() {},
        // Es gibt nichts vorzuwärmen: Der Dienst lädt beim ersten Aufruf selbst.
        status: () => ({ state: "ready", ageMs: 0 }),
        async close() {},
    };
}
