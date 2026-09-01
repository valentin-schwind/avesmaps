<?php

declare(strict_types=1);

/**
 * Einen eigenen Knoten an einen Wiki-Artikel binden.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll \
 *     api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../political/territory.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-monitor-identity.php';
require_once __DIR__ . '/../eigener-knoten-wiki-bindung.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

// ---- Teil 1: die Vorbelegung der Vorschau, ohne Datenbank -------------------------------------

// Der echte Fall Táyârret: Hauptstadt gleich, Status abweichend, Oberhaupt bei uns leer.
$vorschau = avesmapsEigenerKnotenBindungVorschau(
    ['name' => 'Táyârret', 'status' => "Tă'akîb (Baronie)", 'capital_name' => 'Djáset'],
    ['name' => 'Táyârret', 'status' => '', 'capital_name' => 'Djáset', 'ruler' => 'Hékatet ni Chentasû',
     'population' => '400', 'type' => "Tá'akîb"]
);
$nach = [];
foreach ($vorschau as $zeile) {
    $nach[$zeile['field']] = $zeile;
}

pruefe($nach['capital_name']['state'] === 'gleich', 'Gleiche Werte heissen "gleich".');
pruefe($nach['capital_name']['default_checked'] === true,
    'Ein gleicher Wert ist VORANGEHAKT -- sonst kaeme aus dem Wiki nie etwas an.');

pruefe($nach['ruler']['state'] === 'luecke', 'Bei uns leer, im Wiki gefuellt = "luecke".');
pruefe($nach['ruler']['default_checked'] === true, 'Eine Luecke ist vorangehakt.');
pruefe($nach['ruler']['own'] === '', 'Und die eigene Seite ist leer.');

pruefe($nach['status']['state'] === 'abweichend',
    'Handwert gegen leeres Wiki-Feld ist eine ABWEICHUNG, keine Luecke.');
pruefe($nach['status']['default_checked'] === false,
    'Eine Abweichung ist NICHT vorangehakt -- Handarbeit wird nie stillschweigend geworfen.');

pruefe($nach['name']['label'] === 'Anzeigename',
    'Das Label kommt aus avesmapsWikiSyncMonitorEditableFields, nicht aus einer zweiten Liste.');

// 💣 Beide Seiten leer ist KEINE Zeile: sonst steht die Vorschau voll mit Feldern, ueber die
// niemand etwas zu entscheiden hat, und die drei echten gehen darin unter.
pruefe(!isset($nach['currency']), 'Beidseitig leere Felder stehen gar nicht erst in der Vorschau.');

// ⚠️ Nur die bearbeitbaren Felder. Ein Wiki-Feld ohne Eintrag in der Allowlist hat kein Ziel.
$fremd = avesmapsEigenerKnotenBindungVorschau([], ['gibtsnicht' => 'x', 'ruler' => 'Y']);
pruefe(count($fremd) === 1 && $fremd[0]['field'] === 'ruler',
    'Ein Feld ausserhalb der Allowlist wird nicht angeboten.');

// Leerraum entscheidet nicht mit -- sonst waere " Djáset" eine Abweichung.
$getrimmt = avesmapsEigenerKnotenBindungVorschau(['capital_name' => '  Djáset '], ['capital_name' => 'Djáset']);
pruefe($getrimmt[0]['state'] === 'gleich', 'Verglichen wird getrimmt.');

echo "eigener-knoten-wiki-bindung: {$checks} Zusicherungen gruen.\n";
