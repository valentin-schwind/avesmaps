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
    // Zwei Typen an EINER Bedingung -- "mehrere Typen je Bedingung" (innerhalb der
    // Bedingung ODER-verknuepft) ist sonst unbewiesen. Die Reihenfolge beim Lesen kommt
    // aus der Abfrage (ORDER BY kind, region_type), nicht aus der Einfuegereihenfolge --
    // hier faellt beides zusammen, damit der Test nicht zufaellig durch Gluck besteht.
    ['area_public_id' => null, 'join_op' => 'und',
     'types' => [
         ['kind' => 'topographie', 'region_type' => 'gebirge'],
         ['kind' => 'topographie', 'region_type' => 'huegelland'],
     ],
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
assert($read[0]['terms'][1]['climate_from'] === null);

// Die Typen VOLLSTAENDIG pruefen -- Anzahl, kind UND region_type, fuer BEIDE Bedingungen.
// Ein Test, der nur region_type der zweiten Bedingung ansieht, merkt weder, wenn kind()
// nie verglichen wird, noch wenn die ERSTE Bedingung (seq === 0, ein Sonderfall, der
// leicht vergessen wird) ihre Typen beim Schreiben verliert.
assert(count($read[0]['terms'][0]['types']) === 1);
assert($read[0]['terms'][0]['types'][0]['kind'] === 'vegetation');
assert($read[0]['terms'][0]['types'][0]['region_type'] === 'wald');

assert(count($read[0]['terms'][1]['types']) === 2);
assert($read[0]['terms'][1]['types'][0]['kind'] === 'topographie');
assert($read[0]['terms'][1]['types'][0]['region_type'] === 'gebirge');
assert($read[0]['terms'][1]['types'][1]['kind'] === 'topographie');
assert($read[0]['terms'][1]['types'][1]['region_type'] === 'huegelland');

// Speichern auf dieselbe id ERSETZT die Bedingungen, es haengt keine an.
avesmapsLoreRuleSave($pdo, 'vierblattrige-einbeere', [$terms[0]], 'verbreitung', 7, $ruleId);
$read = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($read) === 1 && count($read[0]['terms']) === 1);
// Zaehlt die Kindtabellen DIREKT -- ueber ReadForEntry sieht man Waisen nicht: eine nur
// halb geloeschte alte Bedingung (oder ihr Typ) haengt an einer rule_id/term_id, die
// keine aktive Regel mehr referenziert, und liefert trotzdem still nur die neue zurueck.
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term')->fetchColumn() === 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term_type')->fetchColumn() === 1);

// Ein anderer Eintrag sieht die Regel nicht.
assert(avesmapsLoreRuleReadForEntry($pdo, 'wirselkraut') === []);

assert(avesmapsLoreRuleDelete($pdo, $ruleId) === true);
assert(avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere') === []);
// Zaehlt die Kindtabellen DIREKT -- eine geloeschte Kopfzeile liefert schon [] zurueck,
// ganz gleich ob ihre Kinder noch in lore_rule_term/lore_rule_term_type liegen.
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term')->fetchColumn() === 0);
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term_type')->fetchColumn() === 0);
assert(avesmapsLoreRuleDelete($pdo, $ruleId) === false);

// Die drei Leser antworten auf einer Datenbank OHNE Oekosystem-Tabellen mit leeren Listen
// statt mit einer Ausnahme. 💣 Sie laufen spaeter auf dem oeffentlichen Lesepfad; „nie
// eingerichtet" darf dort kein 500 werden -- dieselbe Zusage wie avesmapsClimateReadBands.
assert(avesmapsLoreRuleReadAreas($pdo) === []);
assert(avesmapsLoreRuleReadPlaces($pdo) === []);
assert(avesmapsLoreRuleOrderedZoneKeys($pdo) === []);

// 🔴 Die REIHENFOLGE ist die Aussage, nicht Kosmetik: absichtlich AUSSER der Reihe (und
// nicht alphabetisch) eingefuegt, damit ein Test, der bloss die Einfuegereihenfolge oder
// das Alphabet spiegelt, nicht zufaellig besteht -- er muss ECHT nach sort_order sortieren.
$pdo->exec(
    'CREATE TABLE ecosystem_region_type (
        kind VARCHAR(16) NOT NULL,
        type_key VARCHAR(40) NOT NULL,
        label VARCHAR(190) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (kind, type_key)
    )'
);
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES ('klima', 'tropisch', 'Tropische Zone', 80)");
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES ('klima', 'polar', 'Polare Zone', 10)");
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES ('klima', 'boreal', 'Boreale Zone', 30)");
// Andere kind -- darf nicht mitkommen.
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES ('vegetation', 'wald', 'Wald', 5)");

assert(avesmapsLoreRuleOrderedZoneKeys($pdo) === ['polar', 'boreal', 'tropisch']);

echo "lore-rule-store: OK\n";
