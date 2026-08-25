<?php

declare(strict_types=1);

/**
 * Liest die eingehende API-Nutzung fuer die Tafel im Editor-Reiter „Status".
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md §5
 *
 * ⚠️ Gebaut nach dem Muster von api/app/visitor-metrics.php -- samt der Fehler, die dort gemacht
 * wurden: Helfer bekommen ihre Argumente, jede Abfrage im Leser hat ihren eigenen catch, und es
 * geht kein getMessage() nach draussen.
 */

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';

// 🪤 HIER STEHT ABSICHTLICH KEIN `require` DER ZAEHLBIBLIOTHEK -- bootstrap.php laedt sie bereits
// (sie traegt den Zaehler, der an JEDER Anfrage haengt).
//
// Der erste Bau schrieb hier `require __DIR__ . '/../_internal/analytics/api-metrics.php';`, wie
// es die Nachbarendpunkte mit visitor-analytics.php tun. Das ist dort richtig und hier toedlich:
// 💣 `require_once` in bootstrap.php schuetzt NICHT gegen ein spaeteres blankes `require` derselben
// Datei -- die Einmal-Liste gilt nur fuer require_once selbst. Die Folge war „Cannot redeclare
// function avesmapsApiMetricsAktiv()", also ein Fatal Error VOR jeder Ausgabe: HTTP 500 mit
// LEEREM Rumpf. Live gemessen am 25.08.2026, und ausgerechnet genau die Fehlerklasse, fuer die
// diese Tafel gebaut wurde.
// ⚠️ `php -l` findet das nicht -- eine Redeklaration ist ein Laufzeitfehler, keine Syntaxfrage.
// Der Endpunkt wird deshalb im Test AUSGEFUEHRT, nicht nur gelesen.

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden', 'Origin not allowed.');
    }

    // 🔴 Derselbe Riegel wie bei den Besucherzahlen: Betriebsdaten gehen niemanden sonst an.
    avesmapsRequireUserWithCapability('edit');

    if (!avesmapsApiMetricsAktiv($config)) {
        // Abgeschaltet wird GEMELDET, nicht verschwiegen -- sonst ist „aus" von „kaputt" nicht zu
        // unterscheiden, und jemand sucht den Fehler im Code.
        avesmapsJsonResponse(200, ['ok' => true, 'enabled' => false]);
    }

    $tage = avesmapsApiMetricsTageGrenze($_GET['days'] ?? 7);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsApiMetricsEnsureTable($pdo);

    $gelesen = avesmapsApiMetricsLesen($pdo, $tage);
    $letzteZaehlung = $gelesen['letzte_zaehlung'] ?? null;
    unset($gelesen['letzte_zaehlung']);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'enabled' => true,
        'days' => $tage,
        // 🪤 Der Beleg, dass ueberhaupt gezaehlt wird. Ohne ihn ist „der Zaehler schreibt nicht
        // mehr" von „es kamen keine Anfragen" nicht zu unterscheiden -- und der Zaehler schweigt
        // pflichtgemaess, wenn STRATO bei voller Quote die Schreibrechte entzieht.
        'letzte_zaehlung' => $letzteZaehlung,
        'metrics' => $gelesen,
        'storage' => avesmapsApiMetricsSpeicher($pdo),
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'API statistics could not be loaded.');
}
