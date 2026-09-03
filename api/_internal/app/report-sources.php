<?php

declare(strict_types=1);

/**
 * Die Quellen einer MELDUNG -- der Eingang (Normalisieren) und die Ausgabe (Dekodieren), EINMAL fuer
 * beide Endpunkte: api/app/report-location.php (der Melder schreibt) und api/edit/reports/locations.php
 * (die Redaktion liest). Bis zum 03.09.2026 stand der Eingang im einen und der Decoder im anderen.
 *
 * Entwurf docs/superpowers/specs/2026-09-03-quellen-meldeformular-design.md §2, §4. Owner 03.09.2026:
 * „sowohl änderungen als auch neue vorschläge müssen das mit dem link machen … ich will allerdings
 * nicht, dass externe nutzer was am korpus machen — die sollen einfach den link pasten. erst wir im
 * backend sollen sehen, ob der korpus passt oder ein neuer erkannt wurde.“
 *
 * 🔴 DER LINK IST DIE QUELLE: eine Zeile braucht `url` ODER `source_id > 0` (Treffer aus dem Katalog).
 *   Ein Name allein war bis dahin genug -- und genau so lagen die zwei link-losen, als „offiziell“
 *   markierten Zeilen im Livebestand (§1.2 des Entwurfs). Ohne Link keine Identitaet (`url_hash`).
 * 🔴 `official` UND `type` WERDEN NICHT MEHR UEBERNOMMEN -- was auch immer der Client schickt. Beides
 *   gehoert dem Korpus bzw. dem Kanon und wird im Backend aus der Adresse erkannt. 💣 Das ist der Riegel
 *   gegen den ALTEN Client: eine gecachte index.html schickt die Sechs-Felder-Zeile noch wochenlang,
 *   und keines dieser zwei Felder darf noch eine Aussage sein; sonst hinge der Riegel an der Ladefrist
 *   einer Datei.
 * ⚠️ Was der Melder sonst weiss -- Titel (`label`), Seite(n), Abdeckung, Lizenz, Namensnennung --
 *   reist als ANGEBOT mit: es fuellt im Backend Leeres vor und ueberschreibt nichts (§5.2).
 */

require_once __DIR__ . '/feature-sources.php';

const AVESMAPS_REPORT_SOURCES_MAX = 10;
const AVESMAPS_REPORT_SOURCE_KINDS = ['ausfuehrlich', 'ergaenzend', 'erwaehnung'];

/**
 * Der Eingang: aus dem Rumpf des Melders die gespeicherte Form (`sources_json`).
 *
 * @return list<array{source_id:int,url:string,label:string,pages:string,type:string,reference_kind:string,license:string,attribution:string,official:bool}>
 */
function avesmapsNormalizeReportSources(mixed $raw): array
{
    if (!is_array($raw)) {
        return [];
    }
    $normalized = [];
    foreach (array_slice(array_values($raw), 0, AVESMAPS_REPORT_SOURCES_MAX) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $sourceId = max(0, (int) ($entry['source_id'] ?? 0));
        $url = avesmapsNormalizeOptionalUrl((string) ($entry['url'] ?? ''), 500, 'Der Link zur Quelle');
        if ($url === '' && $sourceId === 0) {
            continue; // 🔴 ohne Link und ohne Katalogtreffer keine Quelle -- ein Name allein ist keine Identitaet
        }
        $kind = strtolower(avesmapsNormalizeSingleLine((string) ($entry['reference_kind'] ?? ''), 16));
        if (!in_array($kind, AVESMAPS_REPORT_SOURCE_KINDS, true)) {
            $kind = '';
        }
        $normalized[] = [
            'source_id' => $sourceId,
            'url' => $url,
            'label' => avesmapsNormalizeSingleLine((string) ($entry['label'] ?? ''), 200),
            'pages' => avesmapsNormalizeSingleLine((string) ($entry['pages'] ?? ''), 120),
            // 🔴 Nie aus dem Rumpf: Art und Kanon entscheidet der Korpus, beim Sichten.
            'type' => '',
            'official' => false,
            'reference_kind' => $kind,
            // ⚠️ Ein unbekannter Lizenzschluessel faellt auf '' = „nicht erfasst“, nie auf eine Aussage.
            'license' => avesmapsNormalizeSourceLicense((string) ($entry['license'] ?? '')),
            'attribution' => avesmapsNormalizeSingleLine((string) ($entry['attribution'] ?? ''), 200),
        ];
    }

    return $normalized;
}

/**
 * Die Ausgabe: `sources_json` (oder die Altform `source`, ein Freitext) als Liste fuer die Redaktion.
 *
 * ⚠️ Der Decoder ist NACHSICHTIG, der Eingang streng: gespeicherte Zeilen aus der Zeit vor dem
 * 03.09.2026 tragen `type` und `official` und koennen link-los sein. Sie werden gezeigt, wie sie sind
 * -- eine link-lose Zeile kann die Annahme nur nicht verknuepfen. Neue Felder (`source_id`, `license`,
 * `attribution`) fehlen dort und werden leer ergaenzt.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsDecodeReportSources(mixed $rawJson, string $legacyLabel = ''): array
{
    $decoded = is_string($rawJson) && $rawJson !== '' ? json_decode($rawJson, true) : null;
    $list = [];
    if (is_array($decoded)) {
        foreach ($decoded as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $label = trim((string) ($entry['label'] ?? ''));
            $url = trim((string) ($entry['url'] ?? ''));
            $sourceId = max(0, (int) ($entry['source_id'] ?? 0));
            if ($label === '' && $url === '' && $sourceId === 0) {
                continue;
            }
            $list[] = [
                'source_id' => $sourceId,
                'url' => $url,
                'label' => $label,
                'pages' => (string) ($entry['pages'] ?? ''),
                'type' => (string) ($entry['type'] ?? ''),
                'reference_kind' => (string) ($entry['reference_kind'] ?? ''),
                'license' => (string) ($entry['license'] ?? ''),
                'attribution' => (string) ($entry['attribution'] ?? ''),
                'official' => (bool) ($entry['official'] ?? false),
            ];
        }
    }
    if ($list === [] && trim($legacyLabel) !== '') {
        $list[] = ['source_id' => 0, 'url' => '', 'label' => trim($legacyLabel), 'pages' => '', 'type' => '',
            'reference_kind' => '', 'license' => '', 'attribution' => '', 'official' => false];
    }

    return $list;
}
