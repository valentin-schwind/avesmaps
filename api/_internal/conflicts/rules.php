<?php

declare(strict_types=1);

/**
 * Conflict centre -- rule registry.
 * =========================================================================
 * Every rule is deterministic: SQL plus the pure helpers in core.php. Nothing here guesses, and
 * nothing here writes -- detection is machine work, deciding is editor work
 * (docs/konfliktmanagement-design.md §3).
 *
 * DETECTION RUNS ON THE RAW STORED DATA, not on the enriched map-features payload. That matters:
 * avesmapsEnrichMapFeatureWikiUrl() invents a wiki_url by name when the column is empty, so the
 * payload shows collisions that exist only at request time. Those are an enrichment defect (fixed
 * separately in P3), not a data conflict, and mixing them in would tell an editor to repair a row
 * that is already empty. Consequence to expect: this rule finds FEWER settlement collisions than
 * the 2026-07-20 payload measurement (12 groups) -- the difference is exactly the 7 runtime-guessed
 * ones, which have nothing stored to repair.
 */

require_once __DIR__ . '/core.php';
// „Welche Beschriftung gehoert zu welcher Landschaftsflaeche" -- die EINE Stelle, an der diese
// Beziehung gelesen wird. Ihr Dateikopf sagt selbst, warum sie eine eigene ist: sie ist in BEIDE
// Richtungen gespeichert, und keine Seite allein ist vollstaendig. Sie macht kein DDL und schreibt
// nichts.
// 🪤 Fehlen die Landschaften-Tabellen, liefert sie die LEERE Beziehung -- und dann gilt hier jede
// Beschriftung als frei, die Liste zeigt also ueberall `deletable: true`. Hier stand „verhaelt sich
// wie vorher", und das war zu bequem gesagt. Gefaehrlich ist es nicht: der Schreibpfad fragt
// avesmapsEcosystemRegionPublicIdOfLabel selbst, und die wirft ohne die Tabellen -- was
// avesmapsConflictDeleteLabel in eine ABSAGE uebersetzt. Die Anzeige verspricht dort also mehr als
// der Knopf haelt, und das ist die sichere Richtung.
require_once __DIR__ . '/../app/ecosystem-label-link.php';

// PATH_SUBTYPE_KEYS as they appear in map_features.feature_subtype (AGENTS.md §2).
// 💣 Seit 01.09.2026 keine Abschrift mehr, sondern die kanonische Liste aus
// api/_internal/wiki/path-naming.php (ueber core.php geladen). Der eigene Name bleibt, weil ihn
// die Regeln dieser Datei tragen -- der INHALT hat nur noch eine Quelle.
const AVESMAPS_CONFLICT_PATH_SUBTYPES = AVESMAPS_PATH_SUBTYPE_KEYS;

// Which feature_type maps to which conflict-party type. Crossings/junctions carry no wiki identity.
const AVESMAPS_CONFLICT_FEATURE_TYPES = [
    'location' => 'location',
    'path' => 'path',
    'label' => 'label',
    'powerline' => 'powerline',
];

/**
 * Human labels for the party types. German -- these reach the editor's screen (AGENTS.md §8).
 */
const AVESMAPS_CONFLICT_TYPE_LABELS = [
    'location' => 'Ort',
    'path' => 'Weg',
    'label' => 'Region/Landschaft',
    'powerline' => 'Kraftlinie',
    'territory' => 'Territorium',
    'adventure' => 'Literatur',
    'citymap' => 'Karte',
];

/**
 * REIN: aus einer rohen map_features-Zeile die Konfliktpartei bauen -- oder null, wenn sie keine ist
 * (unbekannter Typ, kein Name, oder eine Kreuzung). Kein DB-Zugriff, keine Seiteneffekte -- deshalb
 * ohne PDO direkt testbar (anders als avesmapsConflictLoadMapRows() selbst, die eine Verbindung
 * braucht und in den PHP-Tests hier nie erreicht wurde).
 *
 * @param array{public_id:mixed,name:mixed,feature_type:mixed,feature_subtype:mixed,properties_json:mixed,geometry_json:mixed} $dbRow
 * @return array{type:string,id:string,label:string,subtype:string,wiki_url:string,position:mixed,claim_source:string,no_article:bool}|null
 */
function avesmapsConflictBuildMapRow(array $dbRow): ?array {
    $type = AVESMAPS_CONFLICT_FEATURE_TYPES[(string) ($dbRow['feature_type'] ?? '')] ?? '';
    if ($type === '') {
        return null;
    }
    $name = trim((string) ($dbRow['name'] ?? ''));
    if ($name === '' || str_starts_with($name, 'Kreuzung')) {
        return null;
    }
    $properties = json_decode((string) ($dbRow['properties_json'] ?? '{}'), true);
    if (!is_array($properties)) {
        $properties = [];
    }
    // The stored claim, in the order the editors write it. No enrichment, no fallback guessing.
    // WHERE it comes from is carried along: only the plain field can be cleared from here.
    // A block-borne claim hangs off the whole infobox payload and belongs to its own editor --
    // see repair.php. Welche Nester es gibt, steht in core.php und NUR dort.
    $claim = avesmapsConflictExtractClaim($properties);

    return [
        'type' => $type,
        'id' => (string) ($dbRow['public_id'] ?? ''),
        'label' => $name,
        'subtype' => (string) ($dbRow['feature_subtype'] ?? ''),
        'wiki_url' => $claim['wiki_url'],
        'position' => avesmapsConflictFirstPosition($dbRow['geometry_json'] ?? null),
        'claim_source' => $claim['claim_source'],
        // Ein Editor hat evtl. festgehalten, dass es im Wiki nichts dazu gibt (Knopf "Kein
        // Wiki-Eintrag", oder das Haekchen im Kraftlinien-Editor, AVESMAPS_CONFLICT_NO_ARTICLE_FLAG
        // in repair.php). Der Feldname wird hier als Zeichenkette gelesen, nicht ueber die Konstante
        // -- rules.php laedt repair.php nicht (umgekehrt), ein Require dorthin baute eine Ringabhaengigkeit.
        'no_article' => !empty($properties['wiki_no_article']),
    ];
}

/**
 * Load every map feature that can claim a wiki identity, with its RAW stored wiki_url.
 *
 * @return list<array{type:string,id:string,label:string,subtype:string,wiki_url:string}>
 */
function avesmapsConflictLoadMapRows(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, feature_type, feature_subtype, properties_json, geometry_json
         FROM map_features
         WHERE is_active = 1 AND feature_type IN ('location','path','label','powerline')"
    );
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $built = avesmapsConflictBuildMapRow($row);
        if ($built !== null) {
            $rows[] = $built;
        }
    }

    return $rows;
}

/**
 * Territories, adventures and CITYMAPS claim wiki articles too, and they live in their own tables --
 * so a settlement and a barony of the same name never met, which is exactly the case the owner raised
 * first ("Heldenweiler"). All three are read here and thrown into the same collision detector.
 *
 * 🔴 DIE KARTEN SIND SEIT DEM 16.08.2026 DABEI, UND HIER STAND DAS GEGENTEIL. Der alte Satz lautete:
 * „citymap.wiki_key is a COMPOSITE build key (`index:stadt:quelle:variante`), not a page identity" --
 * und er war richtig und ist es weiterhin. Nur begründete er einen Ausschluss, den es nicht mehr gibt:
 * seit Aufgabe 9 der Wiki-Zuweisung trägt eine Karte einen EIGENEN Artikel in `citymap.article_url`,
 * und der IST eine Seitenidentität. Gelesen wird ausschliesslich die neue Spalte.
 * 💣 `citymap.wiki_key` und `citymap.map_url` bleiben unangetastet und kommen hier NIE vor: der erste
 * ist der Bauschlüssel des Abgleichs, der zweite zeigt auf die Publikation, in der die Karte steckt.
 * Wer sie hier hereinzöge, vergliche Bauschlüssel bzw. Bücher mit Artikellinks -- genau der Unsinn,
 * den der alte Satz gemeint hat.
 * ⚠️ Und das ist kein Randfall: die Wiki-Registry, gegen die der Karten-Picker sucht, führt heute nur
 * Orts- und Bauwerksseiten. Ein Editor greift dort also fast immer nach der Seite eines ORTES -- diese
 * Regel ist der Fang dafür.
 *
 * NOT included, deliberately:
 *  - sources.wiki_key IS a publication article, but a shared source catalogue exists precisely so
 *    that many entities cite ONE publication. Flagging that would be noise, not a finding.
 *
 * Each loader is wrapped: a missing table (fresh install, feature never used) must leave the rule
 * working on whatever else is there, never take the whole list down.
 *
 * @return list<array{type:string,id:string,label:string,wiki_url:string}>
 */
function avesmapsConflictLoadTerritoryRows(PDO $pdo): array {
    // Die Position kommt aus derselben rekursiven Abfrage wie in der Spotlight-Suche
    // (avesmapsFetchPoliticalTerritorySearchRows, api/app/map-search.php): die Huelle eines Gebiets
    // ist die seiner eigenen Geometrie PLUS aller Nachfahren -- sonst haette ein reiner
    // Aggregat-Knoten ohne eigene Geometrie keine, und genau die grossen Reiche sind solche Knoten.
    // Owner-Hinweis 2026-07-21: "die kriegst du raus, wenn du dir die spotlight suche anschaust".
    // Uebernommen statt neu erfunden; LEFT JOIN, damit ein Gebiet ohne jede Geometrie trotzdem als
    // Konfliktpartei erscheint -- nur eben ohne "Auf der Karte zeigen".
    try {
        $statement = $pdo->query(
            "WITH RECURSIVE subtree AS (
                SELECT id AS root_id, id AS node_id FROM political_territory WHERE is_active = 1
                UNION ALL
                SELECT st.root_id, c.id
                FROM subtree st
                JOIN political_territory c ON c.parent_id = st.node_id AND c.is_active = 1
            )
            SELECT t.public_id, t.name, w.wiki_url,
                   MIN(g.min_x) AS min_x, MIN(g.min_y) AS min_y,
                   MAX(g.max_x) AS max_x, MAX(g.max_y) AS max_y
             FROM political_territory t
             INNER JOIN political_territory_wiki w ON w.wiki_key = t.wiki_key
             LEFT JOIN subtree st ON st.root_id = t.id
             LEFT JOIN political_territory_geometry g ON g.territory_id = st.node_id AND g.is_active = 1
             WHERE t.is_active = 1 AND w.wiki_url IS NOT NULL AND w.wiki_url <> ''
             GROUP BY t.id, t.public_id, t.name, w.wiki_url"
        );
    } catch (Throwable $exception) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        // Mittelpunkt der Huelle. Die Geometrie liegt bereits im 0..1024-Kartenraum, also KEINE
        // Vertauschung wie bei GeoJSON -- min_y/max_y sind schon die Breite.
        $position = null;
        if (is_numeric($row['min_x'] ?? null) && is_numeric($row['min_y'] ?? null)
            && is_numeric($row['max_x'] ?? null) && is_numeric($row['max_y'] ?? null)) {
            $position = [
                'lat' => ((float) $row['min_y'] + (float) $row['max_y']) / 2,
                'lng' => ((float) $row['min_x'] + (float) $row['max_x']) / 2,
            ];
        }

        $rows[] = [
            'type' => 'territory',
            'id' => (string) $row['public_id'],
            'label' => $name,
            'subtype' => '',
            'wiki_url' => trim((string) $row['wiki_url']),
            'position' => $position,
            'claim_source' => 'territory_wiki',
        ];
    }

    return $rows;
}

function avesmapsConflictLoadGameLiteratureRows(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT public_id, title, wiki_url FROM adventure
             WHERE status = 'approved' AND wiki_url IS NOT NULL AND wiki_url <> ''"
        );
    } catch (Throwable $exception) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $rows[] = [
            'type' => 'adventure',
            'id' => (string) $row['public_id'],
            'label' => $title,
            'subtype' => '',
            'wiki_url' => trim((string) $row['wiki_url']),
            'position' => null,
            'claim_source' => 'adventure',
        ];
    }

    return $rows;
}

/**
 * Die KARTEN (Stadtpläne) als Konfliktpartei -- seit dem 16.08.2026, weil sie seither einen EIGENEN
 * Wiki-Artikel tragen können (Aufgabe 9 der Wiki-Zuweisung, Entwurf
 * docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §8).
 *
 * 💣 GELESEN WIRD `article_url`, UND NUR SIE. Die Tabelle führt zwei weitere Spalten, die nach „wiki"
 * aussehen, und keine davon ist eine Seitenidentität:
 *   `citymap.wiki_key` -- der BAUSCHLÜSSEL des Abgleichs (`index:stadt:quelle:variante`,
 *      avesmapsCitymapWikiKey). Er sagt, aus welcher Index-Seite die Zeile stammt.
 *   `citymap.map_url`  -- der Karten-Link; bei einer Wiki-Karte zeigt er auf die PUBLIKATION, in der
 *      die Karte steckt (avesmapsCitymapWikiUrlForSource), nie auf die Karte.
 * Beide hier hereinzuziehen erzeugte genau den Unsinn, den der Kommentar über
 * avesmapsConflictLoadTerritoryRows bis zum 16.08.2026 als Ausschlussgrund nannte.
 *
 * 🔴 NUR IN DIE KOLLISIONSREGEL, NICHT AUF DIE BEOBACHTUNGSLISTE -- dieselbe Grenze wie bei
 * Territorien und Literatur (`avesmapsConflictDetectAll` reicht diese Zeilen an `$claimRows`, nicht an
 * `$rows`). Eine Karte OHNE Artikel ist kein Befund: die weit überwiegende Mehrheit ist von uns
 * gezeichnet und wird nie einen bekommen (Owner: „gibt natürlich auch welche von uns"). Ohne diese
 * Grenze stünden mehrere hundert Karten als „kein Wiki-Schlüssel" in der Liste, und die Liste wäre
 * unbrauchbar -- dieselbe Rechnung wie bei den 2448 automatisch benannten Wegen (§6b).
 *
 * ⚠️ `status = 'approved'`: eine verborgene Karte ist für den Leser nicht da, also ist ihr Anspruch
 * auf einen Artikel auch keine Kollision. Wortgleich zur Literatur eine Funktion weiter oben.
 * ⚠️ KEINE Position: eine Karte liegt nirgends auf der Karte. „Auf der Karte zeigen" entfällt damit
 * für diese Partei, genau wie bei Literatur.
 *
 * @return list<array{type:string,id:string,label:string,wiki_url:string}>
 */
function avesmapsConflictLoadCitymapRows(PDO $pdo): array {
    try {
        // 🔴 `article_origin = 'wiki_publication'` BLEIBT DRAUSSEN, und das ist die tragende Hälfte
        // des Massenlaufs vom 17.08.2026 (api/_internal/wiki/citymap-article-assign.php).
        //
        // Eine so zugewiesene Karte beansprucht NICHT ihren eigenen Artikel, sondern nennt die
        // Publikation, in der sie abgedruckt ist — 363 Karten auf 140 Publikationsseiten. Ohne
        // diesen Ausschluss meldete avesmapsConflictRuleSharedArticle daraus **136 Gruppen mit 482
        // Objekten**, 123 davon gemischt mit dem Literaturwerk, das denselben Artikel trägt, also in
        // der schwersten Stufe (live gerechnet 17.08.2026).
        //
        // ⚠️ Die REGEL wird dabei nicht aufgeweicht: `citymap` gehört weiterhin nicht zu
        // AVESMAPS_CONFLICT_SEGMENTED_TYPES, und eine von HAND gesetzte Kartenzuweisung
        // (`article_origin = 'manual'`) steht nach wie vor voll im Blick — sie behauptet ja auch
        // wirklich, der Artikel sei der eigene. Owner-Entscheid 17.08.2026 gegen die Alternative,
        // das Paar `citymap|game_literature` pauschal freizugeben: „weil ich sehen will, was
        // gesynct und was von uns editiert ist."
        //
        // ⚠️ `article_origin IS NULL` ist VORSORGE, kein heutiger Fall — und das ist nachgemessen,
        // nicht vermutet: die Spalte ist `NOT NULL DEFAULT 'manual'`, MySQL füllt bestehende Zeilen
        // beim ALTER mit 'manual', und fehlt die Spalte ganz, fängt der `catch` unten. Der Zweig
        // steht trotzdem da, weil ein Vergleich gegen NULL weder wahr noch falsch ist: würde die
        // Spalte je nullable, fiele JEDE Karte lautlos aus der Konfliktliste — auch die von Hand
        // zugewiesene. Ein stiller Totalausfall ist einen halben Ausdruck wert.
        $statement = $pdo->query(
            "SELECT public_id, title, article_url FROM citymap
             WHERE status = 'approved' AND article_url IS NOT NULL AND article_url <> ''
               AND (article_origin IS NULL OR article_origin <> 'wiki_publication')"
        );
    } catch (Throwable $exception) {
        // Frische Installation, oder eine, deren self-healing ALTER noch nicht gelaufen ist: die
        // Spalte fehlt dann, und das darf die übrige Liste nicht mitreissen.
        return [];
    }
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $rows[] = [
            'type' => 'citymap',
            'id' => (string) $row['public_id'],
            'label' => $title,
            'subtype' => '',
            'wiki_url' => trim((string) $row['article_url']),
            'position' => null,
            'claim_source' => 'citymap',
        ];
    }

    return $rows;
}

/**
 * First coordinate of a feature as [lat, lng], or null. GeoJSON stores [x, y] = [lng, lat] and
 * Leaflet wants [lat, lng] (AGENTS.md §5) -- swapped here ONCE so no caller has to remember.
 * A line takes its first vertex: good enough to fly the map there.
 */
function avesmapsConflictFirstPosition($geometryJson): ?array {
    $geometry = json_decode((string) ($geometryJson ?? ''), true);
    $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
    while (is_array($coordinates) && isset($coordinates[0]) && is_array($coordinates[0])) {
        $coordinates = $coordinates[0];
    }
    if (!is_array($coordinates) || !isset($coordinates[0], $coordinates[1])) {
        return null;
    }

    return ['lat' => (float) $coordinates[1], 'lng' => (float) $coordinates[0]];
}

/**
 * EXACT wiki page titles, indexed for a per-party lookup: "does an article with THIS object's own
 * name exist?".
 *
 * Deliberately NOT keyed on normalized_key. That key strips the parenthetical suffix, which is
 * precisely what caused Discord #38 -- "Jergan (Wasserfall)" would resolve to the article "Jergan"
 * and the evidence shown to the editor would repeat the very mistake being reviewed. Only a
 * case-folded exact title match answers the question honestly.
 *
 * @return array<string, array{title:string,url:string}>
 */
function avesmapsConflictLoadWikiTitles(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT title, wiki_url FROM wiki_sync_pages
             WHERE title IS NOT NULL AND title <> '' AND wiki_url IS NOT NULL AND wiki_url <> ''"
        );
    } catch (Throwable $exception) {
        return []; // no dump read yet -- the evidence column simply stays empty
    }
    if ($statement === false) {
        return [];
    }

    $index = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = trim((string) $row['title']);
        if ($title === '') {
            continue;
        }
        $index[mb_strtolower($title, 'UTF-8')] = ['title' => $title, 'url' => (string) $row['wiki_url']];
    }

    return $index;
}

/**
 * Rule 1 -- several objects claim the same wiki article.
 *
 * The one legitimate sharing (the segments of a single road) is filtered out in core.php; without
 * that filter this rule would report 1547 correct road segments and be abandoned on sight (§6a).
 *
 * Each party carries its OWN evidence, because the conflict alone is not decidable. Owner, on the
 * live list: "ist Jergan im Wiki? ist Jergan auf der Karte? ist Jergan (Wasserfall) im Wiki? ist
 * Jergan (Wasserfall) auf der Karte -> dann kann ich entscheiden." So every party reports whether an
 * article under its own exact name exists, and where it sits on the map.
 */
function avesmapsConflictRuleSharedArticle(array $rows, array $wikiTitles = []): array {
    $meta = [];
    foreach ($rows as $row) {
        $meta[$row['type'] . '|' . $row['id']] = [
            'position' => $row['position'] ?? null,
            'claim_source' => $row['claim_source'] ?? '',
        ];
    }
    $conflicts = [];
    foreach (avesmapsConflictFindSharedWikiUrls($rows) as $group) {
        $claimedKey = avesmapsConflictArticleKey((string) $group['wiki_url']);
        $parties = array_map(static function (array $party) use ($wikiTitles, $meta, $group, $claimedKey): array {
            $party['type_label'] = AVESMAPS_CONFLICT_TYPE_LABELS[$party['type']] ?? $party['type'];
            $nameKey = mb_strtolower((string) $party['label'], 'UTF-8');
            $own = $wikiTitles[$nameKey] ?? null;
            // wiki_sync_pages holds SETTLEMENT and building pages only. An adventure or a territory
            // is never in there, so the registry lookup alone reported "kein eigener Wiki-Artikel"
            // for every one of them -- while the article plainly exists, which is why the object is
            // in this conflict at all. That is not a cosmetic miss: the evidence line exists to
            // decide by, and it was pointing the editor at the wrong party.
            //
            // The answer needs no registry: if the object's own name IS the title of the article it
            // claims, then that article is its own. In a collision this reads exactly right --
            // the adventure "Tyrannenmord" owns the article "Tyrannenmord", the settlement that
            // also points there does not.
            if ($own === null && $claimedKey !== '' && $nameKey === $claimedKey) {
                $own = [
                    'title' => decodeConflictWikiTitle((string) $group['wiki_url']),
                    'url' => (string) $group['wiki_url'],
                ];
            }
            $party['own_wiki'] = $own;
            $info = $meta[$party['type'] . '|' . $party['id']] ?? [];
            $party['position'] = $info['position'] ?? null;
            // Only a plain-field claim may be cleared from the conflict centre (repair.php).
            $party['claim_source'] = $info['claim_source'] ?? '';
            $party['unlinkable'] = ($info['claim_source'] ?? '') === 'wiki_url';
            return $party;
        }, $group['parties']);
        $title = decodeConflictWikiTitle($group['wiki_url']);
        $conflicts[] = [
            'rule_id' => 'wiki.shared_article',
            'fingerprint' => avesmapsConflictFingerprint('wiki.shared_article', $parties, ['url' => $group['wiki_url']]),
            'severity' => $group['severity'],
            'title' => $title,
            'wiki_url' => $group['wiki_url'],
            'parties' => $parties,
            'subject_type' => $parties[0]['type'] ?? '',
            'subject_id' => $parties[0]['id'] ?? '',
        ];
    }

    return $conflicts;
}

/**
 * REIN: der Wiedererkennungsschluessel einer PARTEIENLISTE -- sortiert, damit die Reihenfolge zweier
 * Abfragen nichts entscheidet (dieselbe Ueberlegung wie in avesmapsConflictFingerprint).
 *
 * @param list<array{type?:string,id?:string}> $parties
 */
function avesmapsConflictPartySetKey(array $parties): string {
    $keys = [];
    foreach ($parties as $party) {
        $type = trim((string) ($party['type'] ?? ''));
        $id = trim((string) ($party['id'] ?? ''));
        if ($type !== '' && $id !== '') {
            $keys[] = $type . '|' . $id;
        }
    }
    sort($keys, SORT_STRING);

    return implode(',', $keys);
}

/**
 * REIN: Der Dubletten-Fall VERDRAENGT die Artikelgruppe, die aus denselben Parteien besteht -- und
 * ERBT deren Entscheidung.
 *
 * 💣 Ohne das Erben waere die Entdopplung ein Datenverlust auf Raten: verschwindet der berechnete
 * Artikelfall, passt eine dazu gespeicherte Entscheidung auf nichts mehr.
 * avesmapsConflictApplyDecisions macht daraus eine „Erledigt"-Historienzeile („Daten repariert"),
 * obwohl niemand etwas repariert hat -- und derselbe Sachverhalt steht sofort als OFFENER Fehler
 * unter der neuen Regel. Genau dafuer gibt es „Genehmigt": der Owner hat am 21.07.2026 beim
 * Maraskansund entschieden, dass zwei Buchten-Labels auf einem Artikel richtig sind (core.php).
 *
 * 🔴 Verdraengt wird NUR bei exakt gleicher Parteienliste. Kommt ein Ort dazu, der denselben Artikel
 * beansprucht, ist das ein zusaetzlicher Befund -- die Dubletten-Regel kennt nur Beschriftungen und
 * saehe ihn nie.
 *
 * ⚠️ Der Fingerabdruck wird HIER dem fertigen Fall entnommen, nicht nachgebaut. Ein Nachbau muesste
 * die Anzeige-URL der Gruppe erraten (avesmapsConflictFindSharedWikiUrls nimmt die des ERSTEN
 * Treffers), und eine andere Schreibweise desselben Links ergaebe einen anderen Schluessel -- die
 * Erbschaft ginge lautlos verloren.
 *
 * @param list<array<string,mixed>> $sharedConflicts
 * @param list<array<string,mixed>> $duplicateConflicts
 * @return array{shared:list<array<string,mixed>>, duplicates:list<array<string,mixed>>}
 */
function avesmapsConflictMergeDuplicateIntoShared(array $sharedConflicts, array $duplicateConflicts): array {
    $duplicateByPartySet = [];
    foreach ($duplicateConflicts as $index => $duplicate) {
        $key = avesmapsConflictPartySetKey($duplicate['parties'] ?? []);
        if ($key !== '') {
            $duplicateByPartySet[$key] = $index;
        }
        $duplicateConflicts[$index]['inherits'] = [];
    }

    $sharedLeft = [];
    foreach ($sharedConflicts as $shared) {
        $key = avesmapsConflictPartySetKey($shared['parties'] ?? []);
        if ($key === '' || !isset($duplicateByPartySet[$key])) {
            $sharedLeft[] = $shared;
            continue;
        }
        $duplicateConflicts[$duplicateByPartySet[$key]]['inherits'][] =
            (string) ($shared['rule_id'] ?? '') . '|' . (string) ($shared['fingerprint'] ?? '');
    }

    return ['shared' => $sharedLeft, 'duplicates' => array_values($duplicateConflicts)];
}

/**
 * Regel 3 -- dieselbe Beschriftung steht zweimal auf der Karte (Discord #83).
 *
 * Ausloeser: „Drei Schwestern" liegt zweimal in `map_features` -- zwei `berggipfel`-Beschriftungen
 * auf demselben Wiki-Schluessel, 2,35 Karteneinheiten auseinander. Eine davon gewinnt die
 * Label-Kollision nie und wird deshalb nie gezeichnet; was nicht gezeichnet ist, laesst sich auf der
 * Karte auch nicht anklicken. Ohne diese Liste gibt es also keinen Weg, sie loszuwerden -- die
 * Owner-Regel von den verwaisten Aussenhuellen, in der zweiten Auflage.
 *
 * 🔴 GELOEST WIRD DAS AN DEN DATEN, NICHT AN DER DARSTELLUNG. Owner 20.08.2026: „berggipfel muessen
 * lesbar sein, das hat nix mit kollisionen zu tun." Zwei Beschriftungen desselben Bergs BEIDE lesbar
 * zu machen waere die falsche Reparatur -- dann stuende der Name zweimal auf der Karte.
 *
 * Die Identitaet und der tragende Rauschfilter stehen in core.php (avesmapsConflictLabelIdentity,
 * avesmapsConflictFindDuplicateLabels), samt der Messung, die sie begruendet.
 *
 * @param list<array{id:string,label:string,subtype:string,wiki_key:string,region:string,position?:mixed}> $rows
 */
function avesmapsConflictRuleDuplicateLabel(array $rows): array {
    $meta = [];
    foreach ($rows as $row) {
        $meta[(string) ($row['id'] ?? '')] = [
            'position' => $row['position'] ?? null,
            'updated_at' => (string) ($row['updated_at'] ?? ''),
            'height_schritt' => $row['height_schritt'] ?? null,
        ];
    }

    $conflicts = [];
    foreach (avesmapsConflictFindDuplicateLabels($rows) as $group) {
        $parties = array_map(static function (array $party) use ($meta): array {
            $region = (string) $party['region'];

            return [
                'type' => 'label',
                'id' => (string) $party['id'],
                'label' => (string) $party['label'],
                'type_label' => AVESMAPS_CONFLICT_TYPE_LABELS['label'],
                'position' => $meta[(string) $party['id']]['position'] ?? null,
                // 🔴 DAS UNTERSCHEIDUNGSMERKMAL. Die Parteien eines Dubletten-Falls sehen einander
                // zum Verwechseln aehnlich -- gleicher Name, gleiche Art, gleicher Artikel. Ohne
                // etwas, woran sie sich unterscheiden, steht der Editor vor zwei gleichen Zeilen mit
                // je einem Loeschknopf und kann gar nicht entscheiden, welche die ueberzaehlige ist.
                // „Zuletzt geaendert" liegt ohnehin in der Zeile und ist die generische Antwort:
                // live traegt die gepflegte „Drei Schwestern" den 20.08.2026, die Karteileiche den
                // 07.08.2026.
                'updated_at' => $meta[(string) $party['id']]['updated_at'] ?? '',
                // 💣 WAS AN DER BESCHRIFTUNG HAENGT, MUSS SICHTBAR SEIN, BEVOR SIE VERSCHWINDET.
                // Ein Gipfel-Label traegt seine Hoehe hier, und das Hoehenfeld der Karte liest GENAU
                // DIESE Labels als Stuetzpunkte (api/_internal/app/terrain-store.php, `is_active = 1`).
                // Live traegt eine der beiden „Drei Schwestern" 2100 Schritt und die andere gar
                // nichts -- wer die falsche loescht, nimmt der Karte einen Hoehenstuetzpunkt, ohne
                // es zu merken. ⚠️ `null` heisst „nicht erfasst" und ist NICHT `0`; dieselbe
                // Trennung wie in readLabelHeightSchritt (map-features-labels.js).
                'height_schritt' => $meta[(string) $party['id']]['height_schritt'] ?? null,
                // 🔴 DIE EINE FRAGE, AN DER DER LOESCHKNOPF HAENGT. Eine Beschriftung, an der eine
                // Landschaftsflaeche haengt, darf von hier aus NIE geloescht werden: entfernt ein
                // Loeschvorgang das letzte Label einer Flaeche, nimmt
                // avesmapsEcosystemCascadeAfterRemoval die ganze Region samt ihren gezeichneten
                // Flaechen mit (weich, aber nichts hier stellt sie wieder her). Am Livebestand hat
                // fast jede Region genau ein Label -- der Ausloesefall IST der Normalfall.
                // ⚠️ Das ist nur die ANZEIGE. Der Riegel steht im Schreibpfad (repair.php) und fragt
                // dort dieselbe Funktion, die auch die Kaskade selbst befragt.
                'ecosystem_region_public_id' => $region,
                'deletable' => $region === '',
            ];
        }, $group['parties']);

        $conflicts[] = [
            'rule_id' => 'label.duplicate',
            // Die Identitaet gehoert in die Fakten: aendert jemand den Wiki-Schluessel einer der
            // beiden, ist es ein anderer Fall -- und eine alte Entscheidung darf ihn nicht decken.
            'fingerprint' => avesmapsConflictFingerprint('label.duplicate', $parties, ['identity' => $group['identity']]),
            'severity' => AVESMAPS_CONFLICT_ERROR,
            'title' => (string) ($parties[0]['label'] ?? ''),
            'wiki_url' => '',
            'parties' => $parties,
            'subject_type' => 'label',
            'subject_id' => (string) ($parties[0]['id'] ?? ''),
        ];
    }

    return $conflicts;
}

/**
 * Rule 2 -- a hand-made object carries no wiki key at all.
 *
 * Owner 2026-07-20: we cannot know whether a wiki counterpart exists, so these need periodic eyes.
 * Auto-named ways are excluded -- a generated "Reichsstrasse-3633" can never match a wiki page, and
 * including them would bury the 1178 hand-named ways under 2448 machine-made ones (§6b).
 */
function avesmapsConflictRuleMissingKey(array $rows, array $wikiTitles = []): array {
    $conflicts = [];
    foreach ($rows as $row) {
        if (trim((string) $row['wiki_url']) !== '') {
            continue;
        }
        if ($row['type'] === 'path' && avesmapsConflictPathNameIsAuto((string) $row['label'], AVESMAPS_CONFLICT_PATH_SUBTYPES)) {
            continue;
        }
        // Ein Editor hat festgehalten, dass es im Wiki nichts dazu gibt (Knopf "Kein Wiki-Eintrag",
        // oder das Haekchen im Kraftlinien-Editor). Das IST die Antwort auf "kein Wiki-Schluessel",
        // also gehoert der Fall nicht mehr auf die Beobachtungsliste. Bis 15.08.2026 las diese
        // Regel den Merker fuer KEINE Objektart -- eine stillgelegte Kraftlinie kam deshalb zurueck.
        if (!empty($row['no_article'])) {
            continue;
        }
        // The same evidence the shared-article rule shows, for the same reason: without it this is a
        // list of names nobody can act on. And the wiki lookup is what splits the watchlist into the
        // two halves §6b calls for -- "there IS a candidate" (actionable: link it) versus "there is
        // none" (nothing to do but keep an eye on it).
        $party = [
            'type' => $row['type'],
            'id' => $row['id'],
            'label' => $row['label'],
            'type_label' => AVESMAPS_CONFLICT_TYPE_LABELS[$row['type']] ?? $row['type'],
            'position' => $row['position'] ?? null,
            'own_wiki' => $wikiTitles[mb_strtolower((string) $row['label'], 'UTF-8')] ?? null,
        ];
        $conflicts[] = [
            'rule_id' => 'wiki.missing_key',
            'fingerprint' => avesmapsConflictFingerprint('wiki.missing_key', [$party]),
            // §6b: ein Fall MIT Kandidat ist handlungsfaehig (verknuepfen), einer ohne bleibt reine
            // Beobachtung. Ohne diese Trennung waeren alle 2000 gleich dringend -- also keiner.
            'severity' => $party['own_wiki'] !== null ? AVESMAPS_CONFLICT_DIVERGENCE : AVESMAPS_CONFLICT_UNVERIFIED,
            'title' => (string) $row['label'],
            'wiki_url' => '',
            'parties' => [$party],
            'subject_type' => $row['type'],
            'subject_id' => $row['id'],
        ];
    }

    return $conflicts;
}

/**
 * A named way is ONE case, not one per segment: "Reichslandstraße von Havena nach Abilacht" runs
 * across 20 segments but is a single decision. Collapses same-name conflicts of one rule.
 *
 * 💣 Gilt fuer Wege UND Kraftlinien -- beide sind dieselbe 1-zu-N-Form (viele Segmente, ein
 * Lore-Name; api/_internal/wiki/powerlines.php sagt woertlich "the same 1-to-N shape roads have").
 * Solange nur 'path' zusammengefasst wurde, stand "Satinavs Kette I" sechsmal untereinander in der
 * Liste; live am 15.08.2026 waren 75 Kraftlinien-Segmente in Wahrheit 37 Entscheidungen
 * (Discord-Fall #71). Ein Typ ohne Segmente -- Ort, Region, Territorium -- laeuft unveraendert
 * durch und bekommt KEINEN 'segments'-Schluessel.
 */
function avesmapsConflictCollapseSegmentsByName(array $conflicts): array {
    // Index map instead of PHP array references -- references into arrays are a well-known footgun
    // (they survive the loop and quietly alias later writes), and this list is user-visible.
    $out = [];
    $indexByName = [];
    foreach ($conflicts as $conflict) {
        $parties = $conflict['parties'] ?? [];
        $isSingleSegmented = count($parties) === 1
            && in_array($parties[0]['type'] ?? '', AVESMAPS_CONFLICT_SEGMENTED_TYPES, true);
        if (!$isSingleSegmented) {
            $out[] = $conflict;
            continue;
        }
        $key = (string) ($conflict['rule_id'] ?? '') . '|' . mb_strtolower((string) $parties[0]['label'], 'UTF-8');
        if (isset($indexByName[$key])) {
            $out[$indexByName[$key]]['segments']++;
            continue;
        }
        $conflict['segments'] = 1;
        $out[] = $conflict;
        $indexByName[$key] = count($out) - 1;
    }

    return $out;
}

function decodeConflictWikiTitle(string $wikiUrl): string {
    if (preg_match('~/wiki/([^?#]+)~i', $wikiUrl, $match) === 1) {
        return str_replace('_', ' ', rawurldecode($match[1]));
    }

    return $wikiUrl;
}

/**
 * Registry. Order is display order.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsConflictRuleCatalog(): array {
    return [
        [
            'id' => 'wiki.shared_article',
            'label' => 'Mehrere Objekte beanspruchen denselben Wiki-Artikel',
            // Owner 2026-07-21: kein Absolutsatz. Der Erkenner findet die Ueberschneidung, ob sie
            // richtig oder falsch ist, entscheidet der Mensch -- deshalb "sollte prinzipiell", und
            // "Genehmigt" ist genau fuer die Ausnahmen da.
            'hint' => 'Ein Wiki-Artikel sollte prinzipiell nur zu einem Objekt gehören. Es gibt natürlich Ausnahmen, trotzdem lohnt sich ein Blick auf potentielle Konflikte. Segmente einer Straße sind ausgenommen und tauchen hier gar nicht erst auf.',
            'severity' => AVESMAPS_CONFLICT_ERROR,
            'actions' => ['pick_one', 'unlink', 'defer', 'ignore'],
            // What each button DOES. The difference between "Trennen" and "Kein Wiki-Eintrag" is not
            // cosmetic: only the second one sticks, because the enrichment keeps proposing a link for
            // any name it can match. Without this spelled out, an editor picks the weaker verb and
            // the link quietly returns -- which is Discord #38 all over again.
            // 🔴 Die REICHWEITE gehört in jeden dieser Sätze (Owner 15.08.2026). Ein Weg und eine
            // Kraftlinie sind viele Zeilen mit einem Namen, und seit dem 15.08.2026 fasst jeder
            // dieser Knöpfe die ganze Linie — „Nur dieses Objekt“ war danach schlicht falsch. Wer
            // erst nach dem Klick erfährt, dass er 26 Segmente bewegt hat, hat keine Entscheidung
            // getroffen, sondern eine Überraschung erlebt.
            'verbs' => [
                ['label' => 'Behält den Link', 'effect' => 'Dieses Objekt bleibt mit dem Artikel verknüpft, alle anderen in diesem Fall verlieren ihre Verknüpfung. Bei einem Weg oder einer Kraftlinie gilt beides für die ganze Linie: der Behalter behält sie mit allen seinen Segmenten, die anderen verlieren sie mit allen ihren.'],
                ['label' => 'Trennen', 'effect' => 'Dieses Objekt verliert die Verknüpfung — bei einem Weg oder einer Kraftlinie die ganze Linie mit allen ihren Segmenten, bei Orten, Regionen und Territorien nur dieses eine Objekt. Achtung: Trägt es einen Namen, der zu einem Wiki-Artikel passt, kann der Server ihn später erneut vorschlagen.'],
                ['label' => 'Kein Wiki-Eintrag', 'effect' => 'Trennt UND hält fest, dass es im Wiki nichts dazu gibt — bei einem Weg oder einer Kraftlinie für die ganze Linie, sonst für dieses eine Objekt. Nur so bleibt die Trennung dauerhaft — nichts wird mehr vorgeschlagen.'],
                ['label' => 'Genehmigt', 'effect' => 'Der Fund stimmt, die Lage ist aber richtig so — etwa ein Meer aus zwei Buchten, die beide beschriftet werden müssen. Ändert die Daten nicht und taucht nicht wieder unter „Wichtig“ auf.'],
                ['label' => 'Zurückstellen / Archivieren', 'effect' => 'Ändern die Daten nicht. Zurückgestellt heißt „später“, archiviert heißt „bewusst so gelassen, aber weiterhin falsch“ — beides bleibt auffindbar und umkehrbar.'],
            ],
        ],
        [
            'id' => 'wiki.missing_key',
            'label' => 'Kein Wiki-Schlüssel',
            // Owner 2026-07-21: nicht als Vorwurf formulieren -- von Hand anlegen ist erlaubt und
            // normal. Die Liste sagt nur, wo noch niemand nachgesehen hat.
            // Der Abgrenzungssatz steht in BEIDEN Gruppen, jeweils auf die andere zeigend: sie lesen
            // sich zum Verwechseln aehnlich, und die Frage kam prompt (Owner 2026-07-21).
            'hint' => 'Objekte können ohne weitere Informationen von Hand angelegt werden. Falls es im Wiki aber kein Gegenstück gibt, wird es hier gelistet. Unterschied zu „Keine Zuordnung gefunden“: hier fehlt nur der Link — dort wurde bereits im Wiki gesucht.',
            'severity' => AVESMAPS_CONFLICT_UNVERIFIED,
            'actions' => ['defer', 'ignore'],
            'verbs' => [
                // Der einzige Knopf dieser Gruppe, der Daten schreibt -- er fehlte in dieser Liste,
                // und seit dem 15.08.2026 reicht er über die ganze Linie. Genau hier ist die
                // Reichweite am wenigsten zu erraten: die Fälle sind nach Namen zusammengefasst,
                // am Knopf steht also „6 Segmente“, und der Klick meint sie auch alle.
                ['label' => 'Artikel übernehmen', 'effect' => 'Verknüpft dieses Objekt mit dem gefundenen Artikel — bei einem Weg oder einer Kraftlinie alle Segmente der Linie, sonst dieses eine Objekt. Teile, die bereits eine Verknüpfung tragen, bleiben unangetastet und werden hinterher genannt.'],
                ['label' => 'Zurückstellen', 'effect' => 'Nimmt den Eintrag aus „Offen“, holt ihn aber zurück, sobald sich am Objekt etwas ändert.'],
                ['label' => 'Archivieren', 'effect' => 'Bewusst so gelassen. Bleibt unter „Archiviert“ auffindbar und lässt sich jederzeit wieder öffnen.'],
            ],
        ],
        [
            'id' => 'label.duplicate',
            'label' => 'Dieselbe Beschriftung zweimal',
            // Der Anlass in einem Satz, plus der Grund, warum das hier steht und nicht auf der
            // Karte gelöst wird: eine Beschriftung, die die Kollision verliert, wird nicht
            // gezeichnet — und was nicht gezeichnet ist, lässt sich nicht anklicken.
            'hint' => 'Zwei oder mehr Beschriftungen meinen dasselbe Ding: gleicher Wiki-Artikel, gleicher Name, gleiche Art. Eine davon steht auf der Karte meist gar nicht sichtbar und ist dort auch nicht anklickbar — deshalb lässt sie sich hier entfernen. Mehrere Beschriftungen EINER Landschaftsfläche sind kein Fall: ein langes Gebirge darf seinen Namen mehrfach tragen.',
            'severity' => AVESMAPS_CONFLICT_ERROR,
            'actions' => ['delete_label', 'defer', 'ignore'],
            'verbs' => [
                ['label' => 'Beschriftung löschen', 'effect' => 'Nimmt GENAU DIESE eine Beschriftung von der Karte (umkehrbar über den Änderungs-Log, wie jedes Löschen im Editor). Die anderen des Falls bleiben stehen, und die letzte verbleibende lässt sich nicht löschen.'],
                ['label' => 'gehört zu einer Landschaftsfläche', 'effect' => 'Kein Knopf, sondern der Grund, warum hier keiner steht: an dieser Beschriftung hängt eine gezeichnete Fläche. Wäre sie deren letzte, verschwände die ganze Fläche mit ihr — das gehört in den Landschaften-Editor, nicht hierher.'],
                ['label' => 'Genehmigt', 'effect' => 'Der Fund stimmt, die Lage ist aber richtig so. Ändert die Daten nicht und taucht nicht wieder unter „Wichtig“ auf.'],
                ['label' => 'Zurückstellen / Archivieren', 'effect' => 'Ändern die Daten nicht. Zurückgestellt heißt „später“, archiviert heißt „bewusst so gelassen, aber weiterhin doppelt“ — beides bleibt auffindbar und umkehrbar.'],
            ],
        ],
    ];
}

/**
 * Jede aktive Beschriftung mit ihrer Identitaet und ihrer Landschaftsflaeche -- roh gelesen, ohne
 * jede Anreicherung.
 *
 * 💣 Gelesen wird `properties.wiki_region.wiki_key`, NICHT das schlichte `wiki_url` daneben. Der
 * Lesepfad der Karte raet bei leerem Feld eine Adresse per Namen dazu (avesmapsEnrichMapFeatureWikiUrl);
 * der Schluessel im Nest ist dagegen das, was ein Abgleich oder ein Editor wirklich zugewiesen hat.
 * Dieselbe Trennung wie beim Statuskreis der Listen (AGENTS.md §11).
 *
 * Die Flaechenzugehoerigkeit kommt aus avesmapsEcosystemReadLabelRegionMap() -- EIN Buendel-Lesen fuer
 * alle Beschriftungen statt einer Abfrage je Zeile, und aus BEIDEN gespeicherten Richtungen.
 *
 * @return list<array{id:string,label:string,subtype:string,wiki_key:string,region:string,position:mixed}>
 */
function avesmapsConflictLoadLabelRows(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, feature_subtype, properties_json, geometry_json, updated_at
         FROM map_features
         WHERE is_active = 1 AND feature_type = 'label'"
    );
    if ($statement === false) {
        return [];
    }

    $regionByLabel = avesmapsEcosystemReadLabelRegionMap($pdo)['by_label'] ?? [];

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? '{}'), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        $rows[] = [
            'id' => $publicId,
            'label' => trim((string) ($row['name'] ?? '')),
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'wiki_key' => trim((string) ($properties['wiki_region']['wiki_key'] ?? '')),
            'region' => trim((string) ($regionByLabel[$publicId] ?? '')),
            'position' => avesmapsConflictFirstPosition($row['geometry_json'] ?? null),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
            // Spiegel von avesmapsReadOptionalPeakHeight() -- der Schreibpfad besitzt die Regel,
            // hier muss sie nur damit uebereinstimmen: eine Zahl > 0, sonst „nicht erfasst".
            'height_schritt' => is_numeric($properties['height_schritt'] ?? null)
                && (float) $properties['height_schritt'] > 0.0
                ? (float) $properties['height_schritt']
                : null,
        ];
    }

    return $rows;
}

/**
 * Run every rule and return the raw conflict list (undecided -- the store joins the decisions in).
 */
function avesmapsConflictDetectAll(PDO $pdo): array {
    $rows = avesmapsConflictLoadMapRows($pdo);
    $wikiTitles = avesmapsConflictLoadWikiTitles($pdo);
    // The collision rule sees EVERYTHING that claims an article -- map, territories, adventures,
    // citymaps -- because the wiki namespace is global (§6a). The watchlist rule stays on map
    // features: a territory without a wiki key is a different question with a different answer, und
    // eine Karte ohne Artikel ist gar keine Frage (die meisten sind von uns gezeichnet).
    // 🔴 Hier steht bewusst KEINE ZAHL. Wer eine Objektart ergänzt, ergänzt sie in DIESER Liste --
    // eine Aufzählung mit „drei Quellen" davor liest sich wie eine vollständige Liste, und niemand
    // zählt nach (AGENTS.md §11, die Verkehrsmittel-Sperre).
    $claimRows = array_merge(
        $rows,
        avesmapsConflictLoadTerritoryRows($pdo),
        avesmapsConflictLoadGameLiteratureRows($pdo),
        avesmapsConflictLoadCitymapRows($pdo)
    );
    // 🔴 ZUERST die Dubletten, denn sie entscheiden mit, was die Artikel-Regel noch melden darf:
    // zwei Beschriftungen desselben Dings tragen dieselbe Adresse und stuenden sonst zweimal in der
    // Liste, das zweite Mal mit Knoepfen, die den doppelten Namen nicht loswerden.
    $duplicateLabels = avesmapsConflictRuleDuplicateLabel(avesmapsConflictLoadLabelRows($pdo));

    // Die Artikelgruppe, die aus GENAU denselben Parteien besteht, wird vom Dubletten-Fall
    // verdraengt -- und ihre Entscheidung wandert mit. Beides in EINEM Schritt, weil der echte
    // Fingerabdruck der verdraengten Gruppe nur hier vorliegt (nachbauen ginge daneben).
    $zusammengefuehrt = avesmapsConflictMergeDuplicateIntoShared(
        avesmapsConflictRuleSharedArticle($claimRows, $wikiTitles),
        $duplicateLabels
    );

    $conflicts = array_merge(
        $zusammengefuehrt['shared'],
        avesmapsConflictCollapseSegmentsByName(avesmapsConflictRuleMissingKey($rows, $wikiTitles)),
        $zusammengefuehrt['duplicates']
    );

    return $conflicts;
}
