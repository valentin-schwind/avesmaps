<?php

declare(strict_types=1);

/**
 * Die Ablage des semantischen SVG-Abzugs -- lesend, sonst nichts.
 * ---------------------------------------------------------------------------------------
 * Gebaut wird der Abzug NICHT hier. Er entsteht im naechtlichen Lauf
 * (.github/workflows/svg-export-abzug.yml -> tools/svg-export/abzug-bauen.js) mit genau dem
 * Bauer, den auch /edit/svg-export.php im Browser benutzt. Diese Datei findet nur die
 * jeweils neueste Datei und beschreibt sie.
 *
 * 🔴 WARUM NICHT IN PHP GEBAUT WIRD. Der Export ist 1.356 Zeilen Kartenbild in JavaScript.
 * Eine PHP-Fassung waere eine zweite Wahrheit ueber das Aussehen der Karte (AGENTS.md sec.5)
 * und muesste je Abruf ~21 MB JSON dekodieren -- auf STRATO genau die Last, die schon einmal
 * wie ein Datenbankausfall aussah (CLAUDE.md). Der Entwurf
 * docs/superpowers/specs/2026-08-14-svg-export-design.md hat das ausdruecklich verworfen.
 *
 * 💣 DER ZEIGER IST DIE WAHRHEIT, NICHT DAS VERZEICHNIS. `aktuell.json` nennt den Dateinamen;
 * der Laeufer schreibt den Zeiger ZULETZT und auf einen Namen, den es vorher nicht gab. Wer
 * stattdessen "die neueste Datei im Verzeichnis" naehme, liefe genau in das Fenster, in dem
 * eine halb hochgeladene Datei die neueste ist.
 */

/**
 * Wo die Abzuege liegen. Ausserhalb von `api/`, neben den Datenbank-Backups, und per
 * .htaccess fuer den Browser gesperrt -- erreichbar ist der Abzug nur ueber den Endpunkt,
 * der den Token prueft. Ohne die Sperre waere der Dateiname das Passwort.
 */
function avesmapsSvgExportAblageVerzeichnis(): string {
    return dirname(avesmapsApiRoot()) . DIRECTORY_SEPARATOR . 'uploads'
        . DIRECTORY_SEPARATOR . 'svg-export';
}

/**
 * 💣 EIN NAME, KEIN PFAD. Der Zeiger ist eine Datei auf der Platte, aber sie kaeme bei einem
 * Fehlschlag des Laeufers auch halb geschrieben vor -- und ein `datei`-Feld mit `../` waere
 * ein Leseloch in den ganzen Webspace. Deshalb muss der Name exakt der Form entsprechen, die
 * der Laeufer vergibt: `abzug-<16 Hexstellen>.svg`.
 */
function avesmapsSvgExportDateinameGueltig(string $datei): bool {
    return preg_match('/^abzug-[0-9a-f]{16}\.svg$/', $datei) === 1;
}

/**
 * Was in einen `Content-Disposition`-Kopf darf. Anfuehrungszeichen, Zeilenumbrueche und
 * Steuerzeichen fliegen raus -- ein Kopf, dessen Wert aus einer Datei stammt, ist sonst eine
 * Einladung, weitere Koepfe einzuschleusen.
 */
function avesmapsSvgExportDateinameSaeubern(string $name): string {
    $sauber = preg_replace('/[^A-Za-z0-9._-]/', '-', $name) ?? '';
    $sauber = trim($sauber, '-.');

    return $sauber !== '' ? $sauber : 'avesmaps-karte.svg';
}

/**
 * Den Zeiger lesen. Gibt `null` zurueck, wenn es (noch) keinen gibt oder er unbrauchbar ist --
 * der Aufrufer macht daraus eine ehrliche Absage, nie eine leere Datei.
 */
function avesmapsSvgExportZeigerLesen(string $verzeichnis): ?array {
    $pfad = $verzeichnis . DIRECTORY_SEPARATOR . 'aktuell.json';
    if (!is_file($pfad) || !is_readable($pfad)) {
        return null;
    }

    $roh = file_get_contents($pfad);
    if (!is_string($roh) || trim($roh) === '') {
        return null;
    }

    try {
        $zeiger = json_decode($roh, true, 8, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }

    if (!is_array($zeiger) || !is_string($zeiger['datei'] ?? null)) {
        return null;
    }

    return avesmapsSvgExportDateinameGueltig($zeiger['datei']) ? $zeiger : null;
}

/**
 * Der auszuliefernde Abzug, fertig beschrieben: Pfad, Groesse, ETag, Dateiname, Fassungen.
 * `null` heisst: es liegt noch keiner da.
 *
 * 💣 DER ETAG WIRD GEGEN DIE ECHTE DATEIGROESSE GEPRUEFT. Der Zeiger traegt den Hash, den der
 * Laeufer beim Schreiben gebildet hat -- das spart, 8 MB je Abruf zu hashen. Stimmt die
 * gespeicherte Groesse aber nicht mit der Datei ueberein (abgebrochener Upload, halbe Datei),
 * dann gehoert der Hash nicht zu diesen Bytes, und ein ETag, der auf fremden Inhalt zeigt,
 * ist schlimmer als gar keiner: der Client bekaeme spaeter ein 304 auf eine kaputte Kopie.
 * In dem Fall wird neu gehasht -- selten, und die einzige ehrliche Antwort.
 */
function avesmapsSvgExportAbzug(string $verzeichnis): ?array {
    $zeiger = avesmapsSvgExportZeigerLesen($verzeichnis);
    if ($zeiger === null) {
        return null;
    }

    $pfad = $verzeichnis . DIRECTORY_SEPARATOR . $zeiger['datei'];
    if (!is_file($pfad) || !is_readable($pfad)) {
        return null;
    }

    $groesse = filesize($pfad);
    if ($groesse === false || $groesse <= 0) {
        return null;
    }

    $etag = is_string($zeiger['etag'] ?? null) ? trim($zeiger['etag']) : '';
    $gemeldeteGroesse = (int) ($zeiger['bytes'] ?? 0);
    if ($etag === '' || $gemeldeteGroesse !== $groesse) {
        $hash = hash_file('sha256', $pfad);
        $etag = is_string($hash) ? '"' . $hash . '"' : '';
    }

    if ($etag === '') {
        return null;
    }

    return [
        'pfad' => $pfad,
        'bytes' => $groesse,
        'etag' => $etag,
        'dateiname' => avesmapsSvgExportDateinameSaeubern(
            is_string($zeiger['dateiname'] ?? null) ? $zeiger['dateiname'] : 'avesmaps-karte.svg'
        ),
        'kartenfassung' => (string) ($zeiger['kartenfassung'] ?? ''),
        'landschaftsfassung' => (string) ($zeiger['landschaftsfassung'] ?? ''),
        'exportiert' => (string) ($zeiger['exportiert'] ?? ''),
    ];
}

/**
 * Der Token, und zwar AUSSCHLIESSLICH aus der Umgebung -- nie aus config.local.php, nie aus
 * der Adresse, nie aus der Datenbank.
 *
 * ⚠️ DREI PHP-FLAECHEN DERSELBEN UMGEBUNGSVARIABLE. Unter FastCGI/CGI -- und STRATO faehrt
 * PHP als CGI -- landet ein `SetEnv` je nach Aufbau in `$_SERVER`, waehrend `getenv()` leer
 * bleibt (und umgekehrt bei einer echten Prozessumgebung). Alle drei zu fragen ist KEIN
 * Rueckfall auf eine andere Quelle: es ist dieselbe Variable, nur der Weg, auf dem PHP sie
 * anbietet, ist nicht vorhersagbar.
 */
function avesmapsSvgExportToken(): string {
    foreach ([getenv('AVESMAPS_SVG_EXPORT_TOKEN'),
              $_SERVER['AVESMAPS_SVG_EXPORT_TOKEN'] ?? null,
              $_ENV['AVESMAPS_SVG_EXPORT_TOKEN'] ?? null] as $wert) {
        if (is_string($wert) && trim($wert) !== '') {
            return trim($wert);
        }
    }

    return '';
}

/**
 * Der Bearer-Token aus dem `Authorization`-Kopf.
 *
 * 🔴 NUR AUS DEM KOPF. Ein Token in der Adresse steht im Serverprotokoll, im Referrer und im
 * Browserverlauf -- deshalb liest diese Funktion `$_GET` bewusst nicht an, und ein Test haelt
 * das fest.
 * ⚠️ Apache reicht `Authorization` nicht in jedem Aufbau an CGI weiter; dann steht er unter
 * `REDIRECT_HTTP_AUTHORIZATION` oder ist nur ueber apache_request_headers() zu haben.
 */
function avesmapsSvgExportBearerAusAnfrage(array $server): string {
    $kandidaten = [
        $server['HTTP_AUTHORIZATION'] ?? null,
        $server['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    ];

    if (function_exists('apache_request_headers')) {
        $koepfe = apache_request_headers();
        if (is_array($koepfe)) {
            foreach ($koepfe as $name => $wert) {
                if (strcasecmp((string) $name, 'Authorization') === 0) {
                    $kandidaten[] = $wert;
                }
            }
        }
    }

    foreach ($kandidaten as $kandidat) {
        if (!is_string($kandidat)) {
            continue;
        }
        if (preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $kandidat, $treffer) === 1) {
            return $treffer[1];
        }
    }

    return '';
}

/**
 * Zeitgleicher Vergleich. Ein leerer erwarteter Token darf NIE passen -- sonst oeffnete eine
 * vergessene Umgebungsvariable den Endpunkt fuer jeden, der irgendetwas schickt.
 */
function avesmapsSvgExportTokenPasst(string $erwartet, string $gegeben): bool {
    if ($erwartet === '' || $gegeben === '') {
        return false;
    }

    return hash_equals($erwartet, $gegeben);
}
