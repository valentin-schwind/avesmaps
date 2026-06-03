<?php

declare(strict_types=1);

// Oeffentlicher, read-only Detail-Endpoint fuer die Karten-Infobox (Klick auf ein Reich).
// Liefert die "effektiven" Wiki-Zusatzfelder (Override ?? Staging) je Territorium, die NICHT
// in political_territory/der Map-Features-API stecken (Oberhaupt, Sprache, Waehrung, Einwohner,
// Gruender, Herrschaftsform, Politisch, Handelszone/-waren, Geographisch) + die Wappen-Lizenz
// (fuer das Frontend-Lizenz-Gate: kein Wappen ohne Lizenz). Bewusst KEIN Auth (oeffentliche Karte),
// nur Lesen. Quelle = Sandbox-Wiki-Staging + Modell-Overrides, gematcht ueber wiki_key.
//
// GET ?territory=<political_territory.public_id>

require __DIR__ . '/../_internal/bootstrap.php';

const AVESMAPS_TERRITORY_DETAIL_STAGING_TABLE = 'political_territory_wiki_test';
const AVESMAPS_TERRITORY_DETAIL_MODEL_TABLE = 'wiki_territory_model';

// Felder, die wir in die Infobox heben. Schluessel = Staging-Spalte = Override-Schluessel.
const AVESMAPS_TERRITORY_DETAIL_FIELDS = [
    'name',
    'type',
    'status',
    'continent',
    'founded_text',
    'dissolved_text',
    'form_of_government',
    'capital_name',
    'seat_name',
    'ruler',
    'language',
    'currency',
    'population',
    'founder',
    'political',
    'trade_zone',
    'trade_goods',
    'geographic',
    'blazon',
    'affiliation_raw',
    'wiki_url',
];

// Lizenz-Status, bei denen ein Wappen im Frontend gezeigt werden darf.
const AVESMAPS_TERRITORY_DETAIL_COAT_ALLOWED = ['public_domain', 'attribution_required'];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf keine Kartendaten laden.']);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET-Anfragen sind erlaubt.']);
    }

    $publicId = trim((string) ($_GET['territory'] ?? ''));
    if ($publicId === '') {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Parameter "territory" (public_id) fehlt.']);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 1) Live-Territorium -> wiki_key + Wappen-URL (das, was die Karte zeigt).
    $tStmt = $pdo->prepare(
        'SELECT wiki_key, coat_of_arms_url FROM political_territory WHERE public_id = :pid AND is_active = 1 LIMIT 1'
    );
    $tStmt->execute(['pid' => $publicId]);
    $territory = $tStmt->fetch(PDO::FETCH_ASSOC);
    if ($territory === false) {
        avesmapsJsonResponse(404, ['ok' => false, 'error' => 'Herrschaftsgebiet nicht gefunden.']);
    }

    $wikiKey = (string) ($territory['wiki_key'] ?? '');
    $coatUrl = trim((string) ($territory['coat_of_arms_url'] ?? ''));

    $fields = [];
    $coat = ['url' => '', 'license_status' => '', 'author' => '', 'attribution' => '', 'allowed' => false];

    if ($wikiKey !== '') {
        // 2) Staging (gecrawlte Wiki-Daten) + Modell-Overrides je wiki_key.
        $sStmt = $pdo->prepare(
            'SELECT name, type, status, continent, founded_text, dissolved_text, capital_name, seat_name,
                    form_of_government, ruler, language, currency, population, founder, political,
                    trade_zone, trade_goods, geographic, blazon, affiliation_raw, wiki_url, coat_of_arms_url,
                    coat_of_arms_license_status, coat_of_arms_author, coat_of_arms_attribution
               FROM ' . AVESMAPS_TERRITORY_DETAIL_STAGING_TABLE . '
              WHERE wiki_key = :wk LIMIT 1'
        );
        $sStmt->execute(['wk' => $wikiKey]);
        $staging = $sStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        $oStmt = $pdo->prepare(
            'SELECT metadata_overrides_json FROM ' . AVESMAPS_TERRITORY_DETAIL_MODEL_TABLE . ' WHERE wiki_key = :wk LIMIT 1'
        );
        $oStmt->execute(['wk' => $wikiKey]);
        $overridesJson = (string) ($oStmt->fetchColumn() ?: '');
        $decoded = json_decode($overridesJson, true);
        $overrides = is_array($decoded) ? $decoded : [];

        // 3) Effektiv = Override ?? Staging.
        foreach (AVESMAPS_TERRITORY_DETAIL_FIELDS as $key) {
            $value = array_key_exists($key, $overrides)
                ? (string) $overrides[$key]
                : (string) ($staging[$key] ?? '');
            $value = trim($value);
            if ($value !== '') {
                $fields[$key] = $value;
            }
        }

        // 4) Wappen-Lizenz (Gate). license_status kann ueberschrieben sein.
        $licenseStatus = array_key_exists('coat_of_arms_license_status', $overrides)
            ? (string) $overrides['coat_of_arms_license_status']
            : (string) ($staging['coat_of_arms_license_status'] ?? '');
        $licenseStatus = trim($licenseStatus);
        // Effektive Wappen-URL: Override ?? political_territory ?? Staging (viele Live-Zeilen haben das
        // gecrawlte Wappen nie bekommen -> sonst fehlt es trotz vorhandener Lizenz).
        $stagingCoat = trim((string) ($staging['coat_of_arms_url'] ?? ''));
        $effCoatUrl = array_key_exists('coat_of_arms_url', $overrides)
            ? trim((string) $overrides['coat_of_arms_url'])
            : ($coatUrl !== '' ? $coatUrl : $stagingCoat);
        $allowed = $effCoatUrl !== '' && in_array($licenseStatus, AVESMAPS_TERRITORY_DETAIL_COAT_ALLOWED, true);
        $coat = [
            'url' => $allowed ? $effCoatUrl : '',
            'license_status' => $licenseStatus,
            'author' => trim((string) ($staging['coat_of_arms_author'] ?? '')),
            'attribution' => trim((string) ($staging['coat_of_arms_attribution'] ?? '')),
            'allowed' => $allowed,
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'territory' => $publicId,
        'wiki_key' => $wikiKey,
        'fields' => $fields,
        'coat' => $coat,
    ]);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => $error->getMessage()]);
}
