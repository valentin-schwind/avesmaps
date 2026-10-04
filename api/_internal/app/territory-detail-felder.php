<?php

declare(strict_types=1);

// Die WIRKSAMEN Detailfelder eines Herrschaftsgebiets -- Override vor Staging. EINE Regel mit zwei Lesern:
// die Infobox der Karte (api/app/territory-detail.php) und der oeffentliche Gebietsexport
// (api/_internal/app/political-territories-export.php, Objekt `detail`, Legacy-Export E4).
//
// 🔴 WARUM HERAUSGELOEST (05.10.2026). Die Regel stand bis dahin nur im Endpunkt territory-detail.php, und der
// Export haette sie ein zweites Mal gebraucht -- samt der Sonderregel fuer Gruendung und Aufloesung, die man beim
// Abschreiben verliert. Zwei Fassungen derselben „wirksamen" Werte waeren genau die Divergenz, vor der dieses Haus
// warnt (die Wappen-Leser liefen einst viermal auseinander, Discord #32).
//
// ⚠️ EIN LEERER OVERRIDE IST EIN BEWUSSTER LEERWERT, kein fehlender: `array_key_exists`, nie `??`. Er schlaegt den
// Staging-Wert. Die Infobox laesst ihn einfach weg; der Export nennt ihn als "" -- so bleibt er von „kein Wert"
// (null) unterscheidbar.
// ⚠️ Override-Schluessel = Staging-Spalte = Feldname; eine Abbildungstabelle gibt es nicht.

// Die Felder, die die Infobox hebt. Schluessel = Staging-Spalte = Override-Schluessel.
const AVESMAPS_TERRITORY_DETAIL_FIELDS = [
    'name',
    'type',
    'status',
    'continent',
    'founded_text',
    'dissolved_text',
    'form_of_government',
    'capital_name',
    'seat_name',
    'ruler',
    'language',
    'currency',
    'population',
    'founder',
    'political',
    'trade_zone',
    'trade_goods',
    'geographic',
    'blazon',
    'affiliation_raw',
    'wiki_url',
];

/**
 * REIN: die wirksamen Werte aller Detailfelder.
 *
 * Je Feld: `wert` (getrimmt; '' heisst „kein Wert" -- bei `override = true` ein BEWUSSTER Leerwert) und `override`
 * (der Wert stammt aus dem Override, auch wenn er leer ist).
 *
 * Gruendung und Aufloesung haben eine Sonderregel (die steuernden Werte sind die BF-Spalten): Text-Override
 * (bewusst gesetzt) > BF-Override > Staging-Text. Ein leerer BF-Override der Gruendung loescht den Text, ein leerer
 * BF-Override der Aufloesung heisst „besteht" (Besatzungs-Korrektur), nicht „kein Wert".
 *
 * @param array<string,mixed> $staging   die Staging-Zeile (political_territory_wiki_test), [] wenn es keine gibt
 * @param array<string,mixed> $overrides das gelesene metadata_overrides_json, [] wenn es keins gibt
 * @return array<string, array{wert:string, override:bool}> in der Reihenfolge von AVESMAPS_TERRITORY_DETAIL_FIELDS
 */
function avesmapsTerritoryDetailWirksam(array $staging, array $overrides): array
{
    $felder = [];
    foreach (AVESMAPS_TERRITORY_DETAIL_FIELDS as $key) {
        $ausOverride = array_key_exists($key, $overrides);
        $felder[$key] = [
            'wert' => trim($ausOverride ? (string) $overrides[$key] : (string) ($staging[$key] ?? '')),
            'override' => $ausOverride,
        ];
    }

    if (!array_key_exists('founded_text', $overrides) && array_key_exists('founded_start_bf', $overrides)) {
        $bf = trim((string) $overrides['founded_start_bf']);
        $felder['founded_text'] = ['wert' => $bf === '' ? '' : avesmapsFormatBfYear((int) $bf), 'override' => true];
    }
    if (!array_key_exists('dissolved_text', $overrides) && array_key_exists('dissolved_end_bf', $overrides)) {
        $bf = trim((string) $overrides['dissolved_end_bf']);
        $felder['dissolved_text'] = ['wert' => $bf === '' ? 'besteht' : avesmapsFormatBfYear((int) $bf), 'override' => true];
    }

    return $felder;
}

/**
 * REIN: die Felder, wie die Infobox sie zeigt -- nur die nicht leeren Werte, Schluessel -> Wert.
 *
 * @return array<string,string>
 */
function avesmapsTerritoryDetailInfoboxFelder(array $staging, array $overrides): array
{
    $felder = [];
    foreach (avesmapsTerritoryDetailWirksam($staging, $overrides) as $key => $eintrag) {
        if ($eintrag['wert'] !== '') {
            $felder[$key] = $eintrag['wert'];
        }
    }

    return $felder;
}
