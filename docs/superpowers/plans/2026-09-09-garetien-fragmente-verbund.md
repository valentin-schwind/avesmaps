# Fragment-Verbund im Garetien-Importer — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe umzusetzen.
> Die Schritte tragen Checkboxen (`- [ ]`) zur Nachverfolgung.

**Ziel:** Der Importer erkennt Objekte, die garetien.de in numerierte Stücke zerlegt hat
(„Silker Hain 1–4"), legt sie auf Klick zu **einem** Objekt zusammen und bucht das so, dass sich
jedes Fragment einzeln zurücknehmen lässt.

**Architektur:** Der Verbund ist eine **Einstellung je Item**, kein neuer Datentyp. Der Planbau
erkennt ihn und schreibt zwei Felder nach `after`; der Client legt auf der Stage zusammen; die
Übernahme lässt das erste Item Label + Region anlegen und hängt die übrigen als weitere
`ecosystem_area` an dieselbe Region. `entity_key`, `sync_decision` und die Tabellen bleiben
unberührt.

**Tech-Stack:** PHP 8 (strict types, PDO) · Vanilla JS ohne Build · CSS-Tokens ·
Assert-Tests (`php -d zend.assertions=1`) und `node <test>.js`.

**Spec:** `docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md`
**Mockup:** `docs/garetien-fragmente-mockup.html`

## Globale Randbedingungen

- **Abbau-Vertrag:** Nichts außerhalb von `api/_internal/import/` darf `garetien_import_row` oder
  `garetien_import_run` kennen. Gewacht von `api/_internal/import/__tests__/garetien-abbau-waechter-test.php`.
- **Keine neue Tabelle, kein neuer Endpunkt, kein neuer `change_type`.**
- **`entity_key` bleibt je Garetien-Zeile.** Vier Fragmente = vier Schlüssel = vier
  `sync_decision`-Zeilen.
- **Kommentare, Commit-Nachrichten und Doku auf DEUTSCH** (AGENTS.md §8). `error.code`-Werte
  bleiben englisch.
- **Vor jedem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests (AGENTS.md §9). Muster
  des Workflows, parallel:
  ```
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste
  ```
- **PHP-Tests brauchen die Erweiterungen**, sonst melden 45 Tests falsch rot:
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <test>`
- **Geteilter Arbeitsbaum:** niemals `git add -A`. Nur die eigenen Pfade einzeln stagen.
- **Sichtbare Oberflächenänderungen gehen EINZELN live** (AGENTS.md §9): ein Commit, ein Push, der
  Blick des Owners, dann der nächste. Die Aufgaben 3, 4, 5 und 9 sind sichtbar.

---

## Dateiübersicht

| Datei | Verantwortung |
|---|---|
| `api/_internal/import/garetien-verbund.php` | **neu** — die reine Erkennung und die Übersteuerung. Kein I/O, kein DOM. |
| `api/_internal/import/__tests__/garetien-verbund-test.php` | **neu** — die Erkennung samt ihrer Riegel |
| `api/_internal/import/garetien-plan.php` | ruft die Erkennung, schreibt `verbund_stamm`/`verbund_n` nach `after` |
| `api/_internal/import/garetien-uebernahme.php` | Anführer/Teil beim Anlegen, der Vermerk, die fragmentweise Rücknahme |
| `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` | **neu** — Anlegen, Vermerk, Rücknahme |
| `js/review/review-garetien-importer.js` | Marke, Stage-Verbund, Einstellungen, Blockstruktur |
| `css/components/garetien-importer.css` | `.gi-frag`, `.gi-seg__zahl`, `.gi-block*`, `.btn--verbund` |
| `js/review/__tests__/garetien-verbund-*.test.js` | **neu** — vier Client-Tests |

---

## Aufgabe 1: Die Erkennung

**Dateien:**
- Anlegen: `api/_internal/import/garetien-verbund.php`
- Test: `api/_internal/import/__tests__/garetien-verbund-test.php`

**Schnittstellen:**
- Verbraucht: nichts (rein).
- Liefert: `avesmapsGaretienVerbundStamm(string $name): array{0:string,1:?string,2:string}` —
  `[Stamm, Marke oder null, Art der Marke]`; `avesmapsGaretienVerbuende(array $zeilen): array` —
  Abbildung `Zeilenindex => Stamm` für jede Zeile, die zu einem Verbund gehört.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `api/_internal/import/__tests__/garetien-verbund-test.php`:

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../garetien-verbund.php';

/** Kleine Hilfe: eine Zeile, wie sie aus garetien_import_row kommt. */
function verbundZeile(string $ebene, string $typ, string $anzeige, string $urteil = 'neu'): array
{
    return ['ebene' => $ebene, 'typ' => $typ, 'anzeige' => $anzeige, 'artikel' => '', 'urteil' => $urteil];
}

// --- A. Der Stamm ---
assert(avesmapsGaretienVerbundStamm('Silker Hain 1') === ['Silker Hain', '1', 'zahl']);
assert(avesmapsGaretienVerbundStamm('Reichsforst1') === ['Reichsforst', '1', 'zahl-ohne-trenner']);
assert(avesmapsGaretienVerbundStamm('See in Brendiltal NO') === ['See in Brendiltal', 'NO', 'himmelsrichtung']);
assert(avesmapsGaretienVerbundStamm('Hügel in Erlenstamm, Mitte') === ['Hügel in Erlenstamm', 'Mitte', 'himmelsrichtung']);
assert(avesmapsGaretienVerbundStamm('Alkenstieg') === ['Alkenstieg', null, 'ohne']);

// --- B. Ein Fragment OHNE Marke gehoert dazu, wenn ein Geschwister eine traegt ---
// 20 der 22 Wege-Verbuende sehen so aus; ohne diesen Fall fehlt die Haelfte.
$zeilen = [
    verbundZeile('Wege', 'Pfad', 'Alkenstieg'),
    verbundZeile('Wege', 'Pfad', 'Alkenstieg 2'),
];
$v = avesmapsGaretienVerbuende($zeilen);
assert($v === [0 => 'Alkenstieg', 1 => 'Alkenstieg'], 'das unnumerierte erste Stueck fehlt');

// --- C. Ohne JEDE Marke ist es kein Verbund ---
$zeilen = [verbundZeile('Wege', 'Weg', 'B'), verbundZeile('Wege', 'Weg', 'B')];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'zwei Wege namens "B" sind kein Verbund');

// --- D. Doppelte Marken und Luecken sind normal ---
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Wald am Amboss SO'),
    verbundZeile('Waelder', 'Wald', 'Wald am Amboss SO'),
    verbundZeile('Waelder', 'Wald', 'Wald am Amboss NW'),
];
assert(count(avesmapsGaretienVerbuende($zeilen)) === 3, 'doppelte Marke bricht die Gruppe');
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Waldstein2'),
    verbundZeile('Waelder', 'Wald', 'Waldstein5'),
    verbundZeile('Waelder', 'Wald', 'Waldstein7'),
];
assert(count(avesmapsGaretienVerbuende($zeilen)) === 3, 'die Luecke 3,4,6 bricht die Gruppe');

// --- E. Ebene UND Typ trennen ---
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Silberklamm 1'),
    verbundZeile('Berge', 'Huegel', 'Silberklamm 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'verschiedene Typen sind kein Verbund');

// --- F. Ziel location und label bilden NIE einen Verbund ---
$zeilen = [
    verbundZeile('Ortschaften_1', 'Dorf', 'Lilienhof 1'),
    verbundZeile('Ortschaften_1', 'Dorf', 'Lilienhof 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'zwei Doerfer sind zwei Doerfer');
$zeilen = [
    verbundZeile('Berge', 'Berg', 'Zwillingsgipfel 1'),
    verbundZeile('Berge', 'Berg', 'Zwillingsgipfel 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'ein Berggipfel ist ein Punkt');

// --- G. Uebersprungene Zeilen zaehlen nicht mit ---
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Testwald 1', 'uebersprungen'),
    verbundZeile('Waelder', 'Wald', 'Testwald 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'eine uebersprungene Zeile bildet keinen Verbund');

echo "OK -- garetien-verbund\n";
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-test.php
```
Erwartet: `Failed opening required '.../garetien-verbund.php'`.

- [ ] **Schritt 3: Die Erkennung schreiben**

Datei `api/_internal/import/garetien-verbund.php`:

```php
<?php

declare(strict_types=1);

// Fragmente eines Objekts erkennen -- „Silker Hain 1..4" ist EIN Wald, nicht vier.
// Entwurf: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §3
//
// 🔴 REIN. Kein PDO, kein DOM, kein Modulzustand -- die Erkennung ist eine Textregel ueber
// bereits benannte Zeilen und muss ohne Datenbank pruefbar sein.
// 💣 GERUFEN WIRD SIE HINTER avesmapsGaretienZeilenBenennen. Davor steht in `anzeige` noch
// nicht der Name, den das Fenster zeigt (Sammelartikel-Regel, Fall #118) -- die Gruppe liefe
// am sichtbaren Namen vorbei.

require_once __DIR__ . '/garetien-abgleich.php';

/**
 * Die Marken, die eine Ordnung ausdruecken. Am Bestand vom 08.09.2026 gemessen, alle vier
 * Formen kommen live vor.
 */
const AVESMAPS_GARETIEN_VERBUND_HIMMEL = [
    'N', 'S', 'O', 'W', 'NO', 'NW', 'SO', 'SW',
    'NORD', 'SUED', 'SÜD', 'OST', 'WEST', 'MITTE', 'M',
];
const AVESMAPS_GARETIEN_VERBUND_ROEMISCH = [
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
];

/** Die Zielformen, die NIE einen Verbund bilden -- ein Punkt hat nichts zusammenzulegen. */
const AVESMAPS_GARETIEN_VERBUND_ZIELE_AUS = ['location', 'label'];

/** Ist dieses Zeichen-Stueck eine Ordnungsmarke, und welcher Art? */
function avesmapsGaretienVerbundMarke(string $stueck): ?string
{
    $gross = strtoupper($stueck);
    if (preg_match('/^\d{1,3}$/', $stueck) === 1) {
        return 'zahl';
    }
    if (preg_match('/^\d{1,3}[a-zA-Z]$/', $stueck) === 1) {
        return 'zahl+buchstabe';
    }
    if (in_array($gross, AVESMAPS_GARETIEN_VERBUND_ROEMISCH, true)) {
        return 'roemisch';
    }
    if (in_array($gross, AVESMAPS_GARETIEN_VERBUND_HIMMEL, true)) {
        return 'himmelsrichtung';
    }
    if (preg_match('/^[a-zA-Z]$/', $stueck) === 1) {
        return 'buchstabe';
    }

    return null;
}

/**
 * Zerlegt einen Namen in Stamm und Ordnungsmarke.
 *
 * ⚠️ Der Rueckgabewert ist IMMER dreiteilig; ohne Marke steht `null` und `'ohne'` darin. Ein
 * Aufrufer, der auf `null` als GANZE Antwort prueft, verliert genau die unnumerierten Stuecke,
 * um die es in §3 geht.
 *
 * @return array{0:string,1:?string,2:string}
 */
function avesmapsGaretienVerbundStamm(string $name): array
{
    $n = trim($name);
    if ($n === '') {
        return ['', null, 'leer'];
    }
    // „Reichsforst (2)" -- die Marke in Klammern am Ende.
    if (preg_match('/^(.*?)\s*\(([^()]{1,6})\)$/u', $n, $m) === 1 && trim($m[1]) !== '') {
        $art = avesmapsGaretienVerbundMarke($m[2]);
        if ($art !== null) {
            return [trim($m[1]), $m[2], $art];
        }
    }
    // „Silker Hain 1" · „Hügel in Erlenstamm, Mitte" -- Trenner ist Leerzeichen, _, - oder Komma.
    if (preg_match('/^(.*[^\s_\-,])[\s_\-,]+([^\s_\-,]{1,7})$/u', $n, $m) === 1) {
        $art = avesmapsGaretienVerbundMarke($m[2]);
        if ($art !== null) {
            return [trim($m[1]), $m[2], $art];
        }
    }
    // „Reichsforst1" -- OHNE Trenner. 44 der 115 Fragmentzeilen sehen so aus.
    if (preg_match('/^(.*[^\d\s])(\d{1,3})$/u', $n, $m) === 1 && mb_strlen(trim($m[1])) >= 2) {
        return [trim($m[1]), $m[2], 'zahl-ohne-trenner'];
    }

    return [$n, null, 'ohne'];
}

/**
 * Welche Zeilen gehoeren zu einem Verbund?
 *
 * 💣 EIN FRAGMENT OHNE MARKE GEHOERT DAZU, wenn ein Geschwister eine traegt: 20 der 22
 * Wege-Verbuende sind `Alkenstieg` + `Alkenstieg 2`. Deshalb wird ZUERST nach Stamm gruppiert
 * und ERST DANN gefragt, ob die Gruppe ueberhaupt eine Marke enthaelt.
 * 💣 Doppelte Marken (`SO, SO, NW`) und Luecken (`2, 5, 7`) sind normal -- es wird NICHT
 * gezaehlt, ob 1..n vollstaendig ist.
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen (avesmapsGaretienZeilenBenennen)
 * @return array<int,string> Zeilenindex => Stamm; nur Zeilen, die wirklich zu einem Verbund gehoeren
 */
function avesmapsGaretienVerbuende(array $zeilen): array
{
    $gruppen = [];
    foreach ($zeilen as $i => $zeile) {
        if ((string) ($zeile['urteil'] ?? '') === 'uebersprungen') {
            continue;
        }
        $zuordnung = avesmapsGaretienMappeTyp((string) ($zeile['typ'] ?? ''));
        if ($zuordnung === null) {
            continue;
        }
        // 🔴 Der Zieltyp kommt aus der Zuordnungstabelle, NIE aus der Ebene: ein `Berg` liegt in
        // der Ebene „Berge" und ist trotzdem ein `label` (ein Punkt).
        if (in_array((string) ($zuordnung['ziel'] ?? ''), AVESMAPS_GARETIEN_VERBUND_ZIELE_AUS, true)) {
            continue;
        }
        $name = trim((string) ($zeile['anzeige'] ?? '')) !== ''
            ? (string) $zeile['anzeige']
            : (string) ($zeile['artikel'] ?? '');
        [$stamm, , $art] = avesmapsGaretienVerbundStamm($name);
        if ($stamm === '') {
            continue;
        }
        $schluessel = (string) ($zeile['ebene'] ?? '') . '|' . (string) ($zeile['typ'] ?? '') . '|' . $stamm;
        $gruppen[$schluessel][] = ['i' => $i, 'stamm' => $stamm, 'art' => $art];
    }

    $raus = [];
    foreach ($gruppen as $mitglieder) {
        if (count($mitglieder) < 2) {
            continue;
        }
        $hatMarke = false;
        foreach ($mitglieder as $m) {
            if ($m['art'] !== 'ohne') {
                $hatMarke = true;
                break;
            }
        }
        if (!$hatMarke) {
            continue;
        }
        foreach ($mitglieder as $m) {
            $raus[$m['i']] = $m['stamm'];
        }
    }
    ksort($raus);

    return $raus;
}
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-test.php
```
Erwartet: `OK -- garetien-verbund`

- [ ] **Schritt 5: Mutationsprobe**

Ändere im Code nacheinander und prüfe, dass der Test JEDES Mal rot wird:
1. `if (!$hatMarke) { continue; }` entfernen → Fall C muss brechen.
2. `count($mitglieder) < 2` zu `< 3` → Fall B muss brechen.
3. Den `ZIELE_AUS`-Riegel entfernen → Fall F muss brechen.
4. In `avesmapsGaretienVerbundStamm` den Zweig „ohne Trenner" entfernen → Fall A muss brechen.

Stelle den Code danach wieder her.

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/import/garetien-verbund.php api/_internal/import/__tests__/garetien-verbund-test.php
git commit -F- <<'EOF'
feat(garetien): die Fragment-Erkennung -- "Silker Hain 1..4" ist ein Verbund

Rein, ohne PDO: gruppiert benannte Zeilen nach Ebene + Typ + Stamm und gibt
je Zeile den Stamm zurueck, wenn sie wirklich zu einem Verbund gehoert.

Am Bestand vom 08.09.2026 gemessen (Lauf 20, 8349 Zeilen): 41 Verbuende aus
115 Zeilen, region 22 / path 19 -- 74 Objekte weniger.

Drei Riegel, jeder mit einem eigenen Testfall:
 * Ein Fragment OHNE Marke gehoert dazu, wenn ein Geschwister eine traegt --
   20 der 22 Wege-Verbuende sind "Alkenstieg" + "Alkenstieg 2".
 * Ohne JEDE Marke ist es kein Verbund (zwei Wege namens "B").
 * Ziel location und label nie -- der Zieltyp kommt aus
   AVESMAPS_GARETIEN_TYP_MAP, nicht aus der Ebene: ein `Berg` liegt in der
   Ebene "Berge" und ist trotzdem ein Punkt.

Doppelte Marken (SO, SO, NW) und Luecken (2, 5, 7) sind normal und brechen
die Gruppe nicht.

Entwurf: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 2: Der Planbau schreibt den Verbund mit

**Dateien:**
- Ändern: `api/_internal/import/garetien-plan.php` (`avesmapsGaretienBaueSyncPlan`, `avesmapsGaretienPlanEintrag`)
- Test: `api/_internal/import/__tests__/garetien-verbund-test.php` (erweitern)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienVerbuende()` aus Aufgabe 1.
- Liefert: `after.verbund_stamm` (string) und `after.verbund_n` (int) an jedem Item, dessen Zeile
  zu einem Verbund gehört. Aufgaben 3–7 lesen genau diese zwei Felder.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

An das Ende von `garetien-verbund-test.php`, VOR dem `echo`:

```php
// --- H. Der Planbau reicht Stamm und Anzahl durch ---
require_once __DIR__ . '/../garetien-plan.php';

$zeile = ['wiki' => 'ggp', 'ebene' => 'Waelder', 'zeile_nr' => 118, 'typ' => 'Wald',
          'namensraum' => '', 'artikel' => '', 'anzeige' => 'Silker Hain 1',
          'lodmin' => '4', 'lodmax' => '14', 'extra' => '', 'geo_art' => 'koordinaten',
          'geo' => '12618 32842, 12700 32900, 12800 33000'];
$ziel = ['ziel' => 'region', 'subtyp' => 'wald', 'kind' => 'vegetation'];
$urteil = ['status' => 'neu', 'grund' => '', 'treffer_public_id' => null, 'treffer_name' => null,
           'abschnitte' => [], 'deckung' => null];

$eintrag = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil, null, ['stamm' => 'Silker Hain', 'n' => 4]);
assert(($eintrag['after']['verbund_stamm'] ?? null) === 'Silker Hain');
assert(($eintrag['after']['verbund_n'] ?? null) === 4);

// ⚠️ Ohne Verbund stehen die Felder GAR NICHT da -- nicht als leerer String.
$ohne = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil, null, null);
assert(!array_key_exists('verbund_stamm', $ohne['after']), 'verbund_stamm steht an einem Einzelobjekt');
assert(!array_key_exists('verbund_n', $ohne['after']), 'verbund_n steht an einem Einzelobjekt');
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-test.php
```
Erwartet: `ArgumentCountError` oder ein fehlgeschlagenes `assert` an `verbund_stamm`.

- [ ] **Schritt 3: Den Planbau ändern**

In `api/_internal/import/garetien-plan.php`, am Dateikopf zu den übrigen `require_once`:

```php
require_once __DIR__ . '/garetien-verbund.php';
```

`avesmapsGaretienPlanEintrag` bekommt einen fünften, optionalen Parameter — und die zwei Felder
werden NUR angehängt, wenn es einen Verbund gibt:

```php
/**
 * @param ?array{stamm:string,n:int} $verbund null = dieses Objekt gehoert zu keinem Verbund
 */
function avesmapsGaretienPlanEintrag(
    array $zeile,
    array $ziel,
    array $urteil,
    ?array $innerorts = null,
    ?array $verbund = null
): array {
    // … unveraendert bis zum `return` …
```

Und im `return`, direkt hinter `'subtyp' => $ziel['subtyp'],`:

```php
            // 🔴 NUR WENN ES EINEN VERBUND GIBT. Ein leerer String hier waere eine Aussage
            // („gehoert zu einem Verbund namens ''") und der Client muesste ihn wegfiltern --
            // ein fehlender Schluessel ist die einzige Form, die „nein" bedeutet.
        ] + ($verbund === null ? [] : [
            'verbund_stamm' => (string) $verbund['stamm'],
            'verbund_n' => (int) $verbund['n'],
        ]),
```

⚠️ **Achtung auf die Klammern:** `'after' => [ … ] + ( … )` — die Vereinigung steht INNERHALB des
`after`-Werts, nicht auf der äußeren Ebene. Nach der Änderung muss `php -l` sauber sein.

In `avesmapsGaretienBaueSyncPlan` werden die benannten Zeilen einmal vorab gruppiert, weil die
Erkennung die GANZE Liste braucht:

```php
    $benannt = avesmapsGaretienZeilenBenennen($pdo, $importRunId, $stmt->fetchAll(PDO::FETCH_ASSOC));
    // 🔴 EINMAL je Lauf ueber ALLE Zeilen -- die Gruppe entsteht nur im Ganzen, eine Zeile fuer
    // sich kann nicht wissen, ob sie Geschwister hat.
    $verbuende = avesmapsGaretienVerbuende($benannt);
    $verbundGroesse = array_count_values($verbuende);

    $anzahl = 0;
    $uebersprungen = [];
    foreach ($benannt as $index => $zeile) {
```

und weiter unten, wo `avesmapsGaretienEintraegeFuerUrteil` bzw. `avesmapsGaretienPlanEintrag`
gerufen wird, der fünfte Parameter:

```php
        $verbund = isset($verbuende[$index])
            ? ['stamm' => $verbuende[$index], 'n' => $verbundGroesse[$verbuende[$index]]]
            : null;
```

`avesmapsGaretienEintraegeFuerUrteil` reicht ihn durch — dieselbe Stelle, an der `$innerorts`
schon durchgereicht wird:

```php
function avesmapsGaretienEintraegeFuerUrteil(
    array $zeile,
    array $ziel,
    array $urteil,
    array $quellen,
    ?array $innerorts = null,
    ?array $verbund = null
): array {
    // … und an JEDEM `avesmapsGaretienPlanEintrag(...)`-Aufruf darin der fuenfte Parameter:
    //     avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil, $innerorts, $verbund)
```

💣 **Die Funktion hat MEHRERE Ausgänge** (der vierte Ausgang, der Zufluss, die
Ergänzungseinträge). Jeder `avesmapsGaretienPlanEintrag(...)`-Aufruf darin braucht den
Parameter — ein vergessener liefert stillschweigend ein Item ohne Verbund, und der Editor sieht
drei von vier Fragmenten zusammengelegt. Zähle die Aufrufe vor der Änderung:

```bash
grep -c "avesmapsGaretienPlanEintrag(" api/_internal/import/garetien-plan.php
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-plan-test.php
```
Erwartet: beide OK. **Der zweite ist der wichtige** — er sichert, dass der Planbau unverändert
weiterläuft.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-plan.php api/_internal/import/__tests__/garetien-verbund-test.php
git commit -F- <<'EOF'
feat(garetien): der Planbau schreibt Stamm und Anzahl des Verbunds nach `after`

Die Erkennung laeuft EINMAL je Lauf ueber alle benannten Zeilen -- eine Zeile
fuer sich kann nicht wissen, ob sie Geschwister hat. Sie steht hinter
avesmapsGaretienZeilenBenennen, weil davor der sichtbare Name noch nicht
feststeht (Sammelartikel-Regel, Fall #118).

`verbund_stamm` und `verbund_n` stehen NUR an Objekten, die wirklich zu einem
Verbund gehoeren -- ein leerer String waere eine Aussage, und der Client
muesste ihn wegfiltern.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 3: Die Marke in der Listenzeile

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienZeileMarkup`)
- Ändern: `css/components/garetien-importer.css`
- Test: `js/review/__tests__/garetien-verbund-marke.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `objekt.verbund_stamm`, `objekt.verbund_n` aus der Listenantwort.
- Liefert: `garetienVerbundMarkeMarkup(objekt): string` — `""` ohne Verbund.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-verbund-marke.test.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

// Den reinen Bauer ausschneiden und AUSFUEHREN -- ein Regex ueber den Quelltext kennt keinen
// Geltungsbereich und liesse einen ReferenceError durch (die Lehre vom 03.09.2026).
const anfang = quelle.indexOf("function garetienVerbundMarkeMarkup");
assert.ok(anfang > -1, "garetienVerbundMarkeMarkup fehlt");
const rumpf = quelle.slice(anfang, quelle.indexOf("\n\t}", anfang) + 3);

const kontext = { avesmapsGaretienEscape: (s) => String(s) };
vm.createContext(kontext);
vm.runInContext(rumpf + "\nthis.bau = garetienVerbundMarkeMarkup;", kontext);
const bau = kontext.bau;

// Ohne Verbund: nichts.
assert.strictEqual(bau({ name: "Weidicht" }), "");
assert.strictEqual(bau({ name: "Weidicht", verbund_n: 1 }), "", "n=1 ist kein Verbund");

// Mit Verbund: die Marke, mit der Zahl.
const m = bau({ name: "Silker Hain 1", verbund_stamm: "Silker Hain", verbund_n: 4 });
assert.ok(m.indexOf("gi-frag") > -1, "die Klasse fehlt");
assert.ok(m.indexOf("4 Fragmente") > -1, "die Zahl fehlt");

// 💣 Die Marke steht NEBEN dem Namen, nie darin: .avm-row__name ellipsiert, und ein Zusatz
// darin verschwaende bei jedem laengeren Titel hinter den drei Punkten.
const zeileAnfang = quelle.indexOf("function garetienZeileMarkup");
const zeile = quelle.slice(zeileAnfang, quelle.indexOf("\n\t}", zeileAnfang));
const nameEnde = zeile.indexOf('avm-row__name">');
const markeStelle = zeile.indexOf("garetienVerbundMarkeMarkup");
assert.ok(markeStelle > nameEnde, "die Marke wird vor dem Namen gebaut");
assert.ok(zeile.indexOf('avm-row__name">\' + name + "</span>" + ') === -1,
    "die Marke haengt IM Namen");

console.log("OK -- garetien-verbund-marke");
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-verbund-marke.test.js
```
Erwartet: `AssertionError: garetienVerbundMarkeMarkup fehlt`

- [ ] **Schritt 3: Den Bauer schreiben und einhängen**

In `js/review/review-garetien-importer.js`, direkt VOR `function garetienZeileMarkup`:

```js
	/*
	 * REIN: die Marke „⧉ n Fragmente" -- oder "" ohne Verbund.
	 *
	 * 💣 SIE STEHT NEBEN DEM NAMEN, NIE DARIN. `.avm-row__name` ellipsiert; ein Zusatz im Namen
	 * verschwaende bei jedem laengeren Titel hinter den drei Punkten -- dieselbe Falle, an der
	 * die Marke „12 von 56 Abschnitten" schon einmal unsichtbar war (AGENTS.md §11).
	 * ⚠️ `n < 2` ist kein Verbund. Der Server schickt die Felder zwar nur bei einem echten
	 * Verbund, aber ein alter, zwischengespeicherter Lauf kann alles enthalten.
	 */
	function garetienVerbundMarkeMarkup(objekt) {
		const n = Number((objekt || {}).verbund_n || 0);
		if (!(n >= 2)) { return ""; }
		return '<span class="gi-frag"><span class="gi-frag__zeichen">⧉</span> '
			+ avesmapsGaretienEscape(String(n)) + " Fragmente</span>";
	}
```

In `garetienZeileMarkup`, die `__l1`-Zeile — die Marke kommt NACH dem Namen und VOR dem Typ:

```js
			+ '<span class="avm-row__name">' + name + "</span>"
			+ garetienVerbundMarkeMarkup(o)
			+ '<span class="avm-row__kind">' + avesmapsGaretienEscape(o.typ || "") + "</span>"
```

In `css/components/garetien-importer.css`, zu den übrigen Listenzeilen-Regeln:

```css
/* ---- Die Fragment-Marke (Entwurf 2026-09-09 §3) --------------------------------------------
 * Kein neuer Ton: die Pillenfarben des Hauses, wie jede andere Zaehlmarke.
 * 💣 Sie ist ein Geschwister von `.avm-row__name`, kein Kind -- siehe garetienVerbundMarkeMarkup. */
.gi-frag {
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: var(--space-2);
	padding: 0 var(--space-4);
	border: 1px solid var(--color-pill-border);
	border-radius: var(--radius-md);
	background: var(--color-pill);
	color: var(--color-pill-text);
	font-size: var(--font-size-caption);
	white-space: nowrap;
}

.gi-frag__zeichen { font-weight: var(--font-weight-bold); }
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
node js/review/__tests__/garetien-verbund-marke.test.js
node js/review/__tests__/garetien-liste-zeile.test.js
```
Erwartet: beide OK. Der zweite sichert die unveränderte Zeile.

- [ ] **Schritt 5: Committen und EINZELN live schicken**

```bash
git add js/review/review-garetien-importer.js css/components/garetien-importer.css js/review/__tests__/garetien-verbund-marke.test.js
git commit -F- <<'EOF'
ui(garetien-importer): die Listenzeile zeigt "n Fragmente"

Die Marke steht NEBEN dem Namen, nie darin: .avm-row__name ellipsiert, und ein
Zusatz darin verschwaende bei jedem laengeren Titel hinter den drei Punkten --
dieselbe Falle, an der die Marke "12 von 56 Abschnitten" schon einmal
unsichtbar war.

Kein neuer Farbton: die Pillenfarben des Hauses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

🔧 **DU:** Nach dem Push den Blick auf den Reiter „Offen" — 41 Zeilen sollten die Marke tragen.

---

## Aufgabe 4: Der Verbund auf der Stage

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js`
- Ändern: `css/components/garetien-importer.css`
- Test: `js/review/__tests__/garetien-verbund-stage.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienStageHat(key)`, `zustand.anzeige` (Map key → Objekt).
- Liefert: `garetienVerbundSchluessel(objekt): string` (`"verbund:<ebene>|<typ>|<stamm>"` oder `""`),
  `garetienVerbundMitglieder(schluessel, objekte): array`,
  `garetienVerbundZusammenlegen(schluessel, objekte): number`,
  `garetienVerbundAufloesen(schluessel): boolean`, `garetienVerbundIstZusammen(schluessel): boolean`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-verbund-stage.test.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

function schneide(name) {
    const a = quelle.indexOf("function " + name);
    assert.ok(a > -1, name + " fehlt");
    return quelle.slice(a, quelle.indexOf("\n\t}", a) + 3);
}

const kontext = {};
vm.createContext(kontext);
vm.runInContext(
    schneide("garetienVerbundSchluessel") + "\n"
    + schneide("garetienVerbundMitglieder") + "\n"
    + "this.schluessel = garetienVerbundSchluessel; this.mitglieder = garetienVerbundMitglieder;",
    kontext);

const o1 = { key: "a", name: "Silker Hain 1", ebene: "Waelder", typ: "Wald",
             verbund_stamm: "Silker Hain", verbund_n: 4 };
const o2 = { key: "b", name: "Silker Hain 2", ebene: "Waelder", typ: "Wald",
             verbund_stamm: "Silker Hain", verbund_n: 4 };
const fremd = { key: "c", name: "Weidicht", ebene: "Waelder", typ: "Wald" };

assert.strictEqual(kontext.schluessel(o1), "verbund:Waelder|Wald|Silker Hain");
assert.strictEqual(kontext.schluessel(fremd), "", "ein Einzelobjekt hat keinen Verbundschluessel");

// 💣 Der Schluessel traegt Ebene UND Typ -- ein Wald und ein Huegel gleichen Stammes sind zwei
// Verbuende, und ohne beide fielen sie zu einem zusammen.
const huegel = Object.assign({}, o1, { key: "d", ebene: "Berge", typ: "Huegel" });
assert.notStrictEqual(kontext.schluessel(huegel), kontext.schluessel(o1));

const m = kontext.mitglieder("verbund:Waelder|Wald|Silker Hain", [o1, o2, fremd]);
assert.deepStrictEqual([...m].map((x) => x.key), ["a", "b"]);

console.log("OK -- garetien-verbund-stage");
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-verbund-stage.test.js
```
Erwartet: `AssertionError: garetienVerbundSchluessel fehlt`

- [ ] **Schritt 3: Die zwei reinen Funktionen schreiben**

In `js/review/review-garetien-importer.js`, bei den übrigen Verbund-Helfern:

```js
	/*
	 * REIN: der Schluessel eines Verbunds -- "" fuer ein Einzelobjekt.
	 *
	 * 💣 EBENE UND TYP GEHOEREN HINEIN. Ein Wald und ein Huegel gleichen Stammes sind zwei
	 * Verbuende; mit dem Stamm allein fielen sie zu einem zusammen, und beim Import bekaeme
	 * der Huegel die Region des Waldes.
	 * 🔴 Das Praefix `verbund:` haelt ihn vom Objektschluessel des Servers getrennt -- an dem
	 * haengen `_garetienEingabenZustand` und `sync_decision`, und eine Kollision waere still.
	 */
	function garetienVerbundSchluessel(objekt) {
		const o = objekt || {};
		const stamm = String(o.verbund_stamm || "");
		if (stamm === "" || !(Number(o.verbund_n || 0) >= 2)) { return ""; }
		return "verbund:" + String(o.ebene || "") + "|" + String(o.typ || "") + "|" + stamm;
	}

	/* REIN: alle Objekte, die zu diesem Verbund gehoeren -- in der Reihenfolge der Liste. */
	function garetienVerbundMitglieder(schluessel, objekte) {
		const s = String(schluessel || "");
		if (s === "") { return []; }
		return (objekte || []).filter(function (o) {
			return garetienVerbundSchluessel(o) === s;
		});
	}
```

Die Stage-Handlung — „Verbund auf die Stage" legt ALLE Mitglieder hinein und merkt sich den
Verbund; „Verbund auflösen" nimmt die Merkung zurück, die Objekte bleiben:

```js
	// Welche Verbuende sind ZUSAMMENGELEGT? Ein Set von Verbundschluesseln.
	// 🔴 Der Zustand ist die MENGE, nicht ein Feld am Objekt: die Liste wird nach jedem
	// Schreibvorgang ersetzt (avesmapsGaretienAnzeigeAuffrischen), ein Feld waere still fort --
	// dieselbe Begruendung wie bei `zustand.nurIhre`.
	let _garetienVerbundZusammen = new Set();

	function garetienVerbundVergessen() { _garetienVerbundZusammen = new Set(); }

	function garetienVerbundIstZusammen(schluessel) {
		return _garetienVerbundZusammen.has(String(schluessel || ""));
	}

	function garetienVerbundZusammenlegen(schluessel, objekte) {
		const s = String(schluessel || "");
		if (s === "") { return 0; }
		const mitglieder = garetienVerbundMitglieder(s, objekte);
		mitglieder.forEach(function (o) { zustand.anzeige.set(String(o.key), o); });
		_garetienVerbundZusammen.add(s);
		return mitglieder.length;
	}

	function garetienVerbundAufloesen(schluessel) {
		return _garetienVerbundZusammen.delete(String(schluessel || ""));
	}
```

Rufe `garetienVerbundVergessen()` an derselben Stelle, an der `garetienNameWahlVergessen()`
gerufen wird (beim Wechsel des Laufs).

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
node js/review/__tests__/garetien-verbund-stage.test.js
node js/review/__tests__/garetien-anzeige-menge.test.js
```
Erwartet: beide OK.

- [ ] **Schritt 5: Committen**

```bash
git add js/review/review-garetien-importer.js js/review/__tests__/garetien-verbund-stage.test.js
git commit -F- <<'EOF'
feat(garetien-importer): Verbuende lassen sich auf der Stage zusammenlegen

Der Verbundschluessel traegt Ebene UND Typ: ein Wald und ein Huegel gleichen
Stammes sind zwei Verbuende, und mit dem Stamm allein bekaeme der Huegel beim
Import die Region des Waldes.

Der Zustand ist eine MENGE von Schluesseln, kein Feld am Objekt -- die Liste
wird nach jedem Schreibvorgang ersetzt, ein Feld waere still fort (dieselbe
Begruendung wie bei zustand.nurIhre).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 5: Die Einstellungen gehören dem Verbund

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienEingabenZustandZu`, `garetienZielWahlZu`,
  `garetienNameWahlZu`, `garetienNameWahlSetzen`, `garetienEingabenAendern`)
- Test: `js/review/__tests__/garetien-verbund-einstellungen.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `garetienVerbundSchluessel`, `garetienVerbundIstZusammen` aus Aufgabe 4.
- Liefert: `garetienEinstellungsSchluessel(objekt): string` — der Verbundschlüssel, wenn das Objekt
  zu einem zusammengelegten Verbund gehört, sonst `objekt.key`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-verbund-einstellungen.test.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

// 💣 DIE DREI SPEICHER MUESSEN DENSELBEN SCHLUESSEL LESEN. Vier Fragmente haetten sonst vier
// Saetze Einstellungen, drei davon wuerden beim Import lautlos verworfen, und welcher gewinnt,
// haenge an der Reihenfolge der Items. Von aussen sieht das aus wie "die Einstellung wurde
// ignoriert" -- deshalb wird hier der QUELLTEXT jeder der drei Funktionen geprueft.
["garetienEingabenZustandZu", "garetienZielWahlZu", "garetienNameWahlZu"].forEach(function (name) {
    const a = quelle.indexOf("function " + name);
    assert.ok(a > -1, name + " fehlt");
    const rumpf = quelle.slice(a, quelle.indexOf("\n\t}", a));
    assert.ok(rumpf.indexOf("garetienEinstellungsSchluessel") > -1,
        name + " liest nicht den Einstellungsschluessel");
});

// Und der Setzer ebenso -- sonst schreibt er woanders hin, als gelesen wird.
const setz = quelle.indexOf("function garetienNameWahlSetzen");
assert.ok(quelle.slice(setz, quelle.indexOf("\n\t}", setz)).indexOf("garetienEinstellungsSchluessel") > -1,
    "garetienNameWahlSetzen schreibt unter einem anderen Schluessel als gelesen wird");

console.log("OK -- garetien-verbund-einstellungen");
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-verbund-einstellungen.test.js
```
Erwartet: `AssertionError: garetienEingabenZustandZu liest nicht den Einstellungsschluessel`

- [ ] **Schritt 3: Den einen Schlüssel einziehen**

```js
	/*
	 * Unter WELCHEM Schluessel liegen die Einstellungen dieses Objekts?
	 *
	 * 🔴 EIN ZUSAMMENGELEGTER VERBUND HAT GENAU EINEN SATZ. Es gibt eine Beschriftung und eine
	 * Region, also eine Groesse, ein Zoomband, ein „fuer Klicks gesperrt". Laege jeder Satz am
	 * Fragment, haetten vier Fragmente vier -- drei davon wuerden beim Import verworfen, und
	 * welcher gewinnt, haenge an der Reihenfolge der Items.
	 * ⚠️ NUR wenn der Verbund auch wirklich zusammengelegt IST. Wer die vier Fragmente einzeln
	 * auf die Stage legt, bekommt vier Objekte -- und vier Saetze.
	 */
	function garetienEinstellungsSchluessel(objekt) {
		const verbund = garetienVerbundSchluessel(objekt);
		if (verbund !== "" && garetienVerbundIstZusammen(verbund)) { return verbund; }
		return String((objekt || {}).key || "");
	}
```

Ersetze in `garetienEingabenZustandZu`, `garetienZielWahlZu`, `garetienNameWahlZu` und
`garetienNameWahlSetzen` jeweils `String((objekt || {}).key || "")` durch
`garetienEinstellungsSchluessel(objekt)`.

⚠️ **`garetienEingabeId(objekt, feld)` bleibt am Objektschlüssel** — es baut DOM-`id`s, und die
müssen je gezeichnetem Element eindeutig sein.

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
node js/review/__tests__/garetien-verbund-einstellungen.test.js
node js/review/__tests__/garetien-einfuege-haken.test.js
node js/review/__tests__/garetien-name-aendern.test.js
node js/review/__tests__/garetien-eingefuegt-wird.test.js
```
Erwartet: alle vier OK.

- [ ] **Schritt 5: Committen**

```bash
git add js/review/review-garetien-importer.js js/review/__tests__/garetien-verbund-einstellungen.test.js
git commit -F- <<'EOF'
fix(garetien-importer): ein Verbund hat EINEN Satz Einstellungen

Es gibt eine Beschriftung und eine Region, also eine Groesse, ein Zoomband,
ein "fuer Klicks gesperrt". Lagen die Saetze am Fragment, haetten vier
Fragmente vier -- drei davon waeren beim Import lautlos verworfen worden, und
welcher gewinnt, haenge an der Reihenfolge der Items. Von aussen sieht das aus
wie "die Einstellung wurde ignoriert".

Der Test prueft den Quelltext aller vier Zugriffe: drei Leser und der Setzer.
Ein Setzer, der woanders hinschreibt als gelesen wird, waere derselbe stille
Fehler in neuer Form.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 6: Der Import — Anführer und Teil

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php`
  (`avesmapsGaretienFlaecheAnlegen`, `avesmapsGaretienUebernehmen`)
- Test: `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` (neu)

**Schnittstellen:**
- Verbraucht: `jeItem[<itemId>]['verbund']` (string) aus dem Anfragerumpf.
- Liefert: `avesmapsGaretienVerbundRegion(PDO $pdo, string $verbund, int $runId): ?string` — die
  `region_public_id` des Anführers, oder `null`, wenn dieser Verbund noch keine hat.
- `avesmapsGaretienFlaecheAnlegen` bekommt einen sechsten Parameter
  `?string $anRegionPublicId = null`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php`:

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../garetien-uebernahme.php';

// --- A. Der Vermerk traegt Flaeche, Region und Verbund ---
$note = avesmapsGaretienVerbundVermerk('a30c-4471', '7d42-09e1', 'Silker Hain');
assert(str_contains($note, 'area:a30c-4471'));
assert(str_contains($note, 'region:7d42-09e1'));
assert(str_contains($note, 'verbund:Silker Hain'));

// --- B. Und er laesst sich wieder auseinandernehmen ---
$teile = avesmapsGaretienVermerkLesen($note);
assert($teile['area'] === 'a30c-4471');
assert($teile['region'] === '7d42-09e1');
assert($teile['verbund'] === 'Silker Hain');

// 💣 Der ALTE Vermerk ist eine nackte public_id -- er muss weiter lesbar sein, sonst verliert
// jede Ruecknahme eines vor diesem Umbau importierten Objekts ihr Ziel.
$alt = avesmapsGaretienVermerkLesen('11112222-3333-4444-5555-666677778888');
assert($alt['area'] === '', 'ein alter Vermerk hat keine Flaechen-id');
assert($alt['region'] === '11112222-3333-4444-5555-666677778888', 'der alte Vermerk IST die public_id');
assert($alt['verbund'] === '');

// --- C. Ein leerer Vermerk ist kein Absturz ---
$leer = avesmapsGaretienVermerkLesen('');
assert($leer === ['area' => '', 'region' => '', 'verbund' => '']);

echo "OK -- garetien-verbund-uebernahme\n";
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
```
Erwartet: `Call to undefined function avesmapsGaretienVerbundVermerk()`

- [ ] **Schritt 3: Vermerk, Anführer-Suche und der Anlegepfad**

In `api/_internal/import/garetien-uebernahme.php`:

```php
/**
 * Der Vermerk eines uebernommenen Verbund-Fragments.
 *
 * 🔴 ER IST DIE WAHRHEIT, NICHT DIE NAMENSREGEL. Wuerde der Reiter „Uebernommen" die Verbuende
 * beim Anzeigen neu ausrechnen, zeigte er nach jeder Aenderung der Erkennungsregel eine andere
 * Gruppierung als die, die tatsaechlich geschrieben wurde.
 */
function avesmapsGaretienVerbundVermerk(string $areaPublicId, string $regionPublicId, string $verbund): string
{
    return 'area:' . $areaPublicId . ' | region:' . $regionPublicId . ' | verbund:' . $verbund;
}

/**
 * Die Umkehrung.
 *
 * 💣 EIN ALTER VERMERK IST EINE NACKTE public_id. Jedes vor diesem Umbau importierte Objekt
 * traegt sie so, und die Ruecknahme liest genau dieses Feld -- ohne den Rueckfall verloere sie
 * ihr Ziel und boete eine Loeschung an, die nur noch scheitern kann.
 *
 * @return array{area:string,region:string,verbund:string}
 */
function avesmapsGaretienVermerkLesen(string $note): array
{
    $raus = ['area' => '', 'region' => '', 'verbund' => ''];
    $n = trim($note);
    if ($n === '') {
        return $raus;
    }
    if (!str_contains($n, ':')) {
        $raus['region'] = $n;   // der alte Vermerk
        return $raus;
    }
    foreach (explode('|', $n) as $stueck) {
        $stueck = trim($stueck);
        $pos = strpos($stueck, ':');
        if ($pos === false) {
            continue;
        }
        $feld = substr($stueck, 0, $pos);
        if (array_key_exists($feld, $raus)) {
            $raus[$feld] = trim(substr($stueck, $pos + 1));
        }
    }

    return $raus;
}

/**
 * Hat dieser Verbund in diesem Lauf schon eine Region? Dann ist ihr Anfuehrer schon durch.
 *
 * ⚠️ Gefragt wird `sync_plan_item`, nicht ein zweiter Merker: die Uebernahme laeuft gestueckelt
 * (`$budget`), und ein Nachzuegler im naechsten Haeppchen muss den Anfuehrer wiederfinden.
 */
function avesmapsGaretienVerbundRegion(PDO $pdo, string $verbund, int $runId): ?string
{
    $stmt = $pdo->prepare(
        "SELECT apply_note FROM sync_plan_item
          WHERE run_id = :r AND apply_state = 'done' AND apply_note LIKE :muster
          ORDER BY id ASC LIMIT 1"
    );
    $stmt->execute([':r' => $runId, ':muster' => '%verbund:' . $verbund]);
    $note = (string) ($stmt->fetchColumn() ?: '');
    if ($note === '') {
        return null;
    }
    $region = avesmapsGaretienVermerkLesen($note)['region'];

    return $region === '' ? null : $region;
}
```

`avesmapsGaretienFlaecheAnlegen` bekommt den sechsten Parameter. Am Anfang der Funktion, VOR dem
Anlegen des Labels:

```php
function avesmapsGaretienFlaecheAnlegen(
    PDO $pdo,
    array $nach,
    array $user,
    int $userId,
    ?array $einstellungen = null,
    ?string $anRegionPublicId = null
): array {
    $ring = $nach['geometry']['coordinates'][0] ?? [];

    // 🔴 EIN TEIL EINES VERBUNDS LEGT NUR SEINE FLAECHE AN. Label und Region gehoeren dem
    // Anfuehrer; ein zweites Label waere ein zweiter Anker derselben Kaskade, und die Karte
    // zeigte den Namen doppelt.
    if ($anRegionPublicId !== null && $anRegionPublicId !== '') {
        $flaeche = avesmapsCreateEcosystemArea($pdo, [
            'region_public_id' => $anRegionPublicId,
            'geometry' => $nach['geometry'],
        ], $userId);

        return [
            'public_id' => $anRegionPublicId,
            'entity_type' => 'region',
            'label_public_id' => '',
            'area_public_id' => avesmapsGaretienPublicIdAus($flaeche, 'Die Flaeche des Verbunds'),
        ];
    }

    [$lx, $ly] = avesmapsGaretienRingMittelpunkt($ring);
    // … der bestehende Pfad unveraendert …
```

Am Ende des bestehenden Pfads muss die angelegte Fläche mitgegeben werden:

```php
    $flaeche = avesmapsCreateEcosystemArea($pdo, [
        'region_public_id' => $regionId,
        'geometry' => $nach['geometry'],
    ], $userId);

    return [
        'public_id' => $regionId,
        'entity_type' => 'region',
        'label_public_id' => $labelId,
        'area_public_id' => avesmapsGaretienPublicIdAus($flaeche, 'Die Flaeche'),
    ];
```

⚠️ **`area_public_id` kommt NEU dazu** — bisher gab die Funktion nur `public_id`,
`entity_type` und `label_public_id` zurück. Jeder bestehende Leser liest weiter, was er las;
`garetien-uebernahme-test.php` sichert das.

In `avesmapsGaretienUebernehmen`, im `'region'`-Zweig, VOR dem Aufruf:

```php
                $verbund = trim((string) ($rumpfDesItems['verbund'] ?? ''));
                $anRegion = $verbund === ''
                    ? null
                    : avesmapsGaretienVerbundRegion($pdo, $verbund, $runId);
                $antwort = avesmapsGaretienFlaecheAnlegen($pdo, $nach, $user, $userId, $rumpfDesItems, $anRegion);
```

und beim Abschließen des Items der neue Vermerk:

```php
                avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'done',
                    avesmapsGaretienVerbundVermerk(
                        (string) ($antwort['area_public_id'] ?? ''),
                        (string) $antwort['public_id'],
                        $verbund
                    ), $userId);
```

Reiche `verbund` im Client mit: in `garetienEingabenFuerServer` hinter dem Namen:

```js
		const verbund = garetienVerbundSchluessel(objekt);
		if (verbund !== "" && garetienVerbundIstZusammen(verbund)) {
			// Der Server braucht den STAMM, nicht den Client-Schluessel: er gruppiert ueber
			// `apply_note LIKE '%verbund:<stamm>'`, und Ebene und Typ stehen dort nicht.
			return Object.assign({}, rumpf || {}, { verbund: String(objekt.verbund_stamm || "") });
		}
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-uebernahme-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-einstellungen-je-item-test.php
```
Erwartet: alle drei OK.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-uebernahme.php js/review/review-garetien-importer.js api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
git commit -F- <<'EOF'
feat(garetien): ein Verbund wird EIN Objekt mit N Flaechen

Das erste Item legt Label + Region + Flaeche an, die folgenden nur noch ihre
Flaeche an derselben Region. Ein zweites Label waere ein zweiter Anker
derselben Kaskade, und die Karte zeigte den Namen doppelt.

Der Anfuehrer wird ueber `sync_plan_item.apply_note` wiedergefunden, nicht
ueber einen zweiten Merker: die Uebernahme laeuft gestueckelt, und ein
Nachzuegler im naechsten Haeppchen muss ihn finden.

💣 Der ALTE Vermerk ist eine nackte public_id und bleibt lesbar -- ohne den
Rueckfall verloere die Ruecknahme jedes vor diesem Umbau importierten Objekts
ihr Ziel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 7: Die fragmentweise Rücknahme

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php` (`avesmapsGaretienRuecknahmeAusfuehren`)
- Test: `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` (erweitern)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienVermerkLesen()` aus Aufgabe 6.
- Verbraucht: `avesmapsDeleteEcosystemArea(PDO $pdo, array $payload, int $userId): array` aus
  `api/_internal/app/ecosystem.php` — löscht **eine** Fläche und nimmt Region samt Beschriftungen
  mit, wenn es die letzte war.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

```php
// --- D. Die Ruecknahme waehlt den Loeschweg nach dem Vermerk ---
// 💣 DER HEUTIGE WEG WUERDE BEI EINEM VERBUND ALLES MITREISSEN:
// avesmapsDeleteEcosystemRegion nimmt Beschriftung + Region + ALLE Flaechen mit. Vier
// Fragmente in einer Region: die Ruecknahme EINES loeschte alle vier -- mit gueltiger
// Antwort und ohne Fehlermeldung.
assert(avesmapsGaretienRuecknahmeWeg(avesmapsGaretienVerbundVermerk('a1', 'r1', 'Silker Hain'))
    === ['flaeche', 'a1'], 'ein Verbund-Fragment muss ueber die FLAECHE zurueckgenommen werden');
assert(avesmapsGaretienRuecknahmeWeg(avesmapsGaretienVerbundVermerk('a1', 'r1', ''))
    === ['region', 'r1'], 'ohne Verbund bleibt der Regionsweg');
assert(avesmapsGaretienRuecknahmeWeg('11112222-3333-4444-5555-666677778888')
    === ['region', '11112222-3333-4444-5555-666677778888'], 'der alte Vermerk bleibt der Regionsweg');
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
```
Erwartet: `Call to undefined function avesmapsGaretienRuecknahmeWeg()`

- [ ] **Schritt 3: Die Weiche schreiben und einhängen**

```php
/**
 * Welchen Loeschweg nimmt die Ruecknahme dieses Items?
 *
 * 🔴 EIN VERBUND-FRAGMENT GEHT UEBER SEINE FLAECHE. avesmapsDeleteEcosystemArea traegt die
 * Kaskade schon in sich: „Was that the region's last area? Then the region and its labels go
 * with it." Damit gibt es KEINEN Anfuehrer-Sonderfall -- das letzte Fragment nimmt Region und
 * Beschriftung von selbst mit, egal welches es ist.
 * ⚠️ Ohne Verbund bleibt alles wie bisher.
 *
 * @return array{0:string,1:string} ['flaeche'|'region', public_id]
 */
function avesmapsGaretienRuecknahmeWeg(string $applyNote): array
{
    $teile = avesmapsGaretienVermerkLesen($applyNote);
    if ($teile['verbund'] !== '' && $teile['area'] !== '') {
        return ['flaeche', $teile['area']];
    }

    return ['region', $teile['region']];
}
```

In `avesmapsGaretienRuecknahmeAusfuehren`, im `'new'`-Zweig, ersetze den `elseif ($ziel === 'region')`-Block:

```php
            } elseif ($ziel === 'region') {
                [$weg, $zielId] = avesmapsGaretienRuecknahmeWeg((string) ($item['apply_note'] ?? ''));
                if ($zielId === '') {
                    throw new RuntimeException('kein Loeschziel im Vermerk');
                }
                if ($weg === 'flaeche') {
                    // Nur DIESE Flaeche. Die Kaskade in avesmapsDeleteEcosystemArea nimmt Region
                    // und Beschriftung mit, wenn es die letzte war.
                    avesmapsDeleteEcosystemArea($pdo, ['public_id' => $zielId], (int) ($user['id'] ?? 0));
                } else {
                    avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $zielId], (int) ($user['id'] ?? 0));
                }
```

⚠️ **`$publicId` weiter oben in der Funktion bleibt unangetastet** — sie trägt weiterhin den
Rückfall auf die alte Zeile über `kind + entity_key + change_type`. Die Weiche liest nur den
Vermerk, den jene Suche liefert.

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-uebernahme-test.php
```
Erwartet: beide OK.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-uebernahme.php api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
git commit -F- <<'EOF'
fix(garetien): ein Verbund-Fragment wird ueber seine FLAECHE zurueckgenommen

Der bisherige Weg haette bei einem Verbund alles mitgerissen:
avesmapsDeleteEcosystemRegion nimmt Beschriftung + Region + ALLE Flaechen in
einer Transaktion mit. Vier Fragmente in einer Region -- die Ruecknahme EINES
loeschte alle vier, mit gueltiger Antwort und ohne Fehlermeldung.

⭐ avesmapsDeleteEcosystemArea traegt die Kaskade schon in sich ("Was that the
region's last area? Then the region and its labels go with it"). Damit gibt es
KEINEN Anfuehrer-Sonderfall: das letzte Fragment nimmt Region und Beschriftung
von selbst mit, egal welches es ist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 8: Der Verbund in der Einzelansicht

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienDetailMarkup`, `garetienHandlungen`)
- Ändern: `css/components/garetien-importer.css`
- Test: `js/review/__tests__/garetien-verbund-detail.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `garetienVerbundMitglieder`, `garetienVerbundIstZusammen` aus Aufgabe 4.
- Liefert: `garetienVerbundBlockMarkup(objekt, objekte): string`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-verbund-detail.test.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

function schneide(name) {
    const a = quelle.indexOf("function " + name);
    assert.ok(a > -1, name + " fehlt");
    return quelle.slice(a, quelle.indexOf("\n\t}", a) + 3);
}

const kontext = { avesmapsGaretienEscape: (s) => String(s), _garetienVerbundZusammen: new Set() };
vm.createContext(kontext);
vm.runInContext(
    schneide("garetienVerbundSchluessel") + "\n"
    + schneide("garetienVerbundMitglieder") + "\n"
    + schneide("garetienVerbundIstZusammen") + "\n"
    + schneide("garetienVerbundBlockMarkup") + "\n"
    + "this.block = garetienVerbundBlockMarkup;", kontext);

const objekte = [1, 2, 3, 4].map((i) => ({
    key: "k" + i, name: "Silker Hain " + i, ebene: "Waelder", typ: "Wald",
    verbund_stamm: "Silker Hain", verbund_n: 4, geometrie: new Array(10 + i).fill([0, 0]),
}));

// Ohne Verbund: kein Block.
assert.strictEqual(kontext.block({ key: "x", name: "Weidicht" }, []), "");

// Mit Verbund: vier Zeilen, jede mit einem ✕.
const m = kontext.block(objekte[0], objekte);
assert.ok(m.indexOf("Silker Hain 1") > -1);
assert.ok(m.indexOf("Silker Hain 4") > -1);
assert.strictEqual((m.match(/gi-seg__weg/g) || []).length, 4, "es fehlt ein ✕");

// 💣 Die Punktzahl steht IM Namen, nicht in einer eigenen Rasterzelle -- sonst braucht die Zeile
// mit Knopf eine zweite Rasterreihe und wird doppelt so hoch (gemessen 46 statt 28 px).
assert.ok(m.indexOf("gi-seg__zahl") > -1, "die Punktzahl steht in einer eigenen Zelle");
assert.strictEqual((m.match(/gi-seg__gap/g) || []).length, 0,
    "eine vierte Rasterzelle bricht die Zeile um");

console.log("OK -- garetien-verbund-detail");
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-verbund-detail.test.js
```
Erwartet: `AssertionError: garetienVerbundBlockMarkup fehlt`

- [ ] **Schritt 3: Den Block schreiben und einhängen**

```js
	/*
	 * REIN: der Block „Verbund" -- die Fragmente mit je einem ✕. "" ohne Verbund.
	 *
	 * 💣 DIE PUNKTZAHL STEHT IM NAMEN. `.gi-seg` ist ein Raster aus DREI Spalten
	 * (16px | 1fr | max-content); eine vierte Zelle schiebt den Knopf in eine zweite Reihe und
	 * macht die Zeile doppelt so hoch -- gemessen 46 statt 28 px.
	 */
	function garetienVerbundBlockMarkup(objekt, objekte) {
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return ""; }
		const mitglieder = garetienVerbundMitglieder(schluessel, objekte || []);
		if (mitglieder.length < 2) { return ""; }
		const zeilen = mitglieder.map(function (m) {
			return '<div class="gi-seg"><span></span>'
				+ '<span class="gi-seg__name">' + avesmapsGaretienEscape(m.name || "")
				+ '<span class="gi-seg__zahl">' + ((m.geometrie || []).length) + " Punkte</span></span>"
				+ '<button class="btn gi-seg__weg" type="button" data-verbund-weg="'
				+ avesmapsGaretienEscape(m.key || "") + '" title="Aus dem Verbund nehmen">✕</button>'
				+ "</div>";
		}).join("");

		return '<p class="gi-sec">Verbund<span class="gi-sec__note">'
			+ mitglieder.length + " Fragmente</span></p>" + zeilen;
	}
```

In `garetienDetailMarkup`, direkt nach `kopf += garetienSichtLeisteMarkup(...)`:

```js
		const verbundBlock = garetienVerbundBlockMarkup(objekt, zustand.objekte || []);
```

und im `return` zwischen `kopf` und `mitte`:

```js
		return '<div class="gi-detail">' + kopf + verbundBlock + mitte + warum
```

CSS in `css/components/garetien-importer.css`:

```css
/* Die Punktzahl im Namen der Segmentzeile -- KEINE vierte Rasterzelle (siehe
 * garetienVerbundBlockMarkup). */
.gi-seg__zahl {
	margin-left: var(--space-4);
	font-weight: var(--font-weight-regular);
	font-size: var(--font-size-caption);
	color: var(--color-text-muted);
}

/* Der ✕ einer Fragmentzeile -- 20 px wie die Symbolknoepfe der Quellenzeile, nicht 32. */
.gi-seg__weg {
	grid-column: 3;
	width: 20px;
	height: 20px;
	padding: 0;
	line-height: 1;
}
```

In `garetienHandlungen`, bei den übrigen Knöpfen:

```js
		// Der EINE Knopf, den der Verbund der Oberflaeche hinzufuegt.
		// 🔴 Ton `accent`, nicht gefuellt: die eine gefuellte Handlung dieses Fensters ist
		// „Stage importieren" (AGENTS.md §12), und gefuellt-gruen waere von `.btn--done`
		// („alles vorgemerkt") nicht zu unterscheiden.
		const verbundSchluessel = garetienVerbundSchluessel(objekt);
		if (verbundSchluessel !== "") {
			const n = garetienVerbundMitglieder(verbundSchluessel, zustand.objekte || []).length;
			const zusammen = garetienVerbundIstZusammen(verbundSchluessel);
			knoepfe.push({
				name: "verbund",
				beschriftung: (zusammen ? "Verbund auflösen (" : "Verbund auf die Stage (") + n + ")",
				zeile2: "",
				ton: "accent",
				disabled: n < 2,
				grund: n < 2 ? "Von diesem Verbund liegt nur ein Fragment in der Liste." : "",
			});
		}
```

Und im Klick-Verteiler (`garetienDetailKlick`, bei den übrigen `data-handlung`-Zweigen):

```js
		if (handlung === "verbund") {
			const schluessel = garetienVerbundSchluessel(objekt);
			if (garetienVerbundIstZusammen(schluessel)) {
				garetienVerbundAufloesen(schluessel);
			} else {
				garetienVerbundZusammenlegen(schluessel, zustand.objekte || []);
			}
			avesmapsGaretienAnzeigeAuffrischen();
			garetienDetailRendern();
			return;
		}
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
node js/review/__tests__/garetien-verbund-detail.test.js
node js/review/__tests__/garetien-einzelansicht.test.js
node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
node js/review/__tests__/garetien-handlungen.test.js
```
Erwartet: alle vier OK.

- [ ] **Schritt 5: Committen und EINZELN live schicken**

```bash
git add js/review/review-garetien-importer.js css/components/garetien-importer.css js/review/__tests__/garetien-verbund-detail.test.js
git commit -F- <<'EOF'
ui(garetien-importer): die Einzelansicht zeigt den Verbund und seine Fragmente

Jedes Fragment mit einem ✕, um es einzeln herauszunehmen.

💣 Die Punktzahl steht IM Namen, nicht in einer eigenen Rasterzelle: .gi-seg
ist ein Raster aus drei Spalten, und eine vierte Zelle schiebt den Knopf in
eine zweite Reihe -- gemessen 46 statt 28 px je Zeile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

🔧 **DU:** Blick auf ein Verbund-Objekt — vier Zeilen, jede einzeilig.

---

## Aufgabe 9: Auf „Offen" zeigt der Kasten nur Form und Art

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienDetailMarkup`, `garetienEingefuegtWirdMarkup`)
- Ändern: `css/components/garetien-importer.css`
- Test: `js/review/__tests__/garetien-bloecke.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienStageHat(key)`.
- Liefert: `garetienBlockMarkup(titel, inhalt, notiz): string`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-bloecke.test.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

const a = quelle.indexOf("function garetienEingefuegtWirdMarkup");
assert.ok(a > -1);
const rumpf = quelle.slice(a, quelle.indexOf("\n\t}", a));

// 🔴 Owner 09.09.2026: „die sind alle auf der stage erst wichtig". Darstellung sowie Wiki &
// Quellen erscheinen NUR, wenn das Objekt auf der Stage liegt -- auf „Offen" entscheidet ein
// Editor zwei Dinge: ueberhaupt? und als was? Alles andere steht dort nur im Weg, bei jeder
// der 8237 Zeilen.
assert.ok(rumpf.indexOf("avesmapsGaretienStageHat") > -1,
    "der Kasten fragt nicht, ob das Objekt auf der Stage liegt");

// Form und Art bleiben sichtbar -- sie sind die Antwort auf „als was?".
const zielWahl = rumpf.indexOf("garetienZielWahlMarkup");
const stageFrage = rumpf.indexOf("avesmapsGaretienStageHat");
assert.ok(zielWahl > -1 && zielWahl < stageFrage,
    "Form und Art stehen hinter der Stage-Bedingung und verschwinden auf Offen");

console.log("OK -- garetien-bloecke");
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-bloecke.test.js
```
Erwartet: `AssertionError: der Kasten fragt nicht, ob das Objekt auf der Stage liegt`

- [ ] **Schritt 3: Die Bedingung einziehen**

In `garetienEingefuegtWirdMarkup`, nach `garetienZielWahlMarkup(...)`:

```js
		// 🔴 SOLANGE „OFFEN", BLEIBEN DARSTELLUNG UND WIKI & QUELLEN AUSGEBLENDET (Owner
		// 09.09.2026: „die sind alle auf der stage erst wichtig"). Auf dem Reiter Offen
		// entscheidet ein Editor zwei Dinge -- ueberhaupt? und als was? Groesse, Prioritaet,
		// Zoomband, Kurvenbeschreibung, „fuer Klicks gesperrt", Wiki und Quellen beantworten
		// keine davon; sie stehen dort nur im Weg, bei jeder der 8237 Zeilen.
		// ⭐ Dieselbe Regel gilt schon fuer Name und die zwei Haekchen
		// (garetienEinfuegeHakenMarkup) -- aus der Ausnahme wird hier die Regel.
		// ⚠️ Form und Art bleiben: sie sind die Antwort auf „als was?" und gehoeren damit zur
		// Entscheidung, nicht zur Einstellung.
		if (!avesmapsGaretienStageHat(objekt.key)) {
			return '<div class="gi-insert">' + markup
				+ '<p class="gi-why">Darstellung sowie Wiki &amp; Quellen erscheinen, sobald das'
				+ " Objekt auf der Stage liegt.</p></div>";
		}
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
node js/review/__tests__/garetien-bloecke.test.js
node js/review/__tests__/garetien-eingefuegt-wird.test.js
node js/review/__tests__/garetien-gipfelhoehe.test.js
node js/review/__tests__/garetien-endkreuzung-stroemung.test.js
```
Erwartet: alle vier OK. ⚠️ Die letzten drei prüfen typspezifische Zeilen des Kastens — wenn sie
rot werden, setzen sie ein Objekt voraus, das nicht auf der Stage liegt; dann muss die Fixture
`avesmapsGaretienStageHat` bedienen, nicht die Bedingung fallen.

- [ ] **Schritt 5: Committen und EINZELN live schicken**

```bash
git add js/review/review-garetien-importer.js js/review/__tests__/garetien-bloecke.test.js
git commit -F- <<'EOF'
ui(garetien-importer): auf "Offen" zeigt der Kasten nur noch Form und Art

Owner 09.09.2026: "die sind alle auf der stage erst wichtig". Auf dem Reiter
Offen entscheidet ein Editor zwei Dinge -- ueberhaupt? und als was? Groesse,
Prioritaet, Zoomband, Kurvenbeschreibung, "fuer Klicks gesperrt", Wiki und
Quellen beantworten keine davon; sie stehen dort nur im Weg, bei jeder der
8237 Zeilen. Gemessen am Mockup: 1388 -> 786 px, 43 % kuerzer.

⭐ Dieselbe Regel gilt seit dem 09.09. schon fuer Name und die zwei Haekchen --
aus der Ausnahme wird die Regel: Offen zeigt die Entscheidung, die Stage die
Einstellungen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

🔧 **DU:** Der Blick, der zählt — Reiter „Offen", eine Zeile öffnen: der Kasten endet nach „Art".

---

## Aufgabe 10: „Übernommen" zeigt den Verbund als EINE Zeile

**Deckt Spec §7 ab.** Ohne diese Aufgabe stünden vier Zeilen im Reiter „Übernommen", obwohl der
Editor eine Entscheidung getroffen hat.

**Dateien:**
- Ändern: `api/_internal/import/garetien-liste.php`
- Ändern: `js/review/review-garetien-importer.js`
- Test: `api/_internal/import/__tests__/garetien-verbund-liste-test.php` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienVermerkLesen()` aus Aufgabe 6.
- Liefert: je Item der Liste ein Feld `verbund_angelegt` (string) — der Stamm aus dem Vermerk,
  sonst `""`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

// 🔴 DER VERBUND KOMMT AUS DEM VERMERK, NIE AUS DER NAMENSREGEL. Wuerde die Liste ihn beim
// Anzeigen neu ausrechnen, zeigte sie nach jeder Aenderung der Erkennungsregel eine andere
// Gruppierung als die, die tatsaechlich geschrieben wurde.
$item = ['apply_state' => 'done',
         'apply_note' => avesmapsGaretienVerbundVermerk('a1', 'r1', 'Silker Hain')];
assert(avesmapsGaretienVerbundAngelegt($item) === 'Silker Hain');

// Ein Item ohne Verbund -- und ein ALTER Vermerk -- liefern "".
assert(avesmapsGaretienVerbundAngelegt(['apply_state' => 'done', 'apply_note' => 'r1']) === '');
assert(avesmapsGaretienVerbundAngelegt(['apply_state' => null, 'apply_note' => '']) === '');

// ⚠️ Nur ein UEBERNOMMENES Item traegt den Vermerk -- ein geplantes hat ihn nicht.
assert(avesmapsGaretienVerbundAngelegt(
    ['apply_state' => null, 'apply_note' => avesmapsGaretienVerbundVermerk('a1', 'r1', 'X')]) === '',
    'ein nicht uebernommenes Item darf keinen angelegten Verbund melden');

echo "OK -- garetien-verbund-liste\n";
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-test.php
```
Erwartet: `Call to undefined function avesmapsGaretienVerbundAngelegt()`

- [ ] **Schritt 3: Das Feld schreiben und in die Liste hängen**

In `api/_internal/import/garetien-liste.php`:

```php
/**
 * Zu welchem angelegten Verbund gehoert dieses Item? "" = zu keinem.
 *
 * ⚠️ NUR bei `apply_state = 'done'`. Ein geplantes Item traegt seinen Vermerk noch nicht, und
 * ein Verbund, der noch gar nicht geschrieben wurde, darf im Reiter „Uebernommen" nicht stehen.
 */
function avesmapsGaretienVerbundAngelegt(array $item): string
{
    if ((string) ($item['apply_state'] ?? '') !== 'done') {
        return '';
    }

    return avesmapsGaretienVermerkLesen((string) ($item['apply_note'] ?? ''))['verbund'];
}
```

Im Aufbau der Objektzeile (dort, wo `applied` und `innerorts_uebernommen` gesetzt werden):

```php
            // Der ERSTE Vermerk gewinnt -- alle Fragmente eines Verbunds tragen denselben Stamm,
            // und der Reiter braucht nur einen.
            'verbund_angelegt' => (static function (array $items): string {
                foreach ($items as $i) {
                    $stamm = avesmapsGaretienVerbundAngelegt($i);
                    if ($stamm !== '') {
                        return $stamm;
                    }
                }
                return '';
            })($items),
```

Im Client fasst `garetienAnzeigenAntwortBauen` die Objekte des Reiters „Übernommen" nach
`verbund_angelegt` zusammen — eine Zeile je Stamm, die übrigen fallen heraus:

```js
	/*
	 * REIN: auf dem Reiter „Uebernommen" steht ein Verbund als EINE Zeile.
	 *
	 * 🔴 Gruppiert wird ueber `verbund_angelegt` aus dem VERMERK, nie ueber die Namensregel:
	 * sonst zeigte der Reiter nach jeder Aenderung der Regel eine andere Gruppierung als die,
	 * die tatsaechlich geschrieben wurde.
	 */
	function garetienUebernommenFalten(objekte) {
		const gesehen = new Set();
		return (objekte || []).filter(function (o) {
			const stamm = String(o.verbund_angelegt || "");
			if (stamm === "") { return true; }
			if (gesehen.has(stamm)) { return false; }
			gesehen.add(stamm);
			return true;
		});
	}
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-keys-test.php
```
Erwartet: alle drei OK. ⚠️ `garetien-liste-keys-test.php` nagelt die Felder der Item-Nutzlast
fest — es MUSS um `verbund_angelegt` erweitert werden, sonst ist der neue Schlüssel eine
zweite, unbelegte Wahrheit (die Falle aus `fixture-erfindet-das-feld-das-nie-reist`).

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-liste.php js/review/review-garetien-importer.js api/_internal/import/__tests__/garetien-verbund-liste-test.php api/_internal/import/__tests__/garetien-liste-keys-test.php
git commit -F- <<'EOF'
feat(garetien-importer): "Uebernommen" zeigt einen Verbund als EINE Zeile

Der Editor hat eine Entscheidung getroffen, also sieht er eine.

🔴 Gruppiert wird ueber den VERMERK (apply_note), nie ueber die Namensregel:
sonst zeigte der Reiter nach jeder Aenderung der Regel eine andere
Gruppierung als die, die tatsaechlich geschrieben wurde.

⚠️ Nur bei apply_state = 'done' -- ein geplantes Item traegt seinen Vermerk
noch nicht.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 11: Die Blockstruktur der Einzelansicht

**Deckt Spec §9 ab.** Sichtbare Änderung — einzeln live, mit Blick des Owners.

🔧 **Vor dieser Aufgabe eine Owner-Entscheidung einholen:** Sollen die Buchstaben A–G in den
Kreisen bleiben (wie im Mockup) oder reichen die Überschriften? Der Plan baut sie **ohne**
Buchstaben — sie kosten Platz und sagen einem Editor nichts, der die Blöcke ohnehin sieht. Werden
sie gewünscht, kommt `<span class="gi-block__zahl">A</span>` in den Kopf und die Regel aus dem
Mockup ins Blatt.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienDetailMarkup`)
- Ändern: `css/components/garetien-importer.css`
- Test: `js/review/__tests__/garetien-detailspalte-reihenfolge.test.js` (erweitern)

**Schnittstellen:**
- Liefert: `garetienBlockMarkup(titel, inhalt, notiz): string`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

An `js/review/__tests__/garetien-detailspalte-reihenfolge.test.js`:

```js
// --- Die sieben Bloecke, in dieser Reihenfolge (Entwurf 2026-09-09 §9) ---
// 💣 DIE IDENTITAET IST HEUTE GETEILT: Form und Art stehen in der Mitte, der Name ganz unten in
// „Dieses Objekt" -- durch Flaeche, Beschriftung und Quellen voneinander getrennt. Es sind drei
// Antworten auf EINE Frage.
const detail = quelle.slice(quelle.indexOf("function garetienDetailMarkup"));
const reihenfolge = ["Auf der Karte", "Verbund", "Identität", "Darstellung",
                     "Wiki & Quellen", "Einfügen", "Weiter importieren"];
let zuletzt = -1;
reihenfolge.forEach(function (titel) {
    const i = detail.indexOf('"' + titel + '"');
    assert.ok(i > -1, "Block fehlt: " + titel);
    assert.ok(i > zuletzt, "Block steht an der falschen Stelle: " + titel);
    zuletzt = i;
});

// ⚠️ Gruppiert wird ueber Ueberschrift und Trennlinie, NICHT ueber Rahmen (AGENTS.md §12).
const css = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "css", "components", "garetien-importer.css"), "utf8");
const block = css.slice(css.indexOf(".gi-block {"), css.indexOf("}", css.indexOf(".gi-block {")));
assert.ok(block.indexOf("border-top") > -1, "dem Block fehlt die Trennlinie");
assert.ok(block.indexOf("border:") === -1 && block.indexOf("border-radius") === -1,
    "der Block ist ein Rahmen statt einer Gliederung");
```

- [ ] **Schritt 2: Den Test fahren und den Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
```
Erwartet: `AssertionError: Block fehlt: Auf der Karte`

- [ ] **Schritt 3: Die Blöcke bauen**

```js
	/*
	 * REIN: ein Block der Einzelansicht -- Ueberschrift, optionale Notiz, Inhalt.
	 *
	 * ⚠️ Gruppiert wird ueber Ueberschrift und TRENNLINIE, nie ueber einen Rahmen (AGENTS.md
	 * §12). Sieben gerahmte Kaesten untereinander waeren ein Formular aus Kaesten; sieben
	 * Ueberschriften mit einer Linie darueber sind eine Gliederung.
	 * ⚠️ Ein Block ohne Inhalt entfaellt ganz -- eine Ueberschrift, unter der nichts steht,
	 * behauptet einen Abschnitt, den es nicht gibt.
	 */
	function garetienBlockMarkup(titel, inhalt, notiz) {
		if (String(inhalt || "") === "") { return ""; }
		const zusatz = String(notiz || "") === "" ? ""
			: '<span class="gi-block__note">' + avesmapsGaretienEscape(notiz) + "</span>";
		return '<div class="gi-block"><p class="gi-block__kopf">'
			+ avesmapsGaretienEscape(titel) + zusatz + "</p>" + inhalt + "</div>";
	}
```

`garetienDetailMarkup` setzt die sieben Blöcke in dieser Reihenfolge zusammen; der bestehende
Inhalt wandert unverändert hinein. **Der Name wandert aus „Dieses Objekt" in den Block
„Identität"** — er behält seine Bedingung (nur auf der Stage), steht aber jetzt bei Form und Art.

```css
.gi-block {
	margin-top: var(--space-10);
	padding-top: var(--space-6);
	border-top: 1px solid var(--color-divider);
}

.gi-block:first-of-type { margin-top: 0; padding-top: 0; border-top: 0; }

.gi-block__kopf {
	display: flex;
	align-items: baseline;
	gap: var(--space-6);
	margin: 0 0 var(--space-4);
	font-size: var(--font-size-caption);
	letter-spacing: .06em;
	text-transform: uppercase;
	color: var(--color-accent-brown);
	font-weight: var(--font-weight-bold);
}

.gi-block__note {
	margin-left: auto;
	letter-spacing: 0;
	text-transform: none;
	font-weight: var(--font-weight-regular);
	color: var(--color-text-muted);
}
```

- [ ] **Schritt 4: Den Test fahren und grün sehen**

```bash
node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
node js/review/__tests__/garetien-einzelansicht.test.js
node js/review/__tests__/garetien-name-aendern.test.js
```
Erwartet: alle drei OK. ⚠️ `garetien-name-aendern.test.js` prüft die Naht Feld → Zustand → Rumpf
→ Item — wenn es rot wird, hat der Umzug des Namensfelds die Naht durchtrennt, und das ist genau
der Fehler, den jener Test verhindern soll.

- [ ] **Schritt 5: Committen und EINZELN live schicken**

```bash
git add js/review/review-garetien-importer.js css/components/garetien-importer.css js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
git commit -F- <<'EOF'
ui(garetien-importer): die Einzelansicht bekommt sieben benannte Bloecke

Auf der Karte · Verbund · Identitaet · Darstellung · Wiki & Quellen ·
Einfuegen · Weiter importieren -- drei Phasen: was da liegt, was daraus wird,
was jetzt passiert.

💣 Die Identitaet war geteilt: Form und Art standen in der Mitte, der NAME ganz
unten in "Dieses Objekt" -- durch Flaeche, Beschriftung und Quellen
voneinander getrennt. Drei Antworten auf eine Frage. Der Name behaelt seine
Bedingung (nur auf der Stage), steht jetzt aber bei Form und Art.

⚠️ Gruppiert wird ueber Ueberschrift und Trennlinie, nicht ueber Rahmen
(AGENTS.md §12) -- der Test haelt das fest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

🔧 **DU:** Der Blick auf ein Stage-Objekt — sieben Blöcke, der Name oben bei Form und Art.

---

## Abschluss

- [ ] **Das GANZE Testfeld fahren, bevor irgendetwas gepusht wird**

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-js
find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-php
wc -l /tmp/rot-js /tmp/rot-php
```

⚠️ Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
⚠️ Zähle vorher die Dateizahl gegen `.github/workflows/deploy-avesmaps-strato.yml` — eine viel zu
kleine Zahl ist der einzige Unterschied zwischen diesem Fehler und einem grünen Feld.

- [ ] **Vor dem Push `gh run list --limit 3` lesen** — ein `pending` heißt warten, sonst bricht
  der Push den wartenden Lauf einer anderen Sitzung ab, und dessen Dateien lädt nie jemand hoch.

- [ ] **Gedächtnis nachziehen:** `garetien-import-projekt.md` bekommt einen Abschnitt zum Verbund
  samt der gemessenen Zahlen (41 / 115 / 74) und der Falle aus Aufgabe 7.
