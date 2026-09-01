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

echo "map-search-verdrahtung-test: OK\n";
