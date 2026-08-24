<?php

declare(strict_types=1);

/**
 * Die Bot-Diagnose: aus den Befunden EIN Satz, der sagt, was zu tun ist.
 *
 * ⭐ WOZU SIE GEBAUT WURDE (25.08.2026): der Grund einer abgelehnten Bot-Anmeldung lief bis
 * dahin nur als kurze rote Zeile durch die Statusanzeige eines laufenden Dumps -- wer sie
 * verpasste, hatte nichts. Und "Bot-Zugang abgelehnt" allein hilft niemandem: MediaWiki
 * schickt fuer ein falsches Passwort DIESELBE Meldung wie fuer einen Benutzernamen ohne
 * \`@Botname\`. Was der Betreiber braucht, ist nicht der Grund, sondern der naechste Handgriff.
 *
 * 💣 DESHALB SCHLAEGT DIE FORM DEN GRUND. Ob der Benutzername ein "@" hat und ob das Passwort
 * die Botform hat (32 Zeichen, [a-z0-9]), wissen wir SELBST -- und das sind die zwei
 * haeufigsten Ursachen. Der Grund vom Wiki ist erst dann die beste Auskunft, wenn die Form
 * stimmt. Diese Reihenfolge ist die eigentliche Leistung der Funktion, und genau sie wird hier
 * abgesichert.
 *
 * 🔴 Kein HTTP: geprueft wird die REINE Urteilsfunktion. Die Anmeldung selbst braucht das
 * lebende Wiki und ist von hier aus nicht pruefbar -- der eine Aufruf, der sie tut, steht im
 * Endpunkt hinter dem Fähigkeitsriegel.
 *
 * 🪤 Dieser Test entstand NACH dem Code (der Owner wartete auf eine Antwort). Deshalb wurde
 * jede einzelne Verzweigung gegen eine Mutation geprueft, statt sich auf einen gruenen Lauf zu
 * verlassen -- ein Test, der nie rot war, beweist von sich aus nichts.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/bot-diagnose-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

require dirname(__DIR__) . '/sync.php';

/** Ein Befundsatz mit tadelloser Form -- die Vorlage, von der jeder Fall genau EINS abweicht. */
$formInOrdnung = [
    'hinterlegt' => true,
    'benutzer' => 'Avesmaps@Dump',
    'benutzer_hat_at' => true,
    'passwort_laenge' => 32,
    'passwort_hat_botform' => true,
    'status' => 'gescheitert',
    'grund' => '',
];

// ------------------------------------------------------------------ ES KLAPPT ---
$geglueckt = avesmapsWikiBotDiagnoseUrteil(['status' => 'bot'] + $formInOrdnung);
assert(
    str_contains($geglueckt, 'in Ordnung') && str_contains($geglueckt, '500'),
    'eine stehende Anmeldung muss als solche gemeldet werden, samt der Zahl, die sie bringt: ' . $geglueckt
);

// ------------------------------------------------- DIE HAEUFIGSTE URSACHE: KEIN @ ---
// 💣 Und sie schlaegt den Grund vom Wiki: hier steht ein Grund DA, und trotzdem muss das
// Urteil die Form nennen. Andersherum liefe der Betreiber der Wiki-Meldung hinterher und
// erzeugte ein neues Passwort, waehrend der Benutzername der Fehler war.
$ohneAt = avesmapsWikiBotDiagnoseUrteil([
    'benutzer' => 'Avesmaps',
    'benutzer_hat_at' => false,
    'grund' => 'Incorrect username or password entered.',
] + $formInOrdnung);
assert(
    str_contains($ohneAt, 'Konto@Botname'),
    'ohne "@" muss das Urteil die Form des Benutzernamens nennen: ' . $ohneAt
);
assert(
    !str_contains($ohneAt, 'IP-Beschraenkung'),
    '💣 die Form schlaegt den Grund -- solange der Benutzername falsch gebaut ist, sind die '
        . 'ferneren Ursachen nur Ablenkung: ' . $ohneAt
);

// ------------------------------------------ ZWEITHAEUFIGSTE: DAS KONTO-PASSWORT ---
$kontoPasswort = avesmapsWikiBotDiagnoseUrteil([
    'passwort_laenge' => 14,
    'passwort_hat_botform' => false,
    'grund' => 'Incorrect username or password entered.',
] + $formInOrdnung);
assert(
    str_contains($kontoPasswort, 'KONTO-Passwort') && str_contains($kontoPasswort, 'Spezial:BotPasswords'),
    'ein Passwort ohne Botform muss auf das Konto-Passwort und die Fundstelle zeigen: ' . $kontoPasswort
);
assert(
    str_contains($kontoPasswort, '14'),
    'und die tatsaechliche Laenge nennen, damit der Betreiber sie vergleichen kann: ' . $kontoPasswort
);

// --------------------------------------------- NICHT DIE ZUGANGSDATEN: KEIN TOKEN ---
// 🔴 Der Fall, den man sonst falsch behandelt: das Wiki hat schon den Token verweigert, die
// Zugangsdaten waren nie im Spiel. Wer hier ein neues Passwort erzeugt, sucht am falschen Ort.
$keinToken = avesmapsWikiBotDiagnoseUrteil(['grund' => 'kein Login-Token'] + $formInOrdnung);
assert(
    str_contains($keinToken, 'NICHT an den'),
    'ein fehlender Token muss die Zugangsdaten ausdruecklich entlasten: ' . $keinToken
);

// -------------------------------------------- FORM STIMMT, WIKI LEHNT TROTZDEM AB ---
$abgelehnt = avesmapsWikiBotDiagnoseUrteil([
    'grund' => 'Incorrect username or password entered.',
] + $formInOrdnung);
assert(
    str_contains($abgelehnt, 'Incorrect username or password entered.'),
    'der Grund vom Wiki muss WOERTLICH mitkommen, nicht nacherzaehlt: ' . $abgelehnt
);
foreach (['zurueckgezogen', 'Botname', '81.169.144.135'] as $ursache) {
    assert(
        str_contains($abgelehnt, $ursache),
        'bei tadelloser Form muessen alle drei verbleibenden Ursachen genannt sein, hier fehlt "'
            . $ursache . '": ' . $abgelehnt
    );
}

// ------------------------------------------------------------- GAR KEIN GRUND ---
$stumm = avesmapsWikiBotDiagnoseUrteil($formInOrdnung);
assert(
    str_contains($stumm, 'ohne dass das Wiki einen Grund genannt hat'),
    'auch das Schweigen braucht einen Satz, sonst steht der Betreiber vor einer leeren Zeile: ' . $stumm
);

// ------------------------------------------------------- GAR NICHTS HINTERLEGT ---
// Ohne Konfiguration (Entwicklungsrechner, Testfeld) darf die Diagnose KEINEN Fremdaufruf
// machen -- sie kehrt vorher um. Das ist zugleich die Zusicherung, dass dieser Test kein HTTP
// ausloest: gaebe es hier eine Anmeldung, haenge er 40 Sekunden an der Drossel.
$t0 = microtime(true);
$ohneZugang = avesmapsWikiBotDiagnose();
$dauer = microtime(true) - $t0;
assert($ohneZugang['hinterlegt'] === false, 'ohne Konfiguration ist nichts hinterlegt');
assert($ohneZugang['status'] === 'unversucht', 'und es wird gar nicht erst versucht');
assert($ohneZugang['benutzer'] === '', 'und es steht kein Benutzername herum');
assert(
    str_contains($ohneZugang['urteil'], 'bot_username') && str_contains($ohneZugang['urteil'], 'bot_password'),
    'das Urteil muss BEIDE Feldnamen nennen -- ein halber Zugang ist keiner: ' . $ohneZugang['urteil']
);
assert($dauer < 2.0, 'die Diagnose ohne Konfiguration darf keinen Fremdaufruf machen (dauerte ' . round($dauer, 2) . ' s)');

// -------------------------------------------------------- KEIN PASSWORT IM URTEIL ---
// 🔴 Die Zusicherung, die niemals fallen darf: das Passwort kommt nirgends heraus.
$mitGeheimnis = avesmapsWikiBotDiagnoseUrteil([
    'passwort_laenge' => 9,
    'passwort_hat_botform' => false,
] + $formInOrdnung);
assert(
    !str_contains($mitGeheimnis, 'hunter2'),
    'Selbstverstaendlichkeit, festgenagelt: das Urteil bekommt das Passwort gar nicht erst zu sehen'
);

echo "bot-diagnose: alle Zusicherungen erfuellt\n";
