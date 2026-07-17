# Kartenvorschau-Autoget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Knopf im Menüband des Karten-Editors holt die Vorschaubilder aller Karten in einem fortsetzbaren Durchlauf; Bilder aus Wiki- und Ulisses-Quellen werden öffentlich, alles andere bleibt editor-only.

**Architecture:** Die Route entscheidet über die Öffentlichkeit. Alle Host-Kenntnis und alles Parsing liegt in **reinen Funktionen** in `api/_internal/app/citymaps.php` (Task 1) — das ist ohne DB und ohne Netz beweisbar und trägt die ganze Änderung. `avesmapsCitymapAutogetOne()` (Task 3) ist der eine Fetch-Pfad, den der bestehende Einzelknopf **und** der neue Durchlauf teilen. Der Durchlauf selbst ist ein begrenzter Server-Schritt, den der Client treibt (Task 4+5) — exakt die Form des Linkcheckers.

**Tech Stack:** PHP 8 strict + PDO, Vanilla JS ohne Build (globale Scripts + `module.exports`-Zwilling für Node-Tests), `node`-Assert-Tests ohne Runner, CSS-Tokens aus `css/base/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-07-17-kartenvorschau-autoget-design.md` — bei jedem Zweifel gilt sie, nicht dieser Plan.

## Global Constraints

- **STRATO (AGENTS.md §9):** NIEMALS einen schweren Endpoint loopen. Der Server macht **einen begrenzten Schritt pro Request**, der Client treibt. Kein Request, der 133 Bilder holt. Beim Probieren gegen Live: **eine** Anfrage, keine Schleife.
- **Wiki-Betreiber-Zusage:** „Dump bevorzugen, API ok, KEINE HTML-Crawls." Die Wiki-Route geht über `https://de.wiki-aventurica.de/de/api.php` (`AVESMAPS_WIKI_API_URL`, `api/_internal/wiki/sync.php:5`). **Niemals** die 133 Wiki-Seiten als HTML holen.
- **SSRF (unverhandelbar):** **Beide** Fetches — die Seite/API **und** das von ihr genannte Bild — durch `avesmapsLinkCheckFetchBody` (`api/_internal/linkcheck/probe.php:237`). Die Quell-URL kommt **aus der DB**, nie aus dem Request. `finfo` prüft die **Bytes**, nie den `Content-Type`.
- **Titel-Batchgrenze der Wiki-API ist 50** für normale Nutzer (kein Bot-Recht). Nie mehr Titel in einen Call.
- **Höflichkeit:** 600 ms Pause je Host — `avesmapsLinkCheckFetchBody` drosselt bereits selbst (`avesmapsLinkCheckThrottleHost`). Nicht zusätzlich schlafen.
- **Sprache (AGENTS.md §8):** UI-Strings Deutsch und **immer** durch `tr("key", "Deutscher Default")`; jeder neue `tr`-Key braucht seinen Eintrag in `js/app/i18n-en.js`. Code-Kommentare, Commit-Messages, API-`error.code` auf **Englisch**.
- **Token-Zwang (AGENTS.md §12):** nie eine Farbe/Größe/ein Radius hartkodiert; nur Tokens aus `css/base/tokens.css`. Kein Blau.
- **Geteilter Arbeitsbaum (AGENTS.md §9):** **niemals** `git add -A` / `git add .` / `git commit -a`. Immer `git status --short` prüfen und nur eigene Dateien per Pfad stagen. Die Session `kartensammlung-design-rethink-f65f80` arbeitet parallel an `api/_internal/app/citymaps.php`, `html/citymap-editor.html`, `js/map-features/map-features-place-extras.js`, `css/features/place-extras.css`. Bei Push-Ablehnung `fetch` + `rebase origin/master` (autostash), **nie** force-push.
- **Tests laufen nackt** — kein Runner, kein `package.json`:
  - `node js/map-features/__tests__/<x>.test.js`
  - `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <test>`
  - **Ohne `zend.assertions=1` ist `assert()` ein No-Op und der Test beweist NICHTS.**
- **Keine lokale DB, kein `pdo_mysql`.** Alles DB-Gebundene ist erst live prüfbar. Reine Funktionen sind das Einzige, was hier beweisbar ist — deshalb liegt die Logik in ihnen.
- **Tri-State (Spec §3.1):** `null` = unbekannt ≠ `false`.

## Voraussetzung (blockierend für Task 6)

**Das Lizenz-Gate in `avesmapsCitymapPublicThumbUrl` muss intakt sein.** Task 7 der parallelen Session entfernt es versehentlich (Spec §11). Vor Task 6 prüfen:

```bash
grep -n "avesmapsCitymapLicenseIsFree" api/_internal/app/citymaps.php
```

Erwartet: ein Treffer **innerhalb** von `avesmapsCitymapPublicThumbUrl`. Fehlt er, ist `thumb_license = 'permission_granted'` wirkungslos und **jedes** hochgeladene Bild öffentlich — dann stoppen und den Owner fragen, nicht selbst in fremdem Code herumoperieren.

---

## File Structure

| Datei | Verantwortung nach dem Umbau |
|---|---|
| `api/_internal/app/citymaps.php` | + reine Route-/Parser-Funktionen (Task 1), + 2 Spalten (Task 2), + `avesmapsCitymapAutogetOne()` als geteilter Fetch-Pfad (Task 3) |
| `api/edit/map/citymap-image.php` | ruft `avesmapsCitymapAutogetOne()` statt eigener Autoget-Logik; setzt `thumb_origin='manual'` beim Upload (Task 3) |
| `api/edit/map/citymap-autoget.php` | **neu** — `action=autoget_step\|status\|reset`, ein begrenzter Schritt (Task 4) |
| `js/review/review-citymap-autoget.js` | **neu** — der Client-Loop + `window.startCitymapAutoget(onProgress)` (Task 5) |
| `html/citymap-editor.html` | Menüband-Knopf „🖼️ Vorschauen holen" + Kill-Switch-Zeile (Task 5, 6) |
| `js/map-features/map-features-place-extras.js` | `avesmapsCitymapCreditMarkup()` — die Pflichtangabe (Task 6) |
| `js/app/i18n-en.js` | EN-Overlay der neuen Keys (Task 6) |

**Warum ein eigener Endpoint und kein `mode=` mehr in `citymap-image.php`:** Das ist ein multipart-Upload-Endpoint **pro Karte**; ein fortsetzbarer Batch-Schritt ist ein anderer Job mit anderem Vertrag. Der Linkchecker trennt genauso. Der Parallel-Neubau, den die Owner-Regel verbietet, wäre die duplizierte Autoget-*Logik* — und genau die wird in Task 3 geteilt.

---

### Task 1: Die Wiki-Route als reine Funktionen

**Files:**
- Modify: `api/_internal/app/citymaps.php` (neue Funktionen **nach** `avesmapsCitymapPickUlissesImage`, also nach Zeile 443, **vor** `avesmapsCitymapPickPreviewImage`)
- Test: `api/_internal/app/__tests__/citymap-autoget-test.php` (neu)

**Interfaces:**
- Consumes: `avesmapsCitymapUlissesApiUrl(string $mapUrl): string` (vorhanden, `citymaps.php:400`) — `''` = kein Ulisses.
- Produces:
  - `avesmapsCitymapWikiPageTitle(string $mapUrl): string` — der Seitentitel, oder `''`.
  - `avesmapsCitymapAutogetRoute(string $mapUrl): string` — `'wiki'` | `'ulisses'` | `'ogimage'`.
  - `avesmapsCitymapWikiApiUrl(array $titles): string` — der Batch-Call für ≤50 Titel.
  - `avesmapsCitymapPickWikiImages(string $json): array` — `[normalisierter Titel => Bild-URL]`.

- [ ] **Step 1: Write the failing test**

Neue Datei `api/_internal/app/__tests__/citymap-autoget-test.php`:

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../citymaps.php';

// ---- Wiki-Seitentitel aus der map_url ----
// Live gemessen 2026-07-17: die Form ist durchgehend /wiki/<Titel prozentkodiert>, ohne Query, ohne
// Fragment. Der Titel ist also ohne jeden Abruf gewinnbar -- das ist der Grund, warum die Wiki-Route
// keinen Seiten-Fetch braucht.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Land%20des%20schwarzen%20B%C3%A4ren') === 'Land des schwarzen Bären');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Gareth') === 'Gareth');
// Unterstriche sind in MediaWiki-URLs dasselbe wie Leerzeichen.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Herz_des_Reiches') === 'Herz des Reiches');
// Anführungszeichen im Titel kommen echt vor: Kommando "Olachtai".
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Kommando%20%22Olachtai%22') === 'Kommando "Olachtai"');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/F%C3%BCrsten%2C%20H%C3%A4ndler%2C%20Intriganten') === 'Fürsten, Händler, Intriganten');
// Ein Fragment gehört nicht zum Titel (kommt heute nicht vor, wäre aber ein stiller Fehltreffer).
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Gareth#Karten') === 'Gareth');
// Fremdes bleibt fremd.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/') === '');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/de/api.php?x=1') === '');
assert(avesmapsCitymapWikiPageTitle('https://example.org/wiki/Gareth') === '');
// Lookalike-Domain darf die Route NICHT auslösen -- gleiche Verankerung wie bei Ulisses.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de.evil.tld/wiki/Gareth') === '');
assert(avesmapsCitymapWikiPageTitle('') === '');

// ---- die Routenwahl ----
// Die Route ist eine EIGENSCHAFT DER QUELLE, kein Flag: wiki + ulisses liefern per Konstruktion ein
// Verlagscover und werden oeffentlich, ogimage nicht (Spec §4).
assert(avesmapsCitymapAutogetRoute('https://de.wiki-aventurica.de/wiki/Gareth') === 'wiki');
assert(avesmapsCitymapAutogetRoute('https://www.ulisses-ebooks.de/de/product/120516/gareth-karte-pdf-als-download-kaufen') === 'ulisses');
assert(avesmapsCitymapAutogetRoute('https://maps.aventuria.ru/gareth.png') === 'ogimage');
assert(avesmapsCitymapAutogetRoute('https://de.wiki-aventurica.de.evil.tld/wiki/Gareth') === 'ogimage');
assert(avesmapsCitymapAutogetRoute('') === 'ogimage');

// ---- der Batch-Call ----
$url = avesmapsCitymapWikiApiUrl(['Gareth', 'Land des schwarzen Bären']);
assert(str_starts_with($url, 'https://de.wiki-aventurica.de/de/api.php?'), 'muss /de/api.php sein -- /api.php ist auf diesem Wiki 404');
assert(str_contains($url, 'prop=pageimages'));
assert(str_contains($url, 'pithumbsize=400'));
assert(str_contains($url, 'redirects=1'), 'ohne redirects=1 loest die API eine Weiterleitung nicht auf');
assert(str_contains($url, 'format=json'));
assert(str_contains($url, urlencode('Gareth|Land des schwarzen Bären')), 'Titel werden mit | getrennt');
assert(avesmapsCitymapWikiApiUrl([]) === '');
// Die Batchgrenze ist 50 (kein Bot-Recht). Mehr ist ein Programmfehler, kein Grund zum Abschneiden.
$fifty = [];
for ($i = 0; $i < 50; $i++) { $fifty[] = 'T' . $i; }
assert(avesmapsCitymapWikiApiUrl($fifty) !== '');
$tooMany = $fifty;
$tooMany[] = 'T50';
$threw = false;
try { avesmapsCitymapWikiApiUrl($tooMany); } catch (InvalidArgumentException $e) { $threw = true; }
assert($threw, '51 Titel muessen werfen -- stilles Abschneiden verlaere Karten');

// ---- der pageimages-Parser ----
// Echte Antwortform, live gemessen 2026-07-17 (4 Titel in EINER Antwort).
$json = json_encode(['query' => ['pages' => [
    '12450' => ['pageid' => 12450, 'title' => 'Herz des Reiches', 'pageimage' => 'RSH.jpg',
        'thumbnail' => ['source' => 'https://de.wiki-aventurica.de/de/images/thumb/5/54/RSH.jpg/400px-RSH.jpg', 'width' => 400, 'height' => 588],
        'original' => ['source' => 'https://de.wiki-aventurica.de/de/images/5/54/RSH.jpg', 'width' => 1181, 'height' => 1736]],
    '1315' => ['pageid' => 1315, 'title' => 'Gareth'],
    '-1' => ['pageid' => -1, 'title' => 'Gibtsnicht'],
]]], JSON_UNESCAPED_UNICODE);
$images = avesmapsCitymapPickWikiImages($json);
// Das THUMBNAIL, nicht das Original: pithumbsize=400 ist bereits genau die Kantenlaenge, die wir wollen
// (AVESMAPS_CITYMAP_THUMB_MAX_EDGE) -- das Original zu holen laedt 1181px, die wir sofort wegwerfen.
assert($images['Herz des Reiches'] === 'https://de.wiki-aventurica.de/de/images/thumb/5/54/RSH.jpg/400px-RSH.jpg');
// Eine Seite OHNE Seitenbild ist eine normale Antwort, kein Fehler -> sie fehlt in der Map.
assert(!isset($images['Gareth']));
// pageid -1 = die Seite gibt es nicht.
assert(!isset($images['Gibtsnicht']));
assert(count($images) === 1);

// Nur ein Original, kein Thumbnail -> das Original ist besser als nichts.
$onlyOriginal = json_encode(['query' => ['pages' => ['5' => ['pageid' => 5, 'title' => 'X',
    'original' => ['source' => 'https://de.wiki-aventurica.de/de/images/5/54/X.jpg']]]]]);
assert(avesmapsCitymapPickWikiImages($onlyOriginal)['X'] === 'https://de.wiki-aventurica.de/de/images/5/54/X.jpg');

// Kaputte/leere Antworten sind eine Aussage ("nichts"), kein Absturz.
assert(avesmapsCitymapPickWikiImages('{}') === []);
assert(avesmapsCitymapPickWikiImages('kein json') === []);
assert(avesmapsCitymapPickWikiImages('') === []);
assert(avesmapsCitymapPickWikiImages(json_encode(['query' => ['pages' => []]])) === []);

// Die API normalisiert Titel (Unterstrich -> Leerzeichen) und loest Redirects auf. Der Aufrufer muss den
// zurueckkommenden Titel wiederfinden koennen, also normalisieren wir auf beiden Seiten gleich.
$normalized = json_encode(['query' => [
    'normalized' => [['from' => 'Herz_des_Reiches', 'to' => 'Herz des Reiches']],
    'pages' => ['12450' => ['pageid' => 12450, 'title' => 'Herz des Reiches',
        'thumbnail' => ['source' => 'https://example.org/t.jpg']]],
]], JSON_UNESCAPED_UNICODE);
assert(avesmapsCitymapPickWikiImages($normalized)['Herz des Reiches'] === 'https://example.org/t.jpg');

// Ein fremder Host in der Bild-URL waere ein Angriff auf den SSRF-Riegel ueber die Hintertuer: wir haben
// die Titel geschickt, also muss das Bild vom Wiki kommen. (Der Riegel greift trotzdem -- das hier ist
// die Tuer davor.)
$foreign = json_encode(['query' => ['pages' => ['5' => ['pageid' => 5, 'title' => 'X',
    'thumbnail' => ['source' => 'https://evil.tld/x.jpg']]]]]);
assert(avesmapsCitymapPickWikiImages($foreign) === []);

echo "citymap autoget routes ok\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: FAIL — `Error: Call to undefined function avesmapsCitymapWikiPageTitle()`

- [ ] **Step 3: Write minimal implementation**

In `api/_internal/app/citymaps.php` **nach** `avesmapsCitymapPickUlissesImage` (endet Zeile 443) einfügen:

```php
// ---- Autoget, the wiki route (Spec §3/§4) ------------------------------------------------------------
// 364 of our 365 map links point at de.wiki-aventurica.de, and fetching those pages as HTML to read their
// og:image would be a CRAWL -- the operator's standing request is "prefer the dump, API ok, NO HTML
// crawls" (owner 2026-07-04). So we ask the API instead.
//
// This is not a concession, it is simply better: PageImages IS the extension that produces og:image (its
// presence verified live 2026-07-17), so we get the SAME picture; the API takes 50 titles per call, so 133
// sources cost ~6 requests instead of 133; and pithumbsize=400 hands back a picture already scaled to the
// exact edge length we want.
//
// The dump is no better here: it knows [[Datei:...]] in the wikitext but not the PAGE IMAGE, which only
// exists once the infobox templates render -- the same I6 limit that keeps four phases of "Dump holen"
// online. And the bytes would need fetching either way.

const AVESMAPS_CITYMAP_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_CITYMAP_WIKI_HOST = 'de.wiki-aventurica.de';
// 50 is the API's titles limit for ordinary users -- `highlimit` (500) needs a bot right we do not have
// (verified via paraminfo, see the wiki-aventurica-dump-policy note).
const AVESMAPS_CITYMAP_WIKI_TITLE_BATCH = 50;

// PURE. The page title out of a map_url, or '' when this is not a wiki article URL.
// Host-anchored exactly like avesmapsCitymapUlissesApiUrl: a lookalike domain must not reach the wiki
// route, because that route's answer is trusted enough to be published (Spec §5).
function avesmapsCitymapWikiPageTitle(string $mapUrl): string
{
    $parts = parse_url($mapUrl);
    if (!is_array($parts)) {
        return '';
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = strtolower((string) ($parts['host'] ?? ''));
    if (($scheme !== 'http' && $scheme !== 'https') || $host !== AVESMAPS_CITYMAP_WIKI_HOST) {
        return '';
    }
    $path = (string) ($parts['path'] ?? '');
    if (!str_starts_with($path, '/wiki/')) {
        return '';
    }
    // rawurldecode, not urldecode: '+' is a literal plus in a path segment, not a space.
    $title = rawurldecode(substr($path, strlen('/wiki/')));
    // MediaWiki treats '_' and ' ' as the same character in a title; the API answers in spaces.
    $title = trim(str_replace('_', ' ', $title));
    return $title;
}

// PURE. Which of the three routes a map_url takes. The route decides whether the result may be shown to
// readers (Spec §4), so it is deliberately derived from the SOURCE rather than stored as a flag someone
// could set wrongly: wiki page image and Ulisses product image are publisher covers by construction.
function avesmapsCitymapAutogetRoute(string $mapUrl): string
{
    if (avesmapsCitymapWikiPageTitle($mapUrl) !== '') {
        return 'wiki';
    }
    if (avesmapsCitymapUlissesApiUrl($mapUrl) !== '') {
        return 'ulisses';
    }
    return 'ogimage';
}

// PURE. The batch query for up to 50 titles.
// Throws above the limit rather than slicing: a silent slice would drop maps from a run that reports
// itself complete, and "no silent truncation" is the one thing the owner asked for by name.
function avesmapsCitymapWikiApiUrl(array $titles): string
{
    $clean = [];
    foreach ($titles as $title) {
        $value = trim((string) $title);
        if ($value !== '' && !in_array($value, $clean, true)) {
            $clean[] = $value;
        }
    }
    if ($clean === []) {
        return '';
    }
    if (count($clean) > AVESMAPS_CITYMAP_WIKI_TITLE_BATCH) {
        throw new InvalidArgumentException('Zu viele Titel für einen API-Call: ' . count($clean));
    }
    return AVESMAPS_CITYMAP_WIKI_API_URL . '?' . http_build_query([
        'action' => 'query',
        'titles' => implode('|', $clean),
        'prop' => 'pageimages',
        'piprop' => 'thumbnail|original|name',
        'pithumbsize' => (string) AVESMAPS_CITYMAP_THUMB_MAX_EDGE_WIKI,
        // Without this a map_url pointing at a redirect resolves to nothing at all.
        'redirects' => '1',
        'format' => 'json',
    ], '', '&', PHP_QUERY_RFC3986);
}

// PURE. [title => image url] out of the API's answer. Absent = this page has no page image, which is a
// normal answer and not an error (pageid -1 means the page does not exist at all).
//
// Prefers `thumbnail` over `original`: pithumbsize already asked for exactly our edge length, so the
// original would only be bytes we downscale away again.
function avesmapsCitymapPickWikiImages(string $json): array
{
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return [];
    }
    $pages = $decoded['query']['pages'] ?? null;
    if (!is_array($pages)) {
        return [];
    }
    $out = [];
    foreach ($pages as $page) {
        if (!is_array($page) || (int) ($page['pageid'] ?? -1) < 0) {
            continue;
        }
        $title = trim((string) ($page['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $source = '';
        foreach (['thumbnail', 'original'] as $field) {
            $candidate = trim((string) ($page[$field]['source'] ?? ''));
            if ($candidate !== '') {
                $source = $candidate;
                break;
            }
        }
        // We asked the wiki for titles, so the picture must be the wiki's. A foreign host here would mean
        // the answer is choosing which server we talk to next -- exactly the og:image -> 169.254.169.254
        // shape. avesmapsLinkCheckFetchBody would still catch it; this is the door in front of it.
        if ($source === '' || strtolower((string) parse_url($source, PHP_URL_HOST)) !== AVESMAPS_CITYMAP_WIKI_HOST) {
            continue;
        }
        $out[$title] = $source;
    }
    return $out;
}
```

**`AVESMAPS_CITYMAP_THUMB_MAX_EDGE_WIKI`:** `AVESMAPS_CITYMAP_THUMB_MAX_EDGE` (400) lebt in `api/edit/map/citymap-image.php:39` und ist von der Library aus **nicht** sichtbar. Diese Konstante deshalb oben in `citymaps.php` neben die anderen `AVESMAPS_CITYMAP_*`-Konstanten (bei Zeile 30):

```php
// The edge length we ask the wiki API for. Same value as AVESMAPS_CITYMAP_THUMB_MAX_EDGE in
// api/edit/map/citymap-image.php, which lives in the endpoint and is not visible from here. Kept as its
// own name rather than moved: the endpoint's constant governs OUR downscale of an upload, this one is a
// request parameter to a foreign API. They agree today by intent, not by coupling.
const AVESMAPS_CITYMAP_THUMB_MAX_EDGE_WIKI = 400;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: PASS — endet mit `citymap autoget routes ok`

- [ ] **Step 5: Commit**

```bash
git status --short
git add api/_internal/app/citymaps.php api/_internal/app/__tests__/citymap-autoget-test.php
git commit --only api/_internal/app/citymaps.php api/_internal/app/__tests__/citymap-autoget-test.php -F - <<'EOF'
feat(citymaps): add the wiki route for autoget -- MediaWiki API, not an HTML crawl

364 of 365 map links point at de.wiki-aventurica.de. Reading their og:image would
mean fetching 133 pages as HTML, and the operator's standing request is "prefer
the dump, API ok, NO HTML crawls".

prop=pageimages is not a workaround for that -- PageImages is the extension that
PRODUCES og:image, so the API hands back the same picture over the sanctioned
path. It also takes 50 titles per call (133 sources cost ~6 requests) and
pithumbsize returns the image already scaled to the edge we want.

Pure functions only, so this is provable without a database: title extraction,
the three-way route choice, the batch URL, the parser.

Two guards worth keeping: the host is anchored exactly (a lookalike domain must
not reach a route whose answer we publish), and a picture on a foreign host is
dropped -- we asked the wiki for titles, so the answer does not get to choose
which server we talk to next.

Over 50 titles throws instead of slicing: a silent slice would drop maps from a
run that reports itself complete.
EOF
```

---

### Task 2: Die zwei Spalten

**Files:**
- Modify: `api/_internal/app/citymaps.php` (CREATE TABLE ~Zeile 86 nach `thumb_local_url`; `$columnExists`-ALTER-Block nach Zeile 212; Editor-SELECT Zeile ~751; Editor-Ausgabe ~910)
- Test: `api/_internal/app/__tests__/citymap-autoget-test.php` (anhängen)

**Interfaces:**
- Consumes: `$columnExists` (vorhanden, `citymaps.php:182`), `avesmapsCitymapNormalizeOrigin` (vorhanden, `:252` — **nicht** wiederverwenden, siehe unten).
- Produces:
  - Spalten `thumb_origin`, `thumb_auto_state`.
  - `avesmapsCitymapNormalizeThumbOrigin(mixed $value): string` — `'manual'` | `'auto'`.
  - `avesmapsCitymapAutogetSkips(array $row): bool` — die Skip-Regel.

- [ ] **Step 1: Write the failing test**

An `api/_internal/app/__tests__/citymap-autoget-test.php` anhängen (vor dem abschließenden `echo`):

```php
// ---- thumb_origin ----
// Eigene Normalisierung, NICHT avesmapsCitymapNormalizeOrigin: das ist das Vokabular der KARTE
// (manual|wiki|community). 'wiki' waere hier eine Antwort auf eine andere Frage.
assert(avesmapsCitymapNormalizeThumbOrigin('auto') === 'auto');
assert(avesmapsCitymapNormalizeThumbOrigin('manual') === 'manual');
assert(avesmapsCitymapNormalizeThumbOrigin('wiki') === 'manual', 'fremdes Vokabular faellt konservativ auf manual');
assert(avesmapsCitymapNormalizeThumbOrigin(null) === 'manual');
assert(avesmapsCitymapNormalizeThumbOrigin('') === 'manual');

// ---- die Skip-Regel (Spec §7) ----
// "Eigen schlaegt auto": ein Mensch hat hochgeladen -> nie anfassen.
assert(avesmapsCitymapAutogetSkips(['thumb_local_url' => '/uploads/kartensammlungen/a/t.webp', 'thumb_origin' => 'manual']) === true);
// Autoget-Bild -> darf neu geholt werden.
assert(avesmapsCitymapAutogetSkips(['thumb_local_url' => '/uploads/kartensammlungen/a/t.webp', 'thumb_origin' => 'auto']) === false);
// DIE FALLE: kein Bild, aber Default-Herkunft. Wer hier auf thumb_origin allein prueft, ueberspringt
// JEDE Karte -- der Default IST 'manual' -- und der Durchlauf tut stumm nichts.
assert(avesmapsCitymapAutogetSkips(['thumb_local_url' => '', 'thumb_origin' => 'manual']) === false);
assert(avesmapsCitymapAutogetSkips(['thumb_origin' => 'manual']) === false);
assert(avesmapsCitymapAutogetSkips([]) === false);
assert(avesmapsCitymapAutogetSkips(['thumb_local_url' => '   ', 'thumb_origin' => 'manual']) === false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: FAIL — `Error: Call to undefined function avesmapsCitymapNormalizeThumbOrigin()`

- [ ] **Step 3: Write minimal implementation**

In `api/_internal/app/citymaps.php` neben die anderen Konstanten (bei Zeile 30):

```php
const AVESMAPS_CITYMAP_THUMB_ORIGINS = ['manual', 'auto'];
// Every outcome of a run gets one of these. NULL means "not attempted yet" and is what makes a map due.
const AVESMAPS_CITYMAP_AUTOGET_STATES = ['ok', 'no_image', 'fetch_failed', 'not_an_image', 'skipped_manual'];
```

CREATE TABLE (~Zeile 86), direkt nach `thumb_local_url VARCHAR(500) NULL,`:

```php
            thumb_origin VARCHAR(16) NOT NULL DEFAULT 'manual',
            thumb_auto_state VARCHAR(24) NULL,
```

Selbstheilendes ALTER — hinter den `is_paid`-Block (nach Zeile 212), **innerhalb** von `avesmapsCitymapsEnsureTables`:

```php
    // thumb_origin: WHO made the current thumb_local_url -- 'manual' (an editor uploaded it) or 'auto'
    // (the autoget run fetched it). Owner decision 2026-07-17: own beats auto, so a run never touches a
    // human's upload. Mirrors the adventure cover reconcile, which asks field_origins['cover_url'].
    //
    // Meaningless while the slot is empty, and DEFAULT 'manual' is deliberate for exactly that reason: it
    // is the conservative answer, and it is correct for the existing stock (the one preview that exists
    // today is an upload). The skip rule therefore asks for a PICTURE too, never for the column alone --
    // see avesmapsCitymapAutogetSkips.
    if (!$columnExists($pdo, 'thumb_origin')) {
        $pdo->exec("ALTER TABLE citymap ADD COLUMN thumb_origin VARCHAR(16) NOT NULL DEFAULT 'manual'");
    }
    // thumb_auto_state: due-ness AND the closing report in one column. NULL = not attempted yet.
    //
    // EVERY outcome writes a state, including the failures. Without a state for "tried, found nothing" the
    // next step finds the same map due again and the run never ends -- the linkchecker paid for that
    // lesson already. And the state is written PER SOURCE right after its fetch, never leased in a batch
    // up front: leasing 40 rows and then hitting the time budget makes the due-query see nothing, report
    // remaining=0, and call a half-done run finished.
    if (!$columnExists($pdo, 'thumb_auto_state')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN thumb_auto_state VARCHAR(24) NULL');
    }
```

Neben `avesmapsCitymapNormalizeOrigin` (nach Zeile 256):

```php
// Deliberately NOT avesmapsCitymapNormalizeOrigin: that one normalises the MAP's origin
// (manual|wiki|community) and 'wiki' would be an answer to a different question. This names who made the
// preview picture. 'manual' is the conservative fallback -- it is the value that stops a run.
function avesmapsCitymapNormalizeThumbOrigin(mixed $value): string
{
    $v = is_string($value) ? trim($value) : '';
    return in_array($v, AVESMAPS_CITYMAP_THUMB_ORIGINS, true) ? $v : 'manual';
}

// The skip rule (Spec §7): a run leaves a human's upload alone. PURE, so the one thing that protects
// somebody's work is provable without a database.
//
// It asks for BOTH the picture and the origin, and that is the whole point. Filtering the due-query on
// `thumb_origin <> 'manual'` instead looks equivalent and is catastrophic: the column DEFAULTS to
// 'manual', so nothing would ever be due and the button would silently do nothing. The rule is "skip maps
// that HAVE an own picture", not "skip maps whose origin column sits at its default". Living here rather
// than in SQL also means it produces a visible state (skipped_manual) that the report can name, instead of
// swallowing the map in a WHERE clause.
function avesmapsCitymapAutogetSkips(array $row): bool
{
    $hasOwnPicture = trim((string) ($row['thumb_local_url'] ?? '')) !== '';
    return $hasOwnPicture && avesmapsCitymapNormalizeThumbOrigin($row['thumb_origin'] ?? null) === 'manual';
}
```

Editor-SELECT (~Zeile 752) um die beiden Spalten erweitern — die Liste ist **explizit**:

```php
                thumb_url, thumb_local_url, thumb_auto_url, thumb_license, thumb_origin, thumb_auto_state, art, is_official, is_spoiler,
```

Editor-Ausgabe (~Zeile 911), hinter `'thumb_license' => …`:

```php
            'thumb_origin' => avesmapsCitymapNormalizeThumbOrigin($row['thumb_origin'] ?? null),
            'thumb_auto_state' => (string) ($row['thumb_auto_state'] ?? ''),
```

**Nicht** in `$editableFields` (Zeile 964): beides ist unsere eigene Buchführung, kein Editor-Feld. Wer sie dort einträgt, macht die Herkunft fälschbar und damit den Upload-Schutz wertlos.

**Nicht** in `avesmapsCitymapsReadCatalog` (Zeile ~560): der öffentliche Katalog hat für beide keinen Konsumenten.

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: PASS — endet mit `citymap autoget routes ok`

- [ ] **Step 5: Commit**

```bash
git status --short
git add api/_internal/app/citymaps.php api/_internal/app/__tests__/citymap-autoget-test.php
git commit --only api/_internal/app/citymaps.php api/_internal/app/__tests__/citymap-autoget-test.php -F - <<'EOF'
feat(citymaps): record who made a preview and how the run ended

thumb_origin protects a human's upload from the run (owner: own beats auto),
mirroring the adventure cover reconcile's field_origins check. thumb_auto_state
carries due-ness and the closing report in one column.

The skip rule asks for the picture AND the origin, in code rather than in the
due-query. Filtering on `thumb_origin <> 'manual'` looks equivalent and is
catastrophic: the column defaults to 'manual', so nothing would ever be due and
the button would silently do nothing. In code it also produces a state the report
can name instead of swallowing the map in a WHERE clause.

Every outcome writes a state, failures included. Without one for "tried, found
nothing" the next step finds the same map due and the run never ends.

Neither column is editable: this is our own bookkeeping, and a forgeable origin
would make the upload protection worthless.
EOF
```

---

### Task 3: `avesmapsCitymapAutogetOne()` — ein Fetch-Pfad für beide Aufrufer

**Files:**
- Modify: `api/_internal/app/citymaps.php` (neue Funktion ans Ende, vor dem letzten `}` der Datei)
- Modify: `api/edit/map/citymap-image.php` (Autoget-Zweig Zeilen 124–217 ersetzen; Upload-Zweig `thumb_origin` setzen)
- Test: `api/_internal/app/__tests__/citymap-autoget-test.php` (anhängen)

**Interfaces:**
- Consumes: `avesmapsCitymapAutogetRoute`, `avesmapsCitymapWikiPageTitle`, `avesmapsCitymapPickWikiImages`, `avesmapsCitymapWikiApiUrl` (Task 1); `avesmapsCitymapUlissesApiUrl`, `avesmapsCitymapPickUlissesImage`, `avesmapsCitymapPickPreviewImage`, `avesmapsSetCitymapImage` (vorhanden); `avesmapsLinkCheckFetchBody` (`linkcheck/probe.php:237`); `avesmapsWikiSyncMonitorDownscaleCoatBytes` (`wiki/sync-monitor-identity.php`).
- Produces:
  - `avesmapsCitymapAutogetTarget(string $route): array` — `['slot' => …, 'license' => …]`.
  - `avesmapsCitymapAutogetOne(PDO $pdo, string $publicId, string $mapUrl, ?string $knownImageUrl = null): array` — `['state' => …, 'url' => …, 'source' => …, 'message' => …]`.

- [ ] **Step 1: Write the failing test**

An `api/_internal/app/__tests__/citymap-autoget-test.php` anhängen:

```php
// ---- wohin ein Ergebnis geht (Spec §4/§5) ----
// DAS ist die Regel des ganzen Features: die ROUTE entscheidet ueber die Oeffentlichkeit.
$wikiTarget = avesmapsCitymapAutogetTarget('wiki');
assert($wikiTarget['slot'] === 'thumb', 'thumb -> thumb_local_url, der oeffentliche Slot');
assert($wikiTarget['license'] === 'permission_granted');
$ulissesTarget = avesmapsCitymapAutogetTarget('ulisses');
assert($ulissesTarget['slot'] === 'thumb');
assert($ulissesTarget['license'] === 'permission_granted');
// og:image von einem fremden Host ist KEIN Verlagscover -> editor-only, und keine Lizenz-Behauptung.
$ogTarget = avesmapsCitymapAutogetTarget('ogimage');
assert($ogTarget['slot'] === 'thumb_auto', 'thumb_auto -> thumb_auto_url, das der oeffentliche Katalog nie selektiert');
assert($ogTarget['license'] === null, 'ohne Erlaubnis behaupten wir keine');
// NICHT public_domain: es ist eine Erlaubnis unter den Fanrichtlinien, "nur bis auf Widerruf" (NOTICE.md).
assert($wikiTarget['license'] !== 'public_domain');
// Die Lizenz muss durchs bestehende Gate kommen, sonst waere die ganze Uebung wirkungslos.
assert(avesmapsCitymapLicenseIsFree($wikiTarget['license']) === true);
// Unbekannte Route -> konservativ editor-only. Kein Zufallstreffer nach oeffentlich.
assert(avesmapsCitymapAutogetTarget('quatsch')['slot'] === 'thumb_auto');
assert(avesmapsCitymapAutogetTarget('quatsch')['license'] === null);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: FAIL — `Error: Call to undefined function avesmapsCitymapAutogetTarget()`

- [ ] **Step 3: Write minimal implementation**

Ans Ende von `api/_internal/app/citymaps.php`:

```php
// ---- Autoget: one shared fetch path (Spec §10) -------------------------------------------------------
// Called by BOTH the single-map button (api/edit/map/citymap-image.php, mode=autoget) and the batch run
// (api/edit/map/citymap-autoget.php). Duplicating this logic is exactly the parallel build the owner's
// "extend, do not rebuild" rule forbids -- the endpoints differ in how they are driven, not in what a
// fetch means.

// PURE. Where a route's result goes, and under which licence.
//
// THE rule of this feature: the ROUTE decides whether readers see the picture (Spec §4/§5). A wiki page
// image and an Ulisses product image are publisher covers BY CONSTRUCTION -- the same artwork the
// adventure section already shows publicly under the same fan guidelines. An arbitrary og:image from a
// third-party host is not, and we hold no licence for it, so it stays in the editor.
//
// Derived from the source rather than stored as a flag: a flag can be set wrongly, a route cannot.
// Unknown routes fall to editor-only -- nothing reaches readers by accident.
function avesmapsCitymapAutogetTarget(string $route): array
{
    if ($route === 'wiki' || $route === 'ulisses') {
        // permission_granted, NOT public_domain: this is permission under the Ulisses fan guidelines and
        // it holds "nur bis auf Widerruf" (NOTICE.md). Claiming public domain would be a false statement
        // about somebody else's artwork. The value already exists in AVESMAPS_CITYMAP_LICENSES_FREE, so
        // the existing gate in avesmapsCitymapPublicThumbUrl lets it through.
        return ['slot' => 'thumb', 'license' => 'permission_granted'];
    }
    return ['slot' => 'thumb_auto', 'license' => null];
}

// Fetch one map's preview. Returns a state from AVESMAPS_CITYMAP_AUTOGET_STATES plus a human message.
// Never throws for a remote failure -- a dead source is an ANSWER ('fetch_failed'), and in a 133-source
// run one dead link must not take the whole step down.
//
// $knownImageUrl lets the batch hand in the picture URL it already learned from its 50-title wiki call,
// so the run does not ask the API once per map. Null = resolve it here (the single-map button's case).
function avesmapsCitymapAutogetOne(PDO $pdo, string $publicId, string $mapUrl, ?string $knownImageUrl = null): array
{
    $fail = static function (string $state, string $message): array {
        return ['state' => $state, 'url' => '', 'source' => '', 'message' => $message];
    };
    $mapUrl = trim($mapUrl);
    if ($mapUrl === '') {
        return $fail('no_image', 'Diese Karte hat keinen Karten-Link.');
    }
    $route = avesmapsCitymapAutogetRoute($mapUrl);

    // 1. + 2. Find the picture. Every route fetches through avesmapsLinkCheckFetchBody: full SSRF guard
    //    (scheme, host class, bounded http(s)-only redirects, post-flight PRIMARY_IP), body capped while
    //    streaming.
    $imageUrl = trim((string) ($knownImageUrl ?? ''));
    if ($imageUrl === '') {
        if ($route === 'wiki') {
            $title = avesmapsCitymapWikiPageTitle($mapUrl);
            $api = avesmapsLinkCheckFetchBody(avesmapsCitymapWikiApiUrl([$title]), AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES, 'application/json');
            if (!$api['ok']) {
                return $fail('fetch_failed', 'Die Wiki-API antwortete nicht (' . ($api['status'] ?: 'kein HTTP') . ').');
            }
            $images = avesmapsCitymapPickWikiImages($api['body']);
            // The API normalises titles and resolves redirects, so the key that comes back need not be the
            // one we sent. With a single title the answer is unambiguous -- take what there is.
            $imageUrl = $images[$title] ?? (string) (reset($images) ?: '');
            if ($imageUrl === '') {
                return $fail('no_image', 'Die Wiki-Seite hat kein Seitenbild.');
            }
        } elseif ($route === 'ulisses') {
            $api = avesmapsLinkCheckFetchBody(avesmapsCitymapUlissesApiUrl($mapUrl), AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES, 'application/json');
            if (!$api['ok']) {
                return $fail('fetch_failed', 'Die Ulisses-Produkt-API antwortete nicht (' . ($api['status'] ?: 'kein HTTP') . ').');
            }
            $imageUrl = avesmapsCitymapPickUlissesImage($api['body']);
            if ($imageUrl === '') {
                return $fail('no_image', 'Die Ulisses-Produkt-API nennt kein Titelbild.');
            }
        } else {
            $page = avesmapsLinkCheckFetchBody($mapUrl, AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES, 'text/html,application/xhtml+xml');
            if (!$page['ok']) {
                return $fail('fetch_failed', 'Die Seite konnte nicht geladen werden (' . ($page['status'] ?: 'kein HTTP') . ').');
            }
            // Resolved against the FINAL url, not the stored one -- a redirect moves the base a relative
            // og:image is relative to.
            $imageUrl = avesmapsCitymapPickPreviewImage($page['body'], $page['final_url']);
            if ($imageUrl === '') {
                return $fail('no_image', 'Auf der Seite ist kein Vorschaubild ausgezeichnet.');
            }
        }
    }

    // 3. The IMAGE. THIS is the dangerous fetch: the URL was chosen by a page we do not control, so a
    //    prepared answer could point at 169.254.169.254 and we would fetch it obediently. Same guard --
    //    guarding step 1 and not step 3 would be no guard at all.
    $image = avesmapsLinkCheckFetchBody($imageUrl, AVESMAPS_CITYMAP_IMAGE_MAX_BYTES_LIB, 'image/*');
    if (!$image['ok'] || ($image['truncated'] ?? false)) {
        return $fail('fetch_failed', 'Das gefundene Bild konnte nicht geladen werden.');
    }

    // 4. Trust the BYTES, not the Content-Type the remote server claimed. Not theoretical: the Ulisses CDN
    //    serves its covers as "image/jpg", which is not a MIME type -- believing the header would 415
    //    every single DSA cover.
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->buffer($image['body']);
    if (!isset(AVESMAPS_CITYMAP_IMAGE_TYPES_LIB[$mime])) {
        return $fail('not_an_image', 'Das gefundene Bild ist kein PNG/JPG/WebP/GIF (' . $mime . ').');
    }
    $ext = AVESMAPS_CITYMAP_IMAGE_TYPES_LIB[$mime];

    $target = avesmapsCitymapAutogetTarget($route);
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId);
    if ($safeId === '' || $safeId === null) {
        $safeId = 'karte';
    }
    $dir = $docroot . AVESMAPS_CITYMAP_UPLOAD_DIR_LIB . '/' . $safeId;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return $fail('fetch_failed', 'Upload-Verzeichnis nicht verfügbar.');
    }
    $bytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($image['body'], $ext, AVESMAPS_CITYMAP_THUMB_MAX_EDGE_WIKI);
    if ($bytes === '') {
        $bytes = $image['body'];
    }
    $name = 'auto-' . bin2hex(random_bytes(8)) . '.' . $ext;
    if (@file_put_contents($dir . '/' . $name, $bytes) === false) {
        return $fail('fetch_failed', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($dir . '/' . $name, 0644);
    $url = AVESMAPS_CITYMAP_UPLOAD_DIR_LIB . '/' . $safeId . '/' . $name;

    // Read the file we are replacing BEFORE the write, or there is nothing left to clean up.
    $priorStmt = $pdo->prepare('SELECT thumb_local_url, thumb_auto_url FROM citymap WHERE public_id = :pid LIMIT 1');
    $priorStmt->execute(['pid' => $publicId]);
    $prior = $priorStmt->fetch(PDO::FETCH_ASSOC) ?: [];
    $priorUrl = (string) ($prior[$target['slot'] === 'thumb' ? 'thumb_local_url' : 'thumb_auto_url'] ?? '');

    avesmapsSetCitymapImage($pdo, $publicId, $target['slot'], $url);
    if ($target['slot'] === 'thumb') {
        // The licence is what makes it public, and thumb_origin='auto' is what lets a later run refresh
        // it. Written together with the picture -- a preview without its licence would be invisible, a
        // licence without its origin would freeze the map at the first fetch forever.
        $pdo->prepare('UPDATE citymap SET thumb_license = :lic, thumb_origin = :org WHERE public_id = :pid')
            ->execute(['lic' => $target['license'], 'org' => 'auto', 'pid' => $publicId]);
    }
    // Unlink our previous copy in the same slot. Confined to the fixed directory (path traversal).
    if ($priorUrl !== '' && $priorUrl !== $url && str_starts_with($priorUrl, AVESMAPS_CITYMAP_UPLOAD_DIR_LIB . '/' . $safeId . '/') && !str_contains($priorUrl, '..')) {
        $realDir = realpath($dir);
        $realOld = realpath($dir . '/' . basename((string) parse_url($priorUrl, PHP_URL_PATH)));
        if ($realOld !== false && $realDir !== false && str_starts_with($realOld, $realDir . DIRECTORY_SEPARATOR)) {
            @unlink($realOld);
        }
    }
    return ['state' => 'ok', 'url' => $url, 'source' => $imageUrl, 'message' => ''];
}
```

Die vier `*_LIB`-Konstanten neben die anderen (bei Zeile 30). Sie spiegeln die Werte aus
`api/edit/map/citymap-image.php:31-45`, die von der Library aus nicht sichtbar sind:

```php
// Mirrors of the endpoint's constants (api/edit/map/citymap-image.php), which live there and are not
// visible from this library. Same values by intent; the endpoint governs uploads, these govern the fetch.
const AVESMAPS_CITYMAP_IMAGE_MAX_BYTES_LIB = 12 * 1024 * 1024;
const AVESMAPS_CITYMAP_IMAGE_TYPES_LIB = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];
const AVESMAPS_CITYMAP_UPLOAD_DIR_LIB = '/uploads/kartensammlungen';
// The API/page fetch only ever needs a JSON answer or an HTML <head>, so 512 KB is generous. The cap is a
// memory bound, not a correctness one -- a truncated page still carries its <head>, which is why an
// overflowed page fetch is accepted while an overflowed IMAGE fetch is refused.
const AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES = 512 * 1024;
```

`citymaps.php` braucht am Dateikopf (nach den bestehenden `require_once`):

```php
require_once __DIR__ . '/../linkcheck/probe.php';            // avesmapsLinkCheckFetchBody (the SSRF guard)
require_once __DIR__ . '/../wiki/sync-monitor-identity.php'; // avesmapsWikiSyncMonitorDownscaleCoatBytes
```

In `api/edit/map/citymap-image.php` den Autoget-Zweig (Zeilen 124–217) **komplett** ersetzen:

```php
    // -------------------------------------------------------------------- AUTOGET ---
    if ($mode === 'autoget' && !$hasFile) {
        if ($slot !== 'thumb') {
            avesmapsErrorResponse(400, 'invalid_request', 'Autoget gibt es nur für das Vorschaubild.');
        }
        // The source URL comes from OUR DATABASE, never from the request. Not cosmetic: a client-supplied
        // URL would make this endpoint a general-purpose fetcher for anyone with an edit session.
        $sourceStmt = $pdo->prepare('SELECT map_url FROM citymap WHERE public_id = :pid LIMIT 1');
        $sourceStmt->execute(['pid' => $publicId]);
        $pageUrl = trim((string) ($sourceStmt->fetchColumn() ?: ''));
        if ($pageUrl === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'Diese Karte hat keinen Karten-Link — es gibt keine Seite, auf der ein Vorschaubild zu finden wäre.');
        }
        // The whole fetch lives in the library, shared with the batch run: routing, both guarded fetches,
        // finfo on the bytes, downscale, storage, licence. This endpoint only decides HTTP.
        $result = avesmapsCitymapAutogetOne($pdo, $publicId, $pageUrl);
        if ($result['state'] !== 'ok') {
            $status = $result['state'] === 'no_image' ? 404 : ($result['state'] === 'not_an_image' ? 415 : 502);
            $code = $result['state'] === 'no_image' ? 'not_found' : ($result['state'] === 'not_an_image' ? 'unsupported_media_type' : 'fetch_failed');
            avesmapsErrorResponse($status, $code, $result['message']);
        }
        $pdo->prepare("UPDATE citymap SET thumb_auto_state = 'ok' WHERE public_id = :pid")->execute(['pid' => $publicId]);
        avesmapsJsonResponse(200, ['ok' => true, 'public_id' => $publicId, 'url' => $result['url'], 'source' => $result['source']]);
    }
```

Im **UPLOAD**-Zweig, direkt nach dem erfolgreichen `avesmapsSetCitymapImage($pdo, $publicId, $slot, …)`
(im `thumb`-Fall), `thumb_origin` setzen. Suchen mit:

```bash
grep -n "avesmapsSetCitymapImage" api/edit/map/citymap-image.php
```

Danach einfügen:

```php
    // A human uploaded this -> 'manual', and the run will never overwrite it (Spec §7). Only the thumb
    // slot has an origin: the full map has no autoget path that could compete with an upload.
    if ($slot === 'thumb') {
        $pdo->prepare("UPDATE citymap SET thumb_origin = 'manual' WHERE public_id = :pid")->execute(['pid' => $publicId]);
    }
```

Und im **DELETE**-Zweig (Zeile 117–121), damit ein gelöschtes Bild wieder holbar wird:

```php
    if ($mode === 'delete' && !$hasFile) {
        $result = avesmapsSetCitymapImage($pdo, $publicId, $slot, null);
        $unlinkPrevious($previousUrl, $dir, '');
        // Clearing a preview makes the map due again -- "Entfernen" then "Vorschauen holen" is how an
        // editor asks for a fresh fetch. Without this the map keeps its 'ok' state and the run skips it
        // forever, leaving no way to get a picture back short of editing the database.
        if ($slot === 'thumb' || $slot === 'thumb_auto') {
            $pdo->prepare("UPDATE citymap SET thumb_auto_state = NULL, thumb_origin = 'manual' WHERE public_id = :pid")->execute(['pid' => $publicId]);
        }
        avesmapsJsonResponse(200, ['ok' => true] + $result);
    }
```

Die Konstanten `AVESMAPS_CITYMAP_AUTOGET_HTML_MAX_BYTES` (Zeile 45) und der `require_once` auf
`probe.php` (Zeile 29) haben danach in `citymap-image.php` keinen Aufrufer mehr — **löschen**.
`AVESMAPS_CITYMAP_THUMB_MAX_EDGE` und `AVESMAPS_CITYMAP_IMAGE_TYPES` bleiben (der Upload-Zweig nutzt sie).

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: PASS — endet mit `citymap autoget routes ok`

Dann die Nachbartests, die dieselbe Datei laden:

Run: `for t in api/_internal/app/__tests__/citymap-*.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll "$t" || echo "FAIL $t"; done`
Expected: alle PASS. Ein `Cannot redeclare` hier heißt, der neue `require_once` in `citymaps.php` zieht
eine Datei, die ein Test schon lädt — dann im Test den doppelten Include entfernen, nicht in der Library.

Run: `php -l api/edit/map/citymap-image.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Commit**

```bash
git status --short
git add api/_internal/app/citymaps.php api/edit/map/citymap-image.php api/_internal/app/__tests__/citymap-autoget-test.php
git commit --only api/_internal/app/citymaps.php api/edit/map/citymap-image.php api/_internal/app/__tests__/citymap-autoget-test.php -F - <<'EOF'
feat(citymaps): one shared autoget path, and the route decides visibility

avesmapsCitymapAutogetOne is now the single fetch path: the existing per-map
button and the upcoming batch run both call it. Duplicating it is the parallel
build the "extend, do not rebuild" rule forbids -- the two callers differ in how
they are driven, not in what a fetch means.

The route decides whether readers see the picture. A wiki page image and an
Ulisses product image are publisher covers BY CONSTRUCTION -- the same artwork
the adventure section already shows publicly -- so they land in thumb_local_url
under permission_granted. An arbitrary og:image from a third-party host is not,
and stays in the editor-only column. Derived from the source, because a flag can
be set wrongly and a route cannot; unknown routes fall to editor-only.

permission_granted, not public_domain: this is permission under the fan
guidelines and holds only until revoked (NOTICE.md).

Remote failures return a state instead of throwing. In a 133-source run one dead
link must not take the whole step down.

Deleting a preview clears thumb_auto_state, so "Entfernen" then "Vorschauen
holen" is how an editor asks for a fresh fetch. Without it the map keeps its 'ok'
state and every later run skips it.
EOF
```

---

### Task 4: Der Durchlauf-Endpoint

**Files:**
- Create: `api/edit/map/citymap-autoget.php`
- Test: manuell (DB-gebunden, lokal nicht ausführbar)

**Interfaces:**
- Consumes: `avesmapsCitymapAutogetOne`, `avesmapsCitymapAutogetSkips`, `avesmapsCitymapAutogetRoute`, `avesmapsCitymapWikiPageTitle`, `avesmapsCitymapWikiApiUrl`, `avesmapsCitymapPickWikiImages` (Tasks 1–3); `avesmapsRequireUserWithCapability`, `avesmapsCreatePdo`, `avesmapsJsonResponse`, `avesmapsErrorResponse`, `avesmapsReadJsonRequest`.
- Produces: `POST /api/edit/map/citymap-autoget.php` mit `action` ∈ `autoget_step` | `status` | `reset`.
  - `autoget_step` → `{ok, done, remaining, sources_done, maps_ok, no_image, fetch_failed, not_an_image, skipped}`
  - `status` → `{ok, remaining, total, counts:{…}}`
  - `reset` → `{ok, reset}`

- [ ] **Step 1: Die Datei anlegen**

```php
<?php

declare(strict_types=1);

// The autoget RUN (Spec §6). Cap 'edit'. One bounded step per request; the CLIENT drives the repetition
// (js/review/review-citymap-autoget.js). STRATO has no cron, and looping a heavy endpoint here once
// saturated the PHP workers and looked like a DB outage (AGENTS.md §9) -- so there is deliberately no
// "do it all" action. Same shape as the linkchecker's check_step.
//
// THE WORK UNIT IS THE SOURCE URL, NOT THE MAP. 365 maps share 133 map_urls (twelve towns all point at
// "Land des schwarzen Bären"), so per-map work would fetch the same picture twelve times. One fetch per
// URL, written to every map that names it.
//
// Kept separate from citymap-image.php on purpose: that is a multipart upload endpoint keyed by one map.
// A resumable batch step is a different contract. The shared part -- what a fetch MEANS -- lives in
// avesmapsCitymapAutogetOne, which both call.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';

// 25 sources per step ~= 15s: the picture fetches dominate, and avesmapsLinkCheckFetchBody already pauses
// ~600ms per host (they are nearly all the same host). Sized against the linkchecker's measured 40 links
// in ~13s. It stays well under the 50-title API limit, so a step is always exactly one API call.
const AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES = 25;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Vorschauen holen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }
    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsCitymapsEnsureTables($pdo);

    $body = avesmapsReadJsonRequest();
    $action = trim((string) ($body['action'] ?? ''));

    // A map is due when nobody has tried it yet and it has a source to try. The skip rule is NOT in this
    // query -- see avesmapsCitymapAutogetSkips for why filtering on thumb_origin here would make nothing
    // due at all, and why a skip has to produce a visible state.
    $dueWhere = "thumb_auto_state IS NULL AND TRIM(COALESCE(map_url, '')) <> ''";

    if ($action === 'status') {
        $counts = [];
        $stmt = $pdo->query("SELECT thumb_auto_state AS s, COUNT(*) AS c FROM citymap WHERE TRIM(COALESCE(map_url, '')) <> '' GROUP BY thumb_auto_state");
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[(string) ($row['s'] ?? '')] = (int) $row['c'];
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'remaining' => (int) $pdo->query('SELECT COUNT(*) FROM citymap WHERE ' . $dueWhere)->fetchColumn(),
            'total' => (int) $pdo->query("SELECT COUNT(*) FROM citymap WHERE TRIM(COALESCE(map_url, '')) <> ''")->fetchColumn(),
            'counts' => $counts,
        ]);
    }

    if ($action === 'reset') {
        // Everything EXCEPT a real upload. Not `WHERE thumb_origin = 'auto'`: a map the run found nothing
        // for has no picture and therefore still carries the DEFAULT 'manual', so that condition would
        // exclude the very maps worth retrying (the wiki gains images over time).
        $stmt = $pdo->prepare("UPDATE citymap SET thumb_auto_state = NULL
                                WHERE NOT (TRIM(COALESCE(thumb_local_url, '')) <> '' AND thumb_origin = 'manual')");
        $stmt->execute();
        avesmapsJsonResponse(200, ['ok' => true, 'reset' => $stmt->rowCount()]);
    }

    if ($action !== 'autoget_step') {
        avesmapsErrorResponse(400, 'invalid_request', 'action muss autoget_step, status oder reset sein.');
    }

    // ---- one step ----
    $sources = $pdo->query('SELECT DISTINCT map_url FROM citymap WHERE ' . $dueWhere
        . ' ORDER BY map_url LIMIT ' . AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES)->fetchAll(PDO::FETCH_COLUMN);

    $tally = ['ok' => 0, 'no_image' => 0, 'fetch_failed' => 0, 'not_an_image' => 0, 'skipped_manual' => 0];
    $sourcesDone = 0;

    // ONE api call for all this step's wiki titles -- that is the whole reason the run is cheap. Do it
    // before touching any map, so a title's picture is known by the time its maps come up.
    $wikiImages = [];
    $titles = [];
    foreach ($sources as $mapUrl) {
        $title = avesmapsCitymapWikiPageTitle((string) $mapUrl);
        if ($title !== '' && !in_array($title, $titles, true)) {
            $titles[] = $title;
        }
    }
    if ($titles !== []) {
        $api = avesmapsLinkCheckFetchBody(avesmapsCitymapWikiApiUrl($titles), AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES, 'application/json');
        // A dead API call is not fatal: every wiki map in this step simply falls through to its own
        // resolve inside avesmapsCitymapAutogetOne, which records its own state. Slower, still correct.
        if ($api['ok']) {
            $wikiImages = avesmapsCitymapPickWikiImages($api['body']);
        }
    }

    $mapsStmt = $pdo->prepare('SELECT public_id, thumb_local_url, thumb_origin FROM citymap
                                WHERE map_url = :url AND ' . $dueWhere);
    $stateStmt = $pdo->prepare('UPDATE citymap SET thumb_auto_state = :state WHERE public_id = :pid');

    foreach ($sources as $mapUrl) {
        $mapUrl = (string) $mapUrl;
        $mapsStmt->execute(['url' => $mapUrl]);
        $maps = $mapsStmt->fetchAll(PDO::FETCH_ASSOC);
        $title = avesmapsCitymapWikiPageTitle($mapUrl);
        $known = ($title !== '' && isset($wikiImages[$title])) ? $wikiImages[$title] : null;

        foreach ($maps as $map) {
            $publicId = (string) $map['public_id'];
            if (avesmapsCitymapAutogetSkips($map)) {
                $stateStmt->execute(['state' => 'skipped_manual', 'pid' => $publicId]);
                $tally['skipped_manual']++;
                continue;
            }
            $result = avesmapsCitymapAutogetOne($pdo, $publicId, $mapUrl, $known);
            // The state is written PER MAP, right after its fetch -- never leased in a batch up front.
            // Leasing and then hitting a time budget makes the due-query see nothing, report remaining=0,
            // and call a half-finished run done (the linkchecker's falle #2).
            $stateStmt->execute(['state' => $result['state'], 'pid' => $publicId]);
            $tally[$result['state']] = ($tally[$result['state']] ?? 0) + 1;
            // A wiki source resolved once serves all its maps: reuse the URL the first fetch found so the
            // twelve towns sharing a book do not each ask the API again.
            if ($known === null && $result['state'] === 'ok' && $result['source'] !== '') {
                $known = $result['source'];
            }
        }
        $sourcesDone++;
    }

    $remaining = (int) $pdo->query('SELECT COUNT(*) FROM citymap WHERE ' . $dueWhere)->fetchColumn();
    avesmapsJsonResponse(200, [
        'ok' => true,
        'done' => $remaining === 0,
        'remaining' => $remaining,
        'sources_done' => $sourcesDone,
        'maps_ok' => $tally['ok'],
        'no_image' => $tally['no_image'],
        'fetch_failed' => $tally['fetch_failed'],
        'not_an_image' => $tally['not_an_image'],
        'skipped' => $tally['skipped_manual'],
    ]);
} catch (Throwable $e) {
    // No getMessage() to the client (M1: several endpoints leak exception text; do not add another).
    avesmapsErrorResponse(500, 'server_error', 'Der Vorschau-Durchlauf ist fehlgeschlagen.');
}
```

- [ ] **Step 2: Syntax prüfen**

Run: `php -l api/edit/map/citymap-autoget.php`
Expected: `No syntax errors detected`

Run: `grep -c "avesmapsLinkCheckFetchBody" api/_internal/app/citymaps.php`
Expected: ≥ 4 (die drei Routen in `avesmapsCitymapAutogetOne` + der Bild-Fetch). Der Endpoint ruft sie
zusätzlich für den Batch-Call; `probe.php` kommt über `citymaps.php` mit.

- [ ] **Step 3: Commit**

```bash
git status --short
git add api/edit/map/citymap-autoget.php
git commit --only api/edit/map/citymap-autoget.php -F - <<'EOF'
feat(citymaps): add the resumable preview run -- one bounded step per request

STRATO has no cron and looping a heavy endpoint here once saturated the PHP
workers and looked like a DB outage, so there is deliberately no "do it all"
action: 25 sources per step, the client drives the repetition.

The work unit is the SOURCE URL, not the map. 365 maps share 133 map_urls --
twelve towns all point at "Land des schwarzen Bären" -- so per-map work would
fetch the same picture twelve times. One step is also exactly one wiki API call
for all its titles, which is what makes the whole run ~90s instead of minutes.

State is written per map right after its fetch, never leased up front: leasing
and then hitting a time budget makes the due-query see nothing, report
remaining=0, and call a half-finished run done.

reset clears everything except real uploads. Not `WHERE thumb_origin = 'auto'`:
a map the run found nothing for has no picture and still carries the default
'manual', so that would exclude exactly the maps worth retrying.
EOF
```

---

### Task 5: Client-Loop + Menüband-Knopf

**Files:**
- Create: `js/review/review-citymap-autoget.js`
- Modify: `index.html` (Script-Tag neben `js/review/review-link-check.js`)
- Modify: `html/citymap-editor.html` (Knopf nach Zeile 431; Handler neben `handleLinkCheckClick`)

**Interfaces:**
- Consumes: `POST /api/edit/map/citymap-autoget.php` (Task 4).
- Produces: `window.startCitymapAutoget(onProgress) -> Promise<{sources, ok, no_image, fetch_failed, not_an_image, skipped} | null>` — `null`, wenn schon ein Lauf läuft.

- [ ] **Step 1: Den Loop anlegen**

`js/review/review-citymap-autoget.js`:

```js
// The client half of the citymap preview run (Spec §6). Mirrors review-link-check.js deliberately: STRATO
// has no cron, the server does ONE bounded step per request, and the client drives the repetition.
//
// The button lives in the citymap editor DIALOG, which is an iframe -- it calls in via
// window.parent.startCitymapAutoget(onProgress), exactly the way its "Links prüfen" and "Karten syncen"
// buttons already delegate. Progress arrives through the callback we hand in. NEVER poll: a poll only
// queues behind the running step (measured on the linkchecker: a plain status call took 21s mid-step).

const CITYMAP_AUTOGET_URL = "/api/edit/map/citymap-autoget.php";
// A backstop against an endless loop if a step ever reported done=false without making progress. 133
// sources at 25 per step is 6 steps; 40 is far above any real run and far below "forever".
const CITYMAP_AUTOGET_MAX_STEPS = 40;

let isCitymapAutogetRunning = false;
let citymapAutogetProgressSink = null;

function reportCitymapAutogetProgress(text) {
	if (typeof citymapAutogetProgressSink === "function") {
		citymapAutogetProgressSink(text);
	}
}

async function submitCitymapAutogetAction(action) {
	const res = await fetch(CITYMAP_AUTOGET_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ action: action }),
	});
	const payload = await res.json().catch(() => null);
	if (!res.ok || !payload || payload.ok !== true) {
		const message = (payload && payload.error && payload.error.message) || ("HTTP " + res.status);
		throw new Error(message);
	}
	return payload;
}

// Runs steps until the server says done. The re-entrancy guard is global on purpose -- two runs at once
// would only fight over PHP workers and the per-host throttle, and STRATO has punished exactly that.
async function startCitymapAutoget(onProgress) {
	if (isCitymapAutogetRunning) {
		return null;
	}
	isCitymapAutogetRunning = true;
	citymapAutogetProgressSink = typeof onProgress === "function" ? onProgress : null;

	const totals = { sources: 0, ok: 0, no_image: 0, fetch_failed: 0, not_an_image: 0, skipped: 0 };
	try {
		reportCitymapAutogetProgress("Vorschauen werden geholt …");
		let steps = 0;
		let done = false;
		while (!done) {
			if (steps >= CITYMAP_AUTOGET_MAX_STEPS) {
				throw new Error("Der Durchlauf wurde nach zu vielen Teilschritten angehalten.");
			}
			steps += 1;
			const step = await submitCitymapAutogetAction("autoget_step");
			totals.sources += Number(step.sources_done ?? 0);
			totals.ok += Number(step.maps_ok ?? 0);
			totals.no_image += Number(step.no_image ?? 0);
			totals.fetch_failed += Number(step.fetch_failed ?? 0);
			totals.not_an_image += Number(step.not_an_image ?? 0);
			totals.skipped += Number(step.skipped ?? 0);
			done = step.done === true;
			// A step that finds nothing to do is finished, whatever it claims. Without this a server that
			// keeps answering done=false spins until the backstop.
			if (!done && Number(step.sources_done ?? 0) === 0) {
				break;
			}
			reportCitymapAutogetProgress(
				`Vorschauen … ${totals.ok} geholt, ${Number(step.remaining ?? 0)} offen`
			);
		}
		return totals;
	} finally {
		isCitymapAutogetRunning = false;
		citymapAutogetProgressSink = null;
	}
}

window.startCitymapAutoget = startCitymapAutoget;
```

- [ ] **Step 2: In `index.html` einhängen**

Die Zeile mit `review-link-check.js` finden:

```bash
grep -n "review-link-check.js" index.html
```

Direkt **danach** einfügen (gleiche Einrückung, kein `?v=` — das stempelt der Deploy):

```html
<script src="js/review/review-citymap-autoget.js"></script>
```

- [ ] **Step 3: Der Knopf im Menüband**

In `html/citymap-editor.html` **nach** Zeile 431 (`</button>` des `ceLinkCheckBtn`) einfügen:

```html
  <button type="button" class="ce-btn2" id="ceAutogetBtn" title="Holt für alle Karten ein Vorschaubild. Wiki-Karten über die MediaWiki-API (kein HTML-Crawl), Ulisses über die Produkt-API. Eigene Uploads bleiben unangetastet. Läuft schrittweise und ist fortsetzbar.">
    <span class="t1">🖼️ Vorschauen holen</span>
    <span class="t2" id="ceAutogetSub">…</span>
  </button>
```

- [ ] **Step 4: Der Handler**

In `html/citymap-editor.html` neben `handleLinkCheckClick` (nach Zeile ~1295):

```js
  // ---- Preview autoget (all maps) ----
  // Delegates to window.parent.startCitymapAutoget -- the loop lives in the parent (review-citymap-autoget.js)
  // for the same reason the link check does: this editor is an iframe, and the run must survive its own
  // status line. Progress arrives through the callback; polling would queue behind the running step.
  let ceAutogetRunning = false;

  function setAutogetBusy(isBusy) {
    ceAutogetRunning = isBusy;
    const button = document.getElementById("ceAutogetBtn");
    if (!button) return;
    button.disabled = isBusy;
    const label = button.querySelector(".t1");
    if (label) label.textContent = isBusy ? "Holt …" : "🖼️ Vorschauen holen";
  }

  async function handleAutogetClick() {
    if (ceAutogetRunning) return;
    const statusEl = document.getElementById("ceAutogetSub");
    let parentWindow;
    try { parentWindow = window.parent; } catch (e) { parentWindow = null; }
    if (!parentWindow || parentWindow === window || typeof parentWindow.startCitymapAutoget !== "function") {
      if (statusEl) statusEl.textContent = "Nur im eingebetteten Editor verfügbar.";
      return;
    }
    if (!window.confirm("Für alle Karten ohne eigenes Vorschaubild ein Bild holen?\n\nWiki-Karten über die MediaWiki-API, Ulisses über die Produkt-API. Eigene Uploads bleiben unangetastet. Der Durchlauf dauert ein bis zwei Minuten und lässt sich fortsetzen.")) {
      return;
    }
    setAutogetBusy(true);
    try {
      const r = await parentWindow.startCitymapAutoget((text) => {
        if (statusEl) statusEl.textContent = text;
      });
      // Returns NULL (it does not throw) when a run is already in flight -- the guard is global.
      if (!r) {
        if (statusEl) statusEl.textContent = "Ein Durchlauf läuft bereits.";
      } else if (statusEl) {
        // Report every outcome, never just the wins: "no silent truncation" (owner). Counted in MAPS,
        // because that is what the reader sees -- the sources are the bracket.
        const parts = [`${r.sources} Quellen · ${r.ok} Karten mit Vorschau`];
        if (r.no_image) parts.push(`${r.no_image} ohne Seitenbild`);
        if (r.fetch_failed) parts.push(`${r.fetch_failed} nicht erreichbar`);
        if (r.not_an_image) parts.push(`${r.not_an_image} kein Bild`);
        if (r.skipped) parts.push(`${r.skipped} übersprungen (eigenes Bild)`);
        statusEl.textContent = parts.join(" · ");
      }
      await refreshCeList();
    } catch (e) {
      if (statusEl) statusEl.textContent = "Fehlgeschlagen: " + (e && e.message ? e.message : String(e));
    } finally {
      setAutogetBusy(false);
    }
  }

  document.getElementById("ceAutogetBtn").addEventListener("click", handleAutogetClick);
```

**`refreshCeList()` prüfen** — die Funktion, die die Kartenliste neu lädt, heißt in dieser Datei
möglicherweise anders:

```bash
grep -n "function refreshCeList\|function loadCitymaps\|async function refreshList" html/citymap-editor.html
```

Den tatsächlichen Namen einsetzen. Gibt es keine, die Zeile ersatzlos streichen — der Editor zeigt die
neuen Bilder dann beim nächsten Auswählen einer Karte.

Und die Statuszeile initial füllen, neben den anderen `refresh*`-Aufrufen beim Start:

```js
  // Same read the ribbon uses; no lock, no run.
  async function refreshCeAutogetInfo() {
    const el = document.getElementById("ceAutogetSub");
    if (!el) return;
    try {
      const res = await fetch("/api/edit/map/citymap-autoget.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "status" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || payload.ok !== true) throw new Error(`HTTP ${res.status}`);
      el.textContent = payload.remaining > 0
        ? `${payload.remaining} von ${payload.total} offen`
        : `${payload.total} Karten geprüft`;
    } catch (e) {
      el.textContent = "Status unbekannt";
    }
  }
```

Diesen Aufruf neben `refreshCeSyncedInfo()` hängen (`grep -n "refreshCeSyncedInfo()" html/citymap-editor.html`).

- [ ] **Step 5: Im Browser prüfen**

```
https://avesmaps.de/?edit=1
```
→ WikiSync → Abenteuer → „Kartensammlung editieren". Erwartet: der Knopf „🖼️ Vorschauen holen" steht
neben „🔗 Links prüfen", die Unterzeile zeigt „133 von 365 offen" (o. ä.). Klick → Rückfrage → der
Durchlauf zählt hoch und endet mit dem Bericht.

**Vorher den Remote-SHA prüfen** (`git ls-remote origin master`) und die ~1–2 min Deploy-Verzögerung
abwarten. **Nicht** in einem Hintergrund-Tab prüfen (Memory `mcp-hiddentab-raf-verification-trap`).

- [ ] **Step 6: Commit**

```bash
git status --short
git add js/review/review-citymap-autoget.js index.html html/citymap-editor.html
git commit --only js/review/review-citymap-autoget.js index.html html/citymap-editor.html -F - <<'EOF'
feat(citymaps): drive the preview run from the ribbon, one step at a time

Mirrors review-link-check.js: the editor is an iframe, so the loop lives in the
parent and the button calls in via window.parent.startCitymapAutoget with a
progress callback. Polling would only queue behind the running step -- measured
on the linkchecker, a plain status call took 21s mid-step.

The summary reports every outcome, not just the wins, and counts MAPS rather than
sources: the sources are the bracket, the maps are what a reader sees. A run that
said "118 geholt" would understate its own effect by a factor of 2.7.
EOF
```

---

### Task 6: Kill-Switch, Pflichtangabe, öffentliche Anzeige

**Läuft zuletzt** — größte Kollisionsfläche mit der parallelen Session (`place-extras.js` baut dort die
Zeile komplett um).

**Voraussetzung prüfen, bevor irgendetwas angefasst wird:**

```bash
grep -n "avesmapsCitymapLicenseIsFree" api/_internal/app/citymaps.php
```

Erwartet: ein Treffer **in** `avesmapsCitymapPublicThumbUrl`. Fehlt er, ist Task 7 der anderen Session so
gelandet wie geplant und `permission_granted` ist wirkungslos → **stoppen und den Owner fragen.**

**Files:**
- Modify: `api/_internal/app/citymaps.php` (Kill-Switch neben `avesmapsCitymapsEnabled`)
- Modify: `js/map-features/map-features-place-extras.js` (`avesmapsCitymapCreditMarkup` neben `avesmapsAdventureCreditMarkup:630`)
- Modify: `js/app/i18n-en.js`
- Modify: `html/citymap-editor.html` (Kill-Switch-Zeile)
- Test: `js/map-features/__tests__/citymaps-render.test.js`

**Interfaces:**
- Consumes: `avesmapsAdventureCreditMarkup` (Vorbild, `place-extras.js:630`), `tr`.
- Produces: `avesmapsCitymapCreditMarkup() -> string`; Payload-Feld `citymap_previews_enabled`.

- [ ] **Step 1: Write the failing test**

An `js/map-features/__tests__/citymaps-render.test.js` anhängen (Import um `avesmapsCitymapCreditMarkup` erweitern):

```js
// ---- Pflichtangabe (Spec §5) ----
// Dieselbe Grammatik wie die Abenteuer-Fussnote, eigene Funktion: der Kill-Switch ist ein anderer.
global.avesmapsCitymapPreviewsEnabled = () => true;
const credit = avesmapsCitymapCreditMarkup();
assert.ok(credit.includes("Ulisses Spiele"), "der Credit ist die Pflichtangabe, nicht Deko");
assert.ok(credit.includes("f-shop.de"), "der F-Shop-Link ist generisch -- es gibt keinen pro Karte");
assert.ok(credit.includes("↗"), "externe Links tragen den Pfeil (AGENTS.md §12)");
// Kein Cover auf dem Schirm heisst kein Credit noetig -- gleiche Logik wie bei den Abenteuern.
global.avesmapsCitymapPreviewsEnabled = () => false;
assert.strictEqual(avesmapsCitymapCreditMarkup(), "");
global.avesmapsCitymapPreviewsEnabled = () => true;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/map-features/__tests__/citymaps-render.test.js`
Expected: FAIL — `TypeError: avesmapsCitymapCreditMarkup is not a function`

- [ ] **Step 3: Write minimal implementation**

In `js/map-features/map-features-place-extras.js` **nach** `avesmapsAdventureCreditMarkup` (Zeile 633):

```js
// Lizenz-Fussnote der Kartensammlung. Dieselbe Pflichtangabe wie bei den Abenteuern und derselbe
// generische F-Shop-Link (es gibt keinen pro Karte -- 364 der 365 Karten-Links zeigen ins Wiki).
//
// EIGENE Funktion mit EIGENEM Schalter, obwohl der Text derselbe ist: die Erlaubnis gilt "nur bis auf
// Widerruf" (NOTICE.md), und dann will man Karten-Vorschauen abschalten koennen, ohne die Abenteuer-Cover
// zu verlieren. avesmapsAdventureCreditMarkup wiederzuverwenden haette die beiden Flaechen an einen
// Schalter gekettet, der nach der einen von beiden benannt ist.
function avesmapsCitymapCreditMarkup() {
	var on = (typeof avesmapsCitymapPreviewsEnabled !== "function") || avesmapsCitymapPreviewsEnabled();
	return on ? '<div class="avesmaps-adv__credit">' + tr("cityMaps.credit", "Vorschaubilder © Ulisses Spiele — <a href=\"https://www.f-shop.de/\" target=\"_blank\" rel=\"noopener\">im F-Shop ansehen ↗</a>") + '</div>' : "";
}
```

Im `module.exports` am Dateiende `avesmapsCitymapCreditMarkup` ergänzen.

Die Fußnote in die Sektion einhängen — ans Ende von `buildCityMapsSectionMarkup`, direkt vor dem
schließenden `</div>` der Sektion (`grep -n "function buildCityMapsSectionMarkup" js/map-features/map-features-place-extras.js`).
Die Klasse `avesmaps-adv__credit` wird bewusst mitbenutzt: **identische** Optik für identische
Pflichtangabe, und `place-extras.css` stylt sie bereits.

In `js/app/i18n-en.js`:

```js
	"cityMaps.credit": "Preview images © Ulisses Spiele — <a href=\"https://www.f-shop.de/\" target=\"_blank\" rel=\"noopener\">view in the F-Shop ↗</a>",
```

Kill-Switch in `api/_internal/app/citymaps.php` — neben die bestehende `citymaps_enabled`-Logik
(`grep -n "citymaps_enabled\|AVESMAPS_CITYMAPS_SETTING" api/_internal/app/citymaps.php`), demselben
Muster folgend:

```php
// Own switch, not the adventures' (owner decision 2026-07-17): the Ulisses permission holds "nur bis auf
// Widerruf" (NOTICE.md), and on a revocation you want to reach each surface separately. Off = the public
// catalogue serves no preview at all, and the credit line disappears with it -- no covers on screen means
// no credit needed.
const AVESMAPS_CITYMAP_PREVIEWS_SETTING = 'citymap_previews_enabled';

function avesmapsCitymapPreviewsEnabled(PDO $pdo): bool
{
    return avesmapsCitymapsSettingEnabled($pdo, AVESMAPS_CITYMAP_PREVIEWS_SETTING);
}
```

Den exakten Namen der vorhandenen Setting-Leserfunktion aus dem `grep` übernehmen — `citymaps_enabled`
hat bereits eine, und eine zweite zu bauen wäre der Parallel-Neubau.

In `avesmapsCitymapsReadCatalog` den Thumb unterdrücken, wenn der Schalter aus ist, und das Flag in den
Payload legen (neben `citymaps_enabled` in `api/app/citymaps.php`):

```php
'citymap_previews_enabled' => avesmapsCitymapPreviewsEnabled($pdo),
```

Client-seitig in `js/map-features/map-features-citymaps.js` neben dem bestehenden `citymaps_enabled`-Leser:

```js
// Mirrors avesmapsAdventuresCoversEnabled: the payload carries the switch, the render asks it.
function avesmapsCitymapPreviewsEnabled() {
	return citymapCatalog ? citymapCatalog.previews_enabled !== false : true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/map-features/__tests__/citymaps-render.test.js`
Expected: PASS

Run: `php -l api/_internal/app/citymaps.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Die Kill-Switch-Zeile im Menüband**

In `html/citymap-editor.html` neben `ceEnabledToggle` (Zeile 424–427) einen zweiten Umschalter nach
**exakt** dessen Muster — `grep -n "ceEnabledToggle" html/citymap-editor.html` zeigt Markup **und**
Handler; beides spiegeln mit `id="cePreviewsToggle"` und der Setting `citymap_previews_enabled`.

- [ ] **Step 6: Live prüfen**

```
https://avesmaps.de/?siedlung=Gareth
```
Erwartet: die Kartensammlung zeigt Vorschaubilder und darunter „Vorschaubilder © Ulisses Spiele — im
F-Shop ansehen ↗". Schalter aus → Bilder **und** Fußnote weg, die Karten bleiben.

- [ ] **Step 7: Commit**

```bash
git status --short
git add js/map-features/map-features-place-extras.js js/map-features/map-features-citymaps.js js/map-features/__tests__/citymaps-render.test.js js/app/i18n-en.js api/_internal/app/citymaps.php api/app/citymaps.php html/citymap-editor.html
git commit --only js/map-features/map-features-place-extras.js js/map-features/map-features-citymaps.js js/map-features/__tests__/citymaps-render.test.js js/app/i18n-en.js api/_internal/app/citymaps.php api/app/citymaps.php html/citymap-editor.html -F - <<'EOF'
feat(citymaps): show publisher previews with their credit, behind their own switch

The credit line is the obligation that makes the covers permissible, so it ships
with them rather than after them. Same wording and the same generic f-shop.de
link as the adventures -- there is no per-map shop link, 364 of 365 map links
point into the wiki.

Its own function and its own switch even though the text matches: the permission
holds only until revoked (NOTICE.md), and on a revocation you want to reach map
previews without losing adventure covers. Reusing the adventures' would chain two
surfaces to a switch named after one of them.

Off means no preview and no credit -- no covers on screen, no credit needed.
EOF
```

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| §3 MediaWiki-API statt HTML-Crawl, `/de/api.php`, Batch 50 | 1 |
| §4 Drei Routen, `redirects=1`, `pageid: -1` | 1 (rein) + 3 (Fetch) |
| §5 `permission_granted`, Fußnote, eigener Kill-Switch | 3 (Lizenz) + 6 (Fußnote/Switch) |
| §6 Fortsetzbar, URL als Einheit, Callback statt Poll, Re-Entrancy | 4 (Server) + 5 (Client) |
| §7 `thumb_origin`, `thumb_auto_state`, Skip-Regel, „alle neu ziehen" | 2 (Spalten/Regel) + 4 (`reset`) |
| §8 Jeder Ausgang ein Zustand, Bericht ohne stilles Abschneiden | 2 (Zustände) + 4 (Tally) + 5 (Bericht) |
| §9 Beide Fetches durch den Riegel, URL aus der DB, finfo auf Bytes | 3 |
| §10 `avesmapsCitymapAutogetOne` geteilt, eigener Endpoint | 3 + 4 |
| §11 Gate-Voraussetzung | Vorbedingung + Task 6 Step 0 |
| §12 Tests | 1, 2, 3, 6 |

Keine Lücke.

**Type consistency:** `avesmapsCitymapAutogetRoute` liefert `'wiki'|'ulisses'|'ogimage'` (Task 1) und wird
in Task 3 (`avesmapsCitymapAutogetTarget`) und Task 4 (Titel-Sammlung) mit denselben Werten gelesen.
`avesmapsCitymapAutogetOne` gibt `['state','url','source','message']` zurück (Task 3); Task 4 liest
`state` und `source`, `citymap-image.php` liest `state`, `url`, `source`, `message`. Die Zustände in
`AVESMAPS_CITYMAP_AUTOGET_STATES` (Task 2) decken sich mit den `$fail()`-Aufrufen (Task 3), dem
`$tally`-Array (Task 4) und den Bericht-Zweigen (Task 5). `avesmapsCitymapAutogetTarget` liefert
`['slot','license']` mit `slot` ∈ `'thumb'|'thumb_auto'` — dieselben Schlüssel wie
`avesmapsSetCitymapImage`s `$columns`-Map (`citymaps.php:1687`).

**Reihenfolge:** 1 → 2 → 3 sind aufeinander aufgebaut (reine Funktionen → Spalten → Fetch-Pfad). 4 braucht
1–3. 5 braucht 4. 6 läuft zuletzt (größte Kollisionsfläche) und hat die Gate-Vorbedingung.

**Offen bis zum Deploy:** die beiden ALTER, die Fälligkeits-Query, der Durchlauf und der Kill-Switch sind
lokal nicht prüfbar (keine DB). Reine Funktionen sind das Einzige, was hier beweisbar ist — deshalb liegt
die Logik in ihnen.
