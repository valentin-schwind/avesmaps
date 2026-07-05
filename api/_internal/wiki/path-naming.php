<?php

declare(strict_types=1);

// Way-naming rules for wiki-linked path features (R1/R2 rework 2026-07, see
// docs/refactoring-strassen-wiki-zuweisung.md):
//   R1  A segment with an assigned wiki way (properties.wiki_path) ALWAYS carries the
//       wiki way name -- neither the auto-name nor a manually typed name overrides it
//       while the assignment exists.
//   R2  Clearing the assignment hands the whole way ONE fresh generic <Subtype>-<n> name.
// Deliberately dependency-free: required by BOTH api/_internal/wiki/paths.php and
// api/_internal/map/features.php (the map lib must not pull the wiki-sync stack).

// Canonical way name of a wiki_path assign object: the staging name, else the decoded
// `/wiki/<Page>` segment of the wiki_url (underscores -> spaces). '' when unusable.
function avesmapsWikiPathCanonicalName(array $wikiPath): string {
    $name = trim((string) ($wikiPath['name'] ?? ''));
    if ($name !== '') {
        return $name;
    }
    $wikiUrl = trim((string) ($wikiPath['wiki_url'] ?? ''));
    if ($wikiUrl === '') {
        return '';
    }
    $pageSegment = '';
    if (preg_match('~/wiki/([^?#]+)~i', $wikiUrl, $match) === 1) {
        $pageSegment = $match[1];
    } else {
        $withoutQuery = explode('#', explode('?', $wikiUrl, 2)[0], 2)[0];
        $tailSegments = array_values(array_filter(explode('/', $withoutQuery), static fn(string $part): bool => $part !== ''));
        $tail = $tailSegments === [] ? '' : (string) end($tailSegments);
        // A bare scheme/host (no path) yields the host -- not a page name.
        $pageSegment = preg_match('~^https?:$~i', $tail) === 1 || str_contains($tail, '.') && count($tailSegments) <= 2 ? '' : $tail;
    }

    return trim(str_replace('_', ' ', rawurldecode($pageSegment)));
}

// R1 gate for the details-save: keep the submitted name unless the feature carries a
// usable wiki assignment -- then the wiki way name wins unconditionally.
function avesmapsWikiPathEffectiveEditName(string $submittedName, array $properties): string {
    $wikiPath = $properties['wiki_path'] ?? null;
    if (!is_array($wikiPath)) {
        return $submittedName;
    }
    $canonicalName = avesmapsWikiPathCanonicalName($wikiPath);

    return $canonicalName !== '' ? $canonicalName : $submittedName;
}

// R2 generic name: next free `<subtype>-<n>` over the supplied existing names (callers
// pass the DB `name` column of all active paths). Number-sensitive: only exact
// `^<subtype>-<digits>$` entries count -- no digit-strip collapsing (Reichsstrasse-1 vs -2).
function avesmapsWikiPathNextGenericName(string $subtype, array $existingNames): string {
    $subtype = trim($subtype);
    if ($subtype === '') {
        $subtype = 'Weg';
    }
    $pattern = '/^' . preg_quote($subtype, '/') . '-(\d+)$/';
    $highestNumber = 0;
    foreach ($existingNames as $existingName) {
        if (preg_match($pattern, trim((string) $existingName), $match) === 1) {
            $highestNumber = max($highestNumber, (int) $match[1]);
        }
    }

    return $subtype . '-' . ($highestNumber + 1);
}

// R2-Sequenz: EIGENER generischer Name je Segment (Phase-1-Schema, random-eindeutig). Die
// Weg-Gruppe loest sich beim Entfernen bewusst auf, damit selektives Neu-Zuweisen kein
// Alt-Buendel wieder einsammelt. Der Pool waechst mit, damit die Sequenz kollisionsfrei bleibt.
function avesmapsWikiPathNextGenericNameSequence(array $rowSubtypes, array $existingNames): array {
    $pool = $existingNames;
    $names = [];
    foreach ($rowSubtypes as $subtype) {
        $name = avesmapsWikiPathNextGenericName((string) $subtype, $pool);
        $pool[] = $name;
        $names[] = $name;
    }

    return $names;
}
