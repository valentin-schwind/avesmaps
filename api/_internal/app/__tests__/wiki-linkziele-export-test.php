<?php

declare(strict_types=1);

/**
 * Die zwei lesenden Exporte fuer Avesmaps3D (Auftrag 05.10.2026):
 *   X1  GET /api/app/wiki-linkziele-export.php   -- Linkziele je Objekt und Wiki-Feld
 *   X2  GET /api/app/wiki-zuordnung-export.php   -- Zuordnungstafel wiki_key -> public_id
 * Bibliothek: api/_internal/app/wiki-linkziele-export.php, Zerlegung der Links: api/_internal/wiki/link-ziele.php.
 *
 * Abschnitte:
 *   A  Links zerlegen ([[Ziel]], [[Ziel|Anzeige]], [[Ziel#Abschnitt|Anzeige]], mehrere, Gareth) -- und dass die alte
 *      Tafel `avesmapsWikiSettlementLinkTargets` nach dem Umbau dasselbe liefert wie vorher
 *   B  Namensraum und Schluessel: Hauptraum und Inoffiziell:-Seite bleiben zwei Artikel; Weiterleitung ueber Namensraeume
 *   C  Eine Seite -> ihre Linkfelder; NUR Felder der Positivliste (Test gegen zusaetzliche Felder)
 *   D  Beide Exporte gegen eine SQLite-Fixture: Inhalt, Zaehler, Weiterleitung, fehlender Wikitext, Namensraum
 *   E  🔴 NUR LESEND (Mutationstest): jede Anweisung ein SELECT, Datenbankinhalt davor = danach, kein Schreibwort im Quelltext
 *   F  Der Stand bewegt sich waehrend des Lesens -> Ausnahme (Endpunkt: 503 data_changing)
 *   G  Verdrahtung: zwei Endpunkte, nur GET, keine Anmeldung; die Nest-Liste gleich der des Konfliktzentrums
 *
 * 🪤 SQLite statt MySQL: die Abfragen der Bibliothek sind einfache SELECTs (kein DDL, keine JSON-Funktionen -- die
 * Nester werden per LIKE gefunden und in PHP gelesen), also laufen sie auf beiden. Was der Test NICHT leistet: die Zahlen am
 * Livebestand -- die kommen aus einem Abruf der echten Endpunkte.
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/wiki-linkziele-export-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
foreach (['mbstring', 'pdo_sqlite'] as $erweiterung) {
    if (!extension_loaded($erweiterung)) {
        fwrite(STDERR, "FATAL: Erweiterung $erweiterung fehlt -- mit -d extension=php_$erweiterung.dll starten.\n");
        exit(2);
    }
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/app/wiki-linkziele-export.php';
// Die alte Tafel, die auf die geteilte Zerlegung zeigt (Abschnitt A).
require_once $wurzel . '/api/_internal/wiki/settlements.php';

$bibliothekDatei = $wurzel . '/api/_internal/app/wiki-linkziele-export.php';
$linkZieleDatei = $wurzel . '/api/_internal/wiki/link-ziele.php';
$endpunktLinkziele = $wurzel . '/api/app/wiki-linkziele-export.php';
$endpunktZuordnung = $wurzel . '/api/app/wiki-zuordnung-export.php';

// ---- Helfer ------------------------------------------------------------------------------------

function ohneKommentare(string $quelle): string
{
    $aus = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $aus .= is_array($token) ? $token[1] : $token;
    }

    return $aus;
}

/** Die Zeichenketten-Literale eines Quelltexts (ohne Kommentare) -- dort stehen die SQL-Anweisungen. */
function stringLiterale(string $quelle): array
{
    $literale = [];
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_CONSTANT_ENCAPSED_STRING, T_ENCAPSED_AND_WHITESPACE], true)) {
            $literale[] = $token[1];
        }
    }

    return $literale;
}

/** Eine Datenbank, die jede Anweisung mitschreibt (prepare, query, exec) -- der Zeuge fuer „nur lesend". */
final class ProtokollPdo extends PDO
{
    /** @var list<string> */
    public array $anweisungen = [];

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->anweisungen[] = $query;

        return parent::prepare($query, $options);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $this->anweisungen[] = $query;

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }

    public function exec(string $statement): int|false
    {
        $this->anweisungen[] = $statement;

        return parent::exec($statement);
    }
}

function neueDatenbank(): ProtokollPdo
{
    $pdo = new ProtokollPdo('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    foreach ([
        'CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, feature_subtype TEXT, properties_json TEXT, is_active INTEGER)',
        'CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT, region_type TEXT, wiki_url TEXT, wiki_region_key TEXT, is_active INTEGER)',
        'CREATE TABLE political_territory (id INTEGER PRIMARY KEY, public_id TEXT, type TEXT, wiki_key TEXT, wiki_url TEXT, continent TEXT, is_active INTEGER, updated_at TEXT)',
        'CREATE TABLE wiki_redirect_alias (alias_slug TEXT PRIMARY KEY, canonical_wiki_key TEXT, updated_at TEXT)',
        'CREATE TABLE wiki_sync_runs (id INTEGER PRIMARY KEY, sync_type TEXT, status TEXT, completed_at TEXT)',
        'CREATE TABLE wiki_dump_hybrid_state (id INTEGER PRIMARY KEY, run_id INTEGER, normalized_title TEXT, entity_kind TEXT, wikitext TEXT, wikitext_found_at TEXT)',
        'CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)',
        'CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)',
    ] as $ddl) {
        $pdo->exec($ddl);
    }
    $pdo->exec('INSERT INTO map_revision VALUES (1, 100)');
    $pdo->exec('INSERT INTO ecosystem_revision VALUES (1, 50)');

    return $pdo;
}

function wikiNest(string $nest, string $titelUrl): string
{
    return json_encode([$nest => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/' . $titelUrl]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

// ============================================================================================
// A. Links zerlegen
// ============================================================================================

// A1: die drei Schreibweisen, in einer Zeile, in Quelltext-Reihenfolge.
$paare = avesmapsWikiLinkZielePaare('[[Ziel]] und [[Zweites Ziel|Anzeige]], [[Drittes#Abschnitt|Abschn]]');
assert($paare === [
    ['anzeige' => 'Ziel', 'ziel' => 'Ziel'],
    ['anzeige' => 'Anzeige', 'ziel' => 'Zweites Ziel'],
    ['anzeige' => 'Abschn', 'ziel' => 'Drittes'],
], 'A1: [[Ziel]], [[Ziel|Anzeige]] und [[Ziel#Abschnitt|Anzeige]]');

// A2: der Fall aus dem Auftrag -- Gareth, Verkehrswege.
$gareth = avesmapsWikiLinkZielePaare('[[Reichsstraße 2|Reichsstraßen 2]] und [[Reichsstraße 3|3]], [[Gardel]]');
assert($gareth === [
    ['anzeige' => 'Reichsstraßen 2', 'ziel' => 'Reichsstraße 2'],
    ['anzeige' => '3', 'ziel' => 'Reichsstraße 3'],
    ['anzeige' => 'Gardel', 'ziel' => 'Gardel'],
], 'A2: „2" -> Reichsstrasse 2, „3" -> Reichsstrasse 3, „Gardel" -> Gardel');

// A3: 💣 zwei Links mit DERSELBEN Anzeige verlieren in der alten Tafel den zweiten -- die Liste behaelt beide.
$gleich = avesmapsWikiLinkZielePaare('[[A|x]] und [[B|x]]');
assert(count($gleich) === 2 && $gleich[1]['ziel'] === 'B', 'A3: dieselbe Anzeige, zwei Ziele: beide stehen da');

// A4: kein Link, leerer Wert, leeres Ziel.
assert(avesmapsWikiLinkZielePaare('') === [] && avesmapsWikiLinkZielePaare('nur Text') === [] && avesmapsWikiLinkZielePaare('[[|x]]') === [], 'A4: nichts zu finden');

// A5: eine Vorlage ist KEIN Link dieser Funktion.
assert(avesmapsWikiLinkZielePaare('{{Pol|Baronie Raulsmark}}') === [], 'A5: {{Pol|…}} ist kein Wikilink');

// A6: die alte Tafel verhaelt sich unveraendert (assign_to haengt daran) -- erster Treffer je Anzeige gewinnt.
assert(avesmapsWikiSettlementLinkTargets('[[A|x]] und [[B|x]], [[Gardel]]') === ['x' => 'A', 'Gardel' => 'Gardel'], 'A6: alte Tafel unveraendert');
assert(avesmapsWikiSettlementLinkTargets('nur Text') === [], 'A6: kein Link -> leere Tafel');

// A7: die Regex steht GENAU EINMAL im Haus (nicht mehr in settlements.php).
$siedlungQuelle = ohneKommentare((string) file_get_contents($wurzel . '/api/_internal/wiki/settlements.php'));
assert(!str_contains($siedlungQuelle, 'preg_match_all(\'/\\[\\[') && str_contains($siedlungQuelle, 'avesmapsWikiLinkZielePaare'), 'A7: settlements.php ruft die geteilte Zerlegung');

// ============================================================================================
// B. Namensraum und Schluessel
// ============================================================================================

assert(avesmapsWikiLinkzieleNamensraum("Dju'imen") === ['ns' => 0, 'ns_name' => ''], 'B1: Hauptraum');
assert(avesmapsWikiLinkzieleNamensraum("Inoffiziell:Dju'imen") === ['ns' => 222, 'ns_name' => 'Inoffiziell'], 'B2: Inoffiziell: = ns 222');
assert(avesmapsWikiLinkzieleNamensraum(":Inoffiziell:X")['ns'] === 222, 'B3: fuehrender Doppelpunkt (MediaWiki-Linkschreibweise) wird abgeschnitten');
assert(avesmapsWikiLinkzieleNamensraum('Kategorie:X')['ns'] === 0, 'B4: unbekannter Praefix gilt wie im Rest des Hauses als Hauptraum');

$keine = [];
$hauptKey = avesmapsWikiLinkzieleKey("Dju'imen", $keine);
$inoffKey = avesmapsWikiLinkzieleKey("Inoffiziell:Dju'imen", $keine);
assert($hauptKey === 'wiki:dju-imen' && $inoffKey === 'wiki:inoffiziell-dju-imen' && $hauptKey !== $inoffKey, 'B5: offizielle und inoffizielle Seite gleichen Titels sind ZWEI Keys');
assert(avesmapsWikiLinkzieleKey('Gareth#Geschichte', $keine) === 'wiki:gareth', 'B6: „#Abschnitt" faellt aus dem Key');
assert(avesmapsWikiLinkzieleKey('Reichsstra_e 2', $keine) !== '' && avesmapsWikiLinkzieleKey('', $keine) === '', 'B7: leerer Titel ergibt keinen Key');
assert(avesmapsWikiLinkzieleKey('Fürstentum Kosch', $keine) === 'wiki:f-rstentum-kosch', 'B8: die feste Faltungstafel des Hauses, nicht „huebscher"');

// B9: Weiterleitung -- und zwar UEBER Namensraeume hinweg: „Dju'imen (alt)" (Hauptraum) -> „Inoffiziell:Dju'imen".
$aliase = ['dju-imen-alt' => 'wiki:inoffiziell-dju-imen', '2026' => 'wiki:ziel-zweitausend'];
assert(avesmapsWikiLinkzieleKey("Dju'imen (alt)", $aliase) === 'wiki:inoffiziell-dju-imen', 'B9: Weiterleitung loest auf');
assert(avesmapsWikiLinkzieleKey('2026', $aliase) === 'wiki:ziel-zweitausend', 'B9: ein numerischer Alias (PHP macht daraus einen Integer-Schluessel) trifft trotzdem');
$index = ['wiki:inoffiziell-dju-imen' => ['id' => 1, 'titel' => "Inoffiziell:Dju'imen", 'art' => 'settlement']];
$daten = avesmapsWikiLinkzieleTitelDaten("Dju'imen (alt)", $aliase, $index);
assert($daten['ns'] === 0 && $daten['weiterleitung_auf']['ns'] === 222 && $daten['weiterleitung_auf']['ns_name'] === 'Inoffiziell', 'B10: beide Namensraeume stehen da (Ziel 0, Weiterleitung 222)');
assert(!isset(avesmapsWikiLinkzieleTitelDaten('Gareth', $aliase, $index)['weiterleitung_auf']), 'B11: ohne getroffene Weiterleitung kein weiterleitung_auf');
$unbekannt = avesmapsWikiLinkzieleTitelDaten("Dju'imen (alt)", $aliase, []);
assert($unbekannt['weiterleitung_auf']['titel'] === null && $unbekannt['weiterleitung_auf']['ns'] === null, 'B12: kennt der Dump die Zielseite nicht, steht null -- kein geratener Namensraum');

// B13: Schluessel aus gespeichertem Key.
assert(avesmapsWikiLinkzieleKeyAusGespeichertem('wiki:herzogtum-weiden', [], false) === 'wiki:herzogtum-weiden', 'B13: wiki:-Key bleibt');
assert(avesmapsWikiLinkzieleKeyAusGespeichertem('name:foo', [], false) === '' && avesmapsWikiLinkzieleKeyAusGespeichertem('eigener-knoten:k1', [], true) === '', 'B13: name:/eigener-knoten: ist keine Wiki-Zuweisung');
assert(avesmapsWikiLinkzieleKeyAusGespeichertem('weiden', [], true) === 'wiki:weiden' && avesmapsWikiLinkzieleKeyAusGespeichertem('weiden', [], false) === '', 'B14: der blanke Slug der Landschaften nur, wo er erlaubt ist');

// B15: Adresse -> Titel
assert(avesmapsWikiLinkzieleTitelAusUrl('https://de.wiki-aventurica.de/wiki/Inoffiziell:Dju%27imen') === "Inoffiziell:Dju'imen", 'B15: Titel aus der Adresse, mit Praefix');
assert(avesmapsWikiLinkzieleTitelAusUrl('https://garetien.de/ort/gareth') === '', 'B16: keine /wiki/-Adresse -> kein geratener Titel');

// ============================================================================================
// C. Eine Seite -> ihre Linkfelder
// ============================================================================================

$garethText = <<<'WIKI'
{{Aventurien}}
==Kurzbeschreibung==
{{Infobox Siedlung
|Name=Gareth
|Wappen={{Boximage|Wappen Gareth Stadt 1. Var 3.png}}
|Region={{Reg|Herz des Kontinents}}
|Staat={{Pol|Baronie Raulsmark}}; [[Reichsstadt]] (nur [[Alt-Gareth]])
|Handelszone=GAR
|Verkehrswege=[[Reichsstraße 2|Reichsstraßen 2]] und [[Reichsstraße 3|3]], [[Gardel]]
|Bearbeiter=[[Nicht Exportieren]]
|Positionskarte={{Positionskarte|X=169|Y=225|Text=[[Gareth]]}}
|NORD=[[Natzungen]]
|SÜDOST=[[Vierok]]
|SÜD= [[Silkwiesen (Siedlung)|Silkwiesen]]
}}
Text.
WIKI;
$seite = avesmapsWikiLinkzieleSeite($garethText, 'settlement');
assert(array_keys($seite['felder']) === ['staat', 'verkehrswege', 'nachbar_n', 'nachbar_so', 'nachbar_s'], 'C1: nur Felder der Positivliste, in deren Reihenfolge, und nur mit Link');
assert(count($seite['felder']['verkehrswege']) === 3 && $seite['felder']['verkehrswege'][1]['ziel'] === 'Reichsstraße 3', 'C2: Gareth Verkehrswege: drei Links');
assert($seite['felder']['staat'][0]['ziel'] === 'Reichsstadt', 'C3: Staat: die zwei echten Wikilinks');
assert($seite['felder']['nachbar_s'][0] === ['anzeige' => 'Silkwiesen', 'ziel' => 'Silkwiesen (Siedlung)'], 'C4: Nachbar Sued, SÜD -> sud');
assert($seite['vorlagen'] === ['Reg' => 1, 'Pol' => 1], 'C5: {{Reg|…}} und {{Pol|…}} werden als Luecke GEZAEHLT, nicht als Link gefuehrt');
// 🔴 Positivliste: ein Infobox-Feld ausserhalb der Liste (Bearbeiter, Positionskarte, Wappen) kommt nirgends vor.
$json = json_encode($seite, JSON_UNESCAPED_UNICODE);
assert(!str_contains($json, 'Nicht Exportieren') && !str_contains($json, 'Boximage'), 'C6: zusaetzliche Infobox-Felder fallen STILL heraus');
assert($seite['befuellt'] === 7, 'C7: befuellte Felder der Positivliste (region, staat, handelszone, verkehrswege, 3 Nachbarn)');

assert(avesmapsWikiLinkzieleSeite('kein Infobox [[Link]]', 'settlement')['infobox'] === false, 'C8: Seite ohne Infobox');
assert(avesmapsWikiLinkzieleSeite($garethText, 'territory')['felder'] === [], 'C9: Seitenart ohne Positivliste -> nichts');

// Weg: das Verlaufsfeld nennt alle Links in Reihenfolge, und seine Zeilenvorlagen zaehlen nicht als Luecke.
$wegText = "{{Infobox Straße\n|Name=Reichsstraße 2\n|Regionen=[[Garetien]], [[Weiden]]\n|Verlauf={{Straße|[[Gareth]]|[[Havena]]}}{{Abzweigung links|Kuslik}}\n}}";
$weg = avesmapsWikiLinkzieleSeite($wegText, 'path');
assert(array_keys($weg['felder']) === ['lage', 'verlauf'] && $weg['felder']['lage'][1]['ziel'] === 'Weiden', 'C10: Weg: lage = Regionen');
assert(array_column($weg['felder']['verlauf'], 'ziel') === ['Gareth', 'Havena'] && $weg['vorlagen'] === [], 'C11: Verlauf: Links in Reihenfolge, Zeilenvorlagen sind kein Rauschen im Kopf');

// Die Positivliste selbst: keine leere Liste, nur Kleinbuchstaben/Ziffern als Alias (so bildet NormFields die Schluessel).
foreach (AVESMAPS_WIKI_LINKZIELE_FELDER as $art => $felder) {
    assert($felder !== [], "C12: Liste fuer $art ist nicht leer");
    foreach ($felder as $name => $aliasListe) {
        assert(preg_match('/^[a-z0-9_]+$/', (string) $name) === 1, "C12: Ausgabename $name");
        foreach ($aliasListe as $alias) {
            assert($alias === avesmapsWikiSyncMonitorFieldKey($alias), "C12: Alias '$alias' ist ein normalisierter Feldschluessel");
        }
    }
}

// ============================================================================================
// D. Beide Exporte gegen eine Fixture
// ============================================================================================

function fixtureBauen(): ProtokollPdo
{
    $pdo = neueDatenbank();
    $feature = $pdo->prepare('INSERT INTO map_features (id, public_id, feature_type, feature_subtype, properties_json, is_active) VALUES (?,?,?,?,?,?)');
    $zeilen = [
        [1, 'ort-gareth', 'location', 'metropole', json_encode(['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Falsch'] + json_decode(wikiNest('wiki_settlement', 'Gareth'), true)), 1],
        [2, 'ort-ohne', 'location', 'dorf', json_encode(['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Geraten']), 1],
        [3, 'weg-a', 'path', 'Reichsstrasse', wikiNest('wiki_path', 'Reichsstra%C3%9Fe_2'), 1],
        [4, 'weg-b', 'path', 'Reichsstrasse', wikiNest('wiki_path', 'Reichsstra%C3%9Fe_2'), 1],
        [5, 'kraft-1', 'powerline', 'powerline', wikiNest('wiki_powerline', 'Schwarze_Linie'), 1],
        [6, 'label-weiden', 'label', 'region', wikiNest('wiki_region', 'Weiden'), 1],
        [7, 'ort-inaktiv', 'location', 'dorf', wikiNest('wiki_settlement', 'Gareth'), 0],
        [8, 'kreuzung', 'crossing', 'crossing', '{}', 1],
        [9, 'ort-djuimen', 'location', 'dorf', wikiNest('wiki_settlement', 'Inoffiziell:Dju%27imen'), 1],
        [10, 'ort-fehlt', 'location', 'dorf', wikiNest('wiki_settlement', 'Nicht_im_Dump'), 1],
        [11, 'ort-fremd', 'location', 'dorf', json_encode(['wiki_settlement' => ['wiki_url' => 'https://garetien.de/ort/fremd']]), 1],
        [12, 'ort-weiterleitung', 'location', 'dorf', wikiNest('wiki_settlement', "Dju%27imen_(alt)"), 1],
        [13, 'ort-nest-leer', 'location', 'dorf', json_encode(['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Geraten', 'wiki_settlement' => ['wiki_url' => '']]), 1],
    ];
    foreach ($zeilen as $zeile) {
        $feature->execute($zeile);
    }

    $region = $pdo->prepare('INSERT INTO ecosystem_region (id, public_id, kind, region_type, wiki_url, wiki_region_key, is_active) VALUES (?,?,?,?,?,?,?)');
    foreach ([
        [1, 'land-weiden', 'derographisch', 'region', 'https://de.wiki-aventurica.de/wiki/Weiden', 'weiden', 1],
        [2, 'land-nur-key', 'vegetation', 'wald', null, 'herzogtum-weiden', 1],
        [3, 'land-ohne', 'vegetation', 'wald', null, null, 1],
        [4, 'klima-1', 'klima', 'tropisch', null, null, 1],
        [5, 'land-inaktiv', 'vegetation', 'wald', 'https://de.wiki-aventurica.de/wiki/Weiden', 'weiden', 0],
    ] as $zeile) {
        $region->execute($zeile);
    }

    $gebiet = $pdo->prepare('INSERT INTO political_territory (id, public_id, type, wiki_key, wiki_url, continent, is_active, updated_at) VALUES (?,?,?,?,?,?,?,?)');
    foreach ([
        [1, 'geb-weiden', 'Herzogtum', 'wiki:herzogtum-weiden', 'https://de.wiki-aventurica.de/wiki/Herzogtum_Weiden', 'Aventurien', 1, '2026-09-01 00:00:00'],
        [2, 'geb-name', 'Baronie', 'name:foo', null, 'Aventurien', 1, '2026-09-01 00:00:00'],
        [3, 'geb-inaktiv', 'Baronie', 'wiki:baronie-x', null, 'Aventurien', 0, '2026-09-01 00:00:00'],
        [4, 'geb-myranor', 'Reich', 'wiki:myranor', null, 'Myranor', 1, '2026-09-01 00:00:00'],
    ] as $zeile) {
        $gebiet->execute($zeile);
    }

    $alias = $pdo->prepare('INSERT INTO wiki_redirect_alias (alias_slug, canonical_wiki_key, updated_at) VALUES (?,?,?)');
    $alias->execute(['dju-imen-alt', 'wiki:inoffiziell-dju-imen', '2026-09-02 00:00:00']);
    $alias->execute(['zedernstrasse', 'wiki:raschtulsweg', '2026-09-02 00:00:00']);

    $pdo->exec("INSERT INTO wiki_sync_runs VALUES (4, 'dump_read', 'completed', '2026-08-30 07:00:00.000')");
    $pdo->exec("INSERT INTO wiki_sync_runs VALUES (5, 'dump_read', 'completed', '2026-09-02 07:00:00.000')");
    $pdo->exec("INSERT INTO wiki_sync_runs VALUES (6, 'dump_read', 'running', NULL)");

    $seite = $pdo->prepare('INSERT INTO wiki_dump_hybrid_state (run_id, normalized_title, entity_kind, wikitext, wikitext_found_at) VALUES (?,?,?,?,?)');
    $gesehen = '2026-09-02 06:00:00';
    $garethText = "{{Infobox Siedlung\n|Name=Gareth\n|Staat={{Pol|Baronie Raulsmark}}; [[Reichsstadt]]\n|Verkehrswege=[[Reichsstraße 2|Reichsstraßen 2]] und [[Reichsstraße 3|3]], [[Gardel]], [[Zedernstraße]]\n|Bearbeiter=[[Nicht Exportieren]]\n|NORD=[[Natzungen]]\n}}";
    foreach ([
        [5, 'Gareth', 'settlement', $garethText, $gesehen],
        [5, 'Reichsstraße 2', 'path', "{{Infobox Straße\n|Name=Reichsstraße 2\n|Regionen=[[Garetien]]\n|Verlauf={{Straße|[[Gareth]]|[[Havena]]}}\n}}", $gesehen],
        [5, 'Schwarze Linie', 'powerline', "{{Infobox Kraftlinie\n|Name=Schwarze Linie\n|Regionen=[[Weiden]]\n|Verlauf={{Kraftlinie|[[Nexus A]]}}\n}}", $gesehen],
        [5, 'Weiden', 'region', "{{Infobox Region\n|Name=Weiden\n|Staat=[[Mittelreich]]\n|Verkehrswege=[[Reichsstraße 2]]\n|NORD=[[Garetien]]\n}}", $gesehen],
        [5, "Inoffiziell:Dju'imen", 'settlement', "{{Infobox Siedlung\n|Name=Dju'imen\n|Region=[[Weiden]]\n|NORD=[[Dju'imen (alt)]]\n|OST=[[Inoffiziell:Rossbergen]]\n|WEST=[[Dju'imen]]\n}}", $gesehen],
        [5, "Dju'imen", 'settlement', "{{Infobox Siedlung\n|Name=Dju'imen\n|Region=[[Weiden]]\n}}", $gesehen],
        [5, 'Herzogtum Weiden', 'territory', "{{Infobox Herrschaftsgebiet\n|Name=Herzogtum Weiden\n|Staat=[[Mittelreich]]\n}}", $gesehen],
        [5, 'Ohne Text', 'settlement', null, null],
        [4, 'Nur im alten Lauf', 'settlement', "{{Infobox Siedlung\n|Name=Alt\n|Region=[[Alt]]\n}}", $gesehen],
        [6, 'Nur im laufenden Lauf', 'settlement', "{{Infobox Siedlung\n|Name=Neu\n|Region=[[Neu]]\n}}", $gesehen],
    ] as $zeile) {
        $seite->execute($zeile);
    }

    return $pdo;
}

$pdo = fixtureBauen();
$x2 = avesmapsWikiLinkzieleLesen($pdo, 'zuordnung');
assert($x2['ok'] === true && $x2['map_revision'] === 100 && $x2['ecosystem_revision'] === 50, 'D1: Staende oben');
$je = [];
foreach ($x2['objekte'] as $objekt) {
    $je[$objekt['public_id']] = $objekt;
}

assert(isset($je['ort-gareth']) && $je['ort-gareth']['wiki_key'] === 'wiki:gareth' && $je['ort-gareth']['art'] === 'siedlung', 'D2: Gareth ueber das NEST, nicht ueber das flache (falsche) wiki_url');
assert(!isset($je['ort-ohne']) && !isset($je['ort-nest-leer']), 'D3: ein Ort nur mit flachem, geratenem wiki_url ist NICHT zugewiesen -- auch nicht mit leerem Nest daneben');
assert($je['weg-a']['wiki_key'] === 'wiki:reichsstrasse-2' && $je['weg-b']['wiki_key'] === 'wiki:reichsstrasse-2' && $je['weg-a']['art'] === 'weg', 'D4: beide Abschnitte, derselbe Key');
assert($je['kraft-1']['art'] === 'kraftlinie' && $je['label-weiden']['art'] === 'region', 'D5: Kraftlinie und Region-Beschriftung');
assert(!isset($je['ort-inaktiv']) && !isset($je['kreuzung']), 'D6: inaktive Objekte und Kreuzungen fehlen');
assert($je['ort-djuimen']['wiki_key'] === 'wiki:inoffiziell-dju-imen' && $je['ort-djuimen']['ns'] === 222 && $je['ort-djuimen']['ns_name'] === 'Inoffiziell', '🔴 D7: Inoffiziell:-Seite behaelt Key UND Namensraum (X2)');
assert($je['ort-gareth']['ns'] === 0 && $je['ort-gareth']['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Gareth', 'D8: Hauptraum 0, wiki_url unveraendert');
assert($je['ort-weiterleitung']['wiki_key'] === 'wiki:inoffiziell-dju-imen' && $je['ort-weiterleitung']['ns'] === 0 && $je['ort-weiterleitung']['weiterleitung_auf']['ns'] === 222, '🔴 D9: Weiterleitung ueber Namensraeume -- beide Raeume stehen da (X2)');
assert($je['ort-fremd']['wiki_key'] === null && $je['ort-fremd']['ns'] === null, 'D10: fremde Adresse -> kein geratener Key, kein geratener Namensraum');
assert($je['land-weiden']['art'] === 'landschaft' && $je['land-weiden']['wiki_key'] === 'wiki:weiden', 'D11: Landschaftsflaeche ueber wiki_url');
assert($je['land-nur-key']['wiki_key'] === 'wiki:herzogtum-weiden' && $je['land-nur-key']['wiki_url'] === null && $je['land-nur-key']['ns'] === null, 'D12: nur der blanke Slug -> Key ja, Namensraum null (nicht aus dem Slug geraten)');
assert(!isset($je['land-ohne']) && !isset($je['klima-1']) && !isset($je['land-inaktiv']), 'D13: Flaeche ohne Zuweisung, Klimaband, inaktiv: nicht dabei');
assert($je['geb-weiden']['art'] === 'gebiet' && $je['geb-weiden']['wiki_key'] === 'wiki:herzogtum-weiden', 'D14: Herrschaftsgebiet');
assert(!isset($je['geb-name']) && !isset($je['geb-inaktiv']) && !isset($je['geb-myranor']), 'D15: name:-Gebiet, inaktiv, anderer Kontinent: nicht dabei');
$kopf = $x2['kopf'];
assert($kopf['objekte_mit_zuweisung'] === count($x2['objekte']) && $kopf['objekte_ohne_schluessel'] === 1, 'D16: Kopf: Zahl der Objekte, davon 1 ohne Schluessel (fremde Adresse)');
assert($kopf['je_art']['siedlung'] === ['zugewiesen' => 5, 'ohne_zuweisung' => 2], 'D17: Siedlung: 5 zugewiesen (Gareth, Inoffiziell-Seite, fehlt, fremd, Weiterleitung), 2 ohne (ort-ohne, ort-nest-leer)');
assert($kopf['je_art']['weg'] === ['zugewiesen' => 2, 'ohne_zuweisung' => 0] && $kopf['je_art']['gebiet'] === ['zugewiesen' => 1, 'ohne_zuweisung' => 1], 'D18: Weg und Gebiet');
assert($kopf['je_art']['landschaft'] === ['zugewiesen' => 2, 'ohne_zuweisung' => 1], 'D19: Landschaft ohne Klimaband');

$x1 = avesmapsWikiLinkzieleLesen($pdo, 'linkziele');
assert($x1['dump'] === ['run_id' => 5, 'abgeschlossen' => '2026-09-02 07:00:00.000'], 'D20: der juengste ABGESCHLOSSENE Lauf, nicht der laufende und nicht der alte');
$o1 = [];
foreach ($x1['objekte'] as $objekt) {
    $o1[$objekt['public_id']] = $objekt;
}
$g = $o1['ort-gareth'];
assert($g['wiki_key'] === 'wiki:gareth' && $g['ns'] === 0 && $g['seite_art'] === 'settlement', 'D21: Gareth in X1');
assert(array_keys((array) $g['felder']) === ['staat', 'verkehrswege', 'nachbar_n'], 'D22: Gareth: nur Positivlisten-Felder mit Link');
$vw = $g['felder']->verkehrswege;
assert(array_column($vw, 'ziel') === ['Reichsstraße 2', 'Reichsstraße 3', 'Gardel', 'Zedernstraße'], 'D23: „2" -> Reichsstrasse 2, „3" -> Reichsstrasse 3, Gardel');
assert(array_column($vw, 'ziel_key') === ['wiki:reichsstrasse-2', 'wiki:reichsstrasse-3', 'wiki:gardel', 'wiki:raschtulsweg'], 'D24: jedes Ziel traegt seinen kanonischen Key; „Zedernstrasse" ueber die Weiterleitung');
assert($vw[3]['weiterleitung_auf']['wiki_key'] === 'wiki:raschtulsweg' && !isset($vw[0]['weiterleitung_auf']), 'D25: weiterleitung_auf nur bei der getroffenen Weiterleitung');
assert(!str_contains(json_encode($x1, JSON_UNESCAPED_UNICODE), 'Nicht Exportieren'), '🔴 D26: ein Infobox-Feld ausserhalb der Positivliste geht NIE hinaus');

assert($o1['weg-a']['felder']->lage[0]['ziel'] === 'Garetien' && $o1['weg-a']['seite_art'] === 'path', 'D27: Weg: lage');
assert(array_column($o1['weg-b']['felder']->verlauf, 'ziel') === ['Gareth', 'Havena'], 'D28: Weg: Verlauf in Reihenfolge');
assert($o1['kraft-1']['felder']->regionen[0]['ziel'] === 'Weiden', 'D29: Kraftlinie: regionen');
assert($o1['label-weiden']['seite_art'] === 'region' && $o1['land-weiden']['seite_art'] === 'region', 'D30: Landschaft und Region-Beschriftung lesen dieselbe Seite');
assert(!isset($o1['geb-weiden']), 'D31: Herrschaftsgebiete stehen in X2, nicht in X1');

// 🔴 Namensraum in X1: die Inoffiziell:-Seite und ihre Linkziele.
$d = $o1['ort-djuimen'];
assert($d['wiki_key'] === 'wiki:inoffiziell-dju-imen' && $d['ns'] === 222 && $d['seite_titel'] === "Inoffiziell:Dju'imen", 'D32: die Seite selbst: Key, ns 222, Titel mit Praefix');
$nachbarn = [];
foreach (['nachbar_n', 'nachbar_o', 'nachbar_w'] as $feld) {
    $nachbarn[$feld] = $d['felder']->$feld[0];
}
assert($nachbarn['nachbar_o']['ziel'] === 'Inoffiziell:Rossbergen' && $nachbarn['nachbar_o']['ns'] === 222 && $nachbarn['nachbar_o']['ziel_key'] === 'wiki:inoffiziell-rossbergen', 'D33: Linkziel ROH mit Praefix, ns 222, Key mit Namensraum');
assert($nachbarn['nachbar_w']['ziel'] === "Dju'imen" && $nachbarn['nachbar_w']['ns'] === 0 && $nachbarn['nachbar_w']['ziel_key'] === 'wiki:dju-imen', 'D34: derselbe Titel OHNE Praefix ist die offizielle Seite -- ein anderer Key');
assert($nachbarn['nachbar_n']['ziel_key'] === 'wiki:inoffiziell-dju-imen' && $nachbarn['nachbar_n']['ns'] === 0 && $nachbarn['nachbar_n']['weiterleitung_auf']['ns'] === 222 && $nachbarn['nachbar_n']['weiterleitung_auf']['titel'] === "Inoffiziell:Dju'imen", 'D35: Weiterleitung ueber Namensraeume in X1: Ziel 0, Weiterleitung 222');

// ohne_wikitext
$ohne = [];
foreach ($x1['ohne_wikitext'] as $zeile) {
    $ohne[$zeile['public_id']] = $zeile;
}
assert(isset($ohne['ort-fehlt']) && $ohne['ort-fehlt']['grund'] === 'seite_nicht_im_dump', 'D36: Objekt, dessen Seite der Dump nicht hat, steht in ohne_wikitext');
assert(isset($ohne['ort-fremd']) && $ohne['ort-fremd']['wiki_key'] === null, 'D37: auch das Objekt ohne Schluessel steht dort');
assert(!isset($o1['ort-fehlt']), 'D38: es gibt dafuer keine leeren Felder, die wie „keine Links" aussaehen');

// Zaehler
$a = $x1['kopf']['artikel'];
assert($a['mit_wikitext'] === 5, 'D39: fuenf Artikel (Gareth, Reichsstrasse 2, Schwarze Linie, Weiden, Inoffiziell-Seite); die Hauptraum-Seite hat kein Objekt');
assert($a['links_gesamt'] === array_sum(array_map(static fn(array $o): int => array_sum(array_map('count', (array) $o['felder'])), array_values(array_filter($x1['objekte'], static fn(array $o): bool => in_array($o['public_id'], ['ort-gareth', 'weg-a', 'kraft-1', 'label-weiden', 'ort-djuimen'], true))))), 'D40: Zaehler je Artikel, Gegenprobe aus den Objekten (Reichsstrasse 2 einmal, nicht je Abschnitt)');
assert($a['links_pipe'] === 2, 'D41: Pipe-Links (Anzeige != Ziel): nur „Reichsstraßen 2" und „3" bei Gareth');
assert($a['ziele_mit_kartenobjekt'] + $a['ziele_ohne_kartenobjekt'] === $a['ziele_verschieden'], 'D42: Ziele mit + ohne Kartenobjekt = verschiedene Ziele');
$mit = ['wiki:gareth' => 0];
$top = array_column($x1['kopf']['haeufigste_ziele_ohne_kartenobjekt'], 'ziel_key');
assert(in_array('wiki:havena', $top, true) && !in_array('wiki:reichsstrasse-2', $top, true) && !in_array('wiki:weiden', $top, true), 'D43: Top-Liste: Havena hat kein Kartenobjekt, Reichsstrasse 2 und Weiden schon');
assert($x1['kopf']['vorlagen_in_feldern'] == (object) ['Pol' => 1], 'D44: die Pol-Luecke steht im Kopf');
assert($x1['kopf']['objekte_je_art']['siedlung']['mit_wikitext'] === 3 && $x1['kopf']['objekte_je_art']['siedlung']['ohne_wikitext'] === 2 && !isset($x1['kopf']['objekte_je_art']['gebiet']), 'D45: Siedlung 3 mit (Gareth, Inoffiziell-Seite, Weiterleitung) / 2 ohne Wikitext (fehlt, fremd); X1 fuehrt kein Gebiet');

// Ohne abgeschlossenen Lauf: ehrlich leer, kein Fehler.
$leer = fixtureBauen();
$leer->exec("UPDATE wiki_sync_runs SET status = 'failed'");
$ohneLauf = avesmapsWikiLinkzieleLesen($leer, 'linkziele');
assert($ohneLauf['dump'] === ['run_id' => 0, 'abgeschlossen' => ''] && $ohneLauf['objekte'] === [] && count($ohneLauf['ohne_wikitext']) > 0, 'D46: ohne Dump-Lauf stehen ALLE Objekte in ohne_wikitext');

// Der ETag haengt am Inhalt.
$etag1 = avesmapsWikiLinkzieleETag(json_encode($x1), 'linkziele');
assert($etag1 === avesmapsWikiLinkzieleETag(json_encode($x1), 'linkziele') && $etag1 !== avesmapsWikiLinkzieleETag(json_encode($x2), 'linkziele'), 'D47: Inhalts-ETag');

// ============================================================================================
// E. 🔴 NUR LESEND
// ============================================================================================

$pdo = fixtureBauen();
$vorher = datenbankAbzug($pdo);
$pdo->anweisungen = [];
avesmapsWikiLinkzieleLesen($pdo, 'linkziele');
avesmapsWikiLinkzieleLesen($pdo, 'zuordnung');
$nachher = datenbankAbzug($pdo);
assert($pdo->anweisungen !== [], 'E1: der Zeuge hat Anweisungen mitgeschrieben (sonst bewiese E2 nichts)');
foreach ($pdo->anweisungen as $anweisung) {
    assert(preg_match('/^\s*SELECT\b/i', $anweisung) === 1, 'E2: jede Anweisung ist ein SELECT, gefunden: ' . substr($anweisung, 0, 80));
}
assert($vorher === $nachher, '🔴 E3: der Datenbankinhalt ist nach beiden Exporten BYTEGLEICH');

function datenbankAbzug(PDO $pdo): string
{
    $abzug = '';
    $tabellen = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tabellen as $tabelle) {
        $abzug .= $tabelle . ':' . json_encode($pdo->query('SELECT * FROM ' . $tabelle . ' ORDER BY 1')->fetchAll(PDO::FETCH_NUM)) . "\n";
    }

    return $abzug;
}

// E4: der Test erkennt einen Schreiber -- Gegenprobe: ein UPDATE zwischen zwei Abzuegen faellt auf.
$gegenprobe = fixtureBauen();
$a0 = datenbankAbzug($gegenprobe);
$gegenprobe->exec('UPDATE map_revision SET revision = revision + 1');
assert(datenbankAbzug($gegenprobe) !== $a0, 'E4: der Abzug sieht eine Aenderung (Gegenprobe zu E3)');

// E5: kein Schreibwort in den Zeichenketten der Bibliothek und der Endpunkte; keine Ensure-/Schema-Aufrufe.
foreach ([$bibliothekDatei, $linkZieleDatei, $endpunktLinkziele, $endpunktZuordnung] as $datei) {
    $quelle = ohneKommentare((string) file_get_contents($datei));
    foreach (stringLiterale($quelle) as $literal) {
        assert(preg_match('/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b/i', $literal) !== 1, 'E5: Schreibwort in ' . basename($datei) . ': ' . substr($literal, 0, 60));
    }
    assert(!preg_match('/\bEnsure\w*\(|->exec\(|\bbeginTransaction\b|file_put_contents|fopen\(/', $quelle), 'E5: kein Ensure/exec/Transaktion/Dateischreiben in ' . basename($datei));
}

// E6: kein Live-Abruf am Wiki (kein HTTP, keine Wiki-API-Funktion).
$bibliothekQuelle = ohneKommentare((string) file_get_contents($bibliothekDatei));
assert(!preg_match('/avesmapsWikiSyncApi|curl_|file_get_contents\(\s*[\'"]http|stream_context_create|avesmapsWikiSettlementBuildFromTitle/', $bibliothekQuelle), 'E6: kein Abruf am Wiki');

// ============================================================================================
// F. Der Stand bewegt sich waehrend des Lesens
// ============================================================================================

$ausnahme = null;
try {
    // Ein Schreiber, der waehrend des Lesens arbeitet: eine PDO-Huelle, die vor jeder Staende-Abfrage die Revision hebt.
    $huelle = new class('sqlite::memory:') extends PDO {
        public ?PDO $innen = null;

        public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
        {
            if (str_contains($query, 'FROM map_revision')) {
                $this->innen->exec('UPDATE map_revision SET revision = revision + 1');
            }

            return $fetchMode === null ? $this->innen->query($query) : $this->innen->query($query, $fetchMode, ...$fetchModeArgs);
        }

        public function prepare(string $query, array $options = []): PDOStatement|false
        {
            return $this->innen->prepare($query, $options);
        }
    };
    $huelle->innen = fixtureBauen();
    avesmapsWikiLinkzieleLesen($huelle, 'zuordnung');
} catch (AvesmapsWikiLinkzieleExportInBewegung $e) {
    $ausnahme = $e;
}
assert($ausnahme instanceof AvesmapsWikiLinkzieleExportInBewegung, 'F1: bei bewegtem Bestand wirft der Lesepfad (Endpunkt: 503 data_changing), statt einen falschen Stand zu nennen');
$endpunktQuelle = ohneKommentare((string) file_get_contents($bibliothekDatei));
assert(str_contains($endpunktQuelle, "avesmapsErrorResponse(503, 'data_changing'") && str_contains($endpunktQuelle, "header('Retry-After: 10')"), 'F2: 503 data_changing mit Retry-After');

// ============================================================================================
// G. Verdrahtung
// ============================================================================================

foreach ([[$endpunktLinkziele, 'linkziele'], [$endpunktZuordnung, 'zuordnung']] as [$datei, $variante]) {
    $q = ohneKommentare((string) file_get_contents($datei));
    assert(str_contains($q, "avesmapsWikiLinkzieleEndpunkt('" . $variante . "')"), "G1: $variante ruft den gemeinsamen Endpunkt-Rumpf");
    assert(!preg_match('/avesmapsRequire|avesmapsStartSession|avesmapsRequireUser|csrf/i', $q), "G2: $variante verlangt keine Anmeldung");
}
assert(str_contains($bibliothekQuelle, "if (\$requestMethod !== 'GET')") && str_contains($bibliothekQuelle, 'method_not_allowed'), 'G3: nur GET');
assert(!str_contains($bibliothekQuelle, 'getMessage'), 'G4: kein getMessage() an die Oeffentlichkeit');
assert(str_contains($bibliothekQuelle, "header('X-Avesmaps-ETag: '") && str_contains($bibliothekQuelle, 'no-cache, must-revalidate'), 'G5: X-Avesmaps-ETag und Cache-Control: no-cache');

// G6: die Nest-Liste ist die des Konfliktzentrums (dieselbe Reihenfolge ausser wiki_region/wiki_path, die der Lesepfad der Karte tauscht).
$kern = (string) file_get_contents($wurzel . '/api/_internal/conflicts/core.php');
assert(preg_match("/const AVESMAPS_CONFLICT_CLAIM_BLOCKS = \[([^\]]+)\]/", $kern, $m) === 1, 'G6: Konstante im Konfliktzentrum gefunden');
preg_match_all("/'(wiki_\w+)'/", $m[1], $namen);
$deren = $namen[1];
$unsere = array_column(AVESMAPS_WIKI_LINKZIELE_NESTER, 0);
sort($deren);
sort($unsere);
assert($deren === $unsere, 'G6: dieselben vier Nester wie AVESMAPS_CONFLICT_CLAIM_BLOCKS: ' . implode(',', $deren) . ' gegen ' . implode(',', $unsere));

// G7: die Antwort-Schluessel sind die dokumentierten (Test gegen zusaetzliche Felder in den Antworten).
$fixture = fixtureBauen();
$x1 = avesmapsWikiLinkzieleLesen($fixture, 'linkziele');
$erlaubtObjekt = ['public_id', 'art', 'wiki_key', 'ns', 'ns_name', 'seite_art', 'seite_titel', 'felder'];
$alleFelder = [];
foreach (AVESMAPS_WIKI_LINKZIELE_FELDER as $liste) {
    foreach (array_keys($liste) as $feldName) {
        $alleFelder[$feldName] = true;
    }
}
$erlaubtLink = ['anzeige', 'ziel', 'ns', 'ns_name', 'ziel_key', 'weiterleitung_auf'];
foreach ($x1['objekte'] as $objekt) {
    assert(array_diff(array_keys($objekt), $erlaubtObjekt) === [], 'G7: unbekanntes Objektfeld in X1: ' . implode(',', array_diff(array_keys($objekt), $erlaubtObjekt)));
    foreach ((array) $objekt['felder'] as $feldName => $links) {
        assert(isset($alleFelder[$feldName]), "G7: Feld $feldName steht nicht in der Positivliste");
        foreach ($links as $link) {
            assert(array_diff(array_keys($link), $erlaubtLink) === [], 'G7: unbekanntes Linkfeld in X1');
        }
    }
}
$erlaubtZuordnung = ['public_id', 'art', 'feature_type', 'feature_subtype', 'kind', 'region_type', 'gebietsart', 'wiki_url', 'wiki_key', 'wiki_titel', 'ns', 'ns_name', 'weiterleitung_auf'];
foreach (avesmapsWikiLinkzieleLesen($fixture, 'zuordnung')['objekte'] as $objekt) {
    assert(array_diff(array_keys($objekt), $erlaubtZuordnung) === [], 'G8: unbekanntes Feld in X2: ' . implode(',', array_diff(array_keys($objekt), $erlaubtZuordnung)));
}

echo "wiki-linkziele-export-test: alle Zusicherungen erfuellt\n";
