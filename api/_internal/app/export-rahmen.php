<?php

declare(strict_types=1);

// Der gemeinsame Rahmen der Legacy-Exporte E1–E5 (Auftrag von Avesmaps3D, 04.10.2026:
// project-control/legacy-requests/2026-10-04-infopanel-domaenen-und-medien-exporte.md im Repo avesmaps3D).
//
// Jeder Export folgt demselben Muster wie die zwei Vorbilder (api/app/ecosystem-regions.php und
// api/app/political-territories-export.php): nur GET, kein Schreibweg, kein DDL, eine harte Positivliste der
// Felder, ein Stand vor und nach dem Lesen (bewegt er sich, wird erneut gelesen, nach drei Versuchen
// `503 data_changing`), ein Inhalts-ETag auch als `X-Avesmaps-ETag`, `no-cache, must-revalidate`, `304`.
//
// 🔴 WARUM EIN RAHMEN UND NICHT DIE DRITTE BIS ACHTE ABSCHRIFT. Die zwei Vorbilder tragen dieselben vier
// Bausteine je einmal (Projektion, Lese-Schleife, ETag, Kopfzeilen samt Reihenfolge). Sechs weitere Exporte
// haetten sechs weitere Fassungen der Kopfzeilen-Reihenfolge bedeutet -- und genau DIESE Reihenfolge ist der
// Vertrag (Kopfzeilen erst NACH dem Lesen, sonst reist ein gueltiger Tag auf einer 500 mit). Die zwei
// Vorbilder bleiben unangetastet; wer sie anfasst, darf sie hierher holen.
//
// 🔴 NUR LESEN, AUCH IM RAHMEN: keine Abfrage, die schreibt, kein Ensure, kein Zwischenspeicher auf Platte.
// Gewacht von api/_internal/app/__tests__/export-rahmen-test.php (fuehrt die Schleife und den Fingerabdruck
// gegen SQLite aus und vergleicht den GANZEN Datenbankinhalt vor und nach dem Lesen).

// Wie oft gelesen wird, bevor ein Export aufgibt, weil sich der Stand waehrend des Lesens bewegt.
const AVESMAPS_EXPORT_VERSUCHE = 3;

// Der Stand hat sich bei jedem Versuch unter dem Lesen bewegt -- es wird gerade viel gespeichert.
// Der Endpunkt macht daraus `503 data_changing` mit `Retry-After`, nie ein 500.
final class AvesmapsExportInBewegung extends RuntimeException
{
}

/**
 * REIN: eine Zeile auf die freigegebenen Felder beschneiden, in der Reihenfolge der Liste.
 *
 * ⚠️ Ein Feld, das der Zeile fehlt, wird NICHT als null ergaenzt -- „fehlt" und „ist null" sind zwei
 * Aussagen, und die Projektion soll keine erfinden. Wer ein Feld IMMER liefern will, setzt es vorher.
 */
function avesmapsExportProjektion(array $zeile, array $felder): array
{
    $ergebnis = [];
    foreach ($felder as $feld) {
        if (array_key_exists($feld, $zeile)) {
            $ergebnis[$feld] = $zeile[$feld];
        }
    }

    return $ergebnis;
}

/**
 * Der Fingerabdruck einer Tabellenliste: Zeilenzahl, hoechste Kennung und juengster Zeitstempel je Tabelle.
 *
 * Die Zahl und die hoechste Kennung fangen, was ein Zeitstempel nicht sieht: eine HART geloeschte Zeile
 * (ihr Zeitstempel ist mit ihr weg). Ein Zeitstempel, der bei jeder Zeilenaenderung steigt
 * (`ON UPDATE CURRENT_TIMESTAMP`), faengt die Aenderung einer Zeile in der Mitte. Wo eine Tabelle keinen
 * solchen Zeitstempel hat, steht null -- dann sieht der Fingerabdruck nur Zahl und Kennung, und der
 * Inhalts-ETag des Endpunkts deckt den Rest.
 *
 * ⚠️ Die Tabellen- und Spaltennamen kommen AUSSCHLIESSLICH aus den Konstanten der Exporte, nie aus einer
 * Anfrage -- deshalb ist der verkettete Bezeichner hier kein Einfallstor. Der Test haelt fest, dass kein
 * Aufrufer etwas anderes als ein Literal hereinreicht.
 *
 * @param list<array{0:string,1:?string,2?:string}> $tabellen [Tabelle, Zeitstempelspalte|null, Kennungsspalte = 'id']
 */
function avesmapsExportTabellenFingerabdruck(PDO $pdo, array $tabellen): string
{
    $teile = [];
    foreach ($tabellen as $eintrag) {
        $tabelle = (string) $eintrag[0];
        $zeitspalte = $eintrag[1] ?? null;
        $kennung = (string) ($eintrag[2] ?? 'id');
        $sql = 'SELECT COUNT(*) AS anzahl, MAX(' . $kennung . ') AS hoechste'
            . ($zeitspalte !== null ? ', MAX(' . $zeitspalte . ') AS neuester' : '')
            . ' FROM ' . $tabelle;
        $zeile = $pdo->query($sql)->fetch(PDO::FETCH_ASSOC) ?: [];
        $teile[] = $tabelle . ':' . (int) ($zeile['anzahl'] ?? 0) . ':' . (string) ($zeile['hoechste'] ?? '')
            . ':' . (string) ($zeile['neuester'] ?? '');
    }

    return implode('|', $teile);
}

/**
 * Der Fingerabdruck GENANNTER Schalter in `app_setting` -- nie der ganzen Tabelle.
 *
 * ⚠️ Warum nicht die Tabelle: in `app_setting` schreiben auch Hintergrundlaeufe (Kurvenlabels, Hoehenfeld,
 * Zoombaender, Darstellungstafel). Jeder solche Schreibvorgang waehrend des Lesens zwaenge einen weiteren Versuch
 * und im schlimmsten Fall ein 503, obwohl sich an den Daten des Exports nichts geaendert hat.
 *
 * @param list<string> $schluessel
 */
function avesmapsExportEinstellungenFingerabdruck(PDO $pdo, array $schluessel): string
{
    if ($schluessel === []) {
        return '';
    }
    $statement = $pdo->prepare(
        'SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN ('
        . implode(',', array_fill(0, count($schluessel), '?')) . ') ORDER BY setting_key ASC'
    );
    $statement->execute(array_values($schluessel));

    return (string) json_encode($statement->fetchAll(PDO::FETCH_NUM));
}

/**
 * Die Zahl aus `map_revision` (dieselbe, die map-features.php als `revision` traegt), fehlend = 0.
 * Sie ist bei den meisten Exporten nur die Klammer zu den Schwester-Dateien -- viele Schreibwege heben sie nicht.
 */
function avesmapsExportMapRevision(PDO $pdo): int
{
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $wert = $statement !== false ? $statement->fetchColumn() : false;

    return $wert === false ? 0 : (int) $wert;
}

/**
 * REIN: ein kurzer, lesbarer Stempel aus einem Fingerabdruck -- `<praefix>-<16 Hexzeichen>`.
 */
function avesmapsExportStempel(string $praefix, string $fingerabdruck): string
{
    return $praefix . '-' . substr(hash('sha1', $fingerabdruck), 0, 16);
}

/**
 * Lesen -- und den Stand nur nennen, wenn er waehrend des Lesens stillstand.
 *
 * 💣 DER GRUND FUER DIE SCHLEIFE. Stand gelesen, dann Daten gelesen: speichert dazwischen jemand, nennt die
 * Antwort einen Stand, der ihre Daten NICHT beschreibt -- und Avesmaps3D haelt Dateien fuer gleichstaendig,
 * die es nicht sind. Also vorher und nachher lesen: gleich = in diesem Fenster wurde in den gestempelten
 * Tabellen nichts geschrieben. Nach `$versuche` Fehlschlaegen wird geworfen, statt eine Antwort mit falschem
 * Stand zu geben.
 *
 * @param callable(): mixed $stand Liest den Stand (jeder vergleichbare Wert, meist ein Array).
 * @param callable(): mixed $lesen Liest die Daten.
 * @return array{stand: mixed, daten: mixed} Der Stand NACH dem Lesen, in dem nichts mehr geschrieben wurde.
 * @throws AvesmapsExportInBewegung
 */
function avesmapsExportStabilLesen(callable $stand, callable $lesen, int $versuche = AVESMAPS_EXPORT_VERSUCHE): array
{
    for ($versuch = 1; $versuch <= $versuche; $versuch++) {
        $vorher = $stand();
        $daten = $lesen();
        $nachher = $stand();
        if ($vorher === $nachher) {
            return ['stand' => $nachher, 'daten' => $daten];
        }
    }

    throw new AvesmapsExportInBewegung('Der Stand hat sich waehrend des Lesens mehrfach geaendert.');
}

/**
 * REIN: die Antwort als JSON -- dieselben Flaggen wie avesmapsJsonResponse, damit der ETag ueber genau die
 * Bytes laeuft, die hinausgehen.
 */
function avesmapsExportKodieren(array $antwort): string
{
    return json_encode($antwort, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/**
 * REIN: der schwache ETag ueber den INHALT der Antwort.
 *
 * 🔴 BEWUSST KEIN STEMPEL-ETAG -- dieselbe Begruendung wie avesmapsPoliticalTerritoriesExportETag: ein
 * Stempel-ETag ist nur so ehrlich wie die Zusage, dass JEDE Aenderung einen Stempel hebt, und dieses Haus hat
 * an genau dieser Zusage schon mehrfach bezahlt. Der Inhalt kann nicht luegen.
 */
function avesmapsExportETag(string $praefix, string $rumpf): string
{
    return 'W/"' . $praefix . '-' . substr(hash('sha1', $rumpf), 0, 16) . '"';
}

/**
 * Die Antwort hinausschicken: Kopfzeilen, bedingtes Abrufen, Rumpf.
 *
 * 💣 DIESE FUNKTION WIRD ERST NACH DEM LESEN GERUFEN, NIE DAVOR -- sonst truege eine 500 aus dem Lesen
 * denselben gueltigen Tag, und ein Aufrufer, der ablegt, bekaeme beim naechsten Mal „deine Kopie ist
 * aktuell" fuer eine Fehlerseite. `X-Avesmaps-ETag` deshalb, weil STRATO den `ETag` aus Antworten mit Rumpf
 * entfernt (AGENTS.md §10, api/README.md).
 * ⚠️ `$privat`: ein Export hinter einer Anmeldung darf in keinem geteilten Zwischenspeicher liegen.
 */
function avesmapsExportSenden(array $antwort, string $etagPraefix, bool $privat = false): never
{
    $rumpf = avesmapsExportKodieren($antwort);
    $etag = avesmapsExportETag($etagPraefix, $rumpf);
    header('ETag: ' . $etag);
    header('X-Avesmaps-ETag: ' . $etag);
    header('Cache-Control: ' . ($privat ? 'private, no-cache, must-revalidate' : 'no-cache, must-revalidate'));
    header('Vary: Accept-Encoding', false);

    $ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
        http_response_code(304);
        exit;
    }

    avesmapsJsonResponse(200, $antwort);
}

/**
 * Die Antwort auf einen Stand, der sich bei jedem Versuch bewegt hat: kein 500 -- es ist nichts kaputt, es
 * wird nur gerade gespeichert. Ein erneuter Abruf hilft.
 */
function avesmapsExportInBewegungAntworten(string $was): never
{
    header('Retry-After: 10');
    avesmapsErrorResponse(503, 'data_changing', $was . ' werden gerade bearbeitet; bitte in einigen Sekunden erneut abrufen.');
}
