<?php

declare(strict_types=1);

// avesmapsEcosystemRegionsWithoutOverlap -- die Zahl hinter der Kachel „Zugehoerigkeit rechnen".
//
// 🔴 Warum diese Groesse und nicht ein Zeitstempel: eine Flaeche ohne Zeile in
// ecosystem_region_overlap ist fuer jede Lebensraum-Regel STUMM ("innerhalb" liest genau diese
// Tabelle). Und sie ist falsch-positiv-frei, weil die acht Klimabaender die Karte exakt kacheln --
// jede gezeichnete Flaeche bekommt nach einem sauberen Lauf mindestens eine Zeile. Die
// ausfuehrliche Herleitung samt Messung steht am Kopf der Funktion.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll
//           api/_internal/app/__tests__/zugehoerigkeit-offene-flaechen-test.php

require_once __DIR__ . '/../path-ecosystem.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test waere sonst lautlos gruen" . PHP_EOL);
    exit(1);
}

function avesmapsOffeneFlaechenTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT,
        kind TEXT, region_type TEXT NULL, is_active INTEGER NOT NULL DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_region_overlap (region_id INTEGER, other_region_id INTEGER, share REAL)');

    return $pdo;
}

/** Eine Region samt EINER gezeichneten Flaeche. */
function avesmapsOffeneFlaechenTestRegion(
    PDO $pdo,
    int $id,
    string $name,
    string $kind = 'topographie',
    int $aktiv = 1,
    int $flaecheAktiv = 1
): void {
    $pdo->prepare('INSERT INTO ecosystem_region (id, public_id, name, kind, is_active) VALUES (?,?,?,?,?)')
        ->execute([$id, 'r-' . $id, $name, $kind, $aktiv]);
    $pdo->prepare('INSERT INTO ecosystem_area (id, public_id, region_id, is_active) VALUES (?,?,?,?)')
        ->execute([$id, 'a-' . $id, $id, $flaecheAktiv]);
}

$pruefungen = 0;

// -- (1) Der Normalfall: gerechnet und ungerechnet nebeneinander -------------------------------
$pdo = avesmapsOffeneFlaechenTestPdo();
avesmapsOffeneFlaechenTestRegion($pdo, 1, 'Koschberge');
avesmapsOffeneFlaechenTestRegion($pdo, 2, 'Mittelaventurien', 'derographisch');
// Nur die Koschberge tragen eine Zeile -- Mittelaventurien ist nach dem letzten Lauf entstanden.
$pdo->exec('INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (1, 9, 0.9)');

$offen = avesmapsEcosystemRegionsWithoutOverlap($pdo);
assert($offen['count'] === 1, 'genau die neue Flaeche fehlt');
assert($offen['public_ids'] === ['r-2'], 'und sie wird namentlich genannt -- der Regeleditor zeigt es an der Bedingung');
assert($offen['truncated'] === false);
$pruefungen += 3;

// GEGENPROBE, die nicht null ist: ohne die Zeile fehlen BEIDE.
$pdo->exec('DELETE FROM ecosystem_region_overlap');
$beide = avesmapsEcosystemRegionsWithoutOverlap($pdo);
assert($beide['count'] === 2, 'GEGENPROBE: ohne jede Zeile ist alles offen -- die 1 oben war gemessen, nicht geraten');
$pruefungen++;

// -- (2) 💣 Ein KLIMABAND zaehlt nicht ----------------------------------------------------------
// Es ist keine Flaeche im Sinne einer Regel (dieselbe Grenze wie avesmapsLoreRuleReadAreas).
$pdo = avesmapsOffeneFlaechenTestPdo();
avesmapsOffeneFlaechenTestRegion($pdo, 1, 'Boreale Zone', 'klima');
assert(avesmapsEcosystemRegionsWithoutOverlap($pdo)['count'] === 0,
    'ein Klimaband ohne Zeile ist kein offener Posten');
$pruefungen++;

// -- (3) 💣 Eine Region OHNE gezeichnete Flaeche zaehlt nicht -----------------------------------
// Die Falle, die den Zaehler sonst nie auf null braechte: es gibt solche Zeilen (der
// Landschaften-Editor sagt an seiner Partnerliste selbst „Ohne gezeichnete Flaeche gibt es nichts
// zu verschneiden"). Sie bekommen nie eine Ueberlappungszeile -- ein Lauf aendert daran nichts.
$pdo = avesmapsOffeneFlaechenTestPdo();
$pdo->exec("INSERT INTO ecosystem_region (id, public_id, name, kind, is_active) VALUES (1,'r-1','Leere Region','topographie',1)");
assert(avesmapsEcosystemRegionsWithoutOverlap($pdo)['count'] === 0,
    'ohne gezeichnete Flaeche gibt es nichts zu verschneiden -- sonst waere der Knopf nie zufrieden');
$pruefungen++;

// Und dasselbe, wenn die einzige Flaeche im Papierkorb liegt.
$pdo = avesmapsOffeneFlaechenTestPdo();
avesmapsOffeneFlaechenTestRegion($pdo, 1, 'Geloeschte Flaeche', 'topographie', 1, 0);
assert(avesmapsEcosystemRegionsWithoutOverlap($pdo)['count'] === 0,
    'eine inaktive Flaeche zaehlt so wenig wie gar keine');
$pruefungen++;

// -- (4) Eine Region im Papierkorb zaehlt nicht -------------------------------------------------
$pdo = avesmapsOffeneFlaechenTestPdo();
avesmapsOffeneFlaechenTestRegion($pdo, 1, 'Weg damit', 'topographie', 0);
assert(avesmapsEcosystemRegionsWithoutOverlap($pdo)['count'] === 0);
$pruefungen++;

// -- (5) ⚠️ Die ZAHL bleibt vollstaendig, gekappt wird nur die Liste ----------------------------
// Dieselbe Trennung wie AVESMAPS_LORE_RULE_PREVIEW_SAMPLE: eine gekappte Zahl waere eine Luege
// ueber die Reichweite des Problems.
$pdo = avesmapsOffeneFlaechenTestPdo();
for ($i = 1; $i <= 5; $i++) {
    avesmapsOffeneFlaechenTestRegion($pdo, $i, 'Flaeche ' . $i);
}
$gekappt = avesmapsEcosystemRegionsWithoutOverlap($pdo, 2);
assert($gekappt['count'] === 5, 'die Zahl ist vollstaendig');
assert(count($gekappt['public_ids']) === 2, 'die Liste ist gekappt');
assert($gekappt['truncated'] === true, 'und die Kappung wird gemeldet, nie still');
$pruefungen += 3;

// -- (6) 💣 Fehlt eine Tabelle, ist die Antwort NICHTS -- nicht ALLES ---------------------------
// Ein Knopf, der nach einem Tabellenfehler „929 Flaechen noch nicht gerechnet" behauptet, schickt
// jemanden in einen Lauf ueber 929 Regionen, den es nicht braucht.
$pdo = avesmapsOffeneFlaechenTestPdo();
avesmapsOffeneFlaechenTestRegion($pdo, 1, 'Koschberge');
$pdo->exec('DROP TABLE ecosystem_region_overlap');
$kaputt = avesmapsEcosystemRegionsWithoutOverlap($pdo);
assert($kaputt['count'] === 0, 'ein Tabellenfehler behauptet keine offenen Posten');
assert($kaputt['public_ids'] === []);
$pruefungen += 2;

// -- (7) Die Zahl reist in der Statusantwort mit ------------------------------------------------
// 🔴 Die Verdrahtung: ohne dieses Feld haette die Kachel nichts zu zeigen, und die Funktion oben
// waere gruen und wirkungslos.
$pdo = avesmapsOffeneFlaechenTestPdo();
$pdo->exec('CREATE TABLE ecosystem_assignment_stamp (id INTEGER PRIMARY KEY, ecosystem_revision INT,
    map_revision INT, area_count INT, path_count INT, overlap_rows INT, territory_rows INT,
    path_rows_chord INT, path_rows_curve INT, location_rows INT, duration_ms INT, completed INT,
    computed_at TEXT)');
$pdo->exec("INSERT INTO ecosystem_assignment_stamp VALUES (1,1,1,0,0,0,0,0,0,0,0,1,'2026-08-19 04:12:00')");
$pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INT)');
$pdo->exec('INSERT INTO ecosystem_revision (id, revision) VALUES (1, 1)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INT)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 1)');
$pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
avesmapsOffeneFlaechenTestRegion($pdo, 1, 'Mittelaventurien', 'derographisch');
$status = avesmapsPathEcosystemStatus($pdo);
assert(isset($status['uncomputed']), 'assignment_status traegt die Zahl nicht -- die Kachel bliebe stumm');
assert($status['uncomputed']['count'] === 1);
assert($status['uncomputed']['public_ids'] === ['r-1']);
$pruefungen += 3;

echo "zugehoerigkeit-offene-flaechen: {$pruefungen} Zusicherungen bestanden." . PHP_EOL;
