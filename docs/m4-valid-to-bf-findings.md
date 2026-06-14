# M4 findings — `valid_to_bf` / BF-year divergence (analysis + proposal, awaiting sign-off)

Status: 2026-06-14 · read-only analysis · **no code changed yet.** Per the owner rule
"business logic unchanged / list workflow-affecting changes for sign-off", consolidating
these would change behaviour, so this documents the divergences and proposes a canonical
model for approval before any edit.

## TL;DR

There is **no single convention** for "open-ended / never-dissolved". Three layers
disagree on the sentinel, and several helpers disagree on edge cases:

| Layer | "open-ended" is represented as |
|---|---|
| DB storage + most SQL filters | `valid_to_bf IS NULL` **or** `= 0` |
| One SQL filter (derived-geometry-plan) | only `IS NULL` (treats `0` as a real year) |
| Frontend (political timeline) | `null` **or** `>= 9999` (`endYear < 9999` = "has end") |
| `AGENTS.md` §2 glossary | `9999 = open/never-dissolved sentinel` |
| Parser note (memory) | `0` is a **real** year ("0 BF" = Bosparans Fall), NOT open |

So `0`, `9999`, and `NULL` are each used as "open" *somewhere*, and `0` is simultaneously
documented as a **real** year — a genuine semantic conflict, not just code duplication.

## Concrete divergences found (code literally differs)

1. **SQL time-filter mismatch on `= 0`:**
   - `territories-derived-layer.php:162` → `valid_to_bf IS NULL OR valid_to_bf = 0 OR valid_to_bf >= :year_bf_end` (0 = open)
   - `territories-derived-geometry-plan.php:225` → `valid_to_bf IS NULL OR geometry.valid_to_bf >= ?` (0 NOT treated as open)
   → A row with `valid_to_bf = 0` is "open" in the layer query but "dissolved at year 0" in the plan query.

2. **PHP open-ended predicate mismatch (empty case):**
   - `avesmapsPoliticalNormalizeRowValidTo` (territories-support.php:153): empty ⇒ open only when **both** `dissolved_type === '' AND dissolved_text === ''`.
   - `avesmapsPoliticalReadDissolvedValidTo` (territory.php:796): `dissolved_text === ''` **alone** ⇒ open (regardless of type).
   → Disagree when text is empty but type is set (or the reverse).

3. **BF formatter mismatch on the 9999 sentinel:**
   - `avesmapsTerritoryDetailFormatBf` (app/territory-detail.php:49): `>= 9999 → "besteht"`.
   - `avesmapsWikiSyncFormatBfYear` (_internal/wiki/territories.php:2487): no 9999 branch → would render `"9999 BF"`.

4. **The `0`-vs-`9999` storage conflict:** the 0-BF parser fix deliberately stores a real
   "0 BF" dissolution as `valid_to_bf = 0`, yet the layer SQL treats `0` as open-ended → a
   territory genuinely dissolved in 0 BF would render as never-dissolved. (Needs owner
   confirmation of the intended 0-BF semantics before any change.)

## Functions in scope (different inputs — NOT trivially mergeable)

- `avesmapsPoliticalReadEditorValidTo` (editor state: `existsUntilToday`/`endYear`)
- `avesmapsPoliticalReadOpenEndedValidTo` (POST payload: `valid_to_open`/`valid_to_bf`)
- `avesmapsPoliticalNormalizeRowValidTo` (DB row + `dissolved_type/text`)
- `avesmapsPoliticalNormalizedValidToSql` (SQL twin of the row normalizer — necessarily duplicated across PHP/SQL)
- `avesmapsPoliticalReadDissolvedValidTo` (wiki record: `dissolved_*`)
- Formatters: `avesmapsTerritoryDetailFormatBf`, `avesmapsWikiSyncFormatBfYear`
- Parsers: `avesmapsPoliticalSubtreeDisplayReadOptionalYear`, `avesmapsPoliticalReadOptionalInt`, `avesmapsPoliticalNullableInt`

These read **different sources**, so the goal is not "one function" but **one shared set of
rules** (one open-ended predicate, one canonical sentinel, one formatter) that they all use.

## Proposed canonical model (for sign-off)

**Open-ended sentinel:** keep **`NULL`** as the single internal "open-ended" truth (SQL
already special-cases NULL everywhere; the row normalizer already converts open `0`→`NULL`).
`0` stays a **real** year. `9999` is treated as open at the contract boundary (frontend) and
normalized to `NULL` on read. This matches the dominant code path and the 0-BF parser intent.

**Then, the minimal behaviour-preserving consolidation:**
- One predicate `avesmapsPoliticalIsOpenEndedDissolved($type, $text)` used by both PHP
  call-sites (#2) — owner picks the empty-case rule (recommend: open when text is empty OR
  type ∈ {ongoing,unknown,''}).
- One formatter `avesmapsFormatBfYear($year)` with the 9999→"besteht" branch, used by both
  formatter sites (#3). (German text unchanged; only wiki-sync gains the 9999 branch.)
- Align the two SQL filters (#1) on the same open-ended rule (recommend: include `= 0` in
  the plan query, matching the layer query) — **OR**, if `0` should mean "year 0", remove
  `= 0` from the layer query instead. **This is the one that needs an explicit decision**, as
  it changes which territories render in a timeline.

## Recommendation

Two paths — pick one:
- **(A) Minimal, low-risk (recommended):** fix #2/#3 by extracting the shared predicate +
  formatter (behaviour-preserving except wiki-sync's 9999 rendering, which is a strict
  improvement), and reconcile #1 to the **layer** convention (`= 0` = open). Document the
  sentinel model in `AGENTS.md`. No data migration.
- **(B) Full:** migrate stored `9999`/`0`-as-open to `NULL` and make `0` strictly mean "year
  0" everywhere. Higher risk (data migration + every consumer), bigger correctness payoff.

## ✅ Resolution — Path A implemented (owner-approved, `0` = open)

Owner chose **Path A** with `valid_to_bf = 0` meaning open-ended. Implemented + live-verified:

- **#3 formatter:** one canonical `avesmapsFormatBfYear` in bootstrap (9999→"besteht"); the two
  old formatters are now 1-line delegates. wiki-sync gained the 9999 branch (strict improvement).
- **#2 predicate:** one `avesmapsPoliticalIsOpenEndedDissolved($type, $text)` in `territory.php`
  (loaded everywhere political), used by both `NormalizeRowValidTo` (behaviour-identical) and
  `ReadDissolvedValidTo` (canonical edge: empty text + real type ⇒ dissolved, not open).
- **#1 SQL:** added `OR geometry.valid_to_bf = 0` to the derived-geometry-plan timeline filter to
  match the layer query's 0=open convention.

Live-verified non-breaking: political layer still serves; `territory-detail` renders
`dissolved="besteht"` (9999 sentinel) and `founded="0 BF, …"` (0 = real year) correctly.

**Path B (full sentinel migration to a single NULL) was NOT done** — deliberately deferred (data
migration + every consumer = higher risk). The `9999`/`0`/`NULL` storage conventions still coexist;
this remains a candidate for a future dedicated migration if desired (see §"Proposed canonical model").
