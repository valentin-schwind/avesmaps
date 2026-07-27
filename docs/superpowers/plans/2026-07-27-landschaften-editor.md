# Landschaften-Editor — der siebte Editor — Instruction

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen `- [ ]` zum Abhaken.
> **Eigener Worktree auf `origin/master`.**

**Stand:** 2026-07-27. **Auftraggeber:** Owner, in der Sitzung vom 2026-07-27.
Maßstab: `docs/superpowers/specs/2026-07-22-editor-designsprache-design.md` (Hausordnung
aller Editoren), `docs/design-language.md`, AGENTS.md §12.

**Ziel:** Der Landschaften-Editor als **siebter** Listen-Editor — drei gleiche Spalten,
Menüband, gemeinsame Hülle. Er ist der Ort, an dem der **Raycast** („welche Vegetation
und Topographie liegt in welcher derographischen Region") sichtbar wird.

---

## 0. Warum dieser Plan existiert

Der Editor war der Inhalt von **V6**. Dann wurde der Name V6 für die Wiki-Zuweisung
wiederverwendet (`docs/superpowers/plans/2026-07-27-landschaften-v6-wiki-zuweisung.md`),
die bekam ihr ✅ — und der Editor blieb ohne Eintrag zurück. Die Aufgabenliste im
Hauptplan (`2026-07-24-landschaften.md`) endet bei **V3.6**; einen Abschnitt „V6" gibt es
dort **gar nicht**, nur den Nebensatz *„der volle Landschaftseditor mit drei Spalten (V6)
ist nicht Teil dieses Vorhabens"*.

**Niemand hat ihn abgewählt. Er ist durchgerutscht.** Dieser Plan gibt ihm seinen Platz
zurück.

---

## 1. Wo er hingehört — im Code reserviert

`js/review/review-subjects.js:53` sagt es als Kommentar:

> `editorButtonId: null` heißt „kein Listen-Editor" (Regionen, Wege)

und Zeile 66 ist die Regionen-Zeile mit genau diesem `null`. **Das ist die Lücke.**

```js
{ key: "regions", label: "Regionen", syncButtonId: "wiki-sync-sync-region",
  editorButtonId: null,  // <- hier hinein
  syncKind: "region", views: WIKI_SYNC_MAP_VIEWS },
```

**Beschriftung: „Regionen bearbeiten"** — Knopf **und** Fenstertitel wortgleich
(Designsprache-Spec §2, dort schon reserviert: *„sobald es ihn gibt"*). Der Knopf
erscheint im Reiter **WikiSync**, unter den acht Subjekt-Kacheln, neben „🚨 Syncen" —
genau wie bei Siedlungen, Abenteuer, Karten, Kraftlinien, Vorkommen.

### 1.1 Bauart: dem SECHSTEN folgen, nichts erfinden

Vorlage ist der **Kraftlinien-Editor** (`js/review/review-powerline-list.js`, Spec
`docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md`) — der jüngste und
sauberste:

- eigene, in sich geschlossene iframe-Seite unter `html/`
- geladen mit `?v=" + Date.now()` — **kein `ASSET_VERSION`**: der Host entwertet das
  Dokument selbst, und der Deploy stempelt die darin verlinkten CSS/JS
- gemeinsame Hülle `css/components/editor-shell.css`, Klassen `avm-editor-*`
- Vorauswahl von aussen per `postMessage` in den gleich-origin-iframe

> ⚠️ **Nicht die `political-territory-editor-*`-Klassen nehmen.** Vier ältere Editoren
> benutzen sie noch, obwohl nur einer der Territorien-Editor ist (Spec §1.2: „die Hülle
> existiert, aber sie lügt über ihren Namen"). `avm-editor-*` ist der Zielzustand, und ein
> neuer Editor hat keine Altlast zu tragen.

---

## 2. Was schon liegt — und deshalb NICHT gebaut wird

Der teure Teil ist erledigt. Wer das übersieht, baut ihn nach.

| Baustein | Zustand |
|---|---|
| **Hülle** | ✅ `css/components/editor-shell.css`, Maße **einmal** definiert (`min(1400px, calc(100vw - 24px))` × `min(880px, …)`) |
| **Alle Flächen mit Geometrie** | ✅ `api/app/ecosystem-areas.php` **ohne** `bbox` liefert den ganzen Bestand. Der Raycast braucht **keinen neuen Endpunkt** (`map-features-ecosystem-loader.js:186` — der bbox-Parameter ist optional) |
| **Regionen + Art-Vokabular** | ✅ `list_regions` (`api/edit/map/ecosystem.php`, fähigkeitsgeprüft): aktive Regionen eines `kind` mit Flächenzahl **plus** die `region_type`-Wortliste |
| **Die ganze Geometrie-Rechnung** | ✅ `js/map-features/map-features-ecosystem-boolean.js` — Verschneidung, Vereinigung, Fläche, Multipolygone. **Unit-getestet** (`__tests__/ecosystem-boolean.test.js`) |
| **Filtertrichter** | ✅ `attachFilterMenu(toggleId, panelId, sections, applyFilter, label)` in `js/app/utils.js:133` — geteiltes Bauteil, kein eigener bauen |
| **Schreibkanal** | ✅ `postEcosystemEdit(action, payload)` (`map-features-ecosystem-region-store.js`) — kennt `ECOSYSTEM_EDIT_API_URL`, setzt `credentials`, hängt `error.code`/`error.status` an |
| **Der Totmannschalter** | ✅ serverseitig: Aktion `set_enabled`. ⚠️ **Hat bis heute KEINEN Aufrufer im Client** (`grep set_enabled js/` → leer). Das Menüband ist seine erste Oberfläche |
| **`promote_trial`** | ✅ serverseitig, ebenfalls ohne Oberfläche |

### 2.1 Die Raycast-Regel — entschieden und gemessen

**Anteil an der KLEINEREN der beiden Flächen, Schwelle 10 %.**

```
anteil = fläche(A ∩ B) / fläche(kleinere von A, B)
```

- „kleinere von beiden" deckt auch den Fall ab, dass ein Gebirgszug über mehrere
  derographische Regionen läuft — bei „Anteil am Gebirge" fiele er überall raus.
- **Nicht „≥ 1 Vertex"**: das verpasst echte Überlappungen (ein langer Wald quert eine
  Region, ohne eine Ecke darin zu haben) und hängt an der `simplify_ratio` der
  Rasterverfolgung statt an der Geographie.
- **Gemessen: 47 ms** für den ganzen Live-Bestand (124 Flächen × 20 Regionen), mit
  Bounding-Box-Vorfilter, der 94 % der Paare vorher verwirft. Bei 1000 × 100 sind es
  834 ms. Die Rechnung ist **kein** Performance-Problem.
- **Anteil sichtbar machen und danach sortieren** — dann ist die Schwelle keine Magie,
  sondern eine Zeile, über die man streiten kann.

> 🔴 **Gerechnet, nie gespeichert.** Wie beim Konfliktzentrum: eine verschobene Grenze
> korrigiert die Antwort von selbst. Keine Spalte, keine Hierarchie — Regionen liegen
> nebeneinander (§12 der Verhaltensdoku), und ein Wald darf zu zwei Regionen gehören.

---

## 3. Die drei Spalten — Owner-Vorgabe vom 2026-07-27

> 💣 **`display: grid`, nicht Flex.** `repeat(3, minmax(0, 1fr))`, Kinder `min-width: 0;
> min-height: 0`. Zweimal gemessen, zweimal daneben: Abenteuer stand auf `flex: 1 1 0` und
> lieferte **483 / 458 / 458**, Karten **459 / 673 / 244**. Ursache ist `flex-basis: 0`
> **mit `box-sizing: border-box`** — eine Border-Box kann nicht unter ihr eigenes Padding.
> Gitterspuren kennen das nicht. **Prüfen heißt messen, nicht die Regel lesen.**

### Spalte 1 — Regionen

Die Liste **aller** Regionen. Reiter oben:

```
Alle · Derographische Region · Vegetation · Topographie
```

Darunter der **Filtertrichter** (`attachFilterMenu`) mit mindestens:

| Filter | Werte |
|---|---|
| **Wiki** | Alle · mit Wiki · ohne Wiki |
| **Map-Darstellung** | Alle · Label · Fläche · keine · alle |
| **Art** | aus `region_type` der jeweiligen Ebene |

Inhalt: `Heldentrutz`, `Blautann`, …

> ❓ **Zu klären mit dem Owner, bevor Spalte 1 gebaut wird:** listet sie nur
> `ecosystem_region`-Zeilen (also gezeichnete Flächen), oder die **Vereinigung** aus
> gezeichneten Flächen + Karten-Labels + Wiki-Regionen ohne beides? Der Filter
> „Map-Darstellung: keine" legt die zweite Lesart nahe — dann ist die Liste dieselbe
> Menge wie „Alle (1461)" im heutigen WikiSync-Reiter, nur anders geschnitten.
> **Nicht raten.** Die Antwort entscheidet den Lesepfad.

### Spalte 2 — Eigenschaften und Zugehörigkeit

- **Eigenschaften** der Auswahl: Name, Auto-Name-Haken, Art, Wiki-Landschaft,
  Unterflächen. Reihenfolge nach Spec §3.5: Bilder → Identität → Rest → Quellen.
- **„Gemeinsame Regionen mit"** — das Ergebnis des Raycasts als Liste, je Eintrag mit
  Anteil. Jeder Eintrag ist ein **Knopf**, der das Paar wählt:
  `Blautann → [Heldentrutz – Blautann]`
- Die Auswahl eines Paares treibt Spalte 3.

### Spalte 3 — Vorschau und Vorkommen

- **Live-Vorschau der Schnittmenge** des gewählten Paares (boolesche
  `intersection`, nicht Union).

  > 🪤 **Vorlage ist die Territorien-Vorschau** — dort war es immer *union*:
  > `js/territory/territory-derived-geometry-editor.js:45-46`, ein Thumbnail-`div`
  > `.political-territory-derived-geometry-thumbnail`.
  > 🔴 **Das ist eine POLITISCHE Datei: abschreiben, nie aufrufen** (Hauptplan, Regel 1).
  > Die Rechnung selbst kommt aus `ecosystemBooleanGeometry("intersection", …)`, das es
  > schon gibt und getestet ist.

- **Vorkommen** der beteiligten Regionen — „Wirselkraut kommt in Heldentrutz vor",
  „Blautannarmbrust in Blautann". *(Beispiele erfunden.)*

  > 💣 **Die Brücke Vorkommen ↔ Region läuft über eine POLITISCHE Tabelle.**
  > `api/_internal/app/lore.php:599` liest `political_territory_wiki.geographic` und
  > verteilt darüber Territorien auf Regionen (`avesmapsLoreKeysFromWikiField`, :500).
  > **Der Editor darf diese Tabelle NICHT selbst anfassen** — er ruft den vorhandenen
  > Lesepfad `api/app/lore.php`. Welchen Parameter der dafür nimmt, ist **noch nicht
  > geprüft**; das ist der erste Schritt von Aufgabe 4.

---

## 4. Menüband — Owner-Vorgabe

```css
.avm-ribbon { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
```

Drei Kacheln, alle gleich breit, zweizeilig (`.t1` fett, `.t2` gedämpft):

| Kachel | Wirkung |
|---|---|
| **🚨 Syncen** | die Sync-Kachel. **Einzige** mit Icon und `--primary` |
| **Zugehörigkeit rechnen** | löst den Raycast aus |
| **Landschaftsmodul AN/AUS** | der Totmannschalter (`set_enabled`) — **erste Oberfläche überhaupt** |

> 💣 **`--primary` braucht eine EIGENE Hover-Regel, und sie muss NACH der allgemeinen
> stehen.** Fehlt sie, gewinnt der allgemeine Hover mit hellem Grund, während die Schrift
> cremefarben bleibt: hell auf hell, unlesbar. Beim Bau des Musters genau so passiert und
> ohne Kontrastmessung nicht zu sehen.

**Statuszeile:** eigene Zeile **unter** dem Menüband, volle Breite (Spec §3.4).

---

## 5. Globale Regeln

1. 🔴 **Keine politische Datei wird bearbeitet oder aufgerufen** (Hauptplan, Regel 1).
   Die Territorien-Vorschau und `map-features-region-*` dürfen **abgeschrieben**, nie
   importiert werden. `pointInPolygon` ist die eine Ausnahme und keine echte: ein
   eigenständiger Rechenhelfer mit eigenem Test, den auch der Siedlungseditor lädt.
2. 🔴 **`wiki_region_key` entsteht serverseitig** aus `wiki_url`. Der Client schickt nie
   einen Schlüssel.
3. 🔴 **Der Totmannschalter bleibt vollständig.** Alles hinter
   `avesmapsRequireUserWithCapability('edit')` im vorhandenen Endpunkt.
4. **Kein `?v=` von Hand** — Ausnahme nur `edit/index.php`. Der iframe wird mit
   `?v=Date.now()` geladen, das ist der Host, nicht der Stempler.
5. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.** Neue
   UI-Strings zusätzlich in `js/app/i18n-en.js`.
6. **Jeder neue Top-Level-Name wird vor dem Commit gegen `grep` über `js/` geprüft** —
   164 klassische `<script>`-Tags teilen einen globalen Scope.
7. **Geteilter Arbeitsbaum:** nie `git add -A`, nur eigene Pfade einzeln.
8. **Abnahme im Browser**, nicht „Tests grün". Es gibt keine lokale Datenbank; jeder
   DB-Pfad ist nur live prüfbar. 💣 Der Vorschau-Pane friert **transitionierte**
   CSS-Eigenschaften auf ihrem Startwert ein, solange er ausgeblendet ist — vor jeder
   Messung von `fill-opacity`/`stroke-opacity` `* { transition: none }` einspeisen.
9. 💣 **Karten-Gesten nur mit ECHTEN DOM-Ereignissen prüfen.** `map.fire("click")` umgeht
   die Leaflet-Ebene und landet direkt auf der Karte — den Weg nimmt kein Mensch. Das hat
   in der Sitzung vom 2026-07-27 zweimal eine falsche Sicherheit erzeugt.

---

## 6. Dateien

| Datei | Verantwortung |
|---|---|
| `html/landschaften-editor.html` | **neu** — die iframe-Seite, in sich geschlossen |
| `js/review/review-ecosystem-list.js` | **neu** — `openAvesmapsEcosystemEditorOverlay()`, nach dem Muster von `review-powerline-list.js` |
| `js/review/review-subjects.js` | **ändern** — `editorButtonId: "ecosystem-editor-open"` bei `regions` |
| `index.html` | **ändern** — der Knopf „Regionen bearbeiten" + der `<script>`-Tag |
| `css/pages/landschaften-editor.css` | **neu** — nur, was die gemeinsame Hülle nicht deckt |
| `js/app/i18n-en.js` | **ändern** — die neuen Beschriftungen |

---

## 7. Aufgaben

- [ ] **1 — Hülle und Einstieg.** Knopf „Regionen bearbeiten" im WikiSync-Reiter,
      `editorButtonId` gesetzt, iframe-Seite mit `avm-editor-*`, Menüband mit den drei
      Kacheln, Statuszeile. **Drei leere Spalten, aber gemessen gleich breit** — die
      Messung ist das Fertigkriterium, nicht der Anblick.
- [ ] **2 — Spalte 1.** Erst die offene Frage aus §3 klären, dann Liste, Reiter,
      Filtertrichter. `attachFilterMenu` benutzen, keinen eigenen bauen.
- [ ] **3 — Spalte 2 und der Raycast.** `api/app/ecosystem-areas.php` ohne `bbox`,
      Bounding-Box-Vorfilter, `ecosystemBooleanGeometry("intersection", …)`, Anteil an der
      kleineren, Schwelle 10 %, sortiert, Prozent sichtbar. Die Kachel „Zugehörigkeit
      rechnen" löst aus.
- [ ] **4 — Spalte 3.** Zuerst prüfen, welchen Parameter `api/app/lore.php` für
      „Vorkommen in Region X" nimmt. Dann Schnittmengen-Vorschau (Territorien-Vorlage
      abgeschrieben) und die Vorkommen-Liste.
- [ ] **5 — Totmannschalter-Kachel.** Erste Oberfläche für `set_enabled`. Zustand IN der
      Kachel, nicht daneben.
- [ ] **6 — Doku.** `docs/oekosystem-editor-verhalten.md` um den Editor ergänzen; die
      V6-Verwechslung in `2026-07-24-landschaften.md` richtigstellen, damit der nächste
      Leser nicht wieder glaubt, V6 sei der Editor gewesen und erledigt.

---

## 8. Nicht Gegenstand

- **Die „Wasser schlägt Vegetation"-Frage.** Ein von Hand geschnittenes Loch ist eine
  Momentaufnahme; verschiebt sich der See, ist jeder darum geschnittene Wald still falsch.
  Ob das eine Regel beim Zeichnen/Auswerten wird, ist eine **offene Owner-Entscheidung**
  und ein eigenes Vorhaben — sie bräuchte dieselbe Verschneidung wie der Raycast.
- **Label je Region am Point of Inaccessibility.** Entschieden (1 Label je Region,
  `label_public_id` bleibt auf `ecosystem_region`, `polylabel` liegt im Baum), aber ein
  eigener Schritt.
- **Regionen verschmelzen, Flächen zwischen Regionen verschieben.** Seit dem 2026-07-27
  bekommt jede gezeichnete, zerschnittene und herausgelöste Fläche ihre **eigene** Region;
  die 1:n-Beziehung schrumpft damit von selbst und braucht kein Werkzeug.
