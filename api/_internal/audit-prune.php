<?php

declare(strict_types=1);

/**
 * Der gemeinsame Aufraeumer der Aenderungsprotokolle.
 *
 * Anlass (18.08.2026): die Datenbank lief in STRATOs 2-GB-Grenze und wurde schreibgesperrt. Nicht
 * die Inhalte hatten sie gefuellt -- die ganze Karte mit 14.256 Objekten sind 23 MB --, sondern die
 * Protokolle: `ecosystem_geometry_audit_log` allein 716 MB aus 18.375 Zeilen (~40 KB je
 * Editorschritt, jede Zeile traegt die Geometrie vorher UND nachher), `map_audit_log` 133 MB und
 * 696 neue Zeilen am Tag. Keines der beiden hatte je eine Grenze.
 *
 * 🔴 DIE UNTERGRENZE IST DIE ANZEIGEHOEHE, und sie ist nicht verhandelbar: beide Fenster zeigen
 * hoechstens 200 Zeilen (`api/edit/map/audit-log.php` und AVESMAPS_ECOSYSTEM_CHANGE_LOG_LIMIT), und
 * das Rueckgaengigmachen nimmt seine Zeile aus genau dieser Liste. Wer tiefer kappt, nimmt dem
 * Editor Schritte weg, die die Oberflaeche ihm noch anbietet. Ein zu kleiner Wert wird deshalb
 * hochgeklemmt, nicht befolgt.
 *
 * 🔴 SEIT 22.08.2026 GILT DIESE ZAHL JE PERSON, NICHT FUER ALLE ZUSAMMEN (Owner-Auftrag: „jeder
 * editor sieht seine letzten 200"). Vorher loeschte ein einziger produktiver Nachmittag die Zeilen
 * aller anderen -- nicht ausgeblendet, GELOESCHT; kein Filter konnte sie zurueckholen.
 *
 * 🔴 UND SIE GILT UEBER ALLE DREI PROTOKOLLE ZUSAMMEN, nicht je Protokoll (Owner, wenige Stunden
 * spaeter: „jeder person darf max. 200 eintraege haben"). Die Zwischenfassung kappte je Tabelle;
 * im Trichter stand dann fuer eine Person 486 -- die Summe aus drei Protokollen --, waehrend die
 * Liste darunter 200 zeigte. Eine Zahl, die mehr verspricht als die Liste haelt.
 *
 * Der Aufraeumer ist damit zweistufig:
 *   1. `avesmapsPruneActorAcrossAuditLogs` -- laeuft beim Schreiben und raeumt NUR die Zeilen
 *      dessen, der gerade gespeichert hat, dafuer ueber alle drei Protokolle hinweg.
 *   2. `avesmapsPruneAuditLog` -- der globale Riegel, eine reine Unfallbremse gegen das, was hier
 *      niemand kennt: die Zahl der Leute. Er greift erst weit oberhalb des Normalbetriebs.
 *
 * 💣 WENN STUFE 2 GREIFT, GILT DIE ZUSAGE AUS STUFE 1 NICHT MEHR -- sie loescht die aeltesten Zeilen
 * ohne Ansehen der Person. Das ist gewollt (eine volle Datenbank sperrt die ganze Seite), aber es
 * ist eine Entwertung, kein Feature: wer die globalen Werte senkt, nimmt stillschweigend Leuten ihre
 * Historie weg, ohne dass irgendwo etwas rot wird.
 *
 * ⚠️ Vorbild ist avesmapsPoliticalPruneGeometryAuditLog (territories-audit.php) -- gleiche Idee,
 * zwei Unterschiede, beide gemessen:
 *   1. Die Unterabfrage laeuft NICHT im DELETE. Dort brauchte sie die doppelte Ableitungstabelle
 *      gegen MySQL-Fehler 1093; hier werden die zwei Grenzen vorher gelesen und als Zahl uebergeben.
 *      Damit gibt es kein 1093, kein `NOT IN` ueber tausende Werte und keinen Filesort -- nur zwei
 *      Indexgriffe auf den Primaerschluessel und ein Bereichs-DELETE.
 *   2. Ein Lauf hat einen DECKEL. Ohne ihn raeumt der erste Lauf auf der Livetabelle rund 61.000
 *      Zeilen -- in der Transaktion, in der ein Editor gerade gespeichert hat. Mit Deckel sind es
 *      viele kurze Schritte, die von selbst konvergieren.
 *
 * 💣 `id` ist AUTO_INCREMENT, „juengste N" heisst also „groesste N ids". Das ist der Grund, aus dem
 * hier nach `id` und nicht nach `created_at` geordnet wird: es trifft dieselbe Menge und liegt auf
 * dem Primaerschluessel. `map_audit_log` hat keinen Index auf `created_at`.
 */

/** Die Anzeigehoehe beider Aenderungsfenster. Tiefer darf keine Grenze gehen. */
const AVESMAPS_AUDIT_PRUNE_MIN_KEEP = 200;
/**
 * Wie viele Zeilen JEDE PERSON in jedem Protokoll behaelt -- dieselbe Anzeigehoehe, nur je Person.
 */
const AVESMAPS_AUDIT_KEEP_PER_ACTOR = 200;
/** Reine Unfallbremse gegen einen vertippten Riesenwert. */
const AVESMAPS_AUDIT_PRUNE_MAX_KEEP = 50000;
/** Hoechstens so viele Zeilen je Lauf -- siehe Punkt 2 oben. */
const AVESMAPS_AUDIT_PRUNE_DEFAULT_MAX_DELETE = 500;

/**
 * DIE DREI UNFALLBREMSEN -- absichtlich nebeneinander, weil sich die drei Protokolle EIN
 * Speicherbudget teilen (STRATO gibt der ganzen Datenbank 2 GB; die Karteninhalte selbst sind 23 MB).
 *
 * Sie greifen im Normalbetrieb NIE. Was den Platz bestimmt, ist AVESMAPS_AUDIT_KEEP_PER_ACTOR mal
 * die Zahl der Leute -- und genau die kennt der Code nicht, deshalb gibt es sie ueberhaupt.
 *
 * Die Rechnung, mit den am 18.08.2026 gemessenen Zeilengewichten:
 *   Karte            ~2 KB je Zeile  -> 10.000 Zeilen ~  20 MB, greift ab ~50 aktiven Personen
 *   Landschaften    ~40 KB je Zeile  ->  4.000 Zeilen ~ 160 MB, greift ab ~20 aktiven Personen
 *   Herrschaftsgeb. ~30 KB geschaetzt ->  3.000 Zeilen ~  90 MB, greift ab ~15 aktiven Personen
 * Zusammen also hoechstens rund 270 MB statt der 849 MB, mit denen die Datenbank am 18.08.2026
 * schreibgesperrt war.
 *
 * ⚠️ Das Gewicht der Herrschaftsgebiete ist GESCHAETZT (geometrietragend wie die Landschaften,
 * aber ohne Hoehendaten). Wer es misst, traegt die Zahl hier ein statt sie zu glauben.
 */
const AVESMAPS_MAP_AUDIT_GLOBAL_KEEP_ROWS = 10000;
const AVESMAPS_ECOSYSTEM_AUDIT_GLOBAL_KEEP_ROWS = 4000;
const AVESMAPS_POLITICAL_AUDIT_GLOBAL_KEEP_ROWS = 3000;

/**
 * 💣 Ein Tabellenname kann kein Platzhalter sein, er wird in den SQL-Text interpoliert. Ohne diese
 * Liste waere der Parameter eine Injektionsstelle.
 */
const AVESMAPS_AUDIT_PRUNE_TABLES = [
    'map_audit_log',
    'ecosystem_geometry_audit_log',
    // Die Herrschaftsgebiete behalten ihren eigenen globalen Aufraeumer
    // (avesmapsPoliticalPruneGeometryAuditLog, MySQL-Sonderform gegen Fehler 1093) und nehmen von
    // hier nur die Stufe je Person. Zwei globale Riegel auf derselben Tabelle waeren einer zu viel.
    'political_territory_geometry_audit_log',
];

/**
 * Welche Tabellen `avesmapsPruneAuditLog` ueberhaupt anfassen darf -- die AENDERUNGSprotokolle
 * plus alles, was denselben globalen Deckel braucht, ohne ein Aenderungsprotokoll zu sein.
 *
 * 💣 GETRENNT VON DER LISTE DARUEBER, UND DAS IST DER GANZE PUNKT. Jene traegt die Regel
 * „200 je Person ueber ALLE Protokolle zusammen" (Owner 22.08.2026). Wer hier etwas eintraegt
 * UND dort, laesst es um dasselbe Budget konkurrieren: `map_archive_download` haelt fest, wer
 * ein Kartenarchiv geholt hat -- das ist keine Aenderung, ist nicht rueckgaengig zu machen und
 * darf einem Editor keinen einzigen seiner 200 Aenderungsschritte wegdraengen. Es ist auch
 * nicht der umgekehrte Fall: haette der Trichter der Aenderungen es mitgezaehlt, staende dort
 * wieder eine Zahl, die die Liste darunter nicht haelt -- genau der Befund vom 22.08.
 *
 * ⚠️ Neue Eintraege gehoeren HIER hinein, nicht oben, es sei denn, die Tabelle ist wirklich ein
 * Aenderungsprotokoll mit `actor_user_id` und `created_at`, das im Trichter erscheinen soll.
 */
const AVESMAPS_AUDIT_PRUNE_CAPPABLE_TABLES = [
    ...AVESMAPS_AUDIT_PRUNE_TABLES,
    // Wer welches Kartenarchiv geholt hat (api/_internal/map/kartenarchiv.php).
    'map_archive_download',
];

/**
 * Kappt ein Protokoll auf die juengsten $keepRows Zeilen -- hoechstens $maxDelete je Lauf.
 *
 * @param string $table Muss in AVESMAPS_AUDIT_PRUNE_CAPPABLE_TABLES stehen (die WEITE Liste --
 *                       nicht die engere darueber, die die 200-je-Person traegt).
 * @return int Wie viele Zeilen dieser Lauf geloescht hat (0 = nichts zu tun).
 * @throws InvalidArgumentException bei einer unbekannten Tabelle.
 */
function avesmapsPruneAuditLog(
    PDO $pdo,
    string $table,
    int $keepRows,
    int $maxDelete = AVESMAPS_AUDIT_PRUNE_DEFAULT_MAX_DELETE
): int {
    if (!in_array($table, AVESMAPS_AUDIT_PRUNE_CAPPABLE_TABLES, true)) {
        throw new InvalidArgumentException('Unbekanntes Protokoll: ' . $table);
    }

    $keepRows = max(AVESMAPS_AUDIT_PRUNE_MIN_KEEP, min(AVESMAPS_AUDIT_PRUNE_MAX_KEEP, $keepRows));
    $maxDelete = max(1, $maxDelete);

    // Die id der $keepRows-juengsten Zeile. Alles darunter ist Ueberhang. Gibt es so viele Zeilen
    // gar nicht, liefert OFFSET nichts -- dann ist nichts zu tun.
    $schwelle = $pdo->prepare(
        'SELECT id FROM ' . $table . ' ORDER BY id DESC LIMIT 1 OFFSET :offset'
    );
    $schwelle->bindValue('offset', $keepRows - 1, PDO::PARAM_INT);
    $schwelle->execute();
    $grenze = $schwelle->fetchColumn();
    if ($grenze === false || $grenze === null) {
        return 0;
    }
    $grenze = (int) $grenze;

    // Der Deckel: die id NACH den ersten $maxDelete Zeilen von unten. Gibt es so wenige, bleibt es
    // bei der Schwelle -- dann raeumt der Lauf den ganzen Ueberhang, und der ist klein.
    $deckel = $pdo->prepare(
        'SELECT id FROM ' . $table . ' ORDER BY id ASC LIMIT 1 OFFSET :offset'
    );
    $deckel->bindValue('offset', $maxDelete, PDO::PARAM_INT);
    $deckel->execute();
    $deckelId = $deckel->fetchColumn();
    if ($deckelId !== false && $deckelId !== null) {
        $grenze = min($grenze, (int) $deckelId);
    }

    $delete = $pdo->prepare('DELETE FROM ' . $table . ' WHERE id < :grenze');
    $delete->bindValue('grenze', $grenze, PDO::PARAM_INT);
    $delete->execute();

    return $delete->rowCount();
}

/**
 * Kappt die Zeilen EINER Person auf ihre juengsten $keepRows -- ueber ALLE Protokolle zusammen.
 *
 * 🔴 200 GILT JE PERSON UND INSGESAMT, NICHT JE PROTOKOLL (Owner 22.08.2026: „jeder person darf
 * max. 200 eintraege haben"). Die erste Fassung kappte je Tabelle, und damit stand im Trichter fuer
 * eine Person 486 -- die Summe aus drei Protokollen --, waehrend die Liste darunter 200 zeigte. Eine
 * Zahl, die mehr verspricht als die Liste haelt, war die Frage des Owners in Reinform:
 * „warum steht bei nics 486".
 *
 * Ablauf: zaehlen, wie viele Zeilen die Person insgesamt hat; ist sie darueber, aus JEDEM Protokoll
 * die aeltesten Kandidaten holen, in PHP zusammenfuehren, und genau die aeltesten $ueber loeschen --
 * gleichgueltig, in welcher Tabelle sie liegen.
 *
 * 💣 EIN Durchgang, keine Schleife ueber Einzelzeilen. Drei SELECTs (je hoechstens $maxDelete
 * Zeilen, nur id und Zeitstempel) und hoechstens drei DELETEs. Zeile fuer Zeile die global aelteste
 * zu suchen gaebe dasselbe Ergebnis und rund 1.200 Abfragen fuer einen Rueckstand von 300 -- in der
 * Transaktion, in der jemand gerade gespeichert hat.
 *
 * 💣 `actor_user_id` IST NULLABLE, und `= NULL` trifft nie etwas. Die maschinellen Schreiber
 * (Import-Tuer, WikiSync ohne angemeldete Person, Systemlaeufe) landen alle in EINEM Topf, und der
 * braucht seine eigene Bedingung -- sonst waechst genau dieser Topf ungebremst weiter, waehrend die
 * Menschen sauber gekappt werden. Kein `<=>`: das kennt nur MySQL, und die Tests fahren SQLite.
 *
 * 💣 UND DIESER TOPF HAT ZWEI SCHREIBWEISEN. `avesmapsWriteMapAuditLog` legt bei fehlender Person
 * eine `0` ab, die drei anderen Schreiber ein `NULL` -- in derselben Spalte derselben Tabelle. Wer
 * nur auf `IS NULL` prueft, laesst die Haelfte der maschinellen Zeilen ungekappt liegen, und zwar
 * unbemerkt: die Tabelle waechst, alle Zusicherungen bleiben gruen.
 *
 * ⚠️ Ein Protokoll, dessen Tabelle es (noch) nicht gibt, zaehlt als LEER statt zu werfen. Die drei
 * Tabellen entstehen an verschiedenen Stellen per DDL, und ein Schreibvorgang der Karte darf nicht
 * daran scheitern, dass die Landschaften-Ebene in dieser Installation nie benutzt wurde. Der Fang
 * ist bewusst eng (nur PDOException) und darf NICHT ausgeweitet werden -- ein geschluckter
 * SQL-Fehler saehe hier aus wie „nichts zu tun".
 *
 * @param int|null $actorUserId `null` oder 0 = der Topf der maschinellen Schreiber.
 * @return int Wie viele Zeilen dieser Lauf geloescht hat (0 = nichts zu tun).
 */
function avesmapsPruneActorAcrossAuditLogs(
    PDO $pdo,
    ?int $actorUserId,
    int $keepRows = AVESMAPS_AUDIT_KEEP_PER_ACTOR,
    int $maxDelete = AVESMAPS_AUDIT_PRUNE_DEFAULT_MAX_DELETE
): int {
    $keepRows = max(AVESMAPS_AUDIT_PRUNE_MIN_KEEP, min(AVESMAPS_AUDIT_PRUNE_MAX_KEEP, $keepRows));
    $maxDelete = max(1, $maxDelete);

    $istMensch = $actorUserId !== null && $actorUserId > 0;
    $wo = $istMensch ? 'actor_user_id = :actor' : '(actor_user_id IS NULL OR actor_user_id = 0)';
    $binden = static function (PDOStatement $statement) use ($istMensch, $actorUserId): void {
        if ($istMensch) {
            $statement->bindValue('actor', (int) $actorUserId, PDO::PARAM_INT);
        }
    };

    $gesamt = 0;
    $bestand = [];
    foreach (AVESMAPS_AUDIT_PRUNE_TABLES as $table) {
        try {
            $zaehler = $pdo->prepare('SELECT COUNT(*) FROM ' . $table . ' WHERE ' . $wo);
            $binden($zaehler);
            $zaehler->execute();
            $anzahl = (int) $zaehler->fetchColumn();
        } catch (PDOException) {
            continue; // Tabelle gibt es hier nicht -- siehe die Begruendung oben.
        }
        if ($anzahl > 0) {
            $bestand[$table] = $anzahl;
            $gesamt += $anzahl;
        }
    }

    $ueber = $gesamt - $keepRows;
    if ($ueber < 1) {
        return 0;
    }
    $ueber = min($ueber, $maxDelete);

    // Aus jedem Protokoll die aeltesten Kandidaten. Mehr als $ueber je Tabelle kann nie gebraucht
    // werden -- selbst wenn alle zu loeschenden Zeilen in einer einzigen liegen.
    $kandidaten = [];
    foreach (array_keys($bestand) as $table) {
        try {
            $lese = $pdo->prepare(
                'SELECT id, created_at FROM ' . $table . ' WHERE ' . $wo
                . ' ORDER BY created_at ASC, id ASC LIMIT :grenze'
            );
            $binden($lese);
            $lese->bindValue('grenze', $ueber, PDO::PARAM_INT);
            $lese->execute();
        } catch (PDOException) {
            continue;
        }
        foreach ($lese->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
            $kandidaten[] = [
                'table' => $table,
                'id' => (int) $zeile['id'],
                'created_at' => (string) ($zeile['created_at'] ?? ''),
            ];
        }
    }

    // ⚠️ Sortiert wird nach ZEIT, nicht nach id: die ids sind je Tabelle eigene Zaehler und quer
    // ueber die drei voellig unvergleichbar. Tabellenname und id sind nur Stichentscheid, damit die
    // Reihenfolge bei gleicher Zeit ueberhaupt festliegt.
    usort($kandidaten, static function (array $links, array $rechts): int {
        return [$links['created_at'], $links['table'], $links['id']]
            <=> [$rechts['created_at'], $rechts['table'], $rechts['id']];
    });

    $zuLoeschen = [];
    foreach (array_slice($kandidaten, 0, $ueber) as $eintrag) {
        $zuLoeschen[$eintrag['table']][] = $eintrag['id'];
    }

    $geloescht = 0;
    foreach ($zuLoeschen as $table => $ids) {
        $platzhalter = [];
        $parameter = [];
        foreach (array_values($ids) as $position => $id) {
            $platzhalter[] = ':i' . $position;
            $parameter['i' . $position] = $id;
        }
        $delete = $pdo->prepare(
            'DELETE FROM ' . $table . ' WHERE id IN (' . implode(', ', $platzhalter) . ')'
        );
        $delete->execute($parameter);
        $geloescht += $delete->rowCount();
    }

    return $geloescht;
}
