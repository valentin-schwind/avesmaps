<?php

declare(strict_types=1);

// Weitere Wiki-Zuweisungen eines Wegabschnitts.
// Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.
//
// 🔴 `properties.wiki_path` BLEIBT DIE IDENTITAET (Name R1, Gruppe, Verlauf-Abgleich, Kanon).
// `properties.wiki_path_weitere` traegt zusaetzliche Artikel -- ein Pilgerweg ueber eine
// Reichsstrasse, eine Karawanenroute auf dem Stamm einer anderen. Eine weitere Zuweisung aendert
// nie Name, Gruppe oder Art (Owner 14.09.2026: „der wegname bleibt").
// 💣 WARUM KEIN ARRAY AUS wiki_path SELBST: rund 45 Leser greifen auf wiki_path.wiki_key/.name/
// .wiki_url zu; ein Array liesse jeden still `undefined` lesen, und die Wege saehen unzugewiesen aus.
//
// Die Helfer oben sind rein (kein PDO); der Schreibweg unten nutzt Helfer aus sync.php,
// locations-helpers.php und paths.php NUR im Funktionsrumpf -- der Endpunkt laedt sie vorher.

const AVESMAPS_WIKI_PATH_WEITERE_FELD = 'wiki_path_weitere';
// Gleich AVESMAPS_PATH_GROUP_MAX_SEGMENTS (api/_internal/map/features.php) -- der Test haelt beide gleich.
const AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE = 250;

/** Die Liste, bereinigt: nur Eintraege mit Schluessel, jeder Schluessel einmal, feste Felder. */
function avesmapsWikiPathWeitereLesen(array $properties): array {
    $roh = $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] ?? null;
    if (!is_array($roh)) {
        return [];
    }
    $liste = [];
    $gesehen = [];
    foreach ($roh as $eintrag) {
        if (!is_array($eintrag)) {
            continue;
        }
        $key = trim((string) ($eintrag['wiki_key'] ?? ''));
        if ($key === '' || isset($gesehen[$key])) {
            continue;
        }
        $gesehen[$key] = true;
        $liste[] = [
            'wiki_key' => $key,
            'name' => (string) ($eintrag['name'] ?? ''),
            'wiki_url' => (string) ($eintrag['wiki_url'] ?? ''),
            'art' => (string) ($eintrag['art'] ?? ''),
            'kind' => (string) ($eintrag['kind'] ?? ''),
        ];
    }
    return $liste;
}

/** Ein Eintrag aus einer Zeile von wiki_path_staging. Bewusst schlank: kein Verlauf, keine Beschreibung. */
function avesmapsWikiPathWeitereEintragAusStaging(array $stagingRow): array {
    return [
        'wiki_key' => trim((string) ($stagingRow['wiki_key'] ?? '')),
        'name' => trim((string) ($stagingRow['name'] ?? '')),
        'wiki_url' => trim((string) ($stagingRow['wiki_url'] ?? '')),
        'art' => trim((string) ($stagingRow['art'] ?? '')),
        'kind' => trim((string) ($stagingRow['kind'] ?? '')),
    ];
}

function avesmapsWikiPathWeitereHauptKey(array $properties): string {
    return is_array($properties['wiki_path'] ?? null) ? trim((string) ($properties['wiki_path']['wiki_key'] ?? '')) : '';
}

/** @return array{properties: array, geaendert: bool, grund: string} */
function avesmapsWikiPathWeitereHinzufuegen(array $properties, array $eintrag): array {
    $unveraendert = static fn(string $grund): array => ['properties' => $properties, 'geaendert' => false, 'grund' => $grund];
    $key = trim((string) ($eintrag['wiki_key'] ?? ''));
    if ($key === '') {
        return $unveraendert('ohne_schluessel');
    }
    // Entwurf §2.2 Nr. 1: eine weitere Zuweisung setzt eine Hauptzuweisung voraus.
    $hauptKey = avesmapsWikiPathWeitereHauptKey($properties);
    if ($hauptKey === '') {
        return $unveraendert('ohne_hauptzuweisung');
    }
    if ($key === $hauptKey) {
        return $unveraendert('ist_hauptzuweisung');
    }
    $liste = avesmapsWikiPathWeitereLesen($properties);
    foreach ($liste as $vorhanden) {
        if ($vorhanden['wiki_key'] === $key) {
            return $unveraendert('schon_da');
        }
    }
    $liste[] = avesmapsWikiPathWeitereLesen([AVESMAPS_WIKI_PATH_WEITERE_FELD => [$eintrag]])[0];
    $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $liste;
    return ['properties' => $properties, 'geaendert' => true, 'grund' => ''];
}

/** @return array{properties: array, geaendert: bool, grund: string} */
function avesmapsWikiPathWeitereEntfernen(array $properties, string $wikiKey): array {
    $key = trim($wikiKey);
    $liste = avesmapsWikiPathWeitereLesen($properties);
    $rest = array_values(array_filter($liste, static fn(array $e): bool => $e['wiki_key'] !== $key));
    if (count($rest) === count($liste)) {
        return ['properties' => $properties, 'geaendert' => false, 'grund' => 'nicht_da'];
    }
    // 🔴 EINE LEER GEWORDENE LISTE BLEIBT ALS `[]` STEHEN, sie wird nicht geloescht (Nachtrag 15.09.2026 §9.2).
    // 💣 Der Live-Abgleich anderer Editoren legt das Delta per Spread ueber den alten Stand
    // (applyPathFeatureResponse, js/map-features/map-features-path-lifecycle.js): ein FEHLENDER Schluessel
    // ueberschreibt dort nichts, und der entfernte Artikel stuende bis zum Neuladen weiter am Abschnitt.
    // Welche Leser `[]` als „keine" lesen, steht in der Tafel des Nachtrags.
    $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $rest;
    return ['properties' => $properties, 'geaendert' => true, 'grund' => ''];
}

/**
 * Wird ein Artikel zur HAUPTzuweisung, der schon als weitere dastand, faellt er aus der Liste --
 * sonst trueg der Abschnitt denselben Artikel in zwei Rollen. Gerufen von den assign-Schreibern.
 */
function avesmapsWikiPathWeitereOhneHaupt(array $properties): array {
    $hauptKey = avesmapsWikiPathWeitereHauptKey($properties);
    if ($hauptKey === '' || !array_key_exists(AVESMAPS_WIKI_PATH_WEITERE_FELD, $properties)) {
        return $properties;
    }
    $liste = avesmapsWikiPathWeitereLesen($properties);
    if (!in_array($hauptKey, array_column($liste, 'wiki_key'), true)) {
        return $properties;
    }
    return avesmapsWikiPathWeitereEntfernen($properties, $hauptKey)['properties'];
}

/** Die Kennungen aus dem Rumpf: Liste, getrimmt, ohne Dubletten, nicht leer, hoechstens $deckel. */
function avesmapsWikiPathWeitereIds(mixed $roh, int $deckel): array {
    if (!is_array($roh)) {
        throw new RuntimeException('public_ids must be a list.');
    }
    $ids = [];
    foreach ($roh as $wert) {
        $id = is_scalar($wert) ? trim((string) $wert) : '';
        if ($id !== '' && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }
    if ($ids === []) {
        throw new RuntimeException('public_ids is empty.');
    }
    if (count($ids) > $deckel) {
        throw new RuntimeException('At most ' . $deckel . ' segments per request.');
    }
    return $ids;
}

/**
 * Weitere Zuweisung an Abschnitte haengen oder von ihnen nehmen (Entwurf §2.3).
 *
 * 🔴 DIE ABSCHNITTE NENNT DER CLIENT; hier wird keine Gruppe nachgebildet (dieselbe Regel wie
 * update_path_group_details -- eine zweite Fassung liefe beim ersten geaenderten Namen auseinander).
 * Geschrieben wird nur an Abschnitten, deren Liste sich wirklich aendert; je Abschnitt EIN Eintrag
 * im Aenderungsprotokoll (das Rueckgaengig arbeitet je Feature).
 * 💣 KEIN DDL HIER: die Funktion laeuft in einer Transaktion, und DDL committet in MySQL implizit --
 * deshalb steht das selbstheilende `avesmapsWikiPathEnsureTables` als ALLERERSTE Anweisung, VOR
 * der Transaktion, genau wie bei jedem Geschwister in dieser Datei (z. B. avesmapsWikiPathAssign).
 * Ohne den Aufruf faellt der erste Lauf auf einer frischen Installation mit „table doesn't exist"
 * statt sich die Staging-Tabelle selbst anzulegen.
 */
function avesmapsWikiPathWeitereSchreiben(PDO $pdo, string $modus, string $wikiKey, mixed $publicIdsRoh, bool $dryRun, int $userId): array {
    avesmapsWikiPathEnsureTables($pdo);
    if ($modus !== 'add' && $modus !== 'remove') {
        throw new RuntimeException('Unknown mode.');
    }
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key is required.');
    }
    $ids = avesmapsWikiPathWeitereIds($publicIdsRoh, AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE);

    $eintrag = null;
    if ($modus === 'add') {
        // Nur Artikel aus dem Wege-Katalog (§2.2 Nr. 3): wiki_path_staging haelt ausschliesslich Wege.
        $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
        $statement->execute(['k' => $wikiKey]);
        $stagingRow = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$stagingRow) {
            throw new RuntimeException('Wiki-Weg nicht im Staging: ' . $wikiKey);
        }
        $eintrag = avesmapsWikiPathWeitereEintragAusStaging($stagingRow);
    }

    $platzhalter = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT id, public_id, name, properties_json FROM map_features
          WHERE feature_type = 'path' AND is_active = 1 AND public_id IN ($platzhalter)"
    );
    $statement->execute($ids);
    $zeilen = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $zeilen[(string) $zeile['public_id']] = $zeile;
    }

    $skipped = [];
    $plan = [];
    foreach ($ids as $publicId) {
        if (!isset($zeilen[$publicId])) {
            $skipped[] = ['public_id' => $publicId, 'grund' => 'nicht_gefunden'];
            continue;
        }
        $properties = avesmapsWikiSyncDecodeJson($zeilen[$publicId]['properties_json'] ?? null);
        $ergebnis = $modus === 'add'
            ? avesmapsWikiPathWeitereHinzufuegen($properties, $eintrag)
            : avesmapsWikiPathWeitereEntfernen($properties, $wikiKey);
        if (!$ergebnis['geaendert']) {
            $skipped[] = ['public_id' => $publicId, 'grund' => $ergebnis['grund']];
            continue;
        }
        $plan[] = ['zeile' => $zeilen[$publicId], 'properties' => $ergebnis['properties']];
    }

    $antwort = [
        'ok' => true,
        'dry_run' => $dryRun,
        'action' => $modus === 'add' ? 'add_weitere' : 'remove_weitere',
        'wiki_key' => $wikiKey,
        'applied' => count($plan),
        'skipped' => $skipped,
        'segments_updated' => [],
    ];
    if ($dryRun || $plan === []) {
        return $antwort;
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
        foreach ($plan as $schritt) {
            $featureId = (int) $schritt['zeile']['id'];
            $vorher = avesmapsWikiSyncFetchAuditRow($pdo, $featureId);
            $update->execute([
                'pj' => avesmapsWikiSyncEncodeJson($schritt['properties']),
                'rev' => $revision,
                'id' => $featureId,
            ]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $vorher, $schritt['properties'], $revision, $userId);
            $antwort['segments_updated'][] = [
                'public_id' => (string) $schritt['zeile']['public_id'],
                'wiki_path_weitere' => avesmapsWikiPathWeitereLesen($schritt['properties']),
            ];
        }
        $pdo->commit();
    } catch (Throwable $fehler) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $fehler;
    }

    return $antwort;
}
