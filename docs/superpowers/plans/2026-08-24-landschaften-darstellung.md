# Landschaften-Darstellung — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Der Landschaften-Editor bekommt ein Fenster „Darstellung", in dem Ton, Deckkraft,
Namensfarbe, Schriftgröße, Zoomband und die zwölf Kurvenfeinheiten je Art eingestellt werden — und
die Editoren sehen die Vorgaben als Marke auf ihren Reglern.

**Entwurf (maßgeblich):** `docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md`
**Prototyp (lauffähig):** `docs/landschaften-darstellung-mockup.html`

**Architektur:** Eine `app_setting`-Zeile hält NUR die Abweichungen; die Vorgaben stehen im Browser
(Zahlen) bzw. in den Stylesheets (Farben). Drei PHP-Dateien nach dem Muster der Zoombänder
(`_internal` · öffentlich lesen · `edit` schreiben), ein Browser-Modul als einzige Quelle der
Zahlen-Vorgaben, und das Fenster als Verbraucher. Die Karte liest überall dasselbe Modul.

**Technik:** PHP 8 strict + PDO · Vanilla JS ohne Build · Node-`assert`-Tests · `vm.runInThisContext`
zum Laden von Globals-Modulen im Test.

## Globale Zusicherungen

Sie gelten für **jede** Aufgabe:

- **Deutsch.** Kommentare, Commit-Betreffs, Meldungen (AGENTS.md §8).
- **Kein hartkodierter Farbwert, kein Radius, keine Schrift unter 11 px** (AGENTS.md §12). Fehlt ein
  Token, wird es zuerst angelegt.
- **Geteilter Arbeitsbaum: NIE `git add -A`.** Immer `git status`, dann nur die eigenen Pfade
  einzeln stagen (AGENTS.md §9).
- **Vor jedem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests:
  ```
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
  ```
  ⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden **45** Tests rot, die nur die Erweiterung vermissen.
  Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Aufgaben 1, 2, 3 und 9 sind je ein
  eigener Push; nach jedem den Deploy abwarten, bevor der nächste geht.
- **Kein Endpunkt darf ungeprüft live gehen** — der LESEpfad wird ausgeführt, nicht nur der
  Schreibpfad.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/ecosystem-display.php` | **neu** — Prüfen, Lesen, Schreiben, Zurücksetzen, Median |
| `api/app/ecosystem-display.php` | **neu** — öffentlicher Leser, fällt offen aus |
| `api/edit/map/ecosystem-display.php` | **neu** — `get`/`save`/`reset`/`median`, Riegel |
| `js/map-features/ecosystem-display.js` | **neu** — einzige Quelle der Zahlen-Vorgaben + Auflösung |
| `js/map-features/map-features-ecosystem-rendering.js` | ändern — `ecosystemAreaColor` fragt die Übersteuerung |
| `css/features/ecosystem-layer.css` | ändern — `--eco-fill` je Fläche statt je Pane |
| `js/map-features/map-features-labels.js` | ändern — `getScaledLabelSize`, `getMapLabelTypeStyle`, `shouldShowLabelMarker` |
| `html/landschaften-editor.html` | ändern — Menüband, das Fenster |
| `css/pages/landschaften-editor.css` | ändern — Stil des Fensters |
| `index.html` | ändern — Knopfbeschriftung, Beschriftungsdialog |
| `js/review/review-labels.js` | ändern — Vorgabemarken |
| `js/review/review-ecosystem-list.js` | ändern — Fenstertitel |
| `html/wiki-sync-settlement-editor.html` | ändern — „Zoombänder" → „Darstellung" |
| `api/edit/map/curve-labels-run.php` | ändern — `admin` → `edit`, Umstelllauf raus |

---

## Aufgabe 0: Den Arbeitsordner in Ordnung bringen

**Kein Code.** Sie ist die erste, weil alles danach sonst gegen einen falschen Stand gebaut wird.

**Befund vom 24.08.2026:** `master` steht **63 Commits vor** und **200 hinter** `origin/master`.
`js/map-features/curve-label-fit.js` und `curved-label-layout.js` gibt es lokal **gar nicht**, die
Kachel „Kurven rechnen" ebenso wenig. Zusätzlich liegt **fremde, nicht committete Arbeit** im Baum
(Politik-, Territorien-, Wappen-Dateien anderer Sitzungen).

- [x] **Schritt 1: Stand aufnehmen**

```bash
git fetch origin
git status --short
git rev-list --left-right --count master...origin/master
git log --oneline master ^origin/master | head -70
```

- [x] **Schritt 2: Dem Owner berichten und seine Entscheidung einholen**

🔴 **Hier wird NICHTS eigenmächtig entschieden.** Die 63 lokalen Commits gehören nicht dieser
Sitzung. Dem Owner in Klartext berichten: wie viele es sind, von wann, welche Themen — und fragen,
ob sie hoch sollen oder ob der Ordner auf `origin/master` gezogen wird.

💣 **Niemals `git push` mit divergiertem `master`.** Der Push nähme alle 63 mit
(`geteilter-baum-push-nimmt-fremde-commits-mit`).
💣 **Niemals `rebase --autostash`, solange fremde Arbeit im Baum liegt**
(`rebase-autostash-falsch-bei-fremder-arbeit`).

- [x] **Schritt 3: Nach der Auflösung gegenprüfen**

```bash
test -f js/map-features/curve-label-fit.js && echo "da" || echo "FEHLT -- Stand noch nicht aktuell"
grep -c ecoCurves html/landschaften-editor.html
```
Erwartet: „da" und `1` oder mehr.

---

## Aufgabe 1: Umbenennungen

**Sichtbar. Eigener Push.**

**Dateien:**
- Ändern: `index.html` (Knopf `#ecosystem-editor-open`)
- Ändern: `html/landschaften-editor.html` (`<title>`)
- Ändern: `js/review/review-ecosystem-list.js` (Überschrift)
- Ändern: `js/app/i18n-en.js` (englische Fassung)
- Ändern: `html/wiki-sync-settlement-editor.html` (Knopf `#seZoomBands`, Fenstertitel)
- Test: `js/review/__tests__/landschaften-beschriftung.test.js` **(neu)**

**Schnittstellen:**
- Liefert: nichts an spätere Aufgaben — reine Beschriftung.

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 Beschriftung wandert, KENNUNG NICHT (Entwurf §1). Derselbe Schnitt wie bei
// „Neuigkeiten"/`changelog`: der Deploy loescht nie, eine umgetaufte Adresse liesse eine
// gecachte Seite ins Leere greifen.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/landschaften-beschriftung.test.js

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", "..", "..", p), "utf8");

const index = lies("index.html");
const editor = lies("html/landschaften-editor.html");
const liste = lies("js/review/review-ecosystem-list.js");
const orte = lies("html/wiki-sync-settlement-editor.html");

// ---- Die neuen Woerter stehen da ----
assert.ok(/>Landschaften bearbeiten</.test(index), "der Knopf heisst „Landschaften bearbeiten“");
assert.ok(/Landschaften bearbeiten/.test(editor), "der Fenstertitel ebenso");
assert.ok(/"Landschaften bearbeiten"/.test(liste), "und die Ueberschrift im Listen-Editor");
assert.ok(/>Darstellung</.test(orte), "der Knopf unter „Orte“ heisst „Darstellung“");

// ---- Die alten Woerter sind weg ----
assert.ok(!/>Regionen bearbeiten</.test(index), "„Regionen bearbeiten“ steht nicht mehr im Knopf");
assert.ok(!/>Zoombänder</.test(orte), "„Zoombänder“ steht nicht mehr im Knopf");

// ---- 💣 Und die Kennungen sind UNVERAENDERT ----
assert.ok(/ecosystem\.editor\.title/.test(liste), "der i18n-Schluessel bleibt ecosystem.editor.title");
assert.ok(/id="ecosystem-editor-open"/.test(index), "die Knopf-Kennung bleibt");
assert.ok(/id="seZoomBands"/.test(orte), "die Kennung des Orte-Knopfs bleibt seZoomBands");
assert.ok(/id="seZoomBandsDialog"/.test(orte), "und die des Fensters ebenso");

// 🪤 Zwei Kacheln heissen jetzt „Darstellung" und zeigen Verschiedenes. Das ist gewollt --
// aber der title MUSS es aussprechen, sonst ist es eine Falle fuer den Editor.
const titelZeile = orte.match(/id="seZoomBands"[^>]*title="([^"]*)"/);
assert.ok(titelZeile, "der Knopf traegt einen title");
assert.ok(/Ort/.test(titelZeile[1]), "und der title sagt, dass es um ORTE geht");

console.log("landschaften-beschriftung: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `node js/review/__tests__/landschaften-beschriftung.test.js`
Erwartet: FEHLSCHLAG bei „der Knopf heisst „Landschaften bearbeiten““.

- [x] **Schritt 3: Umbenennen**

In `index.html` beim Knopf `#ecosystem-editor-open`: `<span class="t1">Regionen bearbeiten</span>` →
`<span class="t1">Landschaften bearbeiten</span>`.
In `html/landschaften-editor.html`: `<title>Avesmaps – Regionen bearbeiten</title>` →
`… – Landschaften bearbeiten`.
In `js/review/review-ecosystem-list.js`: der Rückfalltext in
`t("ecosystem.editor.title", "Regionen bearbeiten")` → `"Landschaften bearbeiten"`.
In `js/app/i18n-en.js`: den Wert zu `ecosystem.editor.title` auf `"Edit landscapes"` ziehen.
In `html/wiki-sync-settlement-editor.html`: `<span class="t1">Zoombänder</span>` →
`<span class="t1">Darstellung</span>`, der Fenstertitel `Zoombänder` → `Darstellung`, und der
`title` des Knopfes bekommt vorn „**Orte:** " — er muss die Verwechslung mit dem
Landschaften-Fenster ausschließen.

🔴 **Nichts anderes anfassen.** `seZoomBands`, `zoomBandsState`, `ecosystem.editor.title`,
Dateinamen: unverändert.

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: `node js/review/__tests__/landschaften-beschriftung.test.js`
Erwartet: BESTANDEN.

- [x] **Schritt 5: Committen**

```bash
git add index.html html/landschaften-editor.html js/review/review-ecosystem-list.js js/app/i18n-en.js html/wiki-sync-settlement-editor.html js/review/__tests__/landschaften-beschriftung.test.js
git commit -m "ui(landschaften): der Editor heisst „Landschaften bearbeiten", der Zoombaender-Knopf „Darstellung""
```

---

## Aufgabe 2: Die Kachel „Wiki zuweisen" fällt weg

**Sichtbar. Eigener Push.**

**Dateien:**
- Ändern: `html/landschaften-editor.html` (Kachel `#ecoAssignAll` samt Verdrahtung)
- Ändern: `js/ui/__tests__/wiki-massenzuweisung.test.js` (die Zusicherung dreht sich um)

**Schnittstellen:**
- Liefert: ein Menüband mit sechs Kacheln (die siebte kommt in Aufgabe 10).

- [x] **Schritt 1: Die vorhandene Zusicherung umdrehen**

In `js/ui/__tests__/wiki-massenzuweisung.test.js` steht heute:
```javascript
assert.ok(/id="ceAssignAllBtn"/.test(editor), "die Kachel „Wiki zuweisen“ fehlt im Menüband");
```
Diese Zeile prüft den **Karten**-Editor und bleibt. Für den Landschaften-Editor eine neue
Zusicherung ergänzen:

```javascript
// 🔴 Die Kachel „Wiki zuweisen" ist am 24.08.2026 aus dem LANDSCHAFTEN-Editor gefallen (Entwurf §2)
// -- aus demselben Grund wie beim Wege-Editor am 19.08.2026: seit dem 16.08.2026 sitzt die
// Zuweisung im geteilten Bauteil in der Eigenschaften-Spalte, der Massenlauf war die Erstbefuellung.
// 💣 NUR die Kachel. `assign_all` bleibt serverseitig, js/ui/wiki-massenzuweisung.js bleibt liegen
// -- die Kachel im KARTEN-Editor ruft denselben Ablauf und wird oben geprueft.
const landschaften = fs.readFileSync(path.join(__dirname, "..", "..", "..", "html/landschaften-editor.html"), "utf8");
assert.ok(!/id="ecoAssignAll"/.test(landschaften), "die Kachel „Wiki zuweisen“ ist aus dem Landschaften-Menueband entfernt");
assert.ok(!/ecoAssignAllInfo/.test(landschaften), "und ihre Statuszeile ebenso");
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `node js/ui/__tests__/wiki-massenzuweisung.test.js`
Erwartet: FEHLSCHLAG — die Kachel steht noch da.

- [x] **Schritt 3: Entfernen**

Aus `html/landschaften-editor.html`: die `<button … id="ecoAssignAll" …>`-Zeile, den
`$("ecoAssignAll").addEventListener(…)`, und jede Auffrischung von `ecoAssignAllInfo`.

An die Stelle des `<script src="…wiki-massenzuweisung.js">` (falls er dadurch ohne Aufrufer bleibt)
gehört ein Vermerk:

```html
<!-- 🔴 KEINE Kachel „Wiki zuweisen" mehr (24.08.2026, Entwurf §2). Der Massenlauf `assign_all`
     bleibt serverseitig, und js/ui/wiki-massenzuweisung.js traegt ihn weiter fuer den
     Karten-Editor. Diese Kachel hatte bis zum 16.08.2026 schon einmal gar keinen Aufrufer --
     damals sah toter Code ein Jahr lang wie eine Bedienung aus (refreshRegionBergStatus,
     js/review/review-region-sync.js). Wer die Luecke „repariert", baut sie wieder auf. -->
```

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: `node js/ui/__tests__/wiki-massenzuweisung.test.js`
Erwartet: BESTANDEN.

- [x] **Schritt 5: Committen**

```bash
git add html/landschaften-editor.html js/ui/__tests__/wiki-massenzuweisung.test.js
git commit -m "ui(landschaften): die Kachel „Wiki zuweisen" faellt -- die Zuweisung sitzt am Objekt"
```

---

## Aufgabe 3: „Kurven rechnen" darf jeder Editor, der Umstelllauf fliegt raus

**Sichtbar (Recht). Eigener Push.**

**Dateien:**
- Ändern: `api/edit/map/curve-labels-run.php`
- Ändern: `html/landschaften-editor.html` (`title` der Kachel, Auswertung in `runCurveLabels`)
- Test: `api/_internal/app/__tests__/kurvenlauf-recht-test.php` **(neu)**

**Schnittstellen:**
- Liefert: `POST /api/edit/map/curve-labels-run.php` antwortet ohne `rollout`-Feld.

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php

declare(strict_types=1);

// 🔴 „Kurven rechnen" darf jeder EDITOR (Owner 23.08.2026), und der einmalige Umstelllauf ist weg
// (Owner: „das einmalige Mapping kann weg, ich habe den Button gedrückt"). Entwurf §3.
//
// ⚠️ Der Test liest die QUELLE, er faehrt den Endpunkt nicht: er braucht sonst Sitzung und
// Datenbank. Was er belegt, ist genau das, was hier schiefgehen kann -- ein vergessener
// `admin`-Riegel und ein liegengebliebener Zweig, den der naechste Leser fuer aktiv haelt.
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/kurvenlauf-recht-test.php

$quelle = file_get_contents(__DIR__ . '/../../../edit/map/curve-labels-run.php');
assert($quelle !== false, 'der Endpunkt ist lesbar');

assert(
    str_contains($quelle, "avesmapsRequireUserWithCapability('edit')"),
    'der Riegel steht auf `edit`'
);
assert(
    !str_contains($quelle, "avesmapsRequireUserWithCapability('admin')"),
    'und NICHT mehr auf `admin`'
);

// 💣 Der Umstelllauf ist vollstaendig weg -- kein Zweig, kein Merker, kein Antwortfeld.
foreach (['rollout', 'Umstellung', 'umstell'] as $wort) {
    assert(
        stripos($quelle, $wort) === false,
        "der Umstelllauf ist restlos entfernt (gefunden: {$wort})"
    );
}

// Und im Fenster steht nicht mehr „Nur Admin".
$fenster = file_get_contents(__DIR__ . '/../../../../html/landschaften-editor.html');
assert($fenster !== false, 'das Fenster ist lesbar');
$kachel = [];
preg_match('/id="ecoCurves"[^>]*title="([^"]*)"/', $fenster, $kachel);
assert($kachel !== [], 'die Kachel traegt einen title');
assert(stripos($kachel[1], 'admin') === false, 'der title sagt nicht mehr „Nur Admin"');
assert(!str_contains($fenster, 'data.rollout'), 'die Auswertung des Umstelllaufs ist weg');

echo "kurvenlauf-recht: alle Zusicherungen gruen\n";
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/kurvenlauf-recht-test.php`
Erwartet: FEHLSCHLAG bei „der Riegel steht auf `edit`".

- [x] **Schritt 3: Ändern**

In `api/edit/map/curve-labels-run.php`:
- `avesmapsRequireUserWithCapability('admin')` → `avesmapsRequireUserWithCapability('edit')`, und den
  Kommentarblock darüber neu schreiben (er begründet heute das Gegenteil).
- Den kompletten `rollout`-Zweig entfernen: die Ermittlung, das Schreiben des Merkers, das
  `'rollout' => …` in der Antwort.
- An die Stelle einen Vermerk setzen:

```php
// 🔴 KEIN Umstelllauf mehr (24.08.2026, Entwurf §3). Er schaltete beim ERSTEN Lauf rund 56 Flaechen
// ein; der Owner hat ihn gedrueckt, er hat seine Arbeit getan. Ein Lauf, der beim ersten Mal etwas
// anderes tut als beim zweiten, ist auf Dauer eine Falle -- der naechste Leser haelt den toten
// Zweig fuer aktiv. Der Zustandsmerker in `app_setting` bleibt stehen (der Deploy loescht nie),
// er wird nur nicht mehr gelesen.
```

In `html/landschaften-editor.html`: „Nur Admin; laeuft einige Sekunden." → „Laeuft einige Sekunden."
und den `data.rollout`-Zweig aus `runCurveLabels()` entfernen.

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/kurvenlauf-recht-test.php`
Erwartet: BESTANDEN.

- [x] **Schritt 5: Committen**

```bash
git add api/edit/map/curve-labels-run.php html/landschaften-editor.html api/_internal/app/__tests__/kurvenlauf-recht-test.php
git commit -m "feat(kurvenlabel): „Kurven rechnen" darf jeder Editor -- und der Umstelllauf ist weg"
```

---

## Aufgabe 4: Das Speicherfundament

**Unsichtbar.**

**Dateien:**
- Erstellen: `api/_internal/app/ecosystem-display.php`
- Test: `api/_internal/app/__tests__/ecosystem-display-test.php`

**Schnittstellen:**
- Liefert an Aufgabe 5 und 6:
  - `AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY = 'ecosystem_display'`
  - `AVESMAPS_ECOSYSTEM_DISPLAY_STAMP_KEY = 'ecosystem_display_stamp'`
  - `avesmapsEcosystemDisplayValidate(mixed $incoming): ?array`
  - `avesmapsEcosystemDisplayRead(PDO $pdo): array{display: ?array, stamp: string}`
  - `avesmapsEcosystemDisplayWrite(PDO $pdo, array $display): bool`
  - `avesmapsEcosystemDisplayReset(PDO $pdo): void`

**Die gespeicherte Form** (nur Abweichungen, nie eine Kopie der Vorgabe):

```json
{
  "version": 1,
  "flaeche":   { "vegetation:wald": "#3f6b2c" },
  "deckkraft": { "vegetation:wald": 0.72 },
  "global":    { "vegetation": { "an": true, "wert": 0.72 } },
  "farbe":     { "wald": "#bfeec8" },
  "groesse":   { "wald": [9, 11, 13, 14, 16, 18, 19, 21, 21] },
  "vorgabe":   { "wald": { "ab": 0, "bis": 7, "curveMax": 1, "prio": 3 } },
  "kurve":     { "polyDegree": 3, "straighten": 0 }
}
```

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php

declare(strict_types=1);

// Die Pruefung der Darstellungstafel. Entwurf §8.
// 🔴 Der Server kennt die VORGABEN NICHT und fuehrt KEINE Artenliste -- er prueft Form und
// Schranken, ueber die Namen entscheidet der Browser. Dieselbe Arbeitsteilung wie bei den
// Zoombaendern (api/_internal/app/zoom-bands.php).
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-display-test.php

require_once __DIR__ . '/../ecosystem-display.php';

// ---- A. Form ---------------------------------------------------------------------------------
assert(avesmapsEcosystemDisplayValidate('nein') === null, 'ein String ist keine Tafel');
// 💣 Eine blanke JSON-Liste kaeme sonst glatt durch: `$x['farbe'] ?? []` findet keinen Schluessel
// und liefert leere Zeilen, statt abzulehnen. Genau dieser Test war bei den Zoombaendern rot.
assert(avesmapsEcosystemDisplayValidate([1, 2, 3]) === null, 'eine Liste ist keine Tafel');
assert(is_array(avesmapsEcosystemDisplayValidate([])), 'eine leere Tafel ist gueltig');

// ---- B. Farben ------------------------------------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => '#bfeec8']]);
assert($ok['farbe']['wald'] === '#bfeec8', 'ein Sechsstellen-Hexwert geht durch');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => 'rot']]) === null, 'ein Farbname nicht');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => '#fff']]) === null, 'auch keine Kurzform');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['WALD' => '#ffffff']]) === null, 'Grossbuchstaben im Schluessel nicht');

// ---- C. Deckkraft ---------------------------------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => 0.72]]);
assert($ok['deckkraft']['vegetation:wald'] === 0.72, '0 bis 1 geht durch');
assert(avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => 1.5]]) === null, 'ueber 1 nicht');
// 💣 KEINE STRINGS. "0.5" sieht aus wie eine Zahl und ist keine.
assert(avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => '0.5']]) === null, 'ein String nicht');

// ---- D. Groessenzeile ------------------------------------------------------------------------
$neun = [9, 11, 13, 14, 16, 18, 19, 21, 21];
$ok = avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => $neun]]);
assert($ok['groesse']['wald'][0] === 9.0, 'neun Zahlen gehen durch');
assert(avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => [9, 200]]]) === null, '200 pt nicht');
// 💣 Eine Zeile ist eine LISTE: 0,1,2,… ohne Luecke. Ein Objekt {"2":5} laese der Browser an der
// falschen Zoomstufe.
assert(avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => [2 => 12.0]]]) === null, 'ein Objekt ist keine Zeile');

// ---- E. Vorgaben (Band, max. Namen, Prioritaet) ----------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => 2, 'bis' => 5, 'curveMax' => 2, 'prio' => 4]]]);
assert($ok['vorgabe']['wald']['ab'] === 2, 'ein Band geht durch');
// 🔴 „aus" ist als bis < ab kodiert und MUSS durchgehen -- es ist ein gueltiger Zustand,
// kein Fehler (Entwurf §5.3).
$aus = avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => 0, 'bis' => -1]]]);
assert($aus !== null && $aus['vorgabe']['wald']['bis'] === -1, '„aus" (bis < ab) ist gueltig');
assert(avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => 9]]]) === null, 'z9 gibt es nicht');
assert(avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['prio' => 9]]]) === null, 'Prioritaet 9 nicht');

// ---- F. Deckel --------------------------------------------------------------------------------
$riesig = ['farbe' => []];
for ($i = 0; $i < 4000; $i += 1) { $riesig['farbe']['a' . $i] = '#ffffff'; }
assert(avesmapsEcosystemDisplayValidate($riesig) === null, 'eine Tafel ueber dem Byte-Deckel faellt raus');

// ---- G. Schreiben und Zurueckleben ------------------------------------------------------------
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE app_setting (setting_key VARCHAR(190) PRIMARY KEY, setting_value TEXT)');

$leer = avesmapsEcosystemDisplayRead($pdo);
assert($leer['display'] === null, 'ohne Zeile gibt es keine Tafel');

$tafel = avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => '#123456']]);
assert(avesmapsEcosystemDisplayWrite($pdo, $tafel) === true, 'das Schreiben meldet Erfolg');
$zurueck = avesmapsEcosystemDisplayRead($pdo);
assert($zurueck['display']['farbe']['wald'] === '#123456', 'und der Wert steht wirklich da');
assert($zurueck['stamp'] !== '', 'der Stempel ebenso');

// 🔴 Zuruecksetzen LOESCHT die Zeile, statt eine Kopie der Vorgabe zu hinterlassen -- die
// veraltete sonst beim naechsten Mal, wenn jemand die Vorgabe im Browser aendert.
avesmapsEcosystemDisplayReset($pdo);
$nachher = avesmapsEcosystemDisplayRead($pdo);
assert($nachher['display'] === null, 'nach dem Zuruecksetzen ist die Zeile weg');
assert($nachher['stamp'] !== '', 'der Stempel bleibt und ist neu');

echo "ecosystem-display: alle Zusicherungen gruen\n";
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-display-test.php`
Erwartet: FEHLSCHLAG — `require` findet die Datei nicht.

- [x] **Schritt 3: Die Datei bauen**

Bauform **wörtlich** von `api/_internal/app/zoom-bands.php` übernehmen: derselbe Aufbau, dieselben
Wachen, dieselben Kommentare an denselben Stellen. Abweichungen nur dort, wo der Gegenstand ein
anderer ist:

- `avesmapsAppSettingGetManyWithoutDdl` zum Lesen (**kein DDL** — die Funktion sitzt auch hinter dem
  öffentlichen Endpunkt).
- `avesmapsAppSettingEnsureWideValue($pdo)` **nur** in `…Write()`, nie im Lesepfad
  (`information_schema`-Sonde = die Last aus AGENTS.md §10).
- `…Write()` **liest zurück** und gibt `false`, wenn der gelesene Wert nicht dem geschriebenen
  entspricht.
- Schlüsselform: `/^[a-z_]{1,32}$/` für Artennamen, `/^[a-z]{1,20}:[a-z_]{1,32}$/` für
  `kind:type`-Schlüssel.
- Farbform: `/^#[0-9a-f]{6}$/`.
- Schranken: Deckkraft `0.0 … 1.0`, Größe `4.0 … 30.0`, `ab`/`bis` `-1 … 7`, `curveMax` `1 … 3`,
  `prio` `1 … 5`.
- `AVESMAPS_ECOSYSTEM_DISPLAY_MAX_BYTES = 24576` (die Tafel ist größer als die der Zoombänder: 33
  Flächenarten plus 31 Namensarten plus neun Größen je Art).

💣 Die Prüfung **normalisiert nicht** — kein Auffüllen, kein Vorwärtsfüllen. Das tut der Browser
gegen seine eigene Vorgabe.

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: derselbe Befehl wie Schritt 2.
Erwartet: BESTANDEN, „alle Zusicherungen gruen".

- [x] **Schritt 5: Die Zusicherungen einzeln mutieren**

💣 Von 15 Mutationen des Passungs-Moduls überlebten beim Kurvenlabel-Bau **11** den mitgelieferten
Test. Also: jede Schranke einzeln aufweichen (`0.0` → `-99.0`, `preg_match` entfernen, die
Rücklese-Zeile durch `return true` ersetzen) und nachsehen, ob **genau** die zugehörige Zusicherung
rot wird. Bleibt eine grün, ist sie wertlos und wird geschärft.

- [x] **Schritt 6: Committen**

```bash
git add api/_internal/app/ecosystem-display.php api/_internal/app/__tests__/ecosystem-display-test.php
git commit -m "feat(landschaften): das Speicherfundament der Darstellungstafel"
```

---

## Aufgabe 5: Die zwei Endpunkte

**Unsichtbar.**

**Dateien:**
- Erstellen: `api/app/ecosystem-display.php`
- Erstellen: `api/edit/map/ecosystem-display.php`
- Test: `api/_internal/app/__tests__/ecosystem-display-endpunkt-test.php`

**Schnittstellen:**
- Verbraucht: alles aus Aufgabe 4.
- Liefert an Aufgabe 6, 10 und 12:
  - `GET /api/app/ecosystem-display.php` → `{ok, display, stamp}`; **jeder Fehler ⇒ `display: null`**
  - `POST /api/edit/map/ecosystem-display.php` mit `action` ∈ `get|save|reset|median`
    → `{ok, display, stamp, can_save}`, bei `median` zusätzlich `{median: {<art>: {ab,bis,curveMax,prio,n}}}`
  - **neu in `api/_internal/app/ecosystem-display.php`:**
    `avesmapsEcosystemDisplayMedians(PDO $pdo): array<string, array{ab:int,bis:int,curveMax:int,prio:int,n:int}>`
    (Schritt 3 zeigt sie vollständig)

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php

declare(strict_types=1);

// 💣 EIN NEUER ENDPUNKT GEHT NICHT UNGEPRUEFT LIVE, und geprueft wird der LESEpfad -- der
// Wege-Editor ging am 19.08.2026 mit einem Leser live, den nie etwas angefasst hatte, und stuerzte
// beim ersten Klick ab (`const` hinter dem try-Block; PHP hoistet Funktionen, aber keine `const`,
// und ein Fatal antwortet mit LEEREM Rumpf -- im Browser sieht das aus wie ein Netzfehler).
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/ecosystem-display-endpunkt-test.php

$wurzel = __DIR__ . '/../../../..';

// ---- A. Beide Dateien sind syntaktisch heil ---------------------------------------------------
foreach (['api/app/ecosystem-display.php', 'api/edit/map/ecosystem-display.php'] as $datei) {
    $pfad = $wurzel . '/' . $datei;
    assert(is_file($pfad), "{$datei} existiert");
    $ausgabe = [];
    $code = 0;
    exec('php -l ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
    assert($code === 0, "{$datei} ist syntaktisch heil: " . implode(' ', $ausgabe));
}

// ---- B. 💣 Jede `const` auf Dateiebene steht VOR ihrer ersten Benutzung -----------------------
// Genau daran ist der Wege-Editor gestorben. Es gibt dafuer einen repoweiten Test
// (const-vor-benutzung-test.php); hier steht die Zusicherung fuer die zwei neuen Dateien
// ausdruecklich, damit sie beim Bauen nicht erst am Ende auffaellt.
foreach (['api/app/ecosystem-display.php', 'api/edit/map/ecosystem-display.php'] as $datei) {
    $quelle = file_get_contents($wurzel . '/' . $datei);
    if (preg_match_all('/^const\s+([A-Z_][A-Z0-9_]*)\s*=/m', $quelle, $treffer, PREG_OFFSET_CAPTURE)) {
        foreach ($treffer[1] as [$name, $stelle]) {
            $erste = strpos($quelle, $name);
            assert($erste >= $stelle - 6, "{$datei}: {$name} wird vor seiner Definition benutzt");
        }
    }
}

// ---- C. Der oeffentliche Leser faellt OFFEN aus ------------------------------------------------
$leser = file_get_contents($wurzel . '/api/app/ecosystem-display.php');
assert(str_contains($leser, 'catch (Throwable)'), 'der Leser faengt jeden Fehler');
assert(str_contains($leser, "'display' => null"), 'und liefert dann display: null statt 500');
// 🔴 KEIN DDL im Lesepfad -- er laeuft bei JEDEM Besucher.
assert(!str_contains($leser, 'EnsureTable'), 'der Leser legt keine Tabelle an');
assert(!str_contains($leser, 'EnsureWideValue'), 'und macht keine information_schema-Sonde');
// 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION. avesmapsCreatePdo nimmt ein Array, und $config
// IST eins -- PHP beschwert sich nicht, drinnen ist alles leer, und der catch macht daraus eine
// leere Antwort. Genau so hat das Tempowerte-Fenster nie geladen.
assert(str_contains($leser, "avesmapsCreatePdo(\$config['database'] ?? [])"), 'und nimmt den Teilbaum');

// ---- D. Der Schreiber hat den Riegel ----------------------------------------------------------
$schreiber = file_get_contents($wurzel . '/api/edit/map/ecosystem-display.php');
assert(str_contains($schreiber, "avesmapsRequireUserWithCapability('edit')"), 'lesen darf `edit`');
assert(str_contains($schreiber, "avesmapsUserCan(\$user, 'admin')"), 'speichern nur `admin`');
// 🔴 Der Riegel steht SERVERSEITIG, nicht nur am ausgegrauten Knopf.
assert(str_contains($schreiber, "'forbidden'"), 'und lehnt einen Editor beim Speichern ab');
assert(str_contains($schreiber, 'ecosystem_display_not_stored'), 'ein Speichern, das nicht ankommt, meldet das');

echo "ecosystem-display-endpunkt: alle Zusicherungen gruen\n";
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/ecosystem-display-endpunkt-test.php`
Erwartet: FEHLSCHLAG bei „api/app/ecosystem-display.php existiert".

- [x] **Schritt 3: Die zwei Endpunkte bauen**

`api/app/ecosystem-display.php`: **Zeile für Zeile** nach `api/app/zoom-bands.php`, mit
`W/"eco-disp-<stamp>"` als ETag.

`api/edit/map/ecosystem-display.php`: nach `api/edit/map/zoom-bands.php`, plus die vierte Aktion:

```php
    if ($action === 'median') {
        // 🔴 DER MEDIAN IST UNSER WERKZEUG, nicht das der Editoren (Entwurf §5.4). Er wandert nie
        // in den Beschriftungsdialog -- dort steht die Vorgabe.
        // ⚠️ MySQL kennt kein MEDIAN(). Die Werte liegen ohnehin in properties_json, also werden
        // die Zeilen geholt und in PHP ausgezaehlt: rund 900 Beschriftungen, eine Abfrage.
        avesmapsJsonResponse(200, [
            'ok' => true,
            'median' => avesmapsEcosystemDisplayMedians($pdo),
            'can_save' => $maySave,
        ]);
    }
```

Und in `api/_internal/app/ecosystem-display.php` dazu:

```php
/**
 * Der Median je Namensart ueber die aktiven Beschriftungen.
 *
 * ⚠️ EINE Abfrage, keine je Art. `feature_subtype` ist eine SPALTE auf map_features; min_zoom,
 * max_zoom, curve_label_max und priority liegen in properties_json und werden hier gelesen.
 * 🔴 Die Vorgaben stehen NICHT hier -- fehlt ein Wert an einer Zeile, zaehlt diese Zeile fuer
 * dieses Feld einfach nicht mit. Eine Vorgabe einzusetzen faelschte den Median in ihre Richtung.
 *
 * @return array<string, array{ab:int, bis:int, curveMax:int, prio:int, n:int}>
 */
function avesmapsEcosystemDisplayMedians(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT feature_subtype, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1"
    );
    $eimer = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $art = (string) ($zeile['feature_subtype'] ?? '');
        if ($art === '') {
            continue;
        }
        $p = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($p)) {
            continue;
        }
        foreach (['ab' => 'min_zoom', 'bis' => 'max_zoom', 'curveMax' => 'curve_label_max', 'prio' => 'priority'] as $feld => $schluessel) {
            if (isset($p[$schluessel]) && is_numeric($p[$schluessel])) {
                $eimer[$art][$feld][] = (int) $p[$schluessel];
            }
        }
        $eimer[$art]['n'] = ($eimer[$art]['n'] ?? 0) + 1;
    }

    $raus = [];
    foreach ($eimer as $art => $felder) {
        $eintrag = ['n' => (int) ($felder['n'] ?? 0)];
        foreach (['ab', 'bis', 'curveMax', 'prio'] as $feld) {
            $werte = $felder[$feld] ?? [];
            if ($werte === []) {
                continue;
            }
            sort($werte);
            // Bei gerader Anzahl der UNTERE der beiden mittleren -- eine ganze Zoomstufe, keine
            // halbe. Ein Median von 3,5 liesse sich auf keinen Regler setzen.
            $eintrag[$feld] = $werte[intdiv(count($werte) - 1, 2)];
        }
        $raus[$art] = $eintrag;
    }

    return $raus;
}
```

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: derselbe Befehl wie Schritt 2.
Erwartet: BESTANDEN.

- [x] **Schritt 5: Committen**

```bash
git add api/app/ecosystem-display.php api/edit/map/ecosystem-display.php api/_internal/app/ecosystem-display.php api/_internal/app/__tests__/ecosystem-display-endpunkt-test.php
git commit -m "feat(landschaften): Leser, Schreiber und Median der Darstellungstafel"
```

---

## Aufgabe 6: Das Vorgabemodul im Browser

**Unsichtbar — noch verbraucht es niemand.**

**Dateien:**
- Erstellen: `js/map-features/ecosystem-display.js`
- Ändern: `index.html`, `html/landschaften-editor.html` (Skript einhängen)
- Test: `js/map-features/__tests__/ecosystem-display-vorgabe.test.js`

**Schnittstellen:**
- Liefert an Aufgabe 7–15:
  - `AVESMAPS_ECOSYSTEM_DISPLAY_DEFAULTS` — `{deckkraft, band, curveMax, prio, groesseBasis}`
  - `avesmapsEcosystemDisplayInstall(stored)` — die geladene Übersteuerung ablegen
  - `avesmapsEcosystemDisplayDeckkraft(kind, typeKey) → number`
  - `avesmapsEcosystemDisplayFarbe(subtype, tokenTon) → string` (Übersteuerung oder `tokenTon`)
  - `avesmapsEcosystemDisplayFlaechenTon(kind, typeKey, tokenTon) → string`
  - `avesmapsEcosystemDisplayGroesse(subtype, zoom) → number`
  - `avesmapsEcosystemDisplayBand(subtype) → {ab, bis}`
  - `avesmapsEcosystemDisplaySichtbar(subtype, zoom) → boolean`
  - `avesmapsEcosystemDisplayVorgabe(subtype) → {ab, bis, curveMax, prio}`

🔴 **Farben bekommen ihren Vorgabewert HEREINGEREICHT** (`tokenTon`), sie stehen nicht im Modul. Der
Aufrufer liest den Token; das Modul entscheidet nur, ob eine Übersteuerung ihn schlägt. Sonst stünde
jede Farbe zweimal da (Entwurf §8).

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER ABNAHMEFALL. Die Vorgaben muessen das Bild vom 24.08.2026 reproduzieren -- sonst aendert
// eine Auslieferung, die „nichts aendern" soll, die ganze Karte.
//
// ⚠️ EINE Ausnahme, und sie ist im Entwurf §5.5 begruendet: die SCHRIFTGROESSE kann es nicht,
// weil heute jedes Label seine eigene Grundgroesse traegt. Die Vorgabe ist die echte Formel bei
// Grundgroesse 18 -- und genau die steht hier als Zeuge.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-vorgabe.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

// ---- A. Die Deckkraft je Ebene, Ziffer fuer Ziffer aus css/features/ecosystem-layer.css --------
// 💣 Sie ist NICHT eine Zahl fuer alle. Wer hier eine einzige Zahl einsetzt, zieht die vier
// Ebenen zusammen -- und die 0,16 der derographischen Behaelter ist Absicht.
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("derographisch", "region"), 0.16);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("klima", "polar"), 0.30);

// ---- B. Die Groessenkurve = die echte Formel bei Grundgroesse 18 -------------------------------
// Der ABGESCHAFFTE Rechenweg steht hier als Zeuge, nicht als Quelle. Wird er je „angepasst",
// damit der Test gruen wird, ist der Test wertlos.
const VISUAL_MAX = 5;
const TIEF_SCHRITT = 0.08;
const alteGroesse = (z) => {
	const ratio = Math.max(0, Math.min(1, z / VISUAL_MAX));
	const ueber = Math.max(0, Math.min(2, z - VISUAL_MAX));
	return Math.round(18 * (0.5 + ratio * 0.5) * (1 + ueber * TIEF_SCHRITT));
};
for (let z = 0; z <= 8; z += 1) {
	assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", z), alteGroesse(z),
		`Zoom ${z} reproduziert die heutige Kurve`);
}
assert.deepStrictEqual([0,1,2,3,4,5,6,7,8].map(alteGroesse), [9, 11, 13, 14, 16, 18, 19, 21, 21],
	"und das sind die Zahlen, die live gemessen wurden");

// ---- C. Band und die zwei kleinen Vorgaben ----------------------------------------------------
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("wald"), { ab: 0, bis: 7 },
	"Vorgabe z0-z7, die heutigen Werte aus index.html");
assert.strictEqual(avesmapsEcosystemDisplayVorgabe("wald").curveMax, 1);
assert.strictEqual(avesmapsEcosystemDisplayVorgabe("wald").prio, 3);

// 🔴 z8 ERBT z7 -- die Karte kennt Stufe 8 nicht (maxZoom: 7).
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 8), true, "z8 erbt z7");

// ---- D. Farben kommen von aussen --------------------------------------------------------------
// 🔴 Ohne Uebersteuerung reicht das Modul den Token durch. Es kennt keine Farbe.
assert.strictEqual(avesmapsEcosystemDisplayFarbe("wald", "#bfeec8"), "#bfeec8");
assert.strictEqual(avesmapsEcosystemDisplayFlaechenTon("vegetation", "wald", "#3f6b2c"), "#3f6b2c");
const quelle = fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8");
assert.ok(!/#[0-9a-fA-F]{6}/.test(quelle), "im Modul steht KEIN Farbwert (AGENTS.md §12)");

// ---- E. Eine Uebersteuerung schlaegt die Vorgabe ----------------------------------------------
avesmapsEcosystemDisplayInstall({
	farbe: { wald: "#112233" },
	deckkraft: { "vegetation:wald": 0.4 },
	groesse: { wald: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
	vorgabe: { wald: { ab: 2, bis: 4, curveMax: 3, prio: 5 } },
});
assert.strictEqual(avesmapsEcosystemDisplayFarbe("wald", "#bfeec8"), "#112233");
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.4);
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 3), 5);
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 1), false, "vor dem Band unsichtbar");
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 3), true, "im Band sichtbar");
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 6), false, "hinter dem Band unsichtbar");

// ---- F. Die globale Deckkraft ueberschreibt, LOESCHT aber nicht --------------------------------
// 💣 Ein Haekchen ist keine Datenaenderung. Wer es abnimmt, bekommt seine Arbeit zurueck.
avesmapsEcosystemDisplayInstall({
	deckkraft: { "vegetation:wald": 0.15 },
	global: { vegetation: { an: true, wert: 0.9 } },
});
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.9, "global gewinnt");
avesmapsEcosystemDisplayInstall({
	deckkraft: { "vegetation:wald": 0.15 },
	global: { vegetation: { an: false, wert: 0.9 } },
});
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.15,
	"abgehakt kommt der Zeilenwert unveraendert zurueck");

// ---- G. „aus" -------------------------------------------------------------------------------
avesmapsEcosystemDisplayInstall({ vorgabe: { wald: { ab: 0, bis: -1 } } });
for (let z = 0; z <= 8; z += 1) {
	assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", z), false, `„aus" gilt auch auf z${z}`);
}

// ---- H. Kaputte Uebersteuerung faellt auf die Vorgabe zurueck ---------------------------------
// ⚠️ Die Karte darf an einem kaputten Einstellungswert nicht haengenbleiben.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);
avesmapsEcosystemDisplayInstall("unsinn");
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 5), 18);

console.log("ecosystem-display-vorgabe: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `node js/map-features/__tests__/ecosystem-display-vorgabe.test.js`
Erwartet: FEHLSCHLAG — die Datei fehlt.

- [x] **Schritt 3: Das Modul bauen**

Kopfkommentar nach dem Vorbild von `js/map-features/location-zoom-bands.js`, einschließlich der
Zeile „🔴 DIESE DATEI IST DIE EINZIGE QUELLE DER VORGABEWERTE".

`avesmapsEcosystemDisplayGroesse(subtype, zoom)` rechnet ohne Übersteuerung **die echte Formel**:

```javascript
// 🔴 DIE HEUTIGE KURVE, gerechnet statt abgeschrieben (getScaledLabelSize in
// map-features-labels.js), Grundgroesse 18. VISUAL_MAX_ZOOM_LEVEL = 5, dazu der Zuschlag ueber
// Zoom 5 vom 23.08.2026 („nach unten hin etwas groessere schriftart").
// ⚠️ Sie kann das heutige Bild NICHT Ziffer fuer Ziffer reproduzieren -- heute traegt JEDES Label
// seine eigene Grundgroesse (12-50, Vorgabe 18). Jedes Label, das nicht auf 18 steht, aendert sich
// sichtbar. Das ist der Preis dafuer, dass die Groesse global wird (Entwurf §5.5).
const AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_BASIS = 18;
const AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX = 5;
const AVESMAPS_ECOSYSTEM_DISPLAY_TIEF_SCHRITT = 0.08;
```

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: `node js/map-features/__tests__/ecosystem-display-vorgabe.test.js`
Erwartet: BESTANDEN.

- [x] **Schritt 5: Das Skript einhängen — und die Verdrahtung PRÜFEN**

In `index.html` **vor** `js/map-features/map-features-labels.js`, in
`html/landschaften-editor.html` vor dem Inline-Skript.

💣 **Ein grüner Test beweist nichts ohne Verdrahtung.** Also eine zweite Zusicherung, die die
Ladereihenfolge misst:

```javascript
const seite = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
const vorgabe = seite.indexOf("ecosystem-display.js");
const labels = seite.indexOf("map-features-labels.js");
assert.ok(vorgabe >= 0, "das Modul haengt in index.html");
assert.ok(vorgabe < labels, "und es laedt VOR map-features-labels.js -- sonst ist es dort undefined");
```

- [x] **Schritt 6: Committen**

```bash
git add js/map-features/ecosystem-display.js js/map-features/__tests__/ecosystem-display-vorgabe.test.js index.html html/landschaften-editor.html
git commit -m "feat(landschaften): das Vorgabemodul der Darstellung -- die einzige Quelle der Zahlen"
```

---

## Aufgabe 7: Die Karte liest Ton und Deckkraft aus dem Modul

**Unsichtbar — die Vorgaben reproduzieren das heutige Bild.**

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-rendering.js` (`ecosystemAreaColor`)
- Ändern: `js/map-features/map-features-ecosystem.js` bzw. der Ort, der die Pfade stylt
- Ändern: `css/features/ecosystem-layer.css`
- Ändern: `js/app/bootstrap.js` (die Tafel holen)
- Test: `js/map-features/__tests__/ecosystem-display-flaeche.test.js`

**Schnittstellen:**
- Verbraucht: `avesmapsEcosystemDisplayFlaechenTon`, `…Deckkraft`, `…Install` aus Aufgabe 6.

💣 **Die Deckkraft wandert von der PANE an die FLÄCHE.** Heute steht `--eco-fill` auf
`.ecosystem-pane--active`; künftig braucht jede Fläche ihren eigenen Wert. Die Zustandslogik der
Pane (ruhend = 0, Kontur nur im Bearbeiten-Modus, `--showall`) **bleibt unberührt** — nur der
aktive Füllwert kommt jetzt je Pfad.

```css
/* 🔴 Der aktive Fuellwert kommt seit 24.08.2026 je FLAECHE (--eco-fill-art, inline gesetzt), die
   Zustandslogik bleibt an der Pane. „Ruhend = unsichtbar" ist unangetastet: die Regel darueber
   setzt --eco-fill auf 0, und diese hier greift nur im aktiven Zustand.
   ⚠️ NICHT `opacity` auf der Pane -- die MULTIPLIZIERT sich mit der eigenen fill-opacity des
   Pfads, und aus „40 %" wuerden 40 % von etwas anderem. */
.ecosystem-pane--active > svg path.leaflet-interactive {
	fill-opacity: var(--eco-fill-art, var(--eco-fill));
}
```

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 Die Karte fragt das Modul, nicht mehr nur den Token. Ohne Uebersteuerung kommt derselbe Wert
// heraus wie heute -- das ist die Zusicherung, die „beim Ausliefern aendert sich nichts" traegt.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-flaeche.test.js

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" });

const rendering = fs.readFileSync(path.join(__dirname, "../map-features-ecosystem-rendering.js"), "utf8");

// ---- A. ecosystemAreaColor fragt die Uebersteuerung -------------------------------------------
assert.ok(/avesmapsEcosystemDisplayFlaechenTon/.test(rendering),
	"ecosystemAreaColor reicht den Token durch das Modul");
// 💣 Und der Token wird weiterhin GELESEN -- das Modul kennt keine Farbe (Entwurf §8).
assert.ok(/readEcosystemColorToken/.test(rendering), "der Token bleibt die Vorgabequelle");

// ---- B. Die Deckkraft steht als Variable an der Flaeche, nicht als zweite Zahlentafel ----------
const css = fs.readFileSync(path.join(__dirname, "../../../css/features/ecosystem-layer.css"), "utf8");
assert.ok(/--eco-fill-art/.test(css), "die Flaeche traegt ihren eigenen Fuellwert");
// 🔴 „Ruhend = unsichtbar" ist unangetastet.
assert.ok(/\.ecosystem-pane \{[^}]*--eco-fill:\s*0/.test(css.replace(/\s+/g, " ").replace(/ \{/g, " {")),
	"die ruhende Pane steht weiter auf 0");

// ---- C. Ohne Uebersteuerung ist der Wert der heutige ------------------------------------------
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("derographisch", "region"), 0.16);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);

console.log("ecosystem-display-flaeche: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `node js/map-features/__tests__/ecosystem-display-flaeche.test.js`
Erwartet: FEHLSCHLAG bei „ecosystemAreaColor reicht den Token durch das Modul".

- [x] **Schritt 3: Umbauen**

`ecosystemAreaColor(kind, regionType)` behält seine Tokenlogik und gibt das Ergebnis durch
`avesmapsEcosystemDisplayFlaechenTon(kind, regionType, ton)`.

Beim Bauen jeder Fläche `style.setProperty("--eco-fill-art", avesmapsEcosystemDisplayDeckkraft(kind, typeKey))`.

In `js/app/bootstrap.js` die Tafel holen und einsetzen, **bevor** die Ebenen gebaut werden:

```javascript
// ⚠️ Faellt OFFEN aus: kein Netz, kein Endpunkt, kaputtes JSON -> die Vorgaben gelten, und die
// Karte zeichnet wie bisher. Ein Ausfall hier darf sie nicht aufhalten.
fetch("/api/app/ecosystem-display.php", { credentials: "same-origin" })
	.then((r) => (r.ok ? r.json() : null))
	.then((d) => { avesmapsEcosystemDisplayInstall(d && d.display); })
	.catch(() => { avesmapsEcosystemDisplayInstall(null); });
```

- [x] **Schritt 4: Lauf zur Bestätigung**

Lauf: `node js/map-features/__tests__/ecosystem-display-flaeche.test.js`
Erwartet: BESTANDEN.

- [x] **Schritt 5: Am Bild abnehmen**

🔴 Nicht am Zahlenblatt. Vorschauserver starten, Karte öffnen, die vier Landschaftsebenen
durchschalten und **hinsehen**: sieht jede Ebene aus wie vorher? Ein Screenshot je Ebene vor und
nach dem Umbau.

- [x] **Schritt 6: Committen**

```bash
git add js/map-features/map-features-ecosystem-rendering.js css/features/ecosystem-layer.css js/app/bootstrap.js js/map-features/__tests__/ecosystem-display-flaeche.test.js
git commit -m "feat(landschaften): Ton und Deckkraft der Flaechen kommen aus der Darstellungstafel"
```

---

## Aufgabe 8: Die Karte liest die Namensfarbe aus dem Modul

**Unsichtbar — die Vorgabe ist der heutige Token.**

**Dateien:**
- Ändern: `js/map-features/map-features-labels.js` (`getMapLabelTypeStyle`)
- Test: `js/map-features/__tests__/ecosystem-display-namensfarbe.test.js`

💣 **Der Stil-Zwischenspeicher muss mit.** `_mapLabelTypeStyleCache` merkt sich je Labeltyp Farbe
und Schreibung; ohne Leeren wirkt eine geänderte Farbe erst nach einem Neuladen. Dazu kommt der
**Bild**-Zwischenspeicher (`_mapLabelImageCache`), dessen Schlüssel `typeStyle.color` bereits
enthält — der ist also von selbst richtig.

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 Die Namensfarbe kommt aus dem Modul, ihre VORGABE weiter aus map-labels.css (Entwurf §8).
// 💣 Und der Typ-Zwischenspeicher muss geleert werden koennen -- sonst wirkt eine Aenderung erst
// nach einem Neuladen, und das sieht aus wie „Speichern tut nichts".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-namensfarbe.test.js

const quelle = fs.readFileSync(path.join(__dirname, "../map-features-labels.js"), "utf8");

assert.ok(/avesmapsEcosystemDisplayFarbe/.test(quelle), "getMapLabelTypeStyle fragt das Modul");
// Die Sonde bleibt: sie liest die Vorgabe aus dem echten CSS.
assert.ok(/getComputedStyle\(span\)/.test(quelle), "die CSS-Sonde bleibt die Vorgabequelle");

// 💣 Ein Leerer fuer den Typ-Zwischenspeicher existiert und ist aufrufbar.
assert.ok(/function\s+avesmapsLeereLabelTypStil/.test(quelle),
	"es gibt einen Leerer fuer _mapLabelTypeStyleCache");

// 🪤 Der Bild-Zwischenspeicher braucht KEINEN eigenen Leerer -- sein Schluessel enthaelt
// typeStyle.color schon. Diese Zusicherung haelt das fest, damit niemand einen zweiten baut.
assert.ok(/cacheKey = `\$\{displayText\}\|\$\{font\}\|\$\{typeStyle\.color\}/.test(quelle),
	"der Bildschluessel enthaelt die Farbe und heilt sich damit selbst");

console.log("ecosystem-display-namensfarbe: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe**

Lauf: `node js/map-features/__tests__/ecosystem-display-namensfarbe.test.js`
Erwartet: FEHLSCHLAG bei „getMapLabelTypeStyle fragt das Modul".

- [x] **Schritt 3: Umbauen**

In `getMapLabelTypeStyle`: nach dem Auslesen der Sonde
`style.color = avesmapsEcosystemDisplayFarbe(labelType, computed.color || "#f5f0d6")`.
Dazu `avesmapsLeereLabelTypStil()`, die `_mapLabelTypeStyleCache = {}` setzt.

- [x] **Schritt 4: Lauf zur Bestätigung** — BESTANDEN.

- [x] **Schritt 5: Committen**

```bash
git add js/map-features/map-features-labels.js js/map-features/__tests__/ecosystem-display-namensfarbe.test.js
git commit -m "feat(landschaften): die Namensfarbe kommt aus der Darstellungstafel"
```

---

## Aufgabe 9: Schriftgröße und Zoomband wirken

**🔴 SICHTBAR FÜR JEDEN BESUCHER — eigener Push, eigener Blick des Owners.**

**Dateien:**
- Ändern: `js/map-features/map-features-labels.js` (`getScaledLabelSize`, `shouldShowLabelMarker`)
- Test: `js/map-features/__tests__/ecosystem-display-groesse.test.js`

⚠️ **Hier ändern sich alle Beschriftungen auf einmal.** Jedes Label, das nicht auf Grundgröße 18
steht, wird anders groß. Das ist gewollt (Entwurf §5.5) — aber es ist **die** Änderung, die der
Owner sehen muss, bevor irgendetwas anderes geht.

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 Die Groesse kommt aus der Tafel, nicht mehr vom Label. Und das Zoomband entscheidet, ob ein
// Name ueberhaupt gezeichnet wird.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-groesse.test.js

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" });

const quelle = fs.readFileSync(path.join(__dirname, "../map-features-labels.js"), "utf8");

// ---- A. getScaledLabelSize fragt die Tafel, nicht label.size ---------------------------------
const von = quelle.indexOf("function getScaledLabelSize(");
const bis = quelle.indexOf("\n}", von);
const rumpf = quelle.slice(von, bis + 2);
assert.ok(/avesmapsEcosystemDisplayGroesse/.test(rumpf), "die Groesse kommt aus der Tafel");
assert.ok(!/label\.size/.test(rumpf), "und NICHT mehr aus label.size");

// ---- B. Das Band entscheidet ueber die Sichtbarkeit -------------------------------------------
const vonS = quelle.indexOf("function shouldShowLabelMarker(");
const bisS = quelle.indexOf("\n}", vonS);
assert.ok(/avesmapsEcosystemDisplaySichtbar/.test(quelle.slice(vonS, bisS + 2)),
	"shouldShowLabelMarker fragt das Band");

// ---- C. Ohne Uebersteuerung ist ein Label mit Grundgroesse 18 unveraendert --------------------
avesmapsEcosystemDisplayInstall(null);
assert.deepStrictEqual(
	[0, 1, 2, 3, 4, 5, 6, 7].map((z) => avesmapsEcosystemDisplayGroesse("wald", z)),
	[9, 11, 13, 14, 16, 18, 19, 21],
	"die Vorgabe ist die heutige Kurve bei Grundgroesse 18"
);

// ---- D. 💣 DAS FELD `size` BLEIBT IM FORMULAR, als hidden ------------------------------------
// Der Payload liest formData.get("size"); OHNE das Feld schriebe jedes Speichern eine 0 ueber den
// gemerkten Wert. Genau dieselbe Falle steht zwei Zeilen darueber schon fuer `rotation`.
const seite = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
assert.ok(/id="label-edit-size"[^>]*type="hidden"/.test(seite),
	"das Groessenfeld steht als hidden im Formular");
assert.ok(!/id="label-edit-size-range"/.test(seite), "der Regler dazu ist weg");

console.log("ecosystem-display-groesse: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe** — FEHLSCHLAG bei „die Groesse kommt aus der Tafel".

- [x] **Schritt 3: Umbauen**

```javascript
function getScaledLabelSize(label) {
	// 🔴 Die Groesse steht seit 24.08.2026 in der Darstellungstafel, je Art und Zoomstufe
	// (Entwurf §5.5). `label.size` wird nicht mehr gelesen -- der Wert bleibt aber GESPEICHERT
	// (hidden im Formular), als einziger Rueckweg, falls die Sache je zurueckgebaut wird.
	return avesmapsEcosystemDisplayGroesse(label.labelType, map.getZoom());
}
```

Für das Band gilt die **umgekehrte** Regel — und das ist die feinste, tragendste Unterscheidung des
ganzen Umbaus:

```javascript
// 🔴 GROESSE: die Tafel GILT. Der eigene Wert des Labels wird nicht mehr gelesen.
// 🔴 BAND: die Tafel RAET. Der eigene Wert des Labels gewinnt; die Tafel greift nur, wo das Label
//    keinen traegt (Entwurf §6). Weil heute JEDES Label min_zoom/max_zoom traegt, aendert sich an
//    der Sichtbarkeit vorerst NICHTS -- gewollt: der Editor behaelt seine Entscheidung, und die
//    Tafel wird ihm in Aufgabe 15 als Marke gezeigt.
// 💣 Wer beides gleich behandelt, nimmt den Editoren entweder ihre Baender weg (Tafel gilt) oder
//    laesst die Groesse wirkungslos (Tafel raet). Beides ist genau falsch herum.
const ab = Number.isFinite(entry.label.minZoom) ? entry.label.minZoom : null;
const bis = Number.isFinite(entry.label.maxZoom) ? entry.label.maxZoom : null;
const imBand = (ab === null || bis === null)
	? avesmapsEcosystemDisplaySichtbar(entry.label.labelType, bandZoom)
	: (bandZoom >= ab && bandZoom <= bis);
```

- [x] **Schritt 4: Lauf zur Bestätigung** — BESTANDEN.

- [x] **Schritt 5: Ganzes Testfeld + Abnahme am Bild**

Beide Testläufe aus „Globale Zusicherungen". Dann die Karte öffnen und **hinsehen**: Zoom 2 bis 7
durchfahren, Landschaftsnamen ansehen. Screenshots.

- [x] **Schritt 6: Committen, pushen, Deploy abwarten, Owner fragen**

```bash
git add js/map-features/map-features-labels.js index.html js/map-features/__tests__/ecosystem-display-groesse.test.js
git commit -m "feat(landschaften): die Schriftgroesse der Landschaftsnamen kommt global aus der Tafel"
```

🔴 Danach **halten** und den Owner sehen lassen (AGENTS.md §9).

---

## Aufgabe 10: Das Fenster — Hülle, Reiter, Tabelle

**Sichtbar nur im Editor.**

**Dateien:**
- Ändern: `html/landschaften-editor.html` (Kachel `#ecoDisplay`, Fenster, Inline-Skript)
- Ändern: `css/pages/landschaften-editor.css`
- Test: `js/pages/__tests__/darstellung-fenster.test.js`

**Schnittstellen:**
- Verbraucht: `POST /api/edit/map/ecosystem-display.php` (Aufgabe 5), das Modul (Aufgabe 6).

⭐ **Das Markup und die Zeichner stehen fertig im Prototyp** `docs/landschaften-darstellung-mockup.html`.
Übernommen werden: `.dg-tabs`, `.dt` (Tabelle), `.fl-global`, `.zb` (Bandtabelle), `.ed-*`
(Editor-Ausschnitt), `.kf-grid`. **Nicht** übernommen wird das Prototyp-Skript als Ganzes — es hat
keine Endpunkte und keine Rechte.

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-fenster.test.js
const editor = fs.readFileSync(path.join(__dirname, "../../../html/landschaften-editor.html"), "utf8");

// ---- A. Die siebte Kachel ---------------------------------------------------------------------
assert.ok(/id="ecoDisplay"/.test(editor), "die Kachel „Darstellung“ steht im Menueband");
assert.ok(/>Darstellung</.test(editor), "und traegt das Wort");
// ⚠️ Zwei Kacheln heissen jetzt so. Der title MUSS es aussprechen.
const kachel = editor.match(/id="ecoDisplay"[^>]*title="([^"]*)"/);
assert.ok(kachel && /Landschaft/i.test(kachel[1]), "der title sagt, dass es um Landschaften geht");

// ---- B. Vier Reiter ---------------------------------------------------------------------------
["Derographie", "Vegetation", "Topographie", "Klimazonen"].forEach((r) => {
	assert.ok(editor.includes(r), `der Reiter „${r}“ ist da`);
});

// ---- C. EINE Tabelle fuer Flaeche UND Name (Owner 23.08.2026) ---------------------------------
assert.ok(/id="edFlRows"/.test(editor), "die gemeinsame Tabelle hat einen Rumpf");
assert.ok(!/id="edFcRows"/.test(editor), "und es gibt KEINE zweite Liste fuer die Namensfarben");

// ---- D. Der Riegel steht auch im Fenster -------------------------------------------------------
assert.ok(/can_save/.test(editor), "das Fenster liest can_save und sperrt fuer Editoren");

// ---- E. 🔴 Klimazonen haben ihren eigenen Zuschnitt (Entwurf §5.7) -----------------------------
// Klimabaender tragen keine map_features-Beschriftung. Also entfallen dort Zoomband/Groesse, der
// Editor-Ausschnitt, die Vorschau und die Kurvenfeinheiten. Ein Abschnitt, der auf jeder Ebene
// steht und auf einer nichts bedeutet, ist keine Vollstaendigkeit, sondern eine Falle.
["edSecSize", "edSecEditor", "edSecVorschau", "edSecKurven"].forEach((id) => {
	assert.ok(new RegExp(`id="${id}"`).test(editor), `der Abschnitt ${id} ist benannt und damit ausblendbar`);
});
assert.ok(/zeigeAbschnitte/.test(editor), "es gibt eine Stelle, die sie je Reiter ein- und ausblendet");
// ⚠️ Die TABELLE behaelt ihre Namensspalten (sie zeigen dort „— Ton der Zone —"). Wer sie wegnimmt,
// baut eine zweite Tabellenform fuer einen Reiter -- die Divergenz, die §5.1 gerade beseitigt hat.
assert.ok(/Ton der Zone/.test(editor), "die Namensspalten bleiben und erklaeren sich");

// ---- F. Die Luecken zwischen den zwei Vokabularen stehen als Text da --------------------------
// 💣 Flaechenarten (33) und Namensarten (31) decken sich NICHT: `insel` hat keine Namenszeile in
// der Topographie, `fluss`/`berggipfel`/`vulkan`/`ebene` haben keine Flaechenart.
assert.ok(/keine Flaechenart|keine Fl&auml;chenart/.test(editor), "„— keine Flaechenart —“ ist vorgesehen");
assert.ok(/kein eigener Name/.test(editor), "„— kein eigener Name —“ ebenso");

console.log("darstellung-fenster: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe** — FEHLSCHLAG.

- [x] **Schritt 3: Bauen**

Kachel `#ecoDisplay` **ganz rechts** ins Menüband (siebte). Fenster als `.modal` mit
`.modal-box wide`, Reiter, die Tabelle aus §5.1 des Entwurfs, `get` beim Öffnen,
`save`/`reset` unten. Bei `can_save === false`: alle Bedienelemente `disabled`, statt „Speichern"
ein Hinweis.

Die vier Abschnitte bekommen Kennungen (`edSecSize`, `edSecEditor`, `edSecVorschau`, `edSecKurven`)
und eine Stelle, die sie je Reiter schaltet:

```javascript
// 🔴 KLIMAZONEN TRAGEN KEINE EIGENE BESCHRIFTUNG (Entwurf §5.7) -- also faellt alles weg, was an
// einem Namen haengt. Uebrig bleibt Ton und Deckkraft der acht Baender.
// ⚠️ Die Kurvenfeinheiten gelten weiter fuer ALLE Ebenen; sie sind hier nur nicht erreichbar,
// nicht abgeschaltet. Erreichbar bleiben sie ueber die drei anderen Reiter.
function zeigeAbschnitte(reiter) {
	const ohneNamen = NAMENSARTEN[reiter].length === 0;
	["edSecSize", "edSecEditor", "edSecVorschau", "edSecKurven"].forEach((id) => {
		$(id).hidden = ohneNamen;
	});
	// Die Ueberschrift zieht mit -- „und Namen" verspraeche sonst eine Spalte, die dort „—" ist.
	$("edFlTitel").textContent = ohneNamen
		? "Flächen — Ton und Deckkraft"
		: "Flächen und Namen — Ton, Deckkraft, Schriftfarbe";
}
```

💣 **`ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen** — nein, hier nicht:
`landschaften-editor.html` wird über `?v=Date.now()` geholt (`review-ecosystem-list.js`), nicht über
den Stempellauf. Die geänderten **CSS**-Dateien erreicht der Stempellauf; nichts von Hand.

- [x] **Schritt 4: Lauf zur Bestätigung** — BESTANDEN.

- [x] **Schritt 5: Committen**

```bash
git add html/landschaften-editor.html css/pages/landschaften-editor.css js/pages/__tests__/darstellung-fenster.test.js
git commit -m "feat(landschaften): das Fenster „Darstellung" -- Huelle, Reiter, gemeinsame Tabelle"
```

---

## Aufgabe 11: Die globale Deckkraft

**Dateien:** `html/landschaften-editor.html`, Test `js/pages/__tests__/darstellung-global.test.js`

- [x] **Schritt 1: Test** — die drei Zusicherungen aus dem Prototyp, in reiner Form:

```javascript
const assert = require("assert");
// Die reine Regel, aus dem Fenster geschnitten: der globale Wert UEBERSCHREIBT, er LOESCHT NICHT.
// 💣 Ein Haekchen ist keine Datenaenderung. Am Prototyp nachgemessen: Zeile auf 15 %, global an,
// global aus -> die 15 % steht noch da.
const wirksameDeckkraft = (zeile, global, vorgabe) =>
	(global && global.an) ? global.wert : (zeile === undefined ? vorgabe : zeile);

assert.strictEqual(wirksameDeckkraft(undefined, undefined, 0.72), 0.72, "ohne alles gilt die Vorgabe");
assert.strictEqual(wirksameDeckkraft(0.15, { an: true, wert: 0.9 }, 0.72), 0.9, "global gewinnt");
assert.strictEqual(wirksameDeckkraft(0.15, { an: false, wert: 0.9 }, 0.72), 0.15,
	"abgehakt kommt der Zeilenwert UNVERAENDERT zurueck");
// 🔴 „Global" heisst FUER DIESE EBENE. Die vier Vorgaben sagen Verschiedenes (0,16/0,72/0,72/0,30);
// eine Zahl ueber alle vier zoege sie zusammen.
assert.strictEqual(wirksameDeckkraft(undefined, undefined, 0.16), 0.16, "Derographie bleibt bei 0,16");
console.log("darstellung-global: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf** — FEHLSCHLAG (Datei fehlt) → anlegen → BESTANDEN.
- [x] **Schritt 3: Die Leiste bauen** — Häkchen **anfangs an**, mit dem Wert der Ebene; die
  Zeilenregler werden `disabled` und behalten ihren Wert.
- [x] **Schritt 4: Am Ablauf abnehmen** — anhaken, abhaken, Wert prüfen.
- [x] **Schritt 5: Committen** — `feat(landschaften): eine Deckkraft fuer die ganze Ebene`

---

## Aufgabe 12: Die Bandtabelle und der Median

**Dateien:** `html/landschaften-editor.html`, Test `js/pages/__tests__/darstellung-band.test.js`

- [x] **Schritt 1: Test — die „näheres Ende"-Regel**

```javascript
const assert = require("assert");
// 🔴 EIN Klick, ZWEI Enden. Bei den Siedlungen setzt ein Klick die eine Erscheinungsstufe; eine
// Landschaftsbeschriftung hat min_zoom UND max_zoom -- ein Kontinentname soll beim Hineinzoomen
// VERSCHWINDEN. Deshalb: das naehere Ende wandert.
function bandKlick(band, z) {
	const v = { ...band };
	if (v.bis < v.ab) { return { ab: z, bis: z }; }        // war „aus"
	if (z < v.ab) { return { ab: z, bis: v.bis }; }
	if (z > v.bis) { return { ab: v.ab, bis: z }; }
	// ⚠️ Bei Gleichstand gewinnt „ab" -- eine Regel muss auch in der Mitte entscheiden, sonst
	// haengt das Ergebnis an Rundung.
	return (z - v.ab) <= (v.bis - z) ? { ab: z, bis: v.bis } : { ab: v.ab, bis: z };
}

assert.deepStrictEqual(bandKlick({ ab: 0, bis: 7 }, 5), { ab: 0, bis: 5 }, "z5: bis ist naeher (2 < 5)");
assert.deepStrictEqual(bandKlick({ ab: 0, bis: 5 }, 2), { ab: 2, bis: 5 }, "z2: ab ist naeher (2 < 3)");
assert.deepStrictEqual(bandKlick({ ab: 2, bis: 5 }, 0), { ab: 0, bis: 5 }, "links davon zieht ab");
assert.deepStrictEqual(bandKlick({ ab: 2, bis: 5 }, 7), { ab: 2, bis: 7 }, "rechts davon zieht bis");
assert.deepStrictEqual(bandKlick({ ab: 0, bis: -1 }, 4), { ab: 4, bis: 4 }, "aus dem Aus-Zustand: eine Stufe");
assert.deepStrictEqual(bandKlick({ ab: 2, bis: 6 }, 4), { ab: 4, bis: 6 }, "Gleichstand: ab gewinnt");
console.log("darstellung-band: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf** — FEHLSCHLAG → anlegen → BESTANDEN.
- [x] **Schritt 3: Die Tabelle bauen**

💣 **Echte `<table>` mit `table-layout: fixed`.** Als Grid je Zeile richten sich die Stufen nicht
aneinander aus — jede Zeile rechnet ihre Breiten selbst, und weil „Fluss" kürzer ist als
„Flussland/Flusstal", steht z3 der einen über z4 der anderen.
💣 **Eine Zeile ohne „übernehmen"-Knopf braucht eine LEERE Zelle**, sonst rutscht alles rechts davon
um eine Spalte.

Knöpfe je Zeile: `z0 … z7`, `aus`, **„Median ermitteln"**, nach dem Messen **„übernehmen"**, `↺`.

🔴 **Zwei Verben, zwei Knöpfe.** Messen schreibt nichts.

- [x] **Schritt 4: Ausrichtung messen** — alle Zeilen gleich viele Zellen, alle Stufenspalten gleich
  breit, auch mit genau einer Zeile im „übernehmen"-Zustand.
- [x] **Schritt 5: Committen** — `feat(landschaften): das Zoomband je Art, mit Median`

---

## Aufgabe 13: Der Größenplot

**Dateien:** `html/landschaften-editor.html`, Test `js/pages/__tests__/darstellung-plot.test.js`

- [x] **Schritt 1: Test — Auswahl schaltet das Ziehen frei**

```javascript
const assert = require("assert");
// 💣 In der Vorgabestellung sind ALLE Kurven deckungsgleich -- zwoelf Punkte konkurrieren um
// denselben Klick, und man muesste „erst alle darueberliegenden wegschaufeln" (Owner 24.08.2026).
// Die Loesung ist kein groesserer Klickradius, sondern ein Riegel.
const anfassbar = (arten, gewaehlt) => arten.filter((a) => !gewaehlt || a === gewaehlt).length;
const ARTEN = ["wald", "steppe", "tundra", "wueste"];
assert.strictEqual(anfassbar(ARTEN, null), 4, "ohne Auswahl ist alles anfassbar");
assert.strictEqual(anfassbar(ARTEN, "tundra"), 1, "mit Auswahl nur noch die eine");

// 🪤 Und die Namen am Rand duerfen nicht aufeinanderliegen: bei gleichen Werten faechert der
// Loeser sie auf. Ein Diagramm, dessen Beschriftung genau dann versagt, wenn noch niemand etwas
// verstellt hat, versagt beim ersten Blick.
function faechere(ziele, abstand) {
	const s = ziele.map((y, i) => ({ i, y })).sort((a, b) => a.y - b.y);
	let letzte = -Infinity;
	s.forEach((e) => { e.y = Math.max(e.y, letzte + abstand); letzte = e.y; });
	return s.map((e) => e.y);
}
const gleich = faechere([100, 100, 100, 100], 13);
gleich.forEach((y, i) => { if (i) { assert.ok(y - gleich[i - 1] >= 13, "kein Ueberlapp"); } });
console.log("darstellung-plot: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf** — FEHLSCHLAG → anlegen → BESTANDEN.
- [x] **Schritt 3: Den Plot bauen** — aus dem Prototyp: ziehbare Punkte, Auswahl-Riegel,
  aufgefächerte Namen mit Anschlusslinien, `← →` für die Zoomstufe, `↑ ↓` für den Wert. Die Kurve
  läuft **nur durch ihr Band**.
- [x] **Schritt 4: Am Ablauf abnehmen** — Art wählen, Punkt ziehen, Band beschneiden.
- [x] **Schritt 5: Committen** — `feat(landschaften): der Groessenplot je Art und Zoomstufe`

---

## Aufgabe 14: Die Kurvenfeinheiten samt Vorschau

**Dateien:** `html/landschaften-editor.html`, Test `js/pages/__tests__/darstellung-kurvenwerte.test.js`

- [x] **Schritt 1: Test**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 Die zwoelf Vorgaben werden AUS DEM PRODUKTIONSMODUL gelesen, nicht abgeschrieben. Eine zweite
// Tabelle waere genau die Divergenz, gegen die dieser ganze Umbau argumentiert.
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../../map-features/curved-label-layout.js"), "utf8"),
	{ filename: "curved-label-layout.js" });
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../../map-features/curve-label-fit.js"), "utf8"),
	{ filename: "curve-label-fit.js" });

assert.strictEqual(typeof AVESMAPS_CURVE_LABEL_DEFAULTS, "object", "die Tafel ist da");
assert.strictEqual(AVESMAPS_CURVE_LABEL_DEFAULTS.maxTurnDeg, 30);
assert.strictEqual(AVESMAPS_CURVE_LABEL_DEFAULTS.trackingPct, 20);

const fenster = fs.readFileSync(path.join(__dirname, "../../../html/landschaften-editor.html"), "utf8");
assert.ok(/AVESMAPS_CURVE_LABEL_DEFAULTS/.test(fenster), "das Fenster liest die echte Tafel");
// 💣 Und schreibt KEINE der zwoelf Zahlen selbst ab.
assert.ok(!/trackingMaxPerGapEm:\s*0\.6/.test(fenster), "keine abgeschriebene Vorgabe im Fenster");
console.log("darstellung-kurvenwerte: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf** — FEHLSCHLAG → anlegen → BESTANDEN.
- [x] **Schritt 3: Bauen** — die zwölf Bedienelemente plus die Vorschau (Auswahlfeld mit den drei
  Gebirgen und drei Wäldern). 🔴 Die Vorschau ruft die **Produktionsmodule**, nicht
  `docs/kurvenlabel-pipeline.js` — die ist der Prototyp.
  ⚠️ Zwei der zwölf wirken in der Vorschau nicht sichtbar (Mindestabstand, Ausweichweg); das sagt
  die Erklärzeile ausdrücklich.
- [x] **Schritt 4: Ablauf abnehmen** — jeden Regler bewegen, sehen, dass die Kurve sich ändert.
- [x] **Schritt 5: Committen** — `feat(landschaften): die zwoelf Kurvenfeinheiten samt Vorschau`

---

## Aufgabe 15: Die Vorgabemarken im Beschriftungsdialog

**🔴 Sichtbar für Editoren. Eigener Push.**

**Dateien:**
- Ändern: `index.html` (Größe raus, Marken rein)
- Ändern: `js/review/review-labels.js`
- Ändern: `css/components/location-report-dialog.css`
- Test: `js/review/__tests__/label-vorgabemarke.test.js`

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 Der Editor sieht EINE Marke, und die kommt aus der Zoombandeinstellung (Owner 24.08.2026).
// 💣 Der Median erreicht ihn NIE -- er ist unser Werkzeug. Eine zweite Marke hiesse „richte dich
// nach dem Durchschnitt", und das ist das Gegenteil einer Vorgabe.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/label-vorgabemarke.test.js

const seite = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
const skript = fs.readFileSync(path.join(__dirname, "../review-labels.js"), "utf8");

// ---- A. Die Marke ist da, fuer die vier Felder ------------------------------------------------
["curve-max", "min-zoom", "max-zoom", "priority"].forEach((feld) => {
	assert.ok(new RegExp(`label-edit-${feld}-marke`).test(seite),
		`das Feld ${feld} traegt eine Vorgabemarke`);
});

// ---- B. 💣 KEINE Median-Marke ------------------------------------------------------------------
assert.ok(!/median/i.test(seite.slice(seite.indexOf("label-edit-section"), seite.indexOf("label-edit-section") + 4000)),
	"im Beschriftungsdialog steht nirgends „Median“");

// ---- C. 💣 Die Umrechnung beruecksichtigt die Knopfbreite -------------------------------------
// Ohne die Korrektur steht die Marke an BEIDEN Enden sichtbar daneben -- und an den Enden liegen
// die interessanten Werte (z0, z7).
assert.ok(/100% - |knopf|thumb/i.test(skript),
	"die Position rechnet mit der Knopfbreite, nicht mit reinem Prozent");

// ---- D. Das Groessenfeld ist ein hidden geworden ----------------------------------------------
assert.ok(/id="label-edit-size"[^>]*type="hidden"/.test(seite), "Groesse ist hidden");
assert.ok(!/aria-label="Groesse"/.test(seite), "und hat kein Bedienelement mehr");

console.log("label-vorgabemarke: alle Zusicherungen gruen");
```

- [x] **Schritt 2: Lauf zur Gegenprobe** — FEHLSCHLAG.

- [x] **Schritt 3: Bauen**

Das Feld `label-edit-size` wird `type="hidden"`, `label-edit-size-range` und sein `<label>` fallen.
Jeder der vier Regler bekommt eine Hülle mit einer Marke:

```css
/* 💣 Die Marke sitzt UNTER dem Balken. Auf dem Balken verdeckt der Reglerknopf sie genau dann,
   wenn Wert und Vorgabe uebereinstimmen -- also im haeufigsten Fall. */
.label-edit-marke {
	position: absolute;
	bottom: 0;
	border-right: 4px solid transparent;
	border-bottom: 6px solid var(--color-accent-brown);
	border-left: 4px solid transparent;
	transform: translateX(-4px);
}
```

```javascript
// 💣 NICHT `pct` der Breite. Der Knopf hat eine Breite, sein Mittelpunkt wandert nur ueber
// (100% - Knopfbreite). Ohne die Korrektur steht die Marke an beiden Enden daneben -- und an den
// Enden liegen die interessanten Werte (z0, z7).
function vorgabeMarkePosition(wert, min, max) {
	const anteil = max === min ? 0 : (wert - min) / (max - min);
	return `calc(${anteil * 100}% + ${8 - anteil * 16}px)`;
}
```

Die Vorgaben holt der Dialog über `avesmapsEcosystemDisplayVorgabe(subtype)`; wechselt die **Art**
im Dialog, wandern die Marken mit.

- [x] **Schritt 4: Lauf zur Bestätigung** — BESTANDEN.

- [x] **Schritt 5: Am Ablauf abnehmen**

Ein Label öffnen, die Art wechseln, sehen, dass die Marke springt. **Und:** ein Label speichern,
das nie angefasst wurde, danach nachsehen, ob seine gespeicherte `size` noch da ist (§5.5).

- [x] **Schritt 6: Ganzes Testfeld, committen, pushen, halten**

```bash
git add index.html js/review/review-labels.js css/components/location-report-dialog.css js/review/__tests__/label-vorgabemarke.test.js
git commit -m "feat(landschaften): die Vorgabe steht als Marke auf den Reglern des Beschriftungsdialogs"
```

---

## Nach dem Bauen

- [x] **Die Abnahme aus Entwurf §10** — zehn echte Handgriffe, hell UND dunkel.
- [x] **`docs/refactoring-masterplan.md`** und der Kurvenbeschriftungs-Entwurf: Plan 4 als erledigt
  vermerken.
- [x] ⚠️ **Das Handbuch NICHT anfassen.** `html/editor-handbuch.html` gehört der nächtlichen Routine
  (AGENTS.md §9). Die Pflicht hier ist ein Commit-Betreff, der die sichtbare Wirkung nennt — das tun
  die Betreffs oben.
- [ ] 🔧 **Die Medianwerte einmal wirklich messen** und mit dem Owner Art für Art durchgehen
  (Entwurf §11).

### Was am 24.08.2026 NICHT abgenommen werden konnte

⚠️ Ehrlich benannt statt als bestanden verbucht (AGENTS.md §9):

- **Der Median ist nie gegen die echte Datenbank gelaufen.** Der Messweg steht und ist mit einer
  Fixture geprüft (`kurven-baselines-lesen-test.php`, `ecosystem-display-test.php`), aber die Zahlen
  aus den rund 900 Beschriftungen hat noch niemand gesehen. Bis dahin darf niemand sie für gemessen
  halten -- und die Runde, in der der Owner sie Art für Art ansieht, steht aus.
- **Kein Handgriff lief mit angemeldeter Sitzung.** Alle Abläufe im Browser liefen gegen gestellte
  Antworten (`?demo=1` plus fetch-Attrappe): das Fenster, die Bandtabelle, der Plot, die
  Kurvenvorschau, die Vorgabemarken. Was dabei NICHT geprüft ist: der Rechteriegel gegen echte
  Rollen, das Schreiben in `app_setting` samt Rückleseprobe, und ob der Endpunkt `baselines` gegen
  MySQL dieselbe Form liefert wie gegen die Fixture.
- **Die Kurvenvorschau lief nur auf einer gestellten Kurve.** Eine echte Beschriftungskurve aus dem
  Zwischenspeicher hat sie noch nie gezeichnet -- die Demo-Daten des Editors tragen keine.
- **`maxTurnDeg` war an der Demokurve nicht sichtbar** (zu flach). Dass er wirkt, ist an einer
  gebogenen Linie in node belegt, nicht im Fenster gesehen.
