<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für die Publikationen eines Artikels (WI-0253, Scheibe Quellen): lässt Legacys ECHTE Funktionen auf die Seiten der Fixture laufen und schreibt ihr
 * Ergebnis als `erwartet` in `apps/server/test/fixtures/wiki-quellen-orakel.json`. Der Test `wiki-publikationen.test.ts` hält `apps/server/src/wiki/infobox/publikationen.ts`
 * dagegen.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive a7f2dac86 api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-quellen-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-quellen-orakel.json
 *
 * Je Seite (`{ "id", "titel", "text" }`) zwei Antworten:
 *   zitate   `avesmapsWikiParsePublicationsSection` (`api/_internal/wiki/publication-parsing.php`): [{ title, reference_kind, pages, note }]
 *   produkt  der Katalogschritt (`avesmapsPublicationBuildCatalogStep`, `publication-sync.php`, Stand a7f2dac86 Zeilen 513–537): `null`, wenn die Seite keine Produktseite ist
 *            (Text ohne „Produkt“ oder `avesmapsWikiParseProductInfobox` ergibt nichts), sonst `{ adresse, titel }`: die Adresse aus `avesmapsWikiBuildPublicationUrl` (`null` ohne
 *            Shop-Adresse), der Titel, unter dem die Quelle steht (`avesmapsWikiPublicationDisplayTitle` über dem Seitentitel des Falls, `mb_substr` auf 300 Zeichen, dann
 *            `avesmapsNormalizeSourceLabel` wie im Upsert der Quelle, `avesmapsFeatureSourceUpsert`) und die Art der Quelle (`quellenart`: `source_type` aus
 *            `avesmapsWikiParseProductInfobox`, also `avesmapsWikiMapArtToSourceType` über `Art`, sonst `Unterkategorie`; acht Arten, mit der Legacy die Quelle anlegt).
 *            Namensraum und Weiterleitung prüft der Aufrufer; sie gehören nicht zum Fall.
 *
 * Mit `--liste <ein.jsonl> <aus.jsonl>` statt der Fixture: je Zeile `{ "titel", "text" }` rein, je Zeile `{ zitate, produkt }` raus (für den großen Vergleich gegen den Dump;
 * das Ergebnis geht nicht ins Repository).
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-quellen-orakel.php <legacy-wurzel> <fixture.json> | --liste <ein.jsonl> <aus.jsonl>\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
require_once $root . '/api/_internal/bootstrap.php';
require_once $root . '/api/_internal/wiki/sync-monitor.php';
require_once $root . '/api/_internal/wiki/publication-parsing.php';
require_once $root . '/api/_internal/wiki/publication-sync.php';
require_once $root . '/api/_internal/app/feature-sources.php';

function wikiQuellenOrakel(string $text, string $seitenTitel): array
{
    $produkt = null;
    if (stripos($text, 'Produkt') !== false) {
        $info = avesmapsWikiParseProductInfobox($text);
        if (is_array($info)) {
            $url = avesmapsWikiBuildPublicationUrl($info['f_shop_pid'] ?? null, $info['pdf_shop_id'] ?? null);
            $anzeige = avesmapsWikiPublicationDisplayTitle($seitenTitel, (string) ($info['title'] ?? ''), (string) ($info['subtitle'] ?? ''));
            $produkt = [
                'adresse' => ($url['has_link'] ?? false) ? (string) $url['chosen_url'] : null,
                'titel' => avesmapsNormalizeSourceLabel(mb_substr($anzeige, 0, 300, 'UTF-8')),
                'quellenart' => (string) ($info['source_type'] ?? 'sonstiges'),
            ];
        }
    }
    return ['zitate' => avesmapsWikiParsePublicationsSection($text), 'produkt' => $produkt];
}

if ($argv[2] === '--liste') {
    $aus = fopen($argv[4], 'wb');
    foreach (file($argv[3], FILE_IGNORE_NEW_LINES) ?: [] as $zeile) {
        $seite = json_decode($zeile, true, 512, JSON_THROW_ON_ERROR);
        fwrite($aus, json_encode(wikiQuellenOrakel((string) $seite['text'], (string) $seite['titel']), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR) . "\n");
    }
    fclose($aus);
    exit(0);
}

$datei = $argv[2];
$fixture = json_decode((string) file_get_contents($datei), true, 512, JSON_THROW_ON_ERROR);
foreach ($fixture['faelle'] as $index => $fall) {
    $fixture['faelle'][$index]['erwartet'] = wikiQuellenOrakel((string) $fall['text'], (string) $fall['titel']);
}
file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($fixture['faelle']) . " Seiten geschrieben\n");
