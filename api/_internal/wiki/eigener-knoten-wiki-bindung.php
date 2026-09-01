<?php

declare(strict_types=1);

/**
 * Einen EIGENEN Knoten (`eigener-knoten:knotenNNN`) nachtraeglich an einen Wiki-Artikel binden.
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
 *
 * 🔴 DER WIKI-KNOTEN GEWINNT (Owner 02.09.2026, zweimal so entschieden). Die Zielzeile ist das
 * Gebiet mit dem Wiki-Schluessel -- sie wird angelegt, wenn es sie noch nicht gibt. Die eigene
 * Zeile wandert danach in den Papierkorb (`is_active = 0`, weich und umkehrbar). Damit WECHSELT
 * die public_id, und genau deshalb muessen die Ziele aus dem Entwurf §4 mitwandern.
 *
 * 💣 DIE WANDERUNG GEHT DURCH GENAU EINE FUNKTION -- avesmapsEigenerKnotenBindungAnwenden.
 * Die Ziele je an ihrer eigenen Aufrufstelle zu erledigen ist die Bauform, die dieses Haus schon
 * dreimal bezahlt hat (Verkehrsmittel-Sperre 14.08.2026, Ausstiegsregel 15.08.2026,
 * Ketten-Deaktivierung 16.08.2026). Hier steht bewusst KEINE ZAHL: eine Zahl liest sich wie eine
 * vollstaendige Liste, und niemand zaehlt nach. Die Liste steht im Entwurf und wird von
 * __tests__/eigener-knoten-wiki-bindung-ziele-test.php gegen diesen Code gehalten.
 */

require_once __DIR__ . '/../political/territory.php';

/**
 * REIN: die Uebernahme-Vorschau je Feld.
 *
 * 🔴 Die drei Zustaende und ihre Vorbelegung sind die Hausregel des Wiki-Overrides (17.08.2026),
 * angewandt auf den Sonderfall "bei einem eigenen Knoten ist JEDES Feld ein Override":
 *   gleich      -> vorangehakt, der Override faellt weg, das Feld ist kuenftig Wiki-gepflegt
 *   abweichend  -> NICHT vorangehakt, bleibt "von uns"
 *   luecke      -> vorangehakt, das Wiki fuellt
 * Ohne die erste Zeile kaeme aus dem Wiki nie etwas an.
 *
 * ⚠️ Beidseitig leere Felder fallen heraus -- sie tragen keine Entscheidung.
 */
function avesmapsEigenerKnotenBindungVorschau(array $overrides, array $wikiRow): array
{
    $zeilen = [];
    foreach (avesmapsWikiSyncMonitorEditableFields() as $feld => $label) {
        $eigen = trim((string) ($overrides[$feld] ?? ''));
        $wiki = trim((string) ($wikiRow[$feld] ?? ''));
        if ($eigen === '' && $wiki === '') {
            continue;
        }
        if ($eigen === $wiki) {
            $zustand = 'gleich';
        } elseif ($eigen === '') {
            $zustand = 'luecke';
        } else {
            $zustand = 'abweichend';
        }
        $zeilen[] = [
            'field' => $feld,
            'label' => $label,
            'own' => $eigen,
            'wiki' => $wiki,
            'state' => $zustand,
            'default_checked' => $zustand !== 'abweichend',
        ];
    }

    return $zeilen;
}

/**
 * Gibt den Slug der Papierkorb-Zeile frei, damit die Zielzeile den sauberen bekommt.
 *
 * 💣 `uq_political_territory_slug` gilt ueber ALLE Zeilen. avesmapsPoliticalSlugExists
 * (territory.php:785) fragt `SELECT COUNT(*) ... WHERE slug = :slug` -- OHNE is_active. Eine
 * deaktivierte Zeile blockiert ihren Slug also weiter, und avesmapsPoliticalUniqueSlug haengte
 * dem Ueberlebenden ein "-2" an, waehrend der weggeworfene Platzhalter den sauberen Namen behielte.
 *
 * ⚠️ Die id im Suffix, nicht ein Zaehler: sie ist schon eindeutig, und eine Zaehlschleife koennte
 * bei mehrfach ersetzten Knoten kollidieren.
 */
function avesmapsEigenerKnotenBindungSlugFreigeben(PDO $pdo, int $alteId, string $alterSlug): string
{
    $neu = mb_substr($alterSlug . '-ersetzt-' . $alteId, 0, 180);
    $pdo->prepare('UPDATE political_territory SET slug = :s WHERE id = :id')
        ->execute(['s' => $neu, 'id' => $alteId]);

    return $neu;
}

/**
 * Die Zielzeile: die id des Gebiets mit $zielKey. Fehlt sie, wird sie angelegt.
 *
 * 🔴 IM NORMALFALL FEHLT SIE, und das ist kein Sonderfall. avesmapsWikiDumpPersistTerritoryRecords
 * (dump-entity-scan.php:1652) schreibt ausschliesslich political_territory_wiki_test und
 * wiki_redirect_alias -- niemals political_territory. Ein Dump-Lauf legt einen Staging-Datensatz an
 * und sonst nichts. Beide Faelle laufen deshalb durch DIESE Funktion; ein zweiter Pfad waere genau
 * die Divergenz, die dieser Umbau beseitigt.
 *
 * ⚠️ Nur aktive Zeilen zaehlen als vorhanden: eine im Papierkorb liegende Zeile mit demselben
 * Schluessel soll die Bindung nicht blockieren.
 */
function avesmapsEigenerKnotenBindungZielzeile(PDO $pdo, string $zielKey, array $werte): int
{
    $vorhanden = $pdo->prepare(
        'SELECT id FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1'
    );
    $vorhanden->execute(['k' => $zielKey]);
    $id = $vorhanden->fetchColumn();
    if ($id !== false) {
        return (int) $id;
    }

    $name = trim((string) ($werte['name'] ?? ''));
    if ($name === '') {
        throw new RuntimeException('Die Zielzeile braucht einen Namen.');
    }
    $type = trim((string) ($werte['type'] ?? '')) !== '' ? trim((string) $werte['type']) : 'Herrschaftsgebiet';
    $continent = trim((string) ($werte['continent'] ?? ''));
    if ($continent === '') {
        $continent = AVESMAPS_POLITICAL_DEFAULT_CONTINENT;
    }
    $zoom = avesmapsPoliticalDefaultZoomRange($type);

    $pdo->prepare(
        'INSERT INTO political_territory (
            public_id, wiki_id, wiki_key, slug, name, type, continent, status, color, opacity,
            coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, min_zoom, max_zoom,
            parent_id, is_active, editor_notes, sort_order
        ) VALUES (
            :public_id, NULL, :wiki_key, :slug, :name, :type, :continent, :status, :color, 0.5,
            :coat, :wiki_url, :valid_from, :valid_to, :min_zoom, :max_zoom,
            NULL, 1, :notes, :sort_order
        )'
    )->execute([
        'public_id' => avesmapsPoliticalUuidV4(),
        'wiki_key' => $zielKey,
        'slug' => avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name)),
        'name' => $name,
        'type' => $type,
        'continent' => $continent,
        'status' => avesmapsPoliticalNullableString(trim((string) ($werte['status'] ?? ''))),
        'color' => avesmapsPoliticalColorFromText($name),
        'coat' => avesmapsPoliticalNullableString(trim((string) ($werte['coat_of_arms_url'] ?? ''))),
        'wiki_url' => avesmapsPoliticalNullableString(trim((string) ($werte['wiki_url'] ?? ''))),
        'valid_from' => $werte['valid_from_bf'] ?? null,
        'valid_to' => $werte['valid_to_bf'] ?? null,
        'min_zoom' => $zoom['min_zoom'],
        'max_zoom' => $zoom['max_zoom'],
        'notes' => 'Aus einem eigenen Knoten gebunden: ' . $zielKey,
        'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
    ]);

    return (int) $pdo->lastInsertId();
}
