import { describe, expect, it } from "vitest";
import { getJobsConfig, resolveJobsConfig, type JobsProfile } from "@avesmaps3d/shared";
import {
    durationStat,
    estimateDuration,
    estimateQueue,
    percentile,
    runningEndMs,
    type DurationEstimate,
    type QueuedForEstimate,
    type RunningForEstimate,
} from "../src/jobs/estimate.ts";

/**
 * Die geschätzte Wartezeit (JOBS-0001 5.3): Start = Fertigzeit des spätesten Blockierers, Dauer = p50 bis p95 der letzten Läufe
 * derselben Jobart, davor der Startwert des Profils, davor „unbekannt“. 🔴 NIE EINE GERATENE ZAHL.
 */

const NOW = 1_800_000_000_000;

const profile: JobsProfile = {
    schemaVersion: 1,
    profile: "test",
    values: {
        maxConcurrent: { value: { slow: 1, quick: 2, mystery: 1 } },
        cpuBudgetThreads: { value: 4 },
        memTotalBudgetMb: { value: 10_000 },
        memAvailFloorMb: { value: 0 },
        expectedDurationS: { value: { slow: 100, quick: 10 } },
        historyMinRuns: { value: 3 },
    },
};
const config = resolveJobsConfig(profile, "test");

const startwert = (seconds: number): DurationEstimate => ({ p50S: seconds, p95S: seconds, basis: "startwert" });
const unknown: DurationEstimate = { p50S: null, p95S: null, basis: "unknown" };

let nextId = 1;
function queued(kind: string, duration: DurationEstimate, extra: Partial<QueuedForEstimate> = {}): QueuedForEstimate {
    const id = extra.id ?? nextId++;
    return {
        id,
        kind,
        mapDomainId: "d",
        scopeKind: "domain",
        scopeTiles: [],
        priority: 50,
        queuedAtMs: NOW - 1000 + id,
        notBeforeMs: null,
        memExpectedMb: 100,
        threads: 1,
        dependenciesDone: true,
        pendingDependsOn: [],
        duration,
        ...extra,
    };
}

function running(kind: string, startedSecondsAgo: number, duration: DurationEstimate): RunningForEstimate {
    return {
        id: 1000 + nextId++,
        kind,
        mapDomainId: "d",
        scopeKind: "domain",
        scopeTiles: [],
        memExpectedMb: 100,
        threads: 1,
        startedAtMs: NOW - startedSecondsAgo * 1000,
        duration,
    };
}

describe("Dauer: Historie, Startwert, unbekannt", () => {
    it("Perzentile wie percentile_cont (lineare Interpolation)", () => {
        expect(percentile([10], 0.95)).toBe(10);
        expect(percentile([10, 20], 0.5)).toBe(15);
        expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8);
        expect(durationStat([])).toBeNull();
        expect(durationStat([1000, 3000])).toEqual({ n: 2, p50S: 2, p95S: 2.9 });
    });

    it("🔴 ab `minRuns` Läufen zählt die Historie, davor der Startwert, davor unbekannt", () => {
        const history = { slow: { n: 3, p50S: 80, p95S: 120 }, quick: { n: 2, p50S: 5, p95S: 6 } };
        expect(estimateDuration("slow", {}, config, history)).toEqual({ p50S: 80, p95S: 120, basis: "history" });
        // zu wenig Läufe: der Startwert (10), nicht die zwei Läufe
        expect(estimateDuration("quick", {}, config, history)).toEqual({ p50S: 10, p95S: 10, basis: "startwert" });
        // keine Läufe, kein Startwert: unbekannt, keine Zahl
        expect(estimateDuration("mystery", {}, config, {})).toEqual({ p50S: null, p95S: null, basis: "unknown" });
    });

    it("die Probe hat keinen Startwert: ohne Läufe ist ihre Dauer unbekannt, auch auf der Stage", () => {
        const staging = getJobsConfig("staging");
        expect(estimateDuration("probe", { sleepMs: 1000 }, staging, {})).toEqual({
            p50S: null,
            p95S: null,
            basis: "unknown",
        });
        // `import` hat den Startwert 900 s aus dem Register (MS10)
        expect(estimateDuration("import", {}, staging, {})).toEqual({ p50S: 900, p95S: 900, basis: "startwert" });
    });
});

describe("Dauer der Herrschaftsgebiete: Teillauf erwartet, voller Lauf als Grenze (WI-0283)", () => {
    const profil = {
        ...config,
        expectedDurationS: { territory_derive: 60, "territory_derive:teil": 5 },
    };

    it("🔴 genug Teilläufe: ihr Wert gilt, der volle Lauf bleibt die obere Grenze", () => {
        const history = {
            territory_derive: { n: 40, p50S: 42, p95S: 63 },
            "territory_derive:teil": { n: 6, p50S: 3.4, p95S: 4 },
        };
        expect(estimateDuration("territory_derive", {}, profil, history)).toEqual({
            p50S: 3.4,
            p95S: 42,
            basis: "history",
        });
    });

    it("🔴 zu wenige Teilläufe: Startwert statt der alten vollen Läufe", () => {
        const history = {
            territory_derive: { n: 40, p50S: 42, p95S: 63 },
            "territory_derive:teil": { n: 2, p50S: 3, p95S: 3 },
        };
        expect(estimateDuration("territory_derive", {}, profil, history)).toEqual({
            p50S: 5,
            p95S: 42,
            basis: "startwert",
        });
    });

    it("ohne volle Läufe steht der Startwert des vollen Laufs als Grenze", () => {
        expect(estimateDuration("territory_derive", {}, profil, {})).toEqual({ p50S: 5, p95S: 60, basis: "startwert" });
    });

    it("ein Profil ohne Teillauf schätzt wie jede andere Art", () => {
        const history = { territory_derive: { n: 40, p50S: 42, p95S: 63 } };
        expect(estimateDuration("territory_derive", {}, config, history)).toEqual({
            p50S: 42,
            p95S: 63,
            basis: "history",
        });
    });

    it("🔴 ein Voll-Lauf läuft über den Teil-Wert hinaus und behält eine Vorhersage", () => {
        const dauer = { p50S: 3.4, p95S: 42, basis: "history" as const };
        expect(runningEndMs(running("territory_derive", 10, dauer), NOW)).toBe(NOW - 10_000 + 42_000);
    });
});

describe("Wartezeit: Start = Fertigzeit des Blockierers", () => {
    it("ein wartender Job startet, wenn der laufende fertig wird (Startwert 100 s, 30 s gelaufen)", () => {
        const current = running("slow", 30, startwert(100));
        const waiting = queued("slow", startwert(100));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [waiting],
            running: [current],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(waiting.id)).toMatchObject({ startMs: NOW + 70_000, finishMs: NOW + 170_000 });
    });

    it("eine Reihe: jeder startet, wenn der vorige fertig ist", () => {
        const current = running("slow", 0, startwert(100));
        const first = queued("slow", startwert(100));
        const second = queued("slow", startwert(100));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [first, second],
            running: [current],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(first.id)?.startMs).toBe(NOW + 100_000);
        expect(estimate.get(second.id)?.startMs).toBe(NOW + 200_000);
    });

    it("kann ein Job sofort starten, ist der Start jetzt", () => {
        const job = queued("quick", startwert(10));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [job],
            running: [],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(job.id)).toMatchObject({ startMs: NOW, finishMs: NOW + 10_000 });
    });

    it("die Entprellung (`not_before`) verschiebt den Start auf ihr Ende", () => {
        const job = queued("quick", startwert(10), { notBeforeMs: NOW + 30_000 });
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [job],
            running: [],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(job.id)?.startMs).toBe(NOW + 30_000);
    });

    it("ein Nachfolger startet nach seinem Vorgänger, der selbst noch wartet", () => {
        const current = running("slow", 0, startwert(100));
        const predecessor = queued("quick", startwert(10));
        const successor = queued("quick", startwert(10), {
            pendingDependsOn: [predecessor.id],
            dependenciesDone: false,
        });
        // `quick` passt neben `slow` nicht (beide ganze Domäne): erst nach `slow`, dann der Nachfolger nach dem Vorgänger.
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [successor, predecessor],
            running: [current],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(predecessor.id)?.startMs).toBe(NOW + 100_000);
        expect(estimate.get(successor.id)?.startMs).toBe(NOW + 110_000);
    });

    it("🔴 unbekannte Dauer steckt an: wer an einem Job ohne bekannte Dauer hängt, hat keinen bekannten Start", () => {
        const current = running("mystery", 5, unknown);
        const waiting = queued("slow", startwert(100));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [waiting],
            running: [current],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(waiting.id)).toMatchObject({ startMs: null, finishMs: null });
    });

    it("🔴 ein Job mit unbekannter Dauer startet bekannt, sein Ende ist unbekannt, und alles hinter ihm auch", () => {
        const first = queued("mystery", unknown);
        const behind = queued("slow", startwert(100));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [first, behind],
            running: [],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(first.id)).toMatchObject({ startMs: NOW, finishMs: null });
        expect(estimate.get(behind.id)).toMatchObject({ startMs: null, finishMs: null });
    });

    it("ein laufender Job, der länger läuft als p95, hat kein vorhersagbares Ende", () => {
        const overdue = running("slow", 500, { p50S: 80, p95S: 120, basis: "history" });
        const waiting = queued("slow", startwert(100));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [waiting],
            running: [overdue],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(waiting.id)?.startMs).toBeNull();
    });

    it("zwischen p50 und p95 gilt p95 als Ende des laufenden Jobs", () => {
        const slower = running("slow", 90, { p50S: 80, p95S: 120, basis: "history" });
        const waiting = queued("slow", startwert(100));
        const estimate = estimateQueue({
            nowMs: NOW,
            queued: [waiting],
            running: [slower],
            config,
            rolloutActive: false,
            memAvailableMb: null,
        });
        expect(estimate.get(waiting.id)?.startMs).toBe(NOW + 30_000);
    });
});
