<?php

declare(strict_types=1);

/**
 * MISST, was ein Dump ueber KATEGORIEN und NAMENSRAEUME hergibt -- und beantwortet damit die
 * eine Frage, an der die Laufzeit des ganzen Dump-Laufs haengt.
 *
 * ===========================================================================
 * WARUM DIESES WERKZEUG UEBERHAUPT
 * ===========================================================================
 * Drei der elf Phasen fragen das lebende Wiki: Ortsgroessen, Bauwerksarten, Kontinente. Sie tun
 * das NICHT aus Bequemlichkeit, sondern weil diese drei Angaben im Dump prinzipiell unsichtbar
 * sind (Invariante I6, dump-category-layer.php): MediaWiki erzeugt die Kategorien beim Anzeigen
 * aus einer Vorlage, im Quelltext einer Seite steht davon nichts.
 *
 * Diese drei Phasen kosten bei 20 Sekunden Crawl-delay den Loewenanteil der Laufzeit. Bringt
 * ein Dump die Kategoriezugehoerigkeit MIT, koennten sie aus der Datei lesen -- aus rund 25
 * Minuten wuerden wenige.
 *
 * 🔴 DESHALB MISST DIESES WERKZEUG, ES AENDERT NICHTS. Die Uebergabe schreibt das ausdruecklich
 * so vor: "Erster Handgriff ist eine MESSUNG der Namensraum-Zahlen, kein Code." Wer die drei
 * Phasen umbaut, bevor er weiss, in welcher FORM die Kategorien dastehen, baut auf eine
 * Vermutung -- und die Fehlerklasse dieser Woche war jedes Mal dieselbe: eine Annahme, die
 * stimmte, bis sich nebenan etwas aenderte.
 *
 * ===========================================================================
 * WAS ES BEANTWORTET
 * ===========================================================================
 *   1. Welche NAMENSRAEUME stecken drin, mit wie vielen Seiten? (Erwartet zum 1. September:
 *      ns 6 = Datei und ns 222 = Inoffiziell kommen neu dazu.)
 *   2. Stehen KATEGORIESEITEN drin (ns 14)? Das allein hilft noch nicht -- eine Kategorieseite
 *      ist die Kategorie, nicht ihre Mitglieder.
 *   3. 💣 DIE ENTSCHEIDENDE FRAGE: tragen die ARTIKEL ihre Kategorien als literalen
 *      [[Kategorie:...]]-Link im Quelltext? Nur dann sind sie aus dem Dump lesbar. Kommen sie
 *      weiterhin aus einer Vorlage, aendert der neue Dump an den drei Phasen NICHTS.
 *   4. Und zwar gemessen an den DREI Signalen, um die es geht -- Ortsgroesse, Bauwerksart,
 *      Kontinent -- nicht an Kategorien im Allgemeinen.
 *   5. Die is_official-Falle: wie viele Seiten liegen ausserhalb von ns 0? Solange nur ns 0
 *      hereinkam, stand is_official fest auf 1; mit ns 222 (Inoffiziell) waere das falsch.
 *
 * ===========================================================================
 * LAUF
 * ===========================================================================
 *   php -d extension=php_mbstring.dll tools/wikidump/messe-dump-kategorien.php <pfad-zum-dump> [seiten]
 *
 * Ohne Seitenzahl werden 50.000 Seiten gelesen -- genug fuer belastbare Anteile, wenige Minuten.
 * Mit `alle` laeuft er die ganze Datei durch.
 *
 * ⚠️ Kein Netz, keine Datenbank, kein Schreibvorgang. Reines Ansehen.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Nur auf der Kommandozeile.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 2);
require $wurzel . '/api/_internal/wiki/dump-reader.php';

$dumpPfad = (string) ($argv[1] ?? '');
if ($dumpPfad === '' || !is_file($dumpPfad)) {
    fwrite(STDERR, "Aufruf: php tools/wikidump/messe-dump-kategorien.php <pfad-zum-dump> [seiten|alle]\n");
    fwrite(STDERR, "Der angegebene Pfad ist keine Datei: " . ($dumpPfad === '' ? '(leer)' : $dumpPfad) . "\n");
    exit(2);
}

$grenzeRoh = (string) ($argv[2] ?? '50000');
$grenze = strtolower($grenzeRoh) === 'alle' ? null : max(1, (int) $grenzeRoh);

/**
 * Die Kategorienamen, die in EINEM Wikitext literal verlinkt sind.
 *
 * ⚠️ Bewusst tolerant: MediaWiki erlaubt "Kategorie", "Category", fuehrenden Doppelpunkt,
 * Leerzeichen um den Namen und einen Sortierschluessel hinter einem Pipe. Wer hier zu streng
 * liest, misst zu wenig und schliesst daraus faelschlich "steht nicht im Dump".
 *
 * @return list<string>
 */
function avesmapsMesseKategorienImText(string $wikitext): array {
    if ($wikitext === '' || stripos($wikitext, 'ategor') === false) {
        return [];
    }

    if (preg_match_all('/\[\[\s*:?\s*(?:Kategorie|Category)\s*:\s*([^\]|]+)/iu', $wikitext, $treffer) !== 1
        && empty($treffer[1])) {
        return [];
    }

    $namen = [];
    foreach ($treffer[1] as $roh) {
        $name = trim((string) $roh);
        if ($name !== '') {
            $namen[] = $name;
        }
    }

    return $namen;
}

// Die drei Signale, um die es geht -- als Namensanfaenge der echten Kategorien.
// 🔴 Bewusst hier aufgeschrieben statt aus dem Code gezogen: dieses Werkzeug soll auch dann
// etwas messen, wenn die Kategorienamen im Wiki inzwischen anders heissen. Es beantwortet
// "steht so etwas ueberhaupt drin", nicht "passt es auf unsere Tabelle".
const AVESMAPS_MESSE_ORTSGROESSEN = ['Dorf', 'Kleinstadt', 'Mittelgroße Stadt', 'Großstadt', 'Metropole'];
const AVESMAPS_MESSE_KONTINENTE = ['Aventurien', 'Myranor', 'Uthuria', 'Rakshazar', 'Tharun', 'Lahmaria'];

$seiten = 0;
$nachNamensraum = [];
$mitKategorieLink = 0;
$kategorieLinksGesamt = 0;
$mitOrtsgroesse = 0;
$mitKontinent = 0;
$mitBauwerksart = 0;
$kategorieSeiten = 0;
$beispiele = [];

$leser = avesmapsWikiDumpOpenReader($dumpPfad);
try {
    foreach (avesmapsWikiDumpIteratePages($leser, 0, $grenze) as $seite) {
        $seiten++;
        $ns = (int) ($seite['ns'] ?? 0);
        $nachNamensraum[$ns] = ($nachNamensraum[$ns] ?? 0) + 1;

        if ($ns === 14) {
            $kategorieSeiten++;
        }

        // Nur Artikel (ns 0) tragen die drei Signale, um die es geht.
        if ($ns !== 0) {
            continue;
        }

        $kategorien = avesmapsMesseKategorienImText((string) ($seite['wikitext'] ?? ''));
        if ($kategorien === []) {
            continue;
        }

        $mitKategorieLink++;
        $kategorieLinksGesamt += count($kategorien);

        $hatGroesse = false;
        $hatKontinent = false;
        $hatBauwerk = false;
        foreach ($kategorien as $name) {
            foreach (AVESMAPS_MESSE_ORTSGROESSEN as $groesse) {
                if (mb_stripos($name, $groesse) === 0) {
                    $hatGroesse = true;
                }
            }
            foreach (AVESMAPS_MESSE_KONTINENTE as $kontinent) {
                if (mb_stripos($name, $kontinent) !== false) {
                    $hatKontinent = true;
                }
            }
            if (mb_stripos($name, 'Bauwerk') !== false || mb_stripos($name, 'Burg') === 0
                || mb_stripos($name, 'Tempel') !== false || mb_stripos($name, 'Festung') === 0) {
                $hatBauwerk = true;
            }
        }

        if ($hatGroesse) {
            $mitOrtsgroesse++;
        }
        if ($hatKontinent) {
            $mitKontinent++;
        }
        if ($hatBauwerk) {
            $mitBauwerksart++;
        }

        if (count($beispiele) < 5 && ($hatGroesse || $hatKontinent)) {
            $beispiele[] = ($seite['title'] ?? '?') . '  ->  ' . implode(' · ', array_slice($kategorien, 0, 6));
        }
    }
} finally {
    $leser->close();
}

// ===========================================================================
// Bericht
// ===========================================================================
$zahl = static fn(int $n): string => number_format($n, 0, ',', '.');
$anteil = static fn(int $teil, int $ganz): string => $ganz > 0 ? number_format($teil * 100 / $ganz, 1, ',', '.') . ' %' : '—';

$artikel = $nachNamensraum[0] ?? 0;

echo "================================================================\n";
echo " Dump-Messung: Kategorien und Namensraeume\n";
echo "================================================================\n";
echo "Datei:    " . $dumpPfad . "\n";
echo "Gelesen:  " . $zahl($seiten) . " Seiten" . ($grenze === null ? " (ganze Datei)" : " (Deckel " . $zahl($grenze) . ")") . "\n\n";

echo "-- Namensraeume ------------------------------------------------\n";
ksort($nachNamensraum);
$bekannt = [0 => 'Artikel', 1 => 'Diskussion', 4 => 'Projekt', 6 => 'Datei', 10 => 'Vorlage', 14 => 'Kategorie', 222 => 'Inoffiziell'];
foreach ($nachNamensraum as $ns => $anzahl) {
    printf("  ns %-4d %-14s %10s  %s\n", $ns, $bekannt[$ns] ?? '', $zahl($anzahl), $anteil($anzahl, $seiten));
}
$ausserhalb = $seiten - $artikel;
echo "\n  Ausserhalb ns 0: " . $zahl($ausserhalb) . " (" . $anteil($ausserhalb, $seiten) . ")\n";
if (isset($nachNamensraum[222])) {
    echo "  💣 ns 222 (Inoffiziell) ist DA -- die is_official-Falle ist damit scharf:\n";
    echo "     das Feld steht fest auf 1, solange nur ns 0 hereinkam. Vor dem naechsten\n";
    echo "     scharfen Lauf muss entschieden sein, was mit diesen Seiten geschieht.\n";
} else {
    echo "  ns 222 (Inoffiziell) kommt in dieser Stichprobe NICHT vor.\n";
}

echo "\n-- Kategorien im Quelltext der Artikel --------------------------\n";
printf("  Artikel mit literalem [[Kategorie:...]]  %10s  %s\n", $zahl($mitKategorieLink), $anteil($mitKategorieLink, $artikel));
printf("  Kategorie-Links insgesamt                %10s\n", $zahl($kategorieLinksGesamt));
printf("  Kategorieseiten (ns 14)                  %10s\n", $zahl($kategorieSeiten));

echo "\n-- Die drei Signale, um die es geht ----------------------------\n";
printf("  Ortsgroesse (Dorf … Metropole)           %10s  %s\n", $zahl($mitOrtsgroesse), $anteil($mitOrtsgroesse, $artikel));
printf("  Kontinent   (Aventurien … Lahmaria)      %10s  %s\n", $zahl($mitKontinent), $anteil($mitKontinent, $artikel));
printf("  Bauwerksart (Burg/Tempel/Festung/…)      %10s  %s\n", $zahl($mitBauwerksart), $anteil($mitBauwerksart, $artikel));

if ($beispiele !== []) {
    echo "\n  Beispiele:\n";
    foreach ($beispiele as $beispiel) {
        echo "    " . $beispiel . "\n";
    }
}

echo "\n-- Urteil ------------------------------------------------------\n";
// 💣 GEURTEILT WIRD UEBER DIE DREI SIGNALE, NICHT UEBER KATEGORIEN ALLGEMEIN. Die erste
// Fassung dieses Werkzeugs rief "die Kategorien sind da!", weil 83 % der Artikel
// IRGENDEINE Kategorie trugen -- waehrend nur 8 % eine Ortsgroesse hatten. Genau der
// Fehlschluss, den dieses Werkzeug verhindern soll: eine hohe Zahl, die die Frage nicht
// beantwortet.
//
// 🔴 UND ES GIBT KEINE SCHWELLE, DIE DAS ALLEIN ENTSCHEIDEN KOENNTE. Eine Ortsgroesse
// tragen nur Siedlungen -- vielleicht ein Viertel aller Artikel. 8 % koennen also
// vollstaendig sein oder ein Zehntel des Bestands, und aus dieser Datei allein ist das
// nicht zu unterscheiden. Der belastbare Vergleich sind die Zahlen, die die
// ONLINE-Phasen liefern und die im Dump-Report stehen. Deshalb nennt das Urteil die
// absoluten Zahlen und den Vergleich, statt eine Ampel zu erfinden.
if ($artikel === 0) {
    echo "  Keine Artikel gelesen -- die Messung sagt nichts.\n";
} elseif ($mitOrtsgroesse === 0 && $mitKontinent === 0 && $mitBauwerksart === 0) {
    echo "  UNVERAENDERT: KEINES der drei Signale steht im Quelltext. Die Kategorien kommen\n";
    echo "  weiterhin aus einer Vorlage (Invariante I6). Die drei Online-Phasen bleiben\n";
    echo "  noetig, und der Lauf bleibt bei rund 25 Minuten. Kein Handlungsbedarf.\n";
} else {
    echo "  SIGNALE GEFUNDEN -- aber ob sie VOLLSTAENDIG sind, sagt diese Datei nicht.\n";
    echo "\n";
    echo "  Vergleiche die drei Zahlen oben mit denen aus dem letzten Dump-Report:\n";
    echo "\n";
    printf("    Ortsgroesse im Dump  %8s   <->   settlement (Report)\n", $zahl($mitOrtsgroesse));
    printf("    Bauwerksart im Dump  %8s   <->   building   (Report)\n", $zahl($mitBauwerksart));
    printf("    Kontinent   im Dump  %8s   <->   alle Arten zusammen\n", $zahl($mitKontinent));
    if ($grenze !== null) {
        echo "\n";
        echo "  ⚠️ Diese Messung hat nur " . $zahl($seiten) . " Seiten gelesen. Fuer den Vergleich mit dem\n";
        echo "     Report muss sie ueber die GANZE Datei laufen: Argument `alle`.\n";
    }
    echo "\n";
    echo "  Liegen die Zahlen in derselben Groessenordnung, koennten Ortsgroessen,\n";
    echo "  Bauwerksarten und Kontinente aus der DATEI kommen -- die drei langsamen Phasen\n";
    echo "  entfielen, und der Lauf faellt auf wenige Minuten.\n";
    echo "\n";
    echo "  ⚠️ Vor dem Umbau drei Dinge, die diese Messung NICHT beantwortet:\n";
    echo "     1. Decken sich die NAMEN mit AVESMAPS_WIKI_CATEGORY_TO_CLASS und der\n";
    echo "        Bauwerks-Unterkategorienliste? Ein anderer Name ist ein stiller Verlust.\n";
    echo "     2. Bleibt die ONLINE-Breite noetig? Die Klassen-Phase entdeckt heute auch,\n";
    echo "        WELCHE Titel es ueberhaupt gibt -- nicht nur ihre Klasse.\n";
    echo "     3. Sind die Kategorien im Dump AKTUELL? Der Dump ist ein Stand, die API\n";
    echo "        ist heute. Fuer einen Monatslauf egal, fuer eine Einzelkorrektur nicht.\n";
}

echo "\n🛈 Reines Ansehen -- dieses Werkzeug schreibt nichts.\n";
