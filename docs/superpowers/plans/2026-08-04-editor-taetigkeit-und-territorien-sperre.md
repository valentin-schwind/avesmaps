# Editor-Tätigkeit + Territorien-Sperre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Präsenzanzeige sagt, woran jeder Editor gerade sitzt, und am Territorienbaum darf immer nur einer schreiben.

**Architecture:** Das Schreibrecht wird nicht gespeichert, sondern bei jeder Anfrage aus `editor_presence` **abgeleitet**: wer den Bereich `territories` gemeldet hat und dessen Lebenszeichen frisch ist, und davon der, der zuerst da war. Damit gibt es keine Sperre, die man erwerben, freigeben oder verlieren kann. Serverseitig hängt alles an **einer** Zeile in `territories-endpoint.php` vor dem `match`, durch das alle 30 Schreibaktionen laufen; clientseitig meldet jeder Editor beim Öffnen/Schließen seinen Bereich über das bestehende 30-Sekunden-Lebenszeichen — kein zusätzlicher Poll.

**Tech Stack:** PHP 8 (strict types) + PDO/MySQL, Vanilla-JS ohne Build, Leaflet. Tests: PHP-CLI mit `zend.assertions=1`, Node für reine JS-Helfer.

Spec: `docs/superpowers/specs/2026-08-04-editor-taetigkeit-und-territorien-sperre-design.md`

## Global Constraints

- **OS/Shell:** Windows + PowerShell. CRLF-Editfalle: vor dem Editieren `git ls-files --eol <datei>` prüfen; auf CRLF-Dateien **einzeilige** Edits bevorzugen, mehrzeilige `old_string`s matchen dort nicht.
- **Shared Working Tree:** NIE `git add -A`/`git add .`/`git commit -a`. Nur eigene Dateien per Pfad stagen (`git commit --only -- <pfad>`). Im Baum liegt fremde unversionierte Arbeit (`verify-*.html`, diverse `docs/*-auftrag.md`) — nicht anfassen.
- **STRATO:** heiße Endpunkte NIE in Schleifen abfragen; Diagnose nur mit Einzelrequests.
- **Keine lokale DB:** kein `config.local.php`, kein `pdo_mysql`. Alles DB-Gebundene ist lokal nicht beweisbar — deshalb ist die Besitzerwahl eine **reine** Funktion (Task 1) und der Rest wird live geprüft (Task 8).
- **Test-Kommandos (Extensions sind Pflicht, sonst falsches Grün):**
  - PHP: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll <test>`
  - JS: `node <test.js>` (keine Flags, kein Runner)
- **Deploy:** Push auf `master` → ~1–2 min Auto-Deploy; danach Remote-SHA verifizieren. Das Deploy-Stamping setzt `?v=` — **nie von Hand schreiben** (AGENTS.md §7).
- **`ASSET_VERSION` bumpen** in `js/territory/territory-editor-inline-host.js` (aktuell `"20260804a"`), sobald Editor-Assets (`html/political-territory-editor.html`, dessen CSS/JS) angefasst werden — sonst serviert der Browser altes Editor-Markup.
- **Sprache:** deutsche UI-Strings bleiben deutsch; Code-Kommentare und `error.code`-Werte englisch (AGENTS.md §8).
- **Design:** keine Farb-/Radius-Literale, nur Tokens aus `css/base/tokens.css`; kein Blau (AGENTS.md §12).
- **Commits:** klein, konventionelle Prefixe, direkt auf `master`. Trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `api/_internal/map/editor-activity.php` — eine Verantwortung: „wer beansprucht gerade welchen Bereich". Von zwei Endpunkten gebraucht, gehört deshalb in keinen von beiden.
- **Create** `api/_internal/map/__tests__/editor-activity-test.php` — Unit-Tests der reinen Wahl.
- **Modify** `api/edit/map/presence.php` — Bereich/Label entgegennehmen, mitschreiben, `territory_claim` mitliefern; Spalten-Nachrüstung im bestehenden lazy-Zweig.
- **Modify** `api/_internal/political/territories-endpoint.php` — eine Zeile Schreibtor vor dem Schreib-`match`.
- **Modify** `js/app/runtime-state.js` — zwei Zustandsvariablen.
- **Modify** `js/review/review-panels.js` — Meldefunktion, Lebenszeichen-Payload, Tätigkeit in der Liste.
- **Create** `js/review/__tests__/editor-activity-view.test.js` — reine JS-Entscheidung.
- **Modify** die sechs Overlay-Öffner (`review-ecosystem-list.js`, `review-path-editor-list.js`, `review-powerline-list.js`, `review-settlement-list.js` ×3, `review-wiki-sync.js`) — Bereich melden.
- **Modify** `js/territory/territory-editor-link.js` — Bereich melden + Schreibzustand anwenden.
- **Modify** `html/political-territory-editor.html` — Hinweis-Band ganz oben in `.app-container`.
- **Modify** `css/pages/political-territory-editor.css` — Band-Stil aus Tokens.
- **Modify** `js/territory/territory-editor-inline-host.js` — `ASSET_VERSION`.

---

### Task 1: Bibliothek `editor-activity.php` mit reiner Besitzerwahl

**Files:**
- Create: `api/_internal/map/editor-activity.php`
- Test: `api/_internal/map/__tests__/editor-activity-test.php`

**Interfaces:**
- Produces:
  - `AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS` (int, 180)
  - `avesmapsNormalizeEditorActivityArea(?string $area): ?string`
  - `avesmapsNormalizeEditorActivityLabel(?string $label): ?string`
  - `avesmapsPickEditorAreaClaim(array $rows, int $claimSeconds): ?array` — **rein**
  - `avesmapsReadEditorAreaClaim(PDO $pdo, string $area): ?array`
  - `avesmapsBlockingEditorAreaClaim(PDO $pdo, string $area, array $user): ?array`
  - `avesmapsEnsureEditorActivityColumns(PDO $pdo): void`

- [ ] **Step 1: Failing test schreiben**

`api/_internal/map/__tests__/editor-activity-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit tests for the editor activity claim (api/_internal/map/editor-activity.php).
 *
 * Only the PURE parts are covered: the whitelist, the label normaliser and above all
 * avesmapsPickEditorAreaClaim -- the function that decides who owns the write right for an
 * area. That decision deliberately does NOT live in SQL: there is no local database in this
 * project, so an ORDER BY ... LIMIT 1 would ship untested. The candidate rows are a handful
 * (one per connected editor), so filtering them in PHP costs nothing and buys a proof.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/editor-activity-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../editor-activity.php';

// --- the whitelist -------------------------------------------------------------------------
assert(avesmapsNormalizeEditorActivityArea('territories') === 'territories', 'known area survives');
assert(avesmapsNormalizeEditorActivityArea('  paths  ') === 'paths', 'whitespace is trimmed');
assert(avesmapsNormalizeEditorActivityArea('Territories') === 'territories', 'case is folded');
assert(avesmapsNormalizeEditorActivityArea('kitchen') === null, 'unknown area is dropped, not stored');
assert(avesmapsNormalizeEditorActivityArea('') === null, 'empty area clears the field');
assert(avesmapsNormalizeEditorActivityArea(null) === null, 'null clears the field');

// The label is free text (a territory name) but must not become an injection vector for the
// panel list, and must fit the column.
assert(avesmapsNormalizeEditorActivityLabel('  Fürstentum Kosch  ') === 'Fürstentum Kosch', 'label is trimmed');
assert(avesmapsNormalizeEditorActivityLabel('') === null, 'empty label clears the field');
assert(avesmapsNormalizeEditorActivityLabel("a\nb") === 'a b', 'newlines collapse to one line');
assert(mb_strlen((string) avesmapsNormalizeEditorActivityLabel(str_repeat('x', 400))) === 190, 'label is capped at the column width');

// --- the decision --------------------------------------------------------------------------
$row = static fn(int $id, string $name, int $sinceActivity, int $sinceSeen): array => [
    'user_id' => $id,
    'username' => $name,
    'activity_label' => null,
    'seconds_since_activity' => $sinceActivity,
    'seconds_since_seen' => $sinceSeen,
];

assert(avesmapsPickEditorAreaClaim([], 180) === null, 'nobody present -> no claim');

// THE core rule, and the one that inverts if someone writes ASC: seconds_since_activity is a
// DISTANCE, not a timestamp. The bigger it is, the earlier that person arrived -- and the
// earliest arrival owns the write right.
$twoEditors = [$row(7, 'Anna', 20, 5), $row(3, 'Valentin', 600, 10)];
$claim = avesmapsPickEditorAreaClaim($twoEditors, 180);
assert($claim !== null && $claim['user_id'] === 3, 'the one who arrived FIRST owns the claim, not the latest');

// Order of the input must not matter -- otherwise the answer depends on MySQL's row order.
$claimReversed = avesmapsPickEditorAreaClaim(array_reverse($twoEditors), 180);
assert($claimReversed !== null && $claimReversed['user_id'] === 3, 'input order does not change the owner');

// A stale heartbeat drops out entirely: this is what makes the claim self-releasing when a
// browser dies. 181 > 180 -> gone, and the next in line takes over.
$stale = [$row(3, 'Valentin', 600, 181), $row(7, 'Anna', 20, 5)];
$claimAfterStale = avesmapsPickEditorAreaClaim($stale, 180);
assert($claimAfterStale !== null && $claimAfterStale['user_id'] === 7, 'an expired heartbeat releases the claim');
assert(avesmapsPickEditorAreaClaim([$row(3, 'V', 600, 181)], 180) === null, 'everyone expired -> no claim');
assert(avesmapsPickEditorAreaClaim([$row(3, 'V', 600, 180)], 180) !== null, 'exactly at the limit still counts');

// Two editors opening in the same second must still produce ONE answer, identical for both.
$tie = avesmapsPickEditorAreaClaim([$row(9, 'Zoe', 42, 1), $row(4, 'Bea', 42, 1)], 180);
assert($tie !== null && $tie['user_id'] === 4, 'a tie is broken by the lower user_id, deterministically');

// The claim carries what the UI needs to say "Valentin, since 14:20".
$shape = avesmapsPickEditorAreaClaim([$row(3, 'Valentin', 600, 10)], 180);
assert($shape['username'] === 'Valentin', 'the holder name travels');
assert($shape['seconds_since_activity'] === 600, 'the age travels for the "since" line');
assert($shape['seconds_since_seen'] === 10, 'the freshness travels, so the panel can be honest about a stale holder');

echo "editor-activity: ALL PASSED\n";
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/editor-activity-test.php`
Expected: Fatal error — `editor-activity.php` existiert noch nicht.

- [ ] **Step 3: Bibliothek schreiben**

`api/_internal/map/editor-activity.php`:

```php
<?php

declare(strict_types=1);

/**
 * Who is currently working in which editor -- and, for the territory tree, who holds the write
 * right.
 *
 * The claim is DERIVED, never stored. There is no lock table, no acquire and no release: the
 * owner is computed from editor_presence on every request, so a claim cannot leak when a browser
 * dies, and two clients cannot both win a race -- the decision is a total order over the same
 * rows, so it comes out identical for everyone who asks.
 *
 * Design: docs/superpowers/specs/2026-08-04-editor-taetigkeit-und-territorien-sperre-design.md
 */

// The eight editors that exist. A value outside this list becomes null rather than being stored:
// the panel list is user-visible and must not be fillable with free text.
const AVESMAPS_EDITOR_ACTIVITY_AREAS = [
    'territories',
    'paths',
    'ecosystem',
    'settlements',
    'powerlines',
    'citymaps',
    'adventures',
    'wikisync',
];

// Deliberately longer than AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS (90): the green dot may go out
// while the claim survives. The holder may have unsaved work in the editor, and on shared hosting
// one missed request is no proof of absence. The panel stays honest by reporting both ages.
const AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS = 180;

const AVESMAPS_EDITOR_ACTIVITY_LABEL_MAX = 190;

function avesmapsNormalizeEditorActivityArea(?string $area): ?string
{
    $normalized = strtolower(trim((string) $area));

    return in_array($normalized, AVESMAPS_EDITOR_ACTIVITY_AREAS, true) ? $normalized : null;
}

function avesmapsNormalizeEditorActivityLabel(?string $label): ?string
{
    $collapsed = trim((string) preg_replace('/\s+/u', ' ', (string) $label));
    if ($collapsed === '') {
        return null;
    }

    return mb_substr($collapsed, 0, AVESMAPS_EDITOR_ACTIVITY_LABEL_MAX);
}

/**
 * Pure: pick the owner of an area from its candidate rows.
 *
 * Rows come straight from the presence table and carry AGES in seconds, not timestamps -- so no
 * timezone can get between the database and this decision.
 *
 * @param array<int, array<string, mixed>> $rows
 * @return array<string, mixed>|null
 */
function avesmapsPickEditorAreaClaim(array $rows, int $claimSeconds): ?array
{
    $fresh = array_values(array_filter(
        $rows,
        static fn(array $row): bool => (int) ($row['seconds_since_seen'] ?? PHP_INT_MAX) <= $claimSeconds
    ));

    // seconds_since_activity is a DISTANCE: the LARGEST value is the earliest arrival, and the
    // earliest arrival owns the claim. Sorting this ascending silently hands the write right to
    // whoever showed up last. The tie-break on user_id is what makes two simultaneous openings
    // resolve to the same answer on both clients.
    usort($fresh, static function (array $left, array $right): int {
        $byAge = (int) $right['seconds_since_activity'] <=> (int) $left['seconds_since_activity'];

        return $byAge !== 0 ? $byAge : ((int) $left['user_id'] <=> (int) $right['user_id']);
    });

    return $fresh[0] ?? null;
}

/**
 * @return array<string, mixed>|null
 */
function avesmapsReadEditorAreaClaim(PDO $pdo, string $area): ?array
{
    $statement = $pdo->prepare(
        'SELECT user_id, username, activity_label,
                TIMESTAMPDIFF(SECOND, activity_since, NOW(3)) AS seconds_since_activity,
                TIMESTAMPDIFF(SECOND, last_seen,      NOW(3)) AS seconds_since_seen
        FROM editor_presence
        WHERE activity_area = :area'
    );
    $statement->execute(['area' => $area]);

    return avesmapsPickEditorAreaClaim($statement->fetchAll(), AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS);
}

/**
 * The claim held by SOMEONE ELSE, or null when the caller may write.
 *
 * Asymmetric on purpose: when nobody holds the area, everybody may write. A client that fails to
 * report its activity therefore loses its protection -- never its ability to work.
 *
 * @return array<string, mixed>|null
 */
function avesmapsBlockingEditorAreaClaim(PDO $pdo, string $area, array $user): ?array
{
    $claim = avesmapsReadEditorAreaClaim($pdo, $area);
    if ($claim === null || (int) $claim['user_id'] === (int) ($user['id'] ?? 0)) {
        return null;
    }

    return $claim;
}

// Retrofit for the live table: CREATE TABLE IF NOT EXISTS does NOT add columns to a table that
// already exists. Each column is probed on its own -- a half-migrated table (one ALTER applied,
// the next interrupted) would otherwise stay broken forever behind a single all-or-nothing check.
function avesmapsEnsureEditorActivityColumns(PDO $pdo): void
{
    $columns = [
        'activity_area' => 'ALTER TABLE editor_presence ADD COLUMN activity_area VARCHAR(40) NULL',
        'activity_label' => 'ALTER TABLE editor_presence ADD COLUMN activity_label VARCHAR(190) NULL',
        'activity_since' => 'ALTER TABLE editor_presence ADD COLUMN activity_since DATETIME(3) NULL',
    ];

    foreach ($columns as $column => $ddl) {
        $probe = $pdo->prepare('SHOW COLUMNS FROM editor_presence LIKE :column');
        $probe->execute(['column' => $column]);
        if ($probe->fetchColumn() === false) {
            $pdo->exec($ddl);
        }
    }
}
```

- [ ] **Step 4: Test grün + Syntax**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/editor-activity-test.php && php -l api/_internal/map/editor-activity.php`
Expected: `editor-activity: ALL PASSED` und `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "$(printf 'feat(presence): derive the editor area claim instead of storing a lock\n\nWho holds the write right for an area is computed from editor_presence on every\nrequest: freshest heartbeats only, earliest arrival wins, ties broken by user_id\nso two clients always compute the same answer. Nothing to acquire, release or\nleak. The decision is a pure function rather than an ORDER BY -- there is no\nlocal database in this project, so SQL would have shipped untested.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- api/_internal/map/editor-activity.php api/_internal/map/__tests__/editor-activity-test.php
```

---

### Task 2: `presence.php` nimmt Bereich + Label und liefert den Anspruch

**Files:**
- Modify: `api/edit/map/presence.php` (Zeilen 5–7 requires, 26–54 Handler, 83–95 Fehlererkenner, 112–163 Schreiber/Leser)

**Interfaces:**
- Consumes: alles aus Task 1.
- Produces: POST akzeptiert `{area, label}`; Antwort trägt zusätzlich `territory_claim` und je Nutzer `activity_area` / `activity_label` / `seconds_since_activity`.

- [ ] **Step 1: `editor-activity.php` einbinden** — nach Zeile 6 (`require __DIR__ . '/../../_internal/analytics/visitor-analytics.php';`):

```php
require __DIR__ . '/../../_internal/map/editor-activity.php';
```

- [ ] **Step 2: Bereich/Label aus dem Rumpf lesen.** Direkt nach `$pdo = avesmapsCreatePdo($config['database'] ?? []);` (Zeile 27) einfügen:

```php
    // The client already POSTed a body here ({path: …}) that the server threw away. It now
    // carries what the editor is working on. Both values are normalised BEFORE they reach SQL:
    // the area against a fixed whitelist, the label to one trimmed line.
    $activity = $requestMethod === 'POST' ? avesmapsReadJsonRequest() : [];
    $activityArea = avesmapsNormalizeEditorActivityArea($activity['area'] ?? null);
    $activityLabel = $activityArea === null ? null : avesmapsNormalizeEditorActivityLabel($activity['label'] ?? null);
```

- [ ] **Step 3: Heartbeat-Signatur und -Rumpf erweitern.** `avesmapsWriteEditorPresenceHeartbeat` (Zeile 112) so ersetzen:

```php
function avesmapsWriteEditorPresenceHeartbeat(PDO $pdo, array $user, ?string $area, ?string $label): void {
    $statement = $pdo->prepare(
        'INSERT INTO editor_presence (user_id, username, role, last_seen, request_origin, user_agent, activity_area, activity_label, activity_since)
        VALUES (:user_id, :username, :role, NOW(3), :request_origin, :user_agent, :activity_area, :activity_label, NOW(3))
        ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            role = VALUES(role),
            last_seen = VALUES(last_seen),
            request_origin = VALUES(request_origin),
            user_agent = VALUES(user_agent),
            activity_label = VALUES(activity_label),
            activity_since = IF(activity_area <=> VALUES(activity_area), activity_since, VALUES(activity_since)),
            activity_area = VALUES(activity_area)'
    );
    $statement->execute([
        'user_id' => (int) $user['id'],
        'username' => (string) ($user['username'] ?? 'Editor'),
        'role' => (string) ($user['role'] ?? ''),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
        'activity_area' => $area,
        'activity_label' => $label,
    ]);
}
```

💣 Zwei Feinheiten in diesem SQL, beide tragend:
- `activity_since` wird **nur beim Bereichswechsel** neu gesetzt. Zöge jeder Herzschlag es mit, wäre der Besitzer stets der zuletzt Eingetroffene — die Regel „wer zuerst da war" hätte sich lautlos umgedreht.
- `<=>` statt `=`, damit `NULL` gegen `NULL` als gleich zählt. Mit `=` wäre der Vergleich für jeden, der gerade keinen Editor offen hat, `NULL` (also falsch) und `activity_since` liefe bei jedem Herzschlag mit.
- `activity_area = VALUES(activity_area)` steht **hinter** der `activity_since`-Zeile: MySQL wertet die Zuweisungen von links nach rechts aus, und der Vergleich braucht den ALTEN Wert.

- [ ] **Step 4: Spalten-Nachrüstung in den lazy-Zweig hängen.** Der `catch (PDOException $exception)`-Block (Zeilen 38–47) fängt heute nur „Tabelle fehlt". Nach dem Deploy existiert die Tabelle, aber die drei Spalten fehlen → jeder Herzschlag stirbt an „Unknown column", und die Präsenz wäre komplett tot. Den Handler-Block (Zeilen 33–47) so ersetzen:

```php
    try {
        if ($requestMethod === 'POST') {
            avesmapsWriteEditorPresenceHeartbeat($pdo, $user, $activityArea, $activityLabel);
        }
        $onlineEditors = avesmapsListOnlineEditors($pdo);
        $territoryClaim = avesmapsReadEditorAreaClaim($pdo, 'territories');
    } catch (PDOException $exception) {
        // Two recoverable shapes: the table has never been created, or it predates the activity
        // columns (CREATE TABLE IF NOT EXISTS does not retrofit those). Both are repaired once,
        // here, and then retried. Anything else is a real failure and must propagate.
        if (!avesmapsIsMissingTableError($exception) && !avesmapsIsMissingColumnError($exception)) {
            throw $exception;
        }
        avesmapsEnsureEditorPresenceTable($pdo);
        avesmapsEnsureEditorActivityColumns($pdo);
        if ($requestMethod === 'POST') {
            avesmapsWriteEditorPresenceHeartbeat($pdo, $user, $activityArea, $activityLabel);
        }
        $onlineEditors = avesmapsListOnlineEditors($pdo);
        $territoryClaim = avesmapsReadEditorAreaClaim($pdo, 'territories');
    }
```

- [ ] **Step 5: Fehlererkenner für fehlende Spalten ergänzen.** Direkt nach `avesmapsIsMissingTableError` (endet Zeile 95):

```php
// True when the exception means "the column does not exist yet" -- MySQL SQLSTATE 42S22 /
// "unknown column". Separate from the missing-table check because the repair is a different one
// (ALTER TABLE, not CREATE TABLE) and because a live table that predates a retrofit is the
// normal state right after a deploy, not an error worth a 500.
function avesmapsIsMissingColumnError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S22') {
        return true;
    }

    return str_contains(strtolower($exception->getMessage()), 'unknown column');
}
```

- [ ] **Step 6: Tätigkeit in die Nutzerliste aufnehmen.** In `avesmapsListOnlineEditors` (Zeile 132) die SELECT-Liste um drei Ausdrücke erweitern — nach `editor_presence.last_seen,`:

```sql
            editor_presence.activity_area,
            editor_presence.activity_label,
            TIMESTAMPDIFF(SECOND, editor_presence.activity_since, NOW(3)) AS seconds_since_activity,
```

und im `array_map` (Zeile 153) nach `'is_online' => …,` ergänzen:

```php
            'activity_area' => $row['activity_area'] !== null ? (string) $row['activity_area'] : null,
            'activity_label' => $row['activity_label'] !== null ? (string) $row['activity_label'] : null,
            'seconds_since_activity' => $row['seconds_since_activity'] !== null ? (int) $row['seconds_since_activity'] : null,
```

- [ ] **Step 7: Anspruch in die Antwort geben.** Den `avesmapsJsonResponse`-Block (Zeilen 49–54) so ersetzen:

```php
    avesmapsJsonResponse(200, [
        'ok' => true,
        'users' => $onlineEditors,
        'online_seconds' => AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS,
        'claim_seconds' => AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS,
        // Only the ages travel, never activity_since itself: that is MySQL server time, and a
        // client formatting it as "since 14:20" would be off by the timezone difference.
        'territory_claim' => $territoryClaim === null ? null : [
            'user_id' => (int) $territoryClaim['user_id'],
            'username' => (string) $territoryClaim['username'],
            'seconds_since_activity' => (int) $territoryClaim['seconds_since_activity'],
            'seconds_since_seen' => (int) $territoryClaim['seconds_since_seen'],
            'is_mine' => (int) $territoryClaim['user_id'] === (int) $user['id'],
        ],
        'visitors' => avesmapsReadVisitorPresence($pdo),
    ]);
```

- [ ] **Step 8: Syntax prüfen**

Run: `php -l api/edit/map/presence.php`
Expected: `No syntax errors detected`

- [ ] **Step 9: Commit**

```bash
git commit --only -m "$(printf 'feat(presence): heartbeat carries the editor area and reports the territory claim\n\nThe POST body already existed but was discarded; it now carries which editor is\nopen and on what. activity_since is only reset on an area CHANGE -- carrying it\nalong on every heartbeat would invert the "earliest arrival wins" rule. The lazy\nensure path now also repairs a table that predates the activity columns, which\nis the normal state in the first seconds after this deploy.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- api/edit/map/presence.php
```

---

### Task 3: Das Schreibtor für Territorien

**Files:**
- Modify: `api/_internal/political/territories-endpoint.php` (require-Block Z. 5–20; Schreibpfad Z. 178)

**Interfaces:**
- Consumes: `avesmapsBlockingEditorAreaClaim` aus Task 1.
- Produces: HTTP 409 `territory_locked` für jeden Schreibversuch, während ein anderer den Bereich hält.

- [ ] **Step 1: Bibliothek einbinden** — nach `require_once __DIR__ . '/../auth.php';` (Zeile 6):

```php
require_once __DIR__ . '/../map/editor-activity.php';
```

- [ ] **Step 2: Das Tor setzen.** Direkt nach `$user = avesmapsRequireUserWithCapability('edit');` (Zeile 178) und **vor** `$payload = avesmapsReadJsonRequest();`:

```php
    // One gate for all 30 write actions below. It sits BEFORE the match on purpose: a new action
    // added to that list cannot forget the check, because there is nothing to remember. The
    // territory tree is one connected thing -- a save propagates onto parents and siblings -- so
    // per-object locking (map_feature_locks) does not protect it.
    // Asymmetric by design: only a claim held by SOMEONE ELSE blocks. When nobody holds the area,
    // everybody may write, so a client that fails to report its activity loses its protection but
    // never its ability to work.
    $territoryBlocker = avesmapsBlockingEditorAreaClaim($pdo, 'territories', $user);
    if ($territoryBlocker !== null) {
        avesmapsErrorResponse(409, 'territory_locked', sprintf(
            '%s bearbeitet gerade die Herrschaftsgebiete. Deine Aenderung wurde nicht gespeichert.',
            (string) $territoryBlocker['username']
        ));
    }
```

⚠️ `geometry_operation_debug` rechnet nur (kein `$pdo`, kein `$user`) und wird von diesem Tor mit erfasst. Das ist hingenommen: es ist ein Entwicklerwerkzeug, kein Lesepfad des Zweiten. **Alle GET-Aktionen liegen oberhalb von Zeile 174** und bleiben unberührt — der Zweite sieht also weiterhin den ganzen Baum, alle Geometrien und den Audit.

- [ ] **Step 3: Syntax prüfen**

Run: `php -l api/_internal/political/territories-endpoint.php`
Expected: `No syntax errors detected`

- [ ] **Step 4: Beweisen, dass das Tor VOR dem Rumpf steht (statisch).** Ein Tor hinter `avesmapsReadJsonRequest()` würde bei leerem Rumpf schon vorher mit 400 sterben und wäre als „durchgelassen" fehlinterpretierbar.

Run: `grep -n "avesmapsRequireUserWithCapability('edit')\|avesmapsBlockingEditorAreaClaim\|avesmapsReadJsonRequest" api/_internal/political/territories-endpoint.php`
Expected: die Zeilennummern stehen in genau dieser Reihenfolge: `RequireUser` < `BlockingEditorAreaClaim` < `ReadJsonRequest`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "$(printf 'feat(territories): one gate makes the territory tree single-writer\n\nAll 30 write actions dispatch through a single match; the claim check sits in\nfront of it, so no future action can forget it. Reads are untouched -- the second\neditor keeps the full tree, geometries and audit, and only loses saving. Returns\n409 territory_locked naming the holder. The UI lock is courtesy; this is the lock.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- api/_internal/political/territories-endpoint.php
```

---

### Task 4: Client — melden, anzeigen, entscheiden

**Files:**
- Modify: `js/app/runtime-state.js:227` (bei `editorPresenceUsers`)
- Modify: `js/review/review-panels.js:525-565` (Heartbeat), `:600-632` (Liste)
- Test: `js/review/__tests__/editor-activity-view.test.js`

**Interfaces:**
- Consumes: `EDITOR_PRESENCE_API_URL` (`js/config.js:455`), `IS_EDIT_MODE`.
- Produces:
  - `avesmapsSetEditorActivity(area, label)` — global, von allen Editoren aufgerufen
  - `avesmapsFormatEditorActivity(user)` — rein, liefert den Anhang für die Meta-Zeile oder `""`
  - `avesmapsTerritoryWriteState(claim)` — rein, liefert `{canWrite, holderName, sinceSeconds}`
  - `editorTerritoryClaim` (Zustand) und `avesmapsOnTerritoryClaimChange(fn)`

- [ ] **Step 1: Failing test für die beiden reinen Funktionen** — aus der ECHTEN Quelldatei extrahiert, nicht nachgebaut.

`js/review/__tests__/editor-activity-view.test.js`:

```js
"use strict";

// Extracts the two pure view functions from the real source file and checks their contract.
// Nothing is re-implemented here: a rebuilt copy would pass while the shipped file is broken.
// Run from the repo root:  node js/review/__tests__/editor-activity-view.test.js

const fs = require("fs");
const src = fs.readFileSync("js/review/review-panels.js", "utf8");

function extract(name) {
	const match = src.match(new RegExp("function " + name + "\\b[\\s\\S]*?\\n\\}"));
	if (!match) {
		console.error("FAIL: " + name + " not found in js/review/review-panels.js");
		process.exit(1);
	}
	return match[0];
}

// controlled: the input is our own repo file, and this is a throwaway harness
eval(extract("avesmapsFormatEditorActivity"));
eval(extract("avesmapsTerritoryWriteState"));

let failed = 0;
const check = (label, ok) => {
	console.log((ok ? "  PASS  " : "  FAIL  ") + label);
	if (!ok) failed++;
};

// --- the meta-line suffix -----------------------------------------------------------------
check("no area -> nothing appended, the line stays exactly as before",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: null }) === "");
check("offline users report nothing, however stale the area column is",
	avesmapsFormatEditorActivity({ is_online: false, activity_area: "territories", activity_label: "Kosch" }) === "");
check("area alone renders the German editor name",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: "paths" }) === "Wege");
check("area plus label renders both",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: "territories", activity_label: "Fürstentum Kosch" }) === "Territorien: Fürstentum Kosch");
check("an unknown area falls back to nothing rather than printing a raw key",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: "kitchen" }) === "");

// --- the territory write state ------------------------------------------------------------
check("nobody holds the tree -> I may write",
	avesmapsTerritoryWriteState(null).canWrite === true);
check("I hold it myself -> I may write",
	avesmapsTerritoryWriteState({ is_mine: true, username: "Valentin", seconds_since_activity: 60 }).canWrite === true);

const blocked = avesmapsTerritoryWriteState({ is_mine: false, username: "Valentin", seconds_since_activity: 900 });
check("someone else holds it -> read only", blocked.canWrite === false);
check("the holder's name travels, so the banner can name them", blocked.holderName === "Valentin");
check("the age travels, so the banner can say since when", blocked.sinceSeconds === 900);

// A malformed answer must not silently lock the editor for everyone: unknown -> allow, and let
// the server's 409 be the authority. The opposite default would turn one bad response into an
// outage that looks exactly like the feature working.
check("undefined claim -> may write", avesmapsTerritoryWriteState(undefined).canWrite === true);
check("garbage claim -> may write", avesmapsTerritoryWriteState({}).canWrite === true);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `node js/review/__tests__/editor-activity-view.test.js`
Expected: `FAIL: avesmapsFormatEditorActivity not found in js/review/review-panels.js`

- [ ] **Step 3: Zustandsvariablen ergänzen** — in `js/app/runtime-state.js` nach `editorPresenceUsers = [],` (Zeile 227):

```js
	editorPresenceUsers = [],
	editorActivityArea = null,
	editorActivityLabel = null,
	editorTerritoryClaim = null,
	editorTerritoryClaimListeners = [],
```

- [ ] **Step 4: Die beiden reinen Funktionen + die Meldefunktion schreiben.** In `js/review/review-panels.js` direkt vor `async function sendEditorPresenceHeartbeat()` (Zeile 525):

```js
// The German editor names, keyed by the area codes the server whitelists. Kept here rather than
// server-side: these are UI strings and belong to the i18n layer, not to the API (AGENTS.md §8).
const AVESMAPS_EDITOR_AREA_LABELS = {
	territories: "Territorien",
	paths: "Wege",
	ecosystem: "Landschaften",
	settlements: "Siedlungen",
	powerlines: "Kraftlinien",
	citymaps: "Kartensammlung",
	adventures: "Abenteuer",
	wikisync: "Datenabgleich",
};

// Pure: what to append to a user's meta line in the Status tab. Empty string means "append
// nothing" -- an offline user's area column is stale by definition, and an unknown key would
// otherwise leak a raw code into the UI.
function avesmapsFormatEditorActivity(user) {
	if (!user || !user.is_online) {
		return "";
	}
	const areaLabel = AVESMAPS_EDITOR_AREA_LABELS[user.activity_area];
	if (!areaLabel) {
		return "";
	}
	return user.activity_label ? `${areaLabel}: ${user.activity_label}` : areaLabel;
}

// Pure: may I write to the territory tree, and if not, who is holding it?
// Unknown/garbage input resolves to "may write" on purpose. The server's 409 is the authority;
// defaulting to "locked" here would turn a single malformed response into an outage that looks
// exactly like the feature working correctly.
function avesmapsTerritoryWriteState(claim) {
	if (!claim || typeof claim !== "object" || claim.is_mine !== false) {
		return { canWrite: true, holderName: null, sinceSeconds: null };
	}
	return {
		canWrite: false,
		holderName: claim.username || "Ein anderer Editor",
		sinceSeconds: Number.isFinite(Number(claim.seconds_since_activity)) ? Number(claim.seconds_since_activity) : null,
	};
}

// Every editor calls this when it opens (area + optional label) and closes (null, null). The
// heartbeat goes out IMMEDIATELY rather than waiting for the next 30s tick: whoever opens the
// territory editor must learn within the same interaction whether they may write.
function avesmapsSetEditorActivity(area, label) {
	editorActivityArea = area || null;
	editorActivityLabel = editorActivityArea ? (label || null) : null;
	void sendEditorPresenceHeartbeat();
}

function avesmapsOnTerritoryClaimChange(listener) {
	if (typeof listener === "function") {
		editorTerritoryClaimListeners.push(listener);
	}
}

// The iframe editors know WHICH object is open; the host owns the heartbeat. They post it up.
// The host never adopts an AREA from a message -- only a label, and only while it already has an
// area of its own. A message is untrusted input, so it may refine what we report, never define it.
window.addEventListener("message", (event) => {
	if (event.origin !== window.location.origin || !event.data || event.data.type !== "avesmaps:editor-activity") {
		return;
	}
	if (!editorActivityArea) {
		return;
	}
	avesmapsSetEditorActivity(editorActivityArea, event.data.label);
});
```

- [ ] **Step 5: Heartbeat um Rumpf und Anspruch erweitern.** In `sendEditorPresenceHeartbeat` den `body` (Zeile 538) ersetzen:

```js
			body: JSON.stringify({ area: editorActivityArea, label: editorActivityLabel }),
```

und nach `editorPresenceUsers = Array.isArray(data.users) ? data.users : [];` (Zeile 545) einfügen:

```js
		// Notify the territory editor only when the answer actually changed, so a 30s poll does
		// not re-run the banner/save-button plumbing every tick.
		const nextClaim = data.territory_claim || null;
		const claimChanged = JSON.stringify(nextClaim) !== JSON.stringify(editorTerritoryClaim);
		editorTerritoryClaim = nextClaim;
		if (claimChanged) {
			editorTerritoryClaimListeners.forEach((listener) => {
				try {
					listener(editorTerritoryClaim);
				} catch (error) {
					console.warn("Territorien-Anspruch konnte nicht verarbeitet werden:", error);
				}
			});
		}
```

- [ ] **Step 6: Tätigkeit in die Liste rendern.** In `renderPresenceUserGroup` die Meta-Zeile (Zeile 628) ersetzen:

```js
		itemElement.querySelector(".presence-user__meta").textContent = [roleLabel, stateLabel, presenceAge, avesmapsFormatEditorActivity(user)].filter(Boolean).join(" · ");
```

- [ ] **Step 7: Tests + Syntax**

Run: `node js/review/__tests__/editor-activity-view.test.js && node --check js/review/review-panels.js && node --check js/app/runtime-state.js`
Expected: `ALL PASSED` und keine Syntaxfehler.

- [ ] **Step 8: Commit**

```bash
git commit --only -m "$(printf 'feat(presence): report and display what each editor is working on\n\nThe Status tab now appends "Territorien: Fuerstentum Kosch" to each online\neditor. Editors announce their area through the existing 30s heartbeat -- no\nsecond poll, which is what was removed from this path in July. iframe editors\npost their label up to the host; the host never adopts an AREA from a message,\nonly refines the one it already holds. An unparsable claim resolves to "may\nwrite" so one bad response cannot look like a working lock.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- js/review/review-panels.js js/app/runtime-state.js js/review/__tests__/editor-activity-view.test.js
```

---

### Task 5: Die acht Editoren melden ihren Bereich

**Files:**
- Modify: `js/review/review-ecosystem-list.js:17` (`ecosystem`)
- Modify: `js/review/review-path-editor-list.js:19` (`paths`)
- Modify: `js/review/review-powerline-list.js:11` (`powerlines`)
- Modify: `js/review/review-settlement-list.js:785` (`settlements`), `:835` (`adventures`), `:905` (`citymaps`)
- Modify: `js/review/review-wiki-sync.js:3356` (`wikisync`)
- Modify: `js/territory/territory-editor-link.js:167` + `:76` (`territories`)

**Interfaces:**
- Consumes: `avesmapsSetEditorActivity(area, label)` aus Task 4.

- [ ] **Step 1: Muster für die sechs Overlay-Editoren.** Jeder Öffner hat einen `closeOverlay`-Helfer und einen frühen `return` für ein bereits vorhandenes Overlay. Beide Wege müssen melden. Beispiel `review-ecosystem-list.js` (Zeilen 27–32 und 50):

```js
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		avesmapsSetEditorActivity("ecosystem", null);
		return;
	}
```

und der Schließer:

```js
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; avesmapsSetEditorActivity(null, null); };
```

sowie **nach** `document.body.appendChild(overlay);` (Zeile 62):

```js
	avesmapsSetEditorActivity("ecosystem", null);
```

⚠️ Die Meldung gehört in die **Overlay-Hülle im Hauptdokument**, nicht in die iframe-Seite: dort läuft das Lebenszeichen. Die iframe-Seiten brauchen für diesen Task keine Änderung.

- [ ] **Step 2: Dasselbe Muster in den anderen fünf Overlay-Öffnern anwenden** — identisch, nur mit dem jeweiligen Bereichscode: `paths` (`review-path-editor-list.js`), `powerlines` (`review-powerline-list.js`), `settlements` / `adventures` / `citymaps` (`review-settlement-list.js`), `wikisync` (`review-wiki-sync.js`). In jeder Datei die drei Stellen bedienen: Früh-Return bei vorhandenem Overlay, `closeOverlay`, Ersterstellung.

- [ ] **Step 3: Territorien melden.** In `js/territory/territory-editor-link.js` in `openPoliticalTerritoryEditor` nach `setPoliticalTerritoryEditorOpen(true);` (Zeile 186):

```js
	// The embedded territory editor lives in the SAME document as the heartbeat (the inline host
	// pulls only .app-container across via DOMParser), so this is a direct call -- no frame bridge.
	avesmapsSetEditorActivity("territories", regionEntry?.name || null);
```

und in `closePoliticalTerritoryEditor` nach `setPoliticalTerritoryEditorOpen(false);` (Zeile 78):

```js
	avesmapsSetEditorActivity(null, null);
```

- [ ] **Step 4: Aufrufe absichern.** `avesmapsSetEditorActivity` existiert nur im Edit-Modus-Bundle. Alle acht Aufrufstellen daher über einen Wächter führen — in jeder der acht Dateien einmal oben ergänzen:

```js
// Guard: the presence heartbeat only exists in edit mode. A plain call would throw in the public
// app, and 💣 `typeof` is not enough here -- a half-loaded const file throws in the temporal dead
// zone. try/catch is the form that survives it.
function avesmapsReportEditorArea(area, label) {
	try {
		avesmapsSetEditorActivity(area, label);
	} catch (error) {
		/* not in edit mode -- nothing to report */
	}
}
```

und die Aufrufe aus Step 1–3 auf `avesmapsReportEditorArea(...)` umstellen.

⚠️ Diese Hilfsfunktion darf **nur einmal global** existieren, sonst kollidieren die Deklarationen im gemeinsamen Scope (alle diese Dateien laden top-level in dasselbe Dokument). Sie gehört deshalb nach `js/review/review-panels.js` (neben `avesmapsSetEditorActivity`), und die acht Dateien rufen sie nur auf.

- [ ] **Step 5: Syntax aller berührten Dateien prüfen**

Run: `node --check js/review/review-ecosystem-list.js && node --check js/review/review-path-editor-list.js && node --check js/review/review-powerline-list.js && node --check js/review/review-settlement-list.js && node --check js/review/review-wiki-sync.js && node --check js/territory/territory-editor-link.js && node --check js/review/review-panels.js`
Expected: keine Ausgabe (alle sauber).

- [ ] **Step 6: Commit**

```bash
git commit --only -m "$(printf 'feat(editors): every editor announces which area it has open\n\nThe announcement sits in the overlay shell in the host document, where the\nheartbeat lives, so the six iframe editors need no changes of their own. The\nembedded territory editor shares the host document too (the inline host pulls\nonly .app-container across), so it calls directly. Calls go through one guarded\nhelper -- typeof would not survive a half-loaded const file.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- js/review/review-ecosystem-list.js js/review/review-path-editor-list.js js/review/review-powerline-list.js js/review/review-settlement-list.js js/review/review-wiki-sync.js js/territory/territory-editor-link.js js/review/review-panels.js
```

---

### Task 6: Hinweis-Band und Speichersperre im Territorien-Editor

**Files:**
- Modify: `html/political-territory-editor.html` (Beginn von `.app-container`, vor Zeile 30)
- Modify: `css/pages/political-territory-editor.css` (am Dateiende, im Designsprache-Block)
- Modify: `js/territory/territory-editor-link.js` (Anwendung des Zustands)
- Modify: `js/territory/territory-editor-inline-host.js:23` (`ASSET_VERSION`)

**Interfaces:**
- Consumes: `avesmapsTerritoryWriteState`, `avesmapsOnTerritoryClaimChange` (Task 4); `#saveButton` (Zeile 141 der HTML).

- [ ] **Step 1: Das Band ins Markup.** Als erstes Kind von `.app-container`, vor dem Layout:

```html
<div id="territoryClaimBanner" class="territory-claim-banner" hidden role="status"><span class="territory-claim-banner__icon" aria-hidden="true">🔒</span><span class="territory-claim-banner__text"></span></div>
```

⭐ Eine Stelle, zwei Oberflächen: der Inline-Host übernimmt genau `.app-container`, also erscheint das Band im eingebetteten Editor **und** im Standalone.

- [ ] **Step 2: Der Stil, ausschliesslich aus Tokens** (AGENTS.md §12 — kein Literal, kein Blau). Ans Ende von `css/pages/political-territory-editor.css`:

```css
/* The "someone else is editing" banner. Warning tone from the shared status tokens; no literal
   colours here -- a hardcoded hex is how the panels drifted apart in the first place. */
.territory-claim-banner {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	padding: var(--space-2) var(--space-3);
	border-bottom: 1px solid var(--color-divider);
	background: var(--color-status-warning-bg);
	color: var(--color-status-warning-text);
	font-size: var(--font-size-sm);
}

.territory-claim-banner[hidden] {
	display: none;
}
```

⚠️ Vor dem Schreiben die drei Tokennamen in `css/base/tokens.css` gegenprüfen und ggf. auf die dort tatsächlich vorhandenen Statuston-Tokens umstellen — **ein `var()`, das ins Leere läuft, macht die ganze Deklaration ungültig** (dieselbe Falle, die den Standalone-Editor 2026-07-22 farblos machte).

- [ ] **Step 3: Den Zustand anwenden.** In `js/territory/territory-editor-link.js` ans Dateiende:

```js
// Reflect the derived write claim in the embedded/standalone territory editor. The disabled save
// button is COURTESY -- the real lock is the 409 from territories-endpoint.php. This only spares
// the second editor from typing into work that will be rejected.
function applyPoliticalTerritoryClaim(claim) {
	const state = avesmapsTerritoryWriteState(claim);
	const banner = document.getElementById("territoryClaimBanner");
	const saveButton = document.getElementById("saveButton");

	if (banner) {
		banner.hidden = state.canWrite;
		if (!state.canWrite) {
			const since = formatTerritoryClaimSince(state.sinceSeconds);
			banner.querySelector(".territory-claim-banner__text").textContent =
				`${state.holderName} bearbeitet gerade die Territorien${since}. Du kannst alles ansehen, aber nicht speichern.`;
		}
	}

	if (saveButton) {
		saveButton.disabled = !state.canWrite;
		saveButton.title = state.canWrite ? "" : `${state.holderName} bearbeitet gerade die Territorien.`;
	}
}

// "seit 14:20" from an AGE, never from a server timestamp: activity_since is MySQL server time,
// and formatting that against a local clock is off by the timezone difference.
function formatTerritoryClaimSince(sinceSeconds) {
	if (!Number.isFinite(sinceSeconds)) {
		return "";
	}
	const startedAt = new Date(Date.now() - sinceSeconds * 1000);
	return ` (seit ${startedAt.getHours()}:${String(startedAt.getMinutes()).padStart(2, "0")} Uhr)`;
}

if (typeof avesmapsOnTerritoryClaimChange === "function") {
	avesmapsOnTerritoryClaimChange(applyPoliticalTerritoryClaim);
}
```

- [ ] **Step 4: Freiwerden hörbar machen.** In `applyPoliticalTerritoryClaim`, ganz am Anfang, den Übergang „gesperrt → frei" melden:

```js
	const wasBlocked = Boolean(document.getElementById("territoryClaimBanner") && !document.getElementById("territoryClaimBanner").hidden);
	if (wasBlocked && avesmapsTerritoryWriteState(claim).canWrite && typeof showFeedbackToast === "function") {
		showFeedbackToast("Die Territorien sind jetzt frei — du kannst speichern.", "success");
	}
```

- [ ] **Step 5: `ASSET_VERSION` bumpen.** In `js/territory/territory-editor-inline-host.js` Zeile 23: `"20260804a"` → `"20260804b"`.

⚠️ Ohne diesen Bump serviert der Browser das alte `.app-container`-Markup — das Band existierte dann für niemanden, der den Editor schon einmal geöffnet hat (AGENTS.md §7).

- [ ] **Step 6: Syntax prüfen**

Run: `node --check js/territory/territory-editor-link.js && node --check js/territory/territory-editor-inline-host.js`
Expected: keine Ausgabe.

- [ ] **Step 7: Commit**

```bash
git commit --only -m "$(printf 'feat(territories): read-only banner and disabled save while another editor holds the tree\n\nThe banner is one element at the top of .app-container, which the inline host\ncopies wholesale -- so it appears in the embedded editor and the standalone page\nfrom a single change. It names the holder and says since when, because "busy"\nwithout a time is a dead end. The "since" is computed from an AGE, never from a\nserver timestamp. Save re-arms by itself on the next heartbeat.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- html/political-territory-editor.html css/pages/political-territory-editor.css js/territory/territory-editor-link.js js/territory/territory-editor-inline-host.js
```

---

### Task 7: Der Standalone-Editor meldet sich an

**Files:**
- Modify: `html/political-territory-editor.html` (Skriptblock am Dateiende)

**Interfaces:**
- Consumes: `POST /api/edit/map/presence.php` mit `{area:"territories"}`.

- [ ] **Step 1: Warum das nötig ist, in den Code schreiben und den Herzschlag ergänzen.** Am Ende von `html/political-territory-editor.html`, vor `</body>`:

```html
<script>
// The standalone page has no host document and therefore no heartbeat of its own. Without this it
// would report no area, never own the claim -- and Task 3's gate would refuse every save from
// here. It also means two people on this page would not see each other.
// Deliberately a bare 30s fetch, not the full panel machinery: this page loads none of it.
(function initStandaloneTerritoryPresence() {
	if (window.top !== window.self) {
		return; // embedded in the map shell -- that document already sends the heartbeat
	}
	const beat = () => {
		fetch("/api/edit/map/presence.php", {
			method: "POST",
			credentials: "same-origin",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({ area: "territories", label: null }),
		})
			.then((response) => response.json())
			.then((data) => {
				if (data && data.ok === true && typeof applyPoliticalTerritoryClaim === "function") {
					applyPoliticalTerritoryClaim(data.territory_claim || null);
				}
			})
			.catch(() => { /* offline or logged out -- the server-side gate stays the authority */ });
	};
	beat();
	window.setInterval(beat, 30000);
})();
</script>
```

⚠️ `window.top !== window.self` ist der Wächter gegen einen doppelten Herzschlag: dieselbe Datei wird auch vom Inline-Host geladen. Der Host zieht allerdings nur `.app-container` heraus und verwirft den Rest des Dokuments — dieses Skript läuft dort also ohnehin nicht. Der Wächter kostet nichts und deckt den Fall ab, dass die Seite je in einem echten iframe landet.

- [ ] **Step 2: Prüfen, dass die Seite den Zustandsanwender überhaupt kennt.** `applyPoliticalTerritoryClaim` liegt in `js/territory/territory-editor-link.js` — das lädt der Standalone **nicht**.

Run: `grep -n "territory-editor-link.js\|<script src" html/political-territory-editor.html`
Expected: eine Liste der eingebundenen Skripte. Fehlt `territory-editor-link.js`, dann in Step 1 statt des Aufrufs eine seitenlokale Minimalfassung verwenden, die Band und `#saveButton` direkt setzt (dieselben zwei DOM-Zugriffe wie in Task 6 Step 3, ohne die Toast-Meldung).

- [ ] **Step 3: HTML-Syntax prüfen.** 💣 Ein Syntaxfehler in einem Inline-`<script>` reißt die ganze Seite mit, ohne dass irgendetwas rot wird.

Run: `node --check <(sed -n '/initStandaloneTerritoryPresence/,/^<\/script>/p' html/political-territory-editor.html | sed 's|</script>||')`
Expected: keine Ausgabe. Alternativ den Block in eine `.js`-Datei im Scratchpad kopieren und dort `node --check` laufen lassen.

- [ ] **Step 4: Commit**

```bash
git commit --only -m "$(printf 'feat(territories): the standalone editor page joins the presence heartbeat\n\nWithout it the page would report no area, never hold the claim, and the gate\nwould refuse every save made from here -- and two people on this page would be\ninvisible to each other. A bare 30s fetch rather than the panel machinery, none\nof which this page loads.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')" -- html/political-territory-editor.html
```

---

### Task 8: Deploy und Live-Verifikation

**Files:** keine.

- [ ] **Step 1: Push + Remote-SHA verifizieren**

```bash
git push origin master
```
Danach `git rev-parse HEAD` gegen `git ls-remote origin master` prüfen. Bei Reject: `git fetch origin` + `git rebase --autostash origin/master` + erneut pushen — **nie** force.

- [ ] **Step 2: Deploy abwarten und bestätigen**

Run: `gh run list --limit 1 --json status,conclusion,headSha --jq '.[0]'`
Expected: `status:"completed"`, `conclusion:"success"`, `headSha` = lokaler HEAD.
⚠️ PHP-Änderungen wirken auf STRATO durch OPcache erst 2–4 Minuten nach dem Deploy.

- [ ] **Step 3: Präsenz-Endpunkt lebt (EIN Request, angemeldet, kein Loop)**

Im angemeldeten Browser, Konsole:
```js
await (await fetch("/api/edit/map/presence.php", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({area:"territories"})})).json()
```
Expected: `ok:true`, `territory_claim` gesetzt mit `is_mine:true`, `users[]` trägt `activity_area:"territories"`.

- [ ] **Step 4: Die Spalten sind wirklich angelegt.** Zeigt Step 3 `territory_claim: null` trotz gesendetem Bereich, ist die Nachrüstung nicht gelaufen — dann `SHOW COLUMNS FROM editor_presence` über phpMyAdmin prüfen und den Fehler im PHP-Log suchen, **nicht** den Endpunkt in einer Schleife anstoßen.

- [ ] **Step 5: Zwei-Nutzer-Probe (der eigentliche Beweis).** Zwei Browserprofile mit zwei verschiedenen Editor-Konten:
  1. Profil A öffnet die Territorien → speichern muss normal gehen.
  2. Profil B öffnet die Territorien → Band erscheint mit A's Namen und Uhrzeit, `#saveButton` ist ausgegraut, der Baum bleibt vollständig bedienbar.
  3. In Profil B ein Schreiben erzwingen (Konsole):
     ```js
     await (await fetch("/api/app/political-territories.php", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"save_hierarchy", nodes:[]})})).json()
     ```
     Expected: HTTP **409**, `error.code === "territory_locked"`, Meldung nennt A.
  4. Profil A schließt den Editor → in B wird der Knopf binnen 30 s scharf, Meldung „Die Territorien sind jetzt frei."

- [ ] **Step 6: Keine Regression im Statusreiter.** Reiter „Status" öffnen: Online/Offline-Gruppen wie zuvor, Besucherzeile unverändert, hinter den Online-Namen die Tätigkeit.

- [ ] **Step 7: Ergebnis in `pending-fixes.md` eintragen** (Nutzersicht, Deutsch, mit Commit-SHAs), damit die Daily-Fixes-Routine es meldet.

---

## Self-Review

**Spec-Abdeckung:**
- §3 abgeleitete Sperre → Task 1 (`avesmapsPickEditorAreaClaim`, kein Speicher).
- §4 Datenmodell, `activity_since` nur bei Wechsel, zwei Fristen → Task 1 (Konstanten, `avesmapsEnsureEditorActivityColumns`), Task 2 Step 3 (`IF(... <=> ...)`).
- §5.1 Bibliothek → Task 1. §5.2 Schreibtor + 409 → Task 3. §5.3 presence-Antwort, Sekunden statt Zeitstempel → Task 2 Steps 6–7.
- §6.1/6.2 Meldefunktion und Aufrufer, postMessage, kein zweiter Poll → Task 4 Step 4, Task 5.
- §6.3 Anzeige im Statusreiter → Task 4 Steps 4/6. §6.4 Band, Speichersperre, Tokens, ASSET_VERSION → Task 6.
- §7 Standalone → Task 7. §9 Prüfungen → Task 1 Step 1, Task 4 Step 1, Task 8 Step 5.
- §8 „bewusst weggelassen" enthält nichts zu Bauendes — korrekt ohne Task.

**Platzhalter:** keine. Jeder Code-Schritt trägt echten Code; Task 7 Step 2 ist eine echte Verzweigung mit benannter Alternative, keine offene Stelle.

**Typkonsistenz:** `avesmapsPickEditorAreaClaim(array, int)` identisch in Definition (T1 S3) und Test (T1 S1). `avesmapsBlockingEditorAreaClaim(PDO, string, array)` identisch in T1 S3 und T3 S2. `avesmapsWriteEditorPresenceHeartbeat(PDO, array, ?string, ?string)` identisch in Definition und beiden Aufrufen (T2 S3/S4). `avesmapsTerritoryWriteState(claim) → {canWrite, holderName, sinceSeconds}` identisch in T4 S1/S4 und T6 S3. `avesmapsFormatEditorActivity(user)` identisch in T4 S1/S4/S6. `territory_claim`-Feldnamen identisch in T2 S7, T4 S1 und T6 S3.

**Bekannte Weichheit:** Task 6 Step 2 nennt drei Statuston-Tokens, deren exakte Namen beim Bauen gegen `css/base/tokens.css` zu prüfen sind — bewusst als Prüfschritt formuliert statt geraten, weil ein ins Leere laufendes `var()` die ganze Deklaration ungültig macht.
