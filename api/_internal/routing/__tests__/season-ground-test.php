<?php

declare(strict_types=1);

// Der Bodenabzug der Jahreszeit -- und die Rechnung, die aus einer SUBTRAKTION auf der Quellenskala
// einen Multiplikator auf unsere Tempotabelle macht.
//
// 🔴 Der Entwurf (§1.1) nennt vier Zahlen, die aus der Quelle folgen. Sie stehen unten als Asserts:
// Reichsstrasse +22 %, Strasse +25 %, Passstrecke +100 %. Rutscht die Abbildung, werden genau diese
// Zahlen falsch -- und sie sind das Einzige, woran man es merken kann, denn eine falsche Skala sieht
// im Reiseplan immer noch plausibel aus.
//
// ⚠️ Mit Assertions laufen lassen, sonst prueft es nichts:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/season-ground-test.php

require_once __DIR__ . '/../season-ground.php';

$prozent = static fn (float $factor): float => (1.0 / $factor - 1.0) * 100.0;

// ============================================================ A. die Tabelle ist vollstaendig
$zonen = ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht', 'subtropisch', 'tropisch'];
assert(count(AVESMAPS_SEASON_GROUND_TABLE) === 7, 'sieben Klimazonen');
foreach ($zonen as $zone) {
    assert(isset(AVESMAPS_SEASON_GROUND_TABLE[$zone]), "Zone {$zone} steht in der Tabelle");
}

// 💣 DIE BINDUNG AN DEN KALENDER. Die Jahreszeiten kommen aus travel-calendar.php; kaeme dort je eine
// fuenfte dazu oder wuerde eine umbenannt, fiele sie hier lautlos auf „kein Abzug" -- ein ganzer
// Jahresabschnitt ohne Winter, und nichts wuerde rot.
$kalenderJahreszeiten = array_values(array_unique(AVESMAPS_TRAVEL_CALENDAR_SEASONS));
sort($kalenderJahreszeiten);
foreach (AVESMAPS_SEASON_GROUND_TABLE as $zone => $zeile) {
    $tabellenJahreszeiten = array_keys($zeile);
    sort($tabellenJahreszeiten);
    assert($tabellenJahreszeiten === $kalenderJahreszeiten,
        "Zone {$zone} kennt genau die Jahreszeiten des Kalenders");
}

// Jeder Eintrag ist entweder leer oder eine bekannte Bodenart -- ein Tippfehler waere sonst still.
foreach (AVESMAPS_SEASON_GROUND_TABLE as $zone => $zeile) {
    foreach ($zeile as $jahreszeit => $bodenart) {
        assert($bodenart === '' || isset(AVESMAPS_SEASON_GROUND_CONDITIONS[$bodenart]),
            "{$zone}/{$jahreszeit}: '{$bodenart}' ist keine bekannte Bodenart");
    }
}

// ============================================================ B. die vier Zahlen aus dem Entwurf
// Boreal im Winter = Tiefschnee = -0,2, und Schnee nimmt die Strasse NICHT aus.
$strasse = avesmapsSeasonSpeedFactor('Strasse', 'boreal', 'winter');
assert(abs($strasse - 0.8) < 1e-9, 'Strasse 1,0 - 0,2 = 0,8');
assert(abs($prozent($strasse) - 25.0) < 1e-9, '💣 Strasse im Tiefschnee: +25 % Reisezeit (Entwurf §1.1)');

$reichsstrasse = avesmapsSeasonSpeedFactor('Reichsstrasse', 'boreal', 'winter');
assert(abs($reichsstrasse - (0.9 / 1.1)) < 1e-9, 'Reichsstrasse 1,1 - 0,2 = 0,9');
assert(abs($prozent($reichsstrasse) - 22.222222) < 1e-4, '💣 Reichsstrasse im Tiefschnee: +22 % (Entwurf §1.1)');

$pass = avesmapsSeasonSpeedFactor('Gebirgspass', 'boreal', 'winter');
assert(abs($pass - 0.5) < 1e-9, 'Passstrecke 0,4 - 0,2 = 0,2');
assert(abs($prozent($pass) - 100.0) < 1e-9, '💣 Passstrecke im Tiefschnee: +100 % (Entwurf §1.1)');

// ⭐ Und der Kern der Sache: dieselbe Subtraktion trifft den Pass VIERMAL so hart wie die Reichsstrasse,
// ohne dass irgendwo eine Anteilstabelle steht.
assert($prozent($pass) > 4 * $prozent($reichsstrasse),
    'die Subtraktion trifft schwaches Gelaende von selbst haerter -- dafuer braucht es keine Anteilstabelle');

// ============================================================ C. die Strassenausnahme gilt NUR bei Naesse
// Boreal im Fruehling = aufgeweicht = -0,1, „Strasse ausgenommen bei Naesse" (§21).
assert(avesmapsSeasonSpeedFactor('Strasse', 'boreal', 'fruehling') === 1.0, 'die Strasse bleibt bei Naesse verschont');
assert(avesmapsSeasonSpeedFactor('Reichsstrasse', 'boreal', 'fruehling') === 1.0, 'die Reichsstrasse ebenso');
$weg = avesmapsSeasonSpeedFactor('Weg', 'boreal', 'fruehling');
assert(abs($weg - (0.7 / 0.8)) < 1e-9, '💣 der Weg ist ein Karrenweg und weicht auf: 0,8 - 0,1 = 0,7');

// 💣 Aber Schnee und Eis treffen die Strasse sehr wohl. Waere sie auch davon ausgenommen, waere eine
// Winterreise durch den Norden so schnell wie eine im Sommer -- das Gegenteil des Sinns dieser Arbeit.
assert(avesmapsSeasonSpeedFactor('Strasse', 'boreal', 'winter') < 1.0, 'Tiefschnee trifft die Strasse');
assert(avesmapsSeasonSpeedFactor('Strasse', 'gemaessigt', 'winter') < 1.0, 'leichter Schnee auch');
assert(avesmapsSeasonSpeedFactor('Strasse', 'polar', 'winter') < 1.0, 'Eis erst recht');

// ============================================================ D. Wasser hat keinen Boden
foreach (['Flussweg', 'Seeweg'] as $wasserweg) {
    foreach ($zonen as $zone) {
        foreach (['winter', 'fruehling', 'sommer', 'herbst'] as $jahreszeit) {
            assert(avesmapsSeasonSpeedFactor($wasserweg, $zone, $jahreszeit) === 1.0,
                "{$wasserweg} in {$zone}/{$jahreszeit}: kein Bodenabzug -- fuer Wasser wirkt die Jahreszeit nur ueber die Sperrung");
        }
    }
}

// ============================================================ E. ohne Reisebeginn = wie bisher
// Das ist die Rueckwaertskompatibilitaet, und sie ist der Grund, warum der Faktor multiplikativ ist.
foreach (array_keys(AVESMAPS_SEASON_GROUND_PATH_FACTORS) as $wegart) {
    assert(avesmapsSeasonSpeedFactor($wegart, null, null) === 1.0, "{$wegart}: ohne Zone und Jahreszeit unveraendert");
    assert(avesmapsSeasonSpeedFactor($wegart, '', '') === 1.0, "{$wegart}: leere Angaben unveraendert");
    assert(avesmapsSeasonSpeedFactor($wegart, 'boreal', 'sommer') === 1.0, "{$wegart}: der boreale Sommer zieht nichts ab");
    assert(avesmapsSeasonSpeedFactor($wegart, 'subtropisch', 'winter') === 1.0, "{$wegart}: die Subtropen tragen keinen Abzug");
    assert(avesmapsSeasonSpeedFactor($wegart, 'nichtvorhanden', 'winter') === 1.0, "{$wegart}: eine unbekannte Zone erfindet keinen Winter");
}
assert(avesmapsSeasonSpeedFactor('Gibtsnicht', 'boreal', 'winter') === 1.0,
    'eine unbekannte Wegart wird in Ruhe gelassen statt geraten -- ein Fehlgriff hier waere eine stille Dauerbremse');

// ============================================================ F. die Untergrenze 0,05
// ⚠️ Sie greift bei KEINER unserer Wegarten: die schwaechste ist der Gebirgspass mit 0,4, und
// 0,4 - 0,2 = 0,2 liegt weit darueber. Sie steht trotzdem da, weil sie in der Quelle steht und weil
// eine spaeter ergaenzte Wegart (Gebirgspfad 0,3, Hochgebirge 0,1) sie sofort braucht.
$schwaechste = min(AVESMAPS_SEASON_GROUND_PATH_FACTORS);
$groessterAbzug = max(array_column(AVESMAPS_SEASON_GROUND_CONDITIONS, 'penalty'));
assert($schwaechste - $groessterAbzug > AVESMAPS_SEASON_GROUND_FLOOR,
    'heute greift die Untergrenze nicht -- wer eine schwaechere Wegart ergaenzt, aendert das');

// ============================================================ G. der Bericht fuer den Reiseplan
assert(avesmapsSeasonGroundReport('Strasse', 'boreal', 'sommer') === null,
    'wo die Jahreszeit nichts tut, gibt es keinen Vermerk -- „+0 %" ist keine Aussage');
$bericht = avesmapsSeasonGroundReport('Gebirgspass', 'boreal', 'winter');
assert($bericht['condition'] === 'tiefschnee', 'der Bericht nennt die Bodenart');
assert(abs($bericht['penalty'] - 0.2) < 1e-9, 'und ihren Abzug');
assert(abs($bericht['time_percent'] - 100.0) < 1e-9, 'und was er an Zeit kostet');
assert($bericht['season'] === 'winter' && $bericht['zone'] === 'boreal', 'und woher beides kommt');

// ============================================================ H. die Polarzone taut nur an der Oberflaeche
assert(avesmapsSeasonGroundCondition('polar', 'sommer') === 'tauboden', 'im polaren Sommer taut der Boden an');
assert(avesmapsSeasonSpeedFactor('Strasse', 'polar', 'sommer') === 1.0, 'Tauboden ist Naesse -- die Strasse ist ausgenommen');
assert(avesmapsSeasonSpeedFactor('Querfeldein', 'polar', 'sommer') < 1.0, 'querfeldein aber nicht');
assert(avesmapsSeasonGroundCondition('polar', 'winter') === 'eis', 'im Winter ist es Eis');

echo "season-ground-test: all asserts passed\n";
