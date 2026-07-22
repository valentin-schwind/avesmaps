# Editor-Navigation: von vier Ebenen auf zwei (Design)

**Datum:** 2026-07-22 · **Auftraggeber:** Owner · **Maßstab:** `docs/design-language.md`,
AGENTS.md §12 · **Muster:** `verify-editor-nav.html` (Wurzelverzeichnis, untracked, zieht
die echten Tokens — alle Maße darin sind **gemessen**, nicht geschätzt) ·
**Status:** Entwurf am lebenden Muster in sieben Runden abgestimmt

**Schwester-Spec:** `2026-07-22-editor-designsprache-design.md` regelt, wie die Editor-
*Fenster* aussehen. Diese hier regelt, wie man sie *findet*. Überschneidungsfrei.

---

## 1. Ausgangslage

Das Editor-Panel ist auf vier Reiterebenen gewachsen:

```
Meldungen ──── Community Meldungen │ Bewertungen │ Mails ── Empfangen │ Gesendet
Änderungen
WikiSync ───── [Dump holen] [Konflikte] [Kraftlinien syncen]
          └─── Siedlungen │ Territorien │ Regionen │ Wege │ Materialien
                                                           └── Abenteuer │ Karten │ Natur & Waren
                                                                                    └── Fauna │ Flora │ Waren
                                                             (im Dialog nochmal: Fauna│Flora│Waren│Spezies)
Status ─────── Besucher │ Editoren
```

### 1.1 Die Ursache ist Breite, nicht Ordnung

Gemessen am lebenden Panel (`min(400px, …)`, `css/features/review-panel.css:14`):

| | |
|---|---|
| Innenbreite der Reiterzeile | **378 px** |
| Siedlungen · Territorien · Regionen · Wege · Materialien | **356 px** |
| frei | **22 px** |
| ein sechster Reiter („Abenteuer") bräuchte | **81 px** |
| **fehlt** | **59 px** → bricht um |

Eine waagerechte Reiterzeile hat bei Panelbreite ein hartes Budget von rund fünf kurzen
Wörtern. Jedes Ding darüber hinaus musste sich eine Ebene tiefer verstecken. Drei Belege,
die alle dasselbe sagen:

- **`index.html:383`** — der Reiter heißt „Materialien", der Schlüssel heißt weiter
  `adventures`. Der Kommentar sagt selbst, er halte Abenteuer *und* Karten, „seit der
  Karten-Sync dazukam". **„Materialien" ist ein Behälter, der aus Platzmangel entstand.**
- **`index.html:361`** — Kraftlinien bekam *gar keinen* Reiter; ihr Sync sitzt notgedrungen
  oben bei den globalen Aktionen. Ein Subjekt, dem der Platz verweigert wurde.
- **`index.html:439` vs. `825`** — `data-lore-kind` (Panel) und `data-lore-dlg-kind`
  (Dialog) sind **dieselben Reiter zweimal**. Einmal in einer 400px-Spalte, einmal im
  Vollbild, wo sie tatsächlich funktionieren.

### 1.2 Zwei Namen, die Aufzählungen sind

„Materialien" und „Natur & Waren" geben sich als Oberbegriffe aus, sind aber Listen dessen,
was gerade hineinpasste. Beide verschwinden (§4).

### 1.3 Ein Knopf, der lügt

`index.html:524` beschriftet einen Knopf mit **„Territorien bearbeiten"**. Er öffnet keinen
Editor:

```js
// js/app/bootstrap.js:275
$("#wiki-sync-territories").on("click", () => startWikiSyncTerritoryRun());
```

Er **startet einen Sync**. Gehört mit dieser Spec geradegezogen (§6).

---

## 2. Die Regel

Sechs Zeilen, die die Tiefe dauerhaft bei zwei halten:

> 1. **Ebene 1 = Bereich.** Meldungen · Änderungen · WikiSync · Status. Bleibt.
> 2. **Ebene 2 = Subjekt, senkrecht.** Kein Breitenbudget, also kein Verstecken.
> 3. **Verben** in fester Reihenfolge: Syncen, dann Bearbeiten. Kein Editor →
>    Syncen allein, nie ein toter Knopf daneben.
> 4. **Wie ein Subjekt sich unterteilt:** gleiche Felder → Facette im Filtermenü;
>    eigene Felder → Reiter über der Liste.
> 5. **Eine Reiterzeile, nie eine zweite** — und sie gehört der *Liste*, nicht der
>    Navigation.
> 6. **Was keinem Subjekt gehört** → globale Kachel oben. **Was ein Subjekt enthält**
>    → sein Fenster. **Neues Feature = eine Zeile mehr, nie eine neue Kategorie.**

Zeile 5 ist die Unterscheidung, an der der heutige Editor gescheitert ist: eine
Navigations-Reiterzeile, die umbricht, erzeugt eine neue Ebene; eine Listen-Reiterzeile,
die umbricht, kostet eine Zeile Höhe. Deshalb darf es genau eine geben, und zwar die untere.

---

## 3. Zielaufbau

```
┌ Editor ──────────────────────────────────────────┐
│ Map: SQL | Rev 31790 | 10.635 Features | Handbuch│
├──────────────────────────────────────────────────┤
│ Meldungen │ Änderungen │[WikiSync]│ Status       │  Ebene 1, unverändert
├──────────────────────────────────────────────────┤
│ [📥 Dump holen        ] [⚖️ Konflikte ]          │  global, unverändert
├──────────────────────────────────────────────────┤
│ Siedlungen 4.128 22.07. │ Territorien 1.204 …    │  Ebene 2, ZWEISPALTIG
│ Regionen     318 21.07. │ Wege        3.721 …    │  4 Zeilen statt 8
│ Kraftlinien   61 21.07. │ Abenteuer   1.352 …    │  gemessen: 126px (vorher 249)
│ Karten       433 22.07. │[Vorkommen]  4.917 …    │
├──────────────────────────────────────────────────┤
│         Syncen          │      Bearbeiten        │  Verben des Subjekts
├──────────────────────────────────────────────────┤
│ [Vorkommen suchen …]                  [Filter ▾] │  Suche + Facetten
│ Alle · Fauna · Flora · Waren · Spezies           │  DIE Reiterzeile der Liste
│ ────────────────────────────────────────────     │
│ … Liste …                                        │
└──────────────────────────────────────────────────┘
```

### 3.1 Auswahl (Ebene 2)

- Zweispaltiges Raster, acht Subjekte in vier Zeilen. **Gemessen 126 px** statt 249 px
  einspaltig — gut eine halbe Panelhöhe zurück für die Liste.
- Je Zeile: **Name · Anzahl · Sync-Datum**. Damit ist das Panel nebenbei ein Statusbrett;
  man sieht alle acht Stände gleichzeitig, ohne zu klicken.
- Aktiv-Kennung ist ein `border-left` in `--color-accent`. **Der Spaltentrenner darf
  deshalb NICHT `border-left` benutzen** — dort `box-shadow: inset 1px 0 0` verwenden,
  sonst überschreibt er die Aktiv-Kennung.

### 3.2 Verbzeile

Feste Reihenfolge **Syncen · Bearbeiten**, gleich breite Spalten. Vier der acht Subjekte
haben keinen Listen-Editor (§5) — dort trägt **Syncen die Zeile allein** (volle Breite).

Bewusst **kein ausgegrauter Platzhalter**. Das wurde im Entwurf zweimal versucht (bei
„Konflikte" und beim Modulzustand) und beide Male verworfen: ein toter Knopf erklärt sich
nicht selbst und lädt zum Draufklicken ein.

### 3.3 Suche + Filter

Eine Zeile: Suchfeld (`flex: 1`) + **`Filter ▾`**. Die Filterkomponente **existiert bereits**
(`css/features/review-panel.css:930`, `.type-filter` mit `__section-title`) — sie wird
angehängt, nicht nachgebaut. Gemessen passt beides in eine Zeile (308 px + 64 px).

- **Die Zahl aktiver Filter steht IM Knopf** („Filter (2) ▾", Rand in `--color-accent`).
  Kein Chip-Band darunter: das Menü liegt als Overlay über der Liste, **die Liste rückt
  beim Filtern nicht nach unten** (nachgemessen). Entspricht der Hausregel „Status gehört
  in den Knopf".
- **Subjekt- oder Reiterwechsel verwirft die Auswahl.** Die Facetten des einen Subjekts
  gelten fürs nächste nicht — ein stehengebliebener „Genre: Horror"-Filter auf der
  Siedlungsliste wäre ein unsichtbarer Lügner.

### 3.4 Die eine Reiterzeile

Steht zwischen Suchzeile und Liste (so wie heute schon, `index.html:396–400`), nutzt die
bestehende `.region-sync__viewtab`-Optik, **darf umbrechen**. Inhalt kommt aus dem Subjekt:

- hat es Arten → seine Arten, mit führendem „Alle"
- hat es Sichten → seine Sichten
- hat es keins von beidem → **keine Zeile**, statt einer erfundenen leeren „Alle"

---

## 4. Umbenennungen

| alt | neu | Begründung |
|---|---|---|
| „Materialien" | *entfällt* | Behälter aus Platzmangel; seine drei Inhalte werden Subjekte |
| „Natur & Waren" | **Vorkommen** | siehe unten |

**Warum „Vorkommen":** jede Auswahlzeile trägt eine Zahl, benennt also eine zählbare Menge.
„4.917 Vorkommen" geht, „4.917 Landeskunde" (der andere Kandidat) nicht. Außerdem stünde
„Landeskunde" direkt unter „Regionen" und klänge nach demselben. Owner-Formulierung, die den
Begriff trägt: *Dinge, die an Orten und Gebieten aufgelistet werden, ohne selbst etwas zu tun.*

**Der interne Schlüssel bleibt `lore`.** Gleiche Begründung wie bei
`data-wiki-sync-panel-tab="adventures"` (`index.html:383`): Umbenennen bringt nichts außer
der Chance, eine Stelle zu vergessen. Anders als dort meinen Label und Schlüssel hier
dasselbe.

### 4.1 Namenskollision „Art" — muss mitgelöst werden

`js/review/review-wiki-sync.js:2167` beschriftet das Feld `gruppe` als **„Art"** (Wert z. B.
`[[Fisch]]`). Die neue Filterfacette für Fauna/Flora/Waren/Spezies heißt ebenfalls „Art" →
zwei verschiedene Dinge, ein Name, ein Panel.

**Lösung: das Feld umbenennen, nicht die Facette.** Die Spalte heißt `gruppe`, der Inhalt
*ist* eine Gruppe — das Label „Art" widerspricht seiner eigenen Spalte. Also Feld →
**„Gruppe"**, Facette bleibt **„Art"**. Das ist eine Korrektur, kein Ausweichen.
**Editor-sichtbar ⇒ `html/editor-handbuch.html` im selben Commit** (AGENTS.md §9); die
betroffene Stelle ist die Aufzählung in `editor-handbuch.html:876`.

---

## 5. Bestandsaufnahme je Subjekt

Grundlage jeder Zeile ist Code, nicht Vermutung.

| Subjekt | Syncen | Listen-Editor | Listen-Reiter (real) | Filter (real) |
|---|---|---|---|---|
| Siedlungen | `wiki-sync-sync-settlement` | ✅ `settlement-editor-open` | Alle · Platziert · Fehlt | Typ · Kontinent · Quelle |
| Territorien | `wiki-sync-territories` ⚠️ | ❌ | Alle · Platziert · Fehlt | Hierarchie · … |
| Regionen | `wiki-sync-sync-region` | ❌ | Alle · Platziert · Fehlt | Typ · Kontinent · Quelle |
| Wege | `wiki-sync-sync-path` | ❌ | + Konflikte · Flussrichtung unbekannt | Typ · Kontinent · Quelle |
| Kraftlinien | `wiki-sync-powerlines-sync` | ❌ | — | — |
| Abenteuer | `wiki-sync-sync-adventure` | ✅ `adventure-editor-open` | — | — |
| Karten | (Citymap-Sync) | ✅ `citymaps-editor-open` | — | — |
| Vorkommen | `wiki-sync-sync-lore` | ✅ `wiki-sync-lore-open` | Arten (§5.2) | Art · Quelle |

⚠️ = als „bearbeiten" beschriftet, startet aber einen Sync (§1.3).

Reiter-Quellen: `review-settlement-list.js:203`, `review-wiki-sync.js:314`,
`review-region-sync.js:211`, `review-path-sync.js:252`.

**Die „Konflikte" bei Wegen sind kein Widerspruch zu §2 Zeile 6.** Das sind die
Verlauf-**Altfälle** (`wiki_sync_cases`), die tatsächlich einem Weg gehören — nicht die
berechneten Regeln des Konfliktzentrums. Beides darf nebeneinander stehen.

### 5.1 Warum „Konflikte" kein Subjekt-Verb ist

`api/_internal/conflicts/store.php:12`, wörtlich:

> Identity is (rule_id, fingerprint) — NOT (rule_id, object). A conflict can have parties of
> different types (a place and a territory claiming one wiki article), **so no single object
> owns it.**

Der Test führt es vor: „Heldenweiler" kollidiert als Siedlung × Territorium. Ein
„Konflikte"-Knopf in der Zeile *Siedlungen* müsste beantworten, wem der Fall gehört — die
Antwort ist „beiden". Konflikte bleiben die **globale Kachel**.

### 5.2 Warum die Arten von Vorkommen Reiter bekommen und Siedlungstypen nicht

Beide sind Unterscheidungsspalten (`lore_entry.kind` bzw. `feature_subtype`). Der Unterschied
steht in `js/review/review-wiki-sync.js:2168`:

```js
+ (entry.kind === "ware" ? loreFieldRow(entry, "typ", "Gegenstandstyp") : "")
```

Ein Feld, das **nur bei einer Art** gerendert wird. Eine Facette „Gegenstandstyp" *kann* es
in der gemischten Liste nicht geben — bei 2.386 von 4.917 Einträgen wäre sie leer. Erst die
Vorauswahl macht sie möglich. Siedlungstypen unterscheiden sich in keinem Feld, also
Facette.

**Das ist der objektive Test aus §2 Zeile 4** und die Schranke, die verhindert, dass jedes
Subjekt Unterreiter bekommt.

### 5.3 Spezies

Öffentlich abgeschaltet (`index.html:819`, Owner 2026-07-21: das Wiki-Feld „Regionen" der
Infobox Spezies ist zu schlecht gepflegt). Bleibt als **ausgegrauter Reiter** stehen — nicht
öffentlich, aber bearbeitbar. **Der Grund gehört in den Tooltip**, wortgleich aus dem
bestehenden `title`: eine ausgegraute Fläche ohne Begründung wird irgendwann „aufräumend"
umgelegt.

---

## 6. Owner-Entscheide (nicht neu verhandeln)

- **Auswahl zweispaltig.**
- **Arten von Vorkommen sind Listen-Reiter, keine Auswahlzeilen.** Als eingerückte Zeilen
  schoben sie Knöpfe und Liste um vier Zeilen nach unten.
- **Kein Modulzustand („AN/AUS", „kein Schalter") in der Auswahl.** Wurde gebaut und wieder
  verworfen: *„das verwirrt nur"*. Einziger markierter Sonderfall bleibt Spezies, ausgegraut.
- **„Vorkommen"**, Schlüssel bleibt `lore`.
- **Kein toter „Bearbeiten"-Knopf** bei Subjekten ohne Editor.
- **Umgeschaltet wird im Fenster, nicht in der Liste.** Der Klick auf eine Zeile heißt
  „auswählen"; ihn zusätzlich mit „abschalten" zu belegen wäre ein Fehlklick mit
  öffentlicher Wirkung.

---

## 7. Nicht Teil dieser Spec

- **Kill-Switches für Siedlungen / Territorien / Regionen / Wege / Kraftlinien.** Wurde
  besprochen und bewusst herausgenommen. Falls später gewünscht: Muster ist
  `adventures_enabled` (self-healing `app_setting`, Default AN, nur gespeichertes `'0'` =
  aus — kein Owner-SQL nötig).
- **Die vier fehlenden Listen-Editoren.** Diese Spec stellt nur richtig *dar*, dass es sie
  nicht gibt.
- **Das Aussehen der Editor-Fenster** — das ist `2026-07-22-editor-designsprache-design.md`.
- **Meldungen / Änderungen / Status.** Dieselbe Regel räumt sie auf (Mails
  „Empfangen/Gesendet" wird ein Filter statt einer Ebene), aber WikiSync ist der schlimmste
  Fall und geht zuerst. Eigener Schritt.

---

## 8. Umsetzung

Reihenfolge so gewählt, dass nach jedem Schritt ein benutzbares Panel steht.

1. **Auswahl bauen.** `.wiki-sync-panel__tabs` (Ebene 2) durch das zweispaltige Raster
   ersetzen; Zähler und Sync-Datum je Zeile aus den bestehenden Endpunkten
   (`avesmapsWikiDumpSyncKindLastSynced` liefert alle Arten). „Materialien" fällt weg,
   Abenteuer/Karten/Vorkommen werden Geschwister, Kraftlinien bekommt seine Zeile.
2. **Verbzeile.** Syncen · Bearbeiten aus der Tabelle §5; Syncen allein, wo kein Editor ist.
   **Dabei `wiki-sync-territories` von „Territorien bearbeiten" auf „Syncen" umbeschriften**
   (§1.3) — Handbuch im selben Commit.
3. **Reiterzeile vereinheitlichen.** Die vorhandenen `#*-sync-tabs`-Hosts auf einen
   gemeinsamen Container ziehen; für Vorkommen die Arten aus `data-lore-kind` dorthin
   umhängen und die Panel-Kopie ersatzlos löschen (die Dialog-Reiter
   `data-lore-dlg-kind` **bleiben**).
4. **Filter nachrüsten** für Abenteuer, Karten, Vorkommen, Kraftlinien — vorhandene
   `.type-filter`-Komponente, Facetten als Daten je Subjekt.
5. **Umbenennungen** „Vorkommen" + Feld „Art" → „Gruppe" (§4.1), Handbuch im selben Commit.
6. **Reiter-Kaskade nachziehen.** `REVIEW_TAB_FAMILIES` (`js/ui/ui-controls.js:541`) verliert
   `data-material-subtab`, bekommt die neue Auswahl. **⚠️ Invariante: keine Werteliste
   hartkodieren** — gültig ist, was als Knopf im DOM steht. Test
   `tools/paths/test-review-tab-cascade.mjs` mitziehen.

**Asset-Version:** `index.html` wird gestempelt, also nichts von Hand. Nur falls Schritt 3
dynamisch geladene Editor-Assets berührt, `ASSET_VERSION` in
`js/territory/territory-editor-inline-host.js` bumpen (AGENTS.md §7).

---

## 9. Prüfung

Am Muster bereits nachgewiesen (`verify-editor-nav.html`, per `javascript_tool` gemessen):

- Auswahl 2 Spalten × 4 Zeilen, **126 px**
- Verbzeile: 4 Subjekte mit zwei Verben, 4 mit „Syncen" allein über die volle Breite
- Vorkommen-Reiter `Alle · Fauna · Flora · Waren · Spezies(?)`, Spezies ausgegraut
- Facettenwechsel: Alle → `Art`, **Waren → `Gegenstandstyp`** (und „Art" verschwindet)
- Wege-Reiter alle fünf, Umbruch auf zwei Zeilen (zulässig, §2 Zeile 5)
- Filtermenü überlagert; die Liste rückt beim Filtern nicht nach unten
- Panel läuft in keiner Kombination über

Am Produkt zu prüfen:

- Ohne Login per `?edit=1` (Panel rendert, Schreibpfade 401) — siehe die bewährte Technik in
  `docs/superpowers/specs/2026-07-17-menuband-konsistenz-abenteuer-kartensammlung-design.md`.
- **🔧 Owner:** ein echter Durchgang je Subjekt (Syncen auslösen, Editor öffnen, Reiter und
  Filter umschalten) — die Sync-Läufe brauchen einen angemeldeten Editor und einen frischen
  Dump.

---

## 10. Offene Fragen

- **Regionen:** hat nach Codelage ebenfalls keinen Listen-Editor, wurde vom Owner aber nicht
  in der Liste der Sync-only-Subjekte genannt. Vor Schritt 2 kurz bestätigen.
- **Filterfacetten** für Kraftlinien (Stärke, Affinität), Abenteuer (Art, Genre, Regeln,
  Herkunft) und Karten (Zugang, Vorschau, Herkunft) sind aus den echten Infobox-Feldern
  abgeleitet, aber **nicht mit dem Owner abgestimmt**. Im Muster mit `NEU` markiert.
- **Merken des zuletzt gewählten Reiters je Subjekt** — nicht Teil dieser Spec. Falls sich
  zeigt, dass Redakteure fast immer innerhalb einer Art arbeiten, ist das die billige
  Antwort, nicht eine weitere Ebene.
