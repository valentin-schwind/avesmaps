<?php

declare(strict_types=1);

// Cross-cutting WikiSync constants used by BOTH the online-crawl sync endpoint
// (api/edit/wiki/sync.php) and the WikiDump conflict-generation path (reached
// via api/edit/wiki/dump.php -> _internal/wiki/dump-sync-kind.php ->
// avesmapsWikiSyncCoordinatesToMapLocation / avesmapsWikiSyncUpsertCase in
// locations-helpers.php). These used to be `const`-declared only inside the
// api/edit/wiki/sync.php ENDPOINT file, which dump.php never requires (it
// requires the _internal/wiki/sync.php LIBRARY instead) -- so the settlement
// conflict-analysis phase PHP-fatalled with "Undefined constant" on live
// (caught -> HTTP 500). Fake-PDO tests define()-shimmed these 4, masking the
// gap. Moved here so BOTH endpoints require the single source of truth.
//
// NOTE: AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS / AVESMAPS_WIKI_CATEGORY_TO_CLASS /
// AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS are NOT here -- they are already
// defined once in api/_internal/wiki/locations.php (which IS in dump.php's
// require graph). Do not add them here; that would double-define.

const AVESMAPS_WIKI_FUZZY_CUTOFF = 0.82;
const AVESMAPS_WIKI_SYNC_TYPE_LOCATION = 'location';

const AVESMAPS_DEREGLOBUS_TO_MAP = [
	'x_lon' => 30.3257445760,
	'x_lat' => 0.0014126835,
	'x_offset' => 438.0819758605,
	'y_lon' => 0.007511999997,
	'y_lat' => 33.5769120338,
	'y_offset' => -466.8085324960,
];

const AVESMAPS_POSITIONKARTE_TO_MAP = [
	'x_x' => 2.1490004455,
	'x_y' => 0.0010081646,
	'x_offset' => 188.8734061695,
	'y_x' => -0.0024556121,
	'y_y' => -2.1502199630,
	'y_offset' => 1018.3819994023,
];
