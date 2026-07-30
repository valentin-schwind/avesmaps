<?php

declare(strict_types=1);

// The two global "Wappen: An/Aus" switches and the placeholder they put in a coat's place.
//
// One switch per SURFACE, never a shared one: the same reason that already keeps the citymap preview
// switch apart from the adventure cover switch (api/_internal/app/citymaps.php). A switch named after
// one surface must not drag a second one with it.
//
// POLARITY, like every other kill switch here: default ENABLED. Only a stored '0' turns coats off, so a
// fresh deploy that never wrote the row shows coats.
//
// WHAT "off" MEANS: not "no coat" but "a coat we do not show right now". The URL is replaced, not
// removed, so every layout decision stays with the frontend -- same <img>, same class, same zoom-scaled
// size on a map label, same has-coat branch in the infobox. The frontend needs no flag and cannot guess
// the state wrong. A territory that has NO coat keeps having none ('' stays ''), otherwise the map would
// grow hundreds of shields where today there is nothing.

const AVESMAPS_TERRITORY_COATS_SETTING = 'territory_coats_enabled';
const AVESMAPS_SETTLEMENT_COATS_SETTING = 'settlement_coats_enabled';

// The stand-in: an empty shield, 500x500 with transparency, so it stays sharp at every size a coat is
// drawn in (the map label scales its coat with the zoom).
const AVESMAPS_COAT_PLACEHOLDER_URL = '/img/wappen.png';

// Both halves of this file read app_setting: the public one via the DDL-free reader, the editor pair via
// the self-healing one. Same store, two entry points, one require.
require_once __DIR__ . '/app-setting.php';

/**
 * Reads one of the two switches on a PUBLIC read path.
 *
 * Deliberately NOT avesmapsAppSettingGet(): that helper runs CREATE TABLE IF NOT EXISTS on every read,
 * and DDL has no business on the hot map-features / political-layer path (same reasoning as
 * avesmapsMapFeaturesSettlementImagesEnabled, which this mirrors). Fail-open: a missing table or a read
 * error keeps coats visible, i.e. current behaviour. The editor endpoints keep using the self-healing
 * app-setting helpers for their read/write.
 *
 * The SELECT itself is avesmapsAppSettingGetWithoutDdl(); '1' is this switch's own default, so a missing
 * table and a missing row both come back ENABLED. Two things stay here because that helper cannot carry
 * them: the per-key memo (a map-features request asks for the same key repeatedly, and one broken read
 * must not be retried per call), and the Throwable catch -- the helper only catches PDOException, and
 * narrowing the fail-open on a hot public read is exactly the robustness this function exists for.
 */
function avesmapsCoatSwitchEnabledFast(PDO $pdo, string $settingKey): bool
{
    static $resolved = [];

    if (array_key_exists($settingKey, $resolved)) {
        return $resolved[$settingKey];
    }
    try {
        return $resolved[$settingKey] = avesmapsAppSettingGetWithoutDdl($pdo, $settingKey, '1') !== '0';
    } catch (Throwable) {
        return $resolved[$settingKey] = true;
    }
}

/**
 * Reader/writer pair for the EDITOR endpoints, on the self-healing app-setting store (it creates the
 * table if it is missing -- which is what makes the very first toggle on a fresh deploy work). Not for
 * the public read paths; those use avesmapsCoatSwitchEnabledFast above.
 */
function avesmapsTerritoryCoatsEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_TERRITORY_COATS_SETTING, '1') !== '0';
}

function avesmapsSetTerritoryCoatsEnabled(PDO $pdo, bool $enabled): array
{
    avesmapsAppSettingSet($pdo, AVESMAPS_TERRITORY_COATS_SETTING, $enabled ? '1' : '0');

    return ['ok' => true, 'coats_enabled' => $enabled];
}

function avesmapsSettlementCoatsEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_SETTLEMENT_COATS_SETTING, '1') !== '0';
}

function avesmapsSetSettlementCoatsEnabled(PDO $pdo, bool $enabled): array
{
    avesmapsAppSettingSet($pdo, AVESMAPS_SETTLEMENT_COATS_SETTING, $enabled ? '1' : '0');

    return ['ok' => true, 'coats_enabled' => $enabled];
}

/**
 * The one rule every reader applies to an already license-gated coat URL.
 *
 * Runs AFTER avesmapsResolveGatedCoatUrl(), never instead of it -- the public_domain gate is a legal
 * requirement (NOTICE.md), this switch is a display preference. Order matters: a non-public-domain coat
 * is '' by then and stays '', so switching coats back ON can never surface one.
 */
function avesmapsCoatDisplayUrl(string $gatedUrl, bool $coatsEnabled): string
{
    $url = trim($gatedUrl);
    if ($url === '' || $coatsEnabled) {
        return $url;
    }

    return AVESMAPS_COAT_PLACEHOLDER_URL;
}

/**
 * Applies the territory switch to a finished political-layer feature list.
 *
 * At the END of the build rather than inside avesmapsPoliticalLayerRowToFeature(), because that builder
 * is called from four places and takes no PDO -- threading a flag through all of them would spread the
 * switch over the file. One pass over the assembled features is the single choke point, and it is a pure
 * function, so it is unit-testable without a database.
 */
function avesmapsPoliticalApplyCoatDisplaySwitch(array $features, bool $coatsEnabled): array
{
    if ($coatsEnabled) {
        return $features;
    }
    foreach ($features as $index => $feature) {
        if (!is_array($feature) || !is_array($feature['properties'] ?? null)) {
            continue;
        }
        foreach (['coat_of_arms_url', 'label_coat_of_arms_url'] as $key) {
            if (isset($feature['properties'][$key])) {
                $features[$index]['properties'][$key] = avesmapsCoatDisplayUrl(
                    (string) $feature['properties'][$key],
                    false
                );
            }
        }
    }

    return $features;
}
