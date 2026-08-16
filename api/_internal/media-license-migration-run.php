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
 *
 * 🔧 Aufgabe 5 (Hochlade-Protokoll): fuer vier Flaechen (settlement_coat, settlement_image, citymap,
 * cover) rekonstruiert der Lauf zusaetzlich uploaded_at (Datei-Datum, alle vier) und -- NUR bei
 * settlement_coat -- uploaded_by (Name aus map_audit_log). Das ist ein von der Lizenz-Zuordnung
 * UNABHAENGIGER Fund: ein Protokoll-Nachtrag kann auch dann etwas zu schreiben haben, wenn die Lizenz
 * schon stimmt (settlement_image/citymap tragen im Bestand bereits Katalogwerte -- ohne diese
 * Entkopplung bekaeme keine der beiden je ein Datum, weil ihr 'schreiben' nie ausgeloest wuerde). Die
 * Sperre bleibt an die LIZENZ gebunden: ein reiner Protokoll-Nachtrag kann die Sichtbarkeit nie
 * beruehren, avesmapsMediaLicenseIsPublic() kennt nur den Lizenzwert.
 */

require_once __DIR__ . '/media-license-migration.php';
require_once __DIR__ . '/wiki/sync.php'; // avesmapsWikiSyncEncodeJson
require_once __DIR__ . '/wiki/locations-helpers.php'; // avesmapsWikiSyncNextMapRevision

/**
 * @param array{dry_run?: bool, batch_limit?: int} $options
 * @return array{ok: bool, dry_run: bool, surfaces: array<string, array{gelesen: int, geaendert: int,
 *         beispiele: list<array<string, string>>, protokoll?: array{gesamt: int, datum_gefunden: int,
 *         name_gefunden: int}}>, sichtbarkeitswechsel: list<array<string, string>>,
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
    // Jeder Sammler liefert ['funde' => list<['id','alt','schreiben'=>callable,'protokoll_neu'=>array]>,
    // 'protokoll' => ['gesamt','datum_gefunden','name_gefunden']]. ZWEI Ausnahmen: territory_coat hat
    // KEIN Upload-Verzeichnis und damit kein Protokoll -- sein Sammler liefert weiterhin die reine
    // Liste von vor Aufgabe 5. settlement_coat liefert zusaetzlich eine zweite Fund-Liste (Faelle fuer
    // einen Menschen, siehe dort) -- deshalb hier die Sonderbehandlung je Flaeche, statt jedem Sammler
    // eine Form aufzuzwingen, die er nicht braucht.
    foreach ([
        'settlement_coat' => 'avesmapsMediaLicenseCollectSettlementCoats',
        'territory_coat' => 'avesmapsMediaLicenseCollectTerritoryCoats',
        'cover' => 'avesmapsMediaLicenseCollectCovers',
        'settlement_image' => 'avesmapsMediaLicenseCollectSettlementImages',
        'citymap' => 'avesmapsMediaLicenseCollectCitymaps',
    ] as $flaeche => $sammler) {
        $ergebnis = $sammler($pdo, $limit);
        if ($flaeche === 'territory_coat') {
            // 🔴 Territoriums-Wappen sind NICHT eine der vier Ablagen aus Aufgabe 5 (kein eigenes
            // Upload-Verzeichnis, kein vergleichbares Protokoll) -- der Sammler bleibt unveraendert.
            $funde = $ergebnis;
            $protokoll = null;
        } else {
            $funde = $ergebnis['funde'];
            $protokoll = $ergebnis['protokoll'];
            if ($flaeche === 'settlement_coat') {
                $coatOhneLizenz = $ergebnis['sonderfaelle'];
            }
        }

        $geaendert = [];
        foreach ($funde as $fund) {
            $neu = avesmapsMediaLicenseMigrateLegacy($flaeche, $fund['alt']);
            $lizenzGeaendert = ($neu !== $fund['alt']);
            $protokollNeu = $fund['protokoll_neu'] ?? [];
            if (!$lizenzGeaendert && $protokollNeu === []) {
                continue; // weder Lizenz noch Protokoll haben etwas Neues -- Idempotenz
            }
            // 🔴 DIE SPERRE. Beide Modi, immer, vor jedem Schreibvorgang -- aber nur, wenn sich die
            // LIZENZ aendert. Ein reiner Protokoll-Nachtrag (Datum/Name) kann die Sichtbarkeit nie
            // beruehren: avesmapsMediaLicenseIsPublic() kennt nur den Lizenzwert, nicht uploaded_at/by.
            if ($lizenzGeaendert && avesmapsMediaLicenseLegacyWasPublic($flaeche, $fund['alt']) !== avesmapsMediaLicenseIsPublic($neu)) {
                $wechsel[] = ['flaeche' => $flaeche, 'id' => (string) $fund['id'],
                              'alt' => (string) $fund['alt'], 'neu' => $neu];
                continue;
            }
            $geaendert[] = $fund + ['neu' => $neu];
        }
        $eintrag = [
            'gelesen' => count($funde) + ($flaeche === 'settlement_coat' ? count($coatOhneLizenz) : 0),
            'geaendert' => count($geaendert),
            'beispiele' => array_map(
                static fn(array $f): array => ['id' => (string) $f['id'], 'alt' => (string) $f['alt'], 'neu' => $f['neu']],
                array_slice($geaendert, 0, 5)
            ),
        ];
        // 🔴 Schritt 3 (Aufgabe 5): die Trefferquote steht schon in der VORSCHAU -- sie wird in
        // derselben Sammelschleife berechnet, die auch $bericht fuellt, also lange bevor die
        // dry_run/Sperre-Weiche unten ueber Schreiben oder Rueckgabe entscheidet.
        if ($protokoll !== null) {
            $eintrag['protokoll'] = $protokoll;
        }
        $bericht[$flaeche] = $eintrag;
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
            ($fund['schreiben'])($pdo, $fund['neu'], $fund['protokoll_neu'] ?? []);
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
 * Loest eine in der Datenbank gespeicherte Upload-URL SICHER zu einem Datei-Zeitstempel auf
 * (Aufgabe 5, Schritt 1).
 *
 * 💣 Die URL ist Redakteurseingabe -- an mehreren Stellen editierbar (settlement-coat-upload.php,
 * settlement-images.php, citymap-image.php, game-literature-cover.php) -- und deshalb KEIN
 * ungeprueftes filemtime() auf ihr. Dasselbe Muster wie api/edit/map/game-literature-cover.php:
 * 142-151 (Praefix-Pruefung + Ausschluss von '..' + realpath()-Einschluss ins erwartete Verzeichnis,
 * bevor das Dateisystem angefasst wird), mit EINER Abweichung: game-literature-cover.php reduziert
 * mit basename() auf den blossen Dateinamen, weil dort NUR flache Dateien liegen (.../own/<datei>).
 * Siedlungsbilder und Stadtkarten liegen dagegen je Objekt in einem Unterordner
 * (/uploads/siedlungen/<id>/<datei>) -- ein basename() faende dort IMMER nichts. Hier bleibt deshalb
 * der volle Pfad NACH dem Praefix erhalten; dafuer wird zusaetzlich der geparste Pfad selbst (nicht
 * nur die rohe URL) auf '..' geprueft, und das Ergebnis per realpath() gegen das erwartete
 * Basisverzeichnis eingeschlossen -- ein Symlink-Ausbruch waere damit ebenfalls abgefangen.
 *
 * @return string '' wenn die URL nicht zum erwarteten Praefix passt, die Datei fehlt (lokal: die vier
 *         Ablagen liegen nicht im Repo, siehe Docblock oben -- das ist der ERWARTETE Befund, kein
 *         Fehler) oder filemtime() scheitert. Sonst eine ISO-8601-Zeit in UTC.
 */
function avesmapsMediaLicenseUploadDateFromUrl(string $url, string $erwartetesPraefix): string
{
    $url = trim($url);
    if ($url === '' || !str_starts_with($url, $erwartetesPraefix) || str_contains($url, '..')) {
        return '';
    }
    $pfad = (string) parse_url($url, PHP_URL_PATH);
    if ($pfad === '' || str_contains($pfad, '..')) {
        return '';
    }

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 2)), '/');
    $realBasis = realpath($docroot . $erwartetesPraefix);
    $realZiel = realpath($docroot . $pfad);
    if ($realBasis === false || $realZiel === false || !str_starts_with($realZiel, $realBasis . DIRECTORY_SEPARATOR)) {
        return ''; // lokal: die Ablage existiert nicht -- "0 Datumsangaben" ist hier richtig
    }

    $zeit = @filemtime($realZiel);
    return $zeit === false ? '' : gmdate('Y-m-d\TH:i:s\Z', $zeit);
}

/**
 * Siedlungs-Wappen: der Name des Hochladers, wo das Protokoll ihn hergibt (Aufgabe 5, Schritt 2).
 * Einzige der vier Flaechen mit einer Spur -- Karten, Bilder und Cover haben keine vergleichbare
 * (Docblock der Aufgabe: "Nur die Siedlungs-Wappen haben eine Protokollspur").
 *
 * Gesucht: action = 'wiki_sync_update_point', deren after_json ein properties_json.coat.source
 * === 'own' traegt, das im before_json fehlt oder eine andere URL hat.
 *
 * 💣 before_json und after_json haben NICHT dieselbe Form (api/_internal/wiki/locations-helpers.php:
 * 183-216). before_json ist avesmapsWikiSyncEncodeJson($beforeRow) -- die ROHE Zeile aus
 * avesmapsWikiSyncFetchAuditRow(), deren properties_json ein STRING ist (die Spalte, wie sie in der
 * DB steht) und ein ZWEITES Mal dekodiert werden muss. after_json wird dagegen GEBAUT
 * (['properties_json' => $newProps, ...]) -- dort ist properties_json bereits ein ARRAY. Wer beide
 * gleich behandelt, findet auf einer Seite immer nichts und haelt die Trefferquote fuer schlecht.
 *
 * ⚠️ Der Treffer ist nicht garantiert -- die Aktion ist generisch, das Protokoll kann beschnitten
 * sein. Bei mehreren passenden Zeilen je Ort gewinnt die LETZTE (hoechstes created_at zuerst durch
 * die ORDER BY, dann durch die Ueberschreibung im Array): sie beschreibt das juengste
 * Hochladeereignis, also den aktuell gespeicherten Stand.
 *
 * @return array<int, string> feature_id (map_features.id) => Benutzername; nur belegte Treffer.
 *         Ein bekannter Akteur ohne aufloesbaren Benutzernamen (z. B. actor_user_id = 0/Import) liefert
 *         '' -- "leer heisst leer", kein erfundener Platzhaltername.
 */
function avesmapsMediaLicenseCollectSettlementCoatUploaders(PDO $pdo): array
{
    $ergebnis = [];
    $zeilen = $pdo->query(
        "SELECT audit.feature_id, audit.before_json, audit.after_json, users.username
         FROM map_audit_log audit
         LEFT JOIN users ON users.id = audit.actor_user_id
         WHERE audit.action = 'wiki_sync_update_point'
         ORDER BY audit.created_at ASC, audit.id ASC"
    );
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        // after_json ist GEBAUT -- properties_json ist dort schon ein Array, ein einziges json_decode reicht.
        $after = json_decode((string) ($zeile['after_json'] ?? ''), true);
        $afterProps = is_array($after) ? ($after['properties_json'] ?? null) : null;
        $afterCoat = is_array($afterProps) ? ($afterProps['coat'] ?? null) : null;
        if (!is_array($afterCoat) || ($afterCoat['source'] ?? '') !== 'own') {
            continue;
        }

        // before_json ist die ROHE Zeile -- properties_json ist dort ein STRING und muss NOCH EINMAL
        // dekodiert werden.
        $before = json_decode((string) ($zeile['before_json'] ?? ''), true);
        $beforePropsRaw = is_array($before) ? ($before['properties_json'] ?? null) : null;
        $beforeProps = is_string($beforePropsRaw) ? json_decode($beforePropsRaw, true) : null;
        $beforeCoat = is_array($beforeProps) ? ($beforeProps['coat'] ?? null) : null;
        $warSchonEigenesMitGleicherUrl = is_array($beforeCoat)
            && ($beforeCoat['source'] ?? '') === 'own'
            && (string) ($beforeCoat['url'] ?? '') === (string) ($afterCoat['url'] ?? '');
        if ($warSchonEigenesMitGleicherUrl) {
            continue; // kein Hochladeereignis -- schon vorher 'own' mit derselben URL
        }

        $featureId = (int) ($zeile['feature_id'] ?? 0);
        if ($featureId <= 0) {
            continue;
        }
        $ergebnis[$featureId] = trim((string) ($zeile['username'] ?? ''));
    }

    return $ergebnis;
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
 * 🔧 Aufgabe 5: uploaded_at (Datei-Datum, /uploads/wappen/own/) und uploaded_by (Name aus
 * map_audit_log) wandern in denselben JSON-Block wie license_status. Beide werden NUR versucht, wenn
 * noch kein Wert steht (Idempotenz -- ein einmal gefundener Name/Datum wird nie erneut aufgeloest oder
 * ueberschrieben), und nur geschrieben, wenn sich etwas findet ("leer heisst leer").
 *
 * @return array{funde: list<array{id: int, alt: string, schreiben: callable, protokoll_neu: array<string, string>}>,
 *         sonderfaelle: list<array{flaeche: string, id: string, url: string}>,
 *         protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int}}
 */
function avesmapsMediaLicenseCollectSettlementCoats(PDO $pdo, int $limit): array
{
    $uploaderNamen = avesmapsMediaLicenseCollectSettlementCoatUploaders($pdo);

    $zeilen = $pdo->query(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"coat\"%' LIMIT " . $limit
    );
    $funde = [];
    $sonderfaelle = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
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

        $protokoll['gesamt']++;
        $vorhandenesDatum = trim((string) ($props['coat']['uploaded_at'] ?? ''));
        $vorhandenerName = trim((string) ($props['coat']['uploaded_by'] ?? ''));
        $neuesDatum = $vorhandenesDatum === '' ? avesmapsMediaLicenseUploadDateFromUrl($url, '/uploads/wappen/own/') : '';
        $neuerName = $vorhandenerName === '' ? trim((string) ($uploaderNamen[$id] ?? '')) : '';
        if ($vorhandenesDatum !== '' || $neuesDatum !== '') {
            $protokoll['datum_gefunden']++;
        }
        if ($vorhandenerName !== '' || $neuerName !== '') {
            $protokoll['name_gefunden']++;
        }
        $protokollNeu = array_filter(
            ['uploaded_at' => $neuesDatum, 'uploaded_by' => $neuerName],
            static fn(string $wert): bool => $wert !== ''
        );

        $funde[] = [
            'id' => $id,
            'alt' => $status,
            'protokoll_neu' => $protokollNeu,
            'schreiben' => static function (PDO $pdo, string $neu, array $protokollNeu) use ($id, $props): void {
                $props['coat']['license_status'] = $neu;
                foreach ($protokollNeu as $feld => $wert) {
                    $props['coat'][$feld] = $wert;
                }
                $pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE id = :id')
                    ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'id' => $id]);
            },
        ];
    }

    return ['funde' => $funde, 'sonderfaelle' => $sonderfaelle, 'protokoll' => $protokoll];
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
 * 🔴 KEIN Hochlade-Protokoll (Aufgabe 5): Territoriums-Wappen sind nicht eine der vier Ablagen -- kein
 * eigenes Upload-Verzeichnis, keine vergleichbare Spur. Die schreiben()-Callbacks behalten ihre
 * urspruengliche Zwei-Parameter-Form; der Aufrufer in avesmapsMediaLicenseMigrationRun() reicht immer
 * einen dritten (leeren) Protokoll-Parameter durch, den PHP bei einem Aufruf mit mehr Argumenten als
 * deklariert stillschweigend ignoriert.
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
 * 🔧 Aufgabe 5: uploaded_at aus /uploads/questcovers/ (deckt eigene UND vom Wiki gezogene Cover ab --
 * beide liegen unter demselben Praefix, own-Uploads zusaetzlich unter own/). Kein uploaded_by: Cover
 * haben keine vergleichbare Protokollspur (nur Siedlungs-Wappen haben eine, siehe Sammler oben).
 *
 * @return array{funde: list<array{id: int, alt: string, schreiben: callable, protokoll_neu: array<string, string>}>,
 *         protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int}}
 */
function avesmapsMediaLicenseCollectCovers(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        "SELECT id, cover_url, field_origins_json, cover_license, cover_uploaded_at FROM adventure
         WHERE cover_url IS NOT NULL AND cover_url <> '' LIMIT " . $limit
    );
    $funde = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $id = (int) $zeile['id'];
        $origins = json_decode((string) ($zeile['field_origins_json'] ?? ''), true);
        $vonWiki = is_array($origins) && (string) ($origins['cover_url'] ?? '') === 'wiki';

        $protokoll['gesamt']++;
        $vorhandenesDatum = trim((string) ($zeile['cover_uploaded_at'] ?? ''));
        $neuesDatum = $vorhandenesDatum === ''
            ? avesmapsMediaLicenseUploadDateFromUrl((string) ($zeile['cover_url'] ?? ''), '/uploads/questcovers/')
            : '';
        if ($vorhandenesDatum !== '' || $neuesDatum !== '') {
            $protokoll['datum_gefunden']++;
        }
        $protokollNeu = $neuesDatum !== '' ? ['uploaded_at' => $neuesDatum] : [];

        $funde[] = [
            'id' => $id,
            'alt' => (string) ($zeile['cover_license'] ?? ''),
            'protokoll_neu' => $protokollNeu,
            'schreiben' => static function (PDO $pdo, string $neu, array $protokollNeu) use ($id, $vonWiki): void {
                $felder = ['cover_license' => $neu];
                if ($vonWiki) {
                    $felder['cover_author'] = 'Ulisses';
                }
                if (isset($protokollNeu['uploaded_at'])) {
                    $felder['cover_uploaded_at'] = $protokollNeu['uploaded_at'];
                }
                $setzt = implode(', ', array_map(static fn(string $spalte): string => "{$spalte} = :{$spalte}", array_keys($felder)));
                $pdo->prepare("UPDATE adventure SET {$setzt} WHERE id = :id")
                    ->execute($felder + ['id' => $id]);
            },
        ];
    }

    return ['funde' => $funde, 'protokoll' => $protokoll];
}

/**
 * Siedlungsbilder: properties_json -> images[].license. Die Werte sind bereits Kennungen -- dieser
 * Sammler aendert die LIZENZ nicht, er existiert, damit 'gelesen' die Zahl belegt und 'geaendert'
 * beweisbar 0 ist (fuer die Lizenz -- Protokoll-Nachtraege koennen trotzdem schreiben, s. u.).
 *
 * ⚠️ Legacy-Eintraege sind blanke URL-STRINGS statt Objekte (map-features.php:390) -- es gibt kein
 * Lizenzfeld und keine Ablage fuer ein Protokoll, in die geschrieben werden koennte. Ihr 'alt' wird
 * direkt auf den Zielwert 'ai_generated' gesetzt (denselben, den avesmapsMediaLicenseMigrateLegacy()
 * fuer einen leeren Wert liefern wuerde): das haelt den Fund idempotent gezaehlt UND schreibfrei
 * ('schreiben' wird nie aufgerufen, weil neu === alt und protokoll_neu leer bleibt), ohne eine zweite
 * Rueckgabeform fuer diesen einen Sammler zu brauchen.
 *
 * 🔧 Aufgabe 5: uploaded_at aus /uploads/siedlungen/, NUR bei Objekt-Eintraegen (die blanken
 * URL-Strings haben keine Ablage dafuer). 💣 Das ist die Flaeche, an der die Entkopplung von Lizenz
 * und Protokoll den Unterschied macht: die Lizenz aendert sich hier praktisch nie (schon Katalogwert),
 * also wuerde ein an die Lizenz gekoppeltes 'schreiben' das Datum NIE persistieren.
 *
 * @return array{funde: list<array{id: string, alt: string, schreiben: callable, protokoll_neu: array<string, string>}>,
 *         protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int}}
 */
function avesmapsMediaLicenseCollectSettlementImages(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"images\"%' LIMIT " . $limit
    );
    $funde = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($props) || !is_array($props['images'] ?? null)) {
            continue;
        }
        $id = (int) $zeile['id'];
        foreach ($props['images'] as $index => $bild) {
            if (is_array($bild)) {
                $protokoll['gesamt']++;
                $vorhandenesDatum = trim((string) ($bild['uploaded_at'] ?? ''));
                $neuesDatum = $vorhandenesDatum === ''
                    ? avesmapsMediaLicenseUploadDateFromUrl((string) ($bild['url'] ?? ''), '/uploads/siedlungen/')
                    : '';
                if ($vorhandenesDatum !== '' || $neuesDatum !== '') {
                    $protokoll['datum_gefunden']++;
                }
                $protokollNeu = $neuesDatum !== '' ? ['uploaded_at' => $neuesDatum] : [];

                $funde[] = [
                    'id' => $id . ':' . $index,
                    'alt' => (string) ($bild['license'] ?? ''),
                    'protokoll_neu' => $protokollNeu,
                    'schreiben' => static function (PDO $pdo, string $neu, array $protokollNeu) use ($id, $index, $props): void {
                        $props['images'][$index]['license'] = $neu;
                        foreach ($protokollNeu as $feld => $wert) {
                            $props['images'][$index][$feld] = $wert;
                        }
                        $pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE id = :id')
                            ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'id' => $id]);
                    },
                ];
                continue;
            }

            // Blanker URL-String: kein Objekt, keine Ablage fuer ein Protokoll. Siehe Docblock oben.
            $funde[] = [
                'id' => $id . ':' . $index,
                'alt' => 'ai_generated',
                'protokoll_neu' => [],
                'schreiben' => static function (PDO $pdo, string $neu, array $protokollNeu): void {
                    // Absichtlich leer -- wird nie aufgerufen (alt === neu === 'ai_generated', kein
                    // Protokoll moeglich).
                },
            ];
        }
    }

    return ['funde' => $funde, 'protokoll' => $protokoll];
}

/**
 * Stadtkarten: citymap.map_license, .thumb_license -- zwei unabhaengige Slots je Zeile. Beide tragen
 * bereits Katalogwerte (die Karten-Migration lief schon vor dieser Phase); dieser Sammler aendert die
 * LIZENZ nicht, beweist aber ueber 'gelesen', dass er tatsaechlich gelesen hat.
 *
 * 🔧 Aufgabe 5: uploaded_at je Slot aus der zugehoerigen *_local_url-Spalte (das ist unsere eigene
 * Kopie unter /uploads/kartensammlungen/<id>/ -- citymap-image.php:80/93; NICHT map_url/thumb_url, die
 * auch auf externe Wiki-Links zeigen koennen und fuer die es keine lokale Datei gibt). Kein
 * uploaded_by: keine vergleichbare Protokollspur fuer Karten (nur Siedlungs-Wappen haben eine).
 * 💣 Dieselbe Entkopplungs-Notwendigkeit wie bei Siedlungsbildern: die Lizenz aendert sich hier
 * praktisch nie, ein an sie gekoppeltes 'schreiben' wuerde das Datum nie persistieren.
 *
 * @return array{funde: list<array{id: string, alt: string, schreiben: callable, protokoll_neu: array<string, string>}>,
 *         protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int}}
 */
function avesmapsMediaLicenseCollectCitymaps(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        'SELECT id, map_license, thumb_license, map_local_url, thumb_local_url,
                map_uploaded_at, thumb_uploaded_at FROM citymap LIMIT ' . $limit
    );
    $funde = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    // Slot -> [URL-Spalte, Datums-Spalte]. Karte und Vorschau sind unabhaengige Ablagen derselben
    // Zeile (Spec §3.3: "SEPARATE LICENCES" -- und damit auch separate Protokolle).
    $slots = [
        'map_license' => ['url' => 'map_local_url', 'datum' => 'map_uploaded_at'],
        'thumb_license' => ['url' => 'thumb_local_url', 'datum' => 'thumb_uploaded_at'],
    ];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $id = (int) $zeile['id'];
        foreach ($slots as $spalte => $info) {
            $protokoll['gesamt']++;
            $vorhandenesDatum = trim((string) ($zeile[$info['datum']] ?? ''));
            $neuesDatum = $vorhandenesDatum === ''
                ? avesmapsMediaLicenseUploadDateFromUrl((string) ($zeile[$info['url']] ?? ''), '/uploads/kartensammlungen/')
                : '';
            if ($vorhandenesDatum !== '' || $neuesDatum !== '') {
                $protokoll['datum_gefunden']++;
            }
            $datumSpalte = $info['datum'];

            $funde[] = [
                'id' => $id . ':' . $spalte,
                'alt' => (string) ($zeile[$spalte] ?? ''),
                'protokoll_neu' => $neuesDatum !== '' ? ['datum' => $neuesDatum] : [],
                'schreiben' => static function (PDO $pdo, string $neu, array $protokollNeu) use ($id, $spalte, $datumSpalte): void {
                    if (isset($protokollNeu['datum'])) {
                        $pdo->prepare("UPDATE citymap SET {$spalte} = :v, {$datumSpalte} = :d WHERE id = :id")
                            ->execute(['v' => $neu, 'd' => $protokollNeu['datum'], 'id' => $id]);
                    } else {
                        $pdo->prepare("UPDATE citymap SET {$spalte} = :v WHERE id = :id")
                            ->execute(['v' => $neu, 'id' => $id]);
                    }
                },
            ];
        }
    }

    return ['funde' => $funde, 'protokoll' => $protokoll];
}
