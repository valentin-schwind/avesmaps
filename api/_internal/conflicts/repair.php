<?php

declare(strict_types=1);

/**
 * Conflict centre -- the repair verbs.
 * =========================================================================
 * P1 could only record a verdict; this is what actually changes the map. Every write goes through
 * the canonical revision bump and the map audit log, exactly like an editor's own edit, so nothing
 * here is invisible or unrevertable.
 *
 * TWO SAFETY RULES, both deliberate:
 *
 *  1. A claim that lives inside a wiki BLOCK (wiki_settlement / wiki_region / wiki_path) is never
 *     touched. Those blocks carry the whole infobox payload -- population, region, coat, course --
 *     and deleting one to drop an identity claim would throw away data the conflict never asked
 *     about. Such a party is refused with a message pointing at the editor that owns it.
 *  2. An unlink target must still claim the URL the conflict was about. Between listing and
 *     clicking, somebody else may have fixed it; without the check we would silently clear a link
 *     that has nothing to do with this case.
 */

require_once __DIR__ . '/core.php';
require_once __DIR__ . '/../map/features.php';

// Where a party's wiki claim is stored. Only the plain field is safely removable (rule 1 above).
const AVESMAPS_CONFLICT_CLAIM_FIELD = 'wiki_url';

/**
 * Mark "this object has no wiki article" -- the negative assertion Discord #38 was missing.
 *
 * Clearing a link is not enough on its own: the map-features enrichment cannot tell "deliberately
 * emptied" from "never set" and simply guesses a link back in. This flag is what makes a removal
 * stick, and avesmapsEnrichMapFeatureWikiUrl() honours it.
 */
const AVESMAPS_CONFLICT_NO_ARTICLE_FLAG = 'wiki_no_article';

/**
 * Clear one feature's plain wiki claim, optionally recording that it has no article at all.
 *
 * @return array{ok:bool, public_id:string, changed:bool, reason?:string}
 */
function avesmapsConflictUnlinkFeature(PDO $pdo, string $publicId, string $expectedUrl, bool $markNoArticle, int $userId): array {
    $select = $pdo->prepare(
        "SELECT id, name, properties_json FROM map_features
         WHERE public_id = :p AND is_active = 1 LIMIT 1"
    );
    $select->execute(['p' => $publicId]);
    $feature = $select->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => 'Objekt nicht gefunden.'];
    }

    $properties = json_decode((string) ($feature['properties_json'] ?? '{}'), true);
    if (!is_array($properties)) {
        $properties = [];
    }
    $before = json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $plainClaim = trim((string) ($properties[AVESMAPS_CONFLICT_CLAIM_FIELD] ?? ''));
    $blockClaim = trim((string) (
        $properties['wiki_settlement']['wiki_url']
        ?? $properties['wiki_region']['wiki_url']
        ?? $properties['wiki_path']['wiki_url']
        ?? ''
    ));

    // Safety rule 2: only touch a party that still claims the URL this conflict was about.
    if ($expectedUrl !== '' && $plainClaim !== '' && $plainClaim !== $expectedUrl) {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false,
            'reason' => 'Der Link hat sich inzwischen geändert — bitte neu prüfen.'];
    }

    // Safety rule 1: a block-borne claim belongs to its own editor, not to a blind unset here.
    if ($plainClaim === '' && $blockClaim !== '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false,
            'reason' => 'Diese Verknüpfung stammt aus der Wiki-Zuordnung. Bitte im zuständigen Editor lösen — dort hängt die ganze Infobox dran.'];
    }

    unset($properties[AVESMAPS_CONFLICT_CLAIM_FIELD]);
    if ($markNoArticle) {
        $properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG] = true;
    } else {
        unset($properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG]);
    }

    $revision = avesmapsNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev, updated_by = :by WHERE id = :id');
    $update->execute([
        'pj' => json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'rev' => $revision,
        'by' => $userId > 0 ? $userId : null,
        'id' => (int) $feature['id'],
    ]);

    avesmapsWriteMapAuditLog(
        $pdo,
        (int) $feature['id'],
        $markNoArticle ? 'conflict_no_article' : 'conflict_unlink',
        $userId,
        (string) $before,
        (string) json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );

    return ['ok' => true, 'public_id' => $publicId, 'changed' => true, 'name' => (string) $feature['name']];
}

/**
 * Apply one resolution across a conflict's parties, in a transaction.
 *
 * mode 'unlink'   -- drop the claim on every target
 * mode 'no_wiki'  -- drop it AND record that there is no article (makes the removal stick)
 *
 * "Behält den Link" is expressed by the caller as: unlink every party EXCEPT the keeper. There is
 * no separate verb for it, so the keeper is never written to -- the safest possible way to say
 * "leave that one alone".
 *
 * @return array{ok:bool, applied:int, results:list<array<string,mixed>>}
 */
function avesmapsConflictResolve(PDO $pdo, array $input, int $userId): array {
    $mode = trim((string) ($input['mode'] ?? ''));
    if (!in_array($mode, ['unlink', 'no_wiki'], true)) {
        throw new RuntimeException('Unbekannter Reparatur-Modus.');
    }
    $targets = is_array($input['targets'] ?? null) ? $input['targets'] : [];
    if ($targets === []) {
        throw new RuntimeException('Keine Ziele angegeben.');
    }
    $expectedUrl = trim((string) ($input['wiki_url'] ?? ''));

    $results = [];
    $applied = 0;
    $pdo->beginTransaction();
    try {
        foreach ($targets as $target) {
            $publicId = trim((string) ($target['id'] ?? ''));
            if ($publicId === '') {
                continue;
            }
            $result = avesmapsConflictUnlinkFeature($pdo, $publicId, $expectedUrl, $mode === 'no_wiki', $userId);
            $results[] = $result;
            if (!empty($result['changed'])) {
                $applied++;
            }
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    return ['ok' => true, 'applied' => $applied, 'results' => $results];
}
