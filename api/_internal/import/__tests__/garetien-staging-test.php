<?php

declare(strict_types=1);

// Das Staging: Rohzeilen unveraendert ablegen, mit Lauf-ID.
//
// ⭐ Roh UND zerlegt nebeneinander -- aendert sich der Parser spaeter, kann man den Lauf neu
// zerlegen, ohne die Quelle erneut abzurufen. Volker sagt selbst, dass sich die Daten
// "mal aendern" koennen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-staging-test.php

require_once __DIR__ . '/../garetien-abruf.php';
require_once __DIR__ . '/../garetien-plan.php';

$pruefungen = 0;

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
$pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');

$runId = avesmapsGaretienStartRun($pdo);
assert($runId > 0);
$pruefungen++;

$html = '<div class="mw-parser-output">'
      . '<p>K:BEGIN Vorlage:KarteGewaesser</p>'
      . '<p>See:Garetien:Mühlsee!Mühlsee;4!14;;998 -12507, 1180 -12736</p>'
      . '<p>Bach:Nebenfluss der Natter;6!9;;10 20, 30 40</p>'
      . '</div>';
$anzahl = avesmapsGaretienStageSeite($pdo, $runId, 'ggp', 'Gewaesser', $html);
assert($anzahl === 2, 'zwei Datenzeilen, die Steuerzeile zaehlt nicht');
$pruefungen++;

// --- Die Rohzeile liegt UNVERAENDERT da.
$roh = $pdo->query("SELECT roh FROM garetien_import_row WHERE typ='See'")->fetchColumn();
assert($roh === 'See:Garetien:Mühlsee!Mühlsee;4!14;;998 -12507, 1180 -12736');
$pruefungen++;

// --- Zerlegt liegt sie daneben.
$z = $pdo->query("SELECT * FROM garetien_import_row WHERE typ='See'")->fetch(PDO::FETCH_ASSOC);
assert($z['namensraum'] === 'Garetien' && $z['artikel'] === 'Mühlsee');
assert($z['geo_art'] === 'koordinaten');
assert((int) $z['zeile_nr'] === 1, 'die Reihenfolge der Quelle bleibt erhalten');
$pruefungen += 3;

// --- 💣 Ein zweiter Lauf ueberschreibt den ersten NICHT.
$run2 = avesmapsGaretienStartRun($pdo);
avesmapsGaretienStageSeite($pdo, $run2, 'ggp', 'Gewaesser', $html);
$gesamt = (int) $pdo->query('SELECT COUNT(*) FROM garetien_import_row')->fetchColumn();
assert($gesamt === 4, 'beide Laeufe stehen nebeneinander, ' . $gesamt . ' gefunden');
$pruefungen++;

// --- 🔴 avesmapsGaretienListeLaeufe() ist neu (Review-Fund I1, 27.08.2026): der Endpunkt
// api/edit/map/garetien-import.php fragte die Laeufe frueher per rohem SELECT direkt ab, jetzt
// kapselt diese Funktion das SQL. Ein Quelltextvergleich haette nur belegt, dass das SQL gleich
// AUSSIEHT -- nicht, dass `fetchAll()` liefert, was der Endpunkt erwartet. Das COUNT() ueber den
// LEFT JOIN ist genau der Teil, den kein Quelltextvergleich pruefen kann: geprueft wird deshalb
// ein dritter, LEERER Lauf, damit der LEFT JOIN wirklich als LEFT JOIN belegt ist (ein INNER
// JOIN liesse diesen Lauf lautlos verschwinden).
$run3 = avesmapsGaretienStartRun($pdo);
$laeufe = avesmapsGaretienListeLaeufe($pdo);
assert(count($laeufe) === 3, 'alle drei Laeufe kommen zurueck, auch der leere: ' . count($laeufe));
assert(
    (int) $laeufe[0]['id'] === $run3 && (int) $laeufe[1]['id'] === $run2 && (int) $laeufe[2]['id'] === $runId,
    'absteigend nach id: ' . implode(',', array_column($laeufe, 'id'))
);
assert((int) $laeufe[0]['zeilen'] === 0, 'der leere Lauf zaehlt 0 -- der LEFT JOIN darf ihn nicht verschlucken');
assert((int) $laeufe[1]['zeilen'] === 2, 'run2 traegt seine zwei gestageten Zeilen');
assert((int) $laeufe[2]['zeilen'] === 2, 'runId traegt seine zwei gestageten Zeilen');
$pruefungen += 5;

// --- Alle 18 Ebenen sind eingetragen, mit Adresse.
assert(count(AVESMAPS_GARETIEN_EBENEN) === 18, 'Volker hat 18 Seiten angelegt');
$ggp = array_filter(AVESMAPS_GARETIEN_EBENEN, static fn(array $e): bool => $e['wiki'] === 'ggp');
$kos = array_filter(AVESMAPS_GARETIEN_EBENEN, static fn(array $e): bool => $e['wiki'] === 'kosch');
assert(count($ggp) === 12 && count($kos) === 6);
foreach (AVESMAPS_GARETIEN_EBENEN as $e) {
    assert(str_starts_with($e['url'], 'https://'), 'jede Ebene braucht eine vollstaendige Adresse');
}
$pruefungen += 3;

// --- 💣 DIE HOEFLICHKEITSPAUSE STEHT IM ABRUFER, NICHT IN DER SCHLEIFE DES AUFRUFERS.
// Es ist ein fremder Server, und wir haben dort um Erlaubnis gefragt. Eine Pause in der
// Schleife ueberspringt jeder zweite Erzeuger -- die Probe, ein Wiederholversuch, ein
// spaeterer Einzelabruf. Dieselbe Lehre, wegen der die Wiki-Drossel aus `sync.php`
// herausgeloest wurde: eine Regel, die nur ein Teil der Erzeuger aufrufen KANN, ist keine.
// 🪤 Kommentare heraus, bevor am Code geprueft wird -- sonst schlaegt die Zusicherung an dem
// Satz an, der die Regel erklaert, und der naechste Leser loescht den Kommentar.
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
            $stuecke[] = $token[1];
            continue;
        }
        $stuecke[] = $token;
    }
    return implode('', $stuecke);
};

$bibliothek = $nurCode(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-abruf.php')));
assert(AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN > 0, 'es gibt ueberhaupt eine Pause');
$holer = substr($bibliothek, (int) strpos($bibliothek, 'function avesmapsGaretienHoleSeite'));
$holer = substr($holer, 0, (int) strpos($holer, "\nfunction "));
assert(str_contains($holer, 'usleep('), 'die Pause sitzt im Abrufer selbst');
assert(str_contains($holer, 'AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN'), 'und nimmt die eine Konstante');
$pruefungen += 3;

// --- Und der Endpunkt baut KEINE zweite Pause daneben. Zwei Pausen nebeneinander waeren keine
// Regel, sondern zwei Meinungen ueber dieselbe Frage.
$endpunkt = $nurCode(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php')));
assert(!str_contains($endpunkt, 'usleep(') && !str_contains($endpunkt, 'sleep('), 'der Endpunkt pausiert nicht selbst');
$pruefungen++;

// --- 🔴 Ein Fehlabruf WIRFT und liefert nie einen leeren String. Eine leere Seite liefe
// klaglos durch avesmapsGaretienStageSeite() -- und ein Lauf mit null Zeilen sieht genauso aus
// wie "die Seite ist leer". Genau diese Verwechslung liess im Haus schon einen Endpunkt
// `ok:true` mit leerem Inhalt antworten, fuer den Betrachter nicht von "hier liegt nichts"
// zu unterscheiden.
assert(substr_count($holer, 'throw new RuntimeException') >= 3, 'jeder Fehlerweg des Abrufers wirft');
assert(!preg_match("/return\s+''\s*;/", $holer), 'kein Rueckfall auf den leeren String');
$pruefungen += 2;

// --- 🔴 Die Probe schreibt in KEINE Tabelle. Eine Probe, die staget, ist keine Probe: sie
// liesse einen halben Lauf zurueck, den danach niemand von einem echten unterscheiden kann.
$probe = substr($bibliothek, (int) strpos($bibliothek, 'function avesmapsGaretienProbe'));
assert(!str_contains($probe, 'INSERT') && !str_contains($probe, 'avesmapsGaretienStageSeite'), 'die Probe staget nichts');
assert(!str_contains($probe, 'avesmapsGaretienStartRun'), 'die Probe legt keinen Lauf an');
$pruefungen += 2;

// --- Die 18 Adressen zeigen auf GENAU ZWEI Wirte, und beide sind die zugesagten.
$wirte = [];
foreach (AVESMAPS_GARETIEN_EBENEN as $e) {
    $wirte[(string) parse_url($e['url'], PHP_URL_HOST)] = true;
}
assert(array_keys($wirte) === ['www.garetien.de', 'www.koschwiki.de'], 'zwei feste Wirte, ' . implode(', ', array_keys($wirte)));
$pruefungen++;

// =================================================================================================
// AUFGABE 6: Urteil und Grund ueberleben das Rechnen (27.08.2026).
// =================================================================================================

// --- 🔴 DIE ZUSICHERUNG, DIE RULING P1 VERLANGT: der Spalten-Nachzug muss an einer BESTEHENDEN
// Tabelle wirklich laufen, nicht nur an einer frisch angelegten, die die Spalten schon traegt.
// Diese Tabelle hier hat GENAU die Form, die live vor dem 27.08.2026 stand -- ohne urteil/grund.
$bestand = new PDO('sqlite::memory:');
$bestand->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$bestand->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');
$bestand->exec("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, geo_art, geo, roh) VALUES (1, 'ggp', 'Gewaesser', 1, 'Bach', 'koordinaten', '1 2', 'Bach:Alke')");
// Vor dem Nachzug gibt es die Spalten nicht -- ein Zugriff darauf muss scheitern.
$vorherWirftFehler = false;
try {
    $bestand->query('SELECT urteil FROM garetien_import_row')->fetch();
} catch (PDOException) {
    $vorherWirftFehler = true;
}
assert($vorherWirftFehler, 'die Vorbedingung des Belegs: die Spalte darf VORHER noch nicht da sein');
$pruefungen++;

avesmapsGaretienEnsureUrteilSpalten($bestand);
$zeileNachNachzug = $bestand->query('SELECT urteil, grund FROM garetien_import_row WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
assert($zeileNachNachzug['urteil'] === '', 'die bestehende Zeile bekommt den Vorgabewert, nicht NULL');
assert($zeileNachNachzug['grund'] === '', 'auch der Grund startet leer, nicht NULL');
$pruefungen += 2;

// 💣 Ein zweiter Aufruf (der Normalfall ab dem zweiten Prozess-Start) darf NICHT werfen -- der
// Duplikat-Fehler wird geschluckt, kein information_schema-Vorabtest.
$zweiterAufrufWirftNicht = true;
try {
    avesmapsGaretienEnsureUrteilSpalten($bestand);
} catch (PDOException) {
    $zweiterAufrufWirftNicht = false;
}
assert($zweiterAufrufWirftNicht, 'der Nachzug ist idempotent -- ein zweiter Aufruf darf nicht werfen');
$pruefungen++;

// Und die Spalte ist wirklich SCHREIBBAR, nicht nur lesbar.
$bestand->exec("UPDATE garetien_import_row SET urteil = 'deckt_sich', grund = 'Beleg' WHERE id = 1");
$geschrieben = $bestand->query('SELECT urteil, grund FROM garetien_import_row WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
assert($geschrieben['urteil'] === 'deckt_sich' && $geschrieben['grund'] === 'Beleg', 'die nachgezogene Spalte ist beschreibbar');
$pruefungen++;

// --- Das Urteil ueberlebt das Rechnen. Ohne die zwei Spalten sind die 49 "deckt sich" und die 6
// "uebersprungen" nach dem Plan-Lauf nicht mehr auffindbar -- sie erzeugen keinen sync_plan_item,
// und ihr Grund stand nur im Arbeitsspeicher.
//
// 💣 REVIEW C1 (Critical): `zeile_nr` beginnt je SEITE neu bei 1 (avesmapsGaretienStageSeite),
// und ein Lauf traegt mehrere Seiten -- also NIE per zeile_nr allein nachschlagen, sondern immer
// ueber (wiki, ebene, zeile_nr). Die Fixture bildet genau diese Kollision ab: die Alke
// (ggp/Gewaesser/1) und der Kontinent (kosch/Gewaesser/1) TEILEN sich die Nummer 1. Ein zeile_nr-
// keyed Dictionary wie zuvor wuerde diese Kollision lautlos verschlucken (der zweite Treffer
// ueberschreibt den ersten) -- genau die Blindheit, die Review C1 dem alten Test vorgehalten hat.
// Nachgeschlagen wird deshalb ab hier explizit ueber wiki+ebene+zeile_nr.
// 🔴 Die Fixture-Zeile hiess bis zum 29.08.2026 'Insel' -- seither ist Insel zugeordnet (Entwurf
// §3.4) und daher hier durch 'Kontinent' ersetzt (garetien-plan.php), das weiterhin
// verlaesslich uebersprungen wird (AVESMAPS_GARETIEN_OHNE_GEGENSTUECK).
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$zeileSuchen = static function (PDO $pdo, string $wiki, string $ebene, int $zeileNr) {
    $stmt = $pdo->prepare(
        'SELECT zeile_nr, urteil, grund FROM garetien_import_row'
        . ' WHERE run_id = 1 AND wiki = :w AND ebene = :e AND zeile_nr = :n'
    );
    $stmt->execute([':w' => $wiki, ':e' => $ebene, ':n' => $zeileNr]);

    return $stmt->fetch(PDO::FETCH_ASSOC);
};

$alke = $zeileSuchen($pdo, 'ggp', 'Gewaesser', 1);
$gardel = $zeileSuchen($pdo, 'ggp', 'Gewaesser', 2);
$llavari = $zeileSuchen($pdo, 'ggp', 'Gewaesser', 4);
$kontinent = $zeileSuchen($pdo, 'kosch', 'Gewaesser', 1);

assert($alke['urteil'] === 'deckt_sich', 'die Alke deckt sich und muss es auch nachher sagen');
assert($alke['grund'] !== '', 'ein Urteil ohne Grund ist eine Zahl, die niemand pruefen kann');
assert($gardel['urteil'] === 'neu', 'der Gardel ist neu');
// 🔴 SEIT 30.08.2026 WIRD DER SAMMELARTIKEL NICHT MEHR UEBERSPRUNGEN (Owner: „warum sollte ich
// sagen nicht importieren können nur weil sie außerhalb von irgendwas sind?"). Er bekommt jetzt
// ein echtes Urteil wie jede andere Zeile -- und dass er ueberhaupt EINES hat, ist die
// Zusicherung: ein leerer Urteilswert waere „gar nicht abgeglichen".
assert($llavari['urteil'] !== 'uebersprungen',
    'der Sammelartikel wird abgeglichen statt uebersprungen: ' . $llavari['urteil']);
assert($llavari['urteil'] !== '', 'und traegt ein echtes Urteil');
assert(!str_contains((string) $llavari['grund'], 'Sammelartikel'),
    'und keinen Sammelartikel-Grund mehr: ' . (string) $llavari['grund']);
$pruefungen += 5;

// --- 🔴 DIE EIGENTLICHE ZUSICHERUNG VON REVIEW C1: der Kontinent teilt sich (wiki, zeile_nr)
// NICHT mit der Alke -- sie unterscheiden sich nur ueber `wiki`. Ohne wiki+ebene im WHERE von
// avesmapsGaretienSchreibeUrteil haette EINES der beiden UPDATEs die Zeile des jeweils ANDEREN
// mitgetroffen (wer zuletzt gerechnet wird, gewinnt) -- ein Editor haette den Grund einer
// FREMDEN Zeile vorgelegt bekommen. Beide Seiten der Kollision werden hier einzeln belegt.
assert($kontinent['urteil'] === 'uebersprungen', 'der Kontinent hat kein Gegenstueck und darf NICHT das Urteil der Alke tragen');
// 🔴 Owner-Meldung 29.08.2026: der Grund nennt keine Stufe mehr -- geprueft wird auf ihren
// eigenen Typnamen, nicht auf ein Wort, das die alte Formulierung zufaellig auch enthielt.
assert(str_contains($kontinent['grund'], 'Kontinent'), 'der Grund des Kontinents muss ihr EIGENER sein, nicht der Alke-Grund: ' . $kontinent['grund']);
assert($kontinent['grund'] !== $alke['grund'], 'zwei Zeilen mit derselben Nummer duerfen sich nicht denselben Grund teilen');
$pruefungen += 3;

// 🔴 Der Plan-Lauf schreibt in KEINE Nutztabelle -- nur in sein EIGENES Staging.
$vorherFeatures = $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === (int) $vorherFeatures,
    'das Rechnen hat eine Nutztabelle angefasst');
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
