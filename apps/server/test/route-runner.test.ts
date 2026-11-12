import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerRunner, type WorkerLike, type WorkerReply, type WorkerRequest } from "../src/routing/runner.ts";
import type { RouteQuery } from "../src/routing/service.ts";

/**
 * Die Steuerung der Route (WI-0017 R6) gegen einen Worker-Double: Claudios Budget - eine Rechnung
 * zur Zeit, begrenzte Warteschlange, Antwort nach spätestens 2 s, ein hängender Worker wird ersetzt.
 * Jeder neue Worker wärmt sich zuerst vor; das Double ist damit sofort fertig, außer mit `slowWarm`.
 */

class FakeWorker extends EventEmitter implements WorkerLike {
    readonly sent: WorkerRequest[] = [];
    terminated = false;
    private readonly slowWarm: boolean;

    constructor(slowWarm: boolean) {
        super();
        this.slowWarm = slowWarm;
    }

    /** Nur die Routen, ohne das Vorwärmen. */
    get routes(): WorkerRequest[] {
        return this.sent.filter((message) => message.kind === "route");
    }

    postMessage(message: WorkerRequest): void {
        this.sent.push(message);
        if (message.kind === "warm" && !this.slowWarm) this.reply({ id: message.id, warmed: true });
    }

    async terminate(): Promise<number> {
        this.terminated = true;
        this.emit("exit", 1);
        return 1;
    }

    reply(message: WorkerReply): void {
        this.emit("message", message);
    }
}

const query: RouteQuery = {
    waypoints: ["a", "b"],
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
const antwort = { ok: false as const, error: "unknown_waypoint" as const, detail: "a" };

function setup(options: Parameters<typeof createWorkerRunner>[0] = {}, slowWarm = false) {
    const workers: FakeWorker[] = [];
    const runner = createWorkerRunner({
        createWorker: () => {
            const worker = new FakeWorker(slowWarm);
            workers.push(worker);
            return worker;
        },
        ...options,
    });
    return { runner, workers };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("Steuerung der Route", () => {
    it("reicht die Anfrage an den Worker und seine Antwort zurück", async () => {
        const { runner, workers } = setup();
        const offen = runner.run(query);
        const worker = workers[0] as FakeWorker;
        expect(worker.routes[0]).toMatchObject({ kind: "route", query });
        worker.reply({ id: (worker.routes[0] as WorkerRequest).id, outcome: antwort });
        expect(await offen).toEqual(antwort);
    });

    it("meldet jeden neuen Stand des Workers an onLoaded (WI-0298: der Server schreibt dann seinen eigenen Speicher dazu)", () => {
        const geladen: string[] = [];
        const { runner, workers } = setup({ onLoaded: (revision) => geladen.push(revision) });
        void runner.run(query);
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: 0, loaded: { revision: "aaaaaaaaaaaa" } });
        worker.reply({ id: 0, loaded: { revision: "bbbbbbbbbbbb" } });
        expect(geladen).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
        expect(runner.status().revision).toBe("bbbbbbbbbbbb");
    });

    it("🔴 antwortet nach timeoutMs mit routing_timeout, und die späte Antwort geht ins Leere", async () => {
        vi.useFakeTimers();
        const { runner, workers } = setup({ timeoutMs: 2000 });
        const offen = runner.run(query);
        vi.advanceTimersByTime(2000);
        expect(await offen).toEqual({ ok: false, error: "routing_timeout" });
        const worker = workers[0] as FakeWorker;
        expect(() => worker.reply({ id: (worker.routes[0] as WorkerRequest).id, outcome: antwort })).not.toThrow();
    });

    it("🔴 mehr als maxPending offene Anfragen: routing_busy - auch abgelaufene zählen, bis der Worker antwortet", async () => {
        vi.useFakeTimers();
        const { runner, workers } = setup({ maxPending: 2, timeoutMs: 100 });
        void runner.run(query);
        void runner.run(query);
        vi.advanceTimersByTime(100);
        expect(await runner.run(query)).toEqual({ ok: false, error: "routing_busy" });
        const worker = workers[0] as FakeWorker;
        for (const message of worker.sent) worker.reply({ id: message.id, outcome: antwort });
        const wieder = runner.run(query);
        worker.reply({ id: (worker.routes[2] as WorkerRequest).id, outcome: antwort });
        expect(await wieder).toEqual(antwort);
    });

    it("ein Fehler im Worker wird routing_failed und gemeldet", async () => {
        const fehler: unknown[] = [];
        const { runner, workers } = setup({ onError: (error) => fehler.push(error) });
        const offen = runner.run(query);
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: (worker.routes[0] as WorkerRequest).id, failure: "Error: kaputt" });
        expect(await offen).toEqual({ ok: false, error: "routing_failed" });
        expect(fehler).toHaveLength(1);
    });

    it("🪤 ein beendeter Worker lässt keine Anfrage hängen, und der nächste Aufruf startet einen neuen", async () => {
        const { runner, workers } = setup();
        const offen = runner.run(query);
        (workers[0] as FakeWorker).emit("exit", 1);
        expect(await offen).toEqual({ ok: false, error: "routing_failed" });
        void runner.run(query);
        expect(workers).toHaveLength(2);
    });

    it("🔴 ein Worker, der stuckMs lang nicht antwortet, wird ersetzt", async () => {
        let jetzt = 0;
        const { runner, workers } = setup({ stuckMs: 30_000, timeoutMs: 1_000_000, now: () => jetzt });
        const erste = runner.run(query);
        jetzt = 30_001;
        void runner.run(query);
        expect(await erste).toEqual({ ok: false, error: "routing_failed" });
        expect((workers[0] as FakeWorker).terminated).toBe(true);
        expect(workers).toHaveLength(2);
    });

    it("🔴 S-03: auch bei voller Schlange wird ein hängender Worker ersetzt, statt ewig routing_busy zu sagen", async () => {
        let jetzt = 0;
        const { runner, workers } = setup({ maxPending: 8, stuckMs: 30_000, timeoutMs: 2000, now: () => jetzt });
        const offen = Array.from({ length: 8 }, () => runner.run(query));
        expect(await runner.run(query)).toEqual({ ok: false, error: "routing_busy" });
        // Der Worker antwortet nie. Nach stuckMs erreicht die nächste Anfrage ihn trotz voller Schlange.
        jetzt = 30_001;
        const danach = runner.run(query);
        for (const entry of offen) expect(await entry).toEqual({ ok: false, error: "routing_failed" });
        expect((workers[0] as FakeWorker).terminated).toBe(true);
        const neu = workers[1] as FakeWorker;
        neu.reply({ id: (neu.routes[0] as WorkerRequest).id, outcome: antwort });
        expect(await danach).toEqual(antwort);
    });

    it("🔴 S-04: höchstens maxPendingPerClient offene Rechnungen je Client - die anderen kommen durch", async () => {
        const { runner, workers } = setup({ maxPending: 8, maxPendingPerClient: 2 });
        void runner.run({ ...query, client: "10.0.0.1" });
        void runner.run({ ...query, client: "10.0.0.1" });
        expect(await runner.run({ ...query, client: "10.0.0.1" })).toEqual({ ok: false, error: "routing_busy" });
        const andere = runner.run({ ...query, client: "10.0.0.2" });
        const worker = workers[0] as FakeWorker;
        // Die Client-IP bleibt in der Steuerung; der Worker bekommt nur die Anfrage.
        expect(worker.routes).toHaveLength(3);
        expect(worker.routes.every((message) => message.kind === "route" && !("client" in message.query))).toBe(true);
        worker.reply({ id: (worker.routes[2] as WorkerRequest).id, outcome: antwort });
        expect(await andere).toEqual(antwort);
        // Hat der Worker eine Rechnung des ersten Clients fertig, darf er wieder.
        worker.reply({ id: (worker.routes[0] as WorkerRequest).id, outcome: antwort });
        void runner.run({ ...query, client: "10.0.0.1" });
        expect(worker.routes).toHaveLength(4);
    });

    it("🔴 Stufe 2a: jeder neue Worker wärmt sich zuerst vor - beim Start wie nach einem Ersatz", async () => {
        const { runner, workers } = setup();
        runner.warm();
        runner.warm();
        expect(workers).toHaveLength(1);
        expect((workers[0] as FakeWorker).sent.map((message) => message.kind)).toEqual(["warm"]);
        void runner.run(query);
        (workers[0] as FakeWorker).emit("exit", 1);
        void runner.run(query);
        expect((workers[1] as FakeWorker).sent.map((message) => message.kind)).toEqual(["warm", "route"]);
    });

    it("🔴 Stufe 2a: solange der Worker vorwärmt, läuft die Uhr einer Anfrage nicht - danach ihre timeoutMs", async () => {
        vi.useFakeTimers();
        const { runner, workers } = setup({ timeoutMs: 2000, stuckMs: 30_000 }, true);
        runner.warm();
        let erste: unknown;
        void runner.run(query).then((outcome) => (erste = outcome));
        // Stage: das Vorwärmen dauert 2,1 s. Vorher bekam diese Anfrage nach 2 s routing_timeout.
        await vi.advanceTimersByTimeAsync(5000);
        expect(erste).toBeUndefined();
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: (worker.sent[0] as WorkerRequest).id, warmed: true });
        await vi.advanceTimersByTimeAsync(1999);
        expect(erste).toBeUndefined();
        worker.reply({ id: (worker.routes[0] as WorkerRequest).id, outcome: antwort });
        await vi.advanceTimersByTimeAsync(0);
        expect(erste).toEqual(antwort);
        // Nach dem Vorwärmen gilt die Grenze wieder ab dem Senden.
        const zweite = runner.run(query);
        await vi.advanceTimersByTimeAsync(2000);
        expect(await zweite).toEqual({ ok: false, error: "routing_timeout" });
    });

    it("🔴 Stufe 2a: scheitert das Vorwärmen, läuft die Uhr ab da", async () => {
        vi.useFakeTimers();
        const { runner, workers } = setup({ timeoutMs: 2000, onError: () => undefined }, true);
        const offen = runner.run(query);
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: (worker.sent[0] as WorkerRequest).id, failure: "Error: keine Datenbank" });
        await vi.advanceTimersByTimeAsync(2000);
        expect(await offen).toEqual({ ok: false, error: "routing_timeout" });
    });

    it("🪤 Stufe 2a: hängt das Vorwärmen, endet die Anfrage spätestens nach stuckMs", async () => {
        vi.useFakeTimers();
        const { runner } = setup({ timeoutMs: 2000, stuckMs: 30_000 }, true);
        let offen: unknown;
        void runner.run(query).then((outcome) => (offen = outcome));
        await vi.advanceTimersByTimeAsync(29_999);
        expect(offen).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(offen).toEqual({ ok: false, error: "routing_timeout" });
    });

    it("close() beendet den Worker und alle offenen Anfragen", async () => {
        const { runner, workers } = setup();
        const offen = runner.run(query);
        await runner.close();
        expect(await offen).toEqual({ ok: false, error: "routing_failed" });
        expect((workers[0] as FakeWorker).terminated).toBe(true);
    });
});

describe("Zustand des Routenrechners (WI-0075 R5a, GET /health/routing)", () => {
    /** Mit eigener Uhr, damit `ageMs` etwas misst. */
    function clocked(slowWarm = true) {
        const clock = { now: 1000 };
        const made = setup({ now: () => clock.now, onError: () => undefined }, slowWarm);
        return { ...made, clock };
    }
    const warmId = (worker: FakeWorker): number => (worker.sent[0] as WorkerRequest).id;

    it("cold, warming, ready: die Folge eines erfolgreichen Starts, mit der Dauer des Zustands", () => {
        const { runner, workers, clock } = clocked();
        expect(runner.status()).toEqual({ state: "cold", ageMs: 0 });
        runner.warm();
        clock.now += 1500;
        expect(runner.status()).toEqual({ state: "warming", ageMs: 1500 });
        (workers[0] as FakeWorker).reply({ id: warmId(workers[0] as FakeWorker), warmed: true });
        clock.now += 40;
        expect(runner.status()).toEqual({ state: "ready", ageMs: 40 });
    });

    it("🔴 gescheitertes Vorwärmen ist failed/warm_failed, nicht ready: Scheitern und Erfolg sind unterscheidbar", () => {
        const { runner, workers } = clocked();
        runner.warm();
        (workers[0] as FakeWorker).reply({ id: warmId(workers[0] as FakeWorker), failure: "Error: keine Daten" });
        expect(runner.status()).toEqual({ state: "failed", reason: "warm_failed", ageMs: 0 });
        // Die Meldung des Fehlers steht nicht im Zustand (sie kann Verbindungsdaten tragen).
        expect(JSON.stringify(runner.status())).not.toContain("keine Daten");
    });

    it("die Meldung eines gescheiterten Vorwärmens geht an onError, nicht in den Zustand", () => {
        const fehler: unknown[] = [];
        const { runner, workers } = setup({ onError: (error) => fehler.push(error) }, true);
        runner.warm();
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: warmId(worker), failure: "Error: kaputt" });
        expect(fehler).toHaveLength(1);
        expect(runner.status().state).toBe("failed");
    });

    it("ein gescheitertes Vorwärmen heilt die erste Route, die der Worker danach berechnet", async () => {
        const { runner, workers } = clocked();
        const offen = runner.run(query);
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: warmId(worker), failure: "Error: Datenbank fehlte" });
        expect(runner.status().state).toBe("failed");
        // Der Worker lädt das Netz selbst nach; eine Route, die er berechnet, belegt es.
        worker.reply({ id: (worker.routes[0] as WorkerRequest).id, outcome: antwort });
        expect(await offen).toEqual(antwort);
        expect(runner.status()).toEqual({ state: "ready", ageMs: 0 });
    });

    it("eine fehlgeschlagene Route macht einen bereiten Rechner nicht unbereit, einen gescheiterten nicht bereit", async () => {
        const { runner, workers } = clocked();
        const erste = runner.run(query);
        const worker = workers[0] as FakeWorker;
        worker.reply({ id: warmId(worker), warmed: true });
        worker.reply({ id: (worker.routes[0] as WorkerRequest).id, failure: "Error: eine Route" });
        expect(await erste).toEqual({ ok: false, error: "routing_failed" });
        expect(runner.status().state).toBe("ready");

        const zweiter = clocked();
        const offen = zweiter.runner.run(query);
        const andere = zweiter.workers[0] as FakeWorker;
        andere.reply({ id: warmId(andere), failure: "Error: kein Netz" });
        andere.reply({ id: (andere.routes[0] as WorkerRequest).id, failure: "Error: kein Netz" });
        expect(await offen).toEqual({ ok: false, error: "routing_failed" });
        expect(zweiter.runner.status().state).toBe("failed");
    });

    it("🔴 ein beendeter Worker ist failed/worker_exited; der nächste Aufruf startet einen neuen (warming, dann ready)", () => {
        const { runner, workers, clock } = clocked(false);
        runner.warm();
        expect(runner.status().state).toBe("ready");
        clock.now += 10;
        (workers[0] as FakeWorker).emit("exit", 1);
        expect(runner.status()).toEqual({ state: "failed", reason: "worker_exited", ageMs: 0 });
        void runner.run(query);
        expect(workers).toHaveLength(2);
        // Das Double wärmt sofort: Der neue Worker ist gleich wieder bereit.
        expect(runner.status().state).toBe("ready");
    });

    it("ein Worker, der beim Vorwärmen stirbt, ist failed/worker_exited", () => {
        const { runner, workers } = clocked();
        runner.warm();
        expect(runner.status().state).toBe("warming");
        (workers[0] as FakeWorker).emit("exit", 1);
        expect(runner.status()).toEqual({ state: "failed", reason: "worker_exited", ageMs: 0 });
    });

    it("ein hängender, ersetzter Worker beginnt neu mit warming", () => {
        const clock = { now: 0 };
        const { runner, workers } = setup({ now: () => clock.now, stuckMs: 30_000, timeoutMs: 1_000_000 }, true);
        void runner.run(query);
        clock.now = 30_001;
        void runner.run(query);
        expect(workers).toHaveLength(2);
        expect((workers[0] as FakeWorker).terminated).toBe(true);
        expect(runner.status()).toEqual({ state: "warming", ageMs: 0 });
    });

    it("close() lässt den Rechner cold zurück, nicht failed", async () => {
        const { runner } = clocked(false);
        runner.warm();
        expect(runner.status().state).toBe("ready");
        await runner.close();
        expect(runner.status().state).toBe("cold");
        expect(runner.status().reason).toBeUndefined();
    });
});

describe("Speicher des Worker-Threads (WI-0127 §22)", () => {
    class MessbarerWorker extends FakeWorker {
        stats: () => Promise<{ total_heap_size: number; external_memory?: number }> = async () => ({
            total_heap_size: 64,
            external_memory: 180,
        });
        getHeapStatistics(): Promise<{ total_heap_size: number; external_memory?: number }> {
            return this.stats();
        }
    }

    it("🔴 Heap und Graph des Threads; ohne Worker oder ohne Messung null, nie 0", async () => {
        const ohne = setup();
        expect(await ohne.runner.speicher?.()).toBeNull();
        ohne.runner.warm();
        // Das Double ohne `getHeapStatistics` misst nichts.
        expect(await ohne.runner.speicher?.()).toBeNull();

        let worker: MessbarerWorker | undefined;
        const runner = createWorkerRunner({
            createWorker: () => {
                worker = new MessbarerWorker(false);
                return worker;
            },
        });
        expect(await runner.speicher?.()).toBeNull();
        runner.warm();
        expect(await runner.speicher?.()).toEqual({ heap: 64, graph: 180 });
        worker!.stats = async () => ({ total_heap_size: 70 });
        expect(await runner.speicher?.()).toEqual({ heap: 70, graph: null });
        worker!.stats = () => Promise.reject(new Error("Worker instance not running"));
        expect(await runner.speicher?.()).toBeNull();
    });

    it("🔴 ein Thread, der nicht antwortet, hält den Systemzustand höchstens 1 s auf", async () => {
        vi.useFakeTimers();
        let worker: MessbarerWorker | undefined;
        const runner = createWorkerRunner({
            createWorker: () => {
                worker = new MessbarerWorker(false);
                return worker;
            },
        });
        runner.warm();
        worker!.stats = () => new Promise(() => undefined);
        const gemessen = runner.speicher!();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await gemessen).toBeNull();
    });
});

describe("Höhen entlang von Linien (WI-0245, Profile im Reiter „Gebirge“)", () => {
    const linien: [number, number][][] = [
        [
            [0, 0],
            [1, 0],
        ],
    ];

    it("🔴 reicht die Linien an den Worker und seine Höhen zurück", async () => {
        const { runner, workers } = setup();
        const offen = runner.hoehen!(linien);
        const worker = workers[0] as FakeWorker;
        const anfrage = worker.sent.find((message) => message.kind === "hoehen");
        expect(anfrage).toMatchObject({ kind: "hoehen", linien });
        const hoehen = [{ at: [0, 1], height: [100, 90] }];
        worker.reply({ id: (anfrage as WorkerRequest).id, hoehen });
        expect(await offen).toEqual(hoehen);
    });

    it("🔴 nach der Zeitgrenze oder bei einem Fehler keine Höhen, nie eine erfundene", async () => {
        vi.useFakeTimers();
        const { runner, workers } = setup({ timeoutMs: 2000 });
        const langsam = runner.hoehen!(linien);
        await vi.advanceTimersByTimeAsync(2000);
        expect(await langsam).toBeNull();
        const scheitert = runner.hoehen!(linien);
        const worker = workers[0] as FakeWorker;
        const anfrage = worker.sent.filter((message) => message.kind === "hoehen").at(-1) as WorkerRequest;
        worker.reply({ id: anfrage.id, failure: "kaputt" });
        expect(await scheitert).toBeNull();
    });
});

describe("Höhen und Routen teilen die Warteschlange (WI-0245)", () => {
    const linie: [number, number][][] = [
        [
            [0, 0],
            [1, 0],
        ],
    ];

    it("🔴 Profile stehen je Client höchstens einmal an und lassen den Routen Plätze frei", async () => {
        const { runner, workers } = setup({ maxPending: 4 });
        const erste = runner.hoehen!(linie, "1.2.3.4");
        expect(await runner.hoehen!(linie, "1.2.3.4")).toBeNull();
        const zweite = runner.hoehen!(linie, "5.6.7.8");
        // Zwei Profile offen, zwei Plätze für Routen: ein drittes Profil wartet nicht.
        expect(await runner.hoehen!(linie, "9.9.9.9")).toBeNull();
        void runner.run(query);
        // Die Route geht trotzdem an den Worker.
        expect((workers[0] as FakeWorker).routes).toHaveLength(1);
        void erste;
        void zweite;
    });
});
