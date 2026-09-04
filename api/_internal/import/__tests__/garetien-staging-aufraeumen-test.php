<?php

declare(strict_types=1);

// Die Aufbewahrungsregel des Import-Stagings.
//
// 🔴 ANLASS (Owner 04.09.2026): `SELECT * FROM garetien_import_row` lieferte 99.280 Zeilen. Ein
// voller Import sind 8.348 -- es lagen also rund ein Dutzend Laeufe vollstaendig da. Die Tabelle
// kannte bis dahin NUR INSERT und UPDATE; einen Loeschweg gab es in der ganzen Codebasis nicht.
//
// ⭐ Warum das gefahrlos wegkann: JEDER Lesezugriff auf `garetien_import_row` filtert auf EINEN
// `run_id` (vier Stellen, alle nachgesehen), und die dauerhaften Entscheidungen haengen nicht an
// den Staging-Zeilen -- `sync_decision` und `sync_plan_item` schluesseln ueber einen aus dem
// INHALT gebauten `entity_key` (avesmapsGaretienObjektSchluesselAusZeile), nicht ueber eine
// Zeilen-ID. Ein alter Lauf ist reiner Ballast.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-staging-aufraeumen-test.php

require_once __DIR__ . '/../garetien-abruf.php';

$pruefungen = 0;
$pdo = null;

/** Eine frische Ablage mit $laeufe Laeufen zu je $jeLauf Zeilen. Gibt die Lauf-IDs zurueck. */
$baueAblage = static function (int $laeufe, int $jeLauf) use (&$pdo): array {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');

    $ids = [];
    $ins = $pdo->prepare('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, geo_art, geo, roh) VALUES (:r, :w, :e, :n, :t, :ga, :g, :ro)');
    for ($i = 0; $i < $laeufe; $i++) {
        $id = avesmapsGaretienStartRun($pdo);
        $ids[] = $id;
        for ($n = 1; $n <= $jeLauf; $n++) {
            $ins->execute([':r' => $id, ':w' => 'ggp', ':e' => 'Gewaesser', ':n' => $n, ':t' => 'See', ':ga' => 'koordinaten', ':g' => '1 2', ':ro' => 'See:X']);
        }
    }

    return $ids;
};

$zeilenVon = static function (int $runId) use (&$pdo): int {
    $s = $pdo->prepare('SELECT COUNT(*) FROM garetien_import_row WHERE run_id = :r');
    $s->execute([':r' => $runId]);

    return (int) $s->fetchColumn();
};

// ---------------------------------------------------------------------------
// 1. WENIGER LAEUFE ALS DIE GRENZE -- es passiert GAR NICHTS.
//
// 💣 Das ist die wichtigste Zusicherung des Tests: `garetien-staging-test.php` haelt seit dem
// 27.08.2026 ausdruecklich fest, dass ein zweiter Lauf den ersten NICHT ueberschreibt. Eine
// Aufraeumung, die schon bei zwei Laeufen zuschlaegt, nimmt dem Fenster die Laufliste weg.
// ---------------------------------------------------------------------------
$ids = $baueAblage(3, 4);
$ergebnis = avesmapsGaretienStagingAufraeumen($pdo, $ids[2], 3);
assert($ergebnis['laeufe'] === 0, 'drei Laeufe bei Grenze drei: nichts faellt weg');
assert($ergebnis['zeilen'] === 0);
assert((int) $pdo->query('SELECT COUNT(*) FROM garetien_import_row')->fetchColumn() === 12);
$pruefungen += 3;

// ---------------------------------------------------------------------------
// 2. DIE AELTESTEN FALLEN, DIE JUENGSTEN BLEIBEN -- Zeilen UND Lauf-Zeile.
//
// ⚠️ Die Lauf-Zeile muss mit: bliebe sie stehen, zeigte `action:'runs'` im Fenster einen Lauf mit
// "0 Zeilen" an, und der laesst sich anklicken -- die Arbeitsliste waere dann leer, ohne dass
// irgendetwas kaputt waere. Ein Lauf ohne Zeilen ist von einem fehlgeschlagenen nicht zu
// unterscheiden.
// ---------------------------------------------------------------------------
$ids = $baueAblage(5, 4);
$ergebnis = avesmapsGaretienStagingAufraeumen($pdo, $ids[4], 2);
assert($ergebnis['laeufe'] === 3, 'fuenf Laeufe, Grenze zwei -> drei fallen; ' . $ergebnis['laeufe'] . ' gemeldet');
assert($ergebnis['zeilen'] === 12, 'drei Laeufe a vier Zeilen; ' . $ergebnis['zeilen'] . ' gemeldet');
assert($zeilenVon($ids[0]) === 0 && $zeilenVon($ids[1]) === 0 && $zeilenVon($ids[2]) === 0);
assert($zeilenVon($ids[3]) === 4 && $zeilenVon($ids[4]) === 4, 'die zwei juengsten bleiben unberuehrt');
assert((int) $pdo->query('SELECT COUNT(*) FROM garetien_import_run')->fetchColumn() === 2, 'die Lauf-Zeilen fallen mit');
$pruefungen += 5;

// ---------------------------------------------------------------------------
// 3. 💣 DER AKTIVE LAUF BLEIBT, AUCH WENN ER ALT IST.
//
// Das Fenster nimmt zwar den juengsten Lauf (`laeufe[0]`), aber ein Admin kann in der Laufliste
// einen aelteren waehlen -- und `action:'plan'` rechnet dann aus DIESEM. Ohne diesen Riegel
// loeschte "Holen & Rechnen" genau die Zeilen weg, aus denen es gerade gerechnet hat, und die
// Arbeitsliste stuende danach leer da.
// ---------------------------------------------------------------------------
$ids = $baueAblage(5, 4);
$ergebnis = avesmapsGaretienStagingAufraeumen($pdo, $ids[0], 2);
assert($zeilenVon($ids[0]) === 4, 'der aktive Lauf ueberlebt seinen Rang');
assert($ergebnis['laeufe'] === 2, 'nur die zwei uebrigen alten fallen; ' . $ergebnis['laeufe'] . ' gemeldet');
assert($zeilenVon($ids[3]) === 4 && $zeilenVon($ids[4]) === 4);
$pruefungen += 3;

// ---------------------------------------------------------------------------
// 4. DER DECKEL: hoechstens so viele Laeufe je Aufruf, der Rest wird GEMELDET.
//
// 🔴 Beim ersten scharfen Lauf muessen rund elf Laeufe weg -- das sind ueber 90.000 Zeilen mit je
// zwei MEDIUMTEXT-Spalten. Ein einziges DELETE darueber laeuft auf STRATO in `max_execution_time`,
// und dessen Fehlerbild ist ein LEERER Rumpf ohne Ausnahme (AGENTS.md §11, SVG-Abzug) -- fuer den
// Aufrufer nicht von "nichts geschickt" zu unterscheiden. Also gestueckelt, wie der Datenbank-Dump.
// ⚠️ `offen` ist die Zahl, die dem Fenster sagt, dass beim naechsten Mal noch etwas kommt.
// ---------------------------------------------------------------------------
$ids = $baueAblage(9, 4);
$ergebnis = avesmapsGaretienStagingAufraeumen($pdo, $ids[8], 2, 3);
assert($ergebnis['laeufe'] === 3, 'der Deckel haelt bei drei; ' . $ergebnis['laeufe'] . ' gemeldet');
assert($ergebnis['offen'] === 4, 'sieben waeren faellig, drei sind weg -> vier offen; ' . $ergebnis['offen'] . ' gemeldet');
assert($zeilenVon($ids[0]) === 0 && $zeilenVon($ids[2]) === 0, 'abgeraeumt wird vom AELTESTEN her');
assert($zeilenVon($ids[3]) === 4, 'der vierte wartet auf den naechsten Aufruf');
$pruefungen += 4;

// --- und die naechsten Aufrufe raeumen den Rest.
avesmapsGaretienStagingAufraeumen($pdo, $ids[8], 2, 3);
$ergebnis = avesmapsGaretienStagingAufraeumen($pdo, $ids[8], 2, 3);
assert($ergebnis['offen'] === 0, 'nach drei Runden ist nichts mehr faellig; ' . $ergebnis['offen'] . ' offen');
assert((int) $pdo->query('SELECT COUNT(*) FROM garetien_import_run')->fetchColumn() === 2);
$pruefungen += 2;

// ---------------------------------------------------------------------------
// 5. VERWAISTE ZEILEN -- ein run_id, zu dem es keine Lauf-Zeile mehr gibt.
//
// ⚠️ Sie kann es heute nur durch Handarbeit in phpMyAdmin geben. Sie faellt trotzdem mit, weil
// eine Zeile ohne Lauf von KEINEM Lesepfad je wieder erreicht wird (alle filtern auf `run_id`,
// und diese id steht in keiner Laufliste) -- sie waere unsichtbarer Ballast fuer immer.
// ---------------------------------------------------------------------------
$ids = $baueAblage(2, 4);
$pdo->exec('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, geo_art, geo, roh)'
    . " VALUES (9999, 'ggp', 'Gewaesser', 1, 'See', 'koordinaten', '1 2', 'See:X')");
$ergebnis = avesmapsGaretienStagingAufraeumen($pdo, $ids[1], 3);
assert($ergebnis['waisen'] === 1, 'die verwaiste Zeile wird gezaehlt; ' . $ergebnis['waisen'] . ' gemeldet');
assert((int) $pdo->query('SELECT COUNT(*) FROM garetien_import_row')->fetchColumn() === 8, 'und sie ist weg');
assert($zeilenVon($ids[0]) === 4, 'die zwei gueltigen Laeufe bleiben unberuehrt');
$pruefungen += 3;

// ---------------------------------------------------------------------------
// 6. 💣 DIE GRENZE LAESST SICH NICHT AUF NULL DREHEN.
//
// Eine Null loeschte alles ausser dem aktiven Lauf -- und damit die Laufliste, aus der ein Admin
// einen aelteren Lauf waehlen koennte. Die Klemme steht IM Rumpf, nicht beim Aufrufer: sonst hat
// sie der naechste Aufrufer wieder nicht (dieselbe Lehre wie bei der Hoeflichkeitspause des
// Abrufers eine Datei weiter).
// ---------------------------------------------------------------------------
$ids = $baueAblage(4, 4);
avesmapsGaretienStagingAufraeumen($pdo, $ids[3], 0);
assert((int) $pdo->query('SELECT COUNT(*) FROM garetien_import_run')->fetchColumn() >= 2, 'die Klemme faengt die Null');
$pruefungen++;

echo "OK -- {$pruefungen} Pruefungen\n";
