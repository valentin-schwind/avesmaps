<?php

declare(strict_types=1);

/*
 * Umstrittene Gebiete — Claims (Anspruchsteller) lesen/schreiben.
 *
 * Additive Tabelle political_territory_claim (angelegt in territory.php / avesmapsPoliticalEnsureTables).
 * Das Besitz-Modell bleibt unangetastet; "umstritten" ist ABGELEITET (>=1 aktiver Claim). Ein Anspruchsteller
 * ist ein echtes Territorium -> liefert Farbe/Deckkraft live (kein Kopieren). Keine FK-Constraints,
 * Soft-Delete ueber is_active (Hauskonvention). Der Layer liest die Parteien separat
 * (avesmapsPoliticalAttachContestedParties in territories-layer.php) und liefert sie pro Feature mit.
 */

// Farbe auf #RRGGBB normalisieren (Deckkraft kommt getrennt aus territory.opacity).
function avesmapsPoliticalClaimNormalizeColor(string $color): string {
    $color = trim($color);
    return preg_match('/^#[0-9a-fA-F]{6}/', $color) === 1 ? substr($color, 0, 7) : '#888888';
}

// Loest eine Territory-Referenz (UUID oder stabiler wiki:-Key) auf die aktive political_territory-Zeile auf.
function avesmapsPoliticalClaimResolveTerritory(PDO $pdo, mixed $value): array {
    $raw = trim((string) $value);
    if ($raw === '') {
        throw new InvalidArgumentException('Es wurde kein Territorium angegeben.');
    }

    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $raw) === 1) {
        $statement = $pdo->prepare(
            'SELECT id, public_id, name, color, opacity
            FROM political_territory
            WHERE public_id = :public_id AND is_active = 1
            LIMIT 1'
        );
        $statement->execute([':public_id' => strtolower($raw)]);
    } else {
        $wikiKey = stripos($raw, 'wiki:') === 0 ? trim(substr($raw, 5)) : $raw;
        $statement = $pdo->prepare(
            'SELECT territory.id, territory.public_id, territory.name, territory.color, territory.opacity
            FROM political_territory territory
            INNER JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
            WHERE wiki.wiki_key = :wiki_key AND territory.is_active = 1
            ORDER BY territory.id ASC
            LIMIT 1'
        );
        $statement->execute([':wiki_key' => $wikiKey]);
    }

    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        throw new InvalidArgumentException('Das Territorium wurde nicht gefunden: ' . $raw);
    }

    return [
        'id' => (int) $row['id'],
        'public_id' => (string) $row['public_id'],
        'name' => (string) $row['name'],
        'color' => avesmapsPoliticalClaimNormalizeColor((string) $row['color']),
        'opacity' => (float) $row['opacity'],
    ];
}

// Liste der aktiven Claims eines Gebiets (Anspruchsteller mit Farbe/Deckkraft, Streifen-Reihenfolge).
function avesmapsPoliticalListClaims(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $query['territory_public_id'] ?? $query['territoryPublicId'] ?? ''
    );

    $statement = $pdo->prepare(
        'SELECT claim.id, claim.sort_order, claim.source, claim.claimant_wiki_key,
                claimant.public_id AS claimant_public_id, claimant.name AS claimant_name,
                claimant.color AS claimant_color, claimant.opacity AS claimant_opacity
        FROM political_territory_claim claim
        INNER JOIN political_territory claimant ON claimant.id = claim.claimant_territory_id AND claimant.is_active = 1
        WHERE claim.territory_id = :territory_id AND claim.is_active = 1
        ORDER BY claim.sort_order ASC, claim.id ASC'
    );
    $statement->execute([':territory_id' => $territory['id']]);

    $claims = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $claims[] = [
            'id' => (int) $row['id'],
            'sort_order' => (int) $row['sort_order'],
            'source' => (string) $row['source'],
            'claimant_wiki_key' => (string) ($row['claimant_wiki_key'] ?? ''),
            'claimant_public_id' => (string) $row['claimant_public_id'],
            'claimant_name' => (string) $row['claimant_name'],
            'color' => avesmapsPoliticalClaimNormalizeColor((string) $row['claimant_color']),
            'opacity' => (float) $row['claimant_opacity'],
        ];
    }

    return [
        'ok' => true,
        'territory_public_id' => $territory['public_id'],
        'territory_name' => $territory['name'],
        'owner' => ['color' => $territory['color'], 'opacity' => $territory['opacity']],
        'claims' => $claims,
    ];
}

// Anspruchsteller hinzufuegen (idempotent: reaktiviert einen evtl. soft-geloeschten Claim).
function avesmapsPoliticalAddClaim(PDO $pdo, array $payload, array $user): array {
    $territory = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $payload['territory_public_id'] ?? $payload['territoryPublicId'] ?? ''
    );
    $claimant = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $payload['claimant_public_id'] ?? $payload['claimantPublicId'] ?? ''
    );

    if ($territory['id'] === $claimant['id']) {
        throw new InvalidArgumentException('Ein Gebiet kann sich nicht selbst beanspruchen.');
    }

    $source = avesmapsNormalizeSingleLine((string) ($payload['source'] ?? 'manual'), 16);
    if (!in_array($source, ['manual', 'wiki'], true)) {
        $source = 'manual';
    }
    $wikiKey = avesmapsNormalizeSingleLine((string) ($payload['claimant_wiki_key'] ?? ''), 255);
    $wikiKeyParam = $wikiKey !== '' ? $wikiKey : null;
    $userId = ((int) ($user['id'] ?? 0)) ?: null;

    // Neue Claims ans Ende der Streifen-Reihenfolge.
    $maxStatement = $pdo->prepare(
        'SELECT COALESCE(MAX(sort_order), -1) FROM political_territory_claim WHERE territory_id = :territory_id AND is_active = 1'
    );
    $maxStatement->execute([':territory_id' => $territory['id']]);
    $sortOrder = ((int) $maxStatement->fetchColumn()) + 1;

    $statement = $pdo->prepare(
        'INSERT INTO political_territory_claim
            (territory_id, claimant_territory_id, sort_order, source, claimant_wiki_key,
             is_active, created_by, updated_by, created_at, updated_at)
        VALUES
            (:territory_id, :claimant_id, :sort_order, :source, :wiki_key,
             1, :created_by, :updated_by, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            is_active = 1,
            source = VALUES(source),
            claimant_wiki_key = VALUES(claimant_wiki_key),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute([
        ':territory_id' => $territory['id'],
        ':claimant_id' => $claimant['id'],
        ':sort_order' => $sortOrder,
        ':source' => $source,
        ':wiki_key' => $wikiKeyParam,
        ':created_by' => $userId,
        ':updated_by' => $userId,
    ]);

    $list = avesmapsPoliticalListClaims($pdo, ['territory_public_id' => $territory['public_id']]);

    return [
        'ok' => true,
        'territory_public_id' => $territory['public_id'],
        'territory_name' => $territory['name'],
        'claimant_public_id' => $claimant['public_id'],
        'claimant_name' => $claimant['name'],
        'claims' => $list['claims'],
    ];
}

// Anspruchsteller entfernen (Soft-Delete). Mit dem letzten entfernten Claim ist das Gebiet wieder normal.
function avesmapsPoliticalRemoveClaim(PDO $pdo, array $payload, array $user): array {
    $territory = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $payload['territory_public_id'] ?? $payload['territoryPublicId'] ?? ''
    );
    $claimant = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $payload['claimant_public_id'] ?? $payload['claimantPublicId'] ?? ''
    );
    $userId = ((int) ($user['id'] ?? 0)) ?: null;

    $statement = $pdo->prepare(
        'UPDATE political_territory_claim
        SET is_active = 0, updated_by = :updated_by, updated_at = CURRENT_TIMESTAMP(3)
        WHERE territory_id = :territory_id AND claimant_territory_id = :claimant_id AND is_active = 1'
    );
    $statement->execute([
        ':updated_by' => $userId,
        ':territory_id' => $territory['id'],
        ':claimant_id' => $claimant['id'],
    ]);

    $list = avesmapsPoliticalListClaims($pdo, ['territory_public_id' => $territory['public_id']]);

    return [
        'ok' => true,
        'removed' => $statement->rowCount(),
        'territory_public_id' => $territory['public_id'],
        'claims' => $list['claims'],
    ];
}
