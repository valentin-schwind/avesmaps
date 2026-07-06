# Avesmaps Discord Bot — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a thin PHP HTTP-interactions Discord bot on STRATO that answers FAQs interactively (`/hilfe`) and files bug/idea reports (`/bug`, `/idee`) into Discord channels.

**Architecture:** A single public endpoint (`api/discord/interactions.php`) verifies each request's Ed25519 signature, then delegates to pure, unit-tested functions that build Discord response envelopes. Bug/idea modals are posted to two channels via a Discord REST call with the bot token. No persistent process, no Gateway, no new server.

**Tech Stack:** PHP 8 (strict types, procedural `avesmaps*` functions matching the existing codebase), `ext-sodium` (Ed25519), `ext-curl` (REST). No build step. No external libraries.

Spec: `docs/superpowers/specs/2026-07-06-discord-bot-phase1-design.md`.

## Global Constraints

- **PHP style:** `declare(strict_types=1);`, top-level procedural functions named `avesmaps*` / `avesmapsDiscord*`. Follow `api/app/map-search.php` for house style.
- **Language:** user-facing strings in **German**; code, comments, commit messages in **English**.
- **No new dependencies.** `ext-sodium` and `ext-curl` are stock PHP extensions (present on STRATO; loaded locally via a CLI flag — see Test runner).
- **Secrets:** the bot token, channel ids, guild id, and invite link go **only** into `api/config.local.php` (gitignored, excluded from deploy) — **never** committed. Application ID `1523674862038683689` and Public Key `7281e27c…1026c3` are not secret.
- **Shared working tree:** stage **only** the exact paths listed in each task's commit step. Never `git add -A`.
- **Test runner (local):** `php -d extension=sodium -d extension=curl <file>`. Tests live under `tests/` (never deployed — not in the deploy allowlist). Deployable code lives under `api/` (the deploy allowlist ships `api/` wholesale).
- **Discord API base:** `https://discord.com/api/v10`.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

| Path | Responsibility |
|---|---|
| `api/discord/interactions.php` | Public endpoint. Reads raw body + signature headers, loads config + FAQ, delegates to `avesmapsDiscordProcessRequest`, emits the JSON response. Thin I/O glue only. |
| `api/discord/faq.de.json` | The 7 FAQ Q&A (German), owner-editable. |
| `api/discord/register-commands.php` | CLI-only script that registers the 3 slash commands with Discord. Refuses web access. |
| `api/_internal/discord/signature.php` | `avesmapsDiscordVerifySignature()` — Ed25519 verification. |
| `api/_internal/discord/faq.php` | `avesmapsDiscordLoadFaq()`, `avesmapsDiscordFaqById()`. |
| `api/_internal/discord/responses.php` | All Discord response/embed/modal/component builders + shared constants. Pure. |
| `api/_internal/discord/router.php` | `avesmapsDiscordRouteInteraction()` — maps a decoded interaction to a decision (respond / post_then_respond). Pure. |
| `api/_internal/discord/post-message.php` | `avesmapsDiscordPostMessage()` — REST POST of a message to a channel (curl). |
| `api/_internal/discord/endpoint.php` | `avesmapsDiscordProcessRequest()` — signature gate + JSON decode + dispatch, with an injectable poster for testability. |
| `config/api.config.example.php` | Documentation: add an empty `discord` block. |
| `tests/discord/_assert.php` | Tiny assertion helper for the test scripts. |
| `tests/discord/test_*.php` | One test script per module. |

`api/_internal/**` is already `.htaccess`-denied to the web; the endpoint still `require`s those files server-side (a PHP include is unaffected by the deny). `interactions.php` sits in the public `api/discord/`.

---

### Task 1: Test harness + config block

**Files:**
- Create: `tests/discord/_assert.php`
- Modify: `config/api.config.example.php`

**Interfaces:**
- Produces: `t_ok(bool, string): void`, `t_eq(mixed, mixed, string): void`, `t_done(): void` — used by every later test script.

- [ ] **Step 1: Write the assertion helper**

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
    $ok = $actual === $expected;
    if ($ok) {
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

- [ ] **Step 2: Verify the helper loads and passes**

Run: `php -d extension=sodium -d extension=curl -r "require 'tests/discord/_assert.php'; t_ok(true, 'harness works'); t_done();"`
Expected: prints `PASS: harness works` and `RESULT: ALL PASS`, exit 0.

- [ ] **Step 3: Add the `discord` config block to the example**

In `config/api.config.example.php`, insert before the closing `];` (after the `import_api` block):

```php
    'discord' => [
        'public_key' => 'replace-with-the-application-public-key',
        'application_id' => 'replace-with-the-application-id',
        'bot_token' => 'replace-with-the-bot-token-SECRET',
        'bug_channel_id' => 'replace-with-the-bug-channel-id',
        'idea_channel_id' => 'replace-with-the-idea-channel-id',
        // Optional: set guild_id (your server id) so register-commands registers
        // guild-scoped commands, which appear instantly instead of up to 1h.
        'guild_id' => '',
    ],
```

- [ ] **Step 4: Lint the example config**

Run: `php -l config/api.config.example.php`
Expected: `No syntax errors detected in config/api.config.example.php`.

- [ ] **Step 5: Commit**

```bash
git add tests/discord/_assert.php config/api.config.example.php
git commit -m "$(printf 'chore(discord-bot): test harness + discord config block\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Ed25519 signature verification

**Files:**
- Create: `api/_internal/discord/signature.php`
- Test: `tests/discord/test_signature.php`

**Interfaces:**
- Produces: `avesmapsDiscordVerifySignature(string $publicKeyHex, string $signatureHex, string $timestamp, string $rawBody): bool` — returns `true` only for a valid signature; fails closed if sodium is missing or inputs are malformed.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_signature.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/signature.php';

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded (run with -d extension=sodium)\n");
    exit(0);
}

$keypair = sodium_crypto_sign_keypair();
$publicKeyHex = bin2hex(sodium_crypto_sign_publickey($keypair));
$secretKey = sodium_crypto_sign_secretkey($keypair);

$timestamp = '1700000000';
$body = '{"type":1}';
$signatureHex = bin2hex(sodium_crypto_sign_detached($timestamp . $body, $secretKey));

t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, $timestamp, $body) === true, 'valid signature verifies');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, $timestamp, $body . 'x') === false, 'tampered body rejected');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, '1700000001', $body) === false, 'wrong timestamp rejected');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, 'zzzz', $timestamp, $body) === false, 'non-hex signature rejected');
t_ok(avesmapsDiscordVerifySignature('', $signatureHex, $timestamp, $body) === false, 'empty public key rejected');

t_done();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_signature.php`
Expected: FAIL — fatal error `Call to undefined function avesmapsDiscordVerifySignature()`.

- [ ] **Step 3: Write the implementation**

Create `api/_internal/discord/signature.php`:

```php
<?php

declare(strict_types=1);

/**
 * Verify a Discord interaction request signature (Ed25519).
 *
 * Discord signs `timestamp + rawBody` with the application's private key; we
 * verify against the public key from the Developer Portal. Fails closed on any
 * malformed input or missing libsodium.
 */
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_signature.php`
Expected: 5× `PASS`, then `RESULT: ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/discord/signature.php tests/discord/test_signature.php
git commit -m "$(printf 'feat(discord-bot): Ed25519 request signature verification\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: FAQ data + loader

**Files:**
- Create: `api/discord/faq.de.json`
- Create: `api/_internal/discord/faq.php`
- Test: `tests/discord/test_faq.php`

**Interfaces:**
- Produces: `avesmapsDiscordLoadFaq(string $path): array` (list of `['id'=>string,'q'=>string,'a'=>string]`), `avesmapsDiscordFaqById(array $faq, string $id): ?array`.

- [ ] **Step 1: Create the FAQ data**

Create `api/discord/faq.de.json` (the 7 answers mirror `index.html`'s FAQ):

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

t_eq(count($faq), 7, 'loads 7 FAQ entries');
t_eq($faq[0]['id'], 'was-ist-avesmaps', 'first entry id');

$item = avesmapsDiscordFaqById($faq, 'kostenlos');
t_ok($item !== null && str_starts_with($item['a'], 'Ja.'), 'lookup by id returns the answer');
t_eq(avesmapsDiscordFaqById($faq, 'does-not-exist'), null, 'unknown id returns null');
t_eq(avesmapsDiscordLoadFaq(__DIR__ . '/nope.json'), [], 'missing file returns empty list');

t_done();
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_faq.php`
Expected: FAIL — `Call to undefined function avesmapsDiscordLoadFaq()`.

- [ ] **Step 4: Write the implementation**

Create `api/_internal/discord/faq.php`:

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

- [ ] **Step 5: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_faq.php`
Expected: all `PASS`, `RESULT: ALL PASS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/discord/faq.de.json api/_internal/discord/faq.php tests/discord/test_faq.php
git commit -m "$(printf 'feat(discord-bot): FAQ data + loader\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Response / embed / modal builders

**Files:**
- Create: `api/_internal/discord/responses.php`
- Test: `tests/discord/test_responses.php`

**Interfaces:**
- Produces (constants): `AVESMAPS_DISCORD_HELP_SELECT_ID`, `AVESMAPS_DISCORD_BUG_BUTTON_ID`, `AVESMAPS_DISCORD_IDEA_BUTTON_ID`, `AVESMAPS_DISCORD_BUG_MODAL_ID`, `AVESMAPS_DISCORD_IDEA_MODAL_ID`, `AVESMAPS_DISCORD_EPHEMERAL_FLAG` (=64), response-type constants `AVESMAPS_DISCORD_PONG` (=1), `AVESMAPS_DISCORD_CHANNEL_MESSAGE` (=4), `AVESMAPS_DISCORD_MODAL` (=9).
- Produces (functions): `avesmapsDiscordPongResponse(): array`, `avesmapsDiscordHelpResponse(array $faq): array`, `avesmapsDiscordFaqAnswerResponse(array $item): array`, `avesmapsDiscordUnknownAnswerResponse(): array`, `avesmapsDiscordBugModal(): array`, `avesmapsDiscordIdeaModal(): array`, `avesmapsDiscordFeedbackMessage(string $kind, array $values, string $reporter): array`, `avesmapsDiscordConfirmResponse(string $kind): array`, `avesmapsDiscordErrorResponse(string $message): array`, `avesmapsDiscordTruncate(string $text, int $max): string`. `$kind` is `'bug'` or `'idea'`.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_responses.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';

$faq = [
    ['id' => 'a', 'q' => 'Frage A?', 'a' => 'Antwort A.'],
    ['id' => 'b', 'q' => 'Frage B?', 'a' => 'Antwort B.'],
];

// Help response: ephemeral message with a select of the FAQ + two buttons.
$help = avesmapsDiscordHelpResponse($faq);
t_eq($help['type'], AVESMAPS_DISCORD_CHANNEL_MESSAGE, 'help is a channel message');
t_eq($help['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'help is ephemeral');
$select = $help['data']['components'][0]['components'][0];
t_eq($select['type'], 3, 'first component is a string select');
t_eq($select['custom_id'], AVESMAPS_DISCORD_HELP_SELECT_ID, 'select custom_id');
t_eq(count($select['options']), 2, 'select has one option per FAQ entry');
t_eq($select['options'][0]['value'], 'a', 'option value is the FAQ id');
$buttons = $help['data']['components'][1]['components'];
t_eq($buttons[0]['custom_id'], AVESMAPS_DISCORD_BUG_BUTTON_ID, 'bug button present');
t_eq($buttons[1]['custom_id'], AVESMAPS_DISCORD_IDEA_BUTTON_ID, 'idea button present');

// FAQ answer.
$answer = avesmapsDiscordFaqAnswerResponse($faq[0]);
t_eq($answer['data']['embeds'][0]['title'], 'Frage A?', 'answer title is the question');
t_eq($answer['data']['embeds'][0]['description'], 'Antwort A.', 'answer body is the answer');
t_eq($answer['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'answer is ephemeral');

// Bug modal.
$modal = avesmapsDiscordBugModal();
t_eq($modal['type'], AVESMAPS_DISCORD_MODAL, 'bug modal type');
t_eq($modal['data']['custom_id'], AVESMAPS_DISCORD_BUG_MODAL_ID, 'bug modal custom_id');
t_eq(count($modal['data']['components']), 3, 'modal has 3 inputs');
$titleInput = $modal['data']['components'][0]['components'][0];
t_eq($titleInput['type'], 4, 'input is a text input');
t_eq($titleInput['custom_id'], 'title', 'first input is title');
t_ok($titleInput['required'] === true, 'title is required');
$locationInput = $modal['data']['components'][2]['components'][0];
t_ok($locationInput['required'] === false, 'location is optional');

// Feedback message posted to a channel.
$message = avesmapsDiscordFeedbackMessage('bug', ['title' => 'Absturz', 'description' => 'Karte hängt', 'location' => 'Gareth'], 'valente');
$embed = $message['embeds'][0];
t_ok(str_contains($embed['title'], 'Absturz'), 'feedback title contains the user title');
t_eq($embed['description'], 'Karte hängt', 'feedback description');
$fieldNames = array_map(static fn(array $f): string => $f['name'], $embed['fields']);
t_ok(in_array('Wo?', $fieldNames, true), 'location field present when given');
t_ok(in_array('Von', $fieldNames, true), 'reporter field present');

// Location omitted -> no "Wo?" field.
$noLoc = avesmapsDiscordFeedbackMessage('idea', ['title' => 'X', 'description' => 'Y', 'location' => ''], 'u');
$noLocFields = array_map(static fn(array $f): string => $f['name'], $noLoc['embeds'][0]['fields']);
t_ok(!in_array('Wo?', $noLocFields, true), 'no location field when empty');

// Truncation.
t_eq(mb_strlen(avesmapsDiscordTruncate(str_repeat('x', 300), 100)), 100, 'truncates to max length');

t_done();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_responses.php`
Expected: FAIL — `Call to undefined function avesmapsDiscordHelpResponse()`.

- [ ] **Step 3: Write the implementation**

Create `api/_internal/discord/responses.php`:

```php
<?php

declare(strict_types=1);

const AVESMAPS_DISCORD_HELP_SELECT_ID = 'help_faq_select';
const AVESMAPS_DISCORD_BUG_BUTTON_ID = 'open_bug_modal';
const AVESMAPS_DISCORD_IDEA_BUTTON_ID = 'open_idea_modal';
const AVESMAPS_DISCORD_BUG_MODAL_ID = 'bug_modal';
const AVESMAPS_DISCORD_IDEA_MODAL_ID = 'idea_modal';

const AVESMAPS_DISCORD_EPHEMERAL_FLAG = 64;

const AVESMAPS_DISCORD_PONG = 1;
const AVESMAPS_DISCORD_CHANNEL_MESSAGE = 4;
const AVESMAPS_DISCORD_MODAL = 9;

const AVESMAPS_DISCORD_COLOR = 0x2E7D64;
const AVESMAPS_DISCORD_COLOR_BUG = 0xC0392B;
const AVESMAPS_DISCORD_COLOR_IDEA = 0xF1C40F;

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
        ],
    ];

    return avesmapsDiscordEphemeralMessage([
        'embeds' => [[
            'title' => 'Avesmaps-Hilfe',
            'description' => 'Wähle unten eine häufige Frage aus – oder melde einen Bug bzw. reiche eine Idee ein.',
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
    return avesmapsDiscordEphemeralMessage([
        'content' => 'Zu dieser Auswahl habe ich leider keine Antwort gefunden.',
    ]);
}

function avesmapsDiscordFeedbackModal(string $customId, string $title): array {
    return [
        'type' => AVESMAPS_DISCORD_MODAL,
        'data' => [
            'custom_id' => $customId,
            'title' => avesmapsDiscordTruncate($title, 45),
            'components' => [
                ['type' => 1, 'components' => [[
                    'type' => 4, 'custom_id' => 'title', 'style' => 1,
                    'label' => 'Titel / Kurzfassung', 'required' => true, 'max_length' => 100,
                ]]],
                ['type' => 1, 'components' => [[
                    'type' => 4, 'custom_id' => 'description', 'style' => 2,
                    'label' => 'Beschreibung', 'required' => true, 'max_length' => 1500,
                ]]],
                ['type' => 1, 'components' => [[
                    'type' => 4, 'custom_id' => 'location', 'style' => 1,
                    'label' => 'Wo? (URL oder Ort, optional)', 'required' => false, 'max_length' => 300,
                ]]],
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

function avesmapsDiscordFeedbackMessage(string $kind, array $values, string $reporter): array {
    $isBug = $kind === 'bug';
    $title = avesmapsDiscordTruncate((string) ($values['title'] ?? ''), 200);
    $description = avesmapsDiscordTruncate((string) ($values['description'] ?? ''), 4000);
    $location = trim((string) ($values['location'] ?? ''));

    $fields = [];
    if ($location !== '') {
        $fields[] = ['name' => 'Wo?', 'value' => avesmapsDiscordTruncate($location, 1024), 'inline' => false];
    }
    $fields[] = ['name' => 'Von', 'value' => avesmapsDiscordTruncate($reporter, 256), 'inline' => false];

    $prefix = $isBug ? '🐞 ' : '💡 ';
    $fallback = $isBug ? 'Bug' : 'Idee';

    return [
        'embeds' => [[
            'title' => $prefix . ($title !== '' ? $title : $fallback),
            'description' => $description,
            'color' => $isBug ? AVESMAPS_DISCORD_COLOR_BUG : AVESMAPS_DISCORD_COLOR_IDEA,
            'fields' => $fields,
        ]],
    ];
}

function avesmapsDiscordConfirmResponse(string $kind): array {
    $text = $kind === 'bug'
        ? 'Danke! Dein Bug wurde weitergegeben. 🐞'
        : 'Danke! Deine Idee wurde weitergegeben. 💡';

    return avesmapsDiscordEphemeralMessage(['content' => $text]);
}

function avesmapsDiscordErrorResponse(string $message): array {
    return avesmapsDiscordEphemeralMessage(['content' => $message]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_responses.php`
Expected: all `PASS`, `RESULT: ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/discord/responses.php tests/discord/test_responses.php
git commit -m "$(printf 'feat(discord-bot): response, embed and modal builders\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Interaction router

**Files:**
- Create: `api/_internal/discord/router.php`
- Test: `tests/discord/test_router.php`

**Interfaces:**
- Consumes: everything from `responses.php` and `faq.php`.
- Produces: `avesmapsDiscordRouteInteraction(array $interaction, array $faq, array $discordConfig): array`. Returns either `['type'=>'respond','response'=>array]` or `['type'=>'post_then_respond','channel_id'=>string,'message'=>array,'response'=>array]`. Also `avesmapsDiscordExtractReporter(array $interaction): string` and `avesmapsDiscordModalValues(array $interaction): array` (custom_id => value).

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
$config = ['bug_channel_id' => '111', 'idea_channel_id' => '222'];

// PING.
$ping = avesmapsDiscordRouteInteraction(['type' => 1], $faq, $config);
t_eq($ping['response']['type'], AVESMAPS_DISCORD_PONG, 'PING routes to PONG');

// /hilfe command.
$help = avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'hilfe']], $faq, $config);
t_eq($help['response']['data']['components'][0]['components'][0]['custom_id'], AVESMAPS_DISCORD_HELP_SELECT_ID, '/hilfe returns the help menu');

// /bug command -> modal.
$bug = avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'bug']], $faq, $config);
t_eq($bug['response']['type'], AVESMAPS_DISCORD_MODAL, '/bug opens a modal');
t_eq($bug['response']['data']['custom_id'], AVESMAPS_DISCORD_BUG_MODAL_ID, '/bug opens the bug modal');

// Select menu pick -> answer.
$pick = avesmapsDiscordRouteInteraction(
    ['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_HELP_SELECT_ID, 'values' => ['kostenlos']]],
    $faq,
    $config
);
t_eq($pick['response']['data']['embeds'][0]['title'], 'Ist Avesmaps kostenlos?', 'select pick returns the answer');

// Idea button -> idea modal.
$ideaBtn = avesmapsDiscordRouteInteraction(
    ['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_IDEA_BUTTON_ID]],
    $faq,
    $config
);
t_eq($ideaBtn['response']['data']['custom_id'], AVESMAPS_DISCORD_IDEA_MODAL_ID, 'idea button opens the idea modal');

// Bug modal submit -> post to bug channel.
$submit = avesmapsDiscordRouteInteraction([
    'type' => 5,
    'data' => [
        'custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID,
        'components' => [
            ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Absturz']]],
            ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Karte hängt']]],
            ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'location', 'value' => '']]],
        ],
    ],
    'member' => ['user' => ['username' => 'valente', 'global_name' => 'Valente']],
], $faq, $config);
t_eq($submit['type'], 'post_then_respond', 'modal submit posts then responds');
t_eq($submit['channel_id'], '111', 'bug submit targets the bug channel');
t_ok(str_contains($submit['message']['embeds'][0]['title'], 'Absturz'), 'posted embed contains the title');
t_ok(str_contains($submit['response']['data']['content'], 'Danke'), 'user gets a confirmation');

// Reporter + modal value helpers.
t_eq(avesmapsDiscordExtractReporter(['user' => ['username' => 'x']]), 'x', 'reporter from user.username');

t_done();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_router.php`
Expected: FAIL — `Call to undefined function avesmapsDiscordRouteInteraction()`.

- [ ] **Step 3: Write the implementation**

Create `api/_internal/discord/router.php`:

```php
<?php

declare(strict_types=1);

// Depends on responses.php + faq.php being loaded by the caller.

function avesmapsDiscordExtractReporter(array $interaction): string {
    $user = $interaction['member']['user'] ?? $interaction['user'] ?? [];
    if (!is_array($user)) {
        return 'Unbekannt';
    }
    $name = (string) ($user['global_name'] ?? $user['username'] ?? '');

    return $name !== '' ? $name : 'Unbekannt';
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

function avesmapsDiscordRespond(array $response): array {
    return ['type' => 'respond', 'response' => $response];
}

function avesmapsDiscordRouteInteraction(array $interaction, array $faq, array $discordConfig): array {
    $type = (int) ($interaction['type'] ?? 0);

    if ($type === 1) {
        return avesmapsDiscordRespond(avesmapsDiscordPongResponse());
    }

    if ($type === 2) {
        $name = (string) ($interaction['data']['name'] ?? '');

        return match ($name) {
            'hilfe' => avesmapsDiscordRespond(avesmapsDiscordHelpResponse($faq)),
            'bug' => avesmapsDiscordRespond(avesmapsDiscordBugModal()),
            'idee' => avesmapsDiscordRespond(avesmapsDiscordIdeaModal()),
            default => avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekannter Befehl.')),
        };
    }

    if ($type === 3) {
        $customId = (string) ($interaction['data']['custom_id'] ?? '');

        if ($customId === AVESMAPS_DISCORD_HELP_SELECT_ID) {
            $selected = (string) (($interaction['data']['values'][0]) ?? '');
            $item = avesmapsDiscordFaqById($faq, $selected);

            return avesmapsDiscordRespond(
                $item !== null
                    ? avesmapsDiscordFaqAnswerResponse($item)
                    : avesmapsDiscordUnknownAnswerResponse()
            );
        }
        if ($customId === AVESMAPS_DISCORD_BUG_BUTTON_ID) {
            return avesmapsDiscordRespond(avesmapsDiscordBugModal());
        }
        if ($customId === AVESMAPS_DISCORD_IDEA_BUTTON_ID) {
            return avesmapsDiscordRespond(avesmapsDiscordIdeaModal());
        }

        return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekannte Aktion.'));
    }

    if ($type === 5) {
        $customId = (string) ($interaction['data']['custom_id'] ?? '');
        $kind = match ($customId) {
            AVESMAPS_DISCORD_BUG_MODAL_ID => 'bug',
            AVESMAPS_DISCORD_IDEA_MODAL_ID => 'idea',
            default => '',
        };
        if ($kind === '') {
            return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekanntes Formular.'));
        }

        $channelId = (string) ($kind === 'bug'
            ? ($discordConfig['bug_channel_id'] ?? '')
            : ($discordConfig['idea_channel_id'] ?? ''));
        $values = avesmapsDiscordModalValues($interaction);
        $reporter = avesmapsDiscordExtractReporter($interaction);

        return [
            'type' => 'post_then_respond',
            'channel_id' => $channelId,
            'message' => avesmapsDiscordFeedbackMessage($kind, $values, $reporter),
            'response' => avesmapsDiscordConfirmResponse($kind),
        ];
    }

    return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Nicht unterstützt.'));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_router.php`
Expected: all `PASS`, `RESULT: ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/discord/router.php tests/discord/test_router.php
git commit -m "$(printf 'feat(discord-bot): interaction router (commands, components, modals)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Channel message POST (curl)

**Files:**
- Create: `api/_internal/discord/post-message.php`
- Test: `tests/discord/test_post_message.php`

**Interfaces:**
- Produces: `avesmapsDiscordPostMessage(string $botToken, string $channelId, array $message): array` returning `['ok'=>bool,'status'=>int,'error'=>string]`. Only the guard behaviour is unit-tested; the live POST is exercised by the Task 10 smoke test.

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_post_message.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/post-message.php';

$noToken = avesmapsDiscordPostMessage('', '123', ['content' => 'x']);
t_ok($noToken['ok'] === false, 'missing token -> not ok');

$noChannel = avesmapsDiscordPostMessage('token', '', ['content' => 'x']);
t_ok($noChannel['ok'] === false, 'missing channel -> not ok');

t_done();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_post_message.php`
Expected: FAIL — `Call to undefined function avesmapsDiscordPostMessage()`.

- [ ] **Step 3: Write the implementation**

Create `api/_internal/discord/post-message.php`:

```php
<?php

declare(strict_types=1);

const AVESMAPS_DISCORD_API_BASE = 'https://discord.com/api/v10';

function avesmapsDiscordPostMessage(string $botToken, string $channelId, array $message): array {
    if ($botToken === '' || $channelId === '') {
        return ['ok' => false, 'status' => 0, 'error' => 'missing token or channel'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'error' => 'curl unavailable'];
    }

    $url = AVESMAPS_DISCORD_API_BASE . '/channels/' . rawurlencode($channelId) . '/messages';
    $payload = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return ['ok' => false, 'status' => 0, 'error' => 'payload encode failed'];
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

    return [
        'ok' => $ok,
        'status' => $status,
        'error' => $ok ? '' : ($curlError !== '' ? $curlError : (string) $body),
    ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_post_message.php`
Expected: all `PASS`, `RESULT: ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/discord/post-message.php tests/discord/test_post_message.php
git commit -m "$(printf 'feat(discord-bot): REST channel message POST\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Request processor (signature gate + dispatch)

**Files:**
- Create: `api/_internal/discord/endpoint.php`
- Test: `tests/discord/test_endpoint.php`

**Interfaces:**
- Consumes: `avesmapsDiscordVerifySignature`, `avesmapsDiscordRouteInteraction`, `avesmapsDiscordErrorResponse`.
- Produces: `avesmapsDiscordProcessRequest(string $rawBody, string $signatureHex, string $timestampHeader, array $discordConfig, array $faq, callable $poster): array` returning `['status'=>int,'body'=>array]`. `$poster` has signature `fn(string $channelId, array $message): array` (returns `['ok'=>bool,...]`) so tests can inject a fake and avoid network calls.

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

$faq = [['id' => 'kostenlos', 'q' => 'Ist Avesmaps kostenlos?', 'a' => 'Ja.']];
$neverPost = static fn(string $channelId, array $message): array => ['ok' => true];

// Invalid signature -> 401 (works without sodium: verify fails closed).
$bad = avesmapsDiscordProcessRequest('{"type":1}', 'deadbeef', '123', ['public_key' => 'aa'], $faq, $neverPost);
t_eq($bad['status'], 401, 'invalid signature -> 401');

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded; signed-path checks skipped\n");
    t_done();
}

$keypair = sodium_crypto_sign_keypair();
$publicKeyHex = bin2hex(sodium_crypto_sign_publickey($keypair));
$secretKey = sodium_crypto_sign_secretkey($keypair);
$config = ['public_key' => $publicKeyHex, 'bug_channel_id' => '111', 'idea_channel_id' => '222'];

$sign = static function (string $body) use ($secretKey): array {
    $ts = '1700000000';
    return [$ts, bin2hex(sodium_crypto_sign_detached($ts . $body, $secretKey))];
};

// Valid PING -> 200 PONG.
$pingBody = '{"type":1}';
[$ts, $sig] = $sign($pingBody);
$ping = avesmapsDiscordProcessRequest($pingBody, $sig, $ts, $config, $faq, $neverPost);
t_eq($ping['status'], 200, 'valid PING -> 200');
t_eq($ping['body']['type'], AVESMAPS_DISCORD_PONG, 'valid PING -> PONG body');

// Modal submit -> poster invoked with the bug channel, user gets confirmation.
$captured = ['channel' => null, 'message' => null];
$poster = static function (string $channelId, array $message) use (&$captured): array {
    $captured['channel'] = $channelId;
    $captured['message'] = $message;
    return ['ok' => true, 'status' => 200, 'error' => ''];
};
$submitBody = json_encode([
    'type' => 5,
    'data' => [
        'custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID,
        'components' => [
            ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Absturz']]],
            ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Hängt']]],
        ],
    ],
    'member' => ['user' => ['username' => 'valente']],
], JSON_UNESCAPED_UNICODE);
[$ts2, $sig2] = $sign($submitBody);
$submit = avesmapsDiscordProcessRequest($submitBody, $sig2, $ts2, $config, $faq, $poster);
t_eq($submit['status'], 200, 'modal submit -> 200');
t_eq($captured['channel'], '111', 'poster called with the bug channel id');
t_ok(str_contains($submit['body']['data']['content'], 'Danke'), 'user gets a confirmation');

// Poster failure -> user gets a soft error, still 200.
$failPoster = static fn(string $channelId, array $message): array => ['ok' => false, 'status' => 500, 'error' => 'boom'];
[$ts3, $sig3] = $sign($submitBody);
$failed = avesmapsDiscordProcessRequest($submitBody, $sig3, $ts3, $config, $faq, $failPoster);
t_eq($failed['status'], 200, 'poster failure still returns 200');
t_ok(str_contains($failed['body']['data']['content'], 'später'), 'poster failure -> soft error message');

t_done();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_endpoint.php`
Expected: FAIL — `Call to undefined function avesmapsDiscordProcessRequest()`.

- [ ] **Step 3: Write the implementation**

Create `api/_internal/discord/endpoint.php`:

```php
<?php

declare(strict_types=1);

// Depends on signature.php + responses.php + router.php being loaded by the caller.

function avesmapsDiscordProcessRequest(
    string $rawBody,
    string $signatureHex,
    string $timestampHeader,
    array $discordConfig,
    array $faq,
    callable $poster
): array {
    $publicKey = (string) ($discordConfig['public_key'] ?? '');

    if (!avesmapsDiscordVerifySignature($publicKey, $signatureHex, $timestampHeader, $rawBody)) {
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

    if (($result['type'] ?? '') === 'post_then_respond') {
        $post = $poster(
            (string) ($result['channel_id'] ?? ''),
            is_array($result['message'] ?? null) ? $result['message'] : []
        );
        $ok = is_array($post) ? (bool) ($post['ok'] ?? false) : (bool) $post;

        $body = $ok
            ? ($result['response'] ?? avesmapsDiscordErrorResponse('Nicht unterstützt.'))
            : avesmapsDiscordErrorResponse('Konnte gerade nicht weitergeleitet werden – bitte später erneut versuchen.');

        return ['status' => 200, 'body' => $body];
    }

    return ['status' => 200, 'body' => $result['response'] ?? avesmapsDiscordErrorResponse('Nicht unterstützt.')];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_endpoint.php`
Expected: all `PASS` (or PASS + SKIP if sodium somehow off), `RESULT: ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/discord/endpoint.php tests/discord/test_endpoint.php
git commit -m "$(printf 'feat(discord-bot): request processor with signature gate\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: Public endpoint (I/O wiring)

**Files:**
- Create: `api/discord/interactions.php`

**Interfaces:**
- Consumes: `avesmapsLoadApiConfig`, `avesmapsApiRoot` (bootstrap), `avesmapsDiscordLoadFaq`, `avesmapsDiscordProcessRequest`, `avesmapsDiscordPostMessage`. No new symbols produced (thin glue verified by lint + the Task 10 smoke test).

- [ ] **Step 1: Write the endpoint**

Create `api/discord/interactions.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/signature.php';
require __DIR__ . '/../_internal/discord/faq.php';
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

$poster = static function (string $channelId, array $message) use ($botToken): array {
    return avesmapsDiscordPostMessage($botToken, $channelId, $message);
};

$result = avesmapsDiscordProcessRequest($rawBody, $signature, $timestamp, $discord, $faq, $poster);

http_response_code($result['status']);
echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
```

- [ ] **Step 2: Lint the endpoint**

Run: `php -l api/discord/interactions.php`
Expected: `No syntax errors detected in api/discord/interactions.php`.

- [ ] **Step 3: Re-run the whole suite (regression)**

Run: `for f in tests/discord/test_*.php; do echo "== $f =="; php -d extension=sodium -d extension=curl "$f" || exit 1; done`
Expected: every file ends `RESULT: ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add api/discord/interactions.php
git commit -m "$(printf 'feat(discord-bot): public interactions endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 9: Slash-command registration (CLI)

**Files:**
- Create: `api/discord/register-commands.php`
- Test: `tests/discord/test_commands.php`

**Interfaces:**
- Produces: `avesmapsDiscordCommandDefinitions(): array` — the 3 command definitions. The script is CLI-only, refuses web access, reads credentials from env vars (preferred) or config, and PUTs the definitions to Discord (guild-scoped if `guild_id`/`DISCORD_GUILD_ID` is set, else global).

- [ ] **Step 1: Write the failing test**

Create `tests/discord/test_commands.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';

// The script is CLI-guarded and network-bound; load only the pure definitions
// function by requiring the file in a mode where it does not execute the
// registration (guarded by AVESMAPS_DISCORD_REGISTER_TEST).
define('AVESMAPS_DISCORD_REGISTER_TEST', true);
require __DIR__ . '/../../api/discord/register-commands.php';

$defs = avesmapsDiscordCommandDefinitions();
t_eq(count($defs), 3, 'three commands defined');
$names = array_map(static fn(array $d): string => $d['name'], $defs);
t_ok($names === ['hilfe', 'bug', 'idee'], 'commands are hilfe, bug, idee');
foreach ($defs as $def) {
    t_ok(($def['description'] ?? '') !== '', "command {$def['name']} has a description");
    t_ok(mb_strlen((string) $def['name']) <= 32 && (string) $def['name'] === mb_strtolower((string) $def['name']), "command {$def['name']} name is valid");
}

t_done();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_commands.php`
Expected: FAIL — `failed to open ... register-commands.php` or `undefined function avesmapsDiscordCommandDefinitions()`.

- [ ] **Step 3: Write the implementation**

Create `api/discord/register-commands.php`:

```php
<?php

declare(strict_types=1);

function avesmapsDiscordCommandDefinitions(): array {
    return [
        ['name' => 'hilfe', 'description' => 'Interaktive Hilfe & häufige Fragen zu Avesmaps', 'type' => 1],
        ['name' => 'bug', 'description' => 'Einen Fehler auf avesmaps.de melden', 'type' => 1],
        ['name' => 'idee', 'description' => 'Eine Verbesserung für avesmaps.de vorschlagen', 'type' => 1],
    ];
}

// Allow the test harness to load only the definitions function.
if (defined('AVESMAPS_DISCORD_REGISTER_TEST')) {
    return;
}

// Never runnable from the web.
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
    // No config file (e.g. running from a dev box) -> rely on env vars below.
}

$applicationId = (string) (getenv('DISCORD_APPLICATION_ID') ?: ($discord['application_id'] ?? ''));
$botToken = (string) (getenv('DISCORD_BOT_TOKEN') ?: ($discord['bot_token'] ?? ''));
$guildId = (string) (getenv('DISCORD_GUILD_ID') ?: ($discord['guild_id'] ?? ''));

if ($applicationId === '' || $botToken === '') {
    fwrite(STDERR, "Missing application id or bot token (set DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN or config.local.php).\n");
    exit(1);
}
if (!function_exists('curl_init')) {
    fwrite(STDERR, "curl extension is required (run with -d extension=curl).\n");
    exit(1);
}

$base = 'https://discord.com/api/v10/applications/' . rawurlencode($applicationId);
$url = $guildId !== ''
    ? $base . '/guilds/' . rawurlencode($guildId) . '/commands'
    : $base . '/commands';

$payload = json_encode(avesmapsDiscordCommandDefinitions(), JSON_UNESCAPED_UNICODE);

$handle = curl_init($url);
curl_setopt_array($handle, [
    CURLOPT_CUSTOMREQUEST => 'PUT', // bulk overwrite
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bot ' . $botToken,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($handle);
$status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
$curlError = curl_error($handle);
curl_close($handle);

$scope = $guildId !== '' ? "guild {$guildId} (instant)" : 'global (up to 1h to appear)';
fwrite(STDOUT, "Registered commands to {$scope}: HTTP {$status}\n");
if ($curlError !== '') {
    fwrite(STDERR, "curl error: {$curlError}\n");
}
fwrite(STDOUT, (string) $body . "\n");

exit($status >= 200 && $status < 300 ? 0 : 1);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d extension=sodium -d extension=curl tests/discord/test_commands.php`
Expected: all `PASS`, `RESULT: ALL PASS`, exit 0.

- [ ] **Step 5: Verify the web guard (manual reasoning check)**

Run: `php -l api/discord/register-commands.php`
Expected: `No syntax errors detected`. (Web access returns 404 because `PHP_SAPI !== 'cli'`; the registration block never runs under the test flag or the web.)

- [ ] **Step 6: Commit**

```bash
git add api/discord/register-commands.php tests/discord/test_commands.php
git commit -m "$(printf 'feat(discord-bot): CLI slash-command registration\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 10: Deploy, wire up, and smoke test

**Files:** none (deploy + Discord Developer Portal + owner steps).

This task has no unit test; its deliverable is a working bot in the server, verified by a live smoke test.

- [ ] **Step 1: Push to master (auto-deploy)**

```bash
git push origin master
```
Then verify the remote SHA matches local `git rev-parse HEAD`, and wait ~1–2 min for the STRATO auto-deploy. `api/discord/**` and `api/_internal/discord/**` deploy automatically (allowlist ships `api/`).

- [ ] **Step 2: 🔧 DU — fill `api/config.local.php` on the server**

On STRATO (hosting file manager / SFTP), edit `api/config.local.php` and add the `discord` block with the **real** values:

```php
'discord' => [
    'public_key' => '7281e27c5b0947466341fd66f655e80d011700e3f131fccc58e3ede42d1026c3',
    'application_id' => '1523674862038683689',
    'bot_token' => '<the secret bot token>',
    'bug_channel_id' => '1523681334248079432',
    'idea_channel_id' => '1523681441177669722',
    'guild_id' => '<optional: your server id for instant command registration>',
],
```

- [ ] **Step 3: 🔧 DU — set the Interactions Endpoint URL**

Developer Portal → your app → *General Information* → **Interactions Endpoint URL** =
`https://avesmaps.de/api/discord/interactions.php` → **Save**.

**This is also the server sodium probe:** Discord immediately sends a signed PING; a successful save proves `ext-sodium` + the endpoint work on STRATO. If saving fails, check that `api/config.local.php` has the correct `public_key` and that the file deployed.

- [ ] **Step 4: 🔧 DU — register the slash commands**

From the repo root on your Windows box (PowerShell), with the server id for instant registration:

```powershell
$env:DISCORD_APPLICATION_ID = "1523674862038683689"
$env:DISCORD_BOT_TOKEN = "<the secret bot token>"
$env:DISCORD_GUILD_ID = "<your server id>"
php -d extension=curl api/discord/register-commands.php
```
Expected: `Registered commands to guild <id> (instant): HTTP 200`. `/hilfe`, `/bug`, `/idee` now appear in the server.

- [ ] **Step 5: Smoke test in Discord**

- Run `/hilfe` → an ephemeral help card with a question dropdown + two buttons appears. Pick a question → the answer shows.
- Run `/bug` → the modal opens. Submit it → you get "Danke! Dein Bug wurde weitergegeben. 🐞" **and** an embed appears in the **bugs** channel (`1523681334248079432`).
- Run `/idee` → submit → embed appears in the **ideen** channel (`1523681441177669722`).

- [ ] **Step 6: Update the spec status**

Edit `docs/superpowers/specs/2026-07-06-discord-bot-phase1-design.md`: change `Status: Draft` to `Status: Shipped (2026-…)`.

```bash
git add docs/superpowers/specs/2026-07-06-discord-bot-phase1-design.md
git commit -m "$(printf 'docs(discord-bot): mark Phase 1 shipped\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
git push origin master
```

---

## Self-Review

**Spec coverage:**
- §2 hosting (HTTP interactions on STRATO) → Tasks 7–8, 10. ✓
- §3 files → all created across Tasks 2–9. ✓
- §4.1 `/hilfe` interactive → Tasks 4 (help builder), 5 (routing), 6 not needed (built into responses). ✓
- §4.3 `/bug` `/idee` modals → channel post → Tasks 4, 5, 6, 7. ✓
- §5 FAQ reuse (7 Q&A, own file) → Task 3. ✓
- §6 config (`bug_channel_id`/`idea_channel_id`) → Tasks 1, 10. ✓
- §7 security (Ed25519 verify, PING/PONG, types 1/2/3/5, response types 1/4/9, CLI-only register) → Tasks 2, 4, 5, 7, 9. ✓
- §7 `ext-sodium` risk → resolved locally (loadable via `-d`); server probe = Task 10 Step 3. ✓
- §8 testing (pure-function PHP scripts) → Tasks 2–9. ✓
- §9 owner prerequisites → Task 10 Steps 2–5. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every test step shows the command + expected output. ✓

**Type consistency:** `$kind` is `'bug'`/`'idea'` in `avesmapsDiscordFeedbackMessage`, `avesmapsDiscordConfirmResponse`, and the router's type-5 branch. Constants (`AVESMAPS_DISCORD_*`) are defined once in `responses.php` (+ `AVESMAPS_DISCORD_API_BASE` in `post-message.php`) and referenced consistently. `avesmapsDiscordProcessRequest`'s `$poster` returns `['ok'=>bool,...]`, matching `avesmapsDiscordPostMessage`. ✓

**Deploy correctness:** `api/**` is in the deploy allowlist (auto-ships); `tests/**` is not (stays local); `api/config.local.php` is excluded from deploy. ✓

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-06-discord-bot-phase1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
