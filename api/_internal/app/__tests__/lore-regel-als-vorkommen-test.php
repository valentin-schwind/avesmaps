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
require_once __DIR__ . '/../lore-edit.php';

// Der Detailleser (Abschnitt 9) fragt auch die Kartentabellen ab, die es in dieser Fixture nicht
// gibt -- er protokolliert das und macht weiter. Die Meldung ist DORT eine Zusicherung
// (lore-orte-auf-der-karte-test.php); hier waere sie nur Laerm im Testlauf.
ini_set('log_errors', '1');
ini_set('error_log', tempnam(sys_get_temp_dir(), 'lore-regel-log'));

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
    $pdo->exec("CREATE TABLE lore_entry (wiki_key TEXT PRIMARY KEY, kind TEXT, name TEXT, wiki_url TEXT,
        gruppe TEXT, typ TEXT, lebensraum TEXT, synonyme TEXT, origin TEXT, status TEXT,
        field_origins_json TEXT, merkmale_json TEXT)");
    $pdo->exec("CREATE TABLE lore_place (entry_wiki_key TEXT, place_wiki_key TEXT, place_title TEXT,
        relation TEXT, origin TEXT, status TEXT, sort_order INT)");
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

// ── (9) DER DETAILLESER LIEFERT DIESELBEN VIER ZAHLEN ──────────────────────────────
// 🔴 Daran haengt, dass der Kreis einer Zeile nach „+ Ort" / „+ Regel" mitgeht, OHNE dass die
// ganze Liste neu geholt wird: jede Schreibaktion des Editors antwortet ohnehin mit diesem
// Eintrag. Fehlt eine der vier Zahlen, liest der Browser `undefined` -- und faerbt die Zeile
// still anders als beim Laden.
// ⚠️ Gezaehlt werden nur AKTIVE Ortszeilen: ein Grabstein steht im Editor weiter in der Liste,
// ist aber kein Vorkommen mehr.
$pdo = avesmapsRegelTestPdo();
$pdo->exec("INSERT INTO lore_entry (wiki_key, kind, name, status, origin) VALUES ('alprute','flora','Alprute','active','wiki')");
$pdo->exec("INSERT INTO lore_place (entry_wiki_key, place_wiki_key, place_title, relation, origin, status, sort_order)
            VALUES ('alprute','alkrawald','Alkrawald','verbreitung','wiki','active',0),
                   ('alprute','schiff','Schiff','verbreitung','wiki','suppressed',1)");
avesmapsRegelTestAnlegen($pdo, 'alprute', 'vegetation', 'wald');
$detail = avesmapsLoreReadEntryDetail($pdo, 'alprute');
assert(is_array($detail), 'Der Detailleser liefert den Eintrag.');
$pruefungen++;
foreach (['place_count', 'place_mapped_count', 'rule_count', 'rule_mapped_count'] as $feld) {
    assert(array_key_exists($feld, $detail),
        "Der Detailleser liefert `{$feld}` nicht -- der Statuskreis der Zeile bliebe nach dem "
        . 'Schreiben auf dem Stand des letzten Ladens.');
    $pruefungen++;
}
assert($detail['place_count'] === 1,
    'Nur die AKTIVE Ortszeile zaehlt; der Grabstein ist kein Vorkommen mehr.');
assert($detail['rule_count'] === 1 && $detail['rule_mapped_count'] === 1,
    'Die Regel des Eintrags zaehlt hier genauso wie in der Katalogliste.');
assert(count($detail['places']) === 2,
    'Die Ortsliste selbst enthaelt weiter BEIDE Zeilen -- der Editor muss seine eigenen '
    . 'Grabsteine sehen koennen. Nur die ZAHL laesst sie aus.');
$pruefungen += 3;

// -- (9) DER ABNAHMEFALL DER REGELSPRACHE "innerhalb" (19.08.2026) -----------------------------
// "Gebirge innerhalb von Mittelaventurien" -- die Regel, die der Owner gebaut hat. Vor der
// Umstellung traf sie 0 Flaechen (keine Flaeche heisst Mittelaventurien UND ist ein Gebirge), der
// Eintrag stand damit auf HALB: Regel vorhanden, aber nirgends verortet. Jetzt trifft sie, und
// `rule_mapped_count` geht von 0 auf 1 -- der Kreis springt von halb auf voll.
// Am Livebestand sind es 17 von 62 Gebirgen (gemessen 19.08.2026 mit derselben Funktion,
// avesmapsLoreRuleEvaluate, gegen /api/app/ecosystem-areas.php); gezaehlt wird hier wie dort die
// REGEL, nicht die Zahl der Flaechen.
$pdo = avesmapsRegelTestPdo();
$pdo->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, wiki_region_key, is_active)
            VALUES ('area-mav', 'Mittelaventurien', 'derographisch', 'region', NULL, 1),
                   ('area-berg-2', 'Khoramgebirge', 'topographie', 'gebirge', NULL, 1)");
$idVon = static function (PDO $pdo, string $publicId): int {
    $s = $pdo->prepare('SELECT id FROM ecosystem_region WHERE public_id = ?');
    $s->execute([$publicId]);

    return (int) $s->fetchColumn();
};
// Altimont (area-berg-1, aus der Fixture) liegt in Mittelaventurien, das Khoramgebirge nicht.
$pdo->prepare('INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (?,?,?)')
    ->execute([$idVon($pdo, 'area-berg-1'), $idVon($pdo, 'area-mav'), 0.99]);

// Die Regel des Owners: Art UND Flaeche in EINER Bedingung.
$pdo->prepare('INSERT INTO lore_rule (entry_wiki_key, relation, origin, status) VALUES (?,?,?,?)')
    ->execute(['bergwolf', 'verbreitung', 'manual', 'active']);
$regelId = (int) $pdo->lastInsertId();
$pdo->prepare('INSERT INTO lore_rule_term (rule_id, seq, join_op, area_public_id) VALUES (?,?,?,?)')
    ->execute([$regelId, 0, 'und', 'area-mav']);
$bedingungId = (int) $pdo->lastInsertId();
$pdo->prepare('INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (?,?,?)')
    ->execute([$bedingungId, 'topographie', 'gebirge']);

$zahlen = avesmapsLoreReadRuleCountsByEntry($pdo, ['bergwolf']);
assert(($zahlen['bergwolf']['rules'] ?? 0) === 1, 'Die Regel ist vorhanden.');
assert(($zahlen['bergwolf']['matched'] ?? 0) === 1,
    'rule_mapped_count geht von 0 auf 1 -- der Statuskreis springt von halb auf voll.');
$pruefungen += 2;

// GEGENPROBE, die nicht null ist: ohne die Ueberlappungszeile trifft dieselbe Regel nichts mehr,
// obwohl beide Gebirge unveraendert dastehen. Ohne sie waere die 1 auch dann richtig, wenn die
// Behaelter gar nicht gelesen wuerden.
$pdo->exec('DELETE FROM ecosystem_region_overlap');
$ohne = avesmapsLoreReadRuleCountsByEntry($pdo, ['bergwolf']);
assert(($ohne['bergwolf']['rules'] ?? 0) === 1, 'Die Regel bleibt vorhanden -- halb, nicht leer.');
assert(($ohne['bergwolf']['matched'] ?? -1) === 0,
    'GEGENPROBE: ohne Behaelter liegt kein Gebirge mehr in Mittelaventurien');
$pruefungen += 2;

echo "lore-regel-als-vorkommen: {$pruefungen} Zusicherungen bestanden.\n";
