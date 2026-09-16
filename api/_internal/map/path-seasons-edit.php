<?php

declare(strict_types=1);

function avesmapsPathSeasonWikiKey(array $feature): string {
    $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);

    return trim((string) ($properties['wiki_path']['wiki_key'] ?? ''));
}

// Außerhalb der Transaktion lesen: kein alter InnoDB-Lesesnapshot vor einer wartenden Zeilensperre.
function avesmapsReadPathSeasonEditCandidates(PDO $pdo, string $publicId): array {
    $read = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :public_id AND is_active = 1');
    $read->execute(['public_id' => $publicId]);
    $initial = $read->fetch(PDO::FETCH_ASSOC);
    if (!$initial) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }
    $wikiKey = avesmapsPathSeasonWikiKey($initial);
    $condition = 'public_id = :public_id';
    $parameters = ['public_id' => $publicId];
    if ($wikiKey !== '') {
        $condition .= " OR (feature_type = 'path' AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.wiki_path.wiki_key')) = :wiki_key)";
        $parameters['wiki_key'] = $wikiKey;
    }
    $read = $pdo->prepare('SELECT id FROM map_features WHERE is_active = 1 AND (' . $condition . ') ORDER BY id ASC LIMIT '
        . (AVESMAPS_PATH_GROUP_MAX_SEGMENTS + 1));
    $read->execute($parameters);
    $ids = $read->fetchAll(PDO::FETCH_COLUMN);
    if (count($ids) > AVESMAPS_PATH_GROUP_MAX_SEGMENTS) {
        throw new InvalidArgumentException('Dieser Wiki-Weg umfasst mehr als 250 Abschnitte. Abschnittsdetails und Saisonfenster wurden nicht gespeichert, weil sie nur gemeinsam sicher geändert werden können.');
    }

    return ['ids' => $ids, 'wiki_key' => $wikiKey];
}

function avesmapsFetchPathSeasonEditFeatures(PDO $pdo, string $publicId, array $candidates): array {
    $own = null;
    $siblings = [];
    // Einzelne Primärschlüssel sperren: der Wiki-JSON-Scan darf keine unbeteiligten Kartenzeilen sperren.
    foreach ($candidates['ids'] as $id) {
        $feature = avesmapsFetchFeatureByIdForUpdate($pdo, (int) $id);
        if ((int) $feature['is_active'] !== 1 || $feature['feature_type'] !== 'path'
            || avesmapsPathSeasonWikiKey($feature) !== $candidates['wiki_key']) {
            throw new AvesmapsConflictException('Die Wiki-Zuordnung der Abschnitte wurde inzwischen geändert. Bitte neu laden.');
        }
        if ($feature['public_id'] === $publicId) {
            $own = $feature;
        } else {
            $siblings[] = $feature;
        }
    }
    if ($own === null || $own['geometry_type'] !== 'LineString') {
        throw new AvesmapsConflictException('Der Ausgangsabschnitt wurde inzwischen geändert. Bitte neu laden.');
    }

    return ['feature' => $own, 'siblings' => $siblings];
}

/**
 * Traegt die Zeitfenster eines Weges auf ALLE Segmente seines Wiki-Weges.
 *
 * 💣 EIN PASS IST BEI UNS EINE KETTE, KEINE STRECKE. Gemessen am Bestand (2026-08-03): Schattenpass
 * 12 Segmente, Kabashpforte 11, Raschtulsweg 9, Roterzpass 4 -- und die Segmente eines Passes tragen
 * verschiedene Wegarten (Zufahrt als Strasse, das Passstueck als Gebirgspass). Wer das Fenster nur
 * an das eine Segment schreibt, das er gerade offen hat, laesst elf Loecher, durch die der Router
 * faehrt. Der Wiki-Weg ist dabei der belastbare Schluessel: alle Passsegmente tragen einen, aber
 * 113 der 187 haben nur einen Auto-Namen (`Gebirgspass-42`).
 *
 * ⭐ Das Fenster wird je Segment gegen dessen EIGENE `allowed_transports` gefiltert. Ein
 * Strassenstueck laesst die Kutsche zu, das Passstueck daneben nicht -- ein stumpf kopiertes
 * Kutschenfenster waere dort tote Angabe, die an dem Tag aufwacht, an dem jemand den Haken setzt.
 *
 * @return array Vorher/Nachher der tatsächlich geänderten, bereits gesperrten Geschwister
 */
function avesmapsApplyTransportSeasonsToWikiSiblings(
    PDO $pdo,
    array $siblings,
    array $seasons,
    int $revision,
    int $userId
): array {
    $update = $pdo->prepare(
        'UPDATE map_features SET properties_json = :properties_json, revision = :revision,
                updated_by = :updated_by
          WHERE id = :id'
    );

    $audit = ['before' => [], 'after' => [], 'bounds' => []];
    foreach ($siblings as $sibling) {
        $properties = avesmapsDecodeJsonColumnForEdit($sibling['properties_json'] ?? null);
        $subtype = (string) $sibling['feature_subtype'];
        // ⚠️ Auch der RUECKFALL geht durch die Regel: ein Bach ohne gespeicherte Liste bekaeme
        // sonst Fluss-Verkehrsmittel untergeschoben, und ein Jahreszeitenfenster fuer einen
        // Flusssegler, der dort nie faehrt, waere tote Angabe.
        $allowed = is_array($properties['allowed_transports'] ?? null)
            ? array_values($properties['allowed_transports'])
            : avesmapsPathTransportRegel(
                $subtype,
                avesmapsPathIstBach($subtype, $properties['is_bach'] ?? false),
                null
            )['allowed'];
        $forSibling = avesmapsReadTransportSeasons($seasons, $allowed);

        $before = $properties['transport_seasons'] ?? null;
        if ($forSibling === []) {
            unset($properties['transport_seasons']);
        } else {
            $properties['transport_seasons'] = $forSibling;
        }
        // Nichts anfassen, was sich nicht aendert -- sonst hebt ein Speichern ohne Aenderung die
        // Revision jedes Segments und schickt jedem warmen Client die halbe Karte neu.
        if (($before ?? []) == ($forSibling ?: [])) {
            continue;
        }

        avesmapsAssertFeatureCanBeEdited($pdo, [], $sibling, ['id' => $userId]);
        $update->execute([
            'id' => (int) $sibling['id'],
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => $userId,
        ]);
        $audit['before'][] = avesmapsPathGroupAuditMember($sibling);
        $audit['after'][] = avesmapsPathGroupAuditMember(array_replace($sibling, ['properties_json' => $properties]));
        $audit['bounds'][] = avesmapsCalculateGeometryBounds(avesmapsReadGeometryFromColumnValue($sibling['geometry_json']));
    }

    return $audit;
}

