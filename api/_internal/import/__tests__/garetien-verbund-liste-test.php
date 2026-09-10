<?php

declare(strict_types=1);

// Aufgabe 10 (Fragmente-Verbund): der Reiter „Uebernommen" zeigt einen Verbund als EINE Zeile.
// Entwurf: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §7
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-10-brief.md
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

// 🔴 DER VERBUND KOMMT AUS DEM VERMERK, NIE AUS DER NAMENSREGEL. Wuerde die Liste ihn beim
// Anzeigen neu ausrechnen, zeigte sie nach jeder Aenderung der Erkennungsregel eine andere
// Gruppierung als die, die tatsaechlich geschrieben wurde.
$item = ['apply_state' => 'done',
         'apply_note' => avesmapsGaretienVerbundVermerk('a1', 'r1', 'Silker Hain')];
assert(avesmapsGaretienVerbundAngelegt($item) === 'Silker Hain');

// Ein Item ohne Verbund -- und ein ALTER Vermerk -- liefern "".
assert(avesmapsGaretienVerbundAngelegt(['apply_state' => 'done', 'apply_note' => 'r1']) === '');
assert(avesmapsGaretienVerbundAngelegt(['apply_state' => null, 'apply_note' => '']) === '');

// ⚠️ Nur ein UEBERNOMMENES Item traegt den Vermerk -- ein geplantes hat ihn nicht.
assert(avesmapsGaretienVerbundAngelegt(
    ['apply_state' => null, 'apply_note' => avesmapsGaretienVerbundVermerk('a1', 'r1', 'X')]) === '',
    'ein nicht uebernommenes Item darf keinen angelegten Verbund melden');

// =================================================================================================
// EIGENE ERGAENZUNG DIESER SITZUNG: die reine Funktion allein beweist nicht, dass sie am
// OBJEKT auch wirklich ankommt -- avesmapsGaretienArbeitslisteObjekte fasst je Objekt MEHRERE
// rohe Items zu EINEM `verbund_angelegt` zusammen (der Schleifen-Rumpf aus dem Brief). Dieser
// Abschnitt fuehrt den ECHTEN Aufbau ueber ein Objekt mit zwei Items aus ("Alke": ein
// Quellen-Ergaenzungs-Item plus das Basis-Item, dieselbe Fixture wie garetien-liste-keys-test.php)
// und misst das Ergebnis, statt nur die isolierte Funktion zu pruefen.
// =================================================================================================

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

function avesmapsGaretienTestAlkeVerbundAngelegt(PDO $pdo): string
{
    foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
        if ($o['name'] === 'Alke') {
            return (string) ($o['verbund_angelegt'] ?? '(fehlt)');
        }
    }
    return '(Alke nicht gefunden)';
}

// Vorbedingung: die Alke traegt wirklich zwei Items (Basis + Quellen-Ergaenzung) -- sonst prueft
// der Rest nur zufaellig gegen ein einzelnes Item.
$alkeItems = $pdo->query(
    "SELECT id FROM sync_plan_item WHERE entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke!Alke%' ORDER BY id"
)->fetchAll(PDO::FETCH_COLUMN);
assert(count($alkeItems) === 2, 'die Vorbedingung: die Alke traegt zwei Items, nicht ' . count($alkeItems));
[$ergaenzungId, $basisId] = $alkeItems;   // ORDER BY id: die Ergaenzung zuerst, dann das Basis-Item

// Noch kein Item uebernommen -- kein Verbund angelegt.
assert(avesmapsGaretienTestAlkeVerbundAngelegt($pdo) === '', 'ohne Uebernahme kein Verbund');

// Nur das ZWEITE Item (das Basis-Item) traegt den Vermerk -- die Schleife darf beim ersten
// (leeren) Item nicht aufgeben, sondern muss bis zum zweiten weitersuchen.
$pdo->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')->execute([
    ':s' => 'done', ':n' => avesmapsGaretienVerbundVermerk('area-x', 'region-x', 'Alke-Verbund'), ':id' => $basisId,
]);
assert(avesmapsGaretienTestAlkeVerbundAngelegt($pdo) === 'Alke-Verbund',
    'der Vermerk des zweiten Items muss durchdringen, auch wenn das erste Item leer ist');

// Traegt zusaetzlich das ERSTE Item (die Ergaenzung) ebenfalls einen Vermerk, gewinnt DER --
// „der ERSTE Vermerk gewinnt" (Brief), und die Items stehen in `ORDER BY id`, die Ergaenzung
// also vor dem Basis-Item.
$pdo->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')->execute([
    ':s' => 'done', ':n' => avesmapsGaretienVerbundVermerk('area-y', 'region-y', 'Erster-Vermerk'), ':id' => $ergaenzungId,
]);
assert(avesmapsGaretienTestAlkeVerbundAngelegt($pdo) === 'Erster-Vermerk',
    'traegt auch das erste Item einen Vermerk, gewinnt dieser -- nicht der des zweiten Items');

// Der ZWEITE Erzeuger (Zeilen OHNE Item, "deckt sich"/"uebersprungen") traegt das Feld ebenfalls,
// leer -- sonst waere es im Browser `undefined` statt `""` (dieselbe Regel wie `innerorts_uebernommen`).
$ohneItem = null;
foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
    if (($o['items'] ?? []) === []) { $ohneItem = $o; break; }
}
assert($ohneItem !== null, 'die Vorbedingung: mindestens ein Objekt ohne Item muss in der Fixture stehen');
assert(array_key_exists('verbund_angelegt', $ohneItem), 'ein Objekt ohne Item traegt das Feld trotzdem');
assert($ohneItem['verbund_angelegt'] === '', 'und es ist leer, nicht undefiniert: '
    . json_encode($ohneItem['verbund_angelegt'] ?? '(fehlt)'));

echo "OK -- garetien-verbund-liste\n";
