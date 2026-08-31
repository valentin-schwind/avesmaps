<?php

declare(strict_types=1);

/**
 * Der Import-Endpunkt: am Quelltext geprueft UND ausgefuehrt.
 *
 * ⚠️ WARUM BEIDES: der Endpunkt beendet sich selbst (avesmapsRequireUserWithCapability EXITet,
 * avesmapsJsonResponse ist `: never`) und braucht Sitzung und Datenbank. Ein vollstaendiger
 * Ablauf geht im Test nicht. Geprueft wird deshalb, was ohne Sitzung pruefbar ist -- und das
 * sind genau die Fehler, die in diesem Haus schon zweimal einen Endpunkt tot ausgeliefert haben.
 *
 * Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5.1
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-endpunkt-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$pfad = __DIR__ . '/../../../edit/map/garetien-import.php';
$roh = file_get_contents($pfad);
assert(is_string($roh) && $roh !== '', 'api/edit/map/garetien-import.php existiert');
$roh = str_replace("\r\n", "\n", $roh);

/**
 * 🪤 Kommentare muessen heraus, bevor am Code geprueft wird -- sonst schlaegt die Zusicherung
 * „kein getMessage()" an dem Kommentar an, der genau diese Regel erklaert, und der naechste
 * Leser loescht den Kommentar statt des Fehlers.
 */
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $stuecke[] = $token[1];
            continue;
        }
        $stuecke[] = $token;
    }

    return implode('', $stuecke);
};
$quelle = $nurCode($roh);

// 🔴 DER RIEGEL, und er steht VOR der Weiche. Eine Importquelle, die jeder befuellen kann, ist
// eine Schreibberechtigung auf die Karte -- der Upload-Weg braucht ihn genauso wie der Abruf.
//
// 🔴 SEIT 31.08.2026 `edit` STATT `admin` (Owner: „der button 'Garetien Importer' soll für alle
// Editoren-Nutzer sichtbar werden"). ⚠️ Das ist KEINE Aufweichung: `edit` schliesst Admins ein
// (avesmapsUserCan: 'edit' => ['admin','editor']), und die schreibenden bzw. nach AUSSEN gehenden
// Aktionen haengen weiterhin an `admin` -- der zweite Riegel darunter, der bis dahin unerreichbar
// war und mit dieser Zeile scharf wurde.
// 💣 Der Knopf im Browser war zuerst allein freigegeben; der Editor sah daraufhin ein leeres
// Fenster mit „Dir fehlt die Berechtigung fuer diese Aktion." -- eine Freigabe ist erst dann eine,
// wenn BEIDE Haelften sie kennen. Deshalb nagelt dieser Test die Server-Haelfte fest.
assert(str_contains($quelle, "avesmapsRequireUserWithCapability('edit')"), 'edit-Riegel vorhanden');
assert(!str_contains($quelle, "avesmapsRequireUserWithCapability('admin')"),
    'und KEIN admin-Riegel mehr am Eingang -- sonst kaeme kein Editor herein');
$vorDerWeiche = substr($quelle, 0, strpos($quelle, "\$action ==="));
assert(
    str_contains($vorDerWeiche, "avesmapsRequireUserWithCapability('edit')"),
    'der Riegel steht VOR der ersten Aktionsweiche, nicht in einzelnen Zweigen'
);
assert(substr_count($quelle, 'avesmapsRequireUserWithCapability') === 1, 'genau EIN Riegel, nicht je Zweig einer');

// ---- Fuenf-Punkte-Brief 30.08.2026, Punkt 2: „Holen & Rechnen"/„Ebenen" bleiben admin-only, AUCH
// wenn der Riegel oben eines Tages fuer Editoren geoeffnet wird -------------------------------
//
// 🔴 KEIN zweiter avesmapsRequireUserWithCapability-Aufruf (die Zusicherung oben zaehlt weiterhin
// GENAU EINEN) -- die engere Wiederholung laeuft ueber avesmapsUserCan, direkt am selben $user.
assert(substr_count($quelle, 'avesmapsRequireUserWithCapability') === 1,
    'der engere Admin-Riegel darf die Gesamtzahl der avesmapsRequireUserWithCapability-Aufrufe nicht erhoehen');
assert(str_contains($quelle, "avesmapsUserCan(\$user, 'admin')"), 'der engere Admin-Riegel fehlt');
// Er muss NACH `$action` (er braucht ihn) und VOR der ersten Aktionsweiche stehen -- sonst laesst
// er den `ebenen`-Zweig schon durchrutschen, bevor er ueberhaupt prueft.
$actionPos = strpos($quelle, "\$action = avesmapsNormalizeSingleLine");
$riegelPos = strpos($quelle, "avesmapsUserCan(\$user, 'admin')");
$ersteWeichePos = strpos($quelle, "\$action === 'ebenen'");
assert($actionPos !== false && $ersteWeichePos !== false,
    'die $action-Zuweisung oder die erste Aktionsweiche wurden nicht gefunden -- hat sich ihre Form geaendert?');
assert($riegelPos !== false && $riegelPos > $actionPos && $riegelPos < $ersteWeichePos,
    'der engere Riegel braucht $action, muss also NACH ihr und VOR der ersten Aktionsweiche stehen');
// Genau die fuenf Aktionen, die von aussen holen (fetch/upload/probe) oder rechnen (plan) bzw. die
// interne Zielliste zeigen (ebenen) -- NICHT `runs` (das braucht auch ein Editor beim Oeffnen des
// Fensters) und NICHT liste/wiki_landschaft/ruecknahme (die Pruef-/Entscheidwege des Fensters).
foreach (['ebenen', 'probe', 'fetch', 'upload', 'plan'] as $art) {
    assert(
        preg_match("~in_array\\(\\\$action,\\s*\\[[^\\]]*'{$art}'[^\\]]*\\],\\s*true\\)~", $quelle) === 1,
        "die enge Liste des Admin-Riegels muss '{$art}' nennen"
    );
}
assert(
    preg_match("~in_array\\(\\\$action,\\s*\\[[^\\]]*'runs'[^\\]]*\\],\\s*true\\)~", $quelle) !== 1,
    "'runs' darf NICHT im engen Riegel stehen -- ein Editor muss beim Oeffnen des Fensters sehen "
        . 'koennen, welcher Lauf gilt, ohne selbst admin zu sein'
);

// 💣 Helfer brauchen ihre Argumente. `avesmapsCreatePdo($config)` statt `$config['database']`
// kostete dem Tempowerte-Fenster jede einzelne Ladung -- die Funktion nimmt ein Array, PHP
// beschwert sich nicht, und drinnen ist alles leer.
assert(str_contains($quelle, 'avesmapsApplyCorsPolicy($config)'), 'CORS mit Argument');
assert(preg_match('/avesmapsCreatePdo\(\s*\$config\[.database.\]/', $quelle) === 1, 'PDO mit Teilbaum');

// 💣 Kein getMessage() an den Client (Informationsabfluss, Meilenstein M1).
// ⚠️ Die Ausnahme des Abrufs ist KEINE: die wandert in `fehler[].grund` der eigenen Antwort und
// sagt dem Admin, warum garetien.de nicht erreichbar war -- deshalb wird hier nur der
// Auffang-catch am Dateiende geprueft.
$letzterCatch = substr($quelle, (int) strrpos($quelle, 'catch (Throwable $error)'));
assert(!str_contains($letzterCatch, 'getMessage()'), 'der Auffang-catch gibt keinen Ausnahmetext heraus');

// 🔴 DIE ADRESSE KOMMT AUS DER FESTEN LISTE, NIE AUS DEM ANFRAGERUMPF. Ein Endpunkt, der eine
// beliebige URL entgegennimmt und abruft, ist ein SSRF-Werkzeug -- auch mit Admin-Riegel, denn
// er laeuft aus unserem Netz heraus. Der Aufrufer waehlt aus der Liste, er diktiert sie nicht.
assert(
    preg_match('/avesmapsGaretienHoleSeite\(\s*\$payload/', $quelle) !== 1,
    'die abgerufene Adresse darf nicht aus dem Anfragerumpf stammen'
);
assert(
    preg_match('/avesmapsGaretienProbe\(\s*\$payload/', $quelle) !== 1,
    'auch die Probe ruft keine Adresse aus dem Anfragerumpf ab'
);
assert(substr_count($quelle, 'avesmapsGaretienEndpunktEbene(') >= 3, 'jeder Weg schlaegt die Ebene in der Liste nach');

// 🔴 Null gestagte Zeilen sind ein FEHLER, keine Nachricht. Ein Upload, der nichts ergibt, ist
// fast immer die falsche Datei -- und ein Lauf mit null Zeilen sieht hinterher genauso aus wie
// eine leere Quelle. Genau diese Verwechslung ist im Haus schon als „ok:true mit leerem Inhalt"
// aufgetreten und war vom Betrachter nicht von „hier liegt nichts" zu unterscheiden.
assert(str_contains($quelle, "'no_rows'"), 'ein Upload ohne Datenzeilen wird abgelehnt');

// 🔴 DER ENDPUNKT WIRD AUSGEFUEHRT, NICHT NUR GELESEN -- die wichtigste Zusicherung hier.
//
// 🪤 Live gemessen am 25.08.2026 an einem anderen Endpunkt: HTTP 500 mit LEEREM Rumpf, weil ein
// blankes `require` eine Bibliothek erneut lud, die bootstrap.php schon mit `require_once`
// hatte -- die Einmal-Liste gilt nur fuer require_once selbst. „Cannot redeclare function …",
// ein Fatal Error VOR jeder Ausgabe. 💣 `php -l` findet das NIE: eine Redeklaration ist ein
// Laufzeitfehler, keine Syntaxfrage. Ausfuehren ist der einzige Beweis.
//
// ⚠️ Ohne config.local.php faellt der Endpunkt in seinen eigenen catch und antwortet mit einem
// JSON-Fehler. Das ist genau richtig: geprueft wird nicht, WAS er antwortet, sondern DASS er
// ueberhaupt antwortet.
$ausgabe = [];
$code = 0;
exec('php ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
$rumpf = trim(implode("\n", $ausgabe));

assert($rumpf !== '', 'der Endpunkt antwortet ueberhaupt (leerer Rumpf = Fatal Error)');
assert(
    !preg_match('/(Fatal error|Cannot redeclare|Uncaught \w*Error)/i', $rumpf),
    'kein Fatal Error beim Ausfuehren: ' . substr($rumpf, 0, 300)
);
assert(
    str_contains($rumpf, '{') && str_contains($rumpf, '"ok"'),
    'die Antwort ist JSON mit einem ok-Feld: ' . substr($rumpf, 0, 300)
);

// 💣 Und die Ursache selbst festgenagelt: was bootstrap.php laedt, laedt ein Endpunkt NIE selbst.
// Die Importbibliothek gehoert IHM (bootstrap kennt sie nicht), also muss sie hier stehen -- aber
// mit require_once, damit ein spaeterer zweiter Lader nicht zur Redeklaration fuehrt.
assert(
    preg_match('/require_once[^;]*import\/garetien-abruf\.php/', $quelle) === 1,
    'die Importbibliothek wird mit require_once geladen, nicht blank'
);

// 🔴 EIN `apply` GIBT ES HIER NICHT. Uebernommen wird ueber die vorhandene Vorschau
// (api/edit/wiki/sync-plan.php, Art 'garetien'): dort haengen der Einzelflug-Riegel, die zweite
// Bestaetigung fuer Loeschungen, das Protokoll und der Fortschritt in Haeppchen. Eine zweite Tuer
// auf denselben Schreibweg waere ein zweiter Erzeuger, und eine Regel, die einen von zweien
// bindet, ist keine -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre und der Ausstiegsregel.
assert(!str_contains($quelle, "'apply'"), 'der Import-Endpunkt hat keine eigene Uebernahme-Tuer');
assert(!str_contains($quelle, 'avesmapsGaretienUebernehmen'), 'und ruft den Schreibweg nicht selbst');

// 🔴 Und die Vorschau kennt die Art WIRKLICH -- Whitelist, Verteiler-Zweig und das require dazu.
// 💣 Fehlt das require, ist der match-Arm ein Fatal Error mit LEEREM Rumpf, und der liest sich im
// Browser als Netzfehler. `php -l` findet das nie: der Arm wird erst zur Laufzeit erreicht.
$vorschau = str_replace("
", "
", (string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-plan.php'));
assert(preg_match("~AVESMAPS_SYNC_PLAN_KINDS = \[[^\]]*'garetien'~", $vorschau) === 1,
    'die Art steht in AVESMAPS_SYNC_PLAN_KINDS');
assert(str_contains($vorschau, "'garetien' => avesmapsGaretienApplyStep("), 'und der Verteiler kennt sie');
assert(preg_match('~require_once[^;]*import/garetien-uebernahme\.php~', $vorschau) === 1,
    'und die Datei mit dem Schritt wird geladen');

// 💣 Und die Uebernahme laeuft NUR ueber die Bibliothek -- kein eigenes INSERT im Endpunkt.
// Ein zweiter Schreiber auf map_features waere genau der Erzeuger, den keine Regel mehr bindet.
assert(!preg_match('~INSERT\s+INTO\s+(map_features|ecosystem_region|ecosystem_area)~i', $quelle),
    'der Endpunkt schreibt keine Kartenobjekte selbst');

// 🔴 SCHADENSFALL 30.08.2026 -- die Vorschau (sync-plan.php) verlangt fuer kind='garetien' eine
// ausdrueckliche id-Liste, BEVOR sie in den Verteiler-Zweig geht, und lehnt eine leere ab. Ohne
// diesen Riegel liest avesmapsGaretienApplyStep den GANZEN Lauf statt nur die angezeigten Objekte
// -- genau das hat "Alle angezeigten einfuegen" auf 3007 statt rund 100 Objekte gebracht.
assert(str_contains($vorschau, 'avesmapsGaretienApplyIdsAusRumpf('),
    'der Riegel liest die ids ueber die dafuer vorgesehene Funktion, nicht per Hand aus dem Rumpf');
assert(str_contains($vorschau, "'missing_ids'"),
    'eine fehlende/leere id-Liste wird ausdruecklich abgelehnt, nicht stillschweigend als "alles" gelesen');
// Und der Riegel steht VOR dem match-Arm, der ihn braucht -- ein Riegel NACH dem Verteiler waere
// zu spaet.
$riegelPos = strpos($vorschau, 'avesmapsGaretienApplyIdsAusRumpf(');
$verteilerPos = strpos($vorschau, "'garetien' => avesmapsGaretienApplyStep(");
assert($riegelPos !== false && $verteilerPos !== false && $riegelPos < $verteilerPos,
    'der id-Riegel steht VOR dem Verteiler-Zweig, der ihn benutzt');

// =================================================================================================
// 💣 JEDES FELD, DAS DER BROWSER IN EINER `liste`-ANFRAGE SCHICKT, MUSS DIESER ENDPUNKT AUCH LESEN
// =================================================================================================
// MELDUNG 31.08.2026 (Owner: „das mit dem markieren kann ja nicht stimmen wenn oben 1000 steht").
// Die Kachel „Angezeigte Zeilen" war seit ihrer Auslieferung VOLLSTAENDIG WIRKUNGSLOS: der Browser
// schickte `anzahl` mit, avesmapsGaretienArbeitsliste las es aus ihrem `$filter` -- und dazwischen
// warf dieser Endpunkt es weg, weil er sein Filterfeld aus einer AUSDRUECKLICHEN Liste baut und
// `anzahl` schlicht fehlte.
//
// 🔴 DAS FEHLERBILD WAR KEINE FEHLERMELDUNG. Nichts brach, nichts warnte; sichtbar wurde es an
// einer Zahl an ganz anderer Stelle („Alle markieren (8205)" bei eingestellten 1000). Beide
// Haelften waren fuer sich geprueft -- der Sender per Quelltextpruefung, der Empfaenger zur
// Laufzeit --, und genau die NAHT dazwischen hatte niemand.
//
// ⚠️ Deshalb prueft dies NICHT den einen Namen `anzahl`, sondern die MENGE: was der Browser
// schickt, muss hier ankommen. Ein Test auf den einen Namen faenge das naechste vergessene Feld
// nicht -- und dass es ein naechstes gibt, ist die einzige sichere Annahme.
$browser = str_replace("\r\n", "\n", (string) file_get_contents(
    __DIR__ . '/../../../../js/review/review-garetien-importer.js'
));

// Alle Anfragerumpfe der Liste einsammeln. 💣 ES SIND ZWEI, und der zweite steht kompakt in EINER
// Zeile (avesmapsGaretienAnzeigeNachEinfuegenBereinigen) -- ein Muster, das nur Zeilenanfaenge
// liest, sieht ihn nicht.
$gesendet = [];
$pos = 0;
$rumpfe = 0;
while (($von = strpos($browser, 'action: "liste"', $pos)) !== false) {
    $stueck = substr($browser, $von, 600);
    // Bis zum Ende des Objektliterals: entweder `};` (die Variante mit Variablen) oder `})`
    // (die Variante, die direkt in den Aufruf geschrieben ist).
    $enden = array_filter([strpos($stueck, '};'), strpos($stueck, '})')], 'is_int');
    $literalEnde = $enden === [] ? strlen($stueck) : min($enden);
    preg_match_all('~(?<![.\w:"\'])([a-z_]+)\s*:~', substr($stueck, 0, $literalEnde), $t);
    $gesendet = array_merge($gesendet, $t[1]);
    // ⚠️ `anzahl` steht in KEINEM der beiden Literale -- es wird eine Zeile DAHINTER angehaengt
    // (`rumpf.anzahl = …`), weil es nur bei gesetztem Deckel mitreist. Genau diese Bauform hat
    // den Fehler versteckt: wer nur das Literal liest, sieht das Feld ueberhaupt nicht.
    // 💣 Nur das Fenster HINTER DIESEM Literal, nie die ganze Datei: `rumpf` heisst die
    // Variable auch in den anderen Anfragen des Fensters (`select`, `apply`), und deren Felder
    // gehoeren anderen Endpunkt-Zweigen.
    preg_match_all('~\brumpf\.([a-z_]+)\s*=~', substr($stueck, $literalEnde, 400), $nach);
    $gesendet = array_merge($gesendet, $nach[1]);
    $rumpfe++;
    $pos = $von + 10;
}
$gesendet = array_values(array_unique($gesendet));

assert($rumpfe === 2, 'beide Listen-Anfragen gefunden, nicht nur eine: ' . $rumpfe);
assert(in_array('anzahl', $gesendet, true),
    'der Deckel reist mit -- sonst prueft der Rest dieses Abschnitts nichts: ' . implode(', ', $gesendet));
assert(count($gesendet) >= 9, 'die Rumpfe wurden wirklich gelesen: ' . implode(', ', $gesendet));

// Was der Endpunkt in seinem `liste`-Zweig aus dem Payload liest.
$code = $nurCode($roh);
$listeVon = strpos($code, "\$action === 'liste'");
assert($listeVon !== false, 'der liste-Zweig steht im Endpunkt');
preg_match_all("~\\\$payload\\['([a-z_]+)'\\]~", substr($code, $listeVon, 2000), $gelesen);
$gelesenNamen = array_values(array_unique($gelesen[1]));

// `action` beantwortet der Verteiler weiter oben, nicht der Filter.
$fehlend = array_values(array_diff($gesendet, $gelesenNamen, ['action']));
assert($fehlend === [],
    'DER ENDPUNKT LIEST NICHT, WAS DER BROWSER SCHICKT -- verloren gehen: ' . implode(', ', $fehlend)
    . ' (gesendet: ' . implode(', ', $gesendet) . ' | gelesen: ' . implode(', ', $gelesenNamen) . ')');
echo "OK: garetien-endpunkt-test\n";
