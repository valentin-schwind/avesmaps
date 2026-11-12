/**
 * Eine gleitende Drossel im Speicher: höchstens `limit` Ereignisse je Schlüssel in `windowMs`.
 *
 * ⭐ Im Speicher, nicht in der Datenbank (WI-0034): Die Tabelle trägt keine IP. Ein Neustart vergisst
 * die Zählung; das ist hinnehmbar, denn davor steht die Drossel im vhost und dahinter das Tagesbudget.
 *
 * 🔴 Je Schlüssel hält die Drossel höchstens `limit` Zeitstempel (WI-0272 Review C1). Wer zählt, ohne vorher zu fragen
 * (eine Falle zählt jeden Treffer), baut sonst je Adresse eine Liste ohne Ende auf, die jeder Aufruf kopiert und filtert.
 * Das Kappen ändert die Antworten nicht: ob ein Schlüssel darf, entscheidet das älteste der letzten `limit` Ereignisse, und genau
 * diese bleiben stehen.
 */
export interface RateLimiter {
    /** Darf dieser Schlüssel jetzt noch ein Ereignis auslösen? */
    allows(key: string): boolean;
    /**
     * Ein Ereignis zählen. Eine Anfrage zählt SOFORT, wenn sie zugelassen wird (`allows` und `record` ohne `await` dazwischen), nicht erst,
     * wenn sie gelang: sonst gehen gleichzeitige Anfragen alle durch, denn jede sieht den alten Stand.
     */
    record(key: string): void;
    /** Wie viele Zeitstempel der Schlüssel gerade hält (höchstens `limit`); für Tests und die Diagnose des Speichers. */
    held(key: string): number;
}

/** Ab so vielen Schlüsseln werden abgelaufene beim nächsten Zählen verworfen, damit der Speicher nicht wächst. */
const SWEEP_AT = 10_000;

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
    const events = new Map<string, number[]>();
    const recent = (key: string, at: number): number[] => (events.get(key) ?? []).filter((t) => at - t < windowMs);

    return {
        allows(key) {
            return recent(key, now()).length < limit;
        },
        record(key) {
            const at = now();
            if (events.size >= SWEEP_AT) {
                for (const [other, times] of events) {
                    if (times.every((t) => at - t >= windowMs)) events.delete(other);
                }
            }
            // Die letzten `limit` Zeitstempel (der neue zuletzt): ältere ändern nie, wann der Schlüssel wieder darf.
            events.set(key, [...recent(key, at), at].slice(-limit));
        },
        held(key) {
            return events.get(key)?.length ?? 0;
        },
    };
}
