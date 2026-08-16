# Lizenzangaben Phase 1 (Fundament) — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Checkboxen (`- [ ]`).

**Entwurf:** `docs/superpowers/specs/2026-08-16-lizenzangaben-vereinheitlichung-design.md` (§2, §4)

**Ziel:** Ein gemeinsamer Lizenzkatalog mit sieben Werten, seiner Normalisierung und seinem
Anzeige-Gate — je einmal in PHP und in JS, aneinandergebunden durch einen Paritätstest.

**Bauart:** Zwei neue Dateien und zwei neue Tests. **Kein bestehender Aufrufer wird angefasst**,
keine Tabelle geändert, kein Bild anders behandelt. Nach Phase 1 existiert der Katalog, benutzt
ihn aber noch niemand — das ist Absicht: die fünf Flächen wechseln erst in den Phasen 2–4, und
bis dahin muss jeder Zwischenstand deploybar sein.

**Technik:** PHP 8 (`declare(strict_types=1)`, kein Framework, keine DB in dieser Phase),
Vanilla-JS ohne Build-Schritt, Tests mit `assert()` bzw. Nodes `assert`.

## Globale Vorgaben

Gelten für **jede** Aufgabe dieses Plans:

- **Kommentare und Commit-Nachrichten auf Deutsch** (AGENTS §8). Die `error.code`-Maschinenwerte
  und die Katalog-Kennungen bleiben englisch und werden nie übersetzt.
- **Der Baum ist geteilt: niemals `git add -A`, `git add .` oder `git commit -a`** (AGENTS §9).
  Vor jedem Commit `git status`, und ausschließlich die selbst angefassten Pfade einzeln stagen.
  Fremde geänderte oder ungetrackte Dateien bleiben unberührt.
- **Vor dem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests — ein einziger roter Test
  lädt nichts hoch und vergiftet den `?v=`-Stempel (AGENTS §9). Die drei Läufe stehen in Aufgabe 3.
- **Kein `?v=` von Hand**, nirgends. Der Deploy stempelt alles, was von `index.html` oder
  `html/*.html` erreichbar ist.
- **Die sieben Kennungen und ihre Reihenfolge sind gesetzt** (Entwurf §2) und in beiden Dateien
  wortgleich:
  `unknown_other`, `public_domain`, `cc0`, `cc_by`, `permission_granted`, `ai_generated`, `own_work`.
  Öffentlich sind genau fünf davon — `cc_by` und `unknown_other` sind es **nicht**.
- **Zeilenenden:** die Dateien im Repo sind CRLF (`.gitattributes` setzt `text=auto`). Beim
  Bearbeiten bestehender Dateien einzeilige Edits bevorzugen; die beiden neuen Dateien sind
  davon nicht betroffen.

---

## Dateien dieser Phase

| Datei | Verantwortung |
|---|---|
| `api/_internal/media-license.php` | **neu** — Katalog, Beschriftungen, Normalisierung, Gate. Die eine Quelle für alle PHP-Leser. Keine DB, kein Bootstrap, keine Seiteneffekte auf oberster Ebene — damit jeder Endpunkt sie folgenlos `require_once`n kann. |
| `api/_internal/__tests__/media-license-test.php` | **neu** — sichert die Zusicherungen der Normalisierung, allen voran: ein unbekannter Wert wird nie öffentlich. |
| `js/app/media-licenses.js` | **neu** — derselbe Katalog für die vier Editorseiten, als Liste von Objekten (die Form, die ein `<select>` braucht). Exportiert unter dem Node-Guard, damit der Test sie laden kann. |
| `js/app/__tests__/media-licenses-parity.test.js` | **neu** — die Klammer: JS-Liste gegen PHP-Datei, Werte, Reihenfolge, Beschriftungen und die öffentliche Teilmenge. |

Warum die PHP-Datei auf der obersten Ebene von `_internal/` liegt und nicht unter `app/` oder
`wiki/`: sie wird von vier Bereichen gelesen (`api/app/`, `api/edit/wiki/`, `api/edit/map/`,
`api/_internal/wiki/`). `coat-url.php` liegt aus demselben Grund dort.

---

## Aufgabe 1: Der PHP-Katalog

**Dateien:**
- Neu: `api/_internal/media-license.php`
- Test: `api/_internal/__tests__/media-license-test.php`

**Schnittstellen:**
- Verbraucht: nichts (erste Aufgabe, keine Abhängigkeit).
- Liefert an spätere Aufgaben und Phasen:
  - `AVESMAPS_MEDIA_LICENSES` — `list<string>`, die sieben Kennungen in Anzeigereihenfolge
  - `AVESMAPS_MEDIA_LICENSES_PUBLIC` — `list<string>`, die fünf öffentlichen
  - `AVESMAPS_MEDIA_LICENSE_LABELS` — `array<string,string>`, Kennung → deutsche Beschriftung
  - `AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE` — `string`, der Vorschlagstext für „Genehmigung erteilt"
  - `avesmapsMediaLicenseNormalize(mixed $value, string $fallback = 'unknown_other'): string`
  - `avesmapsMediaLicenseIsPublic(mixed $value): bool`
  - `avesmapsMediaLicenseLabel(mixed $value): string`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `api/_internal/__tests__/media-license-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit-Test des gemeinsamen Lizenzkatalogs. Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 *
 * 💣 Die tragende Zusicherung steht im Abschnitt "unbekannt ist nie oeffentlich". Alles andere
 * hier waere Komfort; jene eine Zeile ist der rechtliche Riegel des ganzen Systems.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../media-license.php';

// ---- der Katalog selbst ---------------------------------------------------------------------------
// Die Reihenfolge IST die Anzeigereihenfolge des Auswahlfelds (Entwurf §2) und deshalb Teil des
// Vertrags, nicht bloss eine Schreibweise: der Paritaetstest auf der JS-Seite vergleicht sie Stelle
// fuer Stelle.
assert(AVESMAPS_MEDIA_LICENSES === [
    'unknown_other', 'public_domain', 'cc0', 'cc_by', 'permission_granted', 'ai_generated', 'own_work',
]);
assert(AVESMAPS_MEDIA_LICENSES_PUBLIC === [
    'public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work',
]);

// Jede Kennung hat genau eine Beschriftung, und keine Beschriftung steht ohne Kennung da.
assert(array_keys(AVESMAPS_MEDIA_LICENSE_LABELS) === AVESMAPS_MEDIA_LICENSES);
foreach (AVESMAPS_MEDIA_LICENSE_LABELS as $kennung => $beschriftung) {
    assert(trim($beschriftung) !== '', "Beschriftung fehlt fuer {$kennung}");
}

// Die oeffentliche Liste ist eine echte TEILMENGE -- ein Tippfehler dort waere sonst ein Wert, den
// niemand waehlen kann, der aber als oeffentlich gilt.
foreach (AVESMAPS_MEDIA_LICENSES_PUBLIC as $kennung) {
    assert(in_array($kennung, AVESMAPS_MEDIA_LICENSES, true), "{$kennung} steht nicht im Katalog");
}

// ---- Normalisierung -------------------------------------------------------------------------------
assert(avesmapsMediaLicenseNormalize('cc_by') === 'cc_by');
assert(avesmapsMediaLicenseNormalize('  cc0  ') === 'cc0');           // Randweiss (Spaltenwerte kommen roh)
assert(avesmapsMediaLicenseNormalize('') === 'unknown_other');
assert(avesmapsMediaLicenseNormalize(null) === 'unknown_other');
assert(avesmapsMediaLicenseNormalize(42) === 'unknown_other');        // kein String -> Vorgabe
assert(avesmapsMediaLicenseNormalize([]) === 'unknown_other');
assert(avesmapsMediaLicenseNormalize('CC0') === 'unknown_other');     // Kennungen sind kleingeschrieben
assert(avesmapsMediaLicenseNormalize('voellig_erfunden') === 'unknown_other');

// Jede Flaeche bringt ihre eigene Vorgabe mit (Entwurf §7): Karten unknown_other, Bilder und
// Siedlungs-Wappen ai_generated, Territoriums-Wappen public_domain, Cover permission_granted.
assert(avesmapsMediaLicenseNormalize('', 'ai_generated') === 'ai_generated');
assert(avesmapsMediaLicenseNormalize('quatsch', 'permission_granted') === 'permission_granted');
assert(avesmapsMediaLicenseNormalize('cc0', 'ai_generated') === 'cc0'); // gueltiger Wert schlaegt Vorgabe

// 💣 Auch die VORGABE wird normalisiert. Ein Aufrufer mit einem Tippfehler in seiner Vorgabe
// bekommt unknown_other, nicht seinen Tippfehler zurueckgereicht -- sonst wanderte ein
// Katalogfremder Wert ueber den Umweg der Vorgabe in die Datenbank.
assert(avesmapsMediaLicenseNormalize('', 'ai_generatd') === 'unknown_other');

// ---- unbekannt ist NIE oeffentlich ----------------------------------------------------------------
// 🔴 DIE tragende Zusicherung. avesmapsMediaLicenseIsPublic nimmt bewusst KEINE Vorgabe entgegen:
// duerfte ein Aufrufer hier 'ai_generated' als Rueckfall setzen, machte jeder unbekannte String das
// Bild oeffentlich -- genau die Umkehrung, vor der citymap-image.php:190-191 warnt.
assert(avesmapsMediaLicenseIsPublic('public_domain') === true);
assert(avesmapsMediaLicenseIsPublic('cc0') === true);
assert(avesmapsMediaLicenseIsPublic('permission_granted') === true);
assert(avesmapsMediaLicenseIsPublic('ai_generated') === true);
assert(avesmapsMediaLicenseIsPublic('own_work') === true);
assert(avesmapsMediaLicenseIsPublic('cc_by') === false);
assert(avesmapsMediaLicenseIsPublic('unknown_other') === false);
assert(avesmapsMediaLicenseIsPublic('') === false);
assert(avesmapsMediaLicenseIsPublic(null) === false);
assert(avesmapsMediaLicenseIsPublic('voellig_erfunden') === false);
assert(avesmapsMediaLicenseIsPublic('PUBLIC_DOMAIN') === false);

// ---- Beschriftungen -------------------------------------------------------------------------------
assert(avesmapsMediaLicenseLabel('cc_by') === 'CC-BY');
assert(avesmapsMediaLicenseLabel('own_work') === 'Eigene Kreation');
assert(avesmapsMediaLicenseLabel('voellig_erfunden') === 'Unbekannt/Sonstiges'); // ueber die Vorgabe

// ---- der Vorschlagstext ---------------------------------------------------------------------------
// Er ist Teil des Katalogs, weil er sonst in fuenf Dialogen einzeln abgeschrieben wuerde.
assert(str_contains(AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE, 'ohne Namensnennung'));

echo "media-license-test: OK\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-test.php
```

Erwartet: **Fehlschlag** mit `Failed to open stream: No such file or directory` für
`api/_internal/media-license.php`. Wenn stattdessen `media-license-test: OK` erscheint, existiert
die Datei schon — dann diesen Plan nicht ausführen, sondern nachsehen, wer sie angelegt hat.

- [ ] **Schritt 3: Die Datei schreiben**

Datei `api/_internal/media-license.php`:

```php
<?php

declare(strict_types=1);

/**
 * Der EINE Lizenzkatalog fuer jeden Bild-Upload in Avesmaps.
 *
 * Bis zum 16.08.2026 trugen fuenf Flaechen fuenf getrennte Vokabulare: Stadtkarten sechs Werte,
 * Siedlungsbilder vier, Territoriums-Wappen zwei, Siedlungs-Wappen einen fest verdrahteten, und die
 * Literatur-Cover gar keinen. citymaps.php:36-37 benannte das Problem schon damals ("three places
 * with nothing keeping them in sync") -- diese Datei beendet es, statt eine sechste Liste danebenzustellen.
 *
 * 💣 KEINE zweite Liste anlegen. Eine neue Flaeche, die Lizenzen braucht, liest hier -- das ist
 * dieselbe Lehre wie beim Quellen-System (AGENTS §5): dort kostete eine eigene `lore_source`-Tabelle
 * eine Schema-Erweiterung, eine Datenmigration und einen kompletten Neutest, gegen zwei Zeilen, die
 * es vorher gekostet haette.
 *
 * ⚠️ Diese Datei hat KEINE Seiteneffekte auf oberster Ebene: kein Bootstrap, keine DB, kein DDL,
 * keine Ausgabe. Nur so kann jeder Endpunkt sie folgenlos `require_once`n -- auch die, die selbst
 * kein PDO aufbauen.
 *
 * Die JS-Entsprechung liegt in js/app/media-licenses.js und wird von
 * js/app/__tests__/media-licenses-parity.test.js Wert fuer Wert gegen DIESE Datei geprueft. Wer hier
 * etwas aendert und dort nicht, faehrt einen roten Test -- und das ist der Sinn der Uebung.
 */

/**
 * Die sieben Kennungen in ANZEIGEREIHENFOLGE (Entwurf §2). Die Reihenfolge ist Teil des Vertrags,
 * nicht bloss eine Schreibweise: die Auswahlfelder der fuenf Editoren bauen sich aus dieser Liste,
 * und der Paritaetstest vergleicht sie Stelle fuer Stelle gegen die JS-Seite.
 *
 * 🔴 Sechs der sieben sind die Kennungen, die die Stadtkarten seit dem 01.08.2026 tragen
 * (AVESMAPS_CITYMAP_LICENSES). Das ist kein Zufall, sondern der Grund, warum die Migration der
 * Karten aus null Zeilen besteht -- nur `cc_by` ist neu.
 *
 * ⚠️ GLEICHER NAME, ANDERE FORM als drueben: js/app/media-licenses.js nennt seine Liste ebenfalls
 * AVESMAPS_MEDIA_LICENSES, fuehrt dort aber OBJEKTE ({value, label, public}), weil ein <option> genau
 * das braucht. Hier sind es blanke Strings, damit in_array() ohne Umweg funktioniert. Wer Code von
 * einer Seite auf die andere traegt, muss die Form mitdenken -- der Paritaetstest vergleicht die
 * Werte, nicht die Struktur.
 */
const AVESMAPS_MEDIA_LICENSES = [
    'unknown_other',
    'public_domain',
    'cc0',
    'cc_by',
    'permission_granted',
    'ai_generated',
    'own_work',
];

/**
 * Die fuenf Werte, unter denen ein Bild im Frontend erscheinen darf.
 *
 * 🔴 `cc_by` und `unknown_other` fehlen hier ABSICHTLICH und werden trotzdem gespeichert: die
 * Namensnennung, die CC-BY verlangt, muesste am Bild selbst stehen, und diese Flaeche gibt es im
 * Frontend nicht (Owner-Entscheid 16.08.2026: Urheber und Kommentar bleiben im Editor). Ein CC-BY-Bild
 * ohne sichtbaren Nachweis zu zeigen waere ein Lizenzverstoss; die Angabe beim Upload wegzuwerfen
 * waere Datenverlust. Gespeichert-aber-still ist der einzige ehrliche dritte Weg.
 *
 * ⚠️ `permission_granted` ist keine Lizenz, sondern eine Erlaubnis: das Werk kann unter beliebiger
 * Lizenz stehen, entscheidend ist die Zustimmung des Urhebers -- ausdruecklich auch ohne genannt zu
 * werden. Deshalb steht es hier, obwohl es ueber die Lizenz des Werks nichts aussagt.
 */
const AVESMAPS_MEDIA_LICENSES_PUBLIC = [
    'public_domain',
    'cc0',
    'permission_granted',
    'ai_generated',
    'own_work',
];

/**
 * Die deutschen Beschriftungen. Schluesselreihenfolge == AVESMAPS_MEDIA_LICENSES (im Test verankert),
 * damit ein Auswahlfeld direkt darueber laufen kann, ohne die Reihenfolge ein zweites Mal zu kennen.
 *
 * ⚠️ Der Zusatz "(nicht oeffentlich)", den die Karten heute an ihrem letzten Eintrag tragen, steht
 * hier NICHT: welche Werte still bleiben, sagt die Liste oben, und ein in die Beschriftung gebackener
 * Hinweis waere eine zweite, konkurrierende Wahrheit. Die Dialoge kennzeichnen die stillen Werte in
 * Phase 4 aus AVESMAPS_MEDIA_LICENSES_PUBLIC heraus.
 */
const AVESMAPS_MEDIA_LICENSE_LABELS = [
    'unknown_other' => 'Unbekannt/Sonstiges',
    'public_domain' => 'Public Domain',
    'cc0' => 'CC0',
    'cc_by' => 'CC-BY',
    'permission_granted' => 'Genehmigung erteilt',
    'ai_generated' => 'Von uns KI-generiert',
    'own_work' => 'Eigene Kreation',
];

/**
 * Vorschlagstext, den die Dialoge in Phase 4 bei der Wahl "Genehmigung erteilt" in ein LEERES
 * Kommentarfeld setzen (nie ueber einen vorhandenen Text).
 *
 * ⚠️ Er steht hier und nicht in den Dialogen, weil er sonst in fuenf Oberflaechen einzeln
 * abgeschrieben wuerde -- und abgeschriebene Texte laufen auseinander (AGENTS §11, die Listenzeile).
 */
const AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE =
    'Urheber ist mit der Nutzung einverstanden, ausdrücklich auch ohne Namensnennung.';

/**
 * Bringt einen beliebigen gespeicherten oder gesendeten Wert auf eine Katalog-Kennung.
 *
 * Alles, was nicht wortgleich im Katalog steht, faellt auf $fallback -- und $fallback selbst wird
 * ebenfalls geprueft. 💣 Ohne diese zweite Pruefung reichte ein Tippfehler in der Vorgabe eines
 * Aufrufers einen katalogfremden Wert in die Datenbank durch, und zwar auf einem Weg, den keine
 * Eingabepruefung sieht.
 *
 * ⚠️ Es wird NICHT kleingeschrieben: 'CC0' ist ein Fehler, keine Schreibvariante. Wer eine
 * Grossschreibung durchliesse, koennte den Wert spaeter nicht mehr vergleichen, ohne ueberall zu
 * normalisieren -- und genau eine dieser Stellen wuerde vergessen.
 */
function avesmapsMediaLicenseNormalize(mixed $value, string $fallback = 'unknown_other'): string
{
    $vorgabe = in_array($fallback, AVESMAPS_MEDIA_LICENSES, true) ? $fallback : 'unknown_other';
    $wert = is_string($value) ? trim($value) : '';

    return in_array($wert, AVESMAPS_MEDIA_LICENSES, true) ? $wert : $vorgabe;
}

/**
 * Darf ein Bild mit diesem Wert im Frontend erscheinen?
 *
 * 🔴 Nimmt bewusst KEINE Vorgabe entgegen. Duerfte ein Aufrufer hier 'ai_generated' als Rueckfall
 * setzen, machte jeder unbekannte String sein Bild oeffentlich -- die Umkehrung der Regel, vor der
 * api/edit/map/citymap-image.php:190-191 seit dem 01.08.2026 warnt ("Normalising FIRST means an
 * unknown string falls to 'unknown_other' and is refused -- never the other way round").
 * Erst normalisieren, dann pruefen. Immer in dieser Reihenfolge.
 */
function avesmapsMediaLicenseIsPublic(mixed $value): bool
{
    return in_array(avesmapsMediaLicenseNormalize($value), AVESMAPS_MEDIA_LICENSES_PUBLIC, true);
}

/**
 * Die deutsche Beschriftung einer Kennung. Ein unbekannter Wert bekommt die von 'unknown_other' --
 * dieselbe Rangfolge wie ueberall, damit eine Oberflaeche nie ein leeres Auswahlfeld zeigt.
 */
function avesmapsMediaLicenseLabel(mixed $value): string
{
    return AVESMAPS_MEDIA_LICENSE_LABELS[avesmapsMediaLicenseNormalize($value)];
}
```

- [ ] **Schritt 4: Test laufen lassen und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-test.php
```

Erwartet: `media-license-test: OK`, Exit-Code 0.

- [ ] **Schritt 5: Prüfen, dass wirklich kein Aufrufer wechselt**

Phase 1 darf nichts am Verhalten ändern. Diese beiden Befehle belegen das:

```bash
grep -rn "media-license" api/ js/ --include=*.php --include=*.js | grep -v "__tests__"
```

Erwartet: **genau nichts** außer der neuen Datei selbst — kein `require_once` irgendwo.

```bash
git status --short
```

Erwartet: nur die zwei neuen Dateien dieser Aufgabe als `??`. Fremde Einträge (andere Sitzungen)
bleiben stehen und werden **nicht** gestaged.

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/media-license.php api/_internal/__tests__/media-license-test.php
git commit -m "feat(lizenzen): der gemeinsame Katalog -- sieben Werte, eine Normalisierung, ein Gate"
```

---

## Aufgabe 2: Der JS-Katalog und die Klammer

**Dateien:**
- Neu: `js/app/media-licenses.js`
- Test: `js/app/__tests__/media-licenses-parity.test.js`

**Schnittstellen:**
- Verbraucht aus Aufgabe 1: die vier Konstanten in `api/_internal/media-license.php` — der Test
  liest die Datei als **Text** und zieht sie per Regex heraus (er führt kein PHP aus, weil der
  JS-Testlauf des Workflows nur `node` kennt).
- Liefert an Phase 4:
  - `AVESMAPS_MEDIA_LICENSES` — `Array<{value: string, label: string, public: boolean}>`
    in Anzeigereihenfolge; die Form, aus der sich ein `<option>` direkt bauen lässt
  - `avesmapsMediaLicenseNormalize(wert, vorgabe = "unknown_other")` → `string`
  - `avesmapsMediaLicenseIsPublic(wert)` → `boolean`
  - `avesmapsMediaLicenseLabel(wert)` → `string`
  - `AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE` — `string`

- [ ] **Schritt 1: Den fehlschlagenden Paritätstest schreiben**

Datei `js/app/__tests__/media-licenses-parity.test.js`:

```js
// Der JS-Katalog und der PHP-Katalog muessen Wert fuer Wert dasselbe sagen.
//
// 💣 WARUM ES DIESEN TEST GIBT: der Katalog steht zweimal im Haus -- einmal in
// api/_internal/media-license.php fuer die Endpunkte, einmal in js/app/media-licenses.js fuer die
// vier Editorseiten. Das ist eine bewusste Doppelung (ein Endpunkt, der die Liste ausliefert, kostete
// je Editorseite einen Request und einen Ladezustand fuer etwas, das sich nie zur Laufzeit aendert;
// ein Generat waere die Bauform, an der political-territory-editor-inline.css DREIMAL gescheitert
// ist, siehe AGENTS §10). Zulaessig ist die Doppelung nur, solange DIESER Test sie zusammenhaelt.
//
// Er liest die PHP-Datei als TEXT und fuehrt sie nicht aus: der JS-Lauf des Deploy-Workflows kennt
// nur `node`, kein PHP.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/media-licenses-parity.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const PHP_DATEI = path.join(ROOT, "api", "_internal", "media-license.php");

const js = require(path.join(ROOT, "js", "app", "media-licenses.js"));
const phpText = fs.readFileSync(PHP_DATEI, "utf8");

/**
 * Zieht eine PHP-Konstante der Form `const NAME = [ 'a', 'b' ];` als Liste heraus.
 * ⚠️ Ueber [\s\S] statt . gesucht, weil der Block mehrzeilig ist -- und die Repo-Dateien CRLF
 * tragen, ein auf \n gebauter Regex also entweder danebengreift oder das \r mitnimmt.
 */
function phpListe(name) {
	const treffer = phpText.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
	assert.ok(treffer, `PHP-Konstante ${name} nicht gefunden -- wurde sie umbenannt?`);
	return [...treffer[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Dasselbe fuer eine Zuordnung der Form `const NAME = [ 'k' => 'v', ];`. */
function phpZuordnung(name) {
	const treffer = phpText.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
	assert.ok(treffer, `PHP-Konstante ${name} nicht gefunden -- wurde sie umbenannt?`);
	const paare = {};
	for (const m of treffer[1].matchAll(/'([^']+)'\s*=>\s*'([^']*)'/g)) {
		paare[m[1]] = m[2];
	}
	return paare;
}

const phpWerte = phpListe("AVESMAPS_MEDIA_LICENSES");
const phpOeffentlich = phpListe("AVESMAPS_MEDIA_LICENSES_PUBLIC");
const phpBeschriftungen = phpZuordnung("AVESMAPS_MEDIA_LICENSE_LABELS");

// Der Regex darf nicht ins Leere greifen und dann "beide leer, also gleich" melden.
assert.strictEqual(phpWerte.length, 7, "PHP-Katalog hat nicht sieben Werte");
assert.strictEqual(phpOeffentlich.length, 5, "PHP-Katalog hat nicht fuenf oeffentliche Werte");

// ---- Werte und REIHENFOLGE ------------------------------------------------------------------------
// Stelle fuer Stelle: die Reihenfolge ist die des Auswahlfelds und damit Teil des Vertrags.
assert.deepStrictEqual(
	js.AVESMAPS_MEDIA_LICENSES.map((e) => e.value),
	phpWerte,
	"JS- und PHP-Katalog stimmen in Werten oder Reihenfolge nicht ueberein"
);

// ---- die oeffentliche Teilmenge -------------------------------------------------------------------
assert.deepStrictEqual(
	js.AVESMAPS_MEDIA_LICENSES.filter((e) => e.public).map((e) => e.value),
	phpOeffentlich,
	"JS und PHP sind sich uneins, welche Werte im Frontend erscheinen duerfen"
);

// ---- Beschriftungen -------------------------------------------------------------------------------
for (const eintrag of js.AVESMAPS_MEDIA_LICENSES) {
	assert.strictEqual(
		eintrag.label,
		phpBeschriftungen[eintrag.value],
		`Beschriftung von ${eintrag.value} weicht ab`
	);
}

// ---- der Vorschlagstext ---------------------------------------------------------------------------
const phpNotiz = phpText.match(
	/const\s+AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE\s*=\s*\r?\n?\s*'([^']*)'/
);
assert.ok(phpNotiz, "AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE nicht gefunden");
assert.strictEqual(js.AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE, phpNotiz[1], "Vorschlagstext weicht ab");

// ---- dieselben Zusicherungen wie auf der PHP-Seite -------------------------------------------------
// 🔴 Die tragende: unbekannt ist nie oeffentlich. Sie muss auf BEIDEN Seiten gelten -- die JS-Seite
// entscheidet in Phase 4, ob ein Dialog einen Wert als "wird nicht angezeigt" kennzeichnet.
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("public_domain"), true);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("cc_by"), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("unknown_other"), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("voellig_erfunden"), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic(""), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic(null), false);
assert.strictEqual(js.avesmapsMediaLicenseIsPublic("PUBLIC_DOMAIN"), false);

assert.strictEqual(js.avesmapsMediaLicenseNormalize("  cc0  "), "cc0");
assert.strictEqual(js.avesmapsMediaLicenseNormalize(""), "unknown_other");
assert.strictEqual(js.avesmapsMediaLicenseNormalize(null), "unknown_other");
assert.strictEqual(js.avesmapsMediaLicenseNormalize(42), "unknown_other");
assert.strictEqual(js.avesmapsMediaLicenseNormalize("", "ai_generated"), "ai_generated");
assert.strictEqual(js.avesmapsMediaLicenseNormalize("cc0", "ai_generated"), "cc0");
// Auch hier: eine Vorgabe mit Tippfehler wird nicht durchgereicht.
assert.strictEqual(js.avesmapsMediaLicenseNormalize("", "ai_generatd"), "unknown_other");

assert.strictEqual(js.avesmapsMediaLicenseLabel("cc_by"), "CC-BY");
assert.strictEqual(js.avesmapsMediaLicenseLabel("voellig_erfunden"), "Unbekannt/Sonstiges");

console.log("media-licenses-parity: OK (" + phpWerte.length + " Werte, " + phpOeffentlich.length + " oeffentlich)");
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
node js/app/__tests__/media-licenses-parity.test.js
```

Erwartet: **Fehlschlag** mit `Cannot find module` für `js/app/media-licenses.js`.

- [ ] **Schritt 3: Die JS-Datei schreiben**

Datei `js/app/media-licenses.js`:

```js
// Der EINE Lizenzkatalog fuer jeden Bild-Upload -- die JS-Seite.
//
// 💣 DIESE DATEI IST DIE ZWILLINGSSCHWESTER VON api/_internal/media-license.php. Wer hier einen Wert,
// eine Beschriftung oder die Reihenfolge aendert und dort nicht (oder umgekehrt), faehrt einen roten
// js/app/__tests__/media-licenses-parity.test.js. Das ist kein Schikane-Test, sondern die einzige
// Bedingung, unter der die Doppelung ueberhaupt zulaessig ist: ein Generat waere die Bauform, an der
// political-territory-editor-inline.css dreimal gescheitert ist (AGENTS §10), und ein Endpunkt kostete
// je Editorseite einen Request fuer eine Liste, die sich nie zur Laufzeit aendert.
//
// Geladen wird sie von den vier Editorseiten per <script src>; sie sind html/*.html-Seiten, der Deploy
// stempelt das ?v= also selbst (AGENTS §7). ⚠️ Kein ASSET_VERSION-Bump -- der gilt nur den dynamisch
// nachgeladenen Territorien-Editor-Assets.

/**
 * Die sieben Kennungen in ANZEIGEREIHENFOLGE, mit Beschriftung und Sichtbarkeit.
 *
 * ⚠️ GLEICHER NAME, ANDERE FORM als drueben: api/_internal/media-license.php nennt seine Liste
 * ebenfalls AVESMAPS_MEDIA_LICENSES, fuehrt dort aber blanke Strings und haelt Beschriftungen und
 * Sichtbarkeit in zwei getrennten Konstanten. Hier sind es Objekte, weil ein <option> Wert und
 * Beschriftung zusammen braucht. Der Paritaetstest vergleicht die Werte, nicht die Struktur.
 *
 * 🔴 `public: false` heisst "wird gespeichert, aber nicht im Frontend gezeigt" -- nicht "darf nicht
 * gewaehlt werden". Der Editor traegt die Angabe vollstaendig ein, nur die Veroeffentlichung
 * unterbleibt (Owner-Entscheid 16.08.2026). Bei CC-BY, weil die Namensnennung am Bild stehen muesste
 * und diese Flaeche es im Frontend nicht gibt; bei Unbekannt/Sonstiges, weil ungeklaerte Herkunft
 * nichts auf einer oeffentlichen Karte zu suchen hat.
 */
const AVESMAPS_MEDIA_LICENSES = [
	{ value: "unknown_other", label: "Unbekannt/Sonstiges", public: false },
	{ value: "public_domain", label: "Public Domain", public: true },
	{ value: "cc0", label: "CC0", public: true },
	{ value: "cc_by", label: "CC-BY", public: false },
	{ value: "permission_granted", label: "Genehmigung erteilt", public: true },
	{ value: "ai_generated", label: "Von uns KI-generiert", public: true },
	{ value: "own_work", label: "Eigene Kreation", public: true },
];

/**
 * Vorschlagstext fuer ein LEERES Kommentarfeld bei der Wahl "Genehmigung erteilt" -- nie ueber einen
 * vorhandenen Text schreiben. ⚠️ Wortgleich mit AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE in der
 * PHP-Datei; der Paritaetstest vergleicht beide.
 */
const AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE =
	"Urheber ist mit der Nutzung einverstanden, ausdrücklich auch ohne Namensnennung.";

/**
 * Bringt einen beliebigen Wert auf eine Katalog-Kennung; alles Fremde faellt auf die Vorgabe.
 * 💣 Auch die VORGABE wird geprueft -- sonst reichte ein Tippfehler dort einen katalogfremden Wert
 * an den Server durch. Und es wird NICHT kleingeschrieben: "CC0" ist ein Fehler, keine Schreibvariante.
 */
function avesmapsMediaLicenseNormalize(wert, vorgabe) {
	const rueckfall = AVESMAPS_MEDIA_LICENSES.some((e) => e.value === vorgabe) ? vorgabe : "unknown_other";
	const geputzt = typeof wert === "string" ? wert.trim() : "";

	return AVESMAPS_MEDIA_LICENSES.some((e) => e.value === geputzt) ? geputzt : rueckfall;
}

/**
 * Darf ein Bild mit diesem Wert im Frontend erscheinen?
 * 🔴 Nimmt bewusst KEINE Vorgabe entgegen: mit einem oeffentlichen Rueckfall machte jeder unbekannte
 * String das Bild sichtbar. Erst normalisieren, dann pruefen -- nie umgekehrt.
 */
function avesmapsMediaLicenseIsPublic(wert) {
	const kennung = avesmapsMediaLicenseNormalize(wert);

	return AVESMAPS_MEDIA_LICENSES.some((e) => e.value === kennung && e.public);
}

/** Die deutsche Beschriftung; ein unbekannter Wert bekommt die von "unknown_other". */
function avesmapsMediaLicenseLabel(wert) {
	const kennung = avesmapsMediaLicenseNormalize(wert);
	const eintrag = AVESMAPS_MEDIA_LICENSES.find((e) => e.value === kennung);

	return eintrag ? eintrag.label : "";
}

// Node-Export (im Browser wirkungslos, dort sind die Namen Globals der Editorseiten). Er ist es, der
// den Paritaetstest die echte Liste pruefen laesst statt einer abgetippten Kopie.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_MEDIA_LICENSES: AVESMAPS_MEDIA_LICENSES,
		AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE: AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE,
		avesmapsMediaLicenseNormalize: avesmapsMediaLicenseNormalize,
		avesmapsMediaLicenseIsPublic: avesmapsMediaLicenseIsPublic,
		avesmapsMediaLicenseLabel: avesmapsMediaLicenseLabel,
	};
}
```

- [ ] **Schritt 4: Test laufen lassen und grün sehen**

```bash
node js/app/__tests__/media-licenses-parity.test.js
```

Erwartet: `media-licenses-parity: OK (7 Werte, 5 oeffentlich)`.

- [ ] **Schritt 5: Die Klammer selbst prüfen — der Test muss auch fehlschlagen können**

Ein Paritätstest, der nie rot wird, ist keiner. Kurz beweisen, dass er greift:

```bash
node -e "const fs=require('fs');const p='js/app/media-licenses.js';const o=fs.readFileSync(p,'utf8');fs.writeFileSync(p,o.replace('label: \"CC0\"','label: \"CC-Null\"'));" \
  && node js/app/__tests__/media-licenses-parity.test.js; echo "Exit: $?" \
  && git checkout -- js/app/media-licenses.js
```

Erwartet: **Fehlschlag** mit `Beschriftung von cc0 weicht ab`, danach stellt `git checkout` die Datei
wieder her. ⚠️ Danach `git status` prüfen — die Datei muss unverändert zurück sein.

- [ ] **Schritt 6: Committen**

```bash
git add js/app/media-licenses.js js/app/__tests__/media-licenses-parity.test.js
git commit -m "feat(lizenzen): der Katalog fuer die Editorseiten, an die PHP-Seite gebunden"
```

---

## Aufgabe 3: Abschluss — ganzes Testfeld, dann Push

**Dateien:** keine. Diese Aufgabe verifiziert und veröffentlicht nur.

- [ ] **Schritt 1: Der eigene Entwurf als Abhakliste**

Jede 💣/⚠️/🔴-Zeile aus §2 und §4 des Entwurfs einzeln gegen den Diff prüfen — erfüllt, oder
ausdrücklich verworfen mit Begründung (AGENTS §9). Für Phase 1 sind das:

- [ ] sieben Werte, in der Reihenfolge des Entwurfs §2
- [ ] `cc_by` und `unknown_other` sind **nicht** öffentlich, alle fünf anderen schon
- [ ] normalisieren **vor** prüfen — `avesmapsMediaLicenseIsPublic` nimmt keine Vorgabe entgegen
- [ ] die Vorgabe wird selbst normalisiert (Tippfehler wird nicht durchgereicht)
- [ ] kein Generat, kein Endpunkt — zwei Dateien, ein Paritätstest
- [ ] die PHP-Datei hat keine Seiteneffekte auf oberster Ebene
- [ ] kein `?v=` von Hand, kein `ASSET_VERSION`-Bump

- [ ] **Schritt 2: Das GANZE JS-Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: keine Ausgabe. Vergleichswert vom 16.08.2026: 152 Tests, 0 rot (mit dem neuen: 153).

- [ ] **Schritt 3: Das GANZE PHP-Testfeld, mit den Erweiterungen**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
```

⚠️ **Ohne `mbstring`/`pdo_sqlite`/`gd` melden 45 Tests rot**, die alle nur die Erweiterung vermissen
(AGENTS §9). Vorbestehend rot bleibt **genau einer**:
`api/_internal/linkcheck/__tests__/link-url-test.php` (echter DNS-Abruf, kein Regressionssignal).
Vergleichswert vom 16.08.2026: 187 Tests, 1 rot (mit dem neuen: 188, 1 rot).

- [ ] **Schritt 4: Die 21 wikidump-Tests, die das Muster oben nicht findet**

```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
```

Erwartet: keine Ausgabe. 💣 Diese Dateien stehen weder in einem `__tests__`-Verzeichnis noch enden
sie auf `-test.php` — genau diese Lücke kostete am 15.08.2026 zwei Deploys.

- [ ] **Schritt 5: Push und Remote-SHA prüfen**

```bash
git status --short
```

Erwartet: keine eigenen ungestagten Änderungen. Fremde Einträge bleiben stehen.

```bash
git fetch origin && git rebase origin/master && git push origin master && git fetch origin --quiet && git log --oneline -1 origin/master
```

⚠️ Wird der Push abgelehnt: `fetch` + `rebase origin/master` + erneut versuchen. **Niemals
force-pushen.** ⚠️ Liegt fremde **unfertige** Arbeit im Baum, statt `rebase --autostash` lieber
`git reset --mixed origin/master` und die eigenen Dateien neu committen — ein Autostash reißt
fremde Arbeit durch den Rebase.

Der letzte Befehl muss den eigenen Commit als `origin/master` zeigen (CLAUDE.md: Remote-SHA nach
dem Push verifizieren).

- [ ] **Schritt 6: Nichts weiter tun**

🔴 Phase 1 endet hier. Der Katalog existiert und benutzt ihn niemand — das ist der geplante
Zustand, kein unfertiger. Wer jetzt „nur schnell" einen Aufrufer umstellt, nimmt Phase 2 (Migration)
vorweg, und die muss **vor** jeder Dialogumstellung laufen. Der Live-Zustand ändert sich in dieser
Phase nicht; es gibt darum auch nichts anzusehen und nichts zu melden außer „Fundament steht".

---

## Was diese Phase ausdrücklich NICHT tut

Zur Sicherheit gegen die Versuchung, „das eine noch mitzunehmen":

- **Keine Spalte** wird angelegt (`citymap`, `adventure` folgen in Phase 2).
- **Kein Bestandswert** wird zugeordnet — `'own'`, `attribution_required` und `unknown` bleiben
  unverändert stehen, bis der Migrationslauf sie holt.
- **Kein Gate** wird eingebaut oder geändert. `AVESMAPS_COAT_PUBLIC_LICENSES` bleibt bei
  `['public_domain']`, die Siedlungs-Wappen bleiben ungegated (Phase 3).
- **Kein Dialog** bekommt ein Auswahlfeld (Phase 4).
- **Der Wiki-Lizenzparser** schreibt weiterhin `attribution_required` (Phase 2).
- **`NOTICE.md` und `LEGAL.md`** bleiben unangetastet (Phase 3, mit Owner-Blick auf den Wortlaut).

Alle sechs Punkte sind im Entwurf einer späteren Phase zugeordnet. Sie hier vorzuziehen macht den
Zwischenstand nicht deploybar — und jeder Zwischenstand dieses Umbaus geht live.
