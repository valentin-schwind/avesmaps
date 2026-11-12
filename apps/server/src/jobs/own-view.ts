import type { JobEventRecord, JobSummary } from "@avesmaps3d/shared";

/**
 * Was ein Editor von der Queue sieht (WI-0120 A11; JOBS-0001 D1 A und 5.2, Betreiber 2026-10-04): seine eigenen Jobs mit Position und
 * Wartezeit, bei einem Fehlschlag „nur der Klartext“. Befunde und Speicherwerte gehören dem Betrieb und fallen weg, ebenso der
 * Fehlercode; das Ergebnis eines eigenen Jobs (veröffentlichte Revisionen, geänderte Kacheln) bleibt.
 */
export function ownSummary<T extends JobSummary>(summary: T): T {
    return { ...summary, findings: [], rssPeakMb: null, memExpectedMb: null, swapSeenMb: null, errorCode: null };
}

/**
 * Ein Ereignis für eine Sicht, die nur eigene Jobs zeigt: Nummer, Zeit und Art, ohne Job, Domäne und Inhalt. Es weckt den Client,
 * der dann über HTTP neu lädt (und dort gefiltert bekommt); wer welchen Job hat, verrät es nicht.
 */
export function wakeupOf(event: JobEventRecord): JobEventRecord {
    return { seq: event.seq, at: event.at, kind: event.kind, jobId: null, mapDomainId: null, payload: {} };
}
