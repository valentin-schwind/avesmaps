<?php

declare(strict_types=1);

/**
 * When may a mode of transport use this way?
 *
 * ⭐ ONE QUESTION, NOT TWO. "Is the carriage allowed here" and "is the pass open today" are the same
 * question at two resolutions, so they live in one structure: `allowed_transports` says WHETHER,
 * `transport_seasons` says WHEN. Three states cover everything the Geographia states:
 *
 *   not ticked                  -> never          ("nicht für Karren", Raschtulsweg)
 *   ticked, no window           -> all year       (the ordinary way, and every way today)
 *   ticked, with a window       -> seasonal       ("gangbar Anfang Peraine bis Ende Boron")
 *
 * 💣 A MISSING WINDOW MEANS ALL YEAR, and that is what keeps this backwards compatible: all 5765
 * ways carry no window today, so every one of them answers exactly as it does now. Without a
 * departure date the question is not even asked -- `$dayOfYear === null` returns the plain
 * allowed-transport answer.
 *
 * The window is stored per transport, but it is EDITED per wiki way: a pass is a chain of segments
 * in our data (the Schattenpass has twelve, from Pfad to Gebirgspass), and a window entered on one
 * of them would leave eleven holes for the router to drive through.
 */

require_once __DIR__ . '/travel-calendar.php';

/**
 * A window is [from_month, from_day, to_month, to_day]; both ends are INCLUSIVE.
 * Returns null for anything that is not a usable window -- a caller then treats the transport as
 * open all year rather than guessing a season.
 */
function avesmapsSeasonWindowNormalize(mixed $window): ?array
{
    if (!is_array($window)) {
        return null;
    }
    $fromMonth = avesmapsTravelCalendarDayOfYear((string) ($window['from_month'] ?? ''), (int) ($window['from_day'] ?? 1));
    $toMonth = avesmapsTravelCalendarDayOfYear((string) ($window['to_month'] ?? ''), (int) ($window['to_day'] ?? 30));
    if ($fromMonth === null || $toMonth === null) {
        return null;
    }

    return [
        'from_month' => strtolower(trim((string) $window['from_month'])),
        'from_day' => max(1, min(AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH, (int) ($window['from_day'] ?? 1))),
        'to_month' => strtolower(trim((string) $window['to_month'])),
        'to_day' => max(1, min(AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH, (int) ($window['to_day'] ?? 30))),
        'from_day_of_year' => $fromMonth,
        'to_day_of_year' => $toMonth,
    ];
}

/**
 * Does a day of the year fall inside the window?
 *
 * 💣 THE WINDOW MAY WRAP, and most of them do: the source states GANGBARKEIT, and those windows run
 * across the turn of the year ("Peraine bis Boron" = day 271 through day 150). The closures do not
 * wrap -- which is exactly why storing the window and not the closure is the safer of the two.
 *
 * ⭐ The five Nameless Days need no special case. They are days 361..365 in the same numbering, so a
 * window that runs from Peraine into Boron contains them, and one that ends in Efferd does not --
 * which is precisely right for the Schattenpass, closed from Travia until the new year.
 */
function avesmapsSeasonWindowContainsDay(array $window, int $dayOfYear): bool
{
    $from = (int) ($window['from_day_of_year'] ?? 0);
    $to = (int) ($window['to_day_of_year'] ?? 0);
    if ($from <= 0 || $to <= 0) {
        return true;
    }
    if ($from <= $to) {
        return $dayOfYear >= $from && $dayOfYear <= $to;
    }

    return $dayOfYear >= $from || $dayOfYear <= $to;
}

/**
 * Reads the stored seasons of a way into normalized windows, keyed by transport. Entries that are
 * not usable are dropped, not defaulted -- a broken window must not invent a closure.
 */
function avesmapsSeasonWindowsFromProperties(mixed $seasons): array
{
    if (!is_array($seasons)) {
        return [];
    }
    $windows = [];
    foreach ($seasons as $transport => $window) {
        // Bewusst ohne avesmapsNormalizeSingleLine: das haengt an bootstrap.php, und diese Datei
        // soll rein rechnen -- ohne Konfiguration, ohne CORS, ohne mbstring. Ein Transportschluessel
        // ist ohnehin ASCII (`groupFoot`), und er muss gleich darauf in `allowed_transports`
        // wiedergefunden werden; ein Schluessel, den das Trimmen nicht rettet, faellt dort durch.
        $key = trim((string) $transport);
        $normalized = avesmapsSeasonWindowNormalize($window);
        if ($key !== '' && $normalized !== null) {
            $windows[$key] = $normalized;
        }
    }

    return $windows;
}

/**
 * THE question the router asks per edge: may `$transport` travel here on this day?
 *
 * @param list<string> $allowedTransports what the way admits at all
 * @param array        $windows           from avesmapsSeasonWindowsFromProperties()
 * @param int|null     $dayOfYear         null = no departure date -> season is not asked
 */
function avesmapsTransportOpenOn(array $allowedTransports, array $windows, string $transport, ?int $dayOfYear): bool
{
    if (!in_array($transport, $allowedTransports, true)) {
        return false;
    }
    if ($dayOfYear === null || !isset($windows[$transport])) {
        return true;
    }

    return avesmapsSeasonWindowContainsDay($windows[$transport], $dayOfYear);
}

/**
 * The WRITE side: what an editor submitted, reduced to what may be stored.
 *
 * Two rules, both deliberate:
 *   - a window is only kept for a transport the way actually admits. A window on an unticked mode is
 *     dead data that would come back to life the day someone ticks it,
 *   - a window that covers the whole year is dropped rather than stored. "All year" is the absence
 *     of a window, and storing it twice would give two answers to one question.
 *
 * @param list<string> $allowedTransports
 * @return array<string, array{from_month: string, from_day: int, to_month: string, to_day: int}>
 */
function avesmapsReadTransportSeasons(mixed $value, array $allowedTransports): array
{
    if (!is_array($value)) {
        return [];
    }
    $stored = [];
    foreach ($value as $transport => $window) {
        $key = trim((string) $transport);
        if ($key === '' || !in_array($key, $allowedTransports, true)) {
            continue;
        }
        $normalized = avesmapsSeasonWindowNormalize($window);
        if ($normalized === null) {
            continue;
        }
        $spansWholeYear = $normalized['from_day_of_year'] === 1
            && $normalized['to_day_of_year'] === AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR;
        if ($spansWholeYear) {
            continue;
        }
        $stored[$key] = [
            'from_month' => $normalized['from_month'],
            'from_day' => $normalized['from_day'],
            'to_month' => $normalized['to_month'],
            'to_day' => $normalized['to_day'],
        ];
    }

    return $stored;
}

/**
 * For the plan's explanation: the window that closed this way, or null if nothing did. A caller can
 * then say WHICH pass turned it around instead of silently routing elsewhere -- without that line
 * nobody notices the season acted at all.
 */
function avesmapsSeasonClosureFor(array $allowedTransports, array $windows, string $transport, ?int $dayOfYear): ?array
{
    if ($dayOfYear === null || !in_array($transport, $allowedTransports, true) || !isset($windows[$transport])) {
        return null;
    }
    $window = $windows[$transport];
    if (avesmapsSeasonWindowContainsDay($window, $dayOfYear)) {
        return null;
    }

    return [
        'transport' => $transport,
        'open_from' => ['month' => $window['from_month'], 'day' => $window['from_day']],
        'open_to' => ['month' => $window['to_month'], 'day' => $window['to_day']],
    ];
}
