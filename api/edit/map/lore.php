<?php

declare(strict_types=1);

// Editor-Schreibpfad für Flora, Fauna, Spezies und Handelswaren.
// Logik: _internal/app/lore-edit.php. Lesepfad (öffentlich): api/app/lore.php.
//
// POST { action: "detail",       wiki_key }                        -> Eintrag komplett
// POST { action: "add_place",    wiki_key, place_title, relation? } -> Ort zuordnen (manual)
// POST { action: "remove_place", wiki_key, place_wiki_key, relation } -> Wiki-Ort: Grabstein; manuell: löschen
// POST { action: "set_field",    wiki_key, field, value }          -> Feld übersteuern (leer = Übersteuerung aufheben)
// POST { action: "set_status",   wiki_key, status }                -> active | suppressed
// POST { action: "set_kind_enabled", kind, enabled }               -> Art oeffentlich an/aus (OHNE wiki_key)
// POST { action: "preview_rule", wiki_key, terms }                -> was die Regel traefe (schreibt NICHTS)
// POST { action: "save_rule",    wiki_key, terms, relation?, rule_id? } -> anlegen oder ersetzen
// POST { action: "delete_rule",  wiki_key, rule_id }              -> Regel entfernen
//
// Alle Schreibaktionen sind capability-gated ('edit') wie jeder Editor-Schreibpfad.

// I3: ein Deckel gegen einen Worker, der beliebig lange laeuft -- preview_rule wertet die
// GANZE Regel EINMAL JE BEDINGUNG aus (avesmapsLoreRuleEvaluate, ~2.782 Flaechen+Orte). Auf
// STRATO-Shared-Hosting haelt ein zu grosses Payload sonst einen Worker unbegrenzt fest.
// Abgelehnt, nicht still gekappt: eine stumm gekuerzte Regel wuerde etwas anderes rechnen als
// der Editor zeigt, ohne dass es jemand merkt. Vorbild: AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX
// (path-ecosystem.php).
const AVESMAPS_LORE_RULE_MAX_TERMS = 25;
const AVESMAPS_LORE_RULE_MAX_TYPES_PER_TERM = 40;

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/lore-edit.php';
// avesmapsPoliticalSlug für die Ortsschlüssel beim Zuordnen.
require_once __DIR__ . '/../../_internal/political/territory.php';
// avesmapsLoreKindEnabled/-SettingKey + AVESMAPS_LORE_KINDS für die Schalter je Art.
require_once __DIR__ . '/../../_internal/app/lore.php';
// avesmapsAppSettingSet -- explizit, nicht auf function_exists verlassen.
require_once __DIR__ . '/../../_internal/app/app-setting.php';
// Die Lebensraum-Regel: reine Auswertung und Ablage getrennt.
require_once __DIR__ . '/../../_internal/app/lore-rule.php';
require_once __DIR__ . '/../../_internal/app/lore-rule-store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Natur & Waren nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    // The user is kept, not discarded: removing an occurrence writes an audit entry (A16) and it has to
    // be able to name who did it. Without this the trail would say "system" about a person who is
    // logged in.
    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);
    $wikiKey = avesmapsNormalizeSingleLine((string) ($payload['wiki_key'] ?? ''), 190);

    // set_kind_enabled schaltet eine ganze ART, nicht einen Eintrag -- als einzige Aktion
    // ohne wiki_key. Ohne diese Ausnahme scheitert sie schon vor dem Dispatcher.
    if ($wikiKey === '' && $action !== 'set_kind_enabled') {
        avesmapsErrorResponse(400, 'invalid_request', 'wiki_key ist erforderlich.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    /**
     * Bedingungen aus dem Rumpf, auf die Form gebracht, die lore-rule.php erwartet.
     *
     * 💣 Der Riegel steht HIER, serverseitig, nicht nur am ausgegrauten Knopf: eine Regel,
     * deren Bedingungen alle leer sind, traefe ALLES. Dieselbe Lehre wie beim Loeschriegel
     * der Uebernahme-Vorschau.
     */
    $readTerms = static function (array $payload) use ($pdo): array {
        $rawTerms = (array) ($payload['terms'] ?? []);
        if (count($rawTerms) > AVESMAPS_LORE_RULE_MAX_TERMS) {
            avesmapsErrorResponse(
                400,
                'too_many_terms',
                'Eine Regel darf hoechstens ' . AVESMAPS_LORE_RULE_MAX_TERMS . ' Bedingungen haben.'
            );
        }

        // I1: die echte Zonenliste, EINMAL geholt, nicht je Bedingung -- gebraucht, um einen
        // unbekannten Klimaschluessel zu erkennen (siehe unten).
        $zoneKeys = avesmapsLoreRuleOrderedZoneKeys($pdo);

        $out = [];
        foreach ($rawTerms as $raw) {
            $rawTypes = (array) ($raw['types'] ?? []);
            if (count($rawTypes) > AVESMAPS_LORE_RULE_MAX_TYPES_PER_TERM) {
                avesmapsErrorResponse(
                    400,
                    'too_many_types',
                    'Eine Bedingung darf hoechstens ' . AVESMAPS_LORE_RULE_MAX_TYPES_PER_TERM . ' Landschaftsarten haben.'
                );
            }

            $types = [];
            // I2: je Bedingung DEDUPLIZIEREN -- lore_rule_term_type hat PRIMARY KEY
            // (term_id, kind, region_type) und der INSERT in avesmapsLoreRuleSave kennt kein
            // ON DUPLICATE KEY; ein doppelter Typ wuerfe dort mitten in der Ersetzung.
            $seenTypes = [];
            foreach ($rawTypes as $type) {
                $kind = avesmapsNormalizeSingleLine((string) ($type['kind'] ?? ''), 20);
                $regionType = avesmapsNormalizeSingleLine((string) ($type['region_type'] ?? ''), 60);
                if ($kind === '' || $regionType === '') {
                    continue;
                }
                $seenKey = $kind . '|' . $regionType;
                if (isset($seenTypes[$seenKey])) {
                    continue;
                }
                $seenTypes[$seenKey] = true;
                $types[] = ['kind' => $kind, 'region_type' => $regionType];
            }
            $areaId = avesmapsNormalizeSingleLine((string) ($raw['area_public_id'] ?? ''), 36);
            $from = avesmapsNormalizeSingleLine((string) ($raw['climate_from'] ?? ''), 60);
            $to = avesmapsNormalizeSingleLine((string) ($raw['climate_to'] ?? ''), 60);
            // I1: ein UNBEKANNTER Zonenschluessel heisst fuer avesmapsLoreRuleZoneKeys "keine
            // Einschraenkung" ([] zurueck), aber avesmapsLoreRuleTermIsEmpty fragt nur, ob
            // climate_from !== null -- ein erfundener Schluessel kaeme so am Riegel
            // (avesmapsLoreRuleChainIsUnbounded) vorbei und traefe trotzdem alles. Ein
            // unbekannter Schluessel IST keine Einschraenkung, also wird er hier zu null
            // gesaeubert, damit der vorhandene Riegel ihn als leer erkennt.
            if ($from !== '' && !in_array($from, $zoneKeys, true)) {
                $from = '';
            }
            if ($to !== '' && !in_array($to, $zoneKeys, true)) {
                $to = '';
            }
            $out[] = [
                'join_op' => ((string) ($raw['join_op'] ?? 'und')) === 'oder' ? 'oder' : 'und',
                'area_public_id' => $areaId === '' ? null : $areaId,
                'climate_from' => ($from === '' || $to === '') ? null : $from,
                'climate_to' => ($from === '' || $to === '') ? null : $to,
                'types' => $types,
            ];
        }

        return $out;
    };

    switch ($action) {
        case 'detail':
            $detail = avesmapsLoreReadEntryDetail($pdo, $wikiKey);
            if ($detail === null) {
                avesmapsErrorResponse(404, 'not_found', 'Dieser Eintrag existiert nicht.');
            }
            avesmapsJsonResponse(200, ['ok' => true, 'entry' => $detail]);
            // no break -- avesmapsJsonResponse exits.

        case 'add_place':
            $result = avesmapsLoreAddPlace(
                $pdo,
                $wikiKey,
                (string) ($payload['place_title'] ?? ''),
                avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20)
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(400, (string) ($result['error'] ?? 'invalid_request'), 'Der Ort konnte nicht zugeordnet werden.');
            }
            avesmapsJsonResponse(200, $result + ['entry' => avesmapsLoreReadEntryDetail($pdo, $wikiKey)]);
            // no break

        case 'remove_place':
            $result = avesmapsLoreRemovePlace(
                $pdo,
                $wikiKey,
                avesmapsNormalizeSingleLine((string) ($payload['place_wiki_key'] ?? ''), 190),
                avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20),
                $user
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(404, (string) ($result['error'] ?? 'not_found'), 'Dieser Ort ist dem Eintrag nicht zugeordnet.');
            }
            avesmapsJsonResponse(200, $result + ['entry' => avesmapsLoreReadEntryDetail($pdo, $wikiKey)]);
            // no break

        case 'set_field':
            $result = avesmapsLoreSetField(
                $pdo,
                $wikiKey,
                avesmapsNormalizeSingleLine((string) ($payload['field'] ?? ''), 40),
                (string) ($payload['value'] ?? '')
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(400, (string) ($result['error'] ?? 'invalid_field'), 'Dieses Feld kann nicht gesetzt werden.');
            }
            avesmapsJsonResponse(200, $result + ['entry' => avesmapsLoreReadEntryDetail($pdo, $wikiKey)]);
            // no break

        case 'set_status':
            $result = avesmapsLoreSetEntryStatus(
                $pdo,
                $wikiKey,
                avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 20)
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(400, (string) ($result['error'] ?? 'invalid_request'), 'Dieser Status ist nicht erlaubt.');
            }
            avesmapsJsonResponse(200, $result);
            // no break

        // Schalter je Art (Menüband). Kein wiki_key -- das betrifft die ganze Art, nicht
        // einen Eintrag. Schreibt nur die app_setting-Zeile; die Daten bleiben unangetastet,
        // ein wieder eingeschaltetes „Spezies" ist sofort vollständig da.
        case 'set_kind_enabled':
            $kind = avesmapsNormalizeSingleLine((string) ($payload['kind'] ?? ''), 20);
            if (!in_array($kind, AVESMAPS_LORE_KINDS, true)) {
                avesmapsErrorResponse(400, 'unknown_kind', 'Diese Art gibt es nicht.');
            }
            $enabled = (bool) ($payload['enabled'] ?? false);
            avesmapsAppSettingSet($pdo, avesmapsLoreKindSettingKey($kind), $enabled ? '1' : '0');
            avesmapsJsonResponse(200, [
                'ok' => true,
                'kind' => $kind,
                'enabled' => $enabled,
                'kinds' => avesmapsLoreEnabledKinds($pdo),
            ]);
            // no break

        case 'preview_rule': {
            // Schreibt NICHTS -- die Vorschau ist reine Rechnung. Dieselbe Trennung wie bei
            // der Uebernahme-Vorschau: die Rechen-Haelfte fasst keine Nutztabelle an.
            $terms = $readTerms($payload);
            // M2: leere Bedingungen ergeben beweisbar eine leere Antwort
            // (avesmapsLoreRuleEvaluate) -- der Kurzschluss spart das Laden ALLER Flaechen und
            // ALLER Siedlungen (inklusive ~2.782 Punkt-in-Polygon-Tests) fuer ein Ergebnis, das
            // ohnehin [] ist.
            if ($terms === []) {
                avesmapsJsonResponse(200, [
                    'ok' => true,
                    'areas' => [],
                    'places' => [],
                    'counts' => ['areas' => 0, 'places' => 0],
                ]);
            }
            $areas = avesmapsLoreRuleReadAreas($pdo);
            $places = avesmapsLoreRuleReadPlaces($pdo);
            $result = avesmapsLoreRuleEvaluate($terms, $areas, $places, avesmapsLoreRuleOrderedZoneKeys($pdo));
            $named = static function (array $rows, array $ids): array {
                $byId = [];
                foreach ($rows as $row) {
                    $byId[(string) $row['public_id']] = (string) ($row['name'] ?? '');
                }
                $out = [];
                foreach ($ids as $id) {
                    $out[] = ['public_id' => $id, 'name' => $byId[$id] ?? ''];
                }

                return $out;
            };
            avesmapsJsonResponse(200, [
                'ok' => true,
                'areas' => $named($areas, $result['areas']),
                'places' => $named($places, $result['places']),
                'counts' => ['areas' => count($result['areas']), 'places' => count($result['places'])],
            ]);
            break;
        }

        case 'save_rule': {
            $terms = $readTerms($payload);
            if ($terms === []) {
                avesmapsErrorResponse(400, 'rule_empty', 'Eine Regel braucht mindestens eine Bedingung.');
            }
            // 💣 Fix-Runde 2: der Riegel selbst lebt jetzt in der reinen, testbaren Funktion
            // avesmapsLoreRuleChainIsUnbounded (lore-rule.php) -- inline (Fix-Runde 1) war er
            // ohne Datenbank+Anmeldung nicht automatisiert beweisbar. Hier nur noch der Aufruf.
            if (avesmapsLoreRuleChainIsUnbounded($terms)) {
                avesmapsErrorResponse(400, 'rule_matches_everything', 'Ohne eine Einschraenkung traefe die Regel alles.');
            }
            avesmapsLoreRuleEnsureTables($pdo);
            // I4: dieselbe Weisse Liste mit Rueckfall wie avesmapsLoreAddPlace
            // (lore-edit.php) -- keine zweite Kopie mit eigener Meinung.
            $relation = avesmapsLoreNormalizeRelation(
                avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20)
            );
            $ruleId = (int) ($payload['rule_id'] ?? 0);
            $saved = avesmapsLoreRuleSave(
                $pdo,
                $wikiKey,
                $terms,
                $relation,
                (int) ($user['id'] ?? 0) ?: null,
                $ruleId > 0 ? $ruleId : null
            );
            avesmapsJsonResponse(200, ['ok' => true, 'rule_id' => $saved]);
            break;
        }

        case 'delete_rule': {
            avesmapsLoreRuleEnsureTables($pdo);
            $ruleId = (int) ($payload['rule_id'] ?? 0);
            if ($ruleId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'rule_id ist erforderlich.');
            }
            // Fix-Runde 1, Befund 2: der wiki_key des Aufrufs entscheidet mit -- eine rule_id
            // aus einem FREMDEN Eintrag darf hier nicht durchkommen. Der Riegel selbst sitzt
            // in avesmapsLoreRuleDelete (WHERE-Klausel), nicht erst hier am Aufrufer.
            avesmapsJsonResponse(200, ['ok' => avesmapsLoreRuleDelete($pdo, $ruleId, $wikiKey)]);
            break;
        }

        default:
            avesmapsErrorResponse(400, 'unknown_action', 'Diese Aktion ist unbekannt.');
    }
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'lore_edit_failed', 'Die Bearbeitung ist fehlgeschlagen.');
}
