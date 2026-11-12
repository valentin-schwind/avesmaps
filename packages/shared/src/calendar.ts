/**
 * Der aventurische Kalender der Reise (WI-0038; Legacy `travel-calendar.php` und
 * `transport-season.php`, avesmaps@770c80e; MCS-024): zwölf Monate zu 30 Tagen, danach fünf
 * Namenlose Tage - 365 Tage im Jahr, 24 Stunden am Tag. Ein Datum ist der Tag im Jahr, 1 bis 365.
 */

/** Die Monate in ihrer Reihenfolge, mit Praios beginnt das Jahr. Die Schlüssel sind Legacys. */
export const CALENDAR_MONTHS = [
    "praios",
    "rondra",
    "efferd",
    "travia",
    "boron",
    "hesinde",
    "firun",
    "tsa",
    "phex",
    "peraine",
    "ingerimm",
    "rahja",
] as const;

export type CalendarMonth = (typeof CALENDAR_MONTHS)[number];

export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 365;

export const SEASONS = ["sommer", "herbst", "winter", "fruehling"] as const;
export type Season = (typeof SEASONS)[number];

/**
 * Wann ein Weg für ein Reisemittel gangbar ist, beide Enden eingeschlossen (`path.transport_seasons`).
 * Gespeichert ist die GANGBARKEIT, nicht die Sperre: Ein Fenster darf über den Jahreswechsel laufen
 * („Peraine bis Boron“), und die Namenlosen Tage liegen dann ohne Sonderfall darin.
 */
export interface SeasonWindow {
    from_month: string;
    from_day: number;
    to_month: string;
    to_day: number;
}

/** Ein Tag der Reise, so wie ihn der Reiseplan nennt. `month` ist leer an einem Namenlosen Tag. */
export interface CalendarDate {
    month: CalendarMonth | "";
    day: number;
    nameless: boolean;
    season: Season;
    /** Wie viele Jahreswechsel die Reise schon hinter sich hat. */
    years_passed: number;
}

const clampDay = (day: number): number => Math.min(DAYS_PER_MONTH, Math.max(1, Math.round(day)));

export function isCalendarMonth(value: string): value is CalendarMonth {
    return (CALENDAR_MONTHS as readonly string[]).includes(value);
}

/** Der Tag im Jahr zu Monat und Tag; der Tag wird auf 1 bis 30 geklemmt wie in Legacy. */
export function dayOfYear(month: CalendarMonth, day: number): number {
    return CALENDAR_MONTHS.indexOf(month) * DAYS_PER_MONTH + clampDay(day);
}

/**
 * Die Namenlosen Tage als Reisebeginn (Betreiber 2026-11-07, „Ja, auch dort“; bis dahin wie in Legacy kein Aufbruch): Vertrag,
 * Link und Systemsteuerung führen sie als dreizehnte Wahl `namenlos` mit den Tagen 1 bis 5.
 */
export const NAMELESS_MONTH = "namenlos";
export const NAMELESS_DAYS = 5;

/** Die Wahlen des Reisebeginns: die zwölf Monate, dann die Namenlosen Tage. */
export const DEPARTURE_MONTHS = [...CALENDAR_MONTHS, NAMELESS_MONTH] as const;

export type DepartureMonth = (typeof DEPARTURE_MONTHS)[number];

export function isDepartureMonth(value: string): value is DepartureMonth {
    return (DEPARTURE_MONTHS as readonly string[]).includes(value);
}

/** Der letzte Tag, an dem man in diesem „Monat“ aufbrechen kann: der 30., an den Namenlosen Tagen der 5. */
export function departureDays(month: DepartureMonth): number {
    return month === NAMELESS_MONTH ? NAMELESS_DAYS : DAYS_PER_MONTH;
}

/** Der Tag im Jahr eines Reisebeginns, 1 bis 365; der Tag wird geklemmt wie bei `dayOfYear`. */
export function departureDayOfYear(month: DepartureMonth, day: number): number {
    if (month !== NAMELESS_MONTH) return dayOfYear(month, day);
    return CALENDAR_MONTHS.length * DAYS_PER_MONTH + Math.min(NAMELESS_DAYS, clampDay(day));
}

/**
 * Die Jahreszeit eines Tages: Praios bis Efferd Sommer, Travia bis Hesinde Herbst, Firun bis Phex
 * Winter, Peraine bis Rahja Frühling. Die Namenlosen Tage erben den Frühling von Rahja (Legacy: eine
 * Setzung, keine Regel der Quelle).
 */
export function seasonOfDay(day: number): Season {
    const month = Math.min(CALENDAR_MONTHS.length - 1, Math.floor((day - 1) / DAYS_PER_MONTH));
    return SEASONS[Math.floor(month / 3)] as Season;
}

/**
 * Welcher Tag es ist, wenn seit dem Aufbruch am Tag `start` so viele Stunden vergangen sind. Gezählt
 * werden ganze Tage: Wer am 30. Rahja um Mitternacht ankommt, ist am 1. Namenlosen Tag.
 */
export function calendarDate(start: number, hours: number): CalendarDate {
    const elapsed = start - 1 + Math.floor(Math.max(0, hours) / 24 + 1e-9);
    const day = (elapsed % DAYS_PER_YEAR) + 1;
    const years = Math.floor(elapsed / DAYS_PER_YEAR);
    const nameless = day > CALENDAR_MONTHS.length * DAYS_PER_MONTH;
    return {
        month: nameless ? "" : (CALENDAR_MONTHS[Math.floor((day - 1) / DAYS_PER_MONTH)] as CalendarMonth),
        day: nameless ? day - CALENDAR_MONTHS.length * DAYS_PER_MONTH : ((day - 1) % DAYS_PER_MONTH) + 1,
        nameless,
        season: seasonOfDay(day),
        years_passed: years,
    };
}

/** Der Tag im Jahr, an dem eine Reise nach so vielen Stunden steht. */
export function dayAfter(start: number, hours: number): number {
    return ((start - 1 + Math.floor(Math.max(0, hours) / 24 + 1e-9)) % DAYS_PER_YEAR) + 1;
}

/** Die Grenzen eines Fensters als Tage im Jahr; null, wenn ein Monat unbekannt ist. */
export function windowDays(window: SeasonWindow): { from: number; to: number } | null {
    if (!isCalendarMonth(window.from_month) || !isCalendarMonth(window.to_month)) return null;
    return { from: dayOfYear(window.from_month, window.from_day), to: dayOfYear(window.to_month, window.to_day) };
}

/** Ist der Weg an diesem Tag gangbar? Ein Fenster über den Jahreswechsel schließt die Namenlosen Tage ein. */
export function windowContains(window: SeasonWindow, day: number): boolean {
    const bounds = windowDays(window);
    if (!bounds) return true;
    return bounds.from <= bounds.to ? day >= bounds.from && day <= bounds.to : day >= bounds.from || day <= bounds.to;
}
