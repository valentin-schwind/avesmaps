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
    if ($rest === []) {
        unset($properties[AVESMAPS_WIKI_PATH_WEITERE_FELD]);
    } else {
        $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $rest;
    }
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
