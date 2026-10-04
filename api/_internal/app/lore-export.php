<?php

declare(strict_types=1);

// Lore (Natur & Waren) als VOLL-EXPORT -- Bibliothek zu GET /api/app/lore-export.php (Legacy-Export E2 und E2+,
// Auftrag Avesmaps3D 04.10.2026). Der oeffentliche Lore-Endpunkt liefert nur je Ort bis zehn Eintraege und im
// Katalogmodus nur Eintraege seitenweise -- ohne Ortszeilen, Regeln und Quellen.
//
// Was hinausgeht, in vier Bloecken:
//   entries      lore_entry -- alle Zustaende (active, suppressed, retired), alle Felder ausser den ungenutzten
//                Bildspalten (`image_*`: ohne Anzeige und rechtlich offen, lore-sync.php). `merkmale_json` und
//                `field_origins_json` gehen GELESEN hinaus (`merkmale`, `field_origins`), nie als Zeichenkette.
//                ⚠️ `raw_json` gibt es an lore_entry nicht: die rohen Infobox-Parameter stehen in `merkmale_json`.
//                ⚠️ `match_key` ist der GESPEICHERTE Wert: er wird nur beim Anlegen geschrieben und bei einer
//                Umbenennung nicht nachgezogen (lore-plan-apply.php, lore-edit.php) -- er kann veraltet sein.
//   places       lore_place -- alle Zustaende, auch die Grabsteine (`status = 'suppressed'` einer Wiki-Zeile).
//                ⚠️ `place_kind` gibt es an lore_place NICHT (der Auftrag nannte es): eine Ortszeile traegt nur den
//                unaufgeloesten Wiki-Schluessel; welche Objektart er meint, entscheidet erst der Leser
//                (lore.php, avesmapsLoreReadPlaceKeysOnMap). Nichts wird hier erfunden.
//   rules        lore_rule samt Bedingungen (lore_rule_term, Reihenfolge `seq`) und deren Regionstypen
//                (lore_rule_term_type). Ausgewertet wird in Legacy strikt links nach rechts ohne Klammern, der
//                `join_op` der ersten Bedingung zaehlt nicht (lore-rule.php). `id` reist als Information mit.
//                OHNE `created_by` (Editorenkennung) und ohne `created_at`.
//   sources/links  die Quellen der Vorkommen (`feature_sources.entity_type = 'lore'`, entity_public_id = Eintrag)
//                -- genehmigte UND unterdrueckte, je mit Herkunft und Zustand, in Legacys Anzeigereihenfolge; dazu
//                die Katalogzeilen samt Identitaet. Dieselbe Form wie der Quellen-Migrationsblock (quellen-export.php).
//
// 🔴 Keine Personenspalte: lore_entry und lore_place haben keine, `lore_rule.created_by` und `feature_sources.created_by`
// stehen nicht auf den Positivlisten. Gewacht von api/_internal/app/__tests__/lore-export-test.php.
// 🔴 Nur lesen, kein DDL. Die Schalter je Art (`lore_kind_<art>_enabled`) sind der NOTAUS je Art (lore.php) und
// werden STRENG gelesen: eine abgeschaltete Art geht samt Ortszeilen, Regeln und Quellen NICHT hinaus -- derselbe
// Grundsatz wie der oeffentliche Lore-Endpunkt, das Medien-Manifest A und der Kartensammlungs-Katalog. `kinds_enabled`
// nennt den Stand, `counts.withheld_entries` die Zahl der zurueckgehaltenen Eintraege. Wer eine Art migrieren will,
// schaltet sie an.
// ⚠️ Es gibt keinen Lore-Revisionszaehler, und die Editor-Aktionen heben `map_revision` NICHT. Der Stand ist deshalb
// ein Fingerabdruck der Tabellen samt der Verteilung von Zustand, Herkunft und Beziehung (ein Grabstein aendert
// weder Zahl noch Kennung, und lore_place/lore_rule haben kein `updated_at`); den Rest deckt der Inhalts-ETag.

require_once __DIR__ . '/export-rahmen.php';
require_once __DIR__ . '/quellen-export.php';
require_once __DIR__ . '/app-setting.php';
require_once __DIR__ . '/lore.php';

const AVESMAPS_LORE_EXPORT_EINTRAG_FELDER = [
    'wiki_key',
    'kind',
    'name',
    'wiki_title',
    'wiki_url',
    'gruppe',
    'typ',
    'lebensraum',
    'synonyme',
    'merkmale',
    'continent',
    'origin',
    'status',
    'field_origins',
    'match_key',
];

const AVESMAPS_LORE_EXPORT_ORT_FELDER = [
    'entry_wiki_key',
    'place_wiki_key',
    'place_title',
    'relation',
    'sort_order',
    'origin',
    'status',
];

const AVESMAPS_LORE_EXPORT_REGEL_FELDER = ['id', 'entry_wiki_key', 'relation', 'origin', 'status', 'sort_order', 'terms'];
const AVESMAPS_LORE_EXPORT_BEDINGUNG_FELDER = ['seq', 'join_op', 'area_public_id', 'climate_from', 'climate_to', 'region_types'];
const AVESMAPS_LORE_EXPORT_REGIONSTYP_FELDER = ['kind', 'region_type'];

/**
 * REIN: eine JSON-Spalte gelesen -- Objekt/Liste, oder null (NULL, leer oder nicht lesbar).
 */
function avesmapsLoreExportJson(mixed $roh): ?array
{
    if ($roh === null || trim((string) $roh) === '') {
        return null;
    }
    $wert = json_decode((string) $roh, true);

    return is_array($wert) ? $wert : null;
}

/** @return list<array<string,mixed>> */
function avesmapsLoreExportEintraege(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT wiki_key, kind, name, wiki_title, wiki_url, gruppe, typ, lebensraum, synonyme, merkmale_json, continent,
                origin, status, field_origins_json, match_key
           FROM lore_entry
          ORDER BY wiki_key ASC'
    );
    $eintraege = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $zeile['merkmale'] = avesmapsLoreExportJson($zeile['merkmale_json']);
        $zeile['field_origins'] = avesmapsLoreExportJson($zeile['field_origins_json']);
        $eintraege[] = avesmapsExportProjektion($zeile, AVESMAPS_LORE_EXPORT_EINTRAG_FELDER);
    }

    return $eintraege;
}

/** @return list<array<string,mixed>> */
function avesmapsLoreExportOrte(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT entry_wiki_key, place_wiki_key, place_title, relation, sort_order, origin, status
           FROM lore_place
          ORDER BY entry_wiki_key ASC, sort_order ASC, id ASC'
    );
    $orte = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $zeile['sort_order'] = (int) $zeile['sort_order'];
        $orte[] = avesmapsExportProjektion($zeile, AVESMAPS_LORE_EXPORT_ORT_FELDER);
    }

    return $orte;
}

/**
 * Die Regeln samt Bedingungen und Regionstypen, verschachtelt. Drei Abfragen, nie je Regel.
 *
 * @return array{regeln: list<array<string,mixed>>, bedingungen: int, regionstypen: int, verwaiste_bedingungen: int}
 */
function avesmapsLoreExportRegeln(PDO $pdo): array
{
    $regeln = [];
    foreach ($pdo->query(
        'SELECT id, entry_wiki_key, relation, origin, status, sort_order FROM lore_rule ORDER BY entry_wiki_key ASC, sort_order ASC, id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $regeln[(int) $zeile['id']] = [
            'id' => (int) $zeile['id'],
            'entry_wiki_key' => (string) $zeile['entry_wiki_key'],
            'relation' => (string) $zeile['relation'],
            'origin' => (string) $zeile['origin'],
            'status' => (string) $zeile['status'],
            'sort_order' => (int) $zeile['sort_order'],
            'terms' => [],
        ];
    }

    $typenJeBedingung = [];
    $regionstypen = 0;
    foreach ($pdo->query(
        'SELECT term_id, kind, region_type FROM lore_rule_term_type ORDER BY term_id ASC, kind ASC, region_type ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $typenJeBedingung[(int) $zeile['term_id']][] = avesmapsExportProjektion([
            'kind' => (string) $zeile['kind'],
            'region_type' => (string) $zeile['region_type'],
        ], AVESMAPS_LORE_EXPORT_REGIONSTYP_FELDER);
        $regionstypen++;
    }

    $bedingungen = 0;
    $verwaist = 0;
    foreach ($pdo->query(
        'SELECT id, rule_id, seq, join_op, area_public_id, climate_from, climate_to FROM lore_rule_term ORDER BY rule_id ASC, seq ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $regelId = (int) $zeile['rule_id'];
        if (!isset($regeln[$regelId])) {
            // Eine Bedingung ohne Regel: ein Befund, der mitgezaehlt wird, statt still zu verschwinden.
            $verwaist++;
            continue;
        }
        $regeln[$regelId]['terms'][] = avesmapsExportProjektion([
            'seq' => (int) $zeile['seq'],
            'join_op' => (string) $zeile['join_op'],
            'area_public_id' => $zeile['area_public_id'] !== null ? (string) $zeile['area_public_id'] : null,
            'climate_from' => $zeile['climate_from'] !== null ? (string) $zeile['climate_from'] : null,
            'climate_to' => $zeile['climate_to'] !== null ? (string) $zeile['climate_to'] : null,
            'region_types' => $typenJeBedingung[(int) $zeile['id']] ?? [],
        ], AVESMAPS_LORE_EXPORT_BEDINGUNG_FELDER);
        $bedingungen++;
    }

    return [
        'regeln' => array_values(array_map(
            static fn (array $regel): array => avesmapsExportProjektion($regel, AVESMAPS_LORE_EXPORT_REGEL_FELDER),
            $regeln
        )),
        'bedingungen' => $bedingungen,
        'regionstypen' => $regionstypen,
        'verwaiste_bedingungen' => $verwaist,
    ];
}

/**
 * Die vier Schalter je Art -- STRENG (ein Lesefehler wirft) und ohne DDL. Dieselbe Vorgabe und derselbe Schluessel
 * wie avesmapsLoreKindEnabled; nur das Lesen ist eigen, weil jenes app_setting anlegt und bei einem Fehler auf
 * „an" faellt.
 *
 * @return array<string,bool>
 */
function avesmapsLoreExportArtenAn(PDO $pdo): array
{
    $an = [];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $roh = trim(avesmapsAppSettingGetStreng($pdo, avesmapsLoreKindSettingKey($kind), ''));
        $an[$kind] = $roh === '' ? avesmapsLoreKindDefaultEnabled($kind) : $roh !== '0';
    }

    return $an;
}

/**
 * Der Fingerabdruck der Lore-Tabellen. Siehe Kopf der Datei: kein Lore-Zaehler, die Editor-Aktionen heben
 * map_revision nicht.
 */
function avesmapsLoreExportFingerabdruck(PDO $pdo): string
{
    $verteilungOrte = $pdo->query(
        'SELECT relation, origin, status, COUNT(*) AS anzahl FROM lore_place GROUP BY relation, origin, status ORDER BY relation, origin, status'
    )->fetchAll(PDO::FETCH_ASSOC);
    $verteilungRegeln = $pdo->query(
        'SELECT relation, origin, status, COUNT(*) AS anzahl FROM lore_rule GROUP BY relation, origin, status ORDER BY relation, origin, status'
    )->fetchAll(PDO::FETCH_ASSOC);

    return avesmapsExportTabellenFingerabdruck($pdo, [
        ['lore_entry', 'updated_at'],
        ['lore_place', 'created_at'],
        ['lore_rule', 'created_at'],
        ['lore_rule_term', null],
        ['lore_rule_term_type', null, 'term_id'],
    ]) . '|' . json_encode([$verteilungOrte, $verteilungRegeln])
        . '|' . avesmapsExportEinstellungenFingerabdruck($pdo, array_map('avesmapsLoreKindSettingKey', AVESMAPS_LORE_KINDS))
        . '|' . avesmapsQuellenExportFingerabdruck($pdo);
}

/**
 * REIN: der Notaus je Art. Ein Eintrag einer abgeschalteten Art geht NICHT hinaus -- samt seinen Ortszeilen, Regeln
 * und Quellenverknuepfungen; der Katalog behaelt nur Quellen, die danach noch verknuepft sind. Gezaehlt wird er
 * trotzdem (`zurueckgehalten`), damit „abgeschaltet" von „leer" unterscheidbar bleibt.
 *
 * @param array<string,mixed> $daten
 * @return array<string,mixed> dieselbe Form, gefiltert, plus `zurueckgehalten`
 */
function avesmapsLoreExportNotausAnwenden(array $daten): array
{
    $gesperrt = [];
    $eintraege = [];
    foreach ($daten['eintraege'] as $eintrag) {
        if (($daten['arten'][(string) $eintrag['kind']] ?? true) === false) {
            $gesperrt[(string) $eintrag['wiki_key']] = true;
            continue;
        }
        $eintraege[] = $eintrag;
    }
    $frei = static fn (array $zeile, string $schluessel): bool => !isset($gesperrt[(string) $zeile[$schluessel]]);
    $verknuepfungen = array_values(array_filter($daten['verknuepfungen'], static fn (array $v): bool => $frei($v, 'entity_public_id')));
    $nochVerknuepft = array_flip(array_map(static fn (array $v): int => (int) $v['source_id'], $verknuepfungen));

    $daten['eintraege'] = $eintraege;
    $daten['orte'] = array_values(array_filter($daten['orte'], static fn (array $o): bool => $frei($o, 'entry_wiki_key')));
    $daten['regeln']['regeln'] = array_values(array_filter($daten['regeln']['regeln'], static fn (array $r): bool => $frei($r, 'entry_wiki_key')));
    $daten['verknuepfungen'] = $verknuepfungen;
    $daten['katalog'] = array_values(array_filter($daten['katalog'], static fn (array $q): bool => isset($nochVerknuepft[(int) $q['id']])));
    $daten['zurueckgehalten'] = count($gesperrt);

    return $daten;
}

/**
 * @param callable|null $lesen nur fuer Tests
 */
function avesmapsLoreExportLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static function () use ($pdo): array {
        $korpora = avesmapsQuellenExportKorpora($pdo);

        return [
            'arten' => avesmapsLoreExportArtenAn($pdo),
            'eintraege' => avesmapsLoreExportEintraege($pdo),
            'orte' => avesmapsLoreExportOrte($pdo),
            'regeln' => avesmapsLoreExportRegeln($pdo),
            'katalog' => avesmapsQuellenExportKatalog($pdo, true, $korpora),
            'verknuepfungen' => avesmapsQuellenExportVerknuepfungen($pdo, true, null),
        ];
    };
    $ergebnis = avesmapsExportStabilLesen(
        static fn (): array => [avesmapsExportMapRevision($pdo), avesmapsLoreExportFingerabdruck($pdo)],
        $lesen
    );
    [$mapRevision, $fingerabdruck] = $ergebnis['stand'];
    $daten = avesmapsLoreExportNotausAnwenden($ergebnis['daten']);
    $quellenZaehler = avesmapsQuellenExportZaehler($daten['verknuepfungen']);
    $bedingungen = 0;
    $regionstypen = 0;
    foreach ($daten['regeln']['regeln'] as $regel) {
        $bedingungen += count($regel['terms']);
        foreach ($regel['terms'] as $bedingung) {
            $regionstypen += count($bedingung['region_types']);
        }
    }

    return [
        'ok' => true,
        'map_revision' => $mapRevision,
        'lore_revision' => avesmapsExportStempel('lore', $fingerabdruck),
        'kinds_enabled' => $daten['arten'],
        'counts' => [
            'entries' => count($daten['eintraege']),
            'withheld_entries' => $daten['zurueckgehalten'],
            'places' => count($daten['orte']),
            'rules' => count($daten['regeln']['regeln']),
            'rule_terms' => $bedingungen,
            'rule_term_types' => $regionstypen,
            'orphaned_rule_terms' => $daten['regeln']['verwaiste_bedingungen'],
            'sources' => count($daten['katalog']),
            'links' => $quellenZaehler['links'],
            'links_by_status' => $quellenZaehler['by_status'],
            'links_by_origin' => $quellenZaehler['by_origin'],
        ],
        'entries' => $daten['eintraege'],
        'places' => $daten['orte'],
        'rules' => $daten['regeln']['regeln'],
        'sources' => $daten['katalog'],
        'links' => $daten['verknuepfungen'],
    ];
}
