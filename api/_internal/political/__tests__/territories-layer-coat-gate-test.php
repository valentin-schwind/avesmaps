<?php

declare(strict_types=1);

/**
 * Das Lizenz-Gate der Wappen an den Territoriums-LABELS (Kartenanzeige, nicht die Infobox). Keine DB,
 * kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/political/__tests__/territories-layer-coat-gate-test.php
 *
 * 🔴 Phase-3-Nachpruefung, Befund 1: avesmapsPoliticalLayerRowToFeature() (die einzige Erzeugerin von
 * properties.coat_of_arms_url / properties.label_coat_of_arms_url fuer die Karten-Labels) verglich in
 * ZWEIG B (kein Upload-Override -- der haeufige Fall: Fallback auf das gecrawlte Staging-Wappen plus der
 * anschliessende Cache-Buster-Gate) weiterhin ROH gegen 'public_domain', waehrend Zweig A (Upload-
 * Override) laengst avesmapsResolveGatedCoatUrl()/avesmapsMediaLicenseIsPublic() nutzte. Ein Editor, der
 * bei einem gecrawlten Wappen 'permission_granted' setzt, sah es dadurch in der Infobox (territory-
 * detail.php, ueber denselben Resolver), aber NICHT am Kartenlabel -- dieselbe Leser-Divergenz, die
 * Discord #32 verursacht hat.
 *
 * Dieser Test baut ein minimales $row fuer GENAU Zweig B (kein 'coat_of_arms_url' im coat_override_json,
 * kein eigenes political_territory.coat_of_arms_url) und prueft beide betroffenen Stellen in einem
 * Durchgang: den Fallback (~Zeile 868, "faellt das Staging-Wappen durch die Lizenz?") und das
 * abschliessende Cache-Buster-Gate (~Zeile 887, das denselben Wert ein zweites Mal prueft).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

// Reihenfolge wie in den Endpunkten: media-license.php zuerst (kein Aufrufer darf sich auf den Include
// eines Nachbarn verlassen), dann die drei Bausteine, die territories-layer.php transitiv braucht
// (ascii-fold.php ueber territory.php/territories-read.php; territories-support.php fuer
// avesmapsPoliticalNullableInt) -- alle vier sind seiteneffektfrei (keine DB, kein Bootstrap).
require __DIR__ . '/../../media-license.php';
require __DIR__ . '/../../coat-url.php';
require __DIR__ . '/../territory.php';
require __DIR__ . '/../territories-read.php';
require __DIR__ . '/../territories-support.php';
require __DIR__ . '/../territories-layer.php';

/** Minimales $row fuer Zweig B: kein Upload-Override, das gecrawlte Wappen kommt nur aus dem Staging. */
function territoriesLayerCoatGateTestRow(string $stagingLicense): array
{
    return [
        'geometry_public_id' => 'geo-1',
        'territory_id' => 1,
        'territory_public_id' => 'terr-1',
        'staging_coat_url' => '/uploads/wappen/staging-1.png',
        'staging_coat_license' => $stagingLicense,
    ];
}

// ---- die fuenf oeffentlichen Werte zeigen das Wappen am Label -----------------------------------------
foreach (['public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work'] as $kennung) {
    $feature = avesmapsPoliticalLayerRowToFeature(territoriesLayerCoatGateTestRow($kennung), 1049, 0);
    assert(
        $feature['properties']['coat_of_arms_url'] !== '',
        "{$kennung} muesste das Kartenlabel-Wappen zeigen"
    );
    assert(
        $feature['properties']['label_coat_of_arms_url'] !== '',
        "{$kennung} muesste label_coat_of_arms_url fuellen"
    );
}

// ---- die zwei stillen Werte verbergen es weiterhin -----------------------------------------------------
foreach (['cc_by', 'unknown_other'] as $kennung) {
    $feature = avesmapsPoliticalLayerRowToFeature(territoriesLayerCoatGateTestRow($kennung), 1049, 0);
    assert(
        $feature['properties']['coat_of_arms_url'] === '',
        "{$kennung} duerfte NICHT am Kartenlabel erscheinen"
    );
    assert(
        $feature['properties']['label_coat_of_arms_url'] === '',
        "{$kennung} duerfte label_coat_of_arms_url NICHT fuellen"
    );
}

// 💣 Unmigrierte/fremde Altwerte bleiben still -- vorher wie nachher (derselbe Fall wie
// coat-resolve-test.php Fall 9, hier fuer den zweiten Gate-Ort).
foreach (['attribution_required', 'unknown', ''] as $altwert) {
    $feature = avesmapsPoliticalLayerRowToFeature(territoriesLayerCoatGateTestRow($altwert), 1049, 0);
    assert(
        $feature['properties']['coat_of_arms_url'] === '',
        "Altwert '{$altwert}' duerfte nicht ploetzlich am Kartenlabel erscheinen"
    );
}

// ---- kein Staging-Wappen ueberhaupt -> weiterhin leer, unabhaengig von der Lizenz ----------------------
$leereZeile = territoriesLayerCoatGateTestRow('public_domain');
$leereZeile['staging_coat_url'] = '';
$leer = avesmapsPoliticalLayerRowToFeature($leereZeile, 1049, 0);
assert($leer['properties']['coat_of_arms_url'] === '', 'kein Staging-Wappen -> kein Kartenlabel-Wappen');

echo "territories-layer-coat-gate-test: OK\n";
