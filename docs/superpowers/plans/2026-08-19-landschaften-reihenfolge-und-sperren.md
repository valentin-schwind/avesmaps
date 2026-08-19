# Landschaften: Reihenfolge und Sperren — Bauplan

> **Für agentische Ausführung:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte tragen Checkboxen (`- [ ]`).

**Entwurf:** `docs/superpowers/specs/2026-08-19-landschaften-reihenfolge-und-sperren-design.md`
**Mockup:** `docs/landschaften-sperren-mockup.html`

**Ziel:** Eine Landschafts-Region bekommt zwei Karteneigenschaften — ihren Platz im Stapel und die
Frage, ob sie Klicks abfängt. Die heutige Größenregel wird dabei zur einmaligen Startaufstellung und
danach gelöscht. Vorher wird das Flächenmenü von 17 auf 9 Einträge aufgeräumt.

**Architektur:** `ecosystem_region` bekommt `stack_order` und `is_locked`. Ein einmaliger Server-Lauf
im ALTER-Zweig füllt `stack_order` aus der Flächensumme je Region; danach ist die gespeicherte Zahl
die einzige Ordnung, und `ecosystemStackingOrder` im Browser verschwindet. Die Sperre ist **kein**
`pointer-events: none` (das nähme den Schwebezettel), sondern eine gemeinsame Weiche vor allen vier
Klick-Eingängen der Fläche.

**Technik:** Vanilla JS ohne Bauschritt (Ladereihenfolge in `index.html` ist Vertrag), Leaflet 1.9.4,
PHP 8 strict types + PDO. Tests: `node` mit `assert` und `vm.runInThisContext`; PHP mit `assert()`
und `-d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll`.

## Globale Zusicherungen

Gelten für **jede** Aufgabe:

- **Kommentare und Commit-Meldungen auf DEUTSCH** (AGENTS.md §8). `error.code`-Werte bleiben englisch.
- **Nur eigene Pfade stagen.** Der Arbeitsbaum ist geteilt und trägt beim Schreiben dieses Plans
  **27 fremde, noch nicht gepushte Commits** sowie offene fremde Arbeit. Niemals `git add -A`,
  `git add .`, `git commit -a`. Vor jedem Commit `git status`, danach `git diff --staged` LESEN.
- 🔴 **Gepusht wird über einen Prüfbaum, nicht aus dem Hauptbaum.** `git push origin master` würde
  die 27 fremden Commits mit live schicken. Der Weg steht in Aufgabe A4 bzw. B10 ausgeschrieben.
- **Kein `?v=` von Hand** (AGENTS.md §7). **Kein `ASSET_VERSION`-Bump** — der gehört den dynamisch
  geladenen Territorien-Editor-Assets, und keine Datei dieses Plans gehört dazu.
- **Nichts hartkodieren, was ein Token hat** (AGENTS.md §12): Farben, Radien, Trennlinien aus
  `css/base/tokens.css`. Schriftgrößen unter 11px sind verboten. Kein Blau in der Bedienoberfläche.
- 🔴 **Teil A und Teil B gehen GETRENNT live** (AGENTS.md §9: sichtbare Änderungen einzeln, der Owner
  sieht jede). A4 ist das erste Tor, B10 das zweite. Zwischen beiden wartet man auf den Blick des
  Owners.
- 💣 **Vor jedem Push das GANZE Testfeld**, nicht die eigenen Tests:
  `for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done`
  `for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done`
  `for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done`
  ⚠️ Vorbestehend rot ist genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- 💣 **Ein SQLite-Test darf keine MySQL-Regression erzwingen** (AGENTS.md §9, 16.08.2026). Wo beides
  nicht geht, gilt MySQL, und ein Kommentar sagt warum.
- ⚠️ **Klimazonen bleiben überall draußen** — `kind = 'klima'` bekommt weder Reihenfolge noch Sperre.

---

## Dateiübersicht

**Teil A — Menü aufräumen**

| Datei | Verantwortung | Änderung |
|---|---|---|
| `js/map-features/map-features-ecosystem-context-action.js` | baut und besitzt das Flächenmenü | Gruppen verallgemeinern (heute nur `new-area`) |
| `js/map-features/map-features-ecosystem-geometry-ops.js` | Verschieben, Zerschneiden, 4 Verrechnungen, 3 Unterflächen | Einträge bekommen `group` |
| `js/map-features/map-features-ecosystem-brush.js` | Malen, Radieren | Einträge bekommen `group` |
| `js/map-features/map-features-ecosystem-simplify.js` | Vereinfachen | Eintrag bekommt `group` |
| `css/components/map-context-menu.css` | Glyphen und Menü-Optik | drei Glyphen für die neuen Untermenü-Öffner |
| `index.html` | Markup von `#region-context-menu` | dieselben Gruppen im Herrschaftsgebiete-Menü |
| `js/map-features/__tests__/ecosystem-menue-struktur.test.js` | **neu** | jede Aktion hat eine Glyphe; jede Gruppe hat Einträge |

**Teil B — Reihenfolge und Sperre**

| Datei | Verantwortung | Änderung |
|---|---|---|
| `api/_internal/app/ecosystem-flaeche.php` | **neu** — reine Flächenrechnung (Gauß, Löcher abgezogen) | |
| `api/_internal/app/ecosystem.php` | DDL, Lesen, Schreiben | 2 Spalten, Seed, 2 Felder, 2 Leser |
| `api/app/ecosystem-areas.php` | öffentlicher Leser | (unverändert — der Leser trägt die Felder von selbst mit) |
| `js/map-features/map-features-ecosystem-rendering.js` | Layer, Klicks, Stapelung | Größenregel raus, `stack_order` rein, Sperr-Weiche |
| `js/map-features/map-features-ecosystem-sperre.js` | **neu** — die Weiche und das Weiterreichen | |
| `js/map-features/map-features-ecosystem-stapel.js` | **neu** — Menüeinträge, Schreibaufrufe, Fenster | |
| `js/map-features/map-features-ecosystem-properties.js` | Eigenschaften-Dialog | vierter Haken |
| `js/map-features/map-features-ecosystem-layer-switch.js` | Ebenen-Leiste | Zähler-Knopf |
| `index.html` | Markup | Haken im Dialog, Fenster, Skript-Tags |
| `css/features/ecosystem-layer.css` | Optik der Ebene | Fenster-Liste |

---

# TEIL A — das Flächenmenü aufräumen

### Aufgabe A1: Untermenü-Gruppen verallgemeinern

Heute kennt `addEcosystemAreaMenuEntry` genau **eine** Gruppe (`AREA_GROUP_NEW`), fest verdrahtet:

```js
if (String(group) === AREA_GROUP_NEW) {
    ensureAreaMenuGroup(menu).appendChild(button);
    return button;
}
```

Daraus wird ein Register aus vier Gruppen. Nichts an der Bauform ändert sich — es bleibt
`.map-context-menu__group` > `.map-context-menu__item--submenu` + `.map-context-submenu`, damit das
vorhandene CSS greift und es kein zweites Untermenü-Aussehen im Haus gibt.

**Files:**
- Modify: `js/map-features/map-features-ecosystem-context-action.js:60-76` (Konstanten),
  `:530-560` (`ensureAreaMenuGroup`), `:563-596` (`addEcosystemAreaMenuEntry`)
- Test: `js/map-features/__tests__/ecosystem-menue-struktur.test.js` (neu)

**Interfaces:**
- Produces: `addEcosystemAreaMenuEntry({ action, label, onClick, group, danger })` — `group` nimmt
  jetzt `"new-area" | "form" | "mit-anderer" | "unterflaechen" | "stapel"` oder `""`.
  `window.AvesmapsEcosystemAreaMenu.addEntry` bleibt der einzige Weg von außen.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/ecosystem-menue-struktur.test.js`:

```js
// Die Menüstruktur: jede Aktion muss eine Glyphe haben, und jede Gruppe muss Einträge tragen.
// 💣 Ein Eintrag OHNE `content` im CSS erzeugt kein ::before -- dann wird die BESCHRIFTUNG zum
// ersten Rasterelement und beginnt bei 12 statt 41 px. Das ist in diesem Menü dreimal passiert.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const css = fs.readFileSync(path.join(wurzel, "css/components/map-context-menu.css"), "utf8");

function hatGlyphe(attribut, wert) {
    const regel = new RegExp(
        `\\[${attribut}="${wert}"\\]::before\\s*\\{[^}]*content:`,
        "s"
    );
    return regel.test(css);
}

// Die drei neuen Untermenü-Öffner tragen `data-ecosystem-area-group`, wie „Neue Fläche" es schon tut.
// ⚠️ Die vierte Gruppe `stapel` kommt erst in Aufgabe B6 dazu und wird dort hier ergänzt.
["form", "mit-anderer", "unterflaechen"].forEach((gruppe) => {
    assert.ok(
        hatGlyphe("data-ecosystem-area-group", gruppe),
        `Gruppe ${gruppe} hat keine Glyphenregel im CSS -- ihr Öffner beginnt dann bei 12 statt 41 px`
    );
});

console.log("ok - ecosystem-menue-struktur");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node js/map-features/__tests__/ecosystem-menue-struktur.test.js`
Expected: FAIL — „Gruppe form hat keine Glyphenregel im CSS"

- [ ] **Schritt 3: Das Gruppenregister bauen**

In `map-features-ecosystem-context-action.js`, bei den Konstanten (~Zeile 68), `AREA_GROUP_NEW`
stehen lassen und daneben:

```js
	// 🔴 EIN Register für alle Untermenüs des Flächenmenüs. Bis 19.08.2026 kannte diese Datei genau
	// eine Gruppe („Neue Fläche"), fest verdrahtet in addEcosystemAreaMenuEntry. Mit 17 Einträgen im
	// obersten Menü war das Menü keins mehr -- die drei Familien darunter standen im Code längst
	// beieinander, nur nicht in der Oberfläche.
	//
	// 🪤 Die Reihenfolge HIER ist die Reihenfolge im Menü. Sie kann nicht aus der
	// Registrierungsreihenfolge kommen: die ist die Skript-Reihenfolge in index.html, also eine
	// unausgesprochene Absprache zwischen fünf Dateien, die beim nächsten Verschieben eines
	// <script>-Tags lautlos zerfällt. Dieselbe Überlegung wie bei „Fläche bearbeiten".
	const AREA_GROUPS = [
		{ id: "new-area", key: "ecosystem.ctxmenu.areaMenuNewArea", label: "Neue Fläche" },
		{ id: "form", key: "ecosystem.ctxmenu.areaMenuForm", label: "Form ändern" },
		{ id: "mit-anderer", key: "ecosystem.ctxmenu.areaMenuWithOther", label: "Mit anderer Fläche" },
		{ id: "unterflaechen", key: "ecosystem.ctxmenu.areaMenuSubareas", label: "Unterflächen" },
	];

	// 💣 DIE REIHENFOLGE DES OBERSTEN MENÜS, VOLLSTÄNDIG — Gruppen UND Einzeleinträge in EINER Liste.
	// Ein Register nur über die Gruppen genügt nicht: die Zielreihenfolge verschränkt beides
	// („Neue Fläche ▸", dann „Fläche bearbeiten", dann drei Gruppen, dann „Eigenschaften …"). Ohne
	// die Einzeleinträge im selben Register gäbe es keinen Anker, an dem sich eine Gruppe relativ zu
	// ihnen einordnen könnte — die erste angelegte Gruppe landete dann hinter „Fläche bearbeiten"
	// oder davor, je nachdem, welche Datei zuerst geladen wurde. Genau die Zufälligkeit soll weg.
	//
	// ⚠️ Was hier NICHT steht, wandert ans Ende der nicht-gefährlichen Einträge — die bisherige
	// Regel gilt also für alles Unbekannte weiter, und ein neuer Eintrag muss diese Liste nicht
	// kennen. Gefährliches bleibt in jedem Fall zuletzt.
	const AREA_MENU_ORDER = [
		{ typ: "gruppe", id: "new-area" },
		{ typ: "aktion", id: "edit-geometry" },
		{ typ: "gruppe", id: "form" },
		{ typ: "gruppe", id: "mit-anderer" },
		{ typ: "gruppe", id: "unterflaechen" },
		{ typ: "aktion", id: "ecosystem-properties" },
		{ typ: "aktion", id: "send-to" },
	];
```

`AREA_GROUP_NEW` bleibt als Konstante bestehen (`"new-area"`), weil `registerAreaMenuNewAreaEntries`
sie benutzt.

- [ ] **Schritt 4: Die Einfügestelle aus dem Register bestimmen**

Ein Helfer, den **beide** Einfügewege benutzen — die Gruppe und der Einzeleintrag:

```js
	// Vor welches Element gehört ein neues Menüglied? Vor das erste, das im Register SPÄTER steht --
	// und wenn es keins gibt, vor den ersten gefährlichen Eintrag (die alte Regel, unverändert).
	function areaMenuEinfuegePunkt(menu, schluessel) {
		const rang = AREA_MENU_ORDER.findIndex((eintrag) => eintrag.id === schluessel);
		if (rang >= 0) {
			for (const eintrag of AREA_MENU_ORDER.slice(rang + 1)) {
				const treffer = eintrag.typ === "gruppe"
					? menu.querySelector(`.map-context-menu__group[${AREA_GROUP_ATTRIBUTE}="${eintrag.id}"]`)
					: menu.querySelector(`:scope > [${AREA_ACTION_ATTRIBUTE}="${eintrag.id}"]`);
				if (treffer) {
					return treffer;
				}
			}
		}

		return menu.querySelector(".map-context-menu__item--danger");
	}
```

💣 **`:scope >` beim Einzeleintrag ist tragend.** Ohne den Nachfahren-Riegel fände
`querySelector("[data-ecosystem-area-action=…]")` auch einen Eintrag **innerhalb** eines
Untermenüs — und dann landete die nächste Gruppe mitten in einer anderen.

⚠️ `ensureAreaMenuElement` baut „Fläche bearbeiten" weiterhin selbst und als erstes Kind; das
Register bestätigt diese Stellung nur, es ersetzt sie nicht.

- [ ] **Schritt 5: `ensureAreaMenuGroup` auf eine Gruppen-Kennung umstellen**

Die Funktion nimmt heute nur `menu`. Neu `(menu, groupId)`; alle drei Vorkommen von
`AREA_GROUP_NEW` im Rumpf durch `groupId` ersetzen, die Beschriftung aus `AREA_GROUPS` holen:

```js
	function ensureAreaMenuGroup(menu, groupId) {
		const eintrag = AREA_GROUPS.find((kandidat) => kandidat.id === groupId);
		if (!eintrag) {
			return null;
		}
		const vorhanden = menu.querySelector(`[${AREA_GROUP_ATTRIBUTE}="${groupId}"] .map-context-submenu`);
		if (vorhanden) {
			return vorhanden;
		}

		const group = document.createElement("div");
		group.className = "map-context-menu__group";
		group.setAttribute(AREA_GROUP_ATTRIBUTE, groupId);

		const opener = document.createElement("button");
		opener.type = "button";
		opener.className = "map-context-menu__item map-context-menu__item--submenu";
		// 💣 Die Glyphe ist Pflicht, nicht Zierde: ohne `content` entsteht das ::before gar nicht, die
		// BESCHRIFTUNG wird zum ersten Rasterelement und beginnt bei 12 statt bei 41 px.
		opener.setAttribute(AREA_GROUP_ATTRIBUTE, groupId);
		opener.textContent = label(eintrag.key, eintrag.label);
		group.appendChild(opener);

		const submenu = document.createElement("div");
		submenu.className = "map-context-submenu";
		group.appendChild(submenu);

		menu.insertBefore(group, areaMenuEinfuegePunkt(menu, groupId));

		return submenu;
	}
```

⚠️ Die bisherige Zeile `menu.insertBefore(group, menu.firstChild)` fällt damit weg — sie war die
Sonderregel „Anlegen ist die häufigste Absicht, also ganz oben", und genau das sagt jetzt das
Register, nur für alle vier Gruppen statt für eine.

- [ ] **Schritt 6: `addEcosystemAreaMenuEntry` auf das Register umstellen**

Den fest verdrahteten Zweig ersetzen:

```js
		const gruppe = AREA_GROUPS.find((kandidat) => kandidat.id === String(group));
		if (gruppe) {
			// 🪤 Auch INNERHALB eines Untermenüs bleibt Zerstörendes unten -- „Unterfläche löschen"
			// steht rot am Ende seiner Gruppe, nicht mittendrin.
			const ziel = ensureAreaMenuGroup(menu, gruppe.id);
			const ersterGefaehrlicher = ziel.querySelector(".map-context-menu__item--danger");
			if (danger || !ersterGefaehrlicher) {
				ziel.appendChild(button);
			} else {
				ziel.insertBefore(button, ersterGefaehrlicher);
			}
			return button;
		}
```

Und der Zweig für das oberste Menü nimmt denselben Helfer wie die Gruppe, statt blind vor den ersten
gefährlichen Eintrag zu springen:

```js
		menu.insertBefore(button, areaMenuEinfuegePunkt(menu, actionName));
```

⚠️ Für eine Aktion, die **nicht** im Register steht, liefert `areaMenuEinfuegePunkt` genau das, was
die alte Zeile lieferte — den ersten gefährlichen Eintrag bzw. `null`. Das Verhalten für unbekannte
Einträge ist also unverändert.

Der bisherige `ensureAreaMenuGroup(menu)`-Aufruf in `registerAreaMenuNewAreaEntries` läuft über
denselben Weg, weil dort `group: AREA_GROUP_NEW` steht — nichts zu ändern.

- [ ] **Schritt 7: Die drei Glyphen ins CSS**

`css/components/map-context-menu.css`, direkt unter der bestehenden Regel für
`[data-ecosystem-area-group="new-area"]`:

```css
/* Die drei Untermenü-Öffner des Flächenmenüs (19.08.2026). Dieselbe Pflicht wie überall in dieser
   Datei: ohne `content` entsteht das ::before nicht, und die Beschriftung beginnt bei 12 statt 41 px.
   Die Zeichen sind die ihrer Familie -- ✥ steht schon an „Verschieben", ∪ an „Mit anderer
   vereinigen", ⧏ an „Alle Unterflächen vereinigen". Ein Untermenü, das anders aussieht als sein
   häufigster Eintrag, ist ein zweites Vokabular. */
.map-context-menu__item[data-ecosystem-area-group="form"]::before {
	content: "\2725";
}

.map-context-menu__item[data-ecosystem-area-group="mit-anderer"]::before {
	content: "\222A";
}

.map-context-menu__item[data-ecosystem-area-group="unterflaechen"]::before {
	content: "\29CF";
}
```

⚠️ Die Gruppe `stapel` kommt erst in Teil B (Aufgabe B6) — samt ihrer Glyphe und ihrer Zeile im Test.

- [ ] **Schritt 8: Test laufen lassen**

Run: `node js/map-features/__tests__/ecosystem-menue-struktur.test.js`
Expected: PASS

- [ ] **Schritt 9: Commit**

```bash
git status
git add js/map-features/map-features-ecosystem-context-action.js css/components/map-context-menu.css js/map-features/__tests__/ecosystem-menue-struktur.test.js
git diff --staged
git commit -m "refactor(landschaften): das Flaechenmenue kennt vier Untermenue-Gruppen statt einer"
```

---

### Aufgabe A2: Die drei Familien in ihre Untermenüs hängen

Nur je ein `group:`-Feld pro Eintrag. **Kein `action`-Wert ändert sich** — er ist gleichzeitig der
Schlüssel des Handlers und der Selektor der Glyphe.

**Files:**
- Modify: `js/map-features/map-features-ecosystem-geometry-ops.js:684-741`
- Modify: `js/map-features/map-features-ecosystem-brush.js:560-570`
- Modify: `js/map-features/map-features-ecosystem-simplify.js:317-322`

- [ ] **Schritt 1: `geometry-ops` — der `entry`-Helfer bekommt eine Gruppe**

Aus

```js
		const entry = (action, german, onClick, danger = false) => menu.addEntry({
			action, label: …, onClick, danger,
		});
```

wird

```js
		const entry = (action, german, onClick, danger = false, group = "") => menu.addEntry({
			action,
			label: typeof tr === "function" ? tr(`ecosystem.ctxmenu.${action}`, german) : german,
			onClick,
			danger,
			group,
		});
```

- [ ] **Schritt 2: Die sieben Aufrufe zuordnen**

```js
		entry("move", "Verschieben", (publicId) => { … }, false, "form");
		entry("split", "Fläche zerschneiden", (publicId) => { … }, false, "form");

		TARGET_OPERATIONS.forEach((operation) => {
			entry(operation.action, operation.label, (publicId) => { … }, false, "mit-anderer");
		});

		entry("merge-subareas", "Alle Unterflächen vereinigen", …, false, "unterflaechen");
		entry("extract", "Unterfläche herauslösen", …, false, "unterflaechen");
		entry("delete-part", "Unterfläche löschen", …, true, "unterflaechen");
```

⚠️ Den bestehenden Kommentar über `delete-part` ergänzen: er begründet heute, dass der Eintrag durch
die Einfügeregel **ans Ende des Menüs** rutscht. Ab jetzt rutscht er ans Ende **seiner Gruppe** —
die Begründung bleibt („die Zerstörer sammeln sich unten"), die Reichweite ändert sich, und ein
Kommentar, der die alte Reichweite behauptet, ist beim nächsten Leser eine Falschaussage.

- [ ] **Schritt 3: `brush` und `simplify`**

In `map-features-ecosystem-brush.js` beiden `menu.addEntry({…})`-Aufrufen `group: "form"` beifügen,
in `map-features-ecosystem-simplify.js` dem einen ebenso.

- [ ] **Schritt 4: Im Browser nachsehen — der Handgriff, nicht das Maß**

💣 AGENTS.md §9: „Abnahme heißt ABLAUF, nicht Maß." Also wirklich ausführen:
1. Karte laden, Ansicht **Landschaften**, eine Vegetationsfläche rechtsklicken.
2. Zählen: **8** Einträge im obersten Menü (Neue Fläche ▸, Fläche bearbeiten, Form ändern ▸, Mit
   anderer Fläche ▸, Unterflächen ▸, Eigenschaften …, Kopieren …, Fläche löschen) plus der Zettel.
3. Jedes der vier Untermenüs aufklappen und **jeden** Eintrag auf seine Glyphe prüfen: beginnt die
   Beschriftung bei 41 px oder bei 12? Bei 12 fehlt die `content`-Regel.
4. „Mit anderer Fläche ▸ → Mit anderer vereinigen" wirklich anklicken und die Zielwahl starten —
   der Handler muss über dieselbe `action` gefunden werden wie vorher.

- [ ] **Schritt 5: Commit**

```bash
git status
git add js/map-features/map-features-ecosystem-geometry-ops.js js/map-features/map-features-ecosystem-brush.js js/map-features/map-features-ecosystem-simplify.js
git diff --staged
git commit -m "ui(landschaften): drei Familien wandern in Untermenues -- 17 Eintraege werden 8"
```

---

### Aufgabe A3: Dasselbe im Herrschaftsgebiete-Menü

💣 Der Wortlaut der vier Verrechnungen wurde von dort **abgeschrieben** (Kommentar in
`geometry-ops.js:26-29`: „zwei Vokabulare für dieselbe Geste wäre die eigentliche Zumutung"). Nur
eines der beiden Menüs umzubauen ließe sie in der Form auseinanderlaufen, während die Worte gleich
bleiben.

**Files:**
- Modify: `index.html`, `#region-context-menu` (ab Zeile 338)
- Modify: `css/components/map-context-menu.css` (Glyphen für zwei Gruppen-Öffner)

- [ ] **Schritt 1: Die elf Einträge sortieren**

Bestehende Reihenfolge: Grenzen bearbeiten · Territoriumseditor öffnen · Infobox anzeigen ·
Verschieben · Gebiet zerschneiden · Mit anderem vereinigen · Von anderem ausschneiden · Von anderem
ausschneiden und anderes beibehalten · Neues von anderem ausschneiden · Neues Gebiet herauslösen ·
Löschen.

Danach — **7** oberste Einträge:

```
Grenzen bearbeiten
Territoriumseditor öffnen
Infobox anzeigen
Form ändern ▸        Verschieben · Gebiet zerschneiden
Mit anderem Gebiet ▸ die vier Verrechnungen
Neues Gebiet herauslösen
Löschen
```

⚠️ „Neues Gebiet herauslösen" bleibt oben: hier gibt es **keine** Unterflächen-Familie, ein
Untermenü mit einem einzigen Eintrag ist eine Schikane.

- [ ] **Schritt 2: Markup umbauen**

Die Gruppen nach demselben Bauplan wie im Kartenmenü (`.map-context-menu__group` >
`.map-context-menu__item--submenu` + `.map-context-submenu`). Das Attribut heißt hier
`data-region-context-group`, passend zu `data-region-context-action` daneben.

💣 **Kein `data-region-context-action` ändern.** Der delegierte Handler in `js/routing/routing.js`
schlägt die Aktion darüber nach, und die CSS-Glyphen hängen ebenfalls daran.

- [ ] **Schritt 3: Glyphen ergänzen**

```css
.map-context-menu__item[data-region-context-group="form"]::before {
	content: "\2725";
}

.map-context-menu__item[data-region-context-group="mit-anderem"]::before {
	content: "\222A";
}
```

- [ ] **Schritt 4: Im Browser nachsehen**

Ansicht **Politisch**, ein Herrschaftsgebiet rechtsklicken: 7 oberste Einträge, beide Untermenüs
klappen auf, „Von anderem ausschneiden" startet die Zielwahl.

- [ ] **Schritt 5: Commit**

```bash
git status
git add index.html css/components/map-context-menu.css
git diff --staged
git commit -m "ui(territorien): dieselben zwei Untermenues wie im Flaechenmenue -- 11 Eintraege werden 7"
```

---

### Aufgabe A4: Tor — Testfeld und erster Deploy

- [ ] **Schritt 1: Das ganze Testfeld** (alle drei Läufe aus den globalen Zusicherungen)
- [ ] **Schritt 2: Prüfbaum bauen und nur die eigenen Commits pushen**

💣 Nicht aus dem Hauptbaum pushen — dort liegen 27 fremde Commits.

```bash
git worktree add --detach "$SCRATCH/pruefbaum" HEAD
git -C "$SCRATCH/pruefbaum" fetch origin
git -C "$SCRATCH/pruefbaum" reset --hard origin/master
git -C "$SCRATCH/pruefbaum" cherry-pick <A1> <A2> <A3>
```

- [ ] **Schritt 3: Das ganze Testfeld IM PRÜFBAUM** — erst dieser Lauf belegt, was rausgeht
- [ ] **Schritt 4: Pushen und aufräumen**

```bash
git -C "$SCRATCH/pruefbaum" push origin HEAD:master
git worktree remove --force "$SCRATCH/pruefbaum" && git worktree prune
```

- [ ] **Schritt 5: Remote-SHA prüfen, 1–2 Minuten warten, live nachsehen**

⚠️ **Eine Live-Probe unmittelbar nach dem Deploy misst die ALTE Fassung** (OPcache, 2–4 Minuten
Verzug). Zweimal messen, mit Abstand.

- [ ] **Schritt 6: HALT — auf den Blick des Owners warten.** Teil B beginnt erst danach.

---

# TEIL B — Reihenfolge und Sperre

### Aufgabe B1: Die Flächenrechnung in PHP

Der Seed und die Geburt einer neuen Region laufen serverseitig. Die Rechnung ist die Gauß'sche
Trapezformel mit abgezogenen Löchern — dieselbe wie `ecosystemGeometryArea`
(`js/map-features/map-features-ecosystem-geometry.js:85-107`).

⚠️ **Das ist keine zweite Wahrheit, sondern ein Umzug:** die JS-Fassung der *Stapelregel*
verschwindet in Aufgabe B4. Die JS-Funktion `ecosystemGeometryArea` selbst bleibt — sie trägt die
Plausibilitätsprüfung der booleschen Operationen und die Höhenkombination.

**Files:**
- Create: `api/_internal/app/ecosystem-flaeche.php`
- Test: `api/_internal/app/__tests__/ecosystem-flaeche-test.php`

**Interfaces:**
- Produces: `avesmapsEcosystemGeometryArea(?array $geometry): float`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
declare(strict_types=1);
// Die PHP-Flaechenrechnung muss Ziffer fuer Ziffer dasselbe liefern wie ecosystemGeometryArea im
// Browser -- sie ersetzt sie fuer die Stapelreihenfolge. Dieselben Fixtures wie
// js/map-features/__tests__/ecosystem-geometry.test.js.
require_once __DIR__ . '/../ecosystem-flaeche.php';

// Einheitsquadrat
$quadrat = ['type' => 'Polygon', 'coordinates' => [[[0,0],[10,0],[10,10],[0,10],[0,0]]]];
assert(abs(avesmapsEcosystemGeometryArea($quadrat) - 100.0) < 1e-9, 'Quadrat 10x10 = 100');

// Umgekehrter Wicklungssinn -- Flaeche ist eine GROESSE, keine Richtung.
$rueckwaerts = ['type' => 'Polygon', 'coordinates' => [[[0,0],[0,10],[10,10],[10,0],[0,0]]]];
assert(abs(avesmapsEcosystemGeometryArea($rueckwaerts) - 100.0) < 1e-9, 'Wicklungssinn egal');

// Loch wird abgezogen.
$mitLoch = ['type' => 'Polygon', 'coordinates' => [
    [[0,0],[10,0],[10,10],[0,10],[0,0]],
    [[2,2],[4,2],[4,4],[2,4],[2,2]],
]];
assert(abs(avesmapsEcosystemGeometryArea($mitLoch) - 96.0) < 1e-9, 'Loch 2x2 abgezogen');

// MultiPolygon summiert.
$multi = ['type' => 'MultiPolygon', 'coordinates' => [
    [[[0,0],[10,0],[10,10],[0,10],[0,0]]],
    [[[20,20],[25,20],[25,25],[20,25],[20,20]]],
]];
assert(abs(avesmapsEcosystemGeometryArea($multi) - 125.0) < 1e-9, 'MultiPolygon summiert');

// Unbrauchbares zaehlt 0 -- und 0 ist oben, der ungefaehrliche Platz.
assert(avesmapsEcosystemGeometryArea(null) === 0.0, 'null = 0');
assert(avesmapsEcosystemGeometryArea(['type' => 'Point', 'coordinates' => [1,2]]) === 0.0, 'Punkt = 0');
assert(avesmapsEcosystemGeometryArea(['type' => 'Polygon', 'coordinates' => [[[0,0],[1,1]]]]) === 0.0, 'Ring mit 2 Ecken = 0');

echo "ok - ecosystem-flaeche\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/ecosystem-flaeche-test.php`
Expected: FAIL — Datei `ecosystem-flaeche.php` nicht gefunden

- [ ] **Schritt 3: Die Rechnung schreiben**

```php
<?php

declare(strict_types=1);

// Der Flaecheninhalt einer Landschafts-Geometrie -- ab 19.08.2026 die Grundlage der EINMALIGEN
// Startaufstellung des Stapels und des Platzes, den eine neu angelegte Region bekommt.
//
// 🔴 WORTGLEICH ZU ecosystemGeometryArea (js/map-features/map-features-ecosystem-geometry.js): Gauss,
// absolut, erster Ring positiv und jeder weitere abgezogen. Das ist KEINE zweite Wahrheit -- die
// Stapelregel im Browser faellt im selben Umbau weg; danach rechnet die Reihenfolge nur noch hier.
// Die JS-Funktion selbst bleibt, sie traegt die Plausibilitaetspruefung der booleschen Operationen.
//
// ⚠️ Einheiten sind Kartenpunkte (0..1024), nicht Meilen. Der Wert wird nur VERGLICHEN, nie angezeigt.

// Ein Ring -> seine Flaeche, absolut. Ein Ring darf offen oder geschlossen ankommen und in beide
// Richtungen gewickelt sein; die Flaeche ist eine Groesse, keine Richtung.
function avesmapsEcosystemRingArea(mixed $ring): float
{
    if (!is_array($ring) || count($ring) < 3) {
        return 0.0;
    }

    $sum = 0.0;
    $anzahl = count($ring);
    $ringe = array_values($ring);
    for ($i = 0, $j = $anzahl - 1; $i < $anzahl; $j = $i++) {
        $a = $ringe[$j];
        $b = $ringe[$i];
        if (!is_array($a) || !is_array($b) || count($a) < 2 || count($b) < 2) {
            return 0.0;
        }
        $sum += ((float) $a[0] * (float) $b[1]) - ((float) $b[0] * (float) $a[1]);
    }

    return abs($sum) / 2.0;
}

// Aussenring minus Loecher, summiert ueber jeden Teil. Alles Unbrauchbare zaehlt 0.
function avesmapsEcosystemGeometryArea(?array $geometry): float
{
    $type = (string) ($geometry['type'] ?? '');
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates)) {
        return 0.0;
    }

    if ($type === 'Polygon') {
        $parts = [$coordinates];
    } elseif ($type === 'MultiPolygon') {
        $parts = $coordinates;
    } else {
        return 0.0;
    }

    $total = 0.0;
    foreach ($parts as $part) {
        if (!is_array($part)) {
            continue;
        }
        foreach (array_values($part) as $index => $ring) {
            $flaeche = avesmapsEcosystemRingArea($ring);
            $total += $index === 0 ? $flaeche : -$flaeche;
        }
    }

    return $total;
}
```

- [ ] **Schritt 4: Test laufen lassen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/ecosystem-flaeche-test.php`
Expected: PASS

- [ ] **Schritt 5: Commit**

```bash
git status
git add api/_internal/app/ecosystem-flaeche.php api/_internal/app/__tests__/ecosystem-flaeche-test.php
git diff --staged
git commit -m "feat(landschaften): die Flaechenrechnung als PHP-Fundament der Stapelreihenfolge"
```

---

### Aufgabe B2: Die zwei Spalten und die Startaufstellung

**Files:**
- Modify: `api/_internal/app/ecosystem.php` (`avesmapsEcosystemEnsureTables`, ~Zeile 347-366)
- Test: `api/_internal/app/__tests__/ecosystem-startaufstellung-test.php` (neu)

**Interfaces:**
- Produces: `avesmapsEcosystemSeedStackOrder(PDO $pdo): int` — vergibt `stack_order` je `kind`,
  gibt die Zahl der geschriebenen Zeilen zurück.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

SQLite im Speicher, drei Regionen einer Ebene mit verschieden großen Flächen. Die Zusicherung ist
**die abgeschaffte Regel als Zeuge**: die größte bekommt die kleinste Zahl.

```php
<?php
declare(strict_types=1);
// Die Startaufstellung reproduziert die heutige Browser-Regel: gross unten (kleine Zahl), klein oben.
// 💣 Die alte Regel steht hier als ZEUGE in der Fixture. Wer diese Kopie „aufraeumt", nimmt dem
// Umbau seinen einzigen Beleg, dass sich am Auslieferungstag nichts am Bild aendert.
require_once __DIR__ . '/../ecosystem-flaeche.php';
require_once __DIR__ . '/../ecosystem-stapel.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT,
            is_active INTEGER DEFAULT 1, stack_order INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0)');
$pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER,
            geometry_geojson TEXT, is_active INTEGER DEFAULT 1)');

$quadrat = static fn (float $seite): string => json_encode(['type' => 'Polygon', 'coordinates' => [[
    [0, 0], [$seite, 0], [$seite, $seite], [0, $seite], [0, 0],
]]]);

// gross(100x100) · mittel(10x10) · klein(1x1), absichtlich in dieser Reihenfolge eingefuegt
$pdo->exec("INSERT INTO ecosystem_region (id, public_id, kind) VALUES (1,'r-gross','vegetation'),(2,'r-mittel','vegetation'),(3,'r-klein','vegetation')");
$pdo->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson) VALUES (?,?,?)')
    ->execute(['a1', 1, $quadrat(100.0)]);
$pdo->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson) VALUES (?,?,?)')
    ->execute(['a2', 2, $quadrat(10.0)]);
$pdo->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson) VALUES (?,?,?)')
    ->execute(['a3', 3, $quadrat(1.0)]);

$geschrieben = avesmapsEcosystemSeedStackOrder($pdo);
assert($geschrieben === 3, "3 Zeilen erwartet, $geschrieben bekommen");

$ordnung = $pdo->query('SELECT public_id FROM ecosystem_region ORDER BY stack_order ASC')->fetchAll(PDO::FETCH_COLUMN);
assert($ordnung === ['r-gross', 'r-mittel', 'r-klein'], 'gross unten, klein oben: ' . implode(',', $ordnung));

// 💣 Luecken zwischen den Zahlen, damit „nach vorn/hinten" ohne Neunummerierung auskommt.
$werte = $pdo->query('SELECT stack_order FROM ecosystem_region ORDER BY stack_order ASC')->fetchAll(PDO::FETCH_COLUMN);
assert((int) $werte[1] - (int) $werte[0] >= 10, 'Schrittweite mindestens 10');

// 💣 Eine Region OHNE Flaeche zaehlt 0 und landet damit ganz oben -- oben ist der ungefaehrliche
// Platz: sie verdeckt nichts. Dieselbe Lesart wie in der abgeschafften JS-Regel.
$pdo->exec("INSERT INTO ecosystem_region (id, public_id, kind) VALUES (4,'r-leer','vegetation')");
avesmapsEcosystemSeedStackOrder($pdo);
$letzte = $pdo->query('SELECT public_id FROM ecosystem_region ORDER BY stack_order DESC LIMIT 1')->fetchColumn();
assert($letzte === 'r-leer', "leere Region ganz oben erwartet, $letzte bekommen");

echo "ok - ecosystem-startaufstellung\n";
```

⚠️ Der zweite Seed-Lauf im Test darf die schon vergebenen Werte **nicht** durcheinanderbringen —
siehe Schritt 3: er vergibt nur an Zeilen mit `stack_order = 0`, und die Reihenfolge der bereits
gesetzten bleibt unangetastet.

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-startaufstellung-test.php`
Expected: FAIL — `ecosystem-stapel.php` nicht gefunden

- [ ] **Schritt 3: Den Seed schreiben**

`api/_internal/app/ecosystem-stapel.php`:

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/ecosystem-flaeche.php';

// Die Schrittweite zwischen zwei benachbarten Raengen. Luecken, damit „ganz nach vorn"/„ganz nach
// hinten" eine Zahl ausserhalb des Bereichs waehlen kann, ohne alles neu zu nummerieren.
const AVESMAPS_ECOSYSTEM_STACK_STEP = 10;

// Die EINMALIGE Startaufstellung (Owner 19.08.2026: „nimm das als grundlage fuer die initiale
// sortierung und loes die regel danach auf").
//
// 🔴 Sie vergibt NUR an Zeilen mit stack_order = 0. Ein Nachlauf ueber alle Zeilen wuerde eine von
// Hand nach hinten geschobene Region beim naechsten Aufruf wieder einsortieren -- die Regel liefe
// dann weiter, statt aufgeloest zu sein.
//
// ⚠️ Gerechnet wird je EBENE (kind) getrennt: die vier Ebenen liegen in eigenen Leaflet-Panes mit
// festem z-index, ein gemeinsamer Zahlenraum haette dort keine Bedeutung.
function avesmapsEcosystemSeedStackOrder(PDO $pdo): int
{
    $rows = $pdo->query(
        'SELECT r.id, r.kind, a.geometry_geojson
           FROM ecosystem_region r
           LEFT JOIN ecosystem_area a ON a.region_id = r.id AND a.is_active = 1
          WHERE r.is_active = 1 AND r.stack_order = 0'
    )->fetchAll(PDO::FETCH_ASSOC);

    // Region -> Summe der Flaecheninhalte ihrer aktiven Flaechen. Eine Region ohne Flaeche bleibt 0.
    $groesse = [];
    $ebene = [];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $ebene[$id] = (string) $row['kind'];
        $groesse[$id] = ($groesse[$id] ?? 0.0) + avesmapsEcosystemGeometryArea(
            $row['geometry_geojson'] === null ? null : json_decode((string) $row['geometry_geojson'], true)
        );
    }
    if ($groesse === []) {
        return 0;
    }

    // Je Ebene: absteigend nach Groesse. Die groesste bekommt die kleinste Zahl und liegt damit unten.
    // 🪤 STABIL bei Gleichstand -- nach id. Sonst wuerfelte jeder Lauf die Stapelung neu, und ein
    // Klick traefe beim zweiten Mal etwas anderes. Dieselbe Zusicherung wie in der alten JS-Regel.
    $jeEbene = [];
    foreach ($groesse as $id => $flaeche) {
        $jeEbene[$ebene[$id]][] = ['id' => $id, 'flaeche' => $flaeche];
    }

    $geschrieben = 0;
    $statement = $pdo->prepare('UPDATE ecosystem_region SET stack_order = :rang WHERE id = :id');
    foreach ($jeEbene as $kind => $liste) {
        usort($liste, static function (array $links, array $rechts): int {
            return ($rechts['flaeche'] <=> $links['flaeche']) ?: ($links['id'] <=> $rechts['id']);
        });
        // Der hoechste bereits vergebene Rang dieser Ebene ist der Startpunkt -- so reiht sich ein
        // zweiter Lauf HINTER das Bestehende ein, statt es zu ueberschreiben.
        $start = $pdo->prepare('SELECT COALESCE(MAX(stack_order), 0) FROM ecosystem_region WHERE kind = :kind AND is_active = 1');
        $start->execute(['kind' => $kind]);
        $rang = (int) $start->fetchColumn();
        foreach ($liste as $eintrag) {
            $rang += AVESMAPS_ECOSYSTEM_STACK_STEP;
            $statement->execute(['rang' => $rang, 'id' => $eintrag['id']]);
            $geschrieben++;
        }
    }

    return $geschrieben;
}
```

⚠️ Der Test aus Schritt 1 erwartet beim ZWEITEN Lauf, dass `r-leer` ganz oben landet — mit dem
`MAX(stack_order)`-Startpunkt trifft das zu.

- [ ] **Schritt 4: DDL und Seed in `avesmapsEcosystemEnsureTables` einhängen**

In `api/_internal/app/ecosystem.php`, hinter der bestehenden `$areaColumnExists`-Schleife, eine
gleichartige für `ecosystem_region`:

```php
    // 19.08.2026: die Stapelreihenfolge und die Klick-Sperre einer Region. Beide sind
    // KARTENEIGENSCHAFTEN (Owner: „wandert in die Datenbank, gilt fuer jeden Editor").
    //
    // 💣 `is_locked` heisst NICHT dasselbe wie `map_feature_locks` (api/_internal/map/features.php).
    // Jene Tabelle ist die BEARBEITUNGSsperre -- „dieses Objekt hat gerade jemand anderes offen",
    // befristet, mit user_id. Diese hier ist dauerhaft, gilt fuer alle und betrifft nur den Zeiger:
    // die Flaeche faengt keine Klicks mehr ab, behaelt aber ihren Schwebezettel.
    $regionColumnExists = static function (PDO $pdo, string $column): bool {
        $statement = $pdo->prepare(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ecosystem_region' AND COLUMN_NAME = :c"
        );
        $statement->execute(['c' => $column]);

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    };
    $stapelSpalteNeu = false;
    foreach ([
        'stack_order' => 'INT NOT NULL DEFAULT 0',
        'is_locked' => 'TINYINT(1) NOT NULL DEFAULT 0',
    ] as $column => $type) {
        if (!$regionColumnExists($pdo, $column)) {
            $pdo->exec('ALTER TABLE ecosystem_region ADD COLUMN ' . $column . ' ' . $type);
            $stapelSpalteNeu = $stapelSpalteNeu || $column === 'stack_order';
        }
    }
    // 🔴 Der Seed laeuft im ALTER-Zweig, also in genau der einen Anfrage, die die Spalte anlegt --
    // NICHT als „WHERE stack_order = 0"-Nachlauf bei jedem Aufruf. Das ist der Unterschied zwischen
    // einer Startaufstellung und einer weiterlaufenden Regel.
    if ($stapelSpalteNeu) {
        avesmapsEcosystemSeedStackOrder($pdo);
    }
```

Und ganz oben in der Datei `require_once __DIR__ . '/ecosystem-stapel.php';`.

- [ ] **Schritt 5: Test laufen lassen**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-startaufstellung-test.php`
Expected: PASS

- [ ] **Schritt 6: Commit**

```bash
git status
git add api/_internal/app/ecosystem-stapel.php api/_internal/app/ecosystem.php api/_internal/app/__tests__/ecosystem-startaufstellung-test.php
git diff --staged
git commit -m "feat(landschaften): stack_order und is_locked an der Region, samt einmaliger Startaufstellung"
```

---

### Aufgabe B3: Lesen und Schreiben

**Files:**
- Modify: `api/_internal/app/ecosystem.php` — `avesmapsEcosystemReadAreas` (SELECT ab :1457 und die
  Zeilenabbildung ab :1485), `avesmapsListEcosystemRegions` (:1974), `avesmapsEcosystemReadRegionFields`
  (:1704), `avesmapsCreateEcosystemRegion`
- Test: `api/_internal/app/__tests__/ecosystem-stapel-schreiben-test.php` (neu)

- [ ] **Schritt 1: Der Lesepfad**

In `avesmapsEcosystemReadAreas` dem SELECT `r.stack_order, r.is_locked` beifügen und in die
Zeilenabbildung:

```php
            'stack_order' => (int) $row['stack_order'],
            'is_locked' => (int) $row['is_locked'] === 1,
```

In `avesmapsListEcosystemRegions` dasselbe, und die Sortierung von `ORDER BY r.kind ASC, r.name ASC,
r.id ASC` auf `ORDER BY r.kind ASC, r.stack_order DESC, r.id ASC` — das Fenster zeigt den Stapel,
oben liegt vorn.

💣 **Kein `'' AS spalte`-Rückfall nötig — und das ist eine Zusicherung, keine Beobachtung.**
`api/app/ecosystem-areas.php:102` ruft `avesmapsEcosystemEnsureTables($pdo)` **vor**
`avesmapsEcosystemReadAreas`, die Spalten existieren also, wenn der Leser sie liest. ⚠️ Wer diesen
Aufruf je aus Leistungsgründen entfernt, nimmt genau diese Zusicherung weg — dann muss der Rückfall
zuerst gebaut werden (Vorbild: `wiki_sync_pages.deity`, 15.08.2026, zehn Minuten stiller Ausfall).
Ein Kommentar an der SELECT-Stelle sagt das.

- [ ] **Schritt 2: Der Schreibweg — zwei Felder, kein neuer Endpunkt**

⭐ `update_region` ist bereits **partiell** („only the fields actually present in the payload are
written"). Es braucht also keine neue Aktion. In `avesmapsEcosystemReadRegionFields`:

```php
    if (array_key_exists('stack_order', $payload)) {
        $fields['stack_order'] = (int) $payload['stack_order'];
    }
    if (array_key_exists('is_locked', $payload)) {
        $fields['is_locked'] = ((bool) $payload['is_locked']) ? 1 : 0;
    }
```

💣 **`array_key_exists`, nicht `isset`** — `isset` ist bei `0`/`false` zwar wahr, bei `null` aber
falsch, und die übrigen Felder dieser Funktion benutzen alle `array_key_exists`. Ein abweichendes
Muster hier wäre die Stelle, an der später jemand „warum wird meine 0 nicht gespeichert" sucht.

- [ ] **Schritt 3: Eine neue Region kommt ganz nach vorn**

In `avesmapsCreateEcosystemRegion`, beim INSERT:

```php
    // 🔴 OHNE REGEL GIBT ES KEINEN AUTOMATISCHEN PLATZ MEHR (Owner 19.08.2026). „Das Neueste liegt
    // obenauf" ist vorhersagbar; ist es eine grosse Flaeche, schiebt der Editor sie mit einem Klick
    // nach hinten. Sie nach Groesse einzusortieren hiesse, die abgeschaffte Regel lebte halb weiter.
    $vorn = $pdo->prepare('SELECT COALESCE(MAX(stack_order), 0) + :schritt FROM ecosystem_region WHERE kind = :kind AND is_active = 1');
    $vorn->execute(['schritt' => AVESMAPS_ECOSYSTEM_STACK_STEP, 'kind' => $kind]);
```

Der Wert geht als `stack_order` in den INSERT.

- [ ] **Schritt 4: Den Schreib-Test schreiben und laufen lassen**

SQLite-Fixture; drei Zusicherungen:
1. `update_region` mit **nur** `is_locked` schreibt genau dieses Feld und lässt `name` unberührt.
2. `update_region` ohne die beiden Felder lässt beide unberührt (Partialität).
3. `create_region` vergibt einen `stack_order` **größer** als jeder bestehende derselben Ebene und
   rührt eine andere Ebene nicht an.

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-stapel-schreiben-test.php`
Expected: PASS

- [ ] **Schritt 5: Commit**

```bash
git status
git add api/_internal/app/ecosystem.php api/_internal/app/__tests__/ecosystem-stapel-schreiben-test.php
git diff --staged
git commit -m "feat(landschaften): Reihenfolge und Sperre reisen im Payload mit und lassen sich schreiben"
```

---

### Aufgabe B4: Die Größenregel im Browser löschen

**Files:**
- Modify: `js/map-features/map-features-ecosystem-rendering.js:535-583` (die Regel und ihr Anwender),
  `:863` (Export)
- Test: `js/map-features/__tests__/ecosystem-stapelreihenfolge.test.js` (neu),
  `js/map-features/__tests__/ecosystem-rendering.test.js` (bestehende Zusicherungen zu
  `ecosystemStackingOrder` entfernen)

**Interfaces:**
- Produces: `ecosystemStapelOrdnung(areas)` → Liste von `public_id`, aufsteigend nach `stack_order`
  (die vorderste zuletzt, damit der Aufrufer sie in dieser Reihenfolge `bringToFront` rufen kann).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```js
// Die Stapelreihenfolge kommt seit 19.08.2026 aus stack_order, nicht mehr aus der Flaechengroesse.
// 💣 Der GROSSE Kasten steht hier absichtlich VORN (hoher stack_order): waere die Groessenregel noch
// aktiv, kaeme er nach hinten -- der Test faellt also genau dann um, wenn jemand sie wiederbelebt.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "map-features-ecosystem-rendering.js"), "utf8");
vm.runInThisContext(quelle);

const flaechen = [
    { public_id: "klein", kind: "vegetation", stack_order: 30, geometry: quadrat(1) },
    { public_id: "gross", kind: "vegetation", stack_order: 40, geometry: quadrat(100) },
    { public_id: "mittel", kind: "vegetation", stack_order: 10, geometry: quadrat(10) },
];

assert.deepStrictEqual(
    ecosystemStapelOrdnung(flaechen),
    ["mittel", "klein", "gross"],
    "aufsteigend nach stack_order -- die vorderste zuletzt"
);

// 🪤 STABIL bei Gleichstand: gleiche Zahl behaelt die Eingangsreihenfolge. Sonst wuerfelte jedes
// Nachladen die Stapelung neu und ein Klick traefe beim zweiten Mal etwas anderes.
assert.deepStrictEqual(
    ecosystemStapelOrdnung([
        { public_id: "a", kind: "vegetation", stack_order: 10 },
        { public_id: "b", kind: "vegetation", stack_order: 10 },
    ]),
    ["a", "b"],
    "Gleichstand behaelt die Eingangsreihenfolge"
);

// Eine Flaeche ohne Zahl zaehlt 0 und liegt damit ganz hinten -- sie ist noch nicht einsortiert.
assert.deepStrictEqual(
    ecosystemStapelOrdnung([
        { public_id: "ohne", kind: "vegetation" },
        { public_id: "mit", kind: "vegetation", stack_order: 5 },
    ]),
    ["ohne", "mit"]
);

console.log("ok - ecosystem-stapelreihenfolge");
```

(`quadrat(n)` ist ein kleiner Helfer im Test, der ein n×n-Polygon liefert — die Geometrie ist hier
nur noch Beiwerk und beweist genau das: sie wird **nicht mehr** gelesen.)

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node js/map-features/__tests__/ecosystem-stapelreihenfolge.test.js`
Expected: FAIL — `ecosystemStapelOrdnung is not defined`

- [ ] **Schritt 3: `ecosystemStackingOrder` durch `ecosystemStapelOrdnung` ersetzen**

Der ganze Block ab „Stapelreihenfolge (Owner 2026-07-28, Punkt 9)" wird ersetzt:

```js
// ---- Stapelreihenfolge -------------------------------------------------------------------------
//
// 🔴 SIE STEHT IN DER DATENBANK (Owner 19.08.2026: „die sortierung muss eine karteneigenschaft
// werden"). Bis dahin rechnete sie dieser Browser bei jedem Laden aus der Flaechengroesse -- gross
// unten, klein oben. Diese Regel ist am 19.08.2026 EINMAL gelaufen, als Startaufstellung
// (avesmapsEcosystemSeedStackOrder, api/_internal/app/ecosystem-stapel.php), und danach aufgeloest.
//
// 💣 SIE NICHT WIEDERBELEBEN. Eine zweite, gerechnete Ordnung neben der gespeicherten waere genau
// die Divergenz, die dieser Umbau abgeschafft hat: sie sieht auf dem Bildschirm gleich aus und
// widerspricht dem, was im Fenster „Reihenfolge und Sperren" steht.
//
// ⚠️ `ecosystemGeometryArea` bleibt und ist NICHT die Regel -- sie traegt die Plausibilitaets-
// pruefung der booleschen Operationen und die Hoehenkombination.
//
// 🪤 STABIL bei Gleichstand: zwei Flaechen mit derselben Zahl behalten ihre Eingangsreihenfolge.
// Array.prototype.sort IST seit ES2019 stabil; der Index-Vergleich macht es unabhaengig davon
// ausdruecklich. Ohne das wuerfelte jedes Nachladen die Stapelung neu.
//
// Rein und ohne Leaflet, damit die Regel pruefbar ist: der Aufrufer holt die Flaechen in dieser
// Reihenfolge nach vorn (bringToFront), womit die vorderste zuletzt und damit ganz oben landet.
function ecosystemStapelOrdnung(areas) {
	const list = Array.isArray(areas) ? areas : [];
	const gemessen = list.map((area, index) => ({
		publicId: String(area?.public_id || ""),
		index,
		// Eine Flaeche ohne Zahl zaehlt 0 -- sie ist noch nicht einsortiert und liegt hinten.
		rang: Number(area?.stack_order) || 0,
	})).filter((eintrag) => eintrag.publicId !== "");

	gemessen.sort((links, rechts) => (links.rang - rechts.rang) || (links.index - rechts.index));

	return gemessen.map((eintrag) => eintrag.publicId);
}
```

`applyEcosystemStackingOrder` bleibt als Name (der Loader ruft ihn) und ruft im Rumpf
`ecosystemStapelOrdnung` statt `ecosystemStackingOrder`.

- [ ] **Schritt 4: Export und Altlasten**

Im Export-Block (~:863) `ecosystemStackingOrder` durch `ecosystemStapelOrdnung` ersetzen. Dann
repoweit nach Resten suchen — **mit dem blanken Bezeichner, ohne Klammer**:

```bash
git grep -n "ecosystemStackingOrder"
```

💣 Das Suchmuster ohne Klammer ist Absicht: ein Muster, das eine Zugriffssyntax voraussetzt
(`ecosystemStackingOrder(`), findet die andere nie — genau daran sind bei den Zoombändern drei
Fundstellen fast durchgerutscht.

- [ ] **Schritt 5: Beide Tests laufen lassen**

Run: `node js/map-features/__tests__/ecosystem-stapelreihenfolge.test.js`
Run: `node js/map-features/__tests__/ecosystem-rendering.test.js`
Expected: beide PASS (der zweite nach Entfernen seiner Zusicherungen zur alten Regel)

- [ ] **Schritt 6: Commit**

```bash
git status
git add js/map-features/map-features-ecosystem-rendering.js js/map-features/__tests__/ecosystem-stapelreihenfolge.test.js js/map-features/__tests__/ecosystem-rendering.test.js
git diff --staged
git commit -m "refactor(landschaften): die Stapelung liest stack_order -- die Groessenregel ist aufgeloest"
```

---

### Aufgabe B5: Die Sperr-Weiche

💣 **Die tragende Entscheidung dieses Plans.** Die naheliegende Lösung — `pointer-events: none` auf
den gesperrten Pfaden — erfüllt die halbe Anforderung und man merkt es nicht: der Schwebezettel
haengt an `layer.bindTooltip(…, { sticky: true })` und oeffnet auf `mouseover`. Ohne
Zeigerereignisse gibt es kein `mouseover`, also keinen Zettel. Der Owner hat ihn ausdrücklich
verlangt („tooltips sollen erhalten bleiben. es geht nur um die klicks").

**Files:**
- Create: `js/map-features/map-features-ecosystem-sperre.js`
- Modify: `js/map-features/map-features-ecosystem-rendering.js` (drei Handler),
  `js/map-features/map-features-ecosystem-geometry-ops.js` (`handleAreaClick`)
- Modify: `index.html` (Skript-Tag vor `map-features-ecosystem-rendering.js`)
- Test: `js/map-features/__tests__/ecosystem-sperre-durchlass.test.js`,
  `js/map-features/__tests__/ecosystem-sperre-eingaenge.test.js`

**Interfaces:**
- Produces:
  - `avesmapsEcosystemIstGesperrt(area)` → `boolean` — `true` nur, wenn die Fläche gesperrt **und**
    `canOperateEcosystemLayers()` wahr ist.
  - `avesmapsEcosystemReichtWeiter(layer, event)` → `boolean` — `true`, wenn der Aufrufer sofort und
    **ohne** `stopPropagation` aussteigen soll.

- [ ] **Schritt 1: Den Durchlass-Test schreiben**

```js
// Die Sperre laesst Klicks durch, behaelt aber den Schwebezettel.
// 💣 Deshalb KEIN pointer-events:none -- der Zettel haengt an mouseover. Der Test prueft beides:
// die Weitergabe UND dass der Zettel gebunden bleibt.
const assert = require("node:assert");
…
// Fall 1: gesperrte Flaeche ueber einer freien -> die freie antwortet
// Fall 2: zwei gesperrte uebereinander -> BEIDE sind waehrend der Messung durchlaessig,
//         das Verfahren laeuft genau EINMAL (Rekursionsriegel), und die Karte antwortet
// Fall 3: gesperrt, aber canOperateEcosystemLayers() falsch -> die Sperre wirkt NICHT
//         (der Besucher bekommt sein Infopanel)
// Fall 4: der Zettel ist nach dem Weiterreichen weiterhin gebunden (layer.getTooltip() !== null)
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node js/map-features/__tests__/ecosystem-sperre-durchlass.test.js`
Expected: FAIL — `avesmapsEcosystemReichtWeiter is not defined`

- [ ] **Schritt 3: Die Weiche bauen**

`js/map-features/map-features-ecosystem-sperre.js` — Kern:

```js
	// Die gesperrten Pfade kurz durchlaessig stellen, nachsehen, was darunter liegt, zurueckstellen.
	//
	// 🪤 ALLE gesperrten auf einmal, nicht nur der getroffene: liegen zwei uebereinander, laeuft das
	// Verfahren sonst je Schicht erneut. So laeuft es genau einmal.
	function elementDarunter(clientX, clientY) {
		const pfade = [];
		ecosystemLayers.forEach((layer) => {
			if (layer?._path && avesmapsEcosystemIstGesperrt(layer._ecosystemArea)) {
				pfade.push(layer._path);
			}
		});
		const vorher = pfade.map((pfad) => pfad.style.pointerEvents);
		pfade.forEach((pfad) => { pfad.style.pointerEvents = "none"; });
		const treffer = document.elementFromPoint(clientX, clientY);
		pfade.forEach((pfad, index) => { pfad.style.pointerEvents = vorher[index]; });

		return treffer;
	}
```

🔴 **Der Riegel ist `canOperateEcosystemLayers()`** — dieselbe Frage, an der schon
`isEcosystemReaderClick()` hängt. Für einen Besucher wäre eine gesperrte Region eine Region ohne
Infopanel: ein Funktionsverlust, den er nicht erklären und nicht rückgängig machen kann.

- [ ] **Schritt 4: Die vier Eingänge anschließen**

| Eingang | Datei | Verhalten bei Sperre |
|---|---|---|
| `layer.on("click")` | rendering.js | Fläche darunter → deren Klickbehandlung; sonst **ohne** `stopPropagation` aussteigen → `map.on("click")` feuert |
| `layer.on("contextmenu")` | rendering.js | Fläche darunter → deren Flächenmenü; sonst **ohne** `stop` aussteigen → `map.on("contextmenu")` öffnet das Kartenmenü |
| `layer.on("dblclick")` | rendering.js | dito, ohne `stop` |
| `AvesmapsEcosystemGeometryOps.handleAreaClick` | geometry-ops.js | gesperrte Fläche kommt als Ziel nicht in Frage |

⭐ **Für den Rechtsklick gibt es das Vorbild schon in derselben Datei**: der Strg-Notausgang steigt
ausdrücklich **ohne** `stop` aus, „genau das reicht das Ereignis an `map.on("contextmenu")` weiter,
und DORT wird `preventDefault` gerufen". Dieselbe Bauform, derselbe Kommentar-Anker.

💣 **In den Kommentar gehört KEINE Zahl.** „Eingang 1 von 4" liest sich wie eine vollständige Liste,
und genau daran ist es am 14.08.2026 gescheitert (Verkehrsmittel-Sperre in zwei von vier Erzeugern)
— es suchte niemand weiter. Stattdessen: alle vier gehen durch dieselbe Funktion, und der Kommentar
nennt die Funktion, nicht die Anzahl.

- [ ] **Schritt 5: Den Eingangs-Test schreiben — zur LAUFZEIT, nicht per Grep**

⭐ Vorbild `api/_internal/map/__tests__/field-origins-test.php`: der zählt die Schreibwege zur
Laufzeit und fand damit den zweiten, den der Autor übersehen hatte. Hier: einen Spion auf
`avesmapsEcosystemReichtWeiter` legen, alle vier Ereignisse auf einer gesperrten Fläche auslösen und
zusichern, dass er **viermal** gerufen wurde.

- [ ] **Schritt 6: Beide Tests laufen lassen**

Run: `node js/map-features/__tests__/ecosystem-sperre-durchlass.test.js`
Run: `node js/map-features/__tests__/ecosystem-sperre-eingaenge.test.js`
Expected: PASS

- [ ] **Schritt 7: Commit**

```bash
git status
git add js/map-features/map-features-ecosystem-sperre.js js/map-features/map-features-ecosystem-rendering.js js/map-features/map-features-ecosystem-geometry-ops.js index.html js/map-features/__tests__/ecosystem-sperre-durchlass.test.js js/map-features/__tests__/ecosystem-sperre-eingaenge.test.js
git diff --staged
git commit -m "feat(landschaften): eine gesperrte Region reicht Klicks durch und behaelt ihren Zettel"
```

---

### Aufgabe B6: Das Untermenü „Reihenfolge und Sperren"

**Files:**
- Create: `js/map-features/map-features-ecosystem-stapel.js` (Menüeinträge + Schreibaufrufe)
- Modify: `js/map-features/map-features-ecosystem-context-action.js` (`AREA_GROUPS` um `stapel`),
  `css/components/map-context-menu.css` (vier Glyphen), `index.html` (Skript-Tag)
- Modify: `js/map-features/__tests__/ecosystem-menue-struktur.test.js` (`stapel` ergänzen)

- [ ] **Schritt 1: Die Gruppe an ZWEI Stellen registrieren**

💣 Beide Listen aus Aufgabe A1, nicht nur eine — `AREA_GROUPS` sagt, wie die Gruppe **heißt**,
`AREA_MENU_ORDER` sagt, **wo** sie steht. Fehlt der zweite Eintrag, funktioniert alles und die
Gruppe landet trotzdem an der falschen Stelle (hinter „Kopieren …"), weil sie dann durch den
Rückfall auf „vor den ersten gefährlichen Eintrag" läuft.

```js
	// in AREA_GROUPS, nach `unterflaechen`:
	{ id: "stapel", key: "ecosystem.ctxmenu.areaMenuStack", label: "Reihenfolge und Sperren" },

	// in AREA_MENU_ORDER, zwischen `unterflaechen` und `ecosystem-properties`:
	{ typ: "gruppe", id: "stapel" },
```

- [ ] **Schritt 2: Die vier Einträge**

```js
	// 🔴 „REGION", NICHT „FLAECHE". Die Nachbarn im Menue heissen „Flaeche loeschen", „Flaeche malen"
	// -- die treffen EINE Teilflaeche. Diese vier treffen alles, was zur Region gehoert, auch ihre
	// weiteren Teilflaechen und Multipolygone (Owner 19.08.2026: „genau alles was ich anklick wird
	// gesperrt"). Der Unterschied gehoert ins Wort, nicht in eine Fussnote.
	//
	// 🔴 „VORN"/„HINTEN" HEISST IMMER *GANZ* -- im Menue wie im Fenster. Eine Stufe im einen und
	// „ganz" im anderen waeren zwei Bedeutungen fuer dasselbe Wort. Jede Ordnung laesst sich durch
	// wiederholtes Nach-vorn-Holen herstellen.
```

`Region sperren` ist ein **Umschalter**: bei einer bereits gesperrten Region heißt der Eintrag
„Region entsperren". Die Beschriftung wird beim Öffnen des Menüs gesetzt, nicht beim Registrieren.

⚠️ Rechtsklicken lässt sich eine gesperrte Region **nicht mehr** (das ist der Sinn) — der Umschalter
sieht seinen „entsperren"-Zustand also nur, wenn eine *andere* Fläche darüberliegt. Das ist kein
Fehler, es ist der Grund für das Fenster.

- [ ] **Schritt 3: Die Schreibaufrufe**

Alle drei gehen über `POST /api/edit/map/ecosystem.php` mit `action: "update_region"` und **nur**
dem Feld, das sich ändert. Nach dem Erfolg: die Region im geladenen Bestand nachziehen und
`applyEcosystemStackingOrder()` rufen.

- [ ] **Schritt 4: Glyphen ergänzen und den Struktur-Test erweitern**

- [ ] **Schritt 5: Im Browser: sperren, neu laden, prüfen, dass es hält**

- [ ] **Schritt 6: Commit**

```bash
git status
git add js/map-features/map-features-ecosystem-stapel.js js/map-features/map-features-ecosystem-context-action.js css/components/map-context-menu.css index.html js/map-features/__tests__/ecosystem-menue-struktur.test.js
git diff --staged
git commit -m "feat(landschaften): das Untermenue Reihenfolge und Sperren mit seinen vier Eintraegen"
```

---

### Aufgabe B7: Der Haken im Eigenschaften-Dialog

Owner 19.08.2026: „du kannst die eigenschaft auch hier anbieten."

**Files:**
- Modify: `index.html:979-982` (nach dem Nodix-Haken)
- Modify: `js/map-features/map-features-ecosystem-properties.js` (Laden, Speichern, Vergleich)
- Test: `js/map-features/__tests__/ecosystem-properties-sperre.test.js`

- [ ] **Schritt 1: Markup**

```html
						<label class="ecosystem-properties-dialog__checkbox">
							<input id="ecosystem-properties-locked" name="is_locked" type="checkbox" />
							<span data-i18n="ecosystem.properties.locked">Für Klicks gesperrt</span>
						</label>
						<p class="ecosystem-properties-dialog__hint" data-i18n="ecosystem.properties.lockedHint">Klicks fallen durch die Region hindurch auf das, was darunter liegt. Der Schwebezettel mit dem Namen bleibt. Gilt nur im Bearbeiten-Modus.</p>
```

⚠️ `data-i18n` ist hier richtig (anders als bei den injizierten Menüeinträgen): das Markup steht in
`index.html` und wird vom Übersetzungslauf gefunden.

- [ ] **Schritt 2: Laden und Speichern**

🔴 **Über den vorhandenen Speicherweg**, nicht mit einem eigenen Aufruf daneben: der Dialog schreibt
Name, Anzeige, Nodix und Art ohnehin in einem Zug. Ein zweiter Aufruf neben „Speichern" machte
„Abbrechen" für einen der beiden Werte wirkungslos.

Der Vergleich, der heute entscheidet, ob überhaupt geschrieben wird (`nextNodix === …` &&-Kette,
`:1306`), bekommt `naechsteSperre === Boolean(region.isLocked)` als weiteres Glied.

- [ ] **Schritt 3: Test** — Haken setzen → Rumpf trägt `is_locked: true`; Haken unberührt → Feld
  fehlt im Rumpf (Partialität).

- [ ] **Schritt 4: Im Browser: Haken setzen, speichern, Dialog erneut öffnen, Haken steht.**

- [ ] **Schritt 5: Commit**

---

### Aufgabe B8: Das Fenster „Reihenfolge und Sperren"

Gebaut nach `ecosystem-import-dialog` („Grenze aus Territorien") — dieselbe Hülle, dasselbe
Suchfeld, dieselbe Listenform. **Kein neues Fensteraussehen.**

**Files:**
- Modify: `index.html` (Overlay + Dialog), `css/features/ecosystem-layer.css` (Listenzeile),
  `js/map-features/map-features-ecosystem-stapel.js` (Aufbau, Suche, Aktionen)

- [ ] **Schritt 1: Markup nach dem Vorbild**, Klassen `ecosystem-stapel-dialog__*`
- [ ] **Schritt 2: Liste füllen** aus `action: "list_regions"` mit `kind` — der Endpunkt liefert
  bereits `area_count` und (nach B3) `stack_order`/`is_locked`, absteigend sortiert
- [ ] **Schritt 3: Suche** — dieselbe Filterform wie `territoryImportVisibleRows`
- [ ] **Schritt 4: Die drei Zeilenaktionen** ⤒ ⤓ 🔒, jede ein `update_region` mit einem Feld
- [ ] **Schritt 5: Bilanzzeile** „7 Regionen · 3 gesperrt" (Vorbild `review-list-balance.js`: sie
  trägt nur, was der Filter bewegt)
- [ ] **Schritt 6: Im Browser** — eine Region nach hinten schieben, Fenster schließen, neu laden,
  Reihenfolge hält
- [ ] **Schritt 7: Commit**

⚠️ **Zeilenaktion ≠ Haupthandlung** (AGENTS.md §12): die drei Knöpfe je Zeile sind weich/outline
(`--color-button-soft*`, `--radius-md`), niemals gefüllt. Bei 777 Regionen multipliziert sich ein
Akzentknopf mit der Zeilenzahl — genau der Fehler, der 2026-08-07 in den WikiSync-Listen
zurückgebaut wurde.

---

### Aufgabe B9: Der Zähler in der Landschaften-Leiste

**Files:**
- Modify: `js/map-features/map-features-ecosystem-layer-switch.js`,
  `css/features/ecosystem-layer.css`

🔴 **Er ist der einzige Ort, an dem eine Sperre sichtbar wird.** Auf der Karte sieht eine gesperrte
Region **unverändert** aus — sie soll aussehen wie immer und nur den Klick nicht abfangen. Ohne den
Zähler sucht in zwei Wochen jemand eine Fläche, die nicht mehr reagiert, und findet den Grund nicht.

- [ ] **Schritt 1: Knopf** „🔒 3" neben dem Ebenen-Umschalter, zählt die gesperrten Regionen der
  **aktiven** Ebene, öffnet das Fenster aus B8
- [ ] **Schritt 2: Bei 0 unauffällig** (kein Akzent, keine Zahl)
- [ ] **Schritt 3: Test** — Zahl folgt der aktiven Ebene
- [ ] **Schritt 4: Commit**

---

### Aufgabe B10: Tor — Testfeld und zweiter Deploy

- [ ] **Schritt 1: Das ganze Testfeld** (alle drei Läufe)
- [ ] **Schritt 2: Der eigene Entwurf ist die Abnahmeliste** — jede Zeile mit 💣 / ⚠️ / 🔴 in
  `docs/superpowers/specs/2026-08-19-landschaften-reihenfolge-und-sperren-design.md` und in diesem
  Plan einzeln abhaken: erfüllt, oder ausdrücklich verworfen mit Begründung.
- [ ] **Schritt 3: Die Sub-Agenten** `usability-konsistenz` (Entwurf gegen Diff) und
  `usability-design` (Mockup gegen gebauten Zustand, hell UND dunkel)
- [ ] **Schritt 4: Prüfbaum, cherry-pick der B-Commits, Testfeld dort, push** (Ablauf wie A4)
- [ ] **Schritt 5: Live nachsehen — der ABLAUF, nicht das Maß**

Die Handgriffe, die wirklich ausgeführt und benannt werden:
1. Eine große Region sperren. Auf ihre Mitte klicken → es passiert, was ohne sie passiert wäre.
2. Über sie fahren → **der Schwebezettel kommt.** (Das ist die Zusicherung, die eine
   `pointer-events`-Lösung lautlos verlöre.)
3. Rechtsklick auf die gesperrte Fläche → das **Kartenmenü** geht auf, „Hier hinzufügen" ist da.
4. Fenster öffnen, nach ihr suchen, entsperren → sie reagiert wieder.
5. Eine Region nach hinten schieben, neu laden → sie liegt hinten.
6. **Abgemeldet** (anderer Browser / privates Fenster): dieselbe gesperrte Region anklicken → das
   Infopanel geht auf. Die Sperre gilt nur im Bearbeiten-Modus.

⚠️ Zweimal messen, mit Abstand — eine Live-Probe unmittelbar nach dem Deploy misst die alte Fassung.

- [ ] **Schritt 6: Dem Owner in einem Satz Bescheid geben.**
