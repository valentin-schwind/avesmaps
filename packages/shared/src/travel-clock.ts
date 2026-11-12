/**
 * Die Uhr einer Reise (WI-0038, Entscheidung E1: EINE Uhr): Reisestunden und Rast in Legacys
 * Portionen (`avesmapsRouteRestCounter`, Owner 14.08.2026). Dieselbe Uhr prüft in der Suche die
 * Sperrfenster und gibt im Reiseplan die Daten je Etappe - so kann der Plan kein anderes Datum zeigen
 * als das, mit dem gesperrt wurde. Legacy rechnete beides getrennt, und die Uhren liefen über Wochen
 * um Tage auseinander (MCS-024, Widerspruch 1).
 *
 * - 💣 **Gezählt wird der Anteil des Tages, nicht die Stunde:** Vier Stunden Marsch (8-h-Tag) und
 *   sechs Stunden Segeln (12-h-Tag) sind ein voller Tag und schulden 0,5 × 16 + 0,5 × 12 = 14 Stunden.
 * - 💣 **Die Portion wird vor dem nächsten Stück gebucht, nie nach dem letzten:** Wer genau mit dem
 *   Reisetag ankommt, rastet nicht mehr.
 * - Der Schnellsegler auf See ist rastbefreit: Man schläft an Bord und kommt ausgeruht an.
 */
export interface TravelClock {
    /** Stunden seit dem Aufbruch, Reise und gebuchte Rast. */
    hours: number;
    /** Wie viel vom laufenden Reisetag verbraucht ist, 0 bis 1. */
    dayUsed: number;
    /** Die Rast, die der laufende Tag schon schuldet. */
    restOwed: number;
}

export const CLOCK_START: TravelClock = { hours: 0, dayUsed: 0, restOwed: 0 };

// Die Toleranz ist nicht kosmetisch: eine Grenze landet über Fließkomma-Subtraktionen auf
// 11,999999999999998 statt 12, und ohne sie fiele die Nacht aus.
const FULL = 1 - 1e-9;

/** Vor dem nächsten Stück: Ist der Reisetag voll, wird erst die geschuldete Rast gebucht. */
export function clockEnter(clock: TravelClock): TravelClock {
    return clock.dayUsed >= FULL ? { hours: clock.hours + clock.restOwed, dayUsed: 0, restOwed: 0 } : clock;
}

/**
 * Ein Stück Reise: die Uhr danach, die Rast, die UNTERWEGS fällig wurde, und wie viele Nächte das waren
 * (jede gebuchte Portion ist eine - die Reisekosten zählen sie, WI-0042). `includeRests` falsch heißt
 * ohne Rast (24 Reisestunden je Tag).
 */
export function clockTravel(
    clock: TravelClock,
    travelHours: number,
    dayHours: number,
    exempt: boolean,
    includeRests: boolean,
): { clock: TravelClock; rest: number; nights: number } {
    const hours = Number.isFinite(travelHours) && travelHours > 0 ? travelHours : 0;
    if (exempt) return { clock: { hours: clock.hours + hours, dayUsed: 0, restOwed: 0 }, rest: 0, nights: 0 };
    if (!includeRests) return { clock: { ...clock, hours: clock.hours + hours }, rest: 0, nights: 0 };
    const day = dayHours > 0 ? dayHours : 0.5;
    const portion = Math.max(24 - day, 0);
    let { dayUsed, restOwed } = clock;
    let rest = 0;
    let nights = 0;
    let remaining = hours;
    while (remaining > 1e-9) {
        if (dayUsed >= FULL) {
            rest += restOwed;
            nights += 1;
            dayUsed = 0;
            restOwed = 0;
        }
        const stretch = Math.min(remaining, (1 - dayUsed) * day);
        dayUsed += stretch / day;
        restOwed += (stretch / day) * portion;
        remaining -= stretch;
    }
    return { clock: { hours: clock.hours + hours + rest, dayUsed, restOwed }, rest, nights };
}
