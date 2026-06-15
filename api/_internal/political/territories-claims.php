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
            'SELECT territory.id, territory.public_id, territory.name, territory.color, territory.opacity,
                    COALESCE(territory.wiki_key, wiki.wiki_key) AS wiki_key
            FROM political_territory territory
            LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
            WHERE territory.public_id = :public_id AND territory.is_active = 1
            LIMIT 1'
        );
        $statement->execute([':public_id' => strtolower($raw)]);
    } else {
        // wiki_key-Auflösung robust gegen die "wiki:"-Prefix-Frage: die DB speichert den Key MIT Prefix
        // (z. B. "wiki:baronie-ebersberg"). Wir matchen daher alle Formen (roh / ohne / mit Prefix) sowohl
        // gegen political_territory.wiki_key (kanonisch, aber nicht überall gefüllt) ALS AUCH gegen die
        // Staging-Wiki-Tabelle über territory.wiki_id. So greift es egal welche Form der Aufrufer schickt.
        $strippedKey = stripos($raw, 'wiki:') === 0 ? trim(substr($raw, 5)) : $raw;
        $prefixedKey = 'wiki:' . $strippedKey;
        $statement = $pdo->prepare(
            'SELECT territory.id, territory.public_id, territory.name, territory.color, territory.opacity,
                    COALESCE(territory.wiki_key, wiki.wiki_key) AS wiki_key
            FROM political_territory territory
            LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
            WHERE territory.is_active = 1
              AND (
                territory.wiki_key IN (:t_raw, :t_stripped, :t_prefixed)
                OR wiki.wiki_key IN (:w_raw, :w_stripped, :w_prefixed)
              )
            ORDER BY territory.id ASC
            LIMIT 1'
        );
        $statement->execute([
            ':t_raw' => $raw, ':t_stripped' => $strippedKey, ':t_prefixed' => $prefixedKey,
            ':w_raw' => $raw, ':w_stripped' => $strippedKey, ':w_prefixed' => $prefixedKey,
        ]);
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
        'wiki_key' => (string) ($row['wiki_key'] ?? ''),
    ];
}

// Vorschläge aus dem gesyncten Wiki: liest die Konflikt-Parteien (parent_conflict_json) des Gebiets aus dem
// WikiSync-Modell und löst sie auf echte Territorien auf (Farbe/ID). Nur Auflösbares wird zurückgegeben ->
// der bekannte Parse-Müll (wid|, ex|, Zeit-/Status-Klauseln) filtert sich von selbst raus. Bereits gesetzte
// Claims werden ausgeblendet. So muss man nicht manuell suchen.
function avesmapsPoliticalSuggestClaims(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $query['territory_public_id'] ?? $query['territoryPublicId'] ?? ''
    );

    // Modell-Lookup-Key: bevorzugt die wiki_key-Eingabe (am direktesten), sonst der wiki_key des Gebiets.
    $rawInput = trim((string) ($query['territory_public_id'] ?? $query['territoryPublicId'] ?? ''));
    $isUuid = preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $rawInput) === 1;
    $modelKey = (!$isUuid && $rawInput !== '') ? $rawInput : (string) ($territory['wiki_key'] ?? '');

    $suggestions = [];
    if ($modelKey !== '') {
        $stripped = stripos($modelKey, 'wiki:') === 0 ? trim(substr($modelKey, 5)) : $modelKey;
        $prefixed = 'wiki:' . $stripped;
        // Tabelle wiki_territory_model (= AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE im WikiSync-Modul).
        $modelStatement = $pdo->prepare(
            'SELECT parent_conflict_json FROM wiki_territory_model
            WHERE wiki_key IN (:k_raw, :k_stripped, :k_prefixed) LIMIT 1'
        );
        $modelStatement->execute([':k_raw' => $modelKey, ':k_stripped' => $stripped, ':k_prefixed' => $prefixed]);
        $conflictJson = $modelStatement->fetchColumn();
        $conflicts = is_string($conflictJson) ? (json_decode($conflictJson, true) ?: []) : [];

        // Bereits aktive Claims ausblenden.
        $existing = [];
        $existingStatement = $pdo->prepare(
            'SELECT claimant_territory_id FROM political_territory_claim WHERE territory_id = :territory_id AND is_active = 1'
        );
        $existingStatement->execute([':territory_id' => $territory['id']]);
        foreach ($existingStatement->fetchAll(PDO::FETCH_COLUMN) as $claimantId) {
            $existing[(int) $claimantId] = true;
        }

        // Exakter Namens-Treffer als Fallback, falls der Konflikt keinen auflösbaren wiki_key trägt.
        $nameStatement = $pdo->prepare(
            'SELECT id, public_id, name, color, opacity FROM political_territory
            WHERE is_active = 1 AND name = :name ORDER BY id ASC LIMIT 1'
        );

        $seen = [];
        foreach ($conflicts as $conflict) {
            if (!is_array($conflict)) {
                continue;
            }
            $conflictName = trim((string) ($conflict['name'] ?? ''));
            $conflictWikiKey = trim((string) ($conflict['wiki_key'] ?? ''));

            $resolved = null;
            if ($conflictWikiKey !== '') {
                try { $resolved = avesmapsPoliticalClaimResolveTerritory($pdo, $conflictWikiKey); } catch (InvalidArgumentException $error) { $resolved = null; }
            }
            if ($resolved === null && $conflictName !== '') {
                $nameStatement->execute([':name' => $conflictName]);
                $nameRow = $nameStatement->fetch(PDO::FETCH_ASSOC);
                if (is_array($nameRow)) {
                    $resolved = [
                        'id' => (int) $nameRow['id'],
                        'public_id' => (string) $nameRow['public_id'],
                        'name' => (string) $nameRow['name'],
                        'color' => avesmapsPoliticalClaimNormalizeColor((string) $nameRow['color']),
                        'opacity' => (float) $nameRow['opacity'],
                    ];
                }
            }

            if ($resolved === null) {
                continue; // nicht auflösbar -> Parse-Müll, überspringen
            }
            $resolvedId = (int) $resolved['id'];
            if ($resolvedId === (int) $territory['id'] || isset($existing[$resolvedId]) || isset($seen[$resolvedId])) {
                continue;
            }
            $seen[$resolvedId] = true;
            $suggestions[] = [
                'claimant_public_id' => $resolved['public_id'],
                'claimant_name' => $resolved['name'],
                'claimant_wiki_key' => $conflictWikiKey,
                'wiki_name' => $conflictName,
                'color' => $resolved['color'],
                'opacity' => $resolved['opacity'],
            ];
        }
    }

    return [
        'ok' => true,
        'territory_public_id' => $territory['public_id'],
        'territory_name' => $territory['name'],
        'suggestions' => $suggestions,
    ];
}

// Liste der aktiven Claims eines Gebiets (Anspruchsteller mit Farbe/Deckkraft, Streifen-Reihenfolge).
function avesmapsPoliticalListClaims(PDO $pdo, array $query): array {
    $requestedKey = (string) ($query['territory_public_id'] ?? $query['territoryPublicId'] ?? '');
    try {
        $territory = avesmapsPoliticalClaimResolveTerritory($pdo, $requestedKey);
    } catch (InvalidArgumentException $resolveError) {
        // Lese-Aufruf: ein noch nicht platzierter / unbekannter Wiki-Knoten (der Editor-Breadcrumb kann
        // durch Wiki-Knoten ohne eigenes political_territory zykeln) hat schlicht keine Claims. Das ist
        // KEIN Fehler -> leere Liste statt 400, damit die Konsole beim Durchschalten nicht voll-spamt.
        return [
            'ok' => true,
            'territory_public_id' => $requestedKey,
            'territory_name' => '',
            'owner' => null,
            'claims' => [],
        ];
    }

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

// R2: Ziel zum Oeffnen des Territoriumseditors aufloesen — aus einem wiki_key (oder UUID) das Gebiet +
// dessen erste aktive Geometrie ermitteln. Der Editor braucht die geometry_public_id, um den Knoten
// tatsaechlich zu laden (nicht nur die leere Huelle). Genutzt vom WikiSync-Button "im Editor bearbeiten".
function avesmapsPoliticalResolveEditorTarget(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalClaimResolveTerritory(
        $pdo,
        $query['territory_public_id'] ?? $query['wiki_key'] ?? $query['territoryPublicId'] ?? ''
    );
    $statement = $pdo->prepare(
        'SELECT public_id FROM political_territory_geometry
        WHERE territory_id = :territory_id AND is_active = 1
        ORDER BY id ASC LIMIT 1'
    );
    $statement->execute([':territory_id' => $territory['id']]);
    $geometryPublicId = (string) ($statement->fetchColumn() ?: '');

    return [
        'ok' => true,
        'territory_public_id' => $territory['public_id'],
        'geometry_public_id' => $geometryPublicId,
        'name' => $territory['name'],
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

    // New claims go to the end of the stripe order; serialize concurrent adds with a row lock.
    $pdo->beginTransaction();
    $maxStatement = $pdo->prepare(
        'SELECT COALESCE(MAX(sort_order), -1) FROM political_territory_claim WHERE territory_id = :territory_id AND is_active = 1 FOR UPDATE'
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

    $pdo->commit();

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
