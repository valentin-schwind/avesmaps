<?php

declare(strict_types=1);

/**
 * DIE ALTLAST IN DEN WAPPENFELDERN AUFRAEUMEN.
 *
 * 🔴 Owner 23.08.2026: „ja, weg damit". Der Wiki-Abgleich las bis heute
 * `wappen|bild|wappenbild|bilddatei` in EIN Feld. Hatte ein Ort im Wiki kein Wappen, aber ein Foto
 * in der Infobox, landete das Foto im WAPPENFELD -- und wurde danach ueberall wie ein Wappen
 * behandelt und geladen. Der Parser liest seit d0c057c4 nur noch `wappen|wappenbild`, aber er
 * SETZT das Feld nur, er raeumt es nicht: der Altbestand bleibt, bis jemand ihn wegnimmt.
 *
 * 💣 NEU PARSEN GEHT NICHT. Der naheliegende Weg -- den Wikitext noch einmal durch den neuen
 * Parser schicken -- ist versperrt: `wiki_sync_pages.details_json` ist ein Cache der bereits
 * GEPARSTEN Infobox und traegt damit schon die alte, falsche URL. Der Rohtext liegt nicht vor.
 *
 * 🔴 DESHALB EINE REGEL, DIE EIN MENSCH PRUEFEN MUSS -- und ein Probelauf ist die Vorgabe.
 * Die Regel: ein Wappen heisst im Wiki „Wappen …". Was anders heisst, ist ein Kandidat.
 * ⚠️ Das ist eine HEURISTIK, keine Wahrheit. Sie darf nie ungesehen scharf laufen, und genau
 * dafuer gibt es `dry_run` als Vorgabe: der Lauf zeigt erst jede betroffene Zeile mit Ortsnamen
 * und Dateinamen, und erst ein ausdrueckliches `confirm` schreibt.
 *
 * 🔴 EIGENE UPLOADS BLEIBEN UNANGETASTET. Die Weiche ist `coat.source`: `own` heisst „ein Mensch
 * hat das hochgeladen" und wird nie angefasst -- egal wie die Datei heisst. Angefasst wird nur,
 * was der Sync selbst geschrieben hat.
 */

// 💣 Die Lib laedt ihre Nachbarn SELBST. Sie tat es zuerst nicht -- im Endpunkt waren
// avesmapsWikiSyncNextMapRevision/-EncodeJson/-WriteMapAuditLog zufaellig schon da, weil
// settlements.php sie mitbringt. Allein geladen war der scharfe Lauf ein Fatal Error, und ein
// Fatal antwortet mit LEEREM Rumpf: im Browser „Unexpected end of JSON input", also wie ein
// Netzfehler. Gefunden hat es der Ablauftest, nicht das Lesen.
require_once __DIR__ . '/sync.php';
require_once __DIR__ . '/locations-helpers.php';

// Was als Wappen durchgeht. ⚠️ Bewusst grosszuegig: lieber ein Foto uebersehen als ein echtes
// Wappen loeschen -- das Loeschen ist die unumkehrbare Richtung.
const AVESMAPS_WAPPEN_AUFRAEUMEN_MUSTER = '/wappen|coat|arms|blason|blazon/iu';
// Obergrenze fuer EINE Fahrt. ⚠️ Bewusst klein: jede geraeumte Zeile schreibt eine
// Protokollzeile mit ihrem vollen Vorzustand, und ein Lauf ueber tausende Orte laesst
// `map_audit_log` in einem Rutsch volllaufen -- die Tabelle, die schon einmal 716 MB gross war
// und die Datenbank gesperrt hat. Der Client wiederholt, wie bei jedem Massenlauf hier
// (STRATO hat keinen Cron).
const AVESMAPS_WAPPEN_AUFRAEUMEN_MAX = 200;

/**
 * PUR: Sieht dieser Dateiname nach einem Wappen aus?
 *
 * ⚠️ Der Vergleich laeuft auf dem DEKODIERTEN Namen: in der Adresse steht „Wappen%20Gareth.png",
 * und ein Muster gegen die rohe Form fiele ueber jedes Leerzeichen.
 */
function avesmapsWappenNameSiehtNachWappenAus(string $url): bool {
    $pfad = (string) parse_url(trim($url), PHP_URL_PATH);
    $datei = rawurldecode((string) basename($pfad !== '' ? $pfad : trim($url)));
    if ($datei === '') {
        return false;
    }
    return preg_match(AVESMAPS_WAPPEN_AUFRAEUMEN_MUSTER, $datei) === 1;
}

/**
 * PUR: Was ist mit dem Wappenfeld dieses Ortes zu tun?
 *
 * @return array{tun:bool,grund:string,datei:string}
 */
function avesmapsWappenAufraeumenUrteil(array $props): array {
    $coat = $props['coat'] ?? null;
    if (!is_array($coat)) {
        return ['tun' => false, 'grund' => 'kein Wappenfeld', 'datei' => ''];
    }
    $url = trim((string) ($coat['url'] ?? ''));
    if ($url === '') {
        return ['tun' => false, 'grund' => 'leer', 'datei' => ''];
    }

    // 🔴 Eigene Uploads sind tabu -- ein Mensch hat sie ausgewaehlt.
    if ((string) ($coat['source'] ?? '') === 'own') {
        return ['tun' => false, 'grund' => 'eigener Upload', 'datei' => basename($url)];
    }

    $pfad = (string) parse_url($url, PHP_URL_PATH);
    $datei = rawurldecode((string) basename($pfad !== '' ? $pfad : $url));

    // ⚠️ Eine lokal abgelegte Kopie sagt NICHTS ueber den Ursprung: ihr Name ist ein sha1-Hash
    // (/uploads/wappen/cache/<hash>.png). Sie ist kein Beleg dafuer, dass es ein Wappen IST --
    // aber auch keiner fuers Gegenteil, und ohne Beleg wird nicht geloescht.
    if (preg_match('/^[0-9a-f]{40}\./', $datei) === 1) {
        return ['tun' => false, 'grund' => 'lokale Kopie, Ursprung nicht erkennbar', 'datei' => $datei];
    }

    if (avesmapsWappenNameSiehtNachWappenAus($url)) {
        return ['tun' => false, 'grund' => 'heisst nach Wappen', 'datei' => $datei];
    }

    return ['tun' => true, 'grund' => 'kein Wappenname -- vermutlich ein Infobox-Bild', 'datei' => $datei];
}

/**
 * Der Lauf. `$scharf === false` (Vorgabe) aendert NICHTS und liefert nur die Liste.
 *
 * @return array{gesehen:int,kandidaten:int,geraeumt:int,weitere_moeglich:bool,liste:list<array{ort:string,datei:string,grund:string}>}
 */
function avesmapsWappenAufraeumenLauf(PDO $pdo, bool $scharf = false, int $userId = 0, int $limit = 0): array {
    $fenster = $limit > 0 ? min($limit, AVESMAPS_WAPPEN_AUFRAEUMEN_MAX) : AVESMAPS_WAPPEN_AUFRAEUMEN_MAX;

    // ⚠️ Der Vorfilter holt jede Zeile MIT Wappenfeld, nicht nur die Kandidaten -- welche
    // Kandidaten sind, entscheidet erst das Urteil in PHP. `gesehen` ist deshalb das Fenster,
    // nicht der Gesamtbestand.
    $stmt = $pdo->prepare('SELECT id, public_id, name, feature_subtype, properties_json FROM map_features
        WHERE feature_type = :typ AND properties_json LIKE :muster
        ORDER BY id LIMIT ' . (int) $fenster);
    // 💣 Jeder Platzhalter genau EINMAL: avesmapsCreatePdo setzt ATTR_EMULATE_PREPARES=false,
    // und MySQL lehnt eine Wiederholung mit HY093 ab.
    $stmt->execute([':typ' => 'location', ':muster' => '%"coat"%']);

    $gesehen = 0;
    $liste = [];
    $zuRaeumen = [];
    foreach ($stmt as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($props)) {
            continue;
        }
        $gesehen++;
        $urteil = avesmapsWappenAufraeumenUrteil($props);
        if (!$urteil['tun']) {
            continue;
        }
        $liste[] = [
            'ort' => (string) ($row['name'] ?? ''),
            'public_id' => (string) ($row['public_id'] ?? ''),
            'datei' => $urteil['datei'],
            'grund' => $urteil['grund'],
        ];
        $zuRaeumen[] = ['row' => $row, 'props' => $props];
    }

    $weitere = $gesehen >= $fenster;

    if (!$scharf || $zuRaeumen === []) {
        return [
            'ok' => true,
            'dry_run' => !$scharf,
            'gesehen' => $gesehen,
            'kandidaten' => count($liste),
            'geraeumt' => 0,
            'weitere_moeglich' => $weitere,
            'liste' => $liste,
        ];
    }

    // ⚠️ EIN Revisionswechsel fuer die ganze Fahrt, nicht einer je Zeile: die Revision bricht
    // das ETag der Kartennutzlast, und das muss genau einmal passieren.
    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $geraeumt = 0;
    foreach ($zuRaeumen as $eintrag) {
        $row = $eintrag['row'];
        $props = $eintrag['props'];
        unset($props['coat']);
        // 🔴 KEIN coat_none: „hier stand faelschlich ein Foto" ist NICHT dasselbe wie „dieser
        // Ort soll kein Wappen haben". Der naechste Abgleich darf hier wieder ein echtes Wappen
        // eintragen -- genau das ist der erwuenschte Ausgang, und der einzige Rueckweg, den es gibt.
        $update->execute([
            'pj' => avesmapsWikiSyncEncodeJson($props),
            'rev' => $revision,
            'id' => (int) $row['id'],
        ]);
        // 🔴 Eine Spur je geraeumtem Ort. Der vergleichbare Massenlauf (BulkRecordCoats)
        // protokolliert nicht -- aber der FUELLT, und dieser hier LOESCHT. Ohne Protokoll ist nach
        // der Fahrt nicht mehr feststellbar, was in dem Feld stand.
        avesmapsWappenAufraeumenProtokoll($pdo, $row, $props, $revision, $userId);
        $geraeumt++;
    }

    return [
        'ok' => true,
        'dry_run' => false,
        'gesehen' => $gesehen,
        'kandidaten' => count($liste),
        'geraeumt' => $geraeumt,
        'weitere_moeglich' => $weitere,
        'revision' => $revision,
        'liste' => $liste,
    ];
}

/**
 * Eine Protokollzeile fuer einen geraeumten Ort. ⚠️ Der Schreiber wohnt in einer anderen Lib;
 * fehlt er, wird geraeumt OHNE Spur -- das ist schlechter als gar nicht zu raeumen, deshalb sagt
 * es der Aufrufer nicht still, sondern gar nicht: `function_exists` faengt nur den Fall, dass
 * dieses Modul einmal ohne seinen Nachbarn geladen wird.
 */
function avesmapsWappenAufraeumenProtokoll(PDO $pdo, array $row, array $neueProps, int $revision, int $userId): void {
    if (!function_exists('avesmapsWikiSyncWriteMapAuditLog') || empty($row['id'])) {
        return;
    }
    avesmapsWikiSyncWriteMapAuditLog(
        $pdo,
        (int) $row['id'],
        'wappen_aufraeumen',
        $userId,
        avesmapsWikiSyncEncodeJson($row),
        avesmapsWikiSyncEncodeJson([
            'public_id' => (string) ($row['public_id'] ?? ''),
            'feature_type' => 'location',
            'name' => (string) ($row['name'] ?? ''),
            'properties_json' => $neueProps,
            'revision' => $revision,
        ])
    );
}
