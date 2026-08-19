<?php

declare(strict_types=1);

/**
 * „Regeln ableiten" — der GANZE Ablauf: rechnen, anhäkeln, übernehmen. Gegen sqlite, weil es lokal
 * kein MySQL gibt (AGENTS.md §9).
 *
 * 💣 Diese Datei existiert wegen des Befundes vom 19.08.2026 früh: ein Endpunkt ging live, dessen
 * LESEweg nie ausgeführt worden war, und stürzte beim ersten Klick ab. Ein Test, der nur die reinen
 * Funktionen ruft, hätte das nicht gefunden.
 *
 * ⚠️ ZWEI ZEILEN AUF STDERR SIND ERWARTET: „avesmaps collection deletion audit failed … no such table:
 * map_audit_log". Die Protokolltabelle steht bewusst NICHT in der Fixture — die Meldung ist der Beleg,
 * dass der Protokollschreiber seinen eigenen Fehler verschluckt, statt eine gelungene Übernahme
 * nachträglich umzuwerfen. Der Rückgabewert des Laufs ist 0.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/lore-rule-plan-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../lore-rule-plan.php';
require_once __DIR__ . '/../lore-rule-plan-apply.php';
require_once __DIR__ . '/../dump-reader.php'; // AVESMAPS_WIKI_DUMP_STEP_SECONDS

// =================================================================================================
// Teil 1: die reinen Bauer
// =================================================================================================

// Der Vergleichskern trennt zwei Regeln, die denselben SATZ ergäben -- „Nebelmoor" gibt es zweimal.
$a = avesmapsLoreRulePlanKern(['verbreitung' => [
    ['join_op' => 'und', 'area_public_id' => 'id-1', 'types' => [['kind' => 'vegetation', 'region_type' => 'wald']]],
]]);
$b = avesmapsLoreRulePlanKern(['verbreitung' => [
    ['join_op' => 'und', 'area_public_id' => 'id-2', 'types' => [['kind' => 'vegetation', 'region_type' => 'wald']]],
]]);
assert($a !== $b, 'zwei gleichnamige Flächen sind zwei verschiedene Regeln');
// Die Reihenfolge der TYPEN innerhalb einer Bedingung ist keine Aussage -- sonst gälte ein Plan als
// überholt, weil die Datenbank anders sortiert zurückliest als der Ableiter geschrieben hat.
$c = avesmapsLoreRulePlanKern(['verbreitung' => [
    ['join_op' => 'und', 'area_public_id' => 'id-1', 'types' => [
        ['kind' => 'topographie', 'region_type' => 'kueste'], ['kind' => 'vegetation', 'region_type' => 'wald']]],
]]);
$d = avesmapsLoreRulePlanKern(['verbreitung' => [
    ['join_op' => 'und', 'area_public_id' => 'id-1', 'types' => [
        ['kind' => 'vegetation', 'region_type' => 'wald'], ['kind' => 'topographie', 'region_type' => 'kueste']]],
]]);
assert($c === $d, 'die Typreihenfolge innerhalb einer Bedingung ist keine Änderung');

// Der Satz nennt die Relation nur, wenn es mehr als eine gibt.
assert(avesmapsLoreRulePlanSatz(['verbreitung' => 'Wald innerhalb von X']) === 'Wald innerhalb von X');
assert(str_contains(avesmapsLoreRulePlanSatz(['herkunft' => 'A', 'verbreitung' => 'B']), 'herkunft: A'));

// Der Hinweis nennt Zahl UND Grund UND Namen -- „3 Angaben nicht übernommen" allein ist nichts,
// was man mit gutem Gewissen anhäkelt.
$hinweis = avesmapsLoreRulePlanHinweis([
    ['text' => 'Myranor', 'grund' => 'fremde_welt'],
    ['text' => 'Tobrien', 'grund' => 'herrschaftsgebiet'],
    ['text' => 'Albernia', 'grund' => 'herrschaftsgebiet'],
]);
assert(str_starts_with($hinweis, '3 Angaben nicht übernommen'), $hinweis);
assert(str_contains($hinweis, 'andere Welt: 1 (Myranor)'), $hinweis);
assert(str_contains($hinweis, 'Tobrien, Albernia'), $hinweis);
assert(avesmapsLoreRulePlanHinweis([]) === '');

// =================================================================================================
// Teil 2: der Ablauf gegen eine Datenbank
// =================================================================================================

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
// ⚠️ `UTC_TIMESTAMP()` ist MySQL. Sie wird hier NACHGEBILDET, statt sie in der Produktion durch etwas
// zu ersetzen, das sqlite versteht: wer die Produktionsform verbiegt, damit ein Test läuft, hat den
// Test gegen die Produktion gedreht (AGENTS.md §9, der 1093-Fall).
$pdo->sqliteCreateFunction('UTC_TIMESTAMP', static fn (): string => gmdate('Y-m-d H:i:s'), -1);

$pdo->exec('CREATE TABLE lore_entry (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, kind TEXT,
    name TEXT, lebensraum TEXT, merkmale_json TEXT, origin TEXT, status TEXT)');
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT,
    name TEXT, kind TEXT, region_type TEXT, wiki_region_key TEXT, is_active INT)');
$pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, is_active INT)');
$pdo->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_active INT)');
avesmapsLoreRuleEnsureTables($pdo);
// 💣 DAS ECHTE DDL, nicht ein nachgebautes: avesmapsEnsureSyncPlanTables kennt seit 19.08.2026 beide
// Dialekte. Eine abgeschriebene Fixture wäre ein Test gegen ein anderes Schema als das der Produktion.
avesmapsEnsureSyncPlanTables($pdo);

$pdo->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, wiki_region_key, is_active)
    VALUES ('id-orkland', 'Orkland', 'derographisch', 'region', 'orkland', 1)");
$pdo->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, wiki_region_key, is_active)
    VALUES ('id-nordav', 'Nordaventurien', 'derographisch', 'region', NULL, 1)");
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, is_active) VALUES ('vegetation', 'steppe', 'Steppe', 1)");
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, is_active) VALUES ('vegetation', 'wald', 'Wald', 1)");
$pdo->exec("INSERT INTO political_territory (name, is_active) VALUES ('Herzogtum Tobrien', 1)");

$eintrag = static function (PDO $pdo, string $key, string $name, string $verbreitung, string $lebensraum): void {
    $pdo->prepare("INSERT INTO lore_entry (wiki_key, kind, name, lebensraum, merkmale_json, origin, status)
        VALUES (?, 'fauna', ?, ?, ?, 'wiki', 'active')")
        ->execute([$key, $name, $lebensraum, json_encode(['Verbreitung' => $verbreitung], JSON_UNESCAPED_UNICODE)]);
};
// (1) Art + Fläche -> eine neue Aussage.
$eintrag($pdo, 'steppenrind', 'Steppenrind', '[[Nordaventurien]], [[Orkland]]', '[[Steppe]]');
// (2) Fläche MIT wiki_region_key und ohne Art -> wiederholt nur die Ortszeile, wird NICHT vorgeschlagen.
$eintrag($pdo, 'ratte', 'Ratte', 'ganz [[Orkland]]', '');
// (3) Fläche OHNE wiki_region_key -> neue Aussage, aber mit einer verworfenen Angabe.
$eintrag($pdo, 'karen', 'Karen', '[[Nordaventurien]], [[Tobrien]]', '');
// (4) Verneinung -> nichts, nie.
$eintrag($pdo, 'wirselkraut', 'Wirselkraut', 'ganz [[Orkland]] außer im Norden', '[[Steppe]]');
// (5) Ein Eintrag, dem jemand von Hand eine Regel gebaut hat.
$eintrag($pdo, 'alprute', 'Alprute', '[[Orkland]]', '[[Wald]]');
$handRegel = avesmapsLoreRuleSave($pdo, 'alprute', [
    ['join_op' => 'und', 'area_public_id' => 'id-nordav', 'types' => [['kind' => 'vegetation', 'region_type' => 'wald']]],
], 'verbreitung', 1);
assert((string) $pdo->query('SELECT origin FROM lore_rule WHERE id = ' . $handRegel)->fetchColumn() === 'manual');

// --- RECHNEN ------------------------------------------------------------------------------------
$schritt = avesmapsLoreRuleDerivePlanStep($pdo, '', 1);
assert($schritt['done'] === true, 'ein Schritt reicht für fünf Einträge');
assert($schritt['run_id'] > 0);
$runId = (int) $schritt['run_id'];

$zeilen = [];
foreach ($pdo->query('SELECT * FROM sync_plan_item WHERE run_id = ' . $runId)->fetchAll(PDO::FETCH_ASSOC) as $z) {
    $zeilen[(string) $z['entity_key']] = $z;
}
assert(isset($zeilen['steppenrind']), 'Art + Fläche wird vorgeschlagen');
assert(isset($zeilen['karen']), 'eine Fläche ohne wiki_region_key ist eine neue Aussage');
assert(isset($zeilen['alprute']), 'und der Eintrag mit Handarbeit bekommt trotzdem seinen Vorschlag');
assert(!isset($zeilen['ratte']), '🔴 eine reine Wiederholung der Ortszeile wird NICHT vorgeschlagen');
assert(!isset($zeilen['wirselkraut']), '🔴 eine Verneinung wird nie vorgeschlagen');
assert(count($zeilen) === 3, 'genau drei Zeilen, nicht mehr');

$after = json_decode((string) $zeilen['steppenrind']['after_json'], true);
assert($after['regel'] === 'Steppe innerhalb von Nordaventurien oder Steppe innerhalb von Orkland', $after['regel']);
assert($after['bedingungen'] === '2');
assert((int) $zeilen['steppenrind']['selected'] === 1, 'vollständig abgeleitet -> vorangehäkelt');
assert((string) $zeilen['steppenrind']['change_type'] === 'new');

// 🔴 Wo etwas weggelassen wurde, kommt die Zeile UNGEHÄKELT -- und sagt, was fehlt.
$afterKaren = json_decode((string) $zeilen['karen']['after_json'], true);
assert((int) $zeilen['karen']['selected'] === 0, 'unvollständige Ableitung startet ungehäkelt');
assert(str_contains((string) $afterKaren['regel_hinweis'], 'Herrschaftsgebiet'), $afterKaren['regel_hinweis'] ?? '');

// 💣 Die Regel des Alprute-Eintrags ist die von HAND gebaute -- der Lauf hat sie nicht gelesen und
// schlägt seine eigene als NEU vor, nicht als Änderung.
assert((string) $zeilen['alprute']['change_type'] === 'new', 'die Handarbeit ist für diesen Lauf unsichtbar');

// --- ÜBERNEHMEN ---------------------------------------------------------------------------------
$vorher = (int) $pdo->query('SELECT COUNT(*) FROM lore_rule')->fetchColumn();
assert($vorher === 1, 'vor der Übernahme gibt es genau die eine Handarbeit');

$schritt = avesmapsLoreRuleApplyStep($pdo, $runId, 1, null);
assert($schritt['done'] === true, $schritt['remaining'] . ' Zeilen offen');
assert($schritt['applied'] === 2, 'zwei angehäkelte Zeilen -- „karen" war ungehäkelt (' . $schritt['applied'] . ')');
assert($schritt['stale'] === 0);

$regeln = $pdo->query('SELECT entry_wiki_key, origin FROM lore_rule ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regeln) === 3, 'die Handarbeit plus zwei neue (' . count($regeln) . ')');
assert($regeln[0]['entry_wiki_key'] === 'alprute' && $regeln[0]['origin'] === 'manual',
    '🔴 die von Hand gebaute Regel steht unangetastet da');
$abgeleitet = array_values(array_filter($regeln, static fn (array $r): bool => $r['origin'] === 'wiki_verbreitung'));
assert(count($abgeleitet) === 2);
$keys = array_map(static fn (array $r): string => (string) $r['entry_wiki_key'], $abgeleitet);
sort($keys);
assert($keys === ['alprute', 'steppenrind'], implode(',', $keys));
assert(!in_array('karen', $keys, true), 'was nicht angehäkelt war, wurde nicht geschrieben');

// Die Bedingungen des Steppenrinds stehen wirklich da -- zwei, mit ihrer Art, ohne Klimaspanne.
$ruleId = (int) $pdo->query("SELECT id FROM lore_rule WHERE entry_wiki_key='steppenrind'")->fetchColumn();
$terms = $pdo->query('SELECT * FROM lore_rule_term WHERE rule_id = ' . $ruleId . ' ORDER BY seq')->fetchAll(PDO::FETCH_ASSOC);
assert(count($terms) === 2);
assert($terms[0]['join_op'] === 'und' && $terms[1]['join_op'] === 'oder');
assert($terms[0]['climate_from'] === null && $terms[0]['climate_to'] === null, '🔴 nie eine geratene Klimazone');
$typen = $pdo->query('SELECT region_type FROM lore_rule_term_type WHERE term_id = ' . (int) $terms[0]['id'])->fetchAll(PDO::FETCH_COLUMN);
assert($typen === ['steppe'], implode(',', $typen));

// --- EIN ZWEITER LAUF IST EIN NO-OP -------------------------------------------------------------
$schritt = avesmapsLoreRuleDerivePlanStep($pdo, '', 1);
$runId2 = (int) $schritt['run_id'];
$zeilen2 = $pdo->query('SELECT entity_key, change_type FROM sync_plan_item WHERE run_id = ' . $runId2)
    ->fetchAll(PDO::FETCH_KEY_PAIR);
assert(!isset($zeilen2['steppenrind']), 'was übernommen wurde, kommt nicht wieder');
assert(!isset($zeilen2['alprute']), 'und die zweite auch nicht');
assert(isset($zeilen2['karen']) && $zeilen2['karen'] === 'new', 'die ungehäkelte steht weiter offen');

// --- DIE DRITTE KATEGORIE: die Wiki-Aussage verschwindet -----------------------------------------
$pdo->exec("UPDATE lore_entry SET merkmale_json = '{}' WHERE wiki_key = 'steppenrind'");
$schritt = avesmapsLoreRuleDerivePlanStep($pdo, '', 1);
$runId3 = (int) $schritt['run_id'];
$zeile = $pdo->query("SELECT * FROM sync_plan_item WHERE run_id = {$runId3} AND entity_key = 'steppenrind'")
    ->fetch(PDO::FETCH_ASSOC);
assert($zeile !== false && (string) $zeile['change_type'] === 'deleted');
assert((int) $zeile['selected'] === 0, '🔴 eine Löschung ist NIE vorangehäkelt');
$vor = json_decode((string) $zeile['before_json'], true);
assert((int) $vor['bedingungen'] === 2, 'die Zeile nennt, was verschwindet');

// Angehäkelt entfernt sie die abgeleitete Regel -- und nur die.
$pdo->exec('UPDATE sync_plan_item SET selected = 1 WHERE run_id = ' . $runId3);
$schritt = avesmapsLoreRuleApplyStep($pdo, $runId3, 1, null);
assert($schritt['done'] === true);
assert((int) $pdo->query("SELECT COUNT(*) FROM lore_rule WHERE entry_wiki_key='steppenrind'")->fetchColumn() === 0);
assert((int) $pdo->query("SELECT COUNT(*) FROM lore_rule WHERE origin='manual'")->fetchColumn() === 1,
    '🔴 und die Handarbeit steht noch immer');
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term WHERE rule_id = ' . $ruleId)->fetchColumn() === 0,
    'die Bedingungen sind mitgegangen, keine Waisen');

// --- 🔴 Der Riegel des Löschers -----------------------------------------------------------------
$geworfen = false;
try {
    avesmapsLoreRuleDeleteByOrigin($pdo, 'alprute', 'manual');
} catch (InvalidArgumentException) {
    $geworfen = true;
}
assert($geworfen, 'der Löscher lehnt „manual" ab, statt Handarbeit wegzuräumen');
assert((int) $pdo->query("SELECT COUNT(*) FROM lore_rule WHERE origin='manual'")->fetchColumn() === 1);

// --- 💣 Ein leerer Bestand eröffnet KEINEN Lauf --------------------------------------------------
// Sonst setzte ein Klick, der nichts finden kann, den offenen Plan eines anderen Editors auf
// „superseded" -- dieselbe Reihenfolgenfalle wie in avesmapsLorePlanStep.
$leer = new PDO('sqlite::memory:');
$leer->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$leer->exec('CREATE TABLE lore_entry (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, kind TEXT,
    name TEXT, lebensraum TEXT, merkmale_json TEXT, origin TEXT, status TEXT)');
$leer->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT,
    kind TEXT, region_type TEXT, wiki_region_key TEXT, is_active INT)');
$leer->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, is_active INT)');
$leer->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_active INT)');
avesmapsLoreRuleEnsureTables($leer);
avesmapsEnsureSyncPlanTables($leer);
$leer->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('lore_rule', 'open')");
$schritt = avesmapsLoreRuleDerivePlanStep($leer, '', 1);
assert($schritt['entries_empty'] === true && $schritt['done'] === true);
assert($schritt['run_id'] === 0, 'kein Lauf eröffnet');
assert((string) $leer->query("SELECT state FROM sync_plan_run WHERE kind='lore_rule'")->fetchColumn() === 'open',
    '🔴 der offene Plan eines anderen Editors bleibt offen');

echo "lore-rule-plan ok\n";
