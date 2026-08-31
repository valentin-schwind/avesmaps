<?php

declare(strict_types=1);

/**
 * Die Ortsklassen und das Bauwerks-MERKMAL.
 *
 * Lauf (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/ortsklassen-test.php
 *
 * 💣 WARUM ES DIESEN TEST GIBT (31.08.2026). `gebaeude` war Klasse UND Merkmal in einem: solange es
 * genau eine Bauwerksklasse gab, hiess `settlement_class = 'gebaeude'` an sieben Stellen „ist ein
 * Bauwerk, kein Behaelter", ohne dass das auffiel. Mit `stadtviertel` (Owner 30.08.2026) sind es
 * zwei, und jede dieser Stellen haette das Viertel STILL als Siedlung gefuehrt -- in die genau
 * umgekehrte Richtung dessen, was gemeint ist.
 *
 * 💣 UND DIE KLASSENLISTE STEHT FUENFMAL IM REPO. Das war schon vorher so, aber unbewacht: wer eine
 * Kopie vergisst, bekommt keinen Fehler, sondern ein Objekt, das der eine Endpunkt annimmt und der
 * naechste ablehnt. Sie zusammenzulegen ist ein eigener Umbau (jede haengt an einem anderen
 * Einbindungspfad); bis dahin haelt dieser Test sie gegeneinander.
 *
 * ⚠️ Drei der fuenf Dateien sind ENDPUNKTE und lassen sich nicht einbinden, ohne ihre Antwort
 * auszufuehren -- sie werden deshalb als TEXT gelesen. Kommentare werden vorher entfernt: die Prosa
 * dieser Dateien nennt die Klassen laufend, und ein Treffer im Kommentar ist kein Beleg.
 */

require_once __DIR__ . '/../ortsklassen.php';

if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: mit -d zend.assertions=1 starten, sonst ist assert() wirkungslos.\n");
    exit(1);
}

$repo = dirname(__DIR__, 3);
$pruefungen = 0;

/** Dateitext ohne Kommentare -- siehe Kopf. */
$lies = static function (string $pfad) use ($repo): string {
    $text = file_get_contents($repo . '/' . $pfad);
    assert(is_string($text) && $text !== '', "Datei nicht lesbar: {$pfad}");
    $text = preg_replace('~/\*.*?\*/~s', '', $text);

    return preg_replace('~^\s*(//|\#).*$~m', '', (string) $text);
};

/** Die Slugs aus einer PHP-Listenzuweisung wie `[... 'dorf', 'gebaeude' ...]`. */
$slugs = static function (string $text, string $muster, string $wozu): array {
    assert(preg_match($muster, $text, $treffer) === 1, "Liste nicht gefunden: {$wozu}");
    preg_match_all("~'([a-z_]+)'~", $treffer[1], $alle);

    return $alle[1];
};

// ---- 1. Das Merkmal --------------------------------------------------------------------------
assert(avesmapsIstBauwerksklasse('gebaeude') === true);
assert(avesmapsIstBauwerksklasse('stadtviertel') === true, 'das Stadtviertel IST ein Bauwerk');
assert(avesmapsIstBauwerksklasse('dorf') === false);
assert(avesmapsIstBauwerksklasse('metropole') === false);
assert(avesmapsIstBauwerksklasse('') === false, 'leer ist kein Bauwerk');
assert(avesmapsIstBauwerksklasse(null) === false, 'und null erst recht nicht');
assert(avesmapsIstBauwerksklasse(' gebaeude ') === true, 'Leerzeichen werden abgeschnitten');
assert(avesmapsIstBauwerksklasse('Gebaeude') === false, 'der Slug ist kleingeschrieben, kein Raten');
$pruefungen += 8;

// ---- 2. Die SQL-Bedingung --------------------------------------------------------------------
// 💣 Sie ersetzt ein `= 'gebaeude'`; mit zwei Klassen MUSS daraus ein IN werden.
$bedingung = avesmapsBauwerksklassenSql('settlement_class');
assert(str_contains($bedingung, 'settlement_class IN ('), 'positiv ist ein IN: ' . $bedingung);
assert(str_contains($bedingung, "'gebaeude'") && str_contains($bedingung, "'stadtviertel'"),
    'und es nennt BEIDE Bauwerksklassen: ' . $bedingung);
$negiert = avesmapsBauwerksklassenSql('settlement_class', true);
assert(str_contains($negiert, 'settlement_class NOT IN ('), 'negiert ist ein NOT IN: ' . $negiert);
assert(str_contains(avesmapsBauwerksklassenSql('mf.feature_subtype'), 'mf.feature_subtype IN ('),
    'ein Alias reist mit durch');
$pruefungen += 4;

// ---- 3. Die fuenf Kopien der Klassenliste -----------------------------------------------------
$erwartet = AVESMAPS_ORTSKLASSEN;
sort($erwartet);
$kopien = [
    ['api/_internal/map/features.php', "~define\('AVESMAPS_LOCATION_SUBTYPES',\s*\[([^\]]+)\]~"],
    ['api/edit/map/features.php', '~const AVESMAPS_LOCATION_SUBTYPES = \[([^\]]+)\]~'],
    ['api/app/report-location.php', '~const AVESMAPS_LOCATION_SUBTYPES = \[([^\]]+)\]~'],
];
foreach ($kopien as [$datei, $muster]) {
    $gefunden = $slugs($lies($datei), $muster, $datei);
    sort($gefunden);
    assert($gefunden === $erwartet,
        "{$datei} fuehrt eine andere Klassenliste als api/_internal/ortsklassen.php: "
        . implode(', ', $gefunden));
    $pruefungen++;
}

// settlements.php traegt sie ZWEIMAL -- beide muessen stimmen, und es muessen zwei bleiben.
$settlements = $lies('api/_internal/wiki/settlements.php');
preg_match_all('~\$settlementClasses = \[([^\]]+)\]~', $settlements, $treffer);
assert(count($treffer[1]) === 2,
    'settlements.php trug bisher ZWEI Kopien; gefunden: ' . count($treffer[1]));
foreach ($treffer[1] as $roh) {
    preg_match_all("~'([a-z_]+)'~", $roh, $alle);
    $gefunden = $alle[1];
    sort($gefunden);
    assert($gefunden === $erwartet, 'settlements.php: ' . implode(', ', $gefunden));
}
$pruefungen += 3;

// ---- 4. Die Behaelterliste ist die GEGENMENGE -------------------------------------------------
// 🔴 Ein Stadtviertel liegt innerorts, ist aber KEIN Behaelter (Owner 31.08.2026). PHP laesst in
// einer `const` keine Berechnung zu, also steht die Gegenmenge in place-scope.php ausgeschrieben --
// und ohne diesen Vergleich waere genau sie die Stelle, an der eine dritte Bauwerksklasse still
// zum Behaelter wuerde.
$behaelter = $slugs($lies('api/_internal/wiki/place-scope.php'),
    '~const AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES = \[([^\]]+)\]~', 'Behaelterliste');
sort($behaelter);
$gegenmenge = array_values(array_diff(AVESMAPS_ORTSKLASSEN, AVESMAPS_BAUWERKSKLASSEN));
sort($gegenmenge);
assert($behaelter === $gegenmenge,
    'die Behaelterliste muss die Gegenmenge der Bauwerksklassen sein. Erwartet: '
    . implode(', ', $gegenmenge) . ' -- gefunden: ' . implode(', ', $behaelter));
$pruefungen++;

// ---- 5. Die drei SQL-Stellen fragen das MERKMAL, nicht einen Wert -----------------------------
// 💣 Ein zurueckgebliebenes `= 'gebaeude'` waere kein Fehler, sondern eine Zeile weniger in einer
// Suche -- der stille Ausfall, den die Datei selbst an ihrer Rueckfall-Stelle beschreibt.
foreach (['api/_internal/app/in-settlement-search.php', 'api/_internal/app/offmap-search.php'] as $datei) {
    $text = $lies($datei);
    assert(str_contains($text, 'avesmapsBauwerksklassenSql('),
        "{$datei} muss die geteilte Bedingung benutzen");
    assert(!preg_match("~settlement_class\s*(=|<>)\s*'gebaeude'~", $text),
        "{$datei} vergleicht noch auf den EINEN Wert 'gebaeude'");
    assert(str_contains($text, "require_once __DIR__ . '/../ortsklassen.php';"),
        "{$datei} muss api/_internal/ortsklassen.php einbinden -- sonst ein Fatal mit LEEREM Rumpf");
    $pruefungen += 3;
}

echo "ortsklassen-test.php: {$pruefungen} Pruefungen erfuellt\n";
