<?php

declare(strict_types=1);

/**
 * Der Einzel-Stilleger trägt dieselben Riegel wie der Sammel-Sweep, den er ersetzt. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/lore-retire-parity-test.php
 *
 * Der alte Abschluss-Sweep war EINE mengenbasierte Anweisung mit drei Bedingungen:
 *   origin='wiki' AND status='active' AND wiki_key NOT IN (<Katalog>)
 * Aus der Menge wird jetzt eine Auswahl, die ein Mensch trifft. Die dritte Bedingung wandert in die
 * Vorschau (avesmapsLoreRetirableRows), die beiden anderen müssen an der Anweisung bleiben: fällt eine
 * weg, legt eine Übernahme eine von Hand angelegte oder längst stillgelegte Zeile still.
 *
 * Statisch, und das ist hier die einzige ehrliche Möglichkeit: der Reconcile läuft im gestückelten
 * Dump-Sync, der zum Testen nie angeworfen werden darf (STRATO).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// Nur wegen der Tabellennamen-Konstanten: die Zusicherungen unten nennen sie, statt sie abzuschreiben.
require_once __DIR__ . '/../lore-sync.php';

$applySource = (string) file_get_contents(__DIR__ . '/../lore-plan-apply.php');
assert($applySource !== '', 'lore-plan-apply.php ist lesbar');

$at = strpos($applySource, 'function avesmapsLoreRetireWikiEntry(PDO $pdo, string $wikiKey): bool');
assert(is_int($at), 'der Einzel-Stilleger existiert mit genau dieser Signatur');
$end = strpos($applySource, "\n}", $at);
assert(is_int($end), 'und hat einen Rumpf');
$body = substr($applySource, $at, $end - $at);

assert(str_contains($body, "status = 'retired'"), 'es wird stillgelegt');
// 🔴 UND NICHT GELÖSCHT. Ein Eintrag kann in Orts- und Quellenlisten referenziert sein; ein stiller
// Totalverlust wäre im Zweifel schlimmer als eine Karteileiche -- und die Vorschau verspricht dem
// Editor ausdrücklich, dass der Eintrag erhalten bleibt.
assert(!str_contains($body, 'DELETE'), 'und NICHT gelöscht');
assert(str_contains($body, "origin = 'wiki'"), 'nur Wiki-Zeilen -- Handarbeit gehört uns');
assert(str_contains($body, "status = 'active'"), 'und nur aktive -- was liegt, wird nicht zweimal gefragt');
// Ein Riegel, dessen Ergebnis niemand liest, ist eine Verzierung: die Ausführ-Hälfte muss erfahren,
// wenn die Zeile nicht mehr passte (dann ist der Planeintrag 'stale', nicht 'applied').
assert(str_contains($body, 'rowCount()'), 'und der Riegel wird ausgewertet, nicht nur geschrieben');

// --- Die Gegenprobe: die Rechen-Hälfte legt nichts still ------------------------------------------
$planSource = (string) file_get_contents(__DIR__ . '/../lore-sync.php');
assert($planSource !== '', 'lore-sync.php ist lesbar');
assert(
    !str_contains($planSource, "status = 'retired'"),
    'die Rechen-Hälfte legt nichts still -- sie schlägt es vor'
);
// Und der alte Sammel-Sweep ist wirklich weg, nicht nur nicht mehr aufgerufen: ein zweiter Weg, der
// 5.100 Zeilen auf einmal stilllegen kann, wäre genau die Tür, die dieses Vorhaben zumacht.
assert(
    !str_contains($planSource, 'NOT IN (SELECT wiki_key FROM ' . AVESMAPS_LORE_STAGING_CATALOG . ')')
        || !str_contains($planSource, 'UPDATE ' . AVESMAPS_LORE_TABLE_ENTRY . ' SET'),
    'der mengenbasierte Sweep existiert nicht mehr'
);

echo "lore-retire-parity ok\n";
