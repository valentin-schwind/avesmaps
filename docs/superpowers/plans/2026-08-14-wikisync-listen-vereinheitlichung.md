# WikiSync-Listen vereinheitlichen — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen
> Kästchen (`- [ ]`).

**Ziel:** Die acht WikiSync-Listen im Panel und die sechs Listen in den Editorfenstern tragen
dieselbe Zeilenform und dieselbe Schriftskala — bei unveränderter Funktion und unverändertem
Informationsgehalt.

**Architektur:** Nach dem Umbau gibt es **zwei** Listenzeilen-Regeln statt sieben:
`.wikisync-itemlist .tree-item` (Panel, 400px, Statuskreis) und `.avm-row`
(Editorfenster, Seitenspalte, Auswahlzustand). Beide auf derselben Token-Skala. Dazu **ein**
Erzeuger für die Bilanzzeile statt acht Zählformeln. Die Renderpfade der Listen bleiben unberührt.

**Technik:** Vanilla JS ohne Bauschritt, handgeschriebenes CSS auf `css/base/tokens.css`,
Tests als reine Node-Skripte (`node <pfad>.test.js`, `require("assert")`).

**Entwurf:** `docs/superpowers/specs/2026-08-14-wikisync-listen-vereinheitlichung-design.md`
**Mockup:** `docs/wikisync-listen-mockup.html`

## Globale Vorgaben

Diese gelten für **jede** Aufgabe, ohne dass sie dort wiederholt werden:

- 🔴 **Keine Zahl ändert ihren Wert, keine Angabe verschwindet, keine Funktion kommt hinzu.**
  Einzige Ausnahme: die Kraftlinien-Dopplung (Aufgabe 5), begründet im Entwurf §5.
- ⚠️ **Kraftlinien bekommt KEINEN Filtertrichter**, obwohl es als einzige Liste ohne dasteht und
  die Versuchung in jeder Aufgabe mitläuft. Einen hinzuzufügen wäre neue Funktion. Das Suchfeld
  nimmt dort die volle Breite — das ist der gewollte Zustand, kein Übersehen.
- 🔴 **Nie eine Farbe, ein Radius oder eine Schriftgröße hart schreiben.** Immer ein Token aus
  `css/base/tokens.css`. Gebraucht: `--font-size-caption` 11px · `--font-size-small` 12px ·
  `--font-size-body` 13px · `--font-weight-bold` 700 · `--color-divider` · `--color-hover-wash` ·
  `--color-text-strong` · `--color-text-muted` · `--radius-md` 8px · `--space-2` 4px ·
  `--space-4` 6px · `--space-6` 8px · `--space-8` 10px.
- 🔴 **11px ist die Untergrenze** (`docs/design-language.md`). Kein `10px`, kein `0.78em`,
  kein `10.4px`. Kompaktheit kommt aus der Polsterung, nie aus der Schrift.
- 💣 **Geteilte Arbeitskopie — nie `git add -A`, `git add .`, `git commit -a`.** Andere Sitzungen
  haben gerade unfertige Arbeit im Baum (u.a. unter `js/routing/`, `js/ui/`, `js/app/`). Immer erst
  `git status`, dann **nur die eigenen Pfade einzeln** anfügen.
- 💣 **Vor JEDEM Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests:
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
  ```
  Ein roter Test lädt **nichts** hoch, und der Fehlschlag vergiftet danach den `?v=`-Stempel
  (AGENTS.md §9).
- 🔴 **Jede Aufgabe geht EINZELN live, und der Owner sieht sie an, bevor die nächste beginnt.**
  Ein Commit, ein Push, sein Blick. Kein Bündel. (AGENTS.md §9 — am 10.08.2026 gingen neun
  Commits am Stück live und vier Regressionen kamen vom Telefon des Owners zurück.)
- ⭐ Vor dem Commit den Sub-Agenten `usability-konsistenz`, vor dem Push `usability-design`.
- ⚠️ Abnahme heißt **Ablauf, nicht Maß**: die Handgriffe aus Entwurf §9 werden ausgeführt und
  benannt, in **hell UND dunkel**. Eine grüne Messtabelle ist kein Beleg.

---

## Dateiübersicht

| Datei | Rolle nach dem Umbau |
|---|---|
| `css/components/region-sync.css` | **Die einzige** Panel-Zeilenregel (§3), gilt auch für Territorien |
| `css/pages/political-territory-wiki-tree.css` | verliert den `#wiki-sync-territory-tree .tree-item`-Block; behält die Basisregel `.tree-item` für den Territorien-Editor |
| `css/pages/political-territory-editor-inline.css` | 💣 **Bauprodukt** — nur über `node tools/scope_editor_css.js` |
| `js/territory/territory-editor-inline-host.js` | `ASSET_VERSION` hochzählen, sobald das Bauprodukt sich ändert |
| `css/features/review-panel.css` | `.wiki-sync-adv-picker__row` entfällt; `__scroll` verliert den Kasten |
| `js/review/review-list-balance.js` | **neu** — der eine Bilanzzeilen-Erzeuger |
| `css/components/editor-page.css` | `.avm-row` bleibt die kanonische Editor-Zeile |
| `html/wiki-sync-settlement-editor.html`, `html/wiki-sync-powerline-editor.html` | Inline-`.se-row` entfällt |
| `html/game-literature-editor.html`, `html/citymap-editor.html` | Inline-`.ae-item`/`.ce-item` entfällt |

---

## Aufgabe 1: Panel — die Zeilenregel steht genau einmal

Heute steht dieselbe Rezeptur zweimal: `.wikisync-itemlist .tree-item`
(`css/components/region-sync.css:922`) und `#wiki-sync-territory-tree .tree-item`
(`css/pages/political-territory-wiki-tree.css:122`). Diese Aufgabe legt sie zusammen.

💣 **BEIM BAU AM 14.08.2026 KAM EINE DRITTE ZUM VORSCHEIN**, in derselben Datei ein paar hundert
Zeilen höher:
```css
#region-sync-list .region-sync__item,
#path-sync-list .region-sync__item { padding: 6px 8px; border-bottom: 1px solid var(--color-panel-muted); }
```
Die Zeilen der Regionen- und Wegeliste tragen **beide** Klassen (`"tree-item region-sync__item"`,
1× in `review-region-sync.js`, 6× in `review-path-sync.js`), und diese Regel schlug mit (1,1,0) die
geteilte mit (0,2,0). **Zwei der acht Listen hörten also gar nicht auf die gemeinsame Regel** — die
kompakten Maße aus Aufgabe 2 wären dort wirkungslos geblieben, ohne Fehler und ohne Hinweis. Sie
ist ersatzlos entfernt (sie setzte exakt dieselben Werte) und Prüfung 6 des Wachtests verbietet
ihre Rückkehr.

💣 **Die Reihenfolge rettet dich nicht.** `region-sync.css` steht in `index.html:52` *nach*
`political-territory-wiki-tree.css:51`, aber `#wiki-sync-territory-tree .tree-item` hat
Spezifität (1,1,0) gegen (0,2,0) — die ID gewinnt unabhängig von der Reihenfolge. Die beiden
Selektoren müssen deshalb an **derselben Regel** stehen; sie bloß umzusortieren wirkt nicht.

**Dateien:**
- Erstellen: `js/review/__tests__/wikisync-list-form.test.js`
- Ändern: `css/components/region-sync.css:922-1005`
- Ändern: `css/pages/political-territory-wiki-tree.css:122-186` (Block löschen)
- Ändern: `css/pages/political-territory-editor-inline.css` (regeneriert, nicht von Hand)
- Ändern: `js/territory/territory-editor-inline-host.js:23`

**Schnittstellen:**
- Liefert: die Regel `.wikisync-itemlist .tree-item, #wiki-sync-territory-tree .tree-item` als
  einzige Quelle der Panel-Zeilenform. Aufgabe 2 ändert ihre Werte, Aufgabe 3 hängt drei weitere
  Listen daran.

- [ ] **Schritt 1: Den Wachtest schreiben**

Erstelle `js/review/__tests__/wikisync-list-form.test.js`:

```js
// Die Panel-Zeilenform steht genau EINMAL.
//
// 🔴 DIESER TEST EXISTIERT, WEIL DIE REZEPTUR ZWEIMAL GESCHRIEBEN WAR. `.wikisync-itemlist
// .tree-item` (region-sync.css) und `#wiki-sync-territory-tree .tree-item`
// (political-territory-wiki-tree.css) setzten beide dasselbe Raster, dieselbe Polsterung,
// denselben Zeilenabstand und denselben 13px-Statuskreis -- in zwei Dateien, zweimal gepflegt.
// Genau daraus wuchs die Divergenz, die der Owner am 14.08.2026 gemeldet hat.
//
// Ohne diesen Test waechst sie nach: die naechste Aenderung fasst wieder nur eine der beiden an,
// und niemand sieht es, weil beide Listen einzeln richtig aussehen.
//
// Run: node js/review/__tests__/wikisync-list-form.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

const regionSync = lies("css", "components", "region-sync.css");
const wikiTree = lies("css", "pages", "political-territory-wiki-tree.css");

let checks = 0;

// ---- 1. Der Territorien-Block ist fort ---------------------------------------------------------
assert.ok(!/#wiki-sync-territory-tree\s+\.tree-item\s*\{/.test(wikiTree),
	'political-territory-wiki-tree.css definiert wieder eine eigene "#wiki-sync-territory-tree '
	+ '.tree-item"-Regel. Die Panel-Zeilenform gehoert NUR nach region-sync.css. '
	+ 'Die Basisregel ".tree-item" (ohne ID davor) bleibt hier -- sie traegt den Territorien-EDITOR.');
checks++;

assert.ok(/^\.tree-item\s*\{/m.test(wikiTree),
	'Die Basisregel ".tree-item" fehlt in political-territory-wiki-tree.css. Sie traegt den Baum im '
	+ 'Territorien-Editor (inline-flex, cursor:grab) und darf NICHT mit entfernt werden.');
checks++;

// ---- 2. Die gemeinsame Regel nennt beide Selektoren --------------------------------------------
const gemeinsam = regionSync.match(
	/(\.wikisync-itemlist \.tree-item,\s*\n#wiki-sync-territory-tree \.tree-item)\s*\{([\s\S]*?)\n\}/);
assert.ok(gemeinsam,
	'In region-sync.css fehlt die gemeinsame Regel. Erwartet werden BEIDE Selektoren an DERSELBEN '
	+ 'Regel:\n  .wikisync-itemlist .tree-item,\n  #wiki-sync-territory-tree .tree-item { ... }\n'
	+ 'Zwei getrennte Regeln reichen nicht: die ID hat Spezifitaet (1,1,0) gegen (0,2,0) und '
	+ 'gewinnt unabhaengig von der Ladereihenfolge.');
checks++;

// ---- 3. Territorien traegt jetzt volle Breite und Trennlinie -----------------------------------
const rumpf = gemeinsam[2];
assert.ok(!/display:\s*inline-grid/.test(rumpf),
	'Die gemeinsame Zeile steht auf "inline-grid". Damit waere die Ueberfahrt nur so breit wie der '
	+ 'Text -- das war Territorien-Sonderverhalten und faellt weg.');
checks++;
assert.ok(/border-bottom:\s*1px solid var\(--color-divider\)/.test(rumpf),
	'Der gemeinsamen Zeile fehlt die Trennlinie auf --color-divider.');
checks++;

console.log(`wikisync-list-form: ${checks} Pruefungen bestanden.`);
```

- [ ] **Schritt 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
node js/review/__tests__/wikisync-list-form.test.js
```
Erwartet: rot bei Prüfung 1 — `political-territory-wiki-tree.css` definiert den Block noch.

- [ ] **Schritt 3: Die beiden Regeln zusammenlegen**

In `css/components/region-sync.css` den Selektor von Zeile 922 erweitern und die drei
Territorien-Füllvarianten aufnehmen. Aus:

```css
.wikisync-itemlist .tree-item {
```

wird:

```css
/* Die EINE Panel-Zeilenform -- fuer alle fuenf Karten-Subjekte inklusive der Territorien.
   💣 Bis 14.08.2026 stand dieselbe Rezeptur ein zweites Mal in
   css/pages/political-territory-wiki-tree.css:122. Beide Selektoren gehoeren an DIESE Regel:
   "#wiki-sync-territory-tree .tree-item" hat Spezifitaet (1,1,0) und gewuerde eine getrennte
   Regel mit (0,2,0) immer schlagen, egal in welcher Reihenfolge die Dateien geladen werden.
   Gewacht von js/review/__tests__/wikisync-list-form.test.js. */
.wikisync-itemlist .tree-item,
#wiki-sync-territory-tree .tree-item {
```

Ebenso den Selektor jeder abhängigen Regel im Block erweitern (`.drag-handle`, `.tree-item-name`,
`.tree-item-name::after`, die drei `:has(.tree-map-status--…)`-Varianten, `.tree-item-meta`,
`.tree-map-status`). Die Variante `--children-only` gab es bisher nur bei Territorien und kommt
mit in die gemeinsame Regel:

```css
.wikisync-itemlist .tree-item:has(.tree-map-status--children-only) .tree-item-name::after,
#wiki-sync-territory-tree .tree-item:has(.tree-map-status--children-only) .tree-item-name::after {
	background: linear-gradient(to right, var(--color-map-presence) 0 50%, var(--color-panel) 50% 100%);
}
```

Und die Trennlinie auf das Trenn-Token setzen (war `--color-panel-muted`, eine Füllfarbe):

```css
	border-bottom: 1px solid var(--color-divider);
```

- [ ] **Schritt 4: Den Territorien-Block löschen**

In `css/pages/political-territory-wiki-tree.css` die Zeilen **122–186** entfernen — vom
`#wiki-sync-territory-tree .tree-item {` bis einschließlich des abschließenden
`#wiki-sync-territory-tree .tree-map-status { display: none; }`.

🔴 **Die Basisregel `.tree-item` in Zeile 71 bleibt unberührt.** Sie ist `display: inline-flex`
mit `cursor: grab` und trägt den Baum im **Territorien-Editor**, nicht im Panel. Wer sie
mitlöscht, zerlegt eine zweite Oberfläche.

An die Stelle des gelöschten Blocks kommt ein Zeiger:

```css
/* Die Panel-Fassung der Baumzeile (#wiki-sync-territory-tree) stand hier bis 14.08.2026 und war
   eine wortgleiche Zweitschrift von .wikisync-itemlist .tree-item. Sie steht jetzt gemeinsam mit
   jener in css/components/region-sync.css. Hier NICHTS wieder hinzuschreiben -- die Regel dort
   nennt beide Selektoren. */
```

- [ ] **Schritt 5: Das Bauprodukt regenerieren**

💣 Diese Datei ist eine der **drei Quellen** von `css/pages/political-territory-editor-inline.css`
(AGENTS.md §10). Eine Handänderung am Bauprodukt wirkt sofort und stirbt beim nächsten Lauf —
das ist dreimal passiert.

```bash
node tools/scope_editor_css.js
node tools/__tests__/scope-editor-css.test.js
```
Erwartet: grün („generiert == Generatorausgabe").

- [ ] **Schritt 6: `ASSET_VERSION` hochzählen**

In `js/territory/territory-editor-inline-host.js:23` den Wert erhöhen, z.B.
`const ASSET_VERSION = "20260812a";` → `const ASSET_VERSION = "20260814a";`
Ohne diesen Schritt serviert der Browser den alten Editor (AGENTS.md §7).

- [ ] **Schritt 7: Tests laufen lassen**

```bash
node js/review/__tests__/wikisync-list-form.test.js
```
Erwartet: `wikisync-list-form: 6 Pruefungen bestanden.`

Dann das ganze Feld:
```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

- [ ] **Schritt 8: Ablaufprüfung (nicht messen — anfassen)**

Panel öffnen → Reiter **Territorien** → Baum aufklappen. Prüfen und benennen:
Zeile über die **volle Breite**? Trennlinie da? **Einrückung des Baums intakt** (sie ist
Hierarchie-Information)? Statuskreis mit seinen vier Füllungen (leer / halb links / halb rechts /
voll) unverändert? Ziehen einer Zeile funktioniert? Danach dasselbe im **hellen** Thema —
`--color-panel-muted` war dort fast unsichtbar, `--color-divider` ist es nicht.

- [ ] **Schritt 9: Committen**

```bash
git status
git add js/review/__tests__/wikisync-list-form.test.js css/components/region-sync.css css/pages/political-territory-wiki-tree.css css/pages/political-territory-editor-inline.css js/territory/territory-editor-inline-host.js
git commit
```
Betreff: `ui(wikisync): Territorien-Zeile teilt sich die Regel der anderen vier Listen`

**Danach: pushen und den Owner draufschauen lassen. Erst dann Aufgabe 2.**

---

## Aufgabe 2: Panel — die kompakte Zeile

**Dateien:**
- Ändern: `css/components/region-sync.css` (die gemeinsame Regel aus Aufgabe 1)
- Ändern: `js/review/__tests__/wikisync-list-form.test.js` (Werte-Prüfungen ergänzen)

**Schnittstellen:**
- Verbraucht: die gemeinsame Regel aus Aufgabe 1.
- Liefert: die Maße, an die Aufgabe 3 drei weitere Listen anschließt.

- [ ] **Schritt 1: Die Werte-Prüfungen ergänzen**

Vor die `console.log`-Zeile in `js/review/__tests__/wikisync-list-form.test.js`:

```js
// ---- 4. Die Masse der kompakten Zeile ----------------------------------------------------------
// 💣 Der Zeilenabstand war 7px und ist BEWUSST auf 2px zurueckgedreht (Owner 14.08.2026).
// Der alte Kommentar in region-sync.css begruendete die 7px damit, dass sie "einheitlich wie
// Siedlungen" seien -- das galt, solange Siedlungen 7px hatte. Jetzt haben alle 2px.
assert.ok(/row-gap:\s*2px/.test(rumpf),
	'Der gemeinsamen Zeile fehlt "row-gap: 2px" (war 7px). Daher kommt der groesste Teil der '
	+ 'Hoehenersparnis: 48,7px -> 42,0px.');
checks++;

assert.ok(/padding:\s*5px 8px/.test(rumpf),
	'Der gemeinsamen Zeile fehlt "padding: 5px 8px" (war 6px 8px).');
checks++;

// ---- 5. Die Schriftskala -- 11px ist die Untergrenze -------------------------------------------
const nameRegel = regionSync.match(/\.wikisync-itemlist \.tree-item-name,[\s\S]*?\n\}/);
assert.ok(nameRegel && /font-size:\s*var\(--font-size-body\)/.test(nameRegel[0]),
	'Der Name muss auf var(--font-size-body) stehen. Vorher erbte er body{font-size:10pt} = 13,33px '
	+ '-- ein Wert, den die Skala in tokens.css gar nicht kennt.');
checks++;

const metaRegel = regionSync.match(/\.wikisync-itemlist \.tree-item-meta,[\s\S]*?\n\}/);
assert.ok(metaRegel && /font-size:\s*var\(--font-size-caption\)/.test(metaRegel[0]),
	'Die Meta-Zeile muss auf var(--font-size-caption) = 11px stehen. Vorher 0.78em = 10,4px, also '
	+ 'UNTER der Untergrenze aus docs/design-language.md. Sie wird dabei GROESSER -- die '
	+ 'Kompaktheit kommt aus der Polsterung, nie aus der Schrift.');
checks++;

assert.ok(!/font-size:\s*0\.78em/.test(regionSync),
	'In region-sync.css steht wieder "font-size: 0.78em" (= 10,4px). Unter der 11px-Untergrenze.');
checks++;

// ---- 6. Die Ueberfahrt liegt auf ihrem eigenen Token --------------------------------------------
assert.ok(/\.wikisync-itemlist \.tree-item:hover,[\s\S]{0,200}?background:\s*var\(--color-hover-wash\)/
	.test(regionSync),
	'Die Ueberfahrt muss var(--color-hover-wash) sein -- das Token ist in tokens.css woertlich als '
	+ '"row / option hover" dokumentiert. Vorher --color-panel-soft, eine Flaechenfarbe.');
checks++;
```

- [ ] **Schritt 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
node js/review/__tests__/wikisync-list-form.test.js
```
Erwartet: rot bei Prüfung 4 — `row-gap: 7px` steht noch da.

- [ ] **Schritt 3: Die Werte setzen**

In der gemeinsamen Regel in `css/components/region-sync.css`:

```css
	column-gap: 7px;
	/* 💣 War 7px. Der alte Kommentar hier begruendete sie mit "einheitlich wie Siedlungen" --
	   jemand hatte sie 2026 bewusst von 2 auf 7 gehoben, um zu vereinheitlichen. Owner
	   14.08.2026: "ja die 7px umdrehen". Jetzt haben alle acht Listen 2px, die Einheitlichkeit
	   bleibt also gewahrt -- nur enger. Gemessen 48,7px -> 42,0px je Zeile. */
	row-gap: 2px;
	padding: 5px 8px;
```

Überfahrt:
```css
.wikisync-itemlist .tree-item:hover,
#wiki-sync-territory-tree .tree-item:hover {
	background: var(--color-hover-wash);
}
```

Name und Meta:
```css
.wikisync-itemlist .tree-item-name,
#wiki-sync-territory-tree .tree-item-name {
	grid-column: 2;
	grid-row: 1;
	min-width: 0;
	/* Erbte vorher body{font-size:10pt} = 13,33px -- kein Sprosse der Skala in tokens.css. */
	font-size: var(--font-size-body);
	font-weight: var(--font-weight-bold);
	line-height: 1.22;
}

.wikisync-itemlist .tree-item-meta,
#wiki-sync-territory-tree .tree-item-meta {
	grid-column: 2;
	grid-row: 2;
	/* War 0.78em = 10,4px, unter der 11px-Untergrenze der Designsprache. Sie WAECHST hier. */
	font-size: var(--font-size-caption);
	font-weight: var(--font-weight-bold);
	line-height: 1.2;
	color: var(--color-text-muted);
	white-space: normal;
}
```

Statuskreis von 13px auf 11px (🔧 abgeleitet, nicht vom Owner beschlossen — ein 13px-Kreis neben
einem 13px-Namen ist höher als dessen Versalhöhe und zieht die Zeile auf):

```css
	width: 11px;
	height: 11px;
	margin-left: 6px;
```

- [ ] **Schritt 4: Tests laufen lassen**

```bash
node js/review/__tests__/wikisync-list-form.test.js
```
Erwartet: `wikisync-list-form: 12 Pruefungen bestanden.`
Dann das ganze Feld (Befehl oben).

- [ ] **Schritt 5: Ablaufprüfung**

Panel öffnen, durch **Orte, Territorien, Regionen, Wege, Kraftlinien** klicken. Prüfen:
Passen sichtbar mehr Zeilen ins Panel? Ist die Meta-Zeile **besser** lesbar als vorher (sie wurde
größer)? Bei **Regionen**: beginnen alle Namen an derselben x-Position, auch die ziehbaren
(z.B. Adamantenland)? Umbrechen die Chip-Zeilen („Fläche zuweisen") noch sauber? Bei **Wegen**:
passen die Segment-Chips noch in die engere Zeile? Hell und dunkel.

- [ ] **Schritt 6: Committen**

```bash
git status
git add css/components/region-sync.css js/review/__tests__/wikisync-list-form.test.js
git commit
```
Betreff: `ui(wikisync): kompaktere Listenzeile -- 48,7px auf 42,0px, Meta zurueck auf die Skala`

**Pushen, Owner draufschauen lassen, dann Aufgabe 3.**

---

## Aufgabe 3: Panel — Literatur, Karten und Vorkommen übernehmen die gemeinsame Zeile

Diese drei tragen heute `.wiki-sync-adv-picker__row` (`css/features/review-panel.css:671`):
Kasten um die Liste, `border-bottom` je Zeile, feste 12px/11px.

🔴 **Sie bekommen KEINEN Statuskreis.** Sie haben kein „liegt auf der Karte" — das Fehlen ist
Information. Der Kreis muss deshalb an einer Klasse hängen, die nur die fünf Karten-Subjekte
tragen.

**Dateien:**
- Ändern: `css/components/region-sync.css` (Kreis-Regel umhängen)
- Ändern: `css/features/review-panel.css:660-697`
- Ändern: `js/review/review-settlement-list.js:1059`, `:1189` (Literatur- und Karten-Zeilen)
- Ändern: `js/review/review-wiki-sync.js` (Vorkommen-Zeilen, Renderer bei `lore-list-scroll`)
- Ändern: `js/review/__tests__/wikisync-list-form.test.js`

**Schnittstellen:**
- Verbraucht: die Regel aus Aufgabe 1/2.
- Liefert: Markup `<div class="tree-item">` mit `.tree-item-name` / `.tree-item-meta` in allen acht
  Listen; die Klasse `has-map-status` markiert die fünf mit Kreis.

- [ ] **Schritt 1: Prüfung ergänzen**

```js
// ---- 7. Der Statuskreis gehoert nur den fuenf Karten-Subjekten ---------------------------------
// 🔴 Literatur, Karten und Vorkommen haben kein "liegt auf der Karte". Ein Kreis dort waere eine
// Behauptung ueber Daten, die es nicht gibt. Beim ersten Entwurf des Mockups hing die
// ::after-Regel global an der Zeile und malte den Kreis auch in die Vorkommen-Liste -- gesehen
// hat das der Owner, nicht das Werkzeug.
const kreis = regionSync.match(/\.tree-item-name::after[\s\S]{0,400}?\n\}/);
assert.ok(kreis && /has-map-status/.test(regionSync.slice(0, regionSync.indexOf(kreis[0]) + 10)),
	'Die Statuskreis-Regel haengt nicht an ".has-map-status". Sie darf NICHT an ".tree-item" '
	+ 'allein haengen, sonst bekommen Literatur, Karten und Vorkommen einen Kreis, den ihre Daten '
	+ 'nicht hergeben.');
checks++;

const reviewPanel = lies("css", "features", "review-panel.css");
assert.ok(!/\.wiki-sync-adv-picker__row\s*\{/.test(reviewPanel),
	'.wiki-sync-adv-picker__row existiert noch. Literatur, Karten und Vorkommen sollen die '
	+ 'gemeinsame Zeile tragen, nicht eine zweite Rezeptur.');
checks++;

assert.ok(!/\.wiki-sync-adv-picker__scroll[\s\S]{0,300}?border:\s*1px solid/.test(reviewPanel),
	'Der Kasten um die Liste (.wiki-sync-adv-picker__scroll mit border) steht noch. Gruppiert wird '
	+ 'per Trennlinie, nicht per Rahmen (AGENTS.md §12).');
checks++;
```

- [ ] **Schritt 2: Test laufen lassen — muss FEHLSCHLAGEN**

```bash
node js/review/__tests__/wikisync-list-form.test.js
```
Erwartet: rot bei Prüfung 7.

- [ ] **Schritt 3: Die Kreis-Regel umhängen**

In `css/components/region-sync.css` jede der fünf Kreis-Regeln um `.has-map-status` ergänzen:

```css
/* 🔴 Der Kreis haengt an .has-map-status, NICHT an .tree-item. Nur die fuenf Karten-Subjekte
   (Orte, Territorien, Regionen, Wege, Kraftlinien) setzen die Klasse. Literatur, Karten und
   Vorkommen haben kein "liegt auf der Karte" -- ihr fehlender Kreis ist Information. */
.wikisync-itemlist .tree-item.has-map-status .tree-item-name::after,
#wiki-sync-territory-tree .tree-item.has-map-status .tree-item-name::after {
	content: "";
	display: inline-block;
	width: 11px;
	height: 11px;
	margin-left: 6px;
	vertical-align: -2px;
	border: 2px solid var(--color-map-presence);
	border-radius: 50%;
	background: var(--color-panel);
	box-sizing: border-box;
}
```

Ebenso bei den drei `:has(.tree-map-status--…)`-Varianten.

- [ ] **Schritt 4: `has-map-status` in den fünf bestehenden Renderern setzen**

- `js/review/review-settlement-list.js:421` — `const classes = "tree-item has-map-status settlement-list__item" + …`
- `js/review/review-region-sync.js:264` — `const classes = "tree-item has-map-status region-sync__item" + …`
- `js/review/review-path-sync.js:357`, `:395`, `:575` — `'<div class="tree-item has-map-status region-sync__item">'`
- `js/review/review-powerline-list.js:146` — `'<div class="tree-item has-map-status region-sync__item powerline-sync__item" …'`
- Territorien-Baum in `js/review/review-wiki-sync.js` — dort, wo `class="tree-item"` für
  `#wiki-sync-territory-tree` erzeugt wird, dieselbe Klasse ergänzen.

- [ ] **Schritt 5: Die drei Listen auf die gemeinsame Zeile umstellen**

In `js/review/review-settlement-list.js:1059` (Literatur):

```js
		return '<button type="button" class="tree-item wiki-sync-adv-picker__row" data-adv-id="' + esc(a.public_id) + '" title="Doppelklick: im Literatur-Editor öffnen">'
```
wird zu:
```js
		return '<button type="button" class="tree-item" data-adv-id="' + esc(a.public_id) + '" title="Doppelklick: im Literatur-Editor öffnen">'
```
und die beiden Kindelemente von `wiki-sync-adv-picker__title` / `__meta` auf
`tree-item-name` / `tree-item-meta`.

Dasselbe in `js/review/review-settlement-list.js:1189` (Karten) und im Vorkommen-Renderer in
**`js/review/review-wiki-sync.js:2659–2664`**:

```js
	return '<button type="button" class="tree-item" data-lore-entry="'
		+ …
		+ '<span class="tree-item-name">' + avesmapsLoreListEscape(item.name) + "</span>"
		+ '<span class="tree-item-meta">' + avesmapsLoreListEscape(meta) + "</span>"
```

⚠️ Der Kommentar bei `js/review/review-wiki-sync.js:2709` sagt heute „Dieselben Klassen wie die
Abenteuer- und Kartenliste (wiki-sync-adv-picker__row)". Er muss mit umgeschrieben werden, sonst
zeigt er auf eine Klasse, die es nicht mehr gibt.

⚠️ Die Zeilen sind `<button>`, die anderen fünf `<div>`/`<span>`. Das bleibt so — der Knopf trägt
Tastaturbedienung, die nicht verloren gehen darf. Die gemeinsame Regel braucht dafür
`border: 0; background: transparent; font: inherit; text-align: left; width: 100%;`, damit ein
`<button>` wie eine Zeile aussieht.

- [ ] **Schritt 5b: Die Griff-Spalte für die drei handgrifflosen Listen abräumen**

🔴 Entwurf §3: *„Die 16px-Spalte ist pro LISTE reserviert, nicht pro Zeile."* In den fünf
Karten-Listen bleibt sie stehen, damit ziehbare und nicht ziehbare Zeilen bündig beginnen
(Owner: „kein einrücken von Adamentenland"). Literatur, Karten und Vorkommen haben **gar keine**
ziehbaren Zeilen — dort verschwendete sie 23px Breite in einem 400px-Panel.

In `css/components/region-sync.css`:

```css
/* Listen ohne Ziehgriff (Literatur, Karten, Vorkommen) lassen die Griff-Spalte weg. Innerhalb
   EINER Liste bleibt sie dagegen immer reserviert -- sonst ruecken die nicht ziehbaren Zeilen
   gegen die ziehbaren ein (Owner 14.08.2026, an Adamantenland in der Regionenliste gesehen). */
.wikisync-itemlist--nodrag .tree-item {
	grid-template-columns: minmax(0, 1fr);
}
.wikisync-itemlist--nodrag .tree-item-name,
.wikisync-itemlist--nodrag .tree-item-meta {
	grid-column: 1;
}
```

Die Klasse `wikisync-itemlist--nodrag` in `index.html` an die drei Scroll-Behälter
`#wiki-sync-adv-scroll`, `#wiki-sync-cm-scroll` und `#lore-list-scroll` hängen — zusätzlich zu
`wikisync-itemlist`, das dort neu dazukommt (bisher trugen sie `wiki-sync-adv-picker__scroll`).

- [ ] **Schritt 6: Kasten und Altregel entfernen**

In `css/features/review-panel.css`: `.wiki-sync-adv-picker__row`, `__row:last-child`,
`__row:hover`, `__title`, `__meta` löschen. Bei `.wiki-sync-adv-picker__scroll` `border` und
`background` entfernen, `border-radius` entfernen — `flex`, `min-height`, `overflow-y` bleiben.

- [ ] **Schritt 7: Tests laufen lassen**

```bash
node js/review/__tests__/wikisync-list-form.test.js
```
Erwartet: `wikisync-list-form: 15 Pruefungen bestanden.` Dann das ganze Feld.

- [ ] **Schritt 8: Ablaufprüfung**

Reiter **Literatur**: Kasten weg? **Kein Statuskreis**? Doppelklick öffnet weiterhin den
Literatur-Editor? Reiter **Karten**: dasselbe, Doppelklick öffnet den Karteneditor? Reiter
**Vorkommen**: Einfachklick öffnet den Editor? Die Ansichtsreiter (Alle/Fauna/Flora/Waren, Spezies
ausgegraut) unverändert? Mit **Tabulator** durch die Liste — bleibt jede Zeile fokussierbar?
Hell und dunkel.

- [ ] **Schritt 9: Committen**

```bash
git status
git add css/features/review-panel.css css/components/region-sync.css js/review/review-settlement-list.js js/review/review-wiki-sync.js js/review/review-region-sync.js js/review/review-path-sync.js js/review/review-powerline-list.js js/review/__tests__/wikisync-list-form.test.js
git commit
```
Betreff: `ui(wikisync): Literatur, Karten und Vorkommen tragen dieselbe Listenzeile wie die uebrigen fuenf`

**Pushen, Owner draufschauen lassen, dann Aufgabe 4.**

---

## Aufgabe 4: Die Bilanzzeile — ein Erzeuger für acht Listen

Heute: fünf Subjekte zeigen einen Satz **über** der Suche, drei einen Zähler **rechts in** der
Suchzeile („1957 / 1957" bzw. „200 von 1382"). Danach: **eine** Zeile unter der Suche, die nur
trägt, was sich beim Filtern bewegt.

💣 **Ein Rechner, nicht acht.** Acht Kopien derselben Formel wären in drei Monaten wieder achtfach
verschieden — genau die Divergenz, die dieser Umbau beseitigt.

**Dateien:**
- Erstellen: `js/review/review-list-balance.js`
- Erstellen: `js/review/__tests__/wikisync-balance-line.test.js`
- Ändern: `index.html` (Skript einhängen nach Zeile 2978; acht `<p class="wiki-sync-balance">`)
- Ändern: die acht Listen-Renderer (Aufrufe)

**Schnittstellen:**
- Liefert: `avesmapsListBalanceText(wort, sichtbar, gesamt, dativ?)` → `string`;
  `avesmapsListBalanceRender(elementId, wort, sichtbar, gesamt, dativ?)` → `void`.
  Der vierte Parameter ist optional und nur für Wörter nötig, deren Dativ Plural die
  Faustregel falsch bildet („Fauna", „Flora"). Aufgabe 5 fasst diese Datei nicht an.

- [ ] **Schritt 1: Den Test schreiben**

Erstelle `js/review/__tests__/wikisync-balance-line.test.js`:

```js
// Die Bilanzzeile hat EINEN Erzeuger.
//
// 🔴 Sie traegt nur, was sich durch die Filterung aendert (Owner 14.08.2026). Die stillen
// Sync-Zahlen bleiben ueber der Suche stehen -- sie bewegen sich nicht und gehoeren deshalb nicht
// hierher.
//
// Run: node js/review/__tests__/wikisync-balance-line.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(root, "js", "review", "review-list-balance.js"), "utf8");
global.window = global;
eval(quelle);

let checks = 0;

// Ungefiltert: nur die Gesamtzahl, mit Tausenderpunkt.
assert.strictEqual(avesmapsListBalanceText("Regionen", 1616, 1616), "1.616 Regionen");
checks++;
assert.strictEqual(avesmapsListBalanceText("Orte", 3434, 3434), "3.434 Orte");
checks++;

// Gefiltert: "X von N <Wort>".
assert.strictEqual(avesmapsListBalanceText("Regionen", 103, 1616), "103 von 1.616 Regionen");
checks++;
assert.strictEqual(avesmapsListBalanceText("Werke", 96, 1957), "96 von 1.957 Werken");
checks++;

// ⚠️ Nie leer. Ohne diese Regel spraenge die Liste beim ersten Tastendruck um eine Zeile.
assert.strictEqual(avesmapsListBalanceText("Orte", 0, 0), "Keine Orte");
checks++;
assert.strictEqual(avesmapsListBalanceText("Orte", 0, 3434), "0 von 3.434 Orten");
checks++;

// 💣 Der Tausenderpunkt gilt ueberall. Heute macht ihn nur Vorkommen -- "Alle (3434)" gegen
// "Alle (5.104)" im selben Panel.
assert.strictEqual(avesmapsListBalanceText("Karten", 523, 5104), "523 von 5.104 Karten");
checks++;
assert.ok(!/\d{4,}/.test(avesmapsListBalanceText("Wege", 4225, 4225)),
	'Vierstellige Zahlen muessen einen Tausenderpunkt tragen -- "4225 Wege" ist falsch, '
	+ '"4.225 Wege" richtig.');
checks++;

// 💣 "Fauna" und "Flora" sind lateinisch und im Dativ unveraendert. Die Faustregel (-n anhaengen)
// machte daraus "Faunan". Die Vorkommen-Ansichten geben den Dativ deshalb ausdruecklich mit.
assert.strictEqual(avesmapsListBalanceText("Fauna", 200, 1382, "Fauna"), "200 von 1.382 Fauna");
checks++;
assert.strictEqual(avesmapsListBalanceText("Wege", 212, 4225), "212 von 4.225 Wegen",
	"Die Faustregel muss fuer die deutschen Woerter weiter greifen.");
checks++;

console.log(`wikisync-balance-line: ${checks} Pruefungen bestanden.`);
```

- [ ] **Schritt 2: Test laufen lassen — muss FEHLSCHLAGEN**

```bash
node js/review/__tests__/wikisync-balance-line.test.js
```
Erwartet: `ENOENT` — `review-list-balance.js` gibt es noch nicht.

- [ ] **Schritt 3: Den Erzeuger schreiben**

Erstelle `js/review/review-list-balance.js`:

```js
/**
 * Die Bilanzzeile der acht WikiSync-Listen -- EIN Erzeuger, nicht acht.
 *
 * 🔴 Sie traegt NUR, was sich durch die Filterung aendert (Owner 14.08.2026:
 * "eine Bilanzzeile unter der Suche, aber nur wenn die Bilanzzeile durch die filterung
 * beeinflusst wird"). Die Zahlen des letzten Syncs bewegen sich nicht und bleiben deshalb als
 * stille Zeile UEBER der Suche stehen.
 *
 * ⚠️ Sie ist nie leer. Ungefiltert nennt sie die Gesamtzahl -- sonst spraenge die Liste beim
 * ersten Tastendruck um eine Zeile.
 *
 * 💣 Acht Kopien dieser Formel waeren in drei Monaten wieder achtfach verschieden. Genau das
 * ist der Zustand, den dieser Umbau beseitigt hat.
 */
"use strict";

/** Deutscher Tausenderpunkt. Heute macht ihn nur Vorkommen -- daher "Alle (3434)" neben "Alle (5.104)". */
function avesmapsListBalanceNumber(n) {
	return Number(n || 0).toLocaleString("de-DE");
}

/**
 * @param {string} wort   Substantiv im Nominativ Plural ("Regionen", "Orte", "Werke").
 * @param {number} sichtbar  Zeilen nach Suche UND Filtertrichter.
 * @param {number} gesamt    Zeilen der aktiven Ansicht ohne Suche und Filter.
 * @param {string} [dativ]   Dativ Plural, falls die Faustregel unten ihn falsch bildet.
 */
function avesmapsListBalanceText(wort, sichtbar, gesamt, dativ) {
	const g = Number(gesamt || 0);
	const s = Number(sichtbar || 0);
	if (g < 1) {
		return "Keine " + wort;
	}
	if (s === g) {
		return avesmapsListBalanceNumber(g) + " " + wort;
	}
	// Faustregel Dativ Plural: die deutschen Woerter hier haengen -n an, ausser sie enden schon so.
	// 💣 Sie gilt NICHT fuer die Vorkommen-Ansichten: "Fauna" und "Flora" sind lateinisch und
	// unveraenderlich -- die Faustregel machte daraus "Faunan". Diese Aufrufer geben den Dativ mit.
	const form = dativ || (/n$/.test(wort) ? wort : wort + "n");
	return avesmapsListBalanceNumber(s) + " von " + avesmapsListBalanceNumber(g) + " " + form;
}

function avesmapsListBalanceRender(elementId, wort, sichtbar, gesamt, dativ) {
	const el = document.getElementById(elementId);
	if (!el) {
		return;
	}
	el.textContent = avesmapsListBalanceText(wort, sichtbar, gesamt, dativ);
}

window.avesmapsListBalanceText = avesmapsListBalanceText;
window.avesmapsListBalanceRender = avesmapsListBalanceRender;
```

- [ ] **Schritt 4: Test laufen lassen**

```bash
node js/review/__tests__/wikisync-balance-line.test.js
```
Erwartet: `wikisync-balance-line: 10 Pruefungen bestanden.`

- [ ] **Schritt 5: Skript einhängen**

In `index.html` direkt nach Zeile 2978 (`<script src="js/review/review-status.js"></script>`):

```html
		<!-- Der EINE Bilanzzeilen-Erzeuger fuer alle acht WikiSync-Listen. Haengt von nichts ab
		     (reine Formatierung) und muss vor seinen Lesern stehen -- review-settlement-list.js,
		     review-region-sync.js, review-path-sync.js, review-powerline-list.js und
		     review-wiki-sync.js rufen ihn beim ersten Rendern. -->
		<script src="js/review/review-list-balance.js"></script>
```

- [ ] **Schritt 6: Die acht Bilanzzeilen ins Markup**

In `index.html` je Subjekt-Abschnitt **unter** die Suchzeile (`.wiki-sync-panel__filter` bzw.
`.wiki-sync-adv-picker__top`) ein Element:

```html
<p class="wiki-sync-balance" id="region-sync-balance"></p>
```
ids: `settlement-list-balance`, `wiki-sync-territory-balance`, `region-sync-balance`,
`path-sync-balance`, `powerline-sync-balance`, `wiki-sync-adv-balance`, `wiki-sync-cm-balance`,
`lore-list-balance`.

Stil in `css/features/review-panel.css`:

```css
/* Die Bilanzzeile -- eine Zeile unter der Suche, bei allen acht Subjekten gleich. */
.wiki-sync-balance {
	margin: 0 10px 6px;
	font-size: var(--font-size-caption);
	color: var(--color-text-muted);
}
```

- [ ] **Schritt 7: Die acht Renderer verdrahten**

Je Liste am Ende ihrer Renderfunktion, mit dem Wort des Subjekts:

| Datei | Aufruf |
|---|---|
| `review-settlement-list.js` (Orte) | `avesmapsListBalanceRender("settlement-list-balance", "Orte", rows.length, all.length);` |
| `review-settlement-list.js:1050` (Literatur) | ersetzt `countEl.textContent = …`: `avesmapsListBalanceRender("wiki-sync-adv-balance", "Werke", rows.length, all.length);` |
| `review-settlement-list.js:1167` (Karten) | ersetzt `countEl.textContent = …`: `avesmapsListBalanceRender("wiki-sync-cm-balance", "Karten", rows.length, all.length);` |
| `review-region-sync.js` | `avesmapsListBalanceRender("region-sync-balance", "Regionen", …);` |
| `review-path-sync.js` | `avesmapsListBalanceRender("path-sync-balance", "Wege", …);` |
| `review-powerline-list.js` | `avesmapsListBalanceRender("powerline-sync-balance", "Kraftlinien", …);` |
| `review-wiki-sync.js` (Territorien) | `avesmapsListBalanceRender("wiki-sync-territory-balance", "Territorien", …);` |
| `review-wiki-sync.js` (Vorkommen) | Wort = die **aktive Ansicht**. 💣 „Fauna" und „Flora" sind im Dativ unveränderlich und geben ihn als vierten Parameter mit: `avesmapsListBalanceRender("lore-list-balance", "Fauna", …, "Fauna")`. „Waren" und „Vorkommen" enden auf -n, für sie greift die Faustregel |

⚠️ Der Aufruf muss **nach jeder Filteränderung** laufen, nicht nur beim ersten Laden — also in
derselben Funktion, die die Zeilen filtert und schreibt. Sonst steht dort eine Zahl, die nicht
zur Liste passt.

Die drei alten Zähler-Spans (`#wiki-sync-adv-count`, `#wiki-sync-cm-count`, `#lore-list-count`)
aus dem Markup entfernen.

- [ ] **Schritt 8: Tests laufen lassen** (ganzes Feld, Befehl oben)

- [ ] **Schritt 9: Ablaufprüfung**

In **jeder** der acht Listen: tippen — **bewegt sich die Bilanzzeile?** Steht das richtige
Substantiv da? Filtertrichter öffnen und eine Bedingung setzen — **bewegt sie sich auch dadurch?**
Suchfeld leeren — steht wieder nur die Gesamtzahl? Bei Vorkommen die Ansicht wechseln (Fauna →
Flora) — ändert sich das Wort mit? Hell und dunkel.

- [ ] **Schritt 10: Committen**

```bash
git status
git add js/review/review-list-balance.js js/review/__tests__/wikisync-balance-line.test.js index.html css/features/review-panel.css js/review/review-settlement-list.js js/review/review-region-sync.js js/review/review-path-sync.js js/review/review-powerline-list.js js/review/review-wiki-sync.js
git commit
```
Betreff: `feat(wikisync): eine Bilanzzeile unter der Suche -- sie zeigt nur, was der Filter bewegt`

**Pushen, Owner draufschauen lassen, dann Aufgabe 5.**

---

## Aufgabe 5: Die stille Zeile, das Datum, der Tausenderpunkt

**Dateien:**
- Ändern: `js/review/review-wiki-sync.js:2733`, `:3650`, `:3658`
- Ändern: `js/review/review-region-sync.js:115`
- Ändern: `js/review/review-path-sync.js:185`
- Ändern: `js/review/review-powerline-list.js:130`
- Ändern: der Territorien-Meta-Erzeuger in `js/review/review-wiki-sync.js`

**Schnittstellen:**
- Verbraucht: nichts aus Aufgabe 4. Nur Wortlaut.

- [ ] **Schritt 1: Die stillen Zeilen umbenennen**

| Datei:Zeile | vorher | nachher |
|---|---|---|
| `review-wiki-sync.js:3650` | `` `${openCount} offen, ${deferredCount} zurückgestellt, ${archivedCount} archiviert` `` | `` `${openCount} Fälle offen · ${deferredCount} zurückgestellt · ${archivedCount} archiviert` `` |
| `review-wiki-sync.js:3658` | `` `${syncedTerritoryCount} Knoten · ${syncedRootCount} Wurzelknoten` `` | `` `${syncedTerritoryCount} Knoten gesynct · ${syncedRootCount} Wurzelknoten` `` |
| `review-region-sync.js:115` | `` `${s.considered || 0} Regionen · …` `` | `` `${s.considered || 0} gesynct · …` `` |
| `review-path-sync.js:185` | `` `${s.considered || 0} Wege · …` `` | `` `${s.considered || 0} gesynct · …` `` |
| `review-powerline-list.js:130` | `groups.length + " Kraftlinien · " + segCount + " Segmente"` | `segCount + " Segmente"` |

An jede Stelle einen Kommentar, der die Zahl erklärt, z.B. bei `review-region-sync.js:115`:

```js
			// "gesynct", nicht "Regionen": s.considered zaehlt, was der letzte Sync betrachtet hat
			// (1851), nicht die Zeilen der Liste (1616). Beide Zahlen stehen jetzt untereinander --
			// beide "Regionen" zu nennen las sich wie ein Widerspruch. Owner 14.08.2026.
```

Und bei `review-powerline-list.js:130`:

```js
		// 💣 Die Zahl der Kraftlinien stand hier UND steht seit 14.08.2026 in der Bilanzzeile --
		// beides ist groups.length. Zweimal wortgleich untereinander. Hier bleiben die Segmente,
		// die die Bilanzzeile NICHT kennt. Keine Information verloren, nur die Dopplung.
```

- [ ] **Schritt 2: Vorkommen benutzt denselben Datums-Formatierer**

In `js/review/review-wiki-sync.js:2733` ersetzen:

```js
		syncedEl.textContent = "Zuletzt gesynct: "
			+ (isNaN(parsed.getTime()) ? stamp : parsed.toLocaleString("de-DE"));
```
durch:
```js
		// 💣 Stand hier als rohes toLocaleString und ergab "26.7.2026, 11:01:16" -- als einziges
		// der acht Subjekte, alle anderen zeigen "26.07.2026, 11:01". Derselbe Formatierer wie
		// bei jenen (formatWikiSyncKindSyncedText, dateStyle:medium + timeStyle:short).
		syncedEl.textContent = isNaN(parsed.getTime())
			? "Zuletzt gesynct: " + stamp
			: formatWikiSyncKindSyncedText({ completed_at: stamp });
```

- [ ] **Schritt 3: Tausenderpunkt in den Ansichtsreitern**

⚠️ Es gibt **keinen** gemeinsamen Reiter-Erzeuger: `#wiki-sync-view-tabs` wird bei jedem
Subjektwechsel geleert (`js/review/review-wiki-sync.js:374`) und **von der Renderfunktion des
jeweiligen Subjekts** neu gefüllt. Die Stellen deshalb suchen, nicht raten:

```bash
grep -rn 'Alle\|Platziert\|Fehlt\|Konflikte\|Ausreißer' js/review/*.js | grep -n '(' | grep -v '^\s*//'
```

An jeder Fundstelle die Zahl durch `Number(n).toLocaleString("de-DE")` schicken. Bekannte
Kandidaten: `renderWikiSyncLoreViewTabs` (`review-wiki-sync.js:2761`, macht es bereits richtig —
**als Vorbild lesen, nicht ändern**), dazu die Reiter-Erzeuger für Orte, Territorien, Regionen
und Wege in `review-settlement-list.js`, `review-wiki-sync.js`, `review-region-sync.js` und
`review-path-sync.js`.

- [ ] **Schritt 4: Territorien-Meta trennt mit `·`**

💣 **Es sind ZWEI Kommas, nicht eines** (beim Bau von Aufgabe 1 im Renderer nachgelesen). Wer nur
das erste ändert, lässt genau das sichtbare stehen — im Bildschirmfoto des Owners steht
„1009 BF – heute**,** Wiki ↗", und das ist das zweite.

`js/territory/territory-wiki-tree.js:77` — zwischen BF-Zeitraum und „ID n":
```js
			text: metaParts.join(" · "),   // war ", "
```

`js/territory/territory-wiki-tree.js:808` — zwischen Meta-Text und dem Wiki-Link, **das sichtbare**:
```js
					separator.textContent = " · ";   // war ", "
```

💣 **Vorher prüfen, wer diesen Erzeuger sonst noch liest.** `territory-wiki-tree.js` ist ein
geteiltes Modul; `renderWikiSyncTerritoryTree` (`review-wiki-sync.js:555`) holt es sich über
`treeModule`. Ob auch eine Editor-Oberfläche daran hängt, entscheidet dieser Befehl:

```bash
grep -rn 'territory-wiki-tree\.js' index.html html/*.html
grep -rn 'buildTreeItemMetaInfo' js/
```

Hängt eine zweite Oberfläche daran, **nicht** hier ändern, sondern den Trenner im Aufrufer des
Panels setzen — sonst ändert sich der Territorien-Editor mit, und das ist eine sichtbare
Änderung, die niemand bestellt hat.

- [ ] **Schritt 5: Tests laufen lassen** (ganzes Feld)

- [ ] **Schritt 6: Ablaufprüfung**

Alle acht Reiter durchklicken: steht über jeder Suche die stille Zeile mit dem **benannten**
Wortlaut? Bei **Kraftlinien**: steht dort nur noch „162 Segmente", und die Zahl der Linien in der
Bilanzzeile? Bei **Vorkommen**: liest sich das Datum wie bei den anderen sieben? Tragen alle
Ansichtsreiter den Tausenderpunkt?

- [ ] **Schritt 7: Committen**

```bash
git status
git add js/review/review-wiki-sync.js js/review/review-region-sync.js js/review/review-path-sync.js js/review/review-powerline-list.js
git commit
```
Betreff: `ui(wikisync): die stille Zeile benennt ihre Zahlen, Vorkommen bekommt das gleiche Datumsformat`

**Pushen, Owner draufschauen lassen, dann Aufgabe 6.**

---

## Aufgabe 6: Editoren — die zwei `.se-row`-Abschriften fallen weg

`.se-row` ist eine Abschrift von `.avm-row` (`css/components/editor-page.css:450`) und steht
**inline in zwei HTML-Dateien**. Der Kraftlinien-Editor trägt den Beweis im eigenen Kommentar:
`/* Listenzeilen (Referenz .se-row) */`.

💣 **Beide Abschriften setzen `font-size: 10px`** auf `.se-row-type` und `.se-row-l2` — unter der
11px-Untergrenze. Das Original `.avm-row__kind` / `.avm-row__l2` benutzt `--font-size-caption`.
Der Fehler entstand beim Abschreiben und wurde einmal weiterkopiert.

🔴 **Alle sechs Editoren laden `editor-page.css` bereits** (geprüft). Kein neues Stylesheet nötig.

**Dateien:**
- Erstellen: `js/pages/__tests__/editor-row-single-source.test.js`
- Ändern: `html/wiki-sync-settlement-editor.html:149-161` (Block löschen)
- Ändern: `html/wiki-sync-powerline-editor.html:70-82` (Block löschen)
- Ändern: die Renderer, die `se-row`-Klassen schreiben

- [ ] **Schritt 1: Den Wachtest schreiben**

Erstelle `js/pages/__tests__/editor-row-single-source.test.js`:

```js
// Die Editor-Listenzeile steht genau EINMAL -- als .avm-row in css/components/editor-page.css.
//
// 🔴 DIESER TEST EXISTIERT WEGEN VIER ABSCHRIFTEN. .se-row stand wortgleich inline im
// Ortseditor UND im Kraftlinien-Editor (dort mit dem Kommentar "Referenz .se-row" -- abgeschrieben,
// nicht geteilt), .ae-item im Literatur-Editor und .ce-item als sein wortgleicher Zwilling im
// Karteneditor. Alle vier sind Abschriften von .avm-row.
//
// 💣 Beim Abschreiben ging die Skala verloren: .se-row-type und .se-row-l2 setzten font-size:10px,
// waehrend das Original --font-size-caption (11px) benutzt. 11px ist die Untergrenze in
// docs/design-language.md. Der Fehler wurde einmal weiterkopiert.
//
// Run: node js/pages/__tests__/editor-row-single-source.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const editorSeiten = [
	"wiki-sync-settlement-editor.html",
	"wiki-sync-powerline-editor.html",
	"game-literature-editor.html",
	"citymap-editor.html",
	"wege-editor.html",
	"landschaften-editor.html",
];

let checks = 0;

for (const datei of editorSeiten) {
	const html = fs.readFileSync(path.join(root, "html", datei), "utf8");

	assert.ok(/editor-page\.css/.test(html),
		`${datei} laedt css/components/editor-page.css nicht -- ohne sie gibt es kein .avm-row.`);
	checks++;

	for (const klasse of ["se-row", "ae-item", "ce-item"]) {
		assert.ok(!new RegExp("\\." + klasse + "\\s*\\{").test(html),
			`${datei} definiert wieder eine eigene ".${klasse}"-Regel inline. `
			+ "Die Editor-Listenzeile heisst .avm-row und steht in css/components/editor-page.css. "
			+ "Eine Abschrift sieht am Tag ihrer Entstehung identisch aus und driftet danach.");
		checks++;
	}

	assert.ok(!/font-size:\s*10px/.test(html),
		`${datei} setzt font-size:10px. Die Untergrenze ist 11px = var(--font-size-caption) `
		+ "(docs/design-language.md). Genau dieser Wert ging beim Abschreiben von .avm-row verloren.");
	checks++;
}

// Das Original traegt die Skala.
const editorPage = fs.readFileSync(path.join(root, "css", "components", "editor-page.css"), "utf8");
assert.ok(/\.avm-row__l2\s*\{[\s\S]*?font-size:\s*var\(--font-size-caption\)/.test(editorPage),
	".avm-row__l2 muss auf var(--font-size-caption) stehen.");
checks++;

console.log(`editor-row-single-source: ${checks} Pruefungen bestanden (${editorSeiten.length} Editoren).`);
```

- [ ] **Schritt 2: Test laufen lassen — muss FEHLSCHLAGEN**

```bash
node js/pages/__tests__/editor-row-single-source.test.js
```
Erwartet: rot — `.se-row {` steht in beiden Dateien, `font-size:10px` ebenfalls.

- [ ] **Schritt 3: Ortseditor umstellen**

In `html/wiki-sync-settlement-editor.html` die Zeilen 149–161 löschen und ersetzen durch:

```css
  /* Die Listenzeile ist .avm-row aus css/components/editor-page.css (diese Seite laedt sie
     bereits). Hier stand bis 14.08.2026 eine wortgleiche Abschrift namens .se-row -- samt
     font-size:10px, das beim Abschreiben unter die 11px-Untergrenze gerutscht war.
     Gewacht von js/pages/__tests__/editor-row-single-source.test.js. */
  .se-row-coat { flex:0 0 auto; width:22px; height:22px; border-radius:var(--radius-sm); object-fit:contain; background:var(--panel); border:1px solid var(--line2); }
  .se-row-coat--empty { background:transparent; border-style:dashed; border-color:var(--line); opacity:.5; }
  .se-row-terr { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .se-row-imgcount { flex:0 0 auto; margin-left:auto; color:var(--mut); white-space:nowrap; }
```

⚠️ Das Wappenbild (`.se-row-coat`), die Territoriums-Zeile und der Bilderzähler **bleiben** — sie
sind ortseditor-eigen und haben in `.avm-row` nichts zu suchen.

🔴 **Der Renderer steht in DERSELBEN Datei.** Diese Editoren sind eigenständige Seiten mit
Inline-`<script>`; es gibt keine `js/pages/…`-Datei dafür. `se-row` kommt in
`html/wiki-sync-settlement-editor.html` **28×** vor (CSS *und* JS), in
`html/wiki-sync-powerline-editor.html` **18×**. Die Umbenennung passiert also im selben Commit
und in derselben Datei wie die CSS-Löschung.

Umbenennen: `se-row` → `avm-row`, `se-row-text` → `avm-row__text`, `se-row-l1` → `avm-row__l1`,
`se-row-name` → `avm-row__name`, `se-row-type` → `avm-row__kind`, `se-row-l2` → `avm-row__l2`.
`se-row-coat`, `se-row-coat--empty`, `se-row-terr`, `se-row-imgcount` **bleiben**.

⚠️ `se-row-name` und `se-row-type` sind Präfixe von `se-row`. Ein blindes Suchen-und-Ersetzen von
`se-row` → `avm-row` erzeugt `avm-row-name` statt `avm-row__name`. **Von der längsten Klasse zur
kürzesten ersetzen**, `se-row` zuletzt.

Zählprobe nach der Umbenennung:
```bash
grep -c 'se-row' html/wiki-sync-settlement-editor.html   # erwartet: nur noch coat/terr/imgcount
grep -c 'se-row' html/wiki-sync-powerline-editor.html    # erwartet: 0
```

- [ ] **Schritt 4: Kraftlinien-Editor umstellen**

In `html/wiki-sync-powerline-editor.html` die Zeilen 70–82 ersatzlos löschen — er hat keine
eigenen Zusatzklassen — und im Inline-`<script>` derselben Datei dieselbe Umbenennung vornehmen,
wieder von der längsten Klasse zur kürzesten.

- [ ] **Schritt 5: Test laufen lassen**

```bash
node js/pages/__tests__/editor-row-single-source.test.js
```
Erwartet: rot bei `game-literature-editor.html` / `citymap-editor.html` — die sind Aufgabe 7.
Bis dahin die beiden Dateien im Test-Array auskommentieren **und den Kommentar mit
„kommt in Aufgabe 7" versehen**, damit kein stiller Deckel entsteht.

Dann das ganze Feld.

- [ ] **Schritt 6: Ablaufprüfung**

**Ortseditor** öffnen: Liste unverändert lesbar? Wappenbild noch da? Eine Zeile anklicken —
öffnet der Detailbereich rechts den richtigen Ort, und ist die Zeile als **ausgewählt** markiert?
Die zweite Zeile (Territorium, Bilderzahl) noch da und jetzt 11px statt 10px?
**Kraftlinien-Editor**: dasselbe, Auswahl färbt die Zeile? Hell und dunkel.

- [ ] **Schritt 7: Committen**

```bash
git status
git add js/pages/__tests__/editor-row-single-source.test.js html/wiki-sync-settlement-editor.html html/wiki-sync-powerline-editor.html
git commit
```
Betreff: `ui(editoren): Orts- und Kraftlinien-Liste teilen sich .avm-row statt zweier Abschriften`

**Pushen, Owner draufschauen lassen, dann Aufgabe 7.**

---

## Aufgabe 7: Editoren — `.ae-item` und `.ce-item` fallen weg

Die Editor-Fassung von Bauart B: Kasten um die Liste, `border-bottom` je Zeile,
`padding: var(--space-6) var(--space-8)` (8/10px statt 4/6px). `.ce-item` ist ein wortgleicher
Zwilling von `.ae-item` — nur die Vorschaubildmaße unterscheiden sich (34×34 gegen 30×42).

⚠️ **Dieselben zwei Subjekte wie im Panel** — Literatur und Karten scheren in beiden Oberflächen
aus, mit derselben Abweichung.

**Dateien:**
- Ändern: `html/game-literature-editor.html:220-233`
- Ändern: `html/citymap-editor.html:237-249`
- Ändern: `js/pages/__tests__/editor-row-single-source.test.js` (die zwei Dateien wieder eintragen)

- [ ] **Schritt 1: Die beiden Dateien im Test wieder aktivieren**

Die in Aufgabe 6 auskommentierten Einträge `game-literature-editor.html` und
`citymap-editor.html` im Array `editorSeiten` wiederherstellen und den Übergangskommentar
entfernen.

- [ ] **Schritt 2: Test laufen lassen — muss FEHLSCHLAGEN**

```bash
node js/pages/__tests__/editor-row-single-source.test.js
```
Erwartet: rot — `.ae-item {` und `.ce-item {` stehen noch.

- [ ] **Schritt 3: Literatur-Editor umstellen**

In `html/game-literature-editor.html` die Zeilen 220–233 löschen und ersetzen durch:

```css
  /* Die Listenzeile ist .avm-row aus css/components/editor-page.css. Hier stand bis 14.08.2026
     .ae-item -- eine eigene Rezeptur mit Kasten und border-bottom, wortgleich noch einmal als
     .ce-item im Karteneditor. Es bleibt nur das Cover, das .avm-row nicht kennt. */
  .ae-item__thumb { flex: 0 0 auto; width: 30px; height: 42px; border-radius: var(--radius-sm); object-fit: cover; background: var(--color-panel-muted); border: 1px solid var(--color-border); }
```

Bei `.ae-list__scroll` `border`, `border-radius` und `background` entfernen — gruppiert wird per
Trennlinie, nicht per Rahmen (AGENTS.md §12). `flex`, `overflow`, `min-height` bleiben.

🔴 **Auch hier steht der Renderer inline in derselben Datei** (`ae-item` kommt 17× vor,
`ce-item` 16×). Umbenennen: `ae-item__text` → `avm-row__text`, `ae-item__l1` → `avm-row__l1`,
`ae-item__title` → `avm-row__name`, `ae-item__l2` → `avm-row__l2`, zuletzt `ae-item` → `avm-row`.
`ae-item__thumb` bleibt.

⚠️ Wieder von der längsten Klasse zur kürzesten — `ae-item` ist Präfix aller anderen.

- [ ] **Schritt 4: Karteneditor umstellen**

Dasselbe in `html/citymap-editor.html:237-249`. Es bleibt:

```css
  /* Siehe game-literature-editor.html: .ce-item war der wortgleiche Zwilling von .ae-item.
     Beide sind jetzt .avm-row. Nur das Vorschaubild bleibt -- es ist quadratisch, nicht hochkant. */
  .ce-item__thumb { flex: 0 0 auto; width: 34px; height: 34px; border-radius: var(--radius-sm); object-fit: cover; background: var(--color-panel-muted); border: 1px solid var(--color-border); }
```

Bei `.ce-list__scroll` denselben Kasten entfernen. Im Inline-`<script>` derselben Datei, wieder
längste Klasse zuerst: `ce-item__text` → `avm-row__text`, `ce-item__title` → `avm-row__name`,
`ce-item__l2` → `avm-row__l2`, zuletzt `ce-item` → `avm-row`. `ce-item__thumb` bleibt.

⚠️ `.ce-row` / `.ce-row--wrap` sind **etwas anderes** — Formularzeilen im Detailbereich, kein
Listeneintrag. Sie bleiben unangetastet.

- [ ] **Schritt 5: Tests laufen lassen**

```bash
node js/pages/__tests__/editor-row-single-source.test.js
```
Erwartet: `editor-row-single-source: 31 Pruefungen bestanden (6 Editoren).`
Dann das ganze Feld.

- [ ] **Schritt 6: Ablaufprüfung**

**Literatur-Editor** öffnen: Kasten weg, Trennlinien da? Cover noch in der richtigen Größe
(hochkant)? Eine Zeile anklicken — springt der Detailbereich, ist die Zeile als ausgewählt
markiert? Die Suche filtert weiter? **Karteneditor**: dasselbe, Vorschaubild quadratisch?
Danach **alle sechs Editoren nebeneinander ansehen** — sieht die Listenspalte überall gleich aus?
Hell und dunkel.

- [ ] **Schritt 7: Committen**

```bash
git status
git add html/game-literature-editor.html html/citymap-editor.html js/pages/__tests__/editor-row-single-source.test.js
git commit
```
Betreff: `ui(editoren): Literatur- und Kartenliste tragen .avm-row -- damit steht die Editorzeile einmal`

**Pushen, Owner draufschauen lassen. Danach ist der Umbau fertig.**

---

## Nach der letzten Aufgabe

- [ ] `docs/superpowers/specs/2026-08-14-wikisync-listen-vereinheitlichung-design.md` um eine
  Zeile „**Live seit 14.08.2026**" ergänzen.
- [ ] Prüfen, ob `AGENTS.md §11` (Dokumentationsindex) einen Eintrag braucht — der Umbau berührt
  zwei Oberflächen und hinterlässt zwei Wachtests, die ein späterer Bearbeiter kennen muss.
- [ ] 🔧 **Nicht selbst tun:** `html/editor-handbuch.html` wird von der nächtlichen Routine
  `avesmaps-handbuch-pflege` gepflegt (AGENTS.md §9). Die Commit-Betreffs oben nennen die
  sichtbare Wirkung — das ist die einzige Bringschuld.
