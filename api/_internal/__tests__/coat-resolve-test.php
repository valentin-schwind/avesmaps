<?php

declare(strict_types=1);

// Unit test for avesmapsResolveGatedCoatUrl -- the ONE canonical coat precedence shared by the territory
// layer, the territory infobox and the settlement breadcrumb (Discord #32). Run with assertions on:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/coat-resolve-test.php

require_once __DIR__ . '/../coat-url.php';

// Point DOCUMENT_ROOT at an empty temp dir: the /uploads/... files below do not exist there, so the
// cache-buster is a no-op and the raw URL passes through -- exactly what these precedence assertions want.
$_SERVER['DOCUMENT_ROOT'] = sys_get_temp_dir();

$pd = 'public_domain';
$nc = 'attribution_required'; // a real, non-public-domain status the upload allows -> must never show

// 1. An override with a public_domain url wins over BOTH own and staging (the #32 fix).
assert(avesmapsResolveGatedCoatUrl(
    ['coat_of_arms_url' => '/uploads/wappen/grafschaft-ferdok-custom.png', 'coat_of_arms_license_status' => $pd],
    '/uploads/own-applied.png', '/uploads/staging-wiki.png', $pd
) === '/uploads/wappen/grafschaft-ferdok-custom.png');
echo "1 override wins over own+staging ok\n";

// 2. POSITIVE CONTROL for the legal gate: an override present but NOT public_domain shows NOTHING, and
//    does NOT fall through to the (public-domain) own/staging coat. Remove the gate and this fails.
assert(avesmapsResolveGatedCoatUrl(
    ['coat_of_arms_url' => '/uploads/secret.png', 'coat_of_arms_license_status' => $nc],
    '/uploads/own-applied.png', '/uploads/staging-wiki.png', $pd
) === '');
echo "2 non-public-domain override blanks (no fallback) ok\n";

// 3. An override that sets an EMPTY url is a deliberate "no coat" -- honoured, no fallback to the wiki coat.
assert(avesmapsResolveGatedCoatUrl(
    ['coat_of_arms_url' => '', 'coat_of_arms_license_status' => $pd],
    '/uploads/own-applied.png', '/uploads/staging-wiki.png', $pd
) === '');
echo "3 empty override = deliberate blank ok\n";

// 4. No override -> own (political_territory) coat, gated by the staging licence.
assert(avesmapsResolveGatedCoatUrl([], '/uploads/own-applied.png', '/uploads/staging-wiki.png', $pd)
    === '/uploads/own-applied.png');
echo "4 own coat wins over staging ok\n";

// 5. No override, no own -> staging (wiki) coat.
assert(avesmapsResolveGatedCoatUrl([], '', '/uploads/staging-wiki.png', $pd) === '/uploads/staging-wiki.png');
echo "5 staging fallback ok\n";

// 6. POSITIVE CONTROL: no override, own present, but the staging licence is NOT public_domain -> blank.
assert(avesmapsResolveGatedCoatUrl([], '/uploads/own-applied.png', '/uploads/staging-wiki.png', $nc) === '');
echo "6 non-public-domain staging licence gates the coat ok\n";

// 7. Nothing at all -> ''.
assert(avesmapsResolveGatedCoatUrl([], '', '', '') === '');
echo "7 empty input ok\n";

// 8. An override licence key present but url key ABSENT falls to own, using the OVERRIDE licence (public).
assert(avesmapsResolveGatedCoatUrl(['coat_of_arms_license_status' => $pd], '/uploads/own-applied.png', '', '')
    === '/uploads/own-applied.png');
echo "8 override licence without url key uses own coat ok\n";

echo "coat-resolve ALL OK\n";
