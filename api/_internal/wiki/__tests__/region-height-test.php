<?php

declare(strict_types=1);

require __DIR__ . '/../sync.php';
require __DIR__ . '/../sync-monitor-parsing.php';
require __DIR__ . '/../sync-monitor.php';
require __DIR__ . '/../territories-parsing.php';
require __DIR__ . '/../../political/territory.php';
require __DIR__ . '/../regions.php';

if (ini_get('zend.assertions') !== '1') {
    throw new RuntimeException('Der Test benötigt zend.assertions=1.');
}

foreach (['1100' => 1100, 'ca. 1100 Schritt' => 1100, '1.100' => 1100,
    'etwa 1100' => 1100, '0' => 0, '1100,5' => 1100.5] as $raw => $expected) {
    assert(avesmapsWikiRegionParseHeight((string) $raw) === (float) $expected);
}
foreach (['unbekannt', '', '1100–1200', '-100', '20001'] as $raw) {
    assert(avesmapsWikiRegionParseHeight($raw) === null);
}
$parsed = avesmapsWikiRegionParsePage('Kahler Schirch',
    "{{Infobox Region\n|Name=Kahler Schirch\n|Art=Berg\n|Höhe=ca. 1100\n}}");
assert(avesmapsWikiRegionHeightFromRow($parsed['record']) === 1100.0);
assert(avesmapsWikiRegionBuildAssignObject($parsed['record'])['height_schritt'] === 1100.0);

$manual = avesmapsWikiRegionApplyHeight(['height_schritt' => 900], 1100);
assert($manual['height_schritt'] === 900);
assert($manual['field_origins']['height_schritt'] === 'manual');
$empty = avesmapsWikiRegionApplyHeight([], 1100);
assert($empty['height_schritt'] === 1100.0);
assert($empty['field_origins']['height_schritt'] === 'wiki');
assert(avesmapsWikiRegionApplyHeight($empty, 1200)['height_schritt'] === 1200.0);
assert(avesmapsWikiRegionApplyHeight($empty, null) === $empty);
$stored = ['height_schritt' => 1100, 'field_origins' => ['height_schritt' => 'wiki']];
assert(avesmapsWikiRegionApplyHeight($stored, 1100) === $stored);
assert(avesmapsWikiRegionApplyHeight(['height_schritt' => 0], 1100)['height_schritt'] === 0);
assert(!avesmapsWikiRegionHeightNeedsLive(['raw_json' => '{"height_schritt":1100}'], 100000));
assert(avesmapsWikiRegionHeightNeedsLive(['raw_json' => '{}'], 100000));
assert(!avesmapsWikiRegionHeightNeedsLive(['raw_json' => '{"height_schritt":null,"height_checked_at":99999}'], 100000));
assert(avesmapsWikiRegionHeightNeedsLive(['raw_json' => '{"height_checked_at":1}'], 100000));
echo "Berghöhen: Parser, Staging und Overrides grün.\n";
