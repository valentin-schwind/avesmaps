<?php

declare(strict_types=1);

// The Aventurian calendar behind the departure date: 12 x 30 + 5 Nameless Days.
//
// The two cases the instruction names by hand are the last two blocks: a departure on 28. Phex must
// run INTO Peraine (the season changes mid-route, which is the whole point of a calendar that walks
// along), and a departure on 28. Rahja must run THROUGH the Nameless Days.
//
// ⚠️ Run it with assertions on, or it proves nothing:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/travel-calendar-test.php

require_once __DIR__ . '/../travel-calendar.php';

$hours = static fn (float $days): float => $days * AVESMAPS_TRAVEL_CALENDAR_HOURS_PER_DAY;

// ============================================================ A. the year as such
assert(count(AVESMAPS_TRAVEL_CALENDAR_MONTHS) === 12, 'zwoelf Monate');
assert(
    12 * AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH + AVESMAPS_TRAVEL_CALENDAR_NAMELESS_DAYS
        === AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR,
    '12 x 30 + 5 = 365 -- die drei Konstanten duerfen nicht auseinanderlaufen'
);
assert(avesmapsTravelCalendarMonthIndex('praios') === 0, 'Praios eroeffnet das Jahr');
assert(avesmapsTravelCalendarMonthIndex('rahja') === 11, 'Rahja schliesst es');
assert(avesmapsTravelCalendarMonthIndex('namenlose') === null, 'die Namenlosen Tage sind kein Monat');
assert(avesmapsTravelCalendarMonthIndex(null) === null, 'kein Monat gewaehlt = kein Index');
assert(avesmapsTravelCalendarMonthIndex('FIRUN') === 6, 'Grossschreibung aus einem Link faellt nicht durch');

// Every day of the year must be reachable and unique -- a gap here would be a date that no journey
// can ever land on, and an overlap would be two dates that print the same.
$seen = [];
for ($dayOfYear = 1; $dayOfYear <= AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR; $dayOfYear++) {
    $date = avesmapsTravelCalendarFromDayOfYear($dayOfYear);
    $key = $date['nameless'] ? ('namenlos-' . $date['day']) : ($date['month_key'] . '-' . $date['day']);
    assert(!isset($seen[$key]), "Tag {$dayOfYear} ({$key}) kommt zweimal vor");
    $seen[$key] = true;
    assert($date['day'] >= 1, "Tag {$dayOfYear} hat einen Tag >= 1");
    assert($date['nameless'] || $date['day'] <= 30, "Tag {$dayOfYear} bleibt im Monat");
}
assert(count($seen) === 365, 'alle 365 Tage sind verschieden');

// ============================================================ B. round trip
foreach (AVESMAPS_TRAVEL_CALENDAR_MONTHS as $monthKey) {
    foreach ([1, 15, 30] as $day) {
        $dayOfYear = avesmapsTravelCalendarDayOfYear($monthKey, $day);
        $back = avesmapsTravelCalendarFromDayOfYear($dayOfYear);
        assert($back['month_key'] === $monthKey && $back['day'] === $day, "Rundreise {$day}. {$monthKey}");
    }
}
assert(avesmapsTravelCalendarDayOfYear('praios', 1) === 1, 'der 1. Praios ist der erste Tag des Jahres');
assert(avesmapsTravelCalendarDayOfYear('rahja', 30) === 360, 'der 30. Rahja ist der letzte Monatstag');
assert(avesmapsTravelCalendarDayOfYear('nichtvorhanden', 5) === null, 'ein erfundener Monat ergibt kein Datum');

// Ein Tag aus der Adresszeile wird geklemmt, nicht verworfen: „31. Firun" reist am 30.
assert(avesmapsTravelCalendarDayOfYear('firun', 31) === avesmapsTravelCalendarDayOfYear('firun', 30), 'Tag 31 wird auf 30 geklemmt');
assert(avesmapsTravelCalendarDayOfYear('firun', 0) === avesmapsTravelCalendarDayOfYear('firun', 1), 'Tag 0 wird auf 1 geklemmt');

// ============================================================ C. Jahreszeiten
assert(avesmapsTravelCalendarSeason('firun') === 'winter', 'Firun ist Winter');
assert(avesmapsTravelCalendarSeason('praios') === 'sommer', 'Praios ist Sommer');
assert(avesmapsTravelCalendarSeason('travia') === 'herbst', 'Travia ist Herbst');
assert(avesmapsTravelCalendarSeason('peraine') === 'fruehling', 'Peraine ist Fruehling');
assert(avesmapsTravelCalendarSeason('nichtvorhanden') === '', 'ein unbekannter Monat hat KEINE Jahreszeit -- keine fuenfte erfinden');
$seasonCounts = array_count_values(AVESMAPS_TRAVEL_CALENDAR_SEASONS);
assert(count($seasonCounts) === 4 && count(array_unique($seasonCounts)) === 1 && current($seasonCounts) === 3,
    'vier Jahreszeiten zu je drei Monaten');

// ============================================================ D. ohne Reisebeginn = wie bisher
assert(avesmapsTravelCalendarAdvance('', 1, $hours(5)) === null, 'ohne Monat kein Datum');
assert(avesmapsTravelCalendarAdvance(null, 1, $hours(5)) === null, 'null-Monat kein Datum');

// ============================================================ E. Kalenderstunden, nicht Reisestunden
$sameDay = avesmapsTravelCalendarAdvance('firun', 25, 23.9);
assert($sameDay['month_key'] === 'firun' && $sameDay['day'] === 25, 'unter 24 Kalenderstunden bleibt der Tag stehen');
$nextDay = avesmapsTravelCalendarAdvance('firun', 25, 24.0);
assert($nextDay['day'] === 26, 'genau 24 Kalenderstunden = ein Tag weiter');
assert(abs($nextDay['hour_of_day'] - 0.0) < 1e-9, 'die Uhrzeit faengt wieder bei 0 an');
$halfPast = avesmapsTravelCalendarAdvance('firun', 25, 30.0);
assert($halfPast['day'] === 26 && abs($halfPast['hour_of_day'] - 6.0) < 1e-9, 'der Rest der Stunden bleibt als Uhrzeit erhalten');
assert(avesmapsTravelCalendarAdvance('firun', 25, 0.0)['day'] === 25, 'null Stunden = Aufbruchstag');
assert(avesmapsTravelCalendarAdvance('firun', 25, -5.0)['day'] === 25, 'negative Stunden reisen nicht rueckwaerts');

// ============================================================ F. Aufbruch 28. Phex -> in den Peraine
// Der Fall aus der Instruction: der Abzug faellt MITTEN in der Route von Winter auf Fruehling.
$start = ['month_key' => 'phex', 'day' => 28];
$winterStill = avesmapsTravelCalendarAdvance('phex', 28, $hours(2));
assert($winterStill['month_key'] === 'phex' && $winterStill['day'] === 30, 'nach zwei Tagen ist es der 30. Phex');
assert($winterStill['season'] === 'winter', 'und noch Winter');
$springNow = avesmapsTravelCalendarAdvance('phex', 28, $hours(3));
assert($springNow['month_key'] === 'peraine' && $springNow['day'] === 1, 'ein Tag weiter beginnt der Peraine');
assert($springNow['season'] === 'fruehling', '💣 DIE JAHRESZEIT WECHSELT MITTEN IN DER ROUTE -- genau dafuer laeuft der Kalender mit');
assert($springNow['nameless'] === false, 'der Monatswechsel geht nicht durch die Namenlosen Tage');

// ============================================================ G. Aufbruch 28. Rahja -> durch die Namenlosen Tage
$stillRahja = avesmapsTravelCalendarAdvance('rahja', 28, $hours(2));
assert($stillRahja['month_key'] === 'rahja' && $stillRahja['day'] === 30 && !$stillRahja['nameless'], 'der 30. Rahja ist noch ein Monatstag');
$nameless = avesmapsTravelCalendarAdvance('rahja', 28, $hours(3));
assert($nameless['nameless'] === true, '💣 der Tag NACH dem 30. Rahja ist namenlos, kein 31. und kein 1. Praios');
assert($nameless['month_key'] === '', 'ein namenloser Tag traegt keinen Monat');
assert($nameless['day'] === 1, 'er ist der erste der fuenf');
assert($nameless['season'] === 'fruehling', 'er erbt die Jahreszeit des Rahja, aus dem er herauswaechst');
$lastNameless = avesmapsTravelCalendarAdvance('rahja', 28, $hours(7));
assert($lastNameless['nameless'] === true && $lastNameless['day'] === 5, 'fuenf namenlose Tage, nicht vier und nicht sechs');
$newYear = avesmapsTravelCalendarAdvance('rahja', 28, $hours(8));
assert($newYear['month_key'] === 'praios' && $newYear['day'] === 1, 'danach beginnt das neue Jahr mit dem 1. Praios');
assert($newYear['years_passed'] === 1, 'und der Jahreswechsel wird mitgezaehlt');
assert($newYear['season'] === 'sommer', 'im Praios ist Sommer');

// ============================================================ H. eine sehr lange Reise
$aroundTheYear = avesmapsTravelCalendarAdvance('praios', 1, $hours(365));
assert($aroundTheYear['month_key'] === 'praios' && $aroundTheYear['day'] === 1, 'nach 365 Tagen steht dasselbe Datum');
assert($aroundTheYear['years_passed'] === 1, 'aber ein Jahr ist herum');
$twoYears = avesmapsTravelCalendarAdvance('praios', 1, $hours(730));
assert($twoYears['years_passed'] === 2, 'und nach 730 Tagen zwei');

echo "travel-calendar-test: all asserts passed\n";
