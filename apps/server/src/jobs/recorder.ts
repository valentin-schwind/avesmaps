import { hostname } from "node:os";
import { leaseSecondsFor, swapRateFor, type JobFinding, type JobsConfig } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { mapLockWarning } from "./editor-freeze.ts";
import { budgetFinding, swapFinding } from "./findings.ts";
import { JOB_KIND_CATALOG, expectedMemoryMb, phaseProgress } from "./kinds.ts";
import { insertJob } from "./store.ts";
import {
    recordedRunSeconds,
    recordFinish,
    recordHeartbeat,
    recordPhase,
    uebernimmAngekuendigt,
    type RecordRef,
} from "./store-record.ts";

/**
 * Aufzeichnen (JOBS-0001 4.1, Q5): Ein bestehender Ablauf, der KEINEN Aufseher hat (der tägliche Zug, ein Rollout, `legacy:update`),
 * meldet sich selbst als Job der Herkunft `recorded`: Start, Phasen, Ende. Daraus wird auf der Statusseite „läuft, Phase I11, seit
 * fünf Minuten, Spitze 1.2 GB“.
 *
 * 🔴 BEST EFFORT, HÄLT NIE AN. Ein Fehler beim Aufzeichnen (Datenbank weg, Migration fehlt, Rolle ohne Recht) beendet nie einen Import
 * und ändert nie sein Verhalten: Jede Methode fängt ihre Fehler und liefert `null` beziehungsweise `false`. Nur mit `strict`
 * (Tests, `jobs-cli --strict`) werfen sie. Fehlt die Migration, wird nicht aufgezeichnet.
 *
 * Die Lease eines aufgezeichneten Jobs (`recordedLeaseS`) ist länger als die längste Phase: Kein Aufseher kann das Lebenszeichen
 * zwischen zwei Meldungen senden. Bleibt die Meldung aus, läuft sie ab, und der Planer macht den Job zu `FAILED` mit
 * `recorder_lost`; bis dahin steht er als „hängt“ da.
 */

export interface RecorderOptions {
    database: Database;
    config: JobsConfig;
    mapDomainId: string;
    /** Wer meldet (`lease_owner`), etwa `recorder:<Rechner>:<Prozess>`. */
    instanceId?: string;
    release?: string | null;
    /** Fehler werfen statt schlucken (Tests, `--strict`). */
    strict?: boolean;
    /** Wohin Warnungen gehen; Standard stderr. */
    warn?: (message: string) => void;
}

export interface RecordedFinish {
    ok: boolean;
    errorCode?: string | null;
    errorSummary?: string | null;
    rssPeakMb?: number | null;
    /** Der höchste Bestand im Swap während des Laufs (MB): eine Zahl im Ergebnis, kein Befund mehr. */
    swapSeenMb?: number | null;
    /** Was während des Laufs aus dem Swap eingelagert wurde (MB, Differenz von `pswpin`): daraus der Befund `swap_in_use` (MS9). */
    swapInMb?: number | null;
    result?: Record<string, unknown> | null;
}

export class JobRecorder {
    private readonly database: Database;
    private readonly config: JobsConfig;
    private readonly mapDomainId: string;
    private readonly instanceId: string;
    private readonly release: string | null;
    private readonly strict: boolean;
    private readonly warn: (message: string) => void;

    constructor(options: RecorderOptions) {
        this.database = options.database;
        this.config = options.config;
        this.mapDomainId = options.mapDomainId;
        this.instanceId = options.instanceId ?? `recorder:${hostname()}:${String(process.pid)}`;
        this.release = options.release ?? null;
        this.strict = options.strict ?? false;
        this.warn = options.warn ?? ((message) => void process.stderr.write(`jobs record: ${message}\n`));
    }

    /** Führt eine Aufzeichnung aus und schluckt ihren Fehler (außer `strict`): Ein Import hält nie wegen ihr an. */
    private async guarded<T>(what: string, fallback: T, work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } catch (error) {
            if (this.strict) throw error;
            const detail = error instanceof Error ? error.message : String(error);
            // Keine Verbindungsangaben ins Journal des Ablaufs (Kap. 10.92).
            this.warn(
                `${what} nicht aufgezeichnet (${detail.replace(/postgres(?:ql)?:\/\/\S+/gi, "<verbindung>").slice(0, 160)})`,
            );
            return fallback;
        }
    }

    /**
     * Ein Import unter Kartensperre läuft weiter (Betreiber 2026-10-10, SYS-0001 §9a Frage 3: „nein auf keinen fall“) und schreibt eine
     * WARN-Zeile in sein Journal (ohne den Grund: Freitext mit möglichem Personenbezug). Er setzt die Sperre nie zurück: Kein Import hebt
     * eine getroffene Entscheidung nachträglich auf (AGENTS.md, „Blockierende Prüfungen im Betrieb“). Liest nur, wirft nie.
     */
    private async warnIfMapLocked(): Promise<void> {
        const warning = await mapLockWarning(this.database);
        if (warning !== null) this.warn(warning);
    }

    /**
     * Meldet den Start. Mit derselben `externalRef` zweimal: derselbe aktive Job. `null`, wenn nicht aufgezeichnet werden konnte. Ist der aktive Job
     * ein angekündigter (`QUEUED`, die Production-Freigabe mit der Person, WI-0248), wird er übernommen, statt einen neuen anzulegen.
     */
    async start(
        kind: string,
        options: { label?: string | null; externalRef?: string | null; phase?: string | null } = {},
    ): Promise<{ publicId: string; created: boolean } | null> {
        if (kind === "import") await this.warnIfMapLocked();
        return this.guarded("Start", null, async () => {
            const spec = JOB_KIND_CATALOG[kind];
            const phase = options.phase ?? null;
            const memExpectedMb = spec ? expectedMemoryMb(spec, {}, phase, this.config, null) : null;
            const inserted = await insertJob(this.database, {
                kind,
                kindVersion: spec?.version ?? 1,
                mapDomainId: this.mapDomainId,
                origin: "recorded",
                label: options.label ?? null,
                externalRef: options.externalRef ?? null,
                leaseOwner: this.instanceId,
                leaseS: leaseSecondsFor(this.config, kind, true),
                phase,
                memExpectedMb,
                release: this.release,
                priority: 50,
                scopeKind: "domain",
            });
            if (!inserted.created)
                await uebernimmAngekuendigt(this.database, inserted.publicId, kind, {
                    leaseOwner: this.instanceId,
                    leaseS: leaseSecondsFor(this.config, kind, true),
                    memExpectedMb,
                    release: this.release,
                });
            return { publicId: inserted.publicId, created: inserted.created };
        });
    }

    /**
     * Meldet eine Phase (und damit ein Lebenszeichen). `previous` ist die Messung der Phase, die gerade endete. Der Speicherschlüssel
     * der neuen Phase bestimmt die Erwartung für die Zulassung: Während I11 läuft, bucht der Import 1.400 MB, nicht 300.
     */
    phase(
        ref: RecordRef,
        kind: string,
        phase: string,
        options: {
            progress?: number | null;
            rssMb?: number | null;
            previous?: { name: string; wallMs: number; rssPeakMb?: number | null } | null;
            /** Warum der Lauf wartet, als Satzteil; fehlt er, wartet er nicht (mehr). */
            waitReason?: string | null;
            /** Die Beschriftung neu setzen; fehlt sie, bleibt die vorhandene. */
            label?: string | null;
        } = {},
    ): Promise<"ok" | "unknown" | "terminal" | null> {
        return this.guarded("Phase", null, async () => {
            const spec = JOB_KIND_CATALOG[kind];
            return recordPhase(
                this.database,
                ref,
                {
                    phase,
                    // Nennt der Aufrufer keinen Anteil, gilt der grobe aus der Tafel der Jobart (`stage_rollout`).
                    progress: options.progress ?? phaseProgress(kind, phase),
                    memExpectedMb: spec ? expectedMemoryMb(spec, {}, phase, this.config, null) : null,
                    rssMb: options.rssMb ?? null,
                    finished: options.previous ?? null,
                    waitReason: options.waitReason ?? null,
                    label: options.label ?? null,
                },
                leaseSecondsFor(this.config, kind, true),
            );
        });
    }

    /** Ein bloßes Lebenszeichen (verlängert die Lease), etwa aus einer Schleife in einem Skript. */
    heartbeat(ref: RecordRef, kind: string): Promise<"ok" | "unknown" | "terminal" | null> {
        return this.guarded("Lebenszeichen", null, () =>
            recordHeartbeat(this.database, ref, leaseSecondsFor(this.config, kind, true)),
        );
    }

    /**
     * Meldet das Ende. Befunde entstehen hier aus den Zahlen des Ablaufs (Swap über dem Rauschen, Spitze über Erwartung oder
     * Meldegrenze): Sie melden, sie halten nie an.
     */
    finish(
        ref: RecordRef,
        kind: string,
        outcome: RecordedFinish,
        current: { phase?: string | null; memExpectedMb?: number | null } = {},
    ): Promise<boolean> {
        return this.guarded("Ende", false, async () => {
            const spec = JOB_KIND_CATALOG[kind];
            const key = spec?.memoryKey({}, current.phase ?? null) ?? null;
            const findings: JobFinding[] = [];
            const laufS = outcome.swapInMb == null ? 0 : ((await recordedRunSeconds(this.database, ref)) ?? 0);
            const swap = swapFinding(
                outcome.swapInMb ?? null,
                laufS,
                this.config.swapNoiseMb,
                swapRateFor(this.config, kind),
            );
            if (swap) findings.push(swap);
            const budget = budgetFinding(
                outcome.rssPeakMb ?? null,
                current.memExpectedMb ?? null,
                key === null ? undefined : this.config.memReportWarnMb[key],
            );
            if (budget) findings.push(budget);
            return recordFinish(this.database, ref, {
                ok: outcome.ok,
                errorCode: outcome.errorCode ?? null,
                errorSummary: outcome.errorSummary ?? null,
                rssPeakMb: outcome.rssPeakMb ?? null,
                swapSeenMb: outcome.swapSeenMb ?? null,
                findings,
                result: outcome.result ?? null,
            });
        });
    }

    /** Die Marke `rollout`: ein, solange der Korridor die Server umschaltet; aus, wenn er fertig ist. Sie heilt sich selbst (Lease). */
    async mark(kind: "rollout", on: boolean, label = "Umschalten der Server"): Promise<boolean> {
        const ref: RecordRef = { externalRef: `${kind}-mark` };
        if (on) {
            const started = await this.start(kind, { label, externalRef: ref.externalRef });
            if (!started) return false;
            // Eine zweite Meldung `on` verlängert die Lease der bestehenden Marke.
            if (!started.created) await this.heartbeat(ref, kind);
            return true;
        }
        return this.finish(ref, kind, { ok: true });
    }
}
