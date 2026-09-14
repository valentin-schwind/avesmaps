<?php

declare(strict_types=1);

// Aufgabe 5, Fixrunde 1 (Garetien-Importer vereint, 14.09.2026): gemeinsame Fall-Tafel gegen
// avesmapsGaretienListeObjektPasstFilter -- ihr JS-Gegenstueck (garetien-filter-faelle.test.js)
// faehrt dieselbe Tafel gegen garetienStageFilterAnwenden.
//
// 🔴 WARUM ES DIESE DATEI GIBT: garetienStageFilterAnwenden (JS, Stage-Reiter) setzt dieselbe
// Filterregel um wie avesmapsGaretienListeObjektPasstFilter (PHP, Server-Reiter) -- Ebene, Typ,
// Urteil, Wiki, nur_mehrteilig, nur Verbuende, Suche. Ohne eine gemeinsame Fall-Tafel prueft jede
// Seite nur gegen eigene, hart codierte Erwartungen, und ein kuenftiger Zusatz auf einer Seite
// liefe unbemerkt auseinander. Kein Test startet dafuer ein PHP-Binary aus Node oder umgekehrt --
// beide lesen dieselbe Datei unabhaengig und fahren ihre EIGENE, echte Funktion darueber.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-filter-faelle-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-liste.php';

$fixturePfad = __DIR__ . '/fixtures/garetien-filter-faelle.json';
$fixture = json_decode((string) file_get_contents($fixturePfad), true, 512, JSON_THROW_ON_ERROR);
assert(is_array($fixture) && isset($fixture['faelle']) && is_array($fixture['faelle']),
    'die Fall-Tafel liefert ein Feld "faelle"');
assert(count($fixture['faelle']) >= 15, 'die Fall-Tafel deckt jeden Abschnitt mit Treffer/Fehltreffer ab');

$geprueft = 0;
foreach ($fixture['faelle'] as $fall) {
    $beschreibung = (string) ($fall['beschreibung'] ?? '(ohne Beschreibung)');
    $ist = avesmapsGaretienListeObjektPasstFilter($fall['objekt'], $fall['filter']);
    assert($ist === $fall['passt'], sprintf(
        'Fall "%s": erwartet %s, bekommen %s (objekt=%s, filter=%s)',
        $beschreibung,
        $fall['passt'] ? 'true' : 'false',
        $ist ? 'true' : 'false',
        json_encode($fall['objekt']),
        json_encode($fall['filter'])
    ));
    $geprueft++;
}

echo "OK: {$geprueft} Faelle aus der gemeinsamen Tafel (garetien-filter-faelle)\n";
