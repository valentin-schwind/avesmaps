# Die Klimazone in der Infobox — Entwurf

> **Stand 2026-08-03.** Vom Owner beauftragt und abgenommen („ja, die zeile passt, wege machst du auch").
> Baut auf `docs/superpowers/specs/2026-08-03-klimazonen-design.md` auf — dort §11 stand noch
> „**keine** Klimazone in der Infobox … kommt mit dem Effekt". Das ist hiermit eingelöst, der
> Reise-Effekt bleibt weiterhin eine eigene Sitzung (`2026-08-03-reisezeitpunkt-*`).

## 1. Was gebaut wird

Eine Zeile **„Klimazone"** in der Infobox, **direkt unter Flora**, an drei Stellen:
Ort, Landschaftsregion, Weg. Dieselbe Zeile, derselbe Zeilenbauer, dieselbe Optik.

```
Waren       Wein, Öl, Marmor
Fauna       Steppenwolf, Wanderfalke
Flora       Ölbaum, Zeder
Klimazone   Winterfeuchte Subtropen
```

## 2. Der tragende Satz

> 🔴 **Drei Formen, drei Quellen — und das ist keine Inkonsistenz, sondern was die Dinge sind.**

| | Form | woher die Antwort kommt |
|---|---|---|
| **Ort** | ein Punkt | liegt in **genau einem** Band → serverseitig im Kartenpayload bestimmt |
| **Region** | eine Fläche | liegt **anteilig** in mehreren → aus dem gespeicherten Verschnitt („Zugehörigkeit rechnen") |
| **Weg** | eine Linie | **abschnittsweise** → `path_ecosystem`, über `api/app/path-landscapes.php` |

Ein Ort bekommt deshalb **nie** einen Prozentwert. „Punin liegt zu 62 % in den Winterfeuchten
Subtropen" wäre als Präzision verkleidete Falschaussage — ein Punkt liegt in einem Band.

## 3. Der Fehler, der schon live war

„Zugehörigkeit rechnen" ist am **2026-08-03 um 06:32** gelaufen. Weil ein Klimaband technisch eine
ganz gewöhnliche `ecosystem_area` ist, trug seitdem **jeder der 5.765 Wege** seine Zone in
`path_ecosystem` — und `api/app/path-landscapes.php` filtert nicht nach `kind`. Ergebnis, live und
von niemandem entschieden:

> **Führt durch:** Katzenwald · Winterfeuchte Subtropen

Dasselbe im Reiseplan an jeder Etappe („durch Katzenwald, Winterfeuchte Subtropen").

**Repariert hat das die Reisezeitpunkt-Sitzung** (`730572f3`, „fuehrt durch nennt keine Klimazone
mehr"), indem sie `klima` mitten in `buildLandscapeLine` übersprang. Richtig — aber damit war die
Zone auch weg, und die Infobox will sie ja zeigen, nur eine Zeile tiefer. Aus dem Überspringen ist
hier ein **Schalter** geworden: `buildLandscapeLine` liefert alles außer `klima`, `buildClimateLine`
genau `klima`, beide aus demselben Verschnitt. Eine Rechnung, zwei Hälften; die Anteile messen in
beiden gegen die **ganze** Weglänge.

**Der Schalter sitzt im Rechner, nicht an den Aufrufstellen.** „Führt durch" hat **vier** davon
(Weg-Infobox, Etappenzeile, Routen-Zusammenfassung, Karten-Links); ein Filter je Aufrufstelle wäre
viermal dieselbe Regel gewesen, und die fünfte hätte sie vergessen.

> Der **Routenplaner bekommt keine Klimazeile.** Er verliert sie nur dort, wo sie nicht hingehörte.
> Was die Jahreszeit mit der Zone macht, gehört der Reisezeitpunkt-Sitzung.

## 4. Warum die Antwort aus den BÄNDERN kommt und nicht aus den Trennlinien

Die Trennlinien sind die Wahrheit des Features, und ein Punkttest gegen sie wäre sechs Vergleiche
statt eines Polygontests. Trotzdem fragt `api/_internal/app/climate-membership.php` die **Bänder**.

> 💣 **Weil die Regeln der Trennlinien sich bewegen.** Bis zum 2026-08-03 stieg auf jeder Linie `x`
> streng — damit war sie eine Funktion `y(x)` und der Punkttest ein Einzeiler. Seit `234328d0`
> („eine Klimagrenze darf zuruecklaufen — Blasen sind jetzt moeglich", für die Wüste Khôm) gilt das
> nicht mehr, und genau dieser Einzeiler liefert **innerhalb einer Blase die falsche Zone**, ohne zu
> irren. Ein Band ist ein Polygon, was die Linie darunter auch tut.

Der Zweig `worktree-reisezeitpunkt` trägt eine `avesmapsClimateZoneIndexAt()` mit der alten Annahme
(Commit `d4d5046b`, vor der Blasen-Umstellung entstanden). Sie wurde **bewusst nicht übernommen**.

## 5. Datenweg

### 5.1 Ort und Region — im Kartenpayload

`api/_internal/app/climate-membership.php`, aufgerufen von `api/app/map-features.php`:

- `avesmapsClimateReadBands()` — die sieben Bänder mit Bounding-Box, Nord nach Süd.
- `avesmapsClimateZoneKeyAt()` — Punkt-in-Polygon, **Bounding-Box zuerst**. Bänder sind waagerechte
  Streifen, also schließt das `y` eines Ortes fünf bis sechs der sieben aus, bevor eine Kante angefasst
  wird: aus 4.650 × 7 Ringtests wird etwa ein Test je Ort.
- `avesmapsClimateReadRegionZones()` — aus `ecosystem_region_overlap`, also aus dem **Ergebnis** von
  „Zugehörigkeit rechnen", nie neu gerechnet.

Am Feature landet:

| Feld | an | Form |
|---|---|---|
| `properties.climate_zone` | `feature_type = location` | ein Schlüssel |
| `properties.climate_zones` | `feature_type = label` (Landschaftsregion) | `[[schlüssel, anteil], …]` |
| `climate_zones` (Payload-Ebene) | einmal | die sieben Namen, Nord nach Süd |

Zwei Feldnamen für zwei verschiedene Aussagen. Der Anzeigename steht **einmal** im Payload statt
4.650-mal am Ort.

> 🔴 **Reihenfolge:** `avesmapsClimateApplyToFeatures` läuft **nach**
> `avesmapsEcosystemApplyLabelRegionsToFeatures`. Etwa 137 Labels bekommen ihren
> `ecosystem_region_public_id` erst dort — vertauscht verlieren genau die ihre Zeile.

### 5.2 Der ETag

> 💣 **`map_revision` deckt das nicht ab.** Eine gezogene Trennlinie schreibt alle sieben Bänder neu
> und verschiebt die Zone jedes Ortes — rührt `map_revision` aber nicht an. Ein warmer Client bliebe
> bei seinem 304 und zeigte weiter die alte Zone, ohne dass irgendwo stünde warum. Dieselbe Falle, die
> die Klima-Saat schon einmal gekostet hat (Klimazonen-Entwurf §6.1).

`avesmapsClimateReadStamp()` liefert `ecosystem_revision` + `computed_at` des Zuordnungslaufs; beides
geht in den ETag-Seed. `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` steigt auf **10**.

## 6. Grenzen, die bewusst so sind

- **Die 5-%-Schwelle** gilt auch fürs Klima: ein Splitter der Nachbarzone am Rand ist Rauschen.
- **Die 90-%-Regel**: was praktisch ganz in einer Zone liegt, bekommt keinen Prozentwert — sonst endete
  fast jede Zeile auf „(100 %)".
- **`share` ist der Anteil der KLEINEREN der beiden Flächen** (V9). Für jede gewöhnliche Region ist das
  die Region, und die Zahl liest sich richtig. Für etwas, das **größer** als ein Band ist (ein Meer, ein
  Kontinent), drehen sich die Rollen — solche Zeilen fallen unter die Schwelle und entfallen von selbst.
- **Ein Ort ohne Wiki-Datensatz bekommt keine Zeile**, weil er überhaupt keine Feldliste bekommt. Das ist
  dieselbe Reichweite wie bei Flora/Fauna, die in derselben Liste stehen — nicht mehr und nicht weniger.
- **Das schwebende Popup** zeigt die Feldliste gar nicht (Owner). Die Zeile steht im Infopanel.
- **Herrschaftsgebiete** bekommen keine Zeile: „Regionen" meinte die Landschaftsebene, und der
  Verschnitt gegen Territorien (`ecosystem_region_territory`) hat bis heute keinen Leser.
- **Kein Link.** Die Zonen haben keinen Wiki-Artikel; die Zeile ist Text.

## 7. Prüfung

| Was | Wie |
|---|---|
| Punkt-in-Band, Blase, Loch, MultiPolygon | `api/_internal/app/__tests__/climate-membership-test.php` |
| Vokabular, drei Zulieferer, 90 %-Regel, Escaping | `js/map-features/__tests__/climate-row.test.js` |
| `klima` fällt aus „Führt durch", Anteile stimmen | `js/map-features/__tests__/path-landscapes.test.js` |
| Optik + Spaltenflucht | localhost-Repro, gemessen: `dt` x=36/w=96, `dd` x=140/w=232 — identisch mit den Nachbarzeilen |

Verwandt: [[klimazonen-abgeleitete-ebene]], [[landschaften-v10-fuehrt-durch]],
[[oekosystem-terrain-routing]], [[map-features-payload-legacy-fields]].
