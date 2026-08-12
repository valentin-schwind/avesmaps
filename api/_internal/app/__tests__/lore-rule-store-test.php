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

// ---------------------------------------------------------------------------------------
// Fix-Runde 1, Befund 2: Besitzpruefung. Eine rule_id gehoert zu GENAU einem Eintrag --
// weder Loeschen noch Ueberschreiben duerfen ueber einen falschen entry_wiki_key eine
// fremde Regel treffen. $ruleId gehoert an dieser Stelle 'vierblattrige-einbeere' und
// traegt genau EINE Bedingung (siehe der Ersetzen-Test oben).
// ---------------------------------------------------------------------------------------

// Loeschen mit einem FREMDEN Eintragsschluessel: die Regel gehoert 'vierblattrige-einbeere',
// nicht 'wirselkraut'. Erwartet: false, und die Regel samt ihrer Bedingung bleibt UNANGETASTET
// -- nicht nur die Kopfzeile, auch ihre Kindzeile (sonst waere eine halb geloeschte fremde
// Regel das Ergebnis, schlimmer als eine ganz stehen gelassene).
assert(avesmapsLoreRuleDelete($pdo, $ruleId, 'wirselkraut') === false);
$stillThere = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($stillThere) === 1 && count($stillThere[0]['terms']) === 1);

// Speichern auf dieselbe rule_id, aber mit einem FREMDEN Eintragsschluessel: kein stilles
// Umbenennen/Anlegen -- ein klarer Fehler, und die fremde Regel bleibt exakt wie sie war.
$threwOnForeignSave = false;
try {
    avesmapsLoreRuleSave($pdo, 'wirselkraut', [$terms[1]], 'verbreitung', 7, $ruleId);
} catch (InvalidArgumentException) {
    $threwOnForeignSave = true;
}
assert($threwOnForeignSave === true);
$stillThere = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($stillThere) === 1 && count($stillThere[0]['terms']) === 1);
assert(avesmapsLoreRuleReadForEntry($pdo, 'wirselkraut') === []);

assert(avesmapsLoreRuleDelete($pdo, $ruleId, 'vierblattrige-einbeere') === true);
assert(avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere') === []);
// Zaehlt die Kindtabellen DIREKT -- eine geloeschte Kopfzeile liefert schon [] zurueck,
// ganz gleich ob ihre Kinder noch in lore_rule_term/lore_rule_term_type liegen.
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term')->fetchColumn() === 0);
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term_type')->fetchColumn() === 0);
assert(avesmapsLoreRuleDelete($pdo, $ruleId, 'vierblattrige-einbeere') === false);

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
// M1: eine STILLGELEGTE Zone (is_active = 0) darf die Reihenfolge nicht verbreitern -- sie
// wuerde sonst jede Spanne, die sie ueberbrueckt, lautlos vergroessern. sort_order 20 liegt
// bewusst ZWISCHEN polar (10) und boreal (30): ohne "AND is_active = 1" erschiene 'subpolar'
// zwischen den beiden und die Assertion unten schluege fehl.
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order, is_active) VALUES ('klima', 'subpolar', 'Subpolare Zone', 20, 0)");

assert(avesmapsLoreRuleOrderedZoneKeys($pdo) === ['polar', 'boreal', 'tropisch']);

// ---------------------------------------------------------------------------------------
// Fix-Runde 1, Befund 2: ReadAreas und ReadPlaces gegen ECHTE Zeilen, nicht nur den leeren
// Pfad. Ein Klimaband ist im echten System eine ganz gewoehnliche ecosystem_area-Zeile mit
// kind='klima' -- genauso hier nachgebaut, keine Sonderkonstruktion.
// ---------------------------------------------------------------------------------------

$pdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY,
        public_id VARCHAR(36) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        region_type VARCHAR(40) NULL,
        name VARCHAR(190) NOT NULL DEFAULT \'\',
        is_active TINYINT(1) NOT NULL DEFAULT 1
    )'
);
$regionStmt = $pdo->prepare(
    'INSERT INTO ecosystem_region (id, public_id, kind, region_type, name, is_active) VALUES (?, ?, ?, ?, ?, 1)'
);
$regionStmt->execute([1, 'area-farindel', 'vegetation', 'wald', 'Farindel']);
$regionStmt->execute([2, 'area-finster', 'topographie', 'gebirge', 'Finsterkamm']);
$regionStmt->execute([3, 'klima-boreal-region', 'klima', 'boreal', 'Boreale Zone (Band)']);
$regionStmt->execute([4, 'klima-subpolar-region', 'klima', 'subpolar', 'Subpolare Zone (Band)']);

$pdo->exec(
    'CREATE TABLE ecosystem_region_overlap (
        region_id INTEGER NOT NULL,
        other_region_id INTEGER NOT NULL,
        share REAL NOT NULL
    )'
);
$overlapStmt = $pdo->prepare(
    'INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (?, ?, ?)'
);
$overlapStmt->execute([1, 3, 0.6]);  // Farindel beruehrt boreal deutlich
$overlapStmt->execute([1, 4, 0.5]);  // Farindel beruehrt AUCH subpolar -- zwei Zonen, EINE Flaeche
// 💣 Befund 1 (Fix-Runde 1): Finster streift boreal nur mit 2 % -- UNTER
// AVESMAPS_CLIMATE_REGION_MIN_SHARE (5 %). Das ist Rauschen, keine Zugehoerigkeit.
$overlapStmt->execute([2, 3, 0.02]);

$areas = avesmapsLoreRuleReadAreas($pdo);
// Nur die zwei ECHTEN Flaechen -- die Klimabaender selbst (Zeilen 3, 4) sind kind='klima'
// und fallen ueber r.kind <> 'klima' heraus. Zaehlt zugleich das Gegenteil von Mutation D:
// eine Flaeche mit zwei Zonen ist EIN Eintrag, nicht zwei.
assert(count($areas) === 2);
$areasById = array_column($areas, null, 'public_id');
assert(array_key_exists('area-farindel', $areasById));
assert(array_key_exists('area-finster', $areasById));
assert(!array_key_exists('klima-boreal-region', $areasById));
assert(!array_key_exists('klima-subpolar-region', $areasById));

$farindelZones = $areasById['area-farindel']['zones'];
sort($farindelZones);
assert($farindelZones === ['boreal', 'subpolar']);
// Befund 1: 2 % ist unter der Schwelle -- Finster "beruehrt" boreal in diesem Sinne nicht.
assert($areasById['area-finster']['zones'] === []);

// --- avesmapsLoreRuleReadPlaces -----------------------------------------------------

$pdo->exec(
    'CREATE TABLE ecosystem_area (
        id INTEGER PRIMARY KEY,
        public_id VARCHAR(36) NOT NULL,
        region_id INTEGER NOT NULL,
        min_y REAL NOT NULL DEFAULT 0,
        max_y REAL NOT NULL DEFAULT 0,
        geometry_geojson TEXT NOT NULL DEFAULT \'{}\',
        is_active TINYINT(1) NOT NULL DEFAULT 1
    )'
);
$areaStmt = $pdo->prepare(
    'INSERT INTO ecosystem_area (id, public_id, region_id, min_y, max_y, geometry_geojson, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)'
);
$areaStmt->execute([1, 'geom-farindel-1', 1, 0, 0, '{}']);
$areaStmt->execute([2, 'geom-finster-1', 2, 0, 0, '{}']);
// Das Klimaband "boreal" ist selbst eine ecosystem_area-Zeile (kind='klima' ueber ihre
// Region) -- Rechteck y:500..600 ueber die volle Kartenbreite.
$borealPolygon = json_encode([
    'type' => 'Polygon',
    'coordinates' => [[[0, 500], [1024, 500], [1024, 600], [0, 600], [0, 500]]],
]);
$areaStmt->execute([3, 'geom-klima-boreal-1', 3, 500, 600, $borealPolygon]);

$pdo->exec(
    'CREATE TABLE location_ecosystem (
        location_id INTEGER NOT NULL,
        area_id INTEGER NOT NULL
    )'
);
$linkStmt = $pdo->prepare('INSERT INTO location_ecosystem (location_id, area_id) VALUES (?, ?)');
$linkStmt->execute([101, 1]); // Ort A -> Farindel
$linkStmt->execute([101, 2]); // Ort A -> AUCH Finsterkamm: zwei Flaechen, EIN Ort
$linkStmt->execute([102, 1]); // Ort B -> nur Farindel
$linkStmt->execute([103, 1]); // "Kreuzung" -> Farindel (muss trotzdem draussen bleiben)

$pdo->exec(
    'CREATE TABLE map_features (
        id INTEGER PRIMARY KEY,
        public_id VARCHAR(36) NOT NULL,
        name VARCHAR(190) NOT NULL DEFAULT \'\',
        feature_type VARCHAR(20) NOT NULL,
        feature_subtype VARCHAR(40) NULL,
        geometry_json TEXT NOT NULL DEFAULT \'{}\',
        is_active TINYINT(1) NOT NULL DEFAULT 1
    )'
);
$featureStmt = $pdo->prepare(
    'INSERT INTO map_features (id, public_id, name, feature_type, feature_subtype, geometry_json, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)'
);
// x = 900 (klar AUSSERHALB des Bandes, faellt aber nirgends ein, da das Band die volle
// Breite deckt), y = 550 (INNERHALB 500..600). Bewusst x != y und beide klar auf
// verschiedenen Seiten der Bandgrenze -- ein vertauschtes x/y (Mutation C) kippt das
// Ergebnis von 'boreal' auf '' um, statt zufaellig gleich zu bleiben.
$featureStmt->execute([101, 'ort-a', 'Nordfeste', 'location', 'dorf', json_encode(['type' => 'Point', 'coordinates' => [900, 550]])]);
// y = 100: klar AUSSERHALB des Bandes.
$featureStmt->execute([102, 'ort-b', 'Suedfeste', 'location', 'dorf', json_encode(['type' => 'Point', 'coordinates' => [500, 100]])]);
// 💣 Legacy-Kreuzung: feature_type bleibt 'location' (besteht den SQL-Filter unveraendert),
// aber feature_subtype verraet sie als Kreuzung -- GENAU der Fall, fuer den es das
// Praedikat avesmapsRoutePropertiesAreCrossing gibt statt eines Namensvergleichs
// (network-data.php:105-130). Koordinate absichtlich IM Band: ein fehlendes oder
// entferntes Kreuzungs-Praedikat (Mutation B) liesse sie faelschlich als Treffer
// in 'boreal' durch.
$featureStmt->execute([103, 'kreuzung-y', 'Kreuzung', 'location', 'crossing', json_encode(['type' => 'Point', 'coordinates' => [500, 550]])]);

$places = avesmapsLoreRuleReadPlaces($pdo);
// Drei Orte in map_features, aber die Kreuzung bleibt draussen.
assert(count($places) === 2);
$placesById = array_column($places, null, 'public_id');
assert(!array_key_exists('kreuzung-y', $placesById));

$ortA = $placesById['ort-a'];
$ortAAreas = $ortA['area_public_ids'];
sort($ortAAreas);
// Zwei Flaechen, keine Dublette.
assert($ortAAreas === ['area-farindel', 'area-finster']);
assert($ortA['zone'] === 'boreal');

$ortB = $placesById['ort-b'];
assert($ortB['area_public_ids'] === ['area-farindel']);
assert($ortB['zone'] === '');

// ---------------------------------------------------------------------------------------
// I2: eine Speicherung, die MITTENDRIN scheitert, darf die alte Kette nicht zerstoeren.
// lore_rule_term_type hat PRIMARY KEY (term_id, kind, region_type) und der INSERT kennt
// kein ON DUPLICATE KEY -- ein Term mit demselben Typ zweimal (den lore.php's
// Endpunkt-Riegel eigentlich dedupliziert, hier aber bewusst UNGEFILTERT direkt an den
// Store gereicht wird, um den Store selbst zu pruefen) verletzt den PRIMARY KEY beim
// zweiten INSERT -- GENAU der Fehlerfall, den die Transaktion auffangen muss.
// ---------------------------------------------------------------------------------------
$baseline = [
    ['area_public_id' => null, 'join_op' => 'und',
     'types' => [['kind' => 'vegetation', 'region_type' => 'steppe']],
     'climate_from' => null, 'climate_to' => null],
];
$survivorId = avesmapsLoreRuleSave($pdo, 'zwergenschatten', $baseline, 'verbreitung', 3);
assert($survivorId > 0);

$broken = [
    ['area_public_id' => null, 'join_op' => 'und',
     // Derselbe Typ zweimal an EINER Bedingung -- verletzt den PRIMARY KEY beim zweiten INSERT.
     'types' => [
         ['kind' => 'vegetation', 'region_type' => 'wald'],
         ['kind' => 'vegetation', 'region_type' => 'wald'],
     ],
     'climate_from' => null, 'climate_to' => null],
];
$threwMidSave = false;
try {
    avesmapsLoreRuleSave($pdo, 'zwergenschatten', $broken, 'verbreitung', 3, $survivorId);
} catch (Throwable) {
    $threwMidSave = true;
}
assert($threwMidSave === true);

// Die ALTE Kette steht noch -- unangetastet, nicht geloescht, nicht halb ersetzt. Ohne
// Transaktion waere die alte 'steppe'-Bedingung schon geloescht und die neue nur zur
// Haelfte da (der Term samt seinem ERSTEN Typ, ohne den zweiten).
$survived = avesmapsLoreRuleReadForEntry($pdo, 'zwergenschatten');
assert(count($survived) === 1 && count($survived[0]['terms']) === 1);
assert(count($survived[0]['terms'][0]['types']) === 1);
assert($survived[0]['terms'][0]['types'][0]['region_type'] === 'steppe');
// Auch die Kindtabellen DIREKT gezaehlt -- kein Rest der gescheiterten Ersetzung haengt herum.
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term')->fetchColumn() === 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM lore_rule_term_type')->fetchColumn() === 1);

echo "lore-rule-store: OK\n";
