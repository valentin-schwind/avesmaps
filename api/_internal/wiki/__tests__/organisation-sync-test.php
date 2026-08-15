<?php

declare(strict_types=1);

/**
 * Die Sitze der Handelsorganisationen -- vom Wikitext bis zur fertigen Innerorts-Zeile.
 *
 * ⭐ Dieser Test fährt eine echte (SQLite-)Datenbank. Der reine Parser hat seinen eigenen Test
 * ohne DB (organisation-seats-test.php); hier geht es um das, was nur mit Tabelle beweisbar
 * ist: der Build-Schritt, das delete+insert und die Zeilenform, die Suche und Stätten-Zeile
 * lesen.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/organisation-sync-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test braucht eine echte Datenbank.\n");
    exit(2);
}

require __DIR__ . '/../organisation-seats.php';

// Die Sync-Datei zieht Dump-Helfer nach, die hier nicht gebraucht werden. Statt den halben
// Wiki-Stapel zu laden, werden die drei benutzten Funktionen als Attrappe bereitgestellt --
// der Build-Schritt bekommt seine Seiten ohnehin über die Test-Naht $pageSource.
if (!function_exists('avesmapsWikiSyncMonitorInfoboxName')) {
    function avesmapsWikiSyncMonitorInfoboxName(string $wikitext): string {
        return preg_match('/\{\{\s*Infobox ([^\r\n|}]*)/u', $wikitext, $m) === 1 ? trim($m[1]) : '';
    }
}
if (!function_exists('avesmapsWikiSyncMonitorFieldKey')) {
    function avesmapsWikiSyncMonitorFieldKey(string $name): string {
        return mb_strtolower(trim($name), 'UTF-8');
    }
}
if (!function_exists('avesmapsWikiSyncMonitorPageUrl')) {
    function avesmapsWikiSyncMonitorPageUrl(string $title): string {
        return 'https://de.wiki-aventurica.de/wiki/' . str_replace(' ', '_', $title);
    }
}
if (!defined('AVESMAPS_WIKI_DUMP_STEP_SECONDS')) {
    define('AVESMAPS_WIKI_DUMP_STEP_SECONDS', 28);
}

require __DIR__ . '/../organisation-sync.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// ⚠️ SQLite kennt weder ENGINE noch Praefix-Indizes. Die Tabelle wird hier in ihrer
// SQLite-Entsprechung angelegt; geprueft wird das VERHALTEN des Build-Schritts, nicht die
// MySQL-DDL (die steht in avesmapsOrgSeatEnsureStagingTable und wird von MySQL selbst geprueft).
$pdo->exec('CREATE TABLE ' . AVESMAPS_ORG_SEAT_TABLE . ' (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organisation_title TEXT NOT NULL,
    organisation_art TEXT NULL,
    place_raw TEXT NOT NULL,
    role TEXT NOT NULL,
    wiki_url TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NULL,
    UNIQUE (organisation_title, place_raw)
)');
// ⚠️ Der Build-Schritt bekommt $ensureSchema=false -- seine DDL ist MySQL-Syntax und wuerde
// unter SQLite werfen. Dieselbe Test-Naht wie $pageSource; im Betrieb steht sie nie auf false.
$seiten = [
    ['title' => 'Nordlandbank', 'ns' => 0, 'redirect' => null, 'wikitext' =>
        "{{Infobox Organisation\n|Art=[[Bankhaus]]\n|Hauptsitz=[[Festum]]\n"
        . "|Weitere Sitze=[[Gareth]], [[Grangor]], [[Mendena]] <small>(ehemals)</small>\n}}\n"],
    ['title' => 'Albenhuser Bund', 'ns' => 0, 'redirect' => null, 'wikitext' =>
        "{{Infobox Organisation\n|Art=[[Handelsgesellschaft]]\n|Hauptsitz=[[Albenhus]]\n"
        . "|Weitere Sitze=Kontore: [[Havena (Siedlung)|Havena]], [[Ferdok]]\n}}\n"],
    // Eine Organisation OHNE Sitze -- 68 der 140 Artikel sind so.
    ['title' => 'Ohne Sitz', 'ns' => 0, 'redirect' => null, 'wikitext' =>
        "{{Infobox Organisation\n|Art=[[Handelsgesellschaft]]\n|Name=Ohne Sitz\n}}\n"],
    // Fremde Infobox -- darf nichts erzeugen.
    ['title' => 'Burg Wallenstein', 'ns' => 0, 'redirect' => null, 'wikitext' =>
        "{{Infobox Bauwerk\n|Art=Burg\n|Standort=[[Kosch]]\n}}\n"],
    // Weiterleitung und Vorlagen-Namensraum -- beide raus.
    ['title' => 'Alte Bank', 'ns' => 0, 'redirect' => 'Nordlandbank', 'wikitext' =>
        "{{Infobox Organisation\n|Hauptsitz=[[Gareth]]\n}}\n"],
    ['title' => 'Vorlage:Infobox Organisation', 'ns' => 10, 'redirect' => null, 'wikitext' =>
        "{{Infobox Organisation\n|Hauptsitz=[[Gareth]]\n}}\n"],
];
// ⚠️ Normale Closure mit REFERENZ, keine Arrow-Function: `fn` bindet $seiten per WERT, und die
// spaeteren Laeufe unten aendern die Fixture absichtlich, um delete+insert zu pruefen.
$quelle = static function (string $pfad, int $skip) use (&$seiten): iterable {
    return array_slice($seiten, max(0, $skip));
};

$r = avesmapsOrgSeatBuildStep($pdo, '(egal)', 0, $quelle, false);
assert($r['ok'] === true);
assert($r['done'] === true, 'die Quelle ist erschoepft');
assert($r['pages_scanned'] === 6, 'alle sechs Seiten gescannt: ' . $r['pages_scanned']);
assert($r['found_this_step'] === 2, 'zwei Organisationen MIT Sitzen: ' . $r['found_this_step']);

$alle = $pdo->query('SELECT * FROM ' . AVESMAPS_ORG_SEAT_TABLE . ' ORDER BY organisation_title, sort_order')
    ->fetchAll(PDO::FETCH_ASSOC);
assert(count($alle) === 6, 'Nordlandbank 3 + Albenhuser Bund 3 = 6, ohne die toten: ' . count($alle));

// 💣 Der aufgeloeste Sitz („ehemals") steht NICHT drin -- am Stueck geprueft, nicht am Feld.
$orte = array_column($alle, 'place_raw');
assert(!in_array('[[Mendena]] <small>(ehemals)</small>', $orte, true), 'toter Sitz nicht gespeichert');
assert(in_array('[[Gareth]]', $orte, true), 'die lebenden neben ihm sehr wohl');

// Genau EIN Hauptsitz je Organisation.
$haupt = array_values(array_filter($alle, static fn(array $r): bool => $r['role'] === 'hauptsitz'));
assert(count($haupt) === 2, 'ein Hauptsitz je Organisation: ' . count($haupt));

// Fremde Infobox, Weiterleitung und ns10 haben nichts erzeugt.
$titel = array_unique(array_column($alle, 'organisation_title'));
assert(!in_array('Burg Wallenstein', $titel, true), 'fremde Infobox erzeugt nichts');
assert(!in_array('Alte Bank', $titel, true), 'eine Weiterleitung ist keine Organisation');
assert(!in_array('Vorlage:Infobox Organisation', $titel, true), 'ns10 ist keine Organisation');

// ---------------------------------------------------------- DIE ZEILENFORM ---
// 💣 Sie muss der eines Bauwerks GLEICHEN, sonst braucht der reine Teil der Innerorts-Liste
// einen Sonderfall -- und ein Sonderfall dort waere die Divergenz zwischen Suche und
// Staetten-Zeile, die beide dieselbe Liste lesen.
$zeilen = avesmapsOrgSeatFetchInSettlementRows($pdo);
assert(count($zeilen) === 6);
foreach ($zeilen as $z) {
    assert(array_keys($z) === ['title', 'raw', 'type_label', 'deity', 'wiki_url'],
        'gleiche Schluessel wie eine Bauwerkszeile: ' . implode(',', array_keys($z)));
    assert($z['deity'] === '', 'eine Handelsgesellschaft hat keine Weihung');
}

// Die Rolle steht im Typ, nicht im Namen -- der Name IST schon die Organisation.
$festum = array_values(array_filter($zeilen, static fn(array $z): bool => $z['raw'] === '[[Festum]]'))[0];
assert($festum['title'] === 'Nordlandbank');
assert($festum['type_label'] === 'Bankhaus (Hauptsitz)', $festum['type_label']);
$gareth = array_values(array_filter($zeilen, static fn(array $z): bool => $z['raw'] === '[[Gareth]]'))[0];
assert($gareth['type_label'] === 'Bankhaus', 'ein Zweigsitz nennt nur die Art: ' . $gareth['type_label']);

// 💣 DELETE + INSERT: verliert eine Organisation im Wiki einen Sitz, verschwindet er auch hier.
// Ein reines Upsert liesse ihn fuer immer stehen -- das Staging soll ein Spiegel des Dumps sein,
// nicht dessen Summe ueber alle Laeufe.
$seiten[0]['wikitext'] = "{{Infobox Organisation\n|Art=[[Bankhaus]]\n|Hauptsitz=[[Festum]]\n}}\n";
avesmapsOrgSeatBuildStep($pdo, '(egal)', 0, $quelle, false);
$nachher = $pdo->query("SELECT place_raw FROM " . AVESMAPS_ORG_SEAT_TABLE
    . " WHERE organisation_title = 'Nordlandbank'")->fetchAll(PDO::FETCH_COLUMN);
assert($nachher === ['[[Festum]]'], 'gestrichene Sitze verschwinden: ' . implode(',', $nachher));

// Und eine Organisation, die ALLE Sitze verliert, wird leer -- nicht eingefroren.
$seiten[1]['wikitext'] = "{{Infobox Organisation\n|Art=[[Handelsgesellschaft]]\n}}\n";
avesmapsOrgSeatBuildStep($pdo, '(egal)', 0, $quelle, false);
$leer = $pdo->query("SELECT COUNT(*) FROM " . AVESMAPS_ORG_SEAT_TABLE
    . " WHERE organisation_title = 'Albenhuser Bund'")->fetchColumn();
assert((int) $leer === 0, 'alle Sitze gestrichen -> keine Zeile mehr');

// ------------------------------------------------- FEHLENDE TABELLE FAELLT NICHT ---
// ⚠️ Die Lehre vom 15.08.2026: ein Leser darf an einer fehlenden Tabelle nicht die ganze
// Innerorts-Liste mitreissen.
$leerDb = new PDO('sqlite::memory:');
$leerDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
assert(avesmapsOrgSeatFetchInSettlementRows($leerDb) === [], 'ohne Tabelle: leere Liste, kein Wurf');

echo "organisation-sync: alle Zusicherungen erfuellt\n";
