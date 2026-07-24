# Dump report in the conflict centre — design

**Date:** 2026-07-24
**Status:** approved (owner), not yet implemented
**Surface:** WikiSync editor — the "Dump-Report" overlay + the "⚖️ Konflikte" list

## 1. Problem

"Dump holen" runs for roughly ten minutes. Its result — how many pages were read,
what the sharp publication reconcile added/changed/removed — exists today only in a
**three-second toast** and a status line that the next click overwrites.

Owner, verbatim: *"wenn du bei einem 10 minuten vorgang einen 3 sekunden toast
anzeigst werd ich bestimmt nicht drauf achten"*. That is the whole bug. Nobody
watches a ten-minute job to the second, so the outcome of the most expensive
operation in the editor is effectively unobservable.

A second, related gap: the Dump-Report overlay that opens after a successful run
currently shows **only the self-tests**. The run's own numbers were never in it.

## 2. Goal

After a dump run the editor can answer "what did that actually do?" — immediately,
and still tomorrow.

Non-goal for this round: the "Δ Live" column of the approved mockup (dump vs. the
live database). It needs the compare engine over the whole dataset, which is the
kind of load that has saturated STRATO's PHP workers before. It gets its own round.

## 3. Approach

Three decisions, all owner-approved:

1. **The report is written once, at the end of the run, by the client.** The client
   drives "Dump holen" step by step and therefore already holds the totals. One POST
   at the end persists them.

   Considered and rejected: having the server accumulate the report step by step, so
   that an aborted run also leaves a trace. It is more machinery than the actual
   complaint warrants — the complaint is about *successful* runs whose result
   vanished. **Accepted cost:** a run that dies mid-way leaves no report at all. If
   that ever bites, "started, never finished" can be added later from the existing
   run/lock state without redesigning anything.

2. **The last report is reachable from "Konflikte" as its own category at the top.**
   It is always present, but only counts as *notable* when something looked wrong.
   A clean run leaves a quiet, grey line.

3. **The category reads; it never computes.** The conflict centre's core invariant is
   that conflicts are computed and never stored, so that a repaired case disappears by
   itself. A report is the opposite — a snapshot of a moment. Keeping it read-only and
   verb-less is what stops it from becoming a pseudo-conflict that the invariant no
   longer describes.

## 4. Data

### 4.1 Table `wiki_dump_report`

Inline `CREATE TABLE IF NOT EXISTS` (the project's self-healing schema pattern).

| Column | Type | Meaning |
|---|---|---|
| `id` | BIGINT UNSIGNED AI | pk |
| `run_id` | BIGINT UNSIGNED | the `wiki_sync_runs.id` of the dump run, `UNIQUE` |
| `created_at` | TIMESTAMP(3) | when the report was stored |
| `duration_s` | INT UNSIGNED | wall-clock of the whole run |
| `notable` | TINYINT(1) | 1 = something looked wrong (see §5) |
| `notable_reason` | VARCHAR(255) NULL | short German reason, shown in the list |
| `report_json` | MEDIUMTEXT | the snapshot (§4.2) |

**Retention: the newest `AVESMAPS_DUMP_REPORT_KEEP` (5) rows, enforced on every write.**

> 💣 `report_json` holds **scalars only** — per-phase counters, never record lists.
> This is the direct lesson from `wiki_sync_runs.stats_json`, which reached 99 MiB
> across 99 rows (~1 MiB each) because it was used as an inter-phase scratchpad for
> full record arrays. The same table shape without this rule is the same accident a
> second time.

### 4.2 `report_json` shape

```json
{
  "started_at": "2026-07-24T08:10:00Z",
  "finished_at": "2026-07-24T08:20:12Z",
  "steps": {
    "fetch_dump":        { "ok": true },
    "read":              { "pages_scanned": 123456,
                           "by_kind": { "settlement": 5123, "path": 3721, "territory": 812 } },
    "cleanup_state":     { "ok": true },
    "sync_publications": { "processed": 1526, "added": 12, "updated": 3, "removed": 0 }
  },
  "selftests": { "total": 10, "green": 10, "red": 0, "failed": [] }
}
```

`by_kind` keys are whatever the driver's `$stats` already carries — the driver
already threads a `$stats` array through the phases, so these numbers are produced
today and merely discarded.

## 5. What counts as "notable"

Determined **when the report is stored** and persisted in `notable` /
`notable_reason`, so that rendering the conflict list never recomputes anything.

A run is notable when any of these hold:

1. **A self-test is red.**
2. **A step did not report `ok`.**
3. **A kind collapsed against the previous run** — its count fell by more than
   `AVESMAPS_DUMP_REPORT_DROP_RATIO` (0.10) *and* by more than
   `AVESMAPS_DUMP_REPORT_DROP_MIN` (50) absolute.

Rule 3 is the one that earns its keep. The `Art`-gate incident swallowed ~430
adventures silently: the run "succeeded", the numbers simply came out lower, and
nobody had a previous number to compare against. Both thresholds are needed — a
ratio alone screams about small kinds, an absolute alone misses proportional
collapses in small ones.

With fewer than two stored reports, rule 3 cannot fire and is skipped (not treated
as notable).

## 6. Components

| Piece | Where | Kind |
|---|---|---|
| Schema + read/write/prune | `api/_internal/wiki/dump-report.php` (new) | DB |
| `save_report` action | `api/edit/wiki/dump.php` (extend) | endpoint, capability `edit` |
| Δ vs. previous run | `avesmapsDumpReportDelta()` | **pure** |
| Notable classifier | `avesmapsDumpReportClassify()` | **pure** |
| Retention prune | `avesmapsDumpReportPrune()` | DB, thin |
| Conflict category | `api/_internal/conflicts/rules.php` — rule `dump.last_run` | read-only |
| "Lauf" section in the overlay | `js/review/review-wiki-sync.js` (extend) | UI |

The overlay is **extended, not rebuilt**: a "Lauf" section above the existing
"Selbsttests" section, same design tokens.

### Conflict-centre integration

A registry entry `dump.last_run`, labelled **"Letzter Dump-Lauf"**, pinned to the
top of the list. It carries **no decision verbs** — there is nothing to approve,
defer or archive about a protocol. Its count is 1 when `notable`, otherwise it
renders quiet. Clicking it opens the existing Dump-Report overlay populated from the
stored report instead of from a fresh run.

> ⚠️ To verify during implementation, not assumed here: that the conflicts UI
> renders a verb-less, pinned entry without special-casing. If it does not, the
> smaller change is to teach the renderer "informational entry", not to give the
> report fake verbs.

## 7. Data flow

```
"Dump holen" (client-driven, 4 steps)
        │  client collects per-step totals it already receives
        ▼
POST dump.php {action:"save_report", run_id, report}
        │  classify → notable/notable_reason ; insert ; prune to 5
        ▼
wiki_dump_report
        ├──► overlay opens right away with the "Lauf" section       (same run)
        └──► "Konflikte" ▸ "Letzter Dump-Lauf"                      (later, any day)
```

## 8. Error handling

- **Save fails** (network, session expired): the run itself already succeeded, so it
  is never rolled back. The overlay still shows the numbers it holds in memory and
  says plainly that storing failed. Losing a report must not look like a failed dump.
- **Malformed/absent `report_json`** when reading: the category renders as "kein
  Bericht vorhanden" rather than throwing. A report is a convenience; it must not be
  able to break the conflict list.
- **No previous run**: Δ column is omitted, rule 3 skipped.

## 9. Testing

Unit tests in `api/_internal/wiki/__tests__/dump-report-test.php`, DB-free, run with:

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/wiki/__tests__/dump-report-test.php
```

Covered — the three pure cores:

1. **Δ computation** — added/removed kinds, a kind missing on one side, first-ever run.
2. **Notable classifier** — each rule in isolation; both thresholds needed (a 5 %
   drop is quiet, a 40 % drop of 3 rows is quiet, a 40 % drop of 800 is notable);
   fewer than two reports never fires rule 3.
3. **Retention prune** — keeps exactly the newest 5, is idempotent.

**Not testable locally, and not to be claimed as verified:** everything DB-bound and
the real run. There is no local database and no dump. The proof is one "Dump holen"
by the owner; that is announced as an owner action, not reported as done.

## 10. Deployment notes

- Pure backend + one JS file. **No `?v=` by hand**: `review-wiki-sync.js` hangs off
  `index.html` and is stamped automatically by the deploy.
- `ASSET_VERSION` in `territory-editor-inline-host.js` governs the *dynamically
  loaded editor assets* only and is **not** touched by this change.
- `html/editor-handbuch.html` is not edited here — the nightly routine owns it. The
  obligation is a commit subject naming the visible effect ("the dump run's result is
  kept and findable under Konflikte").

## 11. Owner action after deploy

🔧 **DU:** one "Dump holen". It is the first run that writes a report, and the only
way to prove the chain end to end. Until then the category correctly shows "kein
Bericht vorhanden".
