<?php

declare(strict_types=1);

// avesmapsLoreReadRuleCountsByEntry -- „eine Regel mit Verbreitung ist ein gueltiges Vorkommen"
// (Owner 18.08.2026).
//
// 🔴 DIESER TEST LAEUFT WIRKLICH, anders als der JSON-Zweig nebenan: alle beteiligten Abfragen
// sind gewoehnliches SQL (lore_rule, ecosystem_assignment_stamp, ecosystem_region samt
// Ueberlappung), und die Kettenauswertung ist rein. Gebaut ist die Fixture nach dem Livefall vom
// 18.08.2026: „Alprute" hat KEINE Ortszeile und eine Regel ueber alle Waelder (119 Flaechen).
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-regel-als-vorkommen-test.php

require_once __DIR__ . '/../lore.php';
require_once __DIR__ . '/../lore-rule-match.php';

$pruefungen = 0;

/**
 * Die Tabellen, die der Regelzweig anfasst -- mehr nicht. Die Spalten sind die aus dem
 * Produktionsschema (avesmapsLoreRuleEnsureTables, avesmapsEcosystemEnsureTables).
 */
function avesmapsRegelTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec("CREATE TABLE lore_rule (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_wiki_key TEXT,
        relation TEXT DEFAULT 'verbreitung', origin TEXT, status TEXT, sort_order INT DEFAULT 0)");
    $pdo->exec("CREATE TABLE lore_rule_term (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INT, seq INT,
        join_op TEXT DEFAULT 'und', area_public_id TEXT NULL, climate_from TEXT NULL, climate_to TEXT NULL)");
    $pdo->exec('CREATE TABLE lore_rule_term_type (term_id INT, kind TEXT, region_type TEXT)');
    $pdo->exec('CREATE TABLE ecosystem_assignment_stamp (id INT PRIMARY KEY, completed INT)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT,
        name TEXT, kind TEXT, region_type TEXT NULL, wiki_region_key TEXT NULL, is_active INT)');
    $pdo->exec('CREATE TABLE ecosystem_region_overlap (region_id INT, other_region_id INT, share REAL)');
    $pdo->exec('INSERT INTO ecosystem_assignment_stamp (id, completed) VALUES (1, 1)');
    // Zwei Waelder und ein Gebirge. 💣 Der ZWEITE Wald traegt KEINEN wiki_region_key -- live sind
    // 561 der 929 Flaechen so, und sie liegen trotzdem auf der Karte. Ein Regeltreffer wird
    // deshalb nie ueber einen Schluessel nachgeschlagen, er IST die Flaeche.
    $pdo->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, wiki_region_key, is_active) VALUES
        ('area-wald-1', 'Alkrawald', 'vegetation', 'wald', 'alkrawald', 1),
        ('area-wald-2', 'Wald-041',  'vegetation', 'wald', NULL,        1),
        ('area-berg-1', 'Altimont',  'topographie','gebirge','altimont', 1)");

    return $pdo;
}

/** Eine Regel „alle Flaechen der Art <kind>/<type>" fuer einen Eintrag. */
function avesmapsRegelTestAnlegen(
    PDO $pdo,
    string $entryKey,
    string $kind,
    string $type,
    string $relation = 'verbreitung',
    string $status = 'active'
): void {
    $pdo->prepare('INSERT INTO lore_rule (entry_wiki_key, relation, origin, status) VALUES (?,?,?,?)')
        ->execute([$entryKey, $relation, 'manual', $status]);
    $ruleId = (int) $pdo->lastInsertId();
    $pdo->prepare('INSERT INTO lore_rule_term (rule_id, seq, join_op) VALUES (?,?,?)')->execute([$ruleId, 0, 'und']);
    $termId = (int) $pdo->lastInsertId();
    $pdo->prepare('INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (?,?,?)')
        ->execute([$termId, $kind, $type]);
}

// ── (0) Kein Eintrag, keine Regel -> keine Abfrage ─────────────────────────────────────────────
$pdo = avesmapsRegelTestPdo();
assert(avesmapsLoreReadRuleCountsByEntry($pdo, []) === [], 'Ohne Eintraege wird nichts gefragt.');
assert(avesmapsLoreReadRuleCountsByEntry($pdo, ['alprute']) === [],
    'Ein Eintrag ohne Regel taucht gar nicht erst im Ergebnis auf -- der Aufrufer liest das als 0.');
$pruefungen += 2;

// ── (1) DER LIVEFALL: Regel ueber alle Waelder, keine Ortszeile ────────────────────────────────
$pdo = avesmapsRegelTestPdo();
avesmapsRegelTestAnlegen($pdo, 'alprute', 'vegetation', 'wald');
$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['alprute', 'eiche']);
assert(($zahlen['alprute']['rules'] ?? 0) === 1, 'Die Regel wird als vorhanden gezaehlt.');
assert(($zahlen['alprute']['matched'] ?? 0) === 1,
    'Sie trifft die zwei Waelder -- gezaehlt wird die REGEL, nicht die Zahl der Flaechen. Sonst '
    . 'stuende in der Antwort eine Zahl (live: 119), die neben der Ortszahl niemand erklaeren kann.');
assert(!isset($zahlen['eiche']), 'Ein Eintrag ohne Regel bleibt draussen.');
$pruefungen += 3;

// ── (2) 💣 Eine Regel, die NICHTS trifft, bleibt VORHANDEN ─────────────────────────────────────
// Genau das ist der Unterschied zwischen halb und leer: das Vorkommen ist da, es liegt nur
// nirgends. Faele sie hier ganz heraus, stuende der Eintrag wieder auf „gar kein Vorkommen".
$pdo = avesmapsRegelTestPdo();
avesmapsRegelTestAnlegen($pdo, 'wuestenblume', 'vegetation', 'wuestenoase');
$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['wuestenblume']);
assert(($zahlen['wuestenblume']['rules'] ?? 0) === 1, 'Vorhanden bleibt vorhanden.');
assert(($zahlen['wuestenblume']['matched'] ?? -1) === 0, 'Getroffen hat sie nichts.');
$pruefungen += 2;

// ── (3) 💣 „mit verbreitung" ist die Bedingung des Owners ──────────────────────────────────────
// Der Regel-Editor kann heute gar nichts anderes schreiben (js/review/review-lore-rule.js kennt
// keinen Waehler), aber die Spalte kennt vier Werte (avesmapsLoreNormalizeRelation) -- die
// Bedingung steht, damit sie beim ersten Waehler von selbst gilt.
$pdo = avesmapsRegelTestPdo();
avesmapsRegelTestAnlegen($pdo, 'herkunftsware', 'vegetation', 'wald', 'herkunft');
assert(avesmapsLoreReadRuleCountsByEntry($pdo, ['herkunftsware']) === [],
    'Eine Regel mit relation <> verbreitung zaehlt nicht -- Owner: „sofern vorhanden UND mit verbreitung".');
$pruefungen++;

// ── (4) Eine stillgelegte Regel zaehlt nicht ───────────────────────────────────────────────────
$pdo = avesmapsRegelTestPdo();
avesmapsRegelTestAnlegen($pdo, 'altlast', 'vegetation', 'wald', 'verbreitung', 'suppressed');
assert(avesmapsLoreReadRuleCountsByEntry($pdo, ['altlast']) === [],
    'status <> active heisst: die Regel gibt es nicht mehr.');
$pruefungen++;

// ── (5) 🔴 DER RECHENSTAND GILT NUR FUER DIE ZWEITE ZAHL ───────────────────────────────────────
// Waehrend „Zugehoerigkeit rechnen" laeuft, ist `completed` 0 und die Flaechenzuordnung leer. Der
// Eintrag faellt dann von voll auf HALB -- nie auf leer, denn seine Regel ist unveraendert da.
// Dieselbe Trennung wie in avesmapsFetchLoreRulePlacesByEntry (lore-search.php).
$pdo = avesmapsRegelTestPdo();
avesmapsRegelTestAnlegen($pdo, 'alprute', 'vegetation', 'wald');
$pdo->exec('UPDATE ecosystem_assignment_stamp SET completed = 0');
$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['alprute']);
assert(($zahlen['alprute']['rules'] ?? 0) === 1, 'Die Regel ist da, egal was gerade gerechnet wird.');
assert(($zahlen['alprute']['matched'] ?? -1) === 0, 'Getroffen hat sie waehrend des Laufs nichts.');
$pruefungen += 2;

// ── (6) Eine Flaeche im Papierkorb ist kein Treffer ────────────────────────────────────────────
$pdo = avesmapsRegelTestPdo();
$pdo->exec("UPDATE ecosystem_region SET is_active = 0 WHERE region_type = 'wald'");
avesmapsRegelTestAnlegen($pdo, 'alprute', 'vegetation', 'wald');
$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['alprute']);
assert(($zahlen['alprute']['matched'] ?? -1) === 0,
    'Eine geloeschte Flaeche liegt nicht auf der Karte -- dieselbe Regel wie bei einer Ortszeile.');
$pruefungen++;

// ── (7) Zwei Regeln, eine trifft ───────────────────────────────────────────────────────────────
$pdo = avesmapsRegelTestPdo();
avesmapsRegelTestAnlegen($pdo, 'doppel', 'vegetation', 'wald');
avesmapsRegelTestAnlegen($pdo, 'doppel', 'vegetation', 'wuestenoase');
$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['doppel']);
assert(($zahlen['doppel']['rules'] ?? 0) === 2, 'Beide Regeln sind vorhanden.');
assert(($zahlen['doppel']['matched'] ?? -1) === 1,
    'Nur eine von beiden trifft etwas -- und eine Regel wird auch bei zwei getroffenen Waeldern '
    . 'nur EINMAL gezaehlt.');
$pruefungen += 2;

// ── (8) Ein Klimaband ist keine Flaeche im Sinne einer Regel ───────────────────────────────────
// ⚠️ „alle Flaechen der Borealen Zone" darf nicht das Band selbst treffen -- avesmapsLoreRuleReadAreas
// schliesst kind='klima' aus. Ohne diesen Ausschluss zaehlte jede Zonenregel sich selbst.
$pdo = avesmapsRegelTestPdo();
$pdo->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, is_active)
            VALUES ('zone-boreal', 'Boreale Zone', 'klima', 'boreal', 1)");
avesmapsRegelTestAnlegen($pdo, 'zonenkraut', 'klima', 'boreal');
$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['zonenkraut']);
assert(($zahlen['zonenkraut']['matched'] ?? -1) === 0, 'Ein Klimaband ist selbst kein Regeltreffer.');
$pruefungen++;

echo "lore-regel-als-vorkommen: {$pruefungen} Zusicherungen bestanden.\n";
