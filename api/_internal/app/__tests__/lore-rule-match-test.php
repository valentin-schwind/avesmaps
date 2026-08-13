<?php

declare(strict_types=1);

// Die UMGEKEHRTE Frage: nicht "welche Objekte trifft diese Regel", sondern "welche Regeln
// treffen dieses eine Objekt". Der Lesepfad stellt nur diese; sie ist ein Join, keine Geometrie.

require_once __DIR__ . '/../lore-rule.php';
require_once __DIR__ . '/../lore-rule-match.php';

$zones = ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];
$term = static fn (array $o = []): array => array_merge(
    ['area_public_id' => null, 'types' => [], 'climate_from' => null, 'climate_to' => null, 'join_op' => 'und'],
    $o
);

// --- Eine FLAECHE ist ihr eigenes Subjekt -------------------------------------------------
$farindel = ['public_id' => 'a1', 'kind' => 'vegetation', 'region_type' => 'wald', 'zones' => ['gemaessigt']];
$subjectArea = avesmapsLoreRuleSubjectFromArea($farindel);
assert($subjectArea['public_id'] === 'a1');
assert($subjectArea['types'] === [['kind' => 'vegetation', 'region_type' => 'wald']]);
assert($subjectArea['zones'] === ['gemaessigt']);

$wald = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']]]);
assert(avesmapsLoreRuleTermMatchesSubject($wald, $subjectArea, $zones) === true);
$gebirge = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']]]);
assert(avesmapsLoreRuleTermMatchesSubject($gebirge, $subjectArea, $zones) === false);

// --- Eine SIEDLUNG erbt die Arten ihrer Flaechen, behaelt aber ihre eigene Zone -----------
// 💣 Genau hier liegt der Unterschied, der die ganze Regel traegt: der Finsterkamm BERUEHRT
// boreal und gemaessigt, aber ein Ort darin liegt in genau EINEM Band. Wer der Siedlung die
// Zonen ihrer Flaeche vererbt, macht aus 4 Treffern 44.
$finsterkamm = ['public_id' => 'a2', 'kind' => 'topographie', 'region_type' => 'gebirge',
    'zones' => ['boreal', 'gemaessigt']];
$areasById = ['a1' => $farindel, 'a2' => $finsterkamm];

$imSueden = ['public_id' => 'p1', 'zone' => 'gemaessigt', 'area_public_ids' => ['a2']];
$imNorden = ['public_id' => 'p2', 'zone' => 'boreal', 'area_public_ids' => ['a2']];
$subjectSued = avesmapsLoreRuleSubjectFromPlace($imSueden, $areasById);
$subjectNord = avesmapsLoreRuleSubjectFromPlace($imNorden, $areasById);

assert($subjectSued['zones'] === ['gemaessigt'], 'die EIGENE Zone, nicht die der Flaeche');
assert($subjectNord['zones'] === ['boreal']);
assert($subjectSued['types'] === [['kind' => 'topographie', 'region_type' => 'gebirge']]);

$gebirgeBoreal = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
    'climate_from' => 'boreal', 'climate_to' => 'boreal']);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeBoreal, $subjectNord, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeBoreal, $subjectSued, $zones) === false,
    'der Ort im Sueden faellt heraus, obwohl seine Flaeche boreal beruehrt');

// --- Identitaet UND Art zusammen in EINER Bedingung -- beide muessen gelten --------------
// Ohne diesen Fall kommt eine Mutation durch, die die Identitaets-Pruefung zum
// Kurzschluss-ODER macht (fruehes `return` statt Glied der UND-Kette) und damit Art- und
// Zonenpruefung ueberspringt: $subjectNord liegt in a2 (Identitaet trifft), ist aber
// gebirge, nicht wald -- die Bedingung muss trotzdem false liefern.
$a2NurWald = $term(['area_public_id' => 'a2', 'types' => [['kind' => 'vegetation', 'region_type' => 'wald']]]);
assert(avesmapsLoreRuleTermMatchesSubject($a2NurWald, $subjectNord, $zones) === false,
    'liegt in a2, ist aber gebirge -- Identitaet allein darf nicht reichen');

// --- Mehrere Arten AN EINER Bedingung sind ODER-verknuepft -- nicht nur die erste zaehlt --
// (Schritt 5: die urspruengliche Fassung dieser Datei hatte keinen Fall mit zwei Typen an
// EINER Bedingung -- eine Implementierung, die nur types[0] prueft, kam ungestraft durch.)
$waldOderGebirge = $term(['types' => [
    ['kind' => 'vegetation', 'region_type' => 'wald'],
    ['kind' => 'topographie', 'region_type' => 'gebirge'],
]]);
assert(avesmapsLoreRuleTermMatchesSubject($waldOderGebirge, $subjectArea, $zones) === true,
    'wald steht an ERSTER Stelle der Bedingung');
assert(avesmapsLoreRuleTermMatchesSubject($waldOderGebirge, $subjectSued, $zones) === true,
    'gebirge steht an ZWEITER Stelle -- wer nur die erste Art prueft, faellt hier durch');

// --- Ein Ort in ZWEI Flaechen erbt beide Arten (der "Bergwald") ---------------------------
$bergwald = ['public_id' => 'p3', 'zone' => 'gemaessigt', 'area_public_ids' => ['a1', 'a2']];
$subjectBeide = avesmapsLoreRuleSubjectFromPlace($bergwald, $areasById);
assert(count($subjectBeide['types']) === 2);
assert(avesmapsLoreRuleTermMatchesSubject($wald, $subjectBeide, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($gebirge, $subjectBeide, $zones) === true);

// --- Die Reihenfolge der geerbten Arten folgt der FLAECHENLISTE, nicht der Flaechentabelle -
// area_public_ids traegt hier absichtlich die UMGEKEHRTE Reihenfolge von $areasById (a1, a2),
// damit eine Implementierung, die ueber $areasById statt ueber area_public_ids iteriert,
// auffliegt -- ein Zaehl-Assert (count() === 2) sieht diesen Unterschied nicht, nur ein
// Assert auf die Liste selbst.
$umgekehrterBergwald = ['public_id' => 'p4', 'zone' => 'gemaessigt', 'area_public_ids' => ['a2', 'a1']];
$subjectUmgekehrt = avesmapsLoreRuleSubjectFromPlace($umgekehrterBergwald, $areasById);
assert($subjectUmgekehrt['types'] === [
    ['kind' => 'topographie', 'region_type' => 'gebirge'],
    ['kind' => 'vegetation', 'region_type' => 'wald'],
], 'Reihenfolge folgt area_public_ids (a2 vor a1), nicht der Schluesselreihenfolge von $areasById');

// --- Die Identitaets-Bedingung trifft nur die genannte FLAECHE -----------------------------
// 💣 Eine Regel "Flaechenname = Farindelwald" trifft die Flaeche selbst. Ob sie auch die Orte
// DARIN treffen soll, ist eine Entscheidung -- hier: ja, ueber die geerbten Flaechen.
$nurFarindel = $term(['area_public_id' => 'a1']);
assert(avesmapsLoreRuleTermMatchesSubject($nurFarindel, $subjectArea, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($nurFarindel, $subjectSued, $zones) === false);
assert(avesmapsLoreRuleTermMatchesSubject($nurFarindel, $subjectBeide, $zones) === true,
    'der Bergwald-Ort liegt im Farindel, also trifft ihn die Flaechenbedingung');

// --- Leere Bedingung trifft alles, aber der Schreibriegel laesst sie gar nicht erst zu -----
assert(avesmapsLoreRuleTermMatchesSubject($term(), $subjectArea, $zones) === true);

echo "lore-rule-match: OK\n";
