<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für die Infobox-Leser des WikiSync (WI-0253 C): lässt die ECHTEN Legacy-Parser auf die Seiten der Fixture laufen und schreibt ihr
 * Ergebnis als `erwartet` in die Fixture `apps/server/test/fixtures/wiki-infobox-orakel.json`. Der Test `wiki-infobox.test.ts` hält die TypeScript-Leser
 * dagegen; wer die Leser ändert, ändert damit nicht die Erwartung – die kommt allein von hier.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive HEAD api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-parser-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-infobox-orakel.json
 *
 * Eine neue Seite kommt als `{ "id", "titel", "ns", "text" }` in `faelle`; das Orakel füllt `legacyArt` und `erwartet`. Die Felder heißen wie im Abgleich
 * (`region_text` statt `region` …); ein Feld, das Legacy leer lässt, fehlt. `null` bei einem Bereich heißt: Legacy liefert für diese Seite keinen Datensatz.
 *
 * Legacy-Stand der Fixture: a7f2dac86. Die zwei gewollten Abweichungen von Legacy (eine Infobox ohne schließende Klammer ist ein Befund, `Infobox Landschaft`
 * ergibt in Legacy nie einen Datensatz und im Abgleich ebenfalls keinen Artikel) stehen als eigene Fälle im Test, nicht in der Fixture.
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-parser-orakel.php <legacy-wurzel> <fixture.json>\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
$datei = $argv[2];
$fixture = json_decode((string) file_get_contents($datei), true, 512, JSON_THROW_ON_ERROR);

foreach ([
    '/api/_internal/bootstrap.php',
    '/api/_internal/political/territory.php',
    '/api/_internal/wiki/sync.php',
    '/api/_internal/wiki/sync-monitor.php',
    '/api/_internal/wiki/territories-tree.php',
    '/api/_internal/wiki/territories-parsing.php',
    '/api/_internal/wiki/territories.php',
    '/api/_internal/wiki/paths.php',
    '/api/_internal/wiki/regions.php',
    '/api/_internal/wiki/powerlines.php',
    '/api/_internal/wiki/locations.php',
    '/api/_internal/wiki/settlements.php',
    '/api/_internal/wiki/dump-reader.php',
    '/api/_internal/wiki/dump-entity-scan.php',
] as $teil) {
    require $root . $teil;
}

/** @param array<string,mixed>|null $rec @param array<string,string> $abbildung Legacy-Feld => Feld des Abgleichs */
function abbilden(?array $rec, array $abbildung): ?array
{
    if ($rec === null) {
        return null;
    }
    $aus = [];
    foreach ($abbildung as $legacy => $meins) {
        $wert = $rec[$legacy] ?? '';
        $wert = is_string($wert) ? $wert : (string) $wert;
        if ($wert !== '') {
            $aus[$meins] = $wert;
        }
    }
    return $aus;
}

foreach ($fixture['faelle'] as $index => $fall) {
    $page = ['title' => $fall['titel'], 'ns' => $fall['ns'] ?? 0, 'redirect' => null, 'wikitext' => $fall['text']];
    $art = avesmapsWikiDumpClassifyPage($page);
    $erwartet = [];
    if ($art === 'path') {
        $r = avesmapsWikiDumpParsePathPage($page);
        $erwartet['weg'] = abbilden($r['record'], [
            'name' => 'name', 'kind' => 'kind', 'art' => 'art', 'lage' => 'lage', 'laenge' => 'laenge', 'verlauf' => 'verlauf', 'description' => 'description',
        ]);
    }
    if ($art === 'powerline') {
        $r = avesmapsWikiDumpParsePowerlinePage($page);
        $erwartet['kraftlinie'] = abbilden($r['record'], [
            'name' => 'name', 'staerke' => 'staerke', 'affinitaet' => 'affinitaet', 'laenge' => 'laenge', 'regionen' => 'regionen', 'verlauf' => 'verlauf', 'description' => 'description',
        ]);
    }
    if ($art === 'region') {
        $r = avesmapsWikiDumpParseRegionPage($page);
        $felder = abbilden($r['record'], [
            'name' => 'name', 'art' => 'art', 'region_parent' => 'region_parent', 'affiliation_staat' => 'affiliation_staat', 'einwohner' => 'einwohner',
            'sprache' => 'sprache', 'vegetation' => 'vegetation', 'verkehrswege' => 'verkehrswege', 'description' => 'description',
        ]);
        if ($felder !== null) {
            $karte = ['N' => 'nachbar_n', 'NO' => 'nachbar_no', 'O' => 'nachbar_o', 'SO' => 'nachbar_so', 'S' => 'nachbar_s', 'SW' => 'nachbar_sw', 'W' => 'nachbar_w', 'NW' => 'nachbar_nw'];
            foreach ($karte as $richtung => $name) {
                $liste = $r['record']['neighbors_json'][$richtung] ?? null;
                if (is_array($liste) && $liste !== []) {
                    $felder[$name] = implode(', ', $liste);
                }
            }
        }
        $erwartet['region'] = $felder;
        // Gipfel und Vulkane tragen dieselbe Infobox, und Legacy hängt ihnen denselben Wiki-Stand an wie einer Landschaft (`avesmapsWikiRegionBuildAssignObject`
        // aus derselben Staging-Zeile): dieselben Felder (WI-0253, Scheibe Gipfel).
        $gipfel = $felder;
        // Die Höhe (WI-0253 §21): Legacy liest `Höhe=` zweimal (`avesmapsWikiRegionParseHeight` beim Einlesen, `avesmapsWikiRegionHeightFromRow` aus der Zeile); der Abgleich rundet auf ganze Schritt.
        if ($gipfel !== null) {
            $hoehe = avesmapsWikiRegionHeightFromRow(['raw_json' => $r['record']['raw_json'] ?? []]);
            if ($hoehe !== null) {
                $gipfel['height'] = (string) (int) round($hoehe);
            }
        }
        $erwartet['gipfel'] = $gipfel;
    }
    if ($art === 'settlement' || $art === 'building') {
        // Der Bauwerks-Lauf von Legacy liest die Felder nicht; die Nester der Orte tragen dieselben wie bei einer Siedlung (ParseInfobox).
        $erwartet['ort'] = abbilden(avesmapsWikiSettlementParseInfobox($fall['titel'], $fall['text'], ''), [
            'name' => 'name', 'einwohner' => 'einwohner', 'bevoelkerung' => 'bevoelkerung', 'oberhaupt' => 'oberhaupt', 'region' => 'region_text', 'staat' => 'staat_text',
            'lage' => 'lage', 'handelszone' => 'handelszone', 'verkehrswege' => 'verkehrswege', 'tempel' => 'tempel', 'description' => 'description',
        ]);
    }
    $infobox = avesmapsWikiSyncMonitorFieldKey(avesmapsWikiSyncMonitorInfoboxName($fall['text']));
    if ($infobox !== '' && (str_contains($infobox, 'staat') || str_contains($infobox, 'herrschaftsgebiet') || str_contains($infobox, 'reich')
        || str_contains($infobox, 'siedlung') || str_contains($infobox, 'stadt') || str_contains($infobox, 'ort'))) {
        $t = avesmapsWikiDumpParseTerritoryPage($page);
        // political und trade_zone liest Legacys Dump-Lauf nie, der continent kommt im hybriden Lauf aus den Kategorien (C-2): Sie gehören nicht zu den Feldern des Abgleichs.
        $erwartet['gebiet'] = abbilden($t['record'], [
            'founded_text' => 'founded_text', 'dissolved_text' => 'dissolved_text', 'form_of_government' => 'form_of_government',
            'capital_name' => 'capital_name', 'seat_name' => 'seat_name', 'ruler' => 'ruler', 'language' => 'language', 'currency' => 'currency',
            'population' => 'population', 'founder' => 'founder', 'trade_goods' => 'trade_goods', 'geographic' => 'geographic', 'blazon' => 'blazon',
            'affiliation_raw' => 'affiliation_raw',
        ]);
    }
    $fixture['faelle'][$index]['legacyArt'] = $art;
    $fixture['faelle'][$index]['erwartet'] = (object) $erwartet;
}

file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($fixture['faelle']) . " Seiten geschrieben\n");
