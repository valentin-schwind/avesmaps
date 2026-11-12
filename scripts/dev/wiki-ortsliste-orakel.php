<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für den Abgleich der Ortslisten der Literatur (WI-0253, Scheibe Ortslisten): rechnet für jeden Fall der Fixture mit Legacys ECHTEN Funktionen die Wunschliste
 * und den Plan und schreibt beides als `erwartet` in `apps/server/test/fixtures/wiki-ortsliste-orakel.json`. Der Test `wikisync-ortsliste.test.ts` hält
 * `apps/server/src/wiki/abgleich/ortsliste.ts` dagegen.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive a7f2dac86 api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-ortsliste-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-ortsliste-orakel.json
 *
 * Ein Fall: `{ "id", "productType", "orte": [Linkziele], "aktuell": [{ id, sort_order, raw_name, role, origin, status }] }`. Die Wunschliste ist die Ablage der Phase `adventures`
 * (`avesmapsGameLiteratureBuildCatalogStep`: getrimmt, leere weg, 300 Zeichen, die Stelle von 0 an) mit der Rolle aus `avesmapsGameLiteratureDesiredPlaces`
 * (`avesmapsGameLiteratureRoleForKind(avesmapsGameLiteratureKindForProductType(...))`); der Plan ist `avesmapsGameLiteraturePlacePlan` (`api/_internal/wiki/game-literature-sync.php`).
 *
 * 🪤 Die Ablage steht in Legacy in der Schleife des Katalogschritts, nicht in einer eigenen Funktion; sie ist hier Zeile für Zeile abgeschrieben (Stand a7f2dac86, Zeilen 481–491).
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-ortsliste-orakel.php <legacy-wurzel> <fixture.json>\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
$datei = $argv[2];
require_once $root . '/api/_internal/wiki/publication-parsing.php';
require_once $root . '/api/_internal/wiki/game-literature-sync.php';

$fixture = json_decode((string) file_get_contents($datei), true, 512, JSON_THROW_ON_ERROR);
foreach ($fixture['faelle'] as $index => $fall) {
    $kind = avesmapsGameLiteratureKindForProductType((string) $fall['productType']);
    $wunsch = [];
    $sortOrder = 0;
    foreach ($fall['orte'] as $rawName) {
        $rawName = trim((string) $rawName);
        if ($rawName === '') {
            continue;
        }
        $wunsch[] = [
            'sort_order' => $sortOrder,
            'raw_name' => mb_substr($rawName, 0, 300, 'UTF-8'),
            'role' => avesmapsGameLiteratureRoleForKind($kind, $sortOrder),
        ];
        $sortOrder++;
    }
    $fixture['faelle'][$index]['erwartet'] = [
        'wunsch' => $wunsch,
        'plan' => avesmapsGameLiteraturePlacePlan($fall['aktuell'], $wunsch),
    ];
}
file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($fixture['faelle']) . " Fälle geschrieben\n");
