<?php

declare(strict_types=1);

/**
 * DER RIEGEL VOR JEDEM DATEI-ABRUF BEI WIKI AVENTURICA.
 *
 * 🔴 Owner-Entscheid 23.08.2026, woertlich: „ich moechte, dass du alle file requests an die wiki
 * aventurica einstellst." Vorgeschichte: der Betreiber hat unsere Ausgangs-IP am 20.08. gesperrt,
 * der Owner hat um Entsperrung gebeten -- und zwei Tage spaeter lief der Wappen-Proxy erneut gegen
 * `Spezial:Dateipfad`, die Spezialseite, die uns die robots.txt des Wikis verbietet. Es geht ab
 * hier KEINE Bilddatei mehr raus.
 *
 * 💣 ES GIBT GENAU ZWEI FETCHER, UND BEIDE FRAGEN HIER (am Livebestand gemessen, 23.08.2026):
 *
 *   avesmapsCoatFetch                    -- api/app/coat.php (der oeffentliche Wappen-Proxy)
 *   avesmapsWikiSyncMonitorHttpGetBinary -- api/_internal/wiki/sync-monitor-identity.php,
 *                                           mit VIER Aufrufern: Territoriums-Wappen (:183),
 *                                           Wappen-Upload (:356), „Wappen lokalisieren"
 *                                           (settlements-coat-localize.php:198) und die
 *                                           Literatur-Cover (game-literature-sync.php:522).
 *
 * ⚠️ Die Zahl steht hier BEWUSST nicht als „2 von 2" im Kommentar: genau so eine Zahl hat am
 * 14.08.2026 die Suche nach weiteren Erzeugern beendet, obwohl es vier waren. Wer einen neuen
 * ausgehenden Abruf baut, verlaesst sich nicht auf diese Liste, sondern auf den Scanner in
 * `api/_internal/wiki/__tests__/datei-riegel-test.php` -- der laeuft ueber das ganze Repo.
 *
 * 🔴 BEWUSST NICHT ERFASST, beides mit Grund:
 *   - `sync.php` spricht die MediaWiki-**API** (`api.php`), keine Datei. Der Betreiber hat sie nie
 *     beanstandet, sie ist gedrosselt (0,6-0,85 s, 50 Titel je Anfrage) und war laut seiner eigenen
 *     Auskunft nicht der Verursacher.
 *   - `dump-fetch.php` holt den XML-Dump. Das ist EIN Abruf auf ausdrueckliche Editor-Aktion und
 *     genau der Weg, den die Dump-Policy dem Crawlen vorzieht -- ihn zu sperren erzeugte mehr
 *     Wiki-Verkehr, nicht weniger.
 *   Soll eines davon doch fallen, ist das je eine Zeile am Anfang der betreffenden Funktion.
 */

// 🔴 DER SCHALTER. `false` = es geht keine Datei mehr ans Wiki. Bewusst eine Code-Konstante und
// KEINE Zeile in `app_setting`: ein DB-Schalter kann leer laufen, stumm gekuerzt werden oder beim
// Lesen scheitern und faellt dann auf seinen Code-Standard zurueck -- und genau dieser Fehlerfall
// hat hier die teuerste Richtung. Wer wieder aufmacht, aendert diese Zeile und sieht es im Diff.
const AVESMAPS_WIKI_DATEI_ABRUF_ERLAUBT = false;

/**
 * PUR: wird diese URL von wiki-aventurica selbst ausgeliefert?
 *
 * 💣 Kein `stripos($host, 'wiki-aventurica.de')` -- das nimmt auch
 * `wiki-aventurica.de.angreifer.example` an. Geprueft wird der HOST auf Suffix-Grenze, dieselbe
 * Form wie in `avesmapsWikiSettlementCoatUrlIsWikiHost`.
 */
function avesmapsWikiDateiIstWikiHost(string $url): bool {
    $host = strtolower((string) parse_url(trim($url), PHP_URL_HOST));
    if ($host === '') {
        return false;
    }
    return preg_match('/(^|\.)wiki-aventurica\.de$/', $host) === 1;
}

/**
 * DIE EINE FRAGE VOR JEDEM AUSGEHENDEN DATEI-ABRUF: darf diese URL geholt werden?
 *
 * Fremde Hosts bleiben unberuehrt -- der Riegel gilt dem Wiki, nicht dem Internet.
 */
function avesmapsWikiDateiAbrufErlaubt(string $url): bool {
    if (!avesmapsWikiDateiIstWikiHost($url)) {
        return true;
    }
    return AVESMAPS_WIKI_DATEI_ABRUF_ERLAUBT || avesmapsWikiLokalisierungLaeuft();
}

/**
 * DIE EINE AUSNAHME VOM RIEGEL: ein ausdruecklich gestarteter Lokalisierungslauf.
 *
 * 🔴 Der Riegel gilt der ANZEIGE -- jedem Bild, das eine Seite beim Aufbau anfordert. Der
 * Lokalisierer ist das Gegenteil davon: er holt ein Bild EINMAL, damit es danach nie wieder
 * geholt werden muss. Ohne diese Ausnahme koennte er nie laufen, und der Bestand bliebe fuer
 * immer unvollstaendig.
 *
 * 💣 Das Flag lebt NUR IM LAUFENDEN PROZESS -- keine Konstante, keine Zeile in `app_setting`,
 * keine Datei. Ein Zustand, der einen Request ueberlebt, kann vergessen werden anzuschalten;
 * dieser hier endet mit der Anfrage, in der er gesetzt wurde. Wer ihn setzt, hat den Lauf
 * gerade selbst gestartet.
 *
 * ⚠️ Gesetzt wird er NUR ueber `avesmapsWikiAusdruecklicherAbruf` unten -- heute von zwei
 * Stellen: dem Upload per Bild-URL (`edit/wiki/settlement-coat-upload.php`) und dem
 * Territorien-Wappen-Download (`wiki/sync-monitor-identity.php`). Beide verlangen eine
 * Faehigkeit. Wer ihn woanders setzt, hebelt den Riegel aus.
 * 🪤 Hier stand „an genau EINER Stelle (`avesmapsWikiBilderLokalisierenLauf`)" -- den Lauf gibt
 * es seit dem 23.08.2026 nicht mehr (Owner: der Knopf „Bilder lokalisieren" ist raus). Eine ZAHL
 * in einem Kommentar veraltet still; sie war schon damals falsch, weil der Wrapper zwei weitere
 * Aufrufer hatte.
 */
function avesmapsWikiLokalisierungLaeuft(?bool $setzen = null): bool {
    static $laeuft = false;
    if ($setzen !== null) {
        $laeuft = $setzen;
    }
    return $laeuft;
}

/**
 * FUEHRT ETWAS ALS AUSDRUECKLICHE EDITOR-AKTION AUS -- der Riegel ist waehrenddessen offen.
 *
 * 🔴 Der Riegel gilt der ANZEIGE: jedem Bild, das eine Seite beim Aufbau von sich aus anfordert.
 * Er gilt NICHT dem Editor, der auf einen Knopf drueckt und dabei weiss, dass jetzt eine Anfrage
 * nach draussen geht. Genau drei Dinge sind solche Aktionen: der Lokalisierungslauf, ein Upload
 * per Bild-URL und das Zuruecksetzen eines Wappens auf den Wiki-Stand.
 *
 * 💣 Ohne diesen Weg haette der Riegel eine Funktion mitgenommen, die es vorher gab: der
 * Territorien-Upload nimmt seit jeher eine Bild-URL an und holt sie ueber denselben Fetcher.
 * Seit dem Riegel schlug das mit „Bild konnte von der URL nicht geladen werden" fehl -- eine
 * Regression, die wie ein Netzfehler aussieht.
 *
 * ⚠️ Immer ueber diesen Wrapper, nie mit `avesmapsWikiLokalisierungLaeuft(true)` von Hand: das
 * `finally` hier nimmt die Freigabe auch dann zurueck, wenn der Block wirft. Eine haengengebliebene
 * Freigabe oeffnet den Riegel fuer alles Uebrige in derselben Anfrage.
 *
 * @template T
 * @param callable():T $tun
 * @return T
 */
function avesmapsWikiAusdruecklicherAbruf(callable $tun) {
    $vorher = avesmapsWikiLokalisierungLaeuft();
    avesmapsWikiLokalisierungLaeuft(true);
    try {
        return $tun();
    } finally {
        // Auf den VORHERIGEN Stand, nicht hart auf false -- sonst schliesst ein verschachtelter
        // Aufruf die Freigabe des aeusseren mit.
        avesmapsWikiLokalisierungLaeuft($vorher);
    }
}
