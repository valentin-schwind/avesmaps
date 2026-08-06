<?php

declare(strict_types=1);

/**
 * Finding A13 (c): the same question -- "is this a crossing?" -- was answered twice in one loop.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/crossing-predicate-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 WHY THIS IS NOT COSMETIC. avesmapsIsRouteCrossingLocation advanced the counter;
 * avesmapsBuildRouteLocationData decided the rename with its OWN, copied name check. They read the
 * same, so nothing broke. Had they ever drifted, a row would have been called `Kreuzung-5` without
 * the counter moving on -- and the next crossing would have got the same name. Location names are
 * GRAPH KEYS here; two nodes under one name is not a display glitch, it is a wrong route.
 *
 * ⚠️ What this change deliberately does NOT do: the names stay position numbers. That fix renames
 * 2.084 objects in the stable contract (A13 a/b) and is the owner's call.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// ⚠️ client-graph.php zuerst: die echte Schleife baut auch Wege, und deren Subtyp-Normalisierer
// wohnt dort. Ohne ihn stirbt der Aufruf an der ersten LineString-Vorlage -- und genau die braucht
// dieser Test, um zu belegen, dass eine Linie kein Ort ist.
require_once __DIR__ . '/../client-graph.php';
require_once __DIR__ . '/../network-data.php';

$isCrossing = static fn(array $properties): bool => avesmapsRoutePropertiesAreCrossing($properties);

// --- Tier 1: feature_type -------------------------------------------------------------------------
// Catches: the feature_type tier removed. ⚠️ Measured on the live map 06.08.2026: 782 rows carry the
// legacy 'crossing' spelling and 1.301 carry 'junction'. An earlier version of this line said "798",
// copied from a comment in map-features-location-lookup.js:16 rather than counted -- an unchecked
// number dressed as a measured one, in a change whose whole argument was that it measured first.
// The third row of the 2.084 is neither: one feature_type='location' with feature_subtype='crossing',
// which is what tier 2 exists for.
assert($isCrossing(['feature_type' => 'junction']), 'junction is a crossing');
assert($isCrossing(['feature_type' => 'crossing']), 'and so is the legacy spelling');
assert($isCrossing(['feature_type' => 'JUNCTION']), 'the comparison is case-insensitive, like the client');
assert(!$isCrossing(['feature_type' => 'location']), 'an ordinary place is not');

// --- Tier 2: the subtype, read under the client's four keys ---------------------------------------
// Catches: any one of the four keys dropped.
assert($isCrossing(['location_type' => 'crossing']), 'location_type says it');
assert($isCrossing(['settlement_class' => 'crossing']), 'settlement_class says it');
assert($isCrossing(['feature_subtype' => 'crossing']), 'feature_subtype says it');
assert($isCrossing(['locationType' => 'crossing']), 'and the camelCase spelling the client also reads');

// 💣 Catches: the key ORDER changed. The client reads location_type FIRST and stops at the first
// non-empty one -- so a row whose location_type says "dorf" is a village even if a later key says
// crossing. Reordering the keys here would make the two sides disagree about that row, which is
// precisely the drift this change exists to prevent.
assert(
    !$isCrossing(['location_type' => 'dorf', 'feature_subtype' => 'crossing', 'name' => 'Ein Dorf']),
    'the first non-empty key wins, in the client order'
);
assert(
    $isCrossing(['location_type' => 'crossing', 'feature_subtype' => 'dorf', 'name' => 'Ein Dorf']),
    'and the other way round too'
);
// An empty key is skipped rather than answering.
assert($isCrossing(['location_type' => '   ', 'settlement_class' => 'crossing']), 'blank keys are skipped');

// --- Tier 3: the name, which is all the server used to look at ------------------------------------
// Catches: the name tier removed -- that would stop renaming every crossing whose type says nothing.
assert($isCrossing(['name' => 'Kreuzung-Nord']), 'the name prefix still counts');
assert($isCrossing(['name' => 'Kreuzung am Fluss']), 'with or without a dash');
// 💣 Catches: the prefix widened. "Kreuzberg" starts with "Kreuz" and is not a crossing.
assert(!$isCrossing(['name' => 'Kreuzberg']), 'a longer word that merely starts alike is not one');
assert(!$isCrossing(['name' => 'Alte Kreuzung']), 'and the prefix is anchored at the start');
assert(!$isCrossing([]), 'nothing at all is not a crossing');
assert(!$isCrossing(['name' => 'Gareth', 'feature_type' => 'location', 'feature_subtype' => 'grossstadt']), 'a city is not one');

// --- The counter and the rename must ask the SAME predicate ---------------------------------------
//
// 💣 This is the finding. Feed a list where a row is a crossing by TYPE but not by name: under the
// old code the counter advanced (name check) while the rename did not, or vice versa. Now both
// answer alike, so the numbering stays dense and unique.
// 💣 THROUGH THE REAL LOOP, not a rebuilt one. The first version of this test assembled its own
// foreach here -- and thereby tested everything except the loop it was written for. Verified: making
// the COUNTER skip the legacy feature_type='crossing' spelling while the rename kept it produces 782
// duplicate graph keys on the live map, and that version stayed green. So did swapping the build and
// count lines (2.084 renumbered keys) and dropping the Point filter. All four are caught now, and
// the price is one function call.
// ⚠️ Seit dem 06.08.2026 (A13 b) kommt der Name aus `internal_id`, nicht aus einer Laufnummer --
// die Zeilen tragen deshalb eine. „Kreuzung C" ist eine Linie und bekommt bewusst KEINE: eine Id,
// die nie gebraucht wird, waere eine falsche Zusage an den Leser.
$features = [
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 8471, 'public_id' => 'pid-8471', 'name' => 'Kreuzung']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 12, 'public_id' => 'pid-12', 'name' => 'Gareth', 'feature_subtype' => 'grossstadt']],
    // A crossing whose NAME says nothing -- only the legacy feature_type does.
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 3, 'public_id' => 'pid-3', 'name' => 'Namenlos', 'feature_type' => 'crossing']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 4, 'public_id' => 'pid-4', 'name' => 'Auch namenlos', 'feature_type' => 'junction']],
    // 💣 DIE ZEILE, DIE DAS GANZE BEDINGTE UMBENENNEN TRAEGT: eine Kreuzung mit einem ECHTEN Namen.
    // Bis zum 06.08.2026 hat der Server ihn weggeworfen -- ausgerechnet dort, wo Namen
    // Graph-Schluessel sind und im Reiseplan stehen. Sie ist der Grund, warum „Kreuzungen benennen"
    // spaeter reine Dateneingabe ist und keine Aenderung am stabilen Vertrag mehr.
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 5, 'public_id' => 'pid-5', 'name' => 'Kreuzung am Ochsenwasser', 'feature_type' => 'junction']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 6, 'public_id' => 'pid-6', 'name' => 'Kreuzung-auto-7']],
    // Not a location at all: a label is skipped, and so is a line.
    ['geometry' => ['type' => 'Point'], 'properties' => ['internal_id' => 7, 'public_id' => 'pid-7', 'name' => 'Ein Label', 'feature_type' => 'label']],
    ['geometry' => ['type' => 'LineString'], 'properties' => ['name' => 'Kreuzung C']],
];
$network = avesmapsBuildRouteNetworkData(['features' => $features]);
$names = array_column($network['locations'], 'name');

// 💣 „Namenlos" und „Auch namenlos" SIND Kreuzungen (nach feature_type), behalten ihren Namen aber --
// er ist kein Platzhalter. Genau das ist die neue Regel, und sie sieht beim ersten Lesen falsch aus:
// vorher hiessen diese Zeilen `Kreuzung-2` und `Kreuzung-3`. Der Preis ist bewusst: wer den Namen
// einer Kreuzung ersetzt, obwohl jemand ihn vergeben hat, macht „Kreuzungen benennen" unmoeglich.
// ⚠️ Im Bestand kommt dieser Fall am 06.08.2026 NICHT vor -- gemessen an der Kartennutzlast, siehe
// die Zahlen im Befund. Er steht hier, weil er vorkommen KANN, sobald jemand einen Namen vergibt.
assert(
    $names === ['Kreuzung-8471', 'Gareth', 'Namenlos', 'Auch namenlos', 'Kreuzung am Ochsenwasser', 'Kreuzung-6'],
    'der Name kommt aus der Zeilen-Id, jeder NICHT-Platzhalter bleibt stehen, Label und Linie fallen weg'
);
// 💣 The damage this exists to prevent, stated as its own assertion: names are graph keys.
assert(count($names) === count(array_unique($names)), 'no two nodes share a name');
assert(count($network['locations']) === 6, 'the label and the line are not locations');

// 🔴 DIE EIGENSCHAFT, DIE (b) UEBERHAUPT KAUFT, und vor dem 06.08.2026 war sie nicht zu haben:
// DER NAME HAENGT NICHT MEHR VON DER POSITION AB. Frueher zaehlte eine Laufnummer die Kreuzungen in
// Lesereihenfolge durch -- eine eingefuegte oder geloeschte Kreuzung benannte bis zu 2.083 Knoten
// um, und jede Stelle, die einen solchen Namen ueber die Zeit aufbewahrt, zeigte danach woandershin.
// Gemessen wird das, indem dieselben Objekte in ANDERER Reihenfolge durchlaufen: die Zuordnung
// Objekt -> Name muss zeichengleich bleiben.
$umgedreht = avesmapsBuildRouteNetworkData(['features' => array_reverse($features)]);
$vorher = [];
foreach ($network['locations'] as $location) {
    $vorher[$location['public_id'] . '|' . $location['subtype'] . '|' . $location['id']] = $location['name'];
}
$nachher = [];
foreach ($umgedreht['locations'] as $location) {
    $nachher[$location['public_id'] . '|' . $location['subtype'] . '|' . $location['id']] = $location['name'];
}
ksort($vorher);
ksort($nachher);
assert($vorher === $nachher, 'die Namen sind unabhaengig von der Reihenfolge -- das ist der ganze Zweck von (b)');
assert(count(array_unique(array_column($umgedreht['locations'], 'name'))) === 6, 'auch umgedreht traegt jeder Knoten seinen eigenen Namen');

// ---- Der Platzhalter-Begriff, ausgeschrieben ------------------------------------------------------
//
// 💣 Diese Liste entscheidet, ob sich Kreuzungen spaeter benennen lassen. Zu weit gefasst, und ein
// von Hand vergebener Name wird wieder weggeworfen; zu eng, und Altzeilen behalten einen Namen, der
// mehrfach vorkommt -- also zwei Knoten unter einem Schluessel.
foreach (['Kreuzung', 'kreuzung', 'Kreuzung-5', 'Kreuzung-2084', 'Kreuzung-auto', 'Kreuzung-auto-7', '  Kreuzung  '] as $platzhalter) {
    assert(avesmapsRouteCrossingNameIsPlaceholder($platzhalter), "Platzhalter nicht erkannt: {$platzhalter}");
}
foreach (['Kreuzung am Ochsenwasser', 'Kreuzung Nord', 'Gareth', 'Kreuzung-Nord', 'Alte Kreuzung', ''] as $echt) {
    assert(!avesmapsRouteCrossingNameIsPlaceholder($echt), "faelschlich als Platzhalter erkannt: {$echt}");
}

// ⚠️ Ohne brauchbare Id NICHT `Kreuzung-0` fuer alle -- das waeren mehrere Knoten unter einem
// Schluessel, also falsche Routen. Der Rueckfall nimmt die oeffentliche Kennung: haesslich in der
// Etappenliste, aber eindeutig. Ein sichtbarer Fehler ist besser als ein stiller.
assert(
    avesmapsRouteCrossingName(['public_id' => 'abc-123']) === 'Kreuzung-abc-123',
    'ohne interne Id faellt der Name auf die oeffentliche Kennung zurueck'
);
assert(
    avesmapsRouteCrossingName(['internal_id' => 99, 'public_id' => 'abc-123']) === 'Kreuzung-99',
    'mit interner Id gewinnt sie -- sie ist die numerische, die der Client wegnormalisiert'
);

// 🔴 UND DIE ZAHL MUSS ZIFFERNWEISE SEIN. `normalizeNodeName` im Client streicht `Kreuzung-<Ziffern>`
// weg, damit der Reiseplan Kreuzungen als etappeninterne Stuetzpunkte schluckt statt sie als
// Stationen zu zeigen. Der Owner hat sich am 06.08.2026 ausdruecklich darauf festgelegt, dass sich
// die ETAPPENANZEIGE NICHT AENDERT -- eine UUID im Namen waere genau diese Aenderung.
foreach ($names as $name) {
    if (!str_starts_with($name, 'Kreuzung-')) {
        continue;
    }
    assert(
        preg_match('/^Kreuzung-\d+$/', $name) === 1,
        "der erzeugte Name muss `Kreuzung-<Ziffern>` sein, sonst zeigt ihn die Etappenliste an: {$name}"
    );
}

// 💣 Eine Kreuzung, die ihr NAME nicht verraet, wird trotzdem als eine erkannt -- das war A13 (c),
// und es traegt jetzt (b): ohne die Typ-Stufe fiele „Kreuzung am Ochsenwasser" nach einer Umbenennung
// aus dem Kreuzungsbegriff heraus, und api/locations/index.php meldete `is_crossing: false`.
// ⚠️ Frueher stand hier avesmapsIsRouteCrossingLocation() -- die Huelle des Zaehlers. Sie ist mit ihm
// weggefallen; geprueft wird dieselbe Sache eine Ebene tiefer, wo sie ohnehin entschieden wird.
assert(
    avesmapsRoutePropertiesAreCrossing(['name' => 'Namenlos', 'feature_type' => 'junction']),
    'a crossing without the name prefix is recognised by its type'
);
assert(
    avesmapsRoutePropertiesAreCrossing(['name' => 'Kreuzung am Ochsenwasser', 'feature_type' => 'junction']),
    'und eine BENANNTE Kreuzung bleibt eine Kreuzung -- daran haengt is_crossing im stabilen Vertrag'
);

// --- One rule, written once -----------------------------------------------------------------------
//
// Catches: somebody pasting the name check back in beside the shared predicate.
// ⚠️ The two assertions that used to stand here counted `strncmp(` and the predicate's own name in
// the source. Both were brittle in BOTH directions: rewriting the comparison as str_starts_with --
// behaviour for behaviour -- turned the first one red, and a legitimate third call of the shared
// predicate turned the second one red. They guarded a spelling, not a rule, and the rule is now
// guarded by the loop test above, which is where it belongs.
//
// What IS worth pinning from the source is that the two callers ask the shared predicate rather than
// carrying their own copy again -- the state this change removed.
$source = file_get_contents(__DIR__ . '/../network-data.php');
assert(is_string($source) && $source !== '', 'the source is readable');
// ⚠️ Toleranter Ausdruck, kein woertlicher Vergleich: seit dem 06.08.2026 haengt eine zweite
// Bedingung daran (der Platzhalter-Test), und eine Zusicherung, die daran zerbricht, lehrt nur, den
// Test zu bearbeiten statt ihn zu lesen. Was sie festhaelt, ist unveraendert: das Umbenennen fragt
// das GETEILTE Praedikat und traegt keine eigene, abgeschriebene Namenspruefung mehr.
assert(
    preg_match('/if \(avesmapsRoutePropertiesAreCrossing\(\$properties\)[^)]*\)/', $source) === 1,
    'das Umbenennen fragt das geteilte Praedikat'
);

// --- 🔴 What this predicate deliberately does NOT mirror -------------------------------------------
//
// The client's second tier has a STOPPING half this one lacks: `if (isKnownLocationTypeKey(subtype))
// return subtype;` -- so once the subtype names a known settlement class, the client never looks at
// the name at all. Here, a row with feature_subtype='dorf' AND a name starting with "Kreuzung" is
// still treated as a crossing, while the client calls it a village.
//
// ⚠️ Measured on the live map before writing this: 0 rows. And it is left as it is on purpose --
// mirroring the stopping half needs the six settlement keys, which already exist as TWO separate
// literal copies in this codebase (api/app/report-location.php, api/edit/map/features.php). A third
// copy to close a zero-row gap would be the very duplication this change removed, one file over.
// The assertion below records the divergence rather than hiding it; it is meant to CHANGE the day
// that list gets a shared home.
assert(
    avesmapsRoutePropertiesAreCrossing(['feature_subtype' => 'dorf', 'name' => 'Kreuzung-auto-7']),
    'the name still wins over a known settlement subtype here -- the client stops earlier (0 live rows)'
);

echo "crossing-predicate ok\n";
