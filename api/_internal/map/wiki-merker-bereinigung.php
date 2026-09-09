<?php

declare(strict_types=1);

/**
 * DIE EINMALIGE BESTANDSREPARATUR ZUM AUSBAU VON `properties.wiki_no_article` (Schritt 4 von vier).
 * ---------------------------------------------------------------------------------------------
 * Owner-Entscheid 09.09.2026, nach Durchsicht aller 10 Traeger: der Merker faellt global -- Haekchen,
 * Feld, Leser, Schreiber und Bestandsdaten. Sein Aequivalent ist die WIKI-ZUWEISUNG: das Nest
 * `wiki_settlement` / `wiki_path` / `wiki_region` / `wiki_powerline`, NIE `properties.wiki_url`.
 * Schritt 1-3 haben Bedienelemente, Verb, Leser und Schreiber entfernt; hier faellt der Rest, der in
 * der Datenbank liegt.
 *
 * 🚩 DIE ERWARTETE ZAHL, gegen die der Trockenlauf gehalten wird: **7 Traeger** -- 2 Orte,
 * 5 Kraftliniensegmente, **0 inaktive**. LIVE gezaehlt am 09.09.2026 (Kartennutzlast, Revision
 * 119767), nicht aus dem Dump.
 * 🪤 HIER STAND „10". Das war die Zahl aus dem Dump vom 08.09.2026 -- seither haben vier Traeger
 * ihren Merker verloren (Turm Erlenbruch, Altenau, Efferding, Einhornen), weil ein Editor sie
 * zugewiesen hat. Ein Pruefagent hat den Unterschied gefunden. ⭐ Genau dafuer ist die Hausregel
 * „der Trockenlauf ist die Messung" da -- aber sie taugt nur, wenn die ERWARTUNG frisch ist:
 * gegen eine veraltete Zahl gehalten haelt der Owner an, wo nichts ist.
 * ⚠️ Weicht der echte Trockenlauf trotzdem ab, wird gemessen statt gefahren.
 *
 * 🔴 EIGENE DATEI, UND DAS IST ABSICHT: dieser Lauf ist ein GERUEST auf Zeit. Ist der Bestand
 * bereinigt und die Gegenprobe bei null, faellt er ganz -- und dann faellt EINE Datei plus EIN
 * Endpunkt, statt dass jemand Zeilen aus einer geteilten Bibliothek herausoperieren muss.
 *
 * 💣 KEIN BLINDES `UPDATE` (Owner-Wortlaut). Gelesen wird je Zeile, dekodiert, der EINE Schluessel
 * entfernt, zurueckgeschrieben -- je Zeile in einer eigenen Transaktion. Ein
 * `REPLACE(properties_json, …)` ueber die ganze Tabelle waere schneller und koennte bei einer
 * Zeile, deren JSON anders formatiert ist, lautlos etwas anderes treffen.
 *
 * 🔴 DIE `LIKE`-ABFRAGE IST DER VORFILTER, DER `json_decode` IST DER TREFFER. `properties_json LIKE
 * '%wiki_no_article%'` findet auch eine Zeile, die das Wort in einem TEXT traegt (ein Ortsname, eine
 * Beschreibung, eine Wiki-Adresse). Gezaehlt und geschrieben wird nur, wo `array_key_exists` es
 * bestaetigt. Dieselbe Trennung wie bbox-Vorfilter gegen Punkttest in „Was ist hier?" (AGENTS.md §11).
 *
 * 🔴 OHNE `is_active`-FILTER, und das ist tragend: eine weich geloeschte Zeile kann zurueckgeholt
 * werden und traegt dann einen Schluessel, den niemand mehr liest. Die Gegenprobe „0 verbleibende
 * Traeger" waere sonst nur fuer die halbe Tabelle wahr.
 *
 * 🔴 DIE ARCHIVE BLEIBEN UNBERUEHRT -- `wiki_sync_cases` (18 Zeilen), `map_feature_legacy_properties`
 * (6) und `map_audit_log` (3) tragen den Merker weiter. Ein Protokoll ist ein Archiv, sonst waere es
 * keins; `audit-detail.php` uebersetzt die historischen Zeilen darum weiterhin (AGENTS.md §11,
 * dieselbe Regel wie beim Sprungpunkt der Verlaufszeile). Angefasst wird AUSSCHLIESSLICH
 * `map_features.properties_json`.
 *
 * 🪤 `citymap.no_article` HEISST FAST GLEICH UND IST ETWAS ANDERES: eine eigene Datenbankspalte der
 * Kartensammlung mit eigenem Schreibweg, vom Ausbau ausdruecklich AUSGENOMMEN. Dieser Lauf fasst
 * `citymap` nicht an -- er liest `map_features` und sonst nichts.
 *
 * 💣 DER REVISIONS-BUMP IST NOETIG, und das ist GEMESSEN, nicht angenommen: die Kartennutzlast
 * reicht `properties` DURCH, sie projiziert nicht. Am 09.09.2026 an der Live-Nutzlast gezaehlt
 * (Revision 119767): **7 der 12.318 Objekte tragen den Schluessel sichtbar in der Nutzlast** -- und
 * das sind zugleich ALLE Traeger. Ihn zu entfernen aendert also Bytes, und ohne Bump behielte jeder
 * warme Besucher ueber sein 304 eine Nutzlast, die es so nicht mehr gibt.
 * ⚠️ Das ist der Unterschied zu Schritt 3, wo der Bump BEGRUENDET unterblieb: dort aenderte sich
 * kein einziges Byte (0 von 12.318). Dieselbe Frage, zweimal gemessen, zwei verschiedene Antworten.
 * ⭐ EIN Bump fuer den ganzen Lauf, nicht einer je Zeile -- und nur, wenn wirklich geschrieben wird.
 * Der Trockenlauf fasst `map_revision` nicht an.
 *
 * 🔴 KEIN PROTOKOLLEINTRAG, KEIN `updated_by`, KEIN `updated_at` -- die Aenderung ist hinterher
 * NICHT zurueckverfolgbar, und das ist eine Entscheidung, keine Luecke. Begruendung: geschrieben
 * wird das Entfernen eines Feldes, das kein Leser mehr kennt; ein Eintrag je Zeile im
 * `map_audit_log` haette den Aenderungsverlauf mit sieben Zeilen gefuellt, die einem Editor nichts
 * sagen ausser „hier war Wartung". Derselbe Zuschnitt wie `avesmapsPoliticalRepairGeometryBounds`.
 * ⚠️ Der BERICHT des Laufs ist damit die einzige Spur -- er nennt jede geschriebene und jede
 * uebersprungene Zeile beim Namen, und der Owner sieht ihn. Wer das aendern will, braucht einen
 * Grund: rueckgaengig machen laesst sich der Lauf ohnehin nicht (das Feld hat keinen Wert mehr).
 * 🚩 Ein Pruefagent hat den Punkt als „ohne Wertung" gemeldet -- er stand nirgends geschrieben,
 * und ein ungeschriebener Entscheid ist von einem Versehen nicht zu unterscheiden.
 *
 * ⚠️ `updated_at` BLEIBT STEHEN (`updated_at = updated_at`), wie bei `repair_geometry_bounds`: diese
 * Reparatur ist keine inhaltliche Aenderung durch einen Menschen, und die Spalte beantwortet „wann
 * hat zuletzt jemand etwas entschieden".
 *
 * 💣 DEKODIERT WIRD ALS OBJEKT, NICHT ALS ARRAY -- und kodiert MIT `JSON_PRESERVE_ZERO_FRACTION`.
 * `json_decode($s, true)` + `json_encode` ist KEIN Roundtrip; drei Abweichungen sind gemessen
 * (09.09.2026), und sie sind VORSORGE, nicht Reparatur -- keine trifft heute einen Traeger:
 *   · `{"a":{}}` wird `{"a":[]}` -- ein leeres Objekt kommt als leeres ARRAY zurueck. 🚩 Am Bestand
 *     gezaehlt: KEIN Traeger traegt ein leeres verschachteltes Objekt.
 *   · `{"wiki_no_article":true}` allein wuerde nach dem Entfernen zu `[]` statt `{}` -- die ganze
 *     Ablage waere ein JSON-ARRAY, wo jeder Leser ein Objekt erwartet. 🚩 KEIN Traeger hat nur
 *     diesen einen Schluessel. 🪤 HIER STAND „genau diese Form ist der Normalfall" -- das war
 *     ungemessen und falsch; ein Pruefagent hat es widerlegt.
 *   · `{"curve":26.0}` wird `{"curve":26}` ohne `JSON_PRESERVE_ZERO_FRACTION`. 🚩 Und auch das ist
 *     Vorsorge: `curve` steht in 2 von 43.807 Ablagen, dort als GANZZAHL (`-9`), und im ganzen
 *     `map_features` gibt es NULL Zahlen der Form `X.0`. Hier stand „die Kraftlinien tragen `curve`
 *     als Gleitkommazahl, und 5 der 10 Traeger sind Kraftliniensegmente" -- der erste Halbsatz ist
 *     falsch, der zweite hat mit `curve` nichts zu tun.
 * ⭐ Die drei Vorkehrungen bleiben trotzdem: sie kosten nichts und decken Formen ab, die entstehen
 * KOENNEN. Was faellt, ist die Behauptung, sie seien schon noetig -- „gemessen" muss gemessen heissen.
 * ⚠️ Deshalb wird hier NICHT `avesmapsEncodeJson()` benutzt, obwohl es der Hausschreiber ist: ihm
 * fehlt das Flag. Es ihm zu geben waere ein Eingriff in JEDEN Schreibweg der Karte -- unbestellt und
 * ungemessen. Die drei uebrigen Flags sind zeichengleich seine.
 *
 * 💣 DER RIEGEL VERGLEICHT NICHT BYTES, UND DAS IST DER TEUERSTE BEFUND DIESES SCHRITTS.
 * Die erste Fassung verglich den neu kodierten String byte-genau gegen den gespeicherten und lehnte
 * jede Abweichung ab. 🚩 Am Dump gemessen: **10.029 von 43.807** Ablagen stehen in der WEITEN Form
 * (`{"a": "b"}`, Leerzeichen nach `:` und `,`) -- die `json_encode` NIE erzeugt --, darunter
 * **5 der 11 Traeger**. Der Riegel haette also die Mehrheit der Arbeit verweigert, der Lauf
 * `failed` gemeldet, und die Gegenprobe „0 verbleibende Traeger" waere nie erreichbar gewesen.
 * ⚠️ Und kein Test haette es gezeigt: alle Fixtures standen in der engen Form.
 * 🪤 Der naheliegende Flicken -- den Leerraum per Regex normalisieren -- ist die naechste Falle: ein
 * `(?<=[:,])\s+` schneidet in ZEICHENKETTEN hinein („Ochsenweide (am Bodrin)"). Wer so vergleichen
 * will, braucht einen echten JSON-Tokenizer.
 * ⭐ Stattdessen wird die EINE Klasse gemessen, die wirklich verlustbehaftet ist: eine Ganzzahl
 * jenseits von `PHP_INT_MAX` kommt als Gleitkommazahl zurueck. Sie laesst sich exakt erkennen,
 * indem man dieselbe Ablage ZWEIMAL dekodiert -- einmal normal, einmal mit `JSON_BIGINT_AS_STRING`
 * -- und die Stellen sucht, an denen die eine Fassung `float` und die andere `string` traegt.
 * Leerraum, Schluesselreihenfolge und Zeichenkodierung sind dem Vergleich damit gleichgueltig.
 *
 * 💣 KEIN `Ensure`-HELFER IN DER TRANSAKTION -- hier braucht es gar keinen: `map_features` und
 * `map_revision` stehen laengst. Der Hinweis steht trotzdem, weil er den Landschafts-Umzug am
 * 03.09.2026 489 Fehlschlaege gekostet hat: DDL committet in MySQL implizit, und `commit()` warf
 * danach „There is no active transaction", obwohl alles umgezogen war.
 */

/**
 * Findet die erste Stelle, an der `json_decode` eine ZAHL verloren hat -- oder `null`, wenn keine.
 *
 * 🔴 Verglichen werden zwei Dekodierungen DERSELBEN Ablage: die normale und eine mit
 * `JSON_BIGINT_AS_STRING`. Wo die eine `float` und die andere `string` traegt, stand im Text eine
 * Ganzzahl jenseits von `PHP_INT_MAX` -- sie kaeme beim Zurueckschreiben als `1.2345678901234567e+19`
 * heraus. Das ist die einzige Klasse, die der Zyklus wirklich verliert; Leerraum und
 * Schluesselreihenfolge sind ihm gleichgueltig, und genau darauf ist der Riegel angewiesen
 * (10.029 von 43.807 Ablagen stehen in der weiten Form).
 *
 * ⚠️ Rein: keine Datenbank, kein Zustand. Gefahren wird sie ueber die Traeger, nicht ueber alles.
 */
function avesmapsWikiMerkerZahlVerlust(mixed $normal, mixed $alsText, string $pfad = ''): ?string {
    if (is_float($normal) && is_string($alsText)) {
        return ($pfad === '' ? '(Wurzel)' : $pfad) . ' = ' . $alsText;
    }
    if ($normal instanceof stdClass && $alsText instanceof stdClass) {
        foreach (get_object_vars($normal) as $schluessel => $wert) {
            $tiefer = avesmapsWikiMerkerZahlVerlust(
                $wert,
                $alsText->{$schluessel} ?? null,
                $pfad === '' ? (string) $schluessel : $pfad . '.' . $schluessel
            );
            if ($tiefer !== null) {
                return $tiefer;
            }
        }

        return null;
    }
    if (is_array($normal) && is_array($alsText)) {
        foreach ($normal as $i => $wert) {
            $tiefer = avesmapsWikiMerkerZahlVerlust($wert, $alsText[$i] ?? null, $pfad . '[' . $i . ']');
            if ($tiefer !== null) {
                return $tiefer;
            }
        }
    }

    return null;
}

/**
 * Zaehlt die Traeger und -- nur mit `$trockenlauf = false` -- raeumt sie weg.
 *
 * @return array{
 *     ok: bool, dry_run: bool, total: int, per_type: array<string, int>, inactive: int,
 *     like_treffer: int, sample: list<array{public_id:string, feature_type:string, name:string, is_active:int}>,
 *     done: int, failed: list<array{public_id:string, error:string}>, remaining: int, revision: ?int
 * }
 */
function avesmapsWikiMerkerBereinigen(PDO $pdo, bool $trockenlauf = true, int $limit = 200): array {
    $limit = max(1, min(2000, $limit));

    // ⚠️ Der Vorfilter laeuft ueber den Index-losen `LIKE`; bei rund 12.000 Zeilen ist das EIN
    // Tabellenlauf und damit billiger als jede Alternative, die `properties_json` zerlegt.
    $lesen = $pdo->query(
        "SELECT id, public_id, name, feature_type, is_active, revision, properties_json
           FROM map_features
          WHERE properties_json LIKE '%wiki_no_article%'
          ORDER BY id ASC"
    );
    $zeilen = $lesen === false ? [] : ($lesen->fetchAll(PDO::FETCH_ASSOC) ?: []);

    $traeger = [];
    foreach ($zeilen as $zeile) {
        // ⚠️ ALS OBJEKT (`false`), nicht als Array -- siehe Kopf: sonst wird aus `{}` ein `[]`.
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), false);
        if (!$props instanceof stdClass || !property_exists($props, 'wiki_no_article')) {
            continue; // der `LIKE` hat einen Text getroffen, keinen Schluessel
        }
        $traeger[] = [
            'id' => (int) $zeile['id'],
            'public_id' => (string) $zeile['public_id'],
            'name' => (string) ($zeile['name'] ?? ''),
            'feature_type' => (string) ($zeile['feature_type'] ?? ''),
            'is_active' => (int) ($zeile['is_active'] ?? 1),
            'properties' => $props,
            'roh' => (string) ($zeile['properties_json'] ?? ''),
            // 💣 Fuer den Riegel gegen den VERLORENEN SCHREIBVORGANG (siehe unten).
            'revision' => (int) ($zeile['revision'] ?? 0),
        ];
    }

    $jeTyp = [];
    $inaktiv = 0;
    foreach ($traeger as $t) {
        $jeTyp[$t['feature_type']] = ($jeTyp[$t['feature_type']] ?? 0) + 1;
        if ($t['is_active'] !== 1) {
            $inaktiv++;
        }
    }

    $ergebnis = [
        'ok' => true,
        'dry_run' => $trockenlauf,
        'total' => count($traeger),
        'per_type' => $jeTyp,
        'inactive' => $inaktiv,
        // ⭐ Die Differenz zu `total` sagt, wie viele Zeilen das Wort nur im TEXT tragen. Steht hier
        // eine grosse Zahl, ist der Vorfilter zu grob geworden -- und das will man sehen, nicht raten.
        'like_treffer' => count($zeilen),
        'sample' => array_map(
            static fn (array $t): array => [
                'public_id' => $t['public_id'],
                'feature_type' => $t['feature_type'],
                'name' => $t['name'],
                'is_active' => $t['is_active'],
            ],
            array_slice($traeger, 0, 20)
        ),
        'done' => 0,
        'failed' => [],
        'remaining' => count($traeger),
        'revision' => null,
    ];
    if ($trockenlauf) {
        return $ergebnis;
    }

    // 💣 `AND revision = :erwartet` IST DER RIEGEL GEGEN DEN VERLORENEN SCHREIBVORGANG, und ohne ihn
    // hat dieser Lauf ein echtes Loch: gelesen wird EINMAL vor der Schleife, geschrieben wird danach
    // die GANZE Ablage aus diesem Schnappschuss zurueck. Speichert ein Editor waehrenddessen dasselbe
    // Objekt, macht der Lauf seine Aenderung wortlos rueckgaengig und meldet Erfolg -- vorgefuehrt
    // von einem Pruefagenten an einer echten Fixture.
    // ⚠️ Kein `FOR UPDATE`: das haelt eine Sperre ueber den ganzen Lauf und ist auf SQLite nicht
    // pruefbar. Die optimistische Form ist portabel, kostet nichts und meldet den Fall, statt ihn
    // zu verschlucken -- dieselbe Wahl wie beim portablen Upsert-Ersatz der eigenen Knoten.
    // ⭐ Der VORABGLEICH: steht die Zeile noch auf der Revision des Schnappschusses? Er kostet je
    // Traeger eine winzige indizierte Abfrage (bei sieben Zeilen: nichts) und spart den Fall, in dem
    // der Lauf `map_revision` bumpt, obwohl er gleich an jeder Zeile scheitert -- die ~3,2 MB
    // Nutzlast fuer jeden warmen Besucher, fuer null geaenderte Bytes.
    // ⚠️ Er ERSETZT den `AND revision`-Riegel im UPDATE nicht: zwischen Abgleich und Schreibvorgang
    // bleibt ein Fenster, und nur das UPDATE selbst schliesst es wirklich. Zwei Reihen, verschiedene
    // Aufgaben -- die erste spart den unnoetigen Bump, die zweite verhindert den Datenverlust.
    $pruefen = $pdo->prepare('SELECT revision FROM map_features WHERE id = :id');

    $schreiben = $pdo->prepare(
        'UPDATE map_features
            SET properties_json = :pj, revision = :rev, updated_at = updated_at
          WHERE id = :id AND revision = :erwartet'
    );

    $revision = null;
    foreach (array_slice($traeger, 0, $limit) as $t) {
        try {
            $props = clone $t['properties'];
            unset($props->wiki_no_article);
            // 🔴 EIGENE FLAGS: die drei des Hauses plus JSON_PRESERVE_ZERO_FRACTION (siehe Kopf).
            $neu = json_encode(
                $props,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION
            );

            // 💣 DER RIEGEL GEGEN DEN ZAHLENVERLUST -- siehe Kopf. Er misst die EINE Klasse, die der
            // Dekodier-Zyklus wirklich verliert, und ist gegen Leerraum blind (das muss er sein).
            $verlust = avesmapsWikiMerkerZahlVerlust(
                $t['properties'],
                json_decode($t['roh'], false, 512, JSON_BIGINT_AS_STRING)
            );
            if ($verlust !== null) {
                throw new RuntimeException(
                    'Die Ablage traegt eine Zahl, die einen Dekodier-Zyklus nicht unveraendert '
                    . 'ueberlebt -- hier wird nichts geschrieben. Stelle: ' . $verlust
                );
            }

            $pruefen->execute(['id' => $t['id']]);
            $jetzt = $pruefen->fetchColumn();
            if ($jetzt === false) {
                throw new RuntimeException('Die Zeile existiert nicht mehr -- uebersprungen.');
            }
            if ((int) $jetzt !== $t['revision']) {
                throw new RuntimeException(
                    'Die Zeile wurde waehrend des Laufs von jemand anderem geschrieben (erwartete '
                    . 'Revision ' . $t['revision'] . ', gefunden ' . (int) $jetzt . ') -- uebersprungen. '
                    . 'Ein zweiter Lauf holt sie.'
                );
            }

            // 💣 ERST HIER DIE REVISION, NACH dem Riegel -- und das war ein Befund, kein Detail: sie
            // stand davor, also bumpte ein Lauf, an dem JEDE Zeile am Riegel scheitert, trotzdem
            // `map_revision` und machte die 3,2 MB Nutzlast fuer jeden warmen Besucher ungueltig,
            // ohne ein einziges Byte zu aendern. Der Nachbar im Haus
            // (avesmapsEcosystemPushWikiRegionToLabels) zieht ihn ebenfalls erst hinter den
            // „nichts zu tun"-Riegel.
            // ⚠️ Und AUSSERHALB der Transaktion, weil sie selbst schreibt.
            $revision ??= avesmapsNextMapRevision($pdo);

            $pdo->beginTransaction();
            $schreiben->execute([
                'pj' => $neu,
                'rev' => $revision,
                'id' => $t['id'],
                'erwartet' => $t['revision'],
            ]);
            // 💣 `rowCount() === 0` HEISST: DIE ZEILE HAT SICH BEWEGT. Ohne diese Pruefung zaehlte
            // ein Schreibvorgang, der gar keine Zeile getroffen hat, als Erfolg -- und der Bericht,
            // der die einzige Abnahme dieses Laufs ist, waere eine Luege.
            if ($schreiben->rowCount() === 0) {
                $pdo->rollBack();
                throw new RuntimeException(
                    'Die Zeile wurde waehrend des Laufs von jemand anderem geschrieben (erwartete '
                    . 'Revision ' . $t['revision'] . ') oder existiert nicht mehr -- uebersprungen. '
                    . 'Ein zweiter Lauf holt sie.'
                );
            }
            $pdo->commit();
            $ergebnis['done']++;
        } catch (Throwable $e) {
            // 🔴 GEMELDET, NICHT GESCHLUCKT. Ein verschluckter SQL-Fehler saehe exakt aus wie
            // „nichts zu bereinigen" -- und genau dieser Bericht ist die Abnahme des Laufs.
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $ergebnis['failed'][] = ['public_id' => $t['public_id'], 'error' => $e->getMessage()];
        }
    }
    $ergebnis['remaining'] = count($traeger) - $ergebnis['done'];
    $ergebnis['revision'] = $revision;

    return $ergebnis;
}
