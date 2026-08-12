<?php

declare(strict_types=1);

// Schema und Rundlauf der Regeltabellen -- gegen sqlite, wie die uebrigen Store-Tests.
// Die REINE Auswertung steht in lore-rule-test.php und braucht keine Datenbank.

require_once __DIR__ . '/../lore-rule-store.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this test would silently pass\n");
    exit(1);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

avesmapsLoreRuleEnsureTables($pdo);
avesmapsLoreRuleEnsureTables($pdo); // idempotent, wie jedes self-healing DDL im Haus

$terms = [
    ['area_public_id' => null, 'join_op' => 'und',
     'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
     'climate_from' => 'boreal', 'climate_to' => 'gemaessigt'],
    ['area_public_id' => null, 'join_op' => 'und',
     'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
     'climate_from' => null, 'climate_to' => null],
];

$ruleId = avesmapsLoreRuleSave($pdo, 'vierblattrige-einbeere', $terms, 'verbreitung', 7);
assert($ruleId > 0);

$read = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($read) === 1);
assert($read[0]['relation'] === 'verbreitung');
assert(count($read[0]['terms']) === 2);
// Die Reihenfolge der Bedingungen IST die Auswertungsreihenfolge -- sie muss die
// Datenbank ueberleben, sonst rechnet die Infobox anders als die Vorschau.
assert($read[0]['terms'][0]['climate_from'] === 'boreal');
assert($read[0]['terms'][1]['types'][0]['region_type'] === 'gebirge');
assert($read[0]['terms'][1]['climate_from'] === null);

// Speichern auf dieselbe id ERSETZT die Bedingungen, es haengt keine an.
avesmapsLoreRuleSave($pdo, 'vierblattrige-einbeere', [$terms[0]], 'verbreitung', 7, $ruleId);
$read = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($read) === 1 && count($read[0]['terms']) === 1);

// Ein anderer Eintrag sieht die Regel nicht.
assert(avesmapsLoreRuleReadForEntry($pdo, 'wirselkraut') === []);

assert(avesmapsLoreRuleDelete($pdo, $ruleId) === true);
assert(avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere') === []);
assert(avesmapsLoreRuleDelete($pdo, $ruleId) === false);

echo "lore-rule-store: OK\n";
