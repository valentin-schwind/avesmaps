<?php

declare(strict_types=1);

// Aufgabe 5 (Garetien-Importer vereint, 14.09.2026): der Filter „nur Verbünde" auf den Server-Reitern.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §7
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

// =================================================================================================
// A. Die Bibliothek: `nur_verbuende` laesst nur Objekte mit verbund_n >= 2 durch.
// =================================================================================================

$basis = ['ebene' => 'Waelder', 'typ' => 'Wald', 'urteil' => 'neu', 'wiki' => 'ggp', 'stand' => 'offen',
          'abschnitte' => [], 'items' => [], 'name' => 'Silker Hain 1'];
$verbund = ['key' => 'v'] + $basis + ['verbund_stamm' => 'Silker Hain', 'verbund_n' => 4];
$einzeln = ['key' => 'e'] + $basis;   // wie am Server: ohne Verbund fehlt das Feld GANZ
$halb = ['key' => 'h'] + $basis + ['verbund_stamm' => 'Silker Hain', 'verbund_n' => 1];

assert(avesmapsGaretienListeObjektPasstFilter($verbund, ['nur_verbuende' => true]) === true,
    'ein Verbund-Fragment passt');
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, ['nur_verbuende' => true]) === false,
    'ein Objekt ohne Verbund faellt heraus -- das Feld fehlt, und das ist KEIN Fehler');
assert(avesmapsGaretienListeObjektPasstFilter($halb, ['nur_verbuende' => true]) === false,
    'verbund_n unter 2 ist kein Verbund');
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, ['nur_verbuende' => false]) === true,
    'ohne den Filter bleibt alles');
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, []) === true, 'und ohne den Schluessel ebenso');
// 🔴 `keys` IST EIN NACHSCHLAG, KEIN FILTER -- er schlaegt auch diesen.
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, ['nur_verbuende' => true, 'keys' => ['e']]) === true,
    'der Stage-Nachschlag (`keys`) findet auch ein Objekt ohne Verbund');

// =================================================================================================
// B. 💣 DIE NAHT: der Browser schickt `nur_verbuende: 1` -- eine ZAHL. Ein Endpunkt, der wie bei
// `nur_mehrteilig` auf `=== true` prueft, verwirft sie still, und der Filter taete auf den
// Server-Reitern NICHTS (dieselbe Klasse wie `anzahl` bis zum 31.08.2026). Der Ausdruck des
// Endpunkts wird deshalb AUSGEFUEHRT, nicht gelesen.
// =================================================================================================

$roh = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php'));
$code = '';
foreach (token_get_all($roh) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $code .= is_array($token) ? $token[1] : $token;
}
$treffer = [];
assert(preg_match("~'nur_verbuende'\s*=>\s*(.+?),\n~", $code, $treffer) === 1,
    'der liste-Zweig des Endpunkts liest `nur_verbuende`');
// ⚠️ `eval` IST HIER GEWOLLT UND UNGEFAEHRLICH: ausgewertet wird ausschliesslich ein Ausdruck aus
// dem eigenen Repo-Quelltext (dem liste-Zweig des Endpunkts), nie eine Eingabe von aussen -- und nur
// so wird die Umwandlung WIRKLICH gefahren statt per Regex behauptet.
$lies = static function (array $payload) use ($treffer): mixed {
    return eval('return ' . $treffer[1] . ';');
};
assert($lies(['nur_verbuende' => 1]) === true, 'die 1 aus dem Browser wird zu `true`: ' . $treffer[1]);
assert($lies(['nur_verbuende' => true]) === true, 'ein `true` ebenso');
assert($lies([]) === false, 'ein fehlendes Feld heisst „kein Filter"');
assert($lies(['nur_verbuende' => 0]) === false, 'eine 0 ebenso');
assert($lies(['nur_verbuende' => 'ja']) === false, 'und ein beliebiger Text schaltet nichts ein');

// =================================================================================================
// C. 💣 BESTAND: ein Lauf von vor der Verbund-Erkennung. Sein after_json traegt weder verbund_stamm
// noch verbund_n (der Pruefstand von garetien-plan.php hat keine nummerierten Fragmente -- genau
// dieser Zustand). „nur Verbünde" ist dort leer, KEIN Fehler, und `verbund_objekte` sagt 0 --
// daraus baut der Browser den Satz „In diesem Lauf ist kein Verbund erkannt".
// =================================================================================================

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$alt = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($alt['verbund_objekte'] === 0, 'ein Lauf ohne Verbund-Felder zaehlt 0: ' . json_encode($alt['verbund_objekte']));
$altNur = avesmapsGaretienArbeitsliste($pdo, 1, ['nur_verbuende' => true]);
assert($altNur['objekte'] === [] && $altNur['gesamt'] === 0, 'und „nur Verbünde" ist dort leer, ohne Fehler');
assert($altNur['verbund_objekte'] === 0, 'die Zahl steht auch in der gefilterten Antwort');
assert($altNur['reiter']['offen'] === $alt['reiter']['offen'], 'die Reiterzahlen zaehlen den Lauf, nicht den Filter');

// Zwei Fragmente eines Verbunds dazu -- so, wie ein NEUER Planlauf sie schreibt.
$planRunId = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
foreach ([1, 2] as $nr) {
    avesmapsSyncPlanAddItem($pdo, $planRunId, [
        'entity_key' => 'ggp:Waelder:Wald:Garetien:Silker Hain ' . $nr . '!Silker Hain ' . $nr,
        'entity_public_id' => null,
        'change_type' => 'new',
        'label' => 'Silker Hain ' . $nr,
        'after' => ['typ' => 'Wald', 'wiki' => 'ggp', 'ebene' => 'Waelder', 'name' => 'Silker Hain ' . $nr,
                    'ziel' => 'region', 'verbund_stamm' => 'Silker Hain', 'verbund_n' => 2],
        'selected' => 0,
    ]);
}
$neu = avesmapsGaretienArbeitsliste($pdo, 1, ['nur_verbuende' => true]);
assert($neu['verbund_objekte'] === 2, 'zwei Fragmente zaehlen als zwei Verbund-Objekte: ' . json_encode($neu['verbund_objekte']));
assert(array_column($neu['objekte'], 'name') === ['Silker Hain 1', 'Silker Hain 2'],
    '„nur Verbünde" zeigt genau die Fragmente: ' . json_encode(array_column($neu['objekte'], 'name')));
assert(count(avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte']) === count($alt['objekte']) + 2,
    'ohne den Filter bleiben die alten Zeilen unveraendert daneben stehen');

echo "OK -- garetien-liste-nur-verbuende\n";
