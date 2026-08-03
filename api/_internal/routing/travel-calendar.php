<?php

declare(strict_types=1);

/**
 * The Aventurian calendar, as far as a travel plan needs it: twelve months of thirty days each,
 * followed by the five Nameless Days -- 365 in total.
 *
 * Why this exists: a journey takes days to weeks, so the season belongs to the LEG, not to the
 * journey. Whoever departs in Firun may well arrive in Tsa. Everything here is pure arithmetic on
 * (month, day, hours) and has no database, no request and no state -- which is what makes it
 * testable without a server (`php -d zend.assertions=1 …/__tests__/travel-calendar-test.php`).
 *
 * 💣 THE CLIENT MIRRORS THIS FILE, IT DOES NOT REINVENT IT (js/routing/travel-calendar.js). Both
 * engines must produce the same date for the same leg, or the arrival jumps as soon as the user
 * flips the server/client switch -- the failure mode described in `routing-two-server-switches`.
 * The parity test walks the same cases through both.
 */

// Order is load-bearing: it IS the year. Praios opens it, Rahja closes it, the Nameless Days follow.
const AVESMAPS_TRAVEL_CALENDAR_MONTHS = [
    'praios', 'rondra', 'efferd',
    'travia', 'boron', 'hesinde',
    'firun', 'tsa', 'phex',
    'peraine', 'ingerimm', 'rahja',
];

const AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH = 30;
const AVESMAPS_TRAVEL_CALENDAR_NAMELESS_DAYS = 5;
const AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR = 365; // 12 * 30 + 5
const AVESMAPS_TRAVEL_CALENDAR_HOURS_PER_DAY = 24.0;

// The four seasons as the draft defines them (docs/…/2026-08-03-reisezeitpunkt-design.md §3).
const AVESMAPS_TRAVEL_CALENDAR_SEASONS = [
    'praios' => 'sommer', 'rondra' => 'sommer', 'efferd' => 'sommer',
    'travia' => 'herbst', 'boron' => 'herbst', 'hesinde' => 'herbst',
    'firun' => 'winter', 'tsa' => 'winter', 'phex' => 'winter',
    'peraine' => 'fruehling', 'ingerimm' => 'fruehling', 'rahja' => 'fruehling',
];

/**
 * Position of a month in the year, 0-based; null for anything that is not one of the twelve.
 */
function avesmapsTravelCalendarMonthIndex(?string $monthKey): ?int
{
    if ($monthKey === null) {
        return null;
    }
    $index = array_search(strtolower(trim($monthKey)), AVESMAPS_TRAVEL_CALENDAR_MONTHS, true);
    return $index === false ? null : (int) $index;
}

/**
 * (month, day) -> day of the year, 1..365. Null if the month is unknown.
 *
 * The day is clamped to 1..30 rather than refused: it arrives from a URL parameter, and a link that
 * says "31. Firun" should travel on the 30th instead of dropping the whole departure date.
 */
function avesmapsTravelCalendarDayOfYear(?string $monthKey, int $day): ?int
{
    $monthIndex = avesmapsTravelCalendarMonthIndex($monthKey);
    if ($monthIndex === null) {
        return null;
    }
    $clampedDay = max(1, min(AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH, $day));
    return $monthIndex * AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH + $clampedDay;
}

/**
 * Day of the year -> the date it names. Days 361..365 are the Nameless Days: they carry no month.
 *
 * The value wraps, so a journey may cross into the next year without the caller doing anything.
 */
function avesmapsTravelCalendarFromDayOfYear(int $dayOfYear): array
{
    $normalized = (($dayOfYear - 1) % AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR + AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR)
        % AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR; // 0..364, also for negative input
    $yearsPassed = (int) floor(($dayOfYear - 1) / AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR);
    $monthIndex = intdiv($normalized, AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH);

    if ($monthIndex >= count(AVESMAPS_TRAVEL_CALENDAR_MONTHS)) {
        // 💣 The five Nameless Days are NOT a thirteenth month. They have no name, they are not
        // selectable as a departure, and a caller that treats month_key as a string would silently
        // print an empty month -- `nameless` is the flag to ask.
        return [
            'month_key' => '',
            'day' => $normalized - count(AVESMAPS_TRAVEL_CALENDAR_MONTHS) * AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH + 1,
            'nameless' => true,
            'day_of_year' => $normalized + 1,
            'years_passed' => $yearsPassed,
            // They sit between Rahja and Praios and inherit the season of the month they grow out
            // of. A setting, not a rule from the source -- but a season they had none of would make
            // every ground lookup a special case.
            'season' => AVESMAPS_TRAVEL_CALENDAR_SEASONS['rahja'],
        ];
    }

    $monthKey = AVESMAPS_TRAVEL_CALENDAR_MONTHS[$monthIndex];
    return [
        'month_key' => $monthKey,
        'day' => $normalized % AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH + 1,
        'nameless' => false,
        'day_of_year' => $normalized + 1,
        'years_passed' => $yearsPassed,
        'season' => AVESMAPS_TRAVEL_CALENDAR_SEASONS[$monthKey],
    ];
}

/**
 * Departure + elapsed CALENDAR hours -> the date reached. Null if there is no departure month,
 * which is the "Ohne Jahreszeit" case and means: calculate as before.
 *
 * 💣 CALENDAR hours, not travel hours. A leg of 8 travel hours at 12 hours a day occupies 16 hours
 * of calendar. The route engine already knows both numbers per leg (`travel_time` + `rest_time`);
 * feeding it travel hours here would make every journey finish about twice as early as it does.
 */
function avesmapsTravelCalendarAdvance(?string $monthKey, int $day, float $calendarHours): ?array
{
    $startDayOfYear = avesmapsTravelCalendarDayOfYear($monthKey, $day);
    if ($startDayOfYear === null) {
        return null;
    }
    // Whole days only: a date is a day. The remainder rides along so a caller can tell "arrives on
    // the 3rd, early" from "arrives on the 3rd, late" without recomputing it.
    $elapsedDays = (int) floor(max(0.0, $calendarHours) / AVESMAPS_TRAVEL_CALENDAR_HOURS_PER_DAY);
    $result = avesmapsTravelCalendarFromDayOfYear($startDayOfYear + $elapsedDays);
    $result['hour_of_day'] = fmod(max(0.0, $calendarHours), AVESMAPS_TRAVEL_CALENDAR_HOURS_PER_DAY);
    $result['elapsed_days'] = $elapsedDays;
    return $result;
}

/**
 * The season of a month; empty string for an unknown one, so a caller can branch on it without
 * inventing a fifth season.
 */
function avesmapsTravelCalendarSeason(?string $monthKey): string
{
    $normalized = $monthKey === null ? '' : strtolower(trim($monthKey));
    return AVESMAPS_TRAVEL_CALENDAR_SEASONS[$normalized] ?? '';
}
