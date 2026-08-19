<?php

declare(strict_types=1);

// Öffentlicher Lesezugriff auf Flora, Fauna, Spezies und Handelswaren.
// Design: docs/flora-fauna-handelswaren-design.md.
//
// GET /api/app/lore.php?place=<wiki_key>[&full=1][&area=<public_id[,public_id,…]>
//                                                 |&location=<public_id>|&territory=<public_id>]
//     -> { ok:true, place:"...", sections:{flora:[…],fauna:[…],spezies:[…],ware:[…]},
//          counts:{flora:n,…}, total:n, limit:10, truncated:false }
//     full=1 liefert die vollständigen Listen (für den „alle anzeigen"-Dialog).
//     area/location/territory (Sitzung 3, Lebensraum-Regel): zusaetzlich zu den genannten Orten
//     liefern diese Parameter die Eintraege, deren REGEL sie treffen -- dieselben sections, rank 1.
//     🔴 Feste Rangfolge, HOECHSTENS EINER wirkt: area vor location vor territory. Zwei gleichzeitig
//     ist ein Programmfehler des Aufrufers, kein Sonderfall -- der erste gewinnt.
//     area nimmt eine KOMMALISTE von Regions-public_id (Task 9: ein Weg oder eine Etappe beruehrt
//     mehrere Flaechen; ihre Treffer werden VEREINIGT, nicht geschnitten). truncated meldet, ob mehr
//     als AVESMAPS_LORE_RULE_AREA_LIMIT (25) genannt wurden -- nie eine stille Kappung.
//     territory nimmt die public_id EINES Herrschaftsgebiets; der Server loest dessen Flaechen
//     selbst auf (ecosystem_region_territory), denn ein Gebiet kennt seine Regions-IDs nicht.
//
// GET /api/app/lore.php?stats=1
//     -> { ok:true, stats:{ entries:{…}, entries_total, places, sources, top_places:[…] } }
//     Der Abnahmetest nach einem Sync. Erwartung aus dem verifizierten Dump-Scan:
//     5.104 Einträge, 7.748 Ortsverknüpfungen, 34.933 Quellen.
//
// Kein Auth (öffentliche Karte, wie map-features/adventures). Envelope = gold contract.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/lore.php';
// avesmapsAppSettingGet für den „zuletzt gesynct"-Zeitstempel.
require_once __DIR__ . '/../_internal/app/app-setting.php';
// avesmapsPoliticalSlug für die Ortsschlüssel der Regionsbrücke (geographic-Feld).
require_once __DIR__ . '/../_internal/political/territory.php';
// avesmapsWikiSyncCreateMatchKey für die Warenauflösung. NICHT nachbauen: die Funktion
// strippt Klammerzusätze, faltet ß/æ/œ/ø/ð/þ, transliteriert per iconv und wirft
// Apostrophe wie Bindestriche weg -- eine Eigenbau-Variante trifft die beim Sync
// geschriebenen match_key-Werte nicht zuverlässig.
require_once __DIR__ . '/../_internal/wiki/sync.php';
// avesmapsLoreRuleReadSubjectForArea/-Location/avesmapsLoreRuleReadSubjectsForAreas/-Territory +
// avesmapsLoreRuleEntriesForSubject(s) fuer ?area=/?location=/?territory= (Lebensraum-Regel,
// Sitzung 3 + Task 9). Bindet climate-membership.php, lore-rule.php und lore-rule-store.php selbst
// mit ein.
require_once __DIR__ . '/../_internal/app/lore-rule-match.php';

// Task 9, Schritt 1: bis zu AVESMAPS_LORE_RULE_AREA_LIMIT (25) Regionen als Kommaliste -- 36
// Zeichen je UUID + Komma braucht bei 25 Stueck rund 925 Zeichen. Der Wert hier ist NUR eine
// Sicherung gegen absurd lange Eingaben, kein zweiter Deckel: die eigentliche, SICHTBARE Grenze
// (25, mit truncated-Zeichen) sitzt in avesmapsLoreRuleReadSubjectsForAreas -- dieser Wert liegt
// bequem darueber, damit er praktisch nie zuerst greift.
const AVESMAPS_LORE_AREA_PARAMETER_MAX_LENGTH = 1200;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load lore.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for lore.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // Diagnose: zeigt, wie ein Ortsschlüssel expandiert wird und woran die beiden
    // Hierarchietabellen gerade stehen. Read-only, keine Geheimnisse -- aber die
    // einzige Möglichkeit, eine leere Aggregation von einer kaputten zu unterscheiden,
    // ohne DB-Zugang.
    if (isset($_GET['expand'])) {
        $probe = mb_strtolower(trim((string) $_GET['expand']), 'UTF-8');
        $counts = ['wiki_territory_model' => -1, 'political_territory_wiki_geographic' => -1, 'lore_place_distinct' => -1];
        try {
            $counts['wiki_territory_model'] = (int) $pdo->query('SELECT COUNT(*) FROM wiki_territory_model')->fetchColumn();
        } catch (Throwable) {
        }
        try {
            $counts['political_territory_wiki_geographic'] = (int) $pdo->query(
                'SELECT COUNT(*) FROM political_territory_wiki WHERE geographic IS NOT NULL AND geographic <> \'\''
            )->fetchColumn();
        } catch (Throwable) {
        }
        try {
            $counts['lore_place_distinct'] = (int) $pdo->query('SELECT COUNT(DISTINCT place_wiki_key) FROM lore_place')->fetchColumn();
        } catch (Throwable) {
        }
        $samples = [];
        try {
            $samples['territory_model'] = $pdo->query('SELECT wiki_key, parent_wiki_key FROM wiki_territory_model LIMIT 3')
                ->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable) {
        }
        try {
            $samples['geographic'] = $pdo->query(
                'SELECT wiki_key, geographic FROM political_territory_wiki
                 WHERE geographic IS NOT NULL AND geographic <> \'\' LIMIT 3'
            )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable) {
        }
        $expanded = $probe !== '' ? avesmapsLoreExpandPlaceKeys($pdo, $probe) : [];
        avesmapsJsonResponse(200, [
            'ok' => true,
            'probe' => $probe,
            'expanded_count' => count($expanded),
            'expanded_sample' => array_slice($expanded, 0, 25, true),
            'table_counts' => $counts,
            'samples' => $samples,
        ]);
    }

    // Katalogliste für den Editor-Reiter: ?catalog=1[&kind=fauna][&q=…][&limit=][&offset=]
    if (isset($_GET['catalog'])) {
        $kind = mb_strtolower(trim((string) ($_GET['kind'] ?? '')), 'UTF-8');
        $query = trim((string) ($_GET['q'] ?? ''));
        $limit = (int) ($_GET['limit'] ?? 200);
        $offset = (int) ($_GET['offset'] ?? 0);
        // Trichter-Facetten: Kontinent/Herkunft mehrwertig (|-getrennt, gedeckelt); Ortsangabe/
        // Quelle dreiwertig (1 = nur mit, 0 = nur ohne, fehlt/leer = egal).
        $continents = array_slice(array_values(array_filter(
            array_map('trim', explode('|', (string) ($_GET['continent'] ?? ''))),
            static fn ($value) => $value !== ''
        )), 0, 20);
        $origins = array_slice(array_values(array_filter(
            array_map('trim', explode('|', (string) ($_GET['origin'] ?? ''))),
            static fn ($value) => $value !== ''
        )), 0, 20);
        $hasPlace = null;
        if (array_key_exists('has_place', $_GET) && (string) $_GET['has_place'] !== '') {
            $hasPlace = (string) $_GET['has_place'] === '1' ? 1 : 0;
        }
        $hasSource = null;
        if (array_key_exists('has_source', $_GET) && (string) $_GET['has_source'] !== '') {
            $hasSource = (string) $_GET['has_source'] === '1' ? 1 : 0;
        }
        // „Auf Karte" (auffindbar|offen|nicht zugewiesen) und „Vorkommen ueber" (alle|orte|regeln),
        // Owner 18.08.2026. Beide einwertig; ein unbekannter Wert heisst „ohne Einschraenkung" --
        // ein 400 waere hier ueberzogen, die Liste ist ein Trichter, kein Vertrag.
        // 💣 Die DREI ZUSTAENDE heissen im Code wie ueberall `voll|halb|leer`; die Beschriftungen
        //    des Owners stehen NUR in der Oberflaeche (js/review/review-wiki-sync.js). Dieselbe
        //    Trennung wie bei „Neuigkeiten"/`changelog`: Wort gewandert, Kennung nicht.
        $mapStatus = avesmapsNormalizeSingleLine((string) ($_GET['map_status'] ?? ''), 12);
        $mapStatus = in_array($mapStatus, AVESMAPS_LORE_MAP_STATUSES, true) ? $mapStatus : null;
        $sourceKind = avesmapsNormalizeSingleLine((string) ($_GET['source_kind'] ?? ''), 12);
        $sourceKind = in_array($sourceKind, ['orte', 'regeln'], true) ? $sourceKind : null;
        $catalog = avesmapsLoreReadCatalog(
            $pdo, $kind, $query, $limit, $offset, $continents, $origins, $hasPlace, $hasSource,
            $mapStatus, $sourceKind
        );
        avesmapsJsonResponse(200, [
            'ok' => true,
            'kind' => $kind,
            'q' => $query,
            'items' => $catalog['items'],
            'total' => $catalog['total'],
            // Unterscheidet „nichts gefunden" von „Abfrage fehlgeschlagen". Ohne das
            // sieht ein kaputter Filter aus wie ein leerer Bestand.
            'failed' => (bool) ($catalog['failed'] ?? false),
            'offset' => max(0, $offset),
            // Bestand ALLER Arten, damit die Unterreiter ihre Zahlen sofort tragen und
            // nicht erst, nachdem man sie einzeln angeklickt hat.
            'counts_by_kind' => avesmapsLoreCountsByKind($pdo),
            // Trichter-Optionen (Werte + Zaehler); leer auf Scroll-Folgeseiten (offset > 0).
            'continents' => $catalog['continents'] ?? [],
            'origins' => $catalog['origins'] ?? [],
            // Zeitpunkt des letzten scharfen Syncs für die Zeile neben dem Knopf.
            'last_synced' => avesmapsLoreReadLastSynced($pdo),
            // Zustand der vier Menueband-Schalter, damit sie beim Oeffnen sofort richtig
            // stehen und nicht erst nach dem ersten Klick.
            'kinds_enabled' => avesmapsLoreEnabledKinds($pdo),
        ]);
    }

    if (isset($_GET['stats'])) {
        avesmapsJsonResponse(200, ['ok' => true, 'stats' => avesmapsLoreReadStats($pdo)]);
    }

    // Mehrere Orte sind erlaubt (kommagetrennt): Abschnitt 3 reicht hier die
    // Territorienkette herein, ohne dass sich der Vertrag ändert.
    // ?title= nimmt WIKI-TITEL statt fertiger Schlüssel und sluggt sie hier.
    // 💣 Das ist kein Komfort, sondern nötig: avesmapsPoliticalSlug transliteriert per
    // iconv und verschluckt dabei Umlaute („Königreich" -> „k-nigreich"). Der Client
    // kann das nicht nachbilden, also darf er es gar nicht erst versuchen -- sonst
    // trifft jeder Ort mit Umlaut ins Leere.
    $titleParameter = trim((string) ($_GET['title'] ?? ''));
    $placeParameter = trim((string) ($_GET['place'] ?? ''));
    if ($titleParameter !== '') {
        $fromTitles = [];
        foreach (explode('|', $titleParameter) as $title) {
            $slug = avesmapsLoreSlugForTitle(trim($title));
            if ($slug !== '') {
                $fromTitles[] = $slug;
            }
        }
        $placeParameter = trim($placeParameter . ',' . implode(',', $fromTitles), ',');
    }
    $placeKeys = [];
    foreach (explode(',', $placeParameter) as $candidate) {
        $candidate = trim($candidate);
        // Der Wert landet in einer vorbereiteten Abfrage, aber ein Schlüssel besteht
        // nun einmal aus [a-z0-9-]; alles andere ist Unsinn und fliegt sofort raus.
        if ($candidate !== '' && preg_match('/^[a-z0-9_-]{1,190}$/i', $candidate) === 1) {
            $placeKeys[] = mb_strtolower($candidate, 'UTF-8');
        }
    }
    // Lebensraum-Regel (Sitzung 3, Task 4b; Task 9 fuegt territory hinzu): ?area=<public_id[,…]>,
    // ?location=<public_id> oder ?territory=<public_id> ist ein ebenso brauchbarer Anfragegrund wie
    // ein Ortsschluessel -- genau fuer Orte OHNE Wiki-Artikel (2.885 von 4.883 Siedlungen, gemessen)
    // wurde die Regel erfunden. Hier lesen, NICHT nochmal weiter unten aus $_GET: dieselben Werte an
    // beiden Stellen, keine zweite Quelle. (string)-Cast VOR avesmapsNormalizeSingleLine: ihr
    // Parameter ist ?string, und ein ?area[]=x wuerde als PHP-Array sonst einen TypeError werfen
    // statt einen leeren/harmlosen Wert zu liefern -- derselbe Cast wie bei jedem anderen
    // $_GET-Wert in dieser Datei.
    // 🔴 Feste Rangfolge, HOECHSTENS EINER wirkt: area vor location vor territory. Zwei gleichzeitig
    // ist ein Programmfehler des Aufrufers, kein Sonderfall -- der erste gewinnt, die anderen werden
    // gar nicht erst gelesen.
    $areaParameter = avesmapsNormalizeSingleLine((string) ($_GET['area'] ?? ''), AVESMAPS_LORE_AREA_PARAMETER_MAX_LENGTH);
    $locationParameter = $areaParameter === ''
        ? avesmapsNormalizeSingleLine((string) ($_GET['location'] ?? ''), 36)
        : '';
    $territoryParameter = ($areaParameter === '' && $locationParameter === '')
        ? avesmapsNormalizeSingleLine((string) ($_GET['territory'] ?? ''), 36)
        : '';
    if (!avesmapsLoreRequestHasSubject(implode(',', $placeKeys), $areaParameter, $locationParameter, $territoryParameter)) {
        avesmapsErrorResponse(400, 'place_invalid', 'Parameter "place", "area", "location" or "territory" holds no usable value.');
    }

    // ?goods=Vieh|Holz|Salz -- freie Warennamen aus der Infobox-Zeile „Handelswaren",
    // die der Client mit den katalogisierten Waren zu EINER Liste verschmelzen will.
    // Antwort enthält nur die Namen, zu denen es wirklich einen Artikel gibt.
    $resolvedGoods = [];
    $goodsOrder = [];
    $goodsParameter = trim((string) ($_GET['goods'] ?? ''));
    if ($goodsParameter !== '') {
        foreach (explode('|', $goodsParameter) as $name) {
            $name = trim($name);
            if ($name !== '' && !in_array($name, $goodsOrder, true)) {
                $goodsOrder[] = $name;
            }
        }
        $goodsOrder = array_slice($goodsOrder, 0, 60);
        $resolvedGoods = avesmapsLoreResolveGoodsByName($pdo, $goodsOrder);
    }

    $full = isset($_GET['full']) && (string) $_GET['full'] !== '0';
    // Abschnitt 3: den angefragten Ort um Unter- und Obergebiete erweitern, damit
    // Weiden auch zeigt, was in der Baronie Moosgrund gehandelt wird. Der niedrigste
    // (spezifischste) Rang gewinnt, wenn mehrere Wege auf denselben Ort führen.
    // ⚠️ PERF: die Expansion liest zwei Hierarchietabellen komplett. Bei den aktuellen
    // Größen ist das vertretbar; wächst der Territorienbestand deutlich, gehört hier
    // ein Cache hin (die Bäume ändern sich nur beim Sync, nicht pro Aufruf).
    $ranks = [];
    foreach ($placeKeys as $key) {
        foreach (avesmapsLoreExpandPlaceKeys($pdo, $key) as $expandedKey => $rank) {
            if (!isset($ranks[$expandedKey]) || $rank < $ranks[$expandedKey]) {
                $ranks[$expandedKey] = $rank;
            }
        }
    }
    if ($ranks === []) {
        foreach ($placeKeys as $key) {
            $ranks[$key] = 0;
        }
    }

    $result = avesmapsLoreReadForPlaces($pdo, array_keys($ranks), $full ? 0 : AVESMAPS_LORE_PANEL_LIMIT, $ranks);

    // Lebensraum-Regel (Sitzung 3; Task 9 fuegt territory + mehrere Regionen hinzu): dieselben
    // $areaParameter/$locationParameter/$territoryParameter wie beim Torwaechter oben -- nicht
    // zweimal aus $_GET lesen. Liefert zusaetzlich die Eintraege, deren REGEL diese Flaeche(n) /
    // diesen Ort / dieses Gebiet trifft -- dieselben sections, rank 1.
    // 💣 Ein Deckel, aber kein stiller (siehe AVESMAPS_LORE_RULE_AREA_LIMIT): truncated reist bis
    // in die Antwort, damit ein Aufrufer mit zu vielen Flaechen es SEHEN kann, statt lautlos einen
    // Teil seiner Treffer zu verlieren.
    $ruleTruncated = false;
    if ($areaParameter !== '' || $locationParameter !== '' || $territoryParameter !== '') {
        // 🔴 Stempel VOR jeder Regelrechnung pruefen, mit einem NACKTEN SELECT -- nie ueber
        // avesmapsEcosystemEnsureTables (dessen information_schema-Sonden sind die Last, die den
        // PHP-Worker-Pool am 17.07.2026 erschoepft hat, AGENTS.md §10). completed = 0 heisst:
        // waehrend eines "Zugehoerigkeit rechnen"-Laufs sind die Regeltabellen leer -- dann laeuft
        // GAR KEIN Regelzweig, kein leerer Abschnitt, keine Zeile (ein leerer Abschnitt laese sich
        // wie "hier waechst nichts").
        $stampCompleted = false;
        try {
            $stampStatement = $pdo->query('SELECT completed FROM ecosystem_assignment_stamp WHERE id = 1');
            $stampValue = $stampStatement === false ? false : $stampStatement->fetchColumn();
            $stampCompleted = $stampValue !== false && (int) $stampValue === 1;
        } catch (Throwable) {
            $stampCompleted = false; // Tabelle fehlt (nie gerechnet) -> kein Regelzweig, kein 500
        }

        if ($stampCompleted) {
            $subjects = [];
            if ($areaParameter !== '') {
                // Task 9, Schritt 1: MEHRERE Regionen -- Weg und Etappe beruehren mehr als eine.
                // Jede wird ihr eigenes Subjekt; avesmapsLoreRuleEntriesForSubjects unten vereinigt
                // ihre Treffer (nicht schneidet sie -- ein Weg durch Wald UND Gebirge zeigt beides).
                $areaIds = [];
                foreach (explode(',', $areaParameter) as $candidate) {
                    $candidate = trim($candidate);
                    if ($candidate !== '' && !in_array($candidate, $areaIds, true)) {
                        $areaIds[] = $candidate;
                    }
                }
                $areasResult = avesmapsLoreRuleReadSubjectsForAreas($pdo, $areaIds);
                $subjects = $areasResult['subjects'];
                $ruleTruncated = $areasResult['truncated'];
            } elseif ($locationParameter !== '') {
                $locationSubject = avesmapsLoreRuleReadSubjectForLocation($pdo, $locationParameter);
                $subjects = $locationSubject !== null ? [$locationSubject] : [];
            } else {
                // Task 9, Schritt 2: das Gebiet selbst hat keine Regions-IDs -- der Server loest sie
                // ueber ecosystem_region_territory auf und macht daraus dieselben Subjekte wie oben.
                $territoryResult = avesmapsLoreRuleReadSubjectsForTerritory($pdo, $territoryParameter);
                $subjects = $territoryResult['subjects'];
                $ruleTruncated = $territoryResult['truncated'];
            }

            if ($subjects !== []) {
                $ruleHits = avesmapsLoreRuleEntriesForSubjects($pdo, $subjects);
                if ($ruleHits !== []) {
                    $activeKinds = array_keys(array_filter(avesmapsLoreEnabledKinds($pdo)));
                    $ruleRows = avesmapsLoreReadEntriesForRuleHits($pdo, $ruleHits, $activeKinds);
                    $result = avesmapsLoreMergeRuleHitsIntoResult($result, $ruleRows, $full);
                }
            }
        }
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'place' => implode(',', $placeKeys),
        'sections' => $result['sections'],
        'counts' => $result['counts'],
        'total' => $result['total'],
        'limit' => $full ? 0 : AVESMAPS_LORE_PANEL_LIMIT,
        // Eingabename => {name, wiki_url, gruppe} für alles aus ?goods=, wozu es einen
        // Artikel gibt. Gattungen wie „Vieh" fehlen hier und bleiben im Client Text.
        'goods' => $resolvedGoods,
        // Dieselben Namen in EINGABEREIHENFOLGE -- die Infobox-Zeile soll ihre gewohnte
        // Ordnung behalten, nicht die der Treffer.
        'goods_order' => $goodsOrder,
        // Task 9: true, wenn ?area= oder ?territory= mehr als AVESMAPS_LORE_RULE_AREA_LIMIT (25)
        // Flaechen ergab und der Rest gekappt wurde -- nie eine stille Kappung (siehe
        // avesmapsLoreRuleReadSubjectsForAreas).
        'truncated' => $ruleTruncated,
    ]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'lore_failed', 'Lore konnte nicht geladen werden.');
}
