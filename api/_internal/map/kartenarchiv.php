<?php

declare(strict_types=1);

/**
 * Das Kartenarchiv -- die zwei ZIPs in uploads/map/, hinter dem Editor-Login.
 * ---------------------------------------------------------------------------
 * Entwurf: docs/superpowers/specs/2026-08-23-kartenarchiv-und-svg-fuer-editoren-design.md
 *
 * 🔴 WARUM ES DIESE DATEI ÜBERHAUPT GIBT, UND WAS SIE NICHT AUFWEICHEN DARF.
 * Befund A25 des Systemtests vom 05.08.2026: die Archive (161 MB Kacheln, 1,73 GB
 * Gesamtkarte) hingen ungeschützt im Hinweise-Fenster -- ausgerechnet in dem Absatz, der
 * die Fanregel-Bindung erklärt, und NOTICE.md sagt zu, das Projekt nicht „als reines
 * Bilder- oder Textarchiv" zu betreiben. Owner-Entscheid 06.08.2026: Links raus, dazu eine
 * von Hand hochgeladene `uploads/map/.htaccess`, die `*.zip` mit `Require all denied`
 * sperrt (Vorlage: docs/systemtest-2026-08-05/uploads-map.htaccess).
 *
 * Diese Datei ist die AUSNAHME davon für angemeldete Editoren -- und sie ist nur deshalb
 * eine vertretbare Ausnahme, weil sie drei Zusagen einhält:
 *   1. 🔴 Die .htaccess bleibt unangetastet. Gelesen wird aus dem DATEISYSTEM, nie über
 *      HTTP -- der Riegel für alle anderen bleibt scharf.
 *   2. 🔴 Es entsteht KEINE Adresse, die ohne Sitzung liefert. Kein Weiterleiten auf einen
 *      „unratbaren" Pfad: der wäre danach ein nackter, teilbarer Link, der sich nie wieder
 *      ändert -- exakt der Zustand, den A25 abgestellt hat.
 *   3. Jeder Download hinterlässt eine Zeile mit Namen (§ Protokoll unten).
 *
 * Diese Datei ist REIN, bis auf die zwei Funktionen am Ende, die die Datenbank brauchen.
 * Sie öffnet keine Datei, setzt keinen Kopf und schreibt nichts aus -- das tut der
 * Endpunkt api/edit/map/kartenarchiv.php. Der Grund ist der Range-Rechner: eine Rechnung,
 * die man nur mit laufendem Server prüfen kann, wird nie geprüft.
 */

require_once __DIR__ . '/../audit-prune.php';

/** Wo die Archive liegen -- relativ zur Repository-/Webspace-Wurzel. */
const AVESMAPS_KARTENARCHIV_VERZEICHNIS = 'uploads/map';

/**
 * 💣 Gefiltert wird nach ENDUNG, nicht nach Dateinamen -- derselbe Satz, mit dem der Owner
 * seine .htaccess begründet hat: „Die Versionsnummer im Namen (v2.05) ändert sich mit
 * jeder neuen Karte, die Endung nicht. Ein Riegel auf den heutigen Namen wäre beim
 * nächsten Export lautlos wirkungslos." Für das ANGEBOT gilt derselbe Satz: ein
 * hartkodiertes `avesmaps_aventurien_v2.05.zip` wäre nach dem nächsten Export ein toter
 * Verweis, und niemandem fiele auf, warum.
 */
const AVESMAPS_KARTENARCHIV_ENDUNG = '.zip';

/** Häppchengröße beim Ausliefern. Wie beim Datenbank-Backup (api/edit/admin/database-backup.php). */
const AVESMAPS_KARTENARCHIV_CHUNK = 262144;

/**
 * Wie viele Protokollzeilen `map_archive_download` behält.
 *
 * 💣 Eine unsichtbare Tabelle ohne Grenze ist genau das, was am 18.08.2026 die Datenbank
 * in STRATOs 2-GB-Grenze gefahren und schreibgesperrt hat. Die Zahl ist grosszügig, weil
 * eine Zeile hier ein paar hundert Byte wiegt und es im Jahr eine Handvoll davon gibt --
 * aber es gibt sie AB DEM ERSTEN TAG, nicht erst, wenn es auffällt.
 */
const AVESMAPS_KARTENARCHIV_KEEP_ROWS = 500;

/**
 * Der aufgelöste Ordner, oder null wenn es ihn nicht gibt.
 *
 * ⚠️ `realpath` und nicht nur Zusammenkleben: der Rückgabewert ist der Massstab, an dem
 * avesmapsKartenarchivPfad() den Ausbruch misst. Ein nicht aufgelöster Pfad kann einen
 * Symlink enthalten und taugt als Massstab nicht.
 */
function avesmapsKartenarchivVerzeichnis(): ?string
{
    // Diese Datei liegt in api/_internal/map/ -- drei Ebenen unter der Wurzel.
    $wurzel = dirname(__DIR__, 3);
    $pfad = realpath($wurzel . '/' . AVESMAPS_KARTENARCHIV_VERZEICHNIS);

    return ($pfad !== false && is_dir($pfad)) ? $pfad : null;
}

/**
 * Was tatsächlich im Ordner liegt: [['name' => …, 'size' => …, 'mtime' => …], …],
 * nach Namen sortiert. Leerer oder fehlender Ordner -> leere Liste.
 *
 * ⚠️ Die leere Liste ist ein GÜLTIGES Ergebnis und keine Störung. Die Seite sagt dann
 * „kein Archiv gefunden" -- das ist die Selbstdiagnose für den Fall, dass die Dateien auf
 * dem Server woanders liegen als hier angenommen.
 *
 * @param string|null $verzeichnis Nur für den Test; sonst der echte Ordner.
 * @return list<array{name: string, size: int, mtime: int}>
 */
function avesmapsKartenarchivListe(?string $verzeichnis = null): array
{
    $ordner = $verzeichnis ?? avesmapsKartenarchivVerzeichnis();
    if ($ordner === null || !is_dir($ordner)) {
        return [];
    }

    $namen = scandir($ordner);
    if ($namen === false) {
        return [];
    }

    $liste = [];
    foreach ($namen as $name) {
        if (!avesmapsKartenarchivNameIstArchiv($name)) {
            continue;
        }
        $pfad = $ordner . DIRECTORY_SEPARATOR . $name;
        if (!is_file($pfad)) {
            continue;
        }
        $liste[] = [
            'name' => $name,
            'size' => (int) filesize($pfad),
            'mtime' => (int) filemtime($pfad),
        ];
    }

    usort($liste, static fn(array $a, array $b): int => strcmp($a['name'], $b['name']));

    return $liste;
}

/**
 * Heisst der Name so, dass er ein Archiv sein darf?
 *
 * 💣 Zwei Riegel, und der zweite ist der, den man vergisst: `basename()` nimmt jedem `../`
 * den Weg, aber ein Name wie `.zip` oder ein leerer Name käme durch. Geprüft wird deshalb
 * auf ECHTE Länge vor der Endung.
 */
function avesmapsKartenarchivNameIstArchiv(string $name): bool
{
    if ($name !== basename($name) || $name === '' || $name[0] === '.') {
        return false;
    }
    $endung = AVESMAPS_KARTENARCHIV_ENDUNG;
    if (strlen($name) <= strlen($endung)) {
        return false;
    }

    return strtolower(substr($name, -strlen($endung))) === $endung;
}

/**
 * Der volle Pfad zu einem Archiv -- oder null, wenn der Name nichts taugt.
 *
 * 💣 DER NAME KOMMT VOM CLIENT. Das ist eine Pfad-Ausbruchsstelle, keine Formalie, und sie
 * braucht DREI Riegel, weil jeder einzelne etwas durchlässt, das die anderen fangen:
 *   1. `basename()` -- gegen `../../api/config.local.php`,
 *   2. die Endung `.zip` -- gegen jede andere Datei, die zufällig im Ordner liegt,
 *   3. `realpath()` muss INNERHALB des aufgelösten Ordners landen -- gegen einen Symlink,
 *      den die ersten beiden nicht sehen können.
 *
 * ⚠️ Der Rückfall ist immer `null`, nie eine Ausnahme mit dem Pfad im Text: der Aufrufer
 * antwortet 404, und eine Fehlermeldung, die Serverpfade nennt, ist eine Auskunft an den,
 * der gerade den Ausbruch versucht hat.
 */
function avesmapsKartenarchivPfad(string $name, ?string $verzeichnis = null): ?string
{
    $ordner = $verzeichnis ?? avesmapsKartenarchivVerzeichnis();
    if ($ordner === null) {
        return null;
    }
    if (!avesmapsKartenarchivNameIstArchiv($name)) {
        return null;
    }

    // 💣 Der Massstab muss SELBST aufgeloest sein, sonst vergleicht Riegel 3 zwei verschiedene
    // Schreibweisen desselben Ordners und weist die echte Datei ab. Unter Windows faellt das sofort
    // auf (`C:\Temp/ordner` gegen `C:\Temp\ordner`), unter Linux erst bei einem Symlink im Pfad --
    // also dort, wo es niemand mehr sucht.
    $massstabRoh = realpath($ordner);
    if ($massstabRoh === false) {
        return null;
    }

    $pfad = realpath($massstabRoh . DIRECTORY_SEPARATOR . $name);
    if ($pfad === false || !is_file($pfad)) {
        return null;
    }

    // Riegel 3. Der Trenner am Ende ist tragend: ohne ihn liesse `/uploads/map-geheim/x.zip`
    // sich als „faengt mit /uploads/map an" lesen.
    $massstab = rtrim($massstabRoh, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (!str_starts_with($pfad, $massstab)) {
        return null;
    }

    return $pfad;
}

/**
 * Die Range-Rechnung -- REIN, damit sie prüfbar ist.
 *
 * Bei 1,73 GB ist Fortsetzen keine Bequemlichkeit: ohne `Range` fängt jeder Abbruch wieder
 * bei null an, und ein Download, der nie ankommt, ist kein Download.
 *
 * @return array{status: int, start: int, end: int, length: int}
 *         status 200 = ganze Datei · 206 = Teil · 416 = unerfüllbar
 *
 * ⚠️ Unterstützt wird EIN Bereich. Mehrteilige (`bytes=0-9,20-29`) beantwortet diese
 * Rechnung mit der GANZEN Datei (200) -- das ist erlaubt und spart die
 * `multipart/byteranges`-Maschinerie, die kein Downloader braucht.
 */
function avesmapsKartenarchivRange(?string $kopf, int $groesse): array
{
    $groesse = max(0, $groesse);
    $ganz = ['status' => 200, 'start' => 0, 'end' => max(0, $groesse - 1), 'length' => $groesse];
    $unerfuellbar = ['status' => 416, 'start' => 0, 'end' => 0, 'length' => 0];

    if ($kopf === null || trim($kopf) === '') {
        return $ganz;
    }

    // Eine Einheit, die wir nicht kennen, wird nach RFC 9110 IGNORIERT -- ganze Datei,
    // nicht 416. 416 wäre die Behauptung, der Wunsch sei unerfüllbar; er ist unverstanden.
    if (!preg_match('/^\s*bytes\s*=\s*(.+)$/i', $kopf, $treffer)) {
        return $ganz;
    }

    $spezifikation = trim($treffer[1]);
    if (str_contains($spezifikation, ',')) {
        return $ganz;
    }
    if (!preg_match('/^(\d*)\s*-\s*(\d*)$/', $spezifikation, $teile)) {
        return $unerfuellbar;
    }

    $vonText = $teile[1];
    $bisText = $teile[2];

    // `bytes=-` ist beides leer und damit unsinnig.
    if ($vonText === '' && $bisText === '') {
        return $unerfuellbar;
    }
    // Eine leere Datei hat keinen Bereich, den man verlangen könnte.
    if ($groesse === 0) {
        return $unerfuellbar;
    }

    if ($vonText === '') {
        // Suffix: „die letzten n Bytes". n = 0 verlangt nichts und ist unerfüllbar.
        $anzahl = (int) $bisText;
        if ($anzahl <= 0) {
            return $unerfuellbar;
        }
        $start = max(0, $groesse - $anzahl);
        $ende = $groesse - 1;
    } else {
        $start = (int) $vonText;
        if ($start > $groesse - 1) {
            return $unerfuellbar;
        }
        // Ein Ende jenseits der Datei wird GEKAPPT, nicht abgelehnt: `bytes=0-99999999`
        // ist der normale Wunsch „ab hier alles" und darf nicht 416 heissen.
        $ende = $bisText === '' ? $groesse - 1 : min((int) $bisText, $groesse - 1);
        if ($ende < $start) {
            return $unerfuellbar;
        }
    }

    return ['status' => 206, 'start' => $start, 'end' => $ende, 'length' => $ende - $start + 1];
}

/**
 * Ist DIESE Anfrage der Beginn eines Downloads?
 *
 * 💣 Der Riegel gegen ein Protokoll voller Rauschen. Ein Downloader mit Fortsetzen stellt
 * Dutzende Anfragen für EINEN Download; jede zu protokollieren machte aus dem Beleg eine
 * Wolke und verdrängte über die Kappung genau die Zeilen, für die die Tabelle da ist.
 * Gezählt wird deshalb der ANFANG -- kein Range-Kopf, oder ein Bereich ab Byte 0.
 */
function avesmapsKartenarchivIstDownloadStart(array $bereich): bool
{
    return $bereich['status'] !== 416 && (int) $bereich['start'] === 0;
}

/**
 * Bytes für Menschen: „1,73 GB", „161 MB".
 *
 * ⚠️ 1024er-Stufen, obwohl die Einheit „GB" heisst. Das ist die umgangssprachliche Form,
 * und es ist DIESELBE, in der die Zahlen dieses Projekts schon stehen: 168.647.049 Byte
 * heissen in Befund A25 „161 MB", 1.855.789.721 heissen dort „1,73 GB". Eine Seite, die
 * plötzlich „169 MB" sagt, widerspricht der eigenen Aktenlage.
 */
function avesmapsKartenarchivGroesse(int $bytes): string
{
    if ($bytes >= 1073741824) {
        return number_format($bytes / 1073741824, 2, ',', '.') . ' GB';
    }
    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 0, ',', '.') . ' MB';
    }
    if ($bytes >= 1024) {
        return number_format($bytes / 1024, 0, ',', '.') . ' KB';
    }

    return number_format($bytes, 0, ',', '.') . ' Byte';
}

/**
 * Schiebt genau $laenge Bytes ab der aktuellen Position aus dem Handle heraus.
 *
 * 💣 Gezaehlt wird, was noch FEHLT -- nicht bis `feof`. Bei einem Teilbereich liegt das
 * Dateiende HINTER dem Bereichsende, und ohne diesen Zaehler schoebe die Schleife den Rest
 * der Datei hinterher: die ausgelieferte `Content-Length` und der Rumpf gingen auseinander,
 * und das Ergebnis waere ein lautlos kaputtes ZIP statt eines sichtbaren Fehlschlags.
 *
 * ⚠️ Steht hier und nicht im Endpunkt, damit diese Schleife wirklich AUSGEFUEHRT geprueft
 * werden kann. Der Endpunkt daneben laesst sich ohne Sitzung und Datenbank nicht fahren --
 * eine Rechnung, die man nur mit laufendem Server pruefen kann, wird nie geprueft.
 *
 * @param resource $handle
 * @return int Wie viele Bytes tatsaechlich herausgingen (< $laenge nur bei Lesefehler).
 */
function avesmapsKartenarchivStream($handle, int $laenge): int
{
    $offen = max(0, $laenge);
    $geschrieben = 0;

    while ($offen > 0 && !feof($handle)) {
        $chunk = fread($handle, (int) min(AVESMAPS_KARTENARCHIV_CHUNK, $offen));
        if ($chunk === false || $chunk === '') {
            break;
        }
        echo $chunk;
        flush();
        $offen -= strlen($chunk);
        $geschrieben += strlen($chunk);
    }

    return $geschrieben;
}

/**
 * Die Protokolltabelle -- selbstheilend wie der Rest des Schemas (AGENTS.md §5).
 *
 * ⚠️ `actor_name` steht MIT in der Zeile und wird nicht per JOIN geholt: ein gelöschter
 * Benutzer soll den Beleg nicht unlesbar machen. Genau deshalb ist er ein Beleg.
 */
function avesmapsKartenarchivEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_archive_download (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            actor_user_id BIGINT UNSIGNED NULL,
            actor_name VARCHAR(120) NOT NULL,
            file_name VARCHAR(190) NOT NULL,
            file_size BIGINT UNSIGNED NOT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * Eine Zeile je Download. Kappt danach selbst.
 *
 * 🔴 Die Kappung steht HIER und nicht beim Aufrufer -- dieselbe Regel wie bei
 * avesmapsWriteMapAuditLog: eine Grenze, die einen von mehreren Erzeugern bindet, ist
 * keine Grenze. Heute gibt es genau einen Aufrufer; morgen ist das kein Argument mehr.
 *
 * 💣 Gekappt wird ueber AVESMAPS_AUDIT_PRUNE_CAPPABLE_TABLES, und diese Tabelle steht bewusst
 * NICHT in der engeren AVESMAPS_AUDIT_PRUNE_TABLES: jene traegt die Regel „200 je Person ueber
 * ALLE Protokolle zusammen" (Owner 22.08.2026). Wer ein Kartenarchiv holt, hat nichts geaendert
 * -- die Zeile darf keinen einzigen der 200 Aenderungsschritte verdraengen, die die Oberflaeche
 * dem Editor noch anbietet, und sie darf umgekehrt im Trichter der Aenderungen nicht mitzaehlen.
 *
 * 🪤 Und die Tabelle, die es NICHT geworden ist: `map_audit_log` sieht wie der richtige Ort
 * aus, ist aber ein 200-Zeilen-Rollpuffer (api/_internal/audit-prune.php), aus dem das
 * Rückgängigmachen seine Schritte nimmt -- gemessen 696 neue Zeilen am Tag. Eine Zeile
 * dort wäre binnen Stunden weg UND hätte vorher einem Editor einen Undo-Schritt genommen,
 * den die Oberfläche ihm noch anbietet.
 */
function avesmapsKartenarchivProtokollieren(PDO $pdo, ?int $userId, string $userName, string $dateiName, int $groesse): void
{
    avesmapsKartenarchivEnsureTable($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO map_archive_download (actor_user_id, actor_name, file_name, file_size)
        VALUES (:actor_user_id, :actor_name, :file_name, :file_size)'
    );
    $statement->execute([
        'actor_user_id' => $userId,
        'actor_name' => $userName,
        'file_name' => $dateiName,
        'file_size' => $groesse,
    ]);

    avesmapsPruneAuditLog($pdo, 'map_archive_download', AVESMAPS_KARTENARCHIV_KEEP_ROWS);
}
