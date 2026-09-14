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
 * ⭐ MIT EINER ENGEN AUSNAHME: eine Siedlung und ihr Bauwerk desselben Namens an derselben Stelle
 * sind EIN Ort (avesmapsGaretienPasspunktDoppelungAufloesen). "Eslamsroden" fehlte deshalb im
 * Messlauf vom 14.09.2026 und musste von Hand gepaart werden.
 *
 * 🔴 UND DANACH DER RIEGEL GEGEN FALSCHPAARE. Ein Name, der auf jeder Karte nur EINMAL vorkommt,
 * ist trotzdem kein Beleg: 37 von 204 Paaren desselben Laufs waren gleichnamige, aber andere Orte,
 * 31 davon ueber 200 Meilen daneben -- und alle kamen an der Regel oben vorbei. Sie werden mit dem
 * geteilten Riegel abgetrennt (avesmapsGaretienPasspunkteFalschpaareAbtrennen) und reisen mit
 * Namen und Betrag zurueck, nie still.
 *
 * @param PDO      $pdo
 * @param int|null $runId  null = der juengste Lauf
 * @return array{paare:array,falschpaare:array,bericht:array}
 */
function avesmapsGaretienPasspunkteLesen(PDO $pdo, ?int $runId = null): array
{
    $runId ??= avesmapsGaretienPasspunkteJuengsterLauf($pdo);
    if ($runId === null) {
        return ['paare' => [], 'falschpaare' => [], 'bericht' => ['grund' => 'kein Import-Lauf vorhanden']];
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

    // Je Name ALLE Vorkommen -- ob ein doppelter Name trotzdem ein Ort ist, entscheidet erst
    // avesmapsGaretienPasspunktDoppelungAufloesen, und die braucht jedes davon.
    $ihre = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $punkte = avesmapsGaretienParseKoordinaten((string) ($zeile['geo'] ?? ''));
        // Ein Ort ist EIN Punkt. Mehrere Punkte heissen: das ist kein Ort, sondern ein Umriss.
        if (count($punkte) !== 1) {
            continue;
        }
        [$gx, $gy] = $punkte[0];
        // 💣 Die Marke "existiert, aber noch nicht platziert" (2000000 2000000) ist KEIN Ort.
        if (!avesmapsGaretienPasspunktIstPlatziert((float) $gx, (float) $gy)) {
            continue;
        }
        $name = trim((string) ($zeile['anzeige'] ?? '')) ?: trim((string) ($zeile['artikel'] ?? ''));
        $key  = avesmapsGaretienNamenNormalisiert($name);
        if ($key === '') {
            continue;
        }
        // Die Doppelungsregel misst in UNSEREN Einheiten -- dort ist die Punkt-Trefferschwelle definiert.
        [$x, $y] = avesmapsGaretienNachAvesmaps((float) $gx, (float) $gy);
        $ihre[$key][] = [
            'name'   => $name,
            'gx'     => (float) $gx,
            'gy'     => (float) $gy,
            'x'      => $x,
            'y'      => $y,
            'klasse' => (string) (AVESMAPS_GARETIEN_TYP_MAP[(string) $zeile['typ']]['subtyp'] ?? ''),
        ];
    }

    // --- Unsere Seite: alle aktiven Ortspunkte.
    $stmt = $pdo->query(
        'SELECT public_id, name, feature_subtype, geometry_json FROM map_features'
        . ' WHERE feature_type = \'location\' AND is_active = 1'
    );

    $unsere = [];
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
        $unsere[$key][] = [
            'name'      => (string) $zeile['name'],
            'public_id' => (string) $zeile['public_id'],
            'subtyp'    => (string) $zeile['feature_subtype'],
            'ax'        => (float) $ax,
            'ay'        => (float) $ay,
            'x'         => (float) $ax,
            'y'         => (float) $ay,
            'klasse'    => (string) $zeile['feature_subtype'],
        ];
    }

    // --- Paaren. Nur Namen, die auf BEIDEN Seiten einen einzigen Ort bezeichnen.
    $paare      = [];
    $mehrdeutig = [];
    $aufgeloest = [];
    $nurIhre    = 0;
    foreach ($ihre as $key => $ihrVorkommen) {
        if (!isset($unsere[$key])) {
            $nurIhre++;
            continue;
        }
        $ihrIndex    = avesmapsGaretienPasspunktDoppelungAufloesen($ihrVorkommen);
        $unserIndex  = avesmapsGaretienPasspunktDoppelungAufloesen($unsere[$key]);
        if ($ihrIndex === null || $unserIndex === null) {
            $mehrdeutig[] = $ihrVorkommen[0]['name'];
            continue;
        }
        $i = $ihrVorkommen[$ihrIndex];
        $u = $unsere[$key][$unserIndex];
        if (count($ihrVorkommen) > 1 || count($unsere[$key]) > 1) {
            $aufgeloest[] = $u['name'];
        }
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

    $schnitt = avesmapsGaretienPasspunkteFalschpaareAbtrennen($paare);

    return [
        'paare'       => $schnitt['paare'],
        'falschpaare' => $schnitt['falschpaare'],
        'bericht'     => [
            'lauf'                       => $runId,
            'ihre_ortspunkte'            => count($ihre),
            'unsere_ortspunkte'          => count($unsere),
            'paare'                      => count($schnitt['paare']),
            'mehrdeutig_verworfen'       => count($mehrdeutig),
            'mehrdeutige_namen'          => array_slice($mehrdeutig, 0, 40),
            'doppelungen_aufgeloest'     => $aufgeloest,
            'falschpaare_verworfen'      => count($schnitt['falschpaare']),
            'falschpaar_schranke_meilen' => $schnitt['schranke_meilen'],
            'falschpaare'                => $schnitt['falschpaare'],
            'nur_bei_ihnen'              => $nurIhre,
        ],
    ];
}

/**
 * Welches Vorkommen eines mehrfach vergebenen Namens ist der Passpunkt -- oder keines?
 *
 * ⭐ DIE EINE AUSNAHME VOM MEHRDEUTIGKEITSFILTER. Messlauf 14.09.2026 (Entwurf §3.1): Garetien
 * fuehrt "Eslamsroden" als Burg UND als Reichsstadt, 0,85 Meilen auseinander -- derselbe Ort, und
 * einer der elf von den Editoren genannten Kalibrierorte fiel deshalb heraus.
 *
 * 🔴 DIE AUSNAHME IST ENG, und jede ihrer Bedingungen traegt:
 *   - GENAU EINE Siedlung. Zwei Siedlungen desselben Namens sind zwei Orte ("Waldheim"), auch
 *     dicht beieinander; welche unsere ist, sagt keine Regel.
 *   - alle anderen Vorkommen sind folglich Bauwerke (avesmapsIstBauwerksklasse, nie ein
 *     Vergleich auf einen einzelnen Klassenwert).
 *   - jedes davon liegt innerhalb der Punkt-Trefferschwelle des Importers von der Siedlung
 *     (AVESMAPS_GARETIEN_TREFFER_EINHEITEN_PUNKT, 0,3 Einheiten = 0,9 Meilen). Bis dahin nennt der
 *     Abgleich einen Punkt "an derselben Stelle", und dort ist sie gemessen: eine Burg und ihr Dorf
 *     teilen sich in diesem Kartenwerk oft die Koordinate. Keine eigene Zahl.
 * ⚠️ Eslamsroden liegt mit 0,85 Meilen knapp darunter -- gemessen ist die Regel an genau diesem
 * einen Fall. Eine Burg eine Meile vor der Stadt bleibt mehrdeutig: ein Passpunkt zu wenig kostet
 * Genauigkeit, ein falscher kostet die Aussage.
 * ⚠️ Gilt BEIDEN Karten. Der Aufrufer gibt die Lage in Karteneinheiten, ihre also umgerechnet.
 *
 * @param list<array{x:float,y:float,klasse:string}> $vorkommen
 * @return int|null  Index des Passpunkts; null = mehrdeutig
 */
function avesmapsGaretienPasspunktDoppelungAufloesen(array $vorkommen): ?int
{
    if (count($vorkommen) === 1) {
        return array_key_first($vorkommen);
    }

    $siedlungen = [];
    foreach ($vorkommen as $i => $v) {
        if (!avesmapsIstBauwerksklasse((string) $v['klasse'])) {
            $siedlungen[] = $i;
        }
    }
    if (count($siedlungen) !== 1) {
        return null;
    }

    $siedlung = $vorkommen[$siedlungen[0]];
    foreach ($vorkommen as $i => $v) {
        if ($i === $siedlungen[0]) {
            continue;
        }
        if (hypot($v['x'] - $siedlung['x'], $v['y'] - $siedlung['y']) > AVESMAPS_GARETIEN_TREFFER_EINHEITEN_PUNKT) {
            return null;
        }
    }

    return $siedlungen[0];
}

/** Der juengste Import-Lauf, oder null. */
function avesmapsGaretienPasspunkteJuengsterLauf(PDO $pdo): ?int
{
    $stmt = $pdo->query('SELECT id FROM garetien_import_run ORDER BY id DESC LIMIT 1');
    $id   = $stmt->fetchColumn();

    return $id === false ? null : (int) $id;
}

// Die Selbstpruefung, ohne die dieser Leser nicht benutzt werden darf, steht seit dem 14.09.2026 in
// garetien-passpunkte.php (avesmapsGaretienPasspunkteSelbstpruefung): das Auswertungswerkzeug fragt
// sie ebenso, und bis dahin fuehrte es eine eigene, abweichende Fassung.
