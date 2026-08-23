<?php

declare(strict_types=1);

/**
 * Die Ablage des semantischen SVG-Abzugs -- lesend, sonst nichts.
 * ---------------------------------------------------------------------------------------
 * Gebaut wird der Abzug NICHT hier -- er wird HINTERLEGT (svg-export-hinterlegen.php).
 * ZWEI Erzeuger, beide mit demselben Bauer (js/pages/svg-export-build.js):
 *   * der Owner auf /edit/svg-export.php, im Browser, mit seinen Reglern;
 *   * die naechtliche Routine (.github/workflows/svg-export-abzug.yml ->
 *     tools/svg-export/abzug-bauen.js) unter Node, mit festen Einstellungen.
 * Diese Datei findet nur den jeweils neuesten Abzug und beschreibt ihn.
 *
 * 🔴 WARUM NICHT IN PHP GEBAUT WIRD. Der Export ist 1.356 Zeilen Kartenbild in JavaScript.
 * Eine PHP-Fassung waere eine zweite Wahrheit ueber das Aussehen der Karte (AGENTS.md sec.5)
 * und muesste je Abruf ~21 MB JSON dekodieren -- auf STRATO genau die Last, die schon einmal
 * wie ein Datenbankausfall aussah (CLAUDE.md). Der Entwurf
 * docs/superpowers/specs/2026-08-14-svg-export-design.md hat das ausdruecklich verworfen.
 *
 * 💣 DER ZEIGER IST DIE WAHRHEIT, NICHT DAS VERZEICHNIS. `aktuell.json` nennt den Dateinamen;
 * die Ablage schreibt den Zeiger ZULETZT und auf einen Namen, den es vorher nicht gab. Wer
 * stattdessen "die neueste Datei im Verzeichnis" naehme, liefe genau in das Fenster, in dem
 * eine halb hochgeladene Datei die neueste ist.
 */

/**
 * Wo die Abzuege liegen. Ausserhalb von `api/`, neben den Datenbank-Backups, und per
 * .htaccess fuer den Browser gesperrt -- erreichbar ist der Abzug nur ueber den Endpunkt,
 * der den Token prueft. Ohne die Sperre waere der Dateiname das Passwort.
 * ⚠️ Das Verzeichnis liegt NICHT im Repo (auch nicht als leere Huelle mit .htaccess, anders
 * als uploads/db-backups): `uploads/` steht nicht in der Deploy-Allowlist, eine Repo-Kopie
 * kaeme also nie auf den Server und waere nur eine zweite, veraltende Fassung der Sperre.
 * Gemessen 23.08.2026: genau das ist beim Backup der Fall -- dessen Repo-Datei traegt CRLF,
 * seine PHP-Konstante LF, also schreibt es die Datei bei JEDEM Lauf neu.
 */
function avesmapsSvgExportAblageVerzeichnis(): string {
    return dirname(avesmapsApiRoot()) . DIRECTORY_SEPARATOR . 'uploads'
        . DIRECTORY_SEPARATOR . 'svg-export';
}

/**
 * Der Inhalt der Sperre -- beide Apache-Fassungen, wie bei uploads/db-backups und
 * uploads/dumps. 🔴 DIESE KONSTANTE IST DIE QUELLE, es gibt keine Kopie im Repo.
 */
const AVESMAPS_SVG_EXPORT_HTACCESS = "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n\n"
    . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n";

/**
 * Das Verzeichnis anlegen und seine Sperre (neu) schreiben.
 *
 * 🔴 DAS HAUSMUSTER, abgeschaut von `avesmapsDbBackupEnsureStorageDir` (db-dump.php) und
 * uploads/dumps: `uploads/` steht NICHT in der Deploy-Allowlist, die Sperre kommt also nie
 * von dort -- sie heilt sich zur LAUFZEIT. Die erste Fassung dieser Datei liess die
 * .htaccess stattdessen vom naechtlichen CI-Lauf hochladen; das repariert sie einmal pro
 * Nacht und nur, solange die CI laeuft, waehrend hier jede Anfrage genuegt.
 *
 * ⚠️ Geschrieben wird NUR, wenn Inhalt oder Datei fehlen -- und erst NACH dem Tokenriegel,
 * damit eine anonyme Anfrage keinen Schreibvorgang ausloest.
 */
function avesmapsSvgExportEnsureAblage(): string {
    $dir = avesmapsSvgExportAblageVerzeichnis();
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $htaccess = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (is_dir($dir)
        && (!is_file($htaccess) || @file_get_contents($htaccess) !== AVESMAPS_SVG_EXPORT_HTACCESS)) {
        @file_put_contents($htaccess, AVESMAPS_SVG_EXPORT_HTACCESS);
    }

    return $dir;
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
        // 💣 WER ihn erzeugt hat. Es gibt zwei Erzeuger -- die naechtliche Routine mit festen
        // Einstellungen und den Owner mit seinen Reglern --, und die Fassungsstempel nennen
        // den DATENstand, nicht den Erzeuger. Ohne diese Angabe kann ein Abrufer nicht wissen,
        // ob er einen geglaetteten Handabzug oder den ungeglaetteten der Routine bekommt.
        // ⚠️ Ein alter Zeiger ohne das Feld ist die Routine -- so hat es angefangen.
        'quelle' => ($zeiger['quelle'] ?? '') === 'manuell' ? 'manuell' : 'routine',
    ];
}

/**
 * Der Token: `$config['svg_export']['token']` aus `api/config.local.php`.
 *
 * 🔴 DORT SAMMELN SICH DIE TOKEN DIESES PROJEKTS, und zwar alle: `import_api.token`,
 * `discord.bot_token`, `changelog.app_token`, `social.*`. Ein eigener Ablageort fuer den
 * siebten Token waere eine zweite Stelle, an der jemand nach Zugangsdaten suchen muss -- und
 * genau diese Art von Doppelung hat das Projekt bei den Quellen schon einmal teuer bezahlt
 * (AGENTS.md sec.5, `lore_source`). Die erste Fassung dieser Datei las den Token stattdessen
 * aus einer Umgebungsvariablen, weil die Anforderung das Wort benutzte; das haette einen
 * `SetEnv`-Eintrag in einer nicht versionierten `.htaccess` gebraucht -- unsichtbar, an
 * mod_env gebunden, und die Variable haette bei JEDER Anfrage unter /api/ im `$_SERVER`
 * gestanden. Owner-Entscheid 23.08.2026: „unsere token werden in der config.local gesammelt".
 *
 * ⚠️ Die Umgebungsvariable `AVESMAPS_SVG_EXPORT_TOKEN` bleibt als ZWEITE Flaeche bestehen --
 * fuer einen Aufbau ohne `config.local.php` (Container, fremder Host). Sie ist der Rueckfall,
 * nicht der Hauptweg. Drei PHP-Flaechen werden gefragt, weil unter FastCGI/CGI ein `SetEnv`
 * je nach Aufbau in `$_SERVER` landet, waehrend `getenv()` leer bleibt -- das ist KEINE
 * zweite Quelle, sondern dieselbe Variable auf einem anderen Weg.
 *
 * 🔴 NIE aus der Adresse, nie aus der Datenbank.
 */
function avesmapsSvgExportConfiguredToken(array $config): string {
    $bereich = is_array($config['svg_export'] ?? null) ? $config['svg_export'] : [];
    $ausConfig = trim((string) ($bereich['token'] ?? ''));
    if ($ausConfig !== '') {
        return $ausConfig;
    }

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
