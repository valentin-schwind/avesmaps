<?php

declare(strict_types=1);

// Der Riegel „beides" (Entwurf docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5).
//
// 💣 Ein `apply`, das fuer DASSELBE Objekt ein Neu-Item UND ein Ergaenzungs-Item traegt, legt eine
// Dublette an und haengt zugleich die Garetien-Quelle an den Bestand (K6). Das darf nur geschehen,
// wenn der Editor die Wahl „Auf die Karte -- zusaetzlich zu X" ausdruecklich getroffen hat -- und
// das steht im Rumpf als `beides: true` an JEDEM beteiligten Item. Eine Sperre nur im Browser ist
// keine: die Tuer (api/edit/wiki/sync-plan.php) weist das `apply` mit 422 ab.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll \
//           api/_internal/import/__tests__/garetien-beides-riegel-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

// =================================================================================================
// A. Der reine Riegel
// =================================================================================================
// Die Schluessel, wie der Planbau sie baut: das Zusatz-Item traegt die nackte Objektbasis
// (avesmapsGaretienErgaenzungsEintraege klont die Vorlage), das Ergaenzungs-Item haengt
// `|ergaenzung|<public_id>` an (avesmapsGaretienAbschnittsEintrag).
$basis = 'ggp:Gewaesser:Fluss:Garetien:Natter!Natter';
$zusatz = ['id' => 11, 'entity_key' => $basis, 'change_type' => 'new'];
$ergaenzung = ['id' => 12, 'entity_key' => $basis . '|ergaenzung|w-1', 'change_type' => 'changed'];
$ergaenzung2 = ['id' => 13, 'entity_key' => $basis . '|ergaenzung|w-2', 'change_type' => 'changed'];

$grund = avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], []);
assert(is_string($grund) && str_contains($grund, 'Natter'),
    'A: Neu + Ergaenzung desselben Objekts ohne Bestaetigung wird abgewiesen, und der Grund nennt das Objekt: ' . var_export($grund, true));
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [11 => ['beides' => true]]) !== null,
    'A: EINE Bestaetigung reicht nicht -- beide Items muessen sie tragen');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [12 => ['beides' => true]]) !== null,
    'A: auch nicht die am Ergaenzungs-Item allein');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [11 => ['beides' => true], 12 => ['beides' => true]]) === null,
    'A: mit beiden Bestaetigungen geht es durch -- ohne diese Ausnahme wiese der Riegel genau die Wahl ab, die ihn braucht');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [11 => ['beides' => 'true'], 12 => ['beides' => 1]]) !== null,
    'A: 💣 nur ein echtes `true` bestaetigt -- "true" und 1 sind keine ausdrueckliche Wahl');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung, $ergaenzung2],
    [11 => ['beides' => true], 12 => ['beides' => true]]) !== null,
    'A: ein ZWEITES Ergaenzungs-Item ohne Bestaetigung faellt ebenso');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung, $ergaenzung2],
    [11 => ['beides' => true], 12 => ['beides' => true], 13 => ['beides' => true]]) === null,
    'A: alle drei bestaetigt: durch');
$pruefungen += 7;

assert(avesmapsGaretienBeidesRiegel([$zusatz], []) === null, 'A: ein Neu-Item allein braucht keine Bestaetigung');
assert(avesmapsGaretienBeidesRiegel([$ergaenzung, $ergaenzung2], []) === null, 'A: Ergaenzungen allein ebenso wenig');
$fremd = ['id' => 21, 'entity_key' => 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel', 'change_type' => 'new'];
assert(avesmapsGaretienBeidesRiegel([$fremd, $ergaenzung], []) === null,
    'A: Neu an einem ANDEREN Objekt und Ergaenzung an diesem sind kein Paar');
assert(avesmapsGaretienBeidesRiegel([], []) === null, 'A: nichts, kein Einwand');
$pruefungen += 4;

// =================================================================================================
// B. Der Leser der Tuer -- gegen echte Zeilen, nur die ids DIESES Laufs
// =================================================================================================
$pdo = avesmapsGaretienPlanTestPdo();
$lauf = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'beides-riegel');
$fremderLauf = avesmapsSyncPlanStartRun($pdo, 'citymap', 7, 'fremd');
$legeAn = $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, after_json, selected)
                         VALUES (?, ?, NULL, ?, ?, '{}', 1)");
$legeAn->execute([$lauf, $basis, 'new', 'Natter (Fluss) zusaetzlich anlegen']);
$idZusatz = (int) $pdo->lastInsertId();
$legeAn->execute([$lauf, $basis . '|ergaenzung|w-1', 'changed', 'Natter (Fluss) Quelle']);
$idErgaenzung = (int) $pdo->lastInsertId();
$legeAn->execute([$fremderLauf, $basis . '|ergaenzung|w-9', 'changed', 'fremd']);
$idFremd = (int) $pdo->lastInsertId();

assert(is_string(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung], null)),
    'B: die Tuer liest die Zeilen selbst und weist das Paar ohne `einstellungen_je_item` ab');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung],
    [$idZusatz => ['beides' => true], $idErgaenzung => ['beides' => true]]) === null,
    'B: mit beiden Bestaetigungen laesst sie es durch');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idFremd], null) === null,
    'B: 💣 eine id aus einem FREMDEN Lauf zaehlt nicht mit -- sonst koennte sie ein Paar vortaeuschen');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz], null) === null,
    'B: das Neu-Item allein ist kein Paar');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [], null) === null, 'B: ohne ids kein Einwand');
$pruefungen += 5;

// --- B2. DER BESTAND (Owner 14.09.2026): eine ABGELEHNTE Zeile bleibt abgelehnt.
// 🔴 Gezaehlt wird nur, was dieses `apply` wirklich schreiben wuerde -- dieselbe Menge wie
// avesmapsGaretienPendingItemsScoped (`selected = 1 AND apply_state IS NULL`). Eine abgelehnte
// Ergaenzung (die Tuer 'decline' hakt sie ab, sync-plan.php) wird nicht uebernommen; sie mit einem
// Neu-Item desselben Objekts zum Paar zu zaehlen, wiese ein `apply` ab, das gar keine Dublette mit
// Quelle am Bestand erzeugen kann -- und zwaenge den Editor, eine Ablehnung zurueckzunehmen.
$pdo->prepare('UPDATE sync_plan_item SET selected = 0 WHERE id = ?')->execute([$idErgaenzung]);
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, ?, 'changed', '2026-09-01 10:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND, $basis . '|ergaenzung|w-1']);
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung], null) === null,
    'B2: eine abgelehnte (abgehakte) Ergaenzung ist kein Teil des Paars');
$declinedB2 = $pdo->query("SELECT declined_at FROM sync_decision WHERE entity_key = '" . $basis . "|ergaenzung|w-1'")->fetchColumn();
assert($declinedB2 === '2026-09-01 10:00:00', 'B2: und die Ablehnung steht unberuehrt: ' . var_export($declinedB2, true));
// Ein bereits UEBERNOMMENES Item eines frueheren Haeppchens zaehlt ebenso nicht mehr mit.
$pdo->prepare("UPDATE sync_plan_item SET selected = 1, apply_state = 'done', apply_note = 'w-1' WHERE id = ?")->execute([$idErgaenzung]);
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung], null) === null,
    'B2: ein schon uebernommenes Item (apply_state done) ist kein Teil des Paars');
$pruefungen += 3;

// =================================================================================================
// C. Die Tuer benutzt den Riegel -- VOR der Sperre und VOR dem Verteiler
// =================================================================================================
// 🔴 Eine Quelltext-Tatsache, weil der Vertrag sie verlangt (422 `garetien_beides_unbestaetigt`,
// Envelope ueber avesmapsErrorResponse). Kommentarfrei ueber den Tokenizer, zeilenendenneutral
// (AGENTS.md §9: hier CRLF, im Deploy-Tor LF).
$quelltext = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-plan.php'));
$code = '';
foreach (token_get_all($quelltext) as $token) {
    if (is_array($token)) {
        if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= $token[1];
        continue;
    }
    $code .= $token;
}
$applyAb = strpos($code, "case 'apply':");
$declinedAb = strpos($code, "case 'declined':");
assert($applyAb !== false && $declinedAb !== false && $applyAb < $declinedAb, 'C (Testaufbau): der apply-Zweig steht in sync-plan.php');
$apply = substr($code, $applyAb, $declinedAb - $applyAb);
$riegelPos = strpos($apply, 'avesmapsGaretienBeidesPruefen($pdo, $runId, $garetienItemIds, $garetienJeItem)');
assert($riegelPos !== false,
    'C: die Tuer ruft den Riegel mit dem Lauf, den ids UND den Handeingaben je Item');
assert(preg_match("~avesmapsErrorResponse\(\s*422\s*,\s*'garetien_beides_unbestaetigt'~", $apply) === 1,
    'C: und antwortet 422 mit dem Maschinencode garetien_beides_unbestaetigt');
$jeItemPos = strpos($apply, '$garetienJeItem = avesmapsGaretienEinstellungenJeItemAusRumpf(');
$sperrePos = strpos($apply, 'avesmapsWikiDumpLockAcquireOrThrow(');
$verteilerPos = strpos($apply, "'garetien' => avesmapsGaretienApplyStep(");
assert($jeItemPos !== false && $jeItemPos < $riegelPos,
    'C: der Riegel steht NACH dem Lesen der Handeingaben -- sonst prueft er gegen null');
assert($sperrePos !== false && $riegelPos < $sperrePos,
    'C: und VOR der Pipeline-Sperre -- eine Absage darf die Sperre nicht halten');
assert($verteilerPos !== false && $riegelPos < $verteilerPos, 'C: und VOR dem Verteiler, der schreibt');
$pruefungen += 6;

echo "OK: {$pruefungen} Pruefungen\n";
