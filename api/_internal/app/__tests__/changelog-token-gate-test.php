<?php

declare(strict_types=1);

/**
 * Unit test fuer den Token-Zugang zum Aenderungsverlauf (Schreibpfad api/edit/map/changelog.php).
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/changelog-token-gate-test.php
 *
 * Der Endpunkt selbst laesst sich nicht requiren -- sein try-Block laeuft beim Laden los und
 * beantwortet eine Anfrage, die es hier nicht gibt. Geprueft wird deshalb zweigleisig: die REGEL
 * als echte Konstante und echte Funktion, die VERDRAHTUNG am Quelltext.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../changelog.php';
require __DIR__ . '/../../discord/app-auth.php';

// ---- Die Regel: das Token darf WENIGER als ein Mensch -----------------------------------------
// 💣 Der eine Fehler, der hier wehtut, ist ein grosszuegiges `delete`. Ein abhandengekommenes Token
// koennte dann den ganzen Verlauf ausraeumen -- und zwar leise, denn der Lesepfad faellt bei leerer
// Tabelle stumm auf die Saat zurueck. Es saehe aus, als waere nie etwas angehaengt worden.
assert(AVESMAPS_CHANGELOG_TOKEN_ACTIONS === ['list', 'save'], 'Token darf genau lesen und ergaenzen');
assert(!in_array('delete', AVESMAPS_CHANGELOG_TOKEN_ACTIONS, true), 'Loeschen bleibt am Menschen');

// Und dieselbe Regel als echter Aufruf, nicht nur als Liste: das ist die Funktion, die der Endpunkt
// benutzt, also wird hier genau das gepruefte Verhalten gepruft.
assert(avesmapsChangelogTokenMayRun('list') === true, 'lesen: ja');
assert(avesmapsChangelogTokenMayRun('save') === true, 'ergaenzen: ja');
assert(avesmapsChangelogTokenMayRun('delete') === false, 'loeschen: nein');
assert(avesmapsChangelogTokenMayRun('') === false, 'keine Aktion ist keine Erlaubnis');
assert(avesmapsChangelogTokenMayRun('Delete') === false, 'strikt verglichen, keine Grossschreibungs-Luecke');
assert(avesmapsChangelogTokenMayRun('save ') === false, 'kein Durchrutschen ueber Leerzeichen');

// ---- Die Tokenpruefung faellt ZU, wo etwas fehlt ------------------------------------------------
// Beide Richtungen zaehlen: ein nicht konfiguriertes Token darf nicht dadurch passen, dass der
// Anrufer ebenfalls nichts schickt -- sonst stuende der Endpunkt auf jeder Installation offen, die
// den Discord-Teil der Konfiguration nicht ausgefuellt hat.
assert(avesmapsDiscordCheckAppToken('', '') === false, 'nichts gegen nichts ist kein Ausweis');
assert(avesmapsDiscordCheckAppToken('geheim', '') === false, 'ohne mitgeschicktes Token: zu');
assert(avesmapsDiscordCheckAppToken('', 'geheim') === false, 'ohne konfiguriertes Token: zu');
assert(avesmapsDiscordCheckAppToken('geheim', 'falsch') === false, 'falsches Token: zu');
assert(avesmapsDiscordCheckAppToken('geheim', 'geheim') === true, 'richtiges Token: auf');

// ---- Die Verdrahtung im Endpunkt ----------------------------------------------------------------
$endpoint = (string) file_get_contents(__DIR__ . '/../../../edit/map/changelog.php');
assert($endpoint !== '', 'Schreibpfad gefunden');

// Der Session-Weg darf nicht verschwinden. Wer ihn beim Einbauen des Tokens herausnimmt, macht aus
// "zwei Ausweise" einen einzigen -- und der Editor im Browser kaeme nicht mehr herein.
assert(
    str_contains($endpoint, "avesmapsRequireUserWithCapability('edit')"),
    'die Session bleibt der zweite Weg herein'
);

// 💣 Das Token wird NUR aus dem Header gelesen. report-post.php nimmt daneben `?token=` an; das
// steht danach in jedem Server-Log und in jedem Verlauf. Hier nicht.
assert(str_contains($endpoint, 'HTTP_X_AVESMAPS_TOKEN'), 'Token kommt aus dem Header');
assert(!str_contains($endpoint, '_GET'), 'Token niemals aus der Adresszeile');

// Und die Reihenfolge: erst der Ausweis, dann die Aktion. Stuende die Pruefung hinter dem `switch`,
// haette die Routine ihre `delete`-Anfrage laengst ausgefuehrt, bevor jemand sie ablehnt.
// ⚠️ Gesucht wird der AUSDRUCK, nicht der blosse Name der Konstante -- der steht weiter oben schon
// im Kopfkommentar, und danach misst man die Reihenfolge einer Erklaerung statt die des Codes.
// 💣 WORTGENAU, samt `$isRoutine &&`. Ein Test, der nur nachsieht, ob der Funktionsname irgendwo
// vorkommt, laesst die schlimmste Mutation durch: den Riegel stehenlassen und totlegen
// (`if (false && ...)`). Der Text steht dann noch da, die Reihenfolge stimmt noch, und die Routine
// duerfte loeschen. Gemessen -- genau diese Mutation blieb gruen, bis hier der ganze Ausdruck stand.
$guardExpression = 'if ($isRoutine && !avesmapsChangelogTokenMayRun($action))';
assert(str_contains($endpoint, $guardExpression), 'der Riegel steht da und ist lebendig');

$gate = strpos($endpoint, 'avesmapsChangelogHasRoutineToken($config)');
$guard = strpos($endpoint, $guardExpression);
$switch = strpos($endpoint, 'switch ($action)');
assert($gate !== false && $guard !== false && $switch !== false, 'Riegel und switch vorhanden');
assert($gate < $guard, 'erst das Token pruefen, dann die Aktion');
assert($guard < $switch, 'die Aktion pruefen, BEVOR sie ausgefuehrt wird');

echo "changelog token gate ok\n";
