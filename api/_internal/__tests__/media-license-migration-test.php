<?php

declare(strict_types=1);

/**
 * Der ABNAHMEFALL der Migration. Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-migration-test.php
 *
 * 🔴 Die tragende Zusicherung steht im Abschnitt "kein Bild wechselt seine Sichtbarkeit". Sie ist der
 * Grund, warum die Zuordnung ueberhaupt eine eigene, DB-freie Datei bekommt: eine Migration, die still
 * ein paar hundert Wappen abschaltet, ist von einer geglueckten nicht zu unterscheiden, bis es
 * jemandem auffaellt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../media-license-migration.php';

// ---- die Zuordnung je Flaeche ---------------------------------------------------------------------
// 💣 Sie ist NICHT global: 'own' heisst bei den Siedlungs-Wappen "von einem Editor hochgeladen" und
// die Editoren haben diese Wappen mit KI erzeugt (Owner 16.08.2026) -- derselbe String bei einer
// anderen Flaeche hiesse nichts dergleichen. Deshalb traegt jede Zuordnung ihre Flaeche.
assert(avesmapsMediaLicenseMigrateLegacy('settlement_coat', 'own') === 'ai_generated');
assert(avesmapsMediaLicenseMigrateLegacy('settlement_coat', 'public_domain') === 'public_domain');
assert(avesmapsMediaLicenseMigrateLegacy('settlement_coat', '') === 'unknown_other');

assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', 'attribution_required') === 'cc_by');
assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', 'unknown') === 'unknown_other');
assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', 'public_domain') === 'public_domain');
assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', null) === 'unknown_other');

// Cover hatten ueberhaupt kein Feld -- der Lauf setzt den Wert, die Zuordnung liefert ihn.
assert(avesmapsMediaLicenseMigrateLegacy('cover', '') === 'permission_granted');
assert(avesmapsMediaLicenseMigrateLegacy('cover', null) === 'permission_granted');

// Siedlungsbilder und Stadtkarten tragen bereits Katalogwerte: unveraendert durchreichen.
foreach (['public_domain', 'cc0', 'ai_generated', 'unknown_other'] as $wert) {
    assert(avesmapsMediaLicenseMigrateLegacy('settlement_image', $wert) === $wert);
}
foreach (['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'own_work', 'unknown_other'] as $wert) {
    assert(avesmapsMediaLicenseMigrateLegacy('citymap', $wert) === $wert);
}
// Ein leeres Siedlungsbild ist historisch ai_generated (Legacy-Strings zaehlten so, map-features.php:408).
assert(avesmapsMediaLicenseMigrateLegacy('settlement_image', '') === 'ai_generated');

// ---- Idempotenz ------------------------------------------------------------------------------------
// 🔴 Der Lauf ist resumierbar und darf abbrechen und neu starten duerfen. Ein zweiter Durchgang ueber
// bereits zugeordnete Zeilen muss folgenlos sein -- sonst waere jeder Wiederanlauf ein Datenrisiko.
foreach (AVESMAPS_MEDIA_LICENSE_SURFACES as $flaeche) {
    foreach (AVESMAPS_MEDIA_LICENSES as $kennung) {
        assert(
            avesmapsMediaLicenseMigrateLegacy($flaeche, $kennung) === $kennung,
            "nicht idempotent: {$flaeche}/{$kennung}"
        );
    }
}

// ---- eine unbekannte Flaeche ist ein Programmierfehler, kein Datenfall ------------------------------
// 💣 Sie faellt auf unknown_other = NICHT oeffentlich. Faellt sie auf etwas Oeffentliches, macht ein
// Tippfehler im Flaechennamen stillschweigend Bilder sichtbar.
assert(avesmapsMediaLicenseMigrateLegacy('gibtsnicht', 'own') === 'unknown_other');
assert(avesmapsMediaLicenseMigrateLegacy('gibtsnicht', 'public_domain') === 'public_domain');

// ---- KEIN BILD WECHSELT SEINE SICHTBARKEIT ---------------------------------------------------------
// 🔴 DER ABNAHMEFALL. Fuer jeden Altwert jeder Flaeche: war er vorher sichtbar, ist er es nachher --
// und war er unsichtbar, bleibt er es. avesmapsMediaLicenseLegacyWasPublic bildet den Zustand VOR
// dieser Phase ab, mit den Gates, wie sie am 16.08.2026 tatsaechlich standen.
$bestand = [
    // Flaeche            Altwert                  war sichtbar?
    ['settlement_coat',   'own',                   true],   // ⚠️ ungegated: JEDER Wert war sichtbar
    ['settlement_coat',   'public_domain',         true],
    ['settlement_coat',   '',                      false],  // ohne coat-Objekt gibt es kein Bild
    ['territory_coat',    'public_domain',         true],   // das Gate liess nur diesen durch
    ['territory_coat',    'attribution_required',  false],
    ['territory_coat',    'unknown',               false],
    ['territory_coat',    '',                      false],
    ['settlement_image',  'public_domain',         true],
    ['settlement_image',  'cc0',                   true],
    ['settlement_image',  'ai_generated',          true],
    ['settlement_image',  'unknown_other',         false],
    ['citymap',           'public_domain',         true],
    ['citymap',           'cc0',                   true],
    ['citymap',           'ai_generated',          true],
    ['citymap',           'permission_granted',    true],
    ['citymap',           'own_work',              true],
    ['citymap',           'unknown_other',         false],
    ['cover',             '',                      true],   // ⚠️ kein Feld, kein Gate: immer sichtbar
];
foreach ($bestand as [$flaeche, $altwert, $warSichtbar]) {
    assert(
        avesmapsMediaLicenseLegacyWasPublic($flaeche, $altwert) === $warSichtbar,
        "Vorher-Zustand falsch abgebildet: {$flaeche}/{$altwert}"
    );
    $neu = avesmapsMediaLicenseMigrateLegacy($flaeche, $altwert);
    assert(
        avesmapsMediaLicenseIsPublic($neu) === $warSichtbar,
        "SICHTBARKEIT GEWECHSELT: {$flaeche}/{$altwert} -> {$neu}"
    );
}

echo "media-license-migration-test: OK (" . count($bestand) . " Bestandsfaelle, keiner wechselt die Sichtbarkeit)\n";
