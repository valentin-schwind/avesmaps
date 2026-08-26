<?php

declare(strict_types=1);

// Die Tempowerte, wie sie in der Kartennutzlast mitreisen -- ausgelagert aus api/app/map-features.php,
// weil jene Datei ein Endpunkt ist und sich fuer einen Test nicht einbinden laesst.
//
// PURITY CONTRACT: seiteneffektfrei beim Einbinden.

/**
 * Die Tempowerte fuer den Planer — die drei Reisetage, die Tempotabelle und ihr Stempel.
 *
 * 🔴 EINE QUELLE, ZWEI LESER. Der Router liest sie ueber avesmapsTravelValuesRead(); der Browser
 * bekommt sie hierdurch. Ohne diese Leitung waeren `#travelHoursPerDay` und `SPEED_TABLE` zweite
 * Wahrheiten -- und zwar solche, die genau dann falsch werden, wenn jemand die Werte im Fenster
 * „Tempowerte" verstellt. Die Reisetage reisen seit dem 16.08.2026 mit, die Tempotabelle seit dem
 * 26.08.2026; bis dahin zeigte der Reiseplan rund 2 % kuerzere Zeiten als der Router gerechnet hat.
 *
 * 💣 DER STEMPEL IST KEIN BEIWERK. Der ETag dieser Nutzlast haengt an `map_revision`, und die
 * Tempowerte aendern kein Kartenobjekt -- ein warmer Client bekaeme also sein 304 und behielte die
 * ALTEN Werte, unbegrenzt lange. Genau diese Falle hat die Klimaebene schon einmal bezahlt
 * (avesmapsClimateReadStamp). Der Stempel ist ein Hash ueber das, was wirklich mitreist: aendert
 * sich eine Zahl, aendert sich der ETag.
 *
 * ⚠️ Fail-open wie der Bild-Notaus in der Nutzlast: faellt der Lesevorgang aus, kommen die Konstanten
 * zurueck, und der Planer verhaelt sich wie vor der Einstellbarkeit. Eine fehlende Einstellung darf
 * die Kartennutzlast nicht mitreissen. Der Stempel ist dann leer -- er darf nicht raten.
 */
function avesmapsMapFeaturesTravelValues(?PDO $pdo): array {
    try {
        require_once __DIR__ . '/../routing/travel-values.php';
        $values = avesmapsTravelValuesRead($pdo);
        $hours = is_array($values['travel_hours'] ?? null)
            ? $values['travel_hours']
            : avesmapsTravelValuesHoursFallback();
        // ⚠️ Das GELTENDE Raster, nicht das gespeicherte: avesmapsTravelValuesRead legt Zelle fuer
        // Zelle ueber die Konstante, ein Reisemittel ohne gespeicherten Wert behaelt also seinen.
        $speeds = is_array($values['grid'] ?? null) ? $values['grid'] : [];

        return [
            'hours' => $hours,
            'speeds' => $speeds,
            'stamp' => substr(hash('sha1', (string) json_encode(['h' => $hours, 's' => $speeds])), 0, 12),
        ];
    } catch (Throwable) {
        return [
            'hours' => ['land' => 8.0, 'water' => 12.0, 'night' => 24.0],
            // ⚠️ LEER, nicht die Konstante: was hier nicht gelesen wurde, wird auch nicht behauptet.
            // Der Browser behaelt dann seine eigene Tabelle -- dieselbe Ausfallart wie bisher.
            'speeds' => [],
            'stamp' => '',
        ];
    }
}
