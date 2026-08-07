<?php

declare(strict_types=1);

/**
 * The rules of the Übernahme foundation (design §2/§5/§8). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/sync-plan-test.php
 * Exit 0 = all asserts passed.
 *
 * Part 1 is the four pure functions -- what arrives pre-checked, what a decision is keyed by, when a
 * stored plan has gone stale, what the tile counts. No DB, no clock.
 *
 * Part 2 adds the two run helpers on sqlite. They are SQL, but not "SQL around the rules": one decides
 * whether a preview left lying about still counts, the other how far a bulk writer may see. Session 4
 * got both answers wrong, in ways only a run against rows shows.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';

// --- Pre-checking (design §2) --------------------------------------------------------------------

assert(avesmapsSyncPlanDefaultSelected('new', 0) === 1, 'Neu ist vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('new', 9) === 1, 'auch nach Ueberspringen -- Neu kennt keinen Zaehler');
assert(avesmapsSyncPlanDefaultSelected('changed', 0) === 1, 'Geaendert ist vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('changed', 1) === 1, 'einmal stehen gelassen: noch vorangehaekelt');
// 💣 From the SECOND skip on it is not: one "not now" is a mood, two is an answer.
assert(avesmapsSyncPlanDefaultSelected('changed', 2) === 0, 'zweimal Nein -> nicht mehr vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('changed', 7) === 0);
// 🔴 A deletion is NEVER pre-checked, whatever happened before. This is the core of the design, not a
// preference: a deletion has to be an act, not the default a tired click confirms.
assert(avesmapsSyncPlanDefaultSelected('deleted', 0) === 0, 'Loeschen ist nie vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('deleted', 5) === 0);

// --- The decision key ----------------------------------------------------------------------------
//
// 💣 TWO MEANINGS IN ONE TABLE (design §5). The same entry can carry a declined deletion AND a
// skipped change. Drop change_type from the key and one silently overwrites the other -- a declined
// deletion would be reset by the next skipped change, and the deletion would be proposed again.
assert(
    avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'deleted')
        !== avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'changed'),
    'Loeschung und Aenderung derselben Zeile sind zwei Entscheidungen'
);
assert(
    avesmapsSyncPlanDecisionKey('a', 'changed') === avesmapsSyncPlanDecisionKey('a', 'changed'),
    'und derselbe Schluessel ist stabil'
);
// ⚠️ The separator must be a character no wiki_key can contain, or two different entities could
// collide into one decision. avesmapsCitymapWikiKey builds single-line keys from page titles.
assert(str_contains(avesmapsSyncPlanDecisionKey('a', 'changed'), "\n"), 'getrennt durch ein Zeichen, das kein wiki_key traegt');

// --- Staleness (design §4a/§8) -------------------------------------------------------------------

$stored = ['title' => 'Havena – Hafenviertel', 'has_scale' => '1'];
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel', 'has_scale' => '1']) === false);
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena, Hafen', 'has_scale' => '1']) === true, 'Wert weicht ab');
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel']) === true, 'Feld fehlt jetzt');
assert(
    avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel', 'has_scale' => '1', 'author' => 'X']) === true,
    'ein Feld ist dazugekommen'
);
assert(avesmapsSyncPlanIsStale($stored, null) === true, 'nichts mehr zu tun -> veraltet, nicht ausfuehren');
// 💣 Compared by KEY, not by the JSON string: json_encode preserves insertion order, so two runs that
// agree on every value but disagree on field order would look stale forever and nothing would apply.
assert(avesmapsSyncPlanIsStale($stored, ['has_scale' => '1', 'title' => 'Havena – Hafenviertel']) === false);
// null and '' both mean "unknown" in this schema (avesmapsCitymapReconcilePlan says so) -- a plan that
// stored null and now reads '' has NOT changed.
assert(avesmapsSyncPlanIsStale(['author' => null], ['author' => '']) === false, 'null und "" sind dasselbe Unbekannt');
assert(avesmapsSyncPlanIsStale(null, null) === false, 'eine Loeschzeile hat kein after_json');
assert(avesmapsSyncPlanIsStale([], []) === false);

// --- Counting -------------------------------------------------------------------------------------

$counts = avesmapsSyncPlanCountsFromItems([
    ['change_type' => 'new'],
    ['change_type' => 'new'],
    ['change_type' => 'changed'],
    ['change_type' => 'deleted'],
]);
assert($counts === ['new' => 2, 'changed' => 1, 'deleted' => 1, 'total' => 4], 'die Kachel-Zahlen');
assert(avesmapsSyncPlanCountsFromItems([]) === ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0]);
// An unknown change_type is counted in the total but invents no category -- the three are the contract.
$odd = avesmapsSyncPlanCountsFromItems([['change_type' => 'renamed']]);
assert($odd === ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 1]);

echo "sync-plan ok\n";

// =====================================================================================================
// TEIL 2 -- die zwei Lauf-Helfer, auf sqlite
// =====================================================================================================
//
// Beide sind SQL, aber keins von beidem ist „nur SQL um die Regeln herum": der eine entscheidet, ob
// eine liegengebliebene Vorschau noch gilt, der andere, wie weit ein Bulk-Schreiber sehen darf. Beide
// Fragen wurden in Sitzung 4 falsch beantwortet.
//
// ⚠️ Die Tabellen werden hier VON HAND angelegt, nicht ueber avesmapsEnsureSyncPlanTables: deren DDL
// ist echtes MySQL (AUTO_INCREMENT, ENGINE=InnoDB, mehrspaltige KEY-Klauseln) und sqlite lehnt es ab.

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- part 2 would silently prove nothing.\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// --- avesmapsSyncPlanSupersedeRuns: eine offene Liste zurueckziehen, OHNE eine neue zu beginnen ------
//
// 💣 Der Grund, warum es diese Funktion gibt: bis 2026-08-07 war avesmapsSyncPlanStartRun der einzige
// Schreiber von state='superseded'. Wer die Fakten aenderte, ohne eine neue Vorschau zu rechnen (die
// Kachel „Hierarchie rechnen" und das Modell-Neurechnen am Ende von „Syncen"), liess die alte Liste
// stehen -- sie zeigte dann einen Eltern-Umzug und schrieb einen anderen, gemeldet als „uebernommen".
$pdo->exec(
    "CREATE TABLE sync_plan_run (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'building',
        source_stamp TEXT, counts_json TEXT, created_at TEXT, created_by INTEGER,
        applied_at TEXT, applied_by INTEGER
    )"
);
$pdo->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('territory', 'open')");
$pdo->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('territory', 'building')");
$pdo->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('territory', 'applied')");
$pdo->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('territory_wiki', 'open')");

assert(avesmapsSyncPlanSupersedeRuns($pdo, 'territory') === 2, 'die offene UND die halbfertige Liste werden zurueckgezogen');
$states = static function (PDO $pdo, string $kind): array {
    $stmt = $pdo->prepare('SELECT state FROM sync_plan_run WHERE kind = :k ORDER BY id ASC');
    $stmt->execute(['k' => $kind]);

    return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN) ?: []);
};
assert($states($pdo, 'territory') === ['superseded', 'superseded', 'applied'],
    '💣 ein bereits uebernommener Lauf ist Geschichte und wird nicht angefasst');
assert($states($pdo, 'territory_wiki') === ['open'],
    '💣 die andere Art bleibt stehen: „Syncen" zieht die Kopie-Vorschau, „Hierarchie" die der Karte (Entwurf §6b)');
assert(avesmapsSyncPlanSupersedeRuns($pdo, 'territory') === 0, 'zweimal gerufen ist kein Fehler, nur wirkungslos');

// ⚠️ Und ohne Tabelle ist es kein Fehler, sondern „es gibt nichts zurueckzuziehen": diese Funktion
// haengt an Schreibwegen, die ihre eigene Arbeit zu Ende bringen muessen. Ein 500 beim Hierarchie-
// Rechnen, weil noch nie eine Vorschau gerechnet wurde, waere der Schwanz, der mit dem Hund wedelt.
$bare = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
assert(avesmapsSyncPlanSupersedeRuns($bare, 'territory') === 0, 'fehlende Tabelle = nichts zu tun');

// --- avesmapsSyncPlanSelectedKeys: der LAUF, nicht die Seite ----------------------------------------
//
// 💣 avesmapsWikiSyncMonitorApplyCustomNodes loest Verweise zwischen seinen EIGENEN Zeilen auf
// (eigener Knoten unter eigenem Knoten). Bekommt er nur die aktuelle Seite, steht ein Kind auf Seite 6
// und sein Elternteil auf Seite 7 -- das Kind wird angelegt, findet keinen Elternteil und bleibt fuer
// immer an der Wurzel, ohne dass ein spaeterer Plan es noch anboete.
$pdo->exec(
    "CREATE TABLE sync_plan_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, entity_key TEXT NOT NULL,
        entity_public_id TEXT, change_type TEXT NOT NULL, label TEXT NOT NULL,
        before_json TEXT, after_json TEXT, override_json TEXT, selected INTEGER NOT NULL DEFAULT 1,
        apply_state TEXT, apply_note TEXT
    )"
);
$addItem = static function (PDO $pdo, int $runId, string $key, string $type, int $selected, ?string $state): void {
    $pdo->prepare(
        'INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, selected, apply_state)
         VALUES (:r, :k, :t, :k, :s, :a)'
    )->execute(['r' => $runId, 'k' => $key, 't' => $type, 's' => $selected, 'a' => $state]);
};
$addItem($pdo, 1, 'eigener-knoten:aaa', 'new', 1, 'applied');   // Seite 1, schon abgearbeitet
$addItem($pdo, 1, 'eigener-knoten:bbb', 'new', 1, null);        // noch offen
$addItem($pdo, 1, 'eigener-knoten:ccc', 'new', 0, null);        // abgehaekelt
$addItem($pdo, 1, 'wiki:irgendwas', 'changed', 1, null);        // andere Kategorie
$addItem($pdo, 2, 'eigener-knoten:zzz', 'new', 1, null);        // anderer Lauf

$newKeys = avesmapsSyncPlanSelectedKeys($pdo, 1, 'new');
assert($newKeys === ['eigener-knoten:aaa', 'eigener-knoten:bbb'],
    '💣 auch die schon abgearbeitete Zeile ist dabei -- sonst fehlt der Elternteil von Seite 6 auf Seite 7');
assert(!in_array('eigener-knoten:ccc', $newKeys, true), 'ein abgehaekelter Knoten wird nicht angelegt');
assert(!in_array('wiki:irgendwas', $newKeys, true), 'und keine fremde Kategorie');
assert(!in_array('eigener-knoten:zzz', $newKeys, true), 'und kein fremder Lauf');
assert(avesmapsSyncPlanSelectedKeys($pdo, 1, 'deleted') === [], 'eine leere Kategorie ist leer, nicht „alles"');

echo "sync-plan (sqlite) ok\n";
