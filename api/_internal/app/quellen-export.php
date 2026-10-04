<?php

declare(strict_types=1);

// Die Quellen als MIGRATIONSBLOCK -- Bibliothek zu GET /api/app/feature-sources-export.php (Legacy-Export E1+)
// und zum Quellenteil von GET /api/app/lore-export.php (E2+). Auftrag von Avesmaps3D, 04.10.2026.
//
// Was die Kartennutzlast NICHT traegt und ein spaeterer Wiki-Abgleich in Avesmaps3D braucht:
//   - die von Hand UNTERDRUECKTEN Verknuepfungen (`feature_sources.status = 'suppressed'`, der Grabstein einer
//     geloeschten Wiki-Publikation -- avesmapsRemoveFeatureSource), sonst holte der naechste Abgleich sie zurueck;
//   - die HERKUNFT je Verknuepfung (`origin`: `manual` oder `wiki_publication`), sonst ist Handarbeit nicht von
//     Abgeglichenem zu unterscheiden;
//   - die IDENTITAET jeder Quelle (`url_hash` und `wiki_key`) -- URL-lose Publikationen sind sonst nicht
//     wiederzufinden.
// Die oeffentliche Nutzlast bleibt dafuer unveraendert (bis auf `wiki_key` am Katalog, E1).
//
// 🔴 POSITIVLISTE. `sources.created_by`, `feature_sources.created_by` und `source_corpus.updated_by` sind
// Editorenkennungen und gehen NIE hinaus; dasselbe gilt fuer jede kuenftige Spalte, bis sie hier eingetragen
// ist. Gewacht von api/_internal/app/__tests__/quellen-export-test.php.
//
// 🔴 NUR LESEN, KEIN DDL. Die Leser des Quellenmoduls (avesmapsReadFeatureSources*, avesmapsSourceCorpusReadAll)
// rufen ihre Ensure-Funktionen und sind deshalb hier tabu; benutzt werden nur die zwei REINEN Helfer
// avesmapsSourceCorpusKey und avesmapsSourceOwnFieldsParse. Fehlt eine Tabelle oder Spalte, ist das ein 500 --
// kein stilles „nichts vorhanden".
//
// ⚠️ ANZEIGEREIHENFOLGE. Legacy zeigt die Quellen eines Objekts in `s.is_official DESC, s.created_at ASC,
// s.id ASC` -- der Zeit, zu der die QUELLE in den Katalog kam, nicht der Verknuepfung (Editorliste, Infobox und
// Kartennutzlast benutzen dieselbe Klausel). `position` ist der Rang in genau dieser Ordnung, je Objekt ab 0,
// ueber ALLE Zustaende gezaehlt; die Liste steht bereits so sortiert da.
// ⚠️ `entity_active` sagt nur fuer die vier weich geloeschten Kartenarten etwas (Ort, Beschriftung, Weg,
// Kraftlinie -- AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES): ob das Kartenobjekt noch aktiv ist. Fuer alle
// anderen Arten ist es null. Die Kartennutzlast laesst die Verknuepfungen inaktiver Objekte weg; dieser Block
// nennt sie, damit Waisen ein Befund bleiben statt zu verschwinden.

require_once __DIR__ . '/export-rahmen.php';
require_once __DIR__ . '/feature-sources.php';
require_once __DIR__ . '/source-corpus.php';

// Die Felder je Katalogeintrag, in dieser Reihenfolge.
const AVESMAPS_QUELLEN_EXPORT_KATALOG_FELDER = [
    'id',
    'url_hash',
    'wiki_key',
    'url',
    'label',
    'type',
    'official',
    'license',
    'attribution',
    'corpus',
    'own_fields',
    'no_corpus',
];

// Die Felder je Verknuepfung, in dieser Reihenfolge.
const AVESMAPS_QUELLEN_EXPORT_VERKNUEPFUNG_FELDER = [
    'entity_type',
    'entity_public_id',
    'source_id',
    'source_url_hash',
    'status',
    'origin',
    'reference_kind',
    'pages',
    'note',
    'position',
    'entity_active',
];

// Die Felder je Korpus. Ohne `updated_by` (Editorenkennung) und ohne `updated_at`.
const AVESMAPS_QUELLEN_EXPORT_KORPUS_FELDER = [
    'corpus_key',
    'label',
    'form',
    'source_type',
    'license',
    'attribution',
    'is_official',
];

// Die Objektart der Vorkommen. Ihre Verknuepfungen reisen im Lore-Export (E2), nicht im allgemeinen Block.
const AVESMAPS_QUELLEN_EXPORT_LORE = 'lore';

/**
 * REIN: '' wird null, sonst die Zeichenkette -- „nicht erfasst" ist im Export null, nie ''.
 */
function avesmapsQuellenExportText(mixed $wert): ?string
{
    if ($wert === null) {
        return null;
    }
    $text = trim((string) $wert);

    return $text === '' ? null : $text;
}

/**
 * Die Korpora: Schluessel -> Eintrag. Ein einfacher SELECT, kein Ensure (avesmapsSourceCorpusReadAll legt die
 * Tabelle an und ist deshalb hier tabu).
 *
 * @return array<string, array<string,mixed>>
 */
function avesmapsQuellenExportKorpora(PDO $pdo): array
{
    $korpora = [];
    $statement = $pdo->query(
        'SELECT corpus_key, label, form, source_type, license, attribution, is_official FROM source_corpus ORDER BY corpus_key ASC'
    );
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $schluessel = (string) $zeile['corpus_key'];
        $korpora[$schluessel] = avesmapsExportProjektion([
            'corpus_key' => $schluessel,
            'label' => (string) $zeile['label'],
            'form' => (string) $zeile['form'],
            'source_type' => (string) $zeile['source_type'],
            'license' => (string) $zeile['license'],
            'attribution' => (string) $zeile['attribution'],
            'is_official' => (int) $zeile['is_official'] === 1,
        ], AVESMAPS_QUELLEN_EXPORT_KORPUS_FELDER);
    }

    return $korpora;
}

/**
 * Die Katalogzeilen aller Quellen, die an mindestens einer Verknuepfung des gewaehlten Bereichs haengen --
 * gleich welchen Zustands (auch eine Quelle, die nur noch als Grabstein vorkommt, muss identifizierbar sein).
 *
 * @param bool $nurLore true = Verknuepfungen der Vorkommen (E2), false = alle uebrigen (E1+)
 * @param array<string, array<string,mixed>> $korpora
 * @return list<array<string,mixed>>
 */
function avesmapsQuellenExportKatalog(PDO $pdo, bool $nurLore, array $korpora): array
{
    $statement = $pdo->prepare(
        'SELECT s.id, s.url_hash, s.wiki_key, s.url, s.label, s.source_type, s.is_official, s.license,
                s.attribution, s.own_fields, s.no_corpus
           FROM sources s
          WHERE EXISTS (
                SELECT 1 FROM feature_sources fs
                 WHERE fs.source_id = s.id AND fs.entity_type ' . ($nurLore ? '=' : '<>') . ' :lore
          )
          ORDER BY s.id ASC'
    );
    $statement->execute(['lore' => AVESMAPS_QUELLEN_EXPORT_LORE]);

    $katalog = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $url = (string) $zeile['url'];
        $korpus = avesmapsSourceCorpusKey($url);
        $katalog[] = avesmapsExportProjektion([
            'id' => (int) $zeile['id'],
            'url_hash' => (string) $zeile['url_hash'],
            'wiki_key' => avesmapsQuellenExportText($zeile['wiki_key']),
            'url' => $url,
            'label' => (string) $zeile['label'],
            'type' => (string) $zeile['source_type'],
            'official' => (int) $zeile['is_official'] === 1,
            // Leer heisst „nicht erfasst", nie „keine Lizenz" (AGENTS.md §11) -- deshalb null.
            'license' => avesmapsQuellenExportText($zeile['license']),
            'attribution' => avesmapsQuellenExportText($zeile['attribution']),
            // Wie die Kartennutzlast (avesmapsFeatureSourceApplyCorpusKey): nur ein BEKANNTER Korpus.
            'corpus' => ($korpus !== '' && isset($korpora[$korpus])) ? $korpus : null,
            'own_fields' => avesmapsSourceOwnFieldsParse((string) ($zeile['own_fields'] ?? '')),
            'no_corpus' => (int) ($zeile['no_corpus'] ?? 0) === 1,
        ], AVESMAPS_QUELLEN_EXPORT_KATALOG_FELDER);
    }

    return $katalog;
}

/**
 * Die Kennungen aller AKTIVEN Kartenobjekte -- fuer `entity_active`. Ein Satz, kein Join: so braucht die
 * Abfrage keine COLLATE-Klausel zwischen den zwei Kollationen (feature_sources traegt den Server-Standard).
 *
 * @return array<string, true>
 */
function avesmapsQuellenExportAktiveKartenobjekte(PDO $pdo): array
{
    $aktiv = [];
    foreach ($pdo->query('SELECT public_id FROM map_features WHERE is_active = 1')->fetchAll(PDO::FETCH_COLUMN) as $publicId) {
        $aktiv[(string) $publicId] = true;
    }

    return $aktiv;
}

/**
 * Alle Verknuepfungen des gewaehlten Bereichs -- genehmigte UND unterdrueckte, in Legacys Anzeigereihenfolge.
 *
 * ⚠️ LEFT JOIN, nicht JOIN: eine Verknuepfung, deren Katalogzeile fehlt, waere ein Befund; ein JOIN liesse sie
 * still verschwinden. Sie steht dann mit `source_url_hash: null` da.
 *
 * @param array<string, true>|null $aktiveKartenobjekte null = `entity_active` nicht rechnen (alles null)
 * @return list<array<string,mixed>>
 */
function avesmapsQuellenExportVerknuepfungen(PDO $pdo, bool $nurLore, ?array $aktiveKartenobjekte): array
{
    $statement = $pdo->prepare(
        'SELECT fs.entity_type, fs.entity_public_id, fs.source_id, fs.status, fs.origin, fs.reference_kind,
                fs.pages, fs.note, s.url_hash
           FROM feature_sources fs
           LEFT JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type ' . ($nurLore ? '=' : '<>') . ' :lore
          ORDER BY fs.entity_type ASC, fs.entity_public_id ASC, s.is_official DESC, s.created_at ASC, s.id ASC, fs.id ASC'
    );
    $statement->execute(['lore' => AVESMAPS_QUELLEN_EXPORT_LORE]);

    $verknuepfungen = [];
    $letztesObjekt = null;
    $position = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $entityType = (string) $zeile['entity_type'];
        $entityPublicId = (string) $zeile['entity_public_id'];
        $objekt = $entityType . ':' . $entityPublicId;
        $position = $objekt === $letztesObjekt ? $position + 1 : 0;
        $letztesObjekt = $objekt;

        $aktiv = null;
        if ($aktiveKartenobjekte !== null && in_array($entityType, AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES, true)) {
            $aktiv = isset($aktiveKartenobjekte[$entityPublicId]);
        }

        $verknuepfungen[] = avesmapsExportProjektion([
            'entity_type' => $entityType,
            'entity_public_id' => $entityPublicId,
            'source_id' => (int) $zeile['source_id'],
            'source_url_hash' => avesmapsQuellenExportText($zeile['url_hash']),
            'status' => (string) $zeile['status'],
            'origin' => (string) $zeile['origin'],
            'reference_kind' => avesmapsQuellenExportText($zeile['reference_kind']),
            'pages' => avesmapsQuellenExportText($zeile['pages']),
            'note' => avesmapsQuellenExportText($zeile['note']),
            'position' => $position,
            'entity_active' => $aktiv,
        ], AVESMAPS_QUELLEN_EXPORT_VERKNUEPFUNG_FELDER);
    }

    return $verknuepfungen;
}

/**
 * REIN: die Zaehler einer Verknuepfungsliste -- gesamt und je Zustand und Herkunft. Zur Gegenprobe beim
 * Aufrufer: die Listenlaenge muss die Gesamtzahl ergeben.
 *
 * @param list<array<string,mixed>> $verknuepfungen
 * @return array{links:int, by_status:array<string,int>, by_origin:array<string,int>}
 */
function avesmapsQuellenExportZaehler(array $verknuepfungen): array
{
    $nachStatus = [];
    $nachHerkunft = [];
    foreach ($verknuepfungen as $verknuepfung) {
        $status = (string) $verknuepfung['status'];
        $herkunft = (string) $verknuepfung['origin'];
        $nachStatus[$status] = ($nachStatus[$status] ?? 0) + 1;
        $nachHerkunft[$herkunft] = ($nachHerkunft[$herkunft] ?? 0) + 1;
    }
    ksort($nachStatus);
    ksort($nachHerkunft);

    return ['links' => count($verknuepfungen), 'by_status' => $nachStatus, 'by_origin' => $nachHerkunft];
}

/**
 * Der Fingerabdruck der Quellentabellen. Jeder Schreibweg auf Quellen hebt `map_revision` (Belege in
 * feature-sources.php, publication-sync.php, *-plan-apply.php); die Revision steht deshalb mit im Stand. Dazu
 * Zahl, hoechste Kennung und Zeitstempel je Tabelle und die Zaehler je Zustand -- ein Grabstein aendert keine
 * Zahl und keinen Zeitstempel, aber die Verteilung der Zustaende.
 */
function avesmapsQuellenExportFingerabdruck(PDO $pdo): string
{
    $statusVerteilung = $pdo->query(
        'SELECT entity_type, status, COUNT(*) AS anzahl FROM feature_sources GROUP BY entity_type, status ORDER BY entity_type, status'
    )->fetchAll(PDO::FETCH_ASSOC);

    return avesmapsExportTabellenFingerabdruck($pdo, [
        ['sources', 'created_at'],
        ['feature_sources', 'created_at'],
        ['source_corpus', 'updated_at', 'corpus_key'],
    ]) . '|' . json_encode($statusVerteilung);
}

// ---- E1+: GET /api/app/feature-sources-export.php ---------------------------------------------------------

/**
 * Der Migrationsblock der Quellen (ohne die Vorkommen): Katalog, Korpora, Verknuepfungen -- alles in einem
 * stillen Lesefenster.
 *
 * @param callable|null $lesen nur fuer Tests
 */
function avesmapsFeatureSourcesExportLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static function () use ($pdo): array {
        $korpora = avesmapsQuellenExportKorpora($pdo);

        return [
            'korpora' => array_values($korpora),
            'katalog' => avesmapsQuellenExportKatalog($pdo, false, $korpora),
            'verknuepfungen' => avesmapsQuellenExportVerknuepfungen($pdo, false, avesmapsQuellenExportAktiveKartenobjekte($pdo)),
        ];
    };
    $ergebnis = avesmapsExportStabilLesen(
        static fn (): array => [avesmapsExportMapRevision($pdo), avesmapsQuellenExportFingerabdruck($pdo)],
        $lesen
    );
    [$mapRevision, $fingerabdruck] = $ergebnis['stand'];
    $daten = $ergebnis['daten'];

    return [
        'ok' => true,
        'map_revision' => $mapRevision,
        'sources_revision' => avesmapsExportStempel('src', $fingerabdruck),
        'counts' => ['sources' => count($daten['katalog']), 'corpora' => count($daten['korpora'])]
            + avesmapsQuellenExportZaehler($daten['verknuepfungen']),
        'corpora' => $daten['korpora'],
        'sources' => $daten['katalog'],
        'links' => $daten['verknuepfungen'],
    ];
}
