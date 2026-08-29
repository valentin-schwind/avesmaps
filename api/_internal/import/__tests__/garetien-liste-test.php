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

// --- 🔴 Der `change_type` reist je Item mit (Aufgabe 15). Ohne ihn findet die Knopfleiste der
// Einzelansicht keine einzige `new`-Zeile, und „Neu einfuegen" waere bei JEDEM Neuzugang und
// JEDEM Zweifel dauerhaft ausgegraut. 🪤 Hier stand dafuer eine Zahl, und sie war doppelt
// gezaehlt (die 231 SIND schon 199 + 32); die Aufteilung der 289 steht im Auftrag §3.4 und wird
// dort nachgeschlagen, nicht an einer Abschrift.
// ⚠️ Gemessen wird an BEIDEN Werten, nicht nur an der Anwesenheit des Schluessels: der Gardel ist
// ein Neuzugang ('new'), die Items der Alke sind Aenderungen ('changed'). Ein Feld, das ueberall
// dasselbe stuende, waere von einer festen Zeichenkette nicht zu unterscheiden.
assert(array_column($nachName['Gardel']['items'], 'change_type') === ['new'],
    'ein Neuzugang traegt change_type "new"');
assert(array_unique(array_column($nachName['Alke']['items'], 'change_type')) === ['changed'],
    'die Ergaenzungs- und Geometrie-Items der Alke tragen "changed"');
$pruefungen += 2;

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

// --- 🔴 Owner-Meldung 29.08.2026: der Filter-Trichter soll Typen, aus denen ohnehin nichts zu
// holen ist, blasser darstellen -- servergeliefert, ohne die zwei Listen im Browser nachzubauen.
// Die Fixture traegt bereits eine Zeile spaeterer Stufe (die Insel auf der Kosch-Gewaesserseite).
// 🪤 Vakuum-Zusicherung vermeiden: importierbare Typen muessen eine LEERE, aber VORHANDENE
// Kategorie tragen -- ein fehlender Schluessel saehe im ?? -Rueckfall genauso aus wie eine
// leere Kategorie und bewiese damit nichts.
assert(array_key_exists('Insel', $liste['facetten']['typ_kategorie']),
    'die Insel muss ueberhaupt in der Kategorie-Facette stehen');
assert($liste['facetten']['typ_kategorie']['Insel'] === 'spaetere_stufe',
    'Insel gehoert zu einer spaeteren Stufe: ' . $liste['facetten']['typ_kategorie']['Insel']);
assert(array_key_exists('Bach', $liste['facetten']['typ_kategorie'])
    && $liste['facetten']['typ_kategorie']['Bach'] === '',
    'ein importierbarer Typ traegt eine LEERE Kategorie, keine fehlende');
assert(array_key_exists('Fluss', $liste['facetten']['typ_kategorie'])
    && $liste['facetten']['typ_kategorie']['Fluss'] === '',
    'und ein zweiter importierbarer Typ, gegen Zufallsgleichheit');
$pruefungen += 4;

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
// je einen Reiter erreicht -- deshalb wird hier eine ECHTE Verteilung belegt.
// 🔴 RULING R1 (Aufgabe 1, 29.08.2026): `vorgemerkt` ist seit dem Entfernen des `selected`-Zweigs
// aus avesmapsGaretienListeObjektStand KEIN Bearbeitungsstand mehr -- ein Haekchen ist eine
// Markierung, kein Stand (Owner: „Markieren aendert nichts"). Die Zahl bleibt in der Fusszeile,
// aber sie ist seither eine EIGENE, sich mit den drei echten Staenden UEBERLAPPENDE Zaehlung
// (avesmapsGaretienListeObjektHatVormerkung): ein angehaktes, aber sonst offenes Objekt zaehlt zu
// BEIDEM. Die Summenprobe gilt deshalb nur noch den drei echten, sich gegenseitig
// ausschliessenden Staenden.
$reiterSumme = $liste['reiter']['offen'] + $liste['reiter']['abgelehnt'] + $liste['reiter']['uebernommen'];
assert($reiterSumme === count($liste['objekte']),
    'offen+abgelehnt+uebernommen muessen zusammen alle Objekte der ungefilterten Liste zaehlen: '
    . $reiterSumme . ' gegen ' . count($liste['objekte']));
assert($liste['reiter']['offen'] > 0 && $liste['reiter']['vorgemerkt'] > 0,
    'sowohl offen als auch die Vormerkungs-Zahl muessen in der Fixture wirklich vorkommen -- '
    . 'Alke/Gardel/Muehlsee sind vorangehakt und zaehlen zu "vorgemerkt", OHNE deshalb aus '
    . '"offen" herauszufallen');
$pruefungen += 4;

// --- 🔴 KEINE Deckelung bei 200 -- das ist der ganze Zweck dieser Liste.
assert(!isset($liste['category_limit']), 'die Arbeitsliste kennt die 200er-Deckelung nicht');
$pruefungen++;

// --- Jedes Objekt traegt sein Urteil und seinen Bearbeitungsstand aus der geschlossenen Liste
// gueltiger Werte -- kein erfundener fuenfter/fuenfter Wert.
$gueltigeUrteile = ['neu', 'ergaenzung', 'zweifel', 'widerspruch', 'deckt_sich', 'uebersprungen'];
// 🔴 OHNE 'vorgemerkt': RULING R1 -- avesmapsGaretienListeObjektStand gibt diesen Wert seit
// Aufgabe 1 nie mehr zurueck, er ist nur noch eine EIGENE Zaehlung neben dem Stand.
$gueltigeStaende = ['offen', 'abgelehnt', 'uebernommen'];
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

// =================================================================================================
// REVIEW I3: von neun Filterparametern waren nur zwei geprueft (urteil, suche) -- und der
// ungefiltert-Standardpfad (`stand` fehlend) lag genau dort. Vier weitere werden hier NACHGEHOLT:
// stand, nur_mehrteilig, nur_ungehakt, versatz -- jeweils mit einer echten DIFFERENZ, nicht nur
// mit dem nackten Ergebnis.
//
// Fuer nur_mehrteilig braucht es ein Objekt mit MEHR als einem Abschnitt -- die sechs
// Fixture-Objekte haben hoechstens einen. Ein siebtes wird deshalb direkt ueber
// avesmapsSyncPlanAddItem in denselben offenen Lauf gelegt (zwei Items, zwei Abschnitte,
// EIN entity_key-Praefix) -- ohne die geteilte Fixture in garetien-plan.php anzufassen.
// ---------------------------------------------------------------------------------------------

$planRunId = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
avesmapsSyncPlanAddItem($pdo, $planRunId, [
    'entity_key' => 'ggp:Gewaesser:Fluss:Garetien:Vielarm|ergaenzung|w-1',
    'entity_public_id' => 'w-1',
    'change_type' => 'changed',
    'label' => 'Vielarm -> Erstling · Quelle',
    'after' => [
        // 💣 Diese Zeile hat KEINE Staging-Zeile (sie entsteht nur fuer den Filtertest) -- der
        // Name muss also aus EINEM Item kommen, sonst waere das Objekt namenlos und die
        // nur_mehrteilig-Zusicherung liesse sich am Namen nicht festmachen.
        'typ' => 'Fluss', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'anlass' => 'ergaenzung',
        'felder' => ['name', 'quelle'], 'name' => 'Vielarm',
        'abschnitt' => ['public_id' => 'w-1', 'name' => 'Erstling', 'punkte' => 4, 'geometrie' => [[1.0, 2.0]]],
    ],
    'selected' => 1,
]);
avesmapsSyncPlanAddItem($pdo, $planRunId, [
    'entity_key' => 'ggp:Gewaesser:Fluss:Garetien:Vielarm|ergaenzung|w-2',
    'entity_public_id' => 'w-2',
    'change_type' => 'changed',
    'label' => 'Vielarm -> Zweitling · Quelle',
    'after' => [
        'typ' => 'Fluss', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
        'abschnitt' => ['public_id' => 'w-2', 'name' => 'Zweitling', 'punkte' => 3, 'geometrie' => [[3.0, 4.0]]],
    ],
    // Ungehakt -- das ist tragend fuer den nur_ungehakt-Test unten.
    'selected' => 0,
]);

$erweitert = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($erweitert['gesamt'] === $liste['gesamt'] + 1,
    'die Vorbedingung: genau EIN neues Objekt (Vielarm), ' . $erweitert['gesamt'] . ' gegen ' . $liste['gesamt']);
$vielarm = null;
foreach ($erweitert['objekte'] as $o) {
    if ($o['name'] === 'Vielarm' || $o['key'] === 'ggp:Gewaesser:Fluss:Garetien:Vielarm') {
        $vielarm = $o;
    }
}
assert($vielarm !== null, 'Vielarm muss als EIN Objekt mit zwei Abschnitten in der Liste stehen');
assert(count($vielarm['abschnitte']) === 2, 'Vielarm muss beide Abschnitte tragen: ' . count($vielarm['abschnitte']));
$pruefungen += 3;

// --- `nur_mehrteilig`: nur Vielarm hat mehr als einen Abschnitt.
$mehrteilig = avesmapsGaretienArbeitsliste($pdo, 1, ['nur_mehrteilig' => true]);
assert(count($mehrteilig['objekte']) > 0, 'der Mehrteilig-Filter darf nicht alles wegfiltern');
assert(count($mehrteilig['objekte']) < count($erweitert['objekte']),
    'der Mehrteilig-Filter hat gar nichts weggenommen: ' . count($mehrteilig['objekte'])
    . ' gegen ' . count($erweitert['objekte']));
assert(count($mehrteilig['objekte']) === 1 && $mehrteilig['objekte'][0]['name'] === 'Vielarm',
    'genau Vielarm haette mehr als einen Abschnitt bestehen duerfen: '
    . json_encode(array_column($mehrteilig['objekte'], 'name')));
$pruefungen += 3;

// --- `nur_ungehakt`: mindestens ein Item nicht angehakt. Vielarm (ein Item ungehakt), Alke (ihr
// Geometrie-Item ist IMMER ungehakt) und Seitenarm (Zufluss startet ungehakt) muessen durch;
// Gardel/Muehlsee (voll angehakt) und die item-losen Llavari/Insel muessen herausfallen.
$ungehakt = avesmapsGaretienArbeitsliste($pdo, 1, ['nur_ungehakt' => true]);
$ungehaktNamen = array_column($ungehakt['objekte'], 'name');
assert(count($ungehakt['objekte']) > 0 && count($ungehakt['objekte']) < count($erweitert['objekte']),
    'der Ungehakt-Filter muss etwas durchlassen UND etwas wegnehmen: '
    . count($ungehakt['objekte']) . ' gegen ' . count($erweitert['objekte']));
assert(in_array('Vielarm', $ungehaktNamen, true) && in_array('Alke', $ungehaktNamen, true),
    'ein Objekt mit mindestens einem ungehakten Item muss durchkommen: ' . json_encode($ungehaktNamen));
assert(!in_array('Gardel', $ungehaktNamen, true) && !in_array('Muehlsee', $ungehaktNamen, true)
    && !in_array('Mühlsee', $ungehaktNamen, true),
    'ein VOLL angehaktes Objekt darf nicht durchkommen: ' . json_encode($ungehaktNamen));
assert(!in_array('Llavari', $ungehaktNamen, true),
    'ein Objekt OHNE Item hat kein Haekchen zu setzen und faellt bei nur_ungehakt heraus: '
    . json_encode($ungehaktNamen));
$pruefungen += 4;

// --- `stand`: 'offen' laesst nur Objekte OHNE uebernommenes/abgelehntes Item durch.
//
// 🔴 RULING R1 (Aufgabe 1, 29.08.2026): ein angehaktes Item verschiebt den Stand NICHT mehr --
// „Markieren aendert nichts" (Owner). Ohne eine ECHTE Uebernahme haette dieser Standfilter an
// der Fixture nichts mehr auszuschliessen: alle sieben Objekte waeren 'offen'. Die Alke bekommt
// deshalb direkt ein `apply_state='done'` (der echte Uebernahme-Weg ist Aufgabe 15/16;
// avesmapsGaretienListeObjektStand liest nur das Feld, der direkte Weg genuegt hier).
$pdo->exec(
    "UPDATE sync_plan_item SET apply_state = 'done'"
    . " WHERE entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke%'"
);
$offenGefiltert = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'offen']);
foreach ($offenGefiltert['objekte'] as $o) {
    assert($o['stand'] === 'offen', 'der Standfilter laesst ' . $o['stand'] . ' durch');
}
assert(count($offenGefiltert['objekte']) > 0 && count($offenGefiltert['objekte']) < count($erweitert['objekte']),
    'der Standfilter muss etwas durchlassen UND etwas wegnehmen: '
    . count($offenGefiltert['objekte']) . ' gegen ' . count($erweitert['objekte']));
assert(!in_array('Alke', array_column($offenGefiltert['objekte'], 'name'), true),
    'die uebernommene Alke darf im Offen-Filter nicht mehr auftauchen');
// Die DIFFERENZ zur alten Fassung dieses Tests: Vielarm traegt ein angehaktes Item (w-1,
// selected=1), bleibt aber 'offen' -- ein Haekchen ist eine Markierung, kein Stand.
assert(in_array('Vielarm', array_column($offenGefiltert['objekte'], 'name'), true),
    'Vielarm traegt ein angehaktes Item, bleibt aber offen (Owner: „Markieren aendert nichts")');
$pruefungen += 3;

// --- `versatz`: blaettert, ohne die Gesamtzahl zu veraendern.
$seite0 = avesmapsGaretienArbeitsliste($pdo, 1, ['versatz' => 0]);
$seite1 = avesmapsGaretienArbeitsliste($pdo, 1, ['versatz' => 1]);
assert($seite0['gesamt'] === $seite1['gesamt'], 'versatz darf die GESAMTZAHL nicht veraendern');
assert(count($seite0['objekte']) - count($seite1['objekte']) === 1,
    'versatz=1 muss genau EIN Objekt weniger liefern als versatz=0: '
    . count($seite0['objekte']) . ' gegen ' . count($seite1['objekte']));
assert($seite0['objekte'][0]['key'] !== $seite1['objekte'][0]['key'],
    'versatz=1 muss wirklich woanders anfangen, nicht denselben Kopf zeigen');
assert(array_slice($seite0['objekte'], 1) == $seite1['objekte'],
    'versatz=1 muss exakt der Rest von versatz=0 sein -- keine andere Reihenfolge');
$pruefungen += 4;

// --- Ein zweiter Bau (derselbe Bestand) veraendert die Zahlen nicht -- kein Seiteneffekt beim
// wiederholten Lesen.
$zweitesMal = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($zweitesMal['gesamt'] === $erweitert['gesamt'], 'ein zweites Lesen darf die Zahlen nicht verschieben');
$pruefungen++;


// ---------------------------------------------------------------------------------------------
// 💣 DIE LAUFZEILE UND DIE REITER MUESSEN DIESELBEN OBJEKTE ZAEHLEN.
//
// Beide entstehen in DERSELBEN Schleife, beide hinter einem `isset(...)`-Riegel -- ein Urteil
// ohne Bilanz-Eimer faellt also aus der Laufzeile heraus und bleibt in den Reitern stehen.
// Genau das ist am 29.08.2026 live passiert: der Abgleich schreibt `widerspricht`, die Eimer
// heissen `widerspruch`. Der Owner sah „239 Zeilen" ueber Reitern, die zusammen 288 ergaben.
//
// ⚠️ Gemessen wird die BILANZ GEGEN DIE REITER, nicht ein einzelner Wert. Eine Zusicherung auf
// „widerspruch === 1" haette den naechsten Schreibfehler in einem anderen Eimer nicht gesehen.
$widerspruchZeile = [
    'run_id' => 1, 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 901,
    'typ' => 'Fluss', 'namensraum' => 'Fluss', 'artikel' => 'Streitwasser', 'anzeige' => 'Streitwasser',
    'lodmin' => '4', 'lodmax' => '14', 'extra' => '', 'geo_art' => 'line',
    'geo' => '100 200 110 210', 'roh' => '', 'urteil' => 'widerspricht',
    'grund' => 'Artikel trifft, aber die Geometrie liegt woanders',
];
$spalten = implode(', ', array_keys($widerspruchZeile));
$platz = ':' . implode(', :', array_keys($widerspruchZeile));
$pdo->prepare("INSERT INTO garetien_import_row ({$spalten}) VALUES ({$platz})")->execute($widerspruchZeile);

$mitWiderspruch = avesmapsGaretienArbeitsliste($pdo, 1, []);
$bilanzSumme = array_sum($mitWiderspruch['bilanz']);
// 🔴 OHNE 'vorgemerkt': RULING R1 macht sie zu einer sich UEBERLAPPENDEN Zaehlung (siehe oben) --
// sie in diese Summe mitzunehmen zaehlte jedes angehakte, aber sonst offene Objekt DOPPELT und
// liesse die Probe falsch anschlagen, obwohl kein Urteil fehlt.
$reiterSumme = $mitWiderspruch['reiter']['offen'] + $mitWiderspruch['reiter']['abgelehnt']
    + $mitWiderspruch['reiter']['uebernommen'];
assert(
    $bilanzSumme === $reiterSumme,
    'die Laufzeile zaehlt ' . $bilanzSumme . ' Objekte, die Reiter ' . $reiterSumme
    . ' -- ein Urteil ohne Bilanz-Eimer faellt aus der Laufzeile heraus'
);
$pruefungen++;

assert(
    $mitWiderspruch['bilanz']['widerspruch'] >= 1,
    'die Staging-Schreibweise `widerspricht` muss als `widerspruch` ankommen, sonst ist das Objekt '
    . 'in Bilanz, Filter UND Zeilenbeschriftung unsichtbar'
);
$pruefungen++;

// ---------------------------------------------------------------------------------------------
// FIX-RUNDE 1 ZU AUFGABE 3 (Sicht-Tafel): `kind` muss in der Nutzlast des Listenbauers ankommen.
//
// 🔴 Gemessen wird am ERGEBNIS von avesmapsGaretienArbeitsliste, nicht am Quelltext -- ein
// `str_contains($quelltext, "'kind'")` waere Vakuum, wenn das Feld irgendwo anders zugewiesen und
// nie erreicht wuerde. `garetien-plan.php` schreibt `kind` laengst in `after` (Zeile ~145); bis zu
// diesem Fix kam es nie am Client an, weil `avesmapsGaretienArbeitsliste` es nirgends abgriff --
// ein See MIT Vorschlag landete deshalb in der Sicht-Tafel im WEG-Zweig und bekam einen
// Tokennamen, den es nicht gibt (`--color-path-see`): der See wurde lautlos gar nicht gezeichnet.
// Owners eigenes Beispiel fuer dieses Werkzeug ist der Kraehensee -- deshalb heisst die Fixture so.
//
// ⚠️ Dieser Block steht bewusst GANZ AM ENDE: jeder fruehere Abschnitt vergleicht Objektzahlen aus
// VOR diesem `$planRunId` gezogenen Schnappschuessen (`$erweitert`, `$mehrteilig`, `$ungehakt`,
// `$offenGefiltert`) gegen eine FRISCHE Abfrage -- ein weiteres Objekt an dieser Stelle liesse
// genau diese Vorher/Nachher-Vergleiche falsch anschlagen (hier live aufgetreten, deshalb verschoben).
// ---------------------------------------------------------------------------------------------
avesmapsSyncPlanAddItem($pdo, $planRunId, [
    'entity_key' => 'ggp:Gewaesser:See:Garetien:Kraehensee|ergaenzung|a-1',
    'entity_public_id' => 'a-1',
    'change_type' => 'changed',
    'label' => 'Kraehensee · Quelle',
    'after' => [
        'typ' => 'See', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'anlass' => 'ergaenzung',
        'felder' => ['quelle'], 'name' => 'Kraehensee',
        // Genau die Form, die garetien-plan.php fuer ein Regionsziel baut (Zeile ~143-151):
        // `subtyp`/`kind` aus AVESMAPS_GARETIEN_TYP_MAP['See'], `geometry.type` = 'Polygon'.
        'subtyp' => 'see', 'kind' => 'topographie',
        'geometry' => ['type' => 'Polygon', 'coordinates' => [[[1.0, 2.0], [3.0, 4.0], [1.0, 2.0]]]],
        'abschnitt' => ['public_id' => 'a-1', 'name' => 'Kraehensee', 'punkte' => 4,
            'geometrie' => [[1.0, 2.0], [3.0, 4.0], [1.0, 2.0]]],
    ],
    'selected' => 1,
]);
$mitSee = avesmapsGaretienArbeitsliste($pdo, 1, []);
$kraehensee = null;
foreach ($mitSee['objekte'] as $o) {
    if ($o['key'] === 'ggp:Gewaesser:See:Garetien:Kraehensee') {
        $kraehensee = $o;
    }
}
assert($kraehensee !== null, 'der Kraehensee muss als eigenes Objekt in der Liste stehen');
assert($kraehensee['kind'] === 'topographie',
    'ein Regionsziel MIT Vorschlag muss `kind` in der Nutzlast tragen -- ohne dieses Feld faellt '
    . 'die Sicht-Tafel im Browser auf einen Tokennamen zurueck, den es nicht gibt: '
    . json_encode($kraehensee['kind'] ?? '(fehlt)'));
assert($kraehensee['subtyp'] === 'see', 'die Vorbedingung: `subtyp` muss ebenfalls ankommen');
$pruefungen += 2;

// Die DIFFERENZ: ein Weg-Ziel (Fluss/Bach/Strom) traegt `kind: null` in `after` -- das MUSS als
// LEERER String ankommen, nicht als das Wort "topographie" von der Fixture darueber. Vielarm
// (oben, Fluss) traegt in seinen beiden Items gar kein `kind` -- genau der reale Fall (Weg-Ziele
// haben laut AVESMAPS_GARETIEN_TYP_MAP immer `kind: null`, und ein fehlender Schluessel verhaelt
// sich beim `?? ''` genauso wie ein expliziter `null`-Wert).
assert(($vielarm['kind'] ?? '(fehlt ganz)') === '',
    'ein Weg-Ziel ohne `kind` darf nicht das `kind` eines anderen Objekts erben: '
    . json_encode($vielarm['kind'] ?? '(fehlt ganz)'));
$pruefungen++;

// Und ein Objekt OHNE Item (kein `after`) traegt `kind` als leeren String, genau wie `subtyp` --
// dieselbe Auskunft: „ohne Vorschlag wissen wir nicht, was daraus wuerde".
assert(($nachName['Llavari']['kind'] ?? '(fehlt ganz)') === '',
    'ein Objekt ohne Item muss `kind` als leeren String tragen, nicht fehlen lassen: '
    . json_encode($nachName['Llavari']['kind'] ?? '(fehlt ganz)'));
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
