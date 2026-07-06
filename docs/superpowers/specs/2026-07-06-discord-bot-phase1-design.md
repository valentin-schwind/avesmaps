# Avesmaps Discord Bot — Phase 1 design (feedback loop)

- **Date:** 2026-07-06
- **Status:** Draft (awaiting owner review)
- **Phase 1 theme:** close the community **feedback loop** — take in bugs, ideas
  and questions, **store** them, and produce a **daily AI-triaged report** that
  helps the team solve the cases. Map search stays deferred.

## 1. Context & goal

The Avesmaps community has a Discord server. We want a custom bot that is a thin
adapter over what we already have. Generic community management (welcome / roles /
moderation) stays with off-the-shelf bots and is **not** built here.

The owner's core wish (2026-07-06): not just *receive* feedback but *close the
loop* — collect it, keep track, and get daily help solving it. That means two
cooperating parts plus a small store:

- **Part A — PHP intake bot** (STRATO, HTTP interactions): `/hilfe` (FAQ),
  `/bug`, `/idee`, `/frage` post into the matching channel **and** write each case
  into a small MySQL table. `/erledigt` marks a case solved.
- **Part B — scheduled Claude triage routine** (daily): reads the **open** cases,
  groups them, spots duplicates, proposes solutions / answers (questions →
  FAQ candidates), and posts a **report** into the report channel.

**Phasing:** Part A = **Phase 1a**, Part B = **Phase 1b**. 1a is a working,
testable bot on its own; 1b consumes 1a's endpoints.

**Reversal noted:** an earlier decision was "no backend" for feedback. Tracking +
reporting require persistence, so we now add a small MySQL table. This is a
conscious, owner-approved reversal.

## 2. Architecture

```
Discord user
   │  /hilfe /bug /idee /frage /erledigt        (HTTP interactions)
   ▼
api/discord/interactions.php  ──►  posts embed into bug/idea/faq channel (bot token)
   │                            └►  INSERT / UPDATE row in `discord_cases` (MySQL)
   │
   ├─ api/discord/cases-export.php   GET, app-token gated  → open cases as JSON
   └─ api/discord/report-post.php    POST, app-token gated → posts a report to the
                                       report channel (bot token stays on STRATO)
        ▲                                   ▲
        │ (reads open cases)                │ (posts the report)
   Scheduled Claude triage routine (daily) ─┘
```

The bot token lives **only** on STRATO. Part B never sees it — it authenticates
to the two app endpoints with a separate `app_token` and lets STRATO do the
Discord POST. No STRATO cron is needed: the Claude routine is the scheduler.

Everything in Part A is HTTP-interactions + REST (commands, components, modals,
channel POST) — **no Gateway, no persistent process.**

## 3. Commands

| Command | Effect |
|---|---|
| `/hilfe` | Interactive help: an ephemeral card with a select menu of the 7 FAQ + buttons to open the bug/idea/question modals. |
| `/bug` | Opens a modal; on submit → embed into the **bugs** channel + a `bug` row in `discord_cases`. |
| `/idee` | Opens a modal; on submit → embed into the **ideen** channel + an `idea` row. |
| `/frage` | Opens a modal; on submit → embed into the **fragen/FAQ** channel + a `question` row. |
| `/erledigt` | Takes a case number; marks that case `solved` in the store and confirms (ephemeral). Team-facing. |

`/erledigt` (a command) is how cases close, because a ✅ **reaction** would require
a Gateway connection we deliberately don't run.

## 4. Data model — `discord_cases`

Inline `CREATE TABLE IF NOT EXISTS` (the project's self-healing DDL pattern, AGENTS §5), run on first use by the store module:

```sql
CREATE TABLE IF NOT EXISTS discord_cases (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('bug','idea','question') NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT NOT NULL,
    location VARCHAR(500) NULL,
    reporter VARCHAR(190) NOT NULL,
    reporter_id VARCHAR(40) NULL,
    channel_id VARCHAR(40) NULL,
    message_id VARCHAR(40) NULL,
    status ENUM('open','solved') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL,
    solved_at DATETIME NULL,
    solved_by VARCHAR(190) NULL,
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

The case `id` is the human-facing case number ("Fall #42") shown in the channel
embed and used by `/erledigt`.

## 5. Channels & config

Four channels (owner-created; ids are not secret but live only in
`config.local.php`, never the repo):

- bugs `1523681334248079432`, ideen `1523681441177669722`,
  fragen/FAQ `1523685730470330509`, report `1523690349816447157`.

```php
'discord' => [
    'public_key'        => '…',  // NOT secret — verify signatures
    'application_id'    => '…',  // NOT secret
    'bot_token'         => '…',  // SECRET — STRATO only
    'app_token'         => '…',  // SECRET — gates cases-export.php + report-post.php
    'bug_channel_id'    => '…',
    'idea_channel_id'   => '…',
    'faq_channel_id'    => '…',
    'report_channel_id' => '…',
    'guild_id'          => '',   // optional: instant slash-command registration
],
```

## 6. Intake flow (all three kinds)

```
/bug  (or /idee, /frage, or the /hilfe buttons)
  → modal: Titel / Kurzfassung (required), Beschreibung (required), Wo? (optional)
User submits (MODAL_SUBMIT)
  → INSERT into discord_cases -> new case id
  → build embed "🐞 Fall #<id>: <title>" (+ body, Wo?, Von: <reporter>)
  → POST embed to the kind's channel (bot token)
  → ephemeral: "Danke! Dein Bug wurde als Fall #<id> aufgenommen. 🐞"
```

The store INSERT and the channel POST are the endpoint's two side effects; the
router stays pure and returns a `submit_case` decision the endpoint executes.

## 7. Case close flow

```
/erledigt nummer:<id>     (team)
  → UPDATE discord_cases SET status='solved', solved_at=…, solved_by=<user> WHERE id=<id> AND status='open'
  → ephemeral: "Fall #<id> als erledigt markiert. ✅"  (or "nicht gefunden / schon erledigt")
```

## 8. App endpoints for Part B (token-gated)

- `GET api/discord/cases-export.php` — requires `app_token` (header
  `X-Avesmaps-Token` or `?token=`). Returns `{ ok:true, cases:[ open cases with
  id, kind, title, body, location, reporter, created_at ] }`.
- `POST api/discord/report-post.php` — requires `app_token`. Body: `{ content?:
  string, embeds?: array }`. Posts it to `report_channel_id` via the bot token.
  Returns `{ ok:true, status:int }`. This is what lets Part B post without ever
  holding the bot token.

Both live in the public `api/discord/` dir but are useless without the
`app_token`. They are the **only** app-token surface.

## 9. Part B — scheduled Claude triage routine (Phase 1b)

- **What it does, daily:** `GET cases-export.php` → for the open cases: group by
  theme, flag likely duplicates, for bugs propose a probable cause / fix pointer,
  for questions draft an answer and mark FAQ-worthy ones, for ideas cluster and
  note effort. Compose a concise **German** report. `POST report-post.php` to drop
  it into the report channel.
- **How it runs:** a scheduled **Claude Code routine** (recommended — runs in the
  owner's Claude environment; can go beyond text and propose FAQ entries or fix
  PRs). Alternative: a PHP cron calling the Claude API (separate per-token API
  cost). Runtime is finalized at the start of Phase 1b.
- **Secrets for the routine:** only the `app_token` and the site base URL — **not**
  the Discord bot token. Stored in the routine's own config, never in the repo.
- **Reliability:** if the routine skips a day, no report is posted that day; cases
  remain in the store and appear in the next run. Acceptable for a hobby project.

## 10. Security

- **Interactions:** Ed25519 signature verified before any parsing (`ext-sodium`);
  invalid → 401. PING → PONG.
- **App endpoints:** constant-time `app_token` comparison (`hash_equals`); missing/
  wrong → 401. No token in query logs where avoidable (prefer the header).
- **Bot token** only on STRATO. **`register-commands.php`** is CLI-only.
- `api/_internal/discord/**` stays `.htaccess`-denied (used via PHP include).

## 11. Testing

- Pure functions (signature, FAQ, all builders, router incl. `/frage` `/erledigt`
  and `submit_case`/`close_case`, report-post payload, token check) → PHP test
  scripts, run locally with `php -d extension=sodium -d extension=curl`.
- The store (`discord_cases`) is tested against a **SQLite** PDO in-memory handle
  (the module takes a `PDO`, so tests inject SQLite; production injects MySQL) —
  keeps DB tests hermetic and local, no MySQL needed. DDL uses portable columns;
  a MySQL-only `ENUM`/`ENGINE` variant is applied only on MySQL (detected via
  `PDO::ATTR_DRIVER_NAME`).
- Endpoints (`cases-export`, `report-post`, `interactions`) keep logic in
  injectable functions so the token gate + dispatch are unit-tested; the live
  Discord POST is exercised by the Phase-1a smoke test.

## 12. Owner prerequisites (🔧 DU)

1. ✅ Server, app, four channels created; App ID + Public Key known; bot token stashed.
2. Fill `api/config.local.php` `discord` block: bot token, a fresh random
   `app_token`, the four channel ids, optional `guild_id`.
3. Deploy, set Interactions Endpoint URL, register commands (Phase 1a).
4. Phase 1b: set up the scheduled Claude routine with the `app_token` + base URL.

## 13. Out of scope (future phases)

- **Map search (`/karte`)** — autocomplete over `GET /api/app/map-search.php`
  as-is → `?place=<public_id>` links. Research preserved from the earlier draft.
- **Routes** (`/route` over `POST /api/route/`), coat-of-arms embeds, unifying the
  site + bot FAQ onto one source.
