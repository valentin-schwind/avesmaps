# Avesmaps Discord Bot — Phase 1 design

- **Date:** 2026-07-06
- **Status:** Draft (awaiting owner review)
- **Scope of this spec:** Phase 1 only — `/karte` search + `/hilfe`. Later phases
  are sketched at the end but are **not** designed here.

## 1. Context & goal

The Avesmaps community now has a Discord server. We want a **custom Avesmaps
bot** that is a *thin adapter over the existing Avesmaps API* — it adds Discord
UX, not new domain logic. Generic community management (welcome / roles /
moderation) is handled by off-the-shelf bots (MEE6, Carl-bot, …) and is
explicitly **not** built here.

Phase 1 delivers the smallest end-to-end slice that stands up the whole
infrastructure:

- `/karte suche:<text>` — live **autocomplete** search across map objects
  (settlements, regions, territories, paths); the reply is a compact embed plus
  an **"Auf der Karte öffnen"** link that focuses the object on avesmaps.de.
- `/hilfe` — a static embed with links (map, route planner, wiki) and a short
  how-to.

## 2. Hosting & architecture decision

- The bot runs as a **Discord HTTP-Interactions endpoint in PHP on STRATO** —
  Discord POSTs each interaction to our HTTPS endpoint, which answers within 3 s.
  **No persistent process, no new server, no new cost.** This is possible only
  because Phase 1 (and the whole custom bot) is command-driven; anything needing
  a Gateway (member-join events, reaction roles, message moderation) is delegated
  to off-the-shelf bots.
- It reuses the existing `api/_internal/bootstrap.php` helpers
  (`avesmapsLoadApiConfig`, `avesmapsApplyCorsPolicy`, `avesmapsJsonResponse`,
  `avesmapsCreatePdo`, `avesmapsReadJsonRequest`).

## 3. Files

| Path | Responsibility |
|---|---|
| `api/discord/interactions.php` | **Single** public endpoint for all Discord interactions (PING, autocomplete, command). Verifies the signature, routes by interaction type, returns the Discord response envelope. |
| `api/_internal/discord/signature.php` | Ed25519 request-signature verification. |
| `api/_internal/discord/search.php` | Search core reused by both the bot and the public search endpoint (see §5). |
| `api/_internal/discord/responses.php` | Builders for autocomplete choices, command embeds, and the `/hilfe` embed. |
| `api/discord/register-commands.php` | One-off command (re)registration against the Discord API. **CLI / token-gated, never a plain public endpoint** (see §7). |
| `api/config.local.php` (gitignored) | Real secrets (see §6). |
| `config/api.config.example.php` | Adds a documented, empty `discord` config block. |

`api/_internal/discord/` is `.htaccess`-denied like the other `_internal`
directories.

## 4. Interaction flows

### 4.1 `/karte suche:<text>` — autocomplete

```
User types  /karte suche:Gareth
  → Discord → POST interactions.php   (type 4 = APPLICATION_COMMAND_AUTOCOMPLETE)
  → verify signature
  → run search core with the partial query, limit 25
  → respond (type 8) with choices:
        name  = "Gareth (Metropole)"
        value = "<kind>:<public_id>"     e.g. "location:abc123"
```

- The autocomplete **choice value encodes kind + public_id**, so the follow-up
  command needs **no second search** — it resolves straight from the value.
- Aventurien names with ö/ä/ü and duplicates ("Neustadt") are handled by the
  existing search core's transliterating normalizer (ä→ae, ß→ss, …), which is
  exactly why we reuse it rather than a raw SQL `LIKE`.

### 4.2 `/karte suche:<text>` — command submit

```
User picks a choice / presses enter
  → Discord → POST interactions.php   (type 2 = APPLICATION_COMMAND)
  → verify signature
  → parse "<kind>:<public_id>" from the option value
  → build embed:  **Gareth** · Metropole
                  link → https://avesmaps.de/?place=<public_id>
  → respond (type 4 = CHANNEL_MESSAGE_WITH_SOURCE), reply is PUBLIC in the channel
```

- Reply is **public** (sharing the link is the point). Ephemeral is a one-line
  toggle if we change our mind.
- If the user typed free text and did **not** pick an autocomplete choice, the
  command runs the search once and uses the best match (score 0/1 first).

### 4.3 `/hilfe`

Static embed: title, one-line description, links (map, route planner, Wiki
Aventurica), and 2–3 usage tips. No DB access. Reply public.

## 5. Search integration (reuse, don't reinvent)

- **Source of truth:** the search logic already living in
  `api/app/map-search.php` (`avesmapsBuildMapSearchResults` and friends). It
  covers **all** object kinds — locations, labels, regions, **Herrschaftsgebiete**,
  paths — and already returns `public_id`, `name`, `type_label`, which is
  everything Phase 1 needs.
- **Refactor:** extract those pure functions into
  `api/_internal/discord/search.php` (or a shared `api/_internal/search/`), and
  have **both** `api/app/map-search.php` and the bot include it. One source of
  truth, **no internal HTTP hop, no CORS question**. `map-search.php` keeps its
  current external behaviour byte-for-byte.
- **Load — measure, don't pre-optimize:** the current search core loads the full
  `map_features` table per call. The STRATO worker-saturation incident was about
  *looping the political layer*, not human-paced typing. Phase 1 therefore ships
  **without a cache**; we take **one** probe measurement of endpoint latency under
  a realistic autocomplete burst and add a `map_revision`-keyed cache **only if
  the measurement shows a real problem**. (If we ever do, the stable
  `GET /api/locations/` — which already returns `public_id` + `map_revision` — is
  the natural cache source for the locations portion.)

### Linking rule (`?place=` first)

- `https://avesmaps.de/?place=<public_id>` is the canonical focus link
  (`buildPlaceShareUrl` → `applyPlaceFocusFromUrl`). It resolves via the existing
  chain **location → label → region** and flies the map there, opening the info
  box.
- **Open detail to confirm in planning:** whether `?place=` also focuses **paths**
  (search returns `public_ids[]` for a grouped path) and **political territories**
  (search returns the territory `public_id`). If the fallback chain does not cover
  those, fall back for those two kinds only to the wiki deep-link params
  (`?strasse=` / `?fluss=` / `?staat=` / `?region=`), which key on the object's
  wiki page name.

## 6. Config & secrets

Add a `discord` block to the config:

```php
'discord' => [
    'public_key'     => '…',  // NOT secret — needed to verify signatures
    'application_id' => '…',  // NOT secret
    'bot_token'      => '…',  // SECRET — config.local.php only, never committed
],
```

- Real values live in `api/config.local.php` (already gitignored).
- `config/api.config.example.php` gets the block with empty strings + comments.
- The **Discord invite link and the bot token never enter the repo.**

## 7. Discord contract & security

- **Signature:** every request carries `X-Signature-Ed25519` and
  `X-Signature-Timestamp`. Verify `timestamp + raw_body` against the
  application public key with `sodium_crypto_sign_verify_detached`. Invalid →
  HTTP 401, no body processing. This check happens **before** any parsing.
- **PING:** interaction type 1 → respond `{ "type": 1 }` (PONG). Discord sends
  this when the endpoint URL is saved and periodically after.
- **Response types used:** 1 (PONG), 4 (CHANNEL_MESSAGE_WITH_SOURCE), 8
  (APPLICATION_COMMAND_AUTOCOMPLETE_RESULT).
- **Timing:** all Phase-1 responses are computed synchronously and well under
  3 s, so **no deferral** (type 5) is needed.
- **`register-commands.php`:** registers/updates the slash-command definitions
  via the Discord REST API using the bot token. It must **not** be a plain public
  URL — either run it from CLI, or gate it behind a one-off secret token and
  `.htaccess`. Registration is a rare, deliberate action, not a runtime path.
- ⚠️ **Risk to verify in planning:** `ext-sodium` must be enabled on STRATO
  (PHP 8 normally bundles it). Probe once. If absent, we need a userland Ed25519
  verifier as a fallback.

## 8. Testing

- **Pure functions** get small PHP test scripts (run with `php`):
  - signature verification (known key / signature / body → pass & fail cases),
  - search-choice building (rows → ≤25 choices, correct value encoding),
  - embed building (kind + public_id → correct link + fields),
  - `/hilfe` embed.
- **Endpoint smoke test:** Discord's own "Save" ping (must return PONG) plus a
  crafted, correctly-signed sample request documented in the plan.
- **Open item:** confirm a local PHP CLI is available on the Windows dev box; if
  not, tests run against a scratch PHP or on the server. Decide in planning.

## 9. Owner prerequisites (🔧 DU — copyable steps come in the plan)

1. ✅ Discord server + channel created.
2. Create a Discord **Application** at discord.com/developers → note **Application
   ID** and **Public Key**; add a **Bot** and copy its **Token**.
3. Put App ID / Public Key / Token into `api/config.local.php`.
4. Set the Application's **Interactions Endpoint URL** to
   `https://avesmaps.de/api/discord/interactions.php` (Discord verifies it with a
   signed PING — the endpoint must already be deployed).
5. Run the command registration once.
6. Invite the bot to the server with the `applications.commands` scope.

## 10. Out of scope for Phase 1 (future phases)

- **Phase 2 — routes & reports:** `/route <von> <nach>` over `POST /api/route/`;
  `/bug` and `/idee` into the existing report/contact system.
- **Phase 3 — notifications:** a STRATO **cron** job posting a "what's new" digest
  (new/changed territories, new community reviews) to a channel via a Discord
  channel webhook.
- **Phase 4 — polish:** coat-of-arms images in embeds (gated to `public_domain`
  per policy), richer embeds, more commands.
