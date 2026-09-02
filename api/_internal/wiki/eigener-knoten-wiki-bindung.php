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
// avesmapsPoliticalWriteGeometryAuditLog -- die EINE Protokollzeile am Ende der Uebernahme.
require_once __DIR__ . '/../political/territories-audit.php';
// avesmapsWikiNamespaceIsOfficial / ...FromWikiUrl -- das Kanon-Etikett der Trefferliste.
require_once __DIR__ . '/namespaces.php';

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
function avesmapsEigenerKnotenBindungZielzeile(PDO $pdo, string $zielKey, array $werte, ?array $alteZeile = null): int
{
    $vorhanden = $pdo->prepare(
        'SELECT id FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1'
    );
    $vorhanden->execute(['k' => $zielKey]);
    $id = $vorhanden->fetchColumn();
    if ($id !== false) {
        return (int) $id;
    }

    // 🔴 DIE NEUE ZEILE IST EINE KOPIE DER ALTEN, nicht ein frischer Knoten aus Wiki-Werten.
    // 💣 Ohne das ist „ungehakt" nicht „bleibt von uns", sondern „verschwindet" -- das GEGENTEIL
    // dessen, was die Uebernahme-Vorschau zusagt. Gemessen an der Szenarienprobe vom 02.09.2026:
    // parent_id, status, coat_of_arms_url, capital_place_id, color, opacity und die Zoomstufen
    // gingen samt und sonders verloren, der Knoten wurde zur Wurzel und wechselte auf der Karte
    // die Farbe. Die Wiki-Werte kommen DARUEBER (nur die angehakten), nicht darunter.
    // ⚠️ Farbe, Deckkraft, Zoomstufen, Verknuepfungen und der Elternteil haben im Wiki gar kein
    // Gegenstueck -- fuer sie gibt es nichts zu entscheiden, sie wandern immer mit.
    $alt = is_array($alteZeile) ? $alteZeile : [];
    $ausAlt = static function (string $spalte, $ersatz = null) use ($alt) {
        $wert = $alt[$spalte] ?? null;
        return ($wert === null || $wert === '') ? $ersatz : $wert;
    };

    $name = trim((string) ($werte['name'] ?? ''));
    if ($name === '') {
        throw new RuntimeException('Die Zielzeile braucht einen Namen.');
    }
    $type = trim((string) ($werte['type'] ?? '')) !== ''
        ? trim((string) $werte['type'])
        : (string) $ausAlt('type', 'Herrschaftsgebiet');
    $continent = trim((string) ($werte['continent'] ?? ''));
    if ($continent === '') {
        $continent = (string) $ausAlt('continent', AVESMAPS_POLITICAL_DEFAULT_CONTINENT);
    }
    $zoom = avesmapsPoliticalDefaultZoomRange($type);
    // Ein von Hand gesetztes Zoomband ueberlebt: es beschreibt, wo das Gebiet auf der KARTE
    // erscheint, und das Wiki sagt dazu nichts.
    $minZoom = $ausAlt('min_zoom', $zoom['min_zoom']);
    $maxZoom = $ausAlt('max_zoom', $zoom['max_zoom']);
    $notiz = trim((string) $ausAlt('editor_notes', ''));
    $notiz = ($notiz === '' ? '' : $notiz . ' · ') . 'Aus einem eigenen Knoten gebunden: ' . $zielKey;

    $pdo->prepare(
        'INSERT INTO political_territory (
            public_id, wiki_id, wiki_key, slug, name, short_name, type, continent, status, color, opacity,
            coat_of_arms_url, wiki_url, capital_place_id, seat_place_id,
            valid_from_bf, valid_to_bf, valid_label, min_zoom, max_zoom,
            parent_id, is_active, editor_notes, sort_order
        ) VALUES (
            :public_id, NULL, :wiki_key, :slug, :name, :short_name, :type, :continent, :status, :color, :opacity,
            :coat, :wiki_url, :capital, :seat,
            :valid_from, :valid_to, :valid_label, :min_zoom, :max_zoom,
            :parent_id, 1, :notes, :sort_order
        )'
    )->execute([
        'public_id' => avesmapsPoliticalUuidV4(),
        'wiki_key' => $zielKey,
        'slug' => avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name)),
        'name' => $name,
        'short_name' => $ausAlt('short_name'),
        'type' => $type,
        'continent' => $continent,
        // 🔴 Ein LEERER Wiki-Wert loescht den Hand-Wert nicht -- er ist keine Aussage.
        'status' => avesmapsPoliticalNullableString(trim((string) ($werte['status'] ?? '')))
            ?? $ausAlt('status'),
        'color' => $ausAlt('color', avesmapsPoliticalColorFromText($name)),
        'opacity' => $ausAlt('opacity', 0.5),
        'coat' => avesmapsPoliticalNullableString(trim((string) ($werte['coat_of_arms_url'] ?? '')))
            ?? $ausAlt('coat_of_arms_url'),
        'wiki_url' => avesmapsPoliticalNullableString(trim((string) ($werte['wiki_url'] ?? ''))),
        // ⚠️ Die zwei Verknuepfungen sind IDs auf map_features -- das Wiki kennt nur Namen. Sie
        // wandern immer mit; ginge die Hauptstadt-Verknuepfung verloren, zeigte die Infobox
        // stillschweigend keine Hauptstadt mehr.
        'capital' => $ausAlt('capital_place_id'),
        'seat' => $ausAlt('seat_place_id'),
        'valid_from' => $werte['valid_from_bf'] ?? $ausAlt('valid_from_bf'),
        'valid_to' => $werte['valid_to_bf'] ?? $ausAlt('valid_to_bf'),
        'valid_label' => $ausAlt('valid_label'),
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        // 🔴 DER ELTERNTEIL WANDERT MIT. Ohne ihn wird der gebundene Knoten zur WURZEL, und die
        // abgeleiteten Aussengrenzen aller Vorfahren verlieren ihn stillschweigend.
        'parent_id' => $ausAlt('parent_id'),
        'notes' => mb_substr($notiz, 0, 2000, 'UTF-8'),
        'sort_order' => $ausAlt('sort_order', avesmapsPoliticalNextSortOrder($pdo)),
    ]);

    return (int) $pdo->lastInsertId();
}

/**
 * Die LUECKEN der Zielzeile aus der alten fuellen -- nie ueberschreiben.
 *
 * 🔴 Fuer den Fall, dass die Zielzeile SCHON EXISTIERTE (der Wiki-Knoten war bereits uebernommen).
 * Dann gewinnt sie mit ihren eigenen Werten -- „der Wiki-Knoten gewinnt" (Owner) --, aber was sie
 * gar nicht hat, darf nicht verloren gehen: das hochgeladene Wappen, die Hauptstadt-Verknuepfung,
 * ein von Hand gesetztes Zoomband, der Elternteil.
 * ⚠️ NUR echte Luecken (NULL oder ''), damit dieser Schritt nie eine gepflegte Angabe ueberschreibt.
 *
 * 🪤 ER UEBERLAPPT MIT DER KOPIE IM INSERT, UND DAS IST GEWOLLT -- aber es macht die Mutationsprobe
 * stumpf. Gemessen 02.09.2026: nimmt man `parent_id`, `coat_of_arms_url`, `capital_place_id` oder
 * `status` aus dem INSERT heraus, bleibt das Testfeld GRUEN, weil dieser Fueller sie danach
 * nachtraegt (4 von 16 Mutationen ungefangen). Farbe, Deckkraft und Zoomband stehen NICHT in der
 * Liste unten und werden deshalb sehr wohl gefangen.
 * 🔴 Wer einen der beiden Wege „aufraeumt", weil er redundant aussieht, verlaesst sich auf den
 * anderen -- und fuer den Fall, den der andere NICHT deckt, sagt kein Test etwas:
 *   - der INSERT deckt Werte, die keine Luecke waeren (Farbe, Deckkraft, Zoomband, sort_order);
 *   - dieser Fueller deckt den Fall, dass die Zielzeile SCHON EXISTIERTE.
 * Beide bleiben.
 */
function avesmapsEigenerKnotenBindungLueckenFuellen(PDO $pdo, int $zielId, array $alteZeile): int
{
    $spalten = ['short_name', 'status', 'coat_of_arms_url', 'capital_place_id', 'seat_place_id',
                'valid_label', 'parent_id', 'min_zoom', 'max_zoom'];

    $ziel = $pdo->prepare('SELECT * FROM political_territory WHERE id = :id LIMIT 1');
    $ziel->execute(['id' => $zielId]);
    $jetzt = $ziel->fetch(PDO::FETCH_ASSOC);
    if (!is_array($jetzt)) {
        return 0;
    }

    $setzen = [];
    $params = ['id' => $zielId];
    foreach ($spalten as $spalte) {
        $vorhanden = $jetzt[$spalte] ?? null;
        if ($vorhanden !== null && $vorhanden !== '') {
            continue;
        }
        $wert = $alteZeile[$spalte] ?? null;
        if ($wert === null || $wert === '') {
            continue;
        }
        $setzen[] = "{$spalte} = :v_{$spalte}";
        $params['v_' . $spalte] = $wert;
    }
    if ($setzen === []) {
        return 0;
    }
    $pdo->prepare('UPDATE political_territory SET ' . implode(', ', $setzen) . ' WHERE id = :id')->execute($params);

    return count($setzen);
}

/**
 * DIE EINE SCHREIBENDE FUNKTION. Bindet $eigenKey an $zielKey und laesst alles mitwandern.
 *
 * 💣 JEDES Ziel steht HIER und nirgends sonst. Wer ein Ziel hinzufuegt, fuegt es in dieser
 * Funktion hinzu -- und __tests__/eigener-knoten-wiki-bindung-ziele-test.php haelt die Liste
 * gegen den Entwurf. Eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel.
 *
 * @param array $felder        die ANGEHAKTEN Feldschluessel aus der Vorschau
 * @param array $zielWerte     die Wiki-Werte; nur die in $felder genannten werden geschrieben
 * @param int   $actorUserId   fuer die EINE Protokollzeile
 */
function avesmapsEigenerKnotenBindungAnwenden(
    PDO $pdo,
    string $eigenKey,
    string $zielKey,
    array $felder,
    array $zielWerte,
    int $actorUserId = 0
): array {
    if (!avesmapsWikiSyncMonitorIsCustomNodeKey($eigenKey)) {
        throw new RuntimeException('Nur eigene Knoten (eigener-knoten:...) lassen sich binden.');
    }
    if (strncmp($zielKey, 'wiki:', 5) !== 0) {
        throw new RuntimeException('Der Zielschluessel muss ein Wiki-Schluessel sein.');
    }

    // ⚠️ Die GANZE Zeile, nicht drei Spalten: die neue ist ihre Kopie (siehe Zielzeile).
    $alt = $pdo->prepare('SELECT * FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1');
    $alt->execute(['k' => $eigenKey]);
    $alteZeile = $alt->fetch(PDO::FETCH_ASSOC);
    if (!$alteZeile) {
        throw new RuntimeException('Der eigene Knoten ist nicht live: ' . $eigenKey);
    }
    $alteId = (int) $alteZeile['id'];
    $altePid = (string) $alteZeile['public_id'];

    // 🔴 Der Riegel gegen zwei Ansprueche auf denselben Schluessel (Entwurf §5.4). Ein zweiter
    // eigener Knoten auf denselben Artikel waere eine STILLE Verschmelzung zweier Gebiete.
    $belegt = $pdo->prepare(
        "SELECT wiki_key FROM political_territory
          WHERE wiki_key = :z AND is_active = 1 AND editor_notes LIKE 'Aus einem eigenen Knoten gebunden:%' LIMIT 1"
    );
    $belegt->execute(['z' => $zielKey]);
    if ($belegt->fetchColumn() !== false) {
        return ['ok' => false, 'error' => 'Dieser Wiki-Artikel ist schon an einen eigenen Knoten gebunden.',
                'target_id' => 0, 'moved' => []];
    }

    // Nur die angehakten Felder ueberleben.
    $erlaubt = array_flip($felder);
    $werte = array_intersect_key($zielWerte, $erlaubt);
    $werte['name'] = trim((string) ($zielWerte['name'] ?? ''));   // der Name ist die Identitaet
    $werte['type'] = $zielWerte['type'] ?? '';
    $werte['wiki_url'] = $zielWerte['wiki_url'] ?? '';

    $bewegt = [];
    $pdo->beginTransaction();
    try {
        // Erst den Slug freigeben, DANN die Zielzeile -- in dieser Reihenfolge (Entwurf §5.2).
        avesmapsEigenerKnotenBindungSlugFreigeben($pdo, $alteId, (string) $alteZeile['slug']);
        $zielId = avesmapsEigenerKnotenBindungZielzeile($pdo, $zielKey, $werte, $alteZeile);
        $zielPid = (string) $pdo->query("SELECT public_id FROM political_territory WHERE id = {$zielId}")->fetchColumn();

        // 🔴 Der Fall „Zielzeile existierte schon": sie behaelt ihre Werte, bekommt aber, was ihr
        // fehlt (Wappen, Hauptstadt-Verknuepfung, Elternteil, Zoomband). Beim Neuanlegen oben ist
        // das schon geschehen und dieser Aufruf findet keine Luecke mehr -- ein Weg, zwei Faelle.
        $bewegt['gefuellte_luecken'] = avesmapsEigenerKnotenBindungLueckenFuellen($pdo, $zielId, $alteZeile);

        // 💣 Die angehakten Felder werden HIER geschrieben, nicht beim Anlegen der Zielzeile.
        // Sonst kaemen sie nur im Neuanlage-Fall an und bei einer SCHON VORHANDENEN Zielzeile
        // stillschweigend gar nicht -- und genau dieser Fall entsteht, sobald jemand zwischendurch
        // "Hierarchie rechnen" + "Uebernehmen" gefahren hat. Zwei Faelle, ein Code (Entwurf §4).
        avesmapsEigenerKnotenBindungFelderSchreiben($pdo, $zielId, $felder, $zielWerte);

        // --- Die Ziele der territory_id -------------------------------------------------------
        foreach (['political_territory_geometry', 'political_territory_derived_geometry'] as $tabelle) {
            $s = $pdo->prepare("UPDATE {$tabelle} SET territory_id = :neu WHERE territory_id = :alt");
            $s->execute(['neu' => $zielId, 'alt' => $alteId]);
            $bewegt[$tabelle] = $s->rowCount();
        }

        // 💣 Der Anspruch hat ZWEI Spalten, und `uq_political_territory_claim
        // (territory_id, claimant_territory_id)` kann kollidieren. Kein UPDATE IGNORE: die Syntax
        // ist in MySQL und SQLite verschieden (`UPDATE IGNORE` gegen `UPDATE OR IGNORE`), und ein
        // Test auf der einen wuerde die andere nicht decken. Also: kollidierende Zeilen ZUERST
        // loeschen, dann glatt umhaengen.
        // ⚠️ Und ein Selbstanspruch (territory_id = claimant_territory_id) entsteht, wenn Ziel und
        // Quelle im selben Anspruch stehen -- der wird geloescht, nicht geschrieben.
        $bewegt['political_territory_claim'] = avesmapsEigenerKnotenBindungAnspruchUmhaengen($pdo, $alteId, $zielId);

        // Die Kinder.
        $kinder = $pdo->prepare('UPDATE political_territory SET parent_id = :neu WHERE parent_id = :alt');
        $kinder->execute(['neu' => $zielId, 'alt' => $alteId]);
        $bewegt['political_territory.parent_id'] = $kinder->rowCount();

        // --- Die Ziele der public_id ----------------------------------------------------------
        // 💣 `uq_feature_source (entity_type, entity_public_id, source_id)` bricht, sobald BEIDE
        // Gebiete dieselbe Quelle zitieren -- bei einem eigenen Knoten und seinem Wiki-Artikel der
        // wahrscheinliche Fall. Der Kraftlinien-Praezedenzfall (features.php:3927) macht hier ein
        // glattes UPDATE, und das ist DORT richtig: bauartbedingt traegt nur das Ankersegment
        // Quellen. Abschreiben darf man es nicht.
        $pdo->prepare(
            "DELETE FROM feature_sources
              WHERE entity_type = 'territory' AND entity_public_id = :alt
                AND source_id IN (SELECT source_id FROM (
                        SELECT source_id FROM feature_sources
                         WHERE entity_type = 'territory' AND entity_public_id = :neu
                    ) x)"
        )->execute(['alt' => $altePid, 'neu' => $zielPid]);
        $quellen = $pdo->prepare(
            "UPDATE feature_sources SET entity_public_id = :neu
              WHERE entity_type = 'territory' AND entity_public_id = :alt"
        );
        $quellen->execute(['neu' => $zielPid, 'alt' => $altePid]);
        $bewegt['feature_sources'] = $quellen->rowCount();

        $meldungen = $pdo->prepare(
            "UPDATE map_reports SET entity_public_id = :neu
              WHERE entity_type = 'territory' AND entity_public_id = :alt"
        );
        $meldungen->execute(['neu' => $zielPid, 'alt' => $altePid]);
        $bewegt['map_reports'] = $meldungen->rowCount();

        // --- Die Schluesselwanderung ----------------------------------------------------------
        // ⚠️ Die angehakten Felder reisen MIT: nur ein UNGEHAKTES bekommt einen Override, damit der
        // naechste „Uebernehmen" den Hand-Wert nicht platt macht (siehe dort).
        $bewegt['wiki_territory_model'] = avesmapsEigenerKnotenBindungModellUmhaengen($pdo, $eigenKey, $zielKey, $felder);

        // 💣 `sync_decision` hat den PRIMAERSCHLUESSEL (kind, entity_key, change_type). Tragen BEIDE
        // Schluessel eine Entscheidung -- der Normalfall, sobald der Wiki-Artikel schon einmal in
        // einer Vorschau stand --, bricht ein glattes UPDATE die ganze Uebernahme ab. Gemessen am
        // 02.09.2026 an der Szenarienprobe: SQLSTATE 23000, Transaktion zurueckgerollt, nichts
        // passiert. Dieselbe Klasse wie bei feature_sources und dem Anspruch; hier war sie
        // vergessen.
        // 🔴 Bei Kollision gewinnt die Entscheidung am ZIELSCHLUESSEL: sie wurde ueber den Artikel
        // getroffen, der ueberlebt. Die des eigenen Knotens gilt einem Objekt, das verschwindet.
        // Eine Entscheidung darf nie STILL zurueckgenommen werden (AGENTS.md, Uebernahme-Vorschau) --
        // deshalb wird nur die kollidierende geloescht, nie die verbleibende ueberschrieben.
        $bewegt['sync_decision.entity_key'] = avesmapsEigenerKnotenBindungKollisionsfreiUmschluesseln(
            $pdo, 'sync_decision', 'entity_key', ['kind', 'change_type'], $eigenKey, $zielKey
        );
        // ⚠️ `sync_plan_item` traegt KEINEN UNIQUE ueber entity_key (nur `id` als PK, gemessen an
        // sync-plan.php) -- hier genuegt das glatte UPDATE.
        foreach ([
            ['political_territory_claim', 'claimant_wiki_key'],
            ['sync_plan_item', 'entity_key'],
        ] as [$tabelle, $spalte]) {
            $s = $pdo->prepare("UPDATE {$tabelle} SET {$spalte} = :neu WHERE {$spalte} = :alt");
            $s->execute(['neu' => $zielKey, 'alt' => $eigenKey]);
            $bewegt[$tabelle . '.' . $spalte] = $s->rowCount();
        }

        $bewegt['map_features.territory_wiki_key'] =
            avesmapsEigenerKnotenBindungSiedlungenUmschluesseln($pdo, $eigenKey, $zielKey);

        // 💣 SELECT, dann UPDATE oder INSERT -- KEIN Upsert. `ON DUPLICATE KEY UPDATE` (MySQL) und
        // `ON CONFLICT ... DO UPDATE` (SQLite) sind verschiedene Syntax; ein SQLite-Test wuerde die
        // MySQL-Regression nicht sehen. Dieselbe Lehre wie beim UPDATE IGNORE weiter oben.
        avesmapsEigenerKnotenBindungSetzen(
            $pdo, 'wiki_redirect_alias', 'alias_slug', $eigenKey, ['canonical_wiki_key' => $zielKey]
        );

        // Die alte Zeile in den weichen Papierkorb (umkehrbar, wie bei den verwaisten Aussenhuellen).
        $pdo->prepare('UPDATE political_territory SET is_active = 0, parent_id = NULL WHERE id = :id')
            ->execute(['id' => $alteId]);

        // 🔴 EINE Protokollzeile je LAUF, nicht eine je Ziel (Entwurf §4.3). Eine Zeile je Ziel
        // machte aus einer Handlung sieben Eintraege, und der Aenderungs-Log waere danach nicht
        // mehr lesbar.
        avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            'territory_wiki_binding',
            $actorUserId,
            ['wiki_key' => $eigenKey, 'territory_id' => $alteId, 'public_id' => $altePid],
            ['wiki_key' => $zielKey, 'territory_id' => $zielId, 'public_id' => $zielPid, 'moved' => $bewegt]
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    // ⚠️ `target_key` reist MIT: die Oberflaeche waehlt danach den neuen Knoten aus, und der alte
    // Schluessel existiert dann nicht mehr. Ohne ihn muesste der Client ihn sich merken -- und
    // genau das ging beim ersten Bau daneben (er las seine Variable, nachdem er sie genullt hatte).
    return ['ok' => true, 'target_id' => $zielId, 'target_key' => $zielKey, 'moved' => $bewegt];
}

/**
 * Eine Schluesselspalte umschluesseln, ohne einen UNIQUE/PK zu brechen: erst die Zeilen loeschen,
 * die nach dem Umhaengen eine vorhandene Zielzeile doppeln wuerden, dann glatt umhaengen.
 *
 * 💣 KEIN `UPDATE IGNORE` -- die Syntax ist in MySQL und SQLite verschieden, ein SQLite-Test saehe
 * die MySQL-Regression nicht (AGENTS.md §9).
 * 💣 Die doppelte Ableitungstabelle ist tragend: MySQL lehnt
 * `DELETE ... WHERE ... IN (SELECT ... FROM derselben Tabelle)` mit Error 1093 ab. Das Haus-Idiom
 * steht in avesmapsPoliticalPruneGeometryAuditLog.
 * ⚠️ Spalten- und Tabellennamen kommen ausschliesslich aus dem Code dieser Datei, nie aus einer
 * Anfrage -- sie werden interpoliert, die WERTE immer als Platzhalter.
 *
 * @param list<string> $rest die uebrigen Spalten des UNIQUE/PK (die Identitaet neben $spalte)
 */
function avesmapsEigenerKnotenBindungKollisionsfreiUmschluesseln(
    PDO $pdo,
    string $tabelle,
    string $spalte,
    array $rest,
    string $alt,
    string $neu
): int {
    // ⚠️ Die aeusseren Spalten werden mit dem TABELLENNAMEN qualifiziert, nicht ueber ein Alias:
    // ein `DELETE FROM t AS a` kennt SQLite nicht (gemessen: "no such column: a.kind"), und
    // unqualifiziert waere der Name zwischen aussen und `b` mehrdeutig.
    $gleich = '';
    foreach ($rest as $r) {
        $gleich .= " AND b.{$r} = {$tabelle}.{$r}";
    }
    $pdo->prepare(
        "DELETE FROM {$tabelle}
          WHERE {$spalte} = :alt
            AND EXISTS (SELECT 1 FROM (SELECT * FROM {$tabelle}) b
                         WHERE b.{$spalte} = :neu{$gleich})"
    )->execute(['alt' => $alt, 'neu' => $neu]);

    $s = $pdo->prepare("UPDATE {$tabelle} SET {$spalte} = :neu WHERE {$spalte} = :alt");
    $s->execute(['neu' => $neu, 'alt' => $alt]);

    return $s->rowCount();
}

/**
 * Ansprueche umhaengen, ohne den UNIQUE zu brechen. Siehe die Begruendung am Aufrufer.
 *
 * 💣 Die doppelte Ableitungstabelle ist kein Zierrat: MySQL lehnt
 * `DELETE ... WHERE ... IN (SELECT ... FROM derselben Tabelle)` mit Error 1093 ab. Das Haus-Idiom
 * dagegen steht in avesmapsPoliticalPruneGeometryAuditLog (territories-audit.php) -- SQLite kennt
 * die Einschraenkung nicht, ein Test dort wuerde die Regression also NICHT sehen (AGENTS.md §9).
 */
function avesmapsEigenerKnotenBindungAnspruchUmhaengen(PDO $pdo, int $alteId, int $zielId): int
{
    // Erst die Zeilen, die nach dem Umhaengen doppelt oder ein Selbstanspruch waeren.
    $pdo->prepare(
        'DELETE FROM political_territory_claim
          WHERE id IN (SELECT id FROM (
                SELECT a.id FROM political_territory_claim a
                 WHERE (a.territory_id = :alt1 AND a.claimant_territory_id = :ziel1)
                    OR (a.territory_id = :ziel2 AND a.claimant_territory_id = :alt2)
            ) x)'
    )->execute(['alt1' => $alteId, 'ziel1' => $zielId, 'ziel2' => $zielId, 'alt2' => $alteId]);

    $bewegt = 0;
    foreach (['territory_id', 'claimant_territory_id'] as $spalte) {
        $gegen = $spalte === 'territory_id' ? 'claimant_territory_id' : 'territory_id';
        // Zeilen, deren Umhaengen eine vorhandene Kombination doppeln wuerde: erst weg.
        $pdo->prepare(
            "DELETE FROM political_territory_claim
              WHERE id IN (SELECT id FROM (
                    SELECT a.id FROM political_territory_claim a
                     WHERE a.{$spalte} = :alt
                       AND EXISTS (SELECT 1 FROM political_territory_claim b
                                    WHERE b.{$spalte} = :ziel AND b.{$gegen} = a.{$gegen})
                ) x)"
        )->execute(['alt' => $alteId, 'ziel' => $zielId]);

        $s = $pdo->prepare("UPDATE political_territory_claim SET {$spalte} = :ziel WHERE {$spalte} = :alt");
        $s->execute(['ziel' => $zielId, 'alt' => $alteId]);
        $bewegt += $s->rowCount();
    }

    return $bewegt;
}

/**
 * Den Modellknoten umhaengen: Kinder auf den neuen Schluessel, parent_locked und der von Hand
 * gesetzte Elternteil erben, der eigene Knoten faellt weg.
 *
 * 🔴 parent_locked ist eine HAND-ENTSCHEIDUNG und ueberlebt nach Hausregel jede Synchronisierung.
 * Ohne die Vererbung zoege der naechste sync_parent_cache die Hierarchie um -- das Wiki sagt
 * `Staat=Inoffiziell:Káhet Ni Kemi`, der Editor hat etwas anderes entschieden.
 */
function avesmapsEigenerKnotenBindungModellUmhaengen(PDO $pdo, string $eigenKey, string $zielKey, array $felder = []): int
{
    $eigen = $pdo->prepare(
        'SELECT parent_wiki_key, parent_locked, metadata_overrides_json
           FROM wiki_territory_model WHERE wiki_key = :k LIMIT 1'
    );
    $eigen->execute(['k' => $eigenKey]);
    $zeile = $eigen->fetch(PDO::FETCH_ASSOC);

    $kinder = $pdo->prepare('UPDATE wiki_territory_model SET parent_wiki_key = :neu WHERE parent_wiki_key = :alt');
    $kinder->execute(['neu' => $zielKey, 'alt' => $eigenKey]);
    $bewegt = $kinder->rowCount();

    if ($zeile) {
        // 🔴 DIE OVERRIDES DER UNGEHAKTEN FELDER WANDERN MIT, und ohne sie haelt die Bindung nur bis
        // zum naechsten „3 · Uebernehmen".
        // 💣 avesmapsWikiSyncMonitorApplyIdentityPreview rechnet den geltenden Wert als
        // `override ?? staging`. Wird die Modellzeile des eigenen Knotens SAMT ihrer Overrides
        // geloescht und die Zielzeile hat keine, ist der geltende Wert der (oft leere) Wiki-Wert --
        // „Tá'akîb (Baronie)" stuende dann in „Geaendert", VORANGEHAKT, und der naechste Uebernehmen
        // machte den Hand-Wert still platt. Der Owner haette die Bindung wiederholen muessen.
        // Gefunden am 02.09.2026 auf die Frage „muss ich das nochmal machen".
        // 🔴 Ein ANGEHAKTES Feld bekommt KEINEN Override: angehakt heisst „das Wiki pflegt es ab
        // jetzt" -- ein Override daneben hielte genau das auf.
        // ⚠️ Ein Override, den die ZIELZEILE schon hat, bleibt: sie ist die ueberlebende Identitaet
        // („der Wiki-Knoten gewinnt"), und ihre Entscheidung ist die juengere ueber diesen Artikel.
        $eigeneOv = json_decode((string) ($zeile['metadata_overrides_json'] ?? ''), true);
        $eigeneOv = is_array($eigeneOv) ? $eigeneOv : [];
        foreach ($felder as $feld) {
            unset($eigeneOv[(string) $feld]);
        }

        $zielAlt = $pdo->prepare('SELECT metadata_overrides_json FROM wiki_territory_model WHERE wiki_key = :k LIMIT 1');
        $zielAlt->execute(['k' => $zielKey]);
        $zielOv = json_decode((string) ($zielAlt->fetchColumn() ?: ''), true);
        $zielOv = is_array($zielOv) ? $zielOv : [];

        $spalten = [
            'parent_wiki_key' => $zeile['parent_wiki_key'],
            'parent_locked' => (int) ($zeile['parent_locked'] ?? 0),
            'excluded' => 0,
            'source_origin' => 'wiki',
        ];
        // ⚠️ `+` behaelt bei gleichem Schluessel den LINKEN Wert -- die Zielzeile gehoert also nach
        // links, damit ihr Override gewinnt.
        $vereint = $zielOv + $eigeneOv;
        if ($vereint !== []) {
            $spalten['metadata_overrides_json'] = json_encode($vereint, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        // 💣 Kein Upsert -- siehe avesmapsEigenerKnotenBindungSetzen.
        avesmapsEigenerKnotenBindungSetzen($pdo, 'wiki_territory_model', 'wiki_key', $zielKey, $spalten);
        $pdo->prepare('DELETE FROM wiki_territory_model WHERE wiki_key = :k')->execute(['k' => $eigenKey]);
        $bewegt++;
    }

    return $bewegt;
}

/**
 * Portables "setze diese Spalten auf der Zeile mit diesem Schluessel, lege sie an, wenn sie fehlt".
 *
 * 💣 KEIN UPSERT. `ON DUPLICATE KEY UPDATE` (MySQL) und `ON CONFLICT ... DO UPDATE` (SQLite) sind
 * verschiedene Syntax -- ein Test auf SQLite deckte die MySQL-Form nicht, und die Regression waere
 * erst live sichtbar. Dieselbe Klasse Fehler wie beim UPDATE IGNORE (AGENTS.md §9: ein SQLite-Test
 * kann eine MySQL-Regression ERZWINGEN).
 *
 * ⚠️ Spaltennamen kommen ausschliesslich aus dem Code dieser Datei, nie aus einer Anfrage --
 * sie werden in den SQL-Text interpoliert, die WERTE dagegen immer als Platzhalter.
 */
function avesmapsEigenerKnotenBindungSetzen(
    PDO $pdo,
    string $tabelle,
    string $schluesselSpalte,
    string $schluessel,
    array $spalten
): void {
    if ($spalten === []) {
        return;
    }
    $vorhanden = $pdo->prepare("SELECT 1 FROM {$tabelle} WHERE {$schluesselSpalte} = :k LIMIT 1");
    $vorhanden->execute(['k' => $schluessel]);

    $params = ['k' => $schluessel];
    foreach ($spalten as $name => $wert) {
        $params['v_' . $name] = $wert;
    }

    if ($vorhanden->fetchColumn() !== false) {
        $setzen = implode(', ', array_map(static fn(string $n): string => "{$n} = :v_{$n}", array_keys($spalten)));
        $pdo->prepare("UPDATE {$tabelle} SET {$setzen} WHERE {$schluesselSpalte} = :k")->execute($params);
        return;
    }

    $namen = array_keys($spalten);
    $pdo->prepare(
        "INSERT INTO {$tabelle} ({$schluesselSpalte}, " . implode(', ', $namen) . ')'
        . ' VALUES (:k, ' . implode(', ', array_map(static fn(string $n): string => ':v_' . $n, $namen)) . ')'
    )->execute($params);
}

/**
 * Die ANGEHAKTEN Felder auf die Zielzeile schreiben.
 *
 * 🔴 Getrennt vom Anlegen der Zielzeile, weil beide Faelle -- Ziel existiert / Ziel existiert nicht
 * -- durch denselben Code laufen muessen (Entwurf §4). Beim Anlegen mitgeschrieben kaemen die
 * Felder bei einer schon vorhandenen Zielzeile stillschweigend gar nicht an.
 *
 * ⚠️ Nur Spalten, die political_territory wirklich hat. Die Allowlist der bearbeitbaren Felder
 * (avesmapsWikiSyncMonitorEditableFields) kennt auch Wiki-Felder ohne Kartenspalte.
 */
function avesmapsEigenerKnotenBindungFelderSchreiben(PDO $pdo, int $zielId, array $felder, array $werte): int
{
    $spalten = ['name', 'type', 'status', 'continent', 'coat_of_arms_url', 'wiki_url'];
    $setzen = [];
    $params = ['id' => $zielId];
    foreach ($felder as $feld) {
        if (!in_array($feld, $spalten, true)) {
            continue;
        }
        $wert = trim((string) ($werte[$feld] ?? ''));
        if ($wert === '') {
            continue; // 🔴 Ein leerer Wiki-Wert loescht nichts -- er ist keine Aussage.
        }
        $setzen[] = "{$feld} = :v_{$feld}";
        $params['v_' . $feld] = $wert;
    }
    if ($setzen === []) {
        return 0;
    }
    $pdo->prepare('UPDATE political_territory SET ' . implode(', ', $setzen) . ' WHERE id = :id')->execute($params);

    return count($setzen);
}

/**
 * `properties.territory_wiki_key` der Siedlungen umschluesseln.
 *
 * 💣 DER STILLE. Der Wert entsteht per Ray-Cast im Siedlungseditor und wird von der
 * Literatur-Aggregation (game-literature-resolve.php:322) und der Kartennutzlast
 * (map-features.php:1097) gelesen. Ein veralteter Schluessel wirft KEINEN Fehler -- die Zuordnung
 * faellt einfach weg.
 *
 * ⚠️ Gelesen und geschrieben wird ueber json_decode/json_encode, nicht per Textersatz: ein
 * REPLACE() auf der Spalte traefe auch einen Schluessel, der zufaellig als Teilzeichenkette in
 * einem Namen steht.
 */
function avesmapsEigenerKnotenBindungSiedlungenUmschluesseln(PDO $pdo, string $eigenKey, string $zielKey): int
{
    $lesen = $pdo->prepare(
        "SELECT id, properties_json FROM map_features
          WHERE is_active = 1 AND properties_json LIKE :muster"
    );
    $lesen->execute(['muster' => '%' . $eigenKey . '%']);
    $schreiben = $pdo->prepare('UPDATE map_features SET properties_json = :p WHERE id = :id');

    $bewegt = 0;
    foreach ($lesen->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $props = json_decode((string) $zeile['properties_json'], true);
        if (!is_array($props) || ($props['territory_wiki_key'] ?? null) !== $eigenKey) {
            continue;
        }
        $props['territory_wiki_key'] = $zielKey;
        $schreiben->execute([
            'p' => json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'id' => (int) $zeile['id'],
        ]);
        $bewegt++;
    }

    return $bewegt;
}

/**
 * LESEND: Wiki-Artikel als Bindungskandidaten.
 *
 * 🔴 Das Kanon-Etikett ist hier tragend, nicht Zierrat: die Trefferliste mischt Kanon und
 * Fanmaterial, und ein Editor muss vor dem Klick sehen, was er sich einhandelt. Es kommt aus
 * avesmapsWikiNamespaceIsOfficial (seit 01.09.2026) -- KEIN zweites Etikett bauen. Der
 * Rueckgabewert ist `?bool`; `null` heisst "kein Inhaltsraum, die Frage stellt sich nicht".
 */
function avesmapsEigenerKnotenBindungKandidaten(PDO $pdo, string $suche, int $limit = 25): array
{
    $suche = trim($suche);

    // 🔴 EINE LEERE SUCHE IST KEIN FEHLER, SONDERN DIE VORAUSWAHL. Der Kasten oeffnet mit einer
    // gefuellten Liste, damit man sieht, dass es etwas zu waehlen GIBT -- dieselbe Form wie der
    // Ortspicker (Owner 02.09.2026, "wo man die vorauswahl sehen konnte"). Bis dahin gab dieser
    // Leser hier `[]` zurueck, und ein leerer Kasten ist von "es gibt nichts" nicht zu unterscheiden.
    // ⚠️ Der Deckel gilt trotzdem: ueber 1700 Artikel duerfen nie alle ueber die Leitung.
    $wieAlle = $suche === '';

    // 🔴 BEIDE TABELLEN, und das ist der Kern. Ein frisch gesyncter Artikel liegt AUSSCHLIESSLICH
    // im Staging: avesmapsWikiDumpPersistTerritoryRecords schreibt political_territory_wiki_test,
    // niemals den Spiegel -- in den kommt er erst mit "3 · Uebernehmen". Genau das sind aber die
    // inoffiziellen Gebiete, um die es hier geht.
    // 🪤 Live gemessen 02.09.2026: mit nur dem Spiegel meldete der Kasten "Kein Artikel gefunden"
    // fuer Inoffiziell:Táyârret, obwohl der Sync eine Stunde vorher gelaufen war. Der Entwurf nannte
    // beide Tabellen; die erste Umsetzung las eine. Gefunden hat es der Blick im Browser, kein Test.
    $zeilen = [];
    $gesehen = [];
    foreach ([
        ['political_territory_wiki', false],
        [AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE, true],
    ] as [$tabelle, $istStaging]) {
        // ⚠️ Auch der Alle-Fall bleibt gedeckelt und SORTIERT -- nur so ist das Zusammenfuehren
        // der zwei Tabellen unten wirklich der globale Anfang: was nicht unter den ersten $limit
        // seiner eigenen Tabelle steht, kann auch global nicht unter den ersten $limit sein.
        $statement = $pdo->prepare(
            "SELECT wiki_key, name, type, wiki_url, founded_text, dissolved_text
               FROM {$tabelle}"
            . ($wieAlle ? '' : ' WHERE name LIKE :q')
            . " ORDER BY name ASC
              LIMIT " . max(1, min(100, $limit))
        );
        $statement->execute($wieAlle ? [] : ['q' => '%' . $suche . '%']);

        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $key = (string) $r['wiki_key'];
            // ⚠️ Der SPIEGEL gewinnt: dieselbe Seite steht nach einer Uebernahme in beiden, und die
            // gepflegte Fassung ist die, gegen die der Editor entscheiden soll.
            if (isset($gesehen[$key])) {
                continue;
            }
            $gesehen[$key] = true;
            $url = (string) ($r['wiki_url'] ?? '');
            $ns = $url !== '' ? avesmapsWikiNamespaceFromWikiUrl($url) : null;
            $zeilen[] = [
                'wiki_key' => $key,
                'name' => (string) $r['name'],
                'type' => (string) ($r['type'] ?? ''),
                'wiki_url' => $url,
                'official' => $ns === null ? null : avesmapsWikiNamespaceIsOfficial($ns),
                // ⚠️ Der Editor MUSS sehen, dass eine Zeile nur im Staging liegt: sie ist noch nicht
                // uebernommen, und ihre Werte koennen sich mit dem naechsten "Uebernehmen" aendern.
                'staging_only' => $istStaging,
                'period' => trim(implode(' - ', array_filter([
                    trim((string) ($r['founded_text'] ?? '')),
                    trim((string) ($r['dissolved_text'] ?? '')),
                ]))),
            ];
        }
    }

    usort($zeilen, static fn(array $a, array $b): int => strcmp($a['name'], $b['name']));

    return array_slice($zeilen, 0, max(1, min(100, $limit)));
}

/**
 * LESEND: alle eigenen Knoten, zu denen es einen namensgleichen Wiki-Artikel gibt.
 *
 * 💣 VERGLICHEN WIRD DER NAME, NICHT DER TITEL. Der Titel traegt den Namensraum
 * ("Inoffiziell:Táyârret"), der Name nicht ("Táyârret"). Ueber Titel verglichen faende dieser Lauf
 * KEINEN EINZIGEN Treffer -- und ein leeres Ergebnis sieht aus wie "es gibt nichts zu tun".
 *
 * ⚠️ Gefaltet wird mit avesmapsPoliticalSlug, derselben Funktion, die den Schluessel baut. Ein
 * eigener Namensvergleich liefe ueber kurz oder lang auseinander (die Akzent-Falle: der Browser
 * zerlegt nach NFD, avesmapsFoldToAscii wirft Akzent samt Grundbuchstaben weg).
 *
 * 🔴 `unique` ist FALSCH, sobald zwei Artikel denselben Namen tragen ODER zwei eigene Knoten auf
 * denselben Artikel zeigen. Nur eindeutige Treffer duerfen vorangehakt werden.
 */
function avesmapsEigenerKnotenBindungVorschlaege(PDO $pdo): array
{
    // 🔴 BEIDE TABELLEN -- siehe avesmapsEigenerKnotenBindungKandidaten. Der Sammellauf ist genau
    // fuer die frisch gesyncten inoffiziellen Gebiete gedacht, und die liegen im Staging.
    // ⚠️ Ein Schluessel, der in beiden steht, zaehlt EINMAL -- sonst gaelte jeder uebernommene
    // Artikel als "zwei Treffer auf einen Namen" und waere damit faelschlich mehrdeutig.
    $artikelNachName = [];
    $gesehen = [];
    foreach (['political_territory_wiki', AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE] as $tabelle) {
        foreach ($pdo->query("SELECT wiki_key, name FROM {$tabelle}")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $key = (string) $r['wiki_key'];
            if (isset($gesehen[$key])) {
                continue;
            }
            $gesehen[$key] = true;
            $artikelNachName[avesmapsPoliticalSlug((string) $r['name'])][] = $r;
        }
    }

    $eigene = $pdo->query(
        "SELECT wiki_key, metadata_overrides_json FROM wiki_territory_model
          WHERE wiki_key LIKE 'eigener-knoten:%'"
    )->fetchAll(PDO::FETCH_ASSOC);

    // Erst sammeln, damit "zwei eigene Knoten auf einen Artikel" erkennbar wird.
    $roh = [];
    $zielZaehler = [];
    foreach ($eigene as $r) {
        $ov = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $name = is_array($ov) ? trim((string) ($ov['name'] ?? '')) : '';
        if ($name === '') {
            continue;
        }
        $kandidaten = $artikelNachName[avesmapsPoliticalSlug($name)] ?? [];
        if ($kandidaten === []) {
            continue;
        }
        $ziel = $kandidaten[0];
        $roh[] = [
            'own_key' => (string) $r['wiki_key'],
            'own_name' => $name,
            'target_key' => (string) $ziel['wiki_key'],
            'target_name' => (string) $ziel['name'],
            'unique' => count($kandidaten) === 1,
        ];
        $zielZaehler[(string) $ziel['wiki_key']] = ($zielZaehler[(string) $ziel['wiki_key']] ?? 0) + 1;
    }

    foreach ($roh as $i => $zeile) {
        if (($zielZaehler[$zeile['target_key']] ?? 0) > 1) {
            $roh[$i]['unique'] = false;
        }
    }

    return $roh;
}

/**
 * LESEND: die Wiki-Werte eines Zielschluessels, in der Form, die Vorschau und Uebernahme lesen.
 *
 * 🔴 DERSELBE RUECKFALL WIE BEI DER SUCHE, und er ist zwingend: was die Kandidatenliste aus dem
 * Staging anbietet, muss die Uebernahme auch LESEN koennen. Ohne ihn faende der Editor den Artikel,
 * klickte ihn an -- und bekaeme eine Zielzeile mit nichts als dem Namen darin, weil der Spiegel die
 * Seite noch nicht kennt. Ein Anbieten ohne Lesenkoennen ist die schlimmere Haelfte des Fehlers vom
 * 02.09.2026.
 * ⚠️ Der Spiegel gewinnt, aus demselben Grund wie dort: er ist die gepflegte Fassung.
 */
function avesmapsEigenerKnotenBindungZielWerte(PDO $pdo, string $zielKey): array
{
    foreach (['political_territory_wiki', AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE] as $tabelle) {
        $s = $pdo->prepare("SELECT * FROM {$tabelle} WHERE wiki_key = :k LIMIT 1");
        $s->execute(['k' => $zielKey]);
        $r = $s->fetch(PDO::FETCH_ASSOC);
        if (is_array($r)) {
            return $r;
        }
    }

    return [];
}

/**
 * LESEND: die vollstaendige Vorschau -- Felder plus Folgenliste.
 *
 * 💣 SIE SCHREIBT IN KEINE NUTZTABELLE. Dieselbe Zweiteilung wie bei jedem Sync im Haus; eine
 * Vorschau, die nebenbei schreibt, ist keine Vorschau.
 *
 * ⚠️ Die Folgenliste wird BENANNT, nicht nur gezaehlt: "3 Quellen, 1 Kind, 1 Geometrie" ist die
 * Auskunft, die vor einem nicht per Knopf umkehrbaren Schritt gebraucht wird.
 */
function avesmapsEigenerKnotenBindungPlan(PDO $pdo, string $eigenKey, string $zielKey): array
{
    $modell = $pdo->prepare('SELECT metadata_overrides_json FROM wiki_territory_model WHERE wiki_key = :k LIMIT 1');
    $modell->execute(['k' => $eigenKey]);
    $ovRaw = json_decode((string) ($modell->fetchColumn() ?: ''), true);
    $overrides = is_array($ovRaw) ? $ovRaw : [];

    $wikiRow = avesmapsEigenerKnotenBindungZielWerte($pdo, $zielKey);

    $alt = $pdo->prepare('SELECT id, public_id FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1');
    $alt->execute(['k' => $eigenKey]);
    $alteZeile = $alt->fetch(PDO::FETCH_ASSOC);

    $folgen = ['geometries' => 0, 'derived' => 0, 'claims' => 0, 'children' => 0, 'sources' => 0,
               'reports' => 0, 'settlements' => 0];
    if ($alteZeile) {
        $id = (int) $alteZeile['id'];
        $pid = (string) $alteZeile['public_id'];
        $zaehle = static function (PDO $pdo, string $sql, array $p): int {
            $s = $pdo->prepare($sql);
            $s->execute($p);
            return (int) $s->fetchColumn();
        };
        $folgen['geometries'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory_geometry WHERE territory_id = :i', ['i' => $id]);
        $folgen['derived'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory_derived_geometry WHERE territory_id = :i', ['i' => $id]);
        $folgen['claims'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory_claim WHERE territory_id = :i OR claimant_territory_id = :i2', ['i' => $id, 'i2' => $id]);
        $folgen['children'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory WHERE parent_id = :i AND is_active = 1', ['i' => $id]);
        $folgen['sources'] = $zaehle($pdo, "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'territory' AND entity_public_id = :p", ['p' => $pid]);
        $folgen['reports'] = $zaehle($pdo, "SELECT COUNT(*) FROM map_reports WHERE entity_type = 'territory' AND entity_public_id = :p", ['p' => $pid]);
        $folgen['settlements'] = $zaehle($pdo, 'SELECT COUNT(*) FROM map_features WHERE is_active = 1 AND properties_json LIKE :m', ['m' => '%' . $eigenKey . '%']);
    }

    return [
        'ok' => true,
        'dry_run' => true,
        'wiki_key' => $eigenKey,
        'target_key' => $zielKey,
        'target_exists' => $wikiRow !== [],
        'fields' => avesmapsEigenerKnotenBindungVorschau($overrides, $wikiRow),
        'consequences' => $folgen,
    ];
}
