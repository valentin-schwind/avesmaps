import type { JobsConfig, WaitReason } from "@avesmaps3d/shared";

/**
 * Die Zulassung (JOBS-0001 4.5): Wann darf ein wartender Job starten? Reine Funktion, ohne Datenbank und ohne Uhr: alles, was
 * sie braucht, kommt als Eingabe. Dieselbe Funktion rechnet die Wartezeit-Schätzung (`estimate.ts`), damit „wann startet er“ und
 * „darf er jetzt starten“ nie auseinanderlaufen.
 *
 * 🔴 SIE WARTET UND MELDET, SIE BRICHT NIE AB (Betreiber 2026-10-03: „A ich will keine gates, die alles blockieren, es sei denn
 * ich habe sie definiert“; D7a). Eine Zulassung lässt Jobs warten; keiner wird je wegen Speicher beendet. Das ist Planung,
 * keine Prüfung im Sinne von AGENTS.md. Den harten Rückhalt bei echter Speichernot geben die cgroup der Worker-Unit und
 * `choom`, beides in Claudios Korridor.
 *
 * 🔴 UNBEKANNT HEISST ALLEIN. Fehlt für die Jobart einer der Werte (Parallelität, Threads, Speicher, Budget, Boden), läuft sie
 * allein: sie startet nur, wenn nichts anderes läuft, und solange sie läuft, startet nichts anderes. Die Queue rät nie.
 *
 * Die sieben Bedingungen (4.5), in der Reihenfolge, in der der Grund einer Wartezeit gemeldet wird, davor der Halt der Sperren:
 *   0. Kartensperre oder eingeschränkter Betrieb: nur Editor-Jobs (WI-0127 SYS-4)  -> `waits_system_lock`
 *   1. alle Vorgänger fertig                                 -> `waits_dependency`
 *   2. `not_before` erreicht                                 -> `debouncing`
 *   3. Bereichssperre frei                                   -> `waits_area`
 *   4. ein Schwerer zur Zeit (WI-0163), Parallelität, Paare, Threads (MS3, MS4) -> `waits_slot`
 *   5. Marke `rollout`: nur kleine Jobs                      -> `waits_rollout`
 *   6. Speicher: Budget (MS6) und Boden (MS7); leichte Arten nur ihr Boden -> `waits_memory`
 *   7. die geteilte Sperre der Domäne                        -> `waits_domain_lock` (entscheidet der Worker beim Starten)
 * Die siebte (Art und Fassung bekannt) prüft der Worker vorher.
 */

export interface AdmissionCandidate {
    id: number;
    kind: string;
    mapDomainId: string;
    scopeKind: "domain" | "tiles";
    scopeTiles: readonly number[];
    priority: number;
    /** Zeitpunkt des Einreihens, ms. */
    queuedAtMs: number;
    notBeforeMs: number | null;
    /** Erwartete Spitze RSS (MB), `null`: unbekannt. */
    memExpectedMb: number | null;
    threads: number | null;
    /** Sind alle Vorgänger `SUCCEEDED`? */
    dependenciesDone: boolean;
    /** Hat eine Person den Job ausgelöst (`jobs/editor-freeze.ts`)? Nur solche hält eine Sperre an. */
    editor?: boolean;
}

export interface AdmissionRunning {
    id: number;
    kind: string;
    mapDomainId: string;
    scopeKind: "domain" | "tiles";
    scopeTiles: readonly number[];
    memExpectedMb: number | null;
    threads: number | null;
}

export interface AdmissionInput {
    nowMs: number;
    queued: readonly AdmissionCandidate[];
    /**
     * Alles, was gerade läuft: auch aufgezeichnete Jobs (`import`) und Jobs, die gerade hängen (sie halten ihren Speicher). Die
     * Marke `rollout` gehört nicht dazu: sie ist kein Job mit Bedarf, sie setzt nur `rolloutActive`.
     */
    running: readonly AdmissionRunning[];
    config: JobsConfig;
    /** `MemAvailable` jetzt (MB); `null`: kein Messwert. */
    memAvailableMb: number | null;
    /** Ist die Marke `rollout` aktiv? */
    rolloutActive: boolean;
    /**
     * Warten Editor-Jobs (Kartensperre, eingeschränkter Betrieb, Zustand unbekannt; SYS-0001 §3.3)? Ein gehaltener Job sperrt seinen
     * Bereich für spätere nicht: Importe und Wartung laufen an ihm vorbei (Betreiber 2026-10-10, §9a Frage 3).
     */
    editorJobsHeld?: boolean;
    /**
     * Ist ein Auftrag dieser Art schwer? Dann läuft von den schweren höchstens einer zur Zeit, über alles, was `running` nennt
     * (WI-0163 §1.5: „Ein Schwerer zur Zeit, Kleine nebenher“; der Dirigent gibt hier die Läufe ALLER Umgebungen des Hosts).
     * Ohne Angabe gilt die Regel nicht, und es bleibt bei Parallelität, Paaren und Threads.
     */
    isHeavy?: (kind: string) => boolean;
    /** Für die Schätzung: die Zukunft kennt keinen Messwert, der Boden (MS7) wird dann nicht geprüft. */
    ignoreAvailability?: boolean;
}

export interface AdmissionResult {
    /** In der Reihenfolge, in der sie starten. */
    admitted: AdmissionCandidate[];
    /** Der Grund jedes Wartenden. */
    waiting: Map<number, WaitReason>;
}

/** Überlappen sich zwei Fußabdrücke? Verschiedene Kartendomänen nie; `domain` überlappt alles in der Domäne. */
export function scopesOverlap(
    a: { mapDomainId: string; scopeKind: "domain" | "tiles"; scopeTiles: readonly number[] },
    b: { mapDomainId: string; scopeKind: "domain" | "tiles"; scopeTiles: readonly number[] },
): boolean {
    if (a.mapDomainId !== b.mapDomainId) return false;
    if (a.scopeKind === "domain" || b.scopeKind === "domain") return true;
    const tiles = new Set(a.scopeTiles);
    return b.scopeTiles.some((tile) => tiles.has(tile));
}

/** Die Reihenfolge der Zulassung: nach Priorität, dann nach dem Einreihen. */
export function compareCandidates(
    a: Pick<AdmissionCandidate, "priority" | "queuedAtMs" | "id">,
    b: Pick<AdmissionCandidate, "priority" | "queuedAtMs" | "id">,
): number {
    return a.priority - b.priority || a.queuedAtMs - b.queuedAtMs || a.id - b.id;
}

function sum(values: readonly (number | null)[]): number {
    return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function decideAdmission(input: AdmissionInput): AdmissionResult {
    const { config, nowMs } = input;
    const ordered = [...input.queued].sort(compareCandidates);
    const running: AdmissionRunning[] = [...input.running];
    const admitted: AdmissionCandidate[] = [];
    const waiting = new Map<number, WaitReason>();
    const admittedIds = new Set<number>();
    /** Was in diesem Durchgang schon zugelassen ist, aber noch nicht in `MemAvailable` zu sehen. */
    let admittedMb = 0;

    /** Kennen wir alle Werte, die eine Zulassung gegen andere braucht (MS3 bis MS7)? */
    const knownForAdmission = (job: AdmissionCandidate): boolean =>
        config.maxConcurrent[job.kind] !== undefined &&
        config.cpuBudgetThreads !== null &&
        job.threads !== null &&
        job.memExpectedMb !== null &&
        config.memTotalBudgetMb !== null &&
        config.memAvailFloorMb !== null &&
        (input.ignoreAvailability === true || input.memAvailableMb !== null);
    /**
     * Ein laufender Job mit unbekanntem Bedarf lässt nichts neben sich zu, auch einer, der selbst als „allein“ zugelassen wurde
     * (seine Art hat keinen Wert für die Parallelität).
     */
    const runningKnown = (job: AdmissionRunning): boolean =>
        job.threads !== null && job.memExpectedMb !== null && config.maxConcurrent[job.kind] !== undefined;
    const held = (job: AdmissionCandidate): boolean => input.editorJobsHeld === true && job.editor === true;

    for (const job of ordered) {
        const reason = ((): WaitReason | null => {
            // 0. Sperre: ein Editor-Job wartet, bis sie gelöst ist; alles andere läuft weiter.
            if (held(job)) return "waits_system_lock";
            // 1. Vorgänger
            if (!job.dependenciesDone) return "waits_dependency";
            // 2. Entprellung
            if (job.notBeforeMs !== null && job.notBeforeMs > nowMs) return "debouncing";
            // 3. Bereichssperre: ein laufender Job im Fußabdruck sperrt; ein früher eingereihter, noch nicht gestarteter
            // ebenso (je Bereich bleibt die Reihenfolge, ein späterer mit getrenntem Fußabdruck darf überholen).
            // 🔴 Ein Auftrag ohne Kartenfußabdruck (`tiles` ohne Kacheln: Gebietsableitung, Wegnamen) hat keine Reihenfolge im Bereich zu
            // halten: Ihn sperrt nur ein LAUFENDER `domain`-Auftrag (Zug, Import). Sonst wartete er hinter `land_smooth` und `label_runs`,
            // die selbst auf ein Gelände warten (Stage 2026-10-19, Job 1930 über 15 min; Claudio
            // `2026-10-19-gebietsableitung-wartet-hinter-domain-auftraegen-an-claudia.md`).
            if (running.some((other) => scopesOverlap(job, other))) return "waits_area";
            const ohneFussabdruck = job.scopeKind === "tiles" && job.scopeTiles.length === 0;
            const earlierBlocker = ordered.some(
                (other) =>
                    !ohneFussabdruck &&
                    other !== job &&
                    !admittedIds.has(other.id) &&
                    !held(other) &&
                    (other.queuedAtMs < job.queuedAtMs || (other.queuedAtMs === job.queuedAtMs && other.id < job.id)) &&
                    scopesOverlap(job, other),
            );
            if (earlierBlocker) return "waits_area";
            // 4. Ein Schwerer zur Zeit (nur mit `isHeavy`), dann Parallelität, Paare, Threads
            const heavy = input.isHeavy;
            if (heavy?.(job.kind) === true && running.some((other) => heavy(other.kind))) return "waits_slot";
            const alone = !knownForAdmission(job);
            if (running.length > 0 && (alone || running.some((other) => !runningKnown(other)))) return "waits_slot";
            if (!alone) {
                const maxConcurrent = config.maxConcurrent[job.kind] ?? 1;
                if (running.filter((other) => other.kind === job.kind).length >= maxConcurrent) return "waits_slot";
                const partners = config.exclusivePairs
                    .filter(([left, right]) => left === job.kind || right === job.kind)
                    .map(([left, right]) => (left === job.kind ? right : left));
                if (running.some((other) => partners.includes(other.kind))) return "waits_slot";
                const budget = config.cpuBudgetThreads ?? 0;
                if (sum(running.map((other) => other.threads)) + (job.threads ?? 0) > budget) return "waits_slot";
            }
            // 5. Marke rollout: zwei Fastify-Instanzen kosten 600 bis 800 MB, und `MemAvailable` zeigt das erst, wenn es zu
            // spät ist; solange sie aktiv ist, nur kleine Jobs. Eine unbekannte Erwartung ist nie klein.
            if (
                input.rolloutActive &&
                (job.memExpectedMb ?? Number.POSITIVE_INFINITY) > (config.rolloutMaxJobMb ?? 0)
            ) {
                return "waits_rollout";
            }
            // 6. Speicher: das Budget aller Jobs (MS6) und der Boden von MemAvailable nach der Zulassung (MS7).
            // 🔴 Eine leichte Art (nur mit `isHeavy`) bucht nur gegen andere leichte und hat ihren eigenen Boden (WI-0283): Das Gelernte klemmt ein
            // Gelände auf das volle Budget (Stage: 2000 von 2000), und auf seiner Speicherspitze steht `MemAvailable` am Boden. Sonst liefe neben
            // einem Gelände kein Auftrag von 95 MB und einer Sekunde, wie es die leichten Arten ausdrücklich dürfen (WI-0163 §1.5). Den Host schützt
            // bei ihnen der Boden, nicht die Buchung.
            if (!alone) {
                const leicht = heavy !== undefined && !heavy(job.kind);
                const expected = job.memExpectedMb ?? 0;
                const booked = sum(
                    running.filter((other) => !leicht || !heavy(other.kind)).map((other) => other.memExpectedMb),
                );
                if (booked + expected > (config.memTotalBudgetMb ?? 0)) return "waits_memory";
                if (input.ignoreAvailability !== true) {
                    const available = (input.memAvailableMb ?? 0) - admittedMb;
                    const boden = leicht
                        ? (config.memAvailFloorLightMb ?? config.memAvailFloorMb ?? 0)
                        : (config.memAvailFloorMb ?? 0);
                    if (available - expected < boden) return "waits_memory";
                }
            }
            return null;
        })();

        if (reason === null) {
            admitted.push(job);
            admittedIds.add(job.id);
            admittedMb += job.memExpectedMb ?? 0;
            running.push({
                id: job.id,
                kind: job.kind,
                mapDomainId: job.mapDomainId,
                scopeKind: job.scopeKind,
                scopeTiles: job.scopeTiles,
                memExpectedMb: job.memExpectedMb,
                threads: job.threads,
            });
        } else {
            waiting.set(job.id, reason);
        }
    }
    return { admitted, waiting };
}
