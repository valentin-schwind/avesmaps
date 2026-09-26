<?php

declare(strict_types=1);

/**
 * DER EDITOR-ENDPUNKT `api/edit/map/settlement-places.php` -- Quelltextpruefung.
 *
 * ⚠️ Der Test faehrt den Endpunkt nicht (dafuer braeuchte er Sitzung und Datenbank), er liest die
 * Quelle -- wie `ecosystem-display-endpunkt-test.php` daneben. Geprueft wird per Tokenizer OHNE
 * Kommentare (AGENTS.md §9: ein Regex-Kommentarentferner frisst hinter einem Zeilenkommentar wie
 * `_internal/wiki/*-Libs` echten Code; der Tokenizer kann das nicht).
 *
 * Geprueft werden:
 *   A. `php -l` ist heil
 *   B. Faehigkeit `edit`, nur POST, OPTIONS -> 204
 *   C. Alle vier Aktionen sind verdrahtet (list, delete, move, orte)
 *   D. Kein `getMessage()` irgendwo im Endpunkt
 *   E. `avesmapsSettlementPlaceEnsureSchema(` steht vor dem Schreibaufruf `…Deactivate(`
 *   F. `list`, `delete` und `move` rufen alle drei denselben Listen-Trichter `avesmapsStaettenEndpunktListe(`
 *   G. Fehlercodes <-> HTTP-Status: 400 invalid_request/invalid_action, 404 not_found,
 *      422 invalid_target, 409 name_taken/name_taken_deleted, 500 server_error
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/staetten-endpunkt-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$wurzel = realpath(__DIR__ . '/../../../..');
assert(is_string($wurzel) && is_dir($wurzel . '/api'), 'die Repo-Wurzel ist gefunden');

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void {
    $pruefungen++;
};

/**
 * Kommentare per Tokenizer entfernen -- NIE per Regex (AGENTS.md §11, „Einen eigenen Knoten
 * nachtraeglich an einen Wiki-Artikel binden": ein Blockkommentar-Entferner frisst hinter einem
 * Zeilenkommentar wie `_internal/wiki/*-Libs` 380 Zeilen echten Code).
 */
function staettenEndpunktOhneKommentare(string $quelle): string
{
    $raus = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            // Zeilenzahl erhalten, damit eine Fehlermeldung die richtige Zeile nennt.
            $raus .= str_repeat("\n", substr_count($token[1], "\n"));
            continue;
        }
        $raus .= is_array($token) ? $token[1] : $token;
    }

    return str_replace("\r\n", "\n", $raus);
}

$datei = 'api/edit/map/settlement-places.php';
$pfad = $wurzel . '/' . $datei;
assert(is_file($pfad), "{$datei} existiert");

// ---- A. Syntaktisch heil ------------------------------------------------------------------
$ausgabe = [];
$code = 0;
exec('php -l ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
assert($code === 0, "{$datei} ist syntaktisch heil: " . implode(' ', $ausgabe));
$zaehl();

$rohquelle = (string) file_get_contents($pfad);
$quelle = staettenEndpunktOhneKommentare($rohquelle);

// ---- B. Faehigkeit, Methode, OPTIONS -------------------------------------------------------
assert(str_contains($quelle, "avesmapsRequireUserWithCapability('edit')"), 'lesen und schreiben braucht `edit`');
$zaehl();
assert(str_contains($quelle, "\$requestMethod === 'OPTIONS'") && str_contains($quelle, 'avesmapsJsonResponse(204)'),
    'OPTIONS antwortet mit 204');
$zaehl();
assert(str_contains($quelle, "\$requestMethod !== 'POST'") && str_contains($quelle, "'method_not_allowed'"),
    'jede andere Methode als POST wird abgelehnt');
$zaehl();

// ---- C. Alle vier Aktionen sind verdrahtet -------------------------------------------------
foreach (['list', 'delete', 'move', 'orte'] as $aktion) {
    assert(str_contains($quelle, "\$action === '{$aktion}'"), "die Aktion `{$aktion}` ist verdrahtet");
    $zaehl();
}
assert(str_contains($quelle, "'invalid_action'"), 'eine unbekannte Aktion bekommt einen eigenen Code');
$zaehl();

// ---- D. Kein getMessage() ------------------------------------------------------------------
// Geprueft wird am KOMMENTARFREIEN Quelltext -- ein erklaerender Kommentar darf das Wort nennen
// (wie im Endpunkt selbst, „NIE getMessage()"), nur der ausgefuehrte Code darf es nicht rufen.
assert(!str_contains($quelle, 'getMessage'), 'kein Ausnahmetext geht an den Client (AGENTS.md §10)');
$zaehl();
assert(str_contains($quelle, 'catch (Throwable') && str_contains($quelle, "'server_error'"),
    'der Auffang-catch antwortet mit einem festen Satz');
$zaehl();

// ---- E. Ensure steht vor dem Schreibaufruf -------------------------------------------------
$posEnsure = strpos($quelle, 'avesmapsSettlementPlaceEnsureSchema(');
$posDeactivate = strpos($quelle, 'avesmapsSettlementPlaceDeactivate(');
assert($posEnsure !== false && $posDeactivate !== false, 'beide Aufrufe stehen im Endpunkt');
$zaehl();
assert($posEnsure < $posDeactivate, 'avesmapsSettlementPlaceEnsureSchema steht VOR dem Loesch-Schreibaufruf');
$zaehl();
// avesmapsSettlementPlaceMove ruft die Ensure-Funktion selbst VOR seiner eigenen Transaktion
// (Bibliothek, api/_internal/app/settlement-places.php) -- kein zweiter Aufruf im Endpunkt noetig.
$bibliothek = (string) file_get_contents($wurzel . '/api/_internal/app/settlement-places.php');
$bibliothekOhneKommentare = staettenEndpunktOhneKommentare($bibliothek);
$posMoveFn = strpos($bibliothekOhneKommentare, 'function avesmapsSettlementPlaceMove(');
$posMoveEnsure = strpos($bibliothekOhneKommentare, 'avesmapsSettlementPlaceEnsureSchema($pdo);', (int) $posMoveFn);
$posMoveTransaktion = strpos($bibliothekOhneKommentare, 'beginTransaction()', (int) $posMoveFn);
assert($posMoveFn !== false && $posMoveEnsure !== false && $posMoveTransaktion !== false,
    'avesmapsSettlementPlaceMove, sein Ensure-Aufruf und seine Transaktion sind auffindbar');
$zaehl();
assert($posMoveEnsure < $posMoveTransaktion, 'Move ensured sein Schema selbst VOR der Transaktion (AGENTS.md §10)');
$zaehl();

// ---- F. list, delete und move rufen denselben Listen-Trichter ------------------------------
$posList = strpos($quelle, "\$action === 'list'");
$posDelete = strpos($quelle, "\$action === 'delete'");
$posMove = strpos($quelle, "\$action === 'move'");
$posOrte = strpos($quelle, "\$action === 'orte'");
assert($posList !== false && $posDelete !== false && $posMove !== false && $posOrte !== false,
    'alle vier Aktionsbloecke sind auffindbar');
$zaehl();
// Reihenfolge im Quelltext ist die Grundlage der Ausschnitte unten -- wenn sie sich je aendert,
// muss dieser Test das mitbekommen statt stillschweigend den falschen Ausschnitt zu pruefen.
assert($posList < $posDelete && $posDelete < $posMove && $posMove < $posOrte,
    'die Aktionsbloecke stehen in der erwarteten Reihenfolge list -> delete -> move -> orte');
$zaehl();

$blockListe = substr($quelle, (int) $posList, $posDelete - $posList);
$blockLoeschen = substr($quelle, (int) $posDelete, $posMove - $posDelete);
$blockUmhaengen = substr($quelle, (int) $posMove, $posOrte - $posMove);

foreach (['list' => $blockListe, 'delete' => $blockLoeschen, 'move' => $blockUmhaengen] as $name => $block) {
    assert(str_contains($block, 'avesmapsStaettenEndpunktListe('), "die Aktion `{$name}` ruft den Listen-Trichter");
    $zaehl();
}
// Die Trichterfunktion selbst existiert einmal (nicht abgeschrieben) und wird von Node der drei
// Aktionen mindestens einmal gerufen -- vier Vorkommen: die Definition plus drei Aufrufer.
assert(substr_count($quelle, 'avesmapsStaettenEndpunktListe') >= 4,
    'der Trichter wird definiert und von allen drei Antwortwegen gerufen, nicht abgeschrieben');
$zaehl();

// ---- G. Fehlercodes <-> HTTP-Status ---------------------------------------------------------
// `list` ohne Ort, `delete` ohne Kennung, `move` ohne Kennungen: je 400 invalid_request.
foreach ([$blockListe, $blockLoeschen, $blockUmhaengen] as $index => $block) {
    assert(substr_count($block, "avesmapsErrorResponse(400, 'invalid_request'") >= 1,
        'Pflichtfeld-Fehler in Block ' . $index . ' antworten mit 400 invalid_request');
    $zaehl();
}
// `delete`: nicht gefunden -> 404 not_found.
assert(str_contains($blockLoeschen, "avesmapsErrorResponse(404, 'not_found'"), 'delete: nicht gefunden -> 404 not_found');
$zaehl();
// `move`: die Statuszuordnung fuer alle Fehlercodes der Bibliothek. Seit 27.09.2026 (Innerorts-Punkte)
// steht die Tafel in EINER Funktion, die move, delete und put_on_map gemeinsam rufen -- vorher stand
// sie im move-Block; eine zweite Tafel fuer die Punkte haette denselben Code zweimal abgebildet.
$posAbsageFn = strpos($quelle, 'function avesmapsStaettenEndpunktAbsage(');
assert($posAbsageFn !== false, 'die Absage-Tafel steht als eigene Funktion im Endpunkt');
$zaehl();
$blockAbsage = substr($quelle, (int) $posAbsageFn, (int) strpos($quelle, "\n}\n", (int) $posAbsageFn) - (int) $posAbsageFn);
$statusZuordnung = [
    'not_found' => 404,
    'invalid_target' => 422,
    'name_taken' => 409,
    'name_taken_deleted' => 409,
    'invalid_state' => 409,
    'conflict' => 409,
];
foreach ($statusZuordnung as $errorCode => $status) {
    assert(preg_match("/'{$errorCode}'\\s*=>\\s*{$status}\\b/", $blockAbsage) === 1,
        "Absage: {$errorCode} wird auf HTTP {$status} abgebildet");
    $zaehl();
}
assert(str_contains($blockUmhaengen, 'avesmapsStaettenEndpunktAbsage('), 'move meldet seine Absage ueber die gemeinsame Tafel');
$zaehl();
// Unbekannte Aktion -> 400 invalid_action.
assert(str_contains($quelle, "avesmapsErrorResponse(400, 'invalid_action'"), 'unbekannte Aktion -> 400 invalid_action');
$zaehl();
// Server-Fehler -> 500 server_error, ohne Ausnahmetext.
assert(str_contains($quelle, "avesmapsErrorResponse(500, 'server_error'"), 'unerwarteter Fehler -> 500 server_error');
$zaehl();

// ---- H. Der Nutzer-Kennung-Zugriff ist der vorgeschriebene ----------------------------------
assert(str_contains($quelle, "(int) (\$user['id'] ?? 0)"), "Nutzer-Kennung als (int) (\$user['id'] ?? 0)");
$zaehl();

// ---- I. Kein Protokolleintrag (Owner-Entscheid 4, Entwurf §4) -------------------------------
assert(!str_contains($quelle, 'avesmapsWriteMapAuditLog'), 'kein Protokolleintrag -- bewusst, nicht vergessen');
$zaehl();

// ---- J. Innerorts-Punkte (Entwurf 2026-09-26-innerorts-praedikat-design.md §6.3) ------------
foreach (['put_on_map', 'innerorts_wiki_stand', 'innerorts_aus_wiki'] as $aktion) {
    assert(str_contains($quelle, "\$action === '{$aktion}'"), "die Aktion `{$aktion}` ist verdrahtet");
    $zaehl();
}
$posPutOn = strpos($quelle, "\$action === 'put_on_map'");
$posWikiStand = strpos($quelle, "\$action === 'innerorts_wiki_stand'");
$posAusWiki = strpos($quelle, "\$action === 'innerorts_aus_wiki'");
$posUnbekannt = strpos($quelle, "avesmapsErrorResponse(400, 'invalid_action'");
assert($posOrte < $posPutOn && $posPutOn < $posWikiStand && $posWikiStand < $posAusWiki && $posAusWiki < $posUnbekannt,
    'die drei neuen Aktionsbloecke stehen nach `orte` und vor der Absage fuer unbekannte Aktionen');
$zaehl();
$blockPutOn = substr($quelle, (int) $posPutOn, $posWikiStand - $posPutOn);
$blockAusWiki = substr($quelle, (int) $posAusWiki, $posUnbekannt - $posAusWiki);

// Die Liste fuehrt die Punkte der Stadt -- im Trichter, damit alle Antwortwege sie tragen.
$posListeFn = strpos($quelle, 'function avesmapsStaettenEndpunktListe(');
$blockListeFn = substr($quelle, (int) $posListeFn, (int) strpos($quelle, "\n}\n", (int) $posListeFn) - (int) $posListeFn);
assert(str_contains($blockListeFn, 'avesmapsInnerortsPunkteEinerStadt($pdo, $ortId)'), 'der Listen-Trichter haengt die Punkte der Stadt an');
$zaehl();

// delete und move unterscheiden Staette und Punkt an der Kennung -- Staette zuerst.
foreach (['delete' => $blockLoeschen, 'move' => $blockUmhaengen] as $name => $block) {
    assert(str_contains($block, '!avesmapsSettlementPlaceExists($pdo, $publicId) && avesmapsInnerortsIstPunkt($pdo, $publicId)'),
        "`{$name}` nimmt den Punktweg nur, wenn die Kennung KEINE gespeicherte Staette ist");
    $zaehl();
    assert(str_contains($block, 'avesmapsStaettenEndpunktPunktSperre($pdo, $payload, $publicId, $user)'),
        "`{$name}` prueft beim Punkt die Bearbeitungssperre");
    $zaehl();
}
assert(str_contains($blockLoeschen, 'avesmapsInnerortsEndgueltigEntfernen($pdo, $publicId, $userId)'), 'delete eines Punkts nimmt nur den Merker (endgueltig)');
$zaehl();
assert(str_contains($blockUmhaengen, 'avesmapsInnerortsOrtSpeichern($pdo, $publicId, $zielId, $userId)'), 'move eines Punkts setzt innerorts.ort (manual)');
$zaehl();
assert(str_contains($blockPutOn, 'avesmapsInnerortsAufDieKarteSetzen($pdo, $publicId, $userId)')
    && str_contains($blockPutOn, 'avesmapsStaettenEndpunktPunktSperre(')
    && str_contains($blockPutOn, 'avesmapsStaettenEndpunktListe('),
    'put_on_map: Sperre, derselbe Bibliotheksweg wie die Kartenaktion, Liste zurueck');
$zaehl();

// Der Admin-Lauf: Faehigkeit `admin`, Trockenlauf als Vorgabe (scharf NUR bei `apply === true`).
assert(str_contains($blockAusWiki, "avesmapsUserCan(\$user, 'admin')") && str_contains($blockAusWiki, "avesmapsErrorResponse(403, 'forbidden'"),
    'innerorts_aus_wiki ist Admins vorbehalten');
$zaehl();
assert(str_contains($blockAusWiki, "(\$payload['apply'] ?? false) === true"), 'innerorts_aus_wiki: Trockenlauf ist die Vorgabe');
$zaehl();
assert(str_contains($blockAusWiki, 'avesmapsInnerortsAusWikiLauf($pdo, $scharf, $limit, $userId)'), 'innerorts_aus_wiki ruft den Bibliothekslauf');
$zaehl();

echo "staetten-endpunkt: alle {$pruefungen} Zusicherungen gruen\n";
