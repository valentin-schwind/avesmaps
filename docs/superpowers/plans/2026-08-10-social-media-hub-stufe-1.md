# Social-Media-Hub — Stufe 1 (Fundament)

> **Für ausführende Agenten:** PFLICHT-UNTERSKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte sind
> Kästchen (`- [ ]`) und werden abgehakt.

**Ziel:** Der Social-Media-Hub steht mit **einem einzigen Kanal — dem Probe-Kanal** —, und die
ganze Kette (Rechteriegel → Bild zu JPEG → Zuschnitt → Ablage → Erreichbarkeitsprüfung →
Textbau je Kanal → Versand → Status je Kanal → Wiederholung eines einzelnen Kanals) ist
durchlaufen und geprüft, **bevor ein einziger echter Zugang existiert**.

**Architektur:** Fünf reine PHP-Bibliotheken unter `api/_internal/social/` (Register, Textbau,
Bild, Speicher, Versand) plus ein Adapter je Dienst. Vier Editor-Endpunkte unter
`api/edit/social/` (Fähigkeit `social`) und ein Routine-Endpunkt unter `api/social/`
(App-Token). Im Frontend ein Unterreiter und ein Overlay-Fenster, gebaut wie jedes andere
Editor-Fenster. Alles, was ohne Datenbank entscheidbar ist, liegt in reinen Funktionen —
das ist das Einzige, was lokal beweisbar ist (es gibt keine lokale DB).

**Technik:** PHP 8 (strict types) + PDO/MySQL · GD für die Bildwandlung · Vanilla JS ohne
Buildschritt · Tokens aus `css/base/tokens.css`.

## Globale Vorgaben

Diese gelten für **jede** Aufgabe und werden nicht je Aufgabe wiederholt.

- **Entwurf ist `docs/superpowers/specs/2026-08-10-social-media-hub-design.md`.** Wo Plan und
  Entwurf sich widersprechen, gewinnt der Entwurf — bis auf die drei Punkte, die der Owner am
  10.08.2026 entschieden hat und die Aufgabe 12 in den Entwurf nachträgt.
- **Kein Buildschritt.** Neue JS-/CSS-Dateien werden von Hand in `index.html` eingetragen.
  **Niemals ein `?v=` von Hand schreiben** — der Deploy stempelt (AGENTS.md §7).
- **Kein `ASSET_VERSION`-Bump.** Der betrifft nur die dynamisch geladenen Territorien-Editor-Assets.
  Der Hub ist ein gewöhnliches `<script>` in `index.html` und wird vom Deploy gestempelt.
- **Keine Farbe, kein Radius, kein Trenner hartkodiert** — immer ein Token aus
  `css/base/tokens.css` (AGENTS.md §12). **Kein Blau.**
- **Deutsch bleibt Deutsch** in der Oberfläche; Code-Kommentare, Commit-Betreffs und die
  `error.code`-Maschinenwerte auf Englisch (AGENTS.md §8).
- **Shared working tree:** vor jedem Commit `git status`, und **nur die selbst angefassten
  Pfade** einzeln stagen. Niemals `git add -A`/`git add .`/`git commit -a` (AGENTS.md §9).
- **PHP-Tests** laufen aus dem Repo-Root mit dem vollen Extension-Satz — ohne ihn melden Tests
  **falsch rot** oder **falsch grün**:
  ```
  php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll <datei>
  ```
- **JS-Tests** nackt: `node js/<pfad>/__tests__/<x>.test.js`.
- **Es gibt keine lokale Datenbank.** Alles DB-Gebundene wird erst live geprüft. Deshalb ist
  jede Regel, die ohne DB entscheidbar ist, als reine Funktion zu schreiben und zu testen.
- 💣 **DDL niemals in einer Transaktion** — `CREATE TABLE` committet in MySQL implizit und reißt
  die umgebende Transaktion auseinander.
- **Der Deploy löscht nie** und die Verzeichnisse `api`, `js`, `css` stehen als Ganzes in der
  Deploy-Liste (`deploy-avesmaps-strato.yml:152`). Neue Unterordner darin brauchen **keine**
  Änderung an der Liste.
- ⚠️ **PHP wirkt auf STRATO 2–4 Minuten verzögert** (Opcache). Ein Endpunkt, der direkt nach dem
  Deploy noch alt antwortet, ist kein Fehler.
- 🔴 **`html/editor-handbuch.html` wird nicht angefasst.** Es gehört der nächtlichen Routine
  (AGENTS.md §9). Pflicht ist allein ein Commit-Betreff, der die sichtbare Wirkung benennt.

## Was Stufe 1 ausdrücklich NICHT enthält

Damit niemand es für vergessen hält:

- **Kein echter Kanal.** Instagram, Facebook und Mastodon stehen im Register und erscheinen in
  der Oberfläche **ausgegraut mit „noch nicht eingerichtet"** (Entwurf §3). Ihre Adapter sind
  Stufe 2.
- **Kein Kartenausschnitt, kein Video.** Beide Knöpfe stehen sichtbar und abgeschaltet da, mit
  ehrlicher Beschriftung („kommt später"). Video ist im Entwurf §11 ausdrücklich Stufe 3; der
  Kartenausschnitt braucht eine eigene Aufnahme-Pipeline (Leaflet mit Kachel-`<img>` **und**
  Canvas-Ebenen) und ist damit ein eigenes Stück Arbeit, kein Nebeneffekt der Bild-Pipeline.
- **Keine Token-Verlängerung.** Die Tabelle `social_token` entsteht hier, die Erneuerung braucht
  einen Adapter und kommt mit ihm in Stufe 2.

---

## Dateiübersicht

**Server — Bibliotheken** (`api/_internal/social/`)

| Datei | Verantwortung |
|---|---|
| `channels.php` | Das Kanal-Register: Anzeigedaten und Auflagen je Kanal, plus „ist eingerichtet?". **Rein.** |
| `compose.php` | Aus Text + Hashtags + Kanal wird die fertige Bildunterschrift, samt Zählung. **Rein.** |
| `media.php` | Bytes rein, JPEG in zulässigem Seitenverhältnis raus. Plus die Erreichbarkeitsprüfung. **Bytes-Teil rein.** |
| `store.php` | DDL und Lese-/Schreibwege für `social_post`, `social_post_target`, `social_token`. |
| `publish.php` | Der Versand: je Ziel Text bauen, Auflagen prüfen, Adapter rufen, Status schreiben. |
| `adapters/probe.php` | Der Probe-Adapter: sendet nichts, protokolliert, was er gesendet hätte. |

**Server — Endpunkte**

| Datei | Zweck | Ausweis |
|---|---|---|
| `api/edit/social/list.php` | Liste für den Reiter | Fähigkeit `social` |
| `api/edit/social/media.php` | Upload, Rechteriegel, Wandlung | Fähigkeit `social` |
| `api/edit/social/publish.php` | Beitrag anlegen und senden · Vorschlag freigeben/verwerfen | Fähigkeit `social` |
| `api/edit/social/retry.php` | **einen** Kanal wiederholen | Fähigkeit `social` |
| `api/social/routine-post.php` | Vorschlag der Routine einliefern | App-Token `social.app_token` |

**Server — geändert**

- `api/_internal/auth.php` — die Fähigkeit `social` in `avesmapsUserCan` und `avesmapsSessionPayload`.

**Client**

| Datei | Verantwortung |
|---|---|
| `js/review/review-social.js` | Liste, Hub-Fenster, Zähler, Upload, Freigabe |
| `css/components/social-hub.css` | Aussehen von Liste und Hub |
| `index.html` | Unterreiter, Abschnitt, Hub-Fenster, `<script>`/`<link>` |
| `css/components/dialog-overlays.css` | `#social-hub-dialog` in die **drei** Selektorlisten |
| `js/app/session.js` | `social` in den Rechte-Kanal |

**Tests**

- `api/_internal/social/__tests__/channels-test.php`
- `api/_internal/social/__tests__/compose-test.php`
- `api/_internal/social/__tests__/media-test.php`
- `api/_internal/social/__tests__/publish-test.php`
- `api/_internal/__tests__/session-payload-test.php` (erweitert)
- `js/app/__tests__/session.test.js` (erweitert)
- `js/review/__tests__/social-list.test.js`

---

## Aufgabe 1: Die Fähigkeit `social`

**Dateien:**
- Ändern: `api/_internal/auth.php:83-92` (`avesmapsUserCan`), `:107-121` (`avesmapsSessionPayload`)
- Ändern: `js/app/session.js:29,43,57-61`
- Test: `api/_internal/__tests__/session-payload-test.php`, `js/app/__tests__/session.test.js`

**Schnittstellen:**
- Liefert: `avesmapsUserCan($user, 'social'): bool` · `avesmapsRequireUserWithCapability('social')`
  (bereits vorhanden, greift durch die neue `match`-Zeile) · im JSON von `GET /api/app/session.php`
  das Feld `capabilities.social` · im Client `window.AvesmapsSession.current().capabilities.social`.

🔴 **Warum `admin` und nicht `editor`.** Das Rechtemodell kennt nur drei Rollen und keine
Rechtematrix je Person (`AVESMAPS_AUTH_ROLES`, `avesmapsUserCan`). Der Entwurf §7 verlangt, dass
`social` **nicht** an `edit` hängt — „wer die Karte pflegen darf, darf damit noch lange nicht im
Namen des Projekts an die Öffentlichkeit". Mit dem heutigen Modell heißt das: **erst einmal nur
Admins.** Das ist eng, aber ehrlich und kostet eine Zeile. Es später auf einzelne Editoren zu
öffnen ist eine Spalte `users.can_social` und dieselbe eine Zeile — und **kein** Aufrufer ändert
sich dabei, weil alle schon durch `avesmapsUserCan(..., 'social')` gehen. Genau dafür bekommt die
Fähigkeit jetzt ihren eigenen Namen, statt `admin` überall hinzuschreiben.

- [ ] **Schritt 1: Den scheiternden Test schreiben**

An `api/_internal/__tests__/session-payload-test.php` anhängen:

```php
// --- Fähigkeit 'social' (Social-Media-Hub, Entwurf §7) ------------------------------------------
// Eigene Fähigkeit, NICHT 'edit': die Karte pflegen und im Namen des Projekts öffentlich sprechen
// sind zwei verschiedene Befugnisse. Heute deckt sie sich mit 'admin' -- das ist die enge Startwahl,
// nicht ihre Definition. Wer sie später weitet, ändert avesmapsUserCan und diesen Test, sonst nichts.
assert(avesmapsUserCan(['role' => 'admin'], 'social') === true,
    'admin darf veroeffentlichen');
assert(avesmapsUserCan(['role' => 'editor'], 'social') === false,
    'ein Editor darf die Karte pflegen, aber nicht im Namen des Projekts senden');
assert(avesmapsUserCan(['role' => 'reviewer'], 'social') === false,
    'ein Reviewer erst recht nicht');
assert(avesmapsUserCan(['role' => ''], 'social') === false,
    'eine unbekannte Rolle gewinnt nichts -- faellt zu, nicht auf');

$adminPayload = avesmapsSessionPayload(['role' => 'admin', 'username' => 'x']);
assert(($adminPayload['capabilities']['social'] ?? null) === true,
    'der Rechte-Kanal traegt social, sonst kann der Client den Reiter nicht ausblenden');
$editorPayload = avesmapsSessionPayload(['role' => 'editor', 'username' => 'x']);
assert(($editorPayload['capabilities']['social'] ?? null) === false,
    'und er traegt es als FALSE, nicht als fehlend -- ein fehlender Schluessel liest sich als undefined');
$anonPayload = avesmapsSessionPayload(null);
assert(($anonPayload['capabilities']['social'] ?? null) === false,
    'anonym: false');
```

- [ ] **Schritt 2: Test laufen lassen, Rotmeldung bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll api/_internal/__tests__/session-payload-test.php
```
Erwartet: FAIL bei `admin darf veroeffentlichen` (das `match` fällt auf `default => false`).

- [ ] **Schritt 3: Die Fähigkeit eintragen**

In `api/_internal/auth.php`, `avesmapsUserCan`, **nach** der `'review'`-Zeile:

```php
        // Veroeffentlichen im Namen des Projekts (Social-Media-Hub, Entwurf §7). Deliberately its own
        // capability rather than a synonym for 'edit': maintaining the map and speaking publicly under
        // the project's name are different powers, and one must be grantable without the other.
        // Today it coincides with 'admin' because the role model has no per-user grid. Widening it to
        // named editors is a users.can_social column plus this one line -- no caller changes, because
        // every caller already asks avesmapsUserCan(..., 'social').
        'social' => $role === 'admin',
```

In `avesmapsSessionPayload`, in das `capabilities`-Array:

```php
            'social' => $isKnownRole && avesmapsUserCan($user, 'social'),
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

Befehl wie Schritt 2. Erwartet: PASS, keine Ausgabe außer der Schlusszeile des Tests.

- [ ] **Schritt 5: Den Client-Test schreiben und scheitern lassen**

An `js/app/__tests__/session.test.js` anhängen:

```js
// 💣 Wie admin/edit/review: nur echtes `true` zählt. Eine als JSON geparste Fehlerseite oder ein
// Proxy, der "1" schreibt, darf den Hub nicht aufsperren -- er sendet öffentlich und unwiderruflich.
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: { social: true } })
	.capabilities.social, true, "social kommt durch, wenn der Server true sagt");
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: { social: "1" } })
	.capabilities.social, false, "eine Zeichenkette ist kein Recht");
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: {} })
	.capabilities.social, false, "fehlend heisst nein");
assert.strictEqual(normalizeSessionPayload(null).capabilities.social, false,
	"kein Payload heisst nein");
```

```bash
node js/app/__tests__/session.test.js
```
Erwartet: FAIL — `undefined !== false`.

- [ ] **Schritt 6: `social` in den Rechte-Kanal**

In `js/app/session.js` an **allen drei** Stellen, an denen die drei Fähigkeiten stehen
(`ANONYMOUS` Z. 29, `anonymousSession()` Z. 43, `normalizeSessionPayload()` Z. 57–61), `social`
ergänzen:

```js
		capabilities: Object.freeze({ admin: false, edit: false, review: false, social: false }),
```
```js
			capabilities: { admin: false, edit: false, review: false, social: false },
```
```js
			capabilities: {
				admin: hasCapabilities && strictBoolean(capabilities.admin),
				edit: hasCapabilities && strictBoolean(capabilities.edit),
				review: hasCapabilities && strictBoolean(capabilities.review),
				social: hasCapabilities && strictBoolean(capabilities.social),
			},
```

- [ ] **Schritt 7: Beide Tests grün**

```bash
node js/app/__tests__/session.test.js
```
Erwartet: PASS.

- [ ] **Schritt 8: Commit**

```bash
git add api/_internal/auth.php api/_internal/__tests__/session-payload-test.php js/app/session.js js/app/__tests__/session.test.js
git commit -m "feat(social): eine eigene Faehigkeit 'social' -- Karte pflegen und oeffentlich senden sind zwei Rechte"
```

---

## Aufgabe 2: Das Kanal-Register

**Dateien:**
- Anlegen: `api/_internal/social/channels.php`
- Test: `api/_internal/social/__tests__/channels-test.php`

**Schnittstellen:**
- Liefert: `AVESMAPS_SOCIAL_CHANNELS` (Konstante) ·
  `avesmapsSocialChannel(string $key): ?array` ·
  `avesmapsSocialChannelKeys(): array` ·
  `avesmapsSocialChannelIsConfigured(string $key, array $socialConfig, array $tokenKeys): bool` ·
  `avesmapsSocialChannelList(array $socialConfig, array $tokenKeys): array` — je Kanal
  `['key','label','account','max_chars','max_hashtags','requires_media','clickable_links','configured']`.
- Ein Kanal-Array hat die Schlüssel `label, account, max_chars, max_hashtags, requires_media,
  clickable_links`. `max_chars`/`max_hashtags` dürfen `null` sein (= unbegrenzt).

- [ ] **Schritt 1: Den scheiternden Test schreiben**

`api/_internal/social/__tests__/channels-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the channel registry. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/social/__tests__/channels-test.php
 *
 * What is worth guarding here is not the data (that is a table anyone can read) but the two rules
 * that decide what the editor SEES:
 *   1. A channel without credentials is listed as configured=false -- it must never vanish, and it
 *      must never come out configured=true, because that would offer a publish button that 500s.
 *   2. 'probe' is configured WITHOUT any credentials. That is the whole point of Stufe 1: the chain
 *      is exercisable before a single access token exists (Entwurf §10).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';

// --- the registry itself ----------------------------------------------------------------------

assert(avesmapsSocialChannel('probe') !== null, 'the probe channel exists');
assert(avesmapsSocialChannel('instagram') !== null, 'instagram is registered even without access');
assert(avesmapsSocialChannel('bluesky') === null, 'an unknown key yields null, never a default row');

$instagram = avesmapsSocialChannel('instagram');
assert($instagram['requires_media'] === true, 'instagram without a picture is not a post');
assert($instagram['clickable_links'] === false, 'instagram has no clickable links -- the adapter must know');
assert($instagram['max_chars'] === 2200, 'instagram: 2200 characters');
assert($instagram['max_hashtags'] === null, 'instagram takes all hashtags -- null, not a big number');

$facebook = avesmapsSocialChannel('facebook');
assert($facebook['max_hashtags'] === 2, 'facebook: two hashtags, more reads as spam');
assert($facebook['clickable_links'] === true, 'facebook takes a link');

$mastodon = avesmapsSocialChannel('mastodon');
assert($mastodon['max_chars'] === 500, 'mastodon: 500 characters');

// --- availability -----------------------------------------------------------------------------

// The probe needs NOTHING. This is the assertion that makes Stufe 1 testable at all.
assert(avesmapsSocialChannelIsConfigured('probe', [], []) === true,
    'the probe channel is configured out of the box -- no config, no token');

assert(avesmapsSocialChannelIsConfigured('instagram', [], []) === false,
    'no credentials, no instagram');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1']], []) === false,
    'a user id without a token is not access');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1', 'access_token' => 't']], []) === true,
    'user id plus token is access');
// The rotating token lives in the DATABASE (owner decision 2026-08-10), so a token row alone is
// enough -- config.local.php only ever needs to carry the account id.
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1']], ['instagram']) === true,
    'a stored token row counts as access, that is where the refreshed token lives');

assert(avesmapsSocialChannelIsConfigured('facebook', ['facebook' => ['page_id' => '1', 'access_token' => 't']], []) === true,
    'facebook: page and token');
assert(avesmapsSocialChannelIsConfigured('mastodon', ['mastodon' => ['base_url' => 'https://x', 'access_token' => 't']], []) === true,
    'mastodon: instance and token');
assert(avesmapsSocialChannelIsConfigured('mastodon', ['mastodon' => ['access_token' => 't']], []) === false,
    'a mastodon token without an instance addresses nobody');

assert(avesmapsSocialChannelIsConfigured('nope', [], []) === false,
    'an unknown channel is never configured');

// --- the list the UI renders --------------------------------------------------------------------

$list = avesmapsSocialChannelList([], []);
assert(count($list) === count(avesmapsSocialChannelKeys()),
    'EVERY channel is listed, including the ones without access -- greyed out, not hidden (Entwurf §3)');
$byKey = [];
foreach ($list as $row) { $byKey[$row['key']] = $row; }
assert($byKey['probe']['configured'] === true, 'probe usable');
assert($byKey['facebook']['configured'] === false, 'facebook listed but not usable');
assert(isset($byKey['facebook']['account']) && $byKey['facebook']['account'] !== '',
    'even an unconfigured channel says which account it WOULD be -- that is why it stays visible');
// 🔴 No secret may travel to the client. The list is rendered into the editor panel.
foreach ($list as $row) {
    assert(!isset($row['access_token']) && !isset($row['app_secret']),
        'no credential ever leaves the server in the channel list');
}

fwrite(STDOUT, "channels-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Rotmeldung bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/channels-test.php
```
Erwartet: FAIL — `Failed opening required '.../channels.php'`.

- [ ] **Schritt 3: Das Register schreiben**

`api/_internal/social/channels.php`:

```php
<?php

declare(strict_types=1);

// The channel registry: everything about a network that is NOT a credential (Entwurf §3).
//
// It is declarative on purpose. A new network is an entry here plus an adapter -- not a rebuild --
// and the UI renders whatever stands here, including the entries nobody can use yet: a channel
// without access is shown GREYED OUT, never hidden (Entwurf §3). Who looks at the hub should learn
// what would be possible.
//
// 🔴 CREDENTIALS ARE NOT HERE. They live in api/config.local.php under 'social' (account ids, app
// secrets) and -- for the rotating access token -- in the `social_token` table, because a token the
// server refreshes by itself cannot live in a hand-edited PHP file (owner decision 2026-08-10). This
// file is safe to read into the client; nothing in it is secret.
//
// 💣 max_hashtags === null means ALL, not "many". Instagram takes every tag; writing 30 here would
// be a limit nobody imposed, and the composer would silently truncate.

const AVESMAPS_SOCIAL_CHANNELS = [
    // The rehearsal channel (Entwurf §10). It runs the entire chain -- convert, crop, upload, reach
    // check, compose, write status -- and logs what it WOULD have sent instead of sending.
    //
    // Its limits are the STRICTEST of the real channels (Mastodon's 500 characters, Facebook's two
    // hashtags), so a post that passes the probe passes everywhere. requires_media stays FALSE on
    // purpose, unlike Instagram: the probe must be able to rehearse a text-only post too, and the
    // picture path is exercised simply by attaching one.
    'probe' => [
        'label' => 'Probe',
        'account' => 'nur intern — sendet nichts',
        'max_chars' => 500,
        'max_hashtags' => 2,
        'requires_media' => false,
        'clickable_links' => true,
    ],
    'instagram' => [
        'label' => 'Instagram',
        'account' => '@avesmaps',
        'max_chars' => 2200,
        'max_hashtags' => null,
        'requires_media' => true,
        'clickable_links' => false,
    ],
    'facebook' => [
        'label' => 'Facebook',
        'account' => 'Seite Avesmaps',
        'max_chars' => 63206,
        'max_hashtags' => 2,
        'requires_media' => false,
        'clickable_links' => true,
    ],
    'mastodon' => [
        'label' => 'Mastodon',
        'account' => 'noch kein Konto',
        'max_chars' => 500,
        'max_hashtags' => 4,
        'requires_media' => false,
        'clickable_links' => true,
    ],
];

/**
 * @return array<string, mixed>|null The channel, or null for an unknown key. Never a default row --
 *   a typo must fail loudly, not post to a channel with invented limits.
 */
function avesmapsSocialChannel(string $key): ?array
{
    return AVESMAPS_SOCIAL_CHANNELS[$key] ?? null;
}

/** @return list<string> */
function avesmapsSocialChannelKeys(): array
{
    return array_keys(AVESMAPS_SOCIAL_CHANNELS);
}

/**
 * Does this channel have a way to reach its network?
 *
 * @param array<string, mixed> $socialConfig The 'social' block of config.local.php.
 * @param list<string>         $tokenKeys    Channel keys that have a row in `social_token`.
 */
function avesmapsSocialChannelIsConfigured(string $key, array $socialConfig, array $tokenKeys): bool
{
    if (avesmapsSocialChannel($key) === null) {
        return false;
    }
    // The probe needs nothing -- that IS its purpose (Entwurf §10).
    if ($key === 'probe') {
        return true;
    }

    $entry = is_array($socialConfig[$key] ?? null) ? $socialConfig[$key] : [];
    // A stored token row is access on its own: the refreshed token lives in the database, and
    // config.local.php then only carries the account id.
    $hasToken = in_array($key, $tokenKeys, true) || trim((string) ($entry['access_token'] ?? '')) !== '';
    if (!$hasToken) {
        return false;
    }

    // Beyond the token each network needs the thing it is addressed BY. A token without it reaches
    // nobody, and finding that out at publish time means a failed public post.
    return match ($key) {
        'instagram' => trim((string) ($entry['user_id'] ?? '')) !== '',
        'facebook' => trim((string) ($entry['page_id'] ?? '')) !== '',
        'mastodon' => trim((string) ($entry['base_url'] ?? '')) !== '',
        default => false,
    };
}

/**
 * The list the editor panel renders: every channel, with its limits and whether it can be used.
 * Carries NO credential -- this travels to the client.
 *
 * @param array<string, mixed> $socialConfig
 * @param list<string>         $tokenKeys
 * @return list<array<string, mixed>>
 */
function avesmapsSocialChannelList(array $socialConfig, array $tokenKeys): array
{
    $list = [];
    foreach (AVESMAPS_SOCIAL_CHANNELS as $key => $channel) {
        $list[] = [
            'key' => $key,
            'label' => $channel['label'],
            'account' => $channel['account'],
            'max_chars' => $channel['max_chars'],
            'max_hashtags' => $channel['max_hashtags'],
            'requires_media' => $channel['requires_media'],
            'clickable_links' => $channel['clickable_links'],
            'configured' => avesmapsSocialChannelIsConfigured($key, $socialConfig, $tokenKeys),
        ];
    }

    return $list;
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

Befehl wie Schritt 2. Erwartet: `channels-test: OK`.

- [ ] **Schritt 5: Commit**

```bash
git add api/_internal/social/channels.php api/_internal/social/__tests__/channels-test.php
git commit -m "feat(social): das Kanal-Register -- Auflagen je Netz, Zugaenge bleiben ausserhalb"
```

---

## Aufgabe 3: Der Textbau

**Dateien:**
- Anlegen: `api/_internal/social/compose.php`
- Test: `api/_internal/social/__tests__/compose-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsSocialChannel()` aus Aufgabe 2.
- Liefert:
  - `AVESMAPS_SOCIAL_HASHTAG_VOCABULARY` (Konstante, `list<string>`)
  - `avesmapsSocialNormalizeHashtags(array|string $raw): list<string>`
  - `avesmapsSocialCompose(string $text, array $hashtags, array $channel): array` —
    `['caption','text_chars','hashtag_chars','total_chars','hashtags_used','over_limit']`
  - `avesmapsSocialStrictestLimit(array $channelKeys): array` — `['key','label','max_chars']`
    oder `['key'=>null,'label'=>'','max_chars'=>null]`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

`api/_internal/social/__tests__/compose-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the composer. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/compose-test.php
 *
 * ⚠️ mbstring is REQUIRED here, not optional: every count is mb_strlen. Without the extension this
 * file dies with "undefined function mb_strlen" -- which looks like a bug in the composer and is not.
 *
 * The rules worth guarding, all of them from Entwurf §4:
 *   1. Hashtags COUNT toward the character limit. Four tags are 60 characters; against Mastodon's
 *      500 that is more than a tenth, and getting it wrong means posts truncated on arrival.
 *   2. Each channel gets the FIRST so-many tags -- Instagram all, Facebook 2, Mastodon 4.
 *   3. The counter shows the STRICTEST limit among the CHECKED channels. Unchecking Mastodon must
 *      give the editor 2200 characters back, or they write to the wrong ceiling.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../compose.php';

// --- hashtag normalisation ----------------------------------------------------------------------

assert(avesmapsSocialNormalizeHashtags(['DSA', '#Aventurien']) === ['#DSA', '#Aventurien'],
    'a leading # is optional on input and guaranteed on output');
assert(avesmapsSocialNormalizeHashtags('DSA, #Aventurien ,, Rollenspiel') === ['#DSA', '#Aventurien', '#Rollenspiel'],
    'a comma-separated string works too -- that is what a text field sends');
assert(avesmapsSocialNormalizeHashtags(['#DSA', 'dsa', '#DSA']) === ['#DSA'],
    'duplicates fold case-insensitively: #dsa and #DSA are ONE bucket, which is the whole reason the vocabulary exists');
assert(avesmapsSocialNormalizeHashtags(['  ', '#', '']) === [],
    'empty and bare-# entries drop out instead of becoming "#"');
assert(avesmapsSocialNormalizeHashtags(['#Das Schwarze Auge']) === ['#DasSchwarzeAuge'],
    'spaces inside a tag would end it -- they are removed, not left to break the tag');
assert(avesmapsSocialNormalizeHashtags(['#Über']) === ['#Über'],
    'umlauts stay: hashtags are not wiki keys and must NOT be ascii-folded');

// --- composition ---------------------------------------------------------------------------------

$mastodon = avesmapsSocialChannel('mastodon');
$instagram = avesmapsSocialChannel('instagram');
$facebook = avesmapsSocialChannel('facebook');

$plain = avesmapsSocialCompose('Hallo Aventurien', [], $mastodon);
assert($plain['caption'] === 'Hallo Aventurien', 'no tags, no trailing whitespace');
assert($plain['text_chars'] === 16, 'text counted with mb_strlen');
assert($plain['hashtag_chars'] === 0, 'no tags, no tag characters');
assert($plain['total_chars'] === 16, 'total equals text when there are no tags');
assert($plain['over_limit'] === false, '16 of 500 is fine');

$tagged = avesmapsSocialCompose('Hallo', ['#DSA', '#Aventurien'], $mastodon);
assert($tagged['caption'] === "Hallo\n\n#DSA #Aventurien",
    'tags are appended to the TEXT -- the APIs have no hashtag field (Entwurf §4)');
assert($tagged['hashtags_used'] === ['#DSA', '#Aventurien'], 'mastodon takes 4, so both fit');
// 💣 The assertion this test exists for: the tags are part of the length.
assert($tagged['total_chars'] === mb_strlen("Hallo\n\n#DSA #Aventurien"),
    'the total counts the ASSEMBLED caption, separator included');
assert($tagged['hashtag_chars'] === $tagged['total_chars'] - $tagged['text_chars'],
    'the split is exact -- the counter shows "168 + 61", and the two must add up');

$fb = avesmapsSocialCompose('Hallo', ['#A', '#B', '#C', '#D'], $facebook);
assert($fb['hashtags_used'] === ['#A', '#B'], 'facebook gets the FIRST two, not a random two');
assert($fb['caption'] === "Hallo\n\n#A #B", 'and only those two reach the caption');

$ig = avesmapsSocialCompose('Hallo', ['#A', '#B', '#C', '#D'], $instagram);
assert($ig['hashtags_used'] === ['#A', '#B', '#C', '#D'],
    'max_hashtags null means ALL -- instagram truncating tags would be an invented rule');

$long = avesmapsSocialCompose(str_repeat('x', 495), ['#DSA'], $mastodon);
assert($long['over_limit'] === true,
    '495 characters plus a tag exceeds 500 -- caught BEFORE sending, not by the API');
$fits = avesmapsSocialCompose(str_repeat('x', 495), [], $mastodon);
assert($fits['over_limit'] === false, '495 alone fits');
// The same text against a roomier channel is fine. This is the "uncheck Mastodon and you have
// 2200 again" behaviour, at the composer level.
assert(avesmapsSocialCompose(str_repeat('x', 495), ['#DSA'], $instagram)['over_limit'] === false,
    'the limit belongs to the CHANNEL, not to the text');

// --- the strictest limit --------------------------------------------------------------------------

$strict = avesmapsSocialStrictestLimit(['instagram', 'mastodon']);
assert($strict['max_chars'] === 500 && $strict['key'] === 'mastodon',
    'with mastodon checked the ceiling is 500 and the counter must NAME it');
$loose = avesmapsSocialStrictestLimit(['instagram', 'facebook']);
assert($loose['max_chars'] === 2200 && $loose['key'] === 'instagram',
    'uncheck mastodon and the editor gets 2200 back');
assert(avesmapsSocialStrictestLimit([])['max_chars'] === null,
    'nothing checked, no ceiling -- not zero, which would forbid every post');
assert(avesmapsSocialStrictestLimit(['nope'])['max_chars'] === null,
    'an unknown key contributes no limit instead of crashing');

fwrite(STDOUT, "compose-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Rotmeldung bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/compose-test.php
```
Erwartet: FAIL — `Failed opening required '.../compose.php'`.

- [ ] **Schritt 3: Den Textbau schreiben**

`api/_internal/social/compose.php`:

```php
<?php

declare(strict_types=1);

// Text + hashtags + a channel -> the finished caption, and the numbers the counter shows (Entwurf §4).
//
// Pure on purpose: no database, no HTTP, no config. That is the only reason it can be tested at all
// (there is no local MySQL), and it is the piece where a silent mistake is most expensive -- a
// mis-counted caption is a post truncated in public.
//
// 💣 HASHTAGS COUNT TOWARD THE LIMIT. They live in their own input field because the networks take
// different numbers of them, but they are DELIVERED INSIDE THE TEXT: no API has a hashtag field.
// Four tags are quickly 60 characters -- against Mastodon's 500 that is more than a tenth.

require_once __DIR__ . '/channels.php';

// A shared vocabulary, offered for one click in the hub. Without it everyone types something
// slightly different and #dsa5 / #DSA5 / #dasschwarzeauge become three separate buckets nobody
// can search (Entwurf §4).
const AVESMAPS_SOCIAL_HASHTAG_VOCABULARY = [
    '#DSA', '#Aventurien', '#Rollenspiel', '#TDE', '#PnP', '#Karte', '#Fanprojekt', '#DasSchwarzeAuge',
];

const AVESMAPS_SOCIAL_HASHTAG_SEPARATOR = "\n\n";

/**
 * Clean a list (or a comma-separated string) into canonical tags.
 *
 * ⚠️ Deliberately NOT ascii-folded. avesmapsFoldToAscii belongs to wiki keys, where a join depends
 * on both sides deriving the same string; a hashtag is human-facing text and "#Ueber" is a different
 * tag from "#Über". Only the things that would BREAK a tag are removed: whitespace inside it (which
 * would end the tag) and the leading '#' (re-added exactly once).
 *
 * @param list<string>|string $raw
 * @return list<string>
 */
function avesmapsSocialNormalizeHashtags(array|string $raw): array
{
    $items = is_string($raw) ? preg_split('/[,\s]+/u', $raw) : $raw;
    $items = is_array($items) ? $items : [];

    $result = [];
    $seen = [];
    foreach ($items as $item) {
        $tag = trim((string) $item);
        $tag = ltrim($tag, '#');
        // Whitespace inside a tag ends it on every network -- "#Das Schwarze Auge" posts as "#Das".
        $tag = preg_replace('/\s+/u', '', $tag) ?? '';
        if ($tag === '') {
            continue;
        }
        // Case-insensitive dedup: #dsa and #DSA are one bucket. The FIRST spelling wins, so the
        // editor's capitalisation survives.
        $fold = mb_strtolower($tag);
        if (isset($seen[$fold])) {
            continue;
        }
        $seen[$fold] = true;
        $result[] = '#' . $tag;
    }

    return $result;
}

/**
 * Assemble the caption for ONE channel and report the numbers.
 *
 * @param list<string>         $hashtags Already normalised, or not -- this normalises again (cheap,
 *                                       and it makes the function safe to call with raw input).
 * @param array<string, mixed> $channel  A row from AVESMAPS_SOCIAL_CHANNELS.
 * @return array{caption: string, text_chars: int, hashtag_chars: int, total_chars: int,
 *               hashtags_used: list<string>, over_limit: bool}
 */
function avesmapsSocialCompose(string $text, array $hashtags, array $channel): array
{
    $text = rtrim($text);
    $tags = avesmapsSocialNormalizeHashtags($hashtags);

    // null means ALL. Writing a large number instead would be a limit nobody imposed.
    $maxTags = $channel['max_hashtags'] ?? null;
    if ($maxTags !== null && $maxTags >= 0) {
        $tags = array_slice($tags, 0, (int) $maxTags);
    }

    $caption = $text;
    if ($tags !== []) {
        $caption = ($text === '' ? '' : $text . AVESMAPS_SOCIAL_HASHTAG_SEPARATOR) . implode(' ', $tags);
    }

    $textChars = mb_strlen($text);
    $totalChars = mb_strlen($caption);
    $maxChars = $channel['max_chars'] ?? null;

    return [
        'caption' => $caption,
        'text_chars' => $textChars,
        // Derived, not measured separately, so the two ALWAYS add up to the total. The counter shows
        // them as "168 + 61 = 229"; computing the parts independently is how that sum stops matching.
        'hashtag_chars' => $totalChars - $textChars,
        'total_chars' => $totalChars,
        'hashtags_used' => $tags,
        'over_limit' => $maxChars !== null && $totalChars > (int) $maxChars,
    ];
}

/**
 * The tightest character ceiling among the given channels -- what the counter displays.
 *
 * Nothing selected yields max_chars null (no ceiling), NOT zero: zero would forbid every post and
 * read like a bug in the counter.
 *
 * @param list<string> $channelKeys
 * @return array{key: string|null, label: string, max_chars: int|null}
 */
function avesmapsSocialStrictestLimit(array $channelKeys): array
{
    $best = ['key' => null, 'label' => '', 'max_chars' => null];
    foreach ($channelKeys as $key) {
        $channel = avesmapsSocialChannel((string) $key);
        if ($channel === null || $channel['max_chars'] === null) {
            continue;
        }
        $limit = (int) $channel['max_chars'];
        if ($best['max_chars'] === null || $limit < $best['max_chars']) {
            $best = ['key' => (string) $key, 'label' => (string) $channel['label'], 'max_chars' => $limit];
        }
    }

    return $best;
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

Befehl wie Schritt 2. Erwartet: `compose-test: OK`.

- [ ] **Schritt 5: Commit**

```bash
git add api/_internal/social/compose.php api/_internal/social/__tests__/compose-test.php
git commit -m "feat(social): Textbau je Kanal -- Hashtags zaehlen zum Limit und werden je Netz gekappt"
```

---

## Aufgabe 4: Die Bild-Pipeline

**Dateien:**
- Anlegen: `api/_internal/social/media.php`
- Test: `api/_internal/social/__tests__/media-test.php`

**Schnittstellen:**
- Liefert:
  - `AVESMAPS_SOCIAL_MIN_RATIO` (0.8 = 4:5), `AVESMAPS_SOCIAL_MAX_RATIO` (1.91)
  - `AVESMAPS_SOCIAL_MEDIA_MAX_BYTES`, `AVESMAPS_SOCIAL_MEDIA_TYPES`
  - `avesmapsSocialEncodeImageBytes(string $bytes): array` —
    `['bytes','ext','width','height','cropped']`; `ext` ist immer `'jpg'`
  - `avesmapsSocialMediaFitsChannels(int $w, int $h): list<string>`
  - `avesmapsSocialMediaIsReachable(string $absoluteUrl): bool`
  - `avesmapsSocialAbsoluteUrl(string $path): string`

💣 **Zwei Fallen, die dieser Test festnagelt.** Erstens nimmt Instagram **kein PNG** — es wird
gewandelt. Zweitens hat JPEG **keine Transparenz**: ein durchsichtiges PNG wird ohne Unterlage
**schwarz**. Genau das ist der Fehler, den niemand vor dem Absenden sieht.

- [ ] **Schritt 1: Den scheiternden Test schreiben**

`api/_internal/social/__tests__/media-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the picture pipeline. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_gd.dll api/_internal/social/__tests__/media-test.php
 *
 * ⚠️ gd is REQUIRED. Without it this file fails with NO error message at all -- exactly like
 * citymap-image-encode-test.php. That is not a bug in the pipeline.
 *
 * The three rules worth guarding (Entwurf §3.1, §5):
 *   1. Everything comes out JPEG. Instagram takes no PNG, and it is the strictest channel.
 *   2. A transparent PNG must NOT come out black. JPEG has no alpha; without an explicit white
 *      backdrop GD composites onto black, and nobody sees it until the post is public.
 *   3. The aspect ratio is forced into 4:5 … 1.91:1 by CENTRE-CROPPING, never by squashing.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('imagecreatetruecolor')) {
    fwrite(STDERR, "FATAL: gd is missing -- this test would fail silently. Re-run with -d extension=php_gd.dll\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../media.php';

/** A solid PNG of the given size, in the given colour. */
function makePng(int $w, int $h, int $r = 200, int $g = 30, int $b = 30): string
{
    $im = imagecreatetruecolor($w, $h);
    imagefill($im, 0, 0, imagecolorallocate($im, $r, $g, $b));
    ob_start();
    imagepng($im);
    $bytes = (string) ob_get_clean();
    imagedestroy($im);
    return $bytes;
}

/** A FULLY TRANSPARENT PNG -- the black-background trap. */
function makeTransparentPng(int $w, int $h): string
{
    $im = imagecreatetruecolor($w, $h);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
    ob_start();
    imagepng($im);
    $bytes = (string) ob_get_clean();
    imagedestroy($im);
    return $bytes;
}

// --- everything becomes JPEG ----------------------------------------------------------------------

$square = avesmapsSocialEncodeImageBytes(makePng(600, 600));
assert($square['ext'] === 'jpg', 'a PNG comes out as JPEG -- instagram takes no PNG (Entwurf §3.1)');
assert(str_starts_with($square['bytes'], "\xFF\xD8\xFF"),
    'and the BYTES are really JPEG, not a PNG with a renamed extension');
assert($square['width'] === 600 && $square['height'] === 600, '1:1 is inside 4:5 … 1.91:1, untouched');
assert($square['cropped'] === false, 'nothing was cropped');

// --- 💣 the transparency trap ---------------------------------------------------------------------

$transparent = avesmapsSocialEncodeImageBytes(makeTransparentPng(400, 400));
$check = imagecreatefromstring($transparent['bytes']);
assert($check !== false, 'the flattened image is readable');
$corner = imagecolorat($check, 5, 5);
$red = ($corner >> 16) & 0xFF;
$green = ($corner >> 8) & 0xFF;
$blue = $corner & 0xFF;
imagedestroy($check);
// JPEG has no alpha. Without an explicit white backdrop GD composites onto BLACK and the editor
// gets a black square on Instagram -- visible only after it is public.
assert($red > 240 && $green > 240 && $blue > 240,
    'a transparent PNG lands on WHITE, not on black (rgb was ' . $red . ',' . $green . ',' . $blue . ')');

// --- the aspect ratio ------------------------------------------------------------------------------

// Too tall: 600x1200 = 0.5, below 4:5. The height is cropped, the width is kept.
$tall = avesmapsSocialEncodeImageBytes(makePng(600, 1200));
assert($tall['cropped'] === true, 'a 1:2 picture must be cropped');
assert($tall['width'] === 600, 'the WIDTH is kept -- a too-tall picture loses top and bottom');
assert($tall['height'] === 750, '600 / 0.8 = 750, the tallest instagram allows');
assert(abs(($tall['width'] / $tall['height']) - 0.8) < 0.01, 'the result sits exactly on 4:5');

// Too wide: 2000x500 = 4.0, above 1.91.
$wide = avesmapsSocialEncodeImageBytes(makePng(2000, 500));
assert($wide['cropped'] === true, 'a 4:1 panorama must be cropped');
assert($wide['height'] === 500, 'the HEIGHT is kept -- a too-wide picture loses left and right');
assert($wide['width'] === 955, '500 * 1.91 = 955');

// 💣 Never squashed. A crop keeps circles round; a resize to the target ratio distorts the map.
$portrait = avesmapsSocialEncodeImageBytes(makePng(800, 1000));
assert($portrait['cropped'] === false, '4:5 exactly -- the boundary is INCLUSIVE, not one pixel short');
$landscape = avesmapsSocialEncodeImageBytes(makePng(1910, 1000));
assert($landscape['cropped'] === false, '1.91:1 exactly is allowed too');

// --- which channels a size fits ---------------------------------------------------------------------

$fits = avesmapsSocialMediaFitsChannels(1080, 1350);
assert(in_array('instagram', $fits, true), '4:5 fits instagram');
assert(in_array('facebook', $fits, true) && in_array('mastodon', $fits, true),
    'facebook and mastodon take any ratio');
$panorama = avesmapsSocialMediaFitsChannels(3000, 500);
assert(!in_array('instagram', $panorama, true), 'a 6:1 panorama does NOT fit instagram');
assert(in_array('facebook', $panorama, true), 'but facebook still takes it');

// --- a broken upload ---------------------------------------------------------------------------------

$garbage = avesmapsSocialEncodeImageBytes('this is not a picture');
assert($garbage['bytes'] === '' && $garbage['width'] === 0,
    'unreadable bytes yield an EMPTY result -- the caller turns that into a 415, it never stores rubbish');

fwrite(STDOUT, "media-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Rotmeldung bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_gd.dll -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/social/__tests__/media-test.php
```
Erwartet: FAIL — `Failed opening required '.../media.php'`.

- [ ] **Schritt 3: Die Pipeline schreiben**

`api/_internal/social/media.php`:

```php
<?php

declare(strict_types=1);

// The picture pipeline (Entwurf §3.1, §5): bytes in, a JPEG in a ratio Instagram accepts out.
//
// 💣 INSTAGRAM TAKES NO PNG. It is the most common stumbling block and it only shows at send time,
// as an API error, long after the editor pressed publish. So everything is converted here, up front,
// and the hub says BEFORE sending what will get through.
//
// 💣 JPEG HAS NO TRANSPARENCY. A transparent PNG composited without a backdrop comes out BLACK. The
// white fill below is the whole reason imagecopyresampled is not called on a bare truecolor canvas.
//
// 💣 CROP, NEVER SQUASH. Forcing the ratio by resizing distorts the map -- and a distorted map is
// exactly the artefact this project exists to get right.
//
// The encode half is pure (bytes in, bytes out) so it can be unit-tested against real GD, the same
// reason citymap-image-encode.php lives in its own file. Only the reachability probe touches HTTP.

require_once __DIR__ . '/channels.php';

const AVESMAPS_SOCIAL_MEDIA_MAX_BYTES = 12 * 1024 * 1024; // mirrors the citymap upload cap
const AVESMAPS_SOCIAL_MEDIA_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
];
// Instagram's window, and therefore everyone's: 4:5 (portrait) to 1.91:1 (landscape).
const AVESMAPS_SOCIAL_MIN_RATIO = 0.8;
const AVESMAPS_SOCIAL_MAX_RATIO = 1.91;
const AVESMAPS_SOCIAL_JPEG_QUALITY = 88;
const AVESMAPS_SOCIAL_UPLOAD_DIR = '/uploads/social';

/**
 * Convert to JPEG and centre-crop into the allowed ratio window.
 *
 * @return array{bytes: string, ext: string, width: int, height: int, cropped: bool}
 *   An unreadable input yields bytes '' and width 0 -- the caller turns that into a 415. It never
 *   returns the original bytes on failure: storing a PNG under a .jpg name is the very trap above.
 */
function avesmapsSocialEncodeImageBytes(string $bytes): array
{
    $empty = ['bytes' => '', 'ext' => 'jpg', 'width' => 0, 'height' => 0, 'cropped' => false];
    if ($bytes === '' || !function_exists('imagecreatefromstring')) {
        return $empty;
    }

    $src = @imagecreatefromstring($bytes);
    if ($src === false) {
        return $empty;
    }

    try {
        $w = imagesx($src);
        $h = imagesy($src);
        if ($w < 1 || $h < 1) {
            return $empty;
        }

        // The crop window. Only ONE dimension ever shrinks: too tall loses top and bottom, too wide
        // loses left and right. Both boundaries are INCLUSIVE -- a picture sitting exactly on 4:5 is
        // allowed, and cropping it by a pixel would be a change nobody asked for.
        $ratio = $w / $h;
        $cropW = $w;
        $cropH = $h;
        $cropped = false;
        if ($ratio < AVESMAPS_SOCIAL_MIN_RATIO) {
            $cropH = (int) round($w / AVESMAPS_SOCIAL_MIN_RATIO);
            $cropped = true;
        } elseif ($ratio > AVESMAPS_SOCIAL_MAX_RATIO) {
            $cropW = (int) round($h * AVESMAPS_SOCIAL_MAX_RATIO);
            $cropped = true;
        }
        $cropW = max(1, min($cropW, $w));
        $cropH = max(1, min($cropH, $h));
        $offsetX = (int) floor(($w - $cropW) / 2);
        $offsetY = (int) floor(($h - $cropH) / 2);

        $dst = imagecreatetruecolor($cropW, $cropH);
        if ($dst === false) {
            return $empty;
        }

        try {
            // 💣 THE WHITE BACKDROP. Without it a transparent PNG composites onto black and the
            // editor finds a black square on Instagram -- after it is public.
            $white = imagecolorallocate($dst, 255, 255, 255);
            imagefilledrectangle($dst, 0, 0, $cropW, $cropH, $white);
            imagealphablending($dst, true);
            // imagecopy, not imagecopyresampled: same pixel scale, so this is a crop and nothing else.
            if (!imagecopy($dst, $src, 0, 0, $offsetX, $offsetY, $cropW, $cropH)) {
                return $empty;
            }

            ob_start();
            $ok = imagejpeg($dst, null, AVESMAPS_SOCIAL_JPEG_QUALITY);
            $out = (string) ob_get_clean();
            if (!$ok || $out === '') {
                return $empty;
            }

            return [
                'bytes' => $out,
                'ext' => 'jpg',
                'width' => $cropW,
                'height' => $cropH,
                'cropped' => $cropped,
            ];
        } finally {
            imagedestroy($dst);
        }
    } finally {
        imagedestroy($src);
    }
}

/**
 * Which channels accept a picture of this size? Drives the hub's "✓ Passt für …" line, which exists
 * so the answer arrives BEFORE publishing instead of as an API error afterwards.
 *
 * @return list<string>
 */
function avesmapsSocialMediaFitsChannels(int $width, int $height): array
{
    $fits = [];
    $ratio = $height > 0 ? $width / $height : 0.0;
    foreach (avesmapsSocialChannelKeys() as $key) {
        // Only Instagram constrains the ratio. Everyone else takes what they are given.
        if ($key === 'instagram'
            && ($ratio < AVESMAPS_SOCIAL_MIN_RATIO || $ratio > AVESMAPS_SOCIAL_MAX_RATIO)) {
            continue;
        }
        $fits[] = $key;
    }

    return $fits;
}

/** Absolute, publicly fetchable URL for a stored path. Meta LOADS the picture from it. */
function avesmapsSocialAbsoluteUrl(string $path): string
{
    if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
        return $path;
    }
    // A cron run has no HTTP_HOST; the live host is the only sensible fallback and is not a secret.
    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $base = $host === '' ? 'https://avesmaps.de' : 'https://' . $host;

    return $base . '/' . ltrim($path, '/');
}

/**
 * 💣 LIVE FIRST, THEN POST (Entwurf §5). The same trap as the Discord picture: post before the URL
 * serves 200 and the network caches the failure -- the post then carries an empty picture for good,
 * and re-uploading does not fix it.
 *
 * Fails CLOSED: anything other than a 2xx is "not reachable". The caller records that as the
 * target's error, so the editor sees WHY nothing went out and can retry that one channel.
 */
function avesmapsSocialMediaIsReachable(string $absoluteUrl): bool
{
    if ($absoluteUrl === '' || !function_exists('curl_init')) {
        return false;
    }
    $handle = curl_init($absoluteUrl);
    if ($handle === false) {
        return false;
    }
    curl_setopt_array($handle, [
        CURLOPT_NOBODY => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_RETURNTRANSFER => true,
    ]);
    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    return $status >= 200 && $status < 300;
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

Befehl wie Schritt 2. Erwartet: `media-test: OK`.

- [ ] **Schritt 5: Commit**

```bash
git add api/_internal/social/media.php api/_internal/social/__tests__/media-test.php
git commit -m "feat(social): Bild-Pipeline -- alles wird JPEG, Zuschnitt statt Verzerrung, Transparenz auf Weiss"
```

---

## Aufgabe 5: Der Speicher

**Dateien:**
- Anlegen: `api/_internal/social/store.php`

**Schnittstellen:**
- Liefert: `avesmapsSocialEnsureTables(PDO $pdo): void` ·
  `avesmapsSocialCreatePost(PDO $pdo, array $post, array $channelKeys): int` ·
  `avesmapsSocialLoadPost(PDO $pdo, int $id): ?array` ·
  `avesmapsSocialListPosts(PDO $pdo, int $limit = 50): list<array>` ·
  `avesmapsSocialSetPostState(PDO $pdo, int $id, string $state): void` ·
  `avesmapsSocialUpdateTarget(PDO $pdo, int $postId, string $channelKey, array $fields): void` ·
  `avesmapsSocialTokenKeys(PDO $pdo): list<string>` ·
  `avesmapsSocialTokenGet(PDO $pdo, string $channelKey): ?array` ·
  `avesmapsSocialTokenSet(PDO $pdo, string $channelKey, string $token, ?string $expiresAt): void`
- Zustände: `social_post.state` ∈ `proposal | released | discarded` ·
  `social_post_target.status` ∈ `pending | sent | failed | scheduled`

⚠️ **Nicht lokal testbar** (keine lokale MySQL). Die Regeln, die ohne DB entscheidbar sind, stehen
in Aufgabe 2–4 und sind dort geprüft. Diese Aufgabe wird nach dem Deploy live geprüft (Aufgabe 13).

- [ ] **Schritt 1: Die Datei schreiben**

`api/_internal/social/store.php`:

```php
<?php

declare(strict_types=1);

// Storage for the social hub (Entwurf §6): one post, N targets -- because the status belongs to the
// CHANNEL, not to the post. A post goes to three networks and each can fail on its own; a shared
// "sent" swallows the case where Mastodon refused, and nobody notices until someone asks why nothing
// is there.
//
// Self-healing DDL, like the rest of this codebase (AGENTS.md §5).
// 💣 NEVER inside a transaction: CREATE TABLE commits implicitly in MySQL and tears the surrounding
// transaction apart. avesmapsSocialEnsureTables is called before any transaction begins, never inside.
//
// 🔴 THE ROTATING TOKEN LIVES HERE, NOT IN config.local.php (owner decision 2026-08-10). An access
// token the server refreshes by itself cannot live in a hand-edited PHP file: rewriting PHP source
// on a schedule means parsing and re-emitting it, and the first failed write leaves a broken config
// that takes the whole site down. So config.local.php keeps what never changes (app id, app secret,
// the endpoint's own app_token, the kill switch) and this table keeps what rotates. Only the owner
// has database access.

require_once __DIR__ . '/channels.php';

function avesmapsSocialEnsureTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS social_post (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            body TEXT NOT NULL,
            hashtags VARCHAR(500) NOT NULL DEFAULT '',
            media_url VARCHAR(500) NOT NULL DEFAULT '',
            media_kind VARCHAR(16) NOT NULL DEFAULT '',
            media_license VARCHAR(32) NOT NULL DEFAULT '',
            media_source VARCHAR(300) NOT NULL DEFAULT '',
            origin VARCHAR(16) NOT NULL DEFAULT 'editor',
            state VARCHAR(16) NOT NULL DEFAULT 'released',
            author_user_id INT UNSIGNED NULL,
            author_name VARCHAR(80) NOT NULL DEFAULT '',
            source_ref VARCHAR(190) NULL DEFAULT NULL,
            scheduled_for DATETIME NULL DEFAULT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uniq_source_ref (source_ref),
            KEY idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    // 💣 `body`, not `text` -- TEXT is a reserved word in MySQL and every query would need backticks.
    // 💣 source_ref is NULLABLE with a UNIQUE key on purpose: MySQL permits many NULLs in a unique
    //    index but only ONE ''. With a NOT NULL DEFAULT '' the second editor post of the day would be
    //    rejected as a duplicate -- the duplicate guard (Entwurf §8) would break exactly the posts it
    //    is not meant to touch.

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS social_post_target (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            post_id INT UNSIGNED NOT NULL,
            channel_key VARCHAR(32) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            remote_id VARCHAR(190) NOT NULL DEFAULT '',
            error VARCHAR(500) NOT NULL DEFAULT '',
            sent_payload MEDIUMTEXT NULL DEFAULT NULL,
            attempted_at DATETIME(3) NULL DEFAULT NULL,
            UNIQUE KEY uniq_post_channel (post_id, channel_key),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    // `sent_payload` is filled by the PROBE adapter only: it is what the channel WOULD have sent
    // (Entwurf §10), and it is what makes the probe useful after Stufe 1 too. A real adapter leaves
    // it NULL -- storing every published caption twice would be bloat, the caption is in `body`.

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS social_token (
            channel_key VARCHAR(32) NOT NULL PRIMARY KEY,
            access_token TEXT NOT NULL,
            expires_at DATETIME NULL DEFAULT NULL,
            refreshed_at DATETIME(3) NULL DEFAULT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

/**
 * Create a post and its targets in ONE transaction. A post whose targets are missing is worse than
 * no post: the list shows it as published with no channel to prove it.
 *
 * @param array<string, mixed> $post
 * @param list<string>         $channelKeys
 */
function avesmapsSocialCreatePost(PDO $pdo, array $post, array $channelKeys): int
{
    // DDL FIRST, outside the transaction -- see the note above.
    avesmapsSocialEnsureTables($pdo);

    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare(
            'INSERT INTO social_post
                (body, hashtags, media_url, media_kind, media_license, media_source,
                 origin, state, author_user_id, author_name, source_ref, scheduled_for)
             VALUES (:body, :hashtags, :media_url, :media_kind, :media_license, :media_source,
                     :origin, :state, :author_user_id, :author_name, :source_ref, :scheduled_for)'
        );
        $insert->execute([
            'body' => (string) ($post['body'] ?? ''),
            'hashtags' => (string) ($post['hashtags'] ?? ''),
            'media_url' => (string) ($post['media_url'] ?? ''),
            'media_kind' => (string) ($post['media_kind'] ?? ''),
            'media_license' => (string) ($post['media_license'] ?? ''),
            'media_source' => (string) ($post['media_source'] ?? ''),
            'origin' => (string) ($post['origin'] ?? 'editor'),
            'state' => (string) ($post['state'] ?? 'released'),
            'author_user_id' => $post['author_user_id'] ?? null,
            'author_name' => (string) ($post['author_name'] ?? ''),
            // '' would collide on the unique key for the second post ever. NULL is the absence.
            'source_ref' => ($post['source_ref'] ?? '') === '' ? null : (string) $post['source_ref'],
            'scheduled_for' => $post['scheduled_for'] ?? null,
        ]);
        $postId = (int) $pdo->lastInsertId();

        $target = $pdo->prepare(
            'INSERT INTO social_post_target (post_id, channel_key, status) VALUES (:pid, :key, :status)'
        );
        $status = ($post['scheduled_for'] ?? null) === null ? 'pending' : 'scheduled';
        foreach ($channelKeys as $key) {
            if (avesmapsSocialChannel((string) $key) === null) {
                continue; // an unknown key never becomes a target -- it would never be dispatchable
            }
            $target->execute(['pid' => $postId, 'key' => (string) $key, 'status' => $status]);
        }

        $pdo->commit();

        return $postId;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

/** @return array<string, mixed>|null The post with a 'targets' list, or null. */
function avesmapsSocialLoadPost(PDO $pdo, int $id): ?array
{
    avesmapsSocialEnsureTables($pdo);
    $statement = $pdo->prepare('SELECT * FROM social_post WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $id]);
    $post = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($post)) {
        return null;
    }
    $targets = $pdo->prepare('SELECT * FROM social_post_target WHERE post_id = :id ORDER BY id');
    $targets->execute(['id' => $id]);
    $post['targets'] = $targets->fetchAll(PDO::FETCH_ASSOC) ?: [];

    return $post;
}

/**
 * Newest first (Entwurf §2.2). Discarded proposals stay out of the list -- they were never public
 * and re-showing them would make "Verwerfen" look broken.
 *
 * @return list<array<string, mixed>>
 */
function avesmapsSocialListPosts(PDO $pdo, int $limit = 50): array
{
    avesmapsSocialEnsureTables($pdo);
    $limit = max(1, min(200, $limit));
    $posts = $pdo->query(
        "SELECT * FROM social_post WHERE state <> 'discarded' ORDER BY created_at DESC, id DESC LIMIT " . $limit
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($posts === []) {
        return [];
    }

    // ONE query for all targets, not one per post: the list is the editor panel's landing view and
    // an N+1 over 50 posts is exactly the hotspot AGENTS.md §10 already names elsewhere.
    $ids = array_map(static fn(array $row): int => (int) $row['id'], $posts);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'SELECT * FROM social_post_target WHERE post_id IN (' . $placeholders . ') ORDER BY id'
    );
    $statement->execute($ids);

    $byPost = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $target) {
        $byPost[(int) $target['post_id']][] = $target;
    }
    foreach ($posts as &$post) {
        $post['targets'] = $byPost[(int) $post['id']] ?? [];
    }
    unset($post);

    return $posts;
}

function avesmapsSocialSetPostState(PDO $pdo, int $id, string $state): void
{
    if (!in_array($state, ['proposal', 'released', 'discarded'], true)) {
        throw new InvalidArgumentException('Unknown post state: ' . $state);
    }
    avesmapsSocialEnsureTables($pdo);
    $pdo->prepare('UPDATE social_post SET state = :state WHERE id = :id')
        ->execute(['state' => $state, 'id' => $id]);
}

/**
 * Write the outcome of ONE channel. Never touches the others -- that separation is the whole point
 * of the two-table model (Entwurf §2.2).
 *
 * @param array{status?: string, remote_id?: string, error?: string, sent_payload?: string|null} $fields
 */
function avesmapsSocialUpdateTarget(PDO $pdo, int $postId, string $channelKey, array $fields): void
{
    avesmapsSocialEnsureTables($pdo);
    $pdo->prepare(
        'UPDATE social_post_target
            SET status = :status,
                remote_id = :remote_id,
                error = :error,
                sent_payload = :sent_payload,
                attempted_at = CURRENT_TIMESTAMP(3)
          WHERE post_id = :pid AND channel_key = :key'
    )->execute([
        'status' => (string) ($fields['status'] ?? 'pending'),
        'remote_id' => mb_substr((string) ($fields['remote_id'] ?? ''), 0, 190),
        // Truncated, not rejected: an adapter's error text is not ours to bound, and a failed UPDATE
        // would lose the very diagnosis the editor needs.
        'error' => mb_substr((string) ($fields['error'] ?? ''), 0, 500),
        'sent_payload' => $fields['sent_payload'] ?? null,
        'pid' => $postId,
        'key' => $channelKey,
    ]);
}

/** @return list<string> Channel keys that have a stored token. Feeds the availability check. */
function avesmapsSocialTokenKeys(PDO $pdo): array
{
    try {
        $rows = $pdo->query('SELECT channel_key FROM social_token')->fetchAll(PDO::FETCH_COLUMN) ?: [];
    } catch (PDOException) {
        // No table means nobody ever stored a token. That is an answer, not an error -- and it must
        // not run DDL: this is read on the editor panel's landing view.
        return [];
    }

    return array_map('strval', $rows);
}

/** @return array{access_token: string, expires_at: ?string, refreshed_at: ?string}|null */
function avesmapsSocialTokenGet(PDO $pdo, string $channelKey): ?array
{
    avesmapsSocialEnsureTables($pdo);
    $statement = $pdo->prepare(
        'SELECT access_token, expires_at, refreshed_at FROM social_token WHERE channel_key = :key LIMIT 1'
    );
    $statement->execute(['key' => $channelKey]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($row) ? [
        'access_token' => (string) $row['access_token'],
        'expires_at' => $row['expires_at'] === null ? null : (string) $row['expires_at'],
        'refreshed_at' => $row['refreshed_at'] === null ? null : (string) $row['refreshed_at'],
    ] : null;
}

function avesmapsSocialTokenSet(PDO $pdo, string $channelKey, string $token, ?string $expiresAt): void
{
    avesmapsSocialEnsureTables($pdo);
    $pdo->prepare(
        'INSERT INTO social_token (channel_key, access_token, expires_at, refreshed_at)
         VALUES (:key, :token, :expires, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE access_token = VALUES(access_token),
                                 expires_at = VALUES(expires_at),
                                 refreshed_at = CURRENT_TIMESTAMP(3)'
    )->execute(['key' => $channelKey, 'token' => $token, 'expires' => $expiresAt]);
}
```

- [ ] **Schritt 2: Syntax prüfen**

```bash
php -l api/_internal/social/store.php
```
Erwartet: `No syntax errors detected`.

- [ ] **Schritt 3: Commit**

```bash
git add api/_internal/social/store.php
git commit -m "feat(social): Speicher fuer Beitraege, Ziele und rotierende Tokens -- Status je Kanal"
```

---

## Aufgabe 6: Probe-Adapter und Versand

**Dateien:**
- Anlegen: `api/_internal/social/adapters/probe.php`, `api/_internal/social/publish.php`
- Test: `api/_internal/social/__tests__/publish-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsSocialChannel()`, `avesmapsSocialCompose()`,
  `avesmapsSocialMediaIsReachable()`, `avesmapsSocialAbsoluteUrl()`, `avesmapsSocialUpdateTarget()`
- Liefert:
  - `avesmapsSocialAdapterProbe(array $post, array $channel, string $caption, string $mediaUrl): array`
  - `avesmapsSocialAdapterFor(string $key): ?callable`
  - `avesmapsSocialCheckTarget(array $post, array $channel, string $caption): ?string` — **rein**,
    liefert die Absage als deutschen Text oder `null`, wenn nichts dagegen spricht
  - `avesmapsSocialDispatch(PDO $pdo, int $postId, array $config, ?string $onlyChannel = null): array`
- Adapter-Vertrag: `array{ok: bool, remote_id?: string, error?: string, payload?: string}`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

`api/_internal/social/__tests__/publish-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the dispatch GATE and the probe adapter. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/publish-test.php
 *
 * avesmapsSocialDispatch itself needs a database and is verified live (plan task 13). What IS
 * testable, and is where a mistake goes public, is the pure gate in front of every adapter:
 * avesmapsSocialCheckTarget. It answers one question -- may this post go to this channel? -- and it
 * must answer it in GERMAN, because the answer lands in the editor's list as the failure reason.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../compose.php';
require __DIR__ . '/../publish.php';

$instagram = avesmapsSocialChannel('instagram');
$mastodon = avesmapsSocialChannel('mastodon');
$probe = avesmapsSocialChannel('probe');

// --- the gate -------------------------------------------------------------------------------------

assert(avesmapsSocialCheckTarget(['media_url' => '/uploads/social/x.jpg'], $instagram, 'Hallo') === null,
    'picture present, text short: nothing speaks against it');

// 💣 Instagram without a picture is not a post. Catching it here rather than at the API means the
// editor learns it in the list, not from a 400 nobody reads.
$noMedia = avesmapsSocialCheckTarget(['media_url' => ''], $instagram, 'Hallo');
assert(is_string($noMedia) && $noMedia !== '', 'instagram without a picture is refused');
assert(mb_stripos($noMedia, 'bild') !== false, 'and the refusal says WHY, in German, naming the picture');

assert(avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, 'Hallo') === null,
    'mastodon takes a text-only post');
assert(avesmapsSocialCheckTarget(['media_url' => ''], $probe, 'Hallo') === null,
    'so does the probe -- it must be able to rehearse a text-only post');

$tooLong = avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, str_repeat('x', 501));
assert(is_string($tooLong), '501 characters against mastodon is refused');
assert(mb_strpos($tooLong, '500') !== false,
    'and it names the LIMIT -- "zu lang" without a number tells the editor nothing');

assert(avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, '') !== null,
    'an empty caption is refused: an empty public post is never what anyone meant');

// --- the probe adapter -----------------------------------------------------------------------------

$result = avesmapsSocialAdapterProbe(
    ['media_url' => '/uploads/social/x.jpg'],
    $probe,
    "Hallo\n\n#DSA",
    'https://avesmaps.de/uploads/social/x.jpg'
);
assert($result['ok'] === true, 'the probe always succeeds -- it is a rehearsal, not a network');
assert(str_starts_with((string) $result['remote_id'], 'probe-'),
    'its remote id is marked as fake, so nobody mistakes it for a real post id');
assert(isset($result['payload']) && $result['payload'] !== '',
    'and it RECORDS what it would have sent -- that is the whole point (Entwurf §10)');
$payload = json_decode((string) $result['payload'], true);
assert(is_array($payload), 'the record is JSON, so the panel can render it');
assert(($payload['caption'] ?? '') === "Hallo\n\n#DSA",
    'the recorded caption is the FINAL one, hashtags already folded in -- a record of the input would prove nothing');
assert(($payload['media_url'] ?? '') === 'https://avesmaps.de/uploads/social/x.jpg',
    'and the ABSOLUTE url, because that is what a real network would be handed');

// --- the adapter registry ---------------------------------------------------------------------------

assert(is_callable(avesmapsSocialAdapterFor('probe')), 'the probe has an adapter');
assert(avesmapsSocialAdapterFor('instagram') === null,
    'instagram has NONE yet -- Stufe 2. A missing adapter must be null, never a silent no-op that
     reports success and posts nothing.');
assert(avesmapsSocialAdapterFor('nope') === null, 'an unknown key has none either');

fwrite(STDOUT, "publish-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Rotmeldung bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/social/__tests__/publish-test.php
```
Erwartet: FAIL — `Failed opening required '.../publish.php'`.

- [ ] **Schritt 3: Den Probe-Adapter schreiben**

`api/_internal/social/adapters/probe.php`:

```php
<?php

declare(strict_types=1);

// The rehearsal channel (Entwurf §10). It runs the ENTIRE chain -- licence gate, JPEG conversion,
// crop, storage, reachability probe, per-channel composition, status write -- and then, instead of
// calling a network, records what it would have sent.
//
// That is what makes Stufe 1 finishable: everything is verifiable BEFORE a single access token
// exists. It stays useful afterwards as a dry run for a post nobody should see yet.
//
// 💣 It always succeeds. A probe that could fail would be testing itself, not the chain. Everything
// that CAN legitimately refuse -- missing picture, caption too long, picture not reachable -- has
// already refused in avesmapsSocialCheckTarget, before any adapter is called.

/**
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 * @return array{ok: bool, remote_id: string, payload: string}
 */
function avesmapsSocialAdapterProbe(array $post, array $channel, string $caption, string $mediaUrl): array
{
    $payload = [
        'channel' => $channel['label'] ?? 'Probe',
        // The FINAL caption, hashtags already folded in and truncated per channel. Recording the raw
        // input would prove nothing about what a network would receive.
        'caption' => $caption,
        'caption_chars' => mb_strlen($caption),
        // The ABSOLUTE url -- Meta loads the picture from it, so that is the string that matters.
        'media_url' => $mediaUrl,
        'media_license' => (string) ($post['media_license'] ?? ''),
        'clickable_links' => (bool) ($channel['clickable_links'] ?? true),
    ];

    return [
        'ok' => true,
        // Marked as synthetic. A bare number here would be indistinguishable from a real post id in
        // the list, and someone would eventually go looking for it on Instagram.
        'remote_id' => 'probe-' . bin2hex(random_bytes(6)),
        'payload' => (string) json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ];
}
```

- [ ] **Schritt 4: Den Versand schreiben**

`api/_internal/social/publish.php`:

```php
<?php

declare(strict_types=1);

// Dispatch: walk a post's targets, compose per channel, ask the adapter, write the status.
//
// 💣 THE STATUS BELONGS TO THE CHANNEL (Entwurf §2.2). One failing network must never mark the
// others failed, and must never be swallowed by a shared "sent". Every branch below writes exactly
// one target row.
//
// 💣 LIVE FIRST, THEN POST (Entwurf §5). The picture URL is probed ONCE per dispatch, before any
// adapter runs. Posting before the URL serves 200 makes the network cache the failure, and the post
// then carries an empty picture for good.

require_once __DIR__ . '/channels.php';
require_once __DIR__ . '/compose.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/adapters/probe.php';

/**
 * May this post go to this channel? Returns the refusal as GERMAN text (it lands in the editor's
 * list as the reason), or null when nothing speaks against it.
 *
 * Pure: no database, no HTTP. It is the one part of dispatch that can be unit-tested, and the part
 * where a mistake becomes a public post.
 *
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 */
function avesmapsSocialCheckTarget(array $post, array $channel, string $caption): ?string
{
    if (trim($caption) === '') {
        return 'Der Beitrag hat keinen Text — ein leerer Beitrag wird nicht gesendet.';
    }

    if (($channel['requires_media'] ?? false) === true && trim((string) ($post['media_url'] ?? '')) === '') {
        return $channel['label'] . ' braucht ein Bild. Ohne Anhang wird dort nichts veröffentlicht.';
    }

    $maxChars = $channel['max_chars'] ?? null;
    if ($maxChars !== null && mb_strlen($caption) > (int) $maxChars) {
        // The number is part of the message on purpose: "zu lang" leaves the editor guessing by how
        // much, and the hashtags are usually the surprise.
        return $channel['label'] . ': ' . mb_strlen($caption) . ' Zeichen, erlaubt sind '
            . (int) $maxChars . ' (Hashtags zählen mit).';
    }

    return null;
}

/**
 * The adapter for a channel, or null when there is none yet.
 *
 * 🔴 A missing adapter is NULL, never a no-op that reports success. Stufe 1 has exactly one adapter;
 * a silent no-op would mark Instagram "gesendet" with nothing on Instagram -- the single worst
 * failure mode this whole design is built to avoid.
 */
function avesmapsSocialAdapterFor(string $key): ?callable
{
    return match ($key) {
        'probe' => 'avesmapsSocialAdapterProbe',
        default => null,
    };
}

/**
 * Send one post to its pending targets (or to just one channel, for "Erneut").
 *
 * @param array<string, mixed> $config      The full API config; the 'social' block gates everything.
 * @param string|null          $onlyChannel Retry exactly this channel, leaving the others untouched.
 * @return array{ok: bool, results: array<string, array<string, mixed>>}
 */
function avesmapsSocialDispatch(PDO $pdo, int $postId, array $config, ?string $onlyChannel = null): array
{
    $social = is_array($config['social'] ?? null) ? $config['social'] : [];

    $post = avesmapsSocialLoadPost($pdo, $postId);
    if ($post === null) {
        return ['ok' => false, 'results' => []];
    }

    // THE KILL SWITCH (Entwurf §8). Off means nothing leaves, and every target says so instead of
    // sitting at 'pending' with no explanation. The probe is NOT exempt: "stoppt jedes Senden".
    $enabled = ($social['enabled'] ?? true) !== false;

    // The picture is probed ONCE, not per channel -- three HEAD requests for one file would be three
    // chances to time out on shared hosting.
    $mediaUrl = trim((string) ($post['media_url'] ?? ''));
    $absoluteMediaUrl = $mediaUrl === '' ? '' : avesmapsSocialAbsoluteUrl($mediaUrl);
    $mediaReachable = $mediaUrl === '' ? true : avesmapsSocialMediaIsReachable($absoluteMediaUrl);

    $hashtags = avesmapsSocialNormalizeHashtags((string) ($post['hashtags'] ?? ''));
    $results = [];

    foreach ($post['targets'] as $target) {
        $key = (string) $target['channel_key'];
        if ($onlyChannel !== null && $key !== $onlyChannel) {
            continue;
        }
        // Already sent stays sent. A retry of a whole post must never post twice to a channel that
        // succeeded -- on Instagram that is a duplicate nobody can edit away, only delete.
        if ($onlyChannel === null && (string) $target['status'] === 'sent') {
            continue;
        }

        $channel = avesmapsSocialChannel($key);
        if ($channel === null) {
            $results[$key] = ['status' => 'failed', 'error' => 'Unbekannter Kanal.'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        if (!$enabled) {
            $results[$key] = ['status' => 'failed', 'error' => 'Das Senden ist serverseitig abgeschaltet (social.enabled = false).'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        $composed = avesmapsSocialCompose((string) $post['body'], $hashtags, $channel);
        $refusal = avesmapsSocialCheckTarget($post, $channel, $composed['caption']);
        if ($refusal !== null) {
            $results[$key] = ['status' => 'failed', 'error' => $refusal];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        if (!$mediaReachable) {
            $results[$key] = ['status' => 'failed', 'error' =>
                'Das Bild war unter ' . $absoluteMediaUrl . ' nicht erreichbar. '
                . 'Es wurde nichts gesendet — sonst merkt sich das Netz den Fehlschlag.'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        $adapter = avesmapsSocialAdapterFor($key);
        if ($adapter === null) {
            $results[$key] = ['status' => 'failed', 'error' => $channel['label'] . ' ist noch nicht eingerichtet.'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        try {
            $outcome = $adapter($post, $channel, $composed['caption'], $absoluteMediaUrl);
        } catch (Throwable $error) {
            // An adapter that throws must not take the other channels down with it, and its exception
            // text must not reach the client verbatim (AGENTS.md §10, info disclosure).
            $outcome = ['ok' => false, 'error' => 'Der Kanal hat unerwartet abgebrochen.'];
        }

        $results[$key] = ($outcome['ok'] ?? false) === true
            ? ['status' => 'sent', 'remote_id' => (string) ($outcome['remote_id'] ?? ''),
               'error' => '', 'sent_payload' => $outcome['payload'] ?? null]
            : ['status' => 'failed', 'error' => (string) ($outcome['error'] ?? 'Unbekannter Fehler.')];
        avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
    }

    // ok means "the run completed", NOT "everything was sent". Per-channel truth lives in results --
    // collapsing it into one boolean is exactly the swallowing §2.2 forbids.
    return ['ok' => true, 'results' => $results];
}
```

- [ ] **Schritt 5: Test laufen lassen, grün bestätigen**

Befehl wie Schritt 2. Erwartet: `publish-test: OK`.

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/social/publish.php api/_internal/social/adapters/probe.php api/_internal/social/__tests__/publish-test.php
git commit -m "feat(social): Probe-Kanal und Versand -- die volle Kette laeuft, bevor es einen Zugang gibt"
```

---

## Aufgabe 7: Der Upload-Endpunkt

**Dateien:**
- Anlegen: `api/edit/social/media.php`

**Schnittstellen:**
- Verbraucht: `avesmapsSocialEncodeImageBytes()`, `avesmapsSocialMediaFitsChannels()`,
  `AVESMAPS_SOCIAL_MEDIA_TYPES`, `AVESMAPS_SOCIAL_UPLOAD_DIR`
- Antwortet: `{ok:true, url, width, height, cropped, bytes, fits:[…]}`

🔴 **Der Rechteriegel steht VOR dem ersten Byte auf der Platte** — genau wie in
`api/edit/map/citymap-image.php`. Ein versteckter Knopf ist kein Riegel: wer die Fähigkeit hat,
kann den Endpunkt direkt rufen. Was hier rausgeht, steht öffentlich unter dem Namen Avesmaps und
lässt sich nicht zurückholen.

- [ ] **Schritt 1: Den Endpunkt schreiben**

`api/edit/social/media.php`:

```php
<?php

declare(strict_types=1);

// Upload for the social hub (Entwurf §5). Form-POST with a file field `media`.
//
// 🔴 THE RIGHTS GATE RUNS BEFORE A SINGLE BYTE REACHES THE DISK, exactly as in citymap-image.php.
// A hidden button is not enforcement: anyone holding the capability can POST here directly. And the
// stake is higher than for a city map -- what leaves here stands publicly under the project's name
// and cannot be recalled. A scan from a DSA book would not be an inaccuracy, it would be a copyright
// infringement under the editors' own name (Entwurf §5).
//
// NO server-side fetch of a remote picture, ever -- that would make this a general-purpose fetcher
// for anyone with a session (SSRF). Upload only.
//
// Files land in /uploads/social/, deliberately NOT in the repository: it would grow with every post.
// The directory has no .htaccess and must not get one -- Meta LOADS the picture from its public URL,
// it cannot be attached.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/media.php';

const AVESMAPS_SOCIAL_LICENSES = ['own_work', 'free_license'];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Medien hochladen.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('social');

    // --- THE RIGHTS GATE, first ---------------------------------------------------------------
    $license = trim((string) ($_POST['license'] ?? ''));
    if (!in_array($license, AVESMAPS_SOCIAL_LICENSES, true)) {
        avesmapsErrorResponse(400, 'invalid_request',
            'Bitte Herkunft und Rechte angeben: eigenes Werk oder freie Lizenz.');
    }
    $source = trim((string) ($_POST['source'] ?? ''));
    if ($license === 'free_license' && $source === '') {
        // "Free licence" without a source is an unverifiable claim. Naming it is the entire value of
        // the option; without the name it is indistinguishable from "I found it somewhere".
        avesmapsErrorResponse(400, 'invalid_request',
            'Bei freier Lizenz muss die Quelle angegeben werden.');
    }

    $file = $_FILES['media'] ?? null;
    if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
        || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        avesmapsErrorResponse(400, 'invalid_request', 'Keine Datei empfangen.');
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > AVESMAPS_SOCIAL_MEDIA_MAX_BYTES) {
        avesmapsErrorResponse(413, 'payload_too_large', 'Datei fehlt oder ist zu groß (max 12 MB).');
    }

    $tmp = (string) $file['tmp_name'];
    // finfo sniffs the real bytes; $_FILES['type'] is client-supplied and means nothing.
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
    if (!isset(AVESMAPS_SOCIAL_MEDIA_TYPES[$mime])) {
        avesmapsErrorResponse(415, 'unsupported_media_type', 'Nur PNG, JPG oder WebP erlaubt.');
    }

    $raw = (string) @file_get_contents($tmp);
    $encoded = avesmapsSocialEncodeImageBytes($raw);
    if ($encoded['bytes'] === '') {
        avesmapsErrorResponse(415, 'unsupported_media_type', 'Das Bild konnte nicht gelesen werden.');
    }

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . AVESMAPS_SOCIAL_UPLOAD_DIR;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        avesmapsErrorResponse(500, 'server_error', 'Upload-Verzeichnis nicht verfügbar.');
    }

    // Random name, never the uploaded one: an editor's filename is neither unique nor safe as a path.
    $filename = 'post-' . bin2hex(random_bytes(8)) . '.' . $encoded['ext'];
    $target = $dir . '/' . $filename;
    if (@file_put_contents($target, $encoded['bytes']) === false) {
        avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($target, 0644);

    $url = AVESMAPS_SOCIAL_UPLOAD_DIR . '/' . $filename;
    avesmapsJsonResponse(200, [
        'ok' => true,
        'url' => $url,
        'width' => $encoded['width'],
        'height' => $encoded['height'],
        'cropped' => $encoded['cropped'],
        'bytes' => strlen($encoded['bytes']),
        // What the hub shows as "✓ Passt für …" BEFORE publishing -- the whole reason this endpoint
        // reports the size back instead of just a URL.
        'fits' => avesmapsSocialMediaFitsChannels($encoded['width'], $encoded['height']),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
```

- [ ] **Schritt 2: Syntax prüfen**

```bash
php -l api/edit/social/media.php
```
Erwartet: `No syntax errors detected`.

- [ ] **Schritt 3: Das Gate ohne Datenbank beweisen**

Die Rechteprüfung steht **vor** dem ersten PDO, also ist sie lokal beweisbar. Sonde anlegen unter
`C:\Users\mail\AppData\Local\Temp\claude\...\scratchpad\probe-social-media.php`:

```php
<?php
// Probe: does api/edit/social/media.php refuse an anonymous caller?
// The dead DB port (:1) is the trick -- if the code ever reached the database there would be an
// immediate 500, so the probe cannot fake a passing gate.
register_shutdown_function(static function (): void {
    fwrite(STDERR, "STATUS=" . http_response_code() . "\n");
});
$_SERVER['REQUEST_METHOD'] = 'POST';
require __DIR__ . '/../../../../GIT/avesmaps/api/edit/social/media.php';
```

```bash
AVESMAPS_DB_DRIVER=mysql AVESMAPS_DB_HOST=127.0.0.1 AVESMAPS_DB_PORT=1 AVESMAPS_DB_NAME=x AVESMAPS_DB_USER=x AVESMAPS_DB_PASSWORD=x php -d session.save_path=/tmp <scratchpad>/probe-social-media.php
```
Erwartet: `STATUS=401` und `{"ok":false,"error":{"code":"unauthenticated",…}}`.
💣 **401, nicht 400.** Käme 400, stünde die Rechteprüfung hinter dem Rumpf — dann wäre die Sonde
kein Beweis für „gesperrt", sondern nur dafür, dass der Rumpf leer war.

- [ ] **Schritt 4: Commit**

```bash
git add api/edit/social/media.php
git commit -m "feat(social): Upload mit Rechteriegel -- gewandelt zu JPEG, bevor ein Byte auf der Platte liegt"
```

---

## Aufgabe 8: Liste, Veröffentlichen, Wiederholen

**Dateien:**
- Anlegen: `api/edit/social/list.php`, `api/edit/social/publish.php`, `api/edit/social/retry.php`

**Schnittstellen:**
- `GET /api/edit/social/list.php` → `{ok:true, channels:[…], vocabulary:[…], posts:[…]}`
- `POST /api/edit/social/publish.php`
  - `{action:"create", text, hashtags, channels:[…], media_url, media_license, media_source}` → `{ok, post_id, results}`
  - `{action:"approve", id}` → Vorschlag freigeben und senden
  - `{action:"discard", id}` → Vorschlag verwerfen
- `POST /api/edit/social/retry.php` `{id, channel}` → `{ok, result}`

- [ ] **Schritt 1: `list.php` schreiben**

```php
<?php

declare(strict_types=1);

// The read path for the "Social Media" subtab (Entwurf §2.2): the channel register, the shared
// hashtag vocabulary, and the posts with their PER-CHANNEL status.
//
// It carries no credential -- avesmapsSocialChannelList is built for exactly that.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/compose.php';
require_once __DIR__ . '/../../_internal/social/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Liste nicht lesen.');
    }
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    avesmapsRequireUserWithCapability('social');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $tokenKeys = avesmapsSocialTokenKeys($pdo);

    $posts = [];
    foreach (avesmapsSocialListPosts($pdo, 50) as $row) {
        $targets = [];
        foreach ($row['targets'] as $target) {
            $channel = avesmapsSocialChannel((string) $target['channel_key']);
            $targets[] = [
                'channel' => (string) $target['channel_key'],
                'label' => $channel === null ? (string) $target['channel_key'] : $channel['label'],
                'status' => (string) $target['status'],
                'error' => (string) $target['error'],
                'remote_id' => (string) $target['remote_id'],
                // Only the probe fills this. It is what makes the rehearsal inspectable.
                'sent_payload' => $target['sent_payload'] === null ? null : (string) $target['sent_payload'],
            ];
        }
        $posts[] = [
            'id' => (int) $row['id'],
            'text' => (string) $row['body'],
            'hashtags' => (string) $row['hashtags'],
            'media_url' => (string) $row['media_url'],
            'origin' => (string) $row['origin'],
            'state' => (string) $row['state'],
            // The author is INTERNAL (Entwurf §2.3): posts go out as Avesmaps, never under a personal
            // name. Who pressed the button is visible to editors only, which is exactly here.
            'author' => (string) $row['author_name'],
            'created_at' => (string) $row['created_at'],
            'scheduled_for' => $row['scheduled_for'] === null ? null : (string) $row['scheduled_for'],
            'targets' => $targets,
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'channels' => avesmapsSocialChannelList($social, $tokenKeys),
        'vocabulary' => AVESMAPS_SOCIAL_HASHTAG_VOCABULARY,
        'enabled' => ($social['enabled'] ?? true) !== false,
        'posts' => $posts,
    ]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
```

- [ ] **Schritt 2: `publish.php` schreiben**

```php
<?php

declare(strict_types=1);

// The write path: create and send, or release/discard a routine proposal (Entwurf §7, §9).
//
// 💣 A post is created and dispatched in ONE request. Splitting it would leave posts that exist but
// were never sent, indistinguishable in the list from ones that failed everywhere.
//
// 🔴 The author is recorded but never published. Posts go out as Avesmaps; who pressed the button
// stays internal (Entwurf §2.3).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/compose.php';
require_once __DIR__ . '/../../_internal/social/store.php';
require_once __DIR__ . '/../../_internal/social/publish.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf nicht veröffentlichen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('social');
    $request = avesmapsReadJsonRequest();
    $action = trim((string) ($request['action'] ?? 'create'));
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // --- release / discard a proposal ----------------------------------------------------------
    if ($action === 'approve' || $action === 'discard') {
        $id = (int) ($request['id'] ?? 0);
        if ($id <= 0) {
            avesmapsErrorResponse(400, 'invalid_request', 'id fehlt.');
        }
        if ($action === 'discard') {
            avesmapsSocialSetPostState($pdo, $id, 'discarded');
            avesmapsJsonResponse(200, ['ok' => true, 'id' => $id, 'state' => 'discarded']);
        }
        avesmapsSocialSetPostState($pdo, $id, 'released');
        $dispatch = avesmapsSocialDispatch($pdo, $id, $config);
        avesmapsJsonResponse(200, ['ok' => true, 'id' => $id, 'state' => 'released',
            'results' => $dispatch['results']]);
    }

    if ($action !== 'create') {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion.');
    }

    // --- create and send -------------------------------------------------------------------------
    $text = trim((string) ($request['text'] ?? ''));
    if ($text === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Der Beitrag braucht einen Text.');
    }
    $channels = is_array($request['channels'] ?? null) ? $request['channels'] : [];
    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $tokenKeys = avesmapsSocialTokenKeys($pdo);

    // A channel nobody configured must not become a target. Refusing here rather than recording a
    // failed target keeps "noch nicht eingerichtet" a UI state, not a post-mortem.
    $selected = [];
    foreach ($channels as $key) {
        $key = (string) $key;
        if (avesmapsSocialChannelIsConfigured($key, $social, $tokenKeys)) {
            $selected[] = $key;
        }
    }
    if ($selected === []) {
        avesmapsErrorResponse(400, 'invalid_request',
            'Kein nutzbarer Kanal ausgewählt. Der Probe-Kanal steht immer bereit.');
    }

    $mediaUrl = trim((string) ($request['media_url'] ?? ''));
    // Only our own upload directory. A client-supplied URL would let this endpoint publish an
    // arbitrary remote picture under the project's name.
    if ($mediaUrl !== '' && !str_starts_with($mediaUrl, AVESMAPS_SOCIAL_UPLOAD_DIR . '/')) {
        avesmapsErrorResponse(400, 'invalid_request', 'Das Bild muss über den Upload kommen.');
    }

    $postId = avesmapsSocialCreatePost($pdo, [
        'body' => $text,
        'hashtags' => implode(' ', avesmapsSocialNormalizeHashtags($request['hashtags'] ?? [])),
        'media_url' => $mediaUrl,
        'media_kind' => $mediaUrl === '' ? '' : 'image',
        'media_license' => (string) ($request['media_license'] ?? ''),
        'media_source' => (string) ($request['media_source'] ?? ''),
        'origin' => 'editor',
        'state' => 'released',
        'author_user_id' => (int) ($user['id'] ?? 0),
        'author_name' => (string) ($user['username'] ?? ''),
    ], $selected);

    $dispatch = avesmapsSocialDispatch($pdo, $postId, $config);
    avesmapsJsonResponse(200, ['ok' => true, 'post_id' => $postId, 'results' => $dispatch['results']]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
```

- [ ] **Schritt 3: `retry.php` schreiben**

```php
<?php

declare(strict_types=1);

// Retry EXACTLY ONE channel (Entwurf §2.2). The narrow scope is the point: a post that reached
// Instagram and failed on Mastodon must be repairable without posting to Instagram twice -- a
// duplicate there cannot be edited away, only deleted.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/publish.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf nicht senden.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('social');
    $request = avesmapsReadJsonRequest();
    $id = (int) ($request['id'] ?? 0);
    $channel = trim((string) ($request['channel'] ?? ''));
    if ($id <= 0 || avesmapsSocialChannel($channel) === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'id und channel werden gebraucht.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $dispatch = avesmapsSocialDispatch($pdo, $id, $config, $channel);
    if (!$dispatch['ok']) {
        avesmapsErrorResponse(404, 'not_found', 'Der Beitrag wurde nicht gefunden.');
    }

    avesmapsJsonResponse(200, ['ok' => true, 'id' => $id, 'channel' => $channel,
        'result' => $dispatch['results'][$channel] ?? null]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
```

- [ ] **Schritt 4: Syntax prüfen**

```bash
php -l api/edit/social/list.php && php -l api/edit/social/publish.php && php -l api/edit/social/retry.php
```
Erwartet: dreimal `No syntax errors detected`.

- [ ] **Schritt 5: Commit**

```bash
git add api/edit/social/list.php api/edit/social/publish.php api/edit/social/retry.php
git commit -m "feat(social): Endpunkte fuer Liste, Veroeffentlichen und das Wiederholen EINES Kanals"
```

---

## Aufgabe 9: Die Einlieferung der Routine

**Dateien:**
- Anlegen: `api/social/routine-post.php`

**Schnittstellen:**
- `POST /api/social/routine-post.php` mit Header `X-Avesmaps-Token`
  `{text, hashtags, channels, source_ref}` → `{ok, post_id, state:"proposal"}`

🔴 **Eigener Schlüssel `social.app_token`** — nicht der von Discord, nicht der des Änderungsverlaufs
(dieselbe Owner-Entscheidung wie am 08.08.2026 bei `changelog.app_token`). Wer eine Befugnis
sperren will, muss das einzeln können.

- [ ] **Schritt 1: Den Endpunkt schreiben**

```php
<?php

declare(strict_types=1);

// The routine's way in (Entwurf §9). It does NOT publish -- it files a PROPOSAL that waits in the
// editor's list for "Freigeben und veröffentlichen · Bearbeiten · Verwerfen".
//
// Why approval, when the Discord routine posts unattended: as long as only Discord was fed, the
// audience was the project's own community and a mistake was repairable with a second message. Once
// editors and the automation share a public channel, an unreviewed post is a public mistake under
// the project's name -- and an Instagram post cannot be edited afterwards, only deleted.
//
// 🔴 ITS OWN KEY: $config['social']['app_token'], never Discord's and never the changelog's. The same
// decision as on 2026-08-08: convenience is no reason to fuse two powers into one. Whoever wants to
// rotate or revoke one of them must be able to do it alone.
//
// ⚠️ Read from the HEADER only, never from ?token= -- an address line stands in the server log, a
// header does not.
//
// ⚠️ Missing key means the door is SHUT, not open. Between this deploy and the entry in
// config.local.php nothing can come in here, which is the correct direction to fail.

require __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/social/channels.php';
require_once __DIR__ . '/../_internal/social/compose.php';
require_once __DIR__ . '/../_internal/social/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $expected = (string) ($social['app_token'] ?? '');
    $sent = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? '');
    // hash_equals, not ===: a timing-safe comparison costs nothing here and the alternative leaks
    // the token one character at a time.
    if ($expected === '' || $sent === '' || !hash_equals($expected, $sent)) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Kein gültiger Schlüssel.');
    }

    $request = avesmapsReadJsonRequest();
    $text = trim((string) ($request['text'] ?? ''));
    if ($text === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Der Vorschlag braucht einen Text.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $tokenKeys = avesmapsSocialTokenKeys($pdo);
    $selected = [];
    foreach (is_array($request['channels'] ?? null) ? $request['channels'] : [] as $key) {
        $key = (string) $key;
        if (avesmapsSocialChannelIsConfigured($key, $social, $tokenKeys)) {
            $selected[] = $key;
        }
    }
    if ($selected === []) {
        $selected = ['probe'];  // always available; a proposal without a target could never be released
    }

    // The duplicate guard (Entwurf §8): source_ref carries the commit the proposal was built from,
    // exactly as the changelog does. The UNIQUE key turns a repeated run into a 409 instead of a
    // second identical proposal.
    $sourceRef = trim((string) ($request['source_ref'] ?? ''));
    try {
        $postId = avesmapsSocialCreatePost($pdo, [
            'body' => $text,
            'hashtags' => implode(' ', avesmapsSocialNormalizeHashtags($request['hashtags'] ?? [])),
            'origin' => 'routine',
            'state' => 'proposal',
            'author_name' => 'Automatisch',
            'source_ref' => $sourceRef,
        ], $selected);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            avesmapsErrorResponse(409, 'duplicate', 'Zu diesem Stand gibt es schon einen Vorschlag.');
        }
        throw $exception;
    }

    avesmapsJsonResponse(200, ['ok' => true, 'post_id' => $postId, 'state' => 'proposal']);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
```

- [ ] **Schritt 2: Syntax prüfen**

```bash
php -l api/social/routine-post.php
```
Erwartet: `No syntax errors detected`.

- [ ] **Schritt 3: Den geschlossenen Riegel beweisen**

Sonde wie in Aufgabe 7, Schritt 3, aber auf `api/social/routine-post.php`.
Erwartet: `STATUS=401` — **ohne** Schlüssel in der Konfiguration ist der Weg zu.

- [ ] **Schritt 4: Commit**

```bash
git add api/social/routine-post.php
git commit -m "feat(social): die Routine liefert Vorschlaege ein -- eigener Schluessel, Freigabe durch Menschen"
```

---

## Aufgabe 10: Der Unterreiter „Social Media"

**Dateien:**
- Ändern: `index.html` (Unterreiter-Knopf bei Z. 373–375, Abschnitt nach Z. 385, `<link>`/`<script>`)
- Anlegen: `css/components/social-hub.css`
- Anlegen: `js/review/review-social.js`
- Test: `js/review/__tests__/social-list.test.js`

**Schnittstellen:**
- Verbraucht: `GET /api/edit/social/list.php`, `POST /api/edit/social/retry.php`
- Liefert (für Aufgabe 11): `window.AvesmapsSocial = { reload, openHub, renderChip }`

⚠️ **Die Reiter-Kaskade wird nicht angefasst.** `REVIEW_TAB_FAMILIES` in `js/ui/ui-controls.js:558`
führt `data-review-subtab` bereits attributgetrieben — ein neuer Knopf mit einem neuen Wert wird
automatisch mitgeführt. **Niemals eine Werteliste dort eintragen.**

- [ ] **Schritt 1: Den Test für die Statusmarken schreiben**

`js/review/__tests__/social-list.test.js`:

```js
"use strict";
// 💣 What is tested is the DECISION the chip encodes, not the DOM: a chip is what tells an editor
// whether a post actually reached a network. Entwurf §2.2 -- one shared "gesendet" would swallow the
// case where Mastodon refused, and nobody notices until someone asks why nothing is there.
const assert = require("assert");
const { chipClass, chipLabel, canRetry } = require("../review-social.js");

assert.strictEqual(chipClass("sent"), "social-chip social-chip--ok", "gesendet ist gruen");
assert.strictEqual(chipClass("failed"), "social-chip social-chip--err", "fehler ist rot");
assert.strictEqual(chipClass("pending"), "social-chip social-chip--wait", "wartet ist neutral");
assert.strictEqual(chipClass("scheduled"), "social-chip social-chip--wait", "geplant ebenso");
// An unknown status must NOT render as success. A future status the client does not know yet would
// otherwise show up green -- the single most dangerous default here.
assert.strictEqual(chipClass("brandneu"), "social-chip social-chip--wait",
	"ein unbekannter Zustand faellt auf wartend, NIE auf gesendet");

assert.strictEqual(chipLabel({ label: "Instagram", status: "sent" }), "Instagram ✓");
assert.strictEqual(chipLabel({ label: "Mastodon", status: "failed" }), "Mastodon — Fehler");
assert.strictEqual(chipLabel({ label: "Facebook", status: "pending" }), "Facebook — wartet");
assert.strictEqual(chipLabel({ label: "Probe", status: "scheduled" }), "Probe — geplant");

// Only a failed channel gets a retry button -- and it retries THAT channel alone.
assert.strictEqual(canRetry({ status: "failed" }), true, "fehlgeschlagen darf wiederholt werden");
assert.strictEqual(canRetry({ status: "sent" }), false,
	"gesendet NICHT -- auf Instagram waere das ein Doppelbeitrag, der sich nur loeschen laesst");
assert.strictEqual(canRetry({ status: "pending" }), false, "wartend nicht");

console.log("social-list.test: OK");
```

- [ ] **Schritt 2: Test laufen lassen, Rotmeldung bestätigen**

```bash
node js/review/__tests__/social-list.test.js
```
Erwartet: FAIL — `Cannot find module '../review-social.js'`.

- [ ] **Schritt 3: `js/review/review-social.js` schreiben**

Struktur (IIFE wie `review-mail.js`, Export am Ende für den Test):

```js
(function () {
	"use strict";

	const LIST_API = "/api/edit/social/list.php";
	const PUBLISH_API = "/api/edit/social/publish.php";
	const RETRY_API = "/api/edit/social/retry.php";
	const MEDIA_API = "/api/edit/social/media.php";

	// 💣 Unknown falls to "wait", never to "ok". A status this client does not know yet -- added by a
	// later Stufe -- would otherwise render green, and green means "it is out there".
	function chipClass(status) {
		if (status === "sent") { return "social-chip social-chip--ok"; }
		if (status === "failed") { return "social-chip social-chip--err"; }
		return "social-chip social-chip--wait";
	}

	function chipLabel(target) {
		const label = (target && target.label) || "";
		if (target.status === "sent") { return label + " ✓"; }
		if (target.status === "failed") { return label + " — Fehler"; }
		if (target.status === "scheduled") { return label + " — geplant"; }
		return label + " — wartet";
	}

	function canRetry(target) { return !!target && target.status === "failed"; }

	// … Rendering, Laden, Erneut-Knopf, Hub (Aufgabe 11) …

	if (typeof window !== "undefined") {
		window.AvesmapsSocial = { reload: load, openHub: openHub };
	}
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { chipClass, chipLabel, canRetry };
	}
})();
```

Der Rest der Datei baut, **ausschließlich mit `createElement`, nie `innerHTML`** (der Text kommt von
Menschen und geht später öffentlich raus):

1. `load()` — `fetch(LIST_API, {credentials:"same-origin"})`, danach `renderList(res.posts)` und
   `renderChannels(res.channels)`. Wird beim ersten Aktivieren des Unterreiters gerufen und danach
   nach jedem Senden.
2. `renderList(posts)` — je Beitrag ein `.social-post` mit Kopfzeile (Herkunftskennzeichen
   `Automatisch` oder Editorname, Datum), Textanfang, und je Ziel eine Marke aus `chipClass` /
   `chipLabel`. Bei `canRetry(target)` daneben ein weicher Mini-Knopf „Erneut", der
   `POST RETRY_API {id, channel}` schickt und danach `load()` ruft.
3. Trägt ein Ziel ein `sent_payload`, bekommt die Marke einen aufklappbaren „Was gesendet worden
   wäre"-Kasten (`<details>`), der das JSON lesbar zeigt. **`<details>`, nicht selbstgebaut** —
   dieselbe Begründung wie beim Inhaltsverzeichnis der Hinweise (AGENTS.md §11).
4. Ist die Liste leer: „Noch nichts veröffentlicht." statt eines leeren Kastens.
5. `state === "proposal"` rendert den Freigabe-Kasten aus Aufgabe 11.

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
node js/review/__tests__/social-list.test.js
```
Erwartet: `social-list.test: OK`.

- [ ] **Schritt 5: Das Markup in `index.html`**

Nach dem `mails`-Knopf (Z. 375):

```html
					<button class="wiki-sync-panel__tab" type="button" data-review-subtab="social">Social Media</button>
```

Nach dem `mails`-Abschnitt (der bei Z. 385 beginnt) ein neuer Abschnitt:

```html
				<div class="wiki-sync-panel__tab-panel" data-review-subtab-section="social">
					<button id="social-open-hub" class="review-panel__button" type="button">✎ Social Media Hub öffnen</button>
					<p id="social-status" class="review-panel__status" role="status" aria-live="polite">Beiträge werden geladen …</p>
					<div id="social-post-list" class="review-panel__list"></div>
				</div>
```

Und bei den `<link>`s:

```html
		<link rel="stylesheet" href="css/components/social-hub.css">
```

Und nach `js/review/review-mail.js` (Z. 2840):

```html
		<script src="js/review/review-social.js"></script>
```

💣 **Kein `?v=` von Hand.** Der Deploy stempelt beides.

- [ ] **Schritt 6: `css/components/social-hub.css` anlegen**

Nur Tokens, kein Blau, weiche Zeilenhandlungen:

```css
/* Social-Media-Hub -- Liste im Reiter und das Hub-Fenster (Entwurf §2).
 *
 * ⚠️ Eine Zeilenhandlung ist nie die Haupthandlung (AGENTS.md §12): "Erneut" steht in jeder
 * fehlgeschlagenen Zeile und ist deshalb WEICH. Gefuellt ist allein "Social Media Hub oeffnen"
 * oben und "Veroeffentlichen" in der Fusszeile des Fensters. */

.social-post {
	border-top: 1px solid var(--color-divider);
	padding: 10px 0;
}
.social-post:first-child { border-top: 0; }

.social-post__top {
	display: flex;
	align-items: baseline;
	gap: 8px;
	margin-bottom: 4px;
}
.social-post__who {
	font-weight: 600;
	color: var(--color-text-strong);
}
.social-post__date {
	font-size: 12px;
	color: var(--color-text-muted);
}
.social-post__text {
	margin: 0 0 6px;
	color: var(--color-text);
}

.social-chips {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}
.social-chip {
	display: inline-flex;
	align-items: center;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	padding: 2px 8px;
	font-size: 12px;
	background: var(--color-panel-soft);
	color: var(--color-text);
}
.social-chip--ok { border-color: var(--color-status-ok); color: var(--color-status-ok); }
.social-chip--err { border-color: var(--color-status-error); color: var(--color-status-error); }
.social-chip--wait { color: var(--color-text-muted); }
```

⚠️ **Vor dem Schreiben die Tokennamen in `css/base/tokens.css` nachschlagen** und die dort
tatsächlich vorhandenen verwenden — `--color-status-ok` / `--color-status-error` /
`--color-panel-soft` / `--color-text-strong` sind hier Platzhalter für die realen Namen. Gibt es
keinen passenden, **erst das Token anlegen**, dann verwenden (AGENTS.md §12).

- [ ] **Schritt 7: Den Unterreiter nur mit der Fähigkeit zeigen**

In `review-social.js` beim Start:

```js
	// Der Riegel faellt GESCHLOSSEN aus, wie bei der Landschaftsebene: bis die Antwort da ist -- und
	// fuer immer, wenn sie nie kommt -- bleibt der Reiter weg. Er sendet oeffentlich; ein zu frueh
	// gezeigter Knopf waere schlimmer als ein spaet gezeigter.
	function applyCapability() {
		const may = !!(window.AvesmapsSession
			&& window.AvesmapsSession.current().capabilities.social);
		const tab = document.querySelector('[data-review-subtab="social"]');
		const section = document.querySelector('[data-review-subtab-section="social"]');
		if (tab) { tab.hidden = !may; }
		if (section && !may) { section.hidden = true; }
	}
	if (window.AvesmapsSession) { window.AvesmapsSession.load().then(applyCapability); }
	applyCapability();
```

- [ ] **Schritt 8: Commit**

```bash
git add index.html css/components/social-hub.css js/review/review-social.js js/review/__tests__/social-list.test.js
git commit -m "ui(social): neuer Unterreiter 'Social Media' unter Community -- Liste mit Status je Kanal"
```

---

## Aufgabe 11: Das Hub-Fenster und die Freigabe

**Dateien:**
- Ändern: `index.html` (Fenster-Markup), `css/components/dialog-overlays.css`,
  `css/components/social-hub.css`, `js/review/review-social.js`

💣 **Ein neues Overlay-`<div>` erbt NICHTS.** Die Modal-Regeln in
`css/components/dialog-overlays.css` sind nach **ID** verschlüsselt. `#social-hub-dialog` muss in
**drei** Selektorlisten eingetragen werden — `[hidden] { display:none !important }`, die
`position:fixed; inset:0; background: var(--color-scrim-dialog)`-Regel und die `z-index`-Regel.
Fehlt das, kommt ein gewöhnlicher Block mitten im Dokumentfluss heraus, kein Fenster. **In die
bestehenden Listen eintragen, keine eigene Regel schreiben.**

- [ ] **Schritt 1: Das Fenster-Markup in `index.html`**

Bei den übrigen Dialog-`<div>`s, nach dem Muster des Konfliktzentrums:

```html
		<div id="social-hub-dialog" class="social-hub" hidden role="dialog" aria-modal="true" aria-labelledby="social-hub-title">
			<div class="social-hub__frame">
				<div class="social-hub__head">
					<h2 id="social-hub-title">Social Media Hub</h2>
					<button id="social-hub-close" class="social-hub__close" type="button" aria-label="Schließen">✕</button>
				</div>
				<div class="social-hub__body">
					<div class="social-hub__main">
						<label class="social-hub__label" for="social-text">Text</label>
						<textarea id="social-text" rows="6"></textarea>
						<div id="social-count" class="social-hub__count"></div>

						<label class="social-hub__label" for="social-hashtags">Hashtags</label>
						<input id="social-hashtags" type="text" autocomplete="off">
						<div id="social-vocabulary" class="social-chips"></div>

						<label class="social-hub__label">Bild</label>
						<div class="social-chips">
							<label class="social-hub__file"><input id="social-file" type="file" accept="image/png,image/jpeg,image/webp"> ⬆ Eigene Datei</label>
							<button class="social-hub__soft" type="button" disabled title="Kommt später">🗺 Kartenausschnitt aufnehmen</button>
							<button class="social-hub__soft" type="button" disabled title="Kommt in Stufe 3">🎬 Video</button>
						</div>
						<div id="social-media-info" class="social-hub__media"></div>

						<label class="social-hub__label">Herkunft und Rechte</label>
						<label class="social-hub__radio"><input type="radio" name="social-license" value="own_work" checked>
							<span>Eigenes Werk / Avesmaps-Karte</span></label>
						<label class="social-hub__radio"><input type="radio" name="social-license" value="free_license">
							<span>Freie Lizenz — Quelle angeben</span></label>
						<input id="social-source" type="text" placeholder="Quelle" hidden>
						<p class="social-hub__warn">Keine Scans aus DSA-Publikationen, keine Ulisses-Artworks.
							Was hier rausgeht, steht öffentlich unter dem Namen Avesmaps.</p>
					</div>
					<div class="social-hub__side">
						<label class="social-hub__label">Kanäle</label>
						<div id="social-channels"></div>
					</div>
				</div>
				<div class="social-hub__foot">
					<span id="social-foot-note" class="social-hub__muted"></span>
					<button id="social-publish" class="review-panel__button" type="button">Veröffentlichen</button>
				</div>
			</div>
		</div>
```

- [ ] **Schritt 2: `#social-hub-dialog` in die drei Selektorlisten**

`css/components/dialog-overlays.css` öffnen, die drei Listen suchen und die ID **in die
vorhandenen Listen** eintragen (nicht als eigene Regel):

```css
#social-hub-dialog[hidden] { display: none !important; }
```
… beziehungsweise die ID an die bestehenden, kommagetrennten Selektoren anhängen.

- [ ] **Schritt 3: Die Hub-Logik in `review-social.js`**

1. `openHub()` — `dialog.hidden = false`, Kanäle aus der letzten `list.php`-Antwort rendern
   (nicht konfigurierte als `disabled` + „noch nicht eingerichtet"), Vorrat-Hashtags als
   anklickbare Marken, Zähler einmal rechnen.
2. **Der Zähler** (`updateCount()`) bei jedem `input` auf Text- und Hashtag-Feld und bei jeder
   Kanaländerung: das strengste Limit der **angehakten** Kanäle ermitteln (Clientseite spiegelt
   `avesmapsSocialStrictestLimit`), Anzeige `„168 + 61 Hashtags = 229 / 500 (Mastodon)"`.
   Über dem Limit bekommt die Zeile die Fehlerfarbe und „Veröffentlichen" wird `disabled`.
   ⚠️ **Der Server prüft dasselbe noch einmal** (`avesmapsSocialCheckTarget`) — der Client zählt
   für die Bequemlichkeit, nicht als Riegel.
3. **Instagram ohne Bild** bleibt ausgehakt und ausgegraut, solange kein Bild hochgeladen ist,
   mit dem Hinweis aus dem Entwurf §3.
4. **Upload:** `change` auf `#social-file` schickt `FormData` (`media`, `license`, `source`) an
   `MEDIA_API`. Antwort füllt `#social-media-info` mit Name, Maßen, „zugeschnitten"-Hinweis und
   der Zeile `„✓ Passt für …"` aus `fits`.
5. **Der Radio „Freie Lizenz"** blendet `#social-source` ein und macht es zur Pflicht — dieselbe
   Regel wie serverseitig.
6. **Veröffentlichen:** `POST PUBLISH_API {action:"create", …}`; danach `dialog.hidden = true`,
   `load()`, und die Rückmeldung je Kanal aus `results` als Toast.
7. **Freigabe-Kasten** für `state === "proposal"` in der Liste: drei Knöpfe — „Freigeben und
   veröffentlichen" (gefüllt) → `{action:"approve", id}` · „Bearbeiten" → öffnet den Hub mit
   vorbelegten Feldern · „Verwerfen" (weich) → `{action:"discard", id}`.

- [ ] **Schritt 4: Das Fenster im Browser prüfen**

⭐ **Zustand ≠ Aussehen.** `hidden === false` ist keine Aussage über das Aussehen. Über die
Browser-Werkzeuge auf `localhost` mit `?edit=1`:

```js
const el = document.getElementById("social-hub-dialog");
const cs = getComputedStyle(el);
JSON.stringify({ position: cs.position, zIndex: cs.zIndex, background: cs.backgroundColor,
                 rect: el.getBoundingClientRect().toJSON() });
```
Erwartet: `position: "fixed"`, ein `zIndex` aus der Leiter (nicht `auto`), ein sichtbarer Scrim,
und ein Rechteck über dem ganzen Fenster. Danach **Screenshot**.

- [ ] **Schritt 5: Commit**

```bash
git add index.html css/components/dialog-overlays.css css/components/social-hub.css js/review/review-social.js
git commit -m "ui(social): das Hub-Fenster -- Text, Hashtags, Bild, Rechte, Kanaele und die Freigabe von Vorschlaegen"
```

---

## Aufgabe 12: Entwurf und Erinnerung nachziehen

**Dateien:**
- Ändern: `docs/superpowers/specs/2026-08-10-social-media-hub-design.md`
- Ändern: `AGENTS.md` (§11, ein Eintrag im Index)

- [ ] **Schritt 1: Die drei Owner-Entscheidungen vom 10.08.2026 in den Entwurf**

In §3 (Kanal-Register) den Konfigurationsblock ersetzen und begründen:

```
'social' => [
    'app_token' => '…',   // gated die Endpunkte, NICHT der Netz-Token
    'enabled'   => true,  // Killschalter, §8
    'instagram' => ['user_id' => '…', 'app_id' => '…', 'app_secret' => '…'],
    'facebook'  => ['page_id'  => '…'],
    'mastodon'  => ['base_url' => '…'],
],
```

Mit dem Zusatz:

> 🔴 **Der rotierende Zugangs-Token steht in der DATENBANK, nicht in `config.local.php`**
> (Owner-Entscheid 10.08.2026, Tabelle `social_token`). Ein Token, der sich alle 35 Tage selbst
> erneuert, kann nicht in einer von Hand gepflegten PHP-Datei wohnen: der Server müsste
> PHP-Quelltext parsen und zurückschreiben, und der erste misslungene Schreibvorgang hinterlässt
> eine kaputte Konfiguration, die die ganze Seite mitnimmt. `config.local.php` trägt, was sich nie
> ändert; die Datenbank trägt, was umläuft. Auf die Datenbank hat nur der Owner Zugriff.

In §12 die Rechtenamen richtigstellen:

> ⚠️ Die oben gelisteten Berechtigungen gehören zum **Facebook-Login**-Weg. Der gewählte Weg ist
> **„API-Einrichtung mit Instagram-Login"** (Owner-Entscheid 10.08.2026) — er braucht **keine
> Facebook-Seite**, spricht `graph.instagram.com` statt `graph.facebook.com` an und hat eigene
> Rechtenamen (`instagram_business_basic`, `instagram_business_content_publish`). Die genauen Namen
> sind vor dem Bau des Adapters (Stufe 2) einmal gegen Metas aktuelle Doku abzugleichen.
>
> 💣 **Der Zähler darf nie durchlaufen.** Der Langzeit-Token gilt 60 Tage und wird per
> `ig_refresh_token` verlängert; verstreichen 60 Tage ohne Verlängerung, ist er tot und die
> einmalige Einrichtung fängt von vorn an. Verlängert wird deshalb um Tag 35, nicht um Tag 58, und
> ein Fehlschlag meldet nach Discord. ⚠️ `ig_refresh_token` verlangt einen mindestens **24 Stunden
> alten** Token — die Routine darf ihre erste Abweisung direkt nach der Einrichtung nicht als
> Fehler melden.

Und den Facebook-Stand ehrlich machen:

> 🔧 **Zu messen, nicht zu vermuten:** *uneingeschränkte Kontrolle* braucht die
> Instagram-**Verknüpfung**; zum **Posten** auf der Seite genügt die Aufgabe *Inhalte erstellen*
> (`CREATE_CONTENT`). Ob der Owner sie hat, sagt eine einzige Anfrage im Graph-API-Explorer:
> `GET /me/accounts?fields=name,id,tasks`. Solange das nicht gemessen ist, gilt Facebook als offen,
> nicht als blockiert.

- [ ] **Schritt 2: Fähigkeit und Stand in §7 nachtragen**

> ⚠️ `social` deckt sich in Stufe 1 mit `admin`, weil das Rechtemodell nur Rollen kennt und keine
> Rechtematrix je Person. Das ist die enge Startwahl, nicht die Definition der Fähigkeit: sie auf
> namentliche Editoren zu öffnen ist eine Spalte `users.can_social` plus eine Zeile in
> `avesmapsUserCan` — **kein Aufrufer ändert sich dabei**, weil alle schon durch
> `avesmapsUserCan(…, 'social')` gehen. Genau dafür hat sie ihren eigenen Namen bekommen.

- [ ] **Schritt 3: Einen Eintrag in den Dokumentenindex (AGENTS.md §11)**

Eine Zeile nach dem Muster der übrigen Einträge, mit den Fallen, die im Bau aufgefallen sind:
das Register ohne Zugangsdaten · der Probe-Kanal · Status je Kanal · der weiße Untergrund beim
JPEG · `body` statt `text` als Spaltenname · `source_ref` nullable wegen des UNIQUE-Schlüssels ·
Token in der Datenbank · Fähigkeit `social`.

- [ ] **Schritt 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-social-media-hub-design.md AGENTS.md
git commit -m "docs(social): Entwurf zieht die drei Entscheidungen vom 10.08. nach -- Instagram-Login, Token in der DB, Facebook messen"
```

---

## Aufgabe 13: Live prüfen

Erst nach dem Push und **2–4 Minuten Wartezeit** (STRATO-Opcache).

- [ ] **Schritt 1: Die Remote-SHA prüfen**

```bash
git fetch origin && git rev-parse HEAD origin/master
```
Erwartet: beide gleich.

- [ ] **Schritt 2: Anmelden und den Reiter öffnen**

Editor öffnen, **Community → Social Media**. Erwartet: der Reiter ist da, die Liste sagt
„Noch nichts veröffentlicht.", der Knopf „Social Media Hub öffnen" steht darüber.

- [ ] **Schritt 3: Die volle Kette einmal durchlaufen**

Hub öffnen · Text schreiben · zwei Hashtags aus dem Vorrat klicken · ein **PNG mit
Transparenz** hochladen · „Eigenes Werk" wählen · **nur den Probe-Kanal** anhaken ·
veröffentlichen.

Erwartet, und **jedes einzeln zu bestätigen**:
1. Der Upload antwortet mit `ext` = JPEG und meldet Maße.
2. Das Bild unter `/uploads/social/post-….jpg` ist im Browser erreichbar (HTTP 200) und hat
   **weißen**, nicht schwarzen Hintergrund.
3. Der Beitrag steht in der Liste, Herkunft = eigener Editorname, Marke „Probe ✓".
4. Der Kasten „Was gesendet worden wäre" zeigt die **fertige** Bildunterschrift mit angehängten
   Hashtags und der **absoluten** Bild-URL.

- [ ] **Schritt 4: Die Absagen prüfen**

- Ein Text über 500 Zeichen gegen den Probe-Kanal → Marke „Probe — Fehler" mit der Zahl in der
  Begründung, **kein** stiller Erfolg.
- Instagram lässt sich ohne Bild nicht anhaken und steht ausgegraut als „noch nicht eingerichtet".
- „Erneut" auf einer fehlgeschlagenen Marke wiederholt **nur diesen** Kanal.

- [ ] **Schritt 5: Den Stand melden**

Was läuft, was nicht, und was der Owner als Nächstes tun muss (`GET /me/accounts` für Facebook,
Instagram-Rücksprungadresse in der Meta-App eintragen).

---

## Selbstprüfung gegen den Entwurf

| Entwurf | Aufgabe |
|---|---|
| §2.1 Umbenennung | **schon live** (`96f261f4`) |
| §2.2 Reiter, Liste, Status je Kanal, „Erneut" je Kanal | 10 |
| §2.3 Der Hub, zweispaltig, Fußzeile mit Absenderhinweis | 11 |
| §3 Kanal-Register, Zugänge außerhalb, ausgegraut statt versteckt | 2, 8, 11 |
| §3.1 Auflagen je Netz, kein PNG, keine klickbaren Links | 2, 4 |
| §4 Hashtags, Vorrat, Zählung, strengstes Limit | 3, 11 |
| §5 Medien, Ablage, „erst live, dann posten", Rechteabfrage | 4, 6, 7, 11 |
| §6 Datenmodell | 5 |
| §7 Endpunkte, Fähigkeit `social` | 1, 7, 8, 9 |
| §8 Killschalter, Dublettenschutz | 6, 9 |
| §9 Freigabe-Ablauf | 9, 11 |
| §10 Probe-Kanal | 6, 13 |
| §12 Kontenstand nachziehen | 12 |

**Bewusst nicht in Stufe 1** (oben begründet): echte Adapter (§11 Stufe 2) · Video (§11 Stufe 3) ·
Kartenausschnitt · Token-Verlängerung (§8, braucht einen Adapter) · Zeitplanung „geplant"
(die Spalte und der Status existieren, es gibt nur noch keinen Läufer, der sie abarbeitet).
