<?php

declare(strict_types=1);

// Die Leseaktion `baselines` von POST /api/edit/map/curve-labels-run.php (Entwurf §5.6, §7).
//
// 🔴 WOFUER SIE DA IST: die Vorschau der Kurvenfeinheiten braucht eine ECHTE Beschriftungskurve.
// Die rechnet der SERVER; der Browser passt nur den Text darauf ein (curve-label-fit.js). Wer sie
// im Browser nachrechnete, haette eine dritte Chordal-Axis im Projekt -- und die Vorschau zeigte
// etwas, das die Karte so nie zeichnet.
//
// 💣 SIE DARF NICHTS RECHNEN UND NICHTS SCHREIBEN. Der Sammellauf braucht 165-796 ms JE FLAECHE
// (rund 20 s im Ganzen) -- ein Auswahlfeld im Editor, das ihn versehentlich ausloest, saettigt die
// PHP-Worker von STRATO (AGENTS.md §9). Deshalb faehrt dieser Test den Leser WIRKLICH und zaehlt
// dabei mit, was er anfasst.
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//       api/_internal/app/__tests__/kurven-baselines-lesen-test.php

$wurzel = __DIR__ . '/../../../..';
require_once $wurzel . '/api/_internal/app/curve-label-store.php';

$quelle = file_get_contents($wurzel . '/api/edit/map/curve-labels-run.php');
assert($quelle !== false, 'der Endpunkt ist lesbar');

// ---- A. Die Aktion steht VOR dem Sammellauf ----------------------------------------------------
// 🔴 Sonst wuerde sie nie erreicht -- der Lauf antwortet und beendet die Anfrage.
$posLesen = strpos($quelle, "=== 'baselines'");
$posLauf = strpos($quelle, 'avesmapsCurveRebuildCache($pdo)');
assert($posLesen !== false, 'die Leseaktion steht im Endpunkt');
assert($posLauf !== false, 'der Sammellauf auch');
assert($posLesen < $posLauf, 'die Leseaktion steht VOR dem Sammellauf -- sonst ist sie unerreichbar');

// ---- B. 💣 Sie ruft den teuren Lauf NICHT ------------------------------------------------------
$block = substr($quelle, $posLesen, $posLauf - $posLesen);
assert(
    !str_contains($block, 'avesmapsCurveRebuildCache'),
    'die Leseaktion rechnet keine Kurve nach'
);
assert(
    !str_contains($block, 'avesmapsNextEcosystemRevision'),
    'und hebt keine Revision -- sie aendert nichts, also darf sie keinen ETag bewegen'
);
assert(
    !str_contains($block, 'avesmapsAppSettingSet'),
    'und schreibt keine Einstellung'
);

// ---- C. Der Riegel bleibt `edit`, nicht offen ---------------------------------------------------
// ⚠️ Sie zeigt genau das, was ueber map-features.php ohnehin oeffentlich ausgeliefert wird -- aber
// der Endpunkt liegt unter api/edit/, und dort gilt der Riegel fuer alle seine Aktionen.
$vorAktion = substr($quelle, 0, $posLesen);
assert(
    str_contains($vorAktion, "avesmapsRequireUserWithCapability('edit')"),
    'der Riegel steht VOR der Leseaktion, nicht erst vor dem Lauf'
);

// ---- D. 💣 DER SCHLUESSEL: `max_labels`, nicht `max` -------------------------------------------
// Der ROHE Zwischenspeicher nennt ihn `max`, der GELESENE Satz `max_labels`. Verwechselt liefert
// die Vorschau stumm ueberall eine 1 -- und „max. Namen" saehe aus wie ein toter Regler. Genau so
// stand es beim ersten Bau da.
//
// Gemessen wird das AUSGEFUEHRT: eine Cache-Nutzlast hinein, den Hausleser darueber, und die Form
// des Satzes heraus.
$roh = json_encode([
    'version' => 1,   // ⚠️ Der Leser prueft 'version', nicht 'v' -- ein 'v' faellt lautlos auf [].
    'regions' => [
        'r-eins' => ['rev' => 7, 'cnt' => 2, 'max' => 3, 'line' => [[0.0, 0.0], [10.0, 0.0], [20.0, 5.0]]],
        'r-alt' => ['rev' => 1, 'cnt' => 1, 'max' => 2, 'line' => [[0.0, 0.0], [1.0, 1.0]]],
        'r-kurz' => ['rev' => 7, 'cnt' => 2, 'max' => 1, 'line' => [[0.0, 0.0]]],
    ],
], JSON_UNESCAPED_UNICODE);

$saetze = avesmapsCurveBaselinesFromCache($roh, [
    'r-eins' => ['rev' => 7, 'cnt' => 2],
    'r-alt' => ['rev' => 9, 'cnt' => 1],   // Fingerabdruck passt NICHT mehr
    'r-kurz' => ['rev' => 7, 'cnt' => 2],
]);

assert(array_key_exists('r-eins', $saetze), 'die frische Region kommt durch');
assert(!array_key_exists('r-alt', $saetze), 'eine veraltete Region faellt heraus');
assert(!array_key_exists('r-kurz', $saetze), 'eine Linie aus einem Punkt ist keine Kurve');
assert(
    array_key_exists('max_labels', $saetze['r-eins']),
    'der gelesene Satz heisst `max_labels` -- wer `max` liest, bekommt still eine 1'
);
assert($saetze['r-eins']['max_labels'] === 3, 'und traegt den gespeicherten Wert: '
    . var_export($saetze['r-eins']['max_labels'] ?? null, true));
assert(count($saetze['r-eins']['line']) === 3, 'die Linie kommt vollstaendig durch');

// Und der Endpunkt liest genau diesen Schluessel.
assert(
    str_contains($quelle, "\$satz['max_labels']"),
    'die Leseaktion liest `max_labels` aus dem Satz'
);

// ---- E. Fehlt die Kurve, fehlt der EINTRAG ------------------------------------------------------
// 🔴 Nicht `null`, nicht `[]`. Der Client unterscheidet „hat keine Kurve" an der Abwesenheit; ein
// leeres Feld waere eine leere Kurve, und die zeichnet sich als Nichts statt als Gerade -- dieselbe
// Regel wie in avesmapsCurveApplyToFeatures.
assert(
    str_contains($block, 'continue;'),
    'eine Region ohne brauchbare Kurve wird uebersprungen, nicht leer gemeldet'
);
assert(
    !preg_match('/\'line\'\s*=>\s*null/', $block),
    'und es wird kein leerer Platzhalter gemeldet'
);

echo "kurven-baselines-lesen: alle Zusicherungen gruen\n";
