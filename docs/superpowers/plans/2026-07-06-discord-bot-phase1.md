# Avesmaps Discord Bot — Phase 1 Implementation Plan (feedback loop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thin PHP HTTP-interactions Discord bot on STRATO that answers FAQs (`/hilfe`), takes bug/idea/question reports (`/bug` `/idee` `/frage`) into channels **and** a MySQL case store, closes cases (`/erledigt`), and exposes two app-token-gated endpoints so a scheduled Claude routine can read open cases and post a daily triaged report.

**Architecture:** One public endpoint verifies the Ed25519 signature and delegates to pure, unit-tested functions (router + builders). A modal submit inserts a `discord_cases` row, then posts an embed to the matching channel. Two token-gated endpoints (`cases-export`, `report-post`) let Part B (a scheduled Claude routine) read cases and post reports while the bot token stays only on STRATO.

**Tech Stack:** PHP 8 (strict types, procedural `avesmaps*` functions), `ext-sodium` (Ed25519), `ext-curl` (REST), PDO/MySQL (case store; SQLite in tests). No build step, no libraries.

Spec: `docs/superpowers/specs/2026-07-06-discord-bot-phase1-design.md`.

## Global Constraints

- **PHP style:** `declare(strict_types=1);`, procedural `avesmaps*` / `avesmapsDiscord*` functions. Follow `api/app/map-search.php`.
- **Language:** user-facing strings **German**; code/comments/commits **English**.
- **No new dependencies.** `sodium`, `curl`, `pdo_sqlite` (tests) are stock extensions, loaded locally via CLI flags.
- **Secrets:** bot token, `app_token`, channel ids, guild id → **only** `api/config.local.php` (gitignored, deploy-excluded). App ID `1523674862038683689` and Public Key `7281e27c…1026c3` are not secret.
- **Shared working tree:** stage only the exact paths in each commit step. Never `git add -A`.
- **Test runner (local):** `php -d extension=sodium -d extension=curl -d extension=pdo_sqlite <file>`. Tests under `tests/` (not deployed). Code under `api/` (deploy ships `api/` wholesale).
- **Discord API base:** `https://discord.com/api/v10`.
- **Case store DB is injected as a `PDO`** (production: MySQL via `avesmapsCreatePdo`; tests: `new PDO('sqlite::memory:')`). No time/`date()` inside pure functions — timestamps are passed in.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

| Path | Responsibility |
|---|---|
| `api/discord/interactions.php` | Public endpoint. Reads body + signature, wires PDO/store/poster deps, delegates to `avesmapsDiscordProcessRequest`, emits JSON. |
| `api/discord/cases-export.php` | GET, `app_token`-gated. Returns open cases as JSON. |
| `api/discord/report-post.php` | POST, `app_token`-gated. Posts a report to the report channel via the bot token. |
| `api/discord/register-commands.php` | CLI-only. Registers the 5 slash commands. |
| `api/discord/faq.de.json` | The 7 FAQ Q&A. |
| `api/_internal/discord/signature.php` | Ed25519 verification. |
| `api/_internal/discord/faq.php` | FAQ loader + lookup. |
| `api/_internal/discord/store.php` | `discord_cases` DDL + insert / open-list / close. |
| `api/_internal/discord/responses.php` | All builders + constants + `avesmapsDiscordKindMeta`. |
| `api/_internal/discord/router.php` | `avesmapsDiscordRouteInteraction` (respond / submit_case / close_case). |
| `api/_internal/discord/post-message.php` | REST channel POST. |
| `api/_internal/discord/app-auth.php` | `app_token` constant-time check. |
| `api/_internal/discord/endpoint.php` | `avesmapsDiscordProcessRequest` (signature gate + dispatch, injectable deps). |
| `config/api.config.example.php` | `discord` block (all keys). |
| `tests/discord/_assert.php`, `tests/discord/test_*.php` | Test harness + per-module tests. |

---

## Phase 1a — intake bot + case store + app endpoints

### Task 1: Test harness + config block

**Files:**
- Create: `tests/discord/_assert.php`
- Modify: `config/api.config.example.php`

**Interfaces:** Produces `t_ok(bool,string)`, `t_eq(mixed,mixed,string)`, `t_done()`.

- [ ] **Step 1: Create the assertion helper**

Create `tests/discord/_assert.php`:

```php
<?php

declare(strict_types=1);

$GLOBALS['t_failed'] = false;

function t_ok(bool $condition, string $message): void {
    if ($condition) {
        fwrite(STDOUT, "PASS: {$message}\n");
        return;
    }
    fwrite(STDERR, "FAIL: {$message}\n");
    $GLOBALS['t_failed'] = true;
}

function t_eq(mixed $actual, mixed $expected, string $message): void {
    if ($actual === $expected) {
        fwrite(STDOUT, "PASS: {$message}\n");
        return;
    }
    fwrite(STDERR, "FAIL: {$message}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n");
    $GLOBALS['t_failed'] = true;
}

function t_done(): void {
    if ($GLOBALS['t_failed']) {
        fwrite(STDERR, "RESULT: FAILURES\n");
        exit(1);
    }
    fwrite(STDOUT, "RESULT: ALL PASS\n");
    exit(0);
}
```

- [ ] **Step 2: Verify the harness**

Run: `php -d extension=sodium -d extension=curl -d extension=pdo_sqlite -r "require 'tests/discord/_assert.php'; t_ok(true,'harness'); t_done();"`
Expected: `PASS: harness`, `RESULT: ALL PASS`.

- [ ] **Step 3: Add the `discord` config block**

In `config/api.config.example.php`, insert before the closing `];`:

```php
    'discord' => [
        'public_key' => 'replace-with-the-application-public-key',
        'application_id' => 'replace-with-the-application-id',
        'bot_token' => 'replace-with-the-bot-token-SECRET',
        'app_token' => 'replace-with-a-long-random-app-token-SECRET',
        'bug_channel_id' => 'replace-with-the-bug-channel-id',
        'idea_channel_id' => 'replace-with-the-idea-channel-id',
        'faq_channel_id' => 'replace-with-the-faq-channel-id',
        'report_channel_id' => 'replace-with-the-report-channel-id',
        // Optional: set guild_id (your server id) for instant command registration.
        'guild_id' => '',
    ],
```

- [ ] **Step 4: Lint + commit**

Run: `php -l config/api.config.example.php` → `No syntax errors detected`.

```bash
git add tests/discord/_assert.php config/api.config.example.php
git commit -m "$(printf 'chore(discord-bot): test harness + discord config block\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Ed25519 signature verification

**Files:** Create `api/_internal/discord/signature.php`; Test `tests/discord/test_signature.php`.

**Interfaces:** Produces `avesmapsDiscordVerifySignature(string $publicKeyHex, string $signatureHex, string $timestamp, string $rawBody): bool`.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_signature.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/signature.php';

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded\n");
    exit(0);
}

$keypair = sodium_crypto_sign_keypair();
$publicKeyHex = bin2hex(sodium_crypto_sign_publickey($keypair));
$secretKey = sodium_crypto_sign_secretkey($keypair);
$timestamp = '1700000000';
$body = '{"type":1}';
$signatureHex = bin2hex(sodium_crypto_sign_detached($timestamp . $body, $secretKey));

t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, $timestamp, $body) === true, 'valid verifies');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, $timestamp, $body . 'x') === false, 'tampered body fails');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, 'zz', $timestamp, $body) === false, 'bad hex fails');
t_ok(avesmapsDiscordVerifySignature('', $signatureHex, $timestamp, $body) === false, 'empty key fails');

t_done();
```

- [ ] **Step 2: Run — expect fail** (`Call to undefined function avesmapsDiscordVerifySignature()`).

Run: `php -d extension=sodium -d extension=curl -d extension=pdo_sqlite tests/discord/test_signature.php`

- [ ] **Step 3: Implement**

Create `api/_internal/discord/signature.php`:

```php
<?php

declare(strict_types=1);

function avesmapsDiscordVerifySignature(string $publicKeyHex, string $signatureHex, string $timestamp, string $rawBody): bool {
    if ($publicKeyHex === '' || $signatureHex === '' || $timestamp === '') {
        return false;
    }
    if (!function_exists('sodium_crypto_sign_verify_detached')) {
        return false;
    }

    $signature = @hex2bin($signatureHex);
    $publicKey = @hex2bin($publicKeyHex);
    if ($signature === false || $publicKey === false) {
        return false;
    }
    if (strlen($publicKey) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
        return false;
    }

    try {
        return sodium_crypto_sign_verify_detached($signature, $timestamp . $rawBody, $publicKey);
    } catch (SodiumException) {
        return false;
    }
}
```

- [ ] **Step 4: Run — expect pass.** Then commit:

```bash
git add api/_internal/discord/signature.php tests/discord/test_signature.php
git commit -m "$(printf 'feat(discord-bot): Ed25519 signature verification\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: FAQ data + loader

**Files:** Create `api/discord/faq.de.json`, `api/_internal/discord/faq.php`; Test `tests/discord/test_faq.php`.

**Interfaces:** Produces `avesmapsDiscordLoadFaq(string $path): array`, `avesmapsDiscordFaqById(array $faq, string $id): ?array`.

- [ ] **Step 1: Create `api/discord/faq.de.json`**

```json
[
    { "id": "was-ist-avesmaps", "q": "Was ist Avesmaps?", "a": "Avesmaps ist eine kostenlose, interaktive Aventurien-Karte und ein Routenplaner für das Pen-and-Paper-Rollenspiel Das Schwarze Auge (DSA)." },
    { "id": "was-ist-aventurien", "q": "Was ist Aventurien?", "a": "Aventurien ist der zentrale Kontinent der Spielwelt Dere aus Das Schwarze Auge (englisch \"The Dark Eye\")." },
    { "id": "reiserouten-planen", "q": "Kann ich mit Avesmaps Reiserouten planen?", "a": "Ja. Avesmaps plant Routen über mehrere Wegpunkte, wahlweise die schnellste oder kürzeste Strecke, über Land-, Fluss- und Seewege." },
    { "id": "politische-grenzen", "q": "Zeigt Avesmaps die politischen Grenzen der Reiche?", "a": "Ja. Eine optionale politische Karte zeigt Herrschaftsgebiete und Reichsgrenzen, die sich ein- und ausblenden lassen." },
    { "id": "kostenlos", "q": "Ist Avesmaps kostenlos?", "a": "Ja. Avesmaps ist ein kostenloses, nicht-kommerzielles Fanprojekt." },
    { "id": "routen-teilen", "q": "Kann ich geplante Routen teilen?", "a": "Ja. Routen und Einstellungen sind in der URL kodiert und lassen sich per Link weitergeben." },
    { "id": "offiziell", "q": "Ist Avesmaps offiziell?", "a": "Nein. Avesmaps ist ein inoffizielles Fanprojekt ohne Verbindung zu Ulisses Spiele." }
]
```

- [ ] **Step 2: Write the failing test**

Create `tests/discord/test_faq.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/faq.php';

$faq = avesmapsDiscordLoadFaq(__DIR__ . '/../../api/discord/faq.de.json');
t_eq(count($faq), 7, '7 entries');
t_eq($faq[0]['id'], 'was-ist-avesmaps', 'first id');
$item = avesmapsDiscordFaqById($faq, 'kostenlos');
t_ok($item !== null && str_starts_with($item['a'], 'Ja.'), 'lookup by id');
t_eq(avesmapsDiscordFaqById($faq, 'nope'), null, 'unknown id -> null');
t_eq(avesmapsDiscordLoadFaq(__DIR__ . '/nope.json'), [], 'missing file -> []');

t_done();
```

- [ ] **Step 3: Run — expect fail.**

- [ ] **Step 4: Implement `api/_internal/discord/faq.php`**

```php
<?php

declare(strict_types=1);

function avesmapsDiscordLoadFaq(string $path): array {
    if (!is_file($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    if ($raw === false) {
        return [];
    }
    try {
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }
    if (!is_array($data)) {
        return [];
    }

    $items = [];
    foreach ($data as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $id = (string) ($entry['id'] ?? '');
        $question = (string) ($entry['q'] ?? '');
        $answer = (string) ($entry['a'] ?? '');
        if ($id === '' || $question === '' || $answer === '') {
            continue;
        }
        $items[] = ['id' => $id, 'q' => $question, 'a' => $answer];
    }

    return $items;
}

function avesmapsDiscordFaqById(array $faq, string $id): ?array {
    foreach ($faq as $item) {
        if (is_array($item) && ($item['id'] ?? null) === $id) {
            return $item;
        }
    }

    return null;
}
```

- [ ] **Step 5: Run — expect pass. Commit:**

```bash
git add api/discord/faq.de.json api/_internal/discord/faq.php tests/discord/test_faq.php
git commit -m "$(printf 'feat(discord-bot): FAQ data + loader\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Case store (`discord_cases`)

**Files:** Create `api/_internal/discord/store.php`; Test `tests/discord/test_store.php`.

**Interfaces:**
- Produces: `avesmapsDiscordEnsureCasesTable(PDO $pdo): void`; `avesmapsDiscordInsertCase(PDO $pdo, array $case): int` (`$case` keys: kind,title,body,location,reporter,reporter_id,channel_id,created_at); `avesmapsDiscordOpenCases(PDO $pdo): array`; `avesmapsDiscordCloseCase(PDO $pdo, int $id, string $solvedBy, string $solvedAt): bool` (true iff a still-open row was closed).

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_store.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/store.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsDiscordEnsureCasesTable($pdo);

$id = avesmapsDiscordInsertCase($pdo, [
    'kind' => 'bug', 'title' => 'Absturz', 'body' => 'Karte hängt', 'location' => 'Gareth',
    'reporter' => 'valente', 'reporter_id' => '42', 'channel_id' => '111', 'created_at' => '2026-07-06 10:00:00',
]);
t_ok($id >= 1, 'insert returns an id');

$open = avesmapsDiscordOpenCases($pdo);
t_eq(count($open), 1, 'one open case');
t_eq($open[0]['title'], 'Absturz', 'open case title');
t_eq($open[0]['kind'], 'bug', 'open case kind');

t_ok(avesmapsDiscordCloseCase($pdo, $id, 'chef', '2026-07-06 12:00:00') === true, 'close an open case -> true');
t_eq(count(avesmapsDiscordOpenCases($pdo)), 0, 'no open cases after close');
t_ok(avesmapsDiscordCloseCase($pdo, $id, 'chef', '2026-07-06 12:00:00') === false, 'closing again -> false');
t_ok(avesmapsDiscordCloseCase($pdo, 9999, 'chef', '2026-07-06 12:00:00') === false, 'closing missing -> false');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/_internal/discord/store.php`**

```php
<?php

declare(strict_types=1);

function avesmapsDiscordEnsureCasesTable(PDO $pdo): void {
    $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);

    if ($driver === 'mysql') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS discord_cases (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                kind ENUM(\'bug\',\'idea\',\'question\') NOT NULL,
                title VARCHAR(300) NOT NULL,
                body TEXT NOT NULL,
                location VARCHAR(500) NULL,
                reporter VARCHAR(190) NOT NULL,
                reporter_id VARCHAR(40) NULL,
                channel_id VARCHAR(40) NULL,
                message_id VARCHAR(40) NULL,
                status ENUM(\'open\',\'solved\') NOT NULL DEFAULT \'open\',
                created_at DATETIME NOT NULL,
                solved_at DATETIME NULL,
                solved_by VARCHAR(190) NULL,
                INDEX idx_status_created (status, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );

        return;
    }

    // Portable variant (tests: SQLite). message_id is reserved for Phase 1b.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS discord_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            location TEXT NULL,
            reporter TEXT NOT NULL,
            reporter_id TEXT NULL,
            channel_id TEXT NULL,
            message_id TEXT NULL,
            status TEXT NOT NULL DEFAULT \'open\',
            created_at TEXT NOT NULL,
            solved_at TEXT NULL,
            solved_by TEXT NULL
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_status_created ON discord_cases (status, created_at)');
}

function avesmapsDiscordInsertCase(PDO $pdo, array $case): int {
    $statement = $pdo->prepare(
        'INSERT INTO discord_cases (kind, title, body, location, reporter, reporter_id, channel_id, status, created_at)
         VALUES (:kind, :title, :body, :location, :reporter, :reporter_id, :channel_id, \'open\', :created_at)'
    );
    $statement->execute([
        ':kind' => (string) ($case['kind'] ?? ''),
        ':title' => (string) ($case['title'] ?? ''),
        ':body' => (string) ($case['body'] ?? ''),
        ':location' => ($case['location'] ?? '') !== '' ? (string) $case['location'] : null,
        ':reporter' => (string) ($case['reporter'] ?? ''),
        ':reporter_id' => ($case['reporter_id'] ?? '') !== '' ? (string) $case['reporter_id'] : null,
        ':channel_id' => ($case['channel_id'] ?? '') !== '' ? (string) $case['channel_id'] : null,
        ':created_at' => (string) ($case['created_at'] ?? ''),
    ]);

    return (int) $pdo->lastInsertId();
}

function avesmapsDiscordOpenCases(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT id, kind, title, body, location, reporter, created_at
         FROM discord_cases WHERE status = \'open\' ORDER BY created_at ASC, id ASC'
    );
    $rows = $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];

    return array_map(static function (array $row): array {
        return [
            'id' => (int) $row['id'],
            'kind' => (string) $row['kind'],
            'title' => (string) $row['title'],
            'body' => (string) $row['body'],
            'location' => (string) ($row['location'] ?? ''),
            'reporter' => (string) $row['reporter'],
            'created_at' => (string) $row['created_at'],
        ];
    }, $rows);
}

function avesmapsDiscordCloseCase(PDO $pdo, int $id, string $solvedBy, string $solvedAt): bool {
    $statement = $pdo->prepare(
        'UPDATE discord_cases SET status = \'solved\', solved_at = :solved_at, solved_by = :solved_by
         WHERE id = :id AND status = \'open\''
    );
    $statement->execute([':solved_at' => $solvedAt, ':solved_by' => $solvedBy, ':id' => $id]);

    return $statement->rowCount() > 0;
}
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/_internal/discord/store.php tests/discord/test_store.php
git commit -m "$(printf 'feat(discord-bot): discord_cases store (insert/open/close)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Response / embed / modal builders

**Files:** Create `api/_internal/discord/responses.php`; Test `tests/discord/test_responses.php`.

**Interfaces:**
- Constants: `AVESMAPS_DISCORD_HELP_SELECT_ID`, `AVESMAPS_DISCORD_{BUG,IDEA,QUESTION}_BUTTON_ID`, `AVESMAPS_DISCORD_{BUG,IDEA,QUESTION}_MODAL_ID`, `AVESMAPS_DISCORD_EPHEMERAL_FLAG`(=64), `AVESMAPS_DISCORD_PONG`(=1), `AVESMAPS_DISCORD_CHANNEL_MESSAGE`(=4), `AVESMAPS_DISCORD_MODAL`(=9).
- Functions: `avesmapsDiscordKindMeta(string $kind): array` (keys emoji,label,color,channel_key); `avesmapsDiscordTruncate`, `avesmapsDiscordPongResponse`, `avesmapsDiscordEphemeralMessage(array $data): array`, `avesmapsDiscordHelpResponse(array $faq): array`, `avesmapsDiscordFaqAnswerResponse(array $item): array`, `avesmapsDiscordUnknownAnswerResponse(): array`, `avesmapsDiscordBugModal/IdeaModal/QuestionModal(): array`, `avesmapsDiscordCaseEmbedMessage(string $kind, int $caseId, array $values, string $reporter): array`, `avesmapsDiscordCaseConfirmResponse(string $kind, int $caseId): array`, `avesmapsDiscordCloseConfirmResponse(int $caseId, bool $found): array`, `avesmapsDiscordErrorResponse(string $message): array`.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_responses.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';

$faq = [['id' => 'a', 'q' => 'Frage A?', 'a' => 'Antwort A.']];

$help = avesmapsDiscordHelpResponse($faq);
t_eq($help['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'help ephemeral');
t_eq($help['data']['components'][0]['components'][0]['custom_id'], AVESMAPS_DISCORD_HELP_SELECT_ID, 'help select');
$buttons = $help['data']['components'][1]['components'];
t_eq(count($buttons), 3, 'three action buttons');
t_eq($buttons[2]['custom_id'], AVESMAPS_DISCORD_QUESTION_BUTTON_ID, 'question button present');

$answer = avesmapsDiscordFaqAnswerResponse($faq[0]);
t_eq($answer['data']['embeds'][0]['title'], 'Frage A?', 'answer title');

$modal = avesmapsDiscordQuestionModal();
t_eq($modal['type'], AVESMAPS_DISCORD_MODAL, 'question modal type');
t_eq($modal['data']['custom_id'], AVESMAPS_DISCORD_QUESTION_MODAL_ID, 'question modal id');
t_eq(count($modal['data']['components']), 3, 'modal has 3 inputs');

$embed = avesmapsDiscordCaseEmbedMessage('bug', 42, ['title' => 'Absturz', 'description' => 'Hängt', 'location' => 'Gareth'], 'valente');
t_ok(str_contains($embed['embeds'][0]['title'], 'Fall #42'), 'embed shows case number');
t_ok(str_contains($embed['embeds'][0]['title'], 'Absturz'), 'embed shows title');
$names = array_map(static fn(array $f): string => $f['name'], $embed['embeds'][0]['fields']);
t_ok(in_array('Wo?', $names, true) && in_array('Von', $names, true), 'embed has Wo?/Von fields');

$embedNoLoc = avesmapsDiscordCaseEmbedMessage('idea', 7, ['title' => 'X', 'description' => 'Y', 'location' => ''], 'u');
$names2 = array_map(static fn(array $f): string => $f['name'], $embedNoLoc['embeds'][0]['fields']);
t_ok(!in_array('Wo?', $names2, true), 'no Wo? field when empty');

$confirm = avesmapsDiscordCaseConfirmResponse('question', 5);
t_ok(str_contains($confirm['data']['content'], 'Fall #5'), 'confirm shows case number');

t_ok(str_contains(avesmapsDiscordCloseConfirmResponse(5, true)['data']['content'], 'erledigt'), 'close-found message');
t_ok(str_contains(avesmapsDiscordCloseConfirmResponse(5, false)['data']['content'], 'nicht gefunden'), 'close-missing message');

t_eq(avesmapsDiscordKindMeta('bug')['channel_key'], 'bug_channel_id', 'bug -> bug channel');
t_eq(avesmapsDiscordKindMeta('question')['channel_key'], 'faq_channel_id', 'question -> faq channel');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/_internal/discord/responses.php`**

```php
<?php

declare(strict_types=1);

const AVESMAPS_DISCORD_HELP_SELECT_ID = 'help_faq_select';
const AVESMAPS_DISCORD_BUG_BUTTON_ID = 'open_bug_modal';
const AVESMAPS_DISCORD_IDEA_BUTTON_ID = 'open_idea_modal';
const AVESMAPS_DISCORD_QUESTION_BUTTON_ID = 'open_question_modal';
const AVESMAPS_DISCORD_BUG_MODAL_ID = 'bug_modal';
const AVESMAPS_DISCORD_IDEA_MODAL_ID = 'idea_modal';
const AVESMAPS_DISCORD_QUESTION_MODAL_ID = 'question_modal';

const AVESMAPS_DISCORD_EPHEMERAL_FLAG = 64;
const AVESMAPS_DISCORD_PONG = 1;
const AVESMAPS_DISCORD_CHANNEL_MESSAGE = 4;
const AVESMAPS_DISCORD_MODAL = 9;

const AVESMAPS_DISCORD_COLOR = 0x2E7D64;

function avesmapsDiscordKindMeta(string $kind): array {
    return match ($kind) {
        'bug' => ['emoji' => '🐞', 'label' => 'Bug', 'color' => 0xC0392B, 'channel_key' => 'bug_channel_id'],
        'idea' => ['emoji' => '💡', 'label' => 'Idee', 'color' => 0xF1C40F, 'channel_key' => 'idea_channel_id'],
        'question' => ['emoji' => '❓', 'label' => 'Frage', 'color' => AVESMAPS_DISCORD_COLOR, 'channel_key' => 'faq_channel_id'],
        default => ['emoji' => '📌', 'label' => 'Fall', 'color' => AVESMAPS_DISCORD_COLOR, 'channel_key' => ''],
    };
}

function avesmapsDiscordTruncate(string $text, int $max): string {
    if ($max <= 0) {
        return '';
    }
    if (mb_strlen($text) <= $max) {
        return $text;
    }

    return mb_substr($text, 0, $max - 1) . '…';
}

function avesmapsDiscordPongResponse(): array {
    return ['type' => AVESMAPS_DISCORD_PONG];
}

function avesmapsDiscordEphemeralMessage(array $data): array {
    $data['flags'] = AVESMAPS_DISCORD_EPHEMERAL_FLAG;

    return ['type' => AVESMAPS_DISCORD_CHANNEL_MESSAGE, 'data' => $data];
}

function avesmapsDiscordHelpResponse(array $faq): array {
    $options = [];
    foreach ($faq as $item) {
        if (!is_array($item)) {
            continue;
        }
        $options[] = [
            'label' => avesmapsDiscordTruncate((string) ($item['q'] ?? ''), 100),
            'value' => (string) ($item['id'] ?? ''),
        ];
    }

    $components = [];
    if ($options !== []) {
        $components[] = [
            'type' => 1,
            'components' => [[
                'type' => 3,
                'custom_id' => AVESMAPS_DISCORD_HELP_SELECT_ID,
                'placeholder' => 'Wähle eine Frage …',
                'options' => $options,
            ]],
        ];
    }
    $components[] = [
        'type' => 1,
        'components' => [
            ['type' => 2, 'style' => 2, 'custom_id' => AVESMAPS_DISCORD_BUG_BUTTON_ID, 'label' => 'Bug melden', 'emoji' => ['name' => '🐞']],
            ['type' => 2, 'style' => 2, 'custom_id' => AVESMAPS_DISCORD_IDEA_BUTTON_ID, 'label' => 'Idee einreichen', 'emoji' => ['name' => '💡']],
            ['type' => 2, 'style' => 2, 'custom_id' => AVESMAPS_DISCORD_QUESTION_BUTTON_ID, 'label' => 'Frage stellen', 'emoji' => ['name' => '❓']],
        ],
    ];

    return avesmapsDiscordEphemeralMessage([
        'embeds' => [[
            'title' => 'Avesmaps-Hilfe',
            'description' => 'Wähle unten eine häufige Frage aus – oder melde einen Bug, reiche eine Idee ein oder stell eine Frage.',
            'color' => AVESMAPS_DISCORD_COLOR,
        ]],
        'components' => $components,
    ]);
}

function avesmapsDiscordFaqAnswerResponse(array $item): array {
    return avesmapsDiscordEphemeralMessage([
        'embeds' => [[
            'title' => avesmapsDiscordTruncate((string) ($item['q'] ?? ''), 256),
            'description' => avesmapsDiscordTruncate((string) ($item['a'] ?? ''), 4096),
            'color' => AVESMAPS_DISCORD_COLOR,
        ]],
    ]);
}

function avesmapsDiscordUnknownAnswerResponse(): array {
    return avesmapsDiscordEphemeralMessage(['content' => 'Zu dieser Auswahl habe ich leider keine Antwort gefunden.']);
}

function avesmapsDiscordFeedbackModal(string $customId, string $title): array {
    return [
        'type' => AVESMAPS_DISCORD_MODAL,
        'data' => [
            'custom_id' => $customId,
            'title' => avesmapsDiscordTruncate($title, 45),
            'components' => [
                ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'style' => 1, 'label' => 'Titel / Kurzfassung', 'required' => true, 'max_length' => 100]]],
                ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'style' => 2, 'label' => 'Beschreibung', 'required' => true, 'max_length' => 1500]]],
                ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'location', 'style' => 1, 'label' => 'Wo? (URL oder Ort, optional)', 'required' => false, 'max_length' => 300]]],
            ],
        ],
    ];
}

function avesmapsDiscordBugModal(): array {
    return avesmapsDiscordFeedbackModal(AVESMAPS_DISCORD_BUG_MODAL_ID, '🐞 Bug melden');
}

function avesmapsDiscordIdeaModal(): array {
    return avesmapsDiscordFeedbackModal(AVESMAPS_DISCORD_IDEA_MODAL_ID, '💡 Idee einreichen');
}

function avesmapsDiscordQuestionModal(): array {
    return avesmapsDiscordFeedbackModal(AVESMAPS_DISCORD_QUESTION_MODAL_ID, '❓ Frage stellen');
}

function avesmapsDiscordCaseEmbedMessage(string $kind, int $caseId, array $values, string $reporter): array {
    $meta = avesmapsDiscordKindMeta($kind);
    $title = avesmapsDiscordTruncate((string) ($values['title'] ?? ''), 200);
    $description = avesmapsDiscordTruncate((string) ($values['description'] ?? ''), 4000);
    $location = trim((string) ($values['location'] ?? ''));

    $fields = [];
    if ($location !== '') {
        $fields[] = ['name' => 'Wo?', 'value' => avesmapsDiscordTruncate($location, 1024), 'inline' => false];
    }
    $fields[] = ['name' => 'Von', 'value' => avesmapsDiscordTruncate($reporter, 256), 'inline' => false];

    return [
        'embeds' => [[
            'title' => $meta['emoji'] . ' Fall #' . $caseId . ': ' . ($title !== '' ? $title : $meta['label']),
            'description' => $description,
            'color' => $meta['color'],
            'fields' => $fields,
        ]],
    ];
}

function avesmapsDiscordCaseConfirmResponse(string $kind, int $caseId): array {
    $meta = avesmapsDiscordKindMeta($kind);
    $word = match ($kind) {
        'bug' => 'Dein Bug',
        'idea' => 'Deine Idee',
        'question' => 'Deine Frage',
        default => 'Dein Fall',
    };

    return avesmapsDiscordEphemeralMessage(['content' => "Danke! {$word} wurde als Fall #{$caseId} aufgenommen. {$meta['emoji']}"]);
}

function avesmapsDiscordCloseConfirmResponse(int $caseId, bool $found): array {
    return avesmapsDiscordEphemeralMessage([
        'content' => $found
            ? "Fall #{$caseId} als erledigt markiert. ✅"
            : "Fall #{$caseId} nicht gefunden oder schon erledigt.",
    ]);
}

function avesmapsDiscordErrorResponse(string $message): array {
    return avesmapsDiscordEphemeralMessage(['content' => $message]);
}
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/_internal/discord/responses.php tests/discord/test_responses.php
git commit -m "$(printf 'feat(discord-bot): builders for help, modals, case embeds/confirms\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Interaction router

**Files:** Create `api/_internal/discord/router.php`; Test `tests/discord/test_router.php`.

**Interfaces:**
- Consumes: `responses.php`, `faq.php`.
- Produces: `avesmapsDiscordRouteInteraction(array $interaction, array $faq, array $discordConfig): array` returning one of `['type'=>'respond','response'=>array]`, `['type'=>'submit_case','kind'=>string,'channel_id'=>string,'values'=>array,'reporter'=>string,'reporter_id'=>string]`, `['type'=>'close_case','case_id'=>int,'closed_by'=>string]`. Also `avesmapsDiscordExtractReporter(array): string`, `avesmapsDiscordExtractReporterId(array): string`, `avesmapsDiscordModalValues(array): array`.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_router.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';
require __DIR__ . '/../../api/_internal/discord/faq.php';
require __DIR__ . '/../../api/_internal/discord/router.php';

$faq = [['id' => 'kostenlos', 'q' => 'Ist Avesmaps kostenlos?', 'a' => 'Ja.']];
$config = ['bug_channel_id' => '111', 'idea_channel_id' => '222', 'faq_channel_id' => '333'];

t_eq(avesmapsDiscordRouteInteraction(['type' => 1], $faq, $config)['response']['type'], AVESMAPS_DISCORD_PONG, 'PING -> PONG');

$help = avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'hilfe']], $faq, $config);
t_eq($help['response']['data']['components'][0]['components'][0]['custom_id'], AVESMAPS_DISCORD_HELP_SELECT_ID, '/hilfe menu');

t_eq(avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'frage']], $faq, $config)['response']['data']['custom_id'], AVESMAPS_DISCORD_QUESTION_MODAL_ID, '/frage -> question modal');

$pick = avesmapsDiscordRouteInteraction(['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_HELP_SELECT_ID, 'values' => ['kostenlos']]], $faq, $config);
t_eq($pick['response']['data']['embeds'][0]['title'], 'Ist Avesmaps kostenlos?', 'select -> answer');

$btn = avesmapsDiscordRouteInteraction(['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_QUESTION_BUTTON_ID]], $faq, $config);
t_eq($btn['response']['data']['custom_id'], AVESMAPS_DISCORD_QUESTION_MODAL_ID, 'question button -> modal');

$submit = avesmapsDiscordRouteInteraction([
    'type' => 5,
    'data' => ['custom_id' => AVESMAPS_DISCORD_QUESTION_MODAL_ID, 'components' => [
        ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Wie plane ich?']]],
        ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Wo klicke ich?']]],
    ]],
    'member' => ['user' => ['username' => 'valente', 'id' => '42']],
], $faq, $config);
t_eq($submit['type'], 'submit_case', 'question submit -> submit_case');
t_eq($submit['kind'], 'question', 'kind question');
t_eq($submit['channel_id'], '333', 'question -> faq channel');
t_eq($submit['values']['title'], 'Wie plane ich?', 'values captured');
t_eq($submit['reporter'], 'valente', 'reporter captured');
t_eq($submit['reporter_id'], '42', 'reporter id captured');

$bugSubmit = avesmapsDiscordRouteInteraction([
    'type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID, 'components' => []],
    'user' => ['username' => 'x', 'id' => '1'],
], $faq, $config);
t_eq($bugSubmit['channel_id'], '111', 'bug submit -> bug channel');

$close = avesmapsDiscordRouteInteraction([
    'type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 42]]],
    'member' => ['user' => ['username' => 'chef']],
], $faq, $config);
t_eq($close['type'], 'close_case', '/erledigt -> close_case');
t_eq($close['case_id'], 42, 'close case id');
t_eq($close['closed_by'], 'chef', 'closed_by captured');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/_internal/discord/router.php`**

```php
<?php

declare(strict_types=1);

// Depends on responses.php + faq.php loaded by the caller.

function avesmapsDiscordExtractReporter(array $interaction): string {
    $user = $interaction['member']['user'] ?? $interaction['user'] ?? [];
    if (!is_array($user)) {
        return 'Unbekannt';
    }
    $name = (string) ($user['global_name'] ?? $user['username'] ?? '');

    return $name !== '' ? $name : 'Unbekannt';
}

function avesmapsDiscordExtractReporterId(array $interaction): string {
    $user = $interaction['member']['user'] ?? $interaction['user'] ?? [];

    return is_array($user) ? (string) ($user['id'] ?? '') : '';
}

function avesmapsDiscordModalValues(array $interaction): array {
    $values = [];
    foreach (($interaction['data']['components'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        foreach (($row['components'] ?? []) as $component) {
            if (!is_array($component)) {
                continue;
            }
            $id = (string) ($component['custom_id'] ?? '');
            if ($id !== '') {
                $values[$id] = (string) ($component['value'] ?? '');
            }
        }
    }

    return $values;
}

function avesmapsDiscordCommandOptionInt(array $interaction, string $name): int {
    foreach (($interaction['data']['options'] ?? []) as $option) {
        if (is_array($option) && ($option['name'] ?? '') === $name) {
            return (int) ($option['value'] ?? 0);
        }
    }

    return 0;
}

function avesmapsDiscordRespond(array $response): array {
    return ['type' => 'respond', 'response' => $response];
}

function avesmapsDiscordModalForKind(string $kind): array {
    return match ($kind) {
        'bug' => avesmapsDiscordBugModal(),
        'idea' => avesmapsDiscordIdeaModal(),
        'question' => avesmapsDiscordQuestionModal(),
        default => avesmapsDiscordErrorResponse('Unbekannte Aktion.'),
    };
}

function avesmapsDiscordSubmitCase(string $kind, array $interaction, array $discordConfig): array {
    $meta = avesmapsDiscordKindMeta($kind);
    $channelId = (string) ($discordConfig[$meta['channel_key']] ?? '');

    return [
        'type' => 'submit_case',
        'kind' => $kind,
        'channel_id' => $channelId,
        'values' => avesmapsDiscordModalValues($interaction),
        'reporter' => avesmapsDiscordExtractReporter($interaction),
        'reporter_id' => avesmapsDiscordExtractReporterId($interaction),
    ];
}

function avesmapsDiscordRouteInteraction(array $interaction, array $faq, array $discordConfig): array {
    $type = (int) ($interaction['type'] ?? 0);

    if ($type === 1) {
        return avesmapsDiscordRespond(avesmapsDiscordPongResponse());
    }

    if ($type === 2) {
        $name = (string) ($interaction['data']['name'] ?? '');
        if ($name === 'hilfe') {
            return avesmapsDiscordRespond(avesmapsDiscordHelpResponse($faq));
        }
        if ($name === 'bug' || $name === 'idee' || $name === 'frage') {
            $kind = $name === 'idee' ? 'idea' : ($name === 'frage' ? 'question' : 'bug');
            return avesmapsDiscordRespond(avesmapsDiscordModalForKind($kind));
        }
        if ($name === 'erledigt') {
            return [
                'type' => 'close_case',
                'case_id' => avesmapsDiscordCommandOptionInt($interaction, 'nummer'),
                'closed_by' => avesmapsDiscordExtractReporter($interaction),
            ];
        }

        return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekannter Befehl.'));
    }

    if ($type === 3) {
        $customId = (string) ($interaction['data']['custom_id'] ?? '');
        if ($customId === AVESMAPS_DISCORD_HELP_SELECT_ID) {
            $selected = (string) (($interaction['data']['values'][0]) ?? '');
            $item = avesmapsDiscordFaqById($faq, $selected);

            return avesmapsDiscordRespond($item !== null ? avesmapsDiscordFaqAnswerResponse($item) : avesmapsDiscordUnknownAnswerResponse());
        }
        $kind = match ($customId) {
            AVESMAPS_DISCORD_BUG_BUTTON_ID => 'bug',
            AVESMAPS_DISCORD_IDEA_BUTTON_ID => 'idea',
            AVESMAPS_DISCORD_QUESTION_BUTTON_ID => 'question',
            default => '',
        };
        if ($kind !== '') {
            return avesmapsDiscordRespond(avesmapsDiscordModalForKind($kind));
        }

        return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekannte Aktion.'));
    }

    if ($type === 5) {
        $customId = (string) ($interaction['data']['custom_id'] ?? '');
        $kind = match ($customId) {
            AVESMAPS_DISCORD_BUG_MODAL_ID => 'bug',
            AVESMAPS_DISCORD_IDEA_MODAL_ID => 'idea',
            AVESMAPS_DISCORD_QUESTION_MODAL_ID => 'question',
            default => '',
        };
        if ($kind === '') {
            return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekanntes Formular.'));
        }

        return avesmapsDiscordSubmitCase($kind, $interaction, $discordConfig);
    }

    return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Nicht unterstützt.'));
}
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/_internal/discord/router.php tests/discord/test_router.php
git commit -m "$(printf 'feat(discord-bot): router (commands, components, submit/close cases)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Channel message POST

**Files:** Create `api/_internal/discord/post-message.php`; Test `tests/discord/test_post_message.php`.

**Interfaces:** Produces `avesmapsDiscordPostMessage(string $botToken, string $channelId, array $message): array` returning `['ok'=>bool,'status'=>int,'error'=>string,'message_id'=>string]`.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_post_message.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/post-message.php';

t_ok(avesmapsDiscordPostMessage('', '123', ['content' => 'x'])['ok'] === false, 'missing token -> not ok');
t_ok(avesmapsDiscordPostMessage('token', '', ['content' => 'x'])['ok'] === false, 'missing channel -> not ok');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/_internal/discord/post-message.php`**

```php
<?php

declare(strict_types=1);

const AVESMAPS_DISCORD_API_BASE = 'https://discord.com/api/v10';

function avesmapsDiscordPostMessage(string $botToken, string $channelId, array $message): array {
    if ($botToken === '' || $channelId === '') {
        return ['ok' => false, 'status' => 0, 'error' => 'missing token or channel', 'message_id' => ''];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'error' => 'curl unavailable', 'message_id' => ''];
    }

    $url = AVESMAPS_DISCORD_API_BASE . '/channels/' . rawurlencode($channelId) . '/messages';
    $payload = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return ['ok' => false, 'status' => 0, 'error' => 'payload encode failed', 'message_id' => ''];
    }

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bot ' . $botToken,
            'Content-Type: application/json',
            'User-Agent: AvesmapsBot (https://avesmaps.de, 1.0)',
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    $ok = $status >= 200 && $status < 300;
    $messageId = '';
    if ($ok && is_string($body)) {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $messageId = (string) ($decoded['id'] ?? '');
        }
    }

    return [
        'ok' => $ok,
        'status' => $status,
        'error' => $ok ? '' : ($curlError !== '' ? $curlError : (string) $body),
        'message_id' => $messageId,
    ];
}
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/_internal/discord/post-message.php tests/discord/test_post_message.php
git commit -m "$(printf 'feat(discord-bot): REST channel message POST\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: App-token auth helper

**Files:** Create `api/_internal/discord/app-auth.php`; Test `tests/discord/test_app_auth.php`.

**Interfaces:** Produces `avesmapsDiscordCheckAppToken(string $configured, string $provided): bool` (constant-time; false on any empty).

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_app_auth.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/app-auth.php';

t_ok(avesmapsDiscordCheckAppToken('secret', 'secret') === true, 'match');
t_ok(avesmapsDiscordCheckAppToken('secret', 'nope') === false, 'mismatch');
t_ok(avesmapsDiscordCheckAppToken('', 'secret') === false, 'empty configured -> false');
t_ok(avesmapsDiscordCheckAppToken('secret', '') === false, 'empty provided -> false');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/_internal/discord/app-auth.php`**

```php
<?php

declare(strict_types=1);

function avesmapsDiscordCheckAppToken(string $configured, string $provided): bool {
    if ($configured === '' || $provided === '') {
        return false;
    }

    return hash_equals($configured, $provided);
}
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/_internal/discord/app-auth.php tests/discord/test_app_auth.php
git commit -m "$(printf 'feat(discord-bot): app-token constant-time check\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 9: Request processor (signature gate + dispatch)

**Files:** Create `api/_internal/discord/endpoint.php`; Test `tests/discord/test_endpoint.php`.

**Interfaces:**
- Consumes: `signature.php`, `responses.php`, `router.php`.
- Produces: `avesmapsDiscordProcessRequest(string $rawBody, string $signatureHex, string $timestampHeader, array $discordConfig, array $faq, array $deps): array` → `['status'=>int,'body'=>array]`. `$deps` keys: `post` (`fn(string,array):array{ok,message_id}`), `insert` (`fn(array):int`), `close` (`fn(int,string):bool`).

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_endpoint.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/signature.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';
require __DIR__ . '/../../api/_internal/discord/faq.php';
require __DIR__ . '/../../api/_internal/discord/router.php';
require __DIR__ . '/../../api/_internal/discord/endpoint.php';

$faq = [];
$deps = [
    'post' => static fn(string $c, array $m): array => ['ok' => true, 'message_id' => 'm1'],
    'insert' => static fn(array $case): int => 42,
    'close' => static fn(int $id, string $by): bool => $id === 42,
];

t_eq(avesmapsDiscordProcessRequest('{"type":1}', 'deadbeef', '1', ['public_key' => 'aa'], $faq, $deps)['status'], 401, 'bad signature -> 401');

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded\n");
    t_done();
}

$keypair = sodium_crypto_sign_keypair();
$publicKeyHex = bin2hex(sodium_crypto_sign_publickey($keypair));
$secretKey = sodium_crypto_sign_secretkey($keypair);
$config = ['public_key' => $publicKeyHex, 'bug_channel_id' => '111'];
$sign = static function (string $body) use ($secretKey): array {
    $ts = '1700000000';
    return [$ts, bin2hex(sodium_crypto_sign_detached($ts . $body, $secretKey))];
};

[$ts, $sig] = $sign('{"type":1}');
$ping = avesmapsDiscordProcessRequest('{"type":1}', $sig, $ts, $config, $faq, $deps);
t_eq($ping['status'], 200, 'PING -> 200');
t_eq($ping['body']['type'], AVESMAPS_DISCORD_PONG, 'PING -> PONG');

$captured = [];
$deps2 = [
    'post' => static function (string $c, array $m) use (&$captured): array { $captured['channel'] = $c; $captured['msg'] = $m; return ['ok' => true, 'message_id' => 'm1']; },
    'insert' => static function (array $case) use (&$captured): int { $captured['case'] = $case; return 42; },
    'close' => static fn(int $id, string $by): bool => true,
];
$submitBody = json_encode(['type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID, 'components' => [
    ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Absturz']]],
    ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Hängt']]],
]], 'user' => ['username' => 'u', 'id' => '1']], JSON_UNESCAPED_UNICODE);
[$ts2, $sig2] = $sign($submitBody);
$submit = avesmapsDiscordProcessRequest($submitBody, $sig2, $ts2, $config, $faq, $deps2);
t_eq($submit['status'], 200, 'submit -> 200');
t_eq($captured['case']['kind'], 'bug', 'insert got bug case');
t_eq($captured['channel'], '111', 'posted to bug channel');
t_ok(str_contains($submit['body']['data']['content'], 'Fall #42'), 'confirm names the case');

$closeBody = json_encode(['type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 42]]], 'user' => ['username' => 'chef']], JSON_UNESCAPED_UNICODE);
[$ts3, $sig3] = $sign($closeBody);
$close = avesmapsDiscordProcessRequest($closeBody, $sig3, $ts3, $config, $faq, $deps);
t_ok(str_contains($close['body']['data']['content'], 'erledigt'), 'close -> confirmation');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/_internal/discord/endpoint.php`**

```php
<?php

declare(strict_types=1);

// Depends on signature.php + responses.php + router.php loaded by the caller.

function avesmapsDiscordProcessRequest(
    string $rawBody,
    string $signatureHex,
    string $timestampHeader,
    array $discordConfig,
    array $faq,
    array $deps
): array {
    if (!avesmapsDiscordVerifySignature((string) ($discordConfig['public_key'] ?? ''), $signatureHex, $timestampHeader, $rawBody)) {
        return ['status' => 401, 'body' => ['error' => 'invalid request signature']];
    }

    try {
        $interaction = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return ['status' => 400, 'body' => ['error' => 'invalid json']];
    }
    if (!is_array($interaction)) {
        $interaction = [];
    }

    $result = avesmapsDiscordRouteInteraction($interaction, $faq, $discordConfig);
    $type = (string) ($result['type'] ?? '');

    if ($type === 'submit_case') {
        try {
            $caseId = (int) $deps['insert']([
                'kind' => (string) $result['kind'],
                'title' => (string) ($result['values']['title'] ?? ''),
                'body' => (string) ($result['values']['description'] ?? ''),
                'location' => (string) ($result['values']['location'] ?? ''),
                'reporter' => (string) $result['reporter'],
                'reporter_id' => (string) $result['reporter_id'],
                'channel_id' => (string) $result['channel_id'],
            ]);
        } catch (Throwable) {
            return ['status' => 200, 'body' => avesmapsDiscordErrorResponse('Konnte gerade nicht gespeichert werden – bitte später erneut versuchen.')];
        }

        // Best-effort channel post; the case is already stored either way.
        $deps['post'](
            (string) $result['channel_id'],
            avesmapsDiscordCaseEmbedMessage((string) $result['kind'], $caseId, (array) $result['values'], (string) $result['reporter'])
        );

        return ['status' => 200, 'body' => avesmapsDiscordCaseConfirmResponse((string) $result['kind'], $caseId)];
    }

    if ($type === 'close_case') {
        $caseId = (int) ($result['case_id'] ?? 0);
        try {
            $found = $caseId > 0 && (bool) $deps['close']($caseId, (string) ($result['closed_by'] ?? ''));
        } catch (Throwable) {
            return ['status' => 200, 'body' => avesmapsDiscordErrorResponse('Konnte den Fall gerade nicht aktualisieren.')];
        }

        return ['status' => 200, 'body' => avesmapsDiscordCloseConfirmResponse($caseId, $found)];
    }

    return ['status' => 200, 'body' => $result['response'] ?? avesmapsDiscordErrorResponse('Nicht unterstützt.')];
}
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/_internal/discord/endpoint.php tests/discord/test_endpoint.php
git commit -m "$(printf 'feat(discord-bot): request processor (signature gate + case dispatch)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 10: Public interactions endpoint

**Files:** Create `api/discord/interactions.php`.

**Interfaces:** Consumes bootstrap + all discord internals. Wires a lazy PDO/store + poster into `$deps` (so PING/hilfe never touch the DB).

- [ ] **Step 1: Write the endpoint**

Create `api/discord/interactions.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/signature.php';
require __DIR__ . '/../_internal/discord/faq.php';
require __DIR__ . '/../_internal/discord/store.php';
require __DIR__ . '/../_internal/discord/responses.php';
require __DIR__ . '/../_internal/discord/router.php';
require __DIR__ . '/../_internal/discord/post-message.php';
require __DIR__ . '/../_internal/discord/endpoint.php';

header('Content-Type: application/json');

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['error' => 'configuration unavailable']);
    exit;
}

$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$rawBody = file_get_contents('php://input');
if ($rawBody === false) {
    $rawBody = '';
}
$signature = (string) ($_SERVER['HTTP_X_SIGNATURE_ED25519'] ?? '');
$timestamp = (string) ($_SERVER['HTTP_X_SIGNATURE_TIMESTAMP'] ?? '');

$faq = avesmapsDiscordLoadFaq(__DIR__ . '/faq.de.json');
$botToken = (string) ($discord['bot_token'] ?? '');

// Lazily connect + heal the table only when a case operation actually needs it.
$pdo = null;
$pdoProvider = static function () use (&$pdo, $config): PDO {
    if ($pdo === null) {
        $pdo = avesmapsCreatePdo(is_array($config['database'] ?? null) ? $config['database'] : []);
        avesmapsDiscordEnsureCasesTable($pdo);
    }

    return $pdo;
};

$deps = [
    'post' => static fn(string $channelId, array $message): array => avesmapsDiscordPostMessage($botToken, $channelId, $message),
    'insert' => static function (array $case) use ($pdoProvider): int {
        $case['created_at'] = date('Y-m-d H:i:s');
        return avesmapsDiscordInsertCase($pdoProvider(), $case);
    },
    'close' => static function (int $id, string $by) use ($pdoProvider): bool {
        return avesmapsDiscordCloseCase($pdoProvider(), $id, $by, date('Y-m-d H:i:s'));
    },
];

$result = avesmapsDiscordProcessRequest($rawBody, $signature, $timestamp, $discord, $faq, $deps);

http_response_code($result['status']);
echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
```

- [ ] **Step 2: Lint + full regression**

Run: `php -l api/discord/interactions.php` → `No syntax errors detected`.
Run: `for f in tests/discord/test_*.php; do echo "== $f =="; php -d extension=sodium -d extension=curl -d extension=pdo_sqlite "$f" || exit 1; done`
Expected: every file `RESULT: ALL PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/discord/interactions.php
git commit -m "$(printf 'feat(discord-bot): public interactions endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 11: `cases-export.php` (token-gated)

**Files:** Create `api/discord/cases-export.php`.

**Interfaces:** Consumes bootstrap, `app-auth.php`, `store.php`. Emits `{ok:true,count,cases:[…]}` for a valid `app_token`, else 401.

- [ ] **Step 1: Write the endpoint**

Create `api/discord/cases-export.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';
require __DIR__ . '/../_internal/discord/store.php';

header('Content-Type: application/json');

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'configuration unavailable']);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$provided = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? ($_GET['token'] ?? ''));
if (!avesmapsDiscordCheckAppToken((string) ($discord['app_token'] ?? ''), $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

try {
    $pdo = avesmapsCreatePdo(is_array($config['database'] ?? null) ? $config['database'] : []);
    avesmapsDiscordEnsureCasesTable($pdo);
    $cases = avesmapsDiscordOpenCases($pdo);
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'store unavailable']);
    exit;
}

echo json_encode(['ok' => true, 'count' => count($cases), 'cases' => $cases], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
```

- [ ] **Step 2: Lint + commit**

Run: `php -l api/discord/cases-export.php` → `No syntax errors detected`.

```bash
git add api/discord/cases-export.php
git commit -m "$(printf 'feat(discord-bot): token-gated open-cases export endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 12: `report-post.php` (token-gated)

**Files:** Create `api/discord/report-post.php`.

**Interfaces:** Consumes bootstrap, `app-auth.php`, `post-message.php`. POST `{content?,embeds?}` → posts to `report_channel_id` via the bot token.

- [ ] **Step 1: Write the endpoint**

Create `api/discord/report-post.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';
require __DIR__ . '/../_internal/discord/post-message.php';

header('Content-Type: application/json');

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method not allowed']);
    exit;
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'configuration unavailable']);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$provided = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? ($_GET['token'] ?? ''));
if (!avesmapsDiscordCheckAppToken((string) ($discord['app_token'] ?? ''), $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

$raw = file_get_contents('php://input');
$body = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($body)) {
    $body = [];
}

$message = [];
if (isset($body['content']) && is_string($body['content']) && $body['content'] !== '') {
    $message['content'] = mb_substr($body['content'], 0, 2000);
}
if (isset($body['embeds']) && is_array($body['embeds'])) {
    $message['embeds'] = array_slice($body['embeds'], 0, 10);
}
if ($message === []) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'empty report']);
    exit;
}

$post = avesmapsDiscordPostMessage(
    (string) ($discord['bot_token'] ?? ''),
    (string) ($discord['report_channel_id'] ?? ''),
    $message
);

http_response_code($post['ok'] ? 200 : 502);
echo json_encode(['ok' => $post['ok'], 'status' => $post['status']], JSON_UNESCAPED_UNICODE);
```

- [ ] **Step 2: Lint + commit**

Run: `php -l api/discord/report-post.php` → `No syntax errors detected`.

```bash
git add api/discord/report-post.php
git commit -m "$(printf 'feat(discord-bot): token-gated report-post endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 13: Slash-command registration (CLI)

**Files:** Create `api/discord/register-commands.php`; Test `tests/discord/test_commands.php`.

**Interfaces:** Produces `avesmapsDiscordCommandDefinitions(): array` (5 commands; `erledigt` has a required integer option). CLI-only, env-or-config credentials, guild-scoped if a guild id is set.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_commands.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
define('AVESMAPS_DISCORD_REGISTER_TEST', true);
require __DIR__ . '/../../api/discord/register-commands.php';

$defs = avesmapsDiscordCommandDefinitions();
$names = array_map(static fn(array $d): string => $d['name'], $defs);
t_ok($names === ['hilfe', 'bug', 'idee', 'frage', 'erledigt'], 'five commands in order');

$erledigt = null;
foreach ($defs as $d) {
    if ($d['name'] === 'erledigt') {
        $erledigt = $d;
    }
}
t_ok($erledigt !== null && isset($erledigt['options'][0]), 'erledigt has an option');
t_eq($erledigt['options'][0]['name'], 'nummer', 'option is nummer');
t_eq($erledigt['options'][0]['type'], 4, 'option is integer');
t_ok($erledigt['options'][0]['required'] === true, 'option required');

t_done();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `api/discord/register-commands.php`**

```php
<?php

declare(strict_types=1);

function avesmapsDiscordCommandDefinitions(): array {
    return [
        ['name' => 'hilfe', 'description' => 'Interaktive Hilfe & häufige Fragen zu Avesmaps', 'type' => 1],
        ['name' => 'bug', 'description' => 'Einen Fehler auf avesmaps.de melden', 'type' => 1],
        ['name' => 'idee', 'description' => 'Eine Verbesserung für avesmaps.de vorschlagen', 'type' => 1],
        ['name' => 'frage', 'description' => 'Eine Frage zu Avesmaps stellen', 'type' => 1],
        [
            'name' => 'erledigt',
            'description' => 'Einen Fall als erledigt markieren',
            'type' => 1,
            'options' => [
                ['name' => 'nummer', 'description' => 'Die Fall-Nummer', 'type' => 4, 'required' => true],
            ],
        ],
    ];
}

if (defined('AVESMAPS_DISCORD_REGISTER_TEST')) {
    return;
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../_internal/bootstrap.php';

$discord = [];
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];
} catch (Throwable) {
    // No config on this box -> rely on env vars.
}

$applicationId = (string) (getenv('DISCORD_APPLICATION_ID') ?: ($discord['application_id'] ?? ''));
$botToken = (string) (getenv('DISCORD_BOT_TOKEN') ?: ($discord['bot_token'] ?? ''));
$guildId = (string) (getenv('DISCORD_GUILD_ID') ?: ($discord['guild_id'] ?? ''));

if ($applicationId === '' || $botToken === '') {
    fwrite(STDERR, "Missing DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN (env or config.local.php).\n");
    exit(1);
}
if (!function_exists('curl_init')) {
    fwrite(STDERR, "curl required (run with -d extension=curl).\n");
    exit(1);
}

$base = 'https://discord.com/api/v10/applications/' . rawurlencode($applicationId);
$url = $guildId !== '' ? $base . '/guilds/' . rawurlencode($guildId) . '/commands' : $base . '/commands';
$payload = json_encode(avesmapsDiscordCommandDefinitions(), JSON_UNESCAPED_UNICODE);

$handle = curl_init($url);
curl_setopt_array($handle, [
    CURLOPT_CUSTOMREQUEST => 'PUT',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['Authorization: Bot ' . $botToken, 'Content-Type: application/json'],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($handle);
$status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
$curlError = curl_error($handle);
curl_close($handle);

$scope = $guildId !== '' ? "guild {$guildId} (instant)" : 'global (up to 1h)';
fwrite(STDOUT, "Registered to {$scope}: HTTP {$status}\n" . ($curlError !== '' ? "curl error: {$curlError}\n" : '') . (string) $body . "\n");
exit($status >= 200 && $status < 300 ? 0 : 1);
```

- [ ] **Step 4: Run — expect pass. Commit:**

```bash
git add api/discord/register-commands.php tests/discord/test_commands.php
git commit -m "$(printf 'feat(discord-bot): CLI registration of 5 slash commands\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 14: Deploy + wire up + smoke (Phase 1a)

**Files:** none (deploy + Developer Portal + owner steps).

- [ ] **Step 1: Push + verify**

```bash
git push origin master
```
Verify remote SHA == local; wait ~1–2 min. `api/discord/**` + `api/_internal/discord/**` deploy automatically.

- [ ] **Step 2: 🔧 DU — `api/config.local.php` on the server**

Add the `discord` block with real values: `public_key`, `application_id`, `bot_token`, a fresh random `app_token` (e.g. `php -r "echo bin2hex(random_bytes(24));"`), the four channel ids (bugs `1523681334248079432`, ideen `1523681441177669722`, faqs `1523685730470330509`, report `1523690349816447157`), optional `guild_id`.

- [ ] **Step 3: 🔧 DU — Interactions Endpoint URL**

Developer Portal → *General Information* → **Interactions Endpoint URL** = `https://avesmaps.de/api/discord/interactions.php` → Save. (Also the server sodium probe: a successful save means signed PINGs verify on STRATO.)

- [ ] **Step 4: 🔧 DU — register commands** (PowerShell, from repo root):

```powershell
$env:DISCORD_APPLICATION_ID = "1523674862038683689"
$env:DISCORD_BOT_TOKEN = "<bot token>"
$env:DISCORD_GUILD_ID = "<server id>"
php -d extension=curl api/discord/register-commands.php
```
Expected: `Registered to guild <id> (instant): HTTP 200`.

- [ ] **Step 5: Smoke test in Discord**

- `/hilfe` → card with FAQ dropdown + 3 buttons; pick a question → answer.
- `/bug` → modal → submit → "…als Fall #N aufgenommen. 🐞" **and** an embed "🐞 Fall #N: …" appears in bugs.
- `/idee`, `/frage` → same into ideen / faqs.
- `/erledigt nummer:N` → "Fall #N als erledigt markiert. ✅".
- Verify the export endpoint (should list the still-open cases):
  `curl -s -H "X-Avesmaps-Token: <app_token>" https://avesmaps.de/api/discord/cases-export.php` → `{"ok":true,...}`.

---

## Phase 1b — scheduled Claude triage routine

This phase adds the daily report. It is **not** PHP-in-the-repo; it is a scheduled Claude routine plus its prompt. Build it after Phase 1a is live and cases are flowing.

- [ ] **Task 1b.1 — Decide the runtime.** Default: a scheduled **Claude Code routine** (use the `schedule` skill / CronCreate) running daily. Alternative if preferred: a STRATO PHP cron that calls the Claude API (separate API cost). Confirm with the owner before building.

- [ ] **Task 1b.2 — Author the routine prompt** (stored with the routine, not in the repo). It must:
  1. `GET https://avesmaps.de/api/discord/cases-export.php` with header `X-Avesmaps-Token: <app_token>` → open cases.
  2. If zero open cases: post a short "Keine offenen Fälle 🎉" and stop.
  3. Otherwise triage **in German**: group by theme; flag likely duplicates (by title/body similarity); for bugs suggest a probable cause / where to look; for questions draft a candidate answer and mark FAQ-worthy ones; for ideas cluster + note rough effort. Keep it skimmable (headings + case #N references).
  4. Compose one embed (or content ≤ 2000 chars) and `POST https://avesmaps.de/api/discord/report-post.php` with the same token header and body `{"content": "..."}` or `{"embeds":[...]}`.
  5. Never print or log the tokens.

- [ ] **Task 1b.3 — Store the routine's secrets** (the `app_token` + base URL) in the routine's own config/environment — **never** in the repo.

- [ ] **Task 1b.4 — Schedule** it daily (e.g. 07:00 local) and keep the cadence adjustable.

- [ ] **Task 1b.5 — Dry-run:** trigger the routine once manually; confirm a report lands in the report channel and reads well; tune the prompt.

---

## Self-Review

**Spec coverage:** §1–2 architecture → Tasks 4,9,10,11,12 + 1b. §3 commands (/hilfe /bug /idee /frage /erledigt) → Tasks 5,6,13. §4 store → Task 4. §5 config → Tasks 1,14. §6 intake flow → Tasks 6,9,10. §7 close flow → Tasks 6,9. §8 app endpoints → Tasks 8,11,12. §9 triage routine → Phase 1b. §10 security (signature, hash_equals token, bot token STRATO-only, CLI register) → Tasks 2,8,9,12,13. §11 testing (SQLite store, injectable deps) → Tasks 4,9. §12 owner prereqs → Task 14 + 1b.

**Placeholder scan:** every code step is complete; every command has expected output. `message_id` is a documented reserved column (populated in a later phase), not dead. ✓

**Type consistency:** `$kind` ∈ {`bug`,`idea`,`question`} across `avesmapsDiscordKindMeta`, builders, router `submit_case`, and the endpoint's insert. `$deps` keys `post`/`insert`/`close` match between `endpoint.php`, `interactions.php`, and the tests. `avesmapsDiscordPostMessage` returns `message_id`; router `close_case` → endpoint `close` dep → `avesmapsDiscordCloseCase`. Store `$case` keys match what the endpoint's `insert` closure passes (adds `created_at`). ✓

**Deploy:** `api/**` ships; `tests/**` does not; `config.local.php` excluded. ✓

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-06-discord-bot-phase1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.

**2. Inline Execution** — tasks in this session with checkpoints.

**Which approach?**
