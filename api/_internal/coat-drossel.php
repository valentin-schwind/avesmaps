<?php

declare(strict_types=1);

/**
 * Die Drossel vor dem Wappen-Proxy (`api/app/coat.php`).
 *
 * 💣 WARUM ES SIE GIBT: der Proxy cachte nur ERFOLGE. Ein Fehlschlag hinterliess keine Spur, also
 * holte der naechste Seitenaufbau dieselbe Adresse erneut vom Wiki. Als Wiki Aventurica am
 * 20.08.2026 unsere Ausgangs-IP sperrte, schlug damit JEDER Miss fehl -- und jeder Editor-Reload
 * feuerte die volle Miss-Menge (die Ortsliste traegt Tausende Zeilen) gegen `Spezial:Dateipfad`,
 * also genau die Spezialseite, die uns die robots.txt des Wikis verbietet. Die Sperre hielt sich
 * selbst am Leben: gesperrt -> Fehlschlag -> kein Cache -> naechster Reload -> gesperrt.
 *
 * Zwei Ebenen, und die zweite ist die tragende:
 *
 *  1. NEGATIV-CACHE je Adresse -- eine eben gescheiterte Adresse wird AVESMAPS_COAT_FAIL_TTL lang
 *     nicht erneut geholt. Faengt das wiederholte Anklopfen an derselben kaputten Datei.
 *
 *  2. GLOBALER RIEGEL (Circuit Breaker) -- haeufen sich Fehlschlaege, geht der Proxy GANZ zu und
 *     holt gar nichts mehr, auch keine Adresse, die noch nie versucht wurde.
 *     💣 Ebene 1 allein haette den Vorfall NICHT verhindert: Tausende VERSCHIEDENE Adressen sind
 *     Tausende Erstversuche, und ein Negativ-Cache je Adresse sieht jeden davon zum ersten Mal.
 *     Erst der Riegel deckelt einen Reload auf eine Handvoll Sonden.
 *
 * 🔴 Im Zweifel ZU. Laesst sich der Zustand nicht schreiben, gilt "nicht holen" -- die sichere
 * Richtung ist ein fehlendes Wappen, nie ein weiterer Schlag gegen ein Wiki, das uns schon sperrt.
 *
 * ⚠️ Kein LOCK_EX (NFS-Sperrdienst, siehe PHP-Pool-Haenger 17.07.2026); geschrieben wird atomar
 * ueber temp+rename. Zwei gleichzeitige Worker koennen sich einen Zaehlschritt wegnehmen -- der
 * Riegel faellt dann eine Anfrage spaeter, was folgenlos ist.
 *
 * ⚠️ Fehlt diese Datei auf dem Server, holt `api/app/coat.php` GAR NICHTS mehr -- der Proxy
 * laeuft nie ohne seine Drossel weiter. Genau dieser Zustand (Proxy ohne Bremse) war der
 * Vorfall.
 *
 * ⭐ Seit 23.08.2026 gibt es davor den Lokalisierer (`wiki/bilder-lokalisieren.php`): er holt
 * jedes Bild EINMAL auf unsere Platte, und `avesmapsCoatLokaleKopie` liefert es danach
 * statisch aus. Ist dieser Bestand vollstaendig, laeuft die Drossel leer -- sie bleibt als
 * Sicherung fuer den Tag, an dem jemand den Riegel wieder oeffnet.
 *
 * ⚠️ Ohne DB und ohne DDL: das hier laeuft auf einem oeffentlichen, heissen Pfad (dieselbe
 * Begruendung wie `avesmapsCoatSwitchEnabledFast`).
 */

// Wie lange eine einzelne gescheiterte Adresse in Ruhe gelassen wird.
const AVESMAPS_COAT_FAIL_TTL = 21600;            // 6 Stunden
// So viele Fehlschlaege innerhalb des Fensters schliessen den Riegel.
const AVESMAPS_COAT_BREAKER_SCHWELLE = 5;
const AVESMAPS_COAT_BREAKER_FENSTER = 300;       // 5 Minuten
// So lange bleibt danach ALLES zu; danach genau eine Sonde.
const AVESMAPS_COAT_BREAKER_KARENZ = 1800;       // 30 Minuten

function avesmapsCoatDrosselZustandsPfad(string $dir): string {
    return $dir . '/.drossel.json';
}

/** Schreibt atomar; ohne Lock, weil der Temp-Name pro Prozess eindeutig ist. */
function avesmapsCoatDrosselSchreiben(string $pfad, string $inhalt): void {
    $tmp = $pfad . '.tmp.' . getmypid();
    if (@file_put_contents($tmp, $inhalt) !== false && !@rename($tmp, $pfad)) {
        @unlink($tmp);
    }
}

/** @return array{fehler:list<int>,zu_bis:int} */
function avesmapsCoatDrosselZustandLesen(string $dir): array {
    $roh = @file_get_contents(avesmapsCoatDrosselZustandsPfad($dir));
    $daten = is_string($roh) ? json_decode($roh, true) : null;
    if (!is_array($daten)) {
        return ['fehler' => [], 'zu_bis' => 0];
    }
    $fehler = [];
    foreach ((array) ($daten['fehler'] ?? []) as $ts) {
        if (is_int($ts) || (is_numeric($ts) && (string) (int) $ts === (string) $ts)) {
            $fehler[] = (int) $ts;
        }
    }
    return ['fehler' => $fehler, 'zu_bis' => (int) ($daten['zu_bis'] ?? 0)];
}

/**
 * Darf diese Adresse jetzt vom Wiki geholt werden?
 *
 * 🔴 Die einzige Frage, die der Proxy vor einem ausgehenden Abruf stellen muss. Wer hier
 * vorbeigeht, umgeht die Drossel vollstaendig.
 */
function avesmapsCoatDrosselDarfHolen(string $dir, string $key, int $jetzt): bool {
    // Ohne schreibbaren Zustand kann sich die Drossel nichts merken -- dann gilt "zu".
    if (!is_dir($dir) || !is_writable($dir)) {
        return false;
    }

    // Ebene 1: diese Adresse ist eben gescheitert.
    $fehlPfad = $dir . '/' . $key . '.fail';
    $ts = @file_get_contents($fehlPfad);
    if (is_string($ts) && $ts !== '' && ($jetzt - (int) $ts) < AVESMAPS_COAT_FAIL_TTL) {
        return false;
    }

    // Ebene 2: der Riegel gilt fuer ALLE Adressen, auch nie versuchte.
    $zustand = avesmapsCoatDrosselZustandLesen($dir);
    if ($zustand['zu_bis'] > $jetzt) {
        return false;
    }
    return true;
}

/** Notiert einen gescheiterten Abruf und schliesst den Riegel, wenn es zu viele werden. */
function avesmapsCoatDrosselFehlschlag(string $dir, string $key, int $jetzt): void {
    if (!is_dir($dir) || !is_writable($dir)) {
        return;
    }
    avesmapsCoatDrosselSchreiben($dir . '/' . $key . '.fail', (string) $jetzt);

    $zustand = avesmapsCoatDrosselZustandLesen($dir);

    // War der Riegel schon einmal zu und die Karenz gerade abgelaufen, ist dieser Abruf die SONDE.
    // Scheitert sie, geht es sofort wieder zu -- nicht erst nach weiteren SCHWELLE Schlaegen.
    $sondeGescheitert = $zustand['zu_bis'] > 0 && $jetzt >= $zustand['zu_bis'];

    // Nur Fehlschlaege innerhalb des Fensters zaehlen: vereinzelte ueber Stunden sind keine Sperre,
    // sonst legt ein einzelnes dauerhaft kaputtes Bild den ganzen Proxy lahm.
    $fehler = array_values(array_filter(
        $zustand['fehler'],
        static fn (int $ts): bool => ($jetzt - $ts) < AVESMAPS_COAT_BREAKER_FENSTER
    ));
    $fehler[] = $jetzt;

    if ($sondeGescheitert || count($fehler) >= AVESMAPS_COAT_BREAKER_SCHWELLE) {
        $zuBis = $jetzt + AVESMAPS_COAT_BREAKER_KARENZ;
        $fehler = [];
    } else {
        $zuBis = 0;
    }

    avesmapsCoatDrosselSchreiben(
        avesmapsCoatDrosselZustandsPfad($dir),
        (string) json_encode(['fehler' => $fehler, 'zu_bis' => $zuBis])
    );
}

/**
 * Legt NUR diese eine Adresse schlafen, ohne den Riegel zu belasten.
 *
 * Fuer den Fall "das Wiki hat geantwortet, aber es war kein brauchbares Bild" (HTTP 415). Das Ziel
 * ist gesund -- ein Riegel waere hier falsch und wuerde gesunde Wappen mit ausschliessen. Die
 * Adresse selbst aber ist es nicht, und ohne diesen Vermerk fragt sie jeder Seitenaufbau erneut an:
 * dieselbe Endlosschleife wie beim Vorfall, nur ohne die Sperre als Bremse.
 */
function avesmapsCoatDrosselAdresseRuhen(string $dir, string $key, int $jetzt): void {
    if (!is_dir($dir) || !is_writable($dir)) {
        return;
    }
    avesmapsCoatDrosselSchreiben($dir . '/' . $key . '.fail', (string) $jetzt);
}

/** Ein geglueckter Abruf raeumt den Riegel weg -- antwortet das Wiki wieder, laeuft alles normal. */
function avesmapsCoatDrosselErfolg(string $dir, string $key, int $jetzt): void {
    if (!is_dir($dir) || !is_writable($dir)) {
        return;
    }
    @unlink($dir . '/' . $key . '.fail');
    avesmapsCoatDrosselSchreiben(
        avesmapsCoatDrosselZustandsPfad($dir),
        (string) json_encode(['fehler' => [], 'zu_bis' => 0])
    );
}
