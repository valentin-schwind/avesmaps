<?php

declare(strict_types=1);

/**
 * Der ablaufende Downloadlink fuers Kartenarchiv.
 * Owner-Auftrag 08.09.2026: „wir wollen auch externen leuten die karte schicken koennen,
 * aber am besten ueber einen token download, wo der empfaenger das ding runterladen kann
 * und dann laeuft der link ab."
 *
 * 🔴 Dieser Link weicht eine Zusage des Entwurfs vom 23.08.2026 auf („es entsteht KEINE
 * Adresse, die ohne Sitzung liefert", api/_internal/map/kartenarchiv.php §2). Verworfen war
 * damals ein Link, „der sich nie wieder aendert" -- der Ablauf ist genau der Unterschied.
 * Deshalb ist die ABLAUF-Rechnung hier die wichtigste Zusicherung der Datei: haelt sie
 * nicht, ist der Unterschied weg und mit ihm die Begruendung.
 *
 * Geprueft wird, was tatsaechlich danebengehen kann:
 *   1. Der ABLAUF -- inklusive der Sekunde, auf der er kippt.
 *   2. Die DATEI kommt aus dem TOKEN, nie aus der Adresse (sonst ist ein Kachel-Link
 *      zugleich ein Link auf die 1,73-GB-Datei).
 *   3. Der PFAD-RIEGEL gilt auch auf dem Token-Weg.
 *   4. Der BELEG bleibt: kein Download ohne Zeile.
 *   5. Der Bestand kann nicht unbegrenzt wachsen -- aber ein GUELTIGER Link stirbt nie
 *      an einer Kappung.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/kartenarchiv-link-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 4);
require_once $repoRoot . '/api/_internal/map/kartenarchiv-link.php';

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
// 1 · Der Token
// ================================================================================================

$token = avesmapsKartenarchivLinkToken();
pruefe('der Token hat die festgelegte Laenge',
    strlen($token) === AVESMAPS_KARTENARCHIV_LINK_TOKEN_LAENGE);

// 💣 Kein `l`, kein `O`, keine `0`/`1` -- der Link wird per Hand weitergereicht und teilweise
// vorgelesen. Dasselbe Alphabet wie beim Kurzlink (api/app/share-link.php).
pruefe('der Token nutzt nur das verwechslungsarme Alphabet',
    strspn($token, AVESMAPS_KARTENARCHIV_LINK_ALPHABET) === strlen($token));

$gesehen = [];
for ($i = 0; $i < 200; $i++) {
    $gesehen[avesmapsKartenarchivLinkToken()] = true;
}
pruefe('200 Token sind 200 verschiedene', count($gesehen) === 200);

// Die Eingabe kommt aus der Adresszeile eines Fremden -- alles, was nicht das Alphabet ist,
// faellt weg, und ein Token falscher Laenge ist gar keiner.
pruefe('ein sauberer Token ueberlebt die Normalisierung',
    avesmapsKartenarchivLinkTokenNormalisieren($token) === $token);
pruefe('ein zu kurzer Token wird verworfen',
    avesmapsKartenarchivLinkTokenNormalisieren('abc') === '');
pruefe('ein zu langer Token wird verworfen',
    avesmapsKartenarchivLinkTokenNormalisieren($token . 'xy') === '');
pruefe('Fremdzeichen machen den Token ungueltig, statt still wegzufallen',
    avesmapsKartenarchivLinkTokenNormalisieren(substr($token, 0, 31) . '%') === '');
pruefe('leere Eingabe ist leer',
    avesmapsKartenarchivLinkTokenNormalisieren('') === '');

// ================================================================================================
// 2 · Die Frist
// ================================================================================================
//
// Owner 08.09.2026: „7 tage passt". Alles Unbekannte faellt auf die Vorgabe -- nie auf die
// laengste Frist, und nie auf 0 (das waere ein Link, der nie funktioniert).

pruefe('die Vorgabe ist 7 Tage', AVESMAPS_KARTENARCHIV_LINK_FRIST_VORGABE === 7);
pruefe('7 ist eine angebotene Frist', in_array(7, AVESMAPS_KARTENARCHIV_LINK_FRISTEN, true));
pruefe('1 Tag wird angenommen', avesmapsKartenarchivLinkFrist('1') === 1);
pruefe('30 Tage werden angenommen', avesmapsKartenarchivLinkFrist('30') === 30);
pruefe('eine unbekannte Frist faellt auf die Vorgabe', avesmapsKartenarchivLinkFrist('365') === 7);
pruefe('0 faellt auf die Vorgabe, nicht auf 0', avesmapsKartenarchivLinkFrist('0') === 7);
pruefe('eine negative Frist faellt auf die Vorgabe', avesmapsKartenarchivLinkFrist('-5') === 7);
pruefe('Unsinn faellt auf die Vorgabe', avesmapsKartenarchivLinkFrist('sieben') === 7);

// ================================================================================================
// 3 · Der Ablauf -- die tragende Rechnung
// ================================================================================================

$jetzt = '2026-09-08 12:00:00';

$gueltig = ['expires_at' => '2026-09-15 12:00:00', 'revoked_at' => null];
$abgelaufen = ['expires_at' => '2026-09-08 11:59:59', 'revoked_at' => null];
$zurueckgezogen = ['expires_at' => '2026-09-15 12:00:00', 'revoked_at' => '2026-09-08 10:00:00'];

pruefe('ein laufender Link ist gueltig',
    avesmapsKartenarchivLinkIstGueltig($gueltig, $jetzt) === true);
pruefe('ein abgelaufener Link ist ungueltig',
    avesmapsKartenarchivLinkIstGueltig($abgelaufen, $jetzt) === false);
pruefe('ein zurueckgezogener Link ist ungueltig, auch wenn die Frist laeuft',
    avesmapsKartenarchivLinkIstGueltig($zurueckgezogen, $jetzt) === false);

// 💣 Die Sekunde, auf der es kippt. Ein `>=` statt `>` verlaengerte jeden Link um eine Sekunde --
// harmlos --, ein `<` statt `<=` an der falschen Stelle um einen ganzen Tag.
pruefe('genau auf der Ablaufsekunde ist der Link noch gueltig',
    avesmapsKartenarchivLinkIstGueltig(['expires_at' => $jetzt, 'revoked_at' => null], $jetzt) === true);
pruefe('eine Sekunde danach ist er es nicht mehr',
    avesmapsKartenarchivLinkIstGueltig(['expires_at' => '2026-09-08 11:59:59', 'revoked_at' => null], $jetzt) === false);

// 🔴 Faellt GESCHLOSSEN aus: was nicht gelesen werden konnte, liefert nicht.
pruefe('null ist ungueltig',
    avesmapsKartenarchivLinkIstGueltig(null, $jetzt) === false);
pruefe('eine Zeile ohne Ablauf ist ungueltig, nicht ewig',
    avesmapsKartenarchivLinkIstGueltig(['revoked_at' => null], $jetzt) === false);
pruefe('ein leeres Ablaufdatum ist ungueltig',
    avesmapsKartenarchivLinkIstGueltig(['expires_at' => '', 'revoked_at' => null], $jetzt) === false);

// ================================================================================================
// 4 · Was der Editor liest
// ================================================================================================

pruefe('Restzeit in Tagen',
    avesmapsKartenarchivLinkRestText('2026-09-15 12:00:00', $jetzt) === 'noch 7 Tage');
pruefe('ein einzelner Tag steht im Singular',
    avesmapsKartenarchivLinkRestText('2026-09-09 12:00:00', $jetzt) === 'noch 1 Tag');
pruefe('unter einem Tag wird in Stunden gezaehlt',
    avesmapsKartenarchivLinkRestText('2026-09-08 15:00:00', $jetzt) === 'noch 3 Stunden');
// ⚠️ KLARTEXT, keine HTML-Entities: die Funktion ist rein, das Maskieren gehoert der Seite.
// Ein „&auml;" hier waere in jedem anderen Aufrufer (Protokoll, JSON, Test) sichtbarer Muell.
pruefe('unter einer Stunde heisst es „laeuft gleich ab"',
    avesmapsKartenarchivLinkRestText('2026-09-08 12:30:00', $jetzt) === 'läuft in weniger als 1 Stunde ab');
pruefe('abgelaufen wird als abgelaufen benannt',
    avesmapsKartenarchivLinkRestText('2026-09-08 11:00:00', $jetzt) === 'abgelaufen');

// ================================================================================================
// 5 · Der Beleg
// ================================================================================================
//
// 🔴 Zusage 3 des Entwurfs vom 23.08.2026: „Jeder Download hinterlaesst eine Zeile mit Namen."
// Auf dem Token-Weg gibt es keinen angemeldeten Namen -- also traegt die Zeile den ERZEUGER und
// den Zweck. Eine Zeile mit „extern" oder leer waere das Ende dieser Zusage.

// ⚠️ Gezaehlt werden ZEICHEN, nicht Bytes: `actor_name` ist VARCHAR(120) unter utf8mb4, und
// das sind 120 Zeichen. Mit strlen gemessen risse diese Zusicherung, sobald der Trenner „·"
// oder ein Umlaut in der Notiz steht -- und zwar an einem Beleg, der in MySQL tadellos passt.
function belegZeichen(string $text): int
{
    return (int) preg_match_all('/./us', $text);
}

$beleg = avesmapsKartenarchivLinkBeleg('valentin', 'Kartograph Hesindian');
pruefe('der Beleg nennt den Erzeuger', str_contains($beleg, 'valentin'));
pruefe('der Beleg nennt den Zweck', str_contains($beleg, 'Kartograph Hesindian'));
pruefe('der Beleg sagt, dass es ein Link war', str_contains($beleg, 'Link'));
pruefe('der Beleg passt in actor_name VARCHAR(120)', belegZeichen($beleg) <= 120);

// Eine sehr lange Notiz darf die Spalte nicht sprengen -- gekappt, nicht abgewiesen.
$langerBeleg = avesmapsKartenarchivLinkBeleg(str_repeat('n', 80), str_repeat('z', 200));
pruefe('auch ein langer Beleg passt in die Spalte', belegZeichen($langerBeleg) <= 120);
// 💣 Und er darf nicht mitten in einem Umlaut enden -- ein halbes Zeichen macht die Spalte
// in MySQL zu einem Fehler und im Protokoll zu unlesbarem Muell.
$umlautBeleg = avesmapsKartenarchivLinkBeleg('valentin', str_repeat('ä', 200));
pruefe('der gekappte Beleg ist gueltiges UTF-8',
    mb_check_encoding($umlautBeleg, 'UTF-8') && belegZeichen($umlautBeleg) <= 120);

// 💣 UND BEI KAPUTTEN BYTES FAELLT ER GESCHLOSSEN AUS. `preg_replace` mit `/u` liefert bei
// ungueltigem UTF-8 `null`; der erste Rueckfall war der UNGEKAPPTE Text -- gemessen 214 Zeichen
// statt der zugesagten 120, gefunden von einem Pruefagenten. In `actor_name VARCHAR(120)` heisst
// das je nach SQL-Modus eine Ausnahme, und die faengt der Protokollblock des Endpunkts ab:
// der Download liefe durch, die Zeile fehlte, und Zusage 3 waere lautlos ausgefallen.
$kaputt = avesmapsKartenarchivLinkBeleg('abc' . chr(0xFF) . chr(0xFE) . str_repeat('x', 200), '');
pruefe('auch bei kaputten Bytes passt der Beleg in die Spalte',
    strlen($kaputt) <= 120 && belegZeichen($kaputt) <= 120);
pruefe('der Rueckfall liefert gueltiges UTF-8', mb_check_encoding($kaputt, 'UTF-8'));
pruefe('der Rueckfall ist nie leer -- eine namenlose Zeile waere keine Zeile', $kaputt !== '');

pruefe('ein Beleg ohne Notiz nennt trotzdem den Erzeuger',
    str_contains(avesmapsKartenarchivLinkBeleg('valentin', ''), 'valentin'));

// ================================================================================================
// 6 · Die Notiz
// ================================================================================================

pruefe('die Notiz wird auf eine Zeile gebracht',
    avesmapsKartenarchivLinkNotiz("Hesindian\r\nvom Forum") === 'Hesindian vom Forum');
pruefe('die Notiz wird gekappt',
    strlen(avesmapsKartenarchivLinkNotiz(str_repeat('x', 500))) === AVESMAPS_KARTENARCHIV_LINK_NOTIZ_MAX);
pruefe('Umlaute ueberleben die Kappung unversehrt',
    avesmapsKartenarchivLinkNotiz('Grüße für Törn') === 'Grüße für Törn');

// ================================================================================================
// 7 · Die Adresse
// ================================================================================================

$adresse = avesmapsKartenarchivLinkAdresse('avesmaps.de', $token, true);
pruefe('die Adresse ist absolut -- sie wird verschickt',
    str_starts_with($adresse, 'https://avesmaps.de/'));
pruefe('die Adresse zeigt auf den Endpunkt', str_contains($adresse, '/api/edit/map/kartenarchiv.php'));
pruefe('die Adresse traegt den Token', str_contains($adresse, 'token=' . $token));
// 💣 Kein `datei=` in der Adresse: die Datei haengt am Token. Stuende sie hier, koennte der
// Empfaenger eines Kachel-Links den Parameter auf die 1,73-GB-Datei umschreiben.
pruefe('die Adresse traegt KEINEN Dateinamen', !str_contains($adresse, 'datei='));
pruefe('ein leerer Token ergibt keine Adresse',
    avesmapsKartenarchivLinkAdresse('avesmaps.de', '', true) === '');

// ================================================================================================
// 8 · Der Ablauf gegen eine echte Datenbank
// ================================================================================================

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    echo "  HINWEIS  pdo_sqlite fehlt -- Abschnitt 8 und 9 uebersprungen.\n";
} else {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // 💣 Die MySQL-DDL der Bibliothek laeuft auf SQLite nicht (BIGINT UNSIGNED AUTO_INCREMENT).
    // Die Fixture bildet sie nach -- und Abschnitt 9 haelt beide Spaltenlisten gegeneinander,
    // damit eine neue Spalte nicht nur an einer der zwei Stellen ankommt.
    $pdo->exec(
        'CREATE TABLE map_archive_link (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL,
            file_name TEXT NOT NULL,
            note TEXT NOT NULL,
            creator_user_id INTEGER NULL,
            creator_name TEXT NOT NULL,
            hits INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT NULL
        )'
    );

    $t0 = '2026-09-08 12:00:00';

    // 🔴 Seit dem 08.09.2026 prueft das Anlegen den Dateinamen SELBST gegen den Pfad-Riegel
    // (der Fund eines Pruefagenten: der Riegel stand nur beim einzigen Aufrufer). Der Test
    // braucht deshalb einen Ordner mit echten Dateien -- derselbe `$verzeichnis`-Parameter,
    // den avesmapsKartenarchivListe() schon fuer seinen Test traegt.
    $ablage = sys_get_temp_dir() . '/avesmaps-link-test-' . getmypid();
    @mkdir($ablage, 0777, true);
    foreach (['avesmaps_aventurien_tiles_v2.05.zip', 'a.zip', 'b.zip', 'c.zip'] as $name) {
        file_put_contents($ablage . '/' . $name, 'X');
    }

    // Ein Name, den es im Ordner nicht gibt, wird abgelehnt -- nicht als toter Link angelegt,
    // der erst beim Empfaenger als unerklaerliches 404 auffaellt.
    $abgelehnt = false;
    try {
        avesmapsKartenarchivLinkAnlegen($pdo, 'gibtsnicht.zip', 7, 1, 'valentin', 'x', $t0, $ablage);
    } catch (RuntimeException $e) {
        $abgelehnt = true;
    }
    pruefe('ein Link auf eine unbekannte Datei wird abgelehnt', $abgelehnt);

    // Und ein Pfad-Ausbruch erst recht -- der Riegel ist derselbe wie beim Download.
    $ausbruch = false;
    try {
        avesmapsKartenarchivLinkAnlegen($pdo, '../geheim.zip', 7, 1, 'valentin', 'x', $t0, $ablage);
    } catch (RuntimeException $e) {
        $ausbruch = true;
    }
    pruefe('ein Pfad-Ausbruch wird schon beim Anlegen abgelehnt', $ausbruch);

    $neu = avesmapsKartenarchivLinkAnlegen(
        $pdo,
        'avesmaps_aventurien_tiles_v2.05.zip',
        7,
        42,
        'valentin',
        'Kartograph Hesindian',
        $t0,
        $ablage
    );
    pruefe('das Anlegen liefert einen brauchbaren Token',
        avesmapsKartenarchivLinkTokenNormalisieren($neu) === $neu && $neu !== '');

    $zeile = avesmapsKartenarchivLinkFinden($pdo, $neu);
    pruefe('der Link ist wiederauffindbar', $zeile !== null);
    pruefe('die Datei haengt am Link',
        (string) ($zeile['file_name'] ?? '') === 'avesmaps_aventurien_tiles_v2.05.zip');
    pruefe('der Link laeuft nach genau 7 Tagen ab',
        (string) ($zeile['expires_at'] ?? '') === '2026-09-15 12:00:00');
    pruefe('der Erzeuger steht in der Zeile',
        (string) ($zeile['creator_name'] ?? '') === 'valentin');
    pruefe('die Notiz steht in der Zeile',
        (string) ($zeile['note'] ?? '') === 'Kartograph Hesindian');
    pruefe('der frische Link ist gueltig',
        avesmapsKartenarchivLinkIstGueltig($zeile, $t0) === true);
    pruefe('acht Tage spaeter ist er es nicht mehr',
        avesmapsKartenarchivLinkIstGueltig($zeile, '2026-09-16 12:00:00') === false);

    // Ein unbekannter Token findet nichts -- und wirft nicht.
    pruefe('ein unbekannter Token findet nichts',
        avesmapsKartenarchivLinkFinden($pdo, avesmapsKartenarchivLinkToken()) === null);
    pruefe('ein leerer Token findet nichts, ohne zu suchen',
        avesmapsKartenarchivLinkFinden($pdo, '') === null);

    // Treffer zaehlen
    avesmapsKartenarchivLinkTrefferZaehlen($pdo, (int) $zeile['id']);
    avesmapsKartenarchivLinkTrefferZaehlen($pdo, (int) $zeile['id']);
    $nachZwei = avesmapsKartenarchivLinkFinden($pdo, $neu);
    pruefe('die Treffer werden gezaehlt', (int) ($nachZwei['hits'] ?? 0) === 2);

    // Zuruecknehmen
    pruefe('das Zurueckziehen meldet Erfolg',
        avesmapsKartenarchivLinkZurueckziehen($pdo, (int) $zeile['id'], $t0) === true);
    $nachRuecknahme = avesmapsKartenarchivLinkFinden($pdo, $neu);
    pruefe('der zurueckgezogene Link ist ungueltig',
        avesmapsKartenarchivLinkIstGueltig($nachRuecknahme, $t0) === false);
    // ⚠️ Die Zeile BLEIBT stehen -- sie ist der Beleg, dass es den Link gab.
    pruefe('die Zeile bleibt als Beleg stehen', $nachRuecknahme !== null);
    pruefe('ein zweites Zurueckziehen meldet keinen Erfolg mehr',
        avesmapsKartenarchivLinkZurueckziehen($pdo, (int) $zeile['id'], $t0) === false);

    // ---- Der Deckel ----------------------------------------------------------------------
    //
    // 💣 Gedeckelt werden die GLEICHZEITIG AKTIVEN, nicht die Zeilen insgesamt. Eine Kappung
    // nach Zeilenzahl -- wie bei den Protokollen dieses Hauses -- wuerde hier GUELTIGE Links
    // loeschen, und zwar die aeltesten: genau die, die schon verschickt sind.
    $aktiv = avesmapsKartenarchivLinkAktivZaehlen($pdo, $t0);
    pruefe('ein zurueckgezogener Link zaehlt nicht als aktiv', $aktiv === 0);

    for ($i = 0; $i < AVESMAPS_KARTENARCHIV_LINK_MAX_AKTIV; $i++) {
        avesmapsKartenarchivLinkAnlegen($pdo, 'a.zip', 7, 1, 'valentin', 'Test ' . $i, $t0, $ablage);
    }
    pruefe('der Deckel ist erreicht',
        avesmapsKartenarchivLinkAktivZaehlen($pdo, $t0) === AVESMAPS_KARTENARCHIV_LINK_MAX_AKTIV);

    $gebremst = false;
    try {
        avesmapsKartenarchivLinkAnlegen($pdo, 'a.zip', 7, 1, 'valentin', 'einer zu viel', $t0, $ablage);
    } catch (RuntimeException $e) {
        $gebremst = true;
    }
    pruefe('ueber dem Deckel wird das Anlegen abgelehnt, nicht still verschluckt', $gebremst);

    // ---- Das Aufraeumen ------------------------------------------------------------------
    //
    // 🔴 Geraeumt wird NUR, was lange abgelaufen ist. Ein gueltiger Link ueberlebt jeden Lauf.
    // ⚠️ Reihenfolge: erst raeumen, dann anlegen. Das Anlegen raeumt SELBST mit (die Hausregel
    // „die Grenze steht beim Erzeuger"), und danach gaebe es fuer den Zaehler nichts mehr zu tun --
    // der Test haette dann gemessen, dass nichts passiert, und das fuer Erfolg gehalten.
    $spaeter = '2026-11-01 12:00:00';   // weit hinter Ablauf + Gnadenfrist
    $geloescht = avesmapsKartenarchivLinkAufraeumen($pdo, $spaeter);
    pruefe('die alten Zeilen werden geraeumt', $geloescht > 0);

    $frisch = avesmapsKartenarchivLinkAnlegen($pdo, 'b.zip', 30, 1, 'valentin', 'frisch', $spaeter, $ablage);
    pruefe('der frische Link ueberlebt das Aufraeumen',
        avesmapsKartenarchivLinkFinden($pdo, $frisch) !== null);
    pruefe('nach dem Raeumen ist wieder Platz',
        avesmapsKartenarchivLinkAktivZaehlen($pdo, $spaeter) === 1);

    // Ein gerade erst abgelaufener Link bleibt noch stehen -- der Editor soll in seiner Liste
    // sehen, dass sein Link abgelaufen ist, statt ihn spurlos zu verlieren.
    $ebenAbgelaufen = avesmapsKartenarchivLinkAnlegen($pdo, 'c.zip', 1, 1, 'valentin', 'eben', $spaeter, $ablage);
    avesmapsKartenarchivLinkAufraeumen($pdo, '2026-11-03 12:00:00');
    pruefe('ein gerade abgelaufener Link bleibt in der Liste sichtbar',
        avesmapsKartenarchivLinkFinden($pdo, $ebenAbgelaufen) !== null);

    // ---- Die Liste -----------------------------------------------------------------------
    $liste = avesmapsKartenarchivLinkListe($pdo);
    pruefe('die Liste liefert Zeilen', $liste !== []);
    pruefe('die Liste traegt den Token zum Kopieren',
        isset($liste[0]['token']) && $liste[0]['token'] !== '');
    pruefe('die Liste ist neueste zuerst',
        (int) $liste[0]['id'] >= (int) $liste[count($liste) - 1]['id']);

    foreach (['avesmaps_aventurien_tiles_v2.05.zip', 'a.zip', 'b.zip', 'c.zip'] as $name) {
        @unlink($ablage . '/' . $name);
    }
    @rmdir($ablage);
}

// ================================================================================================
// 9 · Die Verdrahtung -- was der Quelltext zusagen muss
// ================================================================================================

// 💣 Gemessen wird der CODE, nicht die Prosa. In genau diesen Dateien erklaeren die Kommentare
// woertlich, was der Code NICHT tun darf („leitet nicht auf uploads/map weiter") -- ein
// str_contains ueber die rohe Datei schlaegt also an der Warnung an, die vor dem Muster warnt.
// Derselbe Tokenizer wie in kartenarchiv-test.php nebenan; ein preg_replace ueber /* … */
// waere hier gefaehrlich, weil ein `/*` in einem ZEILENkommentar den halben Code wegfraesse.
function linkOhneKommentare(string $pfad): string
{
    $roh = (string) file_get_contents($pfad);
    $code = '';
    foreach (token_get_all($roh) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= is_array($token) ? $token[1] : $token;
    }

    return $code;
}

// 🪤 Auch die Bibliothek kommentarfrei -- sie war es zuerst nicht, und eine Mutationsprobe hat
// gezeigt, was das kostet: der Kommentar an NOTIZ_MAX nennt „note VARCHAR(190)" woertlich, also
// blieb die Zusicherung ueber die Spaltenbreite gruen, nachdem die echte DDL auf VARCHAR(90)
// geschrumpft war. Ein Quelltext-Test, der seine eigene Doku mitliest, prueft die Doku.
$bibliothek = linkOhneKommentare($repoRoot . '/api/_internal/map/kartenarchiv-link.php');
$endpunkt = linkOhneKommentare($repoRoot . '/api/edit/map/kartenarchiv.php');
$seite = linkOhneKommentare($repoRoot . '/edit/svg-export.php');

// Die zwei Spaltenlisten (MySQL-DDL und die SQLite-Fixture oben) muessen dieselben Namen tragen.
foreach (['token', 'file_name', 'note', 'creator_user_id', 'creator_name', 'hits', 'created_at', 'expires_at', 'revoked_at'] as $spalte) {
    pruefe("die MySQL-DDL kennt die Spalte {$spalte}", str_contains($bibliothek, $spalte));
}

// 💣 Der Dateiname kommt aus dem Token. Ein `$_GET['datei']` im Token-Zweig waere genau die
// Luecke, die ein Kachel-Link zur 1,73-GB-Datei macht.
pruefe('der Endpunkt liest die Datei aus der Link-Zeile',
    str_contains($endpunkt, "file_name"));

// 🔴 Der Pfad-Riegel gilt fuer BEIDE Wege -- er ist der einzige Schutz gegen einen Ausbruch,
// und eine Zeile in der Datenbank ist kein Beleg dafuer, dass die Datei noch dort liegt.
pruefe('auch der Token-Weg geht durch avesmapsKartenarchivPfad',
    substr_count($endpunkt, 'avesmapsKartenarchivPfad') >= 1);

// 🔴 Der Beleg bleibt: der Token-Weg protokolliert, sonst faellt Zusage 3 des Entwurfs.
pruefe('der Endpunkt bildet den Beleg fuer den Token-Weg',
    str_contains($endpunkt, 'avesmapsKartenarchivLinkBeleg'));

// Und der Endpunkt darf weiterhin nicht auf die gesperrte Datei weiterleiten.
pruefe('der Endpunkt leitet nicht auf uploads/map/ weiter',
    !str_contains($endpunkt, 'uploads/map'));

// 💣 DER TOKEN-ZWEIG DARF DEN SITZUNGSRIEGEL NICHT RUFEN. `avesmapsRequireUserWithCapability`
// antwortet mit 401 und beendet -- stuende der Aufruf vor der Weiche, waere der ganze Umbau
// wirkungslos und ein Externer bekaeme „bitte anmelden" auf einen Link, den er von uns hat.
// 💣 DIE WEICHE FRAGT NACH DEM PARAMETER, NICHT NACH SEINER GUELTIGKEIT. Am 08.09.2026 live
// gemessen: ein verstuemmelter Token (Mail-Clients brechen 32 Zeichen um) normalisierte auf ''
// und fiel damit in den Sitzungszweig -- der Empfaenger bekam „Du bist fuer diese Aktion nicht
// angemeldet" auf einen Link, den er von uns hat und fuer den er nie ein Konto bekommt.
pruefe('die Weiche entscheidet am ROHEN Parameter, nicht am normalisierten',
    str_contains($endpunkt, "if (\$tokenRoh !== '')"));
pruefe('ein unbrauchbarer Token endet im Token-Zweig, nicht im Sitzungsriegel',
    (int) strpos($endpunkt, "if (\$tokenRoh !== '')")
    < (int) strpos($endpunkt, 'avesmapsRequireUserWithCapability'));

$vorWeiche = substr($endpunkt, 0, (int) strpos($endpunkt, "\$_GET['token']"));
pruefe('der Sitzungsriegel steht NICHT vor der Token-Weiche',
    !str_contains($vorWeiche, 'avesmapsRequireUserWithCapability'));
pruefe('der Sitzungsriegel gibt es weiterhin -- fuer den Weg ohne Token',
    str_contains($endpunkt, "avesmapsRequireUserWithCapability('edit')"));

// 💣 UND BEIDE RIEGEL STEHEN VOR DER ERSTEN KOPFZEILE. Danach ist es zu spaet: `header()` plus
// `http_response_code()` sind raus, und eine Absage waere dann eine PHP-Warnung im Rumpf einer
// 200er -- also ein kaputtes ZIP statt einer lesbaren Antwort. Genau diese Begruendung steht
// weiter unten schon fuer das Oeffnen der Datei.
$ersteKopfzeile = strpos($endpunkt, "header('Content-Type: application/zip')");
pruefe('die Token-Weiche steht vor der ersten Kopfzeile',
    $ersteKopfzeile !== false && strpos($endpunkt, "\$_GET['token']") < $ersteKopfzeile);
pruefe('der Sitzungsriegel steht vor der ersten Kopfzeile',
    $ersteKopfzeile !== false && strpos($endpunkt, 'avesmapsRequireUserWithCapability') < $ersteKopfzeile);

// Ein abgelaufener Link bekommt eine SPRECHENDE Absage, kein stummes 404: wer diesen Token hat,
// hat ihn von uns, und „geht nicht" ohne Grund landet als Rueckfrage beim Absender.
pruefe('ein abgelaufener Link antwortet mit 410 und einem Grund',
    str_contains($endpunkt, '410') && str_contains($endpunkt, 'link_expired'));

// 💣 Die Seite: der Link-Zweig darf NICHT in den Login-Zweig fallen. Der beantwortet jedes
// `$user === null` mit `avesmapsLogout()` -- ohne das `else` waere ein Editor nach dem Anlegen
// eines Links abgemeldet, und es saehe wie ein abgelaufenes Sitzungscookie aus. Genau so war
// die erste Fassung dieses Umbaus gebaut.
// 🪤 Gemessen wird die KLAMMERTIEFE, nicht „steht irgendwo ein else dazwischen": im try-Block
// des Link-Zweigs steht selbst eines (link_neu gegen link_weg), und eine Suche nach der
// Zeichenkette haelt dieses fuer den Riegel. Die erste Fassung dieser Zusicherung tat genau das
// und ueberlebte die Mutation, die das tragende else entfernt.
$posLinkIf = strpos($seite, "if (\$action === 'link_neu'");
$posLogin = strpos($seite, 'avesmapsLogin(');
$loginImElseZweig = false;
if ($posLinkIf !== false && $posLogin !== false && $posLinkIf < $posLogin) {
    // Von der oeffnenden Klammer des if bis zu ihrer schliessenden laufen.
    $tiefe = 0;
    $ende = null;
    for ($i = (int) strpos($seite, '{', $posLinkIf); $i < strlen($seite); $i++) {
        if ($seite[$i] === '{') {
            $tiefe++;
        } elseif ($seite[$i] === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                $ende = $i;
                break;
            }
        }
    }
    // Direkt hinter der schliessenden Klammer muss `else` stehen, und der Login darin liegen.
    if ($ende !== null) {
        $dahinter = ltrim(substr($seite, $ende + 1, 12));
        $loginImElseZweig = str_starts_with($dahinter, 'else') && $posLogin > $ende;
    }
}
pruefe('der Login liegt im ELSE-Zweig des Link-Zweigs, faellt also nicht durch',
    $loginImElseZweig);

// 🔴 Auch das ANLEGEN geht durch den Pfad-Riegel, und zwar in der BIBLIOTHEK statt beim
// Aufrufer: heute gibt es genau einen, morgen ist das kein Argument mehr. Der Ablauf dazu
// steht in Abschnitt 8; hier wird festgehalten, dass der Riegel nicht wieder nach oben wandert.
pruefe('das Anlegen prueft den Dateinamen selbst',
    str_contains($bibliothek, 'avesmapsKartenarchivPfad('));
pruefe('die Bibliothek laedt den Pfad-Riegel dafuer',
    str_contains($bibliothek, "require_once __DIR__ . '/kartenarchiv.php'"));

// 💣 Gekoppelte Werte: die Notiz muss in ihre Spalte passen. Das Geschwisterpaar
// (BELEG_MAX gegen actor_name VARCHAR(120)) ist oben geprueft, dieses war es nicht -- und die
// SQLite-Fixture nutzt fuer `note` ein unbegrenztes TEXT, wuerde eine Schrumpfung der
// MySQL-Spalte also nicht bemerken.
pruefe('die Notiz passt in ihre Spalte',
    str_contains($bibliothek, 'note VARCHAR(190)') && AVESMAPS_KARTENARCHIV_LINK_NOTIZ_MAX <= 190);

// Die Seite: der alte Satz „nicht zur Weitergabe" steht im Widerspruch zu diesem Knopf.
pruefe('die Seite behauptet nicht mehr, das Material sei nicht zur Weitergabe',
    !str_contains($seite, 'nicht zur Weitergabe'));
pruefe('die Seite bietet das Erzeugen eines Links an',
    str_contains($seite, 'link_neu'));
pruefe('die Seite bietet das Zurueckziehen an',
    str_contains($seite, 'link_weg'));

if ($fehler > 0) {
    echo "kartenarchiv-link-test.php: {$fehler} von {$zusicherungen} Zusicherungen GERISSEN\n";
    exit(1);
}
echo "kartenarchiv-link-test.php: alle {$zusicherungen} Zusicherungen erfuellt\n";
exit(0);
