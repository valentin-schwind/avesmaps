# Avesmaps Discord Bot — Phase 1 design

- **Date:** 2026-07-06
- **Status:** Draft (awaiting owner review)
- **Phase 1 theme:** a **Help & Feedback bot** — get the bot live, answer FAQs
  interactively, and let users file bugs / improvement ideas into a Discord
  channel. Map search is deliberately **deferred** to a later phase.

## 1. Context & goal

The Avesmaps community now has a Discord server. We want a **custom Avesmaps
bot** that is a *thin adapter over what we already have* — it adds Discord UX, no
new domain logic. Generic community management (welcome / roles / moderation) is
handled by off-the-shelf bots (MEE6, Carl-bot, …) and is **not** built here.

Owner priorities (2026-07-06), in order, map to Phase 1 like this:

| # | Owner wish | In the bot |
|---|---|---|
| 1 | **Channel & bot aufsetzen** | Stand up the **infrastructure**: HTTP-interactions endpoint, signature verification, command registration, deploy → a working bot in the channel. The foundation; comes first. |
| 2 | **FAQs / Bugs / Verbesserungen** | `/faq` reuses the 7 existing Q&A; `/bug` + `/idee` collect input via a **modal** and post it to a feedback channel. |
| 3 | **Interaktive Hilfe** | `/hilfe` is a clickable **select-menu** hub, not a static text wall. |

**Map search (`/karte`) is out of Phase 1** (moved to a future phase, §10).

## 2. Hosting & architecture decision

- The bot runs as a **Discord HTTP-Interactions endpoint in PHP on STRATO** —
  Discord POSTs each interaction to our HTTPS endpoint, which answers within 3 s.
  **No persistent process, no new server, no new cost.** Everything Phase 1 needs
  — slash commands, message components (select menu / buttons), modals, and
  *posting* a message to a channel (a plain REST call with the bot token) — works
  over HTTP. No Gateway connection is required.
- Reuses `api/_internal/bootstrap.php` helpers (`avesmapsLoadApiConfig`,
  `avesmapsJsonResponse`, `avesmapsReadJsonRequest`).

## 3. Files

| Path | Responsibility |
|---|---|
| `api/discord/interactions.php` | **Single** public endpoint for all Discord interactions. Verifies the signature, routes by type (PING / command / component / modal-submit), returns the response envelope. |
| `api/_internal/discord/signature.php` | Ed25519 request-signature verification. |
| `api/_internal/discord/faq.php` | Loads the FAQ data (from `faq.de.json`) and looks up answers. |
| `api/_internal/discord/responses.php` | Builders: `/hilfe` embed + select menu, `/bug` & `/idee` modal definitions, the feedback embed, and ephemeral confirmations. |
| `api/_internal/discord/post-message.php` | Posts a message to a channel via the Discord REST API using the bot token. |
| `api/discord/register-commands.php` | One-off (re)registration of `/hilfe`, `/bug`, `/idee`. **CLI / token-gated, never a plain public endpoint** (§7). |
| `api/discord/faq.de.json` | The FAQ content (seeded from the 7 existing site Q&A; owner-editable). |
| `api/config.local.php` (gitignored) | Real secrets + channel id (§6). |
| `config/api.config.example.php` | Documented empty `discord` block. |

`api/_internal/discord/` is `.htaccess`-denied like the other `_internal` dirs.

## 4. Interaction flows

### 4.1 `/hilfe` — interactive help hub

```
/hilfe   (type 2 command)
  → embed "Avesmaps-Hilfe" + a string-select menu listing the FAQ topics,
    plus buttons  [🐞 Bug melden]  [💡 Idee einreichen]
User picks a topic   (type 3 message-component)
  → reply (ephemeral) with that topic's answer
User clicks a button (type 3)
  → open the corresponding modal (same as /bug or /idee below)
```

### 4.2 `/faq` — quick FAQ

Same select-menu as `/hilfe` without the hub framing (a shortcut). May simply be
an alias that reuses the `/hilfe` builder. (If we want to stay minimal we ship
only `/hilfe` and drop `/faq` — decided in planning.)

### 4.3 `/bug` and `/idee` — file feedback

```
/bug   (type 2 command)         [/idee is identical with 💡 wording]
  → respond with a MODAL (response type 9) with fields:
      • "Titel / Kurzfassung"   (short,     required)
      • "Beschreibung"          (paragraph, required)
      • "Wo? URL oder Ort"      (short,     optional)
User submits the modal   (type 5 modal-submit)
  → post a formatted embed to the configured feedback channel
    (POST /channels/{id}/messages with the bot token) — includes the reporter's
    Discord username and the field contents
  → reply to the user (ephemeral): "Danke! Dein Bug wurde weitergegeben. 🐞"
```

- **Destination = a Discord channel** (owner decision 2026-07-06). No backend, no
  mail. The community + mods see everything in Discord and can discuss/upvote.
  Backend integration is an easy later add (§10).
- Bug vs. idea can share one channel (distinguished by embed colour/title) or use
  two channel ids — see §6.

## 5. FAQ content (reuse, don't reinvent)

- `index.html` already carries **7 German FAQ Q&A** (JSON-LD `FAQPage` +
  a visible `<dl>`, coupled byte-for-byte): *Was ist Avesmaps? · Was ist
  Aventurien? · Reiserouten planen? · Politische Grenzen? · Kostenlos? · Routen
  teilen? · Offiziell?*
- The bot serves these from its own small `api/discord/faq.de.json`, seeded from
  those answers. The site stays untouched.
- **Known minor duplication:** this is a third copy of the FAQ text. Accepted for
  Phase 1 (7 short, low-churn entries). Unifying site + bot onto one source is a
  possible later cleanup, **not** now.

## 6. Config & secrets

```php
'discord' => [
    'public_key'          => '…',  // NOT secret — verify signatures
    'application_id'      => '…',  // NOT secret
    'bot_token'           => '…',  // SECRET — config.local.php only, never committed
    'feedback_channel_id' => '…',  // channel that /bug and /idee post into
    // optional: 'idea_channel_id' to split ideas from bugs; defaults to feedback_channel_id
],
```

- Real values live in `api/config.local.php` (already gitignored).
- Known non-secret values for this app: Application ID `1523674862038683689`,
  Public Key `7281e27c…1026c3`.
- The **bot token, the invite link, and channel ids never enter the repo.**

## 7. Discord contract & security

- **Signature:** every request carries `X-Signature-Ed25519` and
  `X-Signature-Timestamp`. Verify `timestamp + raw_body` against the application
  public key with `sodium_crypto_sign_verify_detached` **before** parsing.
  Invalid → HTTP 401.
- **PING:** interaction type 1 → `{ "type": 1 }` (PONG).
- **Interaction types handled:** 1 PING, 2 APPLICATION_COMMAND, 3
  MESSAGE_COMPONENT, 5 MODAL_SUBMIT.
- **Response types used:** 1 PONG, 4 CHANNEL_MESSAGE_WITH_SOURCE (with the
  `EPHEMERAL` flag for confirmations/answers), 9 MODAL.
- **Channel post:** `POST /channels/{id}/messages` with `Authorization: Bot
  <token>`. Needs the bot to be in the server with **Send Messages** in that
  channel.
- **Timing:** all responses are synchronous and well under 3 s; no deferral.
- **`register-commands.php`:** registers the command definitions via the Discord
  REST API using the bot token. **Not** a plain public URL — run from CLI or gate
  behind a one-off secret + `.htaccess`.
- ⚠️ **Risk to verify in planning:** `ext-sodium` must be enabled on STRATO (PHP
  8 normally bundles it). Probe once; if absent, add a userland Ed25519 verifier.

## 8. Testing

- **Pure functions** get small PHP test scripts (run with `php`):
  - signature verification (valid + invalid cases),
  - FAQ lookup (topic id → correct answer; unknown id → safe fallback),
  - `/hilfe` embed + select-menu builder,
  - modal definition builder,
  - feedback-embed builder (fields + reporter → correct embed JSON).
- **Endpoint smoke test:** Discord's "Save" ping (must return PONG); a documented,
  correctly-signed `/bug` → modal → modal-submit round-trip.
- **Open item:** confirm a local PHP CLI on the Windows dev box; else run tests
  against a scratch PHP or on the server. Decide in planning.

## 9. Owner prerequisites (🔧 DU — copyable steps come in the plan)

1. ✅ Discord server + channel created.
2. ✅ Discord **Application** "Avesmaps" created; Application ID + Public Key noted.
3. Create a dedicated **feedback channel** (e.g. `#bugs-und-ideen`) and copy its
   **Channel ID** (enable Developer Mode → right-click channel → Copy ID).
4. In the app's **Bot** tab, copy the **Bot Token**.
5. Put App ID / Public Key / Bot Token / feedback channel id into
   `api/config.local.php`.
6. Invite the bot to the server with the `applications.commands` scope **and** a
   bot permission that includes **Send Messages** in the feedback channel.
7. After deploy, set the app's **Interactions Endpoint URL** to
   `https://avesmaps.de/api/discord/interactions.php` (Discord verifies it with a
   signed PING).
8. Run the command registration once.

## 10. Out of scope for Phase 1 (future phases)

- **Phase 2 — map search (`/karte`):** live-autocomplete over the existing
  `GET /api/app/map-search.php` (as-is, no refactor, no cache); reply embed + an
  **"Auf der Karte öffnen"** link `https://avesmaps.de/?place=<public_id>`
  (`buildPlaceShareUrl` → `applyPlaceFocusFromUrl`, chain location → label →
  region). Open detail: confirm `?place=` focuses **paths** and **political
  territories**; if not, fall back to the wiki deep-link params
  (`?strasse=` / `?fluss=` / `?staat=` / `?region=`) for those kinds. *(This was
  the original Phase-1 research; preserved here.)*
- **Phase 3 — routes:** `/route <von> <nach>` over `POST /api/route/`.
- **Phase 4 — notifications:** a STRATO cron "what's new" digest posted to a
  channel via a webhook.
- **Phase 5 — polish:** optional backend integration for feedback (store/mail in
  addition to the channel post), coat-of-arms images in embeds (gated to
  `public_domain`), and unifying the site + bot FAQ onto one source.
