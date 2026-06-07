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

// Wandelt einen echten Zeitstempel in ein aventurisches Datum um (z. B. "7. Rahja 1049 BF").
// Konvention (vgl. dsa-spielen.de Kalender): die 12 Goettermonate laufen parallel zu den
// realen Monaten, wobei Praios etwa dem Juli entspricht. Tag = Tag des realen Monats (max. 30),
// Jahr = AVESMAPS_AVENTURIAN_YEAR.
function avesmapsReviewDsaDateFromTimestamp(int $timestamp): string
{
    $months = ['Praios', 'Rondra', 'Efferd', 'Travia', 'Boron', 'Hesinde', 'Firun', 'Tsa', 'Phex', 'Peraine', 'Ingerimm', 'Rahja'];
    $gregorianMonth = (int) date('n', $timestamp); // 1..12 (Server-Zeit)
    $gregorianDay = (int) date('j', $timestamp);   // 1..31
    $monthIndex = (($gregorianMonth - 7) + 12) % 12; // Juli -> Praios(0), Juni -> Rahja(11)
    $day = max(1, min(30, $gregorianDay));

    return sprintf('%d. %s %d BF', $day, $months[$monthIndex], (int) AVESMAPS_AVENTURIAN_YEAR);
}

// Prueft + normalisiert ein vom Nutzer eingegebenes aventurisches Datum.
//   "" -> "" (leer; der Aufrufer setzt dann das Auto-Datum)
//   gueltig -> kanonische Form, z. B. "7. Rahja 1049 BF"
//   ungueltig -> null
function avesmapsReviewNormalizeDsaDate(string $input): ?string
{
    $value = trim($input);
    if ($value === '') {
        return '';
    }

    $monthKeys = ['praios', 'rondra', 'efferd', 'travia', 'boron', 'hesinde', 'firun', 'tsa', 'phex', 'peraine', 'ingerimm', 'rahja'];
    $monthDisplay = ['Praios', 'Rondra', 'Efferd', 'Travia', 'Boron', 'Hesinde', 'Firun', 'Tsa', 'Phex', 'Peraine', 'Ingerimm', 'Rahja'];

    // Namenlose Tage: "3. Namenloser Tag 1049 BF" (Tag 1..5).
    if (preg_match('/^(\d{1,2})\s*\.?\s*namenlose[rn]?\s+tage?\s+(\d{1,4})\s*(v\.?\s*bf|bf)?$/iu', $value, $match)) {
        $day = (int) $match[1];
        $year = (int) $match[2];
        if ($day < 1 || $day > 5 || $year < 1 || $year > 9999) {
            return null;
        }
        $era = (isset($match[3]) && stripos(trim($match[3]), 'v') === 0) ? 'v. BF' : 'BF';
        return sprintf('%d. Namenloser Tag %d %s', $day, $year, $era);
    }

    // Regulaer: "7. Rahja 1049 BF" / "7 Rahja 1049".
    if (!preg_match('/^(\d{1,2})\s*\.?\s*([a-zäöü]+)\s+(\d{1,4})\s*(v\.?\s*bf|bf)?$/iu', $value, $match)) {
        return null;
    }
    $day = (int) $match[1];
    $monthIndex = array_search(strtolower($match[2]), $monthKeys, true);
    $year = (int) $match[3];
    if ($monthIndex === false || $day < 1 || $day > 30 || $year < 1 || $year > 9999) {
        return null;
    }
    $era = (isset($match[4]) && stripos(trim($match[4]), 'v') === 0) ? 'v. BF' : 'BF';

    return sprintf('%d. %s %d %s', $day, $monthDisplay[$monthIndex], $year, $era);
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
