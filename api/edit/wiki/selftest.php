<?php

declare(strict_types=1);

/**
 * In-editor self-test runner (owner/editor-only).
 * ---------------------------------------------------------------------------
 * Runs the curated, self-contained (DB-free) tools/wikidump unit tests
 * SERVER-SIDE and returns their PASS/FAIL as JSON, so editors can watch the
 * suite go green/red in the browser without shell access (STRATO SSH is locked
 * down). Surfaced by the WikiSync „Dump-Report" panel after a full dump run.
 *
 *   GET ?action=manifest        -> { ok:true, tests:[ {key,label}, ... ] }
 *   GET ?action=run&test=<key>  -> { ok:true, key, label, passed, failed,
 *                                    ok_run, fatal, output }
 *
 * WHY THIS ENDPOINT DOES ITS OWN, INLINE AUTH GATE (and does NOT require
 * bootstrap.php / auth.php the normal way):
 *   Each tools/wikidump test `require`s api/_internal/bootstrap.php itself. PHP
 *   EARLY-BINDS unconditional top-level functions at compile time, so if this
 *   endpoint had already loaded bootstrap, the test's second `require` would
 *   redeclare-fatal (a re-inclusion guard does NOT help — the functions are
 *   bound before the guard runs). The fix is to let the TEST be the first (and
 *   only) loader of bootstrap in this process. So the gate here is a minimal,
 *   read-only session check that mirrors auth.php EXACTLY:
 *     session key  = 'avesmaps_user'  (AVESMAPS_AUTH_SESSION_KEY)
 *     capability   = avesmapsUserCan($u,'edit') === role in {admin, editor}
 *   Keep it in sync with api/_internal/auth.php if the role model changes.
 *
 * SAFETY:
 *   - The client passes a whitelisted KEY, never a path — no traversal, no
 *     arbitrary include. Only basenames in $TESTS below, under tools/wikidump/,
 *     are runnable.
 *   - The tests are DB-FREE (verified: none call avesmapsCreatePdo / connect;
 *     they use fake PDOs) and read-only — a run can never touch the live DB.
 *   - tools/ is `.htaccess`-denied to the public (Require all denied), so the
 *     test files are reachable ONLY through this gated endpoint's server-side
 *     include, never over public HTTP.
 */

// api/edit/wiki -> api/edit -> api -> <repo root>
$avesmapsSelftestRoot = dirname(__DIR__, 3);

// ---------------------------------------------------------------------------
// Curated runnable set: DB-free, self-contained (fixtures only, no network / no
// real dump file). Keep KEYS stable (the frontend + ?test= use them). The
// network-dependent test-dump-fetch.php is deliberately excluded.
// ---------------------------------------------------------------------------
$TESTS = [
    'hybrid-driver'    => ['file' => 'test-dump-hybrid-read-driver.php',      'label' => 'Hybrid-Read-Treiber (Phasenmaschine)'],
    'entities'         => ['file' => 'test-dump-entities.php',                'label' => 'Entitäten (Infobox-Parsing)'],
    'hybrid-read'      => ['file' => 'test-dump-hybrid-read.php',             'label' => 'Hybrid-Read-Schritt (Pass B)'],
    'hybrid-state'     => ['file' => 'test-dump-hybrid-state.php',            'label' => 'Hybrid-Statustabelle'],
    'hybrid-cleanup'   => ['file' => 'test-dump-hybrid-cleanup.php',          'label' => 'Sandbox-Aufräumen'],
    'compare-hybrid'   => ['file' => 'test-dump-compare-hybrid.php',          'label' => 'Vergleichs-Adapter (H5)'],
    'collect-wikitext' => ['file' => 'test-dump-collect-wikitext.php',        'label' => 'Wikitext-Sammeln'],
    'category-layer'   => ['file' => 'test-dump-category-layer.php',          'label' => 'Kategorie-/Kontinent-Schicht'],
    'reader'           => ['file' => 'test-dump-reader.php',                  'label' => 'Dump-XML-Leser'],
    'wiki-key'         => ['file' => 'test-wiki-key-derivation.php',          'label' => 'Wiki-Key-Ableitung'],
];

/** Emit a JSON envelope + exit. Own helper (bootstrap's is deliberately not loaded). */
function avesmapsSelftestJson(int $status, array $body): void
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------------------------------------------------------------------------
// Inline, read-only auth gate (see docblock — mirrors auth.php, no bootstrap).
// ---------------------------------------------------------------------------
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}
$avesmapsSelftestUser = $_SESSION['avesmaps_user'] ?? null;
session_write_close(); // release the session lock immediately (auth.php pattern)

$avesmapsSelftestRole = is_array($avesmapsSelftestUser) ? (string) ($avesmapsSelftestUser['role'] ?? '') : '';
if (!in_array($avesmapsSelftestRole, ['admin', 'editor'], true)) {
    $unauth = $avesmapsSelftestUser === null;
    avesmapsSelftestJson($unauth ? 401 : 403, [
        'ok' => false,
        'error' => [
            'code' => $unauth ? 'unauthenticated' : 'forbidden',
            'message' => $unauth ? 'Editor login required.' : 'The self-test runner requires the edit capability.',
        ],
    ]);
}

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    avesmapsSelftestJson(405, ['ok' => false, 'error' => ['code' => 'method_not_allowed', 'message' => 'Use GET.']]);
}

$action = (string) ($_GET['action'] ?? 'manifest');

if ($action === 'manifest') {
    $list = [];
    foreach ($TESTS as $key => $meta) {
        $list[] = ['key' => $key, 'label' => $meta['label']];
    }
    avesmapsSelftestJson(200, ['ok' => true, 'tests' => $list]);
}

if ($action !== 'run') {
    avesmapsSelftestJson(400, ['ok' => false, 'error' => ['code' => 'invalid_request', 'message' => 'Unknown action.']]);
}

$testKey = (string) ($_GET['test'] ?? '');
if (!isset($TESTS[$testKey])) {
    avesmapsSelftestJson(400, ['ok' => false, 'error' => ['code' => 'invalid_request', 'message' => 'Unknown or missing test key.']]);
}
$testMeta = $TESTS[$testKey];
$testPath = $avesmapsSelftestRoot . '/tools/wikidump/' . $testMeta['file'];
if (!is_file($testPath)) {
    avesmapsSelftestJson(500, ['ok' => false, 'error' => ['code' => 'test_missing', 'message' => 'Test file not present on the server (deploy allowlist?).']]);
}

// The tests were written for the CLI and reference STDERR in their (never-taken
// on a healthy server) precondition-failure branch; define it so a web SAPI does
// not turn that into a confusing "Undefined constant" if an extension is missing.
if (!defined('STDERR')) {
    define('STDERR', fopen('php://stderr', 'w'));
}

// ---------------------------------------------------------------------------
// Capture-run: the test prints PASS/FAIL to stdout and calls exit() at the end
// (and exit(2) on a failed precondition). Buffer its output and emit the JSON
// from a shutdown function, which runs on exit()/fatal BEFORE the buffer is
// auto-flushed. Validated locally against the real tests.
// ---------------------------------------------------------------------------
$GLOBALS['__avesmapsSelftestEmitted'] = false;
ob_start();
register_shutdown_function(static function () use ($testKey, $testMeta): void {
    if ($GLOBALS['__avesmapsSelftestEmitted']) {
        return;
    }
    $GLOBALS['__avesmapsSelftestEmitted'] = true;

    $output = '';
    while (ob_get_level() > 0) {
        $output .= (string) ob_get_clean();
    }

    // Parse both harness dialects: "RESULT: N passed, M failed" (driver-style)
    // and "RESULT: X/Y passing (Z failing)" (entities-style).
    $passed = null;
    $failed = null;
    if (preg_match('/RESULT:\s*(\d+)\s*passed,\s*(\d+)\s*failed/i', $output, $m) === 1) {
        $passed = (int) $m[1];
        $failed = (int) $m[2];
    } elseif (preg_match('~RESULT:\s*(\d+)/(\d+)\s*passing\s*\((\d+)\s*failing~i', $output, $m) === 1) {
        $passed = (int) $m[1];
        $failed = (int) $m[3];
    }

    $lastError = error_get_last();
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR];
    $fatal = ($lastError !== null && in_array((int) $lastError['type'], $fatalTypes, true))
        ? ($lastError['message'] . ' @ ' . basename((string) ($lastError['file'] ?? '')) . ':' . (int) ($lastError['line'] ?? 0))
        : null;

    // Cap the raw output so a huge suite can't bloat the payload; keep the tail
    // (the RESULT line + any FAIL blocks live at/near the end).
    if (strlen($output) > 40000) {
        $output = "… (gekürzt) …\n" . substr($output, -40000);
    }

    if (!headers_sent()) {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'ok' => true,
        'key' => $testKey,
        'label' => $testMeta['label'],
        'passed' => $passed,
        'failed' => $failed,
        'ok_run' => $fatal === null && $passed !== null && $failed === 0,
        'fatal' => $fatal,
        'output' => $output,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

require $testPath; // runs the test; it exit()s -> the shutdown function emits.
