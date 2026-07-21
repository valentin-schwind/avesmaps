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
 * Katalogliste für den Editor-Reiter: durchsuchbar, nach Art gefiltert, mit der Zahl
 * der zugeordneten Orte je Eintrag. Bewusst NICHT der Panel-Pfad -- der liest pro Ort,
 * hier will man den Bestand sehen.
 *
 * @return array{items:list<array<string,mixed>>, total:int}
 */
/**
 * Bestand je Art -- die Zahlen an den Unterreitern. Bewusst UNABHÄNGIG von Filter und
 * Suchbegriff: die Reiter sollen zeigen, wie viel es gibt, nicht wie viel gerade
 * gefiltert übrig bleibt. Sonst wandern die Zahlen bei jedem Tastendruck.
 *
 * @return array<string,int>
 */
function avesmapsLoreCountsByKind(PDO $pdo): array
{
    $counts = [];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $counts[$kind] = 0;
    }
    try {
        $rows = $pdo->query(
            'SELECT kind, COUNT(*) AS n FROM lore_entry WHERE status = \'active\' GROUP BY kind'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as $row) {
            $kind = (string) $row['kind'];
            if (array_key_exists($kind, $counts)) {
                $counts[$kind] = (int) $row['n'];
            }
        }
    } catch (Throwable) {
        // Tabelle fehlt (kein Sync) -> Nullen, keine Ausnahme.
    }

    return $counts;
}

function avesmapsLoreReadCatalog(PDO $pdo, string $kind = '', string $query = '', int $limit = 200, int $offset = 0): array
{
    $where = ["e.status = 'active'"];
    $params = [];
    if ($kind !== '' && in_array($kind, AVESMAPS_LORE_KINDS, true)) {
        $where[] = 'e.kind = :kind';
        $params['kind'] = $kind;
    }
    $query = trim($query);
    if ($query !== '') {
        // Name ODER Gruppe ODER Synonym: „Hirsch" soll auch die Tiere finden, deren Art
        // das ist.
        // 💣 DREI EIGENE PLATZHALTER, nicht dreimal derselbe: ohne Prepare-Emulation
        // lehnt MySQL einen mehrfach verwendeten benannten Parameter ab. Die erste
        // Fassung tat genau das, der Fehler wurde vom catch unten zu „0 Treffer"
        // verschluckt, und jede Textsuche kam leer zurück -- was aussah, als gäbe es
        // den gesuchten Eintrag nicht.
        $where[] = '(e.name LIKE :q1 OR e.gruppe LIKE :q2 OR e.synonyme LIKE :q3)';
        $params['q1'] = '%' . $query . '%';
        $params['q2'] = '%' . $query . '%';
        $params['q3'] = '%' . $query . '%';
    }
    $whereSql = implode(' AND ', $where);
    $limit = max(1, min(500, $limit));
    $offset = max(0, $offset);

    try {
        $countStatement = $pdo->prepare('SELECT COUNT(*) FROM lore_entry e WHERE ' . $whereSql);
        $countStatement->execute($params);
        $total = (int) $countStatement->fetchColumn();

        // 💣 KEINE korrelierten Unterabfragen je Zeile. Die erste Fassung hatte DREI --
        // bei 200 Zeilen also 600 Abfragen für eine Liste. Stattdessen: erst die
        // Einträge, dann Orte und Quellen für genau diese Schlüssel in je EINER
        // Abfrage. Drei Abfragen statt sechshundert, unabhängig von der Seitengröße.
        $statement = $pdo->prepare(
            'SELECT e.wiki_key, e.kind, e.name, e.wiki_url, e.gruppe, e.typ, e.lebensraum, e.origin
             FROM lore_entry e
             WHERE ' . $whereSql . '
             ORDER BY e.name
             LIMIT ' . $limit . ' OFFSET ' . $offset
        );
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $keys = array_column($rows, 'wiki_key');
        $placesByEntry = [];
        $sourceCounts = [];
        if ($keys !== []) {
            $in = implode(',', array_fill(0, count($keys), '?'));

            // Die Orte SELBST, nicht nur ihre Zahl: „Weiden, Kosch, Nordmarken" sagt
            // etwas, „3 Orte" nichts.
            $placeStatement = $pdo->prepare(
                'SELECT entry_wiki_key, place_title FROM lore_place
                 WHERE status = \'active\' AND entry_wiki_key IN (' . $in . ')
                 ORDER BY entry_wiki_key, sort_order'
            );
            $placeStatement->execute($keys);
            foreach ($placeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $placesByEntry[(string) $row['entry_wiki_key']][] = (string) $row['place_title'];
            }

            $sourceStatement = $pdo->prepare(
                'SELECT entry_wiki_key, COUNT(*) AS n FROM lore_source
                 WHERE status = \'active\' AND entry_wiki_key IN (' . $in . ')
                 GROUP BY entry_wiki_key'
            );
            $sourceStatement->execute($keys);
            foreach ($sourceStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $sourceCounts[(string) $row['entry_wiki_key']] = (int) $row['n'];
            }
        }
    } catch (Throwable $error) {
        // NICHT still auf 0 Treffer zurückfallen: ein Abfragefehler sieht dann exakt
        // aus wie „gibt es nicht", und man sucht ihn an der falschen Stelle. Genau das
        // ist mit dem mehrfach verwendeten Platzhalter oben passiert. Die Meldung geht
        // an den Aufrufer, nicht in die Antwort -- sie kann Schemadetails enthalten.
        error_log('lore catalog query failed: ' . $error->getMessage());

        return ['items' => [], 'total' => 0, 'failed' => true];
    }

    $items = [];
    foreach ($rows as $row) {
        $items[] = [
            'wiki_key' => (string) $row['wiki_key'],
            'kind' => (string) $row['kind'],
            'name' => (string) $row['name'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'gruppe' => (string) ($row['gruppe'] ?? ''),
            'typ' => (string) ($row['typ'] ?? ''),
            'lebensraum' => (string) ($row['lebensraum'] ?? ''),
            'origin' => (string) ($row['origin'] ?? 'wiki'),
            'place_count' => count($placesByEntry[(string) $row['wiki_key']] ?? []),
            // Auf 6 gekappt: eine Zeile soll die Gegend andeuten, nicht 40 Orte
            // ausbreiten. Der Rest steht als Zahl dahinter.
            'places' => array_slice($placesByEntry[(string) $row['wiki_key']] ?? [], 0, 6),
            'source_count' => $sourceCounts[(string) $row['wiki_key']] ?? 0,
        ];
    }

    return ['items' => $items, 'total' => $total];
}

/**
 * Löst freie Warennamen gegen den Katalog auf: „Salz" -> Artikel, „Vieh" -> nichts.
 *
 * Wozu: die Infobox-Zeile „Handelswaren" ist FREITEXT aus {{Infobox Staat}}, und der
 * Wiki-Sync hat etwaige Links darin längst zu bloßem Text aufgelöst. Wer die Liste mit
 * den katalogisierten Waren zu EINER Zeile verschmelzen will, braucht für jeden Namen
 * die Antwort: gibt es dazu einen Artikel? Genau das liefert diese Funktion --
 * Gattungen wie „Vieh" oder „Holz" bleiben erwartungsgemäß ohne Treffer.
 *
 * @param list<string> $names
 * @return array<string,array{name:string,wiki_url:string,gruppe:string}> Eingabename => Treffer
 */
function avesmapsLoreResolveGoodsByName(PDO $pdo, array $names): array
{
    $clean = [];
    foreach ($names as $name) {
        $name = trim((string) $name);
        if ($name !== '' && mb_strlen($name, 'UTF-8') <= 190 && !in_array($name, $clean, true)) {
            $clean[] = $name;
        }
    }
    if ($clean === []) {
        return [];
    }
    $clean = array_slice($clean, 0, 60); // eine Infobox-Zeile ist nie länger

    try {
        $in = implode(',', array_fill(0, count($clean), '?'));
        // Über match_key vergleichen, nicht über name: der faltet Groß/Klein, Umlaute
        // und Sonderzeichen -- „Leinöl" trifft dann auch „Leinoel".
        $statement = $pdo->prepare(
            'SELECT name, match_key, wiki_url, gruppe FROM lore_entry
             WHERE kind = \'ware\' AND status = \'active\' AND match_key IN (' . $in . ')'
        );
        $keys = array_map(static fn(string $n): string => avesmapsLoreMatchKey($n), $clean);
        $statement->execute($keys);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $error) {
        error_log('lore goods resolve failed: ' . $error->getMessage());

        return [];
    }

    $byKey = [];
    foreach ($rows as $row) {
        $key = (string) $row['match_key'];
        if (!isset($byKey[$key])) {
            $byKey[$key] = [
                'name' => (string) $row['name'],
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'gruppe' => (string) ($row['gruppe'] ?? ''),
            ];
        }
    }

    $out = [];
    foreach ($clean as $name) {
        $hit = $byKey[avesmapsLoreMatchKey($name)] ?? null;
        if ($hit !== null) {
            $out[$name] = $hit;
        }
    }

    return $out;
}

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
function avesmapsLoreReadForPlaces(PDO $pdo, array $placeKeys, int $limit = AVESMAPS_LORE_PANEL_LIMIT, array $rankByKey = []): array
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
            // Derselbe Eintrag kann über mehrere Orte hereinkommen (direkt UND über ein
            // Untergebiet). Der SPEZIFISCHSTE gewinnt, sonst sinkt ein direkter Treffer
            // ans Ende, nur weil er zufällig auch kontinentweit gelistet ist.
            if ($rank < $byKind[$kind][$index]['rank']) {
                $byKind[$kind][$index]['rank'] = $rank;
                $byKind[$kind][$index]['place_title'] = (string) $row['place_title'];
            }
            continue;
        }
        // Rang aus der Expansion (0 direkt, 1 Untergebiet); ohne Expansion
        // ist jeder Treffer direkt. Kontinente gehen IMMER auf 3 -- sie gelten überall
        // und sagen über diesen Ort am wenigsten aus.
        $placeKeyLower = mb_strtolower((string) $row['place_wiki_key'], 'UTF-8');
        $rank = in_array($placeKeyLower, AVESMAPS_LORE_CONTINENT_KEYS, true)
            ? 3
            : (int) ($rankByKey[$placeKeyLower] ?? 0);
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
            // nach; die Reihung steht dann schon.
            'rank' => $rank,
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
