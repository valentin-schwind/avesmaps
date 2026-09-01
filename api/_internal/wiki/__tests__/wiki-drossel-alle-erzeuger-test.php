<?php

declare(strict_types=1);

/**
 * DIE DROSSEL GILT JEDEM AUSGEHENDEN ABRUF ANS WIKI -- nicht nur der MediaWiki-API.
 *
 * 💣 WORUM ES GEHT. Die Wiki-robots.txt gibt uns seit 24.08.2026 einen eigenen Abschnitt:
 * `User-agent: AvesmapsWikiSync`, `Crawl-delay: 20`, und -- seit jeher, fuer JEDEN Agenten --
 * `Disallow: /wiki/Spezial:`. Gebunden war am 25.08.2026 aber nur `sync.php` (die API). Die
 * DATEI-Abrufe liefen daran vorbei:
 *
 *   * `avesmapsWikiSyncMonitorHttpGetBinary` -- vier Aufrufer (Territoriumswappen, Upload,
 *     "Hole Wiki-Wappen", Literatur-Cover), kein Drossel-Aufruf;
 *   * `avesmapsCoatFetch` (api/app/coat.php) -- der oeffentliche Wappen-Proxy, kein Drossel-Aufruf;
 *   * `avesmapsLinkCheckRequest` -- prueft auch Wiki-Adressen, mit 600 ms statt 20 s;
 *   * `avesmapsWikiDumpFetch` -- derselbe Wirt (`offline.` und `de.` zeigen auf dieselbe IP).
 *
 * Und genau diese Abrufe zielen auf `Spezial:Dateipfad/<Datei>` -- die eine Seite, die uns die
 * robots.txt verbietet und die uns am 20. und 23.08.2026 zweimal die Sperre unserer
 * Ausgangs-IP eingebracht hat. Der harte Riegel (`datei-riegel.php`) haelt sie heute zurueck;
 * er ist aber ein NOTAUS, keine Drossel: am Tag, an dem er fuer die fehlenden Wappen aufgeht,
 * feuern sie wieder ohne Abstand.
 *
 * 🔴 DIESER TEST ZAEHLT DIE ERZEUGER NICHT, ER SUCHT SIE. Zweimal war in diesem Projekt eine
 * ZAHL im Kommentar die eigentliche Falle ("ERZEUGER 1 VON 2" bei den Querfeldein-Kanten,
 * "an genau EINER Stelle" im datei-riegel): eine Zahl liest sich wie eine vollstaendige Liste,
 * also sucht niemand weiter. Abschnitt 1 findet die ausgehenden Aufrufe mechanisch und verlangt
 * fuer jeden ENTWEDER einen Drossel-Aufruf ODER einen Eintrag im Ausnahmeregister MIT Begruendung.
 * Ein neuer, ungebundener Erzeuger macht ihn rot, ohne dass jemand diese Datei anfassen muss.
 *
 * Kein HTTP, keine Datenbank. Abschnitt 2 stellt den Abstand per Testparameter auf
 * Millisekunden -- ein Test, der 20 Sekunden kostet, wird als erstes wieder herausgenommen.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/wiki-drossel-alle-erzeuger-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4); // __tests__ -> wiki -> _internal -> api -> <Repo>

/** Alle .php unterhalb von api/ einsammeln. */
$alleApiDateien = static function (string $wurzel): array {
    $treffer = [];
    $lauf = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($wurzel . '/api', FilesystemIterator::SKIP_DOTS)
    );
    foreach ($lauf as $eintrag) {
        /** @var SplFileInfo $eintrag */
        if ($eintrag->isFile() && strtolower($eintrag->getExtension()) === 'php') {
            $pfad = str_replace('\\', '/', $eintrag->getPathname());
            if (!str_contains($pfad, '/__tests__/')) {
                $treffer[] = $pfad;
            }
        }
    }
    sort($treffer);
    return $treffer;
};

/** Der Rumpf einer Funktion, per Klammerzaehlung ab ihrer Signatur. */
$funktionsRumpf = static function (string $quelle, string $name): string {
    $start = strpos($quelle, 'function ' . $name);
    if ($start === false) {
        return '';
    }
    $auf = strpos($quelle, '{', $start);
    if ($auf === false) {
        return '';
    }
    $tiefe = 0;
    $laenge = strlen($quelle);
    for ($i = $auf; $i < $laenge; $i++) {
        if ($quelle[$i] === '{') {
            $tiefe++;
        } elseif ($quelle[$i] === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                return substr($quelle, $auf, $i - $auf + 1);
            }
        }
    }
    return '';
};

// ---------------------------------------------------------------------------
// ABSCHNITT 1 -- das Erzeuger-Inventar. Gefunden, nicht gezaehlt.
// ---------------------------------------------------------------------------

// 🪤 DIE ERSTE FASSUNG SUCHTE "Datei nennt den Wirt UND macht eine Anfrage" -- und uebersah
// damit ausgerechnet den Linkchecker: der prueft BELIEBIGE Adressen, darunter Wiki-Adressen,
// und nennt den Wirt naturgemaess nirgends. Ein generischer Abrufer erreicht das Wiki, ohne es
// je zu erwaehnen. Gesucht wird deshalb JEDE ausgehende HTTP-Anfrage unter api/; wer das Wiki
// nicht erreichen kann, sagt das im Register mit Begruendung.
$machtAnfrage = static function (string $q): bool {
    return str_contains($q, 'curl_exec(')
        || preg_match('/@?file_get_contents\(\s*(\$url|\$adresse|AVESMAPS_WIKI_API_URL|\$sourceUrl)/', $q) === 1;
};

$gefundeneDateien = [];
foreach ($alleApiDateien($wurzel) as $pfad) {
    if ($machtAnfrage((string) file_get_contents($pfad))) {
        $gefundeneDateien[] = substr($pfad, strlen(str_replace('\\', '/', $wurzel)) + 1);
    }
}

// 🔴 DAS REGISTER, auf DATEI-Ebene. Nicht auf Funktions-Ebene: `api/discord/register-commands.php`
// setzt sein `curl_exec` auf oberster Ebene ab, in gar keiner Funktion -- eine Funktionsliste
// haette es nie erfassen koennen.
//
// Gebunden = jede hier genannte Funktion muss die Drossel fragen.
$gebunden = [
    // Die MediaWiki-API. Beide Wege -- die POST-Anmeldung und der GET -- waren von Anfang an
    // gebunden; sie sind die Vorlage, an der sich die anderen ausrichten.
    'api/_internal/wiki/sync.php' => ['avesmapsWikiSyncApiPost', 'avesmapsWikiSyncApiRequest'],

    // Der Bildholer mit VIER Aufrufern (Territoriumswappen, Upload, "Hole Wiki-Wappen",
    // Literatur-Cover). Hier zu fragen bindet alle vier auf einmal.
    'api/_internal/wiki/sync-monitor-identity.php' => ['avesmapsWikiSyncMonitorHttpGetBinary'],

    // Der oeffentliche Proxy. Er WARTET NICHT (Abschnitt 2) -- ein Seitenaufbau, der 20 s einen
    // PHP-Arbeiter haelt, ist auf STRATO schlimmer als das Uebel (AGENTS.md §10).
    'api/app/coat.php' => ['avesmapsCoatFetch'],

    // EIN Abruf je Lauf, aber derselbe Wirt: 'offline.' und 'de.' zeigen auf dieselbe IP.
    'api/_internal/wiki/dump-fetch.php' => ['avesmapsWikiDumpFetch'],

    // 🪤 ZWEI Abrufer, und der zweite ist der ueberraschende: `avesmapsLinkCheckFetchBody` ist
    // der SSRF-geschuetzte Holer, den der Wappen-Upload per Bild-URL benutzt -- er laedt also
    // sehr wohl Wiki-Bilder. Wer nur den offensichtlichen `…Request` bindet, bindet die Haelfte.
    'api/_internal/linkcheck/probe.php' => ['avesmapsLinkCheckRequest', 'avesmapsLinkCheckFetchBody'],
];

// Ausnahme = erreicht das Wiki nicht. ⚠️ Der Grund gehoert INS REGISTER, nicht in einen
// Kommentar daneben: die Zusicherung liest ihn und faellt bei einem leeren Grund. Wer einen
// neuen Abrufer eintraegt, muss begruenden, warum er keine Drossel braucht.
$ausnahmen = [
    'api/_internal/social/adapters/facebook.php' => 'Facebook Graph API -- fester Wirt graph.facebook.com.',
    'api/_internal/social/adapters/instagram.php' => 'Instagram ueber dieselbe Graph API -- fester Wirt.',
    'api/_internal/social/adapters/mastodon.php' => 'Mastodon-Instanz aus social.mastodon.base_url; die eine Bildabholung darin liest UNSERE eigene Adresse.',
    'api/_internal/social/connect.php' => 'Token-Tausch bei der Graph API -- fester Wirt.',
    'api/_internal/social/media.php' => 'prueft UNSERE eigene Bildadresse (avesmapsSocialAbsoluteUrl), bevor ein Beitrag rausgeht.',
    'api/_internal/discord/post-message.php' => 'Discord-Bot-API -- fester Wirt discord.com.',
    'api/discord/register-commands.php' => 'meldet die Slash-Befehle bei Discord an -- fester Wirt.',
    'api/_internal/social/relay.php' => 'Der Anstoss des Mastodon-Relais (Fall #113, 01.09.2026): EIN POST an GitHubs Workflow-Dispatch, fester Wirt api.github.com, Adresse aus zwei Konstanten und nie aus dem Anfragerumpf. Erreicht das Wiki Aventurica nicht. Er darf zudem nicht warten -- er laeuft im Veroeffentlichen-Klick des Editors, und eine Warteschlange dort haelt einen PHP-Arbeiter (AGENTS.md §10).',
    'api/_internal/diagnostics/ausgang-sonde.php' => 'Die Ausgangs-Diagnose (Vorfall 30.08.2026). Drei feste Ziele aus avesmapsAusgangZiele(), nie eine Adresse aus dem Anfragerumpf, und keines davon ist das Wiki. Sie laeuft nur auf einen Aufruf mit der Faehigkeit admin, also nie im Seitenaufbau eines Besuchers -- eine Warteschlange haette hier niemanden, mit dem sie sich abstimmen muesste.',
    'api/_internal/import/garetien-abruf.php' => 'Exportseiten von garetien.de und koschwiki.de -- zwei feste Wirte aus AVESMAPS_GARETIEN_EBENEN, nie eine Adresse aus dem Anfragerumpf. Erreicht das Wiki Aventurica nicht und teilt dessen Warteschlange bewusst NICHT; die Hoeflichkeitspause gegenueber Volkers Servern steht als eigene Regel IM Abrufer (AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN), damit sie kein Aufrufer ueberspringen kann.',
];

$registrierte = array_merge(array_keys($gebunden), array_keys($ausnahmen));

// 1a) Kein Abrufer ohne Registereintrag -- das ist die Zusicherung, die den NAECHSTEN faengt.
$ohneEintrag = array_values(array_diff($gefundeneDateien, $registrierte));
assert(
    $ohneEintrag === [],
    "1a: ausgehende HTTP-Anfrage ohne Registereintrag: " . implode(', ', $ohneEintrag)
        . " -- entweder die Drossel einbauen oder mit Begruendung als Ausnahme eintragen."
);

// 1b) Kein Registereintrag ohne Abrufer -- sonst verwaltet das Register Gespenster.
$ohneAbrufer = array_values(array_diff($registrierte, $gefundeneDateien));
assert(
    $ohneAbrufer === [],
    "1b: Registereintrag ohne gefundenen Abrufer: " . implode(', ', $ohneAbrufer)
);

// 1c) Jede Ausnahme traegt einen Grund.
foreach ($ausnahmen as $datei => $grund) {
    assert(trim($grund) !== '', "1c: Ausnahme fuer {$datei} ohne Begruendung.");
}

// 1d) Jeder gebundene Abrufer fragt die Drossel IM RUMPF der genannten Funktion.
foreach ($gebunden as $datei => $funktionen) {
    $quelle = (string) file_get_contents($wurzel . '/' . $datei);
    foreach ($funktionen as $funktion) {
        $rumpf = $funktionsRumpf($quelle, $funktion);
        assert($rumpf !== '', "1d: Funktion {$funktion} in {$datei} nicht gefunden -- umbenannt?");
        assert(
            str_contains($rumpf, 'avesmapsWikiSyncThrottleWikiRequest(')
                || str_contains($rumpf, 'avesmapsWikiDrosselPlatzFrei('),
            "1d: {$funktion} in {$datei} setzt eine Anfrage ab, ohne die Drossel zu fragen."
        );
    }
}

// 1e) Die zwei SAMMELLAEUFE gehen durch dieselbe gebundene Tuer. Sie sind die Stellen, die im
// Ernstfall Hunderte Bilder hintereinander holen -- und sie machen das nur dann gedrosselt,
// wenn sie `avesmapsWikiSyncMonitorHttpGetBinary` benutzen statt sich einen eigenen Kanal zu
// oeffnen. Geprueft wird deshalb, dass in ihren Rumpfen KEIN eigener Abruf steht.
//
// 🪤 Hier stand zuerst "die Sammellaeufe duerfen kein `usleep` mehr enthalten" -- eine
// Zusicherung, die von Anfang an gruen war, weil beide `avesmapsWikiSyncMonitorSleep()` rufen
// und nie `usleep` selbst. Sie prueft dann nichts und sieht trotzdem nach Sorgfalt aus.
// ⚠️ Ihre kleinen Pausen (150 bzw. 250 ms) bleiben absichtlich stehen: sie bremsen den Lauf
// gegen die EIGENE Platte und Datenbank, nicht gegen das Wiki. Fuer das Wiki gilt die Drossel
// eine Ebene tiefer, und 150 ms zusaetzlich zu 20 s sind kein zweiter Massstab.
foreach (
    [
        'api/_internal/wiki/settlements-coat-localize.php' => 'avesmapsWikiSettlementLocalizeCoats',
        'api/_internal/wiki/sync-monitor-identity.php' => 'avesmapsWikiSyncMonitorLocalizeCoats',
    ] as $datei => $funktion
) {
    // 🪤 SEIT 01.09.2026 AUF `…Ausfuehren`, UND DAS IST TRAGEND. `$funktion` ist seither nur noch die
    // Huelle, die den Riegel oeffnet (avesmapsWikiAusdruecklicherAbruf); ihr Rumpf ist drei Zeilen
    // lang. Diese Zusicherung ist eine NEGATIVE ("enthaelt keinen eigenen Abruf-Kanal") -- an der
    // Huelle gemessen ist sie trivial wahr, bleibt gruen und prueft nichts mehr. Sie waere beim
    // Umbau also NICHT umgefallen, sondern lautlos bedeutungslos geworden; aufgefallen ist es nur,
    // weil der Nachbartest daneben (wiki-datei-adresse-test.php) eine POSITIVE Zusicherung stellt
    // und deshalb rot wurde. ⚠️ Wer eine negative Zusicherung auf einen Funktionsrumpf stellt,
    // prueft mit, dass der Rumpf ueberhaupt noch der gemeinte ist.
    $rumpf = $funktionsRumpf((string) file_get_contents($wurzel . '/' . $datei), $funktion . 'Ausfuehren');
    assert($rumpf !== '', "1e: {$funktion}Ausfuehren nicht gefunden.");
    assert(
        strlen($rumpf) > 400,
        "1e: der Rumpf von {$funktion}Ausfuehren ist verdaechtig kurz -- misst diese Zusicherung noch "
            . "den Lauf, oder inzwischen wieder nur eine Huelle?"
    );
    assert(
        !str_contains($rumpf, 'curl_init(') && !str_contains($rumpf, 'file_get_contents('),
        "1e: {$funktion} oeffnet einen eigenen Abruf-Kanal und laeuft damit an der Drossel vorbei."
    );
}

// ---------------------------------------------------------------------------
// ABSCHNITT 2 -- der Zweig, der NICHT wartet.
// ---------------------------------------------------------------------------

require_once $wurzel . '/api/_internal/wiki/drossel.php';

$abstand = 400000; // 0,4 s Grundabstand; der Jitter im Code kann ihn nur vergroessern.
$vermerk = tempnam(sys_get_temp_dir(), 'avm_drossel_alle_') ?: '';
assert($vermerk !== '', '2: keine temporaere Datei anlegbar.');
@unlink($vermerk); // tempnam legt LEER an -- das ist "es gab noch nie eine Anfrage".

// 2a) Ein freier Platz wird genommen und mit true gemeldet.
assert(
    avesmapsWikiDrosselPlatzFrei($abstand, $vermerk) === true,
    '2a: der erste Abruf haette den freien Platz nehmen muessen.'
);

// 2b) Unmittelbar danach ist der Platz belegt -- und der Aufruf SCHLAEFT NICHT. Das ist die
// ganze Daseinsberechtigung dieses Zweigs: coat.php beantwortet einen Seitenaufbau und darf
// keinen PHP-Arbeiter 20 Sekunden festhalten.
$t0 = microtime(true);
$zweiter = avesmapsWikiDrosselPlatzFrei($abstand, $vermerk);
$gewartet = microtime(true) - $t0;
assert($zweiter === false, '2b: der zweite Abruf haette den belegten Platz melden muessen.');
assert(
    $gewartet < 0.1,
    sprintf('2b: der nicht wartende Zweig hat %.3F s geschlafen -- er darf gar nicht schlafen.', $gewartet)
);

// 2c) Und er darf den Platz NICHT verschoben haben: ein abgewiesener Abruf hat nichts geholt,
// also darf er den naechsten echten Abruf auch nicht nach hinten druecken.
$vermerktNachAbweisung = (float) trim((string) file_get_contents($vermerk));
usleep($abstand + 300000); // den Abstand verstreichen lassen
assert(
    avesmapsWikiDrosselPlatzFrei($abstand, $vermerk) === true,
    '2c: nach abgelaufenem Abstand haette der Platz wieder frei sein muessen.'
);
$vermerktDanach = (float) trim((string) file_get_contents($vermerk));
assert(
    $vermerktDanach > $vermerktNachAbweisung,
    '2c: der genommene Platz haette den Vermerk vorruecken muessen.'
);

// 2d) Beide Zweige teilen denselben Vermerk -- sonst haette jeder seine eigene Drossel, und
// zwei Drosseln nebeneinander sind keine.
$vermerkZwei = tempnam(sys_get_temp_dir(), 'avm_drossel_geteilt_') ?: '';
assert($vermerkZwei !== '', '2d: keine temporaere Datei anlegbar.');
@unlink($vermerkZwei);
avesmapsWikiSyncThrottleWikiRequest(200000, $vermerkZwei); // nimmt den ersten Platz
assert(
    avesmapsWikiDrosselPlatzFrei(200000, $vermerkZwei) === false,
    '2d: der nicht wartende Zweig sieht den Platz des wartenden nicht -- getrennte Drosseln.'
);

@unlink($vermerk);
@unlink($vermerkZwei);

// ---------------------------------------------------------------------------
// ABSCHNITT 3 -- die Host-Frage hat EINE Antwort.
// ---------------------------------------------------------------------------

// 💣 "Ist diese Adresse eine Wiki-Adresse?" ist genau die Art Frage, die in diesem Projekt
// schon zweimal zwei Antworten hatte (Wappen-Kopf gegen Listenzeile; Infobox gegen Label).
// Es gibt EINE Implementierung, und die Drossel benutzt sie, statt die Regex abzuschreiben.
assert(
    function_exists('avesmapsWikiDateiIstWikiHost'),
    '3: das Host-Praedikat fehlt -- drossel.php muss datei-riegel.php laden.'
);
// 🪤 Die erste Fassung suchte hier schlicht nach der Zeichenkette "wiki-aventurica." und war
// damit rot, sobald ein KOMMENTAR den Wirt erwaehnt -- was er muss, um die Regel zu erklaeren.
// Gemessen wird deshalb, ob die Datei ueberhaupt selbst einen Wirt AUSEINANDERNIMMT: wer
// `avesmapsWikiDateiIstWikiHost` fragt, braucht `PHP_URL_HOST` nie.
$drosselQuelle = (string) file_get_contents($wurzel . '/api/_internal/wiki/drossel.php');
assert(
    !str_contains($drosselQuelle, 'PHP_URL_HOST'),
    '3: drossel.php zerlegt selbst einen Wirt, statt avesmapsWikiDateiIstWikiHost zu fragen -- '
        . 'das waere die zweite Antwort auf dieselbe Frage.'
);
assert(
    str_contains($drosselQuelle, 'avesmapsWikiDateiIstWikiHost('),
    '3: drossel.php fragt das gemeinsame Host-Praedikat gar nicht.'
);

// Und sie gilt beiden Wirten: de. und offline. zeigen auf dieselbe IP.
assert(avesmapsWikiDrosselGiltFuer('https://de.wiki-aventurica.de/de/api.php') === true, '3: de. nicht erkannt.');
assert(avesmapsWikiDrosselGiltFuer('https://offline.wiki-aventurica.de/dump/x.bz2') === true, '3: offline. nicht erkannt.');
assert(avesmapsWikiDrosselGiltFuer('https://ulisses-spiele.de/x.png') === false, '3: fremder Wirt gedrosselt.');
assert(avesmapsWikiDrosselGiltFuer('https://wiki-aventurica.de.angreifer.example/x') === false, '3: Suffix-Grenze verletzt.');

// ---------------------------------------------------------------------------
// ABSCHNITT 4 -- Gegenprobe: die Zusicherung aus 1c faellt, wenn der Aufruf verschwindet.
// ---------------------------------------------------------------------------

// 🪤 Ohne diesen Abschnitt koennte 1c an einer Funktion haengen, deren Rumpf leer zurueckkam --
// dann ist die Suche trivial erfuellt und der Test gruen, ohne etwas zu pruefen. Hier wird der
// Drossel-Aufruf herausmutiert und der Fehlschlag VERLANGT.
$mutationsQuelle = (string) file_get_contents($wurzel . '/api/app/coat.php');
$mutiert = str_replace('avesmapsWikiDrosselPlatzFrei(', 'avesmapsNichtDieDrossel(', $mutationsQuelle);
assert($mutiert !== $mutationsQuelle, '4: die Mutation ist gar nicht angekommen -- 1c misst etwas anderes.');
$rumpfMutiert = $funktionsRumpf($mutiert, 'avesmapsCoatFetch');
assert($rumpfMutiert !== '', '4: mutierter Rumpf nicht gefunden.');
assert(
    !str_contains($rumpfMutiert, 'avesmapsWikiSyncThrottleWikiRequest(')
        && !str_contains($rumpfMutiert, 'avesmapsWikiDrosselPlatzFrei('),
    '4: die Zusicherung aus 1c ueberlebt die Mutation -- sie prueft nicht, was sie zu pruefen vorgibt.'
);

// ---------------------------------------------------------------------------
// ABSCHNITT 5 -- der LADEWEG: jede gebundene Datei muss die Drossel allein erreichen.
// ---------------------------------------------------------------------------

// 💣 DER FEHLER, DEN DIESER ABSCHNITT FAENGT, IST IM PROJEKT SCHON ZWEIMAL LIVE GEGANGEN: eine
// Datei ruft eine Funktion, die ihr Aufrufer zufaellig schon geladen hatte -- und beim ersten
// Aufrufer, der das nicht tut, ist es ein Fatal Error. Ein Fatal antwortet mit LEEREM Rumpf, im
// Browser also „Unexpected end of JSON input": es sieht aus wie ein Netzfehler, nicht wie ein
// fehlendes require. Genau deshalb wird hier je Datei ein EIGENER Prozess gestartet; in einem
// gemeinsamen Prozess kann dieser Fehler grundsaetzlich nicht auftreten.
//
// 🪤 Und er startet den Unterprozess OHNE ini-Schalter. Ein `-d extension=…dll` hat am
// 24.08.2026 einen Deploy gekippt: das lokale Feld faehrt Windows, das Tor faehrt Linux.
foreach (array_keys($gebunden) as $datei) {
    if ($datei === 'api/app/coat.php') {
        // ⚠️ Der Endpunkt fuehrt beim Laden seine Arbeit AUS (er beantwortet eine Anfrage) und
        // laesst sich darum nicht bloss requiren. Sein Ladeweg steht in Abschnitt 6.
        continue;
    }

    // 🪤 Das Skript geht ueber eine DATEI, nicht ueber `php -r`. Der erste Versuch reichte es als
    // Argument durch, und `escapeshellarg` frisst unter Windows die inneren Anfuehrungszeichen:
    // aus function_exists("…") wurde eine undefinierte Konstante, und der Test meldete ein
    // fehlendes require, das es nie gab. Eine Datei hat kein Quoting.
    $skriptDatei = tempnam(sys_get_temp_dir(), 'avm_ladeweg_') ?: '';
    assert($skriptDatei !== '', '5: keine temporaere Datei anlegbar.');
    file_put_contents($skriptDatei, implode("\n", [
        '<?php',
        'require ' . var_export($wurzel . '/' . $datei, true) . ';',
        'echo (function_exists(\'avesmapsWikiSyncThrottleWikiRequest\')',
        '    && function_exists(\'avesmapsWikiDrosselGiltFuer\')',
        '    && function_exists(\'avesmapsWikiDrosselPlatzFrei\')) ? \'JA\' : \'NEIN\';',
    ]));

    $ausgabe = (string) shell_exec(
        escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($skriptDatei) . ' 2>&1'
    );
    @unlink($skriptDatei);

    assert(
        str_contains($ausgabe, 'JA'),
        "5: {$datei} erreicht die Drossel nicht, wenn sie ALLEIN geladen wird -- ihr fehlt das "
            . "require auf drossel.php. Ausgabe: " . trim($ausgabe)
    );
    assert(
        !str_contains($ausgabe, 'Fatal error') && !str_contains($ausgabe, 'Warning'),
        "5: {$datei} laedt nicht sauber allein: " . trim($ausgabe)
    );
}

// ---------------------------------------------------------------------------
// ABSCHNITT 6 -- coat.php: abgewiesen ist NICHT fehlgeschlagen.
// ---------------------------------------------------------------------------

$coatQuelle = str_replace(chr(13), '', (string) file_get_contents($wurzel . '/api/app/coat.php'));

// Der Ladeweg dieses Endpunkts, so weit er ohne Ausfuehren pruefbar ist.
assert(
    str_contains($coatQuelle, "require_once __DIR__ . '/../_internal/wiki/drossel.php';"),
    '6: coat.php laedt die Drossel nicht.'
);

// 💣 DIE REIHENFOLGE IST DIE GANZE AUSSAGE. Ein abgewiesener Abruf hat NICHTS gefragt: weder das
// Wiki noch die Adresse haben versagt. Wer ihn trotzdem in `avesmapsCoatDrosselFehlschlag`
// laufen laesst, schreibt einen Grabstein fuer eine Adresse, die nie probiert wurde -- und
// fuenf Grabsteine schliessen die Wappen-Drossel global fuer 30 Minuten. Das ist WOERTLICH der
// Fehler vom 23.08.2026, nur mit dem Crawl-delay als neuem Ausloeser.
$absageZweig = strpos($coatQuelle, 'if ($absage !== null) {');
$grabstein = strpos($coatQuelle, 'avesmapsCoatDrosselFehlschlag($dir, $key, $jetzt);');
assert($absageZweig !== false, '6: coat.php wertet die Absage der Drossel nicht aus.');
assert($grabstein !== false, '6: der Grabstein-Aufruf ist verschwunden -- Reihenfolge nicht pruefbar.');
assert(
    $absageZweig < $grabstein,
    '6: die Absage wird NACH dem Grabstein behandelt -- damit bekommt eine nie gestellte Anfrage '
        . 'einen Fehlschlag angerechnet.'
);

printf(
    "OK -- %d ausgehende Abrufer gefunden: %d gebunden, %d begruendet ausgenommen. Register deckungsgleich.\n",
    count($gefundeneDateien),
    count($gebunden),
    count($ausnahmen)
);
