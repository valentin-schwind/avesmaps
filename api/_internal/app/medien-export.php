<?php

declare(strict_types=1);

// Die Medien als Manifest -- Bibliothek zu ZWEI Endpunkten (Legacy-Export E5 und E5+, Auftrag Avesmaps3D 04.10.2026;
// Media-Core-Plan von Avesmaps3D §9.1–§9.3):
//
//   Export A  GET /api/app/media-export.php              oeffentlich -- NUR, was Legacy heute jedem zeigt
//   Export B  GET /api/edit/migration/media-export.php   privat, Admin-Sitzung -- ALLES, samt Rechtenotizen, Urheber,
//                                                        Hochladestempel, nicht oeffentlichen Medien, Unterdrueckungen
//                                                        und den Migrationsbloecken fuer Literatur und Kartensammlung
//
// Legacy ist KEIN einheitliches Mediensystem: sechs Klassen mit je eigener Ablage, eigenem Lizenzfeld und eigener
// Herkunftsregel. Dieses Manifest vereinheitlicht nur die FORM, nie die Bedeutung -- Rechtecodes gehen ROH hinaus
// (`legacy_rights_code`), und `legacy_public` ist genau Legacys eigenes Gate je Klasse, keine neue Freigabe.
//
//   media_class        subject_kind  role     Ablage / Lizenzfeld
//   settlement_image   place         gallery  /uploads/siedlungen/<id>/…   properties.images[].license (fehlt = ai_generated)
//   settlement_coat    place         coat     /uploads/wappen/own|wiki|cache  properties.coat.license_status
//   territory_coat     territory     coat     /uploads/wappen/…            Override vor Staging (coat_of_arms_license_status)
//   citymap_full       citymap       full     /uploads/kartensammlungen/…  citymap.map_license
//   citymap_preview    citymap       preview  /uploads/kartensammlungen/…  citymap.thumb_license
//   literature_cover   literature    cover    /uploads/questcovers/…       adventure.cover_license
//
// `legacy_media_key` ist Legacys Identitaet, nicht das Zielmodell (Plan §9.3): `<art>:<subjekt>:[…:]<gespeicherte URL>`.
// Eine Unterdrueckung ohne Datei endet auf `:none`.
// `local_url` ist die Datei in unserem Speicher (`/uploads/…`, ohne `?v=`) oder null, wenn Legacy nur eine fremde
// Adresse kennt. Die Bytes selbst liefert dieser Export nicht -- bevorzugt kommt eine schreibgeschuetzte Kopie von
// `uploads/` vom Betreiber (Auftrag E5).
// `origin` je Klasse: Bilder `upload`/`external`; Wappen `custom` (Upload), `wiki_localized` (Wiki-Datei bei uns),
// `wiki_staging` (die Datei liegt nur im Wiki -- ohne Kopie im Wappen-Zwischenspeicher kann Legacy sie nicht zeigen,
// avesmapsPoliticalTerritoriesExportWappenDatei); Kartenbilder `upload`/`autoget`; Cover `upload`/`autoget`/`wiki_sync`/
// `unknown`.
//
// 🔴 EXPORT A IST STRENG: ein Medium steht nur darin, wenn Legacys Lizenz-Gate es durchlaesst, der zustaendige
// Anzeige-Schalter an ist und sein Objekt oeffentlich ist (Ort aktiv, Karte/Werk genehmigt, Sammlung an). Keine
// Notiz, kein Urheber, kein Hochladestempel, kein `thumb_auto_url` (ein Fremdbild ohne Rechte, nur fuer Editoren --
// es wird nicht einmal gelesen), keine Editorenkennung.
// 🔴 EXPORT B traegt Login-Namen (`uploaded_by`) und interne Notizen (Prompts, Rechtenotizen). Er gehoert hinter die
// Admin-Pruefung, die der Endpunkt VOR dem Lesen macht, und in keinen geteilten Zwischenspeicher.
// 🔴 Nur lesen, kein DDL. Die Schalter werden STRENG gelesen (ein Lesefehler wirft): Avesmaps3D legt die Antwort ab,
// und ein einziger Aussetzer duerfte keinen gedrueckten Notaus umgehen.
// ⚠️ Nur AKTIVE Orte und Gebiete Aventuriens; ein geloeschter Ort hat keine Medien mehr, die irgendwer zeigt.
// ⚠️ Die Wiki-Wappen-KANDIDATEN eines Ortes (`wiki_settlement.wappen_url` ohne Entscheid) sind keine gebundenen
// Medien und stehen nicht im Manifest -- Legacy zeigt sie nicht als Ortswappen.

require_once __DIR__ . '/export-rahmen.php';
require_once __DIR__ . '/app-setting.php';
require_once __DIR__ . '/coat-display.php';
require_once __DIR__ . '/political-territories-export.php';
require_once __DIR__ . '/citymaps.php';
require_once __DIR__ . '/game-literature.php';
require_once __DIR__ . '/../coat-url.php';
require_once __DIR__ . '/../media-license.php';

// Die Felder je Medium in BEIDEN Exporten (Plan §9.1).
const AVESMAPS_MEDIEN_EXPORT_FELDER = [
    'legacy_media_key',
    'media_class',
    'subject_kind',
    'subject_public_id',
    'role',
    'sort_order',
    'local_url',
    'origin',
    'legacy_rights_code',
    'legacy_public',
    'suppressed',
];

// Was Export B je Medium zusaetzlich traegt (Plan §9.2). Ein Feld, das eine Klasse nicht kennt, ist null.
const AVESMAPS_MEDIEN_EXPORT_PRIVAT_FELDER = [
    'stored_url',       // die gespeicherte Adresse, wie sie in der Datenbank steht (kann eine Wiki-Adresse sein)
    'source_url',       // die Wiki-Quelldatei einer lokalisierten Kopie, wo Legacy sie kennt
    'legacy_source',    // Ortswappen: own|wiki; Gebietswappen: override|territory|staging
    'license_text',     // Lizenz-Klartext des Wiki-Stands (Gebietswappen)
    'author',
    'attribution',
    'note',             // roh: Kommentar UND Prompt stehen bei Legacy im selben Feld
    'uploaded_by',      // Login-Name -- nur privat
    'uploaded_at',
    'shown',            // legacy_public UND Schalter an UND Objekt oeffentlich -- genau dann steht es in Export A
    'legacy_form',      // Ortsbilder: string (Altform) oder object
    'override_keys',    // Gebietswappen: die gesetzten Override-Schluessel
];

// Die Schalter, deren Stand beide Exporte im Kopf nennen.
const AVESMAPS_MEDIEN_EXPORT_SCHALTER = [
    'settlement_images',
    'coats_local',
    'coats_wiki',
    'citymaps',
    'citymap_previews',
    'game_literature',
    'game_literature_covers',
];

// E5+: die Migrationsbloecke in Export B.
const AVESMAPS_MEDIEN_EXPORT_WERK_FELDER = [
    'public_id', 'wiki_key', 'title', 'status', 'origin', 'authors', 'field_origins', 'synced_at',
    'wiki_url', 'link_ulisses', 'link_fshop',
    'cover_url', 'cover_license', 'cover_author', 'cover_note', 'cover_uploaded_by', 'cover_uploaded_at', 'cover_auto_state',
    'cover_source', 'places', 'links',
];
const AVESMAPS_MEDIEN_EXPORT_WERK_ORT_FELDER = [
    'sort_order', 'raw_name', 'target_kind', 'target_public_id', 'target_wiki_key', 'territory_path', 'role', 'origin', 'status',
    'created_from_source_id',
];
const AVESMAPS_MEDIEN_EXPORT_KARTE_FELDER = [
    'public_id', 'wiki_key', 'title', 'status', 'origin', 'article', 'author', 'map_url', 'map_url_label', 'is_paid',
    'map_license', 'map_license_note', 'map_license_author', 'map_uploaded_by', 'map_uploaded_at',
    'thumb_license', 'thumb_license_note', 'thumb_license_author', 'thumb_uploaded_by', 'thumb_uploaded_at',
    'thumb_origin', 'thumb_auto_state', 'places', 'links',
];
const AVESMAPS_MEDIEN_EXPORT_ARTIKEL_FELDER = ['url', 'key', 'title', 'origin', 'no_article'];
const AVESMAPS_MEDIEN_EXPORT_KARTE_ORT_FELDER = [
    'sort_order', 'raw_name', 'target_kind', 'target_public_id', 'target_wiki_key', 'territory_path', 'origin', 'status',
];
const AVESMAPS_MEDIEN_EXPORT_LINK_FELDER = ['label', 'url', 'is_paid', 'sort_order', 'origin', 'status'];

/** REIN: '' und null werden null, sonst der getrimmte Text. */
function avesmapsMedienExportText(mixed $wert): ?string
{
    if ($wert === null || is_array($wert)) {
        return null;
    }
    $text = trim((string) $wert);

    return $text === '' ? null : $text;
}

/** REIN: eine Adresse ohne angehaengten Cache-Stempel `?v=<zahl>`. */
function avesmapsMedienExportOhneStempel(string $url): string
{
    return preg_replace('/\?v=\d+$/', '', trim($url)) ?? trim($url);
}

/** REIN: die lokale Datei einer Adresse, oder null, wenn sie nicht in unserem Speicher liegt. */
function avesmapsMedienExportLokal(string $url): ?string
{
    $url = avesmapsMedienExportOhneStempel($url);

    return str_starts_with($url, '/uploads/') ? $url : null;
}

/**
 * REIN: ein Medium in der vollen (privaten) Form -- jedes Feld beider Listen, Unbekanntes null.
 *
 * @param array<string,mixed> $werte
 */
function avesmapsMedienExportEintrag(array $werte): array
{
    $eintrag = [];
    foreach (array_merge(AVESMAPS_MEDIEN_EXPORT_FELDER, AVESMAPS_MEDIEN_EXPORT_PRIVAT_FELDER) as $feld) {
        $eintrag[$feld] = $werte[$feld] ?? null;
    }
    $eintrag['sort_order'] = (int) ($eintrag['sort_order'] ?? 0);
    $eintrag['legacy_public'] = (bool) $eintrag['legacy_public'];
    $eintrag['suppressed'] = (bool) $eintrag['suppressed'];
    $eintrag['shown'] = (bool) $eintrag['shown'];

    return $eintrag;
}

/**
 * Die Schalter -- STRENG gelesen, ohne DDL. Die zwei Wappen-Schalter ueber dieselbe Vererbungsregel wie der
 * Gebietsexport (avesmapsPoliticalTerritoriesExportSchalter -> avesmapsCoatSchalterAusWerten).
 *
 * @return array<string,bool>
 */
function avesmapsMedienExportSchalter(PDO $pdo): array
{
    $an = static fn (string $schluessel): bool => avesmapsAppSettingGetStreng($pdo, $schluessel, '1') !== '0';

    return [
        'settlement_images' => $an('settlement_images_enabled'),
        'coats_local' => avesmapsPoliticalTerritoriesExportSchalter($pdo, AVESMAPS_COATS_LOCAL_SETTING),
        'coats_wiki' => avesmapsPoliticalTerritoriesExportSchalter($pdo, AVESMAPS_COATS_WIKI_SETTING),
        'citymaps' => $an(AVESMAPS_CITYMAPS_SETTING),
        'citymap_previews' => $an(AVESMAPS_CITYMAP_PREVIEWS_SETTING),
        'game_literature' => $an(AVESMAPS_GAME_LITERATURE_SETTING),
        'game_literature_covers' => $an(AVESMAPS_GAME_LITERATURE_COVERS_SETTING),
    ];
}

/**
 * Ortsbilder und Ortswappen aktiver Orte. Ein Vorfilter per LIKE haelt die Zahl der gelesenen JSON-Zeilen klein.
 *
 * ⚠️ Dieselben Regeln wie die Kartennutzlast (api/app/map-features.php): Bilder ueber
 * avesmapsMapFeaturesPublicImageUrls (eine Altform-Zeichenkette ist oeffentlich, ein Objekt ohne Lizenz ebenso --
 * Vorgabe ai_generated), Wappen: `coat_none` loescht das Wappen, eine Wiki-Adresse wird zur lokalen Kopie oder zu
 * nichts (avesmapsCoatLokaleKopie), dann das Lizenz-Gate (avesmapsSettlementCoatIsPublic), dann der Schalter nach
 * Herkunft.
 *
 * @param array<string,bool> $schalter
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportOrte(PDO $pdo, array $schalter): array
{
    $statement = $pdo->query(
        "SELECT public_id, properties_json FROM map_features
          WHERE feature_type = 'location' AND is_active = 1
            AND (properties_json LIKE '%\"images\"%' OR properties_json LIKE '%\"coat\"%' OR properties_json LIKE '%\"coat_none\"%')
          ORDER BY public_id ASC"
    );
    $medien = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $ort = (string) $zeile['public_id'];
        $eigenschaften = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($eigenschaften)) {
            continue;
        }

        foreach (array_values(is_array($eigenschaften['images'] ?? null) ? $eigenschaften['images'] : []) as $index => $bild) {
            $alsObjekt = is_array($bild);
            $url = trim($alsObjekt ? (string) ($bild['url'] ?? '') : (is_string($bild) ? $bild : ''));
            if ($url === '') {
                continue;
            }
            $oeffentlich = avesmapsMapFeaturesPublicImageUrls([$bild]) !== [];
            $medien[] = avesmapsMedienExportEintrag([
                'legacy_media_key' => 'settlement-image:' . $ort . ':' . $url,
                'media_class' => 'settlement_image',
                'subject_kind' => 'place',
                'subject_public_id' => $ort,
                'role' => 'gallery',
                'sort_order' => $index,
                'local_url' => avesmapsMedienExportLokal($url),
                'origin' => avesmapsMedienExportLokal($url) !== null ? 'upload' : 'external',
                'legacy_rights_code' => $alsObjekt ? avesmapsMedienExportText($bild['license'] ?? null) : null,
                'legacy_public' => $oeffentlich,
                'suppressed' => false,
                'stored_url' => $url,
                'author' => $alsObjekt ? avesmapsMedienExportText($bild['author'] ?? null) : null,
                'note' => $alsObjekt ? avesmapsMedienExportText($bild['note'] ?? null) : null,
                'uploaded_by' => $alsObjekt ? avesmapsMedienExportText($bild['uploaded_by'] ?? null) : null,
                'uploaded_at' => $alsObjekt ? avesmapsMedienExportText($bild['uploaded_at'] ?? null) : null,
                'shown' => $oeffentlich && $schalter['settlement_images'],
                'legacy_form' => $alsObjekt ? 'object' : 'string',
            ]);
        }

        if (($eigenschaften['coat_none'] ?? false) === true) {
            // Der dritte Zustand: „dieser Ort hat kein Wappen, und das bleibt so" -- eine Unterdrueckung, keine Datei.
            $medien[] = avesmapsMedienExportEintrag([
                'legacy_media_key' => 'settlement-coat:' . $ort . ':none',
                'media_class' => 'settlement_coat',
                'subject_kind' => 'place',
                'subject_public_id' => $ort,
                'role' => 'coat',
                'suppressed' => true,
                'stored_url' => avesmapsMedienExportText(is_array($eigenschaften['coat'] ?? null) ? ($eigenschaften['coat']['url'] ?? null) : null),
            ]);
            continue;
        }
        $wappen = $eigenschaften['coat'] ?? null;
        $gespeichert = is_array($wappen) ? trim((string) ($wappen['url'] ?? '')) : '';
        if ($gespeichert === '') {
            continue;
        }
        // Dieselbe Frage wie beim Gebietswappen: welche Datei liefert Legacy aus (unser Speicher oder die Kopie im
        // Wappen-Zwischenspeicher; eine fremde Adresse liefert coat.php nicht aus).
        $lokal = avesmapsPoliticalTerritoriesExportWappenDatei($gespeichert);
        $herkunft = (string) ($wappen['source'] ?? '');
        // Das Gate der Karte sieht die Adresse NACH der Lokalisierung: eine Wiki-Adresse ohne lokale Kopie ist leer.
        $oeffentlich = $lokal !== null && avesmapsSettlementCoatIsPublic(['url' => $lokal] + $wappen);
        $medien[] = avesmapsMedienExportEintrag([
            'legacy_media_key' => 'settlement-coat:' . $ort . ':' . $gespeichert,
            'media_class' => 'settlement_coat',
            'subject_kind' => 'place',
            'subject_public_id' => $ort,
            'role' => 'coat',
            'local_url' => $lokal,
            'origin' => $herkunft === 'own' ? 'custom' : ($lokal !== null ? 'wiki_localized' : 'wiki_staging'),
            'legacy_rights_code' => avesmapsMedienExportText($wappen['license_status'] ?? null),
            'legacy_public' => $oeffentlich,
            'suppressed' => false,
            'stored_url' => $gespeichert,
            'source_url' => avesmapsMedienExportText($wappen['wiki_url'] ?? null)
                ?? (avesmapsMedienExportLokal($gespeichert) === null ? $gespeichert : null),
            'legacy_source' => avesmapsMedienExportText($herkunft),
            'author' => avesmapsMedienExportText($wappen['author'] ?? null),
            'attribution' => avesmapsMedienExportText($wappen['attribution'] ?? null),
            'note' => avesmapsMedienExportText($wappen['note'] ?? null),
            'uploaded_by' => avesmapsMedienExportText($wappen['uploaded_by'] ?? null),
            'uploaded_at' => avesmapsMedienExportText($wappen['uploaded_at'] ?? null),
            'shown' => $oeffentlich && avesmapsCoatHerkunftErlaubt($herkunft, $schalter['coats_local'], $schalter['coats_wiki']),
        ]);
    }

    return $medien;
}

/**
 * Die Wappen aktiver Gebiete Aventuriens -- ueber DIESELBEN Fakten wie das `coat`-Objekt des Gebietsexports
 * (avesmapsPoliticalTerritoriesExportWappenFakten), nie eine zweite Rangfolge.
 *
 * @param array<string,bool> $schalter
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportGebiete(PDO $pdo, array $schalter): array
{
    $statement = $pdo->prepare(
        'SELECT public_id, wiki_key, coat_of_arms_url FROM political_territory
          WHERE is_active = 1 AND continent = :continent
          ORDER BY public_id ASC'
    );
    $statement->execute(['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);
    $staging = avesmapsPoliticalTerritoriesExportStaging($pdo);
    $overrides = avesmapsPoliticalTerritoriesExportOverrides($pdo);

    $medien = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $gebiet = (string) $zeile['public_id'];
        $wikiKey = trim((string) ($zeile['wiki_key'] ?? ''));
        $fakten = avesmapsPoliticalTerritoriesExportWappenFakten(
            trim((string) ($zeile['coat_of_arms_url'] ?? '')),
            $wikiKey !== '' ? ($staging[$wikiKey] ?? []) : [],
            $wikiKey !== '' ? ($overrides[$wikiKey] ?? []) : []
        );
        if ($fakten['state'] === 'none') {
            $medien[] = avesmapsMedienExportEintrag([
                'legacy_media_key' => 'territory-coat:' . $gebiet . ':override:none',
                'media_class' => 'territory_coat',
                'subject_kind' => 'territory',
                'subject_public_id' => $gebiet,
                'role' => 'coat',
                'suppressed' => true,
                'stored_url' => $fakten['suppressed_url'],
                'legacy_source' => 'override',
                'note' => $fakten['note'],
                'override_keys' => $fakten['override_keys'],
            ]);
            continue;
        }
        if ($fakten['url'] === null) {
            continue;
        }
        $wikiStaging = $wikiKey !== '' ? trim((string) (($staging[$wikiKey] ?? [])['coat_of_arms_url'] ?? '')) : '';
        $medien[] = avesmapsMedienExportEintrag([
            'legacy_media_key' => 'territory-coat:' . $gebiet . ':' . $fakten['source'] . ':' . $fakten['url'],
            'media_class' => 'territory_coat',
            'subject_kind' => 'territory',
            'subject_public_id' => $gebiet,
            'role' => 'coat',
            'local_url' => $fakten['local_url'],
            'origin' => $fakten['origin'],
            'legacy_rights_code' => $fakten['license_status'],
            'legacy_public' => $fakten['public'],
            'suppressed' => false,
            'stored_url' => $fakten['url'],
            'source_url' => ($fakten['origin'] === 'wiki_localized' && $wikiStaging !== '') ? $wikiStaging : null,
            'legacy_source' => $fakten['source'],
            'license_text' => $fakten['license'],
            'author' => $fakten['author'],
            'attribution' => $fakten['attribution'],
            'note' => $fakten['note'],
            'shown' => $fakten['public'] && $fakten['local_url'] !== null && avesmapsCoatHerkunftErlaubt((string) $fakten['herkunft'], $schalter['coats_local'], $schalter['coats_wiki']),
            'override_keys' => $fakten['override_keys'],
        ]);
    }

    return $medien;
}

/**
 * Die Bilder der Kartensammlung: Vollkarte (`map_local_url`) und Vorschau (`thumb_local_url`), je mit eigener Lizenz.
 * ⚠️ `thumb_auto_url` wird nicht gelesen (Fremdbild ohne Rechte, nur fuer Editoren).
 *
 * @param array<string,bool> $schalter
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportKarten(PDO $pdo, array $schalter): array
{
    $statement = $pdo->query(
        "SELECT public_id, status, map_local_url, map_license, map_license_note, map_license_author, map_uploaded_by, map_uploaded_at,
                thumb_local_url, thumb_license, thumb_license_note, thumb_license_author, thumb_uploaded_by, thumb_uploaded_at, thumb_origin
           FROM citymap
          WHERE (map_local_url IS NOT NULL AND map_local_url <> '') OR (thumb_local_url IS NOT NULL AND thumb_local_url <> '')
          ORDER BY public_id ASC"
    );
    $medien = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $karte = (string) $zeile['public_id'];
        $genehmigt = (string) $zeile['status'] === 'approved';
        foreach (['full' => 'map', 'preview' => 'thumb'] as $rolle => $slot) {
            $url = trim((string) ($zeile[$slot . '_local_url'] ?? ''));
            if ($url === '') {
                continue;
            }
            $oeffentlich = avesmapsCitymapLicenseIsFree($zeile[$slot . '_license'] ?? null);
            $schalterAn = $schalter['citymaps'] && ($rolle === 'full' || $schalter['citymap_previews']);
            $medien[] = avesmapsMedienExportEintrag([
                'legacy_media_key' => 'citymap:' . $karte . ':' . $rolle . ':' . $url,
                'media_class' => 'citymap_' . $rolle,
                'subject_kind' => 'citymap',
                'subject_public_id' => $karte,
                'role' => $rolle,
                'local_url' => avesmapsMedienExportLokal($url),
                'origin' => $rolle === 'preview' && avesmapsCitymapNormalizeThumbOrigin($zeile['thumb_origin'] ?? null) === 'auto' ? 'autoget' : 'upload',
                'legacy_rights_code' => avesmapsMedienExportText($zeile[$slot . '_license'] ?? null),
                'legacy_public' => $oeffentlich,
                'suppressed' => !$genehmigt,
                'stored_url' => $url,
                'author' => avesmapsMedienExportText($zeile[$slot . '_license_author'] ?? null),
                'note' => avesmapsMedienExportText($zeile[$slot . '_license_note'] ?? null),
                'uploaded_by' => avesmapsMedienExportText($zeile[$slot . '_uploaded_by'] ?? null),
                'uploaded_at' => avesmapsMedienExportText($zeile[$slot . '_uploaded_at'] ?? null),
                'shown' => $oeffentlich && $genehmigt && $schalterAn,
            ]);
        }
    }

    return $medien;
}

/**
 * Zeilen aus `adventure` samt `cover_source` (die Wiki-Datei, aus der der Abgleich das Cover lokal abgelegt hat).
 * ⚠️ Die Spalte legt erst der Wiki-Abgleich an (game-literature-sync.php). Fehlt sie, wird ohne sie gelesen und sie ist
 * null -- der zweite Anlauf ist ein SELECT, kein Schreiben.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportMitCoverQuelle(PDO $pdo, string $spalten, string $rest): array
{
    try {
        return $pdo->query('SELECT ' . $spalten . ', cover_source FROM adventure ' . $rest)->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return $pdo->query('SELECT ' . $spalten . ', NULL AS cover_source FROM adventure ' . $rest)->fetchAll(PDO::FETCH_ASSOC);
    }
}

/**
 * REIN: woher ein Cover kam -- `upload` (hochgeladen, nur dieser Weg stempelt cover_uploaded_*), `autoget` (der
 * Vorschau-Lauf, cover_auto_state = ok), `wiki_sync` (der Wiki-Abgleich hat die Datei `cover_source` lokal abgelegt),
 * sonst `unknown` (Altbestand ohne Spur).
 */
function avesmapsMedienExportCoverHerkunft(array $zeile): string
{
    if (avesmapsMedienExportText($zeile['cover_uploaded_at'] ?? null) !== null) {
        return 'upload';
    }
    if (trim((string) ($zeile['cover_auto_state'] ?? '')) === 'ok') {
        return 'autoget';
    }

    return avesmapsMedienExportText($zeile['cover_source'] ?? null) !== null ? 'wiki_sync' : 'unknown';
}

/**
 * Die Cover der Literatur. Gate wie der Katalog (avesmapsGameLiteratureCoverGatedUrl: eine fehlende Lizenz sperrt).
 *
 * @param array<string,bool> $schalter
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportCover(PDO $pdo, array $schalter): array
{
    $medien = [];
    foreach (avesmapsMedienExportMitCoverQuelle($pdo, 'public_id, status, cover_url, cover_license, cover_author, cover_note, cover_uploaded_by, cover_uploaded_at, cover_auto_state', "WHERE cover_url IS NOT NULL AND cover_url <> '' ORDER BY public_id ASC") as $zeile) {
        $werk = (string) $zeile['public_id'];
        $url = trim((string) $zeile['cover_url']);
        $genehmigt = (string) $zeile['status'] === 'approved';
        $oeffentlich = avesmapsGameLiteratureCoverGatedUrl($url, $zeile['cover_license'] ?? null) !== '';
        $herkunft = avesmapsMedienExportCoverHerkunft($zeile);
        $medien[] = avesmapsMedienExportEintrag([
            'legacy_media_key' => 'adventure:' . $werk . ':cover:' . $url,
            'media_class' => 'literature_cover',
            'subject_kind' => 'literature',
            'subject_public_id' => $werk,
            'role' => 'cover',
            'local_url' => avesmapsMedienExportLokal($url),
            'origin' => $herkunft,
            'legacy_rights_code' => avesmapsMedienExportText($zeile['cover_license'] ?? null),
            'legacy_public' => $oeffentlich,
            'suppressed' => !$genehmigt,
            'stored_url' => $url,
            'author' => avesmapsMedienExportText($zeile['cover_author'] ?? null),
            'note' => avesmapsMedienExportText($zeile['cover_note'] ?? null),
            'uploaded_by' => avesmapsMedienExportText($zeile['cover_uploaded_by'] ?? null),
            'uploaded_at' => avesmapsMedienExportText($zeile['cover_uploaded_at'] ?? null),
            'shown' => $oeffentlich && $genehmigt && $schalter['game_literature'] && $schalter['game_literature_covers'],
        ]);
    }

    return $medien;
}

/** REIN: eine JSON-Spalte gelesen, oder null. */
function avesmapsMedienExportJson(mixed $roh): ?array
{
    if ($roh === null || trim((string) $roh) === '') {
        return null;
    }
    $wert = json_decode((string) $roh, true);

    return is_array($wert) ? $wert : null;
}

/** REIN: ein Wahrheitswert mit drei Zustaenden (TINYINT NULL). */
function avesmapsMedienExportDreiwertig(mixed $roh): ?bool
{
    return $roh === null || $roh === '' ? null : ((int) $roh === 1);
}

/**
 * E5+: die Werke der Literatur -- ALLE Zustaende, mit den privaten Feldern und den Ortsbezuegen und Links samt
 * Herkunft und Zustand (auch die unterdrueckten).
 *
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportWerke(PDO $pdo): array
{
    $werke = [];
    foreach (avesmapsMedienExportMitCoverQuelle($pdo, 'id, public_id, wiki_key, title, status, origin, authors, field_origins_json, synced_at, wiki_url, link_ulisses, link_fshop,
                cover_url, cover_license, cover_author, cover_note, cover_uploaded_by, cover_uploaded_at, cover_auto_state', 'ORDER BY public_id ASC') as $zeile) {
        $werke[(int) $zeile['id']] = [
            'public_id' => (string) $zeile['public_id'],
            'wiki_key' => avesmapsMedienExportText($zeile['wiki_key']),
            'title' => (string) $zeile['title'],
            'status' => (string) $zeile['status'],
            'origin' => (string) $zeile['origin'],
            'authors' => avesmapsMedienExportText($zeile['authors']),
            'field_origins' => avesmapsMedienExportJson($zeile['field_origins_json']),
            'synced_at' => avesmapsMedienExportText($zeile['synced_at']),
            'wiki_url' => avesmapsMedienExportText($zeile['wiki_url']),
            'link_ulisses' => avesmapsMedienExportText($zeile['link_ulisses']),
            'link_fshop' => avesmapsMedienExportText($zeile['link_fshop']),
            'cover_url' => avesmapsMedienExportText($zeile['cover_url']),
            'cover_license' => avesmapsMedienExportText($zeile['cover_license']),
            'cover_author' => avesmapsMedienExportText($zeile['cover_author']),
            'cover_note' => avesmapsMedienExportText($zeile['cover_note']),
            'cover_uploaded_by' => avesmapsMedienExportText($zeile['cover_uploaded_by']),
            'cover_uploaded_at' => avesmapsMedienExportText($zeile['cover_uploaded_at']),
            'cover_auto_state' => avesmapsMedienExportText($zeile['cover_auto_state']),
            'cover_source' => avesmapsMedienExportText($zeile['cover_source']),
            'places' => [],
            'links' => [],
        ];
    }
    foreach ($pdo->query(
        'SELECT adventure_id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, target_territory_path, role,
                origin, status, created_from_source_id
           FROM adventure_place ORDER BY adventure_id ASC, sort_order ASC, id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $id = (int) $zeile['adventure_id'];
        if (!isset($werke[$id])) {
            continue;
        }
        $werke[$id]['places'][] = avesmapsExportProjektion([
            'sort_order' => (int) $zeile['sort_order'],
            'raw_name' => (string) $zeile['raw_name'],
            'target_kind' => (string) $zeile['target_kind'],
            'target_public_id' => avesmapsMedienExportText($zeile['target_public_id']),
            'target_wiki_key' => avesmapsMedienExportText($zeile['target_wiki_key']),
            'territory_path' => avesmapsMedienExportJson($zeile['target_territory_path']),
            'role' => (string) $zeile['role'],
            'origin' => (string) $zeile['origin'],
            'status' => (string) $zeile['status'],
            'created_from_source_id' => $zeile['created_from_source_id'] !== null ? (int) $zeile['created_from_source_id'] : null,
        ], AVESMAPS_MEDIEN_EXPORT_WERK_ORT_FELDER);
    }
    foreach ($pdo->query(
        'SELECT adventure_id, label, url, sort_order, origin, status FROM adventure_link ORDER BY adventure_id ASC, sort_order ASC, id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $id = (int) $zeile['adventure_id'];
        if (!isset($werke[$id])) {
            continue;
        }
        $werke[$id]['links'][] = avesmapsExportProjektion([
            'label' => (string) $zeile['label'],
            'url' => (string) $zeile['url'],
            'is_paid' => null,
            'sort_order' => (int) $zeile['sort_order'],
            'origin' => (string) $zeile['origin'],
            'status' => (string) $zeile['status'],
        ], AVESMAPS_MEDIEN_EXPORT_LINK_FELDER);
    }

    return array_values(array_map(
        static fn (array $werk): array => avesmapsExportProjektion($werk, AVESMAPS_MEDIEN_EXPORT_WERK_FELDER),
        $werke
    ));
}

/**
 * E5+: die Karten der Sammlung -- ALLE Zustaende, mit Bauschluessel, Wiki-Artikel-Zuordnung, Rechten und Stempeln je
 * Slot sowie Orten und Fundorten samt Herkunft und Zustand (auch die unterdrueckten).
 *
 * ⚠️ `citymap.wiki_key` (der BAUSCHLUESSEL `index:stadt:quelle:variante`, keine Seitenidentitaet) legt erst der
 * Wiki-Abgleich an (citymap-sync.php). Fehlt die Spalte, wird ohne sie gelesen und `wiki_key` ist null -- ein
 * Fehlschlag ist hier kein Schreiben, nur ein zweiter Anlauf.
 * ⚠️ Die Artikel-Zuordnung kennt genau einen dauerhaften Unterdrueckungszustand: `no_article = 1` („kein
 * Wiki-Artikel vorhanden"). Ein „Entfernen" im Zuordnungskasten speichert nur eine leere Adresse mit
 * `article_origin = manual` -- mehr haelt Legacy davon nicht fest.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsMedienExportKartenBlock(PDO $pdo): array
{
    $spalten = 'id, public_id, title, status, origin, author, map_url, map_url_label, is_paid, article_url, article_key, article_title, article_origin, no_article,
                map_license, map_license_note, map_license_author, map_uploaded_by, map_uploaded_at,
                thumb_license, thumb_license_note, thumb_license_author, thumb_uploaded_by, thumb_uploaded_at, thumb_origin, thumb_auto_state';
    try {
        $zeilen = $pdo->query('SELECT wiki_key, ' . $spalten . ' FROM citymap ORDER BY public_id ASC')->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        $zeilen = $pdo->query('SELECT NULL AS wiki_key, ' . $spalten . ' FROM citymap ORDER BY public_id ASC')->fetchAll(PDO::FETCH_ASSOC);
    }

    $karten = [];
    foreach ($zeilen as $zeile) {
        $karten[(int) $zeile['id']] = [
            'public_id' => (string) $zeile['public_id'],
            'wiki_key' => avesmapsMedienExportText($zeile['wiki_key']),
            'title' => (string) $zeile['title'],
            'status' => (string) $zeile['status'],
            'origin' => (string) $zeile['origin'],
            'article' => avesmapsExportProjektion([
                'url' => avesmapsMedienExportText($zeile['article_url']),
                'key' => avesmapsMedienExportText($zeile['article_key']),
                'title' => avesmapsMedienExportText($zeile['article_title']),
                'origin' => avesmapsMedienExportText($zeile['article_origin']),
                'no_article' => (int) ($zeile['no_article'] ?? 0) === 1,
            ], AVESMAPS_MEDIEN_EXPORT_ARTIKEL_FELDER),
            'author' => avesmapsMedienExportText($zeile['author']),
            'map_url' => avesmapsMedienExportText($zeile['map_url']),
            'map_url_label' => avesmapsMedienExportText($zeile['map_url_label']),
            'is_paid' => avesmapsMedienExportDreiwertig($zeile['is_paid']),
            'map_license' => avesmapsMedienExportText($zeile['map_license']),
            'map_license_note' => avesmapsMedienExportText($zeile['map_license_note']),
            'map_license_author' => avesmapsMedienExportText($zeile['map_license_author']),
            'map_uploaded_by' => avesmapsMedienExportText($zeile['map_uploaded_by']),
            'map_uploaded_at' => avesmapsMedienExportText($zeile['map_uploaded_at']),
            'thumb_license' => avesmapsMedienExportText($zeile['thumb_license']),
            'thumb_license_note' => avesmapsMedienExportText($zeile['thumb_license_note']),
            'thumb_license_author' => avesmapsMedienExportText($zeile['thumb_license_author']),
            'thumb_uploaded_by' => avesmapsMedienExportText($zeile['thumb_uploaded_by']),
            'thumb_uploaded_at' => avesmapsMedienExportText($zeile['thumb_uploaded_at']),
            'thumb_origin' => avesmapsMedienExportText($zeile['thumb_origin']),
            'thumb_auto_state' => avesmapsMedienExportText($zeile['thumb_auto_state']),
            'places' => [],
            'links' => [],
        ];
    }
    foreach ($pdo->query(
        'SELECT citymap_id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, target_territory_path, origin, status
           FROM citymap_place ORDER BY citymap_id ASC, sort_order ASC, id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $id = (int) $zeile['citymap_id'];
        if (!isset($karten[$id])) {
            continue;
        }
        $karten[$id]['places'][] = avesmapsExportProjektion([
            'sort_order' => (int) $zeile['sort_order'],
            'raw_name' => (string) $zeile['raw_name'],
            'target_kind' => (string) $zeile['target_kind'],
            'target_public_id' => avesmapsMedienExportText($zeile['target_public_id']),
            'target_wiki_key' => avesmapsMedienExportText($zeile['target_wiki_key']),
            'territory_path' => avesmapsMedienExportJson($zeile['target_territory_path']),
            'origin' => (string) $zeile['origin'],
            'status' => (string) $zeile['status'],
        ], AVESMAPS_MEDIEN_EXPORT_KARTE_ORT_FELDER);
    }
    foreach ($pdo->query(
        'SELECT citymap_id, label, url, is_paid, sort_order, origin, status FROM citymap_link ORDER BY citymap_id ASC, sort_order ASC, id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $id = (int) $zeile['citymap_id'];
        if (!isset($karten[$id])) {
            continue;
        }
        $karten[$id]['links'][] = avesmapsExportProjektion([
            'label' => (string) $zeile['label'],
            'url' => (string) $zeile['url'],
            'is_paid' => avesmapsMedienExportDreiwertig($zeile['is_paid']),
            'sort_order' => (int) $zeile['sort_order'],
            'origin' => (string) $zeile['origin'],
            'status' => (string) $zeile['status'],
        ], AVESMAPS_MEDIEN_EXPORT_LINK_FELDER);
    }

    return array_values(array_map(
        static fn (array $karte): array => avesmapsExportProjektion($karte, AVESMAPS_MEDIEN_EXPORT_KARTE_FELDER),
        $karten
    ));
}

/**
 * Der Stand: `map_revision` (Ortsbilder und Ortswappen heben sie) und der Fingerabdruck der uebrigen Quellen --
 * Kartensammlung (deren Uploads heben map_revision NICHT), Literatur, Gebiete samt Staging und Overrides, Schalter.
 */
function avesmapsMedienExportFingerabdruck(PDO $pdo): string
{
    return avesmapsExportTabellenFingerabdruck($pdo, [
        ['citymap', 'updated_at'],
        ['citymap_place', 'updated_at'],
        ['citymap_link', 'updated_at'],
        ['adventure', 'updated_at'],
        ['adventure_place', 'updated_at'],
        ['adventure_link', 'updated_at'],
        ['political_territory', 'updated_at'],
        ['political_territory_wiki_test', 'synced_at'],
        ['wiki_territory_model', 'updated_at'],
    ]) . '|' . avesmapsExportEinstellungenFingerabdruck($pdo, [
        'settlement_images_enabled',
        AVESMAPS_COATS_LOCAL_SETTING,
        AVESMAPS_COATS_WIKI_SETTING,
        AVESMAPS_SETTLEMENT_COATS_SETTING,
        AVESMAPS_TERRITORY_COATS_SETTING,
        AVESMAPS_CITYMAPS_SETTING,
        AVESMAPS_CITYMAP_PREVIEWS_SETTING,
        AVESMAPS_GAME_LITERATURE_SETTING,
        AVESMAPS_GAME_LITERATURE_COVERS_SETTING,
    ]);
}

/**
 * REIN: Zaehler je Klasse.
 *
 * @param list<array<string,mixed>> $medien
 * @return array<string,int>
 */
function avesmapsMedienExportZaehlerJeKlasse(array $medien): array
{
    $zaehler = [];
    foreach ($medien as $medium) {
        $klasse = (string) $medium['media_class'];
        $zaehler[$klasse] = ($zaehler[$klasse] ?? 0) + 1;
    }
    ksort($zaehler);

    return $zaehler;
}

/**
 * Lesen -- fuer Export A (`$privat = false`) oder Export B (`$privat = true`).
 *
 * @param callable|null $lesen nur fuer Tests
 */
function avesmapsMedienExportLesen(PDO $pdo, bool $privat, ?callable $lesen = null): array
{
    $lesen ??= static function () use ($pdo, $privat): array {
        $schalter = avesmapsMedienExportSchalter($pdo);
        $medien = array_merge(
            avesmapsMedienExportOrte($pdo, $schalter),
            avesmapsMedienExportGebiete($pdo, $schalter),
            avesmapsMedienExportKarten($pdo, $schalter),
            avesmapsMedienExportCover($pdo, $schalter)
        );

        return [
            'schalter' => $schalter,
            'medien' => $medien,
            'werke' => $privat ? avesmapsMedienExportWerke($pdo) : [],
            'karten' => $privat ? avesmapsMedienExportKartenBlock($pdo) : [],
        ];
    };
    $ergebnis = avesmapsExportStabilLesen(
        static fn (): array => [avesmapsExportMapRevision($pdo), avesmapsMedienExportFingerabdruck($pdo)],
        $lesen
    );
    [$mapRevision, $fingerabdruck] = $ergebnis['stand'];
    $daten = $ergebnis['daten'];

    if (!$privat) {
        // Export A: nur, was Legacy jedem zeigt -- und nur die oeffentlichen Felder.
        $oeffentlich = array_values(array_filter($daten['medien'], static fn (array $medium): bool => $medium['shown'] === true));
        $items = array_map(static fn (array $medium): array => avesmapsExportProjektion($medium, AVESMAPS_MEDIEN_EXPORT_FELDER), $oeffentlich);

        return [
            'ok' => true,
            'map_revision' => $mapRevision,
            'media_revision' => avesmapsExportStempel('media', $fingerabdruck),
            'switches' => $daten['schalter'],
            'counts' => ['items' => count($items), 'by_class' => avesmapsMedienExportZaehlerJeKlasse($items)],
            'items' => $items,
        ];
    }

    $medien = $daten['medien'];
    $nichtOeffentlich = count(array_filter($medien, static fn (array $m): bool => !$m['legacy_public'] && !$m['suppressed']));
    $unterdrueckt = count(array_filter($medien, static fn (array $m): bool => $m['suppressed']));
    $gezeigt = count(array_filter($medien, static fn (array $m): bool => $m['shown']));

    return [
        'ok' => true,
        'map_revision' => $mapRevision,
        'media_revision' => avesmapsExportStempel('media', $fingerabdruck),
        'switches' => $daten['schalter'],
        'counts' => [
            'items' => count($medien),
            'by_class' => avesmapsMedienExportZaehlerJeKlasse($medien),
            'shown' => $gezeigt,
            'not_public' => $nichtOeffentlich,
            'suppressed' => $unterdrueckt,
            'game_literature' => count($daten['werke']),
            'citymaps' => count($daten['karten']),
        ],
        'items' => $medien,
        'game_literature' => $daten['werke'],
        'citymaps' => $daten['karten'],
    ];
}
