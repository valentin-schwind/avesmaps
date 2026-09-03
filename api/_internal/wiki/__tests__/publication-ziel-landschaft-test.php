<?php

declare(strict_types=1);

/**
 * DER PUBLIKATIONSABGLEICH ZIELT AUF DIE FLAECHE (Schritt 5 des Quellen-Umbaus, 03.09.2026).
 *
 * Die Staging-Seite (`wiki_entity_publication`, entity_type `region`) bleibt; nur das ZIEL in feature_sources
 * wechselt: eine gebundene Beschriftung schreibt an `(ecosystem, <Flaeche>)`, eine freie an `(region, <Label>)`.
 * Ohne diese Abbildung holte der naechste „Syncen“ die 6.811 umgezogenen Verweise zurueck an die Schilder.
 *
 * Geprueft werden:
 *   1. die reine Abbildung avesmapsPublicationMapLabelTargets (Ziel, Zusammenfallen, Cursor-Kennung)
 *   2. dass FetchLiveEntityBatch sie fuer `region` anwendet (Quelltext)
 *   3. dass Reconcile und Plan den Ziel-Typ getrennt vom Staging-Typ fuehren (Signatur + Quelltext) -- und der
 *      Staging-Zugriff den Staging-Typ behaelt (sonst laeuft das „gewuenscht“ leer und loescht alles)
 *   4. dass Schritt, Plan und Plan-Uebernahme das Ziel weiterreichen
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/publication-ziel-landschaft-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../publication-sync.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

// ── 1) Die Abbildung ──────────────────────────────────────────────────────────────────────────
$rows = [
    ['id' => 10, 'public_id' => 'label-a1', 'wiki_key' => 'ochsenwasser', 'name' => 'Ochsenwasser'],
    ['id' => 11, 'public_id' => 'label-frei', 'wiki_key' => 'rakulahoehen', 'name' => 'Rakulahöhen'],
    ['id' => 12, 'public_id' => 'label-a2', 'wiki_key' => 'ochsenwasser', 'name' => 'Ochsenwasser (Ufer)'],
    ['id' => 13, 'public_id' => 'label-b1', 'wiki_key' => 'gruene-ebene', 'name' => 'Grüne Ebene'],
];
$byLabel = ['label-a1' => 'flaeche-A', 'label-a2' => 'flaeche-A', 'label-b1' => 'flaeche-B'];
$ziele = avesmapsPublicationMapLabelTargets($rows, $byLabel);
assert(count($ziele) === 3, 'zwei gebundene Beschriftungen derselben Flaeche mit demselben Artikel fallen auf EIN Ziel zusammen: ' . count($ziele));
$zaehl();
assert($ziele[0]['target_type'] === 'ecosystem' && $ziele[0]['target_public_id'] === 'flaeche-A' && $ziele[0]['public_id'] === 'label-a1',
    'gebunden: Ziel ist die Flaeche, die Kennung der Beschriftung bleibt daneben');
$zaehl();
assert((int) $ziele[0]['id'] === 12, 'die zusammengefallene Zeile traegt die GROESSTE id -- sonst fiele der Cursor hinter die weggefallene Zeile');
$zaehl();
assert($ziele[1]['target_type'] === 'region' && $ziele[1]['target_public_id'] === 'label-frei', 'frei: Ziel bleibt das Label');
$zaehl();
assert($ziele[2]['target_type'] === 'ecosystem' && $ziele[2]['target_public_id'] === 'flaeche-B', 'die zweite Flaeche');
$zaehl();
// Zwei gebundene Beschriftungen derselben Flaeche mit VERSCHIEDENEN Artikeln bleiben zwei Ziele.
$zwei = avesmapsPublicationMapLabelTargets([
    ['id' => 1, 'public_id' => 'x1', 'wiki_key' => 'artikel-1', 'name' => ''],
    ['id' => 2, 'public_id' => 'x2', 'wiki_key' => 'artikel-2', 'name' => ''],
], ['x1' => 'F', 'x2' => 'F']);
assert(count($zwei) === 2, 'verschiedene Artikel derselben Flaeche bleiben getrennt -- der Abgleich laeuft je Artikel');
$zaehl();
assert(avesmapsPublicationMapLabelTargets([], $byLabel) === [], 'leer bleibt leer');
$zaehl();

// ── 2–4) Die Verdrahtung am Quelltext ────────────────────────────────────────────────────────
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
$sync = $ohneKommentare(__DIR__ . '/../publication-sync.php');
$schnitt = static function (string $quelle, string $kopf): string {
    $s = strpos($quelle, $kopf);
    assert($s !== false, 'Funktion fehlt: ' . $kopf);
    $e = strpos($quelle, "\nfunction ", $s + 10);
    return substr($quelle, $s, ($e === false ? strlen($quelle) : $e) - $s);
};
$fetch = $schnitt($sync, 'function avesmapsPublicationFetchLiveEntityBatch(');
assert(str_contains($fetch, "if (\$type === 'region' && \$out !== []) {") && str_contains($fetch, "avesmapsPublicationMapLabelTargets(\$out, avesmapsEcosystemReadLabelRegionMap(\$pdo)['by_label'] ?? [])"),
    'die Live-Charge der Beschriftungen wird auf ihre Flaechen abgebildet -- mit dem EINEN Leser beider Richtungen');
$zaehl();

$writes = $schnitt($sync, 'function avesmapsPublicationReconcileEntityWrites(');
$ref = new ReflectionFunction('avesmapsPublicationReconcileEntityWrites');
$namen = array_map(static fn (ReflectionParameter $p): string => $p->getName(), $ref->getParameters());
assert(in_array('targetType', $namen, true) && $ref->getParameters()[5]->getDefaultValue() === '', 'ReconcileEntityWrites kennt den Ziel-Typ, Vorgabe „derselbe“');
$zaehl();
assert(str_contains($writes, "avesmapsPublicationDesiredLinksForEntity(\$pdo, \$entityType, \$entityWikiKey, \$userId)"),
    'der Staging-Zugriff behaelt den STAGING-Typ -- mit dem Ziel-Typ liefe „gewuenscht“ leer, und der Abgleich loeschte alles');
$zaehl();
assert(substr_count($writes, '$pdo, $targetType, $entityPublicId, (int) $row[\'source_id\'], $userId,') === 2,
    'beide Schreibpfade (add, update) schreiben an den Ziel-Typ');
$zaehl();
assert(str_contains($writes, "\$currentStatement->execute(['t' => \$targetType, 'id' => \$entityPublicId]);")
    && str_contains($writes, '$delete->execute(array_merge([$targetType, $entityPublicId], $ids));'),
    'Bestand lesen und Loeschen ebenfalls am Ziel-Typ');
$zaehl();
$refE = new ReflectionFunction('avesmapsPublicationReconcileEntity');
assert($refE->getParameters()[5]->getName() === 'targetType', 'ReconcileEntity reicht den Ziel-Typ durch');
$zaehl();
$diffPlan = $schnitt($sync, 'function avesmapsPublicationLinkDiffForPlan(');
assert(str_contains($diffPlan, "\$currentStmt->execute(['t' => \$targetType, 'id' => \$entityPublicId]);") && str_contains($diffPlan, "\$wantStmt->execute(['type' => \$entityType, 'ewk' => \$entityWikiKey]);"),
    'die Plan-Vorschau liest den Bestand am Ziel-Typ und „gewuenscht“ am Staging-Typ');
$zaehl();
$step = $schnitt($sync, 'function avesmapsPublicationReconcileStep(');
assert(str_contains($step, "avesmapsPublicationReconcileEntity(\$pdo, \$type, (string) (\$row['target_public_id'] ?? \$publicId), \$wikiKey, \$userId, (string) (\$row['target_type'] ?? \$type));"),
    'der Reconcile-Schritt reicht das Ziel weiter');
$zaehl();
$plan = $schnitt($sync, 'function avesmapsPublicationPlanForEntity(');
assert(str_contains($plan, "avesmapsPublicationLinkDiffForPlan(\$pdo, \$entityType, (string) (\$entity['target_public_id'] ?? \$publicId), \$wikiKey, (string) (\$entity['target_type'] ?? \$entityType))"),
    'die Plan-Vorschau reicht das Ziel weiter');
$zaehl();
$apply = $ohneKommentare(__DIR__ . '/../publication-plan-apply.php');
assert(str_contains($apply, "\$ziel = avesmapsPublicationMapLabelTargets([\$ziel], \$byLabel)[0];")
    && str_contains($apply, "avesmapsPublicationReconcileEntity(\$pdo, \$type, (string) (\$ziel['target_public_id'] ?? \$publicId), \$wikiKey, \$userId, (string) (\$ziel['target_type'] ?? \$type));"),
    'die Plan-Uebernahme loest das Ziel mit DERSELBEN Abbildung auf -- sonst schriebe sie (region, <Flaeche>), eine Zeile, die nichts liest');
$zaehl();

echo "publication-ziel-landschaft: {$pruefungen} Pruefungen bestanden\n";
