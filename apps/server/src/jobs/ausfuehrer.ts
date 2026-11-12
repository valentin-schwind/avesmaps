import { parseArgs } from "node:util";
import { AVENTURIA, getJobsConfig, type JobsConfig } from "@avesmaps3d/shared";
import { abgleicheModes, skippedJobKinds } from "../abgleiche/ausfuehrung.ts";
import { abrufAn } from "../community/mail/konfiguration.ts";
import { pflegeKanaele } from "../community/social/kanaele/stand.ts";
import { createDatabase, type Database } from "../database.ts";
import { originalOptionenAus } from "../kartenvorschlag/original-loeschen.ts";
import { MediaStore } from "../media/storage.ts";
import { ablageAus } from "../map-series/ablage.ts";
import type { AuthEnvironment } from "../auth/config.ts";
import { benachrichtigungUmgebung } from "./benachrichtigung-job.ts";
import type { ChildSpawner } from "./child-process.ts";
import { jobsProfileName } from "./profile.ts";
import { JobWorker, type AuftragErgebnis, type WorkerLogger } from "./worker.ts";

/**
 * Der Ausführer als Befehl (WI-0163 §5.2): `auftrag-cli --job <id> [--art <art>]` führt genau einen Auftrag dieser Umgebung aus,
 * `auftrag-cli --pflege` räumt ihre Tafel auf. Gestartet vom Dirigenten (`jobs/dirigent/`), auf dem VPS über Claudios Wrapper
 * `avesmaps3d-auftrag` als Dienstbenutzer der Umgebung, mit deren `.env` und in eigenem Scope; lokal von ihm selbst.
 *
 * Umgebung: `JOBS_DATABASE_URL` (die Jobs-Rolle `avesmaps3d_<env>_jobs`), sonst `DATABASE_URL`; `JOBS_PROFILE`; `JOBS_DOMAIN`;
 * `JOBS_INSTANCE`; `RELEASE_ID`; `MEDIA_ROOT` (die Ablage der Kanalbilder für die Pflege); `ABGLEICHE` (Aufträge der Abgleiche ohne
 * `worker` führt diese Umgebung nicht selbst aus, `abgleiche/ausfuehrung.ts`).
 *
 * 🔴 Die Exitcodes sind der Vertrag mit Dirigent und Wrapper; der Wrapper gibt sie für Korridor-Arten ebenso zurück.
 */

/** Die Exitcodes (WI-0163 §5.2). */
export const AUFTRAG_EXIT = {
    /** Erledigt, oder nichts (mehr) zu tun: schon übernommen, abgebrochen, nicht mehr wartend. */
    ok: 0,
    /** Technischer Fehler: Datenbank weg, Ende nicht geschrieben, Umgebung unvollständig. */
    fehler: 1,
    /** Aufruffehler: unbekannte oder fehlende Angaben. */
    aufruf: 2,
    /** Die Ausführung fehlt in dieser Umgebung (Art oder Fassung unbekannt, hier nicht auszuführen). */
    ausfuehrungFehlt: 3,
    /** Vorübergehend nicht (die geteilte Sperre der Domäne hält ein Zug): später erneut, wie `EX_TEMPFAIL`. */
    voruebergehend: 75,
    /**
     * Das Speichertor des Wrappers auf dem VPS (`avesmaps3d-auftrag`, Claudio): `MemAvailable` reicht für diese Art gerade nicht,
     * vor dem Übernehmen geprüft. Der Ausführer selbst gibt diesen Code nie; der Dirigent versucht es eine Minute später.
     */
    speichertor: 76,
} as const;

export function auftragExitCode(ergebnis: AuftragErgebnis): number {
    switch (ergebnis.ergebnis) {
        case "erledigt":
        case "nichts_zu_tun":
            return AUFTRAG_EXIT.ok;
        case "ausfuehrung_fehlt":
            return AUFTRAG_EXIT.ausfuehrungFehlt;
        case "voruebergehend":
            return AUFTRAG_EXIT.voruebergehend;
        case "technischer_fehler":
            return AUFTRAG_EXIT.fehler;
    }
}

const USAGE = `auftrag-cli (--job <id> [--art <art>] | --pflege)

  --job <id>    den wartenden Auftrag mit dieser Kennung (Tafel job dieser Umgebung) ausführen
  --art <art>   die Art, die der Dirigent gesehen hat; weicht die Zeile ab, Exit 3
  --pflege      abgelaufene Leases einsammeln, aufräumen, die täglichen Aufbewahrungen

Exit: 0 erledigt oder nichts zu tun, 2 Aufruffehler, 3 Ausführung fehlt, 75 vorübergehend nicht, sonst technischer Fehler.
Umgebung: JOBS_DATABASE_URL oder DATABASE_URL, JOBS_PROFILE, JOBS_DOMAIN, JOBS_INSTANCE, RELEASE_ID, MEDIA_ROOT, ABGLEICHE.`;

const ART_PATTERN = /^[a-z][a-z0-9_]{0,39}$/u;

type Aufruf = { was: "job"; jobId: number; art: string | undefined } | { was: "pflege" } | { was: "hilfe" };

function leseAufruf(argv: readonly string[]): Aufruf | string {
    let parsed;
    try {
        parsed = parseArgs({
            args: [...argv],
            options: {
                job: { type: "string" },
                art: { type: "string" },
                pflege: { type: "boolean" },
                help: { type: "boolean" },
            },
            strict: true,
            allowPositionals: false,
        });
    } catch (error) {
        return (error as Error).message;
    }
    const { job, art, pflege, help } = parsed.values;
    if (help === true) return { was: "hilfe" };
    if (pflege === true) {
        if (job !== undefined || art !== undefined) return "--pflege steht allein";
        return { was: "pflege" };
    }
    if (job === undefined) return "--job <id> oder --pflege fehlt";
    if (!/^[1-9][0-9]{0,15}$/u.test(job) || !Number.isSafeInteger(Number(job))) return `--job ${job}: keine Kennung`;
    if (art !== undefined && !ART_PATTERN.test(art)) return `--art ${art}: keine Art`;
    return { was: "job", jobId: Number(job), art };
}

/** Logzeilen als JSON (wie der Worker), Verbindungszeichenketten geschwärzt. */
export function jsonLogger(out: (text: string) => void, err: (text: string) => void): WorkerLogger {
    const fields = (input: Record<string, unknown>): Record<string, unknown> => {
        const { err: error, ...rest } = input;
        return {
            ...rest,
            ...(error instanceof Error
                ? { error: error.name, detail: error.message.replace(/postgres(?:ql)?:\/\/\S+/giu, "<verbindung>") }
                : {}),
        };
    };
    const line = (level: string, input: Record<string, unknown>, message: string): string =>
        `${JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields(input) })}\n`;
    return {
        info: (input, message) => out(line("info", input, message)),
        warn: (input, message) => out(line("warn", input, message)),
        error: (input, message) => err(line("error", input, message)),
    };
}

export interface AuftragDeps {
    log: WorkerLogger;
    /** Für Tests: eine fertige Verbindung statt der aus der Umgebung (sie bleibt offen). */
    database?: Database;
    /** Für Tests: kurze Takte und Fristen statt des Profils aus `JOBS_PROFILE`. */
    config?: JobsConfig;
    spawnChild?: ChildSpawner;
    /** SIGTERM und SIGINT: den laufenden Auftrag ablösen (Phasengrenze, ohne Versuchszähler zurück), dann Exit 0. */
    stop?: AbortSignal;
}

/** Führt den Befehl aus und gibt den Exitcode zurück; beendet nie selbst den Prozess. */
export async function runAuftragCli(
    argv: readonly string[],
    environment: NodeJS.ProcessEnv,
    deps: AuftragDeps,
): Promise<number> {
    const { log } = deps;
    const aufruf = leseAufruf(argv);
    if (typeof aufruf === "string") {
        log.error({ usage: USAGE }, `jobs auftrag: ${aufruf}`);
        return AUFTRAG_EXIT.aufruf;
    }
    if (aufruf.was === "hilfe") {
        log.info({ usage: USAGE }, "jobs auftrag: Hilfe");
        return AUFTRAG_EXIT.ok;
    }

    let ausgeschlossen: ReadonlySet<string>;
    try {
        ausgeschlossen = skippedJobKinds(abgleicheModes(environment));
    } catch (error) {
        log.error({ err: error }, "jobs auftrag: ABGLEICHE ungültig");
        return AUFTRAG_EXIT.fehler;
    }
    const url = environment["JOBS_DATABASE_URL"] ?? environment["DATABASE_URL"];
    if (deps.database === undefined && !url) {
        log.error({}, "jobs auftrag: weder JOBS_DATABASE_URL noch DATABASE_URL gesetzt");
        return AUFTRAG_EXIT.fehler;
    }
    const profile = jobsProfileName(environment);
    const config = deps.config ?? getJobsConfig(profile);
    // Zwei Verbindungen: die Sitzung der geteilten Sperre und eine für Abfragen. Die Jobs-Rolle hat höchstens `dbConnectionBudget`
    // (6), und neben einem schweren Auftrag laufen kleine.
    const database =
        deps.database ??
        createDatabase(url as string, {
            max: 2,
            timeouts: { statementMs: 30_000, lockMs: 5_000, idleInTransactionMs: 60_000 },
        });

    // Die Ablage für die Bilder des Kanals (`private/kanal/`) und für die Dateien gelöschter Reisebilder; ein relativer oder fehlender Pfad: keine.
    const mediaRoot = environment["MEDIA_ROOT"];
    let medienAblage: MediaStore | undefined;
    try {
        medienAblage = mediaRoot === undefined || mediaRoot === "" ? undefined : new MediaStore(mediaRoot);
    } catch {
        medienAblage = undefined;
    }

    // Kacheln und Quellen der Kartenserien (WI-0220 Schnitt 4): Ohne TILE_ROOT räumt der Papierkorb nur Zeilen, keine Dateien.
    const tileRoot = environment["TILE_ROOT"]?.trim() || undefined;

    // Die Glocke zur fertigen Folge (WI-0230) braucht die Umgebung; fehlt sie, meldet dieser Ausführer nichts, rechnet aber.
    let glockenUmgebung: AuthEnvironment | undefined;
    try {
        glockenUmgebung = benachrichtigungUmgebung(environment);
    } catch (error) {
        log.warn({ err: error }, "jobs auftrag: ohne Umgebung keine Glocke zur fertigen Folge");
    }

    const instance = environment["JOBS_INSTANCE"];
    const worker = new JobWorker({
        database,
        config,
        mapDomainId: environment["JOBS_DOMAIN"] ?? AVENTURIA.mapDomain,
        ...(instance ? { instanceId: instance } : {}),
        release: environment["RELEASE_ID"] ?? "dev",
        log,
        ...(deps.spawnChild === undefined ? {} : { spawnChild: deps.spawnChild }),
        // Die Aufbewahrungen einmal am Tag (WI-0120 A12, AUTH-0001 §5; WI-0124, KANAL-0001 §3.1); ohne MEDIA_ROOT bleiben Bilder
        // des Kanals vorgemerkt.
        authRetentionEveryMs: 24 * 3_600_000,
        kanalRetentionEveryMs: 24 * 3_600_000,
        communityRetentionEveryMs: 24 * 3_600_000,
        // Der Abruf des Community-Postfachs (WI-0268 C6b): alle fünf Minuten, aber nur, wenn die Umgebung ihn konfiguriert hat (sonst reiht die Pflege nie etwas ein).
        communityMailAbrufEveryMs: 5 * 60_000,
        communityMailAbrufAn: () => abrufAn(environment),
        // Die fremden Kanäle des Social Hubs (WI-0268 C12a und C12b): täglich im Lauf der Aufbewahrung die Grenzen von der Mastodon-Instanz lesen und den Zugang zu Facebook und Instagram prüfen (ein abgelaufener
        // Schlüssel fällt hier auf, nicht erst am nächsten Beitrag). Ohne Konfiguration (`COMMUNITY_SOCIAL_*`) geschieht nichts.
        socialKanalPflege: (db) => pflegeKanaele(db, environment),
        // Die Reisebilder (WI-0272): ohne Ablage läuft ihre Aufbewahrung nicht, sondern steht rot da (die Dateien blieben sonst ohne Zeile liegen).
        photoboxRetentionEveryMs: 24 * 3_600_000,
        // Die Kartenvorschläge (WI-0275 B2): dieselbe Ablage, derselbe Takt; ohne Ablage steht der Lauf rot da.
        kartenvorschlagRetentionEveryMs: 24 * 3_600_000,
        kartenvorschlagOriginal: originalOptionenAus(environment),
        ...(medienAblage === undefined
            ? {}
            : { kanalAblage: medienAblage, photoboxAblage: medienAblage, kartenvorschlagAblage: medienAblage }),
        kartenserienPapierkorbEveryMs: 24 * 3_600_000,
        // Der tägliche SVG-Abzug (WI-0280): nur, wenn sich die Karte geändert hat.
        kartenSvgEveryMs: 24 * 3_600_000,
        kartenserien: { tileRoot, ablage: ablageAus(environment, tileRoot) },
        ausgeschlosseneArten: ausgeschlossen,
        ...(glockenUmgebung === undefined ? {} : { glockenUmgebung }),
    });

    let stopping: Promise<void> | undefined;
    const onStop = (): void => {
        if (stopping !== undefined) return;
        log.info({ drainMaxS: config.drainMaxS }, "jobs auftrag: wird abgelöst");
        stopping = worker.stop().catch((error: unknown) => {
            log.error({ err: error }, "jobs auftrag: Ablösen gescheitert");
        });
    };
    if (deps.stop?.aborted) onStop();
    deps.stop?.addEventListener("abort", onStop, { once: true });

    try {
        if (aufruf.was === "pflege") {
            const bericht = await worker.pflege();
            log.info({ ...bericht }, "jobs auftrag: Pflege gelaufen");
            return AUFTRAG_EXIT.ok;
        }
        log.info(
            { profile, instance: worker.id, job: aufruf.jobId, art: aufruf.art ?? null },
            "jobs auftrag: gestartet",
        );
        const ergebnis = await worker.runOne(aufruf.jobId, aufruf.art === undefined ? {} : { art: aufruf.art });
        // Abgelöst heißt Exit 0: Die Zeile ist zurückgegeben (oder fertig), der Dirigent startet sie neu.
        const code = stopping === undefined ? auftragExitCode(ergebnis) : AUFTRAG_EXIT.ok;
        log.info({ job: aufruf.jobId, ...ergebnis, exit: code }, "jobs auftrag: Ergebnis");
        return code;
    } catch (error) {
        log.error({ err: error }, "jobs auftrag: technischer Fehler");
        return AUFTRAG_EXIT.fehler;
    } finally {
        deps.stop?.removeEventListener("abort", onStop);
        if (stopping !== undefined) await stopping;
        if (deps.database === undefined) await database.end({ timeout: 5 }).catch(() => undefined);
    }
}
