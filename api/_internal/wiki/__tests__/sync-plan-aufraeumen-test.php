<?php

declare(strict_types=1);

// Die offenen Vorschauzeilen ueberholter Laeufe werden abgeraeumt -- `sync_plan_item` hatte bis
// zum 05.09.2026 im ganzen Code keinen einzigen Loeschweg.
//
// Gemessen am Dump vom 04.09.2026: 92,5 MB / 61.613 Zeilen in 55 Laeufen, davon 17 `done`,
// 359 stale/skipped/failed und 61.237 OFFEN (apply_state NULL) -- Zeilen ueberholter Laeufe, die
// niemand mehr uebernehmen kann, weil nur der offene Lauf gelesen wird. Jedes „Holen & Rechnen"
// des Garetien-Importers legte 7-10 MB nach.
//
// 🔴 DIE REGEL: beim Start eines neuen Laufs einer Art fallen die Zeilen ihrer UEBERHOLTEN Laeufe
// mit `apply_state IS NULL`. Alles andere bleibt: `done` (die laufuebergreifende Ruecknahme und der
// Nachzug lesen ihre apply_note), stale/skipped/failed (Protokoll), die Zeilen des offenen Laufs,
// und die Laeufe anderer Arten. Gedeckelt je Aufruf, wie die Staging-Aufraeumung des Importers.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/wiki/__tests__/sync-plan-aufraeumen-test.php

require_once __DIR__ . '/../sync-plan.php';

$pruefungen = 0;

function aufraeumTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

/** Einen Lauf mit Zeilen anlegen und in einen Zustand setzen. */
function aufraeumLauf(PDO $pdo, string $kind, string $state, array $zeilen): int
{
    $pdo->prepare("INSERT INTO sync_plan_run (kind, state, source_stamp, created_by) VALUES (:k, 'building', NULL, NULL)")
        ->execute(['k' => $kind]);
    $lauf = (int) $pdo->lastInsertId();
    foreach ($zeilen as $i => $applyState) {
        avesmapsSyncPlanAddItem($pdo, $lauf, [
            'entity_key' => $kind . ':objekt-' . $i,
            'entity_public_id' => null,
            'change_type' => 'new',
            'label' => $kind . ' Objekt ' . $i,
            'before' => [],
            'after' => ['name' => 'Objekt ' . $i, 'geometry' => ['type' => 'Point', 'coordinates' => [1.0, 2.0]]],
            'override' => [],
            'selected' => 1,
        ]);
        if ($applyState !== null) {
            $pdo->prepare("UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE run_id = :r AND entity_key = :e")
                ->execute(['s' => $applyState, 'n' => 'public-' . $i, 'r' => $lauf, 'e' => $kind . ':objekt-' . $i]);
        }
    }
    $pdo->prepare('UPDATE sync_plan_run SET state = :s WHERE id = :r')->execute(['s' => $state, 'r' => $lauf]);

    return $lauf;
}

function zaehle(PDO $pdo, int $lauf, ?string $applyState = null, bool $alle = false): int
{
    if ($alle) {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r');
        $stmt->execute(['r' => $lauf]);
    } elseif ($applyState === null) {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state IS NULL');
        $stmt->execute(['r' => $lauf]);
    } else {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $lauf, 's' => $applyState]);
    }

    return (int) $stmt->fetchColumn();
}

// =================================================================================================
// A. Die reine Regel, gedeckelt
// =================================================================================================
$pdo = aufraeumTestPdo();
// Drei ueberholte Garetien-Laeufe: der aelteste traegt auch done/stale, der juengste nur offene.
$alt1 = aufraeumLauf($pdo, 'garetien', 'superseded', [null, null, 'done', 'stale', null]);
$alt2 = aufraeumLauf($pdo, 'garetien', 'superseded', [null, null, null, 'failed']);
$alt3 = aufraeumLauf($pdo, 'garetien', 'superseded', [null, null]);
// Der offene Garetien-Lauf: unantastbar.
$offen = aufraeumLauf($pdo, 'garetien', 'open', [null, null, null]);
// Ein ueberholter Lauf einer ANDEREN Art: unantastbar bei einem Garetien-Aufruf.
$fremd = aufraeumLauf($pdo, 'citymap', 'superseded', [null, null]);
// Ein angewandter Lauf einer anderen Art (Ende der Uebernahme-Vorschau): unantastbar.
$angewandt = aufraeumLauf($pdo, 'lore', 'applied', [null, 'done']);

$vorher = (int) $pdo->query('SELECT COUNT(*) FROM sync_plan_item')->fetchColumn();
assert($vorher === 18, 'die Fixture steht: ' . $vorher);

$erste = avesmapsSyncPlanAufraeumen($pdo, 'garetien', 1);
assert($erste === ['laeufe' => 1, 'zeilen' => 3, 'offen' => 2],
    'Deckel 1: genau der AELTESTE ueberholte Lauf, seine 3 offenen Zeilen, 2 Laeufe warten noch: ' . json_encode($erste));
assert(zaehle($pdo, $alt1) === 0 && zaehle($pdo, $alt1, 'done') === 1 && zaehle($pdo, $alt1, 'stale') === 1,
    '🔴 offene Zeilen weg, done und stale BLEIBEN -- die laufuebergreifende Ruecknahme liest die apply_note der done-Zeile');
assert(zaehle($pdo, $alt2) === 3 && zaehle($pdo, $alt3) === 2, 'die zwei juengeren ueberholten Laeufe sind noch unberuehrt (Deckel)');
assert(zaehle($pdo, $offen) === 3, '🔴 der OFFENE Lauf bleibt ganz -- er ist die Arbeitsliste');
assert(zaehle($pdo, $fremd) === 2, '🔴 eine andere Art bleibt ganz -- die Tabelle gehoert acht Arten');
assert(zaehle($pdo, $angewandt, null, true) === 2, 'ein angewandter Lauf bleibt ganz -- nur „superseded" ist ueberholt');
$pruefungen += 6;

$zweite = avesmapsSyncPlanAufraeumen($pdo, 'garetien', 5);
assert($zweite === ['laeufe' => 2, 'zeilen' => 5, 'offen' => 0],
    'ein grosser Deckel nimmt den Rest in einem Zug: ' . json_encode($zweite));
assert(zaehle($pdo, $alt2) === 0 && zaehle($pdo, $alt2, 'failed') === 1 && zaehle($pdo, $alt3) === 0, 'beide abgeraeumt, failed bleibt');
$dritte = avesmapsSyncPlanAufraeumen($pdo, 'garetien', 5);
assert($dritte === ['laeufe' => 0, 'zeilen' => 0, 'offen' => 0], 'nichts mehr zu tun -- und das ist kein Fehler: ' . json_encode($dritte));
assert((int) $pdo->query('SELECT COUNT(*) FROM sync_plan_run')->fetchColumn() === 6,
    '⚠️ die Lauf-Zeilen bleiben stehen: die Ruecknahme JOINt sync_plan_run fuer die Art, und done-Zeilen haengen an ihrem Lauf');
assert(avesmapsSyncPlanAufraeumen($pdo, 'citymap', 0) === ['laeufe' => 1, 'zeilen' => 2, 'offen' => 0],
    '💣 die Klemme steht IM Rumpf: ein Deckel 0 heisst mindestens 1, nicht „nichts tun"');
// Das Ergebnis wird je Art gemerkt -- der Garetien-Importer nennt es in seiner Kachel, weil eine
// stille Loeschung von „nichts passiert" nicht zu unterscheiden ist.
assert(avesmapsSyncPlanLetzteAufraeumung('citymap') === ['laeufe' => 1, 'zeilen' => 2, 'offen' => 0], 'die letzte Aufraeumung je Art ist abrufbar');
assert(avesmapsSyncPlanLetzteAufraeumung('garetien') === $dritte, 'je Art getrennt');
assert(avesmapsSyncPlanLetzteAufraeumung('lore') === false, 'eine Art, fuer die nichts lief: false -- keine Aussage, kein Fehlschlag');
$pruefungen += 8;

// =================================================================================================
// B. Der Start eines neuen Laufs raeumt -- ohne dass ein Aufrufer daran denken muss
// =================================================================================================
$pdo2 = aufraeumTestPdo();
$vorgaenger = aufraeumLauf($pdo2, 'garetien', 'open', [null, null, 'done', null]);
$fremd2 = aufraeumLauf($pdo2, 'territory', 'open', [null, null]);
$neu = avesmapsSyncPlanStartRun($pdo2, 'garetien', 7, null);
assert($neu > $vorgaenger, 'ein neuer Lauf entsteht');
assert($pdo2->query('SELECT state FROM sync_plan_run WHERE id = ' . $vorgaenger)->fetchColumn() === 'superseded', 'der Vorgaenger ist ueberholt');
assert(zaehle($pdo2, $vorgaenger) === 0 && zaehle($pdo2, $vorgaenger, 'done') === 1,
    '🔴 DER KERN: der Start eines Laufs raeumt die offenen Zeilen des gerade ueberholten Vorgaengers ab -- und laesst done stehen');
assert(zaehle($pdo2, $fremd2) === 2, 'der offene Lauf der anderen Art ist unberuehrt');
$pruefungen += 4;

// 💣 Und der Deckel gilt auch dort: bei vielen ueberholten Laeufen bleibt ein Rest fuer den naechsten Start.
$pdo3 = aufraeumTestPdo();
$viele = [];
for ($i = 0; $i < AVESMAPS_SYNC_PLAN_AUFRAEUM_DECKEL + 2; $i++) {
    $viele[] = aufraeumLauf($pdo3, 'garetien', 'superseded', [null, null]);
}
avesmapsSyncPlanStartRun($pdo3, 'garetien', 7, null);
$rest = (int) $pdo3->query('SELECT COUNT(*) FROM sync_plan_item WHERE apply_state IS NULL')->fetchColumn();
assert($rest === 4, 'Deckel ' . AVESMAPS_SYNC_PLAN_AUFRAEUM_DECKEL . ' Laeufe je Start: zwei Laeufe (4 Zeilen) warten auf den naechsten: ' . $rest);
avesmapsSyncPlanStartRun($pdo3, 'garetien', 7, null);
assert((int) $pdo3->query('SELECT COUNT(*) FROM sync_plan_item WHERE apply_state IS NULL')->fetchColumn() === 0,
    'der naechste Start nimmt den Rest');
$pruefungen += 2;

// =================================================================================================
// C. Die NAHT zum Importer: der Endpunkt nennt das Feld, das die Kachel liest
// =================================================================================================
// 💣 „Beide Haelften gruen, die Naht ungeprueft": ein Endpunkt mit ausdruecklicher Feldliste hat
// schon einmal ein Feld verworfen, das der Browser las (`anzahl`, 31.08.2026). Hier geht nur der
// Quelltext -- Kommentare vorher weg, sonst schlaegt die Zusicherung an dem Satz an, der sie beschreibt.
$ohneKommentare = static fn(string $quelle): string => (string) preg_replace('~^\s*(//|\*|/\*).*$~m', '', $quelle);
$endpunkt = $ohneKommentare((string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php'));
$kachel = $ohneKommentare((string) file_get_contents(__DIR__ . '/../../../../js/review/review-garetien-importer.js'));
assert(str_contains($endpunkt, "'vorschau_aufgeraeumt'") && str_contains($endpunkt, 'avesmapsSyncPlanLetzteAufraeumung(AVESMAPS_GARETIEN_PLAN_KIND)'),
    'der plan-Zweig des Importer-Endpunkts meldet die letzte Aufraeumung unter vorschau_aufgeraeumt');
assert(str_contains($kachel, 'plan.vorschau_aufgeraeumt'), 'und die Kachel liest genau diesen Schluessel');
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
