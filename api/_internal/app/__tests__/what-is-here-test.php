<?php

declare(strict_types=1);

/**
 * Unit-Test der reinen Haelfte von „Was ist hier?". Keine DB, kein HTTP.
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/what-is-here-test.php
 * Exit 0 = alle Zusicherungen halten.
 *
 * WARUM GENAU DAS GEPRUEFT WIRD: jeder Fehler hier ist lautlos. Eine gedrehte Kette zeigt
 * dieselben vier Namen in falscher Reihenfolge; ein doppeltes Gebiet sieht aus wie zwei Stufen;
 * und ein Lore-Schluessel zuviel („aventurien") schuettet ueber JEDEN Punkt der Karte dieselben
 * 1.167 Eintraege aus, ohne dass irgendwo ein Fehler auftaucht.
 */

require_once __DIR__ . '/../what-is-here.php';

// ---------------------------------------------------------------- DIE KETTE ---------------------
// Vier Treffer, absichtlich in wilder Reihenfolge -- so kamen sie am 15.08.2026 aus dem bbox.

$treffer = [
    ['id' => 539, 'parent_id' => 538, 'public_id' => 'p-539', 'wiki_key' => 'wiki:grafenmark-ferdok',
     'name' => 'Grafenmark Ferdok', 'short_name' => '', 'type' => 'Grafenmark', 'coat_url' => '/u/a.png'],
    ['id' => 345, 'parent_id' => 0,   'public_id' => 'p-345', 'wiki_key' => 'wiki:kaiserreich',
     'name' => 'Kaiserreich', 'short_name' => 'Mittelreich', 'type' => 'Kaiserreich', 'coat_url' => ''],
    ['id' => 491, 'parent_id' => 345, 'public_id' => 'p-491', 'wiki_key' => 'wiki:kosch',
     'name' => 'Fuerstentum Kosch', 'short_name' => '', 'type' => 'Fuerstentum', 'coat_url' => ''],
    ['id' => 538, 'parent_id' => 491, 'public_id' => 'p-538', 'wiki_key' => 'wiki:grafschaft-ferdok',
     'name' => 'Grafschaft Ferdok', 'short_name' => '', 'type' => 'Grafschaft', 'coat_url' => ''],
];

$kette = avesmapsWhatIsHereOrderTerritories($treffer);
assert(count($kette) === 4, 'vier Treffer, vier Stufen');
assert($kette[0]['name'] === 'Grafenmark Ferdok', 'BLATT zuerst -- buildSettlementHierarchyMarkup dreht selbst');
assert($kette[3]['name'] === 'Kaiserreich', 'Wurzel zuletzt');

// 💣 Dasselbe Gebiet mit ZWEI Geometriezeilen -- am 15.08.2026 auf Maraskan gemessen.
$doppelt = [$treffer[0], $treffer[0]];
assert(count(avesmapsWhatIsHereOrderTerritories($doppelt)) === 1, 'entdoppelt ueber public_id');

// Ein Wurzelgebiet allein (Fuerstkomturei Tobimora): EINE Stufe, kein Absturz.
assert(count(avesmapsWhatIsHereOrderTerritories([$treffer[1]])) === 1, 'ein unabhaengiges Gebiet');
assert(avesmapsWhatIsHereOrderTerritories([]) === [], 'kein Treffer -> leere Kette, kein Fehler');

// ---------------------------------------------------------------- DIE OEFFENTLICHE FORM ---------
// 🔴 buildSettlementHierarchyMarkup (js/ui/popups.js:863) liest territory_public_id, nicht public_id
// (Fix-Runde 1, Aufgabe 3 -- ohne die Umbenennung liefen die Gold-Flug-Links der Treppe ins Leere).

// 🔴 $kette steht hier stellvertretend fuer das, was avesmapsWhatIsHereReadTerritories() zurueckgibt --
// dieselbe Funktion (avesmapsWhatIsHereOrderTerritories) auf denselben Rohdaten. avesmapsWhatIsHereLoreKeys()
// lebt von genau diesem wiki_key (Territorien-Zweig von lore.place, siehe unten). Die Zusicherung
// darunter prueft NUR, dass avesmapsWhatIsHereOrderTerritories selbst wiki_key nicht verliert -- sie
// reisst nicht, wenn stattdessen jemand die Kuerzung in avesmapsWhatIsHereReadTerritories einbaut (das
// prueft „DIE ECHTE PROBE" weiter unten, gegen den Bibliotheks-Quelltext). Striche man wiki_key in der
// Lesefunktion, verloere lore.place jeden Territoriums-Schluessel lautlos, und kein Test hier erreichte
// das direkt (avesmapsWhatIsHereReadTerritories braucht ein PDO) -- deshalb die Quelltextprobe.
foreach ($kette as $stufe) {
    assert(array_key_exists('wiki_key', $stufe) && $stufe['wiki_key'] !== '',
        'die geordnete Kette traegt wiki_key -- die Kuerzung darf nicht in die Lesefunktion wandern');
}

$payload = avesmapsWhatIsHereTerritoryPayload($kette);
assert(count($payload) === 4, 'eine Zeile je Stufe, unveraendert in der Zahl');
assert($payload[0]['territory_public_id'] === $kette[0]['public_id'],
    'territory_public_id traegt den Wert von public_id');
assert($payload[0]['name'] === $kette[0]['name'], 'name reist unveraendert mit');
assert($payload[0]['short_name'] === $kette[0]['short_name'], 'short_name reist unveraendert mit');
assert($payload[0]['type'] === $kette[0]['type'], 'type reist unveraendert mit');
assert($payload[0]['coat_url'] === $kette[0]['coat_url'], 'coat_url reist unveraendert mit');

// 💣 id/parent_id/wiki_key sind interne Angaben und duerfen die oeffentliche Form nicht erreichen.
foreach ($payload as $stufe) {
    assert(!array_key_exists('id', $stufe), 'id fliegt raus -- interne DB-Identitaet');
    assert(!array_key_exists('parent_id', $stufe), 'parent_id fliegt raus -- nur fuer die Tiefenrechnung');
    assert(!array_key_exists('wiki_key', $stufe), 'wiki_key fliegt raus -- schon in lore.place verarbeitet');
}
assert(avesmapsWhatIsHereTerritoryPayload([]) === [], 'kein Treffer -> leere oeffentliche Kette');

// ---------------------------------------------------------------- DIE WAPPEN-KETTE ---------------
// 🔴 Fix-Runde 6, Befund C: der Live-Befund war "alle vier Stufen coat_url: ''" -- die rohe Spalte
// political_territory.coat_of_arms_url wurde ungegatet durchgereicht. Das ist ein RECHTSRIEGEL, kein
// Schoenheitsfehler (NOTICE.md): nur `public_domain` darf je ausgeliefert werden. Diese Zusicherungen
// pruefen die reine Haelfte (avesmapsWhatIsHereGateCoatUrlsPure) -- fertige Zutaten, kein PDO.
$wappenKette = [
    ['wiki_key' => 'wiki:grafenmark-ferdok', 'coat_url' => 'https://original.example/ferdok.png'],
    ['wiki_key' => 'wiki:kaiserreich', 'coat_url' => 'https://original.example/kaiserreich.png'],
];
$wappenZutaten = [
    'staging' => [
        'wiki:grafenmark-ferdok' => ['coat_of_arms_url' => '', 'coat_of_arms_license_status' => 'public_domain'],
        // 🔴 DER FALL, UM DEN ES GEHT: eine echte URL steht da, aber die Lizenz ist nicht oeffentlich.
        'wiki:kaiserreich' => ['coat_of_arms_url' => '', 'coat_of_arms_license_status' => 'urheberrechtlich geschuetzt'],
    ],
    'overrides' => [],
];
$gegatet = avesmapsWhatIsHereGateCoatUrlsPure($wappenKette, $wappenZutaten, true);
assert($gegatet[0]['coat_url'] !== '', 'public_domain -> das Wappen darf raus (sonst waere die Zusicherung unten wertlos)');
assert($gegatet[1]['coat_url'] === '',
    '🔴 NICHT public_domain -> KEIN Wappen, obwohl eine URL da war -- das ist der Rechtsriegel aus NOTICE.md, nicht nur eine leere Spalte');

// Derselbe Riegel gilt fuer den globalen "Wappen: Aus"-Schalter: der tauscht ein ERLAUBTES Wappen
// gegen den Platzhalter, darf aber kein Wappen dazuerfinden, das der Lizenzriegel schon verworfen hat.
$mitSchalterAus = avesmapsWhatIsHereGateCoatUrlsPure($wappenKette, $wappenZutaten, false);
assert($mitSchalterAus[0]['coat_url'] === AVESMAPS_COAT_PLACEHOLDER_URL,
    'der globale Schalter tauscht ein erlaubtes Wappen gegen den Platzhalter');
assert($mitSchalterAus[1]['coat_url'] === '',
    'aber ein bereits verworfenes Wappen bleibt verworfen -- kein Platzhalter aus dem Nichts');

// ---------------------------------------------------------------- DIE VORFAHRENKETTE -------------
// 🔴 Fix-Runde 3: der Live-Befund war „nur EINE Stufe statt vier" -- Grafschaft/Fuerstentum/
// Kaiserreich sind ABGELEITETE Aussengrenzen ohne eigene Geometrie und fielen durch die reine
// Trefferlisten-Ordnung oben (avesmapsWhatIsHereOrderTerritories) strukturell durch. Diese Zusicherungen
// pruefen die reine Haelfte des Elternlaufs (avesmapsWhatIsHereAncestorChain) -- eine Knotenmenge
// (id -> Zeile) plus eine Start-id, keine Datenbank noetig.
function avesmapsWhatIsHereTestKnoten(int $id, int $parentId, string $name): array
{
    return ['id' => $id, 'parent_id' => $parentId, 'public_id' => 'p-' . $id,
        'wiki_key' => 'wiki:' . strtolower($name), 'name' => $name, 'short_name' => '',
        'type' => '', 'coat_url' => ''];
}

// Vier Stufen, in richtiger Reihenfolge: Blatt -> Wurzel.
$organigramm = [
    539 => avesmapsWhatIsHereTestKnoten(539, 538, 'Grafenmark Ferdok'),
    538 => avesmapsWhatIsHereTestKnoten(538, 491, 'Grafschaft Ferdok'),
    491 => avesmapsWhatIsHereTestKnoten(491, 345, 'Fuerstentum Kosch'),
    345 => avesmapsWhatIsHereTestKnoten(345, 0, 'Kaiserreich'),
];
$vierStufen = avesmapsWhatIsHereAncestorChain($organigramm, 539);
assert(count($vierStufen) === 4, 'vier Knoten, vier Stufen -- der Live-Befund war eine');
assert($vierStufen[0]['name'] === 'Grafenmark Ferdok', 'BLATT zuerst, wie bei der Trefferordnung');
assert($vierStufen[1]['name'] === 'Grafschaft Ferdok', 'zweite Stufe -- hat KEINE eigene Geometrie');
assert($vierStufen[2]['name'] === 'Fuerstentum Kosch', 'dritte Stufe');
assert($vierStufen[3]['name'] === 'Kaiserreich', 'WURZEL zuletzt');

// Ein Wurzelgebiet allein: EINE Stufe, kein Absturz.
$nurWurzel = avesmapsWhatIsHereTestKnoten(345, 0, 'Kaiserreich');
assert(avesmapsWhatIsHereAncestorChain([345 => $nurWurzel], 345) === [$nurWurzel],
    'ein unabhaengiges Gebiet -- genau eine Stufe');

// Ein Zyklus (defekte Elterndaten): bricht ab, statt zu haengen.
$zyklus = [
    1 => avesmapsWhatIsHereTestKnoten(1, 2, 'A'),
    2 => avesmapsWhatIsHereTestKnoten(2, 1, 'B'), // B's Elternteil ist wieder A -- ein Ring
];
$zyklusErgebnis = avesmapsWhatIsHereAncestorChain($zyklus, 1);
assert(count($zyklusErgebnis) === 2, 'der Ring bricht ab, sobald ein Knoten zum zweiten Mal drankaeme');
assert($zyklusErgebnis[0]['name'] === 'A' && $zyklusErgebnis[1]['name'] === 'B',
    'beide Ring-Knoten stehen einmal drin, in Laufreihenfolge');

// Der Deckel bei 12: eine Kette aus 20 Knoten liefert hoechstens 12 Stufen.
$langeKette = [];
for ($i = 1; $i <= 20; $i++) {
    $langeKette[$i] = avesmapsWhatIsHereTestKnoten($i, $i < 20 ? $i + 1 : 0, 'Stufe ' . $i);
}
$gedeckelt = avesmapsWhatIsHereAncestorChain($langeKette, 1);
assert(count($gedeckelt) === 12, 'der Deckel greift bei 20 Knoten -- hoechstens 12 Stufen');
assert($gedeckelt[0]['name'] === 'Stufe 1' && $gedeckelt[11]['name'] === 'Stufe 12',
    'der Deckel schneidet am ENDE ab, die ersten 12 Stufen bleiben unveraendert');

// Kein Treffer, keine Start-id in der Knotenmenge -> leere Kette, kein Fehler.
assert(avesmapsWhatIsHereAncestorChain([], 539) === [], 'unbekannte Start-id -> leere Kette');
assert(avesmapsWhatIsHereAncestorChain($organigramm, 0) === [], 'Start-id 0 (kein Elternteil) -> leere Kette');

// ---------------------------------------------------------------- DIE LORE-SCHLUESSEL -----------

$flaechen = [
    ['kind' => 'derographisch', 'region_public_id' => 'r-1', 'wiki_region_key' => 'aventurien'],
    ['kind' => 'vegetation',    'region_public_id' => 'r-2', 'wiki_region_key' => 'dunkelwald'],
    ['kind' => 'vegetation',    'region_public_id' => 'r-3', 'wiki_region_key' => null],
    ['kind' => 'klima',         'region_public_id' => 'r-4', 'wiki_region_key' => null],
];

$lore = avesmapsWhatIsHereLoreKeys($kette, $flaechen);

// 🔴 „aventurien" traegt 1.167 Lore-Eintraege. Waere es dabei, listete JEDER Punkt der Karte
// dieselben 1.167 -- was ueberall gilt, sagt ueber diese Stelle nichts.
assert(!in_array('aventurien', $lore['place'], true), 'die Derographie liefert KEINE Lore');
assert(in_array('dunkelwald', $lore['place'], true), 'die Vegetationsflaeche liefert welche');
assert(in_array('grafenmark-ferdok', $lore['place'], true), 'das Gebiet auch -- und das Praefix wiki: ist ab');
assert(!in_array('', $lore['place'], true), 'eine Flaeche ohne Wiki-Schluessel liefert keinen leeren Schluessel');

// 🔴 `area` nimmt JEDE getroffene Flaeche, auch die derographische: dort greift die
// Lebensraum-REGEL, nicht die Ortsverknuepfung -- das sind zwei verschiedene Quellen.
assert(count($lore['area']) === 4, 'alle vier Flaechen stehen in area');

// ---------------------------------------------------------------- DIE ENDPUNKT-ORDNUNG ----------
// 🔴 DIE SCHRANKE, ZWEITE HAELFTE: avesmapsWhatIsHereReadTerritories() selbst laesst sich hier nicht
// pruefen (braucht ein PDO), und api/app/what-is-here.php wird von keiner Testdatei geladen (nur GET,
// nur HTTP). Diese Zusicherung prueft deshalb den QUELLTEXT des Endpunkts, im Stil des Panel-Tests
// (js/map-features/__tests__/what-is-here-panel.test.js): der Aufruf von avesmapsWhatIsHereLoreKeys()
// muss VOR dem von avesmapsWhatIsHereTerritoryPayload() stehen -- wiki_key muss bis dahin in der Kette
// stehen bleiben. 💣 Kommentare werden VORHER ausgeblendet: die Prosa in dieser Datei nennt beide
// Funktionsnamen mehrfach, ein Treffer darin waere kein Beweis.
function avesmapsWhatIsHereTestOhneKommentare(string $quelltext): string
{
    $ohneBlock = preg_replace('#/\*.*?\*/#s', '', $quelltext);
    return preg_replace('#^[ \t]*//.*$#m', '', $ohneBlock);
}

$endpunktQuelle = avesmapsWhatIsHereTestOhneKommentare(
    (string) file_get_contents(__DIR__ . '/../../../app/what-is-here.php')
);
$loreAufruf = strpos($endpunktQuelle, 'avesmapsWhatIsHereLoreKeys(');
$payloadAufruf = strpos($endpunktQuelle, 'avesmapsWhatIsHereTerritoryPayload(');
assert($loreAufruf !== false, 'der Endpunkt ruft avesmapsWhatIsHereLoreKeys ueberhaupt auf');
assert($payloadAufruf !== false, 'der Endpunkt ruft avesmapsWhatIsHereTerritoryPayload ueberhaupt auf');
assert($loreAufruf < $payloadAufruf,
    'avesmapsWhatIsHereLoreKeys laeuft VOR avesmapsWhatIsHereTerritoryPayload -- sonst wiki_key schon weg');
// ⚠️ Das fängt nur den Zeilentausch IM ENDPUNKT. Die eigentliche Gefahr -- die Kuerzung wandert IN
// avesmapsWhatIsHereReadTerritories (andere Datei) -- laesst diesen Quelltext bitidentisch und ist
// fuer diese Zusicherung strukturell unsichtbar. Dafuer gibt es die naechste, echte Probe unten.

// ---------------------------------------------------------------- DIE ECHTE PROBE ---------------
// 🔴 DER FALL, UM DEN ES GEHT (Fix-Runde 3): weder die wiki_key-Zusicherung oben (prueft nur
// avesmapsWhatIsHereOrderTerritories auf einem Fixture, das per Konstruktion immer wiki_key traegt --
// reisst nur, wenn DIE FUNKTION selbst kaputtgeht) noch die Endpunkt-Ordnung eben (prueft nur
// api/app/what-is-here.php) sehen es, wenn jemand avesmapsWhatIsHereTerritoryPayload() in den RUMPF
// von avesmapsWhatIsHereReadTerritories selbst einbaut. Deshalb hier der Quelltext DIESER Bibliothek,
// mit demselben Kommentarfilter, und diesmal der Rumpf sauber herausgeschnitten (von der
// Funktionsdeklaration bis zur naechsten auf Spalte 0 beginnenden function-Zeile).
// 💣 OHNE DEN FILTER WAERE DAS EIN FALSCHER TREFFER: die erklaerende Prosa in
// avesmapsWhatIsHereReadTerritories nennt „avesmapsWhatIsHereTerritoryPayload()" selbst zweimal, um zu
// begruenden, warum die Funktion NICHT aufgerufen wird -- genau der Kommentarfund, der die
// Endpunkt-Zusicherung in Runde 2 blind gemacht haette, waere er dort aufgetreten.
$bibliotheksQuelle = avesmapsWhatIsHereTestOhneKommentare(
    (string) file_get_contents(__DIR__ . '/../what-is-here.php')
);
$funktionsKopf = 'function avesmapsWhatIsHereReadTerritories(';
$rumpfStart = strpos($bibliotheksQuelle, $funktionsKopf);
assert($rumpfStart !== false, 'avesmapsWhatIsHereReadTerritories ist in der Bibliothek definiert');

$nachDemKopf = substr($bibliotheksQuelle, $rumpfStart + strlen($funktionsKopf));
$naechsteFunktionGefunden = preg_match('/^function\s/m', $nachDemKopf, $funktionstreffer, PREG_OFFSET_CAPTURE);
$rumpf = $naechsteFunktionGefunden ? substr($nachDemKopf, 0, $funktionstreffer[0][1]) : $nachDemKopf;

assert(!str_contains($rumpf, 'avesmapsWhatIsHereTerritoryPayload('),
    'avesmapsWhatIsHereTerritoryPayload darf NICHT im Rumpf von avesmapsWhatIsHereReadTerritories '
    . 'laufen -- sonst waere wiki_key schon weg, bevor avesmapsWhatIsHereLoreKeys es lesen kann');

// ---------------------------------------------------------------- DIE PDO-PLATZHALTER-SCHRANKE --
// 🔴 Fix-Runde 2 (der leere Live-Befund): avesmapsCreatePdo (api/_internal/bootstrap.php) setzt
// PDO::ATTR_EMULATE_PREPARES => false. Bei nativen Prepared Statements lehnt MySQL einen doppelt
// verwendeten benannten Platzhalter innerhalb DESSELBEN Statements mit SQLSTATE[HY093] ab -- die
// Ausnahme landete im catch (Throwable) und wurde live zu einer stillen leeren Antwort (ok:true,
// aber territories/landscapes komplett leer). Diese Maschine hat gar keinen PDO-Treiber, kann den
// Fehler also nicht selbst ausloesen -- die Schranke sucht ihn stattdessen im QUELLTEXT: jede
// $pdo->prepare(...)-Zeichenkette, jeder :platzhalter darin gezaehlt, keiner darf doppelt vorkommen.
// 💣 Kommentare vorher ausgeblendet ($bibliotheksQuelle von oben, DIE ECHTE PROBE) -- sonst waere die
// Erklaerung hier selbst (die :x/:y mehrfach beim Namen nennt) ein falscher Treffer.
preg_match_all('/\$pdo->prepare\(\s*\'(.*?)\'\s*\);/s', $bibliotheksQuelle, $sqlTreffer);
// 🔴 Fix-Runde 3: seit avesmapsWhatIsHereReadAncestors() sind es DREI, nicht mehr zwei -- Gebiete,
// Flaechen, und der parent_id-Einzelzeilen-Lauf der Herrschaftskette.
assert(count($sqlTreffer[1]) === 3, 'drei SQL-Abfragen erwartet -- Gebiete, Flaechen, Vorfahrenlauf');
foreach ($sqlTreffer[1] as $sql) {
    preg_match_all('/:[a-zA-Z_][a-zA-Z0-9_]*/', $sql, $platzhalterTreffer);
    assert(count($platzhalterTreffer[0]) > 0, 'die Abfrage traegt ueberhaupt benannte Platzhalter');
    foreach (array_count_values($platzhalterTreffer[0]) as $name => $anzahl) {
        assert($anzahl === 1, "Platzhalter $name kommt im selben Statement $anzahl-mal vor -- "
            . 'EMULATE_PREPARES=false lehnt das mit SQLSTATE[HY093] ab, und die Ausnahme wird hier '
            . 'lautlos zu einer leeren Antwort (catch (Throwable) { return []; })');
    }
}

// ---------------------------------------------------------------- TRIAGE 35: LANDSCHAFTS-ENTDOPPLUNG
// 🔴 Territorien und lore.area entdoppeln laengst ueber ihre public_id -- die sichtbare
// Landschaftszeile tat es bisher nicht. Reine Zusicherung, kein PDO noetig.
$landschaftsTreffer = [
    ['kind' => 'vegetation', 'region_public_id' => 'r-dunkelwald', 'region_name' => 'Dunkelwald'],
    // Zweite Geometriezeile DERSELBEN Region (dieselbe Bauart wie „VIELE Features je Gebiet").
    ['kind' => 'vegetation', 'region_public_id' => 'r-dunkelwald', 'region_name' => 'Dunkelwald'],
    ['kind' => 'topographie', 'region_public_id' => 'r-flusslande', 'region_name' => 'Flusslande'],
];
$entdoppelt = avesmapsWhatIsHereDedupeAreas($landschaftsTreffer);
assert(count($entdoppelt) === 2, 'die doppelte Dunkelwald-Zeile faellt weg -- zwei Regionen bleiben, nicht drei Zeilen');
assert(count(array_filter($entdoppelt, static fn(array $r): bool => $r['region_public_id'] === 'r-dunkelwald')) === 1,
    'Dunkelwald steht genau einmal');
assert(count(array_filter($entdoppelt, static fn(array $r): bool => $r['region_public_id'] === 'r-flusslande')) === 1,
    'Flusslande bleibt unberuehrt daneben stehen');
// ⚠️ ZWEI VERSCHIEDENE Regionen ueberlagert (der dokumentierte Normalfall) duerfen NICHT
// zusammenfallen -- das waere der Gegenfehler, eine zu aggressive Entdopplung.
assert($entdoppelt[0]['region_name'] !== $entdoppelt[1]['region_name'], 'Dunkelwald und Flusslande bleiben zwei eigene Zeilen');
// Eine Zeile ohne region_public_id wird NIE entdoppelt -- leer ist kein Schluessel.
$ohneSchluessel = avesmapsWhatIsHereDedupeAreas([
    ['kind' => 'derographisch', 'region_public_id' => '', 'region_name' => 'X'],
    ['kind' => 'derographisch', 'region_public_id' => '', 'region_name' => 'X'],
]);
assert(count($ohneSchluessel) === 2, 'leerer Schluessel entdoppelt nicht -- beide Zeilen bleiben');
assert(avesmapsWhatIsHereDedupeAreas([]) === [], 'kein Treffer -> leere Liste, kein Fehler');

// ---------------------------------------------------------------- C2: DIE INNEREN catch UNTERSCHEIDEN
// 🔴 Fix-Runde 7 (Schlussprüfung): der doppelte SQL-Platzhalter (Fix-Runde 2) wurde nur deshalb bis
// in die Produktion getragen, weil `catch (Throwable) { return []; }` JEDEN Fehler stumm schluckte --
// nicht nur eine fehlende Tabelle. Diese Zusicherung haelt fest, dass KEIN blindes
// `catch (Throwable)` (ohne Variable, ohne Pruefung) mehr in der Bibliothek steht -- jeder Fangblock
// muss die Ausnahme benennen und avesmapsIsMissingTableError() befragen.
assert(!str_contains($bibliotheksQuelle, 'catch (Throwable)'),
    'kein blindes catch (Throwable) mehr -- jeder Fangblock muss die Ausnahme pruefen, nicht stumm schlucken');
$missingTableCheckCount = substr_count($bibliotheksQuelle, 'avesmapsIsMissingTableError($exception)');
assert($missingTableCheckCount === 5,
    "5 Fangbloecke sollten avesmapsIsMissingTableError(\$exception) befragen, gezaehlt: $missingTableCheckCount "
    . '(Blatt-Abfrage, Wappen-Zutaten, Vorfahren-prepare, Vorfahren-execute, Flaechen-Abfrage)');
$rethrowCount = substr_count($bibliotheksQuelle, 'throw $exception;');
assert($rethrowCount === 5, "5 throw \$exception erwartet (einer je gepruefter Fangblock), gezaehlt: $rethrowCount");

// ---------------------------------------------------------------- I2: GESCHLUESSELT, KEIN VOLLSCAN -
// 🔴 avesmapsWhatIsHereGateCoatUrls() muss die GESCHLUESSELTE Variante rufen
// (avesmapsLoadSettlementCoatGateInputsByKeys, api/_internal/coat-url.php), nicht mehr den
// Vollscan (avesmapsLoadSettlementCoatGateInputs) -- der bleibt fuer die Siedlungs-Treppe bestehen,
// nur hier waere er pro Rechtsklick zwei volle Tabellenscans.
assert(str_contains($bibliotheksQuelle, 'avesmapsLoadSettlementCoatGateInputsByKeys($pdo'),
    'die Wappen-Kette laedt geschluesselt, nicht per Vollscan');
$gateCoatUrlsStart = strpos($bibliotheksQuelle, 'function avesmapsWhatIsHereGateCoatUrls(');
assert($gateCoatUrlsStart !== false, 'avesmapsWhatIsHereGateCoatUrls ist definiert');
$gateCoatUrlsEnde = strpos($bibliotheksQuelle, "\nfunction ", $gateCoatUrlsStart + 10);
$gateCoatUrlsRumpf = $gateCoatUrlsEnde !== false
    ? substr($bibliotheksQuelle, $gateCoatUrlsStart, $gateCoatUrlsEnde - $gateCoatUrlsStart)
    : substr($bibliotheksQuelle, $gateCoatUrlsStart);
assert(!str_contains($gateCoatUrlsRumpf, 'avesmapsLoadSettlementCoatGateInputs($pdo)'),
    'der Vollscan-Aufruf (ohne "ByKeys") steht NICHT mehr im Rumpf dieser Funktion');

// ---------------------------------------------------------------- C2: DER AEUSSERE catch LOGGT -----
// 🔴 avesmapsServerErrorResponse (api/_internal/bootstrap.php) statt eines stummen
// avesmapsErrorResponse -- echter Text ins SERVER-Log, fester Satz an den Client. $endpunktQuelle
// (oben, DIE ENDPUNKT-ORDNUNG) ist derselbe kommentarbefreite Endpunkt-Quelltext -- kein zweites Mal
// gelesen.
assert(str_contains($endpunktQuelle, "avesmapsServerErrorResponse(\$exception, 'what-is-here')"),
    'der aeussere catch ruft avesmapsServerErrorResponse -- echtes Server-Log statt stiller 500er');
assert(!str_contains($endpunktQuelle, "avesmapsErrorResponse(500, 'server_error', 'This map point could not be resolved.')"),
    'der alte, loggende catch ist wirklich ersetzt, nicht nur ergaenzt');

echo "what-is-here: alles gruen\n";
