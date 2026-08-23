<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the dump PROCUREMENT layer (WikiDump migration,
 * Task 5a): api/_internal/wiki/dump-fetch.php.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST IS DELIBERATELY SMALL
 * ---------------------------------------------------------------------------
 * Task 5a is the first "sharp" task: the real behaviour (an outbound HTTPS
 * download from Wiki Aventurica, a STRATO MySQL settings row) is NOT locally
 * testable and MUST NOT be faked. So this test exercises ONLY the genuinely
 * offline-decidable pure helpers -- it mocks NEITHER curl NOR MySQL:
 *
 *   1. avesmapsWikiDumpCacheIsFresh()      -- die Doppelklick-Frist (seit 23.08.2026 eine
 *                                             Stunde: der Dump entsteht MONATLICH, am 1.).
 *   1b. avesmapsWikiDumpConditionalTimeValue() -- der If-Modified-Since-Zeitwert.
 *   2. avesmapsWikiDumpLooksLikeBzip2()    -- the bz2 magic-byte ("BZh") sniff.
 *   3. avesmapsWikiDumpBuildStatusShape()  -- proves the status/result shape can
 *                                             NEVER carry a password field.
 *   4. Storage-path constants/helpers      -- fixed filename (no traversal),
 *                                             correct .bz2 extension for the reader.
 *
 * The DB and network paths (avesmapsWikiDumpFetch / *Credentials / *Status with a
 * real PDO) are covered by the LIVE VERIFICATION RECIPE the owner runs on STRATO
 * (see the Task 5a report), because pretending to exercise them here would be a
 * fake integration test.
 *
 * Include purity is also asserted: requiring dump-fetch.php performs no DB
 * connect, no download and emits no output (only const + function definitions).
 *
 * Exit code 0 iff every assertion passes.
 */

// ---------------------------------------------------------------------------
// 1. Runtime guards (mirror the other tools/wikidump tests).
// ---------------------------------------------------------------------------
$mbstringLoaded = extension_loaded('mbstring');
if (!$mbstringLoaded) {
    // dump-fetch.php uses mb_strlen() in the credential-length guard. The pure
    // helpers under test here do not, but keep the same guard shape as the sibling
    // tests for consistency and to keep any future mb_* additions honest.
    fwrite(STDERR, "WARN: mbstring is not loaded; credential-length paths use mb_strlen().\n");
    fwrite(STDERR, "      The pure helpers under test do not need it; continuing.\n");
    fwrite(STDERR, "      For full parity re-run with: php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n\n");
}

$repoRoot = dirname(__DIR__, 2);
$libPath = $repoRoot . '/api/_internal/wiki/dump-fetch.php';
if (!is_file($libPath)) {
    fwrite(STDERR, "FATAL: library not found: {$libPath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Include purity: no output, no fatal, defines the expected functions.
// ---------------------------------------------------------------------------
ob_start();
require $libPath;
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpCacheIsFresh',
    'avesmapsWikiDumpLooksLikeBzip2',
    'avesmapsWikiDumpBuildStatusShape',
    'avesmapsWikiDumpStoragePath',
    'avesmapsWikiDumpStorageDir',
    'avesmapsWikiDumpFetch',
    'avesmapsWikiDumpStatus',
    'avesmapsWikiDumpGetCredentials',
    'avesmapsWikiDumpSetCredentials',
    'avesmapsWikiDumpEnsureSettings',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-fetch.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-54s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-54s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump-fetch procurement PURE-logic test (WikiDump migration, 5a)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . ($mbstringLoaded ? 'yes' : 'no') . "\n";
echo 'curl loaded        : ' . (extension_loaded('curl') ? 'yes' : 'no (network path is STRATO-verified, see report)') . "\n";
echo 'pdo_mysql loaded   : ' . (extension_loaded('pdo_mysql') ? 'yes' : 'no (DB path is STRATO-verified, see report)') . "\n";
echo "----------------------------------------------------------------\n\n";

// ===========================================================================
// (0) include purity
// ===========================================================================
echo "-- (0) include purity --\n";
$check('(0a) include emits no output', '', $includeOutput, 'requiring dump-fetch.php prints nothing (side-effect-free include)');

// ===========================================================================
// (a) Frist gegen den Doppelklick -- NICHT mehr die 24-h-Regel
// ===========================================================================
echo "\n-- (a) avesmapsWikiDumpCacheIsFresh: Doppelklick-Frist --\n";
$now = 1_700_000_000; // arbitrary fixed "now"
$ttl = AVESMAPS_WIKI_DUMP_CACHE_TTL_SECONDS;

// 🔴 Der Dump entsteht am 1. jedes Monats (Betreiber, 23.08.2026), nicht taeglich. 24 h waren
// ausgerechnet am 1. schaedlich: ein Abruf am 31. haette den neuen Dump aus dem Zwischenspeicher
// heraus verschluckt. Die Frist schuetzt nur noch vor dem Doppelklick; gespart wird per 304.
$check('(a1) Frist ist eine Stunde, nicht 24', 3600, $ttl, 'die Frist ist nur noch der Doppelklick-Schutz -- der Monatstakt wird per If-Modified-Since erkannt');
$check('(a2) absent file -> not fresh', false, avesmapsWikiDumpCacheIsFresh(null, $now, false), 'no local file => must download');
$check('(a3) force overrides fresh file', false, avesmapsWikiDumpCacheIsFresh($now - 10, $now, true), 'force_refresh always re-downloads even for a brand-new file');
$check('(a4) 1 s old -> fresh', true, avesmapsWikiDumpCacheIsFresh($now - 1, $now, false), 'a 1-second-old dump is reused');
$check('(a5) knapp unter der Frist -> frisch', true, avesmapsWikiDumpCacheIsFresh($now - ($ttl - 60), $now, false), 'eine Minute vor Fristende wird die Kopie noch benutzt');
$check('(a6) genau auf der Frist -> nicht mehr frisch', false, avesmapsWikiDumpCacheIsFresh($now - $ttl, $now, false), 'at the TTL boundary the cache is stale (re-download)');
$check('(a7) weit ueber der Frist -> nicht mehr frisch', false, avesmapsWikiDumpCacheIsFresh($now - ($ttl + 3600), $now, false), 'weit ueber der Frist => erneut nachfragen');
$check('(a8) future mtime (clock skew) -> fresh', true, avesmapsWikiDumpCacheIsFresh($now + 5000, $now, false), 'a future mtime is treated as age 0 (fresh), never a negative age');

// ===========================================================================
// (b) bz2 magic-byte sniff
// ===========================================================================
echo "\n-- (b) avesmapsWikiDumpLooksLikeBzip2: BZh magic bytes --\n";
$check('(b1) real bz2 header accepted', true, avesmapsWikiDumpLooksLikeBzip2("BZh91AY&SY"), 'a genuine bzip2 stream starts with "BZh"');
$check('(b2) exactly "BZh" accepted', true, avesmapsWikiDumpLooksLikeBzip2('BZh'), 'the 3 magic bytes alone pass the sniff');
$check('(b3) HTML error page rejected', false, avesmapsWikiDumpLooksLikeBzip2('<!DOCTYPE html>'), 'a 200 HTML error page is not a dump');
$check('(b4) gzip magic rejected', false, avesmapsWikiDumpLooksLikeBzip2("\x1f\x8b\x08"), 'gzip (1f 8b) is not bzip2');
$check('(b5) empty body rejected', false, avesmapsWikiDumpLooksLikeBzip2(''), 'an empty transfer is not a dump');
$check('(b6) plain XML rejected', false, avesmapsWikiDumpLooksLikeBzip2('<mediawiki'), 'an uncompressed XML body is not the expected .bz2');

// ===========================================================================
// (c) response / status shape can never carry a password
// ===========================================================================
echo "\n-- (c) avesmapsWikiDumpBuildStatusShape: no password field --\n";
$status = avesmapsWikiDumpBuildStatusShape(
    ['present' => true, 'size' => 40_000_000, 'age_seconds' => 3600, 'mtime' => $now - 3600],
    'Gareth',
    '2026-07-02 06:00:00.000',
    '2026-07-02 06:00:00.000'
);
$statusKeys = array_keys($status);
sort($statusKeys);

$check('(c1) status has no "password" key', false, array_key_exists('password', $status), 'the status shape must never expose the password');
$check('(c2) status exposes username (prefill)', 'Gareth', $status['username'] ?? null, 'username IS exposed for the "last used" prefill');
$check('(c3) status url is the dump url', AVESMAPS_WIKI_DUMP_URL, $status['url'] ?? null, 'status reports the fixed dump URL');
$check('(c4) status keys are exactly the expected safe set', ['age_seconds', 'last_fetch_at', 'last_ok_at', 'present', 'size', 'ttl_seconds', 'url', 'username'], $statusKeys, 'only known, credential-free keys are present');

// Serialise the whole shape and make sure a plausible password string cannot
// appear (belt-and-suspenders against an accidental future field).
$statusJson = json_encode($status, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$check('(c5) serialised status contains no "password"', false, str_contains((string) $statusJson, 'password'), 'the JSON-encoded status never contains the substring "password"');
$check('(c6) serialised status contains no seed secret', false, str_contains((string) $statusJson, AVESMAPS_WIKI_DUMP_DEFAULT_PASSWORD), 'the default seed password never leaks into the status JSON');

// ===========================================================================
// (d) storage path: fixed filename (no traversal) + reader-compatible extension
// ===========================================================================
echo "\n-- (d) storage path & constants --\n";
$storagePath = avesmapsWikiDumpStoragePath();
$storageDir = avesmapsWikiDumpStorageDir();

$check('(d1) filename constant is fixed', 'dewa_dump_small.xml.bz2', AVESMAPS_WIKI_DUMP_FILENAME, 'the on-disk filename is a fixed constant -> no path traversal');
$check('(d2) storage path ends with the fixed filename', true, str_ends_with($storagePath, '/uploads/dumps/dewa_dump_small.xml.bz2'), 'the dump lands under uploads/dumps/ with the fixed name');
$check('(d3) storage path has .bz2 extension', 'bz2', strtolower(pathinfo($storagePath, PATHINFO_EXTENSION)), 'the reader keys on .bz2 to pick compress.bzip2://');
$check('(d4) path is inside the storage dir', true, str_starts_with($storagePath, $storageDir . '/'), 'the fixed-name path can never escape the storage directory');
$check('(d5) no ".." in the storage path', false, str_contains($storagePath, '..'), 'no parent-directory traversal in the resolved path');
$check('(d6) subdir constant is uploads/dumps', 'uploads/dumps', AVESMAPS_WIKI_DUMP_STORAGE_SUBDIR, 'storage subdir is the protected uploads/dumps area');
$check('(d7) URL is the German small dump over https', true, str_starts_with(AVESMAPS_WIKI_DUMP_URL, 'https://') && str_contains(AVESMAPS_WIKI_DUMP_URL, 'dewa_dump_small.xml.bz2'), 'fetch targets the verified https dewa_ URL');

// ===========================================================================

// (e) If-Modified-Since -- die Nachfrage, die 40 MB spart
// ===========================================================================
echo "\n-- (e) avesmapsWikiDumpConditionalTimeValue + der 304-Zweig --\n";

$check('(e1) vorhandene Kopie -> ihre mtime ist die Bedingung', 1_700_000_000, avesmapsWikiDumpConditionalTimeValue(1_700_000_000, false), 'gefragt wird mit dem Zeitpunkt unseres letzten erfolgreichen Abrufs');
$check('(e2) keine Kopie -> keine Bedingung', 0, avesmapsWikiDumpConditionalTimeValue(null, false), 'ohne lokale Datei gibt es nichts zu vergleichen -- voll laden');
// 💣 Der wichtigste Fall: ohne diese Zeile beantwortete der Server ein ausdrueckliches
// „jetzt wirklich neu holen" mit 304, und der Knopf taete sichtbar nichts.
$check('(e3) force nimmt die Bedingung weg', 0, avesmapsWikiDumpConditionalTimeValue(1_700_000_000, true), 'ein erzwungener Abruf darf nie 304 bekommen');
$check('(e4) mtime 0 -> keine Bedingung', 0, avesmapsWikiDumpConditionalTimeValue(0, false), 'eine unbrauchbare mtime laedt lieber einmal zu viel');
$check('(e5) negative mtime -> keine Bedingung', 0, avesmapsWikiDumpConditionalTimeValue(-5, false), 'dasselbe fuer eine kaputte Dateisystem-Auskunft');

$fetchSource = str_replace(chr(13), '', (string) file_get_contents($repoRoot . '/api/_internal/wiki/dump-fetch.php'));
$check('(e6) curl fragt bedingt an', true, str_contains($fetchSource, 'CURLOPT_TIMECONDITION') && str_contains($fetchSource, 'CURLOPT_TIMEVALUE'), 'ohne diese beiden Optionen wandert der Zeitwert nirgendwohin');
$check('(e7) ohne Zeitwert faehrt gar keine Bedingung mit', true, str_contains($fetchSource, 'CURL_TIMECOND_NONE'), '$timeValue = 0 muss die Bedingung abschalten, nicht den 01.01.1970 senden');
// 🔴 304 ist ein Erfolg. Faellt dieser Zweig weg, laeuft die Antwort in die „kein 2xx"-Absage --
// und ein voellig gesunder Lauf meldete „Abruf gescheitert".
$check('(e8) 304 wird als Erfolg behandelt', true, str_contains($fetchSource, '$httpCode === 304'), 'ohne eigenen Zweig faellt 304 in die kein-2xx-Absage');
$check('(e9) der 304-Zweig steht VOR der kein-2xx-Absage', true, strpos($fetchSource, '$httpCode === 304') < strpos($fetchSource, '$httpCode < 200 || $httpCode >= 300'), 'die Reihenfolge IST die Regel -- dahinter waere der Zweig tot');
// ⚠️ Die mtime der Kopie ist das Alter des DUMPS, das im Fenster steht. Wer sie beim Nachfragen
// anfasst, laesst einen zwei Wochen alten Dump als „gerade geholt" erscheinen.
$dreihundertvier = substr($fetchSource, (int) strpos($fetchSource, '$httpCode === 304'), 600);
$check('(e10) das Nachfragen fasst die Kopie nicht an', false, str_contains($dreihundertvier, 'touch('), 'ein touch() beim 304 verfaelscht das angezeigte Alter des Dumps');

// ===========================================================================
// (f) Die Absage nennt ihren Grund -- sonst sehen acht Ursachen gleich aus
// ===========================================================================
echo "
-- (f) avesmapsWikiDumpAbsageMeldung --
";

// 🔴 Am 24.08.2026 drueckte der Owner „Dump holen" und bekam „The dump could not be downloaded
// from the wiki server." -- ein Satz fuer acht verschiedene Ursachen. Sperre, Zeitablauf, voller
// Speicher und HTML-Fehlerseite waren daran nicht zu unterscheiden.
$gesperrt = avesmapsWikiDumpAbsageMeldung(['grund' => 'Verbindung gescheitert: Connection refused', 'http' => 0]);
$check('(f1) Transportfehler nennt curls Auskunft', true, str_contains($gesperrt, 'Connection refused'), 'die Signatur einer REJECT-Regel steht genau hier -- ein Zeitablauf saehe anders aus');
$check('(f2) HTTP 0 wird als Aussage geschrieben', true, str_contains($gesperrt, 'keine HTTP-Antwort'), '„es kam gar nichts zurueck" ist eine Aussage, keine fehlende Angabe');

$verboten = avesmapsWikiDumpAbsageMeldung(['grund' => 'unerwartete Antwort', 'http' => 403]);
$check('(f3) ein echter Status steht in der Klammer', true, str_contains($verboten, 'HTTP 403'), 'eine Statusnummer beantwortet die Frage sofort');

$speicher = avesmapsWikiDumpAbsageMeldung(['grund' => 'Zwischendatei nicht beschreibbar (Speicher voll?)', 'http' => 0]);
$check('(f4) der volle Speicher sieht NICHT aus wie eine Wiki-Sperre', false, $speicher === $gesperrt, 'genau diese zwei wurden bisher gleich gemeldet, obwohl das eine ohne jeden Fremdaufruf passiert');

// ⚠️ Auch ohne Grund darf die Klammer nie leer sein -- sonst steht dort „( )" und der Satz
// behauptet eine Auskunft, die er nicht gibt.
$ohne = avesmapsWikiDumpAbsageMeldung([]);
$check('(f5) ohne Grund bleibt die Klammer trotzdem gefuellt', true, str_contains($ohne, 'keine HTTP-Antwort'), 'eine leere Klammer waere schlimmer als keine');
$check('(f6) kein Passwort in der Meldung', false, str_contains(mb_strtolower($gesperrt . $verboten . $speicher . $ohne), 'passwor'), 'die Meldung entsteht aus festen Texten und curls Fehlertext -- nie aus Zugangsdaten');
// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
