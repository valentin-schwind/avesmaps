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
| `mesh_json` | Dreiecksnetz, im Browser gerechnet (Stufe 3) |
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

Aus Polygonrand + Höhenpunkten entsteht per **Constrained-Delaunay-Triangulation**
ein Dreiecksnetz. Bibliothek: `poly2tri` (Sweepline-CDT), zu vendorn nach
`js/third-party/` neben `polygon-clipping` und `polylabel`.

- Polygonkanten als **Zwangskanten** → kein Dreieck verlässt die Fläche, egal wie
  konkav sie ist. Ein einfacher Fächer vom Gipfel zu den Ecken funktioniert bei
  konkaven Flächen **nicht** und ist ausdrücklich nicht die Lösung.
- Höhenpunkte als innere Stützpunkte, Randpunkte auf `base_height`.
- **Gerechnet wird im Browser beim Speichern**, gespeichert wird das fertige Netz.
  Das ist dasselbe Muster wie bei den abgeleiteten Außengrenzen (Frontend rechnet,
  Server reicht durch) und erspart eine PHP-Geometriebibliothek.
- Serverseitig wird das Netz nur **abgetastet**: Punkt-in-Dreieck plus
  baryzentrische Interpolation — reine Arithmetik, keine Bibliothek.

## 5. Vorberechnung: Wege ↔ Flächen

Stapellauf nach dem Muster von `autoget-run.php` (Sperre, Budget, Kill-Switch).

1. **bbox-Vorfilter** — ein Weg wird nur gegen Flächen geprüft, deren
   Bounding-Box seine schneidet. Erschlägt praktisch alle Vergleiche.
2. **Abtasten** — den Weg in festen Schritten entlanglaufen (Schrittweite offen,
   Größenordnung 0,1 Karteneinheiten). An jedem Abtastpunkt ein
   Punkt-in-Polygon-Test (Ray-Cast, Gerade/Ungerade — behandelt Löcher von selbst).
3. **Zustandswechsel** — wo der Zustand zwischen zwei Abtastpunkten kippt, liegt
   eine Grenze. Dort **einmal** den exakten Schnittpunkt nachrechnen
   (Strecke × Kante, Parameterform), damit die Meilenangabe sauber ist.
4. **Schreiben** — je Intervall eine Zeile in `path_ecosystem`.
5. **Im Gebirge zusätzlich** (Stufe 3): an denselben Abtastpunkten die Höhe aus dem
   Netz lesen und die Zeit **Schritt für Schritt integrieren** — je Schritt aus der
   *lokalen* Steigung ein lokales Tempo bilden und aufsummieren, einmal vorwärts
   und einmal rückwärts. Ergebnis sind `factor_forward` / `factor_backward`.
   Auf- und Abstieg werden nebenher summiert, aber nur als Anzeigewerte.

   Die **Kurve Steigung → Tempo** ist ein austauschbares Stück und gehört den
   Editoren (§8 des Designdocs). Startvorschlag: Toblers Wanderfunktion —
   asymmetrisch, am schnellsten leicht bergab, steil hinauf *und* steil hinab
   langsam. Ändert sich die Kurve, läuft **nur dieser Stapellauf** neu; an der
   Routing-Seite ändert sich nichts.

> **Warum abtasten statt nur exakt schneiden:** die exakte Variante stirbt an
> Entartungen — Stützpunkt genau auf der Kante, tangentiale Berührung einer Ecke.
> Abtastpunkte treffen eine Kante praktisch nie exakt. Und es ist derselbe
> Durchlauf, den die Höhenabtastung ohnehin braucht.

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
- **Kanten-Verschneidung:** Teilstück ganz drin, ganz draußen, halb — der
  längengewichtete Faktor muss stimmen.
- **Regression Flussrichtung:** die vorhandenen Flow-Tests müssen nach dem Umbau
  auf „sammeln und multiplizieren" unverändert grün sein.
- **Parität:** dieselbe Route über beide Engines, identisches Ergebnis.
- **Toggle aus = heutiges Verhalten**, bitweise identisch.

## 10. Offene Punkte

- Konkrete Faktorwerte je Typ — **gehören den Editoren**, nicht diesem Dokument.
- Abtastschrittweite (Genauigkeit gegen Laufzeit).
- Ausnahmenliste gegen Doppelzählung (`Gebirgspass`, `Wuestenpfad`, weitere?).
- Ob Flächen ohne Wiki-Bezug im „Führt durch" auftauchen oder still bleiben.
- Wann der Toggle vom Edit-Mode auf Standard umgestellt wird.
- Welche Kurve Steigung → Tempo abbildet (Startvorschlag Tobler, §5).
- Wie der Oberfläche beizubringen ist, dass Terrain im Modus „kürzester Weg"
  wirkungslos bleibt — Hinweis, Ausgrauen des Hakens, oder gar nichts.
