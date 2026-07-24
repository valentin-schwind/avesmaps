# Landschaften — Machbarkeitsanalyse

**Stand:** 2026-07-24 · **Status:** Analyse zur Abstimmung, **nichts gebaut**
**Vorgänger:** `docs/oekosystem-*.md` (6 Dokumente, 18.–20.07.), Demo `html/landschaften-modell.html`

> Diese Analyse prüft den erweiterten Auftrag vom 2026-07-24 gegen den tatsächlichen
> Code. Sie ersetzt die Vorarbeit nicht, sondern misst sie nach und benennt, wo der
> neue Auftrag sie umwirft. Alle Zeilenangaben sind am 2026-07-24 verifiziert.

---

## 0. Kurzfassung

**Machbar — aber nicht als ein Vorhaben.** Der Auftrag enthält sieben Features, die
technisch wenig miteinander zu tun haben und deren Risiken sich nicht addieren,
sondern multiplizieren, wenn man sie zusammen baut.

| | Baustein | Machbarkeit | Größter Posten |
|---|---|---|---|
| **A** | Kartenmodus „Landschaften" + Totmannschalter | 🟢 klein | 5 Deklarationsstellen, stummer Rückfall |
| **B** | Drei Zeichenebenen + Kontextmenü | 🟢 mittel | ~1.200 Zeilen Kopie, **null** politische Änderung |
| **C** | Landschaftseditor (3 Spalten) | 🟢 mittel | Designsprache-Spec ist verbindlich |
| **D** | Topographie (Höhenfeld) | 🟢 klein | Mathematik **fertig gemessen**, im Prototyp lauffähig |
| **E** | Vorberechnung Wege×Flächen | 🟡 mittel | STRATO-Chunking, kein Dauerlauf |
| **F** | Terrain auf Kantengewichte | 🟡 heikel | Slice-Falle, Einheitenfalle, Flussrichtung nicht zerschießen |
| **G** | Geschwindigkeitsvektoren (rote Pfeile) | 🟢 klein | Canvas-Overlay-Muster steht |
| **H** | Lore am Routensegment | 🟢 klein | `buildLoreMarkup()` existiert, ist ein Einhänger |
| **I** | Spotlight-Schnittmenge „Todeslianen" | 🟠 **Datenlücke** | `lebensraum` ist Freitext, muss strukturiert werden |
| **J** | A\* für Querfeldein | 🟡 **Architekturbruch** | Routing ist server-primär und cachelos |

**Der teuerste Posten ist kein Code:** rund **500 Polygone** müssen von Hand
gezeichnet werden. Bei 3–5 Minuten je Fläche sind das **25–40 Arbeitsstunden**
reine Zeichenarbeit, verteilt auf die Editoren. Das Feature ist bis dahin
lückenhaft, und keine Optimierung ändert daran etwas.

---

## 1. Bestand — was bereits existiert

### 1.1 Die Datenlage (verifiziert)

| | |
|---|---|
| Landschafts-**Labels** | **529** (Stand 2026-07-17) |
| davon mit Wiki-Verknüpfung | 472 · ohne: 57 |
| Landschafts-**Polygone** | **0** — `feature_type='region'` ist Legacy und inaktiv |
| Wiki-Regionen im Staging | **1.451**, davon **1.141 Aventurien** |
| Wegabschnitte | ~**5.080** |
| Lore-Einträge | **5.104** (1.382 fauna / 1.004 flora / 187 spezies / 2.531 ware) |
| Lore-Ortsverknüpfungen | **7.748** |
| Höhenangaben irgendwo im System | **keine** |

### 1.2 Die 19 Label-Subtypen zerfallen exakt in die drei geforderten Ebenen

`api/_internal/map/features.php:749`

| Ebene | Labels | Subtypen |
|---|---:|---|
| **Derographische Region** | **243** | `region` 140, `insel` 96, `kontinent` 4, `sonstiges` 3 |
| **Topographie** | **166** | `gebirge` 60, `see` 45, `meer` 35, `berggipfel` 23, `kueste` 2, `huegelland` 1 |
| **Vegetation** | **116** | `wald` 66, `suempfe_moore` 26, `steppe` 10, `auenlandschaft` 8, `wueste` 4, `graslandschaft` 2 |
| *(Linie, keine Fläche)* | 4 | `fluss` |

**Das ist der stärkste Beleg für den Drei-Ebenen-Entwurf:** die Dreiteilung liegt
bereits in den Daten, sie wird nicht erfunden. Bis auf `fluss` bleibt kein Rest.

### 1.3 „Derographisch" ist die Wiki-Taxonomie, kein Neologismus

Der Crawl liest `Kategorie:Derographische Region`, `Kategorie:Großregion`,
`Kategorie:Hydroderographie`, `Kategorie:Berg`
(`api/_internal/wiki/regions.php:31–39`). Das Wiki kennt **17 Typ-Subkategorien**.
Der Begriff wird im Projekt bereits verwendet
(`docs/flora-fauna-handelswaren-design.md` §4, Achse A).

> 💣 **Aber:** Das Wiki trennt **nicht** in Region/Vegetation/Topographie. Alles ist
> „Derographische Region" mit einem Freitextfeld `Art=`. Unsere Dreiteilung ist eine
> **projekteigene Verfeinerung** — der Wiki-Key allein sagt nicht, auf welche Ebene
> eine Region gehört. Die Zuordnung muss aus `art` abgeleitet **und** vom Editor
> korrigierbar sein.

### 1.4 Wiederverwendbar (kein Rad neu erfinden)

| Was | Wo | Zustand |
|---|---|---|
| Vertex-Editor (Ecken ziehen, Kante teilen, Löcher) | `js/map-features/map-features-region-*.js`, 13 Dateien | vollständig, **0 politische Referenzen** in den Kernhelfern |
| Boolean-Geometrie (`union`/`intersection`/`difference`) | `map-features-region-boolean-geometry.js:12–20` über `polygon-clipping` | produktiv im Einsatz |
| Höhenfeld-Mathematik (Buckelsumme) | `html/landschaften-modell.html:351–596` | **lauffähig**, JS↔PHP bitgleich geprüft |
| Kontextmenü-Erweiterung ohne `index.html`-Änderung | `map-features-settlement-context-action.js` (Capture-Phase-IIFE) | erprobtes Muster |
| Editor-Shell (Overlay + iframe + postMessage) | `js/review/review-powerline-list.js:11` | 1:1 kopierbar |
| 3-Spalten-Designsprache | `docs/superpowers/specs/2026-07-22-editor-designsprache-design.md` | verbindlich, 905 Zeilen |
| Filter-Trichter | `js/ui/filter-menu.js` (238 Z., abhängigkeitsfrei) | in 6 Editoren im Einsatz |
| Lore-Anzeige mit Lazy-Load | `js/map-features/map-features-lore.js:417` `buildLoreMarkup()` | live |
| Richtungsabhängige Kantenkosten | Flussrichtung, `route-graph-routing.js:146–163` + `client-graph.php:199–225` | **das Vorbild für Steigung** |
| Canvas-Overlay-Muster | `map-features-river-flow-arrows.js` (edit-only Pfeile!) | **exakt die roten Pfeile** |
| Kill-Switch-Speicher | `api/_internal/app/app-setting.php` | ⚠️ default-**an**, wir brauchen default-**aus** |

---

## 2. Was der neue Auftrag gegenüber der Vorarbeit umwirft

Die Vorarbeit ist gut und größtenteils gültig. Drei Entscheidungen kehrt der neue
Auftrag bewusst um — das ist legitim, muss aber ausgesprochen werden, weil die
Begründungen der Vorarbeit dadurch nicht verschwinden.

### 2.1 Zwei Ebenen → drei

Die Vorarbeit argumentiert hart für genau zwei (`oekosystem-editor-leitfaden.md`
§1.1): Topographie ist der *Definitionsbereich eines Generators*, Bedeckung *hält
einen Wert fest*. Die dritte Ebene ist eine **dritte Art von Ding**: sie hält
weder Wert noch Generator, sie hält einen **Namen**. Das ist konsistent — die
Begründung trägt auch für drei.

**Der Preis ist Doppelarbeit.** Der Farindel ist ein `wald`-Label. Er wird zweimal
gezeichnet: als derographische Region (der Name mit Grenze) und als Vegetationszone
(der Bewuchs). Fachlich richtig — der Name kann weiter reichen als der Baumbestand,
und Lichtungen sind Löcher im Bewuchs, nicht im Namen. Praktisch bedeutet es, dass
**282 der 500 Flächen einen nahen Zwilling haben**.

> **Gegenmittel, ohne das es nicht fertig wird:** ein Knopf „Fläche aus
> derographischer Region übernehmen" (Kopie, danach frei bearbeitbar). Nicht als
> Verknüpfung — eine geteilte Geometrie wäre wieder die Falle der geteilten Grenzen,
> die die Vorarbeit zu Recht ausschließt.

### 2.2 „Kein Querfeldein-Gelände" → A\*

`oekosystem-feature-design.md` §5 schließt beides ausdrücklich aus:

> *„Es findet keine Wege. […] Kein Querfeldein-Gelände. Terrain wirkt auf Wege,
> nicht auf freie Bewegung."*

Der neue Auftrag hebt das auf. **Die Begründung von damals bleibt aber gültig für
das Wegenetz:** Straßen liegen seit Jahren, das Modell *bewertet* sie und leitet
keine Pässe ab. A\* ändert daran nichts — es betrifft ausschließlich die
Querfeldein-Kanten, die heute gerade Luftlinien sind. Der Widerspruch ist damit
auflösbar, aber die Grenze muss im Code sichtbar bleiben: **A\* erzeugt niemals
einen Weg, der als `map_features`-Zeile gespeichert wird.**

### 2.3 „Vorerst nur Edit-Mode" → Totmannschalter per URL

Die Vorarbeit hängt den Modus an `IS_EDIT_MODE`. Der neue Auftrag verlangt einen
eigenen Schalter `?landschaften=1`, der **zusätzlich** greift. Das ist strenger und
besser: ein Editor ohne das Flag sieht die Karte wie bisher.

---

## 3. Machbarkeit je Baustein

### A — Kartenmodus + Totmannschalter 🟢

**Es gibt fünf Modi, nicht die im Auftrag genannten.** „Regionen" und „Aggregat"
sind keine Modi — Aggregat ist ein Attribut politischer Territorien, Regionen sind
Labels im Standard-Modus.

`none` „Nur Karte" · `original` „Original" · `political` „Politisch" ·
`deregraphic` „Standard" · `powerlines` „Kraftlinien" → **`landschaften` wird der sechste.**

Fünf Stellen müssen übereinstimmen; fehlt eine, fällt der Modus **stumm** auf
`deregraphic` zurück — kein Fehler, keine Meldung:

| Stelle | Datei:Zeile (verifiziert 2026-07-24) |
|---|---|
| `<option>` | `index.html:1425–1431` |
| Whitelist | `js/map-features/map-features-display-mode.js:155` |
| Icon | `js/config.js:509–516` |
| Standardmodus (**nicht** ändern) | `js/config.js:483` |
| Übersetzung | `js/app/i18n-en.js:79–86` |

**Der Totmannschalter.** `edit/index.php:39–59` reicht die rohe `QUERY_STRING`
unverändert an den Karten-iframe durch (gefiltert werden nur `debugmap`, `edit`,
`_v`). `?landschaften=1` kommt also **ohne jede Änderung an der Shell** an. Es gibt
13 Flags dieser Bauart im Projekt (`?perftrace`, `?canvasvectors`, `?boundarytune` …).

```
const IS_LANDSCHAFTEN_ENABLED = INITIAL_SEARCH_PARAMS.get("landschaften") === "1";
```
neben `IS_EDIT_MODE` (`js/config.js:198`).

> 🔴 **Ein Flag reicht nicht.** Der Schalter muss an **vier** Stellen greifen, sonst
> ist er löchrig:
> 1. **Frontend:** `<option>` entfernen, wenn das Flag fehlt (Muster: `map-features.js:31`)
> 2. **Öffentlicher Lesepfad:** `api/app/*.php` liefert leere Listen — Zeilen dürfen
>    die Box gar nicht verlassen (Muster: `api/app/citymaps.php:41–45`)
> 3. **Routing:** Terrainfaktoren wirken nur bei gesetztem Flag; ohne Flag ist die
>    Route **bitweise identisch** zu heute
> 4. **Payload:** keine Landschaftsdaten in `map-features.php`, wenn das Flag fehlt
>
> Und: die `app_setting`-Tabelle ist bewusst **default-an** gebaut
> (`app-setting.php:14–15`). Unser Schalter ist **default-aus** — er darf dem
> Citymaps-Muster deshalb nicht blind folgen.

**Ein Detail, das leicht übersehen wird:** Landschafts-Labels sind heute an
`mode === "deregraphic"` gekoppelt (`map-features-labels.js:500`). Im
Landschaften-Modus wären sie ohne Änderung unsichtbar — die Editoren zeichneten blind.

**Aufwand:** ~150 Zeilen. **Risiko:** gering, aber der stumme Rückfall verlangt
Browser-Verifikation statt Codelesen.

---

### B — Drei Zeichenebenen + Kontextmenü 🟢

**Kopieren, nicht umbauen.** Die harte Owner-Regel der Vorarbeit gilt weiter: kein
politisches File wird bearbeitet, keines zur Laufzeit aufgerufen. Die Kopierliste
steht in `oekosystem-r2-auftrag.md` §2 — ~1.200 Zeilen aus ~2.300 Zeilen Vorlage.

**Die drei Fallen, alle verifiziert:**

1. **`regionPolygons` nicht mitbenutzen.** `clearRenderedRegionLayers()`
   (`map-features-region-rendering.js:150`) leert das Array bei **jedem** `moveend`
   (Kette: `bootstrap.js:64` → `loadPoliticalTerritoryLayer()` → `:685`). Eine
   fremde Ebene stirbt bei jedem Kartenschwenk. **Eigene Registry.**
2. **`syncRegionVisibility` ist zweimal definiert** —
   `map-features-political-region-visibility.js:1` und
   `map-features-political-territory-loader.js:473`. Der Loader gewinnt und
   überschreibt zeitverzögert dreimal (`:591`). Änderungen an Variante 1 sind
   **still wirkungslos**. Eigene `syncLandschaftenVisibility()` schreiben.
3. **Sieben Vertex-Handler werden zur Laufzeit überschrieben** von
   `map-features-region-vertex-detach-edit.js` — nachgeladen ausgerechnet aus
   `js/routing/route-priority-queue.js:65–72`. Eigene Funktionsnamen wählen, sonst
   überschreibt unsere Ebene die politische oder wird selbst überschrieben.

**Pane:** z-index **201–299** ist frei (`regionsPane` 200, nächste Belegung 300).

**Kontextmenü.** Der Auftrag verlangt „Neues Herrschaftsgebiet" generell abzuschalten
außer im politischen Modus. Das geht **ohne** `index.html` und **ohne** die
`REGION_CONTEXT_ACTIONS`-Konstante anzufassen: eine eigenständige IIFE injiziert ihre
Einträge und fängt Klicks in der **Capture-Phase mit `stopImmediatePropagation()`**
ab, bevor die jQuery-Delegation greift. Zwei erprobte Vorlagen:
`map-features-settlement-context-action.js`, `map-features-derived-boundary-context-action.js`.

Für „Neues Herrschaftsgebiet" genügt ein `hidden`-Toggle am vorhandenen Button,
abhängig von `getSelectedMapLayerMode() === "political"`.

> **Die aktive Ebene entscheidet, wo die Fläche landet** — aber der Auftrag verlangt
> drei *benannte* Einträge („Neue Derographische Region" / „Neue Vegetation" /
> „Neue Topographie"), die den Umschalter **mitschalten**. Das ist der Gegenentwurf
> zur Vorarbeit (`oekosystem-editor-verhalten.md` §4: „keine Nachfrage und keine
> Auswahlliste"). Der neue Weg ist der bessere: er ist selbsterklärend und der
> Editor muss nicht erst umschalten, bevor er anlegt.

**Aufwand:** ~1.400 Zeilen (3 Ebenen statt 2 kosten kaum mehr — `kind` ist eine
Spalte, kein dritter Codepfad). **Risiko:** mittel, Drift zu den politischen
Werkzeugen ist bewusst in Kauf genommen.

---

### C — Landschaftseditor (3 Spalten) 🟢

Die Designsprache ist **verbindlich** und ausformuliert:
`docs/superpowers/specs/2026-07-22-editor-designsprache-design.md`.

> 💣 **`flex: 1 1 0` ist verboten.** `box-sizing: border-box` hebt die flex-basis auf
> `padding+border` an — gemessen 483/458/458 px statt 466,67×3. Vorgeschrieben:
> `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr))` plus
> `min-width: 0; min-height: 0` an den Kindern.
>
> ⚠️ Ausgerechnet das „Vorbild" `wiki-sync-settlement-editor.html:75,78` folgt dieser
> Regel **selbst nicht**. Als Kopiervorlage taugt nur
> `html/wiki-sync-powerline-editor.html:60` — der einzige, der die Spec-Zeile wörtlich trägt.

**Spaltenbelegung laut Auftrag:** Liste (Reiter: Derographische Regionen /
Vegetation / Topographie) — Eigenschaften — Fauna/Flora/Waren.

**Die dritte Spalte ist der interessante Teil.** Sie ist keine Neuentwicklung: der
Vorkommen-Editor existiert (`js/review/review-wiki-sync.js:2291–2960`), schreibt
über `api/edit/map/lore.php` und ist override-sicher (`origin='manual'`,
`status='suppressed'`, `field_origins_json`). Er hat nur **kein Autocomplete** für
das Ortsfeld (`:2762`) — das ist eine bekannte offene Stelle.

**Öffnen:** Overlay + iframe + `postMessage` für die Vorauswahl, exakt wie die
anderen fünf. **Hüllenmaße:** `min(1400px, 100vw−24px) × min(880px, 100vh−24px)`
über `--avm-editor-w/-h` (`css/components/editor-shell.css:24–27`).

**Aufwand:** ~900 Zeilen + Editor-HTML. **Risiko:** gering, das Muster ist sechsfach erprobt.

---

### D — Topographie (Höhenfeld) 🟢

**Der billigste Baustein, weil er fertig ist.** Die Mathematik läuft im Prototyp
und ist durchgemessen:

```
h(x,y) = Σ aₖ · (1 − q²)³        q² = ((x−cxₖ)² + (y−cyₖ)²) / rₖ²,  nur wo q² < 1
```

| Eigenschaft | Wert | Quelle |
|---|---|---|
| Datenmenge je Fläche | **~0,4 KB** | Buckelliste, `oekosystem-instruction.md:141` |
| JS↔PHP-Parität | **20.000 von 20.000 Werten bitgleich** | `:144–147` |
| Sattel zwischen zwei Gipfeln | **38 %** der Gipfelhöhe (TIN: 96 %, TPS: 93 %) | `:150–158` |
| Kosten am Gesamtlauf | **47 ms von 511 ms** — ein Zehntel | `oekosystem-editor-leitfaden.md:240` |

Direkt übernehmbare reine Funktionen aus `html/landschaften-modell.html`:
`cellHash` :402, `level` :413, `buildIndex` :432, `peakWindow` :452, `rawArea` :464,
`buildArea` :491, `hAt` :578, `inPoly` :381, `distEdge` :389.

> 💣 **`sampleRoute()` :637 NICHT übernehmen.** Sie tastet mit fester Schrittweite
> `L/3` ab und **klemmt nicht**. Die Produktivlösung integriert stückweise
> (Gauß-Quadratur an exakt berechenbaren Knickpunkten): **224 Feldauswertungen bei
> Fehler 2,9e-10** gegen **9.765 Auswertungen bei 9,25e-8** naiv — vierzigmal
> billiger *und* genauer.

**Der „1.–8. Pixel"-Regler aus dem Auftrag ist zweierlei, und das muss die
Oberfläche trennen:**

| | `#step` (Mockup :206) | `rMin/8` |
|---|---|---|
| was | Malqualität, füllt S×S-Blöcke einfarbig | **Genauigkeitsgrenze** der Abtastung |
| Wirkung | nur Darstellung | bei `rMin/1`: **37 % Fehler, Vorzeichen der Asymmetrie kippt** |
| gehört in | Ansichts-Menü | Diagnosezeile, nicht verstellbar |

**Gipfel: 1:1, nicht kopiert.** Die 23 `berggipfel`-Labels liegen bereits im
Standard-Layer. Die Höhe gehört ans **Label** (`properties_json`), nicht an die
Fläche. **Es gibt heute nirgends ein Höhenfeld** — nicht in `wiki_region_staging`,
nicht in `properties.wiki_region`, und `{{Infobox Region}}` wird nicht darauf geparst.

⚠️ 23 Gipfel auf 60 Gebirge heißt: zu wenige, um das Gelände allein zu tragen. Der
Gebirgskörper füllt auf — **aber nur außerhalb gesperrter Zonen um vorhandene Wege**
(`oekosystem-instruction.md` §4.3). Sonst legt der Generator einen 9.000-Schritt-Buckel
auf eine seit Jahrhunderten begangene Passstraße.

**Aufwand:** ~500 Zeilen Portierung + 250 Zeilen PHP-Auswerter. **Risiko:** gering.

---

### E — Vorberechnung Wege×Flächen 🟡

**Gemessen** (150 isotrope + 25 anisotrope Gebiete gegen 5.080 Wege):

| Posten | Wert |
|---|---|
| bbox-Vorfilter | 889.000 Tests → **8.329 Paare** (0,9 % kommen durch) |
| Ein-/Austritte | 18,2 Mio Kantentests, **449 ms** |
| Höhenfeld + Tempokurve | 109.461 Auswertungen, **47 ms** |
| **Gesamt Node** | **511 ms** |
| **Gesamt PHP (Faktor 3–10)** | **1,5–5 s** |

Bei den erwarteten ~500 Flächen statt 175 skaliert der bbox-Vorfilter
unterproportional (er wirft ohnehin 99,1 % weg) — realistisch **3–12 s PHP** für
den Vollauf.

> 🔴 **Das ist zu lang für einen einzigen Request.** Der Vorfall
> `dump-holen-on2-fastcgi-kill` zeigt den Fehlermodus: `aborted: read failed` ist ein
> **Plattform-Kill**, kein PHP-Fatal, und er sieht aus wie ein Bug im eigenen Code.
> Der Stapellauf muss dem Muster von `autoget-run.php` folgen: **Sperre, Budget,
> Fortschrittscursor, Kill-Switch, resumierbar**. Der Knopf
> „Landschaftseinflüsse berechnen" löst also einen Client-Loop aus, keinen Dauerlauf.

**Im Betrieb rechnet nur nach, was sich geändert hat:** Fläche gespeichert → alle
Wege in ihrer bbox; Weg geändert → dieser eine Weg; Gipfel verschoben → die
enthaltende Fläche. **Niemals die ganze Karte, niemals pro Routenanfrage.**

**Aufwand:** ~700 Zeilen PHP + Tabelle. **Risiko:** mittel — die Chunking-Grenze
muss an echten Daten kalibriert werden, nicht geschätzt.

---

### F — Terrain auf Kantengewichte 🟡 heikel

**Vorbild ist die Flussrichtung**, die exakt dieses Problem gelöst hat: zwei Kanten
je Weg, unterschiedlich teuer, in beiden Engines identisch geklemmt.

Zielstellen: `route-graph-routing.js:146–163` (Client-Fallback) und
`client-graph.php:199–225` (**Primärpfad**). Der Umbau: von *Entweder/Oder* zu
*„alle Faktoren sammeln, dann multiplizieren"*.

**Drei Fallen, alle dokumentiert und alle still:**

> 💣 **Die Einheitenfalle, die wie Erfolg aussieht.** Die Graph-Distanz steht in
> **Karteneinheiten ohne** `DISTANCE_SCALING_FACTOR` (`config.js:11`, serverseitig
> existiert die Konstante **gar nicht**). Das war nie ein Fehler, weil Dijkstra nur
> *rangiert*. Eine Steigung rangiert nicht — sie ist absolut. Wer die Graph-Distanz
> als Meilen liest, überhöht die Steigung um **3×** und das Signal (F−1) um **23×**.
> Aus einer unbrauchbaren 1,02 wird eine überzeugende 1,46. Regel: die Steigung darf
> **ausschließlich** aus `ds_schritt = ds_karteneinheiten × 3000` gebildet werden,
> und **die Einheit gehört in den Feldnamen**.

> 💣 **Die Slice-Falle — die gefährlichste Stelle im ganzen Vorhaben.** Der
> Strömungsfaktor ist **ein Skalar pro Weg**; ihn auf jedes Teilstück zu kopieren ist
> richtig. Der Terrainfaktor **variiert entlang des Wegs**. Die naheliegende Umsetzung
> stempelt den Ganzweg-Faktor auf jedes Slice. **Das ist still falsch, und die
> vorhandenen Flusstests bleiben dabei grün.** Ein Test mit einem Weg, dessen zwei
> Hälften unterschiedliches Terrain haben, gehört von Anfang an dazu.

> ⚠️ **Die Klemme darf nicht geerbt werden.** Die Flussrichtung klemmt auf
> `[1,0 … 3,0]`. Bergab ist echt schneller als flach (Faktor 0,865 bei 4 % Gefälle).
> Eine Untergrenze von 1,0 verschluckt die halbe Wirkung. Terrain braucht `[0,5 … 4,0]`.

**Zwei Wirkungsgrenzen, die in die Oberfläche müssen:**

1. **Nur im Zeitmodus.** Der Graph wählt `weight = useShortestPath ? distance : time`.
   Bei „kürzester Weg" ist Terrain **vollständig wirkungslos**. Kein Bug, aber
   erklärungsbedürftig.
2. **Doppelzählung.** `Gebirgspass` ist heute schon 2,67× langsamer als eine Straße —
   und die Geschwindigkeitstabelle ist **veröffentlicht** (`transport-speed-info.js`
   zeigt sie den Nutzern). Ein Terrainfaktor obendrauf widerspricht einer Auskunft,
   die wir aktiv geben. Die Ausnahmenliste gehört in die Typ-Tabelle, nicht in den Code.

**Aufwand:** ~400 Zeilen in zwei Engines + Tests. **Risiko:** hoch — hier kann man
die Flussrichtung lautlos zerschießen.

---

### G — Geschwindigkeitsvektoren 🟢

**Das Muster existiert bereits und ist edit-only:**
`js/map-features/map-features-river-flow-arrows.js`, Pane
`avesmapsRiverFlowArrowPane` z-index 639. Es zeichnet heute Fließrichtungspfeile.

Aus dem Prototyp übernehmbar (`landschaften-modell.html:702–710`):
- Abstandsfilter: alle **34 px** ein Pfeil
- **Pfeillänge = Tempo:** `len = 5 + 20 · min(1,3, spd)`
- Tobler: `rel(s) = exp(−3,5 · (|s + 0,05| − 0,05))`

**Neu gegenüber dem Fluss:** bidirektionale Darstellung. Der Auftrag verlangt zwei
Pfeilreihen mit seitlichem Versatz. Der Versatz muss **senkrecht zur Segmentrichtung**
gerechnet werden (Normale = `(−sin α, cos α) · d`), sonst wandern die Pfeile bei
Kurven ineinander.

**Aufwand:** ~250 Zeilen. **Risiko:** gering.

---

### H — Lore am Routensegment 🟢

**Fast geschenkt.** `buildLoreMarkup(placeRef)` (`map-features-lore.js:417`) liefert
sofort einen leeren Container und lädt per DOM-Observer nach. Einbaustelle:
`buildRouteLegPopupHtml(entry)` (`js/routing/route-plan.js:196`), Zeilen-Helfer
`:210`, direkt hinter Zeile 222.

⚠️ **Der Pool-Vorfall vom 2026-07-21 ist der Grund für das Lazy-Load.** Lore-Abrufe
haben den PHP-Pool gesättigt. Deshalb: **nie beim Markup-Bau laden**, immer über den
Observer. Wer das umgeht, wiederholt den Vorfall.

**Was fehlt:** die Brücke Segment → Fläche. Das ist `path_ecosystem` aus Baustein E.
Ohne E kein H.

**Aufwand:** ~120 Zeilen. **Risiko:** gering.

---

### I — Spotlight-Schnittmenge „Todeslianen" 🟠 Datenlücke

**Die beiden Achsen existieren getrennt und sind noch nicht verbunden:**

| Achse | wo sie heute steht | Zustand |
|---|---|---|
| „Maraskan" (Region) | `lore_place.place_wiki_key='maraskan'`, `relation='verbreitung'` | ✅ sauber, 7.748 Kanten |
| „Dschungel" (Vegetationstyp) | `lore_entry.lebensraum` | ❌ **Freitext mit rohem Wiki-Markup** |

`lebensraum` kommt aus dem Infobox-Feld `Vorkommen` (`[[Wald]], [[Eiche]]nwälder`)
und wurde **bewusst nicht** nach `lore_place` geschrieben, weil es kein Ort ist
(`lore-parsing.php:72–81`).

> ✅ **Der Anschluss ist bereits vorgesehen.** `relation='vorkommen'` ist in
> `api/_internal/app/lore-edit.php:121` als gültiger Wert freigeschaltet, wird vom
> Sync aber **nie geschrieben**. Das Feld zu parsen und als `relation='vorkommen'`-Kanten
> abzulegen, ist ein kleiner Umbau an einer Stelle, die dafür gebaut wurde.

**Danach ist die Schnittmenge wohldefiniert:**
```
Regionen    = lore_place WHERE relation IN (verbreitung, herkunft, regionen)
Habitate    = lore_place WHERE relation = 'vorkommen'
Ergebnis    = ⋃(Regionsflächen) ∩ ⋃(Vegetationsflächen der Habitat-Typen)
```

**Drei ehrliche Einschränkungen:**

1. **Die UND-Lesart ist eine Annahme.** Eine Pflanze mit
   `Verbreitung=[[Wald]], [[Maraskan]], [[Albernia]]` kann „Wälder in Maraskan und
   Albernia" oder „alle Wälder, plus ganz Maraskan" meinen. Aus den Links ist das
   nicht ableitbar. **Vorschlag:** Schnittmenge zuerst; ist sie leer, auf die
   Regionsflächen allein zurückfallen und das in der Oberfläche benennen.
2. **Spotlight kennt keine Lore.** Weder der Client-Index
   (`spotlight-search.js:527`) noch `api/app/map-search.php` haben einen
   `lore`-Zweig — und es gäbe heute auch keine bbox zu liefern. Ein neuer
   `kind:"lore"` braucht einen eigenen Auflösungspfad (`:319`) und einen eigenen
   Fokus-Zweig (`spotlight-search-focus.js:34`).
3. **Es gibt keine Messwerte für `polygon-clipping`.** Weder Laufzeiten noch
   Vertex-Grenzen noch Simplification im Repo. Das Projekt umgeht die Frage bisher,
   indem es Ergebnisse **persistiert statt live rechnet** (abgeleitete Außengrenzen).
   Für eine Suchanfrage brauchen wir das Gegenteil. **Diese Messung fehlt und muss
   vor der Zusage „clientseitig schnell genug" erhoben werden.**

**Aufwand:** ~200 Zeilen Parser + ~350 Zeilen Spotlight. **Risiko:** mittel — die
Semantik ist eine Interpretation, keine Ableitung.

---

### J — A\* für Querfeldein 🟡 Architekturbruch

**Der Befund, der alles bestimmt:** Das Routing ist **server-primär und cachelos**.

- `shouldUseServerPrimaryRouting()` (`route-engine.js:40`) liefert `true`, außer bei
  `?clientrouting=1`. Der Client-Graph wird im Normalbetrieb **gar nicht gebaut**
  (`:487` setzt ihn auf `null`).
- Jeder `POST /api/route/` lädt **alle** aktiven `map_features` mit Geometrie und
  Properties, dekodiert jede Zeile per `json_decode`, baut den Graphen über ~5.080
  Wege neu, splittet an inneren Vertices — und wirft ihn danach weg.
- **Kein Caching.** Keine HTTP-Header, kein APCu, keine Datei. Grep über
  `api/_internal/routing/*.php`: null Treffer.
- `via` wird serverseitig **abgelehnt** (`response.php:163`) → eine Route mit
  Wegpunkten wird client-seitig in **N−1 einzelne POSTs** zerlegt
  (`route-engine.js:411–448`), also N−1 vollständige Graphneubauten.

> 🔴 **Daraus folgt: A\* darf niemals auf dem Server laufen.** Das wäre exakt der
> Lastmultiplikator, der den PHP-Pool schon zweimal gesättigt hat.

**Querfeldein heute:** zwei Heuristiken, beide **Luftlinie × 25,0**, beide erzeugen
2-Punkt-`LineString`s:
- Komponentenbrücke (`route-graph-core.js:67`, Client **und** Server)
- Waypoint-Anker (`client-graph.php:472`, **nur Server** — größte Divergenz)

**Vorgeschlagene Architektur — zweistufig:**

| Stufe | wer | was |
|---|---|---|
| 1 | **Server**, unverändert | Dijkstra auf dem Wegenetz; Querfeldein bleibt Luftlinie × 25 als *Schätzer* |
| 2 | **Client**, neu | für jede **tatsächlich benutzte** Querfeldein-Kante ein A\* über ein lokales Raster; ersetzt Geometrie und Zeit |

**Rechenkosten (geschätzt, nicht gemessen):**

| Querfeldein-Distanz | Rasterweite | Zellen im Fenster | A\* mit Binärheap |
|---|---|---:|---|
| 20 KE (60 km) | 0,25 KE (750 m) | ~25.000 | **< 10 ms** |
| 50 KE (150 km) | 0,25 KE | ~160.000 | ~50–100 ms |
| 100 KE (300 km) | 0,25 KE | ~640.000 | ~200–400 ms |

Lange Querfeldein-Strecken gewinnen wegen des 25-fachen Aufschlags praktisch nie —
der typische Fall liegt in der ersten Zeile.

**Datengrundlage passt in den Browser:** Vegetationspolygone (~116 Flächen) plus
Buckellisten (~0,4 KB je Fläche) sind zusammen deutlich unter 1 MB.

> ⚠️ **Der Kompromiss, den ich offenlege:** Wenn der Server mit Luftlinie × 25
> *entscheidet* und der Client danach mit A\* *nachzeichnet*, ist die gewählte Route
> nicht die, die A\* gewählt hätte. Die **Wegwahl bleibt grob, nur die Darstellung
> wird fein**. Konkret: der Planer könnte über einen See routen, den A\* dann
> umfahren muss — die angezeigte Zeit weicht dann von der ab, die die Entscheidung
> begründet hat.
>
> **Gegenmittel, gestuft:** (a) Wasserflächen bereits im Server-Schätzer meiden,
> indem eine Querfeldein-Kante, die ein `meer`/`see`-Polygon schneidet, gar nicht
> erst angelegt wird — das ist ein bbox-Test, kein A\*. (b) Wenn die A\*-Zeit stark
> von der Schätzung abweicht, das in der Etappe benennen statt still zu übernehmen.

**Aufwand:** ~600 Zeilen (A\*-Kern ~200, Rasteraufbau ~250, Anbindung ~150).
**Risiko:** mittel — der Algorithmus ist einfach, der Architekturbruch ist die Kosten.

---

## 4. Wo ich widerspreche

### 4.1 „Bergauf geht schneller wie bergab"

Im Auftrag steht es andersherum. Gemeint ist offensichtlich das Gegenteil; die
Messung sagt: bergab ist echt schneller als flach (Faktor 0,865 bei 4 % Gefälle),
und das Verhältnis bergauf zu bergab ist oberhalb von 5 % Steigung konstant
`exp(0,35) ≈ 1,42`. Ich baue es in dieser Richtung.

### 4.2 Die Schnittmenge ist nicht so eindeutig, wie sie klingt

Siehe I.1. „Todeslianen in den Dschungeln Maraskans" ist im Fließtext eindeutig, in
den geparsten Links nicht. Wer die UND-Lesart hart verdrahtet, produziert leere
Ergebnisse für alle Einträge, deren Habitat und Region sich nicht überlappen — und
das sieht aus wie ein Bug, ist aber die Datenlage.

### 4.3 „Landschaftseinflüsse berechnen" darf kein Knopf mit Fortschrittsbalken sein

Der Auftrag schlägt einen Knopf vor. Richtig — aber die Erfahrung des Projekts sagt:
ein Knopf, der einen mehrsekündigen PHP-Lauf auslöst, wird auf STRATO zum
Plattform-Kill, und der sieht aus wie ein Codefehler. Der Knopf muss einen
**Client-Loop mit Cursor** starten, wie „Dump holen" und „Natur & Waren syncen".

### 4.4 Drei Ebenen bedeuten dreifache Zeichenarbeit — das ist der eigentliche Preis

Siehe 2.1. Ohne einen „Fläche übernehmen"-Knopf wird das Vorhaben nicht fertig. Ich
halte das für die wichtigste einzelne Funktion des ganzen Editors.

### 4.5 Ein Fund am Rande, der nichts mit dem Auftrag zu tun hat

Die fünf `image_license*`-Spalten in `wiki_region_staging` werden **nie beschrieben**
— weder vom Parser (`regions.php:506–526`) noch vom Upsert (`:581–618`). Sie werden
aber gelesen und ins Label kopiert. Folge: `image_license_status` ist immer leer, und
`map-features-labels.js:293–297` blendet **jedes** Regionsbild aus. Das erklärt den
Vermerk „Lizenz ungeprüft → ausgeblendet" in der Vorarbeit. Kein Landschaften-Thema,
aber ein echter Bug.

---

## 5. Offene Entscheidungen

| # | Frage | Meine Empfehlung |
|---|---|---|
| 1 | Wohin gehören `see`/`meer`/`kueste` — Topographie oder derographische Region? | **Beides erlauben.** Ein Meer hat einen Namen *und* ist Wasser. Der Editor entscheidet je Fall. |
| 2 | Bekommt die derographische Region einen Tempo-Faktor? | **Nein.** Sie ist namensgebend. Tempo gehört an Vegetation und Topographie. Sonst wird sie zur vierten Bedeckungsebene. |
| 3 | UND oder ODER bei der Lore-Schnittmenge? | **UND mit Rückfall auf ODER**, sichtbar benannt. |
| 4 | Rasterweite für A\* | **0,25 Karteneinheiten (750 m)**, adaptiv gröber ab 50 KE Distanz. |
| 5 | Werden A\*-Ergebnisse zwischengespeichert? | **Nein, vorerst.** Erst messen. Ein Cache ohne Messung ist Aberglaube. |
| 6 | Wo lebt die Typ-Tabelle (Vokabular + Faktoren)? | **In der DB, editorpflegbar** — nicht in `js/config.js`. Spielbalance gehört den Editoren. |
| 7 | Reihenfolge der Abnahmen | siehe §6 |

---

## 6. Vorgeschlagener Schnitt

Jede Stufe endet mit etwas, das **angesehen und abgenommen** werden kann. Erst danach
beginnt die nächste.

| Stufe | Inhalt | fertig, wenn | grobe Größe |
|---|---|---|---|
| **L0** | Totmannschalter + Modus, leere Ebene | Umschalten zeigt die Karte vollständig; ohne `?landschaften=1` ist alles wie heute | ~150 Z. |
| **L1** | Tabellen + Endpoint + Repository | Fläche per API anlegen/lesen/ändern/soft-löschen, **ohne Karte** verifizierbar | ~700 Z. |
| **L2** | Darstellung der drei Ebenen | Flächen erscheinen, überleben Kartenschwenk und Moduswechsel | ~450 Z. |
| **L3** | Zeichnen + Kontextmenü + Ebenenumschalter | Owner zeichnet einen Wald; `git status` zeigt **keine** politische Datei | ~950 Z. |
| **L4** | **Abnahme.** Owner zeichnet drei echte Flächen | es fühlt sich gut an — sonst wird L3 nachgeschärft | kein Code |
| **L5** | Landschaftseditor (3 Spalten) + Wiki-Zuweisung | Liste, Eigenschaften, Fauna/Flora/Waren; „Fläche übernehmen" | ~900 Z. |
| **L6** | Topographie: Höhenfeld + Gipfelhöhen | ein Gebirge zeigt ein plausibles Profil, Wächter warnt bei zu schmaler Fläche | ~750 Z. |
| **L7** | Vorberechnung + „Landschaftseinflüsse berechnen" | `path_ecosystem` gefüllt, resumierbar, kein Plattform-Kill | ~700 Z. |
| **L8** | Anzeige: „Führt durch" + Lore am Segment | Etappen-Popup zeigt Namen und Flora, auch bei Teilrouten | ~200 Z. |
| **L9** | Terrain auf Kantengewichte + Geschwindigkeitsvektoren | Route ändert Zeit mit Flag an, ist **bitweise identisch** mit Flag aus | ~650 Z. |
| **L10** | Spotlight-Schnittmenge | „Todeslianen" zeigt das bernsteinfarbene Polygon | ~550 Z. |
| **L11** | A\* für Querfeldein | Querfeldein umfährt Wasser und meidet Steigung | ~600 Z. |

**Summe:** ~6.600 Zeilen neu, ~400 geändert. Die Reihenfolge ist nicht beliebig:
L7 ist Voraussetzung für L8 und L9; L1 für alles.

> **L0–L4 sind der ehrliche Prüfstein.** Wenn das Zeichnen sich nicht gut anfühlt,
> ist alles danach verlorene Arbeit — es gäbe schlicht keine Flächen.

---

## 7. Was diese Analyse nicht beantwortet

- **Laufzeit von `polygon-clipping`** bei realistischen Multipolygonen. Muss gemessen
  werden, bevor „clientseitig" zugesagt wird (Baustein I).
- **Knoten- und Kantenzahl des Routing-Graphen.** Nirgends dokumentiert.
  🔴 **NICHT über `GET /api/route/?diagnostic=graph-data` messen.** Dieser Endpunkt
  baut acht Graphen und ruft viermal eine offene Doppelschleife über alle Knoten
  auf — gemessen **2,8 s bei 5.000 Knoten, 11,3 s bei 10.000**. Er ist
  unauthentifiziert, `api/route/` hat kein `.htaccess`, und es gibt projektweit kein
  Rate-Limiting. Das ist die Signatur des Pool-Vorfalls vom 2026-07-17. Die Zahl
  gehört stattdessen aus einer einzelnen `SELECT COUNT(*)`-Abfrage oder aus einem
  geschützten Zweig. *(Diese Empfehlung stand hier zuerst falsch herum — siehe §8.)*
- **Ob `ebene` als Typ seinen Platz verdient.** Nur, wenn es sich anders verhält als
  „normal". Entscheidet der erste Abnehmer.
- **Wie viele Buckel der Gebirgskörper bekommt.** Wegen der Jensen-Steuer kein
  Schönheitsregler: die Zahl bewegt den Faktor monoton und kippt zwischen 2 und 4
  Buckeln das Vorzeichen der Asymmetrie. Muss festgelegt und dokumentiert werden.

---

## 8. Revision nach adversarialer PrÃ¼fung (2026-07-24, abends)

Drei Agenten haben diese Analyse aus drei feindlichen Perspektiven gegengelesen â€”
als **Redakteur** (wer die 500 FlÃ¤chen zeichnen muss), als **Backend-Verantwortlicher**
(wer STRATO am Leben hÃ¤lt) und als **ProjekteigentÃ¼mer** (wer der KI misstraut).
Sie haben mehr gefunden als die sechs Erkundungsagenten davor, darunter acht Fehler
in dieser Analyse selbst.

### 8.1 Fehler in den Abschnitten oben â€” hier korrigiert

| Wo | stand da | richtig ist |
|---|---|---|
| Â§7 | â€žKnotenzahl live Ã¼ber `?diagnostic=graph-data` abrufbar" | ðŸ”´ **GefÃ¤hrlich.** 8 Graphbauten + 4Ã— O(nÂ²), gemessen 11,3 s bei 10.000 Knoten, unauthentifiziert, kein Rate-Limit. Oben korrigiert. |
| Â§E | bbox-Vorfilter â€žskaliert unterproportional" | **Linear.** Die Quote bleibt bei 99 %, die Zahl der Ãœberlebenden wÃ¤chst mit: 8.329 â†’ ~24.000 Paare bei ~500 FlÃ¤chen. |
| Â§E | Vollauf â€ž3â€“12 s PHP" | **Gemessen 14,7 s** auf Desktop-PHP 8.5 (269 ns je Segment-Schnitt-Test). Auf geteiltem FPM **30â€“45 s**. Der PHPâ†”Node-Faktor ist **10,9**, nicht 3â€“10. |
| Â§A | `app_setting` sei â€ždefault-an gebaut", man dÃ¼rfe dem Muster nicht folgen | **Falsch.** `avesmapsAppSettingGet(PDO, key, $default)` nimmt den Default als **Argument**. Die PolaritÃ¤t ist ein Zeichen, keine Umbaustelle. |
| Â§1.2 | â€ždie 19 Subtypen zerfallen exakt in drei Ebenen" | Die Tabelle listet **17**. `tundra` (â†’ Vegetation) und `ebene` (â†’ Topographie) fehlen; beide haben heute 0 Labels. Die Zuordnung stimmt, die VollzÃ¤hligkeit war zu selbstsicher formuliert. |
| Â§F | zwei Slice-Stellen | **Drei.** `avesmapsBuildClientRouteSubPathConnection` (`client-graph.php:534â€“553`) rekonstruiert die Geschwindigkeit aus `distance/time` der Elternkante â€” sobald `time` einen Terrainfaktor trÃ¤gt, erbt jedes TeilstÃ¼ck den Ganzweg-Mittelwert. Greift nur auf Landwegen, also genau dort, wo Terrain wirkt. Bei FlÃ¼ssen fÃ¤llt es nicht auf, weil Flusswege nie verankert werden. |
| Â§J | â€žQuerfeldein-Kanten sind vollstÃ¤ndig vorberechenbar" | **Unbelegt.** Die Zahl der real entstehenden Strecken ist nicht gemessen. Bleibt bei der Client-LÃ¶sung, bis gemessen. |
| Â§2.1 | Quellen | **Fehlten komplett.** Siehe 8.4. |

### 8.2 ðŸ’£ Es gibt kein Zeichenwerkzeug (Redakteur)

`createRegionAt()` (`map-features-region-crud.js:158`) legt ein **Sechseck mit
Radius 10** an und speichert sofort. Mehr gibt es nicht. Das Klick-fÃ¼r-Klick-Werkzeug
mit mitlaufender Vorschau existiert im Haus â€” `map-features-path-creation.js:58` â€”,
ist aber an Wege gebunden.

Weitere Befunde am Bestandswerkzeug:

- **Strg+Klick auf eine Kante setzt vier Ecken, nicht eine** (`subdivideRegionEditHoveredEdge(4)`,
  `map-features-region-edit-edge-controls.js:250`). Das Verhaltensdokument
  (`oekosystem-editor-verhalten.md` Â§5) behauptet â€žeine" â€” es beschreibt ein Werkzeug,
  mit dem noch niemand gearbeitet hat.
- **Kein Undo, nirgends im Projekt.** Grep Ã¼ber `js/`: null Treffer. Ein Doppelklick
  lÃ¶scht eine Ecke **und speichert**.
- **Jede Ecke ist ein eigener POST plus ein Toast** (2,2 s Standzeit, ein Platz).
  Ein Waldrand mit 40 Ecken sind 40 SchreibvorgÃ¤nge auf STRATO und 40 Blinker.
- **Sechseck-Leichen:** `createRegionAt` speichert beim Anlegen. Rechtsklick, MenÃ¼,
  Escape â€” und eine echte FlÃ¤che liegt im Bestand.

> ðŸ”´ **Damit ist Â§6 â€žL4: Owner zeichnet drei FlÃ¤chen" der falsche PrÃ¼fstein.**
> Drei FlÃ¤chen fÃ¼hlen sich mit einem Sechseck und ohne Undo gut an. Dreihundert nicht.
> Richtig ist: **zwanzig FlÃ¤chen in einer Sitzung, und die Zeit wird gestoppt.**
> Bei 5 Minuten je FlÃ¤che sind es 42 Stunden und es wird nie fertig. Bei 2 Minuten
> sind es 17 und es wird.

### 8.3 Ein Drittel der Handarbeit ist ableitbar (Redakteur)

Â§0 behauptet, an den 25â€“40 Stunden Ã¤ndere â€žkeine Optimierung etwas". Das stimmt nicht.
Die ausgelieferten Kacheln tragen die Information bereits: eine Farbschwelle trennt
Land und Wasser praktisch fehlerfrei. Die Kachel-Pipeline hat beides **getrennt
erzeugt** â€” `13_make_landmass_rgba.py`, `24_make_water_rgba_from_original_sea_mask.py`,
und `27_polygonize_town_tiles.py` verwandelt bereits Raster in Polygone (cv2-Konturen).

| Ebene | Labels | danach |
|---|---:|---|
| `insel`, `see`, `kueste`, `kontinent` | **147** | entfallen |
| `meer` | 35 | ein Ozeanpolygon, nur noch zerschneiden |
| `gebirge` | 60 | Startpolygon statt Sechseck |

Wald, Sumpf, Steppe, Grasland gehen so **nicht** â€” der ganze Kontinent ist grÃ¼n.

> âš ï¸ **`avesmaps-map-processing/dsa5-atlas/` NICHT anfassen.** Ulisses-Material;
> keine Fan-Guideline deckt einen Geometrie-Import.

### 8.4 ðŸ”´ Quellen laufen Ã¼ber `feature_sources` â€” verbindlich

LandschaftsflÃ¤chen werden Wiki-Regionen zugewiesen und erben Namen **und Beleg**.
In dieser Analyse stand dazu **kein Wort** â€” und das ist exakt die LÃ¼cke, durch die
am 2026-07-21 `lore_source` entstand, gegen eine Regel, die bereits dastand
(AGENTS.md Â§5).

> **LandschaftsflÃ¤chen benutzen `sources` + `feature_sources` mit einem neuen
> `entity_type`. `CREATE TABLE ecosystem_source` ist verboten.** Der Whitelist-Eintrag
> ist eine Zeile in `api/edit/map/feature-sources.php` und eine in
> `api/app/feature-sources.php`.

### 8.5 ðŸ”´ Warum eigene Tabellen und nicht `map_features` â€” der Grund, der fehlte

`map_features` kennt bereits Landschaftspolygone: `avesmapsCreateRegionFeature`
(`api/_internal/map/features.php:2255`) schreibt `feature_type='region'` mit exakt
den 19 Landschafts-Subtypen. Eine eigene Tabelle daneben ist trotzdem richtig â€” aus
einem Grund, der in dieser Analyse **nicht stand** und deshalb ungeschÃ¼tzt war:

> `avesmapsCreateRegionFeature` ruft `avesmapsNextMapRevision()`. Jede Revision
> invalidiert die **~14-MB-Payload fÃ¼r alle Clients** (`api/app/map-features.php:57`).
> Der Zeichenfeldzug sind 25â€“40 Stunden mit ~2.000 SpeichervorgÃ¤ngen. Jeder davon
> zwÃ¤nge die gesamte Besucherschaft durch den vollen Payload-Pfad â€” drei weitere
> Volltabellen-Scans, Wappen-Gate, Quellenkatalog, gzip von 14 MB.
> **Das wÃ¤re eine geplante Pool-SÃ¤ttigung.**

Das Argument steht wÃ¶rtlich im Code, `api/app/citymaps.php:13â€“14`.

**Verbindlich:** eigener Endpunkt `GET /api/app/ecosystem-areas.php` (Muster
`api/app/citymaps.php`), **eigener** RevisionszÃ¤hler `ecosystem_revision`, **eigener**
ETag. Ein FlÃ¤chen-Save fasst `map_revision` **niemals** an. Kill-Switch serverseitig
**vor** dem Read.

Nutzlast gemessen: ~650 KB roh fÃ¼r 500 FlÃ¤chen Ã  50 Ecken (+5 % auf 14 MB, gzipped
+10â€“20 %) â€” die GrÃ¶ÃŸe allein wÃ¤re Ã¼berlebbar, die Invalidierung nicht.

### 8.6 ðŸ”´ Der Routing-Pfad ist heute schon Ã¼berlastet

`avesmapsFindClientLocationAtPathEndpoint()` (`client-graph.php:620â€“633`) durchsucht
das gesamte Ortsarray **linear**, aufgerufen 2Ã— je Weg plus in
`avesmapsCollectClientSeaBoundLocationNames`. 5.080 Wege Ã— 2 Enden Ã— ~3.949 Orte:

| Variante | gemessen |
|---|---|
| realistisch (Treffer gleichverteilt) | **983 ms** |
| Vollscan (alle FehlschlÃ¤ge) | **1.941 ms** |
| **Gitter-Hash (0,5er-Raster)** | **15 ms** |

Das ist **heute** der dominante Posten jedes `POST /api/route/`. Der Fix sind ~20
Zeilen, Faktor **65**, und Terrain wÃ¼rde diesen Posten multiplizieren.

Drei weitere Posten am selben Pfad: `via` bleibt abgelehnt â†’ Nâˆ’1 volle Graphneubauten
(`response.php:163`); Dijkstra hat weder Abbruch am Ziel noch Settled-Set
(`client-graph.php:743`); `map-data.php:41` lÃ¤dt alle Zeilen ohne Typfilter.
Speicher gemessen: 9.029 dekodierte Features = **62 MB resident**, Peak 152 MB â€”
und `api/route/` ruft als **einziger** schwerer Pfad nie `set_time_limit`.

> **Ein Graph-Cache ist kein Mittel.** Gemessen: `json_decode` 81 ms (+62 MB),
> `unserialize` 63 ms (+64 MB). Ein Cache-Treffer spart **18 ms** und kostet dasselbe
> GedÃ¤chtnis; bei `memory_limit=128M` ist der Testlauf **gestorben**. Wenn Cache,
> dann das fertige **Routenergebnis** nach `(map_revision, from, to, optimize, hash(transports))`.

### 8.7 Tabellen und Indizes â€” konkret

`path_ecosystem` ist **kein Problem**: ~16.000 Zeilen realistisch (Obergrenze 72.000),
~60 B je Zeile â†’ **1,0â€“4,6 MB**. Passt komplett in den Buffer-Pool.

> ðŸ’£ **Die eine Falle:** `path_id` als `public_id VARCHAR(36)` speichern (die Gewohnheit
> des Projekts) macht den PK 41 statt 13 Bytes, die Zeile ~100 statt 60, und jeder
> SekundÃ¤rindex schleppt ihn mit â€” Faktor 3 fÃ¼r nichts. `path_ecosystem` ist
> **abgeleiteter Cache**, kein fachlicher Link; abgeleitete Daten dÃ¼rfen auf die
> interne `map_features.id` zeigen.

- PK **`(path_id, area_id, seq)`**, nicht Surrogat: er ist der natÃ¼rliche SchlÃ¼ssel,
  macht die Neuberechnung idempotent, und InnoDB clustert danach â†’ der Bulk-Read fÃ¼rs
  Routing liest sequenziell in Wegreihenfolge.
- `KEY (area_id)` â€” â€žFlÃ¤che geÃ¤ndert â†’ welche Wege sind stale?" muss indiziert sein.
- `ecosystem_area.geometry_revision` â€” ohne sie ist die einzig korrekte Aktion nach
  jeder Ã„nderung ein Volllauf. Der Satz â€žim Betrieb rechnet nur nach, was sich geÃ¤ndert
  hat" ist sonst nicht einlÃ¶sbar.
- Zusatztabelle `path_ecosystem_state (path_id, computed_revision)` â€” damit ist
  â€žwelche Wege sind fÃ¤llig" ein indiziertes `WHERE computed_revision < :cur`, und der
  Fortschritt lebt in der DB statt im Browser-Tab.

**bbox-Vorfilter gehÃ¶rt in SQL**, als Join Ã¼ber die vorhandenen `DECIMAL`-Spalten,
ohne jedes GIS â€” er erledigt 2,54 Mio Tests im Index und liefert gleichzeitig die
stabile Cursor-Ordnung. **Kein `ST_Intersects`**: die Geometrie lÃ¤ge zweimal vor
(JSON + `GEOMETRY`) und kÃ¶nnte auseinanderlaufen, und der Stapellauf braucht ohnehin
keinen Booleschen Wert, sondern die **BogenlÃ¤ngen-Parameter** des Ein- und Austritts,
die keine MySQL-Funktion liefert.

### 8.8 Dem Stapellauf fehlen fÃ¼nf Dinge, die alle schon existieren

| fehlt | vorhandenes Muster |
|---|---|
| Sperre | `avesmapsAutogetGuardedStep()`, `api/_internal/app/autoget-run.php:86â€“99` â€” feature-agnostisch, unit-getestet |
| Zeitbudget | `AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS = 4.0`. **Nicht** die 28 s des Dumps â€” die sind fÃ¼r **I/O** kalibriert; ein 28-s-CPU-Schritt ist exakt `aborted: read failed` |
| `@set_time_limit(BUDGET + 15)` | 12 Fundstellen, ausnahmslos alle Batch-Endpunkte |
| serverseitiger Cursor | in der DB, nicht vom Client zurÃ¼ckgereicht. **Kein `OFFSET`** â€” Ã¼ber eine sich Ã¤ndernde Menge Ã¼berspringt es Zeilen |
| Idempotenz | `DELETE WHERE path_id=:id` + Insert je Weg, eine Transaktion |

> ðŸ’£ **Die Leasing-Falle**, wÃ¶rtlich in `api/_internal/app/citymaps.php:319â€“328`:
> *â€žleasing rows and then hitting a time budget makes the due-query see nothing,
> report remaining=0, and call a half-finished run done."* Zustand wird **je Weg
> direkt nach dessen Berechnung** geschrieben, nie vorab reserviert.

### 8.9 ðŸ”´ Der ParitÃ¤tstest ist heute schon unerfÃ¼llbar

Die Vorarbeit verlangt â€ždieselbe Route Ã¼ber beide Engines, identisches Ergebnis".
Das kann nicht gelingen: der **Server splittet Wege an inneren Knoten**
(`client-graph.php:148â€“157`), der **Client nicht** (`route-graph-routing.js:109`
nimmt nur erste und letzte Koordinate). Der Client-Split wurde am 2026-06-20 gebaut
(`d7bdb7aa`) und **zurÃ¼ckgerollt** (`1f9e0b9e`).

Der Terrainfaktor gilt Ã¼ber den Meilenbereich einer Kante â€” auf dem Server ein Slice,
auf dem Client der ganze Weg. **Dieselben vorberechneten Intervalle ergeben
verschiedene Faktoren, strukturell.** Vor der Routing-Stufe einmal messen; weicht es
schon heute ab, wird die ParitÃ¤tsforderung **gestrichen und ersetzt** durch â€žder
Client-Fallback ist eine SchÃ¤tzung und wird so benannt". Eine gestrichene Forderung
ist ehrlich; eine grÃ¼n gemeldete unerfÃ¼llbare ist die Sorte LÃ¼ge, die dieses Projekt
schon zweimal Wochen gekostet hat.

> ðŸª¤ **Und der Fixture-Test ist die Eintrittskarte, nicht der Nachweis.** Am
> 2026-06-20 hat genau diese Testbauweise versagt: *â€žMein isolierter Mock-Test
> (nur Aâ†’Kâ†’B) hat das NICHT gefunden."* Der Fehler saÃŸ in der Wechselwirkung
> Split â†” Querfeldein â†” Kreuzungs-Umbenennung. Der Nachweis ist ein **Netzlauf**:
> dieselben 5â€“10 echten Routen vor und nach dem Umbau, Flag aus, Byte-Vergleich.

### 8.10 ðŸ’£ 159 globale Namen werden beim Kopieren scharf

20 Dateien `map-features-region-*.js`, **4.104 Zeilen**, **159 Top-Level-Deklarationen**.
Kopiert werden ~1.200 Zeilen, also grob **60â€“90 Namen**. `index.html` lÃ¤dt **164**
klassische `<script>`-Tags in einen gemeinsamen globalen Scope.

PrÃ¤zedenzfall `cb082ab5` (2026-07-10): *ein* doppelter Top-Level-`const` â†’ die zweite
Datei wirft beim Laden â†’ ihre `window.*`-Exporte entstehen nie â†’ ein Panel rendert
leer, der Endpoint war zu 100 % gesund. **Node-Tests fangen das prinzipiell nicht**
(dort ist jede Datei ein isoliertes Modul).

Hier schÃ¤rfer als damals: `map-features-region-vertex-detach-edit.js` Ã¼berschreibt
sieben Handler **zur Laufzeit** â€” ein gleichnamiger Kopie-Handler killt nicht die
eigene Ebene, sondern **die politische**, und zwar erst beim Ziehen einer Ecke.

**Gegenmittel ist ein Skript, kein Review-Punkt:** nach jeder Kopierstufe jeden neuen
Top-Level-Namen gegen `grep` Ã¼ber `js/` prÃ¼fen, plus Browser-Konsole auf `SyntaxError`
und `typeof window.<neuerGlobal>`.

### 8.11 Weitere Befunde, kurz

- **`?landschaften=1` ist ein Client-Flag und kann keinen Lesepfad sichern.** Es ist
  kopierbar, und anders als `?perftrace=1` verÃ¤ndert es **Reisezeiten**. Nur die
  serverseitige `app_setting`-PrÃ¼fung ist eine Sicherung.
- **Der Verlauf-Sync hÃ¤ngt an `from`/`to`.** `client-graph.php:207â€“211`:
  *â€žfrom/to fields stay the STORED orientation on both variants â€” the verlauf flow
  derivation's chain walk depends on that."* Wer sie anfasst, um Terrain-Intervalle
  zu passen, zerschieÃŸt still ein Feature, dessen Backfill (913 Segmente) noch offen ist.
- **Die Gipfel-Sichtbarkeitsregel fehlt im Schnitt.** Nicht-wiki-verknÃ¼pfte
  `berggipfel` sollen im Standard-Layer unsichtbar werden â€” eine Ã„nderung an
  **Ã¶ffentlicher Bestandsdarstellung**, die niemand mit Landschaften verbindet.
  Eigene Stufe, eigene Abnahme.
- **Es gibt keine lokale Datenbank.** `api/config.local.php` existiert nicht; jeder
  DB-Pfad ist lokal grundsÃ¤tzlich unprÃ¼fbar. `tools/` wird nicht deployt (Allowlist:
  nur `tools/wikidump`).
- **Die Gipfel-HÃ¶hen stehen in keiner Rechnung.** 23 Gipfel auf 60 Gebirge heiÃŸt:
  zusÃ¤tzlich 100â€“200 Arbeitspunkte setzen **und HÃ¶hen recherchieren**, Ã  1â€“2 Minuten.
  Nicht in den 25â€“40 Stunden enthalten.
- **Ohne â€žbraucht keine FlÃ¤che" wird der ZÃ¤hler nie 100 %.** 57 Labels ohne
  Wiki-Link, `kontinent` und `sonstiges` wollen vermutlich gar keine FlÃ¤che. Es
  braucht eine **durable Entscheidung** â€” dasselbe Prinzip wie im Konfliktzentrum
  (Befund gerechnet, Entscheidung gespeichert).
- **Die dritte Editorspalte ist kein EinhÃ¤nger.** Der Vorkommen-Editor steckt in
  einer 3.192-Zeilen-Datei (`review-wiki-sync.js`), die gerade in einer anderen
  Sitzung **modifiziert** ist.
- **`polygon-clipping` gemessen** (eigener Benchmark, korreliert gezeichnete RÃ¤nder):
  Schnittmenge 200 Ecken **1,8 ms**, 800 Ecken **6,5 ms**; 30 Regionen vereinigen +
  schneiden **15,4 ms**; 120 Territorien vereinigen **47,7 ms**. Clientseitig
  unkritisch. Nutzlast: 500 FlÃ¤chen Ã  200 Ecken = **3,7 MB**, Ã  800 Ecken = **14,8 MB**
  â†’ nach dem Grenzimport muss vereinfacht werden (Douglas-Peucker).
  Bei absichtlich degenerierter Geometrie **wirft** die Library â€” `validateRegionBooleanResult`
  und `try/catch` gehÃ¶ren von Anfang an dazu, nicht nachgerÃ¼stet.

### 8.12 Empfehlungen zum Zuschnitt

| | Empfehlung | BegrÃ¼ndung |
|---|---|---|
| **A\*** | auf Stufe 2 belassen (Client, on demand). **ZusÃ¤tzlich sofort:** eine Querfeldein-Kante, die ein `meer`/`see`-Polygon schneidet, wird gar nicht erst angelegt | ~50 Zeilen, liefert 90 % des spÃ¼rbaren Nutzens |
| **Spotlight-Schnittmenge** | **vertagen** | vier Unbekannte in einer Stufe, sinnvoll erst wenn die VegetationsflÃ¤chen gezeichnet sind |
| **Derographische Regionen** | Struktur fÃ¼r drei Ebenen bauen (`kind` ist eine Spalte), aber **nicht in der ersten Zeichenrunde pflegen** | ohne Abnehmer ist es Vorratsarbeit; Vegetation und Topographie speisen das Routing |
| **`ebene` als Typ** | streichen, bis ein Faktor ihn rechtfertigt | sonst eine FlÃ¤che, die nichts tut |
| **Stufenschnitt** | L3 â†’ L3a/L3b, L5 â†’ L5a/L5b, L9 â†’ L9a/L9b; Messstufe zwischen L4 und L5; Zeichenpause als eigene Zeile | die genannten Stufen sind zu groÃŸ fÃ¼r eine Sitzung |
| **SitzungsfÃ¼hrung** | eine Sitzung je Stufe, neue Sitzung nach jeder Abnahme, eigener Worktree | belegt: 204 MB / 75 Kompaktierungen / 11 von 48 Commits waren Regressionen desselben Tages |

**Realistischer Gesamtumfang** nach dieser PrÃ¼fung: **~4.500â€“5.500 Zeilen** fÃ¼r die
tragenden Bausteine (statt 6.600 fÃ¼r alle), plus **~600 Zeilen Tests**, plus ~40
i18n-SchlÃ¼ssel â€” verteilt auf **15â€“17 Sitzungen** statt 12, plus die Zeichenpause.

> **Der ehrlichste Satz bleibt:** L0â€“L4 sind der PrÃ¼fstein. ErgÃ¤nzt um die Messstufe
> sind sie **das ganze erste Vorhaben**. Alles danach wird neu beauftragt, wenn echte
> FlÃ¤chen auf der Karte liegen und sich gut anfÃ¼hlen. Die ZwÃ¶lf-Stufen-Tabelle ist
> nicht der Plan, sondern die Versuchung.
