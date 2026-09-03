<?php

declare(strict_types=1);

/**
 * DIE VORBELEGUNG DER GEMELDETEN QUELLEN UND DIE KORPUSWERTE FUER NEUE KATALOGZEILEN
 * (Entwurf 2026-09-03-quellen-meldeformular §5.1, §5.2, §6.3).
 *
 *   1. avesmapsReportSourceVorbelegung: bekannt / katalog / neu / ohne_link -- in der Form der Adressauskunft,
 *      mit Korpus und Reichweite aus dem Vorrat, OHNE Abruf und OHNE Volltabellenlauf je Quelle.
 *   2. avesmapsReportSourcesMitVorbelegung: der Vorrat wird EINMAL gefuellt und weitergereicht.
 *   3. avesmapsFeatureSourceKorpusVorgaben (rein): Leeres kommt vom Korpus, „offiziell“ nur ohne
 *      ausdrueckliche Wahl; ein unbekannter Wirt gibt nichts vor.
 *   4. Quelltext: avesmapsAddFeatureSource ruft die Vorgaben NUR fuer eine neue Zeile; die Karten-Annahme
 *      reicht weder Art noch „offiziell“ aus der Meldung weiter und verknuepft Katalogtreffer per Kennung.
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/meldung-vorbelegung-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../report-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
avesmapsEnsureSourceCorpusTable($pdo);
$pdo->exec("INSERT INTO source_corpus (corpus_key, label, form, source_type, license, attribution, is_official)
    VALUES ('garetien.de', 'Garetien-Wiki', 'belegstelle', 'briefspiel', 'cc-by-nc-sa-3.0', 'VolkoV / garetien.de', 0)");
$url = 'https://www.garetien.de/index.php/Baronie_Hirschfurten';
$pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([812, $url, avesmapsFeatureSourceHash($url), 'Baronie Hirschfurten', 'briefspiel', 0, 'cc-by-nc-sa-3.0', 'VolkoV / garetien.de']);
$pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([813, '', avesmapsFeatureSourceHash('', 'wiki:die-flusslande'), 'Die Flusslande', 'regionalspielhilfe', 1, '', '']);
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin) VALUES ('settlement', 'ort-1', 812, 'approved', 'manual')");
$korpora = avesmapsSourceCorpusReadAll($pdo);
$reichweite = ['garetien.de' => ['sources' => 45, 'objects' => 161]];

// ── 1) Die vier Staende ───────────────────────────────────────────────────────────────────────
$bekannt = avesmapsReportSourceVorbelegung($pdo, ['url' => $url, 'source_id' => 0], $korpora, $reichweite);
assert($bekannt['state'] === 'bekannt' && $bekannt['existing']['source_id'] === 812 && $bekannt['title'] === 'Baronie Hirschfurten',
    'bekannte Adresse: existing samt Titel: ' . json_encode($bekannt));
assert($bekannt['existing']['license'] === 'cc-by-nc-sa-3.0' && $bekannt['existing']['is_official'] === false, '… mit allen Katalogfeldern');
assert($bekannt['existing']['usage_count'] === 1, '… samt usage_count wie die Adressauskunft -- der Annahme-Dialog sagt daraus „Zitiert an N Objekten“: ' . json_encode($bekannt['existing']));
assert($bekannt['corpus']['known'] === true && $bekannt['corpus']['label'] === 'Garetien-Wiki' && $bekannt['corpus']['sources'] === 45 && $bekannt['corpus']['objects'] === 161,
    '… der Korpus samt Reichweite aus dem Vorrat: ' . json_encode($bekannt['corpus']));
assert(array_keys($bekannt) === ['url', 'state', 'http_status', 'title', 'site', 'corpus', 'existing'], 'dieselbe Form wie die Adressauskunft der Eingabezeile');
$zaehl();

$katalog = avesmapsReportSourceVorbelegung($pdo, ['url' => '', 'source_id' => 813], $korpora, $reichweite);
assert($katalog['state'] === 'katalog' && $katalog['existing']['label'] === 'Die Flusslande' && $katalog['corpus'] === null,
    'Katalogtreffer ohne Adresse: existing per Kennung, kein Korpus: ' . json_encode($katalog));
$zaehl();

$neuBekannt = avesmapsReportSourceVorbelegung($pdo, ['url' => 'https://www.garetien.de/index.php/Baronie_Neu', 'source_id' => 0], $korpora, $reichweite);
assert($neuBekannt['state'] === 'neu' && $neuBekannt['existing'] === null && $neuBekannt['corpus']['known'] === true && $neuBekannt['corpus']['source_type'] === 'briefspiel',
    'neue Seite eines bekannten Korpus: kein existing, der Korpus gibt vor: ' . json_encode($neuBekannt));
$neuFremd = avesmapsReportSourceVorbelegung($pdo, ['url' => 'https://example.org/aventurien/seite.html', 'source_id' => 0], $korpora, $reichweite);
assert($neuFremd['state'] === 'neu' && $neuFremd['corpus']['known'] === false && $neuFremd['corpus']['corpus_key'] === 'example.org' && $neuFremd['corpus']['objects'] === 0,
    'unbekannter Wirt: known=false, Schluessel benannt, Reichweite 0: ' . json_encode($neuFremd));
assert($neuFremd['title'] === '' && $neuFremd['http_status'] === 0, 'KEIN Abruf: kein Titel, kein Status');
$zaehl();

$alt = avesmapsReportSourceVorbelegung($pdo, ['url' => '', 'source_id' => 0, 'label' => 'Von Eigenen Gnaden'], $korpora, $reichweite);
assert($alt['state'] === 'ohne_link' && $alt['existing'] === null && $alt['corpus'] === null, 'Altform ohne Adresse und Kennung: ohne_link');
$unbekannteKennung = avesmapsReportSourceVorbelegung($pdo, ['url' => '', 'source_id' => 99999], $korpora, $reichweite);
assert($unbekannteKennung['state'] === 'ohne_link' && $unbekannteKennung['existing'] === null, 'eine Kennung, die es nicht gibt, ist keine Vorbelegung');
$zaehl();

// ── 2) Der Vorrat wird einmal gefuellt ────────────────────────────────────────────────────────
$vorrat = null;
$liste = avesmapsReportSourcesMitVorbelegung($pdo, [['url' => $url, 'source_id' => 0], ['url' => '', 'source_id' => 813]], $vorrat);
assert(count($liste) === 2 && $liste[0]['vorbelegung']['state'] === 'bekannt' && $liste[1]['vorbelegung']['state'] === 'katalog', 'jede Quelle traegt ihre Vorbelegung');
assert(is_array($vorrat) && isset($vorrat['korpora']['garetien.de']) && isset($vorrat['reichweite']), 'der Vorrat ist gefuellt und wird weitergereicht');
$vorrat['reichweite']['garetien.de'] = ['sources' => 7, 'objects' => 9];
$zweite = avesmapsReportSourcesMitVorbelegung($pdo, [['url' => $url, 'source_id' => 0]], $vorrat);
assert($zweite[0]['vorbelegung']['corpus']['objects'] === 9, 'ein zweiter Aufruf liest den Vorrat, statt neu zu rechnen');
assert(avesmapsReportSourcesMitVorbelegung($pdo, [], $vorrat) === [], 'leer bleibt leer');
$zaehl();

// ── 3) Die Korpuswerte fuer eine NEUE Zeile (rein) ────────────────────────────────────────────
$k = $korpora['garetien.de'] + ['known' => true];
$v = avesmapsFeatureSourceKorpusVorgaben($k, '', '', '', false, false);
assert($v === ['type' => 'briefspiel', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de', 'official' => false], 'Leeres kommt vom Korpus: ' . json_encode($v));
$v = avesmapsFeatureSourceKorpusVorgaben($k, 'abenteuer', 'cc-by-sa-4.0', 'Ich', true, true);
assert($v === ['type' => 'abenteuer', 'license' => 'cc-by-sa-4.0', 'attribution' => 'Ich', 'official' => true], 'Gesagtes bleibt -- auch offiziell bei ausdruecklicher Wahl');
$v = avesmapsFeatureSourceKorpusVorgaben($k, 'abenteuer', '', '', true, false);
assert($v['official'] === false && $v['type'] === 'abenteuer', '„offiziell“ ohne ausdrueckliche Wahl kommt vom Korpus, die gewaehlte Art bleibt');
$v = avesmapsFeatureSourceKorpusVorgaben(['corpus_key' => 'example.org', 'known' => false, 'source_type' => 'briefspiel'], '', '', '', true, false);
assert($v === ['type' => '', 'license' => '', 'attribution' => '', 'official' => true], 'ein unbekannter Wirt gibt nichts vor');
assert(avesmapsFeatureSourceKorpusVorgaben(null, 'x', 'y', 'z', false, false) === ['type' => 'x', 'license' => 'y', 'attribution' => 'z', 'official' => false], 'ohne Korpus unveraendert');
$zaehl();

// ── 4) Quelltext: die Naehte ─────────────────────────────────────────────────────────────────
$ohneKommentare = static function (string $pfad): string {
    $aus = '';
    foreach (token_get_all((string) file_get_contents($pfad)) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $aus .= $token[1];
        } else {
            $aus .= $token;
        }
    }
    return str_replace("\r\n", "\n", $aus);
};
$schnitt = static function (string $quelle, string $kopf): string {
    $s = strpos($quelle, $kopf);
    assert($s !== false, 'Funktion fehlt: ' . $kopf);
    $e = strpos($quelle, "\nfunction ", $s + 10);
    return substr($quelle, $s, ($e === false ? strlen($quelle) : $e) - $s);
};
$lib = $ohneKommentare(__DIR__ . '/../feature-sources.php');
$add = $schnitt($lib, 'function avesmapsAddFeatureSource(');
assert(str_contains($add, "if (\$bestehendeZeile === null && function_exists('avesmapsSourceCorpusForUrl')) {"), 'die Vorgaben gelten NUR einer neuen Zeile');
assert(strpos($add, 'avesmapsFeatureSourceKorpusVorgaben(') < strpos($add, 'avesmapsFeatureSourceUpsert('), '… und laufen VOR dem Upsert');
$zaehl();
$review = $ohneKommentare(__DIR__ . '/../../../edit/reports/locations.php');
$karte = $schnitt($review, 'function avesmapsCreateCitymapFromReport(');
assert(str_contains($karte, "avesmapsLinkExistingFeatureSource(\$pdo, 'citymap', \$citymapPublicId, \$quellenId, \$userId,"), 'Katalogtreffer werden per Kennung verknuepft');
assert(preg_match('/avesmapsAddFeatureSource\(\s*\$pdo,\s*\'citymap\',\s*\$citymapPublicId,\s*\$quellenUrl,\s*\(string\) \(\$source\[\'label\'\] \?\? \'\'\),\s*\'\',\s*false,/', $karte) === 1,
    'die Karten-Annahme reicht weder Art noch „offiziell“ aus der Meldung weiter');
assert(str_contains($karte, "\$korpusBekannt ? '' : (string) (\$source['license'] ?? '')"), 'Lizenz des Melders nur, wo der Korpus nichts vorgibt');
assert(!str_contains($karte, "(bool) (\$source['official'] ?? false)"), 'kein Haken des Melders mehr im Annahmeweg');
$zaehl();
$listenFunktion = $schnitt($review, 'function avesmapsListLocationReportsForReview(');
assert(substr_count($listenFunktion, 'avesmapsReportSourcesMitVorbelegung(') === 2, 'BEIDE Tabellen der Liste (map_reports, location_reports) bekommen die Vorbelegung');
assert(str_contains($listenFunktion, '$quellenVorrat = null;'), '… mit einem Vorrat je Liste');
$zaehl();

echo "meldung-vorbelegung: {$pruefungen} Pruefungen bestanden\n";
