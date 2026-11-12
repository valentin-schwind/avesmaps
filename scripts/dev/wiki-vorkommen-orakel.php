<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für den Leser der Vorkommen im WikiSync (WI-0253, Scheibe Vorkommen): lässt Legacys ECHTEN Parser `avesmapsLoreParsePage` (`api/_internal/wiki/lore-parsing.php`)
 * und die Ablage des Staging (`avesmapsLoreBuildCatalogStep`, `lore-sync.php`) auf die Seiten der Fixture laufen und schreibt ihr Ergebnis als `erwartet` in die Fixture
 * `apps/server/test/fixtures/wiki-vorkommen-orakel.json`. Der Test `wiki-vorkommen.test.ts` hält den TypeScript-Leser (`apps/server/src/wiki/infobox/vorkommen.ts`) dagegen.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive a7f2dac86 api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-vorkommen-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-vorkommen-orakel.json
 *
 * Eine neue Seite kommt als `{ "id", "titel", "ns", "text" }` in `faelle`; das Orakel füllt `erwartet`: `null`, wenn Legacy aus der Seite keinen Eintrag macht (keine der vier
 * Infoboxen als erste), sonst Art, Schlüssel, die Felder (ein leeres fehlt) und die Ortsverknüpfungen.
 *
 * 🪤 Die Ablage steht in Legacy nicht in einer eigenen Funktion, sondern in der Schleife des Katalogschritts (`lore-sync.php`, Stand a7f2dac86, Zeilen 396–429): Längen der Spalten,
 * Schlüssel der Orte, Stelle über alle Links, „ein gleicher Schlüssel überschreibt Titel und Stelle“ (`ON DUPLICATE KEY UPDATE`). Sie ist hier Zeile für Zeile abgeschrieben; der Parser,
 * der Schlüssel (`avesmapsLoreWikiKeyForTitle`) und die Kontinent-Erkennung (`avesmapsLoreDetectContinent`) kommen ungeändert aus Legacy. Die Rohtexte der Ortsfelder und des Lebensraums
 * liest das Orakel über dieselben Funktionen wie der Parser (`ExtractInfoboxBlock`, `ParseTemplateParams`, `avesmapsLoreDecodeEntities`, `NormFields`, `Field`).
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-vorkommen-orakel.php <legacy-wurzel> <fixture.json>\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
$datei = $argv[2];
$fixture = json_decode((string) file_get_contents($datei), true, 512, JSON_THROW_ON_ERROR);

require_once $root . '/api/_internal/bootstrap.php';
require_once $root . '/api/_internal/political/territory.php';
require_once $root . '/api/_internal/wiki/sync-monitor.php';
require_once $root . '/api/_internal/wiki/lore-sync.php';

foreach ($fixture['faelle'] as $index => $fall) {
    $titel = (string) $fall['titel'];
    $text = (string) $fall['text'];
    $rec = avesmapsLoreParsePage($titel, $text);
    $erwartet = null;
    if (is_array($rec)) {
        // Die Rohtexte: dieselbe Kette wie im Parser (erster Kasten, Parameter zeilenweise, Zeichenverweise einmal, normierte Schlüssel).
        $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($text);
        $params = array_map('avesmapsLoreDecodeEntities', avesmapsWikiSyncMonitorParseTemplateParams($block));
        $norm = avesmapsWikiSyncMonitorNormFields($params);
        $roh = static fn (string $schluessel): string => trim(avesmapsWikiSyncMonitorField($norm, [$schluessel]));

        $werte = [
            'name' => mb_substr($rec['name'], 0, 300, 'UTF-8'),
            'gruppe' => mb_substr($rec['gruppe'], 0, 300, 'UTF-8'),
            'typ' => mb_substr($rec['typ'], 0, 300, 'UTF-8'),
            'lebensraum' => mb_substr($rec['lebensraum'], 0, 500, 'UTF-8'),
            'synonyme' => mb_substr($rec['synonyme'], 0, 500, 'UTF-8'),
            'continent' => avesmapsLoreDetectContinent($titel, $text),
            'roh_verbreitung' => $roh('verbreitung'),
            'roh_herkunft' => $roh('herkunft'),
            'roh_regionen' => $roh('regionen'),
            'roh_vorkommen' => $roh('vorkommen'),
        ];
        $felder = [];
        foreach ($werte as $feld => $wert) {
            if ($wert !== '') {
                $felder[$feld] = $wert;
            }
        }

        // Die Ablage der Orte wie im Katalogschritt: Schlüssel je Titel, die Stelle zählt über ALLE Links, ein gleicher Schlüssel in derselben Beziehung überschreibt Titel und Stelle.
        $jeSchluessel = [];
        $stelle = 0;
        foreach ($rec['places'] as $ort) {
            $schluessel = avesmapsLoreWikiKeyForTitle($ort['title']);
            if ($schluessel === '') {
                continue;
            }
            $jeSchluessel[$schluessel . '|' . $ort['relation']] = [
                'titel' => mb_substr($ort['title'], 0, 300, 'UTF-8'),
                'schluessel' => $schluessel,
                'beziehung' => $ort['relation'],
                'stelle' => $stelle,
            ];
            $stelle++;
        }
        $orte = array_values($jeSchluessel);
        usort($orte, static fn (array $a, array $b): int => $a['stelle'] <=> $b['stelle']);

        $erwartet = [
            'art' => $rec['kind'],
            'wikiKey' => avesmapsLoreWikiKeyForTitle($titel),
            'felder' => (object) $felder,
            'orte' => $orte,
        ];
    }
    $fixture['faelle'][$index]['erwartet'] = $erwartet;
}

file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($fixture['faelle']) . " Seiten geschrieben\n");
