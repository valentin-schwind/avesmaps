<?php

declare(strict_types=1);

/**
 * Wer darf die Art einer bereits bekannten Quelle umschreiben -- und wann ist eine Wahl ueberhaupt
 * eine Wahl? Kein DB, kein HTTP. Ausfuehren (vom Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/quellen-art-korrigieren-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 *
 * 💣 WARUM ES DAS GIBT (Meldung #105, Nottel, 29.08.2026): Der Katalog-Upsert liess `source_type`
 * einer bekannten Adresse unberuehrt -- ohne Fehler, ohne Meldung, mit gueltiger id zurueck. Jeder
 * Versuch, die Art richtigzustellen, war ein Klick ins Leere, und von aussen nicht davon zu
 * unterscheiden, dass das Formular die Wahl ignoriert.
 *
 * 💣 UND DIE GEGENRICHTUNG IST DIE GEFAEHRLICHERE. `sources` ist ein KATALOG: eine Zeile haengt an
 * beliebig vielen Objekten. Duerfte jeder Aufrufer beim blossen Verknuepfen die Art mitschreiben,
 * schriebe die Vorauswahl eines Formulars ('regionalspielhilfe' stand als erste Art vorn) still
 * ueber gepflegte Angaben -- und genau so kam der Befund ueberhaupt zustande. Darum haengt die
 * Erlaubnis am AUFRUFER, und die Vorgabe ist nein.
 *
 * Gepruefte Stuecke sind die reinen: die Normalisierung, die Erlaubnisregel, die Identitaet und der
 * ON-DUPLICATE-Teil des Upserts. Das SQL selbst ist MySQL (`VALUES()`), also hier nicht fahrbar --
 * und eine SQLite-taugliche Ersatzform waere genau die Verbiegung, vor der AGENTS.md §9 warnt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

// ---- 1. '' ist „keine Aussage", und ein unbekannter Wert ist es auch ---------------------------
// ⚠️ Ein unbekannter Schluessel faellt NICHT auf 'sonstiges', sondern auf ''. Der Unterschied ist
// tragend: 'sonstiges' ist eine Aussage und wuerde eine bestehende Zeile umschreiben duerfen.
assert(avesmapsNormalizeSourceType('') === '', 'leer bleibt leer');
$zaehl();
assert(avesmapsNormalizeSourceType(null) === '', 'null ist keine Wahl');
$zaehl();
assert(avesmapsNormalizeSourceType('garetien') === '', 'ein unbekannter Schluessel ist keine Wahl');
$zaehl();
assert(avesmapsNormalizeSourceType(' Briefspiel ') === 'briefspiel', 'getrimmt und kleingeschrieben');
$zaehl();
foreach (AVESMAPS_SOURCE_TYPES as $art) {
    assert(avesmapsNormalizeSourceType($art) === $art, 'jede der acht Arten kommt durch: ' . $art);
    $zaehl();
}
assert(AVESMAPS_SOURCE_TYPES[0] === 'regionalspielhilfe',
    'die erste Art ist weiterhin regionalspielhilfe -- und GENAU DARUM traegt die Eingabezeile '
    . 'einen leeren Eintrag davor (js/review/review-feature-sources.js). Wer die Reihenfolge '
    . 'aendert, aendert nichts an der Regel, aber dieser Test erklaert sonst nicht mehr, warum.');
$zaehl();

// ---- 2. Die Erlaubnisregel: beide Haelften muessen stehen --------------------------------------
assert(avesmapsSourceRetypeAllowed('briefspiel', true) === true,
    'ausdrueckliche Wahl + erlaubter Aufrufer = die Art wird richtiggestellt');
$zaehl();
assert(avesmapsSourceRetypeAllowed('briefspiel', false) === false,
    'ein Aufrufer ohne Erlaubnis schreibt nie -- daran haengt, dass eine angenommene '
    . 'Gemeinschaftsmeldung keine katalogweit geteilte Zeile umschreibt');
$zaehl();
assert(avesmapsSourceRetypeAllowed('', true) === false,
    'ohne Wahl passiert nichts, auch beim erlaubten Aufrufer -- sonst wuerde die Vorauswahl eines '
    . 'Formulars zur Aussage');
$zaehl();
assert(avesmapsSourceRetypeAllowed('garetien', true) === false, 'und ein unbekannter Wert ist keine Wahl');
$zaehl();

// ---- 3. Die Identitaet: EINE Regel, zwei Leser --------------------------------------------------
// Der Upsert schreibt darunter, und der Blick auf den Vorzustand liest damit -- eine zweite Fassung
// dieser Zeile liesse beide auf verschiedene Zeilen zeigen.
assert(avesmapsFeatureSourceHash('https://x.de/a') === hash('sha256', 'https://x.de/a'),
    'mit Adresse: der Hash der Adresse');
$zaehl();
assert(avesmapsFeatureSourceHash('', 'wiki:blutmond-i') === hash('sha256', 'wikipub:wiki:blutmond-i'),
    'ohne Adresse, mit Wiki-Schluessel: der Hash des Schluessels -- eine Publikation ohne Shoplink '
    . 'hat keine Adresse, ueber die man sie wiederfaende');
$zaehl();
assert(avesmapsFeatureSourceHash('https://x.de/a', 'wiki:blutmond-i') === hash('sha256', 'https://x.de/a'),
    'liegt beides vor, gewinnt die Adresse -- unveraendert gegenueber der Fassung vor dem Umbau');
$zaehl();

// ---- 4. Der ON-DUPLICATE-Teil: die Vorgabe ist ein bewusster Leerlauf ---------------------------
$ohne = avesmapsSourceUpsertOnDuplicateSql(false, false);
$mit = avesmapsSourceUpsertOnDuplicateSql(false, true);
assert(str_contains($ohne, 'source_type = source_type'),
    'ohne Erlaubnis bleibt die Art, wie sie ist');
$zaehl();
assert(!str_contains($ohne, 'source_type = VALUES(source_type)'),
    'und wird auf keinen Fall mitgeschrieben');
$zaehl();
assert(str_contains($mit, 'source_type = VALUES(source_type)'),
    'mit Erlaubnis wird sie richtiggestellt');
$zaehl();
// Die Nachbarfelder duerfen dabei nicht verrutschen -- sie tragen ihre eigenen Einbahnregeln.
foreach ([$ohne, $mit] as $sql) {
    assert(str_contains($sql, "license = IF(VALUES(license) = '', license, VALUES(license))"),
        'Lizenz fuellt weiterhin nur, sie leert nie');
    $zaehl();
    assert(str_contains($sql, 'wiki_key = IF(VALUES(wiki_key) IS NULL, wiki_key, VALUES(wiki_key))'),
        'und der Wiki-Schluessel ebenso');
    $zaehl();
}
assert(str_contains(avesmapsSourceUpsertOnDuplicateSql(true, false), "IF(VALUES(label) = '', label, VALUES(label))"),
    'der Auffrisch-Schalter des Labels bleibt, was er war');
$zaehl();
assert(str_contains(avesmapsSourceUpsertOnDuplicateSql(false, false), "IF(label = '', VALUES(label), label)"),
    'und ohne ihn ueberschreibt ein neues Label kein vorhandenes');
$zaehl();

// ---- 5. Die Vorgabe ist NEIN, und sie steht in der Signatur -------------------------------------
// 🔴 Das ist der Riegel gegen den naechsten Aufrufer: wer eine dieser Funktionen neu ruft, bekommt
// die Erlaubnis NICHT geschenkt. Genau diese Sorte Voreinstellung hat #105 verursacht.
$vorgabe = static function (string $funktion, string $parameter) {
    $spiegel = new ReflectionFunction($funktion);
    foreach ($spiegel->getParameters() as $p) {
        if ($p->getName() === $parameter) {
            return $p->isDefaultValueAvailable() ? $p->getDefaultValue() : '(ohne Vorgabe)';
        }
    }

    return '(nicht vorhanden)';
};
assert($vorgabe('avesmapsFeatureSourceUpsert', 'retype') === false,
    'avesmapsFeatureSourceUpsert: ohne ausdrueckliche Erlaubnis wird nie umgetypt');
$zaehl();
assert($vorgabe('avesmapsAddFeatureSource', 'retype') === false,
    'avesmapsAddFeatureSource: dito -- der Weg der angenommenen Gemeinschaftsmeldung geht hier '
    . 'durch und darf den Katalog nicht umschreiben');
$zaehl();
assert($vorgabe('avesmapsLinkExistingFeatureSource', 'type') === '',
    'avesmapsLinkExistingFeatureSource: ohne genannte Art wird nur verknuepft');
$zaehl();

echo "quellen-art-korrigieren-test.php: {$pruefungen} Zusicherungen erfuellt\n";
