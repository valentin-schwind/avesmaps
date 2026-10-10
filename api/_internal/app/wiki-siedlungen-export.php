<?php

declare(strict_types=1);

// Die Registry der Wiki-Siedlungen als lesender Export -- Bibliothek zu GET /api/app/wiki-siedlungen-export.php
// (X3, Auftrag Avesmaps3D 10.10.2026: project-control/legacy-requests/2026-10-10-wiki-siedlungsregistry-export.md im
// Repo avesmaps3D, Betreiberentscheid „A").
//
// WOZU. Der Ortseditor von Avesmaps3D fuehrt wie Legacys Liste „Alle Siedlungen" einen Reiter „Fehlt": die Siedlungen,
// die das Wiki kennt, die aber auf keinem Kartenobjekt liegen (in Legacy die Zeilen mit `state: 'half'` aus
// avesmapsWikiSettlementListLocations, api/_internal/wiki/settlements.php). Ihre Quelle ist die Registry
// `wiki_sync_pages`. Kein bisheriger Export traegt sie: X2 (wiki-zuordnung-export.php) nennt nur, was schon an einem
// Ort haengt.
//
// 🔴 SCHLUESSEL, NIE NAMEN. Je Zeile der kanonische Wiki-Key nach DERSELBEN Regel wie X1 `ziel_key` und X2 `wiki_key`
// (avesmapsWikiLinkzieleKey: Titel -> Weiterleitungstafel -> 'wiki:' . Slug; der Namensraum steckt im Slug). `orte`
// nennt die aktiven Orte, deren Nest `wiki_settlement` ueber seine Adresse auf GENAU diesen Key zeigt -- dieselbe Regel
// wie die Siedlungszeilen von X2 (avesmapsWikiLinkzieleKeyAusUrl). Hier wird kein Name verglichen.
// ⚠️ `legacy_auf_karte` ist Legacys EIGENES Urteil aus der Ortsliste (avesmapsIsTitleOnMap, map-presence.php), und das
// vergleicht gefaltete NAMEN (Kartenname oder Titel des Nests). Es reist als Beleg mit, damit Avesmaps3D seine Zahl
// „Fehlt" gegen die von Legacy halten kann. Ein Schluessel ist es nie.
//
// WELCHE ZEILEN. Die Ortsklassen aus AVESMAPS_ORTSKLASSEN (die fuenf Siedlungsgroessen, `gebaeude`, `stadtviertel`) --
// genau die Klassen, die Legacys Liste zeigt. Zeilen ohne oder mit anderer Klasse sind keine Orte und gehen nicht
// hinaus; ihre Zahl steht im Kopf. Ein Bauwerk, dessen Typ lineare Infrastruktur ist (Strasse, Mauer, Damm ...), blendet
// Legacys Liste aus (avesmapsWikiSettlementIsExcludedBuildingType). Es reist trotzdem MIT, mit
// `bauwerkstyp_ausgeschlossen: true`: eine Ausnahme soll sichtbar sein, nicht still fehlen.
//
// 🔴 NUR LESEN: jede Abfrage ein SELECT, kein DDL -- auch keine Schemaheilung der Registry. Fehlt eine Spalte, ist das
// ein 500, kein stilles „nichts vorhanden". Kein Abruf am Wiki, keine Sitzung, kein Schreibweg.
//
// WARUM OEFFENTLICH, wie X1 und X2. Jede ausgegebene Spalte spiegelt die oeffentliche Wiki Aventurica (Titel, Klasse,
// Lage, Standort, Kontinent, Ruine) oder ist ein Urteil ueber die oeffentliche Karte; Personenbezug traegt die Registry
// nicht. Die oeffentliche Kartensuche nennt dieselben Zeilen schon heute („nicht auf der Karte", offmap-search.php).
// NICHT auf der Positivliste und damit nie in der Antwort: `details_json` (Zwischenspeicher der Infobox),
// `categories_json`, `coordinates_json`, `content_hash`, `deity` und die Wappenadresse samt Lizenzfeldern (Medien sind
// Sache von E5; hier steht nur `hat_wappen`).
//
// ⚠️ Gross wie X2 (tausende Zeilen) und ohne Drossel: ein Werkzeug holt die Antwort auf Zuruf, nie in einer Schleife.

require_once __DIR__ . '/export-rahmen.php';
// Die Schluesselregel von X1 und X2 (avesmapsWikiLinkzieleKey, ...KeyAusUrl, ...TitelDaten, ...Aliase, ...Staende).
require_once __DIR__ . '/wiki-linkziele-export.php';
require_once __DIR__ . '/../ortsklassen.php';
require_once __DIR__ . '/../wiki/place-kinds.php';
require_once __DIR__ . '/../wiki/map-presence.php';

// Die Felder je Siedlung (Positivliste; der Test faellt fuer jedes weitere Feld).
const AVESMAPS_WIKI_SIEDLUNGEN_EXPORT_FELDER = [
    'titel',
    'wiki_key',
    'ns',
    'ns_name',
    'weiterleitung_auf',
    'wiki_url',
    'ortsklasse',
    'ortsklasse_label',
    'bauwerkstyp',
    'bauwerkstyp_ausgeschlossen',
    'ist_ruine',
    'kontinent',
    'lage',
    'standort',
    'hat_wappen',
    'abgerufen_am',
    'angereichert_am',
    'orte',
    'legacy_auf_karte',
];

/** REIN: ein Text der Registry, leer heisst null -- „fehlt" und „ist leer" sagen dort dasselbe (siehe dump-entity-scan.php). */
function avesmapsWikiSiedlungenExportText(mixed $wert): ?string
{
    $text = trim((string) ($wert ?? ''));

    return $text === '' ? null : $text;
}

/**
 * Die Siedlungszeilen der Registry, nach Titel geordnet (der Titel ist dort eindeutig).
 *
 * Die Tabelle heisst in settlements.php AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE. Die Datei wird hier mit Absicht NICHT geladen:
 * sie zieht Wappen-, Innerorts- und Schemaheilung nach.
 * ⚠️ Geordnet wird in PHP, nicht per ORDER BY: die Sortierfolge der Datenbank haengt an ihrer Kollation, der Inhalts-ETag
 * soll es nicht.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsWikiSiedlungenExportRegistry(PDO $pdo): array
{
    $statement = $pdo->prepare(
        'SELECT title, wiki_url, settlement_class, settlement_label, building_type, is_ruined, continent, lage, standort,
                coat_url, fetched_at, enriched_at
           FROM wiki_sync_pages
          WHERE settlement_class IN (' . implode(', ', array_fill(0, count(AVESMAPS_ORTSKLASSEN), '?')) . ')'
    );
    $statement->execute(AVESMAPS_ORTSKLASSEN);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC);
    usort($zeilen, static fn(array $a, array $b): int => strcmp((string) $a['title'], (string) $b['title']));

    return $zeilen;
}

/**
 * Die Zahl der Registry-Zeilen je Klasse -- auch der Zeilen, die nicht hinausgehen (keine oder eine andere Klasse).
 *
 * @return array<string,int> Klasse ('' fuer keine) => Anzahl
 */
function avesmapsWikiSiedlungenExportKlassen(PDO $pdo): array
{
    $statement = $pdo->query('SELECT settlement_class, COUNT(*) AS anzahl FROM wiki_sync_pages GROUP BY settlement_class');
    $klassen = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $klasse = trim((string) ($zeile['settlement_class'] ?? ''));
        $klassen[$klasse] = ($klassen[$klasse] ?? 0) + (int) $zeile['anzahl'];
    }

    return $klassen;
}

/**
 * Die aktiven Orte der Karte -- dieselbe Auswahl wie Legacys Ortsliste, aber OHNE deren Filter auf einen Namen: ein Ort
 * ohne Namen kann eine Zuweisung tragen (X2 nennt ihn), nur die Namensprobe der Liste laesst ihn aus.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsWikiSiedlungenExportOrtsZeilen(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT public_id, name, feature_subtype, properties_json FROM map_features
          WHERE feature_type = 'location' AND is_active = 1
          ORDER BY id ASC"
    );

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

/**
 * REIN: Key => die Kennungen der aktiven Orte, deren Nest `wiki_settlement` auf ihn zeigt (nach Kennung geordnet).
 *
 * 🔴 Dieselbe Regel wie die Siedlungszeilen von X2: die Adresse des Nests durch avesmapsWikiLinkzieleKeyAusUrl, nie das
 * flache `wiki_url` am Ort (das raet der Lesepfad der Karte bei Leere per Namen nach) und nie ein Name.
 *
 * @param list<array<string,mixed>> $orte
 * @param array<string,string> $aliase
 * @return array<string,list<string>>
 */
function avesmapsWikiSiedlungenExportOrteJeSchluessel(array $orte, array $aliase): array
{
    $jeSchluessel = [];
    foreach ($orte as $ort) {
        $eigenschaften = json_decode((string) ($ort['properties_json'] ?? ''), true);
        $nest = is_array($eigenschaften) ? ($eigenschaften['wiki_settlement'] ?? null) : null;
        $adresse = is_array($nest) ? trim((string) ($nest['wiki_url'] ?? '')) : '';
        if ($adresse === '') {
            continue;
        }
        $schluessel = avesmapsWikiLinkzieleKeyAusUrl($adresse, $aliase);
        if ($schluessel !== '') {
            $jeSchluessel[$schluessel][] = (string) $ort['public_id'];
        }
    }
    foreach ($jeSchluessel as &$kennungen) {
        $kennungen = array_values(array_unique($kennungen));
        sort($kennungen, SORT_STRING);
    }
    unset($kennungen);

    return $jeSchluessel;
}

/**
 * REIN: eine Registry-Zeile in der Form der Antwort.
 *
 * @param array<string,mixed> $zeile
 * @param array<string,string> $aliase
 * @param array<string,list<string>> $orteJeSchluessel
 * @param array<string,bool> $praesenz Legacys Namensindex der Ortsliste (avesmapsBuildMapPresenceIndex)
 * @return array<string,mixed>
 */
function avesmapsWikiSiedlungenExportZeile(array $zeile, array $aliase, array $orteJeSchluessel, array $praesenz): array
{
    $titel = (string) $zeile['title'];
    // Ohne Index des Dump-Laufs: eine Weiterleitung nennt ihren Ziel-Key, Titel und Namensraum der Zielseite bleiben null
    // (dieselbe Form wie X2, wenn der Sandkasten die Seite nicht kennt).
    $daten = avesmapsWikiLinkzieleTitelDaten($titel, $aliase, []);
    $schluessel = (string) ($daten['key'] ?? '');
    $bauwerkstyp = avesmapsWikiSiedlungenExportText($zeile['building_type'] ?? null);
    $ruine = $zeile['is_ruined'] ?? null;

    return avesmapsExportProjektion([
        'titel' => $titel,
        'wiki_key' => $schluessel === '' ? null : $schluessel,
        'ns' => (int) $daten['ns'],
        'ns_name' => (string) $daten['ns_name'],
        'weiterleitung_auf' => $daten['weiterleitung_auf'] ?? null,
        'wiki_url' => avesmapsWikiSiedlungenExportText($zeile['wiki_url'] ?? null),
        'ortsklasse' => trim((string) $zeile['settlement_class']),
        'ortsklasse_label' => avesmapsWikiSiedlungenExportText($zeile['settlement_label'] ?? null),
        'bauwerkstyp' => $bauwerkstyp,
        'bauwerkstyp_ausgeschlossen' => $bauwerkstyp !== null && avesmapsWikiSettlementIsExcludedBuildingType($bauwerkstyp),
        'ist_ruine' => $ruine === null ? null : (int) $ruine !== 0,
        'kontinent' => avesmapsWikiSiedlungenExportText($zeile['continent'] ?? null),
        'lage' => avesmapsWikiSiedlungenExportText($zeile['lage'] ?? null),
        'standort' => avesmapsWikiSiedlungenExportText($zeile['standort'] ?? null),
        'hat_wappen' => avesmapsWikiSiedlungenExportText($zeile['coat_url'] ?? null) !== null,
        'abgerufen_am' => avesmapsWikiSiedlungenExportText($zeile['fetched_at'] ?? null),
        'angereichert_am' => avesmapsWikiSiedlungenExportText($zeile['enriched_at'] ?? null),
        'orte' => $schluessel === '' ? [] : ($orteJeSchluessel[$schluessel] ?? []),
        'legacy_auf_karte' => avesmapsIsTitleOnMap($titel, $praesenz),
    ], AVESMAPS_WIKI_SIEDLUNGEN_EXPORT_FELDER);
}

/**
 * Die Daten der Antwort: die Siedlungen und ihr Kopf.
 *
 * @return array{siedlungen: list<array<string,mixed>>, kopf: array<string,mixed>}
 */
function avesmapsWikiSiedlungenExportDaten(PDO $pdo): array
{
    $aliase = avesmapsWikiLinkzieleAliase($pdo);
    $orte = avesmapsWikiSiedlungenExportOrtsZeilen($pdo);
    $orteJeSchluessel = avesmapsWikiSiedlungenExportOrteJeSchluessel($orte, $aliase);
    // Legacys Namensprobe sieht nur Orte MIT Namen (die Ortsliste fragt `name <> ''`).
    $praesenz = avesmapsBuildMapPresenceIndex(array_values(array_filter(
        $orte,
        static fn(array $ort): bool => (string) ($ort['name'] ?? '') !== ''
    )));

    $siedlungen = [];
    foreach (avesmapsWikiSiedlungenExportRegistry($pdo) as $zeile) {
        $siedlungen[] = avesmapsWikiSiedlungenExportZeile($zeile, $aliase, $orteJeSchluessel, $praesenz);
    }

    $klassen = avesmapsWikiSiedlungenExportKlassen($pdo);
    $jeKlasse = [];
    foreach (AVESMAPS_ORTSKLASSEN as $klasse) {
        $jeKlasse[$klasse] = $klassen[$klasse] ?? 0;
    }
    $schluessel = array_values(array_filter(array_column($siedlungen, 'wiki_key'), static fn($key): bool => $key !== null));
    $mitOrt = count(array_filter($siedlungen, static fn(array $zeile): bool => $zeile['orte'] !== []));

    return [
        'siedlungen' => $siedlungen,
        'kopf' => [
            'registry_zeilen' => array_sum($klassen),
            'siedlungen' => count($siedlungen),
            'andere_klassen' => array_sum($klassen) - array_sum($jeKlasse),
            'je_klasse' => $jeKlasse,
            'ohne_schluessel' => count($siedlungen) - count($schluessel),
            'verschiedene_schluessel' => count(array_unique($schluessel)),
            'mit_ort' => $mitOrt,
            'ohne_ort' => count($siedlungen) - $mitOrt,
            'legacy_auf_karte' => count(array_filter($siedlungen, static fn(array $zeile): bool => $zeile['legacy_auf_karte'])),
            'bauwerkstyp_ausgeschlossen' => count(array_filter(
                $siedlungen,
                static fn(array $zeile): bool => $zeile['bauwerkstyp_ausgeschlossen']
            )),
        ],
    ];
}

/**
 * Der Stand, der waehrend des Lesens stillstehen muss: die Staende von X1 und X2 (map_revision, Weiterleitungstafel, ...;
 * DIESELBE Funktion, damit `map_revision` und `aliase_stempel` beider Antworten vergleichbar sind) und der Fingerabdruck
 * der Registry.
 *
 * ⚠️ Der Fingerabdruck sieht Zahl, hoechste Kennung und die juengsten Zeitstempel. Eine Zeile, deren Lage ohne neuen
 * Zeitstempel geaendert wird, sieht er nicht -- die deckt der Inhalts-ETag des Endpunkts (export-rahmen.php).
 *
 * @return array{0: array<string,int|string>, 1: string}
 */
function avesmapsWikiSiedlungenExportStand(PDO $pdo): array
{
    return [
        avesmapsWikiLinkzieleStaende($pdo),
        avesmapsExportTabellenFingerabdruck($pdo, [['wiki_sync_pages', 'fetched_at'], ['wiki_sync_pages', 'enriched_at']]),
    ];
}

/**
 * Die Antwort des Exports.
 *
 * @param callable|null $lesen nur fuer Tests (ein Lesen, waehrend dessen geschrieben wird)
 * @throws AvesmapsExportInBewegung
 */
function avesmapsWikiSiedlungenExportLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static fn(): array => avesmapsWikiSiedlungenExportDaten($pdo);
    $ergebnis = avesmapsExportStabilLesen(static fn(): array => avesmapsWikiSiedlungenExportStand($pdo), $lesen);
    [$staende, $fingerabdruck] = $ergebnis['stand'];

    return [
        'ok' => true,
        'map_revision' => (int) $staende['map_revision'],
        'aliase_stempel' => (string) $staende['aliase_stempel'],
        'registry_revision' => avesmapsExportStempel('wsp', $fingerabdruck),
        'kopf' => $ergebnis['daten']['kopf'],
        'siedlungen' => $ergebnis['daten']['siedlungen'],
    ];
}
