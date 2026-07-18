# Ökosystem — Bauanleitung Ausbaustufe F + 1 (Fundament + Landschaften)

> Gehört zu `docs/oekosystem-feature-design.md` (Gesamtbild, Schichten 1–4).
> Diese Datei beschreibt **nur die erste Ausbaustufe**: das Zeichenwerkzeug und
> die isotropen Landschaften. Höhe ist im Datenmodell **vorgesehen**, wird aber
> erst in Stufe 3 scharf geschaltet.

## 1. Ziel dieser Stufe

1. Editoren können Flächen zeichnen, taggen und mit dem Wiki verknüpfen.
2. Für jeden Weg steht vorberechnet fest, durch welche Flächen er läuft — und über
   welche Teilstrecke.
3. Die Etappen-Anzeige zeigt „Führt durch: Nebelmoor, Großfeenwald".
4. Eine Routen-Option **„Landschaft berücksichtigen"** schaltet die Kostenwirkung
   ein; zunächst nur im Edit-Mode sichtbar, später Standard für alle.

## 2. Datenmodell

Vier Tabellen, Muster wie `political_territory_geometry` (Inline-DDL,
bbox-Cache, Soft-Delete über `is_active`, keine Fremdschlüssel).

**`ecosystem_area`** — die gezeichnete Fläche.

| Spalte | Zweck |
|---|---|
| `public_id` | UUID |
| `area_type` | einer der 19 Landschaftstypen (`suempfe_moore`, `wald`, …) |
| `name` | Anzeigename, falls kein Wiki-Bezug |
| `geometry_geojson` | Polygon / MultiPolygon, `[x, y]` |
| `min_x`,`min_y`,`max_x`,`max_y` | bbox-Cache für den Vorfilter |
| `wiki_region_key`, `wiki_url` | Wiederverwendung der Landschafts-Wikianbindung |
| `speed_factor_override` | NULL = Typ-Default gilt (§8 des Designdocs) |
| `base_height` | Höhe am Polygonrand, Standard 0 |
| `max_height` | höchster Punkt des Gebirges in Schritt — **eine Zahl pro Fläche** |
| `max_height_source` | `wiki` / `manual` / NULL — Herkunft, nie stillschweigend |
| `max_height_text` | roher Wiki-Textschnipsel („erreicht eine Höhe von bis zu 9000 Schritt"), damit ein Fehlgriff diagnostizierbar bleibt |
| `mesh_json` | Dreiecksnetz, im Browser gerechnet (Stufe 3) |
| `mesh_seed` | Startwert des Generators — gleiche Fläche + gleiche Zahl = gleiches Gelände |
| `is_active`, `created_by`, `updated_by`, Zeitstempel | Konvention |

**`ecosystem_height_point`** — innere Stützpunkte (erst ab Stufe 3 relevant, aber
gleich mit anlegen): `area_id`, `x`, `y`, `height`.

**`ecosystem_type`** — die **editorpflegbaren** Typ-Defaults. Genau *keine*
Konstante in `js/config.js`: `type_key`, `label`, `speed_factor`,
`affects_routing` (Kontinent/Küste/Meer bremsen nicht), `sort_order`.

**`path_ecosystem`** — das Vorberechnungs-Ergebnis, eine Zeile je Weg × Fläche ×
Intervall: `path_id`, `area_id`, `enter_distance`, `exit_distance`,
`factor_forward`, `factor_backward` (fertig gerechnet, in **Zeichenrichtung** des
Wegs), `ascent`, `descent` (**nur für die Anzeige**), `computed_at`.
Index auf `path_id`.

> **Gespeichert wird der fertige Faktor, nicht die rohe Höhensumme.** Steigung
> wirkt nichtlinear aufs Tempo: 600 Schritt am Stück steil kosten mehr als 600
> Schritt über 40 Meilen verteilt, und aus einer Summe lässt sich die Verteilung
> nicht zurückrechnen. Die Zeit wird deshalb beim Abtasten **integriert** (§5).
> `ascent`/`descent` überleben nur als Anzeigewerte.

> **Wichtig:** ein Weg kann dieselbe Fläche mehrfach durchqueren (konkave Flächen).
> Deshalb *mehrere Zeilen* je Weg×Fläche, kein Ja/Nein-Feld.

## 3. Editor — „Ökosystem-Modus"

Neuer Modus im Editor-Menüband, Klon des Karten-/Politik-Musters.
Wiederverwendet wird der vorhandene Vertex-Editor aus `js/map-features/`
(`map-features-region-edit-handles.js`, `-edit-ops.js`, `-edit-edge-controls.js`)
samt `polygon-clipping`-Pipeline: Fläche setzen, Ecken ziehen, Kante teilen,
Boolean-Split, Löcher.

Zu bauen ist die **Entkopplung** dieses Werkzeugs von der politischen Entität —
heute hängt es fest am `politicalTerritoryRepository`. Es braucht ein zweites
Repository plus einen Single-Endpoint mit `action`-Discriminator,
capability-gated auf `edit`, exakt nach dem Muster von
`api/_internal/political/territories-endpoint.php`.

**Nicht** übernommen werden: Hierarchie/`parent_id`, Vererbung, abgeleitete
Außengrenzen, Streitgebiete, BF-Zeitstrahl. Natur ist flach und zeitstabil.

Formularfelder je Fläche: Typ (Dropdown der 19), Name, Wiki-Landschaft
(Picker aus `js/review/review-label-wiki.js` wiederverwenden),
Faktor-Override (leer = Typ-Default), Fußhöhe.

## 4. Höhenfeld (vorbereitet, scharf ab Stufe 3)

### 4.1 Echtes CDT ist Pflicht, kein Sparmodell

Aus Polygonrand + Höhenpunkten entsteht per **Constrained-Delaunay-Triangulation**
ein Dreiecksnetz. Bibliothek: `poly2tri` (Sweepline-CDT), zu vendorn nach
`js/third-party/` neben `polygon-clipping` und `polylabel`.

Die naheliegende Abkürzung — gewöhnliches Delaunay über alle Punkte, danach alle
Dreiecke wegwerfen, deren Schwerpunkt außerhalb liegt — **ist gemessen
unbrauchbar**. An einer spiralförmigen Testfläche: **8 fehlende Randkanten, 9
hinausragende Dreiecke, 250 von 2.436 Innenpunkten unbedeckt** (`scratchpad/verify.mjs`).
Zwei unabhängige Gründe: der Schwerpunkttest ist unzureichend (ein Dreieck kann
eine schmale Bucht überspannen und trotzdem seinen Schwerpunkt innen haben), und
eine Randkante kann in der Delaunay-Triangulation schlicht **fehlen** — nachträgliches
Filtern holt sie nicht zurück. Landschaftsflächen sind genau der konkave Fall.

- Polygonkanten als **Zwangskanten**, Höhenpunkte als innere Stützpunkte,
  Randpunkte auf `base_height`.
- **Gerechnet wird im Browser beim Speichern**, gespeichert wird das fertige Netz —
  dasselbe Muster wie bei den abgeleiteten Außengrenzen (Frontend rechnet, Server
  reicht durch). Erspart eine PHP-Geometriebibliothek.
- Serverseitig wird das Netz nur **ausgewertet**: Punkt-in-Dreieck plus
  baryzentrische Interpolation — reine Arithmetik.

### 4.2 Woher die Höhenpunkte kommen: Gipfel zuerst, Gitter füllt auf

Der Editor tippt **eine Zahl pro Gebirge** (`max_height`), nicht eine pro Gipfel.
Daraus baut der Generator die Stützpunkte in dieser Reihenfolge:

1. **Vorhandene `berggipfel`-Labels innerhalb der Fläche** werden Netzknoten. Ihre
   Positionen sind lore-korrekt und schon da; gefunden über den bbox-Vorfilter
   (Punkt-Labels haben `min_x = max_x`, ihre bbox *ist* ihre Position).
   **Der nächstgelegene Gipfel bekommt `max_height`** — sonst landet der höchste
   Punkt neben dem benannten Gipfel, und genau das liest die Zielgruppe als Fehler.
2. **Pseudozufälliges Gitter füllt auf.** Es gibt live nur **23 `berggipfel` auf 60
   `gebirge`** — zu wenig, um ein Netz zu tragen, zu sichtbar, um sie zu ignorieren.
3. **Manuell gesetzte Höhenpunkte gewinnen immer** (`ecosystem_height_point`).

Zwei Bedingungen:

- **Determinismus.** Der Generator wird aus `mesh_seed` gespeist, abgeleitet aus
  `public_id + max_height + Geometrie-Revision`. Echter Zufall würde bei jedem
  Neuberechnen andere Reisezeiten liefern und Routen lautlos verschieben.
- **Randabfall.** Punkte nahe am Rand werden mit ihrem Randabstand skaliert,
  sonst entsteht am Polygonrand eine Klippe statt eines Gebirgsfußes.

### 4.3 Der Pass ist ein innerer Punkt — nicht eine Einbuchtung

Zwei Gipfel allein erzeugen **keinen Sattel, sondern einen Grat**: Delaunay legt
eine Kante zwischen sie, und darauf interpoliert die Höhe linear von Gipfel zu
Gipfel. Gemessen an derselben Straße über dasselbe Massiv: die Kreuzung liegt bei
**1.158 Schritt** statt bei 272 — Faktor 4,3 allein aus der Vernetzung. Ohne
Gegenmaßnahme kodieren `factor_forward`/`factor_backward` die Triangulation, nicht
das Gelände.

Ein Punkt nahe der Mitte der Verbindungsstrecke bricht diese Kante zuverlässig
(jeder Kreis durch zwei Punkte enthält den Mittelpunkt ihrer Strecke, also gibt es
dort keinen leeren Umkreis mehr).

**Der Pass gehört deshalb als innerer Höhenpunkt gesetzt**, nicht als Einbuchtung
der Umrisslinie. Eine Kerbe im Umriss erzwingt Höhe ~0 *und* schneidet die
Passstraße aus der Fläche heraus — sie verlöre damit den isotropen Gebirgsfaktor
und zählte als offenes Land. Ein Pass ist aber der mühsamste Teil der Strecke.

## 5. Vorberechnung: Wege ↔ Flächen

Stapellauf nach dem Muster von `autoget-run.php` (Sperre, Budget, Kill-Switch).

### 5.0 Eine Kalibrierkonstante — sonst ist alles bedeutungslos

Eine Steigung ist **dimensionslos**: `Höhe / Strecke`. Beide Seiten müssen also in
derselben Einheit stehen. Es gilt genau eine Umrechnung, und sie gehört an genau
eine benannte Stelle:

```
1 Karteneinheit = DISTANCE_SCALING_FACTOR (3) Meilen = 3 km = 3000 Schritt
1 Meile = 1 km = 1000 Schritt      (so sagt es der Geschwindigkeits-Dialog:
                                    js/routing/transport-speed-info.js)
1 Schritt = 1 m
```

> 🔴 **Die Falle, die wie Erfolg aussieht.** `calculatePathCoordinateDistance`
> (`js/map-features/map-features-location-editing.js:10`) liefert eine rohe
> `Math.hypot`-Summe in **Karteneinheiten**, *ohne* `DISTANCE_SCALING_FACTOR`. Der
> Graph rechnet damit `time = distance / speed` — das war nie ein Fehler, weil
> Dijkstra nur **rangiert**. Eine Steigung rangiert nicht, sie ist absolut. Wer die
> Graph-Distanz als Meilen weiterverwendet, überhöht die Steigung um 3× und das
> Signal (F − 1) um **23×** — aus einer unbrauchbaren 1,02 würde eine überzeugende
> 1,46, und niemand merkt es. Die Steigung darf **ausschließlich** aus
> `ds_schritt = ds_karteneinheiten × 3000` gebildet werden, und die Einheit gehört
> in den Feldnamen.

### 5.1 Ablauf

1. **bbox-Vorfilter** — ein Weg wird nur gegen Flächen geprüft, deren Bounding-Box
   seine schneidet. Erschlägt praktisch alle Vergleiche.
2. **Ein- und Austritte** bestimmen: Ray-Cast am Startpunkt, danach die Schnitte
   des Wegs mit den Polygonkanten (Strecke × Kante, Parameterform). Der Zustand
   klappt an jedem Schnitt um; konkave Flächen liefern dabei **mehrere Intervalle**.
3. **Schreiben** — je Intervall eine Zeile in `path_ecosystem`.
4. **Im Gebirge zusätzlich** (Stufe 3): das Höhenprofil bilden und die Zeit
   integrieren, einmal vorwärts und einmal rückwärts → `factor_forward` /
   `factor_backward`. Auf- und Abstieg werden nebenher summiert, aber **nur als
   Anzeigewerte**.

### 5.2 Das Profil ist exakt — keine Abtast-Schrittweite

Innerhalb eines Dreiecks ist die Höhe affin, entlang einer Geraden also die
Steigung **konstant**. Das Höhenprofil eines Wegs ist damit stückweise linear, und
seine Knicke sind eine **endliche, exakt berechenbare Menge**:

```
Knickpunkte = Schnitte mit Dreieckskanten  ∪  die Stützpunkte des Wegs selbst
```

> ⚠️ Der zweite Teil ist leicht zu vergessen und kostet gemessen **19 % des
> Signals**: ein Knick der Polylinie *innerhalb* eines Dreiecks ist ein echter
> Steigungswechsel, auch wenn dort keine Dreieckskante liegt.

Damit entfällt jede Abtastkonstante. Das ist nicht nur genauer, sondern billiger —
und es beseitigt einen scharfen Fehlermodus: gemessen mit 0,8 Meilen Schrittweite
kippt das **Vorzeichen der Asymmetrie** (−173 % Fehler), das Modell behauptet dann,
die Gegenrichtung sei die schnellere. `1/rel(s)` ist konvex, gemitteltes Gefälle
unterschätzt also systematisch (Jensen) — und dabei nicht einmal monoton, „die Zahl
bewegt sich nicht mehr" ist als Konvergenztest wertlos.

### 5.3 Klemmen und Wächter

Vorbild ist die Flussrichtung, die in **beiden** Engines identisch klemmt
(`js/routing/route-graph-routing.js:102`, `api/_internal/routing/client-graph.php:178`).
Drei Schichten:

1. **Schritte mit `ds ≤ ε` überspringen.** Doppelte Stützpunkte ergeben sonst
   `0/0 = NaN`. NaN wirft nicht — jeder Vergleich wird `false`, und Dijkstra
   relaxiert diese Kante schlicht **nie**. Eine gezeichnete Straße verschwindet
   lautlos aus dem Netz.
2. **Steigung auf den Gültigkeitsbereich der Kurve klemmen**, `|s| ≤ 0,5`. Tobler
   ist nur bis dorthin angepasst; alles darüber ist extrapolierte Exponentialfunktion
   (bei 310 % Steigung kommt Faktor 45.000 heraus).
3. **Ergebnisfaktor klemmen, Größenordnung [0,5 … 4,0].**

> ⚠️ Die Untergrenze muss **unter 1** liegen. Bergab ist echt schneller als flach
> (Faktor 0,865 bei 4 % Gefälle). Die Flussrichtung klemmt auf `[1,0 … 3,0]` —
> diese Untergrenze hierher zu übernehmen würde die halbe Wirkung verschlucken.

Und ein **`heightAt` ohne Treffer muss warnen, nicht 0 liefern.** Ein Loch im Netz
wird sonst als Meereshöhe gelesen: mitten in einem 1.158-Schritt-Massiv sind das
240 % Steigung, und **ein einziges Loch bläst eine saubere Querung um das 75-fache
auf**.

### 5.4 Die Kurve gehört den Editoren

Die Abbildung Steigung → Tempo ist ein austauschbares Stück (§8 des Designdocs).
Startvorschlag: Toblers Wanderfunktion — asymmetrisch, am schnellsten leicht
bergab. Ändert sich die Kurve, läuft **nur dieser Stapellauf** neu; an der
Routing-Seite ändert sich nichts.

**Neuberechnung** ist immer begrenzt: Fläche gespeichert → alle Wege in ihrer bbox;
Weg geändert → dieser eine Weg. Niemals die ganze Karte, **niemals pro
Routenanfrage**.

## 6. Routing-Anbindung

**Toggle.** `routeOptions` bekommt ein Feld für „Landschaft berücksichtigen"; die
Checkbox erscheint zunächst nur im Edit-Mode. Aus = Verhalten exakt wie heute.

**Es braucht keinen neuen Suchalgorithmus.** Terrain ändert ausschließlich
Kantengewichte; die Wegwahl macht weiterhin Dijkstra. Ein flacherer Umweg gewinnt
automatisch, sobald er billiger ist — vorausgesetzt, er ist als Weg gezeichnet.

> ⚠️ **Nur im Zeitmodus.** Der Graph wählt `weight = useShortestPath ?
> conn.distance : conn.time`. Steht der Planer auf **„kürzester Weg", ist Terrain
> vollständig wirkungslos** — Distanz kennt kein Gelände, und ein flacherer Umweg
> ist dort per Definition der schlechtere. Terrain drückt sich ausschließlich über
> die Zeit aus. Das ist kein Bug, muss aber in der Oberfläche verständlich sein.

**Kosten je Kante.** Der Graph zerlegt Wege an **Kreuzungen**, nicht an
Zonengrenzen. Eine Kante deckt also einen Meilenbereich ihres Wegs ab; diesen
Bereich mit den gespeicherten Intervallen zu verschneiden ist Zahlenvergleich,
keine Geometrie. Ergebnis ist ein **längengewichteter** Faktor.

> Kanten werden **nicht** zusätzlich an Zonengrenzen zerschnitten. Mitten im Sumpf
> gibt es keine Abzweigung, also auch nichts zu entscheiden — es würde den Graphen
> aufblähen ohne Nutzen.

> 🔴 **Damit wird die Intervalllänge zur neuen Schrittweite** — und zwar in
> Zehnermeilen statt in Zehntelmeilen. Ein Intervall, das eine Kante nur *teilweise*
> überdeckt, gibt ihr trotzdem seinen Gesamtfaktor. Gemessen an einer Kreuzung, die
> **auf dem Gipfel** liegt: gespeichert 1,02, wahr aber 1,20 bergauf und 0,84
> bergab — also −15 % und +21 % daneben. Und genau dort liegen die Passdörfer.
> Für flache Landschaften ist das Mitteln richtig; sobald Höhe im Spiel ist, muss
> ein Intervall **an den Kantengrenzen neu ausgewertet** werden, nicht gemittelt.

**Der eine heikle Umbau.** Heute ist die Kantenerzeugung ein *Entweder/Oder*:
ohne Flussrichtung ein gemeinsames symmetrisches Objekt, mit Flussrichtung zwei
asymmetrische (`js/routing/route-graph-routing.js` `addRegularPathToGraph`;
gespiegelt in `api/_internal/routing/client-graph.php`
`avesmapsAddClientCompatiblePathSliceConnection`). Ein Flussweg durch einen Sumpf
braucht **beides**. Der Zweig muss deshalb zu *„alle Faktoren einsammeln, dann
multiplizieren"* werden.

Das ist die Stelle, an der man die Flussrichtung lautlos zerschießen kann. Die
vorhandenen Tests (`tools/routing/test-client-graph-flow.php`,
`tools/routing/test-client-route-flow.mjs`) sind dabei Schutzgeländer **und**
Vorlage.

> 🔴 **Aber der Umbau ist nicht symmetrisch zum Fluss — und das ist die
> gefährlichste Stelle im ganzen Vorhaben.** Der Strömungsfaktor ist **ein Skalar
> pro Weg**; ihn auf jedes Teilstück zu kopieren ist deshalb exakt richtig. Der
> Terrainfaktor **variiert entlang des Wegs**. Die naheliegende Umsetzung —
> `$path` durchreichen und den Faktor je Slice anwenden — stempelt den
> **Ganzweg-Terrainfaktor auf jedes Teilstück**. Das ist still falsch, und **die
> Flusstests bleiben dabei grün**. Terrain muss je Slice aus dessen eigenem
> Meilenbereich neu bestimmt werden. Ein Test, der genau das prüft (ein Weg, dessen
> zwei Hälften unterschiedliches Terrain haben), gehört von Anfang an dazu.

**Zusätzlich neu gegenüber dem Fluss:** ein Faktor **kleiner 1** (bergab). Die
Klemme darf hier nicht die Flussgrenze `[1,0 … 3,0]` erben (§5.3).

**Beide Engines lesen dieselben vorberechneten Werte.** Es wird keine
Geometrielogik in JS nachgebaut — damit ist die Parität strukturell gesichert.

**Doppelzählung vermeiden.** Wo der Wegtyp das Terrain schon kodiert
(`Gebirgspass`, `Wuestenpfad`), darf der Flächenfaktor nicht zusätzlich greifen.
Regel und Ausnahmenliste gehören in `ecosystem_type`, nicht in den Code.

## 7. Anzeige

In `buildRouteLegPopupHtml` (`js/routing/route-plan.js`) eine Zeile ergänzen:

```
Führt durch:  Nebelmoor · Großfeenwald
```

Namen kommen aus der Vorberechnung und reisen im Segment mit. Wiki-verknüpfte
Flächen zeigen ihren Eigennamen, alle anderen das Typ-Wort („Sumpf"). Gelistet
werden nur Flächen, die den **tatsächlich genutzten** Meilenbereich schneiden —
eine Teilroute darf kein Moor melden, das erst hinter dem Abzweig beginnt.

Für Stufe 3 ist neben `flow_state` ein `climb_state` (`bergauf`/`bergab`/`eben`)
vorgesehen — derselbe Kanal, den die Flussrichtung schon nutzt.

> ⚠️ **Erfundene Höhen dürfen nie als Zahl erscheinen.** Aus dem Wiki stammt nur
> das Maximum, die Verteilung erzeugt der Generator. Die Infobox-Zeilen sind
> wiki-belegte Angaben unter einer Quellenfußnote — ein eingestreutes „Höhe: 6.240
> Schritt" würde dem Wiki etwas zuschreiben, das dort nie stand, und das Projekt
> führt das Wiki ausdrücklich als *Datengrundlage*, nicht als Wahrheit.
>
> Erlaubt sind: das **wörtliche, belegte Maximum** („bis zu 9.000 Schritt", mit
> Quelle) und **qualitative Ableitungen** („führt über den Kamm", `climb_state`,
> die Reisezeit). Nicht erlaubt: eine interpolierte Höhe an irgendeinem Punkt.

## 8. Phasen

| Phase | Inhalt | fertig, wenn |
|---|---|---|
| **P1** | Tabellen + Endpoint + Repository | Fläche lässt sich per API anlegen, lesen, ändern, soft-löschen |
| **P2** | Editor-Modus + Zeichenwerkzeug entkoppelt | Editor zeichnet, taggt und verknüpft eine Fläche im Browser |
| **P3** | Typ-Tabelle + Faktor-Pflege | Editoren ändern Faktoren ohne Entwickler |
| **P4** | Vorberechnung + Stapellauf | `path_ecosystem` gefüllt, Neuberechnung greift bei Änderungen |
| **P5** | Anzeige „Führt durch" | Etappen-Popup zeigt korrekte Namen, auch bei Teilrouten |
| **P6** | Toggle + Kostenwirkung | Route ändert Zeit mit Toggle an, ist identisch mit Toggle aus |

## 9. Tests

- **Vorberechnung:** konkave Fläche mit Mehrfachdurchquerung (drei Intervalle),
  Weg beginnt innerhalb, Fläche mit Loch, Weg berührt eine Ecke tangential.
- **Vernetzung:** Kamm, Stern und Spirale — **null** fehlende Zwangskanten, **null**
  hinausragende Dreiecke, **null** unbedeckte Innenpunkte. Der Schwerpunktfilter
  fällt hier durch (§4.1); der Test ist die Abnahme für das echte CDT.
- **Knickpunkte:** Weg mit einem Stützpunkt *innerhalb* eines Dreiecks — das Profil
  muss dort knicken (§5.2). Gegenprobe gegen ein sehr fein abgetastetes Profil.
- **Einheiten:** eine Querung bekannter Höhe und Breite muss den analytisch
  berechenbaren Faktor liefern. Fängt einen schleichenden Faktor-3-Fehler (§5.0).
- **Wächter:** doppelter Stützpunkt (`ds = 0`) darf kein NaN erzeugen; ein Loch im
  Netz muss warnen statt still 0 zu liefern.
- **Kanten-Verschneidung:** Teilstück ganz drin, ganz draußen, halb — der
  längengewichtete Faktor muss stimmen.
- **Slice-Granularität:** ein Weg, dessen zwei Hälften unterschiedliches Terrain
  haben, muss zwei **unterschiedliche** Slice-Faktoren ergeben. Fängt den
  Ganzweg-Stempel (§6) — den die Flusstests nicht sehen.
- **Regression Flussrichtung:** die vorhandenen Flow-Tests müssen nach dem Umbau
  auf „sammeln und multiplizieren" unverändert grün sein.
- **Parität:** dieselbe Route über beide Engines, identisches Ergebnis.
- **Toggle aus = heutiges Verhalten**, bitweise identisch.

## 10. Offene Punkte

- Konkrete Faktorwerte je Typ — **gehören den Editoren**, nicht diesem Dokument.
- Ob ein Dreiecksnetz überhaupt das richtige Flächenmodell ist. Es ist stetig, aber
  **nicht glatt** — die Steigung springt an jeder Dreieckskante, und die Steigung
  ist genau das, was wir auswerten. Alternativen (Natural-Neighbour, inverse
  Distanzgewichtung, Thin-Plate-Splines) werden gerade geprüft.
- Ausnahmenliste gegen Doppelzählung (`Gebirgspass`, `Wuestenpfad`, weitere?).
- Ob Flächen ohne Wiki-Bezug im „Führt durch" auftauchen oder still bleiben.
- Wann der Toggle vom Edit-Mode auf Standard umgestellt wird.
- Welche Kurve Steigung → Tempo abbildet (Startvorschlag Tobler, §5).
- Wie der Oberfläche beizubringen ist, dass Terrain im Modus „kürzester Weg"
  wirkungslos bleibt — Hinweis, Ausgrauen des Hakens, oder gar nichts.
