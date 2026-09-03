<?php

declare(strict_types=1);

/**
 * DIE QUELLEN WANDERN ZUR FLAECHE (Schritt 5 des Quellen-Umbaus, 03.09.2026).
 *
 * Die Flaeche traegt die Quellen, die Beschriftung zeigt sie. avesmapsFeatureSourcesMoveLabelToRegion zieht die
 * Zeilen `(region, <label>)` nach `(ecosystem, <region>)`; was die Flaeche schon hat, faellt am Label -- per DELETE,
 * dann glattes UPDATE (kein Upsert: MySQL und SQLite reden dort verschieden, AGENTS.md §9).
 *
 * Geprueft werden, gegen SQLite:
 *   1. der Umzug samt Dubletten, alle Zustaende, Seiten/Abdeckung der Flaeche gewinnen
 *   2. leere Kennungen tun nichts; ein Label ohne Quellen tut nichts
 *   3. die Server-Weiche avesmapsEcosystemLabelSourceTarget
 *   4. BEIDE Zeiger-Schreiber rufen den Umzug (Quelltext): update_label in features.php und
 *      avesmapsEcosystemAdoptLabelPointer in ecosystem.php -- eine Regel, die einen von zwei bindet, ist keine
 *   5. update_label wandert nur bei GEAENDERTER Bindung, und innerhalb der Transaktion
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-zur-flaeche-test.php
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
require_once __DIR__ . '/../ecosystem-label-link.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
$q = $pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution) VALUES (?, ?, ?, ?, ?, 0, ?, ?)');
foreach ([7, 8, 9] as $id) {
    $q->execute([$id, 'https://x/' . $id, str_repeat((string) $id, 64), 'Quelle ' . $id, 'sonstiges', '', '']);
}
$link = $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages)
    VALUES (:t, :id, :sid, :st, :o, :rk, :p)");
// Die Flaeche hat 7 schon (mit Seiten „S. 1“); das Label hat 7 (andere Seiten), 8 (approved) und 9 (Grabstein des Abgleichs).
$link->execute(['t' => 'ecosystem', 'id' => 'flaeche-1', 'sid' => 7, 'st' => 'approved', 'o' => 'manual', 'rk' => 'ausfuehrlich', 'p' => 'S. 1']);
$link->execute(['t' => 'region', 'id' => 'label-1', 'sid' => 7, 'st' => 'approved', 'o' => 'manual', 'rk' => null, 'p' => 'S. 99']);
$link->execute(['t' => 'region', 'id' => 'label-1', 'sid' => 8, 'st' => 'approved', 'o' => 'wiki_publication', 'rk' => 'ergaenzend', 'p' => 'S. 5']);
$link->execute(['t' => 'region', 'id' => 'label-1', 'sid' => 9, 'st' => 'suppressed', 'o' => 'wiki_publication', 'rk' => null, 'p' => null]);
// Ein freies Label bleibt unberuehrt.
$link->execute(['t' => 'region', 'id' => 'label-frei', 'sid' => 8, 'st' => 'approved', 'o' => 'manual', 'rk' => null, 'p' => null]);

$zeilen = static function (PDO $pdo, string $t, string $id): array {
    $s = $pdo->prepare('SELECT source_id, status, origin, pages FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id ORDER BY source_id');
    $s->execute(['t' => $t, 'id' => $id]);
    return $s->fetchAll(PDO::FETCH_ASSOC);
};

// ── 1) Der Umzug ──────────────────────────────────────────────────────────────────────────────
$r = avesmapsFeatureSourcesMoveLabelToRegion($pdo, 'label-1', 'flaeche-1');
assert($r === ['moved' => 2, 'dropped' => 1], 'zwei wandern (8 und der Grabstein 9), eine faellt (7 hat die Flaeche schon): ' . json_encode($r));
$zaehl();
assert($zeilen($pdo, 'region', 'label-1') === [], 'am Label bleibt nichts');
$zaehl();
$flaeche = $zeilen($pdo, 'ecosystem', 'flaeche-1');
assert(array_column($flaeche, 'source_id') == [7, 8, 9], 'die Flaeche traegt 7, 8 und 9: ' . json_encode($flaeche));
$zaehl();
assert($flaeche[0]['pages'] === 'S. 1', 'bei der Dublette gewinnen Seiten und Abdeckung der Flaeche -- die Zeile des Labels ist gefallen, nicht umgeschrieben');
$zaehl();
assert($flaeche[2]['status'] === 'suppressed' && $flaeche[2]['origin'] === 'wiki_publication', 'der Grabstein des Abgleichs wandert MIT seinem Zustand -- er gehoert zur Landschaft');
$zaehl();
assert($zeilen($pdo, 'region', 'label-frei') !== [], 'ein freies Label bleibt unberuehrt');
$zaehl();
assert($GLOBALS['avesmapsTestRevisionBumps'] === 0, 'der Umzug bumpt keine Revision -- das entscheiden die Aufrufer');
$zaehl();

// ── 2) Nichts zu tun ──────────────────────────────────────────────────────────────────────────
assert(avesmapsFeatureSourcesMoveLabelToRegion($pdo, '', 'flaeche-1') === ['moved' => 0, 'dropped' => 0], 'ohne Label nichts');
assert(avesmapsFeatureSourcesMoveLabelToRegion($pdo, 'label-1', ' ') === ['moved' => 0, 'dropped' => 0], 'ohne Flaeche nichts');
assert(avesmapsFeatureSourcesMoveLabelToRegion($pdo, 'label-ohne', 'flaeche-1') === ['moved' => 0, 'dropped' => 0], 'ein Label ohne Quellen: nichts, kein Fehler');
$zaehl();

// ── 3) Die Server-Weiche ──────────────────────────────────────────────────────────────────────
assert(avesmapsEcosystemLabelSourceTarget('flaeche-1', 'label-1') === ['entity_type' => 'ecosystem', 'entity_public_id' => 'flaeche-1'], 'gebunden: die Flaeche');
assert(avesmapsEcosystemLabelSourceTarget(null, 'label-1') === ['entity_type' => 'region', 'entity_public_id' => 'label-1'], 'frei: das Label');
assert(avesmapsEcosystemLabelSourceTarget('  ', 'label-1')['entity_type'] === 'region', 'ein leerer Zeiger ist keiner');
$zaehl();

// ── 4) Beide Zeiger-Schreiber rufen den Umzug ─────────────────────────────────────────────────
$ohneKommentare = static function (string $pfad): string {
    $aus = '';
    foreach (token_get_all((string) file_get_contents($pfad)) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $aus .= $token[1];
        } else {
            $aus .= $token;
        }
    }
    return str_replace("\r\n", "\n", $aus);
};
$features = $ohneKommentare(__DIR__ . '/../../map/features.php');
$eco = $ohneKommentare(__DIR__ . '/../ecosystem.php');
$schnitt = static function (string $quelle, string $kopf): string {
    $s = strpos($quelle, $kopf);
    assert($s !== false, 'Funktion fehlt: ' . $kopf);
    $e = strpos($quelle, "\nfunction ", $s + 10);
    return substr($quelle, $s, ($e === false ? strlen($quelle) : $e) - $s);
};
$updateLabel = $schnitt($features, 'function avesmapsUpdateLabelFeature(');
assert(str_contains($updateLabel, 'avesmapsFeatureSourcesMoveLabelToRegion($pdo, $publicId, $regionNachher);'), 'update_label wandert die Quellen beim Binden');
$zaehl();
assert(str_contains($updateLabel, "if (\$regionNachher !== '' && \$regionNachher !== \$regionVorher) {"), '… nur bei GEAENDERTER Bindung -- ein Speichern ohne Wechsel zieht nichts um');
$zaehl();
assert(strpos($updateLabel, 'avesmapsFeatureSourcesMoveLabelToRegion(') > strpos($updateLabel, '$pdo->beginTransaction();')
    && strpos($updateLabel, 'avesmapsFeatureSourcesMoveLabelToRegion(') < strpos($updateLabel, '$pdo->commit();'),
    '… innerhalb der Transaktion: ein gescheiterter Umzug nimmt die Bindung mit');
$zaehl();
$adopt = $schnitt($eco, 'function avesmapsEcosystemAdoptLabelPointer(');
assert(str_contains($adopt, 'avesmapsFeatureSourcesMoveLabelToRegion($pdo, $labelPublicId, $regionPublicId);'), 'der zweite Zeiger-Schreiber (Panel, Flaeche nennt ihr Label) ruft DENSELBEN Umzug');
$zaehl();
assert(substr_count($features . $eco, 'avesmapsFeatureSourcesMoveLabelToRegion(') === 2, 'genau die zwei Zeiger-Schreiber -- wer einen dritten baut, traegt ihn hier ein');
$zaehl();

echo "quellen-zur-flaeche: {$pruefungen} Pruefungen bestanden\n";
