<?php

declare(strict_types=1);

/**
 * Die PICKER-SUCHE der KARTEN (Aufgabe 9 des Wiki-Zuweisungs-Umbaus, Entwurf
 * docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §8).
 *
 * 🔴 SIE LAEUFT WIRKLICH, GEGEN EINE ECHTE DATENBANK -- dieselbe Lehre und dasselbe Muster wie
 * __tests__/game-literature-search-test.php: der Fehler, den sie fangen soll, sitzt im ABFRAGETEXT
 * (im WHERE, in der Sortierung, in den ausgewaehlten Spalten). Eine Probe, die die Zeilen fertig
 * hereinreicht, bliebe gruen, waehrend die Abfrage sie wegfiltert.
 *
 * Lauf (Windows), aus der Wurzel:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/citymap-article-search-test.php
 *
 * WAS SIE FESTNAGELT:
 *   1. 💣 GESUCHT WIRD IN `wiki_sync_pages`, NICHT IN `wiki_citymap_catalog`. Die Verwechslung ist
 *      die ganze Falle dieser Objektart: der Katalog traegt INDEXZEILEN, deren Schluessel
 *      `index:stadt:quelle:variante` lautet -- keine Seite. Die Probe legt beide Tabellen an und
 *      fuellt den Katalog mit einer Zeile, die bei der Suche NIE auftauchen darf.
 *   2. Der exakte Titel steht vorn, danach der kuerzeste -- „Gareth" vor „Garether Handelskontor".
 *   3. Jeder Treffer traegt seine SEITENART mit. Sie ist keine Zierde: sie sagt dem Editor, dass er
 *      gerade die Seite einer STADT zuweist, und genau dieser Missgriff wird hinterher zum Fall im
 *      Konfliktzentrum.
 *   4. Fehlt `settlement_label`, wird es aus der Klasse abgeleitet -- nicht leer gelassen.
 *   5. Leerer Suchbegriff => alphabetische Liste, damit beim Oeffnen sofort etwas dasteht.
 *   6. Der Deckel wirkt und wird auf 1..80 eingefangen.
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

// 🔴 DIESELBE KETTE, DIE DER ENDPUNKT BINDET (api/edit/wiki/citymaps.php), abzueglich dessen, was
// nur MySQL kann. `political/territory.php` traegt avesmapsPoliticalSlug -- ohne sie stuende in
// jedem Treffer ein LEERER Schluessel, und die Zuweisung speicherte ihn genauso.
require __DIR__ . '/../sync.php';
require_once __DIR__ . '/../../political/territory.php';
require_once __DIR__ . '/../citymap-sync.php';

$pruefungen = 0;
$pruef = static function (bool $bedingung, string $meldung) use (&$pruefungen): void {
    $pruefungen++;
    assert($bedingung, $meldung);
};

// ── Die Tabellen, in genau den Spalten, die die Abfrage anfasst ───────────────────────────────
// ⚠️ NICHT die echten DDLs: die sind MySQL (`ENGINE=InnoDB`, `DATETIME(3)`). Die Spaltennamen sind
// dieselben -- daran haengt der Beweis.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE wiki_sync_pages (
        title TEXT NOT NULL,
        normalized_key TEXT NOT NULL DEFAULT "",
        wiki_url TEXT NOT NULL DEFAULT "",
        settlement_class TEXT NULL,
        settlement_label TEXT NULL,
        continent TEXT NULL
     )'
);
// 💣 DIE FALSCHE QUELLE, ausdruecklich vorhanden. Faende die Suche sie, waere der Bauschluessel als
// Artikel-Identitaet zurueck -- genau das, was Entwurf §8 verbietet.
$pdo->exec(
    'CREATE TABLE wiki_citymap_catalog (
        wiki_key TEXT NOT NULL,
        title TEXT NOT NULL
     )'
);
$pdo->prepare('INSERT INTO wiki_citymap_catalog (wiki_key, title) VALUES (?, ?)')
    ->execute(['stadtplan:gareth:der-fluch-des-hexers:farbe', 'Stadtplan von Gareth (Der Fluch des Hexers)']);

$seite = $pdo->prepare(
    'INSERT INTO wiki_sync_pages (title, normalized_key, wiki_url, settlement_class, settlement_label, continent)
     VALUES (?, ?, ?, ?, ?, ?)'
);
$seite->execute(['Gareth', 'gareth', 'https://de.wiki-aventurica.de/wiki/Gareth', 'metropole', 'Metropole', 'Aventurien']);
$seite->execute(['Garether Handelskontor', 'garether-handelskontor', 'https://de.wiki-aventurica.de/wiki/Garether_Handelskontor', 'gebaeude', 'Gebäude', 'Aventurien']);
// Ohne eigenes Label -> muss aus der Klasse abgeleitet werden (Zusicherung 4).
$seite->execute(['Gareth (Stadt)', 'gareth-stadt', 'https://de.wiki-aventurica.de/wiki/Gareth_(Stadt)', 'stadt', null, 'Aventurien']);
// 💣 DIE ZEILE, DIE DIE LAENGE VON DER ALPHABETISCHEN ORDNUNG TRENNT. Ohne sie sagte Zusicherung 2
// gar nichts: bei „Gareth (Stadt)" gegen „Garether Handelskontor" liefern kuerzester-zuerst und
// alphabetisch dieselbe Reihenfolge, und die Mutation „LENGTH(title) ASC entfernt" lief gruen durch
// (gemessen 16.08.2026). „Gareths Tor" ist KUERZER, steht alphabetisch aber HINTEN -- jetzt
// widersprechen sich die beiden Ordnungen, und die Zusicherung entscheidet wirklich etwas.
$seite->execute(['Gareths Tor', 'gareths-tor', 'https://de.wiki-aventurica.de/wiki/Gareths_Tor', 'gebaeude', 'Gebäude', 'Aventurien']);
$seite->execute(['Al\'Anfa', 'al-anfa', 'https://de.wiki-aventurica.de/wiki/Al%27Anfa', 'metropole', 'Metropole', 'Aventurien']);

// ── 1) DIE QUELLE: `wiki_sync_pages`, NIE der Kartenkatalog ──────────────────────────────────
$treffer = avesmapsWikiCitymapArticleSearch($pdo, 'Stadtplan von Gareth');
$pruef($treffer['ok'] === true, 'die Suche meldet kein ok');
$pruef($treffer['rows'] === [],
    'die Suche findet den BAUSCHLUESSEL aus wiki_citymap_catalog -- sie liest die falsche Tabelle: '
    . json_encode($treffer['rows'], JSON_UNESCAPED_UNICODE));

// ── 2) EXAKT VORN, DANN DER KUERZESTE ────────────────────────────────────────────────────────
$gareth = avesmapsWikiCitymapArticleSearch($pdo, 'Gareth');
$namen = array_map(static fn(array $r): string => $r['name'], $gareth['rows']);
$pruef($namen === ['Gareth', 'Gareths Tor', 'Gareth (Stadt)', 'Garether Handelskontor'],
    'die Reihenfolge stimmt nicht (exakt zuerst, dann der kuerzeste Titel): ' . implode(' | ', $namen));

// ── 3) DIE SEITENART REIST MIT ───────────────────────────────────────────────────────────────
// 🔴 Ohne sie sieht ein Editor nicht, dass er gerade die Seite einer STADT an eine Karte haengt --
// und genau dieser Missgriff ist hinterher ein Fall im Konfliktzentrum.
$pruef($gareth['rows'][0]['settlement_label'] === 'Metropole',
    'die Seitenart fehlt im Treffer: ' . json_encode($gareth['rows'][0], JSON_UNESCAPED_UNICODE));
$pruef($gareth['rows'][0]['continent'] === 'Aventurien', 'der Kontinent fehlt im Treffer');
$pruef($gareth['rows'][0]['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Gareth',
    'die Adresse fehlt im Treffer');
// 🔴 Und der Schluessel wird gebildet, nicht leer gelassen -- er wird SO gespeichert.
$pruef($gareth['rows'][0]['wiki_key'] === avesmapsPoliticalSlug('Gareth') && $gareth['rows'][0]['wiki_key'] !== '',
    'der Wiki-Schluessel des Treffers ist leer oder falsch gefaltet: ' . $gareth['rows'][0]['wiki_key']);

// ── 4) FEHLENDES LABEL WIRD ABGELEITET ───────────────────────────────────────────────────────
// ⚠️ Nur mit geladenem settlements.php; ohne sie bleibt es leer, und DAS waere ein stiller Verlust.
// Deshalb wird die Ableitung hier scharf geprueft, nachdem die Bibliothek nachgeladen ist.
require_once __DIR__ . '/../settlements.php';
$mitLabel = avesmapsWikiCitymapArticleSearch($pdo, 'Gareth (Stadt)');
$pruef($mitLabel['rows'][0]['settlement_label'] !== '',
    'ein Treffer ohne eigenes settlement_label bekommt keine abgeleitete Seitenart');

// ── 5) LEERER BEGRIFF => ALPHABETISCH ────────────────────────────────────────────────────────
$alle = avesmapsWikiCitymapArticleSearch($pdo, '');
$alleNamen = array_map(static fn(array $r): string => $r['name'], $alle['rows']);
$pruef($alleNamen === ["Al'Anfa", 'Gareth', 'Gareth (Stadt)', 'Garether Handelskontor', 'Gareths Tor'],
    'der Leerbegriff liefert keine alphabetische Liste: ' . implode(' | ', $alleNamen));

// ── 6) DER DECKEL ────────────────────────────────────────────────────────────────────────────
$pruef(count(avesmapsWikiCitymapArticleSearch($pdo, '', 2)['rows']) === 2, 'der Deckel wirkt nicht');
// 0 und negative Werte werden auf 1 gehoben (nie „alles"), zu grosse auf 80 gedeckelt.
$pruef(count(avesmapsWikiCitymapArticleSearch($pdo, '', 0)['rows']) === 1,
    'ein Deckel von 0 liefert nicht genau eine Zeile');
$pruef(count(avesmapsWikiCitymapArticleSearch($pdo, '', 5000)['rows']) === 5,
    'ein masslos grosser Deckel bricht die Suche');

// ── 7) DER `entry`-ARM: DER STAND EINES BEREITS ZUGEWIESENEN ARTIKELS ────────────────────────
// 🔴 Er liefert dieselbe Zeilenform wie die Suche -- ohne ihn zeigte der Kasten Seitenart und
// Kontinent genau einmal (direkt nach der Wahl) und nach dem naechsten Oeffnen nicht mehr.
$eintrag = avesmapsWikiCitymapArticleEntry($pdo, 'Gareth');
$pruef(count($eintrag['rows']) === 1 && $eintrag['rows'][0]['name'] === 'Gareth',
    'der entry-Arm findet den exakten Artikel nicht: ' . json_encode($eintrag['rows'], JSON_UNESCAPED_UNICODE));
$pruef($eintrag['rows'][0]['settlement_label'] === 'Metropole' && $eintrag['rows'][0]['continent'] === 'Aventurien',
    'der entry-Arm liefert eine andere Zeilenform als die Suche');
// 💣 NUR DER EXAKTE TITEL. „Gareths" ist ein Teiltreffer auf „Gareths Tor" -- ginge er als DER
// Artikel durch, zeigte der Kasten nach dem Neuladen einen ANDEREN Artikel als den gespeicherten.
$pruef(avesmapsWikiCitymapArticleEntry($pdo, 'Gareths')['rows'] === [],
    'ein blosser Teiltreffer geht als exakter Artikel durch');
// ⚠️ Ein verwaister Titel (Dump hat die Seite nicht mehr) ist KEIN Fehler, sondern eine leere Liste.
$pruef(avesmapsWikiCitymapArticleEntry($pdo, 'Gibt es nicht')['rows'] === [], 'ein verwaister Titel wirft');
// 💣 EIN LEERER TITEL FRAGT DIE DATENBANK GAR NICHT ERST -- und das ist der haeufigste Fall
// ueberhaupt (jede Karte ohne Zuweisung). Geprueft wird das mit einem SPION, nicht mit dem
// Rueckgabewert: der waere auch ohne den Riegel leer (der Exakt-Filter faengt es hinterher ab), und
// die Zusicherung „leerer Titel liefert nichts" lief deshalb gruen durch, als der Riegel entfernt
// war -- gemessen 16.08.2026. Eine Zusicherung, die sich vollstaendig liest und nichts entscheidet.
$spion = new class ('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]) extends PDO {
    public int $abfragen = 0;
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->abfragen++;
        return parent::prepare($query, $options);
    }
};
$spion->exec('CREATE TABLE wiki_sync_pages (title TEXT NOT NULL, normalized_key TEXT, wiki_url TEXT,
    settlement_class TEXT, settlement_label TEXT, continent TEXT)');
$pruef(avesmapsWikiCitymapArticleEntry($spion, '  ')['rows'] === [], 'ein leerer Titel liefert doch etwas');
$pruef($spion->abfragen === 0, 'ein leerer Titel fragt die Datenbank -- der Riegel fehlt');
// Gegenprobe: ein echter Titel fragt sehr wohl. Ohne sie bewiese der Spion nur, dass er nie zaehlt.
avesmapsWikiCitymapArticleEntry($spion, 'Gareth');
$pruef($spion->abfragen === 1, 'ein echter Titel fragt die Datenbank nicht');

echo 'citymap-article-search: ' . $pruefungen . " Zusicherungen erfuellt\n";
