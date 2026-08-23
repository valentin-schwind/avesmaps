<?php

declare(strict_types=1);

// Die Kurvenbeschriftung je REGION lesen und ans Label haengen.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §2, §8
//
// 🔴 DIE EINSTELLUNG GEHOERT DER REGION, nicht dem Label und nicht der Flaeche (Owner 22.08.2026).
// Eine Region traegt N Labels und M Flaechen; der Wert existiert genau einmal, in
// ecosystem_region.properties_json. Die Spalte gibt es bereits -- kein DDL.

require_once __DIR__ . '/curve-labels.php';
require_once __DIR__ . '/app-setting.php';

const AVESMAPS_CURVE_LABEL_MAX = 3;

// 💣 Befund 7 der Zweigpruefung: derselbe Klemmausdruck stand VIERMAL in dieser Datei. Ein Helfer
// statt vier Abschriften -- eine kuenftige Aenderung des Deckels traefe sonst leicht nur drei von
// vier Stellen, wie es bei abgeschriebenem Code passiert.
function avesmapsCurveClampMaxLabels(int $n): int
{
    return max(1, min(AVESMAPS_CURVE_LABEL_MAX, $n));
}

// 🔴 Fehlt der Schluessel, ist die Kurvenbeschriftung AUS. Die beiden Fehlrichtungen sind nicht
// gleich teuer: „aus" laesst alles, wie es ist, „an" stellt 657 Labels auf einen Schlag um.
function avesmapsCurveLabelSettingsFromProperties(?array $properties): array
{
    $roh = $properties['curve_label'] ?? null;
    $an = $roh === true || $roh === 1 || $roh === '1';
    $max = $properties['curve_label_max'] ?? null;
    $zahl = is_int($max) || (is_string($max) && ctype_digit($max)) || is_float($max) ? (int) $max : 1;

    return [
        'enabled' => $an,
        'max_labels' => avesmapsCurveClampMaxLabels($zahl),
    ];
}

// Die Kurveneinstellung einer Region FORTSCHREIBEN. Leeres Ergebnis = nichts zu schreiben.
//
// 💣 GESCHRIEBEN WIRD NUR, WAS DER AUFRUFER AUSDRUECKLICH NENNT (Entwurf §2). Der Wert steht an
// ZWEI Oberflaechen -- Beschriftungsdialog und Flaechendialog -- und beide speichern dieselbe Region.
// Steht der eine offen, waehrend jemand im anderen umstellt, naehme sein Speichern die Aenderung
// sonst wortlos zurueck. Deshalb heisst `null` hier „nicht genannt“ und NICHT „aus“ -- derselbe
// Fehler wie in avesmapsUpsertGameLiterature, das jedes MITGESCHICKTE Feld schrieb statt jedes
// GEAENDERTEN (AGENTS.md §11, Wiki-Override).
//
// 🔴 „Aus“ ENTFERNT den Schluessel, statt `false` abzulegen -- dieselbe Regel wie beim Merker
// wiki_no_article nebenan (avesmapsEcosystemApplyRegionNoArticle): der Leser oben haelt einen
// fehlenden Schluessel ohnehin fuer „aus“, und ein `false` waere ein zweiter Weg, dasselbe zu sagen.
//
// ⚠️ Die Zahl laeuft durch avesmapsCurveClampMaxLabels -- den EINEN Deckel dieser Datei, nie
// durch eine abgeschriebene 3.
//
// @param ?string $propertiesJson die Ablage VOR dem Schreiben
// @param ?bool   $an             true/false = genannt, null = nicht genannt
// @param ?int    $max            Zahl = genannt, null = nicht genannt
// @return array<string,?string>  `['properties_json' => …]` oder `[]`
function avesmapsCurveLabelApplyToProperties(?string $propertiesJson, ?bool $an, ?int $max): array
{
    if ($an === null && $max === null) {
        return [];
    }
    $properties = json_decode((string) ($propertiesJson ?? ''), true);
    if (!is_array($properties)) {
        $properties = [];
    }
    if ($an !== null) {
        if ($an) {
            $properties['curve_label'] = true;
        } else {
            unset($properties['curve_label']);
        }
    }
    if ($max !== null) {
        $properties['curve_label_max'] = avesmapsCurveClampMaxLabels($max);
    }

    return [
        'properties_json' => $properties === []
            ? null
            : json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
    ];
}

// Der Umstellzustand, aus den Daten statt aus einer Vermutung: eine Region, deren Labels heute
// gedreht sind, bekommt die Kurve -- und so viele Namen, wie sie Labels hat.
//
// 💣 Der Winkel wird MODULO 360 geprueft, nicht auf „ungleich 0". Von den 83 derographischen Labels
// ist genau eines gedreht: „Weiden" mit 360 Grad -- sichtbar identisch mit 0, numerisch verschieden.
// Roh geprueft schaltet die Regel dort eine Kurve ein, wo niemand etwas gedreht haben wollte.
// ⚠️ Dieselbe Normalisierung benutzt der Zeichner heute schon (createLabelIcon in
// js/map-features/map-features-labels.js) -- zwei Stellen, die denselben Wert verschieden lesen,
// widersprechen sich frueher oder spaeter sichtbar.
function avesmapsCurveLabelRolloutFor(array $rotations): array
{
    if ($rotations === []) {
        return ['enabled' => false, 'max_labels' => 1];
    }
    $gedreht = false;
    foreach ($rotations as $r) {
        if (((((int) $r) % 360) + 360) % 360 !== 0) {
            $gedreht = true;
            break;
        }
    }

    return [
        'enabled' => $gedreht,
        'max_labels' => avesmapsCurveClampMaxLabels(count($rotations)),
    ];
}

// Die Kurve an jedes Label haengen, dessen Region eine hat.
//
// 🔴 EMITTIERT, NICHT GESPEICHERT -- dieselbe Haltung wie bei
// avesmapsEcosystemApplyLabelRegionsToFeatures: die dauerhafte Wahrheit ist die Geometrie plus die
// Einstellung an der Region. Die Kurve ist ihre abgeleitete Ansicht.
//
// 🔴 Fehlt die Kurve, fehlt der SCHLUESSEL -- nicht `null`, nicht `[]`. Der Client unterscheidet
// „hat keine Kurve" an der Abwesenheit; ein leeres Feld waere eine leere Kurve, und die zeichnet
// sich als Nichts statt als Gerade.
//
// @param list<array<string,mixed>> $features gebaute GeoJSON-Features (wird veraendert)
// @param array<string,array{line:list<array{0:float,1:float}>,max_labels:int}> $byRegion
function avesmapsCurveApplyToFeatures(array &$features, array $byRegion): void
{
    if ($byRegion === []) {
        return;
    }
    foreach ($features as $i => $feature) {
        $properties = $feature['properties'] ?? null;
        if (!is_array($properties) || (string) ($properties['feature_type'] ?? '') !== 'label') {
            continue;
        }
        $regionId = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
        if ($regionId === '' || !isset($byRegion[$regionId])) {
            continue;
        }
        $features[$i]['properties']['curve_label_line'] = $byRegion[$regionId]['line'];
        $features[$i]['properties']['curve_label_max'] = $byRegion[$regionId]['max_labels'];
    }
}

// Der Schluessel des Zwischenspeichers. Eigene Funktion statt einer nackten Konstante, damit der
// Sammellauf (api/edit/map/curve-labels-run.php) und der Leser sich nicht auf zwei Schreibweisen
// desselben Wortes verlassen.
function avesmapsCurveCacheKey(): string
{
    return 'curve_label_baselines';
}

// Die Zahl der Punkte, mit denen eine Kurve AUSGELIEFERT wird. Gerechnet wird mit 120 (das braucht
// der Polynomfit), geliefert werden 32 -- gemessen 433 Byte je Kurve, gegen 1,7 KB bei 120.
// ⚠️ Nicht mit `samples` im Optionsfeld verwechseln: das ist die Rechen-, dies die Lieferdichte.
const AVESMAPS_CURVE_LABEL_PAYLOAD_POINTS = 32;

// Den abgelegten Zwischenspeicher lesen und gegen den heutigen Fingerabdruck der Region halten.
//
// 🔴 Reine Funktion, damit sie ohne DB testbar ist -- dieselbe Trennung wie in
// ecosystem-label-link.php. Der PDO-Teil steht in avesmapsCurveReadBaselines darunter.
//
// 💣 Ein unlesbarer, leerer oder zu neuer Zwischenspeicher ergibt LEER. Nie eine halbe Kurve, nie
// eine Ausnahme: der Lesepfad einer Karte darf an einer Beschriftung nicht scheitern.
//
// 💣 Befund 8 der Zweigpruefung: SUM(geometry_revision) ALLEIN ist kein Fingerabdruck. Eine
// Region, die eine Flaeche der Revision 3 stilllegt, und eine andere, deren EINE Flaeche dreimal
// bearbeitet wurde (Revision 1+1+1), ergeben beide die Summe 3 -- obwohl sich die Zahl ihrer
// Flaechen ("Lappen") unterscheidet. Der Fingerabdruck ist deshalb das PAAR aus Revisionssumme UND
// Flaechenzahl (`cnt`): aendert sich nur die Zahl der aktiven Flaechen, gilt die Kurve als
// veraltet, auch wenn die Summe zufaellig gleich bleibt.
//
// @param array<string,array{rev:int,cnt:int}> $revisionByRegion region public_id => Fingerabdruck
// @return array<string,array{line:list<array{0:float,1:float}>,max_labels:int}>
function avesmapsCurveBaselinesFromCache(string $json, array $revisionByRegion): array
{
    if (trim($json) === '') {
        return [];
    }
    $daten = json_decode($json, true);
    if (!is_array($daten) || ($daten['version'] ?? null) !== 1 || !is_array($daten['regions'] ?? null)) {
        return [];
    }
    $raus = [];
    foreach ($daten['regions'] as $regionId => $rec) {
        $regionId = (string) $regionId;
        if (!is_array($rec) || !isset($revisionByRegion[$regionId])) {
            continue;
        }
        // 💣 Veraltet heisst WEGLASSEN. Die alte Achse gehoert zu einer Geometrie, die es nicht mehr
        // gibt; eine Gerade ist schlichter, eine falsche Kurve ist ein Fehler, den niemand bemerkt.
        // Verglichen wird der VOLLE Fingerabdruck (Revisionssumme UND Flaechenzahl) -- eine reine
        // Summengleichheit haette eine stillgelegte Flaeche nicht bemerkt (Befund 8).
        $fingerabdruck = $revisionByRegion[$regionId];
        if ((int) ($rec['rev'] ?? -1) !== (int) $fingerabdruck['rev']
            || (int) ($rec['cnt'] ?? -1) !== (int) $fingerabdruck['cnt']) {
            continue;
        }
        $linie = $rec['line'] ?? null;
        if (!is_array($linie) || count($linie) < 2) {
            continue;
        }
        // 💣 Eine kaputte Koordinate wirft DIESE Region weg, nicht alle. Der erste Entwurf dieses
        // Plans stand hier auf `return []` -- und widersprach damit seiner eigenen Regel eine Zeile
        // weiter oben: jede andere Fehlerklasse (fehlende Linie, zu kurze Linie, veraltete Revision,
        // unbekannte Region) ueberspringt genau eine Region. Ein einziger verdorbener Punkt haette
        // die Kurven ALLER rund 56 Regionen geloescht, auf jeder Kartenanfrage, wortlos.
        // ⚠️ Kein `continue 2`, sondern ein Merker: `continue 2` in einer verschachtelten Schleife
        // liest sich wie ein Tippfehler, und diese Stelle wird von jemandem gelesen, der den Grund
        // nicht kennt.
        $sauber = [];
        $kaputt = false;
        foreach ($linie as $p) {
            if (!is_array($p) || count($p) < 2 || !is_numeric($p[0]) || !is_numeric($p[1])) {
                $kaputt = true;
                break;
            }
            $sauber[] = [(float) $p[0], (float) $p[1]];
        }
        if ($kaputt) {
            continue;
        }
        $raus[$regionId] = [
            'line' => $sauber,
            'max_labels' => avesmapsCurveClampMaxLabels((int) ($rec['max'] ?? 1)),
        ];
    }

    return $raus;
}

// Der Leser fuer den Endpunkt: EIN billiger app_setting-Lesevorgang, und NUR wenn der etwas
// enthaelt, eine leichte Aggregatabfrage.
//
// ⚠️ KEIN DDL (AGENTS.md §10) -- deshalb avesmapsAppSettingGetWithoutDdl und nicht ...Get.
// ⚠️ KEINE Berechnung. Wuerde dieser Leser die Kurve selbst rechnen, waeren das bei rund 50
// eingeschalteten Regionen und gemessenen 165-796 ms je Flaeche real 10-40 Sekunden auf JEDER
// Kartenanfrage -- die frueher angenommenen ~50 ms je Flaeche waren falsch (Befund 4 der
// Zweigpruefung). Der Leser tut das nie: er liest nur die billige Revisionssumme (Aggregatabfrage,
// gemessen unter 20 ms) und den vom Sammellauf (api/edit/map/curve-labels-run.php) bereits
// berechneten Zwischenspeicher.
//
// 🔴 Befund 9 der Zweigpruefung: ERST der billige Einzelsatz, DANN -- nur wenn er etwas enthaelt --
// die Aggregatabfrage. Solange niemand den Sammellauf ausgeloest hat (die gesamte Lebensdauer
// dieses Plans, bis Plan 4 die Kachel "Darstellung" bringt), ist der Zwischenspeicher leer, und die
// Aggregatabfrage waere auf JEDER oeffentlichen Kartenanfrage reine Verschwendung.
function avesmapsCurveReadBaselines(PDO $pdo): array
{
    try {
        $json = avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), '');
    } catch (Throwable $e) {
        error_log('avesmapsCurveReadBaselines (Zwischenspeicher): ' . $e->getMessage());

        return [];
    }
    if (trim($json) === '') {
        return [];
    }

    try {
        $stmt = $pdo->query(
            'SELECT r.public_id AS region_id, SUM(a.geometry_revision) AS rev, COUNT(*) AS cnt
             FROM ecosystem_region r
             INNER JOIN ecosystem_area a ON a.region_id = r.id AND a.is_active = 1
             WHERE r.is_active = 1
             GROUP BY r.public_id'
        );
        $rows = $stmt !== false ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        // ⚠️ Still, aber nicht blind: ohne diese Zeile ist eine Absage von aussen unauffindbar.
        error_log('avesmapsCurveReadBaselines (Revisionen): ' . $e->getMessage());

        return [];
    }
    $revisionByRegion = [];
    foreach ($rows as $row) {
        $revisionByRegion[(string) $row['region_id']] = ['rev' => (int) $row['rev'], 'cnt' => (int) $row['cnt']];
    }
    if ($revisionByRegion === []) {
        return [];
    }

    return avesmapsCurveBaselinesFromCache($json, $revisionByRegion);
}

// Aus den Regionen die Ablage bauen. Reine Funktion -- der PDO-Teil steht darunter.
//
// @param array<string,array{rev:int,cnt:int,settings:array{enabled:bool,max_labels:int},geometries:list<array<string,mixed>>}> $regionen
function avesmapsCurveBuildCachePayload(array $regionen): string
{
    $raus = [];
    foreach ($regionen as $regionId => $rec) {
        // 🔴 Eine ausgeschaltete Region steht NICHT in der Ablage. Sonst liefert jede Karte Kurven
        // aus, die niemand sehen soll -- und die Nutzlast waechst um Regionen ohne Nutzen.
        if (!($rec['settings']['enabled'] ?? false) || ($rec['geometries'] ?? []) === []) {
            continue;
        }
        $kurve = avesmapsCurveBaseline($rec['geometries'], []);
        if ($kurve === null) {
            continue;
        }
        $geliefert = avesmapsCurveResample($kurve['line'], AVESMAPS_CURVE_LABEL_PAYLOAD_POINTS);
        $linie = [];
        foreach ($geliefert as $p) {
            $linie[] = [round($p[0], 3), round($p[1], 3)];
        }
        $raus[(string) $regionId] = [
            'rev' => (int) ($rec['rev'] ?? 0),
            // 💣 Befund 8 der Zweigpruefung: die Flaechenzahl gehoert zum Fingerabdruck dazu, sonst
            // kollidiert eine stillgelegte Flaeche mit einer dreifach bearbeiteten (beide Summe 3,
            // siehe avesmapsCurveReadBaselines).
            'cnt' => (int) ($rec['cnt'] ?? 0),
            'max' => avesmapsCurveClampMaxLabels((int) ($rec['settings']['max_labels'] ?? 1)),
            'line' => $linie,
        ];
    }

    // 💣 JSON_PRESERVE_ZERO_FRACTION -- ohne das Flag schreibt json_encode ein glattes 0.0 als "0",
    // und json_decode liest ein "0" als int(0), nicht als float(0.0). Eine resamplete Achse trifft
    // ihren Rand oft exakt (Start-/Endpunkt einer Rechteck-Flaeche z.B. bei x=0.0/x=100.0) -- ohne
    // das Flag wechselt fuer genau diese Punkte still der Typ, und ein strikter Typvergleich nach
    // dem Ruecklesen (Test dieser Datei, „drei Nachkommastellen") schluege fehl, obwohl der Wert
    // unveraendert ist.
    return (string) json_encode(['version' => 1, 'regions' => (object) $raus], JSON_PRESERVE_ZERO_FRACTION);
}

// Der Sammellauf: alle Regionen lesen, rechnen, ablegen, ZURUECKLESEN.
//
// 💣 Der Schreibvorgang liest zurueck. app_setting.setting_value war einmal VARCHAR(255), und die
// erste Zeile mit echtem Inhalt wurde ausserhalb des strict mode lautlos abgeschnitten -- der
// Speichern-Knopf der Tempowerte tat daraufhin wochenlang nichts, ohne Fehler und ohne Warnung
// (AGENTS.md §10). Ein Marker darf bezeugen, dass etwas DA ist, nie dass ein Schreibvorgang
// ABGESETZT wurde.
//
// @return array{regions:int,bytes:int,ok:bool}
function avesmapsCurveRebuildCache(PDO $pdo): array
{
    $stmt = $pdo->query(
        'SELECT r.public_id AS region_id, r.properties_json,
                a.geometry_geojson, a.geometry_revision
         FROM ecosystem_region r
         INNER JOIN ecosystem_area a ON a.region_id = r.id AND a.is_active = 1
         WHERE r.is_active = 1'
    );
    $rows = $stmt !== false ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];

    $regionen = [];
    foreach ($rows as $row) {
        $regionId = (string) $row['region_id'];
        if (!isset($regionen[$regionId])) {
            $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
            $regionen[$regionId] = [
                'rev' => 0,
                'cnt' => 0,
                'settings' => avesmapsCurveLabelSettingsFromProperties(is_array($properties) ? $properties : null),
                'geometries' => [],
            ];
        }
        $regionen[$regionId]['rev'] += (int) $row['geometry_revision'];
        $regionen[$regionId]['cnt']++;
        // 💣 Befund 2 der Zweigpruefung: die Einstellung steht bereits beim ERSTEN Zeilentreffer der
        // Region fest (sie haengt an r.properties_json, nicht an der Flaeche) -- also NIE
        // json_decode()n, was avesmapsCurveBuildCachePayload ohnehin wegwirft, weil die Region
        // ausgeschaltet ist. Am Umstelltag sind das 56 von 644 gebrauchten Regionen -- 91 % waeren
        // verschwendetes json_decode ueber GeoJSON-Polygone von mitunter mehreren hundert KB, auf
        // einem STRATO-Worker ein "Allowed memory size exhausted", das mit einem LEEREN Rumpf
        // antwortet und im Browser wie ein Netzfehler aussieht (AGENTS.md §9).
        // ⚠️ Revisionssumme UND Flaechenzahl (Befund 8) werden dennoch fuer JEDE Region weitergefuehrt,
        // auch fuer ausgeschaltete -- das kostet nur zwei Ganzzahladditionen, und schaltet ein
        // Editor die Region spaeter wieder ein, muss ihr Fingerabdruck von Anfang an stimmen.
        if (!$regionen[$regionId]['settings']['enabled']) {
            continue;
        }
        $geom = json_decode((string) $row['geometry_geojson'], true);
        if (is_array($geom)) {
            $regionen[$regionId]['geometries'][] = $geom;
        }
    }

    $json = avesmapsCurveBuildCachePayload($regionen);
    avesmapsAppSettingEnsureWideValue($pdo);
    avesmapsAppSettingSet($pdo, avesmapsCurveCacheKey(), $json);

    // 💣 ZURUECKLESEN. Ohne diese Zeile meldet der Lauf Erfolg, waehrend MySQL gekuerzt hat.
    $zurueck = avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), '');
    $gezaehlt = json_decode($json, true)['regions'] ?? [];

    return [
        'regions' => is_array($gezaehlt) ? count($gezaehlt) : 0,
        'bytes' => strlen($json),
        'ok' => $zurueck === $json,
    ];
}
