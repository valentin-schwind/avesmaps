<?php

declare(strict_types=1);

// Aufraeumen nach einem Fehlimport -- die feature_sources-VERKNUEPFUNGEN mit
// origin='garetien' wieder entfernen. Owner 30.08.2026, woertlich: "entferne die
// quellen, sonst stehen sie irgendwann noch doppelt drin, weil du nix checkst".
//
// Hintergrund: der Schadensfall vom 30.08.2026 (Aufgabe 21 -- "apply" hat aus rund 100
// angezeigten Objekten 3007 uebernommene Zeilen gemacht) hat unter anderem an 312
// bestehenden Kartenobjekten eine Quellenangabe hinterlassen, die niemand wollte -- 372
// Verknuepfungen, jede mit `felder: ['quelle']` (nur die Quelle, kein Name, keine
// Geometrie war betroffen). Diese Datei repariert GENAU DAS und nichts sonst.
//
// 🔴 NUR DIE VERKNUEPFUNGEN, NIEMALS `sources` SELBST. `sources` ist ein geteilter
// KATALOG (AGENTS.md §5: "Sources live in ONE place") -- dieselbe Adresse kann von
// anderen Objekten und anderen Erzeugern zitiert werden. Wer dort loescht, reisst
// fremde Zitate mit. Diese Datei fasst die Tabelle `sources` deshalb nirgends an.
//
// ⚠️ `origin = 'garetien'` ist das EINZIGE zuverlaessige Merkmal -- nicht die Adresse
// und nicht der Titel: der Katalog kann dieselbe URL aus anderer Herkunft tragen. Die
// Loeschung filtert deshalb ausschliesslich ueber `origin`, nie ueber einen ID-Raum
// oder eine Objektliste (siehe die Messung unten: die Verknuepfung einer Landschaft
// haengt an ihrer BESCHRIFTUNG, nicht an der Region -- ein Filter ueber "welche Objekte
// hat der Import angelegt" wuerde genau diese Zeilen verfehlen).
//
// 🔴 KEIN LOESCHWEG FUER KARTENOBJEKTE. Diese Datei ruehrt an keiner map_features-,
// ecosystem_region- oder ecosystem_area-Zeile. Das Verbot aus dem Auftrag §5.5 ("kein
// Loeschweg, auch nicht fuers Aufraeumen") galt den angelegten OBJEKTEN -- eine andere
// Frage als die hier: repariert wird eine QUELLENANGABE, die ein fehlgeschlagener Lauf
// an bestehenden, schon VOR dem Import vorhandenen Objekten hinterlassen hat
// (change_type='changed', felder=['quelle'], siehe avesmapsGaretienErgaenzungAnwenden
// in garetien-uebernahme.php). Kein neu angelegtes Objekt wird durch diese Datei je
// beruehrt oder entfernt.
//
// 🔴 Reuse statt zweiter Wahrheit: der Origin-Wert kommt aus
// AVESMAPS_GARETIEN_SOURCE_ORIGIN (garetien-uebernahme.php) -- keine zweite Konstante
// mit demselben Literal in dieser Datei.
require_once __DIR__ . '/garetien-uebernahme.php';

/**
 * Wie viele Verknuepfungen betroffen sind -- VOR jeder Loeschung, fuer die Rueckfrage
 * im Fenster ("372 Verknuepfungen an 312 Objekten").
 *
 * `nach_typ` dient NUR dem Bericht ("in welchen entity_type/ID-Raeumen lagen die Zeilen
 * wirklich") -- die Loeschung selbst unterscheidet nicht danach, siehe
 * avesmapsGaretienQuellenAbbauAusfuehren.
 *
 * @return array{verknuepfungen:int, objekte:int, nach_typ:array<string,int>}
 */
function avesmapsGaretienQuellenAbbauZaehlen(PDO $pdo): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    $anzahl = $pdo->prepare('SELECT COUNT(*) FROM feature_sources WHERE origin = :o');
    $anzahl->execute(['o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);
    $verknuepfungen = (int) $anzahl->fetchColumn();

    // 💣 PORTABEL BLEIBEN: weder CONCAT(...) (kennt aeltere SQLite nicht) noch `||`
    // (bedeutet in MySQL standardmaessig ODER, nicht Verkettung) -- distinct wird
    // stattdessen ueber eine Ableitungstabelle gezaehlt, das laeuft auf beiden Treibern
    // unveraendert.
    $objekte = $pdo->prepare(
        'SELECT COUNT(*) FROM (
            SELECT DISTINCT entity_type, entity_public_id
              FROM feature_sources WHERE origin = :o
        ) AS abbau_distinct'
    );
    $objekte->execute(['o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);

    $nachTyp = $pdo->prepare(
        'SELECT entity_type, COUNT(*) AS n FROM feature_sources WHERE origin = :o GROUP BY entity_type'
    );
    $nachTyp->execute(['o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);
    $typen = [];
    foreach ($nachTyp->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $typen[(string) $zeile['entity_type']] = (int) $zeile['n'];
    }

    return [
        'verknuepfungen' => $verknuepfungen,
        'objekte' => (int) $objekte->fetchColumn(),
        'nach_typ' => $typen,
    ];
}

/**
 * Die Verknuepfungen wirklich entfernen -- NUR feature_sources, NIE sources.
 *
 * 💣 Ein hartes DELETE, kein Grabstein: `avesmapsRemoveFeatureSource` legt einen
 * Grabstein (`status = 'suppressed'`) NUR fuer `origin = 'wiki_publication'` an, weil
 * ein spaeterer WikiSync-Abgleich eine geloeschte Zeile sonst wieder anlegen wuerde.
 * `'garetien'` hat keinen solchen Abgleich mehr (Stufe 1 legt nur an, aendert nichts
 * Vorhandenes ausser ueber die hier bereinigte Ergaenzung) -- die Zeile darf wirklich
 * weg, wie jede manuelle Verknuepfung.
 *
 * ⚠️ Gezaehlt wird die ECHTE Trefferzahl von DELETE (`rowCount()`), nie ein vorher
 * gelesener Wert erneut zurueckgegeben -- sonst koennte eine Abweichung (ein zweiter
 * Aufruf waehrend eine andere Sitzung schon geloescht hat) unbemerkt bleiben.
 *
 * @return array{entfernt:int}
 */
function avesmapsGaretienQuellenAbbauAusfuehren(PDO $pdo): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    $stmt = $pdo->prepare('DELETE FROM feature_sources WHERE origin = :o');
    $stmt->execute(['o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);
    $entfernt = $stmt->rowCount();

    if ($entfernt > 0) {
        // Dieselbe Cache-Invalidierung wie jeder andere Schreibvorgang an feature_sources
        // (avesmapsRemoveFeatureSource): die Karte liefert Quellen SYNCHRON in der
        // Nutzlast mit (AGENTS.md §5), ein warmer Client saehe sonst weiter die
        // geloeschte Angabe.
        avesmapsNextMapRevision($pdo);
    }

    return ['entfernt' => $entfernt];
}
