<?php

declare(strict_types=1);

/**
 * WikiDump migration -- server-side dump PROCUREMENT (fetch + credential store).
 * ---------------------------------------------------------------------------
 * Downloads the offline MediaWiki XML export of Wiki Aventurica
 * (`dewa_dump_small.xml.bz2`, ~39 MB .bz2) to a protected server-side directory,
 * so the later `read_step` parser (a SEPARATE task) can open it via
 * `compress.bzip2://` -- see api/_internal/wiki/dump-reader.php. This file is the
 * PROCUREMENT half only: it fetches and caches the .bz2 and stores the last
 * working Basic-Auth credentials. It does NOT decompress, parse, or write any
 * staging / sandbox / map table -- the ONLY things it writes are the credential
 * settings row and the dump FILE on disk.
 *
 * Owner spec (docs/refactoring-wikidump-migration.md sec 5.0):
 *   - Credentials live in a DB setting (default seed Gareth/Phex), runtime
 *     editable, admin/edit-gated; the LAST-WORKING pair is stored.
 *   - On HTTP 401 the fetch returns a clear signal ({code:'dump_unauthorized'})
 *     so the frontend can prompt for fresh credentials (self-healing).
 *   - Cache: if the local .bz2 is < 24 h old, skip the download; force_refresh
 *     forces a fresh download.
 *
 * SECURITY (the review focus for this task):
 *   - The password is stored in the DB and used only as CURLOPT_USERPWD. It is
 *     NEVER returned in any response array and NEVER written to a log or an error
 *     message. Responses may echo the USERNAME (for the "last used" prefill) but
 *     never the password.
 *   - curl runs with SSL verification ON (VERIFYPEER + VERIFYHOST=2), streams the
 *     body straight to a file handle via CURLOPT_FILE (never RETURNTRANSFER, so
 *     the 39 MB body never buffers in RAM), restricts the protocol to HTTPS, and
 *     bounds redirects.
 *   - The storage filename is a FIXED constant (no user input) -> no path
 *     traversal. The storage directory gets a runtime-written .htaccess denying
 *     all HTTP access (the deploy allowlist does not carry uploads/, so the
 *     protection is self-healed here at fetch time).
 *
 * PURITY CONTRACT: side-effect-free on include (only `const` + `function`
 * definitions -- no top-level executable code, no DB connect, no curl, no
 * headers). A test can `require` this file with no MySQL, no curl and no STRATO.
 * Every DB touch lives in a function that takes a PDO; the network touch lives in
 * avesmapsWikiDumpFetch(). The genuinely offline-testable pure helpers
 * (cache-age decision, bz2 magic-byte sniff, response sanitisation) are exposed
 * separately so tools/wikidump/ can exercise them without mocking curl or MySQL.
 */

// ===========================================================================
// Constants.
// ===========================================================================

/**
 * The verified, Basic-Auth-protected dump URL. Only the German ("dewa_") small
 * dump is relevant. Fixed constant -- never composed from user input.
 */
const AVESMAPS_WIKI_DUMP_URL = 'https://offline.wiki-aventurica.de/dump/dewa_dump_small.xml.bz2';

/**
 * Fixed on-disk filename for the cached dump. A constant, never user-derived, so
 * there is no path-traversal surface. The `.bz2` extension is what
 * dump-reader.php keys on to pick the `compress.bzip2://` wrapper.
 */
const AVESMAPS_WIKI_DUMP_FILENAME = 'dewa_dump_small.xml.bz2';

/**
 * Storage directory RELATIVE to the webroot (the parent of the api/ root). It is
 * placed under uploads/ (the repo's runtime-writable area) but is DENIED to HTTP
 * clients via a runtime-written .htaccess -- unlike uploads/wappen/ which is
 * meant to be served. Resolve the absolute path via avesmapsWikiDumpStorageDir().
 */
const AVESMAPS_WIKI_DUMP_STORAGE_SUBDIR = 'uploads/dumps';

/**
 * Cache TTL: a local dump younger than this (seconds) is reused instead of
 * re-downloaded. 24 h -- the dump is regenerated daily upstream.
 */
const AVESMAPS_WIKI_DUMP_CACHE_TTL_SECONDS = 86400;

/**
 * A freshly downloaded dump must be at least this many bytes to count as a
 * plausible success (the real file is ~39 MB; anything tiny is an error page or a
 * truncated transfer). Deliberately conservative -- just a sanity floor.
 */
const AVESMAPS_WIKI_DUMP_MIN_PLAUSIBLE_BYTES = 1048576; // 1 MiB

/**
 * curl timeouts. The connect phase is short; the transfer ceiling is generous
 * because ~39 MB over the WA link can take a while. set_time_limit() is lifted to
 * match before the transfer.
 */
const AVESMAPS_WIKI_DUMP_CONNECT_TIMEOUT_SECONDS = 20;
const AVESMAPS_WIKI_DUMP_TRANSFER_TIMEOUT_SECONDS = 1800; // 30 min hard ceiling

/** Self-healing settings table (single-row key/value store for the creds+meta). */
const AVESMAPS_WIKI_DUMP_SETTINGS_TABLE = 'wiki_dump_settings';

/** The single settings row is addressed by this fixed id (single-row store). */
const AVESMAPS_WIKI_DUMP_SETTINGS_ROW_ID = 1;

/** Default seed credentials (publicly documented by the wiki; not truly secret). */
const AVESMAPS_WIKI_DUMP_DEFAULT_USERNAME = 'Gareth';
const AVESMAPS_WIKI_DUMP_DEFAULT_PASSWORD = 'Phex';

// ===========================================================================
// Storage-path helpers (pure string logic; no I/O).
// ===========================================================================

/**
 * Resolve the webroot (the directory that contains api/). Prefers the server's
 * DOCUMENT_ROOT (as coat.php / settlement-coat-upload.php do) and falls back to
 * two levels up from this file (api/_internal/wiki -> api/_internal -> api ->
 * webroot is dirname(__DIR__, 3)). Kept as its own function so the test can reason
 * about the path without a live server.
 */
function avesmapsWikiDumpWebroot(): string
{
    $documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
    if ($documentRoot !== '' && is_dir($documentRoot)) {
        return $documentRoot;
    }

    // Fallback for CLI / when DOCUMENT_ROOT is unset: this file lives at
    // <webroot>/api/_internal/wiki/dump-fetch.php -> webroot is 3 levels up.
    return dirname(__DIR__, 3);
}

/** Absolute path of the dump storage directory (webroot/uploads/dumps). */
function avesmapsWikiDumpStorageDir(): string
{
    return avesmapsWikiDumpWebroot() . '/' . AVESMAPS_WIKI_DUMP_STORAGE_SUBDIR;
}

/**
 * Absolute path of the cached dump file. The filename is a fixed constant, so
 * this can never point outside the storage directory. This is the exact path the
 * read_step (dump-reader.php) will open.
 */
function avesmapsWikiDumpStoragePath(): string
{
    return avesmapsWikiDumpStorageDir() . '/' . AVESMAPS_WIKI_DUMP_FILENAME;
}

// ===========================================================================
// Pure, offline-testable decision helpers.
// ===========================================================================

/**
 * Cache-age decision: given the current time, the file's mtime (or null if the
 * file is absent) and the force flag, decide whether a cached copy may be reused.
 * Pure arithmetic -- the core of the 24 h cache rule, exercised by the offline
 * test with synthetic mtimes.
 *
 * @param int|null $mtime file mtime as a unix timestamp, or null if no file.
 */
function avesmapsWikiDumpCacheIsFresh(?int $mtime, int $now, bool $forceRefresh, int $ttlSeconds = AVESMAPS_WIKI_DUMP_CACHE_TTL_SECONDS): bool
{
    if ($forceRefresh || $mtime === null) {
        return false;
    }

    $age = $now - $mtime;
    // A negative age (clock skew / future mtime) is treated as fresh (age 0).
    if ($age < 0) {
        $age = 0;
    }

    return $age < $ttlSeconds;
}

/**
 * Sniff the bzip2 magic bytes ("BZh"). A real .bz2 begins with 0x42 0x5A 0x68.
 * Pure byte logic -- lets the fetch reject an HTML error page or a truncated
 * transfer that slipped through with a 200, and lets the offline test verify the
 * check without any download.
 */
function avesmapsWikiDumpLooksLikeBzip2(string $leadingBytes): bool
{
    return strncmp($leadingBytes, 'BZh', 3) === 0;
}

/**
 * Build the PUBLIC status/result shape for a stored dump, guaranteeing the
 * password can never be present (it is simply never added). Pure: takes only the
 * already-safe fields. `username` is included for the "last used" prefill.
 *
 * @param array{present:bool,size:int,age_seconds:?int,mtime:?int} $file
 */
function avesmapsWikiDumpBuildStatusShape(array $file, string $username, ?string $lastFetchAt, ?string $lastOkAt): array
{
    return [
        'present' => (bool) ($file['present'] ?? false),
        'size' => (int) ($file['size'] ?? 0),
        'age_seconds' => $file['age_seconds'] ?? null,
        'last_fetch_at' => $lastFetchAt,
        'last_ok_at' => $lastOkAt,
        'username' => $username,
        'url' => AVESMAPS_WIKI_DUMP_URL,
        'ttl_seconds' => AVESMAPS_WIKI_DUMP_CACHE_TTL_SECONDS,
    ];
}

// ===========================================================================
// Settings table (self-healing) + credential accessors.
// ===========================================================================

/**
 * Create the single-row credential/metadata store if it does not exist
 * (self-healing DDL, the repo's pattern). One row (id = 1) holds the last-working
 * username/password and the last fetch/ok timestamps.
 */
function avesmapsWikiDumpEnsureSettings(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_DUMP_SETTINGS_TABLE . ' (
            id TINYINT UNSIGNED NOT NULL,
            username VARCHAR(190) NOT NULL,
            password VARCHAR(255) NOT NULL,
            last_ok_at DATETIME(3) NULL DEFAULT NULL,
            last_fetch_at DATETIME(3) NULL DEFAULT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/**
 * Read the stored credentials, seeding the default Gareth/Phex pair on first use
 * (when the row is absent). Returns the username AND password because the fetch
 * needs both to authenticate -- callers MUST NOT leak the returned password.
 *
 * @return array{username:string, password:string}
 */
function avesmapsWikiDumpGetCredentials(PDO $pdo): array
{
    avesmapsWikiDumpEnsureSettings($pdo);

    $statement = $pdo->prepare(
        'SELECT username, password FROM ' . AVESMAPS_WIKI_DUMP_SETTINGS_TABLE . ' WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => AVESMAPS_WIKI_DUMP_SETTINGS_ROW_ID]);
    $row = $statement->fetch();

    if (is_array($row) && (string) $row['username'] !== '') {
        return [
            'username' => (string) $row['username'],
            'password' => (string) $row['password'],
        ];
    }

    // First use: seed the documented default pair so a fresh install works.
    avesmapsWikiDumpWriteCredentialsRow($pdo, AVESMAPS_WIKI_DUMP_DEFAULT_USERNAME, AVESMAPS_WIKI_DUMP_DEFAULT_PASSWORD);

    return [
        'username' => AVESMAPS_WIKI_DUMP_DEFAULT_USERNAME,
        'password' => AVESMAPS_WIKI_DUMP_DEFAULT_PASSWORD,
    ];
}

/**
 * Persist a new last-working credential pair (used by set_dump_credentials and,
 * internally, after a successful fetch). Whitespace-trimmed username; the
 * password is stored verbatim (a leading/trailing space could be significant).
 * Empty username or password is rejected.
 */
function avesmapsWikiDumpSetCredentials(PDO $pdo, string $username, string $password): void
{
    $trimmedUsername = trim($username);
    if ($trimmedUsername === '' || $password === '') {
        throw new InvalidArgumentException('Username and password must not be empty.');
    }
    if (mb_strlen($trimmedUsername) > 190 || strlen($password) > 255) {
        throw new InvalidArgumentException('Username or password is too long.');
    }

    avesmapsWikiDumpEnsureSettings($pdo);
    avesmapsWikiDumpWriteCredentialsRow($pdo, $trimmedUsername, $password);
}

/**
 * Low-level upsert of the single settings row's credentials (does not touch the
 * timestamps). Assumes the table exists.
 */
function avesmapsWikiDumpWriteCredentialsRow(PDO $pdo, string $username, string $password): void
{
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_DUMP_SETTINGS_TABLE . ' (id, username, password)
         VALUES (:id, :username, :password)
         ON DUPLICATE KEY UPDATE username = VALUES(username), password = VALUES(password)'
    );
    $statement->execute([
        'id' => AVESMAPS_WIKI_DUMP_SETTINGS_ROW_ID,
        'username' => $username,
        'password' => $password,
    ]);
}

/**
 * Stamp last_fetch_at (every attempt) and optionally last_ok_at (success only) on
 * the settings row. Never touches the credentials.
 */
function avesmapsWikiDumpTouchFetchTimestamps(PDO $pdo, bool $ok): void
{
    avesmapsWikiDumpEnsureSettings($pdo);
    $sql = $ok
        ? 'UPDATE ' . AVESMAPS_WIKI_DUMP_SETTINGS_TABLE . ' SET last_fetch_at = CURRENT_TIMESTAMP(3), last_ok_at = CURRENT_TIMESTAMP(3) WHERE id = :id'
        : 'UPDATE ' . AVESMAPS_WIKI_DUMP_SETTINGS_TABLE . ' SET last_fetch_at = CURRENT_TIMESTAMP(3) WHERE id = :id';
    $statement = $pdo->prepare($sql);
    $statement->execute(['id' => AVESMAPS_WIKI_DUMP_SETTINGS_ROW_ID]);
}

/**
 * Read the last fetch/ok timestamps for the status response (no credentials).
 *
 * @return array{last_fetch_at:?string, last_ok_at:?string, username:string}
 */
function avesmapsWikiDumpReadMeta(PDO $pdo): array
{
    avesmapsWikiDumpEnsureSettings($pdo);
    $statement = $pdo->prepare(
        'SELECT username, last_fetch_at, last_ok_at FROM ' . AVESMAPS_WIKI_DUMP_SETTINGS_TABLE . ' WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => AVESMAPS_WIKI_DUMP_SETTINGS_ROW_ID]);
    $row = $statement->fetch();

    return [
        'username' => is_array($row) ? (string) ($row['username'] ?? '') : '',
        'last_fetch_at' => is_array($row) ? ($row['last_fetch_at'] ?? null) : null,
        'last_ok_at' => is_array($row) ? ($row['last_ok_at'] ?? null) : null,
    ];
}

// ===========================================================================
// File-state helper.
// ===========================================================================

/**
 * Inspect the stored dump on disk. Returns a small, password-free shape used by
 * both the cache check and the status endpoint.
 *
 * @return array{present:bool, size:int, mtime:?int, age_seconds:?int}
 */
function avesmapsWikiDumpFileState(int $now): array
{
    $path = avesmapsWikiDumpStoragePath();
    if (!is_file($path)) {
        return ['present' => false, 'size' => 0, 'mtime' => null, 'age_seconds' => null];
    }

    $size = (int) @filesize($path);
    $mtime = @filemtime($path);
    $mtime = $mtime === false ? null : (int) $mtime;
    $age = $mtime === null ? null : max(0, $now - $mtime);

    return ['present' => true, 'size' => $size, 'mtime' => $mtime, 'age_seconds' => $age];
}

// ===========================================================================
// Core: fetch (network).
// ===========================================================================

/**
 * Fetch the dump, honouring the cache. This is the only function here that does
 * outbound network I/O.
 *
 * Flow:
 *   1. If a local .bz2 is < 24 h old and !forceRefresh -> return from cache.
 *   2. Otherwise download over HTTPS (Basic-Auth with the stored creds) STRAIGHT
 *      TO A TEMP FILE (streamed via CURLOPT_FILE, never RAM), then:
 *        - HTTP 401  -> {ok:false, code:'dump_unauthorized', http:401} (no throw;
 *                       the frontend prompts for new creds). Temp file removed.
 *        - other bad -> {ok:false, code:'dump_fetch_failed', http:int}. Temp file
 *                       removed.
 *        - success   -> sanity-check size + bz2 magic bytes; atomically rename the
 *                       temp file into place; store the creds as last-working and
 *                       stamp the timestamps; return {ok:true, from_cache:false,
 *                       size, http:200}.
 *
 * The return NEVER contains the password. On failure the return carries only a
 * machine code + the HTTP status; upstream error TEXT (which cannot contain the
 * password anyway) is not surfaced to the client.
 *
 * @return array{ok:bool, from_cache?:bool, size?:int, age_seconds?:int, http?:int, code?:string}
 */
function avesmapsWikiDumpFetch(PDO $pdo, bool $forceRefresh = false): array
{
    $now = time();

    // 1. Cache hit?
    $state = avesmapsWikiDumpFileState($now);
    if (avesmapsWikiDumpCacheIsFresh($state['mtime'], $now, $forceRefresh)) {
        return [
            'ok' => true,
            'from_cache' => true,
            'size' => $state['size'],
            'age_seconds' => (int) ($state['age_seconds'] ?? 0),
            'http' => 0,
        ];
    }

    if (!function_exists('curl_init')) {
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => 0];
    }

    // Ensure the protected storage dir + its deny-all .htaccess exist.
    $dir = avesmapsWikiDumpStorageDir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => 0];
    }
    avesmapsWikiDumpEnsureStorageHtaccess($dir);

    $credentials = avesmapsWikiDumpGetCredentials($pdo);

    // Stream to a unique temp file in the same dir so the final rename is atomic
    // and a concurrent read never sees a half-written dump.
    $tmpPath = $dir . '/' . AVESMAPS_WIKI_DUMP_FILENAME . '.tmp.' . getmypid() . '.' . bin2hex(random_bytes(4));
    $handle = @fopen($tmpPath, 'wb');
    if ($handle === false) {
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => 0];
    }

    // ~39 MB transfer may exceed the default script time limit.
    @set_time_limit(AVESMAPS_WIKI_DUMP_TRANSFER_TIMEOUT_SECONDS + 60);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => AVESMAPS_WIKI_DUMP_URL,
        // Stream the body to the file handle -- NOT RETURNTRANSFER, so the 39 MB
        // body is never held in memory.
        CURLOPT_FILE => $handle,
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_USERPWD => $credentials['username'] . ':' . $credentials['password'],
        // SSL verification ON.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        // Bounded redirects; HTTPS only (no downgrade, no file:// / gopher:// etc.).
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => AVESMAPS_WIKI_DUMP_CONNECT_TIMEOUT_SECONDS,
        CURLOPT_TIMEOUT => AVESMAPS_WIKI_DUMP_TRANSFER_TIMEOUT_SECONDS,
        CURLOPT_USERAGENT => 'AvesmapsDumpBot/1.0 (+https://avesmaps.de)',
        CURLOPT_FAILONERROR => false, // we inspect the status code ourselves
    ]);

    $ok = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    // Always close the file handle before inspecting / renaming / unlinking.
    @fclose($handle);

    // Transport-level failure (DNS, TLS, timeout). curl's error text cannot
    // contain the password, but we still do not surface it -- only a code.
    if ($ok === false) {
        @unlink($tmpPath);
        avesmapsWikiDumpTouchFetchTimestamps($pdo, false);
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => $httpCode];
    }

    // 401 -> clear, distinct signal for the inline credential prompt.
    if ($httpCode === 401) {
        @unlink($tmpPath);
        avesmapsWikiDumpTouchFetchTimestamps($pdo, false);
        return ['ok' => false, 'code' => 'dump_unauthorized', 'http' => 401];
    }

    if ($httpCode < 200 || $httpCode >= 300) {
        @unlink($tmpPath);
        avesmapsWikiDumpTouchFetchTimestamps($pdo, false);
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => $httpCode];
    }

    // Sanity: plausible size + bz2 magic bytes (rejects a 200 error page).
    $downloadedSize = (int) @filesize($tmpPath);
    $leadingBytes = (string) @file_get_contents($tmpPath, false, null, 0, 3);
    if ($downloadedSize < AVESMAPS_WIKI_DUMP_MIN_PLAUSIBLE_BYTES || !avesmapsWikiDumpLooksLikeBzip2($leadingBytes)) {
        @unlink($tmpPath);
        avesmapsWikiDumpTouchFetchTimestamps($pdo, false);
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => $httpCode];
    }

    // Atomic publish.
    $finalPath = avesmapsWikiDumpStoragePath();
    if (!@rename($tmpPath, $finalPath)) {
        @unlink($tmpPath);
        avesmapsWikiDumpTouchFetchTimestamps($pdo, false);
        return ['ok' => false, 'code' => 'dump_fetch_failed', 'http' => $httpCode];
    }

    // Success: these creds worked -> persist as last-working + stamp timestamps.
    avesmapsWikiDumpSetCredentials($pdo, $credentials['username'], $credentials['password']);
    avesmapsWikiDumpTouchFetchTimestamps($pdo, true);

    return [
        'ok' => true,
        'from_cache' => false,
        'size' => $downloadedSize,
        'http' => $httpCode,
    ];
}

/**
 * Status snapshot for the GET endpoint: file presence/size/age + last-fetch
 * metadata + the last-used username (NEVER the password) + the URL.
 */
function avesmapsWikiDumpStatus(PDO $pdo): array
{
    $now = time();
    $state = avesmapsWikiDumpFileState($now);
    $meta = avesmapsWikiDumpReadMeta($pdo);

    // Prefer the stored last-used username; fall back to the default seed for
    // display so the prefill is never blank.
    $username = $meta['username'] !== '' ? $meta['username'] : AVESMAPS_WIKI_DUMP_DEFAULT_USERNAME;

    return avesmapsWikiDumpBuildStatusShape(
        [
            'present' => $state['present'],
            'size' => $state['size'],
            'age_seconds' => $state['age_seconds'],
            'mtime' => $state['mtime'],
        ],
        $username,
        $meta['last_fetch_at'],
        $meta['last_ok_at']
    );
}

// ===========================================================================
// Storage protection (runtime-written deny-all .htaccess).
// ===========================================================================

/**
 * Ensure the storage directory has an .htaccess that denies all HTTP access. The
 * deploy allowlist does not carry uploads/, so a committed .htaccess would not
 * reach the server; writing it here (best-effort, idempotent) self-heals the
 * protection the first time a dump is fetched. Mirrors api/diagnostics/.htaccess.
 */
function avesmapsWikiDumpEnsureStorageHtaccess(string $dir): void
{
    $htaccessPath = $dir . '/.htaccess';
    if (is_file($htaccessPath)) {
        return;
    }

    $contents = "<IfModule mod_authz_core.c>\n"
        . "    Require all denied\n"
        . "</IfModule>\n\n"
        . "<IfModule !mod_authz_core.c>\n"
        . "    Order allow,deny\n"
        . "    Deny from all\n"
        . "</IfModule>\n";

    @file_put_contents($htaccessPath, $contents, LOCK_EX);
}
