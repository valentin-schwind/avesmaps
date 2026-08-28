<?php

declare(strict_types=1);

/**
 * Ruling R10: eine Ablehnung darf auf JEDEM change_type stehen, nicht nur auf 'deleted'.
 *
 * Lauf, vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/sync-plan-decline-changetype-test.php
 *
 * 🔴 DAS IST EIN ABLAUF, KEIN MASS. Abgelehnt wird wirklich, und die Zeile wird ueber DENSELBEN
 * Leseweg wiedergefunden, den die Arbeitsliste des Garetien-Importers benutzt
 * (avesmapsSyncPlanDecisions, api/_internal/import/garetien-liste.php -- dort `declined_at` je
 * avesmapsSyncPlanDecisionKey(entity_key, change_type), und daraus der Stand 'abgelehnt').
 * Ein Test, der nur den Funktionskopf liest, koennte nicht sagen, ob die Zeile ankommt.
 *
 * 💣 WARUM EIN PDO-ABLEGER UND KEINE UMGESCHRIEBENE ABFRAGE. Der Upsert ist echtes MySQL
 * (`ON DUPLICATE KEY UPDATE`, `UTC_TIMESTAMP(3)`); SQLite kennt beides nicht. Wer die
 * PRODUKTIONSFORM verbiegt, damit ein Test laeuft, hat den Test gegen die Produktion gedreht
 * (AGENTS.md §9, Fehler 1093). Gebogen wird deshalb hier, im Test -- dieselbe Bauform wie in
 * api/_internal/app/__tests__/ecosystem-display-test.php.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: der Treiber pdo_sqlite fehlt -- dieser Test wuerde nichts belegen.\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';

$pruefungen = 0;
$pruefe = static function (bool $bedingung, string $warum) use (&$pruefungen): void {
    assert($bedingung, $warum);
    $pruefungen++;
};

/**
 * SQLite mit MySQL-Manieren -- NUR fuer diesen Test.
 *
 * ⚠️ Der Ersatz ist an die WOERTLICHE Zeichenkette der Produktionsabfrage gebunden. Formuliert
 * jemand den Upsert um, greift er nicht mehr, SQLite lehnt die Abfrage ab und dieser Test wird
 * ROT -- gewollt: dann hat sich die Produktionsform bewegt und will angesehen werden.
 */
final class AvesmapsSyncPlanDeclineTestPdo extends PDO
{
    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            [
                'ON DUPLICATE KEY UPDATE declined_at = UTC_TIMESTAMP(3), declined_by = VALUES(declined_by)',
                'UTC_TIMESTAMP(3)',
            ],
            [
                'ON CONFLICT(kind, entity_key, change_type) DO UPDATE SET'
                . ' declined_at = excluded.declined_at, declined_by = excluded.declined_by',
                "datetime('now')",
            ],
            (string) $query
        );

        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsSyncPlanDeclineTestPdo('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);
avesmapsEnsureSyncPlanTablesSqlite($pdo);

// ---- Die Fixture: EIN offener Garetien-Lauf mit drei Zeilen -----------------------------------
//
// So sieht ein Objekt des Imports wirklich aus (garetien-plan.php): ein Basis-Eintrag ohne Pipe
// und Abschnitts-Eintraege `<basis>|<anlass>|<public_id>`. KEINE Loeschung ist dabei -- genau das
// ist der Grund fuer dieses Ruling.
$pdo->exec("INSERT INTO sync_plan_run (id, kind, state) VALUES (7, 'garetien', 'open')");
$pdo->exec("INSERT INTO sync_plan_run (id, kind, state) VALUES (8, 'garetien', 'open')");

$lege = static function (PDO $pdo, int $id, int $runId, string $key, string $typ) : void {
    // :k und :label getrennt, obwohl beide $key tragen: MySQL lehnt denselben benannten
    // Platzhalter zweimal mit HY093 ab (avesmapsCreatePdo setzt EMULATE_PREPARES => false), und
    // eine Fixture in einer Form, die live nie liefe, ist die Vorlage fuer den naechsten
    // Schreibweg.
    $pdo->prepare(
        'INSERT INTO sync_plan_item (id, run_id, entity_key, change_type, label, selected)
         VALUES (:id, :r, :k, :t, :label, 1)'
    )->execute(['id' => $id, 'r' => $runId, 'k' => $key, 't' => $typ, 'label' => $key]);
};
$lege($pdo, 101, 7, 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 'changed');
$lege($pdo, 102, 7, 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-6120', 'changed');
$lege($pdo, 103, 7, 'ggp:Gewaesser:Sumpf:Blutmoor', 'new');
$lege($pdo, 201, 8, 'fremder:Lauf:Zeile', 'changed');
// 💣 ZWEI Zeilen mit DEMSELBEN Schluessel. `sync_plan_item` traegt darauf keinen eindeutigen
// Index (die DDL kennt nur zwei KEYs), und garetien-plan.php kappt seinen entity_key bei 190
// Zeichen (`mb_substr`) -- zwei lange Schluessel koennen danach gleich sein. Fuer sync_decision
// ist das EINE Entscheidung, und die Aufrufer zaehlen die Rueckgabe.
$lege($pdo, 104, 7, 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 'changed');

// ---- A. Ablehnen auf 'changed' -- und der echte Leseweg findet es wieder ----------------------

avesmapsSyncPlanRecordDecline($pdo, 'garetien', 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 5, 'changed');

$entscheidungen = avesmapsSyncPlanDecisions($pdo, 'garetien');
$schluesselGeaendert = avesmapsSyncPlanDecisionKey('ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 'changed');
$pruefe(
    ($entscheidungen[$schluesselGeaendert]['declined_at'] ?? null) !== null,
    'Ruling R10: eine Ablehnung auf change_type="changed" muss ueber avesmapsSyncPlanDecisions '
    . 'wiederauffindbar sein -- genau daraus rechnet die Arbeitsliste den Stand "abgelehnt". '
    . 'Vor dem 28.08.2026 landete sie auf "deleted" und der Reiter "Abgelehnt" konnte NIE belegt werden.'
);
// 💣 Die DIFFERENZ, nicht nur das Ergebnis: unter dem 'deleted'-Schluessel darf jetzt NICHTS
// stehen. Ohne diese Zusicherung waere ein Aufruf, der beides schreibt, ebenfalls gruen.
$pruefe(
    !isset($entscheidungen[avesmapsSyncPlanDecisionKey('ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 'deleted')]),
    'die Ablehnung darf NUR auf ihrem eigenen change_type stehen'
);
$pruefe(count($entscheidungen) === 1, 'genau EINE Entscheidung, nicht zwei');

// ---- B. Gegenprobe: OHNE fuenftes Argument bleibt es 'deleted' --------------------------------
//
// 💣 Die uebrigen Arten rufen diese Funktion OHNE fuenftes Argument -- citymap, lore, lore_rule,
// territory, territory_wiki. Diese Aufzaehlung reproduziert (gefahren, liefert genau diese fuenf
// Zeilen und sonst nichts -- das abschliessende `, $userId);` IST das Kriterium):
//     git grep -n 'avesmapsSyncPlanRecordDecline($pdo, .*, $userId);' -- api
// Eine andere Vorgabe verschoebe ihre Entscheidungen lautlos auf einen Schluessel, den ihr
// eigener Lesepfad nicht abfragt.

avesmapsSyncPlanRecordDecline($pdo, 'citymap', 'stadtplanindex:havena', 5);
$citymap = avesmapsSyncPlanDecisions($pdo, 'citymap');
$pruefe(
    ($citymap[avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'deleted')]['declined_at'] ?? null) !== null,
    'ohne fuenftes Argument schreibt die Funktion weiterhin auf "deleted" -- sonst braechen die '
    . 'fuenf vorhandenen Aufrufer lautlos'
);
$pruefe(count($citymap) === 1, 'und sie schreibt genau EINE Zeile');

// ---- C. Zweimal ablehnen ist kein Fehler ------------------------------------------------------
//
// Der Upsert muss auch im TEST-Dialekt wirklich ein Upsert sein: liefe er als blankes INSERT,
// braeche der zweite Aufruf am Primaerschluessel -- und der Test bewiese, dass die Umschreibung
// oben etwas anderes tut als die Produktion.
avesmapsSyncPlanRecordDecline($pdo, 'garetien', 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 9, 'changed');
$nachZweitem = avesmapsSyncPlanDecisions($pdo, 'garetien');
$pruefe(count($nachZweitem) === 1, 'zweimal abgelehnt bleibt EINE Zeile (der Upsert ist einer)');

// ---- D. Der Uebersprung-Zaehler und die Ablehnung teilen sich EINE Zeile ----------------------
//
// 🔴 Das ist der Kern von Ruling R10: der Primaerschluessel ist (kind, entity_key, change_type),
// `skipped_count` und `declined_at` sind zwei SPALTEN derselben Zeile. Eine Ablehnung auf
// 'changed' kollidiert also NICHT mit dem Zaehler -- sie stehen nebeneinander.
$pdo->prepare(
    'INSERT INTO sync_decision (kind, entity_key, change_type, skipped_count)
     VALUES (:k, :ek, :ct, 3)
     ON CONFLICT(kind, entity_key, change_type) DO UPDATE SET skipped_count = 3'
)->execute(['k' => 'garetien', 'ek' => 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 'ct' => 'changed']);
$beide = avesmapsSyncPlanDecisions($pdo, 'garetien')[$schluesselGeaendert];
$pruefe($beide['skipped_count'] === 3 && $beide['declined_at'] !== null,
    'Zaehler und Ablehnung stehen NEBENEINANDER in derselben Zeile -- keine verdraengt die andere');

// ---- E. avesmapsSyncPlanDeclinedKeys bleibt bei den LOESCHUNGEN -------------------------------
//
// ⚠️ Ausdrueckliche Nicht-Aenderung (Brief): sie unterdrueckt das Wiedervorschlagen von
// Loeschungen. Eine abgelehnte Garetien-Zeile SOLL wiederkommen, wenn die Quelle sich aendert.
$loeschKeys = avesmapsSyncPlanDeclinedKeys($pdo, 'garetien');
$pruefe($loeschKeys === [], 'eine Garetien-Ablehnung taucht NICHT in der Loeschungs-Sperrliste auf');
$pruefe(avesmapsSyncPlanDeclinedKeys($pdo, 'citymap') === ['stadtplanindex:havena'],
    'die Gegenprobe: eine echte Loeschungs-Ablehnung steht sehr wohl darin -- sonst misst die '
    . 'Zeile darueber nur eine leere Tabelle'
);

// ---- F. avesmapsSyncPlanDecisionTargetsForItems: ids -> (entity_key, change_type) -------------
//
// 🔴 Die Oberflaeche schickt ZEILEN-IDs. Der `entity_key` ist ein Interna des Planbaus, und
// `change_type` muesste der Browser sonst mitfuehren.

$ziele = avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, [101, 103]);
usort($ziele, static fn(array $a, array $b): int => strcmp($a['entity_key'], $b['entity_key']));
$pruefe($ziele === [
    ['entity_key' => 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 'change_type' => 'changed'],
    ['entity_key' => 'ggp:Gewaesser:Sumpf:Blutmoor', 'change_type' => 'new'],
], 'die zwei Zeilen kommen mit ihrem EIGENEN change_type zurueck -- "new" und "changed" gemischt');

// 💣 Der Lauf-Filter, an einer id, die es WIRKLICH gibt: 201 liegt in Lauf 8. Ohne `run_id` im
// WHERE koennte eine fremde id eine Entscheidung schreiben, die niemand angefordert hat.
// ⚠️ Die Gegenprobe gehoert dazu, sonst belegt die Zeile nur, dass irgendetwas leer ist.
$pruefe(avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, [201]) === [],
    'eine id aus einem FREMDEN Lauf faellt heraus');
$pruefe(count(avesmapsSyncPlanDecisionTargetsForItems($pdo, 8, [201])) === 1,
    'und dieselbe id im richtigen Lauf kommt durch -- die Zeile darueber misst den Filter, nicht das Nichts');

$pruefe(avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, [999]) === [], 'eine unbekannte id liefert nichts');
$pruefe(avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, []) === [], 'keine ids, keine Ziele');
$pruefe(avesmapsSyncPlanDecisionTargetsForItems($pdo, 0, [101]) === [], 'ohne Lauf gar nichts');
$pruefe(count(avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, [101, 101, '101'])) === 1,
    'dieselbe id mehrfach genannt ist EIN Ziel');
// 💣 Die eigentliche Entdoppelung: ZWEI VERSCHIEDENE ids (101 und 104), EIN Schluessel. Ohne sie
// stuende dieselbe Entscheidung zweimal in der Rueckgabe, und der Endpunkt meldete
// `declined: 2` fuer eine einzige Zeile.
$pruefe(count(avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, [101, 104])) === 1,
    'zwei Zeilen mit demselben (entity_key, change_type) sind EINE Entscheidung');
$pruefe(count(avesmapsSyncPlanDecisionTargetsForItems($pdo, 7, [101, 102])) === 2,
    'zwei VERSCHIEDENE Schluessel sind ZWEI Ziele (Gegenprobe zur Entdoppelung)');

// ---- G. Zuruecknehmen -- „Wieder vorschlagen" -------------------------------------------------
//
// 🔴 Eine Ablehnung ohne Rueckweg ist ein schwarzes Loch (Entwurf §5). avesmapsSyncPlanUndecline
// filterte bis zum 28.08.2026 ebenfalls fest auf 'deleted' -- der Knopf haette nichts getan.

$genommen = avesmapsSyncPlanUndecline($pdo, 'garetien', ['ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471'], 'changed');
$pruefe($genommen === 1, 'die Ablehnung auf "changed" laesst sich zuruecknehmen');
$pruefe(avesmapsSyncPlanDecisions($pdo, 'garetien') === [],
    'und die Zeile ist wirklich weg -- samt ihres Uebersprung-Zaehlers, der in derselben Zeile stand'
);
// 💣 Die DIFFERENZ: mit der Vorgabe 'deleted' haette derselbe Aufruf NICHTS getroffen.
avesmapsSyncPlanRecordDecline($pdo, 'garetien', 'ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471', 5, 'changed');
$pruefe(avesmapsSyncPlanUndecline($pdo, 'garetien', ['ggp:Gewaesser:Fluss:Natter|ergaenzung|w-4471']) === 0,
    'ohne viertes Argument sucht sie weiterhin nach LOESCHUNGEN und findet die Garetien-Zeile nicht');
$pruefe(count(avesmapsSyncPlanDecisions($pdo, 'garetien')) === 1,
    'die Ablehnung steht also noch -- die Zeile darueber misst wirklich einen Fehlschlag');
// Und die Vorgabe trifft ihre eigene Art nach wie vor.
$pruefe(avesmapsSyncPlanUndecline($pdo, 'citymap', ['stadtplanindex:havena']) === 1,
    'ohne viertes Argument nimmt sie eine echte Loeschungs-Ablehnung zurueck (Rueckwaertskompatibilitaet)');
$pruefe(avesmapsSyncPlanUndecline($pdo, 'garetien', []) === 0, 'eine leere Liste ist kein Fehler');
$pruefe(avesmapsSyncPlanUndecline($pdo, 'garetien', ['  ']) === 0, 'ein leerer Schluessel auch nicht');

echo "sync-plan decline change_type ok -- {$pruefungen} Zusicherungen\n";
