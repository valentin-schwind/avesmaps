<?php

declare(strict_types=1);

/**
 * Zaehlwerk fuer die EINGEHENDE API-Nutzung.
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
 * Bauplan: docs/superpowers/plans/2026-08-25-api-nutzung-stufe-1.md
 *
 * Diese Datei enthaelt die reinen Abbildungen (Schluessel, Zone, Klasse, Zeilenbau) und die
 * Datenbankwege. Verdrahtet wird sie in api/_internal/bootstrap.php -- dort merkt sich
 * avesmapsJsonResponse den Status, und eine Abschlussroutine schreibt die Zeilen.
 */

// 💣 DER PLATZHALTER IST TRAGEND, ER IST KEINE KOSMETIK.
//
// Die Tabelle hat einen UNIQUE-Schluessel ueber (day, hour, metric, dimension), und `hour` ist bei
// zwei von drei Metriken bedeutungslos. Waere die Spalte NULL-faehig, wuerde ON DUPLICATE KEY
// UPDATE dort NIE greifen: nach dem SQL-Standard gelten zwei NULL als VERSCHIEDEN, MySQL erlaubt
// im UNIQUE-Index beliebig viele davon. Jede Anfrage legte dann eine NEUE Zeile an statt eine
// vorhandene hochzuzaehlen -- und weil der Lesepfad ohnehin `SUM(count) GROUP BY dimension`
// rechnet, waeren die angezeigten Zahlen trotzdem richtig. Der Fehler waere unsichtbar und nur an
// der Zeilenzahl zu erkennen.
//
// Gegenprobe, gemessen am 25.08.2026: dreimal dasselbe mit hour=NULL ergibt 3 Zeilen, mit hour=24
// genau eine.
const AVESMAPS_API_METRICS_KEINE_STUNDE = 24;

/** Aufbewahrung. Aelteres wird faul beim Schreiben entfernt (es gibt keinen Zeitplan-Laeufer). */
const AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE = 400;

// ⚠️ NUR JEDER HUNDERTSTE REQUEST fragt nach dem Aufraeumen. Die Marke ist ein Upsert auf EINE Zeile,
// die alle Anfragen aller Besucher teilen -- gemessen 03.09.2026 zwei Schreibvorgaenge je Request,
// serialisiert an einer Zeilensperre. Das taegliche DELETE bleibt: die erste faellige Anfrage des
// Tages gewinnt die Marke wie bisher.
const AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT = 100;
// Der Puffer fuer Anfragen OHNE Datenbankverbindung. 256 KB fassen rund 3.000 Zeilen; darueber faellt
// der Puffer OFFEN aus (siehe avesmapsApiMetricsSpoolAnhaengen) und die Verbindung wird gezahlt wie
// frueher, statt den Puffer unbegrenzt wachsen zu lassen.
const AVESMAPS_API_METRICS_SPOOL_MAX_BYTES = 262144;
const AVESMAPS_API_METRICS_SPOOL_MAX_GRUPPEN = 400;

function avesmapsApiMetricsAufraeumenFaellig(int $wurf): bool {
    return $wurf === 1;
}

/**
 * 💣 Zur LAUFZEIT aus der Konfiguration, nicht als Konstante beim Einbinden.
 *
 * Das Besucher-Modul definiert AVESMAPS_VISITOR_ANALYTICS_ENABLED beim Einbinden per
 * `if (!defined(...))`, und der Einbindungsschritt steht in allen Endpunkten VOR
 * avesmapsLoadApiConfig(), das config.local.php erst zur Laufzeit laedt -- ein
 * `define(..., false)` dort kaeme also zu spaet. Dieser Schalter macht den Fehler nicht mit.
 *
 * Vorgabe „an": ein Betriebszaehler, der still aus ist, verfehlt seinen Zweck.
 */
function avesmapsApiMetricsAktiv(array $config): bool {
    $wert = $config['api_metrics']['enabled'] ?? true;
    return $wert !== false && $wert !== 0 && $wert !== '0';
}

/**
 * Aus SCRIPT_NAME, nie aus REQUEST_URI: `/api/app/map-features.php` -> `app/map-features`.
 *
 * 💣 REQUEST_URI traegt die Abfrageparameter mit. Das haette zwei Folgen, beide schlimm: eine neue
 * Zeile je Suchbegriff (die Tabelle wuechse mit dem Verkehr statt mit den Endpunkten), und
 * Suchbegriffe und Kennungen echter Besucher stuenden in einer Betriebstabelle.
 */
function avesmapsApiMetricsEndpunktSchluessel(string $scriptName): string {
    $pfad = strtok($scriptName, '?');
    if (!is_string($pfad) || $pfad === '') {
        return 'unbekannt';
    }
    $pfad = str_replace('\\', '/', $pfad);
    $stelle = strrpos($pfad, '/api/');
    if ($stelle === false) {
        return 'unbekannt';
    }
    $rest = substr($pfad, $stelle + 5);
    if (str_ends_with($rest, '.php')) {
        $rest = substr($rest, 0, -4);
    }
    $rest = trim($rest, '/');
    if ($rest === '' || !preg_match('/^[A-Za-z0-9_\/-]{1,180}$/', $rest)) {
        return 'unbekannt';
    }
    return $rest;
}

/**
 * Vier Zonen, und vier ist die Obergrenze: der Ring im Panel zeichnet sie als vier Segmente, und
 * vier Reihen ist die gerechnete Grenze der Projektpalette. Eine fuenfte Zone braucht erst eine
 * fuenfte Farbe.
 */
function avesmapsApiMetricsZone(string $schluessel): string {
    if (str_starts_with($schluessel, 'route/') || str_starts_with($schluessel, 'locations/')) {
        return 'offen';
    }
    if (str_starts_with($schluessel, 'app/')) {
        return 'app';
    }
    if (str_starts_with($schluessel, 'edit/')) {
        return 'edit';
    }
    return 'sonstige';
}

/**
 * 🔴 `$abgeschlossen` schlaegt den Statuscode. Ist die Anfrage nie durch avesmapsJsonResponse
 * gekommen, ist sie an einem Fatal Error, einem Speicherueberlauf oder einem Zeitlimit gestorben
 * -- und PHP meldet in diesem Zustand oft weiterhin 200. Der Code luegt dann; das Flag nicht.
 */
function avesmapsApiMetricsStatusKlasse(?int $status, bool $abgeschlossen): string {
    if (!$abgeschlossen) {
        return 'leer';
    }
    $hundert = (int) floor(((int) $status) / 100);
    return match ($hundert) {
        2 => '2xx',
        3 => '3xx',
        4 => '4xx',
        5 => '5xx',
        default => 'leer',
    };
}

/** Geschlossenes Vokabular -- alles andere wird eingesammelt, statt die Dimension aufzublaehen. */
function avesmapsApiMetricsFehlerCode(mixed $code): string {
    if (!is_string($code) || !preg_match('/^[a-z0-9_]{1,40}$/', $code)) {
        return 'sonstiger_code';
    }
    return $code;
}

/**
 * Baut die Zeilen einer Anfrage. Rein -- kein $_SERVER, keine Uhr, keine Datenbank; alles kommt
 * als Argument. Genau deshalb ist die ganze interessante Logik pruefbar, ohne eine Datenbank
 * anzufassen.
 *
 * @return list<array{metric: string, dimension: string, hour: int}>
 */
function avesmapsApiMetricsZeilenFuerAnfrage(
    string $scriptName,
    ?int $status,
    bool $abgeschlossen,
    ?string $fehlerCode,
    int $utcStunde
): array {
    $schluessel = avesmapsApiMetricsEndpunktSchluessel($scriptName);
    $klasse = avesmapsApiMetricsStatusKlasse($status, $abgeschlossen);
    $stunde = max(0, min(23, $utcStunde));

    $zeilen = [
        ['metric' => 'antwort', 'dimension' => $schluessel . '|' . $klasse, 'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE],
        ['metric' => 'stunde', 'dimension' => '', 'hour' => $stunde],
    ];

    if ($klasse === 'leer') {
        // Der Fatal Error hat keinen Fehlercode -- er ist ja nie beim Antworten angekommen.
        $zeilen[] = ['metric' => 'fehler', 'dimension' => $schluessel . '|fatal', 'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE];
    } elseif ($klasse === '4xx' || $klasse === '5xx') {
        $zeilen[] = [
            'metric' => 'fehler',
            'dimension' => $schluessel . '|' . avesmapsApiMetricsFehlerCode($fehlerCode),
            'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE,
        ];
    }

    return $zeilen;
}

function avesmapsApiMetricsEnsureTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS api_metric (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            day DATE NOT NULL,
            hour TINYINT UNSIGNED NOT NULL DEFAULT 24,
            metric VARCHAR(40) NOT NULL,
            dimension VARCHAR(190) NOT NULL DEFAULT '',
            count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uq_api_metric (day, hour, metric, dimension),
            KEY idx_api_metric_metric (metric, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * Schreibt alle Zeilen einer Anfrage in EINER Anweisung.
 *
 * 💣 EINE Rundreise, nicht drei. Der Zaehler laeuft am Ende der Anfrage, und auf diesem Server
 * wartet der Benutzer darauf: `fastcgi_finish_request` gibt es auf STRATO nicht (SAPI cgi-fcgi,
 * gemessen 24.08.2026), und frueh abschliessen traegt auch sonst nicht (3,07 s statt 0,2 s).
 *
 * ⚠️ `count = count + 1` und nicht `count + VALUES(count)`: jede eingefuegte Zeile traegt count=1,
 * also ist die einfache Form richtig -- und sie kommt ohne das in MySQL 8.0.20 abgekuendigte
 * VALUES() aus.
 *
 * 🔴 Das try/catch ist die Zusicherung, nicht die Bequemlichkeit: diese Funktion darf niemals
 * werfen. Sie laeuft am Ende JEDER Anfrage, auch einer bereits gescheiterten, und eine Ausnahme
 * aus ihr wuerde einen echten Fehler ueberschreiben oder eine gesunde Antwort zerstoeren.
 */
function avesmapsApiMetricsSchreiben(PDO $pdo, array $zeilen): void {
    if ($zeilen === []) {
        return;
    }
    try {
        $platzhalter = implode(', ', array_fill(0, count($zeilen), '(UTC_DATE(), ?, ?, ?, 1)'));
        $sql = 'INSERT INTO api_metric (day, hour, metric, dimension, count) VALUES '
            . $platzhalter
            . ' ON DUPLICATE KEY UPDATE count = count + 1';
        $werte = [];
        foreach ($zeilen as $zeile) {
            $werte[] = (int) $zeile['hour'];
            $werte[] = substr((string) $zeile['metric'], 0, 40);
            $werte[] = substr((string) $zeile['dimension'], 0, 190);
        }

        try {
            $anweisung = $pdo->prepare($sql);
            $anweisung->execute($werte);
        } catch (Throwable $vielleichtFehltDieTabelle) {
            // 💣 DIE TABELLE WIRD NACHGERUESTET, NICHT VORSORGLICH GEPRUEFT.
            //
            // Der naheliegende Bau waere ein `avesmapsApiMetricsEnsureTable()` vor jedem Schreiben
            // -- und damit ein `CREATE TABLE IF NOT EXISTS` bei JEDER Anfrage, auf dem kritischen
            // Pfad. Genau das fuehrt AGENTS.md §10 seit Monaten als Perf-Hotspot von
            // territories-endpoint.php auf („runs DDL + metadata probes on every request").
            // Es waere absurd, eine Tafel zu bauen, die solche Kosten sichtbar machen soll, und
            // dabei genau sie zu verursachen.
            //
            // Stattdessen: einmal scheitern lassen, anlegen, einmal wiederholen. Im Normalbetrieb
            // -- also ab der zweiten Anfrage nach dem Ausrollen -- kostet der Zaehler damit genau
            // eine Anweisung und kein DDL.
            avesmapsApiMetricsEnsureTable($pdo);
            $anweisung = $pdo->prepare($sql);
            $anweisung->execute($werte);
        }
    } catch (Throwable $fehler) {
        // Absicht: siehe oben. Dass der Zaehler stumm ist, wird im Panel an `letzte_zaehlung`
        // sichtbar -- nicht daran, dass hier etwas nach aussen dringt.
    }
}

/**
 * DER PUFFER: eine Anfrage ohne Datenbankverbindung zahlt keine.
 *
 * 💣 DER SCHNELLPFAD DER POLITISCHEN EBENE OEFFNETE TROTZDEM EINE -- und damit war die teuerste
 * Optimierung des Hauses zur Haelfte aufgehoben. `territories-endpoint.php` serviert einen frischen
 * Cache-Treffer ausdruecklich VOR dem PDO ("a FRESH political-layer cache hit needs no DB
 * connection") und `exit`et; die Abschlussroutine laeuft danach, fand
 * `avesmapsLetzteDatenbankverbindung() === null` und baute eine neue Verbindung auf -- nur um zu
 * zaehlen, dass keine gebraucht wurde. Gemessen 04.09.2026: 1.765 solcher Verbindungen an einem Tag,
 * 2.266 am Vortag -- rund die Haelfte aller Aufrufe des heissesten Endpunkts.
 *
 * ⚠️ Auf Shared Hosting sind Verbindungen ein Kontingent, kein Nulltarif: ist es ausgereizt, wartet
 * der Verbindungsaufbau, und der Worker haengt daran fest. Ausgerechnet die billigen Anfragen, die
 * einen Engpass ueberleben sollten, haengen so an der knappsten Ressource.
 *
 * 🔴 GEZAEHLT WIRD TROTZDEM ALLES -- nicht abgetastet, nicht geschaetzt. Der Grundsatz aus dem
 * Kommentar in bootstrap.php ("misst sich selbst, statt geschaetzt zu werden") bleibt gueltig; die
 * Zeilen wandern nur in eine Datei und werden von der naechsten Anfrage mitgeschrieben, die ohnehin
 * eine Verbindung hat.
 */
function avesmapsApiMetricsSpoolDatei(): string {
    return sys_get_temp_dir() . '/avesmaps-api-metrik.spool';
}

/**
 * @param list<array{metric: string, dimension: string, hour: int}> $zeilen
 * @return bool true = die Zeilen liegen im Puffer, der Aufrufer darf OHNE Verbindung enden.
 */
function avesmapsApiMetricsSpoolAnhaengen(array $zeilen, string $tag): bool {
    if ($zeilen === []) {
        return true;
    }
    $datei = avesmapsApiMetricsSpoolDatei();
    clearstatcache(true, $datei);
    // 💣 DECKEL. Kaeme nie wieder eine Anfrage mit Verbindung, wuechse der Puffer sonst unbegrenzt.
    // Darueber meldet er `false`, der Aufrufer zahlt die Verbindung -- und leert dabei den Puffer.
    if (is_file($datei) && (int) @filesize($datei) > AVESMAPS_API_METRICS_SPOOL_MAX_BYTES) {
        return false;
    }
    $text = '';
    foreach ($zeilen as $zeile) {
        $satz = json_encode([
            't' => $tag,
            'h' => (int) $zeile['hour'],
            'm' => substr((string) $zeile['metric'], 0, 40),
            'd' => substr((string) $zeile['dimension'], 0, 190),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($satz)) {
            return false;
        }
        $text .= $satz . "\n";
    }
    // LOCK_EX, damit zwei gleichzeitige Anfragen sich keine Zeile zerschneiden.
    return @file_put_contents($datei, $text, FILE_APPEND | LOCK_EX) !== false;
}

/**
 * Fasst Pufferzeilen zu (Tag, Stunde, Metrik, Dimension) mit Anzahl zusammen. Rein -- kein
 * Dateisystem, keine Datenbank, damit die Regel ohne beides pruefbar ist.
 *
 * @return list<array{tag: string, hour: int, metric: string, dimension: string, anzahl: int}>
 */
function avesmapsApiMetricsSpoolGruppieren(string $inhalt): array {
    $gruppen = [];
    foreach (explode("\n", $inhalt) as $zeile) {
        if (trim($zeile) === '') {
            continue;
        }
        $satz = json_decode($zeile, true);
        // ⚠️ Eine halbe Zeile (abgebrochener Schreibvorgang, volle Platte) wird uebersprungen, nie
        // geraten -- ein kaputter Satz darf den ganzen Puffer nicht verwerfen.
        if (!is_array($satz) || !isset($satz['t'], $satz['h'], $satz['m'], $satz['d'])) {
            continue;
        }
        $tag = (string) $satz['t'];
        $stunde = (int) $satz['h'];
        $metrik = (string) $satz['m'];
        $dimension = (string) $satz['d'];
        $schluessel = $tag . "\0" . $stunde . "\0" . $metrik . "\0" . $dimension;
        if (!isset($gruppen[$schluessel])) {
            $gruppen[$schluessel] = [
                'tag' => $tag,
                'hour' => $stunde,
                'metric' => $metrik,
                'dimension' => $dimension,
                'anzahl' => 0,
            ];
        }
        $gruppen[$schluessel]['anzahl']++;
    }
    return array_values($gruppen);
}

/**
 * Schreibt gepufferte Gruppen.
 *
 * 🔴 DER TAG KOMMT AUS DEM PUFFER, nicht aus `UTC_DATE()`: eine um 23:59 gepufferte Zeile, die um
 * 00:01 geleert wird, gehoert in den Vortag. Genau dafuer traegt jeder Satz sein Datum mit.
 *
 * @param list<array{tag: string, hour: int, metric: string, dimension: string, anzahl: int}> $gruppen
 */
function avesmapsApiMetricsSpoolSchreiben(PDO $pdo, array $gruppen): void {
    if ($gruppen === []) {
        return;
    }
    try {
        $platzhalter = implode(', ', array_fill(0, count($gruppen), '(?, ?, ?, ?, ?)'));
        // `VALUES(count)` statt `count + 1`: eine Gruppe traegt ihre Anzahl mit.
        $sql = 'INSERT INTO api_metric (day, hour, metric, dimension, count) VALUES '
            . $platzhalter
            . ' ON DUPLICATE KEY UPDATE count = count + VALUES(count)';
        $werte = [];
        foreach ($gruppen as $gruppe) {
            $werte[] = (string) $gruppe['tag'];
            $werte[] = (int) $gruppe['hour'];
            $werte[] = substr((string) $gruppe['metric'], 0, 40);
            $werte[] = substr((string) $gruppe['dimension'], 0, 190);
            $werte[] = max(1, (int) $gruppe['anzahl']);
        }
        try {
            $pdo->prepare($sql)->execute($werte);
        } catch (Throwable $vielleichtFehltDieTabelle) {
            // Dieselbe Regel wie beim gewoehnlichen Schreiben: einmal scheitern lassen, anlegen,
            // einmal wiederholen -- statt bei jeder Anfrage ein DDL zu zahlen.
            avesmapsApiMetricsEnsureTable($pdo);
            $pdo->prepare($sql)->execute($werte);
        }
    } catch (Throwable $fehler) {
        // Absicht: der Zaehler traegt nichts nach aussen.
    }
}

/**
 * Leert den Puffer. Gerufen von jeder Anfrage, die ohnehin eine Verbindung hat.
 *
 * 💣 GEHOLT WIRD PER `rename`, nicht per Lesen-und-Loeschen: nur EIN Prozess gewinnt die Datei, alle
 * anderen bekommen `false` und tun nichts. Ohne das schrieben zwei gleichzeitige Anfragen denselben
 * Puffer zweimal in die Tabelle.
 *
 * @return int Zahl der geschriebenen Gruppen (0 = nichts zu tun)
 */
function avesmapsApiMetricsSpoolLeeren(PDO $pdo): int {
    $datei = avesmapsApiMetricsSpoolDatei();
    clearstatcache(true, $datei);
    if (!is_file($datei)) {
        return 0;
    }
    $uebergabe = $datei . '.' . getmypid() . '.' . bin2hex(random_bytes(4));
    if (!@rename($datei, $uebergabe)) {
        return 0;
    }
    $inhalt = @file_get_contents($uebergabe);
    @unlink($uebergabe);
    if (!is_string($inhalt) || $inhalt === '') {
        return 0;
    }
    $gruppen = avesmapsApiMetricsSpoolGruppieren($inhalt);
    if (count($gruppen) > AVESMAPS_API_METRICS_SPOOL_MAX_GRUPPEN) {
        $gruppen = array_slice($gruppen, 0, AVESMAPS_API_METRICS_SPOOL_MAX_GRUPPEN);
    }
    avesmapsApiMetricsSpoolSchreiben($pdo, $gruppen);
    return count($gruppen);
}

/**
 * Faules Aufraeumen: es gibt keinen Zeitplan-Laeufer auf STRATO.
 *
 * ⚠️ Hoechstens einmal am Tag, erkannt an einer Markerzeile in derselben Tabelle -- sonst zahlte
 * jede Anfrage ein DELETE. Die Markerzeile ist eine gewoehnliche Metrikzeile und faellt beim Lesen
 * durch den Metrikfilter heraus.
 *
 * 💣 MySQL meldet bei INSERT ... ON DUPLICATE KEY UPDATE `rowCount() === 1` fuer „neu eingefuegt"
 * und `2` fuer „hochgezaehlt". Nur beim ersten Mal am Tag wird also geraeumt.
 */
function avesmapsApiMetricsAufraeumen(PDO $pdo): void {
    if (!avesmapsApiMetricsAufraeumenFaellig(random_int(1, AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT))) {
        return;
    }
    try {
        $marke = $pdo->prepare(
            "INSERT INTO api_metric (day, hour, metric, dimension, count)
             VALUES (UTC_DATE(), ?, 'aufraeumen', '', 1)
             ON DUPLICATE KEY UPDATE count = count + 1"
        );
        $marke->execute([AVESMAPS_API_METRICS_KEINE_STUNDE]);
        if ($marke->rowCount() !== 1) {
            return;
        }
        $pdo->exec(
            'DELETE FROM api_metric WHERE day < UTC_DATE() - INTERVAL '
            . AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE . ' DAY'
        );
    } catch (Throwable $fehler) {
        // Absicht: dieselbe Regel wie beim Schreiben.
    }
}

function avesmapsApiMetricsTageGrenze(mixed $tage): int {
    $zahl = is_numeric($tage) ? (int) $tage : 1;
    return max(1, min(AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE, $zahl));
}

/**
 * Formt die rohen `antwort`-Zeilen (`<endpunkt>|<klasse>`) zu den drei Karten.
 *
 * 🔴 Die Zone wird hier ABGELEITET und nicht gespeichert: zwei Speicherorte fuer dieselbe Aussage
 * laufen auseinander, sobald jemand die Zonenregel aendert und die Altdaten stehen laesst.
 *
 * 💣 Geschnitten wird am LETZTEN Trennstrich (strrpos). Ein Endpunktschluessel darf zwar keinen
 * tragen, aber am ersten zu schneiden hiesse, dass ein einziger Sonderfall die Klasse verlöre --
 * und der faellt nicht auf, weil die Summen weiterhin stimmen.
 */
function avesmapsApiMetricsAufteilen(array $zeilen): array {
    $endpunkte = [];
    $klassen = [];
    $zonen = [];

    foreach ($zeilen as $zeile) {
        $dimension = (string) ($zeile['dimension'] ?? '');
        $anzahl = (int) ($zeile['c'] ?? 0);
        $trenner = strrpos($dimension, '|');
        if ($trenner === false || $trenner === 0) {
            continue;
        }
        $schluessel = substr($dimension, 0, $trenner);
        $klasse = substr($dimension, $trenner + 1);

        $endpunkte[$schluessel] = ($endpunkte[$schluessel] ?? 0) + $anzahl;
        $klassen[$klasse] = ($klassen[$klasse] ?? 0) + $anzahl;
        $zone = avesmapsApiMetricsZone($schluessel);
        $zonen[$zone] = ($zonen[$zone] ?? 0) + $anzahl;
    }

    $alsListe = static function (array $karte): array {
        arsort($karte);
        $liste = [];
        foreach ($karte as $dimension => $anzahl) {
            $liste[] = ['dimension' => (string) $dimension, 'c' => $anzahl];
        }
        return $liste;
    };

    return [
        'endpunkte' => $alsListe($endpunkte),
        'klassen' => $alsListe($klassen),
        'zonen' => $alsListe($zonen),
    ];
}

/**
 * ⚠️ JEDE Abfrage bekommt ihren EIGENEN catch. Ein gemeinsamer riss beim Besucher-Modul zwei
 * gesunde Abfragen mit, weil eine dritte einen MySQL-Fehler 1247 warf -- die Karte stand leer da,
 * obwohl die Daten stimmten.
 *
 * 💣 Und deshalb steht in keiner dieser Abfragen ein Aggregat-ALIAS in HAVING oder ORDER BY: genau
 * das ist Fehler 1247. Wo sortiert wird, steht der rohe SUM()-Ausdruck noch einmal.
 */
function avesmapsApiMetricsLesen(PDO $pdo, int $tage): array {
    $tage = avesmapsApiMetricsTageGrenze($tage);
    $keineStunde = AVESMAPS_API_METRICS_KEINE_STUNDE;

    $holen = static function (string $sql, array $werte) use ($pdo): array {
        try {
            $anweisung = $pdo->prepare($sql);
            $anweisung->execute($werte);
            return $anweisung->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $fehler) {
            return [];
        }
    };

    $antwortZeilen = $holen(
        "SELECT dimension, SUM(count) AS c FROM api_metric
         WHERE metric = 'antwort' AND day >= UTC_DATE() - INTERVAL ? DAY
         GROUP BY dimension
         ORDER BY SUM(count) DESC
         LIMIT 400",
        [$tage]
    );

    $fehlerZeilen = $holen(
        "SELECT dimension, SUM(count) AS c FROM api_metric
         WHERE metric = 'fehler' AND day >= UTC_DATE() - INTERVAL ? DAY
         GROUP BY dimension
         ORDER BY SUM(count) DESC
         LIMIT 20",
        [$tage]
    );

    // 💣 DIE SPALTE HEISST `hour` UND DARF NICHT UMBENANNT WERDEN. Der vorhandene Zeichner
    // vaHeatmapGrid (js/review/review-visitor-analytics.js) liest `r.dow`, `r.hour` und `r.c`.
    // Ein Alias `hour AS h` waere kein Schoenheitsfehler: `Number(undefined) || 0` ergibt 0, alle
    // Zellen landeten in Stunde 0, und die Karte zeigte einen soliden Streifen, der auf den ersten
    // Blick wie ein Befund aussieht statt wie ein Fehler.
    $stundenZeilen = $holen(
        "SELECT DAYOFWEEK(day) AS dow, hour, SUM(count) AS c FROM api_metric
         WHERE metric = 'stunde' AND hour < ? AND day >= UTC_DATE() - INTERVAL ? DAY
         GROUP BY DAYOFWEEK(day), hour",
        [$keineStunde, $tage]
    );

    // 🪤 Der Beleg dafuer, dass ueberhaupt noch gezaehlt wird. Entzieht STRATO bei voller Quote die
    // Schreibrechte, verschluckt der Schreiber den Fehler pflichtgemaess -- und leere Balken sind
    // von „keine Anfragen" nicht zu unterscheiden. Das Panel sagt es deshalb ausdruecklich.
    $letzte = $holen("SELECT MAX(day) AS tag FROM api_metric WHERE metric = 'antwort'", []);

    $aufgeteilt = avesmapsApiMetricsAufteilen($antwortZeilen);
    $aufgeteilt['fehler'] = $fehlerZeilen;
    $aufgeteilt['stunden'] = $stundenZeilen;
    $aufgeteilt['letzte_zaehlung'] = $letzte[0]['tag'] ?? null;

    return $aufgeteilt;
}

/** Groesse der eigenen Tabelle, fuer die Karte „Die Tafel selbst". */
function avesmapsApiMetricsSpeicher(PDO $pdo): array {
    try {
        // ⚠️ `rows` ist in MySQL 8 ein reserviertes Wort und MUSS in Graviszeichen stehen -- ohne
        // sie wirft die Abfrage einen Syntaxfehler und reisst den ganzen Lesevorgang mit. Genau so
        // ist es dem Besucher-Modul einmal ergangen.
        $zeilen = $pdo->query(
            "SELECT table_name AS t, table_rows AS `rows`, data_length + index_length AS bytes
             FROM information_schema.TABLES
             WHERE table_schema = DATABASE() AND table_name = 'api_metric'"
        )->fetchAll(PDO::FETCH_ASSOC);
        return ['tables' => $zeilen];
    } catch (Throwable $fehler) {
        return ['tables' => []];
    }
}
