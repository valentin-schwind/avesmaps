<?php

declare(strict_types=1);

/**
 * DIE NUTZLAST TRAEGT `ecosystem` (Schritt 5 des Quellen-Umbaus, 03.09.2026).
 *
 * Ohne den Typ in AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES reisten die umgezogenen Verweise nie zum Browser -- die
 * Falle der leeren Flaechenkaesten vom 26.08.2026, andersherum. Und das Kanon-Etikett entsteht je Schluessel aus den
 * Verweisen, bekommt `ecosystem:<id>` also von selbst.
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/quellen-landschaft-nutzlast-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

function avesmapsNextMapRevision(PDO $pdo): int
{
    return 1;
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

assert(in_array('ecosystem', AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES, true), 'ecosystem reist in der Nutzlast -- Katalog und Verweise teilen die Liste');
$zaehl();
foreach (['settlement', 'region', 'path', 'territory', 'powerline', 'citymap'] as $typ) {
    assert(in_array($typ, AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES, true), 'die bisherigen Typen bleiben: ' . $typ);
}
$zaehl();

// Das Kanon-Etikett je Schluessel: eine Flaeche mit offizieller Quelle bekommt ihr Etikett wie jedes Objekt.
$katalog = [7 => ['label' => 'Aventurischer Atlas', 'type' => 'regionalspielhilfe', 'official' => true], 8 => ['label' => 'Briefspiel', 'type' => 'sonstiges', 'official' => false]];
$refs = ['ecosystem:flaeche-1' => [['source_id' => 7]], 'region:label-frei' => [['source_id' => 8]]];
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, $refs);
assert(isset($kanon['ecosystem:flaeche-1']), 'die Flaeche bekommt ihr Etikett unter ihrem Schluessel');
$zaehl();
assert(isset($kanon['region:label-frei']), 'das freie Label ebenso');
$zaehl();
assert(($kanon['ecosystem:flaeche-1']['kanon'] ?? $kanon['ecosystem:flaeche-1']['status'] ?? '') !== ($kanon['region:label-frei']['kanon'] ?? $kanon['region:label-frei']['status'] ?? '')
    || json_encode($kanon['ecosystem:flaeche-1']) !== json_encode($kanon['region:label-frei']),
    'offiziell und inoffiziell unterscheiden sich -- die Ableitung liest die Verweise, nicht den Typ');
$zaehl();

echo "quellen-landschaft-nutzlast: {$pruefungen} Pruefungen bestanden\n";
