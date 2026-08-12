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
    $readTerms = static function (array $payload): array {
        $out = [];
        foreach ((array) ($payload['terms'] ?? []) as $raw) {
            $types = [];
            foreach ((array) ($raw['types'] ?? []) as $type) {
                $kind = avesmapsNormalizeSingleLine((string) ($type['kind'] ?? ''), 20);
                $regionType = avesmapsNormalizeSingleLine((string) ($type['region_type'] ?? ''), 60);
                if ($kind !== '' && $regionType !== '') {
                    $types[] = ['kind' => $kind, 'region_type' => $regionType];
                }
            }
            $areaId = avesmapsNormalizeSingleLine((string) ($raw['area_public_id'] ?? ''), 36);
            $from = avesmapsNormalizeSingleLine((string) ($raw['climate_from'] ?? ''), 60);
            $to = avesmapsNormalizeSingleLine((string) ($raw['climate_to'] ?? ''), 60);
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
            $result = avesmapsLoreRuleEvaluate(
                $terms,
                $areas = avesmapsLoreRuleReadAreas($pdo),
                $places = avesmapsLoreRuleReadPlaces($pdo),
                avesmapsLoreRuleOrderedZoneKeys($pdo)
            );
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
            $allEmpty = true;
            foreach ($terms as $term) {
                if (!avesmapsLoreRuleTermIsEmpty($term)) {
                    $allEmpty = false;
                    break;
                }
            }
            if ($allEmpty) {
                avesmapsErrorResponse(400, 'rule_matches_everything', 'Ohne eine Einschraenkung traefe die Regel alles.');
            }
            avesmapsLoreRuleEnsureTables($pdo);
            $relation = avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20);
            $ruleId = (int) ($payload['rule_id'] ?? 0);
            $saved = avesmapsLoreRuleSave(
                $pdo,
                $wikiKey,
                $terms,
                $relation === '' ? 'verbreitung' : $relation,
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
            avesmapsJsonResponse(200, ['ok' => avesmapsLoreRuleDelete($pdo, $ruleId)]);
            break;
        }

        default:
            avesmapsErrorResponse(400, 'unknown_action', 'Diese Aktion ist unbekannt.');
    }
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'lore_edit_failed', 'Die Bearbeitung ist fehlgeschlagen.');
}
