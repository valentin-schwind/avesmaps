<?php

declare(strict_types=1);

// Die Aufzaehlung von `uploads/` -- Bibliothek zum Endpunkt GET /api/app/uploads-export.php
// (Legacy-Export E6, Auftrag Avesmaps3D 05.10.2026: WI-0086 im Repo avesmaps3D).
//
// WOZU. Avesmaps3D haelt eine Kopie von `uploads/` in einem inhaltsadressierten Fach. Bisher konnte es
// nur fragen „gib mir diese Datei" -- die Frage „was hat sich geaendert?" kostete 2.483 bedingte
// Abrufe, einen je Datei. Dieser Export beantwortet sie mit EINEM GET: Pfad, Groesse und
// Aenderungszeit je Datei. Geholt wird danach nur, was neu ist oder sich unterscheidet.
//
// 🔴 KEIN SHA-256 JE DATEI. Das waere die bessere Aussage, aber Legacy muesste dafuer bei JEDEM
// Listenabruf 230 MiB lesen. `stat` kostet nichts. Den SHA-256 rechnet Avesmaps3D selbst, an der
// Datei, die es geholt hat.
//
// 🔴 NUR LESEN: kein PDO, keine Abfrage, keine Sitzung, kein Schreibweg, kein DDL, keine Datei wird
// angelegt, geaendert oder geloescht. Dieser Export ist der erste, der keine Datenbank anfasst.
//
// 💣 WAS NICHT IN DIE LISTE KOMMT, UND WARUM GENAU SO. Unter `uploads/` liegen Verzeichnisse, die der
// Webserver mit `Require all denied` sperrt (uploads/db-backups/.htaccess, uploads/dumps/.htaccess):
// dort liegen DATENBANKSICHERUNGEN. Eine Liste „alles unter uploads/" naennte deren Dateinamen
// oeffentlich, obwohl sie nie ausgeliefert werden. Dazu sperrt uploads/map/.htaccess Archive nach
// Endung (Befund A25, Owner-Entscheid 06.08.2026).
// Deshalb eine POSITIVLISTE DER ENDUNGEN -- dieselbe Idee wie die Positivliste der Felder: gelistet
// wird, was ein Bild ist. Das haelt auch einen Ordner draussen, den morgen jemand anlegt und niemand
// hier nachtraegt. Die zwei gesperrten Verzeichnisse stehen zusaetzlich namentlich drin.
//
// ⚠️ EINE LEERE LISTE IST KEIN GUELTIGES ERGEBNIS, sondern ein Ausfall -- anders als beim Kartenarchiv
// (api/_internal/map/kartenarchiv.php). Der Grund liegt beim Abnehmer: Avesmaps3D wuerde eine leere
// Liste als „Legacy hat alle Bilder geloescht" lesen. Dieser Export nennt deshalb `ok:true` auch bei
// einer leeren Liste und laesst die Entscheidung dort; der Sync haelt bei einer leeren Liste an
// (seine Quellenpruefung A24).

require_once __DIR__ . '/export-rahmen.php';

// Die Felder je Datei (Positivliste; ein Test faellt fuer jedes weitere Feld).
const AVESMAPS_UPLOADS_EXPORT_FELDER = ['path', 'bytes', 'mtime'];

/** Wo gezaehlt wird -- relativ zur Webwurzel, ohne Schraegstriche. */
const AVESMAPS_UPLOADS_EXPORT_WURZEL = 'uploads';

/**
 * Der Deckel -- aber NIE STILL. Vorbild und Begruendung: AVESMAPS_LORE_RULE_AREA_LIMIT
 * (api/_internal/app/lore-rule-match.php Z. 36ff.): „dieselbe Falle wie bei
 * avesmapsEcosystemParseRegionFilter, die genau diese Woche 31 Waelder lautlos verschluckt hat, weil
 * ein Filter einen fremden Deckel samt Begruendung geerbt hatte, aber nicht dessen `truncated`-Feld."
 *
 * 50.000 ist das Zwanzigfache des heutigen Bestands (rund 2.500 Dateien). Der Deckel ist kein Tarif,
 * sondern ein Riegel gegen eine Antwort, die den Speicher des Prozesses sprengt.
 */
const AVESMAPS_UPLOADS_EXPORT_DECKEL = 50000;

/**
 * Die Endungen, die gelistet werden (klein geschrieben, ohne Punkt).
 *
 * 🔴 Eine POSITIVliste: was hier nicht steht, wird nie genannt. `.sql`, `.zip`, `.gz`, `.php` und
 * `.htaccess` fallen damit ueberall heraus, nicht nur dort, wo heute jemand daran gedacht hat.
 */
const AVESMAPS_UPLOADS_EXPORT_ENDUNGEN = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'];

/**
 * Verzeichnisnamen direkt unter `uploads/`, die gar nicht betreten werden.
 *
 * 💣 Hier liegen Datenbanksicherungen. Der Webserver sperrt sie (`Require all denied` in
 * uploads/db-backups/.htaccess und uploads/dumps/.htaccess) -- ein oeffentlicher Export darf ihre
 * Dateinamen auch nicht NENNEN. Die Endungsliste oben faengt sie schon; dies ist der zweite Riegel,
 * damit eine kuenftige Zeile dort nicht zwei Sperren auf einmal aufhebt.
 */
const AVESMAPS_UPLOADS_EXPORT_GESPERRT = ['db-backups', 'dumps'];

/**
 * Der aufgeloeste Ordner `uploads/`, oder null, wenn es ihn nicht gibt.
 *
 * ⚠️ `realpath` und nicht nur Zusammenkleben -- dieselbe Begruendung wie
 * avesmapsKartenarchivVerzeichnis(): der Rueckgabewert ist der MASSSTAB, an dem unten der Ausbruch
 * gemessen wird. Ein nicht aufgeloester Pfad kann einen Symlink enthalten und taugt als Massstab nicht.
 */
function avesmapsUploadsExportWurzel(): ?string
{
    // Diese Datei liegt in api/_internal/app/ -- drei Ebenen unter der Webwurzel.
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $pfad = realpath($docroot . '/' . AVESMAPS_UPLOADS_EXPORT_WURZEL);

    return ($pfad !== false && is_dir($pfad)) ? $pfad : null;
}

/**
 * REIN: Darf ein Eintragsname ueberhaupt vorkommen?
 *
 * 💣 Drei Riegel, und der dritte ist der, den man vergisst: `basename()` nimmt jedem `../` den Weg,
 * der Punkt am Anfang haelt `.`, `..`, `.htaccess` und jedes Punktverzeichnis draussen -- aber ein
 * Name, der NUR aus einer Endung besteht (`.png`), kaeme durch beide. Geprueft wird deshalb auf echte
 * Laenge vor der Endung (Vorbild: avesmapsKartenarchivNameIstArchiv).
 */
function avesmapsUploadsExportNameTaugt(string $name): bool
{
    return $name !== '' && $name === basename($name) && $name[0] !== '.';
}

/** REIN: Traegt der Name eine der gelisteten Endungen? */
function avesmapsUploadsExportEndungTaugt(string $name): bool
{
    $punkt = strrpos($name, '.');
    if ($punkt === false || $punkt === 0 || $punkt === strlen($name) - 1) {
        return false;
    }

    return in_array(strtolower(substr($name, $punkt + 1)), AVESMAPS_UPLOADS_EXPORT_ENDUNGEN, true);
}

/**
 * REIN: Die Verzeichnisse unterhalb von `$ordner`, die betreten werden duerfen.
 *
 * ⚠️ `is_link` VOR `is_dir`: `is_dir` folgt der Verknuepfung und saehe ein Verzeichnis, das ausserhalb
 * liegt. Eine Verknuepfung wird nie betreten und nie gelistet.
 */
function avesmapsUploadsExportKinder(string $ordner, bool $istWurzel): array
{
    $namen = scandir($ordner);
    if ($namen === false) {
        return [];
    }
    $kinder = [];
    foreach ($namen as $name) {
        if (!avesmapsUploadsExportNameTaugt($name)) {
            continue;
        }
        if ($istWurzel && in_array($name, AVESMAPS_UPLOADS_EXPORT_GESPERRT, true)) {
            continue;
        }
        $pfad = $ordner . DIRECTORY_SEPARATOR . $name;
        if (is_link($pfad) || !is_dir($pfad)) {
            continue;
        }
        $kinder[] = $pfad;
    }
    sort($kinder);

    return $kinder;
}

/**
 * Der Abdruck der VERZEICHNISSE: Zahl und Aenderungszeiten, kein `stat` je Datei.
 *
 * Das ist der `$stand` fuer avesmapsExportStabilLesen. Ein Verzeichnis hebt seine Aenderungszeit,
 * wenn ein Eintrag dazukommt, verschwindet oder umbenannt wird -- genau die Faelle, die eine
 * REKURSIVE Aufzaehlung unbrauchbar machen, weil sie dann keinen einzigen Zeitpunkt beschreibt.
 *
 * 💣 EHRLICH BENANNT, WAS ER NICHT SIEHT: eine Datei, die an derselben Stelle mit neuen Bytes
 * ueberschrieben wird, hebt die Zeit ihres Verzeichnisses nicht. Diesen Fall deckt NICHT dieser
 * Export, sondern der Abnehmer: Avesmaps3D verbucht Groesse, ETag und Last-Modified aus der ANTWORT
 * des Dateiabrufs, nie aus dieser Liste (WI-0086 §5.4). Die naechste Liste weicht dann wieder ab.
 */
function avesmapsUploadsExportVerzeichnisAbdruck(string $wurzel): string
{
    $teile = [];
    $stapel = [$wurzel];
    $istWurzel = true;
    while ($stapel !== []) {
        $ordner = array_shift($stapel);
        $zeit = @filemtime($ordner);
        $teile[] = $ordner . ':' . ($zeit === false ? '' : (string) $zeit);
        foreach (avesmapsUploadsExportKinder($ordner, $istWurzel) as $kind) {
            $stapel[] = $kind;
        }
        $istWurzel = false;
    }
    sort($teile);

    return (string) count($teile) . '|' . implode('|', $teile);
}

/**
 * Die Dateien unter `uploads/`: `[['path' => '/uploads/…', 'bytes' => int, 'mtime' => int], …]`,
 * nach Pfad sortiert, dazu `truncated`.
 *
 * 💣 DER AUSBRUCHSRIEGEL. Die Namen kommen vom Dateisystem, nicht vom Client -- aber ein Symlink
 * kommt auch nicht vom Client. Drei Riegel, wie beim Kartenarchiv: (1) der Name taugt
 * (`basename`, kein Punkt am Anfang), (2) `is_link` ist falsch und `is_file` wahr, (3) `realpath`
 * der Datei liegt INNERHALB des aufgeloesten Massstabs.
 *
 * @return array{items: list<array{path: string, bytes: int, mtime: int}>, truncated: bool}
 */
function avesmapsUploadsExportZaehlen(string $wurzel, int $deckel = AVESMAPS_UPLOADS_EXPORT_DECKEL): array
{
    $massstab = realpath($wurzel);
    if ($massstab === false) {
        return ['items' => [], 'truncated' => false];
    }
    $praefix = $massstab . DIRECTORY_SEPARATOR;
    $items = [];
    $truncated = false;
    $stapel = [$massstab];
    $istWurzel = true;
    while ($stapel !== []) {
        $ordner = array_shift($stapel);
        foreach (avesmapsUploadsExportKinder($ordner, $istWurzel) as $kind) {
            $stapel[] = $kind;
        }
        $istWurzel = false;
        $namen = scandir($ordner);
        if ($namen === false) {
            continue;
        }
        foreach ($namen as $name) {
            if (!avesmapsUploadsExportNameTaugt($name) || !avesmapsUploadsExportEndungTaugt($name)) {
                continue;
            }
            $pfad = $ordner . DIRECTORY_SEPARATOR . $name;
            if (is_link($pfad) || !is_file($pfad)) {
                continue;
            }
            $echt = realpath($pfad);
            if ($echt === false || strncmp($echt, $praefix, strlen($praefix)) !== 0) {
                continue;
            }
            if (count($items) >= $deckel) {
                // 🔴 Erreicht heisst: sagen, nicht kuerzen. Der Abnehmer haelt daraufhin an.
                $truncated = true;
                break 2;
            }
            $relativ = str_replace(DIRECTORY_SEPARATOR, '/', substr($echt, strlen($massstab)));
            $items[] = [
                'path' => '/' . AVESMAPS_UPLOADS_EXPORT_WURZEL . $relativ,
                'bytes' => (int) filesize($echt),
                'mtime' => (int) filemtime($echt),
            ];
        }
    }
    usort($items, static fn(array $a, array $b): int => strcmp($a['path'], $b['path']));

    return ['items' => $items, 'truncated' => $truncated];
}

/**
 * Die Antwort des Exports.
 *
 * @param string|null $verzeichnis Nur fuer den Test; sonst der echte Ordner.
 * @throws AvesmapsExportInBewegung
 */
function avesmapsUploadsExportLesen(?string $verzeichnis = null): array
{
    $wurzel = $verzeichnis ?? avesmapsUploadsExportWurzel();
    if ($wurzel === null) {
        // Kein `uploads/` -- das ist kein bewegter Stand, sondern eine kaputte Installation.
        return [
            'ok' => true,
            'uploads_revision' => avesmapsExportStempel('uploads', ''),
            'counts' => ['files' => 0, 'bytes' => 0],
            'truncated' => false,
            'items' => [],
        ];
    }

    $ergebnis = avesmapsExportStabilLesen(
        static fn(): string => avesmapsUploadsExportVerzeichnisAbdruck($wurzel),
        static fn(): array => avesmapsUploadsExportZaehlen($wurzel),
    );
    $daten = $ergebnis['daten'];
    $items = $daten['items'];
    $bytes = 0;
    foreach ($items as $item) {
        $bytes += $item['bytes'];
    }

    return [
        'ok' => true,
        'uploads_revision' => avesmapsExportStempel('uploads', (string) $ergebnis['stand']),
        'counts' => ['files' => count($items), 'bytes' => $bytes],
        'truncated' => $daten['truncated'],
        'items' => array_map(
            static fn(array $zeile): array => avesmapsExportProjektion($zeile, AVESMAPS_UPLOADS_EXPORT_FELDER),
            $items,
        ),
    ];
}
