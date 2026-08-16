<?php

declare(strict_types=1);

/**
 * Der Migrationslauf der Phase 2: bringt die Bestandswerte der vier betroffenen Fundstellen auf den
 * Katalog. Erst zeigen, dann schreiben.
 *
 * 🔴 DIE SPERRE IST DER ZWECK DIESER DATEI. Findet der Lauf auch nur EINE Zeile, deren Sichtbarkeit
 * sich durch die Zuordnung aendern wuerde, schreibt er GAR NICHTS -- auch nicht die unauffaelligen
 * Zeilen. Ein Bestandswert, den avesmapsMediaLicenseMigrateLegacy() nicht kennt, ist genau der Fall,
 * fuer den sie da ist: er faellt auf unknown_other, und ein bis dahin sichtbares Bild verschwaende
 * still. Ein halb gelaufener Umbau ist schlimmer als ein nicht gelaufener.
 *
 * ⚠️ Zwei geerbte Funktionen, ZWEI Dateien -- nicht eine. Der Kommentar "avesmapsWikiSyncNextMapRevision,
 * avesmapsWikiSyncEncodeJson" liesse vermuten, beide steckten in wiki/sync.php; tatsaechlich liegt
 * avesmapsWikiSyncNextMapRevision in wiki/locations-helpers.php (per
 * `grep -rn "function avesmapsWikiSyncNextMapRevision\|function avesmapsWikiSyncEncodeJson" api/_internal/`
 * verifiziert). Beide Dateien sind fuer sich genommen leicht: locations-helpers.php hat keine eigenen
 * requires, wiki/sync.php zieht nur ascii-fold.php nach -- kein Bootstrap, kein DDL auf oberster Ebene.
 */

require_once __DIR__ . '/media-license-migration.php';
require_once __DIR__ . '/wiki/sync.php'; // avesmapsWikiSyncEncodeJson
require_once __DIR__ . '/wiki/locations-helpers.php'; // avesmapsWikiSyncNextMapRevision

/**
 * @param array{dry_run?: bool, batch_limit?: int} $options
 * @return array{ok: bool, dry_run: bool, surfaces: array<string, array{gelesen: int, geaendert: int,
 *         beispiele: list<array<string, string>>}>, sichtbarkeitswechsel: list<array<string, string>>,
 *         coat_ohne_lizenz: list<array<string, string>>}
 */
function avesmapsMediaLicenseMigrationRun(PDO $pdo, array $options = []): array
{
    $dryRun = ($options['dry_run'] ?? true) !== false;   // ⚠️ Vorgabe ist die VORSCHAU
    $limit = max(1, min(2000, (int) ($options['batch_limit'] ?? 200)));
    @set_time_limit(60);

    $bericht = [];
    $wechsel = [];
    $coatOhneLizenz = [];   // Nachtrag aus dem Review von Aufgabe 1, siehe Sammler unten.
    $vorgemerkt = [];       // je Flaeche die Aenderungen, die den zweiten Durchgang ueberlebt haben
    // Jeder Sammler liefert normalerweise: list<['id','alt','schreiben'=>callable]>. EINE Ausnahme:
    // settlement_coat liefert zusaetzlich eine zweite Liste (Faelle fuer einen Menschen, siehe dort) --
    // deshalb hier die einzige Sonderbehandlung, statt allen fuenf Sammlern eine zweite Rueckgabeform
    // aufzuzwingen, die vier von ihnen nie brauchen.
    foreach ([
        'settlement_coat' => 'avesmapsMediaLicenseCollectSettlementCoats',
        'territory_coat' => 'avesmapsMediaLicenseCollectTerritoryCoats',
        'cover' => 'avesmapsMediaLicenseCollectCovers',
        'settlement_image' => 'avesmapsMediaLicenseCollectSettlementImages',
        'citymap' => 'avesmapsMediaLicenseCollectCitymaps',
    ] as $flaeche => $sammler) {
        $ergebnis = $sammler($pdo, $limit);
        if ($flaeche === 'settlement_coat') {
            $funde = $ergebnis['funde'];
            $coatOhneLizenz = $ergebnis['sonderfaelle'];
        } else {
            $funde = $ergebnis;
        }

        $geaendert = [];
        foreach ($funde as $fund) {
            $neu = avesmapsMediaLicenseMigrateLegacy($flaeche, $fund['alt']);
            if ($neu === $fund['alt']) {
                continue; // schon zugeordnet -- Idempotenz
            }
            // 🔴 DIE SPERRE. Beide Modi, immer, vor jedem Schreibvorgang.
            if (avesmapsMediaLicenseLegacyWasPublic($flaeche, $fund['alt']) !== avesmapsMediaLicenseIsPublic($neu)) {
                $wechsel[] = ['flaeche' => $flaeche, 'id' => (string) $fund['id'],
                              'alt' => (string) $fund['alt'], 'neu' => $neu];
                continue;
            }
            $geaendert[] = $fund + ['neu' => $neu];
        }
        $bericht[$flaeche] = [
            'gelesen' => count($funde) + ($flaeche === 'settlement_coat' ? count($coatOhneLizenz) : 0),
            'geaendert' => count($geaendert),
            'beispiele' => array_map(
                static fn(array $f): array => ['id' => (string) $f['id'], 'alt' => (string) $f['alt'], 'neu' => $f['neu']],
                array_slice($geaendert, 0, 5)
            ),
        ];
        $vorgemerkt[$flaeche] = $geaendert;
    }

    // 🔴 Ein einziger Wechsel haelt den GANZEN Lauf an -- nicht nur seine Flaeche.
    // ⚠️ coat_ohne_lizenz haelt NICHT an: die betroffene Zeile wird ohnehin nie migriert (sie landet
    // nie in $funde), also gibt es fuer den Rest des Laufs nichts zu schuetzen. Sie bleibt gemeldet,
    // in JEDER Antwort, bis ein Mensch die Zeile von Hand korrigiert -- ein staendiger Befund ist
    // hier richtig, kein Abbruchgrund.
    if ($wechsel !== [] || $dryRun) {
        return ['ok' => true, 'dry_run' => true, 'surfaces' => $bericht,
                'sichtbarkeitswechsel' => $wechsel, 'coat_ohne_lizenz' => $coatOhneLizenz];
    }

    foreach ($vorgemerkt as $flaeche => $geaendert) {
        foreach ($geaendert as $fund) {
            ($fund['schreiben'])($pdo, $fund['neu']);
        }
    }
    // ⚠️ Ohne neue Revision haelt ein Client seinen gecachten Payload fuer aktuell (ETag in
    // api/app/map-features.php sitzt auf map_revision).
    if (($bericht['settlement_coat']['geaendert'] ?? 0) > 0 || ($bericht['settlement_image']['geaendert'] ?? 0) > 0) {
        // 💣 sqlite (nur in lokalen Tests) kennt "ON DUPLICATE KEY UPDATE" nicht -- das ist
        // MySQL-Dialekt und bricht dort IMMER mit einem Syntaxfehler, egal ob map_revision existiert
        // (gemessen). Dieselbe Weiche wie in api/_internal/app/lore-rule-store.php: sqlite lebt nur
        // lokal in Tests, scharf laeuft ausschliesslich MySQL.
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'sqlite') {
            avesmapsWikiSyncNextMapRevision($pdo);
        }
    }

    return ['ok' => true, 'dry_run' => false, 'surfaces' => $bericht,
            'sichtbarkeitswechsel' => [], 'coat_ohne_lizenz' => $coatOhneLizenz];
}

/**
 * Siedlungs-Wappen: properties_json -> coat.license_status. Kein Feld, sondern JSON -- deshalb lesen,
 * dekodieren, im Speicher aendern, zurueckschreiben.
 *
 * ⚠️ NUR license_status wird angefasst. `source` ('own'/'wiki') bleibt, wie er ist: er sagt, WOHER das
 * Bild kam, nicht unter welcher Lizenz -- und avesmapsWikiSettlementSyncCoats:408 entscheidet an ihm,
 * ob ein Wiki-Abgleich ein eigenes Wappen ueberschreiben darf.
 *
 * 🔴 Nachtrag aus dem Review von Aufgabe 1: Siedlungs-Wappen sind HEUTE ungegated -- jedes gesetzte
 * Wappen war sichtbar, unabhaengig vom license_status (avesmapsMediaLicenseLegacyWasPublic() kennt nur
 * den Lizenzwert, nicht die URL). Ein Bestandswert mit URL, aber leerem/fehlendem license_status,
 * wuerde die Sperre deshalb NICHT ausloesen: migrateLegacy('') -> 'unknown_other', wasPublic('') ->
 * false, isPublic('unknown_other') -> false, also false===false -- die Zeile ginge lautlos in
 * 'unknown_other' und das Wappen verschwaende, sobald Phase 3 das Gate scharf schaltet. Deshalb ein
 * eigener, FRUEHERER Riegel: NICHT zuordnen, sondern zaehlen und getrennt melden (Kriterium: coat.url
 * ist nicht leer UND coat.license_status fehlt oder ist leer).
 *
 * @return array{funde: list<array{id: int, alt: string, schreiben: callable}>,
 *         sonderfaelle: list<array{flaeche: string, id: string, url: string}>}
 */
function avesmapsMediaLicenseCollectSettlementCoats(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"coat\"%' LIMIT " . $limit
    );
    $funde = [];
    $sonderfaelle = [];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($props) || !is_array($props['coat'] ?? null)) {
            continue;
        }
        $id = (int) $zeile['id'];
        $url = trim((string) ($props['coat']['url'] ?? ''));
        $status = trim((string) ($props['coat']['license_status'] ?? ''));

        if ($url !== '' && $status === '') {
            $sonderfaelle[] = ['flaeche' => 'settlement_coat', 'id' => (string) $id, 'url' => $url];
            continue;
        }

        $funde[] = [
            'id' => $id,
            'alt' => $status,
            'schreiben' => static function (PDO $pdo, string $neu) use ($id, $props): void {
                $props['coat']['license_status'] = $neu;
                $pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE id = :id')
                    ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'id' => $id]);
            },
        ];
    }

    return ['funde' => $funde, 'sonderfaelle' => $sonderfaelle];
}

/**
 * Territoriums-Wappen: ZWEI Fundstellen, eine Flaeche.
 *
 * 💣 political_territory_wiki_test.coat_of_arms_license_status (Staging) UND
 * wiki_territory_model.metadata_overrides_json -> coat_of_arms_license_status (Override) -- der
 * Override schlaegt das Staging (coat-url.php:63). Wer nur die Spalte migriert, laesst den wirksamen
 * Wert stehen und die Migration wirkt bei genau den Gebieten nicht, die jemand von Hand angefasst hat.
 * Beide Fundstellen liefern deshalb eigene, unabhaengige Eintraege; die id traegt zur Unterscheidung
 * ein Praefix (staging:<wiki_key> / override:<wiki_key>).
 *
 * Der Override-Schreibvorgang dekodiert, aendert NUR den einen Schluessel und schreibt den ganzen
 * Overrides-Block zurueck -- ein Override kann weitere, hier unbeteiligte Felder tragen, die nicht
 * verloren gehen duerfen.
 *
 * @return list<array{id: string, alt: string, schreiben: callable}>
 */
function avesmapsMediaLicenseCollectTerritoryCoats(PDO $pdo, int $limit): array
{
    $funde = [];

    $staging = $pdo->query(
        "SELECT wiki_key, coat_of_arms_license_status FROM political_territory_wiki_test
         WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> '' LIMIT " . $limit
    );
    foreach (($staging ? $staging->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $wikiKey = (string) $zeile['wiki_key'];
        $funde[] = [
            'id' => 'staging:' . $wikiKey,
            'alt' => (string) ($zeile['coat_of_arms_license_status'] ?? ''),
            'schreiben' => static function (PDO $pdo, string $neu) use ($wikiKey): void {
                $pdo->prepare(
                    'UPDATE political_territory_wiki_test SET coat_of_arms_license_status = :s WHERE wiki_key = :wk'
                )->execute(['s' => $neu, 'wk' => $wikiKey]);
            },
        ];
    }

    $overrides = $pdo->query(
        "SELECT wiki_key, metadata_overrides_json FROM wiki_territory_model
         WHERE metadata_overrides_json IS NOT NULL AND metadata_overrides_json <> '' LIMIT " . $limit
    );
    foreach (($overrides ? $overrides->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $decoded = json_decode((string) ($zeile['metadata_overrides_json'] ?? ''), true);
        if (!is_array($decoded) || !array_key_exists('coat_of_arms_license_status', $decoded)) {
            continue;
        }
        $wikiKey = (string) $zeile['wiki_key'];
        $funde[] = [
            'id' => 'override:' . $wikiKey,
            'alt' => (string) $decoded['coat_of_arms_license_status'],
            'schreiben' => static function (PDO $pdo, string $neu) use ($wikiKey, $decoded): void {
                $decoded['coat_of_arms_license_status'] = $neu;
                $pdo->prepare(
                    'UPDATE wiki_territory_model SET metadata_overrides_json = :j WHERE wiki_key = :wk'
                )->execute(['j' => avesmapsWikiSyncEncodeJson($decoded), 'wk' => $wikiKey]);
            },
        ];
    }

    return $funde;
}

/**
 * Literatur-Cover: adventure.cover_url gesetzt, field_origins_json.cover_url unterscheidet 'wiki' von
 * 'manual'. Die Spalte cover_license ist NEU (Aufgabe 2) -- im Ausgangszustand also leer, und
 * avesmapsMediaLicenseMigrateLegacy('cover', '') liefert 'permission_granted' (die Cover zeigen
 * Ulisses-Produktcover unter den Fan-Regeln, NOTICE.md).
 *
 * ⚠️ Der Urheber 'Ulisses' wird NUR bei einem Wiki-Cover gesetzt. Ein von Hand hochgeladenes Cover
 * bekommt 'permission_granted' OHNE Urheber -- ein spaeter echter Urheber waere von einem erfundenen
 * nicht mehr zu unterscheiden.
 *
 * @return list<array{id: int, alt: string, schreiben: callable}>
 */
function avesmapsMediaLicenseCollectCovers(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        "SELECT id, field_origins_json, cover_license FROM adventure
         WHERE cover_url IS NOT NULL AND cover_url <> '' LIMIT " . $limit
    );
    $funde = [];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $id = (int) $zeile['id'];
        $origins = json_decode((string) ($zeile['field_origins_json'] ?? ''), true);
        $vonWiki = is_array($origins) && (string) ($origins['cover_url'] ?? '') === 'wiki';

        $funde[] = [
            'id' => $id,
            'alt' => (string) ($zeile['cover_license'] ?? ''),
            'schreiben' => static function (PDO $pdo, string $neu) use ($id, $vonWiki): void {
                if ($vonWiki) {
                    $pdo->prepare('UPDATE adventure SET cover_license = :l, cover_author = :a WHERE id = :id')
                        ->execute(['l' => $neu, 'a' => 'Ulisses', 'id' => $id]);
                } else {
                    $pdo->prepare('UPDATE adventure SET cover_license = :l WHERE id = :id')
                        ->execute(['l' => $neu, 'id' => $id]);
                }
            },
        ];
    }

    return $funde;
}

/**
 * Siedlungsbilder: properties_json -> images[].license. Die Werte sind bereits Kennungen -- dieser
 * Sammler aendert NICHTS, er existiert, damit 'gelesen' die Zahl belegt und 'geaendert' beweisbar 0
 * ist.
 *
 * ⚠️ Legacy-Eintraege sind blanke URL-STRINGS statt Objekte (map-features.php:390) -- es gibt kein
 * Lizenzfeld, in das geschrieben werden koennte. Ihr 'alt' wird direkt auf den Zielwert 'ai_generated'
 * gesetzt (denselben, den avesmapsMediaLicenseMigrateLegacy() fuer einen leeren Wert liefern wuerde):
 * das haelt den Fund idempotent gezaehlt UND schreibfrei ('schreiben' wird nie aufgerufen, weil
 * neu === alt), ohne eine zweite Rueckgabeform fuer diesen einen Sammler zu brauchen.
 *
 * @return list<array{id: string, alt: string, schreiben: callable}>
 */
function avesmapsMediaLicenseCollectSettlementImages(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"images\"%' LIMIT " . $limit
    );
    $funde = [];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($props) || !is_array($props['images'] ?? null)) {
            continue;
        }
        $id = (int) $zeile['id'];
        foreach ($props['images'] as $index => $bild) {
            if (is_array($bild)) {
                $funde[] = [
                    'id' => $id . ':' . $index,
                    'alt' => (string) ($bild['license'] ?? ''),
                    'schreiben' => static function (PDO $pdo, string $neu) use ($id, $index, $props): void {
                        $props['images'][$index]['license'] = $neu;
                        $pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE id = :id')
                            ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'id' => $id]);
                    },
                ];
                continue;
            }

            // Blanker URL-String: kein Objekt, kein Lizenzfeld. Siehe Docblock oben.
            $funde[] = [
                'id' => $id . ':' . $index,
                'alt' => 'ai_generated',
                'schreiben' => static function (PDO $pdo, string $neu): void {
                    // Absichtlich leer -- wird nie aufgerufen (alt === neu === 'ai_generated').
                },
            ];
        }
    }

    return $funde;
}

/**
 * Stadtkarten: citymap.map_license, .thumb_license -- zwei unabhaengige Slots je Zeile. Beide tragen
 * bereits Katalogwerte (die Karten-Migration lief schon vor dieser Phase); dieser Sammler aendert
 * nichts, beweist aber ueber 'gelesen', dass er tatsaechlich gelesen hat.
 *
 * @return list<array{id: string, alt: string, schreiben: callable}>
 */
function avesmapsMediaLicenseCollectCitymaps(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query('SELECT id, map_license, thumb_license FROM citymap LIMIT ' . $limit);
    $funde = [];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $id = (int) $zeile['id'];
        foreach (['map_license', 'thumb_license'] as $spalte) {
            $funde[] = [
                'id' => $id . ':' . $spalte,
                'alt' => (string) ($zeile[$spalte] ?? ''),
                'schreiben' => static function (PDO $pdo, string $neu) use ($id, $spalte): void {
                    $pdo->prepare("UPDATE citymap SET {$spalte} = :v WHERE id = :id")
                        ->execute(['v' => $neu, 'id' => $id]);
                },
            ];
        }
    }

    return $funde;
}
