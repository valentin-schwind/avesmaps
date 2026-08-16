<?php

declare(strict_types=1);

/**
 * Das Lizenz-Gate der Literatur-Cover (Phase 3, Befund 2). Keine DB, kein HTTP. Ausfuehren vom
 * Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/game-literature-cover-gate-test.php
 *
 * 🔴 Bis 16.08.2026 gab es hier GAR KEIN Gate -- api/edit/map/game-literature-cover.php:12 sagte es
 * selbst ("NO public_domain gate"). Seit Phase 4 bietet der Cover-Dialog alle sieben Katalog-Kennungen
 * an; ein als cc_by eingestuftes Cover erschiene ohne dieses Gate oeffentlich, ohne den bei CC-BY
 * verlangten Namensnennungs-Nachweis. Dieser Test ist die Zusicherung, dass avesmapsGameLiteratureReadCatalog()
 * (der einzige Aufrufer von avesmapsGameLiteratureCoverGatedUrl()) das nicht mehr tut.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../../media-license.php';
require __DIR__ . '/../game-literature.php';

// ---- die fuenf oeffentlichen kommen durch ------------------------------------------------------------
foreach (['public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work'] as $kennung) {
    assert(
        avesmapsGameLiteratureCoverGatedUrl('/uploads/questcovers/a.jpg', $kennung) === '/uploads/questcovers/a.jpg',
        "{$kennung} muesste durchkommen"
    );
}

// ---- die zwei stillen nicht ---------------------------------------------------------------------------
foreach (['cc_by', 'unknown_other'] as $kennung) {
    assert(
        avesmapsGameLiteratureCoverGatedUrl('/uploads/questcovers/a.jpg', $kennung) === '',
        "{$kennung} duerfte NICHT durchkommen"
    );
}

// ---- der Bestand nach der Phase-2-Migration --------------------------------------------------------
// 💣 Phase 2 hat den kompletten Bestand (alle Adventures mit cover_url <> '') auf 'permission_granted'
// eingestuft (media-license-migration-run.php: avesmapsMediaLicenseCollectCovers()) -- die Cover zeigen
// Ulisses-Produktcover unter den Fan-Regeln (NOTICE.md). Kein Bestandscover verschwindet dadurch.
assert(avesmapsGameLiteratureCoverGatedUrl('/uploads/questcovers/x.jpg', 'permission_granted') !== '');

// ---- ein leeres/fehlendes cover_license (NULL, '', unmigrierter Wert) faellt still --------------------
// ⚠️ Das ist die Zusicherung hinter dem Selbstpruefungs-Auftrag: eine Zeile, deren cover_license NIE
// gesetzt wurde (z. B. ueber die freie "Cover-URL"-Textzeile im Stammdaten-Formular gesetzt, die NICHT
// ueber api/edit/map/game-literature-cover.php laeuft und deshalb kein cover_license mitschreibt --
// html/game-literature-editor.html:956, avesmapsUpsertGameLiterature() ohne 'cover_license' im
// editierbaren Feldsatz), faellt auf 'unknown_other' -> nicht oeffentlich. Das GATE selbst ist damit
// korrekt (kein Katalogwert wird uebersehen); OB es heute eine solche Zeile mit gesetzter cover_url,
// aber leerer cover_license gibt, ist eine Bestandsfrage, die dieser Test nicht beantworten kann (keine
// DB hier) -- siehe Bericht: "Zaehlung zu Befund 2".
foreach ([null, '', 'unbekannt'] as $leer) {
    assert(
        avesmapsGameLiteratureCoverGatedUrl('/uploads/questcovers/x.jpg', $leer) === '',
        'ein leeres/unmigriertes cover_license darf NICHT stillschweigend oeffentlich werden'
    );
}

// ---- keine URL -> nichts zu gaten, bleibt leer ---------------------------------------------------------
assert(avesmapsGameLiteratureCoverGatedUrl('', 'public_domain') === '');

echo "game-literature-cover-gate-test: OK\n";
