import { randomUUID } from "node:crypto";
import { resolveJobsConfig, type JobsConfig, type JobsProfile } from "@avesmaps3d/shared";
import type { ChildSpawner, JobChild } from "../../src/jobs/child-process.ts";
import type { ChildMessage, ParentMessage } from "../../src/jobs/child-protocol.ts";
import type { MemoryProbe, MemoryReading } from "../../src/jobs/memory.ts";

/** Ein gesteuerter Job-Prozess für die Tests des Workers: Nachrichten und Tod zu einem Zeitpunkt, den der Test bestimmt. */
export class FakeChild implements JobChild {
    readonly pid = undefined;
    readonly sent: ParentMessage[] = [];
    readonly killed: (NodeJS.Signals | undefined)[] = [];
    private readonly messageListeners: ((message: ChildMessage) => void)[] = [];
    private readonly exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
    private exited = false;

    send(message: ParentMessage): void {
        this.sent.push(message);
    }
    onMessage(listener: (message: ChildMessage) => void): void {
        this.messageListeners.push(listener);
    }
    onExit(listener: (code: number | null, signal: string | null) => void): void {
        this.exitListeners.push(listener);
    }
    kill(signal?: NodeJS.Signals): void {
        this.killed.push(signal);
        this.die(null, signal ?? "SIGTERM");
    }

    /** Der Job-Prozess meldet etwas. */
    emit(message: ChildMessage): void {
        for (const listener of this.messageListeners) listener(message);
    }
    /** Der Job-Prozess endet (ohne Abschlussmeldung: ein Absturz). */
    die(code: number | null = 1, signal: string | null = null): void {
        if (this.exited) return;
        this.exited = true;
        for (const listener of this.exitListeners) listener(code, signal);
    }
    /** Was dem Job-Prozess zu tun gegeben wurde. */
    get run(): Extract<ParentMessage, { type: "run" }> | undefined {
        return this.sent.find((message): message is Extract<ParentMessage, { type: "run" }> => message.type === "run");
    }
    /** Hat der Aufseher dem Prozess diese Nachricht geschickt? */
    received(type: ParentMessage["type"]): boolean {
        return this.sent.some((message) => message.type === type);
    }
}

export function fakeSpawner(): { spawn: ChildSpawner; children: FakeChild[] } {
    const children: FakeChild[] = [];
    return {
        children,
        spawn: () => {
            const child = new FakeChild();
            children.push(child);
            return child;
        },
    };
}

/** Eine Messung des Rechners, die der Test verändert. */
export function fakeMemory(initial: Partial<MemoryReading> = {}): {
    probe: MemoryProbe;
    set: (next: Partial<MemoryReading>) => void;
} {
    let current: MemoryReading = { availableMb: 8000, totalMb: 16_000, swapUsedMb: 0, swapInMb: 0, ...initial };
    return {
        probe: () => current,
        set: (next) => {
            current = { ...current, ...next };
        },
    };
}

/** Ein Profil für Tests: schnelle Takte, großzügige Grenzen; jeder Test überschreibt, was er braucht. */
export function testJobsConfig(overrides: Partial<JobsProfile["values"]> = {}): JobsConfig {
    const profile: JobsProfile = {
        schemaVersion: 1,
        profile: "test",
        values: {
            heartbeatS: { value: 0.05 },
            leaseS: { value: { default: 5 } },
            recordedLeaseS: { value: { default: 900 } },
            maxConcurrent: { value: { probe: 2, import: 1 } },
            cpuBudgetThreads: { value: 8 },
            threads: { value: { probe: 1 } },
            memExpectedMb: { value: { probe_base: 40, import: 300 } },
            memTotalBudgetMb: { value: 2000 },
            memAvailFloorMb: { value: 500 },
            rolloutMaxJobMb: { value: 100 },
            swapNoiseMb: { value: 16 },
            historyMinRuns: { value: 3 },
            drainMaxS: { value: 0.1 },
            tickS: { value: 0.05 },
            ...overrides,
        },
    };
    return resolveJobsConfig(profile, "test");
}

/** Ein eigener Schlüssel je Test: Advisory Locks gelten je Datenbank, die Tests teilen sie mit anderen Sitzungen. */
export function uniqueScope(prefix = "jobs-test"): string {
    return `${prefix}-${randomUUID()}`;
}

export async function waitFor<T>(
    read: () => Promise<T | undefined | null | false> | T | undefined | null | false,
    timeoutMs = 10_000,
    what = "Bedingung",
): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await read();
        if (value !== undefined && value !== null && value !== false) return value;
        if (Date.now() - started > timeoutMs) throw new Error(`Zeit abgelaufen: ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
