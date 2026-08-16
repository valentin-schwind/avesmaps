<?php

declare(strict_types=1);

/**
 * Die Alias-Zuordnung der Phase 2: alte Lizenzwerte -> Katalog-Kennungen, je Flaeche.
 *
 * 💣 WARUM DAS NICHT IM KATALOG STEHT (api/_internal/media-license.php): der Katalog traegt bewusst
 * KEINE Aliase. Wuerde er 'own' kennen, muesste jeder kuenftige Leser mitraten, ob ein Wert eine
 * Kennung oder ein historischer Rest ist -- und ein Alias, den niemand mehr braucht, faellt nie wieder
 * heraus. Das Wissen ueber die fuenf alten Vokabulare lebt deshalb hier, in der Datei, die es benutzt.
 *
 * 💣 UND SIE IST NICHT GLOBAL. Derselbe String heisst je nach Flaeche etwas anderes: 'own' bedeutet
 * bei den Siedlungs-Wappen "von einem Editor hochgeladen" -- fest verdrahtet in
 * settlement-coat-upload.php:98 --, und diese Wappen haben die Editoren nach und nach mit KI erzeugt
 * (Owner 16.08.2026), weshalb er zu 'ai_generated' wird und nicht zu 'own_work'. Eine Tabelle ohne
 * Flaeche haette diesen Unterschied verschluckt.
 *
 * ⚠️ Keine DB, kein Bootstrap, keine Seiteneffekte -- damit der Abnahmefall
 * (api/_internal/__tests__/media-license-migration-test.php) ohne Fixture beweisbar ist.
 */

require_once __DIR__ . '/media-license.php';

/**
 * Die fuenf Flaechen. Sie sind Bezeichner dieses Umbaus, keine Datenbankwerte -- nichts speichert sie.
 */
const AVESMAPS_MEDIA_LICENSE_SURFACES = [
    'settlement_coat',
    'territory_coat',
    'settlement_image',
    'citymap',
    'cover',
];

/**
 * Die Aliase je Flaeche. Was hier nicht steht, geht durch die normale Normalisierung.
 *
 * 🔴 territory_coat: 'attribution_required' faellt auf 'cc_by', und mit ihm CC-BY-SA, CC-BY-NC/ND,
 * generisches "Creative Commons" und GFDL -- der Wiki-Parser wirft sie alle in denselben Status
 * (sync-monitor-licenses.php:154-172). Folgenlos: sie sind saemtlich "nicht angezeigt", und die genaue
 * Bezeichnung bleibt im Klartextfeld coat_of_arms_license stehen. Es geht also keine Information
 * verloren, nur eine Unterscheidung, die der Katalog bewusst nicht anbietet.
 */
const AVESMAPS_MEDIA_LICENSE_LEGACY_ALIASES = [
    'settlement_coat' => [
        'own' => 'ai_generated',
    ],
    'territory_coat' => [
        'attribution_required' => 'cc_by',
        'unknown' => 'unknown_other',
    ],
    'settlement_image' => [],
    'citymap' => [],
    'cover' => [],
];

/**
 * Die Vorgabe je Flaeche fuer einen leeren oder fehlenden Wert -- das ist NICHT dieselbe Frage wie der
 * Alias. Ein leeres Feld heisst je Flaeche etwas anderes:
 *
 *   settlement_image  ai_generated       Legacy-Eintraege waren blanke URL-Strings und zaehlten seit je
 *                                        als ai_generated (api/app/map-features.php:408).
 *   cover             permission_granted Die Cover hatten ueberhaupt kein Feld und zeigen Ulisses-
 *                                        Produktcover: Genehmigung unter den Fan-Regeln (NOTICE.md),
 *                                        derselbe Wert, den die Karten-Vorschauen aus dem Wiki tragen
 *                                        (citymaps.php:2228). Owner-Entscheid 16.08.2026.
 *   citymap           unknown_other      Die Karten hatten diese Vorgabe schon, und zwar bewusst als
 *                                        NICHT-freien Wert (citymaps.php:49-51).
 *   die Wappen        unknown_other      Kein coat-Objekt heisst: es gibt gar kein Bild.
 */
const AVESMAPS_MEDIA_LICENSE_LEGACY_EMPTY_DEFAULT = [
    'settlement_coat' => 'unknown_other',
    'territory_coat' => 'unknown_other',
    'settlement_image' => 'ai_generated',
    'citymap' => 'unknown_other',
    'cover' => 'permission_granted',
];

/**
 * Ein Altwert einer Flaeche -> seine Katalog-Kennung.
 *
 * 🔴 IDEMPOTENT: ein Wert, der bereits eine Kennung ist, kommt unveraendert zurueck. Der Lauf ist
 * resumierbar und darf abbrechen; ein zweiter Durchgang ueber schon zugeordnete Zeilen muss folgenlos
 * sein, sonst waere jeder Wiederanlauf ein Datenrisiko.
 *
 * 💣 Eine unbekannte FLAECHE faellt auf 'unknown_other', nie auf etwas Oeffentliches: sonst machte ein
 * Tippfehler im Flaechennamen stillschweigend Bilder sichtbar. Ein bereits gueltiger Katalogwert
 * kommt aber auch dann durch -- er braucht die Flaeche nicht.
 */
function avesmapsMediaLicenseMigrateLegacy(string $surface, mixed $legacy): string
{
    $wert = is_string($legacy) ? trim($legacy) : '';

    // Schon eine Kennung? Dann ist nichts zu tun -- unabhaengig von der Flaeche (Idempotenz).
    if (in_array($wert, AVESMAPS_MEDIA_LICENSES, true)) {
        return $wert;
    }

    $vorgabe = AVESMAPS_MEDIA_LICENSE_LEGACY_EMPTY_DEFAULT[$surface] ?? 'unknown_other';
    if ($wert === '') {
        return $vorgabe;
    }

    $aliase = AVESMAPS_MEDIA_LICENSE_LEGACY_ALIASES[$surface] ?? [];
    if (array_key_exists($wert, $aliase)) {
        return $aliase[$wert];
    }

    // Ein unbekannter Nicht-Leerwert ist keine Vorgabefrage: er ist ungeklaert und damit still.
    return 'unknown_other';
}

/**
 * War ein Bild mit diesem Altwert VOR Phase 2 im Frontend sichtbar?
 *
 * 🔴 Das ist der halbe Abnahmefall und bildet die Gates ab, wie sie am 16.08.2026 tatsaechlich
 * standen -- nicht, wie sie sein sollten:
 *
 *   settlement_coat   KEIN GATE. properties.coat ging ungefiltert an die Karte
 *                     (api/app/map-features.php:464 kennt nur den An/Aus-Schalter), also war JEDER
 *                     gesetzte Wert sichtbar. Das Gate kommt erst in Phase 3.
 *   territory_coat    Nur 'public_domain' (AVESMAPS_COAT_PUBLIC_LICENSES, coat-url.php:45).
 *   settlement_image  Die vier Werte aus settlement-images.php:34, ohne 'unknown_other'.
 *   citymap           AVESMAPS_CITYMAP_LICENSES_FREE (citymaps.php:40) -- alles ausser 'unknown_other'.
 *   cover             KEIN FELD und kein Gate: ein vorhandenes Cover war immer sichtbar.
 *
 * ⚠️ Ein leerer Wert heisst bei den Wappen "es gibt gar kein Bild" -- unsichtbar, weil nichts da ist.
 * Bei den Covern heisst er das NICHT (dort gab es nie ein Feld); der Aufrufer fragt nur fuer Cover,
 * die eine cover_url tragen.
 */
function avesmapsMediaLicenseLegacyWasPublic(string $surface, mixed $legacy): bool
{
    $wert = is_string($legacy) ? trim($legacy) : '';

    return match ($surface) {
        'settlement_coat' => $wert !== '',
        'territory_coat' => $wert === 'public_domain',
        'settlement_image' => in_array(
            $wert !== '' ? $wert : 'ai_generated',
            ['public_domain', 'cc0', 'ai_generated'],
            true
        ),
        'citymap' => in_array(
            $wert,
            ['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'own_work'],
            true
        ),
        'cover' => true,
        default => false,
    };
}
