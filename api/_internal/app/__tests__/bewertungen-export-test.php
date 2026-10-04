<?php

declare(strict_types=1);

/**
 * Der Bewertungs-Export E3 -- GET /api/app/location-reviews-export.php (Auftrag Avesmaps3D 04.10.2026).
 *
 *   A. Nur sichtbare Bewertungen, genau die freigegebenen Felder, KEIN Personenbezug (ip_hash, user_agent, request_origin)
 *   B. Verborgene und Spam nur als Zahl, verwaiste Orte als Zahl und je Bewertung
 *   C. Schreibfreiheit und Stand (ein Verbergen bewegt ihn)
 *   D. Endpunkt, Bibliothek, Beispielantwort
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/bewertungen-export-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/app/bewertungen-export.php';
require_once __DIR__ . '/export-test-helfer.php';

$pdo = exportTestNeuePdo();
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 812)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, is_active INTEGER)');
$pdo->exec("INSERT INTO map_features (id, public_id, feature_type, is_active) VALUES
    (1, 'ort-angbar', 'location', 1), (2, 'ort-geloescht', 'location', 0), (3, 'weg-kein-ort', 'path', 1)");
$pdo->exec("CREATE TABLE map_reviews (
    id INTEGER PRIMARY KEY, location_public_id TEXT NOT NULL, location_name TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '',
    stars INTEGER NOT NULL, body TEXT NOT NULL DEFAULT '', dsa_date TEXT NOT NULL DEFAULT '', is_hidden INTEGER NOT NULL DEFAULT 0,
    is_spam INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, request_origin TEXT NOT NULL DEFAULT '', ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
)");
$pdo->exec("INSERT INTO map_reviews (id, location_public_id, location_name, author_name, stars, body, dsa_date, is_hidden, is_spam, created_at, request_origin, ip_hash, user_agent) VALUES
    (1, 'ort-angbar', 'Angbar', 'Alrik', 5, 'Gutes Bier.', '3. Praios 1047 BF', 0, 0, '2026-08-01 10:00:00', 'GEHEIM-HERKUNFT', 'GEHEIM-IPHASH', 'GEHEIM-AGENT'),
    (2, 'ort-geloescht', 'Altes Dorf', 'Rondra', 3, 'Stand hier mal.', '', 0, 0, '2026-08-02 10:00:00', 'GEHEIM-HERKUNFT', 'GEHEIM-IPHASH', 'GEHEIM-AGENT'),
    (3, 'erfunden-123', 'Nirgendwo', 'Phex', 4, 'Gibt es nicht.', '', 0, 0, '2026-08-03 10:00:00', 'GEHEIM-HERKUNFT', 'GEHEIM-IPHASH', 'GEHEIM-AGENT'),
    (4, 'ort-angbar', 'Angbar', 'Verborgen', 1, 'GEHEIM-VERBORGEN', '', 1, 0, '2026-08-04 10:00:00', '', '', ''),
    (5, 'ort-angbar', 'Angbar', 'Spammer', 1, 'GEHEIM-SPAM', '', 0, 1, '2026-08-05 10:00:00', '', '', ''),
    (6, 'ort-angbar', 'Angbar', 'Beides', 1, 'GEHEIM-BEIDES', '', 1, 1, '2026-08-06 10:00:00', '', '', ''),
    (7, 'weg-kein-ort', 'Reichsstrasse', 'Hesinde', 2, 'Ein Weg ist kein Ort.', '', 0, 0, '2026-08-07 10:00:00', '', '', '')");

// =====================================================================================================
// A. + B. INHALT
// =====================================================================================================
$export = exportTestSchreibfrei($pdo, static fn (): array => avesmapsBewertungenExportLesen($pdo), 'C1');
assert(array_keys($export) === ['ok', 'map_revision', 'reviews_revision', 'counts', 'reviews'], 'A1: die Antwortform');
exportTestGenauFelder($export['reviews'], AVESMAPS_BEWERTUNGEN_EXPORT_FELDER, 'A2');
assert(array_column($export['reviews'], 'id') === [1, 2, 3, 7], 'A3: nur die sichtbaren, nach Kennung');
foreach (['GEHEIM-HERKUNFT', 'GEHEIM-IPHASH', 'GEHEIM-AGENT', 'GEHEIM-VERBORGEN', 'GEHEIM-SPAM', 'GEHEIM-BEIDES', 'ip_hash', 'user_agent', 'request_origin', 'is_hidden', 'is_spam'] as $geheim) {
    assert(!exportTestEnthaelt($export, $geheim), "A4: 🔴 '{$geheim}' taucht nirgends auf");
}
$erste = $export['reviews'][0];
assert($erste === [
    'id' => 1, 'location_public_id' => 'ort-angbar', 'location_name' => 'Angbar', 'location_active' => true, 'author_name' => 'Alrik',
    'stars' => 5, 'body' => 'Gutes Bier.', 'dsa_date' => '3. Praios 1047 BF', 'created_at' => '2026-08-01 10:00:00',
], 'A5: eine Bewertung vollstaendig und typgerecht');
$aktiv = array_column($export['reviews'], 'location_active', 'id');
assert($aktiv === [1 => true, 2 => false, 3 => false, 7 => false], 'B1: geloeschter Ort, erfundene Kennung und ein WEG zaehlen nicht als aktiver Ort');
assert($export['counts'] === ['total' => 7, 'visible' => 4, 'hidden' => 2, 'spam' => 2, 'orphaned_location_ids' => 3, 'orphaned_reviews' => 3],
    'B2: nur Zahlen -- gesamt, sichtbar, verborgen, Spam (ueberschneidend), verwaist: ' . json_encode($export['counts']));

// =====================================================================================================
// C. STAND
// =====================================================================================================
$vorher = $export['reviews_revision'];
$pdo->exec('UPDATE map_reviews SET is_hidden = 1 WHERE id = 3');
assert(avesmapsBewertungenExportLesen($pdo)['reviews_revision'] !== $vorher, 'C2: 💣 ein Verbergen (weder Zahl noch Kennung aendern sich) hebt den Stand');
$pdo->exec('UPDATE map_reviews SET is_hidden = 0 WHERE id = 3');
$pdo->exec('UPDATE map_revision SET revision = 900 WHERE id = 1');
assert(avesmapsBewertungenExportLesen($pdo)['map_revision'] === 900, 'C3: die Kartenrevision steht mit im Stand (location_active haengt an den Orten)');

// =====================================================================================================
// D. ENDPUNKT, BIBLIOTHEK, BEISPIELANTWORT
// =====================================================================================================
exportTestEndpunktPruefen($wurzel . '/api/app/location-reviews-export.php', 'avesmapsBewertungenExportLesen', false, 'D1');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/bewertungen-export.php', 'D2');
$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/bewertungen-export.php'));
foreach (['ip_hash', 'user_agent', 'request_origin', 'SELECT *', 'r.*'] as $verboten) {
    assert(!str_contains($bibliothek, $verboten), "D3: 🔴 die Bibliothek liest '{$verboten}' gar nicht erst");
}
$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/location-reviews-export.beispiel.json'), true);
assert(is_array($beispiel), 'D4: die Beispielantwort liegt vor');
exportTestFormGleich($beispiel, $export, 'location-reviews-export');

echo "bewertungen-export-test: alle Zusicherungen erfuellt\n";
