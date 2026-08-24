<?php

declare(strict_types=1);

// 🔴 „Kurven rechnen" darf jeder EDITOR (Owner 23.08.2026: „ich möchte, dass ‚Kurven rechnen' von
// jedem Editor verwendet werden kann"), und der einmalige Umstelllauf ist weg (Owner: „das
// einmalige Mapping kann weg, ich habe den Button gedrückt"). Entwurf §3.
//
// ⚠️ Der Test liest die QUELLE, er faehrt den Endpunkt nicht: dafuer braeuchte er Sitzung und
// Datenbank. Was er belegt, ist genau das, was hier schiefgehen kann -- ein vergessener
// `admin`-Riegel und ein liegengebliebener Zweig, den der naechste Leser fuer aktiv haelt.
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/kurvenlauf-recht-test.php

$wurzel = __DIR__ . '/../../../..';

$quelle = file_get_contents($wurzel . '/api/edit/map/curve-labels-run.php');
assert($quelle !== false, 'der Endpunkt ist lesbar');

// ---- A. Der Riegel steht auf `edit` -----------------------------------------------------------
assert(
    str_contains($quelle, "avesmapsRequireUserWithCapability('edit')"),
    'der Riegel steht auf `edit`'
);
assert(
    !str_contains($quelle, "avesmapsRequireUserWithCapability('admin')"),
    'und NICHT mehr auf `admin`'
);

// ---- B. 💣 Der Umstelllauf ist RESTLOS weg ----------------------------------------------------
// Ein Lauf, der beim ersten Mal etwas anderes tut als beim zweiten, ist auf Dauer eine Falle: der
// naechste Leser haelt den toten Zweig fuer aktiv. Deshalb Aufruf, Funktion UND Antwortfeld.
//
// 🪤 Geprueft wird CODE, nicht Prosa. Die erste Fassung verbot das WORT „Umstelllauf" ueberall --
// und stand damit im Widerspruch zu Zusicherung C, die einen Vermerk mit genau diesem Wort
// verlangt. Ein Test, der seinen eigenen Nachbarn ausschliesst, ist nicht streng, sondern falsch.
foreach (['avesmapsCurveRolloutFromRotations', 'force_rollout', '$umstellung', "'rollout'"] as $marke) {
    assert(
        !str_contains($quelle, $marke),
        "der Umstelllauf ist restlos aus dem Endpunkt entfernt (gefunden: {$marke})"
    );
}
$lager = file_get_contents($wurzel . '/api/_internal/app/curve-label-store.php');
assert($lager !== false, 'die Ablage ist lesbar');
assert(
    !str_contains($lager, 'function avesmapsCurveRolloutFromRotations'),
    'und die Funktion selbst ist weg -- sonst bliebe toter Code stehen'
);

// ---- C. Ein Vermerk erklaert die Luecke -------------------------------------------------------
// 🪤 Ohne ihn „repariert" der naechste Leser die fehlende Phase 0.
assert(
    str_contains($quelle, 'KEIN Umstelllauf'),
    'an der Stelle steht ein Vermerk, warum dort nichts mehr passiert'
);

// ---- D. Im Fenster steht nicht mehr „Nur Admin" -----------------------------------------------
$fenster = file_get_contents($wurzel . '/html/landschaften-editor.html');
assert($fenster !== false, 'das Fenster ist lesbar');
$kachel = [];
preg_match('/id="ecoCurves"[^>]*title="([^"]*)"/', $fenster, $kachel);
assert($kachel !== [], 'die Kachel traegt einen title');
assert(stripos($kachel[1], 'admin') === false, 'der title sagt nicht mehr „Nur Admin"');
// 🪤 GEMESSEN WIRD CODE, NICHT PROSA. Die Stelle, an der der Leser stand, trägt jetzt einen
// Vermerk -- und der NENNT `data.rollout`, damit niemand ihn wieder einbaut. Ein Test, der die
// blosse Zeichenkette sucht, prüft damit seine eigene Begründung und meldet einen Rückbau, den
// es nicht gibt. Derselbe Fehler ist in diesem Umbau fünfmal aufgetreten; hier steht er als
// Warnung für den nächsten.
$ohneKommentare = preg_replace(
    ['~/\*[\s\S]*?\*/~', '~^\s*//.*$~m', '~<!--[\s\S]*?-->~'],
    ' ',
    $fenster
);
assert(
    !str_contains((string) $ohneKommentare, 'data.rollout'),
    'die Auswertung des Umstelllaufs ist weg -- ein Zweig, der nie wahr wird, sieht wie eine Bedienung aus'
);

echo "kurvenlauf-recht: alle Zusicherungen gruen\n";
