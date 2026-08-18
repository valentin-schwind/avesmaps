<?php

declare(strict_types=1);

// avesmapsLoreReadPlaceKeysOnMap -- die Datengrundlage des Statuskreises der Vorkommen-Liste.
//
// 🔴 WAS DIESER TEST BEWEISEN KANN UND WAS NICHT. Die Fixture ist SQLite. Zwei der vier Familien
// fragen indizierte Spalten mit gewoehnlichem SQL (`political_territory.wiki_key`,
// `ecosystem_region.wiki_region_key`) -- die laufen hier wirklich. Die anderen zwei (Ort und
// Landschaftslabel) lesen das Zuweisungsnest aus `map_features.properties_json` und benutzen dafuer
// `JSON_UNQUOTE(JSON_EXTRACT(...))`, das SQLite nicht kennt.
//
// 💣 VERBOGEN WIRD DAFUER NICHTS. Die Produktionsform bleibt MySQL (AGENTS.md §9: „wer die
// Produktionsform verbiegt, damit ein Test laeuft, hat den Test gegen die Produktion gedreht").
// Statt eine gruene Zusicherung vorzutaeuschen, sagt dieser Test es aus: die JSON-Zweige sind hier
// UNGEPRUEFT und nur an ihrer Schreibweise gegen die zwei Stellen im Haus abgeglichen, die sie
// bereits fahren (api/app/place-kinds.php:58, api/_internal/map/features.php:2429).
// ⚠️ Die zweite Haelfte davon ist die Fehlermeldung im `catch`: faellt einer der JSON-Zweige live
// um, steht das im Fehlerprotokoll -- ohne sie sieht ein SQL-Fehler exakt aus wie „nichts liegt
// auf der Karte", und das ist die Falle vom 15.08.2026 (HY093, „Was ist hier?").
//
// Lauf: php -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll \
//           api/_internal/app/__tests__/lore-orte-auf-der-karte-test.php

require_once __DIR__ . '/../lore.php';

// Das Fehlerprotokoll in eine Datei umlenken -- aus zwei Gruenden. Erstens laufen die zwei
// JSON-Zweige hier zwangslaeufig auf einen SQLite-Fehler und wuerden den Testlauf zumuellen.
// Zweitens, und das ist der eigentliche Grund: die Meldung IST eine Zusicherung. Ohne sie ist ein
// SQL-Fehler von „nichts liegt auf der Karte" nicht zu unterscheiden.
$protokoll = tempnam(sys_get_temp_dir(), 'lore-map-log');
ini_set('log_errors', '1');
ini_set('error_log', $protokoll);

$pruefungen = 0;

function avesmapsLoreTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY, wiki_key TEXT, is_active INTEGER)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, wiki_region_key TEXT, is_active INTEGER)');

    return $pdo;
}

// ── (0) Ohne Schluessel gar keine Abfrage ───────────────────────────────────────────────────────
$pdo = avesmapsLoreTestPdo();
assert(avesmapsLoreReadPlaceKeysOnMap($pdo, []) === [], 'Eine leere Anfrage liefert eine leere Antwort.');
// ⚠️ Der leere Schluessel steht NIE in der Antwort. Getragen wird das von ZWEI Stellen -- dem
// Filter vor der Abfrage und dem `unset($found[''])` danach -- also zeigt eine Mutation an einer
// von beiden hier nichts. Das ist Absicht (Guertel und Hosentraeger) und wird hier so gesagt,
// statt der Zusicherung eine Schaerfe anzudichten, die sie nicht hat.
$pdo->exec("INSERT INTO ecosystem_region (wiki_region_key, is_active) VALUES ('', 1)");
assert(avesmapsLoreReadPlaceKeysOnMap($pdo, ['', '   ']) === [],
    'Eine Anfrage aus lauter leeren Schluesseln liefert nichts -- und „“ waere als Treffer sinnlos: '
    . 'er kaeme aus einer Zeile ohne Zuweisung und faerbte ein Vorkommen faelschlich voll.');
$pruefungen += 2;

// ── (1) Herrschaftsgebiet: das Praefix steht in der TABELLE, nicht in der Anfrage ───────────────
// 💣 `political_territory.wiki_key` traegt `wiki:` (mit Artikel) oder `name:` (ohne)
// -- avesmapsPoliticalBuildWikiKey. `lore_place.place_wiki_key` traegt den BLANKEN Slug. Wer die
// beiden ungefiltert vergleicht, findet nie etwas, und der Kreis waere fuer jedes Gebiet halb.
$pdo = avesmapsLoreTestPdo();
$pdo->exec("INSERT INTO political_territory (wiki_key, is_active) VALUES
    ('wiki:weiden', 1), ('name:eigenes-gebiet', 1), ('wiki:versenkt', 0)");
$treffer = avesmapsLoreReadPlaceKeysOnMap($pdo, ['weiden', 'eigenes-gebiet', 'versenkt', 'gibtesnicht']);
assert(isset($treffer['weiden']), 'Ein Gebiet mit Wiki-Artikel muss ueber seinen blanken Slug gefunden werden.');
assert(isset($treffer['eigenes-gebiet']),
    'Auch ein eigener Knoten (`name:`) zeigt seine Vorkommen -- der Lesepfad strippt beide '
    . 'Praefixe (avesmapsLoreStripKeyPrefix), also muss dieser Leser beide fragen.');
assert(!isset($treffer['versenkt']), 'Ein Gebiet im Papierkorb (is_active = 0) liegt nicht auf der Karte.');
assert(!isset($treffer['gibtesnicht']), 'Was es nicht gibt, wird nicht gemeldet.');
$pruefungen += 4;

// ── (2) Landschaftsflaeche: blanker Slug, aber `is_active` gilt auch hier ───────────────────────
$pdo = avesmapsLoreTestPdo();
$pdo->exec("INSERT INTO ecosystem_region (wiki_region_key, is_active) VALUES
    ('meer-der-sieben-winde', 1), ('geloescht', 0), (NULL, 1)");
$treffer = avesmapsLoreReadPlaceKeysOnMap($pdo, ['meer-der-sieben-winde', 'geloescht']);
assert(isset($treffer['meer-der-sieben-winde']), 'Eine zugewiesene Landschaftsflaeche zaehlt.');
assert(!isset($treffer['geloescht']), 'Eine geloeschte Flaeche zaehlt nicht.');
assert(count($treffer) === 1, 'Und sonst nichts -- eine Flaeche ohne Zuweisung (NULL) darf nichts beitragen.');
$pruefungen += 3;

// ── (3) Beide Familien zusammen, und der Schluessel steht nur EINMAL im Ergebnis ────────────────
$pdo = avesmapsLoreTestPdo();
$pdo->exec("INSERT INTO political_territory (wiki_key, is_active) VALUES ('wiki:albernia', 1)");
$pdo->exec("INSERT INTO ecosystem_region (wiki_region_key, is_active) VALUES ('albernia', 1)");
$treffer = avesmapsLoreReadPlaceKeysOnMap($pdo, ['albernia']);
assert($treffer === ['albernia' => true],
    'Derselbe Ort in zwei Familien ist EIN Treffer -- die Antwort ist eine Menge, keine Liste.');
$pruefungen++;

// ── (4) DIE SICHERE RICHTUNG: fehlt eine Tabelle, faellt die Familie AUS, nicht die Antwort ─────
// 🔴 Ein Fehlschlag darf nie „liegt auf der Karte" behaupten. Er darf hoechstens einen echten
// Treffer verschweigen -- dann steht die Zeile als „nicht verortet" da, und das ist die Richtung,
// in der ein Irrtum niemanden zu einer falschen Bearbeitung verleitet.
$leer = new PDO('sqlite::memory:');
$leer->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
assert(avesmapsLoreReadPlaceKeysOnMap($leer, ['weiden', 'schiff']) === [],
    'Ohne jede Tabelle (frische Installation) darf nichts als „auf der Karte" gemeldet werden -- '
    . 'und die Abfrage darf nicht durchschlagen.');
$pruefungen++;

// ── (5) Kein Namensvergleich, kein Abschneiden von Klammerzusaetzen ─────────────────────────────
// ⚠️ Der Spotlight-Loeser (resolveSpotlightLorePlace) kennt beides, weil er einen ANFLUGPUNKT
// sucht. Hier steht die Frage „ist das zugewiesen?", und eine Vermutung waere die falsche Antwort.
// Am Livebestand kostet das 3 von 5104 Eintraegen (18.08.2026 gemessen) -- der Preis ist bekannt.
$pdo = avesmapsLoreTestPdo();
$pdo->exec("INSERT INTO ecosystem_region (wiki_region_key, is_active) VALUES ('nostria', 1)");
$treffer = avesmapsLoreReadPlaceKeysOnMap($pdo, ['nostria-siedlung']);
assert($treffer === [],
    'Ein Klammerzusatz („Nostria (Siedlung)" -> `nostria-siedlung`) darf NICHT auf `nostria` '
    . 'zurueckgeschnitten werden. Das waere geraten, und geraten wird hier nicht.');
$pruefungen++;

// ── (6) EIN FEHLSCHLAG MUSS SICHTBAR SEIN ──────────────────────────────────────────────────────
// 🔴 Die eigentliche Absicherung der zwei JSON-Zweige, die hier nicht laufen koennen: sie
// SCHWEIGEN nicht. In dieser Fixture fehlt `map_features`, also fallen beide um -- und genau das
// muss im Fehlerprotokoll stehen. Ohne diese Meldung sieht ein SQL-Fehler live exakt so aus wie
// „kein Vorkommen liegt auf der Karte", und niemand haette einen Anhaltspunkt.
$log = (string) @file_get_contents($protokoll);
@unlink($protokoll);
foreach (['location', 'label'] as $familie) {
    assert(str_contains($log, 'lore place-on-map lookup (' . $familie . ') failed'),
        "Der Fehlschlag der Familie '{$familie}' steht nicht im Fehlerprotokoll. Ein stiller "
        . '`catch` macht aus einem SQL-Fehler eine Liste, in der jede Zeile „nicht verortet" sagt.');
    $pruefungen++;
}

echo "lore-orte-auf-der-karte: {$pruefungen} Zusicherungen bestanden "
    . "(Territorium + Landschaftsflaeche; die zwei JSON-Zweige sind SQLite-fremd und nur ueber "
    . "ihre Fehlermeldung geprueft).\n";
