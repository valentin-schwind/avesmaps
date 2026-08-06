<?php

declare(strict_types=1);

// Die AUSFÜHR-Hälfte des Vorkommen-Abgleichs (Flora, Fauna, Spezies, Handelswaren): sie arbeitet die
// Zeilen ab, die ein Editor in der Übernahme-Vorschau angehäkelt hat, und schreibt genau die. Entwurf:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §4/§7, Sitzung 2.
//
// 💣 DER SCHREIBRUMPF IST WÖRTLICH DER ALTE. avesmapsLoreApplyEntity ist der Schleifenkörper des
// früheren avesmapsLoreReconcileStep, Zeile für Zeile -- mit denselben vorbereiteten Anweisungen,
// derselben Reihenfolge (Felder, dann Orte, dann Quellen) und denselben Riegeln. Der Unterschied ist
// allein, WER entscheidet, dass er läuft: der Katalog vorher, ein Häkchen jetzt. Jede Garantie, die für
// ihn bewiesen war -- nie eine manuelle Zeile, nie einen Grabstein wiederbeleben, ein Wiederholungslauf
// ist ein echtes No-op -- gilt unverändert weiter.
//
// 💣 Das `$dryRun` von damals ist WEG, und das ist die eigentliche Nachricht: es war die arme Fassung
// genau dieser Vorschau (es zählte, was passieren würde, und niemand konnte etwas damit anfangen). Sein
// einziger Aufrufer, avesmapsLoreReconcileStep, ist durch die zwei Hälften ersetzt.
//
// 💣 Die Anweisungen werden EINMAL JE SCHRITT vorbereitet (avesmapsLoreApplyStatements), nicht je
// Eintrag. Der Grund stand schon an ihrer alten Stelle und gilt unverändert: bei ~7.750 Ortszeilen ist
// ein prepare() in der Schleife ein spürbares Eigentor.
//
// ⚠️ Die Kommentare hier sind deutsch, weil die Nachbarschaft deutsch ist (lore-sync.php durchgehend) --
// AGENTS.md §8: in der Sprache der Nachbarschaft bleiben, statt eine Datei zweisprachig zu machen.
//
// Beim Einbinden ohne Nebenwirkung: nur Funktionen. Die Kette lädt der Endpunkt.
//
// 💣 Die Protokoll-Bibliothek wird HIER eingebunden, nicht vom Aufrufer angenommen -- dieselbe
// Entscheidung aus demselben Grund wie in citymap-plan-apply.php: der Protokollschreiber verschluckt
// seine eigenen Fehler absichtlich, eine angenommene Abhängigkeit wäre also eine undefinierte Funktion
// in irgendjemandes catch. Gefangen, geloggt, spurlos -- das ist Befund A16.
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * Die vier Anweisungen des Schreibrumpfes, EINMAL je Schritt vorbereitet.
 *
 * @return array<string, PDOStatement>
 */
function avesmapsLoreApplyStatements(PDO $pdo): array
{
    return [
        'selectEntry' => $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_ENTRY . ' WHERE wiki_key = :wk LIMIT 1'),
        'selectPlaces' => $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_PLACE . ' WHERE entry_wiki_key = :wk'),
        'stagedPlaces' => $pdo->prepare(
            'SELECT * FROM ' . AVESMAPS_LORE_STAGING_PLACES . ' WHERE entry_wiki_key = :wk ORDER BY sort_order'
        ),
        'insertEntry' => $pdo->prepare(
            'INSERT INTO ' . AVESMAPS_LORE_TABLE_ENTRY . '
                (wiki_key, kind, wiki_title, wiki_url, name, match_key, gruppe, typ, lebensraum,
                 synonyme, merkmale_json, continent, origin, status, field_origins_json)
             VALUES (:wk, :kind, :wt, :url, :name, :mk, :gruppe, :typ, :leb, :syn, :merk, :cont, \'wiki\', \'active\', :fo)'
        ),
        'insertPlace' => $pdo->prepare(
            'INSERT INTO ' . AVESMAPS_LORE_TABLE_PLACE . '
                (entry_wiki_key, place_wiki_key, place_title, relation, sort_order, origin, status)
             VALUES (:wk, :pk, :pt, :rel, :so, \'wiki\', \'active\')
             ON DUPLICATE KEY UPDATE place_title = VALUES(place_title)'
        ),
        'deletePlace' => $pdo->prepare(
            'DELETE FROM ' . AVESMAPS_LORE_TABLE_PLACE . '
             WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel AND origin = \'wiki\''
        ),
    ];
}

/**
 * EINEN Eintrag scharf abgleichen: Felder (override-sicher je Feld), Orte (nur Wiki-Zeilen, Grabsteine
 * bleiben) und die Quellen über das geteilte System.
 *
 * @param array<string,mixed> $staged Zeile aus wiki_lore_catalog
 * @param array<string, PDOStatement> $statements avesmapsLoreApplyStatements
 * @param bool $sourceStagingReady kennt das Staging überhaupt Lore-Quellen? (siehe avesmapsLoreApplyStep)
 * @return array{entries_added:int, entries_updated:int, entries_unchanged:int, places_added:int,
 *               places_removed:int, places_suppressed:int, sources_added:int, sources_removed:int,
 *               sources_updated:int}
 */
function avesmapsLoreApplyEntity(PDO $pdo, array $staged, array $statements, bool $sourceStagingReady, int $userId): array
{
    $counters = [
        'entries_added' => 0, 'entries_updated' => 0, 'entries_unchanged' => 0,
        'places_added' => 0, 'places_removed' => 0, 'places_suppressed' => 0,
        'sources_added' => 0, 'sources_removed' => 0, 'sources_updated' => 0,
    ];

    $wikiKey = (string) $staged['wiki_key'];
    $desired = avesmapsLoreDesiredFromStaging($staged);

    $statements['selectEntry']->execute(['wk' => $wikiKey]);
    $current = $statements['selectEntry']->fetch(PDO::FETCH_ASSOC) ?: null;

    if ($current === null) {
        $counters['entries_added']++;
        $origins = [];
        foreach (AVESMAPS_LORE_WIKI_FIELDS as $f) {
            $origins[$f] = 'wiki';
        }
        $statements['insertEntry']->execute([
            'wk' => $wikiKey, 'kind' => $desired['kind'], 'wt' => $desired['wiki_title'],
            'url' => $desired['wiki_url'], 'name' => $desired['name'],
            'mk' => mb_substr(avesmapsWikiSyncCreateMatchKey($desired['name']), 0, 300, 'UTF-8'),
            'gruppe' => $desired['gruppe'], 'typ' => $desired['typ'], 'leb' => $desired['lebensraum'],
            'syn' => $desired['synonyme'], 'merk' => $desired['merkmale_json'],
            'cont' => $desired['continent'],
            'fo' => json_encode($origins, JSON_UNESCAPED_UNICODE),
        ]);
    } else {
        $fieldOrigins = avesmapsLoreDecodeOrigins($current['field_origins_json'] ?? null);
        $plan = avesmapsLoreFieldPlan($current, $desired, $fieldOrigins);
        if ($plan['set'] === []) {
            $counters['entries_unchanged']++;
        } else {
            $counters['entries_updated']++;
            $assignments = [];
            $params = ['wk' => $wikiKey];
            foreach ($plan['set'] as $field => $value) {
                $assignments[] = $field . ' = :' . $field;
                $params[$field] = $value;
            }
            // status wieder aktivieren: das Wiki kennt den Eintrag ja offenbar wieder. GENAU DAS ist
            // die Zusage, die die Vorschau an einer Stilllegung macht ("kommt der Artikel zurück, wird
            // sie ohne Zutun wieder aktiv") -- sie steht in dieser Zeile.
            $assignments[] = 'status = CASE WHEN status = \'retired\' THEN \'active\' ELSE status END';
            $assignments[] = 'field_origins_json = :fo';
            $params['fo'] = json_encode(array_merge($fieldOrigins, $plan['origins']), JSON_UNESCAPED_UNICODE);
            $update = $pdo->prepare(
                'UPDATE ' . AVESMAPS_LORE_TABLE_ENTRY . ' SET ' . implode(', ', $assignments) . ' WHERE wiki_key = :wk'
            );
            $update->execute($params);
        }
    }

    // ---- Orte ----
    $statements['stagedPlaces']->execute(['wk' => $wikiKey]);
    $desiredPlaces = $statements['stagedPlaces']->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $statements['selectPlaces']->execute(['wk' => $wikiKey]);
    $currentPlaces = $statements['selectPlaces']->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $placePlan = avesmapsLoreChildPlan($currentPlaces, $desiredPlaces, 'avesmapsLorePlaceKey');
    $counters['places_added'] += count($placePlan['add']);
    $counters['places_removed'] += count($placePlan['remove']);
    $counters['places_suppressed'] += $placePlan['suppressed'];
    foreach ($placePlan['add'] as $p) {
        $statements['insertPlace']->execute([
            'wk' => $wikiKey, 'pk' => (string) $p['place_wiki_key'], 'pt' => (string) $p['place_title'],
            'rel' => (string) $p['relation'], 'so' => (int) ($p['sort_order'] ?? 0),
        ]);
    }
    foreach ($placePlan['remove'] as $p) {
        $statements['deletePlace']->execute([
            'wk' => $wikiKey, 'pk' => (string) $p['place_wiki_key'], 'rel' => (string) $p['relation'],
        ]);
    }

    // ---- Quellen: EIN Aufruf in das geteilte System ----
    //
    // Kein eigener Abgleich. avesmapsPublicationReconcileEntity liest die Wunschliste aus
    // wiki_entity_publication (entity_type='lore') und gleicht sie gegen feature_sources ab -- mit
    // derselben override-sicheren, unit-getesteten Logik, die Siedlungen, Regionen, Wege und
    // Territorien benutzen: es schreibt und loescht AUSSCHLIESSLICH Zeilen mit
    // origin='wiki_publication', manuelle Zeilen und Grabsteine bleiben unberuehrt, ein
    // Wiederholungslauf ist ein echtes No-op.
    //
    // ⚠️ Der Eintragsschluessel ist zugleich die public id (Lore hat keine eigene).
    // Guarded: laeuft die Uebernahme ohne geladene Publikations-Bibliothek, bleiben die Quellen
    // schlicht unangetastet, statt den ganzen Lauf zu versenken.
    if ($sourceStagingReady && function_exists('avesmapsPublicationReconcileEntity')) {
        $sourceCounters = avesmapsPublicationReconcileEntity($pdo, 'lore', $wikiKey, $wikiKey, $userId);
        $counters['sources_added'] += (int) $sourceCounters['links_added'];
        $counters['sources_removed'] += (int) $sourceCounters['links_removed'];
        $counters['sources_updated'] += (int) $sourceCounters['links_updated'];
    }

    return $counters;
}

/**
 * EINEN Wiki-Eintrag stilllegen, den das Wiki nicht mehr kennt. false = der Riegel hat abgelehnt.
 *
 * 💣 EIN GRABSTEIN, KEINE LÖSCHUNG -- und die Vorschau sagt das ausdrücklich: der Eintrag behält seine
 * Vorkommen, seine Quellen und seinen wiki_key, und der nächste Abgleich weckt ihn selbst wieder
 * (avesmapsLoreApplyEntity schreibt `status = CASE WHEN status='retired' THEN 'active' …`). Ein Eintrag
 * kann in Orts- und Quellenlisten referenziert sein; ein stiller Totalverlust wäre im Zweifel schlimmer
 * als eine Karteileiche.
 *
 * Die beiden Riegel sind die des alten Sammel-Sweeps, wörtlich: nur origin='wiki', nur status='active'.
 * Bewacht von __tests__/lore-retire-parity-test.php.
 */
function avesmapsLoreRetireWikiEntry(PDO $pdo, string $wikiKey): bool
{
    $stmt = $pdo->prepare(
        'UPDATE ' . AVESMAPS_LORE_TABLE_ENTRY . " SET status = 'retired'
          WHERE wiki_key = :wk AND origin = 'wiki' AND status = 'active'"
    );
    $stmt->execute(['wk' => $wikiKey]);

    return $stmt->rowCount() > 0;
}

/**
 * EIN begrenzter Übernahme-Schritt. Wiederaufnehmbar: jede erledigte Zeile trägt ihren apply_state, der
 * nächste Aufruf nimmt schlicht die ohne.
 *
 * 💣 KEIN try/catch UM DIE ZEILE (Befund A21) -- die Begründung steht in citymap-plan-apply.php.
 *
 * @param array<string,mixed>|null $user der Editor, für die Protokollzeile (NULL = kein Mensch)
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsLoreApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_LORE_RECONCILE_BATCH;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ Alle DDL hier oben, einmal, vor jeder Transaktion: MySQL committet eine offene Transaktion,
    // sobald es DDL sieht.
    avesmapsLoreEnsureStagingTables($pdo);
    avesmapsLoreEnsureLiveTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    // 💣 EINMAL je Schritt gefragt, nicht je Eintrag: kennt das Staging ueberhaupt Lore-Quellen? Wenn
    // nicht, bleiben die Quellen KOMPLETT unangetastet -- sonst laese der Diff "keine Wunschliste" als
    // "alles loeschen" und raeumte jede vorhandene Verknuepfung weg. Genau der Fall nach der Migration
    // vom 2026-07-22, die ~34.800 Zeilen anlegte, bevor je ein Dump Lore-Refs gestaged hatte. Leeres
    // Staging heisst "weiss ich nicht", nie "gibt es nicht".
    //
    // ⚠️ UND ZWISCHEN VORSCHAU UND ÜBERNAHME kann ein neues "Dump holen" beginnen, das das Staging neu
    // aufbaut. Deshalb wird hier erneut gefragt und nicht der Zustand von damals geglaubt.
    $sourceStagingReady = function_exists('avesmapsPublicationStagingHasEntityType')
        && avesmapsPublicationStagingHasEntityType($pdo, 'lore');

    $statements = avesmapsLoreApplyStatements($pdo);
    $catalogFind = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_STAGING_CATALOG . ' WHERE wiki_key = :wk LIMIT 1');
    $liveFind = $pdo->prepare('SELECT origin, status FROM ' . AVESMAPS_LORE_TABLE_ENTRY . ' WHERE wiki_key = :wk LIMIT 1');
    // Einmal je Schritt gelesen, nicht je Zeile: ein Editor kann genau diese Stilllegung inzwischen in
    // einem anderen Lauf abgelehnt haben.
    $declined = array_flip(avesmapsSyncPlanDeclinedKeys($pdo, 'lore'));

    $totals = ['applied' => 0, 'retired' => 0, 'stale' => 0, 'processed' => 0];

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $wikiKey = (string) $row['entity_key'];
        $changeType = (string) $row['change_type'];

        $catalogFind->execute(['wk' => $wikiKey]);
        $catalog = $catalogFind->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($changeType === 'deleted') {
            $liveFind->execute(['wk' => $wikiKey]);
            $live = $liveFind->fetch(PDO::FETCH_ASSOC) ?: null;

            // Vier Wege, auf denen eine Stilllegung seit der Vorschau ihre Berechtigung verloren hat.
            $refusal = '';
            if ($catalog !== null) {
                $refusal = 'Der Eintrag steht wieder im Dump.';
            } elseif (isset($declined[$wikiKey])) {
                $refusal = 'Die Stilllegung wurde inzwischen abgelehnt.';
            } elseif ($live === null) {
                $refusal = 'Der Eintrag ist nicht mehr da.';
            } elseif ((string) $live['origin'] !== 'wiki' || (string) $live['status'] !== 'active') {
                $refusal = 'Der Eintrag wurde inzwischen von Hand bearbeitet oder liegt schon.';
            }
            if ($refusal !== '') {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', $refusal);
                $totals['stale']++;
            } elseif (avesmapsLoreRetireWikiEntry($pdo, $wikiKey)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['retired']++;
            } else {
                // Der Riegel an der Anweisung selbst hat abgelehnt -- die zweite Absicherung, und die
                // einzige, die nach den vier Prüfungen oben noch greifen kann.
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Riegel am Stilllegen hat abgelehnt.');
                $totals['stale']++;
            }
        } elseif ($catalog === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Im Dump nicht mehr enthalten.');
            $totals['stale']++;
        } else {
            // 💣 DIE NACHPRÜFUNG (Entwurf §4a). Ein Plan darf tagelang liegen; zwischen Rechnen und
            // Übernehmen kann jemand den Eintrag von Hand bearbeiten oder ein neuer Dump ankommen. Neu
            // gerechnet mit DERSELBEN Funktion, die die Zeile gebaut hat, also heißt "unverändert"
            // wirklich unverändert.
            $stored = json_decode((string) ($row['after_json'] ?? ''), true);
            $fresh = avesmapsLorePlanForCatalogRow($pdo, $catalog, $sourceStagingReady);
            if (avesmapsSyncPlanIsStale(is_array($stored) ? $stored : null, $fresh['item']['after'] ?? null)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
                $totals['stale']++;
            } else {
                avesmapsLoreApplyEntity($pdo, $catalog, $statements, $sourceStagingReady, $userId);
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['applied']++;
            }
        }

        if (microtime(true) >= $deadline) {
            break;
        }
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];

    if ($done) {
        $closing = avesmapsLoreApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $totals['applied'],
        // „deleted" heißt bei den Vorkommen STILLGELEGT. Der Name bleibt, weil der Endpunkt und das
        // Bauteil für alle Arten eine Sprache sprechen; das Wort dafür steht in
        // AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB und im Bauteil.
        'deleted' => $totals['retired'],
        'stale' => $totals['stale'],
        'processed' => $totals['processed'],
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}

/**
 * Alles, was GENAU EINMAL passiert, nach der letzten angehäkelten Zeile.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsLoreApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array
{
    $planned = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    $run = avesmapsSyncPlanRunById($pdo, $runId);
    if ($run !== null) {
        $decoded = json_decode((string) ($run['counts_json'] ?? ''), true);
        if (is_array($decoded)) {
            $planned = array_merge($planned, $decoded);
        }
    }

    // Was liegen gelassen wurde und was genommen wurde. Die drei Fälle SIND Entwurf §2:
    //   abgehäkelte Änderung   -> gezählt, kommt beim nächsten Lauf mit ihrem Zähler wieder
    //   abgehäkelte Stilllegung -> dauerhaft abgelehnt, aber die Zeile bleibt origin='wiki' und wird
    //                              weiter gepflegt
    //   übernommene Änderung   -> ihr Zähler wird vergessen, sonst lügt das Merkmal für immer
    $stmt = $pdo->prepare('SELECT entity_key, change_type, selected, apply_state FROM sync_plan_item WHERE run_id = :r');
    $stmt->execute(['r' => $runId]);
    $skipped = 0;
    $declined = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) $row['entity_key'];
        $type = (string) $row['change_type'];
        $isSelected = (int) $row['selected'] === 1;
        $applied = (string) ($row['apply_state'] ?? '') === 'applied';

        if (!$isSelected && $type === 'changed') {
            avesmapsSyncPlanRecordSkip($pdo, 'lore', $key, $userId);
            $skipped++;
        } elseif (!$isSelected && $type === 'deleted') {
            avesmapsSyncPlanRecordDecline($pdo, 'lore', $key, $userId);
            $declined++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, 'lore', $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // ERST JETZT stempeln, und nur hier: der Zeitstempel sagt „der Bestand ist abgeglichen". Nach einem
    // Rechenlauf gesetzt wäre er eine stille Lüge -- der Editor liest ihn als „übernommen". (Genau das
    // stand schon am alten Reconcile: „ein Zeitstempel nach einem Probelauf wäre eine stille Lüge".)
    if (function_exists('avesmapsAppSettingSet')) {
        try {
            avesmapsAppSettingSet($pdo, AVESMAPS_LORE_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'));
        } catch (Throwable) {
            // Einstellungstabelle fehlt -> ohne Zeitstempel weiter, kein Abbruch.
        }
    }
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo); // Vorkommen und ihre Quellen reisen im Kartenpayload
    }

    $countByState = static function (PDO $pdo, int $runId, string $state): int {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $runId, 's' => $state]);

        return (int) $stmt->fetchColumn();
    };

    // ⚠️ Die Namen der stillgelegten Einträge werden aus den ZEILEN gelesen, nicht in dem Schritt
    // gesammelt, der zufällig der letzte war: ein Lauf spannt über mehrere Anfragen, und eine im
    // Arbeitsspeicher gebaute Liste nennte nur die Handvoll des letzten Schritts.
    $titles = $pdo->prepare(
        "SELECT label FROM sync_plan_item
          WHERE run_id = :r AND change_type = 'deleted' AND apply_state = 'applied' ORDER BY id ASC"
    );
    $titles->execute(['r' => $runId]);
    $retiredTitles = array_map('strval', $titles->fetchAll(PDO::FETCH_COLUMN) ?: []);

    avesmapsLogSyncPlanApply(
        $pdo,
        'lore',
        $planned,
        [
            'run_id' => $runId,
            'applied' => $countByState($pdo, $runId, 'applied'),
            'stale' => $countByState($pdo, $runId, 'stale'),
            'skipped' => $skipped,
            'declined' => $declined,
            // Im Protokoll heißen sie „stillgelegt", nicht „gelöscht"
            // (AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB).
            'deleted_titles' => $retiredTitles,
        ],
        $user
    );

    return ['skipped' => $skipped, 'declined' => $declined];
}
