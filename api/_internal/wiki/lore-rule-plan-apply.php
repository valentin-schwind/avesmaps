<?php

declare(strict_types=1);

// Die AUSFÜHR-Hälfte von „Regeln ableiten": sie schreibt genau die Regeln, die ein Editor in der
// Übernahme-Vorschau angehäkelt hat. Entwurf: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md.
//
// 🔴 SIE FASST AUSSCHLIESSLICH `origin = 'wiki_verbreitung'` AN. Eine von Hand gebaute Regel
// (`origin = 'manual'`, heute ausnahmslos alle) wird nicht gelesen, nicht überschrieben, nicht
// gelöscht — und `lore_place` erst recht nicht: die Regel tritt NEBEN die genannten Orte, nie an
// ihre Stelle. Ohne diese Trennung wäre der zweite Lauf ein Datenverlust.
//
// 💣 DIE NACHPRÜFUNG IST KEINE FORMALIE. Ein Plan darf tagelang liegen; zwischen Rechnen und
// Übernehmen kann ein „Vorkommen syncen" die Wiki-Felder erneuern oder ein Editor eine Fläche
// umbenennen. Neu gerechnet wird deshalb mit DERSELBEN Funktion, die die Zeile gebaut hat
// (avesmapsLoreRulePlanItem) — nur so heißt „unverändert" wirklich unverändert.

require_once __DIR__ . '/lore-rule-plan.php';
// avesmapsLoreRuleChainIsUnbounded -- der Riegel, den auch der Editor-Schreibpfad abfragt.
require_once __DIR__ . '/../app/lore-rule.php';
// 💣 Die Protokoll-Bibliothek wird HIER eingebunden, nicht vom Aufrufer angenommen: der
// Protokollschreiber verschluckt seine eigenen Fehler absichtlich, eine angenommene Abhängigkeit
// wäre also eine undefinierte Funktion in irgendjemandes catch (Befund A16, citymap-plan-apply.php).
require_once __DIR__ . '/../map/collection-audit.php';

/** Zeilen, die EIN begrenzter Übernahmeschritt abarbeitet. */
const AVESMAPS_LORE_RULE_APPLY_BATCH = 40;

/**
 * Die abgeleiteten Regeln EINES Eintrags scharf schreiben.
 *
 * 💣 ERST WEG, DANN NEU — und zwar über den Herkunfts-Riegel. Eine Relation, die das Wiki nicht
 * mehr nennt, verlöre sonst nie ihre alte Regel: sie stünde als Karteileiche weiter im Editor und
 * träfe weiter Flächen. Deshalb wird der ganze abgeleitete Bestand des Eintrags entfernt und aus
 * der frischen Ableitung neu aufgebaut.
 *
 * @param array<string, list<array<string,mixed>>> $termsJeRelation
 * @return array{rules_written:int, rules_removed:int}
 */
function avesmapsLoreRuleApplyEntry(PDO $pdo, string $entryWikiKey, array $termsJeRelation, int $userId): array
{
    $entfernt = avesmapsLoreRuleDeleteByOrigin($pdo, $entryWikiKey, AVESMAPS_LORE_RULE_DERIVE_ORIGIN);

    $geschrieben = 0;
    foreach ($termsJeRelation as $relation => $terms) {
        if ($terms === []) {
            continue;
        }
        // 🔴 Der Riegel des Schreibpfades, hier noch einmal: eine Kette mit einer leeren Bedingung
        // träfe ALLES. Die Ableitung erzeugt so etwas nicht (als Zusicherung festgenagelt) — aber
        // ein Riegel, der nur an einer Stelle steht, ist keiner.
        if (avesmapsLoreRuleChainIsUnbounded($terms)) {
            continue;
        }
        avesmapsLoreRuleSave(
            $pdo,
            $entryWikiKey,
            $terms,
            (string) $relation,
            $userId > 0 ? $userId : null,
            null,
            AVESMAPS_LORE_RULE_DERIVE_ORIGIN
        );
        $geschrieben++;
    }

    return ['rules_written' => $geschrieben, 'rules_removed' => $entfernt];
}

/**
 * EIN begrenzter Übernahmeschritt. Wiederaufnehmbar: jede erledigte Zeile trägt ihren `apply_state`.
 *
 * 💣 KEIN try/catch UM DIE ZEILE — dieselbe Entscheidung wie in citymap-plan-apply.php und
 * lore-plan-apply.php: ein verschluckter Schreibfehler meldet „übernommen" und hat nichts getan.
 *
 * @param array<string,mixed>|null $user der Editor, für die Protokollzeile
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsLoreRuleApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_LORE_RULE_APPLY_BATCH;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ Alle DDL hier oben, einmal, VOR jeder Transaktion: MySQL committet eine offene Transaktion,
    // sobald es DDL sieht.
    avesmapsLoreRuleEnsureTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    // EINMAL je Schritt, nicht je Zeile.
    $katalog = avesmapsLoreRulePlanKatalog($pdo);
    $eintragLesen = $pdo->prepare(
        'SELECT wiki_key, name, kind, lebensraum, merkmale_json FROM ' . AVESMAPS_LORE_TABLE_ENTRY . '
          WHERE wiki_key = :wk AND status = \'active\' LIMIT 1'
    );

    $totals = ['applied' => 0, 'removed' => 0, 'stale' => 0, 'processed' => 0];

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        // 💣 Die Zeitschranke steht VORN, nicht am Ende der Schleife: mehrere Zweige dieses Rumpfes
        // enden mit `continue` (jede überholte Zeile), und ein Deckel hinter einem `continue` ist
        // keiner. Die erste Zeile läuft immer, sonst käme ein Aufruf ohne Fortschritt zurück und der
        // Client drehte sich im Kreis.
        if ($totals['processed'] > 0 && microtime(true) >= $deadline) {
            break;
        }
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $wikiKey = (string) $row['entity_key'];
        $changeType = (string) $row['change_type'];

        $eintragLesen->execute(['wk' => $wikiKey]);
        $eintrag = $eintragLesen->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($eintrag === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Den Eintrag gibt es nicht mehr.');
            $totals['stale']++;
            continue;
        }

        $bestehende = avesmapsLoreRulePlanBestehende($pdo, $wikiKey);
        $frisch = avesmapsLoreRulePlanItem($eintrag, $bestehende, $katalog);

        if ($changeType === 'deleted') {
            // Die Zeile sagt: das Wiki nennt nichts mehr. Stimmt das jetzt noch?
            if ($frisch === null || $frisch['change_type'] !== 'deleted') {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Die Wiki-Angabe ist wieder da.');
                $totals['stale']++;
                continue;
            }
            $ergebnis = avesmapsLoreRuleApplyEntry($pdo, $wikiKey, [], $userId);
            $totals['removed'] += $ergebnis['rules_removed'];
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
            continue;
        }

        if ($frisch === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Inzwischen gibt es nichts mehr zu tun.');
            $totals['stale']++;
            continue;
        }
        $gespeichert = json_decode((string) ($row['after_json'] ?? ''), true);
        if (avesmapsSyncPlanIsStale(is_array($gespeichert) ? $gespeichert : null, $frisch['after'])) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
            $totals['stale']++;
            continue;
        }

        // Die Bedingungen kommen aus der FRISCHEN Rechnung, nicht aus dem Plan: after_json trägt den
        // Satz für den Menschen, nicht die Kette. Dass beide zueinander passen, hat die Zeile darüber
        // gerade geprüft.
        $termsJeRelation = avesmapsLoreRuleDeriveTermsFuerEintrag($eintrag, $katalog);
        $ergebnis = avesmapsLoreRuleApplyEntry($pdo, $wikiKey, $termsJeRelation, $userId);
        $totals['applied'] += $ergebnis['rules_written'];
        avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];
    if ($done) {
        $closing = avesmapsLoreRuleApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $totals['applied'],
        'deleted' => $totals['removed'],
        'stale' => $totals['stale'],
        'processed' => $totals['processed'],
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}

/**
 * Die Bedingungsketten eines Eintrags, je Relation -- die WIRKLICH geschriebene Fassung.
 *
 * ⚠️ Getrennt von avesmapsLoreRulePlanItem, weil jene die ANZEIGE baut (Satz, Hinweis, Kategorie)
 * und diese die Daten. Beide rufen dieselbe Ableitung; eine gemeinsame Funktion, die beides
 * zurückgibt, hätte die Vorschau an die Schreibform gekettet.
 *
 * @param array<string,mixed> $eintrag
 * @return array<string, list<array<string,mixed>>>
 */
function avesmapsLoreRuleDeriveTermsFuerEintrag(array $eintrag, array $katalog): array
{
    $kind = (string) ($eintrag['kind'] ?? '');
    $lebensraum = (string) ($eintrag['lebensraum'] ?? '');
    $out = [];
    foreach (avesmapsLoreRuleDeriveOrtsfelder($kind, $eintrag['merkmale_json'] ?? null) as $relation => $roh) {
        $vorschlag = avesmapsLoreRuleDeriveVorschlag($roh, $lebensraum, $katalog);
        if ($vorschlag['terms'] !== []) {
            $out[(string) $relation] = $vorschlag['terms'];
        }
    }

    return $out;
}

/**
 * Alles, was GENAU EINMAL passiert, nach der letzten angehäkelten Zeile.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsLoreRuleApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array
{
    $planned = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    $run = avesmapsSyncPlanRunById($pdo, $runId);
    if ($run !== null) {
        $decoded = json_decode((string) ($run['counts_json'] ?? ''), true);
        if (is_array($decoded)) {
            $planned = array_merge($planned, $decoded);
        }
    }

    // Die drei Fälle sind Entwurf §2: eine abgehäkelte Änderung kommt beim nächsten Lauf mit ihrem
    // Zähler wieder, eine abgehäkelte Löschung ist dauerhaft abgelehnt, eine übernommene Änderung
    // vergisst ihren Zähler.
    $stmt = $pdo->prepare('SELECT entity_key, change_type, selected, apply_state FROM sync_plan_item WHERE run_id = :r');
    $stmt->execute(['r' => $runId]);
    $skipped = 0;
    $declined = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) $row['entity_key'];
        $type = (string) $row['change_type'];
        $isSelected = (int) $row['selected'] === 1;
        $applied = (string) ($row['apply_state'] ?? '') === 'applied';

        // ⚠️ Der Zähler gehört ausschließlich `changed` — avesmapsSyncPlanRecordSkip schreibt seine
        // Zeile fest unter diesem change_type, und der Planbauer schlägt sie unter dem change_type der
        // Zeile nach. Ein hier mitgezähltes `new` legte seine Entscheidung unter einen Schlüssel, den
        // niemand je liest. Dieselbe Bedingung wie in avesmapsLoreApplyFinish.
        if (!$isSelected && $type === 'changed') {
            avesmapsSyncPlanRecordSkip($pdo, AVESMAPS_LORE_RULE_PLAN_KIND, $key, $userId);
            $skipped++;
        } elseif (!$isSelected && $type === 'deleted') {
            avesmapsSyncPlanRecordDecline($pdo, AVESMAPS_LORE_RULE_PLAN_KIND, $key, $userId);
            $declined++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, AVESMAPS_LORE_RULE_PLAN_KIND, $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // Die Regeln reisen im Kartenpayload (die Vorkommen eines Ortes hängen an ihnen) -- ohne den Hub
    // bleibt ein warmer Client über 304 auf dem Stand von vorher.
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }

    $countByState = static function (PDO $pdo, int $runId, string $state): int {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $runId, 's' => $state]);

        return (int) $stmt->fetchColumn();
    };

    $titles = $pdo->prepare(
        "SELECT label FROM sync_plan_item
          WHERE run_id = :r AND change_type = 'deleted' AND apply_state = 'applied' ORDER BY id ASC"
    );
    $titles->execute(['r' => $runId]);
    $entfernt = array_map('strval', $titles->fetchAll(PDO::FETCH_COLUMN) ?: []);

    avesmapsLogSyncPlanApply(
        $pdo,
        AVESMAPS_LORE_RULE_PLAN_KIND,
        $planned,
        [
            'run_id' => $runId,
            'applied' => $countByState($pdo, $runId, 'applied'),
            'stale' => $countByState($pdo, $runId, 'stale'),
            'skipped' => $skipped,
            'declined' => $declined,
            'deleted_titles' => $entfernt,
        ],
        $user
    );

    return ['skipped' => $skipped, 'declined' => $declined];
}
