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

// ⚠️ bootstrap.php ist neu noetig: `avesmapsNormalizeSourceLabel` kuerzt ueber
// `avesmapsNormalizeSingleLine`, und die wohnt dort. `feature-sources.php` hing schon vorher zur
// LAUFZEIT daran (die Namensnennung im Upsert) -- dieser Test hatte den Pfad nur nie betreten.
require_once __DIR__ . '/../../bootstrap.php';
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

// ══ Der TITEL: `<br>` gehoert nicht in einen Katalogeintrag ═════════════════════════════════════
// 💣 Live gemessen am 01.09.2026: FUENF Katalogzeilen tragen ein `<br>` mitten im Titel, aus dem
// `{{Infobox Produkt}}`-Feld des Wikis mitgeschleppt. Das Markup escapet korrekt -- also steht in
// jeder Infobox woertlich „Landkartenset &lt;br /&gt;Das Dornenreich" statt eines Umbruchs.
// Betroffen: 18 + 7 + 4 + 2 + 1 = 32 Verknuepfungen.
assert(avesmapsNormalizeSourceLabel('Landkartenset <br />Das Dornenreich') === 'Landkartenset Das Dornenreich',
    'ein `<br />` mit Leerzeichen wird zu EINEM Leerzeichen');
$zaehl();
assert(avesmapsNormalizeSourceLabel('Havena-Fanfare<br/>Sonderausgabe') === 'Havena-Fanfare Sonderausgabe',
    'ein `<br/>` ohne Leerzeichen ebenso -- sonst klebten die Woerter aneinander');
$zaehl();
assert(avesmapsNormalizeSourceLabel('A<BR>B') === 'A B', 'GROSSSCHREIBUNG zaehlt nicht');
$zaehl();
assert(avesmapsNormalizeSourceLabel('A<br>B') === 'A B', 'und die Form ohne Schraegstrich auch nicht');
$zaehl();

// ⚠️ KEIN allgemeines `strip_tags`. Ein Titel darf ein `<` tragen, und was hier verschwindet,
// verschwindet katalogweit -- an bis zu 1.549 Objekten gleichzeitig.
assert(avesmapsNormalizeSourceLabel('Band <1> bleibt') === 'Band <1> bleibt',
    'ein spitzes Klammernpaar, das kein <br> ist, bleibt unangetastet');
$zaehl();

// ⚠️ Die Laengengrenze der Spalte gilt weiter (VARCHAR(200)) -- eine stille MySQL-Kuerzung ist im
// Haus schon einmal teuer geworden (app_setting.setting_value, AGENTS.md §10).
assert(mb_strlen(avesmapsNormalizeSourceLabel(str_repeat('x', 300))) === 200,
    'und die Spaltenbreite wird weiterhin eingehalten');
$zaehl();

// 🔴 DIE REGEL SITZT IM UPSERT, NICHT IM PARSER -- der Katalog hat mehrere Schreiber (Publikations-
// Abgleich, Stadtkarten-Abgleich, Editor, Import), und eine Regel, die einen von ihnen bindet, ist
// keine Regel. 🪤 Eine reine DATEN-Korrektur waere ausserdem zwecklos: der Publikations-Abgleich
// schreibt mit `refreshLabel = true` und holte den alten Titel beim naechsten Lauf zurueck.
$quelltext = (string) file_get_contents(__DIR__ . '/../feature-sources.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^\s*//.*$#m', '', $quelltext) ?? '';
assert(preg_match('/\$label = avesmapsNormalizeSourceLabel\(\$label\);/', $ohneKommentare) === 1,
    'avesmapsFeatureSourceUpsert putzt den Titel -- damit ALLE Schreiber gebunden sind');
$zaehl();
// Und er tut es VOR dem INSERT, nicht irgendwo danach.
$imUpsert = strpos($ohneKommentare, 'function avesmapsFeatureSourceUpsert');
$derPutzer = strpos($ohneKommentare, '$label = avesmapsNormalizeSourceLabel($label);');
$dasInsert = strpos($ohneKommentare, 'INSERT INTO sources');
assert($imUpsert < $derPutzer && $derPutzer < $dasInsert,
    'und zwar innerhalb des Upserts und vor dem INSERT');
$zaehl();

echo "quellen-art-korrigieren-test.php: {$pruefungen} Zusicherungen erfuellt\n";
