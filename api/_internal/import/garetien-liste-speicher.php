<?php

declare(strict_types=1);

// Der Zwischenspeicher der Arbeitsliste: der FESTE Teil der Objekte eines offenen Vorschau-Laufs.
//
// 💣 WARUM (gemessen 23.09.2026, live, Lauf 22 mit 9.192 Zeilen): jeder Aufruf der Liste baute ALLE rund
// 11.500 Objekte neu -- rund 600 ms Serverzeit, ob 2.164 Objekte (2,45 MB) oder 3 Objekte (`keys`)
// gefragt waren; ein Aufruf, der nichts baut, kostet dagegen rund 200 ms. Und das Fenster fragt nach
// JEDER Handlung neu (Reiter, Filter, Ablehnen, Uebernehmen, Stage-Nachschlag, „Imports in der Naehe").
// Lokal gegen den Dump vom 08.09.2026: Neubau 265 ms, dieser Speicher zu lesen 95 ms, die wechselnden
// Spalten frisch 9 ms.
//
// 🔴 WAS HIER LIEGT, AENDERT SICH NICHT, SOLANGE DERSELBE LAUF OFFEN IST: alles, was aus `after_json`,
// `before_json` und den Staging-Zeilen entsteht. Ein Lauf ist waehrend des Rechnens `building`, und die
// Liste liest nur `open` (avesmapsSyncPlanOpenRun) -- einen halb gerechneten Lauf sieht sie nie. Nach
// dem Oeffnen schreibt niemand mehr in diese Spalten; ein neues „Holen & Rechnen" legt einen NEUEN Lauf
// an, und der hat einen neuen Schluessel.
// 🔴 WAS SICH ZWISCHEN ZWEI KLICKS AENDERT, LIEGT NIE HIER: Haekchen, Uebernahme-Stand und -Vermerk,
// Entscheidungen, Staetten, die Verbuende frueherer Laeufe. Die liest avesmapsGaretienArbeitslisteObjekte
// bei jedem Aufruf frisch und traegt sie ein.
//
// 💣 DER SCHLUESSEL: Lauf, sein Anlegezeitpunkt, Import-Lauf, der Katalog der Artbezeichnungen (der
// Platzhalter-Befund haengt daran) und ein Stempel ueber ALLE eingebundenen PHP-Dateien -- ein Deploy,
// der eine davon aendert, aendert den Schluessel. Dazu prueft das Lesen eine SIGNATUR ueber alle
// Item-Nummern, Arten und Schluessel des Laufs gegen die frische Abfrage; weicht sie ab, wird neu
// gebaut. ⚠️ Die Frist ist die Absicherung gegen einen Schreiber, den niemand kennt, nicht die Regel.
//
// 🔴 AUS, SOLANGE NIEMAND IHN EINSCHALTET (avesmapsGaretienListeSpeicherOrt). Nur der Endpunkt tut das.
// Die Tests fahren die Bibliothek ohne ihn -- sie haben alle den Lauf 1 und wuerden sich ueber ein
// gemeinsames Temp-Verzeichnis gegenseitig fremde Objekte unterschieben.
// ⚠️ Faellt OFFEN aus: nicht lesbar, nicht schreibbar, kaputt -> es wird gebaut wie bisher.
// ⚠️ Gehoert zum Geruest (Abbau-Vertrag des Importers): verschwindet mit dem Verzeichnis
// api/_internal/import/; die Dateien im Temp-Verzeichnis sind dann Waisen und duerfen weg.
// Test: api/_internal/import/__tests__/garetien-liste-speicher-test.php.

// Hochzaehlen, wenn sich die FORM des festen Teils aendert, ohne dass eine eingebundene Datei sich
// aendert (der Codestempel faengt den Normalfall).
const AVESMAPS_GARETIEN_LISTE_SPEICHER_FASSUNG = 1;

// Wie lange ein abgelegter fester Teil gelten darf. Er aendert sich nicht, solange sein Lauf offen ist
// -- die Frist begrenzt nur den Schaden eines Schreibers, der oben nicht genannt ist.
const AVESMAPS_GARETIEN_LISTE_SPEICHER_FRIST_SEKUNDEN = 600;

// Wieviele Dateien hoechstens liegen bleiben (je rund 1,5-2 MB gzip; gemessen 1,5 MB fuer 8.349 Objekte). Der laufende Lauf und sein Vorgaenger:
// waehrend eines neuen „Holen & Rechnen" darf ein zweites Fenster den alten noch lesen.
// ⚠️ STRATO-QUOTE: ein voller Speicher entzieht dort der Datenbank die Schreibrechte (AGENTS.md §11).
const AVESMAPS_GARETIEN_LISTE_SPEICHER_DATEIEN = 2;

/**
 * Das Verzeichnis des Speichers -- leer heisst AUS (die Vorgabe).
 *
 * @param ?string $setzen null liest nur; ein Pfad schaltet ein, '' schaltet aus
 */
function avesmapsGaretienListeSpeicherOrt(?string $setzen = null): string
{
    static $ort = '';
    if ($setzen !== null) {
        $ort = rtrim($setzen, '/\\');
    }

    return $ort;
}

/**
 * Ein Stempel ueber alle bis hierher eingebundenen PHP-Dateien (Pfad, Aenderungszeit, Groesse).
 *
 * 🔴 ALLE, nicht eine Liste der „wichtigen": der feste Teil ruft Helfer aus dem Importer, aus
 * sync-plan.php, aus der Landschaftssuche und dem Wiki-Teil -- eine ausgewaehlte Liste vergaesse beim
 * naechsten neuen Helfer einen, und der Speicher lieferte nach einem Deploy bis zur Frist die alte
 * Form aus („meine Aenderung kommt nicht an").
 * ⚠️ Einmal je Anfrage gerechnet; gemessen 58 Dateien in 1,7 ms.
 */
function avesmapsGaretienListeSpeicherCodeStempel(): string
{
    static $stempel = null;
    if ($stempel === null) {
        $zeilen = [];
        foreach (get_included_files() as $datei) {
            $zeilen[] = $datei . '|' . (int) @filemtime($datei) . '|' . (int) @filesize($datei);
        }
        sort($zeilen);
        $stempel = sha1(implode("\n", $zeilen));
    }

    return $stempel;
}

/**
 * Der Schluessel des festen Teils.
 *
 * @param array<string, mixed> $lauf  die Zeile des offenen Vorschau-Laufs (avesmapsSyncPlanOpenRun)
 * @param list<string> $artBezeichnungen
 */
function avesmapsGaretienListeSpeicherSchluessel(array $lauf, int $importRunId, array $artBezeichnungen): string
{
    return sha1((string) json_encode([
        AVESMAPS_GARETIEN_LISTE_SPEICHER_FASSUNG,
        (int) ($lauf['id'] ?? 0),
        // Der Anlegezeitpunkt neben der Nummer: zwei Datenbanken mit derselben Laufnummer (ein
        // Testaufbau, eine wiederhergestellte Sicherung) teilen sich damit keinen Eintrag.
        (string) ($lauf['created_at'] ?? ''),
        $importRunId,
        array_values($artBezeichnungen),
        avesmapsGaretienListeSpeicherCodeStempel(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function avesmapsGaretienListeSpeicherDatei(string $schluessel): string
{
    return avesmapsGaretienListeSpeicherOrt() . '/liste-' . $schluessel . '.ser.gz';
}

/**
 * Der abgelegte feste Teil, oder null (aus, fehlt, abgelaufen, kaputt, andere Signatur).
 *
 * @return ?array{signatur: string, objekte: array<string, array>}
 */
function avesmapsGaretienListeSpeicherLesen(string $schluessel, string $signatur): ?array
{
    if (avesmapsGaretienListeSpeicherOrt() === '') {
        return null;
    }
    $datei = avesmapsGaretienListeSpeicherDatei($schluessel);
    // 💣 Das PHP des Deploy-Tors (8.3, Linux) haelt die Dateizeit im Stat-Zwischenspeicher, auch nachdem
    // `touch()` sie geaendert hat -- gemessen 23.09.2026 (nach touch 0 s alt, erst nach clearstatcache
    // 1000 s; PHP 8.5 unter Windows sofort 1000 s). Ohne die Zeile las der Test die Frist unter Windows
    // gruen und im Deploy-Tor rot. Dasselbe Muster wie avesmapsSchemaEnsureOnce.
    clearstatcache(true, $datei);
    if (!is_file($datei)) {
        return null;
    }
    $alter = time() - (int) @filemtime($datei);
    if ($alter < 0 || $alter >= AVESMAPS_GARETIEN_LISTE_SPEICHER_FRIST_SEKUNDEN) {
        return null;
    }
    $gepackt = @file_get_contents($datei);
    if (!is_string($gepackt) || $gepackt === '') {
        return null;
    }
    $roh = @gzdecode($gepackt);
    unset($gepackt);
    if (!is_string($roh)) {
        return null;
    }
    // 🔴 OHNE KLASSEN: die Datei liegt im Temp-Verzeichnis, und ein Objekt darin waere ein Einfallstor.
    $inhalt = @unserialize($roh, ['allowed_classes' => false]);
    unset($roh);
    if (!is_array($inhalt)
        || ($inhalt['schluessel'] ?? null) !== $schluessel
        || ($inhalt['signatur'] ?? null) !== $signatur
        || !is_array($inhalt['objekte'] ?? null)) {
        return null;
    }

    return ['signatur' => $signatur, 'objekte' => $inhalt['objekte']];
}

/**
 * Legt den festen Teil ab und raeumt den Vorrat auf.
 *
 * 💣 Atomar ueber eine PID-eigene Zwischendatei und `rename`, KEIN `LOCK_EX` -- dieselbe Regel wie
 * beim Kartenspeicher (map-features-cache.php): eine Sperre an STRATOs NFS-Sperrdienst hat am
 * 17.07.2026 den PHP-Pool festgefahren.
 * ⚠️ Fehler werden geschluckt: ein Speicher, der nicht schreiben kann, darf die Antwort nicht mitnehmen.
 *
 * @param array{signatur: string, objekte: array<string, array>} $fest
 */
function avesmapsGaretienListeSpeicherSchreiben(string $schluessel, array $fest): void
{
    $ort = avesmapsGaretienListeSpeicherOrt();
    if ($ort === '') {
        return;
    }
    if (!is_dir($ort) && !@mkdir($ort, 0775, true) && !is_dir($ort)) {
        return;
    }
    $gepackt = gzencode(serialize([
        'schluessel' => $schluessel,
        'signatur' => $fest['signatur'],
        'objekte' => $fest['objekte'],
    ]), 6);
    if (!is_string($gepackt)) {
        return;
    }
    $datei = avesmapsGaretienListeSpeicherDatei($schluessel);
    $zwischen = $datei . '.' . getmypid() . '.tmp';
    if (@file_put_contents($zwischen, $gepackt) === false) {
        @unlink($zwischen);
        return;
    }
    if (!@rename($zwischen, $datei)) {
        @unlink($zwischen);
        return;
    }
    avesmapsGaretienListeSpeicherAufraeumen($datei);
}

/**
 * Deckelt den Vorrat auf AVESMAPS_GARETIEN_LISTE_SPEICHER_DATEIEN Dateien.
 *
 * 🔴 Die GERADE geschriebene Datei bleibt immer stehen, auch als aelteste (dieselbe Regel wie beim
 * Kartenspeicher und beim SVG-Abzug).
 */
function avesmapsGaretienListeSpeicherAufraeumen(string $geradeGeschrieben): void
{
    $dateien = @glob(avesmapsGaretienListeSpeicherOrt() . '/liste-*.ser.gz');
    if (!is_array($dateien) || count($dateien) <= AVESMAPS_GARETIEN_LISTE_SPEICHER_DATEIEN) {
        return;
    }
    // 💣 Die GERADE geschriebene zaehlt MIT, statt nur verschont zu werden: die Aenderungszeit hat
    // Sekunden-Aufloesung, und drei Dateien aus derselben Sekunde sortieren beliebig. Verschont, aber
    // nicht mitgezaehlt, blieb dann eine Datei zu viel liegen (im parallelen Testlauf gemessen).
    $andere = [];
    foreach ($dateien as $datei) {
        if ($datei !== $geradeGeschrieben) {
            $andere[$datei] = (int) @filemtime($datei);
        }
    }
    arsort($andere); // neueste zuerst
    $behalten = array_slice(array_keys($andere), 0, max(0, AVESMAPS_GARETIEN_LISTE_SPEICHER_DATEIEN - 1));
    foreach (array_keys($andere) as $datei) {
        if (!in_array($datei, $behalten, true)) {
            @unlink($datei);
        }
    }
}
