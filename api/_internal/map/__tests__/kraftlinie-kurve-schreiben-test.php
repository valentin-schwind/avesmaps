<?php

declare(strict_types=1);

/**
 * Die Kurvenform im Schreibweg der Kraftlinie. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ---- 1. Der Leser klemmt, statt abzulehnen ---------------------------------------------------
assert(avesmapsReadPowerlineCurve(0) === 0.0);
assert(avesmapsReadPowerlineCurve(25) === 25.0);
assert(avesmapsReadPowerlineCurve(-25) === -25.0);
assert(avesmapsReadPowerlineCurve('30') === 30.0, 'eine Zahl als Zeichenkette wird gelesen');
assert(avesmapsReadPowerlineCurve(999) === 45.0, 'ueber 45 wird geklemmt, nicht abgelehnt');
assert(avesmapsReadPowerlineCurve(-999) === -45.0);
// 🔴 Alles Unlesbare ist GERADE, nie eine Ausnahme: eine abgelehnte Speicherung waere fuer den
// Editor von „Server kaputt" nicht zu unterscheiden, und eine gerade Linie ist der Zustand von
// heute -- die sichere Richtung.
assert(avesmapsReadPowerlineCurve(null) === 0.0);
assert(avesmapsReadPowerlineCurve('') === 0.0);
assert(avesmapsReadPowerlineCurve('quatsch') === 0.0);
assert(avesmapsReadPowerlineCurve([]) === 0.0);
assert(avesmapsReadPowerlineCurve(true) === 0.0, 'ein Wahrheitswert ist keine Kurve');
assert(avesmapsReadPowerlineCurve(new stdClass()) === 0.0, 'ein Objekt ist keine Kurve');
assert(avesmapsReadPowerlineCurve('1e3') === 45.0, 'wissenschaftliche Schreibweise wird gelesen und geklemmt');
assert(avesmapsReadPowerlineCurve('30abc') === 0.0, 'eine halbe Zahl ist keine Zahl');
assert(avesmapsReadPowerlineCurve(NAN) === 0.0, 'NAN darf nicht durchrutschen');
assert(avesmapsReadPowerlineCurve(INF) === 45.0, 'INF wird geklemmt, nicht durchgereicht');

// ---- 2. Die EINE Erb-Liste traegt curve ------------------------------------------------------
// 💣 Ohne diesen Eintrag laege ein spaeter angehaengtes Segment kerzengerade zwischen zwei
// gebogenen. Die Liste stand einmal zweimal abgeschrieben nebeneinander und in beiden Kopien
// fehlte ein Feld -- siehe powerline-inherit-test.php.
$geerbt = avesmapsPowerlineInheritedLineFields([
    'name' => 'Torweg',
    'show_label' => true,
    'description' => '',
    'wiki_url' => '',
    'curve' => 26.0,
]);
assert(array_key_exists('curve', $geerbt), 'curve fehlt in der Erb-Liste');
assert($geerbt['curve'] === 26.0);

$leer = avesmapsPowerlineInheritedLineFields([]);
assert($leer['curve'] === 0.0, 'ohne Wert erbt ein neues Segment eine GERADE Linie');

// Auch hier geklemmt -- ein von Hand verbogener Datensatz darf nicht durch die Vererbung wandern.
$wild = avesmapsPowerlineInheritedLineFields(['curve' => 500]);
assert($wild['curve'] === 45.0);

// ---- 2b. DIE ABWESENHEIT HEISST "NICHT GEAENDERT" (29.08.2026, Entwurf 13.1) ------------------
// 💣 Bis heute las der Schreibweg `$payload['curve'] ?? 0` und schrieb ihn bei JEDEM Speichern auf
// alle Segmente. Sobald der Editor ihn nur noch bei Anfassen mitschickt, machte genau dieses `?? 0`
// jede gewollte Ausnahme lautlos platt -- auch bei einer reinen Beschreibungsaenderung. Zeichen fuer
// Zeichen die wiki_no_article-Falle aus derselben Datei.
$vorhanden = ['curve' => 26.0];

// Nichts gesagt -> nichts geaendert.
assert(avesmapsApplyPowerlineCurve($vorhanden, [], 'seg-1')['curve'] === 26.0,
    'ohne Angabe im Rumpf muss die gespeicherte Kurve stehenbleiben');
assert(avesmapsApplyPowerlineCurve($vorhanden, ['description' => 'nur Text'], 'seg-1')['curve'] === 26.0,
    'eine reine Beschreibungsaenderung darf die Kurve nicht anfassen');

// Der Linienwert setzt ALLE.
assert(avesmapsApplyPowerlineCurve($vorhanden, ['curve' => -12], 'seg-1')['curve'] === -12.0);
// ⚠️ Auch die 0 muss durchkommen -- "gerade" ist eine Aussage, kein fehlender Wert.
assert(avesmapsApplyPowerlineCurve($vorhanden, ['curve' => 0], 'seg-1')['curve'] === 0.0,
    'eine ausdrueckliche 0 muss geradebiegen, nicht als "nichts gesagt" gelten');

// Der Segmentwert gewinnt ueber den Linienwert -- der speziellere Griff ist der juengere Wille.
$beides = ['curve' => 5, 'curves' => ['seg-1' => 40, 'seg-2' => -40]];
assert(avesmapsApplyPowerlineCurve($vorhanden, $beides, 'seg-1')['curve'] === 40.0);
assert(avesmapsApplyPowerlineCurve($vorhanden, $beides, 'seg-2')['curve'] === -40.0);
// Ein Segment, das die Karte NICHT nennt, faellt auf den Linienwert zurueck.
assert(avesmapsApplyPowerlineCurve($vorhanden, $beides, 'seg-3')['curve'] === 5.0);
// Und ohne Linienwert bleibt es schlicht stehen.
assert(avesmapsApplyPowerlineCurve($vorhanden, ['curves' => ['seg-1' => 40]], 'seg-3')['curve'] === 26.0,
    'ein ungenanntes Segment ohne Linienwert bleibt unveraendert');

// Geklemmt wird auch hier.
assert(avesmapsApplyPowerlineCurve($vorhanden, ['curves' => ['seg-1' => 999]], 'seg-1')['curve'] === 45.0);
// ⚠️ Eine unbrauchbare Kartenangabe wird IGNORIERT, nicht abgelehnt -- ein veralteter Editor-Stand
// darf keine ganze Speicherung scheitern lassen.
assert(avesmapsApplyPowerlineCurve($vorhanden, ['curves' => 'quatsch'], 'seg-1')['curve'] === 26.0);
assert(avesmapsApplyPowerlineCurve($vorhanden, ['curves' => ['seg-1' => 'quatsch']], 'seg-1')['curve'] === 0.0,
    'ein unlesbarer Einzelwert wird zu 0 (gerade), nicht zur Ausnahme');

// Und die uebrigen Eigenschaften bleiben unangetastet.
$mitAnderem = ['curve' => 3.0, 'name' => 'Torweg', 'show_label' => true];
$danach = avesmapsApplyPowerlineCurve($mitAnderem, ['curve' => 9], 'seg-1');
assert($danach['name'] === 'Torweg' && $danach['show_label'] === true,
    'der Kurven-Setzer fasst fremde Eigenschaften an');

// ---- 3. Der Schreibweg liest den Rumpf ueberhaupt --------------------------------------------
// Der Rumpf von avesmapsUpdatePowerlineLine wird als Quelltext geprueft, weil er eine Transaktion
// fuehrt und ohne PDO nicht ausfuehrbar ist. Gesucht wird der AUFRUF, nicht das blosse Wort.
// ⚠️ Kommentare vorher wegschneiden: der Test darf nicht an der Warnung anschlagen, die vor dem
// Muster warnt -- sonst loescht der naechste Leser den Kommentar, um den Test gruen zu bekommen.
$quelle = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($quelle));
$ohneKommentare = preg_replace('~/\*.*?\*/~s', '', $quelle);
$ohneKommentare = preg_replace('~^\s*//.*$~m', '', (string) $ohneKommentare);
assert(preg_match('/function avesmapsUpdatePowerlineLine\(.*?\n\}/s', (string) $ohneKommentare, $treffer) === 1,
    'avesmapsUpdatePowerlineLine laesst sich nicht isolieren');
$rumpf = $treffer[0];
// 🔴 Der Schreibweg geht durch die REINE Regel oben, statt selbst zu entscheiden -- sonst saesse
// sie in einer Transaktion und waere nicht messbar (dasselbe Verhaeltnis wie bei
// avesmapsApplyPowerlineWikiNoArticle daneben).
// 🪤 Und zwar MIT der public_id des Segments, nicht bloss mit dem Funktionsnamen: eine
// Zusicherung, die beim Komma endet, trifft auch `..., '')` -- dann wirkte kein einziger
// Segmentwert, und die Kartenangabe waere stumm wirkungslos. Am 29.08.2026 per Mutationsprobe
// gefunden.
assert(str_contains($rumpf, "avesmapsApplyPowerlineCurve(\$properties, \$payload, (string) \$row['public_id'])"),
    'der Linien-Schreibweg reicht die public_id des Segments nicht an die Kurven-Regel durch');
// 💣 Und er darf den Wert NICHT mehr selbst mit ?? 0 aus dem Rumpf lesen -- das waere genau die
// stille Loeschung, gegen die Abschnitt 2b steht.
assert(!str_contains($rumpf, "avesmapsReadPowerlineCurve(\$payload['curve'] ?? 0)"),
    'der Schreibweg liest curve wieder mit ?? 0 -- das loescht jede Ausnahme lautlos');
assert(str_contains($rumpf, "'curve' => "),
    'curve fehlt im Audit-Eintrag -- eine Aenderung ohne Protokoll ist nicht umkehrbar');

// ---- 4. Der ZWEITE Schreibweg laesst curve UNBERUEHRT ----------------------------------------
// 🔴 avesmapsUpdatePowerlineFeatureDetails (Aktion update_powerline_details) schreibt EIN Segment
// und kennt die Kurve nicht. Er darf sie auch nicht loeschen: er liest die vorhandenen
// Eigenschaften und setzt nur seine eigenen Felder darauf. Diese Zusicherung haelt fest, dass das
// so BLEIBT -- ein spaeteres `$properties = [...]` statt `$properties['x'] = ...` risse die Kurve
// jedes Segments mit, das ueber diesen Weg gespeichert wird.
assert(preg_match('/function avesmapsUpdatePowerlineFeatureDetails\(.*?\n\}/s', (string) $ohneKommentare, $t2) === 1);
assert(str_contains($t2[0], 'avesmapsDecodeJsonColumnForEdit($feature[\'properties_json\']'),
    'der Segment-Schreibweg liest die vorhandenen Eigenschaften nicht mehr -- er wuerde curve loeschen');
assert(!str_contains($t2[0], "unset(\$properties['curve'])"));

// ---- 5. Der Lesefeed projiziert curve --------------------------------------------------------
// ⚠️ Ausdruecklich: fehlt die Projektion, saehe der Editor immer 0, und weil das Speichern den Wert
// IMMER mitschickt, loeschte der naechste Speichervorgang die Kurve -- auch eine reine
// Beschreibungsaenderung. Dieselbe Falle, die wiki_no_article in derselben Datei gekostet hat.
$feed = file_get_contents(__DIR__ . '/../../../edit/map/powerlines.php');
assert(is_string($feed));
assert(str_contains($feed, "'curve' => avesmapsReadPowerlineCurve("),
    'api/edit/map/powerlines.php projiziert curve nicht in die Segmentliste');

echo "OK: Kraftlinien-Kurve -- Leser, Erb-Liste, beide Schreibwege, Lesefeed.\n";
