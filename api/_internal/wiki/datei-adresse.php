<?php

declare(strict_types=1);

/**
 * DER ERLAUBTE WEG ZU EINER WIKI-BILDDATEI: Titel -> `api.php` -> echte Adresse.
 *
 * 🔴 WARUM ES DIESE DATEI GIBT. Die robots.txt des Wiki Aventurica verbietet `/wiki/Spezial:` --
 * JEDEM Agenten, auch unserem eigenen Abschnitt `AvesmapsWikiSync`, und seit jeher. Genau diese
 * Seite (`Spezial:Dateipfad/<Datei>`, der kanonische Umweg vom Dateinamen zum Bild) haben wir am
 * 20. und 23.08.2026 massenhaft abgerufen, und genau dafuer hat ihre `bot-trap` unsere
 * Ausgangs-IP gesperrt. Die Drossel vom 25.08.2026 hat das langsam gemacht -- erlaubt hat sie es
 * nicht. Eine Regel einzuhalten heisst nicht, sie langsamer zu brechen.
 *
 * ⭐ Der erlaubte Weg steht in derselben Datei, live nachgelesen am 25.08.2026:
 *   * `/de/api.php` ist fuer `AvesmapsWikiSync` FREIGEGEBEN -- fuer `User-agent: *` nicht.
 *     Deshalb laeuft die Abfrage ueber `avesmapsWikiSyncApiRequest`: das ist der EINE Weg im
 *     Haus, der unseren Namen, die Drossel, die Bot-Anmeldung und die Wiederholungen mitbringt.
 *   * `/de/images/` steht in KEINER Verbotsliste, auch nicht in der von `*`. Die aufgeloeste
 *     Adresse darf also jeder Abrufer holen, auch `AvesmapsWappenBot`.
 *
 * 💣 DIE TITEL-NORMALISIERUNG IST DIE FALLE, AN DER DAS GANZE HAENGT. MediaWiki schreibt einen
 * Titel um, BEVOR es ihn nachschlaegt (erster Buchstabe gross, `_` zu Leerzeichen), und die
 * Antwort traegt den NORMALISIERTEN Titel -- nicht den, den wir geschickt haben. Live gemessen:
 * `Datei:dere-globus icon 32px.png` kam als `Datei:Dere-globus icon 32px.png` zurueck. Wer die
 * Antwort ueber den eigenen Titel zuordnet, findet sie nicht und haelt die Datei fuer nicht
 * vorhanden. Das ist ein STILLER Verlust: er sieht aus wie "das Bild gibt es nicht im Wiki",
 * und niemand sucht danach. Die Zuordnung laeuft deshalb ueber `query.normalized`.
 *
 * ⚠️ WAS HIER NICHT PASSIERT: der gespeicherte Wert wird NICHT umgeschrieben. `coat_of_arms_url`
 * traegt weiter die Spezial-Adresse -- sie ist die Information „das Wiki nennt DIESE Datei", und
 * die bleibt richtig, auch wenn das Wiki das Bild morgen verschiebt. Aufgeloest wird beim Holen.
 */

require_once __DIR__ . '/sync.php';                 // avesmapsWikiSyncApiRequest, …NextTitleBatch, …TitleBatchSize
require_once __DIR__ . '/sync-monitor-licenses.php'; // avesmapsWikiSyncMonitorFileTitleFromCoatUrl
require_once __DIR__ . '/datei-riegel.php';          // avesmapsWikiDateiIstWikiHost



/** @internal Nur fuer den Test: das Gedaechtnis leeren. */
function avesmapsWikiDateiAufloesungZuruecksetzen(): void {
    avesmapsWikiDateiAufloesungMerken(null, null, true);
}

/**
 * Das Gedaechtnis: Spezial-Adresse -> echte Bildadresse ('' = im Wiki nicht vorhanden).
 *
 * 💣 AUCH DAS NEGATIVE ERGEBNIS WIRD BEHALTEN. Ein Aufloeser, der nur Treffer merkt, fragt die
 * immer gleichen toten Dateinamen bei jedem Bild erneut -- und genau diese Endlosschleife
 * (Fehlschlag, kein Vermerk, naechster Versuch) hat die Sperre vom 23.08.2026 am Leben gehalten.
 *
 * ⚠️ Es lebt im PROZESS. Das genuegt: die Sammellaeufe fragen ihren ganzen Stapel auf einmal
 * vor, und der Bildholer trifft danach nur noch das Gedaechtnis. Ueber Schrittgrenzen hinweg
 * etwas zu behalten hiesse, eine Tabelle anzulegen -- dafuer ist der Gewinn zu klein.
 *
 * 🪤 Und es gibt genau EINE statische Variable dafuer -- in `avesmapsWikiDateiAufloesungMerken`.
 * Der erste Entwurf hatte daneben noch ein `…Speicher()` mit einer eigenen: zwei Speicher, die
 * sich nie sehen, und der Lesepfad haette den Zwischenspeicher fuer leer gehalten, waehrend der
 * Schreibpfad ihn fuellt. Dieselbe Frage, zwei Antworten -- die Fehlerklasse, an der dieses
 * Projekt schon mehrfach haengengeblieben ist.
 */
/**
 * @internal Der EINE Schreibzugriff aufs Gedaechtnis -- eine statische Variable in einer
 * Funktion ist von aussen sonst nicht erreichbar, und zwei Speicher waeren zwei Wahrheiten.
 */
function avesmapsWikiDateiAufloesungMerken(?string $url, ?string $adresse, bool $leeren = false): array {
    static $speicher = [];

    if ($leeren) {
        $speicher = [];

        return $speicher;
    }
    if ($url !== null) {
        $speicher[$url] = (string) $adresse;
    }

    return $speicher;
}

/**
 * Loest eine Liste von Spezial-Adressen in einem Zug auf. Rueckgabe: Adresse -> echte Adresse,
 * '' wenn das Wiki die Datei nicht kennt.
 *
 * ⚠️ Adressen, die KEINE Spezialseite sind, kommen unveraendert zurueck -- eine bereits echte
 * Bildadresse, eine lokale Datei und ein fremder Wirt brauchen nichts.
 *
 * Die zwei letzten Parameter existieren NUR fuer den Test (dieselbe Bauform wie bei der
 * Drossel): die Produktion ruft mit einem Argument auf.
 *
 * @param list<string> $urls
 * @return array<string, string>
 */
function avesmapsWikiDateiAdressenAufloesen(
    array $urls,
    ?callable $abfrage = null,
    ?int $stapelgroesse = null
): array {
    $ergebnis = [];
    $offen = [];   // Titel -> Liste der Adressen, die ihn brauchen

    $speicher = avesmapsWikiDateiAufloesungMerken(null, null);

    foreach ($urls as $roh) {
        $url = trim((string) $roh);
        if ($url === '') {
            continue;
        }
        if (!avesmapsWikiDateiIstSpezialAdresse($url)) {
            $ergebnis[$url] = $url;
            continue;
        }
        if (array_key_exists($url, $speicher)) {
            $ergebnis[$url] = $speicher[$url];
            continue;
        }

        $titel = avesmapsWikiSyncMonitorFileTitleFromCoatUrl($url);
        if ($titel === '') {
            // Kein Dateiname herauszulesen -- das ist keine Frage ans Wiki wert.
            $ergebnis[$url] = '';
            avesmapsWikiDateiAufloesungMerken($url, '');
            continue;
        }
        $offen[$titel][] = $url;
    }

    if ($offen === []) {
        return $ergebnis;
    }

    $abfrage ??= static fn(array $params): array => avesmapsWikiSyncApiRequest($params);
    // ⚠️ Die Stueckzahl kommt von der Anmeldung (50 anonym, 500 als Bot); die LAENGE deckelt
    // darueber hinaus `avesmapsWikiSyncNextTitleBatch`. Beides zusammen, nie nur eines --
    // 500 Titel sprengen die URL (HTTP 414, am 25.08.2026 zweimal gefunden).
    $stapelgroesse ??= avesmapsWikiSyncTitleBatchSize();

    $titel = array_keys($offen);
    $offset = 0;
    while ($offset < count($titel)) {
        $stapel = avesmapsWikiSyncNextTitleBatch($titel, $offset, $stapelgroesse);
        if ($stapel === []) {
            break;
        }
        $offset += count($stapel);

        $antwort = $abfrage([
            'action' => 'query',
            'prop' => 'imageinfo',
            'iiprop' => 'url|mime',
            'titles' => implode('|', $stapel),
        ]);

        $adressen = avesmapsWikiDateiAntwortLesen(is_array($antwort) ? $antwort : [], $stapel);
        foreach ($stapel as $einTitel) {
            $adresse = $adressen[$einTitel] ?? '';
            foreach ($offen[$einTitel] ?? [] as $url) {
                $ergebnis[$url] = $adresse;
                avesmapsWikiDateiAufloesungMerken($url, $adresse);
            }
        }
    }

    return $ergebnis;
}

/**
 * Eine einzelne Adresse. Trifft nach einem Sammel-Vorlauf nur noch das Gedaechtnis.
 */
function avesmapsWikiDateiAdresseAufloesen(string $url, ?callable $abfrage = null): string {
    $karte = avesmapsWikiDateiAdressenAufloesen([$url], $abfrage);

    return (string) ($karte[trim($url)] ?? '');
}

/**
 * PUR: liest aus einer `prop=imageinfo`-Antwort die Zuordnung GESENDETER Titel -> Bildadresse.
 *
 * 💣 HIER SITZT DIE NORMALISIERUNG, und sie ist der Grund, warum diese Funktion existiert statt
 * einer Schleife oben. `query.normalized` sagt, unter welchem Namen das Wiki unseren Titel
 * nachgeschlagen hat; die Seiten tragen NUR den neuen Namen. Ohne die Rueckabbildung findet man
 * die eigene Anfrage in der Antwort nicht wieder und meldet „nicht vorhanden".
 *
 * ⚠️ Die Abbildung wird UMGEKEHRT angelegt (neu -> alt), weil die Antwort vom neuen Namen
 * ausgeht. Zwei verschiedene gesendete Titel koennen auf denselben normalisierten fallen --
 * deshalb eine LISTE je Zielname, nicht ein Wert.
 *
 * @param list<string> $gesendet
 * @return array<string, string>
 */
function avesmapsWikiDateiAntwortLesen(array $antwort, array $gesendet): array {
    $zurueck = [];
    foreach ((array) ($antwort['query']['normalized'] ?? []) as $eintrag) {
        if (!is_array($eintrag)) {
            continue;
        }
        $von = (string) ($eintrag['from'] ?? '');
        $nach = (string) ($eintrag['to'] ?? '');
        if ($von !== '' && $nach !== '') {
            $zurueck[$nach][] = $von;
        }
    }

    // Vorbelegen: was die Antwort nicht nennt, gilt als nicht vorhanden. 🔴 Nicht „unbekannt" --
    // ein Aufrufer, der zwischen „leer" und „fehlt" unterscheiden muesste, wuerde beim naechsten
    // Bild erneut fragen, und das ist die Wiederholung, die wir gerade abgeschafft haben.
    $ergebnis = array_fill_keys($gesendet, '');

    foreach ((array) ($antwort['query']['pages'] ?? []) as $seite) {
        if (!is_array($seite)) {
            continue;
        }
        $titel = (string) ($seite['title'] ?? '');
        if ($titel === '') {
            continue;
        }

        $adresse = '';
        $info = $seite['imageinfo'][0] ?? null;
        if (empty($seite['missing']) && is_array($info)) {
            $adresse = trim((string) ($info['url'] ?? ''));
        }

        // 💣 Auch die aufgeloeste Adresse muss auf unserem Wirt liegen. Ein `imagerepository`
        // wie `shared` zeigt auf ein FREMDES Wiki (Commons-Bauform), und das duerften wir dort
        // weder drosseln noch ungefragt abrufen.
        if ($adresse !== '' && !avesmapsWikiDateiIstWikiHost($adresse)) {
            $adresse = '';
        }

        // Der Titel selbst (falls unveraendert durchgereicht) …
        if (array_key_exists($titel, $ergebnis)) {
            $ergebnis[$titel] = $adresse;
        }
        // … und jeder gesendete Titel, den MediaWiki auf diesen normalisiert hat.
        foreach ($zurueck[$titel] ?? [] as $original) {
            if (array_key_exists($original, $ergebnis)) {
                $ergebnis[$original] = $adresse;
            }
        }
    }

    return $ergebnis;
}
