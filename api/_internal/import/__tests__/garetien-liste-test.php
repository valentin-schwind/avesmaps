<?php

declare(strict_types=1);

// Die Arbeitsliste des Fensters: EINE Zeile je Objekt, ihre Items daran -- und die Zeilen, die
// gar keinen Vorschlag erzeugen (Aufgabe 6: "deckt sich" ohne Ergaenzung, "uebersprungen"),
// trotzdem sichtbar. Genau das ist der Zweck von Aufgabe 6.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-test.php

require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

// --- Kein offener Lauf -> eine LEERE, aber GUELTIGE Antwort. Kein Fehler: das ist der
// Normalfall vor dem ersten Rechnen (Brief Schritt 1).
$leererPdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
$leer = avesmapsGaretienArbeitsliste($leererPdo, 1, []);
assert($leer['ok'] === true, 'kein Lauf ist kein Fehler');
assert($leer['gesamt'] === 0 && $leer['objekte'] === [], 'ohne Lauf gibt es keine Objekte');
assert($leer['plan_run_id'] === 0, 'ohne Lauf gibt es keine Lauf-Nummer');
assert(!isset($leer['category_limit']), 'auch die leere Antwort kennt keine 200er-Deckelung');
$pruefungen += 4;

// --- Die Arbeitsliste: EINE Zeile je Objekt, ihre Items daran -- und die 49 + 6, die gar kein
// Item erzeugen, trotzdem sichtbar.
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$liste = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($liste['ok'] === true, 'ein gerechneter Lauf antwortet ok');
assert($liste['gesamt'] >= 6, 'alle sechs Fixture-Zeilen gehoeren in die Liste, auch die ohne Item: ' . $liste['gesamt']);
$namen = array_column($liste['objekte'], 'name');
assert(in_array('Alke', $namen, true), 'die Alke deckt sich -- sie erzeugt kein new-Item und muss trotzdem dastehen');
assert(in_array('Llavari', $namen, true), 'der uebersprungene Sammelartikel muss sichtbar bleiben');
$pruefungen += 4;

// --- 💣 EINE Zeile je Objekt, nicht je Item. Ihre Natter traegt fuenf Items und ist EINE Zeile.
$schluessel = array_column($liste['objekte'], 'key');
assert(count(array_unique($schluessel)) === count($schluessel), 'ein Objekt steht zweimal in der Liste');
$pruefungen++;

// --- Und der Zweck von Aufgabe 6 wird wirklich eingeloest: die Alke (deckt sich, aber MIT
// Ergaenzungs-Items) traegt ein FEINERES Urteil als der Staging-Wert, waehrend Llavari und
// Insel (KEIN Item) den rohen Staging-Wert tragen -- beide Wege wirklich BELEGT, nicht nur
// "irgendein Objekt kam durch".
$nachName = [];
foreach ($liste['objekte'] as $o) {
    $nachName[$o['name']] = $o;
}
assert(isset($nachName['Alke']), 'die Alke fehlt in der Liste');
assert($nachName['Alke']['urteil'] === 'ergaenzung',
    'die Alke deckt sich, hat aber Ergaenzungs-Items -- das Fenster zeigt "Ergaenzung", nicht "deckt_sich": '
    . $nachName['Alke']['urteil']);
assert(count($nachName['Alke']['items']) === 2, 'die Alke traegt ihre zwei Items (Quelle-Luecke + Geometrie): '
    . count($nachName['Alke']['items']));
assert(isset($nachName['Llavari']), 'Llavari fehlt in der Liste');
assert($nachName['Llavari']['urteil'] === 'uebersprungen',
    'ohne Item traegt das Objekt den ROHEN Staging-Wert: ' . $nachName['Llavari']['urteil']);
assert($nachName['Llavari']['grund'] !== '' && str_contains($nachName['Llavari']['grund'], 'Sammelartikel'),
    'der Grund des Ueberspringens muss aus der Staging-Zeile (Aufgabe 6) in die Liste wandern');
assert($nachName['Llavari']['items'] === [], 'Llavari hat kein einziges Item');
assert(isset($nachName['Gardel']), 'Gardel fehlt in der Liste');
assert($nachName['Gardel']['urteil'] === 'neu', 'der Gardel ist ein einfacher Neuzugang: ' . $nachName['Gardel']['urteil']);
$pruefungen += 9;

// --- Der Filter greift SERVERSEITIG -- der Browser rechnet nichts nach.
$nurNeu = avesmapsGaretienArbeitsliste($pdo, 1, ['urteil' => ['neu']]);
foreach ($nurNeu['objekte'] as $o) {
    assert($o['urteil'] === 'neu', 'der Urteilsfilter laesst ' . $o['urteil'] . ' durch');
}
assert(count($nurNeu['objekte']) > 0, 'der Urteilsfilter darf nicht alles wegfiltern');
assert($nurNeu['gesamt'] < $liste['gesamt'],
    'der Filter hat gar nichts weggenommen: ' . $nurNeu['gesamt'] . ' gegen ' . $liste['gesamt']);
$pruefungen += 3;

// --- Die Facetten zaehlen die Filterwerte -- ohne sie muesste der Browser die ganze Liste
// laden, um "Bach 143" in den Trichter zu schreiben.
assert(($liste['facetten']['wiki']['ggp'] ?? 0) > 0, 'die Wiki-Facette fehlt');
assert(($liste['facetten']['typ']['Bach'] ?? 0) > 0, 'die Typ-Facette fehlt');
assert(($liste['facetten']['ebene']['Gewaesser'] ?? 0) > 0, 'die Ebenen-Facette fehlt');
$pruefungen += 3;

// ⚠️ Die Facetten zaehlen den LAUF, nicht die gefilterte Sicht -- sonst faellt beim ersten Klick
// jeder andere Wert auf 0 und der Trichter laesst sich nicht mehr oeffnen.
// 🪤 Die Gegenprobe MUSS zeigen, dass der Filter wirklich etwas WEGGENOMMEN hat -- sonst waere
// diese Gleichheit auch dann gruen, wenn die Facetten IMMER die gefilterte Sicht zaehlten.
assert(count($nurNeu['objekte']) < count($liste['objekte']),
    'die Vorbedingung der naechsten Zusicherung: der Filter muss wirklich etwas wegnehmen');
assert($nurNeu['facetten']['typ'] == $liste['facetten']['typ'],
    'die Facettenzahlen duerfen sich mit dem Filter nicht bewegen');
$pruefungen += 2;

// --- Der Freitext sucht auf dem NAMEN.
$suche = avesmapsGaretienArbeitsliste($pdo, 1, ['suche' => 'gard']);
assert(count($suche['objekte']) === 1 && $suche['objekte'][0]['name'] === 'Gardel',
    'die Freitextsuche trifft den Namen nicht: ' . json_encode(array_column($suche['objekte'], 'name')));
$pruefungen++;

// --- Die Reiter zaehlen den BEARBEITUNGSSTAND, nicht das Urteil.
assert(isset($liste['reiter']['offen'], $liste['reiter']['vorgemerkt'],
    $liste['reiter']['abgelehnt'], $liste['reiter']['uebernommen']), 'die vier Reiter fehlen');
assert($liste['reiter']['uebernommen'] === 0, 'noch wurde nichts uebernommen');
// 🪤 Eine Zusicherung, die nur "isset" prueft, ist auch dann gruen, wenn kein einziges Objekt
// je einen Reiter erreicht -- deshalb wird hier eine ECHTE Verteilung belegt: die Summe der
// vier Reiter muss der Gesamtzahl der (ungefilterten) Objekte entsprechen, und mindestens zwei
// verschiedene Reiter muessen tatsaechlich belegt sein (Alke/Gardel/Muehlsee sind vorangehakt
// und daher 'vorgemerkt', Seitenarm/Llavari/Insel sind 'offen').
$reiterSumme = $liste['reiter']['offen'] + $liste['reiter']['vorgemerkt']
    + $liste['reiter']['abgelehnt'] + $liste['reiter']['uebernommen'];
assert($reiterSumme === count($liste['objekte']),
    'die Reiter muessen zusammen alle Objekte der ungefilterten Liste zaehlen: '
    . $reiterSumme . ' gegen ' . count($liste['objekte']));
assert($liste['reiter']['offen'] > 0 && $liste['reiter']['vorgemerkt'] > 0,
    'sowohl offen als auch vorgemerkt muessen in der Fixture wirklich vorkommen');
$pruefungen += 4;

// --- 🔴 KEINE Deckelung bei 200 -- das ist der ganze Zweck dieser Liste.
assert(!isset($liste['category_limit']), 'die Arbeitsliste kennt die 200er-Deckelung nicht');
$pruefungen++;

// --- Jedes Objekt traegt sein Urteil und seinen Bearbeitungsstand aus der geschlossenen Liste
// gueltiger Werte -- kein erfundener fuenfter/fuenfter Wert.
$gueltigeUrteile = ['neu', 'ergaenzung', 'zweifel', 'widerspruch', 'deckt_sich', 'uebersprungen'];
$gueltigeStaende = ['offen', 'vorgemerkt', 'abgelehnt', 'uebernommen'];
foreach ($liste['objekte'] as $o) {
    assert(in_array($o['urteil'], $gueltigeUrteile, true), 'unbekanntes Urteil: ' . $o['urteil']);
    assert(in_array($o['stand'], $gueltigeStaende, true), 'unbekannter Stand: ' . $o['stand']);
}
$pruefungen += 2;

// --- Die Gruppierung ist wirklich eine Gruppierung, nicht nur an einem einzigen Objekt gezeigt:
// die Alke traegt zwei rohe sync_plan_item-Zeilen (Quelle-Luecke + Geometrie-Angebot) unter
// EINEM Schluessel -- gezaehlt direkt in der Datenbank, nicht nur an der zusammengefassten Liste.
$roheItemZahlAlke = (int) $pdo->query(
    "SELECT COUNT(*) FROM sync_plan_item WHERE entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke%'"
)->fetchColumn();
assert($roheItemZahlAlke === 2, 'die Vorbedingung der Gruppierung: zwei rohe Items fuer die Alke, '
    . $roheItemZahlAlke . ' gefunden');
assert(count($nachName['Alke']['items']) === $roheItemZahlAlke,
    'die Gruppierung muss beide rohen Items unter einem Objekt zusammenfassen');
$pruefungen += 2;

// --- `avesmapsGaretienObjektSchluessel` ist "alles vor dem ersten |" -- an einem Abschnitts-Item
// UND an einem einfachen Item geprueft, nicht nur behauptet.
assert(avesmapsGaretienObjektSchluessel('ggp:Gewaesser:Bach:Garetien:Alke|ergaenzung|abc-1')
    === 'ggp:Gewaesser:Bach:Garetien:Alke', 'ein Abschnitts-Item verliert seinen Anlass/Abschnitt nicht sauber');
assert(avesmapsGaretienObjektSchluessel('ggp:Gewaesser:Fluss:Garetien:Gardel')
    === 'ggp:Gewaesser:Fluss:Garetien:Gardel', 'ein einfacher Schluessel ohne Pipe bleibt unveraendert');
$pruefungen += 2;

// --- Ein zweiter Bau (derselbe Bestand) veraendert die Zahlen nicht -- kein Seiteneffekt beim
// wiederholten Lesen.
$zweitesMal = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($zweitesMal['gesamt'] === $liste['gesamt'], 'ein zweites Lesen darf die Zahlen nicht verschieben');
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
