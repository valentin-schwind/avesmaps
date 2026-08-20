<?php

declare(strict_types=1);

// Die EINMALIGE Startaufstellung des Stapels (Owner 19.08.2026: „nimm das als grundlage fuer die
// initiale sortierung und loes die regel danach auf").
//
// 💣 DIE ABGESCHAFFTE REGEL STEHT HIER ALS ZEUGE: gross unten (kleine Zahl), klein oben. Wer diese
// Fixture „aufraeumt", nimmt dem Umbau seinen einzigen Beleg dafuer, dass sich am Auslieferungstag
// am Bild nichts aendert.

require_once __DIR__ . '/../ecosystem-flaeche.php';
require_once __DIR__ . '/../ecosystem-stapel.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT,
        is_active INTEGER DEFAULT 1, stack_order INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0)'
);
$pdo->exec(
    'CREATE TABLE ecosystem_area (
        id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER,
        geometry_geojson TEXT, is_active INTEGER DEFAULT 1)'
);

$quadrat = static function (float $seite, float $x = 0.0): string {
    return (string) json_encode(['type' => 'Polygon', 'coordinates' => [[
        [$x, 0], [$x + $seite, 0], [$x + $seite, $seite], [$x, $seite], [$x, 0],
    ]]]);
};

$region = static function (PDO $pdo, int $id, string $publicId, string $kind): void {
    $pdo->prepare('INSERT INTO ecosystem_region (id, public_id, kind) VALUES (?, ?, ?)')
        ->execute([$id, $publicId, $kind]);
};
$flaeche = static function (PDO $pdo, string $publicId, int $regionId, string $geojson): void {
    $pdo->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson) VALUES (?, ?, ?)')
        ->execute([$publicId, $regionId, $geojson]);
};
$ordnung = static function (PDO $pdo, string $kind): array {
    return $pdo->query(
        "SELECT public_id FROM ecosystem_region WHERE kind = '$kind' ORDER BY stack_order ASC, id ASC"
    )->fetchAll(PDO::FETCH_COLUMN);
};

// --- Aufbau: drei Vegetations-Regionen, absichtlich in der falschen Reihenfolge eingefuegt --------
$region($pdo, 1, 'r-gross', 'vegetation');
$region($pdo, 2, 'r-mittel', 'vegetation');
$region($pdo, 3, 'r-klein', 'vegetation');
$flaeche($pdo, 'a1', 1, $quadrat(100.0));
$flaeche($pdo, 'a2', 2, $quadrat(10.0));
$flaeche($pdo, 'a3', 3, $quadrat(1.0));

// Eine Region mit ZWEI Flaechen: gezaehlt wird die SUMME, nicht die groesste.
// 5x5 + 5x5 = 50 -- damit liegt sie zwischen der mittleren (100) und der kleinen (1).
$region($pdo, 4, 'r-zweiteilig', 'vegetation');
$flaeche($pdo, 'a4', 4, $quadrat(5.0));
$flaeche($pdo, 'a5', 4, $quadrat(5.0, 50.0));

// Eine zweite Ebene, die von alldem unberuehrt bleiben muss.
$region($pdo, 5, 't-gross', 'topographie');
$flaeche($pdo, 'a6', 5, $quadrat(80.0));

$geschrieben = avesmapsEcosystemSeedStackOrder($pdo);
assert($geschrieben === 5, "5 Zeilen erwartet, $geschrieben bekommen");

// --- Die Regel selbst: gross unten, klein oben ---------------------------------------------------
$erwartet = ['r-gross', 'r-mittel', 'r-zweiteilig', 'r-klein'];
$ist = $ordnung($pdo, 'vegetation');
assert($ist === $erwartet, 'gross unten, klein oben -- bekommen: ' . implode(', ', $ist));

// --- Luecken zwischen den Raengen, damit „nach vorn/hinten" ohne Neunummerierung auskommt --------
$werte = $pdo->query("SELECT stack_order FROM ecosystem_region WHERE kind = 'vegetation' ORDER BY stack_order ASC")
    ->fetchAll(PDO::FETCH_COLUMN);
assert((int) $werte[1] - (int) $werte[0] >= 10, 'Schrittweite mindestens 10');

// --- Jede Ebene hat ihren EIGENEN Zahlenraum ------------------------------------------------------
// 🔴 Die vier Ebenen liegen in eigenen Leaflet-Panes mit festem z-index; ein gemeinsamer Zahlenraum
// haette dort keine Bedeutung.
$topo = (int) $pdo->query("SELECT stack_order FROM ecosystem_region WHERE public_id = 't-gross'")->fetchColumn();
assert($topo === 10, "Topographie faengt bei 10 an, bekommen: $topo");

// --- Ein zweiter Lauf ruehrt Bestehendes NICHT an ------------------------------------------------
// 💣 Das ist der Unterschied zwischen einer Startaufstellung und einer weiterlaufenden Regel: ein
// Nachlauf ueber alle Zeilen wuerde eine von Hand nach hinten geschobene Region wieder einsortieren.
$vorher = $pdo->query('SELECT public_id, stack_order FROM ecosystem_region ORDER BY id')->fetchAll(PDO::FETCH_KEY_PAIR);
assert(avesmapsEcosystemSeedStackOrder($pdo) === 0, 'zweiter Lauf schreibt nichts');
$nachher = $pdo->query('SELECT public_id, stack_order FROM ecosystem_region ORDER BY id')->fetchAll(PDO::FETCH_KEY_PAIR);
assert($vorher === $nachher, 'zweiter Lauf laesst alles stehen');

// --- Eine spaeter angelegte Region reiht sich HINTER dem Bestehenden ein, also ganz oben ---------
$region($pdo, 6, 'r-neu', 'vegetation');
$flaeche($pdo, 'a7', 6, $quadrat(200.0));   // die GROESSTE -- und trotzdem oben
assert(avesmapsEcosystemSeedStackOrder($pdo) === 1, 'nur die neue Zeile');
$letzte = $pdo->query("SELECT public_id FROM ecosystem_region WHERE kind = 'vegetation' ORDER BY stack_order DESC LIMIT 1")
    ->fetchColumn();
assert($letzte === 'r-neu', "die neue Region liegt vorn, bekommen: $letzte");

// --- Eine Region OHNE Flaeche zaehlt 0 ------------------------------------------------------------
// 🪤 Und 0 heisst „ganz oben" -- der ungefaehrliche Platz: sie verdeckt nichts.
$region($pdo, 7, 'r-leer', 'vegetation');
$region($pdo, 8, 'r-dick', 'vegetation');
$flaeche($pdo, 'a8', 8, $quadrat(300.0));
avesmapsEcosystemSeedStackOrder($pdo);
$zwei = $pdo->query("SELECT public_id FROM ecosystem_region WHERE public_id IN ('r-leer','r-dick') ORDER BY stack_order ASC")
    ->fetchAll(PDO::FETCH_COLUMN);
assert($zwei === ['r-dick', 'r-leer'], 'die leere Region liegt ueber der dicken');

// --- Stabil bei Gleichstand: nach id, nicht zufaellig --------------------------------------------
// 🪤 Sonst wuerfelte jeder Lauf die Stapelung neu, und ein Klick traefe beim zweiten Mal etwas anderes.
$pdo2 = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo2->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT, is_active INTEGER DEFAULT 1, stack_order INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0)');
$pdo2->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER, geometry_geojson TEXT, is_active INTEGER DEFAULT 1)');
$region($pdo2, 1, 'gleich-a', 'vegetation');
$region($pdo2, 2, 'gleich-b', 'vegetation');
$flaeche($pdo2, 'g1', 1, $quadrat(7.0));
$flaeche($pdo2, 'g2', 2, $quadrat(7.0));
avesmapsEcosystemSeedStackOrder($pdo2);
$gleich = $pdo2->query('SELECT public_id FROM ecosystem_region ORDER BY stack_order ASC')->fetchAll(PDO::FETCH_COLUMN);
assert($gleich === ['gleich-a', 'gleich-b'], 'Gleichstand behaelt die id-Reihenfolge');

// --- Eine stillgelegte Flaeche zaehlt nicht mit ---------------------------------------------------
// Sie ist auf der Karte nicht da; sie darf die Reihenfolge nicht mitbestimmen.
$pdo3 = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo3->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT, is_active INTEGER DEFAULT 1, stack_order INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0)');
$pdo3->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER, geometry_geojson TEXT, is_active INTEGER DEFAULT 1)');
$region($pdo3, 1, 'aktiv-klein', 'vegetation');
$region($pdo3, 2, 'nur-tot-gross', 'vegetation');
$flaeche($pdo3, 'k1', 1, $quadrat(3.0));
$pdo3->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson, is_active) VALUES (?, ?, ?, 0)')
    ->execute(['k2', 2, $quadrat(500.0)]);
avesmapsEcosystemSeedStackOrder($pdo3);
$tot = $pdo3->query('SELECT public_id FROM ecosystem_region ORDER BY stack_order ASC')->fetchAll(PDO::FETCH_COLUMN);
assert($tot === ['aktiv-klein', 'nur-tot-gross'], 'stillgelegte Flaeche zaehlt nicht: ' . implode(', ', $tot));

echo "ok - ecosystem-startaufstellung\n";
