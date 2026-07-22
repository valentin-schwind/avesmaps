<?php

declare(strict_types=1);

// Pure helper for the community "Änderung vorschlagen" (suggest change) flow. The infopanel button opens
// the existing report form in a "change mode": it sends report_mode=change plus a reference to the
// existing element (entity_type + entity_public_id). This normalizer whitelists those fields. No DB, no
// globals -> unit-testable in isolation (see __tests__/report-context-test.php).

const AVESMAPS_CHANGE_ENTITY_TYPES = ['settlement', 'region', 'territory', 'path', 'powerline'];

function avesmapsNormalizeChangeContext(array $payload): array {
    $mode = strtolower(trim((string) ($payload['report_mode'] ?? 'new')));
    if ($mode !== 'change') {
        return ['mode' => 'new', 'entity_type' => '', 'entity_public_id' => ''];
    }

    $entityType = strtolower(trim((string) ($payload['entity_type'] ?? '')));
    if (!in_array($entityType, AVESMAPS_CHANGE_ENTITY_TYPES, true)) {
        $entityType = '';
    }

    $entityPublicId = trim((string) ($payload['entity_public_id'] ?? ''));
    if (strlen($entityPublicId) > 80) {
        $entityPublicId = substr($entityPublicId, 0, 80);
    }

    return ['mode' => 'change', 'entity_type' => $entityType, 'entity_public_id' => $entityPublicId];
}
