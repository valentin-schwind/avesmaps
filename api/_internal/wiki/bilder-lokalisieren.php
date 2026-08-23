<?php

declare(strict_types=1);

/**
 * WIKI-BILDER LOKALISIEREN -- holt jedes Bild EINMAL auf unsere Platte, damit es nie wieder
 * geholt werden muss.
 *
 * 🔴 Owner-Auftrag 23.08.2026. Vorgeschichte: `avesmapsWikiSyncMonitorLocalizeCoats` deckt
 * ausschliesslich TERRITORIEN ab (es liest `political_territory_wiki_test`) und meldete deshalb
 * „✓ alle lokal", waehrend drei weitere Bestaende nie erfasst waren. Was von denen im Cache lag,
 * lag dort, weil zufaellig mal jemand die Seite geoeffnet hatte -- zehn Dateien. Alles andere
 * wurde bei JEDEM Seitenaufbau neu beim Wiki angefragt, und genau diese Endlosschleife hat uns
 * zweimal die Sperre unserer Ausgangs-IP eingebracht.
 *
 * ⚠️ „Wappen" ist bei zweien der drei der falsche Name, und der Owner hat das zu Recht angemerkt:
 * ein Wappen gibt es nur bei ORTEN und Territorien. Bei Regionen liest der Parser
 * `bild|wappen|bilddatei|wappenbild`, bei Wegen nur `bild|bilddatei` -- das sind
 * Infobox-BILDER. Dass alle drei durch `avesmapsWikiSyncMonitorCoatOfArmsUrl` gebaut werden,
 * ist der Grund, warum im Code ueberall „coat" steht. Hier heisst es deshalb Bild, nicht Wappen.
 *
 * ⭐ DER TRICK, DER DAS KLEIN MACHT: die Datei landet in `/uploads/wappen/cache/<sha1>.<ext>` --
 * genau dort, wo `avesmapsCoatLokaleKopie` ohnehin nachschaut. Kein Schema-Wechsel, keine
 * Migration, kein zweites Override-System. Die Wiki-Adresse in der Datenbank bleibt unberuehrt
 * (sie ist die Staging-Wahrheit „das Wiki nennt diese Datei"); nur die AUSGABE zeigt ab dem
 * naechsten Aufruf auf unsere Platte.
 *
 * 💣 EIN GRABSTEIN FUER DAS, WAS ES NICHT GIBT. Ein grosser Teil dieser Adressen ist tot: sie
 * werden aus einem DATEINAMEN gebaut, auch wenn das Bild von uns stammt und im Wiki nie
 * existiert hat (Owner: „die gibts überhaupt nicht im wiki, die sind alle von uns"). Ohne
 * Vermerk versuchte jeder Lauf dieselben hunderte toten Adressen erneut -- der Lauf kaeme nie
 * ans Ende und das Wiki bekaeme bei jedem Anlauf dieselbe Flut. Ein Fehlschlag hinterlaesst
 * darum `<sha1>.tot`; `reset` raeumt die Grabsteine weg, sonst nichts.
 */

require_once __DIR__ . '/datei-riegel.php';
// avesmapsWikiSyncMonitorHttpGetBinary + …ImageExtension -- der gemeinsame Binaer-Fetcher.
require_once __DIR__ . '/sync-monitor-identity.php';
require_once __DIR__ . '/../coat-url.php';

// Wie viele Bilder ein Aufruf hoechstens holt. Der Client ruft wiederholt, bis remaining = 0 --
// dasselbe Muster wie beim Territorien-Lauf und beim Autoget (STRATO hat keinen Cron, und ein
// langer Lauf in einem Request belegt einen PHP-Worker; siehe AGENTS.md §10).
const AVESMAPS_WIKI_BILDER_BATCH = 10;
// Pause zwischen zwei Abrufen. 🔴 Das Wiki hat uns zweimal gesperrt -- hier wird nicht optimiert.
const AVESMAPS_WIKI_BILDER_PAUSE_MS = 800;
// Obergrenze fuer die Kandidatensuche, damit der Scan einen Request nicht sprengt.
const AVESMAPS_WIKI_BILDER_SCAN_MAX = 20000;

/**
 * PUR: die Bildadressen, die in EINEM properties_json stecken.
 *
 * 🔴 Vier Felder, und die Liste ist die Umkehrung dessen, was `map-features.php` an seiner
 * Rueckgabe bindet. Laufen die beiden auseinander, holt der Lokalisierer etwas, das nie
 * ausgegeben wird -- oder schlimmer: die Ausgabe zeigt auf etwas, das er nie holt.
 *
 * @return list<string>
 */
function avesmapsWikiBilderAdressenAusProperties(array $props): array {
    $raus = [];
    // Das eigene Wappen des Ortes (kann eine Wiki-Adresse tragen, wenn nie lokalisiert wurde).
    if (is_array($props['coat'] ?? null) && is_string($props['coat']['url'] ?? null)) {
        $raus[] = $props['coat']['url'];
    }
    foreach ([['wiki_settlement', 'wappen_url'], ['wiki_region', 'image_url'], ['wiki_path', 'image_url']] as [$nest, $feld]) {
        if (is_array($props[$nest] ?? null) && is_string($props[$nest][$feld] ?? null)) {
            $raus[] = $props[$nest][$feld];
        }
    }
    return array_values(array_filter($raus, static fn (string $u): bool => avesmapsWikiDateiIstWikiHost($u)));
}

/** Liegt diese Adresse schon bei uns? (Bild vorhanden ODER als tot vermerkt.) */
function avesmapsWikiBilderErledigt(string $docroot, string $url): bool {
    $key = sha1($url);
    $dir = $docroot . '/uploads/wappen/cache/';
    if (is_file($dir . $key . '.tot')) {
        return true;
    }
    foreach (['png', 'jpg', 'svg', 'gif', 'webp'] as $ext) {
        if (is_file($dir . $key . '.' . $ext)) {
            return true;
        }
    }
    return false;
}

/**
 * Alle noch offenen Bildadressen. Entdoppelt ueber die Adresse selbst -- dieselbe Datei haengt
 * an vielen Objekten (ein Regionsbild an jedem Label der Region), und sie soll einmal geholt
 * werden, nicht einmal je Objekt.
 *
 * @return list<array{url:string,art:string,name:string}>
 */
function avesmapsWikiBilderOffeneAdressen(PDO $pdo, string $docroot, int $limit = 0): array {
    $gesehen = [];
    $offen = [];
    $sql = 'SELECT public_id, name, feature_type, properties_json FROM map_features
            WHERE properties_json LIKE :muster LIMIT ' . (int) AVESMAPS_WIKI_BILDER_SCAN_MAX;
    $stmt = $pdo->prepare($sql);
    // 💣 EIN Platzhalter, EINMAL verwendet: avesmapsCreatePdo setzt ATTR_EMULATE_PREPARES=false,
    // und MySQL lehnt denselben benannten Platzhalter zweimal im Statement mit HY093 ab.
    $stmt->execute([':muster' => '%wiki-aventurica.de%']);

    foreach ($stmt as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($props)) {
            continue;
        }
        foreach (avesmapsWikiBilderAdressenAusProperties($props) as $url) {
            if (isset($gesehen[$url])) {
                continue;
            }
            $gesehen[$url] = true;
            if (avesmapsWikiBilderErledigt($docroot, $url)) {
                continue;
            }
            $offen[] = [
                'url' => $url,
                'art' => (string) ($row['feature_type'] ?? ''),
                'name' => (string) ($row['name'] ?? ''),
            ];
            if ($limit > 0 && count($offen) >= $limit) {
                return $offen;
            }
        }
    }
    return $offen;
}

/**
 * EIN Lauf: holt bis zu AVESMAPS_WIKI_BILDER_BATCH Bilder und meldet, wie viele noch offen sind.
 *
 * 🔴 Nur HIER wird die Riegel-Ausnahme gesetzt, und sie wird im `finally` wieder
 * zurueckgenommen -- auch wenn mittendrin etwas wirft. Ein Lauf, der die Freigabe stehen laesst,
 * oeffnet den Riegel fuer alles Uebrige, was in derselben Anfrage noch passiert.
 *
 * @return array{geholt:int,tot:int,remaining:int,details:list<array{name:string,datei:string,ergebnis:string}>}
 */
function avesmapsWikiBilderLokalisierenLauf(PDO $pdo, string $docroot): array {
    $dir = $docroot . '/uploads/wappen/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $kandidaten = avesmapsWikiBilderOffeneAdressen($pdo, $docroot, AVESMAPS_WIKI_BILDER_BATCH);
    $geholt = 0;
    $tot = 0;
    $details = [];

    avesmapsWikiLokalisierungLaeuft(true);
    try {
        foreach ($kandidaten as $i => $k) {
            if ($i > 0) {
                usleep(AVESMAPS_WIKI_BILDER_PAUSE_MS * 1000);
            }
            $key = sha1($k['url']);
            $antwort = avesmapsWikiSyncMonitorHttpGetBinary($k['url']);
            $ext = is_array($antwort)
                ? avesmapsWikiSyncMonitorImageExtension((string) ($antwort['content_type'] ?? ''), $k['url'])
                : null;

            // 💣 Der Schluessel heisst `bytes`, nicht `body` -- an der Quelle geprueft
            // (sync-monitor-identity.php). Mit `body` waere jedes ERFOLGREICH geholte Bild
            // als leer durchgefallen und haette einen Grabstein bekommen: der Lauf haette
            // gemeldet, im Wiki gebe es nichts davon.
            if (!is_array($antwort) || $ext === null || ($antwort['bytes'] ?? '') === '') {
                // Grabstein: diese Adresse gibt es nicht (oder liefert kein Bild). Ohne ihn
                // versucht jeder kuenftige Lauf dieselbe tote Adresse erneut.
                @file_put_contents($dir . '/' . $key . '.tot', gmdate('c') . ' ' . $k['url']);
                $tot++;
                $details[] = ['name' => $k['name'], 'datei' => basename($k['url']), 'ergebnis' => 'nicht im Wiki'];
                continue;
            }

            // Atomar schreiben (temp + rename), damit ein gleichzeitiger Leser nie ein halbes Bild
            // bekommt. Kein LOCK_EX -- der Temp-Name ist pro Prozess eindeutig (NFS, AGENTS.md §10).
            $ziel = $dir . '/' . $key . '.' . $ext;
            $tmp = $ziel . '.tmp.' . getmypid();
            if (@file_put_contents($tmp, (string) $antwort['bytes']) !== false && !@rename($tmp, $ziel)) {
                @unlink($tmp);
            }
            $geholt++;
            $details[] = ['name' => $k['name'], 'datei' => basename($k['url']), 'ergebnis' => 'geholt'];
        }
    } finally {
        avesmapsWikiLokalisierungLaeuft(false);
    }

    return [
        'geholt' => $geholt,
        'tot' => $tot,
        'remaining' => count(avesmapsWikiBilderOffeneAdressen($pdo, $docroot)),
        'details' => $details,
    ];
}

/** Nur zaehlen, nichts holen -- fuer die Statuszeile am Knopf. */
function avesmapsWikiBilderStatus(PDO $pdo, string $docroot): array {
    return ['remaining' => count(avesmapsWikiBilderOffeneAdressen($pdo, $docroot))];
}

/**
 * Raeumt die Grabsteine weg, damit tote Adressen noch einmal versucht werden.
 *
 * ⚠️ Loescht NUR `.tot`-Marker, nie ein Bild. Ein Lauf danach fragt das Wiki erneut nach allem,
 * was beim letzten Mal nicht da war -- das ist der teure Fall und deshalb ein eigener Knopf.
 */
function avesmapsWikiBilderGrabsteineLoeschen(string $docroot): int {
    $n = 0;
    foreach ((array) @glob($docroot . '/uploads/wappen/cache/*.tot') as $datei) {
        if (@unlink((string) $datei)) {
            $n++;
        }
    }
    return $n;
}
