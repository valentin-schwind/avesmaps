<?php

declare(strict_types=1);

// Aufgabe 5 (Import-Stage): das Filterfeld `keys` -- ein NACHSCHLAG, kein Filter. Die Stage des
// Fensters haelt Objekte ueber alle Bearbeitungsstaende hinweg; nach einem neuen „Holen & Rechnen"
// muss sie fragen koennen, ob es diese Objekte noch gibt und wie sie jetzt stehen. `keys` liefert
// GENAU die genannten Objekte zurueck, unabhaengig vom `stand`-Reiter.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-keys-test.php

require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$runId = 1;

$liste = avesmapsGaretienArbeitsliste($pdo, $runId, []);
$nachName = [];
foreach ($liste['objekte'] as $o) {
    $nachName[$o['name']] = $o;
}
// Vorbedingung: die zwei Fixture-Objekte, an denen dieser Test haengt, muessen wirklich existieren
// -- sonst pruefte der Rest nur zufaellig gegen leere Werte.
assert(isset($nachName['Gardel'], $nachName['Alke']), 'die Vorbedingung: Gardel und Alke fehlen in der Fixture');
assert($nachName['Gardel']['stand'] === 'offen', 'die Vorbedingung: der Gardel steht auf offen');
$pruefungen += 2;

$keyOffen = (string) $nachName['Gardel']['key'];
$keyUebernommen = (string) $nachName['Alke']['key'];

// Die Alke wird uebernommen -- derselbe direkte Weg wie in garetien-liste-test.php (der echte
// Schreibweg der Uebernahme ist dort separat geprueft; hier zaehlt nur der resultierende Stand,
// den `avesmapsGaretienListeObjektStand` daraus liest).
$pdo->exec(
    "UPDATE sync_plan_item SET apply_state = 'done'"
    . " WHERE entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke!Alke%'"
);
$standAlke = '(fehlt)';
foreach (avesmapsGaretienArbeitsliste($pdo, $runId, [])['objekte'] as $o) {
    if ($o['key'] === $keyUebernommen) { $standAlke = $o['stand']; }
}
assert($standAlke === 'uebernommen', 'die Vorbedingung: die Alke steht jetzt auf uebernommen: ' . $standAlke);
$pruefungen++;

// 🔴 UEBER ALLE STAENDE. Die Stage haelt Objekte, die inzwischen uebernommen ODER abgelehnt sein
// koennen; wer sie nur im Reiter „offen" nachschluege, verloere genau die, deren Zustand sich
// geaendert hat -- und das ist die Auskunft, um derentwillen nachgeschlagen wird.
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => [$keyOffen, $keyUebernommen]]);
assert(count($antwort['objekte']) === 2, 'beide, unabhaengig vom Stand: ' . count($antwort['objekte']));
$staende = array_column($antwort['objekte'], 'stand');
sort($staende);
assert($staende === ['offen', 'uebernommen'], 'die zwei Staende muessen beide durchkommen: ' . json_encode($staende));
$pruefungen += 2;

// Ein unbekannter Schluessel faellt still heraus -- der Aufrufer sieht an der fehlenden Zeile,
// dass es das Objekt im neuen Lauf nicht mehr gibt.
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => [$keyOffen, 'gibt:es:nicht!X']]);
assert(count($antwort['objekte']) === 1, 'ein unbekannter Schluessel darf nicht auftauchen: ' . count($antwort['objekte']));
$pruefungen++;

// 💣 `keys` SCHLAEGT `stand`. Steht beides im Filter, gewinnt `keys` -- sonst laege der Aufrufer
// mit einem geerbten `stand: "offen"` genau die Haelfte seiner Stage zurueck.
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => [$keyUebernommen], 'stand' => 'offen']);
assert(count($antwort['objekte']) === 1, 'keys gewinnt gegen stand: ' . count($antwort['objekte']));
assert($antwort['objekte'][0]['key'] === $keyUebernommen,
    'und es ist wirklich das uebernommene Objekt, nicht zufaellig eins mit stand=offen');
$pruefungen += 2;

// Deckel: mehr als AVESMAPS_GARETIEN_LISTE_MAX Schluessel werden gekappt, nicht abgelehnt.
$viele = array_fill(0, AVESMAPS_GARETIEN_LISTE_MAX + 5, $keyOffen);
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => $viele]);
assert(count($antwort['objekte']) <= AVESMAPS_GARETIEN_LISTE_MAX,
    'ein ueberlanger Schluessel-Nachschlag darf nicht abbrechen: ' . count($antwort['objekte']));
$pruefungen++;

// ⚠️ Gegenprobe zur eigenen Regel: EIN LEERES `keys`-Array ist KEIN Filter, sondern die Abwesenheit
// eines Nachschlags -- dieselbe Regel wie bei ebene/typ/urteil/wiki (Docblock von
// avesmapsGaretienListeObjektPasstFilter). Ohne diese Zusicherung koennte "if (isset(...))" durch
// "if (isset(...) && $filter['keys'] !== [])" ersetzt oder umgekehrt vertauscht werden, ohne dass
// eine der Zusicherungen oben es merkt -- sie schicken alle ein NICHT-leeres `keys` mit.
$antwortLeer = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => []]);
assert(count($antwortLeer['objekte']) === count($liste['objekte']),
    'ein leeres keys-Array ist kein Filter, sondern "kein Nachschlag": '
    . count($antwortLeer['objekte']) . ' gegen ' . count($liste['objekte']));
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
