<?php

declare(strict_types=1);

/**
 * 💣 Die Auswahl eines Bulk-Schreibers ist POSITIV. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-selection-test.php
 *
 * Warum das ein eigener Test ist: "alles Divergente AUSSER diesen" schreibt jede Divergenz mit, die
 * zwischen Vorschau und Übernahme entstanden ist -- ungesehen, ohne Zeile, ohne Häkchen. Genau das
 * kann eine Vorschau nicht überleben, und genau so war der Schreiber gebaut (Entwurf §6a).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';       // Konstanten
require_once __DIR__ . '/../sync-monitor-model.php'; // nur Funktionsdefinitionen

// --- Ohne Einschränkung: der alte Aufrufweg --------------------------------------------------------
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', null, []);
assert($clause['sql'] === '' && $clause['params'] === [], 'null = alles, wie bisher');

// --- Nur die Übersprungenen (alter Weg, bleibt erhalten) -------------------------------------------
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', null, ['wiki:a', 'wiki:b']);
assert($clause['sql'] === ' AND child.wiki_key NOT IN (?,?)');
assert($clause['params'] === ['wiki:a', 'wiki:b']);

// --- Die Auswahl der Vorschau ----------------------------------------------------------------------
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', ['wiki:a'], ['wiki:b']);
assert($clause['sql'] === ' AND child.wiki_key IN (?)', 'only gewinnt über skip');
assert($clause['params'] === ['wiki:a']);

// --- 💣 Die leere Auswahl heißt NICHTS, nicht ALLES ------------------------------------------------
//
// Der Unfall, den diese Zeile verhindert: eine Übernahme, bei der nichts angehäkelt war, schreibt
// jede Divergenz der Datenbank. `[]` und `null` sehen in PHP zu ähnlich aus, um darauf zu vertrauen.
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', [], []);
assert($clause['sql'] === ' AND 1 = 0' && $clause['params'] === [], '💣 leere Auswahl = keine Zeile');

// Leerzeichen und Dubletten fallen raus, die Reihenfolge bleibt.
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', [' wiki:a ', 'wiki:a', '', 'wiki:c'], []);
assert($clause['params'] === ['wiki:a', 'wiki:c']);

// --- Und die zwei Schreiber bauen ihre Bedingung nicht mehr selbst ---------------------------------
$source = (string) file_get_contents(__DIR__ . '/../sync-monitor-model.php');
assert(!str_contains($source, "NOT IN ('"), 'keine handgebaute Bedingung mehr');
assert(!str_contains($source, '$skipClause = ' . "' AND child.wiki_key NOT IN"), 'der alte Bau ist weg');
assert(substr_count($source, 'avesmapsWikiSyncMonitorSelectionClause(') >= 3, 'beide Schreiber rufen sie');

echo "territory-selection ok\n";
