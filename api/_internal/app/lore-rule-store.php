<?php

declare(strict_types=1);

// Schema, Lesen und Schreiben der Lebensraum-Regeln. Die REINE Auswertung steht in
// lore-rule.php und bekommt bewusst kein PDO.
//
// 💣 EIGENE TABELLEN, nicht lore_place -- und das ist keine Umgehung der Warnung in
// AGENTS.md §5, sondern ihr Gegenteil: lore_place speichert eine ANTWORT (dieser Ort),
// lore_rule eine FRAGE (welche Orte). Eine Regel hat keinen place_wiki_key; ein
// synthetischer Schluessel muesste auf dem heissen Lesepfad geparst werden.
//
// 💣 Eine Regel ist IMMER origin='manual'. avesmapsLoreReconcile legt Ortszeilen per
// delete+insert neu an und fasst nur origin='wiki' an -- eine Regel mit origin='wiki'
// waere beim naechsten „Vorkommen syncen" weg. Der Sync kennt diese Tabellen nicht.

/** Selbstheilendes Schema. NUR aus Editor-Zweigen aufrufen, nie im heissen Lesepfad. */
function avesmapsLoreRuleEnsureTables(PDO $pdo): void
{
    // ⚠️ Zwei Dialekte, EIN Schema: die Tests laufen gegen sqlite (es gibt lokal keine
    // MySQL-Instanz, siehe AGENTS.md), scharf laeuft MySQL. sqlite kennt kein
    // AUTO_INCREMENT/ENGINE, MySQL kein "CREATE INDEX IF NOT EXISTS" vor 8.0.
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $id = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $tail = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $now = $sqlite ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP(3)';
    $stamp = $sqlite ? 'DATETIME' : 'DATETIME(3)';

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule (
            id             ' . $id . ',
            entry_wiki_key VARCHAR(190) NOT NULL,
            relation       VARCHAR(20) NOT NULL DEFAULT \'verbreitung\',
            origin         VARCHAR(16) NOT NULL DEFAULT \'manual\',
            status         VARCHAR(16) NOT NULL DEFAULT \'active\',
            sort_order     INT NOT NULL DEFAULT 0,
            created_at     ' . $stamp . ' NOT NULL DEFAULT ' . $now . ',
            created_by     BIGINT UNSIGNED NULL'
        . ($sqlite ? '' : ', KEY idx_lore_rule_entry (entry_wiki_key, status)') . ')' . $tail
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term (
            id             ' . $id . ',
            rule_id        BIGINT UNSIGNED NOT NULL,
            seq            INT NOT NULL,
            join_op        VARCHAR(4) NOT NULL DEFAULT \'und\',
            area_public_id CHAR(36) NULL,
            climate_from   VARCHAR(60) NULL,
            climate_to     VARCHAR(60) NULL,
            UNIQUE ' . ($sqlite ? '' : 'KEY uq_lore_rule_term ') . '(rule_id, seq)'
        . ($sqlite ? '' : ', KEY idx_lore_rule_term_area (area_public_id)') . ')' . $tail
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term_type (
            term_id     BIGINT UNSIGNED NOT NULL,
            kind        VARCHAR(20) NOT NULL,
            region_type VARCHAR(60) NOT NULL,
            PRIMARY KEY (term_id, kind, region_type)'
        . ($sqlite ? '' : ', KEY idx_lore_rule_term_type_lookup (kind, region_type)') . ')' . $tail
    );
    if ($sqlite) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_lore_rule_entry ON lore_rule (entry_wiki_key, status)');
    }
}

/**
 * Legt eine Regel an oder ERSETZT die Bedingungen einer bestehenden.
 *
 * Ersetzen, nicht anhaengen: die Reihenfolge der Bedingungen IST die Auswertungsreihenfolge,
 * und eine halb ersetzte Kette rechnet still etwas anderes als die Vorschau zeigte.
 *
 * @param list<array<string,mixed>> $terms
 */
function avesmapsLoreRuleSave(
    PDO $pdo,
    string $entryWikiKey,
    array $terms,
    string $relation,
    ?int $userId,
    ?int $ruleId = null
): int {
    if ($ruleId === null) {
        $insert = $pdo->prepare(
            'INSERT INTO lore_rule (entry_wiki_key, relation, origin, status, created_by)
             VALUES (:wk, :rel, \'manual\', \'active\', :user)'
        );
        $insert->execute(['wk' => $entryWikiKey, 'rel' => $relation, 'user' => $userId]);
        $ruleId = (int) $pdo->lastInsertId();
    } else {
        $update = $pdo->prepare('UPDATE lore_rule SET relation = :rel WHERE id = :id');
        $update->execute(['rel' => $relation, 'id' => $ruleId]);
    }

    $oldTerms = $pdo->prepare('SELECT id FROM lore_rule_term WHERE rule_id = :id');
    $oldTerms->execute(['id' => $ruleId]);
    foreach ($oldTerms->fetchAll(PDO::FETCH_COLUMN) ?: [] as $termId) {
        $pdo->prepare('DELETE FROM lore_rule_term_type WHERE term_id = :id')->execute(['id' => $termId]);
    }
    $pdo->prepare('DELETE FROM lore_rule_term WHERE rule_id = :id')->execute(['id' => $ruleId]);

    $insertTerm = $pdo->prepare(
        'INSERT INTO lore_rule_term (rule_id, seq, join_op, area_public_id, climate_from, climate_to)
         VALUES (:rule, :seq, :join, :area, :from, :to)'
    );
    $insertType = $pdo->prepare(
        'INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (:term, :kind, :type)'
    );
    foreach (array_values($terms) as $seq => $term) {
        $insertTerm->execute([
            'rule' => $ruleId,
            'seq' => $seq,
            'join' => ($term['join_op'] ?? 'und') === 'oder' ? 'oder' : 'und',
            'area' => $term['area_public_id'] ?? null,
            'from' => $term['climate_from'] ?? null,
            'to' => $term['climate_to'] ?? null,
        ]);
        $termId = (int) $pdo->lastInsertId();
        foreach ((array) ($term['types'] ?? []) as $type) {
            $insertType->execute([
                'term' => $termId,
                'kind' => (string) ($type['kind'] ?? ''),
                'type' => (string) ($type['region_type'] ?? ''),
            ]);
        }
    }

    return $ruleId;
}

/**
 * Alle aktiven Regeln eines Eintrags, fertig fuer avesmapsLoreRuleEvaluate.
 *
 * @return list<array{id: int, relation: string, terms: list<array<string,mixed>>}>
 */
function avesmapsLoreRuleReadForEntry(PDO $pdo, string $entryWikiKey): array
{
    $rules = $pdo->prepare(
        'SELECT id, relation FROM lore_rule
         WHERE entry_wiki_key = :wk AND status = \'active\' ORDER BY sort_order, id'
    );
    $rules->execute(['wk' => $entryWikiKey]);
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
        $out[] = ['id' => (int) $row['id'], 'relation' => (string) $row['relation'], 'terms' => $terms];
    }

    return $out;
}

/** Loescht eine Regel samt ihrer Bedingungen. false = es gab sie nicht. */
function avesmapsLoreRuleDelete(PDO $pdo, int $ruleId): bool
{
    $terms = $pdo->prepare('SELECT id FROM lore_rule_term WHERE rule_id = :id');
    $terms->execute(['id' => $ruleId]);
    foreach ($terms->fetchAll(PDO::FETCH_COLUMN) ?: [] as $termId) {
        $pdo->prepare('DELETE FROM lore_rule_term_type WHERE term_id = :id')->execute(['id' => $termId]);
    }
    $pdo->prepare('DELETE FROM lore_rule_term WHERE rule_id = :id')->execute(['id' => $ruleId]);
    $delete = $pdo->prepare('DELETE FROM lore_rule WHERE id = :id');
    $delete->execute(['id' => $ruleId]);

    return $delete->rowCount() > 0;
}
