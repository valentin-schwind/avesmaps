<?php

declare(strict_types=1);

/**
 * DER VERTEILER: die Quellen eines Weges ueber seine Abschnitte.
 *
 * Ein Weg liegt auf der Karte in Abschnitten, und die Quelle haengt am ABSCHNITT (map_features.public_id);
 * die Gruppe ist ein Verteiler, keine Ablage. Entwurf: docs/superpowers/specs/2026-09-03-quellen-wege-design.md.
 *
 * Geprueft werden, gegen SQLite:
 *   1. avesmapsFeatureSourceDistributionIds -- wann verteilt wird, und die Riegel (nur path, Deckel, Anker vorn)
 *   2. avesmapsListFeatureSourcesForEditMany -- je Katalogzeile EINE Zeile, `segments`/`segments_of`,
 *      der Anker gewinnt bei Seiten und Abdeckung, `by_entity` je Kennung, `revision` null
 *   3. Eintragen und Entfernen ueber die Kennungen -- die Bibliotheksfunktionen je Kennung, wie der Endpunkt sie ruft
 *   4. der herausgeloeste Zeilenbauer liefert der Einzelliste dieselbe Form wie vorher
 *   5. der Endpunkt verteilt alle vier schreibenden Aktionen UND die Liste (Quelltext, kommentarfrei)
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-verteiler-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
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

function avesmapsVerteilerTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    avesmapsEnsureFeatureSourceTables($pdo);
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, is_active INTEGER,
        properties_json TEXT, revision INTEGER)');
    foreach (['seg-a', 'seg-b', 'seg-c'] as $i => $id) {
        $pdo->prepare("INSERT INTO map_features (public_id, is_active, properties_json, revision) VALUES (:id, 1, :p, 1)")
            ->execute(['id' => $id, 'p' => $i === 0 ? '{"wiki_url":"https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2"}' : '{}']);
    }
    $pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution)
        VALUES (7, :u, :h, :l, :t, 1, :lic, :a)')->execute([
        'u' => 'https://beispiel.de/atlas', 'h' => str_repeat('a', 64), 'l' => 'Aventurischer Atlas', 't' => 'regionalspielhilfe', 'lic' => '', 'a' => '',
    ]);
    $pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution)
        VALUES (8, :u, :h, :l, :t, 0, :lic, :a)')->execute([
        'u' => 'https://www.westlande.de/index.php?title=Reichsstrasse_2', 'h' => str_repeat('b', 64), 'l' => 'Reichsstraße 2 (Albernia Wiki)', 't' => 'fanwiki', 'lic' => '', 'a' => '',
    ]);
    // Quelle 7 an a UND b (verschiedene Seiten), Quelle 8 nur an c.
    $link = $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages)
        VALUES ('path', :id, :sid, 'approved', 'manual', :rk, :p)");
    $link->execute(['id' => 'seg-a', 'sid' => 7, 'rk' => 'ausfuehrlich', 'p' => 'S. 1']);
    $link->execute(['id' => 'seg-b', 'sid' => 7, 'rk' => null, 'p' => 'S. 2']);
    $link->execute(['id' => 'seg-c', 'sid' => 8, 'rk' => null, 'p' => null]);

    return $pdo;
}

/** Die Verknuepfungs-Einfuegung der Fixture, fuer Teil 3. */
function avesmapsVerteilerTestLink(PDO $pdo): PDOStatement
{
    return $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages)
        VALUES ('path', :id, :sid, 'approved', 'manual', :rk, :p)");
}

$ids = ['seg-a', 'seg-b', 'seg-c'];
$nachId = static function (array $antwort): array {
    $out = [];
    foreach ($antwort['sources'] as $s) {
        $out[(int) $s['source_id']] = $s;
    }
    return $out;
};

// ── 1) Wann verteilt wird ─────────────────────────────────────────────────────────────────────
assert(avesmapsFeatureSourceDistributionIds(null, 'seg-a', 'path') === [], 'ohne Liste wird nichts verteilt');
$zaehl();
assert(avesmapsFeatureSourceDistributionIds(['seg-a'], 'seg-a', 'path') === [], 'eine Liste, die nur den Anker nennt, verteilt nichts -- ein einteiliger Weg ist ein Objekt wie jedes');
$zaehl();
assert(avesmapsFeatureSourceDistributionIds(['seg-b', ' seg-c ', 'seg-b', ''], 'seg-a', 'path') === ['seg-a', 'seg-b', 'seg-c'],
    'der Anker steht vorn, Dubletten und Leeres fallen heraus');
$zaehl();
assert(avesmapsFeatureSourceDistributionIds(['seg-a', 'seg-b'], 'seg-a', 'path') === ['seg-a', 'seg-b'], 'ein Anker in der Liste wird nicht verdoppelt');
$zaehl();
$abgelehnt = false;
try {
    avesmapsFeatureSourceDistributionIds(['ort-2'], 'ort-1', 'settlement');
} catch (InvalidArgumentException) {
    $abgelehnt = true;
}
assert($abgelehnt, 'NUR path verteilt -- bei jeder anderen Objektart waere die Liste ein Schlupfloch, um an fremden Objekten zu schreiben');
$zaehl();
$abgelehnt = false;
try {
    avesmapsFeatureSourceDistributionIds(array_map(static fn (int $i): string => 'seg-' . $i, range(1, 251)), 'seg-0', 'path');
} catch (InvalidArgumentException) {
    $abgelehnt = true;
}
assert($abgelehnt, 'gedeckelt wie das Sammel-Speichern der Weg-Ebene (250)');
$zaehl();
$abgelehnt = false;
try {
    avesmapsFeatureSourceDistributionIds([['seg-b']], 'seg-a', 'path');
} catch (InvalidArgumentException) {
    $abgelehnt = true;
}
assert($abgelehnt, 'eine Kennung ist eine Zeichenkette, nichts anderes');
$zaehl();

// ── 2) Die Sammelliste ────────────────────────────────────────────────────────────────────────
$pdo = avesmapsVerteilerTestPdo();
$viele = avesmapsListFeatureSourcesForEditMany($pdo, 'path', $ids, 'seg-a', 1);
assert($viele['ok'] === true && count($viele['sources']) === 2, 'je Katalogzeile EINE Zeile: 7 (an a und b) und 8 (an c)');
$zaehl();
$zeilen = $nachId($viele);
assert($zeilen[7]['segments'] === 2 && $zeilen[7]['segments_of'] === 3, 'Quelle 7 haengt an 2 von 3 Abschnitten');
assert($zeilen[8]['segments'] === 1 && $zeilen[8]['segments_of'] === 3, 'Quelle 8 an 1 von 3');
$zaehl();
assert($zeilen[7]['pages'] === 'S. 1' && $zeilen[7]['reference_kind'] === 'ausfuehrlich',
    'Seiten und Abdeckung kommen von der Zeile des ANKERS (seg-a), nicht von der ersten in der Datenbank');
$zaehl();
$vonB = $nachId(avesmapsListFeatureSourcesForEditMany($pdo, 'path', $ids, 'seg-b', 1));
assert($vonB[7]['pages'] === 'S. 2' && $vonB[7]['reference_kind'] === '', 'mit seg-b als Anker gewinnt dessen Zeile');
$zaehl();
$vonC = $nachId(avesmapsListFeatureSourcesForEditMany($pdo, 'path', $ids, 'seg-c', 1));
assert(isset($vonC[7]) && in_array($vonC[7]['pages'], ['S. 1', 'S. 2'], true), 'haengt die Quelle nicht am Anker, traegt die Zeile die erste Fundstelle');
$zaehl();
assert($viele['segments_of'] === 3 && $viele['revision'] === null, 'segments_of ist die Zahl der Kennungen; ein Sperrtoken gehoert EINEM Objekt, also null');
$zaehl();
$byEntity = (array) $viele['by_entity'];
assert(array_keys($byEntity) === $ids, 'by_entity nennt JEDE Kennung, auch eine ohne Quelle');
assert(array_column($byEntity['seg-a'], 'source_id') === [7] && $byEntity['seg-a'][0]['pages'] === 'S. 1', 'seg-a: Quelle 7 mit S. 1');
assert(array_column($byEntity['seg-b'], 'source_id') === [7] && $byEntity['seg-b'][0]['pages'] === 'S. 2', 'seg-b: Quelle 7 mit S. 2');
assert(array_column($byEntity['seg-c'], 'source_id') === [8], 'seg-c: nur Quelle 8 -- nie die Vereinigung');
$zaehl();
assert($viele['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2', 'der Wiki-Link ist der des Ankers');
$zaehl();
assert(is_object($viele['by_entity']), 'by_entity ist ein Objekt, damit der Browser by_entity[id] liest -- auch wenn es leer waere');
$zaehl();
$leer = avesmapsListFeatureSourcesForEditMany($pdo, 'path', [], 'seg-a', 1);
assert(count($leer['sources']) === 1 && $leer['segments_of'] === 1, 'ohne Liste ist die Sammelliste die des Ankers');
$zaehl();

// ── 3) Eintragen und Entfernen ueber die Kennungen ────────────────────────────────────────────
// ⚠️ Das Eintragen selbst (avesmapsLinkExistingFeatureSource → avesmapsFeatureSourceLink) ist ein MySQL-Upsert
// (ON DUPLICATE KEY UPDATE) und laeuft nicht auf SQLite; dass der Endpunkt es je Kennung ruft, prueft Teil 5
// am Quelltext. Hier werden die Zeilen gesetzt, wie sie danach liegen, und die Sammelliste liest sie.
$link = avesmapsVerteilerTestLink($pdo);
foreach (['seg-a', 'seg-b'] as $id) {
    $link->execute(['id' => $id, 'sid' => 8, 'rk' => 'ergaenzend', 'p' => 'S. 9']);
}
$danach = $nachId(avesmapsListFeatureSourcesForEditMany($pdo, 'path', $ids, 'seg-a', 1));
assert($danach[8]['segments'] === 3 && $danach[8]['segments_of'] === 3, 'an allen dreien: 3 von 3 -- und damit ohne Marke');
assert($danach[8]['pages'] === 'S. 9' && $danach[8]['reference_kind'] === 'ergaenzend', 'die Fundstellenfelder des Ankers kamen mit');
$zaehl();
avesmapsRemoveFeatureSource($pdo, 'path', 'seg-b', 8, 1);
$einer = $nachId(avesmapsListFeatureSourcesForEditMany($pdo, 'path', $ids, 'seg-a', 1));
assert($einer[8]['segments'] === 2, '✕ am Abschnitt nimmt die Quelle NUR dort weg');
$zaehl();
foreach ($ids as $id) {
    avesmapsRemoveFeatureSource($pdo, 'path', $id, 8, 1);
}
$keine = $nachId(avesmapsListFeatureSourcesForEditMany($pdo, 'path', $ids, 'seg-a', 1));
assert(!isset($keine[8]), '✕ auf der Weg-Ebene nimmt sie von allen -- auch von einem, der sie nicht mehr hatte, ohne Fehler');
$zaehl();

// ── 4) Der herausgeloeste Zeilenbauer: die Einzelliste hat dieselbe Form wie vorher ───────────
$einzel = avesmapsListFeatureSourcesForEdit($pdo, 'path', 'seg-a', 1);
$sammel = avesmapsListFeatureSourcesForEditMany($pdo, 'path', ['seg-a'], 'seg-a', 1);
$ohneZaehler = static function (array $s): array { unset($s['segments'], $s['segments_of']); return $s; };
assert(array_map($ohneZaehler, $sammel['sources']) === $einzel['sources'],
    'Einzel- und Sammelliste bauen ihre Zeilen mit DEMSELBEN Bauer -- bis auf den Zaehler zeichengleich');
$zaehl();
foreach (['corpus', 'source_id', 'url', 'label', 'type', 'official', 'origin', 'pages', 'reference_kind', 'license', 'attribution', 'usage_count', 'wiki_owned', 'own_fields', 'created'] as $feld) {
    assert(array_key_exists($feld, $einzel['sources'][0]), 'die Einzelliste traegt weiterhin ' . $feld);
}
$zaehl();
assert(!array_key_exists('segments', $einzel['sources'][0]), 'die Einzelliste kennt keinen Zaehler -- die Marke bleibt der Weg-Ebene vorbehalten');
$zaehl();

// ── 5) Der Endpunkt verteilt alle vier schreibenden Aktionen UND die Liste ────────────────────
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
assert(substr_count($endpunkt, 'avesmapsFeatureSourceDistributionIds(') === 1, 'der Endpunkt liest die Kennungen ueber den EINEN Leser');
$zaehl();
assert(substr_count($endpunkt, 'foreach ($entityPublicIds as $id)') === 3, 'add, add_existing und remove laufen je Kennung');
$zaehl();
assert(str_contains($endpunkt, "foreach (\$entityPublicIds === [] ? [\$entityPublicId] : \$entityPublicIds as \$id)"), 'update laeuft je Kennung und bricht beim ersten Fehlschlag ab');
$zaehl();
assert(substr_count($endpunkt, 'avesmapsListFeatureSourcesForEditMany(') === 5, 'list, add, add_existing, update und remove antworten verteilt mit der Sammelliste');
$zaehl();

echo "quellen-verteiler: {$pruefungen} Pruefungen bestanden\n";
