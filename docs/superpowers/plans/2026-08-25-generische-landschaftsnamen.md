# Generische Landschaftsnamen erscheinen nicht auf der Karte — Umsetzungsplan

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe umzusetzen.
> Die Schritte tragen Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Eine Landschaftsfläche, deren Name nur der interne Griff ist (`Wald-025`, `Fläche-101`),
trägt keine Beschriftung auf der Karte — und der Haken „Regionname anzeigen" kann gar nicht mehr
falsch stehen.

**Ansatz:** Gebunden werden die **Schreibwege** von `show_name`, nicht der Zeichenpfad (Entwurf §2:
der Zeichenpfad bräuchte nachgeladene Regionslisten und hätte beim anonymen Besucher nie gegriffen).
Die Auto-Namen-Regel bleibt die eine, geteilte, unit-getestete Funktion; der Bestand wird einmalig
über einen Knopf im Landschaften-Editor nachgezogen, der **im Browser** entscheidet und den Server
nur ausführen lässt.

**Werkzeug:** Vanilla JS ohne Build, `node` als Testläufer, PHP 8 + PDO, MySQL.

**Entwurf:** `docs/superpowers/specs/2026-08-25-generische-landschaftsnamen-design.md` — jede Zeile
mit 💣 / ⚠️ / 🔴 / 🪤 dort ist Abnahmeliste, nicht Prosa (AGENTS.md §9).

## Globale Vorgaben

- **Kommentare, Commit-Nachrichten und Doku auf DEUTSCH** (AGENTS.md §8). `error.code`-Werte bleiben
  englisch. In einer englischsprachigen Datei die Sprache dieser Datei weiterschreiben.
- **Keine deutschen Oberflächentexte übersetzen**, keine `<option value>`-Slugs anfassen.
- **Geteilter Arbeitsbaum:** niemals `git add -A` / `git add .` / `git commit -a`. Nur die selbst
  angefassten Pfade einzeln stagen (AGENTS.md §9). Vor jedem Commit `git status` lesen.
- **Vor dem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests:
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  ```
  PHP mit den Erweiterungen, sonst lügt der Lauf:
  ```bash
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  ```
  Und der dritte Lauf, den das Muster oben nicht findet:
  ```bash
  for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
  ```
  Vorbestehend rot ist genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Aufgabe 2, 3 und 6 sind sichtbar:
  je ein Commit, ein Push, ein Blick des Owners — kein Bündel.
- **`html/editor-handbuch.html` NICHT anfassen.** Pflicht ist nur ein Commit-Betreff, der die
  sichtbare Wirkung benennt; die nächtliche Routine schreibt das Handbuch nach.
- Keine `?v=`-Stempel von Hand. Kein `ASSET_VERSION`-Bump nötig (keine Territorien-Editor-Assets).

---

## Dateiübersicht

| Datei | Rolle in diesem Vorhaben |
|---|---|
| `js/map-features/map-features-ecosystem-naming.js` | die eine Namensregel — bekommt den Fallback-Zweig (A1) |
| `js/map-features/__tests__/ecosystem-naming.test.js` | ihr Unit-Test |
| `js/map-features/map-features-ecosystem-properties.js` | der Dialog: Riegel beim Öffnen und beim Speichern (A2) |
| `js/map-features/__tests__/ecosystem-properties-sperre.test.js` | Verdrahtungstest des Dialogs |
| `js/map-features/map-features-ecosystem-draw.js` | Neuanlage eines Regionslabels (A3) |
| `js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js` | **neu** — der Schreibwege-Zähler (A4) |
| `api/_internal/app/ecosystem.php` | **neu**: `avesmapsEcosystemHideRegionLabels()` (A5) |
| `api/edit/map/ecosystem.php` | ihr Dispatcher-Eintrag (A5) |
| `api/_internal/app/__tests__/ecosystem-hide-labels-test.php` | **neu** — Test des Endpunkts (A5) |
| `html/landschaften-editor.html` | der Knopf samt Trockenlauf (A6) |

---

## Aufgabe 1: Der Fallback-Präfix gilt immer als generisch

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-naming.js` (Funktion `isEcosystemRegionAutoName`)
- Test: `js/map-features/__tests__/ecosystem-naming.test.js`

**Schnittstellen:**
- Erzeugt: `isEcosystemRegionAutoName(name, artLabel) -> boolean` — Signatur **unverändert**, nur
  das Urteil wird weiter. Alle späteren Aufgaben und die vier vorhandenen Aufrufer
  (`ecosystem-properties.js:555`, `map-features-path-landscapes.js:45`,
  `html/landschaften-editor.html:1841`, `ecosystemRegionDisplayName`) verlassen sich darauf.

⚠️ Diese Datei ist auf **Englisch** kommentiert — Kommentare hier englisch weiterschreiben
(AGENTS.md §8: „match the file you are editing").

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An das Ende des Blocks `-- THE PREDICATE --` in `js/map-features/__tests__/ecosystem-naming.test.js`,
direkt nach der letzten `isEcosystemRegionAutoName`-Zusicherung:

```js
// 🪤 THE FALLBACK PREFIX IS ALWAYS GENERIC, whatever the Art says. Measured live on 25.08.2026:
// 36 of the 37 "Fläche-NNN" regions have since been given an Art (18× wald, 10× see, 7× wuestenoase),
// and against "Wald" the name "Fläche-101" does NOT match `^Wald-\d+$`. They therefore counted as
// REAL names and kept their map label -- which is the bug this rule was reported for. "Fläche" is not
// an Art label at all: it is ECOSYSTEM_AUTO_NAME_FALLBACK, produced only by the generator.
assert.strictEqual(isEcosystemRegionAutoName("Fläche-101", "Wald"), true);
assert.strictEqual(isEcosystemRegionAutoName("Fläche-007", "See"), true);
assert.strictEqual(isEcosystemRegionAutoName("Fläche-1", ""), true, "unchanged: no Art means the fallback IS the prefix");

// The both-ends anchoring survives it -- the fallback is a whole prefix, never a suffix.
assert.strictEqual(isEcosystemRegionAutoName("Grüne Fläche-3", "Wald"), false);
assert.strictEqual(isEcosystemRegionAutoName("Fläche am See", "Wald"), false);

// And the Art still has to agree for a REAL Art label: this is the leftover case from above, and
// widening the fallback must not widen that one too.
assert.strictEqual(isEcosystemRegionAutoName("Wald-001", "Steppe"), false);

// The display name follows: a leftover "Fläche-101" on a forest reads as "Wald", not as itself.
assert.strictEqual(ecosystemRegionDisplayName("Fläche-101", "Wald"), "Wald");
```

- [ ] **Schritt 2: Den Test laufen lassen, damit er fehlschlägt**

```bash
node js/map-features/__tests__/ecosystem-naming.test.js
```

Erwartet: `AssertionError [ERR_ASSERTION]: false !== true` bei `isEcosystemRegionAutoName("Fläche-101", "Wald")`.

- [ ] **Schritt 3: Die Regel erweitern**

In `js/map-features/map-features-ecosystem-naming.js` die Funktion `isEcosystemRegionAutoName`
ersetzen durch:

```js
// Does this name carry the state "auto"? Anchored at both ends, so a real name that happens to end in
// a number ("Wald der Wälder-2") stays a real name.
//
// 🔴 TWO prefixes pass, not one: the Art's own label AND the neutral fallback. "Fläche-101" is never a
// real landscape name -- only the generator produces it, for a region that had no Art at the time. When
// an Art arrives later on a path that does not run through syncPropertiesAutoName (a bulk assignment, a
// split, an import), the name stays behind; measured live on 25.08.2026, that was true for 36 of 37 such
// regions, and they kept their map label because `Fläche-101` does not match `^Wald-\d+$`.
//
// ⚠️ This does NOT widen the Art check for real Art labels: "Wald-001" on a steppe stays a real name,
// because reading it as auto-named would hide a name the editor can still see in the field.
function isEcosystemRegionAutoName(name, artLabel) {
	const trimmed = String(name === null || name === undefined ? "" : name).trim();
	if (trimmed === "") {
		return false;
	}
	if (ecosystemAutoNamePattern(artLabel).test(trimmed)) {
		return true;
	}
	// The fallback is read from the constant, never spelled out a second time -- renaming it has to move
	// both halves of the rule at once.
	return ecosystemAutoNamePattern(ECOSYSTEM_AUTO_NAME_FALLBACK).test(trimmed);
}
```

- [ ] **Schritt 4: Den Test laufen lassen, damit er besteht**

```bash
node js/map-features/__tests__/ecosystem-naming.test.js
```

Erwartet: kein Ausgabetext, Exit-Code 0.

- [ ] **Schritt 5: Die vier Aufrufer gegenprüfen**

```bash
node js/map-features/__tests__/ecosystem-path-assign.test.js
node js/map-features/__tests__/ecosystem-area-infopanel.test.js
```

Erwartet: beide bestehen. Sie lesen `ecosystemRegionDisplayName` über
`map-features-path-landscapes.js` — ein Weg durchquert künftig „Wald" statt „Fläche-101".

- [ ] **Schritt 6: Commit**

```bash
git add js/map-features/map-features-ecosystem-naming.js js/map-features/__tests__/ecosystem-naming.test.js
git commit -m "fix(landschaften): \"Flaeche-101\" ist ein Auto-Name, auch wenn die Flaeche laengst Wald ist"
```

---

## Aufgabe 2: Der Haken „Regionname anzeigen" kann nicht mehr falsch stehen

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-properties.js`
  (`syncPropertiesShowName` ~Z.602, `syncPropertiesAutoName` ~Z.408, `renameLinkedEcosystemLabel` ~Z.1307)
- Test: `js/map-features/__tests__/ecosystem-properties-sperre.test.js`

**Schnittstellen:**
- Verbraucht: `isEcosystemRegionAutoName` aus Aufgabe 1.
- Erzeugt: `syncPropertiesShowName()` **ohne Parameter** (holt sich die Fläche über
  `currentPropertiesArea()`) und mit optionalem `{ geste = false }`. Aufgabe 6 braucht sie nicht.

💣 **Die Kopplung ist der ganze Punkt dieser Aufgabe.** `syncPropertiesAutoName` hat **sieben**
Aufrufer (Z. 284, 293, 316, 348, 556, 1639, 1641). Den Nachzug an einer einzelnen Stelle
anzuhängen wäre die Fehlerklasse, die AGENTS.md mehrfach nennt: eine Regel, die einen von sieben
Erzeugern bindet, ist keine Regel. Deshalb ruft **`syncPropertiesAutoName` selbst** am Ende
`syncPropertiesShowName` — dann sind alle sieben gebunden, ohne dass einer davon es wissen muss.

🔴 **Öffnen und Geste sind NICHT dasselbe.** Beim Öffnen einer Fläche mit echtem Namen muss der
gespeicherte Zustand stehen bleiben — sonst hakt jedes Öffnen eine bewusst ausgeblendete
Beschriftung wieder an. Vorgehakt wird nur, wenn der Benutzer den Auto-Name-Haken **gerade
ausgeschaltet** hat. Das vorhandene `regenerate`-Flag unterscheidet beide Fälle bereits: es ist
`true` genau an den zwei Benutzergesten (Z. 1639 `autoname`-change, Z. 1641 `type`-change) und
`false` bei jedem Öffnen. Es wird als `geste` durchgereicht — **kein zweiter Zustand**.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An das Ende von `js/map-features/__tests__/ecosystem-properties-sperre.test.js` anhängen:

```js
// ---- Der Riegel: ein generischer Name traegt keine Beschriftung (25.08.2026) --------------------
//
// 🔴 Owner: „die option ‚Regionname anzeigen‘ darf nicht aktiviert sein, wenn autoname aktiv ist."
// Geprueft wird die VERDRAHTUNG, wie im Rest dieser Datei -- was der Haken bewirkt, misst der
// Trockenlauf aus Aufgabe 6 am Livebestand.

assert.ok(
	js.includes("isEcosystemRegionAutoName"),
	"syncPropertiesShowName muss die geteilte Regel fragen, nicht den Haken daneben ablesen — der "
		+ "Auto-Name-Haken ist selbst nur abgeleitet und kann beim Oeffnen noch gar nicht stehen."
);

// 💣 Die Kopplung an EINER Stelle: syncPropertiesAutoName hat sieben Aufrufer, und ein Nachzug, der
// nur an einem davon haengt, ist keine Regel (die Vier-Erzeuger-Falle aus AGENTS.md).
const autoNameKoerper = js.slice(
	js.indexOf("function syncPropertiesAutoName"),
	js.indexOf("function knownRegionNamesForAutoName")
);
assert.ok(
	autoNameKoerper.includes("syncPropertiesShowName("),
	"syncPropertiesAutoName muss den Anzeige-Haken selbst nachziehen. Haengt der Nachzug an den "
		+ "einzelnen Aufrufern, vergisst ihn der naechste, der einen achten hinzufuegt."
);

// 🔴 Oeffnen ist keine Geste: ein bewusst ausgeblendeter echter Name darf beim blossen Oeffnen des
// Dialogs nicht wieder angehakt werden. Unterschieden wird ueber das vorhandene regenerate-Flag,
// nicht ueber einen zweiten Zustand.
const showNameKoerper = js.slice(
	js.indexOf("function syncPropertiesShowName"),
	js.indexOf("function syncPropertiesNodix")
);
assert.ok(
	/geste/.test(showNameKoerper),
	"syncPropertiesShowName muss Oeffnen und Geste unterscheiden — sonst ueberschreibt jedes Oeffnen "
		+ "einer Flaeche mit echtem Namen deren gespeicherten Anzeigezustand."
);
assert.ok(
	showNameKoerper.includes("box.disabled = ") && showNameKoerper.includes("box.title = "),
	"Gesperrt UND begruendet: ein grauer Haken ohne Grund liest sich wie ein Fehler. Vorbild ist der "
		+ "Nodix-Haken direkt darunter."
);

// 💣 Die Speicherstelle liest den gesperrten Haken heute als „unveraendert" und schriebe damit den
// ALTEN Wert fort. Sie muss den gesperrten Fall ausdruecklich als false lesen.
const renameKoerper = js.slice(
	js.indexOf("async function renameLinkedEcosystemLabel"),
	js.indexOf("async function saveTerrainSettings")
);
assert.ok(
	!/const showName = box && !box\.disabled \? Boolean\(box\.checked\) : \(label\.showName !== false\)/.test(renameKoerper),
	"Der alte Ausdruck haelt bei gesperrtem Haken den bisherigen Wert fest. Genau dann muss false "
		+ "geschrieben werden, sonst bleibt die Beschriftung der umbenannten Flaeche stehen."
);
```

- [ ] **Schritt 2: Den Test laufen lassen, damit er fehlschlägt**

```bash
node js/map-features/__tests__/ecosystem-properties-sperre.test.js
```

Erwartet: FEHLSCHLAG bei der ersten Zusicherung („syncPropertiesShowName muss die geteilte Regel
fragen…"), weil `isEcosystemRegionAutoName` heute nur an Z. 555 vorkommt — prüfe nach dem Bau,
dass alle vier Zusicherungen greifen.

- [ ] **Schritt 3: `syncPropertiesShowName` umbauen**

In `js/map-features/map-features-ecosystem-properties.js` die Funktion ab `// Der Haken steht auf dem
Zustand des Labels…` ersetzen:

```js
	// Der Haken steht auf dem Zustand des Labels, nicht auf einer Vorgabe.
	//
	// 🪤 Er ist NICHT gesperrt, wenn die Region noch kein Label hat -- dann LEGT das Anhaken eines an.
	// Erst war er dort grau, und das war falsch gedacht: der V5-Import hat 124 der 133 Flächen ein Label
	// gegeben, die übrigen 9 sind von Hand gezeichnete. Für neun Zeilen ein Serien-Nachziehen zu bauen
	// wäre Unfug; der Haken erledigt sie beiläufig, dort wo jemand die Region ohnehin gerade anfasst.
	//
	// 🔴 GESPERRT IST ER BEI EINEM GENERISCHEN NAMEN (Owner 25.08.2026: „landschaften die einen
	// generischen namen haben, sollten nicht angezeigt werden dürfen"). `Wald-025` und `Fläche-101` sind
	// interne Griffe -- sie dürfen nach aussen gar nicht dringen, und genau das sagt schon
	// ecosystemRegionDisplayName. Gesperrt statt bloss leer, damit die Sperre sichtbar ist; so hält es
	// der Auto-Name-Haken selbst bei zugewiesener Wiki-Landschaft.
	//
	// 🔴 ÖFFNEN IST KEINE GESTE. Beim Öffnen bleibt der gespeicherte Zustand stehen -- sonst hakt jedes
	// Öffnen einer bewusst ausgeblendeten Fläche ihre Beschriftung wieder an. Vorgehakt wird nur, wenn
	// der Benutzer den Auto-Namen gerade ABGESCHALTET hat: dann hat die Fläche einen echten Namen, und
	// ohne das Vorhaken bliebe der Einmal-Lauf über den Bestand eine stille Falle (`show_name = 0` steht
	// dann in der Datenbank, und niemand sähe, warum der neue Name nicht erscheint).
	function syncPropertiesShowName({ geste = false } = {}) {
		const box = propertiesElement("showname");
		if (!box) {
			return;
		}
		const area = currentPropertiesArea();
		const entry = linkedEcosystemLabelEntry(area);
		const name = String(propertiesElement("name")?.value || "");
		const generisch = typeof isEcosystemRegionAutoName === "function"
			&& isEcosystemRegionAutoName(name, currentPropertiesArtLabel());

		if (generisch) {
			box.disabled = true;
			box.checked = false;
			box.title = "Ein Auto-Name ist ein interner Griff und gehört nicht auf die Karte. "
				+ "Gib der Fläche einen echten Namen, dann lässt sich die Beschriftung einschalten.";
			return;
		}

		box.disabled = false;
		box.title = "";
		// Die Geste hat gerade einen echten Namen erzeugt -> die Beschriftung anbieten. Beim blossen
		// Öffnen gilt weiterhin, was gespeichert ist.
		box.checked = geste ? true : (Boolean(entry) && entry.label?.showName !== false);
	}
```

⚠️ Der Aufruf in Zeile ~493 heisst danach `syncPropertiesShowName();` **ohne Argument** — die Fläche
holt die Funktion sich selbst. Die Zeile `syncPropertiesShowName(area);` entsprechend anpassen.

- [ ] **Schritt 4: Die Kopplung an EINER Stelle setzen**

Am Ende von `syncPropertiesAutoName`, nach dem `if (autoNameBox.checked && regenerate) { … }`-Block
und **innerhalb** der Funktion:

```js
		// 💣 HIER, nicht bei den sieben Aufrufern. Der Anzeige-Haken hängt am selben Zustand wie dieser
		// hier -- wer sie getrennt nachzieht, hat sie beim achten Aufrufer schon vergessen. `regenerate`
		// ist bereits die Unterscheidung „Benutzergeste" vs. „Dialog öffnet", also wird sie durchgereicht
		// statt einen zweiten Zustand daneben zu führen.
		syncPropertiesShowName({ geste: regenerate });
```

Und die frühe Rückkehr im Wiki-Zweig derselben Funktion (`if (wikiName !== "") { … return; }`) bekommt
denselben Aufruf vor ihrem `return` — ein Wiki-Name ist ein echter Name, der Haken gehört dort frei.

- [ ] **Schritt 5: Die Speicherstelle binden**

In `renameLinkedEcosystemLabel` die Zeile

```js
		const showName = box && !box.disabled ? Boolean(box.checked) : (label.showName !== false);
```

ersetzen durch:

```js
		// 💣 Ein GESPERRTER Haken ist eine Aussage, kein fehlender Wert. Bis 25.08.2026 fiel dieser
		// Ausdruck bei `disabled` auf den bisherigen Wert zurück -- gedacht war das für den Fall „Haken
		// gar nicht da". Seit der Sperre bei generischem Namen hiesse es: die Beschriftung einer Fläche,
		// die gerade zu `Wald-025` wurde, bliebe stehen. Gesperrt UND leer heisst false.
		const showName = box
			? (box.disabled ? false : Boolean(box.checked))
			: (label.showName !== false);
```

⚠️ Der Rückfall `label.showName !== false` bleibt für den Fall, dass das Element fehlt (der Dialog
wurde nie gebunden) — dann darf nichts geändert werden.

- [ ] **Schritt 6: Die Tests laufen lassen**

```bash
node js/map-features/__tests__/ecosystem-properties-sperre.test.js
node js/map-features/__tests__/ecosystem-label-writeback.test.js
node js/map-features/__tests__/ecosystem-edit.test.js
```

Erwartet: alle drei bestehen.

- [ ] **Schritt 7: Commit**

```bash
git add js/map-features/map-features-ecosystem-properties.js js/map-features/__tests__/ecosystem-properties-sperre.test.js
git commit -m "ui(landschaften): \"Regionname anzeigen\" ist gesperrt, solange die Flaeche nur ihren Auto-Namen traegt"
```

---

## Aufgabe 3: Eine frisch gezeichnete Fläche beschriftet sich nicht selbst

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-draw.js` (~Z. 344, Aufruf von `createEcosystemRegionLabel`)
- Test: `js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js` (in Aufgabe 4 angelegt —
  **diese Aufgabe legt ihn an**, Aufgabe 4 erweitert ihn)

**Schnittstellen:**
- Verbraucht: nichts aus früheren Aufgaben.
- Erzeugt: nichts, worauf spätere Aufgaben zugreifen.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js`:

```js
// Wer schreibt `show_name`? — der Zähler, nicht die Zahl im Kommentar.
//
// 💣 AGENTS.md hält zweimal fest, dass eine ZAHL in einem Kommentar sich wie eine vollständige Liste
// liest und deshalb niemand weitersucht (die Vier-Erzeuger-Falle der Querfeldein-Kanten, 14.08.2026:
// dort stand „ERZEUGER 1 VON 2", und es waren vier). Also wird hier gezählt statt aufgezählt.
//
// Vorbild: api/_internal/map/__tests__/field-origins-test.php, das die Schreibwege zur Laufzeit zählt
// und dabei einen fand, den sein Autor übersehen hatte.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");

const draw = lies("js/map-features/map-features-ecosystem-draw.js");

// ---- Die Neuanlage beschriftet nicht ------------------------------------------------------------
//
// 🔴 Eine frisch gezeichnete Fläche trägt IMMER einen Auto-Namen (`Fläche-101`) -- die Art wird erst
// danach im Dialog gewählt. Es gibt also keinen Fall, in dem `true` hier richtig wäre. Das Label
// entsteht trotzdem: Ort, Größe, Zoom-Band und Nodix sollen beim späteren Einschalten schon dastehen.
const anlage = draw.slice(draw.indexOf("await createEcosystemRegionLabel(regionPublicId"));
const ersterAufruf = anlage.slice(0, anlage.indexOf(";") + 1);
assert.ok(
	/createEcosystemRegionLabel\(\s*regionPublicId\s*,\s*geometry\s*,\s*name\s*,\s*false\s*,/.test(ersterAufruf),
	"Die Neuanlage muss showName=false übergeben. Gefunden:\n" + ersterAufruf
);

// ⚠️ Und NICHT weglassen: der Server setzt bei fehlendem show_name `?? true`
// (api/_internal/map/features.php, avesmapsCreateLabelFeature). Ein ausdrückliches false ist die
// einzige Fassung, die auch dann hält, wenn jemand den Aufruf umbaut.
assert.ok(
	draw.includes("show_name: Boolean(showName)"),
	"createEcosystemRegionLabel muss show_name ausdrücklich mitschicken — ein Weglassen schriebe true."
);
```

- [ ] **Schritt 2: Den Test laufen lassen, damit er fehlschlägt**

```bash
node js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js
```

Erwartet: FEHLSCHLAG mit „Die Neuanlage muss showName=false übergeben" — heute steht dort `true`.

- [ ] **Schritt 3: Den Aufruf umstellen**

In `js/map-features/map-features-ecosystem-draw.js` den Kommentarblock über der Neuanlage und den
Aufruf ersetzen:

```js
		// 🔴 JEDE Region bekommt automatisch ihr Karten-Label (Owner 2026-07-27) -- am Point of
		// Inaccessibility, mit denselben Eigenschaften wie jedes andere Label.
		//
		// 🔴 GEZEICHNET wird es aber NICHT (Owner 25.08.2026). Eine frisch gezeichnete Fläche heisst
		// `Fläche-101` -- ein interner Griff, kein Name, und der gehört nicht auf die Karte. Bis dahin
		// stand hier `true`, und genau daher stammen die acht Beschriftungen, die der Owner gemeldet hat.
		// Das Label ENTSTEHT weiter: Ort, Grösse, Zoom-Band und Nodix sollen dastehen, sobald die Fläche
		// einen echten Namen bekommt und der Haken im Dialog frei wird.
		// Art ist beim Zeichnen noch leer -- das Label startet als „region" und zieht nach, sobald im
		// Dialog eine Art gewählt wird.
		await createEcosystemRegionLabel(regionPublicId, geometry, name, false, "");
```

- [ ] **Schritt 4: Den Test laufen lassen, damit er besteht**

```bash
node js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js
```

Erwartet: kein Ausgabetext, Exit-Code 0.

- [ ] **Schritt 5: Commit**

```bash
git add js/map-features/map-features-ecosystem-draw.js js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js
git commit -m "fix(landschaften): eine neu gezeichnete Flaeche schreibt nicht mehr ihren Griff auf die Karte"
```

---

## Aufgabe 4: Der Schreibwege-Zähler

**Dateien:**
- Ändern: `js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js` (aus Aufgabe 3)

**Schnittstellen:**
- Verbraucht: die Testdatei aus Aufgabe 3.
- Erzeugt: nichts.

Diese Aufgabe fügt **keinen Produktionscode** hinzu. Sie schliesst die Lücke, durch die eine spätere
Sitzung einen fünften Schreibweg einbauen könnte, ohne dass es jemandem auffällt.

- [ ] **Schritt 1: Den Zähler anhängen**

An `js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js` anhängen:

```js
// ---- Die Zählung ---------------------------------------------------------------------------------
//
// Vier Stellen im Client setzen `show_name`, jede aus einem anderen Grund. Taucht eine fünfte auf,
// schlägt dieser Test an -- und der Autor muss entscheiden, ob sie den Riegel aus
// syncPropertiesShowName ebenfalls braucht. Ohne das wäre die Regel wieder eine, die einen von
// mehreren Erzeugern bindet.
const QUELLEN = [
	"js/map-features/map-features-ecosystem-draw.js",
	"js/map-features/map-features-ecosystem-properties.js",
	"js/map-features/map-features-labels.js",
];

const BEKANNT = [
	// 1 · Neuanlage eines Regionslabels -- seit 25.08.2026 ausdrücklich false (siehe oben).
	{ datei: "map-features-ecosystem-draw.js", stelle: "show_name: Boolean(showName)" },
	// 2 · applyRegionToLabels: die ÜBRIGEN Labels derselben Region erben den Zustand des Labels,
	//     nicht den des Hakens -- es geht dort um Art und Name, nicht um Sichtbarkeit.
	{ datei: "map-features-ecosystem-properties.js", stelle: "show_name: label.showName !== false" },
	// 3 · renameLinkedEcosystemLabel: liest den Haken, und der ist seit 25.08.2026 gebunden.
	{ datei: "map-features-ecosystem-properties.js", stelle: "show_name: showName" },
	// 4 · „Label duplizieren": eine KOPIE erbt die Sichtbarkeit des Originals. Kein eigener Riegel
	//     nötig -- ein Original mit generischem Namen steht seit dem Einmal-Lauf ohnehin auf false.
	{ datei: "map-features-labels.js", stelle: "show_name: entry.label.showName !== false" },
];

let gefunden = 0;
for (const pfad of QUELLEN) {
	const inhalt = lies(pfad);
	gefunden += (inhalt.match(/show_name:/g) || []).length;
}

for (const eintrag of BEKANNT) {
	const inhalt = lies(QUELLEN.find((p) => p.endsWith(eintrag.datei)));
	assert.ok(
		inhalt.includes(eintrag.stelle),
		`Der bekannte Schreibweg „${eintrag.stelle}" steht nicht mehr in ${eintrag.datei}. `
			+ "Wurde er umgebaut, gehört dieser Test mit umgebaut -- nicht die Zeile hier gelöscht."
	);
}

assert.strictEqual(
	gefunden,
	BEKANNT.length,
	`Es gibt ${gefunden} Stellen, die show_name setzen, bekannt sind ${BEKANNT.length}. `
		+ "Eine neue muss entscheiden, ob sie bei einem generischen Namen false schreiben muss "
		+ "(siehe syncPropertiesShowName) — und dann hier eingetragen werden."
);
```

- [ ] **Schritt 2: Den Test laufen lassen**

```bash
node js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js
```

Erwartet: besteht. Schlägt er mit einer anderen Zahl als 4 an, ist die Liste `BEKANNT`
unvollständig — **die gefundene Stelle prüfen, nicht die Zahl anpassen.**

- [ ] **Schritt 3: Commit**

```bash
git add js/map-features/__tests__/ecosystem-show-name-schreibwege.test.js
git commit -m "test(landschaften): die Schreibwege von show_name werden gezaehlt, nicht aufgezaehlt"
```

---

## Aufgabe 5: Der Sammel-Endpunkt

**Dateien:**
- Ändern: `api/_internal/app/ecosystem.php` (neue Funktion `avesmapsEcosystemHideRegionLabels`)
- Ändern: `api/edit/map/ecosystem.php` (Dispatcher-Eintrag)
- Test: `api/_internal/app/__tests__/ecosystem-hide-labels-test.php` (neu)

**Schnittstellen:**
- Verbraucht: nichts aus früheren Aufgaben.
- Erzeugt: `POST /api/edit/map/ecosystem.php` mit
  `{ action: "hide_region_labels", label_public_ids: string[], dry_run?: bool, confirm?: "apply" }`
  → `{ ok: true, matched: int, updated: int, skipped: int, dry_run: bool }`.
  Aufgabe 6 ruft genau das auf.

🔴 **Der Server prüft NICHT, ob ein Name generisch ist.** Die Auto-Namen-Regel lebt in JS, samt der
Abbildung Art-Key → Art-Label; sie hier nachzubauen wäre die zweite Wahrheit aus AGENTS.md §5 —
dieselbe Begründung, aus der beim Wiki-Override der Client sagen muss, was aus dem Wiki kam. Der
Server bekommt eine Liste und führt sie aus.

💣 **Er führt sie aber nicht blind aus.** Angenommen werden **nur Labels, die an einer
Landschaftsregion hängen** — sonst wäre das ein Endpunkt, der jede beliebige Beschriftung der Karte
unsichtbar schaltet. Das kann der Server prüfen, ohne die Namensregel zu kennen.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `api/_internal/app/__tests__/ecosystem-hide-labels-test.php`:

```php
<?php
declare(strict_types=1);

// Der Sammel-Lauf, der generischen Landschaftsbeschriftungen ihr `show_name` nimmt.
//
// 🔴 Der Server entscheidet NICHT, was generisch ist -- das tut der Browser mit der geteilten,
// unit-getesteten Regel (js/map-features/map-features-ecosystem-naming.js). Hier wird geprueft, dass
// er die Liste ausfuehrt, dabei nichts anderes anfasst, und dass er sich weigert, ein Label
// auszublenden, das an keiner Landschaftsregion haengt.

require_once __DIR__ . '/../ecosystem.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT,
    feature_type TEXT,
    properties_json TEXT,
    is_active INTEGER DEFAULT 1
)');
$pdo->exec('CREATE TABLE ecosystem_region (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT,
    name TEXT,
    label_public_id TEXT,
    is_active INTEGER DEFAULT 1
)');
// Der scharfe Lauf schreibt EINE Protokollzeile -- ohne diese Tabelle stirbt er in
// avesmapsEcosystemWriteAuditLog, und der Test haette den Audit-Pfad nie ausgefuehrt.
$pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    actor_user_id INTEGER,
    area_public_id TEXT,
    region_public_id TEXT,
    before_json TEXT,
    after_json TEXT,
    operation_id TEXT,
    operation_label TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)');

// Zwei Labels an Regionen, eines ohne Region.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, properties_json) VALUES
    ('lab-1', 'label', '{\"show_name\":true,\"size\":18}'),
    ('lab-2', 'label', '{\"show_name\":true,\"size\":22}'),
    ('lab-frei', 'label', '{\"show_name\":true}')");
$pdo->exec("INSERT INTO ecosystem_region (public_id, name, label_public_id) VALUES
    ('reg-1', 'Wald-025', 'lab-1'),
    ('reg-2', 'Fläche-101', 'lab-2')");

// ---- Trockenlauf schreibt nichts ------------------------------------------------------------------
$trocken = avesmapsEcosystemHideRegionLabels($pdo, [
    'label_public_ids' => ['lab-1', 'lab-2'],
    'dry_run' => true,
], 1);
assert($trocken['matched'] === 2, 'Der Trockenlauf muss beide Labels finden.');
assert($trocken['updated'] === 0, 'Der Trockenlauf darf NICHTS schreiben.');
assert($trocken['dry_run'] === true);

$stand = $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'lab-1'")->fetchColumn();
assert(str_contains((string) $stand, '"show_name":true'), 'Der Trockenlauf hat geschrieben.');

// ---- Der scharfe Lauf braucht BEIDES ---------------------------------------------------------------
// dry_run=false allein reicht nicht -- dasselbe Muster wie assign_wiki_region.
$halb = avesmapsEcosystemHideRegionLabels($pdo, [
    'label_public_ids' => ['lab-1'],
    'dry_run' => false,
], 1);
assert($halb['updated'] === 0, 'Ohne confirm=apply darf nichts geschrieben werden.');

$scharf = avesmapsEcosystemHideRegionLabels($pdo, [
    'label_public_ids' => ['lab-1', 'lab-2'],
    'dry_run' => false,
    'confirm' => 'apply',
], 1);
assert($scharf['updated'] === 2, 'Der scharfe Lauf muss beide schreiben, bekam: ' . $scharf['updated']);

$nachher = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'lab-1'")->fetchColumn(), true);
assert($nachher['show_name'] === false, 'show_name steht nicht auf false.');
// 💣 Und NICHTS anderes: der Lauf schreibt ein Feld, nicht den ganzen Satz.
assert($nachher['size'] === 18, 'Der Lauf hat andere Eigenschaften des Labels angefasst.');

// 🔴 EINE Protokollzeile je Lauf, nicht je Label -- sonst laeuft avesmapsPruneAuditLog 108-mal.
$zeilen = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_geometry_audit_log')->fetchColumn();
assert($zeilen === 1, 'Erwartet: genau eine Protokollzeile fuer den ganzen Lauf, gefunden: ' . $zeilen);

// ---- Ein Label ohne Region wird abgelehnt -----------------------------------------------------------
// 💣 Sonst waere das ein Endpunkt, der jede Beschriftung der Karte unsichtbar schaltet.
$fremd = avesmapsEcosystemHideRegionLabels($pdo, [
    'label_public_ids' => ['lab-frei'],
    'dry_run' => false,
    'confirm' => 'apply',
], 1);
assert($fremd['matched'] === 0, 'Ein Label ohne Landschaftsregion darf nicht gefunden werden.');
assert($fremd['skipped'] === 1, 'Es muss als uebergangen gemeldet werden, nicht stillschweigend fehlen.');
$freiStand = $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'lab-frei'")->fetchColumn();
assert(str_contains((string) $freiStand, '"show_name":true'), 'Ein fremdes Label wurde angefasst.');

// ---- Eine leere Liste ist kein Fehler, aber auch kein Lauf --------------------------------------------
$leer = avesmapsEcosystemHideRegionLabels($pdo, ['label_public_ids' => [], 'dry_run' => true], 1);
assert($leer['matched'] === 0 && $leer['updated'] === 0);

echo "ecosystem-hide-labels-test: OK\n";
```

- [ ] **Schritt 2: Den Test laufen lassen, damit er fehlschlägt**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-hide-labels-test.php
```

Erwartet: `Error: Call to undefined function avesmapsEcosystemHideRegionLabels()`.

- [ ] **Schritt 3: Die Funktion schreiben**

An `api/_internal/app/ecosystem.php` anhängen (⚠️ die Datei ist auf Englisch kommentiert — hier
gilt Deutsch, weil die umliegenden neueren Blöcke deutsch sind; im Zweifel die Sprache der
Nachbarfunktion übernehmen):

```php
/**
 * Nimmt einer Liste von Landschaftsbeschriftungen ihr `show_name` (25.08.2026).
 *
 * 🔴 DER SERVER ENTSCHEIDET NICHT, WAS GENERISCH IST. Die Auto-Namen-Regel lebt in
 * js/map-features/map-features-ecosystem-naming.js, samt der Abbildung Art-Key -> Art-Label; sie hier
 * nachzubauen waere die zweite Wahrheit aus AGENTS.md §5. Der Browser rechnet, der Server fuehrt aus.
 *
 * 💣 ABER NICHT BLIND: angenommen werden nur Labels, die an einer Landschaftsregion haengen. Ohne diese
 * Schranke waere das ein Endpunkt, der jede beliebige Beschriftung der Karte unsichtbar schaltet -- und
 * die Schranke braucht die Namensregel nicht zu kennen.
 *
 * 💣 Trockenlauf ist die Vorgabe. Scharf wird er nur mit dry_run=false UND confirm='apply' -- dasselbe
 * Muster wie avesmapsAssignEcosystemWikiRegion, aus demselben Grund: ein Massenschreibvorgang auf
 * Livedaten braucht zwei Entscheidungen, nicht eine.
 */
function avesmapsEcosystemHideRegionLabels(PDO $pdo, array $payload, int $userId): array
{
    $angefragt = [];
    foreach ((array) ($payload['label_public_ids'] ?? []) as $kandidat) {
        $wert = avesmapsNormalizeSingleLine((string) $kandidat, 64);
        if ($wert !== '') {
            $angefragt[$wert] = true;
        }
    }
    $angefragt = array_keys($angefragt);

    $trocken = !isset($payload['dry_run']) || avesmapsReadBoolean($payload['dry_run']);
    $bestaetigt = (string) ($payload['confirm'] ?? '') === 'apply';

    if ($angefragt === []) {
        return ['ok' => true, 'matched' => 0, 'updated' => 0, 'skipped' => 0, 'dry_run' => $trocken];
    }

    // Nur Labels, die eine aktive Landschaftsregion als ihre Beschriftung fuehrt.
    $platzhalter = implode(',', array_fill(0, count($angefragt), '?'));
    $statement = $pdo->prepare(
        'SELECT f.public_id, f.properties_json
           FROM map_features f
           JOIN ecosystem_region r ON r.label_public_id = f.public_id
          WHERE f.public_id IN (' . $platzhalter . ')
            AND f.is_active = 1
            AND r.is_active = 1'
    );
    $statement->execute($angefragt);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $matched = count($zeilen);
    $skipped = count($angefragt) - $matched;

    if ($trocken || !$bestaetigt) {
        return ['ok' => true, 'matched' => $matched, 'updated' => 0, 'skipped' => $skipped, 'dry_run' => true];
    }

    $schreiber = $pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?');
    $updated = 0;
    foreach ($zeilen as $zeile) {
        $eigenschaften = json_decode((string) ($zeile['properties_json'] ?? '{}'), true);
        if (!is_array($eigenschaften)) {
            $eigenschaften = [];
        }
        // 💣 EIN Feld, nicht der ganze Satz: Groesse, Drehung, Zoom-Band und Nodix bleiben stehen,
        // damit das Wiedereinschalten spaeter nichts nachbauen muss.
        $eigenschaften['show_name'] = false;
        $schreiber->execute([
            json_encode($eigenschaften, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            (string) $zeile['public_id'],
        ]);
        $updated += $schreiber->rowCount() > 0 ? 1 : 0;
    }

    // 🔴 EINE Protokollzeile je LAUF, nicht je Label -- dasselbe Muster wie bei der Uebernahme-Vorschau.
    // 💣 Und hier ist es zusaetzlich eine Kostenfrage: avesmapsEcosystemWriteAuditLog ruft bei JEDEM
    // Aufruf avesmapsPruneAuditLog. 108 Aufrufe waeren 108 Aufraeumlaeufe ueber dieselbe Tabelle.
    if ($updated > 0) {
        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'hide_region_labels',
            $userId,
            null,
            null,
            ['show_name' => true, 'label_public_ids' => array_column($zeilen, 'public_id')],
            ['show_name' => false, 'updated' => $updated, 'skipped' => $skipped]
        );
    }

    return ['ok' => true, 'matched' => $matched, 'updated' => $updated, 'skipped' => $skipped, 'dry_run' => false];
}
```

⚠️ `avesmapsEcosystemWriteAuditLog` erwartet `area_public_id` und `region_public_id` — beide sind hier
`null`, weil der Lauf keiner einzelnen Fläche gilt. Prüfe, dass die Spalten nullable sind
(`grep -n "area_public_id" api/_internal/app/ecosystem.php`); sind sie es nicht, gehört die
Protokollzeile ohne sie geschrieben, **nicht** mit einer erfundenen ID gefüllt.

⚠️ Prüfe vor dem Schreiben, ob `avesmapsNormalizeSingleLine` und `avesmapsReadBoolean` in dieser Datei
bereits erreichbar sind (`grep -n "avesmapsReadBoolean" api/_internal/app/ecosystem.php`). Fehlen sie,
das `require_once` der Datei ergänzen, die sie trägt — **nicht** eine eigene Fassung schreiben.

- [ ] **Schritt 4: Den Test laufen lassen, damit er besteht**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-hide-labels-test.php
```

Erwartet: `ecosystem-hide-labels-test: OK`.

💣 Falls für die Fixture eine SQL-Form umgeschrieben werden müsste, damit SQLite sie fährt: **nicht
tun.** AGENTS.md §9 hält fest, dass ein SQLite-Test so eine MySQL-Regression erzwingen kann
(Error 1093). Geht beides nicht, gilt MySQL — und ein Kommentar an der Stelle sagt warum.

- [ ] **Schritt 5: Den Dispatcher-Eintrag setzen**

In `api/edit/map/ecosystem.php`, im `match ($action)`-Block, direkt nach `'delete_region' => …`:

```php
        // Der Einmal-Lauf gegen die generischen Beschriftungen (25.08.2026). Trockenlauf per Vorgabe;
        // scharf nur mit dry_run=false UND confirm='apply', wie assign_wiki_region.
        // 🔴 Die Liste kommt aus dem BROWSER: was ein generischer Name ist, entscheidet die geteilte
        // Regel in map-features-ecosystem-naming.js, nicht eine zweite Fassung hier (AGENTS.md §5).
        'hide_region_labels' => avesmapsEcosystemHideRegionLabels($pdo, $payload, $userId),
```

- [ ] **Schritt 6: Den vollen PHP-Lauf fahren**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```

Erwartet: nur der vorbestehend rote `linkcheck/link-url-test.php`.

- [ ] **Schritt 7: Commit**

```bash
git add api/_internal/app/ecosystem.php api/edit/map/ecosystem.php api/_internal/app/__tests__/ecosystem-hide-labels-test.php
git commit -m "feat(landschaften): Sammel-Lauf nimmt generischen Beschriftungen ihr show_name (Trockenlauf per Vorgabe)"
```

---

## Aufgabe 6: Der Knopf im Landschaften-Editor

**Dateien:**
- Ändern: `html/landschaften-editor.html`

**Schnittstellen:**
- Verbraucht: `artLabelOf(region)` (~Z. 1343 — erwartet `region.kind` und `region.region_type`),
  `loadAreas()` (~Z. 840 — liefert `data.areas` aus `AREAS_API`), `ecoPost(action, payload)`
  (~Z. 198, **zwei Argumente**), `setStatus(text, tone)` (~Z. 234), und den Endpunkt
  `hide_region_labels` aus Aufgabe 5.
- Erzeugt: nichts.

🔴 **Hier, nicht im Flächenmenü der Karte.** Diese Seite lädt die Namensregel bereits
(`html/landschaften-editor.html:153`) und führt `isAutoName`/`artLabelOf` bereits.

💣 **Gezählt wird über die FLÄCHENLISTE, nicht über `rows`.** `loadAreas()` liefert genau die
Struktur, an der die 108 am 25.08.2026 gemessen wurden — `region_name`, `region_type`,
`label_public_id`, `kind`, `region_public_id`, ohne bbox also der volle Bestand aller drei Ebenen.
`rows` dagegen ist die Vereinigung mit der Wiki-Seite; ob `label_public_id` dort mitreist, hängt am
Erzeuger der Zeile. Eine Zählung über `rows` wäre nicht die Messung, gegen die der Owner die Zahl
prüft.

💣 **Mehrere Flächen teilen sich eine Region** (1027 Flächen, 1026 Regionen) — entdoppelt wird über
`region_public_id`, sonst zählt eine Region mit drei Flächen dreifach und dieselbe Label-ID steht
dreimal in der Liste.

- [ ] **Schritt 1: Den Zähler schreiben**

Eine reine Funktion, neben `artLabelOf` einfügen:

```js
// Welche Beschriftungen tragen nur einen internen Griff? (25.08.2026)
//
// 🔴 Gerechnet wird HIER, im Browser, mit der geteilten Regel -- der Server kennt sie nicht und soll
// sie nicht kennen (zweite Wahrheit, AGENTS.md §5). Er bekommt am Ende nur eine Liste von IDs.
//
// 💣 Gemessen wird die REGION gegen IHRE Art, nie ein Muster `-<Zahl>` allein: `See-3` bei der Art
// „Insel" ist ein echter Name. Live am 25.08.2026: 423 Regionen tragen einen endziffrigen Namen, und
// nur 108 davon haben ueberhaupt eine Beschriftung.
//
// 💣 Ueber die FLAECHEN, entdoppelt nach Region: 1027 Flaechen verteilen sich auf 1026 Regionen, und
// eine Region mit drei Flaechen stuende sonst dreimal in der Liste.
function generischeBeschriftungen(areas) {
	const gesehen = new Set();
	const treffer = [];
	(areas || []).forEach((area) => {
		const regionId = String(area.region_public_id || "");
		if (regionId === "" || gesehen.has(regionId)) {
			return;
		}
		gesehen.add(regionId);
		const labelId = String(area.label_public_id || "");
		if (labelId === "") {
			return;   // ohne Beschriftung gibt es nichts auszublenden
		}
		// artLabelOf liest `kind` und `region_type` -- beide traegt die Flaechenzeile unter denselben
		// Namen. Der NAME heisst hier `region_name`, nicht `name`.
		const artLabel = artLabelOf({ kind: area.kind, region_type: area.region_type });
		if (!isEcosystemRegionAutoName(area.region_name, artLabel)) {
			return;
		}
		treffer.push({
			label_public_id: labelId,
			name: String(area.region_name || ""),
			kind: String(area.kind || ""),
		});
	});
	return treffer;
}
```

⚠️ `artLabelOf` filtert über `regionTypes` — die Vokabelliste muss geladen sein, bevor gezählt wird.
Ist sie leer, liefert sie für **jede** Region `""`, und dann zählt der Lauf nur noch die
`Fläche-NNN` (der Fallback-Zweig aus Aufgabe 1) statt aller 108. Eine zu kleine Zahl, die aussieht
wie ein Ergebnis. Prüfe vor dem Zählen `regionTypes.length > 0` und brich sonst mit einer Meldung ab.

- [ ] **Schritt 2: Den Knopf einhängen**

Zwei Klicks, wie im Entwurf §5. Der erste zählt und zeigt nur, der zweite schreibt:

```js
// Trockenlauf ist der Normalzustand des Knopfes; das Schreiben ist der zweite Klick.
async function beschriftungenAufraeumen(scharf) {
	if (!Array.isArray(regionTypes) || regionTypes.length === 0) {
		setStatus("Die Artenliste ist noch nicht geladen — ohne sie zählt der Lauf zu wenig.", "warn");
		return;
	}
	const treffer = generischeBeschriftungen(await loadAreas());
	if (treffer.length === 0) {
		setStatus("Keine Beschriftung trägt nur einen Auto-Namen.");
		return;
	}
	if (!scharf) {
		const nachEbene = {};
		treffer.forEach((t) => { nachEbene[t.kind] = (nachEbene[t.kind] || 0) + 1; });
		const aufschluesselung = Object.entries(nachEbene)
			.map(([kind, anzahl]) => `${kind}: ${anzahl}`)
			.join(" · ");
		setStatus(`${treffer.length} Beschriftungen tragen nur einen Auto-Namen (${aufschluesselung}). `
			+ "Noch einmal klicken, um sie auszublenden.", "warn");
		return;
	}
	// ⚠️ ecoPost nimmt ZWEI Argumente (action, payload) und schreibt ueber window.parent -- die Seite
	// laeuft als iframe im Hauptfenster. Allein geoeffnet lehnt sie mit einer klaren Meldung ab.
	const antwort = await ecoPost("hide_region_labels", {
		label_public_ids: treffer.map((t) => t.label_public_id),
		dry_run: false,
		confirm: "apply",
	});
	setStatus(`${antwort.updated} Beschriftungen ausgeblendet`
		+ (antwort.skipped ? `, ${antwort.skipped} übergangen (keine Landschaftsregion).` : "."), "ok");
}
```

⚠️ Den Knopf selbst zu den vorhandenen Werkzeugen dieser Seite stellen, in der dortigen Bauform —
**keine zweite Statuszeile und keinen zweiten Schreibweg daneben bauen.** `setStatus` nimmt einen
`tone`; verwende die Werte, die die Seite bereits kennt (`grep -n "setStatus(" html/landschaften-editor.html`).

- [ ] **Schritt 3: Den Trockenlauf fahren und die Zahl melden**

Seite im Browser öffnen, den Knopf **einmal** klicken, die gemeldete Zahl notieren.

Erwartet nach der Messung vom 25.08.2026: **um die 108**, aufgeteilt auf topographie (~49),
vegetation (~37+) und derographisch (~1). Weicht die Zahl stark ab, **nicht** scharf stellen,
sondern nachsehen: eine zu kleine Zahl heisst meist halb geladene Listen (siehe 💣 oben), eine zu
grosse heisst, dass `isAutoName` mehr fängt als gedacht.

🔧 **DU (Owner):** Diese Zahl ist die Entscheidung. Erst nach deinem Blick der zweite Klick.

- [ ] **Schritt 4: Commit**

```bash
git add html/landschaften-editor.html
git commit -m "ui(landschaften): Knopf raeumt Beschriftungen auf, die nur einen Auto-Namen tragen"
```

---

## Aufgabe 7: Abnahme am laufenden System

**Dateien:** keine.

💣 **Abnahme heisst ABLAUF, nicht Mass** (AGENTS.md §9). Eine grüne Testtabelle belegt nur, dass eine
Zahl stimmt. Diese Handgriffe werden ausgeführt und einzeln benannt:

- [ ] **Schritt 1: Das ganze Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```

Ein einziger roter Test lädt **nichts** hoch — der Deploy ist ein Tor. Läuft er rot in einer Datei,
die dir nicht gehört: trotzdem reparieren oder melden, nicht umgehen.

- [ ] **Schritt 2: Die vier Handgriffe im Browser**

1. Eine Fläche **neu zeichnen** → sie trägt keine Beschriftung auf der Karte (Aufgabe 3).
2. Ihren Dialog öffnen → „Regionname anzeigen" ist grau, leer, und der Mauszeiger darüber nennt den Grund.
3. Eine **Art wählen** → der Name springt auf `Wald-0NN`, der Haken bleibt grau.
4. Einen **echten Namen tippen** („Farindel") → der Haken wird frei **und vorgehakt**; speichern; die
   Beschriftung erscheint auf der Karte.
5. Den Dialog **erneut öffnen** → der Haken steht so, wie gespeichert (nicht erneut vorgehakt).

- [ ] **Schritt 3: Die eigene Abnahmeliste abhaken**

Jede Zeile mit 💣 / ⚠️ / 🔴 / 🪤 im Entwurf einzeln durchgehen: erfüllt, oder ausdrücklich verworfen
mit Begründung. Zwei der vier Regressionen vom 10.08.2026 standen wörtlich als Warnung im eigenen
Entwurf und wurden nicht gebaut — es fehlte kein Wissen, sondern das Abhaken.

- [ ] **Schritt 4: Die zwei Prüf-Sub-Agenten**

Vor dem Push: `usability-konsistenz` (Entwurf gegen Diff) und `usability-design` (gebauter Zustand
gegen Designsprache, hell UND dunkel).

- [ ] **Schritt 5: Push, einzeln**

Die sichtbaren Änderungen (Aufgabe 2, 3, 6) gehen **einzeln** live, mit einem Blick des Owners
dazwischen. Nach jedem Push die Remote-SHA prüfen und die Live-Seite erst nach ~1–2 min ansehen.

---

## Offen nach diesem Plan

- 🔧 **Labels über den eigenen Rückzeiger** (`ecosystem_region_public_id`) statt über
  `label_public_id`: Aufgabe 5 findet sie nicht (der `JOIN` geht über `label_public_id`), und
  Aufgabe 6 zählt sie nicht. Sind nach dem Lauf noch generische Beschriftungen sichtbar, ist das die
  Stelle — der `JOIN` bekäme dann ein `OR f.properties_json ->> '$.ecosystem_region_public_id' = r.public_id`.
  Bewusst nicht vorgebaut: ungemessen, und eine ungemessene Erweiterung des Suchraums bei einem
  Massenschreibvorgang ist die falsche Richtung.
- 🔧 **Der Altbestand der 36 `Fläche-NNN` mit Art** benennt sich erst um, wenn jemand die Region im
  Dialog anfasst (Entwurf §1). Ein Serienlauf dafür ist bewusst **nicht** Teil dieses Plans.
