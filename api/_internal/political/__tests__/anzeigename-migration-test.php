<?php

declare(strict_types=1);

/**
 * Die Migration der Anzeigenamen aus style_json in political_territory.display_name (Fall #123).
 * Gefahren gegen eine echte SQLite-Fixture -- der Lauf wird AUSGEFUEHRT, nicht gelesen.
 *
 * 🔴 Trockenlauf ist die Vorgabe; §B belegt, dass dabei wirklich NICHTS geschrieben wird.
 * 💣 §D ist der Kern: nennen zwei Geometrien desselben Gebiets VERSCHIEDENE Namen, wird nicht
 * geraten. Genau diese Uneinigkeit war moeglich, weil jede Geometrie ihre eigene Kopie der Kette
 * traegt -- der Grund, aus dem der Name ueberhaupt ans Territorium wandert.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *     api/_internal/political/__tests__/anzeigename-migration-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "SKIP: pdo_sqlite fehlt.\n");
    exit(0);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-write.php';

function migTestEintrag(string $publicId, string $nodeKey, string $displayName): string
{
    return (string) json_encode(['assignmentDisplays' => [[
        'territoryPublicId' => $publicId,
        'nodeKey' => $nodeKey,
        'displayName' => $displayName,
    ]]], JSON_THROW_ON_ERROR);
}

function migTestKette(array $eintraege): string
{
    $displays = [];
    foreach ($eintraege as [$publicId, $nodeKey, $displayName]) {
        $displays[] = ['territoryPublicId' => $publicId, 'nodeKey' => $nodeKey, 'displayName' => $displayName];
    }

    return (string) json_encode(['assignmentDisplays' => $displays], JSON_THROW_ON_ERROR);
}

function migTestDb(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY, public_id TEXT, slug TEXT, name TEXT, display_name TEXT NULL,
        is_active INTEGER DEFAULT 1)');
    $pdo->exec('CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY, territory_id INTEGER, is_active INTEGER DEFAULT 1, style_json TEXT NULL)');

    $t = $pdo->prepare('INSERT INTO political_territory (id,public_id,slug,name,display_name) VALUES (?,?,?,?,?)');
    $t->execute([1, 'pt-nord', 'nordhjaldor', 'Nordhjaldor', null]);          // der gemeldete Fall
    $t->execute([2, 'pt-kosch', 'kosch', 'Kosch', null]);                     // Eintrag == Name
    $t->execute([3, 'pt-frei', 'frei', 'Freiland', null]);                    // Platzhalter
    $t->execute([4, 'pt-zwist', 'zwist', 'Zwist', null]);                     // uneinig
    $t->execute([5, 'pt-schon', 'schon', 'Schon da', 'Bereits gesetzt']);     // Spalte schon gefuellt
    $t->execute([6, 'pt-leer', 'leer', 'Ohne Geometrie', null]);              // gar keine Geometrie
    // 💣 Der Elternteil hat KEINE eigene Geometrie -- sein Eintrag liegt nur in der Ablage seines KINDES,
    // weil eine Geometrie die GANZE Vorfahrenkette traegt. Genau hier darf die Migration nicht zugreifen.
    $t->execute([7, 'pt-eltern', 'eltern', 'Elternland', null]);
    $t->execute([8, 'pt-kind', 'kind', 'Kindland', null]);

    $g = $pdo->prepare('INSERT INTO political_territory_geometry (id,territory_id,style_json) VALUES (?,?,?)');
    $g->execute([10, 1, migTestEintrag('pt-nord', 'nordhjaldor', 'Jarltum Nordhjaldor')]);
    $g->execute([11, 1, migTestEintrag('pt-nord', 'nordhjaldor', 'Jarltum Nordhjaldor')]); // einig
    $g->execute([12, 2, migTestEintrag('pt-kosch', 'kosch', 'Kosch')]);
    $g->execute([13, 3, migTestEintrag('pt-frei', 'frei', 'Unabhängig')]);
    $g->execute([14, 4, migTestEintrag('pt-zwist', 'zwist', 'Zwist A')]);
    $g->execute([15, 4, migTestEintrag('pt-zwist', 'zwist', 'Zwist B')]);      // uneinig!
    $g->execute([16, 5, migTestEintrag('pt-schon', 'schon', 'Aus dem Blob')]);
    // Die Geometrie des KINDES traegt beide Kettenglieder -- so sieht es live aus.
    $g->execute([17, 8, migTestKette([
        ['pt-eltern', 'eltern', 'Grossreich Elternland'],
        ['pt-kind', 'kind', 'Fuerstentum Kindland'],
    ])]);
    return $pdo;
}

function migTestSpalte(PDO $pdo, int $id): ?string
{
    $s = $pdo->prepare('SELECT display_name FROM political_territory WHERE id = :id');
    $s->execute(['id' => $id]);
    $wert = $s->fetchColumn();
    return $wert === false || $wert === null ? null : (string) $wert;
}

// ---- A. Der Trockenlauf ZAEHLT richtig ---------------------------------------------------------------
$pdo = migTestDb();
$trocken = avesmapsPoliticalMigrateDisplayNamesFromStyle($pdo);
assert($trocken['trockenlauf'] === true, 'A1: Trockenlauf ist die Vorgabe');
assert($trocken['uebernommen'] === 2, 'A2: zwei echte Anzeigenamen (' . $trocken['uebernommen'] . ')');
assert($trocken['uneinig'] === 1, 'A3: ein uneiniges Gebiet');
// ⚠️ Platzhalter zaehlen als "kein Eintrag" -- der geteilte Leser weist sie selbst ab, die Migration
// bekommt sie nie zu sehen. Eine eigene Zaehlung dafuer waere eine zweite Kopie derselben Regel
// gewesen; dieser Test hat sie beim ersten Lauf als tot entlarvt.
// Drei ohne verwertbaren Eintrag: Kosch (Eintrag == Name), Freiland (Platzhalter), Ohne Geometrie.
assert($trocken['ohne_eintrag'] === 4, 'A4: vier ohne verwertbaren Eintrag (' . $trocken['ohne_eintrag'] . ')');
assert(!array_key_exists('platzhalter', $trocken), 'A5: kein toter Platzhalter-Zaehler');

// ---- B. UND SCHREIBT NICHTS -------------------------------------------------------------------------
// 💣 Die Zusicherung, ohne die "Trockenlauf" nur ein Wort im Rueckgabewert waere.
foreach ([1, 2, 3, 4, 6, 7, 8] as $id) {
    assert(migTestSpalte($pdo, $id) === null, "B1: Trockenlauf laesst Gebiet {$id} unberuehrt");
}
assert(migTestSpalte($pdo, 5) === 'Bereits gesetzt', 'B2: und die gefuellte Spalte erst recht');

// ---- C. Scharf: nur der eine echte Fall wandert ------------------------------------------------------
$scharf = avesmapsPoliticalMigrateDisplayNamesFromStyle($pdo, false);
assert($scharf['uebernommen'] === 2, 'C1: scharf uebernimmt dieselben zwei');
assert(migTestSpalte($pdo, 1) === 'Jarltum Nordhjaldor', 'C2: der gemeldete Fall steht in der Spalte');
assert(migTestSpalte($pdo, 2) === null, 'C3: ein Eintrag gleich dem Namen wandert NICHT');
assert(migTestSpalte($pdo, 3) === null, 'C4: ein Platzhalter wandert NICHT');
assert(migTestSpalte($pdo, 6) === null, 'C5: ein Gebiet ohne Geometrie bleibt leer');

// ---- D. Uneinigkeit wird gemeldet, nicht geraten -----------------------------------------------------
// 💣 Der Kern. Jede Geometrie traegt ihre eigene Kopie der Kette; zwei koennen sich widersprechen.
assert(migTestSpalte($pdo, 4) === null, 'D1: ein uneiniges Gebiet bleibt UNBERUEHRT');
assert(count($scharf['konflikte']) === 1, 'D2: der Konflikt wird gemeldet');
$kandidaten = $scharf['konflikte'][0]['kandidaten'];
sort($kandidaten);
assert($kandidaten === ['Zwist A', 'Zwist B'], 'D3: mit beiden Kandidaten, damit ein Mensch entscheiden kann');

// ---- E. Die gefuellte Spalte wird NIE ueberschrieben -------------------------------------------------
// ⚠️ Dort hat jemand bewusst geschrieben; ein Altbestand aus einem Blob darf das nicht kippen.
assert(migTestSpalte($pdo, 5) === 'Bereits gesetzt', 'E1: gesetzte Spalte bleibt');

// ---- F. Der Lauf ist WIEDERHOLBAR --------------------------------------------------------------------
$zweiter = avesmapsPoliticalMigrateDisplayNamesFromStyle($pdo, false);
assert($zweiter['uebernommen'] === 0, 'F1: der zweite Lauf uebernimmt nichts mehr');
assert(migTestSpalte($pdo, 1) === 'Jarltum Nordhjaldor', 'F2: und aendert den ersten nicht');

// ---- G. EIN GEBIET HOLT NUR AUS SEINEN EIGENEN GEOMETRIEN -------------------------------------------
// 💣 Eine Geometrie traegt die GANZE Vorfahrenkette. Laese die Migration auch fremde Geometrien, zoege
// sie den Namen eines Elterngebiets aus der Kopie in einem beliebigen KIND -- reihenfolgeabhaengig und
// veraltbar, also genau der Nichtdeterminismus, wegen dem der Name ans Territorium wandert.
// 🪤 Die erste Fassung dieses Tests konnte das nicht sehen: dort trug jede Geometrie nur ihren EIGENEN
// Eintrag, und eine Mutation der JOIN-Bedingung blieb gruen. Die Fixture muss die Produktionsform haben.
assert(migTestSpalte($pdo, 8) === 'Fuerstentum Kindland', 'G1: das Kind holt aus seiner eigenen Geometrie');
assert(
    migTestSpalte($pdo, 7) === null,
    'G2: der Elternteil holt NICHTS aus der Ablage seines Kindes (' . var_export(migTestSpalte($pdo, 7), true) . ')'
);

fwrite(STDOUT, "OK: anzeigename-migration-test.php -- alle Zusicherungen gehalten.\n");
