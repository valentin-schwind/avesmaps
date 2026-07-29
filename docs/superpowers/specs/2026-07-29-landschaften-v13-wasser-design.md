# Landschaften V13 — Querfeldein meidet Wasser — Design

**Stand:** 2026-07-29 · **Auftraggeber:** Owner · **Vorgänger:** V9 ✅ live (liefert den
Kern), V10 ✅ live · **Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md`
Zeile 2135 · **Abnehmer:** keiner — V13 ist für sich fertig. V14 (A\*) bleibt vertagt.

---

## 0. Kurzfassung

Fehlt zwischen zwei Orten ein gezeichneter Weg, baut der Routenplaner eine gerade
**Querfeldein**-Kante. Heute prüft niemand, was dazwischen liegt — fünf echte Routen ab
Gareth laufen quer über den Ozean.

V13 fragt die Geometrie: **schneidet die Sehne ein `meer`- oder `see`-Polygon, entsteht die
Kante nicht.** Gibt es eine trockene Ausweichverbindung, wird sie genommen; gibt es keine,
entsteht gar keine Kante und der Planer sagt „keine Route gefunden" (Owner-Entscheid
2026-07-29: *„Wirklich weglassen."*).

Gerechnet wird **im Server, bei jeder Anfrage** — kein Knopf, kein Stempel, nichts, das
veralten kann. Aufpreis gemessen: **117 ms** im Normalfall auf eine Anfrage, die heute 1,2 s
dauert.

---

## 1. Wo das passiert — und wo nicht

💣 **Die Fahrplan-Zeile zielt auf die falsche Seite.** Sie sagt „~50 Z. im Client". Live
läuft aber **server-primäres Routing**: `shouldUseServerPrimaryRouting()`
(`js/routing/route-engine.js:41`) liefert `true`, außer bei `?clientrouting=1`.
`USE_SERVER_ROUTING = false` (`js/routing/route-graph-routing.js:6`) sagt darüber **nichts**
— das ist ein zweiter, toter Schalter, den nur `calculateRouteByMode()` liest, und der
Live-Fluss ruft das nicht auf.

Die zählenden Kanten entstehen in
`api/_internal/routing/client-graph.php:236` (`avesmapsConnectClientCompatibleDetachedGraphComponents`),
aufgerufen aus `:89`. **Dort wird gebaut.**

---

## 2. Die Messung (2026-07-29, `ecosystem_revision` 5044)

Verfahren: **drei** Serveranfragen insgesamt — eine `GET /api/app/map-features.php`
(18,7 MB), eine `GET /api/app/ecosystem-areas.php` (1,3 MB), eine `POST /api/route/` als
Validierungssonde. Danach Nachbau mit den **unveränderten** Produktionsfunktionen, validiert
gegen 13 Live-Kennzahlen aus dem regulären Antwortkörper (`node_count` 4653,
`path_feature_count` 5656, `synthetic_connection_count` **896**, `location_count`,
`path_count`, 8 Subtyp-Zahlen — alle exakt). Erst danach gerechnet.
Siehe [[offline-graph-rebuild-validated-against-live]].

### 2.1 Der Bestand ist gewachsen

| | Auftrag (Rev. 3983) | gemessen (Rev. 5044) |
|---|---|---|
| Wasserflächen `meer`+`see` | 331 | **329** (294 See, 35 Meer) |
| Kanten | 10.368 | **13.472** |
| davon Erprobungsflächen | — | **10 Flächen, 4.100 Kanten (30 %)** |
| Brücken je Anfrage | 1.020 | **896** (alle Verkehrsmittel) / **1.201** (nur Land) |
| davon schneiden Wasser | 104 | **85** / **188** |
| ohne trockene Alternative | 58 | **57** / **152** |
| betroffene echte Orte | 28 | **28** |

Die 28 Orte decken sich mit dem Auftrag (Güldenland, Die Vergessene Stadt, Zitadelle des
Eises, Retohaven, Akiras, Risa, Laguana …); die Aufteilung ist heute 16 Dörfer, 10 Bauwerke,
1 Stadt, 1 Kleinstadt.

⚠️ **Die letzten drei Zeilen sind die rohe Geometrie, ohne Küstentoleranz (§4.3).** Der
fertige Algorithmus lehnt weniger ab — die maßgeblichen Zahlen stehen in **§5**.

### 2.2 💣 Die heutige Sperre ist im Normalbetrieb **tot**

`AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE = 20.0` verweigert die Brücke, wenn die
Komponente „seeverbunden" ist. Gemessen:

| Einstellung | Brücken | heute erlaubt / Geometrie verweigert | heute verweigert / Geometrie erlaubt | beide verweigern |
|---|---|---|---|---|
| alle Verkehrsmittel | 896 | **85** | 0 | **0** |
| nur zu Fuß | 1.201 | 173 | 2 | 15 |

Bei eingeschalteter Seefahrt greift die Regel **kein einziges Mal** — und sie kann es nicht:
eine Komponente mit Seeweg hängt über genau diesen Seeweg schon an der Hauptkomponente und
ist gar nicht abgehängt. Nur im reinen Fußgänger-Fall feuert sie überhaupt, 17-mal. Der
Auftrag nannte sie „halb gebaut"; sie ist im Standardfall **wirkungslos**.

### 2.3 💣 Die Küstenfalle — der Befund, der das Design bestimmt

**571 von 4.653 Orten (12,3 %) liegen geometrisch IM Wasser** — 516 Kreuzungen und **55
benannte Orte**, darunter **Belhanka (Großstadt), Kuslik, Salzerhaven, Neersand,
Yaisirabad**. Hafenstädte werden auf die Küste gezeichnet, das Meerpolygon liegt großzügig
darüber. Das ist **kein Tippfehler-Häufchen, sondern systematisch**.

Folge: **51 der 85 Ablehnungen** entstehen nicht durch eine echte Überfahrt, sondern weil ein
*Endpunkt* im Küstenpolygon sitzt. Betroffen sind Sehnen von **0,45 bis 2 Einheiten** — kurze
Landhüpfer nach Kuslik, Arlinsburg, Silthrin, Senan, Burg Weißenstein, Forstwehr.

**Ohne Küstentoleranz macht V13 diese Verbindungen kaputt.** Siehe §4.3.

### 2.4 💣 Die unbegrenzte Suche ist die eigentliche Kostenfalle

Sucht man die trockene Ausweichverbindung ohne Deckel, kostet sie **17 s** (alle
Verkehrsmittel) bis **47 s** (nur Land) — unbrauchbar. Der Grund: die 57 hoffnungslosen
Komponenten probieren *jedes* Paar durch, bevor sie aufgeben.

Wird sie aber gefunden, dann früh: **Median Rang 3, p90 Rang 9, max Rang 16.**

| Deckel | trockene Alternative gefunden | Sehnen geprüft |
|---|---|---|
| 1 | 0 von 85 | 85 |
| 10 | 26 von 85 | 684 |
| **25** | **28 von 85** | **1.547** |
| 250 | 28 von 85 | 14.372 |
| ohne | 28 von 85 | 183.362 |

**Deckel 25 kauft alles.** Umweg der gefundenen Alternativen: Median ×1,49, p90 ×3,41,
max ×5,79.

### 2.5 Die Kosten

| | alle Verkehrsmittel | nur zu Fuß |
|---|---|---|
| Wasser laden (220 KB) + `json_decode` + Kanten + Gitter, **einmalig** | 5,4 ms | 5,4 ms |
| Schnitttests | 51 ms | 140 ms |
| **Aufpreis gesamt** | **117 ms** | **324 ms** |
| zum Vergleich: Graphaufbau heute | 561 ms | 705 ms |
| zum Vergleich: ganze Live-Route | \~1.200 ms | — |

⚠️ Gemessen auf dem Entwicklungsrechner. STRATOs PHP ist langsamer; die **Verhältnisse**
tragen, die absoluten Zahlen sind eine Untergrenze.

---

## 3. Der Zuschnitt: inline, kein Stempel

**Owner-Entscheid 2026-07-29: „Erst messen, dann entscheiden" → nach der Messung: inline.**

Die Vorsitzung schlug vor, die Entscheidung je Komponente vorzuberechnen (Knopf + Stempel,
die Figur von V9). Das trägt nicht:

1. 💣 **Es gibt keine stabile Komponente zum Stempeln.** Die Komponenten hängen an der
   Transportauswahl der Anfrage (`avesmapsIsClientRouteDomainEnabled`) — „nur über Fluss"
   ergibt eine völlig andere Komponentenmenge als „zu Fuß". Gemessen: 896 Komponenten mit
   allen Verkehrsmitteln, **1.201** nur zu Fuß. Stabil wäre allein „schneidet die Sehne A→B
   Wasser", und das sind 4.531² Paare, die man nicht aufzählt.
2. **Der heiße Pfad ist ohnehin heiß.** Jede POST-Route lädt über `avesmapsLoadRouteMapData`
   (`api/_internal/routing/response.php:167`) die **komplette** `map_features`-Tabelle, ohne
   Cache — der Code sagt selbst: 62 MB resident, Spitze 152 MB je Aufruf. Die 220 KB Wasser
   sind 0,3 % obendrauf.
3. **Ein Stempel würde veralten.** V10 trägt diese Last schon (🔧 „nach jeder Flächenänderung
   ‚Zugehörigkeit rechnen' drücken"). Eine zweite gleichartige Pflicht für eine Frage, deren
   Antwort 117 ms kostet, ist der schlechtere Tausch.

---

## 4. Der Bauplan

### 4.1 Die Wasserquelle

Neu: `avesmapsLoadRouteWaterAreas(array $config): array` in
`api/_internal/routing/water-areas.php`, aufgerufen aus
`avesmapsBuildMinimalRouteResultFromRequest` neben `avesmapsLoadRouteMapData`.

```sql
SELECT a.geometry_geojson, a.min_x, a.min_y, a.max_x, a.max_y
FROM ecosystem_area a
INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
WHERE a.is_active = 1 AND a.is_trial = 0 AND r.region_type IN ('meer', 'see')
```

- **Wasser ist `meer` + `see`.** Nicht `kueste` (sonst blockiert jeder Küstenweg), nicht
  `kontinent`, nicht `insel`.
- 💣 **`affects_paths` wird NICHT abgefragt.** Das ist V9s Rechenlauf-Filter und steht für
  `meer` auf **0** — genau die Flächen, um die es hier geht. Wer es mit abfragt, baut ein
  Feature, das nichts tut.
- **`is_trial = 0`:** Erprobungsflächen sind Versuche (V3.5). Routing darf sich nicht ändern,
  weil jemand etwas ausprobiert. Nebeneffekt: spart 4.100 der 13.472 Kanten (30 %).
- **Kein neuer Schalter, und `ecosystem_enabled` wird nicht gelesen.** Der Riegel regelt, ob
  die *Ebene sichtbar* ist, nicht ob die Welt Ozeane hat.
- ⭐ **Ausfallverhalten ist die Sicherung:** kommen keine Zeilen (Tabelle fehlt, Abfrage
  scheitert, Bestand leer), ist V13 **inert** und der Planer verhält sich exakt wie heute.
  Das ist der bestmögliche Fehlerfall und muss so gebaut sein — kein Abbruch, keine 500.

### 4.2 Der PHP-Zwilling des V9-Kerns

Neu: `api/_internal/app/ecosystem-line-intervals.php` — getreue Portierung von
`js/map-features/map-features-ecosystem-path-assign.js`:
`ecosystemAreaEdges`, `ecosystemPointInEdges`, `ecosystemCumulativeLengths`,
`ecosystemPointAtCumulative`, `ecosystemLineIntervals`.

⭐ Der V9-Kern nimmt eine **Koordinatenliste**, kein Weg-Objekt — eine Querfeldein-Kante ist
derselbe Aufruf mit zwei Punkten statt dreißig. **Keine zweite Mathematik.**

Zwei Laufzeiten heißen zwangsläufig zwei Umsetzungen. Sie werden durch einen **gemeinsamen
Fixture-Test** ehrlich gehalten (dieselbe Figur wie
[[normalizer-parity-server-owns-the-rule]]): eine Datei mit Sehnen + erwarteten Urteilen, die
**beide** Seiten lesen. Bereits nachgewiesen: 4.000 Sehnen aus dem Livebestand, **identisches
Urteil auf allen**.

💣 Die drei Halb-offen-Regeln und die Sondenplatzierung des Originals sind **tragend** und
wörtlich zu übernehmen — sie sind je an einem gemessenen Fehlschlag entstanden
(Kommentare `:143`, `:154–166` im JS-Kern).

### 4.3 Die Küstentoleranz

```php
// A harbour town is drawn ON the coast and the sea polygon is drawn over it: 55 named places sit
// geometrically INSIDE water, Belhanka and Kuslik among them. Water within this distance of either
// end of a chord is therefore coastal drawing slop, not a crossing, and is ignored.
const AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE = 1.0;   // map units (1 unit = 3.000 Schritt)
```

Regel: die nassen Abschnitte der Sehne werden auf `[T, Länge − T]` beschnitten. Bleibt nichts
übrig, gilt die Sehne als **trocken**.

Gemessen (alle Verkehrsmittel):

| T | Ablehnungen | echte Überfahrten noch gesperrt |
|---|---|---|
| 0 | 85 | 7 von 7 |
| **1,0** | **62** | **7 von 7** |
| 3,0 | 51 | 7 von 7 |
| 5,0 | 36 | ❌ **4 von 7** |

Bei T = 1 werden genau **23** Brücken frei, und alle 23 sind Küstenhüpfer: Sehnen von 0,45 bis
6 Einheiten nach Kuslik, Arlinsburg, Silthrin, Senan, Charasim, Burg Weißenstein, Forstwehr,
Qinsay — plus eine 45,9 Einheiten lange Sehne (Walamar → Pjeschen), die 1,2 % einer
Flussmündung streift.

🔴 **Ehrlichkeitsvermerk: die Verteilung hat keinen natürlichen Sprung.** Der Wert ist eine
Ermessensfrage, keine Messung. Sichere Spanne 0 < T ≤ 3; ab 5 frisst sie echte Überfahrten.
Deshalb steht er als **benannte Konstante** und nicht als Zahl im Code.

⚠️ **Folge, die benannt gehört:** eine Sehne kürzer als 2 × T wird nie abgelehnt. Bei T = 1
heißt das: Hüpfer unter 2 Einheiten (≈ 6 km) sind immer erlaubt. Ein Grenzfall ist real
(Theron → Ralûnk, 1,92 Einheiten, 99 % nass). Bewusst getragen — der ×25-Kostenfaktor auf
Querfeldein macht solche Hüpfer ohnehin teuer.

### 4.4 Der Brückenbau — zweistufig, Deckel 25

In `avesmapsConnectClientCompatibleDetachedGraphComponents`, je abgehängter Komponente:

1. **Unverändert:** Komponenten finden, nach Größe sortieren, wassergebundene Knoten
   filtern, den **einen** nächsten Kandidaten suchen
   (`avesmapsFindNearestClientCompatibleComponentConnection`).
2. **Neu:** diese Sehne gegen das Wasser prüfen. **Trocken → Brücke wie heute, fertig.**
   Das trifft **811 von 896** Brücken, die damit nichts extra kosten.
3. **Nur wenn nass:** denselben Scan noch einmal, diesmal die **25 nächsten** Paare mitnehmen
   (Einfügen in eine 25er-Liste, **kein** Sortieren der vollen Paarliste — das war in der
   Messung der teuerste Einzelposten). Der Reihe nach prüfen, die erste trockene gewinnt.
   Rang 1 ist die schon geprüfte Sehne aus Schritt 2 und wird **übersprungen**, nicht erneut
   getestet.
4. **Keine trocken → keine Kante.** Kein Notnagel, keine Sonderbeschriftung
   (Owner-Entscheid).

```php
const AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT = 25;
```

⭐ **Warum zweistufig:** der Paar-Scan läuft **heute schon** — er steckt in den 561 ms des
Graphaufbaus. Ihn für alle 896 Komponenten auf „25 statt 1" umzustellen kostet **103 ms**; ihn
nur für die nassen zu wiederholen kostet **66 ms**. Der zweite Scan ist billiger als die
verallgemeinerte Buchhaltung.

**Vorfilter:** die Wasserflächen bekommen ein **Gitter** über ihre bbox (Zellweite 32
Kartenweiten, 963 Zellen, 2,1 Flächen je Zelle statt 319 im linearen Scan). Einmal je
Anfrage gebaut: 0,6 ms.

### 4.5 Die tote Regel wird entfernt

`AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE`, `avesmapsClientComponentIsSeaConnected`
und der Zweig bei `:278–281` entfallen. Die Geometrie beantwortet dieselbe Frage direkt statt
über einen Stellvertreter.

**Was sich dadurch ändert:** im reinen Fußgänger-Fall werden **2** Brücken frei, die die alte
Regel zu Unrecht sperrte (trockene Landbrücken zu seeverbundenen Komponenten). Das ist eine
Behebung, keine Regression.

⚠️ **`avesmapsFilterOutClientWaterLockedNodes` / `avesmapsClientNodeIsWaterLocked` bleiben.**
Andere Frage, anderer Mechanismus: sie erkennen einen Knoten, der *nur* per Schiff erreichbar
ist. Wer sie mit entfernt, lässt Landbrücken auf Inselhäfen zu.

### 4.6 Der zweite Erzeuger bekommt dieselbe Sperre

💣 `avesmapsConnectClientRouteWaypointsToNearestLandPath` (`:320`) erzeugt **ebenfalls**
Querfeldein-Kanten — den kurzen Anker von einem Reise-Wegpunkt auf den nächsten Landweg. Wird
er vergessen, ist die Sperre wieder nur halb gebaut, und zwar genau an den Orten, die der
Nutzer selbst eingibt.

`avesmapsFindNearestClientLandPathAnchor` (`:425`) liefert heute die **eine** nächste
Projektion. Sie bekommt dieselbe Behandlung: die 25 nächsten Projektionen mitnehmen, die
erste mit trockener Ankersehne gewinnt, keine trocken → kein Anker. Kostet praktisch nichts:
die Funktion läuft für höchstens drei Wegpunkte je Anfrage.

---

## 5. Die Wirkung des fertigen Algorithmus — gemessen

Der Zuschnitt aus §4 (Toleranz 1,0 · Deckel 25 · zweistufig), einmal ganz durchgerechnet:

| | alle Verkehrsmittel | nur zu Fuß |
|---|---|---|
| Brücken heute | 896 | 1.201 |
| davon direkt gebaut (nächste Sehne trocken) | 834 | 1.044 |
| gebaut nach Suche (trockene Ausweichverbindung) | 22 | 33 |
| **weggelassen (nichts trocken)** | **40** | **124** |
| `synthetic_connection_count` **896 → 856** | | 1.201 → 1.077 |
| **gestrandete benannte Orte** | **24** | **110** |

💣 **Die 24 sind nicht die 28 aus §2.1.** Jene Zahl ist die rohe Geometrie ohne
Küstentoleranz; die Toleranz rettet vier Orte, darunter **Pilkamm** — die einzige *Stadt* der
Liste. Wer die Spec quer liest, nimmt sonst die falsche Zahl mit.

**Die 24 (Standardeinstellung):** 13 Dörfer — Akiras, Baku-Ruka, Die Vergessene Stadt,
Eremitenhöhle, Ifirnsort, Ila, Ka-Hanluq, Retohaven, Risa, Schellwick, Shanasala, Telf,
Tul'ka'var · 10 Bauwerke — Güldenland, Heiligtum der alten Götter, Laguana, Talagh Cladrim,
Tir-Logh-Càrn, Vayafendur, Voolkyr Vash'ar, Walfriedhof auf Nualauki, Zitadelle des Eises,
Äußerster Süden · 1 Kleinstadt — Sorabis.

> Owner-Begründung, die den Entscheid trägt: die Hälfte dieser Orte liegt jenseits des Meeres
> oder in der Sage; dorthin zu Fuß zu laufen ist der eigentliche Fehler.

**Der Fußgänger-Fall (110 Orte) ist geprüft und korrekt**, nicht kaputt: die vier
betroffenen Großstädte sind **Tuzak** (Hauptstadt Maraskans — einer Insel), **Sinoda**,
**Boran** und **Jergan**, dazu 10 Städte wie Port Rulat, Charypso, Altaïa. Ohne Schiff sind
sie zu Fuß tatsächlich unerreichbar — genau der Fehler, den V13 behebt.

⚠️ **Erreichbar bleiben sie per Schiff** — mit eingeschalteter Seefahrt ändert V13 an ihrer
Erreichbarkeit nichts, sofern ein Seeweg gezeichnet ist. Wo keiner gezeichnet ist, ist das
eine **Datenlücke**, die V13 sichtbar macht statt sie zu überbrücken.

---

## 6. Fallen für die Umsetzung

1. 💣 **Nicht im Client bauen.** §1. Server-primär ist live.
2. 💣 **`affects_paths` nicht mitfiltern.** §4.1 — es steht für `meer` auf 0.
3. 💣 **Halb-offene Regeln wörtlich portieren.** §4.2.
4. 💣 **Küstentoleranz nicht vergessen**, sonst brechen 51 von 85 Fällen fälschlich. §2.3.
5. 💣 **Nicht die volle Paarliste sortieren.** 25er-Einfügeliste. Sonst +3 s je Anfrage.
6. 💣 **Den zweiten Erzeuger mitnehmen.** §4.6.
7. 💣 **`is_trial` ausschließen** — sonst hängt das Routing an Versuchsflächen.
8. ⚠️ **`bounds` ist snake_case** (`min_x`, nicht `minX`) — siehe
   [[landschaften-editor-siebter]].
9. ⚠️ **Kein `?v=` von Hand.** V13 fasst kein Editor-Asset an, also auch **kein**
   `ASSET_VERSION`-Bump. Rein serverseitig.

---

## 7. Nachweis

**Unit (lokal beweisbar, keine DB):**
- Paritäts-Fixture PHP ↔ JS: eine gemeinsame Datei mit Sehnen + erwarteten Urteilen, beide
  Seiten lesen sie. Vorlage liegt vor (4.000 Sehnen, 100 % Übereinstimmung).
- Küstentoleranz: drei benannte Fälle — Hafenstadt-Endpunkt (muss durch), echte Überfahrt
  (muss sperren), Sehne kürzer als 2 × T (muss durch).
- Deckel: eine Komponente mit trockener Alternative auf Rang 3 und eine ohne.

**Netzlauf (der eigentliche Beweis, nach dem Deploy):**
- `POST /api/route/` Gareth → **Retohaven**, alle Verkehrsmittel: heute eine
  Querfeldein-Etappe über See, danach **„keine Route gefunden"** bzw. eine reine Seeroute.
- `POST /api/route/` auf eine **Kuslik**-Verbindung: muss weiterhin gefunden werden
  (Küstentoleranz greift).
- `client_graph_statistics.synthetic_connection_count` fällt von **896** auf **856**
  (896 − 40 weggelassene). Die Zahl steht im **regulären** Antwortkörper unter
  `route.debug.context` — kein `?diagnostic=` nötig, also kein teurer Zweig.

---

## 8. Ausdrücklich NICHT in V13

- **Der Client** (`js/routing/route-graph-routing.js:49`). Er hat heute **gar keine**
  Wasserlogik — nicht einmal die alte 20-Einheiten-Regel. Er bedient `?clientrouting=1` und
  den Unverbundene-Orte-Marker. Parität ist erwünscht, **der Server zuerst** (Owner). Eigene
  Sitzung. ⚠️ Der Marker baut seinen Graph mit `transports: "all"` — dort ist zu prüfen, ob
  die Brücken den Marker heute zu leise machen.
- **Die 55 Orte im Wasser** (§2.3) sind eine Datenfrage, kein Routing-Fehler. V13 arbeitet um
  sie herum. Ob sie bereinigt werden, ist Redaktionsarbeit — ein Fall fürs ⚖️ Konfliktzentrum,
  nicht für diese Sitzung.
- **A\*** (V14), Terrain auf Kantengewichte (V11).

---

## 9. Stellschrauben, die der Owner drehen kann

| Konstante | Vorschlag | sichere Spanne | Wirkung |
|---|---|---|---|
| `AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE` | **1,0** | 0 … 3,0 | größer = mehr Küstenhüpfer erlaubt; ab 5,0 fallen echte Überfahrten durch |
| `AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT` | **25** | 10 … 50 | kleiner = billiger, findet ab 10 zwei Alternativen weniger; über 25 kauft nichts mehr |

---

## Selbstprüfung

**Erzeuger-Prüfung** (Verbraucher ohne Erzeuger *und* Erzeuger ohne Sperre):

| gebraucht von | Name | erzeugt von |
|---|---|---|
| §4.4 Schnitttest | `ecosystemLineIntervals` in PHP | §4.2 ✅ |
| §4.2 Zwilling | Wasserpolygone im Request | §4.1 ✅ |
| §4.4 Vorfilter | bbox je Fläche | §4.1 (`min_x` … `max_y` in der Abfrage) ✅ |
| §4.3 Toleranz | Sehnenlänge | liegt im Kandidatenpaar vor ✅ |

| Erzeuger von Querfeldein-Kanten | Sperre |
|---|---|
| `avesmapsConnectClientCompatibleDetachedGraphComponents` | §4.4 ✅ |
| `avesmapsConnectClientRouteWaypointsToNearestLandPath` | §4.6 ✅ |
| `connectDetachedGraphComponents` (Client) | §8 — bewusst vertagt, benannt ✅ |

**Was diese Spec NICHT beantwortet:** ob die 55 Orte im Wasser bereinigt werden sollen (§8),
und ob der Unverbundene-Orte-Marker heute durch dieselbe Lücke zu leise ist (§8). Beides
benannt, beides nicht hier entschieden.

---

Siehe [[oekosystem-terrain-routing]], [[landschaften-v9-zugehoerigkeit]],
[[routing-two-server-switches]], [[offline-graph-rebuild-validated-against-live]],
[[landschaften-v10-fuehrt-durch]].
