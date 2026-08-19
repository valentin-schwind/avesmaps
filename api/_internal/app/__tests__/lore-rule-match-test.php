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
assert($subjectArea['flaechen'] === [['public_id' => 'a1', 'kind' => 'vegetation',
    'region_type' => 'wald', 'container_public_ids' => []]]);
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
assert($subjectSued['flaechen'] === [['public_id' => 'a2', 'kind' => 'topographie',
    'region_type' => 'gebirge', 'container_public_ids' => []]]);

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

// 🔴 19.08.2026: DERSELBE Fall am Ort, der in BEIDEN Flaechen liegt -- und hier antwortete die
// alte Fassung falsch. Sie prueft(e) Identitaet und Art unabhaengig: der Bergwald liegt in a2
// (Identitaet trifft) und ist ueber a1 auch ein Wald (Art trifft), also galt „Wald innerhalb a2"
// als erfuellt -- obwohl der Wald a1 gar nicht in a2 liegt. Jetzt muss EINE Flaeche beides
// erfuellen. Ohne diese Zeile kaeme eine Rueckkehr zur unabhaengigen Pruefung ungestraft durch,
// weil $subjectNord sie nur ueber die ART abweist.
$subjectBergwaldVorab = avesmapsLoreRuleSubjectFromPlace(
    ['public_id' => 'p3', 'zone' => 'gemaessigt', 'area_public_ids' => ['a1', 'a2']],
    $areasById
);
assert(avesmapsLoreRuleTermMatchesSubject($a2NurWald, $subjectBergwaldVorab, $zones) === false,
    'der Wald a1 liegt NICHT in a2 -- Art und Ort muessen dieselbe Flaeche treffen');

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

// --- Ein Ort in ZWEI Flaechen traegt beide Flaechen (der "Bergwald") ----------------------
$bergwald = ['public_id' => 'p3', 'zone' => 'gemaessigt', 'area_public_ids' => ['a1', 'a2']];
$subjectBeide = avesmapsLoreRuleSubjectFromPlace($bergwald, $areasById);
assert(count($subjectBeide['flaechen']) === 2);
assert(avesmapsLoreRuleTermMatchesSubject($wald, $subjectBeide, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($gebirge, $subjectBeide, $zones) === true);

// --- Die Reihenfolge der geerbten Arten folgt der FLAECHENLISTE, nicht der Flaechentabelle -
// area_public_ids traegt hier absichtlich die UMGEKEHRTE Reihenfolge von $areasById (a1, a2),
// damit eine Implementierung, die ueber $areasById statt ueber area_public_ids iteriert,
// auffliegt -- ein Zaehl-Assert (count() === 2) sieht diesen Unterschied nicht, nur ein
// Assert auf die Liste selbst.
$umgekehrterBergwald = ['public_id' => 'p4', 'zone' => 'gemaessigt', 'area_public_ids' => ['a2', 'a1']];
$subjectUmgekehrt = avesmapsLoreRuleSubjectFromPlace($umgekehrterBergwald, $areasById);
assert(array_column($subjectUmgekehrt['flaechen'], 'public_id') === ['a2', 'a1'],
    'Reihenfolge folgt area_public_ids (a2 vor a1), nicht der Schluesselreihenfolge von $areasById');

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

// --- Task 9: MEHRERE Regionen (Weg/Etappe) und ein Herrschaftsgebiet (ecosystem_region_territory) --
// Zu diesem Zeitpunkt im Bestand aktiv: einbeere, raffranke, wurzelkraut (bergkraut steht seit oben
// auf 'suppressed'). Gegen sqlite, dieselbe Fixture-Bauart wie lore-rule-store-test.php.
$pdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id VARCHAR(36) NOT NULL, kind VARCHAR(16) NOT NULL,
        region_type VARCHAR(40) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1
    )'
);
$pdo->exec(
    'CREATE TABLE ecosystem_region_overlap (
        region_id INTEGER NOT NULL, other_region_id INTEGER NOT NULL, share REAL NOT NULL
    )'
);
$pdo->exec(
    'CREATE TABLE ecosystem_region_territory (
        region_id INTEGER NOT NULL, territory_public_id VARCHAR(36) NOT NULL, share REAL NOT NULL,
        is_aggregate TINYINT(1) NOT NULL DEFAULT 0
    )'
);
$regionInsert = $pdo->prepare(
    'INSERT INTO ecosystem_region (id, public_id, kind, region_type, is_active) VALUES (?, ?, ?, ?, 1)'
);
$regionInsert->execute([1, 'a1', 'vegetation', 'wald']);      // wie $farindel oben
$regionInsert->execute([2, 'a2', 'topographie', 'gebirge']);  // wie $finsterkamm oben
$regionInsert->execute([3, 'a3', 'vegetation', 'sumpf']);     // beruehrt terr-1 nur mit 2 %
$regionInsert->execute([9, 'klima-boreal', 'klima', 'boreal']);

// Realistisch mitgefuehrt (der LEFT JOIN auf ecosystem_region_overlap muss auch mit Zeilen
// funktionieren), aber fuer die Rechnung hier folgenlos: ecosystem_region_type fehlt in dieser
// Fixture, also liefert avesmapsLoreRuleOrderedZoneKeys() [] und jede Klimaspanne wird zu "keine
// Einschraenkung" -- dieselbe Randbedingung, die weiter oben schon bei 'wurzelkraut' T3 galt.
$pdo->prepare('INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (?, ?, ?)')
    ->execute([1, 9, 0.9]);

$territoryInsert = $pdo->prepare(
    'INSERT INTO ecosystem_region_territory (region_id, territory_public_id, share, is_aggregate) VALUES (?, ?, ?, 0)'
);
$territoryInsert->execute([1, 'terr-1', 0.8]);
$territoryInsert->execute([2, 'terr-1', 0.3]);
$territoryInsert->execute([3, 'terr-1', 0.02]); // unter AVESMAPS_CLIMATE_REGION_MIN_SHARE (5 %) -- muss draussen bleiben
$territoryInsert->execute([9, 'terr-1', 0.5]);  // eine Klimazone selbst -- muss draussen bleiben (kind='klima')

// --- Schritt 1: avesmapsLoreRuleReadSubjectsForAreas macht aus a1/a2 dieselben zwei Subjekte wie
// oben (avesmapsLoreRuleSubjectFromArea($farindel)/($finsterkamm)), nur ueber eine echte Abfrage. --
// 💣 MUTATION TARGET (1: "nur das erste Subjekt auswerten"): Reihenfolge ist ABSICHTLICH a2
// (Gebirge) VOR a1 (Wald). a2 allein trifft nur 'raffranke'; a1 allein trifft alle drei aktiven
// Regeln. Mit a1 zuerst saehe "nur das erste Subjekt" zufaellig richtig aus -- mit a2 zuerst faellt
// das Fehlen von 'einbeere' und 'wurzelkraut' auf.
$subjectsResult = avesmapsLoreRuleReadSubjectsForAreas($pdo, ['a2', 'a1']);
assert(count($subjectsResult['subjects']) === 2, 'beide Flaechen werden zu Subjekten');
assert($subjectsResult['truncated'] === false, 'zwei Flaechen -- weit unter dem Deckel');

// 💣 MUTATION TARGET (2: "die Treffer schneiden statt vereinigen"): Schnitt von {raffranke} (a2)
// und {einbeere, raffranke, wurzelkraut} (a1) waere {raffranke} -- derselbe falsche Wert wie bei
// Mutation 1, aber aus einem anderen Grund (UND statt ODER ueber die Subjekte, nicht Ignorieren
// eines Subjekts). Beide Mutationen faellt dieselbe Assertion auf.
$multiHits = avesmapsLoreRuleEntriesForSubjects($pdo, $subjectsResult['subjects']);
$multiKeys = array_keys($multiHits);
sort($multiKeys);
assert($multiKeys === ['einbeere', 'raffranke', 'wurzelkraut'],
    'Vereinigung ueber BEIDE Subjekte -- ein Weg durch Wald UND Gebirge zeigt beides: ' . json_encode($multiKeys));

// --- Schritt 1: der Deckel, aber NIE STILL -------------------------------------------------------
// 28 unbekannte Phantom-Ids plus die zwei echten -- 30 insgesamt, ueber AVESMAPS_LORE_RULE_AREA_LIMIT
// (25). Die zwei echten stehen VORN, bleiben also unter dem Deckel erhalten; das truncated-Zeichen
// muss trotzdem stehen, weil mehr angefragt wurde, als verarbeitet wurde.
$manyIds = array_merge(['a1', 'a2'], array_map(static fn (int $n): string => 'ghost-' . $n, range(1, 28)));
assert(count($manyIds) === 30);
$cappedResult = avesmapsLoreRuleReadSubjectsForAreas($pdo, $manyIds);
assert(count($cappedResult['subjects']) === 2, 'die zwei echten Flaechen ueberleben die Kappung');
// 💣 MUTATION TARGET (3: "den Deckel still kappen lassen, Zeichen weglassen"): dieselbe Falle wie
// bei avesmapsEcosystemParseRegionFilter, die diese Woche 31 Waelder lautlos verschluckt hat.
assert($cappedResult['truncated'] === true,
    '30 angefragt, 25 verarbeitet -- das muss SICHTBAR sein, nicht still verschluckt');

// --- Schritt 2: das Herrschaftsgebiet hat KEINE eigenen Regions-IDs -------------------------------
// Der Server loest sie ueber ecosystem_region_territory auf und macht daraus dieselben Subjekte wie
// Schritt 1 -- eine Flaeche, die ein Gebiet beruehrt, ist keine andere als eine, die ein Weg beruehrt.
$territoryResult = avesmapsLoreRuleReadSubjectsForTerritory($pdo, 'terr-1');
assert(count($territoryResult['subjects']) === 2,
    'a1 und a2 beruehren das Gebiet ueber der Schwelle -- a3 (2 %) und die Klimazone (kind) fallen heraus');
$territoryPublicIds = array_map(static fn (array $subject): string => $subject['public_id'], $territoryResult['subjects']);
sort($territoryPublicIds);
assert($territoryPublicIds === ['a1', 'a2']);
assert($territoryResult['truncated'] === false);

$territoryHits = avesmapsLoreRuleEntriesForSubjects($pdo, $territoryResult['subjects']);
$territoryKeys = array_keys($territoryHits);
sort($territoryKeys);
assert($territoryKeys === ['einbeere', 'raffranke', 'wurzelkraut'],
    'dieselben Subjekte wie Schritt 1 -- also dieselben Treffer: ' . json_encode($territoryKeys));

// Ein unbekanntes Gebiet oder eines ganz ohne Flaechen: leer, kein Fehler, kein 500.
assert(avesmapsLoreRuleReadSubjectsForTerritory($pdo, 'gibt-es-nicht') === ['subjects' => [], 'truncated' => false]);

echo "lore-rule-match: OK\n";
