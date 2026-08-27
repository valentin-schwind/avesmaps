<?php

declare(strict_types=1);

// Der Garetien-Import fuellt die VORHANDENE Uebernahme-Vorschau.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5
//
// 🔴 ES WIRD KEINE ZWEITE VORSCHAU GEBAUT. `sync_plan_run`/`sync_plan_item` und
// `js/review/sync-plan-sheet.js` bekommen eine weitere Art -- dieselbe Lehre wie beim
// Quellensystem, wo eine zweite Tabelle eine Migration gekostet hat (AGENTS.md §5).
//
// 🔴 UND ES SCHREIBT IN KEINE NUTZTABELLE. Das Rechnen ist von der Uebernahme getrennt; die
// Zusicherung gilt fuer jeden Sync-Lauf im Haus (sync-plan-purity-test.php).

require_once __DIR__ . '/garetien-abgleich.php';
require_once __DIR__ . '/garetien-abruf.php';
require_once __DIR__ . '/../wiki/sync-plan.php';

/** Die Art, unter der dieser Import in der Vorschau steht. */
const AVESMAPS_GARETIEN_PLAN_KIND = 'garetien';

/**
 * Der Objekt-Schluessel EINER Staging-Zeile. REIN -- kein I/O.
 *
 * 🔴 RULING P6: diese Formel entsteht HIER und wird von `avesmapsGaretienPlanEintrag` benutzt,
 * nicht abgeschrieben. Eine spaetere Aufgabe (die Arbeitsliste des Fensters) muss denselben
 * Schluessel aus einer Staging-Zeile nachbauen koennen, um Vorschlaege und urteilslose Zeilen
 * demselben Objekt zuzuordnen -- zwei Formeln liefen beim ersten Sonderzeichen auseinander, und
 * dann stuende dasselbe Objekt zweimal in der Liste.
 */
function avesmapsGaretienObjektSchluesselAusZeile(array $zeile): string
{
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');
    $seite = ($namensraum !== '' ? $namensraum . ':' : '') . $artikel;

    return $wiki . ':' . $zeile['ebene'] . ':' . $zeile['typ'] . ':'
        . ($seite !== '' ? $seite : ('#' . $zeile['zeile_nr']));
}

/**
 * Die Wiki-Adresse EINER Staging-Zeile -- der Artikel-Link, oder ohne Artikel die Sammelquelle
 * (der Wirt allein). REIN -- kein I/O.
 *
 * 🔴 DIESELBE LEHRE WIE RULING P6 BEIM OBJEKTSCHLUESSEL (Review I2, 27.08.2026): diese Formel
 * entsteht HIER und wird von `avesmapsGaretienPlanEintrag` UND der Arbeitsliste des Fensters
 * benutzt, nicht ein zweites Mal gebaut. Eine zweite Fassung stand kurz in `garetien-liste.php`
 * und war Zeile fuer Zeile dieselbe Rechnung -- mit dem Preis, dass die zwei Wirt-Literale
 * zweimal im Repo standen und die `$namensraum:$artikel`-Bildung dreimal (hier, dort, im
 * Objektschluessel). Eine Aenderung an einem der beiden Wirte haette sonst nur EINE der beiden
 * Stellen erreicht.
 */
function avesmapsGaretienSeitenUrlAusZeile(array $zeile): string
{
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');
    $seite = ($namensraum !== '' ? $namensraum . ':' : '') . $artikel;
    // 🔴 Ohne Artikel gibt es keinen Objektlink, sondern die Sammelquelle (Entwurf §5.3).
    $wirt = $wiki === 'kosch' ? 'https://www.koschwiki.de' : 'https://www.garetien.de';
    if ($seite === '') {
        return $wirt;
    }
    $basis = $wiki === 'kosch' ? AVESMAPS_GARETIEN_BASIS_KOSCH : AVESMAPS_GARETIEN_BASIS_GGP;

    return $basis . str_replace(' ', '_', $seite);
}

/**
 * Aus einer Staging-Zeile und ihrem Urteil einen Vorschlag bauen. REIN -- kein I/O.
 *
 * `after` traegt alles, was die Uebernahme braucht: Zielart, Geometrie IN UNSEREN
 * KARTENEINHEITEN, Name und Quelle. 💣 Die Geometrie wird HIER gewandelt und nicht erst beim
 * Uebernehmen: Wagenhalt-Zahlen gehen bis in die Hunderttausende, unsere Karte ist 0..1024 --
 * eine ungewandelte Geometrie faellt nirgends auf, sie landet nur weit ausserhalb, und das
 * Objekt sieht danach niemand wieder.
 */
function avesmapsGaretienPlanEintrag(array $zeile, array $ziel, array $urteil): array
{
    $punkte = avesmapsGaretienZeilePunkte($zeile);
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');

    // 🔴 DIE BESCHRIFTUNG NENNT DAS BRIEFSPIEL, DIE ADRESSE DEN ARTIKEL (Owner 27.08.2026:
    // „wichtig ist auch die kategorie der quelle ... beispiel Briefspiel (Weiden)"). Das ist die
    // Form, die das Haus fuer Briefspielquellen seit langem fuehrt -- „Albernisches Briefspiel"
    // zeigt auf westlande.de/…/Falkenhain, „Briefspiel (Weiden)" auf
    // herzogtum-weiden.net/…/hzgl-altentrallop. Der Artikelname geht dabei nicht verloren, er
    // steht im Link (avesmapsGaretienSeitenUrlAusZeile).
    $quellenTitel = $wiki === 'kosch' ? 'Briefspiel (Kosch)' : 'Briefspiel (Garetien)';
    // 🔴 Lizenz und Namensnennung reisen als DATEN mit (Owner 27.08.2026), nicht als Regel im
    // Renderer. Der Wortlaut ist seiner: "VolkoV / garetien.de" fuer die Inhalte aus Garetien,
    // "VolkoV / koschwiki.de" fuer den Kosch.
    $namensnennung = $wiki === 'kosch' ? 'VolkoV / koschwiki.de' : 'VolkoV / garetien.de';

    // 🔴 EIN ZUFLUSS IST EIN NEUES OBJEKT, KEINE AENDERUNG AN UNSEREM FLUSS (Owner 27.08.2026).
    // 34 der 37 Widersprueche sind Baeche, die auf ihrem Hauptfluss liegen. Als 'changed' mit
    // unserem Fluss als Ziel wuerde die Uebernahme dessen Geometrie mit der des Seitenarms
    // ueberschreiben -- und 'changed' kommt nach der Hausregel VORANGEHAKT, ein Klick auf
    // "alle uebernehmen" waere also destruktiv. Sie sind deshalb 'new', tragen unseren
    // Nachbarn nur als ANGABE mit (nicht als Ziel!) und starten UNGEHAKT: die Owner-Regel vom
    // 16.08.2026 -- vorangehakt ist nur das Fuellen einer Luecke, alles andere mit Grund.
    $zufluss = ($urteil['anlass'] ?? null) === 'zufluss';
    $istNeu = $urteil['status'] === 'neu' || $zufluss;
    $nachbar = $urteil['treffer_name'] !== null && $zufluss
        ? ' · liegt auf "' . $urteil['treffer_name'] . '"'
        : '';

    return [
        'entity_key' => avesmapsGaretienObjektSchluesselAusZeile($zeile),
        // 💣 Beim Zufluss NULL: ein entity_public_id ist fuer die Uebernahme das ZIEL, nicht
        // eine Bemerkung. Stuende unser Fluss hier, waere die Zeile trotz 'new' wieder ein
        // Schreibzugriff auf ihn.
        'entity_public_id' => $zufluss ? null : $urteil['treffer_public_id'],
        'change_type' => $istNeu ? 'new' : 'changed',
        'label' => trim((string) ($zeile['anzeige'] ?? '')) . ' (' . $zeile['typ'] . ')' . $nachbar,
        'before' => ($zufluss || $urteil['treffer_public_id'] === null) ? [] : [
            'public_id' => $urteil['treffer_public_id'],
            'name' => $urteil['treffer_name'],
        ],
        'after' => [
            'herkunft' => 'garetien',
            'wiki' => $wiki,
            // ⚠️ Der Filter „Ebene · 18" der spaeteren Arbeitsliste liest DIESES Feld -- sie aus
            // dem entity_key zurueckzuparsen waere eine zweite Wahrheit ueber dasselbe Feld.
            'ebene' => $zeile['ebene'],
            'typ' => $zeile['typ'],
            'ziel' => $ziel['ziel'],
            'subtyp' => $ziel['subtyp'],
            'kind' => $ziel['kind'],
            'name' => trim((string) ($zeile['anzeige'] ?? '')),
            'geometry' => [
                'type' => $ziel['ziel'] === 'path' ? 'LineString' : 'Polygon',
                // Eine Flaeche ist ein RING: die Punktliste liegt eine Ebene tiefer.
                'coordinates' => $ziel['ziel'] === 'path' ? $punkte : [$punkte],
            ],
            'quelle' => [
                'url' => avesmapsGaretienSeitenUrlAusZeile($zeile),
                'label' => $quellenTitel,
                'source_type' => 'briefspiel',
                'origin' => 'garetien',
                'license' => 'cc-by-nc-sa-3.0',
                'attribution' => $namensnennung,
            ],
            'urteil' => $urteil['grund'],
            'anlass' => $urteil['anlass'],
            // Nur eine ANGABE fuer den Menschen, der die Zeile ansieht -- nie ein Ziel.
            'nachbar' => $zufluss ? $urteil['treffer_name'] : null,
        ],
        'override' => [],
        // 🔴 Ein Zufluss startet UNGEHAKT, mit dem Grund in der Beschriftung. Alles andere
        // folgt der Hausregel avesmapsSyncPlanDefaultSelected.
        'vorwahl_aus' => $zufluss,
    ];
}

/**
 * Laeuft ihr Objekt ueber EINES von uns oder ueber mehrere?
 *
 * 💣 DAS IST DER UNTERSCHIED ZWISCHEN GARDEL UND REICHSSTRASSE 3, und ohne ihn ist einer von
 * beiden falsch. Ihre "Natter" trifft Natter, Gardel und Darpat -- drei Namen, also laeuft ihr
 * Objekt ueber mehrere unserer; den Gardel "Natter" zu nennen waere falsch. Ihre "Angbarer
 * Reichsstrasse" trifft sechsmal "Reichsstrasse 3" -- EIN Name, also ist es unser Objekt, und
 * die Umbenennung ist genau die Frage, die der Owner gestellt hat.
 *
 * ⚠️ Leere Namen zaehlen NICHT mit: eine Luecke ist kein zweiter Name. Barun-Ulah traegt seinen
 * Namen siebenmal und hat eine Luecke -- das ist EIN Objekt.
 */
function avesmapsGaretienEinObjekt(array $abschnitte): bool
{
    $namen = [];
    foreach ($abschnitte as $abschnitt) {
        $name = trim((string) ($abschnitt['name'] ?? ''));
        if ($name !== '') {
            $namen[$name] = true;
        }
    }

    return count($namen) <= 1;
}

/**
 * Welche unserer Objekte tragen die Garetien-Quelle bereits?
 *
 * ⚠️ EINE Abfrage je LAUF, nicht je Zeile. 289 Zeilen mit bis zu 13 Abschnitten waeren sonst rund
 * tausend Einzelabfragen fuer eine Frage, deren Antwort sich waehrend des Rechnens nicht aendert.
 * ⚠️ Faellt OFFEN aus: fehlt die Tabelle (frische Installation), gilt "keine Quelle liegt" -- das
 * erzeugt hoechstens ein Item zu viel, und ein Item zu viel ist sichtbar. Ein Item zu WENIG waere
 * eine stillschweigend verlorene Quellenangabe.
 *
 * 🔴 RULING R3 (Review C1): KEIN `status`-Filter. Der Hauswert ist `'approved'`, der einzige
 * andere `'suppressed'` -- der Grabstein einer von HAND entfernten Verknuepfung. Wer ihn
 * ignoriert, bietet genau das wieder an, was ein Mensch weggenommen hat, und verletzt die
 * Uebersteuerungs-Sicherheit, die das Haus ueberall verlangt ("manual/suppressed untouched",
 * AGENTS.md §11 Wiki-Publikations-Quellen). Eine Zeile da = die Quelle ist erledigt, egal in
 * welchem Zustand. (Der vorherige Wert `'active'` war falsch -- das ist das Vokabular des
 * Lore-Systems, nicht von `feature_sources`, und lieferte live IMMER die leere Menge.)
 *
 * 🔴 Der Schluessel traegt `entity_type`, weil dieser Import `path`- UND `region`-Zeilen
 * schreibt und `feature_sources` erst ueber (entity_type, entity_public_id, source_id) eindeutig
 * ist -- eine ueber zwei Typen geteilte public_id laese sich sonst als "Quelle liegt".
 *
 * @return array<string,true> "<entity_type>|<entity_public_id>" => true
 */
function avesmapsGaretienQuellenBestand(PDO $pdo): array
{
    try {
        $stmt = $pdo->query(
            "SELECT DISTINCT entity_type, entity_public_id FROM feature_sources"
            . " WHERE origin = 'garetien'"
        );
    } catch (PDOException) {
        return [];
    }
    $raus = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $raus[$zeile['entity_type'] . '|' . (string) $zeile['entity_public_id']] = true;
    }

    return $raus;
}

/**
 * DER VIERTE AUSGANG: "haben wir -- aber sie wissen mehr" (Auftrag §4).
 *
 * 🔴 KEIN vierter change_type. Es ist ein `changed`; `after.anlass` sagt, welcher Art. Ein
 * vierter Wert muesste durch sync-plan.php, die drei Gruppen des Blattes und deren Tests wandern
 * und koennte nichts, was `anlass` nicht kann. ⭐ Und das Blatt stellt ihn schon richtig dar:
 * syncPlanDiffMarkup zeichnet `-- -> Alke` bzw. `Reichsstrasse 3 -> Angbarer Reichsstrasse` aus
 * before/after, ohne eine Zeile Aenderung.
 *
 * 🔴 EIN ABSCHNITT IST EIN EIGENES ITEM. Gehakt wird je Abschnitt, nie je Objekt -- weil ihr
 * eines Objekt ueber mehrere unserer Fluesse laufen kann. Eine Abschnittsauswahl in
 * `override`/`after` waere der zweite Schreibweg, den Auftrag §5.4 verbietet.
 *
 * REIN -- kein I/O. `$quellen` kommt aus avesmapsGaretienQuellenBestand.
 *
 * @param array<string,true> $quellen "<entity_type>|<entity_public_id>" => true
 * @return list<array>
 */
function avesmapsGaretienErgaenzungsEintraege(array $zeile, array $ziel, array $urteil, array $quellen): array
{
    $abschnitte = $urteil['abschnitte'] ?? [];
    if ($abschnitte === []) {
        return [];
    }
    $ihrName = trim((string) ($zeile['anzeige'] ?? ''));
    $einObjekt = avesmapsGaretienEinObjekt($abschnitte);
    // Der gemeinsame Rumpf (Quelle, Wiki, Beschriftung) steht schon im Neu-Eintrag -- er wird
    // wiederverwendet und nicht abgeschrieben.
    $vorlage = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil);
    $eintraege = [];
    $abschnittAnzahl = count($abschnitte);

    foreach ($abschnitte as $abschnitt) {
        $publicId = (string) $abschnitt['public_id'];
        $unserName = trim((string) ($abschnitt['name'] ?? ''));
        $nameLeer = $unserName === '';
        $nameGleich = !$nameLeer && avesmapsGaretienNamenAehnlich($ihrName, $unserName);
        // 🔴 Review C1: der Schluessel traegt den Zieltyp -- derselbe public_id-Raum wird von
        // path UND region benutzt.
        $hatQuelle = isset($quellen[$ziel['ziel'] . '|' . $publicId]);

        // 1. Das Luecken-Item: nur Leeres wird gefuellt, deshalb VORANGEHAKT.
        $felder = [];
        if ($nameLeer) {
            $felder[] = 'name';
        }
        if (!$hatQuelle && ($nameLeer || $nameGleich || $einObjekt)) {
            // ⚠️ Eine Quelle bekommt nur, wem sie GEHOERT. Der Gardel liegt zufaellig unter ihrer
            // Natter -- ihre Quelle dort anzuhaengen behauptete, garetien.de beschreibe den Gardel.
            $felder[] = 'quelle';
        }
        if ($felder !== []) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'ergaenzung', $felder, $ihrName, $unserName, false, $abschnittAnzahl
            );
        }

        // 2. Das Umbenennungs-Item: ein VORHANDENER Name wird ueberschrieben -- nie stillschweigend.
        if (!$nameLeer && !$nameGleich && $einObjekt) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'umbenennung', ['name'], $ihrName, $unserName, true, $abschnittAnzahl
            );
        }
    }

    // 3. Das Geometrie-Item -- genau eins je Objekt, und nur bei GENAU EINEM getroffenen
    // Abschnitt. 💣 Bei mehreren hat "ersetze die Geometrie" kein wohldefiniertes Ziel: ihre
    // Natter trifft fuenf. Und ein pauschales Ersetzen ist die schlimmste Handlung, die dieses
    // Werkzeug anbieten kann -- 34 der 37 Widersprueche sind Baeche, die auf ihrem Hauptfluss
    // liegen; dort ersetzte es die Natter durch ihren Seitenarm, mit gueltiger id und ohne
    // Fehlermeldung. Der Knopf ist dann ausgegraut und sagt, warum.
    // 🔴 RULING R6 (Owner, nach R5): geometrie ersetzen gilt fuer ALLE Formen -- Flaechen UND
    // Wege/Fluesse, nicht nur Wege. R5 hatte diesen Zweig fuer Regionen versucht wegzudefinieren;
    // das war falsch, der Owner will es ausdruecklich. Die zwei echten Fehler des Region-Zweigs
    // (falscher id-Raum, fehlende erwartete Revision) sind stattdessen im Anwender repariert
    // (avesmapsGaretienErgaenzungAnwenden, garetien-uebernahme.php).
    if ($abschnittAnzahl === 1) {
        $eintraege[] = avesmapsGaretienAbschnittsEintrag(
            $vorlage, $abschnitte[0], 'geometrie', ['geometrie'], $ihrName,
            trim((string) ($abschnitte[0]['name'] ?? '')), true, $abschnittAnzahl
        );
    }

    return $eintraege;
}

/** Menschlich lesbarer Anlass, fuer die Beschriftung -- NICHT fuer `after.anlass` (Review I1). */
const AVESMAPS_GARETIEN_ANLASS_BESCHRIFTUNG = [
    'ergaenzung' => 'Quelle',
    'umbenennung' => 'umbenennen',
    'geometrie' => 'Geometrie',
];

/**
 * Ein Item fuer EINEN Abschnitt, aus der gemeinsamen Vorlage.
 *
 * 💣 Der `entity_key` traegt den Abschnitt UND den Anlass. Ohne beides teilten sich zwei Items
 * eine Zeile in `sync_decision` -- und eine Ablehnung des Umbenennens naehme die Quelle mit.
 *
 * 🔴 Review I1: DIE BESCHRIFTUNG WAR UNTERSCHEIDUNGSLOS. Sechs Reichsstrasse-3-Abschnitte tragen
 * denselben Namen -- ohne Anlass UND Abschnitt sahen ihr Quellen-Item und ihr Umbenennungs-Item
 * (und alle sechs Umbenennungs-Items untereinander) identisch aus. Die Beschriftung traegt jetzt
 * den Anlass, und bei mehreren getroffenen Abschnitten zusaetzlich die public_id.
 *
 * 🔴 Review I1: `after.name` bleibt NUR stehen, wenn 'name' wirklich in `felder` liegt -- sonst
 * behauptet das Blatt (syncPlanDiffMarkup zeigt jedes Feld aus `after`) eine Umbenennung, die gar
 * nicht ausgefuehrt wird (ein Quellen- oder Geometrie-Item schreibt keinen Namen).
 */
function avesmapsGaretienAbschnittsEintrag(
    array $vorlage, array $abschnitt, string $anlass, array $felder,
    string $ihrName, string $unserName, bool $vorwahlAus, int $abschnittAnzahl
): array {
    $publicId = (string) $abschnitt['public_id'];
    $eintrag = $vorlage;
    $eintrag['entity_key'] = mb_substr($vorlage['entity_key'] . '|' . $anlass . '|' . $publicId, 0, 190, 'UTF-8');
    $eintrag['entity_public_id'] = $publicId;
    $eintrag['change_type'] = 'changed';
    $anlassText = AVESMAPS_GARETIEN_ANLASS_BESCHRIFTUNG[$anlass] ?? $anlass;
    $abschnittText = $abschnittAnzahl > 1 ? ' (' . $publicId . ')' : '';
    $eintrag['label'] = $ihrName . ' → ' . ($unserName !== '' ? $unserName : 'ohne Namen')
        . ' · ' . $anlassText . $abschnittText;
    $eintrag['before'] = ['public_id' => $publicId, 'name' => $unserName];
    $eintrag['after']['anlass'] = $anlass;
    $eintrag['after']['felder'] = $felder;
    if (!in_array('name', $felder, true)) {
        // Kein Namenswechsel auf diesem Item -- die Vorlage traegt IHREN Namen in `after.name`
        // (fuer den Neu-Fall gedacht), und der wuerde hier faelschlich als Umbenennung gelesen.
        unset($eintrag['after']['name']);
    }
    $eintrag['after']['abschnitt'] = [
        'public_id' => $publicId,
        'name' => $unserName,
        'punkte' => (int) ($abschnitt['punkte'] ?? 0),
        'geometrie' => $abschnitt['geometrie'] ?? [],
    ];
    // ⚠️ `nachbar` gehoert dem Zufluss und hat hier nichts zu suchen.
    $eintrag['after']['nachbar'] = null;
    $eintrag['vorwahl_aus'] = $vorwahlAus;

    return $eintrag;
}

/**
 * Das Urteil an die Staging-Zeile -- damit "deckt sich" und "uebersprungen" nach dem Rechnen
 * noch filterbar sind. Sie erzeugen keinen sync_plan_item, und ohne diese zwei Spalten waere ihr
 * Grund im Arbeitsspeicher geblieben (Aufgabe 6, 27.08.2026).
 *
 * ⚠️ Es steht im STAGING und verschwindet mit ihm (Auftrag §5.5). In sync_plan_item landet
 * dadurch nichts Zusaetzliches.
 *
 * 🔴 REVIEW C1 (Critical, 27.08.2026): `zeile_nr` ALLEIN ist KEIN Schluessel innerhalb eines
 * Laufs -- sie beginnt je SEITE neu bei 1 (`avesmapsGaretienStageSeite`, `garetien-abruf.php`),
 * und der Endpunkt legt ausdruecklich mehrere Seiten in EINEN Lauf. Nachgemessen am echten
 * Zwei-Seiten-Bestand (ggp + kosch Gewaesser, 289 Zeilen): 43 Zeilennummern sind doppelt
 * vergeben. Ohne `wiki`+`ebene` im WHERE traf ein UPDATE BEIDE Zeilen mit derselben Nummer --
 * und item-lose Objekte (Aufgabe 8) lesen ihr urteil/grund AUSSCHLIESSLICH von hier, ein Editor
 * haette also den Grund einer FREMDEN Zeile vorgelegt bekommen. Der Schluessel ist deshalb
 * (run_id, wiki, ebene, zeile_nr) -- exakt das Tupel, unter dem `avesmapsGaretienStageSeite`
 * ihre `zeile_nr` ueberhaupt erst vergibt.
 */
function avesmapsGaretienSchreibeUrteil(
    PDO $pdo, int $importRunId, string $wiki, string $ebene, int $zeileNr, string $urteil, string $grund
): void {
    $pdo->prepare(
        'UPDATE garetien_import_row SET urteil = :u, grund = :g'
        . ' WHERE run_id = :r AND wiki = :w AND ebene = :e AND zeile_nr = :n'
    )->execute([
        ':u' => mb_substr($urteil, 0, 20, 'UTF-8'),
        ':g' => mb_substr($grund, 0, 300, 'UTF-8'),
        ':r' => $importRunId,
        ':w' => $wiki,
        ':e' => $ebene,
        ':n' => $zeileNr,
    ]);
}

/**
 * Den Plan fuer einen Import-Lauf bauen. Gibt die Zahl der Vorschlaege zurueck.
 *
 * 🔴 Review I3: `deckt_sich` geht seit dem vierten Ausgang (Aufgabe 3) durch
 * `avesmapsGaretienErgaenzungsEintraege` -- das erzeugt KEINEN Eintrag nur, wenn jeder getroffene
 * Abschnitt Namen UND Quelle schon traegt (das Geometrie-Item bleibt trotzdem, "immer ungehakt"
 * gilt unabhaengig davon). `uebersprungen` erzeugt weiterhin keinen Eintrag, aber der Grund steht
 * im Lauf-Vermerk, damit die Zahl nachpruefbar bleibt: "6 uebersprungen" ohne Grund ist keine
 * Auskunft.
 */
function avesmapsGaretienBaueSyncPlan(PDO $pdo, int $importRunId, int $userId = 0): int
{
    avesmapsEnsureSyncPlanTables($pdo);
    // 🪤 Der Kandidatenspeicher gilt fuer den ganzen Prozess. Wer im selben Lauf erst uebernimmt
    // und dann neu plant, bekaeme sonst den Stand von vorher.
    avesmapsGaretienKandidatenVergessen();

    $runId = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, $userId, 'import:' . $importRunId);
    if ($runId <= 0) {
        throw new RuntimeException('Der Vorschau-Lauf konnte nicht angelegt werden.');
    }
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    // EINE Abfrage je Lauf -- der vierte Ausgang fragt sonst je Abschnitt nach.
    $quellenBestand = avesmapsGaretienQuellenBestand($pdo);

    $stmt = $pdo->prepare(
        'SELECT wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo'
        . ' FROM garetien_import_row WHERE run_id = :r ORDER BY id'
    );
    $stmt->execute([':r' => $importRunId]);

    $anzahl = 0;
    $uebersprungen = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $grund = avesmapsGaretienUeberspringGrund($zeile);
        if ($grund !== null) {
            $uebersprungen[$grund] = ($uebersprungen[$grund] ?? 0) + 1;
            // 💣 Der Uebersprung-Zweig steht VOR dem Abgleich und wird sonst nie erfasst -- das
            // sind genau die 6, um die es in Aufgabe 6 geht.
            avesmapsGaretienSchreibeUrteil($pdo, $importRunId, (string) $zeile['wiki'], (string) $zeile['ebene'], (int) $zeile['zeile_nr'], 'uebersprungen', $grund);
            continue;
        }
        $ziel = avesmapsGaretienMappeTyp((string) $zeile['typ']);
        if ($ziel === null) {
            continue;   // von avesmapsGaretienUeberspringGrund bereits erfasst
        }
        $urteil = avesmapsGaretienFindeBestand($pdo, $zeile, $ziel);
        // Das Urteil ueberlebt das Rechnen -- auch "deckt_sich", das seit Aufgabe 3 durch den
        // vierten Ausgang eigene Items erzeugen KANN, aber nicht MUSS (⚠️ Brief §Aufgabe 6: das
        // ist kein Widerspruch, sondern derselbe Sachverhalt aus zwei Blickwinkeln).
        avesmapsGaretienSchreibeUrteil($pdo, $importRunId, (string) $zeile['wiki'], (string) $zeile['ebene'], (int) $zeile['zeile_nr'], $urteil['status'], $urteil['grund']);
        if ($urteil['status'] === 'uebersprungen') {
            continue;
        }
        // 🔴 DER VIERTE AUSGANG. `deckt_sich` erzeugte bis zum 27.08.2026 gar nichts -- und genau
        // dabei gingen ihr Name, ihr Wiki-Artikel und ihre Quelle verloren. 25 von 76
        // Geometrietreffern trugen bei uns keinen Namen.
        $eintraege = $urteil['status'] === 'deckt_sich'
            ? avesmapsGaretienErgaenzungsEintraege($zeile, $ziel, $urteil, $quellenBestand)
            : [avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil)];
        foreach ($eintraege as $eintrag) {
            // 🔴 Die Vorwahl kommt aus der HAUSREGEL, sie wird nicht nachgebaut: 'deleted' nie,
            // 'changed' faellt beim zweiten Ueberspringen heraus. Ein zweiter Vorwahl-Rechner waere
            // genau die Divergenz, die diese Anbindung vermeiden soll.
            $schluessel = avesmapsSyncPlanDecisionKey($eintrag['entity_key'], $eintrag['change_type']);
            $eintrag['selected'] = avesmapsSyncPlanDefaultSelected(
                $eintrag['change_type'],
                (int) ($entscheidungen[$schluessel]['skipped_count'] ?? 0)
            );
            // 🔴 Die Hausregel kann nur AUS-, nie EINgeschaltet werden. Sie darf einen Zufluss
            // nicht vorhaken; ein Zufluss darf umgekehrt aber auch nicht anhaken, was sie
            // ausgehakt hat (zweimal uebersprungen heisst zweimal uebersprungen).
            if ($eintrag['vorwahl_aus']) {
                $eintrag['selected'] = 0;
            }
            unset($eintrag['vorwahl_aus']);
            avesmapsSyncPlanAddItem($pdo, $runId, $eintrag);
            $anzahl++;
        }
    }

    avesmapsSyncPlanFinishBuild($pdo, $runId);

    if ($uebersprungen !== []) {
        // Der Grund reist im Lauf mit -- eine Zahl ohne Grund ist keine Auskunft.
        $pdo->prepare('UPDATE sync_plan_run SET source_stamp = :s WHERE id = :id')->execute([
            ':s' => mb_substr('import:' . $importRunId . ' · ' . json_encode($uebersprungen, JSON_UNESCAPED_UNICODE), 0, 64, 'UTF-8'),
            ':id' => $runId,
        ]);
    }

    return $anzahl;
}

/**
 * Ein SQLite-Prüfstand mit Staging, Bestand und Vorschau-Tabellen.
 *
 * ⚠️ Lebt hier und nicht im Test, weil die Uebernahme (Aufgabe 6) denselben Aufbau braucht --
 * zwei Fassungen desselben Pruefstands laufen auseinander, und dann prueft der eine etwas
 * anderes als der andere.
 */
function avesmapsGaretienPlanTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');
    // 🔴 RULING P1: die Tabelle steht hier bewusst OHNE die Urteilsspalten -- wie live vor dem
    // 27.08.2026. Der Nachzug laeuft ueber denselben ALTER-Weg wie in Produktion, statt die
    // Spalten hart in dieses CREATE zu schreiben; nur so prueft dieser Pruefstand den echten
    // Nachzug an einer bestehenden Tabelle, nicht nur seinen Endzustand.
    avesmapsGaretienEnsureUrteilSpalten($pdo);
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT, geometry_json TEXT, properties_json TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, kind TEXT, region_type TEXT, wiki_url TEXT, label_public_id TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, region_id INT, geometry_geojson TEXT, is_active INT DEFAULT 1, is_trial INT DEFAULT 0)');
    // 🔴 Review C1: eine TESTTABELLE (kein Produktions-DDL, das steht in
    // api/_internal/app/feature-sources.php), damit avesmapsGaretienQuellenBestand() ihre Abfrage
    // wirklich AUSFUEHRT statt sie im catch-Zweig zu verschlucken. Bleibt LEER -- ein Test, der
    // eine hinterlegte Quelle braucht, saet seine eigene Zeile.
    $pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT, source_id INT, status TEXT DEFAULT \'approved\', origin TEXT DEFAULT \'manual\')');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    // Ein Bestandsfluss dort, wo die erste Quellzeile landet -- damit "deckt_sich" wirklich
    // vorkommt und der Test nicht nur den Neu-Fall prueft.
    $vorhanden = avesmapsGaretienLinieNachAvesmaps([[20000.0, 10000.0], [21000.0, 11000.0], [22000.0, 12000.0]]);
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)')
        ->execute(['vorhanden-1', 'Alke', 'path', 'Flussweg',
            json_encode(['type' => 'LineString', 'coordinates' => $vorhanden], JSON_UNESCAPED_UNICODE), '{}']);

    $pdo->exec("INSERT INTO garetien_import_run (id, started_at, status) VALUES (1, '2026-08-26 12:00:00', 'done')");
    $zeilen = [
        // deckt sich mit 'vorhanden-1'
        ['ggp', 'Gewaesser', 1, 'Bach', 'Garetien', 'Alke', 'Alke', 'koordinaten', '20000 10000, 21000 11000, 22000 12000'],
        // neu, ein Fluss weit weg
        ['ggp', 'Gewaesser', 2, 'Fluss', 'Garetien', 'Gardel', 'Gardel', 'koordinaten', '90000 -40000, 91000 -41000, 92000 -42000'],
        // neu, eine Seeflaeche
        ['ggp', 'Gewaesser', 3, 'See', 'Garetien', 'Muehlsee', 'Mühlsee', 'koordinaten', '1000 -12000, 1800 -12700, 1200 -13400, 1000 -12000'],
        // uebersprungen: Sammelartikel
        ['ggp', 'Gewaesser', 4, 'Fluss', '', 'Nachbarprovinzen', 'Llavari', 'koordinaten', '1 2, 3 4'],
        // uebersprungen: spaetere Stufe. 🔴 Review C1: zeile_nr=1 ist ABSICHT, nicht Zufall --
        // sie kollidiert mit der Alke (Zeile darueber, ebenfalls zeile_nr=1) ueber ein ANDERES
        // wiki. Genau das tut die Produktion: avesmapsGaretienStageSeite() startet zeile_nr fuer
        // JEDE Seite neu bei 1, und ein Lauf traegt mehrere Seiten -- am echten Zwei-Seiten-
        // Bestand gemessen sind 43 von 289 Zeilennummern doppelt vergeben. Ohne wiki+ebene im
        // Schluessel von avesmapsGaretienSchreibeUrteil traf ein UPDATE fuer die Alke auch diese
        // Zeile mit (und umgekehrt) -- garetien-staging-test.php sichert beide Seiten der
        // Kollision einzeln zu.
        ['kosch', 'Gewaesser', 1, 'Insel', '', '', 'Im Angbarer See', 'koordinaten', '-193386 52741, -194553 52157, -193386 52741'],
        // 🔴 Ein ZUFLUSS: liegt auf der Alke, ist aber nur ein Bruchteil ihrer Ausdehnung.
        // Er ist ein eigenes neues Objekt und darf die Alke nicht anfassen.
        ['ggp', 'Gewaesser', 6, 'Bach', 'Garetien', 'Seitenarm der Alke', 'Seitenarm der Alke', 'koordinaten',
         '20000 10300, 20200 10500, 20400 10700'],
    ];
    $ins = $pdo->prepare('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                          VALUES (1,?,?,?,?,?,?,?,\'\',\'\',\'\',?,?,\'\')');
    foreach ($zeilen as $z) {
        $ins->execute($z);
    }

    return $pdo;
}
