<?php

declare(strict_types=1);

// Wie aus einem Namen ein Schluessel wird und was zu einem Ort noch dazugehoert. Aus lore.php
// herausgezogen, die diese Datei an der Stelle des Blocks requiret; AVESMAPS_LORE_CONTINENT_KEYS
// steht dort davor. Rein bis auf die zwei Abfragen von avesmapsLoreExpandPlaceKeys -- kein Code
// auf oberster Ebene, damit das Einbinden nichts kostet (Begruendung im Kopf von lore.php).

/**
 * Vergleichsschlüssel eines Warennamens. Bildet avesmapsWikiSyncCreateMatchKey nach,
 * damit der Abgleich zu den beim Sync geschriebenen match_key-Werten passt.
 */
function avesmapsLoreMatchKey(string $value): string
{
    if (function_exists('avesmapsWikiSyncCreateMatchKey')) {
        return avesmapsWikiSyncCreateMatchKey($value);
    }
    $key = mb_strtolower(trim($value), 'UTF-8');
    $key = strtr($key, ['ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss']);

    return (string) preg_replace('/[^a-z0-9]+/u', '', $key);
}

/** Normalisiert einen Server-wiki_key ('wiki:weiden') auf die Form in lore_place ('weiden'). */
function avesmapsLoreStripKeyPrefix(string $key): string
{
    $key = mb_strtolower(trim($key), 'UTF-8');
    foreach (['wiki:', 'name:'] as $prefix) {
        if (str_starts_with($key, $prefix)) {
            $key = substr($key, strlen($prefix));
        }
    }

    return trim($key);
}

/**
 * Wiki-Titel -> Ortsschlüssel. Bildet avesmapsPoliticalSlug nach (Umlaute werden
 * transliteriert), damit die Schlüssel zu denen aus lore-sync.php passen.
 */
function avesmapsLoreSlugForTitle(string $title): string
{
    if (function_exists('avesmapsPoliticalSlug')) {
        return avesmapsPoliticalSlug(trim($title));
    }
    $slug = mb_strtolower(trim($title), 'UTF-8');
    $slug = strtr($slug, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
    $slug = preg_replace('/[^a-z0-9]+/u', '-', $slug) ?? '';

    return trim((string) $slug, '-');
}

/**
 * Ortsschlüssel aus einem Feldwert.
 *
 * 💣 political_territory_wiki.geographic enthält KEIN Wiki-Markup mehr: der
 * Territorien-Parser (avesmapsPoliticalReadWikiString) hat die Links längst zu
 * Klartext aufgelöst. Gemessen 2026-07-21 steht dort schlicht "Albernia", nicht
 * "[[Albernia]]". Ein reiner Wikilink-Extraktor findet dort NICHTS -- genau daran
 * ist die erste Fassung der Aggregation gescheitert.
 *
 * Deshalb beide Formen: sind Links da, gewinnen sie (präziser, weil das Linkziel der
 * echte Seitentitel ist); sonst wird der Klartext an ;/, getrennt und geslugged.
 */
function avesmapsLoreKeysFromWikiField(string $value): array
{
    $value = trim($value);
    if ($value === '') {
        return [];
    }

    $out = [];
    $add = static function (string $title) use (&$out): void {
        $slug = avesmapsLoreSlugForTitle($title);
        if ($slug !== '' && !in_array($slug, $out, true)) {
            $out[] = $slug;
        }
    };

    if (str_contains($value, '[[')
        && preg_match_all('/\[\[\s*([^\]\|#<>\[]+?)\s*(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]/u', $value, $matches) >= 1) {
        foreach ($matches[1] as $title) {
            $add((string) $title);
        }

        return $out;
    }

    // Klartext: "Mittelaventurien; Weiden" -> zwei Schlüssel. Ein etwaiges
    // "Feldname:"-Präfix fällt weg, sonst wird die Beschriftung Teil des Ortsnamens.
    foreach (preg_split('/\s*[;,]\s*/u', $value) ?: [] as $part) {
        $part = trim((string) preg_replace('/^[^:]{0,24}:\s*/u', '', trim($part)));
        if ($part !== '') {
            $add($part);
        }
    }

    return $out;
}

/**
 * Erweitert EINEN Ortsschlüssel um alles, was inhaltlich dazugehört, mit Rang:
 *
 *   0  der Ort selbst
 *   1  ABWÄRTS -- Untergebiete. Werden Schilde in der Baronie Moosgrund gehandelt,
 *      gehören sie in Weidens Liste, weil Moosgrund in Weiden liegt.
 *   (Rang 2 gab es einmal für Obergebiete und ist bewusst entfallen -- siehe unten.)
 *
 * Zwei Bäume werden dafür verbunden, weil das Wiki zwei Achsen führt:
 *   - politisch:      wiki_territory_model.parent_wiki_key (⚠️ NIE affiliation_path)
 *   - derographisch:  political_territory_wiki.geographic nennt die Region eines
 *                     Territoriums -- das ist die Brücke zwischen beiden Achsen.
 *
 * Kontinente werden NICHT expandiert: „Aventurien" zöge sonst die halbe Welt herein.
 * Ihre Einträge kommen weiter über den direkten Treffer und landen auf Rang 3.
 *
 * @return array<string,int> Ortsschlüssel => Rang
 */
function avesmapsLoreExpandPlaceKeys(PDO $pdo, string $placeKey): array
{
    $root = avesmapsLoreStripKeyPrefix($placeKey);
    if ($root === '') {
        return [];
    }
    $ranks = [$root => 0];
    if (in_array($root, AVESMAPS_LORE_CONTINENT_KEYS, true)) {
        return $ranks; // ein Kontinent hat keine sinnvolle Ausweitung
    }

    // Die beiden Hierarchietabellen werden PRO ANFRAGE nur EINMAL gelesen, auch wenn
    // mehrere Orte expandiert werden. Sie ändern sich ausschließlich beim Sync, nie
    // während eines Aufrufs.
    static $parentOfCache = null;
    static $childrenOfCache = null;
    static $territoriesInRegionCache = null;

    if ($parentOfCache !== null) {
        $parentOf = $parentOfCache;
        $childrenOf = $childrenOfCache;
        $territoriesInRegion = $territoriesInRegionCache;

        return avesmapsLoreExpandFromMaps($root, $ranks, $parentOf, $childrenOf, $territoriesInRegion);
    }

    $parentOf = [];
    $childrenOf = [];
    try {
        $rows = $pdo->query('SELECT wiki_key, parent_wiki_key FROM wiki_territory_model') ?: [];
        foreach ($rows as $row) {
            $child = avesmapsLoreStripKeyPrefix((string) ($row['wiki_key'] ?? ''));
            $parent = avesmapsLoreStripKeyPrefix((string) ($row['parent_wiki_key'] ?? ''));
            if ($child !== '' && $parent !== '') {
                $parentOf[$child] = $parent;
                $childrenOf[$parent][] = $child;
            }
        }
    } catch (Throwable) {
        // Baum noch nicht gebaut -> nur direkte Treffer. Kein Grund für einen 500er.
    }

    $territoriesInRegion = [];
    try {
        $rows = $pdo->query(
            'SELECT wiki_key, geographic FROM political_territory_wiki
             WHERE geographic IS NOT NULL AND geographic <> \'\''
        ) ?: [];
        foreach ($rows as $row) {
            $territory = avesmapsLoreStripKeyPrefix((string) ($row['wiki_key'] ?? ''));
            if ($territory === '') {
                continue;
            }
            foreach (avesmapsLoreKeysFromWikiField((string) ($row['geographic'] ?? '')) as $regionKey) {
                $territoriesInRegion[$regionKey][] = $territory;
            }
        }
    } catch (Throwable) {
        // Wiki-Spiegel fehlt -> keine Regionsbrücke.
    }

    // 💣 KEINE VERERBUNG NACH UNTEN (Owner 2026-07-21). Information steigt AUF, sie
    // fällt nicht herab: Werden Schilde in der Baronie Moosgrund gehandelt, gehören sie
    // in Weidens Liste. Umgekehrt macht „Taschendrachen gibt es in Almada" die Stadt
    // Punin NICHT zum Drachenort -- Punin liegt nur zufällig darin.
    //
    // Die frühere Fassung sammelte auch die Vorfahren (Rang 2) ein. Ergebnis: Punin
    // zeigte 149 Einträge, praktisch alle von Almada geerbt, und las sich, als käme
    // das alles dort vor. Deshalb gibt es hier nur noch Rang 0 (der Ort selbst) und
    // Rang 1 (seine Untergebiete). Eine Stadt zeigt dann meist nichts -- das ist die
    // richtige Antwort, nicht eine fehlende.

    $parentOfCache = $parentOf;
    $childrenOfCache = $childrenOf;
    $territoriesInRegionCache = $territoriesInRegion;

    return avesmapsLoreExpandFromMaps($root, $ranks, $parentOf, $childrenOf, $territoriesInRegion);
}

/**
 * PURE: die eigentliche Ausweitung auf den bereits geladenen Hierarchie-Karten.
 * Getrennt, damit der zweite und jeder weitere Ort einer Anfrage sie ohne erneutes
 * Tabellenlesen durchlaufen kann.
 *
 * @param array<string,int> $ranks
 * @return array<string,int>
 */
function avesmapsLoreExpandFromMaps(
    string $root,
    array $ranks,
    array $parentOf,
    array $childrenOf,
    array $territoriesInRegion
): array {
    // ABWÄRTS EINSAMMELN: Nachfahren im politischen Baum + alle Territorien dieser Region.
    $queue = $childrenOf[$root] ?? [];
    foreach ($territoriesInRegion[$root] ?? [] as $territory) {
        $queue[] = $territory;
    }
    $seen = [];
    while ($queue !== []) {
        $node = array_shift($queue);
        if ($node === '' || isset($seen[$node]) || count($seen) > 5000) {
            continue;
        }
        $seen[$node] = true;
        if (!isset($ranks[$node])) {
            $ranks[$node] = 1;
        }
        foreach ($childrenOf[$node] ?? [] as $child) {
            $queue[] = $child;
        }
    }

    return $ranks;
}
