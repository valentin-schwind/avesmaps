<?php

declare(strict_types=1);

/**
 * Unit test for the R1/R2 way-naming helpers (api/_internal/wiki/path-naming.php).
 * Pure functions, no DB, no mbstring needed. Run:
 *     php tools/paths/test-path-wiki-naming.php
 */

require __DIR__ . '/../../api/_internal/wiki/path-naming.php';

$failures = 0;
$total = 0;
function check(string $label, mixed $actual, mixed $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL {$label}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
        return;
    }
    echo "ok {$label}\n";
}

// --- avesmapsWikiPathCanonicalName ---
check('canonical: staging name wins', avesmapsWikiPathCanonicalName(['name' => 'Reichsstraße 1', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Anderes']), 'Reichsstraße 1');
check('canonical: name is trimmed', avesmapsWikiPathCanonicalName(['name' => '  Reichsstraße 1  ']), 'Reichsstraße 1');
check('canonical: falls back to /wiki/<Page> with underscores and percent-escapes', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_1']), 'Reichsstraße 1');
check('canonical: /wiki/ page strips query/fragment', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_1?action=view#Verlauf']), 'Reichsstraße 1');
check('canonical: url without /wiki/ uses last path segment', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => 'https://example.org/pages/Gruene_Ebene']), 'Gruene Ebene');
check('canonical: empty object -> empty string', avesmapsWikiPathCanonicalName([]), '');
check('canonical: unusable url -> empty string', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => '   ']), '');

// --- avesmapsWikiPathEffectiveEditName (R1) ---
check('R1: no wiki_path -> submitted name', avesmapsWikiPathEffectiveEditName('Mein Name', []), 'Mein Name');
check('R1: wiki_path not an array -> submitted name', avesmapsWikiPathEffectiveEditName('Mein Name', ['wiki_path' => 'kaputt']), 'Mein Name');
check('R1: assigned wiki way overrides typed name', avesmapsWikiPathEffectiveEditName('Eigener Name', ['wiki_path' => ['name' => 'Reichsstraße 1']]), 'Reichsstraße 1');
check('R1: assigned wiki way overrides generated name', avesmapsWikiPathEffectiveEditName('Reichsstrasse-2715', ['wiki_path' => ['name' => '', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_1']]), 'Reichsstraße 1');
check('R1: unusable wiki_path -> submitted name survives', avesmapsWikiPathEffectiveEditName('Mein Name', ['wiki_path' => ['name' => '', 'wiki_url' => '']]), 'Mein Name');

// --- avesmapsWikiPathNextGenericName (R2) ---
check('R2: empty pool -> <subtype>-1', avesmapsWikiPathNextGenericName('Reichsstrasse', []), 'Reichsstrasse-1');
check('R2: next free number is max+1', avesmapsWikiPathNextGenericName('Reichsstrasse', ['Reichsstrasse-2715', 'Reichsstrasse-31']), 'Reichsstrasse-2716');
check('R2: other subtypes and non-matching names are ignored', avesmapsWikiPathNextGenericName('Pfad', ['Reichsstrasse-2715', 'Pfad-3', 'Pfad-7b', 'Pfad 9', 'Reichsstraße 1']), 'Pfad-4');
check('R2: number-sensitive exact pattern only (no digit-strip collapse)', avesmapsWikiPathNextGenericName('Flussweg', ['Flussweg-10', 'Flussweg-100']), 'Flussweg-101');
check('R2: empty subtype falls back to Weg', avesmapsWikiPathNextGenericName('  ', ['Weg-4']), 'Weg-5');
check('R2: pool entries are trimmed', avesmapsWikiPathNextGenericName('Weg', [' Weg-12 ']), 'Weg-13');

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
