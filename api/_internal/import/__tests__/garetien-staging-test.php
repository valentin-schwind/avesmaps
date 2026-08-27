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

echo "OK: {$pruefungen} Pruefungen\n";
