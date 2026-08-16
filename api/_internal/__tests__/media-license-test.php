<?php

declare(strict_types=1);

/**
 * Unit-Test des gemeinsamen Lizenzkatalogs. Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 *
 * 💣 Die tragende Zusicherung steht im Abschnitt "unbekannt ist nie oeffentlich". Alles andere
 * hier waere Komfort; jene eine Zeile ist der rechtliche Riegel des ganzen Systems.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../media-license.php';

// ---- der Katalog selbst ---------------------------------------------------------------------------
// Die Reihenfolge IST die Anzeigereihenfolge des Auswahlfelds (Entwurf §2) und deshalb Teil des
// Vertrags, nicht bloss eine Schreibweise: der Paritaetstest auf der JS-Seite vergleicht sie Stelle
// fuer Stelle.
assert(AVESMAPS_MEDIA_LICENSES === [
    'unknown_other', 'public_domain', 'cc0', 'cc_by', 'permission_granted', 'ai_generated', 'own_work',
]);
assert(AVESMAPS_MEDIA_LICENSES_PUBLIC === [
    'public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work',
]);

// Jede Kennung hat genau eine Beschriftung, und keine Beschriftung steht ohne Kennung da.
assert(array_keys(AVESMAPS_MEDIA_LICENSE_LABELS) === AVESMAPS_MEDIA_LICENSES);
foreach (AVESMAPS_MEDIA_LICENSE_LABELS as $kennung => $beschriftung) {
    assert(trim($beschriftung) !== '', "Beschriftung fehlt fuer {$kennung}");
}

// Die oeffentliche Liste ist eine echte TEILMENGE -- ein Tippfehler dort waere sonst ein Wert, den
// niemand waehlen kann, der aber als oeffentlich gilt.
foreach (AVESMAPS_MEDIA_LICENSES_PUBLIC as $kennung) {
    assert(in_array($kennung, AVESMAPS_MEDIA_LICENSES, true), "{$kennung} steht nicht im Katalog");
}

// ---- Normalisierung -------------------------------------------------------------------------------
assert(avesmapsMediaLicenseNormalize('cc_by') === 'cc_by');
assert(avesmapsMediaLicenseNormalize('  cc0  ') === 'cc0');           // Randweiss (Spaltenwerte kommen roh)
assert(avesmapsMediaLicenseNormalize('') === 'unknown_other');
assert(avesmapsMediaLicenseNormalize(null) === 'unknown_other');
assert(avesmapsMediaLicenseNormalize(42) === 'unknown_other');        // kein String -> Vorgabe
assert(avesmapsMediaLicenseNormalize([]) === 'unknown_other');
assert(avesmapsMediaLicenseNormalize('CC0') === 'unknown_other');     // Kennungen sind kleingeschrieben
assert(avesmapsMediaLicenseNormalize('voellig_erfunden') === 'unknown_other');

// Jede Flaeche bringt ihre eigene Vorgabe mit (Entwurf §7): Karten unknown_other, Bilder und
// Siedlungs-Wappen ai_generated, Territoriums-Wappen public_domain, Cover permission_granted.
assert(avesmapsMediaLicenseNormalize('', 'ai_generated') === 'ai_generated');
assert(avesmapsMediaLicenseNormalize('quatsch', 'permission_granted') === 'permission_granted');
assert(avesmapsMediaLicenseNormalize('cc0', 'ai_generated') === 'cc0'); // gueltiger Wert schlaegt Vorgabe

// 💣 Auch die VORGABE wird normalisiert. Ein Aufrufer mit einem Tippfehler in seiner Vorgabe
// bekommt unknown_other, nicht seinen Tippfehler zurueckgereicht -- sonst wanderte ein
// Katalogfremder Wert ueber den Umweg der Vorgabe in die Datenbank.
assert(avesmapsMediaLicenseNormalize('', 'ai_generatd') === 'unknown_other');

// ---- unbekannt ist NIE oeffentlich ----------------------------------------------------------------
// 🔴 DIE tragende Zusicherung. avesmapsMediaLicenseIsPublic nimmt bewusst KEINE Vorgabe entgegen:
// duerfte ein Aufrufer hier 'ai_generated' als Rueckfall setzen, machte jeder unbekannte String das
// Bild oeffentlich -- genau die Umkehrung, vor der citymap-image.php:190-191 warnt.
assert(avesmapsMediaLicenseIsPublic('public_domain') === true);
assert(avesmapsMediaLicenseIsPublic('cc0') === true);
assert(avesmapsMediaLicenseIsPublic('permission_granted') === true);
assert(avesmapsMediaLicenseIsPublic('ai_generated') === true);
assert(avesmapsMediaLicenseIsPublic('own_work') === true);
assert(avesmapsMediaLicenseIsPublic('cc_by') === false);
assert(avesmapsMediaLicenseIsPublic('unknown_other') === false);
assert(avesmapsMediaLicenseIsPublic('') === false);
assert(avesmapsMediaLicenseIsPublic(null) === false);
assert(avesmapsMediaLicenseIsPublic('voellig_erfunden') === false);
assert(avesmapsMediaLicenseIsPublic('PUBLIC_DOMAIN') === false);

// ---- Beschriftungen -------------------------------------------------------------------------------
assert(avesmapsMediaLicenseLabel('cc_by') === 'CC-BY');
assert(avesmapsMediaLicenseLabel('own_work') === 'Eigene Kreation');
assert(avesmapsMediaLicenseLabel('voellig_erfunden') === 'Unbekannt/Sonstiges'); // ueber die Vorgabe

// ---- der Vorschlagstext ---------------------------------------------------------------------------
// Er ist Teil des Katalogs, weil er sonst in fuenf Dialogen einzeln abgeschrieben wuerde.
assert(str_contains(AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE, 'ohne Namensnennung'));

echo "media-license-test: OK\n";
