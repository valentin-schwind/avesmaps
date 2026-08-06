<?php

declare(strict_types=1);

/**
 * 💣 Der Aussengrenzen-Hinweis: WAS ein Eltern-Umzug nebenbei bewirkt. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php
 *
 * Die abgeleitete Aussengrenze gehoert nur einem REINEN BEHAELTER (kein eigenes Polygon, aggregiert
 * Kinder) oder einer Wurzel. An genau diesem Praedikat hingen nacheinander vier Fehler. Diese Funktion
 * RECHNET NICHTS NACH und ruft NICHTS aus dem Aussengrenzen-System -- sie sagt einen Satz. Der Test
 * haelt beides fest: dass der Satz stimmt, und dass er ein Satz bleibt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-plan.php';

// counts[wiki_key] = ['name' => …, 'own_geometry' => int, 'children' => int]
$counts = [
    'wiki:grafschaft-ragath' => ['name' => 'Grafschaft Ragath', 'own_geometry' => 0, 'children' => 1],
    'wiki:f-rstentum-almada' => ['name' => 'Fürstentum Almada', 'own_geometry' => 0, 'children' => 4],
    'wiki:mark-ragathsquell' => ['name' => 'Mark Ragathsquell', 'own_geometry' => 1, 'children' => 1],
    'wiki:baronie-schwarztannen' => ['name' => 'Baronie Schwarztannen', 'own_geometry' => 1, 'children' => 0],
];

// --- Der alte Elternteil verliert sein letztes Kind ------------------------------------------------
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:mark-ragathsquell', 'wiki:grafschaft-ragath', 'wiki:f-rstentum-almada');
assert($note !== '', 'ein Umzug, der eine Rolle kippt, sagt es');
assert(str_contains($note, 'Grafschaft Ragath'), 'der alte Elternteil wird benannt');
assert(str_contains($note, 'kein Behälter mehr'), 'und was mit ihm passiert');

// --- Der neue Elternteil wird zum Behaelter ---------------------------------------------------------
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:baronie-schwarztannen', null, 'wiki:baronie-schwarztannen');
assert($note === '', 'ein Umzug auf sich selbst ist keiner');

$counts['wiki:neue-mark'] = ['name' => 'Neue Mark', 'own_geometry' => 0, 'children' => 0];
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:baronie-schwarztannen', null, 'wiki:neue-mark');
assert(str_contains($note, 'Neue Mark'), 'der neue Elternteil wird benannt');
assert(str_contains($note, 'wird zum Behälter'));

// --- Ein Umzug ohne Rollenwechsel sagt nichts -------------------------------------------------------
//
// Almada hat vier Kinder und behaelt drei; Ragathsquell traegt ein eigenes Polygon und bleibt so oder
// so gesperrt. Ein Hinweis, der bei jeder Zeile steht, wird nicht gelesen.
$counts['wiki:grafschaft-ragath']['children'] = 5;
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:mark-ragathsquell', 'wiki:grafschaft-ragath', 'wiki:f-rstentum-almada');
assert($note === '', 'kein Rollenwechsel => kein Hinweis');

// --- 💣 Und die Datei ruft nichts aus dem Aussengrenzen-System -------------------------------------
$source = (string) file_get_contents(__DIR__ . '/../territory-plan.php');
foreach (['DerivedGeometry', 'derived_geometry', 'GenerateOrUpdate', 'RecomputeDerived'] as $forbidden) {
    assert(!str_contains($source, $forbidden), "💣 die Rechen-Haelfte fasst {$forbidden} nicht an");
}

echo "territory-plan ok\n";

// =====================================================================================================
// TEIL 2 -- die drei read-only Quellen, auf sqlite
// =====================================================================================================
//
// Der Aussagewert eines Zwillings steht und faellt damit, dass er dieselben Zeilen liefert, die der
// Schreiber im Trockenlauf zaehlen wuerde -- Lesen des Quelltexts allein beweist das nicht. Dieser Teil
// baut denselben Bestand nach, den avesmapsWikiSyncMonitorApplyParentCache / …ApplyCustomNodes im
// Trockenlauf saehen, und prueft die zwei Zwillinge plus avesmapsTerritoryPlanNodeCounts dagegen.
//
// ⚠️ avesmapsTerritoryPlanStep bleibt hier AUSSEN VOR: es ruft avesmapsEnsureSyncPlanTables, deren DDL
// echtes MySQL ist (AUTO_INCREMENT, ENGINE=InnoDB, mehrspaltige KEY-Klauseln) -- sqlite lehnt das mit
// einem Syntaxfehler ab, empirisch geprueft. Dieselbe Grenze gilt schon fuer jeden Geschwister-Test
// (territory-wiki-plan-test.php, lore-plan-test.php): keiner von ihnen ruft seinen vollen *PlanStep
// gegen sqlite, aus demselben Grund.

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- part 2 would silently prove nothing.\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, short_name TEXT, type TEXT, continent TEXT, status TEXT, color TEXT,
        opacity REAL, coat_of_arms_url TEXT, wiki_url TEXT, valid_from_bf INTEGER, valid_to_bf INTEGER,
        valid_label TEXT, min_zoom INTEGER, max_zoom INTEGER, parent_id INTEGER, is_active INTEGER DEFAULT 1,
        editor_notes TEXT, sort_order INTEGER
    )'
);
$pdo->exec(
    'CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY AUTOINCREMENT, territory_id INTEGER, is_active INTEGER DEFAULT 1
    )'
);
$pdo->exec(
    'CREATE TABLE wiki_territory_model (
        id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, parent_wiki_key TEXT,
        parent_locked INTEGER DEFAULT 0, excluded INTEGER DEFAULT 0, source_origin TEXT,
        metadata_overrides_json TEXT
    )'
);

// --- Bestand: eine Grafschaft (Behaelter, ein Kind), eine Baronie (Kind, eigenes Polygon), eine ------
// Mark ohne Zuhause im Modell (Wurzel bleibt sie live), und ein eigener Knoten, der noch nicht existiert.
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active, parent_id) "
    . "VALUES ('P-GR', 'wiki:grafschaft-ragath', 'Grafschaft Ragath', 1, NULL)"
);
$grafschaftId = (int) $pdo->lastInsertId();
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active, parent_id) "
    . "VALUES ('P-BA', 'wiki:baronie-schwarztannen', 'Baronie Schwarztannen', 1, NULL)"
);
$baronieId = (int) $pdo->lastInsertId();
$pdo->exec("INSERT INTO political_territory_geometry (territory_id, is_active) VALUES ({$baronieId}, 1)");

// Modell sagt: die Baronie soll unter die Grafschaft -- Live hat noch keinen Elternteil (NULL).
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded) "
    . "VALUES ('wiki:baronie-schwarztannen', 'wiki:grafschaft-ragath', 0)"
);
// Ein eigener Knoten, platziert unter der Grafschaft, noch nicht auf der Karte.
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded, source_origin, metadata_overrides_json) "
    . "VALUES ('eigener-knoten:knoten001', 'wiki:grafschaft-ragath', 0, 'custom', '{\"name\":\"Markgenossenschaft\"}')"
);
// Ein zweiter eigener Knoten ohne Namen -- der Schreiber uebergeht ihn (missing_name), der Zwilling auch.
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded, source_origin, metadata_overrides_json) "
    . "VALUES ('eigener-knoten:knoten002', 'wiki:grafschaft-ragath', 0, 'custom', '{}')"
);
// Ein dritter, der schon auf der Karte existiert -- weder Schreiber noch Zwilling bieten ihn erneut an.
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active) "
    . "VALUES ('P-EX', 'eigener-knoten:knoten003', 'Schon da', 1)"
);
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded, source_origin, metadata_overrides_json) "
    . "VALUES ('eigener-knoten:knoten003', NULL, 0, 'custom', '{\"name\":\"Schon da\"}')"
);

// --- avesmapsTerritoryPlanNodeCounts: zwei Sammelabfragen, keine je Zeile --------------------------
$nodeCounts = avesmapsTerritoryPlanNodeCounts($pdo);
assert($nodeCounts['wiki:grafschaft-ragath']['own_geometry'] === 0, 'die Grafschaft hat kein eigenes Polygon');
assert($nodeCounts['wiki:grafschaft-ragath']['children'] === 0, 'live hat die Grafschaft noch KEIN Kind -- der Umzug ist erst geplant');
assert($nodeCounts['wiki:baronie-schwarztannen']['own_geometry'] === 1, 'die Baronie hat ihr Polygon');
assert(isset($nodeCounts['eigener-knoten:knoten003']), 'der schon vorhandene eigene Knoten zaehlt mit, sobald er live ist');

// --- avesmapsTerritoryPlanParentMoves: derselbe Join wie ApplyParentCache im Trockenlauf ------------
$moves = avesmapsTerritoryPlanParentMoves($pdo);
assert(count($moves) === 1, 'genau ein divergentes Kind');
assert(isset($moves['wiki:baronie-schwarztannen']), 'die Baronie zieht um');
assert($moves['wiki:baronie-schwarztannen']['old_key'] === null, 'sie hatte noch keinen Elternteil');
assert($moves['wiki:baronie-schwarztannen']['old_name'] === '(keiner)');
assert($moves['wiki:baronie-schwarztannen']['new_key'] === 'wiki:grafschaft-ragath');
assert($moves['wiki:baronie-schwarztannen']['new_name'] === 'Grafschaft Ragath');

// Modell und Live stimmen schon ueberein => kein Umzug mehr vorgeschlagen (dieselbe WHERE-Bedingung
// wie der Schreiber: child.parent_id IS NULL OR child.parent_id <> parent.id).
$pdo->exec("UPDATE political_territory SET parent_id = {$grafschaftId} WHERE id = {$baronieId}");
$movesAfter = avesmapsTerritoryPlanParentMoves($pdo);
assert($movesAfter === [], 'einmal angewendet, kein Vorschlag mehr');
$pdo->exec("UPDATE political_territory SET parent_id = NULL WHERE id = {$baronieId}"); // zurueck fuer den naechsten Teil

// --- avesmapsTerritoryPlanCustomNodesToCreate: derselbe Filter wie ApplyCustomNodes im Trockenlauf --
$toCreate = avesmapsTerritoryPlanCustomNodesToCreate($pdo);
$toCreateKeys = array_column($toCreate, 'wiki_key');
assert($toCreateKeys === ['eigener-knoten:knoten001'], 'nur der platzierte, benannte, noch nicht angelegte Knoten');
assert($toCreate[0]['name'] === 'Markgenossenschaft');
assert($toCreate[0]['parent_wiki_key'] === 'wiki:grafschaft-ragath');

echo "territory-plan (sqlite) ok\n";
