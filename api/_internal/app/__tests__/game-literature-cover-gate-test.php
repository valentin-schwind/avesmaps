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
// ⚠️ Von aussen bestaetigt (Katalog 1534 mit cover_url, Migrationslauf 1534 gelesen/geaendert):
// heute gibt es keine solche Zeile im Bestand. Der Fall bleibt trotzdem getestet -- das GATE selbst muss
// unbekannte/leere Werte weiter ablehnen, unabhaengig vom aktuellen Bestand.
foreach ([null, '', 'unbekannt'] as $leer) {
    assert(
        avesmapsGameLiteratureCoverGatedUrl('/uploads/questcovers/x.jpg', $leer) === '',
        'ein leeres/unmigriertes cover_license darf NICHT stillschweigend oeffentlich werden'
    );
}

// ---- keine URL -> nichts zu gaten, bleibt leer ---------------------------------------------------------
assert(avesmapsGameLiteratureCoverGatedUrl('', 'public_domain') === '');

echo "game-literature-cover-gate-test: OK\n";

// =========================================================================================================
// Nachtrag: der Risikoweg, der eine leere cover_license erst ERZEUGEN koennte (Prüfung nach dieser Phase).
// =========================================================================================================
//
// html/game-literature-editor.html:956 traegt ein freies Textfeld "Cover-URL" im Stammdaten-Block, das
// ueber avesmapsUpsertGameLiterature() speichert -- unabhaengig vom Cover-Dialog, der cover_license immer
// mitschreibt. avesmapsGameLiteratureCoverLicenseDefaultOnUpsert() ist der PURE Entscheidungskern dieses
// Nachtrags: 'unknown_other' NUR wenn eine neue, nicht-leere cover_url ankommt UND noch keine Lizenz
// gespeichert ist -- eine von Hand eingetragene Fremd-URL ist ungeprueft, "ungeklaert" ist die ehrliche
// Aussage (NICHT 'permission_granted' -- das waere dieselbe Erfindung, die der zweite Wappen-Upload-Weg
// gerade zurueckgebaut hat).
assert(avesmapsGameLiteratureCoverLicenseDefaultOnUpsert(true, '') === 'unknown_other', 'neue URL, keine Lizenz -> Vorgabe');
assert(avesmapsGameLiteratureCoverLicenseDefaultOnUpsert(false, '') === null, 'keine URL in dieser Anfrage -> nichts tun');
// 💣 Niemals eine bereits gesetzte Lizenz ueberschreiben -- gatherStamm() (JS) sendet cover_url bei JEDEM
// Speichern mit, auch wenn der Editor nur ein anderes Feld geaendert hat.
foreach (['permission_granted', 'cc_by', 'unknown_other', 'own_work'] as $vorhanden) {
    assert(
        avesmapsGameLiteratureCoverLicenseDefaultOnUpsert(true, $vorhanden) === null,
        "eine bereits gesetzte Lizenz ({$vorhanden}) darf nie ueberschrieben werden"
    );
}
echo "game-literature-cover-license-default-on-upsert-test: OK\n";
