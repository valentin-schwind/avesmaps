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
