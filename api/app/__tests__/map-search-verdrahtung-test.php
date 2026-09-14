<?php

declare(strict_types=1);

/**
 * VERDRAHTUNG der Kartensuche: laeuft eine Quelle wirklich bis in die Antwort?
 * ===========================================================================
 * 💣 Ein gruener Test einer Funktion beweist NICHT, dass jemand sie aufruft. Genau
 * diese Luecke ist in diesem Projekt schon einmal durch sechs Code-Reviews
 * gerutscht. avesmapsBuildMapSearchResults fuehrt sieben Quellen zusammen und hatte
 * bis 20.08.2026 keinen einzigen Test -- weil die Funktion in einem ENDPUNKT steht
 * und ein `require` davon eine Anfrage ausfuehren wuerde.
 *
 * Der Ausweg: die Funktionsdefinitionen aus der Datei schneiden und ausfuehren,
 * ohne den Anfrage-Teil zu beruehren. Damit laeuft hier der ECHTE Code des
 * Endpunkts, nicht eine Abschrift, die auseinanderlaufen kann.
 *
 * ⚠️ Die Quelle wird an ZWEI Markern geschnitten. Verschwinden sie (Umbau des
 * Endpunkts), schlaegt der Test mit einer klaren Meldung fehl, statt still nichts
 * mehr zu pruefen.
 */

require_once __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/text/ascii-fold.php';
require_once __DIR__ . '/../../_internal/app/map-search-scoring.php';
require_once __DIR__ . '/../../_internal/app/search-section.php';
require_once __DIR__ . '/../../_internal/app/in-settlement-search.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/citymap-search.php';
require_once __DIR__ . '/../../_internal/app/game-literature-search.php';
require_once __DIR__ . '/../../_internal/app/lore-search.php';
require_once __DIR__ . '/../../_internal/app/offmap-search.php';
require_once __DIR__ . '/../../_internal/app/landscape-search.php';
require_once __DIR__ . '/../../_internal/wiki/path-naming.php';

$endpunkt = __DIR__ . '/../map-search.php';
$quelle = (string) file_get_contents($endpunkt);

$anfrageBeginn = strpos($quelle, "\ntry {");
$funktionenBeginn = strpos($quelle, 'function avesmapsReadMapSearchQuery');
assert($anfrageBeginn !== false, 'Marker "try {" nicht gefunden -- Endpunkt umgebaut?');
assert($funktionenBeginn !== false, 'Marker der ersten Funktion nicht gefunden -- Endpunkt umgebaut?');

// Kopf: die Konstanten mitnehmen (der Deckel steht dort), requires und declare weg --
// die Abhaengigkeiten sind oben schon geladen, und __DIR__ zeigte hier woandershin.
$kopf = substr($quelle, 0, $anfrageBeginn);
$kopf = (string) preg_replace('/^\s*(<\?php|declare\(strict_types=1\);|require(_once)?\s.*?;)\s*$/m', '', $kopf);

// ⚠️ eval() ist hier BEGRUENDET und traegt keine Eingabe von aussen: die einzige
// Quelle ist eine feste Datei DIESES Repos (api/app/map-search.php), gelesen ueber
// __DIR__, ohne Parameter, ohne Netz, ohne Benutzereingabe. Der Test laeuft nur auf
// der Entwicklungsmaschine und in der CI, nie im Web.
// Der Zweck ist genau der Punkt: den ECHTEN Endpunkt-Code pruefen statt einer
// Abschrift. Ein `require` scheidet aus -- es wuerde die Anfrage ausfuehren (Header
// senden, DB verbinden, Antwort schreiben). Eine nachgebaute Kopie der Funktion
// waere schlimmer als kein Test: sie wuerde gruen bleiben, waehrend der Endpunkt
// bricht.
eval($kopf . "\n" . substr($quelle, $funktionenBeginn));

assert(
    defined('AVESMAPS_OFFMAP_SEARCH_LIMIT'),
    'Der Deckel der siebten Quelle fehlt -- ohne ihn fuellt ein Allerweltswort die Liste'
);

// ---------------------------------------------------------------------------
// Eine SQLite-Verbindung reicht: alle Tabellen fehlen, jede Abfrage faellt in ihr
// eigenes catch und liefert leer. Genau das soll sie -- geprueft wird der WEG,
// nicht der Bestand.
// ---------------------------------------------------------------------------

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Zwei Kartenzeilen: „Weiden" ist das Sprungziel, „Rabenmark" ist ein ECHTER
// Kartentreffer fuer dieselbe Anfrage -- nur so laesst sich pruefen, dass die neuen
// Zeilen darunter landen.
$mapRows = [
    [
        'public_id' => 'reg-weiden',
        'feature_type' => 'region',
        'feature_subtype' => 'region',
        'name' => 'Weiden',
        'geometry_type' => 'Polygon',
        'properties_json' => null,
        'min_x' => 10.0, 'min_y' => 10.0, 'max_x' => 20.0, 'max_y' => 20.0,
    ],
    [
        'public_id' => 'reg-rabenmark',
        'feature_type' => 'region',
        'feature_subtype' => 'region',
        'name' => 'Rabenmark',
        'geometry_type' => 'Polygon',
        'properties_json' => null,
        'min_x' => 30.0, 'min_y' => 30.0, 'max_x' => 40.0, 'max_y' => 40.0,
    ],
];

$offmapRows = [
    [
        'title' => 'Rabenstein',
        'type_label' => 'Burg',
        'place_raw' => '[[Weiden]]',
        'wiki_url' => 'https://wiki/Rabenstein',
        'kind' => 'building',
    ],
    [
        'title' => 'Rabenschlucht',
        'type_label' => 'Schlucht',
        'place_raw' => '',
        'wiki_url' => 'https://wiki/Rabenschlucht',
        'kind' => 'region',
    ],
];

$results = avesmapsBuildMapSearchResults(
    $mapRows,
    [],
    'raben',
    20,
    [],
    $pdo,
    [],
    [],
    ['entries' => [], 'places_by_entry' => []],
    $offmapRows
);

$offmap = array_values(array_filter(
    $results,
    static fn(array $entry): bool => ($entry['kind'] ?? '') === 'offmap'
));

// 🔴 DIE eigentliche Zusicherung: die Quelle kommt in der ANTWORT an.
assert($offmap !== [], 'Die siebte Quelle erreicht die Antwort nicht -- nicht verdrahtet');
assert(count($offmap) === 2, 'beide Treffer, nicht nur der erreichbare');

$byName = [];
foreach ($offmap as $entry) {
    $byName[$entry['name']] = $entry;
}

// Der erreichbare Treffer traegt sein Ziel bis nach draussen.
assert($byName['Rabenstein']['place_public_id'] === 'reg-weiden', 'Sprungziel reist mit');
assert($byName['Rabenstein']['place_kind'] === 'region');
assert($byName['Rabenstein']['unresolved'] === false);
assert($byName['Rabenstein']['not_on_map'] === true);

// Der unerreichbare auch -- als solcher erkennbar.
assert($byName['Rabenschlucht']['unresolved'] === true);
assert($byName['Rabenschlucht']['place_public_id'] === '');

// 💣 Der Sektionszaehler muss an JEDER Zeile haengen: der Client liest ihn aus dem
// Eintrag, nicht aus einem Kopf. Fehlt er, zeigt die Liste keine „… und N weitere".
assert(($byName['Rabenstein']['offmap_total'] ?? null) === 2, 'offmap_total an der Zeile');

// 🔴 Die Reihenfolge IST die Regel „unter den Kartentreffern" -- es gibt keinen
// zweiten Sortierschritt, der das noch richten koennte.
$kinds = array_map(static fn(array $e): string => (string) ($e['kind'] ?? ''), $results);
$ersterOffmap = array_search('offmap', $kinds, true);
$letzterKartentreffer = -1;
foreach ($kinds as $i => $kind) {
    if (!in_array($kind, ['offmap', 'citymap', 'adventure', 'lore'], true)) {
        $letzterKartentreffer = $i;
    }
}
assert($letzterKartentreffer >= 0, 'die Probe braucht einen echten Kartentreffer, sonst prueft sie nichts');
assert(
    $ersterOffmap > $letzterKartentreffer,
    'Objekte ohne Kartenobjekt stehen UNTER allen echten Kartentreffern'
);

// Interne Sortierfelder duerfen nicht mit hinausreisen.
foreach ($offmap as $entry) {
    assert(!array_key_exists('score', $entry), 'score bleibt drin');
    assert(!array_key_exists('search_texts', $entry), 'search_texts bleibt drin');
}

// Eine Anfrage, die nichts trifft, liefert auch keine offmap-Zeile.
$leer = avesmapsBuildMapSearchResults(
    $mapRows, [], 'zzzznichts', 20, [], $pdo, [], [], ['entries' => [], 'places_by_entry' => []], $offmapRows
);
assert($leer === [], 'ohne Treffer keine Zeilen');

// ===========================================================================
// LANDSCHAFTEN OHNE EIGENE BESCHRIFTUNG (Entwurf
// docs/superpowers/specs/2026-08-28-landschaften-in-der-suche-design.md).
// 🔴 Gefahren wird der ECHTE Leser gegen echte Tabellen -- die Abfrage ist der Teil, der auf STRATO
// zuerst bricht (Ableitungstabelle statt GROUP BY ueber eine JSON-Spalte), und ein reiner Test des
// Bauers saehe davon nichts.
// ===========================================================================

$pdoL = new PDO('sqlite::memory:');
$pdoL->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdoL->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT,
    region_type TEXT, label_public_id TEXT, properties_json TEXT, is_active INTEGER)');
$pdoL->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, region_id INTEGER, min_x REAL, min_y REAL,
    max_x REAL, max_y REAL, is_active INTEGER)');
$pdoL->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, is_active INTEGER)');

$regionen = [
    [1, 'r-mistel', 'Mistelwald', 'vegetation', 'wald', null, null, 1],
    [2, 'r-perlen-1', 'Archipel der Perlen', 'topographie', 'insel', null, null, 1],
    [3, 'r-perlen-2', 'Archipel der Perlen', 'topographie', 'insel', null, null, 1],
    // 💣 Toter Zeiger UND ein fremdes gleichnamiges Vulkan-Label: der Fall, der den Entwurf ausgeloest hat.
    [4, 'r-cealan', 'Ceälan', 'topographie', 'insel', 'l-geloescht', null, 1],
    [5, 'r-blent', 'Blentforst', 'vegetation', 'wald', null, null, 1],
    [6, 'r-auto', 'Wald-001', 'vegetation', 'wald', null, null, 1],
    [7, 'r-flaeche', 'Fläche-048', 'vegetation', 'urwald', null, null, 1],
    [8, 'r-klima', 'Polare Zone', 'klima', 'polar', null, null, 1],
    [9, 'r-leer', 'Leerwald', 'vegetation', 'wald', null, null, 1],
    [10, 'r-weg', 'Verlorener Wald', 'vegetation', 'wald', null, null, 0],
    [11, 'r-sumpf', 'Sumpf-003', 'vegetation', 'moor', null, null, 1],
    [12, 'r-merker', 'Farindel', 'vegetation', 'wald', null, '{"auto_name": true}', 1],
];
$einfuegen = $pdoL->prepare('INSERT INTO ecosystem_region VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
foreach ($regionen as $zeile) {
    $einfuegen->execute($zeile);
}
$flaechen = [
    [1, 30, 40, 32, 42, 1],
    [1, 33, 43, 35, 45, 1],
    // Eine geloeschte Flaeche darf die Huelle nicht aufziehen.
    [1, 0, 0, 999, 999, 0],
    [2, 965, 584, 969, 587, 1],
    [3, 972, 585, 974, 588, 1],
    [4, 70, 70, 71, 71, 1],
    [5, 80, 80, 81, 81, 1],
    [6, 1, 1, 2, 2, 1],
    [7, 1, 1, 2, 2, 1],
    [8, 0, 900, 1024, 1024, 1],
    // Leerwald hat NUR eine geloeschte Flaeche -- nichts zum Anfliegen.
    [9, 5, 5, 6, 6, 0],
    [10, 5, 5, 6, 6, 1],
    [11, 1, 1, 2, 2, 1],
    [12, 1, 1, 2, 2, 1],
];
$einfuegen = $pdoL->prepare('INSERT INTO ecosystem_area (region_id, min_x, min_y, max_x, max_y, is_active) VALUES (?, ?, ?, ?, ?, ?)');
foreach ($flaechen as $zeile) {
    $einfuegen->execute($zeile);
}
$einfuegen = $pdoL->prepare('INSERT INTO ecosystem_region_type VALUES (?, ?, ?, ?)');
foreach ([
    ['vegetation', 'wald', 'Wald', 1],
    ['vegetation', 'urwald', 'Urwald', 1],
    ['topographie', 'insel', 'Insel', 1],
    ['klima', 'polar', 'Polare Zone', 1],
    // Stillgelegt -- ihr Griff „Sumpf-003" bleibt trotzdem maschinell.
    ['vegetation', 'sumpf', 'Sumpf', 0],
] as $zeile) {
    $einfuegen->execute($zeile);
}

$kartenzeilen = [
    [
        'public_id' => 'l-vulkan', 'feature_type' => 'label', 'feature_subtype' => 'vulkan', 'name' => 'Ceälan',
        'geometry_type' => 'Point', 'properties_json' => '{"text":"Ceälan"}',
        'min_x' => 10.0, 'min_y' => 10.0, 'max_x' => 10.0, 'max_y' => 10.0,
    ],
    [
        'public_id' => 'l-blent', 'feature_type' => 'label', 'feature_subtype' => 'wald', 'name' => 'Blentforst',
        'geometry_type' => 'Point', 'properties_json' => '{"text":"Blentforst","ecosystem_region_public_id":"r-blent"}',
        'min_x' => 80.5, 'min_y' => 80.5, 'max_x' => 80.5, 'max_y' => 80.5,
    ],
];

$suche = static fn(string $q): array => avesmapsBuildMapSearchResults($kartenzeilen, [], $q, 20, [], $pdoL);
$nurLandschaften = static fn(array $treffer): array => array_values(array_filter(
    $treffer,
    static fn(array $e): bool => ($e['kind'] ?? '') === 'landscape'
));

$mistel = $nurLandschaften($suche('mistelwald'));
assert(count($mistel) === 1, '🔴 die Landschaft erreicht die Antwort nicht -- nicht verdrahtet');
assert($mistel[0]['name'] === 'Mistelwald');
assert($mistel[0]['public_ids'] === ['r-mistel']);
assert($mistel[0]['ecosystem_kind'] === 'vegetation');
assert($mistel[0]['type_label'] === 'Wald');
assert(
    [$mistel[0]['min_x'], $mistel[0]['min_y'], $mistel[0]['max_x'], $mistel[0]['max_y']] === [30.0, 40.0, 35.0, 45.0],
    '💣 die geloeschte Flaeche zieht die Huelle auf: ' . json_encode($mistel[0])
);
foreach (['score', 'search_texts', 'group_key', 'properties_json'] as $intern) {
    assert(!array_key_exists($intern, $mistel[0]), $intern . ' reist mit hinaus');
}

$perlen = $nurLandschaften($suche('archipel'));
assert(count($perlen) === 1, 'zwei Regionen gleichen Namens sind EIN Treffer');
assert($perlen[0]['public_ids'] === ['r-perlen-1', 'r-perlen-2']);

// Ceälan: Vulkan-Label UND Insel -- nach Identitaet gefiltert, nicht nach Namen (Owner 14.09.2026).
$cealan = $suche('Ceälan');
$arten = array_map(static fn(array $e): string => (string) $e['kind'], $cealan);
$labelStelle = array_search('label', $arten, true);
$landschaftStelle = array_search('landscape', $arten, true);
assert($labelStelle !== false, 'das Vulkan-Label bleibt sein eigener Treffer');
assert($landschaftStelle !== false, '💣 die Insel fehlt -- die Namensregel ist zurueck');
assert($labelStelle < $landschaftStelle, 'bei gleichem Punktestand steht die Beschriftung vor der Landschaft');

$blent = $suche('blentforst');
assert(in_array('label', array_map(static fn(array $e): string => (string) $e['kind'], $blent), true));
assert($nurLandschaften($blent) === [], 'eine Landschaft, deren EIGENE Beschriftung so heisst, kommt nicht doppelt');

foreach (['wald-001', 'flaeche', 'polare', 'sumpf', 'farindel', 'leerwald', 'verlorener'] as $versteckt) {
    assert($nurLandschaften($suche($versteckt)) === [], 'verborgen muss bleiben: ' . $versteckt);
}

// Fehlen die Tabellen (die SQLite-Verbindung ganz oben hat keine), faellt nur diese Quelle aus.
assert(
    $nurLandschaften(avesmapsBuildMapSearchResults($mapRows, [], 'raben', 20, [], $pdo)) === [],
    'ohne Landschaftstabellen keine Landschaft und kein Absturz'
);

echo "map-search-verdrahtung-test: OK\n";
