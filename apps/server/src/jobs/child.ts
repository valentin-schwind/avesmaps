import { setPriority } from "node:os";
import { writeFileSync } from "node:fs";
import { CommittedResult, JOB_HANDLERS, JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { sanitizeSummary, type ChildMessage, type ParentMessage, type RunSpec } from "./child-protocol.ts";

/**
 * Der Job-Prozess (JOBS-0001 4.1): ein Kindprozess des Aufsehers je Job, gestartet mit `node --expose-gc`. Er rechnet und
 * meldet; in die Datenbank schreibt der Aufseher.
 *
 * - Niedrige Priorität wie im Korridor: `nice` 10 und `oom_score_adj` 500 (der Kernel beendet bei echter Speichernot zuerst
 *   diesen Prozess, nicht Foundry, PostgreSQL oder Fastify). Beides erhöht nur die eigene Verwundbarkeit und braucht kein Recht.
 * - 🔴 Stirbt der Aufseher, schließt sich der Kanal, und der Job-Prozess beendet sich selbst. Sonst läge ein zweites GB neben
 *   dem neu gestarteten Job: auf dem VPS fatal.
 * - Die Spitze RSS misst er selbst (`resourceUsage().maxRSS`); der Aufseher liest zusätzlich `VmHWM` aus `/proc`.
 */

const send = (message: ChildMessage, then?: () => void): void => {
    if (!process.send || !process.connected) {
        then?.();
        return;
    }
    process.send(message, undefined, undefined, () => then?.());
};

function lowerPriority(): void {
    try {
        setPriority(0, 10);
    } catch {
        // Ohne Recht oder auf Plattformen ohne nice: kein Grund zu scheitern.
    }
    if (process.platform === "linux") {
        try {
            writeFileSync("/proc/self/oom_score_adj", "500");
        } catch {
            // Container ohne /proc-Schreibzugriff: dann hält der Rückhalt der Unit (MemoryMax).
        }
    }
}

const mb = (bytes: number): number => Math.ceil(bytes / 1024 / 1024);

function usage(): { rssMb: number; rssPeakMb: number; arrayBufferMb: number; cpuMs: number } {
    const memory = process.memoryUsage();
    const resources = process.resourceUsage();
    return {
        rssMb: mb(memory.rss),
        // `maxRSS` kommt in Kilobyte.
        rssPeakMb: Math.max(mb(memory.rss), Math.ceil(resources.maxRSS / 1024)),
        arrayBufferMb: mb(memory.arrayBuffers),
        cpuMs: Math.round((resources.userCPUTime + resources.systemCPUTime) / 1000),
    };
}

interface State {
    cancel: boolean;
    stop: boolean;
    running: boolean;
}

async function run(job: RunSpec, state: State): Promise<void> {
    const handler = JOB_HANDLERS[job.kind];
    if (!handler) {
        send(
            {
                type: "error",
                code: "unknown_kind",
                summary: `Jobart ${job.kind} ist diesem Prozess unbekannt.`,
                retryable: false,
            },
            () => process.exit(0),
        );
        return;
    }
    const checkpoint = (): void => {
        if (state.stop) throw new JobStopped();
        if (state.cancel) throw new JobCancelled();
    };
    let phaseName: string | null = null;
    let phaseStartedAt = Date.now();
    let phaseCpuStart = usage().cpuMs;
    const context: JobContext = {
        input: job.input,
        attempt: job.attempt,
        job: {
            id: job.id,
            publicId: job.publicId,
            leaseNo: job.leaseNo ?? null,
            mapDomainId: job.mapDomainId ?? null,
        },
        checkpoint,
        beginPhase: async (name, progress = null, options = {}) => {
            checkpoint();
            const now = Date.now();
            const current = usage();
            // Derselbe Name noch einmal ist ein neuer Fortschritt, keine neue Phase: Die Messung der laufenden Phase geht weiter.
            const weiter = phaseName === name;
            send({
                type: "phase",
                phase: name,
                progress,
                finished:
                    phaseName === null || weiter
                        ? null
                        : {
                              name: phaseName,
                              wallMs: now - phaseStartedAt,
                              rssPeakMb: current.rssPeakMb,
                              cpuMs: Math.max(0, current.cpuMs - phaseCpuStart),
                          },
                ...(options.restMs === undefined ? {} : { restMs: options.restMs }),
            });
            if (weiter) return;
            phaseName = name;
            phaseStartedAt = now;
            phaseCpuStart = current.cpuMs;
        },
    };
    // Ein regelmäßiges Lebenszeichen mit der eigenen Messung; der Aufseher heartbeatet unabhängig davon.
    const sampler = setInterval(() => send({ type: "usage", ...usage() }), 1000);
    sampler.unref();
    try {
        const outcome = await handler(context);
        clearInterval(sampler);
        const final = usage();
        const committed = outcome instanceof CommittedResult;
        send(
            {
                type: "done",
                result: committed ? outcome.result : outcome,
                ...(committed ? { committed: true } : {}),
                cpuMs: final.cpuMs,
                rssPeakMb: final.rssPeakMb,
                arrayBufferPeakMb: final.arrayBufferMb,
                finished:
                    phaseName === null
                        ? null
                        : {
                              name: phaseName,
                              wallMs: Date.now() - phaseStartedAt,
                              rssPeakMb: final.rssPeakMb,
                              cpuMs: Math.max(0, final.cpuMs - phaseCpuStart),
                          },
            },
            () => process.exit(0),
        );
    } catch (error) {
        clearInterval(sampler);
        if (error instanceof JobCancelled) {
            send({ type: "cancelled" }, () => process.exit(0));
        } else if (error instanceof JobStopped) {
            send({ type: "stopped" }, () => process.exit(0));
        } else if (error instanceof JobFailure) {
            send(
                {
                    type: "error",
                    code: error.code,
                    summary: sanitizeSummary(error.message),
                    retryable: error.retryable,
                },
                () => process.exit(0),
            );
        } else {
            // Ein Fehler, den der Handler nicht als wiederholbar kennt: ein zweiter Lauf ändert daran nichts.
            send(
                {
                    type: "error",
                    code: "job_error",
                    summary: sanitizeSummary(error instanceof Error ? error.message : String(error)),
                    retryable: false,
                },
                () => process.exit(0),
            );
        }
    }
}

lowerPriority();

const state: State = { cancel: false, stop: false, running: false };

// Stirbt der Aufseher, schließt sich der Kanal: dann endet auch dieser Prozess (Elternwächter).
process.on("disconnect", () => process.exit(3));

process.on("message", (message: ParentMessage) => {
    if (message.type === "cancel") {
        state.cancel = true;
    } else if (message.type === "stop") {
        state.stop = true;
    } else if (message.type === "run" && !state.running) {
        state.running = true;
        void run(message.job, state);
    }
});
