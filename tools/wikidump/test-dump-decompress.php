<?php

declare(strict_types=1);

/**
 * Unit test for the Etappe-2 decompress-once SPEED CACHE decision logic (DB-free,
 * bz2-free). The actual bz2 decompression is owner-verified on STRATO (ext/bz2 is
 * not loaded on the dev box); this test covers everything that decides WHETHER a
 * reader reads the fast plain .xml or falls back to the .bz2:
 *   - the .xml path derivation (strip .bz2),
 *   - avesmapsWikiDumpPreferredReadPath: fresh xml -> xml; missing/stale/empty -> bz2,
 *   - avesmapsWikiDumpEnsureDecompressedXml guard branches (no bz2 file -> false;
 *     already-fresh xml -> true) that run BEFORE any decompression.
 *
 * The storage path is pointed at a throwaway temp webroot via DOCUMENT_ROOT so the
 * real uploads/ dir is never touched.
 *
 *     php tools/wikidump/test-dump-decompress.php
 */

$repoRoot = dirname(__DIR__, 2);
require $repoRoot . '/api/_internal/wiki/dump-fetch.php';

// Point the storage path at a throwaway temp webroot so we control the files.
$tmpRoot = sys_get_temp_dir() . '/avesmaps-etappe2-' . getmypid();
@mkdir($tmpRoot . '/uploads/dumps', 0775, true);
$_SERVER['DOCUMENT_ROOT'] = $tmpRoot;

$bz2 = avesmapsWikiDumpStoragePath();
$xml = avesmapsWikiDumpDecompressedXmlPath();

$pass = 0;
$fail = 0;
$check = static function (string $label, $expected, $actual) use (&$pass, &$fail): void {
    if ($expected === $actual) {
        $pass++;
        printf("PASS | %s\n", $label);
        return;
    }
    $fail++;
    printf("FAIL | %s\n     expected=%s actual=%s\n", $label, var_export($expected, true), var_export($actual, true));
};
$reset = static function () use ($bz2, $xml): void {
    @unlink($bz2);
    @unlink($xml);
    clearstatcache();
};

// (a) path derivation: .../dewa_dump_small.xml.bz2 -> .../dewa_dump_small.xml
$check('(a1) storage path ends in .bz2', '.bz2', substr($bz2, -4));
$check('(a2) xml path = bz2 minus .bz2', substr($bz2, 0, -4), $xml);

// (b) nothing present -> preferred = bz2 (nothing to read yet), ensure = false
$reset();
$check('(b1) preferred = bz2 when nothing exists', $bz2, avesmapsWikiDumpPreferredReadPath());
$check('(b2) ensure = false when no bz2 file', false, avesmapsWikiDumpEnsureDecompressedXml());

// (c) bz2 present, no xml -> preferred falls back to bz2
$reset();
file_put_contents($bz2, 'BZh-fake');
clearstatcache();
$check('(c1) preferred = bz2 when xml missing', $bz2, avesmapsWikiDumpPreferredReadPath());

// (d) fresh xml (newer than bz2, non-empty) -> preferred = xml; ensure short-circuits true
file_put_contents($xml, '<mediawiki/>');
touch($xml, time() + 5);
clearstatcache();
$check('(d1) preferred = xml when fresh', $xml, avesmapsWikiDumpPreferredReadPath());
$check('(d2) ensure = true when xml already fresh (no decompress needed)', true, avesmapsWikiDumpEnsureDecompressedXml());

// (e) stale xml (older than bz2) -> preferred = bz2 (never read a stale xml)
touch($xml, time() - 100);
clearstatcache();
$check('(e1) preferred = bz2 when xml stale', $bz2, avesmapsWikiDumpPreferredReadPath());

// (f) empty xml (0 bytes) even if fresh mtime -> preferred = bz2 (never read a 0-byte xml)
file_put_contents($xml, '');
touch($xml, time() + 5);
clearstatcache();
$check('(f1) preferred = bz2 when xml is empty', $bz2, avesmapsWikiDumpPreferredReadPath());

$reset();
@rmdir($tmpRoot . '/uploads/dumps');
@rmdir($tmpRoot . '/uploads');
@rmdir($tmpRoot);

printf("\nRESULT: %d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
