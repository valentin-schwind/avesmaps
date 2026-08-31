<?php

declare(strict_types=1);

// 🔴 ES GIBT KEIN ERSETZEN. Owner 31.08.2026, wörtlich:
// „ich will dass du alle 'ersetzungsfunktionen' des importers augenblicklich deaktivierst. es gibt
//  kein ersetzen. es gibt neu oder nix - kein verändern, kein ersetzen."
//
// ANLASS: der Abgleich hatte ihre „Burg Gryffenwacht" mit unserem Dorf „Valpolust" gleichgesetzt
// (1,90 Karteneinheiten Abstand, Schwelle 2,0 = 6 Meilen) und dessen NAMEN ersetzt. garetien.de
// führt beide getrennt und zeichnet sogar einen Pfad dazwischen. Am Bestand gemessen: von 2364
// Punktobjekten haben 2041 (86,3 %) einen anders benannten Nachbarn innerhalb der Schwelle -- eine
// Burg liegt in diesem Kartenwerk fast immer neben ihrem Dorf.
//
// 🔴 DIESER PRÜFSTAND IST DER EINZIGE, DER ÜBER DIE PRODUKTION AUSSAGT. Die Pläne der
// Ersetzungs-Maschinerie (garetien-uebernahme-test.php, garetien-abschnitte-vollstaendig-test.php)
// definieren den Schalter ausdrücklich auf `true` und prüfen damit eine Lage, die live nicht
// eintritt. Hier wird er NICHT definiert -- es gilt die Vorgabe.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-kein-ersetzen-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

// =================================================================================================
// 1. 🔴 DIE VORGABE IST „AUS"
// =================================================================================================
assert(defined('AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT'), 'der Schalter existiert');
assert(AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT === false,
    '🔴 ohne ausdrückliche Gegendefinition ist Ersetzen AUS -- das ist die Lage, die live gilt');
$pruefungen += 2;

// 💣 UND KEIN PRODUKTIVPFAD SCHALTET IHN AN. Ohne diesen Wächter genügte ein `define(..., true)`
// irgendwo unter api/ oder js/, und die Vorgabe oben wäre eine Behauptung über eine Konstante, die
// niemand mehr liest. ⚠️ Die zwei Prüfstände dürfen es, und nur sie -- sie stehen namentlich da.
$erlaubteAnschalter = [
    'garetien-uebernahme-test.php',
    'garetien-abschnitte-vollstaendig-test.php',
];
$wurzel = dirname(__DIR__, 4);
$anschalter = [];
$lauf = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel . '/api'));
foreach ($lauf as $datei) {
    if (!$datei->isFile() || $datei->getExtension() !== 'php') {
        continue;
    }
    $inhalt = (string) file_get_contents($datei->getPathname());
    if (preg_match('~define\s*\(\s*[\'"]AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT[\'"]\s*,\s*true~i', $inhalt) !== 1) {
        continue;
    }
    if (in_array($datei->getFilename(), $erlaubteAnschalter, true)) {
        continue;
    }
    $anschalter[] = str_replace($wurzel, '', $datei->getPathname());
}
assert($anschalter === [],
    '🔴 kein Produktivpfad darf Ersetzen anschalten -- gefunden: ' . implode(', ', $anschalter));
$pruefungen++;

// =================================================================================================
// 2. 🔴 DER PLAN BIETET NICHTS ZUM ERSETZEN AN
// =================================================================================================
// Dieselbe Lage, in der bis zum 31.08.2026 ein Lücken-, ein Umbenennungs- und ein Geometrie-Item
// entstanden: ein getroffener Abschnitt mit ANDEREM Namen -- genau der Fall Valpolust/Gryffenwacht.
$urteil = [
    'status' => 'deckt_sich', 'anlass' => 'geometrie',
    'treffer_public_id' => 'w-1', 'treffer_name' => 'Valpolust',
    'grund' => 'Geometrie liegt 1.90 Einheiten von "Valpolust"', 'abstand' => 1.90,
    'abschnitte' => [['public_id' => 'w-1', 'name' => 'Valpolust', 'punkte' => 1]],
];
$zeile = [
    'wiki' => 'ggp', 'ebene' => 'Ortschaften_3', 'zeile_nr' => 7, 'typ' => 'Burg',
    'namensraum' => 'Garetien', 'artikel' => 'Burg Gryffenwacht', 'anzeige' => 'Gryffenwacht',
    'geo_art' => 'koordinaten', 'geo' => '71448 35101',
];
$eintraege = avesmapsGaretienErgaenzungsEintraege($zeile, avesmapsGaretienMappeTyp('Burg'), $urteil, []);
$anlaesse = array_map(static fn(array $e): string => (string) ($e['after']['anlass'] ?? ''), $eintraege);
// 🔴 ZWEI Angebote bleiben, und beide sind harmlos: die QUELLE (additiv, exakt rücknehmbar, trägt
// die Rechtsfolge) und das ZUSATZ-Item („trotzdem neu anlegen"). Umbenennung und Geometrie-Ersatz
// gibt es nicht mehr.
sort($anlaesse);
assert($anlaesse === ['ergaenzung', 'zusatz'],
    '🔴 nur Quelle und Zusatz bleiben -- gefunden: ' . implode(', ', $anlaesse));
$nachFeldern = [];
foreach ($eintraege as $eintrag) {
    $nachFeldern[(string) ($eintrag['after']['anlass'] ?? '')] = $eintrag;
}
// 💣 UND DIE ERGAENZUNG SCHREIBT NUR DIE QUELLE -- an den FELDERN gemessen, nicht am Anlass. Der
// Anlass ist eine Beschriftung, die Felder sind die Anweisung; genau hier stand bis zum 31.08.2026
// zusätzlich `name`, und genau der hat unser Dorf umbenannt.
assert($nachFeldern['ergaenzung']['after']['felder'] === ['quelle'],
    '🔴 die Ergänzung schreibt NUR die Quelle: '
    . implode(', ', (array) $nachFeldern['ergaenzung']['after']['felder']));
// 💣 ZWEI FELDER, nicht eines: ein 'new' mit gesetztem `entity_public_id` wäre trotzdem ein
// Schreibzugriff auf ein bestehendes Objekt (dieselbe Falle steht am Zufluss beschrieben).
assert($nachFeldern['zusatz']['change_type'] === 'new', 'das Zusatz-Item legt NEU an');
assert($nachFeldern['zusatz']['entity_public_id'] === null, 'und zeigt auf NICHTS Vorhandenes');
$pruefungen += 4;

// =================================================================================================
// 3. 🔴 UND DIE ÜBERNAHME SCHREIBT NICHT, AUCH WENN DAS ITEM SCHON DASTEHT
// =================================================================================================
// 💣 DAS IST DER VERBINDLICHE RIEGEL. Der laufende Lauf des Owners trägt BEREITS fertige
// Ergänzungs-Items in der Datenbank -- ein Riegel, der nur verhindert, dass NEUE Angebote
// entstehen, ließe genau die schon vorhandenen weiterhin durch.
$geworfen = null;
try {
    avesmapsGaretienErgaenzungAnwenden(
        new PDO('sqlite::memory:'),
        ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['name'],
            'ziel' => 'location', 'subtyp' => 'gebaeude', 'name' => 'Gryffenwacht'],
        '1114f89f-eb1c-5d76-8dcd-fff6117a694d',
        ['id' => 7],
        'ggp:Ortschaften_3:Burg:Garetien:Burg Gryffenwacht|umbenennung|w-1'
    );
} catch (Throwable $fehler) {
    $geworfen = $fehler->getMessage();
}
assert($geworfen !== null, '🔴 die Übernahme einer UMBENENNUNG muss scheitern');
// ⚠️ Sie WIRFT, statt still nichts zu tun: der Aufrufer vermerkt das Item als 'failed' mit diesem
// Grund. Ein stiller Leerlauf sähe für den Editor aus wie „übernommen".
assert(str_contains($geworfen, 'Ersetzen ist abgeschaltet'),
    'und der Grund nennt den Schalter beim Namen: ' . $geworfen);
// 💣 UND ER NENNT DAS FELD, an dem es lag -- „Ersetzen ist abgeschaltet" allein liesse den Editor
// raten, was denn nun ginge.
assert(str_contains($geworfen, 'name'), 'und das beanstandete Feld: ' . $geworfen);
// 💣 UND ZWAR VOR JEDEM SCHREIBVORGANG. Das PDO oben ist eine LEERE Datenbank ohne eine einzige
// Tabelle -- käme der Riegel erst nach dem ersten Zugriff, stünde hier ein SQL-Fehler statt dieser
// Meldung, und der Riegel wäre nur zufällig wirksam.
assert(!str_contains(strtolower($geworfen), 'no such table'),
    'der Riegel greift VOR dem ersten Datenbankzugriff: ' . $geworfen);
$pruefungen += 3;

// --- 🔴 DIE GEGENPROBE, UND SIE IST DIE HALBE MELDUNG: eine reine QUELLEN-Ergänzung geht DURCH.
// Owner 31.08.2026: „Garetien.de als 'Quelle und Artikel ergänzen' soll erlaubt sein, aber nicht
// den namen verändern." Ohne diese Zeile prüfte der Abschnitt darüber nur, dass irgendetwas
// scheitert -- und ein Riegel, der ALLES ablehnt, wäre genauso falsch wie keiner.
// ⚠️ Gemessen wird am RIEGEL, nicht am ganzen Schreibvorgang: das leere PDO bricht danach an der
// fehlenden Tabelle ab, und genau das ist der Beweis, dass der Riegel sie durchgelassen hat.
$geworfenQuelle = null;
try {
    avesmapsGaretienErgaenzungAnwenden(
        new PDO('sqlite::memory:'),
        ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
            'ziel' => 'location', 'subtyp' => 'gebaeude', 'quelle' => ['url' => 'https://www.garetien.de']],
        '1114f89f-eb1c-5d76-8dcd-fff6117a694d',
        ['id' => 7],
        'ggp:Ortschaften_3:Burg:Garetien:Burg Gryffenwacht|ergaenzung|w-1'
    );
} catch (Throwable $fehler) {
    $geworfenQuelle = $fehler->getMessage();
}
assert($geworfenQuelle === null || !str_contains($geworfenQuelle, 'Ersetzen ist abgeschaltet'),
    '🔴 eine reine Quellen-Ergänzung darf NICHT am Riegel scheitern: ' . (string) $geworfenQuelle);
$pruefungen++;

// =================================================================================================
// 4. 🔴 UND DAS FENSTER BIETET „NAMEN ERSETZEN" UND „SEGMENTE ERSETZEN" NICHT MEHR AN
// =================================================================================================
// ⚠️ Das ist nur die Anzeige -- der verbindliche Riegel steht oben. Sie gehört trotzdem geprüft:
// ein Knopf, der eine Handlung anbietet, die der Server ablehnt, ist eine Fehlermeldung als
// Bedienelement.
$fenster = (string) file_get_contents($wurzel . '/js/review/review-garetien-importer.js');
$fenster = preg_replace('~/\*[\s\S]*?\*/~', '', $fenster) ?? $fenster;
$fenster = preg_replace('~^\s*//.*$~m', '', $fenster) ?? $fenster;
$von = strpos($fenster, 'AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL = {');
assert($von !== false, 'die Verbtafel des Fensters steht da');
$tafel = substr($fenster, $von, (int) strpos($fenster, '};', $von) - $von);
foreach (['name', 'geometrie'] as $verb) {
    assert(!str_contains($tafel, '"' . $verb . '"'),
        '🔴 das Verb "' . $verb . '" wird nicht mehr angeboten: ' . $tafel);
    $pruefungen++;
}
// ⚠️ Und die Gegenprobe, damit die zwei Zeilen darüber nicht bloß eine leere Tafel messen. „quelle"
// gehört ausdrücklich dazu: sie BLEIBT (Owner), und ein Riegel, der sie mit wegnähme, wäre die
// Überkorrektur in die andere Richtung.
foreach (['quelle', 'neu', 'ablehnen'] as $verb) {
    assert(str_contains($tafel, '"' . $verb . '"'),
        'das Verb "' . $verb . '" bleibt: ' . $tafel);
    $pruefungen++;
}

echo 'OK: garetien-kein-ersetzen, ' . $pruefungen . ' Pruefungen.' . PHP_EOL;
