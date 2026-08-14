# WikiSync-Listen — eine Form für acht

**Entwurf · 14.08.2026 · Owner-Abnahme der Gestaltungsfragen erfolgt (siehe §3–§5)**
Mockup: `docs/wikisync-listen-mockup.html`

---

## 1 · Warum

Der Owner am 14.08.2026, mit acht Bildschirmfotos der acht WikiSync-Listen:

> „diese listen sind im design sehr unterschiedlich, siehst du eine möglichkeit das zu
> vereinheitlichen? die funktionalität und informationen sollen unverändert gleich bleiben"

🔴 **„Funktionalität und Informationen unverändert" ist die Klammer um diesen ganzen Entwurf.**
Es wird keine Angabe entfernt, keine hinzugefügt, kein Knopf verschoben, kein Reiter erfunden.
Geändert werden Maße, Farben, Wortlaut und die Position von zwei Zeilen.

---

## 2 · Der Befund: es sind zwei Bauarten, nicht acht

| Bauart | Regel | Subjekte |
|---|---|---|
| **A** | `.wikisync-itemlist .tree-item` — `css/components/region-sync.css:922` | Orte, Regionen, Wege, Kraftlinien |
| **A′** | `#wiki-sync-territory-tree .tree-item` — `css/pages/political-territory-wiki-tree.css:122` | Territorien |
| **B** | `.wiki-sync-adv-picker__row` — `css/features/review-panel.css:671` | Literatur, Karten, Vorkommen |

💣 **A und A′ sind dieselbe Rezeptur, zweimal geschrieben.** Beide setzen `padding: 6px 8px`,
`row-gap: 7px`, `column-gap: 7px`, `line-height: 1.22`, denselben 13px-Statuskreis mit denselben
drei Füllvarianten. Sie stehen in zwei Dateien und wurden zweimal gepflegt. **Das ist die
eigentliche Divergenzquelle** — nicht B. Wer nur eine der beiden anfasst, baut den Zustand neu ein,
der hier beseitigt werden soll.

### Was A heute falsch macht (gemessen an `docs/design-language.md`)

| Wert | heute | Skala sagt |
|---|---|---|
| Name | `13,33px` (erbt `body { font-size: 10pt }`) | kein Sprossen der Skala — `--font-size-body` ist 13px |
| Meta | `0,78em` = `10,4px` | **unter der 11px-Untergrenze**; das Dokument nennt „die alten 9–10,5px-Mikrogrößen" ausdrücklich als zu hebende |
| Trennlinie | `--color-panel-muted` | das ist eine **Füllfarbe**; die Trennfarbe heißt `--color-divider` |
| Überfahrt | `--color-panel-soft` | `--color-hover-wash` ist wörtlich als „row / option hover" dokumentiert |

B liegt mit 12/11 und `--color-divider` bereits richtig — nur als **harte Zahlen statt Token**.

---

## 3 · Die gemeinsame Zeile

**Beschluss des Owners:** Bauart A gewinnt (Trennlinie, kein Kasten, Statuskreis) — **kompakter**.

```
.wikisync-itemlist .tree-item          /* EINE Regel, auch für Territorien */
	display: grid
	grid-template-columns: 16px minmax(0, 1fr)
	column-gap: 7px
	row-gap:    2px                     /* war 7px */
	padding:    5px 8px                 /* war 6px 8px */
	border-bottom: 1px solid var(--color-divider)        /* war --color-panel-muted */
	:hover     background: var(--color-hover-wash)       /* war --color-panel-soft */

.tree-item-name   font-size: var(--font-size-body)      /* 13px, war 13,33px geerbt */
                  font-weight: var(--font-weight-bold)
                  line-height: 1.22
.tree-item-meta   font-size: var(--font-size-caption)   /* 11px, war 10,4px */
                  line-height: 1.2
Statuskreis       11px (war 13px) — passt zur 13px-Zeile
```

🔧 **Die 11px des Statuskreises sind abgeleitet, nicht vom Owner beschlossen.** Begründung: ein
13px-Kreis neben einem 13px-Namen ist höher als dessen Versalhöhe und zieht die Zeile auf. Wer 13px
behalten will, sagt es — dann bleibt die Zeile rund 1px höher. Alle anderen Werte in diesem Block
sind beschlossen.

**Gemessen am Mockup: 48,7px → 42,0px je Zeile, −14%.** Auf derselben Fläche stehen rund 16% mehr
Zeilen.

⚠️ **Die Höhe kommt aus der Luft, nicht aus kleinerer Schrift.** Die Meta-Zeile *wächst*
(10,4 → 11px) und wird besser lesbar. Kompaktheit durch Unterschreiten der Schriftuntergrenze wäre
genau der §12-Verstoß, den dieser Entwurf beseitigt.

💣 **Die 7px waren ein bewusster Beschluss und werden bewusst umgedreht.**
`css/components/region-sync.css:928` sagt: *„Zeilenabstand Name↔Meta einheitlich wie Siedlungen
(sonst Regionen/Wege via `.region-sync__item` nur 2px)"* — jemand hat sie von 2 auf 7 gehoben, um zu
vereinheitlichen. Owner 14.08.2026: **„ja die 7px umdrehen"**. Der alte Kommentar muss mit ersetzt
werden, sonst widerspricht er dem Code.

### Der Statuskreis

🔴 **Der Kreis gehört nur den fünf Karten-Subjekten** (Orte, Territorien, Regionen, Wege,
Kraftlinien). Literatur, Karten und Vorkommen haben kein „liegt auf der Karte" — sie bekommen
keinen. **Das Fehlen ist Information, kein Mangel.**

⚠️ Die Regel darf deshalb nicht an `.tree-item` hängen, sondern an einer Klasse, die nur diese fünf
tragen. Im Mockup heißt sie `st`. Im ersten Wurf stand die `::after`-Regel global und malte den Kreis
auch in die Vorkommen-Liste — vom Owner gesehen, nicht vom Werkzeug.

### Die Griff-Spalte

🔴 **Die 16px-Spalte ist pro LISTE reserviert, nicht pro Zeile.** In der Regionenliste sind manche
Zeilen ziehbar und manche nicht; alle Namen beginnen trotzdem an derselben x-Position
(Owner 14.08.2026: „kein einrücken von Adamentenland"). Listen ganz ohne Ziehen (Literatur, Karten,
Vorkommen) lassen die Spalte weg — dort verschiebt sich nichts.

---

## 4 · Die Bilanzzeile

**Beschluss:** eine Zeile **unter** der Suche — *„aber nur wenn die Bilanzzeile durch die Filterung
beeinflusst wird"* (Owner).

| Zustand | Wortlaut |
|---|---|
| ungefiltert | `1.616 Regionen` |
| gefiltert | `103 von 1.616 Regionen` |

- Das Substantiv ist das Wort des Subjekts; bei Vorkommen das der **gewählten Ansicht** (Fauna,
  Flora, Waren).
- Zahlen mit **Tausenderpunkt**, überall — heute macht das nur Vorkommen.
- ⚠️ Die Zeile ist **nie leer**. Ungefiltert nennt sie die Gesamtzahl. Sonst spränge die Liste beim
  ersten Tastendruck um eine Zeile.
- Sie reagiert auf **Suche UND Filtertrichter**, nicht nur auf die Suche.

Damit verschwindet der Zähler aus der Suchzeile (`#wiki-sync-adv-count`, `#wiki-sync-cm-count`,
`#lore-list-count`). Die Suchzeile trägt danach **nur noch Suchfeld und Filtertrichter** — bei
sieben Subjekten beides, bei Kraftlinien nur das Suchfeld über die volle Breite, weil es heute
keinen Trichter hat und keinen bekommt (§7).

Wortlaut je Subjekt (die gefilterten Zahlen sind Beispiele für die Suche „A"):

| Subjekt | ungefiltert | gefiltert |
|---|---|---|
| Orte | 3.434 Orte | 103 von 3.434 Orten |
| Territorien | 1.038 Territorien | 41 von 1.038 Territorien |
| Regionen | 1.616 Regionen | 103 von 1.616 Regionen |
| Wege | 4.225 Wege | 212 von 4.225 Wegen |
| Kraftlinien | 59 Kraftlinien | 4 von 59 Kraftlinien |
| Literatur | 1.957 Werke | 96 von 1.957 Werken |
| Karten | 523 Karten | 24 von 523 Karten |
| Vorkommen | 1.382 Fauna | 200 von 1.382 Fauna |

💣 **Ein Rechner, nicht acht.** Die acht Listen haben heute acht eigene Renderpfade. Die Bilanzzeile
bekommt **einen** gemeinsamen Erzeuger, der `(Substantiv, sichtbar, gesamt)` nimmt. Acht Kopien
derselben Formel sind genau die Divergenz, die dieser Entwurf beseitigt — sie wäre in drei Monaten
wieder achtfach verschieden.

---

## 5 · Die stille Zeile

Was sich **nicht** durch die Filterung ändert, gehört nicht in die Bilanzzeile. Es bleibt als
stille Zeile **über** der Suche stehen, wo es heute schon steht.

**Beschluss (Owner):** sie benennt ihre Zahlen — *„ja, ‚1851 gesynct' ist klarer, aber nur wenn klar
ist, dass wir unter ‚Regionen' sind"*.

Die Bedingung ist erfüllt: das Wort steht **dreimal** um die stille Zeile herum — in der
Subjektleiste (`#wiki-sync-subject-rail`, das aktive Subjekt hervorgehoben), im Knopf
„*Subjekt* bearbeiten" direkt darüber, und in der Bilanzzeile direkt darunter. Diese Klammer hat
**jedes** der acht Subjekte; der Knopf existiert überall.

| Subjekt | heute | danach | Grund (nachgelesen) |
|---|---|---|---|
| Orte | `3007 offen, 10 zurückgestellt, 793 archiviert` | `3007 **Fälle** offen · 10 zurückgestellt · 793 archiviert` | `review-wiki-sync.js:3641` liest `by_status` der WikiSync-**Fälle**. Es sind keine Orte — das Wort fehlte ganz |
| Regionen | `1851 Regionen · 831 Karten-Labels` | `1851 **gesynct** · 831 Karten-Labels` | `review-region-sync.js:115` nimmt `s.considered` — beim letzten Sync betrachtet, nicht die 1.616 Zeilen der Liste |
| Wege | `601 Wege · 5925 Karten-Segmente` | `601 **gesynct** · 5925 Karten-Segmente` | `review-path-sync.js:185`, dasselbe `s.considered` (601 gegen 4.225 Zeilen) |
| Territorien | `1657 Knoten · 75 Wurzelknoten` | `1657 Knoten **gesynct** · 75 Wurzelknoten` | `review-wiki-sync.js:3653` nimmt `wikiSyncTerritorySummary` — das gesynkte Modell, nicht die Liste |
| Kraftlinien | `59 Kraftlinien · 162 Segmente` | `162 Segmente` | 💣 `review-powerline-list.js:130` nimmt `groups.length` — **genau die Zahl, die künftig in der Bilanzzeile steht.** Sie zweimal untereinander zu schreiben wäre neu und falsch |
| Literatur / Karten / Vorkommen | — | — | haben keine |

🔴 **Keine dieser Änderungen fasst eine Zahl an, nur das Wort daneben.** Die Kraftlinien-Zeile
verliert eine Angabe, die eine Zeile tiefer wortgleich wiederkäme — das ist keine Informations-,
sondern eine Dopplungsentfernung.

---

## 6 · Die drei Kleinigkeiten, die mitgezogen werden

| heute | danach | warum |
|---|---|---|
| `Alle (3434)` gegen `Alle (5.104)` | `Alle (3.434)` | eine Schreibweise für dieselbe Angabe |
| Vorkommen: `26.7.2026, 11:01:16` | `26.07.2026, 11:01` | `renderLoreLastSynced` (`review-wiki-sync.js:2733`) nimmt `toLocaleString("de-DE")` roh; alle sieben anderen gehen durch `formatWikiSyncKindSyncedText` (`:1488`) mit `dateStyle: medium, timeStyle: short`. **Vorkommen ruft künftig denselben Formatierer** |
| Territorien-Meta trennt mit `, ` | `·` | alle sieben anderen trennen mit `·` |

---

## 7 · Fallen

💣 **`css/pages/political-territory-wiki-tree.css` ist QUELLE eines Bauprodukts.**
`tools/scope_editor_css.js` erzeugt daraus (plus zwei weiteren Dateien)
`css/pages/political-territory-editor-inline.css` — dort stehen 25 `tree-item`-Vorkommen. Jede
Änderung an der Quelle braucht **`node tools/scope_editor_css.js`, danach `ASSET_VERSION` in
`js/territory/territory-editor-inline-host.js` hochzählen** (AGENTS.md §7). Ohne Regenerierung
divergieren Panel und Editor; ohne Bump serviert der Browser den alten Editor. Gewacht von
`tools/__tests__/scope-editor-css.test.js`.

💣 **Die Basisregel `.tree-item` (`political-territory-wiki-tree.css:71`) gehört auch dem
Territorien-EDITOR**, nicht nur der WikiSync-Liste. Sie ist `display: inline-flex` mit `cursor: grab`
und trägt den Baum im Editorfenster. **Nur die `#wiki-sync-territory-tree`-Überschreibungen ab Zeile
122 gehören in die gemeinsame Regel** — die Basisregel bleibt unberührt, sonst verändert sich eine
zweite Oberfläche unbeabsichtigt.

💣 **Territorien heute: `inline-grid` + `width: max-content` + keine Trennlinie.** Die Überfahrt ist
nur so breit wie der Text. In der gemeinsamen Form wird die Zeile volle Breite mit Trennlinie.
⚠️ Die **Einrückung des Baums bleibt** — sie ist Information (Hierarchieebene), keine Zierde.

💣 **`region-sync__*` gehört Regionen UND Wegen.** `review-path-sync.js` schreibt `.region-sync__cand`
an 15 Stellen (AGENTS.md §12). Wer nur die Regionenliste prüft, poliert die kleinere Hälfte.

⚠️ **`--color-panel-muted` → `--color-divider` macht die Linie im HELLEN Thema sichtbarer**
(`#f1ece1` gegen `rgba(125,115,96,0.30)`). Das ist beabsichtigt — eine Füllfarbe als Trennlinie war
nie sichtbar genug —, aber es ist im hellen Thema zu prüfen, nicht nur im dunklen.

⚠️ **Kraftlinien bekommt KEINEN Filtertrichter.** Es ist heute die einzige Liste ohne. Einen
hinzuzufügen wäre neue Funktion; die Klammer aus §1 verbietet das. Das Suchfeld nimmt dort die volle
Breite.

⚠️ **Vorkommen behält seinen zweiten Reiterstreifen im Fenster** (`data-lore-dlg-kind`). Der ist
eine separate Oberfläche und wird hier nicht angefasst.

---

## 8 · Tests

Neu:
- `js/review/__tests__/wikisync-list-form.test.js` — 💣 **die Zeilen-Rezeptur steht genau EINMAL.**
  Der Test liest `region-sync.css` und `political-territory-wiki-tree.css` und schlägt fehl, wenn
  `padding`, `row-gap`, `line-height` oder die Statuskreis-Maße in beiden Dateien stehen. Das ist der
  Test, der die Divergenz aus §2 dauerhaft verhindert — ohne ihn wächst sie nach.
- `js/review/__tests__/wikisync-balance-line.test.js` — der gemeinsame Erzeuger: ungefiltert nur die
  Gesamtzahl, gefiltert „X von N ⟨Wort⟩", Tausenderpunkt, nie leer.
- Erweiterung von `sync-synced-ids.test.js` oder neu: Vorkommen nutzt `formatWikiSyncKindSyncedText`.

Bestehend, muss grün bleiben:
- `tools/__tests__/scope-editor-css.test.js` (Bauprodukt == Generatorausgabe)
- 💣 **und das GANZE Testfeld vor dem Push** (AGENTS.md §9): ein roter Test lädt **nichts** hoch, und
  der Fehlschlag vergiftet danach den `?v=`-Stempel.
  `for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done`

---

## 9 · Abnahme — Ablauf, nicht Maß

💣 Eine Prüfseite, die Rechtecke misst, ist kein Beleg (AGENTS.md §9). Vor „fertig" werden diese
Handgriffe **ausgeführt und benannt**, je einmal in **hell und dunkel**:

1. Panel öffnen, durch **alle acht** Subjekte klicken — sieht jede Liste gleich aus?
2. In **jeder** Liste tippen: bewegt sich die Bilanzzeile? Steht das richtige Substantiv da?
3. Filtertrichter öffnen, eine Bedingung setzen: bewegt sich die Bilanzzeile **auch dadurch**?
4. Bei Regionen: beginnen **alle** Namen an derselben x-Position, auch die ziehbaren?
5. Bei Vorkommen/Literatur/Karten: **kein** Statuskreis zu sehen?
6. Bei Territorien: Baum aufklappen — Einrückung intakt, Zeile über die volle Breite?
7. Eine Zeile ziehen (Orte, Regionen) — Ziehen funktioniert noch?
8. Kraftlinien: Suchfeld nimmt die volle Breite, kein Trichter erschienen?

🔴 **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Am 10.08.2026 gingen neun
Mobil-Commits am Stück live und vier Regressionen kamen vom Telefon des Owners zurück. Dieser Umbau
ist in mindestens drei Schritte zu schneiden — Zeilenform / Bilanzzeile / Wortlaut — mit einem Blick
des Owners nach jedem.

⭐ Vor dem Commit `usability-konsistenz`, vor dem Push `usability-design` (AGENTS.md §9).

---

## 10 · Nicht-Ziele

- Keine neue Funktion. Kein Filter für Kraftlinien, keine Sortierung, keine Mehrfachauswahl.
- Keine Zahl ändert ihren Wert.
- Keine Zeile verliert eine Angabe — außer der Kraftlinien-Dopplung aus §5.
- Kein Umbau der Renderpfade. Die acht Listen bleiben acht Module; geteilt werden **die CSS-Regel**
  und **der Bilanzzeilen-Erzeuger**, nicht die Listenlogik.
- `docs/design-language.md` wird nicht erweitert — dieser Umbau *befolgt* sie, er ändert sie nicht.
