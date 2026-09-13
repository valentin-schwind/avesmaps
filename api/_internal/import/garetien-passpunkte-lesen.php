<?php

declare(strict_types=1);

// DIE TUER ZU DEN PASSPUNKTEN -- holt aus beiden Karten die Ortspaare, auf denen
// garetien-passpunkte.php rechnet.
//
// Entwurf: docs/superpowers/specs/2026-09-13-garetien-passpunkte-design.md
//
// 🔴 KERN UND TUER, wie im Haus ueblich. Diese Datei tut NICHTS als lesen und paaren; jede
// Rechnung steht in garetien-passpunkte.php und laesst sich ohne Datenbank pruefen. Der
// Schnitt ist hier nicht Stil, sondern Notwendigkeit: die Abfragen unten brauchen MySQL und
// einen gefuellten Import-Lauf, und beides hat ein Test nie.
//
// 💣 DER ABGLEICH WIRD NICHT NACHGEBAUT. Namensnormalisierung und Typtabelle kommen aus
// garetien-abgleich.php. Eine zweite Fassung liefe beim ersten neuen Ortstyp auseinander,
// und dann stuenden zwei Antworten auf "ist das derselbe Ort" nebeneinander.

require_once __DIR__ . '/garetien-abgleich.php';
require_once __DIR__ . '/garetien-passpunkte.php';

/**
 * Die Paare.
 *
 * 🔴 MEHRDEUTIGE NAMEN FLIEGEN RAUS, BEVOR GERECHNET WIRD. Entwurf §2.4: von 219
 * namensgleichen Orten waren 70 VERSCHIEDENE Orte -- es gibt zwei "Hueterkloster", zwei
 * "Dreiwegen", zwei "Waldheim". Der robuste Filter faengt sie hinterher an ihrem Abstand,
 * aber er ist die zweite Verteidigungslinie und kostet Punkte. Die erste ist billiger und
 * sicherer: ein Name, der auf EINER der beiden Karten mehr als einmal vorkommt, ist als
 * Passpunkt unbrauchbar -- gleichgueltig, wie nah die beiden zufaellig liegen.
 * ⚠️ Das verwirft auch echte Paare (eine Stadt, die bei uns doppelt liegt). Richtig so: ein
 * Passpunkt zu wenig kostet Genauigkeit, ein falscher kostet die Aussage.
 *
 * @param PDO      $pdo
 * @param int|null $runId  null = der juengste Lauf
 * @return array{paare:array,bericht:array}
 */
function avesmapsGaretienPasspunkteLesen(PDO $pdo, ?int $runId = null): array
{
    $runId ??= avesmapsGaretienPasspunkteJuengsterLauf($pdo);
    if ($runId === null) {
        return ['paare' => [], 'bericht' => ['grund' => 'kein Import-Lauf vorhanden']];
    }

    // --- Ihre Seite: alle Zeilen, die ein PUNKT sind und deren Typ bei uns ein Ort ist.
    $ortsTypen = [];
    foreach (AVESMAPS_GARETIEN_TYP_MAP as $typ => $ziel) {
        if (($ziel['ziel'] ?? '') === 'location') {
            $ortsTypen[] = $typ;
        }
    }
    $platz = implode(',', array_map(static fn(int $i): string => ':t' . $i, array_keys($ortsTypen)));
    $werte = [':run' => $runId];
    foreach ($ortsTypen as $i => $typ) {
        $werte[':t' . $i] = $typ;
    }

    $stmt = $pdo->prepare(
        'SELECT anzeige, artikel, typ, geo FROM garetien_import_row'
        . ' WHERE run_id = :run AND geo_art = \'koordinaten\' AND typ IN (' . $platz . ')'
    );
    $stmt->execute($werte);

    $ihre = [];
    $ihreZahl = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $punkte = avesmapsGaretienParseKoordinaten((string) ($zeile['geo'] ?? ''));
        // Ein Ort ist EIN Punkt. Mehrere Punkte heissen: das ist kein Ort, sondern ein Umriss.
        if (count($punkte) !== 1) {
            continue;
        }
        [$gx, $gy] = $punkte[0];
        // 💣 Die Marke "existiert, aber noch nicht platziert" (2000000 2000000) ist KEIN Ort.
        if (abs((float) $gx) >= 1000000.0 || abs((float) $gy) >= 1000000.0) {
            continue;
        }
        $name = trim((string) ($zeile['anzeige'] ?? '')) ?: trim((string) ($zeile['artikel'] ?? ''));
        $key  = avesmapsGaretienNamenNormalisiert($name);
        if ($key === '') {
            continue;
        }
        $ihreZahl[$key] = ($ihreZahl[$key] ?? 0) + 1;
        $ihre[$key]     = ['name' => $name, 'gx' => (float) $gx, 'gy' => (float) $gy];
    }

    // --- Unsere Seite: alle aktiven Ortspunkte.
    $stmt = $pdo->query(
        'SELECT public_id, name, feature_subtype, geometry_json FROM map_features'
        . ' WHERE feature_type = \'location\' AND is_active = 1'
    );

    $unsere = [];
    $unsereZahl = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $geo = json_decode((string) ($zeile['geometry_json'] ?? ''), true);
        if (!is_array($geo) || ($geo['type'] ?? '') !== 'Point') {
            continue;
        }
        // 🔴 GeoJSON-Reihenfolge: coordinates = [x, y] = [lng, lat]. Nicht Leaflet.
        $ax = $geo['coordinates'][0] ?? null;
        $ay = $geo['coordinates'][1] ?? null;
        if (!is_numeric($ax) || !is_numeric($ay)) {
            continue;
        }
        $key = avesmapsGaretienNamenNormalisiert((string) ($zeile['name'] ?? ''));
        if ($key === '') {
            continue;
        }
        $unsereZahl[$key] = ($unsereZahl[$key] ?? 0) + 1;
        $unsere[$key]     = [
            'name'      => (string) $zeile['name'],
            'public_id' => (string) $zeile['public_id'],
            'subtyp'    => (string) $zeile['feature_subtype'],
            'ax'        => (float) $ax,
            'ay'        => (float) $ay,
        ];
    }

    // --- Paaren. Nur eindeutige Namen auf BEIDEN Seiten.
    $paare        = [];
    $mehrdeutig   = [];
    $nurIhre      = 0;
    foreach ($ihre as $key => $i) {
        if (!isset($unsere[$key])) {
            $nurIhre++;
            continue;
        }
        if (($ihreZahl[$key] ?? 0) > 1 || ($unsereZahl[$key] ?? 0) > 1) {
            $mehrdeutig[] = $i['name'];
            continue;
        }
        $u = $unsere[$key];
        $paare[] = [
            'name'      => $u['name'],
            'ihr_name'  => $i['name'],
            'public_id' => $u['public_id'],
            'subtyp'    => $u['subtyp'],
            'gx'        => $i['gx'],
            'gy'        => $i['gy'],
            'ax'        => $u['ax'],
            'ay'        => $u['ay'],
        ];
    }

    return [
        'paare'   => $paare,
        'bericht' => [
            'lauf'                => $runId,
            'ihre_ortspunkte'     => count($ihre),
            'unsere_ortspunkte'   => count($unsere),
            'paare'               => count($paare),
            'mehrdeutig_verworfen'=> count($mehrdeutig),
            'mehrdeutige_namen'   => array_slice($mehrdeutig, 0, 40),
            'nur_bei_ihnen'       => $nurIhre,
        ],
    ];
}

/** Der juengste Import-Lauf, oder null. */
function avesmapsGaretienPasspunkteJuengsterLauf(PDO $pdo): ?int
{
    $stmt = $pdo->query('SELECT id FROM garetien_import_run ORDER BY id DESC LIMIT 1');
    $id   = $stmt->fetchColumn();

    return $id === false ? null : (int) $id;
}

/**
 * Die Selbstpruefung, ohne die dieser Leser nicht benutzt werden darf.
 *
 * 💣 EINE VERTAUSCHTE ACHSE SIEHT WIE EINE VERSCHOBENE KARTE AUS. Genau diese Falle hat der
 * Import schon einmal bezahlt (avesmapsGaretienGeoJsonNachHausvertrag, Uebernahme §uebernahme):
 * `[x,y]` gegen `[y,x]` spiegelt alles an der Diagonalen, und bei Objekten nahe der Diagonalen
 * merkt man es NICHT. Hier waere die Folge schlimmer als ein schiefes Bild: der Rechner meldete
 * dann einen gewaltigen, wunderbar zusammenhaengenden "Versatz" -- also genau das Ergebnis,
 * das jemanden dazu bringt, eine Korrekturmatrix zu bauen.
 *
 * Deshalb: der Median der Residuen MUSS in der Groessenordnung liegen, die Entwurf §2.1 fuer
 * diese Matrix belegt (1,24 Meilen, p90 3,5). Liegt er darueber, ist die Lesart verdaechtig
 * und nicht die Karte.
 *
 * @return array{ok:bool,median:float,p90:float,warnung:string}
 */
function avesmapsGaretienPasspunkteSelbstpruefung(array $paare, float $schranke = 15.0): array
{
    if (count($paare) < 10) {
        return ['ok' => false, 'median' => 0.0, 'p90' => 0.0,
                'warnung' => 'zu wenige Paare (' . count($paare) . ') fuer eine Aussage'];
    }

    $betraege = array_column(avesmapsGaretienPasspunktResiduen($paare), 'betrag');
    $median   = avesmapsGaretienPasspunktMedian($betraege);
    $p90      = avesmapsGaretienPasspunktQuantil($betraege, 0.9);

    return [
        'ok'      => $median <= $schranke,
        'median'  => $median,
        'p90'     => $p90,
        'warnung' => $median <= $schranke ? '' : sprintf(
            'Median %.1f Meilen -- Entwurf §2.1 belegt 1,24. Vor jeder Deutung pruefen: '
            . 'richtiger Lauf? Achsen vertauscht? Falschpaare nicht gefiltert?',
            $median
        ),
    ];
}
