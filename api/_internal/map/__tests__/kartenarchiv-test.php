<?php

declare(strict_types=1);

/**
 * Das Kartenarchiv hinter dem Editor-Login.
 * Entwurf: docs/superpowers/specs/2026-08-23-kartenarchiv-und-svg-fuer-editoren-design.md
 *
 * Geprueft wird, was tatsaechlich danebengehen kann -- nicht, dass die Datei existiert:
 *   1. Der PFAD-AUSBRUCH. Der Dateiname kommt vom Client.
 *   2. Die RANGE-RECHNUNG. Sie ist rein, damit sie hier ohne Server prueffbar ist -- bei
 *      1,73 GB ist Fortsetzen die Voraussetzung dafuer, dass ein Download je ankommt.
 *   3. „EINE Zeile je Download, nicht je Anfrage."
 *   4. Die zwei Riegel duerfen nicht zusammenrutschen: SVG-Export `edit`, Backup `admin`.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/kartenarchiv-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 4);
require_once $repoRoot . '/api/_internal/map/kartenarchiv.php';

$fehler = 0;
$zusicherungen = 0;
function pruefe(string $was, bool $ok): void
{
    global $fehler, $zusicherungen;
    $zusicherungen++;
    if (!$ok) {
        $fehler++;
        echo "  FEHLER  {$was}\n";
    }
}

// ================================================================================================
// 1 · Der Pfad-Ausbruch
// ================================================================================================
//
// 💣 Drei Riegel, und jeder faengt etwas, das die anderen durchlassen. Diese Liste ist der Grund,
// warum der Name nicht einfach an den Ordner geklebt wird.

$sandkasten = sys_get_temp_dir() . '/avesmaps-kartenarchiv-test-' . getmypid();
@mkdir($sandkasten, 0777, true);
file_put_contents($sandkasten . '/avesmaps_aventurien_v2.05.zip', str_repeat('A', 100));
file_put_contents($sandkasten . '/avesmaps_aventurien_tiles_v2.05.zip', str_repeat('B', 40));
file_put_contents($sandkasten . '/liesmich.txt', 'kein Archiv');
file_put_contents($sandkasten . '/.versteckt.zip', 'X');
@mkdir($sandkasten . '/unterordner.zip');
// Das Ziel, das ein Ausbruch treffen wollen wuerde -- eine Ebene ueber dem Ordner.
file_put_contents(dirname($sandkasten) . '/avesmaps-geheim-' . getmypid() . '.zip', 'GEHEIM');

$boese = [
    '../avesmaps-geheim-' . getmypid() . '.zip' => 'ein Elternverzeichnis',
    '../../api/config.local.php' => 'der Weg zur Konfiguration',
    '/etc/passwd' => 'ein absoluter Pfad',
    'liesmich.txt' => 'eine Datei ohne .zip',
    '.versteckt.zip' => 'ein Punktname',
    '.zip' => 'nur die Endung',
    '' => 'der leere Name',
    'unterordner.zip' => 'ein Ordner mit passender Endung',
    'gibtsnicht.zip' => 'ein Name, zu dem nichts liegt',
];
foreach ($boese as $name => $was) {
    pruefe('abgewiesen: ' . $was, avesmapsKartenarchivPfad($name, $sandkasten) === null);
}

// 🪤 UND DER FALL, DEN DIE LISTE OBEN NICHT ABDECKT -- gefunden durch Mutation, nicht durch Lesen:
// jeder Eintrag darueber faellt schon an Riegel 1 (`basename`) oder 2 (Endung). Riegel 3, die
// Eingrenzung auf den Ordner, blieb dabei UNGEPRUEFT: der Test war gruen, auch als sie abgeschaltet
// war. Sie gilt allein dem Symlink -- einem Namen, der die ersten beiden Riegel sauber besteht und
// trotzdem aus dem Ordner herausfuehrt.
$symlinkZiel = dirname($sandkasten) . '/avesmaps-geheim-' . getmypid() . '.zip';
$symlink = $sandkasten . '/harmlos.zip';
$symlinkGebaut = @symlink($symlinkZiel, $symlink);
if ($symlinkGebaut) {
    pruefe('abgewiesen: ein Symlink, der aus dem Ordner herausfuehrt',
        avesmapsKartenarchivPfad('harmlos.zip', $sandkasten) === null);
    @unlink($symlink);
} else {
    // ⚠️ Windows erlaubt symlink() nur mit erhoehten Rechten. Das WIRD gemeldet statt still
    // uebersprungen: eine Zusicherung, die lautlos ausfaellt, ist keine.
    echo "  HINWEIS Riegel 3 (Symlink) hier nicht pruefbar -- symlink() nicht erlaubt. Auf Linux laeuft er.\n";
}

// Und die Gegenprobe -- ohne sie beweist die Liste oben nur, dass die Funktion immer null sagt.
// 💣 Genau diese Zeile fehlt in Tests, die „alles wird abgewiesen" gruen melden.
$echt = avesmapsKartenarchivPfad('avesmaps_aventurien_v2.05.zip', $sandkasten);
pruefe('ein echtes Archiv kommt durch', $echt !== null && is_file($echt));
pruefe('und es ist die richtige Datei', $echt !== null && filesize($echt) === 100);

// ================================================================================================
// 2 · Die Liste
// ================================================================================================
//
// 💣 Sie ist GERECHNET, nicht geschrieben. Ein hartkodiertes „v2.05" waere nach dem naechsten
// Kartenexport ein toter Verweis -- dieselbe Ueberlegung, mit der die .htaccess des Ordners nach
// ENDUNG statt nach Dateinamen sperrt.

$liste = avesmapsKartenarchivListe($sandkasten);
pruefe('genau die zwei ZIPs, nichts sonst', count($liste) === 2);
pruefe('nach Namen sortiert (tiles vor aventurien_v)',
    ($liste[0]['name'] ?? '') === 'avesmaps_aventurien_tiles_v2.05.zip');
pruefe('die Groesse reist mit', ($liste[0]['size'] ?? 0) === 40);
pruefe('kein .txt in der Liste',
    !in_array('liesmich.txt', array_column($liste, 'name'), true));
pruefe('kein Ordner in der Liste',
    !in_array('unterordner.zip', array_column($liste, 'name'), true));

// ⚠️ Ein leerer oder fehlender Ordner ist ein GUELTIGES Ergebnis, keine Ausnahme: die Seite sagt
// dann „kein Archiv gefunden". Das ist die Selbstdiagnose fuer den Fall, dass die Dateien auf dem
// Server woanders liegen als hier angenommen (offener Punkt §8 des Entwurfs).
pruefe('ein Ordner, den es nicht gibt, ergibt eine leere Liste',
    avesmapsKartenarchivListe($sandkasten . '/gibtsnicht') === []);

// ================================================================================================
// 3 · Die Range-Rechnung
// ================================================================================================
//
// 💣 Rein, und deshalb hier ohne HTTP und ohne Datei geprueft. Eine Rechnung, die man nur mit
// laufendem Server pruefen kann, wird nie geprueft.

$G = 100; // Dateigroesse fuer alle Faelle darunter.
$faelle = [
    // Kopf                  erwartet: status, start, ende
    [null,                   200, 0,  99, 'kein Kopf -> ganze Datei'],
    ['',                     200, 0,  99, 'leerer Kopf -> ganze Datei'],
    ['bytes=0-',             206, 0,  99, 'ab null -> Teilantwort ueber alles'],
    ['bytes=10-19',          206, 10, 19, 'ein Fenster in der Mitte'],
    ['bytes=90-',            206, 90, 99, 'der Rest ab 90 -- der Fortsetzen-Fall'],
    ['bytes=99-99',          206, 99, 99, 'das letzte Byte'],
    ['bytes=-10',            206, 90, 99, 'Suffix: die letzten zehn'],
    ['bytes=-500',           206, 0,  99, 'ein zu grosses Suffix wird gekappt, nicht abgelehnt'],
    ['bytes=0-99999',        206, 0,  99, 'ein Ende jenseits der Datei wird GEKAPPT'],
    ['bytes= 10 - 19 ',      206, 10, 19, 'Leerzeichen im Kopf stoeren nicht'],
    ['BYTES=10-19',          206, 10, 19, 'die Einheit wird ohne Ruecksicht auf Gross/Klein gelesen'],
];
foreach ($faelle as [$kopf, $status, $start, $ende, $was]) {
    $b = avesmapsKartenarchivRange($kopf, $G);
    pruefe('Range ' . $was, $b['status'] === $status && $b['start'] === $start && $b['end'] === $ende);
    // 💣 Die Laenge MUSS zum Bereich passen: sie wird als Content-Length ausgeliefert, und weicht
    // sie vom Rumpf ab, ist der Download lautlos kaputt statt sichtbar fehlgeschlagen.
    pruefe('Range ' . $was . ' -- Laenge passt zum Bereich',
        $b['length'] === $b['end'] - $b['start'] + 1);
}

// Unerfuellbar -> 416. Der Endpunkt antwortet dann mit `Content-Range: bytes * /<size>`.
foreach ([
    'bytes=100-'   => 'der Anfang liegt hinter dem Dateiende',
    'bytes=200-300' => 'der ganze Bereich liegt dahinter',
    'bytes=50-40'  => 'das Ende liegt vor dem Anfang',
    'bytes=-0'     => 'ein Suffix von null Bytes verlangt nichts',
    'bytes=-'      => 'beide Seiten leer',
    'bytes=abc'    => 'gar keine Zahlen',
] as $kopf => $was) {
    pruefe('416: ' . $was, avesmapsKartenarchivRange($kopf, $G)['status'] === 416);
}

// ⚠️ Eine unbekannte EINHEIT wird nach RFC 9110 ignoriert -- ganze Datei, nicht 416. 416 waere die
// Behauptung, der Wunsch sei unerfuellbar; er ist unverstanden.
pruefe('eine fremde Einheit -> ganze Datei, nicht 416',
    avesmapsKartenarchivRange('items=0-10', $G)['status'] === 200);
// ⚠️ Mehrteilige Bereiche ebenso: die ganze Datei ist eine erlaubte Antwort und spart die
// multipart/byteranges-Maschinerie, die kein Downloader braucht.
pruefe('mehrteilige Bereiche -> ganze Datei',
    avesmapsKartenarchivRange('bytes=0-9,20-29', $G)['status'] === 200);
// Eine leere Datei hat keinen Bereich, den man verlangen koennte.
pruefe('leere Datei mit Range -> 416', avesmapsKartenarchivRange('bytes=0-', 0)['status'] === 416);
pruefe('leere Datei ohne Range -> 200 mit Laenge 0',
    avesmapsKartenarchivRange(null, 0) === ['status' => 200, 'start' => 0, 'end' => 0, 'length' => 0]);

// ================================================================================================
// 4 · „Eine Zeile je DOWNLOAD, nicht je Anfrage"
// ================================================================================================
//
// 💣 Ein Downloader mit Fortsetzen stellt Dutzende Anfragen fuer EINEN Download. Jede zu
// protokollieren machte aus dem Beleg eine Wolke -- und verdraengte ueber die Kappung genau die
// Zeilen, fuer die die Tabelle da ist.

pruefe('ohne Range zaehlt als Start',
    avesmapsKartenarchivIstDownloadStart(avesmapsKartenarchivRange(null, $G)));
pruefe('ein Bereich ab Byte 0 zaehlt als Start',
    avesmapsKartenarchivIstDownloadStart(avesmapsKartenarchivRange('bytes=0-', $G)));
pruefe('eine Fortsetzung ab der Mitte zaehlt NICHT',
    !avesmapsKartenarchivIstDownloadStart(avesmapsKartenarchivRange('bytes=50-', $G)));
pruefe('ein Suffix zaehlt NICHT',
    !avesmapsKartenarchivIstDownloadStart(avesmapsKartenarchivRange('bytes=-10', $G)));
pruefe('eine unerfuellbare Anfrage zaehlt NICHT',
    !avesmapsKartenarchivIstDownloadStart(avesmapsKartenarchivRange('bytes=999-', $G)));

// Und der Ablauf eines echten Fortsetzen-Downloads: EIN Start, viele Fortsetzungen -> EINE Zeile.
$verlauf = ['bytes=0-', 'bytes=25-', 'bytes=60-', 'bytes=88-'];
$starts = 0;
foreach ($verlauf as $kopf) {
    if (avesmapsKartenarchivIstDownloadStart(avesmapsKartenarchivRange($kopf, $G))) {
        $starts++;
    }
}
pruefe('vier Anfragen eines abbrechenden Downloads ergeben genau EINEN Beleg', $starts === 1);

// ================================================================================================
// 4b · Die Stream-Schleife -- AUSGEFUEHRT, nicht gelesen
// ================================================================================================
//
// 💣 Der Fall, um den es geht: bei einem Teilbereich liegt das Dateiende HINTER dem Bereichsende.
// Eine Schleife, die bis `feof` laeuft, schiebt den Rest der Datei hinterher -- die ausgelieferte
// Content-Length und der Rumpf gehen auseinander, und das Ergebnis ist ein lautlos kaputtes ZIP.
// Es gibt keine Fehlermeldung dafuer; es faellt erst beim Entpacken auf.
//
// ⚠️ Der Inhalt ist eine Bytefolge, in der jede Position anders aussieht. Mit `str_repeat('A', …)`
// waere jeder Bereich derselben Laenge identisch -- der Test koennte einen VERSCHOBENEN Bereich
// nicht von einem richtigen unterscheiden.
$streamDatei = $sandkasten . '/stream.bin';
$inhalt = '';
for ($i = 0; $i < 1000; $i++) {
    $inhalt .= chr(65 + ($i % 26));
}
file_put_contents($streamDatei, $inhalt);

/** Faehrt die echte Schleife und gibt zurueck, was wirklich herausgekommen ist. */
function kartenarchivStreamProbe(string $datei, array $bereich): string
{
    $handle = fopen($datei, 'rb');
    if ($bereich['start'] > 0) {
        fseek($handle, $bereich['start']);
    }
    ob_start();
    avesmapsKartenarchivStream($handle, $bereich['length']);
    $ausgabe = (string) ob_get_clean();
    fclose($handle);

    return $ausgabe;
}

foreach ([
    [null,            'ohne Range: die ganze Datei'],
    ['bytes=0-',      'ab null'],
    ['bytes=0-9',     'die ersten zehn -- der Fall, der bis EOF laufen wuerde'],
    ['bytes=30-39',   'ein Fenster in der Mitte'],
    ['bytes=990-',    'der Rest ab 990 -- der Fortsetzen-Fall'],
    ['bytes=-10',     'die letzten zehn'],
    ['bytes=999-999', 'genau ein Byte am Ende'],
    ['bytes=0-998',   'alles ausser dem letzten Byte'],
] as [$kopf, $was]) {
    $b = avesmapsKartenarchivRange($kopf, strlen($inhalt));
    $ausgabe = kartenarchivStreamProbe($streamDatei, $b);
    $erwartet = substr($inhalt, $b['start'], $b['length']);
    pruefe('Stream ' . $was . ' -- Byte fuer Byte richtig', $ausgabe === $erwartet);
    // 💣 Und die Laenge einzeln: sie ist der Wert, der als Content-Length hinausging. Weicht der
    // Rumpf ab, ist der Download kaputt, ohne dass irgendetwas einen Fehler meldet.
    pruefe('Stream ' . $was . ' -- so lang wie die angekuendigte Content-Length',
        strlen($ausgabe) === $b['length']);
}

// ⚠️ Und ueber die Haeppchengrenze hinweg: bis hierher passte jeder Fall in EINEN fread(). Die
// Schleife hat damit nie mehr als eine Runde gedreht -- geprueft war der Zaehler, nicht das Zaehlen.
$grossDatei = $sandkasten . '/gross.bin';
$grossInhalt = str_repeat($inhalt, 700); // 700.000 Byte = knapp drei Haeppchen a 256 KB
file_put_contents($grossDatei, $grossInhalt);
$bGross = avesmapsKartenarchivRange('bytes=100000-599999', strlen($grossInhalt));
$ausgabeGross = kartenarchivStreamProbe($grossDatei, $bGross);
pruefe('Stream ueber mehrere Haeppchen: 500.000 Byte, nicht 600.000',
    strlen($ausgabeGross) === 500000);
pruefe('Stream ueber mehrere Haeppchen: und der richtige Ausschnitt',
    $ausgabeGross === substr($grossInhalt, 100000, 500000));

// ================================================================================================
// 5 · Die Groessenangabe
// ================================================================================================
//
// 💣 Die zwei Zahlen sind die ECHTEN Dateigroessen, und die Texte daneben stehen woertlich so in
// Befund A25 und in NOTICE.md-naher Doku. Eine Seite, die ploetzlich „169 MB" sagt, widerspricht
// der eigenen Aktenlage -- deshalb 1024er-Stufen, obwohl die Einheit „MB"/„GB" heisst.

pruefe('168.647.049 Byte heissen „161 MB"', avesmapsKartenarchivGroesse(168647049) === '161 MB');
pruefe('1.855.789.721 Byte heissen „1,73 GB"', avesmapsKartenarchivGroesse(1855789721) === '1,73 GB');
pruefe('kleine Zahlen bleiben Byte', avesmapsKartenarchivGroesse(512) === '512 Byte');

// ================================================================================================
// 6 · Der Schreibweg: genau ein INSERT, und die Kappung feuert
// ================================================================================================
//
// ⚠️ Ein Double statt SQLite, mit Absicht: das DDL ist MySQL-Form (BIGINT UNSIGNED, ENGINE=InnoDB,
// DATETIME(3)). Es fuer eine SQLite-Fixture zu verbiegen hiesse, die Produktionsform gegen den Test
// zu drehen -- die Lehre aus dem MySQL-Fehler 1093 vom 16.08.2026.

final class KartenarchivFakeStmt extends PDOStatement
{
    private array $gebunden = [];

    public function __construct(private string $sql, private KartenarchivFakePdo $pdo)
    {
    }

    #[\ReturnTypeWillChange]
    public function bindValue($param, $value, $type = PDO::PARAM_STR): bool
    {
        $this->gebunden[$param] = $value;

        return true;
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $this->gebunden = (array) ($params ?? $this->gebunden);
        $this->pdo->sql[] = $this->sql;
        if (stripos($this->sql, 'INSERT INTO map_archive_download') !== false) {
            $this->pdo->eingefuegt[] = $this->gebunden;
        }

        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        // Der Aufraeumer liest zwei Schwellen, bevor er loescht: die id der N-juengsten Zeile
        // (ORDER BY id DESC) und die id nach den ersten $maxDelete von unten (ORDER BY id ASC).
        // Beide muessen eine Zahl liefern, sonst kehrt er vorzeitig um und die Kappung ist in
        // diesem Test unbeobachtbar -- ein gruener Test ueber eine Grenze, die nie feuert.
        if (stripos($this->sql, 'ORDER BY id DESC') !== false) {
            return 900;
        }
        if (stripos($this->sql, 'ORDER BY id ASC') !== false) {
            return 400;
        }

        return false;
    }

    #[\ReturnTypeWillChange]
    public function rowCount(): int
    {
        return 0;
    }
}

final class KartenarchivFakePdo extends PDO
{
    /** @var list<string> */
    public array $sql = [];
    /** @var list<array> */
    public array $eingefuegt = [];

    public function __construct()
    {
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $this->sql[] = (string) $statement;

        return 0;
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        $this->sql[] = (string) $query;

        return new KartenarchivFakeStmt((string) $query, $this);
    }
}

$fake = new KartenarchivFakePdo();
avesmapsKartenarchivProtokollieren($fake, 7, 'valentin', 'avesmaps_aventurien_v2.05.zip', 1855789721);

pruefe('genau EINE Protokollzeile je Aufruf', count($fake->eingefuegt) === 1);
$zeile = $fake->eingefuegt[0] ?? [];
pruefe('der Name steht MIT in der Zeile (ein geloeschter Benutzer macht den Beleg nicht unlesbar)',
    ($zeile['actor_name'] ?? '') === 'valentin');
pruefe('die Datei steht in der Zeile',
    ($zeile['file_name'] ?? '') === 'avesmaps_aventurien_v2.05.zip');
pruefe('und ihre Groesse', (int) ($zeile['file_size'] ?? 0) === 1855789721);

$allesSql = implode("\n", $fake->sql);
pruefe('die Tabelle heilt sich selbst (CREATE TABLE IF NOT EXISTS)',
    stripos($allesSql, 'CREATE TABLE IF NOT EXISTS map_archive_download') !== false);
// 💣 Die Kappung ab dem ERSTEN Tag. Eine unsichtbare Tabelle ohne Grenze ist genau das, was am
// 18.08.2026 die Datenbank in STRATOs 2-GB-Grenze gefahren und schreibgesperrt hat.
pruefe('der Aufraeumer laeuft mit (DELETE ueber die Protokolltabelle)',
    stripos($allesSql, 'DELETE FROM map_archive_download') !== false);
pruefe('map_archive_download steht in der WEITEN Positivliste des Aufraeumers',
    in_array('map_archive_download', AVESMAPS_AUDIT_PRUNE_CAPPABLE_TABLES, true));
// 💣 UND NICHT IN DER ENGEN. Die traegt „200 je Person ueber ALLE Protokolle zusammen"
// (Owner 22.08.2026). Stuende die Downloadtabelle dort, verdraengte ein geholtes Kartenarchiv
// einem Editor einen seiner 200 Aenderungsschritte -- und der Trichter der Aenderungen zaehlte
// Downloads mit, also wieder eine Zahl, die die Liste darunter nicht haelt. Genau der Befund,
// wegen dessen die Regel am 22.08. entstanden ist.
pruefe('und NICHT in der engen -- die 200 je Person gehoeren den Aenderungen',
    !in_array('map_archive_download', AVESMAPS_AUDIT_PRUNE_TABLES, true));
// 🪤 UND DIE TABELLE, DIE ES NICHT GEWORDEN IST. map_audit_log ist ein 200-Zeilen-Rollpuffer, aus
// dem das Rueckgaengigmachen seine Schritte nimmt (696 neue Zeilen am Tag, gemessen 18.08.2026).
// Eine Download-Zeile dort waere binnen Stunden weg UND haette vorher einen Undo-Schritt genommen.
pruefe('das Kartenarchiv fasst map_audit_log NICHT an',
    stripos($allesSql, 'map_audit_log') === false);

// ================================================================================================
// 7 · Die zwei Riegel duerfen nicht zusammenrutschen
// ================================================================================================
//
// 💣 Gemessen wird der CODE, nicht die Prosa: in diesen Dateien erklaeren die Kommentare genau das,
// wonach gesucht wird, und ein Treffer dort ist die haeufigste Art, einen gruenen Test zu bauen,
// der nichts haelt. Herausgetrennt wird mit PHPs eigenem Tokenizer -- exakt, statt per Regex.

function kartenarchivOhneKommentare(string $pfad): string
{
    $roh = (string) file_get_contents($pfad);
    $text = '';
    foreach (token_get_all($roh) as $token) {
        if (is_array($token)) {
            if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                continue;
            }
            $text .= $token[1];
            continue;
        }
        $text .= $token;
    }

    return $text;
}

$svgSeite = kartenarchivOhneKommentare($repoRoot . '/edit/svg-export.php');
$backupSeite = kartenarchivOhneKommentare($repoRoot . '/edit/backup.php');
$endpunkt = kartenarchivOhneKommentare($repoRoot . '/api/edit/map/kartenarchiv.php');

pruefe('der SVG-Export verlangt `edit`', str_contains($svgSeite, "avesmapsUserCan(\$currentUser, 'edit')"));
pruefe('und nirgends mehr `admin`', !str_contains($svgSeite, "'admin'"));
// 🔴 Der Nachbar bleibt, wo er war: ein voller Dump traegt users.password_hash.
pruefe('das Datenbank-Backup verlangt weiterhin `admin`', str_contains($backupSeite, "'admin'"));
pruefe('und nicht etwa `edit`', !str_contains($backupSeite, "avesmapsUserCan(\$currentUser, 'edit')"));

pruefe('der Archiv-Endpunkt verlangt `edit`',
    str_contains($endpunkt, "avesmapsRequireUserWithCapability('edit')"));
// 💣 Die Reihenfolge ist der Riegel: wird die Datei vor der Pruefung geoeffnet, ist die Pruefung
// Dekoration. Gemessen an den Zeichenpositionen, nicht an der blossen Anwesenheit beider.
pruefe('und zwar VOR dem ersten Dateizugriff',
    strpos($endpunkt, "avesmapsRequireUserWithCapability('edit')") < strpos($endpunkt, 'fopen('));
// 🔴 Die .htaccess-Sperre bleibt der Riegel fuer alle anderen: gelesen wird aus dem DATEISYSTEM.
// Ein Weiterleiten auf die oeffentliche Adresse waere genau der nackte Link, den Befund A25
// abgestellt hat.
pruefe('der Endpunkt leitet nicht auf uploads/map/ weiter',
    !str_contains($endpunkt, 'uploads/map'));

// Und die Seite, die den Riegel bedient, darf ihn nicht umgehen.
pruefe('die SVG-Seite verlinkt den Endpunkt, nicht die Datei',
    str_contains($svgSeite, '/api/edit/map/kartenarchiv.php?datei='));
pruefe('die SVG-Seite verlinkt NICHT nach uploads/map/',
    !str_contains($svgSeite, 'uploads/map/avesmaps'));
// 💣 Kein hartkodiertes v2.05: die Liste ist gerechnet. Ein Name im Markup waere nach dem naechsten
// Kartenexport ein toter Verweis, und niemandem fiele auf, warum.
pruefe('kein hartkodierter Archivname im Markup', !str_contains($svgSeite, 'avesmaps_aventurien_'));

// ---- Aufraeumen -------------------------------------------------------------------------------
@unlink(dirname($sandkasten) . '/avesmaps-geheim-' . getmypid() . '.zip');
foreach (['avesmaps_aventurien_v2.05.zip', 'avesmaps_aventurien_tiles_v2.05.zip', 'liesmich.txt', '.versteckt.zip'] as $name) {
    @unlink($sandkasten . '/' . $name);
}
@unlink($sandkasten . '/stream.bin');
@unlink($sandkasten . '/gross.bin');
@rmdir($sandkasten . '/unterordner.zip');
@rmdir($sandkasten);

if ($fehler > 0) {
    echo "kartenarchiv-test.php: {$fehler} von {$zusicherungen} Zusicherungen GERISSEN\n";
    exit(1);
}
echo "kartenarchiv-test.php: alle {$zusicherungen} Zusicherungen erfuellt\n";
exit(0);
