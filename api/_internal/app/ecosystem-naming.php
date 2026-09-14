<?php

declare(strict_types=1);

// Landschaften -- die BENENNUNG einer Region, serverseitig. Zwilling zu
// js/map-features/map-features-ecosystem-naming.js.
//
// 🔴 WARUM EINE EIGENE DATEI (14.09.2026). Zwei Lesepfade brauchen dieselben Antworten: ecosystem.php
// (Editor, Flaechen-Tooltip) und die Kartensuche (api/app/map-search.php, jeder Tastendruck). Die Suche
// darf ecosystem.php nicht laden -- ueber 6.000 Zeilen samt acht Nebendateien fuer drei kleine Regeln --,
// und eine Abschrift waere die zweite Wahrheit. Also wohnen die Regeln hier, und beide laden sie.
//
// Rein: keine Datenbank, kein DDL, nichts laeuft beim Einbinden.

// Der Griff einer Region OHNE Art -- „Fläche-100". 💣 Steht zweimal im Haus: hier und als
// ECOSYSTEM_AUTO_NAME_FALLBACK im Browser. js/map-features/__tests__/landschaft-autonamen-zwilling.test.js
// und api/_internal/app/__tests__/landscape-search-test.php halten beide gegeneinander.
const AVESMAPS_ECOSYSTEM_AUTO_NAME_FALLBACK = 'Fläche';

/**
 * REIN: der gespeicherte Haken „Auto-Name" dieser Regionszeile. DREI Zustaende.
 *
 * 🔴 `null` heisst „nie angefasst" -- dann entscheidet im Browser der NAME (Altbestand und frisch
 * gezeichnete Flaechen). `true`/`false` sind ausdrueckliche Entscheidungen und schlagen den Namen.
 *
 * ⚠️ Deshalb wird hier auch `false` GESPEICHERT, statt den Schluessel zu entfernen: „entschieden:
 * nein" und „nie entschieden" sind hier NICHT bedeutungsgleich. Eine Region, die „Wald-001" heisst
 * und deren Haken jemand bewusst entfernt hat, kaeme sonst beim naechsten Oeffnen wieder angehakt
 * zurueck.
 * 🪤 Der Gegenpol dieser Regel war der Nachbar `wiki_no_article`, wo beide Faelle dasselbe hiessen
 * und `false` deshalb geloescht wurde. Er ist am 09.09.2026 global ausgebaut (Owner-Entscheid) --
 * die Regel HIER ist davon unberuehrt, nur ihr Gegenbeispiel steht nicht mehr daneben.
 *
 * ⚠️ Umgezogen am 14.09.2026 aus ecosystem.php, unveraendert -- siehe den Kopf dieser Datei.
 */
function avesmapsEcosystemRegionAutoName(mixed $propertiesJson): ?bool
{
    $properties = json_decode((string) ($propertiesJson ?? ''), true);
    if (!is_array($properties) || !array_key_exists('auto_name', $properties)) {
        return null;
    }

    return (bool) $properties['auto_name'];
}

/**
 * REIN: die lesbare Artbezeichnung einer Region -- „Wald" statt des Schluessels `wald`.
 *
 * 🔴 Keine Art ist ein gueltiger Zustand („— keine Vegetation —"), und dann gibt es auch keine
 * Bezeichnung. Eine Art OHNE Katalogzeile faellt auf ihren eigenen Schluessel zurueck: der rohe
 * Schluessel ist schlechter als gar nichts, aber nichts zu zeigen, wo eine Art existiert, verbirgt Daten.
 *
 * ⚠️ Der Katalog ist je EBENE geschluesselt (`<kind>|<type_key>`), weil ein type_key nur je Ebene
 * eindeutig ist (PRIMARY KEY (kind, type_key)).
 *
 * Herausgeloest am 14.09.2026 aus avesmapsEcosystemDecorateAreaRows (Flaechen-Tooltip), damit die
 * Suchzeile einer Landschaft dieselbe Art nennt wie ihr Tooltip.
 *
 * @param array<string, string> $typeLabels "<kind>|<type_key>" => Bezeichnung
 */
function avesmapsEcosystemRegionTypeLabel(array $typeLabels, string $kind, mixed $typeKey): string
{
    $typeKey = trim((string) ($typeKey ?? ''));
    if ($typeKey === '') {
        return '';
    }

    return (string) ($typeLabels[$kind . '|' . $typeKey] ?? $typeKey);
}
