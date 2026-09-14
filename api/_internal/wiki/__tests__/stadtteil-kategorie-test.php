<?php

declare(strict_types=1);

/**
 * Stadtteile aus dem Wiki werden Innerorts-Staetten (Owner 14.09.2026: „insgesamt sollten
 * stadtteile innerorts sein" -- „wichtig ist, dass alle stadtviertel in der suche auftauchen").
 *
 * Gefahren wird der GANZE Weg, nicht eine Regel am Quelltext: Klassifikation einer Dumpseite ->
 * Bauwerks-Parser -> hybride Rekonstruktion (so liest „Syncen" den Zwischenstand) -> der echte
 * Upsert gegen eine PDO-Attrappe -> die Innerorts-Suche gegen eine echte SQLite-Tabelle.
 *
 * Die Wikitexte sind die Form des Septemberdumps (01.09.2026), gekuerzt.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/stadtteil-kategorie-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht 1 -- die Zusicherungen waeren wirkungslos.\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 4);
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';
require $repoRoot . '/api/_internal/wiki/dump-sync-kind.php';
// AVESMAPS_WIKI_SYNC_TYPE_LOCATION -- der Trockenlauf des Ortsabgleichs baut Faelle mit ihr.
require_once $repoRoot . '/api/_internal/wiki/sync-constants.php';
require_once $repoRoot . '/api/_internal/app/in-settlement-search.php';

$pruefungen = 0;
$dumpSeite = static fn(string $title, string $wikitext, int $ns = 0): array
    => ['title' => $title, 'ns' => $ns, 'id' => 1, 'redirect' => null, 'wikitext' => $wikitext];

// Die echten Formen, gekuerzt.
$suedquartier = $dumpSeite('Südquartier',
    "{{Aventurien}}\n{{Register Siedlung}}\n'''Südquartier''' ist ein Stadtteil von [[Gareth]].\n"
    . "{{IndexKat}}\n{{Nav Gareth}}\n[[Kategorie:Stadtteil von Gareth|Sudquartier]]");
// Die Spielwiese eines Benutzers, die im Hauptraum liegt -- nie ein Stadtteil.
$sandkasten = $dumpSeite('Sandkasten/Brigonis',
    "{{IndexKat}}\n{{Nav Kuslik}}\n{{Benutzer:Theaitetos/Sandkasten/Kurzbeschreibung}}\n[[Kategorie:Stadtteil von Kuslik]]");
// Traegt schon eine eigene Infobox -- gehoert ihrem Handler, nicht der Ausnahme.
$sternenpfeiler = $dumpSeite('Sternenpfeiler',
    "{{Myranor}}\n{{Register Region}}\n{{Infobox Region\n|Name=Sternenpfeiler\n}}\n[[Kategorie:Stadtteil von Dorinthapolis]]");
$chrysolimna = $dumpSeite('Chrysolimna',
    "{{Myranor}}\n'''Chrysolimna''' ist ein Stadtteil von [[Dorinthapolis]].\n{{IndexKat}}\n[[Kategorie:Stadtteil von Dorinthapolis]]");
// Die Kategorieseite selbst (ns 14) haengt in der Oberkategorie „Stadtteil" -- ohne „von".
$kategorieSeite = $dumpSeite('Kategorie:Stadtteil von Gareth', "[[Kategorie:Stadtteil]]", 14);

// ---- 1. Die benannte Ausnahme -------------------------------------------------------------------
$treffer = avesmapsWikiStadtteilAusKategorie($suedquartier);
assert(is_array($treffer) && $treffer['stadt'] === 'Gareth',
    'Südquartier ist ein Stadtteil von Gareth -- der Sortierschluessel hinter | gehoert nicht zum Namen');
assert(avesmapsWikiStadtteilAusKategorie($sandkasten) === null, 'eine Unterseite ist nie ein Stadtteil');
assert(avesmapsWikiStadtteilAusKategorie($sternenpfeiler) === null,
    'eine Seite mit erkannter Infobox gehoert ihrem Handler');
assert(avesmapsWikiStadtteilAusKategorie($kategorieSeite) === null, 'die Oberkategorie „Stadtteil" nennt keine Stadt');
assert(avesmapsWikiStadtteilAusKategorie($dumpSeite('Nordquartier', "'''Nordquartier''' liegt in [[Gareth]].")) === null,
    'ohne Kategorie keine Ausnahme -- auch nicht, wenn der Fliesstext „Stadtteil" sagt');
assert(avesmapsWikiStadtteilAusKategorie($dumpSeite('Zwei', "[[Kategorie:Stadtteil von Gareth]]\n[[Kategorie:Stadtteil von Punin]]")) === null,
    'zwei verschiedene Staedte sind keine Antwort');
assert((avesmapsWikiStadtteilAusKategorie($dumpSeite('Doppelt', "[[Kategorie:Stadtteil von Gareth]]\n[[Kategorie:Stadtteil_von_Gareth]]"))['stadt'] ?? '') === 'Gareth',
    'dieselbe Stadt zweimal (einmal mit Unterstrichen) ist EINE Stadt');
assert((avesmapsWikiStadtteilAusKategorie($dumpSeite('Klein', "[[Kategorie:stadtteil von Gareth]]"))['stadt'] ?? '') === 'Gareth',
    'MediaWiki unterscheidet den ersten Buchstaben eines Kategorienamens nicht');
assert((avesmapsWikiStadtteilAusKategorie($dumpSeite('Unterstrich', "[[Kategorie:Stadtteil_von_Yol-Ghurmak]]"))['stadt'] ?? '') === 'Yol-Ghurmak',
    'Unterstriche sind Leerzeichen -- so steht es in categorylinks, und so darf es im Wikitext stehen');
$pruefungen += 9;

// ---- 2. Die Klassifikation (das Tor des Scans) ---------------------------------------------------
assert(avesmapsWikiDumpClassifyPage($suedquartier) === AVESMAPS_WIKI_DUMP_ENTITY_BUILDING, 'Südquartier wird ein Bauwerk');
assert(avesmapsWikiDumpClassifyPage($chrysolimna) === AVESMAPS_WIKI_DUMP_ENTITY_BUILDING,
    'auch ein Viertel einer Stadt, die nicht auf der Karte liegt -- die Suche entscheidet spaeter');
assert(avesmapsWikiDumpClassifyPage($sternenpfeiler) === AVESMAPS_WIKI_DUMP_ENTITY_REGION, 'die Region bleibt eine Region');
assert(avesmapsWikiDumpClassifyPage($sandkasten) === '', 'die Spielwiese bleibt draussen');
assert(avesmapsWikiDumpClassifyPage($kategorieSeite) === '', 'eine Kategorieseite ist kein Objekt');
$fremderRaum = $suedquartier;
$fremderRaum['ns'] = 444;
assert(avesmapsWikiDumpClassifyPage($fremderRaum) === '', 'der Namensraum-Riegel steht VOR der Ausnahme');
$pruefungen += 6;

// ---- 3. Der Parser -----------------------------------------------------------------------------
$geparst = avesmapsWikiDumpParseBuildingPage($suedquartier);
assert($geparst['kept'] === true && is_array($geparst['record']), 'Südquartier wird aufgenommen');
$rec = $geparst['record'];
assert($rec['settlement_class'] === 'stadtviertel', 'Klasse stadtviertel, nicht gebaeude: ' . $rec['settlement_class']);
assert($rec['settlement_label'] === avesmapsWikiSettlementClassLabel('stadtviertel'), 'die Beschriftung folgt der Klasse');
assert($rec['building_type'] === 'Stadtteil', 'Art: ' . $rec['building_type']);
assert($rec['standort'] === '[[Gareth]]', 'der Standort kommt aus der Kategorie: ' . $rec['standort']);
assert($rec['title'] === 'Südquartier');

// Ein echtes |Standort= schlaegt die Kategorie.
$mitStandort = $dumpSeite('Arenaviertel',
    "{{Infobox Viertel\n|Standort=[[Gareth]]: [[Alt-Gareth]]\n}}\n[[Kategorie:Stadtteil von Gareth]]");
assert(avesmapsWikiDumpClassifyPage($mitStandort) === AVESMAPS_WIKI_DUMP_ENTITY_BUILDING, 'eine unbekannte Infobox ist keine erkannte');
assert(avesmapsWikiDumpParseBuildingPage($mitStandort)['record']['standort'] === '[[Gareth]]: [[Alt-Gareth]]',
    'ein echtes |Standort= gewinnt');

// Ein gewoehnliches Bauwerk bleibt, was es war.
$burg = avesmapsWikiDumpParseBuildingPage($dumpSeite('Burg Wallenstein', "{{Infobox Bauwerk\n|Art=[[Burg]]\n|Standort=[[Kosch]]\n}}"));
assert($burg['record']['settlement_class'] === 'gebaeude', 'ein Bauwerk bleibt gebaeude');
assert($burg['record']['building_type'] === 'Burg', 'und seine Art bleibt seine Art');

// Ein Online-Override der Bauwerksart macht aus einem Stadtteil nichts anderes.
assert(avesmapsWikiDumpParseBuildingPage($suedquartier, ['building_type' => 'Tempel'])['record']['building_type'] === 'Stadtteil',
    'die Art eines Stadtteils steht fest -- sie ist der Grund, warum die Seite ueberhaupt aufgenommen wird');
$pruefungen += 11;

// ---- 4. Der Weg, den „Syncen" nimmt: Zwischenstand -> Parser -> echter Upsert --------------------
$zustand = ['normalized_title' => 'Südquartier', 'wikitext' => $suedquartier['wikitext']];
$zeile = avesmapsWikiDumpHybridParseRow($zustand);
assert($zeile['kind'] === AVESMAPS_WIKI_DUMP_ENTITY_BUILDING && $zeile['kept'] === true,
    'der hybride Rekonstrukteur (redirect=null, ns aus dem Titel) sagt dasselbe');
assert($zeile['record']['settlement_class'] === 'stadtviertel');

final class StadtteilAttrappeStmt extends PDOStatement
{
    public function __construct(private StadtteilAttrappePdo $pdo) {}

    #[\ReturnTypeWillChange]
    public function execute($params = null)
    {
        $this->pdo->ausgefuehrt[] = (array) ($params ?? []);
        return true;
    }

    #[\ReturnTypeWillChange]
    public function rowCount()
    {
        return 1;
    }
}

final class StadtteilAttrappePdo extends PDO
{
    /** @var list<array<string,mixed>> */
    public array $ausgefuehrt = [];

    public function __construct() {}

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new StadtteilAttrappeStmt($this);
    }
}

$attrappe = new StadtteilAttrappePdo();
avesmapsWikiDumpHybridUpsertParsedRow($attrappe, $zeile);
assert(count($attrappe->ausgefuehrt) === 1, 'genau ein Schreibvorgang');
assert(($attrappe->ausgefuehrt[0]['cls'] ?? '') === 'stadtviertel',
    'der Upsert schreibt die Klasse des Datensatzes, nicht fest gebaeude: ' . json_encode($attrappe->ausgefuehrt[0]));
assert(($attrappe->ausgefuehrt[0]['lbl'] ?? '') === avesmapsWikiSettlementClassLabel('stadtviertel'));
assert(($attrappe->ausgefuehrt[0]['st'] ?? '') === '[[Gareth]]');

$attrappe = new StadtteilAttrappePdo();
avesmapsWikiSettlementUpsertBuildingRow($attrappe, 'Burg Wallenstein', 'Burg', false, '[[Kosch]]');
assert(($attrappe->ausgefuehrt[0]['cls'] ?? '') === 'gebaeude', 'ohne Angabe bleibt der Online-Crawl bei gebaeude');

$geworfen = false;
try {
    avesmapsWikiSettlementUpsertBuildingRow(new StadtteilAttrappePdo(), 'X', 'Y', false, '', 'dorf');
} catch (InvalidArgumentException) {
    $geworfen = true;
}
assert($geworfen, 'eine Siedlungsklasse darf nie ueber den BAUWERKS-Upsert geschrieben werden');
$pruefungen += 8;

// ---- 5. Stadtteile sind KEINE Siedlungen fuer den Ortsabgleich ------------------------------------
// Ohne diesen Riegel landeten sie als „Wiki-Ort fehlt auf der Karte" im Konfliktzentrum.
$datensaetze = [
    $rec,
    $burg['record'],
    ['title' => 'Angbar', 'settlement_class' => 'stadt', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Angbar'],
];
$orte = avesmapsWikiDumpSettlementWikiPlacesFromRecords($datensaetze);
$titel = array_map(static fn(array $o): string => (string) ($o['title'] ?? $o['name'] ?? ''), $orte);
assert(!in_array('Südquartier', $titel, true), 'ein Stadtteil ist kein Wiki-Ort: ' . implode(', ', $titel));
assert(!in_array('Burg Wallenstein', $titel, true), 'ein Bauwerk auch nicht');
assert(count($orte) === 1, 'nur Angbar bleibt: ' . count($orte));

$bericht = avesmapsWikiDumpDryRunClassifySettlements([], $datensaetze);
assert($bericht['header']['gebaeude_filtered_out'] === 2, 'der Trockenlauf zaehlt BEIDE Bauwerksklassen heraus');
assert($bericht['header']['dump_settlements_excl_gebaeude'] === 1);

// Der Einschritt-Lauf baut seine Orte mit DERSELBEN Funktion wie der Stepper -- sonst liefe genau
// hier eine dritte Fassung des Filters auseinander.
// Zeilenendenneutral: hier liegt die Datei als CRLF, im Deploy-Tor als LF (AGENTS.md §9).
$quelle = str_replace("\r\n", "\n", (string) file_get_contents($repoRoot . '/api/_internal/wiki/dump-sync-kind.php'));
preg_match('~function avesmapsWikiDumpSettlementConflictsGenerate\(.*?\n}\n~s', $quelle, $rumpf);
assert(isset($rumpf[0]) && str_contains($rumpf[0], 'avesmapsWikiDumpSettlementWikiPlacesFromRecords('),
    'avesmapsWikiDumpSettlementConflictsGenerate filtert ueber die geteilte Funktion');
assert(!preg_match("~===\s*'gebaeude'~", $quelle), 'dump-sync-kind.php vergleicht noch auf den EINEN Wert gebaeude');
$pruefungen += 7;

// ---- 6. Die Innerorts-Suche, gegen eine echte Tabelle --------------------------------------------
$sqlite = new PDO('sqlite::memory:');
$sqlite->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$sqlite->exec('CREATE TABLE wiki_sync_pages (title TEXT, settlement_class TEXT, building_type TEXT, wiki_url TEXT, standort TEXT, deity TEXT)');
$einfuegen = $sqlite->prepare('INSERT INTO wiki_sync_pages VALUES (:title, :cls, :bt, :url, :st, NULL)');
foreach ([$rec, avesmapsWikiDumpParseBuildingPage($chrysolimna)['record']] as $r) {
    $einfuegen->execute(['title' => $r['title'], 'cls' => $r['settlement_class'], 'bt' => $r['building_type'], 'url' => $r['wiki_url'], 'st' => $r['standort']]);
}
$einfuegen->execute(['title' => 'Angbar', 'cls' => 'stadt', 'bt' => '', 'url' => '', 'st' => '[[Kosch]]']);

$registry = avesmapsFetchInSettlementSearchRows($sqlite);
$registryTitel = array_column($registry, 'title');
sort($registryTitel);
assert($registryTitel === ['Chrysolimna', 'Südquartier'], 'die Suche liest beide Stadtteile und keine Siedlung: ' . implode(', ', $registryTitel));

$karte = [
    ['feature_type' => 'location', 'feature_subtype' => 'metropole', 'name' => 'Gareth', 'public_id' => 'pid-gareth', 'min_x' => 30.0, 'min_y' => 40.0, 'max_x' => 30.0, 'max_y' => 40.0],
];
$scope = [
    'settlements' => avesmapsPlaceScopeBuildNameSet(['Gareth']),
    'regions' => avesmapsPlaceScopeBuildNameSet(['Alt-Gareth', 'Neu-Gareth']),
];
$eintraege = avesmapsBuildInSettlementSearchEntries($registry, avesmapsBuildSettlementLocationIndex($karte), $scope);
assert(count($eintraege) === 1, 'Dorinthapolis liegt nicht auf der Karte -- sein Viertel faellt aus der Suche: ' . count($eintraege));
assert($eintraege[0]['name'] === 'Südquartier');
assert($eintraege[0]['type_label'] === 'Stadtteil in Gareth', 'Beschriftung: ' . $eintraege[0]['type_label']);
assert($eintraege[0]['public_id'] === 'pid-gareth', 'der Treffer springt auf Gareth');

$staetten = avesmapsBuildInSettlementPlaceList($registry, $scope);
assert(array_column($staetten, 'settlement') === ['Gareth'], 'in der Staettenliste steht es bei Gareth');
$pruefungen += 6;

echo "stadtteil-kategorie-test.php: {$pruefungen} Pruefungen erfuellt\n";
