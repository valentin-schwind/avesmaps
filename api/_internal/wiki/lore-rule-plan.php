<?php

declare(strict_types=1);

// Die RECHEN-Haelfte von „Regeln ableiten": sie liest die Wiki-Felder der Vorkommen, leitet daraus
// Lebensraum-Regeln ab und legt das Ergebnis als Plan in `sync_plan_item`. Entwurf der Vorschau:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md; die Ableitung selbst steht rein in
// lore-rule-derive.php, der Messbericht in
// .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/regeln-ableiten-bericht.md.
//
// 💣 SIE SCHREIBT IN KEINE NUTZTABELLE. Ein Lauf, der Regeln ERZEUGT, ist eine Sammelaktion mit
// Entscheidungsgehalt -- genau die hat der Owner am 20.07.2026 ausgeschlossen, und genau daran ist
// am 19.08.2026 frueh ein Massenlauf gescheitert und zurueckgebaut worden. Geschrieben wird nur, was
// ein Editor in der Vorschau anhaekelt (lore-rule-plan-apply.php). Gewacht von
// __tests__/sync-plan-purity-test.php ueber alles, was diese Funktion in jeder Tiefe erreicht.
//
// 🔴 QUELLE IST DIE LEBENDE TABELLE, NICHT DAS STAGING. `lore_entry.merkmale_json` traegt den
// Rohtext von `|Verbreitung=` (er faellt nicht unter AVESMAPS_LORE_CORE_FIELDS), `lore_entry.lebensraum`
// den von `|Vorkommen=`. Damit braucht dieser Knopf KEIN „Dump holen" und keinen Abgleich -- er
// rechnet auf dem Bestand, den der Editor vor sich sieht.

require_once __DIR__ . '/lore-rule-derive.php';
require_once __DIR__ . '/sync-plan.php';
// AVESMAPS_LORE_TABLE_ENTRY -- der Name der Tabelle, aus der gelesen wird.
require_once __DIR__ . '/lore-sync.php';
// avesmapsLoreRuleEnsureTables + die Leser/Schreiber der drei Regeltabellen.
require_once __DIR__ . '/../app/lore-rule-store.php';

/** Zeilen, die EIN begrenzter Rechenschritt durchsieht. Dieselbe Groesse wie der Vorkommen-Abgleich. */
const AVESMAPS_LORE_RULE_PLAN_BATCH = 150;

/** Der `kind` dieses Plans in sync_plan_run/-item. */
const AVESMAPS_LORE_RULE_PLAN_KIND = 'lore_rule';

/**
 * Anzahl der aktiven Vorkommen -- der Nenner der Fortschrittsanzeige.
 *
 * ⚠️ Die LEBENDE Tabelle, nicht das Staging: dieser Lauf braucht kein „Dump holen". 0 heisst „die
 * Tabelle gibt es noch nicht", nicht „es ist nichts zu tun" -- der Zaehler daneben sagt das.
 */
function avesmapsLoreRulePlanCountEntries(PDO $pdo): int
{
    try {
        return (int) $pdo->query(
            'SELECT COUNT(*) FROM ' . AVESMAPS_LORE_TABLE_ENTRY . " WHERE status = 'active'"
        )->fetchColumn();
    } catch (Throwable) {
        return 0;
    }
}

/**
 * Der Nachschlage-Katalog, EINMAL je Schritt gelesen.
 *
 * ⚠️ Drei Abfragen ueber kleine Tabellen (954 Flaechen, ~35 Arten, ~1.000 Gebietsnamen, gemessen
 * 19.08.2026) -- je Eintrag gelesen waeren es 150-mal so viele, und das ist die Last, die STRATO
 * schon einmal umgeworfen hat (AGENTS.md §10).
 *
 * 🔴 Die Herrschaftsgebiete dienen NUR der Begruendung: sie entscheiden nie, ob etwas uebernommen
 * wird. Faellt ihre Abfrage aus, wird aus „Herrschaftsgebiet" ein „unbekannt" -- eine schwaechere
 * Erklaerung, kein anderer Plan.
 */
function avesmapsLoreRulePlanKatalog(PDO $pdo): array
{
    $regionen = [];
    $statement = $pdo->query(
        "SELECT public_id, name, kind, region_type, wiki_region_key
           FROM ecosystem_region WHERE is_active = 1 AND kind <> 'klima' ORDER BY public_id"
    );
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $regionen[] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) ($row['name'] ?? ''),
            'kind' => (string) ($row['kind'] ?? ''),
            'region_type' => (string) ($row['region_type'] ?? ''),
            'wiki_region_key' => $row['wiki_region_key'] === null ? null : (string) $row['wiki_region_key'],
        ];
    }

    $arten = [];
    $statement = $pdo->query('SELECT kind, type_key, label FROM ecosystem_region_type WHERE is_active = 1');
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $arten[] = [
            'kind' => (string) $row['kind'],
            'type_key' => (string) $row['type_key'],
            'label' => (string) ($row['label'] ?? ''),
        ];
    }

    $territorien = [];
    try {
        $statement = $pdo->query('SELECT name FROM political_territory WHERE is_active = 1');
        foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_COLUMN) as $name) {
            $territorien[] = (string) $name;
        }
    } catch (Throwable) {
        // Nur die Begruendung wird schwaecher, der Plan bleibt derselbe.
    }

    return avesmapsLoreRuleDeriveKatalog($regionen, $arten, $territorien);
}

/**
 * Die bereits abgeleiteten Regeln eines Eintrags, nach relation.
 *
 * 🔴 NUR `origin = 'wiki_verbreitung'`. Eine von Hand gebaute Regel (`origin = 'manual'` -- heute
 * sind das ausnahmslos alle) wird von diesem Lauf weder gelesen noch verglichen noch angefasst.
 *
 * @return array<string, array{id:int, terms:list<array<string,mixed>>}>
 */
function avesmapsLoreRulePlanBestehende(PDO $pdo, string $entryWikiKey): array
{
    $rules = $pdo->prepare(
        'SELECT id, relation FROM lore_rule
          WHERE entry_wiki_key = :wk AND status = \'active\' AND origin = :origin
          ORDER BY sort_order, id'
    );
    $rules->execute(['wk' => $entryWikiKey, 'origin' => AVESMAPS_LORE_RULE_DERIVE_ORIGIN]);
    $rows = $rules->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $termStatement = $pdo->prepare(
        'SELECT id, join_op, area_public_id, climate_from, climate_to
           FROM lore_rule_term WHERE rule_id = :id ORDER BY seq'
    );
    $typeStatement = $pdo->prepare(
        'SELECT kind, region_type FROM lore_rule_term_type WHERE term_id = :id ORDER BY kind, region_type'
    );

    $out = [];
    foreach ($rows as $row) {
        $termStatement->execute(['id' => (int) $row['id']]);
        $terms = [];
        foreach ($termStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $termRow) {
            $typeStatement->execute(['id' => (int) $termRow['id']]);
            $types = [];
            foreach ($typeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $typeRow) {
                $types[] = ['kind' => (string) $typeRow['kind'], 'region_type' => (string) $typeRow['region_type']];
            }
            $terms[] = [
                'join_op' => (string) $termRow['join_op'],
                'area_public_id' => $termRow['area_public_id'] !== null ? (string) $termRow['area_public_id'] : null,
                'climate_from' => $termRow['climate_from'] !== null ? (string) $termRow['climate_from'] : null,
                'climate_to' => $termRow['climate_to'] !== null ? (string) $termRow['climate_to'] : null,
                'types' => $types,
            ];
        }
        // 💣 Bei mehreren Regeln derselben relation gewinnt die LETZTE gelesene und die uebrigen
        // gelten als ueberzaehlig -- die Uebernahme raeumt sie weg. Zwei abgeleitete Regeln fuer
        // dieselbe Aussage kann nur ein abgebrochener Lauf erzeugt haben.
        $out[(string) $row['relation']] = ['id' => (int) $row['id'], 'terms' => $terms];
    }

    return $out;
}

/**
 * PURE: der Kern einer Bedingungskette als Vergleichszeichenfolge.
 *
 * 💣 Der SATZ allein reicht als Vergleich nicht: zwei Flaechen koennen denselben Namen tragen (13
 * live), und dann laesen sich zwei verschiedene Regeln gleich. Verglichen wird deshalb ueber
 * public_id und Typschluessel -- die Namen sind nur fuer den Menschen da.
 */
function avesmapsLoreRulePlanKern(array $regelnJeRelation): string
{
    $kern = [];
    foreach ($regelnJeRelation as $relation => $terms) {
        $liste = [];
        foreach ($terms as $term) {
            $typen = array_map(
                static fn (array $t): string => (string) $t['kind'] . '|' . (string) $t['region_type'],
                (array) ($term['types'] ?? [])
            );
            sort($typen);
            $liste[] = (string) ($term['join_op'] ?? 'und')
                . '>' . (string) ($term['area_public_id'] ?? '')
                . '>' . implode('+', $typen);
        }
        $kern[(string) $relation] = $liste;
    }
    ksort($kern);

    return json_encode($kern, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
}

/**
 * PURE: der Satz, den die Vorschau ueber einen Eintrag schreibt -- ueber alle seine Relationen.
 *
 * Bei genau einer Relation steht der blosse Satz; bei mehreren (nur Waren haben zwei Ortsfelder)
 * wird jede benannt, sonst laese sich „X oder Y" wie EINE Kette.
 */
function avesmapsLoreRulePlanSatz(array $saetzeJeRelation): string
{
    $gefuellt = array_filter($saetzeJeRelation, static fn (string $s): bool => trim($s) !== '');
    if ($gefuellt === []) {
        return '';
    }
    if (count($gefuellt) === 1) {
        return (string) reset($gefuellt);
    }
    $teile = [];
    foreach ($gefuellt as $relation => $satz) {
        $teile[] = (string) $relation . ': ' . $satz;
    }

    return implode(' · ', $teile);
}

/**
 * PURE: aus den verworfenen Angaben EIN Satz fuer die Zeile.
 *
 * 🔴 Nichts stillschweigend weglassen. Genannt werden Zahl UND Grund; die ersten Namen stehen dabei,
 * weil „3 Angaben nicht übernommen" ohne sie nichts ist, was man mit gutem Gewissen anhaekelt.
 *
 * @param list<array{text:string, grund:string}> $verworfen
 */
function avesmapsLoreRulePlanHinweis(array $verworfen): string
{
    if ($verworfen === []) {
        return '';
    }
    $nachGrund = [];
    foreach ($verworfen as $eintrag) {
        $grund = (string) ($eintrag['grund'] ?? 'unbekannt');
        $nachGrund[$grund][] = trim((string) ($eintrag['text'] ?? ''));
    }

    $teile = [];
    foreach ($nachGrund as $grund => $texte) {
        $namen = array_slice(array_filter($texte, static fn (string $t): bool => $t !== ''), 0, 3);
        $satz = (string) (AVESMAPS_LORE_RULE_DERIVE_GRUENDE[$grund] ?? $grund) . ': ' . count($texte);
        if ($namen !== []) {
            $satz .= ' (' . implode(', ', array_map(
                static fn (string $t): string => mb_substr($t, 0, 40, 'UTF-8'),
                $namen
            )) . (count($texte) > count($namen) ? ', …' : '') . ')';
        }
        $teile[] = $satz;
    }

    return count($verworfen) . ' Angabe' . (count($verworfen) === 1 ? '' : 'n')
        . ' nicht übernommen — ' . implode(' · ', $teile);
}

/**
 * Die Planzeile fuer EINEN Eintrag, oder null, wenn es nichts zu tun gibt.
 *
 * 🔴 VORGESCHLAGEN WIRD NUR, WAS ETWAS NEUES SAGT. Eine Bedingung, die bloss eine Flaeche mit
 * `wiki_region_key` nennt, wiederholt genau das, was die Ortszeile (`lore_place` -> `?place=`)
 * laengst sagt -- das waere die zweite Wahrheit ueber dieselbe Aussage, vor der AGENTS.md §5 warnt.
 * Live betraefe das 1.155 der 1.572 ableitbaren Eintraege (gemessen 19.08.2026).
 *
 * 🔴 VORANGEHAEKELT IST NUR DIE VOLLSTAENDIGE ABLEITUNG. Wo etwas weggelassen wurde, ist die Regel
 * schmaler als ihre Quelle -- gemessen am Delphin: aus „alle Meere, auch Gewaesser um Thorwal,
 * Albernia, Windhag, die Zyklopeninseln und das Liebliche Feld" wird „Meer oder Küste innerhalb von
 * Windhag". Richtig, aber winzig. Solche Zeilen kommen ungehaekelt mit ihrer Verlustliste.
 *
 * @param array<string,mixed> $eintrag Zeile aus lore_entry
 * @param array<string, array{id:int, terms:list<array<string,mixed>>}> $bestehende
 * @return array{change_type:string, before:array<string,mixed>, after:array<string,mixed>, selected:int}|null
 */
function avesmapsLoreRulePlanItem(array $eintrag, array $bestehende, array $katalog): array|null
{
    $kind = (string) ($eintrag['kind'] ?? '');
    $lebensraum = (string) ($eintrag['lebensraum'] ?? '');
    $felder = avesmapsLoreRuleDeriveOrtsfelder($kind, $eintrag['merkmale_json'] ?? null);

    $terms = [];
    $saetze = [];
    $verworfen = [];
    $neu = false;
    foreach ($felder as $relation => $roh) {
        $vorschlag = avesmapsLoreRuleDeriveVorschlag($roh, $lebensraum, $katalog);
        $verworfen = array_merge($verworfen, $vorschlag['verworfen']);
        if ($vorschlag['terms'] === []) {
            continue;
        }
        $terms[$relation] = $vorschlag['terms'];
        $saetze[$relation] = $vorschlag['satz'];
        if ($vorschlag['neu']) {
            $neu = true;
        }
    }

    $altKern = avesmapsLoreRulePlanKern(array_map(
        static fn (array $regel): array => $regel['terms'],
        $bestehende
    ));
    $neuKern = avesmapsLoreRulePlanKern($terms);

    // Nichts abzuleiten, und es gab auch nie etwas -> keine Zeile.
    if ($terms === [] && $bestehende === []) {
        return null;
    }

    // Es gab eine abgeleitete Regel, das Wiki sagt dazu nichts mehr -> die dritte Kategorie.
    // 💣 Sie gehoert dem Verschwinden einer ganzen EINHEIT, und das ist hier erfuellt: die Regel
    // selbst verschwindet, nicht eine ihrer Bedingungen.
    if ($terms === []) {
        $bedingungen = 0;
        foreach ($bestehende as $regel) {
            $bedingungen += count($regel['terms']);
        }

        return [
            'change_type' => 'deleted',
            'before' => ['bedingungen' => $bedingungen],
            'after' => [],
            'selected' => avesmapsSyncPlanDefaultSelected('deleted', 0),
        ];
    }

    if (!$neu && $bestehende === []) {
        // Sagt nichts, was die Ortszeile nicht schon sagt -> gar nicht erst vorschlagen.
        return null;
    }
    if ($altKern === $neuKern) {
        return null; // unveraendert
    }

    $bedingungen = 0;
    foreach ($terms as $liste) {
        $bedingungen += count($liste);
    }
    $hinweis = avesmapsLoreRulePlanHinweis($verworfen);

    $after = [
        'regel' => avesmapsLoreRulePlanSatz($saetze),
        'bedingungen' => (string) $bedingungen,
    ];
    if ($hinweis !== '') {
        $after['regel_hinweis'] = $hinweis;
    }
    // Stiller Vergleichswert: er entscheidet, ob eine liegen gebliebene Vorschau ueberholt ist.
    $after['regel_kern'] = $neuKern;

    $changeType = $bestehende === [] ? 'new' : 'changed';
    $before = [];
    if ($changeType === 'changed') {
        $alteSaetze = [];
        $alteBedingungen = 0;
        foreach ($bestehende as $relation => $regel) {
            $alteSaetze[(string) $relation] = avesmapsLoreRuleDeriveSatz(
                $regel['terms'],
                avesmapsLoreRulePlanArtenAusTerms($regel['terms'], $katalog),
                $katalog
            );
            $alteBedingungen += count($regel['terms']);
        }
        $before = [
            'regel' => avesmapsLoreRulePlanSatz($alteSaetze),
            'bedingungen' => (string) $alteBedingungen,
        ];
    }

    return [
        'change_type' => $changeType,
        'before' => $before,
        'after' => $after,
        // 🔴 Nur die vollstaendige Ableitung kommt vorangehaekelt.
        'selected' => $verworfen === [] ? avesmapsSyncPlanDefaultSelected($changeType, 0) : 0,
    ];
}

/**
 * PURE: die Arten einer gespeicherten Kette, mit Beschriftung -- damit der ALTE Satz genauso gebaut
 * wird wie der neue (avesmapsLoreRuleDeriveSatz erwartet die Arten getrennt).
 *
 * @return list<array{kind:string, region_type:string, label:string}>
 */
function avesmapsLoreRulePlanArtenAusTerms(array $terms, array $katalog): array
{
    $out = [];
    $gesehen = [];
    foreach ($terms as $term) {
        foreach ((array) ($term['types'] ?? []) as $type) {
            $wert = (string) ($type['kind'] ?? '') . '|' . (string) ($type['region_type'] ?? '');
            if (isset($gesehen[$wert])) {
                continue;
            }
            $gesehen[$wert] = true;
            $out[] = [
                'kind' => (string) ($type['kind'] ?? ''),
                'region_type' => (string) ($type['region_type'] ?? ''),
                'label' => (string) ($katalog['arten_meta'][$wert] ?? ($type['region_type'] ?? '')),
            ];
        }
    }

    return $out;
}

/**
 * EIN begrenzter Rechenschritt. Wiederaufnehmbar ueber einen `wiki_key`-Hochwasserstand, genau wie
 * avesmapsLorePlanStep -- STRATO vertraegt keine serverseitige Schleife ueber ~5.100 Zeilen.
 *
 * @return array<string,int|bool|string|array>
 */
function avesmapsLoreRuleDerivePlanStep(PDO $pdo, string $cursor, int $userId): array
{
    avesmapsLoreRuleEnsureTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $stats = [
        'ok' => true, 'done' => false, 'nextCursor' => $cursor, 'run_id' => 0,
        'planned' => 0, 'processed_this_step' => 0, 'skipped_repeats' => 0,
        'counts' => ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0],
        'entries_empty' => false,
    ];

    $batch = $pdo->prepare(
        'SELECT wiki_key, name, kind, lebensraum, merkmale_json FROM ' . AVESMAPS_LORE_TABLE_ENTRY . '
          WHERE wiki_key > :cursor AND status = \'active\'
          ORDER BY wiki_key LIMIT ' . (int) AVESMAPS_LORE_RULE_PLAN_BATCH
    );
    $batch->execute(['cursor' => $cursor]);
    $zeilen = $batch->fetchAll(PDO::FETCH_ASSOC) ?: [];

    if ($zeilen === [] && $cursor === '') {
        // Kein Fehler, sondern ein Zustand: es gibt gar keine Vorkommen. `ok` BLEIBT true.
        // 🔴 UND VOR avesmapsSyncPlanStartRun -- ein hier eroeffneter Lauf setzte einen offenen,
        // guten Plan auf 'superseded': die Arbeit eines anderen Editors, weggeraeumt von einem
        // Klick, der nichts finden konnte (dieselbe Reihenfolge wie in avesmapsLorePlanStep).
        $stats['done'] = true;
        $stats['entries_empty'] = true;

        return $stats;
    }

    $runId = $cursor === ''
        ? avesmapsSyncPlanStartRun($pdo, AVESMAPS_LORE_RULE_PLAN_KIND, $userId, gmdate('d.m.Y H:i'))
        : (int) (avesmapsSyncPlanBuildingRun($pdo, AVESMAPS_LORE_RULE_PLAN_KIND)['id'] ?? 0);
    if ($runId <= 0) {
        throw new RuntimeException('Der Lauf wurde von einem zweiten abgeloest. Bitte neu starten.');
    }
    $stats['run_id'] = $runId;

    // EINMAL je Schritt, nie je Eintrag.
    $katalog = avesmapsLoreRulePlanKatalog($pdo);
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_LORE_RULE_PLAN_KIND);

    $nextCursor = $cursor;
    $processed = 0;
    $budgetHit = false;

    foreach ($zeilen as $zeile) {
        $nextCursor = (string) $zeile['wiki_key'];
        $processed++;

        $bestehende = avesmapsLoreRulePlanBestehende($pdo, $nextCursor);
        $item = avesmapsLoreRulePlanItem($zeile, $bestehende, $katalog);
        if ($item !== null) {
            $entscheidung = $entscheidungen[avesmapsSyncPlanDecisionKey($nextCursor, $item['change_type'])] ?? null;
            // Eine zweimal uebersprungene Aenderung kommt ungehaekelt zurueck -- aber eine, die schon
            // wegen ihrer Verlustliste ungehaekelt ist, wird davon nicht wieder angehaekelt.
            $selected = $item['selected'] === 0
                ? 0
                : avesmapsSyncPlanDefaultSelected($item['change_type'], (int) ($entscheidung['skipped_count'] ?? 0));
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $nextCursor,
                // Der Eintragsschluessel IST die public id -- Lore hat keine eigene.
                'entity_public_id' => $nextCursor,
                'change_type' => $item['change_type'],
                'label' => (string) ($zeile['name'] !== '' ? $zeile['name'] : $nextCursor),
                'before' => $item['before'],
                'after' => $item['after'],
                'override' => [],
                'selected' => $selected,
            ]);
            $stats['planned']++;
        }

        if (microtime(true) >= $deadline) {
            $budgetHit = true;
            break;
        }
    }

    $stats['processed_this_step'] = $processed;
    $stats['nextCursor'] = $nextCursor;
    $stats['done'] = !$budgetHit && count($zeilen) < AVESMAPS_LORE_RULE_PLAN_BATCH;

    if ($stats['done']) {
        $stats['counts'] = avesmapsSyncPlanFinishBuild($pdo, $runId);
    }

    return $stats;
}
