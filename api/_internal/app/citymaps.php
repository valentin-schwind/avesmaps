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

// Multiple selection per map (Spec §3.1). Stable keys -- German because they are domain content
// (AGENTS.md §8: never translate option slugs); the visible labels live in the editor + i18n table.
const AVESMAPS_CITYMAP_TYPE_KEYS = [
    'ortsplan', 'stadtplan', 'bezirk', 'viertel', 'lageplan', 'uebersicht', 'schauplatz', 'grundriss',
    'befestigungen', 'dungeon', 'hoehlen', 'krypten', 'katakomben', 'schatzkarte', 'region', 'sonstige',
];
// Single choice (Spec §3.1). NULL = unknown, which is why '' is not a member here.
const AVESMAPS_CITYMAP_ARTS = ['politisch', 'derographisch', 'topologisch', 'skizze'];

const AVESMAPS_CITYMAP_TITLE_MAX = 300;
const AVESMAPS_CITYMAP_URL_MAX = 500;
const AVESMAPS_CITYMAP_NOTE_MAX = 2000;
const AVESMAPS_CITYMAP_AUTHOR_MAX = 300;

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
            width_px INT NULL,
            height_px INT NULL,
            valid_from_bf INT NULL,
            valid_to_bf INT NULL,
            author VARCHAR(300) NULL,
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

// The reader-facing links of ONE citymap, in priority order. Today that is exactly one -- the external
// map link (§3.1: "immer gespeichert, immer angezeigt"). It is a LIST rather than a scalar because this
// is the same shape avesmapsAdventureLinks() returns: the linkcheck provider, the state decoration in
// api/app/citymaps.php and the reader row all consume it identically, so a second link (a mirror, a
// publisher page) would slot in without touching any of the three.
//
// NOT included: a map's catalogue sources (feature_sources, §3.2). Those live in the shared `sources`
// table and are checked per SOURCE, not per citing element -- that is what the registry's source_* scopes
// are for. Keying them by citymap public_id here would produce one ref per citing map for a single URL,
// which is exactly what the source providers exist to avoid.
function avesmapsCitymapLinks(array $row): array
{
    $links = [];
    $mapUrl = trim((string) ($row['map_url'] ?? ''));
    if ($mapUrl !== '') {
        // Skips an empty URL: sha256('') would hash and then be probed forever.
        $links[] = ['key' => 'map', 'label' => 'Karte', 'url' => $mapUrl, 'url_hash' => hash('sha256', $mapUrl)];
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
                is_official, is_spoiler, width_px, height_px, valid_from_bf, valid_to_bf, author, note
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
            'width_px' => $row['width_px'] !== null ? (int) $row['width_px'] : null,
            'height_px' => $row['height_px'] !== null ? (int) $row['height_px'] : null,
            'valid_from_bf' => $row['valid_from_bf'] !== null ? (int) $row['valid_from_bf'] : null,
            'valid_to_bf' => $row['valid_to_bf'] !== null ? (int) $row['valid_to_bf'] : null,
            'author' => (string) ($row['author'] ?? ''),
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
            'links' => avesmapsCitymapLinks($row),
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
            'width_px' => $row['width_px'] !== null ? (int) $row['width_px'] : null,
            'height_px' => $row['height_px'] !== null ? (int) $row['height_px'] : null,
            'valid_from_bf' => $row['valid_from_bf'] !== null ? (int) $row['valid_from_bf'] : null,
            'valid_to_bf' => $row['valid_to_bf'] !== null ? (int) $row['valid_to_bf'] : null,
            'author' => (string) ($row['author'] ?? ''),
            'note' => (string) ($row['note'] ?? ''),
            'status' => (string) $row['status'],
            'origin' => (string) $row['origin'],
        ],
        'types' => avesmapsCitymapTypesByCitymap($pdo, [$id])[$id] ?? [],
        'related' => $related,
        'places' => $places,
    ];
}

// Create or update. An empty public_id means CREATE; otherwise only the SENT fields are written
// (array_key_exists, so an explicit null counts as "sent" and clears to unknown). map_local_url /
// thumb_local_url are NOT editable here on purpose -- only the upload endpoint may set them, because they
// name a file we host.
function avesmapsUpsertCitymap(PDO $pdo, array $data, int $userId = 0): array
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
        'art', 'is_color', 'is_multilevel', 'is_labeled', 'is_official', 'is_spoiler',
        'width_px', 'height_px', 'valid_from_bf', 'valid_to_bf', 'author', 'note', 'status',
    ];

    $normalize = static function (string $field, mixed $raw): int|string|null {
        if (in_array($field, ['is_color', 'is_multilevel', 'is_labeled', 'is_official', 'is_spoiler'], true)) {
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
        $params = ['public_id' => $publicId, 'origin' => 'manual', 'created_by' => $userId > 0 ? $userId : null];
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

function avesmapsAddCitymapPlace(PDO $pdo, string $citymapPublicId, array $data): array
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
         VALUES (:id, :sort_order, :raw_name, :target_kind, :target_public_id, :target_wiki_key, 'manual', 'approved')"
    )->execute([
        'id' => $citymapId,
        'sort_order' => $sortOrder,
        'raw_name' => $rawName,
        'target_kind' => $targetKind,
        'target_public_id' => $targetPublicId === '' ? null : $targetPublicId,
        'target_wiki_key' => $targetWikiKey === '' ? null : $targetWikiKey,
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

// A community place is tombstoned (status='suppressed') so a later re-import cannot resurrect it; a
// manual one has nothing to protect and is deleted. Mirrors the adventure rule, with 'community' in the
// role 'wiki' plays there -- maps have no wiki origin (Spec §6).
function avesmapsSuppressCitymapPlace(PDO $pdo, int $placeId): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT origin FROM citymap_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    $origin = $find->fetchColumn();
    if ($origin === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    if ((string) $origin === 'community') {
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
