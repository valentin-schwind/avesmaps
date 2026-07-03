<?php

declare(strict_types=1);

const AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE = true;

// AVESMAPS_WIKI_FUZZY_CUTOFF / AVESMAPS_WIKI_SYNC_TYPE_LOCATION /
// AVESMAPS_DEREGLOBUS_TO_MAP / AVESMAPS_POSITIONKARTE_TO_MAP moved to
// _internal/wiki/sync-constants.php so api/edit/wiki/dump.php's settlement
// conflict-generation path can also require them (it never required this
// endpoint file). See that file's docblock for the live-500 history.
require __DIR__ . '/../../_internal/wiki/sync-constants.php';

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

require __DIR__ . '/../../_internal/wiki/endpoint.php';

avesmapsWikiSyncHandleRequest('locations');