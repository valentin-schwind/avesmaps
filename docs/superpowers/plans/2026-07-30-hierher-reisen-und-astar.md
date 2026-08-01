# Instruction B — „Hierher reisen" + A\* mit Höhe

**Auftrag Owner 2026-07-30.** Zwei Ziele, ein Rechner.

> 🔴 **Nach feindlicher Prüfung berichtigt.** Die erste Fassung nannte drei Bausteine „vorhanden",
> die es nicht gibt, und zitierte eine Funktion, die es nicht mehr gibt. Alles Falsche steht unten
> ~~durchgestrichen~~ — der Irrtum ist lehrreicher als seine stille Beseitigung.

**Entwurf:** `docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md` — ganz lesen.
⚠️ **Auch er trägt die unten berichtigten Fehler** (§5.3 und die Selbstprüfung); diese Instruction
hat Vorrang.

---

## 0. Was gebaut wird

Rechtsklick auf einen **beliebigen** Kartenpunkt → Kontextmenü-Eintrag mit dem Wanderschuh → Reise
bis zum nächstgelegenen Graphknoten, von dort **querfeldein per A\*** zum Punkt. Liegt der Punkt
nicht an Land, kommt eine Meldung.

Der A\* berücksichtigt Höhenunterschiede: eine Querfeldein-Strecke geht nicht über Erhebungen, wenn
es einen günstigeren Weg gibt.

---

## 1. 🔴 Die Landprüfung gilt NUR dem angeklickten Punkt

**Owner wörtlich:** *„ORTE IM WASSER sind nicht zu überprüfen, diese können per Straße immer
erreicht werden. Es geht bei der Wasser-Überprüfung um ‚Hierhin reisen' → einen beliebigen Punkt."*

💣 Eine frühere Fassung wollte **Orte** prüfen und hatte gemessen, dass 85 von 2.674 durchfallen
(Belhanka, Nostria). **Falsche Frage.** Wer die Prüfung auf Orte ausdehnt, baut einen Fehler ein.

**Regel:** Land = in `kontinent` **oder** `insel`, **und** in keinem `meer`/`see`.
**Wasser schlägt Land.**

⚠️ **Nach `region_type` filtern, nicht nach `kind`** — die vier Arten verteilen sich auf **zwei**
`kind`: `kontinent` ist `derographisch`, `insel`/`meer`/`see` sind `topographie`. Wer nach `kind`
filtert, verliert Land.

⚠️ `kueste` und `inselgruppe` sind nach dieser Regel weder Land noch Wasser (`inselgruppe` ist
heute leer). Sie fallen in die 0,7 %.

**Gemessen (2026-07-30, `ecosystem_revision` 6211, 262.144 Rasterpunkte):** Wasser 67,6 % · Land
31,7 % · **weder noch 0,7 %** (wird wie Wasser behandelt — Land zu erfinden wäre schlechter) ·
doppelt deklariert 0,4 %. Abdeckung **99,3 %**.

💣 **Einen Lader für Landflächen gibt es nicht.** `kontinent`/`insel` werden im Routing nirgends
geladen — V13s `avesmapsLoadRouteWater` kennt nur `['meer','see']`. Der Landlader ist **Neubau**,
nach demselben Muster.

**Meldung:** deutsch, in die i18n-Tabelle (AGENTS.md §8), sinngemäß *„Dorthin führt kein Landweg —
bitte einen Punkt an Land wählen."* Die Prüfung steht **vor** allem anderen: kein Dijkstra, kein
Gitter, kein A\*, wenn der Punkt im Wasser liegt.

---

## 2. 💣 Der Weg dorthin — und die API-Lücke, die niemand erwähnt hat

| Stück | wie |
|---|---|
| Start → nächster Graphknoten | Dijkstra, wie heute |
| Graphknoten → angeklickter Punkt | A\*, querfeldein |

~~„Der Ausstiegspunkt ist die vorhandene Funktion `findNearestLocationToLatLng`"~~ — **halb falsch,
und die Hälfte ist teuer:**

- Sie existiert, aber **nur im Client** (`js/map-features/map-features-location-lookup.js:145`).
  **In `api/` gibt es keine Entsprechung.** `avesmapsFindNearestGraphNodeForLocation`
  (`graph.php:582`) nimmt einen **Namen**, keine Koordinate.
- 💣 **`POST /api/route/` kennt kein Koordinatenziel.** `from`/`to` sind Namensstrings
  (`request.php:29–30`). Der Entwurf sagt „gerechnet wird im Server" — beides zusammen geht **nicht
  ohne neue API-Fläche**. Das ist Arbeit, die zu planen ist, kein Detail.
- ⚠️ Sie schließt Kreuzungen **nach Namen** aus (`/^Kreuzung(?:-\d+)?$/i`), nicht nach der
  Server-Wahrheit `feature_subtype`. Der Dateikopf sagt es selbst: **~200 heißen
  `Kreuzung-auto-<n>`** und rutschen durch. Für „vorhersagbarer Ausstiegsort" ist das zu wenig —
  `isCrossingLocation` (`:106`) wäre der richtige Filter.
- ⚠️ **Widerspruch in der Tabelle oben:** „nächster **Graphknoten**" und „nächster **benannter
  Ort**" sind nicht dasselbe; Kreuzungen sind Graphknoten. Der Owner entscheidet, welches gemeint
  ist. `findNearestGraphNodeToLatLng` (`location-lookup.js:167`, ohne Filter) wäre die andere Lesart.

💣 **Hier liegen die großen Suchräume** (V11 §10.1, wörtlich geprüft): Luftlinie zum nächsten
benannten Ort p50 **39,5**, p90 157,8, max **290** Einheiten → bei Zellweite 0,5 p50 **10.600**,
max **568.000** Zellen. **Zelldeckel 150.000–200.000** ist hier tragend; darüber für **diese**
Anfrage vergröbern und die benutzte Zellweite in die Antwort schreiben.

---

## 3. Die Höhe

### 3.1 Die Einheiten — die Formel stimmt, die Funktion hieß anders

| | |
|---|---|
| 1 Schritt | 1 Meter |
| 1.000 Schritt | 1 Meile = 1 km |
| 1 **Karteneinheit** | **3.000 Schritt** = 3 km |

`Steigung = Höhendifferenz[Schritt] / (Strecke[Karteneinheiten] × 3.000)` — **STIMMT**, wörtlich
`avesmapsTerrainDescentIsSteep` (`terrain-factor.php:87`).

💣 ~~„V11s `avesmapsTerrainTimeFactor` benutzen; `(3000, 0, 3)` ergibt Steigung ⅓"~~ — **die
Funktion existiert nicht mehr.** Das V11-Modell wurde am 2026-07-30 auf **Leistungskilometer
(DIN 33466)** umgebaut. Sie heißt jetzt
`avesmapsTerrainLeistungsFactor(?float $ascentSchritt, ?float $steepDescentSchritt, float $distanceMapunits)`
(`terrain-factor.php:105`), liefert einen **Zeitfaktor** statt einer Steigung, und
`(3000.0, 0.0, 3.0)` ergibt **4,0** (die Klemme), nicht ⅓.

⭐ **Die Lehre:** der alte Name stand in einem **Vorentwurf**, nicht im Code. Ausgerechnet in dem
Absatz, der vor einem Faktor-3-Fehler warnt, stand ein Zitat aus zweiter Hand. **Vor dem Bauen die
Signatur lesen**, nicht das Dokument.

💣 Die Umrechnung ist trotzdem schon einmal live schiefgegangen: eine Faustregel setzte die Meile
auf 3.000 Schritt und lag um Faktor 3 daneben, bis ein Spieler es fand.

### 3.2 💣 Der Routing-Pfad darf das Höhenraster NICHT lesen

~~„Die Höhe kommt aus dem gespeicherten Raster, der Server liest es"~~ — **genau das ist verboten.**
`api/_internal/app/heightmap.php:12–14`, wörtlich:

> *„WHO READS THIS, AND WHO DOES NOT. The PROFILE RUN reads rasters. The ROUTING PATH never does —
> it reads `path_terrain` and nothing else. Loading all rasters per route request is exactly what
> the derived cache exists to prevent."*

`avesmapsHeightmapLoadAll` lädt **alle** Raster (einziger Aufrufer: `terrain-store.php:561`), die
Blobs sind deflate-komprimiert. **Ein bbox-begrenzter Lader existiert nicht und ist Neubau** — und
er ist der Punkt, an dem Ziel 2 hängt.

💣 **Der Beleg der ersten Fassung maß die falsche Tabelle:** „3.331 Profilzeilen" sind
`path_terrain` (der Wege-Zwischenspeicher), nicht gespeicherte Raster. **Wie viele Raster es
wirklich gibt, steht in keinem Dokument.** Das ist die erste Zahl, die zu messen ist.

⚠️ „58 Flächen mit Höhen**parametern**" (V14 §4.5) bzw. „63 mit Höhen**werten**" sind ebenfalls
nicht dasselbe wie „hat ein gespeichertes Raster".

### 3.3 ~~Die Heuristik-Falle~~ — entfallen

~~„Der Bergab-Bonus (Klemme 0,5) halbiert die Schärfe; den kleinsten vorkommenden Faktor messen."~~
**Gegenstandslos.** Das gebaute Modell hat **keine untere Klemme**: `terrain-factor.php:60–63`
(*„THERE IS NO FLOOR ANY MORE … the factor cannot fall below 1,0"*), festgenagelt durch
`assert(!defined('AVESMAPS_TERRAIN_FACTOR_MIN'))` im Test. Der kleinste vorkommende Faktor ist
**exakt 1,0**; auch die `offroad_factor`-Saat ist durchgehend ≥ 1,00.

⭐ **Die Heuristik verliert also keine Schärfe, und die geplante Messung entfällt ersatzlos.**
V14 §5.3 und dessen Selbstprüfung („🔴 muss gemessen werden") sind hiermit erledigt.

---

## 4. Das Symbol

`C:\GIT\avesmaps-map-processing\icons\menu\schuh.png` — 581 × 570, **490,7 KB** (nachgemessen).
Ins Repo als **`icons/schuh.webp`**: **80 × 80, WebP lossless (VP8L)**, wie der Bestand
(`compass` 7,2 KB, `feder` 3,6 KB). Nicht als PNG, nicht in Originalauflösung.

**Kontextmenü — Muster zum Abschreiben** (geprüft): Markup statisch in `index.html:246–266`
(`<button class="map-context-menu__item" data-context-action="…" data-i18n="…">`), Handler
delegiert in `js/routing/routing.js:654–772` über `this.dataset.contextAction` und
`pendingContextMenuLatLng`. Vorlage: `find-nearest-location` (`index.html:263`, `routing.js:739`).
⚠️ Im Icon-CSS (`css/components/map-context-menu-icons.css`) sind **zwei** Selektorlisten zu
ergänzen (Grid `:1–6`, Box 18×18 `:11–16`), nicht nur die Bildregel.

---

## 5. 🔴 Was „vorhanden" schien und Neubau ist

| | Stand |
|---|---|
| Landflächen-Lader (`kontinent`/`insel`) | **Neubau** (§1) |
| Koordinatenziel in `POST /api/route/` | **Neubau** (§2) |
| PHP-Zwilling von `findNearestLocationToLatLng` | **Neubau** (§2) |
| bbox-begrenzter Höhenraster-Lader | **Neubau** (§3.2) |
| Douglas-Peucker in PHP | **Neubau** — der vorhandene ist Leaflets `L.LineUtil.simplify` (`map-features-ecosystem-simplify.js`), **null Treffer in `api/`**; er arbeitet zudem auf eine **Zielpunktzahl**, nicht mit eps |

💣 **V14s Selbstprüfung führt die letzten beiden als erledigt.** Sie sind es nicht. Wer die
Aufwandsschätzung aus dem Entwurf übernimmt, rechnet zu niedrig.

⚠️ Zur Vereinfachung bleibt die **Absicht** gültig (V14 §5.7a): rohe 13–34 Gitterpunkte auf 4–10
eindampfen, ohne Länge zu verlieren. Nur ist der Weg dorthin ein eigener PHP-Douglas-Peucker mit
eps, und **eps 0,10** ist die gemessene Empfehlung.

---

## 6. Nachweis

**Lokal:**
- **Landprüfung:** Meer → abgelehnt · Kontinentmitte → Land · **beides** → abgelehnt ·
  **nichts** → abgelehnt. Kontrollpunkte: `(120, 300)` Wasser, `(500, 500)` Land.
- **Einheiten:** die Steigungsformel gegen `avesmapsTerrainDescentIsSteep` — 3.000 Schritt auf
  3 Karteneinheiten. Der Test nagelt fest, was schon einmal um Faktor 3 danebenlag.
- **A\*:** Hindernis mit Lücke → durch die Lücke · vollständige Sperre → kein Weg · Start = Ziel ·
  Zelldeckel greift und meldet die benutzte Zellweite.
- **Höhe:** zwei gleich lange Wege, einer über einen Buckel → der flache gewinnt.
- **Vereinfachung:** eine Treppe wird kürzer an Punkten, **nicht** an Länge.

**Live:**
- Rechtsklick im Meer → Meldung, keine Route.
- Rechtsklick an Land nah an einer Straße → Route mit kurzer Querfeldein-Etappe.
- Rechtsklick weit weg (p90) → Route entsteht; die Antwort nennt die vergröberte Zellweite.
- 🔴 **Gebirgs-Nachweis** `?s=DFtqNyn6` (Rovik → Skarsten): ohne Höhe läuft der Weg durch 70 % der
  Punkte im Gebirge, mit ihr herum — **11,2 statt 6,4**, beides unter den heutigen 24,8. Bleibt es
  bei 6,4, wirkt die Höhe nicht.
  ⚠️ Das Gebirge dort heißt „Gebirge im Weg" und ist eine Erprobungsfläche — die aber **schon
  heute** wirkt (Instruction A §0), Instruction A ist dafür **nicht** nötig.

---

## 7. Fallen

1. 💣 Landprüfung **nur** für den angeklickten Punkt (§1).
2. 💣 **Wasser schlägt Land**; nach `region_type` filtern, nicht nach `kind` (§1).
3. 💣 Der Routing-Pfad **darf keine Raster laden** — bbox-Lader bauen (§3.2).
4. 💣 `avesmapsTerrainTimeFactor` **existiert nicht**; Signatur lesen, nicht Dokumente (§3.1).
5. 💣 Fünf Bausteine sind Neubau, nicht vorhanden (§5).
6. 💣 Zelldeckel ist hier tragend (§2).
7. 💣 Gitter als Binärstring, drei Byte-Ebenen, Faktoren per **Maximum** (V11 §10.2/§10.3).
   ⚠️ `offroad_factor` hat bis heute **keinen Leser** in PHP — nur die Saat schreibt.
8. ⚠️ Linie an die **echten** Endpunkte nähen, dann vereinfachen (§5).
9. ⚠️ V10, V11 und die Reisezeit lesen die Etappengeometrie — alle drei nach dem Bau prüfen.
10. ⚠️ `bounds` ist snake_case. STRATO: Einzelsonden, keine Schleifen.

---

## 8. Reihenfolge

1. Symbol (§4) — unabhängig.
2. Landflächen-Lader + Landprüfung (§1) mit Tests — kleinstes, bestprüfbares Stück.
3. Die API-Frage klären (§2): wie kommt eine **Koordinate** in die Routenanfrage.
4. bbox-Höhenlader (§3.2) — **zuerst messen**, wie viele Raster es überhaupt gibt.
5. A\*-Rechner + PHP-Vereinfacher (§5).
6. Kontextmenü verdrahten (§4), Netzlauf (§6).

⚠️ Der **automatische** Auslöser (V14 §5.5, Schwelle 3×) ist nicht Teil dieser Instruction, teilt
aber den Rechner — **ein** Rechner, zwei Aufrufer.

Instruction A ist **keine** Voraussetzung (dort §0).
