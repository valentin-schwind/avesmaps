import type { EstimateBasis, JobsConfig } from "@avesmaps3d/shared";
import {
    compareCandidates,
    decideAdmission,
    type AdmissionCandidate,
    type AdmissionResult,
    type AdmissionRunning,
} from "./admission.ts";
import { GEBIETS_TEILLAUF_DAUER, TERRITORY_DERIVE_JOB_KIND } from "./gebiets-arten.ts";
import { JOB_KIND_CATALOG } from "./kinds.ts";

/**
 * Die geschätzte Wartezeit (JOBS-0001 5.3).
 *
 * Der Start eines wartenden Jobs ist die Fertigzeit des spätesten Blockierers: eines Vorgängers, eines überlappenden Jobs, eines
 * Platzes im Budget. Die Dauer eines Jobs ist p50 bis p95 der letzten Läufe DERSELBEN Jobart in derselben Umgebung, ein
 * laufender Job zählt ab seinem Start. Solange weniger als `historyMinRuns` Läufe vorliegen, steht der Startwert aus dem Profil
 * (MS10) oder „unbekannt“, 🔴 NIE EINE GERATENE ZAHL. Unbekannt steckt an: Hängt ein Start an einem Job ohne bekannte Dauer,
 * ist auch er unbekannt.
 *
 * Die Angabe ist eine Anzeige, kein Versprechen. Gerechnet wird mit derselben Zulassung wie beim echten Start
 * (`decideAdmission`), in der Zukunft ohne `MemAvailable`: den kennt nur die Gegenwart.
 */

/** Statistik der letzten erfolgreichen Läufe einer Jobart. */
export interface DurationStat {
    n: number;
    p50S: number;
    p95S: number;
}

/** Perzentil mit linearer Interpolation (wie `percentile_cont`) über bereits sortierte Werte. */
export function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return Number.NaN;
    if (sorted.length === 1) return sorted[0] ?? Number.NaN;
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const low = sorted[lower] ?? 0;
    const high = sorted[upper] ?? low;
    return low + (high - low) * (position - lower);
}

/** p50 und p95 aus Walltimes in Millisekunden. */
export function durationStat(wallMs: readonly number[]): DurationStat | null {
    if (wallMs.length === 0) return null;
    const sorted = [...wallMs].sort((a, b) => a - b);
    return { n: sorted.length, p50S: percentile(sorted, 0.5) / 1000, p95S: percentile(sorted, 0.95) / 1000 };
}

export interface DurationEstimate {
    p50S: number | null;
    p95S: number | null;
    basis: EstimateBasis;
}

/** Der Schlüssel der Dauer im Profil: der Speicherschlüssel der Art, sonst ihr Name. */
export function durationKey(kind: string, input: Record<string, unknown>): string {
    return JOB_KIND_CATALOG[kind]?.memoryKey(input, null) ?? kind;
}

/**
 * Die Herrschaftsgebiete (WI-0283): Ob ein Lauf teilweise oder voll rechnet, entscheidet er erst selbst. Meist ist es der Teillauf, darum sein Wert als erwartete
 * Dauer, bis genug Läufe da sind sein Startwert; der volle Lauf (einmal am Tag, nach breiten Änderungen) ist die obere Grenze. Ein laufender Voll-Lauf zeigt so nach
 * dem Teil-Wert die Dauer eines vollen, statt ohne Vorhersage dazustehen. `null`: Das Profil kennt den Teillauf nicht.
 */
function gebietsDauer(config: JobsConfig, history: Readonly<Record<string, DurationStat>>): DurationEstimate | null {
    const teil = history[GEBIETS_TEILLAUF_DAUER];
    const genug = teil !== undefined && teil.n >= config.historyMinRuns;
    const p50S = genug ? teil.p50S : config.expectedDurationS[GEBIETS_TEILLAUF_DAUER];
    if (p50S === undefined) return null;
    const vollS =
        history[TERRITORY_DERIVE_JOB_KIND]?.p50S ?? config.expectedDurationS[TERRITORY_DERIVE_JOB_KIND] ?? p50S;
    return { p50S, p95S: Math.max(genug ? teil.p95S : p50S, vollS), basis: genug ? "history" : "startwert" };
}

/** Wie lange läuft ein Job der Art `kind`: aus den letzten Läufen, sonst dem Startwert des Profils, sonst unbekannt. */
export function estimateDuration(
    kind: string,
    input: Record<string, unknown>,
    config: JobsConfig,
    history: Readonly<Record<string, DurationStat>>,
): DurationEstimate {
    const gebiete = kind === TERRITORY_DERIVE_JOB_KIND ? gebietsDauer(config, history) : null;
    if (gebiete !== null) return gebiete;
    const stat = history[kind];
    if (stat && stat.n >= config.historyMinRuns) {
        return { p50S: stat.p50S, p95S: stat.p95S, basis: "history" };
    }
    // Eine Art, die ihre Dauer aus der Eingabe kennt (der Release-Test aus seinen früheren Läufen), rät nicht: Das ist ihr Startwert.
    const eigene = JOB_KIND_CATALOG[kind]?.expectedDurationS?.(input) ?? null;
    if (eigene !== null) return { p50S: eigene, p95S: eigene, basis: "startwert" };
    const start = config.expectedDurationS[durationKey(kind, input)];
    if (start !== undefined) return { p50S: start, p95S: start, basis: "startwert" };
    return { p50S: null, p95S: null, basis: "unknown" };
}

export interface RunningForEstimate extends AdmissionRunning {
    startedAtMs: number;
    duration: DurationEstimate;
}

export interface QueuedForEstimate extends AdmissionCandidate {
    /** Öffentliche Nummern der Vorgänger, die noch nicht `SUCCEEDED` sind. */
    pendingDependsOn: readonly number[];
    duration: DurationEstimate;
}

export interface QueueEstimate {
    /** Frühester Start (ms), `null`: unbekannt. */
    startMs: number | null;
    finishMs: number | null;
    duration: DurationEstimate;
}

export interface EstimateInput {
    nowMs: number;
    queued: readonly QueuedForEstimate[];
    running: readonly RunningForEstimate[];
    config: JobsConfig;
    rolloutActive: boolean;
    /** `MemAvailable` jetzt: gilt nur für den ersten Schritt, die Zukunft kennt keinen Messwert. */
    memAvailableMb: number | null;
}

/** Wann ein laufender Job fertig wird (ms), `null`: unbekannt. */
export function runningEndMs(job: RunningForEstimate, nowMs: number): number | null {
    const { p50S, p95S } = job.duration;
    if (p50S === null || p95S === null) return null;
    const elapsedS = (nowMs - job.startedAtMs) / 1000;
    if (elapsedS < p50S) return job.startedAtMs + p50S * 1000;
    if (elapsedS < p95S) return job.startedAtMs + p95S * 1000;
    // Länger als p95: eine Überschreitung, kein Wert, den man vorhersagen kann.
    return null;
}

interface Simulated {
    job: AdmissionRunning;
    id: number;
    endsMs: number | null;
}

export function estimateQueue(input: EstimateInput): Map<number, QueueEstimate> {
    const { config } = input;
    const estimates = new Map<number, QueueEstimate>();
    const simulated: Simulated[] = input.running.map((job) => ({
        job,
        id: job.id,
        endsMs: runningEndMs(job, input.nowMs),
    }));
    let pending = [...input.queued].sort(compareCandidates);
    const finished = new Set<number>();
    const knownIds = new Set([...input.queued.map((job) => job.id), ...input.running.map((job) => job.id)]);
    let t = input.nowMs;

    for (let guard = 0; guard < 4 * (pending.length + simulated.length) + 8 && pending.length > 0; guard += 1) {
        // Was bis jetzt fertig ist, gibt seinen Platz frei und erfüllt die Abhängigkeit seiner Nachfolger.
        for (let index = simulated.length - 1; index >= 0; index -= 1) {
            const entry = simulated[index];
            if (entry && entry.endsMs !== null && entry.endsMs <= t) {
                finished.add(entry.id);
                simulated.splice(index, 1);
            }
        }
        const candidates: AdmissionCandidate[] = pending.map((job) => ({
            ...job,
            // Ein Vorgänger zählt als fertig, wenn er nicht mehr (ungestartet oder laufend) in der Rechnung steht.
            dependenciesDone: job.pendingDependsOn.every(
                (dependency) => finished.has(dependency) || !knownIds.has(dependency),
            ),
        }));
        const decision: AdmissionResult = decideAdmission({
            nowMs: t,
            queued: candidates,
            running: simulated.map((entry) => entry.job),
            config,
            memAvailableMb: t === input.nowMs ? input.memAvailableMb : null,
            rolloutActive: input.rolloutActive && t === input.nowMs,
            ignoreAvailability: t !== input.nowMs || input.memAvailableMb === null,
        });
        for (const job of decision.admitted) {
            const entry = pending.find((candidate) => candidate.id === job.id);
            if (!entry) continue;
            const endsMs = entry.duration.p50S === null ? null : t + entry.duration.p50S * 1000;
            estimates.set(job.id, { startMs: t, finishMs: endsMs, duration: entry.duration });
            simulated.push({ job, id: job.id, endsMs });
        }
        pending = pending.filter((job) => !decision.admitted.some((admitted) => admitted.id === job.id));
        if (pending.length === 0) break;
        // Zum nächsten Ereignis: das Ende eines bekannten Jobs oder das Ende einer Entprellung.
        const next = [...simulated.map((entry) => entry.endsMs), ...pending.map((job) => job.notBeforeMs)].filter(
            (value): value is number => value !== null && value > t,
        );
        if (next.length === 0) break;
        t = Math.min(...next);
    }
    // Wer nicht mehr drankam, hängt an einem Job ohne bekannte Dauer: unbekannt.
    for (const job of pending) {
        estimates.set(job.id, { startMs: null, finishMs: null, duration: job.duration });
    }
    return estimates;
}
