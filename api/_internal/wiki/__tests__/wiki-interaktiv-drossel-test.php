<?php

declare(strict_types=1);

/**
 * 💣 EIN ABRUF, DEN EIN MENSCH IM DIALOG AUSLOEST, DARF NICHT AUF DIE DROSSEL WARTEN. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/wiki-interaktiv-drossel-test.php
 *
 * ANLASS (Log-Auswertung 06.09.2026, Ausfaelle vom 30.08. bis 06.09.). `assign_to` im
 * Ortseditor holt die Wiki-Seite LIVE (avesmapsWikiSettlementBuildFromTitle), und der Abruf
 * ging durch `avesmapsWikiSyncThrottleWikiRequest` -- den Zweig, der WARTET. Der Crawl-delay
 * betraegt 20 Sekunden und die Warteschlange nimmt 20 Wartende: der zwanzigste Klick haette
 * bis zu 400 Sekunden geschlafen. Dazu 30 s Zeitlimit und zwei Wiederholungen mit 40 und
 * 80 Sekunden Pause -- und die ganze Zeit haelt die Anfrage einen PHP-Arbeiter UND eine der
 * zwanzig Datenbankverbindungen (avesmapsCreatePdo laeuft vor der Aktion).
 *
 * Gemessen im Zugriffsprotokoll: in jedem Ausfallfenster stehen 12 bis 22 `POST
 * settlements.php` EINES Browsers binnen ~20 Sekunden, danach 500 auf JEDEM PHP-Aufruf des
 * Kontos, danach Minuten mit 404/405 auf existierende .php-Dateien, waehrend JS und Kacheln
 * weiter 200 lieferten. Am 04.09.2026 dauerte das 78 Minuten. Dazu passen die
 * FastCGI-Abbrueche nach 180 und 363 Sekunden und das `max_user_connections`-Limit im
 * Fehlerprotokoll.
 *
 * 🔴 DIE REGEL: wer wartet, ist ein Massenlauf. Alles andere fragt den NICHT wartenden Zweig
 * (`avesmapsWikiDrosselPlatzFrei`) und sagt sofort ab -- dieselbe Entscheidung, die
 * `api/app/coat.php` seit dem 25.08.2026 trifft, und aus demselben Grund (AGENTS.md §10).
 *
 * 🔴 UND DIE VORGABE IST „WARTEN". Der Schalter ist ein Zustand JE ANFRAGE, kein globaler
 * Modus: ein Dump-Schritt, der ihn nie anfasst, wartet weiter wie bisher. Wer eine neue
 * interaktive Flaeche baut, schaltet ihn ein -- und Abschnitt G faengt den, der es vergisst.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 3); // …/api/_internal/wiki/__tests__ -> …/api
$repo = dirname($wurzel);

// ⚠️ Der Vermerk der Drossel haengt an avesmapsApiRoot() -- also zeigt der Test sie auf ein
// eigenes Verzeichnis. Ohne das schriebe er in das echte uploads/ des Arbeitsbaums, und ein
// belegter Platz dort bremste den naechsten echten Abruf des Entwicklers.
$spielwiese = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-interaktiv-' . getmypid();
$GLOBALS['avm_test_api_root'] = $spielwiese . DIRECTORY_SEPARATOR . 'api';
@mkdir($GLOBALS['avm_test_api_root'], 0777, true);

function avesmapsApiRoot(): string {
    return (string) $GLOBALS['avm_test_api_root'];
}

require_once $wurzel . '/_internal/wiki/sync.php';

$aufraeumen = static function () use ($spielwiese): void {
    foreach (['/uploads/wiki-drossel/letzte-anfrage', '/uploads/wiki-drossel/.htaccess'] as $datei) {
        @unlink($spielwiese . $datei);
    }
    @rmdir($spielwiese . '/uploads/wiki-drossel');
    @rmdir($spielwiese . '/uploads');
    @rmdir($spielwiese . '/api');
    @rmdir($spielwiese);
};

// ===== A) DIE VERERBUNG IST DER GRUND FUER DIE REIHENFOLGE IN JEDER FANGKETTE ==================
// „Belegt" ist ein Sonderfall von „nicht erreichbar": ein Endpunkt, der nur den allgemeinen Fall
// kennt, antwortet weiterhin richtig (503 mit dem fertigen Satz). Wer BEIDE kennt, muss den
// spezielleren ZUERST fangen -- dieselbe Falle wie bei PDOException/RuntimeException.
assert(
    class_exists('AvesmapsWikiBelegtException'),
    'A1: die Ausnahme fuer den belegten Drosselplatz existiert'
);
assert(
    is_subclass_of('AvesmapsWikiBelegtException', 'AvesmapsWikiUnreachableException'),
    'A2: Belegt erbt von Unerreichbar -- deshalb muss sie in jeder Fangkette DAVOR stehen'
);

// ===== B) DIE VORGABE IST „WARTEN" =============================================================
// 💣 Faellt der Schalter je auf „interaktiv" zurueck, brechen die Dump-Phasen bei belegtem Platz
// ab, statt zu warten -- und ein abgebrochener Schritt gibt die Pipeline-Sperre nicht frei.
assert(
    avesmapsWikiSyncInteraktiv() === false,
    'B1: ohne Zutun wartet ein Abruf wie bisher'
);
assert(
    avesmapsWikiSyncInteraktiv(true) === true && avesmapsWikiSyncInteraktiv() === true,
    'B2: der Schalter laesst sich setzen und behaelt seinen Wert'
);
assert(
    avesmapsWikiSyncInteraktiv(false) === false,
    'B3: und wieder zuruecknehmen'
);

// ===== C) DER KERN: BELEGT HEISST SOFORTIGE ABSAGE, NICHT SCHLAF ===============================
// Ausgefuehrt, nicht gelesen: der Vermerk wird belegt, dann faehrt der Test den echten
// Abrufer. Er darf das Netz nie erreichen -- die Absage faellt VOR dem file_get_contents.
$vermerk = $spielwiese . '/uploads/wiki-drossel/letzte-anfrage';
@mkdir(dirname($vermerk), 0777, true);
file_put_contents($vermerk, sprintf('%.6F', microtime(true)));

avesmapsWikiSyncInteraktiv(true);
$begonnen = microtime(true);
$gefangen = null;
try {
    avesmapsWikiSyncApiRequest(['action' => 'query', 'titles' => 'Gareth']);
} catch (Throwable $ausnahme) {
    $gefangen = $ausnahme;
}
$gedauert = microtime(true) - $begonnen;
avesmapsWikiSyncInteraktiv(false);

assert(
    $gefangen instanceof AvesmapsWikiBelegtException,
    'C1: ein belegter Platz sagt im interaktiven Modus ab -- gefangen: '
        . ($gefangen === null ? 'nichts' : get_class($gefangen) . ': ' . $gefangen->getMessage())
);
// 🔴 DIE ZEIT IST DER GANZE TEST. Ohne den Fix schlaefe dieser Aufruf den vollen Abstand
// (20 s) und haette dabei einen PHP-Arbeiter und eine Datenbankverbindung gehalten.
assert(
    $gedauert < 1.0,
    'C2: die Absage kommt SOFORT (gemessen: ' . number_format($gedauert, 3) . ' s) -- '
        . 'ein wartender Zweig haelt hier einen PHP-Arbeiter'
);

// ===== D) EINE ABSAGE NENNT IHREN GRUND UND IHRE WARTEZEIT =====================================
// ⚠️ „nicht erreichbar" waere hier falsch: das Wiki antwortet, WIR drosseln uns selbst. Der
// Editor soll wissen, dass ein zweiter Versuch gleich gelingt -- sonst klickt er sofort wieder,
// und genau das war der Ausfall.
$meldung = $gefangen->getMessage();
assert(trim($meldung) !== '', 'D1: die Absage ist nicht leer');
$sekunden = (int) ceil(AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS / 1000000);
assert(
    str_contains($meldung, (string) $sekunden),
    "D2: die Meldung nennt die Wartezeit ({$sekunden} s) -- gelesen: {$meldung}"
);
// 💣 GERECHNET, NICHT ABGESCHRIEBEN: wer den Crawl-delay aendert, aendert den Satz mit. Eine
// abgeschriebene Zahl waere beim naechsten Mal falsch, und niemand zaehlt nach.
$quelleSync = (string) file_get_contents($wurzel . '/_internal/wiki/sync.php');
assert(
    str_contains($quelleSync, 'AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS / 1000000'),
    'D3: die Wartezeit im Satz wird aus dem Crawl-delay gerechnet, nicht abgeschrieben'
);

// ===== E) WER WARTEN DARF, IST EINE AUFZAEHLUNG -- UND DIE VORGABE IST „NICHT WARTEN" ==========
// 🔴 Die sichere Richtung: eine neue Aktion wartet NICHT. Der Preis eines Irrtums ist dann eine
// Absage, die man wiederholt -- und nicht ein blockierter Arbeiter, den niemand sieht.
require_once $wurzel . '/_internal/wiki/settlements.php';
assert(
    function_exists('avesmapsWikiSettlementAktionWartetAufDrossel'),
    'E1: die Regel steht als eigene, reine Funktion da'
);
foreach (['assign_to', 'clear_assign', 'set_coat', 'preview', 'search', '', 'was_auch_immer'] as $sofort) {
    assert(
        avesmapsWikiSettlementAktionWartetAufDrossel($sofort) === false,
        "E2: '{$sofort}' wartet nicht"
    );
}
foreach (['bulk_connect', 'enrich_details', 'crawl_buildings', 'localize_coats'] as $stapel) {
    assert(
        avesmapsWikiSettlementAktionWartetAufDrossel($stapel) === true,
        "E3: der Massenlauf '{$stapel}' darf warten"
    );
}
// ⚠️ Der Vergleich ist getrimmt -- der Endpunkt liest die Aktion aus dem Anfragerumpf.
assert(
    avesmapsWikiSettlementAktionWartetAufDrossel('  bulk_connect  ') === true,
    'E4: Leerraum um die Aktion aendert nichts'
);

// ===== F) DER ENDPUNKT SETZT DEN SCHALTER ======================================================
// ⚠️ Zeilenendenneutral gesucht: der Arbeitsbaum traegt CRLF, das Tor LF (AGENTS.md §9).
$endpunkt = str_replace("\r\n", "\n", (string) file_get_contents($wurzel . '/edit/wiki/settlements.php'));
assert(
    str_contains($endpunkt, 'avesmapsWikiSyncInteraktiv('),
    'F1: der Siedlungs-Endpunkt setzt den Schalter'
);
assert(
    str_contains($endpunkt, 'avesmapsWikiSettlementAktionWartetAufDrossel('),
    'F2: und er entscheidet ueber die geteilte Regel, nicht ueber eine eigene Liste'
);

// ===== G) UND ER IST DER EINZIGE, DER IHN BRAUCHT -- GEMESSEN, NICHT BEHAUPTET =================
// 🔴 DIE ZUSICHERUNG, DIE DEN NAECHSTEN FAENGT. `drossel.php` behauptete bis heute, es gebe
// „KEINEN interaktiven Einzelabruf ans lebende Wiki -- die Zuweisungsdialoge suchen in unseren
// eigenen Tabellen". Fuer Wege und Landschaften stimmt das (gemessen unten); fuer den ORT stimmte
// es nie, und weil der Satz so allgemein dastand, hat ihn niemand nachgemessen.
//
// Der Test verfolgt die Aufrufkette bis zum echten Abrufer und meldet jede Zuweisungsfunktion,
// die live abruft. Kommt eine dazu, muss ihr Endpunkt den Schalter setzen -- oder hier mit
// Begruendung eingetragen werden.
$rumpfeSammeln = static function (string $verzeichnis): array {
    $rumpfe = [];
    foreach (glob($verzeichnis . '/*.php') ?: [] as $datei) {
        $quelle = str_replace("\r\n", "\n", (string) file_get_contents($datei));
        if (preg_match_all('/^function (\w+)\s*\(/m', $quelle, $treffer, PREG_OFFSET_CAPTURE) === 0) {
            continue;
        }
        foreach ($treffer[1] as $i => $name) {
            $start = $treffer[0][$i][1];
            $auf = strpos($quelle, '{', $start);
            if ($auf === false) {
                continue;
            }
            $tiefe = 0;
            $ende = $auf;
            for ($p = $auf, $laenge = strlen($quelle); $p < $laenge; $p++) {
                if ($quelle[$p] === '{') {
                    $tiefe++;
                } elseif ($quelle[$p] === '}') {
                    $tiefe--;
                    if ($tiefe === 0) {
                        $ende = $p;
                        break;
                    }
                }
            }
            $rumpfe[$name[0]] = substr($quelle, $auf, $ende - $auf);
        }
    }
    return $rumpfe;
};

$rumpfe = $rumpfeSammeln($wurzel . '/_internal/wiki');
assert($rumpfe !== [], 'G1: die Bibliothek ist lesbar');

// Fixpunkt: alles, was einen Live-Rufer ruft, ruft selbst live ab.
$live = ['avesmapsWikiSyncApiRequest' => true, 'avesmapsWikiSyncApiPost' => true];
do {
    $gewachsen = false;
    foreach ($rumpfe as $name => $rumpf) {
        if (isset($live[$name])) {
            continue;
        }
        foreach (array_keys($live) as $rufer) {
            if (str_contains($rumpf, $rufer . '(')) {
                $live[$name] = true;
                $gewachsen = true;
                break;
            }
        }
    }
} while ($gewachsen);

// Die Zuweisungs- und Suchwege der Dialoge, die es heute gibt -- Ort, Weg, Landschaft.
// ⚠️ KEINE ZAHL DAVOR: eine liest sich wie eine vollstaendige Liste, und ein vierter Dialog kaeme
// dazu, ohne dass jemand nachzaehlt. Was diese Aufzaehlung sichert, ist die RICHTUNG -- wer hier
// steht, wird gemessen; wer neu dazukommt, gehoert ergaenzt.
$dialogWege = [
    'avesmapsWikiSettlementAssignTo' => true,  // holt die Infobox live -- der Fall dieses Tests
    'avesmapsWikiSettlementBuildFromTitle' => true,
    'avesmapsWikiPathAssign' => false,
    'avesmapsWikiPathAssignTo' => false,
    'avesmapsWikiPathSearch' => false,
    'avesmapsWikiRegionAssign' => false,
    'avesmapsWikiRegionSearch' => false,
    'avesmapsWikiRegionStagingSample' => false,
    'avesmapsWikiSettlementSearch' => false,
    'avesmapsWikiSettlementGetAssignment' => false,
];
foreach ($dialogWege as $funktion => $erwartetLive) {
    assert(
        isset($rumpfe[$funktion]),
        "G2: {$funktion} nicht gefunden -- umbenannt? Dann gehoert die Zeile hier nachgezogen."
    );
    $istLive = isset($live[$funktion]);
    assert(
        $istLive === $erwartetLive,
        "G3: {$funktion} ruft " . ($istLive ? 'LIVE ab' : 'nur eigene Tabellen')
            . ' -- erwartet war ' . ($erwartetLive ? 'LIVE' : 'nur eigene Tabellen')
            . '. Ein NEUER Live-Abruf in einem Dialog braucht den interaktiven Schalter in SEINEM '
            . 'Endpunkt, sonst wartet er bis zu ' . (int) ceil(
                AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS / 1000000 * AVESMAPS_WIKI_DROSSEL_MAX_WARTESCHLANGE
            ) . ' Sekunden und haelt dabei einen PHP-Arbeiter.'
    );
}

// ===== H) DER RUECKFALL: EIN BELEGTES WIKI DARF EINE BEKANNTE SEITE AUS DEM VORRAT NEHMEN ======
// `wiki_sync_pages.details_json` traegt die zuletzt geparste Infobox -- geschrieben bei jeder
// scharfen Zuweisung. Sie wurde bis heute NIRGENDS gelesen.
assert(
    function_exists('avesmapsWikiSettlementCachedDetails'),
    'H1: es gibt einen Leser fuer den Infobox-Vorrat'
);
$quelleSettlements = str_replace(
    "\r\n",
    "\n",
    (string) file_get_contents($wurzel . '/_internal/wiki/settlements.php')
);
$auf = strpos($quelleSettlements, 'function avesmapsWikiSettlementBuildFromTitle');
$zu = strpos($quelleSettlements, "\nfunction ", (int) $auf + 10);
$rumpfBuild = substr($quelleSettlements, (int) $auf, (int) $zu - (int) $auf);
assert(
    str_contains($rumpfBuild, 'AvesmapsWikiBelegtException'),
    'H2: der Aufbau aus dem Titel faengt genau den belegten Platz ab'
);
assert(
    str_contains($rumpfBuild, 'avesmapsWikiSettlementCachedDetails('),
    'H3: und greift dann auf den Vorrat zurueck'
);
// 💣 NUR der belegte Platz. Ein „nicht erreichbar" (Sperre, Zeitueberschreitung, kaputtes JSON)
// darf NICHT still aus dem Vorrat bedient werden -- sonst sieht ein dauerhaft gestoerter Abruf
// wie ein gelungener aus, und die Karte fuellt sich mit Daten von unbekanntem Alter.
assert(
    !str_contains($rumpfBuild, 'catch (AvesmapsWikiUnreachableException')
    && !str_contains($rumpfBuild, 'catch (Throwable'),
    'H4: der Rueckfall gilt NUR dem belegten Platz, nicht jedem Fehlschlag'
);

// 💣 UND DAS WAPPEN BLEIBT DRAUSSEN -- ausgefuehrt, nicht gelesen. `details_json` kann aus der
// Zeit vor dem 23.08.2026 stammen, als der Parser ein FOTO ins Wappenfeld schrieb; die Karte
// wurde davon befreit, dieser Vorrat nie (der Rohtext liegt dort nicht, siehe
// wappen-aufraeumen.php). `wiki_settlement.wappen_url` ist ein Anzeigepfad -- ein Rueckfall ohne
// diese Regel braechte die Altlast still zurueck.
$vorratMitAltlast = new class extends PDO {
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return new class extends PDOStatement {
            public function execute(?array $params = null): bool { return true; }
            public function fetchColumn(int $column = 0): mixed {
                return json_encode([
                    'title' => 'Gareth',
                    'name' => 'Gareth',
                    'wappen_url' => 'https://de.wiki-aventurica.de/wiki/Datei:Foto-keine-Wappen.jpg',
                    'einwohner' => '100000',
                ]);
            }
        };
    }
};
$ausVorrat = avesmapsWikiSettlementCachedDetails($vorratMitAltlast, 'Gareth');
assert(is_array($ausVorrat), 'H5: ein vollstaendiger Vorrat wird genommen');
assert(
    ($ausVorrat['wappen_url'] ?? 'fehlt') === '',
    'H6: das Wappen aus dem Vorrat kommt NICHT mit -- gelesen: '
        . var_export($ausVorrat['wappen_url'] ?? 'fehlt', true)
);
assert(
    ($ausVorrat['einwohner'] ?? '') === '100000',
    'H7: die uebrigen Infobox-Werte kommen sehr wohl mit'
);
// Ein Vorrat ohne Namen ist keiner -- er wanderte sonst als namenlose Zuweisung an ein Kartenobjekt.
$halberVorrat = new class extends PDO {
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return new class extends PDOStatement {
            public function execute(?array $params = null): bool { return true; }
            public function fetchColumn(int $column = 0): mixed {
                return json_encode(['title' => 'Gareth']);
            }
        };
    }
};
assert(
    avesmapsWikiSettlementCachedDetails($halberVorrat, 'Gareth') === null,
    'H8: ein Vorrat ohne Namen wird verworfen'
);

// 💣 UND DER RUECKFALL WIRD BENANNT. Ein Feld, das niemand liest, ist genau die Falle, die dieser
// Umbau behebt -- `details_json` wurde jahrelang geschrieben und nie gelesen. Also wird `aus_vorrat`
// vom Aufbau bis in die Antwort UND bis in die Oberflaeche verfolgt.
$rumpfAssign = (static function (string $quelle, string $name): string {
    $auf = strpos($quelle, 'function ' . $name);
    if ($auf === false) {
        return '';
    }
    $zu = strpos($quelle, "\nfunction ", $auf + 10);
    return substr($quelle, $auf, ($zu === false ? strlen($quelle) : $zu) - $auf);
})($quelleSettlements, 'avesmapsWikiSettlementAssignTo');
assert($rumpfAssign !== '', 'H9: die Zuweisung ist lesbar');
assert(
    substr_count($rumpfAssign, "'aus_vorrat' => \$ausVorrat") === 2,
    'H10: die Zuweisung meldet die Herkunft in BEIDEN Antworten -- Trockenlauf wie scharf'
);
// ⚠️ NEBEN dem Nest, nie darin: `$settlement` wandert unveraendert nach properties.wiki_settlement.
assert(
    !str_contains($rumpfAssign, "\$settlement['aus_vorrat']"),
    'H11: die Marke steht NICHT im Nest -- dort stuende sie fuer immer in den Kartendaten'
);
$endpunktRoh = $endpunkt; // schon zeilenendenneutral gelesen (Abschnitt F)
assert(
    str_contains($endpunktRoh, "'aus_vorrat' => \$ausVorrat"),
    'H12: auch die Vorschau meldet sie -- der Anlege-Fall merkt sich genau diese Antwort'
);
$oberflaeche = str_replace("\r\n", "\n", (string) file_get_contents($repo . '/js/review/review-settlement-wiki.js'));
assert(
    str_contains($oberflaeche, 'aus_vorrat'),
    'H13: und die Oberflaeche sagt es dem Editor -- sonst waere es das naechste Feld ohne Leser'
);

// ===== I) DER ZWEITE ERZEUGER: DIE ANMELDUNG ==================================================
// 💣 GEFUNDEN VOM PRUEFAGENTEN, NACHDEM DER UMBAU SCHON „FERTIG" AUSSAH -- und empirisch belegt
// mit 22,154 s. `avesmapsWikiSyncApiPost` ist der zweite Transport ans Wiki (die Bot-Anmeldung),
// und er fragte IMMER den wartenden Zweig. Der Weg dorthin fuehrt mitten durch den Fall, um den
// es hier geht:
//   assign_to -> BuildFromTitle -> FetchPoliticalTerritoryPageContents
//             -> avesmapsWikiSyncTitleBatchSize -> avesmapsWikiBotSitzungSicherstellen
//             -> ZWEI avesmapsWikiSyncApiPost (Token holen, dann anmelden)
// Eine abgelegte Sitzung haelt nur 15 Minuten; fuer einen Editor-Klick nach einer Pause ist der
// Anmeldeweg also der NORMALFALL, und er kostete zweimal bis zu zwanzig Sekunden, BEVOR die
// eigentliche Abfrage ueberhaupt begann.
//
// ⭐ Die Lehre ist die aelteste dieses Hauses und stand sogar im Register des Drossel-Waechters,
// wo beide Transporte nebeneinander aufgefuehrt sind: eine Regel, die einen von zwei Erzeugern
// bindet, ist keine Regel.
file_put_contents($vermerk, sprintf('%.6F', microtime(true)));
avesmapsWikiSyncInteraktiv(true);
$begonnenPost = microtime(true);
$gefangenPost = null;
try {
    avesmapsWikiSyncApiPost(['action' => 'query', 'meta' => 'tokens', 'type' => 'login'], []);
} catch (Throwable $ausnahme) {
    $gefangenPost = $ausnahme;
}
$gedauertPost = microtime(true) - $begonnenPost;
avesmapsWikiSyncInteraktiv(false);

assert(
    $gefangenPost instanceof AvesmapsWikiBelegtException,
    'I1: auch die Anmeldung sagt im interaktiven Modus ab -- gefangen: '
        . ($gefangenPost === null ? 'nichts' : get_class($gefangenPost))
);
assert(
    $gedauertPost < 1.0,
    'I2: und zwar SOFORT (gemessen: ' . number_format($gedauertPost, 3) . ' s)'
);

// ===== J) BESSER ALS ABSAGEN: IM DIALOG WIRD GAR NICHT ERST ANGEMELDET ========================
// 🔴 Die Anmeldung dient der STAPELGROESSE (500 Titel statt 50). Ein Dialog holt EINEN Titel --
// dafuer ist sie nutzlos, und sie kostet zwei weitere Drosselplaetze. Deshalb baut
// `avesmapsWikiBotSitzungSicherstellen` im interaktiven Modus keine NEUE Sitzung auf; eine
// bereits abgelegte wird weiter genutzt (die kostet nichts). Der Abruf laeuft dann anonym --
// und gelingt, statt an einem belegten Platz abzusagen.
//
// ⚠️ ABGELESEN, NICHT AUSGEFUEHRT, und der Grund gehoert hierher: der Zweig ist ohne hinterlegte
// Bot-Zugangsdaten tot (`avesmapsWikiBotZugangLesen` liefert dann sofort 'anonym'), und die
// Zugangsdaten stehen in der ungetrackten config.local.php. Genau die Umgebung, in der der
// Fehler sichtbar wurde, kann kein Test dieses Hauses fahren -- also wird wenigstens die
// REIHENFOLGE festgenagelt. Abschnitt I darueber ist der ausgefuehrte Teil.
$rumpfSitzung = (static function (string $quelle, string $name): string {
    $auf = strpos($quelle, 'function ' . $name);
    if ($auf === false) {
        return '';
    }
    $zu = strpos($quelle, "\nfunction ", $auf + 10);
    return substr($quelle, $auf, ($zu === false ? strlen($quelle) : $zu) - $auf);
})($quelleSync, 'avesmapsWikiBotSitzungSicherstellen');

assert($rumpfSitzung !== '', 'J1: der Sitzungsaufbau ist lesbar');
$stelleWeiche = strpos($rumpfSitzung, 'avesmapsWikiSyncInteraktiv(');
$stelleAnmeldung = strpos($rumpfSitzung, 'avesmapsWikiSyncApiPost(');
assert(
    $stelleWeiche !== false,
    'J2: der Sitzungsaufbau fragt den interaktiven Schalter'
);
assert(
    $stelleAnmeldung !== false && $stelleWeiche < $stelleAnmeldung,
    'J3: und zwar VOR der ersten Anmelde-Anfrage -- danach waere die Weiche wirkungslos'
);

$aufraeumen();

echo "OK  A: Belegt erbt von Unerreichbar -- die Reihenfolge jeder Fangkette haengt daran.\n";
echo "OK  B: die Vorgabe bleibt 'warten' -- Massenlaeufe sind unberuehrt.\n";
echo 'OK  C: ein belegter Platz sagt im Dialog SOFORT ab (' . number_format($gedauert, 3) . " s statt 20 s).\n";
echo "OK  D: die Absage nennt Grund und Wartezeit, gerechnet aus dem Crawl-delay.\n";
echo "OK  E: wer warten darf, ist eine Aufzaehlung -- Vorgabe ist 'nicht warten'.\n";
echo "OK  F: der Siedlungs-Endpunkt setzt den Schalter ueber die geteilte Regel.\n";
echo "OK  G: und er ist der EINZIGE Dialog mit Live-Abruf -- gemessen ueber die Aufrufkette.\n";
echo 'OK  I: auch die ANMELDUNG sagt sofort ab (' . number_format($gedauertPost, 3) . " s) -- der zweite Transport.\n";
echo "OK  J: und im Dialog wird gar nicht erst angemeldet -- sie dient nur der Stapelgroesse.\n";
echo "OK  H: bei belegtem Platz springt der Infobox-Vorrat ein, sonst niemand.\n";
