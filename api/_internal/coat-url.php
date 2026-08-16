<?php

declare(strict_types=1);

// Fuer avesmapsMediaLicenseIsPublic() -- der EINE Lizenzkatalog (Phase 1), nicht eine eigene Liste.
require_once __DIR__ . '/media-license.php';

/**
 * Cache-busting for locally stored coats of arms (/uploads/wappen/<slug>-custom.<ext>).
 *
 * A re-uploaded coat keeps its filename (the upload in sync-monitor-identity.php derives it from the
 * wiki_key slug), and /uploads is served with Cache-Control: max-age=2592000. Without a version marker a
 * browser that already fetched the old image keeps showing it for up to 30 days -- the coat looks like it
 * "was not taken over". Appending ?v=<mtime> breaks the browser cache EXACTLY on change and keeps the
 * 30-day cache otherwise (perf). Remote coats (wiki URLs, api/app/coat.php) are left untouched.
 *
 * This lives here rather than in one endpoint because several separate readers surface the same coat
 * URL -- the political layer, the territory detail (infobox), the settlement breadcrumb thumbnail and
 * (since Fix-Runde 6, 15.08.2026) the what-is-here "Liegt in" chain. When only one of them versioned the
 * URL, the others served stale bytes (Discord #32, Grafschaft Ferdok).
 */
function avesmapsCoatUrlCacheBust(string $url): string {
    static $resolved = [];

    $url = trim($url);
    // Remote URLs and anything that already carries a query string are none of our business.
    if ($url === '' || strpos($url, '?') !== false || strncmp($url, '/uploads/', 9) !== 0) {
        return $url;
    }
    if (array_key_exists($url, $resolved)) {
        return $resolved[$url];
    }

    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($root === '') {
        return $url;
    }
    $mtime = @filemtime($root . $url);

    return $resolved[$url] = ($mtime !== false ? ($url . '?v=' . $mtime) : $url);
}

/**
 * 🔴 Bis 16.08.2026 stand hier AVESMAPS_COAT_PUBLIC_LICENSES = ['public_domain'] -- die einzige
 * Lizenz, unter der ein Wappen oeffentlich erscheinen durfte. Seit Phase 3 entscheidet der gemeinsame
 * Katalog (avesmapsMediaLicenseIsPublic), und damit kommen vier weitere Werte durch: cc0,
 * permission_granted, ai_generated, own_work.
 *
 * 💣 Die FUNKTION, nicht eine andere Konstante. Der Vergleich hier lief roh, ohne Normalisierung --
 * eine erweiterte Liste haette den Riegel neben dem Fundament noch einmal aufgebaut und die Regel
 * "erst normalisieren, dann pruefen" umgangen, fuer die Phase 1 ueberhaupt gebaut wurde.
 */

/**
 * The ONE canonical precedence for a publicly displayed coat of arms. Every reader routes through this so
 * the territory label, the territory infobox and the settlement "Liegt in" breadcrumb can never diverge
 * again -- Discord #32 (Grafschaft Ferdok) happened precisely because each reader re-implemented the
 * precedence and the map layer put the uploaded override LAST instead of first.
 *
 *   url     = override['coat_of_arms_url']  when the override sets that key (DECISIVE, even when '')
 *             else own (political_territory.coat_of_arms_url)  else staging (the crawled wiki coat)
 *   licence = override['coat_of_arms_license_status']  when the override sets it  else the staging licence
 *
 * An override that sets an EMPTY url is a deliberate "no coat" (e.g. an occupation correction) and is
 * honoured -- there is no fall-through to the wiki coat. Only public_domain is ever emitted; anything else
 * yields '' (a non-public-domain coat on the public map is a NOTICE.md / legal violation). The returned
 * URL is cache-busted (?v=<mtime>) exactly like every other local upload.
 */
function avesmapsResolveGatedCoatUrl(array $override, string $ownUrl, string $stagingUrl, string $stagingLicense): string {
    $license = array_key_exists('coat_of_arms_license_status', $override)
        ? trim((string) $override['coat_of_arms_license_status'])
        : trim($stagingLicense);
    $ownUrl = trim($ownUrl);
    $url = array_key_exists('coat_of_arms_url', $override)
        ? trim((string) $override['coat_of_arms_url'])
        : ($ownUrl !== '' ? $ownUrl : trim($stagingUrl));
    if ($url === '' || !avesmapsMediaLicenseIsPublic($license)) {
        return '';
    }

    return avesmapsCoatUrlCacheBust($url);
}

// Coat-of-arms staging + model tables the gate above consults. These MIRROR the constants of
// api/app/territory-detail.php EXACTLY (kept as a separate, identically-valued pair there -- a known,
// accepted duplication predating this file; not touched here).
//
// 🔴 Fix-Runde 6 (15.08.2026): moved here from api/app/map-features.php, together with
// avesmapsLoadSettlementCoatGateInputs() and avesmapsSettlementTerritoryCoatUrl() below, so a FOURTH
// reader -- api/_internal/app/what-is-here.php's "Liegt in" chain -- can share the exact same
// implementation instead of building a second one. Before the move these two functions had exactly one
// caller (map-features.php); moving function definitions out of an ENDPOINT file and into this shared
// library is safe specifically because they had no top-level side effects of their own. Names kept
// unchanged (only the file moved) to avoid touching the one existing call site's call syntax.
const AVESMAPS_COAT_GATE_STAGING_TABLE = 'political_territory_wiki_test'; // = AVESMAPS_TERRITORY_DETAIL_STAGING_TABLE
const AVESMAPS_COAT_GATE_MODEL_TABLE = 'wiki_territory_model';            // = AVESMAPS_TERRITORY_DETAIL_MODEL_TABLE

/**
 * Bulk-loads the two coat inputs the public-domain gate consults, keyed by wiki_key: the wiki STAGING row
 * (coat URL + license status) and the MODEL overrides (metadata_overrides_json). These are the SAME two
 * sources api/app/territory-detail.php reads (same table constants, mirrored above). Loaded ONCE per
 * request by the caller -- two small full-table scans, no N+1. Each side has its OWN try/catch so a
 * missing sandbox table simply yields no thumbnails; it never breaks a political line that does not
 * depend on these tables.
 *
 * ⚠️ Callers with a MULTI-STAGE chain (the settlement breadcrumb's parent_id walk, the what-is-here
 * territory chain) MUST call this ONCE for the whole chain, not once per stage -- see the caller-side
 * comments for the concrete cost this avoids (AGENTS §10: no N+1 on a visitor path).
 */
function avesmapsLoadSettlementCoatGateInputs(PDO $pdo): array {
    $staging = [];
    try {
        $statement = $pdo->query(
            'SELECT wiki_key, coat_of_arms_url, coat_of_arms_license_status FROM '
            . AVESMAPS_COAT_GATE_STAGING_TABLE
        );
        foreach (($statement ? $statement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
            $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
            if ($wikiKey === '') {
                continue;
            }
            $staging[$wikiKey] = [
                'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
                'coat_of_arms_license_status' => (string) ($row['coat_of_arms_license_status'] ?? ''),
            ];
        }
    } catch (Throwable) {
        $staging = [];
    }

    $overrides = [];
    try {
        $statement = $pdo->query(
            'SELECT wiki_key, metadata_overrides_json FROM ' . AVESMAPS_COAT_GATE_MODEL_TABLE
            . ' WHERE metadata_overrides_json IS NOT NULL'
        );
        foreach (($statement ? $statement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
            $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
            $json = (string) ($row['metadata_overrides_json'] ?? '');
            if ($wikiKey === '' || $json === '') {
                continue;
            }
            $decoded = json_decode($json, true);
            if (!is_array($decoded)) {
                continue;
            }
            // Keep only the two coat keys the gate consults, and only when actually present -- so the
            // array_key_exists override check below mirrors territory-detail's "override ?? staging" exactly.
            $coatOverride = [];
            if (array_key_exists('coat_of_arms_url', $decoded)) {
                $coatOverride['coat_of_arms_url'] = (string) $decoded['coat_of_arms_url'];
            }
            if (array_key_exists('coat_of_arms_license_status', $decoded)) {
                $coatOverride['coat_of_arms_license_status'] = (string) $decoded['coat_of_arms_license_status'];
            }
            if ($coatOverride !== []) {
                $overrides[$wikiKey] = $coatOverride;
            }
        }
    } catch (Throwable) {
        $overrides = [];
    }

    return ['staging' => $staging, 'overrides' => $overrides];
}

/**
 * Wie avesmapsLoadSettlementCoatGateInputs() oben, aber GESCHLUESSELT statt Vollscan -- nur die
 * Zeilen der uebergebenen wiki_keys, ueber `WHERE wiki_key IN (...)`. Beide Tabellen tragen
 * `UNIQUE KEY (wiki_key)` (sql/political-territories.sql), ein geschluesselter Zugriff ist also
 * ein Index-Treffer, kein Scan.
 *
 * 🔴 Fix-Runde 7 (Schlussprüfung), I2: der Vollscan oben ist fuer seinen urspruenglichen Aufrufer
 * richtig dimensioniert -- die Siedlungs-Treppe (api/app/map-features.php) laedt Tausende Territorien
 * auf EINEN Schlag, einmal je 2,9-MB-Kartenpayload. Ein Rechtsklick auf die Karte (die
 * what-is-here-Kette, hoechstens ~16 Stufen: 4 gemessen + AVESMAPS_WHAT_IS_HERE_MAX_ANCESTOR_DEPTH)
 * ist ein einzelner, potenziell haeufiger Aufruf -- zwei Vollscans dafuer sind ueberdimensioniert.
 * Die Schluessel liegen zum Aufrufzeitpunkt bereits vor (jede Stufe der Kette traegt ihr wiki_key).
 *
 * ⚠️ KEIN ZWEITER RIEGEL: die Lizenz-Rangfolge selbst (avesmapsResolveGatedCoatUrl) und ihr Aufrufer
 * (avesmapsSettlementTerritoryCoatUrl) bleiben unveraendert und werden von BEIDEN Ladern gleichermassen
 * gefuettert -- nur WIE die Zutaten geholt werden, unterscheidet sich, nicht WAS mit ihnen geschieht.
 *
 * @param list<string> $wikiKeys
 * @return array{staging: array<string,array<string,string>>, overrides: array<string,array<string,string>>}
 */
function avesmapsLoadSettlementCoatGateInputsByKeys(PDO $pdo, array $wikiKeys): array {
    $keys = array_values(array_unique(array_filter(
        array_map(static fn($k): string => trim((string) $k), $wikiKeys),
        static fn(string $k): bool => $k !== ''
    )));
    if ($keys === []) {
        return ['staging' => [], 'overrides' => []];
    }

    $placeholders = implode(',', array_map(static fn(int $i): string => ":k{$i}", array_keys($keys)));
    $params = [];
    foreach ($keys as $i => $key) {
        $params["k{$i}"] = $key;
    }

    $staging = [];
    try {
        $statement = $pdo->prepare(
            'SELECT wiki_key, coat_of_arms_url, coat_of_arms_license_status FROM '
            . AVESMAPS_COAT_GATE_STAGING_TABLE . " WHERE wiki_key IN ({$placeholders})"
        );
        $statement->execute($params);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
            if ($wikiKey === '') {
                continue;
            }
            $staging[$wikiKey] = [
                'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
                'coat_of_arms_license_status' => (string) ($row['coat_of_arms_license_status'] ?? ''),
            ];
        }
    } catch (Throwable) {
        $staging = [];
    }

    $overrides = [];
    try {
        $statement = $pdo->prepare(
            'SELECT wiki_key, metadata_overrides_json FROM ' . AVESMAPS_COAT_GATE_MODEL_TABLE
            . " WHERE metadata_overrides_json IS NOT NULL AND wiki_key IN ({$placeholders})"
        );
        $statement->execute($params);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
            $json = (string) ($row['metadata_overrides_json'] ?? '');
            if ($wikiKey === '' || $json === '') {
                continue;
            }
            $decoded = json_decode($json, true);
            if (!is_array($decoded)) {
                continue;
            }
            $coatOverride = [];
            if (array_key_exists('coat_of_arms_url', $decoded)) {
                $coatOverride['coat_of_arms_url'] = (string) $decoded['coat_of_arms_url'];
            }
            if (array_key_exists('coat_of_arms_license_status', $decoded)) {
                $coatOverride['coat_of_arms_license_status'] = (string) $decoded['coat_of_arms_license_status'];
            }
            if ($coatOverride !== []) {
                $overrides[$wikiKey] = $coatOverride;
            }
        }
    } catch (Throwable) {
        $overrides = [];
    }

    return ['staging' => $staging, 'overrides' => $overrides];
}

// Effective, public-domain-GATED coat URL for one territory, mirroring api/app/territory-detail.php EXACTLY:
//   license = override.coat_of_arms_license_status ?? staging.coat_of_arms_license_status
//   url     = override.coat_of_arms_url ?? political_territory.coat_of_arms_url ?? staging.coat_of_arms_url
//   allowed = url !== '' AND license IN (public_domain)
// Returns the URL only when allowed, else '' -- a non-public-domain coat is never emitted (see NOTICE.md).
// Thin unwrap around avesmapsResolveGatedCoatUrl() above -- kept as its own function (not inlined at each
// call site) so callers pass the raw $stagingRow shape avesmapsLoadSettlementCoatGateInputs() returns,
// instead of each re-deriving the same two array reads.
function avesmapsSettlementTerritoryCoatUrl(string $ptCoatUrl, array $stagingRow, array $overrides): string {
    return avesmapsResolveGatedCoatUrl(
        $overrides,
        $ptCoatUrl,
        (string) ($stagingRow['coat_of_arms_url'] ?? ''),
        (string) ($stagingRow['coat_of_arms_license_status'] ?? '')
    );
}
