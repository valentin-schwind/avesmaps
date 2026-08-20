<?php

declare(strict_types=1);

/**
 * „Liegt dieser Wiki-Titel auf der Karte?" — EINE Rechnung fuer alle Leser.
 * ===========================================================================
 * 💣 Sie hat ZWEI Haelften, und die zweite ist tragend: neben den Namen der
 * Kartenobjekte zaehlt der Titel jedes ZUGEWIESENEN wiki_settlement-Nests. Ohne
 * ihn gilt eine Seite als „nicht auf der Karte", sobald der Kartenname vom
 * Wiki-Titel abweicht („Ochsenblut" auf der Karte, „Baronie Ochsenblut" im Wiki)
 * — und ein Leser boete dann an, zu etwas zu fliegen, das laengst dasteht.
 *
 * Herausgezogen aus avesmapsWikiSettlementListRegistry (settlements.php), damit
 * die Ortsliste des Editors und die Kartensuche nicht auseinanderlaufen koennen.
 * Dieselbe Lehre wie bei den verwaisten Aussenhuellen (AGENTS.md §11): eine
 * eigene, strengere Rechnung meldet gepflegte Objekte als fehlend.
 *
 * PURE: kein PDO, keine Globals, kein DDL. Der Aufrufer bringt die map_features-
 * Zeilen mit, die er ohnehin geladen hat — die Kartensuche ist der heisseste
 * oeffentliche Pfad der Seite und vertraegt keine zweite Abfrage (AGENTS.md §9).
 */

require_once __DIR__ . '/sync.php';

/**
 * Index der Titel, die auf der Karte vertreten sind.
 *
 * @param list<array<string, mixed>> $rows map_features-Zeilen (name + properties_json)
 * @return array<string, bool> Match-Key => true
 */
function avesmapsBuildMapPresenceIndex(array $rows): array
{
    $index = [];
    foreach ($rows as $row) {
        $name = (string) ($row['name'] ?? '');

        // 💣 Kreuzungen zaehlen NICHT. Sie tragen keinen Wiki-Artikel, und die
        // Ortsliste des Editors wirft sie an genau dieser Stelle heraus, BEVOR sie
        // den Index fuellt (settlements.php). Faellt der Filter hier weg, tragen
        // die zwei Leser verschiedene Indizes -- und die Extraktion haette die
        // Divergenz eingebaut, die sie verhindern soll.
        // ⚠️ Der Name-Praefix ist die zweite Haelfte der Erkennung: die Namen
        // entstehen erst im Browser als laufender Zaehler (AGENTS.md §11), es gibt
        // also Zeilen mit dem Praefix, die den Subtyp nicht tragen.
        if ((string) ($row['feature_subtype'] ?? '') === 'kreuzung' || str_starts_with($name, 'Kreuzung')) {
            continue;
        }

        if ($name !== '') {
            $key = avesmapsWikiSyncCreateMatchKey($name);
            if ($key !== '') {
                $index[$key] = true;
            }
        }

        // properties_json kommt je nach Lesepfad als JSON-String oder bereits
        // dekodiert. Beides zaehlt; kaputtes JSON kostet nur das Nest, nie die Zeile.
        $properties = $row['properties_json'] ?? null;
        if (is_string($properties)) {
            $properties = json_decode($properties, true);
        }
        $settlement = is_array($properties) ? ($properties['wiki_settlement'] ?? null) : null;
        $title = is_array($settlement) ? (string) ($settlement['title'] ?? '') : '';
        if ($title !== '') {
            $titleKey = avesmapsWikiSyncCreateMatchKey($title);
            if ($titleKey !== '') {
                $index[$titleKey] = true;
            }
        }
    }

    return $index;
}

/**
 * @param array<string, bool> $index aus avesmapsBuildMapPresenceIndex
 */
function avesmapsIsTitleOnMap(string $title, array $index): bool
{
    $key = avesmapsWikiSyncCreateMatchKey($title);

    return $key !== '' && isset($index[$key]);
}
