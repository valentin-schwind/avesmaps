<?php

declare(strict_types=1);

/**
 * „Was ist das fuer eine Adresse?" — Katalog, Korpus und die Reihenfolge dazwischen.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §3.4 + §4
 *
 * ⚠️ Der ABRUF selbst wird hier nicht gefahren -- ein Test, der fremde Server braucht, ist kein
 * Test (`linkcheck/link-url-test.php` ist genau deshalb der einzige dauerhaft rote im Feld). Der
 * Abruf ist am 02.09.2026 gegen die drei echten Wirte gemessen: punin.de „Baronie Taubental" /
 * Almada Wiki · westlande.de „Apfeldorn" / AlberniaWiki · herzogtum-weiden.net „Herzogenstadt
 * Trallop" ohne Wirtsnamen; eine tote Seite ergab 404/unerreichbar. Gelesen wird das Markup von
 * `page-title-test.php`, und zwar an echten Fixturen.
 *
 * Fahren: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *             -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/source-inspect-test.php
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../source-inspect.php';

$anzahl = 0;
$zaehl = static function () use (&$anzahl): void {
    $anzahl++;
};

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
avesmapsEnsureSourceCorpusTable($pdo);

$pdo->prepare(
    'INSERT INTO source_corpus (corpus_key, label, form, source_type, license, attribution, is_official)
     VALUES (:k, :l, :f, :t, :lic, :a, 0)'
)->execute([
    'k' => 'herzogtum-weiden.net', 'l' => 'Briefspiel (Weiden)', 'f' => 'belegstelle',
    't' => 'briefspiel', 'lic' => 'cc-by-nc-sa-3.0', 'a' => 'VolkoV',
]);

// ══ 1 · Die leere Adresse ═══════════════════════════════════════════════════════════════════════

$leer = avesmapsSourceInspectUrl($pdo, '   ');
assert($leer['state'] === 'keine_pruefung' && $leer['corpus'] === null,
    'eine leere Adresse wird nicht geprueft und hat keinen Korpus');
$zaehl();

// ══ 2 · Der Korpus kommt lokal, ohne jeden Abruf ════════════════════════════════════════════════

$lokal = avesmapsSourceInspectUrl($pdo, 'https://www.herzogtum-weiden.net/politik/liste-st/staedte/reichsstadt-baliho', false);
assert($lokal['corpus']['label'] === 'Briefspiel (Weiden)' && $lokal['corpus']['form'] === 'belegstelle',
    'eine nie gesehene Unterseite bekommt ihren Korpus rein aus der Adresse');
$zaehl();
assert($lokal['corpus']['source_type'] === 'briefspiel' && $lokal['corpus']['attribution'] === 'VolkoV',
    'samt Art und Namensnennung -- der Editor muss davon nichts mehr eintippen');
$zaehl();
assert($lokal['state'] === 'keine_pruefung' && $lokal['existing'] === null,
    'ohne Abruf gibt es keinen Zustand und keinen Katalogtreffer');
$zaehl();

// Ein unbekannter Wirt ist kein Fehler -- er traegt seinen Schluessel als Beschriftung.
$fremd = avesmapsSourceInspectUrl($pdo, 'https://kahet-ni-kemi.de/seite', false);
assert($fremd['corpus']['label'] === 'kahet-ni-kemi.de' && ($fremd['corpus']['known'] ?? true) === false,
    'ein unbekannter Wirt bekommt Schluessel als Beschriftung und ist als unbekannt gekennzeichnet');
$zaehl();

// ══ 3 · Die BEKANNTE Seite -- und die Reihenfolge, die sie schuetzt ═════════════════════════════

// 🔴 DIE TRAGENDE ZUSICHERUNG DIESES TESTS. Die Adresse zeigt auf `.invalid` (RFC 2606, kann
// niemals aufloesen). Wuerde der fruehe Ausstieg fehlen, liefe die Auskunft in den Abruf und
// meldete `unerreichbar` -- der Editor saehe ROT fuer eine Seite, die laengst im Katalog steht.
// Der Test misst damit die REIHENFOLGE zur Laufzeit, nicht nur im Quelltext.
// ⚠️ Die Zeilen werden hier von Hand angelegt, NICHT ueber `avesmapsFeatureSourceUpsert` /
// `avesmapsFeatureSourceLink`: beide fahren MySQLs `ON DUPLICATE KEY UPDATE`, das SQLite nicht
// kennt. 🔴 Und das ist kein Grund, die Produktionsform zu verbiegen -- ein Test, der die
// Schreibform umbaut, damit er laeuft, hat den Test gegen die Produktion gedreht (AGENTS.md §9,
// der MySQL-1093-Fall). Geprueft wird hier die LESERICHTUNG; das Schreiben hat eigene Tests.
$bekannteUrl = 'https://beispiel.invalid/eine-seite';
$pdo->prepare('INSERT INTO sources (url, url_hash, label, source_type, is_official) VALUES (:u, :h, :l, :t, 0)')
    ->execute([
        'u' => $bekannteUrl, 'h' => avesmapsFeatureSourceHash($bekannteUrl),
        'l' => 'Herzogenstadt Trallop', 't' => 'briefspiel',
    ]);
$sourceId = (int) $pdo->lastInsertId();
assert($sourceId > 0, 'die Katalogzeile steht');
$zaehl();
$link = $pdo->prepare(
    "INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status) VALUES ('settlement', :id, :sid, 'approved')"
);
$link->execute(['id' => 'ort-1', 'sid' => $sourceId]);
$link->execute(['id' => 'ort-2', 'sid' => $sourceId]);

$bekannt = avesmapsSourceInspectUrl($pdo, $bekannteUrl); // MIT Abruf -- und trotzdem kein Abruf
assert($bekannt['state'] === 'bekannt',
    'eine bekannte Seite wird sofort gruen -- OHNE den fremden Server zu fragen');
$zaehl();
assert($bekannt['http_status'] === 0, 'es wurde wirklich nicht gefragt (kein Statuscode)');
$zaehl();
assert($bekannt['existing']['source_id'] === $sourceId, 'die bestehende Zeile wird benannt');
$zaehl();
assert($bekannt['existing']['usage_count'] === 2,
    'samt der Zahl der Objekte, die sie zitieren -- die Zahl, die vor einer Aenderung warnt');
$zaehl();

// ⚠️ Der GESPEICHERTE Titel gewinnt und wird gemeldet. Genau das tut der Upsert auch (`label`
// fuellt nur eine Luecke); ihn zu verschweigen hiesse, die Oberflaeche muesste ihn erraten.
assert($bekannt['title'] === 'Herzogenstadt Trallop', 'der gespeicherte Titel kommt mit');
$zaehl();

// Auch die bekannte Seite bringt ihren Korpus mit -- er haengt an der Adresse, nicht am Treffer.
assert($bekannt['corpus']['corpus_key'] === 'beispiel.invalid', 'der Korpus reist auch hier mit');
$zaehl();

// ══ 4 · Was der Zustand bedeuten darf ═══════════════════════════════════════════════════════════

// 💣 DREI Zustaende, nicht zwei. „erreichbar" (Link gut, Titel fehlt) darf weder als Erfolg noch
// als Fehlschlag gelten -- sonst sucht der Editor einen Fehler am Link, den es nicht gibt.
assert(in_array('erreichbar', AVESMAPS_SOURCE_INSPECT_STATES, true)
    && in_array('gelesen', AVESMAPS_SOURCE_INSPECT_STATES, true)
    && in_array('unerreichbar', AVESMAPS_SOURCE_INSPECT_STATES, true),
    'die drei Abruf-Zustaende stehen getrennt nebeneinander');
$zaehl();
assert(count(AVESMAPS_SOURCE_INSPECT_STATES) === count(array_unique(AVESMAPS_SOURCE_INSPECT_STATES)),
    'und keiner doppelt');
$zaehl();
foreach ([$leer, $lokal, $fremd, $bekannt] as $auskunft) {
    assert(in_array($auskunft['state'], AVESMAPS_SOURCE_INSPECT_STATES, true),
        'jede Auskunft traegt einen der erklaerten Zustaende: ' . $auskunft['state']);
}
$zaehl();

// ══ 5 · Der Wirtsname ueberschreibt nie einen gepflegten Korpusnamen ════════════════════════════

// 💣 Diese Regel wird im Quelltext festgenagelt, weil sie nur im Abruf-Zweig wirkt: der Vorschlag
// haengt an `known !== true`. Ohne ihn benaennte der erste Abruf auf einer BEKANNTEN Domain den
// Korpus um -- und das traefe alle seine Quellen auf einmal.
$quelltext = (string) file_get_contents(__DIR__ . '/../source-inspect.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^[ \t]*//.*$#m', '', $quelltext) ?? '';
assert(preg_match("/\(\\\$korpus\['known'\] \?\? false\) !== true/", $ohneKommentare) === 1,
    'ein Wirtsname wird nur vorgeschlagen, wo der Korpus noch unbekannt ist');
$zaehl();
// Und er landet in einem EIGENEN Feld, nie in `label` -- ein Vorschlag ist keine Beschriftung.
assert(strpos($ohneKommentare, "'label_suggestion'") !== false
    && preg_match("/\\\$auskunft\['corpus'\]\['label'\] =/", $ohneKommentare) !== 1,
    'der Vorschlag steht neben der Beschriftung, nicht darin');
$zaehl();

echo "OK — {$anzahl} Zusicherungen (Adressauskunft: Katalog, Korpus, Reihenfolge)\n";
