<?php

declare(strict_types=1);

// Which community reports the review list asks for (finding A3). Pure: the whitelist and the SQL
// fragments, so both can be asserted without a database.
//
// 💣 Until 2026-08-05 the endpoint hardcoded status='neu' and there was no second list anywhere. A
// report that had been decided was simply gone -- not findable, not countable, not re-readable. During
// the system test two of the editors' own reports changed hands mid-run and nobody could establish what
// had become of them; and the twelve rows that test left behind are listed as "not removable" partly
// because no surface shows them at all.
//
// ⚠️ 'neu' is the DEFAULT and stays the default: every existing caller sends no parameter and must keep
// seeing exactly the queue it saw before.

const AVESMAPS_REPORT_LIST_FILTERS = ['neu', 'erledigt', 'alle'];

// ⚠️ A cap on the processed list, and it is SAID OUT LOUD -- the response carries `truncated` so the
// panel can print it. That list only ever grows, and a silently shortened list reads as "that is all of
// them", which is the same lie the missing list told in the first place.
const AVESMAPS_REPORT_LIST_DONE_LIMIT = 200;

// 💣 AND A CAP ON THE OPEN QUEUE TOO (finding A30). It had none: the endpoint read every
// status='neu' row of BOTH tables, with `comment` and `payload_json`, into one response. That is
// the target an unauthenticated writer aims at -- report_mode=change reaches the database without
// a login, a capability or a token, and since the hourly limit stopped counting change rows
// (A2, deliberately) nothing bounds how many arrive. The write channel is a product question;
// the unbounded READ is not, and it is the half that takes the editor's screen down.
//
// ⚠️ 500, not 200: this list is a work queue, not a history. It has to hold every report an
// editor still has to decide, and on a normal day it is a handful.
//
// ⭐ The ORDER is what makes the cap safe rather than merely bounded. Open reports come oldest
// first, so a flood lands at the END and is what gets cut -- the genuine backlog an editor was
// already working through stays visible. Cutting a newest-first queue would have done the
// opposite and hidden exactly the reports that matter.
const AVESMAPS_REPORT_LIST_OPEN_LIMIT = 500;

function avesmapsNormalizeReportListFilter(mixed $raw): string {
    // ⚠️ A query parameter is not necessarily a string: `?status[]=erledigt` hands PHP an array, and
    // casting one emits "Array to string conversion" -- a warning that, with display_errors on, prints
    // itself in front of the JSON and breaks the response for every caller. Non-scalars simply fall
    // back to the default, like any other unknown value.
    if (!is_scalar($raw)) {
        return 'neu';
    }

    $value = strtolower(trim((string) $raw));

    return in_array($value, AVESMAPS_REPORT_LIST_FILTERS, true) ? $value : 'neu';
}

// 💣 The ONLY thing that may be interpolated into the WHERE clause. It is built from a match over a
// whitelisted filter, never from a request value -- the filter reaches this function only through
// avesmapsNormalizeReportListFilter above.
function avesmapsReportListStatusCondition(string $filter): string {
    return match ($filter) {
        'erledigt' => "status <> 'neu'",
        default => "status = 'neu'",
    };
}

// Open reports read as a queue: oldest first, because that is the order they should be worked in.
// Processed ones read as a history: newest first. COALESCE, because a row whose status was changed
// before reviewed_at existed would otherwise sort into a corner.
function avesmapsReportListOrderBy(string $filter): string {
    return $filter === 'erledigt'
        ? 'COALESCE(reviewed_at, created_at) DESC, id DESC'
        : 'created_at ASC, id ASC';
}

// How many rows this filter may return. Two different numbers for two different lists -- a history
// that only grows, and a queue that should be short.
function avesmapsReportListCap(string $filter): int {
    return $filter === 'erledigt' ? AVESMAPS_REPORT_LIST_DONE_LIMIT : AVESMAPS_REPORT_LIST_OPEN_LIMIT;
}

// One more than the cap, so the caller can tell "exactly the cap" from "more than the cap" without
// a second COUNT query.
//
// ⚠️ Never 0 any more. Returning 0 meant "no LIMIT clause at all", which is what left the open
// queue unbounded; the whole point of A30 is that both branches now name a number.
function avesmapsReportListFetchLimit(string $filter): int {
    return avesmapsReportListCap($filter) + 1;
}
