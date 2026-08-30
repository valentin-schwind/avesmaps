<?php

declare(strict_types=1);

// Der Vorschlag "Wiki-Landschaft" fuer die Einzelansicht des Garetien Importers -- Owner
// 30.08.2026: "Wiki-Landschaft (versuch automatisch nach Namen + Typ zu suchen und zuzuweisen.
// wenn name und typ passen, passts, wenn name passt aber typ nicht gefunden -> ausrufezeichen)".
//
// 🔴 EIN AUFRUF JE GEOEFFNETER ZEILE, KEIN MASSENLAUF. Diese Funktion wird von der Einzelansicht
// bei Bedarf gerufen (Aktion 'wiki_landschaft' an garetien-import.php) -- niemals ueber die ganze
// Arbeitsliste geloopt. Ein Lauf ueber ~100 Objekte waere genau die Art von Endpunkt-Schleife,
// vor der CLAUDE.md warnt (STRATO-PHP-Worker).
//
// 🔴 REIN LESEND, KEINE ZWEITE ART-REGEL. Der Namensvergleich faltet mit derselben Tabelle wie
// der Rest des Hauses (avesmapsWikiSyncCreateMatchKey, api/_internal/wiki/sync.php) und die
// Art-Zuordnung ist dieselbe Synonymtabelle, die auch der Wiki-Override der Landschaft benutzt
// (avesmapsWikiRegionArtToSubtype, api/_internal/wiki/regions.php) -- keine Abschrift im Browser.
//
// ⚠️ KEIN `avesmapsWikiRegionEnsureTables()` hier: seine DDL ist MySQL-Syntax
// (AUTO_INCREMENT/ENGINE=InnoDB/JSON) und bricht unter der SQLite-Pruefstandsform dieses Hauses.
// Fehlt die Tabelle (frische Installation, noch nie ein Regionen-Sync gelaufen), faengt der
// try/catch das ab und liefert "kein_treffer" -- dieselbe zurueckhaltende Richtung wie
// avesmapsGaretienQuellenBestand (garetien-plan.php): ein Ausfall hier behauptet nichts, er
// schweigt.

require_once __DIR__ . '/../wiki/sync.php';
require_once __DIR__ . '/../wiki/regions.php';

/**
 * @return array{status:string, name:string, art:string}
 *   status: 'passt' (Name UND Art passen) | 'warnung' (Name passt, Art nicht) |
 *           'mehrdeutig' (mehr als ein Namensgleichstand) | 'kein_treffer'
 */
function avesmapsGaretienWikiLandschaftVorschlag(PDO $pdo, string $name, string $subtyp): array
{
    $leer = ['status' => 'kein_treffer', 'name' => '', 'art' => ''];
    $name = trim($name);
    if ($name === '') {
        return $leer;
    }
    $matchKey = avesmapsWikiSyncCreateMatchKey($name);
    if ($matchKey === '') {
        return $leer;
    }

    try {
        $statement = $pdo->prepare(
            'SELECT name, art FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE match_key = :k LIMIT 2'
        );
        $statement->execute(['k' => $matchKey]);
        $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return $leer;
    }

    if ($zeilen === []) {
        return $leer;
    }
    // 💣 Mehr als EIN Namensgleichstand ist keine sichere Zuordnung -- welchen meint der Editor?
    // Im Zweifel nichts behaupten, dieselbe Richtung wie beim Wiki-Override (AGENTS.md §11).
    if (count($zeilen) > 1) {
        return ['status' => 'mehrdeutig', 'name' => '', 'art' => ''];
    }

    $art = (string) ($zeilen[0]['art'] ?? '');
    $gefundenerSubtyp = avesmapsWikiRegionArtToSubtype($art);

    return [
        'status' => ($gefundenerSubtyp !== '' && $gefundenerSubtyp === $subtyp) ? 'passt' : 'warnung',
        'name' => (string) ($zeilen[0]['name'] ?? ''),
        'art' => $art,
    ];
}
