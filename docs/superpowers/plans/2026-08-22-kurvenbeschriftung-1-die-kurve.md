# Kurvenbeschriftung, Plan 1: Die Kurve (Server)

> **Für agentische Ausführung:** ERFORDERLICHER SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte sind Kästchen (`- [ ]`).
>
> **Entwurf:** `docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md` — **vor Aufgabe 1
> ganz lesen.** Dieser Plan setzt ihn um, er ersetzt ihn nicht.
> **Prototyp:** `docs/kurvenlabel-mockup.html` — enthält dasselbe Verfahren lauffähig in JavaScript
> und ist bei jeder Unklarheit über eine Formel die Referenz.

**Ziel:** Jedes Landschafts-Label, dessen Region die Kurvenbeschriftung eingeschaltet hat, trägt in
`GET /api/app/map-features.php` eine fertige Beschriftungskurve. Nichts ist sichtbar; alles ist
messbar.

**Architektur:** Reine Funktionen in `api/_internal/app/curve-labels.php` (Geometrie → Kurve), ein
Leser mit Zwischenspeicher in `api/_internal/app/curve-label-store.php`, und eine Anhänge-Funktion
nach dem Vorbild von `api/_internal/app/ecosystem-label-link.php`. Gerechnet wird in
Kartenkoordinaten, einmal je Flächengeometrie.

**Tech Stack:** PHP 8 strict types, PDO/MySQL, keine neue Abhängigkeit. Tests sind nackte
`assert()`-Skripte ohne DB und ohne HTTP.

## Globale Vorgaben

Gelten für **jede** Aufgabe, ohne dass sie es wiederholt:

- **Sprache:** Kommentare und Commit-Nachrichten auf **Deutsch** (AGENTS.md §8). Funktionsnamen
  englisch mit Präfix `avesmapsCurve…`, wie im Haus üblich.
- **`declare(strict_types=1);`** in jeder neuen PHP-Datei, erste Zeile nach `<?php`.
- **Kein DDL in einem Lesepfad** (AGENTS.md §10). Dieser Plan legt keine Tabelle und keine Spalte an.
- **Keine Schleife über teure Endpunkte** (AGENTS.md §9, STRATO). Eine Probe ist eine Anfrage.
- **Testlauf vor jedem Push ist das GANZE Feld, nicht die eigenen Tests** (AGENTS.md §9):
  ```
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
  ```
  ⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden **45** Tests rot, die nur die Erweiterung vermissen.
  Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Geteilter Arbeitsbaum:** nie `git add -A`. Nur die eigenen Pfade einzeln stagen, und vor jedem
  Commit `git diff --staged` LESEN (AGENTS.md §9).
- **Der lokale `master` divergiert.** Vor dem ersten Commit prüfen:
  `git rev-list --left-right --count origin/master...master`. Stimmt er nicht mit `origin` überein,
  in einem **separaten Prüfbaum** auf `origin/master` arbeiten
  (`git worktree add --detach <tmp> origin/master`), dort committen und pushen, danach
  `git worktree remove`. Kein Rebase im geteilten Baum.

**Testbefehl für alle PHP-Tests dieses Plans:**
```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```

---

## Dateien

| Datei | Verantwortung |
|---|---|
| **Neu** `api/_internal/app/curve-labels.php` | Das Verfahren. Reine Funktionen, kein PDO, keine Globals, kein I/O. |
| **Neu** `api/_internal/app/curve-label-store.php` | Einstellung je Region lesen, Kurve rechnen/zwischenspeichern, ans Label hängen. Hat PDO. |
| **Neu** `api/_internal/app/__tests__/curve-labels-test.php` | Test des Verfahrens, inkl. der sechs gemessenen Referenzflächen. |
| **Neu** `api/_internal/app/__tests__/curve-label-store-test.php` | Test der Einstellungs- und Anhänge-Regeln. Ohne DB. |
| **Neu** `api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json` | Die sechs Flächen, aus `docs/kurvenlabel-referenzdaten.js` erzeugt. |
| Ändern `api/app/map-features.php` | Kurven anhängen, `PAYLOAD_VERSION` hoch. |

🔴 **Die Trennung ist die Zusicherung:** `curve-labels.php` hat kein PDO. Der Endpunkt
`map-features.php` läuft beim Include los, also ist nichts testbar, was in ihm steht — genau die
Begründung, mit der `ecosystem-label-link.php` eine eigene Datei ist (dort im Kopf nachlesen).

---

## Aufgabe 1: Geometrie-Grundlagen

**Dateien:**
- Neu: `api/_internal/app/curve-labels.php`
- Test: `api/_internal/app/__tests__/curve-labels-test.php`

**Schnittstellen:**
- Verbraucht: nichts.
- Liefert: `avesmapsCurveRingArea(array $ring): float`,
  `avesmapsCurvePointInPolygon(array $pt, array $rings): bool`,
  `avesmapsCurveSimplifyRing(array $ring, float $tol): array`,
  `avesmapsCurveDensifyRing(array $ring, float $spacing): array`.
  Ein Punkt ist überall `[float $x, float $y]`, ein Ring eine Liste von Punkten mit
  `$ring[0] === $ring[count-1]`, `$rings[0]` der Aussenring und `$rings[1..]` Löcher.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/app/__tests__/curve-labels-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Test des Kurvenverfahrens (docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §3).
 * Keine DB, kein HTTP. Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/curve-labels-test.php
 * Exit 0 = alle Zusicherungen halten.
 */

require_once __DIR__ . '/../curve-labels.php';

// ---------------------------------------------------------------- GRUNDLAGEN ---

// Flaeche eines Einheitsquadrats, gegen den Uhrzeigersinn positiv.
$quadrat = [[0.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0], [0.0, 0.0]];
assert(abs(avesmapsCurveRingArea($quadrat) - 12.0) < 1e-9);

// Punkt-in-Polygon, mit Loch: die Mitte des Lochs liegt DRAUSSEN.
$mitLoch = [
    [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
    [[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0], [4.0, 4.0]],
];
assert(avesmapsCurvePointInPolygon([1.0, 1.0], $mitLoch) === true);
assert(avesmapsCurvePointInPolygon([5.0, 5.0], $mitLoch) === false);
assert(avesmapsCurvePointInPolygon([-1.0, 5.0], $mitLoch) === false);

// Segmentieren: eine Kante der Laenge 4 bei Abstand 1 bekommt Zwischenpunkte, und der Ring bleibt
// in seiner Reihenfolge. Rueckgabe ist OFFEN (ohne Schlusspunkt), wie der Prototyp.
$dicht = avesmapsCurveDensifyRing($quadrat, 1.0);
assert(count($dicht) > 4);
assert($dicht[0] === [0.0, 0.0]);
foreach ($dicht as $p) {
    assert(avesmapsCurvePointInPolygon([$p[0] * 0.999 + 2.0 * 0.001, $p[1] * 0.999 + 1.5 * 0.001], [$quadrat]) === true);
}

// Vereinfachen: ein Ring mit einem Punkt exakt auf einer Geraden verliert ihn.
$mitZwischenpunkt = [[0.0, 0.0], [2.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0], [0.0, 0.0]];
$einfach = avesmapsCurveSimplifyRing($mitZwischenpunkt, 0.1);
assert(count($einfach) < count($mitZwischenpunkt));
assert(abs(abs(avesmapsCurveRingArea($einfach)) - 12.0) < 1e-6);

// 💣 Ein zu kurzer Ring wird UNVERAENDERT zurueckgegeben, nicht zu Unsinn vereinfacht.
$dreieck = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 0.0]];
assert(avesmapsCurveSimplifyRing($dreieck, 5.0) === $dreieck);

echo "curve-labels: Grundlagen ok\n";
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```
Erwartet: `Failed opening required '.../curve-labels.php'`.

- [ ] **Schritt 3: `api/_internal/app/curve-labels.php` anlegen**

```php
<?php

declare(strict_types=1);

// Die Beschriftungskurve einer Landschaftsflaeche -- die Mittelachse, auf der ihr Name laeuft.
// Verfahren nach eox.at/2015/12/curved-labels: segmentieren -> vereinfachen -> Delaunay ->
// Innendreiecke -> Chordal Axis -> laengster Pfad -> Polynomglaettung.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §3
//
// 🔴 REINE FUNKTIONEN. Kein PDO, keine Globals, kein I/O -- der Leser steht in
// curve-label-store.php. Grund: ein Endpunkt laeuft beim Include los, also ist nichts testbar, was
// in ihm steht (dieselbe Begruendung wie im Kopf von ecosystem-label-link.php).
//
// Ein Punkt ist ueberall [x, y] in KARTENkoordinaten. Ein Ring ist geschlossen
// ($ring[0] == $ring[count-1]); $rings[0] ist der Aussenring, $rings[1..] sind Loecher.

function avesmapsCurveRingArea(array $ring): float
{
    $summe = 0.0;
    $anzahl = count($ring);
    for ($i = 0, $j = $anzahl - 1; $i < $anzahl; $j = $i++) {
        $summe += ($ring[$j][0] * $ring[$i][1]) - ($ring[$i][0] * $ring[$j][1]);
    }

    return $summe / 2.0;
}

// Strahlenschnitt. Ein Punkt exakt auf der Kante ist eine Muenze -- das ist hier egal, solange es
// konsistent ist, und die Aufrufer ruecken ihre Pruefpunkte ohnehin nach innen (siehe Aufgabe 3).
function avesmapsCurvePointInRing(array $pt, array $ring): bool
{
    $drinnen = false;
    $x = $pt[0];
    $y = $pt[1];
    $anzahl = count($ring);
    for ($i = 0, $j = $anzahl - 1; $i < $anzahl; $j = $i++) {
        $yi = $ring[$i][1];
        $yj = $ring[$j][1];
        if (($yi > $y) === ($yj > $y)) {
            continue;
        }
        $xi = $ring[$i][0];
        $xj = $ring[$j][0];
        if ($x < (($xj - $xi) * ($y - $yi) / ($yj - $yi)) + $xi) {
            $drinnen = !$drinnen;
        }
    }

    return $drinnen;
}

function avesmapsCurvePointInPolygon(array $pt, array $rings): bool
{
    if ($rings === [] || !avesmapsCurvePointInRing($pt, $rings[0])) {
        return false;
    }
    $anzahl = count($rings);
    for ($i = 1; $i < $anzahl; $i++) {
        if (avesmapsCurvePointInRing($pt, $rings[$i])) {
            return false;
        }
    }

    return true;
}

// Douglas-Peucker auf einer OFFENEN Punktfolge.
function avesmapsCurveDouglasPeucker(array $pts, float $tol): array
{
    $anzahl = count($pts);
    if ($anzahl < 3) {
        return $pts;
    }
    $behalten = array_fill(0, $anzahl, false);
    $behalten[0] = true;
    $behalten[$anzahl - 1] = true;
    $stapel = [[0, $anzahl - 1]];
    while ($stapel !== []) {
        [$s, $e] = array_pop($stapel);
        $maxAbstand = -1.0;
        $index = -1;
        $ax = $pts[$s][0];
        $ay = $pts[$s][1];
        $dx = $pts[$e][0] - $ax;
        $dy = $pts[$e][1] - $ay;
        $len2 = ($dx * $dx) + ($dy * $dy);
        for ($i = $s + 1; $i < $e; $i++) {
            $px = $pts[$i][0] - $ax;
            $py = $pts[$i][1] - $ay;
            if ($len2 <= 0.0) {
                $abstand = sqrt(($px * $px) + ($py * $py));
            } else {
                $t = max(0.0, min(1.0, (($px * $dx) + ($py * $dy)) / $len2));
                $abstand = sqrt((($px - ($t * $dx)) ** 2) + (($py - ($t * $dy)) ** 2));
            }
            if ($abstand > $maxAbstand) {
                $maxAbstand = $abstand;
                $index = $i;
            }
        }
        if ($maxAbstand > $tol && $index > 0) {
            $behalten[$index] = true;
            $stapel[] = [$s, $index];
            $stapel[] = [$index, $e];
        }
    }
    $raus = [];
    for ($i = 0; $i < $anzahl; $i++) {
        if ($behalten[$i]) {
            $raus[] = $pts[$i];
        }
    }

    return $raus;
}

// 💣 Ein GESCHLOSSENER Ring hat keine natuerlichen Enden fuer Douglas-Peucker. Deshalb die zwei am
// weitesten auseinander liegenden Punkte als Anker nehmen und beide Haelften einzeln vereinfachen.
// Ohne das faellt je nach Startpunkt ein anderer Teil des Randes weg.
function avesmapsCurveSimplifyRing(array $ring, float $tol): array
{
    if ($tol <= 0.0 || count($ring) < 5) {
        return $ring;
    }
    $pts = $ring;
    $letzter = count($pts) - 1;
    if (abs($pts[0][0] - $pts[$letzter][0]) < 1e-9 && abs($pts[0][1] - $pts[$letzter][1]) < 1e-9) {
        array_pop($pts);
    }
    $anzahl = count($pts);
    if ($anzahl < 5) {
        return $ring;
    }
    $b = 0;
    $best = -1.0;
    for ($i = 1; $i < $anzahl; $i++) {
        $d = hypot($pts[0][0] - $pts[$i][0], $pts[0][1] - $pts[$i][1]);
        if ($d > $best) {
            $best = $d;
            $b = $i;
        }
    }
    $a = 0;
    $best = -1.0;
    for ($i = 0; $i < $anzahl; $i++) {
        $d = hypot($pts[$b][0] - $pts[$i][0], $pts[$b][1] - $pts[$i][1]);
        if ($d > $best) {
            $best = $d;
            $a = $i;
        }
    }
    $lo = min($a, $b);
    $hi = max($a, $b);
    if (($hi - $lo) < 2 || ($anzahl - ($hi - $lo)) < 2) {
        return $ring;
    }
    $haelfte1 = array_slice($pts, $lo, $hi - $lo + 1);
    $haelfte2 = array_merge(array_slice($pts, $hi), array_slice($pts, 0, $lo + 1));
    $s1 = avesmapsCurveDouglasPeucker($haelfte1, $tol);
    $s2 = avesmapsCurveDouglasPeucker($haelfte2, $tol);
    $raus = array_merge($s1, array_slice($s2, 1, count($s2) - 2));
    if (count($raus) < 3) {
        return $ring;
    }
    $raus[] = $raus[0];

    return $raus;
}

// Gleichmaessige Stuetzpunkte. Rueckgabe ist OFFEN -- der Schlusspunkt wiederholt den ersten und
// waere im Punktvorrat der Triangulierung ein Duplikat.
function avesmapsCurveDensifyRing(array $ring, float $spacing): array
{
    $raus = [];
    $anzahl = count($ring) - 1;
    for ($i = 0; $i < $anzahl; $i++) {
        $a = $ring[$i];
        $b = $ring[$i + 1];
        $raus[] = $a;
        $d = hypot($b[0] - $a[0], $b[1] - $a[1]);
        if ($spacing > 0.0 && $d > $spacing) {
            $n = (int) floor($d / $spacing);
            for ($k = 1; $k <= $n; $k++) {
                $t = $k / ($n + 1);
                $raus[] = [$a[0] + (($b[0] - $a[0]) * $t), $a[1] + (($b[1] - $a[1]) * $t)];
            }
        }
    }

    return $raus;
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```
Erwartet: `curve-labels: Grundlagen ok`

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/curve-labels.php api/_internal/app/__tests__/curve-labels-test.php
git diff --staged --stat
git commit -m "feat(kurvenlabel): Geometrie-Grundlagen der Beschriftungskurve"
```

---

## Aufgabe 2: Delaunay

**Dateien:**
- Ändern: `api/_internal/app/curve-labels.php` (anhängen)
- Test: `api/_internal/app/__tests__/curve-labels-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: nichts aus Aufgabe 1.
- Liefert: `avesmapsCurveDelaunay(array $points): array` — Liste von `[int $a, int $b, int $c]`,
  Indizes in `$points`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Vor die letzte `echo`-Zeile von `curve-labels-test.php` einfügen:

```php
// ---------------------------------------------------------------- DELAUNAY ---

// 💣 Die Kontrollprobe, die den Bau ueberhaupt erst vertrauenswuerdig macht: fuer Punkte in
// KONVEXER Lage muss eine Delaunay-Triangulierung genau n-2 Dreiecke liefern, und ihre Flaechen
// muessen zusammen die Polygonflaeche ergeben. Faellt eine der beiden Zahlen, ist die
// Triangulierung kaputt -- und alles danach rechnet auf Sand weiter.
$n = 40;
$kreis = [];
for ($i = 0; $i < $n; $i++) {
    $w = 2 * M_PI * $i / $n;
    $kreis[] = [600.0 + (40.0 * cos($w)), 600.0 + (25.0 * sin($w))];
}
$tris = avesmapsCurveDelaunay($kreis);
assert(count($tris) === $n - 2);

$flaeche = 0.0;
foreach ($tris as [$a, $b, $c]) {
    $flaeche += abs(
        (($kreis[$b][0] - $kreis[$a][0]) * ($kreis[$c][1] - $kreis[$a][1]))
        - (($kreis[$c][0] - $kreis[$a][0]) * ($kreis[$b][1] - $kreis[$a][1]))
    ) / 2.0;
}
$ring = $kreis;
$ring[] = $kreis[0];
assert(abs($flaeche - abs(avesmapsCurveRingArea($ring))) < 1e-6);

// Kein Dreieck doppelt.
$schluessel = [];
foreach ($tris as $t) {
    $s = $t;
    sort($s);
    $k = implode(',', $s);
    assert(!isset($schluessel[$k]));
    $schluessel[$k] = true;
}

// Zu wenige Punkte ergeben kein Dreieck, nicht einen Fehler.
assert(avesmapsCurveDelaunay([[0.0, 0.0], [1.0, 0.0]]) === []);
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```
Erwartet: `Call to undefined function avesmapsCurveDelaunay()`

- [ ] **Schritt 3: Bowyer-Watson an `curve-labels.php` anhängen**

```php
// Umkreis eines Dreiecks. null bei entarteten (kollinearen) Dreiecken.
function avesmapsCurveCircumcircle(float $ax, float $ay, float $bx, float $by, float $cx, float $cy): ?array
{
    $d = 2.0 * (($ax * ($by - $cy)) + ($bx * ($cy - $ay)) + ($cx * ($ay - $by)));
    if (abs($d) < 1e-12) {
        return null;
    }
    $a2 = ($ax * $ax) + ($ay * $ay);
    $b2 = ($bx * $bx) + ($by * $by);
    $c2 = ($cx * $cx) + ($cy * $cy);
    $ux = (($a2 * ($by - $cy)) + ($b2 * ($cy - $ay)) + ($c2 * ($ay - $by))) / $d;
    $uy = (($a2 * ($cx - $bx)) + ($b2 * ($ax - $cx)) + ($c2 * ($bx - $ax))) / $d;

    return ['x' => $ux, 'y' => $uy, 'r2' => (($ax - $ux) ** 2) + (($ay - $uy) ** 2)];
}

// Delaunay nach Bowyer-Watson. Fuer die hier auftretenden Punktzahlen (gemessen 189-779 je Flaeche)
// ist die einfache Fassung schnell genug; eine Bibliothek waere eine neue Abhaengigkeit in einem
// Projekt ohne Bauschritt.
function avesmapsCurveDelaunay(array $points): array
{
    $n = count($points);
    if ($n < 3) {
        return [];
    }
    $minX = $minY = INF;
    $maxX = $maxY = -INF;
    foreach ($points as $p) {
        $minX = min($minX, $p[0]);
        $maxX = max($maxX, $p[0]);
        $minY = min($minY, $p[1]);
        $maxY = max($maxY, $p[1]);
    }
    $dm = max($maxX - $minX ?: 1.0, $maxY - $minY ?: 1.0) * 20.0;
    $mx = ($minX + $maxX) / 2.0;
    $my = ($minY + $maxY) / 2.0;
    $pts = $points;
    $pts[] = [$mx - $dm, $my - $dm];
    $pts[] = [$mx + $dm, $my - $dm];
    $pts[] = [$mx, $my + $dm];

    $mache = static function (int $a, int $b, int $c) use ($pts): array {
        return [
            'a' => $a,
            'b' => $b,
            'c' => $c,
            'cc' => avesmapsCurveCircumcircle(
                $pts[$a][0], $pts[$a][1], $pts[$b][0], $pts[$b][1], $pts[$c][0], $pts[$c][1]
            ),
        ];
    };

    $tris = [$mache($n, $n + 1, $n + 2)];
    for ($i = 0; $i < $n; $i++) {
        $px = $pts[$i][0];
        $py = $pts[$i][1];
        $schlecht = [];
        $gut = [];
        foreach ($tris as $t) {
            $cc = $t['cc'];
            if ($cc !== null && ((($px - $cc['x']) ** 2) + (($py - $cc['y']) ** 2)) <= $cc['r2'] + 1e-9) {
                $schlecht[] = $t;
            } else {
                $gut[] = $t;
            }
        }
        $kanten = [];
        foreach ($schlecht as $t) {
            foreach ([[$t['a'], $t['b']], [$t['b'], $t['c']], [$t['c'], $t['a']]] as $e) {
                $k = $e[0] < $e[1] ? $e[0] . ',' . $e[1] : $e[1] . ',' . $e[0];
                if (isset($kanten[$k])) {
                    $kanten[$k]['n']++;
                } else {
                    $kanten[$k] = ['n' => 1, 'a' => $e[0], 'b' => $e[1]];
                }
            }
        }
        $tris = $gut;
        foreach ($kanten as $rec) {
            if ($rec['n'] === 1) {
                $tris[] = $mache($rec['a'], $rec['b'], $i);
            }
        }
    }
    $raus = [];
    foreach ($tris as $t) {
        if ($t['a'] < $n && $t['b'] < $n && $t['c'] < $n) {
            $raus[] = [$t['a'], $t['b'], $t['c']];
        }
    }

    return $raus;
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```
Erwartet: `curve-labels: Grundlagen ok`

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/curve-labels.php api/_internal/app/__tests__/curve-labels-test.php
git diff --staged --stat
git commit -m "feat(kurvenlabel): Delaunay nach Bowyer-Watson, mit Kontrollprobe"
```

---

## Aufgabe 3: Mittelachse und längster Pfad

**Dateien:**
- Ändern: `api/_internal/app/curve-labels.php` (anhängen)
- Test: `api/_internal/app/__tests__/curve-labels-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsCurveDelaunay`, `avesmapsCurvePointInPolygon`.
- Liefert: `avesmapsCurveChordalAxis(array $points, array $tris, array $rings): array` mit den
  Schlüsseln `nodes` (Liste von `[x, y]`), `adj` (Liste von Listen `[int $nachbar, float $gewicht]`)
  und `inner_count` (int, Zahl der Innendreiecke);
  `avesmapsCurveLongestPath(array $nodes, array $adj): array` — Liste von `[x, y]`.

🔴 **Hier sitzen die zwei Fallen, die den Prototyp zweimal aufgehalten haben.** Beide sind im Test
festgenagelt; wer sie „vereinfacht", macht den Test rot.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

```php
// ------------------------------------------------------- MITTELACHSE (CHORDAL AXIS) ---

// Ein langes, schmales Rechteck: seine Mittelachse ist im Wesentlichen seine Laengsachse. Die
// Rohachse muss deutlich laenger sein als die halbe Diagonale -- sonst ist der Graph zerfallen.
$streifen = [[
    [0.0, 0.0], [100.0, 0.0], [100.0, 10.0], [0.0, 10.0], [0.0, 0.0],
]];
$vereinfacht = [avesmapsCurveSimplifyRing($streifen[0], 0.3)];
$punkte = avesmapsCurveDensifyRing($vereinfacht[0], 1.0);
$tris = avesmapsCurveDelaunay($punkte);
$achse = avesmapsCurveChordalAxis($punkte, $tris, $vereinfacht);

// 💣 FALLE 1: Der Innentest darf nicht an der KANTENMITTE haengen. Die Mitte einer RANDkante liegt
// exakt auf der Polygonlinie, und dort ist der Strahlentest eine Muenze. Ungerueckt faellt JEDES
// randstaendige Dreieck heraus und die Mittelachse zerfaellt in Splitter (im Prototyp gemessen:
// Rohachse 2,2 statt 139 Einheiten). Bei einem einfachen Polygon muss die Zahl der Innendreiecke
// gleich der Zahl der Punkte minus 2 sein -- genau dann ist NICHTS herausgefallen.
assert($achse['inner_count'] === count($punkte) - 2);

// 💣 FALLE 2: KEIN Deckel auf die Kantenlaenge. Im Inneren einer breiten Flaeche sind die Dreiecke
// von Natur aus gross; ein Laengendeckel loescht genau die Achse, die man sucht.
$roh = avesmapsCurveLongestPath($achse['nodes'], $achse['adj']);
assert(count($roh) >= 2);
$laenge = 0.0;
for ($i = 1; $i < count($roh); $i++) {
    $laenge += hypot($roh[$i][0] - $roh[$i - 1][0], $roh[$i][1] - $roh[$i - 1][1]);
}
assert($laenge > 80.0);

// Die Achse liegt IM Polygon -- ABER ihre beiden ENDpunkte liegen per Bauart AUF dem Rand.
// 🪤 Diese Zusicherung stand im ersten Entwurf des Plans ohne die Ausnahme da und war damit
// unerfuellbar; der Implementierer von Aufgabe 3 hat es gemeldet statt sie aufzuweichen. Der Grund
// ist strukturell: der laengste Pfad ist der Durchmesser eines BAUMS und endet deshalb immer an
// Blaettern, und ein Blatt ist genau der „Spitzen"-Fall oben -- die gegenueberliegende Ecke eines
// Randdreiecks, also ein roher Randpunkt. Auf dem Rand ist der Strahlentest eine Muenze (siehe den
// Kommentar an avesmapsCurvePointInRing). Dass die Achse die Spitze beruehrt, ist gewollt: dort
// soll die Beschriftung hinlaufen.
// ⚠️ Die Zusicherung bleibt scharf -- eine Achse, die die Flaeche VERLAESST, faellt weiterhin auf.
$innen = array_slice($roh, 1, -1);
assert(count($innen) > 0);
foreach ($innen as $p) {
    assert(avesmapsCurvePointInPolygon($p, $vereinfacht) === true);
}

// Ein leerer Graph liefert eine leere Linie, keinen Fehler.
assert(avesmapsCurveLongestPath([], []) === []);
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

Erwartet: `Call to undefined function avesmapsCurveChordalAxis()`

- [ ] **Schritt 3: Implementieren**

An `curve-labels.php` anhängen:

```php
// Die Mittelachse aus den Innendreiecken (Chordal Axis).
//
// Knoten sind die Mittelpunkte der INNEREN Kanten -- Kanten zwischen zwei Innendreiecken. Ein
// Dreieck mit drei inneren Kanten ist eine Verzweigung (Stern ueber den Schwerpunkt), mit zwei ein
// Durchgang, mit einer eine Spitze (bis zur gegenueberliegenden Ecke).
//
// 💣 FALLE 1 -- der Innentest. Der Schwerpunkt allein genuegt nicht: ein Dreieck ueber einer Bucht
// kann ihn drinnen haben und trotzdem draussen verlaufen. Also auch die drei Kantenmitten pruefen,
// ABER ein Stueck zum Schwerpunkt hin gerueckt: die Mitte einer RANDkante liegt exakt auf der
// Polygonlinie, und dort ist der Strahlentest eine Muenze. Ungerueckt fiel im Prototyp jedes
// randstaendige Dreieck heraus und die Achse zerfiel in Splitter (Rohachse 2,2 statt 139 Einheiten
// an den Drachensteinen). Eine Sehne UEBER eine Bucht holt der Ruck nicht herein -- 5 % sind zu
// wenig.
//
// 💣 FALLE 2 -- KEIN Deckel auf die Kantenlaenge. Im Inneren einer breiten Flaeche sind die
// Dreiecke von Natur aus gross. Ein Laengendeckel wirkt wie eine Rauschunterdrueckung und loescht
// genau die Achse, die man sucht.
function avesmapsCurveChordalAxis(array $points, array $tris, array $rings): array
{
    $inner = [];
    foreach ($tris as $t) {
        [$a, $b, $c] = $t;
        $cx = ($points[$a][0] + $points[$b][0] + $points[$c][0]) / 3.0;
        $cy = ($points[$a][1] + $points[$b][1] + $points[$c][1]) / 3.0;
        if (!avesmapsCurvePointInPolygon([$cx, $cy], $rings)) {
            continue;
        }
        $ruck = static function (float $px, float $py) use ($cx, $cy): array {
            return [$px + (($cx - $px) * 0.05), $py + (($cy - $py) * 0.05)];
        };
        $mitten = [
            $ruck(($points[$a][0] + $points[$b][0]) / 2.0, ($points[$a][1] + $points[$b][1]) / 2.0),
            $ruck(($points[$b][0] + $points[$c][0]) / 2.0, ($points[$b][1] + $points[$c][1]) / 2.0),
            $ruck(($points[$c][0] + $points[$a][0]) / 2.0, ($points[$c][1] + $points[$a][1]) / 2.0),
        ];
        $drinnen = true;
        foreach ($mitten as $m) {
            if (!avesmapsCurvePointInPolygon($m, $rings)) {
                $drinnen = false;
                break;
            }
        }
        if ($drinnen) {
            $inner[] = ['v' => $t, 'cx' => $cx, 'cy' => $cy];
        }
    }

    $kantenSchluessel = static function (int $i, int $j): string {
        return $i < $j ? $i . ',' . $j : $j . ',' . $i;
    };
    $nutzung = [];
    foreach ($inner as $ti => $rec) {
        [$a, $b, $c] = $rec['v'];
        foreach ([[$a, $b], [$b, $c], [$c, $a]] as $e) {
            $nutzung[$kantenSchluessel($e[0], $e[1])][] = $ti;
        }
    }

    $nodes = [];
    $adj = [];
    $index = [];
    $knoten = static function (string $key, float $x, float $y) use (&$nodes, &$adj, &$index): int {
        if (isset($index[$key])) {
            return $index[$key];
        }
        $id = count($nodes);
        $nodes[] = [$x, $y];
        $adj[] = [];
        $index[$key] = $id;

        return $id;
    };
    $binde = static function (int $u, int $v) use (&$nodes, &$adj): void {
        $w = hypot($nodes[$u][0] - $nodes[$v][0], $nodes[$u][1] - $nodes[$v][1]);
        $adj[$u][] = [$v, $w];
        $adj[$v][] = [$u, $w];
    };

    foreach ($inner as $ti => $rec) {
        [$a, $b, $c] = $rec['v'];
        $geteilt = [];
        foreach ([[$a, $b], [$b, $c], [$c, $a]] as $e) {
            if (count($nutzung[$kantenSchluessel($e[0], $e[1])] ?? []) === 2) {
                $geteilt[] = $e;
            }
        }
        if ($geteilt === []) {
            continue;
        }
        $mitte = static function (array $e) use ($points, $knoten, $kantenSchluessel): int {
            return $knoten(
                'e' . $kantenSchluessel($e[0], $e[1]),
                ($points[$e[0]][0] + $points[$e[1]][0]) / 2.0,
                ($points[$e[0]][1] + $points[$e[1]][1]) / 2.0
            );
        };
        if (count($geteilt) === 3) {
            $mittelpunkt = $knoten('t' . $ti, $rec['cx'], $rec['cy']);
            foreach ($geteilt as $e) {
                $binde($mittelpunkt, $mitte($e));
            }
        } elseif (count($geteilt) === 2) {
            $binde($mitte($geteilt[0]), $mitte($geteilt[1]));
        } else {
            $e = $geteilt[0];
            $spitze = null;
            foreach ([$a, $b, $c] as $v) {
                if ($v !== $e[0] && $v !== $e[1]) {
                    $spitze = $v;
                    break;
                }
            }
            if ($spitze !== null) {
                $binde($mitte($e), $knoten('v' . $spitze, $points[$spitze][0], $points[$spitze][1]));
            }
        }
    }

    return ['nodes' => $nodes, 'adj' => $adj, 'inner_count' => count($inner)];
}

// Dijkstra vom Startknoten; liefert den entferntesten Knoten und die Vorgaengerkette.
function avesmapsCurveFarthest(array $nodes, array $adj, int $start): array
{
    $anzahl = count($nodes);
    $dist = array_fill(0, $anzahl, INF);
    $prev = array_fill(0, $anzahl, -1);
    $fertig = array_fill(0, $anzahl, false);
    $dist[$start] = 0.0;
    while (true) {
        $u = -1;
        $best = INF;
        for ($i = 0; $i < $anzahl; $i++) {
            if (!$fertig[$i] && $dist[$i] < $best) {
                $best = $dist[$i];
                $u = $i;
            }
        }
        if ($u < 0) {
            break;
        }
        $fertig[$u] = true;
        foreach ($adj[$u] as [$v, $w]) {
            if ($dist[$u] + $w < $dist[$v]) {
                $dist[$v] = $dist[$u] + $w;
                $prev[$v] = $u;
            }
        }
    }
    $knoten = $start;
    $best = -1.0;
    for ($i = 0; $i < $anzahl; $i++) {
        if ($dist[$i] < INF && $dist[$i] > $best) {
            $best = $dist[$i];
            $knoten = $i;
        }
    }

    return ['node' => $knoten, 'prev' => $prev];
}

// Die „beste" Mittellinie: der laengste gewichtete Pfad, gefunden mit zwei Dijkstra-Laeufen.
function avesmapsCurveLongestPath(array $nodes, array $adj): array
{
    if ($nodes === []) {
        return [];
    }
    $a = avesmapsCurveFarthest($nodes, $adj, 0);
    $b = avesmapsCurveFarthest($nodes, $adj, $a['node']);
    $pfad = [];
    $cur = $b['node'];
    $wache = 0;
    while ($cur !== -1 && $wache++ < count($nodes) + 5) {
        $pfad[] = $nodes[$cur];
        $cur = $b['prev'][$cur];
    }

    return array_reverse($pfad);
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```
Erwartet: `curve-labels: Grundlagen ok`

- [ ] **Schritt 5: Gegenprobe, dass Falle 1 wirklich gewacht wird**

Den Faktor `0.05` in `avesmapsCurveChordalAxis` versuchsweise auf `0.0` setzen, Test laufen lassen:
die Zusicherung `inner_count === count($punkte) - 2` MUSS fehlschlagen. Danach `0.05`
wiederherstellen und den Test erneut laufen lassen.

⚠️ Schlägt der Test bei `0.0` **nicht** fehl, wacht er die Falle nicht — dann ist der Streifen zu
einfach und braucht einen konkaven Rand. Das ist ein Befund, kein Formfehler; melden.

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/app/curve-labels.php api/_internal/app/__tests__/curve-labels-test.php
git commit -m "feat(kurvenlabel): Mittelachse und laengster Pfad -- samt der zwei Fallen im Test"
```

---

## Aufgabe 4: Glättung, mehrteilige Flächen und der Gesamtlauf

**Dateien:**
- Ändern: `api/_internal/app/curve-labels.php` (anhängen)
- Neu: `api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json`
- Test: `api/_internal/app/__tests__/curve-labels-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: alles aus 1–3.
- Liefert: `avesmapsCurveResample(array $line, int $n): array`,
  `avesmapsCurvePrincipalFrame(array $points): array` (→ `[mx, my, cos θ, sin θ]`),
  `avesmapsCurvePolyFit(array $line, int $degree): array`,
  `avesmapsCurveStraighten(array $line, float $amount): array`,
  `avesmapsCurveLineLength(array $line): float`,
  `avesmapsCurveBaseline(array $geometries, array $options): ?array`.
  `$geometries` ist eine Liste von GeoJSON-Geometrien (`Polygon`|`MultiPolygon`);
  `$options` kennt `simplify_tol`, `spacing`, `poly_degree`, `straighten`, `min_part_share`,
  `samples`. Rückgabe: `['line' => [[x,y], …], 'length' => float, 'parts_used' => int]` oder `null`.

- [ ] **Schritt 1: Die Fixture erzeugen**

⚠️ Dieser Befehl ist **ausgeführt und geprüft**, nicht abgeschrieben. Der naheliegende Kurzschluss
`src.indexOf('=')` funktioniert NICHT: das erste `=` der Datei steht bei Zeichen 188, in
`kind=topographie` im Kommentarkopf. Der Anker muss der Variablenname sein.

```bash
node -e "
const fs=require('fs');
const src=fs.readFileSync('docs/kurvenlabel-referenzdaten.js','utf8');
const anker='window.KURVEN_REFERENZ =';
const daten=JSON.parse(src.slice(src.indexOf(anker)+anker.length).trim().replace(/;\s*$/,''));
const raus=daten.map(r=>({name:r.name, kind:r.kind, geometries:r.geoms.map(g=>({type:g.type,coordinates:g.coordinates})), labels:r.labels.map(l=>({text:l.text,rotation:l.rotation,size:l.size}))}));
fs.mkdirSync('api/_internal/app/__tests__/fixtures',{recursive:true});
fs.writeFileSync('api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json', JSON.stringify(raus));
console.log('Flaechen:', raus.length, '| KB', (fs.statSync('api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json').size/1024).toFixed(1));
console.log('Teile je Flaeche:', raus.map(r=>r.geometries.map(g=>g.type==='Polygon'?1:g.coordinates.length).reduce((a,b)=>a+b,0)).join(', '));
"
```
Erwartet, wörtlich:
```
Flaechen: 6 | KB 65.2
Teile je Flaeche: 1, 3, 1, 26, 3, 9
```

- [ ] **Schritt 2: Den fehlschlagenden Test anhängen**

```php
// ------------------------------------------------------- DER GESAMTLAUF, AN SECHS FLAECHEN ---

// 🔴 Die Fixture ist am 22.08.2026 aus der LIVE-Datenbank gemessen, nicht erfunden
// (docs/kurvenlabel-referenzdaten.js). Die Bogenlaengen darunter stammen aus dem abgenommenen
// Prototyp mit genau diesen Vorgabewerten. Weicht PHP hier ab, rechnet es etwas anderes als das,
// was der Owner gesehen und abgenommen hat.
// 🪤 Die sechs sind bewusst GEMISCHT: eine einteilige Flaeche, eine zweilappige, eine mit 26 Teilen
// und eine Region mit zwei Labels. Eine homogene Fixture faengt den gemischten Fall nie.
$referenz = json_decode(file_get_contents(__DIR__ . '/fixtures/kurvenlabel-referenz.json'), true);
assert(is_array($referenz) && count($referenz) === 6);

$erwartet = [
    'Drachensteine' => 87.9,
    'Koschberge' => 70.1,
    'Schwarze Sichel' => 141.2,
    'Östlicher Hangwald des Raschtulswalls' => 122.1,
    'Östlicher Hangwald des Finsterkamms' => 82.2,
    'Westlicher Hangwald des Raschtulswalls' => 125.8,
];

$optionen = [
    'simplify_tol' => 1.55,
    'spacing' => 0.30,
    'poly_degree' => 3,
    'straighten' => 0.0,
    'min_part_share' => 0.02,
    'samples' => 120,
];

foreach ($referenz as $flaeche) {
    $name = (string) $flaeche['name'];
    $kurve = avesmapsCurveBaseline($flaeche['geometries'], $optionen);
    assert($kurve !== null, $name . ': keine Kurve');
    assert(count($kurve['line']) === 120, $name . ': falsche Punktzahl');

    // ⚠️ 2 % Toleranz, nicht Gleichheit: PHP und JavaScript runden im Polynomfit verschieden.
    // Groesser als 2 % ist kein Rundungsunterschied mehr, sondern ein anderes Verfahren.
    $soll = $erwartet[$name];
    $ist = $kurve['length'];
    assert(abs($ist - $soll) / $soll < 0.02, $name . ': Bogen ' . round($ist, 1) . ' statt ' . $soll);
}

// 💣 Mehrteilige Flaechen werden zu EINER Kurve verbunden. Die Koschberge liegen in zwei Lappen
// (59 % / 41 %); nur den groesseren zu nehmen liefert eine Kurve, die mitten in der Kette endet.
$koschberge = null;
foreach ($referenz as $f) {
    if ($f['name'] === 'Koschberge') {
        $koschberge = $f;
    }
}
assert($koschberge !== null);
$verbunden = avesmapsCurveBaseline($koschberge['geometries'], $optionen);
$nurGroesste = avesmapsCurveBaseline($koschberge['geometries'], ['min_part_share' => 0.99] + $optionen);
assert($verbunden['parts_used'] >= 2);
assert($nurGroesste['parts_used'] === 1);
assert($verbunden['length'] > $nurGroesste['length'] * 1.15);

// ⚠️ Die Mindestanteil-Schwelle ist keine Zierde: beim Raschtulswall-Hangwald sind 26 Teile da,
// wesentlich sind vier. Ohne Schwelle zieht eine Streuinsel die gemeinsame Kurve schief.
$hangwald = null;
foreach ($referenz as $f) {
    if ($f['name'] === 'Östlicher Hangwald des Raschtulswalls') {
        $hangwald = $f;
    }
}
$mitSchwelle = avesmapsCurveBaseline($hangwald['geometries'], $optionen);
$ohneSchwelle = avesmapsCurveBaseline($hangwald['geometries'], ['min_part_share' => 0.0] + $optionen);
// ⚠️ Die Zusicherung ist eine SPANNE, keine feste Zahl. `parts_used` zaehlt die Teile, aus denen
// wirklich eine Achse wurde -- ein Splitter kann zu klein dafuer sein, und dann waere eine exakte 4
// sproede aus einem Grund, der nichts mit der Regel zu tun hat. Geprueft wird, was die Regel
// behauptet: die Schwelle SIEBT, und sie laesst nicht alles durch.
assert($mitSchwelle['parts_used'] >= 2 && $mitSchwelle['parts_used'] <= 4, 'wesentliche Teile: ' . $mitSchwelle['parts_used']);
assert($ohneSchwelle['parts_used'] > $mitSchwelle['parts_used']);
assert($ohneSchwelle['parts_used'] > 8);

// Eine leere oder unbrauchbare Geometrie liefert null, keinen Fehler.
assert(avesmapsCurveBaseline([], $optionen) === null);
assert(avesmapsCurveBaseline([['type' => 'Polygon', 'coordinates' => [[[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]]]]], $optionen) === null);
```

- [ ] **Schritt 3: Test laufen lassen, er muss fehlschlagen**

Erwartet: `Call to undefined function avesmapsCurveBaseline()`

- [ ] **Schritt 4: Implementieren**

An `curve-labels.php` anhängen:

```php
function avesmapsCurveLineLength(array $line): float
{
    $l = 0.0;
    $anzahl = count($line);
    for ($i = 1; $i < $anzahl; $i++) {
        $l += hypot($line[$i][0] - $line[$i - 1][0], $line[$i][1] - $line[$i - 1][1]);
    }

    return $l;
}

// Auf n gleichmaessig verteilte Punkte umtasten.
function avesmapsCurveResample(array $line, int $n): array
{
    if (count($line) < 2 || $n < 2) {
        return $line;
    }
    $kum = [0.0];
    for ($i = 1; $i < count($line); $i++) {
        $kum[$i] = $kum[$i - 1] + hypot($line[$i][0] - $line[$i - 1][0], $line[$i][1] - $line[$i - 1][1]);
    }
    $gesamt = $kum[count($kum) - 1];
    if ($gesamt <= 0.0) {
        return $line;
    }
    $raus = [];
    $seg = 1;
    for ($k = 0; $k < $n; $k++) {
        $ziel = ($gesamt * $k) / ($n - 1);
        while ($seg < count($kum) - 1 && $kum[$seg] < $ziel) {
            $seg++;
        }
        $spanne = $kum[$seg] - $kum[$seg - 1];
        $t = $spanne > 0.0 ? ($ziel - $kum[$seg - 1]) / $spanne : 0.0;
        $raus[] = [
            $line[$seg - 1][0] + (($line[$seg][0] - $line[$seg - 1][0]) * $t),
            $line[$seg - 1][1] + (($line[$seg][1] - $line[$seg - 1][1]) * $t),
        ];
    }

    return $raus;
}

// Polynomfit im Hauptachsen-Frame. Das Ergebnis ist von Bauart her EINE weiche Biegung und kein
// geglaetteter Zickzack -- Schrift auf einem Zickzack ist unlesbar, lange bevor die Kurve „falsch"
// waere.
// Der Hauptachsen-Frame einer Punktwolke: Schwerpunkt plus die Richtung der groessten Streuung.
// 🔴 EIGENE FUNKTION, weil ZWEI Rechnungen ihn brauchen -- der Polynomfit einer Linie und der Fit
// ueber mehrere Teilflaechen. Zweimal dieselben zwanzig Zeilen waeren die zweite Wahrheit ueber
// dieselbe Groesse, und sie laufen beim ersten Eingriff auseinander.
//
// @return array{0:float,1:float,2:float,3:float} [mx, my, cos(theta), sin(theta)]
function avesmapsCurvePrincipalFrame(array $points): array
{
    $n = count($points);
    if ($n === 0) {
        return [0.0, 0.0, 1.0, 0.0];
    }
    $mx = 0.0;
    $my = 0.0;
    foreach ($points as $p) {
        $mx += $p[0];
        $my += $p[1];
    }
    $mx /= $n;
    $my /= $n;
    $sxx = $sxy = $syy = 0.0;
    foreach ($points as $p) {
        $dx = $p[0] - $mx;
        $dy = $p[1] - $my;
        $sxx += $dx * $dx;
        $sxy += $dx * $dy;
        $syy += $dy * $dy;
    }
    $theta = 0.5 * atan2(2 * $sxy, $sxx - $syy);

    return [$mx, $my, cos($theta), sin($theta)];
}

function avesmapsCurvePolyFit(array $line, int $degree): array
{
    $n = count($line);
    if ($n < $degree + 2) {
        return $line;
    }
    [$mx, $my, $ct, $st] = avesmapsCurvePrincipalFrame($line);
    $u = [];
    $v = [];
    foreach ($line as $p) {
        $dx = $p[0] - $mx;
        $dy = $p[1] - $my;
        $u[] = ($dx * $ct) + ($dy * $st);
        $v[] = (-$dx * $st) + ($dy * $ct);
    }
    $m = $degree + 1;
    $A = [];
    for ($r = 0; $r < $m; $r++) {
        $A[$r] = array_fill(0, $m + 1, 0.0);
    }
    for ($i = 0; $i < $n; $i++) {
        $pw = [1.0];
        for ($k = 1; $k < 2 * $m; $k++) {
            $pw[$k] = $pw[$k - 1] * $u[$i];
        }
        for ($r = 0; $r < $m; $r++) {
            for ($c = 0; $c < $m; $c++) {
                $A[$r][$c] += $pw[$r + $c];
            }
            $A[$r][$m] += $pw[$r] * $v[$i];
        }
    }
    for ($col = 0; $col < $m; $col++) {
        $piv = $col;
        for ($r = $col + 1; $r < $m; $r++) {
            if (abs($A[$r][$col]) > abs($A[$piv][$col])) {
                $piv = $r;
            }
        }
        if (abs($A[$piv][$col]) < 1e-12) {
            return $line;
        }
        $tmp = $A[$col];
        $A[$col] = $A[$piv];
        $A[$piv] = $tmp;
        for ($r = 0; $r < $m; $r++) {
            if ($r === $col) {
                continue;
            }
            $f = $A[$r][$col] / $A[$col][$col];
            for ($c = $col; $c <= $m; $c++) {
                $A[$r][$c] -= $f * $A[$col][$c];
            }
        }
    }
    $koeff = [];
    for ($r = 0; $r < $m; $r++) {
        $koeff[$r] = $A[$r][$m] / $A[$r][$r];
    }
    $raus = [];
    for ($i = 0; $i < $n; $i++) {
        $w = 0.0;
        $p = 1.0;
        for ($k = 0; $k < $m; $k++) {
            $w += $koeff[$k] * $p;
            $p *= $u[$i];
        }
        $raus[] = [$mx + ($u[$i] * $ct) - ($w * $st), $my + ($u[$i] * $st) + ($w * $ct)];
    }

    return $raus;
}

// Zwischen Kurve und ihrer Sehne mischen (0 = Kurve, 1 = Gerade). Die Endpunkte bleiben liegen.
function avesmapsCurveStraighten(array $line, float $amount): array
{
    if ($amount <= 0.0 || count($line) < 2) {
        return $line;
    }
    $a = $line[0];
    $b = $line[count($line) - 1];
    $kum = [0.0];
    for ($i = 1; $i < count($line); $i++) {
        $kum[$i] = $kum[$i - 1] + hypot($line[$i][0] - $line[$i - 1][0], $line[$i][1] - $line[$i - 1][1]);
    }
    $gesamt = $kum[count($kum) - 1] ?: 1.0;
    $raus = [];
    foreach ($line as $i => $p) {
        $t = $kum[$i] / $gesamt;
        $sx = $a[0] + (($b[0] - $a[0]) * $t);
        $sy = $a[1] + (($b[1] - $a[1]) * $t);
        $raus[] = [$p[0] + (($sx - $p[0]) * $amount), $p[1] + (($sy - $p[1]) * $amount)];
    }

    return $raus;
}

// GeoJSON-Geometrien in Teilflaechen zerlegen, nach Flaeche absteigend.
function avesmapsCurveGeometryParts(array $geometries): array
{
    $teile = [];
    foreach ($geometries as $g) {
        $typ = (string) ($g['type'] ?? '');
        $koord = $g['coordinates'] ?? [];
        $polys = $typ === 'Polygon' ? [$koord] : $koord;
        foreach ($polys as $rings) {
            if (!is_array($rings) || $rings === [] || count($rings[0]) < 4) {
                continue;
            }
            $teile[] = ['rings' => $rings, 'area' => abs(avesmapsCurveRingArea($rings[0]))];
        }
    }
    usort($teile, static fn(array $a, array $b): int => $b['area'] <=> $a['area']);

    return $teile;
}

// 💣 Ein Gebirge ist selten EINE Flaeche. Die Koschberge liegen in zwei Lappen (59 % / 41 %); die
// Mittelachse des groesseren allein endet mitten in der Kette. Deshalb die Achsen ALLER
// wesentlichen Teile als eine Punktwolke nehmen und EIN Polynom hindurchlegen -- die Luecke
// ueberbrueckt die Kurve von selbst, weil sie ueber die Hauptachse parametrisiert ist und nicht
// ueber die Flaeche laeuft.
// ⚠️ Das ist nur fuer die BESCHRIFTUNG richtig, nicht als Geometrie: die Kurve verlaesst zwischen
// zwei Lappen die Flaeche. Genau das tut eine Kartenbeschriftung auch.
function avesmapsCurveFitAcross(array $wolken, int $degree, int $samples): ?array
{
    $pts = [];
    foreach ($wolken as $w) {
        foreach ($w as $p) {
            $pts[] = $p;
        }
    }
    if (count($pts) < $degree + 2) {
        return null;
    }
    [$mx, $my, $ct, $st] = avesmapsCurvePrincipalFrame($pts);
    $paare = [];
    foreach ($pts as $p) {
        $dx = $p[0] - $mx;
        $dy = $p[1] - $my;
        $paare[] = [($dx * $ct) + ($dy * $st), (-$dx * $st) + ($dy * $ct)];
    }
    usort($paare, static fn(array $a, array $b): int => $a[0] <=> $b[0]);
    $sortiert = [];
    foreach ($paare as $uv) {
        $sortiert[] = [$mx + ($uv[0] * $ct) - ($uv[1] * $st), $my + ($uv[0] * $st) + ($uv[1] * $ct)];
    }

    return avesmapsCurveResample(avesmapsCurvePolyFit($sortiert, $degree), $samples);
}

// Die Mittelachse EINES Teils.
function avesmapsCurveAxisForPart(array $rings, array $o): ?array
{
    $vereinfacht = [];
    foreach ($rings as $r) {
        $vereinfacht[] = avesmapsCurveSimplifyRing($r, (float) $o['simplify_tol']);
    }
    $pts = [];
    foreach ($vereinfacht as $r) {
        foreach (avesmapsCurveDensifyRing($r, (float) $o['spacing']) as $p) {
            $pts[] = $p;
        }
    }
    $gesehen = [];
    $uniq = [];
    foreach ($pts as $p) {
        $k = number_format($p[0], 4, '.', '') . ',' . number_format($p[1], 4, '.', '');
        if (!isset($gesehen[$k])) {
            $gesehen[$k] = true;
            $uniq[] = $p;
        }
    }
    if (count($uniq) < 4) {
        return null;
    }
    $tris = avesmapsCurveDelaunay($uniq);
    $achse = avesmapsCurveChordalAxis($uniq, $tris, $vereinfacht);
    if ($achse['nodes'] === []) {
        return null;
    }
    $roh = avesmapsCurveLongestPath($achse['nodes'], $achse['adj']);

    return count($roh) >= 2 ? avesmapsCurveResample($roh, (int) $o['samples']) : null;
}

// Der Gesamtlauf: Geometrien -> eine fertige Beschriftungskurve.
function avesmapsCurveBaseline(array $geometries, array $options): ?array
{
    $o = $options + [
        'simplify_tol' => 1.55,
        'spacing' => 0.30,
        'poly_degree' => 3,
        'straighten' => 0.0,
        'min_part_share' => 0.02,
        'samples' => 120,
    ];
    $teile = avesmapsCurveGeometryParts($geometries);
    if ($teile === []) {
        return null;
    }
    $gesamt = 0.0;
    foreach ($teile as $t) {
        $gesamt += $t['area'];
    }
    if ($gesamt <= 0.0) {
        return null;
    }
    // Die groesste immer, dazu jede ab dem Mindestanteil.
    $wesentlich = [];
    foreach ($teile as $i => $t) {
        if ($i === 0 || ($t['area'] / $gesamt) >= (float) $o['min_part_share']) {
            $wesentlich[] = $t;
        }
    }
    $achsen = [];
    foreach ($wesentlich as $t) {
        $achse = avesmapsCurveAxisForPart($t['rings'], $o);
        if ($achse !== null) {
            $achsen[] = $achse;
        }
    }
    if ($achsen === []) {
        return null;
    }
    if (count($achsen) > 1) {
        $gemeinsam = avesmapsCurveFitAcross($achsen, (int) $o['poly_degree'], (int) $o['samples']);
        $linie = $gemeinsam ?? $achsen[0];
    } else {
        $linie = avesmapsCurvePolyFit($achsen[0], (int) $o['poly_degree']);
    }
    $linie = avesmapsCurveStraighten($linie, (float) $o['straighten']);

    return [
        'line' => $linie,
        'length' => avesmapsCurveLineLength($linie),
        'parts_used' => count($achsen),
    ];
}
```

- [ ] **Schritt 5: Test laufen lassen, er muss durchgehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-labels-test.php
```
Erwartet: `curve-labels: Grundlagen ok`

⚠️ Schlägt eine der sechs Bogenlängen ausserhalb 2 % fehl: **nicht die Toleranz aufweiten.** Die
Abweichung nennen und den Prototyp danebenlegen — er hat dieselbe Rechnung in JavaScript, und die
Stelle, an der die Zahlen auseinanderlaufen, ist findbar.

- [ ] **Schritt 6: Rechenzeit messen und nennen**

```bash
php -d extension=php_mbstring.dll -r '
require "api/_internal/app/curve-labels.php";
$r = json_decode(file_get_contents("api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json"), true);
foreach ($r as $f) {
  $t = microtime(true);
  $k = avesmapsCurveBaseline($f["geometries"], []);
  printf("%-42s %6.1f Einheiten %7.1f ms\n", $f["name"], $k["length"], (microtime(true)-$t)*1000);
}'
```
Erwartet: sechs Zeilen, Rechenzeit je Fläche im Bereich **20–400 ms**. ⚠️ Deutlich mehr ist ein
Befund: der Prototyp braucht 26–104 ms in JavaScript. Melden, nicht stillschweigend hinnehmen.

- [ ] **Schritt 7: Committen**

```bash
git add api/_internal/app/curve-labels.php api/_internal/app/__tests__/curve-labels-test.php api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json
git diff --staged --stat
git commit -m "feat(kurvenlabel): Glaettung, mehrteilige Flaechen und der Gesamtlauf -- an sechs gemessenen Flaechen gewacht"
```

---

## Aufgabe 5: Die Einstellung an der Region

**Dateien:**
- Neu: `api/_internal/app/curve-label-store.php`
- Test: `api/_internal/app/__tests__/curve-label-store-test.php`

**Schnittstellen:**
- Verbraucht: **funktional nichts** aus 1–4 — die beiden Regelfunktionen kommen ohne Geometrie aus.
  ⚠️ Die Datei bindet `curve-labels.php` trotzdem gleich hier ein: **Aufgabe 8** ruft aus derselben
  Datei `avesmapsCurveBaseline` und `avesmapsCurveResample` auf. Das Einbinden erst dort nachzuholen
  hiesse, dieselbe Datei zweimal anzufassen. (Ein Prüfer hat den Widerspruch zwischen dieser Zeile
  und dem Codeblock unten zu Recht gemeldet — die Zeile war ungenau, nicht der Code.)
- Liefert: `avesmapsCurveLabelSettingsFromProperties(?array $properties): array` →
  `['enabled' => bool, 'max_labels' => int]`;
  `avesmapsCurveLabelRolloutFor(array $rotations): array` → dieselbe Form.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/app/__tests__/curve-label-store-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Test der Einstellungsregeln der Kurvenbeschriftung. Keine DB, kein HTTP.
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/curve-label-store-test.php
 *
 * Warum diese Regeln einen Test verdienen und keinen Kommentar: beide scheitern LEISE.
 *  - Eine fehlende Einstellung als „an" zu lesen aendert 657 Labels auf einen Schlag.
 *  - Ein Winkel von 360 Grad ist sichtbar 0 und numerisch nicht -- roh geprueft schaltet die
 *    Umstellregel dort eine Kurve ein, wo niemand etwas gedreht haben wollte.
 */

require_once __DIR__ . '/../curve-label-store.php';

// ------------------------------------------------------------------ DIE EINSTELLUNG ---

// 🔴 Fehlt der Schluessel, ist die Kurvenbeschriftung AUS. Ein leeres properties_json darf niemals
// 657 Labels umstellen.
$vorgabe = avesmapsCurveLabelSettingsFromProperties(null);
assert($vorgabe === ['enabled' => false, 'max_labels' => 1]);
assert(avesmapsCurveLabelSettingsFromProperties([]) === ['enabled' => false, 'max_labels' => 1]);

// Gesetzte Werte kommen durch.
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 2])
    === ['enabled' => true, 'max_labels' => 2]);

// 🔴 Der Deckel ist 3 (Owner 22.08.2026), und er wird geklemmt statt abgelehnt.
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 9])['max_labels'] === 3);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 0])['max_labels'] === 1);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => -4])['max_labels'] === 1);

// Unsinn im JSON kippt nicht auf „an".
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => 'vielleicht'])['enabled'] === false);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => 1])['enabled'] === true);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 'zwei'])['max_labels'] === 1);

// ------------------------------------------------------------------ DIE UMSTELLREGEL ---

// Rotation 0 ueberall -> bleibt aus. Das sind 601 der 657 Labels; sie duerfen sich am Umstelltag
// nicht um ein Pixel bewegen.
assert(avesmapsCurveLabelRolloutFor([0]) === ['enabled' => false, 'max_labels' => 1]);
assert(avesmapsCurveLabelRolloutFor([0, 0, 0]) === ['enabled' => false, 'max_labels' => 3]);

// Eine echte Drehung schaltet ein.
assert(avesmapsCurveLabelRolloutFor([326])['enabled'] === true);

// 💣 360 Grad ist sichtbar 0. Genau ein Label im Livebestand hat das: „Weiden", das einzige
// gedrehte derographische. Roh geprueft bekaeme es eine Kurve, obwohl dort niemand etwas gedreht
// haben wollte.
assert(avesmapsCurveLabelRolloutFor([360])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([720])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([-360])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([-90])['enabled'] === true);

// 🔴 Die Anzahl ist „so viele Labels wie vorhanden, hoechstens 3" -- nicht fest 1. Fuenf gedrehte
// Regionen tragen heute zwei Labels; auf 1 gesetzt verloeren sie einen Namen.
assert(avesmapsCurveLabelRolloutFor([300, 300]) === ['enabled' => true, 'max_labels' => 2]);
assert(avesmapsCurveLabelRolloutFor([317, 325]) === ['enabled' => true, 'max_labels' => 2]);
assert(avesmapsCurveLabelRolloutFor([10, 20, 30, 40]) === ['enabled' => true, 'max_labels' => 3]);

// Eine Region ohne Label ergibt keine Umstellung.
assert(avesmapsCurveLabelRolloutFor([]) === ['enabled' => false, 'max_labels' => 1]);

echo "curve-label-store tests passed\n";
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-label-store-test.php
```
Erwartet: `Failed opening required '.../curve-label-store.php'`

- [ ] **Schritt 3: `api/_internal/app/curve-label-store.php` anlegen**

```php
<?php

declare(strict_types=1);

// Die Kurvenbeschriftung je REGION lesen und ans Label haengen.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §2, §8
//
// 🔴 DIE EINSTELLUNG GEHOERT DER REGION, nicht dem Label und nicht der Flaeche (Owner 22.08.2026).
// Eine Region traegt N Labels und M Flaechen; der Wert existiert genau einmal, in
// ecosystem_region.properties_json. Die Spalte gibt es bereits -- kein DDL.

require_once __DIR__ . '/curve-labels.php';

const AVESMAPS_CURVE_LABEL_MAX = 3;

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
        'max_labels' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, $zahl)),
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
        'max_labels' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, count($rotations))),
    ];
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-label-store-test.php
```
Erwartet: `curve-label-store tests passed`

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/curve-label-store.php api/_internal/app/__tests__/curve-label-store-test.php
git diff --staged --stat
git commit -m "feat(kurvenlabel): die Einstellung an der Region -- Vorgabe aus, Deckel 3, Umstellregel modulo 360"
```

---

## Aufgabe 6: Die Kurve ans Label hängen

**Dateien:**
- Ändern: `api/_internal/app/curve-label-store.php` (anhängen)
- Test: `api/_internal/app/__tests__/curve-label-store-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsCurveLabelSettingsFromProperties`, `avesmapsCurveBaseline`.
- Liefert: `avesmapsCurveApplyToFeatures(array &$features, array $byRegion): void`.
  `$byRegion` ist `region_public_id => ['line' => [[x,y], …], 'max_labels' => int]`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Vor die letzte `echo`-Zeile von `curve-label-store-test.php`:

```php
// ------------------------------------------------------------------ ANHAENGEN ---

$features = [
    ['properties' => ['feature_type' => 'label', 'public_id' => 'l1', 'ecosystem_region_public_id' => 'r1']],
    ['properties' => ['feature_type' => 'label', 'public_id' => 'l2', 'ecosystem_region_public_id' => 'r2']],
    ['properties' => ['feature_type' => 'label', 'public_id' => 'l3']],
    ['properties' => ['feature_type' => 'location', 'public_id' => 'o1', 'ecosystem_region_public_id' => 'r1']],
];
$byRegion = ['r1' => ['line' => [[1.0, 2.0], [3.0, 4.0]], 'max_labels' => 2]];
avesmapsCurveApplyToFeatures($features, $byRegion);

// Das Label seiner Region bekommt Kurve und Anzahl.
assert($features[0]['properties']['curve_label_line'] === [[1.0, 2.0], [3.0, 4.0]]);
assert($features[0]['properties']['curve_label_max'] === 2);

// 🔴 Eine Region OHNE Kurve bekommt keinen Schluessel -- nicht `null`, nicht `[]`. Der Client
// unterscheidet „hat keine Kurve" an der Abwesenheit; ein leeres Feld waere eine leere Kurve.
assert(!array_key_exists('curve_label_line', $features[1]['properties']));

// Ein Label ohne Region bleibt unberuehrt.
assert(!array_key_exists('curve_label_line', $features[2]['properties']));

// 💣 Nur LABELS. Ein Ort, der zufaellig in derselben Region liegt, bekommt nichts -- er hat keine
// Achse und traegt seinen Namen neben seinem Punkt.
assert(!array_key_exists('curve_label_line', $features[3]['properties']));

// Ein leeres Verzeichnis aendert nichts und wirft nicht.
$unveraendert = $features;
avesmapsCurveApplyToFeatures($features, []);
assert($features === $unveraendert);
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

Erwartet: `Call to undefined function avesmapsCurveApplyToFeatures()`

- [ ] **Schritt 3: Implementieren**

An `curve-label-store.php` anhängen:

```php
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
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

Erwartet: `curve-label-store tests passed`

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/curve-label-store.php api/_internal/app/__tests__/curve-label-store-test.php
git commit -m "feat(kurvenlabel): die Kurve ans Label haengen -- fehlt sie, fehlt der Schluessel"
```

---

## Aufgabe 7: Der Zwischenspeicher und sein Leser

🔴 **Der Lesepfad rechnet NICHT.** Der Entwurf sagt es in §7.1, und die Zahl sagt es auch: 56 Regionen
× rund 50 ms sind **2,8 Sekunden** auf jeder einzelnen `map-features`-Anfrage. Gerechnet wird im
Schreibpfad (Aufgabe 8); hier wird nur gelesen, was dort abgelegt wurde.

🔴 **Fehlt oder veraltet der Zwischenspeicher, gibt es keine Kurve** — und die Karte zeichnet eine
Gerade. Das ist die sichere Richtung: eine fehlende Kurve ist ein Schönheitsfehler, eine Kurve zu
einer Geometrie, die es nicht mehr gibt, ist ein Fehler, den niemand bemerkt.

**Dateien:**
- Ändern: `api/_internal/app/curve-label-store.php` (anhängen)
- Ändern: `api/app/map-features.php` (Aufruf + `PAYLOAD_VERSION`)
- Test: `api/_internal/app/__tests__/curve-label-store-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsCurveApplyToFeatures`, `avesmapsAppSettingGetWithoutDdl`
  (`api/_internal/app/app-setting.php`).
- Liefert: `avesmapsCurveCacheKey(): string` (die Konstante `curve_label_baselines`),
  `avesmapsCurveBaselinesFromCache(string $json, array $revisionByRegion): array`,
  `avesmapsCurveReadBaselines(PDO $pdo): array`.

Form des abgelegten JSON:
```json
{"version":1,"regions":{"<region_public_id>":{"rev":42,"max":1,"line":[[503.1,411.2], …]}}}
```

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Vor die letzte `echo`-Zeile von `curve-label-store-test.php`:

```php
// ------------------------------------------------------------------ ZWISCHENSPEICHER ---

$blob = json_encode([
    'version' => 1,
    'regions' => [
        'r1' => ['rev' => 7, 'max' => 2, 'line' => [[1.0, 2.0], [3.0, 4.0]]],
        'r2' => ['rev' => 3, 'max' => 1, 'line' => [[5.0, 6.0], [7.0, 8.0]]],
    ],
]);

// Passt die Revision, kommt die Kurve.
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => 7, 'r2' => 3]);
assert(array_keys($geladen) === ['r1', 'r2']);
assert($geladen['r1']['line'] === [[1.0, 2.0], [3.0, 4.0]]);
assert($geladen['r1']['max_labels'] === 2);

// 💣 Eine VERALTETE Kurve wird weggelassen, nicht ausgeliefert. Jemand hat die Flaeche geaendert;
// die alte Achse gehoert zu einer Geometrie, die es nicht mehr gibt. Die Karte zeichnet dann eine
// Gerade -- sichtbar schlichter, aber nicht falsch.
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => 8, 'r2' => 3]);
assert(array_keys($geladen) === ['r2']);

// Eine Region, die es nicht mehr gibt, faellt heraus.
assert(avesmapsCurveBaselinesFromCache($blob, []) === []);

// 🔴 Unsinn im Zwischenspeicher ergibt LEER, nie eine halbe Kurve und nie eine Ausnahme. Der
// Lesepfad einer Karte darf an einer Beschriftung nicht scheitern.
assert(avesmapsCurveBaselinesFromCache('', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('kein json', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('null', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('{"version":1}', ['r1' => 7]) === []);

// 💣 Eine kuenftige Fassung des Formats wird IGNORIERT, nicht falsch gelesen. Ohne diese Pruefung
// liest eine alte Auslieferung ein neues Feld als altes -- und niemand sieht es.
assert(avesmapsCurveBaselinesFromCache('{"version":2,"regions":{"r1":{"rev":7,"max":1,"line":[[1,2],[3,4]]}}}', ['r1' => 7]) === []);

// Eine Zeile ohne Linie ist keine Kurve.
assert(avesmapsCurveBaselinesFromCache('{"version":1,"regions":{"r1":{"rev":7,"max":1}}}', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('{"version":1,"regions":{"r1":{"rev":7,"max":1,"line":[[1,2]]}}}', ['r1' => 7]) === []);
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/curve-label-store-test.php
```
Erwartet: `Call to undefined function avesmapsCurveBaselinesFromCache()`

- [ ] **Schritt 3: Implementieren**

Oben in `curve-label-store.php`, neben das vorhandene `require_once`:

```php
require_once __DIR__ . '/app-setting.php';
```

Und ans Ende der Datei:

```php
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

// Den abgelegten Zwischenspeicher lesen und gegen die heutigen Geometrierevisionen halten.
//
// 🔴 Reine Funktion, damit sie ohne DB testbar ist -- dieselbe Trennung wie in
// ecosystem-label-link.php. Der PDO-Teil steht in avesmapsCurveReadBaselines darunter.
//
// 💣 Ein unlesbarer, leerer oder zu neuer Zwischenspeicher ergibt LEER. Nie eine halbe Kurve, nie
// eine Ausnahme: der Lesepfad einer Karte darf an einer Beschriftung nicht scheitern.
//
// @param array<string,int> $revisionByRegion region public_id => Summe der geometry_revision
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
        if ((int) ($rec['rev'] ?? -1) !== (int) $revisionByRegion[$regionId]) {
            continue;
        }
        $linie = $rec['line'] ?? null;
        if (!is_array($linie) || count($linie) < 2) {
            continue;
        }
        $sauber = [];
        foreach ($linie as $p) {
            if (!is_array($p) || count($p) < 2 || !is_numeric($p[0]) || !is_numeric($p[1])) {
                return [];
            }
            $sauber[] = [(float) $p[0], (float) $p[1]];
        }
        $raus[$regionId] = [
            'line' => $sauber,
            'max_labels' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, (int) ($rec['max'] ?? 1))),
        ];
    }

    return $raus;
}

// Der Leser fuer den Endpunkt: EINE leichte Aggregatabfrage plus EIN app_setting-Lesevorgang.
//
// ⚠️ KEIN DDL (AGENTS.md §10) -- deshalb avesmapsAppSettingGetWithoutDdl und nicht ...Get.
// ⚠️ KEINE Berechnung. 56 Regionen mal rund 50 ms waeren 2,8 s auf jeder Kartenanfrage.
function avesmapsCurveReadBaselines(PDO $pdo): array
{
    try {
        $stmt = $pdo->query(
            'SELECT r.public_id AS region_id, SUM(a.geometry_revision) AS rev
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
        $revisionByRegion[(string) $row['region_id']] = (int) $row['rev'];
    }
    if ($revisionByRegion === []) {
        return [];
    }

    try {
        $json = avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), '');
    } catch (Throwable $e) {
        error_log('avesmapsCurveReadBaselines (Zwischenspeicher): ' . $e->getMessage());

        return [];
    }

    return avesmapsCurveBaselinesFromCache($json, $revisionByRegion);
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

Erwartet: `curve-label-store tests passed`

- [ ] **Schritt 5: `api/app/map-features.php` verdrahten**

Zu den `require_once`-Zeilen oben:

```php
require_once __DIR__ . '/../_internal/app/curve-label-store.php';
```

Direkt **nach** der Zeile
`avesmapsEcosystemApplyLabelRegionsToFeatures($features, $labelRegions['by_label'], $labelRegions['kind_by_region'] ?? []);`
(heute Zeile 195):

```php
    // Die Beschriftungskurve. 🔴 STRIKT NACH der Zeile darueber: sie haengt an
    // properties.ecosystem_region_public_id, und fuer ~137 Labels ist das genau der Zeiger, den die
    // Zeile darueber gerade aufgeloest hat. Vertauscht verlieren diese Labels ihre Kurve wortlos --
    // dieselbe Reihenfolgefalle wie bei der Klimazone eine Zeile weiter unten.
    // ⚠️ Der Leser RECHNET NICHT, er liest den Zwischenspeicher (api/_internal/app/curve-label-store.php).
    avesmapsCurveApplyToFeatures($features, avesmapsCurveReadBaselines($pdo));
```

- [ ] **Schritt 6: `PAYLOAD_VERSION` hochsetzen**

Im Kopf von `api/app/map-features.php` steht eine nummerierte Liste der Payload-Versionen (zuletzt
„11: jedes Label einer Landschaftsflaeche traegt zusaetzlich properties.ecosystem_region_kind").
Eine Zeile anhängen und `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` um eins erhöhen:

```
// 12 (2026-08-22): ein Label, dessen Region die Kurvenbeschriftung eingeschaltet hat, traegt
//     properties.curve_label_line (die Beschriftungskurve in Kartenkoordinaten, 32 Punkte) und
//     properties.curve_label_max. 💣 Der Bump ist nicht Kosmetik: der ETag ist revisionsbasiert,
//     also behielte ein warmer Client den alten Rumpf ueber 304 und saehe nie eine Kurve --
//     waehrend der Server sie laengst liefert.
```

- [ ] **Schritt 7: Syntax und die Konstanten-Falle prüfen**

```bash
php -l api/app/map-features.php
php -l api/_internal/app/curve-label-store.php
php -l api/_internal/app/curve-labels.php
```
Erwartet: dreimal `No syntax errors detected`.

💣 PHP hebt Funktionen hoch, `const` auf Dateiebene aber **nicht** — und ein Fatal Error antwortet
mit einem LEEREN Rumpf, was im Browser wie ein Netzfehler aussieht. Beide Konstanten
(`AVESMAPS_CURVE_LABEL_MAX`, `AVESMAPS_CURVE_LABEL_PAYLOAD_POINTS`) stehen vor ihrer Benutzung. Der
repoweite Wächter:

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll $(find api tools -name 'const-vor-benutzung-test.php' | head -1)
```

- [ ] **Schritt 8: Eine Probe gegen die Datenbank — EINE Anfrage**

```bash
curl -s --compressed "http://localhost:8123/api/app/map-features.php" -o /tmp/mf.json -w "HTTP %{http_code} %{size_download} Bytes %{time_total}s\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/mf.json','utf8'));
const l=d.features.filter(f=>f.properties?.feature_type==='label');
console.log('Labels', l.length, '| mit Kurve', l.filter(f=>f.properties.curve_label_line).length);
"
```

Erwartet: `mit Kurve 0` — der Zwischenspeicher ist leer, niemand hat gerechnet. **Das ist der
Erfolg:** nichts hat sich geändert, und die Antwortzeit ist unverändert.

⚠️ Ist die Antwortzeit merklich gestiegen, ist die Aggregatabfrage der Grund. Sie läuft über
`idx_ecosystem_area_region` und sollte unter 20 ms bleiben; messen statt vermuten.

- [ ] **Schritt 9: Committen**

```bash
git add api/_internal/app/curve-label-store.php api/_internal/app/__tests__/curve-label-store-test.php api/app/map-features.php
git diff --staged
git commit -m "feat(kurvenlabel): Zwischenspeicher und Leser -- der Lesepfad rechnet nicht (Payload-Version 12)"
```

---

## Aufgabe 8: Der Sammellauf

Hier wird gerechnet — einmal, angestossen von einem Admin, nicht von einem Besucher.

🪤 **Gemessen nach Aufgabe 4, und die Zahl ist grösser als der Plan annahm:** eine Fläche kostet
**165–796 ms**, nicht die erwarteten 20–400. Profiliert liegt das zu rund 65 % an der
Delaunay-Triangulierung (107–539 ms) und nur zu 25 % am Dijkstra (23–178 ms) — der naheliegende
Verdacht „O(n²)-Dijkstra" zeigte auf die falsche Funktion. Treiber ist die Punktzahl: bei einem
Stützpunktabstand von 0,30 entstehen 521–1790 Punkte je Teilfläche.

**Folge für diesen Endpunkt:** rund 50 eingeschaltete Regionen × ~400 ms sind etwa **20 Sekunden**,
im schlechten Fall über 40. Das reisst die PHP-Laufzeitgrenze knapp. Deshalb zwei Dinge:

* Der Endpunkt setzt seine Laufzeitgrenze ausdrücklich hoch (Schritt 5) — mit einem Kommentar, der
  sagt warum, sonst „räumt" der nächste Leser sie weg.
* Schritt 7 **misst den echten Gesamtlauf** und schreibt die Zahl in den Bericht. Sie ist die
  Grundlage für die Entscheidung, ob gestückelt werden muss.

🔧 **Stückeln gehört NICHT in diesen Plan.** Das Haus löst lange Adminläufe gestückelt (das
Höhenraster fährt eine Anfrage je Fläche, das Datenbank-Backup ist fortsetzbar) — aber beides hat
eine Oberfläche, die den Fortschritt zeigt. Hier gibt es noch keine; der Auslöser kommt erst mit
der Kachel „Darstellung" (Plan 4). Dort wird entschieden, mit der gemessenen Zahl in der Hand.

**Dateien:**
- Neu: `api/edit/map/curve-labels-run.php`
- Ändern: `api/_internal/app/curve-label-store.php` (anhängen)
- Test: `api/_internal/app/__tests__/curve-label-store-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsCurveBaseline`, `avesmapsCurveLabelSettingsFromProperties`,
  `avesmapsCurveResample`, `avesmapsCurveCacheKey`, `avesmapsAppSettingSet`,
  `avesmapsAppSettingEnsureWideValue`, `avesmapsRequireUserWithCapability`
  (`api/_internal/auth.php`).
- Liefert: `avesmapsCurveBuildCachePayload(array $regionen): string`,
  `avesmapsCurveRebuildCache(PDO $pdo): array`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

```php
// ------------------------------------------------------------------ SAMMELLAUF ---

// Der Bauer der Ablage: nur eingeschaltete Regionen, Linie auf Lieferdichte gebracht, drei
// Nachkommastellen.
$gebaut = avesmapsCurveBuildCachePayload([
    'r1' => [
        'rev' => 7,
        'settings' => ['enabled' => true, 'max_labels' => 2],
        'geometries' => [['type' => 'Polygon', 'coordinates' => [[
            [0.0, 0.0], [100.0, 0.0], [100.0, 10.0], [0.0, 10.0], [0.0, 0.0],
        ]]]],
    ],
    'r2' => [
        'rev' => 3,
        'settings' => ['enabled' => false, 'max_labels' => 1],
        'geometries' => [['type' => 'Polygon', 'coordinates' => [[
            [0.0, 0.0], [50.0, 0.0], [50.0, 10.0], [0.0, 10.0], [0.0, 0.0],
        ]]]],
    ],
]);
$daten = json_decode($gebaut, true);
assert($daten['version'] === 1);

// 🔴 Eine ausgeschaltete Region steht NICHT in der Ablage. Sie mitzuschreiben hiesse, jede Karte
// Kurven ausliefern zu lassen, die niemand sehen soll.
assert(array_keys($daten['regions']) === ['r1']);
assert($daten['regions']['r1']['rev'] === 7);
assert($daten['regions']['r1']['max'] === 2);

// Lieferdichte: 32 Punkte, nicht die 120 der Rechnung.
assert(count($daten['regions']['r1']['line']) === 32);

// Drei Nachkommastellen -- die Quelle hat nicht mehr Aussagekraft, und die Nutzlast ist der Preis.
foreach ($daten['regions']['r1']['line'] as $punkt) {
    assert(round($punkt[0], 3) === $punkt[0]);
    assert(round($punkt[1], 3) === $punkt[1]);
}

// 💣 Was hier herauskommt, muss der Leser aus Aufgabe 7 wieder hereinbekommen. Die beiden Formate
// EINZELN zu testen liesse genau die Naht ungeprueft, an der sie auseinanderlaufen.
$zurueck = avesmapsCurveBaselinesFromCache($gebaut, ['r1' => 7, 'r2' => 3]);
assert(array_keys($zurueck) === ['r1']);
assert(count($zurueck['r1']['line']) === 32);
assert($zurueck['r1']['max_labels'] === 2);

// Eine Region ohne brauchbare Geometrie faellt still heraus, sie bricht den Lauf nicht ab.
$mitMuell = avesmapsCurveBuildCachePayload([
    'r3' => ['rev' => 1, 'settings' => ['enabled' => true, 'max_labels' => 1], 'geometries' => []],
]);
assert(json_decode($mitMuell, true)['regions'] === []);
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

Erwartet: `Call to undefined function avesmapsCurveBuildCachePayload()`

- [ ] **Schritt 3: Den Bauer implementieren**

An `curve-label-store.php` anhängen:

```php
// Aus den Regionen die Ablage bauen. Reine Funktion -- der PDO-Teil steht darunter.
//
// @param array<string,array{rev:int,settings:array{enabled:bool,max_labels:int},geometries:list<array<string,mixed>>}> $regionen
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
            'max' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, (int) ($rec['settings']['max_labels'] ?? 1))),
            'line' => $linie,
        ];
    }

    return (string) json_encode(['version' => 1, 'regions' => (object) $raus]);
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
                'settings' => avesmapsCurveLabelSettingsFromProperties(is_array($properties) ? $properties : null),
                'geometries' => [],
            ];
        }
        $regionen[$regionId]['rev'] += (int) $row['geometry_revision'];
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
```

- [ ] **Schritt 4: Test laufen lassen, er muss durchgehen**

Erwartet: `curve-label-store tests passed`

- [ ] **Schritt 5: Den Endpunkt anlegen**

`api/edit/map/curve-labels-run.php`:

🔴 **Form, Reihenfolge und Fehlerbehandlung sind von `api/edit/map/zoom-bands.php` abgeschrieben,
nicht erfunden.** Der erste Entwurf dieses Plans hatte fünf Signaturen geraten und alle fünf falsch:
`avesmapsLoadApiConfig` nimmt ein VERZEICHNIS, `avesmapsCreatePdo` nur den `database`-Teilbaum,
`avesmapsRequireUserWithCapability` KEIN PDO, es gibt ein eigenes `avesmapsErrorResponse`, und der
ganze Rumpf steht in einem `try`. Vor dem Schreiben die Vorlage daneben legen:

```bash
sed -n '1,60p' api/edit/map/zoom-bands.php
grep -n "^function avesmaps" api/_internal/bootstrap.php api/_internal/auth.php
```

```php
<?php

declare(strict_types=1);

// POST /api/edit/map/curve-labels-run.php -- der Sammellauf der Beschriftungskurven.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §7.1
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 Nur `admin`. Der Lauf rechnet ueber alle Flaechen und schreibt eine Zeile, die JEDE Karte
// liest -- das ist keine Editorhandlung.
// ⚠️ Er laeuft SEKUNDEN (56 Regionen mal rund 50 ms). Genau deshalb steht er hier und nicht im
// Lesepfad (AGENTS.md §9, STRATO).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/curve-label-store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Sammellauf nicht ausloesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    // 🔴 Der Riegel steht HIER, nicht nur am ausgegrauten Knopf im Fenster.
    avesmapsRequireUserWithCapability('admin');

    // ⚠️ Der Lauf braucht SEKUNDEN, nicht Millisekunden: gemessen 165-796 ms je Flaeche, und bei
    // rund 50 eingeschalteten Regionen sind das etwa 20 s. Ohne diese Zeile bricht PHP mitten im
    // Lauf ab -- und weil erst ganz am Ende geschrieben wird, waere das Ergebnis dann NICHTS,
    // stillschweigend. Bewusst 0 (unbegrenzt) und nicht eine geratene Zahl: die Laufzeit waechst
    // mit jeder Region, die ein Editor einschaltet.
    // 🔧 Sobald die Kachel "Darstellung" (Plan 4) einen Auslöser mit Fortschritt hat, gehoert der
    // Lauf gestueckelt -- so wie das Hoehenraster eine Anfrage je Flaeche faehrt.
    @set_time_limit(0);

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION -- dieselbe Falle steht in zoom-bands.php
    // ausdruecklich angeschrieben.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    $ergebnis = avesmapsCurveRebuildCache($pdo);

    if (!$ergebnis['ok']) {
        // 💣 Der Zurueckleser hat widersprochen: MySQL hat gekuerzt. Als Erfolg zu antworten waere
        // die Fehlerklasse, die den Speichern-Knopf der Tempowerte wochenlang unbemerkt lahmlegte
        // (AGENTS.md §10).
        avesmapsErrorResponse(500, 'curve_cache_truncated',
            'Die Ablage kam gekuerzt zurueck (' . $ergebnis['bytes'] . ' Bytes geschrieben).');
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'regions' => $ergebnis['regions'],
        'bytes' => $ergebnis['bytes'],
    ]);
} catch (Throwable $e) {
    // ⚠️ Die Meldung des Fehlers geht NICHT nach draussen (AGENTS.md §10, Info-Disclosure), aber
    // ins Protokoll -- eine Absage ohne Grund ist von aussen unauffindbar.
    error_log('curve-labels-run: ' . $e->getMessage());
    avesmapsErrorResponse(500, 'curve_run_failed', 'Der Sammellauf ist gescheitert.');
}
```

⚠️ **`avesmapsErrorResponse` und `avesmapsApiRoot` vor dem Schreiben nachsehen** — dieser Block
verlaesst sich auf beide, und der Plan hat sie aus `zoom-bands.php` uebernommen, nicht aus ihrer
Definition. Weicht eine Signatur ab, gilt die Datei, nicht dieser Plan:

```bash
grep -rn "function avesmapsErrorResponse\|function avesmapsApiRoot" api/_internal/
```

- [ ] **Schritt 6: Syntax prüfen**

```bash
php -l api/edit/map/curve-labels-run.php
```

- [ ] **Schritt 7: Den Lauf gegen die Datenbank probieren — EINE Anfrage**

⚠️ Angemeldet als Admin, sonst antwortet er 401/403.

```bash
curl -s -X POST "http://localhost:8123/api/edit/map/curve-labels-run.php" -b "$COOKIE" -w "\nHTTP %{http_code} %{time_total}s\n"
```

Erwartet vor dem Umstelllauf: `{"ok":true,"regions":0,"bytes":33}` — niemand hat die Einstellung
gesetzt, also gibt es nichts zu rechnen. ⚠️ Die von curl gemeldete Gesamtzeit ist hier die Messung,
die zählt — schreib sie in den Bericht.

⚠️ **Und miss den Lauf einmal unter Last**, sonst ist die Laufzeitfrage nur verschoben. Ohne
Datenbankzugriff geht das direkt gegen die Fixture:

```bash
php -d extension=php_mbstring.dll -r '
require "api/_internal/app/curve-label-store.php";
$r = json_decode(file_get_contents("api/_internal/app/__tests__/fixtures/kurvenlabel-referenz.json"), true);
// 50 Regionen nachstellen, indem die sechs Referenzflaechen reihum wiederholt werden.
$regionen = [];
for ($i = 0; $i < 50; $i++) {
  $f = $r[$i % count($r)];
  $regionen["r$i"] = ["rev" => 1, "settings" => ["enabled" => true, "max_labels" => 1], "geometries" => $f["geometries"]];
}
$t = microtime(true);
$json = avesmapsCurveBuildCachePayload($regionen);
printf("50 Regionen: %.1f s, %d Bytes
", microtime(true) - $t, strlen($json));'
```

Schreib die Sekundenzahl in den Bericht und sag ausdrücklich, ob sie unter 30 s bleibt. Liegt sie
darüber, ist das ein Befund für Plan 4, kein Grund, hier etwas umzubauen.

🔧 **DU (Owner):** Um eine echte Kurve zu sehen, setze an *einer* Region über phpMyAdmin
`ecosystem_region.properties_json` auf `{"curve_label": true, "curve_label_max": 1}`, lass den Lauf
erneut laufen (erwartet `regions: 1`) und prüfe dann die Karte:

```bash
curl -s --compressed "http://localhost:8123/api/app/map-features.php" -o /tmp/mf.json
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/mf.json','utf8'));
const m=d.features.filter(f=>f.properties?.curve_label_line);
console.log('Labels mit Kurve:', m.length);
for(const f of m) console.log('  ', f.properties.text, '| Punkte', f.properties.curve_label_line.length, '| max', f.properties.curve_label_max);
"
```
Erwartet: `Labels mit Kurve: 1`, `Punkte 32`.

Danach die Fläche im Editor minimal verschieben und speichern, ohne den Lauf zu wiederholen: die
Kurve muss **verschwinden** (veraltete Revision), nicht falsch stehen bleiben.

- [ ] **Schritt 8: Das ganze Testfeld laufen lassen**

Die drei Läufe aus den globalen Vorgaben. **Ein einziger roter Test lädt nichts hoch** — und die
Datei, die bricht, gehört meistens jemand anderem.

- [ ] **Schritt 9: Committen und pushen**

```bash
git add api/_internal/app/curve-label-store.php api/_internal/app/__tests__/curve-label-store-test.php api/edit/map/curve-labels-run.php
git diff --staged
git commit -m "feat(kurvenlabel): Sammellauf -- rechnet einmal, liest zurueck, und nur ein Admin darf ihn"
```

Push nach der Prüfbaum-Regel aus den globalen Vorgaben; danach den Remote-SHA prüfen:
```bash
git fetch origin && git log -1 --format='%h %s' origin/master
```

---

## Was dieser Plan NICHT tut

Er macht nichts sichtbar. Nach Aufgabe 7 liefert der Server eine Kurve, und niemand sieht sie. Das
ist Absicht: das Verfahren korrekt nach PHP zu bringen ist das grösste Einzelrisiko des Vorhabens,
und es lässt sich gegen sechs gemessene Zahlen prüfen, ohne dass ein Pixel auf der Karte wackelt.

**Folgepläne, in dieser Reihenfolge:**

* **Plan 2 — Das Zeichnen.** Glyphe für Glyphe auf dem Canvas (§7.3), Leserichtungsprobe (§4.1),
  Passung (§4.4), ruhigstes Stück und Beruhigung (§5.1), Sperrung (§5.2), Kollisionsabbau innerhalb
  der Region (§4.2). Erst hier wird etwas sichtbar.
* **Plan 3 — Die Bedienung.** Die zwei Bedienelemente in Beschriftungs- und Flächendialog, ihre
  Synchronität über die Region (§2), der Umstelllauf (§8.2), das Neuausrichten im Bearbeiten-Modus
  (§7.4).
* **Plan 4 — Die Kachel „Darstellung".** Siebte Kachel im Menüband von „Regionen", Fenster,
  `app_setting`, Admin schreibt / Editor liest (§6). Und der Knopf „Zoombänder" unter „Orte" heisst
  danach ebenfalls „Darstellung".
* **Plan 5 — Belegung und Ausweichweg.** Die kleinen Rechtecke entlang der Grundlinie in den
  vorhandenen `seedRects`-Weg, der Ausweichweg von ein paar Pixeln, und die Messung, ob die Ordnung
  kippt (§7.2).
