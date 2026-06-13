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

// Formatiert ein BF-Jahr fuer die Anzeige. 9999 (Ongoing-Sentinel) -> "besteht",
// negativ -> "<n> v. BF", sonst "<n> BF" (0 BF = Bosparans Fall ist gueltig).
function avesmapsTerritoryDetailFormatBf(int $year): string {
    if ($year >= 9999) {
        return 'besteht';
    }
    return $year < 0 ? (abs($year) . ' v. BF') : ($year . ' BF');
}

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
    $wikiKeyParam = trim((string) ($_GET['wiki_key'] ?? ''));
    if ($publicId === '' && $wikiKeyParam === '') {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Parameter "territory" (public_id) oder "wiki_key" fehlt.']);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 1) Live-Territorium -> wiki_key + Wappen-URL. Match per public_id ODER (z.B. aus dem Territoriums-
    //    editor, wo die public_id fehlt) per wiki_key.
    if ($publicId !== '') {
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
    } else {
        $wikiKey = $wikiKeyParam;
        $cStmt = $pdo->prepare(
            'SELECT coat_of_arms_url FROM political_territory WHERE wiki_key = :wk AND is_active = 1 LIMIT 1'
        );
        $cStmt->execute(['wk' => $wikiKey]);
        $coatUrl = trim((string) ($cStmt->fetchColumn() ?: ''));
    }

    $fields = [];
    $coat = ['url' => '', 'license_status' => '', 'author' => '', 'attribution' => '', 'allowed' => false];

    if ($wikiKey !== '') {
        // 2) Staging (gecrawlte Wiki-Daten) + Modell-Overrides je wiki_key.
        $sStmt = $pdo->prepare(
            'SELECT name, type, status, continent, founded_text, dissolved_text, capital_name, seat_name,
                    form_of_government, ruler, language, currency, population, founder, political,
                    trade_zone, trade_goods, geographic, blazon, affiliation_raw, wiki_url, coat_of_arms_url,
                    coat_of_arms_license_status, coat_of_arms_author, coat_of_arms_attribution,
                    founded_start_bf, dissolved_end_bf
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

        // 3b) Gegruendet/Aufgeloest: die STEUERNDEN Werte sind die BF-Spalten (founded_start_bf/
        //     dissolved_end_bf) — Overrides liegen i.d.R. dort, nicht auf dem *_text. Die Schleife oben
        //     traegt nur den Text-Override??Staging-Text ein; hier den BF-Override nachziehen, damit die
        //     Infobox/Editor-Wiki-Daten den effektiven (ueberschriebenen) Zeitwert zeigen.
        //     Prioritaet: Text-Override (bewusst gesetzt) > BF-Override > Staging-Text.
        if (!array_key_exists('founded_text', $overrides) && array_key_exists('founded_start_bf', $overrides)) {
            $bf = trim((string) $overrides['founded_start_bf']);
            if ($bf === '') {
                unset($fields['founded_text']);
            } else {
                $fields['founded_text'] = avesmapsTerritoryDetailFormatBf((int) $bf);
            }
        }
        if (!array_key_exists('dissolved_text', $overrides) && array_key_exists('dissolved_end_bf', $overrides)) {
            $bf = trim((string) $overrides['dissolved_end_bf']);
            // Leerer Override = bewusst "besteht" (z.B. Besatzungs-Korrektur), nicht "kein Wert".
            $fields['dissolved_text'] = $bf === '' ? 'besteht' : avesmapsTerritoryDetailFormatBf((int) $bf);
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
    avesmapsJsonResponse(500, ['ok' => false, 'error' => 'Internal server error.']);
}
