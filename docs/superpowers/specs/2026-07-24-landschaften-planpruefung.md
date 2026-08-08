# Landschaften — Prüfung von Plan und Analyse gegen den Code

**Stand:** 2026-07-24, abends · **Status:** Prüfbericht, **nichts gebaut, nichts geändert**
**Geprüfte Dokumente:**
- `docs/superpowers/plans/2026-07-24-landschaften.md` (der Plan)
- `docs/superpowers/specs/2026-07-24-landschaften-machbarkeitsanalyse.md` (inkl. §8)

**Prüfstand:** HEAD `8b0224eb`. Über 100 Fundstellen einzeln nachgeschlagen, die
Existenzbehauptungen einzeln belegt, die Zahlen live nachgerechnet (ein einziger
`curl` auf `GET /api/app/map-features.php`). Die teuren Diagnose-Endpunkte
(`?diagnostic=graph-data`, `?diagnostic=route-name-data`) wurden **nicht** gerufen.

> **Gesamturteil:** Das Fundament ist gut — die allermeisten Fundstellen sind
> zeilengenau, gerade die schwer zu findenden. Die Fehler sitzen aber
> **konzentriert in genau der Aufgabe, mit der jemand anfangen würde**, und V0.1
> hat die Eigenschaft, dass sein Fehler durch seinen eigenen Test hindurchläuft.
> **V0 ist so nicht baubar. V1 fast — bis auf V1.2.**

---

## 1. Blocker — vor dem ersten Handgriff zu beheben

### 1.1 🔴 V0.1 ist funktionsunfähig (vier Fehler in einer Aufgabe)

**(a) Der Index-Bauer liest einen Schlüssel, den es nicht gibt.**
Der Plan schreibt `$location['coordinates']`. Ein Ortssatz entsteht in
`api/_internal/routing/network-data.php:134–141` und hat genau
`id, public_id, name, subtype, geometry, properties` — **kein `coordinates`**.
Die Koordinaten kommen erst in `api/_internal/routing/client-graph.php:53–54`
als `route_x` / `route_y` dazu.

Folge: `continue` für jeden Ort → Index **leer** → jeder Weg fällt bei
`client-graph.php:105` raus → **Graph ohne Kanten** → jede Route meldet
„nicht gefunden".

💣 Der Test des Plans baut seine Fixtures selbst mit `'coordinates' => [...]` —
er wäre **grün**, während der Produktivpfad tot ist. Das ist exakt die
Fehlerklasse, vor der die Analyse in §8.9 warnt.

**(b) Die Signatur kann nicht bleiben.**
`avesmapsFindClientLocationAtPathEndpoint(array $locations, array $point)`
(`client-graph.php:620`) hat **zwei** Parameter. Der Plan-Test ruft mit **drei**
und behauptet im selben Abschnitt, die Signatur bleibe „**exakt**".

**(c) Es gibt eine dritte Aufrufstelle.**
`client-graph.php:400`, in `avesmapsCollectClientSeaBoundLocationNames`.
Der Plan nennt nur `:103` / `:104`. Bei geänderter Signatur bricht `:400` —
PHP-Fatal, nicht Testfehler.

**(d) Die Einbaustelle stimmt nicht, und es gibt den Index schon.**
`:98` ist der *Verbraucher*. Gebaut wird bei `client-graph.php:61–67` — und
dort steht bereits ein `$locationCoordinateIndex` (exakte Schlüssel
`%.5f:%.5f`, für die Innenknoten-Splits und `avesmapsCollectClientSeaBound…`).
Der Plan würde einen **zweiten** Index mit nahezu gleichem Namen daneben bauen.

**Nebenbei:** `avesmapsFindClientLocationLinearForTest` wird von keinem Schritt
erzeugt. Und der maßgebliche Toleranzwert ist
`AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD` (`client-graph.php:5`), **nicht**
`THRESHOLD` in `js/config.js:2`, das PHP nie liest. Beide sind zufällig `0.5`;
der Kommentar bei `js/config.js:3–6` nennt aber `0.15` und ist selbst veraltet.

### 1.2 🔴 „Kein Undo, nirgends im Projekt" ist falsch — und Strg+Z ist belegt

| | |
|---|---|
| `undoLastChangeLogEntry()` | `js/review/review-panels-change-log.js:307` |
| `undoChangeLogEntry()` + Serverruf | `:321` (`undoMapAuditChange` / `undoPoliticalAuditChange`) |
| „Rückgängig"-Knopf je Eintrag | `:139–144` |
| **Tastenkürzel Strg/Cmd+Z, nur Edit-Modus** | `:364–376` |
| gebunden im globalen Keydown | `js/app/bootstrap.js:431` |

V3.3 will „Undo-Stapel, 20 Schritte, **Strg+Z**". Diese Taste ist im Edit-Modus
vergeben und wird bei `:373–374` mit `preventDefault()` + `stopPropagation()`
konsumiert.

### 1.3 🔴 Es sind acht Modus-Stellen, nicht fünf

Die drei zusätzlichen sind alle real und alle unerwähnt:

| # | Stelle | Wirkung |
|---|---|---|
| 6 | `js/map-features/map-features-display-mode.js:212–234` (`applyFrontendLayerModeDefaults`, Aufzählung `:232`) | harmlos — **aber nur**, weil `:213` bei `IS_EDIT_MODE` vorher aussteigt |
| 7 | `js/map-features/map-features-boundary-canvas-overlay.js:485` — `BOUNDARY_OVERLAY_MODES = ["political","deregraphic"]`, Abbruch `:487–489` | Grenz-Canvas zeichnet im neuen Modus **nichts** |
| 8 | `js/map-features/map-features-political-territory-loader.js:15` — `TERRITORY_BOUNDARY_MODES = ["political","deregraphic"]`, geprüft `:556` und `:600` | Territoriumsdaten werden im neuen Modus **gar nicht geladen** und beim Schwenken nicht nachgeladen |

**Damit ist V1.2 in seinem Kernversprechen nicht einlösbar** („Beim Zeichnen von
Maraskan will man die Territoriengrenzen **sehen**"). Zwei Sperren müssen aufgehen;
der Plan nennt nur die Datei der einen und keine der beiden Konstanten.

**Nebeneffekt:** Falle 1 des Plans („`regionPolygons` wird bei **jedem** `moveend`
geleert") greift im **neuen** Modus gar nicht — `schedulePoliticalTerritoryLayerReload`
steigt bei `:600` aus. Der Rat (eigene Registry) bleibt richtig; die Begründung
trägt nur in `political` / `deregraphic`.

### 1.4 🔴 Drei Dinge werden benutzt, die keine Aufgabe erzeugt

| gebraucht von | Name | erzeugt von |
|---|---|---|
| Globale Regel 3, V2.2 (ETag) | `ecosystem_revision` | **niemandem** — V2.1's DDL hat weder Tabelle noch Spalte noch `avesmapsNextEcosystemRevision()` |
| V2.2 (Kill-Switch-Lesen) | `app_setting['ecosystem_enabled']` | **niemandem** — kein Schritt legt den Schalter um. Der Lesepfad bleibt dauerhaft leer, V3 ist nicht abnehmbar |
| V2.3 (`promote_trial`), V4 („Ein Knopf") | die Oberfläche dafür | **niemandem** — V4 ist ausdrücklich „kein Code" |

### 1.5 🔴 V3 kann sein eigenes Fertigkriterium nicht erfüllen

V3 ist fertig, wenn eine Fläche „**Reload und Kartenschwenk überlebt**".
V1.3 legt Pane + Registry an, V3.2 zeichnet **neu**, V2.2 liefert JSON.
Es gibt **keine Aufgabe, die vorhandene Flächen lädt und rendert.**

Die Analyse hatte dafür eine eigene Stufe (§6, **L2** „Darstellung der drei
Ebenen", ~450 Z.) — im Plan-Schnitt ist sie ersatzlos verschwunden, und die
Selbstprüfung („A → V1, B → V3 … **Keine Lücke**") merkt es nicht.

### 1.6 🔴 Plan und Analyse widersprechen sich an der entscheidenden Stelle

Analyse §2.1: „Gegenmittel, **ohne das es nicht fertig wird**: ein Knopf ‚Fläche
aus derographischer Region übernehmen'". §4.4: „**die wichtigste einzelne
Funktion des ganzen Editors**".

Der Plan schiebt ihn nach **V7** — hinter die V4-Abnahme, die über das ganze
Vorhaben entscheidet. Damit misst V4 die Zeichenzeit **ohne** das Werkzeug, das
die 282 Zwillingsflächen halbieren soll. Die Zahl, an der alles hängt, wird unter
falschen Bedingungen erhoben.

---

## 2. Weitere Fehler in V0

### 2.1 V0.5 lässt drei teure Endpunkte offen und übersieht einen Zweig

Es gibt **sechs** Diagnose-Zweige, nicht fünf:

| Zweig | Zeile | ruft `avesmapsLoadRouteMapData` |
|---|---|---|
| `map-data` | `api/route/index.php:25` | **ja (`:26`)** |
| `network-data` | `:46` | **ja (`:47`)** |
| **`location-node-data`** | **`:64`** | **ja (`:70`)** — im Plan **gar nicht erwähnt** |
| `route-name-data` | `:104` | ja (`:133`) |
| `dijkstra-data` | `:126` | ja (`:157`) |
| `graph-data` | `:156` | ja + acht Graphbauten (`:160–…`) |

Die Behauptung „die **leichten** (`map-data`, `network-data`) bleiben offen" ist
falsch: beide lösen denselben Volltabellen-Scan mit `json_decode` über ~10.700
Features aus, den §8.6 mit **62 MB resident / Peak 152 MB** gemessen hat. Nach
V0.5 blieben **drei** unauthentifizierte Endpunkte offen, die je einen Volllauf
auslösen — genau die Signatur, gegen die V0.5 antritt.

**Außerdem:** V0.5 ändert öffentliches Verhalten (heute 200, danach 401). Das ist
vermutlich richtig, aber es ist eine Bestandsänderung und gehört als solche
abgenommen — nicht unter „auch dann richtig, wenn die Landschaften nie kommen".

### 2.2 V0.2 ist nicht so einfach wie die Vorlage

Der Client-Graph-Dijkstra (`client-graph.php:743–763`) trägt
`['node' => …, 'transport' => …]` im Heap und liest `$currentDistance` aus
`$distances[$currentNode]`, **nicht** aus der Priorität. Bei `minimizeTransfers`
(`:753`) hängen die Kantenkosten **vom eingehenden Transportmittel** ab —
`$distances[$node]` ist dann kein gültiges Label. Ein Settled-Set, das nur nach
Knoten schlüsselt, **ändert das Ergebnis**, wenn „Umstiege minimieren" an ist.

Die Vorlage `graph.php:522` hat gar kein Transportkonzept und taugt nicht als
Beweis. Der Plan behandelt beide als gleich.

### 2.3 V0.3 ist 1,5 %, nicht „Entlastung"

Powerlines sind **162 von 10.746 Zeilen = 1,51 %**. Und die Begründung ist halb
falsch: `network-data.php:92` wirft Powerlines weg, **`:76` wirft Labels weg**.

### 2.4 V2.4 sind vier Zeilen, nicht zwei

Die Whitelists tragen heute **sieben** Typen inklusive `powerline`
(`api/edit/map/feature-sources.php:49`, `api/app/feature-sources.php:33`) —
AGENTS.md §5 kennt nur sechs. Die **Fehlermeldungen** bei `:52` bzw. `:36`
zählen die Typen im Klartext auf und nennen `powerline` schon nicht.

---

## 3. Falsche Fundstellen (Inhalt ≠ Zeile)

| Behauptung | steht dort wirklich | richtig ist |
|---|---|---|
| Analyse §1.2: 19 Label-Subtypen bei `features.php:749` | Powerline-Zweig | **`api/_internal/map/features.php:767`** (19 Einträge, inkl. `tundra`/`ebene`) |
| Analyse §8.5: `avesmapsCreateRegionFeature` `:2255` | anderer Code | **`:2273`**; der `avesmapsNextMapRevision()`-Aufruf bei `:2297` stimmt |
| Analyse §8.2: `subdivideRegionEditHoveredEdge(4)` bei `edge-controls.js:250` | `:250` ist `saveRegionGeometry` | Funktion **`:209`**, Aufrufe **`:67`** und **`:171`**; zur Laufzeit wirksam ist `map-features-region-vertex-detach-edit.js:461` |
| Analyse §C: Vorkommen-Editor `review-wiki-sync.js:2291–2960`, Ortsfeld `:2762` | `:2291` leer, `:2762` = `credentials: "same-origin"` | Bereich passt nicht mehr; Datei heute **3.298 Z.** (Analyse: 3.192) |
| Plan V0.3: „`network-data.php:76/:92` wirft diese Zeilen weg" | `:76` wirft **Labels** weg | nur `:92` trägt das Argument |
| Analyse §8.10: „**20** Dateien `map-features-region-*.js`" | **19** | 4.104 Zeilen stimmen exakt |
| Analyse §8.10: „**159** Top-Level-Deklarationen" | **172** | Differenz = exakt die **13 `async function`**; ein grep auf `^(function\|const\|let\|var\|class)` liefert präzise 159 |
| Analyse §8.11: `review-wiki-sync.js` „gerade in einer anderen Sitzung modifiziert" | committet in `2cf3f579` | **nicht mehr modifiziert**; Plan-Regel 5 warnt weiter namentlich davor |

### 3.1 Zeile verschoben

| Fundstelle | Doku | HEAD | Arbeitsbaum (fremde offene Arbeit) |
|---|---|---|---|
| `<option>`-Block | `index.html:1425–1431` | **1427–1431** (`<select>` 1426) | **1433–1437** (`<select>` 1432) |
| Häkchenreihe | `index.html:1461–1467` | **1462–1470** | **1468–1476** |
| `shouldShowLabelMarker` | `labels.js:494–505` | **493–505** | — |
| `mode === "deregraphic"` | `labels.js:500` | **`:501`** | — |
| Vertex-Detach-Loader | `route-priority-queue.js:65–72` | IIFE **66–77** | — |
| Citymaps-Kill-Switch | `citymaps.php:41–45` | Kommentar 40–42, `if` **43–45** | — |
| Filter-Trichter | „238 Z." | **237 Z.** | — |

---

## 4. Frisch gemessene Zahlen

Ein einziger `curl`, Antwort im Scratchpad ausgewertet.

### 4.1 Payload — Faktor 2 daneben

| | Doku | gemessen |
|---|---|---|
| Payload roh | „~14 MB" (Plan Regel 3, §8.5, §8.6; auch `api/app/citymaps.php:14` und `api/app/map-features.php:55`) | **29.646.676 B = 29,6 MB** |
| Payload gzip -9 | — | **3.329.300 B = 3,3 MB** |
| Features gesamt | — | **10.746** |

Die „14 MB" stammen aus einem Code-Kommentar, der selbst veraltet ist. Das
**verstärkt** §8.5 (eigener Revisionszähler) — es ist doppelt so teuer wie
behauptet. Aber die Zahl wird in beiden Dokumenten fünfmal als Beleg zitiert.

### 4.2 Landschafts-Labels nach Subtyp

| Ebene | Doku (17.07.) | **heute** | Δ |
|---|---:|---:|---:|
| **Derographisch** | 243 | **234** | −9 |
| ⤷ `region` 140→**134**, `insel` 96→**95**, `kontinent` 4→**2**, `sonstiges` 3→**3** | | | |
| **Topographie** | 166 | **180** | **+14** |
| ⤷ `gebirge` 60→**61**, `see` 45→**46**, `meer` 35→**35**, **`berggipfel` 23→33**, `kueste` 2→**2**, `huegelland` 1→**3** | | | |
| **Vegetation** | 116 | **119** | +3 |
| ⤷ `wald` 66→**67**, `suempfe_moore` 26→**28**, `steppe` **10**, `auenlandschaft` **8**, `wueste` **4**, `graslandschaft` **2** | | | |
| *(Linie)* `fluss` | 4 | **5** | +1 |
| **Gesamt** | 529 | **538** | +9 |

- **`tundra` und `ebene`: weiterhin 0 Labels** — die §8.1-Korrektur ist bestätigt.
- **`feature_type='region'`: 0** — „Landschafts-Polygone: 0" ✅ stimmt.
- Der `berggipfel`-Sprung **23 → 33** trifft Baustein D direkt: „23 Gipfel auf
  60 Gebirge" ist heute „**33 auf 61**". Richtung hält, Zahl nicht.

### 4.3 Routing-Datenmenge

| | Doku | heute |
|---|---:|---:|
| Orte im Routing-Sinn (Point, benannt, kein `label`) | ~3.949 | **4.531** (+15 %) |
| routingfähige Wege (LineString, kein `powerline`) | ~5.080 | **5.515** (+9 %) |
| Powerline-Zeilen | — | **162** (1,51 % aller Zeilen) |

Der 983-ms-Posten aus §8.6 skaliert damit um ~15 % nach oben — das Argument für
V0.1 wird **stärker**. Das für V0.3 wird schwächer.

### 4.4 Code-Zahlen

| Behauptung | gemessen |
|---|---|
| `map-features-region-*.js`: 20 Dateien / 4.104 Z. / 159 Deklarationen | **19 Dateien**, **4.104 Z.** ✅, **172 Deklarationen** |
| `index.html`: 164 `<script>`-Tags | **164** mit `src=` ✅ (HEAD *und* Arbeitsbaum) |
| `filter-menu.js` 238 Z. | **237** |
| `review-wiki-sync.js` 3.192 Z. | **3.298** |

### 4.5 Der Prüfstein: Reichen 9 Zellen? — **Ja, aber exakt auf Kante**

`avesmapsFindClientLocationAtPathEndpoint` (`client-graph.php:620–633`) ganz gelesen.

**Der Test ist kein Kreis, sondern ein Quadrat** (Tschebyschow):
`|Δy| < 0.5 UND |Δx| < 0.5` — ein offenes 1,0 × 1,0-Kästchen, kein Radius 0,5.
Der Plan beschreibt das nicht, rechnet aber implizit richtig damit.

**Rasterweite.** Schlüssel `round(c·2)` ⇒ Zelle `k` deckt
`c ∈ [k/2 − 0,25 ; k/2 + 0,25)`. **Zellbreite = 0,5.** Die Toleranz ist also
**eine volle Zellbreite**, nicht eine halbe.

**Rechnung.** Aus `|Δc| < 0,5` folgt `|2c_loc − 2c| < 1`. Mit
`round(a) ∈ [a − 0,5 ; a + 0,5]` gilt
`round(2c_loc) − round(2c) ∈ (−2 ; +2)` — ganzzahlig also **∈ {−1, 0, +1}**.

Gegenprobe am Zellrand: Query bei `c = k/2 − 0,25` erreicht Treffer bis
`k/2 − 0,7499` (Zelle `k−1`) und bis `k/2 + 0,2499` (Zelle `k`). Am rechten Rand
entsprechend `k` und `k+1`. **Nie zwei Zellen weit.**

> **Ergebnis: 3 × 3 = 9 Zellen genügen — mit exakt null Reserve.**
> Steigt `AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD` je über 0,5 (oder ändert
> jemand die Rasterweite), reichen 9 Zellen **stillschweigend** nicht mehr, und
> der Test des Plans (Sonden bei ±0,2) merkt es nie.

**Nicht prüfbar:** die 983 ms / 15 ms selbst. Es gibt **keine lokale Datenbank**
(`api/config.local.php` fehlt — bestätigt), und live nachzumessen hieße, genau
die Endpunkte zu rufen, die §8 verbietet. Die *Struktur* (linearer Scan über
4.531 Orte, 2× je Weg bei 5.515 Wegen, plus die Seewege-Schleife) ist verifiziert
und plausibel.

---

## 5. Was bestätigt ist — nicht nochmal prüfen

**Modus-Stellen (die fünf genannten):** Whitelist `display-mode.js:155` ✅ exakt ·
Icon `config.js:509–516` ✅ exakt · Übersetzung `i18n-en.js:79–86` ✅ exakt ·
Standardmodus `config.js:483` ✅ · `IS_EDIT_MODE` `config.js:198` ✅ ·
Muster `map-features.js:31` ✅ (es *disabled*, entfernt nicht) ·
Einbau vor `initializeTransportIconSelects()` = `:32` ✅.

**Routing:** Dijkstra-Schleife `client-graph.php:743–763` ✅ exakt ·
`break` am Ziel `graph.php:522` ✅ · Stale-Heap-Guard `route-graph-core.js:110` ✅ ·
Ladequery `map-data.php:41` ✅ · POST-Zweig `route/index.php:312` ✅ ·
`api/route/` hat **kein** `.htaccess`, `api/diagnostics/` **hat** eins ✅ ·
`api/route/index.php` ruft **nie** `set_time_limit` ✅ (33 echte Aufrufe in 21
Dateien im Rest von `api/`) · Querfeldein ×25 in **beiden** Engines ✅
(`config.js:60`, `client-graph.php:8`) · `via` abgelehnt `response.php:163` ✅ ·
N−1 POSTs `route-engine.js:411–448` ✅ exakt · server-primär `route-engine.js:40`,
`graphData = null` `:487` ✅.

**Server splittet, Client nicht:** `client-graph.php:148–157` ✅ vs.
`route-graph-routing.js:109–112` (nur erste/letzte Koordinate) ✅.
Commits `d7bdb7aa` (Client-Split, 2026-06-20) und `1f9e0b9e` (Revert, gleicher
Tag) ✅ beide vorhanden.

**Drei Slice-Stellen ✅ bestätigt** — `avesmapsAddClientCompatiblePathSliceConnection`
bei `:144` und `:157`, plus **`avesmapsBuildClientRouteSubPathConnection`
`client-graph.php:534–553`** ✅ exakt, inkl. der Geschwindigkeits-Rekonstruktion
`$originalDistance / $originalTime` bei `:538`. Eine der besten §8-Korrekturen.

**Zeichenwerkzeug:** `createRegionAt` `region-crud.js:158` ✅ — Sechseck,
`radius = 10`, 6 Ecken, speichert sofort, erzwingt
`setSelectedMapLayerMode("political")` bei `:159`.
**Strg+Klick setzt vier Ecken** ✅ (`edge-controls.js:164` prüft `ctrlKey`,
`:235–241` fügt `pointCount = 4` ein, `:250` speichert; 350-ms-Drossel bei `:215`).
**Jede Ecke = ein POST + ein Toast** ✅ und **untertrieben**:
`edit-handles.js:56–59` speichert zusätzlich **jede** vom
`applySharedBoundaryVertexMove` betroffene Nachbarregion.
Toast-Standzeit **2200 ms** ✅ (`map-features.js:181`).
Doppelklick löscht Ecke **und speichert** ✅ (`edit-handles.js:84–96`).

**Die drei Fallen:** `syncRegionVisibility` **zweimal** definiert ✅
(`political-region-visibility.js:1` und `loader.js:473`); der Loader gewinnt
(Guard `:469`) und installiert **dreimal zeitverzögert** ✅
(`:591`: `[0, 50, 250]`). **Sieben** Vertex-Handler überschrieben ✅ — exakt
sieben `window.*`-Zuweisungen in `map-features-region-vertex-detach-edit.js`,
nachgeladen aus `route-priority-queue.js:66–77`.
`clearRenderedRegionLayers` `region-rendering.js:150` leert `regionPolygons`
bei `:156` ✅.

**Panes — z-index 250 ist frei ✅.** Vollständige Belegung:
`regionsPane` 200 · Schraffur-Overlay 300 · `roadsOutlinePane` 350 ·
Grenz-Canvas 350 · `regionHoverPane` 355 · `roadsPane` 400 · `powerlinesPane` 430 ·
`routeOutlinePane` 445 · `routePane` 450 · `measurementPane` 460 ·
`regionLabelsPane` 475 · `mapDecorationsPane` 480 · `locationCanvasPane` 499 ·
`locationsPane` 500 · `measurementHandlesPane` 520 · Fluss-Pfeile 639 ·
Weg-Label-Canvas 640 · `labelsPane` 650 · `tooltipPane` 875 · `popupPane` 900.
**201–299 unbelegt, nächste Belegung 300.**

**Alle geplanten Namen sind frei ✅** — `landschaftenLayers`,
`syncLandschaftenVisibility`, `IS_LANDSCHAFTEN_ENABLED`, `ecosystem_region`,
`ecosystem_area`, `avesmapsBuildClientLocationCoordinateIndex`, `toggleMapLabels`,
`toggleTerritoryBorders`, `landschaftenPane`: **je 0 Treffer** über `js/`,
`index.html`, `api/`. Sogar die Zeichenfolge „landschaften" kommt nirgends vor.

**Weiter bestätigt:** `app_setting` nimmt den Default als Argument ✅
(`app-setting.php:28`) — die §8-Korrektur stimmt; die Konvention „default-an"
steht aber tatsächlich bei `:14–15`, der Plan-Hinweis bleibt nötig ·
`edit/index.php:39–59` reicht die rohe QUERY_STRING durch, filtert nur
`debugmap/edit/_v` ✅ exakt · `editor-shell.css:24–27` ✅ exakt ·
`wiki-sync-powerline-editor.html:60` trägt `display:grid` ✅,
`wiki-sync-settlement-editor.html:75/:78` trägt `flex:1 1 0` ✅ — beide zeilengenau ·
`review-powerline-list.js:11` ✅ · `api/app/citymaps.php:13–14` und Leasing-Zitat
`api/_internal/app/citymaps.php:323–325` ✅ wörtlich · `autoget-run.php:86–99` ✅
exakt · `api/edit/map/citymaps.php` = 145 Z. ✅ · `region-geometry-helpers.js`
= 405 Z. ✅ · `boolean-geometry.js:12–20` ✅ · `startPathCreationAt`
`path-creation.js:58` ✅ · `buildLoreMarkup` `lore.js:417` ✅ ·
`buildRouteLegPopupHtml` `route-plan.js:196`, Zeilen-Helfer `:210`, letzte
Zeile `:222` ✅ · `DISTANCE_SCALING_FACTOR = 3` `config.js:11` ✅ ·
Verlauf-Sync-Warnung `client-graph.php:207–211` ✅ wörtlich ·
`regions.php:31–39` (4 Wiki-Kategorien) ✅ · `lore-edit.php:121`
(`vorkommen` freigeschaltet) ✅ · `lore-parsing.php:70–81` ✅ ·
Spotlight `:319`, `:527`, `focus.js:34` ✅ · **`map-search.php` hat keinen
`lore`-Zweig** ✅ · Prototyp-Funktionen **alle zeilengenau** (`inPoly` :381,
`distEdge` :389, `cellHash` :402, `level` :413, `buildIndex` :432,
`peakWindow` :452, `rawArea` :464, `buildArea` :491, `hAt` :578,
`sampleRoute` :637, `#step` :206, Pfeile :702–710 mit 34 px und
`5 + 20·min(1.3, spd)`) ✅ · Designsprache-Spec 905 Z. ✅ ·
`tools/routing/test-client-graph-flow.php` existiert ✅ · `cb082ab5` ✅ ·
oekosystem-Vorarbeit: `instruction.md:141`, `:144–147`, `:150–158`,
`editor-leitfaden.md:239/:240`, `editor-verhalten.md §5`,
`feature-design.md §5` ✅.

**Der Bild-Lizenz-Nebenbefund (§4.5) stimmt und ist ein echter Bug:** Der
Parser-Record `regions.php:506–526` enthält kein `image_license*`, der Upsert
`:581–618` schreibt keins — gelesen wird es aber bei `:842–844`, und
`labels.js:293–297` blendet ohne `public_domain` **jedes** Regionsbild aus.

---

## 6. Fremde Arbeit im geteilten Baum

**Kein Commit nach dem Plan** (`889ad2da`, 2026-07-24 05:23) berührt eine
Kernzieldatei — mit zwei Ausnahmen:

| Datei | betroffen von | Wirkung |
|---|---|---|
| **`index.html`** | Commits nach dem Plan **+ fremde unkommittierte Arbeit** | alle `index.html`-Zeilennummern des Plans falsch, zweifach verschoben |
| `js/app/i18n-en.js` | Commit nach dem Plan | zufällig unverändert im Bereich 79–86 |

**Offene fremde Arbeit:** `docs/design-continuation-instruction.md` ·
`icons/pin.webp` · **`index.html`** · `js/app/utils.js` — plus ~30 untracked
`verify-*.html` und `img/*.png`.

> **Regel 5 des Plans ist veraltet.** Sie nennt `js/review/review-wiki-sync.js`
> als offene fremde Arbeit — die Datei ist committet. Die reale
> Kollisionsgefahr liegt heute bei **`index.html`**.

`api/_internal/map/features.php` wurde nach dem Plan geändert — das erklärt die
Verschiebung 2255 → 2273.

---

## 7. Änderungsliste für den Plan

- [ ] **V0.1 neu schreiben.** Index über `route_x`/`route_y`; explizite
      Signaturänderung mit **allen drei** Aufrufstellen (`:103`, `:104`, `:400`);
      den vorhandenen Index bei `:61–67` nennen und einen anderen Namen wählen;
      `avesmapsFindClientLocationLinearForTest` als eigenen Schritt; Sonden bei
      **±0,4999**; eine Zusicherung `Raster ≥ AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD`;
      Quelle des Toleranzwerts auf `client-graph.php:5` korrigieren.
- [ ] **V1.2 um zwei Konstanten erweitern:** `TERRITORY_BOUNDARY_MODES`
      (`loader.js:15`) und `BOUNDARY_OVERLAY_MODES` (`boundary-canvas-overlay.js:485`).
- [ ] **„Fünf Stellen" auf acht korrigieren** und `applyFrontendLayerModeDefaults`
      als bewusst-harmlos markieren, statt sie zu übersehen.
- [ ] **V3.3: Strg+Z ist belegt.** Andere Taste oder das Audit-Undo bewusst
      ablösen — und die Behauptung „kein Undo, nirgends" streichen.
- [ ] **Drei fehlende Erzeuger nachtragen:** `ecosystem_revision`, das Schreiben
      von `ecosystem_enabled`, die Oberfläche für `promote_trial`.
- [ ] **Die verlorene L2-Stufe zurückholen** (Laden + Rendern vorhandener Flächen).
- [ ] **„Fläche übernehmen" vor V4 ziehen** oder V4 offen als Messung *ohne*
      dieses Werkzeug deklarieren.
- [ ] **V0.2 um den Transport-Fall ergänzen** (`minimizeTransfers` + Settled-Set).
- [ ] **V0.5:** `location-node-data` aufnehmen; die Behauptung
      „`map-data`/`network-data` sind leicht" streichen; als öffentliche
      Bestandsänderung kennzeichnen.
- [ ] **V0.3 ehrlich beschreiben** (1,5 %, und nur `:92` trägt das Argument).
- [ ] **V2.4 auf vier Stellen korrigieren** (2 Arrays + 2 Fehlermeldungen).
- [ ] **Alle Zahlen ersetzen:** 14 MB → **29,6 MB roh / 3,3 MB gzip** ·
      243/166/116 → **234/180/119** · 529 → **538** · 23 Gipfel → **33** ·
      ~3.949 Orte → **4.531** · ~5.080 Wege → **5.515** · 20 Dateien → **19** ·
      159 Deklarationen → **172** · `filter-menu.js` 238 → **237** ·
      `review-wiki-sync.js` 3.192 → **3.298**.
- [ ] **Alle verschobenen Zeilen aus §3.1 nachziehen.**
- [ ] **Regel 5 aktualisieren:** offene fremde Arbeit ist `index.html`.
- [ ] **Optional:** Namensräume vereinheitlichen (`ecosystem_*` vs.
      `entity_type='landschaft'` vs. `landschaften*` vs. `kind` mit deutschen Werten).
