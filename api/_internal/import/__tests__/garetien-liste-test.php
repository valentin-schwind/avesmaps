<?php

declare(strict_types=1);

// Die Arbeitsliste des Fensters: EINE Zeile je Objekt, ihre Items daran -- und die Zeilen, die
// gar keinen Vorschlag erzeugen (Aufgabe 6: "deckt sich" ohne Ergaenzung, "uebersprungen"),
// trotzdem sichtbar. Genau das ist der Zweck von Aufgabe 6.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-test.php

require_once __DIR__ . '/../garetien-liste.php';
// ⚠️ Fuer den Abschnitt „eine Uebernahme ueberlebt Holen & Rechnen" ganz unten -- er nimmt wirklich
// etwas an, statt den Zustand von Hand in die Tabelle zu schreiben. Nur so faellt auf, wenn der
// dauerhafte Vermerk am Schreibweg haengenbleibt statt in sync_decision zu landen.
require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

// ---------------------------------------------------------------------------------------------
// avesmapsGaretienListeGeometriePunkte ist eine REINE Funktion (kein PDO) -- ihr Vertrag: IMMER
// eine Liste von [x,y]-Paaren. Fehlermeldung vom 30.08.2026: ein Point lieferte das nackte Paar
// zurueck statt einer Liste MIT einem Paar, und der Browser hielt die beiden Zahlen x und y fuer
// zwei einzelne Punkte ohne `.length` -- "keine Geometrie fuer das Objekt".
assert(
    avesmapsGaretienListeGeometriePunkte(['type' => 'Point', 'coordinates' => [5.0, 7.0]]) === [[5.0, 7.0]],
    'ein Point mit [x,y] muss eine Liste MIT EINEM Paar ergeben, nicht das nackte Paar'
);
assert(
    avesmapsGaretienListeGeometriePunkte(['type' => 'LineString', 'coordinates' => [[1.0, 2.0], [3.0, 4.0]]])
        === [[1.0, 2.0], [3.0, 4.0]],
    'ein LineString muss unveraendert durchgereicht werden (Gegenprobe: der Fix darf ihn nicht veraendern)'
);
assert(
    avesmapsGaretienListeGeometriePunkte(['type' => 'Polygon', 'coordinates' => [[[1.0, 2.0], [3.0, 4.0], [1.0, 2.0]]]])
        === [[1.0, 2.0], [3.0, 4.0], [1.0, 2.0]],
    'ein Polygon muss weiterhin seinen AEUSSEREN Ring liefern (Gegenprobe: der Fix darf ihn nicht veraendern)'
);
$pruefungen += 3;

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
// 🔴 Meldung B (30.08.2026): seither DREI Items -- Quelle-Luecke + Geometrie + das Zusatz-Item
// ("trotzdem neu anlegen", das JEDE deckt_sich-Zeile jetzt zusaetzlich mitbringt).
assert(count($nachName['Alke']['items']) === 3,
    'die Alke traegt ihre drei Items (Quelle-Luecke + Geometrie + Zusatz): '
    . count($nachName['Alke']['items']));
assert(isset($nachName['Llavari']), 'Llavari fehlt in der Liste');
// 🔴 Llavari stand auf dem Sammelartikel "Nachbarprovinzen" und war bis zum 30.08.2026
// uebersprungen. Der Riegel ist auf Owner-Entscheid gefallen; die Zeile traegt jetzt ein echtes
// Urteil und einen Vorschlag wie jede andere.
assert($nachName['Llavari']['urteil'] !== 'uebersprungen',
    'der ehemalige Sammelartikel wird abgeglichen: ' . $nachName['Llavari']['urteil']);
assert($nachName['Llavari']['urteil'] !== '', 'und traegt ein echtes Urteil');
assert(!str_contains((string) $nachName['Llavari']['grund'], 'Sammelartikel'),
    'kein Sammelartikel-Grund mehr: ' . (string) $nachName['Llavari']['grund']);
// 🔴 UND ER HAT JETZT EINEN VORSCHLAG. Das ist die eigentliche Zusicherung: ein Objekt ohne Item
// waere zwar sichtbar, aber weiterhin nicht importierbar -- also genau der Zustand, den der
// Owner-Entscheid beseitigen sollte.
assert($nachName['Llavari']['items'] !== [],
    'der ehemalige Sammelartikel traegt einen Vorschlag und ist damit wirklich importierbar');
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
// 🔴 Meldung B (30.08.2026): die Alke traegt jetzt BEIDE Kategorien -- ihre Ergaenzungs- und
// Geometrie-Items sind "changed" (sie aendern etwas Bestehendes), ihr Zusatz-Item ("trotzdem neu
// anlegen") ist "new" (es legt an, es aendert nichts).
$alkeTypen = array_unique(array_column($nachName['Alke']['items'], 'change_type'));
sort($alkeTypen);
assert($alkeTypen === ['changed', 'new'],
    'die Ergaenzungs-/Geometrie-Items der Alke tragen "changed", ihr Zusatz-Item "new": '
    . implode(',', $alkeTypen));
$alkeZusatz = array_values(array_filter($nachName['Alke']['items'],
    static fn($i) => $i['anlass'] === 'zusatz'));
assert(count($alkeZusatz) === 1 && $alkeZusatz[0]['change_type'] === 'new',
    'genau ein Zusatz-Item, und es ist ein Neuzugang');
$pruefungen += 3;

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
// 🪤 Vakuum-Zusicherung vermeiden: importierbare Typen muessen eine LEERE, aber VORHANDENE
// Kategorie tragen -- ein fehlender Schluessel saehe im ?? -Rueckfall genauso aus wie eine
// leere Kategorie und bewiese damit nichts.
// 🔴 Die Insel ist seit der vollstaendigen Zuordnung (Aufgabe 12, Waelder) KEIN Beispiel fuer
// "uebersprungen" mehr -- sie ist jetzt `topographie/insel` und liefert etwas, wie Bach/Fluss.
// Die Gegenprobe gegen einen WIRKLICH uebersprungenen Typ folgt weiter unten, GANZ AM ENDE der
// Datei (derselbe Grund wie beim Kraehensee-Block dort: ein neues Objekt an dieser Stelle liesse
// die Vorher/Nachher-Vergleiche der folgenden Abschnitte falsch anschlagen).
assert(array_key_exists('Bach', $liste['facetten']['typ_kategorie'])
    && $liste['facetten']['typ_kategorie']['Bach'] === '',
    'ein importierbarer Typ traegt eine LEERE Kategorie, keine fehlende');
assert(array_key_exists('Fluss', $liste['facetten']['typ_kategorie'])
    && $liste['facetten']['typ_kategorie']['Fluss'] === '',
    'und ein zweiter importierbarer Typ, gegen Zufallsgleichheit');
$pruefungen += 2;

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
// die Alke traegt drei rohe sync_plan_item-Zeilen (Quelle-Luecke + Geometrie-Angebot + seit
// Meldung B das Zusatz-Item) unter EINEM Schluessel -- gezaehlt direkt in der Datenbank, nicht
// nur an der zusammengefassten Liste.
$roheItemZahlAlke = (int) $pdo->query(
    "SELECT COUNT(*) FROM sync_plan_item WHERE entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke%'"
)->fetchColumn();
assert($roheItemZahlAlke === 3, 'die Vorbedingung der Gruppierung: drei rohe Items fuer die Alke, '
    . $roheItemZahlAlke . ' gefunden');
assert(count($nachName['Alke']['items']) === $roheItemZahlAlke,
    'die Gruppierung muss alle drei rohen Items unter einem Objekt zusammenfassen');
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
        'felder' => ['name', 'quelle'], 'name' => 'Vielarm', 'ziel' => 'path',
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
        // `subtyp`/`kind`/`ziel` aus AVESMAPS_GARETIEN_TYP_MAP['See'], `geometry.type` = 'Polygon'.
        'subtyp' => 'see', 'kind' => 'topographie', 'ziel' => 'region',
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
// 🔴 AUFGABE „Eingefuegt wird": dieselbe Lehre wie bei `kind` -- `ziel` (path|region|location|
// label) steht seit dem Planbau in `after`, kam aber nie am Client an. Die Einzelansicht braucht
// es, um zu wissen, welche Vorschau (Flaeche/Beschriftung/Ort) sie zeigen darf.
assert($kraehensee['ziel'] === 'region',
    'ein Regionsziel MIT Vorschlag muss `ziel` in der Nutzlast tragen: '
    . json_encode($kraehensee['ziel'] ?? '(fehlt)'));
$pruefungen += 3;

// Dieselbe DIFFERENZ wie bei `kind`: ein Weg-Ziel traegt sein EIGENES `ziel` ('path'), nicht das
// der Fixture darueber ('region') -- sonst waere es nur ein zweiter Test fuer denselben Wert.
assert($vielarm['ziel'] === 'path',
    'ein Weg-Ziel muss sein eigenes `ziel` tragen, nicht das eines anderen Objekts: '
    . json_encode($vielarm['ziel'] ?? '(fehlt ganz)'));
$pruefungen++;

// Und ein Objekt OHNE Item traegt `ziel` als leeren String, genau wie `kind`/`subtyp`.
// 🪤 HIER STAND „Llavari", und das ging am 30.08.2026 kaputt -- nicht der Test, sondern sein
// BEISPIEL: Llavari stand auf dem Sammelartikel „Nachbarprovinzen" und hatte deshalb keinen
// Vorschlag. Seit der Riegel gefallen ist, hat es einen. Das Beispiel ist jetzt „Aventurien"
// (Typ `Kontinent`, kein Gegenstueck) -- ein Grund, der nichts mit Gebietsgrenzen zu tun hat und
// deshalb nicht dieselbe Wanderung mitmacht.
assert(($nachName['Aventurien']['items'] ?? null) === [],
    'die Vorbedingung: dieses Objekt hat wirklich keinen Vorschlag');
assert(($nachName['Aventurien']['ziel'] ?? '(fehlt ganz)') === '',
    'ohne Vorschlag gibt es kein `ziel` zu behaupten: '
    . json_encode($nachName['Aventurien']['ziel'] ?? '(fehlt ganz)'));
$pruefungen++;

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

// --- 🔴 DER ARTIKEL-LINK ZEIGT AUF DEN ARTIKEL, auch bei einem Objekt OHNE Item. Die Metazeile
// des Fensters beschriftet ihn mit dem ARTIKELNAMEN (garetienDetailMetaMarkup), also muss er
// dorthin fuehren. Bis zum 31.08.2026 zeigte er auf `…/Avesmaps_<Artikelname>` -- eine Seite, die
// es nicht gibt (live gemessen HTTP 404), und genau deshalb musste der Owner den Artikel zu
// Praioslob zufaellig entdecken, statt ihn anzuklicken.
// 💣 ZWEI ERZEUGER dieser Zeile: der Item-Pfad und der ohne Item. Der Item-Pfad ist in
// garetien-abschnitte-vollstaendig-test.php belegt; das hier ist der andere -- ohne ihn bleibt
// genau die Haelfte ungeprueft, in der die Objekte ohne Vorschlag stehen.
assert(str_contains((string) ($nachName['Llavari']['wiki_url'] ?? ''), '/index.php/'),
    'der Artikel-Link eines Objekts ohne Item zeigt auf den Artikel: '
    . var_export($nachName['Llavari']['wiki_url'] ?? null, true));
assert(!str_contains((string) ($nachName['Llavari']['wiki_url'] ?? ''), 'Avesmaps_'),
    'und NICHT auf die Export-Arbeitsseite: ' . var_export($nachName['Llavari']['wiki_url'] ?? null, true));
$pruefungen += 2;

// ---------------------------------------------------------------------------------------------
// Owner-Meldung 29.08.2026, Nachtrag zu Aufgabe 11: `facetten.typ_kategorie` muss einen WIRKLICH
// uebersprungenen Typ als solchen zeigen. Die Insel (weiter oben) ist seit der vollstaendigen
// Zuordnung (Aufgabe 12, Waelder/Gelaendeformen) kein Beispiel mehr -- eingesetzt wird deshalb ein
// Typ, der es (Stand 29.08.2026) noch ist: 'Stadtviertel' steht explizit in
// AVESMAPS_GARETIEN_OHNE_GEGENSTUECK. Die vormals dritte Kategorie 'spaetere_stufe' gibt es nicht
// mehr (siehe garetien-abgleich.php) -- 'ohne_gegenstueck' und 'unbekannt' sind die einzigen zwei.
//
// ⚠️ Auch DIESER Block steht bewusst GANZ AM ENDE, aus demselben Grund wie der Kraehensee-Block
// oben: ein weiteres Objekt an frueherer Stelle liesse die Vorher/Nachher-Vergleiche der
// vorangehenden Abschnitte falsch anschlagen.
$stadtviertelZeile = [
    'run_id' => 1, 'wiki' => 'ggp', 'ebene' => 'Ortschaften_1', 'zeile_nr' => 902,
    'typ' => 'Stadtviertel', 'namensraum' => 'Garetien', 'artikel' => 'Nordend', 'anzeige' => 'Nordend',
    'lodmin' => '4', 'lodmax' => '14', 'extra' => '', 'geo_art' => 'koordinaten',
    'geo' => '5000 5000', 'roh' => '', 'urteil' => 'uebersprungen',
    'grund' => 'Typ "Stadtviertel" hat bei uns kein Gegenstueck',
];
$stadtviertelSpalten = implode(', ', array_keys($stadtviertelZeile));
$stadtviertelPlatz = ':' . implode(', :', array_keys($stadtviertelZeile));
$pdo->prepare("INSERT INTO garetien_import_row ({$stadtviertelSpalten}) VALUES ({$stadtviertelPlatz})")
    ->execute($stadtviertelZeile);

$mitStadtviertel = avesmapsGaretienArbeitsliste($pdo, 1, []);
// 🪤 Vakuum-Zusicherung vermeiden: der Schluessel muss VORHANDEN sein (nicht nur der `??`-Rueckfall
// zufaellig denselben Wert liefern) -- deshalb erst `array_key_exists`, dann der Wert.
assert(array_key_exists('Stadtviertel', $mitStadtviertel['facetten']['typ_kategorie']),
    'ein uebersprungener Typ muss ueberhaupt in der Kategorie-Facette stehen');
assert($mitStadtviertel['facetten']['typ_kategorie']['Stadtviertel'] === 'ohne_gegenstueck',
    'Stadtviertel hat bei uns kein Gegenstueck: ' . $mitStadtviertel['facetten']['typ_kategorie']['Stadtviertel']);
$pruefungen += 2;


// --- 🔴 DAS BACH-HAEKCHEN KOMMT AM CLIENT AN (Owner 30.08.2026). Dieselbe Lehre wie bei `kind`
// und `ziel` darueber: das Feld steht seit dem Planbau in `after`, und wenn es hier herausfaellt,
// zeigt der Kasten „Eingefuegt wird" einen Bach als gewoehnlichen Flussweg -- samt zwei
// vorgehakten Verkehrsmitteln, die der Server nie speichern wird. Eine Falschaussage ueber die
// naechste Handlung, und genau dagegen ist dieses Fenster gebaut.
avesmapsSyncPlanAddItem($pdo, 1, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Probebach',
    'entity_public_id' => null,
    'change_type' => 'new',
    'label' => 'Probebach',
    'after' => [
        'typ' => 'Bach', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'name' => 'Probebach',
        'subtyp' => 'Flussweg', 'kind' => null, 'ziel' => 'path', 'is_bach' => true,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[1.0, 2.0], [3.0, 4.0]]],
    ],
    'selected' => 1,
]);
// 🪤 Der Vergleichsweg wird EIGENS angelegt, statt aus der Liste gegriffen: beim ersten Bau nahm
// die Gegenprobe „der erste Weg, der nicht der Probebach ist" -- und traf ein Objekt, das selbst
// `is_bach` trug. Ein Gegenbeispiel, das man sucht statt es hinzulegen, ist keins.
avesmapsSyncPlanAddItem($pdo, 1, [
    'entity_key' => 'ggp:Gewaesser:Fluss:Garetien:Probefluss',
    'entity_public_id' => null,
    'change_type' => 'new',
    'label' => 'Probefluss',
    'after' => [
        'typ' => 'Fluss', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'name' => 'Probefluss',
        'subtyp' => 'Flussweg', 'kind' => null, 'ziel' => 'path',
        'geometry' => ['type' => 'LineString', 'coordinates' => [[5.0, 6.0], [7.0, 8.0]]],
    ],
    'selected' => 1,
]);

$mitBach = avesmapsGaretienArbeitsliste($pdo, 1, []);
$probebach = null;
$probefluss = null;
foreach ($mitBach['objekte'] as $o) {
    if ($o['key'] === 'ggp:Gewaesser:Bach:Garetien:Probebach') { $probebach = $o; }
    if ($o['key'] === 'ggp:Gewaesser:Fluss:Garetien:Probefluss') { $probefluss = $o; }
}
assert($probebach !== null, 'der Probebach muss in der Liste stehen');
assert($probebach['subtyp'] === 'Flussweg', 'er ist ein Flussweg -- „Bach" ist kein Wegtyp');
assert(($probebach['is_bach'] ?? null) === true,
    'und `is_bach` muss in der Nutzlast ankommen: ' . json_encode($probebach['is_bach'] ?? '(fehlt)'));
$pruefungen += 3;

// ⚠️ Gegenprobe: derselbe Wegtyp, dieselbe Nutzlast, nur ohne Haekchen -- er muss `false` tragen.
assert($probefluss !== null, 'der Vergleichs-Fluss muss ebenfalls in der Liste stehen');
assert($probefluss['subtyp'] === 'Flussweg', 'derselbe Wegtyp wie der Bach -- sonst vergleicht das nichts');
assert(($probefluss['is_bach'] ?? null) === false,
    'ein Fluss ohne Haekchen traegt false: ' . json_encode($probefluss['is_bach'] ?? '(fehlt)'));
$pruefungen += 3;


// 🔴 UND EIN ALTER PLANEINTRAG (ohne `is_bach`) muss ebenso als Bach ankommen -- der Owner-Befund
// vom 30.08.2026: sein Lauf vom Vortag zeigte fuer einen Bach weiter zwei angehakte
// Verkehrsmittel. Der Eintrag hier traegt NUR `typ`, kein Haekchen; das ist der ganze Punkt.
avesmapsSyncPlanAddItem($pdo, 1, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Altbach',
    'entity_public_id' => null,
    'change_type' => 'new',
    'label' => 'Altbach',
    'after' => [
        'typ' => 'Bach', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'name' => 'Altbach',
        'subtyp' => 'Flussweg', 'kind' => null, 'ziel' => 'path',
        'geometry' => ['type' => 'LineString', 'coordinates' => [[9.0, 9.0], [11.0, 11.0]]],
    ],
    'selected' => 1,
]);
$mitAlt = avesmapsGaretienArbeitsliste($pdo, 1, []);
$altbach = null;
foreach ($mitAlt['objekte'] as $o) {
    if ($o['key'] === 'ggp:Gewaesser:Bach:Garetien:Altbach') { $altbach = $o; }
}
assert($altbach !== null, 'der Altbach muss in der Liste stehen');
assert(($altbach['is_bach'] ?? null) === true,
    'ein Planeintrag OHNE gespeichertes Haekchen wird ueber die Zuordnungstabelle als Bach erkannt: '
    . json_encode($altbach['is_bach'] ?? '(fehlt)'));
$pruefungen += 2;

// --- 🔴 DIE KOORDINATEN DER ANZEIGE SIND GERUNDET (Owner-Messung 30.08.2026: Geometrie ist die
// HAELFTE der Nutzlast -- 0,67 von 1,35 MB je 500 Objekte, 18.748 Punkte). Der Umrechner rundet
// nie, PHP schreibt daraus `554.095820893`; auf 0..1024 Karteneinheiten a drei Meilen ist die
// neunte Nachkommastelle 4,8 Mikrometer. Drei Stellen sind 4,8 Meter.
$gerundet = avesmapsGaretienListePunkteRunden([[554.095820893, 538.54949238], [1.0, 2.0]]);
assert($gerundet === [[554.096, 538.549], [1.0, 2.0]],
    'die Anzeige-Punkte werden auf drei Stellen gerundet: ' . json_encode($gerundet));
$pruefungen++;

// ⚠️ Kaputte Punkte fallen heraus, statt als [0,0] durchzurutschen -- ein Punkt am Kartenursprung
// waere eine erfundene Aussage, ein fehlender Punkt ist ehrlich.
assert(avesmapsGaretienListePunkteRunden([[1.0], 'kaputt', [1.0, 2.0, 3.0]]) === [[1.0, 2.0]],
    'zu kurze und nicht-Array-Punkte fallen heraus, ein dritter Wert wird ignoriert');
$pruefungen++;

// 🔴 UND SIE STEHT AM AUSGANG DER LISTE, NICHT IM UMRECHNER. avesmapsGaretienZeilePunkte wird auch
// vom Uebersprung-Riegel und der Umkreissuche gelesen; eine Rundung dort raendete mit, was in die
// KARTE geschrieben wird. Der Beleg: derselbe Rohpunkt kommt aus dem Umrechner UNGERUNDET.
$roh = avesmapsGaretienNachAvesmaps(20000.0, 10300.0);
assert($roh[0] !== round($roh[0], 3) || $roh[1] !== round($roh[1], 3),
    'der Umrechner selbst rundet NICHT -- sonst belegt die Zeile darueber nichts ueber den Ort '
    . 'der Rundung: ' . json_encode($roh));
$pruefungen++;


// 💣 UND DIE VERDRAHTUNG, NICHT NUR DIE FUNKTION. Eine Mutationsprobe hat gezeigt: die reine
// Funktion oben laesst sich tadellos pruefen, waehrend der Ausgang der Objektliste sie gar nicht
// ruft -- und dann reist jede Koordinate weiter mit dreizehn Zeichen. Deshalb geht hier ein Objekt
// mit ROHEN Koordinaten durch die echte Arbeitsliste.
avesmapsSyncPlanAddItem($pdo, 1, [
    'entity_key' => 'ggp:Gewaesser:Fluss:Garetien:Rundungsprobe',
    'entity_public_id' => null,
    'change_type' => 'new',
    'label' => 'Rundungsprobe',
    'after' => [
        'typ' => 'Fluss', 'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'name' => 'Rundungsprobe',
        'subtyp' => 'Flussweg', 'kind' => null, 'ziel' => 'path',
        'geometry' => ['type' => 'LineString', 'coordinates' => [
            [554.095820893, 538.54949238], [554.4331457823, 538.220802449],
        ]],
    ],
    'selected' => 1,
]);
$mitRundung = avesmapsGaretienArbeitsliste($pdo, 1, []);
$probe = null;
foreach ($mitRundung['objekte'] as $o) {
    if ($o['key'] === 'ggp:Gewaesser:Fluss:Garetien:Rundungsprobe') { $probe = $o; }
}
assert($probe !== null, 'die Rundungsprobe muss in der Liste stehen');
assert($probe['geometrie'] === [[554.096, 538.549], [554.433, 538.221]],
    'die Liste gibt GERUNDETE Punkte aus -- sonst ruft ihr Ausgang die Rundung gar nicht: '
    . json_encode($probe['geometrie']));
$pruefungen += 2;
// --- 🔴 DIE SEITENGROESSE (Owner 30.08.2026: „setz das limit auf 10000"). Sie hat den Server nie
// geschuetzt -- avesmapsGaretienArbeitslisteObjekte baut ohnehin ALLE Objekte und schneidet erst
// danach zu; Blaettern kostete deshalb je Seite den vollen Aufbau.
assert(AVESMAPS_GARETIEN_LISTE_MAX === 10000,
    'die Seitengroesse traegt den vom Owner gesetzten Wert: ' . AVESMAPS_GARETIEN_LISTE_MAX);
$pruefungen++;
// =================================================================================================
// 🔴 EINE UEBERNAHME UEBERLEBT „HOLEN & RECHNEN" (Owner-Befund 30.08.2026).
//
// Woertlich: „das problem ist, dass 'holen' die einträge / IDs in 'übernommen' killt" und „ich will
// die liste abarbeiten bis am ende alles entweder abgelehnt oder auf der karte und in 'übernommen'
// ist".
//
// 💣 DIE URSACHE WAR EINE ASYMMETRIE, und dieser Abschnitt misst genau sie:
//   Abgelehnt   -> sync_decision.declined_at  -> ueberlebt (funktionierte schon)
//   Uebernommen -> sync_plan_item.apply_state -> starb mit dem Lauf
// avesmapsSyncPlanSupersedeRuns legt den alten Lauf still; damit fiel die halbe Arbeit jedes Mal
// auf „Offen" zurueck, waehrend eine Ablehnung liegenblieb.
//
// ⚠️ GEPRUEFT WIRD DER VERMERK, NICHT DIE ANLAGE. Ein echtes avesmapsGaretienUebernehmen braeuchte
// die Karten-Schreibwege (avesmapsFeatureSourceUpsert ist MySQL-only und laeuft auf dieser Fixture
// nicht); die Frage hier ist aber eine andere -- ueberlebt der dauerhafte Vermerk den Laufwechsel?
// Dass die Uebernahme ihn ueberhaupt schreibt, sichert garetien-uebernahme-test.php.
// =================================================================================================
$pdoU = avesmapsGaretienPlanTestPdo();
avesmapsGaretienBaueSyncPlan($pdoU, 1);

$standVon = static function (PDO $pdo, string $name): string {
    foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
        if ($o['name'] === $name) { return (string) $o['stand']; }
    }

    return '(fehlt)';
};
$schluesselVon = static function (PDO $pdo, string $label): array {
    $stmt = $pdo->prepare('SELECT entity_key, change_type FROM sync_plan_item WHERE label LIKE :l LIMIT 1');
    $stmt->execute([':l' => $label . '%']);

    return (array) $stmt->fetch(PDO::FETCH_ASSOC);
};

// --- Vorbedingung: der Gardel ist offen.
assert($standVon($pdoU, 'Gardel') === 'offen', 'die Vorbedingung: der Gardel steht auf offen');
$pruefungen++;

// --- Der dauerhafte Vermerk, mit dem ECHTEN Schreiber der Uebernahme.
$gardel = $schluesselVon($pdoU, 'Gardel');
assert(($gardel['entity_key'] ?? '') !== '', 'das Gardel-Item muss auffindbar sein');
avesmapsSyncPlanRecordApplied($pdoU, AVESMAPS_GARETIEN_PLAN_KIND, (string) $gardel['entity_key'], 7,
    (string) $gardel['change_type']);
assert($standVon($pdoU, 'Gardel') === 'uebernommen', 'mit Vermerk steht er auf uebernommen');
$pruefungen += 2;

// --- 🔴 UND JETZT „HOLEN & RECHNEN": ein neuer Lauf, der den alten stilllegt.
avesmapsGaretienBaueSyncPlan($pdoU, 1);
assert($standVon($pdoU, 'Gardel') === 'uebernommen',
    'NACH dem Neurechnen steht er IMMER NOCH auf uebernommen -- das ist die ganze Zusicherung: '
    . $standVon($pdoU, 'Gardel'));
$pruefungen++;

// ⚠️ Gegenprobe: ein Objekt OHNE Vermerk ist danach weiterhin offen. Ohne sie belegte die Zeile
// darueber nur, dass nach einem Neurechnen alles „uebernommen" heisst.
assert($standVon($pdoU, 'Mühlsee') === 'offen',
    'ein Objekt ohne Vermerk bleibt offen: ' . $standVon($pdoU, 'Mühlsee'));
$pruefungen++;

// --- 🔴 DER NACHZUG fuer alles, was VOR dem 30.08.2026 uebernommen wurde: dort gibt es keinen
// Vermerk, wohl aber ein altes Item mit apply_state='done' -- und das ueberlebt, weil ein
// stillgelegter Lauf nicht geloescht wird.
$pdoU->exec("DELETE FROM sync_decision WHERE kind = 'garetien' AND applied_at IS NOT NULL");
$pdoU->prepare("UPDATE sync_plan_item SET apply_state = 'done' WHERE entity_key = :ek")
    ->execute([':ek' => (string) $gardel['entity_key']]);
// ⚠️ Die Vorbedingung des Nachzugs: OHNE Vermerk faellt er zurueck -- allerdings nur, wenn das
// Item nicht im AKTUELLEN Lauf steht (dort gilt schon `apply_state`). Deshalb erst einen neuen
// Lauf, der das done-Item stilllegt.
avesmapsGaretienBaueSyncPlan($pdoU, 1);
$pdoU->exec("DELETE FROM sync_decision WHERE kind = 'garetien' AND applied_at IS NOT NULL");
assert($standVon($pdoU, 'Gardel') === 'offen',
    'die Vorbedingung: ohne Vermerk faellt er zurueck auf offen -- genau der gemeldete Fehler');
$nachgetragen = avesmapsGaretienUebernahmenNachtragen($pdoU);
assert($nachgetragen >= 1, 'der Nachzug findet die alte Uebernahme: ' . $nachgetragen);
assert($standVon($pdoU, 'Gardel') === 'uebernommen', 'und stellt sie wieder her');
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen\n";
