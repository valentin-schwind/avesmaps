<?php

declare(strict_types=1);

// Der Schreibweg fuer Reihenfolge und Sperre (19.08.2026).
//
// 🔴 DIE SPERRE GEHT UEBER `update_region`, DIE REIHENFOLGE NICHT.
// `update_region` schreibt seit jeher NUR die Felder, die im Rumpf stehen -- `is_locked` reiht sich
// dort ein. Ein Sammel-Schreibvorgang, der alle Felder setzt, machte jede gewollte Ausnahme platt;
// genau daran ist avesmapsUpsertGameLiterature am 17.08.2026 gescheitert.
//
// `stack_order` bleibt draussen: „ganz nach vorn"/„ganz nach hinten" braucht den hoechsten bzw.
// niedrigsten Rang der EBENE, und den kennt nur der Server. Dafuer gibt es `set_region_stack`.

require_once __DIR__ . '/../ecosystem.php';

// ---- Partialitaet: geschrieben wird nur, was mitgeschickt wurde ---------------------------------

$nurSperre = avesmapsEcosystemReadRegionFields(['is_locked' => true], 'vegetation');
assert($nurSperre === ['is_locked' => 1], 'nur is_locked: ' . json_encode($nurSperre));

$nichts = avesmapsEcosystemReadRegionFields(['name' => 'Farindel'], 'vegetation');
assert(!array_key_exists('is_locked', $nichts), 'ohne is_locked im Rumpf bleibt die Spalte unangetastet');

// 🔴 `stack_order` ist hier ABSICHTLICH KEIN Feld. Die Reihenfolge kennt zwei Bewegungen, und beide
// brauchen den hoechsten bzw. niedrigsten Rang der Ebene -- den kennt nur der Server. Sie laufen
// deshalb ueber `set_region_stack`. Eine freie Zahl hier daneben waere ein zweiter Weg zur selben
// Spalte, und der erste, der ihn benutzt, rechnet den Rang aus seinem Bildausschnitt.
$rangVersuch = avesmapsEcosystemReadRegionFields(['stack_order' => 40], 'vegetation');
assert(!array_key_exists('stack_order', $rangVersuch), 'update_region schreibt stack_order NICHT');

// 💣 `array_key_exists`, nicht `isset`: ein Rumpf, der ausdruecklich ENTsperrt oder auf 0 setzt, ist
// ein gueltiger Schreibvorgang. Mit `isset` waere das Entsperren wirkungslos gewesen -- und zwar
// lautlos, weil nichts fehlschlaegt.
$entsperren = avesmapsEcosystemReadRegionFields(['is_locked' => false], 'vegetation');
assert($entsperren === ['is_locked' => 0], 'is_locked=false schreibt 0: ' . json_encode($entsperren));

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
