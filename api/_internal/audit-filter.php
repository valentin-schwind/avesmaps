<?php

declare(strict_types=1);

/**
 * „Zeig mir die Zeilen DIESER Leute" -- der Urheber-Filter der drei Aenderungsprotokolle.
 *
 * 🔴 DIE EINE REGEL: ohne Auswahl die juengsten Zeilen von ALLEN, mit Auswahl die juengsten Zeilen
 * VON DEN AUSGEWAEHLTEN. Beide Male dieselbe Zahl, beide Male derselbe Schnitt -- der Filter
 * verschiebt nur, worueber gezaehlt wird. Alles andere waere zwei Bedeutungen fuer einen Haken.
 *
 * Seit dem 22.08.2026 behaelt jedes Protokoll seine Zeilen JE PERSON (siehe audit-prune.php), erst
 * dadurch hat dieser Filter ueberhaupt etwas zu holen: vorher waren die Zeilen der Leiseren nicht
 * ausgeblendet, sondern geloescht.
 *
 * 💣 GEFILTERT WIRD NACH KONTO, NICHT NACH ANZEIGENAME. Die Oberflaeche schickt, was in der Zeile
 * steht -- meist ein Benutzername, manchmal aber „Import" oder ein anderer maschineller Vermerk, der
 * NUR im `after_json` lebt und keine eigene Spalte hat. Ein Name ohne Konto landet deshalb im
 * gemeinsamen Topf der maschinellen Schreiber; die Oberflaeche siebt darin nach wie vor selbst
 * weiter. Zwei Ebenen, jede macht, was sie kann -- und keine behauptet mehr, als sie weiss.
 *
 * ⚠️ Ein leerer Name und eine leere Liste sind NICHT dasselbe wie „keine Auswahl": eine Auswahl, die
 * sich zu nichts aufloest, muss NICHTS liefern, nie alles. Sonst zeigt ein Haken, der nichts trifft,
 * ploetzlich das ganze Protokoll -- der Filter saehe aus, als haette er sich abgeschaltet.
 */

// Die Liste der erlaubten Tabellennamen ist DIESELBE wie beim Aufraeumer -- ein Tabellenname wird in
// den SQL-Text interpoliert, und zwei Listen driften.
require_once __DIR__ . '/audit-prune.php';

/** Mehr Namen nimmt kein Trichter entgegen -- reine Unfallbremse gegen eine praeparierte Anfrage. */
const AVESMAPS_AUDIT_FILTER_MAX_NAMES = 50;

/** So viele Namen nennt die Liste des Trichters hoechstens. */
const AVESMAPS_AUDIT_ROSTER_LIMIT = 50;

/**
 * PUR: die Anzeigenamen aus der Anfrage. Nimmt eine Liste oder eine Zeichenkette mit Komma.
 *
 * @return string[] Getrimmt, ohne Leere, ohne Dubletten, gedeckelt.
 */
function avesmapsAuditReadEditorNames(mixed $raw): array
{
    if ($raw === null) {
        return [];
    }

    $teile = is_array($raw) ? $raw : explode(',', (string) $raw);
    $namen = [];
    foreach ($teile as $teil) {
        if (is_array($teil)) {
            continue;
        }
        $name = trim((string) $teil);
        if ($name === '' || in_array($name, $namen, true)) {
            continue;
        }
        $namen[] = $name;
        if (count($namen) >= AVESMAPS_AUDIT_FILTER_MAX_NAMES) {
            break;
        }
    }

    return $namen;
}

/**
 * Loest Anzeigenamen in Konten auf.
 *
 * @param string[] $namen
 * @return array|null `null` = keine Auswahl, alles zeigen. Sonst
 *                    `['ids' => int[], 'machine' => bool]` -- `machine` heisst: mindestens ein Name
 *                    gehoert zu keinem Konto, also den maschinellen Schreibern.
 */
function avesmapsAuditResolveActorFilter(PDO $pdo, array $namen): ?array
{
    if ($namen === []) {
        return null;
    }

    // 💣 Jeder Platzhalter GENAU EINMAL. avesmapsCreatePdo schaltet ATTR_EMULATE_PREPARES ab, und
    // MySQL lehnt einen doppelt benutzten Namen mit HY093 ab -- derselbe Fehler, an dem „Was ist
    // hier?" mit ok:true und leerem Inhalt geantwortet hat.
    $platzhalter = [];
    $parameter = [];
    foreach (array_values($namen) as $position => $name) {
        $platzhalter[] = ':n' . $position;
        $parameter['n' . $position] = $name;
    }

    $statement = $pdo->prepare(
        'SELECT id, username FROM users WHERE username IN (' . implode(', ', $platzhalter) . ')'
    );
    $statement->execute($parameter);

    $ids = [];
    $gefunden = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $ids[] = (int) $zeile['id'];
        $gefunden[] = (string) $zeile['username'];
    }

    return [
        'ids' => $ids,
        'machine' => count($gefunden) < count($namen),
    ];
}

/**
 * PUR: die WHERE-Bedingung zu einem aufgeloesten Filter.
 *
 * @param array|null $filter Ergebnis von avesmapsAuditResolveActorFilter.
 * @param string     $spalte Voll qualifizierte Spalte, z. B. `audit.actor_user_id`.
 * @param string     $praefix Platzhalter-Praefix, damit zwei Filter im selben Statement kollisionsfrei bleiben.
 * @return array{0: string, 1: array} SQL-Ausdruck (immer klammerbar, nie leer) und seine Parameter.
 */
function avesmapsAuditActorWhereClause(?array $filter, string $spalte, string $praefix = 'af'): array
{
    if ($filter === null) {
        return ['1 = 1', []];
    }

    $teile = [];
    $parameter = [];
    foreach (array_values($filter['ids'] ?? []) as $position => $id) {
        $platzhalter = $praefix . $position;
        $teile[] = $spalte . ' = :' . $platzhalter;
        $parameter[$platzhalter] = (int) $id;
    }

    // 💣 Der Topf der maschinellen Schreiber hat ZWEI Schreibweisen (0 und NULL) -- dieselbe Falle
    // wie beim Aufraeumen, siehe audit-prune.php. Wer nur eine prueft, verliert die Haelfte.
    if (!empty($filter['machine'])) {
        $teile[] = '(' . $spalte . ' IS NULL OR ' . $spalte . ' = 0)';
    }

    // ⚠️ Eine Auswahl, die sich zu nichts aufloest, liefert NICHTS. „1 = 0" statt „1 = 1" -- sonst
    // zeigte ein Haken, der niemanden trifft, ploetzlich das ganze Protokoll.
    if ($teile === []) {
        return ['1 = 0', []];
    }

    return ['(' . implode(' OR ', $teile) . ')', $parameter];
}

/**
 * Wer steht ueberhaupt in diesem Protokoll -- und mit wie vielen Zeilen?
 *
 * 💣 DIESE LISTE DARF NICHT AUS DEN GELADENEN ZEILEN FALLEN. Sobald ein Haken gesetzt ist, liefert
 * der Lesepfad nur noch die Zeilen dieser Person -- eine aus der Antwort abgeleitete Namensliste
 * enthielte dann NUR NOCH SIE, und niemand kaeme je wieder zu den anderen zurueck. Ein Trichter, der
 * sich beim ersten Haken selbst zusperrt, ist schlimmer als keiner. Deshalb zaehlt diese Abfrage
 * ueber die GANZE Tabelle und ignoriert jede Auswahl.
 *
 * ⚠️ Nur KONTEN. Die maschinellen Schreiber haben keinen Namen in der Datenbank -- ihr Vermerk lebt
 * im `after_json` und wird erst in der Oberflaeche zu „Import". Die Oberflaeche ergaenzt solche
 * Namen selbst, aus den Zeilen, die sie gerade sieht; sie tragen dann keine Anzahl, weil hier
 * niemand eine ehrliche nennen kann.
 *
 * @return array<int, array{name: string, count: int}> Nach Anzahl absteigend, gedeckelt.
 */
function avesmapsAuditActorRoster(PDO $pdo, string $table): array
{
    if (!in_array($table, AVESMAPS_AUDIT_PRUNE_TABLES, true)) {
        throw new InvalidArgumentException('Unbekanntes Protokoll: ' . $table);
    }

    $statement = $pdo->prepare(
        'SELECT users.username AS name, COUNT(*) AS anzahl
           FROM ' . $table . ' audit
           INNER JOIN users ON users.id = audit.actor_user_id
          GROUP BY users.id, users.username
          ORDER BY anzahl DESC, users.username ASC
          LIMIT ' . AVESMAPS_AUDIT_ROSTER_LIMIT
    );
    $statement->execute();

    $liste = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $name = trim((string) ($zeile['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        $liste[] = ['name' => $name, 'count' => (int) $zeile['anzahl']];
    }

    return $liste;
}
