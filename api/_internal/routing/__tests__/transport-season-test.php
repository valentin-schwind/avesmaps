<?php

declare(strict_types=1);

// Wann darf welches Reisemittel ueber diesen Weg? Die drei Zustaende und der Jahreswechsel.
//
// Die Faelle sind die echten Paesse der Geographia (S. 115 f.), nicht erfundene: der Roterzpass mit
// einem Fenster ueber den Jahreswechsel, der Schattenpass mit einem innerhalb des Jahres, und der
// Raschtulsweg, den die Quelle den Karren ganz verbietet.
//
// ⚠️ Mit Assertions und mbstring laufen lassen:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/transport-season-test.php

require_once __DIR__ . '/../transport-season.php';

$tag = static function (string $month, int $day): int {
    $dayOfYear = avesmapsTravelCalendarDayOfYear($month, $day);
    assert($dayOfYear !== null, "Testdatum {$day}. {$month} ist gueltig");
    return $dayOfYear;
};

$LAND = ['groupFoot', 'lightWalker', 'groupHorse', 'lightRider', 'caravan', 'horseCarriage'];

// ============================================================ A. ohne Reisebeginn = wie bisher
// 💣 Das ist die Rueckwaertskompatibilitaet, und sie ist der Grund, warum ein fehlendes Fenster
// „ganzjaehrig" heisst: alle 5765 Wege des Bestands tragen heute keines.
$roterzpass = ['groupFoot' => ['from_month' => 'peraine', 'from_day' => 1, 'to_month' => 'boron', 'to_day' => 30]];
$fenster = avesmapsSeasonWindowsFromProperties($roterzpass);
foreach ($LAND as $mittel) {
    assert(avesmapsTransportOpenOn($LAND, $fenster, $mittel, null) === true,
        "{$mittel}: ohne Reisebeginn wird die Jahreszeit gar nicht erst gefragt");
}
assert(avesmapsTransportOpenOn($LAND, [], 'groupFoot', $tag('firun', 25)) === true,
    'ein Weg ohne jedes Fenster ist ganzjaehrig offen');

// ============================================================ B. nicht angehakt = nie
// „nicht fuer Karren" (Raschtulsweg) braucht kein Fenster -- der Haken fehlt einfach.
$ohneKutsche = array_values(array_filter($LAND, static fn ($m) => $m !== 'horseCarriage'));
foreach ([null, 1, 200, 365] as $wann) {
    assert(avesmapsTransportOpenOn($ohneKutsche, [], 'horseCarriage', $wann) === false,
        'was nicht angehakt ist, faehrt nie -- auch nicht ohne Reisebeginn');
}
assert(avesmapsSeasonClosureFor($ohneKutsche, $fenster, 'horseCarriage', $tag('praios', 1)) === null,
    'ein ganzjaehriges Verbot ist keine SAISONALE Sperre und meldet sich nicht als solche');

// ============================================================ C. Roterzpass: Fenster ueber den Jahreswechsel
// „gangbar Anfang Peraine bis Ende Boron" -- Peraine ist der 10., Boron der 5. Monat.
$offen = static fn (string $month, int $day): bool =>
    avesmapsTransportOpenOn($LAND, $fenster, 'groupFoot', $tag($month, $day));

assert($offen('peraine', 1), 'am 1. Peraine geht er auf');
assert($offen('rahja', 30), 'im Rahja offen');
assert($offen('praios', 1), 'ueber den Jahreswechsel hinweg offen');
assert($offen('boron', 30), 'am 30. Boron das letzte Mal');
assert(!$offen('hesinde', 1), 'am 1. Hesinde ist zu');
assert(!$offen('firun', 25), '💣 im Firun zu -- der Fall, um den es geht');
assert(!$offen('phex', 30), 'bis zum letzten Tag des Phex zu');
assert($offen('peraine', 1), 'und dann wieder auf');

// ⭐ Die fuenf Namenlosen Tage brauchen keinen Sonderfall: sie sind die Tage 361..365 derselben
// Zaehlung und liegen damit von selbst im Fenster, das vom Peraine in den Boron laeuft.
$namenlos = 363;
assert(avesmapsTransportOpenOn($LAND, $fenster, 'groupFoot', $namenlos) === true,
    'die Namenlosen Tage liegen zwischen Rahja und Praios -- also im offenen Fenster');

// ============================================================ D. Schattenpass: Fenster INNERHALB des Jahres
// „nur im Sommer, nur fuer Fussgaenger" -- Praios bis Efferd, und nur die Fusszeilen sind angehakt.
$nurZuFuss = ['groupFoot', 'lightWalker'];
$sommer = avesmapsSeasonWindowsFromProperties([
    'groupFoot' => ['from_month' => 'praios', 'from_day' => 1, 'to_month' => 'efferd', 'to_day' => 30],
    'lightWalker' => ['from_month' => 'praios', 'from_day' => 1, 'to_month' => 'efferd', 'to_day' => 30],
]);
assert(avesmapsTransportOpenOn($nurZuFuss, $sommer, 'groupFoot', $tag('rondra', 15)), 'im Rondra offen');
assert(!avesmapsTransportOpenOn($nurZuFuss, $sommer, 'groupFoot', $tag('travia', 1)), 'ab Travia zu');
assert(!avesmapsTransportOpenOn($nurZuFuss, $sommer, 'groupFoot', $tag('rahja', 30)), 'im Rahja immer noch zu');
assert(!avesmapsTransportOpenOn($nurZuFuss, $sommer, 'groupFoot', 363),
    '💣 und an den Namenlosen Tagen auch -- die Sperre endet erst mit dem Jahr');
assert(avesmapsTransportOpenOn($nurZuFuss, $sommer, 'groupFoot', $tag('praios', 1)), 'am 1. Praios wieder auf');
assert(!avesmapsTransportOpenOn($nurZuFuss, $sommer, 'lightRider', $tag('praios', 1)),
    'der Reiter kommt auch im Sommer nicht drueber -- er ist gar nicht angehakt');

// ============================================================ E. der Vermerk fuer den Reiseplan
$sperre = avesmapsSeasonClosureFor($LAND, $fenster, 'groupFoot', $tag('firun', 25));
assert($sperre !== null, 'im Firun meldet sich die Sperre');
assert($sperre['open_from']['month'] === 'peraine' && $sperre['open_from']['day'] === 1, 'sie weiss, ab wann wieder');
assert($sperre['open_to']['month'] === 'boron', 'und bis wann');
assert(avesmapsSeasonClosureFor($LAND, $fenster, 'groupFoot', $tag('praios', 1)) === null,
    'wo nichts gesperrt ist, gibt es keinen Vermerk');

// ============================================================ F. kaputte Eingaben erfinden keine Sperre
// 💣 Die gefaehrliche Richtung ist NICHT „Fenster ignoriert", sondern „Fenster erfunden": ein
// halbes Datum aus einem alten Datensatz duerfte niemals einen Weg schliessen, den niemand gesperrt hat.
foreach ([
    ['from_month' => 'nichtvorhanden', 'from_day' => 1, 'to_month' => 'boron', 'to_day' => 30],
    ['from_month' => 'peraine', 'from_day' => 1],
    ['from_month' => '', 'to_month' => ''],
    'kein Objekt',
    null,
] as $kaputt) {
    $geprueft = avesmapsSeasonWindowsFromProperties(['groupFoot' => $kaputt]);
    assert($geprueft === [], 'ein unbrauchbares Fenster wird verworfen, nicht geraten');
    assert(avesmapsTransportOpenOn($LAND, $geprueft, 'groupFoot', $tag('firun', 25)) === true,
        'und der Weg bleibt offen -- eine erfundene Sperre waere der schlimmere Fehler');
}

// Tage ausserhalb 1..30 werden geklemmt wie im Kalender, nicht abgelehnt.
$geklemmt = avesmapsSeasonWindowsFromProperties([
    'groupFoot' => ['from_month' => 'peraine', 'from_day' => 99, 'to_month' => 'boron', 'to_day' => 0],
]);
assert($geklemmt['groupFoot']['from_day'] === 30 && $geklemmt['groupFoot']['to_day'] === 1, 'Tage werden geklemmt');

// ============================================================ G. beide Enden gehoeren dazu
$einTag = avesmapsSeasonWindowsFromProperties([
    'groupFoot' => ['from_month' => 'firun', 'from_day' => 10, 'to_month' => 'firun', 'to_day' => 10],
]);
assert(avesmapsTransportOpenOn($LAND, $einTag, 'groupFoot', $tag('firun', 10)), 'ein Fenster von einem Tag enthaelt ihn');
assert(!avesmapsTransportOpenOn($LAND, $einTag, 'groupFoot', $tag('firun', 11)), 'und nur ihn');

echo "transport-season-test: all asserts passed\n";
