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
 *
 * 🔧 Fix-Runde 1 (drei Critical, zwei Important, eine Nachforderung -- siehe task-4-report.md):
 *   1. Territoriums-Override-Abfrage verglich eine JSON-Spalte mit `<> ''` -- unter MySQL bricht
 *      `CAST('' AS JSON)` IMMER (ERROR 3141). Ersatzlos gestrichen, `IS NOT NULL` bleibt.
 *   2. Alle fuenf Sammler sind ueber `id > :cursor ORDER BY id ASC LIMIT` resumierbar (Muster wie
 *      publication-sync.php:1141) statt bei jedem Aufruf dieselben ersten Zeilen zu liefern.
 *      `naechster_cursor`/`offen` je Flaeche im Bericht beantworten "ist noch etwas offen".
 *   3. settlement_coat und settlement_image lesen/schreiben DIESELBE map_features.properties_json --
 *      EIN frischer Lese-/Schreibvorgang je betroffener Zeile buendelt jetzt ALLE ihre Aenderungen,
 *      samt `revision`-Bump (wie settlements.php:521, settlement-images.php:142).
 *   4. Die Schreibschleife laeuft in EINER Transaktion (beginTransaction/commit/rollBack wie
 *      citymaps.php:1647).
 *   5. 'gelesen' zaehlt ROHE ZEILEN, nicht Eintraege.
 *   Nachforderung: `coat_ohne_lizenz_gesamt` zaehlt UNGEFENSTERT ueber den ganzen Bestand.
 *
 * 🔧 Fix-Runde 2 (ein Critical, zwei Important aus dem Diff der ersten Runde):
 *   N1. avesmapsMediaLicenseUploadDateFromUrl() lieferte ISO-8601 MIT 'T'/'Z' auch fuer die drei
 *       DATETIME-Spalten (adventure.cover_uploaded_at, citymap.*_uploaded_at) -- MySQL akzeptiert das
 *       nicht (ERROR 1292 unter strict mode, sonst stille Kuerzung). Aufgeteilt in einen gemeinsamen
 *       Zeitstempel-Kern plus zwei Formatierer: ISO-8601 fuer die JSON-Flaechen, MySQL-DATETIME fuer
 *       die Spalten-Flaechen (Details am Formatierer selbst).
 *   N2. avesmapsMediaLicenseCollectSettlementCoatUploaders() schluesselte nur nach feature_id -- ein
 *       LAENGST ERSETZTES Wappen (z. B. durch ein Wiki-Wappen mit anderer URL) bekam trotzdem den
 *       Namen aus einer alten Protokollzeile zugeschrieben. Jetzt zusaetzlich nach der geloggten
 *       coat.url geschluesselt; der Aufrufer gleicht gegen die HEUTIGE URL ab.
 *   N3. Die Sperre griff nur je FENSTER, nicht je LAUF: ein Wechsel im zweiten batch_limit-Fenster
 *       konnte das ERSTE, bereits geschriebene Fenster nicht mehr zurueckhalten -- die im Dateikopf
 *       oben versprochene Zusicherung ("schreibt er GAR NICHTS") galt de facto nur, solange ein Lauf
 *       nie ueber ein Fenster hinauskam. Ein scharfer Lauf prueft jetzt ERST den GANZEN Bestand (alle
 *       Fenster aller Flaechen, rein lesend) und schreibt nur, wenn dieser Vorlauf keinen einzigen
 *       Wechsel findet. Kostet einen zusaetzlichen Lesedurchgang -- das ist der Preis der Zusicherung.
 *       Die VORSCHAU bleibt fensterweise (dieselbe Semantik wie vor Fix-Runde 2).
 *   N4. Zwei ungefensterte Vollabzuege liefen JE FENSTERAUFRUF: die Uploader-Karte (map_audit_log,
 *       potenziell volle geometry_json-Schnappschuesse bei Wegen/Regionen) und der
 *       coat_ohne_lizenz-Zaehler. Die Uploader-Karte wird jetzt EINMAL JE LAUF aufgebaut (nicht mehr
 *       vom Sammler selbst, sondern vom Aufrufer durchgereicht) und beide streamen jetzt per
 *       fetch()-Schleife statt alles per fetchAll() im Speicher zu halten.
 */

require_once __DIR__ . '/media-license-migration.php';
require_once __DIR__ . '/wiki/sync.php'; // avesmapsWikiSyncEncodeJson
require_once __DIR__ . '/wiki/locations-helpers.php'; // avesmapsWikiSyncNextMapRevision

/**
 * Wie avesmapsWikiSyncNextMapRevision(), aber sqlite-sicher (Fix 1 der ersten Pruefrunde,
 * unveraendert von damals): sqlite kennt "ON DUPLICATE KEY UPDATE" nicht -- das ist MySQL-Dialekt und
 * bricht dort IMMER mit einem Syntaxfehler, egal ob map_revision existiert (empirisch geprueft).
 * Dieselbe Weiche wie in api/_internal/app/lore-rule-store.php: sqlite lebt nur lokal in Tests, scharf
 * laeuft ausschliesslich MySQL. Unter sqlite liefert diese Funktion 0 -- ein gueltiger, aber
 * bedeutungsloser Platzhalter, der in KEINEM Test verglichen wird.
 */
function avesmapsMediaLicenseNextMapRevisionSafe(PDO $pdo): int
{
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
        return 0;
    }

    return avesmapsWikiSyncNextMapRevision($pdo);
}

/**
 * Prueft EINEN bereits als "Lizenz aendert sich" erkannten Fund auf einen Sichtbarkeitswechsel.
 * Geteilt zwischen dem normalen Fenster-Durchlauf und dem globalen Vorab-Scan (N3, Fix-Runde 2) --
 * zwei Kopien derselben Pruefung waeren genau die Divergenz, vor der AGENTS §11 warnt (die
 * Listenzeile: zwei Abschriften derselben Regel laufen irgendwann auseinander).
 *
 * @return array{flaeche:string,id:string,alt:string,neu:string}|null null, wenn KEIN Wechsel vorliegt.
 */
function avesmapsMediaLicenseCheckWechsel(string $flaeche, array $fund, string $neu): ?array
{
    if (avesmapsMediaLicenseLegacyWasPublic($flaeche, $fund['alt']) === avesmapsMediaLicenseIsPublic($neu)) {
        return null;
    }

    return ['flaeche' => $flaeche, 'id' => (string) $fund['id'], 'alt' => (string) $fund['alt'], 'neu' => $neu];
}

/**
 * N3 (Fix-Runde 2): der scharfe Lauf darf nicht nur SEIN angefordertes Fenster gegen einen
 * Sichtbarkeitswechsel pruefen -- die Zusicherung im Dateikopf gilt fuer den GANZEN Bestand. Liest
 * ALLE Fenster ALLER fuenf Flaechen (Cursor ab 0, ein grosser interner Schritt statt des vom Aufrufer
 * gewaehlten batch_limit, bis jeder Sammler 'offen' => false meldet), OHNE zu schreiben, und sammelt
 * JEDEN gefundenen Wechsel (kein Kurzschluss beim ersten Fund -- der Bericht soll vollstaendig sein,
 * nicht nur ein Existenzbeweis).
 *
 * @param array<int, array<string,string>> $uploaderNamen vorgeladen, s. avesmapsMediaLicenseMigrationRun()
 * @return list<array{flaeche:string,id:string,alt:string,neu:string}>
 */
function avesmapsMediaLicenseFindAllVisibilityChanges(PDO $pdo, int $stepLimit, array $uploaderNamen): array
{
    $wechsel = [];
    foreach ([
        'settlement_coat' => 'avesmapsMediaLicenseCollectSettlementCoats',
        'territory_coat' => 'avesmapsMediaLicenseCollectTerritoryCoats',
        'cover' => 'avesmapsMediaLicenseCollectCovers',
        'settlement_image' => 'avesmapsMediaLicenseCollectSettlementImages',
        'citymap' => 'avesmapsMediaLicenseCollectCitymaps',
    ] as $flaeche => $sammler) {
        $cursor = $flaeche === 'territory_coat' ? ['staging' => 0, 'override' => 0] : 0;
        do {
            $ergebnis = $flaeche === 'settlement_coat'
                ? $sammler($pdo, $stepLimit, $cursor, $uploaderNamen)
                : $sammler($pdo, $stepLimit, $cursor);
            foreach ($ergebnis['funde'] as $fund) {
                $neu = avesmapsMediaLicenseMigrateLegacy($flaeche, $fund['alt']);
                if ($neu === $fund['alt']) {
                    continue; // schon zugeordnet -- kein Kandidat fuer einen Wechsel
                }
                $eintrag = avesmapsMediaLicenseCheckWechsel($flaeche, $fund, $neu);
                if ($eintrag !== null) {
                    $wechsel[] = $eintrag;
                }
            }
            $cursor = $ergebnis['naechster_cursor'] ?? $cursor;
            $offen = $ergebnis['offen'];
        } while ($offen);
    }

    return $wechsel;
}

/**
 * @param array{dry_run?: bool, batch_limit?: int, cursors?: array<string, mixed>} $options
 * @return array{ok: bool, dry_run: bool, surfaces: array<string, array{gelesen: int, geaendert: int,
 *         beispiele: list<array<string, string>>, naechster_cursor: mixed, offen: bool,
 *         protokoll?: array{gesamt: int, datum_gefunden: int, name_gefunden: int}}>,
 *         sichtbarkeitswechsel: list<array<string, string>>, coat_ohne_lizenz: list<array<string, string>>,
 *         coat_ohne_lizenz_gesamt: int}
 */
function avesmapsMediaLicenseMigrationRun(PDO $pdo, array $options = []): array
{
    $dryRun = ($options['dry_run'] ?? true) !== false;   // ⚠️ Vorgabe ist die VORSCHAU
    $limit = max(1, min(2000, (int) ($options['batch_limit'] ?? 200)));
    @set_time_limit(60);

    $cursors = is_array($options['cursors'] ?? null) ? $options['cursors'] : [];

    // N4 (Fix-Runde 2): EINMAL JE LAUF, nicht mehr einmal je Fensteraufruf -- wird an jeden Aufruf von
    // avesmapsMediaLicenseCollectSettlementCoats() durchgereicht (den normalen Fenster-Durchlauf unten
    // UND den globalen Vorab-Scan fuer N3).
    $uploaderNamen = avesmapsMediaLicenseCollectSettlementCoatUploaders($pdo);

    // N3 (Fix-Runde 2): ein scharfer Lauf prueft ERST den GANZEN Bestand, bevor er irgendetwas
    // schreibt -- sonst koennte ein Wechsel in einem SPAETEREN Fenster ein FRUEHERES, das der Cursor
    // schon geschrieben hat, nicht mehr zurueckholen. Die Vorschau bleibt fensterweise: diese teure
    // Vollpruefung lohnt sich nur, wenn am Ende tatsaechlich geschrieben werden soll.
    $globalerWechsel = $dryRun ? [] : avesmapsMediaLicenseFindAllVisibilityChanges($pdo, 2000, $uploaderNamen);

    $bericht = [];
    $wechsel = $globalerWechsel;
    $coatOhneLizenz = [];   // Nachtrag aus dem Review von Aufgabe 1, siehe Sammler unten.
    $vorgemerkt = [];       // je Flaeche die Aenderungen, die den zweiten Durchgang ueberlebt haben
    // Alle fuenf Sammler liefern seit der zweiten Pruefrunde dieselbe Form: ['funde' => list, 'protokoll'
    // => array|null, 'sonderfaelle' => list, 'gelesen' => int, 'naechster_cursor' => mixed, 'offen' =>
    // bool]. protokoll ist NUR bei territory_coat null (kein Upload-Verzeichnis, kein Protokoll);
    // sonderfaelle ist NUR bei settlement_coat nicht leer (Faelle fuer einen Menschen, siehe dort).
    // Beides bleibt am Aufrufer lesbar, statt fuenf verschiedene Rueckgabeformen zu erzwingen.
    foreach ([
        'settlement_coat' => 'avesmapsMediaLicenseCollectSettlementCoats',
        'territory_coat' => 'avesmapsMediaLicenseCollectTerritoryCoats',
        'cover' => 'avesmapsMediaLicenseCollectCovers',
        'settlement_image' => 'avesmapsMediaLicenseCollectSettlementImages',
        'citymap' => 'avesmapsMediaLicenseCollectCitymaps',
    ] as $flaeche => $sammler) {
        $cursorVorgabe = $flaeche === 'territory_coat' ? ['staging' => 0, 'override' => 0] : 0;
        $cursorEingabe = $cursors[$flaeche] ?? $cursorVorgabe;
        if ($flaeche === 'territory_coat') {
            $cursorEingabe = [
                'staging' => (int) (is_array($cursorEingabe) ? ($cursorEingabe['staging'] ?? 0) : 0),
                'override' => (int) (is_array($cursorEingabe) ? ($cursorEingabe['override'] ?? 0) : 0),
            ];
        } else {
            $cursorEingabe = (int) $cursorEingabe;
        }

        $ergebnis = $flaeche === 'settlement_coat'
            ? $sammler($pdo, $limit, $cursorEingabe, $uploaderNamen)
            : $sammler($pdo, $limit, $cursorEingabe);
        $funde = $ergebnis['funde'];
        $protokoll = $ergebnis['protokoll'];
        if ($flaeche === 'settlement_coat') {
            $coatOhneLizenz = $ergebnis['sonderfaelle'];
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
            // ⚠️ Diese Fenster-Pruefung bleibt bestehen (nicht nur der globale Vorlauf oben): fuer die
            // VORSCHAU ist sie die EINZIGE Erkennung (der Vorlauf laeuft dort nicht), und im scharfen
            // Lauf findet sie defensiv dasselbe wie der Vorlauf -- schadet nicht, kostet nichts
            // Nennenswertes (dasselbe Fenster ist ohnehin schon geladen).
            if ($lizenzGeaendert) {
                $eintrag = avesmapsMediaLicenseCheckWechsel($flaeche, $fund, $neu);
                if ($eintrag !== null) {
                    $wechsel[] = $eintrag;
                    continue;
                }
            }
            $geaendert[] = $fund + ['neu' => $neu];
        }
        $eintrag = [
            // 🔧 Fix 5 (Runde 1): rohe Zeilenzahl der Abfrage (auch json_decode-Aussteiger zaehlen
            // mit), nicht die Anzahl produzierter Funde -- eine Zeile mit zwei Bildern liefert zwei
            // Funde, zaehlt hier aber einmal.
            'gelesen' => $ergebnis['gelesen'],
            'geaendert' => count($geaendert),
            'beispiele' => array_map(
                static fn(array $f): array => ['id' => (string) $f['id'], 'alt' => (string) $f['alt'], 'neu' => $f['neu']],
                array_slice($geaendert, 0, 5)
            ),
            // 🔧 Fix 2 (Runde 1): beantwortet "ist noch etwas offen", unabhaengig von dry_run/dem Rest
            // des Berichts.
            'naechster_cursor' => $ergebnis['naechster_cursor'],
            'offen' => $ergebnis['offen'],
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

    // Der globale Vorlauf (N3) und die Fenster-Pruefung koennen denselben Fund melden, wenn das
    // angeforderte Fenster selbst betroffen ist -- ohne Entdopplung stuende er zweimal in der Antwort.
    $wechselOhneDoppel = [];
    foreach ($wechsel as $eintrag) {
        $wechselOhneDoppel[$eintrag['flaeche'] . '|' . $eintrag['id']] = $eintrag;
    }
    $wechsel = array_values($wechselOhneDoppel);

    // Nachforderung: ungefenstert, unabhaengig von dry_run/dem Rest des Berichts -- siehe Docblock der
    // Funktion unten.
    $coatOhneLizenzGesamt = avesmapsMediaLicenseCountCoatOhneLizenz($pdo);

    // 🔴 Ein einziger Wechsel haelt den GANZEN Lauf an -- nicht nur seine Flaeche/sein Fenster (N3).
    // ⚠️ coat_ohne_lizenz haelt NICHT an: die betroffene Zeile wird ohnehin nie migriert (sie landet
    // nie in $funde), also gibt es fuer den Rest des Laufs nichts zu schuetzen. Sie bleibt gemeldet,
    // in JEDER Antwort, bis ein Mensch die Zeile von Hand korrigiert -- ein staendiger Befund ist
    // hier richtig, kein Abbruchgrund.
    if ($wechsel !== [] || $dryRun) {
        return ['ok' => true, 'dry_run' => true, 'surfaces' => $bericht,
                'sichtbarkeitswechsel' => $wechsel, 'coat_ohne_lizenz' => $coatOhneLizenz,
                'coat_ohne_lizenz_gesamt' => $coatOhneLizenzGesamt];
    }

    // 🔧 Fix 4 (Runde 1): EINE Transaktion um die ganze Schreibschleife (Muster wie
    // citymaps.php:1647) -- ein Abbruch mitten drin (@set_time_limit, STRATO) hinterlaesst keinen halb
    // geschriebenen Zustand mehr. "Ein halb gelaufener Umbau ist schlimmer als ein nicht gelaufener"
    // gilt nicht nur fuer die Sperre oben, sondern auch fuer einen Prozessabbruch.
    $pdo->beginTransaction();
    try {
        // 🔧 Fix 3 (Runde 1): settlement_coat und settlement_image koennen DIESELBE map_features-Zeile
        // treffen (Wappen UND Bilder), und settlement_image kann MEHRERE Bilder derselben Zeile
        // treffen. Ein Schreibvorgang je Fund (wie bei den anderen drei Flaechen) haette den
        // vorherigen lautlos zurueckgenommen -- jeder hielt vorher eine eigene, beim Sammeln
        // geschossene Kopie der ganzen Spalte. Deshalb: je betroffener Zeile GENAU EIN frischer
        // Lese-/Schreibvorgang, der ALLE ihre Aenderungen buendelt (die Funde tragen dafuer 'zeile' +
        // 'anwenden' statt 'schreiben').
        $mapFeaturePatches = [];
        foreach (['settlement_coat', 'settlement_image'] as $flaeche) {
            foreach ($vorgemerkt[$flaeche] ?? [] as $fund) {
                $mapFeaturePatches[$fund['zeile']][] = $fund;
            }
        }
        foreach ($mapFeaturePatches as $zeileId => $patches) {
            $roh = $pdo->prepare('SELECT properties_json FROM map_features WHERE id = :id');
            $roh->execute(['id' => $zeileId]);
            $props = json_decode((string) ($roh->fetchColumn() ?: ''), true);
            if (!is_array($props)) {
                continue; // die Zeile ist zwischen Sammeln und Schreiben verschwunden/kaputt
            }
            foreach ($patches as $patch) {
                ($patch['anwenden'])($props, $patch['neu'], $patch['protokoll_neu'] ?? []);
            }
            $revision = avesmapsMediaLicenseNextMapRevisionSafe($pdo);
            $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id')
                ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $zeileId]);
        }

        // Die drei anderen Flaechen treffen je Fund eine eigene Zeile/Spalte -- kein Koaleszieren
        // noetig, ihr 'schreiben' bleibt ein eigener, unmittelbarer Schreibvorgang.
        foreach (['territory_coat', 'cover', 'citymap'] as $flaeche) {
            foreach ($vorgemerkt[$flaeche] ?? [] as $fund) {
                ($fund['schreiben'])($pdo, $fund['neu'], $fund['protokoll_neu'] ?? []);
            }
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['ok' => true, 'dry_run' => false, 'surfaces' => $bericht,
            'sichtbarkeitswechsel' => [], 'coat_ohne_lizenz' => $coatOhneLizenz,
            'coat_ohne_lizenz_gesamt' => $coatOhneLizenzGesamt];
}

/**
 * Nachforderung aus der zweiten Pruefrunde: coat_ohne_lizenz ist die tragende Haelfte des
 * Review-Nachtrags aus Aufgabe 1, aber die windowed Liste im Bericht (surfaces['settlement_coat']
 * durchlaeuft nur das aktuelle batch_limit-Fenster) beantwortet "ist die Zahl 0" nicht zuverlaessig --
 * ein Fall ausserhalb des Fensters faellt einfach nicht auf. Deshalb ein zweiter, UNGEFENSTERTER
 * Durchlauf ueber ALLE Zeilen mit einem coat-Objekt, rein zaehlend.
 *
 * ⚠️ Kein SQL-COUNT(*) mit JSON-Extraktion: MySQL- und sqlite-JSON-Funktionen sind nicht deckungsgleich,
 * und dieselbe Datei muss unter beiden laufen (Tests vs. scharf, wie bei Fix 1). Eine PHP-seitige
 * Zaehlung ueber denselben LIKE-Filter wie der Sammler ist bei Bestandsgroessen im niedrigen
 * vierstelligen Bereich (AGENTS.md: ~4.653 Orte) fuer einen admin-gated, selten aufgerufenen Endpunkt
 * kein Performance-Problem.
 *
 * 🔧 N4 (Fix-Runde 2): `fetch()` in einer Schleife statt `fetchAll()` -- das haelt nicht das komplette
 * Ergebnis als PHP-Array im Speicher, sondern verarbeitet Zeile fuer Zeile. Der Zaehl-Charakter dieser
 * Funktion selbst (ein zweiter Vollabzug) bleibt -- das hat die Pruefung ausdruecklich NICHT verlangt
 * zu aendern, nur das `fetchAll`.
 */
function avesmapsMediaLicenseCountCoatOhneLizenz(PDO $pdo): int
{
    $statement = $pdo->query(
        "SELECT properties_json FROM map_features WHERE is_active = 1 AND properties_json LIKE '%\"coat\"%'"
    );
    if ($statement === false) {
        return 0;
    }

    $anzahl = 0;
    while (($zeile = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($props) || !is_array($props['coat'] ?? null)) {
            continue;
        }
        $url = trim((string) ($props['coat']['url'] ?? ''));
        $status = trim((string) ($props['coat']['license_status'] ?? ''));
        if ($url !== '' && $status === '') {
            $anzahl++;
        }
    }

    return $anzahl;
}

/**
 * Loest eine in der Datenbank gespeicherte Upload-URL SICHER zu einem Unix-Zeitstempel auf (Aufgabe 5,
 * Schritt 1). Gemeinsamer Kern fuer die zwei Formatierer darunter (N1, Fix-Runde 2) -- eine JSON-Form
 * und eine MySQL-DATETIME-Form derselben Aufloesung, nicht zwei unabhaengige Implementierungen.
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
 * @return int|null Unix-Zeitstempel (UTC), oder null wenn die URL nicht zum erwarteten Praefix passt,
 *         die Datei fehlt (lokal: die vier Ablagen liegen nicht im Repo -- das ist der ERWARTETE
 *         Befund, kein Fehler) oder filemtime() scheitert.
 */
function avesmapsMediaLicenseUploadTimestampFromUrl(string $url, string $erwartetesPraefix): ?int
{
    $url = trim($url);
    if ($url === '' || !str_starts_with($url, $erwartetesPraefix) || str_contains($url, '..')) {
        return null;
    }
    $pfad = (string) parse_url($url, PHP_URL_PATH);
    if ($pfad === '' || str_contains($pfad, '..')) {
        return null;
    }

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 2)), '/');
    $realBasis = realpath($docroot . $erwartetesPraefix);
    $realZiel = realpath($docroot . $pfad);
    if ($realBasis === false || $realZiel === false || !str_starts_with($realZiel, $realBasis . DIRECTORY_SEPARATOR)) {
        return null; // lokal: die Ablage existiert nicht -- "0 Datumsangaben" ist hier richtig
    }

    $zeit = @filemtime($realZiel);
    return $zeit === false ? null : $zeit;
}

/**
 * ISO-8601 in UTC -- fuer die JSON-Flaechen (properties_json.coat.uploaded_at,
 * properties_json.images[].uploaded_at; settlement_coat/settlement_image). JSON kennt kein natives
 * Datumsformat; ISO-8601 mit explizitem 'Z' ist hier Konvention, maschinenlesbar und
 * zeitzonen-eindeutig -- und es gibt keine Spalten-Typpruefung, die dagegen protestieren koennte.
 */
function avesmapsMediaLicenseUploadDateFromUrl(string $url, string $erwartetesPraefix): string
{
    $zeit = avesmapsMediaLicenseUploadTimestampFromUrl($url, $erwartetesPraefix);
    return $zeit === null ? '' : gmdate('Y-m-d\TH:i:s\Z', $zeit);
}

/**
 * MySQL-DATETIME-Form (kein 'T', kein 'Z') -- fuer die drei SPALTEN-Flaechen: adventure.
 * cover_uploaded_at (app/game-literature.php:112) sowie citymap.map_uploaded_at/thumb_uploaded_at
 * (app/citymaps.php:341/344). Alle drei sind DATETIME-Spalten, keine JSON-Blobs.
 *
 * 🔴 N1 der zweiten Pruefrunde: MySQL akzeptiert 'T' nicht als Trenner und das angehaengte 'Z' erst
 * recht nicht -- unter strict mode Fehler 1292, und seit der Transaktion aus Fix-Runde 1 reisst das
 * den GANZEN Lauf per Rollback ab; ohne strict mode eine STILLE Kuerzung (AGENTS §10: von "nie
 * gespeichert" nicht zu unterscheiden). Gemessen von der Pruefung: `'2026-08-16T14:54:17Z'` landete
 * in `cover_uploaded_at`. Lokal war dieser Pfad ungetestet, weil die Test-Fixture TEXT-Spalten
 * benutzt und sqlite jeden String anstandslos schluckt -- die Divergenz wurde erst hier sichtbar.
 */
function avesmapsMediaLicenseUploadDatetimeFromUrl(string $url, string $erwartetesPraefix): string
{
    $zeit = avesmapsMediaLicenseUploadTimestampFromUrl($url, $erwartetesPraefix);
    return $zeit === null ? '' : gmdate('Y-m-d H:i:s', $zeit);
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
 * sein. Bei mehreren passenden Zeilen je (Ort, URL) gewinnt die LETZTE (hoechstes created_at zuerst
 * durch die ORDER BY, dann durch die Ueberschreibung im Array): sie beschreibt das juengste
 * Hochladeereignis fuer GENAU dieses Bild.
 *
 * 🔧 N2 (Fix-Runde 2): schluesselt jetzt nach (feature_id, coat.url) statt nur feature_id. Vorher bekam
 * JEDES Wappen dieser Zeile den zuletzt geloggten Namen -- auch, wenn das Wappen inzwischen laengst
 * ersetzt wurde (reproduziert von der Pruefung: ein Ort mit einem inzwischen andersartigen Wiki-Wappen
 * bekam trotzdem den Namen des alten Eigen-Uploads zugeschrieben, ein ERFUNDENER Nachweis -- nicht die
 * seltene Verwechslung unter mehreren Eigen-Uploads, die dieser Docblock vorher beschrieb). Der
 * Aufrufer (avesmapsMediaLicenseCollectSettlementCoats) gleicht jetzt die HEUTIGE coat.url gegen die
 * im Protokoll geloggte ab; nur bei Uebereinstimmung gilt der Name als Nachweis fuer DIESES Bild.
 *
 * 🔧 N4 (Fix-Runde 2): `fetch()` in einer Schleife statt `fetchAll()` -- das Audit-Log kann bei Wegen/
 * Regionen volle geometry_json-Schnappschuesse tragen, `fetchAll` haette das komplette Ergebnis im
 * Speicher gehalten. Und: wird jetzt EINMAL JE LAUF aufgerufen (von avesmapsMediaLicenseMigrationRun()
 * durchgereicht), nicht mehr einmal je Sammleraufruf/Fenster -- bei ~4.653 Orten und batch_limit 200
 * waren das rund 24 unnoetige Vollabzuege in einem Lauf.
 *
 * @return array<int, array<string, string>> feature_id => [coat.url => Benutzername]; nur belegte
 *         Treffer. Ein bekannter Akteur ohne aufloesbaren Benutzernamen (z. B. actor_user_id =
 *         0/Import) liefert '' -- "leer heisst leer", kein erfundener Platzhaltername.
 */
function avesmapsMediaLicenseCollectSettlementCoatUploaders(PDO $pdo): array
{
    $ergebnis = [];
    $statement = $pdo->query(
        "SELECT audit.feature_id, audit.before_json, audit.after_json, users.username
         FROM map_audit_log audit
         LEFT JOIN users ON users.id = audit.actor_user_id
         WHERE audit.action = 'wiki_sync_update_point'
         ORDER BY audit.created_at ASC, audit.id ASC"
    );
    if ($statement === false) {
        return [];
    }

    while (($zeile = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
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
        $afterUrl = trim((string) ($afterCoat['url'] ?? ''));
        $warSchonEigenesMitGleicherUrl = is_array($beforeCoat)
            && ($beforeCoat['source'] ?? '') === 'own'
            && (string) ($beforeCoat['url'] ?? '') === $afterUrl;
        if ($warSchonEigenesMitGleicherUrl) {
            continue; // kein Hochladeereignis -- schon vorher 'own' mit derselben URL
        }

        $featureId = (int) ($zeile['feature_id'] ?? 0);
        if ($featureId <= 0 || $afterUrl === '') {
            continue;
        }
        $ergebnis[$featureId][$afterUrl] = trim((string) ($zeile['username'] ?? ''));
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
 * 🔧 Fix-Runde 2: `$uploaderNamen` kommt jetzt als PARAMETER (N4 -- einmal je Lauf gebaut, nicht mehr
 * einmal je Fensteraufruf hier selbst geholt) und ist nach (feature_id, coat.url) geschluesselt (N2 --
 * der Lookup unten prueft explizit gegen die HEUTIGE URL dieser Zeile, nicht nur gegen die feature_id).
 *
 * 🔧 Fix-Runde 2, Runde 1 unveraendert: 'schreiben' bleibt weg -- 'zeile' (die map_features.id) +
 * 'anwenden' (eine reine In-Speicher-Mutation auf einem FRISCH gelesenen $props, das der Aufrufer
 * bereitstellt) ersetzen es (Critical 3 der ersten Pruefrunde).
 *
 * @param array<int, array<string,string>> $uploaderNamen feature_id => [coat.url => Benutzername]
 * @return array{funde: list<array{id: int, alt: string, protokoll_neu: array<string,string>, zeile: int,
 *         anwenden: callable}>, sonderfaelle: list<array{flaeche: string, id: string, url: string}>,
 *         protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int}, gelesen: int,
 *         naechster_cursor: int|null, offen: bool}
 */
function avesmapsMediaLicenseCollectSettlementCoats(PDO $pdo, int $limit, int $cursor = 0, array $uploaderNamen = []): array
{
    $statement = $pdo->prepare(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"coat\"%' AND id > :cursor
         ORDER BY id ASC LIMIT " . $limit
    );
    $statement->execute(['cursor' => $cursor]);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $funde = [];
    $sonderfaelle = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    $letzteId = $cursor;
    foreach ($zeilen as $zeile) {
        $letzteId = max($letzteId, (int) $zeile['id']);
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
        // N2: nur ein Treffer unter der HEUTIGEN url gilt -- ein Protokolleintrag ueber ein laengst
        // ersetztes Wappen (andere URL) darf keinen Namen liefern.
        $neuerName = $vorhandenerName === '' ? trim((string) ($uploaderNamen[$id][$url] ?? '')) : '';
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
            'zeile' => $id,
            'anwenden' => static function (array &$props, string $neu, array $protokollNeu): void {
                $props['coat']['license_status'] = $neu;
                foreach ($protokollNeu as $feld => $wert) {
                    $props['coat'][$feld] = $wert;
                }
            },
        ];
    }

    $offen = count($zeilen) === $limit;

    return ['funde' => $funde, 'sonderfaelle' => $sonderfaelle, 'protokoll' => $protokoll,
            'gelesen' => count($zeilen), 'naechster_cursor' => $offen ? $letzteId : null, 'offen' => $offen];
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
 * 🔧 Fix 1 der ersten Pruefrunde: die Override-Abfrage verglich `metadata_overrides_json <> ''` --
 * diese Spalte ist eine MySQL-JSON-Spalte (sync-monitor.php:87), und MySQL wandelt den
 * Nicht-JSON-Operanden vor dem Vergleich um: `CAST('' AS JSON)` ist `ERROR 3141` (leeres Dokument).
 * Der Sammler waere unter der echten Datenbank IMMER gescheitert. Ersatzlos gestrichen -- `IS NOT
 * NULL` reicht (dieselben zwei Zeilen wie coat-url.php:128, sync-monitor-identity.php:395: eine
 * JSON-Spalte kann `''` gar nicht halten).
 *
 * 🔧 Fix 2 der ersten Pruefrunde: `id > :cursor ORDER BY id ASC LIMIT` je Teilabfrage -- ohne das
 * lieferte jeder Aufruf dieselben ersten batch_limit Zeilen, und eine bereits migrierte Zeile verlaesst
 * die Menge nicht. Zwei unabhaengige Fenster (Staging, Override), deshalb ein Cursor-Paar statt eines
 * einzelnen Werts.
 *
 * @return array{funde: list<array{id: string, alt: string, schreiben: callable}>, sonderfaelle: list<never>,
 *         protokoll: null, gelesen: int, naechster_cursor: array{staging:int,override:int}|null, offen: bool}
 */
function avesmapsMediaLicenseCollectTerritoryCoats(PDO $pdo, int $limit, array $cursor = ['staging' => 0, 'override' => 0]): array
{
    $stagingCursor = (int) ($cursor['staging'] ?? 0);
    $overrideCursor = (int) ($cursor['override'] ?? 0);
    $funde = [];
    $gelesen = 0;

    $stagingStatement = $pdo->prepare(
        "SELECT id, wiki_key, coat_of_arms_license_status FROM political_territory_wiki_test
         WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> '' AND id > :cursor
         ORDER BY id ASC LIMIT " . $limit
    );
    $stagingStatement->execute(['cursor' => $stagingCursor]);
    $stagingZeilen = $stagingStatement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $gelesen += count($stagingZeilen);
    $stagingLetzte = $stagingCursor;
    foreach ($stagingZeilen as $zeile) {
        $stagingLetzte = max($stagingLetzte, (int) $zeile['id']);
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
    $stagingOffen = count($stagingZeilen) === $limit;

    $overrideStatement = $pdo->prepare(
        "SELECT id, wiki_key, metadata_overrides_json FROM wiki_territory_model
         WHERE metadata_overrides_json IS NOT NULL AND id > :cursor
         ORDER BY id ASC LIMIT " . $limit
    );
    $overrideStatement->execute(['cursor' => $overrideCursor]);
    $overrideZeilen = $overrideStatement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $gelesen += count($overrideZeilen);
    $overrideLetzte = $overrideCursor;
    foreach ($overrideZeilen as $zeile) {
        $overrideLetzte = max($overrideLetzte, (int) $zeile['id']);
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
    $overrideOffen = count($overrideZeilen) === $limit;

    $offen = $stagingOffen || $overrideOffen;

    return ['funde' => $funde, 'sonderfaelle' => [], 'protokoll' => null, 'gelesen' => $gelesen,
            'naechster_cursor' => $offen ? ['staging' => $stagingLetzte, 'override' => $overrideLetzte] : null,
            'offen' => $offen];
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
 * 🔧 Fix 2 der ersten Pruefrunde: `id > :cursor ORDER BY id ASC LIMIT`, resumierbar.
 *
 * 🔧 N1 der zweiten Pruefrunde: `avesmapsMediaLicenseUploadDatetimeFromUrl()` statt
 * `avesmapsMediaLicenseUploadDateFromUrl()` -- cover_uploaded_at ist eine MySQL-DATETIME-Spalte
 * (app/game-literature.php:112), keine JSON-Ablage; ISO-8601 mit 'T'/'Z' waere dort ein Fehler 1292
 * (strict mode) bzw. eine stille Kuerzung gewesen.
 *
 * @return array{funde: list<array{id: int, alt: string, schreiben: callable, protokoll_neu: array<string, string>}>,
 *         sonderfaelle: list<never>, protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int},
 *         gelesen: int, naechster_cursor: int|null, offen: bool}
 */
function avesmapsMediaLicenseCollectCovers(PDO $pdo, int $limit, int $cursor = 0): array
{
    $statement = $pdo->prepare(
        "SELECT id, cover_url, field_origins_json, cover_license, cover_uploaded_at FROM adventure
         WHERE cover_url IS NOT NULL AND cover_url <> '' AND id > :cursor
         ORDER BY id ASC LIMIT " . $limit
    );
    $statement->execute(['cursor' => $cursor]);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $funde = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    $letzteId = $cursor;
    foreach ($zeilen as $zeile) {
        $letzteId = max($letzteId, (int) $zeile['id']);
        $id = (int) $zeile['id'];
        $origins = json_decode((string) ($zeile['field_origins_json'] ?? ''), true);
        $vonWiki = is_array($origins) && (string) ($origins['cover_url'] ?? '') === 'wiki';

        $protokoll['gesamt']++;
        $vorhandenesDatum = trim((string) ($zeile['cover_uploaded_at'] ?? ''));
        $neuesDatum = $vorhandenesDatum === ''
            ? avesmapsMediaLicenseUploadDatetimeFromUrl((string) ($zeile['cover_url'] ?? ''), '/uploads/questcovers/')
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

    $offen = count($zeilen) === $limit;

    return ['funde' => $funde, 'sonderfaelle' => [], 'protokoll' => $protokoll,
            'gelesen' => count($zeilen), 'naechster_cursor' => $offen ? $letzteId : null, 'offen' => $offen];
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
 * ('anwenden' wird nie aufgerufen, weil neu === alt und protokoll_neu leer bleibt), ohne eine zweite
 * Rueckgabeform fuer diesen einen Sammler zu brauchen.
 *
 * 🔧 Aufgabe 5: uploaded_at aus /uploads/siedlungen/, NUR bei Objekt-Eintraegen (die blanken
 * URL-Strings haben keine Ablage dafuer). 💣 Das ist die Flaeche, an der die Entkopplung von Lizenz
 * und Protokoll den Unterschied macht: die Lizenz aendert sich hier praktisch nie (schon Katalogwert),
 * also wuerde ein an die Lizenz gekoppeltes 'anwenden' das Datum NIE persistieren.
 *
 * 🔧 Fix-Runde 1: 'schreiben' ist weg -- 'zeile' + 'anwenden' wie bei settlement_coat (Critical 3:
 * dieselbe map_features-Zeile kann von BEIDEN Flaechen und von MEHREREN Bildern derselben Zeile
 * betroffen sein). 'anwenden' bekommt sein $props als Parameter -- kein `use ($props)`-Schnappschuss
 * mehr, der beim Schreiben veraltet waere. `id > :cursor ORDER BY id ASC LIMIT` fuer die Resumierbarkeit.
 *
 * ⚠️ Bleibt bei der ISO-8601-Form (avesmapsMediaLicenseUploadDateFromUrl): das Datum wandert in
 * properties_json (JSON), keine DATETIME-Spalte -- N1 der zweiten Pruefrunde betrifft nur die drei
 * SPALTEN-Flaechen (cover, citymap), siehe Docblock des Formatierers.
 *
 * @return array{funde: list<array{id: string, alt: string, protokoll_neu: array<string,string>, zeile: int,
 *         anwenden: callable}>, sonderfaelle: list<never>,
 *         protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int}, gelesen: int,
 *         naechster_cursor: int|null, offen: bool}
 */
function avesmapsMediaLicenseCollectSettlementImages(PDO $pdo, int $limit, int $cursor = 0): array
{
    $statement = $pdo->prepare(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"images\"%' AND id > :cursor
         ORDER BY id ASC LIMIT " . $limit
    );
    $statement->execute(['cursor' => $cursor]);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $funde = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    $letzteId = $cursor;
    foreach ($zeilen as $zeile) {
        $letzteId = max($letzteId, (int) $zeile['id']);
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
                    'zeile' => $id,
                    'anwenden' => static function (array &$props, string $neu, array $protokollNeu) use ($index): void {
                        if (!is_array($props['images'][$index] ?? null)) {
                            return; // die Zeile hat sich seit dem Sammeln veraendert -- nichts erzwingen
                        }
                        $props['images'][$index]['license'] = $neu;
                        foreach ($protokollNeu as $feld => $wert) {
                            $props['images'][$index][$feld] = $wert;
                        }
                    },
                ];
                continue;
            }

            // Blanker URL-String: kein Objekt, keine Ablage fuer ein Protokoll. Siehe Docblock oben.
            $funde[] = [
                'id' => $id . ':' . $index,
                'alt' => 'ai_generated',
                'protokoll_neu' => [],
                'zeile' => $id,
                'anwenden' => static function (array &$props, string $neu, array $protokollNeu): void {
                    // Absichtlich leer -- wird nie aufgerufen (alt === neu === 'ai_generated', kein
                    // Protokoll moeglich).
                },
            ];
        }
    }

    $offen = count($zeilen) === $limit;

    return ['funde' => $funde, 'sonderfaelle' => [], 'protokoll' => $protokoll,
            'gelesen' => count($zeilen), 'naechster_cursor' => $offen ? $letzteId : null, 'offen' => $offen];
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
 * ⚠️ KEIN Koaleszieren noetig (anders als settlement_coat/settlement_image): map_license und
 * thumb_license sind zwei SEPARATE SPALTEN derselben Zeile, keine gemeinsame JSON-Spalte -- ein
 * UPDATE, das nur die eine Spalte nennt, laesst die andere unberuehrt. Zwei Funde derselben Zeile
 * koennen sich hier nicht gegenseitig zuruecknehmen.
 *
 * 🔧 Fix 2 der ersten Pruefrunde: `id > :cursor ORDER BY id ASC LIMIT`, resumierbar.
 *
 * 🔧 N1 der zweiten Pruefrunde: `avesmapsMediaLicenseUploadDatetimeFromUrl()` statt
 * `avesmapsMediaLicenseUploadDateFromUrl()` -- map_uploaded_at/thumb_uploaded_at sind MySQL-DATETIME-
 * Spalten (app/citymaps.php:341/344), dieselbe Begruendung wie beim Cover-Sammler oben.
 *
 * ⚠️ 'protokoll_neu' traegt hier den Schluessel 'datum' statt 'uploaded_at' (anders als bei Cover/
 * Siedlung) -- derselbe Wert, zwei Namen in dieser Datei. Nicht angeglichen: das haette den
 * Schreib-Callback unten mit angefasst, was ueber den gepruften Befund (nur das Format) hinausgegangen
 * waere; siehe Minor-Punkt im zweiten Fix-Bericht.
 *
 * @return array{funde: list<array{id: string, alt: string, schreiben: callable, protokoll_neu: array<string, string>}>,
 *         sonderfaelle: list<never>, protokoll: array{gesamt: int, datum_gefunden: int, name_gefunden: int},
 *         gelesen: int, naechster_cursor: int|null, offen: bool}
 */
function avesmapsMediaLicenseCollectCitymaps(PDO $pdo, int $limit, int $cursor = 0): array
{
    $statement = $pdo->prepare(
        'SELECT id, map_license, thumb_license, map_local_url, thumb_local_url,
                map_uploaded_at, thumb_uploaded_at FROM citymap WHERE id > :cursor
         ORDER BY id ASC LIMIT ' . $limit
    );
    $statement->execute(['cursor' => $cursor]);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $funde = [];
    $protokoll = ['gesamt' => 0, 'datum_gefunden' => 0, 'name_gefunden' => 0];
    // Slot -> [URL-Spalte, Datums-Spalte]. Karte und Vorschau sind unabhaengige Ablagen derselben
    // Zeile (Spec §3.3: "SEPARATE LICENCES" -- und damit auch separate Protokolle).
    $slots = [
        'map_license' => ['url' => 'map_local_url', 'datum' => 'map_uploaded_at'],
        'thumb_license' => ['url' => 'thumb_local_url', 'datum' => 'thumb_uploaded_at'],
    ];
    $letzteId = $cursor;
    foreach ($zeilen as $zeile) {
        $letzteId = max($letzteId, (int) $zeile['id']);
        $id = (int) $zeile['id'];
        foreach ($slots as $spalte => $info) {
            $protokoll['gesamt']++;
            $vorhandenesDatum = trim((string) ($zeile[$info['datum']] ?? ''));
            $neuesDatum = $vorhandenesDatum === ''
                ? avesmapsMediaLicenseUploadDatetimeFromUrl((string) ($zeile[$info['url']] ?? ''), '/uploads/kartensammlungen/')
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

    $offen = count($zeilen) === $limit;

    return ['funde' => $funde, 'sonderfaelle' => [], 'protokoll' => $protokoll,
            'gelesen' => count($zeilen), 'naechster_cursor' => $offen ? $letzteId : null, 'offen' => $offen];
}
