import {
    JOB_MAX_RETRIES,
    JOBS_FINISHED_LIMIT,
    type JobAusloeser,
    type JobSummary,
    type QueuePauseView,
    type QueueEntry,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { dataLabel, formatDuration, secondsSince, secondsUntil } from "./format";
import { sammelSatz, umgebungOrt } from "./gemeinsam-view";
import { phaseName } from "./phase-name";

/**
 * Was eine Zeile der Queue sagt (JOBS-0001 5.2): die Sätze und Zahlen zu einem Job, aus dem Stand und der Serverzeit gerechnet.
 * Getrennt von der Komponente (`job-row.vue`), damit sie ohne Browser prüfbar sind: jeder Satz kommt aus den Sprachtafeln.
 *
 * 🔴 Der Zustand steht immer auch als Wort da, nie allein als Farbe. „Hängt“ ist kein gespeicherter Zustand, sondern abgeleitet
 * (`RUNNING` mit abgelaufener Lease), und eine unbekannte Zeit heißt „unbekannt“, nie eine geratene Zahl.
 */

export type JobLike = JobSummary | QueueEntry;

/**
 * Fertige und gescheiterte Aufträge in EINER zeitlichen Folge, neueste zuerst (Betreiber 2026-10-15: „mach die fehlgeschlagenen und die
 * "zuletzt fertig" in zeitlicher folge“). Der Server kappt jede Liste auf `grenze`. Nur hinter einer gekappten Liste kann etwas fehlen;
 * darum fällt weg, was älter ist als ihr ältester Eintrag. Ohne gekappte Liste bleibt alles, auch ein Fehlschlag, der älter ist als
 * alles Fertige (Sammellauf 14fb1eab: die Kappung auf die längere Liste nahm ihn weg).
 */
export function zeitlicheFolge(
    recent: readonly JobSummary[],
    failed: readonly JobSummary[],
    grenze = JOBS_FINISHED_LIMIT,
): JobSummary[] {
    const zeit = (job: JobSummary): number => (job.finishedAt === null ? 0 : Date.parse(job.finishedAt));
    const ab = Math.max(
        ...[recent, failed].map((liste) => (liste.length >= grenze ? Math.min(...liste.map(zeit)) : -Infinity)),
    );
    return [...recent, ...failed].filter((job) => zeit(job) >= ab).sort((a, b) => zeit(b) - zeit(a));
}

/** Der Zustand, wie die Seite ihn nennt. */
export function stateWord(job: JobLike): JobLike["state"] | "stalled" {
    return job.stalled ? "stalled" : job.state;
}

export function isRunning(job: JobLike): boolean {
    return job.state === "RUNNING" && !job.stalled;
}

/**
 * Die Phase als Satzteil. Hat sie einen Namen in den Sprachtafeln (`status.phase.<Jobart>.<Phase>`), steht der da („baut das
 * Release“); sonst der Rohwert mit dem Wort davor („Phase I11“). Die Schlüssel tragen die Jobart, weil dieselbe Phase in zwei
 * Arten zwei Dinge heißt: `proben` prüft bei der Auslieferung die Server, beim Abgleich die Daten.
 */
export function phaseText(kind: string, phase: string): string {
    return phaseName(kind, phase) ?? t("status.row.phase", { phase });
}

/** Die Meta-Zeile: kurze Angaben, mit „·“ getrennt, wie überall im Haus. */
export function metaParts(job: JobLike, nowMs: number): string[] {
    const parts: string[] = [];
    if (job.origin === "recorded") parts.push(t("status.origin.recorded"));
    if (job.phase) parts.push(phaseText(job.kind, job.phase));
    const sinceStart = secondsSince(job.startedAt, nowMs);
    if (job.state === "RUNNING" && sinceStart !== null)
        parts.push(t("status.row.since", { time: formatDuration(sinceStart) }));
    if (job.rssPeakMb !== null && job.state !== "QUEUED") {
        parts.push(
            job.memExpectedMb !== null && job.state === "RUNNING"
                ? t("status.row.rssExpected", {
                      mb: formatNumber(job.rssPeakMb, 0),
                      expected: formatNumber(job.memExpectedMb, 0),
                  })
                : t("status.row.rss", { mb: formatNumber(job.rssPeakMb, 0) }),
        );
    } else if (job.state === "QUEUED" && job.memExpectedMb !== null) {
        parts.push(t("status.row.expected", { mb: formatNumber(job.memExpectedMb, 0) }));
    }
    const sinceHeartbeat = secondsSince(job.heartbeatAt, nowMs);
    if (isRunning(job) && sinceHeartbeat !== null)
        parts.push(t("status.row.heartbeat", { time: formatDuration(sinceHeartbeat) }));
    // Ein erneut eingereihter Job nennt seinen nächsten Versuch im Satz zum Fehler (`reasonText`), nicht noch einmal hier.
    if (job.attempt > 1 && job.state !== "QUEUED") {
        parts.push(t("status.row.attempt", { n: job.attempt, max: job.maxAttempts }));
    }
    const finished = job.state === "SUCCEEDED" || job.state === "FAILED" || job.state === "CANCELLED";
    if (finished && job.wallMs !== null)
        parts.push(t("status.row.duration", { time: formatDuration(job.wallMs / 1000) }));
    const sinceFinished = secondsSince(job.finishedAt, nowMs);
    if (sinceFinished !== null) parts.push(t("status.row.finished", { time: formatDuration(sinceFinished) }));
    return parts;
}

/**
 * Warum dieser Job wartet.
 *
 * Ein wartender Job hat immer einen Satz: Steht kein Grund in der Zeile, wartet er auf den nächsten Takt des Planers. Ein
 * LAUFENDER Job sagt dagegen nur dann etwas, wenn er selbst einen Grund gemeldet hat — ein aufgezeichneter Ablauf, der auf
 * etwas außerhalb der Queue wartet (die Auslieferung hinter der Geländerechnung, WI-0143). Dessen Grund ist Freitext aus dem
 * Betrieb und steht ohne Schlüssel in der Zeile, wie ein Fehlersatz.
 */
export function waitText(job: JobLike, nowMs: number): string | null {
    if (job.state !== "QUEUED" && job.state !== "RUNNING") return null;
    if (job.waitReason === null) return job.state === "QUEUED" ? t("status.wait.none") : null;
    if (job.waitReason === "debouncing") return sammelSatz(job.notBefore, nowMs);
    return isMessageKey(`status.wait.${job.waitReason}`)
        ? dataLabel("status.wait", job.waitReason)
        : t("status.wait.free", { text: job.waitReason });
}

/** Die geschätzte Zeit eines wartenden Jobs; ohne bekannte Dauer „unbekannt“, nie eine geratene Zahl. */
export function estimateText(entry: QueueEntry, nowMs: number): string {
    const { startAt, durationP50S, durationP95S, basis } = entry.estimate;
    const parts: string[] = [];
    const until = secondsUntil(startAt, nowMs);
    parts.push(
        until === null
            ? t("status.estimate.startUnknown")
            : t("status.estimate.start", { time: formatDuration(until) }),
    );
    if (durationP50S !== null && durationP95S !== null) {
        parts.push(
            Math.round(durationP50S) === Math.round(durationP95S)
                ? t("status.estimate.duration", { time: formatDuration(durationP50S) })
                : t("status.estimate.range", { from: formatDuration(durationP50S), to: formatDuration(durationP95S) }),
        );
    }
    parts.push(dataLabel("status.estimate.basis", basis));
    return parts.join(" · ");
}

/**
 * Wer den Auftrag ausgelöst hat, als Satzanfang (WI-0293): „Ausgelöst von Vali“, „Ausgelöst an der Kommandozeile“, „Automatisch
 * ausgelöst“. Ohne Namen (ein Auftrag der anderen Umgebung, ein aufgelöstes Konto) „Ausgelöst von einer Person“; ohne jede Angabe
 * (ein älterer Server) „Auslöser unbekannt“, nie geraten.
 */
export function ausloeserText(ausgeloest: JobAusloeser | undefined): string {
    if (ausgeloest === undefined) return t("status.trigger.unbekannt");
    const { art, name } = ausgeloest;
    switch (art) {
        case "person":
            return name === null ? t("status.trigger.person") : t("status.trigger.von", { name });
        case "agent":
            return name === null ? t("status.trigger.agent") : t("status.trigger.von", { name });
        case "kommandozeile":
            return t("status.trigger.kommandozeile");
        case "automatik":
            return t("status.trigger.automatik");
        case "betrieb":
            return t("status.trigger.betrieb");
        default:
            return t("status.trigger.unbekannt");
    }
}

/**
 * Die ruhige Zeile „wer · wann · wo“ unter jedem Auftrag (WI-0293; Betreiber 2026-11-09 zur Warteschlange: „Wer hat sie gestartet.
 * Wann. Wo (Stage oder Production)?“), gebaut wie die Zeile der Schätzung: „Ausgelöst von Vali · heute, 14:03 · auf Production“.
 *
 * - **Wann** ist das Einreihen (`queuedAt`), in der Form des Protokolls: heute und gestern mit Uhrzeit, davor mit Datum, in der Sprache
 *   der Seite (`relativeTime`, Art `zeitpunkt`).
 * - **Wo** ist die Umgebung, in deren Tafel der Auftrag steht. Die gemeinsame Reihe mischt Stage und Production (WI-0163), darum steht
 *   sie in jeder Zeile. Ohne Angabe (ein älterer Server) fällt der Teil weg.
 */
export function herkunftZeile(
    auftrag: { ausgeloest?: JobAusloeser | undefined; queuedAt: string },
    umgebung: string | null | undefined,
    nowMs: number,
): string {
    const teile = [ausloeserText(auftrag.ausgeloest)];
    const wann = relativeTime(new Date(auftrag.queuedAt), new Date(nowMs), locale.value, "zeitpunkt");
    if (wann !== "") teile.push(wann);
    if (umgebung !== null && umgebung !== undefined && umgebung !== "") teile.push(umgebungOrt(umgebung));
    return teile.join(" · ");
}

/** Was bei einem hängenden Job geschieht: erneut eingereiht, aufgebraucht oder (aufgezeichnet) die Meldung blieb aus. */
export function stalledText(job: JobLike, nowMs: number): string | null {
    if (!job.stalled) return null;
    const time = formatDuration(secondsSince(job.leaseExpiresAt, nowMs) ?? 0);
    if (job.origin === "recorded") return t("status.stalled.recorded", { time });
    return job.attempt <= JOB_MAX_RETRIES
        ? t("status.stalled.requeue", { time, n: job.attempt + 1, max: job.maxAttempts })
        : t("status.stalled.exhausted", { time });
}

/** Ein gescheiterter oder abgebrochener Job nennt den Grund im Klartext; ein erneut eingereihter seinen letzten Fehler. */
export function reasonText(job: JobLike): string | null {
    if (job.state === "FAILED") {
        return job.errorSummary
            ? `${job.errorCode ?? ""}: ${job.errorSummary}`
            : (job.errorCode ?? t("status.unknown"));
    }
    if (job.state === "CANCELLED") {
        // 🔴 Auch ein abgebrochener Job nennt seinen Satz, nicht nur die Marke (WI-0141, Claudio 2026-10-13): Der Abholer
        // schreibt bei `skipped` den Grund in `error_summary` (`job_sync_finish`), und `skipped` allein sagt niemandem,
        // warum Production unverändert blieb. Die Marke bleibt davor stehen, weil sie den Unterschied zwischen
        // „übersprungen" und „auf Verlangen abgebrochen" trägt.
        const marke = dataLabel("status.cancel", job.cancelReason ?? "operator");
        // 🪤 Die Marke ist ein ganzer Satz mit Punkt (`status.cancel.*`). Vor dem Grund fällt der Punkt weg, sonst stünde dort
        // „… überholt hat.: durch Wahl 18 überholt“ (WI-0154). Bis dahin fiel es nicht auf: `skipped` hat keinen Eintrag in der
        // Sprachtafel und kam als nackter Rohwert heraus.
        return job.errorSummary ? `${marke.replace(/\.$/u, "")}: ${job.errorSummary}` : marke;
    }
    if (job.state === "QUEUED" && job.errorCode && job.attempt > 0) {
        return t("status.requeued", { code: job.errorCode, n: job.attempt + 1, max: job.maxAttempts });
    }
    return null;
}

/** Befunde melden, sie halten nie an: je Befund ein Satz. */
export function findingTexts(job: JobLike): string[] {
    return job.findings.map((finding) => `${dataLabel("status.finding", finding.code)}: ${finding.detail}`);
}

export function progressPercent(job: JobLike): number | null {
    return job.progress === null ? null : Math.round(Math.min(1, Math.max(0, job.progress)) * 100);
}

/**
 * Der Hinweis oben im Reiter „Warteschlange“, wenn sie pausiert ist (WI-0160; Claudio: „In der Warteschlange steht oben ‚pausiert
 * seit … von …‘“): die Marke, dann der Satz mit Zeit, Person und Grund. `null`, wenn sie läuft.
 *
 * In der eigenen Sicht eines Editors fehlen Person und Grund (der Server gibt sie dort nicht heraus); dann bleibt „Pausiert seit
 * 4 Min.“ — immer noch die Antwort auf „warum läuft hier nichts“.
 *
 * Wurde in einer anderen Umgebung pausiert (WI-0163, `anderswo`), steht dort statt der Person die Umgebung: „Pausiert seit 4 min ·
 * auf der Stage“. Die Pause gilt dann trotzdem hier: Wirksam ist die jüngste Anweisung über alle Umgebungen.
 */
export function pauseSatz(pause: QueuePauseView, nowMs: number): { lead: string; satz: string } | null {
    if (!pause.paused) return null;
    const seit = secondsSince(pause.since, nowMs);
    const teile = [
        seit === null ? t("status.paused.sinceUnknown") : t("status.paused.since", { time: formatDuration(seit) }),
    ];
    const anderswo = pause.anderswo ?? null;
    if (anderswo !== null) teile.push(umgebungOrt(anderswo));
    else if (pause.by !== null) teile.push(t("status.paused.by", { name: pause.by }));
    if (pause.reason !== null && pause.reason !== "") teile.push(t("status.paused.reason", { text: pause.reason }));
    return { lead: t("status.paused.lead"), satz: teile.join(" · ") };
}
