<?php
// api/_internal/app/__tests__/map-features-delta-schlank-test.php
// Ein Delta-Abruf (since_revision) traegt keine globalen Bloecke.
//
// 💣 Gemessen 03.09.2026: `?since_revision=<aktuell>&edit_mode=1` lieferte 0 Features, aber 6,47 MB in
// 1,13 s -- Quellenkatalog, ~13.000 Verweise, Kanon ueber 11.500 Objekte, Innerorts-Objekte. Der
// Live-Abgleich liest davon NICHTS (js/routing/routing.js, pollLiveMapUpdates: nur features + revision).
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/map-features-delta-schlank-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/app/map-features-cache.php';

// ---- 1. Die Weiche ------------------------------------------------------------------------------
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => '5']) === true, 'since_revision gesetzt -> Delta');
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => '5', 'edit_mode' => '1']) === true, 'auch im Editor');
assert(avesmapsMapFeaturesIstDeltaAbruf([]) === false, 'ohne since_revision -> Vollabruf');
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => '']) === false, 'leer heisst nicht gesetzt');
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => ' ']) === false, 'Leerzeichen ebenso');
assert(avesmapsMapFeaturesIstDeltaAbruf(['bbox' => '1,2,3,4']) === false, 'bbox ist kein Delta');

// ---- 2. Der Endpunkt hängt die fünf Bloecke an die Weiche ---------------------------------------
// 🪤 Kommentare raus, sonst schlaegt der Test an der Warnung an, die vor der Falle warnt.
$quelle = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
$quelle = (string) preg_replace('#/\*.*?\*/#s', '', $quelle);
$quelle = (string) preg_replace('#^\s*//.*$#m', '', $quelle);

assert(substr_count($quelle, 'avesmapsMapFeaturesIstDeltaAbruf($_GET)') === 1, 'die Weiche wird genau einmal gelesen');
foreach ([
    '$sourceCorpora = $mapFeaturesIstDelta ? [] : avesmapsLoadSourceCorporaForPayload($pdo);',
    '$sourceCatalog = $mapFeaturesIstDelta ? [] : avesmapsLoadFeatureSourceCatalog($pdo);',
    '$featureSourceRefs = $mapFeaturesIstDelta ? [] : avesmapsLoadFeatureSourceRefs($pdo);',
    '$featureKanon = $mapFeaturesIstDelta ? [] : avesmapsFeatureSourcesDeriveKanon(',
    "'in_settlement_places' => \$mapFeaturesIstDelta ? [] : avesmapsMapFeaturesInSettlementPlaces(\$pdo),",
] as $zeile) {
    assert(str_contains($quelle, $zeile), 'fehlt im Endpunkt: ' . $zeile);
}
// Kein Block darf an der Weiche vorbei geladen werden.
foreach ([
    'avesmapsLoadSourceCorporaForPayload($pdo)',
    'avesmapsLoadFeatureSourceCatalog($pdo)',
    'avesmapsLoadFeatureSourceRefs($pdo)',
    'avesmapsMapFeaturesInSettlementPlaces($pdo)',
] as $aufruf) {
    assert(substr_count($quelle, $aufruf) === 1, 'genau ein Aufruf, und der haengt an der Weiche: ' . $aufruf);
}

fwrite(STDOUT, "OK map-features-delta-schlank-test\n");
