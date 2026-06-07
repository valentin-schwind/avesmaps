<?php

declare(strict_types=1);

// Gemeinsame Helfer fuer Community-Ortsbewertungen (Tabelle map_reviews). Genutzt vom oeffentlichen
// Endpoint (api/app/location-reviews.php) und vom Editor-Moderations-Endpoint (api/edit/reviews.php).
// Setzt die bootstrap.php-Helfer voraus (avesmapsClientIpAddress, avesmapsNormalizeSingleLine, ...).

if (!defined('AVESMAPS_AVENTURIAN_YEAR')) {
    // Aktuelles aventurisches Jahr (BF) fuer automatisch erzeugte Bewertungs-Daten.
    define('AVESMAPS_AVENTURIAN_YEAR', 1049);
}

const AVESMAPS_REVIEW_BODY_MAX = 200;
const AVESMAPS_REVIEW_AUTHOR_MAX = 80;
const AVESMAPS_REVIEW_DATE_MAX = 60;
const AVESMAPS_REVIEW_SPAM_WORDS = ['casino', 'crypto', 'viagra', 'loan', 'betting', 'porn', 'sex', 'seo', 'http://', 'https://', 'www.'];

function avesmapsEnsureMapReviewsTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS map_reviews (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            location_public_id VARCHAR(64) NOT NULL,
            location_name VARCHAR(255) NOT NULL DEFAULT "",
            author_name VARCHAR(80) NOT NULL DEFAULT "",
            stars TINYINT UNSIGNED NOT NULL,
            body VARCHAR(200) NOT NULL DEFAULT "",
            dsa_date VARCHAR(60) NOT NULL DEFAULT "",
            is_hidden TINYINT(1) NOT NULL DEFAULT 0,
            is_spam TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            request_origin VARCHAR(255) NOT NULL DEFAULT "",
            ip_hash VARCHAR(64) NOT NULL DEFAULT "",
            user_agent VARCHAR(500) NOT NULL DEFAULT "",
            PRIMARY KEY (id),
            KEY idx_reviews_loc_visible (location_public_id, is_hidden, is_spam, created_at),
            KEY idx_reviews_iphash_created (ip_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

// Privatsphaere-schonender IP-Hash (nur fuer Rate-Limit-Dedup), kein Klartext-IP gespeichert.
function avesmapsReviewIpHash(array $config): string
{
    $secret = (string) ($config['database']['name'] ?? 'avesmaps');
    return hash_hmac('sha256', avesmapsClientIpAddress(), $secret);
}

// Wandelt einen echten Zeitstempel in ein aventurisches Datum (z. B. "20. Efferd 1048 BF").
// Einfache, deterministische Tag-im-Jahr-Abbildung auf den 12-Goetter-Kalender (12x30 + 5 Namenlose).
function avesmapsReviewDsaDateFromTimestamp(int $timestamp): string
{
    $months = ['Praios', 'Rondra', 'Efferd', 'Travia', 'Boron', 'Hesinde', 'Firun', 'Tsa', 'Phex', 'Peraine', 'Ingerimm', 'Rahja'];
    $dayOfYear = ((int) gmdate('z', $timestamp)) + 1; // 1..366
    if ($dayOfYear > 365) {
        $dayOfYear = 365;
    }
    $year = (int) AVESMAPS_AVENTURIAN_YEAR;
    if ($dayOfYear <= 360) {
        $monthIndex = intdiv($dayOfYear - 1, 30);
        $day = (($dayOfYear - 1) % 30) + 1;
        return sprintf('%d. %s %d BF', $day, $months[$monthIndex], $year);
    }
    $nameless = $dayOfYear - 360;
    return sprintf('%d. Namenloser Tag %d BF', $nameless, $year);
}

// Durchschnitt + Anzahl der SICHTBAREN Bewertungen eines Ortes.
function avesmapsReviewSummary(PDO $pdo, string $publicId): array
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*) AS review_count, AVG(stars) AS average_stars
         FROM map_reviews
         WHERE location_public_id = :pid AND is_hidden = 0 AND is_spam = 0'
    );
    $statement->execute(['pid' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];
    $count = (int) ($row['review_count'] ?? 0);
    $average = $count > 0 ? round((float) $row['average_stars'], 1) : 0.0;

    return ['count' => $count, 'average' => $average];
}

// Sichtbare Bewertungen (neueste zuerst).
function avesmapsFetchVisibleReviews(PDO $pdo, string $publicId, int $limit): array
{
    $limit = max(1, min(50, $limit));
    $statement = $pdo->prepare(
        'SELECT id, author_name, stars, body, dsa_date, created_at
         FROM map_reviews
         WHERE location_public_id = :pid AND is_hidden = 0 AND is_spam = 0
         ORDER BY created_at DESC, id DESC
         LIMIT ' . $limit
    );
    $statement->execute(['pid' => $publicId]);

    $reviews = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $reviews[] = [
            'id' => (int) $row['id'],
            'author' => (string) $row['author_name'],
            'stars' => (int) $row['stars'],
            'body' => (string) $row['body'],
            'dsa_date' => (string) $row['dsa_date'],
            'created_at' => (string) $row['created_at'],
        ];
    }

    return $reviews;
}

// Sehr einfache Spam-Heuristik (Wortliste, inkl. URLs).
function avesmapsReviewLooksLikeSpam(string $author, string $body): bool
{
    $haystack = mb_strtolower($author . ' ' . $body);
    foreach (AVESMAPS_REVIEW_SPAM_WORDS as $word) {
        if (mb_strpos($haystack, $word) !== false) {
            return true;
        }
    }

    return false;
}
