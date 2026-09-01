<?php

declare(strict_types=1);

/**
 * Unit tests for api/_internal/wiki/namespaces.php + the namespace-aware match key
 * (avesmapsWikiSyncCreateMatchKeyForTitle, sync.php) + the page id the dump reader now yields.
 * No DB, no HTTP -- hand-built fixtures only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/namespaces-test.php
 * (from the repo root). Exit 0 = all asserts passed.
 *
 * 🔴 WARUM ES DIESE DATEI GIBT: die Namensraum-Oeffnung vom 01.09.2026 ging mit null
 * Testabdeckung in den Arbeitsbaum, und drei unabhaengige Pruefungen fanden darin einen Fatal
 * Error, 264 Fehlklassifikationen und vier falsche Zahlen. Jeder Fall unten steht fuer einen
 * dieser Befunde -- keiner ist erfunden.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

// ⚠️ Umgebungswaechter wie in deities-test.php: diese Datei haengt an mbstring UND an
// XMLReader. Ohne sie waere es ein Fatal mit unverstaendlicher Meldung statt exit 2.
if (!function_exists('mb_substr') || !function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring fehlt -- mit -d extension=php_mbstring.dll starten.\n"); exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext-xmlreader fehlt.\n"); exit(2);
}

// 💣 `require_once`, nicht `require`: namespaces.php sagt in ihrem eigenen Kopf zu, ausschliesslich
// so eingebunden zu werden -- diese Datei war die einzige Stelle im Repo, die den Vertrag brach.
require_once __DIR__ . '/../namespaces.php';

// ---------------------------------------------------------------------------
// 1. Inhaltsraum -- traegt der Namensraum ueberhaupt Artikel?
// ---------------------------------------------------------------------------
foreach ([0, 218, 220, 222, 444] as $ns) {
    assert(avesmapsWikiNamespaceIsContent($ns) === true, "ns $ns muss Inhalt sein");
}
// Kategorie, Datei, Vorlage, Hilfe, Chronik, Diskussion -- kein Inhalt.
foreach ([1, 6, 10, 12, 14, 219, 221, 445, 666, 998, -1, -2, 9999] as $ns) {
    assert(avesmapsWikiNamespaceIsContent($ns) === false, "ns $ns darf kein Inhalt sein");
}
echo "inhaltsraum ok\n";

// ---------------------------------------------------------------------------
// 2. Objektraum -- ENGER als Inhaltsraum. Der Befund, der 264 Doerfer verhindert hat.
// ---------------------------------------------------------------------------
assert(avesmapsWikiNamespaceCarriesEntities(0) === true);
assert(avesmapsWikiNamespaceCarriesEntities(222) === true);
// 💣 ns 444: 264 Seiten mit {{Infobox Ilaris Vorteil}} wuerden als SIEDLUNG klassifiziert, weil die
// Nadel in dump-entity-scan.php `str_contains($key, 'ort')` lautet und `ilarisvorteil` das Wort
// `ort` enthaelt. ns 218/220 liefern gemessen NULL Kartenentitaeten.
foreach ([218, 220, 444] as $ns) {
    assert(avesmapsWikiNamespaceCarriesEntities($ns) === false, "ns $ns darf keine Objekte liefern");
}
// Und der Objektraum ist immer eine Teilmenge des Inhaltsraums -- sonst holten wir Objekte aus
// einem Raum, dessen Kanonfrage niemand beantwortet hat.
foreach (AVESMAPS_WIKI_ENTITY_NAMESPACES as $ns) {
    assert(avesmapsWikiNamespaceIsContent($ns) === true, "Objektraum $ns fehlt im Inhaltsraum");
}
echo "objektraum ok\n";

// ---------------------------------------------------------------------------
// 3. Kanon -- und der Unterschied zwischen `false` und `null`.
// ---------------------------------------------------------------------------
assert(avesmapsWikiNamespaceIsOfficial(0) === true);
assert(avesmapsWikiNamespaceIsOfficial(218) === true, 'Die Schwarze Katze ist offiziell');
assert(avesmapsWikiNamespaceIsOfficial(220) === true, 'ELF-Lizenzprodukte sind offiziell (Owner 01.09.2026)');
assert(avesmapsWikiNamespaceIsOfficial(222) === false);
assert(avesmapsWikiNamespaceIsOfficial(444) === false, 'Ilaris ist inoffiziell (Owner 01.09.2026)');
// 💣 DIE TRAGENDE UNTERSCHEIDUNG: ein Nicht-Inhaltsraum ist NICHT „inoffiziell", sondern
// ungefragt. Mit `false` waere jede Kategorie- und Dateiseite Fanmaterial.
foreach ([14, 6, 10, 666, -1] as $ns) {
    assert(avesmapsWikiNamespaceIsOfficial($ns) === null, "ns $ns muss null liefern, nicht false");
}
assert(avesmapsWikiNamespaceIsOfficial(14) !== false, 'null darf nicht zu false verrutschen');
echo "kanon ok\n";

// ---------------------------------------------------------------------------
// 4. Titel -> Namensraum. Der Falschtreffer-Riegel.
// ---------------------------------------------------------------------------
assert(avesmapsWikiTitleNamespace('Inoffiziell:Apfeldorn') === 222);
assert(avesmapsWikiTitleNamespace('DSK:Regelwerk') === 218);
assert(avesmapsWikiTitleNamespace('Elf:Gefesselter Sturm') === 220);
assert(avesmapsWikiTitleNamespace('Ilaris:Sephrasto') === 444);
// MediaWiki stellt den ersten Buchstaben eines Praefix frei.
assert(avesmapsWikiTitleNamespace('inoffiziell:Apfeldorn') === 222);
assert(avesmapsWikiTitleNamespace('ELF:X') === 220);
// Unterseiten behalten ihren Raum.
assert(avesmapsWikiTitleNamespace('Inoffiziell:Trutzbach/Zollhaus') === 222);

// 💣 DIE FALSCHTREFFER, gegen die der Riegel gebaut ist. „alles vor dem ersten Doppelpunkt"
// waere hier ueberall falsch -- aventurische Titel tragen reichlich Doppelpunkte.
assert(avesmapsWikiTitleNamespace('Aventurien: Das Lexikon des Schwarzen Auges') === null);
assert(avesmapsWikiTitleNamespace('Elf') === null, '„Elf" allein ist ein Wort, kein Praefix');
assert(avesmapsWikiTitleNamespace('Elfen:Etwas') === null);
assert(avesmapsWikiTitleNamespace('Inoffiziell') === null);
assert(avesmapsWikiTitleNamespace('Kategorie:Inoffiziell') === null);
assert(avesmapsWikiTitleNamespace('Inoffiziell Diskussion:Apfeldorn') === null, 'Diskussionsraum ist kein Inhalt');
assert(avesmapsWikiTitleNamespace('') === null);
assert(avesmapsWikiTitleNamespace(':') === null);
// ⚠️ BEKANNTE LUECKE, hier festgenagelt statt verschwiegen: der fuehrende Doppelpunkt der
// MediaWiki-Linkschreibweise wird NICHT abgeschnitten. Im Dumpweg unerreichbar (<title> sieht
// nie so aus); wer diese Funktion je auf Linkziele loslaesst, muss ihn vorher entfernen.
assert(avesmapsWikiTitleNamespace(':Inoffiziell:Apfeldorn') === null, 'dokumentierte Luecke');
echo "titel->namensraum ok\n";

// ---------------------------------------------------------------------------
// 5. Der namensraumbewusste Zuordnungsschluessel.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../../text/ascii-fold.php';
require_once __DIR__ . '/../drossel.php';
require_once __DIR__ . '/../sync.php';

// 💣 DER HAUPTRAUM AENDERT SICH UM KEIN ZEICHEN. Das ist die Bedingung dafuer, dass die
// bestehenden 203.678 Objekte ihre Zuordnung behalten -- ein geaenderter Schluessel waere eine
// Datenmigration ueber ~10 Tabellen (AGENTS.md §5), keine Bearbeitung.
foreach (['Apfeldorn', 'Fürstentum Kosch', 'Baronie Metenar', 'Lyngwyn (Honingen)', 'Groß-Ork'] as $name) {
    assert(
        avesmapsWikiSyncCreateMatchKeyForTitle($name, $name) === avesmapsWikiSyncCreateMatchKey($name),
        'Hauptraum-Schluessel fuer ' . $name . ' muss unveraendert bleiben'
    );
}

// Die Kollision, um die es geht.
$offiziell   = avesmapsWikiSyncCreateMatchKeyForTitle('Temphis', 'Temphis');
$inoffiziell = avesmapsWikiSyncCreateMatchKeyForTitle('Temphis', 'Inoffiziell:Temphis');
assert($offiziell !== $inoffiziell, 'Namensgleichstand muss getrennt werden');
assert($offiziell === 'temphis');
assert($inoffiziell === 'ns222temphis');

// Auch fuer die uebrigen Praefixe, damit ein spaeter geoeffneter Raum nicht still kollidiert.
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Regelwerk', 'DSK:Regelwerk') === 'ns218regelwerk');
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Sephrasto', 'Ilaris:Sephrasto') === 'ns444sephrasto');

// 💣 DER FEHLER, DEN EINE MUTATIONSPROBE GEFUNDEN HAT. Der erste Anlauf stellte das Praefix als
// WORT mit Leerzeichen voran -- und das Leerzeichen erzeugte eine Klammer-Grenze, die im blanken
// Namen nicht existiert (`avesmapsWikiSyncStripParentheticalSuffix` verlangt Leerraum vor der
// Klammer). Ergebnis: der ganze Name wurde gefressen und der Schluessel kollidierte mit einem
// Hauptraum-Artikel „Inoffiziell".
$klammer = avesmapsWikiSyncCreateMatchKeyForTitle('(Ehemalige Baronie)', 'Inoffiziell:(Ehemalige Baronie)');
assert($klammer !== avesmapsWikiSyncCreateMatchKey('Inoffiziell'), 'Klammername darf nicht zu „inoffiziell" zusammenfallen');
assert($klammer === 'ns222ehemaligebaronie', 'der blanke Schluessel wird ZUERST gebildet');

// 💣 UND DIE ZWEITE HAELFTE: ein Worttrenner ueberlebt die Faltung nicht. „Elf:Sturm" ergab
// `elfsturm` -- denselben Schluessel wie ein Hauptraum-Artikel „Elfsturm".
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Sturm', 'Elf:Sturm') !== avesmapsWikiSyncCreateMatchKey('Elfsturm'));
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Sturm', 'Elf:Sturm') === 'ns220sturm');

// ⚠️ EIN LEERER NAME BLEIBT LEER -- sonst teilten sich alle namenlosen Zeilen eines Raums einen
// Sammelschluessel, und der kollidierte mit dem Artikel „Inoffiziell".
assert(avesmapsWikiSyncCreateMatchKeyForTitle('', 'Inoffiziell:Apfeldorn') === '');
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Temphis', '') === 'temphis');

// ⚠️ UND DER FALL, DEN DIE SCHLEIFE OBEN NICHT PRUEFEN KANN: ein Hauptraum-Name MIT Doppelpunkt,
// dessen Vorderteil kein bekanntes Praefix ist. Ohne ihn ist die Schleife tautologisch -- alle
// ihre Namen haben gar keinen Doppelpunkt und liefen auch ohne den Frueheinstieg gleich aus.
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Elfen:Etwas', 'Elfen:Etwas')
    === avesmapsWikiSyncCreateMatchKey('Elfen:Etwas'), 'unbekanntes Praefix aendert nichts');

// ⭐ EIN TITEL MIT GEWOEHNLICHEM DOPPELPUNKT bleibt unberuehrt -- der Fall, an dem ein naiver
// „alles vor dem Doppelpunkt"-Griff den Bestand zerrissen haette.
assert(
    avesmapsWikiSyncCreateMatchKeyForTitle('Das Lexikon', 'Aventurien: Das Lexikon des Schwarzen Auges')
        === avesmapsWikiSyncCreateMatchKey('Das Lexikon')
);

// ⚠️ Der Klammerzusatz wird weiterhin abgeschnitten -- deshalb kollidieren „Lyngwyn (Honingen)"
// und „Lyngwyn". Das ist bestehendes Verhalten und der Grund, warum die Kollisionszahl ueber den
// echten Schluessel hoeher liegt als ueber einen blossen Titelvergleich.
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Lyngwyn (Honingen)', 'Inoffiziell:Lyngwyn (Honingen)')
    === avesmapsWikiSyncCreateMatchKeyForTitle('Lyngwyn', 'Inoffiziell:Lyngwyn'));
assert(avesmapsWikiSyncCreateMatchKeyForTitle('Lyngwyn (Honingen)', 'Inoffiziell:Lyngwyn (Honingen)') === 'ns222lyngwyn');
echo "match-key ok\n";

// ---------------------------------------------------------------------------
// 6. Die Seitenkennung des Lesers -- gegen die drei `<id>`, die eine Seite tragen kann.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../dump-reader.php';

$lies = static function (string $pageXml): array {
    $xml = '<mediawiki><page>' . $pageXml . '</page></mediawiki>';
    $reader = new XMLReader();
    assert($reader->XML($xml) === true);
    while ($reader->read()) {
        if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'page') {
            $seite = avesmapsWikiDumpReadPageElement($reader);
            $reader->close();
            return $seite;
        }
    }
    $reader->close();

    return [];
};

// Der Normalfall: Seiten-, Revisions- und Autorenkennung, in dieser Reihenfolge.
$p = $lies('<title>Apfeldorn</title><ns>0</ns><id>5</id>'
    . '<revision><id>3240989</id><contributor><id>120</id></contributor><text>Hallo</text></revision>');
assert($p['id'] === 5, 'die Seitenkennung, nicht die Revisionskennung');
assert($p['title'] === 'Apfeldorn', 'Titel');
assert($p['ns'] === 0, 'Namensraum');
assert($p['wikitext'] === 'Hallo', 'Wikitext aus der ersten Revision');

// 💣 Seite OHNE eigene `<id>`: es darf keine fremde Kennung einspringen.
$p = $lies('<title>X</title><ns>0</ns><revision><id>777</id><text>t</text></revision>');
assert($p['id'] === 0, 'ohne Seiten-<id> muss 0 herauskommen, nicht 777');

// 💣 `<upload>` traegt ebenfalls `<contributor><id>` -- der Fall, den der erste Anlauf uebersah.
$p = $lies('<title>Datei:X.jpg</title><ns>6</ns>'
    . '<upload><contributor><id>7</id></contributor></upload>');
assert($p['id'] === 0, 'die Hochladerkennung darf nicht als Seitenkennung durchgehen');
$p = $lies('<title>Datei:X.jpg</title><ns>6</ns>'
    . '<revision><id>9</id><text>t</text></revision>'
    . '<upload><contributor><id>7</id></contributor></upload>');
assert($p['id'] === 0);

// Die Seitenkennung darf auch NACH der Revision stehen.
$p = $lies('<title>X</title><ns>0</ns><revision><id>9</id><text>t</text></revision><id>42</id>');
assert($p['id'] === 42);

// Leere und entartete Formen.
$p = $lies('<title>X</title><ns>222</ns><id/>');
assert($p['id'] === 0 && $p['ns'] === 222);
echo "seitenkennung ok\n";

echo "ALLE TESTS OK\n";
