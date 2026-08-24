<?php

declare(strict_types=1);

// 💣 EIN NEUER ENDPUNKT GEHT NICHT UNGEPRUEFT LIVE, und geprueft wird der LESEpfad.
//
// Der Wege-Editor ging am 19.08.2026 mit einem Leser live, den nie etwas angefasst hatte, und
// stuerzte beim ersten Klick ab: eine `const` stand hinter dem try-Block, und PHP hoistet
// Funktionen, aber keine `const` auf Dateiebene. Ein Fatal Error antwortet mit einem LEEREN Rumpf
// -- im Browser „Unexpected end of JSON input", sieht aus wie ein Netzfehler.
//
// ⚠️ Der Test faehrt die Endpunkte nicht (dafuer braeuchte er Sitzung und Datenbank), er liest die
// Quelle. Was er belegt, ist genau das, was an einem frisch gebauten Endpunkt schiefgeht.
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/ecosystem-display-endpunkt-test.php

$wurzel = __DIR__ . '/../../../..';
$dateien = ['api/app/ecosystem-display.php', 'api/edit/map/ecosystem-display.php'];

// ---- A. Beide Dateien sind syntaktisch heil ---------------------------------------------------
foreach ($dateien as $datei) {
    $pfad = $wurzel . '/' . $datei;
    assert(is_file($pfad), "{$datei} existiert");
    $ausgabe = [];
    $code = 0;
    exec('php -l ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
    assert($code === 0, "{$datei} ist syntaktisch heil: " . implode(' ', $ausgabe));
}

// ---- B. 💣 Jede `const` auf Dateiebene steht VOR ihrer ersten Benutzung ------------------------
foreach ($dateien as $datei) {
    $quelle = (string) file_get_contents($wurzel . '/' . $datei);
    if (preg_match_all('/^const\s+([A-Z_][A-Z0-9_]*)\s*=/m', $quelle, $treffer, PREG_OFFSET_CAPTURE)) {
        foreach ($treffer[1] as [$name, $stelle]) {
            $erste = strpos($quelle, $name);
            assert($erste !== false && $erste >= $stelle - 6,
                "{$datei}: {$name} wird vor seiner Definition benutzt");
        }
    }
}

$leser = (string) file_get_contents($wurzel . '/api/app/ecosystem-display.php');
$schreiber = (string) file_get_contents($wurzel . '/api/edit/map/ecosystem-display.php');

// ---- C. Der oeffentliche Leser faellt OFFEN aus ------------------------------------------------
// 🔴 Jeder Fehler ergibt `display: null`, nie ein 500: der Browser hat seine Vorgabewerte und
// zeichnet ohne diesen Endpunkt wie bisher. Ein Ausfall hier darf die Karte nicht aufhalten.
assert(str_contains($leser, 'catch (Throwable)'), 'der Leser faengt jeden Fehler');
assert(str_contains($leser, "'display' => null"), 'und liefert dann display: null statt 500');

// 🔴 KEIN DDL im Lesepfad -- er laeuft bei JEDEM Besucher.
assert(!str_contains($leser, 'EnsureTable'), 'der Leser legt keine Tabelle an');
assert(!str_contains($leser, 'EnsureWideValue'), 'und macht keine information_schema-Sonde');

// 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION. avesmapsCreatePdo nimmt ein Array, und $config
// IST eins -- PHP beschwert sich also nicht, drinnen ist dann alles leer, und der catch macht
// daraus eine leere Antwort. Genau so hat das Tempowerte-Fenster nie geladen.
foreach ($dateien as $i => $datei) {
    $quelle = $i === 0 ? $leser : $schreiber;
    assert(str_contains($quelle, "avesmapsCreatePdo(\$config['database'] ?? [])"),
        "{$datei} nimmt den Teilbaum, nicht die ganze Konfiguration");
}

// ---- D. Der Schreiber hat den Riegel ----------------------------------------------------------
assert(str_contains($schreiber, "avesmapsRequireUserWithCapability('edit')"), 'lesen darf `edit`');
assert(str_contains($schreiber, "avesmapsUserCan(\$user, 'admin')"), 'speichern nur `admin`');
// 🔴 Der Riegel steht SERVERSEITIG, nicht nur am ausgegrauten Knopf im Fenster.
assert(str_contains($schreiber, "'forbidden'"), 'und lehnt einen Editor beim Speichern ab');
// 💣 Ein Speichern, das nicht ankommt, meldet das (die stille MySQL-Kuerzung, AGENTS.md §10).
assert(str_contains($schreiber, 'ecosystem_display_not_stored'),
    'ein Speichern, das nicht ankommt, meldet das');

// ---- E. Alle vier Aktionen sind verdrahtet ----------------------------------------------------
foreach (['get', 'save', 'reset', 'median'] as $aktion) {
    assert(str_contains($schreiber, "'{$aktion}'"), "die Aktion `{$aktion}` ist verdrahtet");
}
// 🔴 Der Median ist unser Werkzeug -- er darf gelesen werden, ohne etwas zu schreiben.
$posMedian = strpos($schreiber, "\$action === 'median'");
$posRiegel = strpos($schreiber, '!$maySave');
assert($posMedian !== false && $posRiegel !== false, 'beide Stellen existieren');
assert($posMedian < $posRiegel,
    'der Median steht VOR dem Speicher-Riegel -- ein Editor darf messen, nur nicht schreiben');

// ---- F. map_revision wird NICHT gehoben --------------------------------------------------------
// ⚠️ Es aendert kein Kartenobjekt, und ein Sprung liesse jeden Client die komplette
// Feature-Nutzlast (21 MB) neu laden. Der Leser hat seinen eigenen Stempel. Dieselbe Begruendung
// wie bei den Zoombaendern und den Tempowerten.
assert(!str_contains($schreiber, 'avesmapsBumpMapRevision'), 'map_revision bleibt unberuehrt');

echo "ecosystem-display-endpunkt: alle Zusicherungen gruen\n";
