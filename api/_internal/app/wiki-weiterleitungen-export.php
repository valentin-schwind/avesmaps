<?php

declare(strict_types=1);

// Die Wiki-Weiterleitungen als Export -- Bibliothek zu GET /api/app/wiki-redirects-export.php (Legacy-Export
// E1++, Auftrag Avesmaps3D 04.10.2026: „Zweitnamen A").
//
// Die Tabelle `wiki_redirect_alias` haelt je Weiterleitungstitel der Wiki Aventurica (als Slug) den Schluessel des
// Artikels, auf den sie zeigt („mittelreich" -> „wiki:heiliges-neues-kaiserreich-…"). Legacy fuellt sie beim
// Wiki-Abgleich (avesmapsWikiSyncMonitorStoreAlias) und loest selbst darueber auf
// (avesmapsGameLiteratureResolveRedirect). Avesmaps3D nimmt sie als Quelle der Namensaufloesung im Infopanel, statt
// eine eigene Aliastafel zu fuehren.
//
// 🔴 Genau zwei Felder je Zeile: `alias_slug` und `canonical_wiki_key`. `updated_at` bleibt draussen (der Auftrag
// braucht es nicht; es wandert nur in den Stand). Personenspalten hat die Tabelle keine.
// 🔴 Nur lesen, kein DDL: die Tabelle legt der Sync-Monitor an (avesmapsWikiSyncMonitorEnsureTables). Fehlt sie,
// ist das ein 500 -- kein stilles „es gibt keine Weiterleitungen".

require_once __DIR__ . '/export-rahmen.php';

const AVESMAPS_WIKI_WEITERLEITUNGEN_EXPORT_FELDER = ['alias_slug', 'canonical_wiki_key'];

/**
 * @param callable|null $lesen nur fuer Tests
 */
function avesmapsWikiWeiterleitungenExportLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static function () use ($pdo): array {
        $zeilen = [];
        $statement = $pdo->query(
            'SELECT alias_slug, canonical_wiki_key FROM wiki_redirect_alias ORDER BY alias_slug ASC'
        );
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
            $zeilen[] = avesmapsExportProjektion([
                'alias_slug' => (string) $zeile['alias_slug'],
                'canonical_wiki_key' => (string) $zeile['canonical_wiki_key'],
            ], AVESMAPS_WIKI_WEITERLEITUNGEN_EXPORT_FELDER);
        }

        return $zeilen;
    };
    // Die Tabelle hat keine Zahlenkennung -- der Schluessel ist der Slug, und `updated_at` steigt bei jeder
    // Aenderung (ON UPDATE). Das TRUNCATE des Sync-Monitors faellt ueber die Zahl auf.
    $ergebnis = avesmapsExportStabilLesen(
        static fn (): string => avesmapsExportTabellenFingerabdruck($pdo, [['wiki_redirect_alias', 'updated_at', 'alias_slug']]),
        $lesen
    );

    return [
        'ok' => true,
        'redirects_revision' => avesmapsExportStempel('redir', (string) $ergebnis['stand']),
        'count' => count($ergebnis['daten']),
        'redirects' => $ergebnis['daten'],
    ];
}
