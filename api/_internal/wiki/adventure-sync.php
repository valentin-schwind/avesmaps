<?php

declare(strict_types=1);

// Wiki adventure sync (Phase 4): staging schema + dump-build steps + an OVERRIDE-SAFE reconcile of
// the dump's adventure catalog into the live adventure / adventure_place tables. Mirrors
// api/_internal/wiki/publication-sync.php: the SAME two-step model -- build STAGING during
// "Dump holen" (the adventures phase, dryRun), then an owner-triggered `sync_adventures` action
// that reconciles staging into production. Adventures ARE {{Infobox Produkt}} pages (the SAME
// infobox publications use), classified by Art via avesmapsWikiProductIsAdventure().
//
// Side-effect-free on include (function definitions only -- NO top-level code, NO require of a
// side-effectful file), so the pure-diff unit test (__tests__/adventure-sync-test.php) can `require`
// it with no MySQL. Every DB/dump/parser function takes its dependencies as arguments and calls the
// other libraries at RUNTIME (the dump endpoint loads that chain before dispatch).
//
// OVERRIDE-SAFETY (mirrors the publication reconcile, adapted to a single-row entity + its ordered
// place list):
//   - Adventure FIELDS: a field is written from the wiki only when field_origins_json[field] is not
//     'manual' AND the value actually changes (a manual edit wins; a repeat sync is a no-op).
//   - PLACES: only origin='wiki' AND status='approved' places are added/updated/removed; a
//     manual/community place is never touched, and a suppressed wiki place (editor tombstone) is
//     never resurrected even if the wiki still lists it. Identity of a live wiki place is its
//     sort_order (position in the STRICT ordered "Ort" list; the first is role='start').
// See docs/abenteuer-editor-p4-sync-plan.md.

require_once __DIR__ . '/publication-parsing.php'; // avesmapsWikiParseProductInfobox + adventure helpers

// ===========================================================================
// 1. PURE diff core (Step 1, TDD) -- the override-safety heart. DB-free.
// ===========================================================================

// The adventure business columns the wiki sync may fill (override-safe per field_origins_json).
// bf_year/bf_label are NOT here: the {{Infobox Produkt}} infobox carries no in-world BF year.
const AVESMAPS_ADVENTURE_WIKI_FIELDS = [
    'title', 'product_type', 'edition', 'genre', 'complexity_gm', 'complexity_pl',
    'authors', 'series', 'fshop_code', 'cover_url', 'wiki_url',
];

/**
 * PURE: normalize a field value for change-detection (null and '' are equal; trims). String compare.
 */
function avesmapsAdventureNormalizeField(mixed $value): string
{
    return $value === null ? '' : trim((string) $value);
}

/**
 * PURE: which adventure fields to write from the DESIRED (wiki) values. A field is written ONLY when
 * it is NOT protected by a manual override (field_origins[field] !== 'manual') AND its value actually
 * changes (idempotency -- a repeat reconcile is a no-op). Fields absent from $desired are left alone.
 *
 * @param array<string,mixed> $current      the live adventure row (field => value)
 * @param array<string,mixed> $desired      the wiki values (field => value); may omit fields
 * @param array<string,string> $fieldOrigins the stored per-field origin map (field => 'manual'|'wiki')
 * @return array{set:array<string,mixed>, origins:array<string,string>}
 */
function avesmapsAdventureFieldPlan(array $current, array $desired, array $fieldOrigins): array
{
    $set = [];
    foreach (AVESMAPS_ADVENTURE_WIKI_FIELDS as $field) {
        if (!array_key_exists($field, $desired)) {
            continue; // the wiki has nothing to say about this field
        }
        if ((string) ($fieldOrigins[$field] ?? '') === 'manual') {
            continue; // a manual edit wins outright -- never overwritten by the wiki
        }
        if (avesmapsAdventureNormalizeField($current[$field] ?? null) !== avesmapsAdventureNormalizeField($desired[$field])) {
            $set[$field] = $desired[$field];
        }
    }

    $origins = [];
    foreach (array_keys($set) as $field) {
        $origins[$field] = 'wiki';
    }

    return ['set' => $set, 'origins' => $origins];
}

/**
 * PURE: case/space-insensitive key for matching a place name against a wiki tombstone.
 */
function avesmapsAdventurePlaceNameKey(string $name): string
{
    return mb_strtolower(trim($name), 'UTF-8');
}

/**
 * PURE: reconcile an adventure's WIKI-origin places toward the desired ordered list.
 *
 * Rules:
 *   - Identity of a live wiki place = its sort_order (position in the ordered list). So a reordered
 *     or renamed wiki list UPDATES in place; a shrunk list REMOVES the trailing wiki places.
 *   - Manual/community places are NEVER in the plan (only origin='wiki' rows are considered).
 *   - A suppressed WIKI place (editor tombstone, matched by name) is NEVER re-added.
 *   - REMOVE targets only origin='wiki' AND status='approved' places no longer at a desired position.
 *
 * @param list<array<string,mixed>> $currentPlaces [{id, sort_order, raw_name, role, origin, status}]
 * @param list<array<string,mixed>> $desiredPlaces [{sort_order, raw_name, role}] ordered (start=0)
 * @return array{add:list<array<string,mixed>>, update:list<array<string,mixed>>, remove:list<array{id:int}>}
 */
function avesmapsAdventurePlacePlan(array $currentPlaces, array $desiredPlaces): array
{
    $wikiApprovedByOrder = [];
    $suppressedWikiNames = [];
    foreach ($currentPlaces as $place) {
        if ((string) ($place['origin'] ?? '') !== 'wiki') {
            continue; // manual/community -> untouched, invisible to the plan
        }
        $status = (string) ($place['status'] ?? 'approved');
        if ($status === 'suppressed') {
            $suppressedWikiNames[avesmapsAdventurePlaceNameKey((string) ($place['raw_name'] ?? ''))] = true;
            continue;
        }
        if ($status === 'approved') {
            $wikiApprovedByOrder[(int) ($place['sort_order'] ?? 0)] = $place;
        }
    }

    $add = [];
    $update = [];
    $desiredOrders = [];
    foreach ($desiredPlaces as $desired) {
        $order = (int) ($desired['sort_order'] ?? 0);
        $desiredOrders[$order] = true;
        $rawName = (string) ($desired['raw_name'] ?? '');
        $role = (string) ($desired['role'] ?? 'play');

        if (isset($suppressedWikiNames[avesmapsAdventurePlaceNameKey($rawName)])) {
            continue; // editor tombstoned this wiki place -> keep it removed
        }

        if (isset($wikiApprovedByOrder[$order])) {
            $current = $wikiApprovedByOrder[$order];
            if ((string) $current['raw_name'] !== $rawName || (string) ($current['role'] ?? 'play') !== $role) {
                $update[] = ['id' => (int) $current['id'], 'sort_order' => $order, 'raw_name' => $rawName, 'role' => $role];
            }
            continue;
        }
        $add[] = ['sort_order' => $order, 'raw_name' => $rawName, 'role' => $role];
    }

    $remove = [];
    foreach ($wikiApprovedByOrder as $order => $place) {
        if (!isset($desiredOrders[$order])) {
            $remove[] = ['id' => (int) $place['id']];
        }
    }

    return ['add' => $add, 'update' => $update, 'remove' => $remove];
}
