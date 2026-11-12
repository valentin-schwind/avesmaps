import { hostname } from "node:os";
import {
    KARTEN_SVG_JOB_ART,
    leaseSecondsFor,
    swapRateFor,
    type JobState,
    type JobsConfig,
    type WaitReason,
} from "@avesmaps3d/shared";
import { reiheSvgEinWennNoetig } from "../karten-export/nachts.ts";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Database, Queryable } from "../database.ts";
import { OHNE_KARTENBEZUG, isEditorJob, readEditorFreeze, type EditorFreeze } from "./editor-freeze.ts";
import { meldeFolgeFertig } from "./folge-fertig.ts";
import { AUTH_RETENTION_KIND, authRetentionReady, purgeExpiredAuth } from "../auth/retention.ts";
import {
    KANAL_RETENTION_KIND,
    kanalAufbewahrung,
    kanalAufbewahrungBereit,
    type KanalAblage,
} from "../kanal/aufbewahrung.ts";
import {
    COMMUNITY_RETENTION_KIND,
    communityAufbewahrung,
    communityAufbewahrungBereit,
    communityBeitragAufbewahrung,
    communityBeitragAufbewahrungBereit,
    communityFristen,
    communitySocialFreigabe,
} from "../community/aufbewahrung.ts";
import { COMMUNITY_MAIL_ABRUF_KIND, MAIL_ABRUF_DAUERHAFT } from "../community/mail/konfiguration.ts";
import { leseSchalterOderAn } from "../community/mail/routine.ts";
import type { Ablage } from "../map-series/ablage.ts";
import {
    KARTENVORSCHLAG_RETENTION_KIND,
    kartenvorschlagAufbewahrung,
    kartenvorschlagAufbewahrungBereit,
    type KartenvorschlagAblage,
} from "../kartenvorschlag/aufbewahrung.ts";
import { originalErgebnisVon, type OriginalOptionen } from "../kartenvorschlag/original-loeschen.ts";
import {
    PHOTOBOX_RETENTION_KIND,
    ergebnisVon,
    photoboxAufbewahrung,
    photoboxAufbewahrungBereit,
    type PhotoboxAblage,
} from "../photobox/aufbewahrung.ts";
import { KARTENSERIEN_PAPIERKORB_KIND, raeumePapierkorb } from "../map-series/papierkorb.ts";
import { spawnJobProcess, type ChildSpawner, type JobChild } from "./child-process.ts";
import type { ChildMessage } from "./child-protocol.ts";
import { JOB_HANDLERS } from "./handlers.ts";
import { JOB_KIND_CATALOG, expectedMemoryMb, knowsKind, type JobKindSpec } from "./kinds.ts";
import { budgetFinding, swapFinding } from "./findings.ts";
import { LockSession } from "./lock-session.ts";
import { JobRecorder } from "./recorder.ts";
import { readProcessUsage, readSystemMemory, type MemoryProbe, type MemoryReading } from "./memory.ts";
import type { JobRow } from "./rows.ts";
import {
    addJobFinding,
    claimJob,
    completeJob,
    failJob,
    recordCompletionStats,
    finishCancelled,
    getJobById,
    handOffJob,
    heartbeatJob,
    isCommittedBy,
    loadRssP95History,
    pruneJobs,
    failedWithin,
    insertJob,
    ranWithin,
    recoverExpired,
    retryOnDeadlock,
    setJobPhase,
    setWaitReasons,
    type PruneResult,
} from "./store.ts";

/**
 * Der Ausführer (JOBS-0001 4.1, 4.6, 4.8; WI-0163 §5.2): der Aufseher GENAU EINES Auftrags. Gerechnet wird im Kindprozess
 * (`child.ts`), nie hier und nie im Fastify-Prozess.
 *
 * 🔴 ER PLANT NICHT. Was als Nächstes startet, entscheidet der Dirigent für den ganzen Host (`jobs/dirigent/`, WI-0163): Er liest
 * die Schlangen aller Umgebungen nur lesend, hält Reihenfolge, Zulassung und Pause und startet je Auftrag einen Ausführer mit den
 * Rechten der Umgebung (`auftrag-cli.ts --job <id>`). Der Ausführer übernimmt die Zeile (`claimJob`, Fencing über `lease_no`),
 * beaufsichtigt den Kindprozess — Heartbeat des AUFSEHERS alle `heartbeatS` Sekunden mit Spitze RSS und Swap, Phasen, Abbruch,
 * Ende — und schließt ab. Scheitert der Lauf wiederholbar, geht die Zeile über `endRun` zurück nach `QUEUED`, und der Dirigent
 * startet sie neu. Läuft ein Editor-Job, liest er im Takt den Halt der Editor-Jobs (WI-0127 SYS-4, `editor-freeze.ts`): Unter
 * Kartensperre und im eingeschränkten Betrieb rechnet er bis `drainMaxS` zu Ende und hält dann an der Phasengrenze an.
 *
 * `pflege()` (`auftrag-cli.ts --pflege`) räumt die eigene Tafel auf: abgelaufene Leases einsammeln, alte Zeilen löschen, und die
 * täglichen Aufbewahrungen `auth_retention`, `kanal_aufbewahrung`, `community_aufbewahrung`, `photobox_aufbewahrung` und `map_series_papierkorb`, je
 * fällig nach dem letzten Lauf laut Tafel.
 *
 * 🔴 SIE WARTET UND MELDET, SIE BRICHT NIE AB. Ein Job, der mehr braucht als erwartet, ist ein Befund (`budget_exceeded`); ihn beendet
 * nur der Kernel über die cgroup des Scopes und `choom`, beides Claudios Korridor.
 */

export interface WorkerLogger {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
    error(fields: Record<string, unknown>, message: string): void;
}

const silentLogger: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface JobWorkerOptions {
    /** Die Verbindung der Jobs-Rolle; zwei Verbindungen genügen (die Sitzung der geteilten Sperre, Abfragen). */
    database: Database;
    config: JobsConfig;
    mapDomainId: string;
    /** Kennung dieser Instanz (`lease_owner`); sonst Rechnername und Prozessnummer. */
    instanceId?: string;
    release?: string;
    /** Schlüssel der geteilten Sperre der Domäne (`derive-lock.ts`); Tests nehmen einen eigenen. */
    deriveScope?: string;
    spawnChild?: ChildSpawner;
    memory?: MemoryProbe;
    log?: WorkerLogger;
    /** Takt, in dem ein laufender Editor-Job den Halt liest; kürzer als der Profilwert für Tests. */
    tickMs?: number;
    heartbeatMs?: number;
    /** Wie lange der Aufseher nach `stop` auf das Anhalten an der Phasengrenze wartet, Millisekunden. */
    stopGraceMs?: number;
    /** Wie lange ein beendeter Job-Prozess Zeit hat, selbst zu enden, bevor er beendet wird, Millisekunden. */
    killGraceMs?: number;
    /**
     * Wie oft die Aufbewahrung der Anmeldedaten läuft (`auth/retention.ts`), Millisekunden; ohne Wert gar nicht. Die Pflege des
     * Betriebs setzt einen Tag (`ausfuehrer.ts`); fällig ist sie, wenn in diesem Abstand kein Lauf der Art in der Tafel steht.
     */
    authRetentionEveryMs?: number;
    /**
     * Wie oft die Aufbewahrung des Betreiber-Kanals läuft (`kanal/aufbewahrung.ts`), Millisekunden; ohne Wert gar nicht.
     * `kanalAblage` löscht die Dateien der Bilder (ohne sie bleiben sie vorgemerkt).
     */
    kanalRetentionEveryMs?: number;
    kanalAblage?: KanalAblage;
    /** Wie oft die Aufbewahrung der Community läuft (`community/aufbewahrung.ts`, WI-0268), Millisekunden; ohne Wert gar nicht. */
    communityRetentionEveryMs?: number;
    /**
     * In welchem Abstand die Pflege den Abruf des Community-Postfachs einreiht (`jobs/community-mail-abruf-job.ts`, WI-0268 C6b), Millisekunden; ohne Wert gar nicht. Die Pflege reiht nur ein, wenn
     * `communityMailAbrufAn` es erlaubt (der Abruf ist konfiguriert); ohne diese Angabe nie.
     */
    communityMailAbrufEveryMs?: number;
    communityMailAbrufAn?: () => boolean;
    /**
     * Die tägliche Pflege der fremden Kanäle des Social Hubs (WI-0268 C12a): im Lauf der Aufbewahrung der Community liest sie die Grenzen der Dienste neu (Mastodon: `GET /api/v2/instance`), damit eine geänderte
     * Instanzgrenze beim nächsten Zählen gilt. Gibt zurück, was ins Ergebnis des Laufs kommt (nur Wörter wie `gelesen`, `aus`, `fehler`, nie Adresse oder Schlüssel); ein geworfener Fehler (Datenbank) macht den Lauf rot.
     * Ohne diese Angabe geschieht nichts.
     */
    socialKanalPflege?: (db: Queryable) => Promise<Record<string, string>>;
    /**
     * Wie oft die Aufbewahrung der Reisebilder läuft (`photobox/aufbewahrung.ts`, WI-0272), Millisekunden; ohne Wert gar nicht. `photoboxAblage` löscht
     * die Dateien der gelöschten Bilder. 🔴 Ohne Ablage läuft sie nicht, sondern steht als gescheitert da (`photobox_retention_no_store`): Die Funktion
     * der Datenbank löscht die Zeilen und nennt die Schlüssel nur dieses eine Mal, ohne Ablage blieben die Dateien ohne Zeile für immer liegen.
     */
    photoboxRetentionEveryMs?: number;
    photoboxAblage?: PhotoboxAblage;
    /**
     * Wie oft die Aufbewahrung der Kartenvorschläge läuft (`kartenvorschlag/aufbewahrung.ts`, WI-0275 B2), Millisekunden; ohne Wert gar nicht. Die Dateien löscht
     * `kartenvorschlagAblage` (derselbe Medienspeicher wie bei den Reisebildern; sie liest und legt auch ab, für das Original angenommener Vorschläge); 🔴 ohne sie läuft der Job
     * nicht, sondern steht als gescheitert da.
     */
    kartenvorschlagRetentionEveryMs?: number;
    /** Wie oft die Pflege fragt, ob die Vektorkarte neu zu zeichnen ist (WI-0280); ohne Wert nie. */
    kartenSvgEveryMs?: number;
    kartenvorschlagAblage?: KartenvorschlagAblage;
    /** Das Original angenommener Vorschläge: die Statusdatei der Sicherung und die Probe auf der Stage (`originalOptionenAus`). */
    kartenvorschlagOriginal?: OriginalOptionen;
    /**
     * Wie oft der Papierkorb der Kartenserien nach seiner Frist geräumt wird (`map-series/papierkorb.ts`), Millisekunden; ohne Wert gar
     * nicht. Wo Kacheln und Quellen liegen, sagt `kartenserien`; ohne Ablage bleiben die Dateien liegen.
     */
    kartenserienPapierkorbEveryMs?: number;
    kartenserien?: { tileRoot: string | undefined; ablage: Ablage | undefined };
    /**
     * Jobarten, die diese Umgebung zwar kennt, aber nicht selbst ausführt: die Aufträge der Abgleiche ohne `ABGLEICHE=worker`
     * (`abgleiche/ausfuehrung.ts`). `runOne` antwortet dann „Ausführung fehlt“ und lässt die Zeile unberührt.
     */
    ausgeschlosseneArten?: ReadonlySet<string>;
    /**
     * Für welche Umgebung die Glocke meldet, dass die Aufträge einer Person abgearbeitet sind (WI-0230, `folge-fertig.ts`). Ohne:
     * keine Meldung (Tests, eine Umgebung ohne `AVESMAPS_ENV`).
     */
    glockenUmgebung?: AuthEnvironment;
}

/**
 * Was `runOne` getan hat; `auftrag-cli` macht daraus den Exitcode (WI-0163 §5.2). Die Gründe sind Kennungen für das Log und den
 * Dirigenten, kein Text für die Oberfläche.
 */
export type AuftragErgebnis =
    /**
     * Der Lauf ist zu Ende; `state` ist der Zustand der Zeile danach: `SUCCEEDED`, `FAILED`, `CANCELLED`, oder `QUEUED` (wiederholbar
     * gescheitert, an der Phasengrenze angehalten oder zurückgegeben). `null`: Die Zeile ließ sich danach nicht mehr lesen.
     */
    | { ergebnis: "erledigt"; state: JobState | null }
    /** Nichts zu tun: Die Zeile fehlt, wartet nicht (mehr), ist aufgezeichnet, ein anderer hat sie übernommen, oder der Ausführer endet. */
    | { ergebnis: "nichts_zu_tun"; grund: "not_found" | "not_queued" | "claimed_elsewhere" | "draining" }
    /** Diese Umgebung kann die Art nicht ausführen; die Zeile bleibt unberührt. */
    | {
          ergebnis: "ausfuehrung_fehlt";
          grund: "unknown_kind" | "kind_mismatch" | "recorded_kind" | "no_handler" | "excluded_kind";
      }
    /** Jetzt nicht, gleich vielleicht: Die geteilte Sperre der Domäne hält ein Zug. Die Zeile trägt den Wartegrund. */
    | { ergebnis: "voruebergehend"; grund: Extract<WaitReason, "waits_domain_lock"> }
    /** Der Lauf endete, aber sein Ende ließ sich nicht schreiben (Datenbank weg): Die Lease läuft ab, die Pflege sammelt ein. */
    | { ergebnis: "technischer_fehler"; grund: "finish_not_written" | "lease_unreachable" };

export interface PflegeBericht {
    /** Wie viele Läufe mit abgelaufener Lease eingesammelt wurden. */
    recovered: number;
    pruned: PruneResult;
    /** Lief die Aufbewahrung in diesem Aufruf (`false`: nicht fällig, nicht eingerichtet oder vor ihrer Migration)? */
    authRetention: boolean;
    kanalRetention: boolean;
    communityRetention: boolean;
    /** Reihte die Pflege einen Abruf des Community-Postfachs ein? */
    communityMailAbruf: boolean;
    photoboxRetention: boolean;
    kartenvorschlagRetention: boolean;
    kartenserienPapierkorb: boolean;
    /** Der tägliche SVG-Abzug wurde eingereiht (WI-0280). */
    kartenSvg: boolean;
}

interface Supervised {
    job: JobRow;
    spec: JobKindSpec;
    child: JobChild;
    leaseNo: number;
    leaseS: number;
    startedAtMs: number;
    heartbeat: ReturnType<typeof setInterval>;
    /** Der Takt, in dem ein Editor-Job den Halt liest (SYS-4); bei anderen Jobs keiner. */
    freezeTick: ReturnType<typeof setInterval> | undefined;
    lastHeartbeatOkMs: number;
    holdsShared: boolean;
    usage: { rssMb: number; rssPeakMb: number; arrayBufferMb: number; cpuMs: number };
    finalized: boolean;
    exited: boolean;
    beating: boolean;
    cancelSent: boolean;
    /** Ein Editor-Job lief unter einer Sperre länger als `drainMaxS` und soll an der nächsten Phasengrenze anhalten (SYS-4). */
    lockStopSent: boolean;
    flaggedSwap: boolean;
    /** Das bis zum Start Eingelagerte (MB); der Befund zählt nur, was danach dazukommt (MS9). */
    swapInStartMb: number | null;
    flaggedBudget: boolean;
    /** Wie die Aufsicht endete, wenn nicht regulär: der Grund für `technischer_fehler`. */
    failure: Extract<AuftragErgebnis, { ergebnis: "technischer_fehler" }>["grund"] | null;
    /** Alle Nachrichten und Ereignisse eines Jobs laufen nacheinander. */
    chain: Promise<void>;
    resolveDone: () => void;
    done: Promise<void>;
}

export class JobWorker {
    private readonly database: Database;
    private readonly config: JobsConfig;
    private readonly mapDomainId: string;
    private readonly instanceId: string;
    private readonly release: string | null;
    private readonly locks: LockSession;
    private readonly spawnChild: ChildSpawner;
    private readonly memory: MemoryProbe;
    private readonly log: WorkerLogger;
    private readonly tickMs: number;
    private readonly heartbeatMs: number;
    private readonly stopGraceMs: number;
    private readonly killGraceMs: number;
    private readonly children = new Map<number, Supervised>();
    private draining = false;
    private readonly authRetentionEveryMs: number | undefined;
    private readonly kanalRetentionEveryMs: number | undefined;
    private readonly communityRetentionEveryMs: number | undefined;
    private readonly communityMailAbrufEveryMs: number | undefined;
    private readonly communityMailAbrufAn: () => boolean;
    private readonly socialKanalPflege: ((db: Queryable) => Promise<Record<string, string>>) | undefined;
    private readonly photoboxRetentionEveryMs: number | undefined;
    private readonly photoboxAblage: PhotoboxAblage | undefined;
    private readonly kartenvorschlagRetentionEveryMs: number | undefined;
    private readonly kartenSvgEveryMs: number | undefined;
    private readonly kartenvorschlagAblage: KartenvorschlagAblage | undefined;
    private readonly kartenvorschlagOriginal: OriginalOptionen;
    private readonly kanalAblage: KanalAblage | undefined;
    private readonly kartenserienPapierkorbEveryMs: number | undefined;
    private readonly kartenserien: { tileRoot: string | undefined; ablage: Ablage | undefined };
    private readonly ausgeschlosseneArten: ReadonlySet<string>;
    private readonly glockenUmgebung: AuthEnvironment | undefined;
    /** Der zuletzt gelesene Grund des Halts der Editor-Jobs: eine Logzeile je Wechsel, nie eine je Takt. */
    private freezeCause: EditorFreeze["cause"] = null;

    constructor(options: JobWorkerOptions) {
        this.database = options.database;
        this.config = options.config;
        this.mapDomainId = options.mapDomainId;
        this.instanceId = options.instanceId ?? `${hostname()}:${String(process.pid)}`;
        this.release = options.release ?? null;
        this.locks = new LockSession(options.database, options.deriveScope ?? options.mapDomainId);
        this.spawnChild = options.spawnChild ?? spawnJobProcess;
        this.memory = options.memory ?? readSystemMemory;
        this.log = options.log ?? silentLogger;
        this.tickMs = options.tickMs ?? Math.round(options.config.tickS * 1000);
        this.heartbeatMs = options.heartbeatMs ?? Math.round(options.config.heartbeatS * 1000);
        this.stopGraceMs = options.stopGraceMs ?? 30_000;
        this.killGraceMs = options.killGraceMs ?? 5_000;
        this.authRetentionEveryMs = options.authRetentionEveryMs;
        this.kanalRetentionEveryMs = options.kanalRetentionEveryMs;
        this.communityRetentionEveryMs = options.communityRetentionEveryMs;
        this.communityMailAbrufEveryMs = options.communityMailAbrufEveryMs;
        this.communityMailAbrufAn = options.communityMailAbrufAn ?? (() => false);
        this.socialKanalPflege = options.socialKanalPflege;
        this.photoboxRetentionEveryMs = options.photoboxRetentionEveryMs;
        this.photoboxAblage = options.photoboxAblage;
        this.kartenvorschlagRetentionEveryMs = options.kartenvorschlagRetentionEveryMs;
        this.kartenSvgEveryMs = options.kartenSvgEveryMs;
        this.kartenvorschlagAblage = options.kartenvorschlagAblage;
        this.kartenvorschlagOriginal = options.kartenvorschlagOriginal ?? {};
        this.kanalAblage = options.kanalAblage;
        this.kartenserienPapierkorbEveryMs = options.kartenserienPapierkorbEveryMs;
        this.kartenserien = options.kartenserien ?? { tileRoot: undefined, ablage: undefined };
        this.ausgeschlosseneArten = options.ausgeschlosseneArten ?? new Set();
        this.glockenUmgebung = options.glockenUmgebung;
    }

    /** Die Kennung dieser Instanz (`lease_owner` ihrer Jobs). */
    get id(): string {
        return this.instanceId;
    }

    /** Wie viele Jobs dieser Ausführer gerade beaufsichtigt (im Betrieb höchstens einen). */
    activeCount(): number {
        return this.children.size;
    }

    isDraining(): boolean {
        return this.draining;
    }

    // --- Einen Auftrag ausführen -------------------------------------------------------------------------------

    /**
     * Führt den Auftrag `jobId` aus und kehrt zurück, wenn er zu Ende ist. Nur eine Zeile, die `QUEUED` ist und `origin = 'queued'`
     * trägt, wird übernommen; alles andere ist „nichts zu tun“ (der Dirigent sah einen älteren Stand). `art` ist die Art, die der
     * Dirigent gesehen hat: Weicht die Zeile ab, fehlt hier die Ausführung, statt etwas anderes zu rechnen.
     */
    async runOne(jobId: number, options: { art?: string } = {}): Promise<AuftragErgebnis> {
        try {
            const row = await getJobById(this.database, jobId);
            if (row === null) return { ergebnis: "nichts_zu_tun", grund: "not_found" };
            if (row.state !== "QUEUED" || row.origin !== "queued")
                return { ergebnis: "nichts_zu_tun", grund: "not_queued" };
            const missing = this.missingExecution(row, options.art);
            if (missing !== null) {
                this.log.warn(
                    { job: row.publicId, kind: row.kind, kindVersion: row.kindVersion, grund: missing },
                    "jobs: Ausführung fehlt in dieser Umgebung, die Zeile bleibt unberührt",
                );
                return { ergebnis: "ausfuehrung_fehlt", grund: missing };
            }
            if (this.draining) return { ergebnis: "nichts_zu_tun", grund: "draining" };
            const spec = JOB_KIND_CATALOG[row.kind] as JobKindSpec;

            // Die geteilte Sperre der Domäne: hält ein Zug sie exklusiv, bleibt der Job `QUEUED` mit dem Grund `waits_domain_lock`.
            let holdsShared = false;
            if (spec.holdsSharedDomainLock) {
                holdsShared = await this.locks.acquireShared();
                if (!holdsShared) {
                    const grund = "waits_domain_lock" as const;
                    await setWaitReasons(this.database, new Map([[row.id, grund]]));
                    return { ergebnis: "voruebergehend", grund };
                }
            }
            const history = spec.learnsFromHistory
                ? await loadRssP95History(this.database, [row.kind], this.config.historyMinRuns)
                : {};
            const memExpectedMb = expectedMemoryMb(spec, row.inputRef, null, this.config, history[row.kind] ?? null);
            const leaseS = leaseSecondsFor(this.config, row.kind, false);
            // Ein Abbruch, ein zweiter Ausführer: Wer die Zeile zuerst übernimmt, rechnet; für die anderen ist nichts zu tun.
            const claimed = this.draining
                ? null
                : await claimJob(this.database, row.id, this.instanceId, leaseS, memExpectedMb);
            if (!claimed) {
                if (holdsShared) await this.locks.releaseShared();
                return { ergebnis: "nichts_zu_tun", grund: this.draining ? "draining" : "claimed_elsewhere" };
            }
            const entry = this.supervise(claimed, spec, leaseS, holdsShared);
            await entry.done;
            if (entry.failure !== null) return { ergebnis: "technischer_fehler", grund: entry.failure };
            const after = await getJobById(this.database, jobId).catch(() => null);
            if (after !== null && after.finishedAt !== null) await this.meldeFolge(after);
            return { ergebnis: "erledigt", state: after?.state ?? null };
        } finally {
            // Die Sitzung der geteilten Sperre geht zurück, sobald nichts mehr läuft (im Betrieb ein Auftrag je Prozess).
            if (this.children.size === 0) await this.locks.release();
        }
    }

    /** Sind die Aufträge der auslösenden Person abgearbeitet, sagt es die Glocke (WI-0230). Scheitert nie am Auftrag: nur eine Logzeile. */
    private async meldeFolge(job: JobRow): Promise<void> {
        // Der Release-Test ist keine Folge von Kartenarbeit: Sein Ende meldet die Karte im Reiter „Umgebungen“, nicht die Glocke.
        if (this.glockenUmgebung === undefined || OHNE_KARTENBEZUG.has(job.kind)) return;
        try {
            const meldung = await meldeFolgeFertig(this.database, this.glockenUmgebung, job.actorRef);
            if ("art" in meldung && meldung.gemeldet)
                this.log.info(
                    { job: job.publicId, art: meldung.art, auftraege: meldung.auftraege },
                    "jobs: Folge fertig, Glocke",
                );
        } catch (error) {
            this.log.warn({ err: error, job: job.publicId }, "jobs: Glocke zur fertigen Folge nicht gemeldet");
        }
    }

    /** Kann diese Umgebung die Zeile ausführen? `null`: ja; sonst der Grund, warum nicht. */
    private missingExecution(
        row: JobRow,
        art: string | undefined,
    ): Extract<AuftragErgebnis, { ergebnis: "ausfuehrung_fehlt" }>["grund"] | null {
        if (art !== undefined && art !== row.kind) return "kind_mismatch";
        // Eine Art oder Fassung, die dieser Stand nicht kennt: So laufen zwei Versionen nebeneinander (Blue/Green).
        if (!knowsKind(row.kind, row.kindVersion)) return "unknown_kind";
        if (JOB_KIND_CATALOG[row.kind]?.origin !== "queued") return "recorded_kind";
        // Bekannt, aber hier nicht zu rechnen (`production_pull`: nur der Korridor kann ihn ausführen).
        if (JOB_HANDLERS[row.kind] === undefined) return "no_handler";
        if (this.ausgeschlosseneArten.has(row.kind)) return "excluded_kind";
        return null;
    }

    // --- Pflege der eigenen Tafel ------------------------------------------------------------------------------

    /**
     * Räumt die Tafel dieser Umgebung auf: `RUNNING` mit abgelaufener Lease einsammeln (JOBS-0001 4.6: wiederholbar bis zu zwei Mal,
     * dann `FAILED`), terminale Zeilen nach der Aufbewahrung des Profils löschen, und die täglichen Aufbewahrungen, wenn sie fällig sind.
     * Der Dirigent darf nicht schreiben; ohne diese Pflege bliebe ein Lauf, dessen Ausführer gestorben ist, für immer `RUNNING`.
     */
    async pflege(): Promise<PflegeBericht> {
        const recovered = await this.recover();
        const pruned = await pruneJobs(this.database, this.config.retention);
        if (pruned.jobs > 0 || pruned.events > 0)
            this.log.info({ jobs: pruned.jobs, events: pruned.events }, "jobs: aufgeräumt");
        const authRetention = await this.authRetention();
        const kanalRetention = await this.kanalRetention();
        const communityRetention = await this.communityRetention();
        const communityMailAbruf = await this.communityMailAbruf();
        const photoboxRetention = await this.photoboxRetention();
        const kartenvorschlagRetention = await this.kartenvorschlagRetention();
        const kartenserienPapierkorb = await this.kartenserienPapierkorb();
        const kartenSvg = await this.kartenSvgTaeglich();
        return {
            recovered,
            pruned,
            authRetention,
            kanalRetention,
            communityRetention,
            communityMailAbruf,
            photoboxRetention,
            kartenvorschlagRetention,
            kartenserienPapierkorb,
            kartenSvg,
        };
    }

    private async recover(): Promise<number> {
        const actions = await recoverExpired(this.database);
        for (const action of actions) {
            this.log.warn(
                { job: action.publicId, kind: action.kind, owner: action.leaseOwner, outcome: action.outcome },
                "jobs: Lease abgelaufen, eingesammelt",
            );
        }
        return actions.length;
    }

    /** Ist eine Aufbewahrung fällig? Ohne Abstand nie; sonst, wenn die Tafel im Abstand keinen Lauf der Art kennt. */
    private async faellig(kind: string, everyMs: number | undefined): Promise<boolean> {
        if (everyMs === undefined) return false;
        return !(await ranWithin(this.database, kind, everyMs));
    }

    /**
     * Der tägliche SVG-Abzug (WI-0280): Ist seit einem Tag keiner gelaufen und hat sich die Karte geändert, reiht die Pflege den Bau ein. Scheitert das, versucht es die nächste
     * Pflege wieder; die Karte bleibt davon unberührt.
     */
    private async kartenSvgTaeglich(): Promise<boolean> {
        if (!(await this.faellig(KARTEN_SVG_JOB_ART, this.kartenSvgEveryMs))) return false;
        try {
            const eingereiht = await reiheSvgEinWennNoetig(this.database);
            if (eingereiht) this.log.info({}, "karten: täglicher SVG-Abzug eingereiht");
            return eingereiht;
        } catch (error) {
            this.log.warn({ err: error }, "karten: täglicher SVG-Abzug nicht eingereiht");
            return false;
        }
    }

    /**
     * Der Papierkorb der Kartenserien nach seiner Frist (WI-0220 Schnitt 4) als aufgezeichneter Job `map_series_papierkorb`. Wie bei
     * `kanal_aufbewahrung` geht nur der SQLSTATE auf die Statusseite; scheitert er, versucht es die nächste Pflege wieder.
     */
    private async kartenserienPapierkorb(): Promise<boolean> {
        if (!(await this.faellig(KARTENSERIEN_PAPIERKORB_KIND, this.kartenserienPapierkorbEveryMs))) return false;
        const recorder = this.recorder("kartenserien");
        const started = await recorder.start(KARTENSERIEN_PAPIERKORB_KIND);
        const ref = started === null ? null : { publicId: started.publicId };
        try {
            const result = await raeumePapierkorb(this.database, this.kartenserien);
            if (ref !== null)
                await recorder.finish(ref, KARTENSERIEN_PAPIERKORB_KIND, { ok: true, result: { ...result } });
            if (result.serien.length > 0) this.log.info({ ...result }, "kartenserien: Papierkorb nach Frist geräumt");
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (ref !== null)
                await recorder.finish(ref, KARTENSERIEN_PAPIERKORB_KIND, {
                    ok: false,
                    errorCode: "map_series_trash_failed",
                    errorSummary: `SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
                });
            this.log.warn(
                { err: error },
                "kartenserien: Papierkorb nicht geräumt (Recht der Jobs-Rolle an map_series? Ablage beschreibbar?)",
            );
        }
        return true;
    }

    /**
     * Die Aufbewahrung des Betreiber-Kanals (WI-0124, KANAL-0001 §3.1) als aufgezeichneter Job `kanal_aufbewahrung`. Wie bei
     * `auth_retention` geht nur der SQLSTATE auf die Statusseite.
     */
    private async kanalRetention(): Promise<boolean> {
        if (!(await this.faellig(KANAL_RETENTION_KIND, this.kanalRetentionEveryMs))) return false;
        if (!(await kanalAufbewahrungBereit(this.database))) return false;
        const recorder = this.recorder("kanal");
        const started = await recorder.start(KANAL_RETENTION_KIND);
        const ref = started === null ? null : { publicId: started.publicId };
        try {
            const result = await kanalAufbewahrung(this.database, this.kanalAblage);
            if (ref !== null) await recorder.finish(ref, KANAL_RETENTION_KIND, { ok: true, result: { ...result } });
            this.log.info({ ...result }, "kanal: Aufbewahrung gelaufen");
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (ref !== null)
                await recorder.finish(ref, KANAL_RETENTION_KIND, {
                    ok: false,
                    errorCode: "kanal_retention_failed",
                    errorSummary: `SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
                });
            this.log.warn(
                { err: error },
                "kanal: Aufbewahrung gescheitert (Recht der Jobs-Rolle an den Funktionen des Kanals?)",
            );
        }
        return true;
    }

    /**
     * Der Abruf des Postfachs der Community (WI-0268 C6b): alle `communityMailAbrufEveryMs` ein Auftrag der Warteschlange (`community_mail_abruf`, gerechnet vom Ausführer wie jeder Auftrag). Die Pflege reiht ihn
     * nur ein, wenn der Abruf konfiguriert ist (`communityMailAbrufAn`), kein Auftrag der Art im Abstand lief oder wartet und die Anmeldung nicht kürzlich abgelehnt wurde (sechs Stunden Ruhe, damit das Konto nicht
     * gesperrt wird). Dieselbe `external_ref` hält es bei EINEM aktiven Auftrag. Scheitert das Einreihen, versucht es die nächste Pflege wieder. 🔴 Ohne Konfiguration geschieht gar nichts.
     * 🔴 Der Schalter des Panels „Mailpostfach“ (WI-0268 C6c, `mail_routine`, Migration 0289) gilt zusätzlich: Steht der Abruf auf aus, reiht die Pflege nichts ein. Kann sie den Schalter nicht lesen (Funktion fehlt 42883,
     * Recht fehlt 42501), warnt sie mit dem SQLSTATE und verhält sich wie bisher: Die `.env` bleibt das erste Tor.
     */
    private async communityMailAbruf(): Promise<boolean> {
        const abstand = this.communityMailAbrufEveryMs;
        if (abstand === undefined || !this.communityMailAbrufAn()) return false;
        try {
            const schalter = await leseSchalterOderAn(
                this.database,
                (text) => this.log.warn({}, text),
                "community: Mailabruf",
            );
            if (!schalter.abruf) return false;
            if (await ranWithin(this.database, COMMUNITY_MAIL_ABRUF_KIND, abstand)) return false;
            if (await failedWithin(this.database, COMMUNITY_MAIL_ABRUF_KIND, MAIL_ABRUF_DAUERHAFT, 6 * 3_600_000))
                return false;
            const eingereiht = await insertJob(this.database, {
                kind: COMMUNITY_MAIL_ABRUF_KIND,
                kindVersion: 1,
                mapDomainId: this.mapDomainId,
                origin: "queued",
                actorRef: "community",
                externalRef: COMMUNITY_MAIL_ABRUF_KIND,
                priority: 50,
                scopeKind: "tiles",
                scopeTiles: [],
                release: this.release,
            });
            return eingereiht.created;
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            this.log.warn(
                { sqlstate: typeof code === "string" ? code : undefined },
                "community: Mailabruf nicht eingereiht (Recht der Jobs-Rolle an job_insert?)",
            );
            return false;
        }
    }

    /**
     * Die Aufbewahrung der Community (WI-0268, Fachkonzept §10.2) als aufgezeichneter Job `community_aufbewahrung`. Wie beim Kanal geht nur der
     * SQLSTATE auf die Statusseite; vor Migration 0265 gibt es nichts zu tun. Im selben Lauf melden sich Rückfragen, die seit 30 Tagen unbeantwortet
     * sind, in der Glocke (WI-0268 C5, `community/glocke.ts` `fristen`); die Zahlen (`faellig`, `gemeldet`) stehen im Ergebnis des Laufs.
     */
    private async communityRetention(): Promise<boolean> {
        if (!(await this.faellig(COMMUNITY_RETENTION_KIND, this.communityRetentionEveryMs))) return false;
        if (!(await communityAufbewahrungBereit(this.database))) return false;
        const recorder = this.recorder("community");
        const started = await recorder.start(COMMUNITY_RETENTION_KIND);
        const ref = started === null ? null : { publicId: started.publicId };
        const sqlstate = (error: unknown): string => {
            const code = (error as { code?: unknown }).code;
            return `SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`;
        };
        let result: Awaited<ReturnType<typeof communityAufbewahrung>>;
        try {
            result = await communityAufbewahrung(this.database);
            this.log.info({ ...result }, "community: Aufbewahrung gelaufen");
        } catch (error) {
            if (ref !== null)
                await recorder.finish(ref, COMMUNITY_RETENTION_KIND, {
                    ok: false,
                    errorCode: "community_retention_failed",
                    errorSummary: sqlstate(error),
                });
            this.log.warn(
                { err: error },
                "community: Aufbewahrung gescheitert (Recht der Jobs-Rolle an community_purge_expired?)",
            );
            return true;
        }
        // Die Beiträge des Social Hubs (WI-0270 C11): Frischeprüfung der Vorschläge der Routine und Papierkorb. Eine eigene Funktion; fehlt sie noch
        // (Migration 0269), gibt es nichts zu tun.
        let beitraege: Awaited<ReturnType<typeof communityBeitragAufbewahrung>> | undefined;
        let beitragFehler: string | undefined;
        try {
            if (await communityBeitragAufbewahrungBereit(this.database)) {
                beitraege = await communityBeitragAufbewahrung(this.database);
                this.log.info({ ...beitraege }, "community: Beiträge aufbewahrt");
            }
        } catch (error) {
            beitragFehler = sqlstate(error);
            this.log.warn(
                { err: error },
                "community: Beiträge nicht aufbewahrt (Recht der Jobs-Rolle an beitrag_purge_expired?)",
            );
        }
        // Die fremden Kanäle des Social Hubs (WI-0268 C12a): die Grenzen der Dienste neu lesen. Ein Fehler der Instanz steht als Wort im Ergebnis (`fehler`) und macht den Lauf nicht rot; ein Fehler der Datenbank schon.
        let kanaele: Record<string, string> | undefined;
        let kanalFehler: string | undefined;
        if (this.socialKanalPflege !== undefined) {
            try {
                kanaele = await this.socialKanalPflege(this.database);
                this.log.info({ ...kanaele }, "community: fremde Kanäle gepflegt");
            } catch (error) {
                kanalFehler = sqlstate(error);
                this.log.warn(
                    { err: error },
                    "community: fremde Kanäle nicht gepflegt (Recht der Jobs-Rolle an social_kanal_grenzen_setzen?)",
                );
            }
        }
        // Die Fristen der Rückfragen (WI-0268 C5): nach der Aufbewahrung, nur mit Umgebung der Glocke. Scheitern sie (Recht der Jobs-Rolle an
        // `vorgang` oder an `benachrichtige`), bleibt die Aufbewahrung getan, der Lauf steht aber als gescheitert da, statt still zu schweigen.
        let fristen: Awaited<ReturnType<typeof communityFristen>> | undefined;
        let fristFehler: string | undefined = beitragFehler ?? kanalFehler;
        // Die Vorschläge der Routine (WI-0270 C11) kommen aus der Datenbank, nicht über die App: Der tägliche Lauf meldet sie den Betreibern.
        let social: Awaited<ReturnType<typeof communitySocialFreigabe>> | undefined;
        if (this.glockenUmgebung !== undefined) {
            try {
                fristen = await communityFristen(this.database, this.glockenUmgebung);
                this.log.info({ ...fristen }, "community: Fristen der Rückfragen geprüft");
            } catch (error) {
                fristFehler = sqlstate(error);
                this.log.warn(
                    { err: error },
                    "community: Fristen der Rückfragen nicht gemeldet (Recht der Jobs-Rolle an vorgang und benachrichtige?)",
                );
            }
            try {
                social = await communitySocialFreigabe(this.database, this.glockenUmgebung);
                this.log.info({ ...social }, "community: Vorschläge der Routine gemeldet");
            } catch (error) {
                fristFehler ??= sqlstate(error);
                this.log.warn(
                    { err: error },
                    "community: Vorschläge der Routine nicht gemeldet (Recht der Jobs-Rolle an beitrag und benachrichtige?)",
                );
            }
        }
        if (ref !== null) {
            await recorder.finish(
                ref,
                COMMUNITY_RETENTION_KIND,
                fristFehler === undefined
                    ? { ok: true, result: { ...result, ...beitraege, ...fristen, ...social, ...kanaele } }
                    : {
                          ok: false,
                          errorCode: "community_frist_failed",
                          errorSummary: fristFehler,
                          result: { ...result },
                      },
            );
        }
        return true;
    }

    /**
     * Die Aufbewahrung der Reisebilder (WI-0272 S2, Fachkonzept §5.5 und §13) als aufgezeichneter Job `photobox_aufbewahrung`: offene Einreichungen
     * verfallen nach 60 Tagen, beendete werden 30 Tage danach samt Bild gelöscht (Funktion der Datenbank), danach fallen die Dateien. Wie bei der
     * Community geht nur der SQLSTATE auf die Statusseite; vor Migration 0284 gibt es nichts zu tun. Ein Löschfehler an einer Datei bricht den Lauf
     * nicht ab: Er steht in `errorSummary`, die Schlüssel der übrig gebliebenen Dateien im Log.
     */
    private async photoboxRetention(): Promise<boolean> {
        if (!(await this.faellig(PHOTOBOX_RETENTION_KIND, this.photoboxRetentionEveryMs))) return false;
        if (!(await photoboxAufbewahrungBereit(this.database))) return false;
        const recorder = this.recorder("photobox");
        const started = await recorder.start(PHOTOBOX_RETENTION_KIND);
        const ref = started === null ? null : { publicId: started.publicId };
        const ablage = this.photoboxAblage;
        if (ablage === undefined) {
            // 🔴 Ohne Ablage nichts tun: Die Funktion würde die Zeilen löschen und die Schlüssel nur ein Mal nennen.
            if (ref !== null)
                await recorder.finish(ref, PHOTOBOX_RETENTION_KIND, {
                    ok: false,
                    errorCode: "photobox_retention_no_store",
                    errorSummary: "MEDIA_ROOT fehlt oder ist ungültig",
                });
            this.log.warn(
                {},
                "photobox: Aufbewahrung nicht gelaufen (ohne gültiges MEDIA_ROOT keine Ablage für die Dateien)",
            );
            return true;
        }
        try {
            const lauf = await photoboxAufbewahrung(this.database, ablage);
            const result = ergebnisVon(lauf);
            if (lauf.fehlgeschlagen === 0) {
                if (ref !== null)
                    await recorder.finish(ref, PHOTOBOX_RETENTION_KIND, { ok: true, result: { ...result } });
                this.log.info({ ...result }, "photobox: Aufbewahrung gelaufen");
            } else {
                if (ref !== null)
                    await recorder.finish(ref, PHOTOBOX_RETENTION_KIND, {
                        ok: false,
                        errorCode: "photobox_retention_files_failed",
                        errorSummary: `${String(lauf.fehlgeschlagen)} von ${String(lauf.schluessel)} Dateien nicht gelöscht (${lauf.codes.slice(0, 3).join(", ")})`,
                        result: { ...result },
                    });
                // Die Funktion nennt die Schlüssel nur beim Löschen: Das Log ist die einzige Spur für das Nachräumen.
                this.log.warn(
                    { ...result, codes: lauf.codes, offen: lauf.offen.slice(0, 50) },
                    "photobox: Aufbewahrung gelaufen, Dateien nicht gelöscht (Schreibrecht an der Ablage?)",
                );
            }
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (ref !== null)
                await recorder.finish(ref, PHOTOBOX_RETENTION_KIND, {
                    ok: false,
                    errorCode: "photobox_retention_failed",
                    errorSummary: `SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
                });
            this.log.warn(
                { err: error },
                "photobox: Aufbewahrung gescheitert (Recht der Jobs-Rolle an photobox_aufbewahren? avesmaps3d-db-grants gelaufen?)",
            );
        }
        return true;
    }

    /**
     * Die Aufbewahrung der Kartenvorschläge (WI-0275 B2, Migration 0296) als aufgezeichneter Job `kartenvorschlag_aufbewahrung`: nie hochgeladene und
     * technisch gescheiterte Vorschläge nach 7 Tagen, abgelehnte und zurückgezogene nach 30 Tagen samt Werk (Funktion der Datenbank), danach fallen die Dateien.
     * Wie bei den Reisebildern: Ohne Ablage nichts tun (die Schlüssel würden nur dieses eine Mal genannt), vor der Migration gibt es nichts zu tun, ein
     * Löschfehler an einer Datei bricht den Lauf nicht ab.
     */
    private async kartenvorschlagRetention(): Promise<boolean> {
        if (!(await this.faellig(KARTENVORSCHLAG_RETENTION_KIND, this.kartenvorschlagRetentionEveryMs))) return false;
        if (!(await kartenvorschlagAufbewahrungBereit(this.database))) return false;
        const recorder = this.recorder("kartenvorschlag");
        const started = await recorder.start(KARTENVORSCHLAG_RETENTION_KIND);
        const ref = started === null ? null : { publicId: started.publicId };
        const ablage = this.kartenvorschlagAblage;
        if (ablage === undefined) {
            if (ref !== null)
                await recorder.finish(ref, KARTENVORSCHLAG_RETENTION_KIND, {
                    ok: false,
                    errorCode: "kartenvorschlag_retention_no_store",
                    errorSummary: "MEDIA_ROOT fehlt oder ist ungültig",
                });
            this.log.warn(
                {},
                "kartenvorschlag: Aufbewahrung nicht gelaufen (ohne gültiges MEDIA_ROOT keine Ablage für die Dateien)",
            );
            return true;
        }
        try {
            const lauf = await kartenvorschlagAufbewahrung(this.database, ablage, this.kartenvorschlagOriginal);
            const result = { ...ergebnisVon(lauf), original: originalErgebnisVon(lauf.original) };
            if (lauf.fehlgeschlagen === 0 && lauf.original.fehlgeschlagen === 0) {
                if (ref !== null)
                    await recorder.finish(ref, KARTENVORSCHLAG_RETENTION_KIND, { ok: true, result: { ...result } });
                this.log.info({ ...result }, "kartenvorschlag: Aufbewahrung gelaufen");
            } else {
                const codes = [...new Set([...lauf.codes, ...lauf.original.codes])];
                if (ref !== null)
                    await recorder.finish(ref, KARTENVORSCHLAG_RETENTION_KIND, {
                        ok: false,
                        errorCode: "kartenvorschlag_retention_files_failed",
                        errorSummary: `${String(lauf.fehlgeschlagen)} von ${String(lauf.schluessel)} Dateien nicht gelöscht, ${String(lauf.original.fehlgeschlagen)} Fehler bei den Originalen (${codes.slice(0, 3).join(", ")})`,
                        result: { ...result },
                    });
                this.log.warn(
                    { ...result, codes, offen: [...lauf.offen, ...lauf.original.offen].slice(0, 50) },
                    "kartenvorschlag: Aufbewahrung gelaufen, Dateien nicht gelöscht (Schreibrecht an der Ablage?)",
                );
            }
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (ref !== null)
                await recorder.finish(ref, KARTENVORSCHLAG_RETENTION_KIND, {
                    ok: false,
                    errorCode: "kartenvorschlag_retention_failed",
                    errorSummary: `SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
                });
            this.log.warn(
                { err: error },
                "kartenvorschlag: Aufbewahrung gescheitert (Recht der Jobs-Rolle an kartenvorschlag_aufbewahren? avesmaps3d-db-grants gelaufen?)",
            );
        }
        return true;
    }

    /**
     * Die Aufbewahrung der Anmeldedaten (WI-0120 A12, AUTH-0001 §5) als aufgezeichneter Job `auth_retention`: auf der Statusseite zu
     * sehen und in der Queue aufgezeichnet (Claudio 2026-10-09), ohne Kindprozess, denn sie ist ein einziger Aufruf.
     *
     * Ohne Migration 0082 (eine Instanz vor der Anmeldung) gibt es nichts zu tun. Fehlt der Jobs-Rolle das Recht, steht der Job als
     * gescheitert da, statt still zu schweigen. Das Aufzeichnen ist Beiwerk (`JobRecorder`): Scheitert es, wird trotzdem aufgeräumt.
     * 🪤 Scheitert es, steht auch kein Lauf in der Tafel: Dann versucht es die nächste Pflege wieder, nicht erst nach einem Tag.
     */
    private async authRetention(): Promise<boolean> {
        if (!(await this.faellig(AUTH_RETENTION_KIND, this.authRetentionEveryMs))) return false;
        if (!(await authRetentionReady(this.database))) return false;
        const recorder = this.recorder("auth");
        const started = await recorder.start(AUTH_RETENTION_KIND);
        const ref = started === null ? null : { publicId: started.publicId };
        try {
            const result = await purgeExpiredAuth(this.database);
            if (ref !== null) await recorder.finish(ref, AUTH_RETENTION_KIND, { ok: true, result: { ...result } });
            this.log.info({ ...result }, "auth: Aufbewahrung gelaufen");
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            // Nur der SQLSTATE geht auf die Statusseite, nie der Text der Meldung.
            if (ref !== null)
                await recorder.finish(ref, AUTH_RETENTION_KIND, {
                    ok: false,
                    errorCode: "auth_retention_failed",
                    errorSummary: `SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
                });
            this.log.warn({ err: error }, "auth: Aufbewahrung gescheitert (Recht der Jobs-Rolle an purge_expired?)");
        }
        return true;
    }

    private recorder(prefix: string): JobRecorder {
        return new JobRecorder({
            database: this.database,
            config: this.config,
            mapDomainId: this.mapDomainId,
            instanceId: `recorder:${this.instanceId}`,
            release: this.release,
            warn: (message) => this.log.warn({}, `${prefix}: ${message}`),
        });
    }

    // --- Halt der Editor-Jobs (WI-0127 SYS-4) -------------------------------------------------------------------

    private async readFreeze(): Promise<EditorFreeze> {
        const freeze = await readEditorFreeze(this.database);
        if (freeze.cause !== this.freezeCause) {
            this.freezeCause = freeze.cause;
            if (freeze.cause === null) this.log.info({}, "jobs: Editor-Jobs wieder frei");
            else
                this.log.warn(
                    { cause: freeze.cause },
                    "jobs: Editor-Jobs unter Halt (Kartensperre, eingeschränkter Betrieb oder Zustand unbekannt); Importe laufen weiter",
                );
        }
        return freeze;
    }

    /**
     * Ein laufender Editor-Job unter Kartensperre oder im eingeschränkten Betrieb (SYS-0001 §3.3, Claudio 2026-10-09 Punkt 5): Er
     * rechnet bis `drainMaxS` nach Beginn des Halts zu Ende. Läuft er dann noch, hält er wie beim Ablösen an der nächsten Phasengrenze
     * an und geht ohne Versuchszähler zurück in die Queue (`handed_off`, JOBS-0001 MS12), wo er auf das Lösen wartet. Nichts bricht ab.
     * Ein unbekannter Zustand hält nur Neues an, nie Laufendes.
     */
    private async checkFreeze(entry: Supervised): Promise<void> {
        if (entry.finalized || entry.lockStopSent) return;
        const freeze = await this.readFreeze();
        if (freeze.heldForS === null || freeze.heldForS < this.config.drainMaxS) return;
        if (entry.finalized || entry.lockStopSent) return;
        entry.lockStopSent = true;
        entry.child.send({ type: "stop" });
        this.log.warn(
            { job: entry.job.publicId, cause: freeze.cause, drainMaxS: this.config.drainMaxS },
            "jobs: Editor-Job läuft unter Sperre länger als drainMaxS, hält an der nächsten Phasengrenze an und wartet",
        );
    }

    // --- Beaufsichtigen ----------------------------------------------------------------------------------------

    private supervise(job: JobRow, spec: JobKindSpec, leaseS: number, holdsShared: boolean): Supervised {
        let resolveDone: () => void = () => undefined;
        const done = new Promise<void>((resolve) => {
            resolveDone = resolve;
        });
        const child = this.spawnChild({ env: spec.childEnv });
        const entry: Supervised = {
            job,
            spec,
            child,
            leaseNo: job.leaseNo,
            leaseS,
            startedAtMs: Date.now(),
            heartbeat: setInterval(() => void this.beat(entry), this.heartbeatMs),
            freezeTick: undefined,
            lastHeartbeatOkMs: Date.now(),
            holdsShared,
            usage: { rssMb: 0, rssPeakMb: 0, arrayBufferMb: 0, cpuMs: 0 },
            finalized: false,
            exited: false,
            beating: false,
            cancelSent: false,
            lockStopSent: false,
            flaggedSwap: false,
            swapInStartMb: this.memory()?.swapInMb ?? null,
            flaggedBudget: false,
            failure: null,
            chain: Promise.resolve(),
            resolveDone,
            done,
        };
        if (isEditorJob(job.actorRef, job.kind)) {
            entry.freezeTick = setInterval(() => {
                this.checkFreeze(entry).catch((error: unknown) => {
                    this.log.warn({ err: error, job: job.publicId }, "jobs: Halt der Editor-Jobs nicht gelesen");
                });
            }, this.tickMs);
        }
        this.children.set(job.id, entry);
        this.log.info(
            { job: job.publicId, kind: job.kind, attempt: job.attempt, pid: child.pid },
            "jobs: Job gestartet",
        );
        child.onMessage((message) => this.enqueue(entry, () => this.onMessage(entry, message)));
        child.onExit((code, signal) => {
            entry.exited = true;
            this.enqueue(entry, () => this.onExit(entry, code, signal));
        });
        child.send({
            type: "run",
            job: {
                id: job.id,
                publicId: job.publicId,
                kind: job.kind,
                kindVersion: job.kindVersion,
                input: job.inputRef,
                attempt: job.attempt,
                leaseNo: job.leaseNo,
                mapDomainId: job.mapDomainId,
            },
        });
        return entry;
    }

    private enqueue(entry: Supervised, work: () => Promise<void>): void {
        entry.chain = entry.chain.then(work).catch((error: unknown) => {
            this.log.error(
                { err: error, job: entry.job.publicId },
                "jobs: Meldung des Job-Prozesses nicht verarbeitet",
            );
        });
    }

    private async onMessage(entry: Supervised, message: ChildMessage): Promise<void> {
        if (entry.finalized) return;
        const { job } = entry;
        const wallMs = Date.now() - entry.startedAtMs;
        const rssPeakMb = this.peakRssMb(entry);
        switch (message.type) {
            case "usage":
                entry.usage = {
                    rssMb: message.rssMb,
                    rssPeakMb: Math.max(entry.usage.rssPeakMb, message.rssPeakMb),
                    arrayBufferMb: Math.max(entry.usage.arrayBufferMb, message.arrayBufferMb),
                    cpuMs: message.cpuMs,
                };
                return;
            case "phase": {
                // Jeder Schreibversuch des Aufsehers wird bei einem Deadlock (40P01) einmal wiederholt: Der Job-Prozess schreibt sein
                // Ereignis oft gleichzeitig mit seiner Phase (Stage 2026-10-23, Migration 0217); das Opfer darf keinen Abschluss verlieren.
                const ok = await retryOnDeadlock(this.database, () =>
                    setJobPhase(this.database, job.id, entry.leaseNo, {
                        phase: message.phase,
                        progress: message.progress,
                        finished: message.finished ?? null,
                        ...(message.restMs === undefined ? {} : { restMs: message.restMs }),
                    }),
                );
                if (!ok) await this.lostUnlessCommitted(entry, "fenced");
                return;
            }
            case "done":
                await this.finish(entry, async () => {
                    // Die letzte Phase endet mit dem Job: ihre Messung trägt nur diese Meldung.
                    if (message.finished) {
                        const finished = message.finished;
                        await retryOnDeadlock(this.database, () =>
                            setJobPhase(this.database, job.id, entry.leaseNo, {
                                phase: finished.name,
                                progress: 1,
                                finished,
                            }),
                        );
                    }
                    const measured = {
                        result: message.result,
                        wallMs,
                        cpuMs: message.cpuMs,
                        rssPeakMb: Math.max(rssPeakMb, message.rssPeakMb),
                        arrayBufferPeakMb: Math.max(entry.usage.arrayBufferMb, message.arrayBufferPeakMb),
                    };
                    // Hat sich der Job in der Transaktion seiner Veröffentlichung selbst abgeschlossen (WI-0125), bleibt nur die Messung.
                    const outcome = message.committed
                        ? await recordCompletionStats(this.database, job.id, entry.leaseNo, measured)
                        : await retryOnDeadlock(this.database, () =>
                              completeJob(this.database, job.id, entry.leaseNo, measured),
                          );
                    if (outcome === "fenced")
                        this.log.warn({ job: job.publicId }, "jobs: Ergebnis verworfen, Lease verloren");
                    else this.log.info({ job: job.publicId, wallMs }, "jobs: Job fertig");
                });
                return;
            case "error":
                await this.finish(entry, async () => {
                    const outcome = await retryOnDeadlock(this.database, () =>
                        failJob(this.database, job.id, entry.leaseNo, {
                            code: message.code,
                            summary: message.summary,
                            retryable: message.retryable,
                            wallMs,
                            rssPeakMb,
                        }),
                    );
                    this.log.warn({ job: job.publicId, code: message.code, outcome }, "jobs: Job gescheitert");
                });
                return;
            case "cancelled":
                await this.finish(entry, async () => {
                    await retryOnDeadlock(this.database, () => finishCancelled(this.database, job.id, entry.leaseNo));
                    this.log.info({ job: job.publicId }, "jobs: Job abgebrochen");
                });
                return;
            case "stopped":
                await this.finish(entry, async () => {
                    await retryOnDeadlock(this.database, () => handOffJob(this.database, job.id, entry.leaseNo));
                    this.log.info(
                        { job: job.publicId },
                        entry.lockStopSent
                            ? "jobs: Job zurückgegeben (Sperre), wartet auf ihr Lösen"
                            : "jobs: Job zurückgegeben (Ablösen)",
                    );
                });
                return;
        }
    }

    /** Der Job-Prozess ist ohne Abschlussmeldung gestorben: wiederholbar (toter Prozess), bis die Versuche aufgebraucht sind. */
    private async onExit(entry: Supervised, code: number | null, signal: string | null): Promise<void> {
        if (entry.finalized) return;
        await this.finish(entry, async () => {
            const outcome = await retryOnDeadlock(this.database, () =>
                failJob(this.database, entry.job.id, entry.leaseNo, {
                    code: "process_died",
                    summary: `Der Job-Prozess endete unerwartet (Exit ${code === null ? "-" : String(code)}, Signal ${signal ?? "-"}).`,
                    retryable: true,
                    wallMs: Date.now() - entry.startedAtMs,
                    rssPeakMb: this.peakRssMb(entry),
                }),
            );
            this.log.warn({ job: entry.job.publicId, code, signal, outcome }, "jobs: Job-Prozess gestorben");
        });
    }

    /** Beendet die Aufsicht EINMAL: Takte aus, die Datenbank nachführen, die geteilte Sperre zurück. */
    private async finish(entry: Supervised, action: () => Promise<void>): Promise<void> {
        if (entry.finalized) return;
        entry.finalized = true;
        this.stopTicks(entry);
        try {
            await action();
        } catch (error) {
            // Die Datenbank ist nicht erreichbar: die Lease läuft ab, die Pflege sammelt den Job ein.
            entry.failure = "finish_not_written";
            this.log.error({ err: error, job: entry.job.publicId }, "jobs: Abschluss nicht geschrieben");
        } finally {
            await this.release_(entry);
        }
    }

    private stopTicks(entry: Supervised): void {
        clearInterval(entry.heartbeat);
        if (entry.freezeTick !== undefined) clearInterval(entry.freezeTick);
        entry.freezeTick = undefined;
    }

    private async release_(entry: Supervised): Promise<void> {
        if (entry.holdsShared) {
            entry.holdsShared = false;
            await this.locks.releaseShared();
        }
        if (this.children.get(entry.job.id) === entry) this.children.delete(entry.job.id);
        // Ein Prozess, der nach seiner Abschlussmeldung nicht von selbst endet, wird beendet.
        if (!entry.exited) {
            setTimeout(() => entry.child.kill("SIGKILL"), this.killGraceMs).unref();
        }
        entry.resolveDone();
    }

    /**
     * Wie `lost`, außer der Lauf hat sich in der Transaktion seiner Veröffentlichung selbst abgeschlossen (WI-0125, `dem_publish`): Dann
     * gehört die Zeile nicht einem anderen, sie ist fertig. Der Heartbeat endet, der Job-Prozess räumt noch auf und meldet `done` mit
     * `committed`; meldet er sich nicht binnen `stopGraceMs`, wird er beendet.
     */
    private async lostUnlessCommitted(entry: Supervised, reason: string): Promise<void> {
        if (entry.finalized) return;
        const committed = await isCommittedBy(this.database, entry.job.id, entry.leaseNo).catch(() => false);
        if (!committed) {
            this.lost(entry, reason);
            return;
        }
        this.stopTicks(entry);
        setTimeout(() => {
            if (!entry.finalized) this.lost(entry, "committed_without_done");
        }, this.stopGraceMs).unref();
    }

    /** Die Lease gehört nicht mehr diesem Läufer (anderer Claim, abgelaufen, keine Verbindung): beenden, nichts schreiben. */
    private lost(entry: Supervised, reason: string): void {
        if (entry.finalized) return;
        entry.finalized = true;
        if (reason === "lease_unreachable") entry.failure = "lease_unreachable";
        this.stopTicks(entry);
        this.log.warn({ job: entry.job.publicId, reason }, "jobs: Lease verloren, Job-Prozess wird beendet");
        entry.child.kill("SIGKILL");
        void this.release_(entry);
    }

    private peakRssMb(entry: Supervised): number {
        const read = entry.child.pid === undefined ? null : readProcessUsage(entry.child.pid);
        return Math.max(read?.rssPeakMb ?? 0, entry.usage.rssPeakMb);
    }

    /** Das Lebenszeichen des Aufsehers (nicht des Jobs): Lease verlängern, Spitzen eintragen, Befunde melden. */
    private async beat(entry: Supervised): Promise<void> {
        if (entry.finalized || entry.beating) return;
        entry.beating = true;
        try {
            const rssPeakMb = this.peakRssMb(entry);
            const memory: MemoryReading | null = this.memory();
            const result = await heartbeatJob(this.database, entry.job.id, entry.leaseNo, entry.leaseS, {
                rssMb: rssPeakMb > 0 ? rssPeakMb : null,
                arrayBufferMb: entry.usage.arrayBufferMb > 0 ? entry.usage.arrayBufferMb : null,
                cpuMs: entry.usage.cpuMs > 0 ? entry.usage.cpuMs : null,
                swapUsedMb: memory?.swapUsedMb ?? null,
            });
            if (!result.ok) {
                await this.lostUnlessCommitted(entry, "fenced");
                return;
            }
            entry.lastHeartbeatOkMs = Date.now();
            if (result.cancelRequested && !entry.cancelSent) {
                entry.cancelSent = true;
                entry.child.send({ type: "cancel" });
            }
            await this.reportFindings(entry, rssPeakMb, memory);
        } catch (error) {
            this.log.warn({ err: error, job: entry.job.publicId }, "jobs: Heartbeat gescheitert");
            // Kommt seit einer ganzen Lease kein Heartbeat durch, gehört der Job längst der Pflege: selbst beenden.
            if (Date.now() - entry.lastHeartbeatOkMs > entry.leaseS * 1000) this.lost(entry, "lease_unreachable");
        } finally {
            entry.beating = false;
        }
    }

    /** Befunde melden, nie anhalten: Swap über dem Rauschen und Spitze RSS über Erwartung oder Meldegrenze (je Befund einmal). */
    private async reportFindings(entry: Supervised, rssPeakMb: number, memory: MemoryReading | null): Promise<void> {
        const { job, spec } = entry;
        if (!entry.flaggedSwap) {
            const jetzt = memory?.swapInMb ?? null;
            const eingelagert = jetzt === null || entry.swapInStartMb === null ? null : jetzt - entry.swapInStartMb;
            const finding = swapFinding(
                eingelagert,
                (Date.now() - entry.startedAtMs) / 1000,
                this.config.swapNoiseMb,
                swapRateFor(this.config, job.kind),
            );
            if (finding) {
                entry.flaggedSwap = true;
                await addJobFinding(this.database, job.id, finding, entry.leaseNo);
            }
        }
        if (!entry.flaggedBudget) {
            const key = spec.memoryKey(job.inputRef, null);
            const finding = budgetFinding(
                rssPeakMb > 0 ? rssPeakMb : null,
                job.memExpectedMb,
                key === null ? undefined : this.config.memReportWarnMb[key],
            );
            if (finding) {
                entry.flaggedBudget = true;
                await addJobFinding(this.database, job.id, finding, entry.leaseNo);
            }
        }
    }

    // --- Beenden -----------------------------------------------------------------------------------------------

    /**
     * Der Ausführer wird abgelöst (SIGTERM, Ende des Scopes): kein neuer Claim; der laufende Job darf bis `drainMaxS` weiterlaufen.
     * Läuft er dann noch, hält er an der nächsten Phasengrenze an, und die Zeile geht OHNE Versuchszähler zurück nach `QUEUED`
     * (`handed_off`); der Dirigent startet ihn neu. Wer an der Grenze nicht anhält, wird beendet, seine Zeile geht trotzdem zurück.
     */
    async stop(drainMaxMs: number = this.config.drainMaxS * 1000): Promise<void> {
        this.draining = true;
        const waitFor = async (ms: number): Promise<void> => {
            const everything = Promise.all([...this.children.values()].map((entry) => entry.done));
            await Promise.race([everything, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())]);
        };
        await waitFor(drainMaxMs);
        if (this.children.size > 0) {
            for (const entry of this.children.values()) entry.child.send({ type: "stop" });
            await waitFor(this.stopGraceMs);
        }
        for (const entry of [...this.children.values()]) {
            entry.child.kill("SIGKILL");
            await this.finish(entry, async () => {
                await handOffJob(this.database, entry.job.id, entry.leaseNo);
            });
        }
        await this.locks.release();
    }
}
