<?php

declare(strict_types=1);

/**
 * Unit test for joining detector output with stored decisions. No DB, no HTTP --
 * avesmapsConflictApplyDecisions() is pure over arrays.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/conflicts/__tests__/conflict-store-test.php
 *
 * This exists because of a live 500: the reviewer-name helper was declared `array $decision` and
 * called for EVERY conflict, including the undecided ones where the lookup yields null. With 2140
 * conflicts and 2 decisions that is a TypeError on the first row, so the whole list died -- the one
 * path that had no test.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../store.php';

$conflicts = [
    ['rule_id' => 'r1', 'fingerprint' => str_repeat('a', 64), 'title' => 'Offen', 'severity' => 'error', 'parties' => []],
    ['rule_id' => 'r1', 'fingerprint' => str_repeat('b', 64), 'title' => 'Zurückgestellt', 'severity' => 'error', 'parties' => []],
];
$decisions = [
    // A deferred one that the detector still finds.
    'r1|' . str_repeat('b', 64) => [
        'rule_id' => 'r1', 'fingerprint' => str_repeat('b', 64), 'decision' => 'deferred',
        'detail_json' => json_encode(['by_name' => 'Valentin']), 'reviewed_at' => '2026-07-20 21:15:00', 'reviewed_by' => 1,
    ],
    // A repaired one the detector no longer finds -> history, rebuilt from detail_json alone.
    'r1|' . str_repeat('c', 64) => [
        'rule_id' => 'r1', 'fingerprint' => str_repeat('c', 64), 'decision' => 'resolved',
        'detail_json' => json_encode([
            'title' => 'Jergan', 'wiki_url' => 'https://w/wiki/Jergan', 'severity' => 'error', 'by_name' => 'Valentin',
            'parties' => [['type' => 'location', 'type_label' => 'Ort', 'label' => 'Jergan']],
        ]),
        'reviewed_at' => '2026-07-20 21:16:00', 'reviewed_by' => 1,
    ],
    // An old row from before the snapshot existed: no detail_json at all.
    'r1|' . str_repeat('d', 64) => [
        'rule_id' => 'r1', 'fingerprint' => str_repeat('d', 64), 'decision' => 'resolved',
        'detail_json' => null, 'reviewed_at' => '2026-07-20 20:00:00', 'reviewed_by' => 7,
    ],
];

$result = avesmapsConflictApplyDecisions($conflicts, $decisions);
$byPrint = [];
foreach ($result as $entry) {
    $byPrint[$entry['fingerprint']] = $entry;
}

// THE REGRESSION: an undecided conflict must survive the join. This threw a TypeError live.
$open = $byPrint[str_repeat('a', 64)];
assert($open['status'] === 'open');
assert($open['decision'] === null);
assert($open['reviewed_at'] === null);
// Nobody decided it, so no name may be invented.
assert(($open['reviewed_by'] ?? '') === '' || $open['reviewed_by'] === null);

// Still found + deferred -> deferred, with the stored name.
assert($byPrint[str_repeat('b', 64)]['status'] === 'deferred');
assert($byPrint[str_repeat('b', 64)]['reviewed_by'] === 'Valentin');

// Gone + decided -> history, rebuilt entirely from the snapshot.
$done = $byPrint[str_repeat('c', 64)];
assert($done['status'] === 'done');
assert($done['title'] === 'Jergan');
assert($done['severity'] === 'error');
assert($done['parties'][0]['label'] === 'Jergan');
assert($done['reviewed_by'] === 'Valentin');

// An old row without a snapshot stays readable rather than blowing up or showing a bare "7".
$legacy = $byPrint[str_repeat('d', 64)];
assert($legacy['status'] === 'done');
assert($legacy['title'] === '');
assert($legacy['reviewed_by'] === 'Benutzer 7');

// Every conflict is accounted for exactly once: 2 found + 2 history entries.
assert(count($result) === 4);

// ---- the snapshot must carry the EVIDENCE, not just the names --------------------------------
// Live case #EDCXYJ "Hursach": three parties, two named exactly like the article they were fighting
// over, and the finished case labelled all three "kein eigener Wiki-Artikel". It could not know --
// the snapshot stored type and name only, so the line asserted a finding nobody ever recorded.
$snapshot = avesmapsConflictSnapshotParties([
    ['type' => 'path', 'type_label' => 'Weg', 'label' => 'Hursach',
        'own_wiki' => ['title' => 'Hursach', 'url' => 'https://w/wiki/Hursach']],
    ['type' => 'location', 'type_label' => 'Ort', 'label' => 'Hursachquelle', 'own_wiki' => null],
]);
assert($snapshot[0]['own_wiki']['title'] === 'Hursach');
assert($snapshot[0]['own_wiki']['url'] === 'https://w/wiki/Hursach');
// THE distinction the renderer reads: present-and-null is a finding ("damals nichts gefunden"),
// a MISSING key is not. Both must survive a JSON round-trip, or the tri-state collapses and the
// history starts lying again.
assert($snapshot[1]['own_wiki'] === null);
assert(array_key_exists('own_wiki', $snapshot[1]));
$roundTrip = json_decode((string) json_encode($snapshot), true);
assert(array_key_exists('own_wiki', $roundTrip[1]));
assert($roundTrip[1]['own_wiki'] === null);
assert($roundTrip[0]['own_wiki']['url'] === 'https://w/wiki/Hursach');

// A half-recorded belief is worse than none: no URL means no link to render, so it degrades to null.
$halfKnown = avesmapsConflictSnapshotParties([['type' => 'location', 'label' => 'X', 'own_wiki' => ['title' => 'X']]]);
assert($halfKnown[0]['own_wiki'] === null);

// Old snapshots stay recognisable as old -- the key must NOT appear, or entries decided before
// today would claim a finding again (this is exactly the 'c' history entry above).
assert(!array_key_exists('own_wiki', $done['parties'][0]));

// Junk in the party list is skipped, not turned into a blank party.
assert(count(avesmapsConflictSnapshotParties(['nonsense', null])) === 0);
assert(count(avesmapsConflictSnapshotParties(null)) === 0);
// The cap still holds with the extra field in place.
assert(count(avesmapsConflictSnapshotParties(array_fill(0, 30, ['type' => 'location', 'label' => 'x']))) === 12);

fwrite(STDOUT, "conflict-store-test: alle Zusicherungen erfuellt\n");
