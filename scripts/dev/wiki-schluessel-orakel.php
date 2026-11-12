<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für Legacys Wiki-Schlüssel (WI-0253, Scheiben Ortslisten und Quellen): lässt die ECHTEN PHP-Funktionen auf die Zeichenketten der Fixture laufen und
 * schreibt ihr Ergebnis als `erwartet` in `apps/server/test/fixtures/wiki-schluessel-orakel.json`. Der Test `wiki-schluessel.test.ts` hält `apps/server/src/wiki/schluessel.ts`
 * dagegen.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive a7f2dac86 api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-schluessel-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-schluessel-orakel.json
 *
 * Je Fall (`{ "id", "wert" }`) fünf Antworten:
 *   slug         `avesmapsPoliticalSlug` (`api/_internal/political/territory.php`, mit `avesmapsFoldToAscii`)
 *   titel        `avesmapsWikiSyncMonitorNormalizeTitle` (`api/_internal/wiki/sync-monitor.php`)
 *   publikation  `avesmapsPublicationCatalogWikiKeyForTitle` (`api/_internal/wiki/publication-sync.php`): der Schlüssel einer Publikation, ohne Präfix
 *   ort          `avesmapsGameLiteratureCanonicalKeyForName` (`api/_internal/app/game-literature-resolve.php`): `wiki:` + Slug, der Schlüssel eines Orts der Literatur
 *   weiterleitung das Ziel einer Weiterleitung in der Tafel der Aliase: `avesmapsWikiDumpCanonicalWikiKeyForTitle` (`api/_internal/wiki/dump-reader.php`, über die Adresse der Seite
 *                `avesmapsWikiSyncPageUrl` und `avesmapsPoliticalBuildWikiKey`), ohne das Präfix `wiki:` (`avesmapsPublicationStripWikiKeyPrefix`)
 *
 * Mit `--liste <datei>` statt der Fixture: eine Zeichenkette je Zeile (JSON-kodiert) rein, je Zeile `[slug, titel]` als JSON raus (für den großen Vergleich gegen alle Titel
 * des Dumps; das Ergebnis geht nicht ins Repository).
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-schluessel-orakel.php <legacy-wurzel> <fixture.json> | --liste <ein.jsonl> <aus.jsonl>\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
require_once $root . '/api/_internal/bootstrap.php';
require_once $root . '/api/_internal/political/territory.php';
require_once $root . '/api/_internal/wiki/sync-monitor.php';
require_once $root . '/api/_internal/wiki/publication-sync.php';
require_once $root . '/api/_internal/wiki/dump-reader.php';
require_once $root . '/api/_internal/app/game-literature-resolve.php';

if ($argv[2] === '--liste') {
    $aus = fopen($argv[4], 'wb');
    foreach (file($argv[3], FILE_IGNORE_NEW_LINES) ?: [] as $zeile) {
        $wert = json_decode($zeile, true, 512, JSON_THROW_ON_ERROR);
        fwrite($aus, json_encode([avesmapsPoliticalSlug($wert), avesmapsWikiSyncMonitorNormalizeTitle($wert)], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n");
    }
    fclose($aus);
    exit(0);
}

$datei = $argv[2];
$fixture = json_decode((string) file_get_contents($datei), true, 512, JSON_THROW_ON_ERROR);
foreach ($fixture['faelle'] as $index => $fall) {
    $wert = (string) $fall['wert'];
    $fixture['faelle'][$index]['erwartet'] = [
        'slug' => avesmapsPoliticalSlug($wert),
        'titel' => avesmapsWikiSyncMonitorNormalizeTitle($wert),
        'publikation' => avesmapsPublicationCatalogWikiKeyForTitle($wert),
        'ort' => avesmapsGameLiteratureCanonicalKeyForName($wert),
        'weiterleitung' => avesmapsPublicationStripWikiKeyPrefix(avesmapsWikiDumpCanonicalWikiKeyForTitle($wert)),
    ];
}
file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($fixture['faelle']) . " Fälle geschrieben\n");
