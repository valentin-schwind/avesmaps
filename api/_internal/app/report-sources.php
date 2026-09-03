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
// Der Korpus einer Adresse -- reine Definitionen, beim Einbinden nebenwirkungsfrei (wie im Quellen-Endpunkt).
require_once __DIR__ . '/source-corpus.php';

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

/**
 * Die VORBELEGUNG einer gemeldeten Quelle fuer die Redaktion -- in DERSELBEN Form wie die Adressauskunft
 * der Eingabezeile (avesmapsSourceInspectUrl ohne Abruf): { url, state, title, site, http_status, corpus,
 * existing }. Damit kann der Quellen-Editor sie mit seinem vorhandenen Weg uebernehmen
 * (uebernehmeAuskunft in js/review/review-feature-sources.js) -- kein zweiter Vorbeleger.
 *
 * Entwurf §5.1. 🔴 KEIN Abruf nach draussen und KEIN Volltabellenlauf je Quelle: die Review-Liste laedt im
 * Bearbeiten-Modus alle 45 s. Korpora und Reichweite kommen vorgerechnet herein (einmal je Liste,
 * avesmapsSourceCorpusReadAll / avesmapsSourceCorpusUsageAll); der Katalog wird per url_hash (indiziert)
 * bzw. per id gefragt.
 *
 *   state „bekannt“   die Adresse steht im Katalog (existing gefuellt)
 *   state „katalog“   der Melder hat eine Katalogzeile gepickt (source_id; existing gefuellt)
 *   state „neu“       eine Adresse, die wir nicht kennen (corpus sagt, ob wenigstens der Wirt bekannt ist)
 *   state „ohne_link“ Altform ohne Adresse und ohne Kennung -- nicht verknuepfbar
 *
 * @param array<string,array> $korpora     avesmapsSourceCorpusReadAll($pdo)
 * @param array<string,array> $reichweite  avesmapsSourceCorpusUsageAll($pdo)
 */
function avesmapsReportSourceVorbelegung(PDO $pdo, array $quelle, array $korpora, array $reichweite): array
{
    $url = trim((string) ($quelle['url'] ?? ''));
    $sourceId = max(0, (int) ($quelle['source_id'] ?? 0));
    $aus = ['url' => $url, 'state' => 'ohne_link', 'http_status' => 0, 'title' => '', 'site' => '', 'corpus' => null, 'existing' => null];

    // ⚠️ MIT usage_count, wie die Adressauskunft (avesmapsSourceInspectUrl): uebernehmeAuskunft liest daraus
    //   „Zitiert an N Objekten" -- ohne die Zahl warnte der Annahme-Dialog bei einer gemeldeten bekannten Adresse
    //   leiser als bei derselben, von Hand eingetippten (Befund des Konsistenz-Agenten, 03.09.2026).
    $zeileZu = static function (array $zeile) use ($pdo): array {
        return [
            'source_id' => (int) $zeile['id'],
            'label' => (string) $zeile['label'],
            'source_type' => (string) $zeile['source_type'],
            'is_official' => (int) $zeile['is_official'] === 1,
            'license' => (string) ($zeile['license'] ?? ''),
            'attribution' => (string) ($zeile['attribution'] ?? ''),
            'usage_count' => avesmapsFeatureSourceUsageCount($pdo, (int) $zeile['id']),
        ];
    };
    $spalten = 'id, url, label, source_type, is_official, license, attribution';

    if ($sourceId > 0) {
        $s = $pdo->prepare("SELECT {$spalten} FROM sources WHERE id = :id LIMIT 1");
        $s->execute(['id' => $sourceId]);
        $zeile = $s->fetch(PDO::FETCH_ASSOC);
        if (is_array($zeile)) {
            $aus['existing'] = $zeileZu($zeile);
            $aus['state'] = 'katalog';
            $aus['title'] = (string) $zeile['label'];
            // Die Adresse der Katalogzeile, damit der Korpus benannt werden kann -- der Melder hat keine geschickt.
            $url = $url !== '' ? $url : trim((string) ($zeile['url'] ?? ''));
            $aus['url'] = $url;
        }
    } elseif ($url !== '') {
        $s = $pdo->prepare("SELECT {$spalten} FROM sources WHERE url_hash = :h LIMIT 1");
        $s->execute(['h' => avesmapsFeatureSourceHash($url)]);
        $zeile = $s->fetch(PDO::FETCH_ASSOC);
        if (is_array($zeile)) {
            $aus['existing'] = $zeileZu($zeile);
            $aus['state'] = 'bekannt';
            $aus['title'] = (string) $zeile['label'];
        } else {
            $aus['state'] = 'neu';
        }
    }

    if ($url !== '') {
        $korpus = avesmapsSourceCorpusForUrl($korpora, $url);
        if (is_array($korpus)) {
            $key = (string) ($korpus['corpus_key'] ?? '');
            $korpus['sources'] = (int) ($reichweite[$key]['sources'] ?? 0);
            $korpus['objects'] = (int) ($reichweite[$key]['objects'] ?? 0);
            $aus['corpus'] = $korpus;
        }
    }

    return $aus;
}

/**
 * Jede gemeldete Quelle bekommt ihre Vorbelegung -- Korpora und Reichweite EINMAL je Liste gelesen.
 * ⚠️ Faellt offen aus: ohne Korpus-Modul (function_exists) gibt es die Vorbelegung ohne Korpus, nie einen 500
 * in der Meldungsliste.
 *
 * @param list<array<string,mixed>> $sources
 * @return list<array<string,mixed>>
 */
function avesmapsReportSourcesMitVorbelegung(PDO $pdo, array $sources, ?array &$vorrat = null): array
{
    if ($sources === []) {
        return $sources;
    }
    if (!is_array($vorrat)) {
        $vorrat = [
            'korpora' => function_exists('avesmapsSourceCorpusReadAll') ? avesmapsSourceCorpusReadAll($pdo) : [],
            'reichweite' => function_exists('avesmapsSourceCorpusUsageAll') ? avesmapsSourceCorpusUsageAll($pdo) : [],
        ];
    }
    foreach ($sources as $i => $quelle) {
        $sources[$i]['vorbelegung'] = avesmapsReportSourceVorbelegung($pdo, $quelle, $vorrat['korpora'], $vorrat['reichweite']);
    }

    return $sources;
}
