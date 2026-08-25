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
require __DIR__ . '/../_internal/analytics/api-metrics.php';

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
