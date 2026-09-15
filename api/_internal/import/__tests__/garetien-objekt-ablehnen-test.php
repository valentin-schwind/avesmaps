<?php

declare(strict_types=1);

// Objekte OHNE Vorschlag lassen sich ablehnen (Owner 15.09.2026).
//
// Owner, woertlich: „ich würde gerne dinge - auch wenn ich sie keinen vorschlag tragen - auch ablehnen
// können, sodass sie aus 'Offen' verschwinden" und „die editoren wollen alle objekte in 'Offen' auch
// ablehnen dürfen auch wenn sie nicht übernommen werden können und nichts tragen".
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-objekt-ablehnen-test.php

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
// A. Der Stand eines Objekts OHNE Item -- rein.
// =================================================================================================
$schluesselA = 'ggp:Ortschaften_1:Stadtviertel:Garetien:Nordend!Nordend';
$pruefe(avesmapsGaretienListeObjektStandOhneItem([], $schluesselA) === 'offen', 'ohne Entscheidung: offen');
$pruefe(avesmapsGaretienListeObjektStandOhneItem([
    avesmapsSyncPlanDecisionKey($schluesselA, 'objekt') => ['declined_at' => '2026-09-15 12:00:00'],
], $schluesselA) === 'abgelehnt', 'eine Objekt-Ablehnung macht das Objekt abgelehnt');
// 💣 Der change_type IST Teil des Schluessels: eine Ablehnung unter 'new' ist nicht die des Objekts.
$pruefe(avesmapsGaretienListeObjektStandOhneItem([
    avesmapsSyncPlanDecisionKey($schluesselA, 'new') => ['declined_at' => '2026-09-15 12:00:00'],
], $schluesselA) === 'offen', 'eine Ablehnung unter einem anderen change_type zaehlt nicht');
// Eine Zeile ohne `declined_at` (etwa nur ein Uebernahme-Vermerk) ist keine Ablehnung.
$pruefe(avesmapsGaretienListeObjektStandOhneItem([
    avesmapsSyncPlanDecisionKey($schluesselA, 'objekt') => ['declined_at' => null, 'applied_at' => '2026-09-15'],
], $schluesselA) === 'offen', 'ohne declined_at keine Ablehnung');
$pruefe(avesmapsGaretienListeObjektStandOhneItem([
    avesmapsSyncPlanDecisionKey($schluesselA . 'X', 'objekt') => ['declined_at' => '2026-09-15 12:00:00'],
], $schluesselA) === 'offen', 'die Ablehnung eines ANDEREN Objekts zaehlt nicht');
$pruefe(strlen(AVESMAPS_GARETIEN_OBJEKT_ENTSCHEIDUNG) <= 8, 'der change_type passt in VARCHAR(8)');

// =================================================================================================
// B. Die Schluessel werden gesaeubert -- und was wegfaellt, wird GEZAEHLT.
// =================================================================================================
$saeubern = avesmapsGaretienObjektSchluesselSaeubern([
    'a', ' a ', 'b', '', '   ', 7, null, ['a'],
    str_repeat('x', 191),
    str_repeat('ä', 190),    // 190 ZEICHEN, 380 Bytes -- gueltig
    'objekt|anlass|w-1',     // ein Item-Schluessel ist kein Objektschluessel
    '123',
]);
$pruefe($saeubern['keys'] === ['a', 'b', str_repeat('ä', 190), '123'],
    'entdoppelt, getrimmt, in Zeichen gemessen, als ZEICHENKETTE: ' . json_encode($saeubern['keys']));
$pruefe($saeubern['ungueltig'] === 7,
    'leer (2), keine Zeichenkette (3), zu lang (1), Item-Schluessel (1) -- und " a " ist KEIN Fehler: '
    . $saeubern['ungueltig']);
$pruefe($saeubern['gekappt'] === 0, 'nichts gekappt');
$pruefe(is_string($saeubern['keys'][3]), '💣 "123" bleibt eine Zeichenkette (array_keys macht daraus eine Zahl)');

$viele = [];
for ($i = 0; $i < AVESMAPS_GARETIEN_OBJEKT_ENTSCHEIDUNG_DECKEL + 3; $i++) {
    $viele[] = 'k' . $i;
}
$gekappt = avesmapsGaretienObjektSchluesselSaeubern($viele);
$pruefe(count($gekappt['keys']) === AVESMAPS_GARETIEN_OBJEKT_ENTSCHEIDUNG_DECKEL, 'gedeckelt');
$pruefe($gekappt['gekappt'] === 3, '💣 …und die Kappung wird GEMELDET, nie still: ' . $gekappt['gekappt']);

// =================================================================================================
// C. Der ECHTE Weg: Liste -> ablehnen -> Liste -> neuer Lauf -> wieder vorschlagen.
// =================================================================================================
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

// Ein Objekt, das es sicher OHNE Vorschlag gibt: ein Stadtviertel hat bei uns kein Gegenstueck
// (dieselbe Zeile wie am Ende von garetien-liste-test.php).
$zeile = [
    'run_id' => 1, 'wiki' => 'ggp', 'ebene' => 'Ortschaften_1', 'zeile_nr' => 902,
    'typ' => 'Stadtviertel', 'namensraum' => 'Garetien', 'artikel' => 'Nordend', 'anzeige' => 'Nordend',
    'lodmin' => '4', 'lodmax' => '14', 'extra' => '', 'geo_art' => 'koordinaten',
    'geo' => '5000 5000', 'roh' => '', 'urteil' => 'uebersprungen',
    'grund' => 'Typ "Stadtviertel" hat bei uns kein Gegenstueck',
];
$pdo->prepare('INSERT INTO garetien_import_row (' . implode(', ', array_keys($zeile)) . ') VALUES (:'
    . implode(', :', array_keys($zeile)) . ')')->execute($zeile);

$objektNach = static function (PDO $pdo, string $name, array $filter = []): ?array {
    foreach (avesmapsGaretienArbeitsliste($pdo, 1, $filter)['objekte'] as $o) {
        if ($o['name'] === $name) {
            return $o;
        }
    }
    return null;
};
$liste = avesmapsGaretienArbeitsliste($pdo, 1, []);
$nordend = $objektNach($pdo, 'Nordend');
$gardel = $objektNach($pdo, 'Gardel');
$pruefe($nordend !== null && $nordend['items'] === [], 'Vorbedingung: Nordend steht OHNE Item in der Liste');
$pruefe($nordend['stand'] === 'offen', 'Vorbedingung: und ist offen');
$pruefe($gardel !== null && $gardel['items'] !== [], 'Vorbedingung: der Gardel traegt einen Vorschlag');
$vorher = $liste['reiter'];
$lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
$runId = (int) $lauf['id'];

// 💣 Der Schreiber des Hauses ist MySQL-Syntax -- hier ein portabler, der dieselbe Zeile anlegt.
$geschrieben = [];
$schreiber = static function (PDO $pdo, string $kind, string $key, int $userId, string $changeType) use (&$geschrieben): void {
    $geschrieben[] = [$kind, $key, $userId, $changeType];
    $pdo->prepare('INSERT INTO sync_decision (kind, entity_key, change_type, declined_at, declined_by) VALUES (?, ?, ?, ?, ?)')
        ->execute([$kind, $key, $changeType, '2026-09-15 12:00:00', $userId]);
};

$ergebnis = avesmapsGaretienObjekteAblehnen($pdo, $runId,
    [$nordend['key'], $gardel['key'], '', str_repeat('x', 191)], 42, $schreiber);
$pruefe($ergebnis === ['abgelehnt' => 1, 'mit_vorschlag' => 1, 'ungueltig' => 2, 'gekappt' => 0],
    'abgelehnt wird nur das Objekt OHNE Item, der Rest wird GEZAEHLT: ' . json_encode($ergebnis));
$pruefe($geschrieben === [[AVESMAPS_GARETIEN_PLAN_KIND, $nordend['key'], 42, 'objekt']],
    'genau EINE Zeile, am Objektschluessel, unter "objekt": ' . json_encode($geschrieben));
$zaehle = static function (PDO $pdo, string $key, string $changeType): int {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_decision WHERE entity_key = ? AND change_type = ?');
    $stmt->execute([$key, $changeType]);
    return (int) $stmt->fetchColumn();
};
$pruefe($zaehle($pdo, $gardel['key'], 'objekt') === 0,
    '🔴 ein Objekt MIT Vorschlag bekommt KEINE Objekt-Zeile -- sie stuende wirkungslos neben seinen Items');

$nachher = avesmapsGaretienArbeitsliste($pdo, 1, []);
$pruefe($objektNach($pdo, 'Nordend')['stand'] === 'abgelehnt', 'Nordend ist jetzt abgelehnt');
$pruefe($nachher['reiter']['offen'] === $vorher['offen'] - 1,
    'und verschwindet aus „Offen": ' . $vorher['offen'] . ' -> ' . $nachher['reiter']['offen']);
$pruefe($nachher['reiter']['abgelehnt'] === $vorher['abgelehnt'] + 1,
    'und steht in „Abgelehnt": ' . $vorher['abgelehnt'] . ' -> ' . $nachher['reiter']['abgelehnt']);
$pruefe($objektNach($pdo, 'Gardel')['stand'] === $gardel['stand'], 'der Gardel bleibt, wie er war');
$pruefe($objektNach($pdo, 'Nordend', ['stand' => 'abgelehnt']) !== null, 'der Reiter „Abgelehnt" zeigt Nordend');
$pruefe($objektNach($pdo, 'Nordend', ['stand' => 'offen']) === null, 'der Reiter „Offen" nicht mehr');

// 🔴 DIE ABLEHNUNG UEBERLEBT „Holen & Rechnen" -- sonst waere der Fortschritt beim naechsten Lauf weg.
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$nachLauf = $objektNach($pdo, 'Nordend');
$pruefe($nachLauf !== null && $nachLauf['items'] === [], 'Vorbedingung: Nordend traegt auch im neuen Lauf kein Item');
$pruefe($nachLauf['stand'] === 'abgelehnt', '🔴 die Ablehnung ueberlebt einen neuen Lauf: ' . $nachLauf['stand']);

// Leere Anfrage: nichts geschrieben, nichts gerufen.
$geschrieben = [];
$leer = avesmapsGaretienObjekteAblehnen($pdo, $runId, [], 42, $schreiber);
$pruefe($leer === ['abgelehnt' => 0, 'mit_vorschlag' => 0, 'ungueltig' => 0, 'gekappt' => 0] && $geschrieben === [],
    'eine leere Anfrage schreibt nichts');

// 💣 EIN WURF MITTEN IM LAUF ROLLT ALLES ZURUECK -- keine halbe Ablehnung.
$lauf2 = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$zweiter = 'ggp:Ortschaften_1:Stadtviertel:Garetien:Suedend!Suedend';
$aufrufe = 0;
$wirft = static function (PDO $pdo, string $kind, string $key, int $userId, string $changeType) use (&$aufrufe, $schreiber): void {
    $aufrufe++;
    if ($aufrufe === 2) {
        throw new RuntimeException('Datenbank weg');
    }
    $schreiber($pdo, $kind, $key, $userId, $changeType);
};
$geworfen = false;
try {
    avesmapsGaretienObjekteAblehnen($pdo, $lauf2, ['ggp:Ortschaften_1:Stadtviertel:Garetien:Westend!Westend', $zweiter], 42, $wirft);
} catch (RuntimeException) {
    $geworfen = true;
}
$pruefe($geworfen, 'der Fehler wird geworfen, nicht geschluckt');
$pruefe($zaehle($pdo, 'ggp:Ortschaften_1:Stadtviertel:Garetien:Westend!Westend', 'objekt') === 0,
    '💣 die erste Zeile ist zurueckgerollt -- sonst meldete die Oberflaeche einen Fehler fuer etwas, das halb geschah');
$pruefe(!$pdo->inTransaction(), 'und keine Transaktion bleibt offen');

// Wieder vorschlagen: loescht die Objekt-Zeile -- und NUR die.
$gardelItem = $gardel['items'][0];
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, ?, ?, '2026-09-15 12:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND, $gardel['key'], (string) $gardelItem['change_type']]);
$wieder = avesmapsGaretienObjekteWiederVorschlagen($pdo, [$nordend['key'], $gardel['key'], 'gibt-es-nicht', '']);
$pruefe($wieder === ['wieder' => 1, 'ungueltig' => 1, 'gekappt' => 0], 'genau die eine Objekt-Zeile: ' . json_encode($wieder));
$pruefe($objektNach($pdo, 'Nordend')['stand'] === 'offen', 'Nordend steht wieder in „Offen"');
$pruefe($zaehle($pdo, $gardel['key'], (string) $gardelItem['change_type']) === 1,
    '🔴 eine Item-Ablehnung am selben Schluessel bleibt unberuehrt -- die nimmt `undecline` zurueck');
$pruefe(avesmapsGaretienArbeitsliste($pdo, 1, [])['reiter']['abgelehnt'] >= 0, 'die Liste laeuft danach weiter');

// =================================================================================================
// D. Die Naehte -- am Quelltext OHNE Kommentare (ein Kommentar, der das Muster nennt, ist kein Code).
// =================================================================================================
$ohneKommentare = static function (string $quelle): string {
    $raus = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $raus .= is_array($token) ? $token[1] : $token;
    }
    return $raus;
};
$rumpfVon = static function (string $code, string $funktion): string {
    $ab = strpos($code, 'function ' . $funktion . '(');
    assert($ab !== false, $funktion . ' steht nicht im Code');
    $bis = strpos($code, "\nfunction ", $ab + 10);
    return substr($code, $ab, $bis === false ? null : $bis - $ab);
};
$liste = $ohneKommentare((string) file_get_contents(__DIR__ . '/../garetien-liste.php'));
$ablehnen = $rumpfVon($liste, 'avesmapsGaretienObjekteAblehnen');
$pruefe(str_contains($ablehnen, "?? 'avesmapsSyncPlanRecordDecline'"),
    '🔴 in Produktion schreibt der Schreiber des HAUSES -- der portable ist nur der des Tests');
$ensure = strpos($ablehnen, 'avesmapsEnsureSyncPlanTables(');
$begin = strpos($ablehnen, 'beginTransaction(');
$pruefe($ensure !== false && $begin !== false && $ensure < $begin,
    '💣 das Ensure steht VOR der Transaktion -- DDL committet in MySQL implizit');
// Die Signatur des Hausschreibers passt zu dem, was hier gerufen wird.
$parameter = array_map(static fn(ReflectionParameter $p): string => $p->getName(),
    (new ReflectionFunction('avesmapsSyncPlanRecordDecline'))->getParameters());
$pruefe($parameter === ['pdo', 'kind', 'entityKey', 'userId', 'changeType'],
    'der Hausschreiber nimmt (pdo, kind, entityKey, userId, changeType): ' . implode(',', $parameter));
$pruefe(str_contains($rumpfVon($liste, 'avesmapsGaretienArbeitslisteObjekte'),
    "avesmapsGaretienListeObjektStandOhneItem(\$entscheidungen, (string) \$key)"),
    '🔴 der Listenbau fragt den Stand OHNE Item wirklich ab, statt fest „offen" zu schreiben');

$endpunkt = $ohneKommentare((string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php'));
$zweigAb = strpos($endpunkt, "\$action === 'objekte_ablehnen'");
$pruefe($zweigAb !== false, 'der Endpunkt kennt `objekte_ablehnen`');
// ⚠️ Das Fenster endet am naechsten ZWEIGANFANG (`if ($action === `), nicht am naechsten `$action === `:
// der Zweig nennt seine eigene Aktion ein zweites Mal (in der Weiche zwischen Ablehnen und Wieder), und
// dort geschnitten fehlten genau die zwei Aufrufe, um die es geht.
$zweigBis = strpos($endpunkt, "if (\$action === ", (int) $zweigAb + 10);
$pruefe($zweigBis !== false, 'hinter dem Zweig kommt ein weiterer -- sonst waere das Fenster der Rest der Datei');
$zweig = substr($endpunkt, (int) $zweigAb, (int) $zweigBis - (int) $zweigAb);
foreach (["'objekte_wieder'", 'avesmapsGaretienObjekteAblehnen(', 'avesmapsGaretienObjekteWiederVorschlagen(',
    "'plan_not_open'", "AVESMAPS_GARETIEN_PLAN_KIND"] as $muss) {
    $pruefe(str_contains($zweig, $muss), 'der Zweig enthaelt ' . $muss);
}
$adminListe = substr($endpunkt, (int) strpos($endpunkt, "in_array(\$action, ['ebenen'"), 200);
$pruefe(!str_contains($adminListe, 'objekte_'), '⚠️ ablehnen darf jeder Editor -- kein Admin-Riegel');

echo 'OK: garetien-objekt-ablehnen, ' . $pruefungen . ' Pruefungen.' . PHP_EOL;
