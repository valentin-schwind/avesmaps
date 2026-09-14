<?php

declare(strict_types=1);

/**
 * Stadtteile aus dem Wiki -- die ZWEITE dokumentierte Ausnahme von O4 (dump-entity-scan.php).
 * ===========================================================================
 * Owner 14.09.2026: „insgesamt sollten stadtteile innerorts sein" und „dann könnte man das
 * stadtviertel durch zoom auf die stadt auffindbar machen". Frueher schon: „wichtig ist, dass alle
 * stadtviertel in der suche auftauchen".
 *
 * 💣 DER SCAN ERKENNT EIN OBJEKT NUR AN SEINER INFOBOX (O4) -- UND EINE STADTTEIL-SEITE HAT KEINE.
 * `Südquartier` traegt nur `{{Register Siedlung}}` ohne Parameter, also auch kein `|Standort=`. Die
 * EINZIGE Stelle, die Art UND Stadt nennt, ist die Kategorie `Stadtteil von Gareth`. Deshalb liest
 * diese Ausnahme -- anders als die Wadi-Ausnahme, die bei der Art bleibt -- eine Kategorie.
 *
 * 🔴 SIE BLEIBT ENG UND BENANNT. Keine allgemeine Musterregel „Kategorie:X von Y": der naechste
 * Schritt waere ein Baukasten, und dann entscheiden Kategorien, was ein Objekt ist -- genau das,
 * wogegen O4 steht. Wer eine dritte Form braucht, schreibt sie hier dazu, mit ihrer Messung.
 *
 * Gemessen am Septemberdump (01.09.2026, 252.902 Seiten, gegen `dump_categorylinks` gehalten --
 * jede dieser Kategorien steht LITERAL im Wikitext, keine kommt nur ueber eine Vorlage, und nur den
 * Wikitext sieht der Scan):
 *   13 Seiten in `Stadtteil von …` (Gareth 6, Dorinthapolis 5, Kuslik 1, Yol-Ghurmak 1)
 *   -> 10 aufgenommen. Zwei tragen schon eine Region-Infobox (Sternenpfeiler, Krater der Kristalle)
 *      und gehoeren ihrem Handler; eine ist `Sandkasten/Brigonis`, die Spielwiese eines Benutzers.
 *   -> 6 davon (Gareth) erscheinen in der Suche; Dorinthapolis liegt nicht auf der Karte.
 *
 * ⚠️ WAS DARAUS WIRD, entscheidet nicht diese Datei: der Bauwerks-Parser macht daraus eine Zeile der
 * Klasse `stadtviertel` mit Art „Stadtteil" und Standort `[[Stadt]]`, und ob sie in der Suche
 * erscheint, entscheidet wie bei jedem Bauwerk der Scope-Klassifikator (place-scope.php).
 *
 * ⚠️ REIN, aber nicht selbststaendig: sie ruft den Infobox-Klassifikator des Scans
 * (avesmapsWikiDumpClassifyEntityKind) und die Infobox-Namensfunktion des Sync-Monitors. Beide sind
 * zur Aufrufzeit geladen, weil nur dump-entity-scan.php diese Datei einbindet.
 */

/** Die Art eines Stadtteils in wiki_sync_pages.building_type -- daraus wird „Stadtteil in Gareth". */
const AVESMAPS_WIKI_STADTTEIL_ART = 'Stadtteil';

/**
 * Die Klasse eines Stadtteils: eine Bauwerksklasse (ortsklassen.php) -- liegt innerorts, ist kein
 * Behaelter. Dieselbe Klasse tragen die Stadtviertel auf der Karte; mit `gebaeude` staende eine
 * Wiki-Zuweisung spaeter als Klassen-Abweichung da, obwohl beide dasselbe meinen.
 */
const AVESMAPS_WIKI_STADTTEIL_KLASSE = 'stadtviertel';

/**
 * Ist diese Dumpseite ein Stadtteil -- und von welcher Stadt?
 *
 * Die EINE Entscheidung fuer Klassifikator UND Parser. Der Parser traegt fuer die Infobox-Nadeln
 * einen Zwilling der Klassifikator-Weiche; fuer Stadtteile gibt es keinen, beide fragen hier.
 *
 * @param array{title?:string, ns?:int, redirect?:?string, wikitext?:string} $page
 * @return array{stadt:string}|null
 */
function avesmapsWikiStadtteilAusKategorie(array $page): ?array
{
    $title = trim((string) ($page['title'] ?? ''));
    $wikitext = (string) ($page['wikitext'] ?? '');

    // Die Bremse fuer die rund 250.000 Seiten, die am Tor vorbeikommen: ohne das Wort gibt es
    // nichts zu pruefen, und die Infobox-Frage darunter ist die teure.
    if ($title === '' || mb_stripos($wikitext, 'stadtteil') === false) {
        return null;
    }

    // Eine Unterseite ist nie ein Stadtteil. Gemessen: `Sandkasten/Brigonis` liegt im Hauptraum und
    // steht in `Stadtteil von Kuslik` -- der echte Brigonis ist eine Weiterleitung auf Kuslik.
    if (str_contains($title, '/')) {
        return null;
    }

    // Eine Seite mit erkannter Infobox gehoert ihrem Handler (Sternenpfeiler bleibt eine Region).
    if (avesmapsWikiDumpClassifyEntityKind(avesmapsWikiSyncMonitorInfoboxName($wikitext)) !== '') {
        return null;
    }

    $staedte = [];
    foreach (avesmapsWikiStadtteilKategorien($wikitext) as $kategorie) {
        if (preg_match('/^Stadtteil von (.+)$/u', $kategorie, $treffer) === 1) {
            $staedte[$treffer[1]] = true;
        }
    }

    // Zwei verschiedene Staedte sind keine Antwort: ein Treffer, der auf die falsche springt, ist
    // schlechter als keiner (dieselbe Regel wie „unklar" in place-scope.php).
    if (count($staedte) !== 1) {
        return null;
    }

    return ['stadt' => (string) array_key_first($staedte)];
}

/**
 * Die literalen Kategorien einer Seite in MediaWiki-Schreibweise: Unterstriche sind Leerzeichen,
 * der erste Buchstabe ist gross, und der Sortierschluessel hinter `|` gehoert nicht zum Namen.
 *
 * ⚠️ NICHT avesmapsWikiDumpExtractCategoryNames: die klebt alle Namen mit Leerzeichen zusammen und
 * verliert damit genau die Grenze, an der „Stadtteil von Gareth" endet.
 *
 * @return list<string>
 */
function avesmapsWikiStadtteilKategorien(string $wikitext): array
{
    if (preg_match_all('/\[\[\s*(?:Kategorie|Category)\s*:\s*([^\]|#]+)/iu', $wikitext, $treffer) < 1) {
        return [];
    }

    $namen = [];
    foreach ($treffer[1] as $roh) {
        // preg_replace liefert bei kaputtem UTF-8 null -- dann ist der Name leer und faellt heraus,
        // statt als halber Name eine Stadt zu erfinden.
        $name = trim((string) preg_replace('/[\s_]+/u', ' ', (string) $roh));
        if ($name === '') {
            continue;
        }
        $namen[] = mb_strtoupper(mb_substr($name, 0, 1)) . mb_substr($name, 1);
    }

    return $namen;
}
