<?php

declare(strict_types=1);

/**
 * Conflict centre -- pure core (no DB, no HTTP, no globals).
 * =========================================================================
 * Design: docs/konfliktmanagement-design.md. Everything in this file is a pure function so the
 * two rules that decide whether the tool is usable at all can be unit-tested without a database:
 *
 *   1. WHICH SHARING IS LEGITIMATE (§6a). "Several objects claim one wiki article" matches 268
 *      groups / 1670 objects on live data -- but 215 groups (1547 objects) are the segments of ONE
 *      road, which is the design, not a defect. Flagging those would have opened the tool with
 *      1547 false positives.
 *   2. WHICH NAMES ARE MACHINE-MADE (§6b). Of 3721 ways without a wiki link, 2448 carry an
 *      auto-generated `<Subtype>-<n>` name and can never have a wiki counterpart. Listing them as
 *      "potential conflict" would have buried the 1178 hand-named ones that genuinely need review.
 *
 * Both numbers are measured (2026-07-20, live payload). Both mistakes are silent and in the
 * expensive direction -- the list still renders, it is just useless -- so they get tests, not
 * comments.
 */

// Severity. Drives grouping and colour, never behaviour.
const AVESMAPS_CONFLICT_ERROR = 'error';            // provably wrong
const AVESMAPS_CONFLICT_DIVERGENCE = 'divergence';  // a decision is needed, not necessarily wrong
const AVESMAPS_CONFLICT_UNVERIFIED = 'unverified';  // plausible, never confirmed

// Decisions an editor can record. Stored verbatim in conflict_decision.decision.
const AVESMAPS_CONFLICT_DECISIONS = ['resolved', 'deferred', 'ignored'];

// Derived status (§5a). NOT a stored column -- see avesmapsConflictStatus().
const AVESMAPS_CONFLICT_STATUS_OPEN = 'open';
const AVESMAPS_CONFLICT_STATUS_DEFERRED = 'deferred';
const AVESMAPS_CONFLICT_STATUS_ARCHIVED = 'archived';
const AVESMAPS_CONFLICT_STATUS_DONE = 'done';

/**
 * The status is NOT stored. It falls out of two independent questions (owner definition, §5a):
 * does the conflict still exist right now, and has a human already decided?
 *
 *   present + no decision        -> open       "sollte gemacht werden"
 *   present + deferred           -> deferred   "zu wenig Information"
 *   present + resolved|ignored   -> archived   "bewusst so gelassen, Konflikt besteht weiter"
 *   gone    + any decision       -> done       "Daten repariert, der Fall bleibt als Historie"
 *   gone    + no decision        -> (not a case at all; never reaches here)
 *
 * Keeping this derived is what lets conflicts be COMPUTED instead of stored: a fixed conflict
 * disappears by itself, and a decision whose facts changed reopens by itself (the fingerprint no
 * longer matches, so the caller passes $decision = null).
 */
function avesmapsConflictStatus(bool $stillPresent, ?string $decision): string {
    if (!$stillPresent) {
        return AVESMAPS_CONFLICT_STATUS_DONE;
    }
    if ($decision === 'deferred') {
        return AVESMAPS_CONFLICT_STATUS_DEFERRED;
    }
    if ($decision === 'resolved' || $decision === 'ignored') {
        return AVESMAPS_CONFLICT_STATUS_ARCHIVED;
    }

    return AVESMAPS_CONFLICT_STATUS_OPEN;
}

/**
 * Stable identity of one conflict: sha256 over the rule plus everything the conflict is ABOUT.
 *
 * Both lists are sorted first, so a conflict does not reopen just because a query returned its
 * parties in a different order -- that would throw away every deferral on the next run. Anything
 * that IS a fact of the conflict (the shared url, the diverging values) belongs in $facts: when it
 * changes, the fingerprint changes, the stored decision no longer matches, and the case correctly
 * comes back as open.
 */
function avesmapsConflictFingerprint(string $ruleId, array $parties, array $facts = []): string {
    $partyKeys = [];
    foreach ($parties as $party) {
        $type = trim((string) ($party['type'] ?? ''));
        $id = trim((string) ($party['id'] ?? ''));
        if ($type === '' || $id === '') {
            continue;
        }
        $partyKeys[] = $type . ':' . $id;
    }
    sort($partyKeys, SORT_STRING);

    $factPairs = [];
    foreach ($facts as $key => $value) {
        $factPairs[] = (string) $key . '=' . (is_scalar($value) ? (string) $value : json_encode($value));
    }
    sort($factPairs, SORT_STRING);

    return hash('sha256', trim($ruleId) . '|' . implode(',', $partyKeys) . '|' . implode(',', $factPairs));
}

/**
 * May these object types share one wiki article?
 *
 * Exactly ONE pairing is legitimate: the segments of a single road. Everything else is a case --
 * owner ruling 2026-07-20: "Greifenfurt Stadt" and "Greifenfurt Baronie" are a location and a
 * territory, two different things that must not carry one identity even when they share a name.
 *
 * @param list<string> $types the DISTINCT entity types among the parties
 */
function avesmapsConflictSharedWikiVerdict(array $types): string {
    $distinct = array_values(array_unique(array_filter(array_map('strval', $types), static fn(string $t): bool => $t !== '')));
    sort($distinct, SORT_STRING);

    // Only paths among themselves: "Reichsstraße 1" is one article across 26 segments (§6a).
    if ($distinct === ['path']) {
        return 'legitimate';
    }

    return AVESMAPS_CONFLICT_ERROR;
}

/**
 * Is this path name machine-made?
 *
 * avesmapsWikiPathNextGenericName() (api/_internal/wiki/path-naming.php) hands a cleared segment a
 * fresh `<Subtype>-<n>`; the bare subtype word is the same thing without a counter. Such a name
 * cannot have a wiki counterpart, so it must never reach the watchlist -- 2448 of 3721 linkless
 * ways are exactly this.
 *
 * @param list<string> $subtypes the known path subtypes (PATH_SUBTYPE_KEYS)
 */
function avesmapsConflictPathNameIsAuto(string $name, array $subtypes): bool {
    $name = trim($name);
    if ($name === '') {
        return true; // no name at all is not something an editor can look up either
    }
    foreach ($subtypes as $subtype) {
        $subtype = trim((string) $subtype);
        if ($subtype === '') {
            continue;
        }
        if ($name === $subtype) {
            return true;
        }
        if (preg_match('/^' . preg_quote($subtype, '/') . '-\d+$/u', $name) === 1) {
            return true;
        }
    }

    return false;
}

/**
 * Group rows by the wiki article they claim and return only the groups that are a real conflict.
 *
 * A row is ['type' => 'location'|'path'|..., 'id' => string, 'label' => string, 'wiki_url' => string].
 * Rows without a url are ignored -- "has no wiki key" is a separate rule (§6b), not a collision.
 *
 * @return list<array{wiki_url:string, parties:list<array{type:string,id:string,label:string}>, severity:string}>
 */
function avesmapsConflictFindSharedWikiUrls(array $rows): array {
    $byUrl = [];
    foreach ($rows as $row) {
        $url = trim((string) ($row['wiki_url'] ?? ''));
        $type = trim((string) ($row['type'] ?? ''));
        $id = trim((string) ($row['id'] ?? ''));
        if ($url === '' || $type === '' || $id === '') {
            continue;
        }
        $byUrl[$url][] = ['type' => $type, 'id' => $id, 'label' => (string) ($row['label'] ?? '')];
    }

    $conflicts = [];
    foreach ($byUrl as $url => $parties) {
        if (count($parties) < 2) {
            continue;
        }
        $verdict = avesmapsConflictSharedWikiVerdict(array_column($parties, 'type'));
        if ($verdict === 'legitimate') {
            continue;
        }
        $conflicts[] = ['wiki_url' => (string) $url, 'parties' => $parties, 'severity' => $verdict];
    }

    return $conflicts;
}
