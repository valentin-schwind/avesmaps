# Der Längenaufschlag für Querfeldein — Bauplan

> **Für Agenten:** PFLICHT-UNTERFERTIGKEIT: `superpowers:executing-plans` (oder
> `subagent-driven-development`). Schritte tragen Häkchen (`- [ ]`).

**Ziel:** Eine Querfeldein-Etappe wird mit ihrer eigenen Länge langsamer, damit ein
103-Meilen-Gewaltmarsch nicht länger die Straße daneben schlägt.

**Bauart:** Ein reiner Faktor im Blatt `terrain-factor.php`, aufgerufen im gemeinsamen Abschluss
`avesmapsOffroadFinishPath` — der einen Stelle, durch die alle vier Erzeuger laufen. Die zwei
Stellschrauben reisen im vorhandenen `travel_values`-Speicher und stehen im Fenster „Tempowerte".

**Entwurf:** `docs/superpowers/specs/2026-08-15-querfeldein-laengenaufschlag-design.md`

## Durchgehende Regeln

- **Gesetz:** `zeit_final = zeit_gemessen × min(deckel, 1 + steigung × strecke_in_meilen)`.
  Vorgabe: Steigung `0.005` je Meile, Deckel `2.0`. 1 Karteneinheit = 3 Meilen
  (`AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT`).
- **Nur `time`.** `distance` bleibt unangetastet (Entwurf §7).
- 🔴 `offroad-grid.php` verlangt **niemals** `travel-values.php` — das ist der Zirkel über
  `client-graph.php`. Der Zustand wohnt im Blatt `terrain-factor.php`.
- **Kommentare, Doku, Commits: Deutsch** (AGENTS.md §8).
- **Geteilter Baum:** nur eigene Pfade stagen, nie `git add -A` (AGENTS.md §9).
- **Vor jedem Push das ganze Testfeld**, PHP mit `-d extension=php_mbstring.dll
  -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll`, plus `tools/wikidump/test-*.php`.

---

### Aufgabe 1: Der Faktor im Blatt

**Dateien:**
- Ändern: `api/_internal/routing/terrain-factor.php` (ans Ende)
- Test: `api/_internal/routing/__tests__/offroad-ramp-test.php` (neu)

**Schnittstellen:**
- Liefert: `avesmapsOffroadRampFactor(float $distanceMapunits): float`,
  `avesmapsOffroadRampPrime(?float $perMile, ?float $max): void`,
  `avesmapsOffroadRampReset(): void`,
  Konstanten `AVESMAPS_OFFROAD_RAMP_PER_MILE`, `AVESMAPS_OFFROAD_RAMP_MAX`.

- [ ] **Schritt 1: Den Test schreiben**

`api/_internal/routing/__tests__/offroad-ramp-test.php`:

```php
<?php
// api/_internal/routing/__tests__/offroad-ramp-test.php
declare(strict_types=1);

/**
 * Der Laengenaufschlag: je laenger die Querfeldein-Etappe, desto langsamer.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-laengenaufschlag-design.md §2
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-ramp-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../terrain-factor.php';

avesmapsOffroadRampReset();

// ---- A: linear, ohne Freibetrag ----------------------------------------------------------
// 0,5 % je Meile, 1 Einheit = 3 Meilen.
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'eine Einheit sind drei Meilen: ' . avesmapsOffroadRampFactor(1.0));
assert(abs(avesmapsOffroadRampFactor(2.0) - 1.030) < 1e-9,
    'und der Anstieg ist linear: ' . avesmapsOffroadRampFactor(2.0));
// 💣 KEIN FREIBETRAG. Schon die kuerzeste Etappe zahlt -- wenig, aber sie zahlt.
assert(avesmapsOffroadRampFactor(0.1) > 1.0, 'auch eine sehr kurze Etappe zahlt etwas');

// ---- B: die gemeldete Route (Fall ?s=DnbLPQq2) -------------------------------------------
// 34,427 Einheiten = 103,28 Meilen. Der Aufschlag muss sie ueber die Strasse (21,00) heben:
// 14,968 x Faktor > 21,00 verlangt Faktor > 1,4029.
$gemeldet = avesmapsOffroadRampFactor(34.427);
assert($gemeldet > 1.4029,
    'die gemeldete Route verliert gegen die Strasse: Faktor ' . $gemeldet . ', noetig 1,4029');

// ---- C: der Deckel greift, und erst spaet ------------------------------------------------
assert(abs(avesmapsOffroadRampFactor(200.0 / 3.0) - AVESMAPS_OFFROAD_RAMP_MAX) < 1e-9,
    'bei 200 Meilen ist der Deckel genau erreicht');
assert(abs(avesmapsOffroadRampFactor(1000.0) - AVESMAPS_OFFROAD_RAMP_MAX) < 1e-9,
    'und darueber bleibt er stehen: ' . avesmapsOffroadRampFactor(1000.0));

// ---- D: Nulllaenge und Unsinn kosten nichts ----------------------------------------------
assert(avesmapsOffroadRampFactor(0.0) === 1.0, 'keine Strecke, kein Aufschlag');
assert(avesmapsOffroadRampFactor(-5.0) === 1.0, 'eine negative Strecke ebenso');

// ---- E: die eingestellten Werte schlagen die Konstante -----------------------------------
avesmapsOffroadRampPrime(0.01, 3.0);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.03) < 1e-9,
    'die eingestellte Steigung gilt: ' . avesmapsOffroadRampFactor(1.0));
assert(abs(avesmapsOffroadRampFactor(1000.0) - 3.0) < 1e-9, 'und ihr eigener Deckel');

// ---- F: 💣 UNSINN FAELLT AUF DIE KONSTANTE, NIE AUF „KEIN AUFSCHLAG" ----------------------
// Ein Deckel unter 1,0 hiesse „querfeldein wird schneller, je weiter es geht". Ein solcher
// Speicherwert darf den Aufschlag nicht abschalten -- er muss ihn auf die Vorgabe zuruecksetzen.
avesmapsOffroadRampPrime(-1.0, 2.0);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'eine negative Steigung faellt auf die Konstante: ' . avesmapsOffroadRampFactor(1.0));
avesmapsOffroadRampPrime(0.005, 0.5);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'ein Deckel unter 1,0 ebenso: ' . avesmapsOffroadRampFactor(1.0));

avesmapsOffroadRampReset();
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9, 'und der Ruecksetzer holt sie zurueck');

fwrite(STDOUT, "offroad-ramp-test: OK (gemeldete Route x " . round($gemeldet, 4) . ")\n");
```

- [ ] **Schritt 2: Rot vorführen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-ramp-test.php
```
Erwartet: `Call to undefined function avesmapsOffroadRampReset()`.

- [ ] **Schritt 3: Umsetzen**

Ans Ende von `api/_internal/routing/terrain-factor.php`:

```php
/**
 * 💣 DER LAENGENAUFSCHLAG FUER QUERFELDEIN -- er wohnt hier, weil diese Datei ein BLATT ist.
 * `offroad-grid.php` zieht sie bereits; `travel-values.php` zu ziehen waere der Zirkel ueber
 * `client-graph.php`. Der Speicher reicht die eingestellten Werte per Prime herein, genau wie
 * `avesmapsTravelValuesSpeed` sie fuer das Raster hereinreicht.
 *
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-laengenaufschlag-design.md
 */
const AVESMAPS_OFFROAD_RAMP_PER_MILE = 0.005;
const AVESMAPS_OFFROAD_RAMP_MAX = 2.0;

/** Der geltende Aufschlag dieser Anfrage -- `null` heisst „die Konstante". */
function &avesmapsOffroadRampRef(): ?array
{
    static $active = null;

    return $active;
}

/**
 * Die eingestellten Werte setzen.
 *
 * 💣 UNSINN FAELLT AUF DIE KONSTANTE, NIE AUF „KEIN AUFSCHLAG". Eine negative Steigung oder ein
 * Deckel unter 1,0 hiesse „querfeldein wird schneller, je weiter es geht" -- und ein Speicherwert,
 * der eine Sicherung stillschweigend abschaltet, ist genau die Klasse Fehler, die niemand sieht.
 */
function avesmapsOffroadRampPrime(?float $perMile, ?float $max): void
{
    $active = &avesmapsOffroadRampRef();
    if ($perMile === null || $max === null || $perMile < 0.0 || $max < 1.0) {
        $active = null;

        return;
    }
    $active = ['per_mile' => $perMile, 'max' => $max];
}

/** Zurueck auf die Konstante. */
function avesmapsOffroadRampReset(): void
{
    $active = &avesmapsOffroadRampRef();
    $active = null;
}

/**
 * PURE: der Faktor, mit dem die gemessene Reisezeit einer Querfeldein-Etappe multipliziert wird.
 *
 * ⚠️ Der Bezug ist die EINZELNE Etappe, nicht die Summe der Reise. Zwei Querfeldein-Etappen mit
 * einer Ortschaft dazwischen zahlen weniger als eine durchgehende gleicher Laenge -- Absicht:
 * bestraft wird das ununterbrochene weglose Marschieren, und wer einen Ort beruehrt, rastet dort.
 */
function avesmapsOffroadRampFactor(float $distanceMapunits): float
{
    $active = &avesmapsOffroadRampRef();
    $perMile = is_array($active) ? (float) $active['per_mile'] : AVESMAPS_OFFROAD_RAMP_PER_MILE;
    $max = is_array($active) ? (float) $active['max'] : AVESMAPS_OFFROAD_RAMP_MAX;
    if ($distanceMapunits <= 0.0 || $perMile <= 0.0) { return 1.0; }

    return min($max, 1.0 + $perMile * $distanceMapunits * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT);
}
```

- [ ] **Schritt 4: Grün nachweisen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-ramp-test.php
```
Erwartet: `offroad-ramp-test: OK (gemeldete Route x 1.5164)`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/routing/terrain-factor.php api/_internal/routing/__tests__/offroad-ramp-test.php
git commit -m "feat(routing): der Laengenaufschlag fuer Querfeldein -- linear, im Blatt, ohne Zirkel"
```

---

### Aufgabe 2: Der gemeinsame Abschluss trägt ihn

**Dateien:**
- Ändern: `api/_internal/routing/offroad-grid.php` (`avesmapsOffroadFinishPath`, vor dem `return`)
- Test: `api/_internal/routing/__tests__/offroad-ramp-test.php` (Abschnitt G anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsOffroadRampFactor()` aus Aufgabe 1.
- Liefert: jede Etappe aller vier Erzeuger trägt den Aufschlag in `time`.

- [ ] **Schritt 1: Den Test anhängen**

Vor die `fwrite(STDOUT, …)`-Zeile in `offroad-ramp-test.php` — und `require` oben von
`terrain-factor.php` auf `offroad-grid.php` umstellen (die zieht das Blatt selbst, Zeile 19; zwei
`require` nebeneinander wären ein „Cannot redeclare"):

```php
// ---- G: der gemeinsame Abschluss traegt ihn ----------------------------------------------
// 🔴 EINE STELLE FUER ALLE VIER ERZEUGER. Geprueft wird an der billigsten davon, der geraden
// Linie -- sie laeuft durch denselben Abschluss wie die gesuchten.
avesmapsOffroadRampReset();
$box = avesmapsBuildOffroadBox(0.0, 0.0, 60.0, 60.0);
$frei = str_repeat("\x00", $box['cell_count']);
$tempo = 2.30;

$kurz = avesmapsOffroadFinishPath([[0.0, 0.0], [3.0, 0.0]], $tempo, null, null, $box, 0.10, 0);
$lang = avesmapsOffroadFinishPath([[0.0, 0.0], [30.0, 0.0]], $tempo, null, null, $box, 0.10, 0);

// 💣 DIE STRECKE BLEIBT UNANGETASTET. Wer den Aufschlag in die Laenge legte, machte aus
// 103 Meilen 157 und loege auf der Etappenkarte.
assert(abs($kurz['distance'] - 3.0) < 1e-9, 'die kurze Strecke ist unveraendert: ' . $kurz['distance']);
assert(abs($lang['distance'] - 30.0) < 1e-9, 'die lange ebenso: ' . $lang['distance']);

// Die lange Etappe ist JE MEILE langsamer als die kurze -- das ist die ganze Aussage.
$kurzProEinheit = $kurz['time'] / $kurz['distance'];
$langProEinheit = $lang['time'] / $lang['distance'];
assert($langProEinheit > $kurzProEinheit + 1e-9,
    'je laenger, desto langsamer je Meile: ' . $langProEinheit . ' gegen ' . $kurzProEinheit);
assert(abs($lang['time'] - (30.0 / $tempo) * avesmapsOffroadRampFactor(30.0)) < 1e-9,
    'und zwar genau um den Faktor: ' . $lang['time']);

// 🔴 DIE GEGENPROBE: ohne Aufschlag waeren beide gleich schnell je Einheit.
avesmapsOffroadRampPrime(0.0, 1.0);
$ohne = avesmapsOffroadFinishPath([[0.0, 0.0], [30.0, 0.0]], $tempo, null, null, $box, 0.10, 0);
assert(abs($ohne['time'] - 30.0 / $tempo) < 1e-9,
    'bei Steigung 0 bleibt die reine Rechnung stehen: ' . $ohne['time']);
avesmapsOffroadRampReset();
```

- [ ] **Schritt 2: Rot vorführen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-ramp-test.php
```
Erwartet: Abbruch bei „je laenger, desto langsamer je Meile" — beide Werte sind noch `1/2,30`.

- [ ] **Schritt 3: Umsetzen**

In `api/_internal/routing/offroad-grid.php`, in `avesmapsOffroadFinishPath` direkt **vor**
`return [` (nach den beiden Schleifen, wo `$distance` und `$time` fertig sind):

```php
    // 🔴 DER LAENGENAUFSCHLAG, UND ZWAR HIER. Dies ist der gemeinsame Abschluss ALLER
    // Querfeldein-Erzeuger -- die gesuchte Etappe, der Mehrziel-Lauf und die trockene Gerade
    // laufen alle hindurch. Die Falle vom 14.08.2026 („die Sperre muss in jedem Erzeuger einzeln
    // stehen") galt der Pruefung VOR dem Suchlauf; der Preis kommt danach, und deshalb einmal.
    //
    // ⚠️ Die SUCHE hat ohne den Aufschlag geordnet. Das ist richtig so: er haengt allein an der
    // Gesamtlaenge, ordnet zwei Wege gleicher Laenge also nicht um -- und ein Gewicht, das vom
    // bereits zurueckgelegten Weg abhaengt, waere kein Dijkstra mehr.
    $time *= avesmapsOffroadRampFactor($distance);
```

- [ ] **Schritt 4: Grün nachweisen, dann das ganze Routing-Testfeld**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-ramp-test.php
```

Danach alle Routing-Tests — hier kippen die, die Zeiten festnageln:

```bash
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
```

- [ ] **Schritt 5: Jede rote Zahl NEU MESSEN, nicht überschlagen**

💣 Für jeden roten Test: die neue Zahl aus dem Testlauf ablesen, im Test setzen **und im
Kommentar begründen, warum sie sich verschoben hat** (der Aufschlag, mit Länge und Faktor).
Eine Zusicherung, deren Zahl ohne Begründung wandert, ist ab da keine Zusicherung mehr.

⚠️ `abgangspunkt-test.php` ist der **Abnahmefall** des Abgangspunkts. Seine Kernaussage — der
Ausstieg am Knick schlägt die durchgehende Querfeldein-Etappe — muss **weiterhin gelten**, und
zwar mit größerem Abstand als vorher (Entwurf §4). Wandert sie in die andere Richtung: **anhalten
und melden**, nicht die Zusicherung lockern.

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/routing/offroad-grid.php api/_internal/routing/__tests__/
git commit -m "feat(routing): jede Querfeldein-Etappe zahlt fuer ihre eigene Laenge"
```

---

### Aufgabe 3: Die zwei Stellschrauben reisen im Speicher

**Dateien:**
- Ändern: `api/_internal/routing/travel-values.php`
- Test: `api/_internal/routing/__tests__/travel-values-test.php` (anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsOffroadRampPrime()` / `avesmapsOffroadRampReset()` aus Aufgabe 1.
- Liefert: Schlüssel `offroad_ramp` = `['per_mile' => float, 'max' => float]` in
  `avesmapsTravelValuesRead`, `…StorableShape`, `…ApplyIncoming`, `…ResetSection('offroad')`.

- [ ] **Schritt 1: Den Test anhängen**

An `api/_internal/routing/__tests__/travel-values-test.php`:

```php
// ---- Der Laengenaufschlag reist mit ------------------------------------------------------
$werte = avesmapsTravelValuesRead(null);
assert(is_array($werte['offroad_ramp'] ?? null), 'der Rueckfall kennt den Aufschlag');
assert(abs((float) $werte['offroad_ramp']['per_mile'] - AVESMAPS_OFFROAD_RAMP_PER_MILE) < 1e-9,
    'und zwar mit dem Vorgabewert');

// 💣 EINE FORM FUER ZWEI SCHREIBER: was gelesen wird, muss auch abgelegt werden.
assert(array_key_exists('offroad_ramp', avesmapsTravelValuesStorableShape($werte)),
    'die Ablageform traegt ihn -- sonst faellt er beim ersten Speichern still weg');

// Das Fenster schickt Zahlen mit Komma.
$neu = avesmapsTravelValuesApplyIncoming($werte, ['offroad_ramp' => ['per_mile' => '0,01', 'max' => '3']]);
assert(abs((float) $neu['offroad_ramp']['per_mile'] - 0.01) < 1e-9,
    'die Steigung kommt an: ' . json_encode($neu['offroad_ramp']));
assert(abs((float) $neu['offroad_ramp']['max'] - 3.0) < 1e-9, 'der Deckel ebenso');

// 💣 Unsinn wird VERWORFEN, der alte Wert bleibt stehen -- wie bei jedem anderen Abschnitt.
$unsinn = avesmapsTravelValuesApplyIncoming($neu, ['offroad_ramp' => ['per_mile' => '-1', 'max' => '0,5']]);
assert(abs((float) $unsinn['offroad_ramp']['per_mile'] - 0.01) < 1e-9, 'negative Steigung verworfen');
assert(abs((float) $unsinn['offroad_ramp']['max'] - 3.0) < 1e-9, 'Deckel unter 1,0 verworfen');

$zurueck = avesmapsTravelValuesResetSection($neu, 'offroad');
assert(abs((float) $zurueck['offroad_ramp']['per_mile'] - AVESMAPS_OFFROAD_RAMP_PER_MILE) < 1e-9,
    'der Ruecksetzer holt die Vorgabe');

// 🔴 Das Priming reicht ihn an das Blatt weiter -- ohne das steht die Einstellung im Fenster
// und wirkt in keiner einzigen Route.
avesmapsOffroadRampReset();
avesmapsTravelValuesPrimeOffroadRamp(['per_mile' => 0.01, 'max' => 3.0]);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.03) < 1e-9,
    'die eingestellte Steigung wirkt im Gelaende: ' . avesmapsOffroadRampFactor(1.0));
avesmapsTravelValuesResetActive();
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'und der gemeinsame Ruecksetzer nimmt sie mit zurueck');
```

- [ ] **Schritt 2: Rot vorführen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/routing/__tests__/travel-values-test.php
```
Erwartet: Abbruch bei „der Rueckfall kennt den Aufschlag".

- [ ] **Schritt 3: Umsetzen — sechs Stellen in `travel-values.php`**

1. Ganz oben, neben den vorhandenen `require_once`:
```php
require_once __DIR__ . '/terrain-factor.php';
```
⚠️ Ausdrücklich, obwohl `client-graph.php` es heute mitbringt: dieser Leser darf nicht davon
abhängen, in welcher Reihenfolge jemand anders lädt.

2. In `avesmapsTravelValuesRead`, im `$fallback`:
```php
        'offroad_ramp' => ['per_mile' => AVESMAPS_OFFROAD_RAMP_PER_MILE, 'max' => AVESMAPS_OFFROAD_RAMP_MAX],
```
und im `return` des Speicher-Zweigs:
```php
        'offroad_ramp' => avesmapsTravelValuesRampShape($stored['offroad_ramp'] ?? null, $fallback['offroad_ramp']),
```

3. Neue reine Funktion daneben:
```php
/**
 * PURE: der abgelegte Aufschlag, Zelle fuer Zelle gegen die Vorgabe geprueft.
 *
 * 💣 EIN UNGUELTIGER WERT FAELLT AUF DIE VORGABE, NICHT AUF NULL. Eine 0 als Steigung schaltete
 * den Aufschlag ab, und zwar lautlos -- genau die Klasse Fehler, wegen der `travel_values`
 * ueberhaupt zurueckgelesen wird (AGENTS.md §10).
 */
function avesmapsTravelValuesRampShape(mixed $stored, array $fallback): array
{
    if (!is_array($stored)) { return $fallback; }
    $perMile = avesmapsTravelValuesParseNumber($stored['per_mile'] ?? null);
    $max = avesmapsTravelValuesParseNumber($stored['max'] ?? null);

    return [
        'per_mile' => $perMile !== null && $perMile >= 0.0 ? $perMile : $fallback['per_mile'],
        'max' => $max !== null && $max >= 1.0 ? $max : $fallback['max'],
    ];
}
```

4. In `avesmapsTravelValuesStorableShape` als siebten Schlüssel (**und im Docblock „genau sechs
Schlüssel" auf „sieben" ziehen** — die Zahl im Kommentar ist genau die Falle vom 14.08.):
```php
        'offroad_ramp' => $values['offroad_ramp'] ?? [],
```

5. In `avesmapsTravelValuesApplyIncoming`, vor dem `return`:
```php
    // 💣 Zwei Zahlen mit eigenem Sinn: die Steigung darf 0 sein (Aufschlag aus), der Deckel nie
    // unter 1,0 (das hiesse „querfeldein wird schneller, je weiter es geht").
    if (is_array($payload['offroad_ramp'] ?? null)) {
        $ramp = is_array($values['offroad_ramp'] ?? null) ? $values['offroad_ramp'] : [];
        $perMile = avesmapsTravelValuesParseNumber($payload['offroad_ramp']['per_mile'] ?? null);
        if ($perMile !== null && $perMile >= 0.0) { $ramp['per_mile'] = round($perMile, 4); }
        $max = avesmapsTravelValuesParseNumber($payload['offroad_ramp']['max'] ?? null);
        if ($max !== null && $max >= 1.0) { $ramp['max'] = round($max, 3); }
        $values['offroad_ramp'] = $ramp;
    }
```

6. In `avesmapsTravelValuesResetSection`, vor dem `return`:
```php
    if ($section === 'offroad' || $section === 'all') {
        // ⚠️ Nicht aus avesmapsTravelValuesSourceTable(): der Aufschlag hat dort keine Zeile.
        // Er ist unsere Rechnung, wie mean_G und der Pass-Normalisierer (Entwurf §6).
        $values['offroad_ramp'] = [
            'per_mile' => AVESMAPS_OFFROAD_RAMP_PER_MILE, 'max' => AVESMAPS_OFFROAD_RAMP_MAX,
        ];
    }
```

7. Das Priming — in `avesmapsTravelValuesPrime` nach `avesmapsTravelValuesPrimeGrid(…)`:
```php
    avesmapsTravelValuesPrimeOffroadRamp(is_array($values['offroad_ramp'] ?? null) ? $values['offroad_ramp'] : []);
```
neue Funktion daneben:
```php
/** Denselben Weg fuer den Laengenaufschlag -- fuer Tests und fuer den Endpunkt nach dem Schreiben. */
function avesmapsTravelValuesPrimeOffroadRamp(array $ramp): void
{
    avesmapsOffroadRampPrime(
        isset($ramp['per_mile']) ? (float) $ramp['per_mile'] : null,
        isset($ramp['max']) ? (float) $ramp['max'] : null
    );
}
```
und in `avesmapsTravelValuesResetActive` als zweite Zeile:
```php
    avesmapsOffroadRampReset();
```

8. In `avesmapsTravelValuesStoredMatches`, vor dem `return`:
```php
    // 🔴 Die Rueckleseprobe muss den NEUEN Abschnitt bezeugen. Zaehlte sie weiter nur das Raster,
    // ginge eine Kuerzung hinter dem Raster als Erfolg durch -- und `travel_values` ist genau der
    // Schluessel, an dem die stille MySQL-Kuerzung gemessen wurde (AGENTS.md §10).
    if (!is_array($back['offroad_ramp'] ?? null)) { return false; }
```

- [ ] **Schritt 4: Grün nachweisen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/routing/__tests__/travel-values-test.php
```

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/routing/travel-values.php api/_internal/routing/__tests__/travel-values-test.php
git commit -m "feat(routing): der Laengenaufschlag ist einstellbar -- er reist im Tempowerte-Speicher"
```

---

### Aufgabe 4: Der Abschnitt im Fenster „Tempowerte"

🔴 **Sichtbare Oberflächenänderung — eigener Commit, einzeln live** (AGENTS.md §9).

**Dateien:**
- Ändern: `js/pages/wege-editor.js` (Abschnitt zeichnen + einsammeln),
  `js/pages/wege-editor-model.js` (Zahlen einsammeln)
- Test: `js/pages/__tests__/tempowerte-dialog.test.js` (anhängen)

- [ ] **Schritt 1: Die Vorlage lesen, nicht raten**

```bash
grep -n "Boden nach Jahreszeit" -A 40 js/pages/wege-editor.js
grep -n "ground_penalties" -B 6 -A 12 js/pages/wege-editor-model.js
```
Der neue Abschnitt wird Zeile für Zeile nach dem Muster von „Boden nach Jahreszeit" gebaut:
`<div class="wp-tempo__sec"><h3>…</h3>` + Erklärsatz + Tabelle + Rücksetz-Knopf mit
`data-section="offroad"`. **Keine neue CSS-Klasse** — der Abschnitt sieht aus wie seine
Nachbarn (AGENTS.md §12: nächstes vorhandenes Bauteil als Vorlage).

- [ ] **Schritt 2: Den Test anhängen**

In `js/pages/__tests__/tempowerte-dialog.test.js` — er prüft das erzeugte Markup:

```js
// ---- Der Laengenaufschlag steht im Fenster ------------------------------------------------
var html = renderTempoDialog(werteMitAufschlag);
assert(html.indexOf("Querfeldein-Aufschlag") !== -1, "der Abschnitt hat eine Ueberschrift");
assert(html.indexOf('name="offroad_ramp.per_mile"') !== -1, "die Steigung ist einstellbar");
assert(html.indexOf('name="offroad_ramp.max"') !== -1, "der Deckel ebenso");
// 💣 DER DECKEL WIRD MIT-EINGESTELLT, NICHT FESTGENAGELT. Eine Steigung ohne erreichbaren
// Deckel ist eine versteckte Kopplung: wer sie verdoppelt, verschiebt die Grenze, ab der sie
// nicht mehr wirkt, und sieht es nirgends.
assert(html.indexOf('data-section="offroad"') !== -1, "und beide lassen sich zuruecksetzen");
```

- [ ] **Schritt 3: Rot vorführen, umsetzen, grün nachweisen**

```bash
node js/pages/__tests__/tempowerte-dialog.test.js
```

Der Erklärsatz unter der Überschrift nennt die Wirkung in Meilen, nicht in Einheiten:
„Eine Querfeldein-Etappe wird mit ihrer eigenen Länge langsamer. Bei 0,5 % je Meile kostet eine
Etappe von 100 Meilen die Hälfte mehr Zeit; kurze Abkürzungen bleiben praktisch unberührt.
Der Höchstaufschlag begrenzt das nach oben — bei 2,0 ist querfeldein nie langsamer als die
Hälfte des GA-Werts."

- [ ] **Schritt 4: Am lebenden Fenster prüfen (ABLAUF, nicht Maß)**

Edit-Oberfläche → Wege-Editor → Kachel „Tempowerte": Fenster öffnen, den Abschnitt sehen, die
Steigung ändern, **speichern**, Fenster schließen, neu öffnen — der Wert muss stehen (Rücklesen).
Dann „zurücksetzen" drücken und die Vorgabe sehen.

- [ ] **Schritt 5: Committen**

```bash
git add js/pages/wege-editor.js js/pages/wege-editor-model.js js/pages/__tests__/tempowerte-dialog.test.js
git commit -m "ui(tempowerte): der Querfeldein-Aufschlag steht im Fenster -- Steigung und Deckel"
```

---

### Aufgabe 5: Abnahme am lebenden Objekt

- [ ] **Schritt 1: Das GANZE Testfeld** (AGENTS.md §9 — ein roter Test lädt nichts hoch)

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
```
```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
```
```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```
⚠️ Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).

- [ ] **Schritt 2: Push, remote SHA prüfen, 2 Minuten warten**

- [ ] **Schritt 3: Die vier Handgriffe des Entwurfs §8 — je EINE API-Probe, keine Schleife**

1. `?s=DnbLPQq2` — muss über die Straße laufen, mehrere Etappen statt einer.
2. Salmingen → Kartenpunkt (504.530, 501.076) — muss weiterhin **zwei** Etappen liefern.
3. Eine kurze Abkürzung (< 15 Meilen Gelände) — darf sich praktisch nicht verändern.
4. Im Fenster „Tempowerte" die Steigung ändern, speichern, neu laden, eine Route messen.

- [ ] **Schritt 4: AGENTS.md §11 nachziehen** — ein Absatz am Querfeldein-Eintrag: das Gesetz,
die eine Stelle, die zwei Stellschrauben, und warum der Aufschlag in der Zeit steht.

- [ ] **Schritt 5: Dem Owner die Zahlen hinlegen** — vorher/nachher für alle drei Routen, und
ausdrücklich benennen, was der Emulator nicht beantworten konnte.
