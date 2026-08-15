<?php

declare(strict_types=1);

/**
 * Der Zoom-Sync ruft nur Funktionen auf, die er auch GELADEN hat.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     api/edit/political/__tests__/zoom-sync-requires-test.php
 *
 * 💣 assignment-zoom-sync.php lud nur territory.php, rief aber avesmapsPoliticalReadPublicId und
 * avesmapsPoliticalReadOptionalZoom (territories-read.php) sowie avesmapsPoliticalAssertZoomRange
 * (territories-support.php) auf. Ergebnis: "Call to undefined function" -- eine blanke Error-
 * Ausnahme, die das catch(Throwable) des Endpunkts in einen allgemeinen 500 verwandelte.
 *
 * ⚠️ Und der Fehler traf IMMER, sobald es etwas zu tun gab: die erste dieser Funktionen steht in
 * der Nutzlast-Schleife, die nur fuer Anzeigen MIT territoryPublicId laeuft. Ohne solche Eintraege
 * kehrt der Endpunkt vorher zurueck und antwortet 200 -- er sah also gesund aus, solange er nichts
 * tat. Aufgefallen ist es erst am 15.08.2026, als der Editor fuer eigene Knoten anfing, gefuellte
 * Eintraege zu schicken.
 *
 * 🔴 Deshalb prueft dieser Test nicht die drei Namen von damals, sondern ALLE avesmaps-Aufrufe der
 * Datei gegen das, was ihre eigenen require-Zeilen hergeben. Ein neuer Aufruf ohne passendes
 * require faellt damit auf, bevor ihn jemand im Browser als "irgendein 500" meldet.
 */

$endpunkt = __DIR__ . '/../assignment-zoom-sync.php';
$quelle = file_get_contents($endpunkt);
assert(is_string($quelle) && $quelle !== '', 'Der Endpunkt ist lesbar.');

// Die require-Zeilen des Endpunkts nachfahren -- und NUR die. Genau das ist die Frage.
preg_match_all('/^\s*require(?:_once)?\s+__DIR__\s*\.\s*\'([^\']+)\'\s*;/m', $quelle, $requireTreffer);
assert($requireTreffer[1] !== [], 'Der Endpunkt hat require-Zeilen.');
foreach ($requireTreffer[1] as $pfad) {
    require_once __DIR__ . '/..' . $pfad;
}

// Alle aufgerufenen avesmaps-Funktionen der Datei einsammeln.
preg_match_all('/\b(avesmaps[A-Za-z0-9_]*)\s*\(/', $quelle, $aufrufTreffer);
$aufgerufen = array_values(array_unique($aufrufTreffer[1]));
// Die Datei definiert selbst welche -- die sind nach dem require ihrer selbst NICHT geladen,
// weil wir den Endpunkt nicht einbinden (er wuerde eine Anfrage verarbeiten). Also herausnehmen.
preg_match_all('/^function\s+(avesmaps[A-Za-z0-9_]*)\s*\(/m', $quelle, $eigeneTreffer);
$eigene = $eigeneTreffer[1];

$fehlend = [];
foreach ($aufgerufen as $name) {
    if (in_array($name, $eigene, true)) {
        continue;
    }
    if (!function_exists($name)) {
        $fehlend[] = $name;
    }
}

assert(
    $fehlend === [],
    'Der Endpunkt ruft Funktionen auf, die seine require-Zeilen nicht laden: ' . implode(', ', $fehlend)
);

// Die drei aus dem Vorfall ausdruecklich, damit der Test seinen Anlass benennt.
foreach (['avesmapsPoliticalReadPublicId', 'avesmapsPoliticalReadOptionalZoom', 'avesmapsPoliticalAssertZoomRange'] as $name) {
    assert(function_exists($name), "{$name} muss geladen sein -- daran starb der Zoom-Sync.");
}

$geprueft = count($aufgerufen) - count($eigene);
echo "zoom-sync-requires: {$geprueft} aufgerufene Funktionen, alle geladen.\n";
