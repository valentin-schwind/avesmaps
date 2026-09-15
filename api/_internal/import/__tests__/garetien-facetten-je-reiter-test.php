<?php

declare(strict_types=1);

// Der Filtertrichter zaehlt JE REITER -- und den Lauf daneben (Owner 15.09.2026).
//
// Owner, woertlich: „kannst du noch machen, dass die filter nur für die ansichten/listen gelten und
// mitzählen, für die sie gerade zuständig sind (ich habe gerade grenzen von offen nach abgelehnt geschoben,
// die liste ist unter offen jetzt leer, aber die zahl wird trotzdem noch angezeigt)" und „du kannst auch
// Grenzen 0/3052 anzeigen 0 = aktuelle liste / 3052 = gesamte liste".
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-facetten-je-reiter-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;
$pruefe = static function (bool $bedingung, string $warum) use (&$pruefungen): void {
    assert($bedingung, $warum);
    $pruefungen++;
};

// =================================================================================================
// A. Die reine Zaehlung.
// =================================================================================================
$objekte = [
    ['stand' => 'offen', 'ebene' => 'Gewaesser', 'typ' => 'Fluss', 'urteil' => 'neu', 'wiki' => 'ggp'],
    ['stand' => 'offen', 'ebene' => 'Gewaesser', 'typ' => 'Bach', 'urteil' => 'neu', 'wiki' => 'kosch'],
    ['stand' => 'abgelehnt', 'ebene' => 'Grenzen', 'typ' => 'Reichsgrenze', 'urteil' => 'uebersprungen', 'wiki' => 'ggp'],
    ['stand' => 'abgelehnt', 'ebene' => 'Grenzen', 'typ' => 'Reichsgrenze', 'urteil' => 'uebersprungen', 'wiki' => 'ggp'],
];
$offen = avesmapsGaretienListeFacetten($objekte, 'offen');
$pruefe($offen['ebene'] === ['Gewaesser' => 2, 'Grenzen' => 0],
    '🔴 der Owner-Fall: „Grenzen" liegt nicht mehr in „Offen" -- 0, aber der Wert bleibt stehen: ' . json_encode($offen['ebene']));
$pruefe($offen['typ'] === ['Fluss' => 1, 'Bach' => 1, 'Reichsgrenze' => 0], 'Typ je Reiter: ' . json_encode($offen['typ']));
$pruefe($offen['urteil'] === ['neu' => 2, 'uebersprungen' => 0], 'Urteil je Reiter');
$pruefe($offen['wiki'] === ['ggp' => 1, 'kosch' => 1], 'Wiki je Reiter: ' . json_encode($offen['wiki']));
$pruefe(array_keys($offen['typ_kategorie']) === ['Fluss', 'Bach', 'Reichsgrenze'],
    'die Typ-Kategorie kennt auch die Typen, die im Reiter 0 zaehlen');

$abgelehnt = avesmapsGaretienListeFacetten($objekte, 'abgelehnt');
$pruefe($abgelehnt['ebene'] === ['Gewaesser' => 0, 'Grenzen' => 2], 'und in „Abgelehnt" stehen sie: ' . json_encode($abgelehnt['ebene']));
$pruefe(avesmapsGaretienListeFacetten($objekte, 'uebernommen')['ebene'] === ['Gewaesser' => 0, 'Grenzen' => 0],
    'ein leerer Reiter zaehlt ueberall 0, verliert aber keinen Wert');
$pruefe(avesmapsGaretienListeFacetten($objekte, '')['ebene'] === ['Gewaesser' => 2, 'Grenzen' => 2],
    'ohne Reiter zaehlt der ganze Lauf -- das ist `facetten_gesamt`');
$pruefe(avesmapsGaretienListeFacetten([], 'offen') === ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => [], 'typ_kategorie' => []],
    'ohne Objekte leere Facetten in der gewohnten Form');

// =================================================================================================
// B. Der ECHTE Listenbau: je Reiter ist die Facettensumme die Reiterzahl.
// =================================================================================================
$leererPdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
$leer = avesmapsGaretienArbeitsliste($leererPdo, 1, ['stand' => 'offen']);
$pruefe(isset($leer['facetten_gesamt']['ebene']) && $leer['facetten_gesamt']['ebene'] === [],
    'auch die leere Antwort traegt `facetten_gesamt` -- in derselben Form');

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

// Ein Objekt ohne Vorschlag, das in „Abgelehnt" liegt -- damit dieser Reiter nicht leer ist.
$zeile = [
    'run_id' => 1, 'wiki' => 'ggp', 'ebene' => 'Ortschaften_1', 'zeile_nr' => 902,
    'typ' => 'Stadtviertel', 'namensraum' => 'Garetien', 'artikel' => 'Nordend', 'anzeige' => 'Nordend',
    'lodmin' => '4', 'lodmax' => '14', 'extra' => '', 'geo_art' => 'koordinaten',
    'geo' => '5000 5000', 'roh' => '', 'urteil' => 'uebersprungen',
    'grund' => 'Typ "Stadtviertel" hat bei uns kein Gegenstueck',
];
$pdo->prepare('INSERT INTO garetien_import_row (' . implode(', ', array_keys($zeile)) . ') VALUES (:'
    . implode(', :', array_keys($zeile)) . ')')->execute($zeile);
$nordendKey = null;
foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
    if ($o['name'] === 'Nordend') {
        $nordendKey = $o['key'];
    }
}
$pruefe($nordendKey !== null, 'Vorbedingung: Nordend steht in der Liste');
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, ?, 'objekt', '2026-09-15 12:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND, $nordendKey]);

$ohneReiter = avesmapsGaretienArbeitsliste($pdo, 1, []);
$pruefe($ohneReiter['reiter']['offen'] > 0 && $ohneReiter['reiter']['abgelehnt'] >= 1,
    'Vorbedingung: „Offen" und „Abgelehnt" sind belegt: ' . json_encode($ohneReiter['reiter']));

foreach (['offen', 'abgelehnt', 'uebernommen'] as $stand) {
    $liste = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => $stand]);
    foreach (['ebene', 'typ', 'urteil', 'wiki'] as $feld) {
        $pruefe(array_sum($liste['facetten'][$feld]) === $liste['reiter'][$stand],
            '🔴 ' . $stand . '/' . $feld . ': die Facetten zaehlen genau den Reiter ('
            . array_sum($liste['facetten'][$feld]) . ' gegen ' . $liste['reiter'][$stand] . ')');
        $pruefe(array_keys($liste['facetten'][$feld]) === array_keys($ohneReiter['facetten'][$feld]),
            $stand . '/' . $feld . ': jeder Wert des Laufs bleibt stehen, zur Not mit 0');
        $pruefe($liste['facetten_gesamt'][$feld] === $ohneReiter['facetten'][$feld],
            $stand . '/' . $feld . ': `facetten_gesamt` ist der ganze Lauf, auf jedem Reiter derselbe');
    }
}
$nurAbgelehnt = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'abgelehnt']);
$pruefe(($nurAbgelehnt['facetten']['ebene']['Ortschaften_1'] ?? 0) >= 1, 'Nordend zaehlt in „Abgelehnt" mit');
$pruefe($nurAbgelehnt['facetten_gesamt']['ebene']['Ortschaften_1'] >= $nurAbgelehnt['facetten']['ebene']['Ortschaften_1'],
    'und der Lauf ist nie kleiner als der Reiter');

// 🔴 Die uebrigen Filter aendern die Facetten weiterhin NICHT -- sonst faellt nach dem ersten Klick jeder
// andere Wert auf 0.
// ⚠️ Der Filterwert wird aus den Daten GEWAEHLT, nicht festgeschrieben: in der Fixture liegt jedes offene
// Objekt in derselben Ebene, ein Ebenen-Filter naehme dort nichts weg, und die Zusicherung waere Vakuum.
$ungefiltert = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'offen']);
$teilTyp = null;
foreach ($ungefiltert['facetten']['typ'] as $typ => $anzahl) {
    if ($anzahl > 0 && $anzahl < $ungefiltert['reiter']['offen']) {
        $teilTyp = (string) $typ;
        break;
    }
}
$pruefe($teilTyp !== null, 'Vorbedingung: ein Typ, der in „Offen" vorkommt, aber nicht alles ist');
$gefiltert = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'offen', 'typ' => [$teilTyp]]);
$pruefe($gefiltert['gesamt'] < $ungefiltert['gesamt'], 'Vorbedingung: der Typ-Filter nimmt wirklich etwas weg');
$pruefe($gefiltert['facetten'] === $ungefiltert['facetten'], 'ein Filter im Trichter bewegt die Facetten nicht');

echo 'OK: garetien-facetten-je-reiter, ' . $pruefungen . ' Pruefungen.' . PHP_EOL;
