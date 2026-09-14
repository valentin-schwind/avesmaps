<?php

declare(strict_types=1);

// Aufgabe 4 (Garetien-Importer vereint): „Übernommen" faltet einen Verbund LAUFÜBERGREIFEND.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Fehler 8, §6.8
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

// =================================================================================================
// A. Die reine Entscheidung: der LAUFENDE Lauf entscheidet, sobald er ein uebernommenes Item traegt.
// =================================================================================================

$done = static fn(string $note): array => ['apply_state' => 'done', 'apply_note' => $note];
$offen = ['apply_state' => null, 'apply_note' => ''];

assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend([$offen], 'Silker Hain') === 'Silker Hain',
    'ohne uebernommenes Item im laufenden Lauf gilt der Vermerk des frueheren Laufs');
assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend([], 'Silker Hain') === 'Silker Hain',
    'auch ganz ohne Item im laufenden Lauf');
assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend(
    [$offen, $done(avesmapsGaretienVerbundVermerk('a', 'r', 'Neu-Stamm'))], 'Silker Hain') === 'Neu-Stamm',
    'ein Vermerk des laufenden Laufs schlaegt den frueheren');
// 💣 EIN EINZELN UEBERNOMMENES OBJEKT IST KEIN VERBUND MEHR -- auch wenn es frueher einer war.
assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend([$done('region-neu')], 'Silker Hain') === '',
    'ein uebernommenes Item OHNE Verbund im laufenden Lauf entscheidet -- der alte Vermerk zaehlt nicht');

// =================================================================================================
// B. Der ECHTE Aufbau ueber zwei und drei Laeufe.
// =================================================================================================

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$alke = static function (PDO $pdo): array {
    foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
        if ($o['name'] === 'Alke') {
            return $o;
        }
    }
    throw new RuntimeException('Alke nicht gefunden');
};
$basisItemDesOffenenLaufs = static function (PDO $pdo): int {
    $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    assert($lauf !== null, 'Vorbedingung: ein offener Lauf');
    $ids = $pdo->prepare(
        "SELECT id FROM sync_plan_item WHERE run_id = :r AND entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke!Alke%' ORDER BY id"
    );
    $ids->execute([':r' => (int) $lauf['id']]);
    $alle = $ids->fetchAll(PDO::FETCH_COLUMN);
    assert(count($alle) === 2, 'Vorbedingung: die Alke traegt zwei Items, nicht ' . count($alle));
    return (int) $alle[1];   // ORDER BY id: erst die Ergaenzung, dann das Basis-Item
};
$setze = static function (PDO $pdo, int $id, ?string $state, ?string $note): void {
    $pdo->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')
        ->execute([':s' => $state, ':n' => $note, ':id' => $id]);
};

// Lauf 1: die Alke ist als Teil des Verbunds „Alke-Verbund" uebernommen.
$idLauf1 = $basisItemDesOffenenLaufs($pdo);
$setze($pdo, $idLauf1, 'done', avesmapsGaretienVerbundVermerk('area-1', 'region-1', 'Alke-Verbund'));
assert($alke($pdo)['verbund_angelegt'] === 'Alke-Verbund', 'Vorbedingung: im selben Lauf gefaltet');

// 🔴 BESTAND (Vertrag „Der Bestand", Owner 14.09.2026): der Importer ist live. Im selben alten Lauf
// liegen ein EINZELN uebernommenes Objekt mit NACKTEM Vermerk (nur eine public_id, die Form vor dem
// Verbund-Umbau) und eine ABGELEHNTE Zeile. Beide muessen nach dem naechsten Lauf unveraendert je
// EINE Zeile bleiben -- kein Verbund, kein Fehler, kein neuer Stand.
$lauf1 = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$itemVon = static function (PDO $pdo, int $lauf, string $muster): array {
    $stmt = $pdo->prepare('SELECT id, entity_key, change_type FROM sync_plan_item WHERE run_id = :r AND entity_key LIKE :m ORDER BY id');
    $stmt->execute([':r' => $lauf, ':m' => $muster]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    assert(is_array($zeile), 'Vorbedingung: ein Item fuer ' . $muster);
    return $zeile;
};
$gardel = $itemVon($pdo, $lauf1, 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel%');
$setze($pdo, (int) $gardel['id'], 'done', 'region-gardel-alt');
$muehlsee = $itemVon($pdo, $lauf1, 'ggp:Gewaesser:See:Garetien:Muehlsee%');
// ⚠️ Direkt geschrieben: avesmapsSyncPlanRecordDecline ist MySQL-Syntax (ON DUPLICATE KEY, UTC_TIMESTAMP).
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (:k, :e, :c, '2026-09-01 10:00:00')")
    ->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':e' => $muehlsee['entity_key'], ':c' => $muehlsee['change_type']]);

// 💣 FEHLER 8: nach „Holen & Rechnen" stehen die frischen Items auf `apply_state = null` -- der
// Reiter las nur sie und verlor die Faltung. Der Vermerk des ALTEN Laufs muss durchdringen.
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$nachNeuemLauf = $alke($pdo);
assert($nachNeuemLauf['verbund_angelegt'] === 'Alke-Verbund',
    'nach einem neuen Lauf faltet „Uebernommen" weiter aus dem Vermerk des frueheren Laufs: '
    . json_encode($nachNeuemLauf['verbund_angelegt']));

$nachName = static function (PDO $pdo, string $name): array {
    $treffer = array_values(array_filter(
        avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'],
        static fn(array $o): bool => $o['name'] === $name
    ));
    assert(count($treffer) === 1, $name . ' steht genau EINMAL in der Liste, nicht ' . count($treffer) . '-mal');
    return $treffer[0];
};
$gardelNeu = $nachName($pdo, 'Gardel');
assert($gardelNeu['stand'] === 'uebernommen', 'BESTAND: das einzeln uebernommene Objekt bleibt „uebernommen": ' . $gardelNeu['stand']);
assert($gardelNeu['verbund_angelegt'] === '', 'BESTAND: ein nackter alter Vermerk ist KEIN Verbund');
// ⚠️ Der Name ist der ARTIKEL („Muehlsee"), nicht die Anzeige („Mühlsee") -- Fall #118.
$muehlseeNeu = $nachName($pdo, 'Muehlsee');
assert($muehlseeNeu['stand'] === 'abgelehnt', 'BESTAND: die abgelehnte Zeile bleibt abgelehnt: ' . $muehlseeNeu['stand']);
assert($muehlseeNeu['verbund_angelegt'] === '', 'BESTAND: und wird nirgends einem Verbund zugeschlagen');
$uebernommen = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'uebernommen'])['objekte'];
assert(count(array_filter($uebernommen, static fn(array $o): bool => $o['name'] === 'Gardel')) === 1,
    'BESTAND: auf dem Reiter „Uebernommen" steht das alte Einzelobjekt als eine Zeile');

// Lauf 2 uebernimmt die Alke EINZELN (nach einer Ruecknahme, ohne Verbund) -- der juengste Lauf entscheidet.
$idLauf2 = $basisItemDesOffenenLaufs($pdo);
assert($idLauf2 !== $idLauf1, 'Vorbedingung: der zweite Lauf hat eigene Items');
$setze($pdo, $idLauf2, 'done', 'region-einzeln');
assert($alke($pdo)['verbund_angelegt'] === '',
    'uebernimmt der laufende Lauf das Objekt ohne Verbund, gilt der alte Vermerk nicht mehr');

// Lauf 3: jetzt liegen ZWEI fruehere Laeufe vor -- der juengere (Lauf 2, ohne Verbund) entscheidet,
// nicht der aeltere (Lauf 1, mit Verbund).
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
assert($alke($pdo)['verbund_angelegt'] === '',
    'unter mehreren frueheren Laeufen entscheidet der JUENGSTE, der das Objekt uebernommen hat: '
    . json_encode($alke($pdo)['verbund_angelegt']));

// Ein zurueckgenommenes Item traegt keinen Vermerk mehr (garetien-uebernahme.php setzt
// `apply_state = NULL, apply_note = NULL`) -- dann rueckt der aeltere Lauf nach.
$setze($pdo, $idLauf2, null, null);
assert($alke($pdo)['verbund_angelegt'] === 'Alke-Verbund',
    'ist der Vermerk des juengeren Laufs zurueckgenommen, gilt wieder der aeltere');

// Ein Objekt ganz ohne frueheren Vermerk bleibt leer.
foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
    if ($o['name'] === 'Gardel') {
        assert($o['verbund_angelegt'] === '', 'die Gardel war nie Teil eines Verbunds');
    }
}

echo "OK -- garetien-verbund-liste-laeufe\n";
