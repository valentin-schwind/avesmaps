<?php

declare(strict_types=1);

// Der Schreibweg fuer Reihenfolge und Sperre (19.08.2026).
//
// 🔴 ES GIBT KEINEN NEUEN ENDPUNKT. `update_region` schreibt seit jeher NUR die Felder, die im Rumpf
// stehen -- die zwei neuen reihen sich dort ein. Ein Sammel-Schreibvorgang, der alle Felder setzt,
// machte jede gewollte Ausnahme platt; genau daran ist avesmapsUpsertGameLiterature am 17.08.2026
// gescheitert.

require_once __DIR__ . '/../ecosystem.php';

// ---- Partialitaet: geschrieben wird nur, was mitgeschickt wurde ---------------------------------

$nurSperre = avesmapsEcosystemReadRegionFields(['is_locked' => true], 'vegetation');
assert($nurSperre === ['is_locked' => 1], 'nur is_locked: ' . json_encode($nurSperre));

$nurRang = avesmapsEcosystemReadRegionFields(['stack_order' => 40], 'vegetation');
assert($nurRang === ['stack_order' => 40], 'nur stack_order: ' . json_encode($nurRang));

$nichts = avesmapsEcosystemReadRegionFields(['name' => 'Farindel'], 'vegetation');
assert(!array_key_exists('stack_order', $nichts), 'ohne stack_order im Rumpf bleibt die Spalte unangetastet');
assert(!array_key_exists('is_locked', $nichts), 'ohne is_locked im Rumpf bleibt die Spalte unangetastet');

// 💣 `array_key_exists`, nicht `isset`: ein Rumpf, der ausdruecklich ENTsperrt oder auf 0 setzt, ist
// ein gueltiger Schreibvorgang. Mit `isset` waere das Entsperren wirkungslos gewesen -- und zwar
// lautlos, weil nichts fehlschlaegt.
$entsperren = avesmapsEcosystemReadRegionFields(['is_locked' => false], 'vegetation');
assert($entsperren === ['is_locked' => 0], 'is_locked=false schreibt 0: ' . json_encode($entsperren));

$aufNull = avesmapsEcosystemReadRegionFields(['stack_order' => 0], 'vegetation');
assert($aufNull === ['stack_order' => 0], 'stack_order=0 wird geschrieben: ' . json_encode($aufNull));

// Die Sperre reist neben anderen Feldern mit, ohne sie zu stoeren -- der Eigenschaften-Dialog
// speichert Name, Anzeige, Art und Sperre in EINEM Zug.
$zusammen = avesmapsEcosystemReadRegionFields(['name' => 'Bornwald', 'is_locked' => true], 'vegetation');
assert($zusammen === ['name' => 'Bornwald', 'is_locked' => 1], 'Name und Sperre zusammen: ' . json_encode($zusammen));

// ---- Der Platz einer neuen Region: ganz vorn, je Ebene ------------------------------------------

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT,
        is_active INTEGER DEFAULT 1, stack_order INTEGER DEFAULT 0)'
);

// Leere Ebene: der erste Rang ist die Schrittweite selbst, nicht 0.
assert(avesmapsEcosystemNextStackOrder($pdo, 'vegetation') === AVESMAPS_ECOSYSTEM_STACK_STEP, 'leere Ebene faengt bei der Schrittweite an');

$pdo->exec("INSERT INTO ecosystem_region (public_id, kind, stack_order) VALUES
    ('v1','vegetation',10), ('v2','vegetation',20), ('t1','topographie',500)");

$naechster = avesmapsEcosystemNextStackOrder($pdo, 'vegetation');
assert($naechster === 30, "vorn heisst 30, bekommen: $naechster");

// 🔴 Jede Ebene hat ihren EIGENEN Zahlenraum -- die 500 der Topographie darf die Vegetation nicht
// nach oben ziehen. Die vier Ebenen liegen in eigenen Leaflet-Panes mit festem z-index.
$topo = avesmapsEcosystemNextStackOrder($pdo, 'topographie');
assert($topo === 510, "Topographie rechnet fuer sich, bekommen: $topo");

// Eine stillgelegte Region zaehlt nicht mit -- sonst hinterliesse jede geloeschte Region eine Luecke,
// die den Stapel unbegrenzt nach oben schiebt.
$pdo->exec("INSERT INTO ecosystem_region (public_id, kind, stack_order, is_active) VALUES ('v-tot','vegetation',9999,0)");
$nachTot = avesmapsEcosystemNextStackOrder($pdo, 'vegetation');
assert($nachTot === 30, "stillgelegte Region zaehlt nicht, bekommen: $nachTot");

echo "ok - ecosystem-stapel-schreiben\n";
