<?php

declare(strict_types=1);

const AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE = true;

const AVESMAPS_WIKI_FUZZY_CUTOFF = 0.82;
const AVESMAPS_WIKI_SYNC_TYPE_LOCATION = 'location';

const AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS = [
    'dorf' => 'Dorf',
    'kleinstadt' => 'Kleinstadt',
    'stadt' => 'Stadt',
    "grossstadt" => "Gro\u{00DF}stadt",
    'metropole' => 'Metropole',
    "gebaeude" => "Besondere Bauwerke/St\u{00E4}tten",
];

const AVESMAPS_WIKI_CATEGORY_TO_CLASS = [
    'Dorf' => 'dorf',
    'Kleinstadt' => 'kleinstadt',
    'Stadt' => 'stadt',
    'Mittlere Stadt' => 'stadt',
    "Gro\u{00DF}stadt" => 'grossstadt',
    "Metropole (Siedlungsgr\u{00F6}\u{00DF}e)" => 'metropole',
];

const AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS = [
    'dorf' => 'Dorf',
    "gebaeude" => "Besondere Bauwerke/St\u{00E4}tten",
    'kleinstadt' => 'Kleinstadt',
    'stadt' => 'Stadt',
    "grossstadt" => "Gro\u{00DF}stadt",
    'metropole' => 'Metropole',
];

// AVESMAPS_WIKI_CASE_LABELS is defined ONCE, in api/_internal/wiki/locations.php
// (required below via endpoint.php). This endpoint used to declare its OWN copy
// here; because both were file-scope `const` (which cannot be defined()-guarded)
// and this file is included FIRST, this copy silently WON the redeclare and the
// newer WikiDump labels added in locations.php (field_divergence / coat_available
// / coordinate_drift) never reached avesmapsWikiSyncCaseLabel() -> the cases-list
// endpoint. Removing the duplicate here makes locations.php the single source;
// avesmapsWikiSyncCaseLabel() only reads the const at request time, long after
// endpoint.php has required locations.php, so this is safe.

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

require __DIR__ . '/../../_internal/wiki/endpoint.php';

avesmapsWikiSyncHandleRequest('locations');