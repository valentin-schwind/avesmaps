<?php

declare(strict_types=1);

/**
 * Der exakte Wiki-Kandidat der Ortsliste (Listensymbol ④) — und die eine Rechnung dahinter.
 *
 * 🔴 DIE ZUSICHERUNG, UM DIE ES HIER GEHT: „welchen Artikel beansprucht dieser Kartenname?" wird
 * an GENAU EINER Stelle beantwortet. Zwei Leser hängen daran:
 *
 *   • avesmapsWikiSettlementCollectConnectTargets — der Knopf „Alle eindeutigen verbinden"
 *   • avesmapsWikiSettlementListLocations         — das Listensymbol ④ (seit 17.08.2026)
 *
 * Wären es zwei Abschriften, könnte das Symbol einen Klick versprechen, den der Knopf nicht
 * ausführt — und niemand sähe den Unterschied, weil beide Seiten für sich plausibel aussehen.
 * 💣 Genau diese Fehlerklasse zieht sich durch diesen Zweig: ein Feld/eine Regel als Antwort auf
 * eine Frage lesen, die sie nicht beantwortet (`properties.wiki_url` beim Ort ist GERATEN — 97
 * Orte tragen so eine Adresse ohne jede Zuweisung; `citymap.map_url`; „Letzte Sync = LAUF").
 *
 * Der Test prüft das in beiden Richtungen:
 *   Teil 1 — die reine Rechnung, an Fällen aus dem Livebestand.
 *   Teil 2 — DER PARITÄTSLAUF gegen eine echte (SQLite-)Datenbank: der Sammler des Knopfes läuft
 *            unverändert, und seine Zielmenge muss zeichengleich der Kandidatenmenge sein, die die
 *            Liste aus denselben Zeilen rechnet.
 *   Teil 3 — die Bauform: es gibt keinen zweiten Rechner, und die Liste indiziert UNGEFILTERT.
 *
 * ⚠️ Kein SQL wurde für diesen Test verbogen (AGENTS.md §9, Fehler 1093): der Sammler fährt seine
 * Produktionsabfragen, sie sind reines ANSI-SQL und laufen auf beiden Motoren gleich.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/listensymbol-orte-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "die Zusicherungen waeren wirkungslos.\n"
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 "
        . "-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring fehlt -- avesmapsWikiSettlementBaseKey faltet damit die Schreibung.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../locations.php';
require_once __DIR__ . '/../settlements.php';

$pruefungen = 0;

// ================================================================ Teil 1: die reine Rechnung ===
// Namen aus der Messung vom 17.08.2026 (oeffentlicher Kartenpayload + Gegenprobe `action=search`).
$idx = avesmapsWikiSettlementTitleIndexFromTitles([
    'Burg Ambarnis',        // exakter, einziger Treffer -> Kandidat
    'Dommel',               // dito
    'Abagund (Siedlung)',   // NUR mit abgestreifter Begriffsklaerung erreichbar
    'Hohenstein',           // zweimal, ohne "(Siedlung)" -> mehrdeutig
    'Hohenstein (Burg)',
    'Trallestedt (Strasse)', // eine ausgeschlossene Bauwerksart -- steht trotzdem im Index
]);

assert(avesmapsWikiSettlementUniqueTitleFor('Burg Ambarnis', $idx) === 'Burg Ambarnis',
    'Der exakte, einzige Treffer ist der Kandidat.');
$pruefungen++;
// 💣 DER FALL, DER DIE OPTION `kandidat` IM BROWSER ERZWINGT. Der Server streift die
// Begriffsklaerung ab (avesmapsWikiSettlementBaseKey), avesmapsWikistatusSchluessel im Browser tut
// das NICHT. Wuerde der gefundene Titel als Ein-Eintrag-Katalog uebergeben statt als Befund, fiele
// er dort durch den exakten UND den unscharfen Test und stuende still als „nichts" da.
assert(avesmapsWikiSettlementUniqueTitleFor('Abagund', $idx) === 'Abagund (Siedlung)',
    '"Abagund" muss "Abagund (Siedlung)" finden -- die Begriffsklaerung wird abgestreift.');
$pruefungen++;
// 🔴 Mehrdeutig heisst KEIN Kandidat. „Ein Klick, und die Zuweisung steht" ist nur bei
// Eindeutigkeit wahr; ein Symbol auf einer mehrdeutigen Zeile verspraeche einen Klick, den weder
// der Knopf noch der Editor ausfuehren kann.
assert(avesmapsWikiSettlementUniqueTitleFor('Hohenstein', $idx) === '',
    'Zwei gleichnamige Titel ohne eindeutige "(Siedlung)"-Variante ergeben KEINEN Kandidaten.');
$pruefungen++;
assert(avesmapsWikiSettlementUniqueTitleFor('Aberode', $idx) === '',
    'Ein Name, den die Registry nicht kennt, ergibt keinen Kandidaten.');
$pruefungen++;
assert(avesmapsWikiSettlementUniqueTitleFor('', $idx) === '',
    'Ein leerer Name ergibt keinen Kandidaten -- sonst traefe er den leeren Schluessel.');
$pruefungen++;
// ⚠️ Und ein Name, der nur aus Satzzeichen besteht, ebenfalls nicht: avesmapsWikiSettlementBaseKey
// wirft alles Nicht-Alphanumerische weg und liefert dann ''.
assert(avesmapsWikiSettlementUniqueTitleFor('---', $idx) === '',
    'Ein Name ohne Buchstaben und Ziffern ergibt keinen Kandidaten.');
$pruefungen++;
// 💣 DER LEERE SCHLUESSEL DARF NIE TREFFEN, UND ZWAR AN BEIDEN ENDEN EINZELN. Der Bauer legt ihn
// gar nicht erst an (naechste Zusicherung), und der Sucher weist ihn zurueck -- zwei Riegel gegen
// dieselbe Tuer. 🪤 Der zweite sah beim Mutationslauf wie toter Code aus: ihn zu entfernen blieb
// gruen, WEIL der erste ihn deckte. Genau so wird ein Riegel „aufgeraeumt", und dann haengt alles
// daran, dass jeder kuenftige Aufrufer seinen Index mit demselben Bauer baut. Trifft der leere
// Schluessel, bekommt jeder namenlose Ort denselben Artikel angeboten.
assert(avesmapsWikiSettlementUniqueTitleFor('---', ['' => ['Irgendein Artikel' => true]]) === '',
    'Ein Name ohne Buchstaben und Ziffern darf auch dann nichts treffen, wenn ein Index einen '
    . 'leeren Schluessel fuehrt. Sonst beansprucht jeder namenlose Ort denselben Artikel.');
$pruefungen++;
assert(!isset(avesmapsWikiSettlementTitleIndexFromTitles(['---', '', '   '])['']),
    'Der Titelindex darf keinen leeren Schluessel anlegen.');
$pruefungen++;
// 💣 Der Index ist UNGEFILTERT. Er kennt auch Titel, die die „Fehlt"-Liste wegen ihrer Ortsklasse
// oder ihrer Bauwerksart nie zeigt -- weil der Sammler des Knopfes sie ebenfalls kennt. Wer hier
// vorfiltert, macht das Symbol strenger als den Knopf, den es ankuendigt.
assert(isset($idx[avesmapsWikiSettlementBaseKey('Trallestedt (Strasse)')]),
    'Der Titelindex nimmt JEDEN Registry-Titel auf, auch den einer ausgeschlossenen Bauwerksart.');
$pruefungen++;

// ============================================== Teil 2: der Paritaetslauf gegen die Datenbank ===
// 🔴 DIE EIGENTLICHE ZUSICHERUNG. Der Sammler laeuft UNVERAENDERT (seine zwei Abfragen sind reines
// ANSI-SQL), und die Kandidatenmenge der Liste wird aus DENSELBEN Zeilen gerechnet -- ueber
// dieselben zwei Funktionen. Beide Mengen muessen zeichengleich sein.
$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec('CREATE TABLE wiki_sync_pages (
    title TEXT NOT NULL,
    settlement_class TEXT NULL,
    wiki_url TEXT NULL,
    continent TEXT NULL,
    is_ruined INTEGER NULL,
    building_type TEXT NULL,
    coat_url TEXT NULL,
    standort TEXT NULL
)');
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL,
    name TEXT NOT NULL,
    feature_type TEXT NOT NULL,
    feature_subtype TEXT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    properties_json TEXT NULL
)');

// Die Registry. „Trallestedt (Strasse)" traegt eine ausgeschlossene Bauwerksart -- sie faellt aus
// der „Fehlt"-LISTE, aber nicht aus dem INDEX; genau daran haengt die Paritaet.
$seite = $pdo->prepare('INSERT INTO wiki_sync_pages (title, settlement_class, building_type, continent)
    VALUES (:t, :c, :b, :k)');
foreach ([
    ['Burg Ambarnis', 'gebaeude', 'Festung', 'Aventurien'],
    ['Dommel', 'dorf', '', 'Aventurien'],
    ['Abagund (Siedlung)', 'dorf', '', 'Aventurien'],
    ['Hohenstein', 'dorf', '', 'Aventurien'],
    ['Hohenstein (Burg)', 'gebaeude', 'Festung', 'Aventurien'],
    ['Trallestedt', 'gebaeude', 'Strasse', 'Aventurien'],
    ['A\'Sarar', 'stadt', '', 'Aventurien'],
] as [$t, $c, $b, $k]) {
    $seite->execute([':t' => $t, ':c' => $c, ':b' => $b, ':k' => $k]);
}

// Die Karte. Eine verbundene Zeile, ein Kreuzungsknoten, ein per Name ausgeschlossener Knoten und
// die Kandidaten.
$ort = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, is_active, properties_json)
    VALUES (:p, :n, \'location\', :s, :a, :j)');
$zugewiesen = json_encode(['wiki_settlement' => ['title' => 'A\'Sarar']], JSON_UNESCAPED_UNICODE);
foreach ([
    ['L1', 'A\'Sarar',       'stadt',    1, $zugewiesen],                       // verbunden -> nie Kandidat
    ['L2', 'Burg Ambarnis',  'gebaeude', 1, null],                              // Kandidat
    ['L3', 'Dommel',         'dorf',     1, null],                              // Kandidat
    ['L4', 'Abagund',        'dorf',     1, null],                              // Kandidat ueber die Begriffsklaerung
    ['L5', 'Hohenstein',     'dorf',     1, null],                              // mehrdeutig -> kein Kandidat
    ['L6', 'Aberode',        'dorf',     1, null],                              // unbekannt -> kein Kandidat
    ['L7', 'Trallestedt',    'dorf',     1, null],                              // Kandidat AUS DEM UNGEFILTERTEN INDEX
    ['L8', 'Kreuzung-17',    'kreuzung', 1, null],                              // Knoten, nie eine Zeile
    ['L9', 'Ochsenweide',    'dorf',     1, '{"wiki_no_article":true}'],        // Merker, aber trotzdem gerechnet
    ['LA', 'Alte Ruine',     'dorf',     0, null],                              // inaktiv -> gar nicht da
] as [$p, $n, $s, $a, $j]) {
    $ort->execute([':p' => $p, ':n' => $n, ':s' => $s, ':a' => $a, ':j' => $j]);
}

// (a) Der Knopf, unveraendert.
$ziele = avesmapsWikiSettlementCollectConnectTargets($pdo);
$vomKnopf = [];
foreach ($ziele as $ziel) {
    $vomKnopf[(string) $ziel['public_id']] = (string) $ziel['title'];
}
ksort($vomKnopf);

// (b) Die Liste. Nachgebildet ist hier NUR ihre Zeilenauswahl (auf der Karte, nicht verbunden) --
// die Rechnung selbst laeuft durch dieselben zwei Funktionen, die die Liste aufruft. Teil 3 unten
// haelt fest, dass sie das wirklich tut.
$listenIdx = avesmapsWikiSettlementTitleIndexFromTitles(array_column(
    $pdo->query('SELECT title FROM wiki_sync_pages ORDER BY title ASC')->fetchAll(), 'title'));
$vonDerListe = [];
foreach ($pdo->query("SELECT public_id, name, feature_subtype, properties_json FROM map_features
    WHERE feature_type='location' AND is_active=1 AND name<>'' ORDER BY name ASC")->fetchAll() as $zeile) {
    if ((string) $zeile['feature_subtype'] === 'kreuzung' || str_starts_with((string) $zeile['name'], 'Kreuzung')) {
        continue;
    }
    $eigenschaften = avesmapsWikiSyncDecodeJson($zeile['properties_json'] ?? null);
    $ws = $eigenschaften['wiki_settlement'] ?? null;
    if (is_array($ws) && !empty($ws['title'])) {
        continue;
    }
    $kandidat = avesmapsWikiSettlementUniqueTitleFor((string) $zeile['name'], $listenIdx);
    if ($kandidat !== '') {
        $vonDerListe[(string) $zeile['public_id']] = $kandidat;
    }
}
ksort($vonDerListe);

assert($vomKnopf === $vonDerListe,
    "Symbol und Knopf muessen dieselbe Menge meinen.\n  Knopf: " . json_encode($vomKnopf, JSON_UNESCAPED_UNICODE)
    . "\n  Liste: " . json_encode($vonDerListe, JSON_UNESCAPED_UNICODE)
    . "\n💣 Weichen sie ab, verspricht das Symbol einen Klick, den „Alle eindeutigen verbinden\" "
    . "nicht ausfuehrt -- oder es verschweigt einen, den es gaebe.");
$pruefungen++;

// …und die Menge ist nicht leer, sonst waere die Gleichheit oben wertlos.
assert(count($vomKnopf) === 4,
    'Vier Kandidaten erwartet (Burg Ambarnis, Dommel, Abagund, Trallestedt), gezaehlt: ' . count($vomKnopf));
$pruefungen++;
assert(array_keys($vomKnopf) === ['L2', 'L3', 'L4', 'L7'],
    'Namentlich: L2 Burg Ambarnis, L3 Dommel, L4 Abagund, L7 Trallestedt. Gefunden: '
    . implode(', ', array_keys($vomKnopf)));
$pruefungen++;
// 🔴 Der Merker `wiki_no_article` schliesst den Kandidaten SERVERSEITIG NICHT aus. Dass die
// Registry einen freien Titel kennt, ist eine Tatsache ueber die Daten; welche Form gewinnt,
// entscheidet der Zustandsrechner im Browser. Der Server traegt keine Rangfolge der Anzeige --
// und der Knopf kennt den Merker ebenfalls nicht, die Paritaet haengt also daran.
assert(!isset($vomKnopf['L9']) && !isset($vonDerListe['L9']),
    '„Ochsenweide" steht in der Registry gar nicht -- hier darf kein Kandidat entstehen.');
$pruefungen++;
// 💣 Und die Gegenprobe zur Ungefiltertheit: „Trallestedt" ist NUR ueber den ungefilterten Index
// erreichbar. Wuerde die Liste ihren Index hinter den Bauwerksart-Filter setzen, faende sie ihn
// nicht -- und die Zusicherung oben fiele um.
assert(($vonDerListe['L7'] ?? '') === 'Trallestedt',
    '„Trallestedt" traegt eine ausgeschlossene Bauwerksart und muss trotzdem Kandidat sein.');
$pruefungen++;

// ==================================================================== Teil 3: die Bauform ======
// 💣 Ein gruener Rechentest beweist nichts ueber einen Aufrufer, der die Rechnung nicht benutzt.
$roh = file_get_contents(__DIR__ . '/../settlements.php');
assert(is_string($roh) && $roh !== '', 'settlements.php ist nicht lesbar.');
$pruefungen++;
// 🪤 OHNE KOMMENTARE, und das ist beim Schreiben dieses Tests sofort schiefgegangen: die Warnung
// „ein Aufruf von avesmapsWikiSettlementTitleIndex($pdo) waere hier eine zweite Abfrage" steht als
// KOMMENTAR genau in der Funktion, die den Aufruf verbietet -- und liess die Zusicherung darunter
// rot werden. Ein Test, der Quelltext liest, muss Erklaerungen von Anweisungen trennen; sonst
// bestraft er die Begruendung, die er selbst verlangt.
$quelle = implode("\n", array_map(
    static fn(string $zeile): string => str_starts_with(ltrim($zeile), '//') ? '' : $zeile,
    preg_split('/\r?\n/', $roh) ?: []
));
$quelle = preg_replace('#/\*.*?\*/#s', '', $quelle) ?? $quelle;
assert(!str_contains($quelle, 'DIE ZWEITE HAELFTE DER EINEN RECHNUNG'),
    'Die Kommentar-Entfernung greift nicht -- die strukturellen Zusicherungen unten pruefen dann '
    . 'Erklaerungen statt Anweisungen.');
$pruefungen++;

$rumpf = static function (string $name) use ($quelle): string {
    $start = strpos($quelle, 'function ' . $name . '(');
    assert($start !== false, 'Funktion ' . $name . ' ist nicht auffindbar.');
    $ende = strpos($quelle, "\n}\n", $start);
    return substr($quelle, $start, ($ende === false ? strlen($quelle) : $ende) - $start);
};

// 🔴 GENAU EIN RECHNER. avesmapsWikiSettlementResolvePreferredTitle darf nur aus
// avesmapsWikiSettlementUniqueTitleFor gerufen werden -- jeder weitere Aufruf ist eine zweite
// Rechnung, und die naechste Aenderung wandert dann nur in eine der beiden.
$aufrufe = substr_count($quelle, 'avesmapsWikiSettlementResolvePreferredTitle(')
    - substr_count($quelle, 'function avesmapsWikiSettlementResolvePreferredTitle(');
assert($aufrufe === 1,
    'avesmapsWikiSettlementResolvePreferredTitle darf GENAU EINEN Aufrufer haben '
    . '(avesmapsWikiSettlementUniqueTitleFor). Gezaehlt: ' . $aufrufe . '. Ein zweiter Aufruf ist '
    . 'eine zweite Rechnung -- und Symbol und Knopf laufen ab dann auseinander.');
$pruefungen++;
assert(str_contains($rumpf('avesmapsWikiSettlementUniqueTitleFor'), 'avesmapsWikiSettlementResolvePreferredTitle('),
    'Der eine Aufruf muss in avesmapsWikiSettlementUniqueTitleFor stehen.');
$pruefungen++;

// 🔴 Und beide Leser rufen ihn wirklich.
foreach (['avesmapsWikiSettlementCollectConnectTargets', 'avesmapsWikiSettlementListLocations'] as $leser) {
    assert(str_contains($rumpf($leser), 'avesmapsWikiSettlementUniqueTitleFor('),
        $leser . ' rechnet den Kandidaten nicht mehr ueber avesmapsWikiSettlementUniqueTitleFor -- '
        . 'die Paritaet aus Teil 2 ist damit eine Behauptung ueber toten Code.');
    $pruefungen++;
}

$liste = $rumpf('avesmapsWikiSettlementListLocations');
// 💣 KEINE ZWEITE ABFRAGE. Der Index entsteht aus den Zeilen, die die Funktion ohnehin geladen hat;
// avesmapsWikiSettlementTitleIndex($pdo) waere ein zweiter Scan derselben Tabelle je Listenaufruf.
assert(!str_contains($liste, 'avesmapsWikiSettlementTitleIndex($pdo)')
    && !str_contains($liste, 'avesmapsWikiSettlementCollectConnectTargets('),
    'list_locations darf fuer das Symbol KEINE zweite Abfrage stellen. Der PDO-Aufsatz des Index '
    . 'und der Sammler fahren je einen eigenen vollen Scan -- zusammen zwei zusaetzliche Abfragen '
    . 'je Listenaufruf, genau das, was das Lastbudget verbietet.');
$pruefungen++;
assert(str_contains($liste, "avesmapsWikiSettlementTitleIndexFromTitles(array_column(\$regRows, 'title'))"),
    'Der Index muss aus $regRows entstehen -- den Registry-Zeilen, die die Funktion schon hat.');
$pruefungen++;

// 💣 UND ER MUSS VOR DEN FILTERN DER SCHLEIFE STEHEN. Ortsklasse und ausgeschlossene Bauwerksart
// gehoeren den „Fehlt"-Zeilen, nicht dem Index. Dahinter gebaut waere die Population kleiner als
// die des Knopfes -- und Teil 2 faenge das nur, weil dort „Trallestedt" liegt.
$posIndex = strpos($liste, 'avesmapsWikiSettlementTitleIndexFromTitles(');
$posFilter = strpos($liste, 'avesmapsWikiSettlementIsExcludedBuildingType(');
assert($posIndex !== false && $posFilter !== false && $posIndex < $posFilter,
    'Der Titelindex muss VOR dem Bauwerksart-Filter gebaut werden. Steht er dahinter, kennt er '
    . 'weniger Titel als der Knopf, und das Symbol wird stiller als der Knopf laut ist.');
$pruefungen++;

// 🔴 Die drei Felder, die die Zeile im Browser liest. Fehlt eines, faellt die Spalte weg oder eine
// Form kippt -- beides lautlos.
foreach (["'wiki_no_article' => !empty(\$props['wiki_no_article'])", "'wiki_candidate' =>", "'wikistatus' => true"] as $feld) {
    assert(str_contains($liste, $feld),
        'list_locations gibt ' . $feld . ' nicht heraus.');
    $pruefungen++;
}

// ⚠️ Und `wiki_no_article` liest wirklich `properties.wiki_no_article` -- nicht `wiki_url`, das
// beim Ort GERATEN ist (avesmapsEnrichMapFeatureWikiUrl, 97 Phantome am Livebestand).
assert(!str_contains($liste, "'wiki_no_article' => !empty(\$props['wiki_url'])"),
    'Der Merker darf nie aus wiki_url abgeleitet werden.');
$pruefungen++;

echo "listensymbol-orte: {$pruefungen} Zusicherungen bestanden ("
    . count($vomKnopf) . " Kandidaten, Knopf und Liste zeichengleich).\n";
