<?php

declare(strict_types=1);

// Die Tempowerte lesen, speichern und auf die GA zurücksetzen.
// Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md §8.1
//
// 🔴 DIE GA-TAFEL STEHT IM SERVER (`avesmapsTravelValuesSourceTable`), nicht im Browser. `reset`
// rechnet hier; läge die Tafel auch im Fenster, gäbe es sie zweimal und sie liefen auseinander.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/routing/travel-values.php';
require_once __DIR__ . '/../../_internal/map/features.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Tempowerte nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'get'), 40);

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION. `avesmapsCreatePdo(array $databaseConfig)` nimmt
    // ein Array, und `$config` IST eins -- PHP beschwert sich also nicht. Drinnen sind dann `driver`,
    // `host`, `port`, `name` und `user` allesamt leer, die Funktion wirft, und der `catch (Throwable)`
    // am Ende dieser Datei macht daraus ein generisches 500. Genau so hat dieses Fenster vom Tag
    // seiner Veroeffentlichung an (14.08.2026) NIE geladen: „Die Tempowerte konnten nicht geladen
    // werden." haengt im Client an einem `.catch`, und dort sehen Netzfehler, 500 und kaputtes JSON
    // gleich aus. Bewacht von api/_internal/__tests__/create-pdo-argument-test.php.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    $values = avesmapsTravelValuesRead($pdo);
    // Der Stand VOR der Änderung — das Protokoll braucht beide Seiten.
    $before = $values['grid'];

    // Die Landschaftsspalte lebt in `ecosystem_region_type`, nicht im JSON — sie reist getrennt.
    // ⚠️ Fehlt die Spalte, kommt eine leere Liste; das Fenster sagt dann, dass sie noch nicht
    // angelegt ist, statt einen leeren Abschnitt ohne Erklärung zu zeigen.
    if ($action === 'get') {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'values' => $values,
            'landscapes' => avesmapsTravelValuesReadLandscapes($pdo),
            // 🔴 Ein stiller Not-Aus ohne Anzeige ist ein Ausfall (Entwurf §7): die Probe fährt den
            // echten Lader und sagt, ob der A* gerade überhaupt Bodenfaktoren findet.
            'terrain_probe' => avesmapsTravelValuesTerrainProbe($pdo),
            // Die gemessene Seite neben die gerechnete: was die Eichung je Wegtyp sagt.
            'calibration' => avesmapsTravelValuesCalibrationRows($pdo),
            'source_table' => avesmapsTravelValuesSourceTable(),
            'deviations' => avesmapsTravelValuesDeviations($values),
        ]);
    }

    if ($action !== 'save' && $action !== 'reset') {
        avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
    }

    if ($action === 'reset') {
        $section = avesmapsNormalizeSingleLine((string) ($payload['section'] ?? ''), 40);
        if (!in_array($section, ['day_miles', 'path_factors', 'landscapes', 'ground', 'misc', 'all'], true)) {
            avesmapsErrorResponse(400, 'invalid_section', 'Unbekannter Abschnitt.');
        }
        // 🔴 Die Landschaften stehen in ihrer eigenen Spalte, also setzt sie ihr eigener Rücksetzer
        // zurück — und der fasst nur die NEUN mit Quellenzeile an (Entwurf §4.3).
        if ($section === 'landscapes' || $section === 'all') {
            avesmapsTravelValuesResetLandscapes($pdo);
        }
        $values = avesmapsTravelValuesResetSection($values, $section);
    } else {
        // 💣 NUR, WAS ES SCHON GIBT, und jede Zahl mit ihrem eigenen Vorzeichen-Sinn. Die Regel steht
        // in avesmapsTravelValuesApplyIncoming und ist dort einzeln geprüft — hier stünde sie sonst
        // ein zweites Mal, und die beiden liefen beim nächsten neuen Abschnitt auseinander.
        $values = avesmapsTravelValuesApplyIncoming($values, $payload);
        if (is_array($payload['landscapes'] ?? null)) {
            avesmapsTravelValuesWriteLandscapes($pdo, $payload['landscapes']);
        }
    }

    // 💣 EINE ZEILE, ATOMAR. Ein halb gespeichertes Tempo-Raster ist ein kaputter Router; ein
    // JSON-Wert wird in einem Schreibvorgang geschrieben, sechsundzwanzig Zeilen einer
    // Schlüssel-Wert-Tabelle nicht.
    // ⚠️ Die Sechs-Schlüssel-Liste steht in avesmapsTravelValuesStorableShape und nur dort — die
    // einmalige Migration legt denselben Wert ab, und zwei Abschriften liefen beim nächsten neuen
    // Abschnitt auseinander.
    // 💣 UND DIE SPALTE MUSS IHN FASSEN. `setting_value` war VARCHAR(255), dieser Wert ist über 1.400
    // Zeichen lang: MySQL schnitt ihn ausserhalb des strikten Modus STILL ab, `json_decode` lieferte
    // danach NULL, und der Leser fiel auf seine Konstante zurück. Dieser Knopf hat vom 14.08.2026 an
    // nichts getan und nie geklagt — was niemandem auffiel, weil „nichts ändert sich" der erwartete
    // Zustand war. Gemessen an der Live-Anlage, nicht vermutet.
    // ⚠️ DDL, also vor jedem Schreibvorgang und nie in einer Transaktion. Dieser Handler hat keine.
    avesmapsAppSettingEnsureWideValue($pdo);
    $stored = avesmapsTravelValuesStorableShape($values);
    avesmapsAppSettingSet($pdo, AVESMAPS_TRAVEL_VALUES_SETTING_KEY, json_encode($stored, JSON_UNESCAPED_UNICODE));
    if (!avesmapsTravelValuesStoredMatches($pdo, $stored)) {
        // 🔴 Ein Speichern, das nicht ankommt, meldet das. Ein stiller Verlust ist genau der Ausfall,
        // wegen dessen diese Zeile existiert.
        avesmapsErrorResponse(500, 'travel_values_not_stored',
            'Die Tempowerte konnten nicht vollständig gespeichert werden.');
    }

    // ⚠️ `map_revision` wird NICHT gehoben — es ändert kein Kartenobjekt, und ein Sprung würde jeden
    // Client die komplette Feature-Nutzlast neu laden lassen. Der Router liest den eigenen Stempel.
    avesmapsAppSettingSet($pdo, AVESMAPS_TRAVEL_VALUES_SETTING_KEY . '_stamp', (string) time());

    // Eine Protokollzeile je Speichern, nie eine je Wert. `feature_id = NULL` — es hängt an keinem
    // Kartenobjekt.
    if (function_exists('avesmapsWriteMapAuditLog')) {
        avesmapsWriteMapAuditLog(
            $pdo,
            null,
            'travel_values_' . $action,
            (int) ($user['id'] ?? 0),
            json_encode(['grid' => $before], JSON_UNESCAPED_UNICODE),
            json_encode(['grid' => $values['grid'], 'section' => $payload['section'] ?? null], JSON_UNESCAPED_UNICODE)
        );
    }

    $values = avesmapsTravelValuesRead($pdo);
    avesmapsJsonResponse(200, [
        'ok' => true,
        'values' => $values,
        'landscapes' => avesmapsTravelValuesReadLandscapes($pdo),
        // 💣 DIESELBEN SCHLUESSEL WIE OBEN. Das Fenster zeichnet nach jedem Speichern aus DIESER
        // Antwort neu; fehlte hier `terrain_probe`, fiele die Bodenprobe danach auf ihren Zweig
        // „Spalte nicht angelegt" -- ein roter Alarm, ausgeloest durch ein erfolgreiches Speichern.
        // Ein fehlender Schluessel ist im Client kein Fehler, sondern `undefined`, und `undefined`
        // sieht dort aus wie eine Aussage. Bewacht von js/pages/__tests__/tempowerte-dialog.test.js.
        'terrain_probe' => avesmapsTravelValuesTerrainProbe($pdo),
        'calibration' => avesmapsTravelValuesCalibrationRows($pdo),
        'source_table' => avesmapsTravelValuesSourceTable(),
        'deviations' => avesmapsTravelValuesDeviations($values),
    ]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Die Tempowerte konnten nicht verarbeitet werden.');
}
