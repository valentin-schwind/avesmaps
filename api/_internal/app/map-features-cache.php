<?php

declare(strict_types=1);

// Ganzkoerper-Dateicache fuer die Kartennutzlast.
//
// 💣 DER TEUERSTE ABRUF DER GANZEN SEITE. `api/app/map-features.php` baut bei JEDER 200 die volle
// Nutzlast neu: 14 Loader-Posten, ein Vollscan ueber `wiki_sync_pages`, der komplette
// `feature_sources`-Join und rund 2.000-3.000 ungecachte `is_file()`-Aufrufe. Live gemessen am
// 26.08.2026: 2,1-2,5 s Serverzeit, ~3 MB gzip, ~20 MB entpackt -- und das bei jedem Besuch.
//
// Vorbild ist der Schnellpfad des Politik-Layers (territories-endpoint.php): fertige Bytes unter
// einem Stempel ablegen und beim naechsten Mal roh hinausschreiben.
//
// 🔴 ABER DER SCHLUESSEL KANN HIER NICHT VOR DEM PDO STEHEN. Der Politik-Layer bildet ihn aus
// `$_GET` allein und kommt deshalb ohne Datenbank aus. Unser Stempel ist der ETag, und der braucht
// vier Lesevorgaenge (map_revision, Klimastempel, Tempostempel, Staettenstempel). Die sind billig;
// teuer ist alles,
// was DANACH kommt -- und genau das faellt weg. Der Schnellpfad sitzt deshalb direkt hinter der
// 304-Pruefung, nicht vor dem Verbindungsaufbau.
//
// 💣 UND ER HAT EINE FRIST, OBWOHL ER NACH DEM ETAG SCHLUESSELT -- das ist die tragende
// Entscheidung dieser Datei. Der ETag-Keim deckt Nutzlastversion, `map_revision`, bbox,
// since_revision, edit_mode sowie Klima-, Tempo- und Staettenstempel ab (der letzte seit dem
// 02.09.2026, fuer `settlement_place` -- siehe avesmapsSettlementPlaceReadStamp). Er deckt NICHT ab: die beiden
// Wappen-Schalter, den Notaus fuer Siedlungsbilder, die Wiki-Tabellen und `feature_sources`.
// Aendert sich eines davon, ohne dass `map_revision` sich bewegt, dann behaelt heute ein WARMER
// Client seine alte Kopie (er bekommt eine 304) -- ein kalter bekommt frische Daten. Ein Cache
// OHNE Frist wuerde daraus „auch jeder kalte Client bekommt die alten Daten", und zwar unbegrenzt
// lange. Mit Frist gilt stattdessen: hoechstens `AVESMAPS_MAP_FEATURES_CACHE_TTL_SECONDS` fuer
// ALLE. Fuer warme Clients ist das eine Verbesserung (vorher: nie), fuer kalte ein begrenzter
// Preis. Genau diese Falle hat der Wappen-Notaus schon einmal vier Monate lang getragen.
// 🔧 Der saubere Weg waere, die fehlenden Eingaben in den Keim zu nehmen. Das kostet drei weitere
// `app_setting`-Lesevorgaenge und einmalig einen Volltransfer fuer jeden warmen Client (der Keim
// aendert sich), und es ist deshalb bewusst NICHT Teil dieser Aenderung.
//
// 🔴 NUR DIE VOLLE NUTZLAST. Abrufe mit `bbox` oder `since_revision` sind der Delta-Pfad des
// Live-Sync: klein, billig und in vielen Auspraegungen. Sie zu cachen wuerde den Vorrat mit
// Eintraegen fluten, die niemand ein zweites Mal anfragt -- und dabei genau die zwei bis drei
// Dateien verdraengen, um die es geht.
//
// ⚠️ STRATO-QUOTE: ein Eintrag ist ~3 MB. Der Vorrat ist deshalb hart auf wenige Dateien
// gedeckelt, wie beim SVG-Abzug und beim Datenbank-Backup. Ein voller Speicher entzieht auf
// diesem Wirt die Schreibrechte der Datenbank (Fehler 1142) -- das ist kein theoretisches Risiko.

// Wie lange ein abgelegter Rumpf gelten darf. Bewusst dieselbe Groessenordnung wie der
// Politik-Layer (300 s): laenger waere fuer die nicht vom Keim gedeckten Eingaben oben zu lang.
const AVESMAPS_MAP_FEATURES_CACHE_TTL_SECONDS = 300;

// Wieviele Rumpfe hoechstens liegen bleiben. Jeder Sprung von `map_revision` erzeugt einen neuen
// Schluessel; ohne Deckel waechst der Vorrat mit jeder Bearbeitung.
// ⚠️ 4 statt 3: die oeffentliche und die Editor-Auspraegung leben gleichzeitig, und beide sollen
// einen Vorgaenger ueberleben duerfen, ohne sich gegenseitig hinauszuwerfen.
const AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES = 4;

function avesmapsMapFeaturesCacheDir(): string {
    $dir = sys_get_temp_dir() . '/avesmaps_map_features_cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

// 🔴 EIN DELTA TRAEGT KEINE GLOBALEN BLOECKE. Der Live-Abgleich des Editors (pollLiveMapUpdates,
// js/routing/routing.js) liest aus einer since_revision-Antwort NUR `features` und `revision`;
// Quellenkatalog, Verweise, Korpora, Kanon und Innerorts-Objekte kommen ausschliesslich im Vollabruf
// an (routing.js, das `.then` der routeDataRequest). Gemessen 03.09.2026: 6,47 MB und 1,13 s fuer
// null geaenderte Features, alle 15 s nach jeder fremden Speicherung.
// ⚠️ Nur `since_revision` entscheidet -- eine bbox-Anfrage ist ein gekuerzter VOLLabruf und behaelt
// alles, was ihre Popups brauchen.
function avesmapsMapFeaturesIstDeltaAbruf(array $queryParams): bool {
    return trim((string) ($queryParams['since_revision'] ?? '')) !== '';
}

/**
 * Darf dieser Abruf ueberhaupt aus dem Vorrat bedient werden?
 *
 * 🔴 Nur die volle Nutzlast -- siehe die Begruendung im Kopf. `bbox` und `since_revision` sind der
 * Delta-Pfad und gehoeren nicht hierher.
 */
function avesmapsMapFeaturesCacheEligible(array $queryParams): bool {
    return trim((string) ($queryParams['bbox'] ?? '')) === ''
        && trim((string) ($queryParams['since_revision'] ?? '')) === '';
}

/**
 * Der Dateiname zu einem ETag.
 *
 * 💣 Ueber einen Hash, nie ueber den ETag selbst: der traegt `W/"..."` und damit Zeichen, die in
 * keinen Dateinamen gehoeren -- Anfuehrungszeichen und Schraegstrich.
 */
function avesmapsMapFeaturesCacheFile(string $etag): string {
    return avesmapsMapFeaturesCacheDir() . '/' . sha1($etag) . '.json.gz';
}

/**
 * Die abgelegten GZIP-Bytes, oder null.
 *
 * ⚠️ Gibt bewusst die KOMPRIMIERTE Fassung zurueck: so gut wie jeder Client akzeptiert gzip, und
 * fuer den seltenen Rest ist ein `gzdecode` um Groessenordnungen billiger als ein Neuaufbau.
 * Beide Fassungen abzulegen waere 23 MB je Eintrag -- siehe die Quote-Warnung im Kopf.
 */
function avesmapsMapFeaturesCacheRead(string $etag): ?string {
    $file = avesmapsMapFeaturesCacheFile($etag);
    if (!is_file($file)) {
        return null;
    }
    $alter = time() - (int) @filemtime($file);
    if ($alter < 0 || $alter >= AVESMAPS_MAP_FEATURES_CACHE_TTL_SECONDS) {
        return null;
    }
    $inhalt = @file_get_contents($file);
    return (is_string($inhalt) && $inhalt !== '') ? $inhalt : null;
}

/**
 * Legt die GZIP-Bytes unter dem ETag ab und raeumt den Vorrat auf.
 *
 * 💣 Atomar ueber eine PID-eigene Zwischendatei und `rename`. KEIN `LOCK_EX`: die Zwischendatei ist
 * je Prozess eindeutig, die Sperre bewachte also nichts -- sie kostet nur einen blockierenden Ruf
 * an STRATOs NFS-Sperrdienst, und genau der hat am 17.07.2026 den PHP-Pool festgefahren.
 *
 * ⚠️ Fehler werden geschluckt: ein Cache, der nicht schreiben kann (volle Quote, fehlende Rechte),
 * darf die Antwort nicht mitnehmen. Der naechste Abruf baut dann eben wieder neu.
 */
function avesmapsMapFeaturesCacheWrite(string $etag, string $gzipBytes): void {
    if ($gzipBytes === '') {
        return;
    }
    $file = avesmapsMapFeaturesCacheFile($etag);
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $gzipBytes) === false) {
        @unlink($tmp);
        return;
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return;
    }
    avesmapsMapFeaturesCachePrune($file);
}

/**
 * Deckelt den Vorrat auf AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES Dateien.
 *
 * 🔴 Die GERADE geschriebene Datei wird NIE weggeraeumt, auch nicht als aelteste. Beim SVG-Abzug
 * war genau das die Falle: ein Aufraeumer, der den frischen Stand mitnimmt, meldet „nichts
 * vorhanden" unmittelbar nachdem etwas abgelegt wurde.
 */
function avesmapsMapFeaturesCachePrune(string $geradeGeschrieben): void {
    $dateien = @glob(avesmapsMapFeaturesCacheDir() . '/*.json.gz');
    if (!is_array($dateien) || count($dateien) <= AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES) {
        return;
    }
    $mitAlter = [];
    foreach ($dateien as $d) {
        $mitAlter[$d] = (int) @filemtime($d);
    }
    arsort($mitAlter); // neueste zuerst
    $behalten = 0;
    foreach ($mitAlter as $d => $zeit) {
        $behalten++;
        if ($behalten <= AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES || $d === $geradeGeschrieben) {
            continue;
        }
        @unlink($d);
    }
}
