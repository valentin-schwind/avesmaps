<?php

declare(strict_types=1);

/**
 * DER SAMMEL-UMZUG der Beschriftungsquellen zu ihren Flaechen (Schritt 5 des Quellen-Umbaus, 03.09.2026).
 *
 * Geprueft werden, gegen SQLite:
 *   1. der Trockenlauf zaehlt (Labels, Flaechen, Zeilen vor/nach, Dubletten) und schreibt NICHTS
 *   2. die Bindung kommt aus dem EINEN Leser beider Richtungen: Label-Zeiger UND Flaechen-Zeiger zaehlen
 *   3. der scharfe Lauf zieht um, deckelt, bumpt EINMAL, freie Labels bleiben
 *   4. der Endpunkt: Admin-Riegel, ohne entity_public_id, apply nur ausdruecklich
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-label-takeover-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$GLOBALS['avesmapsTestRevisionBumps'] = 0;
function avesmapsNextMapRevision(PDO $pdo): int
{
    $GLOBALS['avesmapsTestRevisionBumps']++;

    return $GLOBALS['avesmapsTestRevisionBumps'];
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
$pdo->exec('CREATE TABLE ecosystem_region (public_id TEXT PRIMARY KEY, label_public_id TEXT, kind TEXT, is_active INTEGER NOT NULL DEFAULT 1)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, is_active INTEGER, properties_json TEXT)');
$mf = $pdo->prepare('INSERT INTO map_features (public_id, feature_type, is_active, properties_json) VALUES (?, ?, ?, ?)');
// Flaeche A nennt ihr Label a1 (Flaechen-Zeiger); Label a2 zeigt selbst auf A (Label-Zeiger); Label frei zeigt nirgendwohin.
$pdo->exec("INSERT INTO ecosystem_region (public_id, label_public_id, kind) VALUES ('A', 'a1', 'topographie'), ('B', NULL, 'vegetation')");
$mf->execute(['a1', 'label', 1, '{}']);
$mf->execute(['a2', 'label', 1, json_encode(['ecosystem_region_public_id' => 'A'])]);
$mf->execute(['b1', 'label', 1, json_encode(['ecosystem_region_public_id' => 'B'])]);
$mf->execute(['frei', 'label', 1, '{}']);
$mf->execute(['tot', 'label', 0, json_encode(['ecosystem_region_public_id' => 'B'])]);  // inaktiv: zaehlt nicht
$q = $pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution) VALUES (?, ?, ?, ?, ?, 0, ?, ?)');
foreach ([1, 2, 3] as $id) {
    $q->execute([$id, 'https://x/' . $id, str_repeat((string) $id, 64), 'Quelle ' . $id, 'sonstiges', '', '']);
}
$link = $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin) VALUES ('region', ?, ?, 'approved', 'manual')");
$link->execute(['a1', 1]); $link->execute(['a1', 2]);
$link->execute(['a2', 2]); $link->execute(['a2', 3]);     // 2 ist die Dublette zwischen a1 und a2
$link->execute(['b1', 1]);
$link->execute(['frei', 1]); $link->execute(['frei', 3]);
$link->execute(['tot', 3]);

$zaehle = static fn (PDO $pdo, string $t): int => (int) $pdo->query("SELECT COUNT(*) FROM feature_sources WHERE entity_type = '{$t}'")->fetchColumn();

// ── 1 + 2) Der Trockenlauf ────────────────────────────────────────────────────────────────────
$trocken = avesmapsFeatureSourcesTakeoverLabelSources($pdo, 1, true);
assert($trocken['dry_run'] === true && $trocken['ok'] === true, 'die Vorgabe ist der Trockenlauf');
$zaehl();
assert($trocken['labels'] === 3 && $trocken['regions'] === 2, 'drei gebundene Labels mit Quellen (a1 ueber den Flaechen-Zeiger, a2 ueber den Label-Zeiger, b1), zwei Flaechen: ' . json_encode([$trocken['labels'], $trocken['regions']]));
$zaehl();
assert($trocken['rows'] === 5 && $trocken['rows_after'] === 4 && $trocken['duplicates'] === 1, '5 Zeilen, 4 nach Zusammenfuehrung (Quelle 2 doppelt an A): ' . json_encode([$trocken['rows'], $trocken['rows_after'], $trocken['duplicates']]));
$zaehl();
assert(count($trocken['sample']) === 3 && isset($trocken['sample'][0]['label_public_id'], $trocken['sample'][0]['region_public_id']), 'die Stichprobe nennt Label und Flaeche');
$zaehl();
assert($zaehle($pdo, 'ecosystem') === 0 && $zaehle($pdo, 'region') === 8, 'der Trockenlauf schreibt nichts');
$zaehl();
assert($GLOBALS['avesmapsTestRevisionBumps'] === 0, '… und bumpt nichts');
$zaehl();

// ── 3) Scharf, gedeckelt ──────────────────────────────────────────────────────────────────────
$erst = avesmapsFeatureSourcesTakeoverLabelSources($pdo, 1, false, 2);
assert($erst['done'] === 2 && $erst['remaining'] === 1, 'gedeckelt: zwei von drei, eins bleibt');
$zaehl();
assert($GLOBALS['avesmapsTestRevisionBumps'] === 1, 'EIN Bump am Ende des Laufs, nicht je Label');
$zaehl();
$rest = avesmapsFeatureSourcesTakeoverLabelSources($pdo, 1, false, 200);
assert($rest['done'] === 1 && $rest['remaining'] === 0 && $rest['failed'] === [], 'der Rest im zweiten Lauf, ohne Fehler');
$zaehl();
assert($zaehle($pdo, 'ecosystem') === 4, 'die Flaechen tragen 4 Zeilen (A: 1,2,3 -- B: 1)');
$zaehl();
$a = $pdo->query("SELECT source_id FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = 'A' ORDER BY source_id")->fetchAll(PDO::FETCH_COLUMN);
assert(array_map('intval', $a) === [1, 2, 3], 'A traegt 1, 2, 3 -- die Dublette 2 nur einmal');
$zaehl();
$frei = $pdo->query("SELECT source_id FROM feature_sources WHERE entity_type = 'region' ORDER BY entity_public_id, source_id")->fetchAll(PDO::FETCH_ASSOC);
$freiIds = $pdo->query("SELECT DISTINCT entity_public_id FROM feature_sources WHERE entity_type = 'region' ORDER BY entity_public_id")->fetchAll(PDO::FETCH_COLUMN);
assert($freiIds === ['frei', 'tot'], 'das freie Label und das inaktive behalten ihre Zeilen -- nur gebundene, aktive wandern: ' . json_encode($freiIds));
$zaehl();
$leer = avesmapsFeatureSourcesTakeoverLabelSources($pdo, 1, true);
assert($leer['labels'] === 0 && $leer['remaining'] === 0, 'danach ist nichts mehr umzuziehen');
$zaehl();

// ── 4) Der Endpunkt ───────────────────────────────────────────────────────────────────────────
$endpunkt = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/map/feature-sources.php')) as $token) {
    if (is_array($token)) {
        if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $endpunkt .= $token[1];
    } else {
        $endpunkt .= $token;
    }
}
$arm = substr($endpunkt, strpos($endpunkt, "'takeover_label_sources' =>"));
$arm = substr($arm, 0, strpos($arm, "'remove' =>"));
assert(str_contains($arm, "avesmapsUserCan(\$user, 'admin')") && str_contains($arm, 'avesmapsErrorResponse(403'), 'nur Admins');
$zaehl();
assert(str_contains($arm, "(\$payload['apply'] ?? false) === true") && str_contains($arm, 'avesmapsFeatureSourcesTakeoverLabelSources($pdo, $userId, !$scharf,'), 'scharf nur mit apply: true, Vorgabe Trockenlauf');
$zaehl();
assert(str_contains($endpunkt, "'takeover_other_sources', 'takeover_label_sources'], true)"), 'die Aktion fragt nach allen Objekten und steht ohne entity_public_id da');
$zaehl();

echo "quellen-label-takeover: {$pruefungen} Pruefungen bestanden\n";
