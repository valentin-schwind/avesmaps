<?php

declare(strict_types=1);

/**
 * Die PICKER-SUCHE der Literatur (Aufgabe 8 des Wiki-Zuweisungs-Umbaus, Entwurf
 * docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §5).
 *
 * 🔴 SIE LAEUFT WIRKLICH, GEGEN EINE ECHTE DATENBANK. Der Fehler, den sie fangen soll, sitzt im
 * ABFRAGETEXT -- in den zwei LEFT JOINs, im WHERE und in der Sortierung. Eine Probe, die die Zeilen
 * fertig hereinreicht, bliebe gruen, waehrend die Abfrage sie wegfiltert; genau diese Lehre steht
 * ueber den Aufgaben 3-7 („eine Textprobe misst die FORM des Codes, nicht sein Verhalten") und in
 * api/_internal/app/__tests__/game-literature-resolve-candidates-test.php, dessen Muster diese Datei
 * uebernimmt. Eine In-Memory-SQLite ist das Kleinste, was den ECHTEN Abfragetext ausfuehrt.
 *
 * Lauf (Windows), aus der Wurzel:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/game-literature-search-test.php
 *
 * WAS SIE FESTNAGELT:
 *   1. Der Katalog allein reicht NICHT: ISBN, Verlag und der rohe `Art`-String stehen in
 *      `wiki_publication_catalog`, nicht in `wiki_adventure_catalog`. Der JOIN muss sie mitbringen.
 *   2. Der JOIN ist LEFT, nicht INNER -- ein Werk ohne Publikationszeile darf nicht verschwinden.
 *   3. `belegt_public_id` sagt VOR dem Klick, dass ein Artikel schon an einem anderen Eintrag
 *      haengt. `adventure.wiki_key` traegt einen UNIQUE-Key; ohne die Warnung waere die zweite
 *      Zuweisung ein 500er ohne Erklaerung.
 *   4. Gesucht wird in Titel UND Schluessel (die gefaltete Titelform) -- „mada" findet „Mada".
 *   5. Leerer Suchbegriff => alphabetische Liste, damit beim Oeffnen sofort etwas dasteht.
 *   6. Der `entry`-Arm liefert DIESELBE Huelle wie die Suche (0 oder 1 Zeile).
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere wirkungslos und diese Probe meldete falsches Gruen.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite ist nicht geladen -- erneut mit -d extension=php_pdo_sqlite.dll starten\n");
    exit(2);
}

// 🔴 DIESELBE KETTE, DIE DER ENDPUNKT BINDET (api/edit/wiki/game-literature.php). Kuerzer waere die
// Probe gruen und trotzdem blind: ohne `publication-sync.php` fehlt die Schluesselfaltung
// (avesmapsPublicationCatalogWikiKeyForTitle), die Suche faellt auf ihren Titel-Zweig zurueck, und
// Zusicherung 5b prueft dann nur noch, dass ein Rueckfall existiert. Genau das ist beim ersten Lauf
// dieser Datei passiert.
require __DIR__ . '/../sync.php';
require_once __DIR__ . '/../../political/territory.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../publication-sync.php';
require_once __DIR__ . '/../game-literature-sync.php';

$pruefungen = 0;
$pruef = static function (bool $bedingung, string $meldung) use (&$pruefungen): void {
    $pruefungen++;
    assert($bedingung, $meldung);
};

// ── Die drei Tabellen, in genau den Spalten, die die Abfrage anfasst ──────────────────────────
// ⚠️ NICHT die echten DDLs: die sind MySQL (`ENGINE=InnoDB`, `DATETIME(3)`). Die Spaltennamen sind
// abgeschrieben, nicht erfunden -- wiki_adventure_catalog aus game-literature-sync.php:288-301,
// wiki_publication_catalog aus publication-sync.php:32-42, adventure aus
// api/_internal/app/game-literature.php:27-30.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
// 💣 MySQLs `CHAR_LENGTH` kennt SQLite nicht. Nachgereicht statt die Sortierung zu entschaerfen: die
// Probe soll den ECHTEN Abfragetext fahren, nicht einen fuer sie zurechtgebogenen.
$pdo->sqliteCreateFunction('CHAR_LENGTH', static fn ($wert): int => mb_strlen((string) $wert), 1);
$pdo->exec('CREATE TABLE wiki_adventure_catalog (
    wiki_key TEXT PRIMARY KEY, title TEXT, product_type TEXT, edition TEXT, genre TEXT,
    complexity_gm TEXT, complexity_pl TEXT, authors TEXT, series TEXT, is_official INTEGER,
    fshop_code TEXT, cover_file TEXT, wiki_url TEXT, synced_at TEXT
)');
$pdo->exec('CREATE TABLE wiki_publication_catalog (
    wiki_key TEXT PRIMARY KEY, title TEXT, art TEXT, source_type TEXT, isbn TEXT, publisher TEXT,
    chosen_url TEXT, has_link INTEGER, synced_at TEXT
)');
$pdo->exec('CREATE TABLE adventure (public_id TEXT, wiki_key TEXT, wiki_url TEXT, title TEXT)');

$katalog = $pdo->prepare('INSERT INTO wiki_adventure_catalog
    (wiki_key, title, product_type, edition, genre, complexity_gm, complexity_pl, authors, series,
     is_official, fshop_code, cover_file, wiki_url)
    VALUES (:wk, :t, :pt, :ed, :g, :cgm, :cpl, :au, :se, 1, :fs, :cf, :url)');

$katalog->execute([
    'wk' => 'madas-kelch', 't' => 'Madas Kelch', 'pt' => 'gruppenabenteuer', 'ed' => 'DSA4.1',
    'g' => 'Mystik', 'cgm' => 'mittel', 'cpl' => 'mittel', 'au' => 'Anton Weste',
    'se' => 'Splitterdämmerung', 'fs' => 'US25001', 'cf' => 'Cover_Madas_Kelch.jpg',
    'url' => 'https://de.wiki-aventurica.de/wiki/Madas_Kelch',
]);
$katalog->execute([
    'wk' => 'die-sieben-gezeichneten', 't' => 'Die Sieben Gezeichneten', 'pt' => 'kampagne',
    'ed' => 'DSA4', 'g' => 'Kampagne', 'cgm' => 'hoch', 'cpl' => 'hoch', 'au' => 'Ina Kramer',
    'se' => 'Borbarad-Kampagne', 'fs' => '', 'cf' => '',
    'url' => 'https://de.wiki-aventurica.de/wiki/Die_Sieben_Gezeichneten',
]);
// 🔴 DER FALL FUER PRUEFUNG 2: dieses Werk hat KEINE Zeile im Publikationskatalog. Bei einem INNER
// JOIN verschwaende es lautlos -- und ein Editor suchte im Wiki nach einem Artikel, den es gibt.
$katalog->execute([
    'wk' => 'ohne-publikationszeile', 't' => 'Zwergenschlacht', 'pt' => 'soloabenteuer',
    'ed' => 'DSA5', 'g' => '', 'cgm' => '', 'cpl' => '', 'au' => '', 'se' => '', 'fs' => '', 'cf' => '',
    'url' => 'https://de.wiki-aventurica.de/wiki/Zwergenschlacht',
]);
// 🔴 DER ZWEITE „Kelch" -- er dient allein der SORTIERUNG (Zusicherung 5c). Sein Titel ist mit 29
// Zeichen deutlich laenger als „Madas Kelch"; beide enthalten „Kelch", also entscheidet allein
// `CHAR_LENGTH(c.title) ASC`, welcher oben steht. Ohne diese zweite Zeile lieferte jede Suche genau
// einen Treffer, und die Sortierung waere unpruefbar -- sie war es beim ersten Lauf dieser Datei
// (die Mutation „ASC -> DESC" lief gruen durch).
$katalog->execute([
    'wk' => 'kelch-der-sieben-gezeichneten', 't' => 'Kelch der Sieben Gezeichneten', 'pt' => 'kampagne',
    'ed' => 'DSA4', 'g' => '', 'cgm' => '', 'cpl' => '', 'au' => '', 'se' => '', 'fs' => '', 'cf' => '',
    'url' => 'https://de.wiki-aventurica.de/wiki/Kelch_der_Sieben_Gezeichneten',
]);

$pdo->prepare('INSERT INTO wiki_publication_catalog (wiki_key, title, art, isbn, publisher)
    VALUES (:wk, :t, :art, :isbn, :pub)')->execute([
        'wk' => 'madas-kelch', 't' => 'Madas Kelch', 'art' => 'Abenteuer',
        'isbn' => '978-3-95752-000-0', 'pub' => 'Ulisses Spiele',
    ]);
$pdo->prepare('INSERT INTO wiki_publication_catalog (wiki_key, title, art, isbn, publisher)
    VALUES (:wk, :t, :art, :isbn, :pub)')->execute([
        'wk' => 'die-sieben-gezeichneten', 't' => 'Die Sieben Gezeichneten', 'art' => 'Kampagne',
        'isbn' => '', 'pub' => 'Fantasy Productions',
    ]);

// Ein LEBENDER Eintrag haengt bereits an „Die Sieben Gezeichneten".
$pdo->prepare('INSERT INTO adventure (public_id, wiki_key, wiki_url, title) VALUES (:p, :wk, :u, :t)')
    ->execute([
        'p' => 'A-7GEZ', 'wk' => 'die-sieben-gezeichneten',
        'u' => 'https://de.wiki-aventurica.de/wiki/Die_Sieben_Gezeichneten', 't' => 'Die 7 Gezeichneten',
    ]);

// ── 1) Die Huelle -- dieselbe wie bei den drei Schwestern ─────────────────────────────────────
$alle = avesmapsWikiGameLiteratureSearch($pdo, '', 40);
$pruef(($alle['ok'] ?? false) === true, 'die Antwort traegt kein ok:true');
$pruef(is_array($alle['rows'] ?? null), 'die Antwort traegt keine rows-Liste');
$pruef((int) ($alle['count'] ?? -1) === count($alle['rows']), 'count und rows widersprechen sich');

// ── 2) LEERER SUCHBEGRIFF => alphabetische Liste, ALLE drei Werke ─────────────────────────────
// 💣 Auch das ohne Publikationszeile. Faellt der JOIN von LEFT auf INNER, steht hier 2 statt 3.
$pruef(count($alle['rows']) === 4, 'der leere Suchbegriff liefert ' . count($alle['rows']) . ' statt 4 Werken');
$titel = array_column($alle['rows'], 'title');
$pruef($titel === ['Die Sieben Gezeichneten', 'Kelch der Sieben Gezeichneten', 'Madas Kelch', 'Zwergenschlacht'],
    'die Liste ist nicht alphabetisch: ' . implode(' | ', $titel));

// ── 3) 🔴 DER JOIN BRINGT ISBN, VERLAG UND DEN ROHEN `Art`-STRING ─────────────────────────────
// Der Literaturkatalog fuehrt keines der drei; ohne den JOIN staenden im Kasten drei leere Zeilen
// und in der Trefferzeile der Slug „gruppenabenteuer" statt „Abenteuer".
$kelch = array_values(array_filter($alle['rows'], static fn ($z) => $z['wiki_key'] === 'madas-kelch'))[0];
$pruef(($kelch['art'] ?? null) === 'Abenteuer', 'der rohe Art-String kommt nicht an: ' . var_export($kelch['art'] ?? null, true));
$pruef(($kelch['isbn'] ?? null) === '978-3-95752-000-0', 'die ISBN kommt nicht an');
$pruef(($kelch['publisher'] ?? null) === 'Ulisses Spiele', 'der Verlag kommt nicht an');
// Und die Katalogspalten selbst, damit der JOIN nicht die eigene Zeile verdraengt.
$pruef(($kelch['product_type'] ?? null) === 'gruppenabenteuer', 'der Produkttyp kommt nicht an');
$pruef(($kelch['edition'] ?? null) === 'DSA4.1', 'das Regelsystem kommt nicht an');
$pruef(($kelch['series'] ?? null) === 'Splitterdämmerung', 'die Reihe kommt nicht an');
$pruef(($kelch['cover_file'] ?? null) === 'Cover_Madas_Kelch.jpg', 'die Cover-Datei kommt nicht an');
$pruef(($kelch['wiki_url'] ?? null) === 'https://de.wiki-aventurica.de/wiki/Madas_Kelch', 'die Adresse kommt nicht an');

// ── 4) 🔴 DIE BELEGT-WARNUNG -- KENNUNG UND ANZEIGE GETRENNT ──────────────────────────────────
// 💣 Ein zweiter Eintrag auf denselben Artikel ist ein UNIQUE-Verstoss und damit ein 500er ohne
// Erklaerung. Die Warnung steht deshalb VOR dem Klick im Treffer.
$gezeichnete = array_values(array_filter($alle['rows'], static fn ($z) => $z['wiki_key'] === 'die-sieben-gezeichneten'))[0];
$pruef(($gezeichnete['belegt_public_id'] ?? null) === 'A-7GEZ', 'die belegende Kennung kommt nicht an');
// 🔴 Der TITEL des belegenden Eintrags, nicht der des Artikels -- sie unterscheiden sich hier
// absichtlich („Die 7 Gezeichneten" gegen „Die Sieben Gezeichneten"). Genau das soll der Editor lesen.
$pruef(($gezeichnete['belegt_titel'] ?? null) === 'Die 7 Gezeichneten',
    'die Anzeige nennt nicht den Titel des belegenden Eintrags: ' . var_export($gezeichnete['belegt_titel'] ?? null, true));
// ⚠️ `?? ` taugt hier NICHT: der LEFT JOIN liefert echtes NULL, und `?? 'x'` machte daraus 'x' --
// die Zusicherung praefte dann sich selbst. Gefragt wird nach dem Wert, nicht nach seinem Ersatz.
$pruef(array_key_exists('belegt_public_id', $kelch) && $kelch['belegt_public_id'] === null,
    'ein freier Artikel wird faelschlich als belegt gemeldet: ' . var_export($kelch['belegt_public_id'] ?? '(fehlt)', true));

// ── 5) DIE SUCHE FILTERT WIRKLICH ─────────────────────────────────────────────────────────────
$treffer = avesmapsWikiGameLiteratureSearch($pdo, 'Madas', 40);
$pruef(count($treffer['rows']) === 1, 'die Suche filtert nicht: ' . count($treffer['rows']) . ' Treffer');
$pruef($treffer['rows'][0]['wiki_key'] === 'madas-kelch', 'die Suche findet das falsche Werk');

// 🔴 UEBER DEN SCHLUESSEL, ALSO KLEINGESCHRIEBEN UND GEFALTET. `wiki_key` IST die gefaltete
// Titelform; ohne den zweiten WHERE-Arm bliebe das der Zufall der Kollation.
// 💣 Und die Vorbedingung wird MITGEPRUEFT: faellt die Faltung aus (Bibliothek nicht gebunden),
// sucht nur noch der Titel -- die Zusicherung darunter bliebe gruen, ohne den Zweig zu beruehren.
$pruef(function_exists('avesmapsPublicationCatalogWikiKeyForTitle'),
    'die Schluesselfaltung ist nicht gebunden -- der Schluessel-Zweig der Suche wird gar nicht gefahren');
$pruef(avesmapsPublicationCatalogWikiKeyForTitle('Madas Kelch') === 'madas-kelch',
    'die Faltung liefert einen anderen Schluessel als die Fixture -- die Probe misst dann etwas anderes');
$klein = avesmapsWikiGameLiteratureSearch($pdo, 'madas-kelch', 40);
$pruef(count($klein['rows']) === 1 && $klein['rows'][0]['wiki_key'] === 'madas-kelch',
    'die Suche ueber den Schluessel findet nichts');

// ── 5c) 🔴 DIE SORTIERUNG DER TREFFER: DER KUERZERE TITEL STEHT OBEN ──────────────────────────
// 💣 Beide Werke enthalten „Kelch", keines ist ein Volltreffer auf den Schluessel -- es entscheidet
// allein `CHAR_LENGTH(c.title) ASC`. Der naheliegende Treffer gehoert nach oben, sonst muss der
// Editor in einer 40 Zeilen langen Liste suchen, was er gerade getippt hat.
$kelchSuche = avesmapsWikiGameLiteratureSearch($pdo, 'Kelch', 40);
$kelchTitel = array_column($kelchSuche['rows'], 'title');
$pruef($kelchTitel === ['Madas Kelch', 'Kelch der Sieben Gezeichneten'],
    'die Trefferliste ist nicht nach Titellaenge sortiert: ' . implode(' | ', $kelchTitel));

// Nichts gefunden ist ein gueltiger Zustand, kein Fehler.
$leer = avesmapsWikiGameLiteratureSearch($pdo, 'Gibtesnicht', 40);
$pruef(($leer['ok'] ?? false) === true && $leer['rows'] === [], 'ein Nichttreffer ist kein sauberer Leerzustand');

// ── 6) DER DECKEL WIRKT ───────────────────────────────────────────────────────────────────────
$gedeckelt = avesmapsWikiGameLiteratureSearch($pdo, '', 2);
$pruef(count($gedeckelt['rows']) === 2, 'der Deckel kommt nicht an: ' . count($gedeckelt['rows']) . ' Zeilen');

// ── 7) DER `entry`-ARM: DIESELBE HUELLE, 0 ODER 1 ZEILE ───────────────────────────────────────
// 💣 Er ist der Grund, warum eine GESPEICHERTE Zuweisung ueberhaupt etwas anzeigen kann: `adventure`
// hat kein Wiki-Nest wie Ort, Weg und Landschaft.
$satz = avesmapsWikiGameLiteratureEntry($pdo, 'madas-kelch');
$pruef(($satz['ok'] ?? false) === true && count($satz['rows']) === 1, 'der entry-Arm liefert den Satz nicht');
$pruef($satz['rows'][0]['isbn'] === '978-3-95752-000-0', 'der entry-Arm laesst den JOIN aus');
$fehlend = avesmapsWikiGameLiteratureEntry($pdo, 'gibtesnicht');
$pruef(($fehlend['ok'] ?? false) === true && $fehlend['rows'] === [], 'ein unbekannter Schluessel ist kein sauberer Leerzustand');
// 🔴 DER SCHLUESSEL WIRD BESCHNITTEN. Das ist der pruefbare Teil des Riegels: die Zuweisung reicht
// den Wert aus einer gespeicherten Zeile herein, und ein Rand-Leerzeichen darf den Satz nicht
// verschwinden lassen -- der Kasten staende dann bei einer VORHANDENEN Zuweisung leer da.
$geraendert = avesmapsWikiGameLiteratureEntry($pdo, '  madas-kelch  ');
$pruef(count($geraendert['rows']) === 1, 'ein Schluessel mit Rand-Leerzeichen findet den Satz nicht');
// ⚠️ Ein LEERER Schluessel liefert dieselbe saubere Leerform. Der fruehe Ausstieg spart nur die
// Abfrage -- DASS er sie spart, prueft diese Zusicherung ausdruecklich NICHT (dafuer muesste sie
// Abfragen zaehlen); sie prueft die FORM, auf die sich die Oberflaeche verlaesst.
$ohne = avesmapsWikiGameLiteratureEntry($pdo, '   ');
$pruef(($ohne['ok'] ?? false) === true && $ohne['rows'] === [], 'ein leerer Schluessel liefert keine saubere Leerform');

echo "game-literature-search: " . $pruefungen . " Zusicherungen erfuellt\n";
