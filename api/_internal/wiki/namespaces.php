<?php

declare(strict_types=1);

/**
 * Die Namensräume des Wiki Aventurica -- Inhalt, Kanon, Titelpräfix.
 * ===========================================================================
 * Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md
 *
 * 💣 WARUM DAS EINE EIGENE DATEI IST, und nicht bei `dump-reader.php` steht, wo es zuerst
 * stand: `api/edit/wiki/dump.php` laedt `sync.php` (das die Tabelle braucht) mit `require` und
 * `dump-reader.php` danach ein ZWEITES Mal, ebenfalls mit `require` -- nicht `require_once`.
 * Sobald `sync.php` seinerseits `dump-reader.php` zog, war das ein
 * „Cannot redeclare function" und der ganze Dump-Endpunkt tot, samt acht Werkzeug-Tests.
 * Diese Datei wird ausschliesslich mit `require_once` eingebunden und kann den Fall deshalb
 * nicht wiederholen.
 *
 * ⚠️ Sie fordert NICHTS und fuehrt keinen Code auf oberster Ebene aus -- nur Konstanten und
 * reine Funktionen. Das ist die Bedingung dafuer, dass jede Schicht sie ziehen darf.
 */

/**
 * 🔴 DIE INHALTS-NAMENSRAEUME, und ob sie KANON sind.
 *
 * Bis zum 01.09.2026 stand an fuenf Stellen `ns !== 0` und alles andere flog raus. Das war
 * einmal richtig und ist es seit Februar 2026 nicht mehr: das Wiki fuehrt fuenf Raeume mit
 * `"content": true` (gemessen an `meta=siteinfo&siprop=namespaces` und im Septemberdump
 * nachgezaehlt):
 *
 *   ns   0  (Hauptraum)   203.678 Seiten   offiziell
 *   ns 218  DSK               662 Seiten   offiziell   -- „Die Schwarze Katze", Ulisses-Ableger
 *   ns 220  Elf               101 Seiten   offiziell   -- ELF-Lizenzprodukte (Owner 01.09.2026)
 *   ns 222  Inoffiziell     6.457 Seiten   INOFFIZIELL -- Fan- und Briefspielinhalte
 *   ns 444  Ilaris          1.144 Seiten   INOFFIZIELL -- Fan-Regelwerk (Owner 01.09.2026)
 *
 * 💣 EIN NAMENSRAUM UNGLEICH 0 HEISST NICHT „INOFFIZIELL". Wer den alten Riegel als „alles
 * ausser dem Hauptraum ist Fanmaterial" aufmacht, stempelt „Die Schwarze Katze" zu Fanmaterial
 * -- eine offizielle Produktlinie mit eigenem Raum.
 *
 * ⚠️ Nicht aufgefuehrte Raeume sind KEIN Inhalt (Kategorie 14, Datei 6, Vorlage 10, Chronik 666,
 * Diskussionen ...). Fuer sie ist die Kanonfrage nicht „nein", sondern ungestellt.
 */
const AVESMAPS_WIKI_CONTENT_NAMESPACES = [
    0   => true,
    218 => true,
    220 => true,
    222 => false,
    444 => false,
];

/**
 * 🔴 UND DAVON GETRENNT: aus WELCHEN Raeumen wir Kartenobjekte einsammeln.
 *
 * 💣 DAS IST NICHT DIESELBE FRAGE, und die Verwechslung kostete beim ersten Anlauf 264 falsche
 * Doerfer. Mit ns 444 in der Sammelliste klassifiziert `dump-entity-scan.php` alle 264 Seiten
 * mit `{{Infobox Ilaris Vorteil}}` als SIEDLUNG -- weil die Nadel dort `str_contains($key, 'ort')`
 * lautet und `ilarisvorteil` das Wort `ort` enthaelt („ilarisv-ORT-eil"). Der alte Riegel
 * `ns === 0` hat diesen Substring-Fehler seit jeher verdeckt. Gemessen am Septemberdump:
 * 264 Treffer, alle mit `settlement_class = 'dorf'`, darunter „Angepasst I" und „Kaeltestarre".
 *
 * ⭐ Und es kostet nichts, sie draussen zu lassen: ns 218 und ns 220 liefern **null**
 * Kartenentitaeten, ns 444 ausschliesslich die 264 Fehltreffer. Der gesamte echte Zugewinn
 * sind die 302 Objekte aus ns 222.
 *
 * ⚠️ Die Kanontabelle oben bleibt trotzdem vollstaendig -- sie beantwortet die Frage „ist eine
 * QUELLE aus diesem Raum offiziell?", und die stellt sich auch fuer Raeume, aus denen wir keine
 * Objekte holen.
 *
 * 🔧 Der `str_contains('ort')`-Fehler in dump-entity-scan.php:228 bleibt bestehen und ist nur
 * verdeckt. Er gehoert behoben, bevor je ein weiterer Raum dazukommt.
 */
const AVESMAPS_WIKI_ENTITY_NAMESPACES = [0, 222];

/**
 * Die Titel-Praefixe derselben Raeume. Zweite Sicht auf dieselbe Tabelle, weil ein Titel den
 * Namensraum als WORT traegt (`Inoffiziell:Apfeldorn`), nicht als Nummer.
 *
 * ⚠️ Der Hauptraum steht hier NICHT drin: er hat kein Praefix, und ein leerer Schluessel wuerde
 * auf jeden Titel passen.
 */
const AVESMAPS_WIKI_NAMESPACE_PREFIXES = [
    'DSK'         => 218,
    'Elf'         => 220,
    'Inoffiziell' => 222,
    'Ilaris'      => 444,
];

/** Traegt dieser Namensraum Artikel? */
function avesmapsWikiNamespaceIsContent(int $ns): bool
{
    return array_key_exists($ns, AVESMAPS_WIKI_CONTENT_NAMESPACES);
}

/** Sammeln wir aus diesem Namensraum KARTENOBJEKTE? Enger als IsContent -- siehe oben. */
function avesmapsWikiNamespaceCarriesEntities(int $ns): bool
{
    return in_array($ns, AVESMAPS_WIKI_ENTITY_NAMESPACES, true);
}

/**
 * Ist dieser Namensraum Kanon? `null` heisst „kein Inhaltsraum, die Frage stellt sich nicht".
 *
 * 💣 DER RUECKGABETYP IST ABSICHTLICH `?bool` UND NICHT `bool`. Mit einem blossen `false` fuer
 * unbekannte Raeume waere jede Kategorie-, Datei- und Vorlagenseite „inoffiziell" -- eine
 * Aussage, die niemand getroffen hat und die sich stillschweigend in die Daten schriebe.
 */
function avesmapsWikiNamespaceIsOfficial(int $ns): ?bool
{
    return AVESMAPS_WIKI_CONTENT_NAMESPACES[$ns] ?? null;
}

/**
 * Der Namensraum, den ein TITEL im Wort traegt -- `null`, wenn er keinen bekannten traegt.
 *
 * 💣 NUR BEKANNTE PRAEFIXE ZAEHLEN, nicht „alles vor dem ersten Doppelpunkt". Aventurische
 * Titel tragen reichlich Doppelpunkte, die keine Namensraeume sind -- „Aventurien: Das Lexikon
 * des Schwarzen Auges" waere sonst der Namensraum „Aventurien". Der Vergleich ist ausserdem
 * fallunabhaengig, weil MediaWiki den ersten Buchstaben eines Praefix frei stellt.
 *
 * ⭐ Gegen alle 252.902 Titel des Septemberdumps geprueft: 0 Falsch-Positive, 0 Falsch-Negative.
 * ⚠️ Ein FUEHRENDER Doppelpunkt (`:Inoffiziell:X`, die MediaWiki-Linkschreibweise) ergibt
 * `null`. Im Dumpweg unerreichbar -- `<title>` sieht nie so aus --, aber wer diese Funktion
 * je auf Linkziele loslaesst, muss ihn vorher abschneiden.
 */
function avesmapsWikiTitleNamespace(string $title): ?int
{
    $pos = mb_strpos($title, ':');
    if ($pos === false || $pos === 0) {
        return null;
    }
    $praefix = trim(mb_substr($title, 0, $pos));
    foreach (AVESMAPS_WIKI_NAMESPACE_PREFIXES as $name => $ns) {
        if (mb_strtolower($praefix) === mb_strtolower($name)) {
            return $ns;
        }
    }

    return null;
}

/**
 * Ist eine Katalogzeile eine offizielle Quelle? Der Namensraum ihrer Produktseite entscheidet.
 *
 * ⚠️ SIE STEHT HIER UND NICHT BEI publication-sync.php, obwohl sie dort entstand: es gibt ZWEI
 * Schreiber derselben Katalogzeile (der Publikations-Abgleich und avesmapsCitymapLinkSource in
 * citymap-sync.php), und der zweite zog publication-sync.php nicht. Eine Regel, die einen von
 * zwei Erzeugern bindet, ist keine Regel -- also gehoert sie zur Namensraumtabelle, die beide
 * ohnehin laden.
 *
 * 💣 DIES ERSETZT EIN FEST VERDRAHTETES `true`. Bis zum 01.09.2026 stand im Aufruf des
 * Katalog-Upserts „true, // a wiki publication is an official source" -- richtig, solange der
 * Katalog ausschliesslich aus dem Hauptraum gefuellt werden KONNTE. Mit den Inhalts-Namensraeumen
 * (dump-reader.php) stimmt der Satz nicht mehr: ns 222 und ns 444 tragen ebenfalls Produktseiten.
 *
 * ⚠️ Ein unbekannter Raum (`null`, also Bestand vor dieser Aenderung) gilt als offiziell -- siehe
 * die Begruendung an der Spalte. Ein Raum, den die Tabelle nicht als Inhalt kennt, ebenfalls: er
 * kann dort nur stehen, wenn ihn jemand von Hand eingetragen hat, und dann ist „inoffiziell" eine
 * Aussage, die niemand getroffen hat.
 */
function avesmapsPublicationCatalogIsOfficial(mixed $pageNs): bool
{
    if ($pageNs === null || $pageNs === '') {
        return true;
    }

    return avesmapsWikiNamespaceIsOfficial((int) $pageNs) ?? true;
}

/**
 * Der Namensraum hinter einer Wiki-ADRESSE -- `null`, wenn keiner erkennbar ist.
 *
 * 🔴 WOFUER: ein aus ns 222 uebernommenes Kartenobjekt traegt keine eigene `sources`-Zeile. Sein
 * Wiki-Artikel steckt in `properties.wiki_url` und wird vom Quellenkasten laengst als erste
 * Zeile samt Lizenz gerendert (buildSourceListMarkup). Eine zusaetzliche Katalogzeile dafuer
 * anzulegen -- der urspruengliche Plan -- haette denselben Artikel ZWEIMAL in den Kasten
 * gestellt. Das Kanon-Etikett liest den Raum deshalb hier ab, statt eine Quelle zu erfinden.
 *
 * ⚠️ NUR DER TITELTEIL ZAEHLT. Die Adresse kann Abfrage und Sprungmarke tragen
 * (`?action=raw`, `#Geschichte`); beides gehoert nicht zum Titel. Unterstriche sind in
 * MediaWiki-Adressen Leerzeichen.
 * ⚠️ Prozentkodierung wird aufgeloest -- `Inoffiziell%3AApfeldorn` ist derselbe Titel.
 *
 * 💣 NUR ADRESSEN DES WIKIS. Die Funktion heisst „Namensraum hinter einer WIKI-Adresse" und las
 * ihn zuerst aus JEDER Adresse -- `https://www.garetien.de/wiki/Inoffiziell:Apfeldorn` ergab 222.
 * Das ist hier kein Strohmann: garetien.de ist eine Briefspielseite, deren Uebernahme gerade
 * gebaut wird (js/review/review-garetien-importer.js), und ihr Etikett haette dann „Wiki
 * Aventurica" als Bezeichner getragen -- eine falsche Zuschreibung an einen fremden Betreiber.
 * Geprueft wird auf SUFFIX-GRENZE, derselbe Ausdruck wie in datei-riegel.php, coat-url.php und
 * settlements-coat-localize.php: `stripos($host, 'wiki-aventurica.de')` naehme auch
 * `wiki-aventurica.de.angreifer.example` an.
 *
 * 💣 EIN FEHLENDER WIRT WIRD ABGEWIESEN, NICHT DURCHGELASSEN. Der erste Anlauf liess ihn zu, mit
 * der Begruendung „ein relativer Pfad kann nicht auf einen fremden Betreiber zeigen". Der Satz
 * stimmt -- nur kann `parse_url` einen relativen Pfad nicht von einer SCHEMALOSEN fremden Adresse
 * unterscheiden: `garetien.de/wiki/Inoffiziell:X` liefert ebenfalls keinen Wirt (alles wird Pfad)
 * und waere als 222 durchgegangen, also genau die Falschzuschreibung, die dieser Riegel abwenden
 * soll. Gezaehlt: 276 von 276 im Bestand gespeicherten Wiki-Adressen tragen ein Schema. Die
 * Geschwister-Riegel (coat-url.php:341, datei-riegel.php) weisen den leeren Wirt aus demselben
 * Grund ab.
 * ⚠️ `strtolower` ist TRAGEND, weil der Ausdruck fallabhaengig ist (kein `i`-Flag, wie bei den
 * Geschwistern): DNS ist fallunabhaengig, und eine gespeicherte Adresse darf `DE.WIKI-...` heissen.
 */
function avesmapsWikiNamespaceFromWikiUrl(string $url): ?int
{
    $url = trim($url);
    if ($url === '') {
        return null;
    }
    $wirt = strtolower((string) (parse_url($url, PHP_URL_HOST) ?? ''));
    if (preg_match('/(^|\.)wiki-aventurica\.de$/', $wirt) !== 1) {
        return null;
    }
    $pfad = (string) (parse_url($url, PHP_URL_PATH) ?? '');
    if ($pfad === '') {
        return null;
    }
    // 💣 AM `/wiki/` TRENNEN, NICHT AM LETZTEN SCHRAEGSTRICH. Der erste Anlauf nahm `strrpos('/')`
    // -- und aventurische Titel tragen selbst Schraegstriche: `Inoffiziell:Trutzbach/Zollhaus`,
    // `Inoffiziell:Serenissima Folge 18/Mitwirkende`. Die Unterseite blieb uebrig („Zollhaus"),
    // der Namensraum war weg, und die betroffenen Objekte bekamen still kein Etikett.
    // ⚠️ Auch die zweite Adressform des Wikis wird bedient: `index.php?title=…`.
    // 💣 GENAU EINE DEKODIERUNG JE FORM. Der Pfad kommt roh aus `parse_url` und wird hier
    // aufgeloest; `parse_str` loest SCHON AUF und darf deshalb kein zweites Mal durch
    // `rawurldecode`. Vorher gaben `…/wiki/Inoffiziell%253AApfeldorn` (null, richtig) und
    // `…index.php?title=Inoffiziell%253AApfeldorn` (222, falsch) verschiedene Antworten auf
    // denselben Titel -- zweimal dekodiert wurde aus dem kodierten Prozentzeichen wieder ein
    // Doppelpunkt.
    $titel = '';
    if (($pos = strpos($pfad, '/wiki/')) !== false) {
        $titel = rawurldecode(substr($pfad, $pos + 6));
    } elseif (str_contains($pfad, 'index.php')) {
        parse_str((string) (parse_url($url, PHP_URL_QUERY) ?? ''), $abfrage);
        // ⚠️ `?title[]=X` macht daraus ein ARRAY. Ein `(string)` darauf ist keine Umwandlung,
        // sondern eine PHP-Meldung („Array to string conversion") im Protokoll des heissesten
        // Endpunkts -- fuer eine Eingabe, die aus gespeicherten Daten kommt.
        $roh = $abfrage['title'] ?? null;
        $titel = is_string($roh) ? $roh : '';
    }
    if ($titel === '') {
        return null;
    }

    return avesmapsWikiTitleNamespace(str_replace('_', ' ', $titel));
}
