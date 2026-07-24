# Deterministic `wiki_key` transliteration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the libc-dependent `iconv('UTF-8','ASCII//TRANSLIT//IGNORE', …)`
in all five derivation sites with one deterministic character table that
reproduces the STRATO server's current output byte for byte, and make the three
permanently-red Dump-Report self-tests green in both environments.

**Architecture:** One new pure function `avesmapsFoldToAscii()` in
`api/_internal/text/ascii-fold.php`. It maps the latin ligature family
(`ß æ Æ œ Œ ﬀ ﬁ ﬂ ﬃ ﬄ`) to their ASCII expansions and **every other non-ASCII
codepoint to `'?'`**. Five call sites drop their `if (function_exists('iconv'))`
block and call it instead. No data changes.

**Tech Stack:** PHP 8 (strict types), `mbstring` only. No framework, no build
step. Tests are stand-alone CLI scripts under `tools/wikidump/` with a hand-rolled
`$check()` harness, surfaced in the browser by `api/edit/wiki/selftest.php`.

## Global Constraints

- **The table reproduces the SERVER, not the dev machine.** `ü ö ä` etc. fold to
  `'?'` (one separator, base letter lost) — verified against 1384/1384 live rows.
  Design: `docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md`.
- **No existing key may change.** No migration, no schema change, no data write.
- **Order in the callers is untouched:** the existing `str_replace` lines stay
  *before* the fold; only the `iconv` block is replaced.
- Run every PHP test with:
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <test>`
- **Shared working tree:** never `git add -A` / `git add .` / `git commit -a`.
  Stage by explicit path; commit with `git commit -m "…" --only -- <paths>`.
- Files are `i/lf w/crlf attr/text` — prefer single-line edits, verify with
  `git diff --stat` that no file shows a whole-file rewrite.
- Commit messages in English, conventional prefixes. Editor-visible effect
  belongs in the subject; **do not touch `html/editor-handbuch.html`**.
- No `ASSET_VERSION` bump (server-side code only, no editor assets).

---

## File Structure

| Path | Responsibility |
|---|---|
| `api/_internal/text/ascii-fold.php` | **new** — the single deterministic fold. Pure, no I/O, no requires. |
| `tools/wikidump/test-ascii-fold.php` | **new** — pins the table over the complete live character repertoire. |
| `tools/wikidump/verify-live-key-parity.php` | **new** — repeatable proof against production (network, manual only). |
| `api/_internal/political/territory.php` | `avesmapsPoliticalSlug()` — the `wiki_key` mine. |
| `api/_internal/wiki/sync.php` | `avesmapsWikiSyncCreateMatchKeyInternal()` — the match-key mine. |
| `api/_internal/political/territories-read.php` | `avesmapsPoliticalNormalizeHierarchyRootKey()` — transient. |
| `api/_internal/political/wiki-browser-support.php` | `makeStableKey()` — transient, no-op on the server. |
| `api/app/map-search.php` | `avesmapsNormalizeSearchText()` — transient, no-op on the server. |
| `api/edit/wiki/selftest.php` | test registry — gains the 11th entry. |
| `tools/wikidump/test-wiki-key-derivation.php` | 6 umlaut expectations + banner. |
| `tools/wikidump/test-dump-entities.php` | 5 umlaut expectations + banner. |
| `tools/wikidump/test-dump-reader.php` | 1 umlaut expectation + banner. |

---

### Task 1: The deterministic fold

**Files:**
- Create: `api/_internal/text/ascii-fold.php`
- Test: `tools/wikidump/test-ascii-fold.php`

**Interfaces:**
- Consumes: nothing.
- Produces: `avesmapsFoldToAscii(string $value): string` — the only symbol other
  tasks call. Idempotent on pure-ASCII input.

- [ ] **Step 1: Write the failing test**

`tools/wikidump/test-ascii-fold.php`, following the house harness (banner,
`$check` closure, `RESULT: n/m passing (k failing)`, `exit(1)` on failure).
It must assert, at minimum:

```php
// The ligature family — the ONLY entries whose output contains [a-z0-9].
$check('sharp s',        'ss',  avesmapsFoldToAscii('ß'),  'ligature family');
$check('aesc',           'ae',  avesmapsFoldToAscii('æ'),  'MEASURED: Horasiat Hældingard -> wiki:horasiat-haeldingard');
$check('aesc upper',     'AE',  avesmapsFoldToAscii('Æ'),  'ligature family');
$check('oe ligature',    'oe',  avesmapsFoldToAscii('œ'),  'ligature family');
$check('oe lig upper',   'OE',  avesmapsFoldToAscii('Œ'),  'ligature family');
$check('ff ligature',    'ff',  avesmapsFoldToAscii('ﬀ'),  'ligature family');
$check('fi ligature',    'fi',  avesmapsFoldToAscii('ﬁ'),  'ligature family');
$check('fl ligature',    'fl',  avesmapsFoldToAscii('ﬂ'),  'ligature family');
$check('ffi ligature',   'ffi', avesmapsFoldToAscii('ﬃ'), 'ligature family');
$check('ffl ligature',   'ffl', avesmapsFoldToAscii('ﬄ'), 'ligature family');

// Everything else -> '?'. One per character actually present in the live data.
$check('u umlaut',   'f?rstentum', avesmapsFoldToAscii('fürstentum'), 'SERVER form: base letter is LOST');
$check('o umlaut',   'k?nigreich', avesmapsFoldToAscii('königreich'), 'SERVER form');
$check('a umlaut',   '?rger',      avesmapsFoldToAscii('ärger'),      'SERVER form');
```

plus one assertion per remaining live codepoint (the full list is in the design
doc §2.1: `ô û Ü â î á Ö é ï ú Ä í ÿ ë ê è à ó Ê ŭ · „ “ ‘ ’ « » – — … ´ ° →`,
U+00A0, U+200E, U+FE0F and an emoji), and the invariants:

```php
$check('ascii untouched',  'Angbar-1',  avesmapsFoldToAscii('Angbar-1'), 'pure ASCII passes through');
$check('empty string',     '',          avesmapsFoldToAscii(''),         'empty in, empty out');
$check('one char one mark','a?b',       avesmapsFoldToAscii('aüb'),      'exactly ONE replacement char per codepoint');
```

The last one is load-bearing: the slug regex collapses runs, so emitting two
characters where the server emits one is invisible in most cases but changes
`trim($slug,'-')` at the edges.

- [ ] **Step 2: Run it and watch it fail**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll tools/wikidump/test-ascii-fold.php
```

Expected: fatal — `avesmapsFoldToAscii()` is not defined by the included library.
(The test's own precondition loop should report it and `exit(2)`.)

- [ ] **Step 3: Write the minimal implementation**

`api/_internal/text/ascii-fold.php`: `declare(strict_types=1)`, no requires, a
`const`/static map of the ten ligature entries, an `mb_str_split()` loop that
passes single-byte ASCII through, looks the codepoint up in the map, and
otherwise appends `'?'`. The docblock must state **why** `'?'` and not the base
letter, name the measurement (1384/1384) and point at the design doc — this is
the file a future reader will try to "improve".

- [ ] **Step 4: Run it and watch it pass**

Same command. Expected: `RESULT: n/n passing (0 failing)`, exit 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(wiki-key): a deterministic ASCII fold that reproduces the server" --only -- api/_internal/text/ascii-fold.php tools/wikidump/test-ascii-fold.php
```

---

### Task 2: The two key-deriving sites

**Files:**
- Modify: `api/_internal/political/territory.php:1061-1066` (`avesmapsPoliticalSlug`)
- Modify: `api/_internal/wiki/sync.php:247-252` (`avesmapsWikiSyncCreateMatchKeyInternal`)
- Test: `tools/wikidump/test-wiki-key-derivation.php` (6 expectations + banner)

**Interfaces:**
- Consumes: `avesmapsFoldToAscii()` from Task 1.
- Produces: unchanged public signatures — `avesmapsPoliticalSlug()`,
  `avesmapsPoliticalBuildWikiKey()`, `avesmapsWikiSyncCreateMatchKey()`.

- [ ] **Step 1: Rewrite the six expectations to the server form**

In `tools/wikidump/test-wiki-key-derivation.php`, cases b, f, h, q, r, u:

```php
'wiki:f-rstentum-kosch'   // (b) was 'wiki:f-urstentum-kosch'
'name:f-rstentum-kosch'   // (f) was 'name:f-urstentum-kosch'
'frstentumkosch'          // (h) was 'furstentumkosch'
'knigreich'               // (q) was 'konigreich'
'berdenwolken'            // (r) was 'uberdenwolken'
''                        // (u) 'ÄÖÜ' -> '???' -> every char dropped
```

Case (u) needs its label/why rewritten too: the point is no longer "base letters
survive", it is "all three vanish". Update each `why` string and the inline
comment above each case to describe the `'?'` fold.

Replace the docblock's "THE UMLAUT QUIRK — environment-dependent" section and the
banner's `NOTE: … iconv/locale-dependent` lines: the derivation is deterministic
now, and the banner should print `avesmapsFoldToAscii('Köln Ärger Übel
Fürstentum')` instead of the `iconv` sample.

- [ ] **Step 2: Run it and watch exactly those six fail**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll tools/wikidump/test-wiki-key-derivation.php
```

Expected: `RESULT: 16/22 passing (6 failing)` — the same six the STRATO panel
reports. This is the local reproduction of the server-only failure; it proves the
test now encodes the server's form and the production code does not yet.

- [ ] **Step 3: Swap both production sites**

In each, replace the `if (function_exists('iconv')) { … }` block with
`$slug = avesmapsFoldToAscii($slug);` (resp. `$value`), and add
`require_once __DIR__ . '/../text/ascii-fold.php';` at the top of the file,
guarded the way the file's neighbours do it. Leave the preceding `str_replace`
lines exactly as they are.

- [ ] **Step 4: Run it and watch all 22 pass**

Same command. Expected: `RESULT: 22/22 passing (0 failing)`.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(wiki-key): derive slugs and match keys from a fixed table, not the system libc" --only -- api/_internal/political/territory.php api/_internal/wiki/sync.php tools/wikidump/test-wiki-key-derivation.php
```

---

### Task 3: The three transient sites

**Files:**
- Modify: `api/_internal/political/territories-read.php:1111-1116`
- Modify: `api/_internal/political/wiki-browser-support.php:14-19`
- Modify: `api/app/map-search.php:391-396`
- Test: `tools/wikidump/test-ascii-fold.php` (extend)

**Interfaces:**
- Consumes: `avesmapsFoldToAscii()`.
- Produces: unchanged signatures — `avesmapsPoliticalNormalizeHierarchyRootKey()`,
  `makeStableKey()`, `avesmapsNormalizeSearchText()`.

- [ ] **Step 1: Extend the fold test with the two includable callers**

`wiki-browser-support.php` and `territories-read.php` have no top-level
`require`, so the test can include them directly (check for a function-name
clash with `territory.php` first; include only what is needed).

```php
$check('stable key, umlaut pre-mapped', 'fuerstentum-kosch',
       makeStableKey('Fürstentum Kosch'),
       'makeStableKey maps ü->ue itself; the fold never sees it — NO-OP');
$check('stable key, residual accent',   'c-te-d-or',
       makeStableKey('Côte d’Or'),
       'ô is NOT pre-mapped -> fold -> "?" -> hyphen (same as today on the server)');
$check('root key, umlaut',              'unabhngig',
       avesmapsPoliticalNormalizeHierarchyRootKey('unabhängig'),
       'SERVER form — this is why line 1095 lists BOTH spellings');
```

Derive each expected literal by hand from the design doc, never by printing the
function's own output.

- [ ] **Step 2: Run and watch the new cases fail**

Same command on `test-ascii-fold.php`. Expected: the three new cases FAIL
(locally `iconv` still yields the `"o` artifact, so e.g. `makeStableKey` returns
`c-te-d-or` vs … — confirm the actual local text in the failure output before
proceeding; if a case passes immediately it is not testing the swap and must be
re-derived).

- [ ] **Step 3: Swap all three sites**

Same one-block replacement as Task 2. `map-search.php` is an endpoint and cannot
be included by a test; it gets the identical swap and is covered by Task 5's
live check. Its `@`-suppression disappears with the `iconv` call.

- [ ] **Step 4: Run and watch everything pass**

Run `test-ascii-fold.php` **and** `test-wiki-key-derivation.php`. Expected: both
`0 failing`.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(wiki-key): the last three iconv call sites move to the fixed table" --only -- api/_internal/political/territories-read.php api/_internal/political/wiki-browser-support.php api/app/map-search.php tools/wikidump/test-ascii-fold.php
```

---

### Task 4: The two remaining red tests

**Files:**
- Modify: `tools/wikidump/test-dump-entities.php` (5 expectations + banner at :233-250)
- Modify: `tools/wikidump/test-dump-reader.php` (1 expectation + banner at :85-105)

**Interfaces:** none — test-only.

- [ ] **Step 1: Run both and record the exact failures**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll tools/wikidump/test-dump-entities.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll tools/wikidump/test-dump-reader.php
```

Expected after Tasks 2-3: `163/168` and `24/25` — locally, now, for the first
time. Copy the `expected:`/`actual:` pairs out of the output; the `actual` column
is the new deterministic value.

- [ ] **Step 2: Rewrite those six expectations by hand**

For each failure, derive the new literal from the design doc's rule (umlaut →
one `'?'` → hyphen in the slug scheme, dropped in the match-key scheme) and
confirm it equals the reported `actual`. If a reported `actual` does **not**
match the hand-derived value, stop — that is a real defect, not an expectation
to update.

Replace both `iconv(…) (umlaut outcome is env-dependent)` banner lines with the
fold's output and drop the "env-dependent" wording.

- [ ] **Step 3: Run both again**

Expected: `168/168` and `25/25`, exit 0.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(wikidump): pin the umlaut expectations to the deterministic fold" --only -- tools/wikidump/test-dump-entities.php tools/wikidump/test-dump-reader.php
```

---

### Task 5: Panel registration and the repeatable proof

**Files:**
- Modify: `api/edit/wiki/selftest.php:49-60` (`$TESTS`)
- Create: `tools/wikidump/verify-live-key-parity.php`

**Interfaces:**
- Consumes: `avesmapsFoldToAscii()`, `avesmapsPoliticalBuildWikiKey()`.
- Produces: self-test key `ascii-fold`, label `ASCII-Faltung (Umschrift-Tabelle)`.

- [ ] **Step 1: Register the 11th test**

Add to `$TESTS`, keeping the existing key style:

```php
'ascii-fold'       => ['file' => 'test-ascii-fold.php',                  'label' => 'ASCII-Faltung (Umschrift-Tabelle)'],
```

Confirm `test-ascii-fold.php` satisfies the runner's contract: DB-free, prints a
`RESULT:` line in one of the two parsed dialects, ends in `exit()`.

- [ ] **Step 2: Write the parity tool**

`tools/wikidump/verify-live-key-parity.php`: one `GET
https://avesmaps.de/api/app/political-territory-wiki.php?limit=2000`, rebuild
each `wiki_key` with `avesmapsPoliticalBuildWikiKey($row['wiki_url'], $row['name'])`,
report `match/mismatch` plus the first 25 mismatches. Header comment: **single
request, never in a loop** (AGENTS.md §9, STRATO).

- [ ] **Step 3: Run it against production**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll tools/wikidump/verify-live-key-parity.php
```

Expected: `match: 1384  mismatch: 0`. A single mismatch means the table does not
reproduce the server — stop and fix the table, do not touch data.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(dump-report): the self-test panel gains the ASCII-fold check (11 tests)" --only -- api/edit/wiki/selftest.php tools/wikidump/verify-live-key-parity.php
```

---

### Task 6: Documentation

**Files:**
- Modify: `AGENTS.md` (§10 known fragilities)
- Modify: `docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md` (status line)

**Interfaces:** none.

- [ ] **Step 1: Retire the fragility**

AGENTS.md §10 has no `iconv` entry today — add none. Instead add one line to §5
(data model, `wiki_key`) recording that the key derivation is table-driven and
must reproduce the server, pointing at the design doc. Keep it to two lines; §5
is already long.

- [ ] **Step 2: Mark the spec as shipped**

Add `**Status:** umgesetzt 2026-07-24` under the spec's date line.

- [ ] **Step 3: Commit and push**

```bash
git commit -m "docs(wiki-key): record that the key derivation is table-driven" --only -- AGENTS.md docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md
git push
```

Then verify the remote SHA and wait ~1-2 min before checking the live site.

- [ ] **Step 4: 🔧 Owner check**

Open the editor → WikiSync → „⚖️ Konflikte" → Dump-Bericht and run the self-test
panel. Expected: **11/11 green** on the server, identical to local.

---

## Self-Review

**Spec coverage:** §4.1 fold → Task 1. §4.2 five call sites → Tasks 2+3. §4.3
untouched ordering → constraint in Tasks 2/3 Step 3. §5 tests → Tasks 2, 4, and
the registration in Task 5. §6 parity tool → Task 5. §7 "what does not happen" →
Global Constraints. §3 preserve-not-migrate → Global Constraints.

**Placeholders:** none — every expectation literal is spelled out, every command
is complete, every commit line names its paths.

**Type consistency:** `avesmapsFoldToAscii(string): string` is the single name
used in Tasks 1, 2, 3 and 5. Self-test key `ascii-fold` matches the file
`test-ascii-fold.php` in Tasks 1 and 5.

**Known gap, deliberate:** `avesmapsNormalizeSearchText()` in `map-search.php`
cannot be unit-tested without refactoring the endpoint. It is a proven no-op on
the server (its umlauts are pre-mapped) and is covered by Task 5's owner check.
