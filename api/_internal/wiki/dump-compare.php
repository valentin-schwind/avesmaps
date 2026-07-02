<?php

declare(strict_types=1);

/**
 * WikiDump migration -- Section 9 COMPARE-TEST: pure comparison core.
 * ---------------------------------------------------------------------------
 * The owner's core safety gate proves the dump-reader yields the SAME data the
 * ONLINE crawler put in the DB, BEFORE anything sharp writes real staging /
 * sandbox. This file is the PURE, DB-FREE, side-effect-free heart of that gate:
 * it takes two already-built maps -- the dump-derived records (keyed by the
 * entity's identity key) and the real DB rows (keyed the same way) -- and returns
 * a structured diff. It NEVER opens a dump, NEVER touches a PDO, NEVER writes.
 *
 * The thin, live layer (scripts/wikidump-compare.php) does the impure work:
 *   - open the fetched dump (compress.bzip2://) and run the DB-free collectors
 *     (avesmapsWikiDumpCollect* / avesmapsWikiDumpCollectRedirectAliases) to build
 *     the dump-side maps;
 *   - SELECT the real rows (read-only) to build the DB-side maps;
 *   - call the functions here;
 *   - print the per-entity A1-A6 report.
 * Splitting it this way lets the LOCAL test exercise the comparison logic with
 * synthetic maps (a missing key, a new key, a field diff, a hierarchy drift, a
 * parent_locked override) with NO MySQL and NO dump -- exactly the assertions the
 * full live run cannot make on a build box.
 *
 * WHY IDENTITY KEYS ARE PASSED IN, NOT DERIVED HERE: the key for each entity is
 * the SAME string the reused collector/upsert already uses (paths/regions/
 * territories = wiki_key; settlements/buildings = title). The caller keys both
 * maps by that value; this file never re-derives a key (re-derivation is what A1
 * exists to catch, and a bug here would mask it). A1's whole job is to surface a
 * DB key the dump did NOT produce -- so the comparison must trust the keys it is
 * handed and only set-difference them.
 *
 * PURITY CONTRACT: side-effect-free on include (only function definitions -- no
 * top-level code, no DB, no headers, no I/O), so a test can `require` it with no
 * MySQL / STRATO / dump. Every function here is deterministic and free of global
 * state.
 */

// ===========================================================================
// A1 -- key coverage (the HARD assert: drive missing_in_dump to 0).
// ===========================================================================

/**
 * A1 key coverage for ONE entity: set-difference the dump's identity keys against
 * the DB's identity keys. `$dumpByKey` and `$dbByKey` are maps keyed by the
 * entity's identity key (paths/regions/territories: wiki_key; settlements/
 * buildings: title) -- the SAME key the reused collector + upsert use. The values
 * are irrelevant here (A4 diffs them); only the KEY SETS are compared.
 *
 *   - missing_in_dump: a DB row whose key the dump did NOT produce. This is the
 *     HARD FAILURE the owner drives to 0 -- it means the dump-reader would fail to
 *     re-create a row the online crawler had (a coverage gap). A short, sorted
 *     sample is returned for the report; the full count is `missing_in_dump_count`.
 *   - new_in_dump: a key the dump produced that the DB lacks. Usually benign
 *     (the dump is newer / the online crawl never reached that page), but reported
 *     so the owner can eyeball it.
 *   - matched: keys present on both sides (fed to A4 for field diffing).
 *   - dup_keys: identity keys the DUMP produced more than once. The maps collapse
 *     duplicates (last write wins), so a raw duplicate list must be supplied by the
 *     caller via $dumpKeyList (the un-deduplicated key sequence the collector
 *     emitted); if omitted, dup detection is skipped (empty). A non-empty dup_keys
 *     is a real defect (two dump pages slug to one key) worth surfacing.
 *
 * @param array<string, mixed> $dumpByKey  identity-key => dump record
 * @param array<string, mixed> $dbByKey    identity-key => db row
 * @param array<int, string>|null $dumpKeyList optional raw (un-deduplicated) dump
 *        key sequence, for duplicate detection. Null -> dup_keys empty.
 * @param int $sampleLimit max keys to include in the missing/new samples.
 * @return array{
 *   db_total:int, dump_total:int, matched:int,
 *   missing_in_dump_count:int, new_in_dump_count:int,
 *   missing_in_dump:array<int,string>, new_in_dump:array<int,string>,
 *   dup_keys:array<int,string>
 * }
 */
function avesmapsWikiDumpCompareKeyCoverage(
    array $dumpByKey,
    array $dbByKey,
    ?array $dumpKeyList = null,
    int $sampleLimit = 50
): array {
    $missing = [];  // in DB, not in dump  (the hard failure)
    $new = [];      // in dump, not in DB
    $matched = 0;

    foreach ($dbByKey as $key => $_row) {
        $key = (string) $key;
        if (array_key_exists($key, $dumpByKey)) {
            $matched++;
        } else {
            $missing[] = $key;
        }
    }
    foreach ($dumpByKey as $key => $_rec) {
        $key = (string) $key;
        if (!array_key_exists($key, $dbByKey)) {
            $new[] = $key;
        }
    }

    // Duplicate identity keys the dump emitted (before the map collapsed them).
    $dupKeys = [];
    if (is_array($dumpKeyList)) {
        $seen = [];
        foreach ($dumpKeyList as $rawKey) {
            $rawKey = (string) $rawKey;
            if ($rawKey === '') {
                continue;
            }
            $seen[$rawKey] = ($seen[$rawKey] ?? 0) + 1;
        }
        foreach ($seen as $rawKey => $count) {
            if ($count > 1) {
                $dupKeys[] = (string) $rawKey;
            }
        }
        sort($dupKeys, SORT_STRING);
    }

    sort($missing, SORT_STRING);
    sort($new, SORT_STRING);

    return [
        'db_total' => count($dbByKey),
        'dump_total' => count($dumpByKey),
        'matched' => $matched,
        'missing_in_dump_count' => count($missing),
        'new_in_dump_count' => count($new),
        'missing_in_dump' => array_slice($missing, 0, max(0, $sampleLimit)),
        'new_in_dump' => array_slice($new, 0, max(0, $sampleLimit)),
        'dup_keys' => $dupKeys,
    ];
}

// ===========================================================================
// A4 -- field diff (the editorial review list).
// ===========================================================================

/**
 * A4 field diff for ONE entity: for every key present in BOTH maps, compare the
 * listed `$fields` and record which differ (old = DB value, new = dump value).
 * This is the EDITORIAL REVIEW LIST -- not a failure by itself. Some fields are
 * KNOWN to diverge by construction (documented §9 watch-items): settlement_class
 * / building_type where the class category is template-injected (the dump only
 * carries literal [[Kategorie:]] links, I6), and any field the online API enriched
 * that the dump cannot. The owner reviews these; they are expected, not bugs.
 *
 * Comparison is normalised so cosmetically-equal values do not show as diffs:
 *   - both sides are string-cast and trimmed;
 *   - NULL and '' are treated as equal (the reused upserts store '' as NULL, so a
 *     DB NULL vs a dump '' is not a real difference);
 *   - a per-field normaliser callback may be supplied in $normalizers to fold
 *     representation differences (e.g. JSON re-encode, int-cast) before comparing.
 *
 * Only keys with at least one differing field appear in `diffs`. The result is
 * capped to $maxRows rows for the report (the full count is `diff_row_count`), and
 * each row lists only the fields that actually differ.
 *
 * @param array<string, array<string,mixed>> $dumpByKey identity-key => dump record
 * @param array<string, array<string,mixed>> $dbByKey   identity-key => db row
 * @param array<int, string> $fields field names to compare (must exist as keys in
 *        both record shapes; a missing field is read as null on that side).
 * @param array<string, callable(mixed):string> $normalizers optional per-field
 *        value normaliser (field => fn(mixed):string).
 * @param int $maxRows max diff rows to include in the returned sample.
 * @return array{
 *   compared:int, diff_row_count:int, field_diff_totals:array<string,int>,
 *   diffs:array<int, array{key:string, fields:array<string, array{old:string,new:string}>}>
 * }
 */
function avesmapsWikiDumpCompareFields(
    array $dumpByKey,
    array $dbByKey,
    array $fields,
    array $normalizers = [],
    int $maxRows = 100
): array {
    $normalize = static function (mixed $value, ?callable $fieldNormalizer): string {
        if ($fieldNormalizer !== null) {
            return $fieldNormalizer($value);
        }
        if ($value === null) {
            return '';
        }
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }
        if (is_array($value)) {
            // Stable JSON so array order/formatting differences do not read as diffs.
            $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            return is_string($encoded) ? $encoded : '';
        }
        return trim((string) $value);
    };

    $compared = 0;
    $diffs = [];
    $fieldTotals = [];

    foreach ($dbByKey as $key => $dbRow) {
        $key = (string) $key;
        if (!array_key_exists($key, $dumpByKey)) {
            continue; // A1 territory: only matched keys are field-compared
        }
        $compared++;
        $dumpRow = $dumpByKey[$key];
        $dbRow = is_array($dbRow) ? $dbRow : [];
        $dumpRow = is_array($dumpRow) ? $dumpRow : [];

        $rowFields = [];
        foreach ($fields as $field) {
            $field = (string) $field;
            $fieldNormalizer = $normalizers[$field] ?? null;
            $dbValue = $normalize($dbRow[$field] ?? null, $fieldNormalizer);
            $dumpValue = $normalize($dumpRow[$field] ?? null, $fieldNormalizer);
            if ($dbValue !== $dumpValue) {
                $rowFields[$field] = ['old' => $dbValue, 'new' => $dumpValue];
                $fieldTotals[$field] = ($fieldTotals[$field] ?? 0) + 1;
            }
        }

        if ($rowFields !== []) {
            $diffs[] = ['key' => $key, 'fields' => $rowFields];
        }
    }

    // Deterministic order for the report (by key).
    usort($diffs, static fn(array $a, array $b): int => strcmp($a['key'], $b['key']));
    ksort($fieldTotals);

    return [
        'compared' => $compared,
        'diff_row_count' => count($diffs),
        'field_diff_totals' => $fieldTotals,
        'diffs' => array_slice($diffs, 0, max(0, $maxRows)),
    ];
}

// ===========================================================================
// A2 -- territory hierarchy drift (modulo parent_locked overrides).
// ===========================================================================

/**
 * A2 territory hierarchy drift: compare the DUMP-derived parent of each territory
 * against the DB-derived parent, listing only REAL drifts and excluding keys whose
 * parent the editor has LOCKED (parent_locked = 1 in wiki_territory_model), because
 * a locked parent is an intentional editor override the dump is NOT expected to
 * reproduce.
 *
 * Both parent maps are keyed by the child's identity key (wiki_key) and hold the
 * PARENT's identity key (wiki_key), already resolved by the caller into the SAME
 * key space:
 *   - dump side: the caller resolves the collector's affiliation_root / affiliation
 *     link (a wiki page NAME) through the SAME slug + redirect-alias pipeline the
 *     online crawler used (avesmapsPoliticalSlug / the alias map) into a
 *     'wiki:'-style key -- never a bespoke mapping here (I1).
 *   - db side: political_territory.parent_id -> parent.wiki_key (a read-only
 *     self-join in the CLI).
 * A null / '' parent on a side means "no parent" (a root). Passing both sides
 * pre-resolved keeps THIS function pure and testable; the impure resolution lives
 * in the CLI.
 *
 * Classified per child key present in EITHER map (excluding parent_locked):
 *   - both_root:  no parent on either side (agree, not listed as a drift).
 *   - agree:      same non-null parent key on both sides.
 *   - drift:      different parent keys (both non-null) -> listed (old=db, new=dump).
 *   - only_dump:  dump has a parent, DB has none -> listed.
 *   - only_db:    DB has a parent, dump has none -> listed.
 * A child absent from one side entirely (an A1 coverage gap) is NOT re-counted here
 * -- A1 owns coverage; A2 only compares parents where at least one side has an
 * opinion.
 *
 * @param array<string, ?string> $dumpParentByKey child wiki_key => resolved parent wiki_key (or null)
 * @param array<string, ?string> $dbParentByKey   child wiki_key => parent wiki_key (or null)
 * @param array<int, string> $parentLockedKeys child wiki_keys whose parent is editor-locked (excluded)
 * @param int $maxRows max drift rows to include in the returned sample.
 * @return array{
 *   compared:int, locked_excluded:int, agree:int, both_root:int,
 *   drift_count:int,
 *   drifts:array<int, array{key:string, db_parent:string, dump_parent:string, kind:string}>
 * }
 */
function avesmapsWikiDumpCompareHierarchy(
    array $dumpParentByKey,
    array $dbParentByKey,
    array $parentLockedKeys = [],
    int $maxRows = 100
): array {
    $locked = [];
    foreach ($parentLockedKeys as $lockedKey) {
        $locked[(string) $lockedKey] = true;
    }

    $norm = static function (mixed $value): ?string {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);
        return $value === '' ? null : $value;
    };

    // Every child key with an opinion on either side (excluding locked ones).
    $keys = [];
    foreach (array_keys($dumpParentByKey) as $key) {
        $keys[(string) $key] = true;
    }
    foreach (array_keys($dbParentByKey) as $key) {
        $keys[(string) $key] = true;
    }

    $compared = 0;
    $lockedExcluded = 0;
    $agree = 0;
    $bothRoot = 0;
    $drifts = [];

    foreach (array_keys($keys) as $key) {
        $key = (string) $key;
        if (isset($locked[$key])) {
            $lockedExcluded++;
            continue;
        }
        $dumpParent = $norm($dumpParentByKey[$key] ?? null);
        $dbParent = $norm($dbParentByKey[$key] ?? null);
        $compared++;

        if ($dumpParent === null && $dbParent === null) {
            $bothRoot++;
            continue;
        }
        if ($dumpParent === $dbParent) {
            $agree++;
            continue;
        }

        if ($dumpParent !== null && $dbParent !== null) {
            $kind = 'drift';
        } elseif ($dumpParent !== null) {
            $kind = 'only_dump';
        } else {
            $kind = 'only_db';
        }

        $drifts[] = [
            'key' => $key,
            'db_parent' => $dbParent ?? '',
            'dump_parent' => $dumpParent ?? '',
            'kind' => $kind,
        ];
    }

    usort($drifts, static fn(array $a, array $b): int => strcmp($a['key'], $b['key']));

    return [
        'compared' => $compared,
        'locked_excluded' => $lockedExcluded,
        'agree' => $agree,
        'both_root' => $bothRoot,
        'drift_count' => count($drifts),
        'drifts' => array_slice($drifts, 0, max(0, $maxRows)),
    ];
}

// ===========================================================================
// Helpers: build an identity-keyed map from a record list (used by the CLI).
// ===========================================================================

/**
 * Index a list of records by the value at $keyField, returning [map, keyList].
 * `map` collapses duplicates (last write wins, matching the upserts' ON DUPLICATE
 * KEY semantics); `keyList` is the raw (un-deduplicated) key sequence so
 * avesmapsWikiDumpCompareKeyCoverage() can report duplicate identity keys. Records
 * with an empty key are skipped (and counted in `skipped`).
 *
 * Pure: no DB, no I/O. Used by the CLI to turn both the collector output and the
 * DB rows into the identity-keyed maps the compare functions consume.
 *
 * @param array<int, array<string,mixed>> $records
 * @return array{map:array<string,array<string,mixed>>, keyList:array<int,string>, skipped:int}
 */
function avesmapsWikiDumpIndexRecordsByKey(array $records, string $keyField): array
{
    $map = [];
    $keyList = [];
    $skipped = 0;

    foreach ($records as $record) {
        if (!is_array($record)) {
            $skipped++;
            continue;
        }
        $key = trim((string) ($record[$keyField] ?? ''));
        if ($key === '') {
            $skipped++;
            continue;
        }
        $keyList[] = $key;
        $map[$key] = $record; // last write wins
    }

    return ['map' => $map, 'keyList' => $keyList, 'skipped' => $skipped];
}
