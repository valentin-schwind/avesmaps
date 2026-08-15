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
 *  1. A claim that lives inside a wiki BLOCK (AVESMAPS_CONFLICT_CLAIM_BLOCKS in core.php) is never
 *     touched. Those blocks carry the whole infobox payload -- population, region, coat, course --
 *     and deleting one to drop an identity claim would throw away data the conflict never asked
 *     about. Such a party is refused with a message pointing at the editor that owns it.
 *  2. An unlink target must still claim the URL the conflict was about. Between listing and
 *     clicking, somebody else may have fixed it; without the check we would silently clear a link
 *     that has nothing to do with this case.
 */

require_once __DIR__ . '/core.php';
require_once __DIR__ . '/../map/features.php';
require_once __DIR__ . '/rules.php';

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
 * REIN: Wirkt ein Reparatur-Schreibvorgang auf den ganzen NAMENSVERBUND oder nur auf die eine Zeile?
 *
 * Bei den segmentierten Arten ist ein Fall im Konfliktzentrum eine LINIE, kein Segment:
 * avesmapsConflictRuleMissingKey wertet je Segment, und avesmapsConflictCollapseSegmentsByName fasst
 * danach nach Namen zusammen -- am Knopf steht also "6 Segmente". Traefe der Schreibvorgang trotzdem
 * nur das eine Segment, dessen public_id die zusammengefasste Zeile zufaellig mitfuehrt, bliebe der
 * Fall mit 5 Segmenten stehen. Genau der Livebestandsfall, der diesen Umbau ausgeloest hat.
 *
 * 🔴 DIES IST DIE EINE STELLE, an der sich die Reichweite wieder eng ziehen laesst -- ein `false`
 * hier macht den Verb wieder einzeilig, ohne dass jemand eine zweite Abfrage im Schreibpfad suchen
 * muss. Die Liste selbst steht in core.php und NUR dort (AVESMAPS_CONFLICT_SEGMENTED_TYPES).
 *
 * Ein Objekt ohne Namen faellt heraus: sein "Verbund" waere jedes andere namenlose Objekt seiner Art.
 */
function avesmapsConflictUnlinkSpansNameGroup(string $featureType, string $name): bool {
    return trim($name) !== '' && in_array($featureType, AVESMAPS_CONFLICT_SEGMENTED_TYPES, true);
}

/**
 * REIN: Der Verbund-Schluessel einer Zeile, oder '' wenn sie fuer sich allein steht.
 *
 * 💣 Gebraucht, weil ein einzelner Aufruf MEHRERE Segmente derselben Linie als Ziele bekommen kann:
 * ein geteilter Artikel wird NICHT nach Namen zusammengefasst (avesmapsConflictCollapseSegmentsByName
 * fasst nur Faelle mit genau einer Partei), also stehen die 26 Segmente der "Reichsstraße 1" dort
 * einzeln, und "Behält den Link" schickt sie alle. Ohne diesen Schluessel schriebe der erste Ziel-
 * aufruf den ganzen Verbund, und die 25 folgenden liefen in Sicherheitsregel 1 ("stammt aus der
 * Wiki-Zuordnung") -- 25 Fehlermeldungen fuer eine gelungene Reparatur.
 *
 * Kleingeschrieben, weil avesmapsConflictCollapseSegmentsByName ebenso zusammenfasst und MySQL
 * ohnehin ohne Ruecksicht auf Gross-/Kleinschreibung vergleicht.
 */
function avesmapsConflictUnlinkGroupKey(string $featureType, string $name): string {
    return avesmapsConflictUnlinkSpansNameGroup($featureType, $name)
        ? $featureType . '|' . mb_strtolower(trim($name), 'UTF-8')
        : '';
}

/**
 * REIN: Sicherheitsregel 1 und 2, je ZEILE. Leerer String = darf geschrieben werden, sonst die
 * Begruendung. Die Regeln gelten unveraendert -- neu ist nur, dass sie ueber mehrere Zeilen laufen
 * koennen und eine verletzende Zeile UEBERSPRUNGEN wird, statt den ganzen Vorgang abzubrechen.
 */
function avesmapsConflictUnlinkRowRefusal(array $properties, string $expectedUrl): string {
    // Welche Nester es gibt, steht in core.php und NUR dort (AVESMAPS_CONFLICT_CLAIM_BLOCKS) --
    // diese Liste war hier abgeschrieben, und die Abschrift kannte 'wiki_powerline' nicht.
    $claim = avesmapsConflictExtractClaim($properties);
    $plainClaim = $claim['claim_source'] === AVESMAPS_CONFLICT_CLAIM_FIELD ? $claim['wiki_url'] : '';
    $blockClaim = ($claim['claim_source'] !== '' && $claim['claim_source'] !== AVESMAPS_CONFLICT_CLAIM_FIELD)
        ? $claim['wiki_url']
        : '';

    // Safety rule 2: only touch a party that still claims the URL this conflict was about.
    if ($expectedUrl !== '' && $plainClaim !== '' && $plainClaim !== $expectedUrl) {
        return 'Der Link hat sich inzwischen geändert — bitte neu prüfen.';
    }

    // Safety rule 1: a block-borne claim belongs to its own editor, not to a blind unset here.
    if ($plainClaim === '' && $blockClaim !== '') {
        return 'Diese Verknüpfung stammt aus der Wiki-Zuordnung. Bitte im zuständigen Editor lösen — dort hängt die ganze Infobox dran.';
    }

    return '';
}

/**
 * Clear a feature's plain wiki claim, optionally recording that it has no article at all.
 *
 * Bei einer segmentierten Art (Weg, Kraftlinie) wirkt das auf ALLE aktiven Segmente desselben
 * Namens -- der Merker ist eine Aussage ueber die LINIE, und der Fall am Knopf ist die Linie
 * (avesmapsConflictUnlinkSpansNameGroup). Sonst wie bisher auf die eine Zeile.
 *
 * Die ZIELZEILE entscheidet ueber Annahme oder Ablehnung: sie ist die, auf die der Fall zeigt und
 * die der Editor gesehen hat. Geschwisterzeilen sind bestmoeglich -- eine, die Sicherheitsregel 1
 * oder 2 verletzt, wird uebersprungen. Jede geschriebene Zeile bekommt ihren eigenen
 * Protokolleintrag, wie bisher.
 *
 * $handledGroups ist der Gedaechtnisstrich EINES resolve-Aufrufs: welche Verbuende darin schon
 * geschrieben wurden (siehe avesmapsConflictUnlinkGroupKey).
 *
 * @return array{ok:bool, public_id:string, changed:bool, written?:int, group?:string, reason?:string}
 */
function avesmapsConflictUnlinkFeature(PDO $pdo, string $publicId, string $expectedUrl, bool $markNoArticle, int $userId, array &$handledGroups = []): array {
    $select = $pdo->prepare(
        "SELECT id, name, feature_type, properties_json FROM map_features
         WHERE public_id = :p AND is_active = 1 LIMIT 1"
    );
    $select->execute(['p' => $publicId]);
    $feature = $select->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => 'Objekt nicht gefunden.'];
    }

    $name = (string) ($feature['name'] ?? '');
    $featureType = (string) ($feature['feature_type'] ?? '');
    $groupKey = avesmapsConflictUnlinkGroupKey($featureType, $name);

    // Ein zweites Segment DESSELBEN Verbundes im selben Aufruf: der erste hat ihn schon ganz
    // geschrieben. Das ist kein Fehler und darf keine Ablehnung ausloesen -- die Zeile stuende
    // danach nur noch mit ihrem Wiki-Nest da und liefe in Sicherheitsregel 1.
    if ($groupKey !== '' && isset($handledGroups[$groupKey])) {
        return ['ok' => true, 'public_id' => $publicId, 'changed' => false, 'written' => 0,
            'group' => $groupKey, 'name' => $name];
    }

    $targetProperties = json_decode((string) ($feature['properties_json'] ?? '{}'), true);
    if (!is_array($targetProperties)) {
        $targetProperties = [];
    }
    $targetRefusal = avesmapsConflictUnlinkRowRefusal($targetProperties, $expectedUrl);
    if ($targetRefusal !== '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => $targetRefusal];
    }

    // Die Zeilen, auf die dieser Vorgang wirkt. Die Zielzeile ist bei der Verbund-Abfrage mit
    // dabei (gleiche Art, gleicher Name, aktiv), also wird sie nicht doppelt geschrieben.
    $rows = [$feature];
    if ($groupKey !== '') {
        $handledGroups[$groupKey] = true;
        $group = $pdo->prepare(
            "SELECT id, name, feature_type, properties_json FROM map_features
             WHERE feature_type = :t AND name = :n AND is_active = 1"
        );
        $group->execute(['t' => $featureType, 'n' => $name]);
        $groupRows = $group->fetchAll(PDO::FETCH_ASSOC);
        if ($groupRows !== []) {
            $rows = $groupRows;
        }
    }

    $revision = avesmapsNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev, updated_by = :by WHERE id = :id');
    $written = 0;
    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? '{}'), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        if (avesmapsConflictUnlinkRowRefusal($properties, $expectedUrl) !== '') {
            continue;
        }
        $before = json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        unset($properties[AVESMAPS_CONFLICT_CLAIM_FIELD]);
        if ($markNoArticle) {
            $properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG] = true;
        } else {
            unset($properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG]);
        }

        $update->execute([
            'pj' => json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'rev' => $revision,
            'by' => $userId > 0 ? $userId : null,
            'id' => (int) $row['id'],
        ]);
        $written++;

        avesmapsWriteMapAuditLog(
            $pdo,
            (int) $row['id'],
            $markNoArticle ? 'conflict_no_article' : 'conflict_unlink',
            $userId,
            (string) $before,
            (string) json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
    }

    return ['ok' => true, 'public_id' => $publicId, 'changed' => $written > 0, 'written' => $written,
        'group' => $groupKey, 'name' => $name];
}

/**
 * Link an object to the wiki article that carries its exact name.
 *
 * The candidate is looked up HERE, from the object's own stored name -- never taken from the
 * request. A client-supplied URL would let anything set any link, and this endpoint writes real map
 * data; the client only says WHICH object to link, the server decides to what.
 *
 * Refuses when the object already claims something: linking is for the empty case, and silently
 * overwriting an existing claim is how wrong links spread in the first place.
 */
function avesmapsConflictLinkFeature(PDO $pdo, string $publicId, array $wikiTitles, int $userId): array {
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

    $existing = trim((string) ($properties[AVESMAPS_CONFLICT_CLAIM_FIELD] ?? ''));
    if ($existing !== '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false,
            'reason' => 'Dieses Objekt trägt bereits eine Verknüpfung — bitte erst trennen.'];
    }

    $name = trim((string) ($feature['name'] ?? ''));
    $candidate = $wikiTitles[mb_strtolower($name, 'UTF-8')] ?? null;
    if ($candidate === null || trim((string) ($candidate['url'] ?? '')) === '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false,
            'reason' => 'Zu diesem Namen gibt es im Wiki keinen exakt passenden Artikel (mehr).'];
    }

    $properties[AVESMAPS_CONFLICT_CLAIM_FIELD] = (string) $candidate['url'];
    // Eine Verknüpfung widerlegt die Aussage "hat keinen Artikel" -- sonst blieben beide stehen.
    unset($properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG]);

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
        'conflict_link',
        $userId,
        (string) $before,
        (string) json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );

    return ['ok' => true, 'public_id' => $publicId, 'changed' => true, 'name' => $name, 'wiki_url' => (string) $candidate['url']];
}

/**
 * Apply one resolution across a conflict's parties, in a transaction.
 *
 * mode 'unlink'   -- drop the claim on every target
 * mode 'no_wiki'  -- drop it AND record that there is no article (makes the removal stick)
 * mode 'link'     -- attach the article carrying the object's exact name (looked up server-side)
 *
 * "Behält den Link" is expressed by the caller as: unlink every party EXCEPT the keeper. There is
 * no separate verb for it, so the keeper is never written to -- the safest possible way to say
 * "leave that one alone".
 *
 * @return array{ok:bool, applied:int, results:list<array<string,mixed>>}
 */
function avesmapsConflictResolve(PDO $pdo, array $input, int $userId): array {
    $mode = trim((string) ($input['mode'] ?? ''));
    if (!in_array($mode, ['unlink', 'no_wiki', 'link'], true)) {
        throw new RuntimeException('Unbekannter Reparatur-Modus.');
    }
    $targets = is_array($input['targets'] ?? null) ? $input['targets'] : [];
    if ($targets === []) {
        throw new RuntimeException('Keine Ziele angegeben.');
    }
    $expectedUrl = trim((string) ($input['wiki_url'] ?? ''));
    // Nur fuer 'link' gebraucht, und bewusst SERVERSEITIG geholt statt aus der Anfrage.
    $wikiTitles = $mode === 'link' ? avesmapsConflictLoadWikiTitles($pdo) : [];

    $results = [];
    $applied = 0;
    // Welche Namensverbuende dieser EINE Aufruf schon geschrieben hat. Bei einer segmentierten Art
    // trifft ein Ziel den ganzen Verbund, und ein geteilter Artikel schickt dessen Segmente einzeln.
    $handledGroups = [];
    $pdo->beginTransaction();
    try {
        foreach ($targets as $target) {
            $publicId = trim((string) ($target['id'] ?? ''));
            if ($publicId === '') {
                continue;
            }
            $result = $mode === 'link'
                ? avesmapsConflictLinkFeature($pdo, $publicId, $wikiTitles, $userId)
                : avesmapsConflictUnlinkFeature($pdo, $publicId, $expectedUrl, $mode === 'no_wiki', $userId, $handledGroups);
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
