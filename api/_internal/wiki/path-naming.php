<?php

declare(strict_types=1);

// Way-naming rules for wiki-linked path features (R1/R2 rework 2026-07, see
// docs/refactoring-strassen-wiki-zuweisung.md):
//   R1  A segment with an assigned wiki way (properties.wiki_path) ALWAYS carries the
//       wiki way name -- neither the auto-name nor a manually typed name overrides it
//       while the assignment exists.
//   R2  Clearing the assignment hands EACH segment its OWN fresh generic <Subtype>-<n>
//       name (amended 2026-07-05: one shared name glued cleared groups together and a
//       later assign dragged the whole bundle back in).
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

// PATH_SUBTYPE_KEYS (js/config.js) fuer PHP. Hier, weil diese Datei die Wegenamen-Regeln
// traegt und abhaengigkeitsfrei ist -- die Konfliktzentrale las bis 01.09.2026 eine eigene
// Abschrift.
// ⚠️ Die Liste in avesmapsReadPathSubtype (api/_internal/map/features.php) ist bewusst NICHT
// dieselbe: das ist der SCHREIB-Riegel, und sein Kommentar begruendet, warum er eine eigene
// Kopie bleibt.
const AVESMAPS_PATH_SUBTYPE_KEYS = ['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg'];

// Ist dieser Wegname MASCHINELL? Drei Muster, und alle drei muessen hier stehen:
//   1. der nackte Wegtyp ("Flussweg") -- kein Name, nur eine Art
//   2. `<Wegtyp>-<n>` -- genau das, was avesmapsWikiPathNextGenericName oben erzeugt
//   3. `<wort>-<zahl>` allgemein ("Meer-835") -- der Praefix muss nicht der Wegtyp sein
//
// 💣 DIE SPIEGELUNG IST TRAGEND: dies ist die PHP-Fassung von shouldShowRoutePathDisplayName
// (js/routing/route-node.js), und beide Seiten muessen dieselben drei Muster kennen. Der Server
// entscheidet, was die Kartensuche ANBIETET, der Browser, was er dazu im Index findet -- ist der
// Server grosszuegiger, faellt sein Treffer beim Aufloesen still weg (resolveBackendSpotlightEntries
// verwirft, was es lokal nicht gibt), und das sieht wie ein kaputter Klick aus, nicht wie eine Regel.
// ⚠️ Muster 3 ist der Grund, warum Muster 2 trotzdem einzeln dasteht: es faengt genau den Fall,
// den der Erzeuger oben baut, und stirbt nicht mit, wenn Muster 3 je enger gefasst wird.
//
// @param list<string>|null $subtypes die bekannten Wegarten; null = AVESMAPS_PATH_SUBTYPE_KEYS
function avesmapsWikiPathNameIsGeneric(string $name, ?array $subtypes = null): bool {
    $name = trim($name);
    if ($name === '') {
        return true; // kein Name ist auch keiner, den jemand nachschlagen kann
    }

    foreach ($subtypes ?? AVESMAPS_PATH_SUBTYPE_KEYS as $subtype) {
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

    // Muster 3. `\S+` heisst: KEIN Leerzeichen -- "Weg-17 nach Gareth" ist ein Name, den jemand
    // getippt hat, und bleibt einer.
    return preg_match('/^\S+-\d+$/u', $name) === 1;
}
