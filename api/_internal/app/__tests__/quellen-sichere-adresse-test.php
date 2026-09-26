<?php

declare(strict_types=1);

/**
 * Nur http:// und https:// kommen in den Quellenkatalog -- an ALLEN drei Tueren.
 * Ausfuehren (vom Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/quellen-sichere-adresse-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 *
 * 💣 WARUM ES DAS GIBT (26.09.2026): Jede Katalogadresse wird in der Infobox, die jeder Besucher
 * sieht, als `<a href>` ausgegeben. Das Bearbeiten der Adresse pruefte das Protokoll schon, das
 * ANLEGEN nicht -- eine Quelle `javascript:alert(1)` liess sich eintragen. Die Anzeige prueft seither
 * selbst (featureSourceSichereUrl, js/ui/__tests__/quellen-sichere-adresse.test.js); dieser Test haelt
 * die Server-Seite: EINE Regel (avesmapsFeatureSourceUrlErlaubt), drei Aufrufer.
 *
 * ⚠️ Der Anlege-Weg laeuft sonst ueber einen MySQL-Upsert (`ON DUPLICATE KEY UPDATE`), der auf SQLite
 * nicht faehrt. Geprueft wird deshalb, dass er WIRFT, BEVOR er die Datenbank beruehrt -- gegen eine
 * leere SQLite-Datenbank, in der danach keine einzige Tabelle stehen darf. Die zwei uebrigen Tueren
 * werden am Quelltext geprueft (Tokenizer, ohne Kommentare): sie sind Endpunkt-Code bzw. schon in
 * quellen-bearbeiten-test.php ausgefuehrt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$wurzel = dirname(__DIR__, 4);

// ══ 1. Die Regel selbst ════════════════════════════════════════════════════════════════════════
$boese = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    "\x01javascript:alert(1)",
    "javascript:fetch('https://boese.de')", // traegt https:// weiter hinten -- faengt einen fehlenden Anker
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://beispiel.de/x',
    'https:beispiel.de',
    '//beispiel.de/protokollrelativ',
    '/uploads/relativ.pdf',
    'beispiel.de/ohne-schema',
    '',
    '   ',
];
foreach ($boese as $adresse) {
    assert(avesmapsFeatureSourceUrlErlaubt($adresse) === false, 'durchgelassen: ' . json_encode($adresse));
    $pruefungen++;
}
foreach (['https://beispiel.de/a?b=1', 'http://beispiel.de', 'HTTPS://Beispiel.de', '  https://beispiel.de  '] as $adresse) {
    assert(avesmapsFeatureSourceUrlErlaubt($adresse) === true, 'abgewiesen: ' . json_encode($adresse));
    $pruefungen++;
}
echo "1. Regel: OK\n";

// ══ 2. Anlegen wirft VOR jedem Schreibvorgang ══════════════════════════════════════════════════════
foreach (['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', ' javascript:alert(1)'] as $adresse) {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $geworfen = null;
    try {
        avesmapsAddFeatureSource($pdo, 'settlement', 'ort-1', $adresse, 'Boese', '', false, 9);
    } catch (InvalidArgumentException $e) {
        $geworfen = $e->getMessage();
    }
    assert($geworfen === AVESMAPS_FEATURE_SOURCE_URL_FEHLER, 'Anlegen hat nicht mit dem Haussatz geworfen: ' . json_encode($adresse));
    // Nicht einmal die Tabellen sind angelegt: die Pruefung steht vor `avesmapsEnsureFeatureSourceTables`.
    $tabellen = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'")->fetchColumn();
    assert($tabellen === 0, 'Anlegen hat die Datenbank beruehrt, bevor es die Adresse pruefte');
    $pruefungen += 2;
}
echo "2. Anlegen: OK\n";

// ══ 3. Der Endpunkt macht aus der Ausnahme ein 400 invalid_request ════════════════════════════════
/** Quelltext ohne Kommentare -- eine Warnung im Kommentar darf keine Zusicherung erfuellen. */
function avesmapsSichereAdresseTestCode(string $datei): string
{
    $aus = '';
    foreach (token_get_all((string) file_get_contents($datei)) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $aus .= is_array($token) ? $token[1] : $token;
    }

    return $aus;
}

$endpunkt = avesmapsSichereAdresseTestCode($wurzel . '/api/edit/map/feature-sources.php');
assert(preg_match("/catch \\(InvalidArgumentException \\\$exception\\) \\{\\s*avesmapsErrorResponse\\(400, 'invalid_request'/", $endpunkt) === 1,
    'der Endpunkt muss InvalidArgumentException als 400 invalid_request beantworten');
$pruefungen++;
echo "3. Endpunkt: OK\n";

// ══ 4. Bearbeiten und Meldungsannahme fragen DIESELBE Regel ═══════════════════════════════════════
$bibliothek = avesmapsSichereAdresseTestCode($wurzel . '/api/_internal/app/feature-sources.php');
assert(substr_count($bibliothek, "preg_match('#^https?://#i'") === 1,
    'die Regel darf in der Bibliothek genau EINMAL stehen (in avesmapsFeatureSourceUrlErlaubt)');
assert(preg_match('/if \(!avesmapsFeatureSourceUrlErlaubt\(\$adresse\)\) \{\s*return avesmapsFeatureSourceUpdateError\(400, \'invalid_request\', AVESMAPS_FEATURE_SOURCE_URL_FEHLER\)/', $bibliothek) === 1,
    'das Bearbeiten der Adresse muss avesmapsFeatureSourceUrlErlaubt fragen');
$pruefungen += 2;

$meldung = avesmapsSichereAdresseTestCode($wurzel . '/api/edit/reports/locations.php');
$pruefStelle = strpos($meldung, 'avesmapsFeatureSourceUrlErlaubt($quellenUrl)');
$anlegeStelle = strpos($meldung, 'avesmapsAddFeatureSource(');
assert($pruefStelle !== false, 'die Meldungsannahme muss avesmapsFeatureSourceUrlErlaubt fragen');
assert($anlegeStelle !== false && $pruefStelle < $anlegeStelle, 'die Pruefung muss VOR dem Anlegen stehen');
assert(preg_match('/if \(\$quellenUrl === \'\' \|\| !avesmapsFeatureSourceUrlErlaubt\(\$quellenUrl\)\) \{\s*continue;/', $meldung) === 1,
    'eine unsichere Adresse wird UEBERSPRUNGEN, nicht geworfen -- sonst bricht die ganze Annahme ab');
$pruefungen += 3;
echo "4. Bearbeiten + Meldung: OK\n";

echo "quellen-sichere-adresse: {$pruefungen} Pruefungen, alle gruen\n";
