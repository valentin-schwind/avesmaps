<?php

declare(strict_types=1);

/**
 * DIE DROSSEL -- der Abstand, den das Wiki Aventurica uns vorschreibt, fuer JEDEN Abruf.
 *
 * 🔴 WARUM SIE EINE EIGENE DATEI IST. Bis zum 25.08.2026 stand sie mitten in `sync.php`, der
 * Crawl-Bibliothek -- und damit war sie nur fuer den erreichbar, der die ganzen ~1800 Zeilen
 * lud. Genau das konnten die DATEI-Abrufe nicht: `api/app/coat.php` ist ein oeffentlicher
 * Endpunkt, der je Wappenbild einmal laeuft, und `sync-monitor-identity.php` haengt an keinem
 * Crawl. Beide feuerten deshalb ungedrosselt -- nicht aus Nachlaessigkeit, sondern weil die
 * Regel an einem Ort lag, den sie nicht erreichen konnten. Eine Regel, die nur ein Teil der
 * Erzeuger ueberhaupt aufrufen KANN, ist keine Regel (AGENTS.md §9).
 *
 * ⚠️ Deshalb bleibt diese Datei klein und abhaengigkeitsarm: kein PDO, keine Konfiguration,
 * nichts aus `bootstrap.php`. Wer sie laedt, bezahlt nichts dafuer.
 *
 * 💣 ZWEI ZWEIGE, UND DER UNTERSCHIED IST NICHT KOSMETIK:
 *   * `avesmapsWikiSyncThrottleWikiRequest()` WARTET, bis der Platz frei ist. Richtig fuer
 *     jeden Lauf, den ein Editor ausdruecklich gestartet hat -- er ist in Schritte zerlegt und
 *     darf Zeit kosten.
 *   * `avesmapsWikiDrosselPlatzFrei()` wartet NICHT, sondern meldet, ob der Platz frei war.
 *     Richtig fuer `coat.php`: das ist ein Seitenaufbau, und 20 Sekunden Schlaf darin halten
 *     einen PHP-Arbeiter fest. Fuenf gleichzeitige Wappen-Fehlschlaege waeren fuenf blockierte
 *     Arbeiter -- die Arbeiter-Saettigung, vor der AGENTS.md §10 warnt, also schlimmer als das
 *     Uebel. Ein abgewiesener Abruf antwortet stattdessen sofort mit 503.
 *
 * Beide teilen denselben Vermerk und damit dieselbe Warteschlange; zwei Drosseln nebeneinander
 * waeren keine.
 */

// 🔴 Das Host-Praedikat kommt VON DORT, es wird hier nicht abgeschrieben. "Ist das eine
// Wiki-Adresse?" ist genau die Art Frage, die in diesem Projekt schon zweimal zwei Antworten
// hatte -- und die zweite war jedes Mal die laxere.
require_once __DIR__ . '/datei-riegel.php';

/**
 * Meldet einen Ausfall der Drossel ins Fehlerprotokoll.
 *
 * 🔴 GEFRAGT, NICHT VORAUSGESETZT: `avesmapsWikiSyncLogServerError` wohnt in `sync.php`, und
 * diese Datei laedt `sync.php` ausdruecklich NICHT (sonst zoege `coat.php` die ganze
 * Crawl-Bibliothek nach). Wer sie hat, bekommt die uebliche Zeile; wer nicht, bekommt dieselbe
 * Aussage direkt.
 *
 * 💣 Was hier NICHT stehen darf, ist ein stilles `return`. Ein Ausfall der Drossel ist von
 * "laeuft richtig" nicht zu unterscheiden, und sein Preis ist die Sperre unserer Ausgangs-IP.
 * Beide Zweige sind laut.
 */
function avesmapsWikiDrosselMelden(string $label, array $kontext): void {
    if (function_exists('avesmapsWikiSyncLogServerError')) {
        avesmapsWikiSyncLogServerError($label, $kontext);
        return;
    }

    $rumpf = json_encode(
        ['label' => $label, 'context' => $kontext],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    error_log('Avesmaps WikiSync error: ' . ($rumpf !== false ? $rumpf : $label));
}

/**
 * ZWANZIG SEKUNDEN, UND DIE ZAHL IST NICHT UNSERE, SONDERN IHRE. Das Wiki Aventurica hat uns am
 * 24.08.2026 einen EIGENEN Abschnitt in seiner robots.txt gegeben:
 *
 *     User-agent: AvesmapsWikiSync
 *     Crawl-delay: 20
 *
 * Das ist keine Empfehlung mehr (die Bot-Richtlinie nennt 2 s), sondern die Regel, unter der uns
 * derselbe Abschnitt `/de/api.php` ueberhaupt erst erlaubt -- fuer `User-agent: *` bleibt die API
 * verboten. Wir waren bis dahin auf 0,6 s.
 *
 * DESHALB DARF DER USER-AGENT NICHT MEHR UMBENANNT WERDEN. Genau diese Zeichenkette steht in
 * ihrer robots.txt; eine neue Version im Namen wuerfe uns zurueck unter `*`, und dort ist die API
 * gesperrt. Der Name ist ab hier eine Schnittstelle, kein Etikett.
 *
 * UND DAMIT IST DIE BOT-ANMELDUNG TRAGEND, NICHT MEHR NUR NUETZLICH: gerechnet an der
 * Kontinent-Phase (rund 9000 Titel) sind es als Bot 18 Aufrufe = gut 6 Minuten, anonym 180
 * Aufrufe = ueber eine STUNDE. Wer den Login abschaltet, macht den Dump-Lauf unbenutzbar.
 */
const AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS = 20000000;
/**
 * Wie viele Abstaende ein vermerkter Platz hoechstens in der Zukunft liegen darf, bevor er
 * als KAPUTT gilt (verstellte Uhr, von Hand angefasste Datei) statt als Warteschlange.
 *
 * ⚠️ Grosszuegig, und das mit Absicht: bei echter Gleichzeitigkeit ist ein Platz weit
 * hinten voellig berechtigt (der zehnte Wartende wartet zehn Abstaende). Zu knapp
 * gedeckelt zerreisst die Staffelung -- und dann feuern alle gemeinsam los, also genau
 * das, was die Drossel verhindern soll.
 */
const AVESMAPS_WIKI_DROSSEL_MAX_WARTESCHLANGE = 20;

/**
 * Die Sperre fuer den Ablageort des Drossel-Vermerks -- gleiche Bauart wie uploads/db-backups
 * und uploads/svg-export. 🔴 DIESE KONSTANTE IST DIE QUELLE, es gibt keine Kopie im Repo:
 * `uploads/` steht nicht in der Deploy-Allowlist, die Sperre kaeme also nie von dort und heilt
 * sich zur Laufzeit.
 */
const AVESMAPS_WIKI_DROSSEL_HTACCESS = "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n\n"
    . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n";

/**
 * Wo der Zeitpunkt der letzten Wiki-Anfrage vermerkt wird -- oder null, wenn es keinen
 * schreibbaren Ort gibt.
 *
 * 💣 WARUM EINE DATEI UND NICHT EINE VARIABLE: der Abstand muss ueber PROZESSGRENZEN gelten.
 * Jeder Schritt eines Dump-Laufs ist eine eigene HTTP-Anfrage und damit ein eigener
 * PHP-Prozess; eine statische Variable faengt in jedem davon bei null an. Solange eine Phase
 * ihre zwoelf Abfragen in EINEM Schritt machte, lagen elf Pausen dazwischen -- seit sie
 * unterbrechbar ist, waeren es null. Der Crawl-delay 20 aus der Wiki-robots.txt waere damit
 * faktisch abgeschafft, ohne dass irgendwo eine Zahl geaendert worden waere.
 *
 * 💣 WARUM KEINE DATENBANK: diese Datei muss sich ohne PDO laden und benutzen lassen (das
 * Testfeld tut genau das). Ein Zeitstempel, den nur bekommt, wer eine Datenbankverbindung
 * hat, waere in der Haelfte der Aufrufer nicht da.
 *
 * ⚠️ Kein schreibbarer Ort = null = Rueckfall auf das alte, prozesslokale Verhalten. Auf dem
 * Entwicklungsrechner ist das der Normalfall und ausdruecklich KEIN Fehler.
 */
function avesmapsWikiSyncDrosselVermerkDatei(): ?string {
    if (!function_exists('avesmapsApiRoot')) {
        return null;
    }

    try {
        $verzeichnis = dirname(avesmapsApiRoot()) . DIRECTORY_SEPARATOR . 'uploads'
            . DIRECTORY_SEPARATOR . 'wiki-drossel';
    } catch (Throwable) {
        return null;
    }

    if (!is_dir($verzeichnis) && !@mkdir($verzeichnis, 0775, true) && !is_dir($verzeichnis)) {
        // 🔴 HIER DARF ES NICHT STILL SEIN. Ohne Vermerk faellt die Drossel auf ihr
        // prozesslokales Verhalten zurueck -- und weil jeder Schritt ein eigener Prozess ist,
        // heisst das: gar kein Abstand mehr. Von aussen ist das von "laeuft richtig" nicht zu
        // unterscheiden, und der Preis waere die Sperre, aus der uns der Betreiber am
        // 24.08.2026 gerade erst herausgeholt hat.
        // ⚠️ Genau EINMAL je Prozess, und nur dort, wo es ueberhaupt ein uploads/ geben kann
        // (avesmapsApiRoot oben) -- auf dem Entwicklungsrechner ist der Rueckfall der Normalfall
        // und ausdruecklich kein Fehler.
        static $schonGemeldet = false;
        if (!$schonGemeldet) {
            $schonGemeldet = true;
            avesmapsWikiDrosselMelden('wiki_drossel_ohne_vermerk', ['verzeichnis' => $verzeichnis]);
        }

        return null;
    }

    $sperre = $verzeichnis . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($sperre) || @file_get_contents($sperre) !== AVESMAPS_WIKI_DROSSEL_HTACCESS) {
        @file_put_contents($sperre, AVESMAPS_WIKI_DROSSEL_HTACCESS);
    }

    return $verzeichnis . DIRECTORY_SEPARATOR . 'letzte-anfrage';
}

/**
 * Den Abstand ueber die Prozessgrenze hinweg einhalten. Gibt zurueck, ob das gelungen ist --
 * false heisst "kein schreibbarer Vermerk", und der Aufrufer faellt auf sein prozesslokales
 * Verhalten zurueck.
 *
 * ⭐ ES WIRD EIN PLATZ RESERVIERT, NICHT DIE SPERRE GEHALTEN. Der Aufrufer traegt unter der
 * Sperre ein, WANN er dran ist, gibt sie sofort wieder frei und schlaeft erst danach. Zwei
 * gleichzeitige Aufrufer bekommen so aufeinanderfolgende Plaetze, ohne einander zu blockieren.
 *
 * 💣 DIE ERSTE FASSUNG HIELT DIE SPERRE WAEHREND DES SCHLAFENS (24.08.2026), und das war
 * gefaehrlicher als es aussah: N gleichzeitige Anfragen warten dann nacheinander AUF DIE SPERRE,
 * jede belegt dabei einen PHP-Arbeiter, und die Antwortzeit waechst mit N x 20 s. Auf STRATOs
 * geteiltem Hosting ist das genau die Arbeiter-Saettigung, vor der AGENTS.md warnt -- und ein
 * Lauf, den der Owner ein zweites Mal startet (die Pipeline-Sperre laesst denselben Benutzer
 * wieder herein), reicht schon fuer zwei. Reserviert wird in Mikrosekunden, geschlafen ohne
 * Sperre.
 *
 * 💣 GEDECKELT WIRD DER GELESENE PLATZ, NICHT DER SCHLAF. Die erste Fassung deckelte die
 * Wartezeit gegen JETZT -- und zerriss damit genau die Warteschlange, die sie schuetzen
 * sollte: lag der Vermerk weit vorn, warteten ALLE Wartenden denselben Deckel ab und
 * feuerten gemeinsam los. Gemessen 25.08.2026 mit vier gleichzeitigen Prozessen und einem
 * Vermerk 30 s in der Zukunft: 0,09 s Abstand statt 0,2. Ein absurd weit vorn liegender
 * Platz ist KAPUTT (verstellte Uhr, Handarbeit), nicht Warteschlange -- er wird beim LESEN
 * auf jetzt zurueckgesetzt, und danach steht die Staffelung wieder.
 *
 * 💣 UND EIN UNLESBARER VERMERK IST NICHT NULL. Die erste Fassung machte aus jedem
 * nicht-numerischen Inhalt eine 0.0, rechnete `max(jetzt, 0 + Abstand)` = jetzt und feuerte
 * OHNE Pause -- und meldete dabei Erfolg, sodass auch der prozesslokale Rueckfall nicht
 * griff. Gemessen: 0,006 s statt der geforderten 0,1. Ein leerer Vermerk entsteht auf
 * STRATO von selbst, sobald die Speicherquote den Schreibvorgang abweist. Deshalb: FEHLT
 * die Datei, ist es die erste Anfrage (kein Warten); ist sie DA und unlesbar, wird ein
 * voller Abstand angenommen -- die sichere Richtung.
 */
function avesmapsWikiSyncDrosselUeberProzessgrenze(
    int $mindestabstand,
    ?string $vermerkDatei,
    bool $nurWennFrei = false
): string {
    if ($vermerkDatei === null) {
        return 'kein_vermerk';
    }

    // ⚠️ VOR dem Oeffnen: 'c+' legt die Datei an, danach liesse sich 'gab es noch nie eine
    // Anfrage' nicht mehr von 'der Vermerk wurde zerstoert' unterscheiden.
    $neuAngelegt = !is_file($vermerkDatei);

    $griff = @fopen($vermerkDatei, 'c+');
    if ($griff === false) {
        return 'kein_vermerk';
    }

    if (!@flock($griff, LOCK_EX)) {
        @fclose($griff);
        return 'kein_vermerk';
    }

    $abstandSekunden = $mindestabstand / 1000000;
    $jetzt = microtime(true);
    $meinPlatz = $jetzt;
    $geschrieben = false;

    try {
        $roh = trim((string) @stream_get_contents($griff));

        if ($roh === '') {
            // Leer heisst: es gab noch nie eine Anfrage (oder ein Schreibvorgang ist
            // gescheitert). Beides behandeln wir gleich vorsichtig NICHT -- die erste
            // Anfrage darf ohne Warten durch, ein zerstoerter Vermerk nicht. Unterscheiden
            // laesst sich das hier nicht, also entscheidet die Groesse der Datei: eine
            // eben erst angelegte ist leer, eine zerstoerte ebenfalls. Wir nehmen die
            // sichere Richtung und warten einen vollen Abstand, sobald die Datei schon
            // einmal beschrieben war -- erkennbar daran, dass sie ueberhaupt existiert und
            // nicht in DIESEM Aufruf entstanden ist.
            $letzter = $neuAngelegt ? 0.0 : $jetzt;
        } elseif (is_numeric($roh)) {
            $letzter = (float) $roh;
        } else {
            // Unlesbar: sichere Richtung, voller Abstand.
            $letzter = $jetzt;
        }

        // Ein Platz absurd weit in der Zukunft ist kaputt, nicht Warteschlange. Der Deckel
        // laesst genug Luft fuer echte Gleichzeitigkeit und faengt trotzdem die verstellte
        // Uhr -- ohne die Staffelung der Wartenden zu zerreissen.
        $deckel = $jetzt + ($abstandSekunden * AVESMAPS_WIKI_DROSSEL_MAX_WARTESCHLANGE);
        if ($letzter > $deckel) {
            $letzter = $jetzt;
        }

        // Mein Platz: entweder jetzt, oder einen vollen Abstand hinter dem letzten vergebenen.
        $meinPlatz = max($jetzt, $letzter + $abstandSekunden);

        // 🔴 DER NICHT WARTENDE ZWEIG STEIGT HIER AUS -- UNTER DER SPERRE UND VOR DEM SCHREIBEN.
        // Er hat nichts geholt, also darf er auch keinen Platz belegen: ein reservierter Platz
        // wuerde den naechsten ECHTEN Abruf um einen vollen Abstand nach hinten schieben, und
        // bei einer Seite voller Wappen-Fehlschlaege waere die Warteschlange binnen Sekunden
        // Minuten lang -- eine Drossel, die sich selbst zustellt.
        // ⚠️ Kein eigenes flock/fclose hier: das `finally` unten raeumt auch bei einem `return`
        // aus dem `try` auf. Von Hand freizugeben hiesse, es zweimal zu tun.
        if ($nurWennFrei && $meinPlatz > $jetzt) {
            return 'belegt';
        }

        // 💣 ERST SCHREIBEN, DANN KUERZEN -- und den Erfolg pruefen. Die erste Fassung rief
        // ftruncate() VOR fwrite() und sah dessen Rueckgabewert nie an: scheiterte der
        // Schreibvorgang (auf STRATO der dokumentierte Quotenfall), blieb die Datei LEER
        // zurueck, und danach feuerte jeder Prozess ohne jede Pause.
        @rewind($griff);
        $bytes = @fwrite($griff, sprintf('%.6F', $meinPlatz));
        if ($bytes !== false && $bytes > 0) {
            @ftruncate($griff, $bytes);
            @fflush($griff);
            $geschrieben = true;
        }
    } finally {
        // Erst freigeben, DANN schlafen -- siehe Docblock.
        @flock($griff, LOCK_UN);
        @fclose($griff);
    }

    if (!$geschrieben) {
        // 🔴 Konnte der Platz nicht vermerkt werden, ist die prozessuebergreifende Drossel
        // wirkungslos -- dann muss der prozesslokale Rueckfall greifen, statt hier Erfolg
        // zu melden. Und es muss laut sein: ein stiller Ausfall ist von 'laeuft richtig'
        // nicht zu unterscheiden.
        static $schreibfehlerGemeldet = false;
        if (!$schreibfehlerGemeldet) {
            $schreibfehlerGemeldet = true;
            avesmapsWikiDrosselMelden('wiki_drossel_vermerk_nicht_schreibbar', ['datei' => $vermerkDatei]);
        }

        return 'kein_vermerk';
    }

    $rest = (int) (($meinPlatz - microtime(true)) * 1000000);
    if ($rest > 0) {
        usleep($rest);
    }

    return 'genommen';
}

/**
 * 💣 GEDROSSELT WIRD DER ABSTAND ZWISCHEN ZWEI ANFRAGEN -- NICHT JEDE EINZELNE.
 *
 * Bis zum 24.08.2026 schlief diese Funktion bedingungslos vor JEDER Anfrage, auch vor der
 * ersten im Prozess. Bei 0,6 s fiel das niemandem auf; bei den 2 s, die die Bot-Richtlinie
 * empfiehlt, wartet der Editor im Zuweisungsdialog zwei Sekunden auf eine Suche, die aus einer
 * einzigen Anfrage besteht -- eine Wartezeit, die dem Wiki NICHTS erspart, weil es davor und
 * danach ohnehin still war.
 *
 * Also: merken, wann die letzte Anfrage lief, und nur die noch fehlende Zeit abwarten. Der
 * Abstand, den das Wiki sieht, ist derselbe; die Wartezeit, die ein Mensch sieht, faellt weg.
 * ⚠️ Der Merker gilt je PHP-Prozess -- auf STRATO ist das je Web-Anfrage. Fuer die
 * Stapelphasen, die die Masse ausmachen, ist das genau richtig: sie laufen der Reihe nach in
 * EINEM Prozess. Ein zweiter Editor, der gleichzeitig sucht, kommt daran vorbei; das sind
 * einzelne Anfragen von Menschen, keine Last.
 */
/**
 * Der Abstand zwischen zwei Wiki-Anfragen -- der Crawl-delay aus der Wiki-robots.txt.
 *
 * 🔴 ER GILT UEBER PROZESSGRENZEN, seit die Dump-Phasen unterbrechbar sind (24.08.2026). Vorher
 * zaehlte nur die statische Variable unten, und die faengt in jedem PHP-Prozess bei null an:
 * zwoelf Schritte waren zwoelf erste Anfragen und damit NULL Pausen. Aus "zu langsam"
 * (HTTP 502) war "zu schneller als erlaubt" geworden -- dieselbe Grenze, nur von der anderen
 * Seite gerissen.
 *
 * ⭐ GEMESSEN 24.08.2026: JEDER Aufrufer der Wiki-API im Haus sitzt in einer Crawl-Bibliothek
 * (locations/paths/regions/settlements/territories/sync-monitor/dump-category-layer). Es gibt
 * KEINEN interaktiven Einzelabruf ans lebende Wiki -- die Zuweisungsdialoge suchen in unseren
 * eigenen Tabellen. Deshalb gilt der dauerhafte Abstand hier ohne Ausnahme; die Unterscheidung
 * "Massenlauf gegen Einzelabruf" haette heute eine leere zweite Haelfte. ⚠️ Kommt je ein
 * interaktiver Abruf dazu, ist DAS die Stelle, an der er eine Ausnahme braeuchte -- und die
 * Entscheidung gehoert dem Owner, nicht dem Code: der Crawl-delay gilt unserem User-Agent,
 * nicht einzelnen Funktionen.
 *
 * Die zwei Parameter existieren NUR fuer den Test: ohne sie muesste der die vollen 20 Sekunden
 * schlafen und einen echten uploads/-Pfad haben -- ein Test, der 20 Sekunden kostet, wird als
 * erstes wieder herausgenommen. Die Produktion ruft ohne Argumente auf.
 */
function avesmapsWikiSyncThrottleWikiRequest(
    ?int $abstandMikrosekunden = null,
    ?string $vermerkDateiFuerTest = null
): void {
    static $letzteAnfrage = null;

    $jitter = random_int(0, 250000);
    $mindestabstand = ($abstandMikrosekunden ?? AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS) + $jitter;

    $vermerk = $vermerkDateiFuerTest ?? avesmapsWikiSyncDrosselVermerkDatei();
    if (avesmapsWikiSyncDrosselUeberProzessgrenze($mindestabstand, $vermerk) === 'genommen') {
        $letzteAnfrage = microtime(true);
        return;
    }

    // Rueckfall ohne schreibbaren Vermerk: das alte, prozesslokale Verhalten.
    if ($letzteAnfrage !== null) {
        $vergangen = (int) ((microtime(true) - $letzteAnfrage) * 1000000);
        $rest = $mindestabstand - $vergangen;
        if ($rest > 0) {
            usleep($rest);
        }
    }

    $letzteAnfrage = microtime(true);
}

/**
 * GILT DIE DROSSEL FUER DIESE ADRESSE?
 *
 * 🔴 Sie gilt dem WIRT, nicht der Funktion. Der Crawl-delay steht in der robots.txt des Wikis
 * und bindet damit jede Anfrage dorthin -- API, Bilddatei, Dump. Ein fremder Wirt geht uns
 * nichts an und wird nicht gebremst; das ist wichtig fuer die zwei generischen Abrufer
 * (Linkchecker, Wappen-Upload per Bild-URL), die ueberwiegend ganz woanders hinlaufen.
 *
 * 💣 `offline.wiki-aventurica.de` ZAEHLT MIT, obwohl dort nur der Dump liegt: beide Namen
 * zeigen auf dieselbe IP, und gesperrt wird eine IP, kein Name (20.08.2026 gemessen).
 * `avesmapsWikiDateiIstWikiHost` prueft auf Suffix-Grenze und deckt beide ab.
 */
function avesmapsWikiDrosselGiltFuer(string $url): bool {
    return avesmapsWikiDateiIstWikiHost($url);
}

/**
 * DER ZWEIG, DER NICHT WARTET: nimmt den Platz, wenn er frei ist, und meldet sonst `false`.
 *
 * 🔴 WOFUER ER DA IST. `api/app/coat.php` beantwortet einen SEITENAUFBAU. Wuerde er die vollen
 * 20 Sekunden abwarten, haelt er so lange einen PHP-Arbeiter -- und eine Editorliste mit
 * mehreren nicht gecachten Wappen macht daraus mehrere gleichzeitig. Das ist die
 * Arbeiter-Saettigung aus AGENTS.md §10, also die teurere Haelfte des Problems: die Karte
 * stuende, statt dass ein Wappen fehlt. Ein abgewiesener Abruf antwortet deshalb sofort mit
 * 503 und ueberlaesst das Nachholen dem ausdruecklichen Lokalisierungslauf.
 *
 * 💣 ER RESERVIERT NICHTS, WENN ER ABWEIST. Ein abgewiesener Abruf hat keine Anfrage nach
 * draussen geschickt; belegte er trotzdem einen Platz, schoebe jede abgewiesene Anfrage den
 * naechsten echten Abruf um einen vollen Abstand nach hinten. Eine Seite mit dreissig fehlenden
 * Wappen haette die Warteschlange damit auf zehn Minuten gestellt, ohne dass ein einziges Bild
 * geholt worden waere.
 *
 * ⚠️ OHNE SCHREIBBAREN VERMERK gilt derselbe Rueckfall wie beim wartenden Zweig, nur ohne
 * Schlaf: prozesslokal messen und im Zweifel abweisen. Auf dem Entwicklungsrechner ist das der
 * Normalfall.
 *
 * Die zwei Parameter existieren NUR fuer den Test -- wie beim wartenden Zweig.
 */
function avesmapsWikiDrosselPlatzFrei(
    ?int $abstandMikrosekunden = null,
    ?string $vermerkDateiFuerTest = null
): bool {
    static $letzteAnfrage = null;

    // ⚠️ KEIN Jitter. Der wartende Zweig streut, damit gleichzeitig gestartete Laeufe nicht im
    // Gleichschritt feuern -- hier gibt es nichts zu streuen, es wird ja nicht gewartet, und
    // eine zufaellig groessere Schranke machte die Abweisung unreproduzierbar.
    $mindestabstand = $abstandMikrosekunden ?? AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS;

    $vermerk = $vermerkDateiFuerTest ?? avesmapsWikiSyncDrosselVermerkDatei();
    $urteil = avesmapsWikiSyncDrosselUeberProzessgrenze($mindestabstand, $vermerk, true);

    if ($urteil === 'genommen') {
        $letzteAnfrage = microtime(true);

        return true;
    }

    if ($urteil === 'belegt') {
        return false;
    }

    // Rueckfall ohne schreibbaren Vermerk: prozesslokal, und ohne Schlaf.
    if ($letzteAnfrage !== null
        && (int) ((microtime(true) - $letzteAnfrage) * 1000000) < $mindestabstand
    ) {
        return false;
    }

    $letzteAnfrage = microtime(true);

    return true;
}
