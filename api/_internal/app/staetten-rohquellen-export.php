<?php

declare(strict_types=1);

// Die Rohquellen der Staetten als lesender Export -- Bibliothek zu GET /api/app/staetten-rohquellen-export.php
// (X4, Auftrag Avesmaps3D 10.10.2026: project-control/legacy-requests/2026-10-10-staetten-rohquellen-export.md im Repo
// avesmaps3D, WI-0134, Betreiberentscheid F1 = B „schmaler Rohquellenexport plus strukturierte Wiki-Linkziele").
//
// WOZU. `in_settlement_places` (map-features.php) ist eine flache LESELISTE aus sechs Quellen, die Legacy beim Abruf
// zusammensetzt: Name und Stadtname je Zeile, entdoppelt nach dem Namen, ohne Quelle und ohne Kennung der Stadt. Avesmaps3D
// soll die Staetten vor dem Cutoff ueber KENNUNGEN uebernehmen. Dieser Export liefert dafuer die ROHZEILEN der Quellen, die
// nicht schon in der Registry stehen (die Bauwerke P3a traegt X3 samt `standort_links`):
//
//   punkte        P1  Kartenpunkte `gebaeude`/`stadtviertel` mit `properties.innerorts` -- aktive UND von der Karte
//                     genommene (Merker `von_der_karte`), dazu die Entscheidung „keine Stadt" (Herkunft ohne Wert)
//   gespeicherte  P2  `settlement_place`, die gespeicherten Staetten (Kennung der Stadt: `settlement_public_id`)
//   wege          P3b `wiki_path_staging` mit `lage_raw`
//   sitze         P3c `wiki_organisation_seat`, JEDE Sitzzeile mit Rolle und Reihenfolge
//   stadtteile    P3d `wiki_stadtteil_weiterleitung_staging`, die Stadtteilweiterleitungen
//
// 🔴 OHNE URTEIL, OHNE ENTDOPPELN, OHNE ABGELEITETE STADT. Hier laeuft weder der Lage-Klassifikator (place-scope.php)
// noch avesmapsBuildInSettlementPlaceList: kein `$seen`, keine Namensfaltung, kein „erster Link, der eine Siedlung trifft".
// Eine Organisation mit zwei Sitzen steht zweimal da; zwei gleichnamige Staetten in zwei Staedten auch. Die Stadt steht
// nur dort, wo Legacy sie als KENNUNG speichert (P1 `innerorts.ort`, P2 `settlement_public_id`). Bei den Ketten (Lage,
// Sitz, Standort) nennen die Linkziele samt Key, WELCHER Artikel genannt ist -- nicht, ob das Objekt darin liegt.
//
// 🔴 SCHLUESSEL NACH DER REGEL VON X1 UND X2, durch dieselben Funktionen (avesmapsWikiLinkzieleKey, ...KeyAusUrl,
// avesmapsExportLinkziele aus X3). Eine Stadtteilweiterleitung traegt KEINEN eigenen `wiki_key`: der Key ihres Titels geht
// durch die Weiterleitungstafel und ist der Key der STADT (Yol-Fessar -> wiki:fasar). Ihre Identitaet ist der Titel.
// Eine gespeicherte Staette traegt einen Key nur, wenn ihre Adresse auf die Wiki Aventurica zeigt (garetien.de ist ein
// anderes Wiki; ein Key aus dessen Pfad waere geraten).
//
// 🔴 JE QUELLE EIN EIGENES NETZ, und der Kopf SAGT es: Legacys Leseliste ist fail-open (sechs `try`, jedes mit `[]`), ein
// Ausfall sieht dort aus wie „keine Staetten". Hier steht je Quelle `ok`; faellt eine aus, ist ihre Liste leer UND ihr
// `ok` falsch. Der Aufrufer legt dann nichts still. Kein getMessage in der Antwort (AGENTS.md §10).
//
// 🔴 NUR LESEN: jede Abfrage ein SELECT, kein DDL, keine Schemaheilung. Kein Abruf am Wiki, keine Sitzung, kein Schreibweg.
// Legacys Leseliste, map-features.php und das Redaktionsverhalten bleiben unberuehrt: diese Datei laedt sie nicht und wird
// von ihnen nicht geladen.
//
// WARUM OEFFENTLICH, wie X1 bis X3. Jede Zeile steht heute schon als Name, Art, Adresse und Stadtname in der oeffentlichen
// Kartennutzlast (`in_settlement_places`) oder ist ein oeffentlicher Kartenpunkt; neu sind nur Kennungen, Rolle, Reihenfolge
// und die Rohtexte der Ketten aus der oeffentlichen Wiki Aventurica. NIE in der Antwort: `created_by` und jede andere
// Personenspalte, die uebrigen `properties` eines Kartenpunkts (Wappen, Medien, Notizen), Zeitstempel einzelner Zeilen.
//
// ⚠️ Mittelgross (einige tausend Zeilen, rund 1 MB) und ohne Drossel: ein Werkzeug holt die Antwort auf Zuruf, nie in einer
// Schleife.

require_once __DIR__ . '/export-rahmen.php';
// Schluesselregel von X1 und X2 und die Linkziele einer Kette (avesmapsExportLinkziele, X3).
require_once __DIR__ . '/wiki-linkziele-export.php';
require_once __DIR__ . '/wiki-siedlungen-export.php';
// AVESMAPS_INNERORTS_KLASSEN, avesmapsInnerortsOrtVon, avesmapsInnerortsVonDerKarte (Legacys eigene Lesart des Felds).
require_once __DIR__ . '/innerorts.php';
// AVESMAPS_ORG_SEAT_TABLE und AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE: die Tabellen heissen dort, nicht hier.
require_once __DIR__ . '/../wiki/organisation-sync.php';
require_once __DIR__ . '/../wiki/stadtteil-weiterleitung.php';

// Die fuenf Quellen in der Reihenfolge der Antwort (P1, P2, P3b, P3c, P3d).
const AVESMAPS_STAETTEN_ROHQUELLEN = ['punkte', 'gespeicherte', 'wege', 'sitze', 'stadtteile'];

// Die Felder je Quelle (Positivliste; der Test faellt fuer jedes weitere Feld).
const AVESMAPS_STAETTEN_ROHQUELLEN_FELDER = [
    'punkte' => ['public_id', 'name', 'ortsklasse', 'art', 'wiki_url', 'wiki_key', 'aktiv', 'von_der_karte', 'innerorts_ort', 'innerorts_herkunft'],
    'gespeicherte' => ['public_id', 'name', 'art', 'ort_public_id', 'wiki_url', 'wiki_key', 'quelle'],
    'wege' => ['weg_key', 'titel', 'name', 'art', 'wiki_url', 'wiki_key', 'lage_roh', 'lage_links'],
    'sitze' => ['organisation', 'organisation_art', 'rolle', 'reihenfolge', 'ort_roh', 'ort_links', 'wiki_url', 'wiki_key'],
    'stadtteile' => ['titel', 'standort', 'standort_links', 'wiki_url'],
];

// Die Tabelle des Wege-Stagings (paths.php nennt sie AVESMAPS_WIKI_PATH_STAGING_TABLE; die Datei zieht den ganzen Wege-Sync
// nach und wird darum hier nicht geladen -- in-settlement-search.php schreibt den Namen genauso aus).
const AVESMAPS_STAETTEN_ROHQUELLEN_WEGE_TABELLE = 'wiki_path_staging';

/** REIN: ein Text, leer heisst null. */
function avesmapsStaettenRohquellenText(mixed $wert): ?string
{
    $text = trim((string) ($wert ?? ''));

    return $text === '' ? null : $text;
}

/**
 * REIN: der Key einer Adresse -- nur, wenn sie auf die Wiki Aventurica zeigt (Regel von X2, avesmapsWikiLinkzieleKeyAusUrl).
 *
 * @param array<string,string> $aliase
 */
function avesmapsStaettenRohquellenKeyAusAdresse(?string $adresse, array $aliase): ?string
{
    if ($adresse === null || avesmapsWikiNamespaceFromWikiUrlMitHauptraum($adresse) === null) {
        return null;
    }
    $schluessel = avesmapsWikiLinkzieleKeyAusUrl($adresse, $aliase);

    return $schluessel === '' ? null : $schluessel;
}

/**
 * REIN: der Key eines Seitentitels (Regel von X1 und X2), null ohne Schluessel.
 *
 * @param array<string,string> $aliase
 */
function avesmapsStaettenRohquellenKeyAusTitel(?string $titel, array $aliase): ?string
{
    if ($titel === null) {
        return null;
    }
    $schluessel = avesmapsWikiLinkzieleKey($titel, $aliase);

    return $schluessel === '' ? null : $schluessel;
}

/**
 * P1: die Kartenpunkte mit `innerorts`. Dieselbe Auswahl wie Legacys Leser (avesmapsInnerortsPunkteFuerStaetten): die zwei
 * Ortsgroessen, das Feld im JSON; aktive Punkte und von der Karte genommene (Merker), nie ein regulaer geloeschter (inaktiv
 * ohne Merker: der ist auch fuer Legacy keine Staette mehr). Anders als dort: auch ein Punkt OHNE Stadt, dessen Feld eine
 * Herkunft traegt -- das ist eine Entscheidung „keine Stadt" (`field_origins.innerorts`, field-origins.php), und sie soll
 * ankommen. Der Name der Stadt wird NICHT gelesen: die Kennung ist die Beziehung.
 *
 * @param array<string,string> $aliase
 * @return list<array<string,mixed>>
 */
function avesmapsStaettenRohquellenPunkte(PDO $pdo, array $aliase): array
{
    $statement = $pdo->prepare(
        "SELECT public_id, name, feature_subtype, properties_json, is_active FROM map_features
          WHERE feature_type = 'location'
            AND feature_subtype IN (" . implode(', ', array_fill(0, count(AVESMAPS_INNERORTS_KLASSEN), '?')) . ")
            AND properties_json LIKE '%innerorts%'"
    );
    $statement->execute(AVESMAPS_INNERORTS_KLASSEN);

    $punkte = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $eigenschaften = avesmapsInnerortsPropertiesDekodieren($zeile['properties_json'] ?? null);
        if ($eigenschaften === null) {
            continue; // kaputtes JSON: auch Legacys Leser ueberspringt die Zeile
        }
        $ort = avesmapsInnerortsOrtVon($eigenschaften);
        $herkuenfte = is_array($eigenschaften['field_origins'] ?? null) ? $eigenschaften['field_origins'] : [];
        $herkunft = $herkuenfte['innerorts'] ?? null;
        $herkunft = in_array($herkunft, [AVESMAPS_FIELD_ORIGIN_WIKI, AVESMAPS_FIELD_ORIGIN_MANUAL], true) ? $herkunft : null;
        $aktiv = (int) ($zeile['is_active'] ?? 0) === 1;
        $vonDerKarte = avesmapsInnerortsVonDerKarte($eigenschaften);
        if (($ort === '' && $herkunft === null) || (!$aktiv && !$vonDerKarte)) {
            continue;
        }
        $nest = is_array($eigenschaften['wiki_settlement'] ?? null) ? $eigenschaften['wiki_settlement'] : [];
        // Nur das Nest, nie das flache `wiki_url`: das raet der Lesepfad der Karte bei Leere per Namen nach (Regel von X2).
        $adresse = avesmapsStaettenRohquellenText($nest['wiki_url'] ?? null);
        $schluessel = $adresse === null ? '' : avesmapsWikiLinkzieleKeyAusUrl($adresse, $aliase);
        $punkte[] = avesmapsExportProjektion([
            'public_id' => (string) $zeile['public_id'],
            'name' => (string) ($zeile['name'] ?? ''),
            'ortsklasse' => (string) $zeile['feature_subtype'],
            'art' => avesmapsStaettenRohquellenText($eigenschaften['place_kind'] ?? null),
            'wiki_url' => $adresse,
            'wiki_key' => $schluessel === '' ? null : $schluessel,
            'aktiv' => $aktiv,
            'von_der_karte' => $vonDerKarte,
            'innerorts_ort' => $ort === '' ? null : $ort,
            'innerorts_herkunft' => $herkunft,
        ], AVESMAPS_STAETTEN_ROHQUELLEN_FELDER['punkte']);
    }
    usort($punkte, static fn(array $a, array $b): int => strcmp($a['public_id'], $b['public_id']));

    return $punkte;
}

/**
 * P2: die gespeicherten Staetten, nur aktive (eine zurueckgenommene ist auch fuer Legacy keine). Die Stadt ist die Kennung
 * `settlement_public_id`; der gemerkte `settlement_name` geht NICHT mit (er wird beim Umbenennen der Stadt nicht nachgezogen).
 *
 * @param array<string,string> $aliase
 * @return list<array<string,mixed>>
 */
function avesmapsStaettenRohquellenGespeicherte(PDO $pdo, array $aliase): array
{
    $statement = $pdo->query(
        'SELECT public_id, name, place_type, settlement_public_id, wiki_url, origin FROM settlement_place WHERE is_active = 1'
    );
    $zeilen = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $adresse = avesmapsStaettenRohquellenText($zeile['wiki_url'] ?? null);
        $zeilen[] = avesmapsExportProjektion([
            'public_id' => (string) $zeile['public_id'],
            'name' => (string) $zeile['name'],
            'art' => avesmapsStaettenRohquellenText($zeile['place_type'] ?? null),
            'ort_public_id' => avesmapsStaettenRohquellenText($zeile['settlement_public_id'] ?? null),
            'wiki_url' => $adresse,
            'wiki_key' => avesmapsStaettenRohquellenKeyAusAdresse($adresse, $aliase),
            'quelle' => avesmapsStaettenRohquellenText($zeile['origin'] ?? null),
        ], AVESMAPS_STAETTEN_ROHQUELLEN_FELDER['gespeicherte']);
    }
    usort($zeilen, static fn(array $a, array $b): int => strcmp($a['public_id'], $b['public_id']));

    return $zeilen;
}

/**
 * P3b: die Wege mit einer Lage. Identitaet ist Legacys `wiki_path_staging.wiki_key` (eindeutig), wie geliefert.
 *
 * @param array<string,string> $aliase
 * @return list<array<string,mixed>>
 */
function avesmapsStaettenRohquellenWege(PDO $pdo, array $aliase): array
{
    $statement = $pdo->query(
        'SELECT wiki_key, title, name, art, wiki_url, lage_raw FROM ' . AVESMAPS_STAETTEN_ROHQUELLEN_WEGE_TABELLE . "
          WHERE lage_raw IS NOT NULL AND lage_raw <> ''"
    );
    $zeilen = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $titel = avesmapsStaettenRohquellenText($zeile['title'] ?? null);
        $lage = avesmapsStaettenRohquellenText($zeile['lage_raw'] ?? null);
        $zeilen[] = avesmapsExportProjektion([
            'weg_key' => (string) $zeile['wiki_key'],
            'titel' => $titel,
            'name' => (string) ($zeile['name'] ?? ''),
            'art' => avesmapsStaettenRohquellenText($zeile['art'] ?? null),
            'wiki_url' => avesmapsStaettenRohquellenText($zeile['wiki_url'] ?? null),
            'wiki_key' => avesmapsStaettenRohquellenKeyAusTitel($titel, $aliase),
            'lage_roh' => $lage,
            'lage_links' => avesmapsExportLinkziele($lage, $aliase),
        ], AVESMAPS_STAETTEN_ROHQUELLEN_FELDER['wege']);
    }
    usort($zeilen, static fn(array $a, array $b): int => strcmp($a['weg_key'], $b['weg_key']));

    return $zeilen;
}

/**
 * P3c: JEDE Sitzzeile, nicht nur der erste Sitz einer Organisation. Legacy hat fuer einen Sitz keine stabile Kennung (die
 * Zeilen entstehen je Lauf neu); der natuerliche Schluessel ist (Organisation, Rohort) -- `uq_org_seat` in
 * organisation-sync.php. Die Rolle steht wie gespeichert (`hauptsitz`, `zweigsitz`), die Art OHNE den Anzeigezusatz
 * „(Hauptsitz)" und ohne den Rueckfall „Handelshaus" (beides ist Anzeige, avesmapsOrgSeatFetchInSettlementRows).
 *
 * @param array<string,string> $aliase
 * @return list<array<string,mixed>>
 */
function avesmapsStaettenRohquellenSitze(PDO $pdo, array $aliase): array
{
    $statement = $pdo->query(
        'SELECT organisation_title, organisation_art, place_raw, role, wiki_url, sort_order FROM ' . AVESMAPS_ORG_SEAT_TABLE
    );
    $zeilen = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $organisation = (string) $zeile['organisation_title'];
        $ort = (string) $zeile['place_raw'];
        $zeilen[] = avesmapsExportProjektion([
            'organisation' => $organisation,
            'organisation_art' => avesmapsStaettenRohquellenText($zeile['organisation_art'] ?? null),
            'rolle' => (string) $zeile['role'],
            'reihenfolge' => (int) $zeile['sort_order'],
            'ort_roh' => $ort,
            'ort_links' => avesmapsExportLinkziele($ort, $aliase),
            'wiki_url' => avesmapsStaettenRohquellenText($zeile['wiki_url'] ?? null),
            'wiki_key' => avesmapsStaettenRohquellenKeyAusTitel(avesmapsStaettenRohquellenText($organisation), $aliase),
        ], AVESMAPS_STAETTEN_ROHQUELLEN_FELDER['sitze']);
    }
    usort($zeilen, static fn(array $a, array $b): int => strcmp($a['organisation'], $b['organisation'])
        ?: ($a['reihenfolge'] <=> $b['reihenfolge'])
        ?: strcmp($a['ort_roh'], $b['ort_roh']));

    return $zeilen;
}

/**
 * P3d: die Stadtteilweiterleitungen. 🔴 Identitaet ist der TITEL; einen eigenen `wiki_key` gibt es bewusst nicht (der Key des
 * Titels waere durch die Weiterleitungstafel der Key der Stadt). Die Stadt nennen die Linkziele des Standorts.
 *
 * @param array<string,string> $aliase
 * @return list<array<string,mixed>>
 */
function avesmapsStaettenRohquellenStadtteile(PDO $pdo, array $aliase): array
{
    $statement = $pdo->query('SELECT title, standort, wiki_url FROM ' . AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE);
    $zeilen = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $standort = avesmapsStaettenRohquellenText($zeile['standort'] ?? null);
        $zeilen[] = avesmapsExportProjektion([
            'titel' => (string) $zeile['title'],
            'standort' => $standort,
            'standort_links' => avesmapsExportLinkziele($standort, $aliase),
            'wiki_url' => avesmapsStaettenRohquellenText($zeile['wiki_url'] ?? null),
        ], AVESMAPS_STAETTEN_ROHQUELLEN_FELDER['stadtteile']);
    }
    usort($zeilen, static fn(array $a, array $b): int => strcmp($a['titel'], $b['titel']));

    return $zeilen;
}

/**
 * Eine Quelle lesen -- faellt sie aus (Tabelle oder Spalte fehlt), wird das ausdruecklich, nicht still.
 *
 * @return array{ok:bool, zeilen:list<array<string,mixed>>}
 */
function avesmapsStaettenRohquellenLesenEine(callable $lesen): array
{
    try {
        return ['ok' => true, 'zeilen' => $lesen()];
    } catch (Throwable) {
        // 🔴 Kein Grund aus der Ausnahme in die Antwort (AGENTS.md §10); der Kopf sagt nur, DASS die Quelle fehlt.
        return ['ok' => false, 'zeilen' => []];
    }
}

/**
 * REIN: Zahl der Linkziele und der Linkziele ohne Schluessel in einer Liste von Zeilen.
 *
 * @param list<array<string,mixed>> $zeilen
 * @return array{linkziele:int, linkziele_ohne_schluessel:int}
 */
function avesmapsStaettenRohquellenLinkZaehler(array $zeilen, string $feld): array
{
    $links = $zeilen === [] ? [] : array_merge(...array_column($zeilen, $feld));

    return [
        'linkziele' => count($links),
        'linkziele_ohne_schluessel' => count(array_filter($links, static fn(array $link): bool => $link['ziel_key'] === null)),
    ];
}

/**
 * Der juengste Abgleich einer Staging-Tabelle (naiv, wie gespeichert), null ohne Zeile oder bei Ausfall.
 */
function avesmapsStaettenRohquellenJuengster(PDO $pdo, string $tabelle): ?string
{
    try {
        $statement = $pdo->query('SELECT MAX(synced_at) FROM ' . $tabelle);

        return avesmapsStaettenRohquellenText($statement !== false ? $statement->fetchColumn() : null);
    } catch (Throwable) {
        return null;
    }
}

/**
 * Die Daten der Antwort: die fuenf Listen und ihr Kopf.
 *
 * @return array<string,mixed>
 */
function avesmapsStaettenRohquellenDaten(PDO $pdo): array
{
    $aliase = avesmapsWikiLinkzieleAliase($pdo);
    $quellen = [
        'punkte' => avesmapsStaettenRohquellenLesenEine(static fn(): array => avesmapsStaettenRohquellenPunkte($pdo, $aliase)),
        'gespeicherte' => avesmapsStaettenRohquellenLesenEine(static fn(): array => avesmapsStaettenRohquellenGespeicherte($pdo, $aliase)),
        'wege' => avesmapsStaettenRohquellenLesenEine(static fn(): array => avesmapsStaettenRohquellenWege($pdo, $aliase)),
        'sitze' => avesmapsStaettenRohquellenLesenEine(static fn(): array => avesmapsStaettenRohquellenSitze($pdo, $aliase)),
        'stadtteile' => avesmapsStaettenRohquellenLesenEine(static fn(): array => avesmapsStaettenRohquellenStadtteile($pdo, $aliase)),
    ];

    $kopf = [];
    foreach ($quellen as $name => $quelle) {
        $kopf[$name] = ['ok' => $quelle['ok'], 'zeilen' => count($quelle['zeilen'])];
    }
    $kopf['wege'] += avesmapsStaettenRohquellenLinkZaehler($quellen['wege']['zeilen'], 'lage_links');
    $kopf['sitze'] += [
        'organisationen' => count(array_unique(array_column($quellen['sitze']['zeilen'], 'organisation'))),
    ] + avesmapsStaettenRohquellenLinkZaehler($quellen['sitze']['zeilen'], 'ort_links') + [
        'neuester_abgleich' => $quellen['sitze']['ok'] ? avesmapsStaettenRohquellenJuengster($pdo, AVESMAPS_ORG_SEAT_TABLE) : null,
    ];
    $kopf['stadtteile'] += avesmapsStaettenRohquellenLinkZaehler($quellen['stadtteile']['zeilen'], 'standort_links') + [
        'neuester_abgleich' => $quellen['stadtteile']['ok']
            ? avesmapsStaettenRohquellenJuengster($pdo, AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE)
            : null,
    ];

    $daten = ['kopf' => $kopf];
    foreach ($quellen as $name => $quelle) {
        $daten[$name] = $quelle['zeilen'];
    }

    return $daten;
}

/**
 * Der Stand, der waehrend des Lesens stillstehen muss: die Staende von X1 bis X3 (DIESELBE Funktion, damit `map_revision`
 * und `aliase_stempel` aller vier Antworten vergleichbar sind) und je Quelle ein Fingerabdruck. 🔴 Eine fehlende Tabelle
 * macht hier keinen 500: ihr Teil heisst dann `fehlt`, und das Lesen meldet die Quelle als ausgefallen.
 *
 * ⚠️ `map_features` deckt `map_revision` (jeder Schreibweg an Kartenpunkten hebt sie); `settlement_place` hebt sie nicht
 * und steht deshalb mit eigenem Fingerabdruck da.
 *
 * @return array{0: array<string,int|string>, 1: string}
 */
function avesmapsStaettenRohquellenStand(PDO $pdo): array
{
    $teile = [];
    foreach ([
        ['settlement_place', 'updated_at', 'id'],
        [AVESMAPS_STAETTEN_ROHQUELLEN_WEGE_TABELLE, 'updated_at', 'id'],
        [AVESMAPS_ORG_SEAT_TABLE, 'synced_at', 'id'],
        [AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE, 'synced_at', 'title'],
    ] as $tabelle) {
        try {
            $teile[] = avesmapsExportTabellenFingerabdruck($pdo, [$tabelle]);
        } catch (Throwable) {
            $teile[] = $tabelle[0] . ':fehlt';
        }
    }

    return [avesmapsWikiLinkzieleStaende($pdo), implode('|', $teile)];
}

/**
 * Die Antwort des Exports.
 *
 * @param callable|null $lesen nur fuer Tests (ein Lesen, waehrend dessen geschrieben wird)
 * @throws AvesmapsExportInBewegung
 */
function avesmapsStaettenRohquellenLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static fn(): array => avesmapsStaettenRohquellenDaten($pdo);
    $ergebnis = avesmapsExportStabilLesen(static fn(): array => avesmapsStaettenRohquellenStand($pdo), $lesen);
    [$staende, $fingerabdruck] = $ergebnis['stand'];

    return [
        'ok' => true,
        'map_revision' => (int) $staende['map_revision'],
        'aliase_stempel' => (string) $staende['aliase_stempel'],
        'quellen_stand' => avesmapsExportStempel('sq', $fingerabdruck),
    ] + $ergebnis['daten'];
}
