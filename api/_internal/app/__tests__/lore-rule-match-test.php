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

// --- Der oeffentliche Lesepfad: aller Regelbestand + Treffer je Subjekt (PDO, sqlite) ---------
require_once __DIR__ . '/../lore-rule-store.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this half would silently pass\n");
    exit(1);
}
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsLoreRuleEnsureTables($pdo);

// Zwei Eintraege, zwei Regeln: die Einbeere will Wald im Norden, das Bergkraut will Gebirge.
avesmapsLoreRuleSave($pdo, 'einbeere', [[
    'join_op' => 'und', 'area_public_id' => null,
    'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt',
]], 'verbreitung', 7);
avesmapsLoreRuleSave($pdo, 'bergkraut', [[
    'join_op' => 'und', 'area_public_id' => null,
    'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
    'climate_from' => null, 'climate_to' => null,
]], 'verbreitung', 7);

$all = avesmapsLoreRuleReadAllActive($pdo);
assert(count($all) === 2, 'beide Eintraege, in DREI Abfragen fuer den ganzen Bestand');

// Der Farindelwald trifft die Einbeere, nicht das Bergkraut.
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($farindel));
assert(array_keys($hits) === ['einbeere']);
assert($hits['einbeere'] === 'verbreitung');

// Der Finsterkamm trifft das Bergkraut.
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($finsterkamm));
assert(array_keys($hits) === ['bergkraut']);

// 💣 Der Bergwald-ORT trifft BEIDE -- er erbt die Arten beider Flaechen. Genau das ist die
// Aussage des Modells, und genau sie faellt weg, wenn jemand die Vererbung wegoptimiert.
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromPlace($bergwald, $areasById));
// ⚠️ Nicht sort($keys = array_keys($hits)) -- PHP 8.5 lehnt eine Zuweisung als Referenz-Argument
// ab ("could not be passed by reference"), zwei Anweisungen statt einer.
$keys = array_keys($hits);
sort($keys);
assert($keys === ['bergkraut', 'einbeere']);

// Eine stillgelegte Regel trifft nichts mehr.
$pdo->exec("UPDATE lore_rule SET status = 'suppressed' WHERE entry_wiki_key = 'bergkraut'");
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($finsterkamm));
assert($hits === []);

// --- Erweiterung (Schritt 5): 'oder' muss wirklich ODER sein, nicht heimlich 'und' -----------
// Keine der beiden Regeln oben hat mehr als EINE Bedingung -- eine Mutation, die join_op
// ignoriert und immer 'und' nimmt, kommt an ihnen ungestraft vorbei (die erste Bedingung einer
// Kette setzt das Ergebnis immer direkt, ganz gleich, welcher join_op an ihr steht). Diese Regel
// hat ZWEI Bedingungen: die erste (Gebirge) verfehlt den Farindel (der ist Wald), die zweite
// (Wald), mit 'oder' verknuepft, trifft ihn. "immer und" zwingt das Ergebnis auf false.
avesmapsLoreRuleSave($pdo, 'raffranke', [
    ['join_op' => 'und', 'area_public_id' => null,
        'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
        'climate_from' => null, 'climate_to' => null],
    ['join_op' => 'oder', 'area_public_id' => null,
        'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
        'climate_from' => null, 'climate_to' => null],
], 'verbreitung', 7);

$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($farindel));
$keys = array_keys($hits);
sort($keys);
assert($keys === ['einbeere', 'raffranke'], 'oder verknuepft, nicht heimlich und -- Gebirge verfehlt, Wald trifft');

// --- Fix-Runde 1, Befund 1: die Kette rechnet LINKS NACH RECHTS, nicht mit Praezedenz --------
// 'raffranke' hat nur EINEN Verknuepfer -- bei einem einzigen Operator liefern links-nach-rechts
// und "und bindet staerker als oder" (Praezedenz, die Lesart aus Python/C/SQL) dasselbe Ergebnis,
// die Reihenfolge ist an ihr also gar nicht pruefbar. Erst DREI Bedingungen trennen die beiden
// Lesarten: T1 trifft, T2 (davor 'oder') trifft nicht, T3 (davor 'und') trifft nicht.
//   links-nach-rechts: (T1 oder T2) und T3 = (wahr oder falsch) und falsch = FALSCH
//   Praezedenz:        T1 oder (T2 und T3) = wahr oder (falsch und falsch) = WAHR
// Waere der Lesepfad Praezedenz und der Editor (avesmapsLoreRuleEvaluate) links-nach-rechts,
// zeigte die Vorschau bei denselben Daten etwas anderes als die Infobox -- ohne Fehlermeldung.
// T3 ist eine IDENTITAET (nicht Klima): avesmapsLoreRuleOrderedZoneKeys fragt
// ecosystem_region_type ab, eine Tabelle, die dieses sqlite-Fixture nie anlegt -- die Abfrage
// wirft, der Fang liefert [], und eine leere Zonenliste macht jede Klimaspanne zu "keine
// Einschraenkung" (avesmapsLoreRuleZoneKeys) statt zu "trifft nicht". Eine Identitaetsbedingung
// braucht das nicht und ist hier deshalb das robustere Gegenbeispiel.
avesmapsLoreRuleSave($pdo, 'wurzelkraut', [
    // T1: Gebirge -- trifft den Finsterkamm (kind=topographie, region_type=gebirge).
    ['join_op' => 'und', 'area_public_id' => null,
        'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
        'climate_from' => null, 'climate_to' => null],
    // T2, davor 'oder': Wald -- verfehlt den Finsterkamm (der ist Gebirge, nicht Wald).
    ['join_op' => 'oder', 'area_public_id' => null,
        'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
        'climate_from' => null, 'climate_to' => null],
    // T3, davor 'und': "ist der Farindel" (a1) -- verfehlt den Finsterkamm (a2).
    ['join_op' => 'und', 'area_public_id' => 'a1',
        'types' => [],
        'climate_from' => null, 'climate_to' => null],
], 'verbreitung', 7);

$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($finsterkamm));
assert(!array_key_exists('wurzelkraut', $hits),
    'links-nach-rechts liefert FALSCH -- eine Praezedenz-Auswertung liefert hier WAHR und faellt durch');

echo "lore-rule-match: OK\n";
