<?php

declare(strict_types=1);

// Die Bewertungen als Massen-Export -- Bibliothek zu GET /api/app/location-reviews-export.php (Legacy-Export E3,
// Auftrag Avesmaps3D 04.10.2026). Der Einzelabruf je Ort (api/app/location-reviews.php) waere fuer rund 4.900 Orte
// ein Crawl.
//
// 🔴 NUR SICHTBARE BEWERTUNGEN (`is_hidden = 0 AND is_spam = 0`) -- genau die, die die Karte heute jedem zeigt.
// Verborgene und Spam gehen NICHT hinaus, auch nicht teilweise: sie koennen rechtswidrigen Inhalt tragen, und die
// Moderation hat sie gerade deshalb weggenommen. Von ihnen reisen nur ZAHLEN.
// 🔴 OHNE PERSONENBEZUG. `ip_hash` (HMAC der IP-Adresse), `user_agent` und `request_origin` stehen nicht auf der
// Positivliste und werden gar nicht erst gelesen -- was nicht im Speicher liegt, kann nicht versehentlich
// hinausgehen. `author_name` ist der frei gewaehlte Anzeigename, den die Karte ohnehin oeffentlich zeigt.
//
// ⚠️ `location_public_id` ist eine freie Zeichenkette, die beim Abgeben NIE gegen die Karte geprueft wurde. Der
// Export heilt das nicht, er sagt es: `location_active` je Bewertung und die Zahl der verwaisten Orte im Kopf. Ein
// aktiver Ort ist `map_features.feature_type = 'location' AND is_active = 1` (wie territories-write.php).
// ⚠️ `location_name` ist ein Schnappschuss, den der Browser beim Abgeben mitschickte -- nicht der heutige Ortsname.
//
// 🔴 Nur lesen, kein DDL: die Tabelle legt der Abgabeweg an (avesmapsEnsureMapReviewsTable). Fehlt sie, ist das
// ein 500 -- kein stilles „es gibt keine Bewertungen".

require_once __DIR__ . '/export-rahmen.php';

const AVESMAPS_BEWERTUNGEN_EXPORT_FELDER = [
    'id',
    'location_public_id',
    'location_name',
    'location_active',
    'author_name',
    'stars',
    'body',
    'dsa_date',
    'created_at',
];

/**
 * Die sichtbaren Bewertungen, aelteste zuerst (die Kennung ist fortlaufend).
 *
 * @return list<array<string,mixed>>
 */
function avesmapsBewertungenExportListe(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT r.id, r.location_public_id, r.location_name, r.author_name, r.stars, r.body, r.dsa_date, r.created_at,
                CASE WHEN EXISTS (
                    SELECT 1 FROM map_features mf
                     WHERE mf.public_id = r.location_public_id AND mf.feature_type = 'location' AND mf.is_active = 1
                ) THEN 1 ELSE 0 END AS location_active
           FROM map_reviews r
          WHERE r.is_hidden = 0 AND r.is_spam = 0
          ORDER BY r.id ASC"
    );

    $liste = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $liste[] = avesmapsExportProjektion([
            'id' => (int) $zeile['id'],
            'location_public_id' => (string) $zeile['location_public_id'],
            'location_name' => (string) $zeile['location_name'],
            'location_active' => (int) $zeile['location_active'] === 1,
            'author_name' => (string) $zeile['author_name'],
            'stars' => (int) $zeile['stars'],
            'body' => (string) $zeile['body'],
            'dsa_date' => (string) $zeile['dsa_date'],
            'created_at' => (string) $zeile['created_at'],
        ], AVESMAPS_BEWERTUNGEN_EXPORT_FELDER);
    }

    return $liste;
}

/**
 * Nur Zahlen: gesamt, sichtbar, verborgen, Spam -- und die verwaisten Orte der sichtbaren Bewertungen.
 * ⚠️ `hidden` und `spam` koennen sich ueberschneiden (eine Zeile kann beides sein); `visible` ist „keins von beiden".
 *
 * @param list<array<string,mixed>> $sichtbar
 * @return array<string,int>
 */
function avesmapsBewertungenExportZaehler(PDO $pdo, array $sichtbar): array
{
    $zeile = $pdo->query(
        'SELECT COUNT(*) AS gesamt,
                SUM(CASE WHEN is_hidden = 1 THEN 1 ELSE 0 END) AS verborgen,
                SUM(CASE WHEN is_spam = 1 THEN 1 ELSE 0 END) AS spam
           FROM map_reviews'
    )->fetch(PDO::FETCH_ASSOC) ?: [];

    $verwaisteOrte = [];
    $verwaisteBewertungen = 0;
    foreach ($sichtbar as $bewertung) {
        if ($bewertung['location_active'] === false) {
            $verwaisteBewertungen++;
            $verwaisteOrte[$bewertung['location_public_id']] = true;
        }
    }

    return [
        'total' => (int) ($zeile['gesamt'] ?? 0),
        'visible' => count($sichtbar),
        'hidden' => (int) ($zeile['verborgen'] ?? 0),
        'spam' => (int) ($zeile['spam'] ?? 0),
        'orphaned_location_ids' => count($verwaisteOrte),
        'orphaned_reviews' => $verwaisteBewertungen,
    ];
}

/**
 * Der Stand: Zahl und hoechste Kennung der Bewertungen, die Verteilung der zwei Moderationsschalter (ein
 * Verbergen aendert weder Zahl noch Kennung, und die Tabelle hat kein `updated_at`) -- und `map_revision`, weil
 * `location_active` an den Orten haengt.
 *
 * @param callable|null $lesen nur fuer Tests
 */
function avesmapsBewertungenExportLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static function () use ($pdo): array {
        $sichtbar = avesmapsBewertungenExportListe($pdo);

        return ['liste' => $sichtbar, 'zaehler' => avesmapsBewertungenExportZaehler($pdo, $sichtbar)];
    };
    $stand = static function () use ($pdo): array {
        $verteilung = $pdo->query(
            'SELECT is_hidden, is_spam, COUNT(*) AS anzahl FROM map_reviews GROUP BY is_hidden, is_spam ORDER BY is_hidden, is_spam'
        )->fetchAll(PDO::FETCH_ASSOC);

        return [
            avesmapsExportMapRevision($pdo),
            avesmapsExportTabellenFingerabdruck($pdo, [['map_reviews', 'created_at']]) . '|' . json_encode($verteilung),
        ];
    };
    $ergebnis = avesmapsExportStabilLesen($stand, $lesen);
    [$mapRevision, $fingerabdruck] = $ergebnis['stand'];

    return [
        'ok' => true,
        'map_revision' => $mapRevision,
        'reviews_revision' => avesmapsExportStempel('rev', $fingerabdruck),
        'counts' => $ergebnis['daten']['zaehler'],
        'reviews' => $ergebnis['daten']['liste'],
    ];
}
