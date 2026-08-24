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
// Der EINE Aufloeser Label -> Region (beidseitig). Der Umstelllauf unten braucht ihn; eine eigene,
// einseitige Abfrage haette die zweiten und dritten Labels einer Flaeche uebersehen.
require_once __DIR__ . '/ecosystem-label-link.php';

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

// Was von einem Kurven-Nachrechnen in die ANTWORT gehoert -- oder gar nichts.
//
// 🔴 WARUM ES DAS GIBT (Owner 24.08.2026: „speichern loest aber nicht automatisch ‚Labelkurve
// aktualisieren‘ aus"). Gerechnet hat `update_region` seit dem 23.08. schon; die fertige Kurve kam nur
// nie beim Browser an. Der Kartenpayload wird nach einem Speichern nicht neu geholt -- ohne die Linie
// in der Antwort bleibt das Bild stehen, und das Einschalten sieht aus wie eine Aktion ohne Wirkung.
//
// 🔴 DIESELBEN SCHLUESSEL WIE BEIM MENUEKNOPF `refresh_curve` (`curve_label_line`, `curve_label_max`).
// Der Browser wendet beide Antworten mit demselben Aufruf an (avesmapsCurveSettingAufLabelsAnwenden);
// zwei Formen fuer dieselbe Kurve waeren die Stelle, an der die Koordinaten irgendwann auseinander
// laufen -- die Konvention steht in AGENTS.md §5, und ein zweiter Dreh-Weg hat sie schon einmal
// gekostet.
//
// ⚠️ `null` heisst „es wurde gar nicht gerechnet" (die Einstellung kam nicht mit) und ergibt einen
// LEEREN Anteil -- nicht etwa eine leere Kurve. Der Unterschied ist tragend: eine mitgeschickte leere
// Linie hiesse fuer den Browser „diese Region hat keine Kurve", und er nimmt eine bestehende weg.
//
// @param array{line?:mixed, max?:mixed, gerechnet?:mixed}|null $ergebnis
function avesmapsCurveAntwortAnteil(?array $ergebnis): array
{
    if ($ergebnis === null) {
        return [];
    }

    return [
        'curve_label_line' => $ergebnis['line'] ?? null,
        'curve_label_max' => avesmapsCurveClampMaxLabels((int) ($ergebnis['max'] ?? 1)),
        'curve_gerechnet' => (bool) ($ergebnis['gerechnet'] ?? false),
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

// Der Merker des Umstelllaufs. Eigene Funktion statt einer nackten Konstante -- dieselbe Begruendung
// wie bei avesmapsCurveCacheKey darunter.
function avesmapsCurveRolloutKey(): string
{
    return 'curve_label_rollout_done';
}

// DER EINMALIGE UMSTELLLAUF (Entwurf §8.2).
//
// 🔴 Owner-Entscheid: „Alle Flaechen, die jetzt ueber eine Rotation != 0 verfuegen sollen automatisch
// ein Kurvenlabel erhalten.“ Die REGEL steckt in avesmapsCurveLabelRolloutFor (Winkel modulo 360,
// Anzahl = Zahl der vorhandenen Labels, gedeckelt auf 3); hier steht nur, WORAUF sie laeuft.
//
// 💣 EINMALIG -- und der Riegel ist ein app_setting-Merker, KEINE Pruefung je Region. Der Grund ist
// die Ablage selbst: „aus“ ENTFERNT den Schluessel (avesmapsCurveLabelApplyToProperties), „nie
// entschieden“ ist also von „bewusst abgeschaltet“ nicht zu unterscheiden. Ohne den Merker holte
// jeder zweite Lauf jede Abschaltung zurueck, die ein Editor seither vorgenommen hat -- und zwar
// lautlos.
//
// 💣 Die Zuordnung Label -> Region kommt aus avesmapsEcosystemReadLabelRegionMap, dem EINEN
// Aufloeser des Hauses. Sie ist BEIDSEITIG (Zeiger am Label und label_public_id an der Region); eine
// eigene, einseitige Abfrage haette die zweiten und dritten Labels einer Flaeche uebersehen -- und
// genau die sind der Grund fuer die Anzahl.
//
// ⚠️ `$erzwingen` ist fuer den Fall gedacht, dass der Lauf nachweislich nichts getan hat, nicht fuer
// den taeglichen Gebrauch.
//
// @return array{ran:bool, reason:string, regions:int, changed:int}
function avesmapsCurveRolloutFromRotations(PDO $pdo, bool $erzwingen = false): array
{
    if (!$erzwingen && avesmapsAppSettingGet($pdo, avesmapsCurveRolloutKey(), '') !== '') {
        return ['ran' => false, 'reason' => 'already', 'regions' => 0, 'changed' => 0];
    }

    $karte = avesmapsEcosystemReadLabelRegionMap($pdo);
    $byLabel = is_array($karte['by_label'] ?? null) ? $karte['by_label'] : [];
    if ($byLabel === []) {
        // ⚠️ Kein Merker: nichts gefunden heisst hier „die Zuordnung war leer“, nicht „fertig“.
        return ['ran' => false, 'reason' => 'no_labels', 'regions' => 0, 'changed' => 0];
    }

    // Die Drehungen je Region einsammeln. Ein Label ohne `rotation` zaehlt als 0 -- es IST ein Label
    // der Region und geht in die ANZAHL ein, nur nicht in die Entscheidung „gedreht“.
    $statement = $pdo->query(
        "SELECT public_id, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1"
    );
    $rotationsByRegion = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $labelId = (string) $row['public_id'];
        $regionId = (string) ($byLabel[$labelId] ?? '');
        if ($regionId === '') {
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $rotationsByRegion[$regionId][] = is_array($properties) ? (int) ($properties['rotation'] ?? 0) : 0;
    }

    $regionStatement = $pdo->query(
        'SELECT public_id, properties_json FROM ecosystem_region WHERE is_active = 1'
    );
    $update = $pdo->prepare(
        'UPDATE ecosystem_region SET properties_json = :p WHERE public_id = :id'
    );
    $geaendert = 0;
    $betroffen = 0;
    foreach ($regionStatement === false ? [] : $regionStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $regionId = (string) $row['public_id'];
        if (!isset($rotationsByRegion[$regionId])) {
            continue;
        }
        $betroffen++;
        $regel = avesmapsCurveLabelRolloutFor($rotationsByRegion[$regionId]);
        // 🔴 NUR EINSCHALTEN. Ein „aus“ zu schreiben waere hier sinnlos (der Leser haelt einen
        // fehlenden Schluessel ohnehin fuer aus) und gefaehrlich, sobald jemand den Lauf erzwingt:
        // es naehme eine Handentscheidung zurueck, statt sie nur nicht zu setzen.
        if (!$regel['enabled']) {
            continue;
        }
        $felder = avesmapsCurveLabelApplyToProperties(
            $row['properties_json'] === null ? null : (string) $row['properties_json'],
            true,
            $regel['max_labels']
        );
        if ($felder === []) {
            continue;
        }
        $update->execute([':p' => $felder['properties_json'], ':id' => $regionId]);
        $geaendert++;
    }

    avesmapsAppSettingSet($pdo, avesmapsCurveRolloutKey(), (string) $geaendert);

    return ['ran' => true, 'reason' => 'ok', 'regions' => $betroffen, 'changed' => $geaendert];
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
        // 🔴 DIE EINSTELLUNG REIST MIT -- der Zwischenspeicher allein genuegt NICHT. Er kennt nur den
        // Fingerabdruck der Geometrie; ob die Region ihre Kurve ueberhaupt WILL, steht in
        // properties_json. Ohne diese Spalte lieferte der Lesepfad die gespeicherte Kurve auch an
        // eine laengst abgeschaltete Region weiter: „Kurvenbeschriftung aus" hielt bis zum naechsten
        // Neuladen und war dann wieder da. Am 23.08.2026 im Browser des Owners gemessen
        // (Salamandersteine: in der Datenbank aus, nach dem Neuladen wieder gebogen).
        //
        // ⭐ UND WEITERHIN EINE EINZIGE ABFRAGE. Die Aggregation wandert in eine Ableitungstabelle,
        // damit die aeussere Abfrage OHNE GROUP BY auskommt -- ein `GROUP BY` ueber eine
        // JSON-Spalte ist in MySQL nicht verlaesslich, und eine zweite Abfrage auf dem heissen
        // Lesepfad ist genau die Last, die AGENTS.md §11 bei den Zoombaendern anschreibt.
        $stmt = $pdo->query(
            'SELECT r.public_id AS region_id, r.properties_json AS props, x.rev, x.cnt
             FROM ecosystem_region r
             INNER JOIN (
                 SELECT region_id, SUM(geometry_revision) AS rev, COUNT(*) AS cnt
                 FROM ecosystem_area
                 WHERE is_active = 1
                 GROUP BY region_id
             ) x ON x.region_id = r.id
             WHERE r.is_active = 1'
        );
        $rows = $stmt !== false ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        // ⚠️ Still, aber nicht blind: ohne diese Zeile ist eine Absage von aussen unauffindbar.
        error_log('avesmapsCurveReadBaselines (Revisionen): ' . $e->getMessage());

        return [];
    }
    $revisionByRegion = [];
    $maxByRegion = [];
    foreach ($rows as $row) {
        $props = json_decode((string) ($row['props'] ?? ''), true);
        $einstellung = avesmapsCurveLabelSettingsFromProperties(is_array($props) ? $props : null);
        // 🔴 AUSGESCHALTET HEISST: GAR NICHT ERST ANBIETEN. Der Zwischenspeicher darf ruhig noch eine
        // Kurve fuer diese Region halten -- der naechste Sammellauf raeumt sie weg. Bis dahin
        // entscheidet die EINSTELLUNG, nicht die Ablage.
        if (!$einstellung['enabled']) {
            continue;
        }
        $id = (string) $row['region_id'];
        $revisionByRegion[$id] = ['rev' => (int) $row['rev'], 'cnt' => (int) $row['cnt']];
        $maxByRegion[$id] = $einstellung['max_labels'];
    }
    if ($revisionByRegion === []) {
        return [];
    }

    $baselines = avesmapsCurveBaselinesFromCache($json, $revisionByRegion);
    // ⭐ Und die ANZAHL kommt ebenfalls aus der Einstellung, nicht aus der Ablage: so wirkt ein
    // geaendertes „Max. Namen" beim naechsten Laden, ohne dass jemand den Sammellauf fahren muss.
    // Die KURVE braucht ihn weiterhin -- sie wird gerechnet, die Anzahl nur gelesen.
    foreach ($baselines as $id => $rec) {
        if (isset($maxByRegion[$id])) {
            $baselines[$id]['max_labels'] = $maxByRegion[$id];
        }
    }

    return $baselines;
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

// Die Kurve EINER Region neu rechnen und in die bestehende Ablage einmischen.
//
// 🔴 WARUM ES DAS GIBT (Owner 23.08.2026: „kurvenbeschriftung funktioniert manchmal nicht"): die
// Kurve entsteht nur im Sammellauf. Wer den Haken setzte, sah bis zum naechsten Lauf gar nichts --
// „manchmal" war in Wahrheit „bei allem, was seit dem letzten Lauf eingeschaltet wurde". Gemessen
// an der Auenlandschaft „Pandlarilsau": Region `curve_label = true`, Label ohne Kurve.
// Einschalten und Sichtbarwerden waren zwei Schritte; jetzt ist es einer.
//
// ⚠️ EINE Region, nicht 51: der Sammellauf braucht rund 12 s, diese Funktion rechnet nur die
// Flaechen DIESER Region (typisch eine, 165-796 ms). Das ist die Groessenordnung eines Speicherns.
//
// 💣 EINMISCHEN, NICHT NEU BAUEN. Wer hier avesmapsCurveBuildCachePayload ueber nur EINE Region
// laufen laesst und das Ergebnis ablegt, loescht die Kurven der uebrigen 50 -- und niemand merkt es,
// bis jemand die Karte neu laedt.
// ⚠️ Es bleibt ein Lesen-Aendern-Schreiben: speichern zwei Editoren im selben Augenblick zwei
// verschiedene Regionen, kann eine der beiden Aenderungen verlorengehen. Bei der Zahl der Editoren
// hingenommen; der Sammellauf richtet es in jedem Fall wieder.
//
// 🔴 AUSGESCHALTET HEISST: EINTRAG RAUS. Sonst bliebe die alte Kurve in der Ablage stehen, und der
// Lesepfad haengt zwar nicht mehr an ihr (er prueft die Einstellung), aber die Nutzlast truege sie
// weiter mit.
//
// ⭐ Die gerechnete Linie kommt MIT heraus, nicht nur ein Erfolgsvermerk: der Aufrufer im Browser
// haelt sonst weiter den alten Kartenpayload, und der Knopf sieht wirkungslos aus -- genau der
// Fehler, der am 23.08.2026 dreimal gemeldet wurde.
//
// @return array{ok:bool, gerechnet:bool, bytes:int, line:?array, max:int}
function avesmapsCurveRefreshCacheForRegion(PDO $pdo, string $regionPublicId): array
{
    $regionPublicId = trim($regionPublicId);
    if ($regionPublicId === '') {
    return ['ok' => false, 'gerechnet' => false, 'bytes' => 0, 'line' => null, 'max' => 1];
    }

    $stmt = $pdo->prepare(
        'SELECT r.public_id AS region_id, r.properties_json,
                a.geometry_geojson, a.geometry_revision
         FROM ecosystem_region r
         INNER JOIN ecosystem_area a ON a.region_id = r.id AND a.is_active = 1
         WHERE r.is_active = 1 AND r.public_id = :pid'
    );
    $stmt->execute([':pid' => $regionPublicId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Dieselbe Sammlung wie im Sammellauf -- bewusst dieselbe Form, damit beide durch DENSELBEN
    // Rechner gehen (avesmapsCurveBuildCachePayload). Zwei Rechner fuer dieselbe Kurve waeren die
    // zweite Wahrheit, an der frueher oder spaeter Sammellauf und Einzellauf auseinanderlaufen.
    $regionen = [];
    foreach ($rows as $row) {
        $id = (string) $row['region_id'];
        if (!isset($regionen[$id])) {
            $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
            $regionen[$id] = [
                'rev' => 0,
                'cnt' => 0,
                'settings' => avesmapsCurveLabelSettingsFromProperties(is_array($properties) ? $properties : null),
                'geometries' => [],
            ];
        }
        $regionen[$id]['rev'] += (int) $row['geometry_revision'];
        $regionen[$id]['cnt']++;
        if (!$regionen[$id]['settings']['enabled']) {
            continue;
        }
        $geom = json_decode((string) $row['geometry_geojson'], true);
        if (is_array($geom)) {
            $regionen[$id]['geometries'][] = $geom;
        }
    }

    $frisch = json_decode(avesmapsCurveBuildCachePayload($regionen), true);
    $eintrag = (is_array($frisch) && is_array($frisch['regions'] ?? null))
        ? ($frisch['regions'][$regionPublicId] ?? null)
        : null;

    $alt = json_decode(avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), ''), true);
    $regions = (is_array($alt) && ($alt['version'] ?? null) === 1 && is_array($alt['regions'] ?? null))
        ? $alt['regions']
        : [];
    if ($eintrag === null) {
        unset($regions[$regionPublicId]);
    } else {
        $regions[$regionPublicId] = $eintrag;
    }

    // Dieselben Flags wie im Sammellauf -- siehe dort zu JSON_PRESERVE_ZERO_FRACTION.
    $json = (string) json_encode(['version' => 1, 'regions' => (object) $regions], JSON_PRESERVE_ZERO_FRACTION);
    avesmapsAppSettingEnsureWideValue($pdo);
    avesmapsAppSettingSet($pdo, avesmapsCurveCacheKey(), $json);

    // 💣 ZURUECKLESEN, aus demselben Grund wie im Sammellauf: eine stille MySQL-Kuerzung ist von
    // „nie geschrieben" nicht zu unterscheiden.
    $zurueck = avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), '');

    return [
        'ok' => $zurueck === $json,
        'gerechnet' => $eintrag !== null,
        'bytes' => strlen($json),
        'line' => is_array($eintrag) ? ($eintrag['line'] ?? null) : null,
        'max' => is_array($eintrag) ? (int) ($eintrag['max'] ?? 1) : 1,
    ];
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
