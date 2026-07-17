<?php

declare(strict_types=1);

// Kartensammlung (Spec §3) -- backend entity for curated city/region maps plus the places they depict.
// Sibling of api/_internal/app/adventures.php and deliberately built to the same shape: self-healing
// inline DDL, a two-query catalog read, the same place CRUD. The public read wrapper is
// api/app/citymaps.php; editor writes go through api/edit/map/citymaps.php. Language policy per AGENTS.md
// §8: code/identifiers EN, domain content DE.
//
// CORE RULE (Spec §3.1): every property except the title and the external map link is OPTIONAL, and NULL
// means UNKNOWN -- the reader view OMITS an unknown property rather than printing "unbekannt". That is
// why the booleans are TINYINT(1) NULL (three-valued) instead of NOT NULL DEFAULT 0: "this map is not
// coloured" and "nobody recorded whether it is coloured" are different answers, and only the first one
// may be filtered on.
//
// No wiki sync (Spec §6): maps are curated + community, never dump-imported. The `origin` column exists
// so that decision stays reversible, but nothing writes 'wiki' today.

require_once __DIR__ . '/app-setting.php';
// Maps hang on the shared source catalogue (Spec §3.2) -- no second source field, so "Ulisses F-Shop"
// exists once rather than once per map, and source_type + the link check come along for free.
require_once __DIR__ . '/feature-sources.php';

// ---- licence + image gate (Spec §3.3) --------------------------------------------------------------
// EXACTLY ONE definition of the licence vocabulary. The public read below, the editor dispatcher and the
// upload endpoint all require THIS file for it. The settlement-image system hardcodes its own list in
// three places (api/edit/wiki/settlement-images.php:34, api/app/map-features.php:284 and the settlement
// editor's JS) with nothing keeping them in sync -- that is the mistake we are explicitly not inheriting.
const AVESMAPS_CITYMAP_LICENSES = ['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'unknown_other'];
const AVESMAPS_CITYMAP_LICENSE_DEFAULT = 'unknown_other';
const AVESMAPS_CITYMAP_LICENSES_FREE = ['public_domain', 'cc0', 'ai_generated', 'permission_granted'];

// NB the default is the NON-free value, the inverse of the settlement-image default ('ai_generated' =
// shown). A map whose licence nobody has judged must not be published: for our own generated settlement
// pictures "unknown" is safe, for third-party cartography it is not.
const AVESMAPS_CITYMAPS_SETTING = 'citymaps_enabled';

// ---- Autoget, the wiki route (2026-07-17) ------------------------------------------------------------
// 364 of our 365 map links point at de.wiki-aventurica.de, and fetching those pages as HTML to read their
// og:image would be a CRAWL -- the operator's standing request is "prefer the dump, API ok, NO HTML
// crawls" (owner 2026-07-04). So we ask the API instead.
//
// Not a concession, simply better: PageImages IS the extension that produces og:image (presence verified
// live 2026-07-17), so we get the SAME picture; the API takes 50 titles per call, so 133 sources cost ~6
// requests instead of 133; and pithumbsize hands back a picture already scaled to the edge we want.
//
// The dump is no better here: it knows [[Datei:...]] in the wikitext but not the PAGE IMAGE, which only
// exists once the infobox templates render -- the same limit that keeps four phases of "Dump holen"
// online. And the bytes would need fetching either way.
const AVESMAPS_CITYMAP_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_CITYMAP_WIKI_HOST = 'de.wiki-aventurica.de';
// 50 is the API's titles limit for ordinary users; `highlimit` (500) needs a bot right we do not have.
const AVESMAPS_CITYMAP_WIKI_TITLE_BATCH = 50;
// The edge length we ask the wiki API for. Same value as AVESMAPS_CITYMAP_THUMB_MAX_EDGE in
// api/edit/map/citymap-image.php, which lives in the endpoint and is not visible from here. Kept as its
// own name rather than moved: the endpoint's constant governs OUR downscale of an upload, this one is a
// request parameter to a foreign API. They agree today by intent, not by coupling.
const AVESMAPS_CITYMAP_THUMB_MAX_EDGE_WIKI = 400;

// Multiple selection per map (Spec §3.1). Stable keys -- German because they are domain content
// (AGENTS.md §8: never translate option slugs); the visible labels live in the editor + i18n table.
const AVESMAPS_CITYMAP_TYPE_KEYS = [
    'ortsplan', 'stadtplan', 'bezirk', 'viertel', 'lageplan', 'uebersicht', 'schauplatz', 'grundriss',
    'befestigungen', 'dungeon', 'hoehlen', 'krypten', 'katakomben', 'schatzkarte', 'region', 'sonstige',
];
// Single choice (Spec §3.1). NULL = unknown, which is why '' is not a member here.
const AVESMAPS_CITYMAP_ARTS = ['politisch', 'derographisch', 'topologisch', 'skizze'];

// Provenance (Spec §3.1). The values are behaviour, not decoration:
//   manual    -- an editor typed it (or adopted a wiki map by editing it). The wiki sync never touches it.
//   community -- born from an approved reader suggestion (§3.8). The wiki sync never touches it either.
//   wiki      -- the dump pipeline owns it: it may rewrite its fields and delete it when the wiki drops
//                the row. See api/_internal/wiki/citymap-sync.php.
// Spec §6 said "no wiki sync for maps -- curated + community only", and this list said so with it. That
// always carried the caveat "später möglich, das origin-Feld ist da", and the owner has since asked for
// exactly that, so 'wiki' is now a real origin rather than a reserved one.
// NB 'manual' doubles as the fallback for anything unrecognised (avesmapsCitymapNormalizeOrigin, below)
// -- the conservative answer, since 'manual' is precisely the value the wiki sync refuses to touch. A
// typo can therefore only ever make a map too protected, never too exposed.
const AVESMAPS_CITYMAP_ORIGINS = ['manual', 'community', 'wiki'];

// What a citymap may be pinned to (Spec §3.1, 1:1 with adventure_place). 'unresolved' is the honest
// fallback for a free-text name the resolver has not matched yet -- not an error state.
const AVESMAPS_CITYMAP_PLACE_KINDS = ['settlement', 'territory', 'region', 'path'];

const AVESMAPS_CITYMAP_TITLE_MAX = 300;
const AVESMAPS_CITYMAP_URL_MAX = 500;
const AVESMAPS_CITYMAP_NOTE_MAX = 2000;
const AVESMAPS_CITYMAP_AUTHOR_MAX = 300;
const AVESMAPS_CITYMAP_FORMAT_MAX = 120;
// 160 fits the longest real value by a wide margin: "Schmidt Spiele & Droemer Knaur" (30) is the
// two-publisher case the wiki actually has.
const AVESMAPS_CITYMAP_PUBLISHER_MAX = 160;

// ---- DDL --------------------------------------------------------------------------------------------
// Idempotent. Runs on every read (cheap: CREATE TABLE IF NOT EXISTS), so a fresh deploy self-heals on the
// first endpoint hit -- no migration step (project idiom, mirror of adventures.php / feature-sources.php).
function avesmapsCitymapsEnsureTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS citymap (
            id INT AUTO_INCREMENT PRIMARY KEY,
            public_id CHAR(36) NOT NULL,
            title VARCHAR(300) NOT NULL,
            parent_id INT NULL,
            map_url VARCHAR(500) NOT NULL DEFAULT '',
            map_local_url VARCHAR(500) NULL,
            map_license VARCHAR(24) NOT NULL DEFAULT 'unknown_other',
            map_license_note VARCHAR(2000) NULL,
            thumb_url VARCHAR(500) NULL,
            thumb_local_url VARCHAR(500) NULL,
            thumb_license VARCHAR(24) NOT NULL DEFAULT 'unknown_other',
            thumb_license_note VARCHAR(2000) NULL,
            art VARCHAR(24) NULL,
            is_color TINYINT(1) NULL,
            is_multilevel TINYINT(1) NULL,
            is_labeled TINYINT(1) NULL,
            is_official TINYINT(1) NULL,
            is_spoiler TINYINT(1) NULL,
            is_paid TINYINT(1) NULL,
            has_scale TINYINT(1) NULL,
            width_px INT NULL,
            height_px INT NULL,
            format VARCHAR(120) NULL,
            valid_from_bf INT NULL,
            valid_to_bf INT NULL,
            author VARCHAR(300) NULL,
            publisher VARCHAR(160) NULL,
            note VARCHAR(2000) NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            origin VARCHAR(16) NOT NULL DEFAULT 'manual',
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_citymap_public_id (public_id),
            KEY idx_citymap_status (status),
            KEY idx_citymap_parent (parent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS citymap_type (
            citymap_id INT NOT NULL,
            type_key VARCHAR(24) NOT NULL,
            PRIMARY KEY (citymap_id, type_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    // 1:1 to adventure_place (Spec §3.1) so the Ort-Autocomplete from docs/abenteuer-editor-p3-autocomplete.md
    // and the shared resolver (avesmapsResolvePlacesInTable) apply unchanged. The one deliberate
    // difference: no `role` column -- start/play is an adventure concept, a map simply depicts a place.
    // target_territory_path is in the CREATE rather than a self-healing ALTER because this table is new.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS citymap_place (
            id INT AUTO_INCREMENT PRIMARY KEY,
            citymap_id INT NOT NULL,
            sort_order INT NOT NULL,
            raw_name VARCHAR(300) NOT NULL,
            target_kind VARCHAR(16) NOT NULL DEFAULT 'unresolved',
            target_public_id VARCHAR(64) NULL,
            target_wiki_key VARCHAR(190) NULL,
            target_territory_path JSON NULL,
            origin VARCHAR(16) NOT NULL DEFAULT 'manual',
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            KEY idx_citymap_place_citymap (citymap_id, sort_order),
            KEY idx_citymap_place_target_public (target_public_id),
            KEY idx_citymap_place_target_wiki (target_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    // parent_id covers "übergeordnet"; this covers "verwandt" (Spec §3.1). Undirected in meaning but
    // stored directed -- the writer inserts both rows so a read never has to OR two columns.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS citymap_related (
            citymap_id INT NOT NULL,
            related_citymap_id INT NOT NULL,
            PRIMARY KEY (citymap_id, related_citymap_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // Where a map can be FOUND (docs/superpowers/specs/2026-07-17-karten-mehrfachlinks-design.md). One map
    // is often available in several places -- bought in the F-Shop, free on its wiki page, mirrored by a fan
    // project -- and the reader gets to choose. Modelled on adventure_link, with ONE added column:
    //
    // is_paid sits on the LINK, not on the map, and that is the whole point of the table. The SAME volume is
    // paid in the shop and free on its wiki page, so a flag on the map is simply wrong for every map with
    // more than one link. Tri-state like every other property (§3.1): NULL = nobody judged it, which is not
    // false -- we do not guess about a reader's wallet.
    //
    // Leaf data, like adventure_link: no wiki reconcile per row, no field_origins, no per-row identity to
    // protect -- which is why the editor replaces the whole list at once (set_links) rather than juggling ids.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS citymap_link (
            id INT AUTO_INCREMENT PRIMARY KEY,
            citymap_id INT NOT NULL,
            label VARCHAR(200) NOT NULL,
            url VARCHAR(500) NOT NULL,
            is_paid TINYINT(1) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            origin VARCHAR(16) NOT NULL DEFAULT 'manual',
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            KEY idx_citymap_link_citymap (citymap_id, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // Self-healing column-add (project idiom). NOT folded into the CREATE above: `citymap` already exists
    // in production, where CREATE TABLE IF NOT EXISTS is a no-op -- an added column only ever arrives
    // through a probe like this one, and keeping it out of the CREATE keeps one source of truth.
    $columnExists = static function (PDO $pdo, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'citymap' AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    // thumb_auto_url: the "Autoget" preview, crawled off the map's own page. EDITOR-ONLY, BY CONSTRUCTION
    // (owner decision): it is a third party's image and we hold no licence for it, so it exists purely so
    // an editor can recognise the map in the list. It gets its own column rather than a flag on
    // thumb_local_url precisely so the public read cannot leak it by forgetting a check -- there is no
    // check. avesmapsCitymapsReadCatalog simply never selects it, the same way *_license_note never
    // leaves the editor. If it ever needs to become public, that must be a deliberate new column, not a
    // one-character edit to a boolean.
    if (!$columnExists($pdo, 'thumb_auto_url')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN thumb_auto_url VARCHAR(500) NULL');
    }
    // is_paid: "you have to buy something to get this map" (owner 2026-07-17). A HUMAN sets it -- there is
    // deliberately no auto-fill, although the Ulisses product API hands us `price` in the very JSON Autoget
    // already fetches. Owner decision, and the reasoning is sound: a price is a snapshot. `isPwyw`
    // ("pay what you want") is neither clearly free nor clearly paid, sales and specialPrice can drop to 0,
    // and the column would quietly become a cache with an expiry date that nothing refreshes. Worse, it
    // would only ever answer for the RARE case: the shop sells products, not maps -- most DSA maps sit
    // inside books (see docs/superpowers/specs/2026-07-16-kartensammlung-wiki-sync-recon.md §6), and for
    // those the API knows the book, not the map.
    //
    // Three-valued like every other property (§3.1): NULL means nobody has judged it, and the reader is
    // shown nothing rather than a guess about their wallet.
    if (!$columnExists($pdo, 'is_paid')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN is_paid TINYINT(1) NULL');
    }
    // format: the printed sheet size -- "A2", "33,5x25,5", "43 x 57 cm". A VARCHAR and NOT width_px,
    // because the wiki writes centimetres and DIN names; width_px is pixels and the wiki has filled it
    // exactly once in 419 maps. Both index pages feed it (Stadtplanindex "Format", Kartenindex
    // "Abmessungen" -- one measurement, two column names).
    if (!$columnExists($pdo, 'format')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN format VARCHAR(120) NULL');
    }
    // has_scale: the SEVENTH tri-bool. The wiki's "Maßstab" column answers "does it have one?" with
    // Ja/Nein (70/36 of 230 rows measured 2026-07-17) -- it does NOT name a scale, which is why this is
    // a tri-bool and not `scale VARCHAR`. Where a page does spell one out (the Kartenindex does,
    // "1:12.750.000"), that proves has_scale=1 and the string stays visible in `note`; a value nobody
    // can read ("Forum", 24 rows) leaves this NULL and stays visible too. NULL = unknown, never false.
    if (!$columnExists($pdo, 'has_scale')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN has_scale TINYINT(1) NULL');
    }
    // publisher: the wiki's "Erschienen bei" = {{Infobox Produkt}}|Verlag on the BOOK page, copied onto
    // the card by the sync (avesmapsCitymapPublisherForSource) the same way map_url already is.
    //
    // ⛔ NOT `author`. Our own UI defines "Urheber" as who DREW the map
    // (js/map-features/map-features-citymaps-suggest.js) -- putting "Ulisses" there would have filled
    // 419 maps with a wrong attribution. It earns a column because it VARIES: Fanpro, Schmidt Spiele &
    // Droemer Knaur, Ulisses (measured on real pages 2026-07-17), so it is not one constant word.
    if (!$columnExists($pdo, 'publisher')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN publisher VARCHAR(160) NULL');
    }
}

function avesmapsCitymapsCount(PDO $pdo): int
{
    avesmapsCitymapsEnsureTables($pdo);
    return (int) $pdo->query('SELECT COUNT(*) FROM citymap')->fetchColumn();
}

// ---- kill switch (Spec §3.3) -------------------------------------------------------------------------
// Owner "emergency off": hides the whole Kartensammlung on the PUBLIC frontend while the rows stay put and
// the capability-gated editor keeps working. Backed by the generic app_setting store, NOT by a
// hand-rolled copy of the settlement variant. Default ENABLED -- only a stored '0' disables.
function avesmapsCitymapsEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_CITYMAPS_SETTING, '1') !== '0';
}

function avesmapsSetCitymapsEnabled(PDO $pdo, bool $enabled): array
{
    avesmapsAppSettingSet($pdo, AVESMAPS_CITYMAPS_SETTING, $enabled ? '1' : '0');
    return ['citymaps_enabled' => $enabled];
}

// ---- pure normalisers ---------------------------------------------------------------------------------
// Unknown/invalid falls back to the NON-free default: an unrecognised licence string must never be the
// reason a protected image gets published.
function avesmapsCitymapNormalizeLicense(mixed $value): string
{
    $v = is_string($value) ? trim($value) : '';
    return in_array($v, AVESMAPS_CITYMAP_LICENSES, true) ? $v : AVESMAPS_CITYMAP_LICENSE_DEFAULT;
}

function avesmapsCitymapLicenseIsFree(mixed $value): bool
{
    return in_array(avesmapsCitymapNormalizeLicense($value), AVESMAPS_CITYMAP_LICENSES_FREE, true);
}

// Unknown/garbage falls back to 'manual' rather than throwing: origin is our own bookkeeping, never
// reader input, and 'manual' is the conservative answer (it is the value a hand-made map carries).
function avesmapsCitymapNormalizeOrigin(mixed $value): string
{
    $v = is_string($value) ? trim($value) : '';
    return in_array($v, AVESMAPS_CITYMAP_ORIGINS, true) ? $v : 'manual';
}

// Three-valued boolean (Spec §3.1): NULL means "nobody recorded this", which is NOT false. A plain
// (bool) cast would collapse unknown into "no", and the reader would then be shown a definite
// "nicht farbig" that nobody ever asserted.
function avesmapsCitymapTriBool(mixed $raw): ?int
{
    if ($raw === null) {
        return null;
    }
    if (is_string($raw)) {
        $v = strtolower(trim($raw));
        if ($v === '' || $v === 'null' || $v === 'unknown') {
            return null;
        }
        return ($v === '0' || $v === 'false' || $v === 'nein' || $v === 'no') ? 0 : 1;
    }
    if ($raw === '') {
        return null;
    }
    return ((bool) $raw) ? 1 : 0;
}

function avesmapsCitymapIntOrNull(mixed $raw): ?int
{
    return ($raw === null || $raw === '') ? null : (int) $raw;
}

// TINYINT(1) NULL -> the three-valued JSON the client filters on. Kept as an explicit helper because
// `(bool) $row['is_color']` would turn NULL into false and silently defeat the whole §3.1 rule.
function avesmapsCitymapTriBoolOut(mixed $raw): ?bool
{
    return $raw === null ? null : ((int) $raw === 1);
}

// The reader-facing links of ONE citymap: the external map link first (§3.1: "immer gespeichert, immer
// angezeigt"), then wherever else the map can be found (citymap_link). This is the same shape
// avesmapsAdventureLinks() returns, and it is the SINGLE definition of that list: the linkcheck provider,
// the state decoration in api/app/citymaps.php and the reader row all consume it identically. That was
// written down as the reason this returned a list rather than a scalar back when there was only one link
// -- and it is what let the multi-link feature land here instead of in three places.
//
// Each entry carries its own is_paid (tri-state: true | false | null-for-unknown). It belongs to the LINK,
// never to the map: the same volume is paid in the F-Shop and free on its wiki page. Whoever asks "can the
// reader get at this for free" must ask the LINKS -- avesmapsCitymapHasFreeAccess() in
// map-features-citymaps.js is that question, and the client is the only place it is asked (the server ships
// the whole catalog and the client filters it).
//
// NOT included: a map's catalogue sources (feature_sources, §3.2). Those live in the shared `sources`
// table and are checked per SOURCE, not per citing element -- that is what the registry's source_* scopes
// are for. Keying them by citymap public_id here would produce one ref per citing map for a single URL,
// which is exactly what the source providers exist to avoid.
function avesmapsCitymapLinks(array $row, array $extraLinks = []): array
{
    $links = [];
    $mapUrl = trim((string) ($row['map_url'] ?? ''));
    if ($mapUrl !== '') {
        // The map link INHERITS the map's is_paid, because citymap.is_paid describes exactly this link and
        // no other: it was the only link a map had when that column was added. Carrying it onto the link is
        // the honest reading of today's data rather than an invention -- and it is what makes retiring the
        // column (spec §6 step 5) a pure data move: everything downstream already asks the LINK.
        $links[] = [
            'key' => 'map',
            'label' => 'Karte',
            'url' => $mapUrl,
            'is_paid' => avesmapsCitymapTriBoolOut($row['is_paid'] ?? null),
            // Skips an empty URL: sha256('') would hash and then be probed forever.
            'url_hash' => hash('sha256', $mapUrl),
        ];
    }
    foreach ($extraLinks as $extra) {
        $url = trim((string) ($extra['url'] ?? ''));
        if ($url === '') {
            continue; // same reason as above -- an empty url is not a link
        }
        $links[] = [
            'key' => 'link:' . (int) ($extra['id'] ?? 0),
            'label' => trim((string) ($extra['label'] ?? '')),
            'url' => $url,
            'is_paid' => array_key_exists('is_paid', $extra) ? avesmapsCitymapTriBoolOut($extra['is_paid']) : null,
            'url_hash' => hash('sha256', $url),
        ];
    }
    return $links;
}

// ---- Autoget: find a preview on the map's own page ---------------------------------------------------
// PURE (no PDO, no HTTP) -> unit-tested in __tests__/citymap-autoget-test.php. The fetching, and the SSRF
// guard around it, live in api/edit/map/citymap-image.php + avesmapsLinkCheckFetchBody.
//
// This REVERSES the spec: §3.3/§6 said "kein serverseitiger Bild-Fetch, SSRF-Risiko ohne Gegenwert".
// Owner decision 2026-07-16 -- the value is real (a preview without hand-work) and the risk is now
// covered by the linkcheck guard, which did not exist when that line was written. The result is
// EDITOR-ONLY (thumb_auto_url), so we crawl a picture we never publish.

// Resolve a possibly-relative URL against the page it came from. Returns '' for anything that is not
// plain http(s) afterwards -- data:, javascript:, mailto: and friends have no business here, and this is
// the last place before the URL is handed to a fetcher.
function avesmapsCitymapResolveUrl(string $candidate, string $baseUrl): string
{
    $candidate = trim($candidate);
    if ($candidate === '') {
        return '';
    }
    $base = parse_url($baseUrl);
    $baseScheme = strtolower((string) ($base['scheme'] ?? 'https'));
    $baseHost = (string) ($base['host'] ?? '');
    if ($baseHost === '') {
        return '';
    }
    $basePort = isset($base['port']) ? ':' . (int) $base['port'] : '';

    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $candidate)) {
        // Already absolute with a scheme -- keep only http/https.
        $scheme = strtolower((string) (parse_url($candidate, PHP_URL_SCHEME) ?: ''));
        return ($scheme === 'http' || $scheme === 'https') ? $candidate : '';
    }
    if (str_starts_with($candidate, '//')) {
        return $baseScheme . ':' . $candidate; // protocol-relative
    }
    if (str_starts_with($candidate, '/')) {
        return $baseScheme . '://' . $baseHost . $basePort . $candidate;
    }
    // Document-relative: hang it off the base path's directory.
    $basePath = (string) ($base['path'] ?? '/');
    $dir = substr($basePath, 0, (int) strrpos($basePath, '/') + 1);
    if ($dir === '') {
        $dir = '/';
    }
    return $baseScheme . '://' . $baseHost . $basePort . $dir . $candidate;
}

// ---- Autoget, the Ulisses special case ---------------------------------------------------------------
// The DSA shop is our single most common map source and its HTML answers 403 to any server-side request
// -- it gates on the TLS fingerprint, not on who we claim to be (verified for the linkchecker on
// 2026-07-16, re-verified here: 403 to our bot UA AND to a Chrome UA). So there is no og:image to read
// and the generic path below would simply fail on nearly every map we have.
//
// The linkchecker already solved exactly this: avesmapsLinkCheckProbeUrl rewrites a product page to the
// shop's own product API, which answers our honest bot politely. That API also carries the cover, so
// Autoget reuses the same detour rather than inventing a second piece of host knowledge. We do NOT spoof
// a browser to get past the gate -- we ask an endpoint that is willing to answer.
//
// Returns '' for every other host, and the caller then takes the og:image route.
function avesmapsCitymapUlissesApiUrl(string $mapUrl): string
{
    // Anchored on the exact host (optionally www) so a lookalike domain cannot trigger the rewrite --
    // same anchoring as avesmapsLinkCheckProbeUrl, whose regex this deliberately mirrors.
    if (preg_match('~^https?://(?:www\.)?ulisses-ebooks\.de/[a-z]{2}/product/(\d+)(?:[/?\#]|$)~i', $mapUrl, $m) === 1) {
        return 'https://api.ulisses-ebooks.de/api/vBeta/products/' . $m[1];
    }
    return '';
}

// PURE. The cover out of the product API's JSON. The paths are relative to the shop's /images/ (which
// 301s to its CDN -- the fetcher follows redirects, bounded, and re-checks the final peer).
// Priority: the full image first, because our own downscaler produces a better 400px thumb than the
// shop's 200px one; the pre-made thumbnails are the fallback when there is no full cover.
//
// TWO SHAPES, because the API CONTENT-NEGOTIATES (measured 2026-07-16, and it cost us a live failure):
//   Accept: application/json  ->  {"image":"3444/120516.jpg", ...}                 (flat)
//   no Accept header          ->  {"data":{"attributes":{"image":"3444/..."}}}     (JSON:API envelope)
// The first shipped version read only the envelope while the endpoint sent the JSON Accept header, so it
// always answered "kein Titelbild" -- and the test agreed with it, because the fixture had been copied
// from a curl run that sent no Accept header. Test and code were consistent with each other and both
// wrong about the server. Handling BOTH shapes is not belt-and-braces: which one arrives depends on a
// header far from here, and that is exactly the coupling that broke it.
function avesmapsCitymapPickUlissesImage(string $json): string
{
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return '';
    }
    $attributes = $decoded['data']['attributes'] ?? null;
    if (!is_array($attributes)) {
        $attributes = $decoded; // flat shape
    }
    foreach (['image', 'webImage', 'thumbnail200', 'thumbnail'] as $field) {
        $path = trim((string) ($attributes[$field] ?? ''));
        // Guard the shape: these are bare "<publisher>/<file>" paths. Anything else -- an absolute URL,
        // a traversal, a scheme -- is not what this API returns, and we do not improvise around it.
        if ($path === '' || str_contains($path, '..') || preg_match('~^[a-z][a-z0-9+.-]*:~i', $path) === 1 || str_starts_with($path, '/')) {
            continue;
        }
        return 'https://www.ulisses-ebooks.de/images/' . $path;
    }
    return '';
}

// ---- Autoget, the wiki route -------------------------------------------------------------------------
// PURE. The page title out of a map_url, or '' when this is not a wiki article URL.
//
// Host-anchored exactly like avesmapsCitymapUlissesApiUrl, and for a sharper reason: this route's answer
// is trusted enough to be PUBLISHED (a wiki page image is a publisher cover by construction), so a
// lookalike domain must never reach it.
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
    // rawurldecode, not urldecode: '+' is a literal plus in a path segment, not a space. parse_url has
    // already stripped any #fragment, which is not part of the title.
    $title = rawurldecode(substr($path, strlen('/wiki/')));
    // MediaWiki treats '_' and ' ' as the same character in a title, and the API answers in spaces.
    return trim(str_replace('_', ' ', $title));
}

// PURE. Which of the three routes a map_url takes.
//
// The route decides whether the result may be shown to readers (Spec §4), and it is deliberately DERIVED
// FROM THE SOURCE rather than stored as a flag: a wiki page image and an Ulisses product image are
// publisher covers by construction, an arbitrary og:image from a third-party host is not. A flag can be
// set wrongly; a route cannot.
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

// PURE. The batch query for up to 50 titles -- the reason a 133-source run costs ~6 requests.
//
// Throws above the limit rather than slicing: a silent slice would drop maps from a run that then reports
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

// PURE. [title => image url] out of the API's answer. A title that is absent simply has no page image --
// a normal answer, not an error (pageid -1 means the page does not exist at all).
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
        // We asked the WIKI for titles, so the picture must be the wiki's. A foreign host here would mean
        // the answer is choosing which server we talk to next -- exactly the og:image -> 169.254.169.254
        // shape. avesmapsLinkCheckFetchBody would still refuse it; this is the door in front of it.
        if ($source === '' || strtolower((string) parse_url($source, PHP_URL_HOST)) !== AVESMAPS_CITYMAP_WIKI_HOST) {
            continue;
        }
        $out[$title] = $source;
    }
    return $out;
}

// Pick the preview image out of a page's HTML, in the order publishers actually maintain them:
// og:image (the one every shop sets for social sharing) -> twitter:image -> link rel=image_src (legacy).
// Returns an absolute http(s) URL, or '' when the page offers none -- which is a normal answer, not an
// error: plenty of pages have no preview and the editor then uploads one.
//
// Regex rather than DOMDocument on purpose: we want the <meta> tags and nothing else, on input that is
// frequently malformed, and a parser would happily follow it into places we do not need to go.
function avesmapsCitymapPickPreviewImage(string $html, string $baseUrl): string
{
    if ($html === '') {
        return '';
    }
    // og:/twitter: use `property`, some CMSes use `name` for both -> accept either.
    $wanted = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];
    $found = [];
    if (preg_match_all('/<meta\b[^>]*>/i', $html, $metas)) {
        foreach ($metas[0] as $meta) {
            if (!preg_match('/\b(?:property|name)\s*=\s*["\']([^"\']+)["\']/i', $meta, $keyMatch)) {
                continue;
            }
            $key = strtolower(trim($keyMatch[1]));
            if (!in_array($key, $wanted, true) || isset($found[$key])) {
                continue;
            }
            if (preg_match('/\bcontent\s*=\s*["\']([^"\']*)["\']/i', $meta, $valueMatch)) {
                $value = html_entity_decode(trim($valueMatch[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                if ($value !== '') {
                    $found[$key] = $value;
                }
            }
        }
    }
    foreach ($wanted as $key) {
        if (isset($found[$key])) {
            $resolved = avesmapsCitymapResolveUrl($found[$key], $baseUrl);
            if ($resolved !== '') {
                return $resolved;
            }
        }
    }
    // Legacy fallback: <link rel="image_src" href="...">
    if (preg_match_all('/<link\b[^>]*>/i', $html, $links)) {
        foreach ($links[0] as $link) {
            if (!preg_match('/\brel\s*=\s*["\']?image_src["\']?/i', $link)) {
                continue;
            }
            if (preg_match('/\bhref\s*=\s*["\']([^"\']*)["\']/i', $link, $hrefMatch)) {
                $resolved = avesmapsCitymapResolveUrl(html_entity_decode(trim($hrefMatch[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'), $baseUrl);
                if ($resolved !== '') {
                    return $resolved;
                }
            }
        }
    }
    return '';
}

// ---- the public image gate (Spec §3.3) ----------------------------------------------------------------
// Filtered SERVER-side (pattern: map-features.php:276), not blanked in the client like the adventure
// covers: what may not go out does not leave the box.
//
// The MAP link (map_url) is never gated -- it is a hyperlink the reader clicks, not something we render.
// Everything we actually DISPLAY is gated by its own licence:
//   map_local_url   <- map_license      (our upload of the full map)
//   thumb_local_url <- thumb_license    (our upload of the preview)
//   thumb_url       <- thumb_license    (an EXTERNAL preview -- see below)
// Thumb and map have separate licences on purpose (owner decision): a source may have a free cover and a
// protected map.
//
// DEVIATION worth knowing: §3.3 spells out the gate only for the two *_local_url fields and is silent on
// thumb_url. We gate thumb_url too, because it is an image we embed rather than a link we offer, and
// §3.7 promises the reader "Vorschau nur bei freier Lizenz". Hot-linking a protected preview would break
// that promise just as thoroughly as serving our own copy of it.
function avesmapsCitymapPublicThumbUrl(array $row): string
{
    if (!avesmapsCitymapLicenseIsFree($row['thumb_license'] ?? null)) {
        return '';
    }
    $local = trim((string) ($row['thumb_local_url'] ?? ''));
    return $local !== '' ? $local : trim((string) ($row['thumb_url'] ?? ''));
}

function avesmapsCitymapPublicMapLocalUrl(array $row): string
{
    if (!avesmapsCitymapLicenseIsFree($row['map_license'] ?? null)) {
        return '';
    }
    return trim((string) ($row['map_local_url'] ?? ''));
}

// The preview the EDITOR sees -- ungated (it is the surface that classifies licences) and including the
// Autoget crawl. Never call this from the public read: thumb_auto_url is a third party's image we hold no
// licence for. The public counterpart is avesmapsCitymapPublicThumbUrl, which does not know it exists.
function avesmapsCitymapEditorThumbUrl(array $row): string
{
    foreach (['thumb_local_url', 'thumb_auto_url', 'thumb_url'] as $field) {
        $value = trim((string) ($row[$field] ?? ''));
        if ($value !== '') {
            return $value;
        }
    }
    return '';
}

// ---- public catalog read (Spec §3.5) ------------------------------------------------------------------
// The whole approved catalog in ONE payload so the client indexes + aggregates locally, exactly like
// api/app/adventures.php. Batched throughout: one query for the maps, one for the places, one for the
// types, one for the related links, one for the sources -- never per map. (§3.5 says "zwei Queries"; the
// point of that sentence is "no N+1", and types/related/sources each need their own batched pass.)
//
// Editor-only fields (*_license_note) and non-free images never enter the returned shape at all.
function avesmapsCitymapsReadCatalog(PDO $pdo): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT id, public_id, title, parent_id, map_url, map_local_url, map_license,
                thumb_url, thumb_local_url, thumb_license, art, is_color, is_multilevel, is_labeled,
                is_official, is_spoiler, is_paid, has_scale, width_px, height_px, format,
                valid_from_bf, valid_to_bf, author, publisher, note
           FROM citymap
          WHERE status = 'approved'
          ORDER BY title ASC"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $ids = array_map(static fn(array $r): int => (int) $r['id'], $rows);
    // id -> public_id, so parent/related can be emitted as PUBLIC ids (the surrogate id never goes out).
    $publicIdById = [];
    foreach ($rows as $row) {
        $publicIdById[(int) $row['id']] = (string) $row['public_id'];
    }

    $placesByCitymap = avesmapsCitymapPlacesByCitymap($pdo, $ids);
    $typesByCitymap = avesmapsCitymapTypesByCitymap($pdo, $ids);
    $relatedByCitymap = avesmapsCitymapRelatedByCitymap($pdo, $ids);
    $linksByCitymap = avesmapsCitymapLinksByCitymap($pdo, $ids);
    $sourcesByPublicId = [];
    try {
        $sourcesByPublicId = avesmapsReadFeatureSourcesByEntityType($pdo, 'citymap');
    } catch (Throwable) {
        // Same reasoning as the link-state decoration in api/app/adventures.php: a source list is a
        // decoration on the catalog, not the catalog. Losing it must not take the whole map collection
        // down -- the maps still render, just without their source line.
        $sourcesByPublicId = [];
    }

    $citymaps = [];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $parentId = $row['parent_id'] !== null ? (int) $row['parent_id'] : 0;
        $citymaps[] = [
            'public_id' => (string) $row['public_id'],
            'title' => (string) $row['title'],
            // A parent that is suppressed/absent is simply not linked -- never a dangling id.
            'parent_public_id' => $parentId > 0 ? ($publicIdById[$parentId] ?? '') : '',
            'map_url' => (string) $row['map_url'],
            'map_local_url' => avesmapsCitymapPublicMapLocalUrl($row),
            'thumb' => avesmapsCitymapPublicThumbUrl($row),
            'art' => (string) ($row['art'] ?? ''),
            'is_color' => avesmapsCitymapTriBoolOut($row['is_color']),
            'is_multilevel' => avesmapsCitymapTriBoolOut($row['is_multilevel']),
            'is_labeled' => avesmapsCitymapTriBoolOut($row['is_labeled']),
            'is_official' => avesmapsCitymapTriBoolOut($row['is_official']),
            'is_spoiler' => avesmapsCitymapTriBoolOut($row['is_spoiler']),
            'is_paid' => avesmapsCitymapTriBoolOut($row['is_paid'] ?? null),
            'has_scale' => avesmapsCitymapTriBoolOut($row['has_scale'] ?? null),
            'width_px' => $row['width_px'] !== null ? (int) $row['width_px'] : null,
            'height_px' => $row['height_px'] !== null ? (int) $row['height_px'] : null,
            // The printed sheet size ("A2", "43 x 57 cm") -- what the wiki actually records, unlike
            // width_px (filled on 1 of 419 maps). See the DDL note.
            'format' => (string) ($row['format'] ?? ''),
            'valid_from_bf' => $row['valid_from_bf'] !== null ? (int) $row['valid_from_bf'] : null,
            'valid_to_bf' => $row['valid_to_bf'] !== null ? (int) $row['valid_to_bf'] : null,
            'author' => (string) ($row['author'] ?? ''),
            // "Erschienen bei" -- who printed the book, NOT who drew the map (that is `author`).
            'publisher' => (string) ($row['publisher'] ?? ''),
            'note' => (string) ($row['note'] ?? ''),
            'types' => $typesByCitymap[$id] ?? [],
            'related' => array_values(array_filter(array_map(
                static fn(int $relatedId): string => $publicIdById[$relatedId] ?? '',
                $relatedByCitymap[$id] ?? []
            ))),
            'places' => $placesByCitymap[$id] ?? [],
            'sources' => $sourcesByPublicId[(string) $row['public_id']] ?? [],
            // The endpoint decorates each entry with its checked state; this library deliberately knows
            // nothing about the linkchecker.
            'links' => avesmapsCitymapLinks($row, $linksByCitymap[$id] ?? []),
        ];
    }
    return $citymaps;
}

// All places of many maps in one query (INDEX citymap_id, sort_order), grouped in PHP.
function avesmapsCitymapPlacesByCitymap(PDO $pdo, array $citymapIds): array
{
    $ids = array_values(array_unique(array_map('intval', $citymapIds)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT citymap_id, target_kind, target_public_id, target_wiki_key, target_territory_path, raw_name, sort_order
           FROM citymap_place
          WHERE status = 'approved' AND citymap_id IN ($placeholders)
          ORDER BY citymap_id ASC, sort_order ASC"
    );
    $statement->execute($ids);

    $byCitymap = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $place) {
        $territoryPath = [];
        if (($place['target_territory_path'] ?? null) !== null) {
            $decoded = json_decode((string) $place['target_territory_path'], true);
            if (is_array($decoded)) {
                $territoryPath = array_values(array_map(static fn($value): string => (string) $value, $decoded));
            }
        }
        $byCitymap[(int) $place['citymap_id']][] = [
            'target_kind' => (string) $place['target_kind'],
            'target_public_id' => $place['target_public_id'] !== null ? (string) $place['target_public_id'] : '',
            'target_wiki_key' => $place['target_wiki_key'] !== null ? (string) $place['target_wiki_key'] : '',
            'territory_path' => $territoryPath,
            'raw_name' => (string) $place['raw_name'],
            'sort_order' => (int) $place['sort_order'],
        ];
    }
    return $byCitymap;
}

function avesmapsCitymapTypesByCitymap(PDO $pdo, array $citymapIds): array
{
    $ids = array_values(array_unique(array_map('intval', $citymapIds)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT citymap_id, type_key FROM citymap_type WHERE citymap_id IN ($placeholders) ORDER BY citymap_id ASC, type_key ASC"
    );
    $statement->execute($ids);

    $byCitymap = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $byCitymap[(int) $row['citymap_id']][] = (string) $row['type_key'];
    }
    return $byCitymap;
}

function avesmapsCitymapRelatedByCitymap(PDO $pdo, array $citymapIds): array
{
    $ids = array_values(array_unique(array_map('intval', $citymapIds)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT citymap_id, related_citymap_id FROM citymap_related WHERE citymap_id IN ($placeholders) ORDER BY citymap_id ASC"
    );
    $statement->execute($ids);

    $byCitymap = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $byCitymap[(int) $row['citymap_id']][] = (int) $row['related_citymap_id'];
    }
    return $byCitymap;
}

// The stored links of MANY maps in one query, grouped by citymap_id (never per map -- the catalog read and
// the linkcheck provider both walk the whole table). Returns [citymap_id => [{id, label, url, is_paid}]] in
// display order; maps without links are simply absent. Suppressed rows (tombstones) stay out: they are the
// record of a link somebody removed, not something to show or probe.
function avesmapsCitymapLinksByCitymap(PDO $pdo, array $citymapIds): array
{
    $ids = array_values(array_unique(array_map('intval', $citymapIds)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT id, citymap_id, label, url, is_paid
           FROM citymap_link
          WHERE status = 'approved' AND citymap_id IN ($placeholders)
          ORDER BY citymap_id ASC, sort_order ASC, id ASC"
    );
    $statement->execute($ids);

    $byCitymap = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $byCitymap[(int) $row['citymap_id']][] = [
            'id' => (int) $row['id'],
            'label' => (string) $row['label'],
            'url' => (string) $row['url'],
            'is_paid' => avesmapsCitymapTriBoolOut($row['is_paid']),
        ];
    }
    return $byCitymap;
}

// =====================================================================================================
// EDITOR-ONLY from here down (capability 'edit', reached via api/edit/map/citymaps.php).
//
// Same layering rule as adventures.php: the PUBLIC read path above must not need any of this, and must
// not pull in the ambient editor globals these use -- avesmapsUuidV4() (api/_internal/map/features.php)
// and avesmapsErrorResponse() (api/_internal/bootstrap.php) are loaded by the edit dispatcher.
// =====================================================================================================

// The editor list: every map incl. drafts, with the counts the list rows show. Batched, no N+1.
function avesmapsListCitymapsForEdit(PDO $pdo): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT id, public_id, title, parent_id, map_url, map_local_url, map_license,
                thumb_url, thumb_local_url, thumb_auto_url, thumb_license, art, is_official, is_spoiler,
                valid_from_bf, valid_to_bf, status, origin
           FROM citymap
          ORDER BY title ASC"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return ['citymaps' => [], 'citymaps_enabled' => avesmapsCitymapsEnabled($pdo)];
    }

    $ids = array_map(static fn(array $r): int => (int) $r['id'], $rows);
    $typesByCitymap = avesmapsCitymapTypesByCitymap($pdo, $ids);

    $placeCounts = [];
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $countStatement = $pdo->prepare(
        "SELECT citymap_id, COUNT(*) AS n FROM citymap_place
          WHERE status = 'approved' AND citymap_id IN ($placeholders) GROUP BY citymap_id"
    );
    $countStatement->execute($ids);
    foreach ($countStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $placeCounts[(int) $row['citymap_id']] = (int) $row['n'];
    }

    $citymaps = [];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        // The editor sees the images regardless of licence (it is the surface that classifies them);
        // only the public read gates. Same rule as the adventure covers. The Autoget preview ranks last:
        // it is the fallback that exists so an unclassified map is still recognisable in this list.
        $citymaps[] = [
            'public_id' => (string) $row['public_id'],
            'title' => (string) $row['title'],
            'map_url' => (string) $row['map_url'],
            'map_local_url' => (string) ($row['map_local_url'] ?? ''),
            'thumb' => avesmapsCitymapEditorThumbUrl($row),
            'art' => (string) ($row['art'] ?? ''),
            'types' => $typesByCitymap[$id] ?? [],
            'is_official' => avesmapsCitymapTriBoolOut($row['is_official']),
            'is_spoiler' => avesmapsCitymapTriBoolOut($row['is_spoiler']),
            'valid_from_bf' => $row['valid_from_bf'] !== null ? (int) $row['valid_from_bf'] : null,
            'valid_to_bf' => $row['valid_to_bf'] !== null ? (int) $row['valid_to_bf'] : null,
            'status' => (string) $row['status'],
            'origin' => (string) $row['origin'],
            'map_license' => (string) $row['map_license'],
            'thumb_license' => (string) $row['thumb_license'],
            'place_count' => $placeCounts[$id] ?? 0,
        ];
    }
    return ['citymaps' => $citymaps, 'citymaps_enabled' => avesmapsCitymapsEnabled($pdo)];
}

// One map with everything the editor edits -- licence notes included (they never reach the public read).
function avesmapsCitymapDetailForEdit(PDO $pdo, string $publicId): ?array
{
    avesmapsCitymapsEnsureTables($pdo);
    $statement = $pdo->prepare('SELECT * FROM citymap WHERE public_id = :pid LIMIT 1');
    $statement->execute(['pid' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        return null;
    }
    $id = (int) $row['id'];

    $parentPublicId = '';
    if ($row['parent_id'] !== null) {
        $parent = $pdo->prepare('SELECT public_id FROM citymap WHERE id = :id LIMIT 1');
        $parent->execute(['id' => (int) $row['parent_id']]);
        $parentPublicId = (string) ($parent->fetchColumn() ?: '');
    }

    $related = [];
    $relatedStatement = $pdo->prepare(
        'SELECT c.public_id, c.title FROM citymap_related r
           JOIN citymap c ON c.id = r.related_citymap_id
          WHERE r.citymap_id = :id ORDER BY c.title ASC'
    );
    $relatedStatement->execute(['id' => $id]);
    foreach ($relatedStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $relatedRow) {
        $related[] = ['public_id' => (string) $relatedRow['public_id'], 'title' => (string) $relatedRow['title']];
    }

    // Suppressed places travel too -- the editor shows them behind its "unterdrückte" toggle so a
    // tombstone can be restored.
    $places = [];
    $placeStatement = $pdo->prepare(
        'SELECT id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, origin, status
           FROM citymap_place WHERE citymap_id = :id ORDER BY sort_order ASC, id ASC'
    );
    $placeStatement->execute(['id' => $id]);
    foreach ($placeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $place) {
        $places[] = [
            'id' => (int) $place['id'],
            'sort_order' => (int) $place['sort_order'],
            'raw_name' => (string) $place['raw_name'],
            'target_kind' => (string) $place['target_kind'],
            'target_public_id' => $place['target_public_id'] !== null ? (string) $place['target_public_id'] : '',
            'target_wiki_key' => $place['target_wiki_key'] !== null ? (string) $place['target_wiki_key'] : '',
            'origin' => (string) $place['origin'],
            'status' => (string) $place['status'],
        ];
    }

    // TWO lists, and the split is load-bearing (Spec 2026-07-17-community-fundorte §3.5):
    //
    //   links         -- origin='manual': what the editor OWNS and what set_links replaces wholesale.
    //   foreign_links -- community/wiki: what someone else authored. READ-ONLY, with a suppress action.
    //
    // They are split HERE, in the payload, rather than in the editor's UI, because set_links posts the list
    // back with no ids: anything the editor can SEE it will RE-CREATE as 'manual' on the next save. A
    // foreign row in the editable list would duplicate itself (once as 'community', once as 'manual'). A UI
    // rule would be forgotten at the next rebuild; a separate field cannot be.
    //
    // Suppressed rows travel too -- the editor shows them behind its toggle so a tombstone can be undone,
    // same as citymap_place.
    $links = [];
    $foreignLinks = [];
    $linkStatement = $pdo->prepare(
        "SELECT id, label, url, is_paid, origin, status FROM citymap_link
          WHERE citymap_id = :id AND (origin = 'manual' OR status <> 'suppressed')
          ORDER BY sort_order ASC, id ASC"
    );
    $linkStatement->execute(['id' => $id]);
    foreach ($linkStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $link) {
        $origin = (string) $link['origin'];
        if ($origin === 'manual') {
            // The editable list carries no id on purpose: set_links keys on position, not identity.
            if ((string) $link['status'] === 'approved') {
                $links[] = [
                    'label' => (string) $link['label'],
                    'url' => (string) $link['url'],
                    'is_paid' => avesmapsCitymapTriBoolOut($link['is_paid']),
                ];
            }
            continue;
        }
        $foreignLinks[] = [
            'id' => (int) $link['id'], // suppress_link addresses it by id -- it is a real row, not a position
            'label' => (string) $link['label'],
            'url' => (string) $link['url'],
            'is_paid' => avesmapsCitymapTriBoolOut($link['is_paid']),
            'origin' => $origin,
            'status' => (string) $link['status'],
        ];
    }

    return [
        'citymap' => [
            'public_id' => (string) $row['public_id'],
            'title' => (string) $row['title'],
            'parent_public_id' => $parentPublicId,
            'map_url' => (string) $row['map_url'],
            'map_local_url' => (string) ($row['map_local_url'] ?? ''),
            'map_license' => (string) $row['map_license'],
            'map_license_note' => (string) ($row['map_license_note'] ?? ''),
            'thumb_url' => (string) ($row['thumb_url'] ?? ''),
            'thumb_local_url' => (string) ($row['thumb_local_url'] ?? ''),
            // Editor-only (see avesmapsCitymapsEnsureTables): the Autoget crawl. Reaches this payload
            // because the editor must show + manage it; never reaches api/app/citymaps.php.
            'thumb_auto_url' => (string) ($row['thumb_auto_url'] ?? ''),
            'thumb_license' => (string) $row['thumb_license'],
            'thumb_license_note' => (string) ($row['thumb_license_note'] ?? ''),
            'art' => (string) ($row['art'] ?? ''),
            'is_color' => avesmapsCitymapTriBoolOut($row['is_color']),
            'is_multilevel' => avesmapsCitymapTriBoolOut($row['is_multilevel']),
            'is_labeled' => avesmapsCitymapTriBoolOut($row['is_labeled']),
            'is_official' => avesmapsCitymapTriBoolOut($row['is_official']),
            'is_spoiler' => avesmapsCitymapTriBoolOut($row['is_spoiler']),
            'is_paid' => avesmapsCitymapTriBoolOut($row['is_paid'] ?? null),
            'has_scale' => avesmapsCitymapTriBoolOut($row['has_scale'] ?? null),
            'width_px' => $row['width_px'] !== null ? (int) $row['width_px'] : null,
            'height_px' => $row['height_px'] !== null ? (int) $row['height_px'] : null,
            'format' => (string) ($row['format'] ?? ''),
            'valid_from_bf' => $row['valid_from_bf'] !== null ? (int) $row['valid_from_bf'] : null,
            'valid_to_bf' => $row['valid_to_bf'] !== null ? (int) $row['valid_to_bf'] : null,
            'author' => (string) ($row['author'] ?? ''),
            'publisher' => (string) ($row['publisher'] ?? ''),
            'note' => (string) ($row['note'] ?? ''),
            'status' => (string) $row['status'],
            'origin' => (string) $row['origin'],
        ],
        'types' => avesmapsCitymapTypesByCitymap($pdo, [$id])[$id] ?? [],
        'related' => $related,
        'places' => $places,
        'links' => $links,
        'foreign_links' => $foreignLinks,
    ];
}

// Create or update. An empty public_id means CREATE; otherwise only the SENT fields are written
// (array_key_exists, so an explicit null counts as "sent" and clears to unknown). map_local_url /
// thumb_local_url are NOT editable here on purpose -- only the upload endpoint may set them, because they
// name a file we host.
// $origin stamps a NEWLY CREATED map. It defaults to 'manual', so every existing caller behaves exactly
// as before. It exists so that a map from a non-editor source comes through THIS door rather than
// growing a second insert path that would drift out of sync with the validation above. Two callers pass
// it: the report approval in api/edit/reports/locations.php ('community', Spec §3.8) and the wiki
// reconcile in api/_internal/wiki/citymap-sync.php ('wiki').
//
// On UPDATE, origin is preserved with ONE deliberate exception: a 'wiki' map becomes 'manual' (see the
// UPDATE branch). Editing a wiki map has to take it away from the sync, which would otherwise overwrite
// the edit on its next run. 'community' and 'manual' are never rewritten, so a community map keeps its
// provenance even after an editor reworks every field of it.
function avesmapsUpsertCitymap(PDO $pdo, array $data, int $userId = 0, string $origin = 'manual'): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $title = trim((string) ($data['title'] ?? ''));
    if ($title === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Ein Titel ist erforderlich.');
    }
    if (mb_strlen($title) > AVESMAPS_CITYMAP_TITLE_MAX) {
        avesmapsErrorResponse(400, 'invalid_request', 'Der Titel ist zu lang (max. ' . AVESMAPS_CITYMAP_TITLE_MAX . ' Zeichen).');
    }

    $editableFields = [
        'map_url', 'map_license', 'map_license_note', 'thumb_url', 'thumb_license', 'thumb_license_note',
        'art', 'is_color', 'is_multilevel', 'is_labeled', 'is_official', 'is_spoiler', 'is_paid', 'has_scale',
        'width_px', 'height_px', 'format', 'valid_from_bf', 'valid_to_bf', 'author', 'publisher', 'note',
        'status',
    ];

    $normalize = static function (string $field, mixed $raw): int|string|null {
        if (in_array($field, ['is_color', 'is_multilevel', 'is_labeled', 'is_official', 'is_spoiler', 'is_paid',
            'has_scale'], true)) {
            return avesmapsCitymapTriBool($raw);
        }
        if (in_array($field, ['width_px', 'height_px', 'valid_from_bf', 'valid_to_bf'], true)) {
            return avesmapsCitymapIntOrNull($raw);
        }
        if ($field === 'map_license' || $field === 'thumb_license') {
            return avesmapsCitymapNormalizeLicense($raw); // NOT NULL column -> always a string
        }
        if ($field === 'map_url') {
            return avesmapsCitymapNormalizeUrl($raw, 'Karten-Link'); // NOT NULL DEFAULT '' -> always a string
        }
        if ($field === 'thumb_url') {
            $value = avesmapsCitymapNormalizeUrl($raw, 'Vorschau-Link');
            return $value === '' ? null : $value;
        }
        if ($field === 'art') {
            $value = trim((string) $raw);
            if ($value === '') {
                return null; // unknown, per §3.1
            }
            if (!in_array($value, AVESMAPS_CITYMAP_ARTS, true)) {
                throw new InvalidArgumentException('Unbekannte Art: ' . $value);
            }
            return $value;
        }
        if ($field === 'status') {
            $value = trim((string) $raw);
            return in_array($value, ['approved', 'suppressed'], true) ? $value : 'approved';
        }
        // nullable text: empty -> NULL (unknown), so an emptied field really clears
        $value = trim((string) $raw);
        if (in_array($field, ['map_license_note', 'thumb_license_note', 'note'], true) && mb_strlen($value) > AVESMAPS_CITYMAP_NOTE_MAX) {
            throw new InvalidArgumentException('Der Text ist zu lang (max. ' . AVESMAPS_CITYMAP_NOTE_MAX . ' Zeichen).');
        }
        if ($field === 'author' && mb_strlen($value) > AVESMAPS_CITYMAP_AUTHOR_MAX) {
            throw new InvalidArgumentException('Der Urheber ist zu lang (max. ' . AVESMAPS_CITYMAP_AUTHOR_MAX . ' Zeichen).');
        }
        if ($field === 'format' && mb_strlen($value) > AVESMAPS_CITYMAP_FORMAT_MAX) {
            throw new InvalidArgumentException('Das Format ist zu lang (max. ' . AVESMAPS_CITYMAP_FORMAT_MAX . ' Zeichen).');
        }
        if ($field === 'publisher' && mb_strlen($value) > AVESMAPS_CITYMAP_PUBLISHER_MAX) {
            throw new InvalidArgumentException('Der Verlag ist zu lang (max. ' . AVESMAPS_CITYMAP_PUBLISHER_MAX . ' Zeichen).');
        }
        return $value === '' ? null : $value;
    };

    $values = [];
    foreach ($editableFields as $field) {
        if (array_key_exists($field, $data)) {
            $values[$field] = $normalize($field, $data[$field]);
        }
    }
    $values['title'] = $title;

    // parent_public_id -> parent_id. Sent-but-empty clears the parent.
    if (array_key_exists('parent_public_id', $data)) {
        $values['parent_id'] = avesmapsCitymapResolveParentId($pdo, trim((string) ($data['parent_public_id'] ?? '')));
    }

    $publicId = trim((string) ($data['public_id'] ?? ''));

    if ($publicId === '') {
        $publicId = avesmapsUuidV4();
        $columns = array_keys($values);
        $insertColumns = array_merge(['public_id', 'origin', 'created_by'], $columns);
        $placeholders = array_map(static fn(string $c): string => ':' . $c, $insertColumns);
        $params = ['public_id' => $publicId, 'origin' => avesmapsCitymapNormalizeOrigin($origin), 'created_by' => $userId > 0 ? $userId : null];
        foreach ($columns as $column) {
            $params[$column] = $values[$column];
        }
        $pdo->prepare(
            'INSERT INTO citymap (' . implode(', ', $insertColumns) . ') VALUES (' . implode(', ', $placeholders) . ')'
        )->execute($params);
        return ['public_id' => $publicId, 'created' => true];
    }

    $find = $pdo->prepare('SELECT id FROM citymap WHERE public_id = :pid LIMIT 1');
    $find->execute(['pid' => $publicId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Karte wurde nicht gefunden.');
    }

    $setClauses = [];
    $params = ['pid' => $publicId];
    foreach ($values as $column => $value) {
        $setClauses[] = $column . ' = :' . $column;
        $params[$column] = $value;
    }
    // ADOPTION: hand-editing a wiki-born map takes it away from the sync, which would otherwise
    // overwrite the edit on its next run (it rewrites every field of an origin='wiki' row). This is the
    // same move avesmapsCitymapResolvePlace already makes for a manually chosen place target ("origin is
    // always stamped 'manual' so a re-resolve leaves it alone"). Scoped with IF() to origin='wiki' on
    // purpose: a community map stays 'community' when an editor corrects a typo, so the pill keeps
    // telling the truth about where the map came from.
    $setClauses[] = "origin = IF(origin = 'wiki', 'manual', origin)";
    $pdo->prepare('UPDATE citymap SET ' . implode(', ', $setClauses) . ' WHERE public_id = :pid')->execute($params);
    return ['public_id' => $publicId, 'created' => false];
}

// http/https only, length-checked. Enforced in PHP rather than left to MySQL: a silently truncated URL is
// a broken link. The probe refuses any other scheme anyway (Spec §1.4), so a stored mailto:/ftp: could
// never be checked -- and would still be handed to the reader as a live href.
function avesmapsCitymapNormalizeUrl(mixed $raw, string $label): string
{
    $url = trim((string) $raw);
    if ($url === '') {
        return '';
    }
    $scheme = strtolower((string) (parse_url($url, PHP_URL_SCHEME) ?: ''));
    if ($scheme !== 'http' && $scheme !== 'https') {
        throw new InvalidArgumentException('Nur http/https-Links sind erlaubt (' . $label . ').');
    }
    if (strlen($url) > AVESMAPS_CITYMAP_URL_MAX) {
        throw new InvalidArgumentException('Die URL ist zu lang (max. ' . AVESMAPS_CITYMAP_URL_MAX . ' Zeichen, ' . $label . ').');
    }
    return $url;
}

// ---- community suggestion (Spec §3.8) ----------------------------------------------------------------
// PURE (no PDO, no HTTP) -> unit-tested in __tests__/citymap-report-test.php.
//
// Normalizes a reader's map proposal into exactly the three shapes the approval consumes:
// avesmapsUpsertCitymap(['citymap']), avesmapsSetCitymapTypes(['types']), avesmapsAddCitymapPlace(['place']).
// It runs on the PUBLIC endpoint (api/app/report-location.php) with capability NONE, so its output is
// untrusted input that has passed a whitelist -- and anything it does not return can never reach a column.
//
// An ALLOWLIST by construction: a field the editor grows later does NOT silently become community-writable.
// Three groups are absent ON PURPOSE:
//
//  - map_license / thumb_license and their notes. OWNER DECISION 2026-07-16: the community dialog does not
//    offer them and this function does not accept them. The gate believes the COLUMN, not the sender --
//    and thumb_url IS gated (avesmapsCitymapPublicThumbUrl), while an upload needs capability `edit`. An
//    external preview is therefore the one image surface a stranger can touch, and a "cc0" claim on a
//    publisher's preview would otherwise make us hot-link it. Because the keys never appear, the INSERT
//    never names the columns and the NOT NULL DEFAULT 'unknown_other' stands on its own -- the gate is not
//    bypassed here, it is simply never addressed. A suggested thumb_url is thus STORED but invisible to
//    readers until an editor classifies the licence, while staying visible to that editor
//    (avesmapsCitymapEditorThumbUrl is ungated). Nothing the reporter KNOWS is lost; nothing they merely
//    CLAIM has any effect. A licence they genuinely know ("my own map, CC0") goes in `note`, where it
//    reads as what it is: a claim addressed to a human.
//  - map_local_url / thumb_local_url / thumb_auto_url -- uploads and the Autoget crawl, capability `edit`.
//  - status / origin / parent_public_id / related -- moderation plus cross-map references. The first two
//    are ours to decide; the last two name other maps by public_id, which a reader has no way to know.
function avesmapsNormalizeCitymapReportPayload(mixed $raw): array
{
    $data = is_array($raw) ? $raw : [];

    $title = avesmapsCitymapReportText($data['title'] ?? '', AVESMAPS_CITYMAP_TITLE_MAX, 'Der Titel');
    if ($title === '') {
        throw new InvalidArgumentException('Bitte einen Titel fuer die Karte angeben.');
    }
    // §3.1 makes title + source mandatory and everything else optional. map_url is the map itself: without
    // it the proposal is a name with nothing behind it, which is why the editor marks it "*" as well.
    $mapUrl = avesmapsCitymapNormalizeUrl($data['map_url'] ?? '', 'Karten-Link');
    if ($mapUrl === '') {
        throw new InvalidArgumentException('Bitte einen Karten-Link angeben.');
    }

    $citymap = [
        'title' => $title,
        'map_url' => $mapUrl,
        'thumb_url' => avesmapsCitymapNormalizeUrl($data['thumb_url'] ?? '', 'Vorschau-Link'),
        'author' => avesmapsCitymapReportText($data['author'] ?? '', AVESMAPS_CITYMAP_AUTHOR_MAX, 'Der Urheber'),
        'note' => avesmapsCitymapReportText($data['note'] ?? '', AVESMAPS_CITYMAP_NOTE_MAX, 'Die Notiz'),
    ];

    // An unknown art is DROPPED to "unknown" rather than refused. The dialog offers a fixed select, so a
    // stray value means a hand-built request -- and §3.1 already has an honest answer for "we do not know
    // what kind of map this is". Same forgiving direction as avesmapsNormalizeReportSources' type.
    $art = trim((string) ($data['art'] ?? ''));
    $citymap['art'] = in_array($art, AVESMAPS_CITYMAP_ARTS, true) ? $art : '';

    // is_paid rides along: it is a plain observation ("you have to buy this"), not a claim that unlocks
    // anything. Unlike a licence it gates nothing -- a reporter looking at a shop page simply knows it, and
    // §3.8's "Feldumfang voll wie im Editor" applies.
    foreach (['is_color', 'is_multilevel', 'is_labeled', 'is_official', 'is_spoiler', 'is_paid'] as $field) {
        $citymap[$field] = avesmapsCitymapTriBool($data[$field] ?? null);
    }
    foreach (['valid_from_bf', 'valid_to_bf', 'width_px', 'height_px'] as $field) {
        $citymap[$field] = avesmapsCitymapIntOrNull($data[$field] ?? null);
    }

    $types = [];
    foreach (is_array($data['types'] ?? null) ? $data['types'] : [] as $type) {
        $key = is_string($type) ? trim($type) : '';
        if (in_array($key, AVESMAPS_CITYMAP_TYPE_KEYS, true) && !in_array($key, $types, true)) {
            $types[] = $key;
        }
    }

    return [
        'citymap' => $citymap,
        'types' => $types,
        'place' => avesmapsNormalizeCitymapReportPlace($data['place'] ?? null),
    ];
}

// The place the map was suggested FROM (Spec §3.9: settlement | territory | region | path). The dialog
// fills this from whichever Kartensammlung the reader had open, so it is normally exact.
//
// target_public_id is accepted from the client on purpose: the worst a wrong one can do is hang the map on
// the wrong place -- a content error the approving editor sees (the raw_name is right there) and fixes in
// the editor. It is not an authorization boundary. A public_id that matches nothing simply yields no
// wiki_key and the shared resolver falls back to the name, which is the 'unresolved' path working as
// designed. Returns [] when there is no usable name: a map with no place is a valid citymap (§3.1).
function avesmapsNormalizeCitymapReportPlace(mixed $raw): array
{
    $place = is_array($raw) ? $raw : [];
    $rawName = avesmapsCitymapReportText($place['raw_name'] ?? '', 300, 'Der Ortsname');
    if ($rawName === '') {
        return [];
    }

    $kind = trim((string) ($place['target_kind'] ?? ''));
    return [
        'raw_name' => $rawName,
        'target_kind' => in_array($kind, AVESMAPS_CITYMAP_PLACE_KINDS, true) ? $kind : 'unresolved',
        'target_public_id' => avesmapsCitymapReportText($place['target_public_id'] ?? '', 64, 'Die Orts-ID'),
        'target_wiki_key' => avesmapsCitymapReportText($place['target_wiki_key'] ?? '', 190, 'Der Wiki-Schluessel'),
    ];
}

// Trim + collapse whitespace, then REFUSE anything over the column width instead of truncating. The rest of
// the report pipeline truncates (avesmapsNormalizeSingleLine), which is right for a free-text comment and
// wrong here: a silently shortened title or author is a wrong fact stored under a reader's name, and a
// shortened id or wiki key resolves to the wrong element (or to nothing) with no trace of why.
function avesmapsCitymapReportText(mixed $raw, int $max, string $label): string
{
    $value = trim((string) preg_replace('/\s+/u', ' ', (string) $raw));
    if ($value === '') {
        return '';
    }
    if (mb_strlen($value) > $max) {
        throw new InvalidArgumentException($label . ' ist zu lang (max. ' . $max . ' Zeichen).');
    }
    return $value;
}

function avesmapsCitymapResolveParentId(PDO $pdo, string $parentPublicId): ?int
{
    if ($parentPublicId === '') {
        return null;
    }
    $statement = $pdo->prepare('SELECT id FROM citymap WHERE public_id = :pid LIMIT 1');
    $statement->execute(['pid' => $parentPublicId]);
    $id = $statement->fetchColumn();
    if ($id === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die übergeordnete Karte wurde nicht gefunden.');
    }
    return (int) $id;
}

// The editor always posts the COMPLETE type list, so this replaces it wholesale -- no id juggling, and an
// empty array legitimately clears it. Unknown keys are refused rather than dropped: a silently ignored
// type looks exactly like a saved one in the UI.
function avesmapsSetCitymapTypes(PDO $pdo, string $publicId, array $typeKeys): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $publicId);

    $keys = [];
    foreach ($typeKeys as $key) {
        $value = trim((string) $key);
        if ($value === '') {
            continue;
        }
        if (!in_array($value, AVESMAPS_CITYMAP_TYPE_KEYS, true)) {
            throw new InvalidArgumentException('Unbekannter Typ: ' . $value);
        }
        $keys[$value] = true; // dedupe -- the PK would reject a repeat mid-transaction
    }
    $keys = array_keys($keys);

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM citymap_type WHERE citymap_id = :id')->execute(['id' => $citymapId]);
        $insert = $pdo->prepare('INSERT INTO citymap_type (citymap_id, type_key) VALUES (:id, :key)');
        foreach ($keys as $key) {
            $insert->execute(['id' => $citymapId, 'key' => $key]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }
    return ['public_id' => $publicId, 'types' => $keys];
}

// Whole-list replace, like set_types. Stored in BOTH directions so "verwandt" reads symmetrically without
// a query having to OR two columns -- and so removing the relation from either side removes it once.
function avesmapsSetCitymapRelated(PDO $pdo, string $publicId, array $relatedPublicIds): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $publicId);

    $relatedIds = [];
    foreach ($relatedPublicIds as $relatedPublicId) {
        $value = trim((string) $relatedPublicId);
        if ($value === '' || $value === $publicId) {
            continue; // a map is not related to itself
        }
        $relatedIds[avesmapsCitymapIdByPublicId($pdo, $value)] = true;
    }
    $relatedIds = array_keys($relatedIds);

    $pdo->beginTransaction();
    try {
        // Drop this map's relations from both sides before rewriting them.
        $pdo->prepare('DELETE FROM citymap_related WHERE citymap_id = :id OR related_citymap_id = :id2')
            ->execute(['id' => $citymapId, 'id2' => $citymapId]);
        $insert = $pdo->prepare(
            'INSERT IGNORE INTO citymap_related (citymap_id, related_citymap_id) VALUES (:a, :b)'
        );
        foreach ($relatedIds as $relatedId) {
            $insert->execute(['a' => $citymapId, 'b' => $relatedId]);
            $insert->execute(['a' => $relatedId, 'b' => $citymapId]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }
    return ['public_id' => $publicId, 'related' => count($relatedIds)];
}

// ---- the link list (multi-link spec §6.1) ------------------------------------------------------------
// Column widths, enforced in PHP rather than left to MySQL: a silently truncated URL is a broken link, and
// a truncated label is a mislabelled one.
const AVESMAPS_CITYMAP_LINK_LABEL_MAX = 200;

// The gate between the editor and citymap_link. Takes the WHOLE list as displayed and returns it as
// storable rows; sort_order is the array position, so the editor's ▲▼ is a plain array move and no id ever
// has to be renumbered. Pure (no PDO) -> unit-tested in __tests__/citymap-links-test.php.
//
// Mirrors avesmapsNormalizeAdventureLinkRows, plus is_paid. An all-blank row is a trailing empty line in a
// row editor, not an error -- skipped. A HALF-filled row is an error rather than a silent drop: dropping
// loses what the editor typed, and storing it would render an anchor with no text (avesmapsCitymapLinks
// only skips on an empty url, never on an empty label).
function avesmapsNormalizeCitymapLinkRows(array $rows): array
{
    $normalized = [];
    foreach ($rows as $row) {
        $label = trim((string) (is_array($row) ? ($row['label'] ?? '') : ''));
        $url = trim((string) (is_array($row) ? ($row['url'] ?? '') : ''));
        // A touched tri-state alone does not make a row: nobody typed a link, they clicked a control and
        // moved on. Only label/url decide whether a row exists.
        if ($label === '' && $url === '') {
            continue;
        }
        if ($label === '') {
            throw new InvalidArgumentException('Ein Link braucht einen Titel: ' . $url);
        }
        if ($url === '') {
            throw new InvalidArgumentException('Ein Link braucht eine URL: ' . $label);
        }
        if (mb_strlen($label) > AVESMAPS_CITYMAP_LINK_LABEL_MAX) {
            throw new InvalidArgumentException('Der Link-Titel ist zu lang (max. ' . AVESMAPS_CITYMAP_LINK_LABEL_MAX . ' Zeichen): ' . $label);
        }
        $normalized[] = [
            'label' => $label,
            // http/https + length, the same gate map_url passes through.
            'url' => avesmapsCitymapNormalizeUrl($url, 'Link „' . $label . '“'),
            'is_paid' => avesmapsCitymapTriBool(is_array($row) ? ($row['is_paid'] ?? null) : null),
            'sort_order' => count($normalized),
        ];
    }
    return $normalized;
}

// Replace a map's whole link list atomically (spec §6.1 `set_links`, mirroring the adventure side). Delete
// + re-insert rather than diffing: these are leaf rows with nothing to protect, and link_status keys on
// url_hash, so an unchanged URL keeps its probe history across the rewrite regardless of its new row id.
//
// Scoped to origin='manual': a wiki-born link is the sync's to own (spec §6.6) and a community link is a
// reader's, so neither is the editor's list to replace. Today the editor is the only writer and every row
// is 'manual', which makes this scoping inert -- it is here so that the wiki sync landing next cannot have
// its rows silently deleted by the first editor who saves an unrelated field.
function avesmapsSetCitymapLinks(PDO $pdo, string $publicId, array $links): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $publicId);

    // Validate the WHOLE list before touching a row: a partial save would leave the editor showing a list
    // that no longer matches what is stored.
    $rows = avesmapsNormalizeCitymapLinkRows($links);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("DELETE FROM citymap_link WHERE citymap_id = :id AND origin = 'manual'")
            ->execute(['id' => $citymapId]);
        $insert = $pdo->prepare(
            "INSERT INTO citymap_link (citymap_id, label, url, is_paid, sort_order, origin, status)
             VALUES (:id, :label, :url, :is_paid, :sort_order, 'manual', 'approved')"
        );
        foreach ($rows as $row) {
            $insert->execute([
                'id' => $citymapId,
                'label' => $row['label'],
                'url' => $row['url'],
                'is_paid' => $row['is_paid'],
                'sort_order' => $row['sort_order'],
            ]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }
    return ['public_id' => $publicId, 'links' => count($rows)];
}

// ---- community fundort report (Spec 2026-07-17-community-fundorte §3.2) -------------------------------
// PURE (no PDO, no HTTP) -> unit-tested in __tests__/citymap-link-report-test.php.
//
// Runs on the PUBLIC endpoint (api/app/report-location.php) with capability NONE, so its output is
// untrusted input that has passed a whitelist -- and anything it does not return can never reach a column.
// An ALLOWLIST by construction: it returns {citymap_public_id, links[], note} and nothing else.
//
// `origin` and `status` are absent ON PURPOSE, and that is the whole point of the function. They are OUR
// bookkeeping: a report that could name its own origin would write itself in as 'manual' and the editor
// would take it for his own work; a status='approved' would publish it without anyone looking. Because the
// keys are never read, the INSERT never names the columns -- the defaults simply stand, and the approval
// stamps 'community' itself.
//
// The ROW rules are avesmapsNormalizeCitymapLinkRows' -- the very gate the editor's set_links passes
// through. A community row can therefore never be shaped differently from an editor's, and the http/https
// check, the length limits and the "half-filled row is an error" rule hold identically on both doors.
function avesmapsNormalizeCitymapLinkReportPayload(mixed $raw): array
{
    $data = is_array($raw) ? $raw : [];

    // Without a map the proposal has no target -- "another place to find THIS map" is the entire idea.
    $citymapPublicId = avesmapsCitymapReportText($data['citymap_public_id'] ?? '', 64, 'Die Karten-ID');
    if ($citymapPublicId === '') {
        throw new InvalidArgumentException('Zu welcher Karte gehoert der Fundort?');
    }

    $links = avesmapsNormalizeCitymapLinkRows(is_array($data['links'] ?? null) ? $data['links'] : []);
    if ($links === []) {
        throw new InvalidArgumentException('Bitte mindestens einen Fundort angeben.');
    }

    return [
        'citymap_public_id' => $citymapPublicId,
        'links' => $links,
        // Free text to a human. Refused when too long rather than truncated (avesmapsCitymapReportText):
        // a note cut mid-sentence changes what the reporter said, and this one is addressed to an editor
        // deciding whether to trust them.
        'note' => avesmapsCitymapReportText($data['note'] ?? '', AVESMAPS_CITYMAP_NOTE_MAX, 'Die Notiz'),
    ];
}

// Append ONE fundort. Deliberately NOT avesmapsSetCitymapLinks: that one replaces the whole list, so a
// community report routed through it would silently delete every fundort an editor had entered. This is the
// one write on this table that must only ever add.
//
// $origin is stamped by the CALLER, never taken from the row: 'community' from the report approval,
// 'wiki' from the sync (Mehrfachlink-Spec §6.6). Its default 'manual' keeps the signature honest for a
// hand-written call, and avesmapsCitymapNormalizeOrigin turns anything unrecognised into 'manual' -- the
// conservative answer, since 'manual' is exactly what the wiki sync refuses to touch.
function avesmapsAddCitymapLink(PDO $pdo, string $citymapPublicId, array $row, string $origin = 'manual'): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $citymapPublicId);

    // Through the same gate as everything else on this table, even though the report path already ran it:
    // this function is callable from anywhere, and a URL is not a thing to take on trust twice.
    $normalized = avesmapsNormalizeCitymapLinkRows([$row]);
    if ($normalized === []) {
        throw new InvalidArgumentException('Der Fundort ist leer.');
    }
    $link = $normalized[0];

    // Append: sort_order continues the list rather than restarting at 0 (the normalizer stamps positions
    // per CALL, which is right for a whole-list replace and wrong here).
    $max = $pdo->prepare('SELECT MAX(sort_order) FROM citymap_link WHERE citymap_id = :id');
    $max->execute(['id' => $citymapId]);
    $next = $max->fetchColumn();
    $sortOrder = ($next === null || $next === false) ? 0 : ((int) $next) + 1;

    $pdo->prepare(
        "INSERT INTO citymap_link (citymap_id, label, url, is_paid, sort_order, origin, status)
         VALUES (:id, :label, :url, :is_paid, :sort_order, :origin, 'approved')"
    )->execute([
        'id' => $citymapId,
        'label' => $link['label'],
        'url' => $link['url'],
        'is_paid' => $link['is_paid'],
        'sort_order' => $sortOrder,
        'origin' => avesmapsCitymapNormalizeOrigin($origin),
    ]);
    return ['link_id' => (int) $pdo->lastInsertId()];
}

// Removing a fundort the editor does not own: TOMBSTONE, never DELETE. A deleted wiki row is one the next
// sync digs straight back up -- the exact bug avesmapsSuppressCitymapPlace got its rule for. The rule is
// phrased the same way here ("whatever we did not author") so the next origin does not have to remember to
// come back and edit this function. A 'manual' row has nothing to protect and is really deleted -- but the
// editor never reaches this path for one of those anyway: it removes those by leaving them out of set_links.
function avesmapsSuppressCitymapLink(PDO $pdo, int $linkId): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT origin FROM citymap_link WHERE id = :id LIMIT 1');
    $find->execute(['id' => $linkId]);
    $origin = $find->fetchColumn();
    if ($origin === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Fundort wurde nicht gefunden.');
    }

    if ((string) $origin !== 'manual') {
        $pdo->prepare("UPDATE citymap_link SET status = 'suppressed' WHERE id = :id")->execute(['id' => $linkId]);
        return ['link_id' => $linkId, 'suppressed' => true];
    }

    $pdo->prepare('DELETE FROM citymap_link WHERE id = :id')->execute(['id' => $linkId]);
    return ['link_id' => $linkId, 'suppressed' => false];
}

function avesmapsCitymapIdByPublicId(PDO $pdo, string $publicId): int
{
    $statement = $pdo->prepare('SELECT id FROM citymap WHERE public_id = :pid LIMIT 1');
    $statement->execute(['pid' => $publicId]);
    $id = $statement->fetchColumn();
    if ($id === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Karte wurde nicht gefunden.');
    }
    return (int) $id;
}

// ---- places (Spec §3.1, 1:1 with adventure_place) ----------------------------------------------------
// Deliberate copies of avesmapsAddAdventurePlace & co rather than a shared generic: the two tables differ
// (no `role` here) and the adventure versions are load-bearing for a shipped feature. What IS shared is
// the part that matters -- the resolver (avesmapsResolvePlacesInTable) and the wiki-key lookup
// (avesmapsAdventureWikiKeyByPublicId), so a place resolves identically on both surfaces.

// $origin mirrors avesmapsUpsertCitymap's: 'community' when the place came from an approved reader
// suggestion (Spec §3.8), 'manual' when an editor added it. Not cosmetic in two ways -- the editor prints
// it per place (html/citymap-editor.html:775 renders "Community" vs "manuell"), so a hardcoded 'manual'
// would credit a reader's suggestion to an editor, right next to a map badged "Community"; and
// avesmapsSuppressCitymapPlace tombstones every non-'manual' place instead of deleting it, a rule
// commit 579d21c2 widened from 'community' to "not manual" for exactly this origin.
function avesmapsAddCitymapPlace(PDO $pdo, string $citymapPublicId, array $data, string $origin = 'manual'): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $citymapPublicId);

    $rawName = trim((string) ($data['raw_name'] ?? ''));
    if ($rawName === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Ein Ortsname (raw_name) ist erforderlich.');
    }

    $targetKind = trim((string) ($data['target_kind'] ?? 'unresolved'));
    if ($targetKind === '') {
        $targetKind = 'unresolved';
    }
    $targetPublicId = trim((string) ($data['target_public_id'] ?? ''));
    $targetWikiKey = trim((string) ($data['target_wiki_key'] ?? ''));

    if (array_key_exists('sort_order', $data) && $data['sort_order'] !== null && $data['sort_order'] !== '') {
        $sortOrder = (int) $data['sort_order'];
    } else {
        $maxStatement = $pdo->prepare('SELECT MAX(sort_order) FROM citymap_place WHERE citymap_id = :id');
        $maxStatement->execute(['id' => $citymapId]);
        $max = $maxStatement->fetchColumn();
        $sortOrder = ($max === null || $max === false) ? 0 : ((int) $max) + 1;
    }

    $pdo->prepare(
        "INSERT INTO citymap_place
            (citymap_id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, origin, status)
         VALUES (:id, :sort_order, :raw_name, :target_kind, :target_public_id, :target_wiki_key, :origin, 'approved')"
    )->execute([
        'id' => $citymapId,
        'sort_order' => $sortOrder,
        'raw_name' => $rawName,
        'target_kind' => $targetKind,
        'target_public_id' => $targetPublicId === '' ? null : $targetPublicId,
        'target_wiki_key' => $targetWikiKey === '' ? null : $targetWikiKey,
        'origin' => avesmapsCitymapNormalizeOrigin($origin),
    ]);
    $placeId = (int) $pdo->lastInsertId();

    // P3 pick-by-public_id: the editor picked an EXACT entity but sent no wiki_key -> derive it from the
    // id. No wiki link (e.g. "Thalhaus") -> leave NULL; the editor shows "ohne Wiki-Eintrag", a valid
    // state, not an error.
    if ($targetPublicId !== '' && $targetWikiKey === ''
        && in_array($targetKind, ['settlement', 'territory', 'region', 'path'], true)) {
        $derivedKey = avesmapsAdventureWikiKeyByPublicId($pdo, $targetKind, $targetPublicId);
        if ($derivedKey !== '') {
            $pdo->prepare('UPDATE citymap_place SET target_wiki_key = :wk WHERE id = :id')
                ->execute(['wk' => $derivedKey, 'id' => $placeId]);
        }
    }

    // Resolve in the same call rather than leaving it to the editor. The pass only touches rows that are
    // 'unresolved' OR still missing a territory_path, so an EXACT pick keeps its target and merely gets
    // its path filled -- while a free-text name gets resolved. Both matter:
    //   - without the path, getCityMapsForTerritory() would never find this map. byTerritoryPath is the
    //     only subtree axis, and a fresh row has target_territory_path = NULL.
    //   - a caller that forgets the follow-up call would silently produce a place that resolves to nothing.
    // Bounded work (one candidate load, no HTTP) and adding a place is not a hot path.
    avesmapsResolvePlacesInTable($pdo, 'citymap_place');
    return ['place_id' => $placeId];
}

function avesmapsSetCitymapPlace(PDO $pdo, int $placeId, array $data): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT id FROM citymap_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    // origin is always stamped 'manual' so a re-resolve leaves the now manually chosen target alone.
    $setClauses = ["origin = 'manual'"];
    $params = ['id' => $placeId];

    if (array_key_exists('raw_name', $data)) {
        $rawName = trim((string) $data['raw_name']);
        if ($rawName === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'raw_name darf nicht leer sein.');
        }
        $setClauses[] = 'raw_name = :raw_name';
        $params['raw_name'] = $rawName;
    }
    if (array_key_exists('target_kind', $data)) {
        $kind = trim((string) $data['target_kind']);
        $setClauses[] = 'target_kind = :target_kind';
        $params['target_kind'] = $kind === '' ? 'unresolved' : $kind;
    }
    if (array_key_exists('target_public_id', $data)) {
        $value = trim((string) $data['target_public_id']);
        $setClauses[] = 'target_public_id = :target_public_id';
        $params['target_public_id'] = $value === '' ? null : $value;
    }
    if (array_key_exists('target_wiki_key', $data)) {
        $value = trim((string) $data['target_wiki_key']);
        $setClauses[] = 'target_wiki_key = :target_wiki_key';
        $params['target_wiki_key'] = $value === '' ? null : $value;
    }
    if (array_key_exists('sort_order', $data)) {
        $setClauses[] = 'sort_order = :sort_order';
        $params['sort_order'] = (int) $data['sort_order'];
    }

    $pdo->prepare('UPDATE citymap_place SET ' . implode(', ', $setClauses) . ' WHERE id = :id')->execute($params);
    return ['place_id' => $placeId];
}

// Removing a place: anything NOT authored in this editor is TOMBSTONED (status='suppressed') so a later
// import cannot resurrect it; only a 'manual' place -- one an editor typed here -- has nothing to protect
// and is really deleted.
//
// The rule is deliberately "not manual" rather than a list of external origins. The first version named
// 'community' explicitly, reasoning that maps have no wiki origin (Spec §6: "kein Wiki-Sync für Karten").
// That was true when written and is now on its way out: §6 always said "später möglich, das origin-Feld
// ist da", and the owner has since asked for exactly that. A wiki-origin place under the old rule would
// have been hard-deleted and resurrected by the very next sync -- the bug the tombstone exists to
// prevent. Phrasing it as "whatever we did not author here" means the next origin does not need to
// remember to come back and edit this function.
function avesmapsSuppressCitymapPlace(PDO $pdo, int $placeId): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT origin FROM citymap_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    $origin = $find->fetchColumn();
    if ($origin === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    if ((string) $origin !== 'manual') {
        $pdo->prepare("UPDATE citymap_place SET status = 'suppressed' WHERE id = :id")->execute(['id' => $placeId]);
        return ['place_id' => $placeId, 'suppressed' => true];
    }

    $pdo->prepare('DELETE FROM citymap_place WHERE id = :id')->execute(['id' => $placeId]);
    return ['place_id' => $placeId, 'suppressed' => false];
}

// Reset to 'unresolved', then run the shared resolver (which only touches unresolved rows) and report
// what it found.
function avesmapsResolveCitymapPlace(PDO $pdo, int $placeId): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT id FROM citymap_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    $pdo->prepare(
        "UPDATE citymap_place
            SET target_kind = 'unresolved', target_public_id = NULL, target_wiki_key = NULL, target_territory_path = NULL
          WHERE id = :id"
    )->execute(['id' => $placeId]);

    avesmapsResolvePlacesInTable($pdo, 'citymap_place');

    $select = $pdo->prepare(
        'SELECT target_kind, target_public_id, target_wiki_key FROM citymap_place WHERE id = :id LIMIT 1'
    );
    $select->execute(['id' => $placeId]);
    $row = $select->fetch(PDO::FETCH_ASSOC) ?: [];
    return [
        'target_kind' => (string) ($row['target_kind'] ?? 'unresolved'),
        'target_public_id' => ($row['target_public_id'] ?? null) !== null ? (string) $row['target_public_id'] : '',
        'target_wiki_key' => ($row['target_wiki_key'] ?? null) !== null ? (string) $row['target_wiki_key'] : '',
    ];
}

// Set a map's stored image for one slot. Called ONLY by api/edit/map/citymap-image.php after it has
// validated + re-encoded the bytes; $url names a file we host. width/height come from GD (Spec §3.4) and
// are only written for the 'map' slot -- the thumb's dimensions are our own downscale, not the map's.
function avesmapsSetCitymapImage(PDO $pdo, string $publicId, string $slot, ?string $url, ?int $width = null, ?int $height = null): array
{
    avesmapsCitymapsEnsureTables($pdo);
    // 'thumb_auto' is the Autoget slot -> thumb_auto_url, which the public read never selects.
    $columns = ['thumb' => 'thumb_local_url', 'map' => 'map_local_url', 'thumb_auto' => 'thumb_auto_url'];
    if (!isset($columns[$slot])) {
        throw new InvalidArgumentException('Unbekannter Slot: ' . $slot);
    }
    avesmapsCitymapIdByPublicId($pdo, $publicId); // 404 if unknown

    $column = $columns[$slot];
    $setClauses = [$column . ' = :url'];
    $params = ['url' => ($url === null || $url === '') ? null : $url, 'pid' => $publicId];
    if ($slot === 'map' && $width !== null && $height !== null && $width > 0 && $height > 0) {
        $setClauses[] = 'width_px = :w';
        $setClauses[] = 'height_px = :h';
        $params['w'] = $width;
        $params['h'] = $height;
    }
    $pdo->prepare('UPDATE citymap SET ' . implode(', ', $setClauses) . ' WHERE public_id = :pid')->execute($params);
    return ['public_id' => $publicId, 'slot' => $slot, 'url' => $url ?? ''];
}
