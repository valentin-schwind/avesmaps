# „Kürzeste Route" im Gelände — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE UNTER-SKILL: `superpowers:executing-plans`
> (oder `subagent-driven-development`), Aufgabe für Aufgabe. Schritte tragen `- [ ]` zum Abhaken.

**Ziel:** Unter `optimize=shortest` minimiert eine Querfeldein-Etappe die **Strecke** statt der Zeit
— eine Gerade, die nur um Wasser herumgeht.

**Bauart:** Der Suchkern bekommt ein Argument, das die beiden Geländefaktoren **innerhalb der
Entspannung** neutralisiert. Davor steht ein Kurzschluss: ist die Gerade trocken
(`avesmapsRouteChordCrossesWater`), gibt es gar keinen Suchlauf. Gemessen wird in beiden Fällen mit
dem echten Gelände.

**Werkzeug:** PHP 8 (strict types), kein Framework, Tests sind nackte `assert()`-Skripte.

**Entwurf:** [2026-08-15-kuerzeste-route-gerade-linie-design.md](../specs/2026-08-15-kuerzeste-route-gerade-linie-design.md)

## Globale Randbedingungen

- **Geteilter Arbeitsbaum.** Niemals `git add -A`. Vor jedem Commit `git status`, nur eigene Pfade
  einzeln stagen (AGENTS.md §9).
- **Testfeld vor dem Push**, mit den Erweiterungen (AGENTS.md §9):
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <datei>`
  ⚠️ `linkcheck/link-url-test.php` ist vorbestehend rot (echter DNS-Abruf).
- **STRATO:** einzelne API-Proben, niemals Schleifen.
- 🔴 **Das neue Argument steht ganz hinten und hat einen Vorgabewert.** `offroad-astar-test.php`
  ruft `avesmapsOffroadFindPath` an neun Stellen **positionsbasiert** auf; ein Argument in der Mitte
  bricht alle neun.
- 🔴 **Der Modus ist ein Parameter, nie ein globaler Zustand** (Entwurf §3.4).
- Kommentare deutsch, Fallen mit 💣/⚠️/🔴 markieren, wie die Nachbarzeilen.
- Die Fallenliste in §7 des Entwurfs ist die Abnahmeliste.

---

## Dateiübersicht

| Datei | Rolle | Aufgabe |
|---|---|---|
| `api/_internal/routing/offroad-grid.php` | ändern | `$weightByDistance` in beiden Suchfunktionen; neu `avesmapsOffroadStraightPathIfDry` |
| `api/_internal/routing/offroad-leg.php` | ändern | beide Erzeuger lesen `optimize` und reichen es durch |
| `api/_internal/routing/synthetic-refine.php` | ändern | unter „Kürzeste" nicht biegen |
| `api/_internal/routing/__tests__/offroad-shortest-test.php` | neu | Aufgabe 1 + 2 |
| `api/_internal/routing/__tests__/kuerzeste-etappe-test.php` | neu | Aufgabe 3, der Abnahmefall |

---

## Aufgabe 1: Der Suchkern kennt das Gewicht

**Dateien:**
- Ändern: `api/_internal/routing/offroad-grid.php` (`avesmapsOffroadFindPath`,
  `avesmapsOffroadFindPathsFromPoint`)
- Test: `api/_internal/routing/__tests__/offroad-shortest-test.php`

**Schnittstellen:**
- Liefert: beide Funktionen bekommen als **letztes** Argument `bool $weightByDistance = false`.
  `true` heißt: die Entspannung setzt `$slopeFactor = 1.0` und `$groundFactor = 1.0`; alles andere,
  insbesondere die Übergabe von `$factors`/`$heights`/`$rasters` an `avesmapsOffroadFinishPath`,
  bleibt unverändert.

- [ ] **Schritt 1: Den roten Test schreiben**

Datei `api/_internal/routing/__tests__/offroad-shortest-test.php`:

```php
<?php
// api/_internal/routing/__tests__/offroad-shortest-test.php
declare(strict_types=1);

/**
 * „Kuerzeste" im Gelaende: das Gewicht ist die Strecke, nicht die Zeit.
 * Entwurf: docs/superpowers/specs/2026-08-15-kuerzeste-route-gerade-linie-design.md §3.2/§3.3
 *
 * 💣 DIE MESSUNG BLEIBT EHRLICH. Neutralisiert werden die beiden Faktoren NUR in der Entspannung.
 * Die Ebenen fliessen unveraendert an avesmapsOffroadFinishPath -- eine kuerzeste Etappe ohne
 * Reisezeit und ohne Anstieg waere die halbe Auskunft.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-shortest-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-grid.php';

$box = avesmapsBuildOffroadBox(0.0, 0.0, 20.0, 20.0);
$frei = str_repeat("\x00", $box['cell_count']);
$speed = 2.30;

// Ein langsamer Streifen quer im Weg: Faktor 4,0 zwischen y = 8 und y = 12.
// Der Zeitmodus geht darum herum, der Streckenmodus mitten hindurch.
$faktoren = str_repeat("\x00", $box['cell_count']);
for ($row = 0; $row < $box['rows']; $row++) {
    for ($col = 0; $col < $box['cols']; $col++) {
        [$cx, $cy] = avesmapsOffroadCellCentre($box, $col, $row);
        if ($cy >= 8.0 && $cy <= 12.0 && $cx <= 12.0) {
            $faktoren[$row * $box['cols'] + $col] = chr((int) round(4.0 * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE));
        }
    }
}

// ---- A: der Streckenmodus ist kuerzer, der Zeitmodus schneller ---------------------------
$zeit = avesmapsOffroadFindPath($box, $frei, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0);
$strecke = avesmapsOffroadFindPath($box, $frei, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);

assert(is_array($zeit) && is_array($strecke), 'beide Modi finden einen Weg');
assert($strecke['distance'] < $zeit['distance'] - 1e-6,
    'der Streckenmodus ist kuerzer: ' . $strecke['distance'] . ' gegen ' . $zeit['distance']);
assert($zeit['time'] < $strecke['time'] - 1e-6,
    'der Zeitmodus ist schneller: ' . $zeit['time'] . ' gegen ' . $strecke['time']);
// Die Luftlinie ist 12,0 -- der Streckenmodus muss ihr sehr nahe kommen.
assert($strecke['distance'] < 12.6,
    'der Streckenmodus geht praktisch gerade (Luftlinie 12,0): ' . $strecke['distance']);

// ---- B: 🔴 die Messung bleibt ehrlich ----------------------------------------------------
// Der Streckenmodus laeuft DURCH den teuren Streifen, also muss seine gemeldete Zeit den Faktor
// sehen. Waere die Faktorebene auch der Messung entzogen worden, kaeme Strecke/Tempo heraus.
assert($strecke['time'] > $strecke['distance'] / $speed + 1e-6,
    'die gemeldete Zeit traegt den Gelaendefaktor: ' . $strecke['time']
    . ' gegen ' . ($strecke['distance'] / $speed) . ' bei Faktor 1');

// ---- C: dasselbe mit Hoehen -- der Anstieg wird weiterhin gemeldet ------------------------
$hoehen = str_repeat("\x00", $box['cell_count'] * 2);
for ($row = 0; $row < $box['rows']; $row++) {
    for ($col = 0; $col < $box['cols']; $col++) {
        [$cx, $cy] = avesmapsOffroadCellCentre($box, $col, $row);
        $wert = (int) round(max(0.0, $cy) * 200.0);
        $index = $row * $box['cols'] + $col;
        $hoehen[$index * 2] = chr($wert & 0xFF);
        $hoehen[$index * 2 + 1] = chr(($wert >> 8) & 0xFF);
    }
}
$mitHoehe = avesmapsOffroadFindPath($box, $frei, null, $hoehen, $speed, 4.0, 4.0, 4.0, 16.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);
assert($mitHoehe['ascent_schritt'] !== null && $mitHoehe['ascent_schritt'] > 0,
    'der Anstieg wird gemeldet, auch im Streckenmodus: ' . var_export($mitHoehe['ascent_schritt'], true));

// ---- D: der Mehrziel-Lauf kennt dasselbe Argument ----------------------------------------
$viele = avesmapsOffroadFindPathsFromPoint($box, $frei, $faktoren, null, $speed, 4.0, 16.0,
    ['a' => ['x' => 4.0, 'y' => 4.0]], AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);
assert(abs($viele['a']['distance'] - $strecke['distance']) < 1e-6,
    'Mehrziel-Lauf und Einzellauf liefern im Streckenmodus dieselbe Laenge: '
    . $viele['a']['distance'] . ' gegen ' . $strecke['distance']);

// ---- E: ohne das Argument aendert sich NICHTS --------------------------------------------
$altAufruf = avesmapsOffroadFindPath($box, $frei, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0);
assert(abs($altAufruf['distance'] - $zeit['distance']) < 1e-12,
    'der Vorgabewert laesst den Zeitmodus voellig unberuehrt');

fwrite(STDOUT, "offroad-shortest-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/offroad-shortest-test.php
```

Erwartet: Abschnitt A schlägt fehl — beide Modi liefern heute dieselbe Strecke, weil das elfte
Argument noch ignoriert wird (PHP nimmt es kommentarlos entgegen und verwirft es).

🔴 Das ist der Rot-Beleg gegen den alten Stand. Die Ausgabe gehört ins Commit-Protokoll.

- [ ] **Schritt 3: Das Argument in `avesmapsOffroadFindPath` einbauen**

Signatur ergänzen (ganz hinten, mit Vorgabewert):

```php
    array $rasters = [],
    bool $weightByDistance = false
): ?array {
```

Und in der Entspannungsschleife, direkt vor der Kostenzeile:

```php
            // 🔴 „KUERZESTE" HEISST: DAS GEWICHT IST DIE STRECKE. Wald, Sumpf und Gebirge bremsen,
            // sie verlaengern nicht -- auf eine Meilenzahl haben sie keinen Einfluss, also hat eine
            // kuerzeste Linie keinen Grund, ihnen auszuweichen. Nur Wasser sperrt, und das steht
            // schon in $blocked.
            //
            // 💣 NEUTRALISIERT WIRD NUR HIER, IN DER SCHLEIFE. Die Ebenen $factors/$heights/$rasters
            // fliessen unveraendert an avesmapsOffroadFinishPath weiter -- sie auf null zu setzen
            // naehme der MESSUNG das Gelaende, und die kuerzeste Etappe haette dann eine Laenge,
            // aber keine Reisezeit und keinen Anstieg (Entwurf §3.2).
            if ($weightByDistance) { $slopeFactor = 1.0; $groundFactor = 1.0; }

            $cost = ($best[$current] ?? INF) + ($distance / $speed) * $slopeFactor * $groundFactor;
```

⚠️ Die Zeile muss **nach** der Berechnung von `$slopeFactor` und `$groundFactor` stehen und **vor**
`$cost`. In `avesmapsOffroadFindPath` ist das zwischen der `$groundFactor`-Zuweisung und der
`$cost`-Zeile.

⚠️ Die **Heuristik** des A\* bleibt zulässig: `Luftlinie / Tempo` unterschätzt die Streckenkosten
erst recht, weil die Faktoren jetzt 1,0 sind. Sie muss nicht angefasst werden.

- [ ] **Schritt 4: Dasselbe in `avesmapsOffroadFindPathsFromPoint`**

Identische Signaturergänzung und identische Zeile an derselben Stelle der Schleife. Zusätzlich muss
das Argument an den **isolierten Rückfall** durchgereicht werden (die nassen Kandidaten):

```php
    foreach ($isolated as $key => $goal) {
        $result[$key] = avesmapsOffroadFindPath($box, $blocked, $factors, $heights, $speed,
            (float) $goal['x'], (float) $goal['y'], $x, $y, $eps, $rasters, $weightByDistance);
    }
```

💣 Ohne diese Zeile rechnet ein Kandidat am Wasser weiter zeitoptimal, während alle anderen
streckenoptimal rechnen — genau die halbe Umsetzung, gegen die dieser ganze Entwurf geschrieben ist.

- [ ] **Schritt 5: Test laufen lassen, er muss grün sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/offroad-shortest-test.php
```

Erwartet: `offroad-shortest-test: OK`

- [ ] **Schritt 6: Alle Routing-Tests, dann committen**

```bash
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
git status
git add api/_internal/routing/offroad-grid.php api/_internal/routing/__tests__/offroad-shortest-test.php
git commit -F - <<'MSG'
feat(routing): der Gelaende-Suchlauf kennt jetzt das Gewicht des Modus

Bis heute war die Schrittkostenformel fest eine Zeit -- auch unter optimize=shortest. Mit
$weightByDistance setzt die Entspannung Steigungs- und Bodenfaktor auf 1,0, ein Schritt kostet
dann genau seine Laenge.

Neutralisiert wird NUR in der Schleife: die Faktorebene, die Hoehen und die Raster fliessen
unveraendert an avesmapsOffroadFinishPath weiter. Sie fuer die Suche auf null zu setzen -- so
stand es bis zum Bauplan im Entwurf -- haette der MESSUNG das Gelaende genommen, und die
kuerzeste Etappe haette eine Laenge gehabt, aber keine Reisezeit und keinen Anstieg.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 2: Die gerade Linie zuerst

**Dateien:**
- Ändern: `api/_internal/routing/offroad-grid.php` (neue Funktion nach `avesmapsOffroadFinishPath`)
- Test: `api/_internal/routing/__tests__/offroad-shortest-test.php` (Abschnitte F und G anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsRouteChordCrossesWater(float $x1, float $y1, float $x2, float $y2, array $water): bool`
  (aus `water-areas.php`, seit V13), `avesmapsOffroadFinishPath`
- Liefert: `avesmapsOffroadStraightPathIfDry(array $box, array $water, ?string $factors, ?string $heights, float $speed, float $x1, float $y1, float $x2, float $y2, float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, array $rasters = []): ?array`
  — die gemessene Zwei-Punkte-Linie, oder `null`, wenn sie Wasser schneidet.

- [ ] **Schritt 1: Die beiden Testabschnitte anhängen**

Vor der Schlusszeile `fwrite(STDOUT, "offroad-shortest-test: OK\n");` einfügen:

```php
// ---- F: die trockene Gerade braucht keinen Suchlauf --------------------------------------
// 🔴 Der Nass-Test fragt die POLYGONE, nicht das Raster. Gemessen am 15.08.2026 an 5.903 Linien:
// die beiden gehen in 0,92 % der Faelle auseinander (3,07 % in Wassernaehe), und zwar IMMER in
// dieselbe Richtung -- das Raster sperrt eine Zelle, sobald Wasser sie beruehrt, ist also strenger
// als die Flaeche selbst. Ein Modus, der Meilen minimieren soll, darf keine Meilen fuer ein
// Rasterungsartefakt dazulegen (Entwurf §5).
$quadrat = static function (float $x1, float $y1, float $x2, float $y2): array {
    return ['geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
    ]]], 'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2];
};
$ohneWasser = avesmapsPrepareRouteAreas([$quadrat(90.0, 90.0, 95.0, 95.0)]);

$gerade = avesmapsOffroadStraightPathIfDry($box, $ohneWasser, $faktoren, null, $speed,
    4.0, 4.0, 4.0, 16.0);
assert(is_array($gerade), 'ohne Wasser im Weg gibt es eine Gerade');
assert(count($gerade['points']) === 2, 'und sie hat genau zwei Punkte');
assert(abs($gerade['distance'] - 12.0) < 1e-9,
    'ihre Laenge ist die Luftlinie: ' . $gerade['distance']);
// Sie laeuft durch den teuren Streifen, also traegt ihre Zeit den Faktor.
assert($gerade['time'] > $gerade['distance'] / $speed + 1e-6,
    'auch die Gerade wird mit dem echten Gelaende bepreist: ' . $gerade['time']);

// ---- G: eine nasse Gerade gibt null zurueck ----------------------------------------------
$mitSee = avesmapsPrepareRouteAreas([$quadrat(0.0, 9.0, 20.0, 11.0)]);
assert(avesmapsOffroadStraightPathIfDry($box, $mitSee, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0) === null,
    'quer durch einen See gibt es keine gerade Antwort');
```

⚠️ Ganz oben im Test muss dafür `require __DIR__ . '/../land-areas.php';` neben dem bestehenden
`require` stehen — `avesmapsPrepareRouteAreas` wohnt dort, nicht in `water-areas.php`. Dieselbe
Falle steht schon im Kopf von `anchor-candidates-test.php`.

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

Erwartet: `Call to undefined function avesmapsOffroadStraightPathIfDry()`

- [ ] **Schritt 3: Die Funktion bauen**

In `offroad-grid.php`, nach `avesmapsOffroadFinishPath`:

```php
/**
 * PURE: die gerade Verbindung, wenn sie trocken ist -- sonst null.
 *
 * 🔴 DER KURZSCHLUSS DES STRECKENMODUS. Die kuerzeste Verbindung zweier Punkte ist die Strecke
 * zwischen ihnen; ist sie trocken, gibt es nichts zu suchen. Kein Gitterlauf, keine Warteschlange.
 *
 * 🔴 GEFRAGT WIRD DAS POLYGON, NICHT DAS RASTER. Am 15.08.2026 an 5.903 Linien gemessen: die
 * beiden Tests gehen in 0,92 % der Faelle auseinander (3,07 % in Wassernaehe) -- und „nur Polygon
 * nass" kam kein einziges Mal vor. Das Raster sperrt eine Zelle, sobald Wasser sie beruehrt, und
 * uebertreibt damit um bis zu eine halbe Zellbreite. Ein Modus, der Meilen minimieren soll, darf
 * keine Meilen fuer ein Rasterungsartefakt dazulegen (Entwurf §5).
 *
 * ⚠️ Gemessen wird trotzdem mit dem echten Gelaende: die Linie geht durch dieselbe
 * avesmapsOffroadFinishPath wie jede gesuchte, mit denselben Ebenen. Sie ist kuerzest, nicht
 * kostenlos.
 */
function avesmapsOffroadStraightPathIfDry(
    array $box,
    array $water,
    ?string $factors,
    ?string $heights,
    float $speed,
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
    array $rasters = []
): ?array {
    if ($speed <= 0.0) { return null; }
    if (avesmapsRouteChordCrossesWater($x1, $y1, $x2, $y2, $water)) { return null; }

    return avesmapsOffroadFinishPath([[$x1, $y1], [$x2, $y2]], $speed, $factors, $heights, $box, $eps, 0, $rasters);
}
```

⚠️ `offroad-grid.php` zieht `water-areas.php` heute nicht selbst. Oben in der Datei ergänzen:

```php
require_once __DIR__ . '/water-areas.php';
```

- [ ] **Schritt 4: Test grün, dann Routing-Tests, dann committen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/offroad-shortest-test.php
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
git status
git add api/_internal/routing/offroad-grid.php api/_internal/routing/__tests__/offroad-shortest-test.php
git commit -F - <<'MSG'
feat(routing): die trockene Gerade braucht keinen Suchlauf

Die kuerzeste Verbindung zweier Punkte ist die Strecke zwischen ihnen. Ist sie trocken, gibt es
nichts zu suchen -- zwei Punkte, gemessen mit dem echten Gelaende, fertig.

Gefragt wird das POLYGON (avesmapsRouteChordCrossesWater aus V13), nicht das Raster. Am
15.08.2026 an 5.903 Linien gemessen: die beiden gehen in 0,92 % der Faelle auseinander, in
Wassernaehe in 3,07 % -- und immer in dieselbe Richtung, weil das Raster eine Zelle schon sperrt,
wenn Wasser sie beruehrt. "Nur Polygon nass" kam kein einziges Mal vor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 3: Der Kartenpunkt — und der Abnahmefall

**Dateien:**
- Ändern: `api/_internal/routing/offroad-leg.php` (`avesmapsAttachOffroadPointToGraph`)
- Test: `api/_internal/routing/__tests__/kuerzeste-etappe-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsOffroadStraightPathIfDry` (Aufgabe 2),
  `avesmapsOffroadFindPathsFromPoint(..., bool $weightByDistance)` (Aufgabe 1)
- Liefert: unveränderte Signatur und unveränderter Rückgabevertrag von
  `avesmapsAttachOffroadPointToGraph`.

- [ ] **Schritt 1: Den Abnahmetest schreiben**

Datei `api/_internal/routing/__tests__/kuerzeste-etappe-test.php`:

```php
<?php
// api/_internal/routing/__tests__/kuerzeste-etappe-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL. Unter optimize=shortest ist die Querfeldein-Etappe die GERADE, nicht der
 * zeitoptimale Bogen. Nachbau der Referenzroute des Owners.
 * Entwurf: docs/superpowers/specs/2026-08-15-kuerzeste-route-gerade-linie-design.md §1/§6
 *
 * 🔴 Bis zum 15.08.2026 war der Querweg unter „Kuerzeste" zeichengleich mit dem unter
 * „Schnellste" -- 12,217 Einheiten gegen eine Luftlinie von 8,609, also 41,9 % Umweg in einem
 * Modus, der Meilen minimieren soll.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/kuerzeste-etappe-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-leg.php';

$quadrat = static function (float $x1, float $y1, float $x2, float $y2): array {
    return ['geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
    ]]], 'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2];
};
$ort = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];

$land = avesmapsPrepareRouteAreas([$quadrat(0.0, 0.0, 100.0, 100.0)]);
$wasser = avesmapsPrepareRouteAreas([$quadrat(90.0, 90.0, 95.0, 95.0)]);

$punkte = [[20.0, 60.0], [20.0, 52.0], [28.0, 54.0], [26.0, 50.0], [32.0, 50.0]];
$roadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];
$verbindung = [
    'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
    'id' => 'huegelsteig#0', 'path_id' => 'huegelsteig#0',
    'from' => 'Salmingen', 'to' => 'Tarnelfurt',
    'distance' => avesmapsCalculateClientRouteCoordinateDistance($punkte),
    'time' => avesmapsCalculateClientRouteCoordinateDistance($punkte) / $roadSpeed,
    'geometry' => ['type' => 'LineString', 'coordinates' => $punkte],
];
$graph = ['Salmingen' => [], 'Tarnelfurt' => []];
avesmapsAddClientCompatibleGraphConnection($graph, 'Salmingen', 'Tarnelfurt', $verbindung);
avesmapsAddClientCompatibleGraphConnection($graph, 'Tarnelfurt', 'Salmingen', $verbindung);
$orte = [$ort('Salmingen', 20.0, 60.0), $ort('Tarnelfurt', 32.0, 50.0)];
$ziel = [20.0, 40.0];

$anfrage = static fn(string $modus): array => ['optimize' => $modus,
    'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

$hole = static function (string $modus) use ($graph, $orte, $anfrage, $wasser, $land, $ziel): array {
    $clientGraph = ['graph' => $graph, 'statistics' => []];
    $bericht = avesmapsAttachOffroadPointToGraph($clientGraph, $orte, $anfrage($modus),
        $wasser, $land, null, $ziel[0], $ziel[1], '__offroad_to', false);
    assert($bericht['ok'] === true, "$modus: der Punkt wird angebunden");
    return [$clientGraph, $bericht];
};

// ---- A: unter „Kuerzeste" ist die Etappe ab Salmingen die GERADE -------------------------
[$kurzGraph, $kurzBericht] = $hole('shortest');
$luft = hypot(20.0 - $ziel[0], 60.0 - $ziel[1]);      // = 20,0
$abSalmingen = null;
foreach ($kurzBericht['exit_nodes'] as $ausstieg) {
    if ((string) $ausstieg['node'] === 'Salmingen') { $abSalmingen = $ausstieg; }
}
assert($abSalmingen !== null, 'Salmingen steht im Angebot');
assert(abs((float) $abSalmingen['distance_units'] - $luft) < 1e-6,
    'die Etappe ab Salmingen ist die Luftlinie: ' . $abSalmingen['distance_units'] . ' gegen ' . $luft);
assert((int) $abSalmingen['point_count'] === 2, 'und sie besteht aus genau zwei Punkten');

// ---- B: unter „Schnellste" bleibt alles, wie es war ---------------------------------------
[$schnellGraph, $schnellBericht] = $hole('fastest');
$schnellAbSalmingen = null;
foreach ($schnellBericht['exit_nodes'] as $ausstieg) {
    if ((string) $ausstieg['node'] === 'Salmingen') { $schnellAbSalmingen = $ausstieg; }
}
assert($schnellAbSalmingen !== null, 'Salmingen steht auch dort im Angebot');
assert((float) $schnellAbSalmingen['distance_units'] >= $luft - 1e-9,
    'der Zeitmodus ist nie kuerzer als die Luftlinie');

// ---- C: 🔴 die gewaehlte Reise ist unter „Kuerzeste" die Gerade, nicht der Weg -------------
$route = avesmapsFindClientCompatibleRoute($kurzGraph, 'Salmingen', '__offroad_to', $anfrage('shortest'));
assert($route['found'] === true, 'die Reise wird gefunden');
assert(count($route['segments']) === 1,
    'eine Etappe -- die Gerade schlaegt jeden Umweg ueber die Strasse, gefunden: '
    . count($route['segments']));
assert((string) $route['segments'][0]['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
    'und sie ist Querfeldein');
assert(abs((float) $route['cost'] - $luft) < 1e-6,
    'ihre Kosten sind die Strecke: ' . $route['cost'] . ' gegen ' . $luft);

// ---- D: die Auskunft bleibt vollstaendig --------------------------------------------------
assert(array_key_exists('ascent_schritt', $route['segments'][0])
    || array_key_exists('cost_units', $route['segments'][0]),
    'die Etappe traegt weiterhin ihre Messwerte, nicht nur eine Laenge');

fwrite(STDOUT, "kuerzeste-etappe-test: OK (gerade " . round((float) $abSalmingen['distance_units'], 4)
    . " gegen zeitoptimal " . round((float) $schnellAbSalmingen['distance_units'], 4) . ")\n");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

Erwartet: Abschnitt A schlägt fehl — heute liefert `shortest` dieselbe zeitoptimale Linie wie
`fastest`, also mehr als die Luftlinie und mit mehr als zwei Punkten.

🔴 Rot-Beleg. Ausgabe ins Commit-Protokoll.

- [ ] **Schritt 3: Den Modus im Aufrufer lesen und durchreichen**

In `avesmapsAttachOffroadPointToGraph`, direkt nach der Auflösung von `$speed`:

```php
    // 🔴 „Kuerzeste" gilt auch im Gelaende. Bis zum 15.08.2026 befolgte nur der Wegegraph das
    // `optimize` (client-graph.php:1809); der A* rechnete immer zeitoptimal, und die Querfeldein-
    // Kante trug damit die Laenge eines Weges, der auf Schnelligkeit gelegt war -- an der
    // Referenzroute 12,217 Einheiten gegen eine Luftlinie von 8,609.
    $weightByDistance = (string) ($request['optimize'] ?? 'fastest') === 'shortest';
```

Und in der Stufenschleife, an der Stelle, wo heute der Suchlauf steht: erst die Geraden, dann ein
Lauf für die übrigen.

```php
        // ⭐ ERST DIE GERADEN. Im Streckenmodus ist die trockene Gerade bereits die Antwort; nur
        // die nassen brauchen ueberhaupt einen Suchlauf. Im Zeitmodus faellt dieser Block weg.
        $goals = [];
        $paths = [];
        foreach ($set as $index => $candidate) {
            if ($weightByDistance) {
                $gerade = avesmapsOffroadStraightPathIfDry($box, $water, $factors, $heights,
                    (float) $speed, $candidate['x'], $candidate['y'], $x, $y,
                    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters);
                if ($gerade !== null) { $paths[$index] = $gerade; continue; }
            }
            $goals[$index] = ['x' => $candidate['x'], 'y' => $candidate['y']];
        }
        if ($goals !== []) {
            $paths += avesmapsOffroadFindPathsFromPoint($box, $blocked, $factors, $heights,
                (float) $speed, $x, $y, $goals, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters,
                $weightByDistance);
        }
```

💣 `$paths + $b` (Vereinigung) statt `array_merge`: die Schlüssel sind die Kandidaten-Indizes und
müssen erhalten bleiben. `array_merge` numeriert sie neu, und danach zeigt jede Kante auf den
falschen Ausstieg.

- [ ] **Schritt 4: Test grün, alle Routing-Tests, committen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/kuerzeste-etappe-test.php
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
git status
git add api/_internal/routing/offroad-leg.php api/_internal/routing/__tests__/kuerzeste-etappe-test.php
git commit -F - <<'MSG'
fix(routing): unter "Kuerzeste" ist die Querfeldein-Etappe jetzt die Gerade

Der Kartenpunkt liest optimize und reicht es an den Suchlauf durch. Im Streckenmodus wird
zuerst die Gerade probiert -- ist sie trocken, gibt es gar keinen Suchlauf; nur die nassen
Kandidaten kommen in den Mehrziel-Lauf, dann mit Streckengewicht.

Bis heute war der Querweg unter "Kuerzeste" zeichengleich mit dem unter "Schnellste": 12,217
Einheiten gegen eine Luftlinie von 8,609, also 41,9 % Umweg in einem Modus, der Meilen
minimieren soll. Und nicht nur eine falsche Anzeige -- mit dieser Laenge trat die Kante gegen
die Strassen an.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 4: Die drei übrigen Erzeuger

**Dateien:**
- Ändern: `api/_internal/routing/offroad-leg.php` (`avesmapsConnectOffroadPoints`)
- Ändern: `api/_internal/routing/synthetic-refine.php` (`avesmapsRefineClientRouteSyntheticEdges`)
- Test: `api/_internal/routing/__tests__/kuerzeste-etappe-test.php` (Abschnitte E und F)

- [ ] **Schritt 1: Die beiden Abschnitte anhängen**

Vor der Schlusszeile einfügen:

```php
// ---- E: zwei Kartenpunkte -- auch die direkte Kante ist im Streckenmodus gerade ------------
$paarGraph = ['graph' => []];
$paarBericht = avesmapsConnectOffroadPoints($paarGraph, $anfrage('shortest'), $wasser, null,
    ['x' => 10.0, 'y' => 10.0], ['x' => 18.0, 'y' => 16.0], '__offroad_from', '__offroad_to', false);
assert($paarBericht['ok'] === true, 'die direkte Kante entsteht');
assert(abs((float) $paarBericht['distance_units'] - hypot(8.0, 6.0)) < 1e-6,
    'und sie ist die Luftlinie: ' . $paarBericht['distance_units']);
assert((int) $paarBericht['point_count'] === 2, 'zwei Punkte, kein Bogen');

// ---- F: die Sehnen-Verfeinerung biegt im Streckenmodus NICHT ------------------------------
// 🔴 avesmapsRefineSyntheticRouteLegs ersetzt die gerade Notkante durch den A*-Bogen. Ihr eigener
// Docblock sagt, warum das unter „Kuerzeste" falsch ist: „Der neue Weg ist LAENGER als die Sehne
// -- er weicht ja aus." Genau das darf ein Modus, der Meilen minimiert, nicht tun.
//
// ⚠️ Die Vorlage fuer $segmente wird NICHT erfunden, sondern aus dem bestehenden
// synthetic-refine-test.php uebernommen -- dort steht die Form, die diese Funktion liest.
$bericht = avesmapsRefineSyntheticRouteLegs($notGraph, $anfrage('shortest'), $wasser, null,
    $segmente, false);
assert($bericht['refined'] === 0,
    'unter „Kuerzeste" wird keine einzige Sehne gebogen, gebogen: ' . $bericht['refined']);
$gegenprobe = avesmapsRefineSyntheticRouteLegs($notGraph2, $anfrage('fastest'), $wasser, null,
    $segmente, false);
assert($gegenprobe['examined'] > 0,
    'die Gegenprobe im Zeitmodus schaut sich die Sehne ueberhaupt an -- sonst prueft F nichts');
```

⚠️ `$notGraph`, `$notGraph2` und `$segmente` werden aus `synthetic-refine-test.php` übernommen
(dort steht die Fixture, die diese Funktion versteht). 🔴 Die **Gegenprobe im Zeitmodus ist
tragend**: ohne sie wäre der Test auch dann grün, wenn die Funktion aus einem ganz anderen Grund
nichts tut.

- [ ] **Schritt 2: Test laufen lassen, Abschnitte E und F müssen fehlschlagen**

- [ ] **Schritt 3: `avesmapsConnectOffroadPoints` nachziehen**

Direkt nach der Auflösung von `$speed`, dieselbe Zeile wie in Aufgabe 3:

```php
    $weightByDistance = (string) ($request['optimize'] ?? 'fastest') === 'shortest';
```

Und vor dem Kistenbau der Kurzschluss:

```php
    // ⭐ Im Streckenmodus zuerst die Gerade -- ist sie trocken, braucht es weder Kiste noch
    // Datenbankabfragen. Das ist der billigste Zweig des ganzen Moduls.
    if ($weightByDistance && !avesmapsRouteChordCrossesWater(
            (float) $fromPoint['x'], (float) $fromPoint['y'],
            (float) $toPoint['x'], (float) $toPoint['y'], $water)) {
        $box = avesmapsBuildOffroadBox($fromPoint['x'], $fromPoint['y'], $toPoint['x'], $toPoint['y']);
        $factors = $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '';
        $rasters = $terrainEnabled && $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];
        $heights = $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters);
        $path = avesmapsOffroadStraightPathIfDry($box, $water, $factors, $heights, (float) $speed,
            (float) $fromPoint['x'], (float) $fromPoint['y'], (float) $toPoint['x'], (float) $toPoint['y'],
            AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters);
        if ($path !== null) {
            avesmapsAddOffroadEdge($clientGraph['graph'], $fromNode, $toNode, $path, (string) $transport, $connectionId);
            return ['ok' => true, 'distance_units' => $path['distance'], 'cost_units' => $path['time'],
                'point_count' => count($path['points']), 'cell_mapunits' => $box['cell'],
                'height_rasters' => count($rasters)];
        }
    }
```

⚠️ Die Kiste wird auch hier gebraucht — nicht zum Suchen, sondern **zum Messen** (Entwurf §3.2).
Wer sie weglässt, bekommt eine Etappe ohne Reisezeit und ohne Anstieg.

Und der bestehende Suchlauf am Ende bekommt das Argument:

```php
    $path = avesmapsOffroadFindPath($box, $blocked, $factors, $heights, (float) $speed,
        $fromPoint['x'], $fromPoint['y'], $toPoint['x'], $toPoint['y'],
        AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters, $weightByDistance);
```

- [ ] **Schritt 4: Die Sehnen-Verfeinerung sperren**

In `synthetic-refine.php`, am Anfang der Schleife über die synthetischen Kanten:

In `avesmapsRefineSyntheticRouteLegs` (`synthetic-refine.php:33`), direkt nach der Zeile
`$report = ['examined' => 0, 'refined' => 0, 'legs' => []];` und **vor** der `foreach`-Schleife:

```php
    // 🔴 UNTER „KUERZESTE" WIRD NICHT GEBOGEN. Diese Funktion ersetzt die gerade Notkante durch
    // den A*-Bogen, damit ihre Geometrie ehrlich wird -- und ihr eigener Docblock sagt dazu: „Der
    // neue Weg ist LAENGER als die Sehne -- er weicht ja aus." Im Streckenmodus ist die GERADE
    // bereits die ehrliche Antwort, und laenger ist genau das Gegenteil dessen, was der Modus
    // verspricht. (Entwurf §3.4)
    if ((string) ($request['optimize'] ?? 'fastest') === 'shortest') { return $report; }
```

⚠️ Die Signatur ist `avesmapsRefineSyntheticRouteLegs(array &$clientGraph, array $request, array $water, ?PDO $pdo, array $segments, bool $terrainEnabled = true): array`
und der Rückgabewert ein Array — deshalb `return $report;`, nicht `return 0;`.

- [ ] **Schritt 5: Test grün, alle Routing-Tests, committen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/kuerzeste-etappe-test.php
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
git status
git add api/_internal/routing/offroad-leg.php api/_internal/routing/synthetic-refine.php api/_internal/routing/__tests__/kuerzeste-etappe-test.php
git commit -F - <<'MSG'
fix(routing): auch die direkte Kante und die Sehnen-Verfeinerung folgen dem Modus

avesmapsConnectOffroadPoints bedient zwei Kartenpunkte UND die Sehnen des Umweg-Ausloesers; im
Streckenmodus ist die trockene Gerade dort die Antwort. Die Kiste bleibt trotzdem stehen -- sie
wird zum MESSEN gebraucht, nicht zum Suchen.

Die Sehnen-Verfeinerung biegt unter "Kuerzeste" gar nicht mehr: sie ersetzt eine gerade Notkante
durch den A*-Bogen, damit die Geometrie ehrlich wird -- im Streckenmodus ist die Gerade bereits
die ehrliche Antwort, und ein Bogen waere laenger.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 5: Abnahme am lebenden Objekt

Kein Code. 🔴 Ohne diesen Schritt gilt nichts als fertig.

- [ ] **Schritt 1: Die Fallenliste des Entwurfs abhaken.** §7, sechs Zeilen, jede einzeln.

- [ ] **Schritt 2: Das ganze Testfeld, PHP und JS** (Laufzeile in den globalen Randbedingungen).

- [ ] **Schritt 3: Pushen**

```bash
git fetch origin && git rebase origin/master && git push origin master && git log --oneline origin/master -1
```

⚠️ **Der Arbeitsbaum ist geteilt.** Vor dem Push `git log --oneline origin/master..HEAD` lesen und
prüfen, ob dort **fremde Commits** stehen — am 15.08.2026 hat ein Push sechs Commits einer anderen
Sitzung mit rausgetragen, weil in einer Befehlskette ein `&&` fehlte.

- [ ] **Schritt 4: 2–4 Minuten warten (STRATO-Opcache), dann die Referenzroute live prüfen**

```bash
curl -s -X POST https://avesmaps.de/api/route/ -H "Content-Type: application/json" -d '{"from":"Salmingen","to":"Kartenpunkt","to_point":{"x":501.076,"y":504.530},"optimize":"shortest","include_geometry":false,"include_steps":true,"minimize_transfers":false,"transports":{"land":"groupFoot","river":"riverSailer","sea":"cargoShip","synthetic":"groupFoot"},"enabled_transports":{"land":true,"river":true,"sea":true,"synthetic":true}}'
```

Erwartet: **eine** Etappe, Querfeldein, `distance_units` ≈ **10,611** (= 31,8 Meilen), `cost` ≈
10,611. Das ist exakt die Zahl, die der Planer schon als **Drachenflug** anzeigt — stimmen die
beiden nicht überein, stimmt etwas nicht.

🪤 `to_point` will `{x: lng, y: lat}`. Die Oberfläche zeigt „Kartenpunkt (504.530, 501.076)" als
**lat, lng**, also gedreht.

- [ ] **Schritt 5: Dieselbe Route unter `"optimize":"fastest"`** muss **unverändert** sein: zwei
      Etappen, 2,601 + 12,217 Einheiten, Kosten 6,2124.

- [ ] **Schritt 6: Im Browser ansehen** — `https://avesmaps.de/?s=9PtTgmCH`, Modus umschalten.
      Läuft die kürzeste Linie wirklich schnurgerade? Trägt ihre Etappe Reisezeit und Anstieg?
      ⚠️ Was ein Emulator nicht beantworten kann, wird als offene Frage gemeldet.

- [ ] **Schritt 7: Dem Owner melden** — mit beiden Etappenlisten, der Drachenflug-Gegenprobe und
      der abgehakten Fallenliste.

---

## Was dieser Bauplan NICHT tut

- Er zeigt **nicht** beide Antworten nebeneinander (Mockup vom 15.08.2026). Das kommt danach.
- Er ersetzt „Kürzeste" nicht durch „Wenigstes Gelände" (Entwurf §8) — erst die Wahrheit, dann die
  Frage, ob es die richtige Frage war.
- Er fasst den Wegegraphen nicht an; der befolgt `optimize` bereits.
- Er ändert den ×25-Aufschlag nicht.
