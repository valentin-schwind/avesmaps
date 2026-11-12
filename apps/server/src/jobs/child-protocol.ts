/**
 * Die Nachrichten zwischen dem Aufseher (dem Worker) und dem Job-Prozess (seinem Kind), JOBS-0001 4.1 und 4.6.
 *
 * 🔴 Der Aufseher schreibt in die Datenbank, der Job-Prozess meldet nur. Das hat zwei Gründe: Der Heartbeat hängt nicht an einem
 * blockierten Hauptthread des Jobs (ein rechnender Hauptthread blockiert seine eigenen Timer), und jeder schreibende Schritt
 * trägt die `lease_no` des Aufsehers (Fencing), die der Job-Prozess gar nicht kennen muss.
 */

/** Was der Aufseher dem Job-Prozess zu tun gibt. */
export interface RunSpec {
    id: number;
    publicId: string;
    kind: string;
    kindVersion: number;
    input: Record<string, unknown>;
    /** Der wievielte Lauf dieses Jobs (1 = erster). */
    attempt: number;
    /**
     * Die Lease dieses Laufs (WI-0125). Nur ein Job, der selbst veröffentlicht (`dem_publish`), braucht sie: Er sperrt seine Zeile in
     * der Transaktion des Zeigerwechsels und prüft sie dort (Fencing, JOBS-0001 4.6). Alles andere schreibt weiter der Aufseher.
     */
    leaseNo?: number;
    /** Die Kartendomäne des Jobs (WI-0125). */
    mapDomainId?: string;
}

export type ParentMessage =
    | { type: "run"; job: RunSpec }
    /** Abbruch angefordert: der Job endet an der nächsten Phasengrenze. */
    | { type: "cancel" }
    /** Der Slot wird abgelöst (Umschalten): an der nächsten Phasengrenze anhalten, der Job geht zurück in die Queue. */
    | { type: "stop" };

export interface PhaseReport {
    phase: string;
    progress: number | null;
    /** Die Phase, die gerade endete: Name, Walltime, CPU. */
    finished?: { name: string; wallMs: number; rssPeakMb: number; cpuMs: number } | null;
    /** Die Restzeit, die der Auftrag selbst kennt (ms); `null`: keine (mehr). Fehlt: der Auftrag meldet keine (WI-0248). */
    restMs?: number | null;
}

export type ChildMessage =
    | ({ type: "phase" } & PhaseReport)
    /** Die eigene Messung des Job-Prozesses (der Aufseher liest wo möglich zusätzlich `/proc`). */
    | { type: "usage"; rssMb: number; rssPeakMb: number; arrayBufferMb: number; cpuMs: number }
    | {
          type: "done";
          result: Record<string, unknown> | null;
          /**
           * Der Job hat sich in der Transaktion seiner Veröffentlichung selbst abgeschlossen (`SUCCEEDED`, WI-0125): Der Aufseher trägt
           * nur noch die Messung nach und wechselt keinen Zustand.
           */
          committed?: boolean;
          cpuMs: number;
          rssPeakMb: number;
          arrayBufferPeakMb: number;
          /** Die Messung der letzten Phase (sie endet mit dem Job, keine neue Phase meldet sie). */
          finished?: { name: string; wallMs: number; rssPeakMb: number; cpuMs: number } | null;
      }
    | { type: "error"; code: string; summary: string; retryable: boolean }
    | { type: "cancelled" }
    | { type: "stopped" };

/** Der Job-Prozess ist nur über das, was er ausdrücklich meldet, zu erreichen: eine Meldung ist ein flaches JSON. */
export function isChildMessage(value: unknown): value is ChildMessage {
    if (typeof value !== "object" || value === null) return false;
    const type = (value as { type?: unknown }).type;
    return (
        type === "phase" ||
        type === "usage" ||
        type === "done" ||
        type === "error" ||
        type === "cancelled" ||
        type === "stopped"
    );
}

/**
 * Klartext für die Statusseite: kein Stacktrace, kein Pfad, kein Geheimnis (4.2). Pfade und Verbindungsangaben werden
 * unkenntlich gemacht, der Rest gekürzt.
 */
export function sanitizeSummary(message: string, maxLength = 240): string {
    const cleaned = message
        .split("\n")[0]
        ?.replace(/[A-Za-z]:\\[^\s"']+/g, "<pfad>")
        .replace(/(?:\/[\w.-]+){2,}/g, "<pfad>")
        .replace(/postgres(?:ql)?:\/\/\S+/gi, "<verbindung>")
        .trim();
    const text = cleaned && cleaned.length > 0 ? cleaned : "unbekannter Fehler";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
