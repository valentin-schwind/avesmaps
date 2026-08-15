# Wiki-Zuweisung vereinheitlichen — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE UNTER-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Zehn Oberflächen benutzen dasselbe Zuweisungs-Bauteil, und eine neue Objektart kostet eine
**Erklärung** statt Code.

**Architektur:** Ein **Feldregister** (reine Daten, eine Zeile je Feld) plus ein **Bauteil**, das
daraus alles ableitet: die drei Zustände, die Trefferliste, die Sync-Vorschau mit Häkchen, die
Knopfauswahl. Zwei Hüllen — `.dt-*` in den Editorfenstern, `.label-wiki-*` in den Kartendialogen —,
eine Logik. Eine Prüfung wird rot, wenn Erklärung und Wirklichkeit auseinandergehen.

**Werkzeuge:** Vanilla-JS, kein Build-Schritt, PHP 8 (strict types), `assert()`-Tests ohne Framework.

**Entwurf:** `docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md` — **vor
Aufgabe 1 lesen.** Jede Zeile darin mit 💣 / ⚠️ / 🔴 ist Teil der Abnahme.
**Mockup:** `docs/wiki-zuweisung-mockup.html` — die Zielform, mit den echten Klassen.

## Globale Vorgaben

- 🔴 **Diese Arbeit läuft auf einem EIGENEN ZWEIG**, nicht auf `master`. Der Owner will alles in
  einem Zug live; auf `master` ist das nicht haltbar, weil jede Parallelsitzung mit ihrem Push
  fremde Commits mitnimmt (am 15.08.2026 zweimal passiert — einmal gingen ungeprüfte Commits mit
  einem Datenverlust live). Zweig anlegen, darauf committen, am Ende **einmal** zusammenführen.
- **Sprache:** Kommentare, Commit-Nachrichten und Beschriftungen auf **Deutsch** (AGENTS.md §8).
- **Zeilenenden je Datei prüfen, nicht annehmen** — im Projekt liegen LF und CRLF gemischt.
- 🔴 **Niemals `git add -A`, `git add .` oder `git commit -a`.** Der Arbeitsbaum wird von mehreren
  Sitzungen geteilt; es liegen fremde unfertige Änderungen darin. `git status`, dann **nur** die
  eigenen Pfade per Namen stagen.
- **Keine Farbe, kein Radius, kein Abstand hartkodiert** — nur Token aus `css/base/tokens.css`
  (AGENTS.md §12).
- **Kein `?v=` von Hand** (AGENTS.md §7). ⚠️ **Ausnahme, die hier greift:** `edit/index.php` linkt
  `css/pages/edit.css` mit einem handgeschriebenen `?v=`; ändert sich diese Datei, wird es von Hand
  hochgezählt.
- **Vor dem Zusammenführen läuft das GANZE Testfeld:**
  ```bash
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  ```
  ```bash
  for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
  ```
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  ```
  ⚠️ Vorbestehend rot ist genau **einer**: `api/_internal/linkcheck/__tests__/link-url-test.php`
  (echter DNS-Abruf). Alles andere ist eine Regression.

---

## Dateiübersicht

| Datei | Rolle | Aufgabe |
|---|---|---|
| `js/ui/wiki-assign-registry.js` | **neu** — das Feldregister, reine Daten | 1 |
| `js/ui/__tests__/wiki-assign-registry.test.js` | **neu** — die Prüfung, die schreit | 1 |
| `js/ui/wiki-assign-diff.js` | **neu** — die reine Diff-Rechnung der Sync-Vorschau | 2 |
| `js/ui/__tests__/wiki-assign-diff.test.js` | **neu** | 2 |
| `js/ui/wiki-assign.js` | **neu** — das Bauteil (beide Hüllen) | 3 |
| `css/components/editor-page.css` | die Trefferlisten-Regeln für die `.dt-*`-Hülle | 3 |
| `html/wiki-sync-powerline-editor.html` | erster Nutzer der `.dt-*`-Hülle | 3 |
| `index.html` + `js/review/review-path-wiki.js` | erster Nutzer der `.label-wiki-*`-Hülle | 4 |
| `js/review/review-settlement-wiki.js`, `index.html` | Ort, beide Oberflächen | 5 |
| `js/review/review-label-wiki.js`, `js/map-features/map-features-ecosystem-properties.js`, `html/landschaften-editor.html` | Landschaft, beide Oberflächen | 6 |
| Territorien-Editor (Pfad in Aufgabe 7 Schritt 1 ermitteln) | Territorium + Eltern-Sperre | 7 |
| `html/game-literature-editor.html` | Literatur | 8 |
| `html/citymap-editor.html`, `api/_internal/conflicts/rules.php` | Karte + Kollisionsprüfung | 9 |
| die sechs alten Fassungen | Rückbau | 10 |

---

## Aufgabe 0: Den Zweig anlegen

- [ ] **Schritt 1: Stand prüfen und Zweig setzen**

```bash
git status --porcelain
```
```bash
git fetch origin --quiet && git checkout -b wiki-zuweisung origin/master && git log --oneline -1
```

Erwartet: ein Zweig `wiki-zuweisung` auf dem Stand von `origin/master`.
⚠️ Fremde unfertige Änderungen im Arbeitsbaum bleiben liegen — sie gehören anderen Sitzungen und
wandern beim Zweigwechsel mit. Das ist in Ordnung; sie werden nur nie gestaged.

---

## Aufgabe 1: Das Feldregister und die Prüfung, die schreit

**Dateien:**
- Erstellen: `js/ui/wiki-assign-registry.js`
- Test (neu): `js/ui/__tests__/wiki-assign-registry.test.js`

**Schnittstellen:**
- Liefert an alle folgenden Aufgaben: `AVESMAPS_WIKI_ASSIGN_REGISTRY` — ein Objekt
  `{ [subject]: { label, suche, treffer, felder, sync, extra } }` und die reinen Funktionen
  `avesmapsWikiAssignSubject(subject)` sowie
  `avesmapsWikiAssignRegistryProbleme(registry, wirklichkeit)`.

- [ ] **Schritt 1: Die Endpunkte und Feldnamen messen, nicht annehmen**

```bash
grep -rn "_API_URL = \|WIKI_API_URL = " js/review/review-settlement-wiki.js js/review/review-path-wiki.js js/review/review-label-wiki.js js/map-features/map-features-ecosystem-properties.js
grep -rn '\["Art", wiki.art\]\|\["Einwohner"\|\["Lage"\|\["Herrscher"\|\["Länge"' js/review/review-settlement-wiki.js js/review/review-path-wiki.js
grep -rn "action=search" api/edit/wiki/settlements.php api/edit/wiki/paths.php api/edit/wiki/regions.php | head
```

Erwartet: drei Endpunkte (`/api/edit/wiki/settlements.php`, `…/paths.php`, `…/regions.php`), und
die Feldpaare, die die heutigen Kästen zeigen. **Was hier steht, gilt** — nicht das, was unten im
Gerüst notiert ist.

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Neu: `js/ui/__tests__/wiki-assign-registry.test.js`

```javascript
// Die Pruefung, die schreit. Sie ist der Grund, warum es KEINE automatische Felder-Erkennung gibt:
// die Zuordnung Wiki-Feld -> Kartenfeld ist nicht ableitbar (Entwurf §3a), also wird sie erklaert --
// und diese Datei sorgt dafuer, dass eine vergessene Erklaerung LAUT ist statt still.
const assert = require("assert");
const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignRegistryProbleme } = require("../wiki-assign-registry.js");

// 1) Das echte Register ist in sich stimmig.
assert.deepStrictEqual(
	avesmapsWikiAssignRegistryProbleme(AVESMAPS_WIKI_ASSIGN_REGISTRY, null),
	[],
	"das ausgelieferte Register meldet Probleme"
);

// 2) Ein erklaertes KARTENFELD, das es bei dieser Objektart nicht gibt.
const erfundenesZiel = {
	ort: { label: "Ort", suche: "/x", treffer: ["art"], sync: true,
		felder: [{ wiki: "name", karte: "gibtesnicht" }] },
};
const p2 = avesmapsWikiAssignRegistryProbleme(erfundenesZiel, { ort: { karte: ["name"], wiki: ["name"] } });
assert.strictEqual(p2.length, 1);
assert.ok(p2[0].includes("gibtesnicht"), p2[0]);

// 3) DAS IST DIE ZEILE, DIE 'VERGESSEN' SICHTBAR MACHT: der Parser liefert ein Wiki-Feld,
//    das KEINE Erklaerung fuer sich beansprucht.
const vergessen = {
	ort: { label: "Ort", suche: "/x", treffer: [], sync: true,
		felder: [{ wiki: "name", karte: "name" }] },
};
const p3 = avesmapsWikiAssignRegistryProbleme(vergessen, { ort: { karte: ["name", "einwohner"], wiki: ["name", "einwohner"] } });
assert.strictEqual(p3.length, 1);
assert.ok(p3[0].includes("einwohner"), p3[0]);

// 4) Eine Objektart ohne Erklaerung.
const p4 = avesmapsWikiAssignRegistryProbleme({}, { ort: { karte: ["name"], wiki: ["name"] } });
assert.strictEqual(p4.length, 1);
assert.ok(p4[0].includes("ort"), p4[0]);

// 5) Jede Erklaerung des echten Registers traegt, was das Bauteil braucht.
Object.entries(AVESMAPS_WIKI_ASSIGN_REGISTRY).forEach(([subject, e]) => {
	assert.ok(typeof e.label === "string" && e.label !== "", subject + ": label fehlt");
	assert.ok(Array.isArray(e.felder), subject + ": felder ist keine Liste");
	assert.ok(typeof e.sync === "boolean", subject + ": sync ist kein Wahrheitswert");
	// 💣 Der Sync-Knopf haengt an den FELDERN, nicht am Abgleich: wer keine bearbeitbaren Felder
	// hat, darf keinen Knopf anbieten -- sonst stuende dort einer, der nichts holen kann.
	const hatZiele = e.felder.some((f) => String(f.karte || "") !== "");
	assert.strictEqual(e.sync, hatZiele, subject + ": sync und Feldziele widersprechen sich");
});

console.log("wiki-assign-registry: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 3: Test laufen lassen und scheitern sehen**

```bash
node js/ui/__tests__/wiki-assign-registry.test.js
```

Erwartet: `Cannot find module '../wiki-assign-registry.js'`.

- [ ] **Schritt 4: Das Register schreiben**

Neu: `js/ui/wiki-assign-registry.js`. **Die Werte aus Schritt 1 einsetzen**, nicht die hier
notierten — das Gerüst zeigt die Form, nicht die Wahrheit:

```javascript
// Das Feldregister. REINE DATEN -- eine Zeile je Feld, mehr braucht eine neue Objektart nicht.
//
// 💣 Es gibt KEINE automatische Erkennung, und das ist eine Entscheidung, keine Faulheit
// (Entwurf §3a): dasselbe Wiki-Feld "Art" zeigt je Objektart auf ein anderes Kartenfeld, die
// Landschaft braucht zusaetzlich eine eigene Regel fuer mehrwertige Arten ("Tal|Grube" -> erste
// Komponente), und die Kraftlinien fuehren vier Wiki-Felder, die auf gar kein bearbeitbares Feld
// zeigen. Raten schriebe echte Daten -- die Fehlerklasse aus Discord #38.
//
// 🔴 Was hier NICHT hingehoert: Freitext-Adressen. Eine Nicht-Wiki-Quelle gehoert in den
// Quellen-Abschnitt ("Andere Quelle"). Ein Feld, in das man alles tippen kann, ist der Grund,
// warum bei den Kraftlinien ein Tippfehler unsichtbar blieb (15.08.2026).
const AVESMAPS_WIKI_ASSIGN_REGISTRY = {
	kraftlinie: {
		label: "Wiki-Artikel",
		// Kein Server noetig: die ~23 gestagten Artikel reisen mit dem Leseweg des Editors mit.
		suche: { art: "liste", quelle: "wiki_articles" },
		treffer: ["staerke", "regionen"],
		felder: [],                       // nichts Bearbeitbares -- Anzeige, kein Ziel
		sync: false,                      // also auch kein Knopf
		extra: { keinArtikelHaken: true },
	},
	// Die uebrigen neun kommen in den Aufgaben 4-9 dazu, jede mit IHRER Aufgabe -- nicht auf Vorrat:
	//   weg          (A4)  Name · Art · Laenge          suche: /api/edit/wiki/paths.php
	//   ort          (A5)  Name · Art · Einwohner · Lage · Herrscher   suche: /api/edit/wiki/settlements.php
	//   landschaft   (A6)  Name · Art (mehrwertig -> erste Komponente) suche: /api/edit/wiki/regions.php
	//   territorium  (A7)  Felder aus A7 Schritt 1 · Eltern GESPERRT bei parent_locked
	//   literatur    (A8)  Felder aus A8 Schritt 1
	//   karte        (A9)  eigener Artikel -- NICHT wiki_key, NICHT wiki_url
	// Die genauen Kartenfeld-Namen stehen in Schritt 1 der jeweiligen Aufgabe. Hier nichts raten.
};

/**
 * REIN: Was stimmt zwischen Register und Wirklichkeit nicht? Leere Liste = alles gut.
 *
 * $wirklichkeit ist `{ [subject]: { karte: string[], wiki: string[] } }` -- welche Felder es bei
 * dieser Objektart wirklich gibt. `null` heisst "nicht pruefbar" und ueberspringt 1 und 2.
 */
function avesmapsWikiAssignRegistryProbleme(registry, wirklichkeit) { /* … */ }
```

- [ ] **Schritt 5: Test laufen lassen und bestehen sehen**

```bash
node js/ui/__tests__/wiki-assign-registry.test.js
```

- [ ] **Schritt 6: Beweisen, dass die Prüfung beisst**

Nimm im echten Register **eine** Feldzeile heraus, lass den Test laufen, sieh den Fehlschlag samt
Feldname, setz sie zurück. Echte Ausgabe in den Bericht. ⚠️ Bleibt der Lauf grün, prüft Fall 3
nicht das, was er behauptet — dann ist die Wirklichkeitsquelle falsch angeschlossen.

- [ ] **Schritt 7: Committen**

```bash
git status --porcelain
```
```bash
git add js/ui/wiki-assign-registry.js js/ui/__tests__/wiki-assign-registry.test.js
git commit -m "feat(wiki-zuweisung): das Feldregister -- eine Zeile je Feld, und eine Pruefung die schreit"
```

---

## Aufgabe 2: Die Diff-Rechnung der Sync-Vorschau

**Dateien:** erstellen `js/ui/wiki-assign-diff.js` · Test `js/ui/__tests__/wiki-assign-diff.test.js`

**Schnittstellen:**
- Verwendet aus Aufgabe 1: die Feldliste einer Erklärung (`felder`).
- Liefert an Aufgabe 3: `avesmapsWikiAssignDiff(felder, kartenwerte, wikiwerte, handgesetzt)` ⇒
  `list<{ karte, label, alt, neu, gehakt, grund }>` — **nur Unterschiede**.

- [ ] **Schritt 1: Den scheiternden Test schreiben**

```javascript
const assert = require("assert");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");

const felder = [
	{ wiki: "name", karte: "name", label: "Name" },
	{ wiki: "art", karte: "settlement_type", label: "Art" },
	{ wiki: "einwohner", karte: "einwohner", label: "Einwohner" },
	{ wiki: "oberhaupt", karte: "oberhaupt", label: "Herrscher" },
];

// 💣 Was ohnehin gleich ist, steht NICHT in der Liste -- in einem Kasten voller Haekchen sucht man
// sonst die eine Zeile, die zaehlt.
const gleich = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "metropole", einwohner: "12.000", oberhaupt: "" },
	{ name: "Havena", art: "metropole", einwohner: "12.000", oberhaupt: "" }, []);
assert.deepStrictEqual(gleich, []);

const d = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "grossstadt", einwohner: "14.200", oberhaupt: "Growin" },
	{ name: "Havena (Stadt)", art: "metropole", einwohner: "12.000", oberhaupt: "" },
	["einwohner"]);
const nach = Object.fromEntries(d.map((z) => [z.karte, z]));

// Eine gewoehnliche Aenderung ist vorangehakt.
assert.strictEqual(nach.name.gehakt, true);
assert.strictEqual(nach.settlement_type.gehakt, true);

// 🔴 Von Hand gesetzt: gelistet, MARKIERT, aber NICHT gehakt.
assert.strictEqual(nach.einwohner.gehakt, false);
assert.ok(String(nach.einwohner.grund).includes("Hand"), nach.einwohner.grund);

// 🔴 Das Wiki sagt nichts, die Karte schon: das ist der Fall "Geloescht" der grossen
// Uebernahme-Vorschau -- gelistet, aber NIE vorangehakt.
assert.strictEqual(nach.oberhaupt.gehakt, false);
assert.strictEqual(nach.oberhaupt.neu, "");

// In dieser Fixture unterscheiden sich ALLE vier Felder -- also genau vier Zeilen, keine fuenfte.
assert.strictEqual(d.length, 4);
assert.deepStrictEqual(d.map((z) => z.karte), ["name", "settlement_type", "einwohner", "oberhaupt"]);
console.log("wiki-assign-diff: alle Zusicherungen erfuellt");
```

⚠️ Die Reihenfolge der Zeilen ist **die der Erklärung**, nicht die des Wiki-Ergebnisses — sonst
springen die Häkchen zwischen zwei Läufen. Die letzte Zusicherung nagelt das fest.

- [ ] **Schritt 2: Scheitern sehen** — `node js/ui/__tests__/wiki-assign-diff.test.js`
- [ ] **Schritt 3: Die Funktion schreiben** (rein, kein DOM, kein `fetch`)
- [ ] **Schritt 4: Bestehen sehen**
- [ ] **Schritt 5: Mutationen nachfahren** — Vorhäkelung beim leerenden Fall auf `true` zwingen
  (muss rot werden) · den Gleichheitsfilter entfernen (muss rot werden). Echte Ausgabe in den Bericht.
- [ ] **Schritt 6: Committen** (`git status`, dann nur die zwei Pfade)

---

## Aufgabe 3: Das Bauteil, Hülle `.dt-*` — erster Nutzer: Kraftlinien

**Dateien:** erstellen `js/ui/wiki-assign.js` · ändern `css/components/editor-page.css`,
`html/wiki-sync-powerline-editor.html`

**Schnittstellen:**
- Verwendet aus 1 und 2: Register und Diff.
- Liefert an 4–9: `avesmapsWikiAssignMount(container, { subject, skin, laden, zuweisen, loesen, syncUebernehmen })`.

- [ ] **Schritt 1: Prüfen, welche Regeln in welcher Hülle schon da sind**

```bash
grep -c "label-wiki-picker-list" css/components/region-sync.css css/components/editor-page.css
grep -n "region-sync.css\|editor-page.css" index.html html/wiki-sync-powerline-editor.html
```

Erwartet: `region-sync.css` hat die Trefferlisten-Regeln (7), `editor-page.css` hat **keine**;
`index.html` lädt die erste, die Editor-iframes die zweite. 💣 **Daraus folgt: die `.dt-*`-Hülle
braucht ihre Trefferlisten-Regeln in `editor-page.css`** — sonst ist die Liste im Editorfenster
ungestylt. Eine **neue CSS-Datei ist nicht nötig** und wäre eine dritte Hülle.

- [ ] **Schritt 2: Die Trefferlisten-Regeln in `editor-page.css` ergänzen**

Neben den vorhandenen `.dt-*`-Regeln, mit denselben Token (`--line`, `--mut`, `--radius-md`,
`--space-*`, `--font-size-caption`). **Kein neuer Farbwert, kein neuer Radius.**

- [ ] **Schritt 3: Das Bauteil schreiben**

`js/ui/wiki-assign.js`. Es kennt **keine** Objektart — alles kommt aus der Erklärung. Es rendert die
drei Zustände, die Suche (tippt mit, Tastatur ↑ ↓ Enter Esc), und die Sync-Vorschau aus Aufgabe 2.

🔴 **Der Sync-Knopf erscheint nur, wenn die Erklärung `sync: true` sagt** — und die ist an das
Vorhandensein von Feldzielen gebunden (Aufgabe 1, Fall 5).
🔴 **Leere Felder fallen weg**, sie stehen nicht leer da (Entwurf §4).
💣 **Kein Freitext-Feld für eine Adresse.**

**Ein Treffer sagt IM Treffer, wenn er schon woanders hängt** — vor dem Klick, nicht danach
(Entwurf §5). Woher das Bauteil das weiß, kommt aus der Erklärung: liefert die Suche zu einem
Treffer ein „hängt an …", zeigt die Trefferzeile es als dritte Zeile.

⚠️ **Nicht jede Suche liefert das heute.** Die Label-Liste kann es, die anderen nicht. Miss es
nach:

```bash
grep -rn "bereits\|belegt\|assigned\|in_use\|hängt" js/review/review-label-wiki.js | head -6
```

Liefert ein Endpunkt die Angabe nicht, bleibt die dritte Zeile für diese Objektart **leer** — das
ist erlaubt und wird im Bericht genannt. 💣 **Nicht raten und nicht nachbauen**: eine erfundene
Belegt-Anzeige, die manchmal stimmt, ist schlimmer als keine.

- [ ] **Schritt 4: Die Kraftlinien darauf umstellen**

`html/wiki-sync-powerline-editor.html`: die am 15.08. gebaute Auswahlliste (`plWikiUrl`,
`plWikiList`) wird durch das Bauteil ersetzt. **Das Häkchen „Kein Wiki-Artikel vorhanden" bleibt**
und wandert in `extra`. Der Speicherweg (`update_powerline_line`) bleibt unangetastet.

⚠️ **Zeilenenden dieser Datei zuerst prüfen.**

- [ ] **Schritt 5: Der Ablauf, nicht das Maß**

Die Kraftlinien-Liste öffnen, eine Linie wählen, einen Artikel **zuweisen**, speichern, Fenster
schließen und neu öffnen. Erwartet: die Zuweisung steht noch da. Dann das Häkchen setzen,
speichern, neu öffnen — es steht noch da.

⚠️ Braucht eine angemeldete Sitzung. Ist keine da: **im Bericht als offen melden**, nicht behaupten.

- [ ] **Schritt 6: JS-Testfeld + Committen**

---

## Aufgabe 4: Hülle `.label-wiki-*` — erster Nutzer: Weg (beide Oberflächen)

**Dateien:** ändern `index.html`, `js/review/review-path-wiki.js`, Wege-Editor (Pfad in Schritt 1)

- [ ] **Schritt 1: Den heutigen Weg-Picker und BEIDE Oberflächen finden**

```bash
grep -n "path-wiki-picker\|path-wiki-assign\|path-wiki-remove\|action=search" js/review/review-path-wiki.js | head -20
grep -rln "Wiki-Weg" --include=*.html . | grep -v worktrees
```

Erwartet: der Karten-Dialog (`index.html`) **und** der Wege-Editor. ⚠️ Im Wege-Editor steht heute
nur „Verknüpft … ↗" plus der Hinweis, dass Zuweisen und Entfernen woanders laufen — **beide
bekommen das Bauteil**, damit dieser Umweg entfällt.

- [ ] **Schritt 2: Die Erklärung für `weg` ins Register eintragen** (Aufgabe 1), Suche über
  `/api/edit/wiki/paths.php?action=search&q=…&limit=40`.
- [ ] **Schritt 3: Den Karten-Dialog auf das Bauteil umstellen**, Hülle `.label-wiki-*`.
- [ ] **Schritt 4: Den Wege-Editor umstellen**, Hülle `.dt-*`.
  💣 **Ein Wiki-Weg hängt an ALLEN Segmenten seines Wegs zugleich** — der heutige Hinweistext sagt
  das ausdrücklich. Die Zuweisung darf also nicht nur das gewählte Segment treffen. Prüfe im
  Schreibweg nach, wie weit er reicht, bevor du das Bauteil daranhängst.
- [ ] **Schritt 5: Sync ergänzen** — den hatte der Weg bisher **nicht**; die Felder aus der
  Erklärung machen ihn möglich.
- [ ] **Schritt 6: Ablauf** — in **beiden** Oberflächen zuweisen, syncen (Vorschau erscheint,
  Häkchen wirken), entfernen. Als offen melden, wenn keine Sitzung da ist.
- [ ] **Schritt 7: Testfeld + Committen**

---

## Aufgabe 5: Ort — beide Oberflächen

**Dateien:** `js/review/review-settlement-wiki.js`, `index.html`, Orte-Editor (Pfad in Schritt 1)

⚠️ **Hier hängen zwei bestehende Tests dran** — `js/review/__tests__/settlement-wiki-pending-assign.test.js`
und `…/settlement-wiki-url-field.test.js`. Sie müssen grün bleiben oder mitwandern; sie **nicht**
löschen, um den Lauf grün zu bekommen.

- [ ] **Schritt 1: Bestand messen**

```bash
grep -n "settlement-wiki-assign\|settlement-wiki-picker\|action=search" js/review/review-settlement-wiki.js | head
node js/review/__tests__/settlement-wiki-pending-assign.test.js && node js/review/__tests__/settlement-wiki-url-field.test.js
```

- [ ] **Schritt 2: Erklärung `ort` eintragen** — Name, Art, Einwohner, Lage, Herrscher (die echten
  Kartenfeld-Namen aus Aufgabe 1 Schritt 1).
- [ ] **Schritt 3: Karten-Dialog umstellen** und **Sync ergänzen** (hatte er nicht).
- [ ] **Schritt 4: Orte-Editor umstellen** — dort steht heute nur eine Zeile „Wiki-Ort … ↗".
- [ ] **Schritt 5: Ablauf** — zuweisen · syncen und dabei **die Einwohnerzahl ungehakt lassen**,
  übernehmen, prüfen dass sie unverändert blieb · entfernen.
- [ ] **Schritt 6: Beide Alt-Tests laufen lassen + Testfeld + Committen**

---

## Aufgabe 6: Landschaft — beide Oberflächen

**Dateien:** `js/review/review-label-wiki.js`, `js/map-features/map-features-ecosystem-properties.js`,
`html/landschaften-editor.html`, `index.html`

🔴 **Das ist die Oberfläche, die heute schon einen Sync hat** — `syncFromWikiRegion()` überschreibt
Name und Art **unbedingt**. Sie bekommt die Vorschau; das unbedingte Überschreiben entfällt.

- [ ] **Schritt 1: Die heutige Sync-Logik lesen**

```bash
grep -n "function syncFromWikiRegion" -A 28 js/map-features/map-features-ecosystem-properties.js
grep -n "avesmapsWikiRegionArtToSubtype\|split(/\\\\s\*\[|,\]" js/map-features/map-features-ecosystem-properties.js api/_internal/wiki/regions.php | head
```

💣 Erwartet: die Art wird über eine **eigene Regel** abgebildet, und aus einer mehrwertigen Art
(„Tal|Grube") gilt nur die **erste** Komponente. Diese Regel wandert in die Erklärung — sie darf
nicht verlorengehen und **nicht** neu erfunden werden.

- [ ] **Schritt 2: Erklärung `landschaft` eintragen** (Name, Art — mit der Regel aus Schritt 1)
- [ ] **Schritt 3: Der Eigenschaften-Dialog sucht künftig beim Tippen**, nicht auf Knopfdruck.
  💣 Das ist der einzige Unterschied, den ein Editor sofort bemerkt.
- [ ] **Schritt 4: Regionen-Editor umstellen** — der Formularblock mit der Wiki-URL von Hand
  entfällt; die Adresse wird nicht mehr getippt.
- [ ] **Schritt 5: Ablauf** — zuweisen · syncen mit Vorschau (die Art steht **nicht** in der Liste,
  wenn sie schon stimmt) · entfernen.
- [ ] **Schritt 6: Testfeld + Committen**

---

## Aufgabe 7: Territorium — mit der Eltern-Sperre

**Dateien:** Territorien-Editor (Pfad in Schritt 1), Register

- [ ] **Schritt 1: Den Editor und die Sperre finden**

```bash
grep -rln "Eltern hier sperren" --include=*.html --include=*.js . | grep -v worktrees
grep -rn "parent_locked" api/_internal/wiki/dump-compare.php | head -4
```

Erwartet: `parent_locked = 1` in `wiki_territory_model` ist ein **bewusster Editor-Override, den
der Dump nicht reproduzieren soll**; der Massenabgleich schließt gesperrte Schlüssel bereits aus.

- [ ] **Schritt 2: Erklärung `territorium` eintragen**
- [ ] **Schritt 3: Umstellen**
- [ ] **Schritt 4: 🔴 Den Riegel setzen — an der FELDZEILE, nicht am Knopf**

Ist `parent_locked` gesetzt, ist in der Sync-Vorschau die Zeile **„Eltern"** gesperrt und
ausgegraut, **mit dem Grund daneben**. Die übrigen Zeilen bleiben bedienbar.

💣 **Nicht den ganzen Knopf sperren** — sonst verhindert eine Entscheidung über die Hierarchie auch,
dass jemand den Namen nachzieht. 💣 **Nicht still überspringen** — ein Knopf, der drückbar aussieht
und nichts tut, ist schlimmer als einer, der erklärt, warum er nicht kann.

- [ ] **Schritt 5: Test** — Erklärung mit gesetzter Sperre ⇒ die Zeile „Eltern" kommt als gesperrt
  zurück, die übrigen nicht. Mutation: Sperre ignorieren ⇒ Test rot.
- [ ] **Schritt 6: Testfeld + Committen**

---

## Aufgabe 8: Literatur

**Dateien:** `html/game-literature-editor.html`, Register

- [ ] **Schritt 1: Den heutigen Zustand messen**

```bash
grep -n "Wiki-URL\|wiki_url\|WIKI & F-SHOP" html/game-literature-editor.html | head
```

Erwartet: die Wiki-Adresse steht als **freies Textfeld** neben F-Shop-Code und Cover-URL.

- [ ] **Schritt 2: Erklärung `literatur` eintragen**
- [ ] **Schritt 3: Umstellen** — ⚠️ **F-Shop-Code und Cover-URL bleiben Textfelder.** Sie sind keine
  Wiki-Zuweisung und gehören nicht ins Bauteil.
- [ ] **Schritt 4: Ablauf + Testfeld + Committen**

---

## Aufgabe 9: Karte (Stadtplan) — neues Feld und die Kollisionsprüfung

**Dateien:** `html/citymap-editor.html`, `api/_internal/conflicts/rules.php`, Register, Schreibweg
der Karten (Pfad in Schritt 1)

- [ ] **Schritt 1: 💣 Die drei „wiki"-Dinge auseinanderhalten**

```bash
grep -n "avesmapsCitymapWikiKey" -A 6 api/_internal/wiki/citymap-sync.php | head -14
grep -n "AVESMAPS_WIKI_PAGE_BASE_URL . str_replace" -B 6 api/_internal/wiki/citymap-sync.php
grep -n "citymap.wiki_key is a COMPOSITE" -A 3 api/_internal/conflicts/rules.php
```

Erwartet:
- `wiki_key` = **Bauschlüssel** `index:stadt:quelle:variante` — sagt, aus welcher Index-Seite die
  Zeile stammt. **Keine Seitenidentität.**
- `wiki_url` = Link auf die **Publikation**, aus der die Karte stammt — **nicht** auf die Karte.
- 🔴 **Beide bleiben unangetastet**; an ihnen hängt der laufende Karten-Abgleich.

- [ ] **Schritt 2: Ein neues Feld mit eigenem Namen** für den **eigenen Artikel** der Karte.
  💣 **Nicht `wiki_url` nennen und nicht `wiki_key`** — sonst ist die Verwechslung eingebaut
  (dieselbe Klasse wie *Literatur* gegen *Quellen*).
- [ ] **Schritt 3: Erklärung `karte` eintragen**, mit dem dritten Zustand („gibt natürlich auch
  welche von uns").
- [ ] **Schritt 4: Die Karten in die Kollisionsprüfung aufnehmen**

`avesmapsConflictLoadMapRows` / `avesmapsConflictLoadTerritoryRows` schließen Karten heute
**ausdrücklich** aus, *weil* ihr Schlüssel ein Bauschlüssel ist. Jetzt tragen sie einen echten
Artikel ⇒ sie gehören hinein. **Den Kommentar dort mitkorrigieren** — er begründet heute den
Ausschluss und wäre sonst eine Lüge.

- [ ] **Schritt 5: Test** — eine Karte und ein Ort auf demselben Artikel ⇒ ein Fall. Eine Karte mit
  Bauschlüssel und ohne Artikel ⇒ **kein** Fall.
- [ ] **Schritt 6: Testfeld + Committen**

---

## Aufgabe 10: Rückbau

**Dateien:** `js/review/review-settlement-wiki.js`, `review-path-wiki.js`, `review-label-wiki.js`,
`review-region-wiki-picker.js`, `map-features-ecosystem-properties.js`, `index.html`

- [ ] **Schritt 1: Suchen, was niemand mehr ruft**

```bash
for f in settlementWiki pathWiki labelWiki regionWikiPicker; do echo "--- $f"; grep -rn "$f" --include=*.js --include=*.html . | grep -v worktrees | grep -v "__tests__" | wc -l; done
```

- [ ] **Schritt 2: Nur entfernen, was nachweislich unbenutzt ist.** ⚠️ Was du nicht sicher
  zuordnen kannst, **bleibt stehen** und wird im Bericht genannt. Toter Code ist billiger als ein
  fehlender Aufrufer.
- [ ] **Schritt 3: Volles Testfeld** — hier fällt auf, wenn ein Test an einer entfernten Funktion hing.
- [ ] **Schritt 4: Committen**

---

## Aufgabe 11: Abnahme und Zusammenführen

- [ ] **Schritt 1: Das ganze Testfeld** (alle drei Läufe aus den Globalen Vorgaben)
- [ ] **Schritt 2: 🔴 Der Ablauf in ALLEN zehn Oberflächen**

Je Oberfläche wirklich: **zuweisen · syncen (wo es einen gibt) · entfernen**. Eine Maßtabelle ist
kein Beleg (AGENTS.md §9).

| # | Oberfläche | zusätzlich zu prüfen |
|---|---|---|
| 1 | Landschaft · Regionen-Editor | die Adresse lässt sich nicht mehr tippen |
| 2 | Landschaft · Karten-Dialog | Suche tippt mit, kein „Suchen"-Knopf mehr |
| 3 | Ort · Orte-Editor | — |
| 4 | Ort · Karten-Dialog | Sync ist neu; Einwohnerzahl ungehakt lassen ⇒ bleibt |
| 5 | Weg · Wege-Editor | — |
| 6 | Weg · Karten-Dialog | Sync ist neu |
| 7 | Territorium | **gesperrte Eltern: Zeile „Eltern" gesperrt, übrige bedienbar** |
| 8 | Kraftlinie | Häkchen „kein Artikel" überlebt Speichern + Neuöffnen |
| 9 | Literatur | F-Shop-Code und Cover-URL sind weiterhin Textfelder |
| 10 | Karte | Zuweisung greift; eine eigene Karte trägt den dritten Zustand |

- [ ] **Schritt 3: Tastatur und Browser**

↑ ↓ Enter Esc in einer Trefferliste. ⚠️ **In Chrome UND Firefox** ansehen — die Trefferliste ist
selbst gebaut, aber Fokus und Tastatur verhalten sich nicht überall gleich.

- [ ] **Schritt 4: Zusammenführen**

```bash
git fetch origin --quiet && git log --oneline HEAD..origin/master | head
```
```bash
git checkout master && git merge --no-ff wiki-zuweisung && git push origin master
```

💣 **Bei abgelehntem Push NICHT `rebase --autostash`** — im geteilten Baum liegt fremde offene
Arbeit; der Stash-Rücklauf wendet einen Diff gegen den **alten** Stand auf den **neuen** an.
Stattdessen: prüfen, ob sich fremde Commits mit den eigenen Dateien überschneiden — wenn ja,
**halten und mit dem Owner klären**; wenn nein, `git reset --mixed origin/master` (⚠️ **nie
`--hard`**), eigene Pfade neu stagen, neu committen.

- [ ] **Schritt 5: Den entfernten Stand prüfen**

```bash
git fetch origin --quiet && git log --oneline -1 HEAD && git log --oneline -1 origin/master
```

Beide SHAs müssen gleich sein. Danach ~1–2 Minuten Deploy, PHP durch den Opcache 2–4 Minuten.

---

## Was dieser Plan NICHT baut

- 🔧 **Vorkommen** — ihr Wiki-Link ist eine Quellenangabe, keine Objekt-Zuweisung (Owner-Entscheid).
- 🔧 **Eine automatische Felder-Erkennung** — nicht sicher machbar, Begründung in Entwurf §3a.
  Die Prüfung aus Aufgabe 1 tritt an ihre Stelle.
- 🔧 **Ein dritter Skin.** Wer eine Oberfläche findet, in die keine der zwei Hüllen passt, meldet
  das, statt eine dritte zu bauen.
- 🔧 **Die Massenläufe** („⚡ … syncen") bleiben unverändert. Sie heißen wie der Knopf im
  Zuweisungsblock, tun aber etwas anderes; der Owner hat den Namen bewusst behalten.
