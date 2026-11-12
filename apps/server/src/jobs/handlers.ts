import { PROBE_MAX_BALLAST_MB } from "./kinds.ts";

/**
 * Was ein Job-Prozess rechnet (JOBS-0001 4.1): ein Handler je Jobart, aufgerufen im Kindprozess des Aufsehers. In Etappe 1 gibt es
 * `probe` und, seit WI-0063 MEDIA-M7, `media_derive`; die Gelände-Jobs kommen mit Etappe 2.
 *
 * Ein Handler meldet seine Phasen (`beginPhase`) und ruft an jeder Grenze `checkpoint()`: Dort kommt ein Abbruch an
 * (🔴 zwischen den Phasen, nie mittendrin) oder das Anhalten beim Umschalten des Slots. Die Veröffentlichung selbst ist eine
 * Transaktion und wird nie unterbrochen.
 */

/** Der Abbruch wurde an einer Phasengrenze angenommen. */
export class JobCancelled extends Error {
    constructor() {
        super("job cancelled");
        this.name = "JobCancelled";
    }
}

/** Der Slot wird abgelöst: der Job hält an der Phasengrenze an und geht zurück in die Queue (ohne Versuchszähler). */
export class JobStopped extends Error {
    constructor() {
        super("job stopped for handover");
        this.name = "JobStopped";
    }
}

/** Ein Fehler, dessen Wiederholbarkeit der Handler selbst kennt (Verbindungsverlust: ja, Eingabefehler: nein). */
export class JobFailure extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(code: string, message: string, retryable: boolean) {
        super(message);
        this.name = "JobFailure";
        this.code = code;
        this.retryable = retryable;
    }
}

export interface JobContext {
    input: Record<string, unknown>;
    /** Der wievielte Lauf dieses Jobs (1 = erster). */
    attempt: number;
    /** Kennung, öffentliche Kennung und Lease des Laufs (WI-0125: der Name des Kandidaten, das Fencing der Veröffentlichung). */
    job: { id: number; publicId: string; leaseNo: number | null; mapDomainId: string | null };
    /**
     * Beginnt eine Phase. Prüft vorher den Abbruch (wirft `JobCancelled` oder `JobStopped`). Derselbe Name noch einmal ist keine neue Phase, nur
     * ein neuer Fortschritt (die Messung der Phase läuft weiter). `restMs`: die Restzeit, die der Auftrag selbst kennt (WI-0248, der Release-Test);
     * `null` löscht sie, ohne die Angabe bleibt sie unberührt.
     */
    beginPhase(name: string, progress?: number | null, options?: { restMs?: number | null }): Promise<void>;
    /** Prüft an einer Grenze innerhalb einer Phase, ob abgebrochen oder angehalten werden soll. */
    checkpoint(): void;
}

/**
 * Das Ergebnis eines Jobs, der sich in der Transaktion seiner Veröffentlichung selbst abgeschlossen hat (`completeJob` mit `publish`,
 * WI-0125): Zeigerwechsel, `SUCCEEDED` und Ereignis in EINER Transaktion (JOBS-0001 4.9). Der Aufseher wechselt dann keinen Zustand
 * mehr und trägt nur die Messung nach.
 */
export class CommittedResult {
    readonly result: Record<string, unknown>;
    constructor(result: Record<string, unknown>) {
        this.result = result;
    }
}

export type JobHandler = (context: JobContext) => Promise<Record<string, unknown> | null | CommittedResult>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function numberOf(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface ProbePhase {
    name: string;
    ms: number;
}

/** Der Ballast wächst in Schritten von 256 MB (Messwerkzeug, Q6). */
export const PROBE_BALLAST_STEP_MB = 256;

function probePhases(input: Record<string, unknown>): ProbePhase[] {
    const raw = input["phases"];
    if (Array.isArray(raw) && raw.length > 0) {
        return raw.slice(0, 64).map((entry, index) => {
            const phase = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
            const name =
                typeof phase["name"] === "string" && phase["name"].length > 0
                    ? phase["name"].slice(0, 40)
                    : `phase-${String(index + 1)}`;
            return { name, ms: Math.min(Math.max(numberOf(phase["ms"]) ?? 0, 0), 600_000) };
        });
    }
    return [{ name: "sleep", ms: Math.min(Math.max(numberOf(input["sleepMs"]) ?? 100, 0), 600_000) }];
}

/**
 * Die Probe: schläft in Phasen, legt Speicherballast an, stürzt auf Wunsch ab. Selbsttest der Queue für die Tests und das
 * Messtor (JOBS-0001 6.0): Lease-Ablauf (Job-Prozess hart beenden), Fencing, Zulassung gegen Speicherballast.
 *
 * Eingabe (`input_ref`), alles optional:
 *   - `phases: [{ name, ms }]` oder `sleepMs`: wie lange sie schläft;
 *   - `ballastMb`: Speicher, der in Schritten von 256 MB angelegt und bis zum Ende gehalten wird (höchstens 4.096 MB);
 *   - `understateMb`: um so viel meldet die Probe ihre Erwartung zu niedrig (Test: Überschreitung wird Befund, nie Abbruch);
 *   - `crash: "exit" | "sigkill" | "throw"`, `crashPhase` (Index, Standard 0), `crashOnAttempts` (Läufe, Standard alle);
 *   - `blockMs`: blockiert den Hauptthread in der ersten Phase (der Heartbeat hängt nicht daran);
 *   - `failCode`, `failRetryable`: endet mit diesem Fehler.
 */
export const runProbe: JobHandler = async (context) => {
    const input = context.input;
    const phases = probePhases(input);
    const ballastMb = Math.min(Math.max(numberOf(input["ballastMb"]) ?? 0, 0), PROBE_MAX_BALLAST_MB);
    const crash = typeof input["crash"] === "string" ? input["crash"] : null;
    const crashPhase = numberOf(input["crashPhase"]) ?? 0;
    const crashOnAttempts = Array.isArray(input["crashOnAttempts"])
        ? input["crashOnAttempts"].filter((value): value is number => typeof value === "number")
        : [];
    const blockMs = Math.min(Math.max(numberOf(input["blockMs"]) ?? 0, 0), 60_000);
    const held: Buffer[] = [];

    for (const [index, phase] of phases.entries()) {
        await context.beginPhase(phase.name, index / phases.length);
        if (index === 0) {
            for (let allocated = 0; allocated < ballastMb; allocated += PROBE_BALLAST_STEP_MB) {
                const size = Math.min(PROBE_BALLAST_STEP_MB, ballastMb - allocated);
                // `fill` berührt jede Seite: erst dann steht der Speicher wirklich in der RSS.
                held.push(Buffer.alloc(size * 1024 * 1024, 1));
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            if (blockMs > 0) {
                const until = Date.now() + blockMs;
                while (Date.now() < until) {
                    // blockiert den Hauptthread absichtlich
                }
            }
        }
        if (
            crash !== null &&
            crashPhase === index &&
            (crashOnAttempts.length === 0 || crashOnAttempts.includes(context.attempt))
        ) {
            if (crash === "exit") process.exit(42);
            if (crash === "sigkill") process.kill(process.pid, "SIGKILL");
            throw new Error("Probe: gewollter Absturz");
        }
        if (phase.ms > 0) await sleep(phase.ms);
    }
    const failCode = typeof input["failCode"] === "string" ? input["failCode"] : null;
    if (failCode !== null) {
        throw new JobFailure(failCode, "Probe: gewollter Fehler", input["failRetryable"] === true);
    }
    // Der Ballast bleibt bis hierher in der Hand: erst jetzt darf er freigegeben werden.
    const heldMb = held.reduce((total, buffer) => total + buffer.length / 1024 / 1024, 0);
    held.length = 0;
    return { phases: phases.length, ballastMb: heldMb };
};

/**
 * Die Medienverarbeitung (`media-derive.ts`) wird erst beim ersten Auftrag geladen: sie zieht die native Bildbibliothek
 * (`sharp`, libvips) nach sich, und ein Job-Prozess für eine andere Art soll weder die Ladezeit noch den Speicher dafür zahlen.
 */
const runMediaDeriveLazily: JobHandler = async (context) => {
    const { runMediaDerive } = await import("./media-derive.ts");
    return runMediaDerive(context);
};

/** Der Abgleich eines Assets (WI-0068 P4a) lädt dieselbe Pipeline, also ebenso erst beim ersten Auftrag. */
const runMediaSettleLazily: JobHandler = async (context) => {
    const { runMediaSettle } = await import("./media-settle.ts");
    return runMediaSettle(context);
};

/** „Vorschau erzeugen“ (WI-0287 Punkt 5) lädt dieselbe Pipeline, also ebenso erst beim ersten Auftrag. */
const runKartenvorschauLazily: JobHandler = async (context) => {
    const { runKartenvorschauErzeugen } = await import("./kartenvorschau-job.ts");
    return runKartenvorschauErzeugen(context);
};

/** Die Gelände-Jobs (WI-0125) laden den Generator erst beim ersten Auftrag, aus demselben Grund. */
const runTerrainLocalLazily: JobHandler = async (context) => {
    const { runTerrainLocalJob } = await import("./terrain-local-job.ts");
    return runTerrainLocalJob(context);
};

const runDemPublishLazily: JobHandler = async (context) => {
    const { runDemPublishJob } = await import("./terrain-chain-jobs.ts");
    return runDemPublishJob(context);
};

const runDisplayHeightsLazily: JobHandler = async (context) => {
    const { runDisplayHeightsJob } = await import("./terrain-chain-jobs.ts");
    return runDisplayHeightsJob(context);
};

const runTerrainFullLazily: JobHandler = async (context) => {
    const { runTerrainFullJob } = await import("./terrain-chain-jobs.ts");
    return runTerrainFullJob(context);
};

/** Die Messung eines Entwurfs des Geländerezepts (WI-0127 SYS-13) lädt den Generator erst beim ersten Auftrag. */
const runTerrainPreviewLazily: JobHandler = async (context) => {
    const { runTerrainPreviewJob } = await import("./terrain-preview-job.ts");
    return runTerrainPreviewJob(context);
};

const runRoutingReloadLazily: JobHandler = async (context) => {
    const { runRoutingReloadJob } = await import("./routing-reload-job.ts");
    return runRoutingReloadJob(context);
};

/** Die Wegprofile nach einer Kartenoperation (WI-0128 E13). */
const runPathProfileLazily: JobHandler = async (context) => {
    const { runPathProfileJob } = await import("./path-profile-job.ts");
    return runPathProfileJob(context);
};

/** Die Folgen einer gespeicherten Landschaft (WI-0178 B3). */
const runLandSmoothLazily: JobHandler = async (context) => {
    const { runLandSmoothJob } = await import("./landschaft-folgen-job.ts");
    return runLandSmoothJob(context);
};

/** Die Ableitung der Herrschaftsgebiete (WI-0209 B3). */
const runTerritoryDeriveLazily: JobHandler = async (context) => {
    const { runTerritoryDeriveJob } = await import("./gebietsableitung-job.ts");
    return runTerritoryDeriveJob(context);
};

const runPathLabelRunsLazily: JobHandler = async (context) => {
    const { runPathLabelRunsJob } = await import("./weg-folgen-job.ts");
    return runPathLabelRunsJob(context);
};

const runSeaDeriveLazily: JobHandler = async (context) => {
    const { runSeaDeriveJob } = await import("./seegraph-job.ts");
    return runSeaDeriveJob(context);
};

/** Die Treffer der Sprachen (WI-0261 S4). */
const runSpracheTrefferLazily: JobHandler = async (context) => {
    const { runSpracheTrefferJob } = await import("./sprachen-treffer-job.ts");
    return runSpracheTrefferJob(context);
};

const runLabelRunsLazily: JobHandler = async (context) => {
    const { runLabelRunsJob } = await import("./landschaft-folgen-job.ts");
    return runLabelRunsJob(context);
};

/** Die Aufträge der Abgleiche (WI-0127 SYS-14) starten ein Werkzeug als eigenen Prozess; geladen erst beim ersten Auftrag. */
const runLegacyPullLazily: JobHandler = async (context) => {
    const { runLegacyPullJob } = await import("../abgleiche/job.ts");
    return runLegacyPullJob(context);
};

/** Der Zug EINER Kategorie (WI-0141); die Kategorie steht in der Eingabe des Auftrags. */
const runLegacyZugLazily: JobHandler = async (context) => {
    const { runLegacyZugJob } = await import("../abgleiche/job.ts");
    return runLegacyZugJob(context);
};

const runLegacyMediaLazily: JobHandler = async (context) => {
    const { runLegacyMediaJob } = await import("../abgleiche/job.ts");
    return runLegacyMediaJob(context);
};

/** Die Quarantäne der Mediendateien (WI-0127 SYS-10 b3). */
const runMediaQuarantineLazily: JobHandler = async (context) => {
    const { runMediaQuarantineJob } = await import("./media-quarantine-job.ts");
    return runMediaQuarantineJob(context);
};

/** „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17). */
const runMediaMergeAllLazily: JobHandler = async (context) => {
    const { runMediaMergeAllJob } = await import("./media-merge-all-job.ts");
    return runMediaMergeAllJob(context);
};

/** Ein Bildschirmfoto des Betreiber-Kanals (WI-0124 K4) lädt dieselbe Pipeline wie die Medien, also erst beim ersten Auftrag. */
const runKanalBildLazily: JobHandler = async (context) => {
    const { runKanalBild } = await import("../kanal/bild-job.ts");
    return runKanalBild(context);
};

/** Die Vektorkarte zeichnen (WI-0280): erst beim ersten Auftrag. */
const runKartenSvgLazily: JobHandler = async (context) => {
    const { runKartenSvg } = await import("./karten-svg-job.ts");
    return runKartenSvg(context);
};

/** Eine Kartenserie zerlegen (WI-0220 Schnitt 3) zieht `sharp` nach sich, also erst beim ersten Auftrag. */
const runMapSeriesTileLazily: JobHandler = async (context) => {
    const { runMapSeriesTile } = await import("./map-series-tile-job.ts");
    return runMapSeriesTile(context);
};

/** Eine Meldung in der Glocke dieser Umgebung (WI-0163): ein Aufruf von `benachrichtige`. */
const runBenachrichtigungLazily: JobHandler = async (context) => {
    const { runBenachrichtigungJob } = await import("./benachrichtigung-job.ts");
    return runBenachrichtigungJob(context);
};

/** Eine ausgehende Mail der Community senden (WI-0268 C6a): zieht nodemailer nach sich, also erst beim ersten Auftrag. */
const runCommunityMailVersandLazily: JobHandler = async (context) => {
    const { runCommunityMailVersandJob } = await import("./community-mail-job.ts");
    return runCommunityMailVersandJob(context);
};

/** Einen Beitrag an einen fremden Kanal senden oder dort zurücknehmen (WI-0268 C12a): erst beim ersten Auftrag geladen. */
const runSocialSendenLazily: JobHandler = async (context) => {
    const { runSocialSendenJob } = await import("./social-senden-job.ts");
    return runSocialSendenJob(context);
};

/** Das Postfach der Community lesend abholen (WI-0268 C6b): zieht imapflow, mailparser, sanitize-html und sharp nach sich, also erst beim ersten Auftrag. */
const runCommunityMailAbrufLazily: JobHandler = async (context) => {
    const { runCommunityMailAbrufJob } = await import("./community-mail-abruf-job.ts");
    return runCommunityMailAbrufJob(context);
};

/** Das lesende Fundament des WikiSync (WI-0253 B-1): Dump einlesen und Vorschau, geladen erst beim ersten Auftrag. */
const runWikiDumpEinlesenLazily: JobHandler = async (context) => {
    const { runWikiDumpEinlesenJob } = await import("./wiki-dump-jobs.ts");
    return runWikiDumpEinlesenJob(context);
};

const runWikiVorschauLazily: JobHandler = async (context) => {
    const { runWikiVorschauJob } = await import("./wiki-dump-jobs.ts");
    return runWikiVorschauJob(context);
};

/** Der Vergleich eines einzelnen Wiki-Artikels (WI-0253 D-2): eine Anfrage im Takt, leicht; geladen erst beim ersten Auftrag. */
const runWikiArtikelLazily: JobHandler = async (context) => {
    const { runWikiArtikelJob } = await import("./wiki-artikel-job.ts");
    return runWikiArtikelJob(context);
};

/** Die Übernahme und die Rücknahme des WikiSync (WI-0253 D-1): schwer, schreiben die Karte; geladen erst beim ersten Auftrag. */
const runWikiUebernehmenLazily: JobHandler = async (context) => {
    const { runWikiUebernehmenJob } = await import("./wiki-uebernahme-jobs.ts");
    return runWikiUebernehmenJob(context);
};

const runWikiZuruecknehmenLazily: JobHandler = async (context) => {
    const { runWikiZuruecknehmenJob } = await import("./wiki-uebernahme-jobs.ts");
    return runWikiZuruecknehmenJob(context);
};

/** Der Release-Test des Entwicklungsrechners (WI-0248): ruft den Starter und folgt dem Runner, bis der Lauf endet. */
const runReleaseTestLazily: JobHandler = async (context) => {
    const { runReleaseTestJob } = await import("./release-test-job.ts");
    return runReleaseTestJob(context);
};

export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
    probe: runProbe,
    legacy_pull: runLegacyPullLazily,
    legacy_zug: runLegacyZugLazily,
    legacy_media: runLegacyMediaLazily,
    media_merge_all: runMediaMergeAllLazily,
    media_derive: runMediaDeriveLazily,
    media_settle: runMediaSettleLazily,
    citymap_preview_generate: runKartenvorschauLazily,
    terrain_local: runTerrainLocalLazily,
    dem_publish: runDemPublishLazily,
    display_heights: runDisplayHeightsLazily,
    terrain_full: runTerrainFullLazily,
    terrain_preview: runTerrainPreviewLazily,
    routing_reload: runRoutingReloadLazily,
    path_profile: runPathProfileLazily,
    land_smooth: runLandSmoothLazily,
    label_runs: runLabelRunsLazily,
    path_label_runs: runPathLabelRunsLazily,
    territory_derive: runTerritoryDeriveLazily,
    sea_derive: runSeaDeriveLazily,
    sprache_treffer: runSpracheTrefferLazily,
    media_quarantine: runMediaQuarantineLazily,
    kanal_bild: runKanalBildLazily,
    map_series_tile: runMapSeriesTileLazily,
    karten_svg: runKartenSvgLazily,
    benachrichtigung: runBenachrichtigungLazily,
    community_mail_versand: runCommunityMailVersandLazily,
    community_mail_abruf: runCommunityMailAbrufLazily,
    social_senden: runSocialSendenLazily,
    wiki_dump_einlesen: runWikiDumpEinlesenLazily,
    wiki_vorschau: runWikiVorschauLazily,
    wiki_artikel: runWikiArtikelLazily,
    wiki_uebernehmen: runWikiUebernehmenLazily,
    wiki_zuruecknehmen: runWikiZuruecknehmenLazily,
    release_test: runReleaseTestLazily,
};
