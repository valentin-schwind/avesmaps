<?php

declare(strict_types=1);

/**
 * DER EINGANG DER MELDUNGSQUELLEN (Entwurf 2026-09-03-quellen-meldeformular §4).
 *
 * 🔴 Der Link ist die Quelle: eine Zeile braucht `url` ODER `source_id > 0`. `official` und `type` werden
 * nicht mehr uebernommen -- auch nicht von einem alten Client. Titel, Seite, Abdeckung, Lizenz,
 * Namensnennung reisen als Angebote mit. Eingang und Ausgabe stehen EINMAL (report-sources.php).
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/meldung-quellen-eingang-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../report-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

// ── 1) Der Link ist die Quelle ────────────────────────────────────────────────────────────────
$aus = avesmapsNormalizeReportSources([
    ['url' => 'https://wiki.punin.de/Baronie_Bitterbusch', 'pages' => ' 12 '],
    ['label' => 'Nur ein Name', 'type' => 'abenteuer', 'official' => true],           // faellt
    ['source_id' => 812, 'label' => 'Die Flusslande', 'pages' => '40-41'],            // Katalogtreffer
    ['url' => 'https://x.example/seite', 'label' => 'Titel vom Melder', 'reference_kind' => 'erwaehnung',
        'license' => 'cc-by-sa-4.0', 'attribution' => ' VolkoV / garetien.de ', 'type' => 'abenteuer', 'official' => true],
    'kein Objekt',
]);
assert(count($aus) === 3, 'ein Name allein ist keine Quelle; drei Zeilen bleiben: ' . json_encode($aus));
$zaehl();
assert($aus[0] === ['source_id' => 0, 'url' => 'https://wiki.punin.de/Baronie_Bitterbusch', 'label' => '', 'pages' => '12', 'type' => '', 'official' => false,
    'reference_kind' => '', 'license' => '', 'attribution' => ''], 'die Link-Zeile: Adresse, Seite, sonst leer: ' . json_encode($aus[0]));
$zaehl();
assert($aus[1]['source_id'] === 812 && $aus[1]['url'] === '' && $aus[1]['label'] === 'Die Flusslande', 'der Katalogtreffer reist per Kennung');
$zaehl();
assert($aus[2]['label'] === 'Titel vom Melder' && $aus[2]['reference_kind'] === 'erwaehnung' && $aus[2]['license'] === 'cc-by-sa-4.0'
    && $aus[2]['attribution'] === 'VolkoV / garetien.de', 'die Angebote reisen mit: ' . json_encode($aus[2]));
$zaehl();
assert($aus[2]['type'] === '' && $aus[2]['official'] === false, '💣 `type` und `official` werden NICHT uebernommen -- auch wenn der (alte) Client sie schickt');
$zaehl();

// ── 2) Riegel und Kappungen ───────────────────────────────────────────────────────────────────
assert(avesmapsNormalizeReportSources(null) === [] && avesmapsNormalizeReportSources('x') === [], 'kein Array: leer');
assert(avesmapsNormalizeReportSources([['url' => 'https://x/y', 'reference_kind' => 'wichtig']])[0]['reference_kind'] === '', 'eine unbekannte Abdeckung faellt auf leer');
assert(avesmapsNormalizeReportSources([['url' => 'https://x/y', 'license' => 'irgendwas']])[0]['license'] === '', 'ein unbekannter Lizenzschluessel faellt auf „nicht erfasst“, nie auf eine Aussage');
assert(count(avesmapsNormalizeReportSources(array_fill(0, 14, ['url' => 'https://x/y']))) === AVESMAPS_REPORT_SOURCES_MAX, 'gedeckelt auf ' . AVESMAPS_REPORT_SOURCES_MAX);
assert(avesmapsNormalizeReportSources([['source_id' => -5, 'url' => '']]) === [], 'eine negative Kennung ist keine');
$zaehl();
$fehler = null;
try {
    avesmapsNormalizeReportSources([['url' => 'javascript:alert(1)']]);
} catch (InvalidArgumentException $e) {
    $fehler = $e;
}
assert($fehler !== null, 'eine Nicht-http-Adresse wird abgelehnt (avesmapsNormalizeOptionalUrl), nicht stillschweigend gespeichert');
$zaehl();

// ── 3) Die Ausgabe: nachsichtig mit dem Altbestand, vollstaendig fuer die Redaktion ───────────
$alt = json_encode([
    ['url' => '', 'label' => 'Von Eigenen Gnaden', 'pages' => '', 'type' => 'sonstiges', 'official' => true],
    ['url' => 'https://x/y', 'label' => 'Neu', 'source_id' => 0, 'license' => 'cc-by-sa-4.0', 'attribution' => 'A', 'reference_kind' => 'ergaenzend'],
    ['source_id' => 812, 'label' => 'Die Flusslande'],
]);
$liste = avesmapsDecodeReportSources($alt);
assert(count($liste) === 3, 'alle drei gespeicherten Zeilen kommen zurueck');
assert($liste[0]['label'] === 'Von Eigenen Gnaden' && $liste[0]['url'] === '' && $liste[0]['official'] === true && $liste[0]['type'] === 'sonstiges',
    'eine ALTE link-lose Zeile wird gezeigt, wie sie ist -- die Annahme kann sie nur nicht verknuepfen');
assert($liste[1]['license'] === 'cc-by-sa-4.0' && $liste[1]['attribution'] === 'A' && $liste[1]['reference_kind'] === 'ergaenzend', 'die Angebote kommen bei der Redaktion an');
assert($liste[2]['source_id'] === 812, '💣 source_id reist zur Redaktion -- der Decoder liess sie bis zum 03.09.2026 fallen');
assert(array_keys($liste[0]) === ['source_id', 'url', 'label', 'pages', 'type', 'reference_kind', 'license', 'attribution', 'official'], 'jede Zeile hat dieselbe Form, auch die alte');
$zaehl();
assert(avesmapsDecodeReportSources(null, ' Altform ') === [['source_id' => 0, 'url' => '', 'label' => 'Altform', 'pages' => '', 'type' => '',
    'reference_kind' => '', 'license' => '', 'attribution' => '', 'official' => false]], 'die Altform `source` (Freitext) wird eine link-lose Zeile');
assert(avesmapsDecodeReportSources('[{"pages":"3"}]') === [], 'eine Zeile ohne Titel, Adresse und Kennung ist nichts');
$zaehl();

// ── 4) EINE Stelle: beide Endpunkte holen sich die zwei Funktionen von hier ───────────────────
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
    return $aus;
};
$melder = $ohneKommentare(__DIR__ . '/../../../app/report-location.php');
$redaktion = $ohneKommentare(__DIR__ . '/../../../edit/reports/locations.php');
assert(!str_contains($melder, 'function avesmapsNormalizeReportSources') && str_contains($melder, "report-sources.php'"), 'der Melder-Endpunkt definiert den Eingang nicht mehr selbst, er laedt die Bibliothek');
assert(!str_contains($redaktion, 'function avesmapsDecodeReportSources') && str_contains($redaktion, "report-sources.php'"), 'der Review-Endpunkt definiert den Decoder nicht mehr selbst, er laedt die Bibliothek');
$zaehl();
assert(str_contains($melder, "'source_id' => 0, 'url' => '', 'label' => \$legacySource"), 'der Rueckfall auf das Altfeld `source` traegt dieselbe Form');
assert(str_contains($melder, "\$sources[0]['label'] !== '' ? \$sources[0]['label'] : \$sources[0]['url']"), 'die Anzeige-Spalte `source` faellt ohne Titel auf die Adresse zurueck');
$zaehl();

echo "meldung-quellen-eingang: {$pruefungen} Pruefungen bestanden\n";
