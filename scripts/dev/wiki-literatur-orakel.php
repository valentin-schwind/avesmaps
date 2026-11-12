<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für den Leser der Literatur im WikiSync (WI-0253, Scheibe Literatur): lässt Legacys ECHTEN Parser `avesmapsWikiParseProductInfobox`
 * (`api/_internal/wiki/publication-parsing.php`) auf die Seiten der Fixture laufen und schreibt sein Ergebnis als `erwartet` in die Fixture
 * `apps/server/test/fixtures/wiki-literatur-orakel.json`. Der Test `wiki-literatur.test.ts` hält den TypeScript-Leser (`apps/server/src/wiki/infobox/literatur.ts`) dagegen.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive a7f2dac86 api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-literatur-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-literatur-orakel.json
 *
 * Eine neue Seite kommt als `{ "id", "titel", "ns", "text" }` in `faelle`; das Orakel füllt `erwartet`: `null`, wenn Legacy aus der Seite keinen Katalogeintrag macht
 * (keine Infobox Produkt, keine Spielliteratur, keine Ortsliste), sonst die Felder (ein leeres fehlt) und die Ortsliste.
 *
 * 🪤 Die Ablage im Katalog (Titel aus `Titel`, sonst der Seitentitel; die Längen der Spalten; die F-Shop-Nummer aus `f_shop_pid`) steht in Legacy nicht in einer eigenen
 * Funktion, sondern in der Schleife der Phase `adventures` (`api/_internal/wiki/game-literature-sync.php`, Stand a7f2dac86, Zeilen 447–479). Sie ist hier Zeile für
 * Zeile abgeschrieben; der Parser selbst kommt ungeändert aus Legacy.
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-literatur-orakel.php <legacy-wurzel> <fixture.json>\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
$datei = $argv[2];
$fixture = json_decode((string) file_get_contents($datei), true, 512, JSON_THROW_ON_ERROR);

require $root . '/api/_internal/wiki/publication-parsing.php';

foreach ($fixture['faelle'] as $index => $fall) {
    $info = avesmapsWikiParseProductInfobox($fall['text']);
    $erwartet = null;
    if (is_array($info) && is_array($info['adventure'] ?? null)) {
        $gameLiterature = $info['adventure'];
        $pageTitle = (string) $fall['titel'];
        $displayTitle = trim((string) ($info['title'] ?? ''));
        if ($displayTitle === '') {
            $displayTitle = $pageTitle;
        }
        $werte = [
            'title' => mb_substr($displayTitle, 0, 300, 'UTF-8'),
            'product_type' => mb_substr((string) ($gameLiterature['product_type'] ?? ''), 0, 32, 'UTF-8'),
            'edition' => mb_substr((string) ($gameLiterature['edition'] ?? ''), 0, 16, 'UTF-8'),
            'genre' => mb_substr((string) ($gameLiterature['genre'] ?? ''), 0, 160, 'UTF-8'),
            'complexity_gm' => mb_substr((string) ($gameLiterature['complexity_gm'] ?? ''), 0, 60, 'UTF-8'),
            'complexity_pl' => mb_substr((string) ($gameLiterature['complexity_pl'] ?? ''), 0, 60, 'UTF-8'),
            'authors' => mb_substr((string) ($gameLiterature['authors'] ?? ''), 0, 500, 'UTF-8'),
            'series' => mb_substr((string) ($gameLiterature['series'] ?? ''), 0, 200, 'UTF-8'),
            'fshop_code' => mb_substr((string) ($info['f_shop_pid'] ?? ''), 0, 40, 'UTF-8'),
        ];
        $felder = [];
        foreach ($werte as $feld => $wert) {
            if ($wert !== '') {
                $felder[$feld] = $wert;
            }
        }
        $erwartet = ['felder' => (object) $felder, 'orte' => array_values($gameLiterature['places'])];
    }
    $fixture['faelle'][$index]['erwartet'] = $erwartet;
}

file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($fixture['faelle']) . " Seiten geschrieben\n");
