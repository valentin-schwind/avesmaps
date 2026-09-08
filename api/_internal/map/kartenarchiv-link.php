<?php

declare(strict_types=1);

/**
 * Der ablaufende Downloadlink fuers Kartenarchiv -- damit ein Editor die Karte auch an
 * jemanden schicken kann, der kein Konto hat.
 * ---------------------------------------------------------------------------
 * Owner-Auftrag 08.09.2026: „wir wollen auch externen leuten die karte schicken koennen,
 * aber am besten ueber einen token download, wo der empfaenger das ding runterladen kann
 * und dann laeuft der link ab." Frist 7 Tage, EIN Endpunkt (Owner am selben Tag).
 *
 * 🔴 WAS DIESE DATEI AUFWEICHT, UND WARUM DAS TRAGBAR IST.
 * Der Entwurf vom 23.08.2026 gibt VIER Zusagen (§1 dort, gespiegelt im Kopf von
 * kartenarchiv.php -- die Nummern sind die des Entwurfs). ZUSAGE 3 lautet woertlich: „Es
 * entsteht KEINE Adresse, die ohne Sitzung liefert."
 *
 * 🔴 DIESE DATEI IST DIE EINZIGE AUSNAHME DAVON, UND SIE IST BESTELLT -- keine Aufhebung.
 * Eine DAUERHAFTE Adresse ohne Sitzung gibt es weiterhin nicht. Zusage 3 ENTSTAND seinerzeit mit
 * der Begruendung, ein solcher Link waere „ein nackter, teilbarer Link, der sich NIE WIEDER
 * AENDERT"; der Ablauf ist der ganze Unterschied:
 *
 *   - Die Adresse gilt hoechstens 30, per Vorgabe 7 Tage, und dann nie wieder.
 *   - Sie gilt fuer GENAU EINE Datei -- der Dateiname haengt am Token, nicht an der Adresse.
 *   - Sie ist im Editor sichtbar und jederzeit vorzeitig zurueckziehbar.
 *   - Sie traegt einen Erzeuger und einen Zweck, und jeder Download darueber hinterlaesst
 *     weiterhin eine Zeile (Zusage 4 bleibt damit unangetastet).
 *
 * Zusage 1 (die `uploads/map/.htaccess`) und Zusage 2 (kein Link im Hinweise-Fenster) sind
 * ebenfalls unberuehrt: auch der Token-Weg liest aus dem Dateisystem und leitet nirgendwohin
 * weiter, und im Hinweise-Fenster steht nach wie vor nichts.
 *
 * 💣 AN DEN, DER SPAETER HIER STEHT UND AUFRAEUMEN WILL: ein sitzungsfreier Downloadweg neben
 * einer 🔴-Zeile, die „kein nackter Link" sagt, sieht aus wie ein Versehen. Er ist keines.
 * Der Rueckbau-Waechter in __tests__/kartenarchiv-link-test.php wird rot, bevor das jemand
 * still tun kann -- und er nennt dabei, was gerade verschwindet.
 *
 * ⚠️ Die Grenze, die dabei bleibt: `NOTICE.md` sagt zu, das Projekt nicht „als reines
 * Bilder- oder Textarchiv" zu betreiben. Ein befristeter Link an eine benannte Person ist
 * etwas anderes als eine offene Adresse -- aber der Unterschied lebt davon, dass beides
 * stimmt: die Frist UND die Benennung. Wer eines von beidem abschafft, schafft die
 * Begruendung ab.
 *
 * Diese Datei ist REIN bis zum Abschnitt „Datenbank" -- aus demselben Grund wie die
 * Bibliothek nebenan: eine Rechnung, die man nur mit laufendem Server pruefen kann, wird
 * nie geprueft. Die Ablaufrechnung ist die wichtigste hier und deshalb parameterlos an der
 * Uhr: `$jetzt` wird hereingereicht, nie gelesen.
 */

/**
 * Dasselbe verwechslungsarme Alphabet wie beim Kurzlink (api/app/share-link.php).
 *
 * 💣 Kein `l`, kein `I`, kein `O`, keine `0`/`1`. Dieser Link wird per Hand weitergereicht
 * -- kopiert, in eine Mail geklebt, im Zweifel vorgelesen. Ein `O` gegen eine `0` kostet
 * den Empfaenger einen Fehlschlag, den er sich nicht erklaeren kann.
 */
const AVESMAPS_KARTENARCHIV_LINK_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * 32 Zeichen aus 56 Moeglichkeiten -- rund 185 Bit.
 *
 * ⚠️ Deutlich laenger als die 8 Zeichen des Kurzlinks, und das ist kein Geschmack: jener
 * verbirgt nichts (er loest einen Kartenausschnitt auf), dieser IST der Zugang. Raten muss
 * aussichtslos sein, nicht nur unwahrscheinlich.
 */
const AVESMAPS_KARTENARCHIV_LINK_TOKEN_LAENGE = 32;

/** Was die Seite anbietet. Owner 08.09.2026: „7 tage passt." */
const AVESMAPS_KARTENARCHIV_LINK_FRISTEN = [1, 7, 30];

/**
 * 🔴 Der Rueckfall ist die VORGABE, nie die laengste Frist und nie 0.
 * Ein unbekannter Wert kommt von einem alten Formular oder aus einer Bastelei -- die
 * langlebigste Antwort darauf zu geben, waere die falsche Richtung, und 0 ergaebe einen
 * Link, der nie funktioniert und wie ein Fehler aussieht.
 */
const AVESMAPS_KARTENARCHIV_LINK_FRIST_VORGABE = 7;

/** Passt in `note VARCHAR(190)` und laesst dem Beleg Platz. */
const AVESMAPS_KARTENARCHIV_LINK_NOTIZ_MAX = 120;

/** So lang ist `map_archive_download.actor_name`. Der Beleg muss hineinpassen. */
const AVESMAPS_KARTENARCHIV_LINK_BELEG_MAX = 120;

/**
 * Wie viele Links gleichzeitig GELTEN duerfen.
 *
 * 💣 Gedeckelt werden die AKTIVEN, nicht die Zeilen. Die Protokolle dieses Hauses kappen
 * nach Zeilenzahl (avesmapsPruneAuditLog) -- dieselbe Kappung hier wuerde GUELTIGE Links
 * loeschen, und zwar die aeltesten: genau die, die schon verschickt sind und auf deren
 * Funktionieren jemand wartet. Ein Link, der ohne Grund stirbt, ist schlimmer als kein
 * Link, weil niemand ihn wiederfinden kann.
 */
const AVESMAPS_KARTENARCHIV_LINK_MAX_AKTIV = 50;

/**
 * Wie lange eine abgelaufene Zeile noch stehen bleibt, bevor sie geraeumt wird.
 *
 * ⚠️ Nicht null: der Editor soll in seiner Liste SEHEN, dass sein Link abgelaufen ist --
 * „ist weg" und „hat nie existiert" sehen sonst gleich aus, und die erste Frage nach einem
 * misslungenen Versand ist genau die.
 */
const AVESMAPS_KARTENARCHIV_LINK_GNADENFRIST_TAGE = 30;

/** Das Zeitformat dieser Datei -- lexikografisch vergleichbar, deshalb portabel. */
const AVESMAPS_KARTENARCHIV_LINK_ZEITFORMAT = 'Y-m-d H:i:s';

// Der Pfad-Riegel lebt nebenan und wird beim ANLEGEN gebraucht -- siehe die Begruendung an
// avesmapsKartenarchivLinkAnlegen(). Kein Zyklus: kartenarchiv.php kennt diese Datei nicht.
require_once __DIR__ . '/kartenarchiv.php';

// ================================================================================================
// Rein
// ================================================================================================

/** Ein frischer Token. */
function avesmapsKartenarchivLinkToken(): string
{
    $alphabetLaenge = strlen(AVESMAPS_KARTENARCHIV_LINK_ALPHABET);
    $bytes = random_bytes(AVESMAPS_KARTENARCHIV_LINK_TOKEN_LAENGE);
    $token = '';
    for ($i = 0; $i < AVESMAPS_KARTENARCHIV_LINK_TOKEN_LAENGE; $i++) {
        $token .= AVESMAPS_KARTENARCHIV_LINK_ALPHABET[ord($bytes[$i]) % $alphabetLaenge];
    }

    return $token;
}

/**
 * Was aus der Adresszeile kommt, auf Form gebracht: der Token oder ''.
 *
 * 💣 Fremdzeichen machen den Token UNGUELTIG, statt still wegzufallen. Wer sie herausfiltert
 * und den Rest weiterreicht, macht aus `abc%def…` einen anderen, moeglicherweise gueltigen
 * Token -- und aus einem Tippfehler den Zugriff auf einen fremden Link.
 */
function avesmapsKartenarchivLinkTokenNormalisieren(string $roh): string
{
    if (strlen($roh) !== AVESMAPS_KARTENARCHIV_LINK_TOKEN_LAENGE) {
        return '';
    }
    if (strspn($roh, AVESMAPS_KARTENARCHIV_LINK_ALPHABET) !== strlen($roh)) {
        return '';
    }

    return $roh;
}

/** Die gewaehlte Frist in Tagen -- alles Unbekannte faellt auf die Vorgabe. */
function avesmapsKartenarchivLinkFrist(mixed $roh): int
{
    $tage = is_numeric($roh) ? (int) $roh : 0;

    return in_array($tage, AVESMAPS_KARTENARCHIV_LINK_FRISTEN, true)
        ? $tage
        : AVESMAPS_KARTENARCHIV_LINK_FRIST_VORGABE;
}

/**
 * Die Notiz „fuer wen" auf eine Zeile und auf Laenge gebracht.
 *
 * 💣 Kein `mb_substr`: ohne die mbstring-Erweiterung waere das ein Fatal mit LEEREM Rumpf --
 * dieselbe Falle, die der SVG-Abzug im Schreibweg schon bezahlt hat. PCRE mit `/u` schneidet
 * ebenfalls nach Zeichen und ist immer da.
 */
function avesmapsKartenarchivLinkNotiz(string $roh): string
{
    $eine = (string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $roh);
    $eine = trim((string) preg_replace('/\s+/u', ' ', $eine));

    $gekappt = preg_replace('/^(.{0,' . AVESMAPS_KARTENARCHIV_LINK_NOTIZ_MAX . '}).*$/su', '$1', $eine);

    return is_string($gekappt) ? $gekappt : '';
}

/**
 * Gilt dieser Link JETZT noch?
 *
 * 🔴 DIE tragende Rechnung dieser Datei -- an ihr haengt der ganze Unterschied zu dem Link,
 * den der Owner am 23.08.2026 verworfen hat.
 *
 * 🔴 Sie faellt GESCHLOSSEN aus: keine Zeile, kein Ablaufdatum, ein leeres Feld -- alles
 * heisst „nein". Der schlimmste Fall ist damit ein Link, der zu frueh aufhoert zu wirken,
 * nie einer, der zu lange gilt.
 *
 * ⚠️ Verglichen wird als ZEICHENKETTE. Das Format 'Y-m-d H:i:s' ist lexikografisch sortierbar,
 * also braucht es dafuer weder eine Zeitzone noch `strtotime` -- und dieselbe Ordnung gilt in
 * MySQL wie in SQLite, was die Abfragen weiter unten portabel macht.
 *
 * @param array<string, mixed>|null $zeile
 */
function avesmapsKartenarchivLinkIstGueltig(?array $zeile, string $jetzt): bool
{
    if ($zeile === null) {
        return false;
    }
    if (($zeile['revoked_at'] ?? null) !== null && (string) $zeile['revoked_at'] !== '') {
        return false;
    }

    $ablauf = (string) ($zeile['expires_at'] ?? '');
    if ($ablauf === '') {
        return false;
    }

    // Auf der Ablaufsekunde selbst gilt er noch.
    return $jetzt <= $ablauf;
}

/**
 * Was in der Liste des Editors steht: „noch 6 Tage", „abgelaufen".
 *
 * ⚠️ KLARTEXT, keine HTML-Entities -- das Maskieren gehoert der Seite. Ein „&auml;" hier
 * waere in jedem anderen Aufrufer sichtbarer Muell.
 */
function avesmapsKartenarchivLinkRestText(string $ablauf, string $jetzt): string
{
    $ende = strtotime($ablauf);
    $start = strtotime($jetzt);
    if ($ende === false || $start === false || $ende <= $start) {
        return 'abgelaufen';
    }

    $sekunden = $ende - $start;
    $tage = (int) floor($sekunden / 86400);
    if ($tage >= 1) {
        return 'noch ' . $tage . ($tage === 1 ? ' Tag' : ' Tage');
    }

    $stunden = (int) floor($sekunden / 3600);
    if ($stunden >= 1) {
        return 'noch ' . $stunden . ($stunden === 1 ? ' Stunde' : ' Stunden');
    }

    return 'läuft in weniger als 1 Stunde ab';
}

/**
 * Der Name, unter dem ein Token-Download im Protokoll steht.
 *
 * 🔴 Zusage 4 des Entwurfs vom 23.08.2026 lautet „jeder Download hinterlaesst eine Zeile mit
 * Namen". Auf diesem Weg gibt es keinen angemeldeten Namen -- also traegt die Zeile den
 * ERZEUGER des Links und dessen Zweck. Ein „extern" oder ein leeres Feld waere das Ende
 * dieser Zusage, und zwar lautlos: die Tabelle saehe weiter gepflegt aus.
 */
function avesmapsKartenarchivLinkBeleg(string $erzeuger, string $notiz): string
{
    $text = 'Link von ' . ($erzeuger !== '' ? $erzeuger : 'unbekannt');
    if ($notiz !== '') {
        $text .= ' · ' . $notiz;
    }

    $gekappt = preg_replace('/^(.{0,' . AVESMAPS_KARTENARCHIV_LINK_BELEG_MAX . '}).*$/su', '$1', $text);
    if (is_string($gekappt)) {
        return $gekappt;
    }

    // 💣 FAELLT GESCHLOSSEN AUS, und das war er zuerst nicht: `preg_replace` mit `/u` liefert
    // `null`, sobald die Eingabe kein gueltiges UTF-8 ist -- und der Rueckfall war der
    // UNGEKAPPTE Text. Gemessen 214 Zeichen statt der zugesagten 120, mit kaputten Bytes darin;
    // in `actor_name VARCHAR(120)` heisst das je nach SQL-Modus eine Ausnahme, und die faengt
    // der Protokollblock des Endpunkts ab: der Download liefe durch, die Zeile fehlte, und
    // Zusage 4 des Entwurfs waere fuer genau diesen Download lautlos ausgefallen.
    // Der Weg dorthin ist eng (`creator_name` kommt aus der Datenbank, `note` ist schon
    // normalisiert) -- aber ein Rueckfall, der die Zusicherung VERLETZT, ist kein Rueckfall.
    $hart = (string) preg_replace('/[^\x20-\x7E]/', '', substr($text, 0, AVESMAPS_KARTENARCHIV_LINK_BELEG_MAX));

    return $hart !== '' ? $hart : 'Link (Name nicht lesbar)';
}

/**
 * Die Adresse zum Verschicken -- absolut, denn sie verlaesst diesen Rechner.
 *
 * 💣 KEIN `datei=` darin. Die Datei haengt am Token; stuende sie in der Adresse, koennte der
 * Empfaenger eines Kachel-Links (161 MB) den Parameter auf die Gesamtkarte (1,73 GB)
 * umschreiben -- ein Link waere dann ein Link auf ALLES.
 */
function avesmapsKartenarchivLinkAdresse(string $host, string $token, bool $https = true): string
{
    if ($token === '' || $host === '') {
        return '';
    }

    return ($https ? 'https://' : 'http://') . $host . '/api/edit/map/kartenarchiv.php?token=' . rawurlencode($token);
}

/** Jetzt, im Format dieser Datei. */
function avesmapsKartenarchivLinkJetzt(): string
{
    return date(AVESMAPS_KARTENARCHIV_LINK_ZEITFORMAT);
}

// ================================================================================================
// Datenbank
// ================================================================================================

/**
 * Die Tabelle -- selbstheilend wie der Rest des Schemas (AGENTS.md §5).
 *
 * ⚠️ `creator_name` steht MIT in der Zeile und wird nicht per JOIN geholt: ein geloeschter
 * Benutzer soll den Beleg nicht unlesbar machen. Dieselbe Ueberlegung wie bei
 * `map_archive_download.actor_name` nebenan.
 *
 * 💣 Der Token steht im KLARTEXT, nicht als Hash. Ein Hash waere die sauberere Bauform fuer
 * ein Geheimnis -- aber dann kann der Editor seinen Link nach dem Anlegen nie wieder ansehen,
 * und genau das ist der Handgriff, um den es geht (kopieren, in eine Mail kleben). Der Preis
 * ist benannt: ein Datenbank-Backup enthaelt gueltige Token. Es ist admin-only und traegt
 * ohnehin `users.password_hash`, und ein Token stirbt nach spaetestens 30 Tagen von selbst.
 */
function avesmapsKartenarchivLinkEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_archive_link (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            token VARCHAR(64) NOT NULL,
            file_name VARCHAR(190) NOT NULL,
            note VARCHAR(190) NOT NULL DEFAULT '',
            creator_user_id BIGINT UNSIGNED NULL,
            creator_name VARCHAR(120) NOT NULL,
            hits INT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            revoked_at DATETIME NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_archive_link_token (token),
            KEY idx_archive_link_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * Raeumt, was lange genug abgelaufen ist.
 *
 * 🔴 Geloescht wird AUSSCHLIESSLICH nach Ablauf plus Gnadenfrist -- nie nach Zeilenzahl.
 * Die Begruendung steht bei AVESMAPS_KARTENARCHIV_LINK_MAX_AKTIV: eine Kappung nach Anzahl
 * traefe zuerst die aeltesten und damit die laengst verschickten Links.
 *
 * @return int Wie viele Zeilen dieser Lauf geloescht hat.
 */
function avesmapsKartenarchivLinkAufraeumen(PDO $pdo, ?string $jetzt = null): int
{
    $jetzt ??= avesmapsKartenarchivLinkJetzt();
    $grenze = date(
        AVESMAPS_KARTENARCHIV_LINK_ZEITFORMAT,
        (int) strtotime($jetzt) - AVESMAPS_KARTENARCHIV_LINK_GNADENFRIST_TAGE * 86400
    );

    $statement = $pdo->prepare('DELETE FROM map_archive_link WHERE expires_at < :grenze');
    $statement->execute(['grenze' => $grenze]);

    return $statement->rowCount();
}

/** Wie viele Links gerade GELTEN. */
function avesmapsKartenarchivLinkAktivZaehlen(PDO $pdo, ?string $jetzt = null): int
{
    $jetzt ??= avesmapsKartenarchivLinkJetzt();

    $statement = $pdo->prepare(
        'SELECT COUNT(*) FROM map_archive_link WHERE revoked_at IS NULL AND expires_at >= :jetzt'
    );
    $statement->execute(['jetzt' => $jetzt]);

    return (int) $statement->fetchColumn();
}

/**
 * Legt einen Link an und gibt seinen Token zurueck.
 *
 * @throws RuntimeException wenn der Deckel erreicht ist -- ausdruecklich, nicht still. Ein
 *         stillschweigend nicht angelegter Link waere von einem angelegten nicht zu
 *         unterscheiden, und der Editor verschickte eine Adresse, die es nicht gibt.
 */
function avesmapsKartenarchivLinkAnlegen(
    PDO $pdo,
    string $dateiName,
    int $tage,
    ?int $userId,
    string $userName,
    string $notiz,
    ?string $jetzt = null,
    ?string $verzeichnis = null
): string {
    $jetzt ??= avesmapsKartenarchivLinkJetzt();

    // 🔴 DER PFAD-RIEGEL STEHT HIER, nicht nur beim Aufrufer. Heute gibt es genau einen
    // (edit/svg-export.php); morgen ist das kein Argument mehr -- „eine Regel, die einen von
    // mehreren Erzeugern bindet, ist keine Regel" ist in diesem Haus mehrfach bezahlt worden.
    // ⚠️ Ein Ausbruch waere hier ohnehin nicht moeglich (der Download prueft jede Zeile noch
    // einmal), aber ein Link auf eine Datei, die es nicht geben darf, scheiterte dann erst
    // BEIM EMPFAENGER -- als 404, das keiner von beiden sich erklaeren kann.
    if (avesmapsKartenarchivPfad($dateiName, $verzeichnis) === null) {
        throw new RuntimeException('Dieses Archiv gibt es nicht.');
    }

    // Erst raeumen, dann zaehlen: sonst blockieren laengst tote Zeilen den Deckel.
    avesmapsKartenarchivLinkAufraeumen($pdo, $jetzt);

    if (avesmapsKartenarchivLinkAktivZaehlen($pdo, $jetzt) >= AVESMAPS_KARTENARCHIV_LINK_MAX_AKTIV) {
        throw new RuntimeException(
            'Es gelten bereits ' . AVESMAPS_KARTENARCHIV_LINK_MAX_AKTIV
            . ' Links. Zieh einen davon zurueck, bevor du einen neuen anlegst.'
        );
    }

    $ablauf = date(AVESMAPS_KARTENARCHIV_LINK_ZEITFORMAT, (int) strtotime($jetzt) + $tage * 86400);
    $token = avesmapsKartenarchivLinkToken();

    $statement = $pdo->prepare(
        'INSERT INTO map_archive_link (token, file_name, note, creator_user_id, creator_name, created_at, expires_at)
        VALUES (:token, :file_name, :note, :creator_user_id, :creator_name, :created_at, :expires_at)'
    );
    $statement->execute([
        'token' => $token,
        'file_name' => $dateiName,
        'note' => avesmapsKartenarchivLinkNotiz($notiz),
        'creator_user_id' => $userId,
        'creator_name' => $userName,
        'created_at' => $jetzt,
        'expires_at' => $ablauf,
    ]);

    return $token;
}

/**
 * Die Zeile zu einem Token, oder null.
 *
 * ⚠️ Sagt NICHTS ueber Gueltigkeit -- das entscheidet avesmapsKartenarchivLinkIstGueltig, und
 * zwar getrennt, damit die Ablaufrechnung ohne Datenbank pruefbar bleibt.
 *
 * @return array<string, mixed>|null
 */
function avesmapsKartenarchivLinkFinden(PDO $pdo, string $token): ?array
{
    $sauber = avesmapsKartenarchivLinkTokenNormalisieren($token);
    if ($sauber === '') {
        return null;
    }

    $statement = $pdo->prepare('SELECT * FROM map_archive_link WHERE token = :token LIMIT 1');
    $statement->execute(['token' => $sauber]);
    $zeile = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($zeile) ? $zeile : null;
}

/** Eine Nutzung mehr. */
function avesmapsKartenarchivLinkTrefferZaehlen(PDO $pdo, int $id): void
{
    $statement = $pdo->prepare('UPDATE map_archive_link SET hits = hits + 1 WHERE id = :id');
    $statement->execute(['id' => $id]);
}

/**
 * Zieht einen Link zurueck. Gibt false zurueck, wenn es nichts zurueckzuziehen gab.
 *
 * ⚠️ Die Zeile BLEIBT stehen. Sie ist der Beleg, dass es den Link gab und wer ihn ausgegeben
 * hat -- geloescht waere die Ruecknahme selbst unbelegt.
 */
function avesmapsKartenarchivLinkZurueckziehen(PDO $pdo, int $id, ?string $jetzt = null): bool
{
    $jetzt ??= avesmapsKartenarchivLinkJetzt();

    $statement = $pdo->prepare(
        'UPDATE map_archive_link SET revoked_at = :jetzt WHERE id = :id AND revoked_at IS NULL'
    );
    $statement->execute(['jetzt' => $jetzt, 'id' => $id]);

    return $statement->rowCount() > 0;
}

/**
 * Was der Editor sieht -- neueste zuerst.
 *
 * ⚠️ Auch abgelaufene und zurueckgezogene Zeilen sind dabei (bis die Gnadenfrist sie raeumt):
 * „mein Link tut nichts mehr" braucht eine sichtbare Antwort.
 *
 * @return list<array<string, mixed>>
 */
function avesmapsKartenarchivLinkListe(PDO $pdo): array
{
    $statement = $pdo->query('SELECT * FROM map_archive_link ORDER BY id DESC');
    $zeilen = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);

    return is_array($zeilen) ? array_values($zeilen) : [];
}
