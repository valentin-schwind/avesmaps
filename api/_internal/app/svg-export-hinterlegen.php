<?php

declare(strict_types=1);

/**
 * Einen SVG-Abzug HINTERLEGEN -- der Schreibweg der Ablage.
 * ---------------------------------------------------------------------------------------
 * Gebaut wird der Abzug NICHT hier und ueberhaupt nicht in PHP (siehe svg-export-ablage.php).
 * Diese Datei nimmt ein fertiges Dokument entgegen, prueft es, legt es ab und raeumt auf.
 *
 * 🔴 ZWEI ERZEUGER, EIN WEG HINEIN. Der Owner erzeugt den Abzug im Browser auf
 * /edit/svg-export.php -- mit SEINEN Reglern --, die naechtliche Routine erzeugt ihn unter
 * Node mit denselben Bauteilen. Beide legen ihn ueber DENSELBEN Endpunkt ab
 * (POST /api/svg-export-deposit.php). Ein zweiter Schreibweg (die erste Fassung schob die
 * Datei per SFTP aus der CI hoch) haette dieselbe Regel ein zweites Mal gebraucht --
 * aufraeumen, Zeiger schreiben, Sperre setzen --, und das Projekt hat genau dafuer schon
 * bezahlt: „zwei von drei Löschwegen gebunden ist keine Regel" (AGENTS.md, Sammelknopf der
 * Geometrien).
 *
 * 💣 GESTUECKELT, WIE DER DATENBANK-DUMP. Ein Abzug ist ~8,6 MB; ein einzelner POST laeuft auf
 * STRATO in `post_max_size` -- und dessen Fehlerbild ist ein LEERER Rumpf ohne Ausnahme, also
 * nicht von „nichts geschickt" zu unterscheiden. Deshalb: `start` -> n x `chunk` -> `finish`.
 */

require_once __DIR__ . '/svg-export-ablage.php';

/** Wie viele fertige Abzuege aufbewahrt werden. Vorbild: AVESMAPS_DB_BACKUP_KEEP_FILES = 3. */
const AVESMAPS_SVG_EXPORT_KEEP_FILES = 3;

/** Obergrenze fuer einen Abzug. Live gemessen 23.08.2026: 8,6 MB. */
const AVESMAPS_SVG_EXPORT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Untergrenze. ⚠️ Ein echter Riegel, keine Schoenheit: der wahrscheinlichste stille Fehlschlag
 * ist ein Bauer, der auf leere Endpunktantworten ein gueltiges, aber leeres SVG-Dokument baut.
 * Das faellt niemandem auf -- es ist ja eine Datei da.
 */
const AVESMAPS_SVG_EXPORT_MIN_BYTES = 64 * 1024;

/** Ein angefangener Upload, der aelter ist, gilt als verwaist. */
const AVESMAPS_SVG_EXPORT_UPLOAD_TTL = 3600;

/**
 * 💣 EIN NAME, KEIN PFAD -- dieselbe Regel wie beim Abzug, hier fuer die Upload-Kennung.
 * Sie kommt aus einer Anfrage und landet in einem Dateinamen.
 */
function avesmapsSvgExportUploadIdGueltig(string $id): bool {
    return preg_match('/^[0-9a-f]{32}$/', $id) === 1;
}

function avesmapsSvgExportUploadPfad(string $verzeichnis, string $id): string {
    return $verzeichnis . DIRECTORY_SEPARATOR . 'upload-' . $id . '.part';
}

/**
 * Verwaiste Uploads wegraeumen. Ohne das sammelt jeder abgebrochene Versuch 8 MB an -- und ein
 * volles Webspace entzieht auf STRATO der Datenbank die Schreibrechte (Fehler 1142 beim
 * naechsten INSERT, und das sieht nach einem Datenbankproblem aus, nicht nach vollem Speicher).
 */
function avesmapsSvgExportUploadsAufraeumen(string $verzeichnis, int $jetzt): int {
    $weg = 0;
    foreach ((array) glob($verzeichnis . DIRECTORY_SEPARATOR . 'upload-*.part') as $datei) {
        $pfad = (string) $datei;
        $alter = @filemtime($pfad);
        if ($alter !== false && ($jetzt - $alter) > AVESMAPS_SVG_EXPORT_UPLOAD_TTL) {
            @unlink($pfad);
            $weg++;
        }
    }

    return $weg;
}

/**
 * Nur die neuesten `AVESMAPS_SVG_EXPORT_KEEP_FILES` Abzuege behalten.
 *
 * 🔴 DER AKTUELLE FAELLT NIE, auch wenn er nach Datum herausfiele -- der Zeiger zeigt auf ihn,
 * und eine Ablage, deren Zeiger ins Leere geht, meldet „kein Abzug vorhanden", obwohl gerade
 * einer hinterlegt wurde.
 * ⚠️ Sortiert wird nach mtime absteigend, bei Gleichstand nach Namen. Ohne den zweiten
 * Schluessel ist die Reihenfolge bei zwei Dateien aus derselben Sekunde nicht stabil, und dann
 * faellt mal die eine, mal die andere -- ein Fehler, der sich nur manchmal zeigt.
 */
function avesmapsSvgExportAufraeumen(string $verzeichnis, string $aktuelleDatei): array {
    $dateien = [];
    foreach ((array) glob($verzeichnis . DIRECTORY_SEPARATOR . 'abzug-*.svg') as $datei) {
        $pfad = (string) $datei;
        $name = basename($pfad);
        if (!avesmapsSvgExportDateinameGueltig($name) || $name === $aktuelleDatei) {
            continue;
        }
        $dateien[] = ['name' => $name, 'pfad' => $pfad, 'zeit' => (int) @filemtime($pfad)];
    }

    usort($dateien, static function (array $a, array $b): int {
        return ($b['zeit'] <=> $a['zeit']) ?: strcmp($b['name'], $a['name']);
    });

    $geloescht = [];
    // Der aktuelle belegt bereits einen der Plaetze, also bleiben KEEP-1 weitere.
    foreach (array_slice($dateien, AVESMAPS_SVG_EXPORT_KEEP_FILES - 1) as $eintrag) {
        if (@unlink($eintrag['pfad'])) {
            $geloescht[] = $eintrag['name'];
        }
    }

    return $geloescht;
}

/**
 * Ein Stueck an den laufenden Upload anhaengen. Gibt die neue Gesamtgroesse zurueck.
 *
 * ⚠️ `FILE_APPEND` statt eines offenen Handles ueber mehrere Anfragen hinweg: jede Anfrage ist
 * ein eigener PHP-Prozess, ein Handle ueberlebt sie nicht. Genau deshalb ist der Dump
 * fortsetzbar gebaut und nicht als ein langer Lauf.
 */
function avesmapsSvgExportStueckAnhaengen(string $verzeichnis, string $uploadId, string $rohdaten): int {
    if (!avesmapsSvgExportUploadIdGueltig($uploadId)) {
        throw new InvalidArgumentException('Ungueltige Upload-Kennung.');
    }
    if ($rohdaten === '') {
        throw new InvalidArgumentException('Das Stueck ist leer.');
    }

    $pfad = avesmapsSvgExportUploadPfad($verzeichnis, $uploadId);
    $bisher = is_file($pfad) ? (int) filesize($pfad) : 0;
    if (($bisher + strlen($rohdaten)) > AVESMAPS_SVG_EXPORT_MAX_BYTES) {
        @unlink($pfad);
        throw new RuntimeException('Der Abzug ueberschreitet die Obergrenze.');
    }

    if (@file_put_contents($pfad, $rohdaten, FILE_APPEND | LOCK_EX) === false) {
        throw new RuntimeException('Das Stueck konnte nicht geschrieben werden.');
    }

    return $bisher + strlen($rohdaten);
}

/**
 * Den fertig hochgeladenen Abzug uebernehmen: pruefen, umbenennen, Zeiger umlegen, aufraeumen.
 *
 * 🔴 DER ZEIGER WIRD ZULETZT GESCHRIEBEN, und er zeigt auf einen Namen, den es vorher nicht gab
 * (der Hash steht darin). Bis er umspringt, liefert der Endpunkt den alten Abzug aus -- es gibt
 * kein Fenster, in dem eine halbe Datei die neueste waere.
 *
 * 💣 `quelle` sagt, WER ihn erzeugt hat (`manuell` oder `routine`). Zwei Erzeuger ohne
 * Kennzeichnung sind von aussen nicht zu unterscheiden: die Fassungsstempel nennen den
 * DATENstand, nicht den Erzeuger -- und der Owner waehlt beim Handbetrieb eigene Regler
 * (Glaettung, Farben, Groesse), die Routine ihre festen.
 */
function avesmapsSvgExportUebernehmen(string $verzeichnis, string $uploadId, array $angaben): array {
    if (!avesmapsSvgExportUploadIdGueltig($uploadId)) {
        throw new InvalidArgumentException('Ungueltige Upload-Kennung.');
    }

    $quelle = avesmapsSvgExportUploadPfad($verzeichnis, $uploadId);
    if (!is_file($quelle)) {
        throw new RuntimeException('Zu dieser Kennung liegt kein Upload bereit.');
    }

    $bytes = (int) filesize($quelle);
    if ($bytes < AVESMAPS_SVG_EXPORT_MIN_BYTES) {
        @unlink($quelle);
        throw new RuntimeException('Der Abzug ist verdaechtig klein (' . $bytes . ' Bytes) -- '
            . 'vermutlich hat beim Bauen ein Endpunkt leer geantwortet.');
    }

    // Der Kopf muss ein SVG sein. Kostet einen 4-KB-Lesevorgang und faengt den Fall, in dem
    // jemand versehentlich etwas ganz anderes hochlaedt.
    $kopf = (string) @file_get_contents($quelle, false, null, 0, 4096);
    if (!str_starts_with($kopf, '<?xml') || !str_contains($kopf, '<svg')) {
        @unlink($quelle);
        throw new RuntimeException('Das ist kein SVG-Dokument.');
    }

    $sha = hash_file('sha256', $quelle);
    if (!is_string($sha)) {
        @unlink($quelle);
        throw new RuntimeException('Der Abzug konnte nicht geprueft werden.');
    }

    $datei = 'abzug-' . substr($sha, 0, 16) . '.svg';
    $ziel = $verzeichnis . DIRECTORY_SEPARATOR . $datei;
    // ⚠️ Ein identischer Abzug traegt denselben Hash und damit denselben Namen. Dann liegt er
    // schon da -- das ist kein Fehler, sondern „nichts hat sich geaendert".
    if (is_file($ziel)) {
        @unlink($quelle);
    } elseif (!@rename($quelle, $ziel)) {
        @unlink($quelle);
        throw new RuntimeException('Der Abzug konnte nicht abgelegt werden.');
    }

    $zeiger = [
        'datei' => $datei,
        'dateiname' => avesmapsSvgExportDateinameSaeubern(
            (string) ($angaben['dateiname'] ?? 'avesmaps-karte.svg')
        ),
        'bytes' => $bytes,
        'sha256' => $sha,
        'etag' => '"' . $sha . '"',
        'kartenfassung' => avesmapsSvgExportKurzfeld($angaben['kartenfassung'] ?? '', 40),
        'landschaftsfassung' => avesmapsSvgExportKurzfeld($angaben['landschaftsfassung'] ?? '', 40),
        'exportiert' => avesmapsSvgExportKurzfeld($angaben['exportiert'] ?? '', 40),
        'dialekt' => avesmapsSvgExportKurzfeld($angaben['dialekt'] ?? 'inkscape', 20),
        'quelle' => ($angaben['quelle'] ?? '') === 'routine' ? 'routine' : 'manuell',
        'hinterlegt_von' => avesmapsSvgExportKurzfeld($angaben['hinterlegt_von'] ?? '', 60),
    ];

    $roh = json_encode($zeiger, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (!is_string($roh)
        || @file_put_contents($verzeichnis . DIRECTORY_SEPARATOR . 'aktuell.json', $roh . "\n") === false) {
        throw new RuntimeException('Der Zeiger konnte nicht geschrieben werden.');
    }

    $zeiger['aufgeraeumt'] = avesmapsSvgExportAufraeumen($verzeichnis, $datei);
    $zeiger['verwaiste_uploads_entfernt'] = avesmapsSvgExportUploadsAufraeumen($verzeichnis, time());

    return $zeiger;
}

/**
 * Ein kurzes, einzeiliges Feld fuer den Zeiger. Steuerzeichen raus, gekappt.
 *
 * ⚠️ Eigene Funktion statt `avesmapsNormalizeSingleLine`: die lebt in der Editor-Auth
 * (api/_internal/auth.php), und dieser Schreibweg soll ohne sie auskommen -- die Routine ruft
 * ihn mit einem Token auf, nicht mit einer Sitzung.
 *
 * 💣 GEKAPPT MIT PCRE, NICHT MIT mb_substr. Die erste Fassung nahm `mb_substr` -- und mbstring
 * ist keine Selbstverstaendlichkeit: der Testlauf des Projekts schaltet es eigens per
 * `-d extension=php_mbstring.dll` zu. Fehlt es, ist das ein FATAL, und ein Fatal antwortet mit
 * LEEREM Rumpf; der Aufrufer sieht „Unexpected end of JSON input" und sucht den Fehler im Netz.
 * Genau so ist dieser Endpunkt beim ersten Ablaufversuch gescheitert. `/u` an einem
 * PCRE-Muster braucht nur PCRE, und das ist immer da.
 * ⚠️ `.` mit `/su` zaehlt ZEICHEN, nicht Bytes -- ohne `/u` schnitte die Kappung mitten in ein
 * Umlaut-Byte, und der Zeiger truege kaputtes UTF-8, das `json_encode` spaeter verwirft.
 */
function avesmapsSvgExportKurzfeld(mixed $wert, int $max): string {
    $text = is_scalar($wert) ? (string) $wert : '';
    $text = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $text) ?? '';

    if (preg_match('/^.{0,' . max(1, $max) . '}/su', $text, $treffer) === 1) {
        $text = $treffer[0];
    } else {
        // Ungueltiges UTF-8 laesst /u scheitern -- dann byteweise kappen und alles
        // Nicht-ASCII wegwerfen, statt kaputte Zeichen in den Zeiger zu schreiben.
        $text = preg_replace('/[^\x20-\x7E]/', '', substr($text, 0, $max)) ?? '';
    }

    return trim($text);
}
