<?php

declare(strict_types=1);

// Lesezugriff auf Flora, Fauna, Spezies und Handelswaren (Abschnitt 2).
// Design: docs/flora-fauna-handelswaren-design.md.
//
// WARUM NICHT WIE DIE ABENTEUER: der Abenteuerkatalog reist komplett zum Client und
// wird dort aggregiert. Das geht bei ~500 Zeilen; hier sind es 5.104 Eintraege,
// 7.748 Ortsverknuepfungen und 34.933 Quellen -- der gleiche Ansatz waere ein
// Payload, den jeder Besucher der Karte bezahlt, um ihn fast nie zu brauchen.
// Deshalb wird PRO ORT gelesen, erst wenn ein Infopanel ihn anfordert.
//
// Side-effect-free on include (nur const + function). Jede Funktion bekommt ihr PDO.

/**
 * Kontinente und Sammelbegriffe, die ueberall gelten und deshalb ZULETZT gereiht
 * werden. Sie werden NICHT verworfen: Wirselkraut steht als „ganz [[Aventurien]]"
 * und waechst damit tatsaechlich auch in Weiden -- wegzuwerfen waere schlicht falsch.
 * Es darf die Liste nur nicht anfuehren.
 */
const AVESMAPS_LORE_CONTINENT_KEYS = [
    'aventurien', 'myranor', 'uthuria', 'rakshazar', 'tharun', 'riesland',
    'guldenland', 'gueldenland', 'ehernes-schwert-kontinent',
];

/** Die vier Sektionen in Anzeigereihenfolge. */
const AVESMAPS_LORE_KINDS = ['flora', 'fauna', 'spezies', 'ware'];

/** Wie viele Eintraege je Sektion das Infopanel zeigt; der Rest liegt hinter „alle anzeigen". */
const AVESMAPS_LORE_PANEL_LIMIT = 10;

/**
 * Bestandszahlen -- der Abnahmetest nach einem Sync. Erwartung aus dem verifizierten
 * Dump-Scan (2026-07-21): 5.104 Eintraege (1.382 fauna / 1.004 flora / 187 spezies /
 * 2.531 ware), 7.748 Ortsverknuepfungen, 34.933 Quellen.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreReadStats(PDO $pdo): array
{
    $out = ['entries' => [], 'entries_total' => 0, 'places' => 0, 'sources' => 0, 'top_places' => []];

    try {
        $rows = $pdo->query(
            'SELECT kind, COUNT(*) AS n FROM lore_entry WHERE status = \'active\' GROUP BY kind'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as $row) {
            $out['entries'][(string) $row['kind']] = (int) $row['n'];
            $out['entries_total'] += (int) $row['n'];
        }
        $out['places'] = (int) $pdo->query('SELECT COUNT(*) FROM lore_place WHERE status = \'active\'')->fetchColumn();
        $out['sources'] = (int) $pdo->query('SELECT COUNT(*) FROM lore_source WHERE status = \'active\'')->fetchColumn();
        $out['top_places'] = $pdo->query(
            'SELECT place_title, COUNT(*) AS n FROM lore_place WHERE status = \'active\'
             GROUP BY place_title ORDER BY n DESC LIMIT 15'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {
        // Tabellen noch nicht angelegt (kein Sync gelaufen) -> Nullen statt 500.
        return $out;
    }

    return $out;
}

/**
 * Alle Eintraege zu EINEM Ort, nach Sektion gruppiert.
 *
 * Reihung (Design §4): direkte Treffer zuerst, kontinentweite zuletzt, innerhalb
 * dessen alphabetisch. Die Abwaerts-/Aufwaertsaggregation ueber die Territorien-
 * hierarchie kommt in Abschnitt 3 dazu; diese Funktion liefert die DIREKTEN Treffer
 * und ist so gebaut, dass die Aggregation nur die Schluesselliste erweitern muss.
 *
 * @param list<string> $placeKeys ein oder mehrere Ortsschluessel (Region, Siedlung, Territorium)
 * @return array<string,mixed> { sections: {kind: [entry,...]}, counts: {kind: n}, total: n }
 */
function avesmapsLoreReadForPlaces(PDO $pdo, array $placeKeys, int $limit = AVESMAPS_LORE_PANEL_LIMIT): array
{
    $keys = [];
    foreach ($placeKeys as $key) {
        $key = trim((string) $key);
        if ($key !== '' && !in_array($key, $keys, true)) {
            $keys[] = $key;
        }
    }

    $empty = ['sections' => [], 'counts' => [], 'total' => 0];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $empty['sections'][$kind] = [];
        $empty['counts'][$kind] = 0;
    }
    if ($keys === []) {
        return $empty;
    }

    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $sql =
        'SELECT e.wiki_key, e.kind, e.name, e.wiki_url, e.gruppe, e.typ, e.lebensraum,
                p.place_wiki_key, p.place_title, p.relation
         FROM lore_place p
         JOIN lore_entry e ON e.wiki_key = p.entry_wiki_key AND e.status = \'active\'
         WHERE p.status = \'active\' AND p.place_wiki_key IN (' . $placeholders . ')
         ORDER BY e.name';

    try {
        $statement = $pdo->prepare($sql);
        $statement->execute($keys);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {
        return $empty; // Tabellen fehlen (kein Sync) -> leer statt 500
    }

    // Ein Eintrag kann ueber mehrere Relationen am selben Ort haengen (Ware: Herkunft
    // UND Verbreitung). Er soll EINMAL erscheinen, aber beide Relationen behalten.
    $byKind = [];
    $seen = [];
    foreach ($rows as $row) {
        $kind = (string) $row['kind'];
        $key = (string) $row['wiki_key'];
        if (!isset($byKind[$kind])) {
            $byKind[$kind] = [];
        }
        if (isset($seen[$kind][$key])) {
            $index = $seen[$kind][$key];
            $relation = (string) $row['relation'];
            if (!in_array($relation, $byKind[$kind][$index]['relations'], true)) {
                $byKind[$kind][$index]['relations'][] = $relation;
            }
            continue;
        }
        $isContinent = in_array(mb_strtolower((string) $row['place_wiki_key'], 'UTF-8'), AVESMAPS_LORE_CONTINENT_KEYS, true);
        $seen[$kind][$key] = count($byKind[$kind]);
        $byKind[$kind][] = [
            'wiki_key' => $key,
            'name' => (string) $row['name'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'gruppe' => (string) ($row['gruppe'] ?? ''),
            'typ' => (string) ($row['typ'] ?? ''),
            'lebensraum' => (string) ($row['lebensraum'] ?? ''),
            'relations' => [(string) $row['relation']],
            'place_title' => (string) $row['place_title'],
            // 0 = direkt am Ort, 3 = kontinentweit. Abschnitt 3 fuellt 1 (Untergebiet)
            // und 2 (Obergebiet) nach; die Reihung steht dann schon.
            'rank' => $isContinent ? 3 : 0,
        ];
    }

    $out = ['sections' => [], 'counts' => [], 'total' => 0];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $entries = $byKind[$kind] ?? [];
        usort($entries, static function (array $a, array $b): int {
            return $a['rank'] <=> $b['rank'] ?: strcasecmp($a['name'], $b['name']);
        });
        $out['counts'][$kind] = count($entries);
        $out['total'] += count($entries);
        $out['sections'][$kind] = $limit > 0 ? array_slice($entries, 0, $limit) : $entries;
    }

    return $out;
}
