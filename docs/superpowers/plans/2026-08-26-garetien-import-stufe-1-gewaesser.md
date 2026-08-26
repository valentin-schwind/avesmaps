# Garetien-Kartenimport, Stufe 1 (Gewässer) — Bauplan

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe
> umzusetzen. Die Schritte tragen Checkboxen (`- [ ]`).

**Ziel:** Die 289 Gewässerobjekte aus garetien.de und koschwiki.de über Staging und die
vorhandene Übernahme-Vorschau nach Avesmaps bringen, jedes mit Quellenverweis auf seinen
Wiki-Artikel.

**Architektur:** Vier Stufen, nur die letzte schreibt — Holen (Rohzeilen ins Staging) →
Rechnen (Transformation, Abgleich, schreibt in keine Nutztabelle) → Ansehen (die
**vorhandene** Vorschau `sync_plan_run`/`sync_plan_item`) → Übernehmen (nur Angehaktes).
Parser und Transformation sind reine Funktionen ohne I/O und werden zuerst gebaut.

**Tech-Stack:** PHP 8 (strict types), PDO/MySQL, Tests mit `assert()` unter
`php -d zend.assertions=1 -d assert.exception=1`. Kein Build, kein Bundler. Frontend nur in
Aufgabe 5 (bestehende Vorschau).

**Entwurf:** `docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md` — der Plan
argumentiert aus dem Entwurf; beide zusammen lesen.

## Globale Vorgaben

Diese Werte gelten für **jede** Aufgabe und stammen wörtlich aus dem Entwurf:

- **Affine Matrix** (Entwurf §2.1), exakt diese Zahlen:
  `x = 3.366672e-4·gx + 6.576893e-7·gy + 547.3559`
  `y = 2.419169e-6·gx − 3.311091e-4·gy + 541.8122`
- 💣 **Nicht warpen.** Thin-Plate-Spline wurde gemessen und ist schlechter (2,30 gegen
  1,24 Meilen). Wer warpt, muss die Messung zuerst widerlegen. (§2.2)
- 💣 **Y wird gespiegelt** — bei ihnen wächst y nach Süden, bei uns nach Norden. (§2.3)
- 💣 **Trennzeichen in Verweislisten: `,` ODER ` / `.** (§1.1)
- 💣 **Verkettungstoleranz ist eine echte Distanz, kein Rundungsraster.** Startwert
  **2000 Einheiten** (3,2 km). (§4)
- 🔴 **Keine zweite Übernahme-Vorschau und kein zweites Quellensystem.** Die vorhandenen
  bekommen je eine weitere Quelle. (§5, AGENTS.md §5)
- 🔴 `feature_sources.origin = 'garetien'` und `sources.source_type = 'garetien'` für alles
  aus diesem Import. (§5.3)
- 🔴 **Lizenzangabe: „Garetien.de, CC BY-NC-SA 3.0"** (Owner 2026-08-26). 💣 Sie hängt am
  `source_type`, **nicht** an jedem Objekt — `sources` hat keine Lizenzspalte und bekommt
  keine. Die Lizenz ist eine Eigenschaft von garetien.de, nicht von jedem einzelnen Bach;
  sie 289-mal ins `label` zu schreiben wäre die Duplizierung, die das Lore-Quellensystem
  eine Migration gekostet hat. (§5.3.1)
- **Einheit:** 1 Wagenhalt-Einheit = 1/1000 Meile; 1 Avesmaps-Karteneinheit = 3 Meilen
  (`AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT`).
- **Sprache:** Kommentare, Commit-Betreffe und Doku auf **Deutsch** (AGENTS.md §8).
- **Commit-Scope:** `garetien:` — ein neues Scope-Wort für genau dieses Vorhaben.
  💣 Nicht `verlauf:` (gehört dem Wiki-Kurs-Sync der Wege) und nicht `import:` (zu
  allgemein, es gibt schon `api/import/location-reports/`).
- 💣 **Vor jedem Push läuft das GANZE Testfeld** mit dem Muster des Workflows, nicht nur
  die eigenen Tests (AGENTS.md §9).

---

### Aufgabe 1: Der Zeilen-Parser

**Dateien:**
- Anlegen: `api/_internal/import/garetien-parser.php`
- Test: `api/_internal/import/__tests__/garetien-parser-test.php`

**Schnittstellen:**
- Verbraucht: nichts (reine Funktionen, kein I/O, keine DB)
- Erzeugt:
  - `avesmapsGaretienParseZeile(string $zeile): ?array` — `null` bei Steuerzeile (`K:`),
    sonst `['typ','namensraum','artikel','anzeige','lodmin','lodmax','extra','geo_art','geo','roh']`;
    `geo_art` ist `'koordinaten'` oder `'verweise'`.
  - `avesmapsGaretienParseVerweise(string $geo): array` — Liste von Namen.
  - `avesmapsGaretienParseKoordinaten(string $geo): array` — Liste von `[float $x, float $y]`.
  - `avesmapsGaretienSeitentext(string $html): string` — HTML → Zeilentext.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Der Zeilen-Parser fuer die Exportseiten von garetien.de / koschwiki.de.
// Format: Typ:[Namensraum:]Artikel!Anzeige;lodmin!lodmax;extra;Geometrie
//
// 💣 Die Kopfvarianten sind KEIN Fehler (Volker, 26.08.2026): fehlt der Artikel, wurde die
// Zeile von Hand in die Vorlage geschrieben; fehlt der Namensraum, liegt der Artikel im
// Hauptnamensraum, weil das Objekt durch mehrere Provinzen laeuft.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-parser-test.php

require_once __DIR__ . '/../garetien-parser.php';

$pruefungen = 0;

// --- Der Normalfall: 209 von 246 Zeilen der Gewaesserseite sehen so aus.
$e = avesmapsGaretienParseZeile('Sumpf:Garetien:Blutmoor!Blutmoor;5!14;;-81541 -34910, -82345 -34947');
assert($e !== null, 'Datenzeile darf nicht null sein');
assert($e['typ'] === 'Sumpf');
assert($e['namensraum'] === 'Garetien');
assert($e['artikel'] === 'Blutmoor');
assert($e['anzeige'] === 'Blutmoor');
assert($e['lodmin'] === '5' && $e['lodmax'] === '14');
assert($e['geo_art'] === 'koordinaten');
$pruefungen += 7;

// --- Steuerzeilen sind Kommentare der Vorlage.
assert(avesmapsGaretienParseZeile('K:BEGIN Vorlage:KarteGewaesser') === null);
$pruefungen++;

// --- Kein Namensraum: der Darpat fliesst durch mehrere Provinzen.
$e = avesmapsGaretienParseZeile('Strom:Darpat!Darpat;1!14;;100 200, 300 400');
assert($e['namensraum'] === '', 'ohne Namensraum bleibt das Feld leer');
assert($e['artikel'] === 'Darpat');
$pruefungen += 2;

// --- Kein Artikel: von Hand in die Vorlage geschrieben.
$e = avesmapsGaretienParseZeile('Bach:Nebenfluss der Natter;6!9;;10 20, 30 40');
assert($e['artikel'] === '', 'ohne Artikel bleibt das Feld leer');
assert($e['anzeige'] === 'Nebenfluss der Natter', 'der Name wandert in die Anzeige');
$pruefungen += 2;

// --- 💣 Verweislisten trennen mit Komma ODER mit Schraegstrich. Mit nur Komma blieben
// 8 Flaechen unaufloesbar (gemessen 26.08.2026).
assert(avesmapsGaretienParseVerweise('A-B, C-D') === ['A-B', 'C-D']);
assert(avesmapsGaretienParseVerweise('A 1 / A 2 / A 3') === ['A 1', 'A 2', 'A 3']);
$pruefungen += 2;

// --- Das extra-Feld traegt nur bei politischen Flaechen etwas.
$e = avesmapsGaretienParseZeile('BaronieflaecheE:Garetien:Baronie Retogau!Baronie Retogau;6!10;pop=16000!level=Baron;Raulsmark-Retogau, Vierok-Retogau');
assert($e['extra'] === 'pop=16000!level=Baron');
assert($e['geo_art'] === 'verweise', 'eine Flaeche verweist, sie hat keine eigenen Koordinaten');
$pruefungen += 2;

// --- Koordinaten kommen als Zahlenpaare.
$p = avesmapsGaretienParseKoordinaten('-81541 -34910, -82345 -34947');
assert(count($p) === 2);
assert(abs($p[0][0] - (-81541.0)) < 0.001 && abs($p[0][1] - (-34910.0)) < 0.001);
$pruefungen += 2;

// --- Der HTML-Filter: div.mw-parser-output, <p>/<br> werden Zeilenumbrueche.
$text = avesmapsGaretienSeitentext(
    '<html><body><div class="mw-parser-output"><p>K:BEGIN</p><p>See:Garetien:Mühlsee!Mühlsee;4!14;;1 2</p></div></body></html>'
);
assert(str_contains($text, 'See:Garetien:Mühlsee'), 'Umlaute muessen erhalten bleiben');
assert(str_contains($text, "\n"), 'Absaetze werden zu Zeilen');
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-parser-test.php
```
Erwartet: Fehler `Failed opening required '.../garetien-parser.php'`

- [ ] **Schritt 3: Die minimale Umsetzung schreiben**

```php
<?php

declare(strict_types=1);

// Liest die Avesmaps-Exportseiten von garetien.de und koschwiki.de.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §1
//
// 🔴 REIN: kein I/O, keine Datenbank, kein Netz. Der Abruf steht in garetien-abruf.php,
// damit dieser Teil ohne Server testbar bleibt.

/** HTML einer Exportseite -> Zeilentext. */
function avesmapsGaretienSeitentext(string $html): string
{
    if (preg_match('~<div class="mw-parser-output">(.*?)(?:<!--\s*NewPP|</div>\s*<noscript)~s', $html, $t) === 1) {
        $html = $t[1];
    }
    $html = preg_replace('~</?(p|br)\s*/?>~i', "\n", $html) ?? $html;
    $html = preg_replace('~<[^>]+>~', '', $html) ?? $html;

    return html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/** Trennt an Komma ODER Schraegstrich -- beide Formen kommen in den Daten vor. */
function avesmapsGaretienParseVerweise(string $geo): array
{
    $teile = preg_split('~\s*/\s*|\s*,\s*~', trim($geo)) ?: [];

    return array_values(array_filter(array_map('trim', $teile), static fn(string $s): bool => $s !== ''));
}

/** "x y, x y, ..." -> [[float, float], ...] */
function avesmapsGaretienParseKoordinaten(string $geo): array
{
    $punkte = [];
    foreach (explode(',', $geo) as $stueck) {
        $zahlen = preg_split('~\s+~', trim($stueck)) ?: [];
        if (count($zahlen) >= 2 && is_numeric($zahlen[0]) && is_numeric($zahlen[1])) {
            $punkte[] = [(float) $zahlen[0], (float) $zahlen[1]];
        }
    }

    return $punkte;
}

/** Eine Zeile der Exportseite. null = Steuerzeile oder unbrauchbar. */
function avesmapsGaretienParseZeile(string $zeile): ?array
{
    $zeile = trim($zeile);
    if ($zeile === '' || str_starts_with($zeile, 'K:')) {
        return null;
    }
    $felder = explode(';', $zeile);
    if (count($felder) < 4) {
        return null;
    }
    $kopf = $felder[0];
    $geo = trim(implode(';', array_slice($felder, 3)));

    // Kopf: Typ:[Namensraum:]Artikel!Anzeige -- der Namensraum fehlt, wenn der Artikel im
    // Hauptnamensraum liegt; Artikel und Anzeige fehlen, wenn es keinen Artikel gibt.
    [$typ, $rest] = array_pad(explode(':', $kopf, 2), 2, '');
    $teile = explode(':', $rest);
    $namensraum = count($teile) > 1 ? array_shift($teile) : '';
    $benennung = implode(':', $teile);
    [$artikel, $anzeige] = array_pad(explode('!', $benennung, 2), 2, null);
    if ($anzeige === null) {
        // Kein "!": es gibt keinen Artikel, der Text IST der Anzeigename.
        $anzeige = $artikel;
        $artikel = '';
    }
    [$lodmin, $lodmax] = array_pad(explode('!', $felder[1], 2), 2, '');

    return [
        'typ' => trim($typ),
        'namensraum' => trim($namensraum),
        'artikel' => trim((string) $artikel),
        'anzeige' => trim((string) $anzeige),
        'lodmin' => trim($lodmin),
        'lodmax' => trim($lodmax),
        'extra' => trim($felder[2]),
        'geo_art' => preg_match('~^\s*-?\d+(\.\d+)?\s+-?\d+~', $geo) === 1 ? 'koordinaten' : 'verweise',
        'geo' => $geo,
        'roh' => $zeile,
    ];
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-parser-test.php
```
Erwartet: `OK: 20 Pruefungen`

- [ ] **Schritt 5: Gegen die ECHTEN Daten prüfen**

💣 Ein grüner Einheitentest beweist nicht, dass der Parser die echte Seite liest. Die
Gegenprobe an gespeicherten Seiten gehört dazu — **eine** Seite als Fixture einchecken
(`api/_internal/import/__tests__/fixtures/ggp-gewaesser.html`, die echte Seite, ~155 KB),
und diese Zusicherung ergänzen:

```php
// --- Gegenprobe an der echten Seite: 246 Datenzeilen, 6 Steuerzeilen, keine defekte.
// Gemessen 26.08.2026. Aendert sich die Zahl, hat Volker Daten ergaenzt -- das ist kein
// Testfehler, sondern die Nachricht, die dieser Test transportieren soll.
$html = file_get_contents(__DIR__ . '/fixtures/ggp-gewaesser.html');
$zeilen = array_filter(array_map('trim', explode("\n", avesmapsGaretienSeitentext($html))));
$daten = [];
$steuer = 0;
foreach ($zeilen as $z) {
    if (str_starts_with($z, 'K:')) { $steuer++; continue; }
    $e = avesmapsGaretienParseZeile($z);
    if ($e !== null) { $daten[] = $e; }
}
assert(count($daten) === 246, 'die Gewaesserseite hatte am 26.08.2026 246 Datenzeilen, jetzt ' . count($daten));
assert($steuer === 6);
$typen = array_count_values(array_column($daten, 'typ'));
assert($typen['Bach'] === 127 && $typen['See'] === 81 && $typen['Fluss'] === 20);
assert($typen['Sumpf'] === 15 && $typen['Strom'] === 2 && $typen['Meer'] === 1);
$pruefungen += 6;
```

- [ ] **Schritt 6: Einchecken**

```bash
git add api/_internal/import/garetien-parser.php api/_internal/import/__tests__/
git commit -m "garetien: der Zeilen-Parser fuer die Exportseiten"
```

---

### Aufgabe 2: Die Koordinatentransformation

**Dateien:**
- Anlegen: `api/_internal/import/garetien-koordinaten.php`
- Test: `api/_internal/import/__tests__/garetien-koordinaten-test.php`

**Schnittstellen:**
- Verbraucht: nichts (rein)
- Erzeugt:
  - `avesmapsGaretienNachAvesmaps(float $gx, float $gy): array` — `[float $x, float $y]`
  - `avesmapsGaretienLinieNachAvesmaps(array $punkte): array` — Liste → Liste
  - Konstanten `AVESMAPS_GARETIEN_MATRIX_*` mit den sechs Werten aus den globalen Vorgaben

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Wagenhalt-Koordinaten -> Avesmaps-Karteneinheiten.
//
// 🔴 AFFIN, NICHT GEWARPT. Thin-Plate-Spline wurde am 26.08.2026 in 5-facher
// Kreuzvalidierung gemessen und ist SCHLECHTER: 2,30 gegen 1,24 Meilen Median. Der Grund
// steht in den Residuen -- sie korrelieren null mit der Position (0,014 / 0,003 / -0,003 /
// -0,001), es gibt also keine systematische Verzerrung, die man geradebiegen koennte. Der
// Rest ist echte Zeichendifferenz zwischen zwei von Hand gemalten Fankarten, und daran passt
// sich ein Spline an, statt sie zu heilen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-koordinaten-test.php

require_once __DIR__ . '/../garetien-koordinaten.php';

$pruefungen = 0;

/** Abstand in MEILEN -- 1 Karteneinheit = 3 Meilen. */
function avesmapsGaretienTestMeilen(array $a, array $b): float
{
    return sqrt((($a[0] - $b[0]) ** 2) + (($a[1] - $b[1]) ** 2)) * 3.0;
}

// --- Wagenhalt ist ihr Nullpunkt und liegt bei uns auf der Karte. Der Fit hat ihn aus
// 148 Punkten unabhaengig wiedergefunden -- das ist der Beleg, dass hier nichts hingebogen ist.
$w = avesmapsGaretienNachAvesmaps(0.0, 0.0);
assert(avesmapsGaretienTestMeilen($w, [547.53864, 541.90588]) < 1.0, 'Nullpunkt muss Wagenhalt treffen');
$pruefungen++;

// --- Fuenf echte Passpunkte (gemessen 26.08.2026, Median ueber alle 148 = 1,24 Meilen).
$passpunkte = [
    ['Ferdok',      -161700.0,   51450.0, 492.96887, 524.68549],
    ['Rommilys',     147700.0,   16800.0, 597.08508, 536.79196],
    ['Zwerch',       124600.0,    -700.0, 589.18518, 542.43750],
    ['Beilunk',      387322.0,   26884.0, 678.01385, 534.87564],
    ['Greifenfurt', -116761.0, -129775.0, 507.52209, 584.85355],
];
foreach ($passpunkte as [$name, $gx, $gy, $ax, $ay]) {
    $ist = avesmapsGaretienNachAvesmaps($gx, $gy);
    $fehler = avesmapsGaretienTestMeilen($ist, [$ax, $ay]);
    assert($fehler < 8.0, "{$name} weicht {$fehler} Meilen ab (erlaubt: 8)");
    $pruefungen++;
}

// --- 💣 Y WIRD GESPIEGELT. Bei ihnen waechst y nach Sueden, bei uns nach Norden.
// Ohne diese Zusicherung faellt eine vorzeichenverkehrte Matrix nicht auf: die Karte
// saehe an der Waagerechten gespiegelt aus, und bei Ost-West-Objekten merkt man es nicht.
$nord = avesmapsGaretienNachAvesmaps(0.0, -100000.0);   // 100 Meilen NOERDLICH von Wagenhalt
$sued = avesmapsGaretienNachAvesmaps(0.0,  100000.0);   // 100 Meilen SUEDLICH
assert($nord[1] > $sued[1], 'noerdlich muss bei uns ein GROESSERES y ergeben');
$pruefungen++;

// --- Der Massstab: 3000 Wagenhalt-Einheiten sind eine Karteneinheit sind 3 Meilen.
$a = avesmapsGaretienNachAvesmaps(0.0, 0.0);
$b = avesmapsGaretienNachAvesmaps(300000.0, 0.0);       // 300 Meilen oestlich
assert(abs(avesmapsGaretienTestMeilen($a, $b) - 300.0) < 6.0, 'Massstab muss auf 2 % stimmen');
$pruefungen++;

// --- Linien werden Punkt fuer Punkt gewandelt, die Reihenfolge bleibt.
$linie = avesmapsGaretienLinieNachAvesmaps([[0.0, 0.0], [300000.0, 0.0]]);
assert(count($linie) === 2);
assert($linie[0] === $a && $linie[1] === $b);
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-koordinaten-test.php
```
Erwartet: Fehler `Failed opening required '.../garetien-koordinaten.php'`

- [ ] **Schritt 3: Die minimale Umsetzung schreiben**

```php
<?php

declare(strict_types=1);

// Wagenhalt-Koordinaten (garetien.de / koschwiki.de) -> Avesmaps-Karteneinheiten.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §2
//
// Volkers System: positives X = Meilen oestlich, positives Y = Meilen SUEDLICH von
// Wagenhalt, Einheit 1/1000 Meile. Unsere Karteneinheit sind 3 Meilen
// (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT), und unser y waechst nach NORDEN.
//
// Die Zahlen stammen aus einer Kleinste-Quadrate-Anpassung ueber 148 namensgleiche Orte
// (219 gefunden, 71 als Falschpaare verworfen -- es gibt zwei "Hueterkloster", zwei
// "Dreiwegen"). Median 1,24 Meilen, p90 3,5 -- out-of-sample in 5-facher Kreuzvalidierung.
//
// 🔴 NICHT WARPEN, siehe Kopf des Tests.

const AVESMAPS_GARETIEN_MATRIX_XX =  3.366672e-4;
const AVESMAPS_GARETIEN_MATRIX_XY =  6.576893e-7;
const AVESMAPS_GARETIEN_MATRIX_X0 =  547.3559;
const AVESMAPS_GARETIEN_MATRIX_YX =  2.419169e-6;
const AVESMAPS_GARETIEN_MATRIX_YY = -3.311091e-4;   // 💣 negativ: Y wird gespiegelt
const AVESMAPS_GARETIEN_MATRIX_Y0 =  541.8122;

/** Ein Punkt. */
function avesmapsGaretienNachAvesmaps(float $gx, float $gy): array
{
    return [
        AVESMAPS_GARETIEN_MATRIX_XX * $gx + AVESMAPS_GARETIEN_MATRIX_XY * $gy + AVESMAPS_GARETIEN_MATRIX_X0,
        AVESMAPS_GARETIEN_MATRIX_YX * $gx + AVESMAPS_GARETIEN_MATRIX_YY * $gy + AVESMAPS_GARETIEN_MATRIX_Y0,
    ];
}

/** Eine Linie oder ein Ring, Reihenfolge bleibt. */
function avesmapsGaretienLinieNachAvesmaps(array $punkte): array
{
    $raus = [];
    foreach ($punkte as [$gx, $gy]) {
        $raus[] = avesmapsGaretienNachAvesmaps((float) $gx, (float) $gy);
    }

    return $raus;
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-koordinaten-test.php
```
Erwartet: `OK: 11 Pruefungen`

- [ ] **Schritt 5: Einchecken**

```bash
git add api/_internal/import/garetien-koordinaten.php api/_internal/import/__tests__/garetien-koordinaten-test.php
git commit -m "garetien: die affine Umrechnung der Wagenhalt-Koordinaten"
```

---

### Aufgabe 3: Abruf und Staging

**Dateien:**
- Anlegen: `api/_internal/import/garetien-abruf.php` (Netz + DDL + Schreiben ins Staging)
- Anlegen: `api/edit/map/garetien-import.php` (Endpunkt, Fähigkeit `admin`)
- Test: `api/_internal/import/__tests__/garetien-staging-test.php` (SQLite-Fixture)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienParseZeile`, `avesmapsGaretienSeitentext` (Aufgabe 1)
- Erzeugt:
  - `AVESMAPS_GARETIEN_EBENEN` — Liste `['wiki' => 'ggp'|'kosch', 'ebene' => string, 'url' => string]`
  - `avesmapsGaretienEnsureTables(PDO $pdo): void`
  - `avesmapsGaretienStageSeite(PDO $pdo, int $runId, string $wiki, string $ebene, string $html): int`
    — Anzahl gestagter Zeilen
  - `avesmapsGaretienStartRun(PDO $pdo): int`

**Tabellen** (inline-DDL wie im Haus üblich, AGENTS.md §5):

```sql
CREATE TABLE IF NOT EXISTS garetien_import_run (
  id INT AUTO_INCREMENT PRIMARY KEY,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  note TEXT NULL
);
CREATE TABLE IF NOT EXISTS garetien_import_row (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL,
  wiki VARCHAR(10) NOT NULL,
  ebene VARCHAR(40) NOT NULL,
  zeile_nr INT NOT NULL,
  typ VARCHAR(40) NOT NULL,
  namensraum VARCHAR(80) NOT NULL DEFAULT '',
  artikel VARCHAR(190) NOT NULL DEFAULT '',
  anzeige VARCHAR(190) NOT NULL DEFAULT '',
  lodmin VARCHAR(5) NOT NULL DEFAULT '',
  lodmax VARCHAR(5) NOT NULL DEFAULT '',
  extra VARCHAR(190) NOT NULL DEFAULT '',
  geo_art VARCHAR(12) NOT NULL,
  geo MEDIUMTEXT NOT NULL,
  roh MEDIUMTEXT NOT NULL,
  KEY (run_id, ebene),
  KEY (run_id, artikel)
);
```

💣 **`geo` und `roh` sind `MEDIUMTEXT`, nicht `VARCHAR`.** Die längste Geometriezeile der
Gewässerseite ist über 3000 Zeichen, die längste Grenzzeile deutlich mehr. Eine stille
MySQL-Kürzung ist von „nichts gespeichert" nicht zu unterscheiden — genau die Falle, die
`app_setting.setting_value` gekostet hat (AGENTS.md §10).

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Das Staging: Rohzeilen unveraendert ablegen, mit Lauf-ID.
//
// ⭐ Roh UND zerlegt nebeneinander -- aendert sich der Parser spaeter, kann man den Lauf neu
// zerlegen, ohne die Quelle erneut abzurufen. Volker sagt selbst, dass sich die Daten
// "mal aendern" koennen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-staging-test.php

require_once __DIR__ . '/../garetien-abruf.php';

$pruefungen = 0;

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
$pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');

$runId = avesmapsGaretienStartRun($pdo);
assert($runId > 0);
$pruefungen++;

$html = '<div class="mw-parser-output">'
      . '<p>K:BEGIN Vorlage:KarteGewaesser</p>'
      . '<p>See:Garetien:Mühlsee!Mühlsee;4!14;;998 -12507, 1180 -12736</p>'
      . '<p>Bach:Nebenfluss der Natter;6!9;;10 20, 30 40</p>'
      . '</div>';
$anzahl = avesmapsGaretienStageSeite($pdo, $runId, 'ggp', 'Gewaesser', $html);
assert($anzahl === 2, 'zwei Datenzeilen, die Steuerzeile zaehlt nicht');
$pruefungen++;

// --- Die Rohzeile liegt UNVERAENDERT da.
$roh = $pdo->query("SELECT roh FROM garetien_import_row WHERE typ='See'")->fetchColumn();
assert($roh === 'See:Garetien:Mühlsee!Mühlsee;4!14;;998 -12507, 1180 -12736');
$pruefungen++;

// --- Zerlegt liegt sie daneben.
$z = $pdo->query("SELECT * FROM garetien_import_row WHERE typ='See'")->fetch(PDO::FETCH_ASSOC);
assert($z['namensraum'] === 'Garetien' && $z['artikel'] === 'Mühlsee');
assert($z['geo_art'] === 'koordinaten');
assert((int) $z['zeile_nr'] === 1, 'die Reihenfolge der Quelle bleibt erhalten');
$pruefungen += 3;

// --- 💣 Ein zweiter Lauf ueberschreibt den ersten NICHT.
$run2 = avesmapsGaretienStartRun($pdo);
avesmapsGaretienStageSeite($pdo, $run2, 'ggp', 'Gewaesser', $html);
$gesamt = (int) $pdo->query('SELECT COUNT(*) FROM garetien_import_row')->fetchColumn();
assert($gesamt === 4, 'beide Laeufe stehen nebeneinander, ' . $gesamt . ' gefunden');
$pruefungen++;

// --- Alle 18 Ebenen sind eingetragen, mit Adresse.
assert(count(AVESMAPS_GARETIEN_EBENEN) === 18, 'Volker hat 18 Seiten angelegt');
$ggp = array_filter(AVESMAPS_GARETIEN_EBENEN, static fn(array $e): bool => $e['wiki'] === 'ggp');
$kos = array_filter(AVESMAPS_GARETIEN_EBENEN, static fn(array $e): bool => $e['wiki'] === 'kosch');
assert(count($ggp) === 12 && count($kos) === 6);
foreach (AVESMAPS_GARETIEN_EBENEN as $e) {
    assert(str_starts_with($e['url'], 'https://'), 'jede Ebene braucht eine vollstaendige Adresse');
}
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-staging-test.php
```
Erwartet: Fehler `Failed opening required '.../garetien-abruf.php'`

- [ ] **Schritt 3: Die Umsetzung schreiben**

`api/_internal/import/garetien-abruf.php` mit:
- der Konstanten `AVESMAPS_GARETIEN_EBENEN` (18 Einträge; GGP-Basis
  `https://www.garetien.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_`, Kosch-Basis
  `https://www.koschwiki.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_`; Ebenen GGP:
  `Gewaesser Berge Grenzen Sonstiges Waelder Wege Ortschaften_1 Ortschaften_2 Ortschaften_3
  Ortschaften_4 Detail_1 Detail_2`, Kosch: `Gewaesser Berge Grenzen Waelder Wege Ortschaften_1`),
- `avesmapsGaretienEnsureTables()` mit dem DDL von oben,
- `avesmapsGaretienStartRun()` (INSERT, gibt `lastInsertId` zurück),
- `avesmapsGaretienStageSeite()` (Seitentext → Zeilen → `avesmapsGaretienParseZeile` →
  INSERT je Zeile, `zeile_nr` ab 1),
- `avesmapsGaretienHoleSeite(string $url): string` — `curl` mit 60 s Zeitlimit, eigener
  User-Agent `Avesmaps-Import/1.0 (+https://avesmaps.de)`, wirft bei HTTP ≠ 200.

⚠️ **Der Abruf ist vom Staging getrennt**, damit der Test ohne Netz läuft.

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Lauf: wie Schritt 2. Erwartet: `OK: 10 Pruefungen`

- [ ] **Schritt 5: Einen echten Lauf gegen die Live-Wikis fahren**

💣 **Höflich und einzeln, nie in einer Schleife ohne Pause** — es ist ein fremder Server,
und wir haben dort um Erlaubnis gefragt. Eine Sekunde Pause zwischen den Seiten.

🔧 **Zu messen und zu berichten:** ob der Abruf **von STRATO aus** funktioniert. Wiki
Aventurica sperrt unsere Ausgangs-IP (`81.169.144.135`, siehe Memory
`wiki-sperrt-stratos-ausgangs-ip`); ob garetien.de das auch tut, ist unbekannt. **Erst eine
einzelne Probe**, nicht alle 18. Schlägt sie fehl, läuft der Abruf lokal per CLI und die
Rohzeilen werden hochgeladen — das ändert Aufgabe 3, nicht den Rest des Plans.

- [ ] **Schritt 6: Einchecken**

```bash
git add api/_internal/import/garetien-abruf.php api/edit/map/garetien-import.php api/_internal/import/__tests__/garetien-staging-test.php
git commit -m "garetien: Abruf der Exportseiten und Staging der Rohzeilen"
```

---

### Aufgabe 4: Der Abgleich gegen unseren Bestand

**Dateien:**
- Anlegen: `api/_internal/import/garetien-abgleich.php`
- Test: `api/_internal/import/__tests__/garetien-abgleich-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienNachAvesmaps` (Aufgabe 2), Staging-Zeilen (Aufgabe 3)
- Erzeugt:
  - `avesmapsGaretienMappeTyp(string $typ): ?array` — `['ziel' => 'path'|'region'|'label'|'location',
    'subtyp' => string, 'kind' => ?string]` oder `null` (= nicht importieren)
  - `avesmapsGaretienFindeBestand(PDO $pdo, array $zeile, array $ziel): array` —
    `['status' => 'neu'|'deckt_sich'|'widerspricht', 'treffer_public_id' => ?string, 'grund' => string]`

🔴 **Die Zuordnungstabelle ist Daten, kein `if`-Baum** (Entwurf §3). Sie steht als
`const AVESMAPS_GARETIEN_TYP_MAP` in **einer** Datei und wird von Abgleich und Übernahme
gemeinsam gelesen.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Der Abgleich: was ist neu, was haben wir schon?
//
// 💣 DIE TRAGENDE ZUSICHERUNG DIESES TESTS: Namensgleichheit beweist nichts, und
// Namensungleichheit auch nicht. Gemessen am 26.08.2026 an den 246 Gewaessern: ein reiner
// Namensvergleich fand 39 Treffer, meldete aber "Grosser Fluss" als NEU -- wir fuehren ihn
// als Flussweg unter "Der Grosse Fluss". Ein Importer, der nach Namen abgleicht, haette ihn
// ein zweites Mal danebengelegt. Und in Volkers eigenem Bestand gibt es "Aehrenfeld" dreimal.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-abgleich-test.php

require_once __DIR__ . '/../garetien-abgleich.php';

$pruefungen = 0;

// --- Die Zuordnung ist Daten und deckt die Gewaesser vollstaendig ab.
assert(avesmapsGaretienMappeTyp('Bach')['ziel'] === 'path');
assert(avesmapsGaretienMappeTyp('Bach')['subtyp'] === 'Flussweg');
assert(avesmapsGaretienMappeTyp('Fluss')['subtyp'] === 'Flussweg');
assert(avesmapsGaretienMappeTyp('Strom')['subtyp'] === 'Flussweg');
assert(avesmapsGaretienMappeTyp('See')['ziel'] === 'region');
assert(avesmapsGaretienMappeTyp('See')['kind'] === 'topographie');
assert(avesmapsGaretienMappeTyp('Sumpf')['subtyp'] === 'suempfe_moore');
$pruefungen += 7;

// --- 🔴 Was kein Gegenstueck hat, wird NICHT geraten, sondern uebersprungen.
assert(avesmapsGaretienMappeTyp('Stadtviertel') === null);
assert(avesmapsGaretienMappeTyp('BurgKlein') === null);
assert(avesmapsGaretienMappeTyp('Kontinent') === null);
$pruefungen += 3;

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT, geometry_json TEXT, properties_json TEXT, is_active INT DEFAULT 1)');
// "Der Grosse Fluss" liegt bei uns rund um (600, 540) -- Volkers "Grosser Fluss" ist derselbe.
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)
            VALUES ('abc-123', 'Der Große Fluss', 'path', 'Flussweg', '{\"type\":\"LineString\",\"coordinates\":[[600.0,540.0],[601.0,541.0]]}', '{}')");

// --- 💣 Der Fall, an dem ein Namensvergleich scheitert: anderer Name, gleiche Stelle.
$zeile = ['typ' => 'Strom', 'artikel' => '', 'anzeige' => 'Großer Fluss',
          'geo_art' => 'koordinaten', 'geo' => '156000 -600, 159000 -3600'];
$e = avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Strom'));
assert($e['status'] === 'deckt_sich', 'gleiche Stelle, anderer Name -> deckt sich, nicht neu');
assert($e['treffer_public_id'] === 'abc-123');
$pruefungen += 2;

// --- Der umgekehrte Fall: gleicher Name, voellig andere Stelle -> NEU, kein Treffer.
$zeile = ['typ' => 'Strom', 'artikel' => '', 'anzeige' => 'Der Große Fluss',
          'geo_art' => 'koordinaten', 'geo' => '-400000 300000, -401000 301000'];
$e = avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Strom'));
assert($e['status'] === 'neu', 'gleicher Name weit weg ist NICHT derselbe Fluss');
$pruefungen++;

// --- Ein echter Neuzugang.
$zeile = ['typ' => 'Bach', 'artikel' => 'Alke', 'anzeige' => 'Alke',
          'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000'];
assert(avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Bach'))['status'] === 'neu');
$pruefungen++;

// --- 🔴 Sammelartikel werden uebersprungen: dort haben wir eigene Daten.
$zeile = ['typ' => 'Fluss', 'namensraum' => 'Nachbarprovinzen', 'artikel' => '', 'anzeige' => 'Llavari',
          'geo_art' => 'koordinaten', 'geo' => '1 2, 3 4'];
assert(avesmapsGaretienUeberspringen($zeile) === true);
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-abgleich-test.php
```
Erwartet: Fehler `Failed opening required '.../garetien-abgleich.php'`

- [ ] **Schritt 3: Die Umsetzung schreiben**

`AVESMAPS_GARETIEN_TYP_MAP` nach Entwurf §3.3 (Stufe 1 = nur Gewässer; die übrigen Zeilen
als Kommentar für die späteren Stufen). `avesmapsGaretienFindeBestand()` in dieser
Reihenfolge:

1. **Artikelname** gegen `map_features.properties_json`/`wiki_url` — eindeutig, weil Wiki-Seitenname
2. **Geometrie** — Mittelpunkt der transformierten Linie gegen Mittelpunkte gleichen Typs,
   Schwelle `AVESMAPS_GARETIEN_TREFFER_EINHEITEN = 2.0` (6 Meilen)
3. **Name** nur als schwaches Zusatzsignal, nie allein

`avesmapsGaretienUeberspringen()`: `true` bei Sammelartikel-Namensräumen
(`Nachbarprovinzen`, `Raschtulswall`), leerem Anzeigenamen oder `avesmapsGaretienMappeTyp() === null`.

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Lauf: wie Schritt 2. Erwartet: `OK: 15 Pruefungen`

- [ ] **Schritt 5: Den echten Bestand messen und berichten**

Den Abgleich über alle 289 gestagten Gewässerzeilen laufen lassen und die Zahlen
festhalten: wie viele `neu` / `deckt_sich` / `widerspricht` / `uebersprungen`.

⚠️ **Die Schwelle aus Schritt 3 ist ein Startwert, kein Ergebnis.** Sie wird an echten
Fällen eingestellt: Stichprobe von 20 `deckt_sich`-Treffern von Hand prüfen, und 20
`neu`-Zeilen daraufhin ansehen, ob wir das Objekt doch führen. Erst danach gilt die Zahl.

- [ ] **Schritt 6: Einchecken**

```bash
git add api/_internal/import/garetien-abgleich.php api/_internal/import/__tests__/garetien-abgleich-test.php
git commit -m "garetien: Abgleich der Staging-Zeilen gegen den Kartenbestand"
```

---

### Aufgabe 5: Anbindung an die Übernahme-Vorschau

**Dateien:**
- Ändern: `api/_internal/wiki/sync-plan.php` (weitere Quelle eintragen)
- Ändern: `js/review/sync-plan-sheet.js` (Beschriftung der neuen Quelle)
- Anlegen: `api/_internal/import/garetien-plan.php`
- Test: `api/_internal/import/__tests__/garetien-plan-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienFindeBestand` (Aufgabe 4)
- Erzeugt: `avesmapsGaretienBaueSyncPlan(PDO $pdo, int $runId): int` — Anzahl `sync_plan_item`

🔴 **Es wird KEINE zweite Vorschau gebaut.** `sync_plan_run`/`sync_plan_item` und
`sync-plan-sheet.js` bekommen eine weitere Quelle — dieselbe Lehre wie beim Quellensystem
(AGENTS.md §5).

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Der Abgleich fuellt die VORHANDENE Uebernahme-Vorschau.
//
// 🔴 DIE ZUSICHERUNG, DIE DAS HAUS SCHUETZT: das Rechnen schreibt in KEINE Nutztabelle.
// Das gilt fuer jeden Sync-Lauf im Haus (sync-plan-purity-test.php) und der Import erbt es.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-plan-test.php

require_once __DIR__ . '/../garetien-plan.php';

$pruefungen = 0;
$pdo = avesmapsGaretienPlanTestPdo();   // Staging + map_features + sync_plan_* als SQLite

$vorher = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$anzahl = avesmapsGaretienBaueSyncPlan($pdo, 1);
$nachher = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();

// --- 🔴 Die Kernzusicherung.
assert($vorher === $nachher, 'das Rechnen darf KEINE Nutztabelle anfassen');
$pruefungen++;

assert($anzahl > 0, 'es muessen Vorschlaege entstehen');
$pruefungen++;

// --- Die Vorschlaege tragen die Kategorie, die die Vorschau kennt.
$kat = $pdo->query('SELECT DISTINCT category FROM sync_plan_item')->fetchAll(PDO::FETCH_COLUMN);
foreach ($kat as $k) {
    assert(in_array($k, ['new', 'changed', 'deleted'], true), "unbekannte Kategorie {$k}");
}
$pruefungen++;

// --- 🔴 Es gibt KEINE Loeschungen: ein Import entfernt nichts von unserer Karte.
assert(!in_array('deleted', $kat, true), 'ein Import darf nichts loeschen');
$pruefungen++;

// --- Vorangehakt ist nur, was eine LUECKE fuellt (Owner-Regel vom 16.08.2026).
$vorgehakt = $pdo->query("SELECT COUNT(*) FROM sync_plan_item WHERE category='new' AND preselected=1")->fetchColumn();
$geaendert = $pdo->query("SELECT COUNT(*) FROM sync_plan_item WHERE category='changed' AND preselected=1")->fetchColumn();
assert((int) $vorgehakt > 0, 'Neuzugaenge sind vorangehakt');
assert((int) $geaendert === 0, 'ein vorhandener Wert wird NICHT ungefragt ueberschrieben');
$pruefungen += 2;

// --- Jeder Vorschlag traegt seine Quelle mit, sonst kann die Uebernahme sie nicht setzen.
$ohne = (int) $pdo->query("SELECT COUNT(*) FROM sync_plan_item WHERE payload_json NOT LIKE '%garetien%'")->fetchColumn();
assert($ohne === 0, 'jeder Vorschlag muss seine Herkunft tragen');
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-plan-test.php
```
Erwartet: Fehler `Failed opening required '.../garetien-plan.php'`

- [ ] **Schritt 3: Die Umsetzung schreiben**

`avesmapsGaretienBaueSyncPlan()` liest die Staging-Zeilen des Laufs, ruft je Zeile
`avesmapsGaretienUeberspringen()` und `avesmapsGaretienFindeBestand()`, und schreibt je
Zeile ein `sync_plan_item` mit `category` `new` (Status `neu`) bzw. `changed` (Status
`widerspricht`); `deckt_sich` erzeugt **keinen** Eintrag. `payload_json` trägt die
transformierte Geometrie, den Zieltyp und die Quelle.

**In `sync-plan-sheet.js`** nur die Beschriftung der neuen Quelle ergänzen — kein neues
Fenster, keine zweite Bauform.

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Lauf: wie Schritt 2. Erwartet: `OK: 7 Pruefungen`

- [ ] **Schritt 5: Im Browser ansehen**

💣 **Abnahme heißt ABLAUF, nicht Maß** (AGENTS.md §9). Konkret ausführen und benennen:
Lauf starten → Vorschau öffnet → Liste zeigt Gewässer mit Namen und Kategorie → ein Häkchen
setzen und wieder wegnehmen → Fenster schließen und erneut öffnen, der Stand steht noch.

- [ ] **Schritt 6: Einchecken**

```bash
git add api/_internal/import/garetien-plan.php api/_internal/import/__tests__/garetien-plan-test.php js/review/sync-plan-sheet.js
git commit -m "garetien: der Abgleich fuellt die vorhandene Uebernahme-Vorschau"
```

---

### Aufgabe 6: Die Übernahme

**Dateien:**
- Anlegen: `api/_internal/import/garetien-uebernahme.php`
- Ändern: `api/edit/map/feature-sources.php` und `api/app/feature-sources.php`
  (`origin`-Whitelist um `garetien` erweitern)
- Test: `api/_internal/import/__tests__/garetien-uebernahme-test.php`

**Schnittstellen:**
- Verbraucht: `sync_plan_item` (Aufgabe 5)
- Erzeugt: `avesmapsGaretienUebernehmen(PDO $pdo, int $runId, array $itemIds): array` —
  `['angelegt' => int, 'quellen' => int, 'fehler' => array]`

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Die Uebernahme -- der EINZIGE Schreibweg dieses Imports.
//
// 🔴 Geschrieben wird NUR, was angehakt ist. Ein nicht genanntes Item bleibt unberuehrt --
// dieselbe Regel wie beim Sammel-Speichern der Weg-Ebene (AGENTS.md §11): "geschrieben wird
// NUR, was jemand angefasst hat".
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-uebernahme-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;
$pdo = avesmapsGaretienUebernahmeTestPdo();   // sync_plan_item mit 3 Vorschlaegen

// --- Nur das eine angehakte Item wird geschrieben.
$e = avesmapsGaretienUebernehmen($pdo, 1, [2]);
assert($e['angelegt'] === 1, 'genau ein Objekt, ' . $e['angelegt'] . ' geschrieben');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === 1);
$pruefungen += 2;

// --- 🔴 Jedes uebernommene Objekt bekommt seine Quelle -- ueber das VORHANDENE System.
assert($e['quellen'] === 1);
$q = $pdo->query('SELECT * FROM feature_sources')->fetch(PDO::FETCH_ASSOC);
assert($q['origin'] === 'garetien', 'eigene Herkunft, damit ein spaeterer Lauf sie wiedererkennt');
$s = $pdo->query('SELECT * FROM sources')->fetch(PDO::FETCH_ASSOC);
assert(str_contains($s['url'], 'garetien.de'), 'die Quelle zeigt auf den Wiki-Artikel');
assert($s['source_type'] === 'garetien', 'daran haengt die Lizenzangabe');
$pruefungen += 4;

// --- 💣 Die Lizenz steht NICHT im Label. Sie ist eine Eigenschaft von garetien.de und
// haengt am source_type -- einmal, nicht einmal je Objekt (Entwurf §5.3.1).
assert(!str_contains($s['label'], 'CC BY'), 'die Lizenz gehoert nicht ins Label jedes Objekts');
assert($s['label'] !== '', 'das Label traegt den Artikelnamen');
$pruefungen += 2;

// --- Die Geometrie liegt in UNSEREN Karteneinheiten, nicht in Wagenhalt-Einheiten.
$geo = json_decode((string) $pdo->query('SELECT geometry_json FROM map_features')->fetchColumn(), true);
foreach ($geo['coordinates'] as [$x, $y]) {
    assert($x >= 0.0 && $x <= 1024.0, "x={$x} liegt ausserhalb der Karte -- nicht transformiert?");
    assert($y >= 0.0 && $y <= 1024.0, "y={$y} liegt ausserhalb der Karte -- nicht transformiert?");
}
$pruefungen++;

// --- 🔴 Zweimal uebernehmen legt NICHT zweimal an.
$e2 = avesmapsGaretienUebernehmen($pdo, 1, [2]);
assert($e2['angelegt'] === 0, 'ein bereits uebernommenes Item wird uebersprungen');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === 1);
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf:
```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-uebernahme-test.php
```
Erwartet: Fehler `Failed opening required '.../garetien-uebernahme.php'`

- [ ] **Schritt 3: Die Umsetzung schreiben**

`avesmapsGaretienUebernehmen()` in **einer** Transaktion je Item:
- `map_features` anlegen (`feature_type`/`feature_subtype` aus der Zuordnung, Geometrie aus
  `payload_json`, `public_id` als UUID)
- Für `region`-Ziele zusätzlich das Label (Punkt) und die `ecosystem_region` (Fläche) —
  💣 **das Label ist das tragende Objekt**, die Fläche hängt über `label_public_id` daran
- Quelle über das vorhandene System: `sources` (dedupliziert über `url_hash`) +
  `feature_sources` mit `origin='garetien'`
- `sync_plan_item.applied_at` setzen, damit ein zweiter Lauf es überspringt

⚠️ **`entity_type` muss in der Whitelist stehen** (`api/edit/map/feature-sources.php`,
`api/app/feature-sources.php`) — für Stufe 1 sind das `path` und `region`.

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Lauf: wie Schritt 2. Erwartet: `OK: 11 Pruefungen`

- [ ] **Schritt 5: Das GANZE Testfeld fahren**

💣 Nicht nur die eigenen Tests — der Deploy ist ein Tor, ein einziger roter Test lädt
nichts hoch (AGENTS.md §9). Beide Workflow-Muster, parallel:

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste
```

⭐ Vorher die Dateizahl gegenprüfen (`... -print0 | tr -dc '\0' | wc -c`) — eine viel zu
kleine Zahl ist der einzige Unterschied zwischen einem grünen Feld und einem, das nichts
gefahren hat.

- [ ] **Schritt 6: Einchecken und live**

```bash
git add api/_internal/import/ api/edit/map/feature-sources.php api/app/feature-sources.php
git commit -m "garetien: Uebernahme der angehakten Gewaesser samt Quellenverweis"
```

💣 **Sichtbare Änderungen gehen EINZELN live, und der Owner sieht jede** (AGENTS.md §9).
Nach dem Push den Lauf abwarten und die Remote-SHA prüfen, bevor der nächste Schritt kommt.

---

## Selbstprüfung

**Entwurfsabdeckung.** §1 Format → Aufgabe 1. §2 Transformation → Aufgabe 2. §3 Mapping →
Aufgabe 4 (Gewässerzeilen; die übrigen Stufen erben die Tabelle). §4 Flächen → **bewusst
nicht in Stufe 1**, gehört zu Stufe 5 (Territorien). §5.1 Staging → Aufgabe 3. §5.2 Abgleich
→ Aufgabe 4. §5.3 Quellen → Aufgabe 6. §6 Fallen → als Zusicherung in dem Test verankert,
zu dem die Falle gehört. §7 Stufen → dieser Plan ist Stufe 1.

**Platzhalter.** Keine „TBD"/„später"; jeder Code-Schritt trägt echten Code. Aufgabe 3
Schritt 3 und Aufgabe 6 Schritt 3 beschreiben statt zu zeigen — das ist Absicht: beide sind
DDL- und Verdrahtungsarbeit gegen bestehende Hausfunktionen, deren Signaturen der Umsetzende
im Repo liest, nicht aus dem Plan.

**Typenkonsistenz.** `avesmapsGaretienParseZeile` liefert überall dieselben Schlüssel;
`avesmapsGaretienMappeTyp` liefert `ziel`/`subtyp`/`kind` und wird in Aufgabe 4, 5 und 6
gleich gelesen; `avesmapsGaretienFindeBestand` liefert `status`/`treffer_public_id`/`grund`
und wird nur in Aufgabe 5 verbraucht.

## Was dieser Plan NICHT tut

- **Keine Territorien** (§7) — eigenes Vorhaben.
- **Keine Routing-Anbindung** importierter Flüsse (§3.3) — wird gemessen und berichtet.
- **Keine Ortschaften** — dort ist die 500er-Frage an Volker offen (§6).
- **Kein Warping** — gemessen und verworfen (§2.2).
