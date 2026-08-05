<?php

declare(strict_types=1);

/**
 * Unit test for the review-list filter (finding A3). No DB, no HTTP. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/report-review-list-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../report-review-list.php';

$endpointSource = file_get_contents(__DIR__ . '/../../../edit/reports/locations.php');
assert(is_string($endpointSource) && $endpointSource !== '', 'the endpoint source must be readable');

// --- 💣 Nothing but a whitelisted value reaches the WHERE clause ------------------------------------
//
// The condition is INTERPOLATED, not bound -- a status is a column comparison, not a value the driver
// can parameterise here without splitting the query in two. So the whitelist is the entire defence, and
// it must hold for every shape a query string can take.
foreach ([
    "'; DROP TABLE map_reports; --",
    'erledigt OR 1=1',
    'ERLEDIGT ',
    ['erledigt'],
    null,
    '',
    '0',
    'neu; --',
] as $hostile) {
    $filter = avesmapsNormalizeReportListFilter($hostile);
    assert(
        in_array($filter, AVESMAPS_REPORT_LIST_FILTERS, true),
        'the filter is always one of the three known values, whatever arrives'
    );
    $condition = avesmapsReportListStatusCondition($filter);
    assert(
        $condition === "status = 'neu'" || $condition === "status <> 'neu'",
        'and the condition it produces is one of exactly two strings'
    );
}

// 💣 And it must be SILENT about it. `?status[]=erledigt` hands PHP an array; casting one emits
// "Array to string conversion", and with display_errors on that warning prints itself in front of the
// JSON and breaks the response for every caller. Asserting the return value alone does NOT catch this --
// the cast yields "Array", which is not whitelisted, so the answer is right while the response is
// broken. Only the warning itself proves the guard is there.
$emittedWarnings = [];
set_error_handler(static function (int $number, string $message) use (&$emittedWarnings): bool {
    $emittedWarnings[] = $message;

    return true;
});
foreach ([['erledigt'], ['a' => 'b'], new stdClass()] as $nonScalar) {
    avesmapsNormalizeReportListFilter($nonScalar);
}
restore_error_handler();
assert(
    $emittedWarnings === [],
    'a non-scalar status parameter must not emit a PHP notice or warning: it would print itself in '
        . 'front of the JSON. Got: ' . implode(' | ', $emittedWarnings)
);

// Case and whitespace are tolerated, because a hand-typed URL is a legitimate caller.
assert(avesmapsNormalizeReportListFilter('  ERLEDIGT ') === 'erledigt', 'trimmed and lower-cased');
assert(avesmapsNormalizeReportListFilter('alle') === 'alle', 'alle survives');

// ⚠️ The default is what every existing caller gets, and it must not change: the editor panel has been
// sending no parameter at all since before this filter existed.
assert(avesmapsNormalizeReportListFilter(null) === 'neu', 'no parameter -> the open queue, as before');
assert(avesmapsNormalizeReportListFilter('bogus') === 'neu', 'an unknown value -> the open queue too');
assert(avesmapsReportListStatusCondition('neu') === "status = 'neu'", 'the open queue is unchanged');

// --- The two lists read differently, and only one of them is capped ---------------------------------

assert(avesmapsReportListStatusCondition('erledigt') === "status <> 'neu'", 'processed is everything else');
// Open reports are a queue (oldest first, work them in order); processed ones are a history.
assert(str_contains(avesmapsReportListOrderBy('neu'), 'created_at ASC'), 'the queue reads oldest first');
assert(str_contains(avesmapsReportListOrderBy('erledigt'), 'DESC'), 'the history reads newest first');
// COALESCE, because a row whose status changed before reviewed_at existed would otherwise sort into a
// corner of the list and be as unfindable as it was before A3.
assert(
    str_contains(avesmapsReportListOrderBy('erledigt'), 'COALESCE(reviewed_at, created_at)'),
    'a processed row without reviewed_at still sorts by when it arrived'
);

// 💣 THE OPEN QUEUE USED TO BE UNCAPPED, and this test used to assert that on purpose: "an editor
// must see every report waiting for them". Finding A30 is why it no longer holds. report_mode=change
// writes to map_reports with no login, no capability and no token, and since the hourly limit stopped
// counting change rows (A2, deliberately, so honest reporters are not locked out) nothing bounds how
// many arrive. This list read every one of them -- from BOTH tables, with `comment` and
// `payload_json` -- into a single response. The write channel is a product question; an unbounded
// read that takes the editor's screen down with it is not.
assert(
    avesmapsReportListFetchLimit('neu') === AVESMAPS_REPORT_LIST_OPEN_LIMIT + 1,
    'the open queue is capped too now, and fetches one over so truncation is detectable'
);
// One MORE than the cap, so "exactly the cap" and "more than the cap" can be told apart without a
// second COUNT query. 💣 Never 0: that meant "no LIMIT clause at all", which is the bug itself.
assert(
    avesmapsReportListFetchLimit('erledigt') === AVESMAPS_REPORT_LIST_DONE_LIMIT + 1,
    'one row over the cap is fetched so truncation is detectable'
);
assert(avesmapsReportListFetchLimit('neu') > 1 && avesmapsReportListFetchLimit('erledigt') > 1, 'no branch returns an unlimited read');
// 💣 And the endpoint must not keep an unlimited branch as a fallback. `$limitSql = $fetchLimit > 0 ?
// ' LIMIT ' . $fetchLimit : ''` left the empty string -- the ungapped query itself -- standing as the
// else case, which is an invitation to bring the finding back by making one function return 0 again.
assert(
    str_contains($endpointSource, "\$limitSql = ' LIMIT ' . \$fetchLimit;"),
    'the endpoint always appends a LIMIT -- there is no branch that omits one'
);
assert(AVESMAPS_REPORT_LIST_DONE_LIMIT === 200, 'the history cap');
assert(AVESMAPS_REPORT_LIST_OPEN_LIMIT === 500, 'the queue cap -- larger, because it is work still to do');
assert(
    avesmapsReportListCap('neu') === AVESMAPS_REPORT_LIST_OPEN_LIMIT
        && avesmapsReportListCap('alle') === AVESMAPS_REPORT_LIST_OPEN_LIMIT
        && avesmapsReportListCap('erledigt') === AVESMAPS_REPORT_LIST_DONE_LIMIT,
    'each filter gets its own cap'
);

// ⭐ The ORDER is what makes cutting the queue safe rather than merely bounded, so it is asserted
// right next to the cap: open reports come oldest first, so a flood lands at the END and is what gets
// cut. The genuine backlog an editor was already working through stays visible. Were this queue
// newest-first, the same cap would hide exactly the reports that matter.
assert(
    str_starts_with(avesmapsReportListOrderBy('neu'), 'created_at ASC'),
    'the open queue is oldest-first, which is what the cap cuts from the right end'
);
// 💣 AND THE SQL IS NOT WHERE THE ORDER IS DECIDED. Both tables are read with their own ORDER BY,
// but the final sequence before array_slice comes from a usort over the MERGED set in the endpoint.
// Asserting avesmapsReportListOrderBy alone leaves that line unguarded -- reproduced: flipping the
// comparator to newest-first passed all 208 tests while the cap started removing the OLDEST open
// reports, the precise opposite of what it is for. So the comparator is pinned literally.
assert(
    str_contains(
        $endpointSource,
        "static fn(array \$left, array \$right): int => [\$left['created_at'] ?? '', (int) (\$left['id'] ?? 0)] <=> [\$right['created_at'] ?? '', (int) (\$right['id'] ?? 0)]"
    ),
    'the merged open queue is sorted ascending -- the cap cuts the newest, never the oldest'
);

// --- The endpoint must use this, and must say when it cut ------------------------------------------
//
// 💣 Asserting the library alone proves nothing about what ships -- a green test once sat on top of a
// live bug for exactly that reason (api/_internal/app/__tests__/report-outcome-test.php).
assert(
    str_contains($endpointSource, "require_once __DIR__ . '/../../_internal/map/report-review-list.php';"),
    'the endpoint loads this library'
);
assert(
    str_contains($endpointSource, "avesmapsNormalizeReportListFilter(\$_GET['status'] ?? null)"),
    'the request parameter goes through the whitelist before anything else touches it'
);
assert(
    preg_match('/WHERE \' \. \$statusCondition \. \'/', $endpointSource) === 1
        || substr_count($endpointSource, '$statusCondition') >= 3,
    'both table queries build their WHERE from the whitelisted condition'
);
assert(
    !preg_match("/WHERE\s+status\s*=\s*:status/", $endpointSource),
    'no query may still hardcode the open queue -- that was the finding'
);
// ⚠️ No silent caps: a shortened list that does not say so reads as "that is all of them", which is
// the same lie the missing list told.
assert(
    str_contains($endpointSource, "'truncated' => \$truncated"),
    'the response says whether it was cut short'
);
assert(
    str_contains($endpointSource, "'limit' => \$cap"),
    'and at what number, so the panel can print it'
);
// 💣 The endpoint must take the cap from the filter, not from the constant. It used to hardcode the
// processed-list constant in both places -- harmless only while the open branch fetched without a
// LIMIT and could never reach it. Left as it was, it would now cut the open queue at 200.
assert(
    !str_contains($endpointSource, 'count($reports) > AVESMAPS_REPORT_LIST_DONE_LIMIT'),
    'the truncation check no longer hardcodes the processed cap'
);
assert(
    str_contains($endpointSource, '$cap = avesmapsReportListCap($filter);')
        && str_contains($endpointSource, 'count($reports) > $cap'),
    'it cuts at the cap belonging to the filter it was asked for'
);
// ⚠️ Two halves, two caps, two flags. "Alle" merges an oldest-first queue capped at 500 with a
// newest-first history capped at 200; one shared flag could only say something false about one of
// them, and the panel words its notice from these fields.
assert(
    str_contains($endpointSource, "'open_truncated' => \$open['truncated']")
        && str_contains($endpointSource, "'open_limit' => \$open['limit']"),
    'the combined answer reports the open half separately'
);

// --- And the panel must actually say it ----------------------------------------------------------
//
// 💣 The client carried a comment stating the opposite -- "Bei Alle gilt der Deckel NUR fuer die
// bearbeitete Haelfte -- die offenen sind vollstaendig". That sentence was true when it was written
// and is false now, and a stale reassurance is worse than none: it is precisely the "that is all of
// them" lie this whole finding is about, only in prose.
$panelSource = file_get_contents(__DIR__ . '/../../../../js/review/review-panels.js');
assert(is_string($panelSource) && $panelSource !== '', 'the review panel is readable');
assert(
    !str_contains($panelSource, 'die offenen sind vollstaendig'),
    'the panel no longer promises the open list is complete'
);
assert(
    str_contains($panelSource, 'data.open_truncated === true'),
    'the panel reads the open half of the truncation report'
);
assert(
    str_contains($panelSource, 'reviewReportsOpenLimit'),
    'and the number belonging to it'
);
// 💣 map_reports and users share `id` and `created_at`. A LEFT JOIN under this unqualified column list
// would make every load of the review list answer 500 -- the reviewer name comes from a correlated
// subselect instead.
assert(
    !preg_match('/FROM map_reports\s+LEFT JOIN users/i', $endpointSource),
    'no join onto users under an unqualified column list'
);
assert(
    str_contains($endpointSource, 'AS reviewed_by_username'),
    'a processed report still names who decided it'
);

echo "report-review-list ok\n";
