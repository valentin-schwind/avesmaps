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
 * @return array{status:string, name:string, art:string, wiki_key:string}
 *   status: 'passt' (Name UND Art passen) | 'warnung' (Name passt, Art nicht) |
 *           'mehrdeutig' (mehr als ein Namensgleichstand) | 'kein_treffer'
 *   wiki_key: der Schluessel des Treffers -- NUR bei 'passt'/'warnung' gefuellt, sonst ''
 *   (Owner-Entscheid 30.08.2026: "du brauchst du den key zuweisen" -- avesmapsGaretienWikiLandschaftZuweisung
 *   unten braucht genau dieses Feld, um denselben Treffer als Zuweisungsobjekt zu bauen).
 */
function avesmapsGaretienWikiLandschaftVorschlag(PDO $pdo, string $name, string $subtyp): array
{
    $leer = ['status' => 'kein_treffer', 'name' => '', 'art' => '', 'wiki_key' => ''];
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
            'SELECT wiki_key, name, art FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE match_key = :k LIMIT 2'
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
    // ⚠️ UND KEIN GERATENER SCHLUESSEL: ein mehrdeutiger Treffer darf keinen wiki_key liefern,
    // sonst wuerde avesmapsGaretienWikiLandschaftZuweisung darunter genau die Zeile zuweisen, vor
    // der dieser Zweig warnt.
    if (count($zeilen) > 1) {
        return ['status' => 'mehrdeutig', 'name' => '', 'art' => '', 'wiki_key' => ''];
    }

    $art = (string) ($zeilen[0]['art'] ?? '');
    $gefundenerSubtyp = avesmapsWikiRegionArtToSubtype($art);

    return [
        'status' => ($gefundenerSubtyp !== '' && $gefundenerSubtyp === $subtyp) ? 'passt' : 'warnung',
        'name' => (string) ($zeilen[0]['name'] ?? ''),
        'art' => $art,
        'wiki_key' => (string) ($zeilen[0]['wiki_key'] ?? ''),
    ];
}

/**
 * Der Treffer aus avesmapsGaretienWikiLandschaftVorschlag() als ZUWEISUNGSOBJEKT fuer
 * `properties.wiki_region` (AGENTS.md §11, "Die Listenzeile": "Gemessen wird immer das
 * ZUWEISUNGSfeld, nie das danebenstehende wiki_url" -- gemeint ist hier `wiki_region.wiki_key`,
 * nicht ein freier `wiki_url`-Text).
 *
 * Owner-Entscheid 30.08.2026, woertlich: "das wiki braucht nicht gewinnen du brauchst du den key
 * zuweisen, der name wird derselbe sein, der typ vermeintlich auch und wenn nicht sieht der
 * editor ja, dass der typ anders is, unser system zeigt das dann an ... des geht nur um die
 * zuweisung". Zugewiesen wird deshalb NUR der Schluessel (ueber das volle Zuweisungsobjekt, wie
 * es auch avesmapsWikiRegionAssign an ein Label heftet) -- Name und Art des angelegten Objekts
 * kommen weiterhin aus dem Import und werden hier nicht beruehrt.
 *
 * 🔴 ZUGEWIESEN WIRD BEI 'passt' UND BEI 'warnung' -- ein abweichender Typ ist SICHTBAR (das
 * Ausrufezeichen im Kasten "Eingefuegt wird") und im Editor jederzeit ueber die Wiki-Override-
 * Anzeige zuruecknehmbar; das ist kein Grund, die Zuweisung selbst zu verweigern. Nur
 * 'mehrdeutig' und 'kein_treffer' liefern NULL -- ein geratener Schluessel waere schlimmer als
 * keiner, er verbaende zwei Objekte, die nichts miteinander zu tun haben.
 *
 * ⭐ BAUT DAS OBJEKT MIT avesmapsWikiRegionBuildAssignObject() (api/_internal/wiki/regions.php) --
 * derselben Funktion, die auch der normale Wiki-Region-Abgleich benutzt ("gleiche Form wie der
 * Label-Editor-Picker speichert"). Keine zweite, abgespeckte Form desselben Datensatzes.
 *
 * @return ?array Das Zuweisungsobjekt fuer 'wiki_region', oder NULL ohne sichere Zuordnung.
 */
function avesmapsGaretienWikiLandschaftZuweisung(PDO $pdo, string $name, string $subtyp): ?array
{
    $vorschlag = avesmapsGaretienWikiLandschaftVorschlag($pdo, $name, $subtyp);
    $wikiKey = trim((string) ($vorschlag['wiki_key'] ?? ''));
    if ($wikiKey === '' || !in_array($vorschlag['status'], ['passt', 'warnung'], true)) {
        return null;
    }

    try {
        $statement = $pdo->prepare(
            'SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1'
        );
        $statement->execute(['k' => $wikiKey]);
        $zeile = $statement->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return null;
    }
    if ($zeile === false) {
        return null;
    }

    return avesmapsWikiRegionBuildAssignObject($zeile);
}
